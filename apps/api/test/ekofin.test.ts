/**
 * EKOFIN integration tests on a real PostgreSQL database (own database, so it can run beside api.test.ts).
 *
 *   FIN_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_fin_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
process.env.RATE_LIMIT = 'off';

const url = process.env.FIN_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_fin_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('FIN_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '';
let bank = '', corp = '';

const call = async (method: string, path: string, body?: unknown, tenant?: string, raw?: { buf: Buffer; filename: string }) => {
  const headers: Record<string, string> = { cookie: admin };
  if (tenant) headers['x-tenant-id'] = tenant;
  if (raw) { headers['content-type'] = 'application/octet-stream'; headers['x-filename'] = raw.filename; }
  const r = await app.inject({ method: method as 'GET', url: path, payload: raw ? raw.buf : ((body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object), headers });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body };
};
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

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

test('companies get EKOTRACE, EKOFIN or both; EKOFIN routes refuse a company without it', async () => {
  const b = await call('POST', '/api/platform/companies', { name: 'Test Bank', country: 'AE', products: ['ekotrace', 'ekofin'], superAdmin: { name: 'Bank Admin', email: 'sa@bank.test' } });
  assert.equal(b.status, 200, b.text);
  bank = b.body.company.id;
  assert.deepEqual(b.body.company.products, ['ekotrace', 'ekofin']);
  const c = await call('POST', '/api/platform/companies', { name: 'Test Corp', country: 'AE', superAdmin: { name: 'Corp Admin', email: 'sa@corp.test' } });
  corp = c.body.company.id;
  assert.deepEqual(c.body.company.products, ['ekotrace']);
  const off = await call('GET', '/api/fin/portfolios', undefined, corp);
  assert.equal(off.status, 403); assert.equal(off.body.error, 'PRODUCT_OFF');
  assert.equal((await call('PATCH', `/api/platform/companies/${corp}`, { products: [] })).status, 400);
  const me = await call('GET', '/api/auth/me', undefined, bank);
  assert.deepEqual(me.body.company.products, ['ekotrace', 'ekofin']);
});

test('platform admin loads a sector factor library (preview, then commit)', async () => {
  const csv = Buffer.from([
    'Library,Sector standard,Sector code,Sector name,Region,Year,Basis,Currency,Scope 1,Scope 2,Scope 3,Source',
    'Test library,NACE,C24,Basic metals,GLOBAL,2024,revenue,USD,100,50,400,Test values',
    'Test library,NACE,C24,Basic metals,GLOBAL,2024,assets,USD,15,5,,Test values',
    'Test library,NACE,C,Manufacturing,GLOBAL,2024,assets,USD,2,1,,Test values',
    'Test library,NACE,C24,Basic metals,XX1,2024,assets,USD,1,1,,bad region',
  ].join('\n'));
  const p = await call('POST', '/api/fin/factors/import?commit=0', undefined, undefined, { buf: csv, filename: 'f.csv' });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.rows, 3); assert.equal(p.body.errors.length, 1);
  assert.equal((await call('POST', '/api/fin/factors/import?commit=1', undefined, undefined, { buf: csv, filename: 'f.csv' })).status, 400);
  const ok = await call('POST', '/api/fin/factors/import?commit=1', undefined, undefined, { buf: Buffer.from(csv.toString().split('\n').slice(0, 4).join('\n')), filename: 'f.csv' });
  assert.equal(ok.body.saved, 3);
  const meta = await call('GET', '/api/fin/meta', undefined, bank);
  assert.equal(meta.body.libraries[0].library, 'Test library');
});

let portfolio = '', period = '';
test('portfolio, reporting date, loan book upload, results by PCAF layer', async () => {
  const p = await call('POST', '/api/fin/portfolios', { name: 'Corporate loan book', currency: 'USD', factorLibrary: 'Test library', includeScope3: true }, bank);
  assert.equal(p.status, 200, p.text); portfolio = p.body.id;
  const pe = await call('POST', `/api/fin/portfolios/${portfolio}/periods`, { asOf: '2025-12-31' }, bank);
  assert.equal(pe.status, 200, pe.text); period = pe.body.id;
  const csv = Buffer.from([
    'Counterparty name,ISIN,Customer ID,Country,Listed,Sector code,Asset class,Outstanding,Currency,Loan ID,Financial year,EVIC,Total equity,Total debt,Revenue,Emissions year,Scope 1,Scope 2,Verified',
    'Alpha Steel PLC,US0378331005,,US,yes,C24.10,shares,10000000,USD,EQ-1,2025,100000000,,,50000000,2025,1000,500,yes',
    'Beta Metals LLC,,C-2,AE,no,C24.10,term loan,36725000,AED,LN-1,2025,,110162500,73441000,293800000,,,,',
    'Gamma Industries,,C-3,AE,no,C24,working capital facility,5000000,USD,LN-2,,,,,,,,,',
    'Delta Traders,,C-4,AE,no,G46,loan,5000000,USD,LN-3,,,,,,,,,',
    'Epsilon,,C-5,AE,no,C24,loan,1000000,ZZZ,LN-4,,,,,,,,,',
    'Bad Row,,,AE,no,C24,spaceship,abc,USD,LN-5,,,,,,,,,',
  ].join('\n'));
  const prev = await call('POST', `/api/fin/periods/${period}/import?commit=0`, undefined, bank, { buf: csv, filename: 'book.csv' });
  assert.equal(prev.status, 200, prev.text);
  assert.equal(prev.body.totals.new, 5); assert.equal(prev.body.totals.error, 1);
  assert.match(prev.body.rows.find((r: { action: string }) => r.action === 'error').detail, /Asset class/);
  const bad = await call('POST', `/api/fin/periods/${period}/import?commit=1`, undefined, bank, { buf: csv, filename: 'book.csv' });
  assert.equal(bad.status, 400);
  const good = Buffer.from(csv.toString().split('\n').slice(0, 6).join('\n'));
  const r = await call('POST', `/api/fin/periods/${period}/import?commit=1`, undefined, bank, { buf: good, filename: 'book.csv' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.saved, { holdings: 5, counterparties: 5, financials: 2, emissions: 1 });

  const res = await call('GET', `/api/fin/periods/${period}`, undefined, bank);
  assert.equal(res.status, 200, res.text);
  const by = (n: string) => res.body.lines.find((l: { name: string }) => l.name === n);
  // Alpha: 10M ÷ EVIC 100M = 10% × (1000 + 500) verified → 150 t, score 1
  assert.equal(by('Alpha Steel PLC').result.score, 1); near(by('Alpha Steel PLC').result.financed.total, 150);
  assert.equal(by('Alpha Steel PLC').assetClass, 'listed_equity');
  // Beta: AED 36.725M = USD 10M; equity + debt AED 183.6035M = USD 49.993M → 20.0%; revenue USD 80M × (100 + 50) = 12,000 t → 2,400 t, score 4 (C24.10 uses C24)
  assert.equal(by('Beta Metals LLC').result.score, 4); near(by('Beta Metals LLC').outstanding, 10e6);
  near(by('Beta Metals LLC').result.financed.total, 12000 * 10e6 / (183603500 / 3.6725));
  // Gamma: no financials → assets factor: 5M × (15 + 5) per million = 100 t, score 5
  assert.equal(by('Gamma Industries').result.score, 5); near(by('Gamma Industries').result.financed.total, 100);
  // Delta: sector G46 has no factor → no result
  assert.equal(by('Delta Traders').result.score, null);
  // Epsilon: no ZZZ rate → left out with a warning
  assert.equal(by('Epsilon').excluded, 'No ZZZ rate');
  assert.ok(res.body.warnings.some((w: string) => /ZZZ/.test(w)));
  assert.equal(res.body.summary.holdings, 4); assert.equal(res.body.summary.missing, 1);
});

test('layer override needs a reason; lock keeps figures and blocks edits; unlock needs a reason', async () => {
  const res = await call('GET', `/api/fin/periods/${period}`, undefined, bank);
  const beta = res.body.lines.find((l: { name: string }) => l.name === 'Beta Metals LLC');
  assert.equal((await call('PUT', `/api/fin/holdings/${beta.id}/layer`, { score: 5 }, bank)).status, 400);
  assert.equal((await call('PUT', `/api/fin/holdings/${beta.id}/layer`, { score: 5, reason: 'Revenue figure under review' }, bank)).status, 200);
  const after1 = await call('GET', `/api/fin/periods/${period}`, undefined, bank);
  assert.equal(after1.body.lines.find((l: { id: string }) => l.id === beta.id).result.score, 5);
  assert.equal((await call('POST', `/api/fin/periods/${period}/lock`, {}, bank)).status, 200);
  const locked = await call('GET', `/api/fin/periods/${period}`, undefined, bank);
  assert.equal(locked.body.locked, true);
  near(locked.body.summary.financed.total, after1.body.summary.financed.total);
  assert.equal((await call('DELETE', `/api/fin/holdings/${beta.id}`, undefined, bank)).status, 409);
  // changing a counterparty after locking does not change the locked figures
  await call('PUT', `/api/fin/counterparties/${beta.counterpartyId}/financials`, { year: 2025, currency: 'AED', equity: 1, debt: 1, revenue: 1 }, bank);
  near((await call('GET', `/api/fin/periods/${period}`, undefined, bank)).body.summary.financed.total, after1.body.summary.financed.total);
  const csv = await call('GET', `/api/fin/periods/${period}/export`, undefined, bank);
  assert.equal(csv.status, 200); assert.match(csv.text, /Alpha Steel PLC/); assert.match(csv.text, /Revenue figure under review/);
  assert.equal((await call('POST', `/api/fin/periods/${period}/unlock`, { reason: 'no' }, bank)).status, 400);
  assert.equal((await call('POST', `/api/fin/periods/${period}/unlock`, { reason: 'Restating after audit' }, bank)).status, 200);
  // a new date copies the holdings
  const next = await call('POST', `/api/fin/portfolios/${portfolio}/periods`, { asOf: '2026-06-30', copyFrom: period }, bank);
  assert.equal(next.body.copied, 5);
});

test('counterparties: profile, duplicates refused, verified emissions need a document, removal blocked while held', async () => {
  const list = await call('GET', '/api/fin/counterparties?q=alpha', undefined, bank);
  assert.equal(list.body.counterparties.length, 1);
  const id = list.body.counterparties[0].id;
  const prof = await call('GET', `/api/fin/counterparties/${id}`, undefined, bank);
  assert.equal(prof.status, 200, prof.text);
  assert.equal(prof.body.emissions[0].score, 1); assert.equal(prof.body.holdings.length, 2);
  assert.ok(prof.body.factors.length >= 1);
  const dup = await call('POST', '/api/fin/counterparties', { name: 'Copy', isin: 'US0378331005' }, bank);
  assert.equal(dup.status, 409);
  const e1 = await call('PUT', `/api/fin/counterparties/${id}/emissions`, { year: 2024, score: 1, s1: 1, s2: 1, source: 'Report' }, bank);
  assert.equal(e1.status, 400);
  assert.equal((await call('PUT', `/api/fin/counterparties/${id}/emissions`, { year: 2024, score: 2, s1: 1, s2: 1, source: 'CDP 2024' }, bank)).status, 200);
  assert.equal((await call('DELETE', `/api/fin/counterparties/${id}`, undefined, bank)).status, 409);
});

test('one company never sees another company\'s EKOFIN data', async () => {
  await call('PATCH', `/api/platform/companies/${corp}`, { products: ['ekotrace', 'ekofin'] });
  assert.equal((await call('GET', '/api/fin/counterparties', undefined, corp)).body.counterparties.length, 0);
  assert.equal((await call('GET', `/api/fin/periods/${period}`, undefined, corp)).status, 404);
  assert.equal((await call('GET', '/api/fin/portfolios', undefined, corp)).body.portfolios.length, 0);
});

test('the holdings template downloads', async () => {
  const t = await call('GET', '/api/fin/import-template', undefined, bank);
  assert.equal(t.status, 200);
});
