/**
 * Loads reference data and factors. Safe to run again: every step skips what
 * is already there.
 *
 *   npm run db:seed
 *
 *  1. Gases and GWP values (AR4, AR5, AR6) from data/gwp/gases.csv
 *     (GHG Protocol "Global Warming Potential Values", Aug 2024; AR4/AR5 checked
 *     against the DESNZ 2022 and 2026 gas tables — all match).
 *  2. Refrigerant blend compositions from data/gwp/blends.json (25 blends,
 *     each reproducing the DESNZ AR4 and AR5 blend GWP within 1 %).
 *  3. DESNZ flat files in data/defra/ (one edition per year).
 *  4. IPCC 2006 defaults for coal types DESNZ does not cover.
 *  5. US EPA supply chain factors in data/epa/ (purchased goods & services), when the file is there,
 *     then the products of the previous Ekotrace list (data/ekotrace-old/products.csv) on top.
 *  6. Grid electricity factors of other countries from data/grid/grid-factors.csv (US EPA eGRID,
 *     EU EEA, Australia NGA, India CEA, Singapore EMA, China MEE, Japan): regions and factors per year.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, platformTx, type Tx } from './pool.js';
import { parseDesnz } from '../import/desnz.js';
import { importDesnz } from '../import/desnzWrite.js';
import { importEpa, importOldProducts, parseEpa, refreshAverages, versionRank, type OldProduct } from '../import/epa.js';
import { csvObjects } from '../lib/csv.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../../../data');

function csv(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const cols = head!.split(',');
  return lines.map((l) => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? '']));
  });
}

export async function seedGases(c: Tx) {
  const rows = csv(join(DATA, 'gwp/gases.csv'));
  rows.forEach((r, i) => (r.sort = String(i + 1)));
  for (const r of rows) {
    await c.query(
      `INSERT INTO gas (code, name, formula, family, kyoto, aliases, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, formula=EXCLUDED.formula, family=EXCLUDED.family, kyoto=EXCLUDED.kyoto, aliases=EXCLUDED.aliases`,
      [r.code, r.name, r.formula, r.family, r.kyoto === '1', r.desnz_name ? [r.desnz_name] : [], Number(r.sort)],
    );
    for (const set of ['AR4', 'AR5', 'AR6']) {
      if (r[set] === '') continue;
      const src = r.family === 'Hydrocarbon' || ['HFO-1234yf', 'HFO-1234ze', 'DME'].includes(r.code!)
        ? (set === 'AR4' ? 'DESNZ 2022 gas table' : set === 'AR5' ? 'DESNZ 2026 gas table' : 'AR6 value from GHG Protocol where listed, else DESNZ 2026 (AR5)')
        : 'GHG Protocol, Global Warming Potential Values (Aug 2024)';
      await c.query(
        `INSERT INTO gwp_value (gwp_set, gas, value, source) VALUES ($1,$2,$3,$4)
         ON CONFLICT (gwp_set, gas) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source`,
        [set, r.code, Number(r[set]), src],
      );
    }
  }
  return rows.length;
}

export async function seedBlends(c: Tx) {
  const blends: Record<string, Record<string, number>> = JSON.parse(readFileSync(join(DATA, 'gwp/blends.json'), 'utf8'));
  const sub = (await c.query(`SELECT id FROM subcategory WHERE code = 'refrigerant_blends'`)).rows[0].id;
  for (const [name, comp] of Object.entries(blends)) {
    const code = `blend:${name.toLowerCase()}`;
    const item = (await c.query(
      `INSERT INTO item (subcategory_id, code, name, default_unit, note) VALUES ($1,$2,$3,'kg',$4)
       ON CONFLICT (code) DO UPDATE SET note = EXCLUDED.note RETURNING id`,
      [sub, code, name.replace(/^R(\d)/, 'R-$1'), 'Composition per ASHRAE 34; reproduces DESNZ blend GWP (AR4 and AR5)'],
    )).rows[0].id;
    for (const [gas, fraction] of Object.entries(comp)) {
      await c.query(
        `INSERT INTO item_gas (item_id, gas, fraction, source) VALUES ($1,$2,$3,'ASHRAE 34')
         ON CONFLICT (item_id, gas) DO UPDATE SET fraction = EXCLUDED.fraction`,
        [item, gas, fraction],
      );
    }
  }
  // Common fugitive sources that are a single gas but deserve their own name.
  const other = (await c.query(`SELECT id FROM subcategory WHERE code = 'other_gases'`)).rows[0].id;
  for (const [code, name, gas, note] of [
    ['gas:co2-extinguisher', 'CO2 (fire extinguishers)', 'CO2', 'Mass of CO2 discharged or refilled'],
    ['gas:methane-natural-gas-leak', 'Methane — natural gas leak (fossil)', 'CH4_fossil', 'Leaks from gas pipework; uses fossil methane GWP'],
  ] as const) {
    await c.query(
      `INSERT INTO item (subcategory_id, code, name, default_unit, gas_code, note) VALUES ($1,$2,$3,'kg',$4,$5) ON CONFLICT (code) DO NOTHING`,
      [other, code, name, gas, note],
    );
  }
  return Object.keys(blends).length;
}

/**
 * IPCC 2006 Guidelines, Vol. 2 (Energy): NCV from Table 1.2 (TJ/Gg), CO2 from
 * Table 1.4 (kg/TJ), CH4 and N2O from Table 2.3, manufacturing industries
 * (10 and 1.5 kg/TJ). Valid for any year; no well-to-tank values exist in IPCC.
 */
const IPCC_COALS = [
  { code: 'ipcc:anthracite', name: 'Anthracite', ncv: 26.7, co2: 98300, aliases: ['Anthracite (Domestic coal)'] },
  { code: 'ipcc:other-bituminous-coal', name: 'Other bituminous coal', ncv: 25.8, co2: 94600, aliases: ['Bituminous'] },
  { code: 'ipcc:sub-bituminous-coal', name: 'Sub-bituminous coal', ncv: 18.9, co2: 96100, aliases: ['Sub Bituminous'] },
  { code: 'ipcc:lignite', name: 'Lignite', ncv: 11.9, co2: 101000, aliases: ['Lignite'] },
];

export async function seedIpccCoals(c: Tx) {
  const done = (await c.query(`SELECT 1 FROM factor_source WHERE code = 'IPCC-2006-V2'`)).rowCount;
  if (done) return 0;
  const src = (await c.query(
    `INSERT INTO factor_source (code, publisher, title, year, url) VALUES ('IPCC-2006-V2','IPCC',
     '2006 IPCC Guidelines for National Greenhouse Gas Inventories, Vol. 2 Energy (Tables 1.2, 1.4, 2.3)', 2006,
     'https://www.ipcc-nggip.iges.or.jp/public/2006gl/vol2.html') RETURNING id`,
  )).rows[0].id;
  const sub = (await c.query(`SELECT id FROM subcategory WHERE code = 'solid_fuels'`)).rows[0].id;
  const CH4 = 10, N2O = 1.5; // kg/TJ
  for (const k of IPCC_COALS) {
    const item = (await c.query(
      `INSERT INTO item (subcategory_id, code, name, aliases, default_unit, note) VALUES ($1,$2,$3,$4,'t',$5)
       ON CONFLICT (code) DO UPDATE SET aliases = EXCLUDED.aliases RETURNING id`,
      [sub, k.code, k.name, k.aliases, `IPCC 2006 default; NCV ${k.ncv} TJ/Gg`],
    )).rows[0].id;
    const perTJ: [string, number][] = [['CO2', k.co2], ['CH4_fossil', CH4], ['N2O', N2O]];
    for (const [unit, tjPerUnit] of [['kg', k.ncv / 1e6], ['kWh', 1 / 277777.777778]] as const) {
      const f = (await c.query(
        `INSERT INTO factor (item_id, source_id, basis, unit, co2e, valid_from, valid_to, note, created_by)
         VALUES ($1,$2,'direct',$3,NULL,'2006-01-01','2099-12-31','IPCC default — no published CO2e; computed per gas','seed') RETURNING id`,
        [item, src, unit],
      )).rows[0].id;
      await c.query(
        'INSERT INTO factor_gas (factor_id, gas, kg_per_unit) SELECT $1, * FROM unnest($2::text[], $3::numeric[])',
        [f, perTJ.map((g) => g[0]), perTJ.map((g) => g[1] * tjPerUnit)],
      );
    }
  }
  await c.query(
    `INSERT INTO import_issue (source_id, severity, message) VALUES ($1,'warning',$2)`,
    [src, 'IPCC coal defaults were entered by hand from the 2006 Guidelines. Check them against the source before relying on them for a client report.'],
  );
  return IPCC_COALS.length;
}

const GRID_PUBLISHER: Record<string, string> = {
  'EPA-eGRID2023': 'US Environmental Protection Agency', 'EEA-GHGI-ELEC-2022': 'European Environment Agency',
  'AU-NGA-2025': 'Australian Government DCCEEW', 'IN-CEA-V20': 'Central Electricity Authority (India)',
  'SG-EMA-GEF': 'Energy Market Authority (Singapore)', 'CN-MEE-2023': 'Ministry of Ecology and Environment (China)',
  'JP-MOE-METI-2024': 'Ministry of the Environment / METI (Japan)',
  'EPA-eGRID2023-ST': 'US Environmental Protection Agency', 'NZ-MFE-2025': 'Ministry for the Environment (New Zealand)',
  'ZA-DFFE-2023': 'Department of Forestry, Fisheries and the Environment (South Africa)',
  'MY-ST-GEF-2024': 'Energy Commission (Suruhanjaya Tenaga, Malaysia)', 'TR-ETKB-2022': 'Ministry of Energy and Natural Resources (Türkiye)',
  'HK-CLP-2024': 'CLP Power Hong Kong', 'HK-HKE-2025': 'HK Electric', 'KR-GIR-2023': 'Ministry of Climate, Energy and Environment (Korea)',
  'TW-MOEA-2025': 'MOEA Energy Administration (Taiwan)', 'BR-MCTI-2023': 'Ministry of Science, Technology and Innovation (Brazil)',
  'PH-DOE-NGEF': 'Department of Energy (Philippines)', 'IGES-GEF': 'Institute for Global Environmental Strategies (IGES)',
  'EKOTRACE-PREV': 'Ekobon (previous Ekotrace list)',
  'AE-MOCCAE-NDC3': 'Ministry of Climate Change and Environment (UAE)', 'AE-DEWA-CCR2021': 'Dubai Electricity and Water Authority',
  'AE-EWEC-2023': 'Emirates Water and Electricity Company', 'OM-PWP-2025': 'Nama Power and Water Procurement (Oman)',
  'SA-CT-2022': 'Climate Transparency', 'UNFCCC-IFI-2019': 'UNFCCC / International Financial Institutions',
};
const GRID_BASIS: Record<string, string> = { location: 'scope2', residual: 'scope2_market', td_loss: 'td_loss', wtt: 'wtt' };
export const GRID_FILE = join(DATA, 'grid', 'grid-factors.csv');

/** Source codes in the grid file (to see whether the database has them). */
export function gridSourceCodes(): string[] {
  if (!existsSync(GRID_FILE)) return [];
  return [...new Set(csvObjects(readFileSync(GRID_FILE, 'utf8')).map((r) => r.source_code!))];
}

/**
 * Typical energy intensity of building types (kWh per m² per year, data/buildings/energy-intensity.csv), for the
 * floor-area method of warehousing (3.4, 3.9) and leased buildings (3.8, 3.13). One item per type in each of
 * those subcategories; the value and its source are kept on the item and shown in each calculation.
 */
export const BUILDINGS_FILE = join(DATA, 'buildings', 'energy-intensity.csv');
export async function seedBuildings(c: Tx) {
  if (!existsSync(BUILDINGS_FILE)) return { items: 0 };
  const rows = csvObjects(readFileSync(BUILDINGS_FILE, 'utf8'));
  const subs = new Map<string, number>((await c.query(
    `SELECT code, id FROM subcategory WHERE code IN ('t4_store_area','t9_store_area','l8_bld_area','l13_bld_area')`)).rows.map((r) => [r.code, r.id]));
  let n = 0;
  for (const [sub, sid] of subs) {
    const storage = sub.startsWith('t');
    for (const [i, r] of rows.entries()) {
      if (storage ? r.use === 'building' : false) continue;
      const eui = Number(r.kwh_per_m2_year);
      if (!Number.isFinite(eui) || eui <= 0) throw new Error(`energy-intensity.csv: bad value for ${r.key}`);
      const src = `${r.basis === 'electricity' ? 'electricity' : 'all energy'} ${eui} kWh/m²/yr — ${r.source}`;
      const note = `Floor area × time × ${eui} kWh per m² per year (${r.basis === 'electricity' ? 'electricity' : 'all energy at site, counted as electricity'}) × the facility's grid factor. ${r.source}.${r.note ? ` ${r.note}.` : ''}`;
      await c.query(
        `INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs) VALUES ($1,$2,$3,'m2_month',$4,$5,$6)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, note = EXCLUDED.note, sort = EXCLUDED.sort, attrs = EXCLUDED.attrs`,
        [sid, `${sub}:${r.key}`, r.name, note, i, JSON.stringify({ eui, euiSource: src, basis: r.basis, url: r.url })]);
      n++;
    }
  }
  return { items: n };
}

/**
 * Grid factors of other countries. Safe to run again: a factor with the same value is kept,
 * a changed one is superseded (kept as history), regions are added or renamed.
 */
export async function seedGrid(c: Tx) {
  if (!existsSync(GRID_FILE)) return { regions: 0, added: 0, superseded: 0, kept: 0 };
  const rows = csvObjects(readFileSync(GRID_FILE, 'utf8'));
  const item = (await c.query(`SELECT id FROM item WHERE code = 'grid:electricity'`)).rows[0]?.id;
  if (!item) throw new Error('item grid:electricity missing — run the migrations first');
  const regions = new Map<string, Record<string, string>>();
  for (const r of rows) if (!regions.has(r.region!)) regions.set(r.region!, r);
  for (const [code, r] of regions) {
    await c.query(
      `INSERT INTO grid_region (code, country, name, kind, note) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, note = COALESCE(grid_region.note, EXCLUDED.note)`,
      [code, r.country, r.name, r.kind, `Factors from ${r.source_code!.replace(/-/g, ' ')}`]);
  }
  const sources = new Map<string, number>();
  for (const r of rows) {
    if (sources.has(r.source_code!)) continue;
    const id = (await c.query(
      `INSERT INTO factor_source (code, publisher, title, year, url) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET publisher = EXCLUDED.publisher, title = EXCLUDED.title, url = EXCLUDED.url RETURNING id`,
      [r.source_code, GRID_PUBLISHER[r.source_code!] ?? r.source_code!.split('-')[0], r.source_title, Number(r.year), r.url])).rows[0].id;
    sources.set(r.source_code!, id);
  }
  let added = 0, superseded = 0, kept = 0;
  for (const r of rows) {
    const basis = GRID_BASIS[r.basis!];
    if (!basis) throw new Error(`grid-factors.csv: unknown basis ${r.basis}`);
    const co2e = Number(r.kg_co2e_per_kwh);
    if (!Number.isFinite(co2e) || co2e < 0) throw new Error(`grid-factors.csv: bad factor for ${r.region} ${r.year}`);
    const vf = `${r.year}-01-01`;
    const old = (await c.query(`SELECT id, co2e, version FROM factor WHERE item_id=$1 AND region=$2 AND basis=$3 AND unit='kWh_e' AND valid_from=$4 AND status='active'`,
      [item, r.region, basis, vf])).rows[0];
    if (old && Math.abs(Number(old.co2e) - co2e) < 1e-9) { kept++; continue; }
    if (old) { await c.query(`UPDATE factor SET status = 'superseded' WHERE id = $1`, [old.id]); superseded++; }
    await c.query(
      `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, version, supersedes_id, note, created_by)
       VALUES ($1,$2,$3,$4,'kWh_e',$5,$6,$7,$8,$9,$10,'seed')`,
      [item, sources.get(r.source_code!), r.region, basis, co2e, vf, `${r.year}-12-31`, old ? old.version + 1 : 1, old?.id ?? null, r.note || null]);
    added++;
  }
  if (added) await c.query(`SELECT pg_notify('refdata_changed', 'grid')`);
  return { regions: regions.size, added, superseded, kept };
}

export async function seed(log = console.log) {
  await platformTx(async (c) => {
    log(`[seed] gases: ${await seedGases(c)}`);
    log(`[seed] blends with composition: ${await seedBlends(c)}`);
  });
  const files = readdirSync(join(DATA, 'defra')).filter((f) => /^desnz-\d{4}-flat\.xlsx$/.test(f)).sort();
  for (const f of files) {
    const parsed = await parseDesnz(join(DATA, 'defra', f));
    const s = await platformTx((c) => importDesnz(c, parsed, { createdBy: 'seed' }));
    log(`[seed] ${s.source}: ${s.skipped ? 'already imported' : `${s.factors} factors, ${s.items} items, ${s.issues} issues`}`);
  }
  await platformTx(async (c) => log(`[seed] IPCC coals: ${await seedIpccCoals(c)}`));
  // US EPA supply chain factors (purchased goods & services), when the file is in data/epa/
  // oldest version first, so the newest ends up in use (each supersedes the one before; history kept)
  const epaFiles = readdirSync(join(DATA, 'epa')).filter((x) => /^SupplyChainGHGEmissionFactors.*\.csv$/i.test(x))
    .map((f) => parseEpa(readFileSync(join(DATA, 'epa', f), 'utf8'), f)).sort((a, b) => versionRank(a.version) - versionRank(b.version));
  for (const parsed of epaFiles) {
    const s = await platformTx((c) => importEpa(c, parsed, { createdBy: 'seed' }));
    log(`[seed] ${s.source}: ${s.skipped ? `skipped (${s.reason})` : `${s.factors} spend factors (${parsed.priceYear} USD)${s.superseded ? `, ${s.superseded} earlier factors superseded` : ''}${s.products ? `, ${s.products} products of the previous list updated` : ''}`}`);
  }
  await platformTx((c) => refreshAverages(c));   // average services / goods factors (fallback)
  // products of the previous Ekotrace list, on top of the EPA codes
  const old = join(DATA, 'ekotrace-old', 'products.csv');
  if (existsSync(old) && (await platformTx((c) => c.query(`SELECT 1 FROM factor_source WHERE code LIKE 'EPA-SC-%'`))).rowCount) {
    const products: OldProduct[] = csvObjects(readFileSync(old, 'utf8')).map((r) => ({ product: r.product!, naics: r.naics!, type: r.type!, category: r.category!, subcategory: r.subcategory!, otherCategory: r.otherCategory === '1' }));
    const r = await platformTx((c) => importOldProducts(c, products, { createdBy: 'seed' }));
    log(`[seed] previous Ekotrace products: ${r.created} new, ${r.updated} updated${r.notFound.length ? `, ${r.notFound.length} without an EPA code` : ''}`);
  }
  const bl = await platformTx((c) => seedBuildings(c));
  log(`[seed] building energy intensities: ${bl.items} items`);
  const g = await platformTx((c) => seedGrid(c));
  log(`[seed] grid factors: ${g.regions} regions, ${g.added} added${g.superseded ? ` (${g.superseded} replaced)` : ''}, ${g.kept} unchanged`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .catch((e) => { console.error('[seed] failed:', e); process.exitCode = 1; })
    .finally(() => pool.end());
}
