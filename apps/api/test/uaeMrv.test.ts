/**
 * UAE MRV: the calculation (pure) and the API on a real PostgreSQL database.
 *
 *   UAEMRV_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_uaemrv_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { activity, calendar, classify, eadStatus, facility, federal, gases, matchFuel, tierOf, type Stream } from '../src/lib/uaeMrv.js';
process.env.RATE_LIMIT = 'off';

const near = (a: number | null | undefined, b: number, eps = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const AR5 = { CO2: 1, CH4: 28, N2O: 265, 'HFC-134a': 1300 };

test('combustion: TJ × EF × oxidation; CH4 and N2O per TJ; tonnes, kL and thousand Nm³ through NCV and density', () => {
  const g = gases({ id: 'a', name: 'NG', kind: 'combustion', fuel: 'natural_gas', adQty: 1000, adUnit: 'TJ' });
  near(g.co2, 56_100); near(g.ch4, 1); near(g.n2o, 0.1);
  near(activity({ id: 'b', name: 'NG', kind: 'combustion', fuel: 'natural_gas', adQty: 1000, adUnit: 'kNm3' }).tj, 36);
  near(activity({ id: 'c', name: 'D', kind: 'combustion', fuel: 'gas_diesel', adQty: 100, adUnit: 't' }).tj, 4.3);
  near(activity({ id: 'd', name: 'D', kind: 'combustion', fuel: 'gas_diesel', adQty: 100, adUnit: 'kL' }).tj, 100 * 0.84 * 0.043);
  near(gases({ id: 'e', name: 'D', kind: 'combustion', fuel: 'gas_diesel', adQty: 10, adUnit: 'TJ', of: 0.99, ef: 74 }).co2, 10 * 74 * 0.99);
  const mob = gases({ id: 'f', name: 'Fleet', kind: 'combustion', fuel: 'gas_diesel', mobile: true, adQty: 10, adUnit: 'TJ' });
  near(mob.ch4, 0.039); near(mob.n2o, 0.039);
  const bio = gases({ id: 'g', name: 'Mix', kind: 'combustion', fuel: 'gas_diesel', adQty: 10, adUnit: 'TJ', biomass: 0.07 });
  near(bio.co2, 741 * 0.93); near(bio.co2Bio, 741 * 0.07);
  assert.equal(matchFuel('Diesel (average biofuel blend)')?.code, 'gas_diesel');
  assert.equal(matchFuel('Biodiesel ME', true)?.code, 'biodiesel');
  assert.equal(matchFuel('Natural gas Gaseous fuels')?.code, 'natural_gas');
  assert.ok(gases({ id: 'h', name: 'x', kind: 'combustion', adQty: 1, adUnit: 't' }).problems.length);   // no fuel, no NCV
});

test('process, mass balance, measured and other gases', () => {
  near(gases({ id: 'p', name: 'Clinker', kind: 'process', adQty: 1000, adUnit: 't', ef: 0.525, of: 1 }).co2, 525);
  near(gases({ id: 'm', name: 'Coke in', kind: 'mass_balance', adQty: 100, adUnit: 't', carbon: 0.85 }).co2, 100 * 0.85 * 44 / 12);
  near(gases({ id: 'o', name: 'Steel out', kind: 'mass_balance', adQty: 1000, adUnit: 't', carbon: 0.002, direction: 'output' }).co2, -1000 * 0.002 * 44 / 12);
  near(gases({ id: 'x', name: 'Stack', kind: 'measured', measuredCo2: 12_000, measuredCh4: 2 }).ch4, 2);
  near(facility([{ id: 'r', name: 'R134a', kind: 'gas', gas: 'HFC-134a', gasT: 0.1 }], AR5).total, 130);
});

test('tiers, source-stream classes and whole-facility uncertainty', () => {
  assert.deepEqual([1, 2, 4, 6, 9, null].map(tierOf), [4, 3, 2, 1, 0, null]);
  const cls = classify([{ id: 'big', co2e: 100_000 }, { id: 'mid', co2e: 3000 }, { id: 's1', co2e: 500 }, { id: 's2', co2e: 200 }]);
  assert.equal(cls.get('s2'), 'de_minimis'); assert.equal(cls.get('s1'), 'de_minimis'); assert.equal(cls.get('mid'), 'minor'); assert.equal(cls.get('big'), 'major');
  const s: Stream[] = [
    { id: 'a', name: 'Gas turbines', kind: 'combustion', fuel: 'natural_gas', adQty: 1000, adUnit: 'TJ', uncertainty: 6 },   // major at Tier 1: not enough
    { id: 'b', name: 'Boiler', kind: 'combustion', fuel: 'natural_gas', adQty: 1000, adUnit: 'TJ', uncertainty: 2 },
  ];
  const r = facility(s, AR5);
  assert.equal(r.streams[0]!.materiality, 'major'); assert.equal(r.streams[0]!.tier, 1); assert.equal(r.streams[0]!.ok, false);
  assert.equal(r.streams[1]!.ok, true);
  near(r.uncertainty, Math.sqrt((r.streams[0]!.co2e * 0.06) ** 2 + (r.streams[1]!.co2e * 0.02) ** 2) / r.total * 100);
  assert.equal(r.thresholdMet, true); near(r.direct, 2 * (56_100 + 28));
  const fb = facility([{ id: 'f', name: 'Flare', kind: 'combustion', fuel: 'refinery_gas', adQty: 100, adUnit: 'TJ', fallback: true, uncertainty: 12 }], AR5);
  assert.ok(fb.streams[0]!.problems.some((p) => p.includes('Fallback')));   // no reason given
  assert.ok(fb.problems.some((p) => p.includes('7.5%')));
  // fallback with a stream missing its uncertainty: the facility uncertainty is incomplete, not a pass
  const fb2 = facility([{ id: 'f', name: 'Flare', kind: 'combustion', fuel: 'refinery_gas', adQty: 100, adUnit: 'TJ', fallback: true, note: 'No meter on the flare line' }, { id: 'g', name: 'GT', kind: 'combustion', fuel: 'natural_gas', adQty: 2000, adUnit: 'TJ', uncertainty: 1 }], AR5);
  assert.equal(fb2.uncertaintyComplete, false); assert.ok(fb2.problems.some((p) => p.includes('missing')));
  // carbon out counts by its size in the classes; mobile fuels without road factors use the stationary ones
  assert.equal(classify([{ id: 'in', co2e: 50_000 }, { id: 'out', co2e: -30_000 }]).get('out'), 'major');
  near(gases({ id: 'k', name: 'Kerosene fleet', kind: 'combustion', fuel: 'kerosene', mobile: true, adQty: 10, adUnit: 'TJ' }).ch4, 0.03);
});

test('who reports: EAD threshold and sectors; federal NRCC threshold; calendar', () => {
  assert.equal(eadStatus({ emirate: 'AZ', sector: 'industry' }, 30_000, 2025).status, 'required');
  assert.equal(eadStatus({ emirate: 'AZ', sector: 'industry' }, 20_000, 2025).status, 'below');
  assert.equal(eadStatus({ emirate: 'AZ', sector: 'other' }, 90_000, 2025).status, 'voluntary');
  assert.equal(eadStatus({ emirate: 'DU', sector: 'industry' }, 90_000, 2025).status, 'not_abu_dhabi');
  assert.match(eadStatus({ emirate: 'AZ', sector: 'power' }, 90_000, 2026).text, /verified/);
  assert.match(eadStatus({ emirate: 'AZ', sector: 'power', operationsStart: '2026-02-01' }, 90_000, 2026).text, /first year/);
  assert.equal(federal(450_000, 60_000, 'unknown').large, true);
  assert.equal(federal(100, 50, 'no').large, false);
  const cal = calendar(2026, { registeredOn: '2026-01-15' });
  assert.ok(cal.some((x) => x.date === '2027-03-31')); assert.ok(cal.some((x) => x.date === '2026-07-01')); assert.ok(cal.some((x) => x.date === '2026-04-15'));
});

// ------------------------------------------------------------------------------------------- API --
const url = process.env.UAEMRV_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_uaemrv_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('UAEMRV_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', co = '', solo = '', plage = '', mgr = '';

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
  co = (await call('POST', '/api/platform/companies', { name: 'Musaffah Industries LLC', country: 'AE', products: ['ekotrace', 'uaemrv'], superAdmin: { name: 'SA', email: 'sa@musaffah.test' } })).body.company.id;
  solo = (await call('POST', '/api/platform/companies', { name: 'Ruwais Polymers', country: 'AE', products: ['uaemrv'], superAdmin: { name: 'SA2', email: 'sa@ruwais.test' } })).body.company.id;
  await p.query(`UPDATE tenant SET gwp_set = 'AR5' WHERE id = ANY($1)`, [[co, solo]]);
  const root = (await p.query(`SELECT id FROM org_node WHERE tenant_id = $1 AND kind = 'group'`, [co])).rows[0].id;
  plage = (await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'ICAD plant', country: 'AE' }, co)).body.id;
  await p.query(`UPDATE org_node SET grid_region = 'AE-AZ' WHERE id = $1`, [plage]);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'mgr@musaffah.test','Manager','manager',$2,false)`, [co, pw]);
  mgr = await login('mgr@musaffah.test', 'correct horse battery');

  // gases and AR5 values (the seed loads the full lists; the test needs four)
  await p.query(`INSERT INTO gas (code, name, family, kyoto) VALUES ('CO2','Carbon dioxide','CO2',true), ('CH4','Methane','CH4',true), ('N2O','Nitrous oxide','N2O',true), ('HFC-134a','HFC-134a','HFC',true) ON CONFLICT (code) DO NOTHING`);
  await p.query(`INSERT INTO gwp_set (code, name) VALUES ('AR5', 'IPCC AR5') ON CONFLICT (code) DO NOTHING`);
  await p.query(`INSERT INTO gwp_value (gwp_set, gas, value, source) VALUES ('AR5','CO2',1,'AR5'), ('AR5','CH4',28,'AR5'), ('AR5','N2O',265,'AR5'), ('AR5','HFC-134a',1300,'AR5') ON CONFLICT DO NOTHING`);
  const cat = async (code: string) => (await p.query(`SELECT id FROM category WHERE code = $1`, [code])).rows[0].id as number;
  const sc = await cat('stationary_combustion');
  const sub = (await p.query(`INSERT INTO subcategory (category_id, code, name, units) VALUES ($1, 'test-gas', 'Gaseous fuels', '{kWh}') RETURNING id`, [sc])).rows[0].id;
  const ng = (await p.query(`INSERT INTO item (subcategory_id, code, name) VALUES ($1, 'test:ng', 'Natural gas') RETURNING id`, [sub])).rows[0].id;
  const grid = (await p.query(`SELECT i.id, s.category_id FROM item i JOIN subcategory s ON s.id = i.subcategory_id WHERE i.code = 'grid:electricity'`)).rows[0];
  const fc = await cat('fugitive');
  const fsub = (await p.query(`INSERT INTO subcategory (category_id, code, name, units) VALUES ($1, 'test-ref', 'Refrigerants', '{kg}') RETURNING id`, [fc])).rows[0].id;
  const fug = { category_id: fc, id: (await p.query(`INSERT INTO item (subcategory_id, code, name) VALUES ($1, 'test:r134a', 'R-134a') RETURNING id`, [fsub])).rows[0].id as number };
  const ins = async (catId: number, item: number, s: string, e: string, q: number, unit: string, kg: number, kg2 = 0, status = 'approved') =>
    (await p.query(`INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, gwp_set, co2e_direct, co2e_scope2, steps, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AR5',$9,$10,'[]',$11) RETURNING id`,
      [co, plage, catId, item, s, e, q, unit, kg, kg2, status])).rows[0].id as string;
  await ins(sc, ng, '2025-01-01', '2025-11-30', 125_000_000, 'kWh', 22_700_000);           // 450 TJ
  await ins(sc, ng, '2025-12-01', '2026-01-31', 62_000_000, 'kWh', 11_200_000);            // 31 of 62 days in 2025 → 111.6 TJ
  await ins(sc, ng, '2025-06-01', '2025-06-30', 999_000_000, 'kWh', 1, 0, 'submitted');    // not approved
  await ins(grid.category_id, grid.id, '2025-01-01', '2025-12-31', 10_000_000, 'kWh_e', 0, 4_000_000);
  const leak = await ins(fug.category_id, fug.id, '2025-01-01', '2025-12-31', 100, 'kg', 130_000);
  await p.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, method) VALUES ($1,$2,'direct','HFC-134a',100,130000,'gas')`, [leak, co]);
  await p.end();
});
after(async () => { await app?.close(); await pool?.end(); });

let fac = '';
test('API: a package of its own; add a reporting facility linked to the inventory', async () => {
  const off = (await call('POST', '/api/platform/companies', { name: 'No MRV Co', country: 'AE', superAdmin: { name: 'No MRV admin', email: 'x@nomrv.test' } })).body.company.id;
  const r = await call('GET', '/api/uae-mrv', undefined, off);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'PRODUCT_OFF');
  assert.equal((await call('POST', '/api/uae-mrv/facilities', { name: 'ICAD', emirate: 'AZ', sector: 'industry' }, co, mgr)).status, 403);
  const f = await call('POST', '/api/uae-mrv/facilities', { name: 'ICAD steel works', nodeId: plage, emirate: 'AZ', sector: 'industry', eadId: 'EAD-F-0042', registeredOn: '2025-02-10', verifier: 'Test Verifier LLC', verifierSince: 2019 }, co);
  assert.equal(f.status, 200, f.text); fac = f.body.id;
  assert.equal((await call('POST', '/api/uae-mrv/facilities', { name: 'icad steel works', emirate: 'AZ', sector: 'industry' }, co)).status, 400);   // same name
});

test('API: streams from entries (calendar year, split by days, approved only), IPCC defaults, threshold and checks', async () => {
  const r = await call('POST', `/api/uae-mrv/facilities/${fac}/years/2025/from-entries`, undefined, co, mgr);
  assert.equal(r.status, 200, r.text); assert.equal(r.body.added, 2);
  let d = (await call('GET', `/api/uae-mrv/facilities/${fac}?year=2025`, undefined, co)).body;
  const ng = d.streams.find((s: Stream) => s.kind === 'combustion');
  near(ng.adQty, 450 + 111.6); assert.equal(ng.fuel, 'natural_gas'); assert.equal(ng.adUnit, 'TJ');
  near(d.result.co2, (450 + 111.6) * 56.1);
  assert.equal(d.ead.status, 'required');                                     // 31,506 t CO2 ≥ 25,000
  near(d.result.total, (450 + 111.6) * (56.1 + 0.028 + 0.0265) + 130);
  assert.ok(d.result.streams.some((s: { problems: string[] }) => s.problems.some((p) => p.includes('uncertainty'))));
  assert.ok(d.problems.some((p: string) => p.includes('years running')));   // verifier since 2019: 7 years by 2025
  // people set the uncertainty and instrument; a refresh keeps them
  const streams = d.streams.map((s: Stream) => (s.kind === 'combustion' ? { ...s, uncertainty: 2, instrument: 'Ultrasonic meter FT-101' } : s));
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025/streams`, { streams, version: null }, co, mgr)).status, 409);   // stale: the year changed since
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025/streams`, { version: d.year.updatedAt, streams: [...streams, { id: 'clinker', name: 'Lime kiln', kind: 'process', adQty: 1000, adUnit: 't', ef: 0.785, uncertainty: 4, addToFederal: true }] }, co, mgr)).status, 200);
  assert.equal((await call('POST', `/api/uae-mrv/facilities/${fac}/years/2025/from-entries`, undefined, co, mgr)).body.updated, 2);
  d = (await call('GET', `/api/uae-mrv/facilities/${fac}?year=2025`, undefined, co)).body;
  assert.equal(d.streams.length, 3); assert.equal(d.streams.find((s: Stream) => s.kind === 'combustion').instrument, 'Ultrasonic meter FT-101');
  assert.equal(d.result.streams.find((s: { id: string }) => s.id === 'clinker').materiality, 'de_minimis');
  // removing an inventory stream keeps it removed on refresh; a stream on its own units only gets the comparison
  const gas = d.streams.find((s: Stream) => s.kind === 'gas');
  const ng2 = d.streams.find((s: Stream) => s.kind === 'combustion');
  const own = { ...ng2, adUnit: 'kNm3', adQty: 15_000, ncv: 0.0375 };
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025/streams`, { version: d.year.updatedAt, streams: d.streams.filter((s: Stream) => s !== gas && s !== ng2).concat([own]) }, co, mgr)).status, 200);
  const rf = (await call('POST', `/api/uae-mrv/facilities/${fac}/years/2025/from-entries`, undefined, co, mgr)).body;
  assert.equal(rf.added, 0); assert.equal(rf.skipped, 1); assert.equal(rf.kept, 1);
  d = (await call('GET', `/api/uae-mrv/facilities/${fac}?year=2025`, undefined, co)).body;
  assert.equal(d.streams.some((s: Stream) => s.kind === 'gas'), false); assert.equal(d.streams.find((s: Stream) => s.kind === 'combustion').adQty, 15_000);
  // put the inventory figures back for the next tests
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025/streams`, { version: d.year.updatedAt, streams: d.streams.map((s: Stream) => (s.kind === 'combustion' ? ng2 : s)).concat([gas]) }, co, mgr)).status, 200);
});

test('API: submitted locks the year; status by super admin or admin; verification details; Excel', async () => {
  const Y = { status: 'ready', submittedOn: null, reference: null, production: [{ product: 'Rebar', qty: 400_000, unit: 't' }], gaps: [], qa: 'Monthly meter reconciliation', verifNotified: null, siteVisit: null, verifiedOn: null, opinion: null, statementDoc: null };
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025`, Y, co, mgr)).status, 403);   // managers do not change the status
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025`, { ...Y, status: 'draft' }, co, mgr)).status, 200);
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025`, { ...Y, status: 'submitted' }, co)).status, 400);   // date needed
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025`, { ...Y, status: 'submitted', submittedOn: '2026-03-28', reference: 'EAD-2026-118' }, co)).status, 200);
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025/streams`, { streams: [] }, co, mgr)).status, 409);
  assert.equal((await call('POST', `/api/uae-mrv/facilities/${fac}/years/2025/from-entries`, undefined, co)).status, 409);
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025`, { ...Y, status: 'submitted', submittedOn: '2026-03-28', qa: 'changed' }, co)).status, 409);
  assert.equal((await call('PUT', `/api/uae-mrv/facilities/${fac}/years/2025`, { ...Y, status: 'verified', submittedOn: '2026-03-28', verifiedOn: '2026-05-02', opinion: 'unmodified' }, co)).status, 200);
  assert.equal((await call('DELETE', `/api/uae-mrv/facilities/${fac}`, undefined, co)).status, 409);
  const before = (await call('GET', `/api/uae-mrv/facilities/${fac}?year=2025`, undefined, co)).body.result.total;
  const p = new pg.Client({ connectionString: url }); await p.connect(); await p.query(`SELECT set_config('app.platform','on',false)`);
  await p.query(`UPDATE gwp_value SET value = 30 WHERE gwp_set = 'AR5' AND gas = 'CH4'`);
  near((await call('GET', `/api/uae-mrv/facilities/${fac}?year=2025`, undefined, co)).body.result.total, before);   // frozen at submission
  await p.query(`UPDATE gwp_value SET value = 28 WHERE gwp_set = 'AR5' AND gas = 'CH4'`); await p.end();
  const x = await call('GET', `/api/uae-mrv/facilities/${fac}/years/2025/export`, undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['C1 Identifiers', 'C2 Facility description', 'D1 Source streams', 'D2 Calculation', 'E Measured', 'F Fallback', 'G Methane', 'H1 Verification & gaps', 'I Management & QA', 'J Mitigation', 'Method']);
});

test('API: federal position from entries (UAE facilities, calendar year); measures; IEQT pack; typed without the inventory', async () => {
  assert.equal((await call('POST', '/api/uae-mrv/measures', { title: 'Waste-heat recovery on the reheating furnace', means: 'efficiency', status: 'planned', startYear: 2027, tPerYear: 4200 }, co, mgr)).status, 200);
  assert.equal((await call('PUT', '/api/uae-mrv/company/2025', { designated: 'yes', ieqtStatus: 'registered' }, co, mgr)).status, 403);
  assert.equal((await call('PUT', '/api/uae-mrv/company/2025', { designated: 'yes', designationRef: 'MOCCAE letter 12/2026', ieqtStatus: 'registered' }, co)).status, 200);
  const d = (await call('GET', '/api/uae-mrv?year=2025', undefined, co)).body;
  near(d.federal.s1, 22_700 + 11_200 / 2 + 130 + 785); near(d.federal.processOnly, 785); near(d.federal.s2, 4000);   // + the lime kiln, recorded only in the facility report assert.equal(d.federal.source, 'entries'); assert.equal(d.federal.large, false);
  assert.equal(d.measures.length, 1); assert.equal(d.facilities[0].status, 'verified');
  const x = await call('GET', '/api/uae-mrv/company/2025/export', undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.ok(wb.getWorksheet('By emirate') && wb.getWorksheet('Scope 1 by gas') && wb.getWorksheet('Reduction measures'));
  // without the GHG inventory: no link to inventory facilities, no filling from entries, typed company totals
  const f = await call('POST', '/api/uae-mrv/facilities', { name: 'Cracker', nodeId: plage, emirate: 'AZ', sector: 'oil_gas' }, solo);
  assert.equal(f.status, 200, f.text);
  assert.equal((await call('GET', `/api/uae-mrv/facilities/${f.body.id}`, undefined, solo)).body.facility.nodeId, null);
  assert.equal((await call('POST', `/api/uae-mrv/facilities/${f.body.id}/years/2025/from-entries`, undefined, solo)).status, 400);
  await call('PUT', '/api/uae-mrv/company/2025', { designated: 'unknown', ieqtStatus: 'not_started', s1Typed: 480_000, s2Typed: 40_000 }, solo);
  const s = (await call('GET', '/api/uae-mrv?year=2025', undefined, solo)).body;
  assert.equal(s.federal.source, 'typed'); assert.equal(s.federal.large, true); assert.ok(s.federal.duties.some((x: string) => x.includes('NRCC')));
  assert.equal((await call('GET', `/api/uae-mrv/facilities/${fac}`, undefined, solo)).status, 404);   // another company's facility
});
