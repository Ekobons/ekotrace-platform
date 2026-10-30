/**
 * EKOTRACE SME round 2: emissions by month and by plant, data quality, green power (dual Scope 2),
 * last year source by source, and the 12-month power bill analyser.
 *
 *   SME2_EMIS_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_sme2_emis_test node --import tsx --test test/sme2-emissions.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as E from '../src/lib/sme/engine.js';
import { DEFAULTS } from '../src/lib/sme/defaults.js';
import { plantList, sourceQuality, sourceTotal } from '../src/lib/sme/emisSites.js';
import mfg from '../../../data/sme/srmm_mfg.json' with { type: 'json' };
import svc from '../../../data/sme/srmm_svc.json' with { type: 'json' };

const cfg: any = { ...DEFAULTS, srmm_mfg: mfg, srmm_svc: svc, today: new Date('2026-10-28T12:00:00Z') };
const close = (a: number, b: number, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const BILL = { cd: 300, md: 340, pf: 0.86, units: 51700, energyRate: 8.2, demandRate: 450, excessMult: 1.5, pfPenalty: 18000, capCost: 800, peakShare: 35, shiftPct: 10, peakSur: 1.5, offRebate: 1.0 };
const twelve = (v: number) => Array.from({ length: 12 }, () => v);

// ------------------------------------------------------------------ engine: emissions --
test('emissions: older yearly-only data reads as one Main plant, unchanged', () => {
  const d = { profile: { turnover: 42 }, emissions: { diesel: 18000, grid: 620000, solar: 80000 } };
  const em = E.all(d, cfg).emissions;
  close(em.s1, 48.24, 0.01); close(em.s2, 443.92, 0.01);
  assert.equal(em.plants.length, 1); assert.equal(em.plants[0].name, 'Main plant'); close(em.plants[0].total, em.total, 1e-6);
  assert.equal(em.rows.find((r: any) => r.key === 'diesel').quality, 'measured');
  assert.equal(em.prior, null); assert.equal(em.change, null);
  close(em.s2Market, em.s2, 1e-9);
});

test('emissions: months add up to the year, the "yearly only" switch, partial years and quality', () => {
  const em: any = {
    sites: { main: { mode: { grid: 'month', diesel: 'year' }, months: { grid: [50000, 50000, 50000, '', '', '', '', '', '', '', '', ''], diesel: twelve(999) }, year: { diesel: 12000, grid: 1 }, quality: { diesel: 'estimate', coal: 'none' } } },
  };
  assert.equal(sourceTotal(em, 'grid'), 150000);              // month mode: the months, not the yearly figure
  assert.equal(sourceTotal(em, 'diesel'), 12000);             // year mode: the single figure, not the months
  assert.deepEqual(sourceQuality(em, 'grid'), { status: 'measured', months: 3, partial: true });
  assert.equal(sourceQuality(em, 'diesel').status, 'estimated');
  assert.equal(sourceQuality(em, 'coal').status, 'unused');
  assert.equal(sourceQuality(em, 'lpg').status, 'missing');
  const r = E.all({ profile: {}, emissions: em }, cfg).emissions;  // no stored yearly totals: computed
  close(r.rows.find((x: any) => x.key === 'grid').quantity, 150000, 1e-9);
  assert.deepEqual(r.quality.partial, ['grid']); assert.deepEqual(r.quality.estimated, ['diesel']);
  assert.ok(r.quality.missing.includes('lpg') && !r.quality.missing.includes('coal') && !r.quality.missing.includes('steel'));
  close(r.quality.measuredPct, (150000 * 0.716) / (150000 * 0.716 + 12000 * 2.68) * 100, 0.01);
  // the stored yearly total wins (Bill scan adds to it) and the difference sits with the main plant
  const r2 = E.all({ profile: {}, emissions: { ...em, grid: 160000 } }, cfg).emissions;
  close(r2.rows.find((x: any) => x.key === 'grid').quantity, 160000, 1e-9);
});

test('emissions: several plants add up, each with its own split', () => {
  const profile = { plants: [{ id: 'main', name: 'Bhosari unit' }, { id: 'p2', name: 'Chakan unit', city: 'Chakan', state: 'Maharashtra' }] };
  const emissions = {
    grid: 300000, diesel: 10000,
    sites: { main: { year: { grid: 200000, diesel: 10000 } }, p2: { mode: { grid: 'month' }, months: { grid: twelve(100000 / 12) } } },
  };
  assert.equal(plantList(profile).length, 2);
  const em = E.all({ profile, emissions }, cfg).emissions;
  const main = em.plants.find((p: any) => p.id === 'main'), p2 = em.plants.find((p: any) => p.id === 'p2');
  assert.equal(main.name, 'Bhosari unit'); assert.equal(p2.city, 'Chakan');
  close(p2.s2, 100000 * 0.716 / 1000, 1e-6); close(main.s2, 200000 * 0.716 / 1000, 1e-6); close(main.s1, 26.8, 1e-6); assert.equal(p2.s1, 0);
  close(main.total + p2.total, em.total, 1e-6);
});

test('emissions: green power lowers market-based Scope 2 only; renewable share counts it', () => {
  const d = { profile: {}, emissions: { grid: 100000, solar: 20000, green: 40000 } };
  const r = E.all(d, cfg);
  close(r.emissions.s2, 71.6, 1e-6);                         // location-based (CEA grid factor) unchanged
  close(r.emissions.s2Market, 60000 * 0.716 / 1000, 1e-6);
  close(r.emissions.totalMarket, r.emissions.s1 + r.emissions.s2Market, 1e-9);
  close(r.emissions.renewablePct, (60000 / 120000) * 100, 1e-6);
  close(r.emissions.solarPct, (20000 / 120000) * 100, 1e-6);
  close(r.energy.re, 60000 * 0.0036, 1e-9);
  // green bought cannot exceed the grid units it is part of
  close(E.all({ profile: {}, emissions: { grid: 10000, green: 50000 } }, cfg).emissions.s2Market, 0, 1e-9);
});

test('emissions: last year source by source, the change, and the total when only the stored figure exists', () => {
  const d: any = { profile: {}, emissions: { diesel: 18000, grid: 620000 }, priorYear: { total: 0, fy: 'FY 2024-25', emissions: { diesel: 21000, grid: 655000 } } };
  const r = E.all(d, cfg);
  const g = r.emissions.rows.find((x: any) => x.key === 'grid');
  assert.equal(g.priorQuantity, 655000); close(g.priorTco2e, 468.98, 0.01);
  assert.equal(r.emissions.prior.bySource, true); assert.equal(r.emissions.prior.fy, 'FY 2024-25');
  close(r.emissions.prior.total, (21000 * 2.68 + 655000 * 0.716) / 1000, 1e-6);
  close(r.emissions.change, ((r.emissions.total - r.emissions.prior.total) / r.emissions.prior.total) * 100, 1e-9);
  assert.match(String(r.srmm.suggestions.find((s: any) => s.id === 'B37')?.reason ?? 'trend'), /trend/);   // prior year now counts for SRMM
  const only = E.all({ profile: {}, emissions: { grid: 1000 }, priorYear: { total: 5 } }, cfg).emissions;
  assert.equal(only.prior.bySource, false); assert.equal(only.prior.total, 5);
  assert.equal(only.rows[0].priorQuantity, null);
});

// ------------------------------------------------------------------ engine: bills --
test('bills: one-month mode is unchanged (×12)', () => {
  const b = E.bills({ bills: BILL }, cfg);
  assert.equal(b.mode, 'one'); close(b.total / 1e5, 2.7);
  assert.deepEqual(b.findings.map((x: any) => x.code), ['cd', 'pf', 'tod']);
  // months typed but one-month mode chosen: still the single bill
  assert.equal(E.bills({ bills: { ...BILL, mode: 'one', months: [{ units: 1, md: 900 }] } }, cfg).mode, 'one');
});

test('bills: 12 identical months give the same answer as one month × 12', () => {
  const m = { units: 51700, md: 340, pf: 0.86, pfPenalty: 18000, peakShare: 35 };
  const b = E.bills({ bills: { ...BILL, months: twelve(0).map(() => ({ ...m })) } }, cfg);
  const one = E.bills({ bills: BILL }, cfg);
  assert.equal(b.mode, 'year'); assert.equal(b.monthsEntered, 12); assert.equal(b.monthsOver, 12);
  close(b.total, one.total, 1); close(b.cdSave, one.cdSave, 1); close(b.pfSave, one.pfSave, 1); close(b.todSave, one.todSave, 1);
  assert.equal(b.kvarRounded, one.kvarRounded); assert.equal(b.newCd, one.newCd);
  close(E.all({ bills: { ...BILL, months: twelve(0).map(() => ({ ...m })) } }, cfg).money.bills, one.total, 1);
});

test('bills: a real year — months over contract demand, average PF, penalty paid, savings from the year', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ units: 50000, md: i < 3 ? 330 : 280, cd: '', pf: i < 6 ? 0.88 : 0.95, pfPenalty: i < 6 ? 9000 : 0, peakShare: 30 }));
  const b = E.bills({ bills: { ...BILL, mode: 'year', months } }, cfg);
  assert.equal(b.monthsOver, 3); assert.equal(b.maxMd, 330); assert.equal(b.cdNow, 300);
  close(b.excessPaid, 3 * 30 * 450 * 1.5, 1e-6); close(b.excessCost, b.excessPaid, 1e-6);
  // raising to 350 kVA for 12 months costs more than 3 months of excess: hold the peak instead
  assert.equal(b.newCd, 350); assert.equal(b.cdSave, 0); close(b.peakSave, b.excessCost, 1e-6);
  assert.equal(b.findings[0].code, 'cdPeak');
  close(b.avgPf, 0.915, 1e-9); assert.equal(b.minPf, 0.88); assert.equal(b.pfMonths, 6);
  assert.equal(b.pfPenaltyPaid, 54000); assert.equal(b.pfSave, 54000);   // a full year: what was paid
  close(b.todSave, 12 * 50000 * 0.3 * 0.1 * 2.5, 1e-6);
  close(b.total, b.peakSave + b.pfSave + b.todSave, 1e-6);
});

test('bills: a part year is scaled to 12 months, and empty months are skipped', () => {
  const months: any[] = twelve(0).map(() => ({}));
  months[0] = { units: 40000, md: 320, pf: 0.85, pfPenalty: 10000, peakShare: 0 };
  months[1] = { units: 40000, md: 310, pf: 0.86, pfPenalty: 8000, peakShare: 0 };
  months[2] = { units: 40000, md: 290, pf: 0.9, pfPenalty: 6000, peakShare: 0 };
  const b = E.bills({ bills: { ...BILL, months } }, cfg);    // mode not chosen: months entered → year mode
  assert.equal(b.mode, 'year'); assert.equal(b.monthsEntered, 3); assert.equal(b.scale, 4);
  assert.equal(b.pfPenaltyPaid, 24000); assert.equal(b.pfSave, 96000);
  assert.equal(b.monthsOver, 2); assert.equal(b.newCd, 340);
  close(b.excessCost, (20 + 10) * 450 * 1.5 * 4, 1e-6);
  // year mode with nothing entered: no savings, nothing invented
  const none = E.bills({ bills: { ...BILL, mode: 'year', months: [] } }, cfg);
  assert.equal(none.total, 0); assert.equal(none.findings.length, 0);
});

// ------------------------------------------------------------------ API: last year's document reaches the engine --
const url = process.env.SME2_EMIS_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_sme2_emis_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('SME2_EMIS_TEST_DATABASE_URL must point to a database whose name ends in _test');
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
  await call('POST', '/api/platform/companies', { name: 'Two Plant Forgings', country: 'IN', products: ['sme'], superAdmin: { name: 'SA', email: 'owner@two.test' } });
  await p.query(`UPDATE app_user SET password_hash = $1, must_change_password = false WHERE tenant_id IS NOT NULL`, [pw]);
  await p.end();
  owner = await login('owner@two.test');
});
after(async () => { await app?.close(); await pool?.end(); });

test('API: the prior year’s emissions document reaches the engine; plants and months round-trip', async () => {
  const PREV = encodeURIComponent('FY 2024-25'), FY = encodeURIComponent('FY 2025-26');
  assert.equal((await call('PUT', `/api/sme/data/emissions?fy=${PREV}`, { data: { grid: 500000, diesel: 20000 } }, owner)).status, 200);
  assert.equal((await call('PUT', `/api/sme/data/profile?fy=${FY}`, { data: { plants: [{ id: 'main', name: 'Main plant' }, { id: 'p2', name: 'Unit 2', city: 'Hosur', state: 'Tamil Nadu' }] } }, owner)).status, 200);
  const r = await call('PUT', `/api/sme/data/emissions?fy=${FY}`, { data: { grid: 450000, diesel: 15000, green: 100000, sites: { main: { year: { grid: 300000, diesel: 15000, green: 100000 } }, p2: { mode: { grid: 'month' }, months: { grid: twelve(12500) } } } } }, owner);
  assert.equal(r.status, 200, r.text);
  const em = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body.results.emissions;
  assert.equal(em.prior.bySource, true); assert.equal(em.prior.fy, 'FY 2024-25');
  close(em.prior.total, (500000 * 0.716 + 20000 * 2.68) / 1000, 1e-6);
  assert.ok(em.change < 0);
  assert.equal(em.plants.length, 2); close(em.plants.find((p: any) => p.id === 'p2').s2, 150000 * 0.716 / 1000, 1e-6);
  close(em.s2 - em.s2Market, 100000 * 0.716 / 1000, 1e-6);
});
