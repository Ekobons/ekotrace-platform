/**
 * One supplier, however its name is written.
 *
 * Each name seen in purchase lines is linked, in this order, to:
 *   1. the supplier it was linked to before (remembered spelling)
 *   2. the supplier with the same vendor number (ERP reference)
 *   3. the supplier with the same name or a known alias (legal forms ignored: LLC, L.L.C., FZE…)
 *   4. a supplier with a near-identical name (typo, word order, generic words such as
 *      "Trading", "Services", "Middle East"): linked automatically, listed for review
 *   5. otherwise a new supplier — marked "possible duplicate of …" when a similar name exists
 */
import type { Tx } from '../../db/pool.js';
import { normSupplier } from './fields.js';

// ------------------------------------------------------------ similarity --
/** Generic words that do not tell two suppliers apart. */
const GENERIC = new Set(('services service solutions solution international intl global middle east me mena gcc uae emirates dubai sharjah abu dhabi ajman ' +
  'general contracting contractors industries industry industrial enterprises enterprise holding holdings partners partnership associates ' +
  'technologies technology systems products supplies supply distribution distributors trading traders est establishment branch br llp lp sarl gmbh ag bv sa spa pte pty corp corporation').split(' '));
/** Words too common to identify a supplier on their own. */
const COMMON = new Set(('al el gulf national arabian arab united first new star city royal golden green blue emirates dubai sharjah abu dhabi').split(' '));

/** Damerau (optimal string alignment) distance, stopping early above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v; rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}
const LONG_GENERIC = [...GENERIC].filter((g) => g.length >= 6);
const genericCache = new Map<string, boolean>();
/** A generic word, also when mistyped ("Indutsrial", "Serivces"). */
function isGeneric(w: string): boolean {
  let v = genericCache.get(w);
  if (v === undefined) { v = GENERIC.has(w) || (w.length >= 6 && LONG_GENERIC.some((g) => g[0] === w[0] && editDistance(w, g, 1) <= 1)); genericCache.set(w, v); }
  return v;
}
/** The words that identify a supplier: legal forms and generic words dropped, "Al Noor" = "AlNoor". */
function tokens(name: string): string[] {
  const n = normSupplier(name).replace(/\b(al|el)\s+(?=[a-z])/g, '$1');
  const all = n.split(' ').filter(Boolean);
  const t = all.filter((w) => !isGeneric(w));
  return t.length ? t : all;
}
export function compareKey(name: string): string { return tokens(name).join(' '); }

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) { if (!am[i]) continue; while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < Math.min(4, a.length, b.length) && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

const trigrams = (s: string) => { const x = `  ${s.replace(/ /g, '')} `; const out: string[] = []; for (let i = 0; i < x.length - 2; i++) out.push(x.slice(i, i + 3)); return out; };
export function dice(a: string, b: string): number {
  const ta = trigrams(a), tb = trigrams(b);
  if (!ta.length || !tb.length) return 0;
  const m = new Map<string, number>();
  for (const t of ta) m.set(t, (m.get(t) ?? 0) + 1);
  let both = 0;
  for (const t of tb) { const n = m.get(t); if (n) { both++; m.set(t, n - 1); } }
  return (2 * both) / (ta.length + tb.length);
}

export interface Similarity { score: number; auto: boolean; why: string }
/** Two words the same apart from a typo (short words must be equal). */
function sameWord(a: string, b: string): 0 | 1 | 2 {
  if (a === b) return 2;
  if (a.length < 5 || b.length < 5 || a[0] !== b[0]) return 0;
  return editDistance(a, b, 2) <= (Math.min(a.length, b.length) >= 9 ? 2 : 1) ? 1 : 0;
}
/**
 * How likely two names are the same supplier: auto = link without asking.
 * Word by word: every identifying word of one name must be found in the other (a typo
 * allowed in longer words, "Big Four" = "Bigfour"). A word only one name has — "Pearl"
 * vs "Marina Management Consultancy", "Steel" vs "IT Solutions" — means two suppliers.
 */
export function similarity(a: string, b: string): Similarity {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return { score: 0, auto: false, why: '' };
  const ka = ta.join(' '), kb = tb.join(' ');
  const digits = (s: string) => (s.match(/\d+/g) ?? []).join(',');
  if (digits(ka) !== digits(kb)) return { score: Math.min(0.8, jaroWinkler(ka, kb)), auto: false, why: 'different numbers' };
  // align the words
  const usedB = new Set<number>();
  let typos = 0;
  const leftA: string[] = [];
  const matched: string[] = [];
  for (let i = 0; i < ta.length; i++) {
    const w = ta[i]!;
    let best = -1, kind = 0;
    for (let j = 0; j < tb.length; j++) { if (usedB.has(j)) continue; const k = sameWord(w, tb[j]!); if (k > kind) { kind = k; best = j; if (k === 2) break; } }
    if (best >= 0) { usedB.add(best); matched.push(w); if (kind === 1) typos++; continue; }
    // joined / split words: "bigfour" ~ "big four"
    let joined = false;
    for (let j = 0; j + 1 < tb.length && !joined; j++) if (!usedB.has(j) && !usedB.has(j + 1) && sameWord(w, tb[j]! + tb[j + 1]!)) { usedB.add(j); usedB.add(j + 1); matched.push(w); joined = true; }
    if (!joined && i + 1 < ta.length) {
      const j = tb.findIndex((x, jj) => !usedB.has(jj) && sameWord(w + ta[i + 1]!, x));
      if (j >= 0) { usedB.add(j); matched.push(w + ta[i + 1]!); i++; joined = true; }
    }
    if (!joined) leftA.push(w);
  }
  const leftB = tb.filter((_, j) => !usedB.has(j));
  const strong = matched.some((w) => w.length >= 5 && !COMMON.has(w)) || matched.filter((w) => !COMMON.has(w)).length >= 2;
  const jw = Math.round(jaroWinkler(ka, kb) * 1000) / 1000;
  if (!leftA.length && !leftB.length) {
    if (!strong) return { score: 0.9, auto: false, why: 'same short name' };
    if (!typos) return { score: 0.99, auto: true, why: 'same name apart from legal form, spacing or generic words' };
    return { score: typos === 1 ? 0.97 : 0.95, auto: typos <= 2 && (matched.length > typos || matched.every((w) => w.length >= 8)), why: 'spelling differs slightly' };
  }
  if (!leftA.length || !leftB.length) {
    // one name has extra words ("Masafi" / "Masafi Water"): the same supplier only if what they share identifies it
    const shared = matched.filter((w) => !COMMON.has(w));
    // …and both names start with it ("Pearl Cement" is not "(Emirates) Cement")
    const sameStart = sameWord(ta[0]!, tb[0]!) > 0 || sameWord(ta[0]!, tb.slice(0, 2).join('')) > 0 || sameWord(tb[0]!, ta.slice(0, 2).join('')) > 0;
    const identifies = sameStart && (shared.some((w) => w.length >= 6) || shared.length >= 2);
    return identifies ? { score: 0.9, auto: false, why: 'one name contains the other' } : { score: Math.min(0.8, jw), auto: false, why: 'only a common word in common' };
  }
  // each name has words the other lacks: different suppliers, however alike they look
  return { score: Math.min(0.85, Math.round((0.5 + 0.35 * matched.length / Math.max(ta.length, tb.length)) * 1000) / 1000), auto: false, why: 'different words' };
}
export const REVIEW_FROM = 0.88;

// ---------------------------------------------------------------- countries --
const COUNTRIES: Record<string, string> = {
  'united arab emirates': 'AE', uae: 'AE', 'u a e': 'AE', emirates: 'AE', 'saudi arabia': 'SA', ksa: 'SA', saudi: 'SA', oman: 'OM', qatar: 'QA', bahrain: 'BH', kuwait: 'KW',
  india: 'IN', china: 'CN', prc: 'CN', 'united states': 'US', usa: 'US', 'u s a': 'US', us: 'US', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB',
  germany: 'DE', france: 'FR', italy: 'IT', spain: 'ES', netherlands: 'NL', belgium: 'BE', switzerland: 'CH', sweden: 'SE', denmark: 'DK', norway: 'NO', finland: 'FI',
  ireland: 'IE', austria: 'AT', poland: 'PL', turkey: 'TR', turkiye: 'TR', egypt: 'EG', jordan: 'JO', lebanon: 'LB', pakistan: 'PK', bangladesh: 'BD', 'sri lanka': 'LK',
  japan: 'JP', 'south korea': 'KR', korea: 'KR', singapore: 'SG', malaysia: 'MY', thailand: 'TH', vietnam: 'VN', indonesia: 'ID', philippines: 'PH', australia: 'AU',
  'new zealand': 'NZ', canada: 'CA', mexico: 'MX', brazil: 'BR', 'south africa': 'ZA', 'hong kong': 'HK', taiwan: 'TW',
};
export function countryCode(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase() === 'UK' ? 'GB' : t.toUpperCase();
  return COUNTRIES[t.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()] ?? null;
}

// ------------------------------------------------------------------ linking --
interface Sup { id: string; name: string; norm: string; key: string; aliases: string[]; reference: string | null }

/** Links every supplier name of a batch to a supplier (creating the new ones). */
export async function resolveSuppliers(c: Tx, tenant: string, batchId: string, origin: 'upload' | 'api' | 'manual') {
  const seen = (await c.query(
    // the most used spelling names the supplier; names with a vendor number and many lines go first, so
    // a typo seen twice is linked to the proper name rather than the other way round
    `SELECT supplier_norm AS norm, mode() WITHIN GROUP (ORDER BY supplier_text) AS name, max(supplier_ref) AS ref, max(supplier_country) AS country
       FROM purchase_line WHERE batch_id = $1 AND supplier_norm <> '' GROUP BY supplier_norm ORDER BY (max(supplier_ref) IS NULL), count(*) DESC, 1`, [batchId])).rows as { norm: string; name: string; ref: string | null; country: string | null }[];
  if (!seen.length) return { linked: 0, created: 0, similar: 0, review: 0 };
  const known = new Map<string, string>((await c.query(`SELECT norm, supplier_id FROM supplier_match`)).rows.map((r) => [r.norm, r.supplier_id]));
  const sups: Sup[] = (await c.query(`SELECT id, name, norm, aliases, reference FROM supplier`)).rows.map((r) => ({ ...r, key: compareKey(r.name) }));
  const byNorm = new Map<string, Sup>(), byRef = new Map<string, Sup>();
  for (const s of sups) { byNorm.set(s.norm, s); for (const a of s.aliases) if (!byNorm.has(a)) byNorm.set(a, s); if (s.reference) byRef.set(s.reference.toLowerCase(), s); }
  // trigram index of compare keys, to compare a new name with a few candidates only
  const index = new Map<string, Set<number>>();
  const addToIndex = (s: Sup, i: number) => { for (const t of trigrams(s.key)) { let set = index.get(t); if (!set) index.set(t, (set = new Set())); set.add(i); } };
  sups.forEach(addToIndex);
  const candidates = (key: string) => {
    const counts = new Map<number, number>();
    for (const t of trigrams(key)) for (const i of index.get(t) ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([i]) => sups[i]!);
  };
  const out = { linked: 0, created: 0, similar: 0, review: 0 };
  const record = async (s: Sup, n: { norm: string; name: string }, method: string, score?: number, similarTo?: string) =>
    c.query(`INSERT INTO supplier_match (tenant_id, supplier_id, name_seen, norm, method, score, similar_to, batch_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, norm) DO NOTHING`,
      [tenant, s.id, n.name, n.norm, method, score ?? null, similarTo ?? null, batchId]);
  for (const n of seen) {
    if (known.has(n.norm)) { out.linked++; continue; }
    const country = countryCode(n.country);
    let s = n.ref ? byRef.get(n.ref.toLowerCase()) : undefined;
    let method = s ? 'reference' : '';
    if (!s) { s = byNorm.get(n.norm); method = s ? (s.norm === n.norm ? 'exact' : 'alias') : ''; }
    let best: { s: Sup; sim: ReturnType<typeof similarity> } | null = null;
    if (!s) {
      for (const cand of candidates(compareKey(n.name))) {
        const sim = similarity(n.name, cand.name);
        if (!best || sim.score > best.sim.score || (sim.auto && !best.sim.auto)) best = { s: cand, sim };
      }
      // two different vendor numbers: the ERP keeps them apart, so a person decides
      if (best?.sim.auto && n.ref && best.s.reference && best.s.reference.toLowerCase() !== n.ref.toLowerCase()) best = { s: best.s, sim: { ...best.sim, auto: false, why: `${best.sim.why}; different vendor numbers` } };
      if (best?.sim.auto) { s = best.s; method = 'similar'; }
    }
    if (s) {
      if (method !== 'exact' && !s.aliases.includes(n.norm) && s.norm !== n.norm) {
        s.aliases.push(n.norm);
        await c.query(`UPDATE supplier SET aliases = array_append(aliases, $2), updated_at = now() WHERE id = $1 AND NOT ($2 = ANY(aliases))`, [s.id, n.norm]);
        byNorm.set(n.norm, s);
      }
      await c.query(`UPDATE supplier SET country = coalesce(country, $2), reference = coalesce(reference, $3) WHERE id = $1`, [s.id, country, n.ref]);
      await record(s, n, method, method === 'similar' ? best!.sim.score : undefined, method === 'similar' ? best!.s.name : undefined);
      if (method === 'similar') out.similar++; else out.linked++;
      continue;
    }
    // a new supplier (possibly a duplicate a person should look at)
    const review = best && best.sim.score >= REVIEW_FROM;
    const r = (await c.query(
      `INSERT INTO supplier (tenant_id, name, norm, origin, country, reference, review, duplicate_of, duplicate_score) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, norm) DO UPDATE SET updated_at = now() RETURNING id, name, norm, aliases, reference`,
      [tenant, n.name.trim(), n.norm, origin, country, n.ref, review ? 'possible_duplicate' : 'ok', review ? best!.s.id : null, review ? best!.sim.score : null])).rows[0];
    const ns: Sup = { ...r, key: compareKey(r.name) };
    sups.push(ns); addToIndex(ns, sups.length - 1); byNorm.set(ns.norm, ns);
    if (ns.reference) byRef.set(ns.reference.toLowerCase(), ns);
    await record(ns, n, 'new', review ? best!.sim.score : undefined, review ? best!.s.name : undefined);
    out.created++; if (review) out.review++;
  }
  // the supplier of each line, from its spelling (matches read once, joined by hash)
  await c.query(`WITH m AS MATERIALIZED (SELECT norm, supplier_id FROM supplier_match WHERE norm IN (SELECT DISTINCT supplier_norm FROM purchase_line WHERE batch_id = $1))
                 UPDATE purchase_line l SET supplier_id = m.supplier_id FROM m WHERE l.batch_id = $1 AND l.supplier_norm = m.norm AND l.supplier_id IS DISTINCT FROM m.supplier_id`, [batchId]);
  return out;
}
