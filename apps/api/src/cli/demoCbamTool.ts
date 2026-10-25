/**
 * CBAM tool demo for a laptop: two CBAM-only companies (the CBAM menu only), linked as importer and supplier.
 *
 *   Nordhafen Metall Handel GmbH (demo) — EU importer in Hamburg: 2026 customs lines (steel, clinker, urea,
 *     aluminium), five suppliers, data requests (accepted, waiting for review, overdue, open), forecast.
 *   Anatolia Steel (demo) — exporter in Türkiye: its Q1 2026 communication (the Commission's template) filled in
 *     and sent, used to answer Nordhafen's Q1 request from its own account; Nordhafen's Q2 request still to answer.
 *
 *   npm run demo:cbam
 *   npm run demo:cbam -- --reset     delete both demo companies (and all their data) and create them again
 *
 * Default values and benchmarks are the Commission's (loaded at start-up). Companies, tonnes and supplier
 * values are INVENTED. Demo only — never run this on a server with real clients.
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { loadShippedOfficial } from '../lib/cbamOfficial.js';
import { buildApp } from '../app.js';

const IMPORTER = 'Nordhafen Metall Handel GmbH (demo)', EXPORTER = 'Anatolia Steel (demo)';
const PEOPLE: [string, string, string, string][] = [
  [IMPORTER, 'Demo Importer Admin', 'importer@nordhafen.demo', 'super_admin'], [IMPORTER, 'Demo Customs Analyst', 'analyst@nordhafen.demo', 'manager'],
  [EXPORTER, 'Demo Exporter Admin', 'exporter@anatolia.demo', 'super_admin'],
];

let app: FastifyInstance;
async function session(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login ${email}: ${r.body}`);
  const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; ');
  return async <T = Record<string, unknown>>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> => {
    const x = await app.inject({ method: method as 'GET', url, payload: (body ?? (method === 'GET' ? undefined : {})) as object, headers: { cookie, ...headers } });
    if (x.statusCode >= 300) throw new Error(`${method} ${url}: ${x.statusCode} ${x.body.slice(0, 300)}`);
    return x.json() as T;
  };
}
async function supplierSession(email: string, code: string) {
  const r = await app.inject({ method: 'POST', url: '/api/public/cbam/supplier/login', payload: { email, code } });
  if (r.statusCode !== 200) throw new Error(`supplier login: ${r.body}`);
  const token = r.json().token as string;
  return (url: string, body: unknown) => app.inject({ method: 'POST', url, payload: body as object, headers: { 'x-cbam-supplier': token } });
}

/** Anatolia's Q1 2026 communication: EAF melt shop (billets) and hot-rolling mill (coil), with bought DRI. INVENTED. */
const anatoliaQ1 = {
  period: { start: '2026-01-01', end: '2026-03-31' },
  installation: { name: 'Iskenderun works (demo)', country: 'TR', unlocode: 'TR ISK', city: 'Iskenderun', registryId: 'TR-DEMO-0042 (not real)', street: 'DEMO address, organised industrial zone',
    operatorName: EXPORTER, operatorCountry: 'TR', contactName: 'Demo Exporter Admin', contactEmail: 'exporter@anatolia.demo' },
  goods: [{ category: 'Crude steel', routes: ['Electric arc furnace'] }, { category: 'Iron or steel products', routes: [] }],
  processes: [
    { id: 'p1', name: 'EAF melt shop', category: 'Crude steel', includes: ['Only direct production'], production: [0, 42000], market: 12000, consumedIn: { p2: 30000 }, nonCbam: 0, dirEm: 17500,
      elecMwh: 19000, elecEf: 0.44, elecSource: 'D.4.1', elecExported: 0, carbon: { share: 0, price: 0, rebate: 0 } },
    { id: 'p2', name: 'Hot strip mill', category: 'Iron or steel products', includes: ['Only direct production'], production: [29000], market: 29000, consumedIn: {}, nonCbam: 0, dirEm: 4100,
      elecMwh: 3800, elecEf: 0.44, elecSource: 'D.4.1', elecExported: 0 },
  ],
  precursors: [{ id: 'pp1', name: 'Bought DRI', category: 'Direct reduced iron', country: 'IN', purchased: [9000], consumedIn: { p1: 9000 }, other: 0, seeDirect: 1.1, seeDirectSource: 'Default',
    elecPerT: 0.1, elecPerTSource: 'Measured', elecEf: 0.7, elecEfSource: 'D.4.2', justification: 'The supplier has not sent its own data yet' }],
  streams: [{ method: 'Combustion', name: 'Natural gas', ad: 2600, unit: '1000Nm3', ncv: 36, ef: 56.1, efUnit: 'tCO2/TJ', oxf: 99, bio: 0 },
            { method: 'Process emissions', name: 'Electrodes', ad: 900, unit: 't', ef: 3.6, efUnit: 'tCO2/t', convf: 100 },
            { method: 'Process emissions', name: 'Charge carbon', ad: 700, unit: 't', ef: 3.2, efUnit: 'tCO2/t', convf: 100 }],
  ghg: { indirect: 10000 }, quality: { general: 'Mostly measurements & analyses', assurance: 'Internal audits' },
  products: [{ processId: 'p2', cn: '72083900', name: 'Hot-rolled coil < 3 mm', reducingAgent: 'Natural gas', params: { mn: 0.008, carbonPct: 0.0015 } },
             { processId: 'p1', cn: '72071114', name: 'Billets (non-alloy)', params: { mn: 0.008, carbonPct: 0.002 } }],
};

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await platformTx((c) => loadShippedOfficial(c, (m) => console.log(m)));
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = ANY($1)`, [[IMPORTER, EXPORTER]])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The CBAM demo companies already exist. Run "npm run demo:cbam -- --reset" to create them again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const ids = await platformTx(async (c) => {
    const m = new Map<string, string>();
    for (const [name, country, tz, cur] of [[IMPORTER, 'DE', 'Europe/Berlin', 'EUR'], [EXPORTER, 'TR', 'Europe/Istanbul', 'EUR']] as const) {
      const id = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone) VALUES ($1,$2,'AR5','enterprise',ARRAY['cbam'],$3,$4) RETURNING id`, [name, country, cur, tz])).rows[0].id as string;
      await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,$3)`, [id, name, country]);
      m.set(name, id);
    }
    for (const [co, name, email, role] of PEOPLE)
      await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING`, [m.get(co), email, name, role, hash]);
    return m;
  });
  app = await buildApp({ rateLimit: null });
  const imp = await session('importer@nordhafen.demo', pw), exp = await session('exporter@anatolia.demo', pw);

  // ---------------------------------------------------------------- the exporter: its Q1 communication
  await exp('PUT', '/api/cbam/settings', { role: 'exporter' });
  const comm = await exp<{ id: string }>('POST', '/api/cbam/comms', { title: 'Iskenderun works — Q1 2026', period: anatoliaQ1.period });
  await exp('PUT', `/api/cbam/comms/${comm.id}`, { data: anatoliaQ1 });
  let commStatus = 'draft';
  try { await exp('PUT', `/api/cbam/comms/${comm.id}`, { status: 'final' }); await exp('PUT', `/api/cbam/comms/${comm.id}`, { status: 'sent', sentTo: `${IMPORTER} (customs@nordhafen.demo)` }); commStatus = 'sent'; } catch (e) { console.log(`  (communication left in draft: ${(e as Error).message.slice(0, 160)})`); }

  // ---------------------------------------------------------------- the importer
  await imp('PUT', '/api/cbam/settings', { role: 'importer', eori: 'DE123456789012' });
  const sup = new Map<string, string>();
  for (const [name, country, inst, email] of [
    [EXPORTER, 'TR', 'Iskenderun works (demo)', 'exporter@anatolia.demo'], ['Gujarat Rolling Mills (demo)', 'IN', 'Hazira plate mill', 'carbon@gujarat.demo'],
    ['Shandong Billet Co. (demo)', 'CN', 'Rizhao melt shop', 'cbam@shandong.demo'], ['Marmara Cement (demo)', 'TR', 'Gebze clinker plant', 'cbam@marmara.demo'],
    ['Nile Fertilisers (demo)', 'EG', 'Ain Sokhna urea plant', 'cbam@nilefert.demo'], ['Deccan Aluminium (demo)', 'IN', 'Jharsuguda smelter', 'esg@deccan.demo'],
  ] as const) sup.set(name, (await imp<{ id: string }>('POST', '/api/cbam/suppliers', { name, country, installation: inst, contactEmail: email, contactName: 'CBAM contact (demo)' })).id);
  // customs lines 2026 (procedure 40 = release for free circulation)
  const L: [string, string, string, string, number, string, string][] = [
    ['2026-01-19', '72083900', 'Hot-rolled coil < 3 mm', 'TR', 620, EXPORTER, 'C/F'], ['2026-03-04', '72071114', 'Billets, non-alloy', 'TR', 400, EXPORTER, ''],
    ['2026-04-22', '72083900', 'Hot-rolled coil < 3 mm', 'TR', 710, EXPORTER, ''], ['2026-07-08', '72083900', 'Hot-rolled coil < 3 mm', 'TR', 655, EXPORTER, ''],
    ['2026-02-10', '72085120', 'Hot-rolled plate > 15 mm', 'IN', 300, 'Gujarat Rolling Mills (demo)', ''], ['2026-05-14', '72085120', 'Hot-rolled plate > 15 mm', 'IN', 340, 'Gujarat Rolling Mills (demo)', ''],
    ['2026-08-26', '72085120', 'Hot-rolled plate > 15 mm', 'IN', 290, 'Gujarat Rolling Mills (demo)', ''],
    ['2026-05-02', '72071114', 'Billets, non-alloy', 'CN', 1200, 'Shandong Billet Co. (demo)', ''], ['2026-08-11', '72071114', 'Billets, non-alloy', 'CN', 900, 'Shandong Billet Co. (demo)', ''],
    ['2026-03-17', '2523100090', 'Grey cement clinker', 'TR', 5000, 'Marmara Cement (demo)', ''],
    ['2026-07-15', '31021019', 'Urea, > 45% N', 'EG', 2500, 'Nile Fertilisers (demo)', ''],
    ['2026-06-03', '76011010', 'Unwrought aluminium, not alloyed', 'IN', 260, 'Deccan Aluminium (demo)', ''],
  ];
  for (const [d, cn, description, origin, mass, supplier] of L)
    await imp('POST', '/api/cbam/imports', { year: 2026, importDate: d, cn, description, origin, mass, supplier, procedure: '40', customsRef: `DEMO-MRN-${d.replace(/-/g, '')}`, source: 'default' });

  // data requests
  const req = (supplier: string, quarter: number, dueDate: string, message: string, cnCodes: string[] = []) =>
    imp<{ id: string; code: string }>('POST', '/api/cbam/requests', { supplierId: sup.get(supplier), year: 2026, quarter, dueDate, message, cnCodes, sendEmail: false });
  // 1. Gujarat answered Q1 by form; accepted → actual values on its lines
  const r1 = await req('Gujarat Rolling Mills (demo)', 1, '2026-04-30', 'Please send the specific embedded emissions of the plate you shipped in Q1 2026.');
  let s = await supplierSession('carbon@gujarat.demo', r1.code);
  await s('/api/public/cbam/supplier/form', { installation: { name: 'Hazira plate mill', country: 'IN', registryId: 'IN-DEMO-0007 (not real)' }, verified: true,
    goods: [{ cn: '72085120', name: 'Plate > 15 mm', seeDirect: 2.18, seeIndirect: 0.64, defaultShare: 0.1 }] });
  const v1 = await imp<{ responses: { id: string }[] }>('GET', `/api/cbam/requests/${r1.id}`);
  await imp('POST', `/api/cbam/responses/${v1.responses[0]!.id}/review`, { decision: 'accept', apply: true });
  // 2. Nile answered Q3 by form, with a message: waiting for review
  const r2 = await req('Nile Fertilisers (demo)', 3, '2026-10-31', 'Q3 2026 urea, please.');
  s = await supplierSession('cbam@nilefert.demo', r2.code);
  await s('/api/public/cbam/supplier/form', { installation: { name: 'Ain Sokhna urea plant', country: 'EG' }, verified: false, goods: [{ cn: '31021019', name: 'Granular urea', seeDirect: 0.42, seeIndirect: 0.07, defaultShare: 0 }] });
  await s('/api/public/cbam/supplier/message', { body: 'Values from our 2025 monitoring report; the verifier visits in January.' });
  // 3. Shandong: overdue, no answer
  await req('Shandong Billet Co. (demo)', 2, '2026-08-15', 'Q2 2026 billets: specific embedded emissions and the production route, please.');
  // 4. Anatolia answered Q1 from its own account with the communication above: waiting for review
  const r4 = await req(EXPORTER, 1, '2026-04-30', 'Q1 2026 coil and billets, please — the communication template is fine.');
  if (commStatus === 'sent') await exp('POST', '/api/cbam/answer', { email: 'exporter@anatolia.demo', code: r4.code, commId: comm.id });
  // 5. Anatolia: Q2 still to answer (the code is printed below to try it)
  const r5 = await req(EXPORTER, 2, '2026-11-30', 'Q2 2026 coil, please.');
  await app.close();

  console.log(`\nCBAM demo created (companies and figures INVENTED; default values and benchmarks are the Commission's):`);
  console.log(`  ${IMPORTER}: ${L.length} customs lines 2026, ${sup.size} suppliers, 5 data requests`);
  console.log(`  ${EXPORTER}: Q1 2026 communication (${commStatus}), answers Nordhafen's requests\n`);
  console.log('Sign in at /cbam (all with the same password, shown once):');
  for (const [co, name, email] of PEOPLE) console.log(`  ${email.padEnd(26)} ${name} — ${co}`);
  console.log(`\n  Password: ${pw}\n`);
  console.log(`Nordhafen's Q2 request to Anatolia — answer it as exporter@anatolia.demo (Answer a request) or on /cbam-supplier:`);
  console.log(`  e-mail exporter@anatolia.demo · access code ${r5.code}\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
