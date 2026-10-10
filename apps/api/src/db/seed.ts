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
 *  5. US EPA supply chain factors in data/epa/ (purchased goods & services), when the file is there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, platformTx, type Tx } from './pool.js';
import { parseDesnz } from '../import/desnz.js';
import { importDesnz } from '../import/desnzWrite.js';
import { importEpa, parseEpa } from '../import/epa.js';

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
  for (const f of readdirSync(join(DATA, 'epa')).filter((x) => /^SupplyChainGHGEmissionFactors.*\.csv$/i.test(x)).sort()) {
    const parsed = parseEpa(readFileSync(join(DATA, 'epa', f), 'utf8'), f);
    const s = await platformTx((c) => importEpa(c, parsed, { createdBy: 'seed' }));
    log(`[seed] ${s.source}: ${s.skipped ? 'already imported' : `${s.factors} spend factors (${parsed.priceYear} USD)`}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed()
    .catch((e) => { console.error('[seed] failed:', e); process.exitCode = 1; })
    .finally(() => pool.end());
}
