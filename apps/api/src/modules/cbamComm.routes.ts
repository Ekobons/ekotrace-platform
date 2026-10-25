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
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
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

export async function cbamCommRoutes(app: FastifyInstance) {
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
