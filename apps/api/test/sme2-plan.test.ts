/**
 * EKOTRACE SME reduction plan: the arithmetic of lib/sme/plan.ts (cuts, switches, prices, cost bases, payback,
 * caps, target and path), the 'actions' setting's checks, and the plan reaching the screens through the API.
 *
 *   SME2_PLAN_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_sme2_plan_test node --import tsx --test test/sme2-plan.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as E from '../src/lib/sme/engine.js';
import { DEFAULTS } from '../src/lib/sme/defaults.js';
import { fyEnd, fyEndOf, fyLabel, plan } from '../src/lib/sme/plan.js';
import mfg from '../../../data/sme/srmm_mfg.json' with { type: 'json' };
import svc from '../../../data/sme/srmm_svc.json' with { type: 'json' };

const cfg: any = { ...DEFAULTS, srmm_mfg: mfg, srmm_svc: svc, today: new Date('2026-10-28T12:00:00Z') };
const close = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const BASE = (): any => ({
  profile: { name: 'Example', sector: 'mfg', industry: 'Fasteners', state: 'Maharashtra', employees: 85, turnover: 42, production: 1700 },
  emissions: { diesel: 18000, petrol: 2400, lpg: 6000, refrig: 12, grid: 620000, solar: 80000 },
  bills: { cd: 300, md: 340, pf: 0.86, units: 51700, energyRate: 8.2, demandRate: 450, excessMult: 1.5, pfPenalty: 18000, capCost: 800, peakShare: 35, shiftPct: 10, peakSur: 1.5, offRebate: 1.0 },
  solar: { roof: 1200, usable: 70, tariff: 8.2, costKw: 42000, yieldKwp: 1450 },
});
const run = (d: any) => E.all(d, cfg).plan;
const row = (p: any, id: string) => p.rows.find((x: any) => x.id === id);

test('plan: FY helpers', () => {
  assert.equal(fyEnd('2027-02-10'), 2027); assert.equal(fyEnd('2027-04-01'), 2028); assert.equal(fyEnd(''), null);
  assert.equal(fyEndOf('FY 2025-26'), 2026); assert.equal(fyLabel(2030), 'FY 2029-30');
});

test('plan: share × saving of a source, at the company’s own bill rate; cost per item; payback', () => {
  const d = BASE();
  d.plan = { fy: 'FY 2025-26', items: [{ id: 'a', lib: 'led', status: 'planned', qty: 120 }] };
  const r = row(run(d), 'a');
  close(r.cut, 620000 * 0.08 * 0.5);                       // 24,800 kWh
  close(r.tco2e, 24800 * 0.716 / 1000);                     // 17.76 t
  close(r.save, 24800 * 8.2);                               // ₹2,03,360
  close(r.cost, 120 * 900); close(r.payback, 108000 / 203360);
  // own figures win over the library's; without a number of fittings the cost is unknown
  d.plan.items = [{ id: 'a', lib: 'led', share: 10, pct: 40 }];
  const r2 = row(run(d), 'a');
  close(r2.cut, 620000 * 0.1 * 0.4); assert.equal(r2.cost, null); assert.equal(r2.payback, null); assert.equal(r2.status, 'idea');
  // own price for electricity
  d.plan.prices = { grid: 10 };
  close(row(run(d), 'a').save, 620000 * 0.1 * 0.4 * 10);
});

test('plan: switches add the new source — DG to grid (kWh per litre), LPG to PNG (equal energy), DG to solar (panel cost)', () => {
  const d = BASE();
  d.plan = { fy: 'FY 2025-26', items: [{ id: 'dg', lib: 'dg', status: 'planned' }, { id: 'png', lib: 'png', source: 'lpg', status: 'doing' }, { id: 'sol', lib: 'dg', to: 'solar', share: 10, pct: 50 }] };
  const p = run(d);
  const dg = row(p, 'dg');
  assert.equal(dg.source, 'diesel'); assert.equal(dg.to, 'grid');
  close(dg.cut, 18000 * 0.7 * 0.6); close(dg.add, 7560 * 3);
  close(dg.tco2e, (7560 * 2.68 - 22680 * 0.716) / 1000);  // 4.02 t
  close(dg.save, 7560 * 92 - 22680 * 8.2);                  // ₹5,09,544
  assert.equal(dg.cost, 0); assert.equal(dg.payback, 0);
  const png = row(p, 'png');
  const per = 0.046 / 0.038;
  close(png.cut, 3000); close(png.add, 3000 * per);
  close(png.tco2e, (3000 * 2.94 - 3000 * per * 2.02) / 1000);
  close(png.save, 3000 * 95 - 3000 * per * 55);
  const sol = row(p, 'sol');
  close(sol.add, 18000 * 0.1 * 0.5 * 3); close(sol.tco2e, 900 * 2.68 / 1000); close(sol.save, 900 * 92);
  close(sol.cost, (2700 / 1450) * 42000);
  // an option the action does not offer is ignored
  d.plan.items = [{ id: 'x', lib: 'dg', to: 'png' }];
  assert.equal(row(run(d), 'x').to, 'grid');
});

test('plan: solar and power factor come from their pages; missing data is said, not invented', () => {
  const d = BASE();
  d.plan = { fy: 'FY 2025-26', items: [{ id: 's', lib: 'solar', status: 'planned' }, { id: 'pf', lib: 'pf', status: 'done', date: '2025-07-01' }, { id: 'c', lib: 'boiler' }] };
  const p = run(d), so = E.solar(d, cfg), b = E.bills(d, cfg);
  const s = row(p, 's');
  close(s.tco2e, so.co2); close(s.save, so.save); close(s.cost, so.cost); assert.equal(s.ready, true);
  const pf = row(p, 'pf');
  assert.equal(pf.tco2e, 0); close(pf.save, b.pfSave); close(pf.cost, b.capex); assert.equal(pf.achieved, true);
  const c = row(p, 'c');
  assert.equal(c.source, 'lpg');                            // the first of its fuels the company uses
  close(c.cut, 6000 * 0.8 * 0.05);
  delete d.solar; delete d.emissions.lpg; delete d.emissions.diesel;
  const p2 = run(d);
  assert.equal(row(p2, 's').ready, false); assert.match(row(p2, 's').why, /Solar page/);
  assert.equal(row(p2, 'c').ready, false); assert.equal(row(p2, 'c').tco2e, 0);
});

test('plan: never cuts more of a source than is used', () => {
  const d = BASE();
  d.plan = { fy: 'FY 2025-26', items: [
    { id: 'o1', title: 'EV forklifts', source: 'petrol', share: 100, pct: 80, cost: 500000, life: 8, status: 'planned' },
    { id: 'o2', title: 'Car pooling', source: 'petrol', share: 100, pct: 80, cost: 0, life: 3, status: 'planned' },
  ] };
  const p = run(d);
  close(row(p, 'o1').cut + row(p, 'o2').cut, 2400); assert.deepEqual(p.capped, ['petrol']);
  close(p.totals.tco2e, 2400 * 2.31 / 1000);
});

test('plan: target, path and whether the planned actions reach it', () => {
  const d = BASE();
  const cur = E.emissions(d, cfg).total;
  d.plan = { fy: 'FY 2025-26', targetPct: 10, targetYear: 2030, items: [
    { id: 'a', lib: 'led', status: 'planned', date: '2026-06-01' },        // from FY 2026-27
    { id: 'b', lib: 'dg', status: 'idea' },                                // ideas do not count
    { id: 'c', lib: 'solar', status: 'doing', date: '2028-01-15' },        // from FY 2027-28
  ] };
  let p = run(d);
  assert.equal(p.base.kind, 'this'); close(p.base.t, cur); assert.equal(p.target.label, 'FY 2029-30');
  close(p.target.t, cur * 0.9);
  assert.deepEqual(p.path.map((x: any) => x.year), [2026, 2027, 2028, 2029, 2030]);
  const led = row(p, 'a').tco2e, sol = row(p, 'c').tco2e;
  close(p.path[0].withPlan, cur); close(p.path[1].withPlan, cur - led); close(p.path[2].withPlan, cur - led - sol);
  close(p.path[4].target, cur * 0.9); close(p.path[2].target, cur - (cur * 0.1) * 2 / 4);
  close(p.totals.planned.tco2e, led + sol); assert.equal(p.reaches, true);                 // ~105 t against 54 t needed
  // a deeper target is not reached; the gap is reported
  d.plan.targetPct = 50; p = run(d);
  assert.equal(p.reaches, false); close(p.gap, (cur - led - sol) - cur * 0.5);
  // growth raises the business-as-usual line, and the planned share scales with it
  d.plan.growth = 5; p = run(d);
  close(p.path[4].bau, cur * 1.05 ** 4); close(p.path[4].withPlan, cur * 1.05 ** 4 * (1 - (led + sol) / cur));
  // a base year of the company's own, earlier than this year
  d.plan = { fy: 'FY 2025-26', base: 'own', baseYear: 2024, baseT: 700, targetPct: 30, targetYear: 2030, items: [] };
  p = run(d);
  assert.equal(p.base.kind, 'own'); assert.equal(p.base.label, 'FY 2023-24'); close(p.target.t, 490);
  assert.equal(p.path[0].year, 2024); assert.equal(p.path[0].actual, 700); assert.equal(p.path[1].actual, null);
  // last year's total as the base; the current year then follows from it
  d.plan = { base: 'prior', items: [] };
  d.priorYear = { fy: 'FY 2024-25', total: 600 };
  p = run(d);
  assert.equal(p.fy, 'FY 2025-26'); assert.equal(p.base.kind, 'prior'); assert.equal(p.base.t, 600); close(p.change, (cur - 600) / 600);
});

test('plan: an empty plan is calm', () => {
  const p = E.all({ profile: {}, emissions: {} }, cfg).plan;
  assert.equal(p.rows.length, 0); assert.equal(p.reaches, false); assert.equal(p.totals.tco2e, 0);
});

// ------------------------------------------------------------------ settings and API --
const url = process.env.SME2_PLAN_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_sme2_plan_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('SME2_PLAN_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;
let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', owner = '';
const call = async (method: string, path: string, body?: unknown, cookie = admin) => {
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' ? undefined : {})) as object, headers: { cookie } });
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
  await call('POST', '/api/platform/companies', { name: 'Plan SME', country: 'IN', products: ['sme'], superAdmin: { name: 'SA', email: 'owner@plan.test' } });
  await p.query(`UPDATE app_user SET password_hash = $1, must_change_password = false WHERE tenant_id IS NOT NULL`, [pw]);
  await p.end();
  owner = await login('owner@plan.test');
});
after(async () => { await app?.close(); await pool?.end(); });

test('settings: the actions library is checked before it is stored', async () => {
  const { validate } = await import('../src/lib/sme/settings.js');
  const ok = structuredClone(DEFAULTS.actions);
  assert.doesNotThrow(() => validate('actions', ok));
  const bad = (f: (x: any) => void, re: RegExp) => { const x = structuredClone(ok); f(x); assert.throws(() => validate('actions', x), re); };
  bad((x) => { x.items[0].pct = 150; }, /percentage/);
  bad((x) => { x.items[1].id = x.items[0].id; }, /twice/);
  bad((x) => { x.items[0].cost.basis = 'monthly'; }, /cost.basis/);
  bad((x) => { delete x.items[0].source; }, /source/);
  bad((x) => { x.prices.diesel = -1; }, /price of diesel/);
  bad((x) => { delete x.target; }, /"target" is missing/);
});

test('API: the library reaches the screens and a saved plan comes back calculated', async () => {
  const d0 = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body;
  assert.equal(d0.config.actions.items.length, DEFAULTS.actions.items.length);
  assert.equal(d0.results.plan.rows.length, 0);
  assert.equal((await call('PUT', `/api/sme/data/emissions?fy=${FY}`, { data: { grid: 620000, diesel: 18000 } }, owner)).status, 200);
  const r = await call('PUT', `/api/sme/data/plan?fy=${FY}`, { data: { fy: 'FY 2025-26', items: [{ id: 'a', lib: 'led', status: 'planned', qty: 120 }] } }, owner);
  assert.equal(r.status, 200, r.text);
  close(r.body.results.plan.rows[0].tco2e, 17.7568); assert.equal(r.body.results.plan.fy, 'FY 2025-26');
  // the active setting is used: a new version with a higher LED saving changes the figures
  const next = structuredClone(DEFAULTS.actions); next.items.find((x: any) => x.id === 'led').pct = 60;
  const v = await call('POST', '/api/platform/sme/settings/actions', { data: next, note: 'test' });
  assert.equal(v.status, 200, v.text);
  assert.equal((await call('POST', `/api/platform/sme/settings/actions/${v.body.version}/activate`)).status, 200);
  const d1 = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body;
  close(d1.results.plan.rows[0].cut, 620000 * 0.08 * 0.6);
});
