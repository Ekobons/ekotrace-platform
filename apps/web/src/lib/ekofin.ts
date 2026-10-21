/**
 * EKOFIN (financed emissions): API calls, types and formatting shared by its screens.
 */
import { call, download } from './api';

export type AssetClass = 'listed_equity' | 'corporate_bond' | 'business_loan' | 'unlisted_equity';
export type Score = 1 | 2 | 3 | 4 | 5;
export interface Scopes { s1: number; s2: number; s3: number | null }
export interface HoldingResult {
  id: string; attribution: number | null; denominator: { kind: 'evic' | 'equity_debt' | 'none'; value: number | null }; score: Score | null;
  company: Scopes | null; financed: (Scopes & { total: number }) | null; available: Score[]; steps: string[]; warnings: string[];
}
export interface FinLine {
  id: string; counterpartyId: string; name: string; country: string | null; listed: boolean; sector: string | null; sectorCode: string | null; sectorGroup: string; assetClass: AssetClass;
  outstanding: number; outstandingOrig: number; currency: string; internalRef: string | null; forceScore: Score | null; forceReason: string | null; revenue: number | null;
  financialYear: number | null; result: HoldingResult; excluded: string | null;
}
export interface Bucket { key: string; holdings: number; outstanding: number; financed: number; s3: number }
export interface FinSummary {
  holdings: number; outstanding: number; financed: { s1: number; s2: number; total: number; s3: number; s3Holdings: number };
  coverage: { any: number; reported: number }; intensity: number | null; waci: { value: number | null; coverage: number }; score: number | null;
  byScore: Bucket[]; byAssetClass: Bucket[]; bySector: Bucket[];
  top: { id: string; name: string; sector: string | null; outstanding: number; financed: number; share: number; score: Score | null }[]; missing: number;
}
export interface FinPeriodData {
  period: { id: string; asOf: string; status: 'draft' | 'locked'; note: string; lockedName: string | null; lockedAt: string | null };
  portfolio: { id: string; name: string; kind: string; currency: string; factorLibrary: string | null; includeScope3: boolean };
  lines: FinLine[]; summary: FinSummary; warnings: string[]; computedAt: string; locked: boolean;
}
export interface FinPeriod { id: string; portfolio_id: string; as_of: string; status: 'draft' | 'locked'; locked_name: string | null; locked_at: string | null; holdings: number; locked_total: number | null }
export interface FinPortfolio { id: string; name: string; kind: string; currency: string; factor_library: string | null; include_scope3: boolean; description: string; archived: boolean; created_name: string | null; created_at: string; periods: FinPeriod[] }
export interface FinLibrary { library: string; n: number; from_year: number; to_year: number; standards: string[]; bases?: string[]; loaded_at?: string }
export interface FinMeta {
  assetClasses: Record<AssetClass, string>; scores: Record<Score, string>; kinds: Record<string, string>; standards: string[]; libraries: FinLibrary[];
  canEdit: boolean; canLock: boolean; canUnlock: boolean; canManage: boolean; canLayer: boolean; canFactors: boolean;
}
export interface Counterparty {
  id: string; name: string; country: string | null; lei: string | null; isin: string | null; local_id: string | null; listed: boolean; sector_standard: string; sector_code: string | null; sector_name: string | null;
  holdings?: number; fin_year?: number | null; best_score?: number | null; em_year?: number | null; contact_email?: string | null; note?: string;
}
export interface Financials { id: string; year: number; currency: string; evic: number | null; equity: number | null; debt: number | null; revenue: number | null; total_assets: number | null; source: string; updated_name: string | null; updated_at: string }
export interface EmissionRec { id: string; year: number; score: 1 | 2 | 3; s1: number; s2: number; s3: number | null; source: string; note: string; document_id: string | null; document: string | null; created_name: string | null; created_at: string }
export interface FactorRow { id?: number; library?: string; sector_standard: string; sector_code: string; sector_name: string | null; region: string; year: number; basis: 'revenue' | 'assets'; currency: string; s1: number; s2: number; s3: number | null; source: string; note?: string | null }
export interface CounterpartyProfile {
  counterparty: Counterparty; financials: Financials[]; emissions: EmissionRec[]; factors: FactorRow[]; documents: { id: string; name: string }[];
  holdings: { id: string; asset_class: AssetClass; outstanding: number; currency: string; internal_ref: string | null; force_score: number | null; portfolio_id: string; portfolio: string; period_id: string; as_of: string; status: string }[];
}
export interface ImportResult {
  committed: boolean; mode: 'add' | 'replace'; columns: Record<string, string>; totals: { rows: number; match: number; new: number; error: number };
  saved: { holdings: number; counterparties: number; financials: number; emissions: number }; rows: { row: number; name: string; action: 'match' | 'new' | 'error'; detail: string }[];
}
export interface CounterpartyBody { name: string; country: string | null; lei: string | null; isin: string | null; localId: string | null; listed: boolean; sectorStandard: string; sectorCode: string | null; sectorName: string | null; contactEmail: string | null; note: string }
export interface HoldingBody { counterpartyId: string; assetClass: AssetClass; outstanding: number; currency: string; internalRef: string | null; origination: string | null; note: string }
export interface PortfolioBody { name: string; kind: string; currency: string; factorLibrary: string | null; includeScope3: boolean; description: string; archived?: boolean }

const fileHeaders = (f: File) => ({ 'x-filename': encodeURIComponent(f.name) });
export const fin = {
  meta: () => call<FinMeta>('GET', '/api/fin/meta'),
  portfolios: () => call<{ portfolios: FinPortfolio[] }>('GET', '/api/fin/portfolios'),
  savePortfolio: (b: PortfolioBody, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/fin/portfolios/${id}` : '/api/fin/portfolios', b),
  deletePortfolio: (id: string) => call<{ ok: true }>('DELETE', `/api/fin/portfolios/${id}`),
  addPeriod: (portfolioId: string, b: { asOf: string; copyFrom?: string | null; note?: string }) => call<{ id: string; copied: number }>('POST', `/api/fin/portfolios/${portfolioId}/periods`, b),
  period: (id: string) => call<FinPeriodData>('GET', `/api/fin/periods/${id}`),
  deletePeriod: (id: string) => call<{ ok: true }>('DELETE', `/api/fin/periods/${id}`),
  lock: (id: string) => call<{ ok: true }>('POST', `/api/fin/periods/${id}/lock`),
  unlock: (id: string, reason: string) => call<{ ok: true }>('POST', `/api/fin/periods/${id}/unlock`, { reason }),
  exportPeriod: (id: string, name: string) => download(`/api/fin/periods/${id}/export`, name),
  addHolding: (periodId: string, b: HoldingBody) => call<{ id: string }>('POST', `/api/fin/periods/${periodId}/holdings`, b),
  saveHolding: (id: string, b: HoldingBody) => call<{ ok: true }>('PUT', `/api/fin/holdings/${id}`, b),
  deleteHolding: (id: string) => call<{ ok: true }>('DELETE', `/api/fin/holdings/${id}`),
  setLayer: (id: string, score: Score | null, reason = '') => call<{ ok: true }>('PUT', `/api/fin/holdings/${id}/layer`, { score, reason }),
  importBook: (periodId: string, f: File, commit: boolean, mode: 'add' | 'replace') => call<ImportResult>('POST', `/api/fin/periods/${periodId}/import?commit=${commit ? 1 : 0}&mode=${mode}`, undefined, f, fileHeaders(f)),
  template: () => download('/api/fin/import-template', 'ekofin-holdings-template.xlsx'),
  counterparties: (q?: string) => call<{ counterparties: Counterparty[] }>('GET', `/api/fin/counterparties${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  counterparty: (id: string) => call<CounterpartyProfile>('GET', `/api/fin/counterparties/${id}`),
  saveCounterparty: (b: CounterpartyBody, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/fin/counterparties/${id}` : '/api/fin/counterparties', b),
  deleteCounterparty: (id: string) => call<{ ok: true }>('DELETE', `/api/fin/counterparties/${id}`),
  saveFinancials: (id: string, b: { year: number; currency: string; evic: number | null; equity: number | null; debt: number | null; revenue: number | null; totalAssets: number | null; source: string }) =>
    call<{ id: string }>('PUT', `/api/fin/counterparties/${id}/financials`, b),
  deleteFinancials: (id: string) => call<{ ok: true }>('DELETE', `/api/fin/financials/${id}`),
  saveEmissions: (id: string, b: { year: number; score: 1 | 2 | 3; s1: number; s2: number; s3: number | null; source: string; documentId: string | null; note: string }) =>
    call<{ id: string }>('PUT', `/api/fin/counterparties/${id}/emissions`, b),
  deleteEmissions: (id: string) => call<{ ok: true }>('DELETE', `/api/fin/emissions/${id}`),
  factors: (library?: string) => call<{ libraries: FinLibrary[]; library: string | null; rows: FactorRow[]; canEdit: boolean }>('GET', `/api/fin/factors${library ? `?library=${encodeURIComponent(library)}` : ''}`),
  importFactors: (f: File, commit: boolean) => call<{ committed: boolean; rows: number; saved: number; errors: { row: number; detail: string }[]; libraries: string[] }>('POST', `/api/fin/factors/import?commit=${commit ? 1 : 0}`, undefined, f, fileHeaders(f)),
  factorTemplate: () => download('/api/fin/factors/template', 'ekofin-sector-factors-template.xlsx'),
  deleteLibrary: (name: string) => call<{ deleted: number }>('DELETE', `/api/fin/factors/library?name=${encodeURIComponent(name)}`),
};

// ------------------------------------------------------------- formatting --
/** tCO2e: no decimals from 100, else up to 2 significant decimals. */
export const tco2 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 1 ? 1 : 3 }));
/** Money in millions with one decimal (12.4m), or thousands below a million. */
export const money = (x: number | null | undefined, cur?: string) => {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  const s = a >= 1e9 ? `${(x / 1e9).toLocaleString('en-GB', { maximumFractionDigits: 2 })}bn` : a >= 1e6 ? `${(x / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })}m` : a >= 1e3 ? `${(x / 1e3).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k` : x.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  return cur ? `${cur} ${s}` : s;
};
export const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toLocaleString('en-GB', { maximumFractionDigits: x * 100 < 1 && x > 0 ? 2 : d })}%`);
export const fullAmount = (x: number | null | undefined) => (x == null ? '' : x.toLocaleString('en-GB', { maximumFractionDigits: 2 }));
/** Typed number ("12,500,000" or "12.5m") → number; blank → null; anything else → NaN. */
export function parseAmount(s: string): number | null {
  const t = s.trim().replace(/,/g, '').toLowerCase();
  if (!t) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*(k|m|mn|bn|b)?$/.exec(t);
  if (!m) return NaN;
  const k = m[2] === 'k' ? 1e3 : m[2] === 'm' || m[2] === 'mn' ? 1e6 : m[2] === 'bn' || m[2] === 'b' ? 1e9 : 1;
  return Number(m[1]) * k;
}

export const SCORE_SHORT: Record<Score, string> = { 1: 'Verified reported', 2: 'Reported', 3: 'Activity-based', 4: 'Revenue estimate', 5: 'Asset estimate' };
/** Score colours: green (1, best) to grey (5); the one place colour carries meaning in EKOFIN. */
export const SCORE_C: Record<Score, string> = { 1: '#0A6B57', 2: '#2BA38A', 3: '#86CDB4', 4: '#C9B98A', 5: '#9AA7A2' };
