/**
 * CBAM communications to EU importers — the exporter's portal for the Commission's
 * "CBAM Communication template for installations".
 *
 *   GET    /api/cbam/comm/lists            goods categories, routes, CN codes, countries, currencies, drop-down lists
 *   GET    /api/cbam/comms                 communications of the company (newest period first)
 *   POST   /api/cbam/comms                 new: {title, installationId?, copyFrom?, period?}
 *   POST   /api/cbam/comms/import          a filled template (.xlsx) → new communication (or ?into=<id> to replace its data)
 *   GET    /api/cbam/comms/:id             the communication with its results and checks
 *   PUT    /api/cbam/comms/:id             save {title?, status?, sentTo?, installationId?, data?}; returns the results
 *   DELETE /api/cbam/comms/:id
 *   GET    /api/cbam/comms/:id/export      the official template filled in (.xlsx)
 *   GET    /api/cbam/comms/summary?year=   the year by quarter: communications per installation, SEE per good, emissions
 *   GET    /api/cbam/comms/summary/export?year=   the same as Excel (CBAM annual summary)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { cbamOnly } from '../lib/cbamAccess.js';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { PRODUCT } from '../lib/brand.js';
import { AppError, notFound } from '../lib/errors.js';
import { LIMITS, PRODUCT_PARAMS, TEMPLATE_VERSION, buildWorkbook, calculate, commLists, emptyComm, fromWorkbook, normalise, type CommData } from '../lib/cbamComm.js';

const EDIT = ['super_admin', 'admin', 'manager'] as const;
const uuid = z.string().uuid();
const idOf = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const STATUS = ['draft', 'final', 'sent'] as const;

const quarterLabel = (start: string | null, end: string | null) => {
  if (!start) return '';
  const y = start.slice(0, 4), m = Number(start.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  const qEnd = new Date(Date.UTC(Number(y), q * 3, 0)).toISOString().slice(0, 10);
  return start.slice(5) === `${String((q - 1) * 3 + 1).padStart(2, '0')}-01` && end === qEnd ? `Q${q} ${y}` : `${start} to ${end ?? ''}`;
};
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'CBAM';

async function load(c: Tx, id: string) {
  const r = (await c.query(`SELECT m.*, i.name AS installation FROM cbam_communication m LEFT JOIN cbam_installation i ON i.id = m.installation_id WHERE m.id = $1`, [id])).rows[0];
  if (!r) throw notFound('CBAM communication');
  return r;
}
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const view = (r: any) => {
  const data = normalise(r.data);
  const result = calculate(data);
  return {
    comm: { id: r.id, title: r.title, status: r.status, sentTo: r.sent_to, installationId: r.installation_id, installation: r.installation ?? null, periodStart: iso(r.period_start), periodEnd: iso(r.period_end),
      period: quarterLabel(data.period.start, data.period.end), template: TEMPLATE_VERSION, createdName: r.created_name, createdAt: r.created_at, updatedName: r.updated_name, updatedAt: r.updated_at },
    data, result,
  };
};


/** The year by quarter, from the communications whose period starts in it. */
async function yearSummary(c: Tx, year: number) {
  const rows = (await c.query(`SELECT m.*, i.name AS installation FROM cbam_communication m LEFT JOIN cbam_installation i ON i.id = m.installation_id
                                WHERE m.period_start >= make_date($1, 1, 1) AND m.period_start < make_date($1 + 1, 1, 1) ORDER BY m.period_start, m.updated_at`, [year])).rows;
  const all = (await c.query(`SELECT id, title, status, period_start, period_end, data, installation_id, updated_at FROM cbam_communication ORDER BY period_start DESC NULLS LAST, updated_at DESC LIMIT 1`)).rows;
  type Cell = { id: string; status: string; title: string; period: string; errors: number; sentTo: string };
  type Inst = { name: string; cells: Record<number, Cell>; emissions: Record<number, { direct: number; indirect: number | null }> };
  type Good = { cn: string; name: string; cnName: string; unit: string; installation: string; q: Record<number, { seeDirect: number | null; seeIndirect: number | null; seeTotal: number | null; defaultShare: number | null; embeddedElec: number | null; commId: string }> };
  const inst = new Map<string, Inst>();
  const goods = new Map<string, Good>();
  const comms: { id: string; title: string; installation: string; period: string; quarter: number; status: string; sentTo: string; errors: number; updatedAt: unknown; updatedName: string }[] = [];
  for (const r of rows) {
    const v = view(r);
    const quarter = Math.floor((Number(String(v.comm.periodStart).slice(5, 7)) - 1) / 3) + 1;
    const name = v.data.installation.name || r.installation || 'Installation';
    const key = r.installation_id ?? name.toLowerCase();
    const e: Inst = inst.get(key) ?? { name, cells: {}, emissions: {} };
    const errors = v.result.checks.filter((x) => x.level === 'error').length;
    // the latest communication of the quarter counts (a copy replaces an older draft)
    e.cells[quarter] = { id: r.id, status: r.status, title: r.title, period: v.comm.period, errors, sentTo: r.sent_to };
    e.emissions[quarter] = { direct: v.result.ghg.direct, indirect: v.result.ghg.indirect };
    inst.set(key, e);
    comms.push({ id: r.id, title: r.title, installation: name, period: v.comm.period, quarter, status: r.status, sentTo: r.sent_to, errors, updatedAt: r.updated_at, updatedName: r.updated_name });
    v.result.products.forEach((p) => {
      const x = v.data.products[p.i]; if (!x?.cn) return;
      const gk = `${key}|${x.cn}|${x.name}`;
      const g: Good = goods.get(gk) ?? { cn: x.cn, name: x.name, cnName: p.cnName, unit: p.unit, installation: name, q: {} };
      g.q[quarter] = { seeDirect: p.seeDirect, seeIndirect: p.seeIndirect, seeTotal: p.seeTotal, defaultShare: p.defaultShare, embeddedElec: p.embeddedElec, commId: r.id };
      goods.set(gk, g);
    });
  }
  const latest = all[0] ? { id: all[0].id, title: all[0].title, status: all[0].status, period: quarterLabel(iso(all[0].period_start), iso(all[0].period_end)), updatedAt: all[0].updated_at } : null;
  return { year, installations: [...inst.values()], goods: [...goods.values()].sort((a, b) => a.cn.localeCompare(b.cn) || a.name.localeCompare(b.name)), comms, latest };
}

export async function cbamCommRoutes(app: FastifyInstance) {
  cbamOnly(app);
  app.get('/api/cbam/comm/lists', async () => {
    const L = commLists();
    return { ...L, limits: LIMITS, params: PRODUCT_PARAMS.map(([col, key, label, kind]) => ({ col, key, label, kind })), version: TEMPLATE_VERSION };
  });

  app.get('/api/cbam/comms', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const rows = (await c.query(`SELECT m.*, i.name AS installation FROM cbam_communication m LEFT JOIN cbam_installation i ON i.id = m.installation_id ORDER BY m.period_start DESC NULLS LAST, m.updated_at DESC`)).rows;
      const installations = (await c.query(`SELECT id, name, country FROM cbam_installation ORDER BY name`)).rows;
      return {
        can: { edit: canEdit(req) }, installations,
        comms: rows.map((r) => {
          const v = view(r);
          return { ...v.comm, products: v.data.products.length, processes: v.data.processes.length, errors: v.result.checks.filter((x) => x.level === 'error').length, warnings: v.result.checks.filter((x) => x.level === 'warn').length,
            goods: v.result.products.map((p) => ({ cn: v.data.products[p.i]?.cn ?? '', name: v.data.products[p.i]?.name ?? '', seeTotal: p.seeTotal, unit: p.unit })) };
        }),
      };
    });
  });

  const createBody = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    installationId: uuid.nullable().optional(),
    copyFrom: uuid.nullable().optional(),
    period: z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(),
  });
  app.post('/api/cbam/comms', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = createBody.parse(req.body ?? {});
    return tenantTx(tenant, async (c) => {
      let data: CommData = emptyComm();
      let installationId = b.installationId ?? null;
      if (b.copyFrom) {
        const src = await load(c, b.copyFrom);
        data = normalise(src.data);
        installationId ??= src.installation_id;
      } else if (installationId) {
        const i = (await c.query(`SELECT * FROM cbam_installation WHERE id = $1`, [installationId])).rows[0];
        if (!i) throw notFound('CBAM installation');
        data.installation = { ...data.installation, name: i.name ?? '', street: i.address ?? '', city: i.city ?? '', postcode: i.postcode ?? '', country: i.country ?? '', unlocode: i.unlocode ?? '',
          lat: i.lat == null ? '' : String(i.lat), lon: i.lon == null ? '' : String(i.lon), repName: i.contact_name ?? '', email: i.contact_email ?? '', phone: i.contact_phone ?? '' };
      }
      if (b.period) data.period = { start: b.period.start, end: b.period.end };
      else if (b.copyFrom && data.period.end) {
        // next period of the same length (quarter after quarter)
        const s = new Date(`${data.period.start}T00:00:00Z`), e = new Date(`${data.period.end}T00:00:00Z`);
        const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1;
        const ns = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + months, 1));
        const ne = new Date(Date.UTC(ns.getUTCFullYear(), ns.getUTCMonth() + months, 0));
        data.period = { start: ns.toISOString().slice(0, 10), end: ne.toISOString().slice(0, 10) };
      }
      const title = b.title ?? (`${data.installation.name || 'Installation'} — ${quarterLabel(data.period.start, data.period.end) || 'new period'}`).slice(0, 200);
      const r = (await c.query(`INSERT INTO cbam_communication (tenant_id, installation_id, title, period_start, period_end, data, created_name, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [tenant, installationId, title, data.period.start, data.period.end, JSON.stringify(data), req.user.name])).rows[0];
      await audit(c, req, 'cbam.communication.create', 'cbam_communication', r.id, { title, copyFrom: b.copyFrom ?? null });
      return { id: r.id };
    });
  });

  app.post('/api/cbam/comms/import', { bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const q = z.object({ into: uuid.optional() }).parse(req.query);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'communication.xlsx')).slice(0, 200);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('Send the filled template (.xlsx)');
    let data: CommData;
    try { data = fromWorkbook(req.body); } catch (e) { throw new AppError((e as Error).message.startsWith('This is not') ? (e as Error).message : 'Could not read this file — send the CBAM communication template for installations as .xlsx'); }
    return tenantTx(tenant, async (c) => {
      if (q.into) {
        await load(c, q.into);
        await c.query(`UPDATE cbam_communication SET data = $2, period_start = $3, period_end = $4, updated_name = $5, updated_at = now() WHERE id = $1`, [q.into, JSON.stringify(data), data.period.start, data.period.end, req.user.name]);
        await audit(c, req, 'cbam.communication.import', 'cbam_communication', q.into, { file: filename });
        return { id: q.into };
      }
      const title = `${data.installation.name || 'Installation'} — ${quarterLabel(data.period.start, data.period.end) || 'imported'}`.slice(0, 200);
      const r = (await c.query(`INSERT INTO cbam_communication (tenant_id, title, period_start, period_end, data, created_name, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [tenant, title, data.period.start, data.period.end, JSON.stringify(data), req.user.name])).rows[0];
      await audit(c, req, 'cbam.communication.import', 'cbam_communication', r.id, { file: filename });
      return { id: r.id };
    });
  });


  app.get('/api/cbam/comms/summary', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2023).max(2100).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const installations = Number((await c.query(`SELECT count(*) AS n FROM cbam_installation`)).rows[0].n);
      return { ...(await yearSummary(c, q.year ?? new Date().getUTCFullYear())), registered: installations, can: { edit: canEdit(req) } };
    });
  });

  app.get('/api/cbam/comms/summary/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2023).max(2100) }).parse(req.query);
    const s = await tenantTx(tenant, async (c) => { const s = await yearSummary(c, q.year); await audit(c, req, 'cbam.summary.export', 'cbam_communication', null, { year: q.year }); return s; });
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const Q = [1, 2, 3, 4];
    const g = wb.addWorksheet('Goods by quarter');
    g.addRow(['Installation', 'CN code', 'Product', 'CN description', 'Unit', ...Q.flatMap((n) => [`Q${n} SEE direct`, `Q${n} SEE indirect`, `Q${n} SEE total`, `Q${n} default share`])]);
    for (const x of s.goods) g.addRow([x.installation, x.cn, x.name, x.cnName, x.unit, ...Q.flatMap((n) => { const v = x.q[n]; return v ? [v.seeDirect, v.seeIndirect, v.seeTotal, v.defaultShare] : [null, null, null, null]; })]);
    styleHeader(g, [24, 12, 24, 40, 10, ...Q.flatMap(() => [12, 12, 12, 12])]);
    g.eachRow((r, i) => { if (i > 1) for (let k = 6; k <= 21; k++) r.getCell(k).numFmt = (k - 6) % 4 === 3 ? '0.0%' : '0.0000'; });
    const e = wb.addWorksheet('Installation emissions');
    e.addRow(['Installation', ...Q.flatMap((n) => [`Q${n} direct tCO2e`, `Q${n} indirect tCO2e`]), 'Year direct tCO2e', 'Year indirect tCO2e']);
    for (const x of s.installations) {
      const d = Q.map((n) => x.emissions[n]?.direct ?? null), ind = Q.map((n) => x.emissions[n]?.indirect ?? null);
      e.addRow([x.name, ...Q.flatMap((_, k) => [d[k], ind[k]]), d.reduce<number>((a, b) => a + (b ?? 0), 0), ind.reduce<number>((a, b) => a + (b ?? 0), 0)]);
    }
    styleHeader(e, [28, ...Q.flatMap(() => [14, 14]), 16, 16]);
    e.eachRow((r, i) => { if (i > 1) for (let k = 2; k <= 11; k++) r.getCell(k).numFmt = '#,##0.000'; });
    const cm = wb.addWorksheet('Communications');
    cm.addRow(['Installation', 'Quarter', 'Title', 'Status', 'Problems to fix', 'Sent to', 'Updated', 'By']);
    for (const x of s.comms) cm.addRow([x.installation, `Q${x.quarter}`, x.title, x.status, x.errors, x.sentTo, x.updatedAt ? new Date(String(x.updatedAt)).toISOString().slice(0, 10) : '', x.updatedName]);
    styleHeader(cm, [28, 9, 36, 10, 14, 40, 12, 22]);
    const n = wb.addWorksheet('About');
    n.addRow([`CBAM annual summary ${q.year} — prepared with ${PRODUCT}`]).font = { bold: true, size: 13 };
    n.addRow(['Specific embedded emissions (SEE) per tonne of good (MWh for electricity), from the communications to importers whose reporting period starts in the year (the latest one of each quarter per installation).']);
    n.addRow(['Each quarter\'s full communication is the Commission\'s template, downloaded from the exporter portal.']);
    n.getColumn(1).width = 140;
    return sendWorkbook(reply, wb, `CBAM_summary_${q.year}.xlsx`);
  });

  app.get('/api/cbam/comms/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const installations = (await c.query(`SELECT id, name, country FROM cbam_installation ORDER BY name`)).rows;
      return { ...view(await load(c, id)), can: { edit: canEdit(req) }, installations };
    });
  });

  const putBody = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(STATUS).optional(),
    sentTo: z.string().trim().max(1000).optional(),
    installationId: uuid.nullable().optional(),
    data: z.unknown().optional(),
  });
  app.put('/api/cbam/comms/:id', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = putBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const cur = await load(c, id);
      const data = b.data === undefined ? normalise(cur.data) : normalise(b.data);
      if (b.status && b.status !== 'draft') {
        const errors = calculate(data).checks.filter((x) => x.level === 'error');
        if (errors.length) throw new AppError(`Fix ${errors.length} problem${errors.length === 1 ? '' : 's'} before marking it final — first: ${errors[0]?.msg}`);
      }
      // a title still named after a blank installation follows the name once it is entered
      const autoTitle = !b.title && /^Installation — /.test(cur.title) && data.installation.name ? `${data.installation.name} — ${cur.title.slice('Installation — '.length)}`.slice(0, 200) : null;
      if (autoTitle) b.title = autoTitle;
      await c.query(`UPDATE cbam_communication SET title = COALESCE($2, title), status = COALESCE($3, status), sent_to = COALESCE($4, sent_to),
                       installation_id = CASE WHEN $5::boolean THEN $6::uuid ELSE installation_id END, data = $7, period_start = $8, period_end = $9, updated_name = $10, updated_at = now() WHERE id = $1`,
        [id, b.title ?? null, b.status ?? null, b.sentTo ?? null, b.installationId !== undefined, b.installationId ?? null, JSON.stringify(data), data.period.start, data.period.end, req.user.name]);
      if (b.status && b.status !== cur.status) await audit(c, req, 'cbam.communication.status', 'cbam_communication', id, { from: cur.status, to: b.status });
      return view(await load(c, id));
    });
  });

  app.delete('/api/cbam/comms/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const cur = await load(c, id);
      await c.query(`DELETE FROM cbam_communication WHERE id = $1`, [id]);
      await audit(c, req, 'cbam.communication.delete', 'cbam_communication', id, { title: cur.title });
      return { ok: true };
    });
  });

  app.get('/api/cbam/comms/:id/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const r = await tenantTx(tenant, async (c) => {
      const r = await load(c, id);
      await audit(c, req, 'cbam.communication.export', 'cbam_communication', id, {});
      return r;
    });
    const data = normalise(r.data);
    const buf = buildWorkbook(data);
    const name = `CBAM_Communication_${fileSafe(data.installation.name || r.title)}_${fileSafe(quarterLabel(data.period.start, data.period.end) || 'period')}.xlsx`;
    return reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${name}"`).send(buf);
  });
}
