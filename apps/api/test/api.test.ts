/**
 * Integration tests on a real PostgreSQL database.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_test npm test -w @ekotrace/api
 *
 * The database named in TEST_DATABASE_URL is DROPPED and rebuilt (name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
// rate limits are tested on their own app instance below
process.env.RATE_LIMIT = 'off';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let calc: typeof import('@ekotrace/calc');
let svc: typeof import('../src/modules/calc.service.js');
let ref: typeof import('../src/modules/refdata.js');

let adminCookie = '';
/** Call the API as `who` (default: the platform admin), acting on `tenant`. */
const call = async (who: string, method: string, path: string, body?: unknown, tenant?: string) => {
  const headers: Record<string, string> = { cookie: who };
  if (tenant) headers['x-tenant-id'] = tenant;
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers });
  return { status: r.statusCode, body: r.json(), headers: r.headers };
};
const api = (method: string, path: string, body?: unknown, tenant?: string) => call(adminCookie, method, path, body, tenant);
/** Log in and return the session cookie. */
async function login(email: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.statusCode} ${r.body}`);
  return String(r.headers['set-cookie']).split(';')[0]!;
}

before(async () => {
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const { migrate } = await import('../src/db/migrate.js');
  const { seed } = await import('../src/db/seed.js');
  await migrate(() => {});
  await seed(() => {});
  app = await (await import('../src/app.js')).buildApp();
  pool = (await import('../src/db/pool.js')).pool;
  calc = await import('@ekotrace/calc');
  svc = await import('../src/modules/calc.service.js');
  ref = await import('../src/modules/refdata.js');
  const { hashPassword } = await import('../src/lib/password.js');
  // One-off connection (not from the app's pool) so no pooled connection keeps the platform flag.
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`SELECT set_config('app.platform','on',false)`);
  await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES (NULL,'ops@ekobon.test','Ops','platform_admin',$1,false)`, [await hashPassword('correct horse battery')]);
  await c.end();
  adminCookie = await login('ops@ekobon.test', 'correct horse battery');
});

after(async () => {
  await app?.close();
  await pool?.end();
});

test('every DESNZ fuel factor with a gas split reproduces the published total (all years, all units)', async () => {
  const { gwp, units } = await ref.refdata();
  const items = (await pool.query(`SELECT DISTINCT item_id FROM factor f JOIN factor_source s ON s.id = f.source_id WHERE s.code LIKE 'DESNZ-%' AND f.basis = 'direct'`)).rows;
  let checked = 0;
  const worst: string[] = [];
  for (const { item_id } of items) {
    for (const f of await svc.loadFactors(item_id)) {
      if (f.basis !== 'direct' || !f.gases.length || f.co2ePerUnit == null || !f.sourceGwpSet) continue;
      const r = calc.calcCombustion({ itemName: String(item_id), quantity: 1, unit: f.unit, date: f.validFrom, region: 'GLOBAL', factors: [f], gwp: gwp.get(f.sourceGwpSet)!, units });
      const diff = Math.abs(r.totals.direct - f.co2ePerUnit) / f.co2ePerUnit;
      if (diff > 0.005) worst.push(`${f.id} ${f.source} ${f.unit}: ${r.totals.direct} vs ${f.co2ePerUnit}`);
      checked++;
    }
  }
  assert.ok(checked >= 580, `checked ${checked}`); // 117 fuel × unit combinations with a gas split, 5 editions
  assert.deepEqual(worst, []);
});

test('catalogue: six stationary classes and five fugitive groups, units per class', async () => {
  const r = await api('GET', '/api/catalogue');
  assert.equal(r.status, 200);
  const st = r.body.categories.find((c: { code: string }) => c.code === 'stationary_combustion');
  assert.deepEqual(st.subcategories.map((s: { name: string }) => s.name), ['Liquid fuels', 'Solid fuels', 'Gaseous fuels', 'Biofuel', 'Biomass', 'Biogas']);
  const liquid = st.subcategories[0];
  assert.equal(liquid.items[0].name, 'Diesel (100% mineral diesel)');
  assert.ok(liquid.items[0].aliases.includes('Diesel'));
  const fug = r.body.categories.find((c: { code: string }) => c.code === 'fugitive');
  assert.equal(fug.subcategories.length, 5);
});

let tenantA = '', tenantB = '', facA = '', facB = '';
let superA: { email: string; temporaryPassword: string };
const diesel = async () => (await pool.query(`SELECT id FROM item WHERE code = 'desnz:diesel-100-mineral-diesel'`)).rows[0].id as number;

test('companies and facilities; diesel 2025 calculates with DESNZ 2025 and splits gases', async () => {
  const a = await api('POST', '/api/platform/companies', { name: 'BEEAH Test', country: 'AE', gwpSet: 'AR5', superAdmin: { name: 'Sara Super', email: 'super@a.test' } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  tenantA = a.body.company.id; superA = a.body.superAdmin;
  tenantB = (await api('POST', '/api/platform/companies', { name: 'Other Co', country: 'AE', gwpSet: 'AR6', superAdmin: { name: 'Bob', email: 'super@b.test' } })).body.company.id;
  const groupOf = async (t: string) => (await api('GET', '/api/org', undefined, t)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  facA = (await api('POST', '/api/org/nodes', { parentId: await groupOf(tenantA), kind: 'facility', name: 'Sharjah plant' }, tenantA)).body.id;
  facB = (await api('POST', '/api/org/nodes', { parentId: await groupOf(tenantB), kind: 'facility', name: 'Dubai office' }, tenantB)).body.id;

  const id = await diesel();
  const r = await api('POST', '/api/calculate', { itemId: id, quantity: 1000, unit: 'L', periodStart: '2025-03-01', periodEnd: '2025-03-31', facilityId: facA }, tenantA);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const published = (await pool.query(`SELECT f.co2e, f.unit FROM factor f JOIN factor_source s ON s.id=f.source_id WHERE f.item_id=$1 AND s.code='DESNZ-2025' AND f.basis='direct' AND f.unit='L' AND f.status='active'`, [id])).rows[0].co2e;
  assert.ok(Math.abs(r.body.totals.direct - 1000 * published) < 1e-6);
  assert.deepEqual(r.body.lines.filter((l: { basis: string }) => l.basis === 'direct').map((l: { gas: string }) => l.gas).sort(), ['CH4_fossil', 'CO2', 'N2O']);
  assert.ok(r.body.totals.wtt > 0);
  // US gallons and kilolitres convert; gross-CV kWh uses the gross factor.
  const gal = await api('POST', '/api/calculate', { itemId: id, quantity: 264.172052, unit: 'gal_us', periodStart: '2025-03-01', periodEnd: '2025-03-31' }, tenantA);
  assert.ok(Math.abs(gal.body.totals.direct - r.body.totals.direct) < 0.01);
  const lb = await api('POST', '/api/calculate', { itemId: id, quantity: 5, unit: 'lb', periodStart: '2025-03-01', periodEnd: '2025-03-31' }, tenantA);
  assert.equal(lb.status, 400); // lb is not offered for liquid fuels
});

test('AR6 company gets a different (recomputed) total from the same entry', async () => {
  const id = await diesel();
  const a = await api('POST', '/api/calculate', { itemId: id, quantity: 1000, unit: 'L', periodStart: '2025-03-01', periodEnd: '2025-03-31' }, tenantA);
  const b = await api('POST', '/api/calculate', { itemId: id, quantity: 1000, unit: 'L', periodStart: '2025-03-01', periodEnd: '2025-03-31' }, tenantB);
  assert.equal(b.body.gwpSet, 'AR6');
  assert.ok(b.body.totals.direct > a.body.totals.direct);
  // CO2e factor shown to the user: AR5 equals DESNZ's published value; AR6 differs and shows the published one alongside.
  const fa = a.body.factors.find((f: { basis: string }) => f.basis === 'direct');
  const fb = b.body.factors.find((f: { basis: string }) => f.basis === 'direct');
  assert.ok(Math.abs(1000 * fa.perEnteredUnit - a.body.totals.direct) < 1e-6);
  assert.equal(fa.published, undefined);
  assert.equal(fb.published.gwpSet, 'AR5');
  assert.ok(Math.abs(1000 * fb.perEnteredUnit - b.body.totals.direct) < 1e-6);
});

test('save an entry; other companies cannot see it (row-level security)', async () => {
  const id = await diesel();
  const s = await api('POST', '/api/activities', { facilityId: facA, itemId: id, quantity: 500, unit: 'L', periodStart: '2025-04-01', periodEnd: '2025-04-30' }, tenantA);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await api('GET', '/api/activities', undefined, tenantA)).body.activities.length, 1);
  assert.equal((await api('GET', '/api/activities', undefined, tenantB)).body.activities.length, 0);
  assert.equal((await api('GET', `/api/activities/${s.body.id}`, undefined, tenantB)).status, 404);
  // Tenant B cannot post against tenant A's facility either.
  assert.equal((await api('POST', '/api/activities', { facilityId: facA, itemId: id, quantity: 1, unit: 'L', periodStart: '2025-04-01', periodEnd: '2025-04-30' }, tenantB)).status, 404);
  const detail = await api('GET', `/api/activities/${s.body.id}`, undefined, tenantA);
  assert.ok(detail.body.steps.length >= 4);
  assert.ok(detail.body.lines.some((l: { source: string }) => l.source === 'DESNZ-2025'));
  const f = detail.body.factors.find((x: { basis: string }) => x.basis === 'direct');
  assert.ok(Math.abs(500 * f.perEnteredUnit - Number(detail.body.co2e_direct)) < 1e-6, 'saved entry keeps its CO2e factor');
});

test('own calorific value: default offered from DESNZ; entered value changes the result and is saved', async () => {
  const id = await diesel();
  const d = await api('GET', `/api/items/${id}/cv?energyUnit=MJ&perUnit=L&date=2025-01-01`, undefined, tenantA);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.ok(d.body.energyUnits.some((u: { code: string }) => u.code === 'MJ'));
  assert.ok(d.body.energyUnits.some((u: { code: string }) => u.code === 'MJ_gcv'));
  assert.ok(d.body.suggested.value > 35 && d.body.suggested.value < 40, String(d.body.suggested.value)); // diesel ≈ 36–38 MJ/L net
  const base = { itemId: id, quantity: 1000, unit: 'L', periodStart: '2025-03-01', periodEnd: '2025-03-31' };
  const std = await api('POST', '/api/calculate', base, tenantA);
  const same = await api('POST', '/api/calculate', { ...base, cv: { value: d.body.suggested.value, energyUnit: 'MJ', perUnit: 'L' } }, tenantA);
  assert.ok(Math.abs(same.body.totals.direct - std.body.totals.direct) / std.body.totals.direct < 0.01, 'DESNZ CV reproduces the per-litre result');
  const own = await api('POST', '/api/calculate', { ...base, cv: { value: 30, energyUnit: 'MJ', perUnit: 'L' } }, tenantA);
  assert.ok(own.body.totals.direct < std.body.totals.direct);
  assert.equal(own.body.cv.basis, 'net');
  const s = await api('POST', '/api/activities', { ...base, facilityId: facA, cv: { value: 30, energyUnit: 'MJ', perUnit: 'L' } }, tenantA);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const saved = await api('GET', `/api/activities/${s.body.id}`, undefined, tenantA);
  assert.equal(saved.body.inputs.cv.value, 30);
});

test('fugitive: R-410A per gas (Kyoto), R-401A HCFC part as memo, blend without composition uses DESNZ total', async () => {
  const item = async (code: string) => (await pool.query('SELECT id FROM item WHERE code = $1', [code])).rows[0].id;
  const r410 = await api('POST', '/api/calculate', { itemId: await item('blend:r410a'), unit: 'kg', fugitive: { method: 'quantity', released: 10 }, periodStart: '2025-01-01', periodEnd: '2025-12-31' }, tenantA);
  assert.equal(r410.status, 200, JSON.stringify(r410.body));
  assert.ok(Math.abs(r410.body.totals.direct - 10 * (0.5 * 677 + 0.5 * 3170)) < 1e-6);
  const r401 = await api('POST', '/api/calculate', { itemId: await item('blend:r401a'), unit: 'kg', fugitive: { method: 'quantity', released: 10 }, periodStart: '2025-01-01', periodEnd: '2025-12-31' }, tenantA);
  assert.ok(r401.body.totals.memo > r401.body.totals.direct);
  const r422b = await api('POST', '/api/calculate', { itemId: await item('blend:r422b'), unit: 'kg', fugitive: { method: 'quantity', released: 1 }, periodStart: '2025-01-01', periodEnd: '2025-12-31' }, tenantA);
  assert.equal(r422b.status, 200, JSON.stringify(r422b.body));
  assert.ok(r422b.body.totals.direct > 1000 && r422b.body.warnings.length === 1);
  const sf6 = await api('POST', '/api/calculate', { itemId: await item('gas:sf6'), unit: 'kg', fugitive: { method: 'screening', operatingCharge: 100, annualLeakRatePct: 0.5 }, periodStart: '2025-01-01', periodEnd: '2025-12-31' }, tenantB);
  assert.ok(Math.abs(sf6.body.totals.direct - 0.5 * 24300) < 1e-6); // AR6 SF6
});

test('admin can add, edit, move and remove catalogue entries; used items are switched off, not deleted', async () => {
  const cat = (await api('GET', '/api/catalogue')).body.categories.find((c: { code: string }) => c.code === 'stationary_combustion');
  const sub = await api('POST', '/api/admin/subcategories', { categoryId: cat.id, code: 'waste_fuels', name: 'Waste-derived fuels', units: ['kg', 't'], defaultUnit: 't' });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const it = await api('POST', '/api/admin/items', { subcategoryId: sub.body.id, name: 'Refuse-derived fuel', defaultUnit: 't' });
  assert.equal(it.status, 200);
  const f = await api('POST', '/api/admin/factors', { itemId: it.body.id, sourceCode: 'TEST-RDF', basis: 'direct', unit: 'kg', co2e: null,
    gases: [{ gas: 'CO2', kgPerUnit: 0.9 }, { gas: 'CH4_fossil', kgPerUnit: 0.0003 }], validFrom: '2025-01-01', validTo: '2025-12-31' });
  assert.equal(f.status, 200, JSON.stringify(f.body));
  const c = await api('POST', '/api/calculate', { itemId: it.body.id, quantity: 2, unit: 't', periodStart: '2025-05-01', periodEnd: '2025-05-31' }, tenantA);
  assert.ok(Math.abs(c.body.totals.direct - (1800 + 0.6 * 28)) < 1e-6);
  // Rename and move; then remove: it has a factor, so it is switched off.
  assert.equal((await api('PATCH', `/api/admin/items/${it.body.id}`, { name: 'RDF (refuse-derived fuel)' })).body.name, 'RDF (refuse-derived fuel)');
  const del = await api('DELETE', `/api/admin/items/${it.body.id}`);
  assert.equal(del.body.switchedOff, true);
  const blocked = await api('POST', '/api/calculate', { itemId: it.body.id, quantity: 2, unit: 't', periodStart: '2025-05-01', periodEnd: '2025-05-31' }, tenantA);
  assert.equal(blocked.status, 400);
  // An unused item is really deleted.
  const tmp = await api('POST', '/api/admin/items', { subcategoryId: sub.body.id, name: 'Temporary' });
  assert.equal((await api('DELETE', `/api/admin/items/${tmp.body.id}`)).body.removed, true);
});

test('a company can hide subcategories it does not use, without affecting others', async () => {
  const cat = (await api('GET', '/api/catalogue', undefined, tenantA)).body.categories.find((c: { code: string }) => c.code === 'stationary_combustion');
  const biomass = cat.subcategories.find((s: { code: string }) => s.code === 'biomass');
  await api('PUT', '/api/catalogue/visibility', { subcategoryId: biomass.id, enabled: false }, tenantA);
  const a = (await api('GET', '/api/catalogue', undefined, tenantA)).body.categories.find((c: { code: string }) => c.code === 'stationary_combustion');
  const b = (await api('GET', '/api/catalogue', undefined, tenantB)).body.categories.find((c: { code: string }) => c.code === 'stationary_combustion');
  assert.ok(!a.subcategories.some((s: { code: string }) => s.code === 'biomass'));
  assert.ok(b.subcategories.some((s: { code: string }) => s.code === 'biomass'));
});

test('unit matrix: changing a unit takes effect immediately; base units cannot change', async () => {
  assert.equal((await api('PATCH', '/api/admin/units/kg', { toBase: 2 })).status, 400);
  const before = await api('POST', '/api/calculate', { itemId: await diesel(), quantity: 1, unit: 'bbl', periodStart: '2025-03-01', periodEnd: '2025-03-31' }, tenantA);
  await api('PATCH', '/api/admin/units/bbl', { toBase: 159 });
  const after = await api('POST', '/api/calculate', { itemId: await diesel(), quantity: 1, unit: 'bbl', periodStart: '2025-03-01', periodEnd: '2025-03-31' }, tenantA);
  assert.ok(after.body.totals.direct > before.body.totals.direct);
  await api('PATCH', '/api/admin/units/bbl', { toBase: 158.987294928 });
});

test('DESNZ upload: preview reads year and GWP set; same file again changes nothing', async () => {
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(new URL('../../../data/defra/desnz-2026-flat.xlsx', import.meta.url));
  const prev = await app.inject({ method: 'POST', url: '/api/admin/import/desnz?preview=1', payload: buf, headers: { 'content-type': 'application/octet-stream', cookie: adminCookie } });
  assert.equal(prev.statusCode, 200, prev.body);
  assert.equal(prev.json().year, 2026);
  assert.equal(prev.json().gwpSet, 'AR5');
  const again = await app.inject({ method: 'POST', url: '/api/admin/import/desnz', payload: buf, headers: { 'content-type': 'application/octet-stream', cookie: adminCookie } });
  assert.equal(again.json().skipped, true);
});

test('per-gas report', async () => {
  const r = await api('GET', '/api/reports/by-gas?year=2025', undefined, tenantA);
  assert.ok(r.body.rows.some((x: { gas: string }) => x.gas === 'N2O'));
});

test('units offered per item follow its factors and the class list', async () => {
  const id = await diesel();
  const r = await api('GET', `/api/items/${id}/units`);
  assert.equal(r.body.defaultUnit, 'L');
  const codes = r.body.units.map((u: { code: string }) => u.code);
  assert.ok(codes.includes('kL') && codes.includes('kWh_gcv') && !codes.includes('m3') && !codes.includes('lb'));
  const sf6 = (await pool.query(`SELECT id FROM item WHERE code='gas:sf6'`)).rows[0].id;
  assert.deepEqual((await api('GET', `/api/items/${sf6}/units`)).body.units.map((u: { code: string }) => u.code).sort(), ['g', 'kg', 'lb', 't']);
});

// ----------------------------------------------------------------- stage 1 --

test('login: wrong password refused with one message; 5 failures lock; logout ends the session', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ops@ekobon.test', password: 'nope' } });
  assert.equal(bad.statusCode, 401);
  const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@x.test', password: 'nope' } });
  assert.equal(unknown.json().message, bad.json().message);
  assert.equal((await app.inject({ method: 'GET', url: '/api/catalogue' })).statusCode, 401);
  // lock a throwaway account
  const t = await api('POST', '/api/users', { name: 'Lock Me', email: 'lock@a.test', role: 'verifier' }, tenantA);
  for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'lock@a.test', password: 'wrong' } });
  const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'lock@a.test', password: t.body.temporaryPassword } });
  assert.equal(locked.statusCode, 429);
  // logout
  const ck = await login('ops@ekobon.test', 'correct horse battery');
  assert.equal((await call(ck, 'GET', '/api/auth/me')).status, 200);
  await call(ck, 'POST', '/api/auth/logout');
  assert.equal((await call(ck, 'GET', '/api/auth/me')).status, 401);
});

test('a temporary password must be changed before anything else', async () => {
  const ck = await login(superA.email, superA.temporaryPassword);
  assert.equal((await call(ck, 'GET', '/api/org')).body.error, 'MUST_CHANGE_PASSWORD');
  assert.equal((await call(ck, 'POST', '/api/auth/password', { current: superA.temporaryPassword, next: 'short' })).status, 400);
  assert.equal((await call(ck, 'POST', '/api/auth/password', { current: superA.temporaryPassword, next: 'sharjah sunrise 2026' })).status, 200);
  assert.equal((await call(ck, 'GET', '/api/org')).status, 200);
  superA.temporaryPassword = 'sharjah sunrise 2026';
});

test('roles: preparer enters only assigned facilities, verifier reads only, admin stays in their sub-group', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const subW = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'subgroup', name: 'Waste' })).body.id;
  const subR = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'subgroup', name: 'Real estate' })).body.id;
  const plant = (await call(sa, 'POST', '/api/org/nodes', { parentId: subW, kind: 'facility', name: 'WtE plant' })).body.id;
  const office = (await call(sa, 'POST', '/api/org/nodes', { parentId: subR, kind: 'facility', name: 'HQ' })).body.id;
  const mk = async (email: string, role: string, extra: object = {}) => {
    const r = await call(sa, 'POST', '/api/users', { name: email, email, role, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ck = await login(email, r.body.temporaryPassword);
    await call(ck, 'POST', '/api/auth/password', { current: r.body.temporaryPassword, next: 'a long enough pass' });
    return ck;
  };
  const prep = await mk('prep@a.test', 'preparer', { facilityIds: [plant] });
  const ver = await mk('ver@a.test', 'verifier');
  const adm = await mk('adm@a.test', 'admin', { scopeNodeId: subW });
  const id = await diesel();
  const entry = (f: string) => ({ facilityId: f, itemId: id, quantity: 10, unit: 'L', periodStart: '2025-06-01', periodEnd: '2025-06-30' });

  assert.equal((await call(prep, 'POST', '/api/activities', entry(plant))).status, 200);
  assert.equal((await call(prep, 'POST', '/api/activities', entry(office))).status, 403);
  assert.deepEqual((await call(prep, 'GET', '/api/facilities')).body.facilities.map((f: { name: string }) => f.name), ['WtE plant']);
  assert.equal((await call(ver, 'POST', '/api/activities', entry(plant))).status, 403);
  const seen = (await call(ver, 'GET', '/api/activities')).body.activities;
  assert.ok(seen.some((a: { facility: string }) => a.facility === 'WtE plant') && seen.some((a: { facility: string }) => a.facility === 'Sharjah plant')); // whole company
  assert.ok((await call(prep, 'GET', '/api/activities')).body.activities.every((a: { facility: string }) => a.facility === 'WtE plant'));
  assert.equal((await call(ver, 'PATCH', '/api/tenant', { gwpSet: 'AR6' })).status, 403);
  // Admin of "Waste": may add a facility and a preparer inside Waste, not in Real estate.
  assert.equal((await call(adm, 'POST', '/api/org/nodes', { parentId: subW, kind: 'facility', name: 'Depot' })).status, 200);
  assert.equal((await call(adm, 'POST', '/api/org/nodes', { parentId: subR, kind: 'facility', name: 'Nope' })).status, 403);
  assert.equal((await call(adm, 'POST', '/api/users', { name: 'p2', email: 'p2@a.test', role: 'preparer', facilityIds: [plant] })).status, 200);
  assert.equal((await call(adm, 'POST', '/api/users', { name: 'p3', email: 'p3@a.test', role: 'preparer', facilityIds: [office] })).status, 403);
  assert.equal((await call(adm, 'POST', '/api/users', { name: 'sa2', email: 'sa2@a.test', role: 'super_admin' })).status, 403);
  assert.equal((await call(adm, 'POST', '/api/activities', entry(office))).status, 403);
  // Company B's super admin sees none of company A's people.
  const sb = (await api('GET', '/api/users', undefined, tenantB)).body.users.map((u: { email: string }) => u.email);
  assert.deepEqual(sb, ['super@b.test']);
});

test('people rules: no self-demotion, last super admin kept, reset gives a new temporary password', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const me = (await call(sa, 'GET', '/api/auth/me')).body.user.id;
  assert.equal((await call(sa, 'PATCH', `/api/users/${me}`, { role: 'verifier' })).status, 400);
  const ver = (await call(sa, 'GET', '/api/users')).body.users.find((u: { email: string }) => u.email === 'ver@a.test');
  const r = await call(sa, 'POST', `/api/users/${ver.id}/reset-password`);
  assert.ok(r.body.temporaryPassword.startsWith('Eko-'));
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ver@a.test', password: 'a long enough pass' } })).statusCode, 401);
});

test('methodology, archive instead of delete, and the audit log records it all', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const m = await call(sa, 'PATCH', '/api/tenant', { consolidation: 'equity', baseYear: 2024 });
  assert.equal(m.body.consolidation, 'equity');
  const plant = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { name: string }) => n.name === 'WtE plant');
  assert.equal((await call(sa, 'DELETE', `/api/org/nodes/${plant.id}`)).body.archived, true);
  const log = (await call(sa, 'GET', '/api/audit')).body.events.map((e: { action: string }) => e.action);
  for (const a of ['methodology.update', 'node.archive', 'user.create', 'activity.create', 'login', 'password.change']) assert.ok(log.includes(a), `missing ${a}`);
});

test('suspended company cannot log in; platform admin sees all companies', async () => {
  const list = (await api('GET', '/api/platform/companies')).body.companies;
  assert.ok(list.length >= 2);
  await api('PATCH', `/api/platform/companies/${tenantB}`, { status: 'suspended' });
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'super@b.test', password: 'whatever-it-is' } })).statusCode, 401);
  const sa = await login(superA.email, superA.temporaryPassword);
  assert.equal((await call(sa, 'GET', '/api/platform/companies')).status, 403);
  await api('PATCH', `/api/platform/companies/${tenantB}`, { status: 'active' });
});

// ------------------------------------------------------------------ vehicles --
const itemId = async (code: string) => (await pool.query('SELECT id FROM item WHERE code = $1', [code])).rows[0].id as number;

test('vehicles: fleet add / retire; distance, fuel and spend entries; EV charging in Scope 2', async () => {
  const dieselVan = await itemId('veh:vans:average-up-to-3-5-tonnes:diesel');
  const bevCar = await itemId('veh:cars_by_size:average-car:battery-electric-vehicle');
  const period = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };

  // Fleet
  const van = await api('POST', `/api/facilities/${facA}/vehicles`, { name: 'Van 1', registration: 'SHJ 1', itemId: dieselVan, inServiceFrom: '2025-01-01' }, tenantA);
  assert.equal(van.status, 200, JSON.stringify(van.body));
  const dup = await api('POST', `/api/facilities/${facA}/vehicles`, { name: 'Van 1b', registration: 'shj 1', itemId: dieselVan, inServiceFrom: '2025-01-01' }, tenantA);
  assert.equal(dup.status, 400, 'same registration twice');
  const ev = await api('POST', `/api/facilities/${facA}/vehicles`, { name: 'EV 1', itemId: bevCar, inServiceFrom: '2026-01-01', defaultMethod: 'fuel' }, tenantA);
  assert.equal(ev.body.charging, 'elsewhere');
  assert.equal(ev.body.default_method, 'electricity', 'electric car cannot default to fuel');

  // Distance: 1,000 km × DESNZ 2026 van factor
  const d = await api('POST', '/api/calculate', { facilityId: facA, itemId: 0 + dieselVan, unit: 'km', quantity: 1000, ...period, vehicle: { method: 'distance', vehicleId: van.body.id } }, tenantA);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const pub = Number((await pool.query(`SELECT co2e FROM factor f JOIN factor_source s ON s.id = f.source_id WHERE item_id = $1 AND s.code = 'DESNZ-2026' AND basis = 'direct' AND unit = 'km' AND status = 'active'`, [dieselVan])).rows[0].co2e);
  assert.ok(Math.abs(d.body.totals.direct - 1000 * pub) / (1000 * pub) < 0.005, `${d.body.totals.direct} vs ${1000 * pub}`);

  // Fuel: litres of the van's fuel (diesel)
  const f = await api('POST', '/api/calculate', { facilityId: facA, itemId: dieselVan, unit: 'L', quantity: 100, ...period, vehicle: { method: 'fuel', vehicleId: van.body.id } }, tenantA);
  const std = await api('POST', '/api/calculate', { itemId: await diesel(), unit: 'L', quantity: 100, ...period }, tenantA);
  assert.ok(Math.abs(f.body.totals.direct - std.body.totals.direct) < 1e-9);

  // Spend: no price yet → clear error; company price → litres
  const noPrice = await api('POST', '/api/calculate', { facilityId: facA, itemId: dieselVan, unit: 'L', ...period, vehicle: { method: 'spend', vehicleId: van.body.id, spend: { amount: 300, currency: 'AED' } } }, tenantA);
  assert.equal(noPrice.status, 400);
  assert.match(noPrice.body.message, /No AED price/);
  const p = await api('POST', '/api/prices', { region: 'AE', itemId: await diesel(), currency: 'AED', price: 3, unit: 'L', validFrom: '2026-03-01', validTo: '2026-03-31', source: 'Test price' }, tenantA);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const sp = await api('POST', '/api/calculate', { facilityId: facA, itemId: dieselVan, unit: 'L', ...period, vehicle: { method: 'spend', vehicleId: van.body.id, spend: { amount: 300, currency: 'AED' } } }, tenantA);
  assert.equal(sp.status, 200, JSON.stringify(sp.body));
  assert.ok(Math.abs(sp.body.totals.direct - std.body.totals.direct) < 1e-9, '300 AED ÷ 3 = 100 L');
  assert.equal((await api('GET', '/api/prices', undefined, tenantB)).body.prices.length, 0, "another company does not see A's prices");

  // EV in the UAE without a UAE grid factor: Scope 2 = 0 with a warning; saved with scope2 column
  const e = await api('POST', '/api/activities', { facilityId: facA, itemId: bevCar, unit: 'km', quantity: 2000, ...period, vehicle: { method: 'distance', vehicleId: ev.body.id } }, tenantA);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.ok(e.body.warnings.some((w: string) => /No grid electricity factor for AE/.test(w)));
  // Add a UAE grid factor (platform) → Scope 2 = km × kWh/km × factor
  const grid = await itemId('grid:electricity');
  const gf = await api('POST', '/api/admin/factors', { itemId: grid, sourceCode: 'TEST-AE-GRID', region: 'AE', basis: 'scope2', unit: 'kWh_e', co2e: 0.4, validFrom: '2026-01-01', validTo: '2026-12-31' });
  assert.equal(gf.status, 200, JSON.stringify(gf.body));
  const { refdata } = await import('../src/modules/refdata.js'); void refdata;
  const e2 = await api('POST', '/api/calculate', { facilityId: facA, itemId: bevCar, unit: 'km', quantity: 2000, ...period, vehicle: { method: 'distance', vehicleId: ev.body.id } }, tenantA);
  const kwhPerKm = Number((await pool.query(`SELECT kwh_per_unit FROM vehicle_energy WHERE item_id = $1 AND unit = 'km' AND valid_from = '2026-01-01' AND status = 'active'`, [bevCar])).rows[0].kwh_per_unit);
  assert.equal(e2.body.totals.direct, 0);
  assert.ok(Math.abs(e2.body.totals.scope2 - 2000 * kwhPerKm * 0.4) < 1e-6, `${e2.body.totals.scope2}`);
  const site = await api('POST', '/api/calculate', { facilityId: facA, itemId: bevCar, unit: 'km', quantity: 2000, ...period, vehicle: { method: 'distance', vehicleId: ev.body.id, charging: 'site' } }, tenantA);
  assert.equal(site.body.totals.scope2, 0, 'charged on site: already in the site meter');

  // Retire: not offered after the date; entries after it are refused
  assert.equal((await api('POST', `/api/vehicles/${van.body.id}/retire`, { retiredOn: '2026-01-31' }, tenantA)).status, 200);
  const list = await api('GET', `/api/facilities/${facA}/vehicles?from=2026-03-01&to=2026-03-31`, undefined, tenantA);
  assert.ok(!list.body.vehicles.some((v: { id: string }) => v.id === van.body.id));
  const late = await api('POST', '/api/calculate', { facilityId: facA, itemId: dieselVan, unit: 'km', quantity: 10, ...period, vehicle: { method: 'distance', vehicleId: van.body.id } }, tenantA);
  assert.equal(late.status, 400);
  assert.equal((await api('POST', `/api/vehicles/${ev.body.id}/retire`, { retiredOn: '2026-02-01' }, tenantA)).status, 400, 'has an entry in March');
  assert.equal((await api('DELETE', `/api/vehicles/${ev.body.id}`, undefined, tenantA)).status, 400, 'has entries: retire, not delete');
  // Another company cannot see the fleet
  assert.equal((await api('GET', `/api/facilities/${facA}/vehicles`, undefined, tenantB)).status, 404);
});

test('vehicles: fleet upload from Excel — preview, then add valid rows', async () => {
  const t = await app.inject({ method: 'GET', url: '/api/vehicles/template.xlsx', headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(t.statusCode, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(t.rawPayload as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Fleet')!;
  ws.spliceRows(2, 1);
  ws.addRow(['Truck 7', 'SHJ 77', 'Rigid (>17 tonnes) · Average laden', '', 'owned', '', '2025-06-01', 'distance', '']);
  ws.addRow(['Forklift 2', '', 'Machinery · LPG (e.g. forklift)', '', 'leased', '', '01/02/2024', 'fuel', '']);
  ws.addRow(['Mystery', '', 'Flying car', '', 'owned', '', '2025-01-01', 'distance', '']);
  ws.addRow(['No date', '', 'Average car · Petrol', '', 'owned', '', '', 'distance', '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const up = (commit: boolean) => app.inject({ method: 'POST', url: `/api/facilities/${facA}/vehicles/upload${commit ? '?commit=1' : ''}`, payload: buf,
    headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream' } });
  const pre = (await up(false)).json();
  assert.equal(pre.rows.length, 4, JSON.stringify(pre));
  assert.equal(pre.valid, 2, JSON.stringify(pre.rows.map((r: { errors: string[] }) => r.errors)));
  assert.match(pre.rows[2].errors[0], /Unknown vehicle type/);
  assert.match(pre.rows[3].errors.join(), /date/);
  assert.equal(pre.rows[1].inServiceFrom, '2024-02-01');
  const done = (await up(true)).json();
  assert.equal(done.added, 2);
  const list = await api('GET', `/api/facilities/${facA}/vehicles`, undefined, tenantA);
  assert.ok(list.body.vehicles.some((v: { name: string; default_method: string }) => v.name === 'Forklift 2' && v.default_method === 'fuel'));
});

test('vehicles: data template per fleet and month; upload preview then save; batch keeps good rows', async () => {
  const t = await app.inject({ method: 'GET', url: `/api/vehicles/entries-template.xlsx?facilityId=${facA}&from=2026-04&to=2026-05`, headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(t.statusCode, 200, t.body);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(t.rawPayload as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Vehicle data')!;
  const prefilled: string[] = [];
  ws.eachRow((r, n) => { if (n > 1) prefilled.push(`${r.getCell(2).value}|${r.getCell(3).value}|${r.getCell(8).value}`); });
  assert.ok(prefilled.includes('2026-04|SHJ 77|distance'), prefilled.join(','));
  assert.ok(prefilled.includes('2026-05|Forklift 2|fuel'));
  ws.eachRow((r, n) => { if (n > 1) r.getCell(6).value = 100; });
  ws.addRow(['Sharjah plant', '2026-05', 'Spaceship', '', '', 5, 'km', '', '', '', '', 'actual', '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const up = (commit: boolean) => app.inject({ method: 'POST', url: `/api/vehicles/entries/upload${commit ? '?commit=1' : ''}`, payload: buf,
    headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream' } });
  const pre = (await up(false)).json();
  assert.equal(pre.rows.length, prefilled.length + 1, JSON.stringify(pre).slice(0, 500));
  assert.equal(pre.valid, prefilled.length, JSON.stringify(pre.rows.filter((r: { errors: string[] }) => r.errors.length)));
  assert.match(pre.rows.at(-1).errors[0], /Could not read "Spaceship"/);
  const before = (await api('GET', '/api/activities?limit=1000', undefined, tenantA)).body.activities.length;
  assert.equal(pre.saved, 0);
  const done = (await up(true)).json();
  assert.equal(done.saved, prefilled.length);
  assert.equal((await api('GET', '/api/activities?limit=1000', undefined, tenantA)).body.activities.length, before + prefilled.length);

  const truck = (await api('GET', `/api/facilities/${facA}/vehicles`, undefined, tenantA)).body.vehicles.find((v: { name: string }) => v.name === 'Truck 7');
  const b = await api('POST', '/api/activities/batch', { dryRun: true, entries: [
    { facilityId: facA, itemId: truck.item_id, unit: 'km', quantity: 10, periodStart: '2026-06-01', periodEnd: '2026-06-30', vehicle: { method: 'distance', vehicleId: truck.id } },
    { facilityId: facA, itemId: truck.item_id, unit: 'km', quantity: -1, periodStart: '2026-06-01', periodEnd: '2026-06-30', vehicle: { method: 'distance', vehicleId: truck.id } },
  ] }, tenantA);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual(b.body.results.map((r: { ok: boolean }) => r.ok), [true, false]);
});

test('recalculate: an EV entry saved before the grid factor existed gets its Scope 2 once recalculated', async () => {
  const bevCar = await itemId('veh:cars_by_size:average-car:battery-electric-vehicle');
  // Company B (AE, no AE grid factor at first? A's test added one valid 2026) — use 2025, which has none.
  const b = (await api('GET', '/api/org', undefined, tenantB)).body.nodes.find((n: { kind: string }) => n.kind === 'facility').id;
  const v = await api('POST', `/api/facilities/${b}/vehicles`, { name: 'B EV', itemId: bevCar, inServiceFrom: '2025-01-01' }, tenantB);
  const saved = await api('POST', '/api/activities', { facilityId: b, itemId: bevCar, unit: 'km', quantity: 1000, periodStart: '2025-05-01', periodEnd: '2025-05-31', vehicle: { method: 'distance', vehicleId: v.body.id } }, tenantB);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.totals.scope2, 0);
  const grid = await itemId('grid:electricity');
  assert.equal((await api('POST', '/api/admin/factors', { itemId: grid, sourceCode: 'TEST-AE-GRID-2025', region: 'AE', basis: 'scope2', unit: 'kWh_e', co2e: 0.5, validFrom: '2025-01-01', validTo: '2025-12-31' })).status, 200);
  const r = await api('POST', '/api/activities/recalculate', { year: 2025 }, tenantB);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.changed >= 1, JSON.stringify(r.body));
  const after = (await api('GET', `/api/activities/${saved.body.id}`, undefined, tenantB)).body;
  assert.ok(Number(after.co2e_scope2) > 0);
  assert.equal(after.warnings.length, 0);
  // Recalculating again changes nothing.
  assert.equal((await api('POST', '/api/activities/recalculate', { ids: [saved.body.id], onlyWithWarnings: false }, tenantB)).body.changed, 0);
});

test('vehicles: pasted rows — "car petrol | 2 | 34 km" = 2 cars × 34 km; method read from the unit; bad rows never saved', async () => {
  const rows = [
    { what: 'car petrol', count: '2', quantity: '34', unit: 'km' },
    { what: 'pickup diesel', quantity: '120 L' },                         // litres → fuel used
    { what: 'SHJ 77', quantity: '3000', unit: 'km', month: '2026-07' },     // fleet truck by registration (any spacing)
    { what: 'car petrol', count: '3', quantity: '500', unit: 'AED' },      // spend, needs a price
    { what: 'Spaceship', quantity: '5', unit: 'km' },
    { what: 'car petrol', count: '1.5', quantity: '10', unit: 'km' },
  ];
  const pre = await api('POST', '/api/vehicles/entries/rows', { facilityId: facA, month: '2026-08', rows }, tenantA);
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  const [car, pickup, truck, spend, bad, half] = pre.body.rows;
  assert.equal(car.read.vehicle, 'Average car · Petrol');
  assert.equal(car.read.total, 68);
  assert.deepEqual(car.errors, []);
  const one = await api('POST', '/api/calculate', { facilityId: facA, itemId: car.read.typeId, unit: 'km', quantity: 68, periodStart: '2026-08-01', periodEnd: '2026-08-31', vehicle: { method: 'distance' } }, tenantA);
  assert.ok(Math.abs(car.totals.direct - one.body.totals.direct) < 1e-9, '2 × 34 km = 68 km');
  assert.equal(pickup.read.method, 'fuel');
  assert.equal(pickup.read.unit, 'L');
  assert.equal(truck.read.vehicleKind, 'fleet');
  assert.equal(truck.read.month, '2026-07');
  assert.match(spend.errors.join(), /No AED price/);
  assert.match(bad.errors.join(), /Could not read/);
  assert.match(half.errors.join(), /whole number/);
  assert.equal(pre.body.saved, 0);
  // Choose the type for the unreadable row, then save: only good rows are saved.
  rows[4] = { ...rows[4]!, typeId: car.read.typeId } as typeof rows[number];
  const done = await api('POST', '/api/vehicles/entries/rows', { facilityId: facA, month: '2026-08', rows, commit: true }, tenantA);
  assert.equal(done.body.saved, 4, JSON.stringify(done.body.rows.map((r: { errors: string[] }) => r.errors)));
  const list = (await api('GET', `/api/activities?facilityId=${facA}&year=2026&category=mobile_combustion&limit=1000`, undefined, tenantA)).body.activities;
  const saved = list.find((a: { quantity: number; unit: string; period_start: string }) => Number(a.quantity) === 68 && a.unit === 'km' && a.period_start.startsWith('2026-08'));
  assert.ok(saved, 'saved as 68 km');
  const detail = (await api('GET', `/api/activities/${saved.id}`, undefined, tenantA)).body;
  assert.equal(detail.inputs.vehicle.count, 2);
  assert.match(detail.steps[0], /^2 vehicles × 34 km each = 68 km/);
  // Recalculating keeps the count.
  await api('POST', '/api/activities/recalculate', { ids: [saved.id], onlyWithWarnings: false }, tenantA);
  assert.match((await api('GET', `/api/activities/${saved.id}`, undefined, tenantA)).body.steps[0], /^2 vehicles/);
});

// ------------------------------------------------------------------ Scope 2 --
test('Scope 2 electricity: UK location vs market; Dubai sub-region; certificates claimed once; supplier factor; T&D as loss %', async () => {
  const grid = await itemId('grid:electricity');
  const period = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };
  // UK facility: DESNZ 2026
  const groupA = (await api('GET', '/api/org', undefined, tenantA)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const london = (await api('POST', '/api/org/nodes', { parentId: groupA, kind: 'facility', name: 'London office', country: 'GB' }, tenantA)).body.id;
  const uk = await api('POST', '/api/calculate', { facilityId: london, itemId: grid, unit: 'MWh_e', quantity: 10, ...period }, tenantA);
  assert.equal(uk.status, 200, JSON.stringify(uk.body));
  const desnz = async (basis: string) => Number((await pool.query(`SELECT co2e FROM factor f JOIN factor_source s ON s.id = f.source_id WHERE f.item_id = $1 AND f.region = 'GB' AND f.basis = $2 AND s.code = 'DESNZ-2026' AND f.status = 'active'`, [grid, basis])).rows[0].co2e);
  assert.ok(Math.abs(uk.body.totals.scope2 - 10000 * (await desnz('scope2'))) / uk.body.totals.scope2 < 0.001);
  // DESNZ's T&D gas split adds to 0.01300 against a published 0.01299 (rounding): within 0.1 %
  assert.ok(Math.abs(uk.body.totals.td_loss - 10000 * (await desnz('td_loss'))) / uk.body.totals.td_loss < 0.001);
  assert.ok(Math.abs(uk.body.totals.wtt - 10000 * (await desnz('wtt'))) < 1e-6);
  assert.ok(Math.abs(uk.body.totals.scope2_market - uk.body.totals.scope2) < 1e-6, 'no residual mix: grid average');

  // Dubai facility (test factors, platform admin): AE-DU location and residual, AE T&D as % loss
  assert.equal((await api('PATCH', `/api/org/nodes/${facA}`, { gridRegion: 'AE-DU' }, tenantA)).status, 200);
  for (const [kind, co2e, region] of [['location', 0.4, 'AE'], ['location', 0.35, 'AE-DU'], ['residual', 0.45, 'AE-DU']] as const) {
    const r = await api('POST', `/api/grid-regions/${region}/factors`, { kind, year: 2026, co2e, source: 'TEST-S2' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const td = await api('POST', '/api/grid-regions/AE/factors', { kind: 'td_loss', year: 2026, lossPct: 5, source: 'TEST-S2' });
  assert.ok(Math.abs(td.body.co2e - 0.02) < 1e-12, '5% × 0.4');
  const e1 = await api('POST', '/api/calculate', { facilityId: facA, itemId: grid, unit: 'kWh_e', quantity: 100000, ...period }, tenantA);
  assert.ok(Math.abs(e1.body.totals.scope2 - 35000) < 1e-6, JSON.stringify(e1.body.totals));
  assert.ok(Math.abs(e1.body.totals.scope2_market - 45000) < 1e-6);
  assert.ok(Math.abs(e1.body.totals.td_loss - 2000) < 1e-6);

  // Certificate: 60 MWh solar I-REC; claim 40 MWh on one entry, then only 20 MWh are left
  const cert = await api('POST', '/api/certificates', { instrument: 'certificate', standard: 'I-REC', technology: 'solar', mwh: 60, market: 'AE', vintageFrom: '2026-01-01', vintageTo: '2026-12-31', reference: 'IREC-TEST-1' }, tenantA);
  assert.equal(cert.status, 200, JSON.stringify(cert.body));
  const s1 = await api('POST', '/api/activities', { facilityId: facA, itemId: grid, unit: 'kWh_e', quantity: 100000, ...period, energy: { certificates: [{ certificateId: cert.body.id, kwh: 40000 }] } }, tenantA);
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.ok(Math.abs(s1.body.totals.scope2_market - 60000 * 0.45) < 1e-6, '40 MWh solar at 0 + 60 MWh residual');
  const over = await api('POST', '/api/activities', { facilityId: facA, itemId: grid, unit: 'kWh_e', quantity: 50000, periodStart: '2026-04-01', periodEnd: '2026-04-30', energy: { certificates: [{ certificateId: cert.body.id, kwh: 30000 }] } }, tenantA);
  assert.equal(over.status, 400);
  assert.match(over.body.message, /only 20,000 kWh left/);
  const list = (await api('GET', '/api/certificates', undefined, tenantA)).body.certificates.find((x: { id: string }) => x.id === cert.body.id);
  assert.equal(Number(list.claimed_mwh), 40);
  assert.equal((await api('DELETE', `/api/certificates/${cert.body.id}`, undefined, tenantA)).status, 400, 'claimed: cannot delete');
  assert.equal((await api('GET', '/api/certificates', undefined, tenantB)).body.certificates.length, 0, 'other company sees none');

  // Supplier factor (company's own) wins over the residual mix for the uncovered part
  const sup = await api('POST', '/api/supplier-factors', { supplier: 'Test utility', energy: 'electricity', co2e: 0.3, unit: 'kWh_e', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'test bill' }, tenantA);
  assert.equal(sup.status, 200, JSON.stringify(sup.body));
  const e2 = await api('POST', '/api/calculate', { facilityId: facA, itemId: grid, unit: 'kWh_e', quantity: 10000, ...period, energy: { supplierFactorId: sup.body.id } }, tenantA);
  assert.ok(Math.abs(e2.body.totals.scope2_market - 3000) < 1e-6);
  assert.ok(Math.abs(e2.body.totals.scope2 - 3500) < 1e-6, 'location unchanged');

  // Recalculation keeps the claim and does not count it twice
  const rc = await api('POST', '/api/activities/recalculate', { ids: [s1.body.id], onlyWithWarnings: false }, tenantA);
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.equal(rc.body.problems.length, 0, JSON.stringify(rc.body));
});

test('Scope 2 cooling and heat: supplier per TRh; plant efficiency × Dubai grid', async () => {
  const cool = await itemId('cooling:district');
  const period = { periodStart: '2026-03-01', periodEnd: '2026-03-31' };
  const sup = await api('POST', '/api/supplier-factors', { supplier: 'Test cooling', energy: 'cooling', co2e: 0.5, unit: 'TRh', validFrom: '2026-01-01', validTo: '2026-12-31', source: 'test' }, tenantA);
  const a = await api('POST', '/api/calculate', { facilityId: facA, itemId: cool, unit: 'TRh', quantity: 1000, ...period, energy: { supplierFactorId: sup.body.id, cooling: { method: 'supplier' } } }, tenantA);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.ok(Math.abs(a.body.totals.scope2 - 500) < 1e-9 && Math.abs(a.body.totals.scope2_market - 500) < 1e-9);
  const b = await api('POST', '/api/calculate', { facilityId: facA, itemId: cool, unit: 'TRh', quantity: 1000, ...period, energy: { cooling: { method: 'efficiency', kwhPerTrh: 0.8 } } }, tenantA);
  assert.ok(Math.abs(b.body.totals.scope2 - 800 * 0.35) < 1e-9, JSON.stringify(b.body.totals));
  const none = await api('POST', '/api/calculate', { facilityId: facA, itemId: cool, unit: 'TRh', quantity: 1000, ...period }, tenantA);
  assert.equal(none.status, 400);
  const heat = await itemId('heat:district');
  const wrong = await api('POST', '/api/calculate', { facilityId: facA, itemId: heat, unit: 'kWh_th', quantity: 1000, ...period, energy: { supplierFactorId: sup.body.id } }, tenantA);
  assert.equal(wrong.status, 400, 'cooling factor used for heat is refused');
});

test('waste Scope 1: landfill site register, FOD entry by hand, recalculation after the history changes; other company cannot see the site', async () => {
  const lf = await itemId('waste:landfill');
  const site = await api('POST', '/api/waste/sites', { facilityId: facA, name: 'Test cell', openedYear: 2018, params: { climate: 'tropical_dry', siteType: 'managed_anaerobic', ox: 0.1 } }, tenantA);
  assert.equal(site.status, 200, JSON.stringify(site.body));
  const h = await api('PUT', `/api/waste/sites/${site.body.id}/deposits`, { rows: [{ year: 2024, type: 'food', tonnes: 1000 }] }, tenantA);
  assert.equal(h.status, 200, JSON.stringify(h.body));
  const period = { periodStart: '2025-01-01', periodEnd: '2025-12-31' };
  const s = await api('POST', '/api/activities', { facilityId: facA, itemId: lf, unit: 't', ...period,
    waste: { process: 'landfill', siteId: site.body.id, recovery: [{ device: 'flare_enclosed', gasM3: 10, ch4Pct: 50 }] } }, tenantA);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const gen = 1000 * 0.15 * 0.7 * (1 - Math.exp(-0.085)) * 0.5 * 16 / 12 * 1000; // kg CH4
  const rec = 10 * 0.5 * 0.7168;
  const ch4 = (gen - rec) * 0.9 + rec * 0.1;
  assert.ok(Math.abs(s.body.totals.direct - ch4 * 28) < 1e-6, `${s.body.totals.direct} vs ${ch4 * 28}`);
  const saved = (await api('GET', `/api/activities/${s.body.id}`, undefined, tenantA)).body;
  assert.equal(saved.waste_site, 'Test cell');
  assert.ok(Math.abs(Number(saved.quantity) - gen / 1000) < 1e-6, 'quantity = t CH4 generated');

  // More history → recalculate the site's entries
  const h2 = await api('PUT', `/api/waste/sites/${site.body.id}/deposits`, { rows: [{ year: 2023, type: 'msw', tonnes: 5000 }] }, tenantA);
  assert.deepEqual(h2.body.entries, [s.body.id]);
  const rc = await api('POST', '/api/activities/recalculate', { ids: h2.body.entries, onlyWithWarnings: false }, tenantA);
  assert.equal(rc.body.changed, 1, JSON.stringify(rc.body));
  assert.ok(Number((await api('GET', `/api/activities/${s.body.id}`, undefined, tenantA)).body.co2e_direct) > s.body.totals.direct);

  assert.equal((await api('DELETE', `/api/waste/sites/${site.body.id}`, undefined, tenantA)).status, 400, 'has entries');
  assert.equal((await api('GET', '/api/waste/sites', undefined, tenantB)).body.sites.length, 0);
  const steal = await api('POST', '/api/calculate', { facilityId: facA, itemId: lf, unit: 't', ...period, waste: { process: 'landfill', siteId: site.body.id, recovery: [] } }, tenantB);
  assert.notEqual(steal.status, 200);
});

test('waste Scope 1: incineration (fossil CO2 + biogenic outside scopes), composting; Scope 3.5 DESNZ factor per tonne', async () => {
  const period = { periodStart: '2026-02-01', periodEnd: '2026-02-28' };
  const inc = await api('POST', '/api/calculate', { facilityId: facA, itemId: await itemId('waste:incineration'), unit: 't', ...period,
    waste: { process: 'incineration', streams: [{ type: 'plastics', tonnes: 100 }], technology: 'continuous_stoker' } }, tenantA);
  assert.equal(inc.status, 200, JSON.stringify(inc.body));
  assert.ok(Math.abs(inc.body.totals.direct - (275000 + 100 * 0.0002 * 28 + 100 * 0.05 * 265)) < 1e-6);
  const comp = await api('POST', '/api/calculate', { facilityId: facA, itemId: await itemId('waste:composting'), unit: 't', ...period,
    waste: { process: 'composting', tonnes: 100, basis: 'wet' } }, tenantA);
  assert.ok(Math.abs(comp.body.totals.direct - (400 * 28 + 24 * 265)) < 1e-6);
  const wrong = await api('POST', '/api/calculate', { facilityId: facA, itemId: await itemId('waste:composting'), unit: 't', ...period,
    waste: { process: 'ad', tonnes: 100, basis: 'wet' } }, tenantA);
  assert.equal(wrong.status, 400, 'process must match the item');

  const food = await itemId('waste3:refuse:organic-food-and-drink-waste:landfill');
  const f = (await pool.query(`SELECT co2e FROM factor WHERE item_id = $1 AND basis = 'scope3' AND valid_from = '2026-01-01' AND status = 'active'`, [food])).rows[0];
  const s3 = await api('POST', '/api/activities', { facilityId: facA, itemId: food, unit: 't', quantity: 12, ...period }, tenantA);
  assert.equal(s3.status, 200, JSON.stringify(s3.body));
  assert.ok(Math.abs(s3.body.totals.scope3 - 12 * Number(f.co2e)) < 1e-6);
  assert.equal(s3.body.totals.direct, 0);
  const row = (await api('GET', `/api/activities?category=waste_generated`, undefined, tenantA)).body.activities[0];
  assert.equal(row.ghg_category, 5);
  assert.ok(Math.abs(Number(row.co2e_scope3) - 12 * Number(f.co2e)) < 1e-6);
});

test('wastewater with flow: nitrogen as mg/L gives the same result as kg; twelve months saved in one batch', async () => {
  const ww = await itemId('waste:wastewater');
  const base = { facilityId: facA, itemId: ww, unit: 'kg', periodStart: '2024-01-01', periodEnd: '2024-01-31' };
  const w = { process: 'wastewater', kind: 'domestic', system: 'centralised_aerobic', measure: 'BOD', flowM3: 58000, mgPerL: 250, recovery: [] };
  const a = await api('POST', '/api/calculate', { ...base, waste: { ...w, nInfluentMgPerL: 40 } }, tenantA);
  const b = await api('POST', '/api/calculate', { ...base, waste: { ...w, nInfluentKg: 2320 } }, tenantA);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.ok(Math.abs(a.body.totals.direct - b.body.totals.direct) < 1e-9);
  assert.ok(a.body.steps.some((s: string) => /58000 m³ × 40 mg\/L/.test(s)));
  const months = Array.from({ length: 12 }, (_, m) => ({ ...base, periodStart: `2024-${String(m + 1).padStart(2, '0')}-01`,
    periodEnd: new Date(Date.UTC(2024, m + 1, 0)).toISOString().slice(0, 10), waste: { ...w, flowM3: 50000 + m * 1000, nInfluentMgPerL: 40 } }));
  const r = await api('POST', '/api/activities/batch', { entries: months, dryRun: false }, tenantA);
  assert.equal(r.body.saved, 12, JSON.stringify(r.body));
});

test('meters: register readings via the screen → monthly entries; API key ingest (hourly interval), corrections, approved entries locked, other company isolated', async () => {
  const gas = await itemId('desnz:natural-gas');
  const tz = (await api('GET', '/api/tenant', undefined, tenantA)).body.timezone;
  assert.equal(tz, 'Asia/Dubai');
  // 1. Daily register (cumulative) meter, m³, readings Jan 1 – Feb 10 2024 (local midnight), 100 m³ a day
  const m1 = await api('POST', '/api/meters', { facilityId: facA, name: 'Boiler gas meter', readingType: 'cumulative', frequency: 'day', unit: 'm3', itemId: gas, template: {} }, tenantA);
  assert.equal(m1.status, 200, JSON.stringify(m1.body));
  const day = (d: number) => new Date(Date.UTC(2024, 0, 1 + d) - 4 * 3600_000).toISOString();
  const rd = Array.from({ length: 41 }, (_, d) => ({ timestamp: day(d), value: 5000 + 100 * d }));
  const up = await api('POST', `/api/meters/${m1.body.id}/readings`, { readings: rd }, tenantA);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.inserted, 41);
  assert.equal(up.body.sync.created, 2, JSON.stringify(up.body.sync)); // January (full) and February (partial, closed)
  const detail = (await api('GET', `/api/meters/${m1.body.id}`, undefined, tenantA)).body;
  const jan = detail.months.find((x: { month: string }) => x.month === '2024-01');
  assert.ok(Math.abs(jan.consumption - 3100) < 1e-6 && jan.coverage === 1 && !jan.filled);
  const feb = detail.months.find((x: { month: string }) => x.month === '2024-02');
  assert.ok(feb.filled && Math.abs(feb.consumption - 900 / (9 / 29)) < 1e-6, JSON.stringify(feb));
  const manual = await api('POST', '/api/calculate', { facilityId: facA, itemId: gas, unit: 'm3', quantity: 3100, periodStart: '2024-01-01', periodEnd: '2024-01-31' }, tenantA);
  const janEntry = (await api('GET', `/api/activities/${jan.entry.id}`, undefined, tenantA)).body;
  assert.ok(Math.abs(Number(janEntry.co2e_direct) - manual.body.totals.direct) < 1e-6);
  assert.equal(janEntry.meter, 'Boiler gas meter');
  assert.match(janEntry.steps[0], /Boiler gas meter/);
  assert.equal((await api('GET', `/api/activities/${feb.entry.id}`, undefined, tenantA)).body.data_type, 'estimated');

  // 2. API key + hourly interval meter (kWh), readings sent by a "BMS"
  const m2 = await api('POST', '/api/meters', { facilityId: facA, name: 'Kitchen gas (BMS)', externalId: 'BMS-GAS-01', readingType: 'interval', frequency: 'hour', unit: 'kWh', itemId: gas, template: {} }, tenantA);
  assert.equal(m2.status, 200, JSON.stringify(m2.body));
  const key = await api('POST', '/api/api-keys', { name: 'BMS test' }, tenantA);
  assert.match(key.body.key, /^ek_/);
  const tokRes = await app.inject({ method: 'POST', url: '/api/v1/oauth/token', payload: `grant_type=client_credentials&client_id=${key.body.id}&client_secret=${encodeURIComponent(key.body.key)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(tokRes.statusCode, 200, tokRes.body);
  const token = tokRes.json().access_token as string;
  assert.equal(tokRes.json().token_type, 'Bearer');
  const bad = await app.inject({ method: 'POST', url: '/api/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: key.body.id, client_secret: 'ek_wrongwrongwrongwrongwrong' } });
  assert.equal(bad.statusCode, 401);
  const send = (body: unknown, k = token) => app.inject({ method: 'POST', url: '/api/v1/meter-readings', payload: body as object, headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' } });
  const hours = Array.from({ length: 29 * 24 }, (_, h) => ({ meterId: 'BMS-GAS-01', timestamp: new Date(Date.UTC(2024, 1, 1, h + 1) - 4 * 3600_000).toISOString(), value: 10 }));
  // readings wait for review: new / duplicates / rejected, nothing booked yet
  const r1 = await send({ readings: [...hours, { meterId: 'NOPE', timestamp: '2024-02-01T00:00:00Z', value: 1 }, { meterId: 'BMS-GAS-01', timestamp: 'yesterday', value: 1 }] });
  assert.equal(r1.statusCode, 200, r1.body);
  const j1 = r1.json();
  assert.equal(j1.status, 'review'); assert.equal(j1.new, 696); assert.equal(j1.rejected.length, 2);
  const j1b = (await send({ readings: hours })).json();
  assert.equal(j1b.duplicates, 696, 'the same readings again while the first batch waits');
  const pending = (await api('GET', '/api/reading-batches?status=review', undefined, tenantA)).body.batches;
  assert.equal(pending.length, 2);
  const prev = (await api('GET', `/api/reading-batches/${j1.batchId}`, undefined, tenantA)).body;
  assert.equal(prev.meters[0].new, 696); assert.ok(Math.abs(prev.meters[0].total - 6960) < 1e-6);
  assert.equal((await api('POST', `/api/reading-batches/${j1b.batchId}/discard`, {}, tenantA)).status, 200);
  const pub = await api('POST', `/api/reading-batches/${j1.batchId}/publish`, {}, tenantA);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.inserted, 696); assert.equal(pub.body.entries.created, 1);
  assert.equal((await api('POST', `/api/reading-batches/${j1.batchId}/publish`, {}, tenantA)).status, 400, 'published once');
  // the company can switch review off: readings are then stored at once
  assert.equal((await api('PATCH', '/api/tenant/review-readings', { review: false }, tenantA)).status, 200);
  const e2 = (await api('GET', `/api/activities?category=stationary_combustion&limit=1000`, undefined, tenantA)).body.activities.find((a: { meter: string }) => a.meter === 'Kitchen gas (BMS)');
  assert.ok(Math.abs(Number(e2.quantity) - 6960) < 1e-6);
  // same readings again: nothing changes
  const r2 = (await send({ readings: hours })).json();
  assert.equal(r2.unchanged, 696); assert.equal(r2.inserted + r2.updated, 0);
  // approved month is not changed by a correction
  { const cl = await pool.connect(); await cl.query('BEGIN'); await cl.query(`SELECT set_config('app.platform','on',true)`);
    await cl.query(`UPDATE activity SET status = 'approved' WHERE id = $1`, [e2.id]); await cl.query('COMMIT'); cl.release(); }
  const r3 = (await send({ readings: [{ ...hours[5]!, value: 500 }] })).json();
  assert.equal(r3.updated, 1);
  assert.equal(r3.meters[0].entries.locked.length, 1);
  // keys: listing the company's meters; revoked key refused; other company sees nothing
  const list = await app.inject({ method: 'GET', url: '/api/v1/meters', headers: { authorization: `Bearer ${token}` } });
  assert.equal(list.json().meters.length, 2);
  assert.equal((await send({ readings: hours.slice(0, 1) }, key.body.key)).statusCode, 200, 'the secret itself also works');
  await api('DELETE', `/api/api-keys/${key.body.id}`, undefined, tenantA);
  assert.equal((await send({ readings: hours.slice(0, 1) })).statusCode, 401, 'token of a revoked client refused');
  assert.equal((await api('GET', '/api/meters', undefined, tenantB)).body.meters.length, 0);
  assert.equal((await api('GET', `/api/meters/${m1.body.id}`, undefined, tenantB)).status, 404);
});

test('bills: upload a PDF, read, match the account to a meter, check, confirm → reading and monthly entries split by days; duplicate file recognised; reopen', async () => {
  const { makePdf, SAMPLE_ELECTRICITY } = await import('./helpers/pdf.js');
  const grid = await itemId('grid:electricity');
  const m = await api('POST', '/api/meters', { facilityId: facA, name: 'SEWA main account', readingType: 'interval', frequency: 'month', unit: 'kWh_e', itemId: grid, template: {}, accountNo: '2001458876' }, tenantA);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  // A bill spanning two months: 15 Feb – 14 Mar 2026
  const lines = SAMPLE_ELECTRICITY.map((l) => (Array.isArray(l) && l[0] === 'Billing Period:' ? ['Billing Period:', '15/02/2026 - 14/03/2026'] as [string, string] : l));
  const pdf = Buffer.from(await makePdf(lines));
  const up = await app.inject({ method: 'POST', url: '/api/bills/upload', payload: pdf, headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream', 'x-filename': 'sewa-mar.pdf' } });
  assert.equal(up.statusCode, 200, up.body);
  const bill = up.json();
  assert.equal(bill.meter_id, m.body.id, 'matched by account number');
  assert.equal(Number(bill.quantity), 45500); assert.equal(bill.unit, 'kWh_e'); assert.equal(bill.status, 'to_check');
  const again = await app.inject({ method: 'POST', url: '/api/bills/upload', payload: pdf, headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream' } });
  assert.equal(again.json().duplicate, true);
  const notPdf = await app.inject({ method: 'POST', url: '/api/bills/upload', payload: Buffer.from('hello'), headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream' } });
  assert.equal(notPdf.statusCode, 400);
  const doc = await app.inject({ method: 'GET', url: `/api/documents/${bill.document_id}`, headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(doc.headers['content-type'], 'application/pdf');
  // Confirm with a correction (person checked: 45,600)
  const ok = await api('POST', `/api/bills/${bill.id}/confirm`, { quantity: 45600 }, tenantA);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.sync.created, 2);
  const ent = (await api('GET', `/api/bills/${bill.id}`, undefined, tenantA)).body.entries;
  assert.equal(ent.length, 2);
  const feb = ent.find((e: { period_start: string }) => e.period_start === '2026-02-01'), mar = ent.find((e: { period_start: string }) => e.period_start === '2026-03-01');
  // February has 14 of the bill's 28 days; it is 14/28 of the month → scaled to the whole month (estimated)
  assert.ok(Math.abs(Number(feb.quantity) - 45600 * (14 / 28) / (14 / 28)) < 1e-3, JSON.stringify(ent));
  assert.ok(Math.abs(Number(mar.quantity) - 45600 * (14 / 28) / (14 / 31)) < 1e-3);
  // Another bill for the same period cannot be booked; reopening removes the reading and the entries
  assert.equal((await api('POST', `/api/bills/${bill.id}/confirm`, {}, tenantA)).status, 400);
  const re = await api('POST', `/api/bills/${bill.id}/reopen`, {}, tenantA);
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.equal((await api('GET', `/api/bills/${bill.id}`, undefined, tenantA)).body.entries.length, 0);
  assert.equal((await api('GET', '/api/bills', undefined, tenantB)).body.bills.length, 0);
});

test('bills by category: checked bills previewed (months, emissions), duplicates and overlaps blocked, then published', async () => {
  const { makePdf, SAMPLE_ELECTRICITY } = await import('./helpers/pdf.js');
  const grid = await itemId('grid:electricity');
  const m = await api('POST', '/api/meters', { facilityId: facA, name: 'SEWA annex', readingType: 'interval', frequency: 'month', unit: 'kWh_e', itemId: grid, template: {}, accountNo: '2001777001' }, tenantA);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const pdf = (period: string, billNo: string, extra = '') => makePdf(SAMPLE_ELECTRICITY.map((l) => (Array.isArray(l) ? (l[0] === 'Billing Period:' ? ['Billing Period:', period] : l[0] === 'Account No:' ? ['Account No:', '2001777001'] : l[0] === 'Bill No:' ? ['Bill No:', billNo] : l) as [string, string] : l)).concat(extra ? [extra] : []));
  const up = async (b: Uint8Array, name: string) => (await app.inject({ method: 'POST', url: '/api/bills/upload', payload: Buffer.from(b), headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream', 'x-filename': name, 'x-category': 'purchased_electricity' } })).json();
  const a = await up(await pdf('01/05/2025 - 31/05/2025', 'INV-A-1'), 'may.pdf');
  const b = await up(await pdf('01/06/2025 - 30/06/2025', 'INV-A-1', 'copy sent again'), 'may-copy.pdf');   // same bill number
  const c = await up(await pdf('15/05/2025 - 14/06/2025', 'INV-A-3'), 'overlap.pdf');                        // overlaps May
  assert.equal(a.category, 'purchased_electricity'); assert.equal(a.meter_id, m.body.id);
  const listed = (await api('GET', '/api/bills?category=purchased_electricity&status=to_check', undefined, tenantA)).body.bills.map((x: { id: string }) => x.id);
  assert.ok([a.id, b.id, c.id].every((id) => listed.includes(id)));
  assert.equal((await api('GET', '/api/bills?category=waste', undefined, tenantA)).body.bills.length, 0);
  for (const x of [a, b, c]) assert.equal((await api('POST', `/api/bills/${x.id}/check`, {}, tenantA)).status, 200);
  const pv = (await api('GET', '/api/bills/preview?category=purchased_electricity', undefined, tenantA)).body.bills;
  const pa = pv.find((x: { id: string }) => x.id === a.id), pb = pv.find((x: { id: string }) => x.id === b.id), pc = pv.find((x: { id: string }) => x.id === c.id);
  assert.equal(pa.months.length, 1); assert.ok(pa.co2e > 0, 'emissions estimated');
  assert.ok(pb.issues.some((i: { text: string }) => /Same bill number/.test(i.text)), JSON.stringify(pb.issues));
  assert.ok(pc.issues.some((i: { text: string }) => /Also ready/.test(i.text)), JSON.stringify(pc.issues));
  assert.equal(pc.months.length, 2, 'split over May and June');
  const pub = (await api('POST', '/api/bills/publish', { ids: [a.id, b.id, c.id] }, tenantA)).body;
  assert.equal(pub.booked, 1, JSON.stringify(pub)); assert.equal(pub.failed.length, 2);
  // after publishing May, the overlapping bill is blocked as already booked
  const again = (await api('GET', '/api/bills/preview?category=purchased_electricity', undefined, tenantA)).body.bills.find((x: { id: string }) => x.id === c.id);
  assert.ok(again.issues.some((i: { text: string }) => /Already booked/.test(i.text)));
  // editing a checked bill sends it back to check
  assert.equal((await api('PATCH', `/api/bills/${c.id}`, { note: 'wrong period?' }, tenantA)).body.status, 'to_check');
});

test('plans: trial limits facilities and people, refuses AI, export and dashboard groups; groups on a full plan, shown only with every facility visible', async () => {
  const co = await api('POST', '/api/platform/companies', { name: 'Trial Co', country: 'AE', plan: 'trial', superAdmin: { name: 'Tia', email: 'tia@trial.test' } });
  assert.equal(co.status, 200, JSON.stringify(co.body));
  const T = co.body.company.id as string;
  const root = (await api('GET', '/api/org', undefined, T)).body.nodes.find((n: { kind: string }) => n.kind === 'group');
  const fac = (i: number) => api('POST', '/api/org/nodes', { parentId: root.id, kind: 'facility', name: `Site ${i}` }, T);
  for (let i = 1; i <= 3; i++) assert.equal((await fac(i)).status, 200);
  const fourth = await fac(4);
  assert.equal(fourth.status, 403); assert.match(fourth.body.error?.message ?? JSON.stringify(fourth.body), /Trial plan allows 3 facilities/);
  for (let i = 1; i <= 4; i++) assert.equal((await api('POST', '/api/users', { name: `Person ${i}`, email: `p${i}@trial.test`, role: 'verifier' }, T)).status, 200);
  assert.equal((await api('POST', '/api/users', { name: 'Person 5', email: 'p5@trial.test', role: 'verifier' }, T)).status, 403, '5 people incl. the super admin');
  const facs = (await api('GET', '/api/org', undefined, T)).body.nodes.filter((n: { kind: string }) => n.kind === 'facility').map((n: { id: string }) => n.id);
  assert.equal((await api('POST', '/api/dashboard-groups', { name: 'Two sites', facilityIds: facs.slice(0, 2) }, T)).status, 403);
  assert.equal((await api('GET', '/api/purchases/published/export?format=csv', undefined, T)).status, 403);
  const me = (await api('GET', '/api/dashboard-groups', undefined, T)).body; assert.equal(me.allowed, false);
  // upgraded: groups work, open in the dashboard
  assert.equal((await api('PATCH', `/api/platform/companies/${T}`, { plan: 'professional', price: 24000, billingCycle: 'annual', poRef: 'PO-77' })).status, 200);
  const listed = (await api('GET', '/api/platform/companies')).body;
  const row = listed.companies.find((c: { id: string }) => c.id === T);
  assert.equal(row.price, 24000); assert.equal(row.po_ref, 'PO-77'); assert.equal(listed.plans.length, 4);
  const g = await api('POST', '/api/dashboard-groups', { name: 'Two sites', facilityIds: facs.slice(0, 2) }, T);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal((await api('POST', '/api/dashboard-groups', { name: 'two sites', facilityIds: facs.slice(0, 1) }, T)).status, 409);
  assert.equal((await api('GET', '/api/dashboard-groups', undefined, T)).body.groups[0].facilityIds.length, 2);
  const d = await api('GET', `/api/dashboard?group=${g.body.id}`, undefined, T);
  assert.equal(d.status, 200); assert.equal(d.body.group.name, 'Two sites'); assert.equal(d.body.facilities.length, 2);
  const sum = (await api('GET', '/api/org/summary', undefined, T)).body; assert.equal(sum.facilities.length, 3);
  assert.equal((await api('DELETE', `/api/dashboard-groups/${g.body.id}`, undefined, T)).status, 200);
  assert.equal((await api('GET', '/api/dashboard-groups', undefined, tenantA)).body.groups.length, 0, 'other company sees none');
});

test('capital goods list: parts, materials and consumables of the old list count as purchased goods', async () => {
  const items = (await api('GET', '/api/purchases/capital-list', undefined, tenantA)).body.items as { name: string; capital: boolean; note: string | null }[];
  if (!items.length) return; // the old product list is not loaded in this database
  const by = (re: RegExp) => items.find((i) => re.test(i.name));
  assert.equal(by(/Brake System/)?.capital, false); assert.equal(by(/Iron and Steel Mills/)?.capital, false); assert.equal(by(/Surgical gloves/)?.capital, false);
  assert.equal(by(/Heavy Duty Truck/)?.capital, true); assert.equal(by(/Laptop/)?.capital, true);
  assert.notEqual((await api('PATCH', `/api/purchases/capital-list/1`, { capital: true }, tenantA)).status, 200, 'only products of the old list can be switched');
});

// ------------------------------------------------------------ purchases --
const raw = (path: string, body: Buffer, tenant: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: path, payload: body, headers: { cookie: adminCookie, 'x-tenant-id': tenant, 'content-type': 'application/octet-stream', ...headers } });
const drain = async () => (await import('../src/lib/jobs.js')).drainJobs();
const CPI_24_22 = 292.655 / 313.689;
/** Direct query as the platform (row-level security is forced on company tables). */
const pq = async (sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.platform','on',true)`); const r = await c.query(sql, params); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
};

test('purchases: EPA factor file import; ERP export in its own layout → groups, mapping, overlap, facilities, FX, supplier factor, publish, reopen, duplicates', async () => {
  const { readFileSync } = await import('node:fs');
  // the seed loaded the real EPA file and the previous Ekotrace products
  const csv = readFileSync(new URL('../../../data/epa/SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv', import.meta.url));
  const pre = await raw('/api/admin/import/epa?preview=1', csv, tenantA, { 'x-filename': 'SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv' });
  assert.equal(pre.statusCode, 200, pre.body);
  assert.deepEqual([pre.json().priceYear, pre.json().version, pre.json().rows], [2022, '1.3.0', 1016]);
  assert.equal((await raw('/api/admin/import/epa', csv, tenantA, { 'x-filename': 'SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv' })).json().skipped, true);
  const epaPaper = Number((await pq(`SELECT f.co2e FROM factor f JOIN item i ON i.id = f.item_id WHERE i.code = 'epa:naics:322230' AND f.status = 'active'`)).rows[0].co2e);
  assert.equal(epaPaper, 0.296); // EPA v1.3, stationery product manufacturing, with margins (0.265 + 0.031)
  const oldProducts = Number((await pq(`SELECT count(*) FROM item WHERE code LIKE 'old:%'`)).rows[0].count);
  assert.ok(oldProducts > 1600, String(oldProducts));
  // an export of the old tables (two rows) → products with the EPA factor of their NAICS code
  const oldPre = await api('POST', '/api/admin/import/old-purchases', { preview: true, factors: 'id,typeofpurchase,category,sub_category,product,NAIC_code,EFkgC02e_ccy\n1,1,24,83,"Office Products",339940,0.1\n2,1,24,83,"Office Products",339940,0.1' }, tenantA);
  assert.deepEqual([oldPre.body.rows, oldPre.body.products], [2, 1]);
  const usdFactor = async (item: number) => Number((await pq(`SELECT co2e FROM factor WHERE item_id = $1 AND status = 'active' AND unit = 'USD'`, [item])).rows[0].co2e);

  // An ERP export: two title rows, then the header; several descriptive columns.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ERP Jul - Dec 24');
  ws.addRow(['Purchase order lines']); ws.addRow(['Exported 2024-12-31']);
  ws.addRow(['Order', 'Line', 'Category Name', 'Description', 'Item Name', 'UOM Name', 'Qty', 'Price', 'Purchase Order Line Amount', 'Account Description', 'Supplier', 'Order Date', 'Site']);
  const rows: unknown[][] = [
    [4500101, 1, 'Office supplies', 'A4 paper', 'Copier paper 80gsm', 'box', 50, 73.45, '3,672.50', 'Office expenses', 'Gulf Stationery LLC', new Date('2024-03-10'), 'Sharjah plant'],
    [4500102, 1, 'Office supplies', 'A4 paper', 'Copier paper 80gsm', 'box', 50, 73.45, 3672.5, 'Office expenses', 'Gulf Stationery L.L.C.', '15/04/2024', 'Sharjah plant'],
    [4500103, 1, 'IT hardware', 'Dell Latitude laptop', 'Laptop 14"', 'pcs', 2, 7345, 14690, 'IT equipment', 'Tech Distribution FZE', '20/03/2024', 'Sharjah plant'],
    [4500104, 1, 'Travel', 'Airfare DXB-LHR', 'Air ticket', 'EA', 1, 3672.5, 3672.5, 'Travel expenses', 'Emirates', '05/05/2024', 'Sharjah plant'],
    [4500105, 1, 'Fuel', 'Diesel for generators', 'Diesel', 'L', 1000, 3.6725, 3672.5, 'Fuel', 'ENOC', '06/05/2024', 'Sharjah plant'],
    [4500106, 1, 'Construction materials', 'OPC cement 50kg bags', 'Cement', 't', 10, 367.25, 3672.5, 'Materials', 'Emirates Cement LLC', '07/05/2024', 'Sharjah plant'],
    [4500107, 1, 'Professional services', 'Consultancy fees strategy', 'Consulting', 'EA', 1, 18362.5, 18362.5, 'Consulting', 'Advisory Partners', '08/05/2024', 'Mars base'],
    [4500108, 1, 'Office supplies', 'A4 paper (credit note)', 'Copier paper 80gsm', 'box', -5, 73.45, '(367.25)', 'Office expenses', 'Gulf Stationery LLC', '09/05/2024', 'Sharjah plant'],
    [4500109, 1, 'Software', 'Microsoft 365 licence EUR', 'Licence', 'EA', 1, 920, 'EUR 920', 'IT', 'Microsoft Ireland', '10/06/2024', 'Sharjah plant'],
  ];
  rows.forEach((r) => ws.addRow(r));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const up = await raw('/api/purchases/upload', buf, tenantA, { 'x-filename': 'ERP H2 2024.xlsx' });
  assert.equal(up.statusCode, 200, up.body);
  const u = up.json();
  const sh = u.sheets[0];
  assert.equal(sh.headerRow, 2);
  assert.equal(sh.guess.amount, 'Purchase Order Line Amount');
  assert.deepEqual(sh.guess.description, ['Description', 'Item Name']);
  assert.deepEqual([sh.guess.date, sh.guess.supplier, sh.guess.facility, sh.guess.category, sh.guess.gl, sh.guess.quantity, sh.guess.unit],
    ['Order Date', 'Supplier', 'Site', 'Category Name', 'Account Description', 'Qty', 'UOM Name']);
  const setup = await api('POST', `/api/purchases/batches/${u.batchId}/setup`, { headerRow: 2, columns: { ...sh.guess, description: 'Description' }, dateFormat: 'dmy', currency: 'AED', headers: sh.headers }, tenantA);
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  await drain();
  const d = (await api('GET', `/api/purchases/batches/${u.batchId}`, undefined, tenantA)).body;
  assert.equal(d.batch.status, 'review', JSON.stringify(d.batch));
  const count = (s: string) => d.counts.find((x: { status: string }) => x.status === s)?.lines ?? 0;
  assert.equal(count('problem'), 1, JSON.stringify(d.problems)); // Mars base (EUR uses the shared Federal Reserve rate)
  assert.equal(count('flagged'), 0);  // airfare moved and diesel excluded by default…
  assert.ok(count('check') > 0);      // …but large groups wait for a person to confirm
  assert.equal(count('excluded'), 1);
  assert.ok(d.problems.some((p: { problem: string }) => p.problem === 'Facility "Mars base" not found'));
  assert.ok(!d.problems.some((p: { problem: string }) => /No exchange rate/.test(p.problem)));
  const eur0 = (await api('GET', `/api/purchases/batches/${u.batchId}/lines?limit=100`, undefined, tenantA)).body.lines.find((l: { row_no: number }) => l.row_no === 9);
  assert.ok(Math.abs(eur0.fx - 1 / 1.0763) < 1e-6, String(eur0.fx)); // June 2024 Federal Reserve monthly average
  // suppliers: two spellings of Gulf Stationery are one supplier
  assert.equal(Number((await pq(`SELECT count(*) FROM supplier WHERE tenant_id = $1 AND norm = 'gulf stationery'`, [tenantA])).rows[0].count), 1);

  const groups = (await api('GET', `/api/purchases/batches/${u.batchId}/groups?limit=50`, undefined, tenantA)).body.groups as { key: string; description: string; item_id: number; naics: string; lines: number; overlap: string; map_method: string; confidence: number }[];
  const g = (d0: string) => groups.find((x) => x.description.startsWith(d0))!;
  assert.equal(g('A4 paper').lines, 2); // same description, different PO numbers and dates → one group
  assert.equal(g('A4 paper').naics, '322230');
  assert.equal(g('OPC cement').naics, '327310');
  assert.equal(g('Airfare').overlap, 'business_travel');
  assert.equal(g('Diesel').overlap, 'fuel');
  assert.deepEqual([(g('Airfare') as unknown as { decision: string; target: string }).decision, (g('Airfare') as unknown as { target: string }).target], ['move', 'business_travel']);
  assert.equal((g('Diesel') as unknown as { decision: string }).decision, 'exclude');
  assert.equal(g('Dell').naics, '334111');
  // the paper line: AED 3,672.50 at the peg = USD 1,000 of 2024 → 2022 dollars × the EPA factor
  const lines = (await api('GET', `/api/purchases/batches/${u.batchId}/lines?limit=100`, undefined, tenantA)).body.lines as { id: string; row_no: number; co2e: number; status: string; method: string; amount: number }[];
  const paper = lines.find((l) => l.row_no === 1)!;
  assert.ok(Math.abs(paper.co2e - 1000 * CPI_24_22 * await usdFactor(g('A4 paper').item_id)) < 1e-6, String(paper.co2e));
  const credit = lines.find((l) => l.row_no === 8)!;
  assert.ok(Math.abs(credit.amount + 367.25) < 1e-9 && credit.co2e < 0);
  const steps = (await api('GET', `/api/purchases/lines/${paper.id}`, undefined, tenantA)).body;
  assert.match(steps.steps[0], /AED 3,672.5 ÷ 3.6725 AED\/USD \(peg\) = USD 1,000/);
  assert.match(steps.steps[1], /CPI 2022 \/ CPI 2024/);

  // decisions: airfare → business travel; diesel → excluded (already in Scope 1); remember both
  assert.equal((await api('PATCH', `/api/purchases/batches/${u.batchId}/groups`, { keys: [g('Airfare').key], decision: 'move', target: 'business_travel' }, tenantA)).status, 200);
  assert.equal((await api('PATCH', `/api/purchases/batches/${u.batchId}/groups`, { keys: [g('Diesel').key], decision: 'exclude' }, tenantA)).status, 200);
  // a facility written differently in the file
  assert.equal((await api('POST', `/api/purchases/batches/${u.batchId}/facilities`, { value: 'Mars base', facilityId: facA }, tenantA)).body.lines, 1);
  // the company's own EUR rate for June 2024 wins over the shared one → recalculate
  assert.equal((await api('POST', '/api/currency/rates', { rows: [{ currency: 'EUR', kind: 'month', period: '2024-06', perUsd: 0.92, source: 'ECB monthly average' }] }, tenantA)).status, 200);
  // the cement supplier's own factor, per tonne
  const cementSup = (await pq(`SELECT id FROM supplier WHERE tenant_id = $1 AND norm = 'emirates cement'`, [tenantA])).rows[0].id;
  const sf = await api('POST', `/api/suppliers/${cementSup}/factors`, { co2e: 650, unit: 't', source: 'EPD 2023 (cradle to gate)' }, tenantA);
  assert.equal(sf.status, 200, JSON.stringify(sf.body));
  assert.equal(sf.body.linesRecalculated, 1);
  // a person confirms the rest as it is
  assert.equal((await api('PATCH', `/api/purchases/batches/${u.batchId}/groups`, { keys: groups.map((x) => x.key), confirm: true }, tenantA)).status, 200);
  assert.equal((await api('POST', `/api/purchases/batches/${u.batchId}/recalculate`, {}, tenantA)).status, 200);
  await drain();
  const d2 = (await api('GET', `/api/purchases/batches/${u.batchId}`, undefined, tenantA)).body;
  const c2 = (s: string) => d2.counts.find((x: { status: string }) => x.status === s)?.lines ?? 0;
  assert.deepEqual([c2('ready'), c2('excluded'), c2('problem'), c2('flagged'), c2('check')], [8, 1, 0, 0, 0], JSON.stringify(d2.counts));
  const l2 = (await api('GET', `/api/purchases/batches/${u.batchId}/lines?limit=100`, undefined, tenantA)).body.lines as { row_no: number; co2e: number; method: string; fx: number }[];
  assert.deepEqual([l2.find((l) => l.row_no === 6)!.method, l2.find((l) => l.row_no === 6)!.co2e], ['supplier', 6500]);
  const eur = l2.find((l) => l.row_no === 9)!;
  assert.ok(Math.abs(eur.co2e - (920 / 0.92) * CPI_24_22 * await usdFactor(g('Microsoft').item_id)) < 1e-6 && eur.fx === 0.92);

  // publish → entries per facility × month × category × spend category × method
  const pub = await api('POST', `/api/purchases/batches/${u.batchId}/publish`, {}, tenantA);
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  await drain();
  const acts = (await pq(
    `SELECT c.code, a.co2e_scope3::float8 AS co2e, a.unit, a.quantity::float8 AS q, a.inputs FROM activity a JOIN category c ON c.id = a.category_id WHERE a.purchase_batch_id = $1`, [u.batchId])).rows;
  const sumLines = Number((await pq(`SELECT sum(co2e) FROM purchase_line WHERE batch_id = $1 AND status = 'published'`, [u.batchId])).rows[0].sum);
  assert.ok(Math.abs(acts.reduce((s, a) => s + a.co2e, 0) - sumLines) < 1e-6);
  assert.ok(acts.some((a) => a.code === 'business_travel'));
  assert.ok(acts.some((a) => a.code === 'purchased_goods' && a.unit === 't' && a.q === 10));
  const paperMarch = acts.find((a) => a.inputs.spend?.AED === 3672.5 && a.code === 'purchased_goods' && a.unit === 'USD');
  assert.ok(paperMarch, JSON.stringify(acts.map((a) => a.inputs)));
  // published lines cannot change until the batch is reopened
  assert.equal((await api('PATCH', `/api/purchases/batches/${u.batchId}/groups`, { keys: [g('A4 paper').key], itemId: await itemId('epa:naics:322121') }, tenantA)).status, 409);
  const re = await api('POST', `/api/purchases/batches/${u.batchId}/reopen`, {}, tenantA);
  assert.equal(re.body.removed, acts.length);
  assert.equal(Number((await pq(`SELECT count(*) FROM activity WHERE purchase_batch_id = $1`, [u.batchId])).rows[0].count), 0);

  // the same file again: refused; on purpose → every line is a duplicate, and remembered decisions apply
  assert.equal((await raw('/api/purchases/upload', buf, tenantA, { 'x-filename': 'ERP H2 2024.xlsx' })).statusCode, 409);
  const again = (await raw('/api/purchases/upload?again=1', buf, tenantA, { 'x-filename': 'ERP H2 2024 (2).xlsx' })).json();
  const profile = again.sheets[0].profile;
  assert.ok(profile, 'layout remembered');
  await api('POST', `/api/purchases/batches/${again.batchId}/setup`, { ...profile.settings, columns: profile.settings.columns, headers: again.sheets[0].headers }, tenantA);
  await drain();
  const d3 = (await api('GET', `/api/purchases/batches/${again.batchId}`, undefined, tenantA)).body;
  assert.ok(d3.problems.some((p: { problem: string; lines: number }) => p.problem === 'Duplicate of a line uploaded earlier' && p.lines === 9), JSON.stringify(d3.problems));
  const g3 = (await api('GET', `/api/purchases/batches/${again.batchId}/groups?filter=moved`, undefined, tenantA)).body.groups;
  assert.equal(g3[0]?.description.startsWith('Airfare'), true);
  assert.equal((await api('DELETE', `/api/purchases/batches/${again.batchId}`, undefined, tenantA)).status, 200);

  // the other company sees nothing
  assert.equal((await api('GET', '/api/purchases/batches', undefined, tenantB)).body.batches.length, 0);
  assert.equal((await api('GET', `/api/purchases/batches/${u.batchId}`, undefined, tenantB)).status, 404);
  assert.equal((await api('GET', '/api/suppliers', undefined, tenantB)).body.total, 0);
});

test('purchases: manual entry (check, then save) and ERP API (several calls, then complete)', async () => {
  const laptop = await itemId('epa:naics:334111');
  const lines = [{ date: '2024-03-01', description: 'Laptops for new joiners', itemId: laptop, amount: 7345, currency: 'AED', supplier: 'Tech Distribution FZE' },
    { date: '2024-03-02', description: 'Excavator', itemId: await itemId('epa:naics:333120'), amount: 367250, currency: 'AED', target: 'capital_goods' }];
  const check = await api('POST', '/api/purchases/manual', { facilityId: facA, dryRun: true, lines }, tenantA);
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.equal(check.body.saved, false);
  assert.ok(Math.abs(check.body.lines[0].co2e - 2000 * CPI_24_22 * Number((await pq(`SELECT co2e FROM factor WHERE item_id = $1 AND status = 'active'`, [laptop])).rows[0].co2e)) < 1e-6);
  assert.equal(Number((await pq(`SELECT count(*) FROM purchase_batch WHERE source = 'manual'`)).rows[0].count), 0); // nothing kept
  // company option "exchange rate only": the same line without the price index
  assert.equal((await api('PATCH', '/api/currency/settings', { priceAdjust: 'none' }, tenantA)).status, 200);
  assert.equal((await api('GET', '/api/currency', undefined, tenantA)).body.priceAdjust, 'none');
  const fxOnly = (await api('POST', '/api/purchases/manual', { facilityId: facA, dryRun: true, lines }, tenantA)).body;
  assert.ok(Math.abs(fxOnly.lines[0].co2e - check.body.lines[0].co2e / CPI_24_22) < 1e-6);
  assert.equal((await api('PATCH', '/api/currency/settings', { priceAdjust: 'cpi' }, tenantA)).status, 200);
  const save = await api('POST', '/api/purchases/manual', { facilityId: facA, lines }, tenantA);
  assert.equal(save.body.saved, true, JSON.stringify(save.body));
  const cats = (await pq(`SELECT c.code FROM activity a JOIN category c ON c.id = a.category_id WHERE a.purchase_batch_id = $1 ORDER BY 1`, [save.body.batchId])).rows.map((r) => r.code);
  assert.deepEqual(cats, ['capital_goods', 'purchased_goods']);

  // ERP: a client allowed to send purchases (a meters-only client is refused)
  const meterKey = (await api('POST', '/api/api-keys', { name: 'BMS' }, tenantA)).body.key;
  const key = await api('POST', '/api/api-keys', { name: 'SAP S/4', scopes: ['purchases'] }, tenantA);
  assert.deepEqual(key.body.scopes, ['purchases']);
  const send = (k: string, path: string, body: unknown) => app.inject({ method: 'POST', url: path, payload: body as object, headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' } });
  assert.equal((await send(meterKey, '/api/v1/purchases', { reference: 'x', lines: [] })).statusCode, 403);
  const part = (n: number, start: number) => Array.from({ length: n }, (_, i) => ({ date: '2024-04-15', description: i % 2 ? 'Office cleaning contract' : 'Security guards monthly', amount: 3672.5, supplier: `Vendor ${(start + i) % 7}`, facility: 'Sharjah plant' }));
  const r1 = await send(key.body.key, '/api/v1/purchases', { reference: 'SAP-2024-04', lines: part(600, 0) });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = await send(key.body.key, '/api/v1/purchases', { reference: 'SAP-2024-04', lines: part(400, 600), complete: true });
  assert.equal(r2.json().totalLines, 1000);
  assert.equal((await send(key.body.key, '/api/v1/purchases', { reference: 'SAP-2024-04', lines: part(1, 0) })).statusCode, 409);
  await drain();
  const st = await app.inject({ method: 'GET', url: '/api/v1/purchases/SAP-2024-04', headers: { authorization: `Bearer ${key.body.key}` } });
  assert.deepEqual([st.json().status, (st.json().lines.ready ?? 0) + (st.json().lines.check ?? 0)], ['review', 1000], st.body);
});

test('suppliers: one record however written (vendor number, spellings, typos), possible duplicates, merge / split / keep apart, profile, analytics; dashboard', async () => {
  const { similarity } = await import('../src/modules/purchases/supplierMatch.js');
  // the word-by-word comparison
  assert.equal(similarity('Gulf Stationary L.L.C.', 'Gulf Stationery LLC').auto, true);
  assert.equal(similarity('Big Four Audit LLP', 'Bigfour Audit').auto, true);
  assert.equal(similarity('Palm Plastic Industries F.Z.E.', 'PALM PLASTIC INDUSTRIES FZE').auto, true);
  assert.equal(similarity('Dammam Indutsrial Chemicals Co', 'Dammam Industrial Chemicals Co').auto, true);   // typo in a generic word
  assert.ok(similarity('Pearl Management Consultancy Co.', 'Marina Management Consultancy LLC').score < 0.88); // different brand
  assert.ok(similarity('Desert Rose Steel LLC', 'Desert Rose IT Solutions LLC').score < 0.88);
  assert.ok(similarity('Pearl Cement Products', 'Emirates Cement LLC').score < 0.88);
  assert.equal(similarity('Masafi Water Co', 'Masafi').auto, false);
  assert.ok(similarity('Masafi Water Co', 'Masafi').score >= 0.88);                                           // a person decides

  const lines = ['Date;Description;Amount;Vendor No;Vendor Name;Vendor Country;Site'];
  const add = (n: number, desc: string, amt: number, ref: string, name: string, country: string) => { for (let i = 0; i < n; i++) lines.push(`${String(1 + i).padStart(2, '0')}/0${1 + (i % 6)}/2024;${desc};${amt};${ref};${name};${country};Sharjah plant`); };
  add(6, 'Hydraulic hoses', 3672.5, 'V900', 'Falcon Hydraulics LLC', 'UAE');
  add(3, 'Hydraulic hoses', 3672.5, '', 'FALCON HYDRAULICS L.L.C.', '');
  add(2, 'Hydraulic hoses', 3672.5, '', 'Falcon Hydarulics LLC', '');          // typo → linked automatically
  add(2, 'Hydraulic hoses', 3672.5, 'V950', 'Pearl Hydraulics LLC', 'AE');     // another supplier
  add(4, 'Bottled drinking water', 367.25, 'V960', 'Masafi', 'United Arab Emirates');
  add(2, 'Bottled drinking water', 367.25, '', 'Masafi Pure Water Co', '');    // possible duplicate
  add(3, 'HDPE bags and liners', 7345, 'V970', 'Deccan Polymers Pvt Ltd', 'India');
  const up = (await raw('/api/purchases/upload', Buffer.from(lines.join('\n')), tenantA, { 'x-filename': 'suppliers.csv' })).json();
  const sh = up.sheets[0];
  assert.deepEqual([sh.guess.supplierRef, sh.guess.supplier, sh.guess.supplierCountry], ['Vendor No', 'Vendor Name', 'Vendor Country']);
  await api('POST', `/api/purchases/batches/${up.batchId}/setup`, { headerRow: sh.headerRow, columns: sh.guess, dateFormat: 'dmy', currency: 'AED', headers: sh.headers }, tenantA);
  await drain();
  const find = async (q: string) => (await api('GET', `/api/suppliers?q=${encodeURIComponent(q)}`, undefined, tenantA)).body.suppliers as { id: string; name: string; lines: number; country: string | null; reference: string | null; review: string; completeness: number }[];
  const falcon = await find('falcon');
  assert.equal(falcon.length, 1, JSON.stringify(falcon));
  assert.deepEqual([falcon[0]!.lines, falcon[0]!.country, falcon[0]!.reference], [11, 'AE', 'V900']);
  assert.equal((await find('pearl hydraulics'))[0]!.review, 'ok');
  assert.equal((await find('deccan'))[0]!.country, 'IN');
  const review = (await api('GET', '/api/suppliers/review', undefined, tenantA)).body;
  const dup = review.duplicates.find((x: { name: string }) => /masafi/i.test(x.name));
  assert.ok(dup && /masafi/i.test(dup.other_name), JSON.stringify(review.duplicates));
  const typo = review.autoLinked.find((x: { name_seen: string }) => x.name_seen === 'Falcon Hydarulics LLC');
  assert.ok(typo, JSON.stringify(review.autoLinked));
  // the profile shows every spelling and how it was linked
  const det = (await api('GET', `/api/suppliers/${falcon[0]!.id}`, undefined, tenantA)).body;
  assert.deepEqual(det.names.map((n: { method: string }) => n.method).sort(), ['new', 'similar']);   // L.L.C. spelling has the same normalised name
  // split the automatic link: its lines become a supplier of their own
  const split = await api('POST', `/api/suppliers/matches/${typo.id}/split`, {}, tenantA);
  assert.equal(split.body.lines, 2);
  assert.equal((await find('falcon')).length, 2);
  // merge the possible duplicate; the name is then known and cannot be added again
  const merged = await api('POST', `/api/suppliers/${dup.id}/merge`, { intoId: dup.other_id }, tenantA);
  assert.equal(merged.body.lines, 2);
  const masafi = await find('masafi');
  assert.deepEqual([masafi.length, masafi[0]!.lines, masafi[0]!.review], [1, 6, 'ok']);
  assert.equal((await api('POST', '/api/suppliers', { name: 'Masafi Pure Water Co' }, tenantA)).status, 409);
  // keep apart: a person decides two similar names are different suppliers
  const apart = await api('POST', `/api/suppliers/${(await find('falcon hydarulics'))[0]!.id}/keep-separate`, {}, tenantA);
  assert.equal(apart.status, 200);
  // profile: completeness rises; a vendor number already used elsewhere is refused
  const before = falcon[0]!.completeness;
  assert.equal((await api('PATCH', `/api/suppliers/${falcon[0]!.id}`, { industry: 'Hydraulic components', climateTarget: 'own', reportsEmissions: 'yes', contactEmail: 'esg@falcon.example' }, tenantA)).status, 200);
  assert.ok((await find('falcon hydraulics'))[0]!.completeness > before);
  assert.equal((await api('PATCH', `/api/suppliers/${falcon[0]!.id}`, { reference: 'V970' }, tenantA)).status, 409);
  // analytics: by country (UAE, India), by product, top suppliers, concentration
  const an = (await api('GET', '/api/suppliers/analytics?year=2024', undefined, tenantA)).body;
  const countries = an.byCountry.map((r: { country: string }) => r.country);
  assert.ok(countries.includes('AE') && countries.includes('IN'), JSON.stringify(an.byCountry));
  assert.ok(an.totals.lines > 0 && an.top.length > 0 && an.concentration.n80 >= 1);
  assert.ok(an.profiles.target >= 1);

  // dashboard: rows per facility × month × category; Scope 2 location or market, never both
  const loc = (await api('GET', '/api/dashboard?year=2024&pend=1', undefined, tenantA)).body;
  const mkt = (await api('GET', '/api/dashboard?year=2024&pend=1&scope2=market', undefined, tenantA)).body;
  const tot = (d: { rows: { s1: number; s2: number; s3: number; s33: number }[] }, k: 's1' | 's2' | 's3' | 's33') => d.rows.reduce((a, r) => a + r[k], 0);
  assert.ok(loc.rows.length > 0 && loc.years.includes(2024) && loc.facilities.length > 0);
  assert.ok(Math.abs(tot(loc, 's1') - tot(mkt, 's1')) < 1e-6 && Math.abs(tot(loc, 's3') - tot(mkt, 's3')) < 1e-6);
  const s2 = Number((await pq(`SELECT coalesce(sum(co2e_scope2), 0) / 1000 AS l, coalesce(sum(co2e_scope2_market), 0) / 1000 AS m FROM activity a JOIN org_node f ON f.id = a.facility_id
                               WHERE a.tenant_id = $1 AND extract(year FROM period_start) = 2024 AND a.status <> 'rejected' AND f.operational_control`, [tenantA])).rows[0].l);
  assert.ok(Math.abs(tot(loc, 's2') - s2) < 0.01, `${tot(loc, 's2')} vs ${s2}`);
  assert.ok(loc.purchases.suppliers >= 1 && loc.categories.some((x: { ghg: string }) => x.ghg === '3.1'));
  assert.equal((await api('GET', '/api/dashboard?year=2024', undefined, tenantB)).body.rows.every((r: { f: string }) => !loc.facilities.some((f: { id: string }) => f.id === r.f)), true);
});

test('purchases: lines with no facility written go to the facility chosen for the file, or wait for one in the review', async () => {
  const csv = 'Date;Description;Amount;Site\n05/03/2024;Office chairs;3800;Sharjah plant\n06/03/2024;Courier charges;260;\n07/03/2024;Consultancy fees;45000;\n';
  const run = async (facilityId: string | null) => {
    const up = (await raw('/api/purchases/upload?again=1', Buffer.from(csv), tenantA, { 'x-filename': 'nofac.csv' })).json();
    const sh = up.sheets[0];
    const r = await api('POST', `/api/purchases/batches/${up.batchId}/setup`, { headerRow: sh.headerRow, columns: sh.guess, dateFormat: 'dmy', currency: 'AED', facilityId, remember: false }, tenantA);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await drain();
    return up.batchId as string;
  };
  const withDefault = await run(facA);
  const lines = (await pq(`SELECT facility_id, problems FROM purchase_line WHERE batch_id = $1 ORDER BY row_no`, [withDefault])).rows;
  assert.ok(lines.every((l) => l.facility_id === facA && !l.problems.some((p: string) => p.startsWith('Facility'))), JSON.stringify(lines));
  // without one: listed as "no facility written"; choosing a facility fixes those lines and is kept for the batch
  const later = await run(null);
  const d = (await api('GET', `/api/purchases/batches/${later}`, undefined, tenantA)).body;
  const blank = d.facilitiesMissing.find((m: { value: string | null }) => !m.value);
  assert.equal(blank?.lines, 2, JSON.stringify(d.facilitiesMissing));
  assert.equal((await api('POST', `/api/purchases/batches/${later}/facilities`, { value: null, facilityId: facA }, tenantA)).body.lines, 2);
  assert.equal((await pq(`SELECT settings->>'facilityId' AS f FROM purchase_batch WHERE id = $1`, [later])).rows[0].f, facA);
});

test('purchases: decided once per kind of purchase — supplier and account defaults, account type, capital-goods list, average factor, review of the large groups only', async () => {
  const cap = (await pq(`SELECT name FROM item WHERE code LIKE 'old:%' AND (attrs->>'capital')::boolean AND name ILIKE '%machinery%' AND name ~ '^[A-Za-z ,-]+$' ORDER BY length(name) LIMIT 1`)).rows[0].name as string;
  const L = ['Date;Description;Amount;Vendor Name;Account;Site'];
  const add = (n: number, d: string, amt: number, v: string, gl: string) => { for (let i = 0; i < n; i++) L.push(`${String(1 + i).padStart(2, '0')}/0${1 + (i % 6)}/2024;${d};${amt};${v};${gl};Sharjah plant`); };
  add(6, 'Monthly charges', 73450, 'Shield Guarding LLC', 'Facility management');     // says nothing: big → must be confirmed
  add(2, 'Service fee Q2', 36725, 'Shield Guarding LLC', 'Facility management');
  add(2, 'VAT input', 9000, 'Federal Tax Authority', 'VAT receivable');                // not a purchase
  add(1, 'Equipment purchase', 1836250, 'Heavy Kit Trading', 'Capital WIP');           // capital account
  add(1, cap, 367250, 'Machines LLC', 'Plant & machinery');                             // on the capital-goods list
  add(3, 'Xqz wvk', 120, 'Corner Shop', 'Zzk');                                // small and unclear → average factor
  const up = (await raw('/api/purchases/upload', Buffer.from(L.join('\n')), tenantA, { 'x-filename': 'logic.csv' })).json();
  const sh = up.sheets[0];
  await api('POST', `/api/purchases/batches/${up.batchId}/setup`, { headerRow: sh.headerRow, columns: { ...sh.guess, gl: 'Account' }, dateFormat: 'dmy', currency: 'AED', headers: sh.headers, remember: false }, tenantA);
  await drain();
  type G = { key: string; description: string; item_id: number; item_name: string; map_method: string; decision: string; capital: boolean; capital_why: string; material: boolean; confirmed: boolean; statuses: Record<string, number> };
  const groups = async () => (await api('GET', `/api/purchases/batches/${up.batchId}/groups?limit=50`, undefined, tenantA)).body.groups as G[];
  let gs = await groups();
  const g = (d: string) => gs.find((x) => x.description.startsWith(d))!;
  assert.equal(g('Xqz').map_method, 'fallback');
  assert.match(g('Xqz').item_name, /average factor/);
  assert.equal(g(cap).capital, true, JSON.stringify(g(cap)));
  assert.equal(g(cap).capital_why, 'on the capital-goods list');
  // the large unclear group waits for a person; the small one is accepted as it is
  assert.equal(g('Monthly charges').material && !g('Monthly charges').confirmed, true);
  assert.ok((g('Monthly charges').statuses.check ?? 0) === 6, JSON.stringify(g('Monthly charges').statuses));
  assert.equal(g('Xqz').statuses.ready, 3);
  // accounts: VAT is not a purchase; Capital WIP is a capital account (remembered for every upload)
  assert.equal((await api('PUT', '/api/purchases/accounts', { account: 'VAT receivable', accountType: 'not_purchase', batchId: up.batchId }, tenantA)).status, 200);
  assert.equal((await api('PUT', '/api/purchases/accounts', { account: 'Capital WIP', accountType: 'capital', batchId: up.batchId }, tenantA)).status, 200);
  const acc = (await api('GET', `/api/purchases/batches/${up.batchId}/accounts`, undefined, tenantA)).body.accounts as { account: string; accountType: string }[];
  assert.equal(acc.find((a) => a.account === 'VAT receivable')?.accountType, 'not_purchase');
  gs = await groups();
  assert.equal(g('VAT').decision, 'exclude');
  assert.equal(g('VAT').statuses.excluded, 2);
  assert.deepEqual([g('Equipment').capital, g('Equipment').capital_why], [true, 'account “Capital WIP” is a capital account']);
  // the supplier's default: "Monthly charges" from a guarding company are security services — for all its unclear purchases
  const security = await itemId('epa:naics:561612');
  const r = await api('PATCH', `/api/purchases/batches/${up.batchId}/groups`, { keys: [g('Monthly charges').key], itemId: security, scope: 'supplier' }, tenantA);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  gs = await groups();
  assert.deepEqual([g('Monthly charges').map_method, g('Monthly charges').confirmed], ['manual', true]);
  assert.deepEqual([g('Service fee').item_id, g('Service fee').map_method], [security, 'supplier']);
  assert.equal(g('Monthly charges').statuses.ready, 6);
  // the supplier profile shows the default
  const sup = (await pq(`SELECT id FROM supplier WHERE tenant_id = $1 AND norm = 'shield guarding'`, [tenantA])).rows[0].id;
  assert.equal((await api('GET', `/api/suppliers/${sup}`, undefined, tenantA)).body.defaultItem?.id, security);
  // batch summary: how much of the emissions is confirmed
  const d = (await api('GET', `/api/purchases/batches/${up.batchId}`, undefined, tenantA)).body;
  assert.ok(d.groups.coverage === 0.95 && d.groups.material >= 1 && d.groups.co2e > 0, JSON.stringify(d.groups));
  assert.equal((await api('DELETE', `/api/purchases/batches/${up.batchId}`, undefined, tenantA)).status, 200);
});

test('purchases: 50,000 lines (CSV) read, mapped, calculated and published in the background within a minute', async () => {
  const descs = ['A4 paper', 'Laptop', 'Office cleaning', 'Consultancy fees', 'Ready mix concrete', 'Security guards', 'Hotel stay Riyadh', 'Courier DHL', 'Software licence', 'Catering'];
  const lines = ['Date;Description;Amount;Supplier;Site'];
  for (let i = 0; i < 50_000; i++) lines.push(`${String(1 + (i % 28)).padStart(2, '0')}/${String(1 + (i % 12)).padStart(2, '0')}/2025;${descs[i % 10]} ${i % 500};"${(100 + (i % 997)).toLocaleString('de-DE')},50";Vendor ${i % 300};Sharjah plant`);
  const buf = Buffer.from(lines.join('\r\n'), 'utf8');
  const t0 = Date.now();
  const up = (await raw('/api/purchases/upload', buf, tenantA, { 'x-filename': 'big.csv' })).json();
  const sh = up.sheets[0];
  assert.deepEqual([sh.guess.description, sh.guess.amount, sh.guess.date, sh.guess.facility], ['Description', 'Amount', 'Date', 'Site']);
  await api('POST', `/api/purchases/batches/${up.batchId}/setup`, { headerRow: sh.headerRow, columns: sh.guess, dateFormat: 'dmy', currency: 'AED', headers: sh.headers }, tenantA);
  await drain();
  const t1 = Date.now();
  const d = (await api('GET', `/api/purchases/batches/${up.batchId}`, undefined, tenantA)).body;
  const total = d.counts.reduce((s: number, x: { lines: number }) => s + x.lines, 0);
  assert.equal(total, 50_000);
  assert.ok(d.groups.total <= 5000, `groups ${d.groups.total}`);
  // European decimals read correctly: "1.096,50" → 1096.5
  const amt = Number((await pq(`SELECT amount FROM purchase_line WHERE batch_id = $1 AND row_no = 997`, [up.batchId])).rows[0].amount);
  assert.equal(amt, 1096.5);
  // decide the flagged groups (hotels → business travel, courier → upstream transport) in bulk, then publish
  const flagged = (await api('GET', `/api/purchases/batches/${up.batchId}/groups?filter=flagged&limit=200`, undefined, tenantA)).body.groups as { key: string; overlap: string }[];
  for (const target of ['business_travel', 'upstream_transport']) {
    const keys = flagged.filter((x) => x.overlap === target).map((x) => x.key);
    if (keys.length) assert.equal((await api('PATCH', `/api/purchases/batches/${up.batchId}/groups`, { keys, decision: 'move', target, remember: false }, tenantA)).status, 200);
  }
  // the large groups waiting for a person: confirmed in bulk
  const toConfirm = (await api('GET', `/api/purchases/batches/${up.batchId}/groups?filter=check&limit=200`, undefined, tenantA)).body.groups.map((x: { key: string }) => x.key);
  if (toConfirm.length) assert.equal((await api('PATCH', `/api/purchases/batches/${up.batchId}/groups`, { keys: toConfirm, confirm: true }, tenantA)).status, 200);
  await drain();
  const ready = (await api('GET', `/api/purchases/batches/${up.batchId}`, undefined, tenantA)).body.counts.find((x: { status: string }) => x.status === 'ready').lines;
  await api('POST', `/api/purchases/batches/${up.batchId}/publish`, {}, tenantA);
  await drain();
  const t2 = Date.now();
  const pubLines = Number((await pq(`SELECT count(*) FROM purchase_line WHERE batch_id = $1 AND status = 'published'`, [up.batchId])).rows[0].count);
  assert.equal(pubLines, ready);
  const entries = Number((await pq(`SELECT count(*) FROM activity WHERE purchase_batch_id = $1`, [up.batchId])).rows[0].count);
  console.log(`[perf] 50,000 lines: read+map+calculate ${((t1 - t0) / 1000).toFixed(1)} s, publish ${((t2 - t1) / 1000).toFixed(1)} s; ${d.groups.total} groups, ${pubLines} lines → ${entries} entries`);
  assert.ok(t2 - t0 < 60_000, `took ${t2 - t0} ms`);
  // the published lines stay viewable: paged, totalled, opened from one entry, downloaded
  let t3 = Date.now();
  const pl = (await api('GET', `/api/purchases/published?batch=${up.batchId}&limit=100`, undefined, tenantA)).body;
  const tq = Date.now() - t3;
  assert.equal(pl.total.lines, pubLines); assert.equal(pl.lines.length, 100); assert.equal(pl.total.entries, entries);
  assert.ok(pl.lines[0].co2e >= pl.lines[99].co2e, 'largest first');
  const one = pl.lines[0].activity_id;
  const inEntry = (await api('GET', `/api/purchases/published?activity=${one}`, undefined, tenantA)).body;
  assert.ok(inEntry.total.lines >= 1 && inEntry.lines.every((l: { activity_id: string }) => l.activity_id === one));
  t3 = Date.now();
  const csv = await app.inject({ method: 'GET', url: `/api/purchases/published/export?batch=${up.batchId}&format=csv`, headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(csv.body.split('\r\n').length, pubLines + 1);
  const xl = await app.inject({ method: 'GET', url: `/api/purchases/published/export?batch=${up.batchId}`, headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(xl.statusCode, 200); assert.ok(xl.rawPayload.length > 100_000);
  console.log(`[perf] published lines: first page ${tq} ms; CSV + Excel of ${pubLines} lines ${Date.now() - t3} ms`);
  assert.equal((await api('GET', `/api/purchases/published?batch=${up.batchId}`, undefined, tenantB)).body.total.lines, 0, 'other company sees none');
});

test('employee commuting: once a year per facility — typed in or survey scaled up; monthly entries by working days; locked once approved', async () => {
  const groupOf = async (tt: string) => (await api('GET', '/api/org', undefined, tt)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const fac = (await api('POST', '/api/org/nodes', { parentId: await groupOf(tenantA), kind: 'facility', name: 'Commute office' }, tenantA)).body.id as string;
  const opt = (await api('GET', '/api/commuting/options?year=2025', undefined, tenantA)).body;
  assert.ok(opt.items.some((i: { code: string }) => i.code === 'commute:car:average-car:petrol') && opt.defaults.sat_sun.weekdays === 261);
  // typed in
  const typed = { facilityId: fac, year: 2025, method: 'typed', headcount: 30, workingDays: 220, weekend: 'sat_sun',
    rows: [{ mode: 'car', fuel: 'petrol', employees: 20, oneWayKm: 15, daysPerWeek: 5 }, { mode: 'metro', employees: 10, oneWayKm: 12, daysPerWeek: 4 }] };
  const pv = await api('POST', '/api/commuting/preview', typed, tenantA);
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const car = pv.body.lines.find((l: { item: string }) => l.item === 'commute:car:average-car:petrol');
  assert.equal(car.quantity, 20 * 2 * 15 * 220);
  const f = (await pq(`SELECT sum(f.co2e)::float8 AS k FROM factor f JOIN factor_source s ON s.id = f.source_id JOIN item i ON i.id = f.item_id
                        WHERE i.code = 'commute:car:average-car:petrol' AND s.code = 'DESNZ-2025' AND f.status = 'active' AND f.unit = 'km'`)).rows[0].k;
  assert.ok(Math.abs(car.kg - car.quantity * f) / car.kg < 1e-3, `${car.kg} vs ${car.quantity * f} (well-to-tank counted in 3.7)`);
  const saved = await api('PUT', '/api/commuting', typed, tenantA);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.entries, 24);
  const acts = (await pq(`SELECT a.period_start::text AS p, a.quantity::float8 AS q, a.co2e_scope3::float8 AS s3, a.co2e_wtt::float8 AS wtt, i.code FROM activity a JOIN item i ON i.id = a.item_id
                           WHERE a.commute_record_id = $1 ORDER BY 1`, [saved.body.id])).rows;
  const carActs = acts.filter((a) => a.code === 'commute:car:average-car:petrol');
  assert.ok(Math.abs(carActs.reduce((x, a) => x + a.q, 0) - car.quantity) < 0.01, 'months add up to the year');
  assert.ok(acts.every((a) => a.wtt === 0 && a.s3 > 0));
  const feb = carActs.find((a) => a.p === '2025-02-01')!.q, mar = carActs.find((a) => a.p === '2025-03-01')!.q;
  assert.ok(Math.abs(feb / mar - 20 / 21) < 1e-3, 'split by working days (Feb 2025: 20, Mar 2025: 21)');
  // once a year: saving again replaces, it does not add
  const again = await api('PUT', '/api/commuting', { ...typed, rows: [{ mode: 'car', fuel: 'diesel', employees: 30, oneWayKm: 10 }] }, tenantA);
  assert.equal(again.body.entries, 12);
  assert.equal(Number((await pq('SELECT count(*) FROM activity WHERE facility_id = $1', [fac])).rows[0].count), 12);
  // survey file: columns recognised, other sites left out, unknown answers listed, scaled to the headcount
  const csv = ['Timestamp,Site,How do you usually travel to work?,One-way distance (km),Days in the office per week,People in the car,Car fuel',
    '1,Commute office,Drive my car,20,5,1,Diesel', '2,Commute office,Dubai Metro,15,5,,', '3,Commute office,Work from home,,0,,', '4,Commute office,Hovercraft,5,5,,', '5,Other site,Car,50,5,1,Petrol'].join('\n');
  const sv = await raw(`/api/commuting/survey?facilityId=${fac}`, Buffer.from(csv), tenantA, { 'x-filename': 'answers.csv' });
  assert.equal(sv.statusCode, 200, sv.body);
  const s = sv.json();
  assert.equal(s.answers.length, 3); assert.equal(s.otherSite, 1); assert.equal(s.unrecognised[0].value, 'Hovercraft');
  assert.equal(s.columns.mode, 'How do you usually travel to work?'); assert.equal(s.answers[0].fuel, 'diesel');
  const survey = { facilityId: fac, year: 2025, method: 'survey', headcount: 30, workingDays: 220, weekend: 'sat_sun', answers: s.answers, survey: { file: 'answers.csv', columns: s.columns } };
  const sp = (await api('POST', '/api/commuting/preview', survey, tenantA)).body;
  assert.equal(sp.scale, 10); assert.equal(sp.lines.find((l: { item: string }) => l.item === 'commute:car:average-car:diesel').quantity, 2 * 20 * 220 * 10);
  const ss = await api('PUT', '/api/commuting', survey, tenantA);
  assert.equal(ss.status, 200, JSON.stringify(ss.body));
  const rec = (await api('GET', `/api/commuting/record?facilityId=${fac}&year=2025`, undefined, tenantA)).body;
  assert.equal(rec.record.method, 'survey'); assert.equal(rec.answers.length, 3); assert.equal(rec.months.length, 12);
  // dashboards: Scope 3.7 in the rows; not counted as "data in" for completeness
  const d = (await api('GET', `/api/dashboard?year=2025&node=${fac}&pend=1`, undefined, tenantA)).body;
  assert.ok(d.rows.some((r: { cat: string; s3: number }) => r.cat === 'employee_commuting' && r.s3 > 0));
  assert.equal(d.filled.length, 0);
  // locked once an entry is approved
  await pq(`UPDATE activity SET status = 'approved' WHERE id = (SELECT id FROM activity WHERE commute_record_id = $1 LIMIT 1)`, [ss.body.id]);
  assert.equal((await api('PUT', '/api/commuting', survey, tenantA)).status, 409);
  assert.equal((await api('DELETE', `/api/commuting/${ss.body.id}`, undefined, tenantA)).status, 409);
  await pq(`UPDATE activity SET status = 'draft' WHERE commute_record_id = $1`, [ss.body.id]);
  assert.equal((await api('DELETE', `/api/commuting/${ss.body.id}`, undefined, tenantA)).body.entries, 24);
  assert.equal(Number((await pq('SELECT count(*) FROM activity WHERE facility_id = $1', [fac])).rows[0].count), 0);
  const tpl = await app.inject({ method: 'GET', url: '/api/commuting/survey-template', headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(tpl.statusCode, 200); assert.ok(tpl.rawPayload.length > 4000);
  // another company cannot see it
  assert.equal((await api('GET', `/api/commuting/record?facilityId=${fac}&year=2025`, undefined, tenantB)).status, 404);
});

test('water: in by source, reused, out by destination; DESNZ or the utility\'s factor; water bills from a combined DEWA/SEWA bill; dashboard balance. Waste details (hazardous, contractor) for GRI 306', async () => {
  const id = async (code: string) => (await pq('SELECT id FROM item WHERE code = $1', [code])).rows[0].id as number;
  const p = { facilityId: facA, periodStart: '2026-02-01', periodEnd: '2026-02-28', dataType: 'actual' };
  const entries = [
    { ...p, itemId: await id('water:mains_desal'), unit: 'm3', quantity: 1000 },
    { ...p, itemId: await id('water:mains_desal'), unit: 'kgal_uk', quantity: 10, water: { ownFactor: 1.2, source: 'utility report' } },
    { ...p, itemId: await id('water:groundwater'), unit: 'm3', quantity: 500 },
    { ...p, itemId: await id('water:reuse'), unit: 'm3', quantity: 200 },
    { ...p, itemId: await id('water:sewer'), unit: 'ML', quantity: 0.8 },
    { ...p, itemId: await id('waste3:refuse:commercial-and-industrial-waste:landfill'), unit: 't', quantity: 4, wasteInfo: { hazardous: false, contractor: 'Collector A', ref: 'M-1' } },
    { ...p, itemId: await id('waste3:electrical-items:weee-mixed:open_loop'), unit: 't', quantity: 1.5, wasteInfo: { hazardous: true, contractor: 'E-waste B' } },
  ];
  const b = await api('POST', '/api/activities/batch', { entries, dryRun: false }, tenantA);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.ok(b.body.results.every((r: { ok: boolean }) => r.ok), JSON.stringify(b.body.results));
  const [desal, own, well, reuse, sewer] = b.body.results.map((r: { totals: { scope3: number; wtt: number } }) => r.totals);
  const sup = Number((await pq(`SELECT f.co2e FROM factor f JOIN factor_source s ON s.id = f.source_id WHERE f.item_id = $1 AND s.code = 'DESNZ-2026' AND f.status = 'active'`, [await id('water:mains_desal')])).rows[0].co2e);
  const trt = Number((await pq(`SELECT f.co2e FROM factor f JOIN factor_source s ON s.id = f.source_id WHERE f.item_id = $1 AND s.code = 'DESNZ-2026' AND f.status = 'active'`, [await id('water:sewer')])).rows[0].co2e);
  assert.ok(Math.abs(desal.scope3 - 1000 * sup) < 1e-6);
  assert.ok(Math.abs(own.scope3 - 10 * 4.54609 * 1.2) < 1e-6, 'own factor per m³, 000 IG converted');
  assert.equal(well.scope3, 0); assert.equal(reuse.scope3, 0);
  assert.ok(Math.abs(sewer.scope3 - 800 * trt) < 1e-6, 'megalitres converted');
  assert.ok(b.body.results[0].warnings.some((w: string) => /desalinated/.test(w)));
  // dashboard: m³, flow and GRI source; waste hazardous and contractor
  const d = (await api('GET', `/api/dashboard?year=2026&node=${facA}&pend=1`, undefined, tenantA)).body;
  const w = d.rows.filter((r: { cat: string }) => r.cat.startsWith('water_'));
  const s = (flow: string) => w.filter((r: { flow: string }) => r.flow === flow).reduce((a: number, r: { m3: number }) => a + r.m3, 0);
  assert.ok(Math.abs(s('withdrawal') - (1000 + 45.4609 + 500)) < 1e-6 && Math.abs(s('discharge') - 800) < 1e-6 && Math.abs(s('reuse') - 200) < 1e-6, JSON.stringify(w));
  assert.ok(w.some((r: { gri: string }) => r.gri === 'groundwater'));
  const ws = d.rows.filter((r: { cat: string }) => r.cat === 'waste_generated');
  assert.ok(ws.some((r: { haz: boolean; contractor: string }) => r.haz === true && r.contractor === 'E-waste B') && ws.some((r: { haz: boolean; route: string }) => r.haz === false && r.route === 'landfill'));
  assert.deepEqual((await api('GET', '/api/waste/contractors', undefined, tenantA)).body.contractors.sort(), ['Collector A', 'E-waste B']);
  // water bill: the combined SEWA bill uploaded for water is a second bill (not a duplicate), read in imperial gallons, matched to the water meter of the same account
  const { makePdf, SAMPLE_ELECTRICITY } = await import('./helpers/pdf.js');
  const pdf = Buffer.from(await makePdf(SAMPLE_ELECTRICITY.map((l) => (Array.isArray(l) && l[0] === 'Bill No:' ? ['Bill No:', 'INV-W-1'] as [string, string] : l))));
  const wm = await api('POST', '/api/meters', { facilityId: facA, name: 'SEWA water', readingType: 'interval', frequency: 'month', unit: 'gal_uk', itemId: await id('water:mains_desal'), template: {}, accountNo: '2001458876' }, tenantA);
  assert.equal(wm.status, 200, JSON.stringify(wm.body));
  const up = (cat?: string) => app.inject({ method: 'POST', url: '/api/bills/upload', payload: pdf, headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream', 'x-filename': 'sewa-w.pdf', ...(cat ? { 'x-category': cat } : {}) } });
  const el = (await up('purchased_electricity')).json(), wa = (await up('water')).json();
  assert.notEqual(el.id, wa.id); assert.equal(wa.duplicate, false);
  assert.equal(wa.category, 'water_supply'); assert.equal(Number(wa.quantity), 1250); assert.equal(wa.unit, 'gal_uk'); assert.equal(wa.meter_id, wm.body.id);
  assert.notEqual(el.meter_id, wm.body.id);
  assert.equal((await up('water')).json().duplicate, true);
  const ok = await api('POST', `/api/bills/${wa.id}/confirm`, {}, tenantA);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const ent = (await api('GET', `/api/bills/${wa.id}`, undefined, tenantA)).body.entries;
  assert.ok(ent.length >= 1, JSON.stringify(ent));
  const s3 = (await pq(`SELECT a.co2e_scope3::float8 AS s3, c.code FROM activity a JOIN category c ON c.id = a.category_id WHERE a.id = ANY($1)`, [ent.map((e: { id: string }) => e.id)])).rows;
  assert.ok(s3.every((r) => r.s3 > 0 && r.code === 'water_supply'), JSON.stringify(s3));
  assert.equal((await api('GET', '/api/bills?category=water', undefined, tenantA)).body.bills.length, 1);
});

test('surveys: people with personal codes answer without signing in; results scaled to the headcount per facility with a 95% range; publishing writes Scope 3.7 commuting (once a year per facility)', async () => {
  const groupOf = async (tt: string) => (await api('GET', '/api/org', undefined, tt)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const g = await groupOf(tenantA);
  const f1 = (await api('POST', '/api/org/nodes', { parentId: g, kind: 'facility', name: 'Survey HQ', employees: 100 }, tenantA)).body.id as string;
  const f2 = (await api('POST', '/api/org/nodes', { parentId: g, kind: 'facility', name: 'Survey Depot', employees: 40 }, tenantA)).body.id as string;
  const cr = await api('POST', '/api/surveys', { name: 'Commuting 2025', year: 2025, closeAt: '2025-12-15', weeks: 46, facilityIds: [f1, f2], wfh: true }, tenantA);
  assert.equal(cr.status, 200, JSON.stringify(cr.body));
  const id = cr.body.id as string;
  assert.equal((await api('POST', `/api/surveys/${id}/status`, { status: 'open' }, tenantA)).status, 400, 'needs people first');
  const ppl = await api('POST', `/api/surveys/${id}/participants`, { text: 'name, email, facility, department\nAisha Khan, aisha@x.ae, Survey HQ, Finance\nOmar Ali, omar@x.ae, survey hq, Ops\nSara Noor, sara@x.ae, Depot, Ops\nBad Mail, nope, Survey HQ,\nAisha again, AISHA@x.ae, Survey HQ,' }, tenantA);
  assert.equal(ppl.status, 200, JSON.stringify(ppl.body));
  assert.equal(ppl.body.added, 3); assert.equal(ppl.body.skipped, 1); assert.equal(ppl.body.problems.length, 1);
  let d = (await api('GET', `/api/surveys/${id}`, undefined, tenantA)).body;
  const by = (n: string) => d.people.find((p: { name: string }) => p.name === n);
  assert.match(by('Aisha Khan').code, /^[A-HJ-NP-Z2-9]{8}$/); assert.equal(by('Sara Noor').facility_id, f2);
  // public: closed while draft, then answered with the code (lowercase and spaced is fine)
  const pub = (method: string, url: string, payload: object, ip = '10.0.0.1') => app.inject({ method: method as 'POST', url, payload, remoteAddress: ip }).then((r) => ({ status: r.statusCode, body: r.json() }));
  assert.equal((await pub('POST', '/api/public/survey/lookup', { code: by('Aisha Khan').code })).status, 409);
  assert.equal((await api('POST', `/api/surveys/${id}/status`, { status: 'open' }, tenantA)).status, 200);
  const spaced = by('Aisha Khan').code.toLowerCase().replace(/(....)/, '$1 ');
  const lk = await pub('POST', '/api/public/survey/lookup', { code: spaced });
  assert.equal(lk.status, 200, JSON.stringify(lk.body));
  assert.equal(lk.body.firstName, 'Aisha'); assert.equal(lk.body.facilityId, f1); assert.equal(lk.body.survey.wfh, true); assert.equal(lk.body.answers, null);
  assert.equal(lk.body.email, undefined, 'no personal data beyond the first name');
  const a1 = await pub('PUT', '/api/public/survey', { code: spaced, facilityId: f1, answers: { days: 4, wfh: 1, legs: [{ mode: 'car', km: 20 }], fuel: 'petrol', occ: 1 } });
  assert.equal(a1.status, 200, JSON.stringify(a1.body)); assert.ok(a1.body.kg > 0);
  // the same code changes the answer, it does not add one
  const a1b = await pub('PUT', '/api/public/survey', { code: spaced, facilityId: f1, answers: { days: 5, wfh: 0, legs: [{ mode: 'car', km: 20 }], fuel: 'petrol', occ: 1 } });
  assert.ok(a1b.body.kg > a1.body.kg);
  await pub('PUT', '/api/public/survey', { code: by('Omar Ali').code, facilityId: f1, answers: { days: 4, wfh: 1, legs: [{ mode: 'metro', km: 15 }, { mode: 'walk', km: 1 }], fuel: 'unknown', occ: 1 } });
  assert.equal((await pub('PUT', '/api/public/survey', { code: by('Omar Ali').code, facilityId: f1, answers: { days: 5, wfh: 0, legs: [{ mode: 'car', km: 900 }], fuel: 'petrol', occ: 1 } })).status, 400);
  assert.equal((await pub('POST', '/api/public/survey/lookup', { code: 'ZZZZZZZZ' })).status, 404);
  // on behalf (an admin types in a paper answer)
  const ob = await api('PUT', `/api/surveys/${id}/participants/${by('Sara Noor').id}/answer`, { facilityId: f2, answers: { days: 5, wfh: 0, legs: [{ mode: 'carpool', km: 30 }], fuel: 'diesel', occ: 3 } }, tenantA);
  assert.equal(ob.status, 200, JSON.stringify(ob.body));
  // results: mean per respondent × headcount, per facility; answered people cannot be removed
  d = (await api('GET', `/api/surveys/${id}`, undefined, tenantA)).body;
  assert.equal(d.results.n, 3); assert.equal(d.results.N, 140);
  const hq = d.results.facs.find((x: { id: string }) => x.id === f1), dep = d.results.facs.find((x: { id: string }) => x.id === f2);
  assert.equal(hq.n, 2); assert.ok(Math.abs(hq.t - (hq.mean * 100) / 1000) < 1e-9); assert.equal(hq.low, true);
  assert.ok(hq.moe > 0 && d.results.totLo < d.results.tot && d.results.totHi > d.results.tot);
  assert.equal(dep.n, 1); assert.ok(Math.abs(dep.t - (dep.mean * 40) / 1000) < 1e-9);
  assert.equal(d.results.modes.car, 1); assert.equal(d.results.modes.metro, 1);
  assert.equal((await api('DELETE', `/api/surveys/${id}/participants/${by('Omar Ali').id}`, undefined, tenantA)).status, 400);
  const inv = await app.inject({ method: 'GET', url: `/api/surveys/${id}/invitations`, headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(inv.statusCode, 200); assert.ok(inv.body.includes(by('Sara Noor').code));
  // typed-in figures already in Add data for the depot: the dry run says publishing replaces them
  await api('PUT', '/api/commuting', { facilityId: f2, year: 2025, method: 'typed', headcount: 40, workingDays: 220, weekend: 'sat_sun', rows: [{ mode: 'car', fuel: 'petrol', employees: 40, oneWayKm: 5, daysPerWeek: 5 }] }, tenantA);
  const dry = await api('POST', `/api/surveys/${id}/publish`, { dryRun: true }, tenantA);
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.match(dry.body.facilities.find((x: { facilityId: string }) => x.facilityId === f2).replaces, /typed in/);
  assert.equal(Number((await pq('SELECT count(*) FROM commute_record WHERE facility_id = ANY($1) AND survey_id IS NOT NULL', [[f1, f2]])).rows[0].count), 0, 'dry run writes nothing');
  const p = await api('POST', `/api/surveys/${id}/publish`, {}, tenantA);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.ok(p.body.facilities.every((x: { status: string }) => x.status === 'ok'), JSON.stringify(p.body));
  const rec = (await api('GET', `/api/commuting/record?facilityId=${f1}&year=2025`, undefined, tenantA)).body.record;
  assert.equal(rec.survey_id, id); assert.equal(rec.survey_name, 'Commuting 2025'); assert.equal(rec.method, 'survey'); assert.equal(rec.headcount, 100); assert.equal(rec.working_days, 230);
  assert.ok(Math.abs(rec.result.kg / 1000 - hq.t) / hq.t < 0.02, `${rec.result.kg / 1000} vs ${hq.t}`);
  const acts = (await pq(`SELECT i.code, count(*)::int AS n FROM activity a JOIN item i ON i.id = a.item_id WHERE a.commute_record_id = $1 GROUP BY 1`, [rec.id])).rows;
  assert.ok(acts.every((a) => a.n === 12), JSON.stringify(acts));
  assert.ok(acts.some((a) => a.code === 'commute:home:office-equipment'), 'home working counted when asked');
  assert.equal(Number((await pq('SELECT count(*) FROM commute_record WHERE facility_id = $1 AND year = 2025', [f2])).rows[0].count), 1, 'once a year per facility: replaced');
  // published: fixed until reopened; not answerable; another company sees nothing
  d = (await api('GET', `/api/surveys/${id}`, undefined, tenantA)).body;
  assert.equal(d.survey.status, 'published');
  assert.equal((await api('DELETE', `/api/surveys/${id}`, undefined, tenantA)).status, 400);
  assert.equal((await pub('POST', '/api/public/survey/lookup', { code: by('Omar Ali').code })).status, 409);
  assert.equal((await api('GET', `/api/surveys/${id}`, undefined, tenantB)).status, 404);
  assert.equal((await api('GET', '/api/surveys', undefined, tenantB)).body.surveys.length, 0);
  assert.equal((await api('POST', `/api/surveys/${id}/reopen`, {}, tenantA)).status, 200);
  // codes are rate-limited per address
  let last = 0;
  for (let i = 0; i < 22; i++) last = (await pub('POST', '/api/public/survey/lookup', { code: 'AAAAAAAA' }, '10.9.9.9')).status;
  assert.equal(last, 429);
});

test('Enter → Review → Approved: drafts submitted, approved by someone else (never their own), sent back with a note, withdrawn, deleted; month status per category', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const fac = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Review depot', facilityType: 'Depot' })).body.id as string;
  const mk = async (email: string, role: string, extra: object = {}) => {
    const r = await call(sa, 'POST', '/api/users', { name: email, email, role, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ck = await login(email, r.body.temporaryPassword);
    await call(ck, 'POST', '/api/auth/password', { current: r.body.temporaryPassword, next: 'a long enough pass' });
    return ck;
  };
  const prep = await mk('rprep@a.test', 'preparer', { facilityIds: [fac] });
  const mgr = await mk('rmgr@a.test', 'manager', { facilityIds: [fac] });
  const id = await diesel();
  const e = (m: string, q = 10) => ({ facilityId: fac, itemId: id, quantity: q, unit: 'L', periodStart: `2025-${m}-01`, periodEnd: `2025-${m}-${m === '02' ? 28 : 30}` });
  const a1 = (await call(prep, 'POST', '/api/activities', e('04'))).body.id, a2 = (await call(prep, 'POST', '/api/activities', e('04', 20))).body.id, a3 = (await call(prep, 'POST', '/api/activities', e('06'))).body.id;
  const st = async (ck: string) => (await call(ck, 'GET', `/api/data/status?facilityId=${fac}&year=2025`)).body;
  let s = await st(prep);
  assert.ok(s.facility, JSON.stringify(s));
  assert.equal(s.facility.type, 'Depot'); assert.equal(s.canApprove, false); assert.deepEqual(s.usual, ['stationary_combustion']);
  assert.deepEqual(s.cells.map((x: { m: number; draft: number }) => [x.m, x.draft]), [[4, 2], [6, 1]]);
  const rv = async (ck: string, stage = 'open') => (await call(ck, 'GET', `/api/review?facilityId=${fac}&category=stationary_combustion&from=2025-01-01&to=2025-12-31&stage=${stage}`)).body;
  let r = await rv(prep);
  assert.equal(r.entries.length, 3); assert.ok(r.entries.every((x: { canSubmit: boolean; canApprove: boolean; mine: boolean; entered_by: string }) => x.canSubmit && !x.canApprove && x.mine && x.entered_by === 'rprep@a.test'));
  const act = (ck: string, ids: string[], action: string, note?: string) => call(ck, 'POST', '/api/activities/review', { ids, action, note });
  assert.equal((await act(prep, [a1, a2, a3], 'submit')).body.done, 3);
  // the preparer cannot approve; the super admin who did not enter it can; nobody approves their own entry
  assert.equal((await act(prep, [a1], 'approve')).body.skipped[0].reason, 'you cannot approve data for this facility');
  assert.equal((await act(mgr, [a1], 'approve')).body.done, 1);
  const own = (await call(mgr, 'POST', '/api/activities', e('09'))).body.id;
  await act(mgr, [own], 'submit');
  assert.equal((await act(mgr, [own], 'approve')).body.skipped[0].reason, 'nobody approves their own entry');
  // sent back needs a note; the preparer sees it, fixes (deletes) and resubmits
  assert.equal((await act(mgr, [a2], 'return')).status, 400);
  assert.equal((await act(mgr, [a2], 'return', 'Quantity looks doubled — check the delivery note')).body.done, 1);
  r = await rv(prep);
  const back = r.entries.find((x: { id: string }) => x.id === a2);
  assert.equal(back.status, 'rejected'); assert.match(back.review_note, /doubled/); assert.equal(back.reviewed_by_name, 'rmgr@a.test'); assert.ok(back.canDelete);
  // withdraw, and a waiting or approved entry cannot be deleted
  assert.equal((await act(prep, [a3], 'withdraw')).body.done, 1);
  assert.equal((await call(prep, 'DELETE', `/api/activities/${a1}`)).status, 409);
  assert.equal((await call(prep, 'DELETE', `/api/activities/${a2}`)).status, 200);
  s = await st(mgr);
  assert.equal(s.canApprove, true);
  const apr = s.cells.find((x: { m: number }) => x.m === 4);
  assert.equal(apr.approved, 1); assert.equal(apr.rejected, 0); assert.equal(s.cells.find((x: { m: number }) => x.m === 6).draft, 1);
  assert.equal((await rv(prep, 'approved')).entries.length, 1);
  // approved counts in the dashboard; an approver can still send it back
  assert.equal((await act(sa, [a1], 'return', 'Wrong month')).body.done, 1);
  // another company sees none of it
  assert.equal((await api('GET', `/api/data/status?facilityId=${fac}&year=2025`, undefined, tenantB)).status, 403);
  const audits = (await pq(`SELECT action FROM audit_log WHERE action LIKE 'activity.%' AND detail::text LIKE $1`, [`%${a1}%`])).rows.map((x) => x.action);
  assert.ok(['activity.submit', 'activity.approve', 'activity.return'].every((x) => audits.includes(x)), JSON.stringify(audits));
});

test('business travel: flights from airports (great-circle + 8%, type by distance, class, return, trips, RF as the company chose), connecting legs, by flight type (typical distance), hotel stays by country, star rating and meetings / events from the library, rail; spend lines still go to 3.6', async () => {
  const p = { facilityId: facA, periodStart: '2026-03-01', periodEnd: '2026-03-31' };
  const f = (code: string) => pq(`SELECT f.basis, f.co2e::float8 AS v FROM factor f JOIN item i ON i.id = f.item_id JOIN factor_source s ON s.id = f.source_id WHERE i.code = $1 AND s.code = 'DESNZ-2026' AND f.status = 'active'`, [code]).then((r) => r.rows as { basis: string; v: number }[]);
  const sum = (rows: { v: number }[]) => rows.reduce((a, r) => a + r.v, 0);
  // DXB → LHR return, economy, 2 people: to/from the UK, over 3,700 km → long-haul
  const fl = await api('POST', '/api/activities/batch', { dryRun: false, entries: [
    { ...p, unit: 'pkm', note: 'A. Khan', trip: { kind: 'flight', from: 'dxb', to: 'LHR', cls: 'economy', ret: true, trips: 2 } },
    { ...p, unit: 'pkm', trip: { kind: 'flight', from: 'DXB', to: 'RUH', cls: 'business', ret: false } },
    { ...p, unit: 'pkm', trip: { kind: 'flight', from: 'AUH', to: 'DXB', cls: 'first' } },
    { ...p, unit: 'pkm', trip: { kind: 'flight', haul: 'intl', cls: 'premium', trips: 1 } },
  ] }, tenantA);
  assert.equal(fl.status, 200, JSON.stringify(fl.body));
  assert.ok(fl.body.results.every((r: { ok: boolean }) => r.ok), JSON.stringify(fl.body.results));
  const rows = (await pq(`SELECT a.quantity::float8 AS q, a.co2e_scope3::float8 AS s3, a.co2e_wtt::float8 AS wtt, i.code, a.inputs, c.code AS cat FROM activity a JOIN item i ON i.id = a.item_id JOIN category c ON c.id = a.category_id
                          WHERE a.id = ANY($1) ORDER BY a.created_at`, [fl.body.results.map((r: { id: string }) => r.id)])).rows;
  const { airport, greatCircleKm } = await import('../src/lib/airports.js');
  const gc = greatCircleKm(airport('DXB')!, airport('LHR')!);
  assert.ok(gc > 5400 && gc < 5550, String(gc));
  assert.equal(rows[0].code, 'bt:air:long:economy:rf'); assert.equal(rows[0].cat, 'business_travel');
  assert.ok(Math.abs(rows[0].q - gc * 1.08 * 2 * 2) < 0.01, `${rows[0].q} vs ${gc * 1.08 * 4}`);
  assert.ok(Math.abs(rows[0].s3 - rows[0].q * sum(await f('bt:air:long:economy:rf'))) < 1e-3, 'Scope 3 incl. well-to-tank, with RF');
  assert.equal(rows[0].wtt, 0); assert.equal(rows[0].inputs.trip.haul, 'long'); assert.equal(rows[0].inputs.trip.from, 'DXB');
  assert.equal(rows[1].code, 'bt:air:short:business:rf', 'DXB–RUH: two countries, under 3,700 km → short-haul');
  assert.equal(rows[2].code, 'bt:air:domestic:average:rf', 'AUH–DXB: one country → domestic, average (DESNZ has no first class for domestic)');
  assert.equal(rows[3].code, 'bt:air:intl:premium:rf'); assert.equal(rows[3].q, 3000, 'typical distance when only the type is known');
  assert.ok(!fl.body.results[3].warnings.length, 'a typical distance is not a warning');
  const typ = await api('POST', '/api/calculate', { ...p, unit: 'pkm', trip: { kind: 'flight', haul: 'long', cls: 'economy' } }, tenantA);
  assert.match(typ.body.steps.join(' '), /Long-haul flight: typical distance 6,500 km/);
  // a leg of a connecting flight says so
  const leg = await api('POST', '/api/calculate', { ...p, unit: 'pkm', trip: { kind: 'flight', from: 'DOH', to: 'LHR', cls: 'economy', leg: '2/2', route: 'DXB-DOH-LHR' } }, tenantA);
  assert.equal(leg.status, 200, JSON.stringify(leg.body));
  assert.match(leg.body.steps.join(' '), /Connecting flight DXB → DOH → LHR: leg 2 of 2/);
  // the company chooses without radiative forcing
  await api('PATCH', '/api/tenant', { flightRf: false }, tenantA);
  const norf = await api('POST', '/api/calculate', { ...p, unit: 'pkm', trip: { kind: 'flight', from: 'DXB', to: 'LHR', cls: 'economy' } }, tenantA);
  assert.equal(norf.status, 200, JSON.stringify(norf.body));
  assert.match(norf.body.steps.join(' '), /without radiative forcing/);
  await api('PATCH', '/api/tenant', { flightRf: true }, tenantA);
  // hotel: 2 rooms × 3 nights in the UAE; and with the hotel's own factor
  const uae = (await pq(`SELECT id FROM item WHERE code = 'bt:hotel:united-arab-emirates'`)).rows[0].id;
  const h = await api('POST', '/api/activities/batch', { dryRun: true, entries: [
    { ...p, itemId: uae, unit: 'room_night', trip: { kind: 'hotel', rooms: 2, nights: 3 } },
    { ...p, itemId: uae, unit: 'room_night', trip: { kind: 'hotel', rooms: 1, nights: 4, ownFactor: 20, ownSource: 'hotel' } },
  ] }, tenantA);
  assert.ok(Math.abs(h.body.results[0].totals.scope3 - 6 * sum(await f('bt:hotel:united-arab-emirates'))) < 1e-6, JSON.stringify(h.body.results[0]));
  assert.equal(h.body.results[1].totals.scope3, 80);
  // star rating: country average and a warning until the library has a factor; meetings: not counted until then
  const s4 = await api('POST', '/api/calculate', { ...p, itemId: uae, unit: 'room_night', trip: { kind: 'hotel', rooms: 1, nights: 2, stars: 4 } }, tenantA);
  assert.equal(s4.status, 200, JSON.stringify(s4.body));
  assert.ok(Math.abs(s4.body.totals.scope3 - 2 * sum(await f('bt:hotel:united-arab-emirates'))) < 1e-6);
  assert.ok(s4.body.warnings.some((w: string) => /No 4-star hotel factor/.test(w)));
  const m0 = await api('POST', '/api/calculate', { ...p, itemId: uae, unit: 'sqm_hour', trip: { kind: 'meeting', meetingSqm: 50, meetingHours: 3, stars: 4 } }, tenantA);
  assert.equal(m0.status, 200, JSON.stringify(m0.body));
  assert.equal(m0.body.totals.scope3, 0); assert.ok(m0.body.warnings.some((w: string) => /Meeting space not counted/.test(w)));
  const src = (await pq(`INSERT INTO factor_source (code, publisher, title) VALUES ('TEST-CHSB', 'test', 'test') ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`)).rows[0].id;
  const add = async (code: string, region: string, unit: string, v: number) => (await pq(`INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, version)
      SELECT id, $1, $2, 'scope3', $3, $4, '2020-01-01', '2030-12-31', 1 FROM item WHERE code = $5 RETURNING id`, [src, region, unit, v, code])).rows[0].id as number;
  const ids = [await add('bt:hotel:class:4', 'AE', 'room_night', 30), await add('bt:meeting:space', 'GLOBAL', 'sqm_hour', 0.1)];
  const s4b = await api('POST', '/api/calculate', { ...p, itemId: uae, unit: 'room_night', trip: { kind: 'hotel', rooms: 1, nights: 2, stars: 4 } }, tenantA);
  assert.ok(Math.abs(s4b.body.totals.scope3 - 60) < 1e-6, JSON.stringify(s4b.body));
  assert.match(s4b.body.steps.join(' '), /4-star hotel factor from the factor library/);
  const m1 = await api('POST', '/api/calculate', { ...p, itemId: uae, unit: 'sqm_hour', trip: { kind: 'meeting', meetingSqm: 100, meetingHours: 4, stars: 4 } }, tenantA);
  assert.ok(Math.abs(m1.body.totals.scope3 - 40) < 1e-6, JSON.stringify(m1.body));
  assert.match(m1.body.steps.join(' '), /any hotel type — none for 4-star yet/);
  ids.push(await add('bt:meeting:space:4', 'GLOBAL', 'sqm_hour', 0.2));
  const m2 = await api('POST', '/api/calculate', { ...p, itemId: uae, unit: 'sqm_hour', trip: { kind: 'meeting', meetingSqm: 100, meetingHours: 4, stars: 4 } }, tenantA);
  assert.ok(Math.abs(m2.body.totals.scope3 - 80) < 1e-6, JSON.stringify(m2.body));
  const opt4 = (await api('GET', '/api/trips/options?year=2026', undefined, tenantA)).body;
  const c4 = opt4.hotelClasses.find((c: { stars: number }) => c.stars === 4);
  assert.deepEqual(c4.regions, ['AE']); assert.deepEqual(c4.meetingRegions, ['GLOBAL']); assert.deepEqual(opt4.meetingRegions, ['GLOBAL']); assert.ok(opt4.rooms.length >= 4);
  await pq(`DELETE FROM factor WHERE id = ANY($1)`, [ids]);
  assert.equal((await api('POST', '/api/calculate', { ...p, itemId: uae, unit: 'room_night', trip: { kind: 'hotel', rooms: 1 } }, tenantA)).status, 400, 'nights needed');
  // rail: 120 km one way, return, 3 trips
  const rail = (await pq(`SELECT id FROM item WHERE code = 'bt:rail:national-rail'`)).rows[0];
  assert.ok(rail, 'national rail item');
  const r = await api('POST', '/api/calculate', { ...p, itemId: rail.id, unit: 'pkm', trip: { kind: 'ground', km: 120, ret: true, trips: 3 } }, tenantA);
  assert.ok(Math.abs(r.body.totals.scope3 - 720 * sum(await f('bt:rail:national-rail'))) < 1e-6, JSON.stringify(r.body));
  // airport search and distance
  assert.equal((await api('GET', '/api/trips/airports?q=riyadh', undefined, tenantA)).body.airports[0].iata, 'RUH');
  const opt = (await api('GET', '/api/trips/options?year=2026', undefined, tenantA)).body;
  assert.ok(opt.hotels.some((x: { iso: string; co2e: number }) => x.iso === 'AE' && x.co2e > 0) && opt.ground.length > 5 && opt.rf === true);
  assert.deepEqual(opt.hauls.map((x: { label: string }) => x.label), ['Domestic', 'Short-haul', 'Long-haul', 'International']);
  assert.ok(opt.airKg['bt:air:short:economy:rf'] > 0.1 && opt.hotelClasses.length === 4);
  assert.equal((await api('POST', '/api/calculate', { ...p, unit: 'pkm', trip: { kind: 'flight', from: 'XXX', to: 'LHR' } }, tenantA)).status, 400);
});

test('home and KPIs: facility status by category and month, approvals waiting for me (with the usual-month check), my drafts; KPI list and targets per selection; targets and collection rules on the company; one-user company approves its own', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const h = await call(sa, 'GET', '/api/home?year=2025');
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.ok(h.body.facilities.length > 0 && Array.isArray(h.body.cells) && h.body.settings.target.year === 2030 && h.body.settings.dueDay === 10);
  // the review test left one entry in the depot: approvals list it with who entered it
  assert.ok(h.body.approvals.every((a: { by: string | null; kg: number }) => a.kg >= 0));
  const k0 = (await call(sa, 'GET', '/api/kpis')).body;
  assert.deepEqual(k0.list, ['tot', 'purch', 'div', 'ren', 'fleet', 'pemp']); assert.equal(k0.canTarget, true);
  const k1 = await call(sa, 'PUT', '/api/kpis', { list: ['tot', 's12', 'water'], key: 'company', targets: { tot: 120, water: 900 } });
  assert.equal(k1.status, 200, JSON.stringify(k1.body));
  assert.deepEqual(k1.body.targets.company, { tot: 120, water: 900 });
  assert.equal((await call(sa, 'PUT', '/api/kpis', { list: ['nope'] })).status, 400);
  const tn = await call(sa, 'PATCH', '/api/tenant', { targetYear: 2035, targetS12: 50, targetS3: 30, dueDay: 15 });
  assert.equal(tn.body.target_year, 2035); assert.equal(tn.body.due_day, 15);
  assert.equal((await call(sa, 'GET', '/api/home')).body.settings.target.s12, 50);
  await call(sa, 'PATCH', '/api/tenant', { targetYear: 2030, targetS12: 42, targetS3: 25, dueDay: 10 });
  // another company: its own KPI settings
  assert.deepEqual((await api('GET', '/api/kpis', undefined, tenantB)).body.list, ['tot', 'purch', 'div', 'ren', 'fleet', 'pemp']);
});

test('targets & actions: SBTi structure and templates, objectives, scenarios (copy the current plan), library and custom actions with costs and delivery; who may change what; companies kept apart', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const g0 = await call(sa, 'GET', '/api/targets');
  assert.equal(g0.status, 200, JSON.stringify(g0.body));
  assert.equal(g0.body.scenarios.length, 1); assert.equal(g0.body.scenarios[0].name, 'Current plan');
  assert.equal(g0.body.sbti.cov12, 95); assert.equal(g0.body.canTarget, true); assert.equal(g0.body.currency, 'AED');
  const plan = g0.body.defaultScenario as string;
  // SBTi template: 1.5 °C → 4.2% a year × years from the base year
  const base = (await call(sa, 'GET', '/api/tenant')).body.base_year ?? 2025;
  const tp = await call(sa, 'POST', '/api/targets/template', { template: 'nz', year: 2030 });
  assert.equal(tp.status, 200, JSON.stringify(tp.body)); assert.equal(tp.body.s12, Math.round(Math.min(90, 4.2 * (2030 - base)) * 10) / 10);
  const g1 = (await call(sa, 'GET', '/api/targets')).body;
  assert.equal(g1.sbti.type, 'Near-term + net-zero'); assert.ok(g1.objectives.some((o: { year: number }) => o.year === 2050));
  assert.equal((await call(sa, 'PUT', '/api/targets', { sbti: { nzYear: 2028 } })).status, 400);  // before the near-term year
  assert.equal((await call(sa, 'PUT', '/api/targets', { year: 2030, s12: 42, s3: 25, sbti: { growth: 3, status: 'Validated', nzYear: 2045, resid: 8 } })).status, 200);
  const ob = await call(sa, 'POST', '/api/targets/objectives', { name: 'Fleet −50%', scope: 'Scope 1', year: 2032, pct: 50, growth: 2 });
  assert.equal(ob.status, 200);
  assert.equal((await call(sa, 'DELETE', `/api/targets/objectives/${ob.body.id}`)).status, 200);
  // actions: a library action in the current plan, a custom one for a facility
  const fac = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { name: string }) => n.name === 'Review depot').id;
  const a1 = await call(sa, 'POST', '/api/actions', { lib: 'solar', name: 'Rooftop solar', cat: 'Energy', scopes: [2], objVal: 25, start: 2026, end: 2028, abate: 120, capex: 400000, saving: 90000 });
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  const a2 = await call(sa, 'POST', '/api/actions', { name: 'Depot LED', cat: 'Energy', scopes: [2], start: 2026, end: 2026, abate: 10, facilityId: fac, status: 'Approved' });
  assert.equal((await call(sa, 'POST', '/api/actions', { name: 'Backwards', start: 2030, end: 2026 })).status, 400);
  // a scenario starting from the current plan's actions
  const sc = await call(sa, 'POST', '/api/scenarios', { name: 'Accelerated', copy: true });
  let acts = (await call(sa, 'GET', '/api/targets')).body.actions as { id: string; scenarioIds: string[]; status: string; actual: number | null }[];
  assert.ok(acts.find((a) => a.id === a1.body.id)!.scenarioIds.includes(sc.body.id));
  assert.equal((await call(sa, 'PATCH', `/api/actions/${a2.body.id}`, { scenarioIds: [sc.body.id], status: 'Done', actual: 9, actualNote: 'meter' })).status, 200);
  acts = (await call(sa, 'GET', '/api/targets')).body.actions;
  const d2 = acts.find((a) => a.id === a2.body.id)!;
  assert.deepEqual(d2.scenarioIds, [sc.body.id]); assert.equal(d2.status, 'Done'); assert.equal(d2.actual, 9);
  assert.equal((await call(sa, 'DELETE', `/api/scenarios/${plan}`)).status, 400);  // the current plan stays
  // a manager of the depot may change actions, not targets; a preparer and a verifier only look
  const mgr = await login('rmgr@a.test', 'a long enough pass'), prep = await login('rprep@a.test', 'a long enough pass');
  assert.equal((await call(mgr, 'PATCH', `/api/actions/${a2.body.id}`, { owner: 'Hessa' })).status, 200);
  assert.equal((await call(mgr, 'PUT', '/api/targets', { s12: 10 })).status, 403);
  assert.equal((await call(prep, 'POST', '/api/actions', { name: 'x', start: 2026, end: 2027 })).status, 403);
  assert.equal((await call(prep, 'GET', '/api/targets')).body.canAct, false);
  const lv = await call(mgr, 'POST', '/api/levers', { name: 'Fast', levers: { ren: 50, ev: 40, eff: 10, refr: 50, div: 30, growth: 2 }, end: 1000, year: 2030 });
  assert.equal(lv.status, 200);
  assert.equal((await call(sa, 'DELETE', `/api/scenarios/${sc.body.id}`)).status, 200);
  assert.deepEqual((await call(sa, 'GET', '/api/targets')).body.actions.find((a: { id: string }) => a.id === a2.body.id).scenarioIds, []);
  assert.equal((await call(sa, 'DELETE', `/api/actions/${a1.body.id}`)).status, 200);
  assert.ok(!(await call(sa, 'GET', '/api/targets')).body.actions.some((a: { id: string }) => a.id === a1.body.id));
  // another company sees none of it
  const b = (await api('GET', '/api/targets', undefined, tenantB)).body;
  assert.equal(b.actions.length, 0); assert.equal(b.objectives.length, 0);
  assert.equal((await api('PATCH', `/api/actions/${a2.body.id}`, { owner: 'x' }, tenantB)).status, 404);
});

test('approvals: waiting for me vs someone else, 6-month check; level 2 for large entries by an admin or the super admin, never the level-1 person', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const mgr = await login('rmgr@a.test', 'a long enough pass'), prep = await login('rprep@a.test', 'a long enough pass');
  const fac = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { name: string }) => n.name === 'Review depot').id;
  const id = await diesel();
  const e = (m: string, q: number) => ({ facilityId: fac, itemId: id, quantity: q, unit: 'L', periodStart: `2024-${m}-01`, periodEnd: `2024-${m}-28` });
  // history: approved months, then a month far above the usual
  const hist = [] as string[];
  for (const m of ['01', '02', '03']) hist.push((await call(prep, 'POST', '/api/activities', e(m, 1000))).body.id);
  await call(prep, 'POST', '/api/activities/review', { ids: hist, action: 'submit' });
  assert.equal((await call(mgr, 'POST', '/api/activities/review', { ids: hist, action: 'approve' })).body.done, 3);
  const big = (await call(prep, 'POST', '/api/activities', e('04', 3000))).body.id, ok = (await call(prep, 'POST', '/api/activities', e('05', 1050))).body.id;
  await call(prep, 'POST', '/api/activities/review', { ids: [big, ok], action: 'submit' });
  const ap = (await call(mgr, 'GET', '/api/approvals')).body;
  const b = ap.mine.find((x: { id: string }) => x.id === big), o = ap.mine.find((x: { id: string }) => x.id === ok);
  assert.ok(b && o, JSON.stringify(ap.mine.map((x: { id: string }) => x.id)));
  assert.equal(b.check.ok, false); assert.match(b.check.txt, /\+200% vs 6-month average/); assert.equal(o.check.ok, true);
  assert.ok((await call(prep, 'GET', '/api/approvals')).body.others.some((x: { id: string; waitingFor: string }) => x.id === big && x.waitingFor === 'rmgr@a.test'));
  // level 2 for every entry from 0 t: the manager's approval moves it to level 2
  assert.equal((await call(mgr, 'PUT', '/api/approvals/settings', { l2: true, minT: 0, cats: [], checkPct: 35 })).status, 403);
  assert.equal((await call(sa, 'PUT', '/api/approvals/settings', { l2: true, minT: 0, cats: [], checkPct: 35 })).status, 200);
  const r1 = (await call(mgr, 'POST', '/api/activities/review', { ids: [big], action: 'approve' })).body;
  assert.equal(r1.toLevel2, 1);
  const l2 = (await call(sa, 'GET', '/api/approvals')).body.mine.find((x: { id: string }) => x.id === big);
  assert.equal(l2.stage, 'L2'); assert.equal(l2.l1, 'rmgr@a.test');
  assert.equal((await call(mgr, 'POST', '/api/activities/review', { ids: [big], action: 'approve' })).body.skipped[0].reason, 'level 2 is approved by an admin or the super admin');
  assert.equal((await call(sa, 'POST', '/api/activities/review', { ids: [big], action: 'approve' })).body.done, 1);
  // the super admin as level 1 cannot also be level 2
  assert.equal((await call(sa, 'POST', '/api/activities/review', { ids: [ok], action: 'approve' })).body.toLevel2, 1);
  assert.equal((await call(sa, 'POST', '/api/activities/review', { ids: [ok], action: 'approve' })).body.skipped[0].reason, 'level 2 is approved by someone other than level 1');
  // sent back: back to level 1 when resubmitted
  await call(sa, 'POST', '/api/activities/review', { ids: [ok], action: 'return', note: 'check' });
  await call(prep, 'POST', '/api/activities/review', { ids: [ok], action: 'submit' });
  assert.equal((await call(mgr, 'GET', '/api/approvals')).body.mine.find((x: { id: string }) => x.id === ok).stage, null);
  await call(sa, 'PUT', '/api/approvals/settings', { l2: false, minT: 100, cats: [], checkPct: 35 });
  assert.equal((await call(mgr, 'POST', '/api/activities/review', { ids: [ok], action: 'approve' })).body.done, 1);
});

test('reports: entries behind the report with their GHG Protocol category, quality controls and justifications, entity and exclusions, templates, versions; who may change what; companies kept apart', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const mgr = await login('rmgr@a.test', 'a long enough pass');
  const l = await call(sa, 'GET', '/api/reports/lines?year=2024');
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.ok(l.body.lines.length > 0, 'no lines'); assert.ok(l.body.lines.every((x: { code: string; status: string }) => /^[123]\.\d+$/.test(x.code) && x.status === 'approved'), JSON.stringify(l.body.lines.slice(0, 2)));
  assert.ok(l.body.lines.some((x: { cat: string; code: string }) => x.cat === 'stationary_combustion' && x.code === '1.1'));
  const qd = await call(sa, 'GET', '/api/reports/quality?year=2024');
  assert.equal(qd.status, 200, JSON.stringify(qd.body));
  assert.deepEqual(qd.body.checks.map((c: { id: string }) => c.id), ['missing', 'odd', 'noev', 'reqev', 'spend', 'dup', 'est', 'old', 'self']);
  assert.equal((await call(mgr, 'PUT', '/api/reports/quality/odd', { year: 2024, text: 'x' })).status, 403);
  assert.equal((await call(sa, 'PUT', '/api/reports/quality/odd', { year: 2024, text: 'Plant shutdown in April' })).status, 200);
  assert.equal((await call(sa, 'GET', '/api/reports/quality?year=2024')).body.checks.find((c: { id: string }) => c.id === 'odd').justified.text, 'Plant shutdown in April');
  assert.equal((await call(sa, 'PUT', '/api/reports/settings', { entity: { legal: 'A Co LLC', mrvId: 'MRV-1' }, excl: { '3.9': 'No products shipped' } })).status, 200);
  assert.equal((await call(mgr, 'PUT', '/api/reports/settings', { entity: { legal: 'x' } })).status, 403);
  const st = (await call(sa, 'GET', '/api/reports/settings')).body;
  assert.equal(st.entity.legal, 'A Co LLC'); assert.equal(st.excl['3.9'], 'No products shipped');
  const t = await call(sa, 'POST', '/api/reports/templates', { name: 'Board pack', audience: 'Board', sections: ['cover', 'summary'] });
  assert.equal(t.status, 200);
  assert.equal((await call(sa, 'PUT', `/api/reports/templates/${t.body.id}`, { name: 'Board pack', sections: ['cover', 'summary', 'targets'] })).status, 200);
  const v = await call(sa, 'POST', '/api/reports/versions', { name: 'Q3 board', label: 'Company', period: '2025 · Jan–Dec', scope2: 'location', s: [10, 5, 2], byCode: { '1.1': 10, '2.1': 5, '3.6': 2 } });
  assert.equal(v.status, 200);
  assert.equal((await call(mgr, 'POST', '/api/reports/versions', { name: 'x', label: 'x', period: 'x', scope2: 'location', s: [0, 0, 0], byCode: {} })).status, 403);
  assert.equal((await call(sa, 'GET', '/api/reports/settings')).body.versions[0].byCode['1.1'], 10);
  const b = (await api('GET', '/api/reports/settings', undefined, tenantB)).body;
  assert.equal(b.versions.length, 0); assert.equal(b.templates.length, 0); assert.deepEqual(b.excl, {});
});

test('waste sent out: GRI 306 operation on the entry, hazardous proxy factor, duplicate manifest warning, hazardous needs a manifest to submit; QR bins, scans with checks, collection with weighbridge, month roll-up into drafts', async () => {
  const id = async (code: string) => (await pq('SELECT id FROM item WHERE code = $1', [code])).rows[0].id as number;
  const p = { facilityId: facA, periodStart: '2026-05-01', periodEnd: '2026-05-31', dataType: 'actual' };
  const fac = async (code: string) => Number((await pq(`SELECT f.co2e FROM factor f JOIN factor_source s ON s.id = f.source_id WHERE f.item_id = $1 AND s.code = 'DESNZ-2026' AND f.status = 'active' AND f.basis = 'scope3'`, [await id(code)])).rows[0].co2e);
  // incineration without energy recovery: same combustion factor, the operation is kept for GRI 306
  const ci = await api('POST', '/api/calculate', { ...p, itemId: await id('waste3:refuse:commercial-and-industrial-waste:combustion'), unit: 't', quantity: 2, wasteInfo: { gri: 'incin_noer' } }, tenantA);
  assert.equal(ci.status, 200, JSON.stringify(ci.body));
  assert.ok(Math.abs(ci.body.totals.scope3 - 2 * await fac('waste3:refuse:commercial-and-industrial-waste:combustion')) < 1e-6);
  assert.match(ci.body.steps.join(' '), /without energy recovery/);
  // clinical waste: no DESNZ factor, the C&I combustion factor as a proxy
  const cl = await api('POST', '/api/calculate', { ...p, itemId: await id('waste3:hazardous:clinical:treatment'), unit: 't', quantity: 1, wasteInfo: { hazardous: true, gri: 'other' } }, tenantA);
  assert.equal(cl.status, 200, JSON.stringify(cl.body));
  assert.ok(Math.abs(cl.body.totals.scope3 - await fac('waste3:refuse:commercial-and-industrial-waste:combustion')) < 1e-6);
  assert.ok(cl.body.warnings.some((w: string) => /proxy/.test(w)));
  assert.equal((await pq(`SELECT attrs->>'hazardous' AS h FROM item WHERE code = 'waste3:electrical-items:batteries:open_loop'`)).rows[0].h, 'true', 'batteries hazardous by default');
  // hazardous without a manifest: saved with a warning, cannot be submitted; the same manifest + material + quantity again: warning
  const e1 = await api('POST', '/api/activities/batch', { dryRun: false, entries: [
    { ...p, itemId: await id('waste3:electrical-items:batteries:open_loop'), unit: 't', quantity: 0.3, wasteInfo: { hazardous: true, contractor: 'E-waste B' } },
    { ...p, itemId: await id('waste3:refuse:commercial-and-industrial-waste:landfill'), unit: 't', quantity: 3.3, wasteInfo: { ref: 'MAN-77' } },
    { ...p, itemId: await id('waste3:refuse:commercial-and-industrial-waste:landfill'), unit: 't', quantity: 3.3, wasteInfo: { ref: 'man-77 ' } },
  ] }, tenantA);
  assert.ok(e1.body.results.every((r: { ok: boolean }) => r.ok), JSON.stringify(e1.body));
  assert.ok(e1.body.results[0].warnings.some((w: string) => /manifest number/.test(w)));
  assert.ok(!e1.body.results[1].warnings.some((w: string) => /same load/.test(w)) && e1.body.results[2].warnings.some((w: string) => /same load twice/.test(w)));
  const sub = await api('POST', '/api/activities/review', { ids: [e1.body.results[0].id], action: 'submit' }, tenantA);
  assert.equal(sub.body.skipped[0]?.reason, 'hazardous waste needs its manifest number', JSON.stringify(sub.body));

  // QR: a bin, scans, checks
  const paper = await id('waste3:paper:paper-and-board-mixed:closed_loop');
  const bin = await api('POST', '/api/qr/bins', { facilityId: facA, name: 'Bay 1 cardboard', itemId: paper, hazardous: false, contractor: 'Recycler C', capacityL: 5000, density: 0.1 }, tenantA);
  assert.equal(bin.status, 200, JSON.stringify(bin.body));
  assert.match(bin.body.code, /^[A-Z0-9]{10}$/);
  assert.equal((await api('POST', '/api/qr/bins', { facilityId: facA, name: 'x', itemId: await id('water:sewer') }, tenantA)).status, 400, 'only waste sent out');
  const byCode = await api('GET', `/api/qr/scan/${bin.body.code.toLowerCase()}`, undefined, tenantA);
  assert.equal(byCode.body.bin.id, bin.body.id); assert.equal(byCode.body.canScan, true);
  assert.equal((await api('GET', `/api/qr/scan/${bin.body.code}`, undefined, tenantB)).status, 404, 'another company cannot open the label');
  const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const day = (d: number, h = 8) => new Date(Date.UTC(y, m - 1, Math.min(d, now.getUTCDate()), h)).toISOString();
  const s = (b: Record<string, unknown>) => api('POST', `/api/qr/bins/${bin.body.id}/scans`, b, tenantA);
  for (const [i, kg] of [40, 50, 45].entries()) assert.equal((await s({ kind: 'weigh', kg, at: day(1, 6 + i) })).status, 200);
  const fill = await s({ kind: 'fill', fillPct: 50, at: day(1, 12) });
  assert.equal(fill.body.kg, 250); assert.equal(fill.body.estimated, true);
  const big = await s({ kind: 'weigh', kg: 400, at: day(1, 14) });
  assert.ok(big.body.flags.some((f: string) => /usual/.test(f)) && !big.body.flags.some((f: string) => /holds/.test(f)), JSON.stringify(big.body));
  const over = await s({ kind: 'weigh', kg: 700, at: day(1, 14) });
  assert.ok(over.body.flags.some((f: string) => /holds/.test(f)) && over.body.flags.some((f: string) => /duplicate/.test(f)), JSON.stringify(over.body));
  await api('POST', `/api/qr/scans/${over.body.id}/void`, {}, tenantA);
  assert.equal((await s({ kind: 'weigh' })).status, 400);
  // roll-up: weighed 40+50+45+400 actual, 250 estimated; one entry each
  const r0 = (await api('GET', `/api/qr/rollup?facilityId=${facA}&year=${y}&month=${m}`, undefined, tenantA)).body;
  const g = r0.groups.find((x: { itemId: number }) => x.itemId === paper);
  assert.equal(g.actual, 535); assert.equal(g.estimated, 250); assert.equal(g.scans, 5);
  // a hazardous bin: collection needs the manifest; the weighbridge weight replaces the field scans
  const bat = (await api('POST', '/api/qr/bins', { facilityId: facA, name: 'Batteries', itemId: await id('waste3:electrical-items:batteries:open_loop'), hazardous: true }, tenantA)).body;
  await api('POST', `/api/qr/bins/${bat.id}/scans`, { kind: 'weigh', kg: 30, at: day(1, 9) }, tenantA);
  assert.equal((await api('POST', `/api/qr/bins/${bat.id}/scans`, { kind: 'collection', kg: 36, at: day(1, 10) }, tenantA)).status, 400);
  assert.equal((await api('POST', `/api/qr/bins/${bat.id}/scans`, { kind: 'collection', kg: 36, manifest: 'HZ-9', at: day(1, 10) }, tenantA)).status, 200);
  const r1 = (await api('GET', `/api/qr/rollup?facilityId=${facA}&year=${y}&month=${m}`, undefined, tenantA)).body;
  const hb = r1.perBin.find((x: { bin: string }) => x.bin === 'Batteries');
  assert.equal(hb.basis, 'weighbridge'); assert.equal(hb.actualKg, 36);
  const made = await api('POST', '/api/qr/rollup', { facilityId: facA, year: y, month: m }, tenantA);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.made.length, 3, JSON.stringify(made.body));
  const acts = (await pq(`SELECT a.quantity::float8 AS q, a.unit, a.data_type, a.status, a.inputs->'wasteInfo' AS wi FROM activity a WHERE a.id = ANY($1) ORDER BY a.quantity`, [made.body.made.map((x: { id: string }) => x.id)])).rows;
  assert.deepEqual(acts.map((a) => [a.q, a.data_type, a.status]), [[36, 'actual', 'draft'], [250, 'estimated', 'draft'], [535, 'actual', 'draft']]);
  assert.equal(acts[0].wi.ref, 'HZ-9'); assert.equal(acts[0].wi.hazardous, true); assert.equal(acts[2].wi.contractor, 'Recycler C');
  assert.equal((await api('POST', '/api/qr/rollup', { facilityId: facA, year: y, month: m }, tenantA)).status, 400, 'scans are used once');
  assert.equal((await api('POST', `/api/qr/scans/${big.body.id}/void`, {}, tenantA)).status, 400, 'a rolled-up scan is changed through its entry');
});

test('waste contractor portal: access code (hashed, expires, revoked), only its own bins, collections with manifest and ticket, statement reconciled against the scans, accept / query', async () => {
  const id = async (code: string) => (await pq('SELECT id FROM item WHERE code = $1', [code])).rows[0].id as number;
  const pub = async (method: string, path: string, body?: unknown, tok?: string, raw?: Buffer) => {
    const headers: Record<string, string> = {}; if (tok) headers['x-contractor-token'] = tok;
    if (raw) { headers['content-type'] = 'application/octet-stream'; headers['x-filename'] = 'ticket.pdf'; }
    const r = await app.inject({ method: method as 'GET', url: `/api/public/contractor${path}`, payload: raw ?? ((body ?? (method === 'GET' ? undefined : {})) as object), headers });
    return { status: r.statusCode, body: r.json() };
  };
  const food = await id('waste3:refuse:organic-food-and-drink-waste:composting'), bat = await id('waste3:electrical-items:batteries:open_loop');
  const b1 = (await api('POST', '/api/qr/bins', { facilityId: facA, name: 'Food 1', itemId: food, contractor: 'Green Haul LLC', capacityL: 240, density: 0.5 }, tenantA)).body;
  const b2 = (await api('POST', '/api/qr/bins', { facilityId: facA, name: 'Batteries 2', itemId: bat, hazardous: true, contractor: 'green haul llc ' }, tenantA)).body;
  const other = (await api('POST', '/api/qr/bins', { facilityId: facA, name: 'Other co', itemId: food, contractor: 'Someone Else' }, tenantA)).body;
  const cr = await api('POST', '/api/qr/contractors', { name: 'Green Haul LLC', email: 'Ops@GreenHaul.example', months: 6 }, tenantA);
  assert.equal(cr.status, 200, JSON.stringify(cr.body));
  assert.equal(cr.body.bins, 2, 'bins linked by the contractor name');
  assert.match(cr.body.code, /^[A-Z0-9]{10}$/);
  assert.equal((await pq('SELECT code_hash FROM waste_contractor WHERE id = $1', [cr.body.id])).rows[0].code_hash.length, 64, 'only the hash is stored');
  // sign in
  assert.equal((await pub('POST', '/login', { email: 'ops@greenhaul.example', code: 'WRONGCODE1' })).status, 401);
  const li = await pub('POST', '/login', { email: 'OPS@greenhaul.example', code: cr.body.code.toLowerCase() });
  assert.equal(li.status, 200, JSON.stringify(li.body));
  const tok = li.body.token as string;
  assert.equal((await pub('GET', '/me')).status, 401, 'needs the session');
  const me = (await pub('GET', '/me', undefined, tok)).body;
  assert.deepEqual(me.bins.map((b: { name: string }) => b.name).sort(), ['Batteries 2', 'Food 1']);
  // collections: own bins only; hazardous needs the manifest; a ticket; no duplicate manifest
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await pub('POST', '/collections', { binId: other.id, date: today, kg: 50 }, tok)).status, 400, 'not its bin');
  assert.equal((await pub('POST', '/collections', { binId: b2.id, date: today, kg: 30 }, tok)).status, 400, 'hazardous without manifest');
  const ev = await pub('POST', '/evidence', undefined, tok, Buffer.from('%PDF-1.4 demo ticket'));
  assert.equal(ev.status, 200, JSON.stringify(ev.body));
  assert.equal((await pub('POST', '/evidence', undefined, tok, Buffer.from('not a pdf'))).status, 400);
  const c1 = await pub('POST', '/collections', { binId: b2.id, date: today, kg: 30, manifest: 'GH-1', documentId: ev.body.documentId }, tok);
  assert.equal(c1.status, 200, JSON.stringify(c1.body));
  assert.equal((await pub('POST', '/collections', { code: b2.code, date: today, kg: 31, manifest: 'gh-1' }, tok)).status, 409, 'same manifest twice');
  const c2 = await pub('POST', '/collections', { code: b1.code, date: today, kg: 400 }, tok);
  assert.equal(c2.status, 200);
  const sc = (await pq('SELECT kind, by_user, contractor_id, flags FROM waste_scan WHERE id = $1', [c2.body.id])).rows[0];
  assert.equal(sc.kind, 'collection'); assert.equal(sc.contractor_id, cr.body.id); assert.deepEqual(sc.flags, ['No ticket attached']);
  // staff see the ticket
  const doc = await app.inject({ method: 'GET', url: `/api/qr/documents/${ev.body.documentId}`, headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(doc.statusCode, 200); assert.equal(doc.headers['content-type'], 'application/pdf');
  // statement: lines for its bins only; reconciliation against the collections (weighbridge)
  const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  assert.equal((await pub('PUT', '/statements', { year: y, month: m, lines: [{ facilityId: facA, itemId: await id('waste3:paper:paper-and-board-mixed:closed_loop'), tonnes: 1 }] }, tok)).status, 400);
  const st = await pub('PUT', '/statements', { year: y, month: m, lines: [{ facilityId: facA, itemId: food, gri: null, tonnes: 0.3 }, { facilityId: facA, itemId: bat, gri: null, tonnes: 0.03 }], note: 'monthly' }, tok);
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const rec = (await api('GET', `/api/qr/statements?year=${y}&month=${m}`, undefined, tenantA)).body.contractors.find((x: { contractor: string }) => x.contractor === 'Green Haul LLC');
  assert.ok(Math.abs(rec.ours - 0.43) < 1e-9 && Math.abs(rec.theirs - 0.33) < 1e-9, JSON.stringify(rec));
  assert.equal(rec.flagged, true, 'food 0.3 t against 0.4 t: -25%');
  assert.equal((await api('PUT', `/api/qr/statements/${rec.statement.id}`, { status: 'queried' }, tenantA)).status, 400, 'a query says why');
  await api('PUT', `/api/qr/statements/${rec.statement.id}`, { status: 'queried', note: 'Food waste 0.4 t on our weighbridge' }, tenantA);
  assert.equal((await pub('GET', '/me', undefined, tok)).body.statements[0].reviewNote, 'Food waste 0.4 t on our weighbridge');
  await pub('PUT', '/statements', { year: y, month: m, lines: [{ facilityId: facA, itemId: food, gri: null, tonnes: 0.4 }, { facilityId: facA, itemId: bat, gri: null, tonnes: 0.03 }] }, tok);
  await api('PUT', `/api/qr/statements/${rec.statement.id}`, { status: 'accepted' }, tenantA);
  assert.equal((await pub('PUT', '/statements', { year: y, month: m, lines: [{ facilityId: facA, itemId: food, gri: null, tonnes: 9 }] }, tok)).status, 400, 'accepted: locked');
  // another company sees nothing of it
  assert.equal((await api('GET', '/api/qr/contractors', undefined, tenantB)).body.contractors.length, 0);
  // revoked: the session ends and the code stops working
  await api('POST', `/api/qr/contractors/${cr.body.id}/revoke`, {}, tenantA);
  assert.equal((await pub('GET', '/me', undefined, tok)).status, 401);
  assert.equal((await pub('POST', '/login', { email: 'ops@greenhaul.example', code: cr.body.code })).status, 401);
  const nc = (await api('POST', `/api/qr/contractors/${cr.body.id}/code`, { months: 1 }, tenantA)).body;
  assert.equal((await pub('POST', '/login', { email: 'ops@greenhaul.example', code: nc.code })).status, 200);
});

test('audit & assurance: engagement, period lock enforced by the database (no entry, edit, review or delete), unlock with a reason, reproducible samples with key items, tests, findings respond / close; logo and reporting entity', async () => {
  const id = async (code: string) => (await pq('SELECT id FROM item WHERE code = $1', [code])).rows[0].id as number;
  const Y = 2023, p = { facilityId: facA, periodStart: `${Y}-04-01`, periodEnd: `${Y}-04-30`, dataType: 'actual' };
  const diesel = (await pq(`SELECT i.id FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id WHERE c.code = 'stationary_combustion' AND i.name ILIKE 'diesel%' ORDER BY i.id LIMIT 1`)).rows[0].id;
  const saved = await api('POST', '/api/activities/batch', { dryRun: false, entries: [1000, 2000, 50, 60, 70, 80].map((q) => ({ ...p, itemId: diesel, unit: 'L', quantity: q })) }, tenantA);
  assert.ok(saved.body.results.every((r: { ok: boolean }) => r.ok), JSON.stringify(saved.body));
  const ids = saved.body.results.map((r: { id: string }) => r.id);
  // not approved yet: cannot lock
  assert.equal((await api('POST', '/api/assurance/locks', { month: `${Y}-04` }, tenantA)).status, 400);
  const sa = await login(superA.email, superA.temporaryPassword);
  await api('POST', '/api/activities/review', { ids, action: 'submit' }, tenantA);
  const ap = await call(sa, 'POST', '/api/activities/review', { ids, action: 'approve' });
  assert.equal(ap.body.done, 6, JSON.stringify(ap.body));
  const mo = (await api('GET', `/api/assurance?year=${Y}`, undefined, tenantA)).body.months.find((m: { month: string }) => m.month === `${Y}-04`);
  assert.equal(mo.ready, true);
  assert.equal((await api('POST', '/api/assurance/locks', { month: `${Y}-04` }, tenantA)).status, 200);
  // locked: nothing changes
  const add = await api('POST', '/api/activities', { ...p, itemId: diesel, unit: 'L', quantity: 5 }, tenantA);
  assert.equal(add.status, 409, JSON.stringify(add.body)); assert.equal(add.body.error, 'PERIOD_LOCKED');
  const ret = await call(sa, 'POST', '/api/activities/review', { ids: [ids[0]], action: 'return', note: 'x' });
  assert.equal(ret.body.skipped[0]?.reason, 'the month is locked for assurance');
  assert.equal((await api('POST', '/api/activities/recalculate', { ids, onlyWithWarnings: false }, tenantA)).status === 200 ? 'ok' : 'err', 'ok');
  assert.equal((await pq('SELECT count(*)::int AS n FROM activity WHERE id = ANY($1)', [ids])).rows[0].n, 6);
  { const cl = await pool.connect(); try { await cl.query('BEGIN'); await cl.query(`SELECT set_config('app.platform', 'on', true)`);
      await assert.rejects(cl.query(`UPDATE activity SET quantity = 1 WHERE id = $1`, [ids[0]]), /locked for assurance/, 'even directly in the database'); } finally { await cl.query('ROLLBACK'); cl.release(); } }
  // sampling: key items always in; the same seed draws the same sample
  const eng = await api('PUT', '/api/assurance/engagement', { year: Y, standard: 'ISO 14064-3', level: 'limited', status: 'fieldwork', materiality: 5 }, tenantA);
  assert.equal(eng.status, 200, JSON.stringify(eng.body));
  const s1 = (await api('POST', '/api/assurance/samples', { year: Y, method: 'value', size: 4, seed: 42, keyPct: 20 }, tenantA)).body;
  const s2 = (await api('POST', '/api/assurance/samples', { year: Y, method: 'value', size: 4, seed: 42, keyPct: 20 }, tenantA)).body;
  const it1 = (await api('GET', `/api/assurance/samples/${s1.id}`, undefined, tenantA)).body.items, it2 = (await api('GET', `/api/assurance/samples/${s2.id}`, undefined, tenantA)).body.items;
  assert.ok(s1.keyItems >= 1, JSON.stringify(s1));
  assert.deepEqual(it1.map((x: { id: string }) => x.id).sort(), it2.map((x: { id: string }) => x.id).sort(), 'reproducible with the seed');
  assert.ok(it1.some((x: { key: boolean; qty: number }) => x.key && x.qty === 2000), 'the 2,000 L entry is a key item');
  assert.equal((await api('PUT', `/api/assurance/samples/${s1.id}/tests/${it1[0].id}`, { result: 'exception' }, tenantA)).status, 400, 'an exception says why');
  await api('PUT', `/api/assurance/samples/${s1.id}/tests/${it1[0].id}`, { result: 'agreed' }, tenantA);
  // findings: raised, responded by the company, closed by the verifier side
  const f = (await api('POST', '/api/assurance/findings', { year: Y, activityId: ids[1], severity: 'medium', kind: 'evidence', text: 'Delivery note missing', impactT: 0.5 }, tenantA)).body;
  assert.equal((await call(sa, 'PUT', `/api/assurance/findings/${f.id}/respond`, { response: 'Delivery note attached' })).status, 200);
  assert.equal((await call(sa, 'PUT', `/api/assurance/findings/${f.id}/close`, {})).status, 200);
  const A = (await api('GET', `/api/assurance?year=${Y}`, undefined, tenantA)).body;
  assert.equal(A.findings[0].status, 'closed'); assert.equal(A.kpis.openFindings, 0); assert.equal(A.engagement.standard, 'ISO 14064-3');
  const pack = (await api('GET', `/api/assurance/pack?year=${Y}`, undefined, tenantA)).body;
  assert.ok(pack.totals.s1 > 0 && pack.trail.some((t: { action: string }) => t.action === 'period.lock'), JSON.stringify(pack.totals));
  // unlock needs a reason; then changes are possible again
  assert.equal((await api('POST', `/api/assurance/locks/${Y}-04/unlock`, { reason: '' }, tenantA)).status, 400);
  assert.equal((await api('POST', `/api/assurance/locks/${Y}-04/unlock`, { reason: 'Correction agreed with the verifier' }, tenantA)).status, 200);
  assert.equal((await api('POST', '/api/activities', { ...p, itemId: diesel, unit: 'L', quantity: 5 }, tenantA)).status, 200);
  // logo and reporting entity
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const lg = await app.inject({ method: 'POST', url: '/api/tenant/logo', payload: png, headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream' } });
  assert.equal(lg.statusCode, 200, lg.body);
  assert.equal((await app.inject({ method: 'GET', url: '/api/tenant/logo', headers: { cookie: adminCookie, 'x-tenant-id': tenantA } })).headers['content-type'], 'image/png');
  await call(sa, 'PUT', '/api/reports/settings', { entity: { lei: '529900T8BM49AURSDO55', region: 'Bavaria', revenue: 1200000, revenueCurrency: 'EUR' } });
  const st = (await api('GET', '/api/reports/settings', undefined, tenantA)).body;
  assert.equal(st.entity.lei, '529900T8BM49AURSDO55'); assert.equal(st.company.hasLogo, true); assert.ok(st.company.currency);
  // a new company takes its currency and time zone from its country
  const de = (await api('POST', '/api/platform/companies', { name: 'Berlin GmbH', country: 'de', superAdmin: { name: 'Dora', email: 'dora@de.test' } })).body.company;
  assert.equal(de.currency, 'EUR'); assert.equal(de.timezone, 'Europe/Berlin');
  void id;
});

// ------------------------------------------------------- global grid factors --
test('grid factors of other countries: eGRID sub-region, EU country with year fallback, Australian state with upstream; loading again changes nothing', async () => {
  const grid = await itemId('grid:electricity');
  const groupA = (await api('GET', '/api/org', undefined, tenantA)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const fac = async (name: string, country: string, gridRegion?: string) =>
    (await api('POST', '/api/org/nodes', { parentId: groupA, kind: 'facility', name, country, gridRegion }, tenantA)).body.id;
  const calc = (facilityId: string, ps: string, pe: string) =>
    api('POST', '/api/calculate', { facilityId, itemId: grid, unit: 'MWh_e', quantity: 10, periodStart: ps, periodEnd: pe }, tenantA);
  // California (eGRID CAMX 2023): location 0.195045, T&D 0.007997 kg/kWh
  const ca = await calc(await fac('San Jose lab', 'US', 'US-CAMX'), '2023-06-01', '2023-06-30');
  assert.equal(ca.status, 200, JSON.stringify(ca.body));
  assert.ok(Math.abs(ca.body.totals.scope2 - 1950.45) < 1e-6, JSON.stringify(ca.body.totals));
  assert.ok(Math.abs(ca.body.totals.td_loss - 79.97) < 1e-6);
  // Germany: EEA 2022 is the latest; a 2025 entry uses it and says so
  const de = await calc(await fac('Munich office', 'DE'), '2025-03-01', '2025-03-31');
  assert.ok(Math.abs(de.body.totals.scope2 - 3660) < 1e-6, JSON.stringify(de.body.totals));
  assert.ok(de.body.warnings.some((w: string) => /2022/.test(w)), JSON.stringify(de.body.warnings));
  // Queensland (NGA 2025): Scope 2 0.67, Scope 3 upstream 0.09
  const qld = await calc(await fac('Brisbane depot', 'AU', 'AU-QLD'), '2025-08-01', '2025-08-31');
  assert.ok(Math.abs(qld.body.totals.scope2 - 6700) < 1e-6 && Math.abs(qld.body.totals.wtt - 900) < 1e-6, JSON.stringify(qld.body.totals));
  // the library lists the regions with their source
  const regions = (await api('GET', '/api/grid-regions', undefined, tenantA)).body.regions;
  assert.ok(regions.find((r: { code: string }) => r.code === 'US-CAMX').factors.some((f: { source: string }) => f.source === 'EPA eGRID2023'));
  const { seedGrid } = await import('../src/db/seed.js');
  const c = await pool.connect();
  try { await c.query('BEGIN'); const again = await seedGrid(c as never); await c.query('ROLLBACK'); assert.equal(again.added, 0); }
  finally { c.release(); }
});

// --------------------------------------------------------- vault & messages --
test('document vault: upload with details, evidence on entries, other screens\' files listed, access by facility, versions, archive rules, locked months keep evidence', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const north = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Vault north' })).body.id;
  const south = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Vault south' })).body.id;
  const mk = async (email: string, role: string, extra: object = {}) => {
    const r = await call(sa, 'POST', '/api/users', { name: email, email, role, ...extra });
    const ck = await login(email, r.body.temporaryPassword);
    await call(ck, 'POST', '/api/auth/password', { current: r.body.temporaryPassword, next: 'a long enough pass' });
    return ck;
  };
  const prep = await mk('vprep@a.test', 'preparer', { facilityIds: [north] });
  const ver = await mk('vver@a.test', 'verifier');
  const up = (who: string, name: string, data: Buffer, meta: object, path = '/api/vault') => app.inject({ method: 'POST', url: path, payload: data,
    headers: { cookie: who, 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name), 'x-meta': encodeURIComponent(JSON.stringify(meta)) } });
  const pdf = (s: string) => Buffer.from(`%PDF-1.4\n% ${s}\n%%EOF`);
  // an entry at north, Jan 2022
  const diesel = (await pq(`SELECT i.id FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id WHERE c.code = 'stationary_combustion' AND i.name ILIKE 'diesel%' ORDER BY i.id LIMIT 1`)).rows[0].id;
  const e = await call(prep, 'POST', '/api/activities', { facilityId: north, itemId: diesel, unit: 'L', quantity: 300, periodStart: '2022-01-01', periodEnd: '2022-01-31', dataType: 'actual' });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  // preparer: a file for their facility, linked to the entry in the same call
  const r1 = await up(prep, 'fuel-invoice-jan.pdf', pdf('invoice'), { type: 'invoice', facilityId: north, periodFrom: '2022-01-01', periodTo: '2022-01-31', tags: ['diesel'], linkActivityIds: [e.body.id] });
  assert.equal(r1.statusCode, 200, r1.body); const doc = r1.json().id; assert.equal(r1.json().linked, 1);
  // not another facility, not company-wide, not a renamed executable
  assert.equal((await up(prep, 'x.pdf', pdf('south'), { type: 'invoice', facilityId: south })).statusCode, 403);
  assert.equal((await up(prep, 'x2.pdf', pdf('wide'), { type: 'policy' })).statusCode, 400);
  assert.equal((await up(prep, 'evil.pdf', Buffer.from('MZ\x90\x00 not a pdf'), { type: 'invoice', facilityId: north })).statusCode, 400);
  assert.equal((await up(prep, 'run.exe', Buffer.from('MZ'), { type: 'other', facilityId: north })).statusCode, 400);
  // the same file again is not stored twice
  assert.equal((await up(prep, 'copy.pdf', pdf('invoice'), { type: 'invoice', facilityId: north })).statusCode, 409);
  // super admin: a company-wide permit expiring soon, and a south contract
  const soon = new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10);
  const permit = (await up(sa, 'permit.pdf', pdf('permit'), { type: 'permit', validUntil: soon, title: 'Environmental permit' })).json().id;
  const contract = (await up(sa, 'south-ppa.pdf', pdf('ppa'), { type: 'contract', facilityId: south })).json().id;
  // the entry shows its evidence
  const ev = (await call(prep, 'GET', `/api/activities/${e.body.id}/evidence`)).body;
  assert.equal(ev.files.length, 1); assert.equal(ev.files[0].how, 'linked'); assert.equal(ev.canAdd, true);
  // who sees what
  const listP = (await call(prep, 'GET', '/api/vault')).body;
  assert.ok(listP.docs.some((d: { id: string }) => d.id === doc) && listP.docs.some((d: { id: string }) => d.id === permit), 'own facility + company-wide');
  assert.ok(!listP.docs.some((d: { id: string }) => d.id === contract), 'not another facility');
  assert.equal((await call(prep, 'GET', `/api/vault/${contract}/file`)).status, 404);
  const listS = (await call(sa, 'GET', '/api/vault?view=expiring')).body;
  assert.deepEqual(listS.docs.map((d: { id: string }) => d.id), [permit]); assert.ok(listS.kpis.expiring >= 1);
  assert.equal((await call(sa, 'GET', `/api/vault?facilityId=${south}`)).body.docs.length, 1);
  assert.equal((await call(sa, 'GET', '/api/vault?q=diesel')).body.docs[0].id, doc, 'search by tag');
  assert.equal((await call(sa, 'GET', '/api/vault?year=2022&month=1')).body.docs.some((d: { id: string }) => d.id === doc), true);
  // a file another screen keeps (contractor tickets, bills…) is listed too
  const t = await app.inject({ method: 'GET', url: `/api/vault/${doc}/file`, headers: { cookie: ver } });
  assert.equal(t.statusCode, 200); assert.equal(t.headers['x-content-type-options'], 'nosniff');
  // verifier reads only
  assert.equal((await call(ver, 'PATCH', `/api/vault/${doc}`, { type: 'invoice', facilityId: north })).status, 403);
  assert.equal((await up(ver, 'v.pdf', pdf('ver'), { type: 'other', facilityId: north })).statusCode, 403);
  // a new version keeps the links; the old one is marked replaced
  const v2 = await up(prep, 'fuel-invoice-jan-corrected.pdf', pdf('invoice v2'), {}, `/api/vault/${doc}/version`);
  assert.equal(v2.statusCode, 200, v2.body); const doc2 = v2.json().id;
  const det = (await call(prep, 'GET', `/api/vault/${doc2}`)).body;
  assert.equal(det.links.length, 1); assert.deepEqual(det.versions.map((x: { version: number }) => x.version), [1, 2]);
  assert.ok(!(await call(prep, 'GET', '/api/vault')).body.docs.some((d: { id: string }) => d.id === doc), 'replaced versions are hidden from the list');
  // approved: the evidence cannot be archived; the month locked: evidence can be added, not removed
  await call(prep, 'POST', '/api/activities/review', { ids: [e.body.id], action: 'submit' });
  assert.equal((await call(sa, 'POST', '/api/activities/review', { ids: [e.body.id], action: 'approve' })).body.done, 1);
  assert.equal((await call(prep, 'POST', `/api/vault/${doc2}/archive`, { reason: 'wrong file' })).status, 400);
  assert.equal((await call(sa, 'POST', '/api/assurance/locks', { month: '2022-01' })).status, 200);
  const extra = await up(prep, 'delivery-note.pdf', pdf('delivery'), { type: 'invoice', facilityId: north, linkActivityIds: [e.body.id] });
  assert.equal(extra.statusCode, 200, extra.body);
  const un = await call(prep, 'DELETE', `/api/vault/${extra.json().id}/links/${e.body.id}`);
  assert.equal(un.status, 409); assert.equal(un.body.error, 'PERIOD_LOCKED');
  // counted as evidence for assurance
  const items = await pq(`SELECT EXISTS (SELECT 1 FROM document_link WHERE activity_id = $1) AS e`, [e.body.id]);
  assert.equal(items.rows[0].e, true);
  // archive an unlinked file, restore it; deleting for good waits for the retention period
  assert.equal((await call(sa, 'POST', `/api/vault/${contract}/archive`, { reason: 'x' })).status, 400, 'needs a reason');
  assert.equal((await call(sa, 'POST', `/api/vault/${contract}/archive`, { reason: 'Superseded contract' })).status, 200);
  assert.equal((await call(sa, 'GET', '/api/vault?view=archived')).body.docs[0].id, contract);
  const del = await call(sa, 'DELETE', `/api/vault/${contract}`);
  assert.equal(del.status, 400); assert.match(del.body.message, /Kept until/);
  assert.equal((await call(sa, 'POST', `/api/vault/${contract}/restore`)).status, 200);
  assert.equal((await call(sa, 'PUT', '/api/vault/settings', { retentionYears: 10 })).body.ok, true);
  assert.equal((await call(sa, 'GET', '/api/vault')).body.kpis.retentionYears, 10);
  await call(sa, 'POST', '/api/assurance/locks/2022-01/unlock', { reason: 'test over' });
});

test('message centre: a conversation with the team, unread replies, attachments, super admin sees the company\'s, team inbox, announcements to all or chosen companies', async () => {
  const sa = await login(superA.email, superA.temporaryPassword);
  const r = await call(sa, 'POST', '/api/users', { name: 'Msg Prep', email: 'mprep@a.test', role: 'preparer', facilityIds: [] });
  const prep = await login('mprep@a.test', r.body.temporaryPassword);
  await call(prep, 'POST', '/api/auth/password', { current: r.body.temporaryPassword, next: 'a long enough pass' });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const att = await app.inject({ method: 'POST', url: '/api/messages/attachments', payload: png, headers: { cookie: prep, 'content-type': 'application/octet-stream', 'x-filename': 'screen.png' } });
  assert.equal(att.statusCode, 200, att.body);
  const t = await call(prep, 'POST', '/api/messages', { topic: 'data_help', subject: 'How do I enter district cooling?', page: '/data/district_cooling', body: 'We get TRh on the bill.', documentId: att.json().documentId });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal((await call(prep, 'POST', '/api/messages', { topic: 'nope', subject: 'x', body: 'y' })).status, 400);
  // the super admin sees it; another preparer would not
  assert.ok((await call(sa, 'GET', '/api/messages')).body.threads.some((x: { id: string }) => x.id === t.body.id));
  const other = await call(sa, 'POST', '/api/users', { name: 'Other', email: 'mother@a.test', role: 'verifier' });
  const oth = await login('mother@a.test', other.body.temporaryPassword);
  await call(oth, 'POST', '/api/auth/password', { current: other.body.temporaryPassword, next: 'a long enough pass' });
  assert.equal((await call(oth, 'GET', `/api/messages/${t.body.id}`)).status, 404);
  assert.equal((await call(oth, 'GET', `/api/messages/attachments/${att.json().documentId}`)).status, 404);
  // the team inbox: waiting, unread; reply → answered, unread for the preparer
  const inbox = (await api('GET', '/api/team/messages')).body;
  const th = inbox.threads.find((x: { id: string }) => x.id === t.body.id);
  assert.ok(th && th.unread && th.company, JSON.stringify(inbox.counts));
  assert.ok((await api('GET', '/api/messages/counts')).body.unread >= 1);
  const full = (await api('GET', `/api/team/messages/${t.body.id}`)).body;
  assert.equal(full.messages[0].filename, 'screen.png');
  assert.equal((await app.inject({ method: 'GET', url: `/api/team/messages/attachments/${att.json().documentId}`, headers: { cookie: adminCookie } })).headers['content-type'], 'image/png');
  assert.equal((await api('POST', `/api/team/messages/${t.body.id}/reply`, { body: 'Use District cooling, unit TRh, with the plant COP.' })).status, 200);
  assert.equal((await call(prep, 'GET', '/api/messages/counts')).body.unread, 1);
  const open = (await call(prep, 'GET', `/api/messages/${t.body.id}`)).body;
  assert.equal(open.thread.status, 'answered'); assert.equal(open.messages[1].from_team, true);
  assert.equal((await call(prep, 'GET', '/api/messages/counts')).body.unread, 0, 'read once opened');
  // the company replies: waiting again; closes it
  await call(prep, 'POST', `/api/messages/${t.body.id}/reply`, { body: 'Thanks, done.' });
  assert.equal((await call(prep, 'GET', `/api/messages/${t.body.id}`)).body.thread.status, 'open');
  await call(prep, 'POST', `/api/messages/${t.body.id}/close`);
  assert.equal((await api('GET', '/api/team/messages?status=closed')).body.threads.some((x: { id: string }) => x.id === t.body.id), true);
  // only the platform admin uses the team side
  assert.equal((await call(sa, 'GET', '/api/team/messages')).status, 403);
  // announcements: to everyone, and to company B only
  const all = (await api('POST', '/api/team/announcements', { kind: 'factors', title: 'Grid factors for 50 countries added', body: 'Recalculate entries with warnings.' })).body.id;
  await api('POST', '/api/team/announcements', { kind: 'news', title: 'Only for B', body: 'Hello B', tenantIds: [tenantB] });
  const mine = (await call(prep, 'GET', '/api/messages')).body.announcements;
  assert.ok(mine.some((a: { id: string }) => a.id === all)); assert.ok(!mine.some((a: { title: string }) => a.title === 'Only for B'));
  assert.ok((await call(prep, 'GET', '/api/messages/counts')).body.announcements >= 1);
  await call(prep, 'POST', '/api/announcements/read-all');
  assert.equal((await call(prep, 'GET', '/api/messages/counts')).body.announcements, 0);
  await api('POST', `/api/team/announcements/${all}/withdraw`);
  assert.ok(!(await call(sa, 'GET', '/api/messages')).body.announcements.some((a: { id: string }) => a.id === all));
});

// ------------------------------------------------------------------ security --
test('security: MFA sign-in (code, replay, recovery code), company MFA policy forces set-up, reset by super admin; rate limits; file pages keep their sandbox', async () => {
  const { codeAt, stepNow } = await import('../src/lib/totp.js');
  const co = (await api('POST', '/api/platform/companies', { name: 'Secure Co', country: 'AU', gwpSet: 'AR6', superAdmin: { name: 'Sam Secure', email: 'sam@secure.test' } })).body;
  const raw = (method: string, url: string, payload?: object, cookie?: string) => app.inject({ method: method as 'POST', url, payload, headers: cookie ? { cookie } : {} });
  const cookieOf = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0]!;
  assert.ok(co.superAdmin?.temporaryPassword, JSON.stringify(co));
  let r = await raw('POST', '/api/auth/login', { email: 'sam@secure.test', password: co.superAdmin.temporaryPassword });
  assert.equal(r.statusCode, 200, r.body);
  let sam = cookieOf(r);
  const pw = await call(sam, 'POST', '/api/auth/password', { current: co.superAdmin.temporaryPassword, next: 'sam long password 1' });
  assert.equal(pw.status, 200, JSON.stringify(pw.body));
  // set up: secret + QR; a wrong code refused; the right one gives 10 recovery codes
  const su = await call(sam, 'POST', '/api/auth/mfa/setup');
  assert.equal(su.status, 200, JSON.stringify(su.body));
  const setup = su.body;
  assert.match(setup.uri, /^otpauth:\/\/totp\/.+secret=/);
  assert.equal((await call(sam, 'POST', '/api/auth/mfa/enable', { code: '000000' })).status, 400);
  const en = await call(sam, 'POST', '/api/auth/mfa/enable', { code: codeAt(setup.secret, stepNow()) });
  assert.equal(en.status, 200, JSON.stringify(en.body)); assert.equal(en.body.recoveryCodes.length, 10);
  const secretRow = (await pq(`SELECT mfa_secret FROM app_user WHERE email = 'sam@secure.test'`)).rows[0].mfa_secret;
  assert.ok(secretRow.startsWith('v1:') && !secretRow.includes(setup.secret), 'stored encrypted');
  // sign in again: password, then the code
  r = await raw('POST', '/api/auth/login', { email: 'sam@secure.test', password: 'sam long password 1' });
  assert.equal(r.json().mfa, true); assert.ok(!r.headers['set-cookie'], 'no session before the second factor');
  const ch = r.json().challenge;
  assert.equal((await raw('POST', '/api/auth/mfa', { challenge: ch, code: codeAt(setup.secret, stepNow()) })).statusCode, 401, 'the code used at set-up cannot be replayed');
  r = await raw('POST', '/api/auth/mfa', { challenge: ch, code: codeAt(setup.secret, stepNow() + 1) });
  assert.equal(r.statusCode, 200, r.body); sam = cookieOf(r);
  assert.equal((await call(sam, 'GET', '/api/auth/me')).body.user.via, 'password+mfa');
  // a recovery code works once
  const ch2 = (await raw('POST', '/api/auth/login', { email: 'sam@secure.test', password: 'sam long password 1' })).json().challenge;
  assert.equal((await raw('POST', '/api/auth/mfa', { challenge: ch2, recoveryCode: en.body.recoveryCodes[0].toLowerCase() })).statusCode, 200);
  const ch3 = (await raw('POST', '/api/auth/login', { email: 'sam@secure.test', password: 'sam long password 1' })).json().challenge;
  assert.equal((await raw('POST', '/api/auth/mfa', { challenge: ch3, recoveryCode: en.body.recoveryCodes[0] })).statusCode, 401);
  // company policy: everyone must use MFA → a new person must set it up before anything else
  assert.equal((await call(sam, 'PUT', '/api/security/mfa', { required: true })).status, 200);
  const p = (await call(sam, 'POST', '/api/users', { name: 'Pat', email: 'pat@secure.test', role: 'verifier' })).body;
  r = await raw('POST', '/api/auth/login', { email: 'pat@secure.test', password: p.temporaryPassword });
  const pat = cookieOf(r);
  await call(pat, 'POST', '/api/auth/password', { current: p.temporaryPassword, next: 'pat long password 1' });
  r = await raw('POST', '/api/auth/login', { email: 'pat@secure.test', password: 'pat long password 1' });
  assert.equal(r.json().enrolMfa, true);
  const pat2 = cookieOf(r);
  const blocked = await call(pat2, 'GET', '/api/home');
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error, 'MUST_ENROL_MFA');
  const ps = (await call(pat2, 'POST', '/api/auth/mfa/setup')).body;
  assert.equal((await call(pat2, 'POST', '/api/auth/mfa/enable', { code: codeAt(ps.secret, stepNow()) })).status, 200);
  assert.notEqual((await call(pat2, 'GET', '/api/security')).body.error, 'MUST_ENROL_MFA');
  assert.equal((await call(pat2, 'POST', '/api/auth/mfa/disable', { password: 'pat long password 1', code: codeAt(ps.secret, stepNow() + 1) })).status, 400, 'required: cannot switch off');
  const sec = (await call(sam, 'GET', '/api/security')).body;
  assert.equal(sec.people.filter((x: { mfa: boolean }) => x.mfa).length, 2);
  // lost phone: the super admin resets it; Pat's sessions end
  const pid = sec.people.find((x: { email: string }) => x.email === 'pat@secure.test').id;
  assert.equal((await call(sam, 'POST', `/api/users/${pid}/mfa/reset`)).status, 200);
  assert.equal((await call(pat2, 'GET', '/api/auth/me')).status, 401);
  assert.ok((await pq(`SELECT 1 FROM audit_log WHERE action = 'mfa.reset'`)).rowCount);
  // rate limits (own app instance with low limits)
  const limited = await (await import('../src/app.js')).buildApp({ rateLimit: { user: 4, ip: 3, login: 2 } });
  const tries = [];
  for (let i = 0; i < 3; i++) tries.push((await limited.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@x.test', password: 'x' } })).statusCode);
  assert.deepEqual(tries, [401, 401, 429]);
  const lr = await limited.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nobody@x.test', password: 'x' } });
  assert.ok(Number(lr.headers['retry-after']) > 0);
  const us = [];
  for (let i = 0; i < 5; i++) us.push((await limited.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sam } })).statusCode);
  assert.deepEqual(us, [200, 200, 200, 200, 429]);
  await limited.close();
  // headers: a stored file keeps its sandbox; pages get the app policy
  const h = await app.inject({ method: 'GET', url: '/api/health' });
  assert.match(String(h.headers['content-security-policy']), /frame-ancestors 'none'/);
  await call(sam, 'PUT', '/api/security/mfa', { required: false });
  (globalThis as { __secure?: unknown }).__secure = { tenant: co.company.id, sam, secret: setup.secret };
});

test('security: single sign-on with a mock identity provider (signature, nonce, audience, MFA claim, unknown person), SSO-only refuses passwords except break-glass', async () => {
  const { generateKeyPairSync, createSign, randomUUID } = await import('node:crypto');
  const Fastify = (await import('fastify')).default;
  const { codeAt, stepNow } = await import('../src/lib/totp.js');
  const S = (globalThis as { __secure?: { tenant: string; sam: string; secret: string } }).__secure!;
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }), other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const idp = Fastify(); let iss = '';
  const mode: { amr: string[]; email: string; aud?: string; wrongKey?: boolean } = { amr: ['pwd', 'mfa'], email: 'sam@secure.test' };
  idp.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, b, done) => done(null, Object.fromEntries(new URLSearchParams(String(b)))));
  idp.get('/.well-known/openid-configuration', async () => ({ issuer: iss, authorization_endpoint: `${iss}/authorize`, token_endpoint: `${iss}/token`, jwks_uri: `${iss}/keys` }));
  idp.get('/keys', async () => ({ keys: [jwk] }));
  idp.post('/token', async (req) => {
    const b = req.body as Record<string, string>;
    assert.ok(b.code_verifier && b.client_secret === 'idp-secret' && b.grant_type === 'authorization_code');
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss, aud: mode.aud ?? 'ekotrace-app', sub: randomUUID(), exp: now + 600, iat: now, nonce: b.code, email: mode.email, amr: mode.amr })).toString('base64url');
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(mode.wrongKey ? other.privateKey : key.privateKey).toString('base64url');
    return { id_token: `${head}.${body}.${sig}`, token_type: 'Bearer' };
  });
  await idp.listen({ port: 0, host: '127.0.0.1' });
  iss = `http://127.0.0.1:${(idp.server.address() as { port: number }).port}`;
  try {
    const put = await call(S.sam, 'PUT', '/api/security/sso', { issuer: iss, clientId: 'ekotrace-app', clientSecret: 'idp-secret', domains: ['secure.test'], enabled: true, enforce: false, requireMfa: true });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.ok((await pq(`SELECT client_secret FROM sso_config WHERE tenant_id = $1`, [S.tenant])).rows[0].client_secret.startsWith('v1:'), 'client secret encrypted');
    assert.equal((await call(S.sam, 'POST', '/api/security/sso/test', { issuer: iss })).body.ok, true);
    // the domain is taken: no other company can claim it
    assert.equal((await api('PUT', '/api/security/sso', { issuer: iss, clientId: 'x', domains: ['secure.test'], enabled: false, enforce: false, requireMfa: true }, tenantB)).status, 400);
    const run = async () => {
      const st = await app.inject({ method: 'POST', url: '/api/auth/sso/start', payload: { email: 'Sam@Secure.test' } });
      assert.equal(st.statusCode, 200, st.body);
      const u = new URL(st.json().url);
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      return app.inject({ method: 'GET', url: `/api/auth/sso/callback?code=${u.searchParams.get('nonce')}&state=${u.searchParams.get('state')}` });
    };
    let cb = await run();
    assert.equal(cb.statusCode, 302); assert.equal(cb.headers.location, '/', String(cb.headers.location));
    const ssoCookie = String(cb.headers['set-cookie']).split(';')[0]!;
    assert.equal((await call(ssoCookie, 'GET', '/api/auth/me')).body.user.via, 'sso');
    // a state is used once
    const st2 = new URL((await app.inject({ method: 'POST', url: '/api/auth/sso/start', payload: { email: 'sam@secure.test' } })).json().url);
    const q2 = `/api/auth/sso/callback?code=${st2.searchParams.get('nonce')}&state=${st2.searchParams.get('state')}`;
    assert.equal((await app.inject({ method: 'GET', url: q2 })).headers.location, '/');
    assert.match(decodeURIComponent(String((await app.inject({ method: 'GET', url: q2 })).headers.location)), /already used/);
    // refused: no MFA at the provider, wrong key, other application, unknown person, unknown domain
    mode.amr = ['pwd']; cb = await run(); assert.match(decodeURIComponent(String(cb.headers.location)), /multi-factor/); mode.amr = ['pwd', 'mfa'];
    mode.wrongKey = true; cb = await run(); assert.match(decodeURIComponent(String(cb.headers.location)), /signature/); mode.wrongKey = false;
    mode.aud = 'someone-else'; cb = await run(); assert.match(decodeURIComponent(String(cb.headers.location)), /another application/); delete mode.aud;
    mode.email = 'ghost@secure.test'; cb = await run(); assert.match(decodeURIComponent(String(cb.headers.location)), /no .* account/); mode.email = 'sam@secure.test';
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/sso/start', payload: { email: 'a@nowhere.test' } })).statusCode, 404);
    assert.ok((await pq(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'login.sso_failed' AND tenant_id = $1`, [S.tenant])).rows[0].n >= 4);
    // SSO only: a verifier's password is refused; the super admin with MFA keeps password + code (break-glass)
    assert.equal((await call(S.sam, 'PUT', '/api/security/sso', { issuer: iss, clientId: 'ekotrace-app', domains: ['secure.test'], enabled: true, enforce: true, requireMfa: true })).status, 200);
    const v = (await pq(`SELECT email FROM app_user WHERE email = 'pat@secure.test'`)).rows[0];
    const pr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: v.email, password: 'pat long password 1' } });
    assert.equal(pr.statusCode, 403); assert.equal(pr.json().error, 'SSO_REQUIRED');
    const sr = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'sam@secure.test', password: 'sam long password 1' } });
    assert.equal(sr.json().mfa, true);
    void codeAt; void stepNow;
    await call(S.sam, 'PUT', '/api/security/sso', { issuer: iss, clientId: 'ekotrace-app', domains: ['secure.test'], enabled: false, enforce: false, requireMfa: true });
  } finally { await idp.close(); }
});

test('security: audit log is append-only and hash-chained (tampering detected), forwarded to a SIEM over syslog, pulled over the API; export ZIP; deletion with a certificate', async () => {
  const S = (globalThis as { __secure?: { tenant: string; sam: string } }).__secure!;
  const { seal, verify, forward } = await import('../src/lib/auditlog.js');
  await seal();
  let v = await verify();
  assert.equal(v.ok, true, JSON.stringify(v)); assert.ok(v.checked > 10);
  // the database refuses changes and deletions, even for the platform
  await assert.rejects(pq(`UPDATE audit_log SET user_name = 'x' WHERE id = (SELECT min(id) FROM audit_log)`), /cannot be changed/);
  await assert.rejects(pq(`DELETE FROM audit_log WHERE id = (SELECT max(id) FROM audit_log)`), /cannot be deleted/);
  await assert.rejects(pq(`TRUNCATE audit_log`), /cannot be emptied/);
  // someone with database-owner rights switches the guard off and edits a record: the chain shows it
  const target = (await pq(`SELECT id, action FROM audit_log WHERE seal_seq IS NOT NULL ORDER BY seal_seq LIMIT 1 OFFSET 5`)).rows[0];
  await pq(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard`);
  await pq(`UPDATE audit_log SET action = 'nothing.to.see' WHERE id = $1`, [target.id]);
  v = await verify();
  assert.equal(v.ok, false); assert.equal(v.problem?.id, String(target.id)); assert.match(v.problem!.what, /changed/);
  await pq(`UPDATE audit_log SET action = $2 WHERE id = $1`, [target.id, target.action]);
  await pq(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_guard`);
  assert.equal((await verify()).ok, true);
  assert.equal((await api('GET', '/api/platform/audit/verify')).body.ok, true);
  assert.equal((await call(S.sam, 'GET', '/api/platform/audit/verify')).status, 403);
  // SIEM over syslog (TCP, octet-counted RFC 5424 frames)
  const net = await import('node:net');
  let got = '';
  const srv = net.createServer((s) => s.on('data', (d) => { got += d.toString(); }));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const n = await forward(`tcp://127.0.0.1:${(srv.address() as { port: number }).port}`);
  await new Promise((ok) => setTimeout(ok, 200)); srv.close();
  assert.ok(n > 10 && /^\d+ <109>1 \S+ \S+ ekotrace - login /.test(got), got.slice(0, 200));
  assert.ok(got.includes('"action":"mfa.enable"'));
  assert.equal(await forward(`tcp://127.0.0.1:1`), 0, 'nothing new to send');
  // SIEM pull: an API client with the "audit events" permission sees its own company's events only
  const k = (await call(S.sam, 'POST', '/api/api-keys', { name: 'SIEM', scopes: ['audit_events'] })).body;
  const tok = (await app.inject({ method: 'POST', url: '/api/v1/oauth/token', payload: { grant_type: 'client_credentials', client_id: k.id, client_secret: k.key } })).json().access_token;
  const ev = (await app.inject({ method: 'GET', url: '/api/v1/audit-events?limit=1000', headers: { authorization: `Bearer ${tok}` } })).json();
  assert.ok(ev.events.length > 5 && ev.events.every((e: { hash: string }) => /^[0-9a-f]{64}$/.test(e.hash)));
  const mine = (await pq(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND seal_seq IS NOT NULL`, [S.tenant])).rows[0].n;
  assert.equal(ev.events.length, mine, 'only this company');
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/audit-events?after=${ev.next}`, headers: { authorization: `Bearer ${tok}` } })).json().events.length, 0);
  // export: ZIP with the company's tables, files and a manifest; no secrets
  const ex = await app.inject({ method: 'GET', url: '/api/security/export', headers: { cookie: S.sam } });
  assert.equal(ex.statusCode, 200); assert.equal(ex.headers['content-type'], 'application/zip');
  const zip = ex.rawPayload;
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const names = [...zip.toString('latin1').matchAll(/(data\/[a-z_]+\.csv|manifest\.json|README\.txt)/g)].map((m) => m[0]);
  for (const f of ['data/tenant.csv', 'data/app_user.csv', 'data/audit_log.csv', 'manifest.json']) assert.ok(names.includes(f), f);
  const sha = String(ex.headers['x-manifest-sha256']);
  assert.match(sha, /^[0-9a-f]{64}$/);
  // deletion: only suspended companies, with the name typed; a certificate; audit records stay
  const del = (b: object) => api('POST', `/api/platform/companies/${S.tenant}/destroy`, b);
  assert.equal((await del({ confirm: 'Secure Co', reason: 'Contract ended (test)' })).status, 400, 'must be suspended first');
  await api('PATCH', `/api/platform/companies/${S.tenant}`, { status: 'suspended' });
  assert.equal((await del({ confirm: 'Secure', reason: 'Contract ended (test)' })).status, 400);
  const d = await del({ confirm: 'Secure Co', reason: 'Contract ended (test)', exportSha256: sha });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.ok(d.body.certificate.rows_deleted.app_user >= 2 && d.body.certificate.export_sha256 === sha);
  assert.equal((await pq('SELECT count(*)::int AS n FROM tenant WHERE id = $1', [S.tenant])).rows[0].n, 0);
  assert.equal((await pq('SELECT count(*)::int AS n FROM app_user WHERE tenant_id = $1', [S.tenant])).rows[0].n, 0);
  assert.ok((await pq(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [S.tenant])).rows[0].n > 10, 'audit records kept');
  assert.equal((await api('GET', '/api/platform/certificates')).body.certificates[0].company, 'Secure Co');
  assert.equal((await verify()).ok, true);
});

test('account sync (SCIM 2.0, as Microsoft Entra sends it): joiners, group → role, leavers switched off, last super admin kept; people page refuses manual role changes', async () => {
  const co = (await api('POST', '/api/platform/companies', { name: 'Synced Co', country: 'GB', gwpSet: 'AR6', superAdmin: { name: 'Sue Sync', email: 'sue@synced.test' } })).body;
  const T = co.company.id;
  const group = (await api('GET', '/api/org', undefined, T)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const plant = (await api('POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Leeds plant' }, T)).body.id;
  const tok = (await api('POST', '/api/security/scim/token', undefined, T)).body;
  assert.match(tok.secret, /^eks_/); assert.match(tok.baseUrl, /\/scim\/v2$/);
  const scim = (method: string, url: string, body?: object) => app.inject({ method: method as 'GET', url: `/scim/v2${url}`, payload: body ? JSON.stringify(body) : undefined,
    headers: { authorization: `Bearer ${tok.secret}`, ...(body ? { 'content-type': 'application/scim+json' } : {}) } });
  assert.equal((await app.inject({ method: 'GET', url: '/scim/v2/Users', headers: { authorization: 'Bearer nope' } })).statusCode, 401);
  assert.equal((await scim('GET', '/ServiceProviderConfig')).json().patch.supported, true);
  // Entra looks the person up, then creates them
  assert.equal((await scim('GET', '/Users?filter=userName%20eq%20%22ann%40synced.test%22')).json().totalResults, 0);
  const ann = await scim('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'Ann@Synced.test', active: true, externalId: 'e-1', displayName: 'Ann Analyst',
    emails: [{ primary: true, type: 'work', value: 'ann@synced.test' }], name: { givenName: 'Ann', familyName: 'Analyst' } });
  assert.equal(ann.statusCode, 201, ann.body);
  const annId = ann.json().id;
  assert.equal(ann.json().active, false, 'no mapped group yet: no access');
  assert.equal((await scim('POST', '/Users', { userName: 'ann@synced.test' })).statusCode, 409);
  if (tenantA) assert.equal((await scim('POST', '/Users', { userName: 'super@a.test' })).json().scimType, 'uniqueness', 'an email of another company');
  // a group arrives; the super admin maps it to Preparer for the Leeds plant
  const g = (await scim('POST', '/Groups', { displayName: 'Ekotrace preparers', externalId: 'g-1', members: [{ value: annId }] })).json();
  let st = (await api('GET', '/api/security/scim', undefined, T)).body;
  assert.equal(st.groups[0].members, 1);
  await api('PUT', `/api/security/scim/groups/${g.id}`, { role: 'preparer', facilityIds: [plant] }, T);
  let a = (await pq('SELECT role, disabled FROM app_user WHERE id = $1', [annId])).rows[0];
  assert.deepEqual([a.role, a.disabled], ['preparer', false]);
  assert.equal((await pq('SELECT count(*)::int AS n FROM user_facility WHERE user_id = $1 AND node_id = $2', [annId, plant])).rows[0].n, 1);
  // a second group with a higher role wins; leaving it goes back
  const g2 = (await scim('POST', '/Groups', { displayName: 'Ekotrace verifiers' })).json();
  await api('PUT', `/api/security/scim/groups/${g2.id}`, { role: 'verifier' }, T);
  const g3r = await scim('POST', '/Groups', { displayName: 'Ekotrace super admins' });
  assert.equal(g3r.statusCode, 201, g3r.body);
  const g3 = g3r.json();
  const m3 = await api('PUT', `/api/security/scim/groups/${g3.id}`, { role: 'super_admin' }, T);
  assert.equal(m3.status, 200, JSON.stringify(m3.body));
  assert.equal((await scim('PATCH', `/Groups/${g3.id}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Add', path: 'members', value: [{ value: annId }] }] })).statusCode, 204);
  if (process.env.DBG) console.log('DBG', JSON.stringify((await pq(`SELECT g.display_name, g.role FROM scim_member m JOIN scim_group g ON g.id = m.group_id WHERE m.user_id = $1`, [annId])).rows), JSON.stringify((await pq(`SELECT action, detail FROM audit_log WHERE tenant_id = $1 AND action LIKE 'scim.%' ORDER BY id DESC LIMIT 4`, [T])).rows));
  assert.equal((await pq('SELECT role FROM app_user WHERE id = $1', [annId])).rows[0].role, 'super_admin');
  await scim('PATCH', `/Groups/${g3.id}`, { Operations: [{ op: 'Remove', path: `members[value eq "${annId}"]` }] });
  assert.equal((await pq('SELECT role FROM app_user WHERE id = $1', [annId])).rows[0].role, 'preparer');
  // Entra switches a leaver off with PATCH active "False" (a string): no access, sessions ended
  const p = await scim('PATCH', `/Users/${annId}`, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'Replace', path: 'active', value: 'False' }] });
  assert.equal(p.statusCode, 200, p.body); assert.equal(p.json().active, false);
  assert.equal((await pq('SELECT disabled FROM app_user WHERE id = $1', [annId])).rows[0].disabled, true);
  await scim('PATCH', `/Users/${annId}`, { Operations: [{ op: 'replace', value: { active: true, displayName: 'Ann A. Analyst' } }] });
  a = (await pq('SELECT name, disabled FROM app_user WHERE id = $1', [annId])).rows[0];
  assert.deepEqual([a.name, a.disabled], ['Ann A. Analyst', false]);
  // the existing super admin is matched by userName and synced; the provider cannot remove the last one
  const sue = (await scim('GET', '/Users?filter=userName%20eq%20%22sue%40synced.test%22')).json().Resources[0];
  await scim('PATCH', `/Users/${sue.id}`, { Operations: [{ op: 'Add', path: 'externalId', value: 'e-sue' }] });
  assert.equal((await scim('DELETE', `/Users/${sue.id}`)).statusCode, 204);
  const s = (await pq('SELECT role, disabled FROM app_user WHERE id = $1', [sue.id])).rows[0];
  assert.deepEqual([s.role, s.disabled], ['super_admin', false], 'last super admin kept');
  assert.ok((await pq(`SELECT 1 FROM audit_log WHERE action = 'scim.kept_last_super_admin' AND tenant_id = $1`, [T])).rowCount);
  // the people page refuses manual role changes for synced people
  const r = await api('PATCH', `/api/users/${annId}`, { role: 'manager' }, T);
  assert.equal(r.status, 400); assert.equal(r.body.error, 'SCIM_MANAGED');
  assert.equal((await api('GET', '/api/users', undefined, T)).body.users.find((u: { id: string }) => u.id === annId).scim_managed, true);
  // people with no mapped group: read-only when the company chooses
  const bob = (await scim('POST', '/Users', { userName: 'bob@synced.test', active: true })).json();
  assert.equal(bob.active, false);
  await api('PUT', '/api/security/scim/settings', { defaultRole: 'verifier' }, T);
  assert.equal((await pq('SELECT role, disabled FROM app_user WHERE id = $1', [bob.id])).rows[0].disabled, false);
  // group deleted in the provider: its people lose what it gave
  assert.equal((await scim('DELETE', `/Groups/${g.id}`)).statusCode, 204);
  assert.equal((await pq('SELECT role FROM app_user WHERE id = $1', [annId])).rows[0].role, 'verifier');
  // a new token replaces the old one
  const tok2 = (await api('POST', '/api/security/scim/token', undefined, T)).body.secret;
  assert.equal((await scim('GET', '/Users')).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/scim/v2/Users', headers: { authorization: `Bearer ${tok2}` } })).json().totalResults, 3);
});

test('security alerts from audit records (failed sign-in burst, locked account, MFA policy off, new super admin, export), deduplicated, acknowledged; stored files encrypted at rest', async () => {
  const { seal } = await import('../src/lib/auditlog.js');
  const { runAlerts } = await import('../src/lib/alerts.js');
  const co = (await api('POST', '/api/platform/companies', { name: 'Alert Co', country: 'SG', gwpSet: 'AR6', superAdmin: { name: 'Al Ert', email: 'al@alert.test' } })).body;
  const T = co.company.id;
  for (let i = 0; i < 6; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'al@alert.test', password: 'wrong password ' + i }, remoteAddress: '203.0.113.9' });
  for (let i = 0; i < 6; i++) await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `nobody${i}@alert.test`, password: 'x' }, remoteAddress: '203.0.113.9' });
  await api('PUT', '/api/security/mfa', { required: true }, T);
  await api('PUT', '/api/security/mfa', { required: false }, T);
  await api('POST', '/api/users', { name: 'Second Super', email: 'ss@alert.test', role: 'super_admin' }, T);
  await app.inject({ method: 'GET', url: '/api/security/export', headers: { cookie: adminCookie, 'x-tenant-id': T } });
  await seal();
  const n = await runAlerts();
  assert.ok(n >= 4, String(n));
  assert.equal(await runAlerts(), 0, 'nothing new');
  const list = (await api('GET', '/api/security/alerts?open=true', undefined, T)).body;
  const rules = list.alerts.map((a: { rule: string }) => a.rule).sort();
  for (const r of ['account_locked', 'data_export', 'mfa_policy_off', 'new_super_admin']) assert.ok(rules.includes(r), `${r} in ${rules}`);
  assert.equal(list.alerts.filter((a: { rule: string }) => a.rule === 'account_locked').length, 1, 'once an hour');
  assert.ok((await pq(`SELECT 1 FROM security_alert WHERE rule = 'failed_signins_ip' AND tenant_id IS NULL`)).rowCount, 'platform alert for the address');
  assert.ok((await pq(`SELECT 1 FROM audit_log WHERE action = 'alert.mfa_policy_off' AND tenant_id = $1`, [T])).rowCount, 'also in the audit log (→ SIEM)');
  const { syslogLine } = await import('../src/lib/auditlog.js');
  assert.match(syslogLine({ action: 'alert.mfa_policy_off', at: new Date().toISOString(), detail: { severity: 'high' } }), /^<107>1 /, 'high → syslog error');
  const id = list.alerts.find((a: { rule: string }) => a.rule === 'data_export').id;
  assert.equal((await api('POST', `/api/security/alerts/${id}/ack`, { note: 'Our own year-end backup' }, T)).status, 200);
  assert.equal((await api('GET', '/api/security/alerts/count', undefined, T)).body.open, list.open - 1);
  assert.ok((await api('GET', '/api/platform/alerts')).body.alerts.some((a: { rule: string }) => a.rule === 'failed_signins_ip'));
  // files: encrypted in the database, read back as they were; older plain files encrypted at start-up
  const lg = await app.inject({ method: 'POST', url: '/api/tenant/logo', payload: Buffer.from('89504e470d0a1a0a0000000d49484452aabbccdd', 'hex'), headers: { cookie: adminCookie, 'x-tenant-id': T, 'content-type': 'application/octet-stream' } });
  assert.equal(lg.statusCode, 200, lg.body);
  const raw = (await pq(`SELECT d.data FROM document d JOIN tenant t ON t.logo_id = d.id WHERE t.id = $1`, [T])).rows[0].data as Buffer;
  assert.equal(raw.subarray(0, 4).toString(), 'EKF1');
  const back = await app.inject({ method: 'GET', url: '/api/tenant/logo', headers: { cookie: adminCookie, 'x-tenant-id': T } });
  assert.equal(back.rawPayload.toString('hex'), '89504e470d0a1a0a0000000d49484452aabbccdd');
  await pq(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data) VALUES ($1,'vault','old.txt','text/plain',5,'x-old-plain','hello')`, [T]);
  const { encryptStoredFiles } = await import('../src/db/setup.js');
  assert.ok(await encryptStoredFiles() >= 1);
  const old = (await pq(`SELECT data FROM document WHERE sha256 = 'x-old-plain'`)).rows[0].data as Buffer;
  const { openFile } = await import('../src/lib/secrets.js');
  assert.equal(old.subarray(0, 4).toString(), 'EKF1'); assert.equal(openFile(old).toString(), 'hello');
  assert.equal(await encryptStoredFiles(), 0, 'all encrypted');
});

test('platform admins sign in with Ekobon\'s identity provider; password refused except break-glass with MFA', async () => {
  const { config } = await import('../src/config.js');
  const { generateKeyPairSync, createSign } = await import('node:crypto');
  const { codeAt, stepNow } = await import('../src/lib/totp.js');
  const Fastify = (await import('fastify')).default;
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const idp = Fastify(); let iss = '';
  idp.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, b, done) => done(null, Object.fromEntries(new URLSearchParams(String(b)))));
  idp.get('/.well-known/openid-configuration', async () => ({ issuer: iss, authorization_endpoint: `${iss}/authorize`, token_endpoint: `${iss}/token`, jwks_uri: `${iss}/keys` }));
  idp.get('/keys', async () => ({ keys: [{ ...key.publicKey.export({ format: 'jwk' }), kid: 'p1' }] }));
  idp.post('/token', async (req) => {
    const b = req.body as Record<string, string>, now = Math.floor(Date.now() / 1000);
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'p1' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss, aud: 'ekobon-ops', sub: 'x', exp: now + 300, iat: now, nonce: b.code, email: 'ops@ekobon.test', amr: ['pwd', 'mfa'] })).toString('base64url');
    return { id_token: `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(key.privateKey).toString('base64url')}` };
  });
  await idp.listen({ port: 0, host: '127.0.0.1' });
  iss = `http://127.0.0.1:${(idp.server.address() as { port: number }).port}`;
  const saved = config.platformSso;
  (config as { platformSso: unknown }).platformSso = { issuer: iss, clientId: 'ekobon-ops', clientSecret: 's', domains: ['ekobon.test'], only: true, breakGlass: ['glass@ekobon.test'] };
  try {
    // a company cannot claim the platform's domain
    assert.equal((await api('PUT', '/api/security/sso', { issuer: iss, clientId: 'x', domains: ['ekobon.test'], enabled: false, enforce: false, requireMfa: true }, tenantB)).status, 400);
    const st = await app.inject({ method: 'POST', url: '/api/auth/sso/start', payload: { email: 'ops@ekobon.test' } });
    const u = new URL(st.json().url);
    const cb = await app.inject({ method: 'GET', url: `/api/auth/sso/callback?code=${u.searchParams.get('nonce')}&state=${u.searchParams.get('state')}` });
    assert.equal(cb.headers.location, '/', String(cb.headers.location));
    const ck = String(cb.headers['set-cookie']).split(';')[0]!;
    const me = (await call(ck, 'GET', '/api/auth/me')).body.user;
    assert.deepEqual([me.role, me.via], ['platform_admin', 'sso']);
    // password: refused for platform admins…
    const pw = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ops@ekobon.test', password: 'correct horse battery' } });
    assert.equal(pw.json().error, 'SSO_REQUIRED');
    // …except a named break-glass account, and only with MFA
    const g = (await pq(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) SELECT NULL, 'glass@ekobon.test', 'Glass', 'platform_admin', password_hash, false FROM app_user WHERE email = 'ops@ekobon.test' RETURNING id`)).rows[0];
    assert.match((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'glass@ekobon.test', password: 'correct horse battery' } })).json().message, /multi-factor/);
    (config as { platformSso: unknown }).platformSso = null;
    const gl = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'glass@ekobon.test', password: 'correct horse battery' } })).headers['set-cookie']).split(';')[0]!;
    const su = (await call(gl, 'POST', '/api/auth/mfa/setup')).body;
    await call(gl, 'POST', '/api/auth/mfa/enable', { code: codeAt(su.secret, stepNow()) });
    (config as { platformSso: unknown }).platformSso = { issuer: iss, clientId: 'ekobon-ops', clientSecret: 's', domains: ['ekobon.test'], only: true, breakGlass: ['glass@ekobon.test'] };
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'glass@ekobon.test', password: 'correct horse battery' } })).json().mfa, true);
    void g;
  } finally { (config as { platformSso: unknown }).platformSso = saved; await idp.close(); }
});

test('metric registry (standard metrics, admin proposes → super admin approves, versions), collection calendar (required, applicability, evidence rule, exceptions), reminders and escalation (once each), inbox, sent-back notice; companies kept apart', async () => {
  const co = await api('POST', '/api/platform/companies', { name: 'Cycle Co', country: 'AE', superAdmin: { name: 'Cy Super', email: 'super@cycle.test' } });
  const T = co.body.company.id as string;
  const sa = await login('super@cycle.test', co.body.superAdmin.temporaryPassword);
  await call(sa, 'POST', '/api/auth/password', { current: co.body.superAdmin.temporaryPassword, next: 'a long enough pass' });
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const plant = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Cycle plant', facilityType: 'Plant' })).body.id as string;
  const office = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Cycle office', facilityType: 'Office' })).body.id as string;
  const mk = async (email: string, role: string, extra: object = {}) => {
    const r = await call(sa, 'POST', '/api/users', { name: email, email, role, ...extra });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ck = await login(email, r.body.temporaryPassword);
    await call(ck, 'POST', '/api/auth/password', { current: r.body.temporaryPassword, next: 'a long enough pass' });
    return { ck, id: r.body.user?.id ?? r.body.id };
  };
  const adm = await mk('cadm@cycle.test', 'admin', { scopeNodeId: group });
  const mgr = await mk('cmgr@cycle.test', 'manager', { facilityIds: [plant] });
  const prep = await mk('cprep@cycle.test', 'preparer', { facilityIds: [plant] });

  // the standard registry, one metric per category; everyone reads it, only admins change it
  const reg = (await call(prep.ck, 'GET', '/api/metrics')).body;
  assert.ok(reg.metrics.length >= 10, JSON.stringify(reg).slice(0, 300));
  const fuel = reg.metrics.find((m: { category_code: string }) => m.category_code === 'stationary_combustion');
  assert.equal(fuel.code, 'EKO-001'); assert.equal(fuel.unit, 'L'); assert.equal(fuel.version, 1);
  assert.equal(reg.canEdit, false);
  const body = (o: object) => ({ name: fuel.name, definition: fuel.definition, category_code: fuel.category_code, item_ids: [], unit: 'L', owner_user_id: null, facility_types: ['Plant'],
    facility_ids: [], required: true, source_system: 'Fuel delivery notes', methods: ['form', 'upload'], frequency: 'monthly', due_day: 5, due_months: 1, check_pct: 20, evidence: 'required', active: true, ...o });
  assert.equal((await call(prep.ck, 'POST', '/api/metrics', { ...body({}), id: fuel.id, reason: 'try' })).status, 403);
  // an admin proposes; the super admin approves (never their own); the version history keeps both
  const prop = await call(adm.ck, 'POST', '/api/metrics', { ...body({}), id: fuel.id, reason: 'Plants must report fuel every month, with delivery notes' });
  assert.equal(prop.status, 200, JSON.stringify(prop.body)); assert.equal(prop.body.pending, true);
  assert.equal((await call(adm.ck, 'POST', '/api/metrics', { ...body({ name: 'x2' }), id: fuel.id, reason: 'again' })).status, 409);
  assert.equal((await call(adm.ck, 'POST', `/api/metrics/changes/${prop.body.changeId}`, { decision: 'approve' })).status, 403);
  const ch = (await call(sa, 'GET', '/api/metrics')).body.changes.find((x: { id: string }) => x.id === prop.body.changeId);
  assert.deepEqual(ch.changes.required, [false, true]); assert.deepEqual(ch.changes.evidence, ['optional', 'required']);
  assert.ok((await call(sa, 'GET', '/api/inbox')).body.notifications.some((n: { kind: string }) => n.kind === 'metric_change'));
  const ok = await call(sa, 'POST', `/api/metrics/changes/${prop.body.changeId}`, { decision: 'approve' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.version, 2);
  const hist = (await call(prep.ck, 'GET', `/api/metrics/${fuel.id}/history`)).body.versions;
  assert.equal(hist.length, 2); assert.equal(hist[0].approved_by, 'Cy Super'); assert.equal(hist[0].changed_by, 'cadm@cycle.test'); assert.match(hist[0].reason, /every month/);
  assert.ok((await call(adm.ck, 'GET', '/api/inbox')).body.notifications.some((n: { kind: string; title: string }) => n.kind === 'metric_decision' && /approved/.test(n.title)));
  // a new metric gets the next code; unknown items are refused
  const elec = (await call(sa, 'GET', '/api/metrics')).body.categories.find((c: { code: string }) => c.code === 'purchased_electricity');
  assert.equal((await call(sa, 'POST', '/api/metrics', { ...body({ name: 'Grid power', category_code: 'purchased_electricity', item_ids: [999999], unit: 'kWh_e' }), reason: 'split' })).status, 400);
  const nw = await call(sa, 'POST', '/api/metrics', { ...body({ name: 'Grid power', category_code: 'purchased_electricity', item_ids: [elec.items[0].id], unit: 'MWh_e', required: false, evidence: 'optional' }), reason: 'Grid electricity on its own' });
  assert.equal(nw.status, 200, JSON.stringify(nw.body)); assert.match(nw.body.code, /^EKO-0\d\d$/); assert.equal(nw.body.pending, false);

  // calendar 2025: the plant owes fuel every month (required, Plant only); the office does not
  const id = await diesel();
  const e = (m: string, q = 100) => ({ facilityId: plant, itemId: id, quantity: q, unit: 'L', periodStart: `2025-${m}-01`, periodEnd: `2025-${m}-28` });
  const jan = (await call(prep.ck, 'POST', '/api/activities', e('01', 1000))).body.id, feb = (await call(prep.ck, 'POST', '/api/activities', e('02', 2))).body.id;
  // evidence required by the registry: no submission without it
  const sub = (await call(prep.ck, 'POST', '/api/activities/review', { ids: [jan], action: 'submit' })).body;
  assert.equal(sub.done, 0); assert.match(sub.skipped[0].reason, /EKO-001 needs evidence/);
  assert.equal((await call(sa, 'POST', '/api/metrics', { ...body({ evidence: 'optional' }), id: fuel.id, reason: 'Evidence checked at year end instead' })).body.version, 3);
  assert.equal((await call(prep.ck, 'POST', '/api/activities/review', { ids: [jan, feb], action: 'submit' })).body.done, 2);
  // the metric's own check limit (±20%) is used on Approvals
  assert.equal((await call(mgr.ck, 'POST', '/api/activities/review', { ids: [jan], action: 'approve' })).body.done, 1);
  const ap = (await call(mgr.ck, 'GET', '/api/approvals')).body.mine.find((x: { id: string }) => x.id === feb);
  assert.match(ap.check.txt, /limit ±20%/); assert.equal(ap.metric, 'EKO-001');
  // sent back: the preparer hears about it
  await call(mgr.ck, 'POST', '/api/activities/review', { ids: [feb], action: 'return', note: '2 litres is a typo?' });
  const pin = (await call(prep.ck, 'GET', '/api/inbox')).body;
  assert.ok(pin.notifications.some((n: { kind: string; body: string }) => n.kind === 'returned' && /typo/.test(n.body)));
  assert.equal(pin.returned.length, 1);
  // a month not owed: excused with a reason (manager of the facility; not the preparer)
  assert.equal((await call(prep.ck, 'POST', '/api/calendar/exception', { facilityId: plant, metricId: fuel.id, period: '2025-03-01', reason: 'shut' })).status, 403);
  assert.equal((await call(mgr.ck, 'POST', '/api/calendar/exception', { facilityId: plant, metricId: fuel.id, period: '2025-03-01', reason: 'Plant shut for maintenance' })).status, 200);
  const cal = (await call(sa, 'GET', '/api/calendar?year=2025')).body;
  const ob = (p: string, f = plant, m = fuel.id) => cal.obligations.find((o: { facilityId: string; metricId: string; period: string }) => o.facilityId === f && o.metricId === m && o.period === p);
  assert.equal(ob('2025-01-01').status, 'approved'); assert.equal(ob('2025-01-01').due, '2025-02-05'); assert.equal(ob('2025-01-01').quantity, 1000); assert.equal(ob('2025-01-01').unit, 'L');
  assert.equal(ob('2025-02-01').status, 'in_progress');
  assert.equal(ob('2025-03-01').status, 'excused'); assert.match(ob('2025-03-01').exception.reason, /maintenance/);
  assert.equal(ob('2025-04-01').status, 'missing'); assert.equal(ob('2025-04-01').timing, 'escalated');
  assert.deepEqual(ob('2025-04-01').responsible.map((p: { name: string }) => p.name), ['cprep@cycle.test']);
  assert.deepEqual(ob('2025-04-01').escalateTo.map((p: { name: string }) => p.name).sort(), ['cadm@cycle.test', 'cmgr@cycle.test']);
  assert.equal(ob('2025-04-01', office), undefined, 'fuel applies to plants only');
  assert.equal(cal.obligations.filter((o: { facilityId: string; metricId: string }) => o.facilityId === plant && o.metricId === fuel.id).length, 12);
  // the preparer sees only their facility; the office has nothing owed
  assert.ok((await call(prep.ck, 'GET', '/api/calendar?year=2025')).body.obligations.every((o: { facilityId: string }) => o.facilityId === plant));

  // reminders on 3 March 2026: Feb is due soon, Jan and late 2025 months are overdue and escalated — once each
  const { tenantTx } = await import('../src/db/pool.js');
  const rem = await import('../src/lib/reminders.js');
  const now = new Date('2026-03-03T08:00:00Z');
  const r1 = await tenantTx(T, (c) => rem.remindTenant(c, T, now));
  assert.ok(r1.due_soon >= 1 && r1.overdue >= 1 && r1.escalated >= 1, JSON.stringify(r1));
  const r2 = await tenantTx(T, (c) => rem.remindTenant(c, T, now));
  assert.deepEqual([r2.due_soon, r2.overdue, r2.escalated], [0, 0, 0]);
  const kinds = async (ck: string) => (await call(ck, 'GET', '/api/inbox')).body.notifications.map((n: { kind: string }) => n.kind);
  assert.ok((await kinds(prep.ck)).includes('reminder') && (await kinds(prep.ck)).includes('overdue'));
  assert.ok((await kinds(mgr.ck)).includes('escalated') && (await kinds(adm.ck)).includes('escalated'));
  assert.ok(!(await kinds(mgr.ck)).includes('overdue'), 'the manager is told by escalation, not as the person responsible');
  // e-mail: no mail server here, so messages are held (nothing leaves); one per person and kind
  const mail = await tenantTx(T, async (c) => (await c.query(`SELECT to_email, status, subject FROM email_outbox WHERE tenant_id = $1`, [T])).rows);
  assert.ok(mail.length >= 4 && mail.every((m) => m.status === 'held'), JSON.stringify(mail));
  assert.equal(mail.filter((m) => m.to_email === 'cprep@cycle.test' && /overdue/.test(m.subject)).length, 1);
  // by hand from the calendar: once a day
  const key = `${plant}:${fuel.id}:2025-04-01`;
  assert.equal((await call(prep.ck, 'POST', '/api/calendar/remind', { keys: [key] })).status, 403);
  assert.equal((await call(mgr.ck, 'POST', '/api/calendar/remind', { keys: [key] })).body.sent, 1);
  assert.equal((await call(mgr.ck, 'POST', '/api/calendar/remind', { keys: [key] })).body.skipped, 1);
  // switched off: nothing sent
  assert.equal((await call(adm.ck, 'PUT', '/api/calendar/settings', { reminders: false })).status, 403);
  await call(sa, 'PUT', '/api/calendar/settings', { reminders: false });
  assert.equal((await tenantTx(T, (c) => rem.remindTenant(c, T, new Date('2026-06-20T08:00:00Z')))).skipped, 'reminders are switched off');
  // inbox: read, e-mails off
  const ib = (await call(prep.ck, 'GET', '/api/inbox')).body;
  assert.ok(ib.unread > 0);
  assert.equal((await call(prep.ck, 'GET', '/api/inbox/count')).body.unread, ib.unread);
  await call(prep.ck, 'POST', '/api/inbox/read', { all: true });
  assert.equal((await call(prep.ck, 'GET', '/api/inbox')).body.unread, 0);
  assert.equal((await call(prep.ck, 'PUT', '/api/inbox/settings', { emailNotify: false })).body.emailNotify, false);
  // data quality: the metric's check limit
  const qc = (await call(sa, 'GET', '/api/reports/quality?year=2025')).body.checks;
  assert.ok(qc.some((x: { id: string }) => x.id === 'reqev'));
  // companies kept apart
  const other = (await api('GET', '/api/metrics', undefined, tenantB)).body;
  assert.ok(!other.metrics.some((m: { id: string }) => m.id === fuel.id));
  assert.equal((await api('GET', `/api/metrics/${fuel.id}/history`, undefined, tenantB)).status, 404);
  assert.ok(!(await api('GET', '/api/calendar?year=2025', undefined, tenantB)).body.obligations.some((o: { facilityId: string }) => o.facilityId === plant));
});

test('base-year restatement: second-person approval, significance threshold alone and cumulative, restated base year in dashboards by view, reports and verifier pack; companies kept apart', async () => {
  const co = await api('POST', '/api/platform/companies', { name: 'Restate Co', country: 'AE', superAdmin: { name: 'Rita Super', email: 'super@restate.test' } });
  const T = co.body.company.id as string;
  let sa = await login('super@restate.test', co.body.superAdmin.temporaryPassword);
  await call(sa, 'POST', '/api/auth/password', { current: co.body.superAdmin.temporaryPassword, next: 'a long enough pass' });
  sa = await login('super@restate.test', 'a long enough pass');
  await call(sa, 'PATCH', '/api/tenant', { baseYear: 2025 });
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const p1 = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Keep plant' })).body.id as string;
  const p2 = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Sold plant' })).body.id as string;
  const id = await diesel();
  const ids: string[] = [];
  for (const [f, q] of [[p1, 3000], [p2, 1000]] as [string, number][]) ids.push((await call(sa, 'POST', '/api/activities', { facilityId: f, itemId: id, quantity: q, unit: 'L', periodStart: '2025-03-01', periodEnd: '2025-03-31' })).body.id);
  await call(sa, 'POST', '/api/activities/review', { ids, action: 'submit' });
  assert.equal((await call(sa, 'POST', '/api/activities/review', { ids, action: 'approve' })).body.done, 2, 'a one-person company approves its own (self-reviewed)');
  const ad = await call(sa, 'POST', '/api/users', { name: 'Rex Admin', email: 'admin@restate.test', role: 'admin', scopeNodeId: group });
  let adm = await login('admin@restate.test', ad.body.temporaryPassword);
  await call(adm, 'POST', '/api/auth/password', { current: ad.body.temporaryPassword, next: 'a long enough pass' });
  adm = await login('admin@restate.test', 'a long enough pass');

  const r0 = (await call(adm, 'GET', '/api/restatements')).body;
  assert.equal(r0.baseYear, 2025); assert.equal(r0.threshold, 5); assert.ok(r0.measured.total > 0); assert.equal(r0.restated.total, r0.measured.total);
  const sold = (await call(adm, 'GET', `/api/restatements/facility/${p2}`)).body;
  assert.ok(Math.abs(sold.total / r0.measured.total - 0.25) < 0.01, 'the sold plant is a quarter of the base year');
  // the admin records the sale; nobody approves their own; a reason is needed to reject
  const prop = await call(adm, 'POST', '/api/restatements', { trigger: 'divestment', title: 'Sale of the second plant', facilityId: p2, s1: -sold.s1, s2: -sold.s2, s3: -sold.s3, effective: '2026-06-30' });
  assert.equal(prop.status, 200, JSON.stringify(prop.body));
  assert.equal((await call(adm, 'POST', `/api/restatements/${prop.body.id}/decide`, { decision: 'approve' })).status, 403);
  assert.equal((await call(sa, 'POST', `/api/restatements/${prop.body.id}/decide`, { decision: 'reject' })).status, 400);
  assert.ok((await call(sa, 'GET', '/api/inbox')).body.restatements >= 1);
  const ok = (await call(sa, 'POST', `/api/restatements/${prop.body.id}/decide`, { decision: 'approve' })).body;
  assert.equal(ok.applied, true); assert.ok(ok.pct > 20);
  const r1 = (await call(sa, 'GET', '/api/restatements')).body;
  assert.ok(Math.abs(r1.restated.total - r0.measured.total * 0.75) < 0.01 * r0.measured.total, JSON.stringify(r1.restated));
  // dashboards: the whole company uses the restated base year; a view of the kept plant is unchanged; of the sold plant, close to zero
  const dash = async (node?: string) => (await call(sa, 'GET', `/api/dashboard?year=2026${node ? `&node=${node}` : ''}`)).body;
  const whole = await dash();
  assert.ok(Math.abs(whole.baseYear.total - r1.restated.total) < 0.01, `${whole.baseYear.total} vs ${r1.restated.total}`);
  assert.equal(whole.restated.items.length, 1);
  const bm = whole.baseMonthly.reduce((a: number, m: { s1: number; s2: number; s3: number }) => a + m.s1 + m.s2 + m.s3, 0);
  assert.ok(Math.abs(bm - r1.restated.total) < 0.01, 'the monthly base year (target paths, KPIs) adds up to the restated total');
  assert.ok(Math.abs((await dash(p1)).baseYear.total - (r0.measured.total - sold.total)) < 0.01);
  assert.equal((await dash(p1)).restated, null);
  assert.ok(Math.abs((await dash(p2)).baseYear.total) < 0.01);
  // below the threshold: recorded; the next one takes the net change over it and both are applied
  const small = (await call(adm, 'POST', '/api/restatements', { trigger: 'method', title: 'Refrigerant method improved', s1: r1.restated.total * 0.02 })).body.id;
  const s1 = (await call(sa, 'POST', `/api/restatements/${small}/decide`, { decision: 'approve' })).body;
  assert.equal(s1.applied, false); assert.ok(s1.pct < 5);
  assert.equal((await call(sa, 'GET', '/api/restatements')).body.recorded.n, 1);
  const more = (await call(adm, 'POST', '/api/restatements', { trigger: 'error', title: 'Missing generator found', s1: r1.restated.total * 0.035 })).body.id;
  const s2 = (await call(sa, 'POST', `/api/restatements/${more}/decide`, { decision: 'approve' })).body;
  assert.equal(s2.applied, true); assert.equal(s2.alsoApplied, 1); assert.ok(s2.cumulativePct >= 5);
  const r2 = (await call(sa, 'GET', '/api/restatements')).body;
  assert.equal(r2.recorded.n, 0);
  assert.ok(Math.abs(r2.restated.total - r1.restated.total * 1.055) < 0.01 * r1.restated.total);
  // a rejected one changes nothing; withdrawn by its author only
  const bad = (await call(adm, 'POST', '/api/restatements', { trigger: 'other', title: 'Guess', s3: 999 })).body.id;
  assert.equal((await call(sa, 'POST', `/api/restatements/${bad}/decide`, { decision: 'reject', note: 'No evidence' })).body.status, 'rejected');
  const wd = (await call(adm, 'POST', '/api/restatements', { trigger: 'other', title: 'Typo entry', s3: 1 })).body.id;
  assert.equal((await call(sa, 'DELETE', `/api/restatements/${wd}`)).status, 404);
  assert.equal((await call(adm, 'DELETE', `/api/restatements/${wd}`)).status, 200);
  assert.ok(Math.abs((await call(sa, 'GET', '/api/restatements')).body.restated.total - r2.restated.total) < 1e-6);
  // threshold: super admin only
  assert.equal((await call(adm, 'PUT', '/api/restatements/settings', { threshold: 3 })).status, 403);
  assert.equal((await call(sa, 'PUT', '/api/restatements/settings', { threshold: 3 })).status, 200);
  // reports and verifier pack carry the history; the audit log has each step
  const rs = (await call(sa, 'GET', '/api/reports/settings')).body;
  assert.equal(rs.restatements.length, 3); assert.equal(rs.restatements.filter((x: { applied: boolean }) => x.applied).length, 3); assert.equal(rs.restateThreshold, 3);
  const pack = (await call(sa, 'GET', '/api/assurance/pack?year=2026')).body;
  assert.equal(pack.restatements.length, 4, 'approved and rejected');
  // companies kept apart
  assert.ok(!(await api('GET', '/api/restatements', undefined, tenantB)).body.items.some((x: { id: string }) => x.id === prop.body.id));
  assert.equal((await api('POST', `/api/restatements/${bad}/decide`, { decision: 'approve' }, tenantB)).status, 404);
});

test('self-approval: off by default; when on, super admin / admin / manager approve their own with a note, below the size limit, marked self-reviewed; preparers and platform staff never approve', async () => {
  const co = await api('POST', '/api/platform/companies', { name: 'Self Co', country: 'AE', superAdmin: { name: 'Sam Super', email: 'super@self.test' } });
  const T = co.body.company.id as string;
  let sa = await login('super@self.test', co.body.superAdmin.temporaryPassword);
  await call(sa, 'POST', '/api/auth/password', { current: co.body.superAdmin.temporaryPassword, next: 'a long enough pass' });
  sa = await login('super@self.test', 'a long enough pass');
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const fac = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Self plant' })).body.id as string;
  const mk = async (email: string, role: string) => {
    const r = await call(sa, 'POST', '/api/users', { name: email, email, role, facilityIds: [fac] });
    const ck = await login(email, r.body.temporaryPassword);
    await call(ck, 'POST', '/api/auth/password', { current: r.body.temporaryPassword, next: 'a long enough pass' });
    return login(email, 'a long enough pass');
  };
  const mgr = await mk('smgr@self.test', 'manager'), prep = await mk('sprep@self.test', 'preparer');
  const id = await diesel();
  const entry = async (ck: string, q: number) => {
    const a = (await call(ck, 'POST', '/api/activities', { facilityId: fac, itemId: id, quantity: q, unit: 'L', periodStart: '2025-05-01', periodEnd: '2025-05-31' })).body.id as string;
    await call(ck, 'POST', '/api/activities/review', { ids: [a], action: 'submit' });
    return a;
  };
  const small = await entry(mgr, 100), big = await entry(mgr, 5000), theirs = await entry(prep, 100);
  // off by default: nobody approves their own; platform staff approve nothing
  assert.equal((await call(mgr, 'POST', '/api/activities/review', { ids: [small], action: 'approve' })).body.skipped[0].reason, 'nobody approves their own entry');
  assert.equal((await api('POST', '/api/activities/review', { ids: [theirs], action: 'approve' }, T)).body.skipped[0].reason, 'platform staff do not approve company data');
  assert.equal((await api('GET', '/api/approvals', undefined, T)).body.mine.length, 0);
  // switched on by the super admin, up to 1 tCO2e
  const st = (await call(sa, 'GET', '/api/approvals')).body.settings;
  assert.equal(st.selfApproval, false);
  assert.equal((await call(mgr, 'PUT', '/api/approvals/settings', { ...st, selfApproval: true })).status, 403);
  assert.equal((await call(sa, 'PUT', '/api/approvals/settings', { ...st, selfApproval: true, selfMaxT: 1 })).status, 200);
  const ap = (await call(mgr, 'GET', '/api/approvals')).body;
  assert.ok(ap.mine.some((x: { id: string; self: boolean }) => x.id === small && x.self));
  assert.ok(!ap.mine.some((x: { id: string }) => x.id === big), 'above the size limit someone else approves');
  assert.match((await call(mgr, 'POST', '/api/activities/review', { ids: [small], action: 'approve' })).body.skipped[0].reason, /needs a note/);
  assert.equal((await call(mgr, 'POST', '/api/activities/review', { ids: [small], action: 'approve', note: 'Checked against the May delivery notes' })).body.done, 1);
  assert.match((await call(mgr, 'POST', '/api/activities/review', { ids: [big], action: 'approve', note: 'x' })).body.skipped[0].reason, /self-approval is not allowed/);
  // a preparer never approves, even with self-approval on
  const pe = await entry(prep, 50);
  assert.equal((await call(prep, 'POST', '/api/activities/review', { ids: [pe], action: 'approve', note: 'x' })).body.skipped[0].reason, 'you cannot approve data for this facility');
  // marked and reported
  const row = await tenantRow(T, `SELECT self_reviewed, self_review_note FROM activity WHERE id = $1`, [small]);
  assert.equal(row.self_reviewed, true); assert.match(row.self_review_note, /delivery notes/);
  const q = (await call(sa, 'GET', '/api/reports/quality?year=2025')).body.checks.find((c: { id: string }) => c.id === 'self');
  assert.equal(q.n, 1); assert.match(q.items[0], /smgr@self.test · “Checked against the May delivery notes”/);
  assert.equal((await call(sa, 'GET', '/api/assurance/pack?year=2025')).body.totals.self, 1);
});
const tenantRow = async (T: string, sql: string, params: unknown[]) => {
  const { tenantTx } = await import('../src/db/pool.js');
  return tenantTx(T, async (c) => (await c.query(sql, params)).rows[0]);
};

test('carbon credits: lots, retirements from delivered credits only, second-person approval, net after credits beside gross, removals only for neutralisation, reports and verifier pack; companies kept apart', async () => {
  const co = await api('POST', '/api/platform/companies', { name: 'Credit Co', country: 'AE', superAdmin: { name: 'Cara Super', email: 'super@credit.test' } });
  let sa = await login('super@credit.test', co.body.superAdmin.temporaryPassword);
  await call(sa, 'POST', '/api/auth/password', { current: co.body.superAdmin.temporaryPassword, next: 'a long enough pass' });
  sa = await login('super@credit.test', 'a long enough pass');
  await call(sa, 'PATCH', '/api/tenant', { baseYear: 2025 });
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const p1 = (await call(sa, 'POST', '/api/org/nodes', { parentId: group, kind: 'facility', name: 'Credit plant' })).body.id as string;
  const a = (await call(sa, 'POST', '/api/activities', { facilityId: p1, itemId: await diesel(), quantity: 40000, unit: 'L', periodStart: '2025-03-01', periodEnd: '2025-03-31' })).body.id;
  await call(sa, 'POST', '/api/activities/review', { ids: [a], action: 'submit' });
  await call(sa, 'POST', '/api/activities/review', { ids: [a], action: 'approve' });
  const ad = await call(sa, 'POST', '/api/users', { name: 'Cal Admin', email: 'admin@credit.test', role: 'admin', scopeNodeId: group });
  let adm = await login('admin@credit.test', ad.body.temporaryPassword);
  await call(adm, 'POST', '/api/auth/password', { current: ad.body.temporaryPassword, next: 'a long enough pass' });
  adm = await login('admin@credit.test', 'a long enough pass');
  const mg = await call(sa, 'POST', '/api/users', { name: 'Max Manager', email: 'mgr@credit.test', role: 'manager', facilityIds: [p1] });
  let man = await login('mgr@credit.test', mg.body.temporaryPassword);
  await call(man, 'POST', '/api/auth/password', { current: mg.body.temporaryPassword, next: 'a long enough pass' });
  man = await login('mgr@credit.test', 'a long enough pass');

  const g0 = (await call(adm, 'GET', '/api/credits?year=2025')).body;
  assert.ok(g0.summary.gross.total > 50, JSON.stringify(g0.summary.gross)); assert.equal(g0.summary.retired, 0); assert.equal(g0.summary.net, g0.summary.gross.total);
  const lot = { project: 'Test landfill gas', registry: 'Gold Standard', category: 'avoidance', vintage: 2024, quantity: 50, price: 10 };
  assert.equal((await call(man, 'POST', '/api/credits/lots', lot)).status, 403, 'managers do not record credits');
  const av = (await call(adm, 'POST', '/api/credits/lots', lot)).body.id as string;
  const rm = (await call(adm, 'POST', '/api/credits/lots', { ...lot, project: 'Test biochar', registry: 'Puro.earth', category: 'removal_technical', quantity: 20, price: 150, status: 'delivered', deliveredOn: '2026-01-10' })).body.id as string;
  // contracted credits cannot be retired; delivered ones up to what is available
  const ret = (id: string, b: Record<string, unknown>, ck = adm) => call(ck, 'POST', `/api/credits/lots/${id}/retire`, { quantity: 10, retiredOn: '2026-03-01', claimYear: 2025, purpose: 'voluntary', ...b });
  assert.equal((await ret(av, {})).status, 400);
  assert.equal((await call(adm, 'PUT', `/api/credits/lots/${av}`, { ...lot, status: 'delivered', deliveredOn: '2026-02-01' })).status, 200);
  assert.equal((await ret(av, { quantity: 51 })).status, 400);
  assert.match(JSON.stringify((await ret(av, { purpose: 'neutralisation' })).body), /removals/);
  const r1 = (await ret(av, { quantity: 30 })).body.id as string;
  const r2 = (await ret(rm, { quantity: 5, purpose: 'neutralisation' })).body.id as string;
  assert.equal((await ret(av, { quantity: 25 })).status, 400, 'waiting retirements hold their credits');
  // only approved retirements count; the recorder and platform staff do not approve; a reason to reject
  assert.equal((await call(adm, 'GET', '/api/credits?year=2025')).body.summary.retired, 0);
  assert.ok((await call(sa, 'GET', '/api/inbox')).body.credits >= 2);
  assert.equal((await call(adm, 'POST', `/api/credits/retirements/${r1}/decide`, { decision: 'approve' })).status, 403);
  assert.equal((await api('POST', `/api/credits/retirements/${r1}/decide`, { decision: 'approve' }, co.body.company.id)).status, 403);
  assert.equal((await call(sa, 'POST', `/api/credits/retirements/${r1}/decide`, { decision: 'reject' })).status, 400);
  assert.equal((await call(sa, 'POST', `/api/credits/retirements/${r1}/decide`, { decision: 'approve' })).body.status, 'approved');
  assert.equal((await call(sa, 'POST', `/api/credits/retirements/${r2}/decide`, { decision: 'approve' })).body.status, 'approved');
  const g1 = (await call(man, 'GET', '/api/credits?year=2025')).body;
  assert.equal(g1.summary.retired, 35); assert.ok(Math.abs(g1.summary.net - (g0.summary.gross.total - 35)) < 1e-6);
  assert.equal(g1.summary.gross.total, g0.summary.gross.total, 'gross emissions are never changed by credits');
  assert.equal(g1.summary.byCategory.avoidance, 30); assert.equal(g1.summary.byCategory.removal_technical, 5); assert.ok(Math.abs(g1.summary.removalShare - 5 / 35) < 1e-9);
  assert.equal(g1.lots.find((l: { id: string }) => l.id === av).available, 20);
  assert.equal(g1.canEdit, false);
  // a lot in use keeps its quantity and cannot be removed; withdrawn by its author only
  assert.equal((await call(adm, 'PUT', `/api/credits/lots/${av}`, { ...lot, quantity: 20, status: 'delivered' })).status, 400);
  assert.equal((await call(adm, 'DELETE', `/api/credits/lots/${av}`)).status, 409);
  const r3 = (await ret(av, { quantity: 1 })).body.id as string;
  assert.equal((await call(sa, 'DELETE', `/api/credits/retirements/${r3}`)).status, 404);
  assert.equal((await call(adm, 'DELETE', `/api/credits/retirements/${r3}`)).status, 200);
  // reports and the verifier pack list them; the audit log has each step
  assert.equal((await call(sa, 'GET', '/api/reports/settings')).body.credits.length, 2);
  assert.equal((await call(sa, 'GET', '/api/assurance/pack?year=2025')).body.credits.length, 2);
  assert.ok((await call(sa, 'GET', '/api/audit?q=credits')).status < 500);
  // companies kept apart
  assert.equal((await api('GET', '/api/credits?year=2025', undefined, tenantB)).body.lots.length, 0);
  assert.equal((await api('POST', `/api/credits/retirements/${r1}/decide`, { decision: 'reject', note: 'x' }, tenantB)).status, 404);
});

test('batch runs: every machine-API transfer logged (accepted, refused with reasons, failed calls), failure and quiet-system alerts, purchase-batch reconciliation against source control totals, retry of failed processing; companies kept apart', async () => {
  const { checkIntegrations } = await import('../src/lib/integrations.js');
  const sap = (await api('POST', '/api/api-keys', { name: 'Batch SAP', scopes: ['purchases'] }, tenantA)).body;
  const bms = (await api('POST', '/api/api-keys', { name: 'Batch BMS' }, tenantA)).body;
  const send = (k: string, path: string, body: unknown) => app.inject({ method: 'POST', url: path, payload: body as object, headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' } });
  const notes = async (re: RegExp) => (await pq(`SELECT n.title FROM notification n JOIN app_user u ON u.id = n.user_id WHERE n.tenant_id = $1 AND n.kind = 'integration' AND u.email = 'super@a.test'`, [tenantA])).rows.filter((r) => re.test(r.title)).length;
  // a failed call (no reference) is logged with its reason and tells the admins once an hour
  assert.equal((await send(sap.key, '/api/v1/purchases', { lines: [] })).statusCode, 400);
  assert.equal((await send(sap.key, '/api/v1/purchases', { lines: [] })).statusCode, 400);
  assert.equal(await notes(/Transfer failed: Batch SAP/), 1, 'one failure notice an hour');
  // lines with source control totals: 4 lines arrive, the source says 5
  const lines = Array.from({ length: 4 }, (_, i) => ({ date: '2024-05-10', description: 'Security guards monthly', amount: 1000, currency: 'AED', supplier: `Guard Co ${i}`, facility: 'Sharjah plant' }));
  const r = await send(sap.key, '/api/v1/purchases', { reference: 'BR-2024-05', lines, complete: true, control: { lines: 5, amounts: { AED: 4000 } } });
  assert.equal(r.statusCode, 200, r.body);
  // meter readings with one unknown meter: partial, the reason kept
  const m = await send(bms.key, '/api/v1/meter-readings', { readings: [{ meterId: 'NO-SUCH-METER', timestamp: '2024-05-01T00:00:00Z', value: 1 }] });
  assert.equal(m.statusCode, 200, m.body);
  await drain();
  const d = (await api('GET', '/api/batches?days=7', undefined, tenantA)).body;
  const runs = d.transfers.filter((t: { client: string }) => /^Batch (SAP|BMS)$/.test(t.client));
  assert.equal(runs.filter((t: { status: string }) => t.status === 'failed').length, 2);
  assert.ok(runs.find((t: { status: string; error: string }) => t.status === 'failed').error.length > 5);
  const part = runs.find((t: { client: string }) => t.client === 'Batch BMS');
  assert.equal(part.status, 'partial'); assert.equal(part.rejected, 1);
  const one = (await api('GET', `/api/batches/transfers/${part.id}`, undefined, tenantA)).body;
  assert.match(one.problems[0].reason, /unknown meterId/);
  const s = d.sources.find((x: { name: string }) => x.name === 'Batch SAP');
  assert.equal(s.failed, 2); assert.equal(s.health, 'warning', 'recovered, with failures in the last 24 hours');
  // reconciliation: the line count differs from the source; totals agree; fixed when the source corrects its count
  const b = d.batches.find((x: { external_ref: string }) => x.external_ref === 'BR-2024-05');
  assert.equal(b.recon, 'differences'); assert.equal(b.lines, 4);
  const rec = (await api('GET', `/api/batches/purchase/${b.id}`, undefined, tenantA)).body;
  assert.equal(rec.checks.find((c: { id: string }) => c.id === 'lines').ok, false);
  assert.equal(rec.checks.find((c: { id: string }) => c.id === 'amount:AED').ok, true);
  assert.equal(rec.runs.length, 1);
  assert.equal((await api('PUT', `/api/batches/purchase/${b.id}/control`, { control: { lines: 4 } }, tenantA)).status, 403, 'platform staff do not enter company figures');
  const nu = await api('POST', '/api/users', { name: 'Bea Admin', email: 'bea.admin@a.test', role: 'admin', scopeNodeId: (await api('GET', '/api/org', undefined, tenantA)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id }, tenantA);
  let adm = await login('bea.admin@a.test', nu.body.temporaryPassword);
  await call(adm, 'POST', '/api/auth/password', { current: nu.body.temporaryPassword, next: 'a long enough pass' });
  adm = await login('bea.admin@a.test', 'a long enough pass');
  assert.equal((await call(adm, 'PUT', `/api/batches/purchase/${b.id}/control`, { control: { lines: 4, amounts: { AED: 4000 } } })).status, 200);
  assert.notEqual((await api('GET', `/api/batches/purchase/${b.id}`, undefined, tenantA)).body.state, 'differences');
  // publish: every published line is in an entry with the same emissions
  await pq(`UPDATE purchase_line SET status = 'ready' WHERE batch_id = $1 AND status IN ('check', 'flagged')`, [b.id]);   // as if the reviewer confirmed them
  assert.equal((await call(adm, 'POST', `/api/purchases/batches/${b.id}/publish`, {})).status, 200);
  await drain();
  const after = (await api('GET', `/api/batches/purchase/${b.id}`, undefined, tenantA)).body;
  assert.equal(after.batch.status, 'published', JSON.stringify(after.outcomes));
  {
    assert.equal(after.checks.find((c: { id: string }) => c.id === 'entries').ok, true, JSON.stringify(after.checks));
    assert.equal(after.checks.find((c: { id: string }) => c.id === 'co2e').ok, true, JSON.stringify(after.checks));
  }
  // a system expected every hour that has gone quiet: one notice per gap
  assert.equal((await api('PUT', `/api/batches/sources/${bms.id}`, { expectHours: 1 }, tenantA)).status, 200);
  await pq(`UPDATE integration_run SET at = now() - interval '3 hours' WHERE api_key_id = $1`, [bms.id]);
  await checkIntegrations(); await checkIntegrations();
  assert.equal(await notes(/No data from Batch BMS/), 1);
  assert.equal((await api('GET', '/api/batches', undefined, tenantA)).body.sources.find((x: { name: string }) => x.name === 'Batch BMS').health, 'quiet');
  // failed processing runs again; a batch that did not fail does not
  const fb = (await pq(`INSERT INTO purchase_batch (tenant_id, source, name, settings, status, error) VALUES ($1, 'api', 'Broken', '{}', 'failed', 'boom') RETURNING id`, [tenantA])).rows[0].id;
  await pq(`INSERT INTO job (tenant_id, kind, ref, status, error) VALUES ($1, 'purchase_map', $2, 'failed', 'boom')`, [tenantA, fb]);
  assert.equal((await api('POST', `/api/batches/purchase/${b.id}/retry`, {}, tenantA)).status, 409);
  assert.equal((await api('POST', `/api/batches/purchase/${fb}/retry`, {}, tenantA)).status, 200);
  assert.equal((await pq(`SELECT count(*)::int AS n FROM job WHERE ref = $1 AND status = 'queued'`, [fb])).rows[0].n, 1);
  await drain();
  // companies kept apart
  const other = (await api('GET', '/api/batches', undefined, tenantB)).body;
  assert.ok(!other.transfers.some((t: { client: string }) => /^Batch /.test(t.client)));
  assert.equal((await api('GET', `/api/batches/transfers/${part.id}`, undefined, tenantB)).status, 404);
  assert.equal((await api('GET', `/api/batches/purchase/${b.id}`, undefined, tenantB)).status, 404);
});

test('supplier portal: invite with a one-time code, supplier signs in with e-mail + code, saves sections, uploads evidence, submits; company queries, then accepts — profile updated, intensity and product factors created and used; codes expire or are revoked; companies kept apart', async () => {
  const sup = (await api('POST', '/api/suppliers', { name: 'Portal Supplier LLC' }, tenantA)).body.id as string;
  const nu = await api('POST', '/api/users', { name: 'Sami Admin', email: 'sp.admin@a.test', role: 'admin', scopeNodeId: (await api('GET', '/api/org', undefined, tenantA)).body.nodes.find((n: { kind: string }) => n.kind === 'group').id }, tenantA);
  let adm = await login('sp.admin@a.test', nu.body.temporaryPassword);
  await call(adm, 'POST', '/api/auth/password', { current: nu.body.temporaryPassword, next: 'a long enough pass' });
  adm = await login('sp.admin@a.test', 'a long enough pass');
  const inv = await call(adm, 'POST', '/api/supplier-portal/requests', { supplierId: sup, year: 2025, email: 'Esg@Portal.example', contactName: 'Noor', message: 'Please share your 2025 data.' });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  assert.match(inv.body.code, /^[A-Z2-9]{10}$/);
  assert.equal((await call(adm, 'POST', '/api/supplier-portal/requests', { supplierId: sup, year: 2025, email: 'x@portal.example' })).status, 409);
  assert.equal((await pq(`SELECT count(*)::int AS n FROM email_outbox WHERE to_email = 'esg@portal.example' AND body LIKE '%' || $1 || '%'`, [inv.body.code])).rows[0].n, 1, 'invitation e-mail carries the code');
  assert.equal((await pq(`SELECT count(*)::int AS n FROM supplier_request WHERE code_hash = $1`, [inv.body.code])).rows[0].n, 0, 'only the hash is kept');
  // sign in: wrong code refused, right one (any case, spaces) accepted
  const pub = (method: string, path: string, body?: unknown, tok?: string) => app.inject({ method: method as 'GET', url: `/api/public/supplier${path}`, payload: body as object, headers: { ...(tok ? { 'x-supplier-token': tok } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) } });
  assert.equal((await pub('POST', '/login', { email: 'esg@portal.example', code: 'WRONGCODE2' })).statusCode, 401);
  const li = await pub('POST', '/login', { email: 'ESG@portal.example', code: ` ${inv.body.code.toLowerCase().slice(0, 5)} ${inv.body.code.toLowerCase().slice(5)} ` });
  assert.equal(li.statusCode, 200, li.body);
  const tok = li.json().token as string;
  assert.equal((await pub('GET', '/me')).statusCode, 401);
  const me = (await pub('GET', '/me', undefined, tok)).json();
  assert.equal(me.supplier, 'Portal Supplier LLC'); assert.equal(me.year, 2025); assert.equal(me.editable, true); assert.equal(me.progress.n, 0);
  // incomplete: cannot submit
  assert.equal((await pub('POST', '/submit', { name: 'Noor Ali', title: 'ESG lead', confirm: true }, tok)).statusCode, 400);
  const save = (section: string, data: unknown) => pub('PUT', '/answers', { section, data }, tok);
  assert.equal((await save('profile', { legalName: 'Portal Supplier LLC', country: 'AE', contactName: 'Noor Ali', industry: 'Logistics', size: 'medium' })).statusCode, 200);
  assert.equal((await save('inventory', { reports: 'yes', scope1: 1000, scope2Location: 600, scope2Market: 500, revenue: 10_000_000, currency: 'AED', verification: 'limited' })).statusCode, 200);
  assert.equal((await save('allocation', { method: 'revenue', customerRevenue: 1_000_000 })).statusCode, 200);
  assert.equal((await save('targets', { status: 'sbti_committed', targetYear: 2030, reductionPct: 42 })).statusCode, 200);
  assert.equal((await save('products', { items: [{ name: 'Pallet delivery', co2e: 2.5, unit: 'pcs', standard: 'ISO 14067', documentId: '00000000-0000-0000-0000-000000000000' }] })).statusCode, 400, 'documents must be uploaded first');
  const pdf = Buffer.from('%PDF-1.4\n% DEMO EPD\n');
  const up = await app.inject({ method: 'POST', url: '/api/public/supplier/evidence', payload: pdf, headers: { 'x-supplier-token': tok, 'content-type': 'application/octet-stream', 'x-filename': 'epd.pdf', 'x-kind': 'epd' } });
  assert.equal(up.statusCode, 200, up.body);
  const sv = await save('products', { items: [{ name: 'Pallet delivery', co2e: 2.5, unit: 'pcs', standard: 'ISO 14067', boundary: 'cradle-to-gate', verified: true, documentId: up.json().documentId }] });
  assert.equal(sv.json().progress.n, 5);
  assert.ok(Math.abs(sv.json().derived.intensity - 0.15) < 1e-9, 'kg CO2e per AED');
  assert.ok(Math.abs(sv.json().derived.allocated - 150) < 1e-9, 't for this customer');
  assert.equal((await pub('POST', '/submit', { name: 'Noor Ali', title: 'ESG lead', confirm: true }, tok)).statusCode, 200);
  assert.equal((await save('targets', { status: 'none' })).statusCode, 409, 'locked once submitted');
  // the company: listed, queried (a reason needed), resubmitted, accepted
  const list = (await call(adm, 'GET', '/api/supplier-portal?year=2025')).body;
  const rq = list.requests.find((r: { supplier: string }) => r.supplier === 'Portal Supplier LLC');
  assert.equal(rq.status, 'submitted'); assert.equal(rq.progress.n, 5);
  assert.equal((await call(adm, 'POST', `/api/supplier-portal/requests/${rq.id}/review`, { decision: 'query' })).status, 400);
  assert.equal((await call(adm, 'POST', `/api/supplier-portal/requests/${rq.id}/review`, { decision: 'query', note: 'Please add the verifier name' })).body.status, 'queried');
  assert.equal((await pub('GET', '/me', undefined, tok)).json().review_note, 'Please add the verifier name');
  assert.equal((await save('inventory', { reports: 'yes', scope1: 1000, scope2Location: 600, scope2Market: 500, revenue: 10_000_000, currency: 'AED', verification: 'limited', verifier: 'DEMO Verifier' })).statusCode, 200);
  assert.equal((await pub('POST', '/submit', { name: 'Noor Ali', title: 'ESG lead', confirm: true }, tok)).statusCode, 200);
  assert.equal((await api('POST', `/api/supplier-portal/requests/${rq.id}/review`, { decision: 'accept', intensity: { use: true } }, tenantA)).status, 403, 'platform staff do not accept company data');
  const acc = await call(adm, 'POST', `/api/supplier-portal/requests/${rq.id}/review`, { decision: 'accept', intensity: { use: true }, products: [{ index: 0 }] });
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.applied.factors.length, 2);
  const prof = (await call(adm, 'GET', `/api/suppliers/${sup}`)).body;
  const p = prof.supplier ?? prof;
  assert.equal(p.climate_target ?? p.climateTarget, 'sbti_committed'); assert.equal(p.country, 'AE');
  // the intensity is used for purchases from the supplier in 2025
  const dry = await call(adm, 'POST', '/api/purchases/manual', { facilityId: facA, dryRun: true, lines: [{ date: '2025-06-01', description: 'Freight services', amount: 10000, currency: 'AED', supplier: 'Portal Supplier LLC', itemId: await itemId('epa:naics:334111') }] });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.ok(Math.abs(dry.body.lines[0].co2e - 1500) < 15, `${dry.body.lines[0].co2e} kg from 10,000 AED × 0.15`);
  // the staff can open the evidence; the supplier sees the result; a revoked code no longer signs in
  const file = await app.inject({ method: 'GET', url: `/api/supplier-portal/documents/${up.json().documentId}`, headers: { cookie: adm } });
  assert.equal(file.statusCode, 200); assert.equal(file.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await pub('GET', '/me', undefined, tok)).json().status, 'accepted');
  assert.equal((await call(adm, 'POST', `/api/supplier-portal/requests/${rq.id}/revoke`, {})).status, 200);
  assert.equal((await pub('GET', '/me', undefined, tok)).statusCode, 401);
  assert.equal((await pub('POST', '/login', { email: 'esg@portal.example', code: inv.body.code })).statusCode, 401);
  // companies kept apart
  assert.equal((await api('GET', `/api/supplier-portal/requests/${rq.id}`, undefined, tenantB)).status, 404);
  assert.equal((await api('GET', `/api/supplier-portal/documents/${up.json().documentId}`, undefined, tenantB)).status, 404);
  assert.equal((await api('GET', '/api/supplier-portal?year=2025', undefined, tenantB)).body.requests.length, 0);
});

test('supplier engagement: add suppliers by hand (all fields, country names, duplicates refused) and from a list (preview, then add / complete), engagement stages, score and grade, SBTi list import and matching, export, engagement analytics and trajectories; companies kept apart', async () => {
  const raw = (path: string, buf: Buffer, tenant: string, name: string, cookie?: string) => app.inject({ method: 'POST', url: path, payload: buf, headers: { 'content-type': 'application/octet-stream', 'x-filename': name, ...(cookie ? { cookie } : { cookie: adminCookie, 'x-tenant-id': tenant }) } });
  // by hand
  const add = await api('POST', '/api/suppliers', { name: 'Hand Made Trading LLC', kind: 'prospect', reference: 'HM-1', country: 'United Arab Emirates', department: 'Facilities', cdpScore: 'B', climateTarget: 'own', target: { reductionPct: 40, baseYear: 2024, targetYear: 2030, netZeroYear: 2050 } }, tenantA);
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal((await api('POST', '/api/suppliers', { name: 'HAND MADE TRADING L.L.C.' }, tenantA)).status, 409, 'same name, other spelling');
  assert.equal((await api('POST', '/api/suppliers', { name: 'Other', reference: 'hm-1' }, tenantA)).status, 409, 'same internal code');
  assert.equal((await api('POST', '/api/suppliers', { name: 'Nowhere Co', country: 'Atlantis' }, tenantA)).status, 400);
  const prof = (await api('GET', `/api/suppliers/${add.body.id}`, undefined, tenantA)).body;
  assert.equal(prof.supplier.country, 'AE'); assert.equal(prof.supplier.kind, 'prospect'); assert.equal(prof.supplier.department, 'Facilities');
  assert.equal(prof.engagement.stage, 'not_engaged');
  // score: own target with numbers 10 + net zero 5, CDP B 11 = 26 → D
  assert.equal(prof.engagement.score, 26); assert.equal(prof.engagement.letter, 'D');
  assert.ok(prof.engagement.actions.some((a: string) => /SBTi|Science Based/i.test(a)));
  // from a list: preview, then commit; existing suppliers only get blanks filled
  const csv = Buffer.from('Supplier name,Internal code,Type,Country,Procurement department,Contact email\nList Supplier One,LS-1,current,India,IT,one@list.example\nHand Made Trading LLC,,,,,hm@hand.example\nBad Country Co,BC-1,,Narnia,,\nList Supplier One,LS-1,,,,\n');
  const pre = await raw('/api/suppliers/import?commit=0', csv, tenantA, 'list.csv');
  assert.equal(pre.statusCode, 200, pre.body);
  assert.deepEqual(pre.json().totals, { new: 1, update: 1, same: 1, error: 1 });
  assert.equal((await api('GET', '/api/suppliers?q=list%20supplier%20one', undefined, tenantA)).body.total, 0, 'preview adds nothing');
  const done = (await raw('/api/suppliers/import?commit=1', csv, tenantA, 'list.csv')).json();
  assert.equal(done.created, 1); assert.equal(done.updated, 1);
  const one = (await api('GET', '/api/suppliers?q=list%20supplier%20one', undefined, tenantA)).body.suppliers[0];
  assert.equal(one.country, 'IN'); assert.equal(one.department, 'IT'); assert.equal(one.stage, 'not_engaged');
  assert.equal((await api('GET', `/api/suppliers/${add.body.id}`, undefined, tenantA)).body.supplier.contact_email, 'hm@hand.example');
  // list filters: department, prospects hidden, engagement stage
  const it = (await api('GET', '/api/suppliers?department=IT', undefined, tenantA)).body;
  assert.ok(it.suppliers.every((x: { department: string }) => x.department === 'IT')); assert.ok(it.departments.includes('Facilities'));
  assert.ok(!(await api('GET', '/api/suppliers?kind=current&limit=200', undefined, tenantA)).body.suppliers.some((x: { id: string }) => x.id === add.body.id));
  await api('POST', '/api/supplier-portal/requests', { supplierId: one.id, year: 2025, email: 'one@list.example', sendEmail: false }, tenantA);
  const inv = (await api('GET', '/api/suppliers?stage=invited&limit=200', undefined, tenantA)).body;
  assert.ok(inv.suppliers.some((x: { id: string }) => x.id === one.id)); assert.ok((inv.stages.invited ?? 0) >= 1);
  // SBTi list: platform admin only; matched by name whatever the legal form
  const sb = Buffer.from('Company Name,Location,Sector,Near term - Target Status,Near term - Target Classification,Net-Zero Year\nList Supplier One Pvt Ltd,India,IT,Targets Set,1.5°C,2045\nSomeone Else,France,Food,Committed,,\n');
  assert.equal((await raw('/api/sbti/import', sb, tenantA, 'sbti.csv', await login('sp.admin@a.test', 'a long enough pass'))).statusCode, 403, 'company admins do not change the shared list');
  const imp = await raw('/api/sbti/import', sb, tenantA, 'sbti.csv');
  assert.equal(imp.statusCode, 200, imp.body); assert.equal(imp.json().rows, 2);
  const m = (await api('GET', `/api/suppliers/${one.id}`, undefined, tenantA)).body.engagement;
  assert.equal(m.sbtiList.status, 'Targets Set'); assert.equal(m.sbti, true, 'validated through the SBTi list');
  // export
  const ex = await app.inject({ method: 'GET', url: '/api/suppliers/export?year=2025', headers: { cookie: adminCookie, 'x-tenant-id': tenantA } });
  assert.equal(ex.statusCode, 200); assert.match(ex.body, /Internal code/); assert.match(ex.body, /List Supplier One/);
  // engagement analytics and trajectories (on the purchases of a year with a supplier)
  const e = (await api('GET', '/api/suppliers/engagement', undefined, tenantA)).body;
  assert.ok(Array.isArray(e.trajectory.years) && e.trajectory.years.at(-1) === 2050);
  if (e.suppliers) {
    const sum = (k: string) => e[k].reduce((a: number, r: { kg: number }) => a + r.kg, 0);
    assert.ok(Math.abs(sum('sbti') - e.total) < 1e-6 && Math.abs(sum('stages') - e.total) < 1e-6, 'every split adds up to the total');
    const r = e.trajectory.rows[0]; assert.equal(r.path[0], r.kg);
    assert.ok(e.trajectory.rows.every((x: { cred: string; path: number[] }) => x.cred !== 'weak' || x.path.every((v) => Math.abs(v - x.path[0]!) < 1e-9)), 'no target: flat');
  }
  // companies kept apart
  assert.equal((await api('GET', '/api/suppliers?q=hand%20made', undefined, tenantB)).body.total, 0);
  await pool.query(`DELETE FROM sbti_company; DELETE FROM sbti_import`);
});

test('supplier answers must agree (share for the customer within Scope 1+2, sales within revenue); staff keep documents on a supplier record', async () => {
  const sup = (await api('POST', '/api/suppliers', { name: 'Consistency Check Co' }, tenantA)).body.id as string;
  const inv = (await api('POST', '/api/supplier-portal/requests', { supplierId: sup, year: 2025, email: 'cc@consistency.example', sendEmail: false }, tenantA)).body;
  const pub = (method: string, path: string, body?: unknown, tok?: string) => app.inject({ method: method as 'GET', url: `/api/public/supplier${path}`, payload: body as object, headers: { ...(tok ? { 'x-supplier-token': tok } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) } });
  const tok = (await pub('POST', '/login', { email: 'cc@consistency.example', code: inv.code })).json().token as string;
  const save = (section: string, data: unknown) => pub('PUT', '/answers', { section, data }, tok);
  assert.equal((await save('inventory', { reports: 'yes', scope1: 300, scope2Location: 100, revenue: 1_000_000, currency: 'AED' })).statusCode, 200);
  // the user's case: 40,000 t "for BEEAH" against 400 t in total
  const big = await save('allocation', { method: 'direct', directT: 40000 });
  assert.equal(big.statusCode, 400); assert.match(big.json().message, /more than your whole company's Scope 1 \+ 2 \(400 tCO₂e\)/);
  assert.equal((await save('allocation', { method: 'revenue', customerRevenue: 2_000_000 })).statusCode, 400, 'sales above revenue');
  assert.equal((await save('allocation', { method: 'direct', directT: 40 })).statusCode, 200);
  // lowering the totals below a saved share is refused too
  assert.equal((await save('inventory', { reports: 'yes', scope1: 10, scope2Location: 5, revenue: 1_000_000, currency: 'AED' })).statusCode, 400);
  // documents on the supplier record (staff)
  const pdf = Buffer.from('%PDF-1.4\n% supplier report\n' + 'x'.repeat(300));
  const up = await app.inject({ method: 'POST', url: `/api/suppliers/${sup}/documents`, payload: pdf, headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream', 'x-filename': 'cdp-response.pdf', 'x-kind': 'cdp' } });
  assert.equal(up.statusCode, 200, up.body);
  const bad = await app.inject({ method: 'POST', url: `/api/suppliers/${sup}/documents`, payload: Buffer.from('MZ not a document at all'), headers: { cookie: adminCookie, 'x-tenant-id': tenantA, 'content-type': 'application/octet-stream', 'x-filename': 'x.exe' } });
  assert.equal(bad.statusCode, 400);
  // the supplier's own upload shows on the record too
  await app.inject({ method: 'POST', url: '/api/public/supplier/evidence', payload: pdf, headers: { 'x-supplier-token': tok, 'content-type': 'application/octet-stream', 'x-filename': 'report.pdf', 'x-kind': 'report' } });
  const docs = (await api('GET', `/api/suppliers/${sup}`, undefined, tenantA)).body.documents;
  assert.deepEqual(docs.map((d: { from: string; kind: string }) => `${d.from}:${d.kind}`).sort(), ['portal:report', 'staff:cdp']);
  assert.equal((await api('DELETE', `/api/suppliers/${sup}/documents/${up.json().id}`, undefined, tenantA)).status, 200);
  assert.equal((await api('GET', `/api/suppliers/${sup}`, undefined, tenantA)).body.documents.length, 1);
  assert.equal((await api('GET', `/api/suppliers/${sup}`, undefined, tenantB)).status, 404);
});

test('product LCA: inventory from the library and own values, BOM import, scenarios, second-person verification, publishing a supplier product as its factor; companies kept apart', async () => {
  const co = await api('POST', '/api/platform/companies', { name: 'LCA Co', country: 'AE', superAdmin: { name: 'Lia Super', email: 'super@lca.test' } });
  const T = co.body.company.id as string;
  const user = async (email: string, tmp: string) => { let c = await login(email, tmp); await call(c, 'POST', '/api/auth/password', { current: tmp, next: 'a long enough pass' }); c = await login(email, 'a long enough pass'); return c; };
  const sa = await user('super@lca.test', co.body.superAdmin.temporaryPassword);
  const group = (await call(sa, 'GET', '/api/org')).body.nodes.find((n: { kind: string }) => n.kind === 'group').id;
  const adm = await user('admin@lca.test', (await call(sa, 'POST', '/api/users', { name: 'Ada Admin', email: 'admin@lca.test', role: 'admin', scopeNodeId: group })).body.temporaryPassword);
  const man = await user('mgr@lca.test', (await call(sa, 'POST', '/api/users', { name: 'Mo Manager', email: 'mgr@lca.test', role: 'manager', scopeNodeId: group })).body.temporaryPassword);
  const sup = (await call(sa, 'POST', '/api/suppliers', { name: 'Billet Mill Test' })).body.id as string;

  const g0 = (await call(man, 'GET', '/api/lca')).body;
  assert.ok(g0.library.length >= 29 && g0.library.every((f: { indicative: boolean }) => f.indicative), 'shared indicative library');
  const lib = (code: string) => g0.library.find((f: { code: string }) => f.code === code);
  const scope = { name: 'Test billet', fu: '1 tonne of billet at the mill gate', declaredUnit: 't', refYear: 2025, supplierId: sup };
  assert.equal((await call(man, 'POST', '/api/lca/products', { ...scope, declaredUnit: 'AED' })).status, 400, 'a declared unit is a physical unit');
  const pid = (await call(man, 'POST', '/api/lca/products', scope)).body.id as string;
  const add = (b: Record<string, unknown>, ck = man) => call(ck, 'POST', `/api/lca/products/${pid}/inputs`, { dq: 'supplier', ...b });
  assert.equal((await add({ name: 'Steel', stage: 'raw', qty: 1, unit: 't', lciId: lib('steel_p').id })).status, 400, 'library factor per kg: amount in kg');
  const steel = (await add({ name: 'Primary steel', stage: 'raw', qty: 1000, unit: 'kg', lciId: lib('steel_p').id })).body.id as string;
  await add({ name: 'Mill electricity', stage: 'manufacturing', qty: 100, unit: 'kWh', co2ePerUnit: 0.5, dq: 'measured' });
  await add({ name: 'Disposal of slag', stage: 'eol', qty: 50, unit: 'kg', lciId: lib('landfill').id });
  assert.equal((await add({ name: 'No factor', stage: 'raw', qty: 1, unit: 'kg' })).status, 400);
  // import: blank factor matched by name (ties go to the higher factor), unknown lines skipped
  const text = 'input,stage,amount,unit,kgCO2e_per_unit\nCardboard,packaging,2,kg,\nRoad freight truck,transport,"1,000",t-km,\nMystery additive,raw,1,kg,\nDolomite,raw,10,kg,0.03';
  const pv = (await call(man, 'POST', `/api/lca/products/${pid}/import`, { text })).body;
  assert.equal(pv.ok, 3); assert.equal(pv.problems, 1); assert.equal(pv.lines[0].lciName, 'Corrugated cardboard'); assert.equal(pv.lines[1].qty, 1000);
  assert.equal((await call(man, 'POST', `/api/lca/products/${pid}/import`, { text, commit: true })).body.imported, 3);
  let det = (await call(man, 'GET', `/api/lca/products/${pid}`)).body;
  // 1000×2.1 + 100×0.5 + 2×0.9 + 1000×0.11 + 10×0.03 = 2262.1; end of life outside cradle-to-gate
  assert.ok(Math.abs(det.result.total - 2262.1) < 1e-6, String(det.result.total));
  assert.ok(Math.abs(det.result.excluded - 50 * 0.467) < 1e-6);
  assert.ok(Math.abs(det.result.stages.raw - 2100.3) < 1e-6);
  assert.equal(det.levers[0].to, 'Steel, recycled (EAF)'); assert.ok(Math.abs(det.levers[0].saves - 1400) < 1e-6);
  // scenario: recycled steel
  assert.equal((await call(man, 'POST', `/api/lca/products/${pid}/scenarios`, { name: 'Recycled steel', changes: [{ inputId: steel, lciId: lib('steel_r').id }] })).status, 200);
  det = (await call(man, 'GET', `/api/lca/products/${pid}`)).body;
  assert.ok(Math.abs(det.scenarios[0].total - 862.1) < 1e-6);
  // review: the author does not verify; managers and platform staff do not verify; a reason to return
  assert.equal((await call(man, 'POST', `/api/lca/products/${pid}/submit`, {})).status, 200);
  assert.equal((await call(man, 'POST', `/api/lca/products/${pid}/verify`, { decision: 'verify' })).status, 403);
  assert.equal((await api('POST', `/api/lca/products/${pid}/verify`, { decision: 'verify' }, T)).status, 403);
  assert.equal((await call(adm, 'POST', `/api/lca/products/${pid}/verify`, { decision: 'return' })).status, 400);
  assert.equal((await call(adm, 'POST', `/api/lca/products/${pid}/publish`, {})).status, 400, 'not verified yet');
  assert.equal((await call(adm, 'POST', `/api/lca/products/${pid}/verify`, { decision: 'verify' })).status, 200);
  assert.equal((await call(man, 'POST', `/api/lca/products/${pid}/publish`, {})).status, 403);
  const pub = (await call(sa, 'POST', `/api/lca/products/${pid}/publish`, {})).body;
  assert.equal(pub.version, 1); assert.ok(Math.abs(pub.factor - 2262.1) < 1e-6); assert.ok(pub.supplierFactor);
  const ef = await tenantRow(T, `SELECT supplier_id, co2e::float8 AS co2e, unit, source, lca_product_id FROM supplier_ef WHERE id = $1`, [pub.supplierFactor]);
  assert.equal(ef.supplier_id, sup); assert.equal(ef.unit, 't'); assert.ok(Math.abs(ef.co2e - 2262.1) < 1e-6); assert.match(ef.source, /Product LCA: Test billet v1 .*verified by Ada Admin/); assert.equal(ef.lca_product_id, pid);
  // a change returns it to draft; the published factor stays until v2
  await call(man, 'PUT', `/api/lca/inputs/${steel}`, { name: 'Primary steel', stage: 'raw', qty: 900, unit: 'kg', lciId: lib('steel_p').id, dq: 'supplier' });
  det = (await call(man, 'GET', `/api/lca/products/${pid}`)).body;
  assert.equal(det.product.status, 'draft'); assert.equal(det.product.changed_since_publish, true); assert.ok(Math.abs(det.product.published_factor - 2262.1) < 1e-6);
  assert.equal((await call(man, 'PUT', `/api/lca/products/${pid}`, { ...scope, supplierId: null })).status, 400, 'the supplier of a published product is fixed');
  assert.equal((await call(sa, 'DELETE', `/api/lca/products/${pid}`)).status, 409);
  // second round: the admin edits and sends; the admin cannot verify their own change, the super admin can; v2 updates the same supplier factor
  await call(adm, 'PUT', `/api/lca/inputs/${steel}`, { name: 'Primary steel', stage: 'raw', qty: 950, unit: 'kg', lciId: lib('steel_p').id, dq: 'verified' });
  await call(adm, 'POST', `/api/lca/products/${pid}/submit`, {});
  assert.equal((await call(adm, 'POST', `/api/lca/products/${pid}/verify`, { decision: 'verify' })).status, 403);
  await call(sa, 'POST', `/api/lca/products/${pid}/verify`, { decision: 'verify' });
  const v2 = (await call(adm, 'POST', `/api/lca/products/${pid}/publish`, {})).body;
  assert.equal(v2.version, 2); assert.equal(v2.supplierFactor, pub.supplierFactor);
  assert.ok(Math.abs((await tenantRow(T, `SELECT co2e::float8 AS c FROM supplier_ef WHERE id = $1`, [pub.supplierFactor])).c - (2262.1 - 50 * 2.1)) < 1e-6);
  assert.equal((await call(man, 'GET', `/api/lca/products/${pid}`)).body.publications.length, 2);
  // company factors: own to the company; editing one updates the models that use it
  const own = (await call(man, 'POST', '/api/lca/library', { name: 'Billet EPD factor', unit: 'kg', co2e: 1.2, stage: 'raw', source: 'Test EPD' })).body.id as string;
  assert.ok((await call(sa, 'GET', '/api/lca')).body.library.some((f: { id: string }) => f.id === own));
  assert.ok(!(await api('GET', '/api/lca', undefined, tenantB)).body.library.some((f: { id: string }) => f.id === own), 'not visible to another company');
  assert.ok((await api('GET', '/api/lca', undefined, tenantB)).body.library.length >= 29, 'the shared library is');
  assert.equal((await api('GET', `/api/lca/products/${pid}`, undefined, tenantB)).status, 404);
  assert.equal((await call(adm, 'PUT', `/api/lca/library/${lib('steel_p').id}`, { name: 'xx', unit: 'kg', co2e: 0, stage: 'raw', source: 'xx' })).status, 404, 'shared rows are not changed by a company');
});

test('CBAM: installation, processes, yearly report with precursors and goods, specific embedded emissions, verification rules, exports; importer lines with defaults, benchmarks and certificates; companies kept apart', async () => {
  const T = tenantA;
  const inst = (await api('POST', '/api/cbam/installations', { name: 'Test smelter', country: 'AE', registryId: 'TEST-1', lat: 25.1, lon: 55.2 }, T)).body.id as string;
  assert.ok(inst);
  assert.equal((await api('POST', `/api/cbam/installations/${inst}/processes`, { category: 'crude_steel', route: '', name: 'No route' }, T)).status, 400, 'crude steel needs a route');
  const pEaf = (await api('POST', `/api/cbam/installations/${inst}/processes`, { category: 'crude_steel', route: 'Electric arc furnace', name: 'EAF' }, T)).body.id as string;
  const pCem = (await api('POST', `/api/cbam/installations/${inst}/processes`, { category: 'cement', route: '', name: 'Grinding' }, T)).body.id as string;
  assert.ok(pEaf && pCem);
  const rep = (await api('POST', '/api/cbam/reports', { installationId: inst, year: 2026 }, T)).body.id as string;
  assert.equal((await api('POST', '/api/cbam/reports', { installationId: inst, year: 2026 }, T)).status, 409);
  let d = (await api('GET', `/api/cbam/reports/${rep}`, undefined, T)).body;
  const eaf = d.lines.find((l: { process: string }) => l.process === 'EAF'), cem = d.lines.find((l: { process: string }) => l.process === 'Grinding');
  // steel: 1,000 t, 400 t direct + 100 t DRI precursor at 1.5 t/t; electricity 500 MWh (not counted for steel)
  await api('PUT', `/api/cbam/lines/${eaf.id}`, { activityT: 1000, directT: 400, elecMwh: 500, defaultShare: 0.5, params: { scrap_t: '0.9' } }, T);
  await api('POST', `/api/cbam/lines/${eaf.id}/precursors`, { category: 'dri', quantityT: 100, seeDirect: 1.5, seeIndirect: 0.2, source: 'default' }, T);
  assert.equal((await api('POST', `/api/cbam/lines/${eaf.id}/goods`, { cn: '2523 29 00' }, T)).status, 400, 'cement CN on a steel process');
  assert.equal((await api('POST', `/api/cbam/lines/${eaf.id}/goods`, { cn: '84714100' }, T)).status, 400, 'not a CBAM good');
  assert.equal((await api('POST', `/api/cbam/lines/${eaf.id}/goods`, { cn: '7207 11 14', quantityT: 1000 }, T)).status, 200);
  // cement: 2,000 t, 1,600 t direct, 100 MWh at 0.5 t/MWh = 50 t indirect (counted)
  await api('PUT', `/api/cbam/lines/${cem.id}`, { activityT: 2000, directT: 1600, elecMwh: 100, defaultShare: 0, params: {} }, T);
  await api('POST', `/api/cbam/lines/${cem.id}/goods`, { cn: '25232900' }, T);
  const head = { periodStart: '2026-01-01', periodEnd: '2026-12-31', elecEf: 0.5, elecEfSource: 'test', notes: '', sharedWith: '' };
  assert.match((await api('PUT', `/api/cbam/reports/${rep}`, { ...head, status: 'verified' }, T)).body.message, /verifier/);
  await api('PUT', `/api/cbam/reports/${rep}`, { ...head, status: 'draft' }, T);
  d = (await api('GET', `/api/cbam/reports/${rep}`, undefined, T)).body;
  const se = d.lines.find((l: { process: string }) => l.process === 'EAF').see, sc = d.lines.find((l: { process: string }) => l.process === 'Grinding').see;
  assert.ok(Math.abs(se.seeDirect - 0.55) < 1e-9, JSON.stringify(se));             // (400 + 150) / 1000
  assert.ok(Math.abs(se.seeIndirect - 0.27) < 1e-9);                                 // (500 × 0.5 + 20) / 1000
  assert.ok(Math.abs(se.seeTotal - 0.55) < 1e-9 && se.counted === false, 'steel: direct only');
  assert.ok(Math.abs(se.defaultShare - (200 + 150) / 550) < 1e-9);                    // half of own 400 + default precursor 150
  assert.ok(Math.abs(sc.seeTotal - 0.825) < 1e-9 && sc.counted === true, 'cement: indirect counted');  // (1600 + 50) / 2000
  assert.equal((await api('PUT', `/api/cbam/reports/${rep}`, { ...head, verifierName: 'Test Verifier', verificationDate: '2027-02-01', opinion: 'Satisfactory, reasonable assurance', status: 'verified' }, T)).status, 200);
  assert.equal((await api('PUT', `/api/cbam/lines/${eaf.id}`, { activityT: 1, directT: 1, elecMwh: 0, defaultShare: 0, params: {} }, T)).status, 409, 'verified figures are locked');
  const x = await app.inject({ method: 'GET', url: `/api/cbam/reports/${rep}/export`, headers: { cookie: adminCookie, 'x-tenant-id': T } });
  assert.equal(x.statusCode, 200); assert.match(String(x.headers['content-type']), /spreadsheetml/);
  // importer: one default line (with company default and benchmark), one actual line from the own installation
  await api('POST', '/api/cbam/reference', { kind: 'default', cn: '7207', country: 'TR', year: 2026, value: 2.31, source: 'test' }, T);
  await api('POST', '/api/cbam/reference', { kind: 'benchmark', cn: '7207', year: 2026, value: 1.364, source: 'test' }, T);
  assert.equal((await api('POST', '/api/cbam/imports', { year: 2026, importDate: '2026-02-11', cn: '84714100', origin: 'TR', mass: 10 }, T)).status, 200, 'saved, flagged as not CBAM');
  await api('POST', '/api/cbam/imports', { year: 2026, importDate: '2026-02-11', cn: '72071114', origin: 'TR', mass: 10000 }, T);
  await api('POST', '/api/cbam/imports', { year: 2026, importDate: '2026-08-01', cn: '72071114', origin: 'AE', mass: 1000, source: 'actual', reportId: rep }, T);
  assert.equal((await api('POST', '/api/cbam/imports', { year: 2026, importDate: '2027-01-05', cn: '72071114', origin: 'TR', mass: 1 }, T)).status, 400, 'date outside the year');
  const im = (await api('GET', '/api/cbam/imports?year=2026', undefined, T)).body;
  const def = im.lines.find((l: { origin: string; cn: string }) => l.origin === 'TR' && l.cn === '72071114'), act = im.lines.find((l: { origin: string }) => l.origin === 'AE');
  assert.ok(Math.abs(def.calc.see - 2.541) < 1e-9 && Math.abs(def.calc.sefa - 1.3299) < 1e-9, JSON.stringify(def.calc));   // the Commission's worked example
  assert.ok(Math.abs(def.calc.certificates - 12111) < 1e-6); assert.equal(def.calc.price, 75.36);
  assert.ok(Math.abs(act.see_direct - 0.55) < 1e-9 && act.calc.certificates === 0, 'own verified data used, below the free allocation');
  assert.match(im.lines.find((l: { cn: string }) => l.cn === '84714100').calc.problems[0], /not a CBAM good/);
  const dec = await app.inject({ method: 'GET', url: '/api/cbam/declaration?year=2026', headers: { cookie: adminCookie, 'x-tenant-id': T } });
  assert.equal(dec.statusCode, 200);
  // upload preview from CSV
  const csv = 'Import date,CN code,Country of origin,Net mass (t),Emissions\n2026-03-01,7207 11 14,Turkey,500,default\n2026-03-02,8471 41 00,TR,5,default\n';
  const up = await app.inject({ method: 'POST', url: '/api/cbam/imports/upload?year=2026', payload: Buffer.from(csv), headers: { cookie: adminCookie, 'x-tenant-id': T, 'content-type': 'application/octet-stream', 'x-filename': 'imports.csv' } });
  assert.equal(up.statusCode, 200, up.body); assert.equal(up.json().ok, 1); assert.equal(up.json().problems, 1);
  // companies kept apart
  assert.equal((await api('GET', `/api/cbam/reports/${rep}`, undefined, tenantB)).status, 404);
  assert.equal((await api('GET', '/api/cbam/imports?year=2026', undefined, tenantB)).body.lines.length, 0);
  assert.ok(!(await api('GET', '/api/cbam?year=2026', undefined, tenantB)).body.references.some((r: { source: string }) => r.source === 'test'));
});
