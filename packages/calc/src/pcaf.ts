/**
 * Financed emissions (EKOFIN): the emissions of the companies a bank or investor lends to and invests in,
 * attributed to it in proportion to what it has financed. PCAF Global GHG Accounting and Reporting Standard,
 * Part A (financed emissions), for the corporate asset classes:
 *
 *   listed equity, corporate bonds      attribution = outstanding ÷ EVIC
 *   business loans, unlisted equity     attribution = outstanding ÷ (total equity + total debt);
 *                                       EVIC when the company is listed
 *
 *   financed emissions = attribution × the company's emissions
 *
 * The company's emissions come from the best layer available (PCAF data quality score, 1 best … 5 worst):
 *
 *   1  verified reported emissions                       (survey, sustainability report with assurance)
 *   2  unverified reported emissions                     (survey, annual report, CDP)
 *   3  physical activity × emission factor               (energy use or production, calculated)
 *   4  revenue × sector emission factor (per million)    (economic activity)
 *   5  outstanding × sector emission factor per million of assets (no company data at all)
 *
 * Layer 5 needs no attribution: it estimates the financed share directly.
 * Scope 1 and 2 are added together (PCAF reports them as one figure); Scope 3 is kept apart.
 * All money here is in one currency (the portfolio's reporting currency); the caller converts first.
 * Pure functions: no database, no I/O.
 */

export type AssetClass = 'listed_equity' | 'corporate_bond' | 'business_loan' | 'unlisted_equity';
export const ASSET_CLASSES: Record<AssetClass, string> = {
  listed_equity: 'Listed equity', corporate_bond: 'Corporate bonds', business_loan: 'Business loans', unlisted_equity: 'Unlisted equity',
};
export type PcafScore = 1 | 2 | 3 | 4 | 5;
export const SCORE_LABEL: Record<PcafScore, string> = {
  1: 'Verified reported emissions', 2: 'Unverified reported emissions', 3: 'Physical activity × emission factor',
  4: 'Revenue × sector emission factor', 5: 'Assets × sector emission factor',
};

export interface Scopes { s1: number; s2: number; s3: number | null }
/** Company figures for one financial year, in the reporting currency. */
export interface CompanyFinancials { year: number; evic: number | null; equity: number | null; debt: number | null; revenue: number | null; totalAssets: number | null }
/** Emissions the company reported or that were calculated from its activity data (tCO2e). */
export interface ReportedEmissions { year: number; score: 1 | 2 | 3; s1: number; s2: number; s3: number | null; source: string }
/** tCO2e per million of the reporting currency, per unit of revenue or of total assets. */
export interface SectorFactor { basis: 'revenue' | 'assets'; s1: number; s2: number; s3: number | null; label: string; year: number }

export interface HoldingInput {
  id: string;
  assetClass: AssetClass;
  /** outstanding amount at the reporting date (reporting currency) */
  outstanding: number;
  listed: boolean;
  financials: CompanyFinancials | null;
  /** every reported or calculated figure on record; the best one is used */
  reported: ReportedEmissions[];
  revenueFactor: SectorFactor | null;
  assetFactor: SectorFactor | null;
  /** use this layer instead of the best one (an override, recorded with a reason by the caller) */
  forceScore?: PcafScore | null;
  /** year of the reporting date: older data is flagged */
  reportYear: number;
}

export interface HoldingResult {
  id: string;
  attribution: number | null;
  denominator: { kind: 'evic' | 'equity_debt' | 'none'; value: number | null };
  score: PcafScore | null;
  /** the company's emissions used (tCO2e); null for layer 5, which estimates the financed share directly */
  company: Scopes | null;
  /** financed emissions (tCO2e); total = Scope 1 + 2 */
  financed: (Scopes & { total: number }) | null;
  /** layers that could be calculated for this holding */
  available: PcafScore[];
  steps: string[];
  warnings: string[];
}

const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : x.toLocaleString('en-GB', { maximumSignificantDigits: 4 }));
const pct = (x: number) => `${(x * 100).toLocaleString('en-GB', { maximumSignificantDigits: 3 })}%`;
const pos = (x: number | null | undefined): x is number => x != null && Number.isFinite(x) && x > 0;

/** The attribution factor: outstanding ÷ EVIC, or ÷ (equity + debt). Capped at 1. */
export function attribution(h: Pick<HoldingInput, 'assetClass' | 'outstanding' | 'listed' | 'financials'>): { factor: number | null; kind: 'evic' | 'equity_debt' | 'none'; value: number | null; steps: string[]; warnings: string[] } {
  const steps: string[] = [], warnings: string[] = [];
  const f = h.financials;
  const eqDebt = f && (f.equity != null || f.debt != null) ? (f.equity ?? 0) + (f.debt ?? 0) : null;
  const wantsEvic = h.listed;
  let kind: 'evic' | 'equity_debt' | 'none' = 'none', value: number | null = null;
  if (wantsEvic && pos(f?.evic)) { kind = 'evic'; value = f!.evic; }
  else if (pos(eqDebt)) {
    kind = 'equity_debt'; value = eqDebt;
    if (wantsEvic) warnings.push('Listed company without EVIC: total equity + debt used instead');
    if (f!.equity == null) warnings.push('Total equity missing: only total debt used as the denominator');
    if (f!.debt == null) warnings.push('Total debt missing: only total equity used as the denominator');
  } else if (!wantsEvic && pos(f?.evic)) { kind = 'evic'; value = f!.evic; warnings.push('Unlisted company: EVIC used because equity and debt are missing'); }
  if (h.assetClass === 'listed_equity' && !h.listed) warnings.push('Listed equity in a company marked as not listed');
  if (value == null) return { factor: null, kind, value, steps, warnings };
  let factor = h.outstanding / value;
  steps.push(`Attribution = outstanding ${fmt(h.outstanding)} ÷ ${kind === 'evic' ? 'EVIC' : 'total equity + debt'} ${fmt(value)} = ${pct(factor)}${f ? ` (FY ${f.year})` : ''}`);
  if (factor > 1) { warnings.push(`Outstanding is more than the ${kind === 'evic' ? 'EVIC' : 'equity + debt'}: attribution capped at 100%`); factor = 1; }
  return { factor, kind, value, steps, warnings };
}

const times = (s: Scopes, k: number): Scopes => ({ s1: s.s1 * k, s2: s.s2 * k, s3: s.s3 == null ? null : s.s3 * k });
const withTotal = (s: Scopes) => ({ ...s, total: s.s1 + s.s2 });

/** Financed emissions of one holding, from the best layer available (or the forced one). */
export function financedEmissions(h: HoldingInput): HoldingResult {
  const a = attribution(h);
  const steps = [...a.steps], warnings = [...a.warnings];
  const f = h.financials;
  // best reported figure per score: newest year first
  const best = new Map<1 | 2 | 3, ReportedEmissions>();
  for (const r of [...h.reported].sort((x, y) => x.score - y.score || y.year - x.year)) if (!best.has(r.score)) best.set(r.score, r);
  const available: PcafScore[] = [];
  if (a.factor != null) {
    for (const s of [1, 2, 3] as const) if (best.has(s)) available.push(s);
    if (pos(f?.revenue) && h.revenueFactor) available.push(4);
  } else if (best.size) warnings.push('Emissions are on record but there is no EVIC or equity + debt to attribute them: add the company\'s financials');
  if (h.assetFactor && h.outstanding > 0) available.push(5);

  let score: PcafScore | null = available[0] ?? null;
  if (h.forceScore) {
    if (available.includes(h.forceScore)) { if (h.forceScore !== score) steps.push(`Layer chosen by a user: score ${h.forceScore} instead of ${score}`); score = h.forceScore; }
    else warnings.push(`Score ${h.forceScore} was chosen but cannot be calculated for this holding; the best available layer is used`);
  }
  const res: HoldingResult = { id: h.id, attribution: a.factor, denominator: { kind: a.kind, value: a.value }, score, company: null, financed: null, available, steps, warnings };
  if (score == null) {
    warnings.push(!h.revenueFactor && !h.assetFactor ? 'No sector emission factor for this company\'s sector: add the sector code or a factor' : 'Not enough data: add reported emissions, or revenue and financials');
    return res;
  }
  if (score <= 3) {
    const r = best.get(score as 1 | 2 | 3)!;
    res.company = { s1: r.s1, s2: r.s2, s3: r.s3 };
    steps.push(`Company emissions ${r.year} (${SCORE_LABEL[score]}, ${r.source}): Scope 1 ${fmt(r.s1)} t, Scope 2 ${fmt(r.s2)} t${r.s3 != null ? `, Scope 3 ${fmt(r.s3)} t` : ''}`);
    if (r.year < h.reportYear - 2) warnings.push(`Reported emissions are from ${r.year}`);
    if (f && Math.abs(f.year - r.year) > 1) warnings.push(`Financials (FY ${f.year}) and emissions (${r.year}) are from different years`);
  } else if (score === 4) {
    const ef = h.revenueFactor!, m = f!.revenue! / 1e6;
    res.company = times(ef, m);
    steps.push(`Company emissions = revenue ${fmt(f!.revenue!)} = ${fmt(m)} million × sector factor (${ef.label}): Scope 1 ${fmt(ef.s1)}, Scope 2 ${fmt(ef.s2)}${ef.s3 != null ? `, Scope 3 ${fmt(ef.s3)}` : ''} t per million = ${fmt(res.company.s1 + res.company.s2)} t Scope 1+2`);
  }
  if (score <= 4) {
    res.financed = withTotal(times(res.company!, a.factor!));
    steps.push(`Financed = ${pct(a.factor!)} × company = ${fmt(res.financed.total)} t Scope 1+2${res.financed.s3 != null ? `, ${fmt(res.financed.s3)} t Scope 3` : ''}`);
  } else {
    const ef = h.assetFactor!, m = h.outstanding / 1e6;
    res.financed = withTotal(times(ef, m));
    steps.push(`Financed = outstanding ${fmt(m)} million × sector factor per million of assets (${ef.label}): ${fmt(ef.s1 + ef.s2)} t per million = ${fmt(res.financed.total)} t Scope 1+2`);
  }
  if (f && f.year < h.reportYear - 2) warnings.push(`Financials are from FY ${f.year}`);
  return res;
}

// ---------------------------------------------------------------- portfolio --

export interface PortfolioLine { id: string; name: string; assetClass: AssetClass; sector: string | null; outstanding: number; revenue: number | null; result: HoldingResult }
export interface Bucket { key: string; holdings: number; outstanding: number; financed: number; s3: number }
export interface PortfolioSummary {
  holdings: number; outstanding: number;
  /** tCO2e, Scope 1+2 and Scope 3 */
  financed: { s1: number; s2: number; total: number; s3: number; s3Holdings: number };
  /** share of outstanding with any result, and with reported or activity-based data (score 1–3) */
  coverage: { any: number; reported: number };
  /** tCO2e Scope 1+2 per million outstanding (of holdings with a result) */
  intensity: number | null;
  /** weighted average carbon intensity: Σ weight × company Scope 1+2 ÷ revenue (million); with the share of outstanding it covers */
  waci: { value: number | null; coverage: number };
  /** PCAF data quality score weighted by outstanding (holdings with a result) */
  score: number | null;
  byScore: Bucket[]; byAssetClass: Bucket[]; bySector: Bucket[];
  top: { id: string; name: string; sector: string | null; outstanding: number; financed: number; share: number; score: PcafScore | null }[];
  missing: number;
}

function bucket(lines: PortfolioLine[], key: (l: PortfolioLine) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const l of lines) {
    const k = key(l);
    const b = m.get(k) ?? { key: k, holdings: 0, outstanding: 0, financed: 0, s3: 0 };
    b.holdings++; b.outstanding += l.outstanding; b.financed += l.result.financed?.total ?? 0; b.s3 += l.result.financed?.s3 ?? 0;
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.financed - a.financed || b.outstanding - a.outstanding);
}

export function summarise(lines: PortfolioLine[], topN = 10): PortfolioSummary {
  const outstanding = lines.reduce((a, l) => a + l.outstanding, 0);
  const done = lines.filter((l) => l.result.financed);
  const doneOut = done.reduce((a, l) => a + l.outstanding, 0);
  const fin = { s1: 0, s2: 0, total: 0, s3: 0, s3Holdings: 0 };
  for (const l of done) { const r = l.result.financed!; fin.s1 += r.s1; fin.s2 += r.s2; fin.total += r.total; if (r.s3 != null) { fin.s3 += r.s3; fin.s3Holdings++; } }
  const reportedOut = done.filter((l) => (l.result.score ?? 9) <= 3).reduce((a, l) => a + l.outstanding, 0);
  // WACI: companies with emissions and revenue
  const w = lines.filter((l) => l.result.company && pos(l.revenue));
  const wOut = w.reduce((a, l) => a + l.outstanding, 0);
  const waci = wOut > 0 ? w.reduce((a, l) => a + (l.outstanding / wOut) * ((l.result.company!.s1 + l.result.company!.s2) / (l.revenue! / 1e6)), 0) : null;
  const scored = done.filter((l) => l.result.score != null);
  const scoredOut = scored.reduce((a, l) => a + l.outstanding, 0);
  return {
    holdings: lines.length, outstanding, financed: fin,
    coverage: { any: outstanding ? doneOut / outstanding : 0, reported: outstanding ? reportedOut / outstanding : 0 },
    intensity: doneOut > 0 ? fin.total / (doneOut / 1e6) : null,
    waci: { value: waci, coverage: outstanding ? wOut / outstanding : 0 },
    score: scoredOut > 0 ? scored.reduce((a, l) => a + l.result.score! * l.outstanding, 0) / scoredOut : null,
    byScore: bucket(lines, (l) => (l.result.score ? String(l.result.score) : 'none')).sort((a, b) => a.key.localeCompare(b.key)),
    byAssetClass: bucket(lines, (l) => l.assetClass),
    bySector: bucket(lines, (l) => l.sector ?? 'Unclassified'),
    top: [...done].sort((a, b) => b.result.financed!.total - a.result.financed!.total).slice(0, topN)
      .map((l) => ({ id: l.id, name: l.name, sector: l.sector, outstanding: l.outstanding, financed: l.result.financed!.total, share: fin.total ? l.result.financed!.total / fin.total : 0, score: l.result.score })),
    missing: lines.length - done.length,
  };
}
