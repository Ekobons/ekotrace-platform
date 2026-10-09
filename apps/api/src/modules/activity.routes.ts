/**
 * Data entry: companies (tenants), facilities, calculate (preview) and save.
 *
 * Saving stores what the user entered, the result per gas and per basis, and
 * the calculation steps — so every number on a dashboard can be traced back
 * to the entry, the factor and its source.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { calcInputSchema, calculate } from './calc.service.js';

async function tenantSettings(tenantId: string) {
  const [t] = await query('SELECT id, name, country, gwp_set, consolidation, base_year, plan, status, access_expiry FROM tenant WHERE id = $1', [tenantId]);
  if (!t) throw notFound('Company');
  return t as { id: string; name: string; country: string; gwp_set: string; consolidation: string; base_year: number };
}

export async function activityRoutes(app: FastifyInstance) {
  // ------------------------------------------------ company settings --
  app.get('/api/tenant', async (req) => tenantSettings(requireTenant(req)));

  /** Methodology & boundaries (Super admin): consolidation approach, GWP set, base year, country. */
  app.patch('/api/tenant', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({
      gwpSet: z.enum(['AR4', 'AR5', 'AR6']).optional(), country: z.string().length(2).optional(),
      consolidation: z.enum(['operational', 'financial', 'equity']).optional(), baseYear: z.number().int().min(2000).max(2100).optional(),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`UPDATE tenant SET gwp_set = COALESCE($2, gwp_set), country = COALESCE($3, country),
                                  consolidation = COALESCE($4, consolidation), base_year = COALESCE($5, base_year)
                                WHERE id = $1 RETURNING id, name, country, gwp_set, consolidation, base_year`,
        [tenant, b.gwpSet ?? null, b.country?.toUpperCase() ?? null, b.consolidation ?? null, b.baseYear ?? null])).rows[0];
      await audit(c, req, 'methodology.update', 'tenant', tenant, b);
      return r;
    });
  });

  /**
   * Boundaries: each facility's emissions for a year and what the company total
   * is under each consolidation approach (GHG Protocol chapter 3):
   *   operational control  100 % of facilities the company operates, 0 % otherwise
   *   financial control    100 % of facilities it financially controls
   *   equity share         ownership % of every facility
   */
  app.get('/api/boundaries', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const rows = (await c.query(
        `SELECT f.id, f.name, p.name AS parent_name, f.ownership_pct, f.operational_control, f.financial_control,
                COALESCE(sum(a.co2e_direct), 0) AS co2e_direct, COALESCE(sum(a.co2e_wtt), 0) AS co2e_wtt
           FROM org_node f LEFT JOIN org_node p ON p.id = f.parent_id
           LEFT JOIN activity a ON a.facility_id = f.id AND extract(year FROM a.period_start) = $1
          WHERE f.kind = 'facility' AND f.active GROUP BY f.id, p.name ORDER BY p.name, f.name`, [q.year])).rows
        .filter((r) => scope.see.has(r.id));
      const total = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + Number(r.co2e_direct) * pick(r), 0);
      const t = (await c.query('SELECT consolidation FROM tenant WHERE id = $1', [tenant])).rows[0];
      return {
        year: q.year, current: t.consolidation, facilities: rows,
        totals: {
          operational: total((r) => (r.operational_control ? 1 : 0)),
          financial: total((r) => (r.financial_control ? 1 : 0)),
          equity: total((r) => Number(r.ownership_pct) / 100),
        },
      };
    });
  });

  /** Facilities this person can see, with what they may do there. */
  app.get('/api/facilities', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const rows = (await c.query(
        `SELECT f.id, f.name, f.country, f.active, f.facility_type, p.name AS parent_name
           FROM org_node f LEFT JOIN org_node p ON p.id = f.parent_id
          WHERE f.kind = 'facility' AND f.active ORDER BY p.name NULLS FIRST, f.name`)).rows;
      return { facilities: rows.filter((f) => scope.see.has(f.id)).map((f) => ({ ...f, canEnter: scope.enter.has(f.id), canApprove: scope.approve.has(f.id) })) };
    });
  });

  // ------------------------------------------------------------ calculate --
  /** Preview: calculate without saving. Used by the entry form as the user types. */
  app.post('/api/calculate', async (req) => {
    const input = calcInputSchema.extend({ facilityId: z.string().uuid().optional() }).parse(req.body);
    let ctx = { gwpSet: 'AR5', region: 'GLOBAL' };
    if (req.user.tenantId) {
      const t = await tenantSettings(req.user.tenantId);
      ctx = { gwpSet: t.gwp_set, region: t.country };
      if (input.facilityId) {
        const f = await tenantTx(t.id, async (c) => (await c.query(`SELECT country FROM org_node WHERE id = $1 AND kind = 'facility'`, [input.facilityId])).rows[0]);
        if (!f) throw notFound('Facility');
        ctx.region = f.country;
      }
    }
    const { result, item, gwpSet } = await calculate(input, ctx);
    return { item: { id: item.id, name: item.name, category: item.category }, gwpSet, ...result };
  });

  // ---------------------------------------------------------- save / list --
  const saveSchema = calcInputSchema.extend({
    facilityId: z.string().uuid(),
    dataType: z.enum(['actual', 'estimated', 'proxy']).default('actual'),
    note: z.string().max(1000).optional(),
  }).omit({ gwpSet: true, region: true });

  app.post('/api/activities', async (req) => {
    const tenant = requireTenant(req);
    const b = saveSchema.parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const fac = (await c.query(`SELECT id, country FROM org_node WHERE id = $1 AND kind = 'facility' AND active`, [b.facilityId])).rows[0];
      if (!fac) throw notFound('Facility');
      assertCan((await scopeOf(c, req.user)).enter, fac.id, 'enter data for this facility');
      const { result, item, gwpSet } = await calculate(b, { gwpSet: t.gwp_set, region: fac.country });
      const quantity = b.quantity ?? result.lines.reduce((s, l) => s + (l.kgGas ?? 0), 0);
      const a = (await c.query(
        `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                               co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, steps, warnings, note, created_by, factors)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id, created_at`,
        [tenant, fac.id, item.category_id, item.id, b.periodStart, b.periodEnd, quantity, b.unit, JSON.stringify(b.fugitive ?? (result.cv ? { cv: result.cv } : {})), b.dataType, gwpSet,
         result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo,
         JSON.stringify(result.steps), JSON.stringify(result.warnings), b.note ?? null, req.user.id, JSON.stringify(result.factors)])).rows[0];
      if (result.lines.length) {
        await c.query(
          `INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
          [a.id, tenant, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas),
           result.lines.map((l) => l.kgCo2e), result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)],
        );
      }
      await audit(c, req, 'activity.create', 'activity', a.id, { facility: fac.id, item: item.name, period: b.periodStart, quantity, unit: b.unit, co2e: result.totals.direct });
      return { id: a.id, createdAt: a.created_at, item: item.name, gwpSet, totals: result.totals, warnings: result.warnings };
    });
  });

  app.get('/api/activities', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional(), year: z.coerce.number().int().optional(), category: z.string().optional(), limit: z.coerce.number().int().max(1000).default(200) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const see = [...(await scopeOf(c, req.user)).see];
      return {
        activities: (await c.query(
          `SELECT a.id, a.facility_id, a.period_start, a.period_end, f.name AS facility, cat.name AS category, i.name AS item, a.quantity, a.unit, a.data_type, a.gwp_set,
                  a.co2e_direct, a.co2e_wtt, a.co2_biogenic, a.co2e_memo, a.status, a.created_at
             FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN item i ON i.id = a.item_id JOIN category cat ON cat.id = a.category_id
            WHERE a.facility_id = ANY($5) AND ($1::uuid IS NULL OR a.facility_id = $1) AND ($2::int IS NULL OR extract(year FROM a.period_start) = $2) AND ($3::text IS NULL OR cat.code = $3)
            ORDER BY a.period_start DESC, a.created_at DESC LIMIT $4`, [q.facilityId ?? null, q.year ?? null, q.category ?? null, q.limit, see])).rows,
      };
    });
  });

  app.get('/api/activities/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const a = (await c.query('SELECT a.*, i.name AS item FROM activity a JOIN item i ON i.id = a.item_id WHERE a.id = $1', [id])).rows[0];
      if (!a || !(await scopeOf(c, req.user)).see.has(a.facility_id)) throw notFound('Entry');
      const lines = (await c.query(
        `SELECT r.basis, r.gas, r.kg_gas, r.kg_co2e, r.method, r.factor_id, s.code AS source
           FROM activity_result r LEFT JOIN factor f ON f.id = r.factor_id LEFT JOIN factor_source s ON s.id = f.source_id
          WHERE r.activity_id = $1 ORDER BY r.basis, r.kg_co2e DESC`, [id])).rows;
      return { ...a, lines };
    });
  });

  /** Totals per gas for a year — the "other greenhouse gases" view. */
  app.get('/api/reports/by-gas', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const see = [...(await scopeOf(c, req.user)).see];
      return {
        year: q.year,
        rows: (await c.query(
          `SELECT cat.scope, cat.name AS category, r.basis, r.gas, sum(r.kg_gas) AS kg_gas, sum(r.kg_co2e) AS kg_co2e
             FROM activity_result r JOIN activity a ON a.id = r.activity_id JOIN category cat ON cat.id = a.category_id
            WHERE extract(year FROM a.period_start) = $1 AND a.facility_id = ANY($2) GROUP BY 1,2,3,4 ORDER BY 1,2,3, kg_co2e DESC`, [q.year, see])).rows,
      };
    });
  });
}

