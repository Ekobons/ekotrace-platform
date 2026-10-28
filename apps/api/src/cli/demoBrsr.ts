/**
 * BRSR Core demo for a laptop: "Sahyadri Auto Components Ltd (demo)", a listed Indian manufacturer with two plants
 * and a head office, two financial years of entries (FY 2024-25 and FY 2025-26: fuels, biomass, grid electricity,
 * water, waste), the year settings, HR / finance / procurement figures, value-chain partners and review states.
 *
 *   npm run demo:brsr
 *   npm run demo:brsr -- --reset     delete the demo company (and all its data) and create it again
 *
 * Every figure is INVENTED. Entries are calculated by the platform itself (DESNZ factors; CEA grid factor for India)
 * and then marked approved. Demo only — never run this on a server with real clients.
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { autoSetup } from '../db/setup.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { buildApp } from '../app.js';

const NAME = 'Sahyadri Auto Components Ltd (demo)';
const PEOPLE: [string, string, string][] = [['Demo ESG Head', 'esg@sahyadri.demo', 'super_admin'], ['Demo Finance Controller', 'finance@sahyadri.demo', 'admin'], ['Demo HR Manager', 'hr@sahyadri.demo', 'manager']];

let app: FastifyInstance;
async function session(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.body}`);
  const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  return async <T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> => {
    const x = await app.inject({ method: method as 'GET', url, payload: (body ?? (method === 'GET' ? undefined : {})) as object, headers: { cookie } });
    if (x.statusCode >= 300) throw new Error(`${method} ${url}: ${x.statusCode} ${x.body.slice(0, 400)}`);
    return x.json() as T;
  };
}

const months = (fy: number) => Array.from({ length: 12 }, (_, i) => { const m = 4 + i, y = m > 12 ? fy + 1 : fy, mm = ((m - 1) % 12) + 1; const end = new Date(Date.UTC(y, mm, 0)).getUTCDate(); return { s: `${y}-${String(mm).padStart(2, '0')}-01`, e: `${y}-${String(mm).padStart(2, '0')}-${end}`, i }; });
const wave = (i: number, amp = 0.06) => 1 + amp * Math.sin((i / 12) * 2 * Math.PI);

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await autoSetup((m) => console.log(m));
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The BRSR demo company already exists. Run "npm run demo:brsr -- --reset" to create it again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const ids = await platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone) VALUES ($1,'IN','AR5','enterprise',ARRAY['ekotrace','brsr'],'INR','Asia/Kolkata') RETURNING id`, [NAME])).rows[0].id as string;
    const g = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'IN') RETURNING id`, [t, NAME])).rows[0].id as string;
    const fac = async (n: string, type: string, loc: string, emp: number) => (await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country, employees, grid_region) VALUES ($1,$2,'facility',$3,$4,$5,'IN',$6,'IN') RETURNING id`, [t, g, n, type, loc, emp])).rows[0].id as string;
    const f = { chakan: await fac('Chakan plant (demo)', 'Plant', 'Chakan, Pune', 1450), hosur: await fac('Hosur plant (demo)', 'Plant', 'Hosur, Tamil Nadu', 980), office: await fac('Mumbai head office (demo)', 'Office', 'Mumbai', 210) };
    for (const [name, email, role] of PEOPLE) await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password, scope_node_id) VALUES ($1,$2,$3,$4,$5,false,$6)`, [t, email, name, role, hash, role === 'admin' ? g : null]);
    const item = async (code: string) => { const r = (await c.query(`SELECT id FROM item WHERE code = $1`, [code])).rows[0]; if (!r) throw new Error(`Item ${code} missing: start the app once so the factor files load`); return r.id as number; };
    const it = {
      diesel: await item('desnz:diesel-100-mineral-diesel'), gas: await item('desnz:natural-gas'), pellets: await item('desnz:wood-pellets'), grid: await item('grid:electricity'),
      well: await item('water:groundwater'), mains: await item('water:mains'), sewer: await item('water:sewer'),
      plastic: await item('waste3:plastic:plastics-average-plastics:open_loop'), scrap: await item('waste3:metal:metal-scrap-metal:closed_loop'), oily: await item('waste3:hazardous:oily:closed_loop'),
      ewaste: await item('waste3:electrical-items:weee-mixed:open_loop'), mixed: await item('waste3:refuse:commercial-and-industrial-waste:landfill'), paper: await item('waste3:paper:paper-and-board-mixed:closed_loop'),
    };
    return { t, f, it };
  });
  app = await buildApp({ rateLimit: null });
  const s = await session('esg@sahyadri.demo', pw);

  // ------------------------------------------------------------------ entries, two financial years, calculated by the platform
  const { f, it } = ids;
  for (const fy of [2024, 2025]) {
    const g = fy === 2025 ? 0.96 : 1;   // a little better in the later year
    const entries: Record<string, unknown>[] = [];
    for (const m of months(fy)) {
      const e = (facilityId: string, itemId: number, quantity: number, unit: string, extra: Record<string, unknown> = {}) =>
        entries.push({ facilityId, itemId, quantity: Math.round(quantity * 1000) / 1000, unit, periodStart: m.s, periodEnd: m.e, note: 'DEMO (invented)', ...extra });
      e(f.chakan, it.diesel, 42_000 * wave(m.i) * g, 'L'); e(f.hosur, it.diesel, 26_000 * wave(m.i) * g, 'L');
      e(f.chakan, it.gas, 95_000 * wave(m.i, 0.04) * g, 'm3'); e(f.chakan, it.pellets, fy === 2025 ? 60 * wave(m.i) : 25 * wave(m.i), 't');
      e(f.chakan, it.grid, 2_150_000 * wave(m.i, 0.08) * g, 'kWh_e'); e(f.hosur, it.grid, 1_320_000 * wave(m.i, 0.08) * g, 'kWh_e'); e(f.office, it.grid, 64_000 * wave(m.i, 0.15), 'kWh_e');
      e(f.chakan, it.well, 9_800 * wave(m.i, 0.1), 'm3'); e(f.chakan, it.mains, 3_100 * wave(m.i), 'm3'); e(f.hosur, it.mains, 5_400 * wave(m.i), 'm3'); e(f.office, it.mains, 520, 'm3');
      e(f.chakan, it.sewer, 6_900 * wave(m.i), 'm3'); e(f.hosur, it.sewer, 2_900 * wave(m.i), 'm3'); e(f.office, it.sewer, 410, 'm3');
      e(f.chakan, it.scrap, 310 * wave(m.i) * g, 't'); e(f.hosur, it.scrap, 190 * wave(m.i) * g, 't');
      e(f.chakan, it.plastic, 14 * wave(m.i), 't'); e(f.chakan, it.oily, 6.5 * wave(m.i), 't', { wasteInfo: { hazardous: true, contractor: 'DEMO Re-refiners Pvt Ltd' } });
      e(f.chakan, it.mixed, 22 * g, 't'); e(f.hosur, it.mixed, 15 * g, 't'); e(f.office, it.paper, 1.4, 't');
      if (m.i % 6 === 5) e(f.office, it.ewaste, 0.8, 't');
    }
    for (let i = 0; i < entries.length; i += 400) {
      const r = await s<{ saved: number; failed: number; results: { ok: boolean; error?: unknown }[] }>('POST', '/api/activities/batch', { entries: entries.slice(i, i + 400) });
      if (r.failed) console.log(`  ${r.failed} entries refused, e.g.`, JSON.stringify(r.results.find((x) => !x.ok)).slice(0, 400));
    }
  }
  await platformTx(async (c) => { await c.query(`UPDATE activity SET status = 'approved', reviewed_by = 'Demo Finance Controller', reviewed_at = now() WHERE tenant_id = $1`, [ids.t]); });

  // ------------------------------------------------------------------ BRSR years
  const settings = (fy: number, revenue: number, output: number, status: string) => s('PUT', `/api/brsr/${fy}`, {
    revenueInr: revenue, pppFactor: 22.4, outputQty: output, outputUnit: 't of components', facilityIds: null, provider: 'Demo Assurance LLP (not real)', approach: 'assurance', status,
    notes: 'INVENTED figures for the demo. PPP rate: IMF implied PPP conversion rate as cited in the Industry Standards (April 2024).' });
  await settings(2024, 38_400_000_000, 182_000, 'final');
  await settings(2025, 42_150_000_000, 196_500, 'draft');
  // the discharge by level of treatment must add up to the discharge the entries give
  const discharge: Record<number, number> = {};
  for (const fy of [2024, 2025]) discharge[fy] = (await s<{ rows: { code: string; value: number }[] }>('GET', `/api/brsr?fy=${fy}`)).rows.find((r) => r.code === 'water.discharge')!.value;
  const typed = (fy: number, k: number): { kpi: string; value: number | null; note: string; documentId: null; owner: string | null }[] => {
    const v = (kpi: string, value: number, owner: string, note = '') => ({ kpi, value: Math.round(value), note, documentId: null, owner });
    return [
      v('water.dis_secondary', discharge[fy]! - 4_920, 'Plant EHS', 'Chakan and Hosur ETP outlets to municipal sewer'), v('water.dis_primary', 4_920, 'Plant EHS', 'Head office to sewer'),
      v('waste.f', 0, 'Plant EHS'),
      v('emp.wellbeing_spend', 168_000_000 * k, 'HR'), v('emp.lti_emp', 1, 'HR'), v('emp.hours_emp', 5_100_000 * k, 'HR'), v('emp.lti_wkr', fy === 2025 ? 4 : 6, 'Plant EHS'), v('emp.hours_wkr', 6_800_000 * k, 'Plant EHS'),
      v('emp.disab_emp', 0, 'HR'), v('emp.disab_wkr', fy === 2025 ? 0 : 1, 'Plant EHS'), v('emp.fatal_emp', 0, 'HR'), v('emp.fatal_wkr', 0, 'Plant EHS'),
      v('gender.wages_female', 612_000_000 * k * (fy === 2025 ? 1.08 : 1), 'HR'), v('gender.wages_total', 4_380_000_000 * k, 'HR'), v('gender.posh', fy === 2025 ? 3 : 2, 'HR'), v('gender.female_avg', fy === 2025 ? 412 : 371, 'HR'), v('gender.posh_upheld', 1, 'HR'),
      v('incl.purchases', 24_600_000_000 * k, 'Procurement'), v('incl.msme', 6_150_000_000 * k, 'Procurement', 'Vendors with Udyam registration'), v('incl.india', 21_400_000_000 * k, 'Procurement'),
      v('incl.w_rural', 310_000_000 * k, 'HR'), v('incl.w_semi', 1_420_000_000 * k, 'HR'), v('incl.w_urban', 1_960_000_000 * k, 'HR'), v('incl.w_metro', 690_000_000 * k, 'HR'),
      v('fair.customer_breaches', 0, 'IT security'), v('fair.incidents', fy === 2025 ? 2 : 1, 'IT security', 'Reported to CERT-In'),
      v('fair.payables', 4_920_000_000 * k, 'Finance'), v('fair.procured', 25_900_000_000 * k, 'Finance'),
      v('open.purch_trading', 1_240_000_000 * k, 'Procurement'), v('open.trading_count', 38, 'Procurement'), v('open.trading_top10', 905_000_000 * k, 'Procurement'),
      v('open.sales', 41_800_000_000 * k, 'Finance'), v('open.sales_dealers', 7_100_000_000 * k, 'Finance'), v('open.dealer_count', 214, 'Finance'), v('open.dealer_top10', 2_380_000_000 * k, 'Finance'),
      v('open.rp_purchases', 1_960_000_000 * k, 'Finance'), v('open.rp_sales', 3_050_000_000 * k, 'Finance'), v('open.loans', 820_000_000, 'Finance'), v('open.rp_loans', 120_000_000, 'Finance'),
      v('open.investments', 5_600_000_000, 'Finance'), v('open.rp_investments', 2_100_000_000, 'Finance'),
    ];
  };
  // FY 2024-25 was finalised: reopen it briefly to load the comparatives, then mark it final again
  await settings(2024, 38_400_000_000, 182_000, 'draft');
  await s('PUT', '/api/brsr/2024/values', { values: typed(2024, 0.92) });
  await settings(2024, 38_400_000_000, 182_000, 'final');
  const SAFETY = ['emp.lti_wkr', 'emp.hours_wkr', 'emp.lti_emp', 'emp.hours_emp'];
  await s('PUT', '/api/brsr/2025/values', { values: typed(2025, 1).filter((x) => ![...SAFETY, 'open.loans', 'open.rp_loans', 'fair.payables'].includes(x.kpi)) });  // a few still to come
  // reviews: HR enters the safety figures and marks its rows ready; the ESG head (who did not enter them) reviews the safety rows
  const hr = await session('hr@sahyadri.demo', pw), fin = await session('finance@sahyadri.demo', pw);
  await hr('PUT', '/api/brsr/2025/values', { values: typed(2025, 1).filter((x) => SAFETY.includes(x.kpi)).map((x) => (x.kpi === 'emp.lti_wkr' ? { ...x, value: 4, note: 'Two hand injuries, one fall, one burn (DEMO)' } : x)) });
  await hr('POST', '/api/brsr/2025/review', { kpis: ['emp.lti_wkr', 'emp.hours_wkr', 'emp.lti_emp', 'emp.hours_emp', 'gender.wages_female', 'gender.wages_total'], review: 'ready' });
  await s('POST', '/api/brsr/2025/review', { kpis: SAFETY, review: 'reviewed' });
  await fin('POST', '/api/brsr/2025/review', { kpis: ['ghg.s1', 'ghg.s2', 'energy.total', 'energy.renewable', 'water.consumption', 'water.withdrawal', 'water.discharge'], review: 'reviewed' });
  // value chain
  for (const p of [
    { side: 'upstream', name: 'Deccan Castings Pvt Ltd (demo)', amountInr: 3_450_000_000, attributable: 0.42, values: { 'ghg.s1': 21_400, 'ghg.s2': 18_900, 'energy.total': 310_000, 'water.consumption': 96_000, 'waste.total': 2_800 }, note: 'From its BRSR FY 2025-26 (DEMO)' },
    { side: 'upstream', name: 'Western Steel Traders (demo)', amountInr: 2_880_000_000, attributable: 0.11, values: { 'ghg.s1': 1_900, 'ghg.s2': 3_400 }, note: 'Questionnaire answer; energy, water and waste not reported (DEMO)' },
    { side: 'upstream', name: 'Pune Forgings Ltd (demo)', amountInr: 2_210_000_000, attributable: 0.35, values: { 'ghg.s1': 9_700, 'ghg.s2': 14_200, 'energy.total': 185_000, 'water.consumption': 41_000, 'waste.total': 1_250 }, note: 'From its sustainability report (DEMO)' },
    { side: 'upstream', name: 'Rubber & Polymers India (demo)', amountInr: 1_150_000_000, attributable: 0.2, values: { 'ghg.s1': 4_100, 'ghg.s2': 6_600 }, note: 'Estimated (DEMO)' },
    { side: 'downstream', name: 'Bharat Motors Ltd (demo)', amountInr: 14_600_000_000, attributable: 0.04, values: { 'ghg.s1': 88_000, 'ghg.s2': 142_000, 'energy.total': 2_450_000, 'water.consumption': 1_900_000, 'waste.total': 41_000 }, note: 'Customer OEM, from its BRSR (DEMO)' },
    { side: 'downstream', name: 'Southern Auto Distributors (demo)', amountInr: 2_350_000_000, attributable: 0.3, values: { 'ghg.s1': 310, 'ghg.s2': 1_150 }, note: 'Distributor questionnaire (DEMO)' },
  ]) await s('POST', '/api/brsr/2025/partners', p);
  await app.close();

  console.log(`\nBRSR Core demo created (figures INVENTED): ${NAME}`);
  console.log('  Two plants and a head office; entries for FY 2024-25 (final) and FY 2025-26 (draft, a few figures still to come)');
  console.log('  Value chain: four suppliers and two customers\n');
  console.log('Sign in at / (same password, shown once), then Disclose → BRSR Core:');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(24)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
