/**
 * UAE MRV — pure calculation (no database).
 *
 * Two regimes:
 *  1. Abu Dhabi facility MRV (EAD Resolution No. 3 of 2026; EAD Facility MRV Technical Guidance v8, Feb 2026):
 *     Scope 1 per facility, calendar year, covered sectors (power & water, oil & gas, industry, transport — not
 *     aviation or marine), threshold 25,000 tCO2e direct; source streams by calculation (activity data × NCV × EF
 *     × oxidation factor), mass balance (carbon content × 44/12) or measurement; activity-data tiers by
 *     uncertainty (±7.5 / 5 / 2.5 / 1.5 %); source streams classed de minimis / minor / major; report by 31 March,
 *     verification by an ISO 14065-accredited verifier from reporting year 2026.
 *  2. Federal (Federal Decree-Law No. 11 of 2024; Cabinet Resolution No. 67 of 2024 on the National Register for
 *     Carbon Credits): designated sources report Scope 1 and 2 under the GHG Protocol through the national MRV
 *     system (IEQT); 0.5 MtCO2e or more of Scope 1 + 2 a year → NRCC registration and annual verification.
 *
 * Default fuel factors: 2006 IPCC Guidelines, Vol. 2 (Energy), Table 1.2 (net calorific values), Table 1.4 (CO2),
 * Tables 2.2–2.3 (stationary CH4 / N2O) and 3.2.1–3.2.2 (road transport CH4 / N2O). Supplier or measured values
 * replace them; every stream says where its factors come from.
 */

export type Kind = 'combustion' | 'process' | 'mass_balance' | 'measured' | 'gas';
export type Sector = 'power' | 'oil_gas' | 'industry' | 'transport' | 'other';
export type Materiality = 'de_minimis' | 'minor' | 'major';
export type AdUnit = 't' | 'TJ' | 'kNm3' | 'kL';

export const EMIRATES: Record<string, string> = { AZ: 'Abu Dhabi', DU: 'Dubai', SH: 'Sharjah', AJ: 'Ajman', UQ: 'Umm Al Quwain', RK: 'Ras Al Khaimah', FU: 'Fujairah' };
export const SECTORS: Record<Sector, { label: string; covered: boolean; hint: string }> = {
  power: { label: 'Power (electricity and desalinated water)', covered: true, hint: 'Power stations, desalination, cogeneration' },
  oil_gas: { label: 'Oil and gas', covered: true, hint: 'Upstream, gas processing, refining, LNG' },
  industry: { label: 'Industry', covered: true, hint: 'Manufacturing; not service-oriented facilities' },
  transport: { label: 'Transport (road or rail fleets based in Abu Dhabi)', covered: true, hint: 'Aviation and marine are not covered' },
  other: { label: 'Other (not a covered sector)', covered: false, hint: 'May report voluntarily' },
};

/** IPCC 2006 defaults. ncv: TJ/Gg (= GJ/t); co2: tCO2/TJ; ch4/n2o: kg/TJ (stationary, energy industries / manufacturing). */
export interface Fuel { code: string; name: string; ncv: number; co2: number; ch4: number; n2o: number; ch4Mobile?: number; n2oMobile?: number; density?: number; gas?: boolean; biogenic?: boolean; match: RegExp }
export const FUELS: Fuel[] = [
  { code: 'natural_gas', name: 'Natural gas', ncv: 48.0, co2: 56.1, ch4: 1, n2o: 0.1, ch4Mobile: 92, n2oMobile: 3, gas: true, match: /natural gas|\bcng\b|\blng\b|methane/i },
  { code: 'gas_diesel', name: 'Gas / diesel oil', ncv: 43.0, co2: 74.1, ch4: 3, n2o: 0.6, ch4Mobile: 3.9, n2oMobile: 3.9, density: 0.84, match: /diesel|gas ?oil|\bago\b|marine gas/i },
  { code: 'gasoline', name: 'Motor gasoline', ncv: 44.3, co2: 69.3, ch4: 3, n2o: 0.6, ch4Mobile: 25, n2oMobile: 8, density: 0.745, match: /petrol|gasoline|\bmogas\b/i },
  { code: 'residual', name: 'Residual fuel oil', ncv: 40.4, co2: 77.4, ch4: 3, n2o: 0.6, density: 0.96, match: /fuel oil|\bhfo\b|residual|bunker/i },
  { code: 'lpg', name: 'Liquefied petroleum gases', ncv: 47.3, co2: 63.1, ch4: 1, n2o: 0.1, ch4Mobile: 62, n2oMobile: 0.2, density: 0.51, match: /\blpg\b|propane|butane|liquefied petroleum/i },
  { code: 'kerosene', name: 'Other kerosene', ncv: 43.8, co2: 71.9, ch4: 3, n2o: 0.6, density: 0.8, match: /kerosene|burning oil|paraffin/i },
  { code: 'jet', name: 'Jet kerosene', ncv: 44.1, co2: 71.5, ch4: 3, n2o: 0.6, density: 0.8, match: /\bjet\b|aviation turbine/i },
  { code: 'naphtha', name: 'Naphtha', ncv: 44.5, co2: 73.3, ch4: 3, n2o: 0.6, density: 0.7, match: /naphtha/i },
  { code: 'crude', name: 'Crude oil', ncv: 42.3, co2: 73.3, ch4: 3, n2o: 0.6, density: 0.85, match: /crude/i },
  { code: 'ethane', name: 'Ethane', ncv: 46.4, co2: 61.6, ch4: 1, n2o: 0.1, gas: true, match: /ethane/i },
  { code: 'refinery_gas', name: 'Refinery gas', ncv: 49.5, co2: 57.6, ch4: 1, n2o: 0.1, gas: true, match: /refinery gas|fuel gas|off-?gas/i },
  { code: 'petcoke', name: 'Petroleum coke', ncv: 32.5, co2: 97.5, ch4: 3, n2o: 0.6, match: /pet(roleum)? ?coke/i },
  { code: 'bituminous', name: 'Other bituminous coal', ncv: 25.8, co2: 94.6, ch4: 10, n2o: 1.5, match: /coal/i },
  { code: 'lubricants', name: 'Lubricants', ncv: 40.2, co2: 73.3, ch4: 3, n2o: 0.6, density: 0.88, match: /lubricant|lube oil/i },
  { code: 'biodiesel', name: 'Biodiesels', ncv: 27.0, co2: 70.8, ch4: 3, n2o: 0.6, density: 0.88, biogenic: true, match: /biodiesel|\bhvo\b|\bfame\b/i },
  { code: 'wood', name: 'Wood / wood waste', ncv: 15.6, co2: 112, ch4: 30, n2o: 4, biogenic: true, match: /wood|biomass|pellet|chip/i },
  { code: 'biogas', name: 'Other biogas (incl. landfill gas)', ncv: 50.4, co2: 54.6, ch4: 1, n2o: 0.1, gas: true, biogenic: true, match: /biogas|landfill gas|biomethane/i },
];
export const FUEL = new Map(FUELS.map((f) => [f.code, f]));
/** The IPCC fuel an inventory item most likely is (biofuels before their fossil look-alikes). */
export function matchFuel(text: string, bio = false): Fuel | null {
  const order = bio ? [...FUELS.filter((f) => f.biogenic), ...FUELS.filter((f) => !f.biogenic)] : FUELS;
  return order.find((f) => f.match.test(text)) ?? null;
}
/** Natural gas by volume: default net calorific value per thousand Nm³ (48.0 GJ/t × 0.75 kg/Nm³); the supplier's value is better. */
export const NG_TJ_PER_KNM3 = 0.036;

export interface Stream {
  id: string; name: string; kind: Kind; fuel?: string | null; material?: string | null;
  mobile?: boolean;                    // road / rail fleet fuel: mobile CH4 and N2O factors
  fallback?: boolean;                  // fallback approach (no tier reachable)
  adQty?: number | null; adUnit?: AdUnit; density?: number | null; ncv?: number | null;   // ncv: TJ per t or per kNm³
  ef?: number | null;                  // combustion: tCO2/TJ; process: tCO2 per t of material
  of?: number | null;                  // oxidation factor (combustion) or conversion factor (process), 0–1
  carbon?: number | null;              // mass balance: t C per t
  direction?: 'input' | 'output';      // mass balance: carbon in (+) or out (−)
  biomass?: number | null;             // biomass fraction 0–1: its CO2 is reported apart, not counted
  ch4Ef?: number | null; n2oEf?: number | null;        // kg/TJ
  measuredCo2?: number | null; measuredCh4?: number | null;   // t
  gas?: string | null; gasT?: number | null;           // 'gas' kind: tonnes of the gas (fugitive, vented, process N2O, HFC…)
  uncertainty?: number | null;         // activity data (or measurement) uncertainty, ± %
  materiality?: Materiality | null;    // the operator's class; empty = worked out
  instrument?: string; efSource?: string; note?: string; documentId?: string | null;
  entryKey?: string | null; entriesT?: number | null; entries?: number | null;   // filled from inventory entries
}
export interface StreamResult {
  id: string; tj: number | null; co2: number; co2Bio: number; ch4: number; n2o: number; other: number; co2e: number;
  tier: 0 | 1 | 2 | 3 | 4 | null; tierRequired: number; materiality: Materiality; autoMateriality: Materiality; ok: boolean; problems: string[];
}

const n = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : x);
/** Activity data in TJ (combustion) and in tonnes where it applies. */
export function activity(s: Stream): { tj: number | null; t: number | null; problems: string[] } {
  const q = n(s.adQty), problems: string[] = [];
  if (q == null) return { tj: null, t: null, problems: ['No activity data'] };
  const f = s.fuel ? FUEL.get(s.fuel) : undefined;
  const unit = s.adUnit ?? 't';
  let t: number | null = null, tj: number | null = null;
  if (unit === 'TJ') tj = q;
  else if (unit === 't') t = q;
  else if (unit === 'kL') { const d = n(s.density) ?? f?.density ?? null; if (d == null) problems.push('Volume in kL needs a density (t per kL)'); else t = q * d; }
  else if (unit === 'kNm3') { const v = n(s.ncv) ?? (s.fuel === 'natural_gas' ? NG_TJ_PER_KNM3 : null); if (v == null) problems.push('Gas in thousand Nm³ needs a net calorific value (TJ per thousand Nm³)'); else tj = q * v; }
  if (tj == null && t != null && s.kind === 'combustion') {
    const v = unit === 't' || unit === 'kL' ? n(s.ncv) ?? (f ? f.ncv / 1000 : null) : null;
    if (v == null) problems.push('Needs a net calorific value (TJ per t)'); else tj = t * v;
  }
  return { tj, t, problems };
}

export function tierOf(u: number | null | undefined): 0 | 1 | 2 | 3 | 4 | null {
  if (u == null) return null;
  return u <= 1.5 ? 4 : u <= 2.5 ? 3 : u <= 5 ? 2 : u <= 7.5 ? 1 : 0;
}
export const TIERS = [{ tier: 1, max: 7.5 }, { tier: 2, max: 5 }, { tier: 3, max: 2.5 }, { tier: 4, max: 1.5 }];
export const REQUIRED: Record<Materiality, number> = { major: 2, minor: 1, de_minimis: 0 };

/** Gases of one stream, in tonnes, before GWP. */
export function gases(s: Stream): { tj: number | null; co2: number; co2Bio: number; ch4: number; n2o: number; other: number; problems: string[] } {
  const out = { tj: null as number | null, co2: 0, co2Bio: 0, ch4: 0, n2o: 0, other: 0, problems: [] as string[] };
  const f = s.fuel ? FUEL.get(s.fuel) : undefined;
  const bio = Math.min(1, Math.max(0, n(s.biomass) ?? (f?.biogenic ? 1 : 0)));
  const split = (co2: number) => { out.co2 += co2 * (1 - bio); out.co2Bio += co2 * bio; };
  if (s.kind === 'measured') {
    split(n(s.measuredCo2) ?? 0); out.ch4 = n(s.measuredCh4) ?? 0;
    if (s.measuredCo2 == null && s.measuredCh4 == null) out.problems.push('No measured emissions');
    return out;
  }
  if (s.kind === 'gas') {
    const t = n(s.gasT);
    if (t == null) { out.problems.push('No quantity of gas'); return out; }
    if (!s.gas) out.problems.push('Choose the gas');
    if (s.gas === 'CO2') out.co2 = t; else if (s.gas === 'CH4' || s.gas === 'CH4_fossil') out.ch4 = t; else if (s.gas === 'N2O') out.n2o = t; else out.other = t;
    return out;
  }
  const a = activity(s); out.tj = a.tj; out.problems.push(...a.problems);
  if (s.kind === 'combustion') {
    if (a.tj == null) return out;
    const ef = n(s.ef) ?? f?.co2 ?? null;
    if (ef == null) { out.problems.push('Needs an emission factor (tCO2/TJ)'); return out; }
    split(a.tj * ef * (n(s.of) ?? 1));
    const ch4 = n(s.ch4Ef) ?? (s.mobile ? f?.ch4Mobile : f?.ch4) ?? 0, n2o = n(s.n2oEf) ?? (s.mobile ? f?.n2oMobile : f?.n2o) ?? 0;
    out.ch4 = (a.tj * ch4) / 1000; out.n2o = (a.tj * n2o) / 1000;
  } else if (s.kind === 'process') {
    const t = a.t ?? null;
    if (t == null) { out.problems.push('Process activity data in tonnes (or kL with a density)'); return out; }
    if (n(s.ef) == null) { out.problems.push('Needs an emission factor (tCO2 per t of material)'); return out; }
    split(t * s.ef! * (n(s.of) ?? 1));
  } else if (s.kind === 'mass_balance') {
    const t = a.t ?? null;
    if (t == null) { out.problems.push('Mass balance needs tonnes of material'); return out; }
    if (n(s.carbon) == null) { out.problems.push('Needs the carbon content (t C per t)'); return out; }
    split((s.direction === 'output' ? -1 : 1) * t * s.carbon! * (44 / 12));
  }
  return out;
}

/**
 * Source-stream classes (EAD guidance): streams are taken smallest first; together they are de minimis while
 * below the higher of 1 kt and 2% of the total (2% capped at 20 kt); then minor while below the higher of 5 kt and
 * 10% (capped at 100 kt); the rest are major. Negative (carbon out) streams are left out of the ranking (major).
 */
export function classify(es: { id: string; co2e: number }[]): Map<string, Materiality> {
  const total = es.reduce((a, e) => a + Math.max(0, e.co2e), 0);
  const dm = Math.max(1000, Math.min(0.02 * total, 20000)), mi = Math.max(5000, Math.min(0.1 * total, 100000));
  const out = new Map<string, Materiality>();
  let cum = 0;
  for (const e of [...es].filter((x) => x.co2e >= 0).sort((a, b) => a.co2e - b.co2e)) {
    cum += e.co2e;
    out.set(e.id, cum < dm ? 'de_minimis' : cum < mi ? 'minor' : 'major');
  }
  for (const e of es) if (!out.has(e.id)) out.set(e.id, 'major');
  return out;
}

export type Gwp = Record<string, number>;
export interface FacilityResult {
  streams: StreamResult[]; co2: number; co2Bio: number; ch4: number; n2o: number; other: number; total: number; direct: number;
  byGas: { gas: string; t: number; co2e: number }[]; uncertainty: number | null; thresholdMet: boolean; problems: string[];
  thresholds: { deMinimis: number; minor: number };
}
/** The facility's year: streams, totals by gas, classes and tiers, uncertainty, the 25,000 t threshold. */
export function facility(streams: Stream[], gwp: Gwp): FacilityResult {
  const g = (code: string) => gwp[code] ?? (code === 'CO2' ? 1 : 0);
  const raw = streams.map((s) => {
    const x = gases(s);
    const otherE = s.kind === 'gas' && s.gas && !['CO2', 'CH4', 'CH4_fossil', 'N2O'].includes(s.gas) ? x.other * g(s.gas) : 0;
    if (s.kind === 'gas' && s.gas && otherE === 0 && x.other > 0) x.problems.push(`No GWP for ${s.gas} in the company's GWP set`);
    return { s, x, co2e: x.co2 + x.ch4 * g('CH4') + x.n2o * g('N2O') + otherE };
  });
  const cls = classify(raw.map((r) => ({ id: r.s.id, co2e: r.co2e })));
  const res: StreamResult[] = raw.map(({ s, x, co2e }) => {
    const auto = cls.get(s.id)!, m = s.materiality ?? auto, tier = tierOf(s.uncertainty), req = REQUIRED[m];
    const problems = [...x.problems];
    const tiered = s.kind !== 'measured' && s.kind !== 'gas';
    if (tiered && !s.fallback && m !== 'de_minimis') {
      if (tier == null) problems.push('Give the activity-data uncertainty to show the tier');
      else if (tier < req) problems.push(`${m === 'major' ? 'Major' : 'Minor'} stream: Tier ${req} needed (±${TIERS[req - 1]!.max}%), uncertainty ±${s.uncertainty}% is ${tier ? `Tier ${tier}` : 'below Tier 1'}`);
    }
    if (s.fallback && !s.note?.trim()) problems.push('Fallback approach: say why no tier is technically feasible or why it costs unreasonably much');
    if (s.materiality && s.materiality !== auto) problems.push(`Classed ${s.materiality.replace('_', ' ')} by the operator; the totals put it at ${auto.replace('_', ' ')}`);
    return { id: s.id, tj: x.tj, co2: x.co2, co2Bio: x.co2Bio, ch4: x.ch4, n2o: x.n2o, other: x.other, co2e, tier, tierRequired: tiered ? req : 0, materiality: m, autoMateriality: auto, ok: !problems.length, problems };
  });
  const sum = (k: 'co2' | 'co2Bio' | 'ch4' | 'n2o' | 'other' | 'co2e') => res.reduce((a, r) => a + r[k], 0);
  const total = sum('co2e');
  const byGas = new Map<string, { t: number; co2e: number }>();
  const addG = (gas: string, t: number, e: number) => { if (!t) return; const o = byGas.get(gas) ?? { t: 0, co2e: 0 }; o.t += t; o.co2e += e; byGas.set(gas, o); };
  raw.forEach(({ s }, i) => {
    const r = res[i]!;
    addG('CO2', r.co2, r.co2); addG('CH4', r.ch4, r.ch4 * g('CH4')); addG('N2O', r.n2o, r.n2o * g('N2O'));
    if (r.other && s.gas) addG(s.gas, r.other, r.other * g(s.gas));
  });
  // whole-facility uncertainty from the streams' uncertainties (independent errors)
  const known = res.filter((r, i) => r.co2e > 0 && streams[i]!.uncertainty != null);
  const uncertainty = total > 0 && known.length ? (Math.sqrt(known.reduce((a, r) => { const u = streams.find((s) => s.id === r.id)!.uncertainty! / 100; return a + (r.co2e * u) ** 2; }, 0)) / total) * 100 : null;
  const problems: string[] = [];
  if (streams.some((s) => s.fallback) && uncertainty != null && uncertainty > 7.5) problems.push(`With a fallback approach the whole facility's uncertainty must not exceed ±7.5% (now ±${uncertainty.toFixed(1)}%)`);
  const direct = sum('co2') + sum('ch4') * g('CH4');   // the threshold counts CO2 and methane
  return {
    streams: res, co2: sum('co2'), co2Bio: sum('co2Bio'), ch4: sum('ch4'), n2o: sum('n2o'), other: sum('other'), total, direct,
    byGas: [...byGas].map(([gas, v]) => ({ gas, ...v })).sort((a, b) => b.co2e - a.co2e), uncertainty, thresholdMet: direct >= EAD_THRESHOLD, problems,
    thresholds: { deMinimis: Math.max(1000, Math.min(0.02 * total, 20000)), minor: Math.max(5000, Math.min(0.1 * total, 100000)) },
  };
}

export const EAD_THRESHOLD = 25_000;      // tCO2e direct (CO2 and methane) in the reporting year
export const NRCC_THRESHOLD = 500_000;    // tCO2e Scope 1 + 2 a year (Cabinet Resolution 67 of 2024)
export const EAD_VERIFICATION_FROM = 2026; // reporting year from which the report must be verified
export const MAX_VERIFIER_YEARS = 6;      // then a two-year break

/** Does the facility have to report to EAD this year? */
export function eadStatus(f: { emirate: string; sector: Sector; operationsStart?: string | null }, direct: number | null, year: number) {
  if (f.emirate !== 'AZ') return { status: 'not_abu_dhabi' as const, text: 'Outside Abu Dhabi: the EAD programme does not apply (federal reporting may)' };
  if (!SECTORS[f.sector].covered) return { status: 'voluntary' as const, text: 'Not a covered sector: reporting is voluntary' };
  if (direct == null) return { status: 'unknown' as const, text: 'Enter the source streams to check the 25,000 t threshold' };
  if (direct >= EAD_THRESHOLD) {
    const first = f.operationsStart ? Number(f.operationsStart.slice(0, 4)) === year : false;
    const verified = year >= EAD_VERIFICATION_FROM && !first;
    return { status: 'required' as const, text: `At or above 25,000 tCO₂e: report to EAD by 31 March ${year + 1}${verified ? ', verified by an accredited verifier' : first ? ' (first year of operation: no verification)' : ''}` };
  }
  return { status: 'below' as const, text: 'Below 25,000 tCO₂e: give one year of data with a short explanation to confirm the status' };
}

/** Federal position of the company: Cabinet Resolution 67 (≥ 0.5 MtCO2e Scope 1 + 2) and the Decree-Law duties. */
export function federal(s1: number | null, s2: number | null, designated: 'yes' | 'no' | 'unknown') {
  const total = s1 == null && s2 == null ? null : (s1 ?? 0) + (s2 ?? 0);
  const large = total != null && total >= NRCC_THRESHOLD;
  const duties: string[] = [];
  if (designated === 'yes' || large) duties.push('Measure and keep an inventory of Scope 1 and 2 emissions; report annually on the national MRV system (IEQT); keep records for at least 5 years', 'Contribute to reduction: energy efficiency, clean energy, carbon sinks, CCUS, fluorocarbon alternatives, offsetting, waste management');
  if (large) duties.push('Register with the National Register for Carbon Credits (NRCC)', 'Annual verification by an ISO 14065-accredited verifier authorised by the Ministry');
  if (!duties.length) duties.push(designated === 'no' ? 'Not designated and below 0.5 MtCO₂e: no federal reporting duty yet — keep the inventory ready' : 'Designation not known: sources are designated by the Ministry or the emirate authority; keep the inventory ready');
  return { total, large, duties };
}

/** Dates of the reporting year (EAD calendar; federal dates where set). */
export function calendar(year: number, opts: { registeredOn?: string | null; mpChange?: string | null } = {}) {
  const d = (m: number, day: number, y = year) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const add = (iso: string, days: number) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };
  const out: { date: string; what: string; who: 'EAD' | 'Federal' }[] = [
    { date: d(3, 31), what: `Registration with EAD for ${year} (facilities without an environmental permit); renewed every year`, who: 'EAD' },
    { date: d(3, 31), what: `Monitoring plan for ${year} (Excel template), with the verifier's review`, who: 'EAD' },
    ...(year >= EAD_VERIFICATION_FROM ? [{ date: d(7, 1), what: 'Planned verification notified to EAD; verification starts by mid-year with a site visit', who: 'EAD' as const }] : []),
    { date: d(3, 31, year + 1), what: `Annual report for ${year}${year >= EAD_VERIFICATION_FROM ? ' with the verification statement' : ''} (grace period to 14 April)`, who: 'EAD' },
    { date: '2027-05-31', what: 'Federal adjustment period ends: extended by one year from 31 May 2026 (Cabinet Resolution No. 147 of 2026) — confirm against the Official Gazette', who: 'Federal' },
  ];
  if (opts.registeredOn) out.push({ date: add(opts.registeredOn, 90), what: 'Monitoring plan due: 90 days after registration', who: 'EAD' });
  if (opts.mpChange) out.push({ date: add(opts.mpChange, 30), what: 'Revised monitoring plan due: 30 days after a significant change', who: 'EAD' });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
