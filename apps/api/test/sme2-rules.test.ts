/**
 * EKOTRACE SME: the rules behind What applies (Labour Codes, social security, factory licence, pollution consent,
 * hazardous waste, BIS orders, Udyam, EPR, POSH), the CSR maths (obligation, spending register, unspent split,
 * overheads) and the EPR maths (plastic categories with the year's recycling share, e-waste, batteries, return dates).
 * Pure engine tests: no database.   node --import tsx --test test/sme2-rules.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/lib/sme/engine.js';
import { DEFAULTS } from '../src/lib/sme/defaults.js';
import { byFy, fyFor } from '../src/lib/sme/rules.js';
import mfg from '../../../data/sme/srmm_mfg.json' with { type: 'json' };
import svc from '../../../data/sme/srmm_svc.json' with { type: 'json' };

const cfg: any = { ...DEFAULTS, srmm_mfg: mfg, srmm_svc: svc, today: new Date('2026-10-30T06:00:00Z') };
const close = (a: number, b: number, tol = 0.001) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const base = (profile: any = {}, more: any = {}): any => ({ fy: 'FY 2025-26', profile: { sector: 'mfg', state: 'Maharashtra', ...profile }, certs: [], srmm: { version: 'auto', scores: {}, multi: {}, remarks: {} }, ...more });
const req = (d: any) => E.requirements(d, cfg) as any[];
const st = (d: any, key: string) => req(d).find((x) => x.key === key)?.status ?? null;
const lab = (d: any, key: string) => req(d).find((x) => x.key === key)?.label ?? null;

test('What applies: labour, PF/ESI, factory licence and POSH follow the number of workers', () => {
  assert.equal(lab(base(), 'labour_codes'), 'Add employees');
  assert.equal(st(base({ employees: 6 }), 'labour_codes'), 'likely');
  assert.equal(st(base({ employees: 6 }), 'social_security'), 'watch');
  assert.equal(st(base({ employees: 6 }), 'factory_licence'), null);
  assert.equal(lab(base({ employees: 6 }), 'posh'), 'Local Committee');
  assert.equal(st(base({ employees: 12 }), 'labour_codes'), 'apply');
  assert.equal(lab(base({ employees: 12 }), 'social_security'), 'ESI applies');
  assert.equal(lab(base({ employees: 12 }), 'factory_licence'), 'Not a factory');      // 10–19 with power: establishment only
  assert.equal(lab(base({ employees: 25 }), 'factory_licence'), 'Applies');            // 20+ with power
  assert.equal(lab(base({ employees: 25, power: 'no' }), 'factory_licence'), 'Not a factory'); // 40 without power
  assert.equal(st(base({ employees: 25 }), 'social_security'), 'apply');
  assert.equal(st(base({ employees: 25 }, { people: { posh_ic: true } }), 'posh'), 'good');
  assert.equal(st(base({ sector: 'svc', employees: 25 }), 'factory_licence'), null);  // services: no factory
  assert.match(req(base({ employees: 85 })).find((x) => x.key === 'labour_codes').why, /85 workers/);
});

test('What applies: pollution consent, hazardous waste, BIS orders and Udyam', () => {
  assert.equal(lab(base(), 'pcb_consent'), 'Find category');
  assert.equal(st(base({ pcbCategory: 'red' }), 'pcb_consent'), 'apply');
  assert.equal(st(base({ pcbCategory: 'orange' }, { calendar: { cto: '2027-03-31' } }), 'pcb_consent'), 'good');
  assert.equal(st(base({ pcbCategory: 'orange' }, { calendar: { cto: '2026-01-31' } }), 'pcb_consent'), 'apply'); // expired
  assert.equal(lab(base({ pcbCategory: 'white' }), 'pcb_consent'), 'Exempt');
  assert.equal(st(base({ sector: 'svc' }), 'pcb_consent'), null);
  assert.equal(st(base({ hazWaste: 'yes' }), 'hazardous_waste'), 'apply');
  assert.equal(st(base(), 'hazardous_waste'), 'watch');
  assert.equal(st(base({ hazWaste: 'no' }), 'hazardous_waste'), null);
  assert.equal(st(base({ qco: 'yes' }), 'bis_qco'), 'apply');
  assert.equal(st(base({ qco: 'unsure' }), 'bis_qco'), 'likely');
  assert.equal(st(base({ qco: 'no' }), 'bis_qco'), null);
  assert.equal(st(base({ udyam: true }), 'udyam'), 'good');
  assert.equal(st(base(), 'udyam'), 'likely');
  // every row carries why it shows and a next step
  for (const x of req(base({ employees: 30, plastics: true, ewaste: true, battery: true, euExport: true, cbamGood: 'steel', hazWaste: 'yes', qco: 'yes', pcbCategory: 'red' }))) {
    assert.ok(x.title && x.detail && x.why, `${x.key} lacks text`);
    assert.doesNotMatch(x.detail + x.why + x.action, /\{\w+\}/, `${x.key} has an unfilled placeholder`);
  }
});

test('What applies: EPR rows by stream and position; older settings fall back to the combined row', () => {
  assert.equal(lab(base({ plastics: true }), 'plastic_epr'), 'Not registered');
  assert.equal(lab(base({ plastics: true }, { epr: { registered: true, c1: 2, b1: 1 } }), 'plastic_epr'), 'Gap open');
  assert.equal(lab(base({ plastics: true }, { epr: { registered: true, c1: 2, b1: 2 } }), 'plastic_epr'), 'Covered');
  assert.equal(lab(base({ ewaste: true }), 'ewaste_epr'), 'Not registered');
  assert.equal(lab(base({ battery: true }, { epr: { battery: { registered: true, rows: [{ type: 'automotive', basis: 1000, bought: 900 }] } } }), 'battery_epr'), 'Covered');
  const old = { ...cfg, requirements: { ...cfg.requirements, items: { ...cfg.requirements.items, ewaste_epr: undefined, battery_epr: undefined } } };
  const rows = E.requirements(base({ ewaste: true, battery: true }), old) as any[];
  assert.equal(rows.filter((x) => x.key === 'other_epr').length, 1);
});

test('CSR: 2% of the three-year average, spending register, unspent split and overheads', () => {
  const d = base({ turnover: 42 }, { csr: { netWorth: 18, profit1: 3.2, profit2: 4.1, profit3: 5.6, spent: 0 } });
  let c = E.csr(d, cfg);
  assert.equal(c.applies, true); close(c.avgProfit, 4.3); close(c.obligation, 0.086); close(c.left, 0.086);
  assert.equal(c.committeeNeeded, false);
  assert.equal(st(d, 'csr'), 'apply');
  // two projects, ₹ lakh: ongoing 6 budget / 4.5 spent; one-off 2 / 2
  d.csr.projects = [
    { id: 'a', project: 'Water ATM', area: 'i', mode: 'agency', csr1: 'CSR00012345', budget: 6, spent: 4.5, ongoing: true },
    { id: 'b', project: 'School kits', area: 'ii', mode: 'agency', csr1: 'X1', budget: 2, spent: 2, ongoing: false },
  ];
  d.csr.overheads = 0.5;
  c = E.csr(d, cfg);
  close(c.spent, 0.065); close(c.planned, 0.08); close(c.left, 0.021);
  close(c.toUnspentAccount, 0.015); close(c.toFund, 0.006);          // ongoing project's 1.5 L to the Unspent CSR Account, rest to a fund
  assert.equal(c.noAgency, 1);                                        // "X1" is not a CSR-1 number
  close(c.overheadsPct, (0.005 / 0.065) * 100, 0.01); assert.equal(c.overheadsOk, false); // above 5%
  // spending above the obligation: nothing unspent, excess can be set off
  d.csr.projects[1].spent = 5; c = E.csr(d, cfg);
  close(c.left, 0); close(c.excess, 0.009); assert.equal(st(d, 'csr'), 'good');
  // losses do not create a negative obligation; below every threshold CSR does not apply
  assert.equal(E.csr(base({}, { csr: { profit1: -20, profit2: -10, profit3: 6 } }), cfg).obligation, 0);
  assert.equal(E.csr(base({ turnover: 40 }, { csr: { netWorth: 10, profit3: 2 } }), cfg).applies, false);
  // committee above ₹50 lakh
  assert.equal(E.csr(base({}, { csr: { profit1: 30, profit2: 30, profit3: 30 } }), cfg).committeeNeeded, true);
});

test('EPR: plastic categories with the year’s recycling share, e-waste, batteries and return dates', () => {
  // first version: one certificates figure for all categories
  let e = E.epr(base({}, { epr: { c1: 3.5, c2: 6.2, c3: 1.1, target: 100, bought: 7, registered: true } }), cfg);
  close(e.total, 10.8); close(e.need, 10.8); close(e.gap, 3.8); assert.equal(e.fy, 'FY 2025-26');
  // per category: a surplus in one category does not cover another; 2025-26 recycling share 60/40/40/60
  e = E.epr(base({}, { epr: { c1: 3.5, c2: 6.2, c3: 1.1, b1: 5, b2: 3.5, b3: 0, registered: true } }), cfg);
  close(e.gap, 2.7 + 1.1); close(e.bought, 8.5);
  close(e.plastic.cats[0].recyclingMin, 2.1); close(e.plastic.cats[1].recyclingMin, 2.48);
  const e27 = E.epr(base({}, { fy: 'FY 2026-27', epr: { c1: 10 } }), cfg);
  assert.equal(e27.plastic.cats[0].recyclingPct, 70);
  assert.equal(E.epr({ profile: {}, epr: { c1: 10 } }, cfg).fy, 'FY 2026-27');           // no year given: the year of today
  assert.equal(E.epr({ profile: {}, epr: { fy: 'FY 2025-26', c1: 10 } }, cfg).fy, 'FY 2025-26'); // stamped by the EPR page
  // e-waste: 70% in 2025-26, 80% from 2027-28
  e = E.epr(base({ ewaste: true }, { epr: { ewaste: { registered: true, basis: 10000, bought: 5000 } } }), cfg);
  assert.equal(e.ewaste.rate, 70); close(e.ewaste.need, 7000); close(e.ewaste.gap, 2000);
  assert.equal(E.epr(base({}, { fy: 'FY 2029-30', epr: { ewaste: { basis: 100 } } }), cfg).ewaste.rate, 80);
  // batteries: automotive 90% of 2022-23 sales in 2025-26; two-wheeler EV has no target before 2026-27
  e = E.epr(base({ battery: true }, { epr: { battery: { registered: true, rows: [{ type: 'automotive', basis: 1000, bought: 800 }, { type: 'ev2w', basis: 500, bought: 0 }] } } }), cfg);
  assert.equal(e.battery.rows[0].pct, 90); assert.equal(e.battery.rows[0].basisYear, 'FY 2022-23'); close(e.battery.rows[0].gap, 100);
  assert.equal(e.battery.rows[1].noTarget, true); close(e.battery.gap, 100);
  // return dates: FY 2025-26 extended; FY 2026-27 the rule date
  assert.equal(e.plastic.return.due, '2026-12-31'); assert.equal(e.battery.return.due, '2026-11-30'); assert.equal(e.ewaste.return.due, '2026-09-30');
  assert.equal(E.epr(base({}, { fy: 'FY 2026-27' }), cfg).plastic.return.due, '2027-06-30');
  assert.equal(byFy({ 'FY 2024-25': 1, 'FY 2027-28': 4 }, 'FY 2025-26'), 1);
  assert.equal(fyFor({}, { today: new Date('2026-03-31T00:00:00Z') }), 'FY 2025-26');
});

test('Schemes: tracker status and amounts, size and new-unit limits; news setting has dated, sourced items', () => {
  const d = base({ udyam: true, turnover: 42 }, { schemes: { apps: { zed: { status: 'received', sanctioned: 45000, received: 45000, docs: { 0: true, 2: true } } } } });
  const list = E.schemes(d, cfg) as any[];
  const zed = list.find((x) => x.id === 'zed');
  assert.equal(zed.status, 'received'); assert.equal(zed.received, 45000); assert.equal(zed.docsReady, 2);
  assert.equal(list.find((x) => x.id === 'cgtmse').eligible, true);                     // small
  assert.equal(list.find((x) => x.id === 'pmegp').eligible, false);                     // new units only
  assert.equal(list.find((x) => x.id === 'lean').status, 'not_started');
  const med = E.schemes(base({ udyam: true, turnover: 300 }), cfg) as any[];
  assert.equal(med.find((x) => x.id === 'cgtmse').eligible, false);                     // medium: not for CGTMSE
  assert.match(list.find((x) => x.id === 'state_subsidy').title, /^Maharashtra/);
  for (const x of cfg.schemes.items) assert.ok(Array.isArray(x.docs) && x.docs.length, `${x.id} needs documents`);
  const news = cfg.news.items as any[];
  assert.ok(news.length >= 5 && news.length <= 8);
  for (const x of news) { assert.match(x.date, /^20(25|26)-\d{2}-\d{2}$/); assert.ok(x.date >= '2025-10-01' && x.date <= '2026-10-30'); assert.match(x.link, /^https:\/\//); }
});
