/**
 * Energy management & savings: the calculation (pure) and the API on a real PostgreSQL database.
 *
 *   ENERGY_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_energy_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { compare, economics, fit, monthsOf, predict, type MonthRow } from '../src/lib/energy.js';
process.env.RATE_LIMIT = 'off';

const near = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const CDD = [120, 150, 260, 380, 520, 600, 640, 650, 560, 420, 250, 140];

test('baseline model: least squares recovers the line; quality per ASHRAE Guideline 14', () => {
  const rows: MonthRow[] = monthsOf(2024).map((m, i) => ({ month: m, energy: { electricity: 20_000 + 100 * CDD[i]! + (i % 2 ? 300 : -300) }, cdd: CDD[i] }));
  const m = fit(rows, 'electricity', ['cdd']);
  near(m.coef[1], 100, 0.02); near(m.coef[0], 20_000, 0.01);
  assert.equal(m.n, 12); assert.ok(m.r2! > 0.99); assert.ok(m.cvrmse! < 2); assert.ok(Math.abs(m.nmbe!) < 0.01); assert.equal(m.valid, true);
  assert.ok(Math.abs(m.t[1]!) > 2);
  near(predict(m, { month: '2025-07', energy: {}, cdd: 640 }), m.coef[0]! + m.coef[1]! * 640);
  // two variables
  const prod = [900, 950, 1000, 980, 1020, 1100, 1050, 990, 1010, 1080, 970, 930];
  const r2 = monthsOf(2024).map((mo, i) => ({ month: mo, energy: { fuel: 5000 + 40 * prod[i]! + 10 * CDD[i]! }, production: prod[i], cdd: CDD[i] }));
  const m2 = fit(r2, 'fuel', ['production', 'cdd']);
  near(m2.coef[1], 40, 1e-6); near(m2.coef[2], 10, 1e-6);
  // too few months, noisy data
  assert.equal(fit(rows.slice(0, 6), 'electricity', ['cdd']).valid, false);
  const noisy = rows.map((r, i) => ({ ...r, energy: { electricity: (r.energy.electricity ?? 0) * (i % 2 ? 1.4 : 0.6) } }));
  const mn = fit(noisy, 'electricity', ['cdd']);
  assert.equal(mn.valid, false); assert.ok(mn.problems.some((p) => p.includes('CV(RMSE)')));
  // a variable that never changes is refused, not fitted
  const flat = fit(rows.map((r) => ({ ...r, production: 1234.567 })), 'electricity', ['production']);
  assert.equal(flat.valid, false); assert.equal(flat.coef.length, 0); assert.ok(flat.problems[0]!.includes('does not change'));
});

test('savings: expected − actual, CUSUM, anomalies; measure economics', () => {
  const base: MonthRow[] = monthsOf(2024).map((m, i) => ({ month: m, energy: { electricity: 20_000 + 100 * CDD[i]! + (i % 2 ? 200 : -200) }, cdd: CDD[i] }));
  const m = fit(base, 'electricity', ['cdd']);
  const cur: MonthRow[] = monthsOf(2025).map((mo, i) => ({ month: mo, energy: { electricity: i === 6 ? 120_000 : 0.9 * (20_000 + 100 * CDD[i]!) }, cdd: CDD[i] }));
  const p = compare(cur, base, 'electricity', m, 'cdd');
  near(p[0]!.saving, predict(m, cur[0]!)! - cur[0]!.energy.electricity!);
  near(p[11]!.cusum, p.reduce((a, x) => a + x.saving!, 0));
  assert.ok(p[6]!.anomaly?.startsWith('More')); assert.equal(p[0]!.anomaly, null);   // a steady 10% saving is not flagged
  near(p[0]!.enpi, cur[0]!.energy.electricity! / 120);
  // a measure starting in July (a 15% step) flags neither June nor July
  const step: MonthRow[] = monthsOf(2025).map((mo, i) => ({ month: mo, energy: { electricity: (i >= 6 ? 0.85 : 1) * (20_000 + 100 * CDD[i]!) }, cdd: CDD[i] }));
  assert.equal(compare(step, base, 'electricity', m, 'cdd').filter((x) => x.anomaly).length, 0);
  const e = economics({ kwhYear: 100_000, tariff: 0.4, capex: 120_000, lifeYears: 10, kgPerKwh: 0.4 });
  near(e.saveYear, 40_000); near(e.payback, 3); near(e.tYear, 40);
  near(e.npv, -120_000 + 40_000 * ((1 - 1.08 ** -10) / 0.08));
});

// ------------------------------------------------------------------------------------------- API --
const url = process.env.ENERGY_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_energy_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('ENERGY_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', co = '', solo = '', plant = '', mgr = '', prep = '';
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
  co = (await call('POST', '/api/platform/companies', { name: 'Gulf Cold Stores LLC', country: 'AE', products: ['ekotrace', 'energy'], superAdmin: { name: 'SA', email: 'sa@gulfcold.test' } })).body.company.id;
  solo = (await call('POST', '/api/platform/companies', { name: 'Energy Only Co', country: 'AE', products: ['energy'], superAdmin: { name: 'SA2', email: 'sa@eonly.test' } })).body.company.id;
  const root = (await p.query(`SELECT id FROM org_node WHERE tenant_id = $1 AND kind = 'group'`, [co])).rows[0].id;
  plant = (await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'Cold store', country: 'AE' }, co)).body.id;
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'mgr@gulfcold.test','Manager','manager',$2,false), ($1,'prep@gulfcold.test','Preparer','preparer',$2,false)`, [co, pw]);
  mgr = await login('mgr@gulfcold.test', 'correct horse battery'); prep = await login('prep@gulfcold.test', 'correct horse battery');
  const grid = (await p.query(`SELECT i.id, s.category_id FROM item i JOIN subcategory s ON s.id = i.subcategory_id WHERE i.code = 'grid:electricity'`)).rows[0];
  // electricity by month: 2024 baseline follows 20,000 + 100 × CDD; 2025 uses 10% less; one bill spans June–July 2025
  for (const [year, f] of [[2024, 1], [2025, 0.9]] as const) {
    for (let m = 1; m <= 12; m++) {
      if (year === 2025 && (m === 6 || m === 7)) continue;
      const end = new Date(Date.UTC(year, m, 0)).getUTCDate(), kwh = f * (20_000 + 100 * CDD[m - 1]!) + (year === 2024 ? (m % 2 ? 250 : -250) : 0);
      await p.query(`INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, gwp_set, co2e_direct, co2e_scope2, steps, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'kWh_e','AR5',0,$8,'[]','approved')`,
        [co, plant, grid.category_id, grid.id, `${year}-${String(m).padStart(2, '0')}-01`, `${year}-${String(m).padStart(2, '0')}-${end}`, kwh, kwh * 0.4]);
    }
  }
  const jj = 0.9 * (20_000 + 100 * CDD[5]!) + 0.9 * (20_000 + 100 * CDD[6]!);   // 61 days: June 30, July 31
  await p.query(`INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, gwp_set, co2e_direct, co2e_scope2, steps, status) VALUES ($1,$2,$3,$4,'2025-06-01','2025-07-31',$5,'kWh_e','AR5',0,$6,'[]','approved')`,
    [co, plant, grid.category_id, grid.id, jj, jj * 0.4]);
  await p.query(`INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, gwp_set, co2e_direct, co2e_scope2, steps, status) VALUES ($1,$2,$3,$4,'2025-03-01','2025-03-31',999999,'kWh_e','AR5',0,0,'[]','submitted')`,
    [co, plant, grid.category_id, grid.id]);
  await p.end();
});
after(async () => { await app?.close(); await pool?.end(); });

let site = '';
test('API: a package of its own; sites by super admin or admin', async () => {
  const off = (await call('POST', '/api/platform/companies', { name: 'No Energy Co', country: 'AE', superAdmin: { name: 'No Energy admin', email: 'x@noen.test' } })).body.company.id;
  const r = await call('GET', '/api/energy', undefined, off);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'PRODUCT_OFF');
  assert.equal((await call('POST', '/api/energy/sites', { name: 'Cold store' }, co, mgr)).status, 403);
  assert.equal((await call('POST', '/api/energy/sites', { name: 'Bad target', baselineYear: 2024, targetPct: 10, targetYear: 2024 }, co)).status, 400);
  assert.equal((await call('POST', '/api/energy/sites', { name: 'No floor', enpiVar: 'floor' }, co)).status, 400);
  const s = await call('POST', '/api/energy/sites', { name: 'Cold store Jebel Ali', nodeId: plant, siteType: 'warehouse', floorM2: 12_000, baselineYear: 2024, modelTarget: 'electricity', modelVars: ['cdd'], enpiVar: 'floor', tariffs: { electricity: 0.38 }, targetPct: 15, targetYear: 2028 }, co);
  assert.equal(s.status, 200, s.text); site = s.body.id;
});

test('API: energy from entries (approved, split by days), degree days typed, baseline model, savings and CUSUM', async () => {
  const months = [2024, 2025].flatMap((y) => CDD.map((c, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, cdd: c })));
  assert.equal((await call('PUT', `/api/energy/sites/${site}/months`, { months }, co, prep)).status, 200);
  const d = (await call('GET', `/api/energy/sites/${site}?year=2025`, undefined, co)).body;
  const jun = d.months[5], jul = d.months[6];
  near(jun.energy.electricity + jul.energy.electricity, 0.9 * (40_000 + 100 * (CDD[5]! + CDD[6]!)));
  near(jun.energy.electricity / jul.energy.electricity, 30 / 31);                              // split by days
  near(d.months[2].energy.electricity, 0.9 * (20_000 + 100 * CDD[2]!));                        // the submitted entry left out
  assert.equal(d.model.valid, true); near(d.model.coef[1], 100, 0.02);
  near(d.saving, 0.1 * (12 * 20_000 + 100 * CDD.reduce((a, b) => a + b, 0)), 0.01);          // 10% less than the model says
  near(d.months[11].cusum, d.saving);
  near(d.savingCost, d.saving * 0.38); near(d.savingT, (d.saving * 0.4) / 1000, 1e-6);       // inventory intensity 0.4 kg/kWh
  near(d.enpiChange, -0.1, 0.01); assert.equal(d.target.onTrack, true);
  // a typed month replaces the inventory figure for that carrier
  await call('PUT', `/api/energy/sites/${site}/months`, { months: [{ month: '2025-01', cdd: CDD[0], energy: { electricity: 50_000 }, note: 'Meter replaced' }] }, co, mgr);
  const d2 = (await call('GET', `/api/energy/sites/${site}?year=2025`, undefined, co)).body;
  assert.equal(d2.months[0].energy.electricity, 50_000); assert.equal(d2.months[0].source.electricity, 'typed'); assert.ok(d2.months[0].anomaly);
  await call('PUT', `/api/energy/sites/${site}/months`, { months: [{ month: '2025-01', cdd: CDD[0], energy: {} }] }, co, mgr);
  assert.equal((await call('PUT', `/api/energy/sites/${site}/months`, { months: [{ month: '0000-01' }] }, co, mgr)).status, 400);
});

test('API: measures (economics, verified needs IPMVP), energy review, Excel, standalone typed', async () => {
  const M = { siteId: site, title: 'Cold room door strip curtains', category: 'insulation', carrier: 'electricity', status: 'verified', implementedOn: '2025-02-01', kwhExpected: 60_000, kwhVerified: 52_000, ipmvp: null, capex: 45_000, lifeYears: 5 };
  assert.equal((await call('POST', '/api/energy/measures', M, co, mgr)).status, 400);           // verified without the IPMVP option
  assert.equal((await call('POST', '/api/energy/measures', { ...M, ipmvp: 'B' }, co, prep)).status, 403);
  assert.equal((await call('POST', '/api/energy/measures', { ...M, ipmvp: 'B' }, co, mgr)).status, 200);
  assert.equal((await call('POST', '/api/energy/seus', { siteId: site, name: 'Refrigeration compressors', carrier: 'electricity', sharePct: 68, variables: 'Outdoor temperature, door openings', enpi: 'kWh per m³ stored', controls: 'Set points, defrost schedule' }, co, mgr)).status, 200);
  const d = (await call('GET', `/api/energy/sites/${site}?year=2025`, undefined, co)).body;
  const m = d.measures[0];
  near(m.econ.saveYear, 52_000 * 0.38); near(m.econ.payback, 45_000 / (52_000 * 0.38)); near(m.econ.tYear, 52_000 * 0.4 / 1000, 1e-6);
  assert.equal(d.seus.length, 1);
  const o = (await call('GET', '/api/energy?year=2025', undefined, co)).body;
  assert.equal(o.sites.length, 1); assert.equal(o.measures.length, 1); assert.ok(o.sites[0].year.eui > 0);
  const x = await call('GET', `/api/energy/sites/${site}/export?year=2025`, undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'Months', 'Baseline model', 'Measures', 'Energy review (SEUs)', 'Method']);
  assert.equal((await call('GET', '/api/energy/export?year=2025', undefined, co)).status, 200);
  // without the GHG inventory: typed energy only, no link, typed emission factors
  const s = await call('POST', '/api/energy/sites', { name: 'HQ tower', nodeId: plant, siteType: 'office', floorM2: 8000, baselineYear: 2024, factors: { electricity: 0.45 }, tariffs: { electricity: 0.3 } }, solo);
  assert.equal(s.status, 200, s.text);
  await call('PUT', `/api/energy/sites/${s.body.id}/months`, { months: [{ month: '2025-01', energy: { electricity: 100_000 } }, { month: '2024-01', energy: { electricity: 110_000 } }] }, solo);
  const sd = (await call('GET', `/api/energy/sites/${s.body.id}?year=2025`, undefined, solo)).body;
  assert.equal(sd.site.nodeId, null); assert.equal(sd.months[0].energy.electricity, 100_000); assert.equal(sd.kgPerKwh.electricity, 0.45);
  assert.equal((await call('GET', `/api/energy/sites/${site}`, undefined, solo)).status, 404);   // another company's site
});
