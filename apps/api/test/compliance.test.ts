/**
 * Compliance Position Desk: the regulation library (pure) and the API on a real PostgreSQL database.
 *
 *   COMPLIANCE_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_compliance_test npm test -w @ekotrace/api
 *
 * The database is DROPPED and rebuilt (its name must end in _test).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import ExcelJS from 'exceljs';
import { DEFAULT_PROFILE, REGULATION, afterFyEnd, effective, firstFyStarting, instances, periodLabel, sameDay, type Profile } from '../src/lib/compliance.js';
process.env.RATE_LIMIT = 'off';

const P = (x: Partial<Profile>): Profile => ({ ...DEFAULT_PROFILE, ...x });
const ap = (code: string, p: Profile) => REGULATION.get(code)!.applies(p).applies;

test('dates: months after the financial year end; period labels', () => {
  assert.equal(afterFyEnd(2025, 12, 4), '2026-04-30');
  assert.equal(afterFyEnd(2026, 3, 9), '2026-12-31');
  assert.equal(afterFyEnd(2024, 12, 2), '2025-02-28');
  assert.equal(periodLabel(2026, 3), 'FY 2025-26'); assert.equal(periodLabel(2025, 12), 'FY 2025');
  assert.equal(firstFyStarting('2025-01-01', 12), 2025); assert.equal(firstFyStarting('2025-01-01', 6), 2026); assert.equal(firstFyStarting('2025-01-01', 3), 2026);
  assert.equal(firstFyStarting('2026-07-01', 6), 2027); assert.equal(firstFyStarting('2026-07-01', 12), 2027);
  assert.equal(sameDay('2024-02-29', 2027), '2027-02-28'); assert.equal(sameDay('2024-02-29', 2028), '2028-02-29'); assert.equal(sameDay('2025-01-31', 2026), '2026-01-31');
});

test('first periods follow the financial year start; quarterly CBAM holdings; Australia 3 or 4 months', () => {
  const firstOf = (code: string, ob: string, p: Profile) => instances(p, [{ code, applies: 'applies' }], 2024, 2031).find((x) => x.obligation === ob)?.period;
  assert.equal(firstOf('au_asrs', 'report', P({ auGroup: 'group1', fyEndMonth: 6 })), 2026);      // FY 2025-26: the first starting on or after 1 Jan 2025
  assert.equal(firstOf('au_asrs', 'report', P({ auGroup: 'group1', fyEndMonth: 12 })), 2025);
  assert.equal(firstOf('sg_climate', 'issb', P({ listed: 'sgx', sgxSti: true, fyEndMonth: 3 })), 2026);
  assert.equal(firstOf('eu_csrd', 'statement', P({ euEntity: true, fyEndMonth: 3 })), 2028);
  assert.equal(firstOf('sg_climate', 'scope12', P({ countries: ['SG'] })), 2030);               // not listed: may apply from FY2030
  const q = instances(P({}), [{ code: 'eu_cbam', applies: 'applies' }], 2027, 2027).filter((x) => x.obligation.startsWith('quarterly')).map((x) => x.due);
  assert.deepEqual(q, ['2027-03-31', '2027-06-30', '2027-09-30', '2027-12-31']);
  const au = (listed: Profile['listed']) => instances(P({ auGroup: 'group1', listed, fyEndMonth: 6 }), [{ code: 'au_asrs', applies: 'applies' }], 2026, 2026)[0]!.due;
  assert.equal(au('asx'), '2026-09-30'); assert.equal(au('none'), '2026-10-31');
});

test('applicability: CSRD after Omnibus I, CBAM 50 t, SGX tiers, BRSR glide path, UAE, SB 253', () => {
  assert.equal(ap('eu_csrd', P({ euEntity: true, employees: 1200, turnoverEur: 500e6 })), 'applies');
  assert.equal(ap('eu_csrd', P({ euEntity: true, employees: 800, turnoverEur: 900e6 })), 'not_applicable');   // both thresholds needed
  assert.equal(ap('eu_csrd', P({ euTurnoverEur: 600e6, euSubsidiaryTurnoverEur: 250e6 })), 'applies');
  assert.equal(ap('eu_csrd', P({ euTurnoverEur: 600e6, euSubsidiaryTurnoverEur: 100e6 })), 'may_apply');
  assert.equal(ap('eu_cbam', P({ cbamImportTonnes: 49 })), 'not_applicable'); assert.equal(ap('eu_cbam', P({ cbamImportTonnes: 120 })), 'applies');
  const sti = P({ listed: 'sgx', sgxSti: true, fyEndMonth: 12 }), small = P({ listed: 'sgx', fyEndMonth: 12 });
  const ob = (p: Profile, code: string) => instances(p, [{ code: 'sg_climate', applies: 'applies' }], 2025, 2030).filter((x) => x.obligation === code).map((x) => x.period);
  assert.deepEqual(ob(sti, 'scope3'), [2026, 2027, 2028, 2029, 2030]); assert.deepEqual(ob(small, 'scope3'), []);
  assert.equal(ob(small, 'issb')[0], 2030); assert.equal(ob(P({ listed: 'sgx', sgxCapOver1bn: true }), 'issb')[0], 2028); assert.equal(ob(sti, 'assurance')[0], 2029);
  const brsr = instances(P({ indiaTop: 'top500' }), [{ code: 'in_brsr', applies: 'applies' }], 2025, 2027);
  assert.equal(brsr.find((x) => x.obligation === 'core_assurance')!.period, 2026);
  assert.equal(brsr.find((x) => x.obligation === 'brsr' && x.period === 2026)!.due, '2026-08-31'); assert.equal(brsr.find((x) => x.period === 2026)!.label, 'FY 2025-26');
  assert.equal(ap('ae_federal', P({ countries: ['AE'], uaeScope12: 600_000 })), 'applies'); assert.equal(ap('ae_federal', P({ countries: ['AE'] })), 'may_apply'); assert.equal(ap('ae_federal', P({ countries: ['IN'] })), 'not_applicable');
  assert.equal(ap('us_ca_sb253', P({ usRevenueUsd: 2e9, californiaBusiness: true })), 'applies');
  const sb = instances(P({}), [{ code: 'us_ca_sb253', applies: 'applies' }], 2025, 2026);
  assert.equal(sb.find((x) => x.obligation === 'scope12' && x.period === 2025)!.due, '2026-11-10'); assert.equal(sb.find((x) => x.obligation === 'scope12' && x.period === 2026)!.due, null);
  const cbam = instances(P({}), [{ code: 'eu_cbam', applies: 'applies' }], 2025, 2027);
  assert.equal(cbam.filter((x) => x.obligation === 'declarant').length, 1); assert.equal(cbam.find((x) => x.obligation === 'declaration' && x.period === 2026)!.due, '2027-09-30');
  assert.equal(effective(null, '2026-01-01', '2026-02-01'), 'overdue'); assert.equal(effective('done', '2026-01-01', '2026-02-01'), 'done'); assert.equal(effective('in_progress', '2026-03-01', '2026-02-01'), 'in_progress');
});

// ------------------------------------------------------------------------------------------- API --
const url = process.env.COMPLIANCE_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_compliance_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('COMPLIANCE_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;

let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', co = '', mgr = '', prep = '';
const call = async (method: string, path: string, body?: unknown, tenant?: string, cookie = admin) => {
  const headers: Record<string, string> = { cookie };
  if (tenant) headers['x-tenant-id'] = tenant;
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body, raw: r.rawPayload, headers: r.headers };
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
  co = (await call('POST', '/api/platform/companies', { name: 'Indus Steel Ltd', country: 'IN', products: ['ekotrace', 'compliance', 'brsr', 'uaemrv'], superAdmin: { name: 'SA', email: 'sa@indus.test' } })).body.company.id;
  const root = (await p.query(`SELECT id FROM org_node WHERE tenant_id = $1 AND kind = 'group'`, [co])).rows[0].id;
  await call('POST', '/api/org/nodes', { parentId: root, kind: 'facility', name: 'Abu Dhabi rolling mill', country: 'AE' }, co);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'mgr@indus.test','Manager','manager',$2,false), ($1,'prep@indus.test','Preparer','preparer',$2,false)`, [co, pw]);
  mgr = await login('mgr@indus.test', 'correct horse battery'); prep = await login('prep@indus.test', 'correct horse battery');
  await p.end();
});
after(async () => { await app?.close(); await pool?.end(); });

const PROFILE = { fyEndMonth: 3, countries: [], employees: 14_000, turnoverEur: 2.1e9, euTurnoverEur: 300e6, euSubsidiaryTurnoverEur: null, euEntity: false, listed: 'india', sgxSti: false, sgxCapOver1bn: false,
  indiaTop: 'top250', cctsObligated: null, cbamImportTonnes: null, cbamExporter: true, uaeDesignated: 'unknown', uaeScope12: null, eadFacility: null, usRevenueUsd: null, californiaBusiness: false, auGroup: 'none', ukQuoted: false, ukLarge: false };

test('API: a package of its own; profile by super admin or admin; countries from facilities', async () => {
  const off = (await call('POST', '/api/platform/companies', { name: 'No Desk Co', country: 'IN', superAdmin: { name: 'No Desk admin', email: 'x@nodesk.test' } })).body.company.id;
  const r = await call('GET', '/api/compliance', undefined, off);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'PRODUCT_OFF');
  assert.equal((await call('PUT', '/api/compliance/profile', PROFILE, co, mgr)).status, 403);
  assert.equal((await call('PUT', '/api/compliance/profile', PROFILE, co)).status, 200);
  const d = (await call('GET', '/api/compliance?year=2026', undefined, co)).body;
  assert.deepEqual(d.profile.countries, ['AE', 'IN']);
  const app_ = (c: string) => d.regulations.find((x: { code: string }) => x.code === c).applies;
  assert.equal(app_('in_brsr'), 'applies'); assert.equal(app_('eu_csrd'), 'not_applicable'); assert.equal(app_('ae_federal'), 'may_apply'); assert.equal(app_('eu_cbam_supplier'), 'applies'); assert.equal(app_('us_ca_sb253'), 'not_applicable');
  const brsr = d.obligations.find((x: { reg: string; obligation: string; period: number }) => x.reg === 'in_brsr' && x.obligation === 'brsr' && x.period === 2026);
  assert.equal(brsr.due, '2026-08-31'); assert.equal(brsr.label, 'FY 2025-26');
});

test('API: status from the modules, set by people (rules), overdue, own obligations, Excel and calendar', async () => {
  // BRSR Core FY 2025-26 marked final → the BRSR obligation is done
  await call('PUT', '/api/brsr/2025', { revenueInr: 1e10, pppFactor: 22.4, outputQty: null, outputUnit: null, facilityIds: null, provider: 'Test Assurer', approach: 'assurance', status: 'final' }, co);
  let d = (await call('GET', '/api/compliance?year=2026', undefined, co)).body;
  const b = () => d.obligations.find((x: { reg: string; obligation: string; period: number }) => x.reg === 'in_brsr' && x.obligation === 'brsr' && x.period === 2026);
  assert.equal(b().status, 'done'); assert.equal(b().source, 'module');
  const S = { reg: 'in_brsr', obligation: 'value_chain', period: 2026 };
  assert.equal((await call('PUT', '/api/compliance/status', { ...S, status: 'done' }, co, mgr)).status, 400);                 // date needed
  assert.equal((await call('PUT', '/api/compliance/status', { ...S, status: 'not_applicable' }, co, mgr)).status, 400);       // reason needed
  assert.equal((await call('PUT', '/api/compliance/status', { ...S, status: 'in_progress', owner: 'Head of ESG' }, co, prep)).status, 403);
  assert.equal((await call('PUT', '/api/compliance/status', { ...S, status: 'in_progress', owner: 'Head of ESG', dueOverride: '2026-09-15' }, co, mgr)).status, 400);   // moved without a reason
  assert.equal((await call('PUT', '/api/compliance/status', { ...S, status: 'in_progress', owner: 'Head of ESG', dueOverride: '2026-09-15', note: 'AGM moved' }, co, mgr)).status, 200);
  assert.equal((await call('PUT', '/api/compliance/status', { reg: 'in_brsr', obligation: 'nope', period: 2026, status: 'done', doneOn: '2026-01-01' }, co, mgr)).status, 404);
  d = (await call('GET', '/api/compliance?year=2026', undefined, co)).body;
  const vc = d.obligations.find((x: { reg: string; obligation: string; period: number }) => x.reg === 'in_brsr' && x.obligation === 'value_chain' && x.period === 2026);
  assert.equal(vc.due, '2026-09-15'); assert.equal(vc.moved, true); assert.equal(vc.owner, 'Head of ESG');
  // an own obligation, every year, already late
  const cu = await call('POST', '/api/compliance/custom', { title: 'Consent to operate renewal (state pollution board)', jurisdiction: 'India', dueDate: '2025-01-31', recurrence: 'annual' }, co, mgr);
  assert.equal(cu.status, 200);
  d = (await call('GET', '/api/compliance?year=2026', undefined, co)).body;
  const own = d.obligations.find((x: { reg: string; period: number }) => x.reg === `custom:${cu.body.id}` && x.period === 2026);
  assert.equal(own.due, '2026-01-31'); assert.equal(own.status, d.today > '2026-01-31' ? 'overdue' : 'not_started');
  const x = await call('GET', '/api/compliance/export?year=2026', undefined, co);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x.raw as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Regulations', 'Obligations 2026', 'Method']);
  const ics = await call('GET', '/api/compliance/calendar.ics?year=2026', undefined, co);
  assert.equal(ics.status, 200); assert.match(String(ics.headers['content-type']), /text\/calendar/); assert.match(ics.text, /BEGIN:VEVENT/); assert.match(ics.text, /DTSTART;VALUE=DATE:20260915/);
  assert.doesNotMatch(ics.text, /SUMMARY:BRSR with the annual report \(FY 2025-26\)/);   // done: not in the calendar
  assert.match(ics.text, new RegExp(`UID:${co}-`)); assert.ok(ics.text.endsWith('\r\n'));
  assert.ok(ics.text.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded at 75 octets');
  assert.equal((await call('DELETE', `/api/compliance/custom/${cu.body.id}`, undefined, co, mgr)).status, 200);
});

test('API: owner without a status keeps the module status; Clear drops only the status; dates; custom carry-over and moves', async () => {
  const B = { reg: 'in_brsr', obligation: 'brsr', period: 2026 };
  const get = async (y = 2026) => (await call('GET', `/api/compliance?year=${y}`, undefined, co)).body;
  const find = (d: any, reg: string, ob: string, period: number) => d.obligations.find((x: any) => x.reg === reg && x.obligation === ob && x.period === period);
  assert.equal((await call('PUT', '/api/compliance/status', { ...B, status: null, owner: 'Company secretary' }, co, mgr)).status, 200);
  let o = find(await get(), 'in_brsr', 'brsr', 2026);
  assert.equal(o.status, 'done'); assert.equal(o.source, 'module'); assert.equal(o.owner, 'Company secretary');
  await call('PUT', '/api/compliance/status', { ...B, status: 'in_progress', owner: 'Company secretary', note: 'Reopened' }, co, mgr);
  o = find(await get(), 'in_brsr', 'brsr', 2026); assert.equal(o.setStatus, 'in_progress'); assert.equal(o.status, 'overdue'); assert.equal(o.source, 'set'); assert.equal(o.autoStatus, 'done');
  await call('PUT', '/api/compliance/status', { ...B, status: null, owner: 'Company secretary', note: 'Reopened' }, co, mgr);   // Clear
  o = find(await get(), 'in_brsr', 'brsr', 2026); assert.equal(o.status, 'done'); assert.equal(o.note, 'Reopened');
  // impossible dates refused, not a server error
  assert.equal((await call('PUT', '/api/compliance/status', { ...B, status: 'done', doneOn: '2026-02-31' }, co, mgr)).status, 400);
  assert.equal((await call('POST', '/api/compliance/custom', { title: 'Bad date', dueDate: '2026-04-31' }, co, mgr)).status, 400);
  // custom: the obligation code must be '-'
  const leap = (await call('POST', '/api/compliance/custom', { title: 'Leap-day filing', dueDate: '2024-02-29', recurrence: 'annual' }, co, mgr)).body.id;
  assert.equal((await call('PUT', '/api/compliance/status', { reg: `custom:${leap}`, obligation: 'zzz', period: 2099, status: 'in_progress' }, co, mgr)).status, 404);
  assert.equal(find(await get(2027), `custom:${leap}`, '-', 2027).due, '2027-02-28');
  // an annual one left open is carried into the next year
  assert.equal(find(await get(2027), `custom:${leap}`, '-', 2026)?.status, '2026-02-28' < (await get()).today ? 'overdue' : undefined);
  // a one-off moved into the next year shows there; editing its date to another year keeps its status
  const once = (await call('POST', '/api/compliance/custom', { title: 'Stack test', dueDate: '2026-12-15' }, co, mgr)).body.id;
  await call('PUT', '/api/compliance/status', { reg: `custom:${once}`, obligation: '-', period: 2026, status: 'in_progress', note: 'Extension', dueOverride: '2027-02-15' }, co, mgr);
  assert.equal(find(await get(2027), `custom:${once}`, '-', 2026).due, '2027-02-15');
  assert.equal(find(await get(2026), `custom:${once}`, '-', 2026), undefined);
  await call('PUT', `/api/compliance/custom/${once}`, { title: 'Stack test', dueDate: '2027-03-01' }, co, mgr);
  assert.equal(find(await get(2027), `custom:${once}`, '-', 2027).setStatus, 'in_progress');
  // a may-apply regulation is never overdue (Abu Dhabi facility, no EAD answer)
  const ead = (await get()).obligations.filter((x: any) => x.reg === 'ae_ead');
  assert.ok(ead.length && ead.every((x: any) => x.status !== 'overdue'));
});
