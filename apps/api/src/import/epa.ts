/**
 * Spend-based factors for purchased goods & services.
 *
 * 1. US EPA "Supply Chain Greenhouse Gas Emission Factors for US Industries and Commodities"
 *    v1.3 (the file the old Ekotrace used): SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv
 *    One row per NAICS-6 commodity: kg CO2e per USD (2022, purchaser price) with and without margins.
 *    We use the factor WITH margins (purchaser price: what the company actually pays, incl. transport,
 *    wholesale and retail margins). The price year is read from the unit / file name.
 *    → items "epa:naics:322230" under the NAICS sector, one factor each (basis scope3, unit USD).
 *
 * 2. The old Ekotrace list (exported from its MySQL): purchase_goods_categories_ef with
 *    purchase_category / purchase_subcategory / typesofpurchase. Products with a NAICS code are
 *    linked to the EPA item (their names become aliases, so old descriptions keep matching);
 *    the others become items of their own under "Other (company list)" with their factors.
 */
import { createHash } from 'node:crypto';
import type { Tx } from '../db/pool.js';
import { csvObjects } from '../lib/csv.js';

export interface EpaRow { naics: string; title: string; withMargins: number; withoutMargins: number | null; margins: number | null; useeio: string | null }
export interface EpaParsed { version: string; priceYear: number; rows: EpaRow[]; sha256: string; skipped: number; gasRowsIgnored: number }

const col = (keys: string[], ...res: RegExp[]) => keys.find((k) => res.every((r) => r.test(k)));

export function parseEpa(text: string, filename = ''): EpaParsed {
  const rows = csvObjects(text);
  if (!rows.length) throw new Error('The file is empty');
  const keys = Object.keys(rows[0]!);
  const kCode = col(keys, /naics/i, /code/i), kTitle = col(keys, /naics/i, /title|name|description/i);
  const kWith = keys.find((k) => /with margins/i.test(k) && !/without/i.test(k) && !/^margins/i.test(k));
  const kWithout = col(keys, /without margins/i), kMargins = keys.find((k) => /^margins/i.test(k));
  const kUnit = col(keys, /^unit/i), kGhg = col(keys, /^ghg$/i), kUse = col(keys, /useeio/i);
  if (!kCode || !kTitle || !kWith) throw new Error('Not the EPA supply chain factor file: expected columns "2017 NAICS Code", "2017 NAICS Title" and "Supply Chain Emission Factors with Margins"');
  const unitText = (kUnit && rows[0]![kUnit]) || filename;
  const priceYear = Number(/(20\d\d)\s*USD|USD\s*(20\d\d)/i.exec(unitText)?.slice(1).find(Boolean) ?? /USD(20\d\d)/i.exec(filename)?.[1] ?? NaN);
  if (!Number.isFinite(priceYear)) throw new Error('Price year not found (expected a unit like "kg CO2e/2022 USD, purchaser price")');
  const version = /v(\d+\.\d+(\.\d+)?)/i.exec(filename)?.[1] ?? (priceYear === 2022 ? '1.3' : priceYear === 2021 ? '1.2' : '?');
  const out: EpaRow[] = [];
  let skipped = 0, gasRowsIgnored = 0;
  for (const r of rows) {
    if (kGhg && r[kGhg] && !/all ghg|co2e|total/i.test(r[kGhg]!)) { gasRowsIgnored++; continue; }
    const naics = (r[kCode] ?? '').replace(/\D/g, '');
    const v = Number(r[kWith]);
    if (naics.length < 2 || !Number.isFinite(v) || v < 0) { skipped++; continue; }
    const num = (k?: string) => (k && r[k] !== '' && Number.isFinite(Number(r[k])) ? Number(r[k]) : null);
    out.push({ naics, title: (r[kTitle] ?? '').trim(), withMargins: v, withoutMargins: num(kWithout), margins: num(kMargins), useeio: kUse ? r[kUse] || null : null });
  }
  if (!out.length) throw new Error('No factor rows found');
  return { version, priceYear, rows: out, sha256: createHash('sha256').update(text).digest('hex'), skipped, gasRowsIgnored };
}

/** NAICS sector → subcategory code (manufacturing 31-33, retail 44-45, transport 48-49 share one). */
export function sectorOf(naics: string): string {
  const s = naics.slice(0, 2);
  const shared: Record<string, string> = { '32': '31', '33': '31', '45': '44', '49': '48' };
  return `naics_${shared[s] ?? s}`;
}
/** "Hotels (except Casino Hotels) and Motels" → "Hotels (except casino hotels) and motels" */
const tidy = (t: string) => t.replace(/\s+/g, ' ').trim().replace(/(?<=\S\s)([A-Z])([a-z])/g, (_m, a: string, b: string) => a.toLowerCase() + b).replace(/\bTv\b/g, 'TV');

export interface EpaImport { source: string; skipped: boolean; items: number; factors: number; superseded: number }

export const DEMO_SOURCE = 'DEMO-SPEND';
/** `demo`: the made-up placeholder file for the demo company (never on a real deployment). */
export async function importEpa(c: Tx, p: EpaParsed, opts: { createdBy?: string; demo?: boolean } = {}): Promise<EpaImport> {
  const code = opts.demo ? DEMO_SOURCE : `EPA-SC-${p.version}`;
  const existing = (await c.query('SELECT id, file_sha256 FROM factor_source WHERE code = $1', [code])).rows[0];
  if (existing?.file_sha256 === p.sha256) return { source: code, skipped: true, items: 0, factors: 0, superseded: 0 };
  const sourceId: number = existing
    ? (await c.query('UPDATE factor_source SET file_sha256 = $2, imported_at = now() WHERE id = $1 RETURNING id', [existing.id, p.sha256])).rows[0].id
    : (await c.query(
      `INSERT INTO factor_source (code, publisher, title, year, version, gwp_set, url, licence, file_sha256)
       VALUES ($1,'US EPA',$2,$3,$4,'AR5','https://catalog.data.gov/dataset/supply-chain-greenhouse-gas-emission-factors-for-us-industries-and-commodities','US Government work (public domain)',$5) RETURNING id`,
      [code, opts.demo ? `DEMO placeholder spend factors (made-up values, NOT EPA) — load the EPA v1.3 file` : `Supply Chain GHG Emission Factors for US Industries and Commodities v${p.version} (NAICS, kg CO2e per ${p.priceYear} USD, purchaser price)`, p.priceYear, p.version, p.sha256])).rows[0].id;
  // Real EPA factors replace the demo placeholders.
  if (!opts.demo) await c.query(`UPDATE factor SET status = 'retired' WHERE status = 'active' AND source_id = (SELECT id FROM factor_source WHERE code = $1)`, [DEMO_SOURCE]);
  const subs = new Map<string, number>((await c.query(`SELECT s.code, s.id FROM subcategory s JOIN category c ON c.id = s.category_id WHERE c.code = 'purchased_goods'`)).rows.map((r) => [r.code, r.id]));
  // items, in one statement
  const rows = p.rows.map((r) => ({ ...r, sub: subs.get(sectorOf(r.naics)) ?? subs.get('other')! }));
  const items = await c.query(
    `INSERT INTO item (subcategory_id, code, name, default_unit, attrs, sort)
     SELECT s, 'epa:naics:' || n, t, 'USD', jsonb_build_object('naics', n, 'useeio', u), 100 FROM unnest($1::int[], $2::text[], $3::text[], $4::text[]) AS x(s, n, t, u)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, attrs = item.attrs || EXCLUDED.attrs
     RETURNING id, code`,
    [rows.map((r) => r.sub), rows.map((r) => r.naics), rows.map((r) => tidy(r.title)), rows.map((r) => r.useeio)]);
  const idOf = new Map<string, number>(items.rows.map((r) => [r.code, r.id]));
  // factors: one per item, valid for any purchase year (spend is brought to the price year with the CPI)
  const old = await c.query(
    `UPDATE factor SET status = 'superseded' WHERE source_id = $1 AND status = 'active' RETURNING id, item_id`, [sourceId]);
  const prev = new Map<number, number>(old.rows.map((r) => [r.item_id, r.id]));
  const ins = await c.query(
    `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, price_year, version, supersedes_id, note, created_by)
     SELECT i, $1, 'US', 'scope3', 'USD', v, '2000-01-01', '2100-12-31', $2, CASE WHEN p IS NULL THEN 1 ELSE 2 END, p, nt, $3
       FROM unnest($4::int[], $5::numeric[], $6::bigint[], $7::text[]) AS x(i, v, p, nt)`,
    [sourceId, p.priceYear, opts.createdBy ?? 'importer',
     rows.map((r) => idOf.get(`epa:naics:${r.naics}`)!), rows.map((r) => r.withMargins), rows.map((r) => prev.get(idOf.get(`epa:naics:${r.naics}`)!) ?? null),
     rows.map((r) => `NAICS ${r.naics}. With margins (purchaser price)${r.withoutMargins != null ? `; without margins ${r.withoutMargins}, margins ${r.margins ?? '—'}` : ''}.`)]);
  await refreshAverages(c);
  return { source: code, skipped: false, items: items.rowCount ?? 0, factors: ins.rowCount ?? 0, superseded: old.rowCount ?? 0 };
}

/**
 * The two average factors (services, goods): median of the active EPA factors of those
 * industries, with the same source and price year. Fuels (211, 324), utilities (22) and
 * waste (562) are left out — those purchases are counted from activity data.
 */
export async function refreshAverages(c: Tx) {
  const groups: [string, string][] = [
    ['purchase:average-services', `n ~ '^(4[2-9]|5[1-9]|6[1-2]|7[1-2]|81)' AND n !~ '^562'`],
    ['purchase:average-goods', `n ~ '^(1[1-9]|2[13]|3[1-3])' AND n !~ '^(211|2212|324)'`],
  ];
  for (const [code, where] of groups) {
    const m = (await c.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f.co2e)::float8 AS v, count(*)::int AS n, min(f.source_id) AS source_id, min(f.price_year) AS price_year
         FROM factor f JOIN item i ON i.id = f.item_id CROSS JOIN LATERAL (SELECT i.attrs->>'naics' AS n) x
        WHERE i.code LIKE 'epa:naics:%' AND f.status = 'active' AND f.basis = 'scope3' AND ${where}`)).rows[0];
    if (!m?.n) continue;
    const item = (await c.query('SELECT id FROM item WHERE code = $1', [code])).rows[0]?.id;
    if (!item) continue;
    const cur = (await c.query(`SELECT id, co2e::float8 AS co2e, source_id FROM factor WHERE item_id = $1 AND status = 'active'`, [item])).rows[0];
    if (cur && Math.abs(cur.co2e - m.v) < 1e-9 && cur.source_id === m.source_id) continue;
    if (cur) await c.query(`UPDATE factor SET status = 'superseded' WHERE id = $1`, [cur.id]);
    await c.query(
      `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, price_year, version, supersedes_id, note, created_by)
       VALUES ($1, $2, 'US', 'scope3', 'USD', $3, '2000-01-01', '2100-12-31', $4, $5, $6, $7, 'importer')`,
      [item, m.source_id, Math.round(m.v * 1e6) / 1e6, m.price_year, cur ? 2 : 1, cur?.id ?? null, `Median of ${m.n} EPA factors (with margins). Fallback for small purchases nothing else identifies.`]);
  }
}

// ------------------------------------------------------- old Ekotrace list --
/**
 * The previous Ekotrace list (exported from its MySQL): purchase_goods_categories_ef with
 * purchase_category / purchase_subcategory / typesofpurchase.
 *
 * What it holds: 1,645 products (e.g. "Cereal - Barley grain", "LPG", "Office Products")
 * under 62 categories and 252 subcategories, each with a NAICS code. Its per-currency factor is
 * the EPA per-USD factor converted at one rate per country and fiscal year (UAE ÷ 3.6725) with
 * no inflation adjustment — Ekotrace now converts each purchase itself (month rate, CPI), so
 * that column is not used. Its per-kg factors are not imported either: they vary by country
 * and year for the same product and imply implausible prices.
 *
 * Imported: each product as a spend category of its own (old category › subcategory kept),
 * with the EPA v1.3 factor of its NAICS code; capital goods and "other category" flags kept.
 */
export interface OldList {
  factors: Record<string, string>[];          // purchase_goods_categories_ef
  categories?: Record<string, string>[];      // dbo.purchase_category
  subcategories?: Record<string, string>[];   // dbo.purchase_subcategory
  types?: Record<string, string>[];           // dbo.typesofpurchase
}
export interface OldProduct { product: string; naics: string; type: string; category: string; subcategory: string; otherCategory: boolean }
export interface OldImport { products: number; created: number; updated: number; naicsMapped: { from: string; to: string }[]; notFound: string[] }

const val = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) { const k = Object.keys(r).find((x) => x.toLowerCase() === n.toLowerCase()); if (k && r[k] !== '' && r[k] !== 'NULL') return r[k]!.trim(); }
  return '';
};

/** Distinct products of an export (product × NAICS × type of purchase). */
export function oldProducts(l: OldList): OldProduct[] {
  const cat = new Map((l.categories ?? []).map((r) => [val(r, 'id'), val(r, 'name')]));
  const sub = new Map((l.subcategories ?? []).map((r) => [val(r, 'id'), val(r, 'name')]));
  const typ = new Map((l.types ?? []).map((r) => [val(r, 'id'), val(r, 'typesofpurchasename', 'name')]));
  const out = new Map<string, OldProduct>();
  for (const r of l.factors) {
    const product = val(r, 'product').replace(/\s+/g, ' ');
    const naics = val(r, 'NAIC_code', 'naics').replace(/\D/g, '');
    if (!product) continue;
    const t = val(r, 'typeofpurchase');
    const p: OldProduct = {
      product, naics, type: typ.get(t) ?? val(r, 'type') ?? t, category: cat.get(val(r, 'category')) ?? val(r, 'category'),
      subcategory: sub.get(val(r, 'sub_category', 'subcategory')) ?? val(r, 'sub_category', 'subcategory'), otherCategory: ['1', 'true'].includes(val(r, 'other_category_flag', 'otherCategory')),
    };
    const key = `${product.toLowerCase()}|${naics}|${p.type}`;
    const old = out.get(key);
    out.set(key, old ? { ...old, otherCategory: old.otherCategory || p.otherCategory } : p);
  }
  return [...out.values()];
}

const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function importOldProducts(c: Tx, products: OldProduct[], opts: { createdBy?: string } = {}): Promise<OldImport> {
  // EPA factor per NAICS code (active, the real file — not the demo placeholders)
  const epa = new Map<string, { item: number; factor: number; co2e: number; source: number; price: number }>((await c.query(
    `SELECT i.attrs->>'naics' AS naics, i.id AS item, f.id AS factor, f.co2e::float8 AS co2e, f.source_id AS source, f.price_year AS price
       FROM item i JOIN factor f ON f.item_id = i.id AND f.status = 'active' JOIN factor_source s ON s.id = f.source_id
      WHERE i.code LIKE 'epa:naics:%' AND s.code LIKE 'EPA-SC-%'`)).rows.map((r) => [r.naics, r]));
  if (!epa.size) throw new Error('Load the EPA supply chain factor file first');
  const codes = [...epa.keys()];
  // 2012 NAICS codes merged in 2017 (327121 → 327120): same 5 digits; a few codes of the old list that
  // are not NAICS codes → the closest EPA code. Government administration (92) has no EPA factor.
  const CLOSEST: Record<string, string> = { 333291: '333249', 333293: '333249', 333220: '333249', 441330: '441310', 521120: '521110', 521130: '521110', 521140: '521110', 115120: '115116' };
  const resolve = (n: string) => epa.has(n) ? n : (CLOSEST[n] && epa.has(CLOSEST[n]) ? CLOSEST[n]! : null) ?? codes.find((x) => x === `${n.slice(0, 5)}0`) ?? codes.find((x) => x.startsWith(n.slice(0, 5))) ?? null;
  const subs = new Map<string, number>((await c.query(`SELECT s.code, s.id FROM subcategory s JOIN category c ON c.id = s.category_id WHERE c.code = 'purchased_goods'`)).rows.map((r) => [r.code, r.id]));
  const naicsMapped: { from: string; to: string }[] = [], notFound: string[] = [];
  let created = 0, updated = 0;
  for (const p of products) {
    const n = resolve(p.naics);
    if (!n) { notFound.push(`${p.product} (NAICS ${p.naics || '—'})`); continue; }
    if (n !== p.naics && !naicsMapped.some((m) => m.from === p.naics)) naicsMapped.push({ from: p.naics, to: n });
    const e = epa.get(n)!;
    const code = `old:${slugOf(p.type || 'x')}:${n}:${slugOf(p.product)}`;
    const capital = /capital/i.test(p.type);
    const attrs = { naics: n, group: [p.category, p.subcategory].filter(Boolean).join(' › '), oldType: p.type, capital, otherCategory: p.otherCategory, source: 'previous Ekotrace list' };
    const r = (await c.query(
      `INSERT INTO item (subcategory_id, code, name, default_unit, attrs, sort) VALUES ($1, $2, $3, 'USD', $4, 200)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, attrs = EXCLUDED.attrs, active = true RETURNING id, (xmax = 0) AS inserted`,
      [subs.get(sectorOf(n)) ?? subs.get('other'), code, p.product, JSON.stringify(attrs)])).rows[0];
    r.inserted ? created++ : updated++;
    await c.query(`UPDATE factor SET status = 'superseded' WHERE item_id = $1 AND status = 'active' AND (co2e <> $2 OR source_id <> $3)`, [r.id, e.co2e, e.source]);
    await c.query(
      `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, price_year, note, created_by)
       SELECT $1, $2, 'US', 'scope3', 'USD', $3, '2000-01-01', '2100-12-31', $4, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM factor WHERE item_id = $1 AND status = 'active')`,
      [r.id, e.source, e.co2e, e.price, `EPA factor of NAICS ${n} (product of the previous Ekotrace list)`, opts.createdBy ?? 'importer']);
  }
  return { products: products.length, created, updated, naicsMapped, notFound };
}
