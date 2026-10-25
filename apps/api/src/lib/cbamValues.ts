/**
 * Choosing the default value and the CBAM benchmark for a good, the way the Commission's tables are meant to be read.
 *
 * Default values (Implementing Regulation (EU) 2025/2621, Annex I, as corrected by (EU) 2026/1740):
 *   - one table per country of origin; a country not listed, or listed with "–", takes the "Other countries and
 *     territories" table (stored with no country);
 *   - values are before the mark-up (the tool adds the mark-up of each year) and the total is what is priced
 *     (direct + indirect for cement and fertilisers, direct for the others — indirect is "N/A" there);
 *   - some codes are 10-digit TARIC codes (white or grey clinker…): an 8-digit CN code with different TARIC values
 *     takes the highest, with a note to enter the TARIC code;
 *   - Annex IV holds the highest default value of every good, used where the country of production is unknown.
 * Benchmarks (Implementing Regulation (EU) 2025/2620): column A goes with actual emissions, column B with default
 * values; where a code has several production routes, the route behind the default value (or the installation's own
 * route) picks the row. A company's own values come first; its illustrative (demo) values only where nothing official is loaded.
 */
import type { Tx } from '../db/pool.js';

export interface Ref {
  id: string; kind: string; cn: string | null; country: string | null; route: string | null; basis: 'A' | 'B' | null; year: number; quarter: number | null;
  value: number; direct: number | null; indirect: number | null; description: string | null; source: string; indicative: boolean; own: boolean;
}
export type Picked = Ref & { note: string | null; tier: 'own' | 'country' | 'other' | 'highest' };

/** Reference rows; shared default values only for the given countries (and the "other countries" table) — the full set has ~15,000 rows. */
export async function loadRefs(c: Tx, countries?: (string | null)[], sharedOnly = false): Promise<Ref[]> {
  const cs = countries ? [...new Set(countries.filter((x): x is string => !!x))] : null;
  const w = [cs ? `(kind <> 'default' OR country IS NULL OR tenant_id IS NOT NULL OR country = ANY($1))` : '', sharedOnly ? 'tenant_id IS NULL' : ''].filter(Boolean);
  return (await c.query(
    `SELECT id, kind, cn, country, route, basis, year, quarter, value::float8 AS value, direct::float8 AS direct, indirect::float8 AS indirect, description, source, indicative, tenant_id IS NOT NULL AS own
       FROM cbam_reference ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY kind, year DESC, quarter, cn`, cs ? [cs] : [])).rows as Ref[];
}

const byPrefix = (rows: Ref[], cn: string) => {
  const m = rows.filter((r) => r.cn && cn.startsWith(r.cn));
  if (!m.length) return null;
  return m.sort((a, b) => (b.cn!.length - a.cn!.length) || (b.year - a.year))[0]!;
};
const fmtCn = (s: string) => s.replace(/^(\d{4})(\d{2})?(\d{2})?(\d{2})?$/, (_, a, b, c2, d) => [a, b, c2, d].filter(Boolean).join(' '));

/** The default value for a CN (or TARIC) code and country of origin. */
export function defaultFor(R: Ref[], cn: string, country: string | null, year: number): Picked | null {
  const D = R.filter((r) => r.kind === 'default' && r.cn && r.year <= year);
  const tiers: [Picked['tier'], Ref[]][] = [
    ['own', country ? D.filter((r) => r.own && !r.indicative && r.country === country) : []],
    ['own', D.filter((r) => r.own && !r.indicative && !r.country)],
    ['country', country ? D.filter((r) => !r.own && r.country === country) : []],
    ['highest', country ? [] : R.filter((r) => r.kind === 'highest' && r.cn && r.year <= year)],
    ['other', D.filter((r) => !r.own && !r.country)],
    // a company's illustrative values (demo) only where nothing official is loaded
    ['own', country ? D.filter((r) => r.own && r.indicative && r.country === country) : []],
    ['own', D.filter((r) => r.own && r.indicative && !r.country)],
  ];
  for (const [tier, rows] of tiers) {
    if (!rows.length) continue;
    const hit = byPrefix(rows, cn);
    const note = tier === 'other' && country ? `No value for this country of origin: the "Other countries and territories" value applies` : tier === 'highest' ? 'Country of origin unknown: the highest default value (Annex IV) applies' : null;
    if (hit) return { ...hit, tier, note };
    // an 8-digit CN code whose values are given per 10-digit TARIC code
    const kids = rows.filter((r) => r.cn!.length > cn.length && r.cn!.startsWith(cn));
    if (kids.length) {
      const top = kids.sort((a, b) => b.value - a.value)[0]!;
      const same = kids.every((k) => k.value === top.value);
      return { ...top, tier, note: [note, same ? null : `Values differ by TARIC code (${kids.map((k) => `${fmtCn(k.cn!)}: ${k.value}`).join('; ')}): the highest is used — enter the 10-digit TARIC code`].filter(Boolean).join('. ') || null };
    }
  }
  return null;
}

/** Route letters (A–L) of a stored route such as "C", "C/F" or "F1". */
export const routeLetters = (route: string | null | undefined) => (route ?? '').split('/').map((s) => s.replace(/[^A-L]/g, '')).filter(Boolean);

/** The production route letters an installation's own route text points to, among the routes a benchmark offers. */
export function routeFromText(text: string | null | undefined, offered: string[]): string[] {
  if (!text) return [];
  const t = text.toUpperCase();
  const explicit = [...t.matchAll(/\(([A-L])\)/g)].map((m) => m[1]!).filter((x) => offered.includes(x));
  if (explicit.length) return explicit;
  if (/^[A-L]$/.test(t.trim()) && offered.includes(t.trim())) return [t.trim()];
  const kw: [RegExp, string[]][] = [[/BF|BOF|BLAST/, ['C', 'F']], [/DRI|DIRECT RED/, ['D', 'G']], [/HIGH[- ]?ALLOY/, ['J']], [/SCRAP|EAF|ELECTRIC ARC/, ['E', 'H', 'J']],
    [/SECONDARY|RECYCL|REMELT/, ['L']], [/PRIMARY|ELECTROLY/, ['K']], [/WHITE/, ['B']], [/GREY|GRAY/, ['A']]];
  for (const [re, ls] of kw) if (re.test(t)) { const m = ls.filter((l) => offered.includes(l)); if (m.length) return m; }
  return [];
}

/** The CBAM benchmark for a good: column B (default values) or A (actual emissions), on the given production route(s). */
export function benchmarkFor(R: Ref[], cn: string, year: number, routes: string[], basis: 'A' | 'B' = 'B', routeText?: string | null): Picked | null {
  const B = R.filter((r) => r.kind === 'benchmark' && r.cn && r.year <= year && (r.basis ?? 'B') === basis && cn.startsWith(r.cn));
  if (!B.length) return null;
  const own = B.filter((r) => r.own && !r.indicative), shared = B.filter((r) => !r.own);
  const pool = own.length ? own : shared.length ? shared : B;
  const len = Math.max(...pool.map((r) => r.cn!.length));
  const yr = Math.max(...pool.filter((r) => r.cn!.length === len).map((r) => r.year));
  const G = pool.filter((r) => r.cn!.length === len && r.year === yr);
  const tier = own.length ? 'own' as const : 'other' as const;
  if (G.length === 1) return { ...G[0]!, tier, note: null };
  const offered = [...new Set(G.flatMap((r) => routeLetters(r.route)))];
  const want = routeText != null ? routeFromText(routeText, offered) : [];
  const use = want.length ? want : routes.filter((x) => offered.includes(x));
  const M = use.length ? G.filter((r) => routeLetters(r.route).some((l) => use.includes(l))) : [];
  const set = M.length ? M : G;
  const low = [...set].sort((a, b) => a.value - b.value)[0]!;
  const names = (rs: Ref[]) => rs.map((r) => `(${r.route}) ${r.value}`).join(', ');
  const note = M.length === 1 ? null
    : M.length > 1 ? `Several benchmarks for route ${use.join('/')} (${names(M)}): the lowest is used`
      : `Production route not known (${names(G)}): the lowest benchmark is used — give the route on the line`;
  return { ...low, tier, note };
}
