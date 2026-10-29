/**
 * EKOTRACE SME: the engine's figures (pinned to the approved prototype), and the API — package gate, saving
 * modules, roles, consent before any partner sees data, cluster privacy floor, CA validation, the worker QR page
 * and versioned settings.
 *
 *   SME_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_sme_test npm test -w @ekotrace/api
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as E from '../src/lib/sme/engine.js';
import { DEFAULTS } from '../src/lib/sme/defaults.js';
import { readIndianBill } from '../src/lib/sme/bill.js';
import { readBill } from '../src/lib/billRead.js';
import mfg from '../../../data/sme/srmm_mfg.json' with { type: 'json' };
import svc from '../../../data/sme/srmm_svc.json' with { type: 'json' };

const cfg: any = { ...DEFAULTS, srmm_mfg: mfg, srmm_svc: svc, today: new Date('2026-10-28T12:00:00Z') };
const close = (a: number, b: number, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const EXAMPLE = (): any => ({
  profile: { name: 'Example', sector: 'mfg', industry: 'Fasteners', state: 'Maharashtra', employees: 85, turnover: 42, production: 1700, udyam: true, listedBuyer: true, euExport: true, ukExport: true, cbamGood: 'steel', plastics: true, eudr: 'none' },
  emissions: { diesel: 18000, petrol: 2400, lpg: 6000, refrig: 12, grid: 620000, solar: 80000, steel: 1800, plastic: 12, road: 450000, air: 60000, rail: 20000 },
  esg: { water: 5200, waste: 140, recycled: 62, women: 14, training: 6, target: false, minwage: true, posh: true, coc: true, abc: false, grievance: true, privacy: false, supplierCode: false, ownerEsg: true },
  certs: [{ id: 'zed', name: 'MSME ZED certification', level: 'bronze', expiry: '2027-08-31' }, { id: 'iso9001', name: 'ISO 9001 quality', level: 'held', expiry: '2027-03-15' }, { id: 'iso14001', name: 'ISO 14001', level: 'none', expiry: '' }],
  bills: { cd: 300, md: 340, pf: 0.86, units: 51700, energyRate: 8.2, demandRate: 450, excessMult: 1.5, pfPenalty: 18000, capCost: 800, peakShare: 35, shiftPct: 10, peakSur: 1.5, offRebate: 1.0 },
  solar: { roof: 1200, usable: 70, tariff: 8.2, costKw: 42000, yieldKwp: 1450 },
  credits: { newSolarKw: 120, effKwh: 45000, price: 500, share: 20 },
  calendar: { cto: '2027-03-31', factory: '2026-12-31', fire: '2027-01-15', done: {} },
  epr: { c1: 3.5, c2: 6.2, c3: 1.1, target: 100, bought: 7, registered: true },
  people: { hours: 2400, log: [{ date: '2025-08-12', what: 'Hand injury', days: 4 }, { date: '2025-11-03', what: 'Slip', days: 0 }] },
  csr: { netWorth: 18, profit1: 3.2, profit2: 4.1, profit3: 5.6, spent: 0 },
  cbam: { tonnesEU: 420, price: 75, eurInr: 98, benchmark: 1.37, defaultValue: 3.2, tonnesUK: 120, ukPrice: 45, gbpInr: 113 },
  srmm: { version: 'auto', scores: {}, multi: {}, remarks: {} },
  scrap: [{ item: 'MS turnings', qty: 95, unit: 't', price: 28 }, { item: 'Used oil', qty: 2000, unit: 'L', price: 22 }],
  grievances: { total: 2, resolved: 1 },
});

// ------------------------------------------------------------------ engine --
test('engine: emissions, readiness, money, CBAM match the approved prototype', () => {
  const r = E.all(EXAMPLE(), cfg);
  close(r.emissions.s1, 96.5, 0.1); close(r.emissions.s2, 443.9, 0.1); close(r.emissions.total, 540.4, 0.1); close(r.emissions.intensity, 12.9);
  assert.equal(Math.round(r.esg.overall), 70); assert.equal(r.esg.level, 3);
  close(r.bills.total / 1e5, 2.7); assert.equal(r.solar.kw, 84); close(r.solar.save / 1e5, 10.0);
  close(r.money.scrap, 95 * 1000 * 28 + 2000 * 22, 1);            // tonnes priced per kg; litres per litre
  close(r.cbam.saveInr / 1e5, 21.9, 0.1);
  assert.ok(r.requirements.find((x: any) => x.key === 'eu_cbam' && x.status === 'apply'));
  assert.ok(r.requirements.find((x: any) => x.key === 'csr'));
  assert.equal(r.calendar[0].title, 'PF and ESI contributions');
  assert.match(E.answer(EXAMPLE(), cfg, 'Total Scope 1 emissions').answer, /96\.5/);
  assert.equal(E.answer(EXAMPLE(), cfg, 'Describe your biodiversity policy').filled, false);
});

test('engine: SRMM — 300 points, 93 / 87 indicators, multi-part benefits, ICAI levels and the 30% floor', () => {
  const d = EXAMPLE();
  assert.equal(E.srmm(d, cfg).max, 300); assert.equal(E.srmm(d, cfg).indicators, 93); assert.equal(E.srmm(d, cfg).label, 'Below Level 1 – Not Rated');
  d.profile.sector = 'svc'; assert.equal(E.srmm(d, cfg).indicators, 87);
  d.srmm.multi = { svc_B12_h: '2', svc_B12_f: '1' }; assert.equal(E.srmmScore(d, cfg, 'B12'), 3);
  d.profile.sector = 'mfg'; d.srmm.scores = {}; d.srmm.multi = {};
  for (const q of (mfg as any).items) q.parts ? q.parts.forEach(([k]: [string]) => (d.srmm.multi[`mfg_${q.id}_${k}`] = '2')) : (d.srmm.scores[`mfg_${q.id}`] = String(q.max));
  const full = E.srmm(d, cfg); assert.equal(full.got, 300); assert.equal(full.level, 4);
  assert.equal(E.levelFor(0.81, true), 4); assert.equal(E.levelFor(0.66, true), 3); assert.equal(E.levelFor(0.51, true), 2); assert.equal(E.levelFor(0.31, true), 1); assert.equal(E.levelFor(0.3, true), 0); assert.equal(E.levelFor(0.9, false), 0);
});

test('bill reading: an Indian HT bill gives units, demand, power factor and penalty', () => {
  const text = ['Maharashtra State Electricity Distribution Co. Ltd', 'Bill Date: 05/10/2026', 'Billing Period: 01/09/2026 - 30/09/2026', 'Contract Demand (KVA) 300', 'Recorded Max Demand (KVA) 338',
    'Average Power Factor 0.86', 'Units Consumed (kWh) 52,400', 'PF Penalty 18,250.00', 'Total Amount Payable Rs. 4,61,200.00'].join('\n');
  const f = readIndianBill(text, 'electricity', readBill(text, 'electricity'));
  assert.equal(f.unitsKwh!.value, 52400); assert.equal(f.maxDemandKva!.value, 338); assert.equal(f.contractDemandKva!.value, 300); assert.equal(f.powerFactor!.value, 0.86); assert.equal(f.pfPenaltyInr!.value, 18250);
});

// ------------------------------------------------------------------ API --
const url = process.env.SME_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_sme_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('SME_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;
let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', owner = '', prep = '', verifier = '', buyer = '', cluster = '', ca = '';
let sme = '', buyerCo = '', clusterCo = '', caCo = '', other = '';
const call = async (method: string, path: string, body?: unknown, cookie = admin, tenant?: string) => {
  const headers: Record<string, string> = { cookie };
  if (tenant) headers['x-tenant-id'] = tenant;
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body };
};
const login = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'correct horse battery' } })).headers['set-cookie']).split(';')[0]!;
const FY = encodeURIComponent('FY 2025-26');

before(async () => {
  const c0 = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await c0.connect(); await c0.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await c0.query(`CREATE DATABASE ${dbName}`); await c0.end();
  await (await import('../src/db/migrate.js')).migrate(() => {});
  app = await (await import('../src/app.js')).buildApp({ rateLimit: null });
  pool = (await import('../src/db/pool.js')).pool;
  const { hashPassword } = await import('../src/lib/password.js');
  const pw = await hashPassword('correct horse battery');
  const p = new pg.Client({ connectionString: url });
  await p.connect(); await p.query(`SELECT set_config('app.platform','on',false)`);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES (NULL,'ops@ekobon.test','Ops','platform_admin',$1,false)`, [pw]);
  admin = await login('ops@ekobon.test');
  const mk = async (name: string, products: string[], email: string) => (await call('POST', '/api/platform/companies', { name, country: 'IN', products, superAdmin: { name: 'SA', email } })).body.company.id as string;
  sme = await mk('Ganesh Fasteners', ['sme'], 'owner@sme.test');
  other = await mk('Other SME', ['sme'], 'other@sme.test');
  buyerCo = await mk('Bharat Auto', ['smenet'], 'buyer@net.test');
  clusterCo = await mk('Pune Cluster', ['smenet'], 'cluster@net.test');
  caCo = await mk('Mehta CA', ['smenet'], 'ca@net.test');
  await p.query(`UPDATE app_user SET password_hash = $1, must_change_password = false WHERE tenant_id IS NOT NULL`, [pw]);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'prep@sme.test','Prep','preparer',$2,false), ($1,'ver@sme.test','Ver','verifier',$2,false)`, [sme, pw]);
  await p.end();
  owner = await login('owner@sme.test'); prep = await login('prep@sme.test'); verifier = await login('ver@sme.test');
  buyer = await login('buyer@net.test'); cluster = await login('cluster@net.test'); ca = await login('ca@net.test');
  for (const [t, kind] of [[buyerCo, 'buyer'], [clusterCo, 'cluster'], [caCo, 'ca_firm']] as const) assert.equal((await call('PUT', `/api/platform/sme/partners/${t}`, { kind, city: 'Pune' })).status, 200);
});
after(async () => { await app?.close(); await pool?.end(); });

test('API: package gate, saving modules with a version check, roles', async () => {
  assert.equal((await call('GET', `/api/sme/data?fy=${FY}`, undefined, buyer)).body.error, 'PRODUCT_OFF');
  const d0 = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body;
  assert.equal(d0.config.srmm.mfg.items.length, 93); assert.equal(d0.results.emissions.total, 0);
  const ex = EXAMPLE();
  for (const m of ['profile', 'emissions', 'esg', 'bills', 'solar', 'cbam', 'csr', 'people', 'share']) {
    const r = await call('PUT', `/api/sme/data/${m}?fy=${FY}`, { data: m === 'share' ? { bench: true } : ex[m] }, owner);
    assert.equal(r.status, 200, `${m}: ${r.text}`);
  }
  const d = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body;
  close(d.results.emissions.total, 540.4, 0.1);
  const stale = await call('PUT', `/api/sme/data/esg?fy=${FY}`, { data: ex.esg, version: d.meta.esg.version - 1 }, owner);
  assert.equal(stale.status, 409);
  assert.equal((await call('PUT', `/api/sme/data/esg?fy=${FY}`, { data: ex.esg }, prep)).status, 200);          // data entry may save
  assert.equal((await call('PUT', `/api/sme/data/esg?fy=${FY}`, { data: ex.esg }, verifier)).status, 403);      // read-only
  assert.equal((await call('PUT', '/api/sme/company', { sector: 'svc' }, prep)).status, 403);
  assert.equal((await call('PUT', '/api/sme/company', { industry: 'Fasteners', state: 'Maharashtra' }, owner)).status, 200);
  assert.equal((await call('PUT', `/api/sme/data/nope?fy=${FY}`, { data: {} }, owner)).status, 404);
  // the other SME cannot see this one's data (row-level security)
  const o = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, await login('other@sme.test'))).body;
  assert.equal(o.results.emissions.total, 0);
});

test('API: partners see nothing until the SME switches sharing on; consent can be withdrawn', async () => {
  assert.equal((await call('POST', '/api/platform/sme/links', { partnerTenant: buyerCo, smeTenant: sme, purchaseSharePct: 3.1 })).status, 200);
  let o = (await call('GET', `/api/sme-net/overview?fy=${FY}`, undefined, buyer)).body;
  assert.equal(o.suppliers[0].shared, false); assert.equal(o.suppliers[0].scope12, undefined);
  const links = (await call('GET', '/api/sme/links', undefined, owner)).body.links;
  assert.equal((await call('PUT', `/api/sme/links/${links[0].id}`, { share: true }, prep)).status, 403);         // only the owner decides
  assert.equal((await call('PUT', `/api/sme/links/${links[0].id}`, { share: true }, owner)).status, 200);
  o = (await call('GET', `/api/sme-net/overview?fy=${FY}`, undefined, buyer)).body;
  close(o.suppliers[0].scope12, 540.4, 0.1);
  await call('PUT', `/api/sme/links/${links[0].id}`, { share: false }, owner);
  o = (await call('GET', `/api/sme-net/overview?fy=${FY}`, undefined, buyer)).body;
  assert.equal(o.suppliers[0].scope12, undefined);
  // invite a new supplier: a new SME company with a temporary password
  const inv = (await call('POST', '/api/sme-net/links', { email: 'new@supplier.test', company: 'New Supplier Pvt Ltd', purchaseSharePct: 2 }, buyer)).body;
  assert.equal(inv.newCompany, true); assert.ok(inv.temporaryPassword);
});

test('API: a cluster sees aggregates only, and only from five sharing members', async () => {
  await call('POST', '/api/platform/sme/links', { partnerTenant: clusterCo, smeTenant: sme });
  const links = (await call('GET', '/api/sme/links', undefined, owner)).body.links;
  await call('PUT', `/api/sme/links/${links.find((l: any) => l.kind === 'cluster').id}`, { share: true }, owner);
  const o = (await call('GET', `/api/sme-net/overview?fy=${FY}`, undefined, cluster)).body;
  assert.equal(o.hidden, true); assert.equal(o.sharing, 1); assert.equal(o.medianIntensity, undefined);
});

test('API: CA validation — request, assign, validate; levels from the score and the 30% rule', async () => {
  // not before the self-assessment is eligible (each section ≥ 30%)
  const ne = await call('POST', `/api/sme/ca-requests?fy=${FY}`, { publish: false }, owner);
  assert.equal(ne.status, 400); assert.equal(ne.body.error, 'NOT_ELIGIBLE');
  const scores: Record<string, number> = {}, multi: Record<string, number> = {};
  for (const q of (mfg as any).items) { if (q.parts) for (const [k] of q.parts) multi[`mfg_${q.id}_${k}`] = 1; else scores[`mfg_${q.id}`] = Math.round(q.max * 0.6); }
  assert.equal((await call('PUT', `/api/sme/data/srmm?fy=${FY}`, { data: { version: 'mfg', scores, multi, remarks: {} } }, owner)).status, 200);
  const r = await call('POST', `/api/sme/ca-requests?fy=${FY}`, { publish: false }, owner);
  assert.equal(r.status, 200);
  assert.equal((await call('POST', `/api/sme/ca-requests?fy=${FY}`, {}, owner)).status, 409);
  const q = (await call('GET', '/api/platform/sme/ca')).body;
  assert.equal(q.firms.length, 1);
  assert.equal((await call('PATCH', `/api/platform/sme/ca/${r.body.id}`, { caTenant: caCo })).status, 200);
  const list = (await call('GET', `/api/sme-net/overview?fy=${FY}`, undefined, ca)).body;
  assert.equal(list.requests.length, 1);
  const view = (await call('GET', `/api/sme-net/ca/${r.body.id}`, undefined, ca)).body;
  assert.equal(view.company.name, 'Ganesh Fasteners');
  assert.equal((await call('GET', `/api/sme-net/ca/${r.body.id}`, undefined, buyer)).status, 403);
  const v = (await call('PATCH', `/api/sme-net/ca/${r.body.id}`, { status: 'validated', validatedPct: 56, allSections30: true }, ca)).body;
  assert.equal(v.validatedLevel, 2);
  assert.equal((await call('PATCH', `/api/sme-net/ca/${r.body.id}`, { status: 'in_review' }, ca)).status, 409);
});

test('API: worker QR page, scrap, credit projects, questionnaire', async () => {
  const g = (await call('GET', '/api/sme/grievances', undefined, owner)).body;
  assert.match(g.token, /^[0-9a-f]{16}$/);
  const pub = await app.inject({ method: 'GET', url: `/api/public/sme/grievance/${g.token}` });
  assert.equal(pub.json().company, 'Ganesh Fasteners');
  assert.equal((await app.inject({ method: 'POST', url: `/api/public/sme/grievance/${g.token}`, payload: { text: 'Fan not working in canteen', category: 'Facilities' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/sme/grievance/0000000000000000' })).statusCode, 404);
  assert.equal((await call('GET', '/api/sme/grievances', undefined, owner)).body.items.length, 1);
  const s = (await call('POST', '/api/sme/scrap', { item: 'MS turnings', qty: 10, unit: 't', price: 28, hazardous: false }, owner)).body;
  assert.equal((await call('PATCH', `/api/sme/scrap/${s.id}`, { status: 'listed' }, owner)).status, 200);
  assert.equal((await call('PATCH', `/api/platform/sme/scrap/${s.id}`, { status: 'blocked', note: 'Check authorisation' })).status, 200);
  assert.equal((await call('PATCH', `/api/sme/scrap/${s.id}`, { status: 'sold' }, owner)).status, 403);
  const cp = (await call('POST', '/api/sme/credit-projects', { type: 'solar', capacityKw: 100 }, owner)).body;
  close(cp.tco2ePerYear, 100 * 1450 * 0.716 / 1000, 0.01);
  const a = (await call('POST', `/api/sme/answer?fy=${FY}`, { questions: ['Scope 2 emissions', 'Biodiversity policy'] }, owner)).body;
  assert.equal(a.answers[0].filled, true); assert.equal(a.answers[1].filled, false);
});

test('API: settings are versioned, checked, and only platform admins change them', async () => {
  const s = (await call('GET', '/api/platform/sme/settings/cbam')).body;
  assert.equal(s.active.version, 1);
  const bad = await call('POST', '/api/platform/sme/settings/factors', { data: { items: { grid: { factor: -1, scope: 2, unit: 'kWh' } } } });
  assert.equal(bad.status, 400);
  const v = (await call('POST', '/api/platform/sme/settings/cbam', { data: { ...s.active.data, eu_price_eur: 80 }, note: 'New price' })).body.version;
  assert.equal(v, 2);
  assert.equal((await call('POST', `/api/platform/sme/settings/cbam/${v}/activate`)).status, 200);
  assert.equal((await call('GET', '/api/platform/sme/settings/cbam')).body.active.data.eu_price_eur, 80);
  assert.equal((await call('GET', '/api/platform/sme/settings', undefined, owner)).status, 403);
  const csv = await call('GET', `/api/platform/sme/benchmark.csv?fy=${FY}`);
  assert.equal(csv.status, 200); assert.match(csv.text, /^industry,state,sector/);
});
