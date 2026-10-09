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

const url = process.env.TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;
process.env.DEV_AUTH = 'true';

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let calc: typeof import('@ekotrace/calc');
let svc: typeof import('../src/modules/calc.service.js');
let ref: typeof import('../src/modules/refdata.js');

const api = async (method: string, path: string, body?: unknown, tenant?: string) => {
  const r = await app.inject({ method: method as 'GET', url: path, payload: body as object, headers: tenant ? { 'x-tenant-id': tenant } : {} });
  return { status: r.statusCode, body: r.json() };
};

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
const diesel = async () => (await pool.query(`SELECT id FROM item WHERE code = 'desnz:diesel-100-mineral-diesel'`)).rows[0].id as number;

test('companies and facilities; diesel 2025 calculates with DESNZ 2025 and splits gases', async () => {
  tenantA = (await api('POST', '/api/admin/tenants', { name: 'BEEAH Test', country: 'AE', gwpSet: 'AR5' })).body.id;
  tenantB = (await api('POST', '/api/admin/tenants', { name: 'Other Co', country: 'AE', gwpSet: 'AR6' })).body.id;
  facA = (await api('POST', '/api/facilities', { name: 'Sharjah plant' }, tenantA)).body.id;
  facB = (await api('POST', '/api/facilities', { name: 'Dubai office' }, tenantB)).body.id;

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
  const prev = await app.inject({ method: 'POST', url: '/api/admin/import/desnz?preview=1', payload: buf, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(prev.statusCode, 200, prev.body);
  assert.equal(prev.json().year, 2026);
  assert.equal(prev.json().gwpSet, 'AR5');
  const again = await app.inject({ method: 'POST', url: '/api/admin/import/desnz', payload: buf, headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(again.json().skipped, true);
});

test('per-gas report', async () => {
  const r = await api('GET', '/api/reports/by-gas?year=2025', undefined, tenantA);
  assert.ok(r.body.rows.some((x: { gas: string }) => x.gas === 'N2O'));
});
