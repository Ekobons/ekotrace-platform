/**
 * Carbon credits (Net zero · RFP 8.7).
 *
 *   GET    /api/credits?year=                     lots (bought, retired, available), retirements, the year's summary
 *   POST   /api/credits/lots                      record a purchase (super admin, admin)
 *   PUT    /api/credits/lots/:id                  change it (delivery, serials, labels…); quantity not below what is retired or waiting
 *   DELETE /api/credits/lots/:id                  remove a lot with no retirements
 *   POST   /api/credits/lots/:id/retire           record a retirement from a delivered lot (super admin, admin)
 *   POST   /api/credits/retirements/:id/decide    approve or reject: a super admin or admin who did not record it
 *   DELETE /api/credits/retirements/:id           withdraw your own retirement while it waits
 *
 * Credits are reported beside the inventory, never inside it: gross emissions stay as measured and
 * "net after credits" is shown alongside. Only approved retirements count. Credits do not count towards
 * SBTi reduction targets; at net zero the residual is neutralised by permanent removals.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { adjustments, measured } from '../lib/restate.js';
import { SBTI_DEFAULT } from './targets.routes.js';

export const CATEGORIES: Record<string, string> = { avoidance: 'Avoidance / reduction', removal_nature: 'Removal — nature-based', removal_technical: 'Removal — technical' };
export const PURPOSES: Record<string, string> = {
  voluntary: 'Voluntary claim (beyond the value chain)', neutralisation: 'Neutralising residual emissions (net zero)', bvcm: 'Beyond value chain mitigation (BVCM)',
  corsia: 'CORSIA offsetting obligation', compliance: 'Compliance scheme',
};
export const REGISTRIES = ['Verra (VCS)', 'Gold Standard', 'Puro.earth', 'Isometric', 'American Carbon Registry', 'Climate Action Reserve', 'Article 6.4 mechanism', 'Other'];
const t3 = (x: number) => Math.round(x * 1000) / 1000;

/** Lots with their retired (approved), waiting (pending) and available quantities. */
async function lots(c: Tx) {
  return (await c.query(
    `SELECT l.id, l.project, l.project_id, l.registry, l.methodology, l.category, l.project_type, l.country, l.vintage, l.quantity::float8 AS quantity, l.price::float8 AS price, l.currency,
            l.supplier, l.contract_date, l.status, l.delivered_on, l.serials, l.ccp, l.corsia, l.ca, l.permanence, l.document_id, d.filename AS document, l.notes,
            l.created_name, l.created_at, l.updated_name, l.updated_at,
            coalesce(sum(r.quantity) FILTER (WHERE r.status = 'approved'), 0)::float8 AS retired,
            coalesce(sum(r.quantity) FILTER (WHERE r.status = 'pending'), 0)::float8 AS waiting
       FROM carbon_credit_lot l LEFT JOIN carbon_credit_retirement r ON r.lot_id = l.id LEFT JOIN document d ON d.id = l.document_id
      GROUP BY l.id, d.filename ORDER BY (l.status = 'cancelled'), l.vintage DESC, l.project`)).rows
    .map((l) => ({ ...l, available: l.status === 'delivered' ? Math.max(0, t3(l.quantity - l.retired - l.waiting)) : 0 }));
}

/** The year's figures: gross (whole company, approved entries), credits retired for it, net after credits, pipeline. */
export async function creditSummary(c: Tx, tenant: string, year: number) {
  const t = (await c.query(`SELECT base_year, sbti FROM tenant WHERE id = $1`, [tenant])).rows[0];
  const sb = { ...SBTI_DEFAULT, ...(t.sbti ?? {}) };
  const all = (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((r) => r.id as string);
  const gross = await measured(c, tenant, year, all);
  const base = await measured(c, tenant, t.base_year, all), adj = await adjustments(c, t.base_year, all, true);
  const baseTotal = base.total + adj.s1 + adj.s2 + adj.s3;
  const ret = (await c.query(
    `SELECT l.category, r.purpose, sum(r.quantity)::float8 AS t, sum(r.quantity * coalesce(l.price, 0))::float8 AS cost
       FROM carbon_credit_retirement r JOIN carbon_credit_lot l ON l.id = r.lot_id WHERE r.status = 'approved' AND r.claim_year = $1 GROUP BY 1, 2`, [year])).rows as { category: string; purpose: string; t: number; cost: number }[];
  const by = (k: 'category' | 'purpose') => Object.fromEntries(Object.keys(k === 'category' ? CATEGORIES : PURPOSES).map((x) => [x, t3(ret.filter((r) => r[k] === x).reduce((a, r) => a + r.t, 0))]));
  const retired = ret.reduce((a, r) => a + r.t, 0);
  const removals = ret.filter((r) => r.category !== 'avoidance').reduce((a, r) => a + r.t, 0);
  const pend = (await c.query(`SELECT coalesce(sum(quantity), 0)::float8 AS t FROM carbon_credit_retirement WHERE status = 'pending' AND claim_year = $1`, [year])).rows[0].t;
  const p = (await c.query(
    `SELECT coalesce(sum(l.quantity) FILTER (WHERE l.status = 'contracted'), 0)::float8 AS contracted,
            coalesce(sum(l.quantity - coalesce(x.t, 0)) FILTER (WHERE l.status = 'delivered'), 0)::float8 AS held,
            coalesce(sum(l.quantity * coalesce(l.price, 0)) FILTER (WHERE l.status <> 'cancelled'), 0)::float8 AS spend
       FROM carbon_credit_lot l LEFT JOIN (SELECT lot_id, sum(quantity) AS t FROM carbon_credit_retirement WHERE status IN ('approved', 'pending') GROUP BY 1) x ON x.lot_id = l.id`)).rows[0];
  const resid = (baseTotal * Number(sb.resid ?? 10)) / 100;
  return {
    year, gross: { ...gross }, retired: t3(retired), pending: t3(pend), net: gross.total - retired, byCategory: by('category'), byPurpose: by('purpose'),
    removalShare: retired ? removals / retired : 0, cost: ret.reduce((a, r) => a + r.cost, 0),
    pipeline: { contracted: t3(p.contracted), held: t3(p.held), spend: p.spend },
    netZero: { year: Number(sb.nzYear), residPct: Number(sb.resid ?? 10), baseYear: t.base_year, baseTotal, residual: resid, removalsHeld: 0 },
  };
}

const lotBody = z.object({
  project: z.string().trim().min(2).max(200), projectId: z.string().trim().max(80).nullable().default(null), registry: z.string().trim().min(2).max(80),
  methodology: z.string().trim().max(120).nullable().default(null), category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]),
  projectType: z.string().trim().max(120).nullable().default(null), country: z.string().trim().max(80).nullable().default(null),
  vintage: z.number().int().min(1990).max(2100), quantity: z.number().positive().max(1e9), price: z.number().min(0).max(1e6).nullable().default(null),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default('USD'), supplier: z.string().trim().max(200).nullable().default(null),
  contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), status: z.enum(['contracted', 'delivered', 'cancelled']).default('contracted'),
  deliveredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null), serials: z.string().trim().max(400).nullable().default(null),
  ccp: z.boolean().default(false), corsia: z.boolean().default(false), ca: z.boolean().default(false), permanence: z.string().trim().max(120).nullable().default(null),
  documentId: z.string().uuid().nullable().default(null), notes: z.string().trim().max(4000).default(''),
});
const cols = (b: z.infer<typeof lotBody>) => [b.project, b.projectId || null, b.registry, b.methodology || null, b.category, b.projectType || null, b.country || null, b.vintage, b.quantity, b.price,
  b.currency, b.supplier || null, b.contractDate, b.status, b.status === 'delivered' ? b.deliveredOn : null, b.serials || null, b.ccp, b.corsia, b.ca, b.permanence || null, b.documentId, b.notes];

export async function creditRoutes(app: FastifyInstance) {
  app.get('/api/credits', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(1990).max(2100).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const year = q.year ?? new Date().getUTCFullYear() - 1;
      const L = await lots(c);
      const summary = await creditSummary(c, tenant, year);
      summary.netZero.removalsHeld = t3(L.filter((l) => l.category !== 'avoidance').reduce((a, l) => a + (l.status === 'delivered' ? l.available : l.status === 'contracted' ? l.quantity : 0), 0));
      const retirements = (await c.query(
        `SELECT r.id, r.lot_id, l.project, l.registry, l.category, l.vintage, r.quantity::float8 AS quantity, r.retired_on, r.claim_year, r.purpose, r.serials, r.beneficiary, r.registry_url,
                r.document_id, d.filename AS document, r.note, r.status, r.proposed_by, r.proposed_name, r.proposed_at, r.decided_name, r.decided_at, r.decision_note
           FROM carbon_credit_retirement r JOIN carbon_credit_lot l ON l.id = r.lot_id LEFT JOIN document d ON d.id = r.document_id
          ORDER BY (r.status = 'pending') DESC, r.retired_on DESC, r.proposed_at DESC`)).rows
        .map(({ proposed_by, ...r }) => ({ ...r, mine: proposed_by === req.user.id }));
      const years = (await c.query(`SELECT DISTINCT claim_year AS y FROM carbon_credit_retirement UNION SELECT DISTINCT extract(year FROM period_start)::int FROM activity ORDER BY 1 DESC`)).rows.map((r) => r.y as number);
      const edit = ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
      return {
        year, years: [...new Set([year, ...years])].sort((a, b) => b - a), lots: L, retirements, summary, categories: CATEGORIES, purposes: PURPOSES, registries: REGISTRIES,
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 200`)).rows,
        canEdit: edit, canDecide: ['super_admin', 'admin'].includes(req.user.role),
      };
    });
  });

  app.post('/api/credits/lots', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = lotBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
      const r = (await c.query(
        `INSERT INTO carbon_credit_lot (tenant_id, project, project_id, registry, methodology, category, project_type, country, vintage, quantity, price, currency, supplier, contract_date, status,
                                        delivered_on, serials, ccp, corsia, ca, permanence, document_id, notes, created_by, created_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
        [tenant, ...cols(b), req.user.id, req.user.name])).rows[0];
      await audit(c, req, 'credits.lot.create', 'carbon_credit_lot', r.id, b);
      return { id: r.id };
    });
  });

  app.put('/api/credits/lots/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = lotBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const l = (await lots(c)).find((x) => x.id === id);
      if (!l) throw notFound('Credit lot');
      const used = l.retired + l.waiting;
      if (used && b.quantity < used) throw new AppError(`${used} t of this lot are retired or waiting for approval; the quantity cannot be less`);
      if (used && b.status !== 'delivered') throw new AppError('Credits from this lot are retired or waiting; it stays delivered');
      if (used && (b.category !== l.category || b.vintage !== l.vintage)) throw new AppError('Credits from this lot are retired; its type and vintage are fixed');
      await c.query(
        `UPDATE carbon_credit_lot SET project=$2, project_id=$3, registry=$4, methodology=$5, category=$6, project_type=$7, country=$8, vintage=$9, quantity=$10, price=$11, currency=$12, supplier=$13,
                contract_date=$14, status=$15, delivered_on=$16, serials=$17, ccp=$18, corsia=$19, ca=$20, permanence=$21, document_id=$22, notes=$23, updated_name=$24, updated_at=now() WHERE id = $1`,
        [id, ...cols(b), req.user.name]);
      await audit(c, req, 'credits.lot.update', 'carbon_credit_lot', id, b);
      return { ok: true };
    });
  });

  app.delete('/api/credits/lots/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      if ((await c.query(`SELECT 1 FROM carbon_credit_retirement WHERE lot_id = $1 AND status IN ('approved', 'pending')`, [id])).rowCount) throw new AppError('Credits from this lot are retired or waiting; mark it cancelled instead of removing it', 409, 'IN_USE');
      await c.query(`DELETE FROM carbon_credit_retirement WHERE lot_id = $1`, [id]);
      const r = await c.query(`DELETE FROM carbon_credit_lot WHERE id = $1 RETURNING project`, [id]);
      if (!r.rowCount) throw notFound('Credit lot');
      await audit(c, req, 'credits.lot.delete', 'carbon_credit_lot', id, { project: r.rows[0].project });
      return { ok: true };
    });
  });

  app.post('/api/credits/lots/:id/retire', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({
      quantity: z.number().positive().max(1e9), retiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), claimYear: z.number().int().min(1990).max(2100),
      purpose: z.enum(Object.keys(PURPOSES) as [string, ...string[]]), serials: z.string().trim().max(400).nullable().default(null), beneficiary: z.string().trim().max(200).nullable().default(null),
      registryUrl: z.string().trim().url().max(600).refine((u) => /^https?:\/\//i.test(u), 'A web address').nullable().default(null), documentId: z.string().uuid().nullable().default(null), note: z.string().trim().max(2000).default(''),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`SELECT 1 FROM carbon_credit_lot WHERE id = $1 FOR UPDATE`, [id]);
      const l = (await lots(c)).find((x) => x.id === id);
      if (!l) throw notFound('Credit lot');
      if (l.status !== 'delivered') throw new AppError('Only delivered credits (in your registry account) can be retired');
      if (b.quantity > l.available + 1e-9) throw new AppError(`Only ${l.available} t of this lot are available to retire`);
      if (b.purpose === 'neutralisation' && l.category === 'avoidance') throw new AppError('Residual emissions at net zero are neutralised with removals, not avoidance credits (SBTi Corporate Net-Zero Standard)');
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
      const r = (await c.query(
        `INSERT INTO carbon_credit_retirement (tenant_id, lot_id, quantity, retired_on, claim_year, purpose, serials, beneficiary, registry_url, document_id, note, proposed_by, proposed_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [tenant, id, b.quantity, b.retiredOn, b.claimYear, b.purpose, b.serials, b.beneficiary, b.registryUrl, b.documentId, b.note, req.user.id, req.user.name])).rows[0];
      const deciders = (await c.query(`SELECT id FROM app_user WHERE role IN ('super_admin', 'admin') AND NOT disabled AND id <> $1`, [req.user.id])).rows.map((x) => x.id as string);
      await notify(c, tenant, deciders, { kind: 'credits', title: `Credit retirement to approve: ${b.quantity} t · ${l.project}`, body: `${PURPOSES[b.purpose]} · for ${b.claimYear} · ${req.user.name}`, link: '/credits' });
      await audit(c, req, 'credits.retire', 'carbon_credit_retirement', r.id, { lot: id, ...b });
      return { id: r.id };
    });
  });

  app.post('/api/credits/retirements/:id/decide', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional() }).parse(req.body);
    if (b.decision === 'reject' && !b.note) throw new AppError('Say why it is rejected');
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT r.*, l.project FROM carbon_credit_retirement r JOIN carbon_credit_lot l ON l.id = r.lot_id WHERE r.id = $1 FOR UPDATE OF r`, [id])).rows[0];
      if (!r) throw notFound('Retirement');
      if (r.status !== 'pending') throw new AppError('Already decided', 409, 'DECIDED');
      if (req.user.role === 'platform_admin') throw forbidden('Credit retirements are approved by the company\'s super admin or admin, not platform staff');
      if (r.proposed_by === req.user.id) throw forbidden('Someone other than the person who recorded it approves it');
      const status = b.decision === 'approve' ? 'approved' : 'rejected';
      await c.query(`UPDATE carbon_credit_retirement SET status = $2, decided_by = $3, decided_name = $4, decided_at = now(), decision_note = $5 WHERE id = $1`, [id, status, req.user.id, req.user.name, b.note ?? null]);
      if (r.proposed_by) await notify(c, tenant, [r.proposed_by], { kind: 'credits', title: `Credit retirement ${status}: ${Number(r.quantity)} t · ${r.project}`, body: b.note ?? `Counts for ${r.claim_year}`, link: '/credits' });
      await audit(c, req, `credits.retirement.${status === 'approved' ? 'approve' : 'reject'}`, 'carbon_credit_retirement', id, { quantity: Number(r.quantity), claimYear: r.claim_year, note: b.note });
      return { status };
    });
  });

  app.delete('/api/credits/retirements/:id', async (req) => {
    const tenant = requireTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE carbon_credit_retirement SET status = 'withdrawn', decided_at = now(), decided_name = $3 WHERE id = $1 AND proposed_by = $2 AND status = 'pending'`, [id, req.user.id, req.user.name]);
      if (!r.rowCount) throw notFound('Your pending retirement');
      await audit(c, req, 'credits.retirement.withdraw', 'carbon_credit_retirement', id);
      return { ok: true };
    });
  });
}
