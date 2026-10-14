/**
 * Approvals (as in the prototype): entries waiting for approval in the facilities you can see —
 * the ones waiting for you, and the ones waiting for someone else (and who).
 *
 *   GET /api/approvals                  waiting entries with a check against the 6-month average
 *   PUT /api/approvals/settings         approval levels and the check limit (super admin)
 *
 * Level 1: the facility manager, a sub-group admin or the super admin — never the person who entered
 * or submitted it. Level 2 (when switched on, for entries of at least N tCO2e or chosen categories):
 * an admin or the super admin, a different person from level 1. Approving and sending back happen
 * through POST /api/activities/review (review.routes).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { METRIC_JOIN } from '../lib/collection.js';

export interface ApprovalSettings { l2: boolean; minT: number; cats: string[]; checkPct: number }
export const APPROVAL_DEFAULT: ApprovalSettings = { l2: false, minT: 100, cats: [], checkPct: 35 };
export async function approvalSettings(c: Tx, tenant: string): Promise<ApprovalSettings> {
  const r = (await c.query(`SELECT approval FROM tenant WHERE id = $1`, [tenant])).rows[0];
  return { ...APPROVAL_DEFAULT, ...(r?.approval ?? {}) };
}
/** Does this entry need a level-2 approval once level 1 has approved it? */
export const needsL2 = (s: ApprovalSettings, kg: number, cat: string) => s.l2 && (kg / 1000 >= s.minT || s.cats.includes(cat) || s.cats.includes(cat.split('_')[0]!));

/** The 6-month check: approved quantity of the same item at the same facility in the 6 months before. */
export const USUAL_SQL = `(SELECT avg(q)::float8 FROM (SELECT sum(b.quantity) AS q FROM activity b
     WHERE b.facility_id = a.facility_id AND b.item_id = a.item_id AND b.unit = a.unit AND b.id <> a.id AND b.status = 'approved' AND b.period_end - b.period_start < 40
       AND b.period_start >= a.period_start - interval '6 months' AND b.period_start < a.period_start GROUP BY b.period_start) x WHERE q > 0)`;
export const checkOf = (qty: number, usual: number | null, pct: number) => {
  if (!usual || !(qty > 0)) return null;
  const d = qty / usual - 1;
  if (Math.abs(d) * 100 < pct) return { ok: true, txt: 'In usual range' };
  return { ok: false, txt: `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}% vs 6-month average (limit ±${pct}%) — add a note` };
};

export async function approvalsRoutes(app: FastifyInstance) {
  app.get('/api/approvals', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user), me = String(req.user.id), set = await approvalSettings(c, tenant);
      const solo = req.user.role === 'super_admin' && Number((await c.query(`SELECT count(*)::int AS n FROM app_user WHERE NOT disabled AND role <> 'verifier'`)).rows[0].n) === 1;
      const rows = (await c.query(
        `SELECT a.id, a.facility_id AS f, fo.name AS facility, a.period_start::text AS month, cat.code AS cat, cat.name AS category, i.name AS item, a.note, a.data_type,
                a.quantity::float8 AS qty, a.unit, (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3)::float8 AS kg, a.created_by, a.submitted_by, a.submitted_at AS at,
                ue.name AS by, a.approval_stage AS stage, a.l1_by, a.l1_at, u1.name AS l1_name, coalesce(CASE WHEN fo.manager_user_id::text NOT IN (coalesce(a.created_by, ''), coalesce(a.submitted_by, '')) THEN um.name END,
                  (SELECT u.name FROM user_facility uf JOIN app_user u ON u.id = uf.user_id WHERE uf.node_id = a.facility_id AND u.role = 'manager' AND NOT u.disabled
                      AND u.id::text NOT IN (coalesce(a.created_by, ''), coalesce(a.submitted_by, '')) ORDER BY u.name LIMIT 1)) AS manager, ${USUAL_SQL} AS usual, mt.check_pct, mt.metric_code
           FROM activity a JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id JOIN org_node fo ON fo.id = a.facility_id
           LEFT JOIN app_user ue ON ue.id::text = coalesce(a.submitted_by, a.created_by) LEFT JOIN app_user u1 ON u1.id::text = a.l1_by LEFT JOIN app_user um ON um.id = fo.manager_user_id ${METRIC_JOIN}
          WHERE a.facility_id = ANY($1) AND a.status = 'submitted' ORDER BY a.submitted_at NULLS LAST, fo.name LIMIT 2000`, [[...s.see]])).rows;
      const out = rows.map((r) => {
        const mine = r.created_by === me || r.submitted_by === me;
        const l2 = r.stage === 'L2';
        const can = s.approve.has(r.f) && (!mine || solo) && (!l2 || (['super_admin', 'admin', 'platform_admin'].includes(req.user.role) && r.l1_by !== me));
        const waitingFor = l2 ? 'an admin or the super admin (level 2)' : r.manager ?? 'an admin or the super admin';
        return {
          id: r.id, f: r.f, facility: r.facility, month: r.month, cat: r.cat, category: r.category, item: r.item, note: r.note, dataType: r.data_type, qty: r.qty, unit: r.unit, kg: r.kg,
          by: r.by, at: r.at, stage: r.stage, l1: r.l1_name, mine, canApprove: can, waitingFor, check: checkOf(r.qty, r.usual, r.check_pct ?? set.checkPct), metric: r.metric_code,
          willNeedL2: !l2 && needsL2(set, r.kg, r.cat),
        };
      });
      const categories = (await c.query(`SELECT code, name, scope FROM category ORDER BY scope, sort`)).rows;
      return { settings: set, mine: out.filter((x) => x.canApprove), others: out.filter((x) => !x.canApprove), categories, canSettings: ['super_admin', 'platform_admin'].includes(req.user.role) };
    });
  });

  app.put('/api/approvals/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ l2: z.boolean(), minT: z.number().finite().min(0).max(1e9), cats: z.array(z.string().max(60)).max(40), checkPct: z.number().int().min(1).max(500) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`UPDATE tenant SET approval = $2 WHERE id = $1`, [tenant, JSON.stringify(b)]);
      await audit(c, req, 'approval.settings', 'tenant', tenant, b);
      return b;
    });
  });
}
