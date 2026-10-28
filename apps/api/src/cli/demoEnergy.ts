/**
 * Energy management demo for a laptop: "Oasis Hospitality & Cold Chain LLC (demo)", four UAE sites with two years of
 * entries (2024 baseline, 2025): a cold store and an office tower driven by cooling degree days, a hotel driven by
 * degree days and occupancy (with district cooling), a bakery plant driven by production (natural gas and
 * electricity). Measures go live during 2025, so the savings show against the baselines; one month carries a fault.
 *
 *   npm run demo:energy
 *   npm run demo:energy -- --reset     delete the demo company (and all its data) and create it again
 *
 * Every figure is INVENTED (degree days included). Entries are calculated by the platform and then marked approved.
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { autoSetup } from '../db/setup.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { buildApp } from '../app.js';

const NAME = 'Oasis Hospitality & Cold Chain LLC (demo)';
const PEOPLE: [string, string, string][] = [['Demo Energy Manager', 'energy@oasis.demo', 'super_admin'], ['Demo Finance Director', 'finance@oasis.demo', 'admin'], ['Demo Facilities Engineer', 'fm@oasis.demo', 'manager']];
const CDD = [110, 140, 250, 360, 500, 560, 620, 630, 540, 420, 270, 150];   // DEMO cooling degree days, base 18 °C
const OCC = [0.86, 0.88, 0.84, 0.74, 0.62, 0.55, 0.52, 0.55, 0.64, 0.78, 0.88, 0.9];   // DEMO hotel occupancy
const PROD = [780, 760, 820, 700, 860, 840, 800, 810, 880, 900, 870, 950];   // DEMO tonnes of bread

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
const jitter = (i: number, y: number, amp = 0.02) => 1 + amp * Math.sin(i * 2.3 + y);

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await autoSetup((m) => console.log(m));
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The energy demo company already exists. Run "npm run demo:energy -- --reset" to create it again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const ids = await platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone) VALUES ($1,'AE','AR5','enterprise',ARRAY['ekotrace','energy'],'AED','Asia/Dubai') RETURNING id`, [NAME])).rows[0].id as string;
    const g = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'AE') RETURNING id`, [t, NAME])).rows[0].id as string;
    const fac = async (n: string, type: string, loc: string, m2: number, region: string) => (await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country, floor_area_m2, grid_region) VALUES ($1,$2,'facility',$3,$4,$5,'AE',$6,$7) RETURNING id`, [t, g, n, type, loc, m2, region])).rows[0].id as string;
    const f = { cold: await fac('Jebel Ali cold store (demo)', 'Warehouse', 'JAFZA South, Dubai', 18_500, 'AE-DU'), tower: await fac('Business Bay office tower (demo)', 'Office', 'Business Bay, Dubai', 26_000, 'AE-DU'),
      hotel: await fac('Corniche beach hotel (demo)', 'Hotel', 'Corniche, Abu Dhabi', 41_000, 'AE-AZ'), bakery: await fac('Musaffah bakery plant (demo)', 'Plant', 'Musaffah, Abu Dhabi', 9_800, 'AE-AZ') };
    for (const [name, email, role] of PEOPLE) await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password, scope_node_id) VALUES ($1,$2,$3,$4,$5,false,$6)`, [t, email, name, role, hash, role === 'admin' ? g : null]);
    const item = async (code: string) => { const r = (await c.query(`SELECT id FROM item WHERE code = $1`, [code])).rows[0]; if (!r) throw new Error(`Item ${code} missing: start the app once so the factor files load`); return r.id as number; };
    return { t, f, it: { grid: await item('grid:electricity'), cool: await item('cooling:district'), gas: await item('desnz:natural-gas'), lpg: await item('desnz:lpg') } };
  });
  app = await buildApp({ rateLimit: null });
  const s = await session('energy@oasis.demo', pw);
  const { f, it } = ids;
  const entries: Record<string, unknown>[] = [];
  for (const year of [2024, 2025]) {
    for (let m = 1; m <= 12; m++) {
      const i = m - 1, mm = String(m).padStart(2, '0'), end = new Date(Date.UTC(year, m, 0)).getUTCDate(), j = jitter(i, year);
      const after = (from: number) => (year === 2025 && m >= from ? 1 : 0);
      const e = (facilityId: string, itemId: number, quantity: number, unit: string, extra: Record<string, unknown> = {}) =>
        entries.push({ facilityId, itemId, quantity: Math.round(quantity), unit, periodStart: `${year}-${mm}-01`, periodEnd: `${year}-${mm}-${end}`, note: 'DEMO (invented)', ...extra });
      // cold store: refrigeration follows the weather; door curtains and EC fans from April 2025 (−9%); a defrost fault in August 2025
      e(f.cold, it.grid, (310_000 + 520 * CDD[i]!) * j * (1 - 0.09 * after(4)) * (year === 2025 && m === 8 ? 1.16 : 1), 'kWh_e');
      // office tower: chiller plant optimisation from June 2025 (−12% of the cooling part)
      e(f.tower, it.grid, (240_000 + 760 * CDD[i]! * (1 - 0.12 * after(6))) * j, 'kWh_e');
      // hotel: electricity and district cooling follow weather and occupancy; LED and guest-room controls from March 2025
      e(f.hotel, it.grid, (520_000 + 300 * CDD[i]! + 420_000 * OCC[i]!) * j * (1 - 0.07 * after(3)), 'kWh_e');
      e(f.hotel, it.cool, (95_000 + 260 * CDD[i]!) * j, 'TRh', { energy: { supplier: { name: 'Demo district cooling (not real)', co2e: 0.62, unit: 'TRh', source: 'DEMO' }, cooling: { method: 'supplier' } } });
      e(f.hotel, it.lpg, 21_000 * (0.6 + 0.5 * OCC[i]!) * j, 'kg');
      // bakery: gas follows production; oven heat recovery from July 2025 (−14% of gas)
      e(f.bakery, it.gas, (38_000 + 115 * PROD[i]! * (year === 2025 ? 1.03 : 1)) * j * (1 - 0.14 * after(7)), 'm3');
      e(f.bakery, it.grid, (160_000 + 210 * PROD[i]!) * j, 'kWh_e');
    }
  }
  for (let i = 0; i < entries.length; i += 400) {
    const r = await s<{ saved: number; failed: number; results: { ok: boolean; error?: unknown }[] }>('POST', '/api/activities/batch', { entries: entries.slice(i, i + 400) });
    if (r.failed) console.log(`  ${r.failed} entries refused, e.g.`, JSON.stringify(r.results.find((x) => !x.ok)).slice(0, 400));
  }
  await platformTx(async (c) => { await c.query(`UPDATE activity SET status = 'approved', reviewed_by = 'Demo Finance Director', reviewed_at = now() WHERE tenant_id = $1`, [ids.t]); });

  const site = async (b: Record<string, unknown>) => (await s<{ id: string }>('POST', '/api/energy/sites', { baselineYear: 2024, notes: 'DEMO (invented)', ...b })).id;
  const cold = await site({ name: 'Jebel Ali cold store (demo)', nodeId: f.cold, siteType: 'warehouse', floorM2: 18_500, modelTarget: 'electricity', modelVars: ['cdd'], enpiVar: 'floor', tariffs: { electricity: 0.38 }, targetPct: 15, targetYear: 2028 });
  const tower = await site({ name: 'Business Bay office tower (demo)', nodeId: f.tower, siteType: 'office', floorM2: 26_000, modelTarget: 'electricity', modelVars: ['cdd'], enpiVar: 'floor', tariffs: { electricity: 0.38 }, targetPct: 20, targetYear: 2030 });
  const hotel = await site({ name: 'Corniche beach hotel (demo)', nodeId: f.hotel, siteType: 'hotel', floorM2: 41_000, modelTarget: 'electricity', modelVars: ['cdd', 'occupancy'], enpiVar: 'occupancy', tariffs: { electricity: 0.32, cooling: 0.17, fuel: 0.31 } });
  const bakery = await site({ name: 'Musaffah bakery plant (demo)', nodeId: f.bakery, siteType: 'plant', floorM2: 9_800, modelTarget: 'fuel', modelVars: ['production'], enpiVar: 'production', productionUnit: 't of bread', tariffs: { electricity: 0.32, fuel: 0.11 }, targetPct: 10, targetYear: 2027 });
  const fm = await session('fm@oasis.demo', pw);
  for (const [id, vars] of [[cold, ['cdd']], [tower, ['cdd']], [hotel, ['cdd', 'occupancy']], [bakery, ['production']]] as [string, string[]][]) {
    const months = [2024, 2025].flatMap((y) => CDD.map((c, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, ...(vars.includes('cdd') ? { cdd: c } : {}),
      ...(vars.includes('occupancy') ? { occupancy: Math.round(OCC[i]! * 412) } : {}), ...(vars.includes('production') ? { production: Math.round(PROD[i]! * (y === 2025 ? 1.03 : 1)) } : {}),
      ...(id === cold && y === 2025 && i === 7 ? { note: 'Defrost timer fault on chamber 3, fixed 2 September (DEMO)' } : {}) })));
    await fm('PUT', `/api/energy/sites/${id}/months`, { months });
  }
  for (const m of [
    { siteId: cold, title: 'Strip curtains and fast doors on all chambers (DEMO)', category: 'insulation', carrier: 'electricity', status: 'verified', implementedOn: '2025-04-01', kwhExpected: 520_000, kwhVerified: 488_000, ipmvp: 'C', capex: 410_000, lifeYears: 8, mvPlan: 'Whole-site electricity against CDD baseline (DEMO)' },
    { siteId: cold, title: 'EC evaporator fans (DEMO)', category: 'motors', carrier: 'electricity', status: 'implemented', implementedOn: '2025-04-15', kwhExpected: 180_000, capex: 260_000, lifeYears: 12 },
    { siteId: tower, title: 'Chiller plant optimisation and VSD pumps (DEMO)', category: 'hvac', carrier: 'electricity', status: 'implemented', implementedOn: '2025-06-01', kwhExpected: 410_000, capex: 1_150_000, lifeYears: 15, mvPlan: 'Option B: chiller plant kW/TR metered for 3 months (DEMO)' },
    { siteId: tower, title: 'Rooftop solar 400 kWp (DEMO)', category: 'solar', carrier: 'electricity', status: 'approved', kwhExpected: 640_000, capex: 1_400_000, lifeYears: 25 },
    { siteId: hotel, title: 'LED lighting and guest-room occupancy controls (DEMO)', category: 'lighting', carrier: 'electricity', status: 'verified', implementedOn: '2025-03-01', kwhExpected: 650_000, kwhVerified: 612_000, ipmvp: 'A', capex: 980_000, lifeYears: 10 },
    { siteId: hotel, title: 'Laundry heat-pump water heating (DEMO)', category: 'fuel_switch', carrier: 'fuel', status: 'idea', kwhExpected: 900_000, capex: 750_000, opexYear: 40_000, lifeYears: 15 },
    { siteId: bakery, title: 'Oven flue heat recovery to proofing rooms (DEMO)', category: 'heat_recovery', carrier: 'fuel', status: 'implemented', implementedOn: '2025-07-01', kwhExpected: 1_150_000, capex: 690_000, lifeYears: 12 },
    { siteId: bakery, title: 'Compressed air leak programme (DEMO)', category: 'compressed_air', carrier: 'electricity', status: 'approved', kwhExpected: 95_000, capex: 35_000, lifeYears: 3 },
  ]) await fm('POST', '/api/energy/measures', m);
  for (const x of [
    { siteId: cold, name: 'Refrigeration compressors (DEMO)', carrier: 'electricity', sharePct: 71, variables: 'Outdoor temperature, door openings, throughput', enpi: 'kWh per m³ stored', controls: 'Suction pressure set points, defrost schedule, door alarms', owner: 'Demo Facilities Engineer' },
    { siteId: hotel, name: 'Chilled-water distribution and AHUs (DEMO)', carrier: 'electricity', sharePct: 38, variables: 'Cooling degree days, occupancy', enpi: 'kWh per occupied room-night', controls: 'BMS schedules, room set-back when unsold', owner: 'Demo Facilities Engineer' },
    { siteId: bakery, name: 'Tunnel ovens (DEMO)', carrier: 'fuel', sharePct: 82, variables: 'Production, product mix', enpi: 'kWh of gas per tonne', controls: 'Burner tuning quarterly, idle shutdown', owner: 'Demo Facilities Engineer' },
  ]) await fm('POST', '/api/energy/seus', x);
  await app.close();

  console.log(`\nEnergy management demo created (figures INVENTED): ${NAME}`);
  console.log('  Cold store, office tower, hotel and bakery; baseline 2024, savings in 2025, a flagged month at the cold store');
  console.log('Sign in at / (same password, shown once), then Net zero → Energy management:');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(22)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
