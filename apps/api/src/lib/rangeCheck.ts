/**
 * Range check of a monthly entry against the same entry's history (same facility, item, unit and vehicle or
 * meter; approved monthly entries only; months before the entry's month).
 *
 *   avg6   the average of the 6 months before, ± the check limit (company setting, or the metric's own).
 *   smart  two forecasts — (a) seasonal: the same month last year × the recent trend (last 3 months against
 *          the same 3 months a year earlier, kept between ×0.5 and ×2); (b) level: the average of the 6 months
 *          before — are each tried on the last 12 months. The one with the smaller robust error spread (median
 *          absolute deviation of log errors) gives the expected value, corrected by its median error, and the
 *          band: 3 × that spread, at least ±10%, at most ×3 / ÷3. Seasonal data gets (a), steady or noisy data
 *          gets (b). Until 6 past forecasts can be scored the band is ± the check limit around (a); with fewer
 *          than 6 of the last 12 months reported the 6-month average ± limit is used.
 *
 * One query for any number of entries, so it is used for the entry grid, the approval queue, the home page
 * and the data-quality checks alike.
 */
import type { Tx } from '../db/pool.js';

export type CheckMethod = 'avg6' | 'smart';
/** sub: the vehicle or meter the entry belongs to ('' for none) — a van is compared with its own months, not the whole fleet's. */
export interface CheckIn { key: string; facilityId: string; itemId: number; unit: string; sub?: string | null; month: string; qty: number; pct: number }
export interface Check { ok: boolean; txt: string; method: 'avg6' | 'smart'; expected: number; low: number; high: number; basis: string; usual: number }

const mi = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; };
const fmt = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: x >= 100 ? 0 : x >= 10 ? 1 : 2 });
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Seasonal forecast for month m from the months before it. */
function forecast(s: Map<number, number>, m: number): { exp: number; level: number } | null {
  const base = s.get(m - 12);
  if (!base || base <= 0) return null;
  let num = 0, den = 0, pairs = 0;
  for (let k = 1; k <= 3; k++) { const a = s.get(m - k), b = s.get(m - 12 - k); if (a && b && a > 0 && b > 0) { num += a; den += b; pairs++; } }
  const level = pairs >= 2 ? clamp(num / den, 0.5, 2) : 1;
  return { exp: base * level, level };
}

function avg6(s: Map<number, number>, m: number, qty: number, pct: number, note = ''): Check | null {
  const xs: number[] = [];
  for (let k = 1; k <= 6; k++) { const v = s.get(m - k); if (v && v > 0) xs.push(v); }
  if (!xs.length || !(qty > 0)) return null;
  const u = xs.reduce((a, b) => a + b, 0) / xs.length, d = qty / u - 1;
  const low = u * (1 - pct / 100), high = u * (1 + pct / 100);
  const basis = `6-month average ±${pct}%${note}`;
  return Math.abs(d) * 100 < pct
    ? { ok: true, txt: 'In usual range', method: 'avg6', expected: u, low, high, basis, usual: u }
    : { ok: false, txt: `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}% vs 6-month average ${fmt(u)} (limit ±${pct}%) — add a note`, method: 'avg6', expected: u, low, high, basis, usual: u };
}

/** Average of the 6 months before j (at least 3 of them reported). */
function level6(s: Map<number, number>, j: number): number | null {
  const xs: number[] = [];
  for (let k = 1; k <= 6; k++) { const v = s.get(j - k); if (v && v > 0) xs.push(v); }
  return xs.length >= 3 ? xs.reduce((x, y) => x + y, 0) / xs.length : null;
}

export function checkOne(s: Map<number, number>, m: number, qty: number, pct: number, method: CheckMethod): Check | null {
  if (!(qty > 0)) return null;
  if (method === 'avg6') return avg6(s, m, qty, pct);
  let seen = 0;
  for (let k = 1; k <= 12; k++) if ((s.get(m - k) ?? 0) > 0) seen++;
  if (seen < 6) return avg6(s, m, qty, pct, ' (less than a year of history for the smart band)');
  // two forecasts, each tried on the last 12 months: the one that has been closer sets the expected value and the band
  const errs = (fc: (j: number) => number | null) => {
    const e: number[] = [];
    for (let j = m - 12; j < m; j++) { const v = s.get(j), p = v && v > 0 ? fc(j) : null; if (v && p) e.push(Math.log(v / p)); }
    return e;
  };
  const fS = forecast(s, m), fL = level6(s, m);
  const trend = fS && Math.abs(fS.level - 1) >= 0.005 ? ` × recent trend ${fS.level > 1 ? '+' : '−'}${Math.round(Math.abs(fS.level - 1) * 100)}%` : '';
  const cands = [
    fS && { name: `same month last year${trend}`, exp: fS.exp, e: errs((j) => forecast(s, j)?.exp ?? null) },
    fL && { name: 'average of the 6 months before', exp: fL, e: errs((j) => level6(s, j)) },
  ].filter((x): x is { name: string; exp: number; e: number[] } => !!x).map((x) => {
    if (x.e.length < 6) return { ...x, sigma: Infinity, med: 0 };
    const med = median(x.e);
    return { ...x, med, sigma: 1.4826 * median(x.e.map((v) => Math.abs(v - med))) };
  });
  const best = cands.filter((x) => Number.isFinite(x.sigma)).sort((a, b) => a.sigma - b.sigma)[0];
  let exp: number, low: number, high: number, basis: string;
  if (best) {
    const tol = clamp(3 * best.sigma, Math.log(1.1), Math.log(3));
    exp = best.exp * Math.exp(best.med); low = exp * Math.exp(-tol); high = exp * Math.exp(tol);
    basis = `${best.name} (the closer forecast over the last 12 months); band ±${Math.round((Math.exp(tol) - 1) * 100)}% = 3 × its usual error`;
  } else if (fS) {
    exp = fS.exp; low = exp * (1 - pct / 100); high = exp * (1 + pct / 100);
    basis = `same month last year${trend}; ±${pct}% until the band can be measured`;
  } else return avg6(s, m, qty, pct, ' (less than a year of history for the smart band)');
  const d = qty / exp - 1;
  if (qty >= low && qty <= high) return { ok: true, txt: `In usual range (expected ${fmt(exp)}, ${fmt(low)}–${fmt(high)})`, method: 'smart', expected: exp, low, high, basis, usual: exp };
  return { ok: false, txt: `${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}% vs expected ${fmt(exp)} (usual range ${fmt(low)}–${fmt(high)}) — add a note`, method: 'smart', expected: exp, low, high, basis, usual: exp };
}

/** Checks for many entries with one history query. Entries that are not monthly should not be passed. */
export async function rangeChecks(c: Tx, items: CheckIn[], method: CheckMethod): Promise<Map<string, Check | null>> {
  const out = new Map<string, Check | null>();
  if (!items.length) return out;
  const sk = (x: { facilityId: string; itemId: number; unit: string; sub?: string | null }) => `${x.facilityId}|${x.itemId}|${x.unit}|${x.sub ?? ''}`;
  const keys = [...new Map(items.map((x) => [sk(x), x])).values()];
  const minM = Math.min(...items.map((x) => mi(x.month))) - 27, maxM = Math.max(...items.map((x) => mi(x.month)));
  const iso = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}-01`;
  const rows = (await c.query(
    `SELECT k.f, k.i, k.u, k.s, to_char(a.period_start, 'YYYY-MM') AS m, sum(a.quantity)::float8 AS q
       FROM activity a JOIN unnest($1::text[], $2::int[], $3::text[], $6::text[]) k(f, i, u, s) ON a.facility_id::text = k.f AND a.item_id = k.i AND a.unit = k.u
                                                                                 AND coalesce(a.vehicle_id::text, a.meter_id::text, '') = k.s
      WHERE a.status = 'approved' AND a.period_end - a.period_start < 40 AND a.period_start >= $4::date AND a.period_start < $5::date
      GROUP BY 1, 2, 3, 4, 5`,
    [keys.map((x) => x.facilityId), keys.map((x) => x.itemId), keys.map((x) => x.unit), iso(minM), iso(maxM), keys.map((x) => x.sub ?? '')])).rows as { f: string; i: number; u: string; s: string; m: string; q: number }[];
  const series = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const k = sk({ facilityId: r.f, itemId: r.i, unit: r.u, sub: r.s });
    if (!series.has(k)) series.set(k, new Map());
    series.get(k)!.set(mi(r.m), r.q);
  }
  for (const x of items) {
    const all = series.get(sk(x)) ?? new Map<number, number>();
    const m = mi(x.month), before = new Map([...all].filter(([k]) => k < m));
    out.set(x.key, checkOne(before, m, x.qty, x.pct, method));
  }
  return out;
}
