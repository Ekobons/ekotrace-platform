/**
 * Emissions data entry by plant and by month (the stored shape is described in the API's
 * lib/sme/emisSites.ts). The screen edits plants' figures and keeps each source's yearly total
 * (emissions.<key>) equal to the sum, which is what the rest of the tool reads. Figures in tCO₂e
 * always come from the server.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

const num = (v: any): number => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);
const filled = (v: any) => v !== '' && v !== null && v !== undefined && !isNaN(+v);
const obj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export const sitesOf = (em: any): Record<string, any> => obj(obj(em).sites);
export const explicitMode = (site: any, k: string): 'month' | 'year' | null => { const m = obj(obj(site).mode)[k]; return m === 'month' || m === 'year' ? m : null; };
export const monthsArr = (site: any, k: string): any[] => { const a = obj(obj(site).months)[k]; return MONTHS.map((_, i) => (Array.isArray(a) ? a[i] ?? '' : '')); };
export const monthsFilled = (site: any, k: string) => monthsArr(site, k).filter(filled).length;
/** Mode as the server reads it: chosen, else months entered → month, else year. */
export const storedMode = (site: any, k: string) => explicitMode(site, k) ?? (monthsFilled(site, k) > 0 ? 'month' : 'year');
export const siteValue = (site: any, k: string) => (storedMode(site, k) === 'month' ? monthsArr(site, k).reduce((a: number, x) => a + num(x), 0) : num(obj(obj(site).year)[k]));
export const sumSites = (em: any, k: string) => Object.values(sitesOf(em)).reduce((a: number, s) => a + siteValue(s, k), 0);
/** Yearly total of a source (all plants). */
export const total = (em: any, k: string) => (filled(obj(em)[k]) ? num(obj(em)[k]) : sumSites(em, k));
/** A plant's figure for a source; the main plant also holds anything added to the total directly (Bill scan, older data). */
export function plantValue(em: any, plant: string, k: string): number {
  const sites = sitesOf(em);
  if (plant !== 'main') return siteValue(sites[plant], k);
  const others = Object.keys(sites).filter((id) => id !== 'main').reduce((a, id) => a + siteValue(sites[id], k), 0);
  return Math.max(0, total(em, k) - others);
}
/** Amount in the main plant's total that is not in its months (only when it enters by month). */
export function unsplit(em: any, k: string): number {
  const main = sitesOf(em).main;
  if (storedMode(main, k) !== 'month') return 0;
  return Math.max(0, plantValue(em, 'main', k) - siteValue(main, k));
}

/**
 * A change to the emissions document: copies it, moves any amount that is in a yearly total but in no
 * plant into the main plant's yearly figure (so older data and Bill scan additions are kept), applies the
 * change, then sets every yearly total to the sum of the plants.
 */
export function change(em: any, keys: string[], fn: (next: any) => void): any {
  const next = structuredClone(obj(em));
  next.sites = obj(next.sites);
  const keep: Record<string, number> = {};
  for (const k of keys) {
    if (!filled(next[k])) continue;
    const diff = num(next[k]) - sumSites(next, k);
    if (Math.abs(diff) < 1e-9) continue;
    const main = (next.sites.main = obj(next.sites.main));
    if (storedMode(main, k) === 'year') { main.year = obj(main.year); main.year[k] = num(main.year[k]) + diff; }
    else keep[k] = diff;              // entered by month: keep the extra in the total, shown as "not split by month"
  }
  fn(next);
  for (const k of keys) {
    const s = sumSites(next, k) + (keep[k] ?? 0);
    if (s !== 0 || filled(next[k]) || Object.values(next.sites).some((x: any) => obj(x.year)[k] !== undefined || obj(x.months)[k] !== undefined)) next[k] = Math.max(0, Math.round(s * 1000) / 1000);
  }
  return next;
}
/** Site object inside a copy, created when missing. */
export function site(next: any, plant: string): any {
  next.sites = obj(next.sites);
  const s = (next.sites[plant] = obj(next.sites[plant]));
  for (const part of ['mode', 'months', 'year', 'quality']) s[part] = obj(s[part]);
  return s;
}
