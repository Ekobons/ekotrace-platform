/**
 * Vehicles (mobile combustion) and electric driving.
 *
 *   distance     km / miles × the vehicle's factor (DESNZ, per vehicle class and powertrain)
 *                → Scope 1 (tailpipe) and well-to-tank.
 *                Electric and plug-in hybrid vehicles also use electricity:
 *                distance × kWh per km × grid factor of the country → Scope 2.
 *   fuel         litres / kg / m³ of fuel × the fuel's factor (as stationary combustion).
 *   electricity  kWh charged × grid factor → Scope 2.
 *   spend        money ÷ price = litres (or kWh), then as fuel (or electricity).
 *
 * Charging at the company's own site: that electricity is already on the site's meter
 * (the facility's Scope 2), so it is shown but not added again here.
 */
import { calcCombustion } from './combustion.js';
import { chooseFactors } from './factors.js';
import { convert, getUnit, type UnitRegistry } from './units.js';
import { CalcError, emptyTotals, type CalcResult, type CalorificValue, type Factor, type GwpTable } from './types.js';

export type VehicleMethod = 'distance' | 'fuel' | 'electricity' | 'spend';

export interface VehicleInput {
  vehicleName: string;
  /** battery electric: no tailpipe; plug-in hybrid: tailpipe + electricity */
  electric: boolean;
  phev: boolean;
  method: VehicleMethod;
  /** distance (km, mi), fuel (L, kg…), electricity (kWh_e) — or, for spend, the amount of money */
  quantity: number;
  unit: string;
  date: string;
  region: string;
  /** the vehicle's factors per km / mile (direct, wtt) */
  vehicleFactors: Factor[];
  /** fuel burned (fuel and spend methods) */
  fuel?: { name: string; factors: Factor[]; cv?: CalorificValue };
  /** electricity per km / mile for electric and plug-in hybrid vehicles */
  evEnergy?: { unit: string; kwhPerUnit: number; source: string } | null;
  /** grid electricity factors (basis scope2, per kWh_e) for the facility's country */
  gridFactors: Factor[];
  charging: 'site' | 'elsewhere';
  /** spend method: what the money bought and at what price */
  spend?: { currency: string; price: number; priceUnit: string; priceSource: string; buys: 'fuel' | 'electricity' };
  gwp: GwpTable;
  units: UnitRegistry;
}

const fmt = (n: number) => (n === 0 ? '0' : Math.abs(n) >= 1e-4 && Math.abs(n) < 1e12 ? String(Number(n.toPrecision(6))) : n.toExponential(4));

/** Add one result to another (lines, factors, totals, steps, warnings). */
export function mergeResults(a: CalcResult, b: CalcResult): CalcResult {
  const totals = emptyTotals();
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = (a.totals[k] ?? 0) + (b.totals[k] ?? 0);
  return {
    ...(a.cv ? { cv: a.cv } : b.cv ? { cv: b.cv } : {}),
    lines: [...a.lines, ...b.lines], factors: [...a.factors, ...b.factors], totals,
    steps: [...a.steps, ...b.steps], warnings: [...a.warnings, ...b.warnings],
  };
}

const empty = (): CalcResult => ({ lines: [], factors: [], totals: emptyTotals(), steps: [], warnings: [] });

export function calcVehicle(input: VehicleInput): CalcResult {
  const { units } = input;
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new CalcError('Quantity must be zero or a positive number', 'BAD_QUANTITY');

  // Spend → quantity of fuel or electricity.
  if (input.method === 'spend') {
    const s = input.spend;
    if (!s) throw new CalcError('A price is needed to convert spend into a quantity', 'NO_PRICE');
    if (!(s.price > 0)) throw new CalcError('The price must be a positive number', 'NO_PRICE');
    const qty = input.quantity / s.price;
    const pu = getUnit(units, s.priceUnit);
    const r = calcVehicle({ ...input, method: s.buys, quantity: qty, unit: s.priceUnit, spend: undefined });
    r.steps.unshift(`Spend: ${fmt(input.quantity)} ${s.currency} ÷ ${fmt(s.price)} ${s.currency}/${pu.code} (${s.priceSource}) = ${fmt(qty)} ${pu.name}`);
    // The factor table relates to the money entered: per currency unit.
    for (const f of r.factors) {
      f.perEnteredUnit = f.perEnteredUnit / s.price;
      f.enteredUnit = s.currency; f.enteredUnitName = s.currency; f.quantity = input.quantity;
    }
    return r;
  }

  if (input.method === 'electricity') {
    const kwh = convert(units, input.quantity, input.unit, 'kWh_e');
    return electricityPart(input, kwh, input.quantity, input.unit);
  }

  if (input.method === 'fuel') {
    if (input.electric) throw new CalcError(`${input.vehicleName} is electric: enter the electricity charged (kWh), the distance, or the spend`, 'BAD_METHOD');
    if (!input.fuel) throw new CalcError('Choose the fuel used', 'NO_FUEL');
    const r = calcCombustion({ itemName: input.fuel.name, quantity: input.quantity, unit: input.unit, date: input.date, region: input.region,
      factors: input.fuel.factors, gwp: input.gwp, units, cv: input.fuel.cv });
    r.steps.unshift(`${input.vehicleName}: fuel used — ${input.fuel.name}`);
    if (input.phev) r.warnings.push('Plug-in hybrid: this covers the fuel only. Enter the electricity charged as a separate entry (method: electricity).');
    return r;
  }

  // Distance.
  const dist = getUnit(units, input.unit);
  if (dist.dimension !== 'distance') throw new CalcError(`Distance must be in km or miles, not ${dist.name}`, 'BAD_UNIT');
  if (!input.vehicleFactors.length) throw new CalcError(`${input.vehicleName} has no distance factors: enter the fuel used or the spend`, 'NO_FACTOR');
  let r = calcCombustion({ itemName: input.vehicleName, quantity: input.quantity, unit: input.unit, date: input.date, region: input.region,
    factors: input.vehicleFactors, gwp: input.gwp, units });
  if (input.electric) r.steps.unshift(`${input.vehicleName}: no tailpipe emissions (Scope 1 = 0)`);
  if (input.electric || input.phev) {
    if (!input.evEnergy) {
      r.warnings.push(`No electricity-use figure (kWh per km) for ${input.vehicleName}; enter the kWh charged instead to include its electricity.`);
    } else {
      const d = convert(units, input.quantity, input.unit, input.evEnergy.unit);
      const kwh = d * input.evEnergy.kwhPerUnit;
      const e = electricityPart(input, kwh, input.quantity, input.unit);
      e.steps.unshift(`Electricity used: ${fmt(d)} ${input.evEnergy.unit} × ${fmt(input.evEnergy.kwhPerUnit)} kWh/${input.evEnergy.unit} (${input.evEnergy.source}${input.phev ? ', electric share of a plug-in hybrid' : ''}) = ${fmt(kwh)} kWh`);
      r = mergeResults(r, e);
    }
  }
  return r;
}

/** kWh of grid electricity → Scope 2, unless charged on the company's own site. */
function electricityPart(input: VehicleInput, kwh: number, enteredQty: number, enteredUnit: string): CalcResult {
  const r = empty();
  if (input.charging === 'site') {
    r.steps.push(`${fmt(kwh)} kWh charged at the company's own site: already in that site's electricity (Scope 2), not counted again here`);
    return r;
  }
  const grid = input.gridFactors.filter((f) => f.basis === 'scope2' && (f.region === input.region || f.region === 'GLOBAL'));
  // A factor for the country, valid on the date or earlier (a later year's factor is not used backwards).
  if (!grid.length || !chooseFactors(grid, { date: input.date, region: input.region, unit: 'kWh_e', units: input.units }).has('scope2')) {
    r.warnings.push(`No grid electricity factor for ${input.region}${grid.length ? ` valid in ${input.date.slice(0, 4)}` : ''}: ${fmt(kwh)} kWh not converted. Add the country's grid factor in the factor library, then recalculate.`);
    r.steps.push(`Electricity: ${fmt(kwh)} kWh (no grid factor for ${input.region} yet)`);
    return r;
  }
  const g = calcCombustion({ itemName: 'Grid electricity', quantity: kwh, unit: 'kWh_e', date: input.date, region: input.region,
    factors: grid, gwp: input.gwp, units: input.units });
  // Show the factor per entered unit (km, mile or kWh).
  const perEntered = enteredQty > 0 ? kwh / enteredQty : 0;
  for (const f of g.factors) {
    if (enteredUnit !== 'kWh_e') {
      f.perEnteredUnit = f.co2ePerUnit * perEntered;
      f.enteredUnit = enteredUnit; f.enteredUnitName = getUnit(input.units, enteredUnit).name; f.quantity = enteredQty;
    }
  }
  return g;
}
