/**
 * The dedicated CBAM tool: importer dashboard, suppliers and their data requests, forecast, settings.
 *
 *   GET  /api/cbam/settings                     role (importer / exporter / both), EORI          PUT same
 *   GET  /api/cbam/importer/overview?year=      imports by CN code, product, origin and supplier; threshold; certificates
 *                                               to hold each quarter; deadlines; alerts
 *   GET  /api/cbam/suppliers                    with imports, requests and accepted values       POST · PUT/DELETE /:id
 *   GET  /api/cbam/requests?year=               POST (returns the access code once) · GET /:id · POST /:id/code · /remind
 *                                               · /withdraw · /message · POST /api/cbam/responses/:id/review
 *   POST /api/cbam/answer/lookup · /api/cbam/answer   answer another company's request from this account with a communication
 *   GET  /api/cbam/forecast?year=               base groups from the year's imports + saved assumptions   POST compute · PUT assumptions
 *   GET  /api/cbam/forecast/export              the forecast as Excel
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { cbamOnly } from '../lib/cbamAccess.js';
import { cnInfo, countsIndirect, type Sector } from '../lib/cbam.js';
import { HOLDING_SHARE, SALES_START, credibility, declarationDue, forecast, holding, threshold, type ForecastAssumptions, type ForecastGroup } from '../lib/cbamSuite.js';
import { normalise, sharedGoods, type SharedGoods } from '../lib/cbamComm.js';
import { imports, pick, priceOf, refs } from './cbam.routes.js';
import { appLink, queueEmail } from '../lib/mail.js';
import { notify } from '../lib/notify.js';
import { PRODUCT } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';

const EDIT = ['super_admin', 'admin', 'manager'] as const;
const uuid = z.string().uuid();
const idOf = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional().transform((v) => (v === '' || v === undefined ? null : v) as z.infer<T> | null);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => [...randomBytes(10)].map((x) => ABC[x % ABC.length]).join('');
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const CODE_DAYS = 60;
const r4 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const SUPPLIER_PAGE = '/cbam-supplier';

export async function settingsOf(c: Tx, tenant: string) {
  const r = (await c.query(`SELECT role, eori, assumptions FROM cbam_settings WHERE tenant_id = $1`, [tenant])).rows[0];
  return { role: (r?.role ?? 'both') as 'importer' | 'exporter' | 'both', eori: (r?.eori ?? null) as string | null, assumptions: (r?.assumptions ?? {}) as Partial<ForecastAssumptions> };
}

/** The supplier key of an import line: the linked supplier, or its name as typed. */
const lineSupplier = (x: { supplier_id?: string | null; supplier?: string | null }, names: Map<string, string>) => (x.supplier_id ? names.get(x.supplier_id) ?? x.supplier ?? '(unnamed)' : x.supplier || '(no supplier)');

async function overview(c: Tx, year: number) {
  const L = await imports(c, year);
  const R = await refs(c);
  const sup = (await c.query(`SELECT id, name FROM cbam_supplier`)).rows as { id: string; name: string }[];
  const names = new Map(sup.map((s) => [s.id, s.name]));
  const prices = [1, 2, 3, 4].map((q) => priceOf(R, year, q)?.value ?? null);
  type Agg = { key: string; label: string; sub?: string; lines: number; mass: number; embedded: number; certificates: number; cost: number; defaultMass: number; actualMass: number; problems: number };
  const agg = (k: (x: (typeof L)[number]) => [string, string, string?]) => {
    const m = new Map<string, Agg>();
    for (const x of L) {
      const [key, label, sub] = k(x);
      const a = m.get(key) ?? { key, label, sub, lines: 0, mass: 0, embedded: 0, certificates: 0, cost: 0, defaultMass: 0, actualMass: 0, problems: 0 };
      a.lines++; a.mass += x.mass; a.embedded += x.calc.embedded ?? 0; a.certificates += x.calc.certificates ?? 0; a.cost += x.calc.cost ?? 0;
      if (x.source === 'actual') a.actualMass += x.mass; else a.defaultMass += x.mass;
      if (x.calc.problems.length) a.problems++;
      m.set(key, a);
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost || b.embedded - a.embedded);
  };
  const totals = L.reduce((a, x) => ({ lines: a.lines + 1, mass: a.mass + x.mass, embedded: a.embedded + (x.calc.embedded ?? 0), faa: a.faa + x.calc.faa, certificates: a.certificates + (x.calc.certificates ?? 0), cost: a.cost + (x.calc.cost ?? 0),
    defaultMass: a.defaultMass + (x.source === 'default' ? x.mass : 0), problems: a.problems + (x.calc.problems.length ? 1 : 0) }), { lines: 0, mass: 0, embedded: 0, faa: 0, certificates: 0, cost: 0, defaultMass: 0, problems: 0 });
  const th = threshold({ year, lines: L.map((x) => ({ quarter: x.quarter, mass: x.mass, sector: x.sector as Sector })) });
  const hold = holding(L.map((x) => ({ quarter: x.quarter, certificates: th.exempt && x.sector !== 'electricity' && x.sector !== 'hydrogen' ? 0 : x.calc.certificates })), prices);
  // the cost of using default values: certificates on default lines vs what a supplier at the default value without mark-up would give
  const markupCost = L.filter((x) => x.source === 'default' && x.calc.see != null && x.calc.markup > 0 && x.calc.price).reduce((a, x) => a + x.mass * (x.calc.see! - x.calc.see! / (1 + x.calc.markup)) * x.calc.price!, 0);
  const reqs = (await c.query(`SELECT status, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM cbam_request WHERE year = $1 AND purpose = 'import'`, [year])).rows as { status: string; due_date: string | null }[];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = reqs.filter((r) => r.status === 'open' && r.due_date && r.due_date < today).length;
  const waiting = (await c.query(`SELECT count(*)::int AS n FROM cbam_response WHERE status = 'submitted'`)).rows[0].n as number;
  const alerts: { level: 'bad' | 'warn' | 'info'; msg: string; link?: string }[] = [];
  if (th.status === 'over') alerts.push({ level: 'bad', msg: th.message });
  else if (th.status === 'near') alerts.push({ level: 'warn', msg: th.message });
  if (waiting) alerts.push({ level: 'info', msg: `${waiting} supplier answer${waiting === 1 ? '' : 's'} to review`, link: '/cbam/suppliers?tab=requests' });
  if (overdue) alerts.push({ level: 'warn', msg: `${overdue} data request${overdue === 1 ? ' is' : 's are'} past the due date — send a reminder`, link: '/cbam/suppliers?tab=requests' });
  if (totals.problems) alerts.push({ level: 'warn', msg: `${totals.problems} import line${totals.problems === 1 ? ' has' : 's have'} problems (missing default value, benchmark or price)`, link: '/cbam/imports' });
  if (totals.mass && totals.defaultMass / totals.mass > 0.5 && markupCost > 0) alerts.push({ level: 'info', msg: `${Math.round(totals.defaultMass / totals.mass * 100)}% of the tonnes use default values; the mark-up alone costs about EUR ${Math.round(markupCost).toLocaleString('en-GB')} — ask those suppliers for actual data`, link: '/cbam/suppliers' });
  // unusual supplier values (actual lines far from the default)
  for (const x of L.filter((l) => l.source === 'actual')) {
    const dv = x.defaultUsed ?? null;
    const cr = credibility(x.see_direct == null ? null : Number(x.see_direct) + (countsIndirect(x.sector as Sector) ? Number(x.see_indirect ?? 0) : 0), dv);
    if (cr.level === 'low' || cr.level === 'high') { alerts.push({ level: 'warn', msg: `CN ${x.cn} from ${lineSupplier(x, names)}: ${cr.msg}`, link: '/cbam/imports' }); if (alerts.length > 12) break; }
  }
  return {
    year, totals: { ...totals, markupCost }, threshold: th, holding: hold, holdingShare: HOLDING_SHARE, prices,
    deadlines: { salesStart: SALES_START, declarationDue: declarationDue(year) },
    byCn: agg((x) => [x.cn, x.cn, x.description || x.categoryName || '']), byCategory: agg((x) => [x.category ?? 'other', x.categoryName ?? 'Not a CBAM good']),
    byOrigin: agg((x) => [x.origin, x.origin]), bySupplier: agg((x) => [x.supplier_id ?? `n:${(x.supplier ?? '').toLowerCase()}`, lineSupplier(x, names), x.supplier_id ? '' : 'not linked']),
    byQuarter: [1, 2, 3, 4].map((q) => { const xs = L.filter((x) => x.quarter === q); return { quarter: q, mass: xs.reduce((a, x) => a + x.mass, 0), embedded: xs.reduce((a, x) => a + (x.calc.embedded ?? 0), 0), cost: xs.reduce((a, x) => a + (x.calc.cost ?? 0), 0) }; }),
    alerts, requests: { open: reqs.filter((r) => r.status === 'open').length, answered: waiting, overdue },
  };
}

const supplierBody = z.object({
  kind: z.enum(['import', 'precursor']).default('import'), name: z.string().trim().min(2).max(200), country: opt(z.string().trim().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase())),
  installation: opt(z.string().trim().max(200)), registryId: opt(z.string().trim().max(80)), contactName: opt(z.string().trim().max(120)), contactEmail: opt(z.string().trim().email().max(190)),
  notes: z.string().trim().max(2000).default(''),
});

/** One request with its answers (and credibility of each value), messages and supplier. */
async function requestView(c: Tx, id: string) {
  const r = (await c.query(`SELECT q.*, s.name AS supplier, s.country AS supplier_country, s.installation AS supplier_installation FROM cbam_request q JOIN cbam_supplier s ON s.id = q.supplier_id WHERE q.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Data request');
  const raw = (await c.query(`SELECT * FROM cbam_response WHERE request_id = $1 ORDER BY submitted_at DESC`, [id])).rows;
  const R = await refs(c, [r.supplier_country, ...raw.map((x) => (x.data as SharedGoods).installation?.country ?? null)]);
  const responses = raw.map((x) => {
    const d = x.data as SharedGoods;
    const country = d.installation?.country || r.supplier_country || null;
    return { ...x, goods: (d.goods ?? []).map((g) => {
      const info = cnInfo(g.cn);
      const rel = g.seeDirect == null ? null : g.seeDirect + (info && countsIndirect(info.sector) ? g.seeIndirect ?? 0 : 0);
      const dv = pick(R, 'default', g.cn, country, r.year)?.value ?? null;
      return { ...g, inRequest: !r.cn_codes.length || r.cn_codes.some((cc: string) => g.cn.startsWith(cc) || cc.startsWith(g.cn)), relevant: rel, defaultValue: dv, check: credibility(rel, dv) };
    }) };
  });
  const messages = (await c.query(`SELECT side, author, body, at FROM cbam_request_message WHERE request_id = $1 ORDER BY at`, [id])).rows;
  const { code_hash: _h, ...rest } = r;
  return { request: { ...rest, hasCode: !!r.code_hash }, responses, messages };
}

function inviteText(company: string, req: { year: number; quarter: number | null; cn_codes: string[]; message: string; due_date: string | null }, code: string | null, email: string) {
  const link = appLink(SUPPLIER_PAGE);
  return [
    `${company} asks for the embedded emissions of the goods you supply, for ${req.quarter ? `Q${req.quarter} ` : ''}${req.year}, for their EU CBAM reporting.`,
    req.cn_codes.length ? `Goods (CN codes): ${req.cn_codes.join(', ')}` : '',
    req.message ? `\nMessage: ${req.message}` : '',
    req.due_date ? `Please answer by ${String(req.due_date).slice(0, 10)}.` : '',
    '',
    'How to answer (any one):',
    '  • Upload the EU "CBAM Communication template for installations" (Excel) you filled in,',
    '  • or fill in a short form with the specific embedded emissions per CN code,',
    `  • or, if you use ${PRODUCT} CBAM, send your communication from your account (Communications → Answer a request).`,
    '',
    link ? `Page: ${link}` : `Page: ${SUPPLIER_PAGE} on ${PRODUCT}`,
    `Sign in with: ${email}`,
    code ? `Access code: ${code}` : 'Your contact will give you the access code.',
  ].filter((x) => x !== '').join('\n');
}

export async function cbamSuiteRoutes(app: FastifyInstance) {
  cbamOnly(app);

  // ---------------------------------------------------------------- settings --
  app.get('/api/cbam/settings', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => ({ ...(await settingsOf(c, tenant)), can: { edit: canEdit(req) } }));
  });
  app.put('/api/cbam/settings', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const b = z.object({ role: z.enum(['importer', 'exporter', 'both']), eori: opt(z.string().trim().toUpperCase().regex(/^[A-Z]{2}[A-Z0-9]{1,15}$/, 'EORI: country code and up to 15 letters or digits')) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`INSERT INTO cbam_settings (tenant_id, role, eori, updated_name) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET role = $2, eori = $3, updated_name = $4, updated_at = now()`, [tenant, b.role, b.eori, req.user.name]);
      await audit(c, req, 'cbam.settings', 'cbam_settings', tenant, b);
      return settingsOf(c, tenant);
    });
  });

  // ---------------------------------------------------------------- importer --
  app.get('/api/cbam/importer/overview', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2026).max(2100).default(new Date().getUTCFullYear()) }).parse(req.query);
    return tenantTx(tenant, async (c) => ({ ...(await overview(c, q.year)), can: { edit: canEdit(req) } }));
  });

  // --------------------------------------------------------------- suppliers --
  app.get('/api/cbam/suppliers', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2023).max(2100).default(new Date().getUTCFullYear()) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const rows = (await c.query(`
        SELECT s.*,
               (SELECT coalesce(sum(mass), 0)::float8 FROM cbam_import i WHERE (i.supplier_id = s.id OR (i.supplier_id IS NULL AND lower(i.supplier) = lower(s.name))) AND i.year = $1) AS mass,
               (SELECT count(*)::int FROM cbam_import i WHERE (i.supplier_id = s.id OR (i.supplier_id IS NULL AND lower(i.supplier) = lower(s.name))) AND i.year = $1 AND i.source = 'default') AS default_lines,
               (SELECT count(*)::int FROM cbam_import i WHERE (i.supplier_id = s.id OR (i.supplier_id IS NULL AND lower(i.supplier) = lower(s.name))) AND i.year = $1) AS lines,
               (SELECT json_build_object('id', r.id, 'status', r.status, 'quarter', r.quarter, 'year', r.year, 'due', r.due_date) FROM cbam_request r WHERE r.supplier_id = s.id ORDER BY r.created_at DESC LIMIT 1) AS last_request,
               (SELECT count(*)::int FROM cbam_supplier_value v WHERE v.supplier_id = s.id) AS values
          FROM cbam_supplier s ORDER BY s.kind, s.name`, [q.year])).rows;
      // supplier names on import lines that are not yet a supplier record
      const loose = (await c.query(`SELECT supplier AS name, min(origin) AS country, sum(mass)::float8 AS mass, count(*)::int AS lines FROM cbam_import
                                     WHERE supplier_id IS NULL AND supplier IS NOT NULL AND year = $1 AND lower(supplier) NOT IN (SELECT lower(name) FROM cbam_supplier) GROUP BY supplier ORDER BY sum(mass) DESC`, [q.year])).rows;
      return { year: q.year, suppliers: rows, loose, can: { edit: canEdit(req) } };
    });
  });
  app.post('/api/cbam/suppliers', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = supplierBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO cbam_supplier (tenant_id, kind, name, country, installation, registry_id, contact_name, contact_email, notes, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, b.kind, b.name, b.country, b.installation, b.registryId, b.contactName, b.contactEmail, b.notes, req.user.name])).rows[0];
      // import lines typed with this supplier's name now point to it
      const linked = b.kind === 'import' ? (await c.query(`UPDATE cbam_import SET supplier_id = $1 WHERE supplier_id IS NULL AND lower(supplier) = lower($2)`, [r.id, b.name])).rowCount : 0;
      await audit(c, req, 'cbam.supplier.create', 'cbam_supplier', r.id, b);
      return { id: r.id, linked };
    });
  });
  app.put('/api/cbam/suppliers/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req), b = supplierBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE cbam_supplier SET kind = $2, name = $3, country = $4, installation = $5, registry_id = $6, contact_name = $7, contact_email = $8, notes = $9 WHERE id = $1`,
        [id, b.kind, b.name, b.country, b.installation, b.registryId, b.contactName, b.contactEmail, b.notes]);
      if (!r.rowCount) throw notFound('Supplier');
      await audit(c, req, 'cbam.supplier.update', 'cbam_supplier', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/cbam/suppliers/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM cbam_supplier WHERE id = $1 RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Supplier');
      await audit(c, req, 'cbam.supplier.delete', 'cbam_supplier', id, r.rows[0]);
      return { ok: true };
    });
  });
  app.get('/api/cbam/suppliers/:id/values', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => ({ values: (await c.query(`SELECT id, cn, year, quarter, see_direct::float8 AS see_direct, see_indirect::float8 AS see_indirect, default_share::float8 AS default_share, installation, registry_id, verified, accepted_name, accepted_at FROM cbam_supplier_value WHERE supplier_id = $1 ORDER BY year DESC, quarter DESC NULLS LAST, cn`, [id])).rows }));
  });

  // ---------------------------------------------------------------- requests --
  app.get('/api/cbam/requests', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2023).max(2100).optional(), purpose: z.enum(['import', 'precursor']).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => ({
      requests: (await c.query(`SELECT q.id, q.supplier_id, s.name AS supplier, s.country, q.purpose, q.year, q.quarter, q.cn_codes, q.due_date, q.status, q.contact_email, q.reminders, q.reminded_at, q.created_at, q.created_name, q.updated_at,
                                       q.code_hash IS NOT NULL AS has_code, q.code_expires,
                                       (SELECT count(*)::int FROM cbam_response x WHERE x.request_id = q.id) AS responses,
                                       (SELECT count(*)::int FROM cbam_response x WHERE x.request_id = q.id AND x.status = 'submitted') AS to_review
                                  FROM cbam_request q JOIN cbam_supplier s ON s.id = q.supplier_id
                                 WHERE ($1::int IS NULL OR q.year = $1) AND ($2::text IS NULL OR q.purpose = $2) ORDER BY q.created_at DESC`, [q.year ?? null, q.purpose ?? null])).rows,
      can: { edit: canEdit(req) },
    }));
  });
  app.post('/api/cbam/requests', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = z.object({
      supplierId: uuid, purpose: z.enum(['import', 'precursor']).default('import'), year: z.number().int().min(2023).max(2100), quarter: z.number().int().min(1).max(4).nullable().default(null),
      importId: uuid.nullable().optional(), cnCodes: z.array(z.string().trim().transform((s) => s.replace(/\D/g, '')).refine((s) => /^\d{4,8}$/.test(s), 'CN code of 4 to 8 digits')).max(50).default([]),
      message: z.string().trim().max(4000).default(''), dueDate: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), contactEmail: z.string().trim().toLowerCase().email().max(190).optional(), sendEmail: z.boolean().default(true),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query(`SELECT * FROM cbam_supplier WHERE id = $1`, [b.supplierId])).rows[0];
      if (!s) throw notFound('Supplier');
      const email = b.contactEmail ?? s.contact_email;
      if (!email) throw new AppError('Give the supplier contact\'s e-mail (on the supplier or here)');
      let cn = b.cnCodes;
      if (!cn.length && b.purpose === 'import') cn = (await c.query(`SELECT DISTINCT cn FROM cbam_import WHERE (supplier_id = $1 OR (supplier_id IS NULL AND lower(supplier) = lower($2))) AND year = $3 ${b.quarter ? 'AND quarter = $4' : ''} ORDER BY cn`,
        b.quarter ? [s.id, s.name, b.year, b.quarter] : [s.id, s.name, b.year])).rows.map((r) => r.cn);
      const code = newCode();
      const r = (await c.query(`INSERT INTO cbam_request (tenant_id, supplier_id, purpose, year, quarter, import_id, cn_codes, message, due_date, contact_email, code_hash, code_expires, created_name)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + make_interval(days => $12), $13) RETURNING *`,
        [tenant, s.id, b.purpose, b.year, b.quarter, b.importId ?? null, cn, b.message, b.dueDate, email, sha(code), CODE_DAYS, req.user.name])).rows[0];
      const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string;
      if (b.sendEmail) await queueEmail(c, tenant, email, `${company}: CBAM emissions data for ${b.quarter ? `Q${b.quarter} ` : ''}${b.year}`, inviteText(company, r, code, email));
      await audit(c, req, 'cbam.request.create', 'cbam_request', r.id, { supplier: s.name, year: b.year, quarter: b.quarter, cn, emailed: b.sendEmail });
      return { id: r.id, code, email, page: SUPPLIER_PAGE, emailed: b.sendEmail };
    });
  });
  app.get('/api/cbam/requests/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => ({ ...(await requestView(c, id)), can: { edit: canEdit(req) } }));
  });
  app.post('/api/cbam/requests/:id/code', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ sendEmail: z.boolean().default(false) }).parse(req.body ?? {});
    return tenantTx(tenant, async (c) => {
      const code = newCode();
      const r = (await c.query(`UPDATE cbam_request SET code_hash = $2, code_expires = now() + make_interval(days => $3), updated_at = now() WHERE id = $1 AND status IN ('open', 'answered', 'rejected') RETURNING *`, [id, sha(code), CODE_DAYS])).rows[0];
      if (!r) throw new AppError('This request is closed');
      await c.query(`DELETE FROM cbam_supplier_session WHERE request_id = $1`, [id]);
      if (b.sendEmail) { const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name; await queueEmail(c, tenant, r.contact_email, `${company}: new access code for CBAM data`, inviteText(company, r, code, r.contact_email)); }
      await audit(c, req, 'cbam.request.code', 'cbam_request', id, { emailed: b.sendEmail });
      return { code, email: r.contact_email };
    });
  });
  app.post('/api/cbam/requests/:id/remind', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`UPDATE cbam_request SET reminders = reminders + 1, reminded_at = now(), updated_at = now() WHERE id = $1 AND status IN ('open', 'rejected') RETURNING *`, [id])).rows[0];
      if (!r) throw new AppError('Only open requests can be reminded');
      const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name;
      await queueEmail(c, tenant, r.contact_email, `Reminder — ${company}: CBAM emissions data for ${r.quarter ? `Q${r.quarter} ` : ''}${r.year}`,
        `Reminder: we are still waiting for your CBAM emissions data.\n\n${inviteText(company, r, null, r.contact_email)}\n\nIf you lost the access code, reply to ask for a new one.`);
      await audit(c, req, 'cbam.request.remind', 'cbam_request', id, { reminders: r.reminders });
      return { ok: true, reminders: r.reminders };
    });
  });
  app.post('/api/cbam/requests/:id/withdraw', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE cbam_request SET status = 'withdrawn', code_hash = NULL, updated_at = now() WHERE id = $1 AND status <> 'accepted'`, [id]);
      if (!r.rowCount) throw new AppError('An accepted request cannot be withdrawn');
      await c.query(`DELETE FROM cbam_supplier_session WHERE request_id = $1`, [id]);
      await audit(c, req, 'cbam.request.withdraw', 'cbam_request', id, {});
      return { ok: true };
    });
  });
  app.post('/api/cbam/requests/:id/message', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ body: z.string().trim().min(1).max(4000), sendEmail: z.boolean().default(true) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT * FROM cbam_request WHERE id = $1`, [id])).rows[0];
      if (!r) throw notFound('Data request');
      await c.query(`INSERT INTO cbam_request_message (tenant_id, request_id, side, author, body) VALUES ($1,$2,'requester',$3,$4)`, [tenant, id, req.user.name, b.body]);
      if (b.sendEmail) { const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name; await queueEmail(c, tenant, r.contact_email, `${company}: message about your CBAM data`, `${req.user.name} (${company}) wrote:\n\n${b.body}\n\nAnswer on ${appLink(SUPPLIER_PAGE) ?? SUPPLIER_PAGE}.`); }
      return { ok: true };
    });
  });

  // Review an answer: accept (values kept per CN code and period; optionally applied to the import lines) or reject with a note.
  app.post('/api/cbam/responses/:id/review', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ decision: z.enum(['accept', 'reject']), note: z.string().trim().max(2000).default(''), apply: z.boolean().default(true), cn: z.array(z.string()).max(100).optional() }).parse(req.body);
    if (b.decision === 'reject' && !b.note) throw new AppError('Say why, so the supplier can correct it');
    return tenantTx(tenant, async (c) => {
      const x = (await c.query(`SELECT x.*, q.year, q.quarter, q.supplier_id, q.purpose, q.contact_email FROM cbam_response x JOIN cbam_request q ON q.id = x.request_id WHERE x.id = $1`, [id])).rows[0];
      if (!x) throw notFound('Answer');
      if (x.status !== 'submitted') throw new AppError('This answer was already reviewed');
      await c.query(`UPDATE cbam_response SET status = $2, review_note = $3, reviewed_name = $4, reviewed_at = now() WHERE id = $1`, [id, b.decision === 'accept' ? 'accepted' : 'rejected', b.note || null, req.user.name]);
      await c.query(`UPDATE cbam_request SET status = $2, updated_at = now() WHERE id = $1`, [x.request_id, b.decision === 'accept' ? 'accepted' : 'rejected']);
      let values = 0, lines = 0;
      if (b.decision === 'accept') {
        const d = x.data as SharedGoods;
        for (const g of d.goods ?? []) {
          if (g.seeDirect == null || !/^\d{4,8}$/.test(g.cn) || (b.cn && !b.cn.includes(g.cn))) continue;
          await c.query(`INSERT INTO cbam_supplier_value (tenant_id, supplier_id, response_id, cn, year, quarter, see_direct, see_indirect, default_share, installation, registry_id, verified, accepted_name)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [tenant, x.supplier_id, id, g.cn, x.year, x.quarter, r4(g.seeDirect), r4(g.seeIndirect ?? 0) ?? 0, g.defaultShare == null ? null : Math.min(1, Math.max(0, g.defaultShare)), d.installation?.name || null, d.installation?.registryId || null, !!d.verified, req.user.name]);
          values++;
          if (b.apply && x.purpose === 'import') {
            const sup = (await c.query(`SELECT name FROM cbam_supplier WHERE id = $1`, [x.supplier_id])).rows[0];
            const u = await c.query(`UPDATE cbam_import SET source = 'actual', see_direct = $1, see_indirect = $2, installation = COALESCE($3, installation), installation_id_reg = COALESCE($4, installation_id_reg), supplier_id = $5,
                                       verifier_ref = COALESCE(verifier_ref, $10)
                                     WHERE (supplier_id = $5 OR (supplier_id IS NULL AND lower(supplier) = lower($6))) AND year = $7 AND ($8::int IS NULL OR quarter = $8) AND (cn LIKE $9 || '%' OR $9 LIKE cn || '%')`,
              [r4(g.seeDirect), r4(g.seeIndirect ?? 0), d.installation?.name || null, d.installation?.registryId || null, x.supplier_id, sup?.name ?? '', x.year, x.quarter, g.cn, d.verified ? `Supplier communication accepted ${new Date().toISOString().slice(0, 10)}` : null]);
            lines += u.rowCount ?? 0;
          }
        }
      }
      const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name;
      await queueEmail(c, tenant, x.contact_email, `${company}: your CBAM data was ${b.decision === 'accept' ? 'accepted' : 'sent back'}`,
        b.decision === 'accept' ? `${company} accepted the emissions data you sent. Thank you.` : `${company} sent your emissions data back:\n\n${b.note}\n\nCorrect it and send again on ${appLink(SUPPLIER_PAGE) ?? SUPPLIER_PAGE}.`);
      await audit(c, req, `cbam.response.${b.decision}`, 'cbam_response', id, { values, lines, note: b.note });
      return { ok: true, values, lines };
    });
  });

  // An accepted precursor answer fills a purchased precursor of a communication (multi-tier: the exporter's own suppliers).
  app.post('/api/cbam/responses/:id/to-communication', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ commId: uuid, precursorId: z.string().max(40), cn: z.string().max(8).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const x = (await c.query(`SELECT x.data, x.status FROM cbam_response x WHERE x.id = $1`, [id])).rows[0];
      if (!x) throw notFound('Answer');
      if (x.status !== 'accepted') throw new AppError('Accept the answer first');
      const d = x.data as SharedGoods;
      const g = d.goods.find((y) => !b.cn || y.cn === b.cn) ?? null;
      if (!g || g.seeDirect == null) throw new AppError('The answer has no value for this good');
      const m = (await c.query(`SELECT data FROM cbam_communication WHERE id = $1`, [b.commId])).rows[0];
      if (!m) throw notFound('Communication');
      const data = normalise(m.data);
      const p = data.precursors.find((y) => y.id === b.precursorId);
      if (!p) throw notFound('Purchased precursor');
      p.seeDirect = r4(g.seeDirect); p.seeDirectSource = 'Measured';
      if (g.embeddedElec != null && g.embeddedElec > 0) { p.elecPerT = r4(g.embeddedElec); p.elecPerTSource = 'Measured'; p.elecEf = r4((g.seeIndirect ?? 0) / g.embeddedElec); p.elecEfSource = g.elecSource || 'Mix'; }
      if (d.installation?.country && !p.country) p.country = d.installation.country;
      await c.query(`UPDATE cbam_communication SET data = $2, updated_name = $3, updated_at = now() WHERE id = $1`, [b.commId, JSON.stringify(data), req.user.name]);
      await audit(c, req, 'cbam.response.to_communication', 'cbam_communication', b.commId, { response: id, precursor: p.name });
      return { ok: true, precursor: p.name };
    });
  });

  // ------------------------------------------------- answer from this account --
  const answerBody = z.object({ email: z.string().trim().toLowerCase().email().max(190), code: z.string().max(40) });
  async function findRequest(b: z.infer<typeof answerBody>) {
    const code = cleanCode(b.code);
    return platformTx(async (c) => {
      const rows = (await c.query(`SELECT q.*, t.name AS company, s.name AS supplier FROM cbam_request q JOIN tenant t ON t.id = q.tenant_id JOIN cbam_supplier s ON s.id = q.supplier_id
                                    WHERE lower(q.contact_email) = $1 AND q.code_hash IS NOT NULL AND q.status IN ('open', 'rejected', 'answered') AND t.status = 'active'`, [b.email])).rows;
      const h = Buffer.from(sha(code));
      const r = rows.find((x) => timingSafeEqual(Buffer.from(x.code_hash), h));
      if (!r || (r.code_expires && new Date(r.code_expires) < new Date())) throw new AppError('That e-mail and access code do not match an open request', 404, 'NOT_FOUND');
      return r;
    });
  }
  app.post('/api/cbam/answer/lookup', async (req) => {
    requireTenant(req);
    const r = await findRequest(answerBody.parse(req.body));
    return { company: r.company, year: r.year, quarter: r.quarter, cnCodes: r.cn_codes, message: r.message, dueDate: r.due_date, purpose: r.purpose };
  });
  app.post('/api/cbam/answer', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = answerBody.extend({ commId: uuid }).parse(req.body);
    const r = await findRequest(b);
    if (r.tenant_id === tenant) throw new AppError('This request is from your own company');
    const comm = await tenantTx(tenant, async (c) => (await c.query(`SELECT m.data, t.name AS company FROM cbam_communication m JOIN tenant t ON t.id = m.tenant_id WHERE m.id = $1`, [b.commId])).rows[0]);
    if (!comm) throw notFound('Communication');
    const shared = sharedGoods(normalise(comm.data));
    if (!shared.goods.length) throw new AppError('This communication has no goods with CN codes yet');
    return platformTx(async (c) => {
      const x = (await c.query(`INSERT INTO cbam_response (tenant_id, request_id, via, from_tenant, from_name, from_email, data) VALUES ($1,$2,'account',$3,$4,$5,$6) RETURNING id`,
        [r.tenant_id, r.id, tenant, `${req.user.name} (${comm.company})`, req.user.email, JSON.stringify(shared)])).rows[0];
      await c.query(`UPDATE cbam_request SET status = 'answered', updated_at = now() WHERE id = $1`, [r.id]);
      const staff = (await c.query(`SELECT id FROM app_user WHERE tenant_id = $1 AND role IN ('super_admin', 'admin', 'manager') AND NOT disabled`, [r.tenant_id])).rows.map((u) => u.id);
      await notify(c, r.tenant_id, staff, { kind: 'cbam', title: `CBAM data from ${r.supplier}`, body: `${comm.company} answered your request for ${r.quarter ? `Q${r.quarter} ` : ''}${r.year}: ${shared.goods.length} good(s). Review and accept.`, link: `/cbam/suppliers?tab=requests&request=${r.id}` });
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,'cbam.answer.sent','cbam_request',$4,$5,$6)`,
        [tenant, req.user.id, req.user.name, r.id, JSON.stringify({ to: r.company, goods: shared.goods.length }), req.ip]);
      return { id: x.id, company: r.company };
    });
  });

  // ---------------------------------------------------------------- forecast --
  async function baseGroups(c: Tx, year: number): Promise<ForecastGroup[]> {
    const L = await imports(c, year);
    const sup = new Map(((await c.query(`SELECT id, name FROM cbam_supplier`)).rows as { id: string; name: string }[]).map((s) => [s.id, s.name]));
    const m = new Map<string, ForecastGroup & { seeSum: number; seeMass: number }>();
    for (const x of L) {
      if (!cnInfo(x.cn)) continue;
      const supplier = lineSupplier(x, sup);
      const key = `${x.cn}|${x.origin}|${supplier}`;
      const g = m.get(key) ?? { key, label: `${x.cn} · ${x.origin} · ${supplier}`, cn: x.cn, origin: x.origin, supplier, sector: x.sector as Sector, mass: 0, seeActual: null, defaultValue: x.defaultUsed ?? null, benchmark: x.benchmarkUsed ?? null, carbonPriceEur: null, seeSum: 0, seeMass: 0 };
      g.mass += x.mass;
      if (x.source === 'actual' && x.see_direct != null) { const rel = Number(x.see_direct) + (countsIndirect(x.sector as Sector) ? Number(x.see_indirect ?? 0) : 0); g.seeSum += rel * x.mass; g.seeMass += x.mass; }
      if (x.carbon_price_eur != null) g.carbonPriceEur = Number(x.carbon_price_eur);
      m.set(key, g);
    }
    return [...m.values()].map(({ seeSum, seeMass, ...g }) => ({ ...g, seeActual: seeMass > 0 ? seeSum / seeMass : null }));
  }
  const assumptionsBody = z.object({
    from: z.number().int().min(2026).max(2050), to: z.number().int().min(2026).max(2050), price: z.number().min(0).max(10000), priceGrowth: z.number().min(-0.5).max(1),
    volumeGrowth: z.number().min(-0.9).max(5), basis: z.enum(['actual', 'default']), switches: z.array(z.object({ key: z.string().max(400), see: z.number().min(0).max(100) })).max(200).default([]),
  });
  const defaults = (year: number, price: number | null): ForecastAssumptions => ({ from: Math.max(2026, year), to: 2034, price: price ?? 80, priceGrowth: 0.03, volumeGrowth: 0, basis: 'actual', switches: [] });
  app.get('/api/cbam/forecast', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2026).max(2100).default(new Date().getUTCFullYear()) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const groups = await baseGroups(c, q.year);
      const R = await refs(c);
      const lastPrice = [4, 3, 2, 1].map((qq) => priceOf(R, q.year, qq)?.value).find((v) => v != null) ?? [4, 3, 2, 1].map((qq) => priceOf(R, q.year - 1, qq)?.value).find((v) => v != null) ?? null;
      const saved = (await settingsOf(c, tenant)).assumptions;
      const a = { ...defaults(q.year, lastPrice), ...saved, from: Math.max(2026, q.year) } as ForecastAssumptions;
      return { year: q.year, groups, assumptions: a, lastPrice, result: forecast(groups, a), can: { edit: canEdit(req) } };
    });
  });
  app.post('/api/cbam/forecast', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ year: z.number().int().min(2026).max(2100), assumptions: assumptionsBody }).parse(req.body);
    return tenantTx(tenant, async (c) => ({ result: forecast(await baseGroups(c, b.year), b.assumptions) }));
  });
  app.put('/api/cbam/forecast/assumptions', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const a = assumptionsBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`INSERT INTO cbam_settings (tenant_id, assumptions, updated_name) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET assumptions = $2, updated_name = $3, updated_at = now()`, [tenant, JSON.stringify(a), req.user.name]);
      return { ok: true };
    });
  });
  app.post('/api/cbam/forecast/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const b = z.object({ year: z.number().int().min(2026).max(2100), assumptions: assumptionsBody }).parse(req.body);
    const groups = await tenantTx(tenant, (c) => baseGroups(c, b.year));
    const f = forecast(groups, b.assumptions);
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const y = wb.addWorksheet('By year');
    y.addRow(['Year', 'CBAM factor', 'Certificate price (EUR)', 'Tonnes', 'Embedded emissions (tCO2e)', 'Free allocation adjustment (tCO2e)', 'Certificates', 'Cost (EUR)', 'Tonnes without a value']);
    for (const r of f.years) y.addRow([r.year, r.cbamFactor, Math.round(r.price * 100) / 100, Math.round(r.mass), Math.round(r.embedded), Math.round(r.faa), Math.round(r.certificates), Math.round(r.cost), Math.round(r.missing)]);
    styleHeader(y, [8, 12, 18, 12, 22, 24, 14, 14, 18]);
    const g = wb.addWorksheet('By supplier and CN');
    g.addRow(['CN · origin · supplier', ...f.years.map((r) => `${r.year} cost (EUR)`), 'Total']);
    for (const x of f.groups) g.addRow([x.label, ...x.cost.map((v) => Math.round(v)), Math.round(x.total)]);
    styleHeader(g, [40, ...f.years.map(() => 14), 14]);
    const a = wb.addWorksheet('Assumptions');
    for (const [k, v] of [['Base year (imports)', b.year], ['From', b.assumptions.from], ['To', b.assumptions.to], ['Certificate price, first year (EUR)', b.assumptions.price], ['Price change per year', b.assumptions.priceGrowth], ['Tonnes change per year', b.assumptions.volumeGrowth],
      ['Emissions', b.assumptions.basis === 'actual' ? 'Actual values where suppliers gave them, default values (with mark-up) otherwise' : 'Default values with mark-up everywhere'], ['Supplier switches', b.assumptions.switches.map((s) => `${s.key} → ${s.see} tCO2e/t`).join('; ') || 'none'],
      ['Rules', 'Free allocation adjustment = CBAM benchmark × CBAM factor of the year (0 from 2034); default values with the mark-up of the year; estimate only.']] as [string, unknown][]) a.addRow([k, v]);
    a.getColumn(1).width = 34; a.getColumn(2).width = 100;
    return sendWorkbook(reply, wb, `CBAM forecast ${b.assumptions.from}-${b.assumptions.to}.xlsx`);
  });
}
