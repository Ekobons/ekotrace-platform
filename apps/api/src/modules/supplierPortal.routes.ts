/**
 * Supplier portal (Value chain · RFP 8.4).
 *
 * The company invites a supplier's contact to report for a year. The contact signs in at /supplier with their work
 * e-mail and an access code (shown once to the company, optionally e-mailed with the invitation; stored only as a
 * hash; expires; can be replaced or removed). Sessions last 8 hours (header x-supplier-token). The supplier answers:
 *   profile · emissions inventory (Scope 1, 2, 3, revenue, verification) · share relating to the customer ·
 *   climate targets · product carbon footprints · evidence files · declaration, then submits.
 * The company reviews: Accept updates the supplier's profile and turns the chosen figures into supplier-specific
 * factors (company intensity per currency unit, product footprints), and purchases from the supplier are
 * recalculated; Query sends it back with a note. Nothing the supplier sends changes the inventory by itself.
 *
 * Staff:   GET /api/supplier-portal?year · POST /api/supplier-portal/requests · GET /api/supplier-portal/requests/:id
 *          POST /api/supplier-portal/requests/:id/code · /revoke · /review · GET /api/supplier-portal/documents/:id
 * Public:  POST /api/public/supplier/login · /logout · GET /api/public/supplier/me · PUT /api/public/supplier/answers
 *          POST /api/public/supplier/evidence · DELETE /api/public/supplier/evidence/:id · POST /api/public/supplier/submit
 */
import { INDUSTRIES, TOPICS } from '../lib/esg.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { sealFile, openFile } from '../lib/secrets.js';
import { notify } from '../lib/notify.js';
import { appLink, queueEmail } from '../lib/mail.js';
import { PRODUCT } from '../lib/brand.js';
import { recalcSupplier } from './purchases/suppliers.routes.js';
import { supplierScore } from '../lib/supplierScore.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...randomBytes(10)].map((x) => ABC[x % ABC.length]).join('');
const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const SESSION_H = 8;
const MANAGE = ['super_admin', 'admin', 'manager'] as const;

const hits = new Map<string, { at: number; n: number }>();
function limit(key: string, max: number) {
  const now = Date.now(), w = hits.get(key);
  if (!w || now - w.at > 60_000) { hits.set(key, { at: now, n: 1 }); return; }
  if (++w.n > max) throw new AppError('Too many tries: wait a minute and try again', 429, 'RATE_LIMITED');
}

// ------------------------------------------------------------------ answers --
const num = z.number().finite().min(0).max(1e12).nullable().optional();
const txt = (n = 300) => z.string().trim().max(n).nullable().optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
export const SECTIONS = {
  profile: z.object({
    legalName: txt(200), country: txt(80), trn: txt(40), website: txt(200), industry: txt(120), size: z.enum(['micro', 'small', 'medium', 'large']).nullable().optional(),
    employees: z.number().int().min(0).max(10_000_000).nullable().optional(), contactName: txt(120), contactRole: txt(120), phone: txt(40),
  }),
  inventory: z.object({
    reports: z.enum(['yes', 'partial', 'no']).nullable().optional(), scope1: num, scope2Location: num, scope2Market: num, scope3: num, scope3Categories: txt(400),
    boundary: z.enum(['operational', 'financial', 'equity']).nullable().optional(), standard: txt(120), verification: z.enum(['none', 'limited', 'reasonable']).nullable().optional(),
    verifier: txt(200), revenue: num, currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(), notes: txt(2000),
  }),
  allocation: z.object({ method: z.enum(['revenue', 'direct', 'none']).nullable().optional(), customerRevenue: num, directT: num, notes: txt(2000) }),
  targets: z.object({
    status: z.enum(['sbti_validated', 'sbti_committed', 'own', 'none']).nullable().optional(), baseYear: z.number().int().min(1990).max(2100).nullable().optional(),
    targetYear: z.number().int().min(2000).max(2100).nullable().optional(), reductionPct: z.number().min(0).max(100).nullable().optional(), scopes: txt(120),
    netZeroYear: z.number().int().min(2020).max(2100).nullable().optional(), link: txt(400),
  }),
  products: z.object({
    none: z.boolean().optional(),
    items: z.array(z.object({
      name: z.string().trim().min(1).max(200), description: txt(400), co2e: z.number().finite().min(0).max(1e9), unit: z.string().trim().min(1).max(10),
      standard: txt(80), boundary: z.enum(['cradle-to-gate', 'cradle-to-grave', 'gate-to-gate']).nullable().optional(), validFrom: date, validTo: date,
      verified: z.boolean().optional(), documentId: z.string().uuid().nullable().optional(),
    })).max(50).optional(),
  }),
  /** ESG impact — double materiality from the supplier's side: how its own operations affect each topic (impact) and how
   *  each topic affects its business (financial), 0 = not relevant … 5 = very high; plus a few ESG facts. Optional. */
  esg: z.object({
    industry: txt(40),
    topics: z.array(z.object({ topic: z.string().regex(/^[ESG][1-5]$/), impact: z.number().int().min(0).max(5).nullable().optional(), financial: z.number().int().min(0).max(5).nullable().optional(), note: txt(600) })).max(10).optional(),
    facts: z.object({
      iso14001: z.boolean().nullable().optional(), iso45001: z.boolean().nullable().optional(), codeOfConduct: z.boolean().nullable().optional(), humanRights: z.boolean().nullable().optional(),
      antiCorruption: z.boolean().nullable().optional(), whistleblowing: z.boolean().nullable().optional(), womenPct: z.number().min(0).max(100).nullable().optional(),
      ltifr: num, fatalities: z.number().int().min(0).max(100000).nullable().optional(), renewablePct: z.number().min(0).max(100).nullable().optional(),
      waterM3: num, wasteT: num, recycledPct: z.number().min(0).max(100).nullable().optional(), report: txt(400),
    }).optional(),
  }),
};
type Answers = { [K in keyof typeof SECTIONS]?: z.infer<(typeof SECTIONS)[K]> } & { declaration?: { name: string; title: string; at: string } };

/** What follows from the answers: the supplier's intensity and the emissions relating to the customer. */
export function derived(a: Answers) {
  const inv = a.inventory ?? {}, al = a.allocation ?? {};
  const s12 = inv.scope1 != null && (inv.scope2Market != null || inv.scope2Location != null) ? inv.scope1 + (inv.scope2Market ?? inv.scope2Location ?? 0) : null;
  const intensity = s12 != null && inv.revenue ? (s12 * 1000) / inv.revenue : null;                     // kg CO2e per currency unit of revenue
  const allocated = al.method === 'direct' ? al.directT ?? null : al.method === 'revenue' && s12 != null && inv.revenue && al.customerRevenue != null ? (s12 * al.customerRevenue) / inv.revenue : null;
  return { s12, intensity, currency: inv.currency ?? null, allocated, share: inv.revenue && al.customerRevenue != null ? al.customerRevenue / inv.revenue : null };
}

/** Answers that contradict each other: the share for the customer is part of the supplier's own figures. */
export function conflicts(a: Answers, customer = 'us'): string[] {
  const inv = a.inventory ?? {}, al = a.allocation ?? {}, out: string[] = [];
  const f = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const s2 = Math.max(inv.scope2Location ?? 0, inv.scope2Market ?? 0);
  const s12 = inv.scope1 != null && (inv.scope2Location != null || inv.scope2Market != null) ? inv.scope1 + s2 : null;
  if (al.method === 'direct' && al.directT != null && s12 != null && al.directT > s12 * 1.0001)
    out.push(`The emissions relating to ${customer} (${f(al.directT)} tCO₂e) are more than your whole company's Scope 1 + 2 (${f(s12)} tCO₂e). The share for ${customer} is part of your own emissions: check both figures and their units (tonnes, not kg).`);
  if (al.method === 'revenue' && al.customerRevenue != null && inv.revenue && al.customerRevenue > inv.revenue * 1.0001)
    out.push(`Your sales to ${customer} (${f(al.customerRevenue)} ${inv.currency ?? ''}) are more than your total revenue (${f(inv.revenue)} ${inv.currency ?? ''}). Check both figures and the currency.`);
  if (inv.scope2Location != null && inv.scope2Market != null && inv.scope2Location === 0 && inv.scope2Market > 0) { /* possible (market-based above zero grid) — not an error */ }
  return out;
}

/** Which sections are complete (for the progress bar and to submit). */
export function completeness(a: Answers) {
  const p = a.profile ?? {}, inv = a.inventory ?? {}, al = a.allocation ?? {}, t = a.targets ?? {}, pr = a.products ?? {};
  const done = {
    profile: !!(p.legalName && p.country && p.contactName),
    inventory: inv.reports === 'no' || !!(inv.reports && inv.scope1 != null && (inv.scope2Location != null || inv.scope2Market != null) && inv.revenue && inv.currency),
    allocation: al.method === 'none' || (al.method === 'direct' && al.directT != null) || (al.method === 'revenue' && al.customerRevenue != null) || inv.reports === 'no',
    targets: !!t.status,
    products: !!pr.none || !!pr.items?.length,
  };
  // the ESG impact section is optional: shown as done when filled, not needed to submit
  const esg = !!(a.esg?.topics?.filter((x) => x.impact != null).length);
  return { done, n: Object.values(done).filter(Boolean).length, of: Object.keys(done).length, esg };
}

const STATUS_TEXT: Record<string, string> = { invited: 'Invited', in_progress: 'In progress', submitted: 'Submitted', queried: 'Queried', accepted: 'Accepted' };

// ------------------------------------------------------------------ session --
async function session(req: FastifyRequest) {
  const tok = String(req.headers['x-supplier-token'] ?? '');
  if (!/^[a-f0-9]{64}$/.test(tok)) throw new AppError('Sign in again', 401, 'UNAUTHENTICATED');
  return platformTx(async (c) => {
    const s = (await c.query(`SELECT s.tenant_id, r.id, r.contact_name, r.email, r.revoked, r.expires_at, p.name AS supplier, p.id AS supplier_id
                                FROM supplier_session s JOIN supplier_request r ON r.id = s.request_id JOIN supplier p ON p.id = r.supplier_id
                               WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(tok)])).rows[0];
    if (!s || s.revoked || (s.expires_at && new Date(s.expires_at) < new Date(new Date().toDateString()))) throw new AppError('Sign in again', 401, 'UNAUTHENTICATED');
    return { tenant: s.tenant_id as string, id: s.id as string, supplierId: s.supplier_id as string, name: `${s.contact_name || s.email} (supplier: ${s.supplier})` };
  });
}
const log = (c: Tx, k: { tenant: string; name: string }, action: string, entityId: string | null, detail: unknown, ip: string) =>
  c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1, NULL, $2, $3, 'supplier_request', $4, $5, $6)`,
    [k.tenant, k.name, action, entityId, JSON.stringify(detail), ip]);

/** The invitation e-mail (with the code) — queued; sent when a mail server is set up. */
async function invite(c: Tx, tenant: string, r: { email: string; contact_name: string | null; year: number; message: string; due_date: string | null; expires_at: string }, supplier: string, code: string) {
  const co = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string;
  const link = appLink('/supplier');
  const due = r.due_date ? new Date(r.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  await queueEmail(c, tenant, r.email, `${co}: please share your ${r.year} emissions data`,
    `Dear ${r.contact_name || 'colleague'},\n\n${co} invites ${supplier} to share its greenhouse-gas emissions data for ${r.year} through the ${PRODUCT} supplier portal.${due ? ` Please submit by ${due}.` : ''}\n\n${r.message ? `${r.message}\n\n` : ''}Sign in: ${link ?? 'the supplier portal (/supplier) of your contact\'s platform'}\nWork e-mail: ${r.email}\nAccess code: ${code}\n\nThe code is personal and valid until ${new Date(r.expires_at).toLocaleDateString('en-GB')}. You can save your answers and come back at any time before you submit.\n`);
}

// ------------------------------------------------------------------ staff --
export async function supplierPortalRoutes(app: FastifyInstance) {
  app.get('/api/supplier-portal', async (req) => {
    const tenant = requireTenant(req);
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear() - 1) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const requests = (await c.query(
        `SELECT r.id, r.supplier_id, s.name AS supplier, s.country, r.year, r.contact_name, r.email, r.due_date, r.expires_at, r.revoked, r.status, r.answers, r.submitted_at, r.reviewed_by, r.reviewed_at,
                r.review_note, r.last_used_at, r.created_by, r.created_at, r.code_hash IS NOT NULL AS has_code, jsonb_array_length(r.documents)::int AS documents,
                coalesce(e.kg, 0)::float8 AS kg, coalesce(e.usd, 0)::float8 AS usd
           FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id
           LEFT JOIN LATERAL (SELECT sum(l.co2e) AS kg, sum(l.usd) AS usd FROM purchase_line l WHERE l.supplier_id = r.supplier_id AND l.status IN ('published', 'ready', 'check')
                                AND extract(year FROM coalesce(l.purchase_date, l.period_start)) = r.year) e ON true
          WHERE r.year = $1 ORDER BY (r.status = 'submitted') DESC, s.name`, [year])).rows
        .map(({ answers, ...r }) => ({ ...r, progress: completeness(answers), derived: derived(answers) }));
      // the largest suppliers of the year not invited yet: where engagement pays off most
      const suggest = (await c.query(
        `SELECT s.id, s.name, s.country, s.contact_email, sum(l.co2e)::float8 AS kg, sum(l.usd)::float8 AS usd,
                EXISTS (SELECT 1 FROM supplier_ef e WHERE e.supplier_id = s.id) AS has_factor
           FROM purchase_line l JOIN supplier s ON s.id = l.supplier_id
          WHERE l.status IN ('published', 'ready', 'check') AND extract(year FROM coalesce(l.purchase_date, l.period_start)) = $1
            AND NOT EXISTS (SELECT 1 FROM supplier_request r WHERE r.supplier_id = s.id AND r.year = $1)
          GROUP BY s.id ORDER BY sum(l.co2e) DESC NULLS LAST LIMIT 15`, [year])).rows;
      const total = Number((await c.query(`SELECT coalesce(sum(co2e), 0)::float8 AS kg FROM purchase_line WHERE status IN ('published', 'ready', 'check') AND extract(year FROM coalesce(purchase_date, period_start)) = $1`, [year])).rows[0].kg);
      return { year, requests, suggest, totalKg: total, statusText: STATUS_TEXT, canManage: (MANAGE as readonly string[]).includes(req.user.role) || req.user.role === 'platform_admin' };
    });
  });

  app.post('/api/supplier-portal/requests', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const b = z.object({
      supplierId: z.string().uuid(), year: z.number().int().min(2000).max(2100), email: z.string().trim().toLowerCase().email().max(200), contactName: z.string().trim().max(120).default(''),
      message: z.string().trim().max(2000).default(''), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), months: z.number().int().min(1).max(24).default(6), sendEmail: z.boolean().default(true),
      shareEstimate: z.boolean().default(false),
    }).parse(req.body);
    const code = newCode();
    return tenantTx(tenant, async (c) => {
      const s = (await c.query(`SELECT id, name, contact_email FROM supplier WHERE id = $1`, [b.supplierId])).rows[0];
      if (!s) throw notFound('Supplier');
      if ((await c.query(`SELECT 1 FROM supplier_request WHERE supplier_id = $1 AND year = $2`, [b.supplierId, b.year])).rowCount) throw new AppError(`${s.name} is already invited for ${b.year}: give a new code instead`, 409, 'EXISTS');
      const r = (await c.query(
        `INSERT INTO supplier_request (tenant_id, supplier_id, year, contact_name, email, message, due_date, code_hash, expires_at, created_by, share_estimate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(current_date + make_interval(months => $9))::date,$10,$11) RETURNING id, email, contact_name, year, message, due_date, expires_at`,
        [tenant, b.supplierId, b.year, b.contactName || null, b.email, b.message, b.dueDate, sha(code), b.months, req.user.name, b.shareEstimate])).rows[0];
      if (!s.contact_email) await c.query(`UPDATE supplier SET contact_email = $2, contact_name = coalesce(contact_name, $3), updated_at = now() WHERE id = $1`, [s.id, b.email, b.contactName || null]);
      if (b.sendEmail) await invite(c, tenant, r, s.name, code);
      await audit(c, req, 'supplier_portal.invite', 'supplier_request', r.id, { supplier: s.name, year: b.year, email: b.email, emailed: b.sendEmail });
      return { id: r.id, code, expiresAt: r.expires_at, emailed: b.sendEmail };
    });
  });

  app.get('/api/supplier-portal/requests/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT r.*, s.name AS supplier, s.country AS supplier_country, s.climate_target, s.reports_emissions FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id WHERE r.id = $1`, [id])).rows[0];
      if (!r) throw notFound('Request');
      const { code_hash: _h, ...rest } = r;
      const factors = (await c.query(`SELECT e.id, e.co2e::float8 AS co2e, e.unit, e.item_id, i.name AS item, e.valid_from, e.valid_to, e.source, e.request_id FROM supplier_ef e LEFT JOIN item i ON i.id = e.item_id
                                       WHERE e.supplier_id = $1 ORDER BY e.created_at DESC`, [r.supplier_id])).rows;
      return { ...rest, has_code: !!r.code_hash, progress: completeness(r.answers), derived: derived(r.answers), issues: conflicts(r.answers, 'you'), factors, canManage: (MANAGE as readonly string[]).includes(req.user.role) };
    });
  });

  app.post('/api/supplier-portal/requests/:id/code', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ months: z.number().int().min(1).max(24).default(6), sendEmail: z.boolean().default(true) }).parse(req.body ?? {});
    const code = newCode();
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`UPDATE supplier_request SET code_hash = $2, revoked = false, expires_at = (current_date + make_interval(months => $3))::date, updated_at = now() WHERE id = $1
                                RETURNING id, email, contact_name, year, message, due_date, expires_at, supplier_id`, [id, sha(code), b.months])).rows[0];
      if (!r) throw notFound('Request');
      await c.query('DELETE FROM supplier_session WHERE request_id = $1', [id]);
      if (b.sendEmail) await invite(c, tenant, r, (await c.query(`SELECT name FROM supplier WHERE id = $1`, [r.supplier_id])).rows[0].name, code);
      await audit(c, req, 'supplier_portal.code', 'supplier_request', id, { emailed: b.sendEmail });
      return { code, expiresAt: r.expires_at, emailed: b.sendEmail };
    });
  });

  app.post('/api/supplier-portal/requests/:id/revoke', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('UPDATE supplier_request SET revoked = true, code_hash = NULL, updated_at = now() WHERE id = $1', [id])).rowCount) throw notFound('Request');
      await c.query('DELETE FROM supplier_session WHERE request_id = $1', [id]);
      await audit(c, req, 'supplier_portal.revoke', 'supplier_request', id);
      return { ok: true };
    });
  });

  /**
   * Accept (apply the profile and the chosen factors; recalculate the supplier's open purchase lines) or query (back
   * to the supplier with a note). Company staff only — platform staff do not decide company data.
   */
  app.post('/api/supplier-portal/requests/:id/review', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    if (req.user.role === 'platform_admin') throw forbidden('Supplier answers are accepted by the company\'s staff, not platform staff');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({
      decision: z.enum(['accept', 'query']), note: z.string().trim().max(2000).optional(), profile: z.boolean().default(true),
      intensity: z.object({ use: z.boolean(), itemId: z.number().int().positive().nullable().default(null) }).default({ use: false, itemId: null }),
      products: z.array(z.object({ index: z.number().int().min(0).max(49), itemId: z.number().int().positive().nullable().default(null) })).max(50).default([]),
    }).parse(req.body);
    if (b.decision === 'query' && !b.note) throw new AppError('Say what the supplier should check or add');
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT r.*, s.name AS supplier FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id WHERE r.id = $1 FOR UPDATE OF r`, [id])).rows[0];
      if (!r) throw notFound('Request');
      if (r.status !== 'submitted') throw new AppError('Only submitted answers can be reviewed', 409, 'NOT_SUBMITTED');
      const a = r.answers as Answers;
      if (b.decision === 'accept' && conflicts(a).length) throw new AppError(`These answers contradict each other — query them instead: ${conflicts(a, 'you')[0]}`, 400, 'INCONSISTENT');
      if (b.decision === 'query') {
        await c.query(`UPDATE supplier_request SET status = 'queried', review_note = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1`, [id, b.note, req.user.name]);
        await queueEmail(c, tenant, r.email, `Please check your ${r.year} emissions data`, `Dear ${r.contact_name || 'colleague'},\n\nWe reviewed your answers and ask you to check the following:\n\n${b.note}\n\nSign in again to update and resubmit${appLink('/supplier') ? `: ${appLink('/supplier')}` : ''}.\n`);
        await audit(c, req, 'supplier_portal.query', 'supplier_request', id, { note: b.note });
        return { status: 'queried' };
      }
      const applied: { profile: string[]; factors: { id: string; kind: string; co2e: number; unit: string }[] } = { profile: [], factors: [] };
      if (b.profile) {
        const p = a.profile ?? {}, inv = a.inventory ?? {}, t = a.targets ?? {};
        const set: Record<string, unknown> = {};
        if (p.country) { const cc = p.country.trim(); set.country = /^[A-Za-z]{2}$/.test(cc) ? cc.toUpperCase() : null; if (!set.country) delete set.country; }
        if (p.trn) set.trn = p.trn; if (p.website) set.website = p.website; if (p.industry) set.industry = p.industry; if (p.size) set.size = p.size;
        if (p.contactName) set.contact_name = p.contactName;
        if (inv.reports) set.reports_emissions = inv.reports === 'no' ? 'no' : 'yes';
        if (t.status) set.climate_target = t.status;
        if (t.status && t.status !== 'none' && (t.reductionPct != null || t.netZeroYear != null)) set.target = JSON.stringify({ reductionPct: t.reductionPct ?? null, baseYear: t.baseYear ?? null, targetYear: t.targetYear ?? null, netZeroYear: t.netZeroYear ?? null, scopes: t.scopes ?? null, source: `Supplier portal ${r.year}` });
        const keys = Object.keys(set);
        if (keys.length) await c.query(`UPDATE supplier SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [r.supplier_id, ...keys.map((k) => set[k])]);
        applied.profile = keys;
      }
      const unitOf = async (u: string) => (await c.query(`SELECT code, dimension FROM unit WHERE code = $1 OR $1 = ANY(aliases)`, [u])).rows[0] as { code: string; dimension: string } | undefined;
      const addEf = async (kind: string, itemId: number | null, co2e: number, unit: string, priceYear: number | null, from: string, to: string, source: string, boundary: string | null) => {
        const u = await unitOf(unit);
        if (!u) throw new AppError(`Unit "${unit}" is not known: correct it or query the supplier`);
        if (itemId && !(await c.query(`SELECT 1 FROM item WHERE id = $1`, [itemId])).rowCount) throw notFound('Spend category');
        const e = (await c.query(`INSERT INTO supplier_ef (tenant_id, supplier_id, item_id, co2e, unit, price_year, valid_from, valid_to, source, boundary, created_by, request_id)
                                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [tenant, r.supplier_id, itemId, co2e, u.code, u.dimension.startsWith('money_') ? priceYear : null, from, to, source, boundary, req.user.id, id])).rows[0];
        applied.factors.push({ id: e.id, kind, co2e, unit: u.code });
      };
      if (b.intensity.use) {
        const d = derived(a);
        if (d.intensity == null || !d.currency) throw new AppError('The answers have no Scope 1 + 2 and revenue to make an intensity from');
        await addEf('intensity', b.intensity.itemId, d.intensity, d.currency, r.year, `${r.year}-01-01`, `${r.year + 1}-12-31`,
          `Supplier portal: ${r.supplier} ${r.year} — Scope 1+2 per unit of revenue${a.inventory?.verification && a.inventory.verification !== 'none' ? ` (${a.inventory.verification} assurance)` : ''}`, 'Supplier operations (Scope 1+2)');
      }
      for (const pr of b.products) {
        const x = a.products?.items?.[pr.index];
        if (!x) throw new AppError(`Product ${pr.index + 1} not found in the answers`);
        await addEf('product', pr.itemId, x.co2e, x.unit, r.year, x.validFrom ?? '2000-01-01', x.validTo ?? '2100-12-31',
          `Supplier portal: ${r.supplier} — ${x.name}${x.standard ? ` (${x.standard}${x.verified ? ', verified' : ''})` : ''}`, x.boundary ?? null);
      }
      const lines = applied.factors.length ? await recalcSupplier(c, tenant, [r.supplier_id], req.user.id) : 0;
      await c.query(`UPDATE supplier_request SET status = 'accepted', review_note = $2, reviewed_by = $3, reviewed_at = now(), applied = $4, updated_at = now() WHERE id = $1`,
        [id, b.note ?? null, req.user.name, JSON.stringify({ ...applied, linesRecalculated: lines })]);
      await queueEmail(c, tenant, r.email, `Thank you: your ${r.year} emissions data was accepted`, `Dear ${r.contact_name || 'colleague'},\n\nThank you for sharing ${r.supplier}'s ${r.year} emissions data. It has been reviewed and accepted.${b.note ? `\n\n${b.note}` : ''}\n`);
      await audit(c, req, 'supplier_portal.accept', 'supplier_request', id, { ...applied, linesRecalculated: lines });
      return { status: 'accepted', applied, linesRecalculated: lines };
    });
  });

  app.get('/api/supplier-portal/documents/:id', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const d = await tenantTx(tenant, async (c) => (await c.query(`SELECT filename, content_type, data FROM document WHERE id = $1 AND kind = 'supplier_evidence'`, [id])).rows[0]);
    if (!d) throw notFound('Document');
    return reply.header('content-type', d.content_type).header('content-disposition', `inline; filename="${String(d.filename).replace(/[^\w.\- ]/g, '_')}"`).send(openFile(d.data));
  });
}

// ------------------------------------------------------------------ public --
export async function supplierPublicRoutes(app: FastifyInstance) {
  app.post('/api/public/supplier/login', async (req) => {
    limit(`sl:${req.ip}`, 10);
    const b = z.object({ email: z.string().trim().toLowerCase().email().max(200), code: z.string().max(40) }).parse(req.body);
    limit(`sle:${b.email}`, 10);
    const code = cleanCode(b.code);
    return platformTx(async (c) => {
      const rows = (await c.query(`SELECT r.id, r.tenant_id, r.code_hash, r.expires_at, r.contact_name, r.email, s.name AS supplier, t.name AS company
                                     FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id JOIN tenant t ON t.id = r.tenant_id
                                    WHERE lower(r.email) = $1 AND NOT r.revoked AND r.code_hash IS NOT NULL AND t.status = 'active'`, [b.email])).rows;
      const h = Buffer.from(sha(code));
      const r = rows.find((x) => timingSafeEqual(Buffer.from(x.code_hash), h));
      if (!r) throw new AppError('That e-mail and code do not match. Check the invitation, or ask your contact for a new code.', 401, 'UNAUTHENTICATED');
      if (r.expires_at && new Date(r.expires_at) < new Date(new Date().toDateString())) throw new AppError('This access code has expired: ask your contact for a new one.', 401, 'UNAUTHENTICATED');
      const tok = randomBytes(32).toString('hex');
      await c.query(`DELETE FROM supplier_session WHERE request_id = $1 AND expires_at < now()`, [r.id]);
      await c.query(`INSERT INTO supplier_session (token_hash, tenant_id, request_id, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))`, [sha(tok), r.tenant_id, r.id, SESSION_H]);
      await c.query(`UPDATE supplier_request SET last_used_at = now() WHERE id = $1`, [r.id]);
      await log(c, { tenant: r.tenant_id, name: `${r.contact_name || r.email} (supplier: ${r.supplier})` }, 'supplier_portal.login', r.id, {}, req.ip);
      return { token: tok, supplier: r.supplier, company: r.company };
    });
  });

  app.post('/api/public/supplier/logout', async (req) => {
    const tok = String(req.headers['x-supplier-token'] ?? '');
    if (/^[a-f0-9]{64}$/.test(tok)) await platformTx((c) => c.query('DELETE FROM supplier_session WHERE token_hash = $1', [sha(tok)]));
    return { ok: true };
  });

  app.get('/api/public/supplier/me', async (req) => {
    const k = await session(req);
    return tenantTx(k.tenant, async (c) => {
      const r = (await c.query(`SELECT r.id, r.year, r.contact_name, r.email, r.message, r.due_date, r.expires_at, r.status, r.answers, r.documents, r.submitted_at, r.submitted_by, r.review_note, r.reviewed_at,
                                       r.share_estimate, s.name AS supplier, s.cdp_score, s.target, s.reports_emissions, s.climate_target, t.name AS company, t.currency AS company_currency,
                                       sb.near_status, sb.net_zero_year
                                  FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id JOIN tenant t ON t.id = r.tenant_id
                                  LEFT JOIN LATERAL (SELECT z.near_status, z.net_zero_year FROM sbti_company z WHERE z.norm = s.norm OR z.norm = ANY(s.aliases) LIMIT 1) sb ON true WHERE r.id = $1`, [k.id])).rows[0];
      // the score as it will be once the answers are in (the supplier's own view, with what earns more points)
      const sc = supplierScore({ reports_emissions: r.reports_emissions, climate_target: r.climate_target, cdp_score: r.cdp_score, target: r.target,
        sbti: r.near_status ? { near_status: r.near_status, net_zero_year: r.net_zero_year } : null, request: { status: r.status === 'accepted' ? 'accepted' : 'submitted', answers: r.answers } });
      const contribution = r.share_estimate ? Number((await c.query(`SELECT coalesce(sum(co2e), 0)::float8 / 1000 AS t FROM purchase_line WHERE supplier_id = (SELECT supplier_id FROM supplier_request WHERE id = $1)
                                                                       AND status IN ('ready','check','published') AND extract(year FROM period_start) = $2`, [k.id, r.year])).rows[0].t) : null;
      const { cdp_score: _c, target: _t, reports_emissions: _r, climate_target: _ct, near_status: _n, net_zero_year: _z, share_estimate: _s, ...rest } = r;
      return { ...rest, progress: completeness(r.answers), derived: derived(r.answers), statusText: STATUS_TEXT, editable: ['invited', 'in_progress', 'queried'].includes(r.status),
        esgCatalogue: { topics: TOPICS.map(({ code, pillar, name, sub }) => ({ code, pillar, name, sub })), industries: INDUSTRIES },
        score: { score: sc.score, letter: sc.letter, parts: sc.parts.map((p) => (p.key === 'data' && !['submitted', 'accepted'].includes(r.status) ? { ...p, note: 'counted once you submit' } : p)), actions: sc.actions.filter((x) => !/customer's data request/.test(x)) }, contribution };
    });
  });

  app.put('/api/public/supplier/answers', async (req) => {
    const k = await session(req);
    limit(`sa:${k.id}`, 60);
    const b = z.object({ section: z.enum(Object.keys(SECTIONS) as [keyof typeof SECTIONS, ...(keyof typeof SECTIONS)[]]), data: z.unknown() }).parse(req.body);
    const data = SECTIONS[b.section].parse(b.data);
    return tenantTx(k.tenant, async (c) => {
      const r = (await c.query(`SELECT status, answers, documents FROM supplier_request WHERE id = $1 FOR UPDATE`, [k.id])).rows[0];
      if (!['invited', 'in_progress', 'queried'].includes(r.status)) throw new AppError('Your answers were submitted: ask your contact if something needs to change', 409, 'SUBMITTED');
      if (b.section === 'products') {
        const docs = new Set((r.documents as { id: string }[]).map((d) => d.id));
        for (const p of (data as z.infer<typeof SECTIONS.products>).items ?? []) if (p.documentId && !docs.has(p.documentId)) throw new AppError('Attach the document under Evidence first');
      }
      const answers = { ...r.answers, [b.section]: data };
      if (b.section === 'allocation' || b.section === 'inventory') {
        const co = (await c.query(`SELECT t.name FROM tenant t WHERE t.id = $1`, [k.tenant])).rows[0].name as string;
        const bad = conflicts(answers, co);
        if (bad.length) throw new AppError(b.section === 'inventory' ? `${bad[0]} If the totals are right, change your share for ${co} first.` : bad[0]!, 400, 'INCONSISTENT');
      }
      await c.query(`UPDATE supplier_request SET answers = $2, status = CASE WHEN status = 'invited' THEN 'in_progress' ELSE status END, updated_at = now() WHERE id = $1`, [k.id, JSON.stringify(answers)]);
      await log(c, k, 'supplier_portal.save', k.id, { section: b.section }, req.ip);
      return { ok: true, progress: completeness(answers), derived: derived(answers) };
    });
  });

  /** A report, verification statement, EPD or other evidence: PDF, JPEG or PNG up to 15 MB (body = file; headers x-filename, x-kind). */
  app.post('/api/public/supplier/evidence', { bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const k = await session(req);
    limit(`se:${k.id}`, 30);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
    const type = buf.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
      : buf.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png' : null;
    if (!type) throw new AppError('Send a PDF, JPEG or PNG');
    const kind = z.enum(['report', 'verification', 'epd', 'other']).catch('other').parse(String(req.headers['x-kind'] ?? 'other'));
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'evidence')).replace(/[^\w.\- ()]/g, '_').slice(0, 160);
    const h = createHash('sha256').update(buf).digest('hex');
    return tenantTx(k.tenant, async (c) => {
      const r = (await c.query(`SELECT status, documents FROM supplier_request WHERE id = $1 FOR UPDATE`, [k.id])).rows[0];
      if (!['invited', 'in_progress', 'queried'].includes(r.status)) throw new AppError('Your answers were submitted: ask your contact if something needs to change', 409, 'SUBMITTED');
      if ((r.documents as unknown[]).length >= 30) throw new AppError('At most 30 files');
      const prior = (await c.query(`SELECT id FROM document WHERE sha256 = $1 AND kind = 'supplier_evidence'`, [h])).rows[0];
      const id = prior?.id ?? (await c.query(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1,'supplier_evidence',$2,$3,$4,$5,$6,$7) RETURNING id`,
        [k.tenant, filename, type, buf.length, h, sealFile(buf), k.name])).rows[0].id;
      const docs = [...(r.documents as { id: string }[]).filter((d) => d.id !== id), { id, filename, kind, size: buf.length, at: new Date().toISOString() }];
      await c.query(`UPDATE supplier_request SET documents = $2, status = CASE WHEN status = 'invited' THEN 'in_progress' ELSE status END, updated_at = now() WHERE id = $1`, [k.id, JSON.stringify(docs)]);
      await log(c, k, 'supplier_portal.evidence', id, { filename, kind, size: buf.length }, req.ip);
      return { documentId: id, filename, kind };
    });
  });

  app.delete('/api/public/supplier/evidence/:id', async (req) => {
    const k = await session(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(k.tenant, async (c) => {
      const r = (await c.query(`SELECT status, documents, answers FROM supplier_request WHERE id = $1 FOR UPDATE`, [k.id])).rows[0];
      if (!['invited', 'in_progress', 'queried'].includes(r.status)) throw new AppError('Your answers were submitted', 409, 'SUBMITTED');
      if (((r.answers as Answers).products?.items ?? []).some((p) => p.documentId === id)) throw new AppError('A product footprint refers to this file: remove it there first');
      await c.query(`UPDATE supplier_request SET documents = $2, updated_at = now() WHERE id = $1`, [k.id, JSON.stringify((r.documents as { id: string }[]).filter((d) => d.id !== id))]);
      return { ok: true };
    });
  });

  app.post('/api/public/supplier/submit', async (req) => {
    const k = await session(req);
    const b = z.object({ name: z.string().trim().min(2).max(120), title: z.string().trim().min(2).max(120), confirm: z.literal(true) }).parse(req.body);
    return tenantTx(k.tenant, async (c) => {
      const r = (await c.query(`SELECT r.status, r.answers, r.year, r.created_by, s.name AS supplier FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id WHERE r.id = $1 FOR UPDATE OF r`, [k.id])).rows[0];
      if (!['invited', 'in_progress', 'queried'].includes(r.status)) throw new AppError('Already submitted', 409, 'SUBMITTED');
      const p = completeness(r.answers);
      const bad = conflicts(r.answers);
      if (bad.length) throw new AppError(bad[0]!, 400, 'INCONSISTENT');
      const missing = Object.entries(p.done).filter(([, v]) => !v).map(([s]) => s);
      if (missing.length) throw new AppError(`Complete these sections first: ${missing.join(', ')}`, 400, 'INCOMPLETE', { missing });
      const answers = { ...r.answers, declaration: { name: b.name, title: b.title, at: new Date().toISOString() } };
      await c.query(`UPDATE supplier_request SET answers = $2, status = 'submitted', submitted_at = now(), submitted_by = $3, review_note = NULL, updated_at = now() WHERE id = $1`, [k.id, JSON.stringify(answers), `${b.name}, ${b.title}`]);
      const staff = (await c.query(`SELECT id FROM app_user WHERE NOT disabled AND (role = 'super_admin' OR name = $1 AND role IN ('admin', 'manager'))`, [r.created_by])).rows.map((x) => x.id as string);
      await notify(c, k.tenant, staff, { kind: 'supplier', title: `Supplier data to review: ${r.supplier} (${r.year})`, body: `Submitted by ${b.name}, ${b.title}.`, link: `/suppliers?tab=portal&request=${k.id}` });
      await log(c, k, 'supplier_portal.submit', k.id, { by: b.name, title: b.title }, req.ip);
      return { ok: true, status: 'submitted' };
    });
  });
}
