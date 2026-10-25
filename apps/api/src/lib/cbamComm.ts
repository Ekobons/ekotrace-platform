/**
 * CBAM communication from an installation operator (exporter) to EU reporting declarants (importers).
 *
 * Follows the European Commission's "CBAM Communication template for installations" (version 2.1, 5 June 2024):
 * one communication per installation and reporting period, with the same sections as the template.
 *
 *   A  Installation, verifier, aggregated goods categories, production processes, purchased precursors
 *   B  Source streams (calculation), PFC emissions, emission sources (measurement)
 *   C  Fuel balance, GHG balance and data quality
 *   D  Per production process: production levels, use of the output, attributed emissions, heat, waste gases, electricity
 *   E  Per purchased precursor: amounts, where consumed, specific embedded emissions
 *   F  Carbon price due (tool)
 *   Summary_Products  goods by CN code with qualifying parameters and carbon price
 *
 * The calculations reproduce the template's formulas so the portal shows the same results the workbook will:
 *   source stream (combustion)    AD × NCV/1000 (if EF in tCO2/TJ) × EF × OxF × (1 − bio)
 *   source stream (process)       AD × (NCV/1000) × EF × ConvF × (1 − bio)
 *   source stream (mass balance)  AD × C × 3.664 × (1 − bio)
 *   PFC slope method              AD × frequency × duration × SEF(CF4) / 1000; C2F6 = CF4 × F(C2F6); ÷ collection efficiency
 *   PFC overvoltage method        AD × (AEO / CE) × OVC / 1000
 *   measured source               concentration × hours × flue gas flow / 1000 × GWP
 *   attributed direct emissions   DirEm + heat imported × EF − heat exported × EF
 *                                 + waste gas imported × 56.1 − waste gas exported × 56.1 × 0.667 − electricity exported × EF
 *   attributed indirect           electricity consumed × EF
 *   specific embedded emissions   (attributed + Σ precursor consumed × its SEE) ÷ total production of the process,
 *                                 solved over the whole supply chain (own precursors and purchased precursors)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillTemplate, fromExcelDate, readWorkbook, type CellValue } from './xlsxTemplate.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/cbam');
export const TEMPLATE_FILE = join(DATA, 'CBAM_Communication_template_installations_v2.1.xlsx');
export const TEMPLATE_VERSION = 'CBAM Communication template for installations, version 2.1 (5 June 2024)';

export interface GoodType { name: string; unit: string; indirect: boolean; indirectDefinitive: boolean; routeRelevant: boolean; routes: string[]; precursors: string[]; chain: string[]; cn: string[] }
export interface Lists {
  template: string; goods: GoodType[]; cnNames: Record<string, string>; countries: [string, string][]; currencies: [string, string][];
  lists: Record<'elecSource' | 'dataQuality' | 'verification' | 'justification' | 'carbonPrice' | 'rebate' | 'efUnits' | 'adUnits' | 'cemsGas' | 'method' | 'pfcMethod' | 'reducingAgent' | 'measDefault', string[]>;
  consts: { efNatGas: number; gwpN2O: number; gwpCF4: number; gwpC2F6: number };
}
let lists: Lists | null = null;
export function commLists(): Lists { return (lists ??= JSON.parse(readFileSync(join(DATA, 'template-lists.json'), 'utf8')) as Lists); }
export const ONLY_DIRECT = 'Only direct production';
export const ALL_ROUTES = 'All production routes';
export const LIMITS = { goods: 10, processes: 10, precursors: 20, streams: 75, pfc: 10, measured: 10, products: 100 } as const;

// ------------------------------------------------------------------ data model --
type N = number | null;
export interface CommData {
  period: { start: string | null; end: string | null };
  installation: { nameLocal: string; name: string; street: string; economicActivity: string; postcode: string; poBox: string; city: string; country: string; unlocode: string; lat: string; lon: string; repName: string; email: string; phone: string };
  verifier: { company: string; street: string; city: string; postcode: string; country: string; repName: string; email: string; phone: string; fax: string; accreditationState: string; accreditationBody: string; registration: string };
  goods: { category: string; routes: string[] }[];
  processes: Process[];
  precursors: Precursor[];
  streams: Stream[];
  pfc: Pfc[];
  measured: Measured[];
  fuel: { total: N; cbam: N; electricity: N; nonCbam: N };              // TJ, manual entries (sheet C row 16)
  ghg: { co2: N; biomass: N; n2o: N; pfc: N; indirect: N };              // tCO2e, manual entries (sheet C row 26)
  quality: { general: string; justification: string; assurance: string };
  products: Product[];
  carbonCurrency: string;                                               // currency of the carbon price tool (sheet F)
}
export interface Process {
  id: string; name: string; category: string; includes: string[];       // includes: 'Only direct production' and/or other categories from goods
  production: N[];                                                      // per production route of the category (route order of the template)
  market: N; consumedIn: Record<string, N>; nonCbam: N;                 // consumedIn: other process id → amount
  heatApplicable: boolean; wasteGasApplicable: boolean;
  dirEm: N;
  heat: { imp: N; impEf: N; exp: N; expEf: N };
  wasteGas: { imp: N; impEf: N; exp: N; expEf: N };
  elecMwh: N; elecEf: N; elecSource: string;
  elecExported: N; elecExportedEf: N;
  carbon: { share: N; price: N; rebate: N };                            // carbon price tool (sheet F): share of SE covered, price and rebate per tCO2e
}
export interface Precursor {
  id: string; name: string; category: string; country: string; routes: string[];
  purchased: N[];                                                       // per route of the category
  consumedIn: Record<string, N>; other: N;
  seeDirect: N; seeDirectSource: string; elecPerT: N; elecPerTSource: string; elecEf: N; elecEfSource: string; justification: string;
}
export interface Stream { method: string; name: string; ad: N; unit: string; ncv: N; ef: N; efUnit: string; carbon: N; oxf: N; convf: N; bio: N }
export interface Pfc { method: string; technology: string; ad: N; frequency: N; duration: N; sef: N; aeo: N; ce: N; ovc: N; fC2F6: N; collection: N }
export interface Measured { name: string; gas: string; bio: N; conc: N; hours: N; flow: N; energyFossil: N; energyBio: N }
export const PRODUCT_PARAMS = [
  ['R', 'mn', '% Mn', 'pct'], ['S', 'cr', '% Cr', 'pct'], ['T', 'ni', '% Ni', 'pct'], ['U', 'otherAlloys', '% other alloys', 'pct'], ['V', 'carbonPct', '% carbon', 'pct'],
  ['W', 'scrapSteel', 't scrap per t steel', 'pct'], ['X', 'otherMaterials', '% other materials', 'pct'], ['Y', 'preConsumerScrap', '% pre-consumer scrap', 'pct'],
  ['Z', 'scrapAl', 't scrap per t aluminium', 'pct'], ['AA', 'nonAl', '% non-aluminium elements', 'pct'], ['AB', 'clinker', 'Clinker factor', 'pct'], ['AC', 'calcined', 'Calcined or not', 'bool'],
  ['AD', 'concentration', 'Concentration, if hydrous solution', 'pct'], ['AE', 'nitricAcid', '% nitric acid', 'pct'], ['AF', 'ureaPct', '% urea', 'pct'], ['AG', 'nTotal', '% N contained', 'pct'],
  ['AH', 'nAmmonium', '% N as ammonium (NH4+)', 'pct'], ['AI', 'nNitrate', '% N as nitrate (NO3–)', 'pct'], ['AJ', 'nUrea', '% N as urea', 'pct'], ['AK', 'nOther', '% N in other (organic) forms', 'pct'],
] as const;
export type ParamKey = (typeof PRODUCT_PARAMS)[number][1];
export interface Product {
  processId: string; cn: string; name: string; reducingAgent: string; millId: string;
  params: Partial<Record<ParamKey, number | boolean | null>>;               // shares as fractions (0.12 = 12 %), as in the template
  cpType: string; cpShare: N; currency: string; cpDue: N; rebateType: string; rebateShare: N; rebate: N;
}

export function emptyComm(): CommData {
  return {
    period: { start: null, end: null },
    installation: { nameLocal: '', name: '', street: '', economicActivity: '', postcode: '', poBox: '', city: '', country: '', unlocode: '', lat: '', lon: '', repName: '', email: '', phone: '' },
    verifier: { company: '', street: '', city: '', postcode: '', country: '', repName: '', email: '', phone: '', fax: '', accreditationState: '', accreditationBody: '', registration: '' },
    goods: [], processes: [], precursors: [], streams: [], pfc: [], measured: [],
    fuel: { total: null, cbam: null, electricity: null, nonCbam: null }, ghg: { co2: null, biomass: null, n2o: null, pfc: null, indirect: null },
    quality: { general: '', justification: '', assurance: '' }, products: [], carbonCurrency: '',
  };
}
export const emptyProcess = (id: string): Process => ({
  id, name: '', category: '', includes: [ONLY_DIRECT], production: [], market: null, consumedIn: {}, nonCbam: null, heatApplicable: false, wasteGasApplicable: false, dirEm: null,
  heat: { imp: null, impEf: null, exp: null, expEf: null }, wasteGas: { imp: null, impEf: null, exp: null, expEf: null }, elecMwh: null, elecEf: null, elecSource: '', elecExported: null, elecExportedEf: null,
  carbon: { share: null, price: null, rebate: null },
});
export const emptyPrecursor = (id: string): Precursor => ({ id, name: '', category: '', country: '', routes: [], purchased: [], consumedIn: {}, other: null, seeDirect: null, seeDirectSource: '', elecPerT: null, elecPerTSource: '', elecEf: null, elecEfSource: '', justification: '' });

export const goodType = (name: string) => commLists().goods.find((g) => g.name === name) ?? null;
/** Routes of a category as the template lists them (route 1, 2, …). */
export const routesOf = (category: string) => goodType(category)?.routes ?? [];

// ------------------------------------------------------------------ normalising --
const num = (v: unknown): N => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const str = (v: unknown, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const bool = (v: unknown) => v === true || v === 'true' || v === 1;
const arr = <T>(v: unknown, max: number, f: (x: Record<string, unknown>, i: number) => T): T[] => (Array.isArray(v) ? v.slice(0, max).map((x, i) => f((x ?? {}) as Record<string, unknown>, i)) : []);
const numRec = (v: unknown): Record<string, N> => { const o: Record<string, N> = {}; if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) o[str(k, 40)] = num(x); return o; };
const ids = (v: unknown, prefix: string, i: number) => str(v, 40) || `${prefix}${i + 1}`;

/** Clean data from the browser: known fields only, sizes capped at the template's limits. */
export function normalise(x: unknown): CommData {
  const d = (x ?? {}) as Record<string, any>;
  const e = emptyComm();
  const date = (v: unknown) => { const s = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
  e.period = { start: date(d.period?.start), end: date(d.period?.end) };
  for (const k of Object.keys(e.installation) as (keyof CommData['installation'])[]) e.installation[k] = str(d.installation?.[k], 200);
  for (const k of Object.keys(e.verifier) as (keyof CommData['verifier'])[]) e.verifier[k] = str(d.verifier?.[k], 200);
  e.goods = (Array.isArray(d.goods) ? d.goods : []).slice(0, LIMITS.goods).map((g: any) => ({ category: str(g?.category, 80), routes: (Array.isArray(g?.routes) ? g.routes : []).slice(0, 6).map((r: unknown) => str(r, 120)).filter(Boolean) }));
  e.processes = arr(d.processes, LIMITS.processes, (p, i) => ({
    id: ids(p.id, 'p', i), name: str(p.name, 120), category: str(p.category, 80),
    includes: (Array.isArray(p.includes) ? p.includes : []).slice(0, 6).map((r: unknown) => str(r, 80)).filter(Boolean),
    production: (Array.isArray(p.production) ? p.production : []).slice(0, 8).map(num), market: num(p.market), consumedIn: numRec(p.consumedIn), nonCbam: num(p.nonCbam),
    heatApplicable: bool(p.heatApplicable), wasteGasApplicable: bool(p.wasteGasApplicable), dirEm: num(p.dirEm),
    heat: { imp: num((p.heat as any)?.imp), impEf: num((p.heat as any)?.impEf), exp: num((p.heat as any)?.exp), expEf: num((p.heat as any)?.expEf) },
    wasteGas: { imp: num((p.wasteGas as any)?.imp), impEf: num((p.wasteGas as any)?.impEf), exp: num((p.wasteGas as any)?.exp), expEf: num((p.wasteGas as any)?.expEf) },
    elecMwh: num(p.elecMwh), elecEf: num(p.elecEf), elecSource: str(p.elecSource, 20), elecExported: num(p.elecExported), elecExportedEf: num(p.elecExportedEf),
    carbon: { share: num((p.carbon as any)?.share), price: num((p.carbon as any)?.price), rebate: num((p.carbon as any)?.rebate) },
  }));
  e.precursors = arr(d.precursors, LIMITS.precursors, (p, i) => ({
    id: ids(p.id, 'pp', i), name: str(p.name, 120), category: str(p.category, 80), country: str(p.country, 3).toUpperCase(),
    routes: (Array.isArray(p.routes) ? p.routes : []).slice(0, 5).map((r: unknown) => str(r, 120)).filter(Boolean),
    purchased: (Array.isArray(p.purchased) ? p.purchased : []).slice(0, 8).map(num), consumedIn: numRec(p.consumedIn), other: num(p.other),
    seeDirect: num(p.seeDirect), seeDirectSource: str(p.seeDirectSource, 20), elecPerT: num(p.elecPerT), elecPerTSource: str(p.elecPerTSource, 20),
    elecEf: num(p.elecEf), elecEfSource: str(p.elecEfSource, 20), justification: str(p.justification, 80),
  }));
  e.streams = arr(d.streams, LIMITS.streams, (s) => ({ method: str(s.method, 40), name: str(s.name, 120), ad: num(s.ad), unit: str(s.unit, 10), ncv: num(s.ncv), ef: num(s.ef), efUnit: str(s.efUnit, 20), carbon: num(s.carbon), oxf: num(s.oxf), convf: num(s.convf), bio: num(s.bio) }));
  e.pfc = arr(d.pfc, LIMITS.pfc, (s) => ({ method: str(s.method, 40), technology: str(s.technology, 120), ad: num(s.ad), frequency: num(s.frequency), duration: num(s.duration), sef: num(s.sef), aeo: num(s.aeo), ce: num(s.ce), ovc: num(s.ovc), fC2F6: num(s.fC2F6), collection: num(s.collection) }));
  e.measured = arr(d.measured, LIMITS.measured, (s) => ({ name: str(s.name, 120), gas: str(s.gas, 5), bio: num(s.bio), conc: num(s.conc), hours: num(s.hours), flow: num(s.flow), energyFossil: num(s.energyFossil), energyBio: num(s.energyBio) }));
  e.fuel = { total: num(d.fuel?.total), cbam: num(d.fuel?.cbam), electricity: num(d.fuel?.electricity), nonCbam: num(d.fuel?.nonCbam) };
  e.ghg = { co2: num(d.ghg?.co2), biomass: num(d.ghg?.biomass), n2o: num(d.ghg?.n2o), pfc: num(d.ghg?.pfc), indirect: num(d.ghg?.indirect) };
  e.quality = { general: str(d.quality?.general, 200), justification: str(d.quality?.justification, 200), assurance: str(d.quality?.assurance, 200) };
  e.products = arr(d.products, LIMITS.products, (p) => {
    const params: Product['params'] = {};
    for (const [, key, , kind] of PRODUCT_PARAMS) { const v = (p.params as any)?.[key]; if (v == null || v === '') continue; params[key] = kind === 'bool' ? bool(v) : num(v); }
    return { processId: str(p.processId, 40), cn: str(p.cn, 8).replace(/\D/g, ''), name: str(p.name, 200), reducingAgent: str(p.reducingAgent, 40), millId: str(p.millId, 60), params,
      cpType: str(p.cpType, 60), cpShare: num(p.cpShare), currency: str(p.currency, 3).toUpperCase(), cpDue: num(p.cpDue), rebateType: str(p.rebateType, 60), rebateShare: num(p.rebateShare), rebate: num(p.rebate) };
  });
  e.carbonCurrency = str(d.carbonCurrency, 3).toUpperCase();
  return e;
}

// ------------------------------------------------------------------ calculation --
const s0 = (x: N | undefined) => (x == null ? 0 : x);
export interface StreamOut { co2: number | null; bio: number; energyFossil: number; energyBio: number; problem: string | null }
export interface NodeResult { id: string; name: string; kind: 'process' | 'precursor'; category: string; unit: string; total: number; attrDirect: number; attrIndirect: number; elec: number;
  seeDirect: number | null; seeIndirect: number | null; seeTotal: number | null; embeddedElec: number | null; defaultShare: number | null; elecSource: string;
  cpDue: number | null; rebate: number | null; chain: { id: string; name: string; perUnit: number; seeDirect: number; seeIndirect: number; isDefault: boolean }[] }
export interface CommResult {
  streams: StreamOut[]; pfc: (number | null)[]; measured: (number | null)[];
  fuel: { fromStreams: number; total: number; rest: number | null };
  ghg: { co2: number; biomass: number; n2o: number; pfc: number; direct: number; indirect: number | null; total: number | null; indirectSuggested: number; auto: { co2: number; biomass: number; n2o: number; pfc: number } };
  nodes: NodeResult[];
  products: { i: number; processName: string; category: string; cnName: string; seeDirect: number | null; seeIndirect: number | null; seeTotal: number | null; unit: string; defaultShare: number | null; elecSource: string; embeddedElec: number | null; cpCovered: number | null; rebateCovered: number | null; effectiveCp: number | null }[];
  checks: { level: 'error' | 'warn'; step: string; msg: string }[];
}

export function streamEmissions(s: Stream): StreamOut {
  const bio = s0(s.bio) / 100;
  const tj = s0(s.ad) * s0(s.ncv) / 1000;
  const out = { co2: null as number | null, bio: 0, energyFossil: tj * (1 - bio), energyBio: tj * bio, problem: null as string | null };
  if (!s.method) return out;
  if (s.method === 'Mass Balance') {
    if (s.ad == null || s.carbon == null || !s.unit) { out.problem = 'Incomplete'; return out; }
    const t = s.ad * s.carbon * 3.664; out.co2 = t * (1 - bio); out.bio = t * bio; return out;
  }
  const consistent = (s.unit === 't' && s.efUnit === 'tCO2/t') || (s.unit === '1000Nm3' && s.efUnit === 'tCO2/1000Nm3') || s.efUnit === 'tCO2/TJ';
  if (s.efUnit && s.unit && !consistent) { out.problem = 'Units do not match'; return out; }
  if (!s.name || !s.unit || !s.efUnit || s.ad == null || s.ef == null || (s.efUnit === 'tCO2/TJ' && s.ncv == null)) { out.problem = 'Incomplete'; return out; }
  const base = s.ad * (s.efUnit === 'tCO2/TJ' ? s0(s.ncv) / 1000 : 1) * s.ef;
  const factor = s.method === 'Combustion' ? (s.oxf == null ? 1 : s.oxf / 100) : (s.convf == null ? 1 : s.convf / 100);
  out.co2 = base * factor * (1 - bio); out.bio = base * factor * bio;
  return out;
}
export function pfcEmissions(p: Pfc): number | null {
  const L = commLists().consts;
  if (!p.method) return null;
  const cf4 = p.method === 'Slope method' ? s0(p.ad) * s0(p.frequency) * s0(p.duration) * s0(p.sef) / 1000 : (p.ce ? s0(p.ad) * (s0(p.aeo) / p.ce) * s0(p.ovc) / 1000 : null);
  if (cf4 == null) return null;
  const c2f6 = cf4 * s0(p.fC2F6);
  return (cf4 * L.gwpCF4 + c2f6 * L.gwpC2F6) / (p.collection == null || p.collection === 0 ? 1 : p.collection);
}
export function measuredEmissions(m: Measured): number | null {
  if (!m.gas) return null;
  const gwp = m.gas === 'N2O' ? commLists().consts.gwpN2O : 1;
  return s0(m.conc) * s0(m.hours) * s0(m.flow) / 1000 * (1 - s0(m.bio) / 100) * gwp;
}
const total = (xs: N[]) => xs.reduce<number>((a, b) => a + s0(b), 0);
export const processTotal = (p: Process) => total(p.production);
export const precursorTotal = (p: Precursor) => total(p.purchased);

export function calculate(d: CommData): CommResult {
  const L = commLists();
  const checks: CommResult['checks'] = [];
  const streams = d.streams.map(streamEmissions);
  const pfc = d.pfc.map(pfcEmissions);
  const measured = d.measured.map(measuredEmissions);
  streams.forEach((s, i) => { if (s.problem) checks.push({ level: 'error', step: 'emissions', msg: `Source stream ${i + 1}${d.streams[i]?.name ? ` (${d.streams[i]?.name})` : ''}: ${s.problem.toLowerCase()}` }); });

  const fromStreams = streams.reduce((a, s) => a + s.energyFossil + s.energyBio, 0) + d.measured.reduce((a, m) => (m.gas === 'N2O' ? a : a + s0(m.energyFossil) + s0(m.energyBio)), 0);
  const fuelTotal = d.fuel.total ?? fromStreams;
  const anyFuelSplit = d.fuel.cbam != null || d.fuel.electricity != null || d.fuel.nonCbam != null;
  const fuel = { fromStreams, total: fuelTotal, rest: anyFuelSplit || fuelTotal ? fuelTotal - s0(d.fuel.cbam) - s0(d.fuel.electricity) - s0(d.fuel.nonCbam) : null };

  const co2Auto = streams.reduce((a, s) => a + s0(s.co2), 0) + d.measured.reduce((a, m, i) => (m.gas === 'N2O' ? a : a + s0(measured[i])), 0);
  const bioAuto = streams.reduce((a, s) => a + s.bio, 0) + d.measured.reduce((a, m) => (m.gas === 'N2O' || !m.gas ? a : a + s0(m.conc) * s0(m.hours) * s0(m.flow) / 1000 * (s0(m.bio) / 100)), 0);
  const n2oAuto = d.measured.reduce((a, m, i) => (m.gas === 'N2O' ? a + s0(measured[i]) : a), 0);
  const pfcAuto = pfc.reduce<number>((a, x) => a + s0(x), 0);
  const co2 = d.ghg.co2 ?? co2Auto, biomass = d.ghg.biomass ?? bioAuto, n2o = d.ghg.n2o ?? n2oAuto, pfcT = d.ghg.pfc ?? pfcAuto;
  const direct = co2 + n2o + pfcT;
  const indirectSuggested = d.processes.reduce((a, p) => a + s0(p.elecMwh) * s0(p.elecEf), 0);
  const indirect = d.ghg.indirect;

  // ---- supply chain: nodes are production processes and purchased precursors
  type Node = { id: string; name: string; kind: 'process' | 'precursor'; category: string; total: number; attrDirect: number; attrIndirect: number; elec: number; cp: number; rebate: number; isDefault: boolean; elecSource: string; inputs: Map<string, number> };
  const nodes: Node[] = [];
  for (const p of d.processes) {
    const T = processTotal(p);
    const attrDirect = s0(p.dirEm) + (s0(p.heat.imp) * s0(p.heat.impEf) - s0(p.heat.exp) * s0(p.heat.expEf)) + (s0(p.wasteGas.imp) * L.consts.efNatGas - s0(p.wasteGas.exp) * L.consts.efNatGas * 0.667) - s0(p.elecExported) * s0(p.elecExportedEf);
    const attrIndirect = s0(p.elecMwh) * s0(p.elecEf);
    const se = T > 0 ? (attrDirect + attrIndirect) / T : 0;
    const covered = se * s0(p.carbon.share);
    nodes.push({ id: p.id, name: p.name, kind: 'process', category: p.category, total: T, attrDirect, attrIndirect, elec: s0(p.elecMwh), cp: covered * s0(p.carbon.price) * T, rebate: covered * s0(p.carbon.rebate) * T, isDefault: false, elecSource: p.elecSource, inputs: new Map() });
  }
  for (const r of d.precursors) {
    const T = precursorTotal(r);
    nodes.push({ id: r.id, name: r.name, kind: 'precursor', category: r.category, total: T, attrDirect: s0(r.seeDirect) * T, attrIndirect: s0(r.elecPerT) * s0(r.elecEf) * T, elec: s0(r.elecPerT) * T, cp: 0, rebate: 0, isDefault: r.seeDirectSource === 'Default', elecSource: r.elecEfSource, inputs: new Map() });
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const p of d.processes) for (const [to, amt] of Object.entries(p.consumedIn)) { const n = byId.get(to); if (n && n.kind === 'process' && to !== p.id && s0(amt) > 0) n.inputs.set(p.id, (n.inputs.get(p.id) ?? 0) + s0(amt)); }
  for (const r of d.precursors) for (const [to, amt] of Object.entries(r.consumedIn)) { const n = byId.get(to); if (n && n.kind === 'process' && s0(amt) > 0) n.inputs.set(r.id, (n.inputs.get(r.id) ?? 0) + s0(amt)); }

  // Leontief inverse M = (I − A)⁻¹, A[p][x] = input of x into p per unit of p (as the template's matrix inverse)
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const k = nodes.length;
  const A: number[][] = nodes.map((n) => { const row: number[] = new Array<number>(k).fill(0); if (n.kind === 'process' && n.total > 0) for (const [x, amt] of n.inputs) { const j = idx.get(x)!; row[j] = (row[j] ?? 0) + amt / n.total; } return row; });
  const M = invert(nodes.map((_, i) => nodes.map((__, j) => (i === j ? 1 : 0) - (A[i]?.[j] ?? 0))));
  if (!M) checks.push({ level: 'error', step: 'processes', msg: 'Processes consume each other in a loop that cannot be solved — check the amounts used in other processes' });
  const W = M ?? nodes.map((_, i) => nodes.map((__, j) => (i === j ? 1 : 0)));
  const per = (n: Node, f: (n: Node) => number) => (n.total > 0 ? f(n) / n.total : 0);
  const results: NodeResult[] = nodes.map((n, i) => {
    const chain = nodes.map((x, j) => ({ x, w: W[i]?.[j] ?? 0 })).filter((c) => Math.abs(c.w) > 1e-15);
    const sd = chain.reduce((a, c) => a + c.w * per(c.x, (y) => y.attrDirect), 0);
    const si = chain.reduce((a, c) => a + c.w * per(c.x, (y) => y.attrIndirect), 0);
    const el = chain.reduce((a, c) => a + c.w * per(c.x, (y) => y.elec), 0);
    const cp = chain.reduce((a, c) => a + c.w * per(c.x, (y) => y.cp), 0);
    const rb = chain.reduce((a, c) => a + c.w * per(c.x, (y) => y.rebate), 0);
    const defDirect = chain.reduce((a, c) => a + (c.x.isDefault ? c.w * per(c.x, (y) => y.attrDirect) : 0), 0);
    const has = n.total > 0;
    const unit = goodType(n.category)?.unit ?? 't';
    return { id: n.id, name: n.name, kind: n.kind, category: n.category, unit, total: n.total, attrDirect: n.attrDirect, attrIndirect: n.attrIndirect, elec: n.elec,
      seeDirect: has ? sd : null, seeIndirect: has ? si : null, seeTotal: has ? sd + si : null, embeddedElec: has ? el : null,
      defaultShare: has && sd ? defDirect / sd : has ? 0 : null, elecSource: n.elecSource,
      cpDue: has ? cp : null, rebate: has ? rb : null,
      chain: chain.filter((c) => c.x.id !== n.id).map((c) => ({ id: c.x.id, name: c.x.name, perUnit: c.w, seeDirect: c.w * per(c.x, (y) => y.attrDirect), seeIndirect: c.w * per(c.x, (y) => y.attrIndirect), isDefault: c.x.isDefault })) };
  });

  // ---- products
  const products = d.products.map((p, i) => {
    const node = results.find((r) => r.id === p.processId && r.kind === 'process');
    const proc = d.processes.find((x) => x.id === p.processId);
    const unit = node ? `tCO2e/${node.unit}` : '';
    const seeT = node?.seeTotal ?? null;
    return { i, processName: proc?.name ?? '', category: proc?.category ?? '', cnName: L.cnNames[p.cn] ?? '', seeDirect: node?.seeDirect ?? null, seeIndirect: node?.seeIndirect ?? null, seeTotal: seeT, unit,
      defaultShare: node?.defaultShare ?? null, elecSource: node?.elecSource ?? '', embeddedElec: node?.embeddedElec ?? null,
      cpCovered: seeT != null && p.cpShare != null ? seeT * p.cpShare : null, rebateCovered: seeT != null && p.rebateShare != null ? seeT * p.rebateShare : null,
      effectiveCp: seeT == null ? null : s0(p.cpDue) - s0(p.rebate) };
  });

  // ---- checks (the template's completeness and control rules)
  const err = (step: string, msg: string) => checks.push({ level: 'error', step, msg });
  const warn = (step: string, msg: string) => checks.push({ level: 'warn', step, msg });
  if (!d.period.start || !d.period.end) err('installation', 'Reporting period start and end are needed');
  else if (d.period.end < d.period.start) err('installation', 'Reporting period ends before it starts');
  if (!d.installation.name) err('installation', 'Name of the installation (English) is needed');
  if (!d.installation.country) err('installation', 'Country of the installation is needed');
  if (!d.installation.unlocode) err('installation', 'UN/LOCODE is needed (mandatory in the template)');
  if (!d.goods.length) err('goods', 'List at least one aggregated goods category');
  for (const g of d.goods) {
    const gt = goodType(g.category);
    if (!gt) err('goods', `Unknown goods category ${g.category || '(blank)'}`);
    else if (gt.routeRelevant && !g.routes.length) err('goods', `${g.category}: pick the production route(s)`);
  }
  const cats = new Set(d.goods.map((g) => g.category));
  for (const c of cats) if (!d.processes.some((p) => p.category === c || p.includes.includes(c)) && !d.precursors.some((p) => p.category === c)) warn('goods', `${c} is listed but no production process or purchased precursor covers it`);
  const names = new Map<string, number>();
  for (const n of [...d.processes, ...d.precursors]) if (n.name) names.set(n.name, (names.get(n.name) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) err('processes', `The name "${n}" is used more than once — processes and precursors need different names`);
  d.processes.forEach((p, i) => {
    const lbl = p.name || `Production process ${i + 1}`;
    if (!p.name) err('goods', `Production process ${i + 1} needs a name`);
    if (!p.category) err('goods', `${lbl}: pick its aggregated goods category`);
    if (!p.includes.length) err('goods', `${lbl}: tick what the process includes`);
    const T = processTotal(p);
    if (!(T > 0)) err('processes', `${lbl}: total production is needed`);
    if (p.market == null) err('processes', `${lbl}: amount produced for the market is needed`);
    const used = s0(p.market) + Object.values(p.consumedIn).reduce<number>((a, b) => a + s0(b), 0) + s0(p.nonCbam);
    if (T > 0 && Math.abs(T - used) > Math.max(1e-6, T * 1e-9)) err('processes', `${lbl}: production (${fmt(T)}) does not match market + used in other processes + non-CBAM (${fmt(used)})`);
    if (p.dirEm == null) err('processes', `${lbl}: directly attributable emissions are needed`);
    if (p.heatApplicable && (p.heat.imp == null || p.heat.exp == null || p.heat.impEf == null || p.heat.expEf == null)) err('processes', `${lbl}: fill imported and exported heat and their factors (enter 0 where none)`);
    if (p.wasteGasApplicable && (p.wasteGas.imp == null || p.wasteGas.exp == null)) err('processes', `${lbl}: fill imported and exported waste gases (enter 0 where none)`);
    if (goodType(p.category)?.indirect !== false) {
      if (p.elecMwh == null) err('processes', `${lbl}: electricity consumption is needed`);
      if (p.elecEf == null) err('processes', `${lbl}: electricity emission factor is needed`);
      if (!p.elecSource) err('processes', `${lbl}: source of the electricity emission factor is needed`);
    }
    if (p.elecExported == null) err('processes', `${lbl}: electricity exported is needed (enter 0 if none)`);
    else if (p.elecExported > 0 && p.elecExportedEf == null) err('processes', `${lbl}: emission factor of the exported electricity is needed`);
  });
  d.precursors.forEach((r, i) => {
    const lbl = r.name || `Purchased precursor ${i + 1}`;
    if (!r.name) err('goods', `Purchased precursor ${i + 1} needs a name`);
    if (!r.category) err('goods', `${lbl}: pick its goods category`);
    if (!r.country) err('goods', `${lbl}: country where it was produced is needed`);
    if (goodType(r.category)?.routeRelevant && !r.routes.length) err('goods', `${lbl}: pick the production route(s)`);
    const T = precursorTotal(r);
    if (!(T > 0)) err('precursors', `${lbl}: amount purchased is needed`);
    const used = Object.values(r.consumedIn).reduce<number>((a, b) => a + s0(b), 0) + s0(r.other);
    if (T > 0 && Math.abs(T - used) > Math.max(1e-6, T * 1e-9)) err('precursors', `${lbl}: purchased (${fmt(T)}) does not match consumed + other uses (${fmt(used)})`);
    if (r.seeDirect == null || !r.seeDirectSource) err('precursors', `${lbl}: SEE (direct) and its source are needed`);
    if (r.elecPerT == null || !r.elecPerTSource) err('precursors', `${lbl}: specific electricity consumption and its source are needed`);
    if (r.elecEf == null || !r.elecEfSource) err('precursors', `${lbl}: electricity emission factor and its source are needed`);
    if ((r.seeDirectSource === 'Default' || r.elecPerTSource === 'Default' || r.seeDirectSource === 'Unknown' || r.elecPerTSource === 'Unknown') && !r.justification) err('precursors', `${lbl}: justify the use of default values`);
  });
  if (indirect == null) err('energy', 'Total indirect emissions of the installation are needed (always entered manually)');
  if (!d.quality.general) warn('energy', 'Pick the general information on data quality');
  if (!d.products.length) err('products', 'List the goods (CN codes) you supply');
  d.products.forEach((p, i) => {
    const lbl = `Product ${i + 1}${p.name ? ` (${p.name})` : ''}`;
    const proc = d.processes.find((x) => x.id === p.processId);
    if (!proc) err('products', `${lbl}: pick the production process`);
    if (!p.cn) err('products', `${lbl}: CN code is needed`);
    else if (proc && !goodType(proc.category)?.cn.includes(p.cn)) err('products', `${lbl}: CN ${p.cn} is not in the list for ${proc.category}`);
    if (!p.name) warn('products', `${lbl}: add the product name used with the importer (e.g. on invoices)`);
    if (p.cpType && p.cpType !== 'None' && (p.cpDue == null || !p.currency)) warn('products', `${lbl}: carbon price due and currency complete the carbon price information`);
  });
  if (d.processes.length && d.streams.length === 0 && d.measured.length === 0 && d.pfc.length === 0 && d.ghg.co2 == null) warn('emissions', 'No source streams entered — add the fuels and materials, or enter totals manually under energy & data quality');
  return { streams, pfc, measured, fuel, ghg: { co2, biomass, n2o, pfc: pfcT, direct, indirect, total: indirect == null ? null : direct + indirect, indirectSuggested, auto: { co2: co2Auto, biomass: bioAuto, n2o: n2oAuto, pfc: pfcAuto } }, nodes: results, products, checks };
}
/** Gauss–Jordan inverse; null when singular. */
function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...m.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[piv]![c]!)) piv = r;
    if (Math.abs(a[piv]![c]!) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv]!, a[c]!];
    const row = a[c]!, d = row[c]!;
    for (let j = 0; j < 2 * n; j++) row[j] = row[j]! / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r]![j] = a[r]![j]! - f * row[j]!;
    }
  }
  return a.map((r) => r.slice(n));
}
const fmt = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 4 });

// ------------------------------------------------------------------ template cells --
const A = 'A_InstData', B = 'B_EmInst', C = 'C_Emissions&Energy', D = 'D_Processes', E = 'E_PurchPrec', F = 'F_Tools', SP = 'Summary_Products';
const col = (i: number) => String.fromCharCode(65 + i); // A..Z only
const countryName = (code: string) => commLists().countries.find((c) => c[0] === code)?.[1] ?? code;
const countryCode = (name: string) => { const n = name.trim().toLowerCase(); return commLists().countries.find((c) => c[1].toLowerCase() === n || c[0].toLowerCase() === n)?.[0] ?? name.trim().toUpperCase().slice(0, 2); };
const isoDate = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

/** The template cells to write for a communication. */
export function toCells(d: CommData): { sheet: string; ref: string; v: CellValue }[] {
  const out: { sheet: string; ref: string; v: CellValue }[] = [];
  const put = (sheet: string, ref: string, v: CellValue) => { if (v != null && v !== '') out.push({ sheet, ref, v }); };
  put(A, 'I9', isoDate(d.period.start)); put(A, 'L9', isoDate(d.period.end));
  const ins = d.installation;
  ([[19, ins.nameLocal], [20, ins.name], [21, ins.street], [22, ins.economicActivity], [23, ins.postcode], [24, ins.poBox], [25, ins.city], [26, ins.country ? countryName(ins.country) : ''], [27, ins.unlocode], [28, ins.lat], [29, ins.lon], [30, ins.repName], [31, ins.email], [32, ins.phone]] as [number, string][]).forEach(([r, v]) => put(A, `I${r}`, v));
  const vf = d.verifier;
  ([[37, vf.company], [38, vf.street], [39, vf.city], [40, vf.postcode], [41, vf.country ? countryName(vf.country) : ''], [45, vf.repName], [46, vf.email], [47, vf.phone], [48, vf.fax], [51, vf.accreditationState ? countryName(vf.accreditationState) : ''], [52, vf.accreditationBody], [53, vf.registration]] as [number, string][]).forEach(([r, v]) => put(A, `I${r}`, v));
  d.goods.forEach((g, i) => {
    const r = 62 + i; put(A, `E${r}`, g.category);
    const routes = goodType(g.category)?.routeRelevant ? g.routes : [ALL_ROUTES];
    routes.slice(0, 6).forEach((x, j) => put(A, `${col(8 + j)}${r}`, x));
  });
  d.processes.forEach((p, i) => {
    const r = 83 + i; put(A, `E${r}`, p.category); p.includes.slice(0, 6).forEach((x, j) => put(A, `${col(5 + j)}${r}`, x)); put(A, `L${r}`, p.name);
  });
  d.precursors.forEach((p, i) => {
    const r = 102 + i; put(A, `E${r}`, p.category); put(A, `F${r}`, p.country);
    const routes = goodType(p.category)?.routeRelevant ? p.routes : [ALL_ROUTES];
    routes.slice(0, 5).forEach((x, j) => put(A, `${col(6 + j)}${r}`, x)); put(A, `L${r}`, p.name);
  });
  d.streams.forEach((s, i) => {
    const r = 17 + i;
    put(B, `D${r}`, s.method); put(B, `E${r}`, s.name); put(B, `F${r}`, s.ad); put(B, `G${r}`, s.unit); put(B, `H${r}`, s.ncv); put(B, `J${r}`, s.ef); put(B, `K${r}`, s.method === 'Mass Balance' ? '' : s.efUnit);
    put(B, `L${r}`, s.carbon); put(B, `N${r}`, s.oxf); put(B, `P${r}`, s.convf); put(B, `R${r}`, s.bio);
  });
  d.pfc.forEach((s, i) => {
    const r = 98 + i;
    put(B, `D${r}`, s.method); put(B, `E${r}`, s.technology); put(B, `F${r}`, s.ad);
    put(B, `AG${r}`, s.frequency); put(B, `AH${r}`, s.duration); put(B, `AI${r}`, s.sef); put(B, `AJ${r}`, s.aeo); put(B, `AK${r}`, s.ce); put(B, `AL${r}`, s.ovc); put(B, `AM${r}`, s.fC2F6); put(B, `AT${r}`, s.collection);
  });
  d.measured.forEach((s, i) => {
    const r = 113 + i;
    put(B, `D${r}`, s.name); put(B, `E${r}`, s.gas); put(B, `R${r}`, s.bio); put(B, `V${r}`, s.conc); put(B, `X${r}`, s.hours); put(B, `Z${r}`, s.flow); put(B, `AX${r}`, s.energyFossil); put(B, `AY${r}`, s.energyBio);
  });
  put(C, 'H16', d.fuel.total); put(C, 'I16', d.fuel.cbam); put(C, 'J16', d.fuel.electricity); put(C, 'K16', d.fuel.nonCbam);
  put(C, 'H26', d.ghg.co2); put(C, 'I26', d.ghg.biomass); put(C, 'J26', d.ghg.n2o); put(C, 'K26', d.ghg.pfc); put(C, 'M26', d.ghg.indirect);
  put(C, 'H40', d.quality.general); put(C, 'H41', d.quality.justification); put(C, 'H42', d.quality.assurance);
  d.processes.forEach((p, i) => {
    const o = 65 * i;
    p.production.slice(0, 8).forEach((x, j) => put(D, `L${16 + j + o}`, x));
    put(D, `L${27 + o}`, p.market);
    d.processes.filter((q) => q.id !== p.id).slice(0, 9).forEach((q, j) => put(D, `L${32 + j + o}`, p.consumedIn[q.id] ?? null));
    put(D, `L${41 + o}`, p.nonCbam);
    out.push({ sheet: D, ref: `K${50 + o}`, v: p.heatApplicable }, { sheet: D, ref: `L${50 + o}`, v: p.wasteGasApplicable });
    put(D, `L${54 + o}`, p.dirEm);
    if (p.heatApplicable) { put(D, `L${57 + o}`, p.heat.imp); put(D, `M${57 + o}`, p.heat.exp); put(D, `L${58 + o}`, p.heat.impEf); put(D, `M${58 + o}`, p.heat.expEf); }
    if (p.wasteGasApplicable) { put(D, `L${61 + o}`, p.wasteGas.imp); put(D, `M${61 + o}`, p.wasteGas.exp); put(D, `L${62 + o}`, p.wasteGas.impEf); put(D, `M${62 + o}`, p.wasteGas.expEf); }
    put(D, `L${65 + o}`, p.elecMwh); put(D, `L${66 + o}`, p.elecEf); put(D, `L${67 + o}`, p.elecSource);
    put(D, `L${71 + o}`, p.elecExported); put(D, `L${72 + o}`, p.elecExportedEf);
    const r = 101 + i; put(F, `H${r}`, p.carbon.share); put(F, `J${r}`, p.carbon.price); put(F, `K${r}`, p.carbon.rebate);
  });
  put(F, 'J97', d.carbonCurrency);
  d.precursors.forEach((p, i) => {
    const o = 44 * i;
    p.purchased.slice(0, 8).forEach((x, j) => put(E, `L${17 + j + o}`, x));
    d.processes.slice(0, 10).forEach((q, j) => put(E, `L${28 + j + o}`, p.consumedIn[q.id] ?? null));
    put(E, `L${38 + o}`, p.other);
    put(E, `L${49 + o}`, p.seeDirect); put(E, `M${49 + o}`, p.seeDirectSource);
    put(E, `L${50 + o}`, p.elecPerT); put(E, `M${50 + o}`, p.elecPerTSource);
    put(E, `L${51 + o}`, p.elecEf); put(E, `M${51 + o}`, p.elecEfSource);
    put(E, `K${54 + o}`, p.justification);
  });
  d.products.forEach((p, i) => {
    const r = 10 + i;
    const proc = d.processes.find((x) => x.id === p.processId);
    put(SP, `D${r}`, proc?.name); put(SP, `F${r}`, p.cn); put(SP, `H${r}`, p.name); put(SP, `P${r}`, p.reducingAgent); put(SP, `Q${r}`, p.millId);
    for (const [c, key] of PRODUCT_PARAMS) { const v = p.params[key]; if (v != null) put(SP, `${c}${r}`, v as number | boolean); }
    put(SP, `AL${r}`, p.cpType); put(SP, `AM${r}`, p.cpShare); put(SP, `AP${r}`, p.currency); put(SP, `AR${r}`, p.cpDue);
    put(SP, `AT${r}`, p.rebateType); put(SP, `AU${r}`, p.rebateShare); put(SP, `AX${r}`, p.rebate);
  });
  return out;
}

export function buildWorkbook(d: CommData): Buffer {
  return fillTemplate(readFileSync(TEMPLATE_FILE), toCells(d));
}

/** Reads the inputs of a filled template (any language version of v2.x keeps the same cells). */
export function fromWorkbook(buf: Buffer): CommData {
  const wb = readWorkbook(buf);
  for (const s of [A, B, C, D, E, SP]) if (!wb.sheets.includes(s)) throw new Error('This is not the CBAM communication template for installations (sheet ' + s + ' missing)');
  const g = (s: string, ref: string) => wb.get(s, ref);
  const gs = (s: string, ref: string) => { const v = g(s, ref); return v == null ? '' : String(v).trim(); };
  const gn = (s: string, ref: string): N => { const v = g(s, ref); return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
  const gd = (s: string, ref: string) => { const v = g(s, ref); return typeof v === 'number' ? fromExcelDate(v) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null; };
  const d = emptyComm();
  d.period = { start: gd(A, 'I9'), end: gd(A, 'L9') };
  const iv = (r: number) => gs(A, `I${r}`);
  d.installation = { nameLocal: iv(19), name: iv(20), street: iv(21), economicActivity: iv(22), postcode: iv(23), poBox: iv(24), city: iv(25), country: iv(26) ? countryCode(iv(26)) : '', unlocode: iv(27), lat: iv(28), lon: iv(29), repName: iv(30), email: iv(31), phone: iv(32) };
  d.verifier = { company: iv(37), street: iv(38), city: iv(39), postcode: iv(40), country: iv(41) ? countryCode(iv(41)) : '', repName: iv(45), email: iv(46), phone: iv(47), fax: iv(48), accreditationState: iv(51) ? countryCode(iv(51)) : '', accreditationBody: iv(52), registration: iv(53) };
  for (let i = 0; i < LIMITS.goods; i++) {
    const r = 62 + i, cat = gs(A, `E${r}`); if (!cat) continue;
    const routes = [0, 1, 2, 3, 4, 5].map((j) => gs(A, `${col(8 + j)}${r}`)).filter((x) => x && x !== ALL_ROUTES);
    d.goods.push({ category: cat, routes });
  }
  const procRows: number[] = [];
  for (let i = 0; i < LIMITS.processes; i++) {
    const r = 83 + i, cat = gs(A, `E${r}`); if (!cat) continue;
    procRows.push(i);
    const p = emptyProcess(`p${i + 1}`);
    p.category = cat; p.name = gs(A, `L${r}`); p.includes = [0, 1, 2, 3, 4, 5].map((j) => gs(A, `${col(5 + j)}${r}`)).filter(Boolean);
    d.processes.push(p);
  }
  // the template numbers process blocks by their row in A (gaps count), so read by that index
  const allIdx = procRows;
  d.processes.forEach((p, k) => {
    const i = allIdx[k] ?? k, o = 65 * i;
    p.production = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => gn(D, `L${16 + j + o}`));
    while (p.production.length && p.production[p.production.length - 1] == null) p.production.pop();
    p.market = gn(D, `L${27 + o}`);
    // rows 32–40 list the other processes in A's order, skipping this one (including empty slots)
    const others = Array.from({ length: LIMITS.processes }, (_, j) => j).filter((j) => j !== i);
    others.slice(0, 9).forEach((j, n) => { const v = gn(D, `L${32 + n + o}`); const q = d.processes[allIdx.indexOf(j)]; if (q && v != null) p.consumedIn[q.id] = v; });
    p.nonCbam = gn(D, `L${41 + o}`);
    p.heatApplicable = g(D, `K${50 + o}`) === true; p.wasteGasApplicable = g(D, `L${50 + o}`) === true;
    p.dirEm = gn(D, `L${54 + o}`);
    p.heat = { imp: gn(D, `L${57 + o}`), exp: gn(D, `M${57 + o}`), impEf: gn(D, `L${58 + o}`), expEf: gn(D, `M${58 + o}`) };
    p.wasteGas = { imp: gn(D, `L${61 + o}`), exp: gn(D, `M${61 + o}`), impEf: gn(D, `L${62 + o}`), expEf: gn(D, `M${62 + o}`) };
    p.elecMwh = gn(D, `L${65 + o}`); p.elecEf = gn(D, `L${66 + o}`); p.elecSource = gs(D, `L${67 + o}`);
    p.elecExported = gn(D, `L${71 + o}`); p.elecExportedEf = gn(D, `L${72 + o}`);
    p.carbon = { share: gn(F, `H${101 + i}`), price: gn(F, `J${101 + i}`), rebate: gn(F, `K${101 + i}`) };
  });
  d.carbonCurrency = gs(F, 'J97');
  for (let i = 0; i < LIMITS.precursors; i++) {
    const r = 102 + i, cat = gs(A, `E${r}`); if (!cat) continue;
    const p = emptyPrecursor(`pp${i + 1}`);
    p.category = cat; p.country = gs(A, `F${r}`); p.name = gs(A, `L${r}`);
    p.routes = [0, 1, 2, 3, 4].map((j) => gs(A, `${col(6 + j)}${r}`)).filter((x) => x && x !== ALL_ROUTES);
    const o = 44 * i;
    p.purchased = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => gn(E, `L${17 + j + o}`));
    while (p.purchased.length && p.purchased[p.purchased.length - 1] == null) p.purchased.pop();
    Array.from({ length: LIMITS.processes }, (_, j) => j).forEach((j) => { const v = gn(E, `L${28 + j + o}`); const q = d.processes[allIdx.indexOf(j)]; if (q && v != null) p.consumedIn[q.id] = v; });
    p.other = gn(E, `L${38 + o}`);
    p.seeDirect = gn(E, `L${49 + o}`); p.seeDirectSource = gs(E, `M${49 + o}`);
    p.elecPerT = gn(E, `L${50 + o}`); p.elecPerTSource = gs(E, `M${50 + o}`);
    p.elecEf = gn(E, `L${51 + o}`); p.elecEfSource = gs(E, `M${51 + o}`);
    p.justification = gs(E, `K${54 + o}`);
    d.precursors.push(p);
  }
  for (let i = 0; i < LIMITS.streams; i++) {
    const r = 17 + i, method = gs(B, `D${r}`); if (!method && !gs(B, `E${r}`)) continue;
    d.streams.push({ method, name: gs(B, `E${r}`), ad: gn(B, `F${r}`), unit: gs(B, `G${r}`), ncv: gn(B, `H${r}`), ef: gn(B, `J${r}`), efUnit: gs(B, `K${r}`), carbon: gn(B, `L${r}`), oxf: gn(B, `N${r}`), convf: gn(B, `P${r}`), bio: gn(B, `R${r}`) });
  }
  for (let i = 0; i < LIMITS.pfc; i++) {
    const r = 98 + i, method = gs(B, `D${r}`); if (!method) continue;
    d.pfc.push({ method, technology: gs(B, `E${r}`), ad: gn(B, `F${r}`), frequency: gn(B, `AG${r}`), duration: gn(B, `AH${r}`), sef: gn(B, `AI${r}`), aeo: gn(B, `AJ${r}`), ce: gn(B, `AK${r}`), ovc: gn(B, `AL${r}`), fC2F6: gn(B, `AM${r}`), collection: gn(B, `AT${r}`) });
  }
  for (let i = 0; i < LIMITS.measured; i++) {
    const r = 113 + i, name = gs(B, `D${r}`), gas = gs(B, `E${r}`); if (!name && !gas) continue;
    d.measured.push({ name, gas, bio: gn(B, `R${r}`), conc: gn(B, `V${r}`), hours: gn(B, `X${r}`), flow: gn(B, `Z${r}`), energyFossil: gn(B, `AX${r}`), energyBio: gn(B, `AY${r}`) });
  }
  d.fuel = { total: gn(C, 'H16'), cbam: gn(C, 'I16'), electricity: gn(C, 'J16'), nonCbam: gn(C, 'K16') };
  d.ghg = { co2: gn(C, 'H26'), biomass: gn(C, 'I26'), n2o: gn(C, 'J26'), pfc: gn(C, 'K26'), indirect: gn(C, 'M26') };
  d.quality = { general: gs(C, 'H40'), justification: gs(C, 'H41'), assurance: gs(C, 'H42') };
  for (let i = 0; i < LIMITS.products; i++) {
    const r = 10 + i, pname = gs(SP, `D${r}`); if (!pname) continue;
    const proc = d.processes.find((p) => p.name === pname);
    const params: Product['params'] = {};
    for (const [c, key, , kind] of PRODUCT_PARAMS) { const v = g(SP, `${c}${r}`); if (v == null) continue; params[key] = kind === 'bool' ? v === true : typeof v === 'number' ? v : null; }
    d.products.push({ processId: proc?.id ?? '', cn: gs(SP, `F${r}`).replace(/\D/g, ''), name: gs(SP, `H${r}`), reducingAgent: gs(SP, `P${r}`), millId: gs(SP, `Q${r}`), params,
      cpType: gs(SP, `AL${r}`), cpShare: gn(SP, `AM${r}`), currency: gs(SP, `AP${r}`), cpDue: gn(SP, `AR${r}`), rebateType: gs(SP, `AT${r}`), rebateShare: gn(SP, `AU${r}`), rebate: gn(SP, `AX${r}`) });
  }
  return normalise(d);
}
