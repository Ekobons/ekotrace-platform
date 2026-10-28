/**
 * SEBI BRSR Core: the KPI rules (pure) and the API on a real PostgreSQL database.
 *
 *   BRSR_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_brsr_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { KPIS, checks, derive, revenuePpp, wasteCategory, wasteRoute } from '../src/lib/brsr.js';
process.env.RATE_LIMIT = 'off';

const near = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('catalogue: nine attributes, unique codes, every Core row present', () => {
  assert.deepEqual([...new Set(KPIS.map((k) => k.attr))].sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(new Set(KPIS.map((k) => k.code)).size, KPIS.length);
  for (const c of ['ghg.s1', 'ghg.s2', 'ghg.int_ppp', 'water.consumption', 'energy.re_share', 'waste.total', 'emp.ltifr_wkr', 'gender.wages_pct', 'incl.msme_pct', 'fair.days_payable', 'open.rp_inv_pct'])
    assert.ok(KPIS.find((k) => k.code === c)?.inCore, c);
});

test('derive: PPP intensity per USD million, LTIFR per million hours, percentages, days payable', () => {
  const ctx = { revenue: 10_000e6, ppp: 22.4, output: 2000 };   // ₹10,000 Mn → USD 446.43 Mn (PPP), the Standards' example
  near(revenuePpp(ctx), 10_000e6 / 22.4 / 1e6);
  const d = derive({ 'ghg.s1': 7000, 'ghg.s2': 3000, 'energy.total': 50_000, 'energy.renewable': 12_500, 'emp.lti_wkr': 3, 'emp.hours_wkr': 1_500_000,
    'gender.wages_female': 25, 'gender.wages_total': 100, 'fair.payables': 100, 'fair.procured': 730, 'waste.a': 1, 'waste.h': 2, 'emp.wellbeing_spend': 50e6,
    'incl.w_rural': 10, 'incl.w_metro': 30 }, ctx);
  near(d['ghg.int_ppp'], 10_000 / (10_000e6 / 22.4 / 1e6)); near(d['ghg.int_out'], 5);
  near(d['energy.re_share'], 25); near(d['emp.ltifr_wkr'], 2); near(d['gender.wages_pct'], 25); near(d['fair.days_payable'], 50);
  near(d['waste.total'], 3); near(d['emp.wellbeing_pct'], 0.5); near(d['incl.rural_pct'], 25); near(d['incl.metro_pct'], 75);
  assert.equal(d['emp.ltifr_emp'], null);   // no hours: not worked out
  assert.equal(derive({ 'ghg.s1': 1 }, { revenue: null, ppp: 22.4, output: null })['ghg.int_ppp'], null);
});

test('waste: categories A–H and recovery / disposal routes', () => {
  assert.equal(wasteCategory('Plastic', 'Plastics: PET (incl. forming) · Open-loop recycling', false), 'a');
  assert.equal(wasteCategory('Electrical items', 'WEEE - small · Landfill', false), 'b');
  assert.equal(wasteCategory('Electrical items', 'Batteries · Landfill', true), 'e');
  assert.equal(wasteCategory('Hazardous waste (no DESNZ factor)', 'Clinical / healthcare waste · Incineration', true), 'c');
  assert.equal(wasteCategory('Construction', 'Concrete · Landfill', false), 'd');
  assert.equal(wasteCategory('Construction', 'Asbestos · Landfill', true), 'g');
  assert.equal(wasteCategory('Other', 'Clothing · Landfill', false), 'h');
  assert.equal(wasteRoute('reuse', 'closed_loop'), 'reused'); assert.equal(wasteRoute(null, 'open_loop'), 'recycled');
  assert.equal(wasteRoute('composting', 'composting'), 'other_recovery'); assert.equal(wasteRoute('incin_er', 'combustion'), 'incineration');
  assert.equal(wasteRoute(null, 'landfill'), 'landfill'); assert.equal(wasteRoute('other', 'treatment'), 'other_disposal');
});

test('checks: discharge by treatment, waste routes, shares above their total', () => {
  const p = checks({ 'water.discharge': 1000, 'water.dis_none': 100, 'water.dis_secondary': 500, 'waste.a': 1, 'waste.landfill': 3, 'incl.msme': 120, 'incl.purchases': 100 });
  assert.equal(p.length, 3);
  assert.deepEqual(checks({ 'water.discharge': 1000, 'water.dis_tertiary': 1000 }), []);
});

// ------------------------------------------------------------------------------------------- API --
const url = process.env.BRSR_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_brsr_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('BRSR_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', co = '', other = '', plant = '', office = '', mgr = '', sa = '';

const call = async (method: string, path: string, body?: unknown, tenant?: string, cookie = admin) => {
  const headers: Record<string, string> = { cookie };
  if (tenant) headers['x-tenant-id'] = tenant;
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body, raw: r.rawPayload };
};
const login = async (email: string, password: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })).headers['set-cookie']).split(';')[0]!;

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
  const p = new pg.Client({ connectionString: url });
  await p.connect();
  await p.query(`SELECT set_config('app.platform','on',false)`);
  const pw = await hashPassword('correct horse battery');
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES (NULL,'ops@ekobon.test','Ops','platform_admin',$1,false)`, [pw]);
  admin = await login('ops@ekobon.test', 'correct horse battery');
  co = (await call('POST', '/api/platform/companies', { name: 'Listed Co Ltd', country: 'IN', superAdmin: { name: 'SA', email: 'sa@listed.test' } })).body.company.id;
  other = (await call('POST', '/api/platform/companies', { name: 'Other Co', country: 'IN', superAdmin: { name: 'SA2', email: 'sa@other.test' } })).body.company.id;
  const root = (await p.query(`SELECT id FROM org_node WHERE tenant_id = $1 AND kind = 'group'`, [co])).rows[0].id;
  plant = (await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'Pune plant', country: 'IN' }, co)).body.id;
  office = (await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'Mumbai office', country: 'IN' }, co)).body.id;
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'mgr@listed.test','Manager','manager',$2,false)`, [co, pw]);
  mgr = await login('mgr@listed.test', 'correct horse battery');
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'head@listed.test','Head of ESG','super_admin',$2,false)`, [co, pw]);
  sa = await login('head@listed.test', 'correct horse battery');

  // reference items for the test: a coal, a biomass (bioenergy) fuel; grid electricity, water and waste items exist after migrations
  const cat = async (code: string) => (await p.query(`SELECT id FROM category WHERE code = $1`, [code])).rows[0].id as number;
  const sc = await cat('stationary_combustion');
  const solid = (await p.query(`INSERT INTO subcategory (category_id, code, name, units) VALUES ($1, 'test-solid', 'Solid fuels', '{t}') RETURNING id`, [sc])).rows[0].id;
  const bio = (await p.query(`INSERT INTO subcategory (category_id, code, name, units, is_bioenergy) VALUES ($1, 'test-bio', 'Biomass', '{t}', true) RETURNING id`, [sc])).rows[0].id;
  const coal = (await p.query(`INSERT INTO item (subcategory_id, code, name) VALUES ($1, 'test:coal', 'Coal') RETURNING id`, [solid])).rows[0].id;
  const husk = (await p.query(`INSERT INTO item (subcategory_id, code, name) VALUES ($1, 'test:husk', 'Rice husk') RETURNING id`, [bio])).rows[0].id;
  const it = async (code: string) => (await p.query(`SELECT i.id, s.category_id FROM item i JOIN subcategory s ON s.id = i.subcategory_id WHERE i.code = $1`, [code])).rows[0];
  const grid = await it('grid:electricity'), well = await it('water:groundwater'), sewer = await it('water:sewer');
  const wcat = await cat('waste_generated');
  const wsub = (await p.query(`INSERT INTO subcategory (category_id, code, name, units) VALUES ($1, 'test-plastic', 'Plastic', '{t}') RETURNING id`, [wcat])).rows[0].id;
  const pet = (await p.query(`INSERT INTO item (subcategory_id, code, name, attrs) VALUES ($1, 'test:pet', 'Plastics: PET · Open-loop recycling', '{"route":"open_loop"}') RETURNING id`, [wsub])).rows[0].id;
  const ins = async (fac: string, catId: number, item: number, s: string, e: string, q: number, unit: string, kg: number, kg2 = 0, inputs = {}, status = 'approved') => {
    const id = (await p.query(`INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, gwp_set, co2e_direct, co2e_scope2, steps, status, inputs)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AR5',$9,$10,'[]',$11,$12) RETURNING id`, [co, fac, catId, item, s, e, q, unit, kg, kg2, status, JSON.stringify(inputs)])).rows[0].id;
    if (kg) await p.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, method) VALUES ($1,$2,'direct','CO2',$3,$3,'gas')`, [id, co, kg]);
    return id;
  };
  await ins(plant, sc, coal, '2025-04-01', '2026-03-31', 100, 't', 240_000);                    // whole FY 2025-26
  await ins(plant, sc, coal, '2026-03-01', '2026-04-30', 61, 't', 61_000);                      // 31/61 inside FY 2025-26
  await ins(plant, sc, coal, '2025-06-01', '2025-06-30', 999, 't', 999_000, 0, {}, 'submitted'); // not approved
  await ins(plant, sc, husk, '2025-05-01', '2025-05-31', 10, 't', 50);                           // bioenergy: CH4/N2O only
  await ins(plant, grid.category_id, grid.id, '2025-04-01', '2026-03-31', 1_000_000, 'kWh_e', 0, 716_000);
  await ins(office, grid.category_id, grid.id, '2025-04-01', '2026-03-31', 100_000, 'kWh_e', 0, 71_600);
  await ins(plant, well.category_id, well.id, '2025-04-01', '2026-03-31', 50_000, 'm3', 0);
  await ins(plant, sewer.category_id, sewer.id, '2025-04-01', '2026-03-31', 20_000, 'm3', 0);
  await ins(plant, wcat, pet, '2025-04-01', '2025-09-30', 12, 't', 0);
  await p.end();
});
after(async () => { await app?.close(); await pool?.end(); });

test('API: environmental KPIs from approved entries for April–March, split by days', async () => {
  const d = (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  assert.equal(d.report.label, 'FY 2025-26'); assert.equal(d.report.exists, false);
  const v = (c: string) => d.rows.find((r: { code: string }) => r.code === c).value;
  near(v('ghg.s1'), 240 + 31 + 0.05);                 // coal 240 t, 31 of 61 days of 61 t, husk 0.05 t; the submitted entry left out
  near(v('ghg.s2'), 716 + 71.6);
  near(v('water.withdrawal'), 50_000); near(v('water.discharge'), 20_000); near(v('water.consumption'), 30_000);
  near(v('waste.a'), 12); near(v('waste.recycled'), 12); near(v('waste.total'), 12);
  near(v('energy.total') - v('energy.renewable'), v('energy.total') - v('energy.renewable'));
  assert.ok(v('energy.total') >= (1_100_000 * 0.0036) - 1e-6);   // electricity alone = 3,960 GJ
  assert.equal(v('ghg.int_ppp'), null);                         // no revenue yet
  assert.ok(d.gases.some((g: { gas: string }) => g.gas === 'CO2'));
  const o = (await call('GET', '/api/brsr?fy=2025', undefined, other)).body.rows.find((r: { code: string }) => r.code === 'ghg.s1');
  assert.equal(o.value, null); assert.equal(o.source, 'missing');   // another company, no entries: missing, not zero
});

test('API: settings, boundary, typed values, overrides need a note, PPP intensity', async () => {
  assert.equal((await call('PUT', '/api/brsr/2025', { revenueInr: 10_000e6, pppFactor: 22.4, outputQty: 2000, outputUnit: 't', facilityIds: [plant], provider: 'Test Assurer LLP', approach: 'assurance', status: 'draft' }, co, mgr)).status, 403);
  const s = await call('PUT', '/api/brsr/2025', { revenueInr: 10_000e6, pppFactor: 22.4, outputQty: 2000, outputUnit: 't', facilityIds: [plant], provider: 'Test Assurer LLP', approach: 'assurance', status: 'draft' }, co);
  assert.equal(s.status, 200, s.text);
  let d = (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  const v = (c: string) => d.rows.find((r: { code: string }) => r.code === c).value;
  near(v('ghg.s2'), 716);                                      // office left out of the boundary
  near(v('ghg.int_ppp'), (v('ghg.s1') + 716) / (10_000e6 / 22.4 / 1e6));
  assert.equal((await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'ghg.s1', value: 300 }] }, co, mgr)).status, 400);   // override without a note
  assert.equal((await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'ghg.int_ppp', value: 1 }] }, co, mgr)).status, 400); // derived: not enterable
  const w = await call('PUT', '/api/brsr/2025/values', { values: [
    { kpi: 'ghg.s1', value: 300, note: 'Includes the DG sets not yet in entries' },
    { kpi: 'emp.lti_wkr', value: 3 }, { kpi: 'emp.hours_wkr', value: 1_500_000, owner: 'HR' }, { kpi: 'gender.wages_female', value: 25 }, { kpi: 'gender.wages_total', value: 100 },
    { kpi: 'water.dis_secondary', value: 20_000 },
  ] }, co, mgr);
  assert.equal(w.status, 200, w.text);
  d = (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  const r = (c: string) => d.rows.find((x: { code: string }) => x.code === c);
  assert.equal(r('ghg.s1').value, 300); assert.equal(r('ghg.s1').source, 'override'); assert.ok(r('ghg.s1').auto > 270);
  near(r('emp.ltifr_wkr').value, 2); near(r('gender.wages_pct').value, 25);
  assert.equal(d.problems.length, 1); assert.match(d.problems[0], /3 fuel or energy entries have no calorific value/);   // the test fuels carry no calorific value
});

test('API: review — preparers mark ready; reviewer is someone else; a change reopens; final locks', async () => {
  assert.equal((await call('POST', '/api/brsr/2025/review', { kpis: ['emp.lti_wkr'], review: 'reviewed' }, co, mgr)).status, 403);
  assert.equal((await call('POST', '/api/brsr/2025/review', { kpis: ['emp.lti_wkr', 'emp.hours_wkr'], review: 'ready' }, co, mgr)).status, 200);
  assert.equal((await call('POST', '/api/brsr/2025/review', { kpis: ['emp.lti_wkr'], review: 'reviewed' }, co)).status, 403);   // Ekobon staff never review client data
  const rv = await call('POST', '/api/brsr/2025/review', { kpis: ['emp.lti_wkr', 'emp.hours_wkr'], review: 'reviewed' }, co, sa);
  assert.equal(rv.status, 200); assert.equal(rv.body.skipped, 0);
  let d = (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  assert.equal(d.rows.find((x: { code: string }) => x.code === 'emp.lti_wkr').review, 'reviewed'); assert.equal(d.readiness.reviewed, 2);
  await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'emp.lti_wkr', value: 4 }] }, co, mgr);
  d = (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  assert.equal(d.rows.find((x: { code: string }) => x.code === 'emp.lti_wkr').review, 'open');
  // someone reviewing their own change is skipped
  await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'fair.payables', value: 100 }] }, co, sa);
  assert.equal((await call('POST', '/api/brsr/2025/review', { kpis: ['fair.payables'], review: 'reviewed' }, co, sa)).body.skipped, 1);
  await call('PUT', '/api/brsr/2025', { revenueInr: 10_000e6, pppFactor: 22.4, outputQty: 2000, outputUnit: 't', facilityIds: [plant], provider: 'Test Assurer LLP', approach: 'assurance', status: 'final' }, co);
  assert.equal((await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'fair.procured', value: 730 }] }, co, mgr)).status, 409);
  await call('PUT', '/api/brsr/2025', { revenueInr: 10_000e6, pppFactor: 22.4, outputQty: 2000, outputUnit: 't', facilityIds: [plant], provider: 'Test Assurer LLP', approach: 'assurance', status: 'draft' }, co);
});

test('API: value chain partners, coverage and attributable figures; Excel export', async () => {
  await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'incl.purchases', value: 1000 }, { kpi: 'open.sales', value: 5000 }] }, co);
  const a = await call('POST', '/api/brsr/2025/partners', { side: 'upstream', name: 'Coal Traders Pvt Ltd', amountInr: 300, attributable: 0.1, values: { 'ghg.s1': 5000, 'ghg.s2': 1000 } }, co, mgr);
  assert.equal(a.status, 200, a.text);
  await call('POST', '/api/brsr/2025/partners', { side: 'upstream', name: 'Small vendor', amountInr: 10, values: { 'ghg.s1': 1 } }, co);
  await call('POST', '/api/brsr/2025/partners', { side: 'downstream', name: 'Distributor A', amountInr: 2000, attributable: 0.5, values: { 'energy.total': 400 } }, co);
  assert.equal((await call('POST', '/api/brsr/2025/partners', { side: 'upstream', name: 'Bad', values: { 'gender.posh': 1 } }, co)).status, 400);
  const d = (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  const up = d.valueChain.upstream;
  near(up.coverage, 0.31); near(up.attributable['ghg.s1'], 5000 * 0.1 + 1); near(up.attributable['ghg.s2'], 100);
  assert.equal(up.partners.find((p: { name: string }) => p.name === 'Small vendor').belowTwo, true);
  near(d.valueChain.downstream.attributable['energy.total'], 200);
  const x = await call('GET', '/api/brsr/2025/export', undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['BRSR Core', 'Inputs', 'Value chain', 'Detail', 'Method']);
  const core = wb.getWorksheet('BRSR Core')!;
  let ltifr: unknown; core.eachRow((r) => { if (String(r.getCell(3).value).includes('LTIFR — workers')) ltifr = r.getCell(5).value; });
  near(ltifr as number, 4 / 1.5);
  assert.equal((await call('GET', '/api/brsr?fy=2025', undefined, other)).body.valueChain.upstream.partners.length, 0);
});

test('API: Final freezes the figures and locks settings and partners; reviews follow user ids; consumption after overrides', async () => {
  const S = { revenueInr: 10_000e6, pppFactor: 22.4, outputQty: 2000, outputUnit: 't', facilityIds: [plant], provider: 'Test Assurer LLP', approach: 'assurance', status: 'draft' };
  const get = async () => (await call('GET', '/api/brsr?fy=2025', undefined, co)).body;
  const row = (d: { rows: { code: string }[] }, c: string) => d.rows.find((x) => x.code === c) as unknown as { value: number; review: string; changedSinceReview: boolean; source: string };
  // overriding discharge moves consumption with it
  await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'water.discharge', value: 25_000, note: 'Meter recalibrated' }] }, co, mgr);
  let d = await get();
  near(row(d, 'water.consumption').value, 25_000);
  await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'water.discharge', value: null }] }, co, mgr);
  // a reviewed figure from entries that later changes needs reviewing again
  assert.equal((await call('POST', '/api/brsr/2025/review', { kpis: ['ghg.s2'], review: 'reviewed' }, co, sa)).status, 200);
  assert.equal(row(await get(), 'ghg.s2').review, 'reviewed');
  const p = new pg.Client({ connectionString: url }); await p.connect();
  await p.query(`SELECT set_config('app.platform','on',false)`);
  await p.query(`UPDATE activity SET co2e_scope2 = co2e_scope2 * 2 WHERE facility_id = $1 AND co2e_scope2 > 0`, [plant]);
  d = await get();
  near(row(d, 'ghg.s2').value, 1432); assert.equal(row(d, 'ghg.s2').review, 'open'); assert.equal(row(d, 'ghg.s2').changedSinceReview, true);
  // review by user id: a renamed person still cannot review their own change
  await call('PUT', '/api/brsr/2025/values', { values: [{ kpi: 'fair.procured', value: 730 }] }, co, sa);
  await p.query(`UPDATE app_user SET name = 'Renamed head' WHERE email = 'head@listed.test'`);
  assert.equal((await call('POST', '/api/brsr/2025/review', { kpis: ['fair.procured'], review: 'reviewed' }, co, sa)).body.skipped, 1);
  // Final: figures frozen, settings and partners locked
  assert.equal((await call('PUT', '/api/brsr/2025', { ...S, status: 'final' }, co)).status, 200);
  await p.query(`UPDATE activity SET co2e_scope2 = co2e_scope2 * 3 WHERE facility_id = $1 AND co2e_scope2 > 0`, [plant]);
  near(row(await get(), 'ghg.s2').value, 1432);
  assert.equal((await call('PUT', '/api/brsr/2025', { ...S, revenueInr: 20_000e6, status: 'final' }, co)).status, 409);
  const pid = (await get()).valueChain.upstream.partners[0].id;
  assert.equal((await call('POST', '/api/brsr/2025/partners', { side: 'upstream', name: 'Late add' }, co, mgr)).status, 409);
  assert.equal((await call('PUT', `/api/brsr/partners/${pid}`, { side: 'upstream', name: 'Renamed' }, co, mgr)).status, 409);
  assert.equal((await call('DELETE', `/api/brsr/partners/${pid}`, undefined, co, mgr)).status, 409);
  // reopening keeps the settings and unfreezes
  const re = await call('PUT', '/api/brsr/2025', { ...S, revenueInr: 1, status: 'draft' }, co);
  assert.equal(re.status, 200, re.text);
  d = await get();
  assert.equal(d.report.revenueInr, 10_000e6); near(row(d, 'ghg.s2').value, 716 * 6);
  await p.query(`UPDATE activity SET co2e_scope2 = co2e_scope2 / 6 WHERE facility_id = $1 AND co2e_scope2 > 0`, [plant]);
  await p.end();
});
