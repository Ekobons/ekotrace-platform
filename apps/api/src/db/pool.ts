/**
 * Database access.
 *
 *  db.query(sql, params)          read-only reference data (catalogue, factors)
 *  db.tx(fn)                      a transaction
 *  db.tenantTx(tenantId, fn)      a transaction in which row-level security
 *                                 limits every query to that client's rows
 *
 * Always pass values as parameters ($1, $2…), never by building SQL text.
 */
import pg from 'pg';
import { config } from '../config.js';

// numeric → JS number (factor values have ≤ 15 significant digits, within double precision)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (bigserial ids) → number
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date → 'yyyy-mm-dd' string (no time-zone shifts)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolSize });

export type Tx = pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}

export async function tx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Transaction scoped to one client: other clients' rows are invisible. */
export async function tenantTx<T>(tenantId: string, fn: (c: Tx) => Promise<T>): Promise<T> {
  return tx(async (c) => {
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return fn(c);
  });
}

/** Transaction for platform staff jobs that must see every client (imports, admin reports). */
export async function platformTx<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  return tx(async (c) => {
    await c.query("SELECT set_config('app.platform', 'on', true)");
    return fn(c);
  });
}

export const db = { query, tx, tenantTx, platformTx, pool };
