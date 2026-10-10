/**
 * Purchased goods & services: one purchase line → kg CO2e.
 *
 * Methods, best first (GHG Protocol Scope 3 guidance):
 *   supplier   the supplier's own factor — per unit bought (kg, t, L, kWh, unit) or per currency unit
 *   spend      spend-based (environmentally-extended input-output) factor of the spend category,
 *              e.g. US EPA Supply Chain GHG Emission Factors v1.3: kg CO2e per 2022 USD (purchaser price)
 *
 * Money is brought to the factor's currency and price year in two steps:
 *   1. exchange: amount ÷ (currency per USD) → USD (× factor currency per USD when it is not USD),
 *      at the rate the company chose: average of the purchase month (default), annual average, or
 *      a fixed budget rate; a currency pegged to the USD uses its peg.
 *   2. inflation: × CPI(price year of the factor) ÷ CPI(year of purchase), so a 2025 dollar
 *      counts as fewer 2022 dollars. Without this, spend-based results drift up with inflation.
 */

export type FxKind = 'month' | 'year' | 'fixed' | 'peg';
export type FxMethod = 'month' | 'year' | 'fixed';

export interface FxRate {
  currency: string;
  kind: FxKind;
  /** yyyy-mm-dd: 1st of the month (month), 1 January (year, fixed), start of the peg (peg) */
  period: string;
  /** units of the currency for 1 USD */
  perUsd: number;
  source: string;
}

export interface FxChoice { perUsd: number; kind: FxKind; period: string; source: string; warning?: string }

/**
 * The rate for a currency on a date, following the company's method:
 *   month  → that month's average; else the year's average (warned); else the peg
 *   year   → that year's average; else the average of the months loaded for the year (warned); else the peg
 *   fixed  → the company's fixed rate for the year; else as `year`
 * A peg always applies when the currency is pegged (all methods give the same number).
 */
export function chooseFx(rates: FxRate[], currency: string, date: string, method: FxMethod): FxChoice | null {
  const cur = currency.toUpperCase();
  if (cur === 'USD') return { perUsd: 1, kind: 'peg', period: '1900-01-01', source: 'US dollar' };
  const mine = rates.filter((r) => r.currency === cur);
  const ym = date.slice(0, 7), y = date.slice(0, 4);
  const peg = mine.filter((r) => r.kind === 'peg' && r.period <= date).sort((a, b) => b.period.localeCompare(a.period))[0];
  if (peg) return { perUsd: peg.perUsd, kind: 'peg', period: peg.period, source: peg.source };
  const month = mine.find((r) => r.kind === 'month' && r.period.slice(0, 7) === ym);
  const year = mine.find((r) => r.kind === 'year' && r.period.slice(0, 4) === y);
  const fixed = mine.find((r) => r.kind === 'fixed' && r.period.slice(0, 4) === y);
  const monthsOfYear = mine.filter((r) => r.kind === 'month' && r.period.slice(0, 4) === y);
  const avgMonths = (): FxChoice | null => monthsOfYear.length
    ? { perUsd: monthsOfYear.reduce((s, r) => s + r.perUsd, 0) / monthsOfYear.length, kind: 'year', period: `${y}-01-01`, source: `average of ${monthsOfYear.length} monthly rates`,
        warning: monthsOfYear.length < 12 ? `${cur} ${y}: annual average taken from ${monthsOfYear.length} of 12 months` : undefined }
    : null;
  const pick = (r: FxRate | undefined, warning?: string): FxChoice | null => (r ? { perUsd: r.perUsd, kind: r.kind, period: r.period, source: r.source, ...(warning ? { warning } : {}) } : null);
  if (method === 'fixed' && fixed) return pick(fixed);
  if (method === 'month') return pick(month) ?? pick(year, `${cur}: no rate for ${ym}; ${y} annual average used`) ?? withWarn(avgMonths(), `${cur}: no rate for ${ym}`);
  // year (or fixed without a fixed rate)
  const warnFixed = method === 'fixed' ? `${cur}: no fixed rate for ${y}; ` : '';
  return pick(year, warnFixed ? `${warnFixed}annual average used` : undefined) ?? withWarn(avgMonths(), warnFixed ? `${warnFixed}average of monthly rates used` : undefined)
    ?? pick(month, `${cur}: no annual rate for ${y}; ${ym} monthly rate used`);
}
function withWarn(c: FxChoice | null, w?: string): FxChoice | null {
  if (!c || !w) return c;
  return { ...c, warning: c.warning ? `${w}; ${c.warning}` : w };
}

export interface PriceIndex { year: number; value: number }
export interface Deflator { ratio: number; from: number; to: number; warning?: string }

/**
 * Factor CPI ÷ purchase-year CPI. A missing year uses the nearest loaded year (warned);
 * with no index at all the ratio is 1 (warned).
 */
export function deflator(index: PriceIndex[], purchaseYear: number, priceYear: number): Deflator {
  if (purchaseYear === priceYear) return { ratio: 1, from: purchaseYear, to: priceYear };
  const near = (y: number) => index.find((i) => i.year === y) ?? [...index].sort((a, b) => Math.abs(a.year - y) - Math.abs(b.year - y) || b.year - a.year)[0];
  const a = near(purchaseYear), b = near(priceYear);
  if (!a || !b) return { ratio: 1, from: purchaseYear, to: priceYear, warning: `No price index loaded: ${purchaseYear} money not adjusted to ${priceYear}` };
  const warn = [a.year !== purchaseYear ? `price index for ${purchaseYear} not loaded; ${a.year} used` : '', b.year !== priceYear ? `price index for ${priceYear} not loaded; ${b.year} used` : ''].filter(Boolean).join('; ');
  return { ratio: b.value / a.value, from: a.year, to: b.year, ...(warn ? { warning: warn } : {}) };
}

/** A factor in money: kg CO2e per unit of `currency` of `priceYear` (EPA v1.3: USD, 2022). */
export interface SpendFactor { id?: number | string; co2e: number; currency: string; priceYear: number | null; name: string; source: string }
/** A supplier's factor per physical unit (kg, t, L, kWh, unit…). */
export interface UnitFactor { id?: number | string; co2e: number; unit: string; name: string; source: string }

export interface PurchaseInput {
  date: string;                 // yyyy-mm-dd (purchase or period start)
  amount?: number | null;       // spend in `currency`
  currency?: string | null;
  quantity?: number | null;     // physical quantity in `unit` (for per-unit supplier factors)
  unit?: string | null;
  /** best factor available, in order: supplier per unit, supplier per currency, spend-based */
  supplierUnit?: UnitFactor | null;
  supplierMoney?: SpendFactor | null;
  spend?: SpendFactor | null;
}
export interface PurchaseContext {
  rates: FxRate[];
  fxMethod: FxMethod;
  /** price index of the factor's currency (US CPI-U for USD factors) */
  index: (currency: string) => PriceIndex[];
  /** same dimension conversion for quantities (kg ↔ t…); return null when not convertible */
  convertQty?: (value: number, from: string, to: string) => number | null;
}
export interface PurchaseResult {
  method: 'supplier' | 'spend';
  co2e: number;                 // kg CO2e
  factorId?: number | string;
  factorName: string;
  factorSource: string;
  factorValue: number;
  factorUnit: string;           // e.g. 'kg CO2e / USD 2022'
  baseAmount: number;           // amount in the factor's unit
  fx?: FxChoice;
  cpi?: Deflator;
  steps: string[];
  warnings: string[];
}

const fmt = (n: number, d = 2) => (Math.abs(n) >= 1000 ? n.toLocaleString('en', { maximumFractionDigits: d }) : Number(n.toPrecision(6)).toString());

/** Converts spend to a money factor's currency and price year, then applies the factor. */
export function moneyToFactor(amount: number, currency: string, date: string, f: SpendFactor, ctx: PurchaseContext):
  { base: number; fx?: FxChoice; fxTo?: FxChoice; cpi?: Deflator; steps: string[]; warnings: string[] } | string {
  const steps: string[] = [], warnings: string[] = [];
  const cur = currency.toUpperCase(), to = f.currency.toUpperCase();
  let base = amount, fx: FxChoice | undefined, fxTo: FxChoice | undefined;
  if (cur !== to) {
    const a = chooseFx(ctx.rates, cur, date, ctx.fxMethod);
    if (!a) return `No exchange rate for ${cur} (${date.slice(0, 7)}). Add it under Setup → Currencies.`;
    fx = a;
    const usd = amount / a.perUsd;
    steps.push(`${cur} ${fmt(amount)} ÷ ${fmt(a.perUsd, 6)} ${cur}/USD (${rateLabel(a)}) = USD ${fmt(usd)}`);
    if (a.warning) warnings.push(a.warning);
    base = usd;
    if (to !== 'USD') {
      const b = chooseFx(ctx.rates, to, date, ctx.fxMethod);
      if (!b) return `No exchange rate for ${to} (${date.slice(0, 7)}). Add it under Setup → Currencies.`;
      fxTo = b; base = usd * b.perUsd;
      steps.push(`USD ${fmt(usd)} × ${fmt(b.perUsd, 6)} ${to}/USD (${rateLabel(b)}) = ${to} ${fmt(base)}`);
      if (b.warning) warnings.push(b.warning);
    }
  }
  let cpi: Deflator | undefined;
  const y = Number(date.slice(0, 4));
  if (f.priceYear && f.priceYear !== y) {
    cpi = deflator(ctx.index(to), y, f.priceYear);
    const before = base;
    base *= cpi.ratio;
    steps.push(`${to} ${fmt(before)} of ${y} × CPI ${cpi.to} / CPI ${cpi.from} (${cpi.ratio.toFixed(4)}) = ${to} ${fmt(base)} of ${f.priceYear}`);
    if (cpi.warning) warnings.push(cpi.warning);
  }
  return { base, fx, fxTo, cpi, steps, warnings };
}
const rateLabel = (r: FxChoice) => (r.kind === 'peg' ? 'peg' : r.kind === 'month' ? `average ${r.period.slice(0, 7)}` : r.kind === 'year' ? `average ${r.period.slice(0, 4)}` : `fixed rate ${r.period.slice(0, 4)}`);

/** Calculates one purchase line with the best factor available. Throws a readable message when it cannot. */
export function calcPurchase(p: PurchaseInput, ctx: PurchaseContext): PurchaseResult {
  const warnings: string[] = [];
  // 1. supplier factor per physical unit, when the line has a quantity
  if (p.supplierUnit && p.quantity != null && p.unit) {
    const f = p.supplierUnit;
    const q = p.unit === f.unit ? p.quantity : ctx.convertQty?.(p.quantity, p.unit, f.unit) ?? null;
    if (q != null) {
      const co2e = q * f.co2e;
      return {
        method: 'supplier', co2e, factorId: f.id, factorName: f.name, factorSource: f.source, factorValue: f.co2e, factorUnit: `kg CO2e / ${f.unit}`, baseAmount: q,
        steps: [...(p.unit !== f.unit ? [`${fmt(p.quantity)} ${p.unit} = ${fmt(q)} ${f.unit}`] : []), `${fmt(q)} ${f.unit} × ${fmt(f.co2e, 6)} kg CO2e/${f.unit} (${f.name}) = ${fmt(co2e)} kg CO2e`],
        warnings,
      };
    }
    warnings.push(`Supplier factor is per ${f.unit}; the line is in ${p.unit}: spend used instead`);
  }
  const money = p.supplierMoney ?? p.spend;
  if (!money) throw new Error('No factor: map the line to a spend category (or give a supplier factor)');
  if (p.amount == null) throw new Error(p.supplierUnit ? `Enter the quantity in ${p.supplierUnit.unit}, or the amount spent` : 'Enter the amount spent');
  if (!p.currency) throw new Error('Currency missing');
  const m = moneyToFactor(p.amount, p.currency, p.date, money, ctx);
  if (typeof m === 'string') throw new Error(m);
  const co2e = m.base * money.co2e;
  const unitLabel = `${money.currency.toUpperCase()}${money.priceYear ? ` ${money.priceYear}` : ''}`;
  return {
    method: p.supplierMoney ? 'supplier' : 'spend', co2e, factorId: money.id, factorName: money.name, factorSource: money.source, factorValue: money.co2e,
    factorUnit: `kg CO2e / ${unitLabel}`, baseAmount: m.base, fx: m.fx, cpi: m.cpi,
    steps: [...m.steps, `${unitLabel} ${fmt(m.base)} × ${fmt(money.co2e, 6)} kg CO2e/${unitLabel} (${money.name}) = ${fmt(co2e)} kg CO2e`],
    warnings: [...warnings, ...m.warnings],
  };
}
