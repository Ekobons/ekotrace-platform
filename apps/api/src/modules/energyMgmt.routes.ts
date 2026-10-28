/**
 * Energy management & savings (package 'energy').
 *
 *   GET    /api/energy?year=                       portfolio: each site's year (energy, EnPI, savings, model quality, anomalies), measures
 *   POST   /api/energy/sites                       add a site (super admin, admin); PUT / DELETE /api/energy/sites/:id
 *   GET    /api/energy/sites/:id?year=             the site's year month by month: energy by carrier, variables, model, expected,
 *                                                  savings, CUSUM, anomalies, EnPI; measures; significant energy uses
 *   PUT    /api/energy/sites/:id/months            variables and typed energy for months (super admin, admin, manager, preparer)
 *   POST   /api/energy/measures                    energy-saving measure; PUT / DELETE /api/energy/measures/:mid (super admin, admin, manager)
 *   POST   /api/energy/seus                        significant energy use; PUT / DELETE /api/energy/seus/:sid (super admin, admin, manager)
 *   GET    /api/energy/sites/:id/export?year=      Excel: M&V report (months, model, savings, measures, energy review)
 *   GET    /api/energy/export?year=                Excel: portfolio
 *
 * With the GHG inventory, energy comes from the approved entries of the linked facility (fuels through their
 * calorific values on a net basis, electricity, heat and cooling as bought, vehicle fuels), split by days across
 * months; a typed month replaces the inventory's figure for that carrier. Without it, energy is typed.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { PRODUCT } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { hasEkotrace, needProduct } from '../lib/products.js';
import { refdata } from './refdata.js';
import { kwhOf } from './dashboard.routes.js';
import {
  CARRIERS, CARRIER_LABEL, VARIABLES, VARIABLE_LABEL, compare, economics, enpiChange, energyOf, fit, monthsOf,
  type Carrier, type ModelTarget, type MonthRow, type Variable,
} from '../lib/energy.js';

const uuid = z.string().uuid();
const YEAR = z.coerce.number().int().min(2000).max(2100);
const idOf = (req: FastifyRequest, k = 'id') => uuid.parse((req.params as Record<string, string>)[k]);
const num = (x: unknown) => (x == null ? null : Number(x));
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const canSetup = (req: FastifyRequest) => ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
const canData = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'preparer', 'platform_admin'].includes(req.user.role);
const canMeasures = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const txt = (max: number) => z.string().trim().max(max).nullable().default(null);
const perCarrier = (max: number) => z.record(z.string(), z.number().min(0).max(max).nullable()).default({}).refine((o) => Object.keys(o).every((k) => (CARRIERS as readonly string[]).includes(k)), 'Unknown energy carrier');
export const SITE_TYPES: Record<string, string> = { office: 'Office', warehouse: 'Warehouse / logistics', retail: 'Retail / mall', hotel: 'Hotel', hospital: 'Hospital / clinic', school: 'School / university', data_centre: 'Data centre', plant: 'Industrial plant', utility: 'Utility / treatment plant', residential: 'Residential', other: 'Other' };
export const CATEGORIES: Record<string, string> = { lighting: 'Lighting (LED, controls)', hvac: 'HVAC and chillers', motors: 'Motors, pumps, fans (VSD)', compressed_air: 'Compressed air', heat_recovery: 'Heat recovery', insulation: 'Insulation and envelope', controls: 'Controls / BMS', process: 'Process optimisation', solar: 'On-site solar', fuel_switch: 'Fuel switching', behaviour: 'Behaviour and housekeeping', other: 'Other' };
/** The last complete calendar year in the company's time zone is not known here: the last complete calendar year in UTC. */
const lastYear = () => new Date().getUTCFullYear() - 1;

const siteBody0 = z.object({
  name: z.string().trim().min(2).max(200), nodeId: uuid.nullable().default(null), siteType: z.enum(Object.keys(SITE_TYPES) as [string, ...string[]]).default('other'),
  floorM2: z.number().positive().max(1e8).nullable().default(null), baselineYear: z.number().int().min(2000).max(2100).nullable().default(null),
  modelTarget: z.enum(['total', ...CARRIERS]).default('total'), modelVars: z.array(z.enum(VARIABLES)).max(2).default([]).transform((v) => [...new Set(v)]),
  enpiVar: z.enum([...VARIABLES, 'floor']).nullable().default(null), productionUnit: txt(40),
  tariffs: perCarrier(1000), factors: perCarrier(10), targetPct: z.number().gt(0).lt(100).nullable().default(null), targetYear: z.number().int().min(2000).max(2100).nullable().default(null),
  notes: z.string().trim().max(4000).default(''),
});
const siteBody = siteBody0
  .refine((b) => !(b.targetYear && b.baselineYear && b.targetYear <= b.baselineYear), { message: 'The target year must be after the baseline year', path: ['targetYear'] })
  .refine((b) => b.enpiVar !== 'floor' || b.floorM2 != null, { message: 'An EnPI per m² needs the floor area', path: ['floorM2'] });
type SiteBody = z.infer<typeof siteBody>;
const siteView = (s: any) => ({
  id: s.id as string, name: s.name as string, nodeId: s.node_id as string | null, siteType: s.site_type as string, floorM2: num(s.floor_m2), baselineYear: s.baseline_year as number | null,
  modelTarget: s.model_target as ModelTarget, modelVars: (s.model_vars ?? []) as Variable[], enpiVar: s.enpi_var as Variable | 'floor' | null, productionUnit: s.production_unit as string | null,
  tariffs: (s.tariffs ?? {}) as Partial<Record<Carrier, number | null>>, factors: (s.factors ?? {}) as Partial<Record<Carrier, number | null>>,
  targetPct: num(s.target_pct), targetYear: s.target_year as number | null, notes: s.notes as string, updatedName: s.updated_name as string | null,
});
type SiteV = ReturnType<typeof siteView>;
const measureBody = z.object({
  siteId: uuid, title: z.string().trim().min(2).max(300), category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]), carrier: z.enum(CARRIERS),
  status: z.enum(['idea', 'approved', 'implemented', 'verified', 'dropped']), implementedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  kwhExpected: z.number().min(0).max(1e12).nullable().default(null), kwhVerified: z.number().min(0).max(1e12).nullable().default(null), ipmvp: z.enum(['A', 'B', 'C', 'D']).nullable().default(null),
  capex: z.number().min(0).max(1e13).nullable().default(null), opexYear: z.number().min(0).max(1e12).nullable().default(null), lifeYears: z.number().int().min(1).max(50).nullable().default(null),
  owner: txt(120), mvPlan: z.string().trim().max(2000).default(''), note: z.string().trim().max(2000).default(''),
});
const measureView = (m: any) => ({
  id: m.id as string, siteId: m.site_id as string, title: m.title as string, category: m.category as string, carrier: m.carrier as Carrier, status: m.status as string, implementedOn: iso(m.implemented_on),
  kwhExpected: num(m.kwh_expected), kwhVerified: num(m.kwh_verified), ipmvp: m.ipmvp as string | null, capex: num(m.capex), opexYear: num(m.opex_year), lifeYears: m.life_years as number | null,
  owner: m.owner as string | null, mvPlan: m.mv_plan as string, note: m.note as string, updatedName: m.updated_name as string | null,
});
const seuBody = z.object({
  siteId: uuid, name: z.string().trim().min(2).max(200), carrier: z.enum(CARRIERS), sharePct: z.number().min(0).max(100).nullable().default(null),
  variables: z.string().trim().max(500).default(''), enpi: z.string().trim().max(300).default(''), controls: z.string().trim().max(1000).default(''), owner: txt(120),
});
const seuView = (s: any) => ({ id: s.id as string, siteId: s.site_id as string, name: s.name as string, carrier: s.carrier as Carrier, sharePct: num(s.share_pct), variables: s.variables as string, enpi: s.enpi as string, controls: s.controls as string, owner: s.owner as string | null });

async function getSite(c: Tx, id: string) {
  const s = (await c.query(`SELECT * FROM en_site WHERE id = $1`, [id])).rows[0];
  if (!s) throw notFound('Site');
  return siteView(s);
}

/** Energy (kWh) and inventory emissions (kgCO2e) by month and carrier from the approved entries of a facility. */
async function fromEntries(c: Tx, nodeId: string, first: number, last: number) {
  const rows = (await c.query(
    `WITH m AS (SELECT generate_series($2::date, $3::date, interval '1 month')::date AS ms)
     SELECT to_char(m.ms, 'YYYY-MM') AS month, cat.code AS cat, i.id AS iid, i.name AS item, sc.name AS sub, a.unit,
            sum(a.quantity * s.share)::float8 AS qty, sum((a.co2e_direct + a.co2e_scope2) * s.share)::float8 AS kg, array_agg(DISTINCT a.id::text) AS ids
       FROM m JOIN activity a ON a.period_start <= (m.ms + interval '1 month' - interval '1 day')::date AND a.period_end >= m.ms
       CROSS JOIN LATERAL (SELECT ((least(a.period_end, (m.ms + interval '1 month' - interval '1 day')::date) - greatest(a.period_start, m.ms) + 1)::numeric / (a.period_end - a.period_start + 1)) AS share) s
       JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id JOIN subcategory sc ON sc.id = i.subcategory_id
      WHERE a.facility_id = $1 AND a.status = 'approved' AND cat.code IN ('stationary_combustion', 'mobile_combustion', 'purchased_electricity')
      GROUP BY 1, 2, 3, 4, 5, 6`, [nodeId, `${first}-01-01`, `${last}-12-01`])).rows;
  const ref = await refdata();
  const units = new Map(ref.unitList.map((u) => [u.code, { dimension: u.dimension, to_base: Number(u.toBase) }]));
  const out = new Map<string, { energy: Partial<Record<Carrier, number>>; kg: Partial<Record<Carrier, number>> }>();
  const missing = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.qty) continue;   // nothing used
    const u = units.get(r.unit);
    const carrier: Carrier = r.cat === 'mobile_combustion' ? 'transport' : r.cat === 'stationary_combustion' ? 'fuel' : u?.dimension === 'heat' ? 'heat' : u?.dimension === 'cooling' ? 'cooling' : 'electricity';
    let kwh = await kwhOf(c, units, r.iid, `${r.item} ${r.sub}`, r.unit, r.qty, Number(r.month.slice(0, 4)), carrier === 'fuel' || carrier === 'transport');
    if (kwh != null && u?.dimension === 'energy_gross') kwh *= /natural gas|lpg|propane|butane|biogas|methane/i.test(`${r.item} ${r.sub}`) ? 0.9 : 0.95;   // to net
    if (kwh == null) { const k = `${r.item} (${r.unit})`; const set = missing.get(k) ?? new Set<string>(); for (const id of r.ids as string[]) set.add(id); missing.set(k, set); continue; }
    const o = out.get(r.month) ?? { energy: {}, kg: {} };
    o.energy[carrier] = (o.energy[carrier] ?? 0) + kwh; o.kg[carrier] = (o.kg[carrier] ?? 0) + r.kg;
    out.set(r.month, o);
  }
  return { months: out, missing: [...missing].map(([what, ids]) => `${what}: ${ids.size} ${ids.size === 1 ? 'entry' : 'entries'} without energy content left out`) };
}

/** The site's rows for some years: entries merged with typed months (a typed carrier replaces the entries' figure). */
async function rowsFor(c: Tx, s: SiteV, years: number[], eko: boolean) {
  const first = Math.min(...years), last = Math.max(...years);
  const ent = eko && s.nodeId ? await fromEntries(c, s.nodeId, first, last) : { months: new Map(), missing: [] as string[] };
  const typed = new Map((await c.query(`SELECT * FROM en_month WHERE site_id = $1 AND month BETWEEN $2 AND $3`, [s.id, `${first}-01-01`, `${last}-12-01`])).rows.map((r) => [iso(r.month)!.slice(0, 7), r]));
  const rows = new Map<string, MonthRow & { source: Partial<Record<Carrier, 'entries' | 'typed'>>; kg: Partial<Record<Carrier, number>>; note: string }>();
  for (const y of years) for (const m of monthsOf(y)) {
    const e = ent.months.get(m), t = typed.get(m);
    const energy: Partial<Record<Carrier, number | null>> = {}, source: Partial<Record<Carrier, 'entries' | 'typed'>> = {};
    for (const k of CARRIERS) {
      const tv = t?.energy?.[k];
      if (tv != null) { energy[k] = Number(tv); source[k] = 'typed'; } else if (e?.energy[k] != null) { energy[k] = e.energy[k]!; source[k] = 'entries'; }
    }
    rows.set(m, { month: m, energy, source, kg: e?.kg ?? {}, production: num(t?.production), cdd: num(t?.cdd), hdd: num(t?.hdd), occupancy: num(t?.occupancy), note: t?.note ?? '' });
  }
  return { rows, missing: ent.missing };
}

const sumC = (rows: MonthRow[], k: Carrier) => rows.reduce((a, r) => a + (r.energy[k] ?? 0), 0);
/** kgCO2e per kWh of each carrier: from the inventory's emissions over its energy, or the site's typed factors. */
function intensity(rows: (MonthRow & { kg: Partial<Record<Carrier, number>>; source: Partial<Record<Carrier, string>> })[], s: SiteV, eko: boolean) {
  const out: Partial<Record<Carrier, number | null>> = {};
  for (const k of CARRIERS) {
    const ent = rows.filter((r) => r.source[k] === 'entries');
    const kwh = ent.reduce((a, r) => a + (r.energy[k] ?? 0), 0), kg = ent.reduce((a, r) => a + (r.kg[k] ?? 0), 0);
    out[k] = eko && kwh > 0 ? kg / kwh : s.factors[k] ?? null;
  }
  return out;
}

/** One site's year worked out. */
async function siteYear(c: Tx, s: SiteV, year: number, eko: boolean) {
  const base = s.baselineYear && s.baselineYear < year ? s.baselineYear : null;
  const years = [...new Set([year, year - 1, ...(base ? [base] : [])])];
  const { rows, missing } = await rowsFor(c, s, years, eko);
  const cur = monthsOf(year).map((m) => rows.get(m)!), prior = monthsOf(year - 1).map((m) => rows.get(m)!), baseRows = base ? monthsOf(base).map((m) => rows.get(m)!) : [];
  const model = base ? fit(baseRows, s.modelTarget, s.modelVars) : null;
  const periods = compare(cur, prior, s.modelTarget, model ?? { vars: s.modelVars, coef: [], n: 0, r2: null, cvrmse: null, nmbe: null, se: null, t: [], valid: false, problems: [], mean: null }, s.enpiVar && s.enpiVar !== 'floor' ? s.enpiVar : null);
  const totals = Object.fromEntries(CARRIERS.map((k) => [k, sumC(cur, k)])) as Record<Carrier, number>;
  const total = CARRIERS.reduce((a, k) => a + totals[k], 0);
  const monthsIn = cur.filter((r) => energyOf(r, 'total') != null).length;
  // EnPI over the months that have both energy and the driver (floor area: every month with energy, annualised to the months)
  const hasDriver = (r: MonthRow) => s.enpiVar === 'floor' || (s.enpiVar != null && (r as any)[s.enpiVar] != null);
  const enpiOf = (rs: MonthRow[]) => {
    if (!s.enpiVar || (s.enpiVar === 'floor' && !s.floorM2)) return null;
    const e = rs.reduce((a, r) => a + (energyOf(r, s.modelTarget) ?? 0), 0);
    const d = s.enpiVar === 'floor' ? s.floorM2! * (rs.length / 12) : rs.reduce((a, r) => a + ((r as any)[s.enpiVar!] ?? 0), 0);
    return d ? e / d : null;
  };
  // compare like with like: the months with data in the year, and the same months of the baseline
  const inYear = cur.map((r, i) => (energyOf(r, s.modelTarget) != null && hasDriver(r) && (!base || (energyOf(baseRows[i]!, s.modelTarget) != null && hasDriver(baseRows[i]!))) ? i : -1)).filter((i) => i >= 0);
  const withData = cur.map((r, i) => (energyOf(r, 'total') != null ? i : -1)).filter((i) => i >= 0);
  const enpi = enpiOf(cur.filter((_, i) => inYear.includes(i))), enpiBase = base ? enpiOf(baseRows.filter((_, i) => inYear.includes(i))) : null;
  const kgPerKwh = intensity([...cur, ...prior], s, eko);
  const tariff = (k: Carrier) => s.tariffs[k] ?? null;
  const cost = CARRIERS.reduce((a, k) => (tariff(k) != null ? a + totals[k] * tariff(k)! : a), 0);
  const saving = periods.reduce((a, p) => a + (p.saving ?? 0), 0);
  const savedMonths = periods.filter((p) => p.saving != null).length;
  const tgt = s.modelTarget === 'total' ? null : s.modelTarget;
  // a total model mixes carriers: value its savings at the energy-weighted tariff and intensity of the year
  const wavg = (f: (k: Carrier) => number | null) => { let w = 0, v = 0; for (const k of CARRIERS) { const x = f(k); if (x != null && totals[k]) { w += totals[k]; v += totals[k] * x; } } return w ? v / w : null; };
  const tSave = tgt ? tariff(tgt) : wavg(tariff), kgSave = tgt ? kgPerKwh[tgt] ?? null : wavg((k) => kgPerKwh[k] ?? null);
  const problems = [...missing];
  if (!base) problems.push(s.baselineYear ? `The baseline year (${s.baselineYear}) must be before ${year}` : 'Choose a baseline year to measure savings');
  if (model && !model.valid) problems.push('The baseline model does not meet ASHRAE Guideline 14: savings are indicative');
  if (s.enpiVar && s.enpiVar !== 'floor' && cur.some((r) => energyOf(r, s.modelTarget) != null && (r as any)[s.enpiVar!] == null)) problems.push(`Months with energy but no ${VARIABLE_LABEL[s.enpiVar]}: the EnPI leaves them out`);
  if (s.enpiVar === 'floor' && !s.floorM2) problems.push('The EnPI is per m²: give the floor area');
  if (s.modelVars.some((v) => periods.some((p, i) => p.actual != null && (cur[i] as any)[v] == null))) problems.push(`Months with energy but missing ${s.modelVars.map((v) => VARIABLE_LABEL[v]).join(' or ')}: no expected value for them`);
  return {
    months: cur.map((r, i) => ({ ...r, kg: undefined, ...periods[i]! })), base, model, totals, total, monthsIn, enpi, enpiBase, enpiChange: enpiChange(enpi, enpiBase),
    kgPerKwh, cost: CARRIERS.some((k) => tariff(k) != null) ? cost : null, saving: savedMonths ? saving : null, savedMonths,
    savingCost: savedMonths && tSave != null ? saving * tSave : null, savingT: savedMonths && kgSave != null ? (saving * kgSave) / 1000 : null,
    anomalies: periods.filter((p) => p.anomaly).length, problems,
    target: s.targetPct && s.targetYear && enpiBase != null ? { pct: s.targetPct, year: s.targetYear, enpi: enpiBase * (1 - s.targetPct / 100), onTrack: enpi != null ? enpi <= enpiBase * (1 - (s.targetPct / 100) * Math.min(1, Math.max(0, (year - base!) / Math.max(1, s.targetYear - base!)))) : null } : null,
    // last year on the same months (months with energy in both years)
    ...(() => { const both = withData.filter((i) => energyOf(prior[i]!, 'total') != null); return both.length ? { priorTotal: both.reduce((a, i) => a + energyOf(prior[i]!, 'total')!, 0), sameTotal: both.reduce((a, i) => a + energyOf(cur[i]!, 'total')!, 0) } : { priorTotal: null, sameTotal: null }; })(),
  };
}

const measureEcon = (m: ReturnType<typeof measureView>, s: SiteV, kgPerKwh: Partial<Record<Carrier, number | null>>) =>
  economics({ kwhYear: m.kwhVerified ?? m.kwhExpected, tariff: s.tariffs[m.carrier] ?? null, capex: m.capex, opexYear: m.opexYear, lifeYears: m.lifeYears, kgPerKwh: kgPerKwh[m.carrier] ?? null });

export async function energyMgmtRoutes(app: FastifyInstance) {
  needProduct(app, 'energy');

  app.get('/api/energy', async (req) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: YEAR.optional() }).parse(req.query).year ?? lastYear();
    return tenantTx(tenant, async (c) => {
      const eko = await hasEkotrace(c, tenant);
      const sites = [], monthly = monthsOf(year).map((m) => ({ month: m, ...Object.fromEntries(CARRIERS.map((k) => [k, 0])) })) as ({ month: string } & Record<Carrier, number>)[];
      const measures = [];
      const allM = (await c.query(`SELECT * FROM en_measure ORDER BY status, created_name, title`)).rows.map(measureView);
      for (const r of (await c.query(`SELECT * FROM en_site ORDER BY name`)).rows) {
        const s = siteView(r), y = await siteYear(c, s, year, eko);
        y.months.forEach((m, i) => { for (const k of CARRIERS) monthly[i]![k] += m.energy[k] ?? 0; });
        sites.push({ ...s, year: { total: y.total, totals: y.totals, monthsIn: y.monthsIn, enpi: y.enpi, enpiBase: y.enpiBase, enpiChange: y.enpiChange, saving: y.saving, savingCost: y.savingCost, savingT: y.savingT, cost: y.cost, anomalies: y.anomalies, modelValid: y.model?.valid ?? null, cvrmse: y.model?.cvrmse ?? null, problems: y.problems.length, priorTotal: y.priorTotal, sameTotal: y.sameTotal, target: y.target, eui: s.floorM2 && y.monthsIn === 12 ? y.total / s.floorM2 : null } });
        for (const m of allM.filter((x) => x.siteId === s.id)) measures.push({ ...m, site: s.name, econ: measureEcon(m, s, y.kgPerKwh) });
      }
      return {
        year, sites, monthly, measures, carriers: CARRIER_LABEL, variables: VARIABLE_LABEL, siteTypes: SITE_TYPES, categories: CATEGORIES,
        currency: ((await c.query(`SELECT currency FROM tenant WHERE id = $1`, [tenant])).rows[0]?.currency as string) ?? 'AED',
        nodes: eko ? (await c.query(`SELECT id, name, employees, floor_area_m2::float8 AS floor_m2 FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows : [],
        ekotrace: eko, canSetup: canSetup(req), canData: canData(req), canMeasures: canMeasures(req),
      };
    });
  });

  const nodeCheck = async (c: Tx, id: string | null) => { if (id && !(await c.query(`SELECT 1 FROM org_node WHERE id = $1 AND kind = 'facility'`, [id])).rowCount) throw new AppError('The inventory facility was not found'); };
  const cols = (b: SiteBody) => [b.name, b.nodeId, b.siteType, b.floorM2, b.baselineYear, b.modelTarget, b.modelVars, b.enpiVar, b.productionUnit || null, JSON.stringify(b.tariffs), JSON.stringify(b.factors), b.targetPct, b.targetYear, b.notes];
  app.post('/api/energy/sites', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = siteBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await hasEkotrace(c, tenant))) b.nodeId = null;
      await nodeCheck(c, b.nodeId);
      if ((await c.query(`SELECT 1 FROM en_site WHERE lower(name) = lower($1)`, [b.name])).rowCount) throw new AppError('A site with that name exists');
      const r = (await c.query(`INSERT INTO en_site (tenant_id, name, node_id, site_type, floor_m2, baseline_year, model_target, model_vars, enpi_var, production_unit, tariffs, factors, target_pct, target_year, notes, created_name, updated_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING id`, [tenant, ...cols(b), req.user.name])).rows[0];
      await audit(c, req, 'energy.site.create', 'en_site', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/energy/sites/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req), b = siteBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await getSite(c, id);
      if (!(await hasEkotrace(c, tenant))) b.nodeId = null;
      await nodeCheck(c, b.nodeId);
      if ((await c.query(`SELECT 1 FROM en_site WHERE lower(name) = lower($1) AND id <> $2`, [b.name, id])).rowCount) throw new AppError('A site with that name exists');
      await c.query(`UPDATE en_site SET name=$2, node_id=$3, site_type=$4, floor_m2=$5, baseline_year=$6, model_target=$7, model_vars=$8, enpi_var=$9, production_unit=$10, tariffs=$11, factors=$12, target_pct=$13, target_year=$14, notes=$15, updated_name=$16, updated_at=now() WHERE id = $1`,
        [id, ...cols(b), req.user.name]);
      await audit(c, req, 'energy.site.update', 'en_site', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/energy/sites/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const s = await getSite(c, id);
      await c.query(`DELETE FROM en_site WHERE id = $1`, [id]);
      await audit(c, req, 'energy.site.delete', 'en_site', id, { name: s.name });
      return { ok: true };
    });
  });

  app.get('/api/energy/sites/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const year = z.object({ year: YEAR.optional() }).parse(req.query).year ?? lastYear();
    return tenantTx(tenant, async (c) => {
      const eko = await hasEkotrace(c, tenant);
      const s = await getSite(c, id), y = await siteYear(c, s, year, eko);
      const measures = (await c.query(`SELECT * FROM en_measure WHERE site_id = $1 ORDER BY status, title`, [id])).rows.map(measureView).map((m) => ({ ...m, econ: measureEcon(m, s, y.kgPerKwh) }));
      return {
        site: s, year, ...y, measures, seus: (await c.query(`SELECT * FROM en_seu WHERE site_id = $1 ORDER BY share_pct DESC NULLS LAST, name`, [id])).rows.map(seuView),
        node: s.nodeId ? (await c.query(`SELECT id, name FROM org_node WHERE id = $1`, [s.nodeId])).rows[0] ?? null : null,
        ekotrace: eko, canSetup: canSetup(req), canData: canData(req), canMeasures: canMeasures(req),
      };
    });
  });

  app.put('/api/energy/sites/:id/months', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = idOf(req);
    const b = z.object({ months: z.array(z.object({
      month: z.string().regex(/^(20\d\d|2100)-(0[1-9]|1[0-2])$/), production: z.number().min(0).max(1e12).nullable().default(null), cdd: z.number().min(0).max(5000).nullable().default(null),
      hdd: z.number().min(0).max(5000).nullable().default(null), occupancy: z.number().min(0).max(1e7).nullable().default(null), energy: perCarrier(1e12), note: z.string().trim().max(500).default(''),
    })).min(1).max(60) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await getSite(c, id);
      for (const m of b.months) {
        const energy = Object.fromEntries(Object.entries(m.energy).filter(([, v]) => v != null));
        if ([m.production, m.cdd, m.hdd, m.occupancy].every((v) => v == null) && !Object.keys(energy).length && !m.note) { await c.query(`DELETE FROM en_month WHERE site_id = $1 AND month = $2`, [id, `${m.month}-01`]); continue; }
        await c.query(`INSERT INTO en_month (tenant_id, site_id, month, production, cdd, hdd, occupancy, energy, note, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (site_id, month) DO UPDATE SET production=$4, cdd=$5, hdd=$6, occupancy=$7, energy=$8, note=$9, updated_name=$10, updated_at=now()`,
          [tenant, id, `${m.month}-01`, m.production, m.cdd, m.hdd, m.occupancy, JSON.stringify(energy), m.note, req.user.name]);
      }
      await audit(c, req, 'energy.months', 'en_site', id, { months: b.months.map((m) => m.month) });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------------------------- measures and SEUs --
  const mcols = (b: z.infer<typeof measureBody>) => [b.siteId, b.title, b.category, b.carrier, b.status, b.implementedOn, b.kwhExpected, b.kwhVerified, b.ipmvp, b.capex, b.opexYear, b.lifeYears, b.owner || null, b.mvPlan, b.note];
  const measureCheck = (b: z.infer<typeof measureBody>) => {
    if ((b.status === 'implemented' || b.status === 'verified') && !b.implementedOn) throw new AppError('Give the date the measure was implemented');
    if (b.status === 'verified' && (b.kwhVerified == null || !b.ipmvp)) throw new AppError('A verified measure needs its verified saving and the IPMVP option used');
  };
  app.post('/api/energy/measures', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = measureBody.parse(req.body); measureCheck(b);
    return tenantTx(tenant, async (c) => {
      await getSite(c, b.siteId);
      const r = (await c.query(`INSERT INTO en_measure (tenant_id, site_id, title, category, carrier, status, implemented_on, kwh_expected, kwh_verified, ipmvp, capex, opex_year, life_years, owner, mv_plan, note, created_name, updated_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id`, [tenant, ...mcols(b), req.user.name])).rows[0];
      await audit(c, req, 'energy.measure.create', 'en_measure', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/energy/measures/:mid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const mid = idOf(req, 'mid'), b = measureBody.parse(req.body); measureCheck(b);
    return tenantTx(tenant, async (c) => {
      await getSite(c, b.siteId);
      const r = await c.query(`UPDATE en_measure SET site_id=$2, title=$3, category=$4, carrier=$5, status=$6, implemented_on=$7, kwh_expected=$8, kwh_verified=$9, ipmvp=$10, capex=$11, opex_year=$12, life_years=$13, owner=$14, mv_plan=$15, note=$16, updated_name=$17, updated_at=now() WHERE id = $1`,
        [mid, ...mcols(b), req.user.name]);
      if (!r.rowCount) throw notFound('Measure');
      await audit(c, req, 'energy.measure.update', 'en_measure', mid, b);
      return { ok: true };
    });
  });
  app.delete('/api/energy/measures/:mid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const mid = idOf(req, 'mid');
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM en_measure WHERE id = $1 RETURNING title`, [mid]);
      if (!r.rowCount) throw notFound('Measure');
      await audit(c, req, 'energy.measure.delete', 'en_measure', mid, { title: r.rows[0].title });
      return { ok: true };
    });
  });
  const scols = (b: z.infer<typeof seuBody>) => [b.siteId, b.name, b.carrier, b.sharePct, b.variables, b.enpi, b.controls, b.owner || null];
  app.post('/api/energy/seus', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = seuBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await getSite(c, b.siteId);
      const r = (await c.query(`INSERT INTO en_seu (tenant_id, site_id, name, carrier, share_pct, variables, enpi, controls, owner, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [tenant, ...scols(b), req.user.name])).rows[0];
      await audit(c, req, 'energy.seu.create', 'en_seu', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/energy/seus/:sid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const sid = idOf(req, 'sid'), b = seuBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await getSite(c, b.siteId);
      const r = await c.query(`UPDATE en_seu SET site_id=$2, name=$3, carrier=$4, share_pct=$5, variables=$6, enpi=$7, controls=$8, owner=$9 WHERE id = $1`, [sid, ...scols(b)]);
      if (!r.rowCount) throw notFound('Significant energy use');
      await audit(c, req, 'energy.seu.update', 'en_seu', sid, b);
      return { ok: true };
    });
  });
  app.delete('/api/energy/seus/:sid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const sid = idOf(req, 'sid');
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM en_seu WHERE id = $1 RETURNING name`, [sid]);
      if (!r.rowCount) throw notFound('Significant energy use');
      await audit(c, req, 'energy.seu.delete', 'en_seu', sid, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------------------------------- exports --
  app.get('/api/energy/sites/:id/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const year = z.object({ year: YEAR }).parse(req.query).year;
    const d = await tenantTx(tenant, async (c) => {
      const eko = await hasEkotrace(c, tenant);
      const s = await getSite(c, id), y = await siteYear(c, s, year, eko);
      const measures = (await c.query(`SELECT * FROM en_measure WHERE site_id = $1 ORDER BY status, title`, [id])).rows.map(measureView);
      const seus = (await c.query(`SELECT * FROM en_seu WHERE site_id = $1 ORDER BY share_pct DESC NULLS LAST`, [id])).rows.map(seuView);
      const t = (await c.query(`SELECT name, currency FROM tenant WHERE id = $1`, [tenant])).rows[0];
      await audit(c, req, 'energy.export', 'en_site', id, { year });
      return { s, y, measures, seus, t, eko };
    });
    const { s, y, measures, seus, t } = d;
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const sheet = (name: string, head: string[], widths: number[]) => { const ws = wb.addWorksheet(name); ws.addRow(head); styleHeader(ws, widths); return ws; };
    const r0 = (x: number | null | undefined, dp = 0) => (x == null ? '' : Math.round(x * 10 ** dp) / 10 ** dp);
    const sum = sheet('Summary', ['Item', 'Value'], [48, 60]);
    for (const row of [
      ['Company', t.name], ['Site', s.name], ['Type', SITE_TYPES[s.siteType]], ['Year', year], ['Baseline year', y.base ?? 'not set'], ['Energy, MWh', r0(y.total / 1000, 1)],
      ...CARRIERS.filter((k) => y.totals[k]).map((k) => [`  ${CARRIER_LABEL[k]}, MWh`, r0(y.totals[k] / 1000, 1)]),
      [`Cost (${t.currency})`, r0(y.cost)], [`EnPI (kWh per ${s.enpiVar === 'floor' ? 'm²' : s.enpiVar === 'production' ? s.productionUnit ?? 'unit' : s.enpiVar ? VARIABLE_LABEL[s.enpiVar] : '—'})`, r0(y.enpi, 3)],
      ['EnPI, baseline', r0(y.enpiBase, 3)], ['EnPI change', y.enpiChange == null ? '' : `${(y.enpiChange * 100).toFixed(1)}%`],
      [`Avoided energy (${y.savedMonths} months), MWh`, y.saving == null ? '' : r0(y.saving / 1000, 1)], [`Avoided cost (${t.currency})`, r0(y.savingCost)], ['Avoided emissions, tCO₂e', r0(y.savingT, 1)],
      ['Months flagged', y.anomalies],
    ] as [string, unknown][]) sum.addRow(row);
    const mo = sheet('Months', ['Month', ...CARRIERS.map((k) => `${CARRIER_LABEL[k]} kWh`), 'Production', 'CDD', 'HDD', 'Occupancy', 'Actual (model energy) kWh', 'Expected kWh', 'Avoided kWh', 'CUSUM kWh', 'EnPI', 'Flag', 'Note'],
      [10, 14, 14, 14, 14, 14, 12, 8, 8, 10, 16, 14, 14, 14, 10, 40, 30]);
    for (const m of y.months) mo.addRow([m.month, ...CARRIERS.map((k) => r0(m.energy[k])), m.production, m.cdd, m.hdd, m.occupancy, r0(m.actual), r0(m.expected), r0(m.saving), r0(m.cusum), r0(m.enpi, 4), m.anomaly ?? '', m.note]);
    const md = sheet('Baseline model', ['Item', 'Value'], [40, 70]);
    if (y.model) {
      for (const row of [
        ['Energy modelled', s.modelTarget === 'total' ? 'Total energy' : CARRIER_LABEL[s.modelTarget]], ['Baseline year', y.base], ['Months used', y.model.n],
        ['Equation', `kWh = ${r0(y.model.coef[0], 1)}${y.model.vars.map((v, i) => ` + ${r0(y.model!.coef[i + 1], 4)} × ${VARIABLE_LABEL[v]}`).join('')}`],
        ['R²', r0(y.model.r2, 3)], ['CV(RMSE) %', r0(y.model.cvrmse, 2)], ['NMBE %', r0(y.model.nmbe, 2)], ['Standard error, kWh', r0(y.model.se)],
        ...y.model.vars.map((v, i) => [`t-statistic, ${VARIABLE_LABEL[v]}`, r0(y.model!.t[i + 1], 2)]),
        ['Meets ASHRAE Guideline 14 (CV(RMSE) ≤ 15%, NMBE ±5%)', y.model.valid ? 'Yes' : 'No'], ...y.model.problems.map((p) => ['Check', p]),
      ] as [string, unknown][]) md.addRow(row);
    } else md.addRow(['No model', 'Choose a baseline year before the reporting year, with at least 9 months of energy and variables']);
    const me = sheet('Measures', ['Measure', 'Category', 'Carrier', 'Status', 'Implemented', 'Expected kWh/yr', 'Verified kWh/yr', 'IPMVP', 'Capex', `Saving ${t.currency}/yr`, 'Payback (yr)', 'NPV (8%)', 'tCO₂e/yr', 'M&V plan', 'Owner'], [40, 24, 16, 12, 12, 14, 14, 8, 14, 14, 10, 14, 10, 40, 18]);
    for (const m of measures) { const e = measureEcon(m, s, y.kgPerKwh); me.addRow([m.title, CATEGORIES[m.category], CARRIER_LABEL[m.carrier], m.status, m.implementedOn, m.kwhExpected, m.kwhVerified, m.ipmvp, m.capex, r0(e.saveYear), r0(e.payback, 1), r0(e.npv), r0(e.tYear, 1), m.mvPlan, m.owner]); }
    const se = sheet('Energy review (SEUs)', ['Significant energy use', 'Carrier', 'Share %', 'Relevant variables', 'EnPI', 'Operational controls', 'Owner'], [34, 16, 10, 30, 24, 40, 18]);
    for (const x of seus) se.addRow([x.name, CARRIER_LABEL[x.carrier], x.sharePct, x.variables, x.enpi, x.controls, x.owner]);
    const mt = wb.addWorksheet('Method'); mt.getColumn(1).width = 140;
    for (const line of [
      `Prepared in ${PRODUCT}. Energy ${d.eko && s.nodeId ? 'from the approved inventory entries of the linked facility (fuels by their net calorific values; gross-basis units × 0.9 for gases, × 0.95 for others), split by days across months; typed months replace them' : 'typed by month'}.`,
      'Savings: IPMVP Option C (whole facility). Baseline model by ordinary least squares over the baseline year; expected energy = the model with the reporting month\'s variables; avoided energy = expected − actual.',
      'Model quality per ASHRAE Guideline 14 for monthly data: CV(RMSE) ≤ 15% and NMBE within ±5%; variables with |t| < 2 are flagged. A month is flagged when it is off the model, after the saving of the two months before it and of the two after it, by more than 2 standard errors and 5% of the expected month.',
      'EnPI (ISO 50006): energy of the modelled carrier per unit of the chosen driver, over the months with both energy and the driver, compared with the same months of the baseline year (per m²: the floor area for the months covered).',
      'Measures: saving a year at the site tariff (verified if given, else expected) less extra running cost; simple payback; NPV at 8% over the life; tCO₂e a year at the carrier\'s intensity.',
      ...(y.problems.length ? ['', 'Checks:', ...y.problems] : []),
    ]) mt.addRow([line]);
    return sendWorkbook(reply, wb, `Energy_${s.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${year}.xlsx`);
  });

  app.get('/api/energy/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: YEAR }).parse(req.query).year;
    const d = await tenantTx(tenant, async (c) => {
      const eko = await hasEkotrace(c, tenant);
      const out = [];
      for (const r of (await c.query(`SELECT * FROM en_site ORDER BY name`)).rows) { const s = siteView(r); out.push({ s, y: await siteYear(c, s, year, eko) }); }
      const t = (await c.query(`SELECT name, currency FROM tenant WHERE id = $1`, [tenant])).rows[0];
      await audit(c, req, 'energy.export.portfolio', 'tenant', tenant, { year });
      return { out, t };
    });
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const ws = wb.addWorksheet('Sites');
    ws.addRow(['Site', 'Type', 'Months in', 'Energy MWh', ...CARRIERS.map((k) => `${CARRIER_LABEL[k]} MWh`), `Cost ${d.t.currency}`, 'kWh/m²', 'EnPI', 'EnPI baseline', 'EnPI change %', 'Avoided MWh', `Avoided ${d.t.currency}`, 'Avoided tCO₂e', 'Model meets G14', 'Months flagged']);
    styleHeader(ws, [30, 18, 10, 12, 12, 12, 12, 12, 12, 14, 10, 10, 12, 12, 12, 14, 12, 12, 12]);
    const r0 = (x: number | null | undefined, dp = 0) => (x == null ? '' : Math.round(x * 10 ** dp) / 10 ** dp);
    for (const { s, y } of d.out) ws.addRow([s.name, SITE_TYPES[s.siteType], y.monthsIn, r0(y.total / 1000, 1), ...CARRIERS.map((k) => r0(y.totals[k] / 1000, 1)), r0(y.cost), s.floorM2 && y.monthsIn === 12 ? r0(y.total / s.floorM2, 1) : '',
      r0(y.enpi, 3), r0(y.enpiBase, 3), y.enpiChange == null ? '' : r0(y.enpiChange * 100, 1), y.saving == null ? '' : r0(y.saving / 1000, 1), r0(y.savingCost), r0(y.savingT, 1), y.model ? (y.model.valid ? 'Yes' : 'No') : '', y.anomalies]);
    return sendWorkbook(reply, wb, `Energy_portfolio_${year}.xlsx`);
  });
}
