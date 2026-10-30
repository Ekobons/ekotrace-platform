/**
 * EKOTRACE SME platform settings: factors, rules, calendar templates, SRMM question banks…
 * Versioned in sme_setting (one active version per key; drafts are activated by a platform admin).
 * A key with no version yet is stored from defaults.ts / data/sme/*.json the first time it is read.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformTx, type Tx } from '../../db/pool.js';
import { AppError, notFound } from '../errors.js';
import { DEFAULTS } from './defaults.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../../../../data/sme');
const bank = (f: string) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

export const KEYS = ['factors', 'energy', 'cbam', 'tariffs', 'solar', 'credit_pool', 'esg', 'dpdp', 'calendar', 'requirements', 'schemes', 'plans', 'content', 'srmm_mfg', 'srmm_svc', 'recyclers', 'actions', 'news'] as const;
export type Key = (typeof KEYS)[number];
export const KEY_LABEL: Record<Key, string> = {
  factors: 'Emission factors & units', energy: 'Energy conversion (GJ)', cbam: 'CBAM settings', tariffs: 'Electricity tariffs', solar: 'Rooftop solar defaults',
  credit_pool: 'Carbon credit pool', esg: 'ESG scoring weights', dpdp: 'DPDP checklist', calendar: 'Compliance calendar templates', requirements: 'Requirement rules',
  schemes: 'Schemes library', plans: 'Plans & prices', content: 'Messages & languages', srmm_mfg: 'SRMM v3.1 (manufacturing)', srmm_svc: 'SRMM v3.2 (services)', recyclers: 'Recycler directory', actions: 'Reduction actions library', news: 'What changed (regulatory updates)',
};
const firstVersion = (k: Key): any => (k === 'srmm_mfg' ? bank('srmm_mfg.json') : k === 'srmm_svc' ? bank('srmm_svc.json') : DEFAULTS[k]);

let cache: Record<string, any> | null = null;
let cachedAt = 0;
export const clearCache = () => { cache = null; };

/** The active version of every key (cached for a minute). */
export async function active(): Promise<Record<Key, any>> {
  if (cache && Date.now() - cachedAt < 60_000) return cache as Record<Key, any>;
  const out = await platformTx(async (c) => {
    const rows = (await c.query(`SELECT skey, version, data FROM sme_setting WHERE status = 'active'`)).rows as { skey: Key; version: number; data: any }[];
    const have = new Map(rows.map((r) => [r.skey, r]));
    for (const k of KEYS) {
      if (have.has(k)) continue;
      const data = firstVersion(k);
      await c.query(`INSERT INTO sme_setting (skey, version, data, status, note, created_name, activated_name, activated_at) VALUES ($1, 1, $2, 'active', 'First version', 'system', 'system', now()) ON CONFLICT DO NOTHING`, [k, JSON.stringify(data)]);
      have.set(k, { skey: k, version: 1, data });
    }
    return Object.fromEntries([...have.values()].map((r) => [r.skey, Object.assign({}, r.data, { version: r.data?.version ?? `v${r.version}` })]));
  });
  cache = out; cachedAt = Date.now();
  return out as Record<Key, any>;
}

/** Settings plus today's date: the `cfg` the engine expects. */
export async function cfg(today = new Date()): Promise<any> {
  return Object.assign({}, await active(), { today });
}

export async function versions(c: Tx, k: Key) {
  return (await c.query(`SELECT version, status, note, created_name, created_at, activated_name, activated_at FROM sme_setting WHERE skey = $1 ORDER BY version DESC`, [k])).rows;
}
export async function getVersion(c: Tx, k: Key, version?: number) {
  const r = version
    ? (await c.query(`SELECT * FROM sme_setting WHERE skey = $1 AND version = $2`, [k, version])).rows[0]
    : (await c.query(`SELECT * FROM sme_setting WHERE skey = $1 AND status = 'active'`, [k])).rows[0];
  if (!r) throw notFound('Version');
  return r;
}
export async function createDraft(c: Tx, k: Key, data: any, note: string | null, by: string): Promise<number> {
  validate(k, data);
  const v = Number((await c.query(`SELECT COALESCE(max(version), 0) + 1 AS v FROM sme_setting WHERE skey = $1`, [k])).rows[0].v);
  await c.query(`INSERT INTO sme_setting (skey, version, data, status, note, created_name) VALUES ($1,$2,$3,'draft',$4,$5)`, [k, v, JSON.stringify(data), note, by]);
  return v;
}
export async function activate(c: Tx, k: Key, version: number, by: string) {
  const r = (await c.query(`SELECT id, data FROM sme_setting WHERE skey = $1 AND version = $2`, [k, version])).rows[0];
  if (!r) throw notFound('Version');
  validate(k, r.data);
  await c.query(`UPDATE sme_setting SET status = 'retired' WHERE skey = $1 AND status = 'active'`, [k]);
  await c.query(`UPDATE sme_setting SET status = 'active', activated_name = $2, activated_at = now() WHERE id = $1`, [r.id, by]);
  clearCache();
}

/** Checks that keep the engine working whatever is typed in the console. */
export function validate(k: Key, d: any) {
  const need = (ok: unknown, msg: string) => { if (!ok) throw new AppError(msg, 400, 'INVALID_SETTING'); };
  need(d && typeof d === 'object' && !Array.isArray(d), 'The setting must be an object.');
  if (k === 'factors') {
    need(d.items && typeof d.items === 'object', 'Factors need an "items" list.');
    for (const [id, f] of Object.entries<any>(d.items)) {
      need(/^[a-z0-9_]{2,30}$/.test(id), `Factor id "${id}" can use lower-case letters, numbers and _ only.`);
      need(Number.isFinite(+f.factor) && +f.factor >= 0, `The factor for ${id} must be a number of 0 or more.`);
      need([1, 2, 3].includes(+f.scope), `The scope for ${id} must be 1, 2 or 3.`);
      need(typeof f.unit === 'string' && f.unit.length > 0 && f.unit.length <= 20, `The unit for ${id} is missing.`);
    }
    need(d.items.grid && d.items.steel && d.items.alu && d.items.road, 'Keep the grid, steel, aluminium and road factors: other modules use them.');
    need(d.materials && Number.isFinite(+d.materials.zinc_kg) && Number.isFinite(+d.materials.plastic_kg), 'Materials need zinc_kg and plastic_kg.');
  }
  if (k === 'srmm_mfg' || k === 'srmm_svc') {
    need(Array.isArray(d.items) && d.items.length >= 10, 'The SRMM bank needs its list of indicators.');
    const ids = new Set<string>();
    for (const x of d.items) {
      need(['A', 'B', 'C'].includes(x.s) && typeof x.id === 'string' && +x.max > 0, `Indicator ${x.id ?? '?'} needs a section (A, B or C) and a maximum score.`);
      need(!ids.has(x.id), `Indicator ${x.id} appears twice.`); ids.add(x.id);
    }
  }
  // every setting keeps the parts of its first version the engine reads (same names, same kind of value)
  const base: any = k === 'srmm_mfg' || k === 'srmm_svc' ? null : (DEFAULTS as any)[k];
  if (base && typeof base === 'object') {
    const kind = (v: unknown) => (Array.isArray(v) ? 'list' : v === null ? 'null' : typeof v);
    for (const [key, v] of Object.entries(base)) {
      if (key === 'note' || key === 'version') continue;
      need(key in d, `"${key}" is missing: keep every part of the setting (copy the active version and change the values).`);
      need(kind(d[key]) === kind(v), `"${key}" must be ${kind(v) === 'list' ? 'a list' : kind(v) === 'object' ? 'a group of values' : `a ${kind(v)}`}.`);
    }
  }
  if (k === 'cbam') need(+d.free_allocation_share >= 0 && +d.free_allocation_share <= 1, 'Free allocation share must be between 0 and 1.');
  if (k === 'esg') need(d.weights?.env && d.weights?.soc && d.weights?.gov, 'Weights need env, soc and gov sections.');
  if (k === 'calendar') need(Array.isArray(d.templates) && Number.isFinite(+d.soon_days), 'The calendar needs templates and soon_days.');
  if (k === 'requirements') need(d.items && d.msme_turnover_cr && d.csr, 'Requirement rules need items, msme_turnover_cr and csr.');
  if (k === 'schemes' || k === 'plans' || k === 'dpdp' || k === 'recyclers' || k === 'actions' || k === 'news') need(Array.isArray(d.items), 'This setting needs an "items" list.');
  if (k === 'news') {
    for (const x of d.items) {
      need(x && typeof x.id === 'string' && typeof x.title === 'string' && x.title.trim(), `Each update needs an id and a title${x?.id ? ` (${x.id})` : ''}.`);
      need(/^\d{4}-\d{2}-\d{2}$/.test(String(x.date)), `Update ${x.id} needs a date like 2026-10-30.`);
      need(!x.concerns || (typeof x.concerns === 'object' && !Array.isArray(x.concerns)), `Update ${x.id}: "concerns" must be a group of values (sectors, states, flags).`);
    }
  }
  if (k === 'actions') {
    for (const [f, v] of Object.entries<any>(d.prices || {})) need(Number.isFinite(+v) && +v >= 0, `The price of ${f} must be a number of 0 or more.`);
    need(+d.target?.pct >= 0 && +d.target?.pct <= 100 && Number.isInteger(+d.target?.year), 'The target needs pct (0–100) and year.');
    const ids = new Set<string>();
    for (const x of d.items) {
      need(x && typeof x.id === 'string' && /^[a-z0-9_]{2,30}$/.test(x.id) && typeof x.title === 'string' && x.title.length > 0, `Every action needs an id (lower-case letters, numbers, _) and a title (${x?.id ?? '?'}).`);
      need(!ids.has(x.id), `Action ${x.id} appears twice.`); ids.add(x.id);
      need(typeof x.source === 'string' || (Array.isArray(x.sources) && x.sources.length > 0 && x.sources.every((s: unknown) => typeof s === 'string')), `Action ${x.id} needs a source (e.g. "grid") or a list of sources.`);
      if (x.from !== undefined) need(['solar', 'pf'].includes(x.from), `Action ${x.id}: "from" can only be "solar" or "pf".`);
      else for (const f of ['share', 'pct']) need(Number.isFinite(+x[f]) && +x[f] >= 0 && +x[f] <= 100, `Action ${x.id}: ${f} must be a percentage from 0 to 100.`);
      need(x.cost && ['per_unit', 'per_kw', 'lump', 'from'].includes(x.cost.basis), `Action ${x.id}: cost.basis must be per_unit, per_kw, lump or from.`);
      if (x.cost.basis !== 'from') need(Number.isFinite(+x.cost.rate) && +x.cost.rate >= 0, `Action ${x.id}: cost.rate must be a number of 0 or more.`);
      need(Number.isFinite(+x.life) && +x.life > 0, `Action ${x.id}: life must be a number of years.`);
      if (x.per !== undefined) need(Number.isFinite(+x.per) && +x.per > 0, `Action ${x.id}: per must be a positive number.`);
    }
  }
  if (k === 'dpdp') {
    const areas = new Set((d.areas || []).map((a: any) => a.key));
    for (const x of d.items) need(typeof x.key === 'string' && typeof x.title === 'string' && areas.has(x.area), `DPDP item ${x.key ?? '?'} needs a key, a title and one of the areas.`);
  }
}
