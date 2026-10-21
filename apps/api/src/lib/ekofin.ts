/**
 * EKOFIN: loading a portfolio at a reporting date and running the PCAF engine (@ekotrace/calc pcaf.ts).
 *
 *   requireEkofin(c, tenant)     EKOFIN must be switched on for the company (platform console → products)
 *   computePeriod(c, periodId)   holdings + counterparties + financials + emissions + sector factors → results
 *
 * Money: outstanding amounts and company financials are converted to the portfolio's reporting currency
 * with the company's exchange rates (Currencies & price index) at the reporting date; sector factors per
 * million of their currency are converted the same way. A holding whose currency has no rate is left out
 * with a warning. Data used: the newest financial year and emissions year up to the reporting year.
 */
import { ASSET_CLASSES, chooseFx, financedEmissions, summarise, type AssetClass, type FxMethod, type FxRate, type HoldingResult, type PcafScore, type PortfolioSummary, type ReportedEmissions, type SectorFactor } from '@ekotrace/calc';
import type { Tx } from '../db/pool.js';
import { AppError, notFound } from './errors.js';

export const PRODUCTS = { ekotrace: 'EKOTRACE', ekofin: 'EKOFIN' } as const;
export type Product = keyof typeof PRODUCTS;

export async function requireEkofin(c: Tx, tenant: string) {
  const p = (await c.query(`SELECT products FROM tenant WHERE id = $1`, [tenant])).rows[0]?.products as string[] | undefined;
  if (!p?.includes('ekofin')) throw new AppError('EKOFIN is not switched on for this company. Contact the Ekobon team to add it.', 403, 'PRODUCT_OFF');
}

/** Name for matching: lower case, letters and digits, common legal forms removed. */
const LEGAL = /\b(ltd|limited|llc|l l c|plc|inc|incorporated|corp|corporation|co|company|pjsc|psc|pjs|sa|ag|gmbh|bv|nv|spa|srl|sas|pte|pvt|private|public|fze|fzco|fzc|fz llc|est|establishment|holding|holdings)\b/g;
export function normCompany(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
}

export interface FinLine {
  id: string; counterpartyId: string; name: string; country: string | null; listed: boolean;
  sector: string | null; sectorCode: string | null; sectorGroup: string; assetClass: AssetClass; outstanding: number; outstandingOrig: number; currency: string;
  internalRef: string | null; forceScore: PcafScore | null; forceReason: string | null; revenue: number | null;
  financialYear: number | null; result: HoldingResult; excluded: string | null;
}
export interface FinPeriodResult {
  period: { id: string; asOf: string; status: string; note: string; lockedName: string | null; lockedAt: string | null };
  portfolio: { id: string; name: string; kind: string; currency: string; factorLibrary: string | null; includeScope3: boolean };
  lines: FinLine[]; summary: PortfolioSummary; warnings: string[]; computedAt: string;
}

interface FactorRow { library: string; sector_standard: string; sector_code: string; sector_name: string | null; region: string; year: number; basis: 'revenue' | 'assets'; currency: string; s1: number; s2: number; s3: number | null; source: string }

/** The factor for a sector: longest matching code prefix, the company's country before GLOBAL, newest year up to the reporting year. */
export function pickFactor(rows: FactorRow[], std: string, code: string | null, country: string | null, basis: 'revenue' | 'assets', year: number): FactorRow | null {
  if (!code) return null;
  const c = code.toUpperCase().replace(/\s+/g, '');
  const cand = rows.filter((r) => r.basis === basis && r.sector_standard === std && c.startsWith(r.sector_code.toUpperCase().replace(/\s+/g, '')) && (r.region === 'GLOBAL' || r.region === country));
  if (!cand.length) return null;
  const rank = (r: FactorRow) => [r.sector_code.length, r.region === country ? 1 : 0, r.year <= year ? 1 : 0, r.year <= year ? r.year : -r.year] as const;
  return cand.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (y[i] as number) - (x[i] as number); return 0; })[0] ?? null;
}

export async function fxContext(c: Tx, tenant: string) {
  const rates = (await c.query(`SELECT currency, kind, to_char(period, 'YYYY-MM-DD') AS period, per_usd::float8 AS "perUsd", source FROM fx_rate ORDER BY (tenant_id IS NULL), period DESC`)).rows as FxRate[];
  const method = ((await c.query(`SELECT fx_method FROM tenant WHERE id = $1`, [tenant])).rows[0]?.fx_method ?? 'year') as FxMethod;
  /** units of the reporting currency for one unit of `cur` on the date; null without a rate */
  return (cur: string, rep: string, date: string): number | null => {
    if (cur.toUpperCase() === rep.toUpperCase()) return 1;
    const a = chooseFx(rates, cur, date, method), b = chooseFx(rates, rep, date, method);
    return a && b ? b.perUsd / a.perUsd : null;
  };
}

export async function computePeriod(c: Tx, tenant: string, periodId: string): Promise<FinPeriodResult> {
  const p = (await c.query(
    `SELECT pe.id, to_char(pe.as_of, 'YYYY-MM-DD') AS as_of, pe.status, pe.note, pe.locked_name, pe.locked_at,
            po.id AS portfolio_id, po.name, po.kind, po.currency, po.factor_library, po.include_scope3
       FROM fin_period pe JOIN fin_portfolio po ON po.id = pe.portfolio_id WHERE pe.id = $1`, [periodId])).rows[0];
  if (!p) throw notFound('Reporting period');
  const asOf: string = p.as_of, year = Number(asOf.slice(0, 4)), rep: string = p.currency;
  const holdings = (await c.query(
    `SELECT h.id, h.counterparty_id, h.asset_class, h.outstanding::float8 AS outstanding, h.currency, h.internal_ref, h.force_score, h.force_reason,
            cp.name, cp.country, cp.listed, cp.sector_standard, cp.sector_code, cp.sector_name
       FROM fin_holding h JOIN fin_counterparty cp ON cp.id = h.counterparty_id WHERE h.period_id = $1 ORDER BY cp.name, h.internal_ref`, [periodId])).rows;
  const ids = [...new Set(holdings.map((h) => h.counterparty_id as string))];
  const fins = ids.length ? (await c.query(
    `SELECT DISTINCT ON (counterparty_id) counterparty_id, year, currency, evic::float8 AS evic, equity::float8 AS equity, debt::float8 AS debt, revenue::float8 AS revenue, total_assets::float8 AS total_assets
       FROM fin_financials WHERE counterparty_id = ANY($1) AND year <= $2 ORDER BY counterparty_id, year DESC`, [ids, year])).rows : [];
  const finOf = new Map(fins.map((f) => [f.counterparty_id as string, f]));
  const ems = ids.length ? (await c.query(
    `SELECT counterparty_id, year, score, s1::float8 AS s1, s2::float8 AS s2, s3::float8 AS s3, source FROM fin_emission WHERE counterparty_id = ANY($1) AND year <= $2`, [ids, year])).rows : [];
  const emOf = new Map<string, ReportedEmissions[]>();
  for (const e of ems) emOf.set(e.counterparty_id, [...(emOf.get(e.counterparty_id) ?? []), { year: e.year, score: e.score, s1: e.s1, s2: e.s2, s3: e.s3, source: e.source }]);
  const factors = p.factor_library ? (await c.query(
    `SELECT library, sector_standard, sector_code, sector_name, region, year, basis, currency, s1::float8 AS s1, s2::float8 AS s2, s3::float8 AS s3, source FROM fin_factor WHERE library = $1`, [p.factor_library])).rows as FactorRow[] : [];
  const fx = await fxContext(c, tenant);
  const warnings: string[] = [];
  if (!p.factor_library) warnings.push('No sector factor library is chosen for this portfolio: estimates (scores 4 and 5) cannot be made. Choose one in the portfolio settings.');
  const noRate = new Set<string>();
  const conv = (amount: number | null, cur: string) => { if (amount == null) return null; const r = fx(cur, rep, asOf); if (r == null) { noRate.add(cur); return null; } return amount * r; };
  const sf = (f: FactorRow | null): SectorFactor | null => {
    if (!f) return null;
    const r = fx(f.currency, rep, asOf);
    if (r == null) { noRate.add(f.currency); return null; }
    // tCO2e per million of the factor's currency → per million of the reporting currency
    return { basis: f.basis, s1: f.s1 / r, s2: f.s2 / r, s3: f.s3 == null ? null : f.s3 / r, label: `${f.library} · ${f.sector_standard} ${f.sector_code}${f.region !== 'GLOBAL' ? ` · ${f.region}` : ''} · ${f.year}${f.currency !== rep ? ` · from ${f.currency}` : ''}`, year: f.year };
  };
  const lines: FinLine[] = holdings.map((h) => {
    const fr = finOf.get(h.counterparty_id);
    const rf = pickFactor(factors, h.sector_standard, h.sector_code, h.country, 'revenue', year), af = pickFactor(factors, h.sector_standard, h.sector_code, h.country, 'assets', year);
    // sectors are grouped at the level the factor library uses (C24 Basic metals), else at the division (C24)
    const fm = rf ?? af, div = h.sector_code ? String(h.sector_code).split('.')[0] : null;
    const sectorGroup = fm ? `${fm.sector_code} ${fm.sector_name ?? ''}`.trim() : div ? `${h.sector_standard} ${div}` : 'No sector code';
    const out = conv(h.outstanding, h.currency);
    const financials = fr ? { year: fr.year as number, evic: conv(fr.evic, fr.currency), equity: conv(fr.equity, fr.currency), debt: conv(fr.debt, fr.currency), revenue: conv(fr.revenue, fr.currency), totalAssets: conv(fr.total_assets, fr.currency) } : null;
    const result = out == null
      ? { id: h.id, attribution: null, denominator: { kind: 'none' as const, value: null }, score: null, company: null, financed: null, available: [], steps: [], warnings: [`No exchange rate from ${h.currency} to ${rep} on ${asOf}: add it under Currencies & price index`] }
      : financedEmissions({
        id: h.id, assetClass: h.asset_class, outstanding: out, listed: h.listed, financials, reported: emOf.get(h.counterparty_id) ?? [],
        revenueFactor: sf(rf), assetFactor: sf(af),
        forceScore: h.force_score, reportYear: year,
      });
    return {
      id: h.id, counterpartyId: h.counterparty_id, name: h.name, country: h.country, listed: h.listed, sector: h.sector_name ?? (h.sector_code ? `${h.sector_standard} ${h.sector_code}` : null), sectorCode: h.sector_code, sectorGroup,
      assetClass: h.asset_class, outstanding: out ?? 0, outstandingOrig: h.outstanding, currency: h.currency, internalRef: h.internal_ref, forceScore: h.force_score, forceReason: h.force_reason,
      revenue: financials?.revenue ?? null, financialYear: financials?.year ?? null, result, excluded: out == null ? `No ${h.currency} rate` : null,
    };
  });
  if (noRate.size) warnings.push(`No exchange rate to ${rep} on ${asOf} for: ${[...noRate].join(', ')}. Add rates under Currencies & price index.`);
  const summary = summarise(lines.filter((l) => !l.excluded).map((l) => ({ id: l.id, name: l.name, assetClass: l.assetClass, sector: l.sectorGroup, outstanding: l.outstanding, revenue: l.revenue, result: l.result })));
  return {
    period: { id: p.id, asOf, status: p.status, note: p.note, lockedName: p.locked_name, lockedAt: p.locked_at },
    portfolio: { id: p.portfolio_id, name: p.name, kind: p.kind, currency: rep, factorLibrary: p.factor_library, includeScope3: p.include_scope3 },
    lines, summary, warnings, computedAt: new Date().toISOString(),
  };
}

export const ASSET_CLASS_TEXT = ASSET_CLASSES;
/** Free text from a loan book ("Term loan", "Bond", "Shares") → asset class. */
export function assetClassOf(text: string, listed: boolean): AssetClass | null {
  const t = text.toLowerCase();
  if ((Object.keys(ASSET_CLASSES) as AssetClass[]).includes(t.replace(/\s+/g, '_') as AssetClass)) return t.replace(/\s+/g, '_') as AssetClass;
  if (/bond|note|debenture|sukuk|debt security|fixed income/.test(t)) return 'corporate_bond';
  if (/unlisted|private equity|pe\b/.test(t)) return 'unlisted_equity';
  if (/equit|share|stock/.test(t)) return listed ? 'listed_equity' : 'unlisted_equity';
  if (/loan|facility|credit|overdraft|revolv|lease|trade finance|working capital|murabaha|ijara/.test(t)) return 'business_loan';
  return null;
}
