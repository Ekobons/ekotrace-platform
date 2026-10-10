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
  assert.equal(count('problem'), 2, JSON.stringify(d.problems)); // Mars base, EUR rate missing
  assert.equal(count('flagged'), 0);  // airfare moved and diesel excluded by default…
  assert.ok(count('check') > 0);      // …but large groups wait for a person to confirm
  assert.equal(count('excluded'), 1);
  assert.ok(d.problems.some((p: { problem: string }) => p.problem === 'Facility "Mars base" not found'));
  assert.ok(d.problems.some((p: { problem: string }) => /No exchange rate for EUR/.test(p.problem)));
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
  // EUR rate for June 2024 → recalculate
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
  const loc = (await api('GET', '/api/dashboard?year=2024', undefined, tenantA)).body;
  const mkt = (await api('GET', '/api/dashboard?year=2024&scope2=market', undefined, tenantA)).body;
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
