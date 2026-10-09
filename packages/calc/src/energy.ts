/**
 * Purchased energy (Scope 2): electricity, heat & steam, cooling.
 *
 * Two views of the same energy, both reported (GHG Protocol Scope 2 Guidance):
 *
 *   location-based  energy × grid factor of the grid region (state / emirate / grid
 *                   sub-region if it has a factor, else the country average)
 *   market-based    in this order:
 *                     1. certificates and contracts claimed (I-REC, REC, GO, PPA, green tariff)
 *                        × their factor (0 for solar, wind, hydro…)
 *                     2. the rest × the supplier's factor
 *                     3. else × the region's residual mix
 *                     4. else × the grid average (allowed when no residual mix exists; disclosed)
 *
 * Scope 3 cat. 3 from the same entry: transmission & distribution losses and the
 * upstream (well-to-tank) emissions of generation, where the region has factors.
 *
 * Heat & steam: the region's factor if there is one (UK: DESNZ district heat), else the supplier's.
 * Cooling: the supplier's factor, or the plant's electricity (cooling ÷ COP, or TRh × kWh/TRh)
 * calculated as electricity of the grid region.
 */
import { chooseFactors } from './factors.js';
import { convert, getUnit, type UnitRegistry } from './units.js';
import { tryGwp } from './gwp.js';
import { CalcError, emptyTotals, type Basis, type CalcResult, type Factor, type FactorUsed, type GwpTable } from './types.js';

export type EnergyKind = 'electricity' | 'heat' | 'cooling';
const BASE: Record<EnergyKind, string> = { electricity: 'kWh_e', heat: 'kWh_th', cooling: 'kWh_c' };

export interface CertificateClaim { id: string; label: string; kwh: number; co2ePerKwh: number }
export interface SupplierFactor { name: string; co2ePerUnit: number; unit: string; source: string }

export interface EnergyInput {
  energy: EnergyKind;
  itemName: string;
  quantity: number;
  unit: string;
  date: string;
  /** grid regions to try in order, e.g. ['AE-DU', 'AE'] */
  regions: string[];
  /** factors of the energy item (electricity or heat), all regions: scope2, scope2_market (residual mix), td_loss, wtt */
  factors: Factor[];
  /** cooling by plant efficiency: grid electricity factors and the plant's electricity use */
  cooling?: { method: 'supplier' | 'efficiency'; kwhPerTrh?: number; cop?: number; gridFactors: Factor[] };
  supplier?: SupplierFactor | null;
  /** certificates / contracts claimed for this entry, in kWh (electricity only) */
  certificates?: CertificateClaim[];
  gwp: GwpTable;
  units: UnitRegistry;
}

const fmt = (n: number) => (n === 0 ? '0' : Math.abs(n) >= 1e-4 && Math.abs(n) < 1e12 ? String(Number(n.toPrecision(6))) : n.toExponential(4));

interface Picked { factor: Factor; region: string; fallback: boolean }
/** The factor of a basis for the first region (in order) that has one. */
function pick(factors: Factor[], basis: Basis, regions: string[], date: string, unit: string, units: UnitRegistry): Picked | null {
  for (const region of regions) {
    const pool = factors.filter((f) => f.basis === basis && f.region === region);
    if (!pool.length) continue;
    const c = chooseFactors(pool, { date, region, unit, units }).get(basis);
    if (c) return { factor: c.factor, region, fallback: c.fallback };
  }
  return null;
}

export function calcEnergy(input: EnergyInput): CalcResult {
  const { units, gwp } = input;
  if (!Number.isFinite(input.quantity) || input.quantity < 0) throw new CalcError('Quantity must be zero or a positive number', 'BAD_QUANTITY');
  const base = BASE[input.energy];
  const entered = getUnit(units, input.unit);
  const qty = convert(units, input.quantity, input.unit, base); // in kWh of this energy
  const r: CalcResult = { lines: [], factors: [], totals: emptyTotals(), steps: [], warnings: [] };
  const perEntered = input.quantity > 0 ? qty / input.quantity : convert(units, 1, input.unit, base);
  if (input.unit !== base) r.steps.push(`${fmt(input.quantity)} ${entered.name} = ${fmt(qty)} ${getUnit(units, base).name}`);

  /** Apply one factor to q (in base units) for a basis; gas split when the factor has one. */
  const apply = (basis: Basis, p: Picked, q: number, label: string | undefined, quantityEntered: number) => {
    const f = p.factor;
    const inF = convert(units, q, base, f.unit);
    const usable = basis !== 'wtt' && basis !== 'scope2_market' && f.gases.length > 0 && f.gases.every((g) => tryGwp(gwp, g.gas) !== undefined);
    let per = 0;
    if (usable) {
      for (const g of f.gases) {
        const kg = inF * g.kgPerUnit; const gw = tryGwp(gwp, g.gas)!;
        r.lines.push({ basis, gas: g.gas, kgGas: kg, kgCo2e: kg * gw, factorId: f.id, method: 'gas' });
        per += g.kgPerUnit * gw;
      }
    } else if (f.co2ePerUnit != null) {
      per = f.co2ePerUnit;
      r.lines.push({ basis, gas: 'CO2e', kgGas: null, kgCo2e: inF * per, factorId: f.id, method: 'published' });
    }
    const total = inF * per;
    r.totals[basis] += total;
    const fu = getUnit(units, f.unit);
    r.factors.push({ basis, label, factorId: f.id, source: `${f.source}${p.region !== 'GLOBAL' ? ` · ${p.region}` : ''}`, validFrom: f.validFrom, co2ePerUnit: per, unit: f.unit, unitName: fu.name,
      perEnteredUnit: quantityEntered > 0 ? total / quantityEntered : per * convert(units, 1, input.unit, f.unit), enteredUnit: input.unit, enteredUnitName: entered.name,
      quantity: quantityEntered, method: usable ? 'gas' : 'published' });
    r.steps.push(`${label ?? basisName(basis)}: ${fmt(inF)} ${fu.code} × ${fmt(per)} kg CO2e/${fu.code} (${f.source}${p.region !== 'GLOBAL' ? `, ${p.region}` : ''}) = ${fmt(total)} kg CO2e`);
    if (p.fallback) r.warnings.push(`${label ?? basisName(basis)}: no factor for ${input.date.slice(0, 4)} in ${p.region}; the latest earlier one (${f.validFrom.slice(0, 4)}) was used. Recalculate when the new factor is added.`);
    if (p.region !== input.regions[0] && (basis === 'scope2' || basis === 'td_loss')) {
      r.steps.push(`(${input.regions[0]} has no ${basisName(basis)} factor of its own: the ${p.region} factor is used)`);
    }
    return total;
  };
  /** Market-based component without a factor row: certificate or supplier. */
  const applyFixed = (label: string, kwh: number, per: number, source: string, unitCode: string) => {
    const u = getUnit(units, unitCode);
    const inU = convert(units, kwh, base, unitCode);
    const total = inU * per;
    r.totals.scope2_market += total;
    r.lines.push({ basis: 'scope2_market', gas: 'CO2e', kgGas: null, kgCo2e: total, factorId: null, method: 'published' });
    const qEntered = kwh / perEntered;
    r.factors.push({ basis: 'scope2_market', label, factorId: null, source, validFrom: null, co2ePerUnit: per, unit: unitCode, unitName: u.name,
      perEnteredUnit: qEntered > 0 ? total / qEntered : per, enteredUnit: input.unit, enteredUnitName: entered.name, quantity: qEntered, method: 'published' });
    r.steps.push(`Market-based — ${label}: ${fmt(inU)} ${u.code} × ${fmt(per)} kg CO2e/${u.code} (${source}) = ${fmt(total)} kg CO2e`);
    return total;
  };

  // ---------------------------------------------------------------- cooling --
  if (input.energy === 'cooling') {
    const c = input.cooling;
    if (input.supplier && (!c || c.method === 'supplier')) {
      // The supplier's factor is the only one there is: used for both views.
      const s = input.supplier;
      const inU = convert(units, qty, base, s.unit);
      const total = inU * s.co2ePerUnit;
      for (const basis of ['scope2', 'scope2_market'] as const) {
        r.totals[basis] += total;
        r.lines.push({ basis, gas: 'CO2e', kgGas: null, kgCo2e: total, factorId: null, method: 'published' });
        r.factors.push({ basis, label: `Supplier: ${s.name}`, factorId: null, source: s.source, validFrom: null, co2ePerUnit: s.co2ePerUnit, unit: s.unit, unitName: getUnit(units, s.unit).name,
          perEnteredUnit: total / (input.quantity || 1), enteredUnit: input.unit, enteredUnitName: entered.name, quantity: input.quantity, method: 'published' });
      }
      r.steps.push(`Cooling: ${fmt(inU)} ${s.unit} × ${fmt(s.co2ePerUnit)} kg CO2e/${s.unit} (${s.name}, ${s.source}) = ${fmt(total)} kg CO2e — used for location- and market-based (no grid average exists for cooling)`);
      return r;
    }
    if (!c || c.method !== 'efficiency' || !(c.cop || c.kwhPerTrh)) {
      throw new CalcError('District cooling needs the supplier\'s factor, or the plant\'s efficiency (kWh of electricity per TRh, or COP)', 'NO_FACTOR');
    }
    const trh = convert(units, qty, base, 'TRh');
    const elec = c.kwhPerTrh ? trh * c.kwhPerTrh : qty / c.cop!;
    r.steps.push(c.kwhPerTrh
      ? `Cooling plant electricity: ${fmt(trh)} TRh × ${fmt(c.kwhPerTrh)} kWh/TRh = ${fmt(elec)} kWh`
      : `Cooling plant electricity: ${fmt(qty)} kWh of cooling ÷ COP ${fmt(c.cop!)} = ${fmt(elec)} kWh`);
    const e = calcEnergy({ ...input, energy: 'electricity', itemName: 'Grid electricity (cooling plant)', quantity: elec, unit: 'kWh_e', factors: c.gridFactors, cooling: undefined, supplier: null, certificates: [] });
    // Factors shown per unit of cooling entered.
    for (const f of e.factors) { f.perEnteredUnit = input.quantity > 0 ? (f.perEnteredUnit * f.quantity) / input.quantity : f.perEnteredUnit; f.quantity = input.quantity; f.enteredUnit = input.unit; f.enteredUnitName = entered.name; }
    return { ...e, steps: [...r.steps, ...e.steps], warnings: [...r.warnings, ...e.warnings] };
  }

  // ------------------------------------------------- location-based (grid) --
  const loc = pick(input.factors, 'scope2', input.regions, input.date, base, units);
  const kind = input.energy === 'heat' ? 'heat & steam' : 'grid electricity';
  let locPer: number | null = null;
  if (loc) {
    apply('scope2', loc, qty, undefined, input.quantity);
    locPer = qty > 0 ? r.totals.scope2 / qty : null;
  } else if (input.energy === 'heat' && input.supplier) {
    const s = input.supplier;
    const inU = convert(units, qty, base, s.unit);
    const total = inU * s.co2ePerUnit;
    r.totals.scope2 += total;
    r.lines.push({ basis: 'scope2', gas: 'CO2e', kgGas: null, kgCo2e: total, factorId: null, method: 'published' });
    r.factors.push({ basis: 'scope2', label: `Supplier: ${s.name}`, factorId: null, source: s.source, validFrom: null, co2ePerUnit: s.co2ePerUnit, unit: s.unit, unitName: getUnit(units, s.unit).name,
      perEnteredUnit: total / (input.quantity || 1), enteredUnit: input.unit, enteredUnitName: entered.name, quantity: input.quantity, method: 'published' });
    r.steps.push(`Location-based: no ${kind} factor for ${input.regions.join(' / ')}; the supplier's factor is used (${s.name}): ${fmt(inU)} ${s.unit} × ${fmt(s.co2ePerUnit)} = ${fmt(total)} kg CO2e`);
  } else {
    r.warnings.push(`No ${kind} factor for ${input.regions.join(' / ')}: location-based Scope 2 not calculated. Add the grid factor in the factor library, then recalculate.`);
  }

  // -------------------------------------------------------- market-based --
  const certs = input.energy === 'electricity' ? input.certificates ?? [] : [];
  const claimed = certs.reduce((s, c) => s + c.kwh, 0);
  if (claimed > qty + 1e-6) throw new CalcError(`Certificates claimed (${fmt(claimed)} kWh) exceed the electricity used (${fmt(qty)} kWh)`, 'OVER_CLAIM');
  for (const c of certs) applyFixed(c.label, c.kwh, c.co2ePerKwh, 'certificate / contract', 'kWh_e');
  const rest = Math.max(0, qty - claimed);
  if (rest > 0 || !certs.length) {
    if (input.supplier) {
      applyFixed(`Supplier: ${input.supplier.name}`, rest, input.supplier.co2ePerUnit, input.supplier.source, input.supplier.unit);
    } else {
      const res = pick(input.factors, 'scope2_market', input.regions, input.date, base, units);
      if (res) apply('scope2_market', res, rest, `Residual mix (${res.region})`, rest / perEntered);
      else if (loc && locPer != null) {
        applyFixed(`Grid average (${loc.region}) — no residual mix`, rest, locPer, `${loc.factor.source}`, base);
        r.steps.push('Market-based: no supplier factor or residual mix for this region, so the grid average is used (GHG Protocol Scope 2 Guidance allows this; disclose it).');
      } else if (!loc && input.energy === 'heat') {
        r.warnings.push('Market-based Scope 2 for heat needs the supplier\'s factor.');
      } else {
        r.warnings.push('Market-based Scope 2 not calculated: no supplier factor, residual mix or grid factor for this region.');
      }
    }
  }

  // --------------------------------------------------- Scope 3 cat. 3 parts --
  const td = pick(input.factors, 'td_loss', input.regions, input.date, base, units);
  if (td) apply('td_loss', td, qty, input.energy === 'heat' ? 'Distribution losses (Scope 3.3)' : 'T&D losses (Scope 3.3)', input.quantity);
  else if (loc) r.warnings.push(`No ${input.energy === 'heat' ? 'distribution' : 'T&D'} loss factor for ${input.regions.join(' / ')}: Scope 3.3 losses not included. Add it in the factor library (as a loss %) to include them.`);
  const wtt = pick(input.factors, 'wtt', input.regions, input.date, base, units);
  if (wtt) apply('wtt', wtt, qty, `Upstream of ${input.energy === 'heat' ? 'heat' : 'generation'} (Scope 3.3)`, input.quantity);
  return r;
}

function basisName(b: Basis): string {
  return { direct: 'Scope 1', wtt: 'Upstream (Scope 3.3)', outside_scopes: 'Biogenic CO2', memo: 'Memo', scope2: 'Location-based', scope2_market: 'Market-based', td_loss: 'T&D losses' }[b];
}
