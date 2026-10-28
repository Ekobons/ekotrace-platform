/**
 * India CCTS demo for a laptop: "Vindhya Cement & Textiles (demo)", an Indian group with two obligated entities.
 *
 *   Vindhya Cement — Chittorgarh works: FY 2025-26 complete (verified, CCCs issued and partly sold) and
 *     FY 2026-27 April–September in progress, running above its target.
 *   Vindhya Spinning Mills — Bhilwara: FY 2026-27 April–September, beating its target.
 *
 *   npm run demo:ccts
 *   npm run demo:ccts -- --reset     delete the demo company (and all its data) and create it again
 *
 * Entities, registration numbers, baselines, targets, output and emissions are INVENTED (shaped like the gazette
 * schedules, not copied from them). Demo only — never run this on a server with real clients.
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { fyMonths } from '../lib/ccts.js';
import { buildApp } from '../app.js';

const NAME = 'Vindhya Cement & Textiles (demo)';
const PEOPLE: [string, string, string][] = [['Demo CCTS Admin', 'ccts@vindhya.demo', 'super_admin'], ['Demo Plant Manager', 'plant@vindhya.demo', 'manager']];

let app: FastifyInstance;
async function session(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.body}`);
  const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  return async <T = Record<string, unknown>>(method: string, url: string, body?: unknown): Promise<T> => {
    const x = await app.inject({ method: method as 'GET', url, payload: (body ?? (method === 'GET' ? undefined : {})) as object, headers: { cookie } });
    if (x.statusCode >= 300) throw new Error(`${method} ${url}: ${x.statusCode} ${x.body.slice(0, 300)}`);
    return x.json() as T;
  };
}

/** A smooth seasonal shape: cement output dips in the monsoon (July–September). */
const SEASON = [1.04, 1.06, 0.98, 0.86, 0.82, 0.9, 1.0, 1.05, 1.07, 1.06, 1.05, 1.11];

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The CCTS demo company already exists. Run "npm run demo:ccts -- --reset" to create it again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const ids = await platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone) VALUES ($1,'IN','AR5','enterprise',ARRAY['ekotrace','ccts'],'INR','Asia/Kolkata') RETURNING id`, [NAME])).rows[0].id as string;
    const g = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'IN') RETURNING id`, [t, NAME])).rows[0].id as string;
    const fac = async (n: string, type: string, loc: string) => (await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country) VALUES ($1,$2,'facility',$3,$4,$5,'IN') RETURNING id`, [t, g, n, type, loc])).rows[0].id as string;
    const kiln = await fac('Chittorgarh works (demo)', 'Plant', 'Chittorgarh, Rajasthan'), mill = await fac('Bhilwara spinning mill (demo)', 'Plant', 'Bhilwara, Rajasthan');
    for (const [name, email, role] of PEOPLE) await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING`, [t, email, name, role, hash]);
    return { t, kiln, mill };
  });
  app = await buildApp({ rateLimit: null });
  const s = await session('ccts@vindhya.demo', pw);

  // ------------------------------------------------------------------- cement works
  const cem = (await s<{ id: string }>('POST', '/api/ccts', {
    name: 'Vindhya Cement Ltd — Chittorgarh works (demo)', registrationNo: 'DEMO-CEM-0117 (not real)', sector: 'cement', subSector: 'Integrated plant (OPC + PPC)', state: 'Rajasthan',
    address: 'DEMO address, Chittorgarh', product: 'Cement equivalent', baselineOutput: 4_200_000, baselineGei: 0.682, gridEf: 0.727, energySource: 'manual', facilityIds: [ids.kiln],
    acva: 'Demo Verification Agency (not real)', priceInr: 900, notes: 'INVENTED figures shaped like a gazette row.',
  })).id;
  await s('PUT', `/api/ccts/${cem}/targets`, { targets: [{ fy: 2025, targetGei: 0.6719 }, { fy: 2026, targetGei: 0.6551 }] });
  const cemMonth = (fy: number, gei: number, i: number) => {
    const out = Math.round(350_000 * SEASON[i]!);
    const process = out * 0.39 * (1 + 0.004 * Math.sin(i)), elecMwh = out * 0.075, re = fy === 2026 ? out * 0.012 : 0;
    const elecT = (elecMwh - re) * 0.727, fuel = out * gei - process - elecT;
    return { output: out, fuel_t: Math.round(fuel), process_t: Math.round(process), grid_mwh: Math.round(elecMwh), re_mwh: Math.round(re) || null };
  };
  await s('PUT', `/api/ccts/${cem}/months`, { months: fyMonths(2025).map((m, i) => ({ month: m, ...cemMonth(2025, 0.6662 + 0.0008 * Math.cos(i), i) })) });
  await s('PUT', `/api/ccts/${cem}/months`, { months: fyMonths(2026).slice(0, 6).map((m, i) => ({ month: m, ...cemMonth(2026, 0.6612 - 0.0004 * i, i), note: i === 4 ? 'Kiln 2 stopped 6 days (refractory)' : '' })) });
  // FY 2025-26: verified and issued; some sold on the exchange
  const y25 = (await s<{ year: { ccc: number } }>('GET', `/api/ccts/${cem}?fy=2025`)).year;
  const issued = Math.floor(y25.ccc);
  if (issued > 0) {
    await s('POST', `/api/ccts/${cem}/ccc`, { kind: 'issued', fy: 2025, quantity: issued, onDate: '2026-10-05', reference: 'DEMO registry issuance (not real)' });
    await s('POST', `/api/ccts/${cem}/ccc`, { kind: 'sold', fy: 2025, quantity: Math.floor(issued / 3), priceInr: 940, onDate: '2026-10-21', reference: 'DEMO exchange trade (not real)' });
  }
  for (const m of [
    { fy: 2025, title: 'Waste heat recovery system, 14 MW (demo)', yearDone: 2025, beforeT: 0, afterT: 0, investmentInr: 1_350_000_000, note: 'Cuts grid purchase by ~95,000 MWh a year' },
    { fy: 2025, title: 'Alternative fuels: 9% thermal substitution with RDF (demo)', yearDone: 2025, beforeT: 410_000, afterT: 374_000, investmentInr: 260_000_000 },
    { fy: 2026, title: 'Clinker factor 0.71 → 0.68 with more fly ash in PPC (demo)', yearDone: 2026, beforeT: 1_650_000, afterT: 1_582_000, investmentInr: 45_000_000 },
  ]) await s('POST', `/api/ccts/${cem}/measures`, m);

  // ------------------------------------------------------------------- spinning mill
  const tex = (await s<{ id: string }>('POST', '/api/ccts', {
    name: 'Vindhya Spinning Mills — Bhilwara (demo)', registrationNo: 'DEMO-TEX-0442 (not real)', sector: 'textile', subSector: 'Spinning', state: 'Rajasthan', product: 'Equivalent yarn',
    baselineOutput: 21_500, baselineGei: 4.91, gridEf: 0.727, energySource: 'manual', facilityIds: [ids.mill], acva: 'Demo Verification Agency (not real)', priceInr: 900,
  })).id;
  await s('PUT', `/api/ccts/${tex}/targets`, { targets: [{ fy: 2025, targetGei: 4.86 }, { fy: 2026, targetGei: 4.72 }] });
  await s('PUT', `/api/ccts/${tex}/months`, { months: fyMonths(2026).slice(0, 6).map((m, i) => {
    const out = 1820 + 30 * i, mwh = out * 5.9, re = out * 0.55;
    return { month: m, output: out, fuel_t: Math.round(out * 0.31), grid_mwh: Math.round(mwh), re_mwh: Math.round(re), note: i === 2 ? 'Rooftop solar 2 MW commissioned' : '' };
  }) });
  await app.close();

  console.log(`\nCCTS demo created (entities and figures INVENTED): ${NAME}`);
  console.log('  Chittorgarh cement works: FY 2025-26 complete, CCCs issued and partly sold; FY 2026-27 April–September');
  console.log('  Bhilwara spinning mill: FY 2026-27 April–September\n');
  console.log('Sign in at / (same password, shown once), then Disclose → India CCTS:');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(22)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
