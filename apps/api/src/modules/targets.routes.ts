/**
 * Targets & actions (as in the prototype).
 *
 *   GET    /api/targets                      everything the page needs: main targets, SBTi structure,
 *                                            objectives, scenarios, actions you can see, saved lever
 *                                            scenarios, supplier SBTi coverage, what you may change
 *   PUT    /api/targets                      main targets + SBTi structure + Net Zero year (super admin)
 *   POST   /api/targets/template             apply an SBTi template (super admin)
 *   POST   /api/targets/objectives           add an objective (super admin)
 *   DELETE /api/targets/objectives/:id
 *   POST   /api/scenarios {name, copy}        create a scenario, optionally with the current plan's actions
 *   DELETE /api/scenarios/:id                 (not the default one)
 *   POST   /api/actions                      add an action (library or custom)
 *   PATCH  /api/actions/:id                  change it (fields, scenarios, status, actual delivery)
 *   DELETE /api/actions/:id                  remove it (kept for the audit trail)
 *   POST   /api/levers / DELETE /api/levers/:id   saved lever scenarios (scenario lab)
 *
 * Who: everyone views. Managers and above (not verifiers) add and edit actions and scenarios, for the
 * whole company or a facility they can see. The super admin changes targets and the SBTi structure.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant, type User } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError } from '../lib/errors.js';

const ACT_ROLES = ['platform_admin', 'super_admin', 'admin', 'manager'] as const;
const TGT_ROLES = ['platform_admin', 'super_admin'] as const;
const canAct = (u: User) => (ACT_ROLES as readonly string[]).includes(u.role);
const canTarget = (u: User) => (TGT_ROLES as readonly string[]).includes(u.role);

export const SBTI_DEFAULT = { type: 'Near-term absolute reduction', scopes: '1 + 2; relevant Scope 3', cov12: 95, cov3: 67, ambition: '1.5 °C', status: 'Draft for submission', growth: 2, nzYear: 2040, resid: 10, template: null as string | null };
const STATUS = ['Idea', 'Approved', 'In progress', 'Done'] as const;
// SBTi templates: linear absolute contraction a year from the base year (Corporate Near-Term Criteria)
const TEMPLATES: Record<string, { rate12: number; rate3: number; amb: string; type: string; obj?: { name: string; scope: string; year: number | null; pct: number } }> = {
  nt15: { rate12: 4.2, rate3: 2.5, amb: '1.5 °C', type: 'Near-term absolute reduction' },
  wb2: { rate12: 2.5, rate3: 2.5, amb: 'Well-below 2 °C', type: 'Near-term absolute reduction' },
  nz: { rate12: 4.2, rate3: 2.5, amb: '1.5 °C · net zero 2050', type: 'Near-term + net-zero', obj: { name: 'Net zero · long-term (−90% all scopes)', scope: 'All scopes', year: 2050, pct: 90 } },
  int: { rate12: 4.2, rate3: 0, amb: '1.5 °C', type: 'Near-term absolute (S1+2) + supplier engagement (S3)', obj: { name: 'Supplier engagement · 67% of Scope 3 with SBTs', scope: 'Scope 3', year: null, pct: 0 } },
};

const num = z.coerce.number().finite();
const actionBody = z.object({
  lib: z.string().max(40).nullable().optional(),
  name: z.string().trim().min(1).max(200),
  cat: z.string().trim().max(40).optional(),
  scopes: z.array(z.number().int().min(1).max(3)).max(3).optional(),
  kpi: z.string().max(200).nullable().optional(),
  objVal: num.min(0).max(100).nullable().optional(),
  start: z.number().int().min(2000).max(2100),
  end: z.number().int().min(2000).max(2100),
  abate: num.min(0).max(1e9).optional(),
  capex: num.min(-1e12).max(1e12).optional(),
  opex: num.min(0).max(1e12).optional(),
  saving: num.min(-1e12).max(1e12).optional(),
  life: z.number().int().min(1).max(60).optional(),
  status: z.enum(STATUS).optional(),
  owner: z.string().max(120).nullable().optional(),
  facilityId: z.string().uuid().nullable().optional(),
  excluded: z.boolean().optional(),
  actual: num.min(0).max(1e9).nullable().optional(),
  actualNote: z.string().max(300).nullable().optional(),
  capexMeth: z.string().max(300).nullable().optional(),
  opexMeth: z.string().max(300).nullable().optional(),
  comment: z.string().max(1000).nullable().optional(),
  scenarioIds: z.array(z.string().uuid()).max(50).optional(),
});
const COLS: Record<string, string> = {
  lib: 'lib', name: 'name', cat: 'cat', scopes: 'scopes', kpi: 'kpi', objVal: 'obj_val', start: 'start_year', end: 'end_year', abate: 'abate', capex: 'capex', opex: 'opex', saving: 'saving',
  life: 'life', status: 'status', owner: 'owner', facilityId: 'facility_id', excluded: 'excluded', actual: 'actual', actualNote: 'actual_note', capexMeth: 'capex_meth', opexMeth: 'opex_meth',
  comment: 'comment', scenarioIds: 'scenario_ids',
};
const ACT_SELECT = `SELECT a.id, a.lib, a.name, a.cat, a.scopes, a.kpi, a.obj_val::float8 AS "objVal", a.start_year AS start, a.end_year AS end, a.abate::float8 AS abate,
  a.capex::float8 AS capex, a.opex::float8 AS opex, a.saving::float8 AS saving, a.life, a.status, a.owner, a.facility_id AS "facilityId", f.name AS facility, a.excluded,
  a.actual::float8 AS actual, a.actual_note AS "actualNote", a.capex_meth AS "capexMeth", a.opex_meth AS "opexMeth", a.comment, a.scenario_ids AS "scenarioIds", a.updated_at AS "updatedAt"
  FROM reduction_action a LEFT JOIN org_node f ON f.id = a.facility_id`;

async function defaultScenario(c: Tx, tenant: string, by: string) {
  const r = (await c.query(`SELECT id FROM scenario WHERE is_default`)).rows[0];
  if (r) return r.id as string;
  return (await c.query(`INSERT INTO scenario (tenant_id, name, is_default, created_by) VALUES ($1, 'Current plan', true, $2) RETURNING id`, [tenant, by])).rows[0].id as string;
}

export async function targetsRoutes(app: FastifyInstance) {
  app.get('/api/targets', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const t = (await c.query(`SELECT base_year, target_year, target_s12_pct::float8 AS s12, target_s3_pct::float8 AS s3, sbti, currency FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const def = await defaultScenario(c, tenant, String(req.user.id));
      const scenarios = (await c.query(`SELECT id, name, is_default AS "isDefault" FROM scenario ORDER BY is_default DESC, created_at`)).rows;
      const actions = (await c.query(`${ACT_SELECT} WHERE NOT a.deleted ORDER BY a.created_at`)).rows.filter((a) => !a.facilityId || s.see.has(a.facilityId));
      const objectives = (await c.query(`SELECT id, name, scope, target_year AS year, pct::float8 AS pct, growth::float8 AS growth FROM target_objective ORDER BY created_at`)).rows;
      const levers = (await c.query(`SELECT id, name, levers, end_t::float8 AS "end", year, created_at AS at FROM lever_scenario ORDER BY created_at DESC LIMIT 20`)).rows;
      // supplier SBTi coverage: share of purchase emissions from suppliers with a validated or committed SBTi target
      const y = q.year ?? new Date().getFullYear(), facs = [...s.see];
      const sup = (await c.query(
        `SELECT coalesce(sum(l.co2e), 0)::float8 AS t, coalesce(sum(l.co2e) FILTER (WHERE sp.climate_target IN ('sbti_validated', 'sbti_committed')), 0)::float8 AS sbt
           FROM purchase_line l JOIN activity a ON a.id = l.activity_id LEFT JOIN supplier sp ON sp.id = l.supplier_id
          WHERE l.status = 'published' AND a.status = 'approved' AND a.facility_id = ANY($1) AND extract(year FROM a.period_start) IN ($2::int, $2::int - 1)`, [facs, y])).rows[0];
      return {
        baseYear: t.base_year, currency: t.currency, target: { year: t.target_year, s12: t.s12, s3: t.s3 },
        sbti: { ...SBTI_DEFAULT, ...(t.sbti ?? {}) }, objectives, scenarios, defaultScenario: def, actions, levers,
        supplierCoverage: sup.t ? sup.sbt / sup.t : 0,
        canTarget: canTarget(req.user), canAct: canAct(req.user), facilities: facs,
      };
    });
  });

  app.put('/api/targets', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({
      year: z.number().int().min(2001).max(2070).optional(), s12: num.min(0).max(100).optional(), s3: num.min(0).max(100).optional(),
      sbti: z.object({
        type: z.string().max(120), scopes: z.string().max(120), cov12: num.min(0).max(100), cov3: num.min(0).max(100), ambition: z.string().max(60),
        status: z.string().max(60), growth: num.min(-20).max(30), nzYear: z.number().int().min(2025).max(2070), resid: num.min(0).max(50),
      }).partial().optional(),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const t = (await c.query(`SELECT base_year, target_year, sbti FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const year = b.year ?? t.target_year;
      if (t.base_year && year <= t.base_year) throw new AppError(`The target year must be after the base year (${t.base_year}).`);
      const sb = { ...SBTI_DEFAULT, ...(t.sbti ?? {}), ...(b.sbti ?? {}) };
      if (sb.nzYear <= year) throw new AppError('The Net Zero year must be after the near-term target year.');
      await c.query(`UPDATE tenant SET target_year = $2, target_s12_pct = coalesce($3, target_s12_pct), target_s3_pct = coalesce($4, target_s3_pct), sbti = $5 WHERE id = $1`,
        [tenant, year, b.s12 ?? null, b.s3 ?? null, JSON.stringify(sb)]);
      await audit(c, req, 'targets.update', 'tenant', tenant, b);
      return { ok: true };
    });
  });

  app.post('/api/targets/template', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ template: z.enum(['nt15', 'wb2', 'nz', 'int']), year: z.number().int().min(2001).max(2070) }).parse(req.body);
    const T = TEMPLATES[b.template]!;
    return tenantTx(tenant, async (c) => {
      const t = (await c.query(`SELECT base_year, sbti FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const base = t.base_year ?? new Date().getFullYear() - 1, n = b.year - base;
      if (n < 1) throw new AppError(`The target year must be after the base year (${base}).`);
      const s12 = Math.round(Math.min(90, T.rate12 * n) * 10) / 10, s3 = Math.round(Math.min(90, T.rate3 * n) * 10) / 10;
      const sb = { ...SBTI_DEFAULT, ...(t.sbti ?? {}), type: T.type, ambition: T.amb, template: b.template };
      await c.query(`UPDATE tenant SET target_year = $2, target_s12_pct = $3, target_s3_pct = $4, sbti = $5 WHERE id = $1`, [tenant, b.year, s12, s3, JSON.stringify(sb)]);
      if (T.obj) await c.query(`INSERT INTO target_objective (tenant_id, name, scope, target_year, pct, growth, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenant, T.obj.name, T.obj.scope, T.obj.year ?? b.year, T.obj.pct, sb.growth, String(req.user.id)]);
      await audit(c, req, 'targets.template', 'tenant', tenant, { template: b.template, year: b.year, s12, s3 });
      return { s12, s3, year: b.year };
    });
  });

  app.post('/api/targets/objectives', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ name: z.string().trim().min(1).max(160), scope: z.enum(['Scope 1+2', 'Scope 3', 'All scopes', 'Scope 1', 'Scope 2']), year: z.number().int().min(2001).max(2100), pct: num.min(0).max(100), growth: num.min(-50).max(50) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO target_objective (tenant_id, name, scope, target_year, pct, growth, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenant, b.name, b.scope, b.year, b.pct, b.growth, String(req.user.id)])).rows[0];
      await audit(c, req, 'targets.objective.add', 'target_objective', r.id, b);
      return { id: r.id };
    });
  });

  app.delete('/api/targets/objectives/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`DELETE FROM target_objective WHERE id = $1 RETURNING name`, [id])).rows[0];
      if (!r) throw new AppError('Objective not found', 404, 'NOT_FOUND');
      await audit(c, req, 'targets.objective.remove', 'target_objective', id, r);
      return { ok: true };
    });
  });

  app.post('/api/scenarios', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = z.object({ name: z.string().trim().min(1).max(80), copy: z.boolean().default(true) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const def = await defaultScenario(c, tenant, String(req.user.id));
      const id = (await c.query(`INSERT INTO scenario (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`, [tenant, b.name, String(req.user.id)])).rows[0].id as string;
      if (b.copy) await c.query(`UPDATE reduction_action SET scenario_ids = array_append(scenario_ids, $1::uuid) WHERE NOT deleted AND $2::uuid = ANY(scenario_ids)`, [id, def]);
      await audit(c, req, 'scenario.create', 'scenario', id, b);
      return { id };
    });
  });

  app.delete('/api/scenarios/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT name, is_default FROM scenario WHERE id = $1`, [id])).rows[0];
      if (!r) throw new AppError('Scenario not found', 404, 'NOT_FOUND');
      if (r.is_default) throw new AppError('The current plan cannot be removed.');
      await c.query(`UPDATE reduction_action SET scenario_ids = array_remove(scenario_ids, $1::uuid) WHERE $1::uuid = ANY(scenario_ids)`, [id]);
      await c.query(`DELETE FROM scenario WHERE id = $1`, [id]);
      await audit(c, req, 'scenario.remove', 'scenario', id, { name: r.name });
      return { ok: true };
    });
  });

  // facility must be one the user can see; scenarios must exist
  const check = async (c: Tx, user: User, b: Partial<z.infer<typeof actionBody>>) => {
    if (b.facilityId) { const s = await scopeOf(c, user); if (!s.see.has(b.facilityId)) throw new AppError('You cannot add actions for that facility.', 403, 'FORBIDDEN'); }
    if (b.scenarioIds?.length) {
      const n = Number((await c.query(`SELECT count(*)::int AS n FROM scenario WHERE id = ANY($1)`, [b.scenarioIds])).rows[0].n);
      if (n !== new Set(b.scenarioIds).size) throw new AppError('Unknown scenario.');
    }
  };

  app.post('/api/actions', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = actionBody.parse(req.body);
    if (b.end < b.start) throw new AppError('The end year is before the start year.');
    return tenantTx(tenant, async (c) => {
      await check(c, req.user, b);
      const ids = b.scenarioIds ?? [await defaultScenario(c, tenant, String(req.user.id))];
      const keys = Object.keys(b).filter((k) => k !== 'scenarioIds' && COLS[k] && (b as Record<string, unknown>)[k] !== undefined);
      const vals = keys.map((k) => (b as Record<string, unknown>)[k]);
      const r = (await c.query(
        `INSERT INTO reduction_action (tenant_id, ${keys.map((k) => COLS[k]).join(', ')}, scenario_ids, created_by, updated_by)
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}, $${keys.length + 2}, $${keys.length + 3}, $${keys.length + 3}) RETURNING id`,
        [tenant, ...vals, ids, String(req.user.id)])).rows[0];
      await audit(c, req, 'action.add', 'reduction_action', r.id, { name: b.name, lib: b.lib ?? null, abate: b.abate });
      return { id: r.id };
    });
  });

  app.patch('/api/actions/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = actionBody.partial().parse(req.body);
    return tenantTx(tenant, async (c) => {
      const cur = (await c.query(`SELECT facility_id, start_year, end_year, name FROM reduction_action WHERE id = $1 AND NOT deleted`, [id])).rows[0];
      if (!cur) throw new AppError('Action not found', 404, 'NOT_FOUND');
      if (cur.facility_id) { const s = await scopeOf(c, req.user); if (!s.see.has(cur.facility_id)) throw new AppError('Action not found', 404, 'NOT_FOUND'); }
      await check(c, req.user, b);
      if ((b.end ?? cur.end_year) < (b.start ?? cur.start_year)) throw new AppError('The end year is before the start year.');
      const keys = Object.keys(b).filter((k) => COLS[k] && (b as Record<string, unknown>)[k] !== undefined);
      if (!keys.length) return { ok: true };
      await c.query(`UPDATE reduction_action SET ${keys.map((k, i) => `${COLS[k]} = $${i + 2}`).join(', ')}, updated_by = $${keys.length + 2}, updated_at = now() WHERE id = $1`,
        [id, ...keys.map((k) => (b as Record<string, unknown>)[k]), String(req.user.id)]);
      await audit(c, req, 'action.update', 'reduction_action', id, { name: cur.name, ...b });
      return { ok: true };
    });
  });

  app.delete('/api/actions/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const cur = (await c.query(`SELECT facility_id, name FROM reduction_action WHERE id = $1 AND NOT deleted`, [id])).rows[0];
      if (!cur) throw new AppError('Action not found', 404, 'NOT_FOUND');
      if (cur.facility_id) { const s = await scopeOf(c, req.user); if (!s.see.has(cur.facility_id)) throw new AppError('Action not found', 404, 'NOT_FOUND'); }
      await c.query(`UPDATE reduction_action SET deleted = true, updated_by = $2, updated_at = now() WHERE id = $1`, [id, String(req.user.id)]);
      await audit(c, req, 'action.remove', 'reduction_action', id, { name: cur.name });
      return { ok: true };
    });
  });

  app.post('/api/levers', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = z.object({ name: z.string().trim().min(1).max(80), levers: z.record(z.string().max(20), num.min(-100).max(100)).refine((o) => Object.keys(o).length <= 12), end: num.min(0).max(1e12), year: z.number().int().min(2000).max(2100) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO lever_scenario (tenant_id, name, levers, end_t, year, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenant, b.name, JSON.stringify(b.levers), b.end, b.year, String(req.user.id)])).rows[0];
      await audit(c, req, 'levers.save', 'lever_scenario', r.id, b);
      return { id: r.id };
    });
  });

  app.delete('/api/levers/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      await c.query(`DELETE FROM lever_scenario WHERE id = $1`, [id]);
      await audit(c, req, 'levers.remove', 'lever_scenario', id);
      return { ok: true };
    });
  });
}
