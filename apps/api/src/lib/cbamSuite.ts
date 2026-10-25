/**
 * Rules of the dedicated CBAM tool, in one place (Regulation (EU) 2023/956 as amended by Regulation (EU) 2025/2083):
 *  - de minimis: 50 tonnes net mass per importer per calendar year, all CBAM goods except electricity and hydrogen;
 *    importers above 90 % are flagged; above the threshold every import of the year counts
 *  - quarterly holding: at the end of each quarter, certificates for at least 50 % of the embedded emissions of the
 *    goods imported since the start of the year (estimate here: 50 % of the certificates due so far)
 *  - certificates for 2026 imports are sold from 1 February 2027; the declaration is due by 30 September of the next year
 *  - credibility of supplier values against the default value for the CN code and country
 *  - forecast of certificates and cost to 2034 (free allocation phased out: CBAM factor 0 from 2034)
 */
import { cbamFactor, markup, type Sector } from './cbam.js';

export const DE_MINIMIS_T = 50;
export const DE_MINIMIS_WARN = 0.9;
export const HOLDING_SHARE = 0.5;
export const SALES_START = '2027-02-01';
export const countsForThreshold = (sector: Sector) => sector !== 'electricity' && sector !== 'hydrogen';
export const declarationDue = (year: number) => `${year + 1}-09-30`;

export interface ThresholdIn { year: number; lines: { quarter: number; mass: number; sector: Sector }[] }
export function threshold(x: ThresholdIn) {
  const counted = x.lines.filter((l) => countsForThreshold(l.sector));
  const byQuarter = [1, 2, 3, 4].map((q) => counted.filter((l) => l.quarter <= q).reduce((a, l) => a + l.mass, 0));
  const mass = counted.reduce((a, l) => a + l.mass, 0);
  const share = mass / DE_MINIMIS_T;
  const always = x.lines.filter((l) => !countsForThreshold(l.sector)).length;   // electricity and hydrogen are never exempt
  return {
    limit: DE_MINIMIS_T, mass, share, byQuarter,
    status: share > 1 ? 'over' : share >= DE_MINIMIS_WARN ? 'near' : 'under',
    exempt: share <= 1, alwaysCovered: always,
    message: share > 1 ? `Above the ${DE_MINIMIS_T} t threshold: every CBAM import of ${x.year} counts — you need authorised declarant status.`
      : share >= DE_MINIMIS_WARN ? `${Math.round(share * 100)}% of the ${DE_MINIMIS_T} t threshold: apply for authorised declarant status before you go over it.`
      : `Below the ${DE_MINIMIS_T} t threshold so far (${Math.round(share * 100)}%): no certificates are due for these goods while you stay under it.`,
  };
}

/** Certificates to hold at the end of each quarter (cumulative since 1 January), as an estimate. */
export function holding(lines: { quarter: number; certificates: number | null }[], prices: (number | null)[]) {
  return [1, 2, 3, 4].map((q) => {
    const due = lines.filter((l) => l.quarter <= q).reduce((a, l) => a + (l.certificates ?? 0), 0);
    const hold = due * HOLDING_SHARE;
    const price = prices[q - 1] ?? null;
    return { quarter: q, certificatesSoFar: due, toHold: hold, price, value: price == null ? null : hold * price };
  });
}

export type CredLevel = 'ok' | 'low' | 'high' | 'nodefault' | 'missing';
/** A supplier's SEE against the default value (before mark-up) for the same CN code and country. */
export function credibility(see: number | null, def: number | null): { level: CredLevel; ratio: number | null; msg: string } {
  if (see == null) return { level: 'missing', ratio: null, msg: 'No value' };
  if (def == null || def <= 0) return { level: 'nodefault', ratio: null, msg: 'No default value to compare with' };
  const r = see / def;
  if (r < 0.3) return { level: 'low', ratio: r, msg: `${Math.round(r * 100)}% of the default value — unusually low: ask for the calculation and verification` };
  if (r > 2) return { level: 'high', ratio: r, msg: `${Math.round(r * 100)}% of the default value — unusually high: check units (per tonne) and scope` };
  return { level: 'ok', ratio: r, msg: `${Math.round(r * 100)}% of the default value` };
}

// ------------------------------------------------------------------ forecast --
export interface ForecastGroup {
  key: string; label: string; cn: string; origin: string; supplier: string; sector: Sector;
  mass: number;                 // tonnes a year in the base year
  seeActual: number | null;     // relevant SEE (direct, + indirect for cement and fertilisers)
  defaultValue: number | null;  // before mark-up
  benchmark: number | null;
  carbonPriceEur: number | null; // carbon price paid, EUR per tonne of good
}
export interface ForecastAssumptions {
  from: number; to: number;
  price: number; priceGrowth: number;      // EUR per certificate in the first year; yearly change (0.05 = +5 %)
  volumeGrowth: number;                    // yearly change of the tonnes imported
  basis: 'actual' | 'default';             // actual values where the supplier gave them, or default values everywhere
  switches: { key: string; see: number }[]; // scenario: buy this group from a supplier with this SEE
}
export interface ForecastYear { year: number; cbamFactor: number; price: number; mass: number; embedded: number; faa: number; certificates: number; cost: number; missing: number }
export function forecast(groups: ForecastGroup[], a: ForecastAssumptions) {
  const years: ForecastYear[] = [];
  const perGroup = new Map<string, { label: string; cost: number[]; certificates: number[]; see: number[] }>();
  for (let y = a.from; y <= Math.max(a.from, Math.min(a.to, 2050)); y++) {
    const n = y - a.from;
    const price = a.price * (1 + a.priceGrowth) ** n;
    const f = cbamFactor(y);
    const row: ForecastYear = { year: y, cbamFactor: f, price, mass: 0, embedded: 0, faa: 0, certificates: 0, cost: 0, missing: 0 };
    for (const g of groups) {
      const mass = g.mass * (1 + a.volumeGrowth) ** n;
      const sw = a.switches.find((s) => s.key === g.key);
      let see: number | null;
      if (sw) see = sw.see;
      else if (a.basis === 'actual' && g.seeActual != null) see = g.seeActual;
      else see = g.defaultValue == null ? null : g.defaultValue * (1 + markup(y, g.sector));
      const pg = perGroup.get(g.key) ?? { label: g.label, cost: [], certificates: [], see: [] };
      if (see == null) { row.missing += mass; pg.cost.push(0); pg.certificates.push(0); pg.see.push(NaN); perGroup.set(g.key, pg); continue; }
      const sefa = (g.benchmark ?? 0) * f;
      const deduct = g.carbonPriceEur && price ? g.carbonPriceEur / price : 0;
      const cert = Math.max(0, see - sefa - deduct) * mass;
      row.mass += mass; row.embedded += see * mass; row.faa += sefa * mass; row.certificates += cert; row.cost += cert * price;
      pg.cost.push(cert * price); pg.certificates.push(cert); pg.see.push(see);
      perGroup.set(g.key, pg);
    }
    years.push(row);
  }
  return { years, groups: [...perGroup.entries()].map(([key, v]) => ({ key, ...v, total: v.cost.reduce((s, x) => s + x, 0) })).sort((x, y) => y.total - x.total), total: years.reduce((s, y) => s + y.cost, 0) };
}
