/**
 * Base-year restatement (RFP 3.2.9).
 *
 *   GET    /api/restatements                     the base year as measured, restatements, the restated base year
 *   GET    /api/restatements/facility/:id        a facility's base-year emissions (to fill a divestment or closure)
 *   POST   /api/restatements                     record a change (super admin, admin)
 *   POST   /api/restatements/:id/decide {decision, note?}   approve or reject: a super admin or admin who did not record it
 *   DELETE /api/restatements/:id                 withdraw your own change while it waits
 *   PUT    /api/restatements/settings {threshold}   significance threshold, % of the base year (super admin)
 *
 * Approving applies the change when it reaches the threshold, alone or with earlier approved changes not yet
 * applied (their net effect: the GHG Protocol's cumulative test), or when it was recorded as "restate anyway".
 * Below it, the change is kept as recorded and counts towards the next one.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { TRIGGERS, adjustments, measured } from '../lib/restate.js';

const t4 = (x: number) => Math.round(x * 10000) / 10000;

export async function restatementRoutes(app: FastifyInstance) {
  app.get('/api/restatements', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const t = (await c.query(`SELECT base_year, restate_threshold::float8 AS threshold FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const all = (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((r) => r.id as string);
      const base = await measured(c, tenant, t.base_year, all);
      const adj = await adjustments(c, t.base_year, all, true);
      const items = (await c.query(
        `SELECT r.*, r.s1_t::float8 AS s1, r.s2_t::float8 AS s2, r.s2m_t::float8 AS s2m, r.s3_t::float8 AS s3, r.pct::float8 AS pct, r.base_before::float8 AS base_before,
                f.name AS facility, f.active AS facility_active, d.filename AS document, w.title AS applied_with_title
           FROM base_restatement r LEFT JOIN org_node f ON f.id = r.facility_id LEFT JOIN document d ON d.id = r.document_id LEFT JOIN base_restatement w ON w.id = r.applied_with
          ORDER BY (r.status = 'pending') DESC, r.proposed_at DESC`)).rows
        .map(({ s1_t: _a, s2_t: _b, s2m_t: _c, s3_t: _d, ...r }) => ({ ...r, mine: r.proposed_by === req.user.id }));
      const recorded = items.filter((r) => r.base_year === t.base_year && r.status === 'approved' && !r.applied);
      const net = recorded.reduce((a, r) => a + r.s1 + r.s2 + r.s3, 0);
      return {
        baseYear: t.base_year, threshold: t.threshold, measured: base,
        restated: { s1: base.s1 + adj.s1, s2: base.s2 + adj.s2, s2m: base.s2m + adj.s2m, s3: base.s3 + adj.s3, total: base.total + adj.s1 + adj.s2 + adj.s3 },
        recorded: { n: recorded.length, net, pct: base.total ? (Math.abs(net) / base.total) * 100 : 0 },
        items, triggers: TRIGGERS,
        facilities: (await c.query(`SELECT id, name, active FROM org_node WHERE kind = 'facility' ORDER BY active DESC, name`)).rows,
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 200`)).rows,
        canPropose: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role), canDecide: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role),
        canSettings: ['super_admin', 'platform_admin'].includes(req.user.role),
      };
    });
  });

  app.get('/api/restatements/facility/:id', async (req) => {
    const tenant = requireTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const f = (await c.query(`SELECT id, name, active FROM org_node WHERE id = $1 AND kind = 'facility'`, [id])).rows[0];
      if (!f) throw notFound('Facility');
      const y = (await c.query(`SELECT base_year FROM tenant WHERE id = $1`, [tenant])).rows[0].base_year;
      return { facility: f, year: y, ...(await measured(c, tenant, y, [id])) };
    });
  });

  app.post('/api/restatements', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const n = z.number().finite().min(-1e9).max(1e9);
    const b = z.object({
      trigger: z.enum(Object.keys(TRIGGERS) as [string, ...string[]]), title: z.string().trim().min(3).max(200), description: z.string().trim().max(4000).default(''),
      facilityId: z.string().uuid().nullable().default(null), effective: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      s1: n.default(0), s2: n.default(0), s2m: n.nullable().default(null), s3: n.default(0), documentId: z.string().uuid().nullable().default(null), force: z.boolean().default(false),
    }).parse(req.body);
    if (!b.s1 && !b.s2 && !b.s3 && !b.s2m) throw new AppError('Give the change to the base year (tCO₂e) for at least one scope');
    return tenantTx(tenant, async (c) => {
      if (b.facilityId) {
        if (!(await c.query(`SELECT 1 FROM org_node WHERE id = $1 AND kind = 'facility'`, [b.facilityId])).rowCount) throw notFound('Facility');
        if (req.user.role === 'admin' && !(await scopeOf(c, req.user)).see.has(b.facilityId)) throw forbidden('This facility is outside your sub-group');
      }
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
      const y = (await c.query(`SELECT base_year FROM tenant WHERE id = $1`, [tenant])).rows[0].base_year;
      const r = (await c.query(
        `INSERT INTO base_restatement (tenant_id, base_year, trigger, title, description, facility_id, effective, s1_t, s2_t, s2m_t, s3_t, document_id, force, proposed_by, proposed_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [tenant, y, b.trigger, b.title, b.description, b.facilityId, b.effective, b.s1, b.s2, b.s2m, b.s3, b.documentId, b.force, req.user.id, req.user.name])).rows[0];
      const deciders = (await c.query(`SELECT id FROM app_user WHERE role IN ('super_admin', 'admin') AND NOT disabled AND id <> $1`, [req.user.id])).rows.map((x) => x.id as string);
      await notify(c, tenant, deciders, { kind: 'restatement', title: `Base-year change to approve: ${b.title}`, body: `${TRIGGERS[b.trigger]} · ${req.user.name}\n${b.description}`.trim(), link: '/methodology#restatements' });
      await audit(c, req, 'restatement.propose', 'base_restatement', r.id, { ...b, baseYear: y });
      return { id: r.id };
    });
  });

  app.post('/api/restatements/:id/decide', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).optional() }).parse(req.body);
    if (b.decision === 'reject' && !b.note) throw new AppError('Say why it is rejected');
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT * FROM base_restatement WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!r) throw notFound('Restatement');
      if (r.status !== 'pending') throw new AppError('Already decided', 409, 'DECIDED');
      if (r.proposed_by === req.user.id) throw forbidden('Someone other than the person who recorded it approves it');
      if (req.user.role === 'platform_admin') throw forbidden('Base-year changes are decided by the company\'s super admin or admin, not platform staff');
      const t = (await c.query(`SELECT base_year, restate_threshold::float8 AS threshold FROM tenant WHERE id = $1`, [tenant])).rows[0];
      if (r.base_year !== t.base_year) throw new AppError(`The base year is now ${t.base_year}; this change was recorded for ${r.base_year}. Record it again for the new base year.`, 409, 'BASE_YEAR');
      if (b.decision === 'reject') {
        await c.query(`UPDATE base_restatement SET status = 'rejected', decided_by = $2, decided_name = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [id, req.user.id, req.user.name, b.note]);
        await notify(c, tenant, [r.proposed_by], { kind: 'restatement', title: `Base-year change rejected: ${r.title}`, body: b.note, link: '/methodology#restatements' });
        await audit(c, req, 'restatement.reject', 'base_restatement', id, { note: b.note });
        return { status: 'rejected', applied: false };
      }
      const all = (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((x) => x.id as string);
      const base = await measured(c, tenant, t.base_year, all);
      const adj = await adjustments(c, t.base_year, all, true);
      const before = base.total + adj.s1 + adj.s2 + adj.s3;             // the base year as it stands (already restated)
      const change = Number(r.s1_t) + Number(r.s2_t) + Number(r.s3_t);
      const pct = before ? (Math.abs(change) / before) * 100 : 100;
      // the cumulative test: this change with the approved changes not yet applied (net effect)
      const waiting = (await c.query(`SELECT id, (s1_t + s2_t + s3_t)::float8 AS t FROM base_restatement WHERE base_year = $1 AND status = 'approved' AND NOT applied`, [t.base_year])).rows;
      const net = change + waiting.reduce((a, x) => a + x.t, 0), netPct = before ? (Math.abs(net) / before) * 100 : 100;
      const apply = r.force || pct >= t.threshold || netPct >= t.threshold;
      await c.query(`UPDATE base_restatement SET status = 'approved', applied = $2, applied_at = CASE WHEN $2 THEN now() END, base_before = $3, pct = $4,
                            decided_by = $5, decided_name = $6, decided_at = now(), decision_note = $7 WHERE id = $1`,
        [id, apply, t4(before), Math.round(pct * 100) / 100, req.user.id, req.user.name, b.note ?? null]);
      // the earlier recorded changes are applied with it when together they reach the threshold
      if (apply && waiting.length) await c.query(`UPDATE base_restatement SET applied = true, applied_at = now(), applied_with = $1 WHERE id = ANY($2)`, [id, waiting.map((x) => x.id)]);
      const after = apply ? before + net : before;
      await notify(c, tenant, [r.proposed_by], {
        kind: 'restatement', title: apply ? `Base year ${t.base_year} restated: ${r.title}` : `Base-year change approved and recorded (below the threshold): ${r.title}`,
        body: apply ? `${Math.round(before)} → ${Math.round(after)} tCO₂e` : `${pct.toFixed(1)}% of the base year; recorded changes so far: ${netPct.toFixed(1)}% (threshold ${t.threshold}%)`, link: '/methodology#restatements',
      });
      await audit(c, req, apply ? 'restatement.apply' : 'restatement.record', 'base_restatement', id,
        { baseYear: t.base_year, before: t4(before), after: t4(after), pct: Math.round(pct * 100) / 100, cumulativePct: Math.round(netPct * 100) / 100, threshold: t.threshold, force: r.force, alsoApplied: apply ? waiting.map((x) => x.id) : [] });
      return { status: 'approved', applied: apply, before: t4(before), after: t4(after), pct, cumulativePct: netPct, alsoApplied: apply ? waiting.length : 0 };
    });
  });

  app.delete('/api/restatements/:id', async (req) => {
    const tenant = requireTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE base_restatement SET status = 'withdrawn', decided_at = now(), decided_name = $3 WHERE id = $1 AND proposed_by = $2 AND status = 'pending'`, [id, req.user.id, req.user.name]);
      if (!r.rowCount) throw notFound('Your pending change');
      await audit(c, req, 'restatement.withdraw', 'base_restatement', id);
      return { ok: true };
    });
  });

  app.put('/api/restatements/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ threshold: z.number().min(0).max(50) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`UPDATE tenant SET restate_threshold = $2 WHERE id = $1`, [tenant, b.threshold]);
      await audit(c, req, 'restatement.settings', 'tenant', tenant, b);
      return b;
    });
  });
}
