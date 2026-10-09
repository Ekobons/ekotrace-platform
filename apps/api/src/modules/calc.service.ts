/**
 * Connects the database to the pure calculation engine (@ekotrace/calc):
 * loads the item, its factors and the reference data, runs the right
 * calculation for the item's category, and returns the result with its steps.
 */
import { z } from 'zod';
import { calcCombustion, calcFugitive, chooseFactors, impliedCalorificValue, type CalcResult, type Factor } from '@ekotrace/calc';
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
});
export type CalcInput = z.infer<typeof calcInputSchema>;

interface ItemRow {
  id: number; name: string; active: boolean; category_id: number; category: string; calc_method: 'combustion' | 'fugitive';
  sub_units: string[]; gas_code: string | null; sub_active: boolean;
}

export async function loadItem(itemId: number): Promise<ItemRow> {
  const [row] = await query<ItemRow>(
    `SELECT i.id, i.name, i.active, i.gas_code, s.units AS sub_units, s.active AS sub_active,
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

export async function calculate(input: CalcInput, ctx: { gwpSet: string; region: string }): Promise<{ result: CalcResult; item: ItemRow; gwpSet: string }> {
  if (input.periodEnd < input.periodStart) throw new AppError('The period ends before it starts');
  const ref = await refdata();
  const item = await loadItem(input.itemId);
  if (!item.active || !item.sub_active) throw new AppError(`${item.name} is switched off in the catalogue`);
  if (item.sub_units.length && !item.sub_units.includes(input.unit)) {
    throw new AppError(`${input.unit} is not offered for this fuel class. Use one of: ${item.sub_units.join(', ')}`);
  }
  const gwpSet = input.gwpSet ?? ctx.gwpSet;
  const gwp = ref.gwp.get(gwpSet);
  if (!gwp) throw new AppError(`Unknown GWP set ${gwpSet}`);
  const region = input.region ?? ctx.region;
  const date = input.periodStart;

  let result: CalcResult;
  if (item.calc_method === 'combustion') {
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
  return { result, item, gwpSet };
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
