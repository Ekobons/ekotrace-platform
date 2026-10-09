/**
 * Connects the database to the pure calculation engine (@ekotrace/calc):
 * loads the item, its factors and the reference data, runs the right
 * calculation for the item's category, and returns the result with its steps.
 */
import { z } from 'zod';
import { calcCombustion, calcEnergy, calcFugitive, calcVehicle, chooseFactors, convert, impliedCalorificValue, type CalcResult, type CertificateClaim, type Factor, type SupplierFactor } from '@ekotrace/calc';
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
    currency: z.string().regex(/^[A-Z]{3}$/, 'Currency as a 3-letter code, e.g. AED'),
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

export const calcInputSchema = z.object({
  itemId: z.number().int().positive(),
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
});
export type CalcInput = z.infer<typeof calcInputSchema>;

interface ItemRow {
  id: number; name: string; active: boolean; category_id: number; category: string; calc_method: 'combustion' | 'fugitive' | 'vehicle' | 'electricity';
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
}

/** What is stored as the entry's quantity: for spend, the fuel / kWh bought. */
export interface Stored { quantity: number; unit: string; inputs: Record<string, unknown> }

export async function calculate(input: CalcInput, ctx: CalcContext): Promise<{ result: CalcResult; item: ItemRow; gwpSet: string; stored: Stored }> {
  if (input.periodEnd < input.periodStart) throw new AppError('The period ends before it starts');
  const ref = await refdata();
  const item = await loadItem(input.itemId);
  if (!item.active || !item.sub_active) throw new AppError(`${item.name} is switched off in the catalogue`);
  if (item.calc_method !== 'vehicle' && item.sub_units.length && !item.sub_units.includes(input.unit)) {
    throw new AppError(`${input.unit} is not offered for this fuel class. Use one of: ${item.sub_units.join(', ')}`);
  }
  const gwpSet = input.gwpSet ?? ctx.gwpSet;
  const gwp = ref.gwp.get(gwpSet);
  if (!gwp) throw new AppError(`Unknown GWP set ${gwpSet}`);
  const region = input.region ?? ctx.region;
  const date = input.periodStart;

  let result: CalcResult;
  let stored: Stored = { quantity: input.quantity ?? 0, unit: input.unit, inputs: input.cv ? { cv: input.cv } : {} };
  if (item.calc_method === 'electricity') {
    if (input.quantity === undefined) throw new AppError('Enter the quantity of energy');
    const e = await energyCalc(input, item, ctx, ref.units, gwp, date);
    result = e.result; stored = e.stored;
  } else if (item.calc_method === 'vehicle') {
    if (input.quantity === undefined && !input.vehicle?.spend) throw new AppError('Enter the distance, fuel, electricity or spend');
    const v = await vehicleCalc(input, item, ctx, ref.units, gwp, region, date);
    result = v.result; stored = v.stored;
  } else if (item.calc_method === 'combustion') {
    if (input.quantity === undefined) throw new AppError('Enter the quantity of fuel');
    result = calcCombustion({ itemName: item.name, quantity: input.quantity, unit: input.unit, date, region, factors: await loadFactors(item.id), gwp, units: ref.units, cv: input.cv });
  } else {
    if (input.cv) throw new AppError('A calorific value applies to fuels only');
    if (!input.fugitive) throw new AppError('Choose a method and enter the gas quantities');
    const composition = item.gas_code
      ? [{ gas: item.gas_code, fraction: 1 }]
      : (await query<{ gas: string; fraction: number }>('SELECT gas, fraction FROM item_gas WHERE item_id = $1 ORDER BY fraction DESC', [item.id]));
    let blendFactors: Factor[] = [];
    if (!composition.length) {
      const chosen = chooseFactors(await loadFactors(item.id), { date, region, unit: 'kg', units: ref.units });
      blendFactors = [...chosen.values()].map((c) => c.factor);
    }
    result = calcFugitive({ itemName: item.name, unit: input.unit, data: input.fugitive, composition, blendFactors, gwp, units: ref.units, kyoto: (g) => ref.kyoto.has(g) });
  }
  if (input.periodStart.slice(0, 4) !== input.periodEnd.slice(0, 4)) {
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
  gwp: Parameters<typeof calcVehicle>[0]['gwp'], region: string, date: string): Promise<{ result: CalcResult; stored: Stored }> {
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
    vehicleName: item.name, electric, phev, method: v.method, quantity: qty, unit, date, region,
    vehicleFactors: a.distance === false ? [] : await loadFactors(item.id),
    fuel: fuel ? { name: fuel.name, factors: fuel.factors, cv: input.cv } : undefined,
    evEnergy: (electric || phev) && v.method === 'distance' ? await evEnergy(item.id, date, unit) : null,
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
  gwp: Parameters<typeof calcEnergy>[0]['gwp'], date: string): Promise<{ result: CalcResult; stored: Stored }> {
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
    energy, itemName: item.name, quantity: input.quantity!, unit: input.unit, date, regions,
    factors: energy === 'cooling' ? [] : await loadFactors(item.id),
    cooling: energy === 'cooling' ? { method: e.cooling?.method ?? 'supplier', kwhPerTrh: e.cooling?.kwhPerTrh, cop: e.cooling?.cop, gridFactors: gridItem ? await loadFactors(gridItem.id) : [] } : undefined,
    supplier, certificates: claims, gwp, units,
  });
  result.warnings.unshift(...warnings);
  const stored: Stored = { quantity: input.quantity!, unit: input.unit, inputs: { energy: { ...e, regions }, claims: claims.map((c) => ({ certificateId: c.id, kwh: c.kwh })) } };
  return { result, stored };
}
