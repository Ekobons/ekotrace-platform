/**
 * Waste treated at the company's own sites (Scope 1).
 * Method: IPCC 2006 Guidelines, Volume 5 (Waste), with the 2019 Refinement where it
 * changed a default. Every default below can be replaced per site or per entry; the
 * steps say which value was used and where it comes from.
 *
 *   landfill       methane from decay of waste deposited in earlier years (First Order
 *                  Decay, ch. 3), or from measured gas collection ÷ collection efficiency;
 *                  less gas recovered, less oxidation in the cover; flare / engine slip.
 *   incineration   fossil CO2 = waste × dry matter × carbon × fossil share × oxidation × 44/12
 *                  (ch. 5); biogenic CO2 reported outside scopes; CH4 and N2O per tonne.
 *   biological     composting and anaerobic digestion: CH4 and N2O per tonne (ch. 4),
 *                  or for digesters, measured biogas with leaks and flaring.
 *   wastewater     CH4 = (organics − sludge removed) × Bo × MCF − recovered (ch. 6);
 *                  N2O from nitrogen treated in the plant and in the effluent.
 *
 * Energy exported from waste (electricity, gas) is never subtracted from emissions.
 */
import { gwpOf } from './gwp.js';
import { CalcError, emptyTotals, type Basis, type CalcResult, type FactorUsed, type GwpTable, type ResultLine } from './types.js';

const S06 = 'IPCC 2006 Vol. 5';
const S19 = 'IPCC 2019 Refinement Vol. 5';

const fmt = (n: number) => (n === 0 ? '0' : Math.abs(n) >= 1e-4 && Math.abs(n) < 1e12 ? String(Number(n.toPrecision(6))) : n.toExponential(4));
const pct = (x: number) => `${fmt(x * 100)}%`;

// ------------------------------------------------------------------ defaults --

export type Climate = 'temperate_dry' | 'temperate_wet' | 'tropical_dry' | 'tropical_wet';
export const CLIMATES: Record<Climate, string> = {
  temperate_dry: 'Boreal / temperate, dry (MAP/PET < 1)',
  temperate_wet: 'Boreal / temperate, wet (MAP/PET > 1)',
  tropical_dry: 'Tropical, dry (MAT > 20 °C, MAP < 1000 mm) — e.g. UAE',
  tropical_wet: 'Tropical, moist / wet (MAT > 20 °C, MAP ≥ 1000 mm)',
};
export type DecayClass = 'slow_paper' | 'slow_wood' | 'moderate' | 'rapid' | 'bulk';
/** Methane generation rate k (per year), IPCC 2006 Vol. 5 Table 3.3 (Tier 1 defaults). */
export const K_DEFAULT: Record<DecayClass, Record<Climate, number>> = {
  slow_paper: { temperate_dry: 0.04, temperate_wet: 0.06, tropical_dry: 0.045, tropical_wet: 0.07 },
  slow_wood: { temperate_dry: 0.02, temperate_wet: 0.03, tropical_dry: 0.025, tropical_wet: 0.035 },
  moderate: { temperate_dry: 0.05, temperate_wet: 0.1, tropical_dry: 0.065, tropical_wet: 0.17 },
  rapid: { temperate_dry: 0.06, temperate_wet: 0.185, tropical_dry: 0.085, tropical_wet: 0.4 },
  bulk: { temperate_dry: 0.05, temperate_wet: 0.09, tropical_dry: 0.065, tropical_wet: 0.17 },
};

export interface WasteType {
  code: string;
  name: string;
  group: 'msw' | 'industrial' | 'sludge' | 'other';
  /** dry matter, fraction of wet weight */
  dm: number;
  /** degradable organic carbon, fraction of wet weight (0 = does not decay in a landfill) */
  doc: number;
  /** total carbon, fraction of dry matter (null = no default) */
  cf: number | null;
  /** fossil share of total carbon */
  fcf: number;
  /** fraction of DOC that decomposes (2019 Refinement Table 3.0) */
  docf: number;
  decay: DecayClass;
  /** N2O factor class for incineration (Table 5.6) */
  n2o: 'msw' | 'industrial' | 'sludge' | 'sewage_sludge';
  source: string;
  note?: string;
}

const T24 = `${S06} Table 2.4; DOCf ${S19} Table 3.0`;
const T25 = `${S06} Table 2.5 (per wet weight; dm = 1 − water, CF = total C ÷ dm)`;
/** Industrial waste from Table 2.5: DOC, fossil C, total C and water, all % of wet weight. */
const ind = (code: string, name: string, doc: number, fossil: number, total: number, water: number, docf: number, decay: DecayClass, note?: string): WasteType => {
  const dm = 1 - water / 100;
  return { code, name, group: 'industrial', dm, doc: doc / 100, cf: total / 100 / dm, fcf: total ? fossil / total : 0, docf, decay, n2o: 'industrial', source: T25, ...(note ? { note } : {}) };
};

export const WASTE_TYPES: WasteType[] = [
  { code: 'food', name: 'Food waste', group: 'msw', dm: 0.4, doc: 0.15, cf: 0.38, fcf: 0, docf: 0.7, decay: 'rapid', n2o: 'msw', source: T24 },
  { code: 'garden', name: 'Garden and park waste', group: 'msw', dm: 0.4, doc: 0.2, cf: 0.49, fcf: 0, docf: 0.5, decay: 'moderate', n2o: 'msw', source: T24,
    note: 'DOCf 0.5 for mixed garden waste (2019 Table 3.0 gives 0.7 for grass, 0.1 for branches)' },
  { code: 'paper', name: 'Paper and cardboard', group: 'msw', dm: 0.9, doc: 0.4, cf: 0.46, fcf: 0.01, docf: 0.5, decay: 'slow_paper', n2o: 'msw', source: T24 },
  { code: 'wood', name: 'Wood', group: 'msw', dm: 0.85, doc: 0.43, cf: 0.5, fcf: 0, docf: 0.1, decay: 'slow_wood', n2o: 'msw', source: T24 },
  { code: 'textiles', name: 'Textiles', group: 'msw', dm: 0.8, doc: 0.24, cf: 0.5, fcf: 0.2, docf: 0.5, decay: 'slow_paper', n2o: 'msw', source: T24 },
  { code: 'nappies', name: 'Nappies (diapers)', group: 'msw', dm: 0.4, doc: 0.24, cf: 0.7, fcf: 0.1, docf: 0.5, decay: 'moderate', n2o: 'msw', source: T24 },
  { code: 'rubber_leather', name: 'Rubber and leather', group: 'msw', dm: 0.84, doc: 0, cf: 0.67, fcf: 0.2, docf: 0.5, decay: 'slow_wood', n2o: 'msw', source: T24,
    note: 'Table 2.4 gives DOC 39% in brackets: natural rubber is not expected to decay in a landfill, so DOC 0 is used there' },
  { code: 'plastics', name: 'Plastics', group: 'msw', dm: 1, doc: 0, cf: 0.75, fcf: 1, docf: 0.5, decay: 'bulk', n2o: 'msw', source: T24 },
  { code: 'metal', name: 'Metal', group: 'msw', dm: 1, doc: 0, cf: 0, fcf: 0, docf: 0.5, decay: 'bulk', n2o: 'msw', source: T24 },
  { code: 'glass', name: 'Glass', group: 'msw', dm: 1, doc: 0, cf: 0, fcf: 0, docf: 0.5, decay: 'bulk', n2o: 'msw', source: T24 },
  { code: 'other_inert', name: 'Other, inert', group: 'msw', dm: 0.9, doc: 0, cf: 0.03, fcf: 1, docf: 0.5, decay: 'bulk', n2o: 'msw', source: T24 },
  { code: 'sewage_sludge', name: 'Sewage sludge (domestic)', group: 'sludge', dm: 0.1, doc: 0.05, cf: null, fcf: 0, docf: 0.5, decay: 'rapid', n2o: 'sewage_sludge',
    source: `${S06} section 2.3.2`, note: 'Carbon content has no IPCC default: all carbon in sewage sludge is biogenic' },
  { code: 'industrial_sludge', name: 'Industrial sludge', group: 'sludge', dm: 0.35, doc: 0.09, cf: null, fcf: 0, docf: 0.5, decay: 'rapid', n2o: 'sludge',
    source: `${S06} section 2.3.2`, note: 'Carbon content has no IPCC default: enter it, or the measured stack CO2' },
  ind('ind_food', 'Industrial: food, beverages & tobacco', 15, 0, 15, 60, 0.7, 'rapid'),
  ind('ind_textile', 'Industrial: textile', 24, 16, 40, 20, 0.5, 'slow_paper'),
  ind('ind_wood', 'Industrial: wood & wood products', 43, 0, 43, 15, 0.1, 'slow_wood'),
  ind('ind_paper', 'Industrial: pulp & paper', 40, 1, 41, 10, 0.5, 'slow_paper'),
  ind('ind_petroleum', 'Industrial: petroleum products, solvents, plastics', 0, 80, 80, 0, 0.5, 'bulk'),
  ind('ind_rubber', 'Industrial: rubber', 0, 17, 56, 16, 0.5, 'slow_wood', 'Table 2.5 gives DOC 39% in brackets (not expected to decay in a landfill): DOC 0'),
  ind('ind_cd', 'Construction and demolition', 4, 20, 24, 0, 0.5, 'bulk'),
  ind('ind_other', 'Industrial: other', 1, 3, 4, 10, 0.5, 'bulk'),
  { ...ind('clinical', 'Clinical waste', 15, 25, 40, 35, 0.5, 'bulk'), group: 'other', source: `${S06} Table 2.6 (per wet weight)` },
];
export const wasteType = (code: string): WasteType => {
  const t = WASTE_TYPES.find((w) => w.code === code);
  if (!t) throw new CalcError(`Unknown waste type "${code}"`, 'BAD_WASTE_TYPE');
  return t;
};

/** Mixed municipal waste, split by a composition (fractions of wet weight). */
export const MSW = 'msw';
/** IPCC 2006 Vol. 5 Table 2.3, Western Asia & Middle East (sums to 87.6%: the rest is not specified and is treated as inert). */
export const MSW_COMPOSITION_DEFAULT: Record<string, number> = {
  food: 0.411, paper: 0.18, wood: 0.098, textiles: 0.029, rubber_leather: 0.006, plastics: 0.063, metal: 0.013, glass: 0.022, other_inert: 0.054,
};
export const MSW_COMPOSITION_SOURCE = `${S06} Table 2.3, Western Asia & Middle East`;

/** Landfill site types and methane correction factor, 2019 Refinement Table 3.1 (updated). */
export const LANDFILL_MCF: Record<string, { name: string; mcf: number }> = {
  managed_anaerobic: { name: 'Managed – anaerobic', mcf: 1.0 },
  semi_aerobic_well: { name: 'Managed well – semi-aerobic', mcf: 0.5 },
  semi_aerobic_poor: { name: 'Managed poorly – semi-aerobic', mcf: 0.7 },
  aeration_well: { name: 'Managed well – active aeration', mcf: 0.4 },
  aeration_poor: { name: 'Managed poorly – active aeration', mcf: 0.7 },
  unmanaged_deep: { name: 'Unmanaged – deep (≥ 5 m waste) and/or high water table', mcf: 0.8 },
  unmanaged_shallow: { name: 'Unmanaged – shallow (< 5 m waste)', mcf: 0.4 },
  uncategorised: { name: 'Uncategorised', mcf: 0.6 },
};

/** Gas combustion devices and default methane destruction. */
export type Device = 'flare_open' | 'flare_enclosed' | 'engine' | 'boiler' | 'exported';
export const DEVICES: Record<Device, { name: string; de: number; source: string }> = {
  flare_open: { name: 'Open flare', de: 0.5, source: 'CDM Tool 06 (open flare, flame detected)' },
  flare_enclosed: { name: 'Enclosed flare', de: 0.9, source: 'CDM Tool 06 default (enclosed flare, operating conditions met)' },
  engine: { name: 'Gas engine / turbine (electricity)', de: 0.99, source: "US EPA 40 CFR 98 subpart HH: manufacturer's value, at most 99%" },
  boiler: { name: 'Boiler / heater', de: 0.99, source: "US EPA 40 CFR 98 subpart HH: manufacturer's value, at most 99%" },
  exported: { name: 'Sent to another company (pipeline, their engine)', de: 1, source: 'burned outside this site: its combustion is not part of this entry' },
};

/** kg CH4 per normal m³ (0 °C, 101.325 kPa). */
export const CH4_DENSITY = 0.7168;

/** Incineration technology: CH4 kg per tonne of waste (wet), Table 5.3 (kg/Gg ÷ 1000). */
export const INCINERATORS: Record<string, { name: string; ch4: number; batch: boolean }> = {
  continuous_stoker: { name: 'Continuous – stoker (grate)', ch4: 0.0002, batch: false },
  continuous_fluidised: { name: 'Continuous – fluidised bed', ch4: 0, batch: false },
  semi_stoker: { name: 'Semi-continuous – stoker', ch4: 0.006, batch: false },
  semi_fluidised: { name: 'Semi-continuous – fluidised bed', ch4: 0.188, batch: false },
  batch_stoker: { name: 'Batch – stoker', ch4: 0.06, batch: true },
  batch_fluidised: { name: 'Batch – fluidised bed', ch4: 0.237, batch: true },
};
/** N2O kg per tonne of waste (wet), Table 5.6. */
export function incineratorN2o(cls: WasteType['n2o'], batch: boolean): number {
  return { msw: batch ? 0.06 : 0.05, industrial: 0.1, sludge: 0.45, sewage_sludge: 0.9 }[cls];
}

/** Biological treatment, kg per tonne treated, Table 4.1. */
export const BIO_DEFAULTS = {
  composting: { wet: { ch4: 4, n2o: 0.24 }, dry: { ch4: 10, n2o: 0.6 } },
  ad: { wet: { ch4: 0.8, n2o: 0 }, dry: { ch4: 2, n2o: 0 } },
} as const;
/** Unintended CH4 leaks from a digester, share of CH4 produced (Vol. 5 section 4.1). */
export const AD_LEAK_DEFAULT = 0.05;

/** Wastewater treatment and discharge: methane correction factor, 2019 Refinement Tables 6.3 (domestic) and 6.8 (industrial). */
export const WW_SYSTEMS: Record<string, { name: string; domestic: number; industrial: number }> = {
  centralised_aerobic: { name: 'Centralised aerobic treatment plant', domestic: 0.03, industrial: 0 },
  anaerobic_reactor: { name: 'Anaerobic reactor (e.g. UASB)', domestic: 0.8, industrial: 0.8 },
  shallow_lagoon: { name: 'Anaerobic shallow lagoon / facultative lagoon (< 2 m)', domestic: 0.2, industrial: 0.2 },
  deep_lagoon: { name: 'Anaerobic deep lagoon (> 2 m)', domestic: 0.8, industrial: 0.8 },
  septic: { name: 'Septic tank', domestic: 0.5, industrial: 0.5 },
  stagnant_sewer: { name: 'Stagnant sewer (open, warm)', domestic: 0.5, industrial: 0.5 },
  latrine_dry_family: { name: 'Latrine – dry climate, small family', domestic: 0.1, industrial: 0.1 },
  latrine_dry_communal: { name: 'Latrine – dry climate, communal', domestic: 0.5, industrial: 0.5 },
  latrine_wet: { name: 'Latrine – wet climate / flush water', domestic: 0.7, industrial: 0.7 },
};
/** Bo: maximum CH4 per kg of BOD or COD, Table 6.2. */
export const BO = { BOD: 0.6, COD: 0.25 } as const;
/** Discharge of effluent to aquatic environments (Tier 1), Table 6.3. */
export const MCF_DISCHARGE = 0.11;
/** N2O: kg N2O-N per kg N in the plant (Table 6.8A) and in effluent discharged. */
export const N2O_PLANT = 0.016;
export const N2O_EFFLUENT = 0.005;

// ------------------------------------------------------------------- helpers --

type Override = Partial<Pick<WasteType, 'dm' | 'doc' | 'cf' | 'fcf' | 'docf'>> & { k?: number };
export interface Recovery { device: Device; ch4Kg: number; de?: number }

class Out {
  lines: ResultLine[] = [];
  totals = emptyTotals();
  steps: string[] = [];
  warnings: string[] = [];
  factors: FactorUsed[] = [];
  constructor(private gwp: GwpTable) {}
  gas(basis: Basis, gas: 'CO2' | 'CH4' | 'N2O', kg: number, step?: string) {
    if (!(kg > 0)) return 0;
    const gw = basis === 'outside_scopes' || gas === 'CO2' ? 1 : gwpOf(this.gwp, gas);
    const co2e = kg * gw;
    this.lines.push({ basis, gas, kgGas: kg, kgCo2e: co2e, factorId: null, method: 'gas' });
    this.totals[basis] += co2e;
    if (step) this.steps.push(`${step}${gw !== 1 ? ` × GWP ${gw} (${this.gwp.set}) = ${fmt(co2e)} kg CO2e` : ''}`);
    return co2e;
  }
  /** One CO2e factor per basis for the cross-check table: total ÷ quantity. */
  summary(source: string, quantity: number, unit: string, unitName: string, label?: string) {
    for (const basis of ['direct', 'outside_scopes'] as Basis[]) {
      const total = this.totals[basis];
      if (!total || !quantity) continue;
      const per = total / quantity;
      this.factors.push({ basis, ...(label ? { label } : {}), factorId: null, source, validFrom: null, co2ePerUnit: per, unit, unitName,
        perEnteredUnit: per, enteredUnit: unit, enteredUnitName: unitName, quantity, method: 'gas' });
    }
  }
  result(): CalcResult {
    return { lines: this.lines, factors: this.factors, totals: this.totals, steps: this.steps, warnings: this.warnings };
  }
}

const check = (x: number, what: string, max?: number) => {
  if (!Number.isFinite(x) || x < 0 || (max !== undefined && x > max)) throw new CalcError(`${what} must be ${max !== undefined ? `between 0 and ${max}` : 'zero or a positive number'}`, 'BAD_INPUT');
};

/** Split tonnes by waste type; 'msw' is split by the composition. */
function splitStreams(streams: { type: string; tonnes: number }[], composition: Record<string, number> | undefined, steps: string[]) {
  const out = new Map<string, number>();
  const comp = composition ?? MSW_COMPOSITION_DEFAULT;
  const sum = Object.values(comp).reduce((s, x) => s + x, 0);
  if (sum > 1.0001) throw new CalcError(`The composition adds up to ${pct(sum)}: it must not exceed 100%`, 'BAD_COMPOSITION');
  for (const s of streams) {
    check(s.tonnes, 'Tonnes');
    if (s.type === MSW) {
      for (const [code, f] of Object.entries(comp)) { wasteType(code); out.set(code, (out.get(code) ?? 0) + s.tonnes * f); }
    } else {
      wasteType(s.type);
      out.set(s.type, (out.get(s.type) ?? 0) + s.tonnes);
    }
  }
  if (streams.some((s) => s.type === MSW)) {
    steps.push(`Mixed municipal waste split by composition (${composition ? 'entered' : MSW_COMPOSITION_SOURCE}): ${Object.entries(comp).map(([c, f]) => `${wasteType(c).name.toLowerCase()} ${pct(f)}`).join(', ')}${sum < 0.9999 ? `; the remaining ${pct(1 - sum)} is not specified and treated as inert` : ''}`);
  }
  return out;
}

function params(code: string, over: Record<string, Override> | undefined) {
  const t = wasteType(code);
  const o = over?.[code] ?? {};
  return { ...t, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)), changed: Object.keys(o).filter((k) => (o as Record<string, unknown>)[k] != null) } as WasteType & { k?: number; changed: string[] };
}

/** Recovered methane burned in flares / engines: what is destroyed, what slips, biogenic CO2. */
function burn(out: Out, recovery: Recovery[]) {
  let recovered = 0;
  for (const r of recovery) {
    check(r.ch4Kg, 'Methane recovered');
    const d = DEVICES[r.device];
    if (!d) throw new CalcError(`Unknown device "${r.device}"`, 'BAD_INPUT');
    const de = r.device === 'exported' ? 1 : r.de ?? d.de;
    check(de, 'Destruction efficiency', 1);
    recovered += r.ch4Kg;
    if (r.device === 'exported') { out.steps.push(`${d.name}: ${fmt(r.ch4Kg)} kg CH4 — burned outside this site, not counted here`); continue; }
    out.steps.push(`${d.name}: ${fmt(r.ch4Kg)} kg CH4 recovered, destruction ${pct(de)} (${r.de !== undefined ? 'entered' : d.source})`);
    out.gas('direct', 'CH4', r.ch4Kg * (1 - de), `  ${d.name} slip: ${fmt(r.ch4Kg)} × (1 − ${fmt(de)}) = ${fmt(r.ch4Kg * (1 - de))} kg CH4`);
    out.gas('outside_scopes', 'CO2', r.ch4Kg * de * 44 / 16, `  Biogenic CO2 from burning it: ${fmt(r.ch4Kg * de)} kg CH4 × 44/16 = ${fmt(r.ch4Kg * de * 44 / 16)} kg CO2 (outside scopes)`);
  }
  return recovered;
}

/** m³ of gas at a methane share → kg CH4 (normal m³). */
export const ch4FromGas = (m3: number, ch4Pct: number) => m3 * (ch4Pct / 100) * CH4_DENSITY;

// ------------------------------------------------------------------ landfill --

export interface LandfillInput {
  siteName: string;
  /** reporting year */
  year: number;
  /** share of the year this entry covers (e.g. 0.25 for a quarter); default 1 */
  periodFraction?: number;
  method: 'fod' | 'collection';
  climate: Climate;
  mcf: number;
  /** oxidation in the cover: 0.1 for managed sites covered with soil / compost, else 0 (Table 3.2) */
  ox: number;
  /** methane share of landfill gas (default 0.5) */
  f?: number;
  /** months before decay starts (0–6; IPCC default 6 = from 1 January of the next year) */
  delayMonths?: number;
  /** waste placed, by year and type ('msw' = mixed municipal waste split by composition) */
  deposits: { year: number; type: string; tonnes: number }[];
  composition?: Record<string, number>;
  overrides?: Record<string, Override>;
  /** collection method: share of the gas generated that the collection system captures */
  collectionEfficiency?: number;
  recovery: Recovery[];
  gwp: GwpTable;
}

export function calcLandfill(input: LandfillInput): CalcResult & { generatedT: number } {
  const out = new Out(input.gwp);
  const frac = input.periodFraction ?? 1;
  check(frac, 'Share of the year', 1);
  check(input.ox, 'Oxidation factor', 1);
  check(input.mcf, 'MCF', 1);
  const F = input.f ?? 0.5;
  check(F, 'Methane share of landfill gas', 1);
  out.steps.push(`${input.siteName}, ${input.year}${frac < 1 ? ` (${pct(frac)} of the year)` : ''}`);
  const recoveredKg = input.recovery.reduce((s, r) => s + r.ch4Kg, 0);

  let generatedKg: number;
  if (input.method === 'collection') {
    const ce = input.collectionEfficiency;
    if (!ce || ce <= 0 || ce > 1) throw new CalcError('Enter the collection efficiency (share of the gas generated that is captured), e.g. 0.75', 'BAD_INPUT');
    if (!(recoveredKg > 0)) throw new CalcError('Enter the methane collected (gas volume and methane %, or kg CH4)', 'BAD_INPUT');
    generatedKg = recoveredKg / ce;
    out.steps.push(`Methane generated = collected ${fmt(recoveredKg)} kg ÷ collection efficiency ${pct(ce)} = ${fmt(generatedKg)} kg CH4`);
  } else {
    const delay = input.delayMonths ?? 6;
    check(delay, 'Delay', 6);
    const M = delay + 7; // month decay starts, IPCC eq. 3.A1.x: M = 13 → decay from 1 January of the next year
    const firstYearShare = (13 - M) / 12;
    const deposits = input.deposits.filter((d) => d.year <= input.year);
    if (!deposits.length) throw new CalcError(`No waste recorded for ${input.siteName} up to ${input.year}: add its tonnage history in the site register`, 'NO_DEPOSITS');
    const firstYear = Math.min(...deposits.map((d) => d.year));
    // Waste per type per year, after splitting mixed waste.
    const byYear = new Map<number, Map<string, number>>();
    const notes: string[] = [];
    for (const d of deposits) {
      const split = splitStreams([{ type: d.type, tonnes: d.tonnes }], input.composition, d.type === MSW && !notes.length ? notes : []);
      const m = byYear.get(d.year) ?? new Map<string, number>();
      for (const [k, v] of split) m.set(k, (m.get(k) ?? 0) + v);
      byYear.set(d.year, m);
    }
    out.steps.push(...notes);
    const types = [...new Set([...byYear.values()].flatMap((m) => [...m.keys()]))].map((c) => params(c, input.overrides))
      .filter((t) => t.doc * t.docf > 0);
    if (!types.length) throw new CalcError('None of the waste recorded decays (no degradable organic carbon)', 'NO_DEPOSITS');
    const kOf = (t: (typeof types)[number]) => t.k ?? K_DEFAULT[t.decay][input.climate];
    out.steps.push(`First order decay (${S06} ch. 3): climate ${CLIMATES[input.climate]}; MCF ${fmt(input.mcf)}; F ${fmt(F)}; delay ${delay} months (decay starts ${M === 13 ? '1 January of the year after placement' : `month ${M} of the year placed`})`);
    for (const t of types) {
      out.steps.push(`  ${t.name}: DOC ${fmt(t.doc)}, DOCf ${fmt(t.docf)}, k ${fmt(kOf(t))}/yr${t.changed.length ? ` (site values: ${t.changed.join(', ')})` : ` (${t.source}; k Table 3.3)`}`);
    }
    // DDOCm accumulated per type, year by year (eq. 3.4–3.6).
    const acc = new Map<string, number>();
    let decomposedT = 0;
    const rows: string[] = [];
    for (let y = firstYear; y <= input.year; y++) {
      let decY = 0;
      const placed = deposits.filter((x) => x.year === y).reduce((s2, x) => s2 + x.tonnes, 0);
      for (const t of types) {
        const k = kOf(t);
        const w = byYear.get(y)?.get(t.code) ?? 0;
        const dep = w * t.doc * t.docf * input.mcf;
        const prev = acc.get(t.code) ?? 0;
        const dec = prev * (1 - Math.exp(-k)) + dep * (1 - Math.exp(-k * firstYearShare));
        acc.set(t.code, prev * Math.exp(-k) + dep * Math.exp(-k * firstYearShare));
        decY += dec;
      }
      if (y === input.year) decomposedT = decY;
      rows.push(`${y}: placed ${fmt(placed)} t, DDOCm decomposed ${fmt(decY)} t → CH4 ${fmt(decY * F * 16 / 12)} t`);
    }
    out.steps.push('  Year by year:', ...rows.slice(-25).map((r) => `    ${r}`));
    if (rows.length > 25) out.steps.push(`    (${rows.length - 25} earlier years not shown)`);
    generatedKg = decomposedT * F * (16 / 12) * 1000 * frac;
    out.steps.push(`Methane generated in ${input.year} = ${fmt(decomposedT)} t DDOCm × F ${fmt(F)} × 16/12${frac < 1 ? ` × ${fmt(frac)}` : ''} = ${fmt(generatedKg)} kg CH4`);
  }

  let toSurface = generatedKg - recoveredKg;
  if (toSurface < 0) {
    out.warnings.push(`Methane recovered (${fmt(recoveredKg)} kg) is more than the model generates (${fmt(generatedKg)} kg): check the tonnage history, k values or the gas measurements. Surface emissions are taken as zero.`);
    toSurface = 0;
  }
  out.steps.push(`Not recovered: ${fmt(generatedKg)} − ${fmt(recoveredKg)} = ${fmt(toSurface)} kg CH4; oxidised in the cover ${pct(input.ox)}`);
  out.gas('direct', 'CH4', toSurface * (1 - input.ox), `Emitted through the surface: ${fmt(toSurface)} × (1 − ${fmt(input.ox)}) = ${fmt(toSurface * (1 - input.ox))} kg CH4`);
  burn(out, input.recovery);
  const ch4 = out.lines.filter((l) => l.basis === 'direct').reduce((s, l) => s + (l.kgGas ?? 0), 0);
  out.steps.push(`Methane emitted: ${fmt(ch4)} kg = ${fmt(out.totals.direct)} kg CO2e`);
  if (ch4 > 0) out.factors.push({ basis: 'direct', label: 'Methane emitted × GWP', factorId: null, source: `GWP ${input.gwp.set}`, validFrom: null,
    co2ePerUnit: out.totals.direct / ch4, unit: 'kg', unitName: 'kg CH4', perEnteredUnit: out.totals.direct / ch4, enteredUnit: 'kg', enteredUnitName: 'kg CH4', quantity: ch4, method: 'gas' });
  return { ...out.result(), generatedT: generatedKg / 1000 };
}

// -------------------------------------------------------------- incineration --

export interface IncinerationInput {
  plantName: string;
  streams: { type: string; tonnes: number }[];
  composition?: Record<string, number>;
  overrides?: Record<string, Override>;
  technology: string;
  /** oxidation factor (default 1, Table 5.2) */
  of?: number;
  /** CH4 / N2O kg per tonne, replacing the IPCC defaults */
  ch4PerT?: number;
  n2oPerT?: number;
  /** measured stack CO2 with its biogenic share (e.g. by carbon-14) instead of the composition */
  measured?: { co2Tonnes: number; biogenicPct: number; source: string };
  /** electricity / heat exported, shown only (never subtracted) */
  exportedMWh?: number;
  gwp: GwpTable;
}

export function calcIncineration(input: IncinerationInput): CalcResult {
  const out = new Out(input.gwp);
  const tech = INCINERATORS[input.technology];
  if (!tech) throw new CalcError('Choose the incinerator technology', 'BAD_INPUT');
  const of = input.of ?? 1;
  check(of, 'Oxidation factor', 1);
  const split = splitStreams(input.streams, input.composition, out.steps);
  const tonnes = input.streams.reduce((s, x) => s + x.tonnes, 0);
  out.steps.push(`${input.plantName}: ${fmt(tonnes)} t of waste incinerated (${tech.name})`);

  if (input.measured) {
    const m = input.measured;
    check(m.co2Tonnes, 'Measured CO2'); check(m.biogenicPct, 'Biogenic share', 100);
    const fossil = m.co2Tonnes * 1000 * (1 - m.biogenicPct / 100);
    out.steps.push(`Measured stack CO2 (${m.source}): ${fmt(m.co2Tonnes)} t, biogenic share ${fmt(m.biogenicPct)}%`);
    out.gas('direct', 'CO2', fossil, `Fossil CO2: ${fmt(m.co2Tonnes)} t × (1 − ${fmt(m.biogenicPct / 100)}) = ${fmt(fossil)} kg CO2`);
    out.gas('outside_scopes', 'CO2', m.co2Tonnes * 1000 - fossil, `Biogenic CO2 (outside scopes): ${fmt(m.co2Tonnes * 1000 - fossil)} kg CO2`);
  } else {
    out.steps.push(`Fossil CO2 = waste × dry matter × carbon fraction × fossil share × oxidation ${fmt(of)} × 44/12 (${S06} eq. 5.1/5.2, Table 5.2)`);
    let fossil = 0, bio = 0;
    for (const [code, t] of split) {
      if (!t) continue;
      const p = params(code, input.overrides);
      if (p.cf === null || p.cf === undefined) {
        if (p.fcf > 0) out.warnings.push(`${p.name}: no carbon content — enter it for this plant, or use measured stack CO2.`);
        else out.steps.push(`  ${p.name}: ${fmt(t)} t — all carbon biogenic, no carbon content given (biogenic CO2 not estimated)`);
        continue;
      }
      const c = t * 1000 * p.dm * p.cf * of * 44 / 12;
      fossil += c * p.fcf; bio += c * (1 - p.fcf);
      if (c > 0) out.steps.push(`  ${p.name}: ${fmt(t)} t × ${fmt(p.dm)} × ${fmt(p.cf)} × ${fmt(p.fcf)} × ${fmt(of)} × 44/12 = ${fmt(c * p.fcf)} kg fossil CO2 (+ ${fmt(c * (1 - p.fcf))} kg biogenic)${p.changed.length ? ` — plant values: ${p.changed.join(', ')}` : ''}`);
    }
    out.gas('direct', 'CO2', fossil, `Fossil CO2: ${fmt(fossil)} kg`);
    out.gas('outside_scopes', 'CO2', bio, `Biogenic CO2 (outside scopes): ${fmt(bio)} kg`);
  }
  // CH4 and N2O per tonne of waste (wet).
  const ch4PerT = input.ch4PerT ?? tech.ch4;
  out.gas('direct', 'CH4', tonnes * ch4PerT, `CH4: ${fmt(tonnes)} t × ${fmt(ch4PerT)} kg/t (${input.ch4PerT !== undefined ? 'entered' : `${S06} Table 5.3, ${tech.name}`}) = ${fmt(tonnes * ch4PerT)} kg CH4`);
  let n2o = 0;
  if (input.n2oPerT !== undefined) {
    n2o = tonnes * input.n2oPerT;
    out.gas('direct', 'N2O', n2o, `N2O: ${fmt(tonnes)} t × ${fmt(input.n2oPerT)} kg/t (entered) = ${fmt(n2o)} kg N2O`);
  } else {
    // By waste class (Table 5.6): municipal, industrial, sludge, sewage sludge.
    const byCls = new Map<WasteType['n2o'], number>();
    for (const s of input.streams) { const cls = s.type === MSW ? 'msw' : wasteType(s.type).n2o; byCls.set(cls, (byCls.get(cls) ?? 0) + s.tonnes); }
    for (const [cls, t] of byCls) {
      const ef = incineratorN2o(cls, tech.batch);
      out.gas('direct', 'N2O', t * ef, `N2O (${cls.replace('_', ' ')}): ${fmt(t)} t × ${fmt(ef)} kg/t (${S06} Table 5.6) = ${fmt(t * ef)} kg N2O`);
    }
  }
  if (input.exportedMWh) out.steps.push(`Energy exported: ${fmt(input.exportedMWh)} MWh — reported separately, never subtracted from emissions (GHG Protocol)`);
  out.summary(input.measured ? 'measured CO2 + IPCC 2006' : S06, tonnes, 't', 'tonne of waste');
  return out.result();
}

// --------------------------------------------------------------- biological --

export interface BiologicalInput {
  process: 'composting' | 'ad';
  tonnes: number;
  basis: 'wet' | 'dry';
  ch4PerT?: number;
  n2oPerT?: number;
  /** digesters: measured biogas instead of the default factor */
  measured?: { ch4ProducedKg: number; leakPct?: number; recovery: Recovery[] };
  gwp: GwpTable;
}

export function calcBiological(input: BiologicalInput): CalcResult {
  const out = new Out(input.gwp);
  check(input.tonnes, 'Tonnes');
  const name = input.process === 'composting' ? 'Composting' : 'Anaerobic digestion';
  out.steps.push(`${name}: ${fmt(input.tonnes)} t treated (${input.basis} weight)`);
  const d = BIO_DEFAULTS[input.process][input.basis];
  if (input.process === 'ad' && input.measured) {
    const m = input.measured;
    check(m.ch4ProducedKg, 'Methane produced');
    const leak = (m.leakPct ?? AD_LEAK_DEFAULT * 100) / 100;
    check(leak, 'Leak share', 1);
    out.steps.push(`Methane produced (measured): ${fmt(m.ch4ProducedKg)} kg; leaks ${pct(leak)} (${m.leakPct !== undefined ? 'entered' : `${S06} section 4.1 default`})`);
    out.gas('direct', 'CH4', m.ch4ProducedKg * leak, `Leaks: ${fmt(m.ch4ProducedKg)} × ${fmt(leak)} = ${fmt(m.ch4ProducedKg * leak)} kg CH4`);
    const burned = burn(out, m.recovery);
    const vented = m.ch4ProducedKg * (1 - leak) - burned;
    if (vented > 1e-6) {
      out.gas('direct', 'CH4', vented, `Not burned or sent out (vented): ${fmt(vented)} kg CH4`);
      out.warnings.push(`${fmt(vented)} kg of the methane produced is not accounted for by the flare / engine figures and is counted as vented.`);
    } else if (vented < -1e-6) {
      out.warnings.push('More methane is burned than produced after leaks: check the gas figures.');
    }
  } else {
    const ch4 = input.ch4PerT ?? d.ch4;
    out.gas('direct', 'CH4', input.tonnes * ch4, `CH4: ${fmt(input.tonnes)} t × ${fmt(ch4)} kg/t (${input.ch4PerT !== undefined ? 'entered' : `${S06} Table 4.1, ${input.basis} weight`}) = ${fmt(input.tonnes * ch4)} kg CH4${input.process === 'ad' ? ' (the default already allows for gas recovered)' : ''}`);
  }
  const n2o = input.n2oPerT ?? d.n2o;
  if (n2o) out.gas('direct', 'N2O', input.tonnes * n2o, `N2O: ${fmt(input.tonnes)} t × ${fmt(n2o)} kg/t (${input.n2oPerT !== undefined ? 'entered' : `${S06} Table 4.1`}) = ${fmt(input.tonnes * n2o)} kg N2O`);
  else if (input.process === 'ad') out.steps.push(`N2O: assumed negligible for anaerobic digestion (${S06} Table 4.1)`);
  out.summary(S06, input.tonnes, 't', `tonne treated (${input.basis})`);
  return out.result();
}

// --------------------------------------------------------------- wastewater --

export interface WastewaterInput {
  kind: 'domestic' | 'industrial';
  system: string;
  mcf?: number;
  /** organics in the wastewater treated (TOW), kg BOD or COD */
  measure: 'BOD' | 'COD';
  organicsKg: number;
  /** organics removed as sludge (same measure) */
  sludgeKg?: number;
  bo?: number;
  recovery: Recovery[];
  /** nitrogen in the wastewater treated (kg N) and in the effluent discharged */
  nInfluentKg?: number;
  efPlant?: number;
  nEffluentKg?: number;
  efEffluent?: number;
  /** organics left in the effluent discharged (kg, same measure) */
  effluentOrganicsKg?: number;
  mcfDischarge?: number;
  gwp: GwpTable;
}

export function calcWastewater(input: WastewaterInput): CalcResult {
  const out = new Out(input.gwp);
  const sys = WW_SYSTEMS[input.system];
  if (!sys) throw new CalcError('Choose the treatment system', 'BAD_INPUT');
  check(input.organicsKg, 'Organics treated');
  const s = input.sludgeKg ?? 0;
  check(s, 'Organics removed as sludge');
  if (s > input.organicsKg) throw new CalcError('Organics removed as sludge cannot exceed the organics treated', 'BAD_INPUT');
  const mcf = input.mcf ?? sys[input.kind];
  check(mcf, 'MCF', 1);
  const bo = input.bo ?? BO[input.measure];
  const tableRef = input.kind === 'domestic' ? 'Table 6.3' : 'Table 6.8';
  out.steps.push(`${input.kind === 'domestic' ? 'Domestic' : 'Industrial'} wastewater, ${sys.name}: ${fmt(input.organicsKg)} kg ${input.measure} treated${s ? `, ${fmt(s)} kg removed as sludge` : ''}`);
  const potential = (input.organicsKg - s) * bo * mcf;
  out.steps.push(`Methane: (${fmt(input.organicsKg)} − ${fmt(s)}) × Bo ${fmt(bo)} kg CH4/kg ${input.measure} (${input.bo !== undefined ? 'entered' : `${S06} Table 6.2`}) × MCF ${fmt(mcf)} (${input.mcf !== undefined ? 'entered' : `${S19} ${tableRef}`}) = ${fmt(potential)} kg CH4`);
  const recovered = input.recovery.reduce((a, r) => a + r.ch4Kg, 0);
  let rest = potential - recovered;
  if (rest < 0) {
    out.warnings.push(`Methane recovered (${fmt(recovered)} kg) is more than the IPCC estimate (${fmt(potential)} kg): check the MCF, the organics load or the gas measurements. Emissions from the plant are taken as zero.`);
    rest = 0;
  }
  out.gas('direct', 'CH4', rest, `Not recovered: ${fmt(potential)} − ${fmt(recovered)} = ${fmt(rest)} kg CH4`);
  burn(out, input.recovery);
  if (input.nInfluentKg) {
    const ef = input.efPlant ?? N2O_PLANT;
    const kg = input.nInfluentKg * ef * 44 / 28;
    out.gas('direct', 'N2O', kg, `N2O in the plant: ${fmt(input.nInfluentKg)} kg N × ${fmt(ef)} kg N2O-N/kg N (${input.efPlant !== undefined ? 'entered' : `${S19} Table 6.8A`}) × 44/28 = ${fmt(kg)} kg N2O`);
  }
  if (input.nEffluentKg) {
    const ef = input.efEffluent ?? N2O_EFFLUENT;
    const kg = input.nEffluentKg * ef * 44 / 28;
    out.gas('direct', 'N2O', kg, `N2O from effluent discharged: ${fmt(input.nEffluentKg)} kg N × ${fmt(ef)} kg N2O-N/kg N (${input.efEffluent !== undefined ? 'entered' : `${S19} Table 6.8A`}) × 44/28 = ${fmt(kg)} kg N2O`);
  }
  if (input.effluentOrganicsKg) {
    const m = input.mcfDischarge ?? MCF_DISCHARGE;
    const kg = input.effluentOrganicsKg * bo * m;
    out.gas('direct', 'CH4', kg, `CH4 from effluent discharged: ${fmt(input.effluentOrganicsKg)} kg ${input.measure} × Bo ${fmt(bo)} × MCF ${fmt(m)} (${input.mcfDischarge !== undefined ? 'entered' : `${S19} Table 6.3, aquatic discharge Tier 1`}) = ${fmt(kg)} kg CH4`);
  }
  out.summary(S19, input.organicsKg, 'kg', `kg ${input.measure}`);
  return out.result();
}
