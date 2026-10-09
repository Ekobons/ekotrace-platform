/**
 * Data entry: companies (tenants), facilities, calculate (preview) and save.
 *
 * Saving stores what the user entered, the result per gas and per basis, and
 * the calculation steps — so every number on a dashboard can be traced back
 * to the entry, the factor and its source.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { query, tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { calcInputSchema, calculate, findPrice, type CalcContext, type CalcInput } from './calc.service.js';
import type { Tx } from '../db/pool.js';
import { syncMeter, type MeterRow } from './meters.routes.js';

/**
 * A fleet vehicle chosen for the entry: its type, fuel and charging become the
 * defaults, and it must belong to the facility and be in service in the period.
 */
async function applyFleetVehicle(c: Tx, input: CalcInput & { facilityId?: string }) {
  const id = input.vehicle?.vehicleId;
  if (!id) return null;
  const v = (await c.query('SELECT * FROM vehicle WHERE id = $1', [id])).rows[0];
  if (!v) throw notFound('Vehicle');
  if (input.facilityId && v.facility_id !== input.facilityId) throw new AppError(`${v.name} belongs to another facility`);
  const from = String(v.in_service_from instanceof Date ? v.in_service_from.toISOString().slice(0, 10) : v.in_service_from);
  const retired = v.retired_on ? String(v.retired_on instanceof Date ? v.retired_on.toISOString().slice(0, 10) : v.retired_on) : null;
  if (from > input.periodEnd) throw new AppError(`${v.name} entered service on ${from}, after this period`);
  if (retired && retired < input.periodStart) throw new AppError(`${v.name} was retired on ${retired}, before this period`);
  input.itemId = v.item_id;
  input.vehicle = { ...input.vehicle!, fuelItemId: input.vehicle!.fuelItemId ?? v.fuel_item_id ?? undefined, charging: input.vehicle!.charging ?? v.charging ?? undefined };
  return v as { id: string; name: string };
}

/** Everything a calculation may need to look up inside the company's transaction. */
export function contextFor(c: Tx, gwpSet: string, region: string, fac?: { id: string; grid_region?: string | null }, activityId?: string): CalcContext {
  return {
    gwpSet, region, gridRegion: fac?.grid_region ?? null, facilityId: fac?.id, activityId,
    lookupPrice: (itemId, r, date, currency) => findPrice(c, itemId, r, date, currency),
    lookupWasteSite: async (id) => {
      const s = (await c.query('SELECT id, name, facility_id, params FROM waste_site WHERE id = $1', [id])).rows[0];
      if (!s) return null;
      const deposits = (await c.query('SELECT year, waste_type AS type, tonnes FROM waste_deposit WHERE site_id = $1 ORDER BY year', [id])).rows
        .map((d) => ({ year: Number(d.year), type: String(d.type), tonnes: Number(d.tonnes) }));
      return { ...s, deposits };
    },
    lookupSupplier: async (id) => {
      const s = (await c.query('SELECT supplier, energy, co2e, unit, source, valid_from::text, valid_to::text FROM supplier_factor WHERE id = $1', [id])).rows[0];
      return s ? { name: s.supplier, energy: s.energy, co2ePerUnit: Number(s.co2e), unit: s.unit, source: s.source, validFrom: s.valid_from, validTo: s.valid_to } : null;
    },
    // Locked while the entry is saved, so two people cannot claim the same MWh at once.
    lookupCertificates: async (ids, exclude) => (await c.query(
      `SELECT e.id, concat_ws(' ', initcap(e.technology), coalesce(e.standard, e.instrument), e.reference) AS label, e.co2e_per_kwh, e.mwh, e.market,
              e.vintage_from::text, e.vintage_to::text, e.facility_id,
              COALESCE((SELECT sum(k.kwh) FROM certificate_claim k WHERE k.certificate_id = e.id AND ($2::uuid IS NULL OR k.activity_id <> $2)), 0) AS claimed_other_kwh
         FROM energy_certificate e WHERE e.id = ANY($1) FOR UPDATE OF e`, [ids, exclude ?? null])).rows,
  };
}

export const saveSchema = calcInputSchema.extend({
  facilityId: z.string().uuid(),
  dataType: z.enum(['actual', 'estimated', 'proxy']).default('actual'),
  note: z.string().max(1000).optional(),
}).omit({ gwpSet: true, region: true });
export type SaveInput = z.infer<typeof saveSchema>;

/**
 * Calculate and save one entry inside the caller's transaction (used by the form,
 * the fleet grid and Excel uploads). With dryRun, calculates only.
 */
export async function saveEntry(c: Tx, req: FastifyRequest, t: { id: string; gwp_set: string }, b: SaveInput, opts: { dryRun?: boolean } = {}) {
  const tenant = t.id;
  const fac = (await c.query(`SELECT id, name, country, grid_region FROM org_node WHERE id = $1 AND kind = 'facility' AND active`, [b.facilityId])).rows[0];
  if (!fac) throw notFound('Facility');
  assertCan((await scopeOf(c, req.user)).enter, fac.id, 'enter data for this facility');
  const veh = await applyFleetVehicle(c, b);
  const { result, item, gwpSet, stored } = await calculate(b, contextFor(c, t.gwp_set, fac.country, fac));
  if (opts.dryRun) return { id: null, createdAt: null, item: item.name, gwpSet, totals: result.totals, warnings: result.warnings, stored };
  const quantity = stored.quantity;
  const a = (await c.query(
    `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                           co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, steps, warnings, note, created_by, factors, co2e_scope2, vehicle_id, co2e_scope2_market, co2e_td,
                           co2e_scope3, waste_site_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id, created_at`,
    [tenant, fac.id, item.category_id, item.id, b.periodStart, b.periodEnd, quantity, stored.unit, JSON.stringify(stored.inputs), b.dataType, gwpSet,
     result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo,
     JSON.stringify(result.steps), JSON.stringify(result.warnings), b.note ?? null, req.user.id, JSON.stringify(result.factors),
     result.totals.scope2, veh?.id ?? null, result.totals.scope2_market, result.totals.td_loss, result.totals.scope3, (stored.inputs.siteId as string | undefined) ?? null])).rows[0];
  // Certificates claimed by this entry (checked and locked during the calculation).
  for (const k of (stored.inputs.claims as { certificateId: string; kwh: number }[] | undefined) ?? []) {
    await c.query('INSERT INTO certificate_claim (tenant_id, certificate_id, activity_id, kwh) VALUES ($1,$2,$3,$4)', [tenant, k.certificateId, a.id, k.kwh]);
  }
  if (result.lines.length) {
    await c.query(
      `INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
       SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
      [a.id, tenant, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas),
       result.lines.map((l) => l.kgCo2e), result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)],
    );
  }
  await audit(c, req, 'activity.create', 'activity', a.id, { facility: fac.id, item: item.name, vehicle: veh?.name, period: b.periodStart, quantity, unit: stored.unit, co2e: result.totals.direct, scope2: result.totals.scope2 || undefined, scope3: result.totals.scope3 || undefined });
  return { id: a.id as string, createdAt: a.created_at, item: item.name, gwpSet, totals: result.totals, warnings: result.warnings, stored };
}

/** Save rows one by one inside a savepoint each, so one bad row does not undo the others. */
export async function runBatch(c: Tx, req: FastifyRequest, t: { id: string; gwp_set: string }, entries: unknown[], dryRun: boolean) {
  const out: { index: number; ok: boolean; id?: string | null; totals?: Record<string, number>; warnings?: string[]; error?: string }[] = [];
  for (const [index, raw] of entries.entries()) {
    await c.query('SAVEPOINT row');
    try {
      const parsed = saveSchema.safeParse(raw);
      if (!parsed.success) throw new AppError(parsed.error.issues.map((i) => `${i.path.join('.') || 'row'}: ${i.message}`).join('; '));
      const r = await saveEntry(c, req, t, parsed.data, { dryRun });
      await c.query('RELEASE SAVEPOINT row');
      out.push({ index, ok: true, id: r.id, totals: r.totals, warnings: r.warnings });
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT row');
      out.push({ index, ok: false, error: (e as Error).message });
    }
  }
  return { results: out, saved: dryRun ? 0 : out.filter((r) => r.ok).length, failed: out.filter((r) => !r.ok).length };
}

/** What was entered, rebuilt from a saved entry (spend: the quantity it bought, at the price used). */
function recalcInput(a: Record<string, any>, periodStart: string, periodEnd: string): CalcInput { // eslint-disable-line @typescript-eslint/no-explicit-any
  const inputs = (a.inputs ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = { itemId: a.item_id as number, unit: a.unit as string, periodStart, periodEnd };
  if (a.calc_method === 'fugitive') return { ...base, fugitive: inputs as CalcInput['fugitive'] };
  if (a.calc_method === 'waste') return { ...base, waste: inputs.waste as CalcInput['waste'] };
  if (a.calc_method === 'electricity') {
    const e = { ...(inputs.energy ?? {}) }; delete e.regions; delete e.certificates;
    return { ...base, quantity: Number(a.quantity), energy: e };
  }
  const cv = inputs.cv ? { value: Number(inputs.cv.value), energyUnit: String(inputs.cv.energyUnit), perUnit: String(inputs.cv.perUnit) } : undefined;
  if (a.calc_method === 'vehicle') {
    const v = inputs.vehicle ?? { method: 'distance' };
    if (v.method === 'spend' && v.spend && v.price) {
      // Same amount at the price used when it was saved.
      return { ...base, cv, vehicle: { method: 'spend', count: v.count ?? undefined, fuelItemId: v.fuelItemId ?? undefined, charging: v.charging ?? undefined,
        spend: { amount: Number(v.spend.amount), currency: String(v.spend.currency), price: Number(v.price) } } };
    }
    const count = Number(v.count ?? 1);
    return { ...base, quantity: Number(a.quantity) / count, cv, vehicle: { method: v.method, count: count > 1 ? count : undefined, fuelItemId: v.fuelItemId ?? undefined, charging: v.charging ?? undefined } };
  }
  return { ...base, quantity: Number(a.quantity), cv };
}

export async function tenantSettings(tenantId: string) {
  const [t] = await query('SELECT id, name, country, gwp_set, consolidation, base_year, plan, status, access_expiry, timezone FROM tenant WHERE id = $1', [tenantId]);
  if (!t) throw notFound('Company');
  return t as { id: string; name: string; country: string; gwp_set: string; consolidation: string; base_year: number; timezone: string };
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
        `SELECT f.id, f.name, f.country, f.grid_region, f.active, f.facility_type, p.name AS parent_name
           FROM org_node f LEFT JOIN org_node p ON p.id = f.parent_id
          WHERE f.kind = 'facility' AND f.active ORDER BY p.name NULLS FIRST, f.name`)).rows;
      return { facilities: rows.filter((f) => scope.see.has(f.id)).map((f) => ({ ...f, canEnter: scope.enter.has(f.id), canApprove: scope.approve.has(f.id) })) };
    });
  });

  // ------------------------------------------------------------ calculate --
  /** Preview: calculate without saving. Used by the entry form as the user types. */
  app.post('/api/calculate', async (req) => {
    const input = calcInputSchema.extend({ facilityId: z.string().uuid().optional() }).parse(req.body);
    if (!req.user.tenantId) {
      const { result, item, gwpSet } = await calculate(input, { gwpSet: input.gwpSet ?? 'AR5', region: input.region ?? 'GLOBAL' });
      return { item: { id: item.id, name: item.name, category: item.category }, gwpSet, ...result };
    }
    const t = await tenantSettings(req.user.tenantId);
    return tenantTx(t.id, async (c) => {
      let region = t.country;
      let fac: { id: string; grid_region: string | null } | undefined;
      if (input.facilityId) {
        const f = (await c.query(`SELECT id, country, grid_region FROM org_node WHERE id = $1 AND kind = 'facility'`, [input.facilityId])).rows[0];
        if (!f) throw notFound('Facility');
        region = f.country; fac = f;
      }
      await applyFleetVehicle(c, input);
      const { result, item, gwpSet, stored } = await calculate(input, contextFor(c, t.gwp_set, region, fac));
      return { item: { id: item.id, name: item.name, category: item.category }, gwpSet, stored, ...result };
    });
  });

  // ---------------------------------------------------------- save / list --

  app.post('/api/activities', async (req) => {
    const tenant = requireTenant(req);
    const b = saveSchema.parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, (c) => saveEntry(c, req, t, b));
  });

  /**
   * Several entries at once (fleet grid, uploads). Each row is saved on its own:
   * a row with a problem is reported and the others are saved. dryRun: calculate only.
   */
  app.post('/api/activities/batch', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ entries: z.array(z.unknown()).min(1).max(2000), dryRun: z.boolean().default(false) }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => runBatch(c, req, t, b.entries, b.dryRun));
  });

  /**
   * Recalculate saved entries from what was entered (e.g. after a grid factor or
   * next year's DESNZ set was added). Only entries whose result changes are
   * updated; each change is in the audit log with the old and new totals.
   */
  app.post('/api/activities/recalculate', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = z.object({ ids: z.array(z.string().uuid()).max(5000).optional(), year: z.number().int().optional(), onlyWithWarnings: z.boolean().default(true) }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const enter = (await scopeOf(c, req.user)).enter;
      const rows = (await c.query(
        `SELECT a.*, cat.calc_method FROM activity a JOIN category cat ON cat.id = a.category_id
          WHERE ($1::uuid[] IS NULL OR a.id = ANY($1)) AND ($2::int IS NULL OR extract(year FROM a.period_start) = $2)
            AND (NOT $3 OR jsonb_array_length(a.warnings) > 0)
          ORDER BY a.period_start`, [b.ids ?? null, b.year ?? null, b.onlyWithWarnings])).rows.filter((a) => enter.has(a.facility_id));
      let changed = 0;
      const problems: string[] = [];
      // Entries from a meter are rebuilt from its readings (keeps the meter steps and coverage).
      const byMeter = new Map<string, Set<string>>();
      for (const a of rows.filter((x) => x.meter_id)) {
        const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 7) : String(d).slice(0, 7));
        byMeter.set(a.meter_id, (byMeter.get(a.meter_id) ?? new Set()).add(iso(a.period_start)));
      }
      for (const [mid, months] of byMeter) {
        const m = (await c.query('SELECT * FROM meter WHERE id = $1', [mid])).rows[0] as MeterRow;
        const r = await syncMeter(c, t, m, { id: req.user.id, name: req.user.name, req }, months);
        changed += r.updated; problems.push(...r.problems, ...r.locked);
      }
      for (const a of rows.filter((x) => !x.meter_id)) {
        const iso = (d: Date | string) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
        const input = recalcInput(a, iso(a.period_start), iso(a.period_end));
        await c.query('SAVEPOINT recalc');
        try {
          const fac = (await c.query('SELECT id, country, grid_region FROM org_node WHERE id = $1', [a.facility_id])).rows[0];
          if (a.calc_method === 'electricity') {
            const cl = (await c.query('SELECT certificate_id, kwh FROM certificate_claim WHERE activity_id = $1', [a.id])).rows;
            if (cl.length) input.energy = { ...(input.energy ?? {}), certificates: cl.map((k) => ({ certificateId: k.certificate_id, kwh: Number(k.kwh) })) };
          }
          if (a.vehicle_id && input.vehicle) input.vehicle.vehicleId = a.vehicle_id;
          await applyFleetVehicle(c, { ...input, facilityId: a.facility_id }).catch(() => null); // retired since: keep the saved type
          const { result, gwpSet, stored } = await calculate(input, contextFor(c, t.gwp_set, fac.country, fac, a.id));
          const col: Record<string, string> = { direct: 'co2e_direct', wtt: 'co2e_wtt', outside_scopes: 'co2_biogenic', memo: 'co2e_memo', scope2: 'co2e_scope2', scope2_market: 'co2e_scope2_market', td_loss: 'co2e_td', scope3: 'co2e_scope3' };
          const same = Object.entries(col).every(([k, cname]) => Math.abs(Number(a[cname]) - result.totals[k as 'direct']) < 1e-6)
            && JSON.stringify(a.warnings) === JSON.stringify(result.warnings) && a.gwp_set === gwpSet
            && (a.calc_method !== 'waste' || Math.abs(Number(a.quantity) - stored.quantity) < 1e-6);
          if (!same) {
            await c.query(
              `UPDATE activity SET co2e_direct=$2, co2e_wtt=$3, co2_biogenic=$4, co2e_memo=$5, co2e_scope2=$6, steps=$7, warnings=$8, factors=$9, gwp_set=$10,
                                  co2e_scope2_market=$11, co2e_td=$12, co2e_scope3=$13, quantity=$14, updated_at=now() WHERE id=$1`,
              [a.id, result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo, result.totals.scope2,
               JSON.stringify(result.steps), JSON.stringify(result.warnings), JSON.stringify(result.factors), gwpSet, result.totals.scope2_market, result.totals.td_loss,
               result.totals.scope3, a.calc_method === 'waste' ? stored.quantity : a.quantity]);
            await c.query('DELETE FROM activity_result WHERE activity_id = $1', [a.id]);
            if (result.lines.length) {
              await c.query(
                `INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
                 SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
                [a.id, tenant, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas),
                 result.lines.map((l) => l.kgCo2e), result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)]);
            }
            await audit(c, req, 'activity.recalculate', 'activity', a.id, {
              before: { direct: Number(a.co2e_direct), scope2: Number(a.co2e_scope2), scope2Market: Number(a.co2e_scope2_market), td: Number(a.co2e_td), wtt: Number(a.co2e_wtt), scope3: Number(a.co2e_scope3) },
              after: { direct: result.totals.direct, scope2: result.totals.scope2, scope2Market: result.totals.scope2_market, td: result.totals.td_loss, wtt: result.totals.wtt, scope3: result.totals.scope3 } });
            changed++;
          }
          await c.query('RELEASE SAVEPOINT recalc');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT recalc');
          problems.push(`${iso(a.period_start).slice(0, 7)}: ${(e as Error).message}`);
        }
      }
      return { checked: rows.length, changed, problems: problems.slice(0, 20) };
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
                  a.co2e_direct, a.co2e_wtt, a.co2_biogenic, a.co2e_memo, a.co2e_scope2, a.co2e_scope2_market, a.co2e_td, a.co2e_scope3, a.status, a.created_at, a.vehicle_id, v.name AS vehicle,
                  cat.scope, cat.ghg_category, ws.name AS waste_site, a.meter_id, mt.name AS meter
             FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN item i ON i.id = a.item_id JOIN category cat ON cat.id = a.category_id
             LEFT JOIN vehicle v ON v.id = a.vehicle_id LEFT JOIN waste_site ws ON ws.id = a.waste_site_id LEFT JOIN meter mt ON mt.id = a.meter_id
            WHERE a.facility_id = ANY($5) AND ($1::uuid IS NULL OR a.facility_id = $1) AND ($2::int IS NULL OR extract(year FROM a.period_start) = $2) AND ($3::text IS NULL OR cat.code = $3)
            ORDER BY a.period_start DESC, a.created_at DESC LIMIT $4`, [q.facilityId ?? null, q.year ?? null, q.category ?? null, q.limit, see])).rows,
      };
    });
  });

  app.get('/api/activities/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const a = (await c.query(`SELECT a.*, i.name AS item, v.name AS vehicle, ws.name AS waste_site, mt.name AS meter FROM activity a JOIN item i ON i.id = a.item_id
                                  LEFT JOIN vehicle v ON v.id = a.vehicle_id LEFT JOIN waste_site ws ON ws.id = a.waste_site_id LEFT JOIN meter mt ON mt.id = a.meter_id WHERE a.id = $1`, [id])).rows[0];
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

