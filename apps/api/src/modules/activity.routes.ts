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
import { requirePlatformAdmin, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { calcInputSchema, calculate } from './calc.service.js';

async function tenantSettings(tenantId: string) {
  const [t] = await query('SELECT id, name, country, gwp_set FROM tenant WHERE id = $1', [tenantId]);
  if (!t) throw notFound('Company');
  return t as { id: string; name: string; country: string; gwp_set: string };
}

export async function activityRoutes(app: FastifyInstance) {
  // ------------------------------------------------- companies, facilities --
  app.get('/api/tenants', async (req) => {
    requirePlatformAdmin(req);
    return { tenants: await query('SELECT id, name, country, gwp_set, created_at FROM tenant ORDER BY name') };
  });

  app.post('/api/admin/tenants', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({ name: z.string().min(2).max(160), country: z.string().length(2).default('AE'), gwpSet: z.enum(['AR4', 'AR5', 'AR6']).default('AR5') }).parse(req.body);
    const [r] = await query('INSERT INTO tenant (name, country, gwp_set) VALUES ($1,$2,$3) RETURNING *', [b.name, b.country.toUpperCase(), b.gwpSet]);
    return r;
  });

  app.get('/api/tenant', async (req) => tenantSettings(requireTenant(req)));

  app.patch('/api/tenant', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ gwpSet: z.enum(['AR4', 'AR5', 'AR6']).optional(), country: z.string().length(2).optional() }).parse(req.body);
    const [r] = await query('UPDATE tenant SET gwp_set = COALESCE($2, gwp_set), country = COALESCE($3, country) WHERE id = $1 RETURNING *', [tenant, b.gwpSet ?? null, b.country?.toUpperCase() ?? null]);
    return r;
  });

  app.get('/api/facilities', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => ({ facilities: (await c.query('SELECT id, name, country, active FROM facility ORDER BY name')).rows }));
  });

  app.post('/api/facilities', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ name: z.string().min(1).max(160), country: z.string().length(2).optional() }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => (await c.query('INSERT INTO facility (tenant_id, name, country) VALUES ($1,$2,$3) RETURNING *',
      [tenant, b.name, (b.country ?? t.country).toUpperCase()])).rows[0]);
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
        const f = await tenantTx(t.id, async (c) => (await c.query('SELECT country FROM facility WHERE id = $1', [input.facilityId])).rows[0]);
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
      const fac = (await c.query('SELECT id, country FROM facility WHERE id = $1 AND active', [b.facilityId])).rows[0];
      if (!fac) throw notFound('Facility');
      const { result, item, gwpSet } = await calculate(b, { gwpSet: t.gwp_set, region: fac.country });
      const quantity = b.quantity ?? result.lines.reduce((s, l) => s + (l.kgGas ?? 0), 0);
      const a = (await c.query(
        `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                               co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, steps, warnings, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id, created_at`,
        [tenant, fac.id, item.category_id, item.id, b.periodStart, b.periodEnd, quantity, b.unit, JSON.stringify(b.fugitive ?? {}), b.dataType, gwpSet,
         result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo,
         JSON.stringify(result.steps), JSON.stringify(result.warnings), b.note ?? null, req.user.id])).rows[0];
      if (result.lines.length) {
        await c.query(
          `INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
          [a.id, tenant, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas),
           result.lines.map((l) => l.kgCo2e), result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)],
        );
      }
      return { id: a.id, createdAt: a.created_at, item: item.name, gwpSet, totals: result.totals, warnings: result.warnings };
    });
  });

  app.get('/api/activities', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional(), year: z.coerce.number().int().optional(), category: z.string().optional(), limit: z.coerce.number().int().max(1000).default(200) }).parse(req.query);
    return tenantTx(tenant, async (c) => ({
      activities: (await c.query(
        `SELECT a.id, a.period_start, a.period_end, f.name AS facility, cat.name AS category, i.name AS item, a.quantity, a.unit, a.data_type, a.gwp_set,
                a.co2e_direct, a.co2e_wtt, a.co2_biogenic, a.co2e_memo, a.status, a.created_at
           FROM activity a JOIN facility f ON f.id = a.facility_id JOIN item i ON i.id = a.item_id JOIN category cat ON cat.id = a.category_id
          WHERE ($1::uuid IS NULL OR a.facility_id = $1) AND ($2::int IS NULL OR extract(year FROM a.period_start) = $2) AND ($3::text IS NULL OR cat.code = $3)
          ORDER BY a.period_start DESC, a.created_at DESC LIMIT $4`, [q.facilityId ?? null, q.year ?? null, q.category ?? null, q.limit])).rows,
    }));
  });

  app.get('/api/activities/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const a = (await c.query('SELECT a.*, i.name AS item FROM activity a JOIN item i ON i.id = a.item_id WHERE a.id = $1', [id])).rows[0];
      if (!a) throw notFound('Entry');
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
    return tenantTx(tenant, async (c) => ({
      year: q.year,
      rows: (await c.query(
        `SELECT cat.scope, cat.name AS category, r.basis, r.gas, sum(r.kg_gas) AS kg_gas, sum(r.kg_co2e) AS kg_co2e
           FROM activity_result r JOIN activity a ON a.id = r.activity_id JOIN category cat ON cat.id = a.category_id
          WHERE extract(year FROM a.period_start) = $1 GROUP BY 1,2,3,4 ORDER BY 1,2,3, kg_co2e DESC`, [q.year])).rows,
    }));
  });
}

