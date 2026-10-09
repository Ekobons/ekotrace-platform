/**
 * Reference data cache: units, gases, GWP tables.
 *
 * These are read on every calculation but change rarely, so they live in
 * memory. When an admin changes them (or an import runs) the database sends a
 * NOTIFY 'refdata_changed'; every API server listening drops its copy and
 * reloads on next use. Works the same with one server or many.
 */
import pg from 'pg';
import { unitRegistry, type GwpTable, type Unit, type UnitRegistry } from '@ekotrace/calc';
import { query } from '../db/pool.js';
import { config } from '../config.js';

interface Ref {
  units: UnitRegistry;
  unitList: Unit[];
  gwp: Map<string, GwpTable>;
  kyoto: Set<string>;
}

let cache: Promise<Ref> | null = null;
let listener: pg.Client | null = null;

async function load(): Promise<Ref> {
  const units = await query<{ code: string; name: string; dimension: string; to_base: number }>(
    'SELECT code, name, dimension, to_base FROM unit WHERE active ORDER BY sort, code',
  );
  const unitList = units.map((u) => ({ code: u.code, name: u.name, dimension: u.dimension, toBase: u.to_base }));
  const gwpRows = await query<{ gwp_set: string; gas: string; value: number }>('SELECT gwp_set, gas, value FROM gwp_value');
  const gwp = new Map<string, GwpTable>();
  for (const r of gwpRows) {
    const t = gwp.get(r.gwp_set) ?? { set: r.gwp_set, values: {} };
    t.values[r.gas] = r.value;
    gwp.set(r.gwp_set, t);
  }
  const kyoto = new Set((await query<{ code: string }>('SELECT code FROM gas WHERE kyoto')).map((r) => r.code));
  return { units: unitRegistry(unitList), unitList, gwp, kyoto };
}

export function refdata(): Promise<Ref> {
  if (!cache) cache = load().catch((e) => { cache = null; throw e; });
  return cache;
}

export function invalidateRefdata() {
  cache = null;
}

/** Start listening for changes made by other servers or by imports. */
export async function listenForRefdataChanges(log: (m: string) => void = () => {}) {
  if (listener) return;
  listener = new pg.Client({ connectionString: config.databaseUrl });
  await listener.connect();
  await listener.query('LISTEN refdata_changed');
  listener.on('notification', () => { invalidateRefdata(); log('reference data changed — cache cleared'); });
  listener.on('error', () => { listener = null; invalidateRefdata(); });
}

export async function stopListening() {
  await listener?.end().catch(() => {});
  listener = null;
}
