/**
 * EKOTRACE SME — how emission figures are stored, per plant and per month (pure, no I/O).
 *
 *   emissions = {
 *     <source>: yearly total, all plants        ← what the rest of the engine reads (kept by the screen;
 *                                                  Bill scan may add to it directly)
 *     green:    renewable electricity bought (kWh, part of the grid units)
 *     sites: { <plantId>: {
 *       mode:    { <source>: 'month' | 'year' },
 *       months:  { <source>: [Apr … Mar] },      12 numbers or ''
 *       year:    { <source>: number },            a single yearly figure
 *       quality: { <source>: 'bills' | 'estimate' | 'none' } } }
 *   }
 *
 * Older data has only the yearly totals and no `sites`; it reads as one plant ("main") with yearly figures.
 * Plants are listed in profile.plants [{ id, name, city, state }]; "main" always exists.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
/** Inputs kept like sources but without a factor of their own. */
export const EXTRA_KEYS = ['green'];

const num = (v: any): number => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);
const filled = (v: any) => v !== '' && v !== null && v !== undefined && !isNaN(+v);
const obj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const sitesOf = (em: any): Record<string, any> => obj(obj(em).sites);

export function siteMode(site: any, k: string): 'month' | 'year' {
  const m = obj(obj(site).mode)[k];
  if (m === 'month' || m === 'year') return m;
  const arr = obj(obj(site).months)[k];
  return Array.isArray(arr) && arr.some(filled) ? 'month' : 'year';
}
export function monthsOf(site: any, k: string): number[] {
  const arr = obj(obj(site).months)[k];
  return MONTHS.map((_, i) => num(Array.isArray(arr) ? arr[i] : 0));
}
export function monthsFilled(site: any, k: string): number {
  const arr = obj(obj(site).months)[k];
  return Array.isArray(arr) ? arr.slice(0, 12).filter(filled).length : 0;
}
/** One plant's yearly figure for a source: the sum of its months, or its single yearly figure. */
export function siteValue(site: any, k: string): number {
  return siteMode(site, k) === 'month' ? monthsOf(site, k).reduce((a, x) => a + x, 0) : num(obj(obj(site).year)[k]);
}
/** Yearly total of a source: the stored total when there is one, else the plants' sum. */
export function sourceTotal(em: any, k: string): number {
  const v = obj(em)[k];
  if (filled(v)) return num(v);
  return Object.values(sitesOf(em)).reduce((a: number, s) => a + siteValue(s, k), 0);
}
/** The emissions document with every yearly total present (older clients may have written plants only). */
export function withTotals(em: any, keys: string[]): any {
  if (!Object.keys(sitesOf(em)).length) return em;
  const out = { ...obj(em) };
  for (const k of keys) if (!filled(out[k])) out[k] = sourceTotal(em, k);
  return out;
}

export interface Plant { id: string; name: string; city?: string; state?: string }
/** The company's plants; a single "Main plant" when none are listed. */
export function plantList(profile: any): Plant[] {
  const ps: Plant[] = (Array.isArray(obj(profile).plants) ? obj(profile).plants : [])
    .filter((p: any) => p && typeof p.id === 'string' && p.id)
    .map((p: any) => ({ id: p.id, name: String(p.name || '').trim() || (p.id === 'main' ? 'Main plant' : 'Unnamed plant'), city: p.city || '', state: p.state || '' }));
  if (!ps.some((p) => p.id === 'main')) ps.unshift({ id: 'main', name: 'Main plant', city: '', state: '' });
  return ps;
}

/** Quantity of each source at each plant. The main plant holds whatever the total has beyond the other plants. */
export function plantQuantities(em: any, keys: string[], plants: Plant[]): Record<string, Record<string, number>> {
  const sites = sitesOf(em), out: Record<string, Record<string, number>> = {};
  const ids = [...new Set([...plants.map((p) => p.id), ...Object.keys(sites)])];
  for (const id of ids) out[id] = {};
  for (const k of keys) {
    let others = 0;
    for (const id of ids) if (id !== 'main') { const v = siteValue(sites[id], k); out[id]![k] = v; others += v; }
    out.main![k] = Math.max(0, sourceTotal(em, k) - others);
  }
  return out;
}

export type Quality = 'measured' | 'estimated' | 'missing' | 'unused';
/** Where a source's figure comes from: bills (measured), an estimate, nothing yet, or "we don't use this". */
export function sourceQuality(em: any, k: string): { status: Quality; months: number | null; partial: boolean } {
  const sites = sitesOf(em), total = sourceTotal(em, k);
  const list = Object.values(sites);
  let months: number | null = null;
  for (const s of list) if (siteMode(s, k) === 'month' && siteValue(s, k) > 0) months = Math.min(months ?? 12, monthsFilled(s, k));
  const q = (s: any) => obj(obj(s).quality)[k];
  if (total > 0) {
    const used = list.filter((s) => siteValue(s, k) > 0);
    const est = used.some((s) => q(s) === 'estimate') || (!used.length && q(sites.main) === 'estimate');
    return { status: est ? 'estimated' : 'measured', months, partial: months !== null && months < 12 };
  }
  return { status: list.some((s) => q(s) === 'none') ? 'unused' : 'missing', months: null, partial: false };
}
