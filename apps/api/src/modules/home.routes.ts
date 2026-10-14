/**
 * Home (by role) and the KPI dashboard's settings, as in the prototype.
 *
 *   GET /api/home?year=&node=&group=   for the facilities viewed: their type, manager, the categories
 *                                     they report and, per category and month, drafts / waiting /
 *                                     approved / sent back with the first submission time (on time or
 *                                     late against the due day); entries waiting for my approval (with a
 *                                     check against the usual months); my drafts and sent-back entries;
 *                                     collection rules, targets, plan; purchase batches to review; for
 *                                     verifiers, the largest approved entries and how many have evidence.
 *   GET /api/kpis                     KPIs shown and their targets per selection
 *   PUT /api/kpis {list?, key?, targets?}   change the KPIs (super admin, admin, manager) or a selection's
 *                                     targets (super admin, admin)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf, subtreeFacilities } from '../lib/access.js';
import { AppError } from '../lib/errors.js';
import { SELF_ROLES, USUAL_SQL, approvalSettings, checkOf, selfAllowed } from './approvals.routes.js';
import { METRIC_JOIN } from '../lib/collection.js';

export const KPI_IDS = ['tot', 's12', 's3', 'pemp', 'pm2', 'elec', 'ren', 'eui', 'cool', 'water', 'wemp', 'waste', 'div', 'fuel', 'fleet', 'travel', 'purch', 'supsp', 'refr'] as const;

export async function homeRoutes(app: FastifyInstance) {
  app.get('/api/home', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), node: z.string().uuid().optional(), group: z.string().uuid().optional() }).parse(req.query);
    const year = q.year ?? new Date().getFullYear();
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      let within: Set<string> | null = q.node ? await subtreeFacilities(c, q.node) : null;
      if (q.group) {
        const g = (await c.query('SELECT facility_ids FROM dashboard_group WHERE id = $1', [q.group])).rows[0];
        if (!g || !(g.facility_ids as string[]).every((f) => s.see.has(f))) throw new AppError('Dashboard group not found', 404, 'NOT_FOUND');
        within = new Set(g.facility_ids as string[]);
      }
      const facs = [...s.see].filter((f) => !within || within.has(f));
      const me = String(req.user.id);
      const t = (await c.query(`SELECT name, base_year, target_year, target_s12_pct::float8 AS s12, target_s3_pct::float8 AS s3, due_day, remind_days, escalate_days, plan, access_expiry FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const facilities = (await c.query(
        `SELECT f.id, f.name, f.facility_type AS type, f.employees, f.floor_area_m2::float8 AS area, p.name AS parent, u.name AS manager
           FROM org_node f LEFT JOIN org_node p ON p.id = f.parent_id LEFT JOIN app_user u ON u.id = f.manager_user_id
          WHERE f.id = ANY($1) AND f.kind = 'facility' AND f.active ORDER BY f.name`, [facs])).rows;
      // categories each facility reports (data this year or last); monthly categories only (not purchases or the commuting year)
      // an entry covering several months (a landfill model for Jan–Sep) counts in each month it covers, up to a year
      const MON = `generate_series(date_trunc('month', a.period_start), date_trunc('month', a.period_end), interval '1 month') AS mo(d)`;
      const usual = (await c.query(
        `SELECT DISTINCT a.facility_id AS f, CASE WHEN cat.code LIKE 'waste_%' THEN 'waste' WHEN cat.code LIKE 'water_%' THEN 'water' ELSE cat.code END AS cat
           FROM activity a JOIN category cat ON cat.id = a.category_id
          WHERE a.facility_id = ANY($1) AND extract(year FROM a.period_start) IN ($2::int, $2::int - 1) AND a.period_end - a.period_start < 366
            AND cat.calc_method NOT IN ('spend', 'travel') AND a.purchase_batch_id IS NULL`, [facs, year])).rows;
      const cells = (await c.query(
        `SELECT a.facility_id AS f, CASE WHEN cat.code LIKE 'waste_%' THEN 'waste' WHEN cat.code LIKE 'water_%' THEN 'water' ELSE cat.code END AS cat,
                extract(month FROM mo.d)::int AS m,
                count(*) FILTER (WHERE a.status = 'draft')::int AS draft, count(*) FILTER (WHERE a.status = 'submitted')::int AS submitted,
                count(*) FILTER (WHERE a.status = 'approved')::int AS approved, count(*) FILTER (WHERE a.status = 'rejected')::int AS rejected,
                min(coalesce(a.submitted_at, CASE WHEN a.status = 'approved' THEN a.created_at END)) AS sub
           FROM activity a JOIN category cat ON cat.id = a.category_id CROSS JOIN LATERAL ${MON}
          WHERE a.facility_id = ANY($1) AND extract(year FROM mo.d) = $2 AND a.period_end - a.period_start < 366 GROUP BY 1, 2, 3`, [facs, year])).rows;
      // waiting for my approval: facilities I may approve, not entered or submitted by me (a one-user company approves its own)
      const users = Number((await c.query(`SELECT count(*)::int AS n FROM app_user WHERE NOT disabled AND role <> 'verifier'`)).rows[0].n);
      const solo = users === 1 && req.user.role === 'super_admin';
      const apprFacs = req.user.role === 'platform_admin' ? [] : facs.filter((f) => s.approve.has(f));
      const set = await approvalSettings(c, tenant), canL2 = ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
      const approvals = (await c.query(
        `SELECT a.id, a.facility_id AS f, fo.name AS facility, cat.code AS cat, cat.name AS category, i.name AS item, a.period_start::text AS month, a.quantity::float8 AS qty, a.unit,
                (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3)::float8 AS kg, ue.name AS by, a.submitted_at AS at, a.approval_stage AS stage, a.l1_by, a.created_by, a.submitted_by, ${USUAL_SQL} AS usual, mt.check_pct
           FROM activity a JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id JOIN org_node fo ON fo.id = a.facility_id LEFT JOIN app_user ue ON ue.id::text = a.created_by ${METRIC_JOIN}
          WHERE a.facility_id = ANY($1) AND a.status = 'submitted' AND ($2 OR (coalesce(a.created_by, '') <> $3 AND coalesce(a.submitted_by, '') <> $3))
          ORDER BY a.submitted_at NULLS LAST LIMIT 500`, [apprFacs, solo || (set.selfApproval && SELF_ROLES.includes(req.user.role)), me])).rows
        .filter((r) => solo || (r.created_by !== me && r.submitted_by !== me) || selfAllowed(set, req.user.role, r.kg))
        .filter((r) => r.stage !== 'L2' || (canL2 && r.l1_by !== me))
        .map(({ usual, l1_by: _l, check_pct, created_by: _cb, submitted_by: _sb, ...r }) => { const ck = checkOf(r.qty, usual, check_pct ?? set.checkPct); return { ...r, usual, warn: ck && !ck.ok ? ck.txt : null }; });
      const mine = (await c.query(
        `SELECT a.id, a.facility_id AS f, fo.name AS facility, CASE WHEN cat.code LIKE 'waste_%' THEN 'waste' WHEN cat.code LIKE 'water_%' THEN 'water' ELSE cat.code END AS cat, cat.name AS category,
                i.name AS item, a.period_start::text AS month, a.status, a.review_note, ur.name AS reviewed_by
           FROM activity a JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id JOIN org_node fo ON fo.id = a.facility_id LEFT JOIN app_user ur ON ur.id::text = a.reviewed_by
          WHERE a.facility_id = ANY($1) AND a.status IN ('draft', 'rejected', 'submitted') AND (a.created_by = $2 OR a.submitted_by = $2) ORDER BY a.period_start DESC LIMIT 300`, [facs, me])).rows;
      const batches = (await c.query(`SELECT count(*) FILTER (WHERE status = 'review')::int AS review, count(*) FILTER (WHERE status = 'failed')::int AS failed FROM purchase_batch`)).rows[0];
      // verifier: approved entries of the year, the largest first, and how many come with evidence (meter / bill, purchase file, scans, linked files)
      const approved = (await c.query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE (a.meter_id IS NOT NULL OR a.purchase_batch_id IS NOT NULL OR EXISTS (SELECT 1 FROM waste_scan ws2 WHERE ws2.activity_id = a.id) OR EXISTS (SELECT 1 FROM document_link dl WHERE dl.activity_id = a.id)))::int AS evidence, count(*) FILTER (WHERE a.self_reviewed)::int AS self
           FROM activity a WHERE a.facility_id = ANY($1) AND a.status = 'approved' AND extract(year FROM a.period_start) = $2`, [facs, year])).rows[0];
      const sample = (await c.query(
        `SELECT a.id, fo.name AS facility, cat.name AS category, a.period_start::text AS month, (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3)::float8 AS kg,
                ur.name AS approved_by, a.self_reviewed, (a.meter_id IS NOT NULL OR a.purchase_batch_id IS NOT NULL OR EXISTS (SELECT 1 FROM waste_scan ws2 WHERE ws2.activity_id = a.id) OR EXISTS (SELECT 1 FROM document_link dl WHERE dl.activity_id = a.id)) AS evidence
           FROM activity a JOIN category cat ON cat.id = a.category_id JOIN org_node fo ON fo.id = a.facility_id LEFT JOIN app_user ur ON ur.id::text = a.reviewed_by
          WHERE a.facility_id = ANY($1) AND a.status = 'approved' AND extract(year FROM a.period_start) = $2 ORDER BY 5 DESC LIMIT 6`, [facs, year])).rows;
      return {
        year, solo, users,
        settings: { dueDay: t.due_day, remindDays: t.remind_days, escalateDays: t.escalate_days, baseYear: t.base_year, target: { year: t.target_year, s12: t.s12, s3: t.s3 }, plan: t.plan, accessExpiry: t.access_expiry },
        facilities: facilities.map((f) => ({ ...f, usual: usual.filter((u) => u.f === f.id).map((u) => u.cat as string) })),
        cells, approvals, mine, batches, verifier: { ...approved, sample },
      };
    });
  });

  app.get('/api/kpis', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query('SELECT list, targets FROM kpi_config WHERE tenant_id = $1', [tenant])).rows[0];
      return { list: (r?.list as string[]) ?? ['tot', 'purch', 'div', 'ren', 'fleet', 'pemp'], targets: (r?.targets as Record<string, Record<string, number>>) ?? {},
        canTarget: ['platform_admin', 'super_admin', 'admin'].includes(req.user.role), canChoose: ['platform_admin', 'super_admin', 'admin', 'manager'].includes(req.user.role) };
    });
  });

  app.put('/api/kpis', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({
      list: z.array(z.enum(KPI_IDS)).min(1).max(12).optional(),
      key: z.string().max(80).optional(),
      targets: z.record(z.string(), z.number().finite().min(0).max(1e12)).refine((o) => Object.keys(o).every((k) => (KPI_IDS as readonly string[]).includes(k)), 'Unknown KPI').optional(),
    }).parse(req.body);
    if (b.list) requireRole(req, 'super_admin', 'admin', 'manager');
    if (b.targets !== undefined) { requireRole(req, 'super_admin', 'admin'); if (!b.key) throw new AppError('Which selection are the targets for?'); }
    return tenantTx(tenant, async (c) => {
      await c.query(`INSERT INTO kpi_config (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tenant]);
      if (b.list) await c.query('UPDATE kpi_config SET list = $2, updated_by = $3, updated_at = now() WHERE tenant_id = $1', [tenant, JSON.stringify(b.list), String(req.user.id)]);
      if (b.targets !== undefined && b.key) await c.query(`UPDATE kpi_config SET targets = jsonb_set(targets, ARRAY[$2], $3::jsonb, true), updated_by = $4, updated_at = now() WHERE tenant_id = $1`,
        [tenant, b.key, JSON.stringify(b.targets), String(req.user.id)]);
      await audit(c, req, 'kpis.update', 'kpi_config', tenant, { list: b.list, key: b.key, targets: b.targets });
      const r = (await c.query('SELECT list, targets FROM kpi_config WHERE tenant_id = $1', [tenant])).rows[0];
      return { list: r.list, targets: r.targets };
    });
  });
}
