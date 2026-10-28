/**
 * Compliance desk demo for a laptop: "Gulf-India Metals Group PJSC (demo)". The group is based in Abu Dhabi with a
 * rolling mill in Abu Dhabi (an EAD facility), a plant in India (listed on NSE, top 500), a trading subsidiary in Germany
 * that imports CBAM goods, and a UK service company. The financial year ends in March. 2025 and 2026 statuses are already set,
 * with one obligation overdue, one date moved and two of the company's own obligations.
 *
 *   npm run demo:compliance
 *   npm run demo:compliance -- --reset     delete the demo company (and all its data) and create it again
 *
 * Every figure and status is INVENTED. The applicability is the platform's reading of the profile, not legal advice.
 */
import type { FastifyInstance } from 'fastify';
import { platformTx, pool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { autoSetup } from '../db/setup.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { buildApp } from '../app.js';

const NAME = 'Gulf-India Metals Group PJSC (demo)';
const PEOPLE: [string, string, string][] = [['Demo Head of Sustainability', 'esg@gimetals.demo', 'super_admin'], ['Demo Company Secretary', 'cosec@gimetals.demo', 'admin'], ['Demo Compliance Manager', 'compliance@gimetals.demo', 'manager']];

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
type Ob = { reg: string; obligation: string; period: number; due: string | null };

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await autoSetup((m) => console.log(m));
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log(`The compliance demo company already exists. Run "npm run demo:compliance -- --reset" to create it again.`); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  await platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone, year_start_month) VALUES ($1,'AE','AR5','enterprise',ARRAY['ekotrace','compliance'],'AED','Asia/Dubai',4) RETURNING id`, [NAME])).rows[0].id as string;
    const g = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'AE') RETURNING id`, [t, NAME])).rows[0].id as string;
    const fac = (n: string, type: string, loc: string, country: string) => c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country) VALUES ($1,$2,'facility',$3,$4,$5,$6)`, [t, g, n, type, loc, country]);
    await fac('Musaffah rolling mill (demo)', 'Plant', 'Musaffah, Abu Dhabi', 'AE');
    await fac('Jamshedpur wire plant (demo)', 'Plant', 'Jamshedpur, Jharkhand', 'IN');
    await fac('Hamburg trading office (demo)', 'Office', 'Hamburg', 'DE');
    await fac('Birmingham service centre (demo)', 'Office', 'Birmingham', 'GB');
    for (const [name, email, role] of PEOPLE) await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password, scope_node_id) VALUES ($1,$2,$3,$4,$5,false,$6)`, [t, email, name, role, hash, role === 'admin' ? g : null]);
  });
  app = await buildApp({ rateLimit: null });
  const s = await session('esg@gimetals.demo', pw);
  await s('PUT', '/api/compliance/profile', {
    fyEndMonth: 3, countries: [], employees: 4_200, turnoverEur: 1_150_000_000, euTurnoverEur: 180_000_000, euSubsidiaryTurnoverEur: 140_000_000, euEntity: false,
    listed: 'india', sgxSti: false, sgxCapOver1bn: false, indiaTop: 'top500', cctsObligated: false, cbamImportTonnes: 1_800, cbamExporter: true,
    uaeDesignated: 'yes', uaeScope12: 320_000, eadFacility: true, usRevenueUsd: null, californiaBusiness: false, auGroup: 'none', ukQuoted: false, ukLarge: true,
  });
  const d = await s<{ obligations: Ob[] }>('GET', '/api/compliance?year=2026');
  const find = (reg: string, obligation: string, dueYear: number) => d.obligations.find((o) => o.reg === reg && o.obligation === obligation && o.due?.startsWith(String(dueYear)));
  const put = async (reg: string, obligation: string, body: Record<string, unknown>, dueYear = 2026) => {
    const o = find(reg, obligation, dueYear);
    if (!o) { console.log(`  (no ${reg}/${obligation} in 2026: skipped)`); return; }
    await s('PUT', '/api/compliance/status', { reg, obligation, period: o.period, status: null, owner: null, note: '', documentId: null, doneOn: null, dueOverride: null, ...body });
  };
  await put('eu_cbam', 'declarant', { status: 'done', doneOn: '2026-02-16', owner: 'Hamburg trading office', note: 'DEMO: authorisation granted by the German authority (DEHSt)' });
  await put('ae_ead', 'registration', { status: 'done', doneOn: '2026-03-24', owner: 'Mill HSE manager', note: 'DEMO: monitoring plan 2026 accepted' });
  await put('ae_ead', 'report', { status: 'done', doneOn: '2026-03-28', owner: 'Mill HSE manager', note: 'DEMO: 2025 report filed' });
  await put('ae_ead', 'notify', { status: 'in_progress', owner: 'Mill HSE manager', note: 'DEMO: verifier\'s site visit rescheduled; notice not yet sent' });   // past 1 July: overdue
  await put('in_brsr', 'brsr', { status: 'done', doneOn: '2025-08-14', owner: 'Company secretary', note: 'DEMO: FY 2024-25' }, 2025);
  await put('uk_secr', 'report', { status: 'done', doneOn: '2025-12-11', owner: 'UK finance manager' }, 2025);
  await put('in_brsr', 'brsr', { status: 'done', doneOn: '2026-08-12', owner: 'Company secretary', note: 'DEMO: published with the annual report FY 2025-26' });
  await put('in_brsr', 'core_assurance', { status: 'done', doneOn: '2026-08-05', owner: 'Head of sustainability', note: 'DEMO: reasonable assurance, first year (top 500)' });
  await put('uk_secr', 'report', { status: 'in_progress', owner: 'UK finance manager', note: 'DEMO: energy data for the UK sites collected; draft with the auditors' });
  const permit = await s<{ id: string }>('POST', '/api/compliance/custom', { title: 'Renew the environmental permit (Musaffah mill)', regulation: 'EAD environmental permit', jurisdiction: 'UAE — Abu Dhabi', dueDate: '2026-11-30', recurrence: 'annual', owner: 'Mill HSE manager', detail: 'DEMO: renewal with the updated air emissions inventory.' });
  await s('PUT', '/api/compliance/status', { reg: `custom:${permit.id}`, obligation: '-', period: 2026, status: 'in_progress', owner: 'Mill HSE manager', note: 'DEMO: EAD agreed to 15 December while the stack test is repeated', documentId: null, doneOn: null, dueOverride: '2026-12-15' });
  const cdp = await s<{ id: string }>('POST', '/api/compliance/custom', { title: 'CDP Climate Change response', regulation: 'Customer request (voluntary)', jurisdiction: 'Global', dueDate: '2026-09-15', recurrence: 'annual', owner: 'Head of sustainability', detail: 'DEMO: two EU customers ask for a CDP score.' });
  await s('PUT', '/api/compliance/status', { reg: `custom:${cdp.id}`, obligation: '-', period: 2026, status: 'done', owner: 'Head of sustainability', note: '', documentId: null, doneOn: '2026-09-10', dueOverride: null });
  await app.close();
  console.log(`\nCompliance desk demo created (figures and statuses INVENTED): ${NAME}`);
  console.log('  Abu Dhabi mill, India plant (NSE top 500), German CBAM importer, UK service company; financial year ends in March');
  console.log('Sign in at / (same password, shown once), then Disclose → Compliance desk:');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(26)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
