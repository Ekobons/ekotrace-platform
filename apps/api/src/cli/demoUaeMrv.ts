/**
 * UAE MRV demo for a laptop: "Al Dhafra Steel & Logistics LLC (demo)", an Abu Dhabi steel maker with a plant in
 * ICAD (above EAD's 25,000 t threshold), a fleet depot in Al Ain (below it) and a warehouse in Dubai (federal only).
 * Entries for 2025 and January–September 2026; the 2025 EAD report filled from entries plus a mass balance for the
 * electric arc furnace, submitted; 2026 in draft; mitigation measures; the federal position.
 *
 *   npm run demo:uaemrv
 *   npm run demo:uaemrv -- --reset     delete the demo company (and all its data) and create it again
 *
 * Every figure is INVENTED. Entries are calculated by the platform (DESNZ factors; EWEC / DEWA grid factors) and
 * then marked approved. Demo only — never run this on a server with real clients.
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { autoSetup } from '../db/setup.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { buildApp } from '../app.js';

const NAME = 'Al Dhafra Steel & Logistics LLC (demo)';
const PEOPLE: [string, string, string][] = [['Demo HSE Director', 'hse@aldhafra.demo', 'super_admin'], ['Demo Finance Manager', 'finance@aldhafra.demo', 'admin'], ['Demo Environment Engineer', 'env@aldhafra.demo', 'manager']];

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
const wave = (i: number, amp = 0.06) => 1 + amp * Math.sin(((i - 3) / 12) * 2 * Math.PI);   // summer peak

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await autoSetup((m) => console.log(m));
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The UAE MRV demo company already exists. Run "npm run demo:uaemrv -- --reset" to create it again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const ids = await platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone) VALUES ($1,'AE','AR5','enterprise',ARRAY['ekotrace','uaemrv'],'AED','Asia/Dubai') RETURNING id`, [NAME])).rows[0].id as string;
    const g = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'AE') RETURNING id`, [t, NAME])).rows[0].id as string;
    const fac = async (n: string, type: string, loc: string, emp: number, region: string) => (await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country, employees, grid_region) VALUES ($1,$2,'facility',$3,$4,$5,'AE',$6,$7) RETURNING id`, [t, g, n, type, loc, emp, region])).rows[0].id as string;
    const f = { icad: await fac('ICAD steel plant (demo)', 'Plant', 'ICAD II, Musaffah, Abu Dhabi', 1120, 'AE-AZ'), depot: await fac('Al Ain fleet depot (demo)', 'Depot', 'Al Ain Industrial Area', 240, 'AE-AZ'), jafza: await fac('Jebel Ali warehouse (demo)', 'Warehouse', 'JAFZA, Dubai', 85, 'AE-DU') };
    for (const [name, email, role] of PEOPLE) await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password, scope_node_id) VALUES ($1,$2,$3,$4,$5,false,$6)`, [t, email, name, role, hash, role === 'admin' ? g : null]);
    const item = async (code: string) => { const r = (await c.query(`SELECT id FROM item WHERE code = $1`, [code])).rows[0]; if (!r) throw new Error(`Item ${code} missing: start the app once so the factor files load`); return r.id as number; };
    const it = { gas: await item('desnz:natural-gas'), gasoil: await item('desnz:gas-oil'), lpg: await item('desnz:lpg'), grid: await item('grid:electricity'), r410a: await item('blend:r410a') };
    return { t, f, it };
  });
  app = await buildApp({ rateLimit: null });
  const s = await session('hse@aldhafra.demo', pw);

  // ------------------------------------------------------------------ entries: 2025 and January–September 2026
  const { f, it } = ids;
  const entries: Record<string, unknown>[] = [];
  for (const [year, last] of [[2025, 12], [2026, 9]] as const) {
    for (let m = 1; m <= last; m++) {
      const mm = String(m).padStart(2, '0'), end = new Date(Date.UTC(year, m, 0)).getUTCDate();
      const g = year === 2026 ? 0.97 : 1;
      const e = (facilityId: string, itemId: number, quantity: number, unit: string, extra: Record<string, unknown> = {}) =>
        entries.push({ facilityId, itemId, quantity: Math.round(quantity * 1000) / 1000, unit, periodStart: `${year}-${mm}-01`, periodEnd: `${year}-${mm}-${end}`, note: 'DEMO (invented)', ...extra });
      e(f.icad, it.gas, 2_650_000 * wave(m, 0.03) * g, 'm3');        // reheating furnace, ladle preheaters
      e(f.icad, it.gasoil, 38 * wave(m), 'kL');                      // emergency gensets, mobile plant
      e(f.icad, it.lpg, 7.5, 't');                                   // cutting, canteen
      e(f.icad, it.grid, 41_000_000 * wave(m, 0.05) * g, 'kWh_e');   // electric arc furnace
      e(f.depot, it.gasoil, 92 * wave(m, 0.04), 'kL');               // yard tractors and the depot's gensets
      e(f.depot, it.grid, 420_000 * wave(m, 0.2), 'kWh_e');
      e(f.jafza, it.grid, 610_000 * wave(m, 0.25), 'kWh_e');
    }
    entries.push({ facilityId: f.icad, itemId: it.r410a, quantity: year === 2025 ? 145 : 60, unit: 'kg', periodStart: `${year}-01-01`, periodEnd: `${year}-${String(last).padStart(2, '0')}-${new Date(Date.UTC(year, last, 0)).getUTCDate()}`, note: 'DEMO (invented): chiller top-ups', fugitive: { method: 'quantity', released: year === 2025 ? 145 : 60 } });
  }
  for (let i = 0; i < entries.length; i += 400) {
    const r = await s<{ saved: number; failed: number; results: { ok: boolean; error?: unknown }[] }>('POST', '/api/activities/batch', { entries: entries.slice(i, i + 400) });
    if (r.failed) console.log(`  ${r.failed} entries refused, e.g.`, JSON.stringify(r.results.find((x) => !x.ok)).slice(0, 400));
  }
  await platformTx(async (c) => { await c.query(`UPDATE activity SET status = 'approved', reviewed_by = 'Demo Finance Manager', reviewed_at = now() WHERE tenant_id = $1`, [ids.t]); });

  // ------------------------------------------------------------------ reporting facilities
  const facility = (name: string, nodeId: string, sector: string, extra: Record<string, unknown>) => s<{ id: string }>('POST', '/api/uae-mrv/facilities', {
    name, nodeId, emirate: 'AZ', sector, operator: NAME, notes: 'DEMO (invented)', ...extra });
  const icad = (await facility('ICAD steel plant (demo)', f.icad, 'industry', { subSector: 'Steel — electric arc furnace and rolling mill', eadId: 'EAD-DEMO-0042', permitNo: 'DEMO-EP-2019-117',
    address: 'Plot 18, ICAD II, Musaffah, Abu Dhabi', operationsStart: '2012-05-01', registeredOn: '2025-02-20', mpVersion: '2.1', mpSubmitted: '2026-03-18', verifier: 'Demo Verification Services LLC (not real)', verifierSince: 2021 })).id;
  const depot = (await facility('Al Ain fleet depot (demo)', f.depot, 'transport', { subSector: 'Road haulage fleet', eadId: 'EAD-DEMO-0311', registeredOn: '2025-03-10' })).id;
  const env = await session('env@aldhafra.demo', pw);
  type St = { id: string; name: string; kind: string; [k: string]: unknown };
  for (const year of [2025, 2026]) {
    for (const id of [icad, depot]) await env('POST', `/api/uae-mrv/facilities/${id}/years/${year}/from-entries`);
    const d = await env<{ streams: St[] }>('GET', `/api/uae-mrv/facilities/${icad}?year=${year}`);
    const unc: Record<string, number> = { 'Natural gas': 1.2, 'Gas oil': 3.5, LPG: 4 };
    const streams: St[] = d.streams.map((x) => ({
      ...x, uncertainty: unc[x.name] ?? 5,
      instrument: x.name === 'Natural gas' ? 'Fiscal ultrasonic meter at the ADNOC Gas custody point (DEMO)' : x.name === 'Gas oil' ? 'Tank dips and delivery notes (DEMO)' : 'Supplier invoices (DEMO)',
      ...(x.name === 'Natural gas' ? { ncv: null, efSource: 'IPCC 2006 default; supplier NCV certificate on file (DEMO)' } : {}),
    }));
    streams.push(
      { id: 'eaf-carbon-in', name: 'EAF carbon inputs (electrodes, charge carbon, DRI carbon)', kind: 'mass_balance', material: 'Graphite electrodes, anthracite, DRI', adQty: year === 2025 ? 11_800 : 8_600, adUnit: 't', carbon: 0.86, direction: 'input', uncertainty: 2.2, instrument: 'Weighbridge WB-2 (DEMO)', efSource: 'Laboratory carbon analysis, quarterly (DEMO)' },
      { id: 'eaf-carbon-out', name: 'Carbon in steel and slag', kind: 'mass_balance', material: 'Billets and EAF slag', adQty: year === 2025 ? 1_020_000 : 760_000, adUnit: 't', carbon: 0.0021, direction: 'output', uncertainty: 1.5, instrument: 'Production records (DEMO)', efSource: 'Spectrometer heat analysis (DEMO)' },
    );
    await env('PUT', `/api/uae-mrv/facilities/${icad}/years/${year}/streams`, { streams });
    const dp = await env<{ streams: St[] }>('GET', `/api/uae-mrv/facilities/${depot}?year=${year}`);
    await env('PUT', `/api/uae-mrv/facilities/${depot}/years/${year}/streams`, { streams: dp.streams.map((x) => ({ ...x, mobile: true, uncertainty: 4, instrument: 'Fuel card system and depot tank dips (DEMO)' })) });
  }
  const Y = (status: string, extra: Record<string, unknown> = {}) => ({
    status, submittedOn: null, reference: null, production: [{ product: 'Reinforcing bar (rebar)', qty: 640_000, unit: 't' }, { product: 'Wire rod', qty: 285_000, unit: 't' }],
    gaps: [], qa: 'DEMO: the Environment Engineer prepares the monthly fuel and carbon balance; the HSE Director reviews it. Meters calibrated yearly by an accredited laboratory; errors corrected within 30 days and logged.',
    verifNotified: null, siteVisit: null, verifiedOn: null, opinion: null, statementDoc: null, ...extra });
  await s('PUT', `/api/uae-mrv/facilities/${icad}/years/2025`, Y('submitted', { submittedOn: '2026-03-27', reference: 'EAD-MRV-2026-DEMO-118',
    gaps: [{ description: 'Natural gas meter outage, 9–14 August 2025 (DEMO)', approach: 'Average daily use of the 30 days before and after', t: 410 }] }));
  await s('PUT', `/api/uae-mrv/facilities/${icad}/years/2026`, Y('draft', { production: [{ product: 'Reinforcing bar (rebar)', qty: 470_000, unit: 't' }], verifNotified: '2026-06-24', siteVisit: '2026-09-15' }));
  await s('PUT', `/api/uae-mrv/facilities/${depot}/years/2025`, Y('ready', { production: [{ product: 'Freight moved', qty: 41_000_000, unit: 't-km' }], qa: 'DEMO: fuel cards reconciled monthly with depot dips.' }));
  for (const m of [
    { facilityId: icad, title: 'Regenerative burners on reheating furnace 2 (DEMO)', means: 'efficiency', status: 'implemented', startYear: 2024, tPerYear: 6_800, capexAed: 21_000_000, note: 'Gas use per tonne down 11% (DEMO)' },
    { facilityId: icad, title: 'Hot charging of billets from the caster (DEMO)', means: 'efficiency', status: 'planned', startYear: 2027, tPerYear: 9_500, capexAed: 34_000_000, note: '' },
    { facilityId: icad, title: 'Solar PPA for 30% of EAF electricity (DEMO)', means: 'clean_energy', status: 'studied', startYear: 2028, tPerYear: 52_000, capexAed: null, note: 'Scope 2: not part of the EAD report (DEMO)' },
    { facilityId: null, title: 'Fleet renewal to Euro VI trucks (DEMO)', means: 'fuel_switch', status: 'planned', startYear: 2026, tPerYear: 600, capexAed: 8_500_000, note: '' },
  ]) await env('POST', '/api/uae-mrv/measures', m);
  await s('PUT', '/api/uae-mrv/company/2025', { designated: 'unknown', designationRef: null, ieqtStatus: 'registered', verifier: null, notes: 'DEMO: organisation registered on the national MRV system; waiting for the emirate focal point.' });
  await app.close();

  console.log(`\nUAE MRV demo created (figures INVENTED): ${NAME}`);
  console.log('  ICAD steel plant (above 25,000 t: 2025 report submitted, 2026 in draft), Al Ain fleet depot (below the threshold), Jebel Ali warehouse (federal only)');
  console.log('Sign in at / (same password, shown once), then Disclose → UAE MRV:');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(24)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
