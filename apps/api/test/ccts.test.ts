/**
 * India CCTS / GEI tracker: the calculation (pure) and the API on a real PostgreSQL database.
 *
 *   CCTS_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_ccts_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { account, fyLabel, fyMonths, fyOf, month, year, type MonthIn } from '../src/lib/ccts.js';
process.env.RATE_LIMIT = 'off';

const near = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const blank = (m: string, x: Partial<MonthIn> = {}): MonthIn => ({ month: m, output: null, fuel_t: null, process_t: null, pfc_t: null, grid_mwh: null, re_mwh: null, heat_t: null, export_mwh: null, export_ef: null, transfer_t: null, ...x });

test('compliance year runs April to March', () => {
  assert.equal(fyLabel(2025), '2025-26');
  assert.deepEqual([fyMonths(2025)[0], fyMonths(2025)[8], fyMonths(2025)[11]], ['2025-04-01', '2025-12-01', '2026-03-01']);
  assert.equal(fyOf('2026-03-01'), 2025); assert.equal(fyOf('2026-04-01'), 2026);
});

test('month: BEE eq. II — energy + process + PFC + electricity + heat − exported − transferred', () => {
  const m = month(blank('2025-04-01', { output: 1000, fuel_t: 300, process_t: 500, pfc_t: 20, grid_mwh: 200, re_mwh: 50, heat_t: 10, export_mwh: 20, transfer_t: 5 }), 0.8, 'manual');
  near(m.electricity, 150 * 0.8);
  near(m.exported, 20 * 0.8);
  near(m.total, 300 + 500 + 20 + 120 + 10 - 16 - 5);
  near(m.gei, m.total / 1000);
  assert.ok(m.complete);
  // export at its own heat-rate factor
  near(month(blank('2025-04-01', { output: 1, fuel_t: 1, export_mwh: 10, export_ef: 1.1 }), 0.8, 'manual').exported, 11);
  // renewable above purchase is capped and flagged
  const r = month(blank('2025-04-01', { output: 1, grid_mwh: 10, re_mwh: 15 }), 0.8, 'manual');
  near(r.electricity, 0); assert.match(r.problems[0]!, /Renewable/);
});

test('month: entries mode uses EKOTRACE fuel and grid electricity; a typed value overrides', () => {
  const fe = { fuel_t: 120, grid_mwh: 100, entries: 3 };
  const a = month(blank('2025-05-01', { output: 10, fromEntries: fe }), 0.7, 'entries');
  near(a.fuel, 120); near(a.electricity, 70); assert.equal(a.sources.fuel, 'entries');
  const b = month(blank('2025-05-01', { output: 10, fuel_t: 90, fromEntries: fe }), 0.7, 'entries');
  near(b.fuel, 90); assert.equal(b.sources.fuel, 'typed'); assert.equal(b.sources.grid, 'entries');
  // manual mode ignores the entries
  near(month(blank('2025-05-01', { output: 10, fromEntries: fe }), 0.7, 'manual').total, 0);
});

test('year: GEI over complete months, CCCs, projection and the GEI needed for the rest', () => {
  const ms = fyMonths(2025).map((m, i) => month(blank(m, i < 6 ? { output: 1000, process_t: 900 } : {}), 0.7, 'manual'));
  const y = year(2025, ms, 0.85, 0.95);
  assert.equal(y.monthsIn, 6); near(y.output, 6000); near(y.gei, 0.9);
  near(y.ccc, (0.85 - 0.9) * 6000);               // −300: to surrender
  near(y.vsBaseline, 1 - 0.9 / 0.95); near(y.targetCut, 1 - 0.85 / 0.95);
  near(y.projection!.output, 12000); near(y.projection!.gei, 0.9); near(y.projection!.ccc, -600);
  near(y.requiredRest, (0.85 * 12000 - 5400) / 6000); // 0.8
  const full = year(2025, fyMonths(2025).map((m) => month(blank(m, { output: 100, process_t: 80 }), 0.7, 'manual')), 0.85, 0.95);
  assert.equal(full.projection, null); near(full.ccc, (0.85 - 0.8) * 1200);
});

test('account: held, obligation, to buy and environmental compensation at twice the price', () => {
  const t = [{ kind: 'bought' as const, fy: 2025, quantity: 100, price_inr: 500 }, { kind: 'surrendered' as const, fy: 2025, quantity: 40, price_inr: null }];
  const a = account(t, 2025, -300, 600);
  assert.equal(a.held, 60); assert.equal(a.obligation, 300); assert.equal(a.surrenderedForYear, 40); assert.equal(a.open, 260); assert.equal(a.toBuy, 200);
  assert.equal(a.value!.toBuy, 120000); assert.equal(a.value!.compensation, 240000);
  assert.equal(account([], 2025, 123.7, 500).expectedIssue, 123);
  assert.equal(account([], 2025, -10.2, null).obligation, 11);   // whole CCCs, rounded up
  assert.equal(account([], 2025, -10, null).obligation, 10);
});

// ------------------------------------------------------------------------------------------- API --
const url = process.env.CCTS_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_ccts_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('CCTS_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', co = '', other = '', plant = '', office = '';

const call = async (method: string, path: string, body?: unknown, tenant?: string) => {
  const headers: Record<string, string> = { cookie: admin };
  if (tenant) headers['x-tenant-id'] = tenant;
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body, raw: r.rawPayload };
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
  co = (await call('POST', '/api/platform/companies', { name: 'Bharat Cement Ltd', country: 'IN', superAdmin: { name: 'SA', email: 'sa@bharat.test' } })).body.company.id;
  other = (await call('POST', '/api/platform/companies', { name: 'Other Co', country: 'IN', superAdmin: { name: 'SA2', email: 'sa@other.test' } })).body.company.id;
  const q = new pg.Client({ connectionString: url }); await q.connect(); await q.query(`SELECT set_config('app.platform','on',false)`);
  const root = (await q.query(`SELECT id FROM org_node WHERE tenant_id = $1 AND kind = 'group'`, [co])).rows[0].id; await q.end();
  plant = (await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'Kiln plant', country: 'IN' }, co)).body.id;
  office = (await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'Head office', country: 'IN' }, co)).body.id;

  // approved entries: coal in April (one month), grid electricity for April–May (split by days), and the office (outside the boundary)
  const p = new pg.Client({ connectionString: url });
  await p.connect();
  await p.query(`SELECT set_config('app.platform','on',false)`);
  const sc = (await p.query(`SELECT id FROM category WHERE code = 'stationary_combustion'`)).rows[0].id;
  const sub = (await p.query(`INSERT INTO subcategory (category_id, code, name, units) VALUES ($1, 'test-solid', 'Solid', '{t}') RETURNING id`, [sc])).rows[0].id;
  const coal = (await p.query(`INSERT INTO item (subcategory_id, code, name) VALUES ($1, 'test:coal', 'Coal') RETURNING id`, [sub])).rows[0].id;
  const grid = (await p.query(`SELECT i.id, s.category_id FROM item i JOIN subcategory s ON s.id = i.subcategory_id WHERE i.code = 'grid:electricity'`)).rows[0];
  const ins = (fac: string, cat: number, item: number, s: string, e: string, q: number, unit: string, kg: number, status = 'approved') =>
    p.query(`INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, gwp_set, co2e_direct, steps, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AR5',$9,'[]',$10)`,
      [co, fac, cat, item, s, e, q, unit, kg, status]);
  await ins(plant, sc, coal, '2025-04-01', '2025-04-30', 100, 't', 250_000);
  await ins(plant, sc, coal, '2025-05-01', '2025-05-31', 100, 't', 999_000, 'submitted');        // not approved: left out
  await ins(plant, grid.category_id, grid.id, '2025-04-01', '2025-05-31', 61_000, 'kWh_e', 0);    // 61 MWh over 61 days → 30 + 31
  await ins(office, sc, coal, '2025-04-01', '2025-04-30', 10, 't', 40_000);
  await p.end();
});
after(async () => { await app?.close(); await pool?.end(); });

let ent = '';
test('API: add an obligated entity with its boundary, baseline and targets', async () => {
  const bad = await call('POST', '/api/ccts', { name: 'X', sector: 'cement' }, co);
  assert.equal(bad.status, 400);
  const r = await call('POST', '/api/ccts', {
    name: 'Bharat Cement — Kiln plant', registrationNo: 'CCTS-CEM-001', sector: 'cement', subSector: 'Integrated (OPC)', state: 'Rajasthan',
    baselineOutput: 1_000_000, baselineGei: 0.8, gridEf: 0.716, facilityIds: [plant], acva: 'Test ACVA', priceInr: 800,
  }, co);
  assert.equal(r.status, 200, r.text); ent = r.body.id;
  const t = await call('PUT', `/api/ccts/${ent}/targets`, { targets: [{ fy: 2025, targetGei: 0.79 }, { fy: 2026, targetGei: 0.81 }] }, co);
  assert.equal(t.status, 200, t.text); assert.equal(t.body.warnings.length, 1);   // 0.81 above the baseline: flagged
  assert.equal((await call('PUT', `/api/ccts/${ent}/targets`, { targets: [{ fy: 2026, targetGei: 0.78 }] }, co)).status, 200);
  const foreign = await call('POST', '/api/ccts', { name: 'Elsewhere', sector: 'cement', facilityIds: [plant] }, other);
  assert.equal(foreign.status, 400); // another company's facility is not found
});

test('API: months from entries (split by days, approved only, boundary only) plus typed process emissions', async () => {
  const r = await call('PUT', `/api/ccts/${ent}/months`, { months: [
    { month: '2025-04-01', output: 1000, process_t: 500 },
    { month: '2025-05-01', output: 1200, process_t: 600, re_mwh: 10, note: 'Kiln stop 3 days' },
  ] }, co);
  assert.equal(r.status, 200, r.text);
  const d = (await call('GET', `/api/ccts/${ent}?fy=2025`, undefined, co)).body;
  const [apr, may] = d.year.months;
  near(apr.fuel, 250); near(apr.gridMwh, 30); near(apr.electricity, 30 * 0.716); assert.equal(apr.sources.fuel, 'entries');
  near(apr.total, 250 + 500 + 30 * 0.716);
  near(may.fuel, 0); near(may.gridMwh, 31); near(may.electricity, 21 * 0.716); assert.equal(may.note, 'Kiln stop 3 days');
  assert.equal(d.year.monthsIn, 2);
  const em = apr.total + may.total;
  near(d.year.gei, em / 2200); near(d.year.ccc, (0.79 - em / 2200) * 2200);
  assert.equal(d.year.target, 0.79);
  assert.ok(d.year.projection); assert.ok(d.projectedAccount);
  // a typed fuel value overrides the entries for that month
  await call('PUT', `/api/ccts/${ent}/months`, { months: [{ month: '2025-04-01', output: 1000, process_t: 500, fuel_t: 200 }] }, co);
  const d2 = (await call('GET', `/api/ccts/${ent}?fy=2025`, undefined, co)).body;
  near(d2.year.months[0].fuel, 200); assert.equal(d2.year.months[0].sources.fuel, 'typed');
  assert.equal((await call('PUT', `/api/ccts/${ent}/months`, { months: [{ month: '2025-13-01', output: 1 }] }, co)).status, 400);
  // clearing a month removes it
  await call('PUT', `/api/ccts/${ent}/months`, { months: [{ month: '2025-05-01' }] }, co);
  assert.equal((await call('GET', `/api/ccts/${ent}?fy=2025`, undefined, co)).body.year.monthsIn, 1);
});

test('API: list shows the year; another company sees nothing', async () => {
  const l = (await call('GET', '/api/ccts?fy=2025', undefined, co)).body;
  assert.equal(l.entities.length, 1); assert.equal(l.label, '2025-26'); assert.ok(l.entities[0].result.gei > 0);
  assert.equal((await call('GET', '/api/ccts?fy=2025', undefined, other)).body.entities.length, 0);
  assert.equal((await call('GET', `/api/ccts/${ent}`, undefined, other)).status, 404);
});

test('API: CCC account — cannot sell or surrender more than held', async () => {
  assert.equal((await call('POST', `/api/ccts/${ent}/ccc`, { kind: 'surrendered', fy: 2025, quantity: 10, onDate: '2026-08-01' }, co)).status, 400);
  assert.equal((await call('POST', `/api/ccts/${ent}/ccc`, { kind: 'bought', fy: 2025, quantity: 50, priceInr: 750, onDate: '2026-07-15', reference: 'IEX-123' }, co)).status, 200);
  const s = await call('POST', `/api/ccts/${ent}/ccc`, { kind: 'surrendered', fy: 2025, quantity: 30, onDate: '2026-08-01' }, co);
  assert.equal(s.status, 200, s.text);
  const d = (await call('GET', `/api/ccts/${ent}?fy=2025`, undefined, co)).body;
  assert.equal(d.account.held, 20); assert.equal(d.account.surrenderedForYear, 30); assert.equal(d.txns.length, 2);
  const buy = d.txns.find((t: { kind: string }) => t.kind === 'bought');
  assert.equal((await call('DELETE', `/api/ccts/ccc/${buy.id}`, undefined, co)).status, 400); // would leave fewer than surrendered
  assert.equal((await call('DELETE', `/api/ccts/${ent}`, undefined, co)).status, 409);
});

test('API: measures and the Form A workbook', async () => {
  const m = await call('POST', `/api/ccts/${ent}/measures`, { fy: 2025, title: 'Waste heat recovery 12 MW', yearDone: 2025, beforeT: 90000, afterT: 72000, investmentInr: 1.2e9 }, co);
  assert.equal(m.status, 200, m.text);
  assert.equal((await call('PUT', `/api/ccts/measures/${m.body.id}`, { fy: 2025, title: 'Waste heat recovery 13 MW', beforeT: 90000, afterT: 70000 }, co)).status, 200);
  const x = await call('GET', `/api/ccts/${ent}/form-a?fy=2025`, undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Form A draft', 'Monthly data', 'Method']);
  const a = wb.getWorksheet('Form A draft')!;
  const val = (label: RegExp) => { let v: unknown; a.eachRow((r) => { if (label.test(String(r.getCell(1).value))) v = r.getCell(2).value; }); return v; };
  assert.equal(val(/^Registration no/), 'CCTS-CEM-001'); assert.equal(val(/^Compliance year/), '2025-26');
  near(val(/^Achieved GEI/) as number, (200 + 500 + 30 * 0.716) / 1000);
  let found = false; a.eachRow((r) => { if (r.getCell(1).value === 'Waste heat recovery 13 MW') found = true; });
  assert.ok(found);
});
