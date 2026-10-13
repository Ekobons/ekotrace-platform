/**
 * Brings the database up to date when the server starts, so pulling new code and running
 * `npm run app` is enough:
 *   1. runs the migrations that have not run yet;
 *   2. loads the factor files (DESNZ 2022–2026, EPA, IPCC) when the database does not have them
 *      yet, or has them from an older version of the importer (e.g. before business travel was added).
 * Quick when nothing is missing (one query). Switch off with AUTO_SETUP=false.
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { IMPORTER_VERSION } from '../import/desnzWrite.js';

const DEFRA = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/defra');

export async function factorsBehind(): Promise<string[]> {
  const files = readdirSync(DEFRA).filter((f) => /^desnz-\d{4}-flat\.xlsx$/.test(f)).map((f) => `DESNZ-${f.slice(6, 10)}`);
  const ok = new Set((await pool.query<{ code: string }>(`SELECT code FROM factor_source WHERE code LIKE 'DESNZ-%' AND importer_version >= $1`, [IMPORTER_VERSION])).rows.map((r) => r.code));
  return files.filter((f) => !ok.has(f));
}

/** Categories the DESNZ files fill: when one has no factor (files loaded before its table existed), load them again. */
const MUST_HAVE = ['bt_air', 'bt_hotel', 'bt_rail', 'bt_bus', 'bt_taxi', 'bt_car', 'bt_sea'];
async function emptySubcategories(): Promise<string[]> {
  return (await pool.query<{ code: string }>(
    `SELECT s.code FROM subcategory s WHERE s.code = ANY($1)
        AND NOT EXISTS (SELECT 1 FROM item i JOIN factor f ON f.item_id = i.id AND f.status = 'active' WHERE i.subcategory_id = s.id)`, [MUST_HAVE])).rows.map((r) => r.code);
}

export async function autoSetup(log: (m: string) => void) {
  if (process.env.AUTO_SETUP === 'false') return;
  const ran = await migrate(log);
  if (ran.length) log(`[setup] ${ran.length} migration(s) applied`);
  const empty = await emptySubcategories();
  if (empty.length) {
    log(`[setup] no factors yet for ${empty.join(', ')}: the DESNZ files are loaded again`);
    await pool.query(`UPDATE factor_source SET importer_version = 0 WHERE code LIKE 'DESNZ-%'`);
  }
  const behind = await factorsBehind();
  if (behind.length) {
    log(`[setup] loading factors (${behind.join(', ')} missing or from an older importer) — about a minute the first time`);
    await seed(log);
    log('[setup] factors loaded');
  }
}
