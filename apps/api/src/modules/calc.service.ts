/**
 * Connects the database to the pure calculation engine (@ekotrace/calc):
 * loads the item, its factors and the reference data, runs the right
 * calculation for the item's category, and returns the result with its steps.
 */
import { z } from 'zod';
import { calcBiological, calcCombustion, calcEnergy, calcFugitive, calcIncineration, calcLandfill, calcVehicle, calcWastewater, ch4FromGas, chooseFactors, convert, impliedCalorificValue, DEVICES, INCINERATORS, LANDFILL_MCF, WW_SYSTEMS, type CalcResult, type CertificateClaim, type Climate, type Factor, type Recovery, type SupplierFactor } from '@ekotrace/calc';
import { query } from '../db/pool.js';
import { AppError, notFound } from '../lib/errors.js';
import { refdata } from './refdata.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format yyyy-mm-dd');
const amount = z.number().finite().min(0);

export const fugitiveSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('quantity'), released: amount }),
  z.object({
    method: z.literal('screening'), operatingCharge: amount, annualLeakRatePct: z.number().min(0).max(100),
    months: z.number().min(0).max(12).optional(), newCharge: amount.optional(), installLossPct: z.number().min(0).max(100).optional(),
    disposedCharge: amount.optional(), remainingAtDisposalPct: z.number().min(0).max(100).optional(), recoveryPct: z.number().min(0).max(100).optional(),
  }),
  z.object({
    method: z.literal('mass_balance'), stockStart: amount, stockEnd: amount, purchased: amount, soldOrReturned: amount,
    newEquipmentCharge: amount, retiredEquipmentCharge: amount,
  }),
]);

/** Vehicles: how the entry was measured, and what the money bought (spend). */
export const vehicleSchema = z.object({
  method: z.enum(['distance', 'fuel', 'electricity', 'spend']),
  /** several identical vehicles: the quantity (or amount) is per vehicle */
  count: z.number().int().min(1).max(100000).optional(),
  /** fuel used, when it differs from the vehicle type's usual fuel (or the type's fuel is unknown) */
  fuelItemId: z.number().int().positive().optional(),
  /** electric / plug-in hybrid: charged at the company's own site (already on its meter) or elsewhere */
  charging: z.enum(['site', 'elsewhere']).optional(),
  spend: z.object({
    amount: amount,
    currency: z.string().regex(/^[A-Z]{3}$/, 'Currency as a 3-letter code, e.g. USD'),
    /** price per unit (the entry's unit); when omitted, the price list is used */
    price: z.number().finite().positive().optional(),
  }).optional(),
  /** a vehicle of the facility's fleet */
  vehicleId: z.string().uuid().optional(),
});

/** Purchased energy: grid region, supplier factor, certificates claimed, cooling plant efficiency. */
export const energySchema = z.object({
  /** grid region of this entry (else the facility's) */
  gridRegion: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,10})?$/).optional(),
  /** a factor from the supplier list … */
  supplierFactorId: z.string().uuid().optional(),
  /** … or one typed on the entry */
  supplier: z.object({ name: z.string().trim().min(1).max(120), co2e: z.number().finite().min(0), unit: z.string().min(1), source: z.string().trim().min(2).max(200) }).optional(),
  /** certificates / contracts claimed for this electricity, kWh each */
  certificates: z.array(z.object({ certificateId: z.string().uuid(), kwh: z.number().finite().positive() })).max(50).optional(),
  /** district cooling */
  cooling: z.object({ method: z.enum(['supplier', 'efficiency']), kwhPerTrh: z.number().finite().positive().optional(), cop: z.number().finite().positive().optional() }).optional(),
});

// -------------------------------------------------------------------- waste --
const frac = z.number().finite().min(0).max(1);
const device = z.enum(Object.keys(DEVICES) as [keyof typeof DEVICES, ...(keyof typeof DEVICES)[]]);
/** Methane recovered and burned (or sent out): kg CH4, or gas volume (normal m³) × methane %. */
export const recoverySchema = z.object({
  device, ch4Kg: amount.optional(), gasM3: amount.optional(), ch4Pct: z.number().min(0).max(100).optional(), de: frac.optional(),
}).refine((r) => r.ch4Kg !== undefined || (r.gasM3 !== undefined && r.ch4Pct !== undefined), 'Enter kg of methane, or the gas volume (m³) and its methane %');
const overridesSchema = z.record(z.string(), z.object({ dm: frac.optional(), doc: frac.optional(), cf: frac.optional(), fcf: frac.optional(), docf: frac.optional(), k: z.number().min(0).max(2).optional() }));
export const compositionSchema = z.record(z.string(), frac);
const streamSchema = z.object({ type: z.string().min(1).max(40), tonnes: amount });

export const wasteSchema = z.discriminatedUnion('process', [
  z.object({ process: z.literal('landfill'), siteId: z.string().uuid(), method: z.enum(['fod', 'collection']).default('fod'), collectionEfficiency: frac.optional(), recovery: z.array(recoverySchema).max(20).default([]) }),
  z.object({
    process: z.literal('incineration'), streams: z.array(streamSchema).min(1).max(30), composition: compositionSchema.optional(), overrides: overridesSchema.optional(),
    technology: z.string().refine((t) => t in INCINERATORS, 'Choose the incinerator technology'), of: frac.optional(), ch4PerT: amount.optional(), n2oPerT: amount.optional(),
    measured: z.object({ co2Tonnes: amount, biogenicPct: z.number().min(0).max(100), source: z.string().trim().min(2).max(200) }).optional(), exportedMWh: amount.optional(),
  }),
  z.object({
    process: z.enum(['composting', 'ad']), tonnes: amount, basis: z.enum(['wet', 'dry']).default('wet'), ch4PerT: amount.optional(), n2oPerT: amount.optional(),
    measured: z.object({ ch4ProducedKg: amount.optional(), gasM3: amount.optional(), ch4Pct: z.number().min(0).max(100).optional(), leakPct: z.number().min(0).max(100).optional(), recovery: z.array(recoverySchema).max(20).default([]) })
      .refine((m) => m.ch4ProducedKg !== undefined || (m.gasM3 !== undefined && m.ch4Pct !== undefined), 'Enter the methane produced (kg), or the biogas volume and its methane %').optional(),
  }),
  z.object({
    process: z.literal('wastewater'), kind: z.enum(['domestic', 'industrial']), system: z.string().refine((t) => t in WW_SYSTEMS, 'Choose the treatment system'), mcf: frac.optional(),
    measure: z.enum(['BOD', 'COD']), organicsKg: amount.optional(), flowM3: amount.optional(), mgPerL: amount.optional(), sludgeKg: amount.optional(), bo: amount.optional(),
    recovery: z.array(recoverySchema).max(20).default([]), nInfluentKg: amount.optional(), efPlant: frac.optional(), nEffluentKg: amount.optional(), efEffluent: frac.optional(),
    effluentOrganicsKg: amount.optional(), mcfDischarge: frac.optional(),
    /** with flow: concentrations instead of kg (mg/L) */
    nInfluentMgPerL: amount.optional(), nEffluentMgPerL: amount.optional(), effluentMgPerL: amount.optional(),
  }).refine((w) => w.organicsKg !== undefined || (w.flowM3 !== undefined && w.mgPerL !== undefined), 'Enter the organics treated (kg), or the flow (m³) and its concentration (mg/L)'),
]);
export type WasteInput = z.infer<typeof wasteSchema>;

/**
 * Business travel. Flights: from / to airports (IATA; a connecting flight is saved one entry per leg)
 * or the flight type (a typical distance for the type); class; return; trips (journeys × people).
 * The flight's DESNZ item and the passenger-km are worked out here.
 * Hotel stays: rooms × nights (the item is the country); the star rating's factor when the factor
 * library has one, and meeting space (m² × hours). Other transport: one-way km × trips (× 2 when return).
 */
export const tripSchema = z.object({
  kind: z.enum(['flight', 'hotel', 'meeting', 'ground']),
  from: z.string().trim().length(3).optional(), to: z.string().trim().length(3).optional(),
  haul: z.enum(['domestic', 'short', 'long', 'intl']).optional(),
  cls: z.enum(['average', 'economy', 'premium', 'business', 'first']).optional(),
  rf: z.boolean().optional(),
  km: z.number().finite().positive().max(25000).optional(),
  ret: z.boolean().optional(),
  trips: z.number().finite().positive().max(100000).optional(),
  /** a leg of a connecting flight: "1/2", and the whole route "DXB-DOH-LHR" */
  leg: z.string().trim().regex(/^\d\/\d$/).optional(), route: z.string().trim().max(40).optional(),
  rooms: z.number().finite().positive().max(10000).optional(),
  nights: z.number().finite().min(0).max(366).optional(),
  stars: z.number().int().min(2).max(5).optional(),
  meetingSqm: z.number().finite().positive().max(100000).optional(),
  meetingHours: z.number().finite().positive().max(1000).optional(),
  ownFactor: z.number().finite().min(0).max(1000).optional(),
  ownSource: z.string().trim().max(200).optional(),
  who: z.string().trim().max(120).optional(),
  ref: z.string().trim().max(120).optional(),
});
export type TripInput = z.infer<typeof tripSchema>;

export const calcInputSchema = z.object({
  /** the catalogue item; for a flight it is worked out from the trip */
  itemId: z.number().int().positive().optional(),
  trip: tripSchema.optional(),
  unit: z.string().min(1),
  quantity: amount.optional(), // combustion
  /** optional calorific value entered by the user (combustion only) */
  cv: z.object({ value: z.number().finite().positive(), energyUnit: z.string().min(1), perUnit: z.string().min(1) }).optional(),
  fugitive: fugitiveSchema.optional(), // fugitive
  periodStart: isoDate,
  periodEnd: isoDate,
  region: z.string().length(2).or(z.literal('GLOBAL')).optional(),
  gwpSet: z.enum(['AR4', 'AR5', 'AR6']).optional(),
  vehicle: vehicleSchema.optional(),
  energy: energySchema.optional(),
  waste: wasteSchema.optional(),
  /** water: the utility's own factor per m³ (replaces the default) */
  water: z.object({ ownFactor: z.number().finite().min(0).max(100).optional(), source: z.string().max(200).optional() }).optional(),
  /** waste sent to others: details for ESG reporting (no effect on the emissions) */
  /** waste sent out: hazardous (default from the material, can be changed), contractor, manifest / weighbridge ticket, and the
   *  GRI 306 operation when it is not the factor's own route (re-use, incineration without energy recovery, other disposal) */
  wasteInfo: z.object({ hazardous: z.boolean().optional(), contractor: z.string().max(120).optional(), ref: z.string().max(120).optional(),
    gri: z.enum(['reuse', 'recycling', 'composting', 'ad', 'incin_er', 'incin_noer', 'landfill', 'other']).optional() }).optional(),
});
export type CalcInput = z.infer<typeof calcInputSchema>;

interface ItemRow {
  id: number; name: string; active: boolean; category_id: number; category: string; calc_method: 'combustion' | 'fugitive' | 'vehicle' | 'electricity' | 'waste' | 'waste_disposal' | 'travel' | 'water' | 'trip' | 'asset';
  sub_units: string[]; gas_code: string | null; sub_active: boolean; code: string;
  attrs: { vehicle?: string; powertrain?: string; fuel?: string | null; electric?: boolean; phev?: boolean; distance?: boolean };
}

export async function loadItem(itemId: number): Promise<ItemRow> {
  const [row] = await query<ItemRow>(
    `SELECT i.id, i.code, i.name, i.active, i.gas_code, i.attrs, s.units AS sub_units, s.active AS sub_active,
            c.id AS category_id, c.name AS category, c.calc_method
       FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
      WHERE i.id = $1`, [itemId]);
  if (!row) throw notFound('Item');
  return row;
}

/** All active factors of an item, with their gas split, shaped for the engine. */
export async function loadFactors(itemId: number): Promise<Factor[]> {
  const rows = await query<{
    id: number; basis: Factor['basis']; unit: string; co2e: number | null; region: string; valid_from: string; valid_to: string;
    source: string; gwp_set: string | null; gases: { gas: string; kg: number }[] | null;
  }>(
    `SELECT f.id, f.basis, f.unit, f.co2e, f.region, f.valid_from, f.valid_to, s.code AS source, s.gwp_set,
            (SELECT json_agg(json_build_object('gas', g.gas, 'kg', g.kg_per_unit)) FROM factor_gas g WHERE g.factor_id = f.id) AS gases
       FROM factor f JOIN factor_source s ON s.id = f.source_id
      WHERE f.item_id = $1 AND f.status = 'active'`, [itemId]);
  return rows.map((r) => ({
    id: r.id, itemId, basis: r.basis, unit: r.unit, co2ePerUnit: r.co2e, sourceGwpSet: r.gwp_set,
    gases: (r.gases ?? []).map((g) => ({ gas: g.gas, kgPerUnit: Number(g.kg) })),
    source: r.source.replace('-', ' '), validFrom: r.valid_from, validTo: r.valid_to, region: r.region,
  }));
}

export interface PriceFound { price: number; unit: string; currency: string; source: string }
export interface CertificateRow { id: string; label: string; co2e_per_kwh: number; mwh: number; claimed_other_kwh: number; market: string; vintage_from: string; vintage_to: string; facility_id: string | null }
export interface CalcContext {
  gwpSet: string;
  region: string;
  /** grid region of the facility (state / emirate / grid), if set */
  gridRegion?: string | null;
  facilityId?: string;
  /** the entry being recalculated: its own certificate claims do not count as used elsewhere */
  activityId?: string;
  lookupSupplier?: (id: string) => Promise<(SupplierFactor & { validFrom: string; validTo: string; energy: string }) | null>;
  lookupCertificates?: (ids: string[], excludeActivityId?: string) => Promise<CertificateRow[]>;
  /** price list lookup (company price first, then the platform list) */
  lookupPrice?: (itemId: number, region: string, date: string, currency: string) => Promise<PriceFound | null>;
  /** the company's factor-year setting (calendar month, or one year per reporting year) */
  lookupFactorYear?: () => Promise<FactorYear | null>;
  /** a landfill of the company with its tonnage history */
  lookupWasteSite?: (id: string) => Promise<WasteSiteRow | null>;
}
export interface WasteSiteParams {
  climate?: Climate; siteType?: string; mcf?: number; ox?: number; f?: number; delayMonths?: number;
  composition?: Record<string, number>; overrides?: Record<string, Record<string, number>>;
}
export interface WasteSiteRow { id: string; name: string; facility_id: string; params: WasteSiteParams; deposits: { year: number; type: string; tonnes: number }[] }

/** What is stored as the entry's quantity: for spend, the fuel / kWh bought. */
export interface Stored { quantity: number; unit: string; inputs: Record<string, unknown> }

export type FactorYearMode = 'calendar' | 'fy_start' | 'fy_end';
export interface FactorYear { mode: FactorYearMode; startMonth: number }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Start year of the reporting year a date falls in. */
function fyStartYear(date: string, startMonth: number) { const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)); return m >= startMonth ? y : y - 1; }
/** e.g. "Apr 2024 – Mar 2025". */
export function fyLabel(date: string, fy: FactorYear) {
  const y = fyStartYear(date, fy.startMonth);
  return fy.startMonth === 1 ? String(y) : `${MON[fy.startMonth - 1]} ${y} – ${MON[(fy.startMonth + 10) % 12]} ${y + 1}`;
}
/**
 * The date used to choose factors. Calendar (default): the period's own date. Reporting year: every month of
 * the reporting year uses one calendar year's factors — the year it starts in, or the year it ends in.
 */
export function factorDate(date: string, fy: FactorYear | null | undefined): string {
  if (!fy || fy.mode === 'calendar' || fy.startMonth === 1) return date;
  const start = fyStartYear(date, fy.startMonth);
  const y = fy.mode === 'fy_start' ? start : start + 1;
  const md = date.slice(4) === '-02-29' ? '-02-28' : date.slice(4);
  return `${y}${md}`;
}

export async function calculate(input: CalcInput, ctx: CalcContext): Promise<{ result: CalcResult; item: ItemRow; gwpSet: string; stored: Stored }> {
  if (input.periodEnd < input.periodStart) throw new AppError('The period ends before it starts');
  const ref = await refdata();
  const tripInfo = input.trip ? await resolveTrip(input) : null;
  if (!input.itemId) throw new AppError('Choose what to calculate');
  const item = await loadItem(input.itemId);
  if (!item.active || !item.sub_active) throw new AppError(`${item.name} is switched off in the catalogue`);
  if (item.calc_method !== 'vehicle' && item.calc_method !== 'waste' && item.sub_units.length && !item.sub_units.includes(input.unit)) {
    throw new AppError(`${input.unit} is not offered for this fuel class. Use one of: ${item.sub_units.join(', ')}`);
  }
  const gwpSet = input.gwpSet ?? ctx.gwpSet;
  const gwp = ref.gwp.get(gwpSet);
  if (!gwp) throw new AppError(`Unknown GWP set ${gwpSet}`);
  const region = input.region ?? ctx.region;
  const date = input.periodStart;
  // Which year's factors: the month's own calendar year, or one year for the whole reporting year (company setting).
  const fy = ctx.lookupFactorYear ? await ctx.lookupFactorYear() : null;
  const fdate = factorDate(date, fy);

  let result: CalcResult;
  let stored: Stored = { quantity: input.quantity ?? 0, unit: input.unit, inputs: input.cv ? { cv: input.cv } : {} };
  if (item.calc_method === 'waste') {
    const w = await wasteCalc(input, item, ctx, gwp);
    result = w.result; stored = w.stored;
  } else if (item.calc_method === 'waste_disposal') {
    if (input.quantity === undefined) throw new AppError('Enter the tonnes of waste');
    // A hazardous stream DESNZ has no factor for (clinical, chemical, oily waste…) uses the nearest DESNZ factor: a proxy, and says so.
    let factors = await loadFactors(item.id);
    const proxy = (item.attrs as { proxy?: string } | null)?.proxy;
    let proxyNote: string | null = null;
    if (!factors.length && proxy) {
      const [pi] = await query<{ id: number; name: string }>('SELECT id, name FROM item WHERE code = $1', [proxy]);
      if (pi) { factors = await loadFactors(pi.id); proxyNote = `No DESNZ factor for ${item.name}: ${pi.name} used as a proxy`; }
    }
    if (!factors.length) throw new AppError(`${item.name}: no factor in the library`);
    result = calcCombustion({ itemName: item.name, quantity: input.quantity, unit: input.unit, date: fdate, region, factors, gwp, units: ref.units });
    if (proxyNote) { result.steps.unshift(proxyNote); result.warnings.push(`${proxyNote} — mark the entry as proxy data.`); }
    const gri = input.wasteInfo?.gri, rt = (item.attrs as { route?: string } | null)?.route;
    if (gri === 'reuse') result.steps.push('Preparation for re-use: DESNZ has no re-use factor, the recycling factor (collection and transport to the facility) is used');
    if (gri === 'incin_noer') result.steps.push('Incineration without energy recovery: same DESNZ combustion factor (energy recovered is never subtracted); reported as disposal without recovery (GRI 306-5)');
    if (gri === 'other' && rt !== 'treatment') result.steps.push('Other disposal: the factor of the route chosen is used as the nearest');
    stored = { quantity: input.quantity, unit: input.unit, inputs: input.wasteInfo && Object.values(input.wasteInfo).some((v) => v !== undefined && v !== '') ? { wasteInfo: input.wasteInfo } : {} };
  } else if (item.calc_method === 'water') {
    if (input.quantity === undefined) throw new AppError('Enter the volume of water');
    const m3 = convert(ref.units, input.quantity, input.unit, 'm3');
    const zero = { direct: 0, wtt: 0, outside_scopes: 0, memo: 0, scope2: 0, scope2_market: 0, td_loss: 0, scope3: 0 };
    const own = input.water?.ownFactor;
    const factors = await loadFactors(item.id);
    if (own !== undefined) {
      const kg = m3 * own;
      result = { totals: { ...zero, scope3: kg }, lines: [{ basis: 'scope3', gas: 'CO2e', kgGas: null, kgCo2e: kg, factorId: null, method: 'published' }], factors: [],
        steps: [`${fmtN(m3)} m³ × ${own} kg CO₂e/m³ (${input.water?.source || 'factor entered'}) = ${fmtN(kg)} kg CO₂e`], warnings: [] } as unknown as CalcResult;
    } else if (factors.length) {
      result = calcCombustion({ itemName: item.name, quantity: m3, unit: 'm3', date: fdate, region, factors, gwp, units: ref.units });
      if (item.attrs && (item.attrs as { desal?: boolean }).desal) result.warnings.push('DESNZ water supply factor (UK average) used: desalinated water takes much more energy. Enter the utility\'s factor per m³ when you have it.');
    } else {
      result = { totals: zero, lines: [], factors: [], steps: [`${item.name}: ${fmtN(m3)} m³, no Scope 3 emissions`], warnings: [] } as unknown as CalcResult;
    }
    stored = { quantity: input.quantity, unit: input.unit, inputs: input.water && own !== undefined ? { water: input.water } : {} };
  } else if (item.calc_method === 'travel') {
    if (input.quantity === undefined) throw new AppError('Enter the distance');
    const factors = await loadFactors(item.id);
    if (!factors.length) {
      // walking and cycling: distance counted, no emissions
      result = { totals: { direct: 0, wtt: 0, outside_scopes: 0, memo: 0, scope2: 0, scope2_market: 0, td_loss: 0, scope3: 0 }, lines: [], steps: [`${item.name}: no emissions`], warnings: [], factors: [] } as unknown as CalcResult;
    } else {
      result = calcCombustion({ itemName: item.name, quantity: input.quantity, unit: input.unit, date: fdate, region, factors, gwp, units: ref.units });
      // Employee commuting: the fuel's well-to-tank belongs to the same category (3.7), not to 3.3.
      if (result.totals.wtt) {
        result.totals.scope3 += result.totals.wtt;
        result.steps.push(`Well-to-tank ${result.totals.wtt.toFixed(3)} kg CO2e counted in the same Scope 3 category`);
        result.totals.wtt = 0;
        for (const l of result.lines) if (l.basis === 'wtt') l.basis = 'scope3';
      }
    }
    stored = { quantity: input.quantity, unit: input.unit, inputs: {} };
  } else if (item.calc_method === 'trip') {
    if (input.quantity === undefined) throw new AppError(item.code.startsWith('bt:hotel') ? 'Enter the rooms and nights' : 'Enter the distance');
    const own = input.trip?.ownFactor;
    if (own !== undefined) {
      const kg = input.quantity * own;
      result = { totals: { direct: 0, wtt: 0, outside_scopes: 0, memo: 0, scope2: 0, scope2_market: 0, td_loss: 0, scope3: kg },
        lines: [{ basis: 'scope3', gas: 'CO2e', kgGas: null, kgCo2e: kg, factorId: null, method: 'published' }], factors: [],
        steps: [`${fmtN(input.quantity)} ${input.unit === 'room_night' ? 'room-nights' : input.unit} × ${own} kg CO₂e (${input.trip?.ownSource || 'factor entered'}) = ${fmtN(kg)} kg CO₂e`], warnings: [] } as unknown as CalcResult;
    } else {
      const factors = await loadFactors(item.id);
      if (!factors.length && tripInfo?.noFactor) {
        result = { totals: { direct: 0, wtt: 0, outside_scopes: 0, memo: 0, scope2: 0, scope2_market: 0, td_loss: 0, scope3: 0 }, lines: [], factors: [],
          steps: [`${item.name}: no factor yet — not counted`], warnings: [] } as unknown as CalcResult;
      } else {
      if (!factors.length) throw new AppError(item.code.startsWith('bt:hotel') ? `${item.name}: no DESNZ factor — choose a nearby country.` : `${item.name}: no factor loaded — restart the app to load the DESNZ files.`);
      result = calcCombustion({ itemName: item.name, quantity: input.quantity, unit: input.unit, date: fdate, region: tripInfo?.region ?? 'GLOBAL', factors, gwp, units: ref.units });
      // The well-to-tank of the travel belongs to the same category (3.6), not to 3.3.
      if (result.totals.wtt) {
        result.totals.scope3 += result.totals.wtt;
        result.steps.push(`Well-to-tank ${result.totals.wtt.toFixed(3)} kg CO2e counted in business travel (3.6)`);
        result.totals.wtt = 0;
        for (const l of result.lines) if (l.basis === 'wtt') l.basis = 'scope3';
      }
      }
    }
    if (tripInfo) result.steps.unshift(...tripInfo.steps);
    if (tripInfo?.warnings.length) result.warnings.push(...tripInfo.warnings);
    stored = { quantity: input.quantity, unit: input.unit, inputs: input.trip ? { trip: { ...input.trip, ...(tripInfo?.stored ?? {}) } } : {} };
  } else if (item.calc_method === 'electricity') {
    if (input.quantity === undefined) throw new AppError('Enter the quantity of energy');
    const e = await energyCalc(input, item, ctx, ref.units, gwp, date, fdate);
    result = e.result; stored = e.stored;
  } else if (item.calc_method === 'asset') {
    // Transport & distribution (3.4, 3.9) and leased assets (3.8, 3.13): everything lands in the category's Scope 3.
    if (input.quantity === undefined) throw new AppError('Enter the quantity');
    const a = (item.attrs ?? {}) as { via?: string; eui?: number; euiSource?: string; reported?: boolean };
    const zero = { direct: 0, wtt: 0, outside_scopes: 0, memo: 0, scope2: 0, scope2_market: 0, td_loss: 0, scope3: 0 };
    const uName = (u: string) => ref.units.get(u)?.name ?? u;
    if (a.reported) {
      // emissions reported by the carrier, landlord or tenant
      const kg = convert(ref.units, input.quantity, input.unit, 'kgco2e');
      result = { totals: { ...zero, scope3: kg }, lines: [{ basis: 'scope3', gas: 'CO2e', kgGas: null, kgCo2e: kg, factorId: null, method: 'published' }], factors: [],
        steps: [`Reported: ${fmtN(input.quantity)} ${uName(input.unit)} = ${fmtN(kg)} kg CO₂e`], warnings: [] } as unknown as CalcResult;
    } else if (a.via || a.eui != null) {
      // energy known (or estimated from the floor area): the platform's own grid or fuel factors
      const pre: string[] = [];
      let qty = input.quantity, unit = input.unit, via = a.via;
      if (a.eui != null) {
        const m2d = convert(ref.units, input.quantity, input.unit, 'm2_day');
        qty = (m2d * a.eui) / 365.25; unit = 'kWh_e'; via = 'grid:electricity';
        pre.push(`${fmtN(input.quantity)} ${uName(input.unit)} = ${fmtN(m2d)} m²·days × ${a.eui} kWh per m² per year ÷ 365.25 = ${fmtN(qty)} kWh of electricity (typical ${item.name.toLowerCase()}${a.euiSource ? `, ${a.euiSource}` : ''})`);
      }
      const [v] = await query<{ id: number }>('SELECT id FROM item WHERE code = $1 AND active', [via]);
      if (!v) throw new AppError(`${item.name}: its factor (${via}) is not in the library`);
      const sub = await calculate({ ...input, itemId: v.id, quantity: qty, unit, energy: undefined, cv: undefined, trip: undefined }, ctx);
      const t = sub.result.totals;
      const moved: Record<string, true> = { direct: true, scope2: true, td_loss: true, wtt: true, scope3: true };
      result = {
        totals: { ...zero, scope3: t.direct + t.scope2 + t.td_loss + t.wtt + t.scope3, outside_scopes: t.outside_scopes, memo: t.memo },
        lines: sub.result.lines.filter((l) => l.basis !== 'scope2_market').map((l) => (moved[l.basis] ? { ...l, basis: 'scope3' as const } : l)),
        factors: sub.result.factors.filter((f) => f.basis !== 'scope2_market'),
        steps: [...pre, ...sub.result.steps.filter((x) => !/^Market-based/.test(x)), `All of it counted in ${item.category}: the energy of an asset you lease, or of transport and storage by others, is not your Scope 1 or 2. Grid losses and upstream fuel are included.`],
        warnings: sub.result.warnings,
      } as unknown as CalcResult;
    } else {
      // freight per tonne-km / km, leased vehicles per km: DESNZ factors; the well-to-tank goes with them
      const factors = await loadFactors(item.id);
      if (!factors.length) throw new AppError(`${item.name}: no factor loaded — restart the app to load the DESNZ files.`);
      result = calcCombustion({ itemName: item.name, quantity: input.quantity, unit: input.unit, date: fdate, region, factors, gwp, units: ref.units });
      if (result.totals.wtt || result.totals.direct) {
        result.totals.scope3 += result.totals.wtt + result.totals.direct;
        if (result.totals.wtt) result.steps.push(`Well-to-tank ${result.totals.wtt.toFixed(3)} kg CO2e counted in the same category`);
        result.totals.wtt = 0; result.totals.direct = 0;
        for (const l of result.lines) if (l.basis === 'wtt' || l.basis === 'direct') l.basis = 'scope3';
      }
    }
    stored = { quantity: input.quantity, unit: input.unit, inputs: {} };
  } else if (item.calc_method === 'vehicle') {
    if (input.quantity === undefined && !input.vehicle?.spend) throw new AppError('Enter the distance, fuel, electricity or spend');
    const v = await vehicleCalc(input, item, ctx, ref.units, gwp, region, date, fdate);
    result = v.result; stored = v.stored;
  } else if (item.calc_method === 'combustion') {
    if (input.quantity === undefined) throw new AppError('Enter the quantity of fuel');
    result = calcCombustion({ itemName: item.name, quantity: input.quantity, unit: input.unit, date: fdate, region, factors: await loadFactors(item.id), gwp, units: ref.units, cv: input.cv });
  } else {
    if (input.cv) throw new AppError('A calorific value applies to fuels only');
    if (!input.fugitive) throw new AppError('Choose a method and enter the gas quantities');
    const composition = item.gas_code
      ? [{ gas: item.gas_code, fraction: 1 }]
      : (await query<{ gas: string; fraction: number }>('SELECT gas, fraction FROM item_gas WHERE item_id = $1 ORDER BY fraction DESC', [item.id]));
    let blendFactors: Factor[] = [];
    if (!composition.length) {
      const chosen = chooseFactors(await loadFactors(item.id), { date: fdate, region, unit: 'kg', units: ref.units });
      blendFactors = [...chosen.values()].map((c) => c.factor);
    }
    result = calcFugitive({ itemName: item.name, unit: input.unit, data: input.fugitive, composition, blendFactors, gwp, units: ref.units, kyoto: (g) => ref.kyoto.has(g) });
  }
  if (fdate.slice(0, 4) !== date.slice(0, 4)) {
    result.steps.push(`Factors of ${fdate.slice(0, 4)} used for the whole reporting year ${fyLabel(date, fy!)} (company setting: factor year follows the reporting year).`);
  } else if (input.periodStart.slice(0, 4) !== input.periodEnd.slice(0, 4) && item.calc_method !== 'waste') {
    result.warnings.push(`The period spans two calendar years; factors for ${input.periodStart.slice(0, 4)} were used.`);
  }
  if (item.calc_method === 'fugitive') stored = { quantity: result.lines.reduce((s, l) => s + (l.kgGas ?? 0), 0), unit: input.unit, inputs: input.fugitive ?? {} };
  if (result.cv) stored.inputs = { ...stored.inputs, cv: result.cv };
  return { result, item, gwpSet, stored };
}

/**
 * Calorific value implied by the item's own factors (e.g. DESNZ per litre vs
 * per kWh), offered as the default when a user enters their own value.
 */
export async function defaultCalorificValue(itemId: number, q: { energyUnit: string; perUnit: string; date: string; region: string }) {
  const ref = await refdata();
  const factors = await loadFactors(itemId);
  try {
    return impliedCalorificValue(factors, { ...q, units: ref.units });
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ vehicles --
async function itemByCode(code: string) {
  const [r] = await query<{ id: number; name: string }>('SELECT id, name FROM item WHERE code = $1', [code]);
  return r ?? null;
}

/** kWh per km / mile of an electric or plug-in hybrid vehicle valid on the date (else the latest earlier). */
async function evEnergy(itemId: number, date: string, unit: string) {
  const rows = await query<{ unit: string; kwh: number; valid_from: string; source: string }>(
    `SELECT e.unit, e.kwh_per_unit AS kwh, e.valid_from::text, replace(s.code, '-', ' ') AS source
       FROM vehicle_energy e JOIN factor_source s ON s.id = e.source_id
      WHERE e.item_id = $1 AND e.status = 'active' AND e.valid_from <= $2::date
      ORDER BY e.valid_from DESC, (e.unit = $3) DESC LIMIT 1`, [itemId, date, unit]);
  const r = rows[0];
  return r ? { unit: r.unit, kwhPerUnit: Number(r.kwh), source: r.source } : null;
}

async function vehicleCalc(input: CalcInput, item: ItemRow, ctx: CalcContext, units: Awaited<ReturnType<typeof refdata>>['units'],
  gwp: Parameters<typeof calcVehicle>[0]['gwp'], region: string, date: string, fdate = date): Promise<{ result: CalcResult; stored: Stored }> {
  const v = input.vehicle ?? { method: 'distance' as const };
  const a = item.attrs ?? {};
  const electric = !!a.electric, phev = !!a.phev;
  if (v.method === 'distance' && a.distance === false) throw new AppError(`${item.name} is entered by fuel used or spend (no distance factors)`);

  // Fuel burned (fuel and spend methods, not for electric vehicles).
  let fuel: { id: number; name: string; factors: Factor[] } | undefined;
  if (!electric && (v.method === 'fuel' || v.method === 'spend')) {
    const f = v.fuelItemId
      ? (await query<{ id: number; name: string }>('SELECT id, name FROM item WHERE id = $1', [v.fuelItemId]))[0]
      : a.fuel ? await itemByCode(a.fuel) : null;
    if (!f) throw new AppError(`Choose the fuel ${item.name} uses`);
    fuel = { ...f, factors: await loadFactors(f.id) };
  }
  const grid = await itemByCode('grid:electricity');
  const gridFactors = grid ? (await loadFactors(grid.id)).filter((f) => f.basis === 'scope2') : [];

  // Spend: find the price (entered, company list, platform list).
  let spend: Parameters<typeof calcVehicle>[0]['spend'];
  const count = v.count ?? 1;
  let qty = (input.quantity ?? 0) * count;
  let unit = input.unit;
  if (v.method === 'spend') {
    if (!v.spend) throw new AppError('Enter the amount spent and its currency');
    const buys = electric ? 'electricity' as const : 'fuel' as const;
    if (buys === 'electricity') unit = 'kWh_e';
    const priceItem = buys === 'fuel' ? fuel! : grid;
    if (!priceItem) throw new AppError('Grid electricity item missing');
    let found: PriceFound | null = v.spend.price ? { price: v.spend.price, unit, currency: v.spend.currency, source: 'price entered' } : null;
    if (!found && ctx.lookupPrice) found = await ctx.lookupPrice(priceItem.id, region, date, v.spend.currency);
    if (!found) throw new AppError(`No ${v.spend.currency} price for ${buys === 'fuel' ? priceItem.name : 'electricity'} in ${region} on ${date}. Enter the price, or add it to the price list.`);
    // Price per the entry's unit (e.g. a price per US gallon used for litres).
    const pricePerUnit = found.unit === unit ? found.price : found.price * convert(units, 1, unit, found.unit);
    spend = { currency: v.spend.currency, price: pricePerUnit, priceUnit: unit, priceSource: found.source, buys };
    qty = v.spend.amount * count;
  }
  const result = calcVehicle({
    vehicleName: item.name, electric, phev, method: v.method, quantity: qty, unit, date: fdate, region,
    vehicleFactors: a.distance === false ? [] : await loadFactors(item.id),
    fuel: fuel ? { name: fuel.name, factors: fuel.factors, cv: input.cv } : undefined,
    evEnergy: (electric || phev) && v.method === 'distance' ? await evEnergy(item.id, fdate, unit) : null,
    gridFactors, charging: v.charging ?? 'elsewhere', spend, gwp, units,
  });
  if (count > 1) {
    const per = v.method === 'spend' ? v.spend!.amount : input.quantity ?? 0;
    result.steps.unshift(`${count} vehicles × ${per} ${v.method === 'spend' ? v.spend!.currency : unit} each = ${qty} ${v.method === 'spend' ? v.spend!.currency : unit}`);
  }
  const stored: Stored = v.method === 'spend'
    ? { quantity: qty / spend!.price, unit, inputs: { vehicle: { ...v, price: spend!.price, priceUnit: unit, priceSource: spend!.priceSource, fuelItemId: fuel?.id } } }
    : { quantity: qty, unit, inputs: { vehicle: { ...v, fuelItemId: fuel?.id ?? v.fuelItemId } } };
  return { result, stored };
}

/** Price list lookup: the company's own price first, then the platform list; latest valid on the date. */
export async function findPrice(c: { query: (q: string, p: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  itemId: number, region: string, date: string, currency: string): Promise<PriceFound | null> {
  const r = (await c.query(
    `SELECT price, unit, currency, source, tenant_id FROM price
      WHERE item_id = $1 AND region = $2 AND currency = $4 AND valid_from <= $3::date AND valid_to >= $3::date
      ORDER BY (tenant_id IS NOT NULL) DESC, valid_from DESC LIMIT 1`, [itemId, region, date, currency])).rows[0];
  return r ? { price: Number(r.price), unit: String(r.unit), currency: String(r.currency), source: `price list: ${r.source}` } : null;
}

// --------------------------------------------------------- purchased energy --
const ENERGY_OF: Record<string, 'electricity' | 'heat' | 'cooling'> = { 'grid:electricity': 'electricity', 'heat:district': 'heat', 'cooling:district': 'cooling' };

async function energyCalc(input: CalcInput, item: ItemRow, ctx: CalcContext, units: Awaited<ReturnType<typeof refdata>>['units'],
  gwp: Parameters<typeof calcEnergy>[0]['gwp'], date: string, fdate = date): Promise<{ result: CalcResult; stored: Stored }> {
  const energy = ENERGY_OF[item.code];
  if (!energy) throw new AppError(`${item.name} is not set up for purchased energy`);
  const e = input.energy ?? {};
  const country = ctx.region.slice(0, 2);
  const first = e.gridRegion ?? ctx.gridRegion ?? country;
  const regions = [...new Set([first, first.slice(0, 2)])];
  const warnings: string[] = [];

  // Supplier factor: from the list (checked against the energy and the period) or typed in.
  let supplier: SupplierFactor | null = null;
  if (e.supplierFactorId) {
    const s = ctx.lookupSupplier ? await ctx.lookupSupplier(e.supplierFactorId) : null;
    if (!s) throw new AppError('Supplier factor not found');
    if (s.energy !== energy) throw new AppError(`That supplier factor is for ${s.energy}, not ${energy}`);
    if (date < s.validFrom || date > s.validTo) warnings.push(`The supplier factor of ${s.name} is for ${s.validFrom.slice(0, 7)} – ${s.validTo.slice(0, 7)}, not this period.`);
    supplier = s;
  } else if (e.supplier) {
    supplier = { name: e.supplier.name, co2ePerUnit: e.supplier.co2e, unit: e.supplier.unit, source: e.supplier.source };
  }
  if (supplier) {
    const u = units.get(supplier.unit);
    const want = { electricity: 'electricity', heat: 'heat', cooling: 'cooling' }[energy];
    if (!u || u.dimension !== want) throw new AppError(`The supplier factor must be per unit of ${want} (e.g. per kWh${energy === 'cooling' ? ' or per TRh' : ''})`);
  }

  // Certificates: same company, this facility (or any), enough left, right market and vintage.
  const claims: CertificateClaim[] = [];
  if (e.certificates?.length) {
    if (energy !== 'electricity') throw new AppError('Certificates apply to electricity only');
    const rows = ctx.lookupCertificates ? await ctx.lookupCertificates(e.certificates.map((x) => x.certificateId), ctx.activityId) : [];
    for (const want of e.certificates) {
      const c = rows.find((r) => r.id === want.certificateId);
      if (!c) throw new AppError('Certificate not found');
      if (c.facility_id && ctx.facilityId && c.facility_id !== ctx.facilityId) throw new AppError(`${c.label} is assigned to another facility`);
      const left = Number(c.mwh) * 1000 - Number(c.claimed_other_kwh);
      const kwhClaim = convert(units, want.kwh, 'kWh_e', 'kWh_e');
      if (kwhClaim > left + 1e-6) throw new AppError(`${c.label}: only ${Math.max(0, Math.round(left)).toLocaleString('en')} kWh left to claim`);
      if (c.market !== country) warnings.push(`${c.label} is from the ${c.market} market, not ${country}: the GHG Protocol requires certificates from the same market as the consumption.`);
      const vf = String(c.vintage_from).slice(0, 10), vt = String(c.vintage_to).slice(0, 10);
      if (input.periodEnd < vf || input.periodStart > vt) warnings.push(`${c.label}: vintage ${vf.slice(0, 7)} – ${vt.slice(0, 7)} does not cover this period. Check it meets your reporting rules.`);
      claims.push({ id: c.id, label: c.label, kwh: kwhClaim, co2ePerKwh: Number(c.co2e_per_kwh) });
    }
  }

  const gridItem = energy === 'cooling' ? (await query<{ id: number }>(`SELECT id FROM item WHERE code = 'grid:electricity'`))[0] : null;
  if (energy === 'cooling' && !e.cooling && !supplier) throw new AppError("District cooling needs the supplier's factor, or the plant's efficiency (kWh per TRh, or COP)");
  const result = calcEnergy({
    energy, itemName: item.name, quantity: input.quantity!, unit: input.unit, date: fdate, regions,
    factors: energy === 'cooling' ? [] : await loadFactors(item.id),
    cooling: energy === 'cooling' ? { method: e.cooling?.method ?? 'supplier', kwhPerTrh: e.cooling?.kwhPerTrh, cop: e.cooling?.cop, gridFactors: gridItem ? await loadFactors(gridItem.id) : [] } : undefined,
    supplier, certificates: claims, gwp, units,
  });
  result.warnings.unshift(...warnings);
  const stored: Stored = { quantity: input.quantity!, unit: input.unit, inputs: { energy: { ...e, regions }, claims: claims.map((c) => ({ certificateId: c.id, kwh: c.kwh })) } };
  return { result, stored };
}

// -------------------------------------------------------------------- waste --
const PROCESS_ITEM: Record<WasteInput['process'], string> = {
  landfill: 'waste:landfill', incineration: 'waste:incineration', composting: 'waste:composting', ad: 'waste:ad', wastewater: 'waste:wastewater',
};
const kgCh4 = (r: z.infer<typeof recoverySchema>): Recovery => ({ device: r.device, ch4Kg: r.ch4Kg ?? ch4FromGas(r.gasM3!, r.ch4Pct!), ...(r.de !== undefined ? { de: r.de } : {}) });
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

async function wasteCalc(input: CalcInput, item: ItemRow, ctx: CalcContext, gwp: Parameters<typeof calcLandfill>[0]['gwp']): Promise<{ result: CalcResult; stored: Stored }> {
  const w = input.waste;
  if (!w) throw new AppError('Enter the waste treatment details');
  if (PROCESS_ITEM[w.process] !== item.code) throw new AppError(`${item.name} does not match the process entered (${w.process})`);
  const steps: string[] = [];
  const gasNote = (rs: z.infer<typeof recoverySchema>[]) => {
    for (const r of rs) if (r.ch4Kg === undefined) steps.push(`${DEVICES[r.device].name}: ${r.gasM3} m³ × ${r.ch4Pct}% methane × 0.7168 kg/m³ (0 °C, 1 atm) = ${Number(ch4FromGas(r.gasM3!, r.ch4Pct!).toPrecision(6))} kg CH4`);
  };
  let result: CalcResult;
  let stored: Stored;
  if (w.process === 'landfill') {
    const site = ctx.lookupWasteSite ? await ctx.lookupWasteSite(w.siteId) : null;
    if (!site) throw new AppError('Landfill not found in the site register');
    if (ctx.facilityId && site.facility_id !== ctx.facilityId) throw new AppError(`${site.name} belongs to another facility`);
    const year = Number(input.periodStart.slice(0, 4));
    if (input.periodEnd.slice(0, 4) !== String(year)) throw new AppError('A landfill entry covers one calendar year or part of it');
    const p = site.params;
    const mcf = p.mcf ?? (p.siteType ? LANDFILL_MCF[p.siteType]?.mcf : undefined);
    if (mcf === undefined) throw new AppError(`Set the site type (MCF) of ${site.name} in the site register`);
    gasNote(w.recovery);
    const r = calcLandfill({
      siteName: site.name, year, periodFraction: Math.min(1, days(input.periodStart, input.periodEnd) / days(`${year}-01-01`, `${year}-12-31`)),
      method: w.method, climate: p.climate ?? 'tropical_dry', mcf, ox: p.ox ?? 0, f: p.f, delayMonths: p.delayMonths,
      deposits: site.deposits, composition: p.composition, overrides: p.overrides, collectionEfficiency: w.collectionEfficiency,
      recovery: w.recovery.map(kgCh4), gwp,
    });
    if (!p.climate) r.warnings.push(`Climate of ${site.name} not set: tropical dry (UAE) assumed.`);
    result = r;
    stored = { quantity: r.generatedT, unit: 't', inputs: { waste: w, siteId: site.id } };
  } else if (w.process === 'incineration') {
    result = calcIncineration({ plantName: item.name, streams: w.streams, composition: w.composition, overrides: w.overrides, technology: w.technology, of: w.of,
      ch4PerT: w.ch4PerT, n2oPerT: w.n2oPerT, measured: w.measured, exportedMWh: w.exportedMWh, gwp });
    stored = { quantity: w.streams.reduce((a, x) => a + x.tonnes, 0), unit: 't', inputs: { waste: w } };
  } else if (w.process === 'composting' || w.process === 'ad') {
    if (w.measured && w.process !== 'ad') throw new AppError('Measured biogas applies to anaerobic digestion only');
    const m = w.measured;
    if (m) {
      gasNote(m.recovery);
      if (m.ch4ProducedKg === undefined) steps.push(`Biogas produced: ${m.gasM3} m³ × ${m.ch4Pct}% methane × 0.7168 kg/m³ = ${Number(ch4FromGas(m.gasM3!, m.ch4Pct!).toPrecision(6))} kg CH4`);
    }
    result = calcBiological({ process: w.process, tonnes: w.tonnes, basis: w.basis, ch4PerT: w.ch4PerT, n2oPerT: w.n2oPerT, gwp,
      measured: m ? { ch4ProducedKg: m.ch4ProducedKg ?? ch4FromGas(m.gasM3!, m.ch4Pct!), leakPct: m.leakPct, recovery: m.recovery.map(kgCh4) } : undefined });
    stored = { quantity: w.tonnes, unit: 't', inputs: { waste: w } };
  } else if (w.process === 'wastewater') {
    const organicsKg = w.organicsKg ?? (w.flowM3! * w.mgPerL!) / 1000; // m³ × mg/L = g → kg
    if (w.organicsKg === undefined) steps.push(`Organics treated: ${w.flowM3} m³ × ${w.mgPerL} mg/L ${w.measure} ÷ 1000 = ${Number(organicsKg.toPrecision(6))} kg ${w.measure}`);
    gasNote(w.recovery);
    // Concentrations × flow → kg (m³ × mg/L = g).
    const fromConc = (mg: number | undefined, what: string) => {
      if (mg === undefined) return undefined;
      if (w.flowM3 === undefined) throw new AppError(`${what} in mg/L needs the flow (m³)`);
      const kg = (w.flowM3 * mg) / 1000;
      steps.push(`${what}: ${w.flowM3} m³ × ${mg} mg/L ÷ 1000 = ${Number(kg.toPrecision(6))} kg`);
      return kg;
    };
    const nIn = w.nInfluentKg ?? fromConc(w.nInfluentMgPerL, 'Nitrogen in influent');
    const nOut = w.nEffluentKg ?? fromConc(w.nEffluentMgPerL, 'Nitrogen in effluent');
    const orgOut = w.effluentOrganicsKg ?? fromConc(w.effluentMgPerL, `${w.measure} left in effluent`);
    result = calcWastewater({ kind: w.kind, system: w.system, mcf: w.mcf, measure: w.measure, organicsKg, sludgeKg: w.sludgeKg, bo: w.bo, recovery: w.recovery.map(kgCh4),
      nInfluentKg: nIn, efPlant: w.efPlant, nEffluentKg: nOut, efEffluent: w.efEffluent, effluentOrganicsKg: orgOut, mcfDischarge: w.mcfDischarge, gwp });
    stored = { quantity: organicsKg, unit: 'kg', inputs: { waste: w } };
  } else {
    throw new AppError('Unknown waste process');
  }
  result.steps.splice(1, 0, ...steps);
  return { result, stored };
}

const fmtN = (x: number) => Number(x.toPrecision(6)).toLocaleString('en', { maximumFractionDigits: 3 });

// ------------------------------------------------------------------ business travel --
const HAUL_NAME: Record<string, string> = { domestic: 'domestic', short: 'short-haul', long: 'long-haul', intl: 'international (average)' };
/** DESNZ gives every class only for long-haul and international; short-haul has economy and business; domestic the average. */
function classFor(haul: string, cls: string) {
  if (haul === 'domestic') return 'average';
  if (haul === 'short') return cls === 'premium' ? 'economy' : cls === 'first' ? 'business' : cls;
  return cls;
}

/**
 * Works out a trip's quantity (passenger-km, room-nights, km) and, for a flight, its DESNZ item.
 * Sets input.itemId / quantity / unit; returns the explanation for the steps and what to keep.
 */
type TripInfo = { steps: string[]; warnings: string[]; stored: Record<string, unknown>; region?: string; noFactor?: boolean };
/** The library factor (scope3) of an item for a country, or GLOBAL, valid at the date (or the latest before it). */
async function libFactor(code: string, iso: string | null, date: string) {
  const [f] = await query<{ id: number; item_id: number; code: string; co2e: number; region: string; year: number; source: string }>(
    `SELECT f.id, f.item_id, i.code, f.co2e::float8 AS co2e, f.region, extract(year FROM f.valid_from)::int AS year, s.code AS source
       FROM factor f JOIN item i ON i.id = f.item_id JOIN factor_source s ON s.id = f.source_id
      WHERE i.code = $1 AND i.active AND f.status = 'active' AND f.basis = 'scope3' AND f.co2e IS NOT NULL AND f.valid_from <= $3
        AND f.region IN ($2, 'GLOBAL')
      ORDER BY (f.region = $2) DESC, f.valid_from DESC LIMIT 1`, [code, iso ?? 'GLOBAL', date]);
  return f ?? null;
}

export async function resolveTrip(input: CalcInput): Promise<TripInfo> {
  const t = input.trip!;
  const steps: string[] = [], warnings: string[] = [];
  const trips = t.trips ?? 1, legs = t.ret ? 2 : 1;
  const times = `${t.ret ? ' × 2 (return)' : ''}${trips !== 1 ? ` × ${fmtN(trips)} trips` : ''}`;
  if (t.kind === 'flight') {
    const { airport, greatCircleKm, haulOf, UPLIFT, TYPICAL_KM } = await import('../lib/airports.js');
    let km = t.km, haul = t.haul;
    const stored: Record<string, unknown> = {};
    if (t.from && t.to) {
      const a = airport(t.from), b = airport(t.to);
      if (!a) throw new AppError(`Airport "${t.from.toUpperCase()}" not found: use its 3-letter code (e.g. DXB)`);
      if (!b) throw new AppError(`Airport "${t.to.toUpperCase()}" not found: use its 3-letter code (e.g. LHR)`);
      if (a.iata === b.iata) throw new AppError('From and to are the same airport');
      const gc = greatCircleKm(a, b);
      km = gc * UPLIFT;
      haul = haulOf(a, b, gc);
      if (t.leg && t.route) steps.push(`Connecting flight ${t.route.split('-').join(' → ')}: leg ${t.leg.replace('/', ' of ')}, each leg with its own distance and type`);
      steps.push(`${a.iata} ${a.city || a.name} → ${b.iata} ${b.city || b.name}: great-circle ${fmtN(gc)} km + 8% (DESNZ) = ${fmtN(km)} km, ${HAUL_NAME[haul]}`);
      Object.assign(stored, { from: a.iata, to: b.iata, fromCountry: a.country, toCountry: b.country, gcKm: Math.round(gc), km: Math.round(km), haul });
    } else {
      if (!haul) throw new AppError('Enter the airports, or choose the flight type');
      const hn = HAUL_NAME[haul] ?? haul, Hn = `${hn.charAt(0).toUpperCase()}${hn.slice(1)}`;
      if (!km) { km = TYPICAL_KM[haul]!; steps.push(`${Hn} flight: typical distance ${fmtN(km)} km one way (enter the airports for the actual distance)`); }
      else steps.push(`${Hn} flight, ${fmtN(km)} km one way`);
      Object.assign(stored, { km: Math.round(km), haul });
    }
    const rf = t.rf ?? true;
    const cls = classFor(haul!, t.cls ?? 'economy');
    if (cls !== (t.cls ?? 'economy')) steps.push(`DESNZ has no ${t.cls} factor for ${HAUL_NAME[haul!]} flights: ${cls === 'average' ? 'average passenger' : cls} used`);
    const code = `bt:air:${haul}:${cls}:${rf ? 'rf' : 'norf'}`;
    const [row] = await query<{ id: number }>('SELECT id FROM item WHERE code = $1', [code]);
    if (!row) throw new AppError('Flight factors are not loaded in this database yet: restart the app (it loads the DESNZ files), or run npm run db:seed');
    input.itemId = row.id; input.unit = 'pkm';
    input.quantity = km! * legs * trips;
    steps.push(`${fmtN(km!)} km${times} = ${fmtN(input.quantity)} passenger-km${rf ? ' · with radiative forcing (DESNZ)' : ' · without radiative forcing'}`);
    return { steps, warnings, stored: { ...stored, cls, rf } };
  }
  if (t.kind === 'hotel' || t.kind === 'meeting') {
    if (!input.itemId) throw new AppError('Choose the country of the hotel');
    const [h] = await query<{ iso: string | null; country: string | null }>(`SELECT attrs->>'iso' AS iso, attrs->>'country' AS country FROM item WHERE id = $1`, [input.itemId]);
    const iso = h?.iso ?? null, where = h?.country ?? 'the country';
    const info: TripInfo = { steps, warnings, stored: { countryItem: input.itemId, ...(t.stars ? { stars: t.stars } : {}) } };
    if (t.kind === 'hotel') {
      const rooms = t.rooms ?? 1, nights = t.nights ?? 0;
      if (!nights) throw new AppError('Enter the nights');
      input.unit = 'room_night'; input.quantity = rooms * nights * trips;
      steps.push(`${fmtN(rooms)} room${rooms === 1 ? '' : 's'} × ${fmtN(nights)} night${nights === 1 ? '' : 's'}${trips !== 1 ? ` × ${fmtN(trips)} stays` : ''} = ${fmtN(input.quantity)} room-nights`);
      if (t.stars) {
        const f = await libFactor(`bt:hotel:class:${t.stars}`, iso, input.periodStart);
        if (f) { input.itemId = f.item_id; info.region = f.region; steps.push(`${t.stars}-star hotel factor from the factor library (${f.source}, ${f.region === 'GLOBAL' ? 'all countries' : where}) used instead of the country average`); }
        else warnings.push(`No ${t.stars}-star hotel factor in the factor library yet: the DESNZ average for ${where} is used.`);
      }
      return info;
    }
    // meeting / event space: m² × hours × times, the hotel type's factor or the one for any hotel
    if (!t.meetingSqm || !t.meetingHours) throw new AppError('Enter the meeting space (m²) and the hours');
    input.unit = 'sqm_hour'; input.quantity = t.meetingSqm * t.meetingHours * trips;
    steps.push(`${fmtN(t.meetingSqm)} m² × ${fmtN(t.meetingHours)} h${trips !== 1 ? ` × ${fmtN(trips)} events` : ''} = ${fmtN(input.quantity)} m²-hours of meeting space`);
    const f = (t.stars ? await libFactor(`bt:meeting:space:${t.stars}`, iso, input.periodStart) : null) ?? await libFactor('bt:meeting:space', iso, input.periodStart);
    Object.assign(info.stored, { meetingSqm: t.meetingSqm, meetingHours: t.meetingHours });
    if (f) {
      input.itemId = f.item_id; info.region = f.region;
      steps.push(`Meeting-space factor from the factor library (${f.source}, ${f.code.endsWith(':space') ? (t.stars ? `any hotel type — none for ${t.stars}-star yet` : 'any hotel type') : `${t.stars}-star`}, ${f.region === 'GLOBAL' ? 'all countries' : where})`);
    } else {
      const [g] = await query<{ id: number }>(`SELECT id FROM item WHERE code = 'bt:meeting:space'`);
      if (!g) throw new AppError('Meeting space is not in the catalogue: restart the app to update the database');
      input.itemId = g.id; info.noFactor = true;
      warnings.push('Meeting space not counted yet: no meeting-space factor in the factor library. The entry keeps the m² and hours, so it can be recalculated once the factor is added.');
    }
    return info;
  }
  // ground: one-way km × legs × trips
  if (t.km !== undefined) {
    input.quantity = t.km * legs * trips;
    steps.push(`${fmtN(t.km)} km${times} = ${fmtN(input.quantity)} ${input.unit === 'km' ? 'km' : 'passenger-km'}`);
  }
  return { steps, warnings, stored: {} };
}
