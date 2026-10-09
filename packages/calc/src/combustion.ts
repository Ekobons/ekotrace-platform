/**
 * Fuel combustion (stationary combustion; the same maths serves mobile
 * combustion when activity is fuel quantity).
 *
 *   direct (Scope 1)    per gas: quantity × kg gas per unit × GWP(chosen set)
 *                       if the source gives no gas split, its published CO2e is used
 *   wtt (Scope 3 cat 3) quantity × published well-to-tank CO2e per unit
 *   outside_scopes      biogenic CO2 of bioenergy: quantity × kg CO2 per unit
 *
 * Every step is written out in plain language and stored with the entry,
 * so an auditor can follow the number back to the factor and its source.
 */
import { CalcError, emptyTotals, type Basis, type CalcResult, type CalorificValue, type CalorificValueUsed, type Factor, type FactorUsed, type GwpTable, type ResultLine } from './types.js';
import { chooseFactors } from './factors.js';
import { type UnitRegistry, convert, getUnit } from './units.js';
import { tryGwp } from './gwp.js';

export interface CombustionInput {
  itemName: string;
  quantity: number;
  unit: string;
  /** any date inside the activity period, ISO yyyy-mm-dd (usually the period start) */
  date: string;
  region: string;
  /** all stored factors for the item (any period / region / unit) */
  factors: Factor[];
  gwp: GwpTable;
  units: UnitRegistry;
  /** optional calorific value supplied by the user */
  cv?: CalorificValue;
}

/** Published totals and gas splits may differ by rounding in the source. */
const CHECK_TOLERANCE = 0.005;

export function calcCombustion(input: CombustionInput): CalcResult {
  const { quantity, unit, gwp, units } = input;
  if (!Number.isFinite(quantity) || quantity < 0) throw new CalcError('Quantity must be zero or a positive number', 'BAD_QUANTITY');
  const entered = getUnit(units, unit);
  const lines: ResultLine[] = [];
  const steps: string[] = [];

  // With a calorific value, the quantity is first turned into energy (or, if
  // energy was entered, into mass/volume) and the factors of that unit are used.
  let calcUnit = unit;
  let toCalc = (x: number) => x;
  let cvUsed: CalorificValueUsed | undefined;
  if (input.cv) {
    const { value, energyUnit, perUnit } = input.cv;
    if (!Number.isFinite(value) || value <= 0) throw new CalcError('The calorific value must be a positive number', 'BAD_CV');
    const eu = getUnit(units, energyUnit);
    const pu = getUnit(units, perUnit);
    if (eu.dimension !== 'energy_net' && eu.dimension !== 'energy_gross') throw new CalcError(`${eu.name} is not an energy unit`, 'BAD_CV');
    if (pu.dimension !== 'mass' && pu.dimension !== 'volume') throw new CalcError(`A calorific value is per unit of mass or volume, not ${pu.name}`, 'BAD_CV');
    const basis = eu.dimension === 'energy_net' ? 'net' : 'gross';
    if (entered.dimension === pu.dimension) {
      toCalc = (x) => convert(units, x, unit, perUnit) * value;
      calcUnit = energyUnit;
    } else if (entered.dimension === eu.dimension) {
      toCalc = (x) => convert(units, x, unit, energyUnit) / value;
      calcUnit = perUnit;
    } else {
      throw new CalcError(`The calorific value (${eu.name} per ${pu.name}) does not fit a quantity in ${entered.name}`, 'BAD_CV');
    }
    const cu = getUnit(units, calcUnit);
    const converted = toCalc(quantity);
    cvUsed = { value, energyUnit, perUnit, energyUnitName: eu.name, perUnitName: pu.name, basis, convertedQuantity: converted, convertedUnit: cu.code, convertedUnitName: cu.name };
    steps.push(calcUnit === energyUnit
      ? `Calorific value (${basis}, entered): ${fmt(quantity)} ${entered.code}${unit !== perUnit ? ` = ${fmt(convert(units, quantity, unit, perUnit))} ${pu.code}` : ''} × ${fmt(value)} ${eu.code}/${pu.code} = ${fmt(converted)} ${eu.code}`
      : `Calorific value (${basis}, entered): ${fmt(quantity)} ${entered.code} ÷ ${fmt(value)} ${eu.code}/${pu.code} = ${fmt(converted)} ${pu.code}`);
  }
  const calcQty = toCalc(quantity);
  const calcU = getUnit(units, calcUnit);

  const choices = chooseFactors(input.factors, { date: input.date, region: input.region, unit: calcUnit, units });
  if (!choices.has('direct') && !choices.has('scope2')) {
    const dims = [...new Set(input.factors.map((f) => units.get(f.unit)?.name).filter(Boolean))].join(', ');
    throw new CalcError(
      `No factor for ${input.itemName} in ${calcU.name}. Factors exist in: ${dims || 'none'}.`,
      'NO_FACTOR',
    );
  }

  const warnings: string[] = [];
  const factors: FactorUsed[] = [];
  const totals: Record<Basis, number> = emptyTotals();

  for (const [basis, { factor, fallback }] of choices) {
    const fu = getUnit(units, factor.unit);
    const q = convert(units, calcQty, calcUnit, factor.unit);
    const label = basisLabel(basis);
    if (fallback) warnings.push(`${label}: no ${factor.source} factor covers ${input.date}; used the latest available (${factor.validFrom} – ${factor.validTo}). Recalculate when the new set is loaded.`);
    if (calcUnit !== factor.unit) steps.push(`${label}: ${fmt(calcQty)} ${calcU.name} = ${fmt(q)} ${fu.name}`);

    const perEntered = convert(units, toCalc(1), calcUnit, factor.unit); // factor units in one entered unit
    const used = (co2ePerUnit: number, method: 'gas' | 'published') => {
      const f: FactorUsed = {
        basis, factorId: factor.id, source: factor.source, validFrom: factor.validFrom,
        co2ePerUnit, unit: fu.code, unitName: fu.name, perEnteredUnit: co2ePerUnit * perEntered,
        enteredUnit: entered.code, enteredUnitName: entered.name, quantity, method,
      };
      if (method === 'gas' && factor.co2ePerUnit != null && factor.sourceGwpSet && factor.sourceGwpSet !== gwp.set) {
        f.published = { co2ePerUnit: factor.co2ePerUnit, gwpSet: factor.sourceGwpSet };
      }
      factors.push(f);
      steps.push(`${label} CO2e factor: ${fmt(co2ePerUnit)} kg ${basis === 'outside_scopes' ? 'CO2' : 'CO2e'}/${fu.code}${unit !== factor.unit ? ` = ${fmt(f.perEnteredUnit)} per ${entered.code}` : ''} (${method === 'gas' ? `gas split × GWP ${gwp.set}` : factor.source})`);
    };

    const gasesUsable = factor.gases.length > 0 && factor.gases.every((g) => tryGwp(gwp, g.gas) !== undefined);
    if (basis !== 'wtt' && gasesUsable) {
      used(factor.gases.reduce((s, g) => s + g.kgPerUnit * tryGwp(gwp, g.gas)!, 0), 'gas');
      let sum = 0;
      for (const g of factor.gases) {
        const kgGas = q * g.kgPerUnit;
        const gw = tryGwp(gwp, g.gas)!;
        const co2e = kgGas * gw;
        sum += co2e;
        lines.push({ basis, gas: g.gas, kgGas, kgCo2e: co2e, factorId: factor.id, method: 'gas' });
        steps.push(`${label} ${g.gas}: ${fmt(q)} ${fu.code} × ${fmt(g.kgPerUnit)} kg/${fu.code} = ${fmt(kgGas)} kg × GWP ${gw} (${gwp.set}) = ${fmt(co2e)} kg CO2e`);
      }
      totals[basis] += sum;
      // Cross-check against the source's own total when the GWP set is the same.
      if (factor.co2ePerUnit != null && factor.sourceGwpSet === gwp.set) {
        const published = q * factor.co2ePerUnit;
        if (published > 0 && Math.abs(sum - published) / published > CHECK_TOLERANCE) {
          warnings.push(`${label}: gas split gives ${fmt(sum)} kg CO2e but ${factor.source} total gives ${fmt(published)} — check the factor.`);
        }
      }
    } else if (factor.co2ePerUnit != null) {
      used(factor.co2ePerUnit, 'published');
      const co2e = q * factor.co2ePerUnit;
      totals[basis] += co2e;
      lines.push({ basis, gas: 'CO2e', kgGas: null, kgCo2e: co2e, factorId: factor.id, method: 'published' });
      steps.push(`${label}: ${fmt(q)} ${fu.code} × ${fmt(factor.co2ePerUnit)} kg CO2e/${fu.code} (${factor.source}) = ${fmt(co2e)} kg CO2e`);
      if (basis === 'direct' && factor.sourceGwpSet && factor.sourceGwpSet !== gwp.set) {
        warnings.push(`${label}: ${factor.source} gives no gas split for ${input.itemName}, so its ${factor.sourceGwpSet} total is used although the company reports in ${gwp.set}.`);
      }
    }
  }
  return { ...(cvUsed ? { cv: cvUsed } : {}), lines, factors, totals, steps, warnings };
}

export function basisLabel(b: Basis): string {
  return { direct: 'Direct', wtt: 'Well-to-tank', outside_scopes: 'Biogenic CO2 (outside scopes)', memo: 'Memo (non-Kyoto)', scope2: 'Scope 2 electricity' }[b];
}

/** Up to 6 significant digits, no exponent for normal magnitudes. */
export function fmt(n: number): string {
  if (n === 0) return '0';
  const a = Math.abs(n);
  if (a >= 1e-4 && a < 1e12) return String(Number(n.toPrecision(6)));
  return n.toExponential(4);
}

/**
 * The calorific value implied by a source's own factors: CO2 per unit of
 * mass/volume ÷ CO2 per unit of energy (same year). Used to suggest a default
 * when the user chooses to enter their own value.
 */
export function impliedCalorificValue(
  factors: Factor[],
  opts: { date: string; region: string; energyUnit: string; perUnit: string; units: UnitRegistry },
): { value: number; source: string } | null {
  const { units } = opts;
  const pick = (unit: string) => chooseFactors(factors, { date: opts.date, region: opts.region, unit, units }).get('direct')?.factor;
  let m: Factor | undefined; let e: Factor | undefined;
  try { m = pick(opts.perUnit); e = pick(opts.energyUnit); } catch { return null; }
  if (!m || !e) return null;
  const co2 = (f: Factor) => f.gases.find((g) => g.gas === 'CO2')?.kgPerUnit;
  const [am, ae] = co2(m) != null && co2(e) != null ? [co2(m)!, co2(e)!] : [m.co2ePerUnit, e.co2ePerUnit];
  if (!am || !ae) return null;
  const perMass = am * convert(units, 1, opts.perUnit, m.unit);
  const perEnergy = ae * convert(units, 1, opts.energyUnit, e.unit);
  return { value: perMass / perEnergy, source: m.source };
}
