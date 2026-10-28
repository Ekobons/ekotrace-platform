/**
 * EPR demo for a laptop: "Sahyog Consumer Goods Ltd (demo)", an Indian food and kitchen-appliance company that sells
 * packaged snacks in Germany and the Netherlands and runs a flexible-film recycling plant. Streams: plastic packaging
 * Categories I (food contact), II and III as brand owner; e-waste (mixer grinders); EU packaging in DE and NL; the
 * recycling plant generating and selling certificates; the UAE pilot scheme typed by hand. FY 2022-23 to FY 2026-27, with
 * a shortfall carried on Category III, a recycled-content gap on Category I and returns filed or open.
 *
 *   npm run demo:epr
 *   npm run demo:epr -- --reset     delete the demo company (and all its data) and create it again
 *
 * Every figure is INVENTED. Targets are the regimes' as published (checked October 2026).
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { autoSetup } from '../db/setup.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { buildApp } from '../app.js';

const NAME = 'Sahyog Consumer Goods Ltd (demo)';
const PEOPLE: [string, string, string][] = [['Demo EPR Head', 'epr@sahyog.demo', 'super_admin'], ['Demo Finance Controller', 'finance@sahyog.demo', 'admin'], ['Demo Compliance Manager', 'compliance@sahyog.demo', 'manager'], ['Demo Packaging Analyst', 'packaging@sahyog.demo', 'preparer']];

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

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await autoSetup((m) => console.log(m));
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The EPR demo company already exists. Run "npm run demo:epr -- --reset" to create it again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  await platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone, year_start_month) VALUES ($1,'IN','AR5','enterprise',ARRAY['ekotrace','epr','compliance'],'INR','Asia/Kolkata',4) RETURNING id`, [NAME])).rows[0].id as string;
    const g = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'IN') RETURNING id`, [t, NAME])).rows[0].id as string;
    for (const [n, loc, ctry] of [['Pune snacks plant (demo)', 'Chakan, Pune', 'IN'], ['Faridabad appliance plant (demo)', 'Faridabad, Haryana', 'IN'], ['Vapi film recycling plant (demo)', 'Vapi, Gujarat', 'IN'], ['Rotterdam sales office (demo)', 'Rotterdam', 'NL']] as const)
      await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country) VALUES ($1,$2,'facility',$3,'Plant',$4,$5)`, [t, g, n, loc, ctry]);
    for (const [name, email, role] of PEOPLE) await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password, scope_node_id) VALUES ($1,$2,$3,$4,$5,false,$6)`, [t, email, name, role, hash, role === 'admin' ? g : null]);
  });
  app = await buildApp({ rateLimit: null });
  const s = await session('epr@sahyog.demo', pw);
  const add = async (b: Record<string, unknown>) => (await s<{ id: string }>('POST', '/api/epr/streams', { currency: 'INR', notes: 'DEMO (invented)', ...b })).id;
  const years = (id: string, rows: Record<string, unknown>[]) => s('PUT', `/api/epr/streams/${id}/years`, { rows: rows.map((r) => ({ note: '', ...r })) });
  let n = 0;
  const cert = (streamId: string, b: Record<string, unknown>) => s('POST', '/api/epr/certs', { direction: 'in', kind: 'recycling', price: null, generatedYear: null, note: 'DEMO (invented)', certificateNo: `DEMO-${String(++n).padStart(4, '0')}`, ...b, streamId });
  const filed = (id: string, year: number, on: string) => s('PUT', `/api/epr/streams/${id}/years/${year}/return`, { status: 'filed', filedOn: on, returnRef: `DEMO-AR-${year}-${id.slice(0, 4)}` });

  // plastic Category I — food contact (PET bottles, HDPE jars): FY 2025-26 obligation met; recycled content short (30% needed)
  const c1 = await add({ regime: 'in_plastic', role: 'brand_owner', category: 'cat1', name: 'Rigid PET bottles and HDPE jars', registration: 'DEMO-BO-PB-0101', foodContact: true, ecRate: 6000, certPrice: 3400, registeredOn: '2022-07-14' });
  await years(c1, [{ year: 2023, placed: 2100 }, { year: 2024, placed: 2260 }, { year: 2025, placed: 2380 }, { year: 2026, placed: 2510, recycledTonnes: 560 }, { year: 2027, placed: 1290, recycledTonnes: 470, note: 'April–September 2026' }]);
  for (const [y, t, p] of [[2024, 2180, 2600], [2025, 2320, 2900], [2026, 2450, 3300]] as const) await cert(c1, { year: y, tonnes: t, price: p, counterparty: 'DEMO Shakti Polymers Recycling Pvt Ltd', counterpartyReg: 'DEMO-PWP-MH-221', tradedOn: `${y}-05-20` });
  await cert(c1, { year: 2027, tonnes: 900, price: 3350, counterparty: 'DEMO Shakti Polymers Recycling Pvt Ltd', counterpartyReg: 'DEMO-PWP-MH-221', tradedOn: '2026-09-25' });
  for (const [y, on] of [[2024, '2024-06-27'], [2025, '2025-06-24'], [2026, '2026-06-29']] as const) await filed(c1, y, on);

  // plastic Category II — flexible laminates: FY 2025-26 return in progress, partly met
  const c2 = await add({ regime: 'in_plastic', role: 'brand_owner', category: 'cat2', name: 'Flexible snack wrappers (mono-layer)', registration: 'DEMO-BO-PB-0101', ecRate: 6000, certPrice: 2100, registeredOn: '2022-07-14' });
  await years(c2, [{ year: 2023, placed: 1450 }, { year: 2024, placed: 1520 }, { year: 2025, placed: 1610 }, { year: 2026, placed: 1700, recycledTonnes: 180 }, { year: 2027, placed: 880, recycledTonnes: 95 }]);
  for (const [y, t, k] of [[2024, 1100, 'recycling'], [2024, 385, 'eol'], [2025, 700, 'recycling'], [2025, 860, 'eol'], [2026, 1200, 'recycling']] as const) await cert(c2, { year: y, tonnes: t, kind: k, price: k === 'eol' ? 900 : 2000, counterparty: k === 'eol' ? 'DEMO Gujarat Cement Co-processing' : 'DEMO Vapi film recycling plant (own)', tradedOn: `${y}-05-28` });
  for (const [y, on] of [[2024, '2024-06-27'], [2025, '2025-06-24']] as const) await filed(c2, y, on);
  await s('PUT', `/api/epr/streams/${c2}/years/2026/return`, { status: 'in_progress', filedOn: null, returnRef: null });

  // plastic Category III — multi-layered sachets: a FY 2024-25 shortfall carried into FY 2025-26
  const c3 = await add({ regime: 'in_plastic', role: 'brand_owner', category: 'cat3', name: 'Multi-layer sachets and pouches', registration: 'DEMO-BO-PB-0101', ecRate: 6000, certPrice: 1500, registeredOn: '2022-07-14' });
  await years(c3, [{ year: 2023, placed: 820 }, { year: 2024, placed: 860 }, { year: 2025, placed: 910 }, { year: 2026, placed: 950, recycledTonnes: 40 }]);
  await cert(c3, { year: 2024, tonnes: 840, price: 1100, kind: 'eol', counterparty: 'DEMO Gujarat Cement Co-processing', tradedOn: '2024-06-10' });
  await cert(c3, { year: 2025, tonnes: 600, price: 1250, kind: 'recycling', counterparty: 'DEMO Deccan Multilayer Recyclers', tradedOn: '2025-06-12' });
  await cert(c3, { year: 2026, tonnes: 900, price: 1400, kind: 'recycling', counterparty: 'DEMO Deccan Multilayer Recyclers', tradedOn: '2026-06-15' });
  for (const [y, on] of [[2024, '2024-06-27'], [2025, '2025-06-24'], [2026, '2026-06-29']] as const) await filed(c3, y, on);

  // e-waste: mixer grinders and kettles, average life 8 years
  const ew = await add({ regime: 'in_ewaste', role: 'producer', category: 'lsee', name: 'Mixer grinders and kettles', registration: 'DEMO-EPR-EW-4410', avgLife: 8, ecRate: 12000, certPrice: 3800, registeredOn: '2023-04-20' });
  await years(ew, [{ year: 2016, placed: 640 }, { year: 2017, placed: 700 }, { year: 2018, placed: 760 }, { year: 2019, placed: 810 }, { year: 2024, placed: 1180 }, { year: 2025, placed: 1240 }, { year: 2026, placed: 1300 }]);
  for (const [y, t] of [[2024, 384], [2025, 420], [2026, 530]] as const) await cert(ew, { year: y, tonnes: t, price: 3500 + (y - 2024) * 200, counterparty: 'DEMO E-Cycle India Recyclers', counterpartyReg: 'DEMO-EWR-HR-17', tradedOn: `${y}-05-30` });
  for (const [y, on] of [[2024, '2024-06-28'], [2025, '2025-06-25'], [2026, '2026-06-27']] as const) await filed(ew, y, on);

  // EU packaging: snacks sold in Germany and the Netherlands (calendar years; fees per tonne)
  const de = await add({ regime: 'eu_ppwr', role: 'producer', category: 'plastic_other', name: 'Snack packaging sold in Germany', country: 'DE', registration: 'DEMO-LUCID-DE5551234', registeredOn: '2026-07-30', feeRate: 780, currency: 'EUR', pro: 'DEMO dual system GmbH' });
  await years(de, [{ year: 2025, placed: 118 }, { year: 2026, placed: 131, recycledTonnes: 22 }]);
  const nl = await add({ regime: 'eu_ppwr', role: 'producer', category: 'plastic_other', name: 'Snack packaging sold in the Netherlands', country: 'NL', feeRate: 840, currency: 'EUR', pro: 'DEMO Afvalfonds member' });
  await years(nl, [{ year: 2026, placed: 46 }]);

  // the Vapi plant: flexible film recycled, certificates generated and sold to brand owners
  const rp = await add({ regime: 'in_plastic', role: 'recycler', category: 'cat2', name: 'Vapi flexible film recycling plant', registration: 'DEMO-PWP-GJ-0907', certPrice: 2050, registeredOn: '2023-01-12' });
  await years(rp, [{ year: 2025, placed: 5200 }, { year: 2026, placed: 6100 }, { year: 2027, placed: 3300 }]);
  for (const [y, t] of [[2025, 4700], [2026, 5600], [2027, 3000]] as const) await cert(rp, { generatedYear: y, year: null, tonnes: t, counterparty: 'DEMO municipal and MRF bales', tradedOn: y === 2027 ? '2026-09-30' : `${y - 1}-12-31` });
  for (const [y, t, who, p] of [[2025, 2800, 'DEMO Annapurna Foods Ltd', 1900], [2025, 1200, 'Sahyog (own Category II)', 2000], [2026, 3900, 'DEMO Bharat Dairy Co-op', 2050], [2027, 1500, 'DEMO Annapurna Foods Ltd', 2100]] as const)
    await cert(rp, { direction: 'out', year: y, tonnes: t, price: p, counterparty: who, tradedOn: y === 2027 ? '2026-10-15' : `${y - 1}-11-15` });

  // UAE: the federal pilot scheme, typed
  await add({ regime: 'other', role: 'importer', category: 'packaging', name: 'Packaging imported into the UAE', country: 'AE', scheme: 'UAE EPR framework (MOCCAE pilot with Tadweer)', currency: 'AED', notes: 'DEMO (invented): pilot participation; the mandatory scheme and its targets are still to be published.' });

  await app.close();
  console.log(`\nEPR demo created (figures INVENTED): ${NAME}`);
  console.log('  Plastic packaging Categories I–III, e-waste, EU packaging (DE, NL), a recycling plant selling certificates, the UAE pilot');
  console.log('Sign in at / (same password, shown once), then Disclose → EPR:');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(26)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
