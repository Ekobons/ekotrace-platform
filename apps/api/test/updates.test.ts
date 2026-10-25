/**
 * Weekly updates (platform admin) on a real PostgreSQL database (own database, so it can run beside the others).
 *
 *   UPD_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_upd_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
process.env.RATE_LIMIT = 'off';

const url = process.env.UPD_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_upd_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('UPD_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '';
const dir = mkdtempSync(join(tmpdir(), 'eko-upd-'));

const call = async (method: string, path: string, body?: unknown) => {
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' ? undefined : {})) as object, headers: { cookie: admin } });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body };
};
const load = async () => {
  const { loadUpdates } = await import('../src/modules/updates.routes.js');
  const { platformTx } = await import('../src/db/pool.js');
  const log: string[] = [];
  const n = await platformTx((c) => loadUpdates(c, (m) => log.push(m), dir));
  return { n, log };
};

const week = {
  week: '2026-10-26',
  summary: 'September exchange rates; DESNZ unchanged.',
  items: [
    { key: 'fx-2026-09', stream: 'fx', title: 'September 2026 monthly averages', published: '2026-10-05',
      sources: [{ title: 'Federal Reserve G.5', url: 'https://www.federalreserve.gov/releases/g5/' }],
      apply: { kind: 'fx', rows: [{ currency: 'EUR', month: '2026-09', perUsd: 0.91, source: 'TEST Federal Reserve G.5' }, { currency: 'INR', month: '2026-09', perUsd: 84.5, source: 'TEST Federal Reserve G.5' }] } },
    { key: 'cpi-2025-annual', stream: 'cpi', title: 'CPI-U 2025 annual average', apply: { kind: 'cpi', rows: [{ region: 'US', year: 2025, value: 321.943, source: 'TEST BLS' }] } },
    { key: 'desnz-2026-note', stream: 'factors', title: 'DESNZ 2026 errata', detail: 'Two refrigerant values corrected.', whereTo: 'Emission factors → Sources & import' },
  ],
  linkedin: [{ key: 'li-2026-10-26-1', title: 'What September rates mean for spend-based Scope 3', body: 'Draft text.' }],
};

before(async () => {
  const c0 = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await c0.connect();
  await c0.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await c0.query(`CREATE DATABASE ${dbName}`);
  await c0.end();
  await (await import('../src/db/migrate.js')).migrate(() => {});
  app = await (await import('../src/app.js')).buildApp();
  pool = (await import('../src/db/pool.js')).pool;
  const { hashPassword } = await import('../src/lib/password.js');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`SELECT set_config('app.platform','on',false)`);
  await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES (NULL,'ops@ekobon.test','Ops','platform_admin',$1,false)`, [await hashPassword('correct horse battery')]);
  await c.end();
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ops@ekobon.test', password: 'correct horse battery' } });
  admin = String(r.headers['set-cookie']).split(';')[0]!;
});
after(async () => { await app?.close(); await pool?.end(); });

test('weekly files load once, a bad file is skipped, a changed file keeps decisions', async () => {
  writeFileSync(join(dir, '2026-10-26.json'), JSON.stringify(week));
  writeFileSync(join(dir, '2026-10-19.json'), '{"week":"bad"}');
  const first = await load();
  assert.equal(first.n, 1);
  assert.ok(first.log.some((l) => l.includes('2026-10-19.json skipped')));
  assert.equal((await load()).n, 0, 'unchanged file not read again');
  const l = await call('GET', '/api/platform/updates');
  assert.equal(l.status, 200, l.text);
  assert.equal(l.body.items.length, 3);
  assert.equal(l.body.posts.length, 1);
  assert.equal(l.body.weeks[0].summary, week.summary);
  assert.equal((await call('GET', '/api/platform/updates/count')).body.open, 4);
});

test('Apply writes shared exchange rates and the CPI; manual items are marked done; decisions are final', async () => {
  const fx = await call('POST', '/api/platform/updates/fx-2026-09/decide', { action: 'apply' });
  assert.equal(fx.status, 200, fx.text);
  assert.equal(fx.body.rows, 2);
  const rate = (await pool.query(`SELECT per_usd::float8 AS v, tenant_id FROM fx_rate WHERE currency = 'INR' AND kind = 'month' AND period = '2026-09-01'`)).rows[0];
  assert.equal(rate.v, 84.5); assert.equal(rate.tenant_id, null);
  assert.equal((await call('POST', '/api/platform/updates/fx-2026-09/decide', { action: 'apply' })).status, 409);
  assert.equal((await call('POST', '/api/platform/updates/fx-2026-09/decide', { action: 'reopen' })).status, 409);
  assert.equal((await call('POST', '/api/platform/updates/cpi-2025-annual/decide', { action: 'apply' })).status, 200);
  assert.equal(Number((await pool.query(`SELECT value FROM price_index WHERE region = 'US' AND year = 2025`)).rows[0].value), 321.943);
  assert.equal((await call('POST', '/api/platform/updates/desnz-2026-note/decide', { action: 'apply' })).status, 400);
  assert.equal((await call('POST', '/api/platform/updates/desnz-2026-note/decide', { action: 'done' })).status, 200);
  assert.equal((await call('POST', '/api/platform/updates/desnz-2026-note/decide', { action: 'reopen' })).body.status, 'new');
  assert.equal((await call('POST', '/api/platform/updates/nope/decide', { action: 'done' })).status, 404);
  const { platformTx } = await import('../src/db/pool.js');
  const audit = await platformTx(async (c) => (await c.query(`SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'update.%'`)).rows[0].n);
  assert.ok(audit >= 4);
});

test('LinkedIn drafts: edit, approve, mark posted; only drafts are edited', async () => {
  assert.equal((await call('PATCH', '/api/platform/updates/posts/li-2026-10-26-1', { body: 'Edited draft text.' })).status, 200);
  assert.equal((await call('PATCH', '/api/platform/updates/posts/li-2026-10-26-1', { status: 'approved' })).body.status, 'approved');
  assert.equal((await call('PATCH', '/api/platform/updates/posts/li-2026-10-26-1', { body: 'Changed after approval' })).status, 409);
  assert.equal((await call('PATCH', '/api/platform/updates/posts/li-2026-10-26-1', { status: 'posted' })).body.status, 'posted');
  // a corrected weekly file: wording updates, decisions stay
  writeFileSync(join(dir, '2026-10-26.json'), JSON.stringify({ ...week, linkedin: [{ ...week.linkedin[0], body: 'Re-generated text' }], items: week.items.map((i) => ({ ...i, title: `${i.title} (corrected)` })) }));
  assert.equal((await load()).n, 1);
  const l = (await call('GET', '/api/platform/updates')).body;
  const fx = l.items.find((i: any) => i.key === 'fx-2026-09');
  assert.equal(fx.status, 'applied'); assert.match(fx.title, /corrected/);
  assert.equal(l.posts[0].status, 'posted'); assert.equal(l.posts[0].body, 'Edited draft text.');
});

test('company users cannot see weekly updates', async () => {
  const co = await call('POST', '/api/platform/companies', { name: 'Upd Co', country: 'AE', superAdmin: { name: 'SA', email: 'sa@upd.test' } });
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sa@upd.test', password: co.body.superAdmin.temporaryPassword } });
  const cookie = String(r.headers['set-cookie']).split(';')[0]!;
  const g = await app.inject({ method: 'GET', url: '/api/platform/updates', headers: { cookie } });
  assert.equal(g.statusCode, 403);
});
