/**
 * EPR: obligations by regime, carry-forward, recycled content, certificate rules, the API and its links to the Compliance desk.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { REGIMES, baseOf, periodLabel, positions, recyclerStock, type Cert, type StreamSettings, type YearRow } from '../src/lib/epr.js';

const S = (o: Partial<StreamSettings>): StreamSettings => ({ regime: 'in_plastic', role: 'brand_owner', category: 'cat1', avgLife: null, targetPct: {}, recyclingPct: {}, rcPct: {}, ecRate: null, certPrice: null, feeRate: null, foodContact: false, ...o });
const Y = (year: number, placed: number | null, o: Partial<YearRow> = {}): YearRow => ({ year, placed, preConsumer: null, suppliedToPibo: null, recycledTonnes: null, obligationTyped: null, ...o });
const C = (year: number, tonnes: number, kind: Cert['kind'] = 'recycling', o: Partial<Cert> = {}): Cert => ({ year, kind, direction: 'in', tonnes, price: null, generatedYear: null, ...o });
const close = (a: number | null | undefined, b: number, tol = 1e-6) => assert.ok(a != null && Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('plastic: average of the two previous years; recycling share; carry-forward cleared oldest first; compensation', () => {
  const s = S({ ecRate: 5000, certPrice: 3000 });
  const rows = [Y(2024, 900), Y(2025, 1100, { preConsumer: 50, suppliedToPibo: 150 }), Y(2026, 1200), Y(2027, 1300)];
  assert.deepEqual(baseOf(s, new Map(rows.map((r) => [r.year, r])), 2026), { base: 950, from: 'average of FY 2023-24 and FY 2024-25', partial: false });   // (900 + 1000) / 2
  const p = positions(s, rows, [C(2025, 900), C(2026, 500), C(2026, 200, 'eol'), C(2027, 400)], 2027);   // FY 2024-25: 900 t on FY 2023-24 alone, met
  const y26 = p.find((x) => x.year === 2026)!, y27 = p.find((x) => x.year === 2027)!;
  close(y26.obligation, 950); close(y26.recyclingMin, 570); close(y26.met, 700); close(y26.shortfall, 250); close(y26.recyclingShortfall, 70);
  close(y26.ecExposure, 250 * 5000); close(y26.costToClose, 250 * 3000);
  // FY 2026-27: base (1000 + 1200) / 2 = 1100, 70% recycling; 400 t clear the 250 t carried first
  close(y27.carriedIn, 250); close(y27.obligation, 1100); close(y27.required, 1350); close(y27.shortfall, 950);
  assert.equal(periodLabel('in_plastic', 2026), 'FY 2025-26'); assert.equal(REGIMES.in_plastic.target(2024, 'cat1'), 100);
  assert.equal(REGIMES.in_plastic.recyclingShare!(2028, 'cat2'), 60); assert.equal(REGIMES.in_plastic.recyclingShare!(2028, 'cat4'), 80);
});

test('plastic: a shortfall carried three years stays owed and is flagged; recycling part carried; one-year base flagged', () => {
  const p = positions(S({}), [Y(2022, 100), Y(2023, 100), Y(2024, 100), Y(2025, 100), Y(2026, 100), Y(2027, 100)], [], 2027);
  const y27 = p.find((x) => x.year === 2027)!;
  assert.ok(y27.overdue > 0); assert.ok(y27.warnings.some((w) => /no longer refundable/.test(w)));
  close(y27.shortfall, 70 + 100 * 4);                                         // nothing forfeited: FY 2022-23 70 t + four years of 100 t
  // 100 t carried with its recycling part: recycling certificates clear the carried part first
  const r = positions(S({}), [Y(2023, 100), Y(2024, 100), Y(2025, 100)], [C(2024, 100), C(2026, 100)], 2026);   // FY 2024-25 unmet: 100 t (50 t recycling) carried
  const r26 = r.find((x) => x.year === 2026)!;
  close(r26.carriedIn, 100); close(r26.shortfall, 100); close(r26.recyclingShortfall, 60 + 50 - 100);
  const one = positions(S({}), [Y(2025, 100)], [], 2026).find((x) => x.year === 2026)!;
  assert.ok(one.warnings.some((w) => /one year only/.test(w)));
  // surplus certificates are reported, not lost silently
  const sp = positions(S({}), [Y(2024, 100), Y(2025, 100)], [C(2025, 100), C(2026, 150)], 2026).find((x) => x.year === 2026)!;
  close(sp.surplus, 50);
  // an importer's own recycled content does not count
  const im = positions(S({ role: 'importer' }), [Y(2026, 100, { recycledTonnes: 40 })], [], 2026).find((x) => x.year === 2026)!;
  close(im.rcShortfall, 30); assert.equal(im.rcActual, 0);
});

test('plastic recycled content: G.S.R. 237(E) targets; food-contact shortfall carried three years at one-third a year', () => {
  assert.equal(REGIMES.in_plastic.recycledContent!(2026, 'cat1'), 30); assert.equal(REGIMES.in_plastic.recycledContent!(2029, 'cat1'), 60);
  assert.equal(REGIMES.in_plastic.recycledContent!(2027, 'cat2'), 10); assert.equal(REGIMES.in_plastic.recycledContent!(2028, 'cat3'), 10);
  const rows = [Y(2026, 1000, { recycledTonnes: 150 }), Y(2027, 1000, { recycledTonnes: 450 }), Y(2028, 1000, { recycledTonnes: 500 })];
  const p = positions(S({ foodContact: true }), rows, [], 2029);
  const y26 = p.find((x) => x.year === 2026)!, y27 = p.find((x) => x.year === 2027)!, y28 = p.find((x) => x.year === 2028)!;
  close(y26.rcRequired, 300); close(y26.rcShortfall, 0); close(y26.rcCarried, 150);                  // 150 t carried, not a shortfall yet
  close(y27.rcRequired, 400); close(y27.rcCarried, 100); close(y27.rcBehind, 0);                     // 50 t surplus clears one-third
  close(y28.rcRequired, 500); close(y28.rcCarried, 100); close(y28.rcBehind, 50);                    // no surplus: behind schedule
  assert.ok(y28.warnings.some((w) => /behind/.test(w)));
  const plain = positions(S({}), rows, [], 2026).find((x) => x.year === 2026)!;
  close(plain.rcShortfall, 150);                                                                    // not food contact: a shortfall
});

test('e-waste: one average life earlier × 60 / 70 / 80%; batteries need the portal target; tyres two years earlier with validity and a cap', () => {
  const e = positions(S({ regime: 'in_ewaste', category: 'itew', avgLife: 5, role: 'producer' }), [Y(2021, 100), Y(2023, 200)], [], 2028);
  close(e.find((x) => x.year === 2026)!.obligation, 70); close(e.find((x) => x.year === 2028)!.obligation, 160);
  assert.equal(e.find((x) => x.year === 2027)!.obligation, null);   // nothing placed in 2022
  const b = positions(S({ regime: 'in_battery', category: 'portable', avgLife: 3, role: 'producer' }), [Y(2023, 50), Y(2026, 60)], [], 2026);
  assert.equal(b.find((x) => x.year === 2026)!.obligation, null); assert.ok(b.find((x) => x.year === 2026)!.warnings.some((w) => /target/.test(w)));
  const b2 = positions(S({ regime: 'in_battery', category: 'portable', avgLife: 3, role: 'producer', targetPct: { 2026: 70 } }), [Y(2023, 50)], [], 2026);
  close(b2.find((x) => x.year === 2026)!.obligation, 35);
  assert.equal(REGIMES.in_battery.recycledContent!(2028, 'ev'), 5); assert.equal(REGIMES.in_battery.recycledContent!(2027, 'industrial'), 40);
  const ty = positions(S({ regime: 'in_tyre', category: 'new', role: 'producer' }), [Y(2024, 1000)], [C(2026, 300, 'recycling', { generatedYear: 2023 }), C(2026, 1200, 'recycling', { generatedYear: 2025 })], 2026);
  const t26 = ty.find((x) => x.year === 2026)!;
  close(t26.obligation, 1000); close(t26.lapsed, 300); close(t26.met, 1200); assert.ok(t26.overCap); assert.ok(t26.warnings.some((w) => /lapsed/.test(w)));
  close(positions(S({ regime: 'in_tyre', category: 'imported_waste', role: 'importer' }), [Y(2022, 500)], [], 2023).find((x) => x.year === 2023)!.obligation, 500);   // imported waste tyres: 100% of the year before
});

test('EU PPWR: recycled content from 2030 by plastic type; recycler stock', () => {
  assert.equal(REGIMES.eu_ppwr.recycledContent!(2029, 'plastic_other'), null); assert.equal(REGIMES.eu_ppwr.recycledContent!(2030, 'plastic_cs_pet'), 30);
  assert.equal(REGIMES.eu_ppwr.recycledContent!(2040, 'plastic_bottles'), 65); assert.equal(REGIMES.eu_ppwr.recycledContent!(2030, 'paper'), null);
  const r = positions(S({ role: 'recycler' }), [Y(2026, 5000)], [C(2026, 4000, 'recycling', { generatedYear: 2026 }), { year: 2026, kind: 'recycling', direction: 'out', tonnes: 2500, price: 4000, generatedYear: null }], 2026);
  const y = r.find((x) => x.year === 2026)!;
  assert.equal(y.obligation, null); assert.equal(y.stockIn, 4000); assert.equal(y.stockOut, 2500);
  // tyres: sales draw on the oldest valid certificates; unsold ones lapse after two years
  const st = recyclerStock('in_tyre', [C(0, 100, 'recycling', { year: null, generatedYear: 2022 }), { year: 2023, kind: 'recycling', direction: 'out', tonnes: 100, price: null, generatedYear: null }, C(0, 100, 'recycling', { year: null, generatedYear: 2025 })], 2025);
  assert.deepEqual([st.generated, st.sold, st.lapsed, st.available], [200, 100, 0, 100]);
  const st2 = recyclerStock('in_tyre', [C(0, 100, 'recycling', { year: null, generatedYear: 2022 })], 2025);
  assert.deepEqual([st2.lapsed, st2.available], [100, 0]);
  const st3 = recyclerStock('in_tyre', [C(0, 100, 'recycling', { year: null, generatedYear: 2022 }), { year: 2026, kind: 'recycling', direction: 'out', tonnes: 50, price: null, generatedYear: null }], 2026);
  assert.equal(st3.problems.length, 1);                                    // sold after the certificates lapsed
});

// ------------------------------------------------------------------------------------------- API --
const url = process.env.EPR_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_epr_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('EPR_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', co = '', mgr = '', prep = '', ver = '';
const call = async (method: string, path: string, body?: unknown, tenant?: string, cookie = admin) => {
  const headers: Record<string, string> = { cookie };
  if (tenant) headers['x-tenant-id'] = tenant;
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, raw: r.rawPayload };
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
  co = (await call('POST', '/api/platform/companies', { name: 'Ganga Foods Ltd', country: 'IN', products: ['epr', 'compliance'], superAdmin: { name: 'SA', email: 'sa@ganga.test' } })).body.company.id;
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'mgr@ganga.test','Manager','manager',$2,false), ($1,'prep@ganga.test','Preparer','preparer',$2,false), ($1,'ver@ganga.test','Verifier','verifier',$2,false)`, [co, pw]);
  mgr = await login('mgr@ganga.test', 'correct horse battery'); prep = await login('prep@ganga.test', 'correct horse battery'); ver = await login('ver@ganga.test', 'correct horse battery');
  await p.end();
});
after(async () => { await app?.close(); await pool?.end(); });

const STREAM = { regime: 'in_plastic', role: 'brand_owner', category: 'cat1', name: 'Rigid bottles and jars', registration: 'PROD-BO-1234', foodContact: true, ecRate: 5000, certPrice: 3200, currency: 'INR' };

test('API: package, roles, streams, years, certificates, carry-forward, returns, Excel, Compliance desk', async () => {
  const off = (await call('POST', '/api/platform/companies', { name: 'No EPR Co', country: 'IN', superAdmin: { name: 'No EPR admin', email: 'x@noepr.test' } })).body.company.id;
  const r0 = await call('GET', '/api/epr', undefined, off);
  assert.equal(r0.status, 403); assert.equal(r0.body.error, 'PRODUCT_OFF');
  assert.equal((await call('POST', '/api/epr/streams', STREAM, co, mgr)).status, 403);                                       // set-up: super admin or admin
  assert.equal((await call('POST', '/api/epr/streams', { ...STREAM, category: 'itew' }, co)).status, 400);                     // not a plastic category
  assert.equal((await call('POST', '/api/epr/streams', { ...STREAM, regime: 'in_ewaste', category: 'itew', role: 'producer' }, co)).status, 400);   // average life needed
  const sid = (await call('POST', '/api/epr/streams', STREAM, co)).body.id;
  assert.ok(sid);
  // quantities: a preparer may type them; recycled content cannot exceed what was placed
  assert.equal((await call('PUT', `/api/epr/streams/${sid}/years`, { rows: [{ year: 2026, placed: 100, recycledTonnes: 150 }] }, co, prep)).status, 400);
  assert.equal((await call('PUT', `/api/epr/streams/${sid}/years`, { rows: [{ year: 2024, placed: 900 }, { year: 2025, placed: 1000 }, { year: 2026, placed: 1200, recycledTonnes: 300 }] }, co, prep)).status, 200);
  assert.equal((await call('PUT', `/api/epr/streams/${sid}/years`, { rows: [{ year: 2027, placed: 1 }] }, co, ver)).status, 403);
  // certificates: a manager records them; the year is needed; a producer does not sell
  assert.equal((await call('POST', '/api/epr/certs', { streamId: sid, direction: 'in', kind: 'recycling', year: null, tonnes: 500 }, co, mgr)).status, 400);
  assert.equal((await call('POST', '/api/epr/certs', { streamId: sid, direction: 'out', kind: 'recycling', year: 2026, tonnes: 10 }, co, mgr)).status, 400);
  assert.equal((await call('POST', '/api/epr/certs', { streamId: sid, direction: 'in', kind: 'recycling', year: 2025, tonnes: 900 }, co, mgr)).status, 200);   // FY 2024-25 met
  assert.equal((await call('POST', '/api/epr/certs', { streamId: sid, direction: 'in', kind: 'recycling', year: 2026, tonnes: 600, price: 3100, certificateNo: 'PWP-2026-0001', counterparty: 'Shakti Recyclers' }, co, mgr)).status, 200);
  assert.equal((await call('POST', '/api/epr/certs', { streamId: sid, direction: 'in', kind: 'recycling', year: 2026, tonnes: 5, certificateNo: 'PWP-2026-0001' }, co, mgr)).status, 400);   // number twice
  let d = (await call('GET', `/api/epr/streams/${sid}?year=2026`, undefined, co)).body;
  const p26 = d.positions.find((x: any) => x.year === 2026);
  assert.equal(p26.obligation, 950); assert.equal(p26.met, 600); assert.equal(p26.shortfall, 350); assert.equal(p26.ecExposure, 350 * 5000);
  assert.equal(p26.rcRequired, 360); assert.equal(p26.rcCarried, 60);
  // the overview shows the same position
  const o = (await call('GET', '/api/epr?year=2026', undefined, co)).body;
  assert.equal(o.streams[0].position.shortfall, 350); assert.equal(o.streams[0].returnDue, '2026-06-30'); assert.equal(o.streams[0].label, 'FY 2025-26');
  // a filed return needs a date, then locks the figures of that year
  assert.equal((await call('PUT', `/api/epr/streams/${sid}/years/2026/return`, { status: 'filed' }, co, mgr)).status, 400);
  assert.equal((await call('PUT', `/api/epr/streams/${sid}/years/2026/return`, { status: 'filed', filedOn: '2026-06-28', returnRef: 'AR-2026-77' }, co, mgr)).status, 200);
  assert.equal((await call('PUT', `/api/epr/streams/${sid}/years`, { rows: [{ year: 2026, placed: 1 }] }, co, prep)).status, 409);
  assert.equal((await call('DELETE', `/api/epr/streams/${sid}`, undefined, co)).status, 400);                                 // filed: set inactive instead
  // a filed year is locked against certificates and the settings that change its obligation
  assert.equal((await call('POST', '/api/epr/certs', { streamId: sid, direction: 'in', kind: 'recycling', year: 2026, tonnes: 10 }, co, mgr)).status, 409);
  assert.equal((await call('PUT', `/api/epr/streams/${sid}`, { ...STREAM, targetPct: { 2026: 50 } }, co)).status, 409);
  assert.equal((await call('PUT', `/api/epr/streams/${sid}`, { ...STREAM, targetPct: { 2028: 100 } }, co)).status, 200);      // a later year may change
  assert.equal((await call('PUT', `/api/epr/streams/${sid}`, { ...STREAM, category: 'cat2' }, co)).status, 400);              // regime / role / category fixed once used
  // the same certificate number cannot be applied on two streams
  const s2 = (await call('POST', '/api/epr/streams', { ...STREAM, category: 'cat2', name: 'Flexible wrappers' }, co)).body.id;
  assert.equal((await call('POST', '/api/epr/certs', { streamId: s2, direction: 'in', kind: 'recycling', year: 2027, tonnes: 5, certificateNo: 'PWP-2026-0001' }, co, mgr)).status, 400);
  assert.equal((await call('POST', '/api/epr/certs', { streamId: s2, direction: 'in', kind: 'recycling', year: 2027, tonnes: 5, certificateNo: '' }, co, mgr)).status, 200);
  assert.equal((await call('POST', '/api/epr/certs', { streamId: s2, direction: 'in', kind: 'recycling', year: 2027, tonnes: 5, certificateNo: '  ' }, co, mgr)).status, 200);   // blank numbers are none
  assert.equal((await call('PUT', `/api/epr/streams/${s2}`, { ...STREAM, category: 'cat2', name: 'Flexible wrappers', active: false }, co)).status, 200);
  // a recycler stream: generated, then sold no more than the stock
  const rid = (await call('POST', '/api/epr/streams', { regime: 'in_plastic', role: 'recycler', category: 'cat2', name: 'Flexible film recycling plant', registration: 'PWP-77' }, co)).body.id;
  assert.equal((await call('POST', '/api/epr/certs', { streamId: rid, direction: 'in', kind: 'recycling', year: null, generatedYear: 2026, tonnes: 800 }, co, mgr)).status, 200);
  assert.equal((await call('POST', '/api/epr/certs', { streamId: rid, direction: 'out', kind: 'recycling', year: 2026, tonnes: 900, price: 3000 }, co, mgr)).status, 400);
  const sold = (await call('POST', '/api/epr/certs', { streamId: rid, direction: 'out', kind: 'recycling', year: 2026, tonnes: 500, price: 3000, counterparty: 'Ganga Foods' }, co, mgr)).body.id;
  assert.ok(sold);
  d = (await call('GET', `/api/epr/streams/${rid}?year=2026`, undefined, co)).body;
  assert.deepEqual(d.stock, { generated: 800, sold: 500, lapsed: 0, available: 300, problems: [] });
  assert.equal((await call('POST', '/api/epr/certs', { streamId: rid, direction: 'out', kind: 'recycling', year: null, tonnes: 10 }, co, mgr)).status, 400);   // a sale needs its year
  assert.equal((await call('POST', '/api/epr/certs', { streamId: rid, direction: 'out', kind: 'eol', year: 2026, tonnes: 10 }, co, mgr)).status, 400);       // no end-of-life stock
  // the generated certificate cannot be removed while its sale stands
  const gen = d.certs.find((x: any) => x.direction === 'in').id;
  assert.equal((await call('DELETE', `/api/epr/certs/${gen}`, undefined, co, mgr)).status, 400);
  // Excel
  const x = await call('GET', '/api/epr/export?year=2026', undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Position 2026', 'Years', 'Certificates', 'Method']);
  // Compliance desk: India EPR applies from the streams; the 2026 return reads as done from the module (the recycler stream does not file)
  const cd = (await call('GET', '/api/compliance?year=2026', undefined, co)).body;
  assert.equal(cd.regulations.find((r: any) => r.code === 'in_epr').applies, 'applies');
  const ret = cd.obligations.find((r: any) => r.reg === 'in_epr' && r.obligation === 'return' && r.period === 2026);
  assert.equal(ret.status, 'done'); assert.equal(ret.source, 'module');
  // company separation
  assert.equal((await call('GET', `/api/epr/streams/${sid}`, undefined, off)).status, 403);
});
