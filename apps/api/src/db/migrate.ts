/**
 * Runs every migrations/*.sql file that has not run yet, in name order, each
 * in its own transaction. Applied files are recorded in schema_migration.
 *
 *   npm run db:migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { pool, tx } from './pool.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function migrate(log = console.log): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migration')).rows.map((r) => r.name));
  const ran: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    log(`[migrate] ${file}`);
    await tx(async (c) => {
      await c.query(readFileSync(join(dir, file), 'utf8'));
      await c.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate()
    .then((r) => console.log(r.length ? `[migrate] done (${r.length})` : '[migrate] nothing to do'))
    .catch((e) => { console.error('[migrate] failed:', e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
