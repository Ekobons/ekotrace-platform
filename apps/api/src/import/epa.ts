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
  return { source: code, skipped: false, items: items.rowCount ?? 0, factors: ins.rowCount ?? 0, superseded: old.rowCount ?? 0 };
}

// ------------------------------------------------------- old Ekotrace list --
export interface OldList {
  /** purchase_goods_categories_ef rows */
  factors: Record<string, string>[];
  categories?: Record<string, string>[];      // dbo.purchase_category
  subcategories?: Record<string, string>[];   // dbo.purchase_subcategory
  types?: Record<string, string>[];           // dbo.typesofpurchase
}
export interface OldImport { linked: number; created: number; factors: number; skipped: number; notes: string[] }

/**
 * `currency` / `priceYear`: what EFkgC02e_ccy is per (the old tool used EPA factors in USD).
 * Only the newest fiscal year of each product is loaded.
 */
export async function importOldList(c: Tx, l: OldList, opts: { currency: string; priceYear: number; createdBy?: string }): Promise<OldImport> {
  const get = (r: Record<string, string>, ...names: string[]) => { for (const n of names) { const k = Object.keys(r).find((x) => x.toLowerCase() === n.toLowerCase()); if (k && r[k] !== '' && r[k] !== 'NULL') return r[k]!.trim(); } return ''; };
  const catName = new Map((l.categories ?? []).map((r) => [get(r, 'id'), get(r, 'name')]));
  const subName = new Map((l.subcategories ?? []).map((r) => [get(r, 'id'), get(r, 'name')]));
  const typeName = new Map((l.types ?? []).map((r) => [get(r, 'id'), get(r, 'typesofpurchasename', 'name')]));
  const notes: string[] = [];
  // newest fiscal year per product
  const newest = new Map<string, Record<string, string>>();
  for (const r of l.factors) {
    const key = `${get(r, 'product').toLowerCase()}|${get(r, 'NAIC_code', 'naic_code')}`;
    const fy = Number(get(r, 'Fiscal_Year').slice(-4)) || 0;
    const cur = newest.get(key);
    if (!cur || (Number(get(cur, 'Fiscal_Year').slice(-4)) || 0) < fy) newest.set(key, r);
  }
  const src = (await c.query(
    `INSERT INTO factor_source (code, publisher, title, year, version) VALUES ('EKOTRACE-OLD', 'Ekotrace (previous platform)', 'Purchased goods list of the previous Ekotrace platform', $1, '1')
     ON CONFLICT (code) DO UPDATE SET imported_at = now() RETURNING id`, [opts.priceYear])).rows[0].id;
  const other = (await c.query(`SELECT s.id FROM subcategory s JOIN category c ON c.id = s.category_id WHERE c.code = 'purchased_goods' AND s.code = 'other'`)).rows[0].id;
  let linked = 0, created = 0, factors = 0, skipped = 0;
  for (const r of newest.values()) {
    const product = get(r, 'product'), naics = get(r, 'NAIC_code', 'naic_code').replace(/\D/g, '');
    if (!product) { skipped++; continue; }
    const group = [catName.get(get(r, 'category')) ?? get(r, 'category'), subName.get(get(r, 'sub_category')) ?? get(r, 'sub_category')].filter(Boolean).join(' › ');
    const type = typeName.get(get(r, 'typeofpurchase')) ?? '';
    const aliases = [product, ...group.split(' › ')].filter(Boolean);
    const epa = naics ? (await c.query(`SELECT id FROM item WHERE code = $1`, [`epa:naics:${naics}`])).rows[0] : undefined;
    if (epa) {
      await c.query(`UPDATE item SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || $2::text[]) a), attrs = attrs || $3 WHERE id = $1`,
        [epa.id, aliases, JSON.stringify({ oldGroup: group, oldType: type, oldId: get(r, 'id') })]);
      linked++;
      continue;
    }
    const it = (await c.query(
      `INSERT INTO item (subcategory_id, code, name, aliases, default_unit, attrs) VALUES ($1, $2, $3, $4, 'USD', $5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, aliases = EXCLUDED.aliases, attrs = EXCLUDED.attrs RETURNING id`,
      [other, `old:${get(r, 'id') || product.toLowerCase()}`, product, aliases.slice(1), JSON.stringify({ group, oldType: type, naics: naics || null, hsn: get(r, 'HSN_code') || null, isic: get(r, 'ISIC_code') || null, capital: /capital/i.test(type) })])).rows[0];
    created++;
    await c.query(`UPDATE factor SET status = 'superseded' WHERE item_id = $1 AND source_id = $2 AND status = 'active'`, [it.id, src]);
    for (const [colName, unit, py] of [['EFkgC02e_ccy', opts.currency, opts.priceYear], ['EFkgC02e_kg', 'kg', null], ['EFkgC02e_tonnes', 't', null], ['EFkgC02e_litres', 'L', null]] as const) {
      const v = Number(get(r, colName));
      if (!get(r, colName) || !Number.isFinite(v) || v <= 0) continue;
      await c.query(
        `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, price_year, note, created_by)
         VALUES ($1,$2,'GLOBAL','scope3',$3,$4,'2000-01-01','2100-12-31',$5,$6,$7)`,
        [it.id, src, unit, v, py, `Previous Ekotrace list${get(r, 'reference') ? `: ${get(r, 'reference')}` : ''}`, opts.createdBy ?? 'importer']);
      factors++;
    }
  }
  if (!l.categories) notes.push('Category names not supplied (purchase_category): category ids used instead.');
  return { linked, created, factors, skipped, notes };
}
