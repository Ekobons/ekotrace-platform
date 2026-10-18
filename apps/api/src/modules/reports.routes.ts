/**
 * Reports (as in the prototype).
 *
 *   GET    /api/reports/lines?year&node&group&pend      the approved entries behind the report, one row each:
 *                                                     facility, month, GHG Protocol category, activity, quantity,
 *                                                     factor, tCO2e by part, data type, how captured, evidence
 *   GET    /api/reports/quality?year&node&group        quality controls with their warnings and justifications
 *   PUT    /api/reports/quality/:check {year, text}    justify a control's warnings (admin and above)
 *   GET    /api/reports/settings                       reporting entity, exclusion justifications, templates, versions
 *   PUT    /api/reports/settings {entity?, excl?}      (super admin)
 *   POST   /api/reports/templates / PUT /:id / DELETE /:id   report templates (admin and above)
 *   POST   /api/reports/versions / DELETE /:id         save the inventory as a version (admin and above)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf, subtreeFacilities } from '../lib/access.js';
import { AppError } from '../lib/errors.js';
import { approvalSettings, checksFor } from './approvals.routes.js';
import { EVIDENCE_SQL, METRIC_JOIN } from '../lib/collection.js';

const sel = z.object({ year: z.coerce.number().int().min(2000).max(2100), node: z.string().uuid().optional(), group: z.string().uuid().optional(), pend: z.enum(['0', '1']).optional() });

/** Facilities in the view (as on the dashboards): the subtree or group, within what the user may see. */
export async function viewFacs(c: Tx, req: FastifyRequest, q: z.infer<typeof sel>) {
  const see = (await scopeOf(c, req.user)).see;
  let within: Set<string> | null = q.node ? await subtreeFacilities(c, q.node) : null;
  if (q.group) {
    const g = (await c.query('SELECT facility_ids FROM dashboard_group WHERE id = $1', [q.group])).rows[0];
    if (!g || !(g.facility_ids as string[]).every((f) => see.has(f))) throw new AppError('Dashboard group not found', 404, 'NOT_FOUND');
    within = new Set(g.facility_ids as string[]);
  }
  return [...see].filter((f) => !within || within.has(f));
}
const CODE: Record<string, string> = { stationary_combustion: '1.1', mobile_combustion: '1.2', waste_treatment: '1.3', fugitive: '1.4', purchased_electricity: '2.1' };
const ADMIN = ['super_admin', 'admin'] as const;

export async function reportsRoutes(app: FastifyInstance) {
  app.get('/api/reports/lines', async (req) => {
    const tenant = requireTenant(req);
    const q = sel.parse(req.query);
    return tenantTx(tenant, async (c) => {
      const facs = await viewFacs(c, req, q);
      const t = (await c.query('SELECT consolidation FROM tenant WHERE id = $1', [tenant])).rows[0];
      const W = t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
      const rows = (await c.query(
        `SELECT a.id, a.facility_id AS f, f.name AS facility, CASE WHEN a.period_end - a.period_start < 40 THEN extract(month FROM a.period_start)::int ELSE 0 END AS m,
                a.period_start::text AS "from", a.period_end::text AS "to", cat.code AS cat, cat.name AS category, cat.scope, cat.ghg_category AS g3, i.name AS item, a.note,
                a.quantity::float8 AS qty, a.unit, a.data_type AS "dataType", a.inputs->>'method' AS method,
                (a.co2e_direct / 1000)::float8 AS s1, (a.co2e_scope2 / 1000)::float8 AS s2, (coalesce(a.co2e_scope2_market, a.co2e_scope2) / 1000)::float8 AS s2m,
                (a.co2e_scope3 / 1000)::float8 AS s3, ((a.co2e_wtt + coalesce(a.co2e_td, 0)) / 1000)::float8 AS s33, (${W})::float8 AS w,
                CASE WHEN a.meter_id IS NOT NULL THEN 'meter' WHEN a.purchase_batch_id IS NOT NULL THEN 'batch' WHEN a.commute_record_id IS NOT NULL THEN 'commute'
                     WHEN a.vehicle_id IS NOT NULL THEN 'fleet' ELSE 'form' END AS captured,
                (a.meter_id IS NOT NULL OR a.purchase_batch_id IS NOT NULL OR EXISTS (SELECT 1 FROM waste_scan ws2 WHERE ws2.activity_id = a.id) OR EXISTS (SELECT 1 FROM document_link dl WHERE dl.activity_id = a.id)) AS evidence, a.factors->0->>'source' AS source, a.status, coalesce(mt.name, v.name, ws.name) AS asset, un.dimension AS dim, f.country, pn.name AS division, (a.co2_biogenic / 1000)::float8 AS bio,
                (SELECT json_object_agg(x.fam, x.t) FROM (SELECT CASE WHEN g.family IN ('CO2', 'CH4', 'N2O', 'HFC', 'PFC', 'SF6', 'NF3') THEN g.family WHEN g.family IS NULL THEN 'CO2e (not split)' ELSE 'Other (non-Kyoto)' END AS fam,
                        sum(r.kg_co2e) / 1000 AS t FROM activity_result r LEFT JOIN gas g ON g.code = r.gas WHERE r.activity_id = a.id AND r.basis = 'direct' GROUP BY 1) x) AS gases
           FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id
           LEFT JOIN meter mt ON mt.id = a.meter_id LEFT JOIN vehicle v ON v.id = a.vehicle_id LEFT JOIN waste_site ws ON ws.id = a.waste_site_id LEFT JOIN unit un ON un.code = a.unit LEFT JOIN org_node pn ON pn.id = f.parent_id
          WHERE a.facility_id = ANY($1) AND extract(year FROM a.period_start) = $2 AND ${q.pend === '1' ? `a.status <> 'rejected'` : `a.status = 'approved'`}
          ORDER BY a.period_start, f.name LIMIT 50000`, [facs, q.year])).rows;
      return { lines: rows.map(({ dim, ...r }) => ({ ...r, code: r.scope === 3 ? `3.${r.g3}` : r.cat === 'purchased_electricity' && (dim === 'cooling' || dim === 'heat') ? '2.2' : CODE[r.cat] ?? `${r.scope}.1` })) };
    });
  });

  app.get('/api/reports/quality', async (req) => {
    const tenant = requireTenant(req);
    const q = sel.parse(req.query);
    return tenantTx(tenant, async (c) => {
      const facs = await viewFacs(c, req, q), set = await approvalSettings(c, tenant);
      const nm = (r: { facility: string; item: string; month: string }) => `${r.facility} · ${r.item} · ${r.month.slice(0, 7)}`;
      const base = `FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN item i ON i.id = a.item_id JOIN category cat ON cat.id = a.category_id
                    WHERE a.facility_id = ANY($1) AND extract(year FROM a.period_start) = $2`;
      const q2 = async (sql: string) => (await c.query(sql, [facs, q.year])).rows;
      // metric registry: its own check limit, and whether it needs evidence
      const baseM = base.replace('WHERE a.facility_id', `${METRIC_JOIN} WHERE a.facility_id`);
      const oddRows = await q2(`SELECT a.id, a.facility_id::text AS f, a.item_id AS iid, a.unit, coalesce(a.vehicle_id::text, a.meter_id::text, '') AS sub, true AS monthly, f.name AS facility, i.name AS item, a.period_start::text AS month, a.quantity::float8 AS qty, mt.check_pct ${baseM}
                               AND a.status IN ('approved', 'submitted') AND coalesce(trim(a.note), '') = '' AND a.period_end - a.period_start < 40`);
      const oddCk = await checksFor(c, set, oddRows);
      const odd = oddRows.flatMap((r) => { const k = oddCk.get(r.id); return k && !k.ok ? [`${nm(r)} — ${k.txt.replace(/ — add a note$/, '')}, no explanation`] : []; });
      const reqev = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month, mt.metric_code ${baseM}
                                 AND a.status IN ('approved', 'submitted') AND mt.evidence = 'required' AND NOT ${EVIDENCE_SQL} ORDER BY 3 LIMIT 500`)).map((r) => `${nm(r)} · ${r.metric_code}`);
      const noev = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month ${base}
                               AND a.status = 'approved' AND cat.code IN ('purchased_electricity', 'stationary_combustion', 'water_supply') AND a.meter_id IS NULL ORDER BY 3 LIMIT 500`)).map(nm);
      const spend = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month ${base}
                                AND a.status = 'approved' AND a.inputs->>'method' = 'spend' ORDER BY 3 LIMIT 500`)).map(nm);
      const dup = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month, a.quantity::float8 AS qty, a.unit, count(*)::int AS n ${base}
                              AND a.status IN ('approved', 'submitted') AND a.purchase_batch_id IS NULL
                              GROUP BY f.name, i.name, a.period_start, a.quantity, a.unit, a.item_id HAVING count(*) > 1 ORDER BY 3`))
        .map((r) => `${nm(r)} · ${r.qty} ${r.unit} × ${r.n}`);
      const old = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month, a.submitted_at ${base}
                              AND a.status = 'submitted' AND a.submitted_at < now() - interval '14 days' ORDER BY a.submitted_at`))
        .map((r) => `${nm(r)} · waiting since ${new Date(r.submitted_at).toLocaleDateString('en-GB')}`);
      const self = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month, ur.name AS by, coalesce(a.self_review_note, '') AS note ${base.replace('WHERE a.facility_id', 'LEFT JOIN app_user ur ON ur.id::text = a.reviewed_by WHERE a.facility_id')}
                               AND a.status = 'approved' AND a.self_reviewed ORDER BY 3 LIMIT 500`)).map((r) => `${nm(r)} · ${r.by ?? '—'}${r.note ? ` · “${r.note}”` : ''}`);
      const est = (await q2(`SELECT f.name AS facility, i.name AS item, a.period_start::text AS month ${base}
                              AND a.status = 'approved' AND a.data_type <> 'actual' AND coalesce(trim(a.note), '') = '' AND a.commute_record_id IS NULL`)).map((r) => `${nm(r)} · estimated without a basis note`);
      // required data missing: the categories each facility reports (this year or last), months before this one
      const now = new Date(), open = q.year < now.getFullYear() ? 12 : q.year > now.getFullYear() ? 0 : now.getMonth();
      const usual = await q2(`SELECT DISTINCT f.name AS facility, a.facility_id AS fid, CASE WHEN cat.code LIKE 'waste_%' THEN 'waste' WHEN cat.code LIKE 'water_%' THEN 'water' ELSE cat.code END AS cat,
                                CASE WHEN cat.code LIKE 'waste_%' THEN 'Waste' WHEN cat.code LIKE 'water_%' THEN 'Water' ELSE cat.name END AS name
                               FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN category cat ON cat.id = a.category_id
                              WHERE a.facility_id = ANY($1) AND extract(year FROM a.period_start) IN ($2::int, $2::int - 1) AND a.period_end - a.period_start < 366
                                AND cat.calc_method NOT IN ('spend', 'travel') AND a.purchase_batch_id IS NULL`);
      const have = new Set((await q2(`SELECT DISTINCT a.facility_id AS fid, CASE WHEN cat.code LIKE 'waste_%' THEN 'waste' WHEN cat.code LIKE 'water_%' THEN 'water' ELSE cat.code END AS cat, extract(month FROM mo.d)::int AS m
                                        FROM activity a JOIN category cat ON cat.id = a.category_id CROSS JOIN LATERAL generate_series(date_trunc('month', a.period_start), date_trunc('month', a.period_end), interval '1 month') AS mo(d)
                                       WHERE a.facility_id = ANY($1) AND extract(year FROM mo.d) = $2 AND a.status <> 'rejected'`)).map((r) => `${r.fid}|${r.cat}|${r.m}`));
      const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const miss: string[] = [];
      for (const u of usual) for (let m = 1; m <= open; m++) if (!have.has(`${u.fid}|${u.cat}|${m}`)) miss.push(`${u.facility} · ${u.name} · ${MN[m - 1]} ${q.year}`);
      const just = Object.fromEntries((await c.query(`SELECT j.check_id, j.text, u.name AS by, j.created_at AS at FROM report_justification j LEFT JOIN app_user u ON u.id::text = j.created_by WHERE j.year = $1`, [q.year])).rows.map((r) => [r.check_id, { text: r.text, by: r.by, at: r.at }]));
      const checks: [string, string, string, string[]][] = [
        ['missing', 'Data missing in months so far (categories the facility reports)', 'Completeness', miss],
        ['odd', set.checkMethod === 'smart' ? 'Values outside their usual range (season and trend) without a note' : `Values more than ${set.checkPct}% off the 6-month average without a note`, 'Outliers', odd],
        ['noev', 'Electricity, fuel and water entries approved without a bill or meter', 'Evidence', noev],
        ['reqev', 'Entries of metrics that require evidence (metric registry), without it', 'Evidence', reqev],
        ['spend', 'Purchases calculated with spend averages (not supplier-specific)', 'Emission factors', spend],
        ['dup', 'Possible double counting (same facility, month, item and quantity)', 'Double counting', dup],
        ['est', 'Estimated data without a note on how it was estimated', 'Data type', est],
        ['old', 'Entries waiting for approval more than 14 days', 'Workflow', old],
        ['self', 'Entries approved by the person who entered or submitted them (self-reviewed)', 'Segregation of duties', self],
      ];
      return { checks: checks.map(([id, name, area, items]) => ({ id, name, area, n: items.length, items: items.slice(0, 200), justified: just[id] ?? null })), canJustify: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role) };
    });
  });

  app.put('/api/reports/quality/:check', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const { check } = z.object({ check: z.enum(['missing', 'odd', 'noev', 'reqev', 'spend', 'dup', 'est', 'old', 'self']) }).parse(req.params);
    const b = z.object({ year: z.number().int().min(2000).max(2100), text: z.string().trim().max(1000) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!b.text) await c.query(`DELETE FROM report_justification WHERE year = $1 AND check_id = $2`, [b.year, check]);
      else await c.query(`INSERT INTO report_justification (tenant_id, year, check_id, text, created_by) VALUES ($1,$2,$3,$4,$5)
                          ON CONFLICT (tenant_id, year, check_id) DO UPDATE SET text = EXCLUDED.text, created_by = EXCLUDED.created_by, created_at = now()`, [tenant, b.year, check, b.text, String(req.user.id)]);
      await audit(c, req, 'report.justify', 'report', check, b);
      return { ok: true };
    });
  });

  app.get('/api/reports/settings', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const t = (await c.query(`SELECT name, country, consolidation, gwp_set, base_year, currency, logo_id, report FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const templates = (await c.query(`SELECT id, base, name, audience, note, sections FROM report_template ORDER BY updated_at`)).rows;
      const versions = (await c.query(`SELECT v.id, v.name, v.label, v.period, v.scope2, v.s1::float8 AS s1, v.s2::float8 AS s2, v.s3::float8 AS s3, v.by_code AS "byCode", u.name AS by, v.created_at AS at
                                         FROM report_version v LEFT JOIN app_user u ON u.id::text = v.created_by ORDER BY v.created_at DESC`)).rows;
      // base-year restatements approved for the current base year (applied, or recorded below the threshold)
      const restatements = (await c.query(
        `SELECT r.title, r.trigger, f.name AS facility, r.effective::text, r.s1_t::float8 AS s1, r.s2_t::float8 AS s2, coalesce(r.s2m_t, r.s2_t)::float8 AS s2m, r.s3_t::float8 AS s3,
                r.pct::float8 AS pct, r.applied, r.proposed_name, r.decided_name, r.decided_at
           FROM base_restatement r LEFT JOIN org_node f ON f.id = r.facility_id WHERE r.status = 'approved' AND r.base_year = $1 ORDER BY r.decided_at`, [t.base_year])).rows;
      const threshold = Number((await c.query(`SELECT restate_threshold FROM tenant WHERE id = $1`, [tenant])).rows[0].restate_threshold);
      // carbon credits retired (approved), reported separately from the inventory, by the year they are used for
      const credits = (await c.query(
        `SELECT r.claim_year, r.quantity::float8 AS t, r.retired_on::text, r.purpose, r.serials, r.registry_url, l.project, l.project_id, l.registry, l.category, l.vintage, l.ccp, l.ca, l.corsia
           FROM carbon_credit_retirement r JOIN carbon_credit_lot l ON l.id = r.lot_id WHERE r.status = 'approved' ORDER BY r.claim_year, r.retired_on`)).rows;
      return {
        restatements, restateThreshold: threshold, credits,
        company: { name: t.name, country: t.country, consolidation: t.consolidation, gwp: t.gwp_set, baseYear: t.base_year, currency: t.currency, hasLogo: !!t.logo_id },
        entity: (({ emirate, ...e }) => ({ ...e, region: e.region ?? emirate }))(t.report?.entity ?? {}), excl: t.report?.excl ?? {}, templates, versions,
        canEntity: ['super_admin', 'platform_admin'].includes(req.user.role), canEdit: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role),
      };
    });
  });

  app.put('/api/reports/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const str = z.string().trim().max(300);
    const b = z.object({
      entity: z.object({ legal: str, licence: str, lei: str, region: str, emirate: str, sector: str, sectorCode: str, mrvId: str, contact: str, website: str,
        revenue: z.number().min(0).max(1e15).nullable(), revenueCurrency: z.string().regex(/^[A-Z]{3}$/), fyEnd: z.string().regex(/^\d{2}-\d{2}$/) }).partial().optional(),
      excl: z.record(z.string().regex(/^[13]\.\d{1,2}$/), z.string().trim().max(500)).optional(),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const cur = (await c.query(`SELECT report FROM tenant WHERE id = $1`, [tenant])).rows[0].report ?? {};
      const next = { ...cur, ...(b.entity ? { entity: { ...(cur.entity ?? {}), ...b.entity } } : {}), ...(b.excl ? { excl: { ...(cur.excl ?? {}), ...b.excl } } : {}) };
      await c.query(`UPDATE tenant SET report = $2 WHERE id = $1`, [tenant, JSON.stringify(next)]);
      await audit(c, req, 'report.settings', 'tenant', tenant, b);
      return next;
    });
  });

  const tpl = z.object({ base: z.string().regex(/^[a-z0-9_]{2,20}$/).nullable().optional(), name: z.string().trim().min(1).max(120), audience: z.string().trim().max(120).optional(), note: z.string().trim().max(1000).optional(),
    sections: z.array(z.string().max(20)).min(1).max(30) });
  app.post('/api/reports/templates', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const b = tpl.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.base) await c.query(`DELETE FROM report_template WHERE base = $1`, [b.base]);
      const r = (await c.query(`INSERT INTO report_template (tenant_id, base, name, audience, note, sections, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenant, b.base ?? null, b.name, b.audience ?? null, b.note ?? null, b.sections, String(req.user.id)])).rows[0];
      await audit(c, req, 'report.template.save', 'report_template', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/reports/templates/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = tpl.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE report_template SET name = $2, audience = $3, note = $4, sections = $5, updated_at = now() WHERE id = $1`, [id, b.name, b.audience ?? null, b.note ?? null, b.sections]);
      if (!r.rowCount) throw new AppError('Template not found', 404, 'NOT_FOUND');
      await audit(c, req, 'report.template.save', 'report_template', id, b);
      return { id };
    });
  });
  app.delete('/api/reports/templates/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      await c.query(`DELETE FROM report_template WHERE id = $1`, [id]);
      await audit(c, req, 'report.template.remove', 'report_template', id);
      return { ok: true };
    });
  });

  app.post('/api/reports/versions', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const n = z.number().finite().min(-1e12).max(1e12);
    const b = z.object({ name: z.string().trim().min(1).max(120), label: z.string().max(200), period: z.string().max(60), scope2: z.enum(['location', 'market']), s: z.tuple([n, n, n]),
      byCode: z.record(z.string().regex(/^[123]\.\d{1,2}$/), n) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO report_version (tenant_id, name, label, period, scope2, s1, s2, s3, by_code, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, b.name, b.label, b.period, b.scope2, b.s[0], b.s[1], b.s[2], JSON.stringify(b.byCode), String(req.user.id)])).rows[0];
      await audit(c, req, 'report.version.save', 'report_version', r.id, { name: b.name, label: b.label, period: b.period, s: b.s });
      return { id: r.id };
    });
  });
  app.delete('/api/reports/versions/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      await c.query(`DELETE FROM report_version WHERE id = $1`, [id]);
      await audit(c, req, 'report.version.remove', 'report_version', id);
      return { ok: true };
    });
  });
}
