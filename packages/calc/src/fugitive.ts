/**
 * Fugitive emissions: refrigerants, air-conditioning, fire suppression,
 * SF6 in switchgear, and any other gas released (e.g. methane leaks).
 *
 * Three methods (GHG Protocol, "Calculating HFC and PFC Emissions from the Use
 * of Refrigeration and Air Conditioning Equipment"):
 *
 *  quantity      the mass of gas released is known, usually the top-up / refill
 *                quantity from service records:     E = released
 *  screening     only the equipment charge is known; default loss rates:
 *                E = new charge × install loss
 *                  + operating charge × annual leak rate × years
 *                  + disposed charge × share left at disposal × (1 − recovery)
 *  mass_balance  from gas purchase and stock records:
 *                E = (stock at start − stock at end) + purchased − sold/returned
 *                  − (charge of new equipment − charge of retired equipment)
 *
 * The released mass is split by the gas composition (e.g. R-410A = 50 % HFC-32
 * + 50 % HFC-125), so the inventory can be reported per gas. Gases outside the
 * Kyoto basket (HCFC-22, CFCs, halons) are kept as "memo" lines: reported
 * separately, never added to the scope totals (GHG Protocol).
 */
import { CalcError, type Basis, type CalcResult, type Factor, type GwpTable, type ResultLine } from './types.js';
import { type UnitRegistry, convert, getUnit } from './units.js';
import { tryGwp } from './gwp.js';
import { fmt } from './combustion.js';

export type FugitiveMethod =
  | { method: 'quantity'; released: number }
  | {
      method: 'screening';
      operatingCharge: number;
      annualLeakRatePct: number;
      months?: number; // default 12
      newCharge?: number;
      installLossPct?: number;
      disposedCharge?: number;
      remainingAtDisposalPct?: number;
      recoveryPct?: number;
    }
  | {
      method: 'mass_balance';
      stockStart: number;
      stockEnd: number;
      purchased: number;
      soldOrReturned: number;
      newEquipmentCharge: number;
      retiredEquipmentCharge: number;
    };

export interface FugitiveInput {
  itemName: string;
  /** mass unit for every quantity in `data` (kg, t, lb…) */
  unit: string;
  data: FugitiveMethod;
  /** gas make-up by mass; fractions add up to 1. Empty → use `blendFactors`. */
  composition: { gas: string; fraction: number }[];
  /**
   * For a blend whose composition is not recorded: the published kg CO2e per
   * kg, already chosen for the activity date. A 'direct' factor holds the
   * Kyoto part and a 'memo' factor the non-Kyoto part (HCFCs inside the blend).
   */
  blendFactors?: Factor[];
  gwp: GwpTable;
  units: UnitRegistry;
  kyoto: (gas: string) => boolean;
}

export function releasedMassKg(input: FugitiveInput): { kg: number; steps: string[] } {
  const { data, unit, units } = input;
  if (getUnit(units, unit).dimension !== 'mass') throw new CalcError('Fugitive quantities must be entered as a mass (kg, t, lb…)', 'BAD_UNIT');
  const kg = (v: number | undefined, name: string) => {
    const x = v ?? 0;
    if (!Number.isFinite(x) || x < 0) throw new CalcError(`${name} must be zero or a positive number`, 'BAD_QUANTITY');
    return convert(units, x, unit, 'kg');
  };
  const pct = (v: number | undefined, name: string) => {
    const x = v ?? 0;
    if (!Number.isFinite(x) || x < 0 || x > 100) throw new CalcError(`${name} must be between 0 and 100 %`, 'BAD_PERCENT');
    return x / 100;
  };
  const steps: string[] = [];

  if (data.method === 'quantity') {
    const e = kg(data.released, 'Quantity released');
    steps.push(`Released (refill / top-up): ${fmt(e)} kg`);
    return { kg: e, steps };
  }
  if (data.method === 'screening') {
    const years = (data.months ?? 12) / 12;
    const install = kg(data.newCharge, 'New equipment charge') * pct(data.installLossPct, 'Installation loss');
    const operating = kg(data.operatingCharge, 'Operating charge') * pct(data.annualLeakRatePct, 'Annual leak rate') * years;
    const disposal = kg(data.disposedCharge, 'Disposed charge') * pct(data.remainingAtDisposalPct ?? 100, 'Share left at disposal') * (1 - pct(data.recoveryPct, 'Recovery'));
    if (install) steps.push(`Installation: ${fmt(install)} kg`);
    steps.push(`Operation: ${fmt(kg(data.operatingCharge, ''))} kg charge × ${data.annualLeakRatePct} % / year × ${fmt(years)} year = ${fmt(operating)} kg`);
    if (disposal) steps.push(`Disposal: ${fmt(disposal)} kg`);
    return { kg: install + operating + disposal, steps };
  }
  // mass balance
  const e =
    kg(data.stockStart, 'Stock at start') - kg(data.stockEnd, 'Stock at end') +
    kg(data.purchased, 'Purchased') - kg(data.soldOrReturned, 'Sold or returned') -
    (kg(data.newEquipmentCharge, 'Charge of new equipment') - kg(data.retiredEquipmentCharge, 'Charge of retired equipment'));
  steps.push(`Mass balance: (stock start − stock end) + purchased − sold − (new charge − retired charge) = ${fmt(e)} kg`);
  if (e < -1e-9) throw new CalcError(`Mass balance gives a negative release (${fmt(e)} kg). Check the stock and purchase figures.`, 'NEGATIVE_BALANCE');
  return { kg: Math.max(0, e), steps };
}

export function calcFugitive(input: FugitiveInput): CalcResult {
  const { kg, steps } = releasedMassKg(input);
  const lines: ResultLine[] = [];
  const warnings: string[] = [];
  const totals: Record<Basis, number> = { direct: 0, wtt: 0, outside_scopes: 0, memo: 0 };

  if (input.composition.length) {
    const sum = input.composition.reduce((s, c) => s + c.fraction, 0);
    if (Math.abs(sum - 1) > 0.001) throw new CalcError(`Composition of ${input.itemName} adds up to ${fmt(sum * 100)} %, not 100 %`, 'BAD_COMPOSITION');
    for (const c of input.composition) {
      const gw = tryGwp(input.gwp, c.gas);
      if (gw === undefined) throw new CalcError(`No ${input.gwp.set} GWP for ${c.gas}`, 'NO_GWP');
      const kgGas = kg * c.fraction;
      const basis: Basis = input.kyoto(c.gas) ? 'direct' : 'memo';
      const co2e = kgGas * gw;
      totals[basis] += co2e;
      lines.push({ basis, gas: c.gas, kgGas, kgCo2e: co2e, factorId: null, method: 'gas' });
      steps.push(`${c.gas}: ${fmt(kg)} kg × ${fmt(c.fraction * 100)} % = ${fmt(kgGas)} kg × GWP ${gw} (${input.gwp.set}) = ${fmt(co2e)} kg CO2e${basis === 'memo' ? ' — non-Kyoto, reported separately' : ''}`);
    }
  } else if (input.blendFactors?.some((f) => f.co2ePerUnit != null)) {
    let gwpNote = '';
    for (const f of input.blendFactors) {
      if (f.co2ePerUnit == null || (f.basis !== 'direct' && f.basis !== 'memo')) continue;
      // CO2e per kg: a value "per tonne" is 1/1000 of it per kg, i.e. convert the amount kg → factor unit.
      const perKg = convert(input.units, f.co2ePerUnit, 'kg', f.unit);
      const co2e = kg * perKg;
      totals[f.basis] += co2e;
      lines.push({ basis: f.basis, gas: 'CO2e', kgGas: null, kgCo2e: co2e, factorId: f.id, method: 'published' });
      steps.push(`${input.itemName}${f.basis === 'memo' ? ' (non-Kyoto part, reported separately)' : ''}: ${fmt(kg)} kg × ${fmt(perKg)} kg CO2e/kg (${f.source}) = ${fmt(co2e)} kg CO2e`);
      if (f.sourceGwpSet && f.sourceGwpSet !== input.gwp.set) gwpNote = ` and the ${f.sourceGwpSet} value is used although the company reports in ${input.gwp.set}`;
    }
    warnings.push(`${input.itemName}: composition not recorded, so the gases cannot be reported separately${gwpNote}. Add the composition in the factor library.`);
  } else {
    throw new CalcError(`${input.itemName} has neither a gas composition nor a factor`, 'NO_FACTOR');
  }
  return { lines, totals, steps, warnings };
}
