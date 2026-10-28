/**
 * Extended Producer Responsibility (package 'epr') — the regimes and the calculations (pure, no database).
 *
 * A stream is one obligation line of the company: a regime (India plastic packaging, e-waste, batteries, tyres; EU PPWR in
 * one member state; another scheme typed by hand) and a category in it. Each year the company records what it placed on
 * the market (or, as a recycler, processed); the obligation follows from the regime's rule, and certificates bought
 * (producers) or generated and sold (recyclers) meet it. Targets are as published, checked October 2026, and every
 * figure can be replaced per stream by the target shown on the authority's portal.
 *
 * Periods: India runs April–March; the period is the calendar year the financial year ends in (2026 = FY 2025-26).
 * The EU and other schemes run by calendar year.
 */

export type Regime = 'in_plastic' | 'in_ewaste' | 'in_battery' | 'in_tyre' | 'eu_ppwr' | 'other';
export type Role = 'producer' | 'importer' | 'brand_owner' | 'recycler';
export type CertKind = 'recycling' | 'eol' | 'recycled_content' | 'refurbish' | 'reuse';
export type Base = 'same_year' | 'prev_year' | 'avg_prev_two' | 'lag_life' | 'lag_two';

const step = (table: [number, number][], y: number): number | null => { let v: number | null = null; for (const [from, pct] of table) if (y >= from) v = pct; return v; };

export interface RegimeDef {
  name: string; short: string; jurisdiction: string; authority: string; source: string; period: 'india_fy' | 'calendar';
  categories: Record<string, string>;
  base: Base;                                                   // which year's quantity the obligation is computed on
  target: (y: number, cat: string) => number | null;            // obligation as % of the base (null: typed)
  recyclingShare?: (y: number, cat: string) => number | null;   // part of the obligation that must be met by recycling (the rest may be end of life)
  recycledContent?: (y: number, cat: string) => number | null;  // minimum recycled content in what is placed on the market, %
  certValidityYears?: number;                                   // certificates lapse this many years after the end of the year they were generated in
  purchaseCap?: boolean;                                        // certificates bought may not exceed the liability + carried + 10%
  carryYears: number;                                           // how long a shortfall may be carried before it is forfeited to compensation
  returnDue: (y: number) => string | null; returnNote: string;
  units: string;                                                // what is counted
  notes: string;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const PPWR_MATERIALS: Record<string, string> = {
  plastic_cs_pet: 'Plastic — contact-sensitive PET (not beverage bottles)', plastic_cs_other: 'Plastic — contact-sensitive, other than PET',
  plastic_bottles: 'Plastic — single-use beverage bottles', plastic_other: 'Plastic — other packaging',
  paper: 'Paper and cardboard', glass: 'Glass', aluminium: 'Aluminium', steel: 'Steel / ferrous metal', wood: 'Wood', composite: 'Composite / multi-material', other: 'Other',
};
const PPWR_RC: Record<string, [number, number]> = { plastic_cs_pet: [30, 50], plastic_cs_other: [10, 25], plastic_bottles: [30, 65], plastic_other: [35, 65] };

export const REGIMES: Record<Regime, RegimeDef> = {
  in_plastic: {
    name: 'India — plastic packaging (Plastic Waste Management Rules, Schedule II)', short: 'Plastic packaging', jurisdiction: 'India', authority: 'Central Pollution Control Board (CPCB)',
    source: 'https://eprplastic.cpcb.gov.in/', period: 'india_fy', units: 'tonnes of plastic packaging',
    categories: { cat1: 'Category I — rigid', cat2: 'Category II — flexible (single or multi-layer, one polymer)', cat3: 'Category III — multi-layered (more than one material)', cat4: 'Category IV — compostable plastic' },
    // obligation: average of the last two years' packaging placed on the market (A) plus pre-consumer waste, less what was supplied to other registered PIBOs
    base: 'avg_prev_two',
    target: (y) => step([[2022, 25], [2023, 70], [2024, 100]], y),
    recyclingShare: (y, c) => (c === 'cat1' || c === 'cat4' ? step([[2025, 50], [2026, 60], [2027, 70], [2028, 80]], y) : step([[2025, 30], [2026, 40], [2027, 50], [2028, 60]], y)),
    // G.S.R. 237(E), 31 March 2026: Category I 30/40/50/60, II 10/10/20/20, III 5/5/10/10 from FY 2025-26 (plastic part only for III)
    recycledContent: (y, c) => (c === 'cat1' ? step([[2026, 30], [2027, 40], [2028, 50], [2029, 60]], y) : c === 'cat2' ? step([[2026, 10], [2028, 20]], y) : c === 'cat3' ? step([[2026, 5], [2028, 10]], y) : null),
    carryYears: 3, returnDue: (y) => iso(y, 6, 30), returnNote: 'Annual return on the CPCB EPR portal by 30 June (often extended by CPCB notice)',
    notes: 'Obligation = average quantity placed on the market in the two previous years (plus pre-consumer waste, less quantity supplied to registered PIBOs). At least the recycling share must be met with recycling certificates; the rest may be end-of-life disposal where the guidelines allow it. Recycled-content shortfalls from FY 2025-26 (food contact) may be carried for up to three years, clearing at least one-third a year (G.S.R. 237(E), 31 March 2026).',
  },
  in_ewaste: {
    name: 'India — e-waste (E-Waste (Management) Rules, 2022)', short: 'E-waste', jurisdiction: 'India', authority: 'CPCB',
    source: 'https://eprewastecpcb.in/', period: 'india_fy', units: 'tonnes of EEE',
    categories: { itew: 'IT and telecommunication equipment', ce: 'Consumer electrical and electronics, PV panels', lsee: 'Large and small electrical and electronic equipment', tools: 'Electrical and electronic tools', toys: 'Toys, leisure and sports equipment', medical: 'Medical devices', lab: 'Laboratory instruments', other: 'Other EEE (Schedule I)' },
    base: 'lag_life',     // EEE placed on the market one average life earlier
    target: (y) => step([[2024, 60], [2026, 70], [2028, 80]], y),
    purchaseCap: false, carryYears: 3, returnDue: (y) => iso(y, 6, 30), returnNote: 'Annual return by 30 June; quarterly returns on the portal',
    notes: 'Target = estimated e-waste generation (EEE placed on the market one average life earlier) × 60% (FY 2023-24, 2024-25), 70% (FY 2025-26, 2026-27), 80% (from FY 2027-28). Met with EPR certificates from registered recyclers; refurbishing certificates defer the obligation. Certificate prices banded 30–100% of the environmental compensation (2024 amendment; under challenge in the Delhi High Court).',
  },
  in_battery: {
    name: 'India — batteries (Battery Waste Management Rules, 2022)', short: 'Batteries', jurisdiction: 'India', authority: 'CPCB',
    source: 'https://eprbattery.cpcb.gov.in/', period: 'india_fy', units: 'tonnes of batteries',
    categories: { portable: 'Portable', automotive: 'Automotive', industrial: 'Industrial', ev: 'Electric vehicle' },
    base: 'lag_life',
    target: () => null,   // the portal sets each producer's target from its sales history: typed
    recycledContent: (y, c) => (c === 'portable' || c === 'ev' ? step([[2028, 5], [2029, 10], [2030, 15], [2031, 20]], y) : step([[2025, 35], [2027, 40]], y)),
    purchaseCap: true, carryYears: 3, returnDue: (y) => iso(y, 6, 30), returnNote: 'Annual return by 30 June',
    notes: 'The target is set on the CPCB portal from the quantity placed on the market in earlier years: type the target % (or the obligation in tonnes) the portal shows. Certificates bought may cover the current liability, any carried liability and 10% more. Domestic recycled content (dry weight): portable and EV 5% FY 2027-28 rising to 20% from FY 2030-31; automotive and industrial 35% rising to 40%.',
  },
  in_tyre: {
    name: 'India — waste tyres (Hazardous and Other Wastes Rules, Schedule IX)', short: 'Tyres', jurisdiction: 'India', authority: 'CPCB',
    source: 'https://eprtyres.cpcb.gov.in/', period: 'india_fy', units: 'tonnes of new tyres',
    categories: { new: 'New tyres placed on the market (producer or importer)', imported_waste: 'Waste tyres imported' },
    base: 'lag_two',      // quantity placed on the market two years earlier (imported waste tyres: the year before)
    target: (y) => step([[2023, 35], [2024, 70], [2025, 100]], y),
    certValidityYears: 2, purchaseCap: true, carryYears: 3, returnDue: (y) => iso(y, 6, 30), returnNote: 'Annual return by 30 June (dates extended by CPCB notice each cycle)',
    notes: 'Target 35% FY 2022-23, 70% FY 2023-24, 100% from FY 2024-25, of the weight placed on the market two years earlier (less the wear-and-tear factor set by CPCB). Certificates weighted by end product (reclaimed rubber 1.3, crumb rubber 1.25, CRMB 1.1, recovered carbon black 1.0, pyrolysis oil and char 0.8 continuous / 0.5 batch), valid two years after the year they are generated in. Up to the liability + carried + 10% may be bought. Compensation is refunded 85% / 60% / 30% if the obligation is met within one / two / three years.',
  },
  eu_ppwr: {
    name: 'EU — packaging (Regulation (EU) 2025/40, PPWR)', short: 'EU packaging (PPWR)', jurisdiction: 'EU member state', authority: 'National EPR register of each member state',
    source: 'https://eur-lex.europa.eu/eli/reg/2025/40/oj', period: 'calendar', units: 'tonnes of packaging',
    categories: PPWR_MATERIALS,
    base: 'same_year',
    target: () => null,   // EPR is a fee per tonne paid to the producer responsibility organisation, not a tonnage target
    recycledContent: (y, c) => (PPWR_RC[c] ? (y >= 2040 ? PPWR_RC[c]![1] : y >= 2030 ? PPWR_RC[c]![0] : null) : null),
    carryYears: 0, returnDue: () => null, returnNote: 'Registration in each member state where packaging is made available (from 12 August 2026); quantity reporting on the national schedule',
    notes: 'From 12 August 2026: registration with the producer register of each member state where packaging is first made available, EPR through a producer responsibility organisation (fees per tonne by material, modulated by recyclability), labelling by 12 August 2028, recyclability grade C or better from 2030 (A or B from 2038). Minimum recycled content in plastic packaging from 1 January 2030 (2040): contact-sensitive PET 30% (50%), other contact-sensitive 10% (25%), single-use beverage bottles 30% (65%), other plastic 35% (65%).',
  },
  other: {
    name: 'Other scheme (typed)', short: 'Other scheme', jurisdiction: '', authority: '', source: '', period: 'calendar', units: 'tonnes',
    categories: { packaging: 'Packaging', eee: 'Electrical and electronic equipment', batteries: 'Batteries', tyres: 'Tyres', oil: 'Lubricating oil', textiles: 'Textiles', other: 'Other' },
    base: 'same_year', target: () => null, carryYears: 0, returnDue: () => null, returnNote: 'As the scheme sets',
    notes: 'For schemes not in the library — e.g. the UAE framework announced by the Ministry of Climate Change and Environment for packaging, electronics and batteries (pilot with Tadweer, 2025–2026). Type the target % or the obligation, and the dates, as the scheme sets them.',
  },
};

export function periodLabel(regime: Regime, y: number) {
  return REGIMES[regime].period === 'india_fy' ? `FY ${y - 1}-${String(y % 100).padStart(2, '0')}` : String(y);
}

export interface StreamSettings {
  regime: Regime; role: Role; category: string; avgLife: number | null;        // years (e-waste, batteries)
  targetPct: Record<string, number>;          // year → obligation % typed (overrides the library)
  recyclingPct: Record<string, number>;       // year → recycling share typed
  rcPct: Record<string, number>;              // year → recycled content % typed
  ecRate: number | null;                      // environmental compensation per tonne of shortfall
  certPrice: number | null;                   // assumed certificate price per tonne
  feeRate: number | null;                     // EU: PRO fee per tonne
  foodContact: boolean;                       // plastic: food-contact packaging (recycled-content carry-forward)
}
export interface YearRow {
  year: number; placed: number | null; preConsumer: number | null; suppliedToPibo: number | null;   // tonnes
  recycledTonnes: number | null;              // recycled content in what was placed (tonnes)
  obligationTyped: number | null;             // the obligation as shown on the portal (replaces the calculation)
}
export interface Cert { id?: string; year: number | null; kind: CertKind; direction: 'in' | 'out'; tonnes: number; price: number | null; generatedYear: number | null }

const pick = (m: Record<string, number>, y: number) => (m[String(y)] ?? null);
/** The base quantity of a year under the regime's rule. */
export function baseOf(s: StreamSettings, rows: Map<number, YearRow>, y: number): { base: number | null; from: string } {
  const R = REGIMES[s.regime];
  const q = (yy: number) => { const r = rows.get(yy); if (!r || r.placed == null) return null; return r.placed + (r.preConsumer ?? 0) - (r.suppliedToPibo ?? 0); };
  const label = (yy: number) => periodLabel(s.regime, yy);
  const b = s.category === 'imported_waste' ? 'prev_year' : R.base;
  if (b === 'same_year') return { base: q(y), from: label(y) };
  if (b === 'prev_year') return { base: q(y - 1), from: label(y - 1) };
  if (b === 'lag_two') return { base: q(y - 2), from: label(y - 2) };
  if (b === 'lag_life') { const L = Math.max(0, Math.round(s.avgLife ?? 0)); return s.avgLife == null ? { base: null, from: 'average life not set' } : { base: q(y - L), from: label(y - L) }; }
  const a = q(y - 1), c = q(y - 2);
  if (a == null && c == null) return { base: null, from: `${label(y - 2)} and ${label(y - 1)}` };
  const xs = [a, c].filter((v): v is number => v != null);
  return { base: xs.reduce((t, v) => t + v, 0) / xs.length, from: xs.length === 2 ? `average of ${label(y - 2)} and ${label(y - 1)}` : `${a != null ? label(y - 1) : label(y - 2)} only` };
}

export interface Position {
  year: number; label: string; base: number | null; baseFrom: string; targetPct: number | null; obligation: number | null; typed: boolean;
  carriedIn: number; required: number | null; recyclingPct: number | null; recyclingMin: number | null;
  met: number; metRecycling: number; metOther: number; shortfall: number | null; recyclingShortfall: number | null;
  ecExposure: number | null; costToClose: number | null; overCap: boolean; forfeited: number;
  rcPct: number | null; rcRequired: number | null; rcActual: number | null; rcShortfall: number | null;
  rcCarried: number | null; rcBehind: number | null;   // plastic, food contact: FY 2025-26 shortfall still carried, and how far behind the one-third-a-year schedule
  stockIn: number; stockOut: number;          // recyclers: generated and sold in the year
  warnings: string[];
}

/** Year-by-year position from the first year with data to `to`: obligation, certificates applied, shortfall carried. */
export function positions(s: StreamSettings, rowList: YearRow[], certs: Cert[], to: number): Position[] {
  const R = REGIMES[s.regime];
  const rows = new Map(rowList.map((r) => [r.year, r]));
  const years = [...rows.keys(), ...certs.map((c) => c.year).filter((y): y is number => y != null)];
  if (!years.length) return [];
  const from = Math.min(...years);
  const out: Position[] = [];
  const carried: { year: number; t: number }[] = [];   // shortfalls still carried, oldest first
  let rcCarry: { orig: number; left: number } | null = null;
  for (let y = from; y <= to; y++) {
    const w: string[] = [];
    const row = rows.get(y);
    const { base, from: baseFrom } = baseOf(s, rows, y);
    const tPct = pick(s.targetPct, y) ?? R.target(y, s.category);
    const typed = row?.obligationTyped != null;
    const obligation = s.role === 'recycler' ? null : typed ? row!.obligationTyped! : base != null && tPct != null ? (base * tPct) / 100 : null;
    if (s.role !== 'recycler' && obligation == null && R.target(y, s.category) == null && tPct == null && s.regime !== 'eu_ppwr' && (row || base != null)) w.push('Type the target % or the obligation shown on the portal');
    // carried shortfalls older than the regime allows are forfeited (compensation is final)
    let forfeited = 0;
    while (carried.length && R.carryYears > 0 && y - carried[0]!.year > R.carryYears) forfeited += carried.shift()!.t;
    if (R.carryYears === 0) carried.length = 0;
    const carriedIn = carried.reduce((t, c) => t + c.t, 0);
    const required = obligation == null ? (carriedIn ? carriedIn : null) : obligation + carriedIn;
    const rPct = pick(s.recyclingPct, y) ?? R.recyclingShare?.(y, s.category) ?? null;
    const recyclingMin = obligation != null && rPct != null ? (obligation * rPct) / 100 : null;
    const mine = certs.filter((c) => c.year === y && c.direction === 'in');
    const counts = mine.filter((c) => c.kind === 'recycling' || c.kind === 'eol' || c.kind === 'refurbish' || c.kind === 'reuse');
    const metRecycling = counts.filter((c) => c.kind === 'recycling').reduce((t, c) => t + c.tonnes, 0);
    const met = counts.reduce((t, c) => t + c.tonnes, 0);
    // validity: certificates used after they lapse do not count
    if (R.certValidityYears) for (const c of counts) if (c.generatedYear != null && y > c.generatedYear + R.certValidityYears) w.push(`A certificate generated in ${periodLabel(s.regime, c.generatedYear)} lapsed before ${periodLabel(s.regime, y)}`);
    const overCap = !!R.purchaseCap && required != null && met > required + (obligation ?? 0) * 0.1 + 1e-9;
    if (overCap) w.push('More certificates than the liability + carried + 10% the rules allow');
    let shortfall: number | null = null, recyclingShortfall: number | null = null;
    if (s.role !== 'recycler' && required != null) {
      // certificates clear the oldest carried shortfall first, then the year's own obligation
      let left = met;
      for (const c of carried) { const use = Math.min(left, c.t); c.t -= use; left -= use; }
      const ownLeft = Math.max(0, (obligation ?? 0) - left);
      for (let i = carried.length - 1; i >= 0; i--) if (carried[i]!.t <= 1e-9) carried.splice(i, 1);
      if (ownLeft > 1e-9 && R.carryYears > 0) carried.push({ year: y, t: ownLeft });
      shortfall = carried.reduce((t, c) => t + c.t, 0) + (R.carryYears > 0 ? 0 : ownLeft);
      recyclingShortfall = recyclingMin != null ? Math.max(0, recyclingMin - metRecycling) : null;
      if (shortfall < 1e-9) shortfall = 0;
    }
    // recycled content: required share of what was placed this year
    const rcPct = pick(s.rcPct, y) ?? R.recycledContent?.(y, s.category) ?? null;
    const rcRequired = rcPct != null && row?.placed != null ? (row.placed * rcPct) / 100 : null;
    const rcActual = row?.recycledTonnes ?? null;
    const rcIn = mine.filter((c) => c.kind === 'recycled_content').reduce((t, c) => t + c.tonnes, 0);   // importers: certificates from surplus PIBOs
    let rcShortfall: number | null = rcRequired != null ? Math.max(0, rcRequired - (rcActual ?? 0) - rcIn) : null;
    if (rcShortfall != null && rcShortfall < 1e-9) rcShortfall = 0;
    let rcCarried: number | null = null, rcBehind: number | null = null;
    if (s.regime === 'in_plastic' && s.foodContact) {
      // G.S.R. 237(E): the FY 2025-26 shortfall may be carried for up to three years from FY 2026-27, at least one-third cleared each year
      if (y === 2026 && rcShortfall) { rcCarry = { orig: rcShortfall, left: rcShortfall }; rcShortfall = 0; rcCarried = rcCarry.left; }
      else if (rcCarry && y >= 2027 && y <= 2029) {
        const surplus = rcRequired != null ? Math.max(0, (rcActual ?? 0) + rcIn - rcRequired) : 0;
        rcCarry.left = Math.max(0, rcCarry.left - surplus);
        rcCarried = rcCarry.left;
        rcBehind = Math.max(0, rcCarry.left - rcCarry.orig * (1 - (y - 2026) / 3));
        if (rcBehind < 1e-9) rcBehind = 0;
        if (rcBehind) w.push(`Recycled content: ${rcBehind.toFixed(1)} t behind the one-third-a-year schedule for the FY 2025-26 shortfall`);
        if (y === 2029 && rcCarry.left > 1e-9) { rcShortfall = (rcShortfall ?? 0) + rcCarry.left; rcCarry = null; }
      }
    }
    const stockIn = certs.filter((c) => c.year === y && c.direction === 'in' && s.role === 'recycler').reduce((t, c) => t + c.tonnes, 0);
    const stockOut = certs.filter((c) => c.year === y && c.direction === 'out').reduce((t, c) => t + c.tonnes, 0);
    out.push({
      year: y, label: periodLabel(s.regime, y), base, baseFrom, targetPct: tPct, obligation, typed, carriedIn, required, recyclingPct: rPct, recyclingMin,
      met, metRecycling, metOther: met - metRecycling, shortfall, recyclingShortfall,
      ecExposure: shortfall != null && s.ecRate != null ? shortfall * s.ecRate : null, costToClose: shortfall != null && s.certPrice != null ? shortfall * s.certPrice : null,
      overCap, forfeited, rcPct, rcRequired, rcActual, rcShortfall, rcCarried, rcBehind, stockIn, stockOut, warnings: w,
    });
  }
  // the first rows before any obligation (a lag) carry nothing: drop leading empty years
  while (out.length > 1 && out[0]!.obligation == null && out[0]!.met === 0 && !rows.get(out[0]!.year)) out.shift();
  return out;
}
