/**
 * Brings the database up to date when the server starts, so pulling new code and running
 * `npm run app` is enough:
 *   1. runs the migrations that have not run yet;
 *   2. loads the factor files (DESNZ 2022–2026, EPA, IPCC) when the database does not have them
 *      yet, or has them from an older version of the importer (e.g. before business travel was added);
 *   3. loads the grid factors of other countries (data/grid) when a source in that file is missing.
 * Quick when nothing is missing (one query). Switch off with AUTO_SETUP=false.
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, platformTx } from './pool.js';
import { config } from '../config.js';
import { sealFile } from '../lib/secrets.js';
import { migrate } from './migrate.js';
import { seed, seedGrid, gridSourceCodes } from './seed.js';
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

/** Row-level security keeps companies apart only when the application is NOT a superuser (or BYPASSRLS). */
export async function checkDbRole(log: (m: string) => void) {
  const r = (await pool.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)).rows[0];
  if (!r?.rolsuper && !r?.rolbypassrls) return;
  const msg = 'The database user is a superuser or has BYPASSRLS: row-level security (company separation) would not apply. Connect as an ordinary role (see README).';
  if (config.https) throw new Error(msg);
  log(`[security] WARNING: ${msg}`);
}

/** Files stored before encryption at rest: encrypted in batches (each row checked by its marker). */
export async function encryptStoredFiles(log: (m: string) => void = () => {}) {
  let n = 0;
  for (;;) {
    const done = await platformTx(async (c) => {
      const rows = (await c.query(`SELECT id, data FROM document WHERE substring(data FROM 1 FOR 4) <> '\\x454b4631'::bytea ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`)).rows;
      for (const r of rows) await c.query('UPDATE document SET data = $2 WHERE id = $1', [r.id, sealFile(r.data)]);
      return rows.length;
    });
    n += done;
    if (done < 100) break;
  }
  if (n) log(`[security] ${n} stored files encrypted (AES-256-GCM)`);
  return n;
}

export async function autoSetup(log: (m: string) => void) {
  await checkDbRole(log);
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
  await encryptStoredFiles(log);
  // grid factors of other countries: every start (a second or two); a changed value is superseded, history kept
  if (gridSourceCodes().length) {
    const g = await platformTx((c) => seedGrid(c));
    if (g.added) log(`[setup] grid factors of other countries: ${g.regions} regions, ${g.added} added${g.superseded ? ` (${g.superseded} replaced)` : ''}`);
  }
}
