/**
 * EKOTRACE SME demo for a laptop.
 *
 *   npm run demo:sme
 *   npm run demo:sme -- --reset     delete the demo companies (and all their data) and create them again
 *
 * Creates (every name ends in "(demo)", every figure is INVENTED):
 *   - Shree Ganesh Fasteners (demo)          the SME: a Pune fastener maker exporting steel bolts to the EU and UK
 *   - five more small Pune engineering SMEs   so the cluster view has enough members to show figures
 *   - Bharat Auto Components Ltd (demo)      listed buyer      ┐
 *   - Pune Engineering Cluster (demo)        industry cluster  │ package 'smenet'
 *   - Sahyadri Co-operative Bank (demo)      bank              │
 *   - Mehta & Rao, Chartered Accountants (demo)  CA firm      ┘
 * One temporary password for every demo login is printed at the end.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformTx, pool, tenantTx } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { autoSetup } from '../db/setup.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { purgeTenant } from '../db/purge.js';
import { compute } from '../lib/sme/company.js';

const FY = 'FY 2025-26', PREV = 'FY 2024-25';
const SME = 'Shree Ganesh Fasteners (demo)';
const PARTNERS: [string, 'buyer' | 'cluster' | 'bank' | 'ca_firm', string, string][] = [
  ['Bharat Auto Components Ltd (demo)', 'buyer', 'Pune', 'buyer@sme.demo'],
  ['Pune Engineering Cluster (demo)', 'cluster', 'Pune', 'cluster@sme.demo'],
  ['Sahyadri Co-operative Bank (demo)', 'bank', 'Pune', 'bank@sme.demo'],
  ['Mehta & Rao, Chartered Accountants (demo)', 'ca_firm', 'Mumbai', 'ca@sme.demo'],
];
const MEMBERS: [string, string, number, number, number][] = [   // name, industry, turnover ₹ cr, grid kWh, diesel L
  ['Kalyani Precision Castings (demo)', 'Iron castings', 28, 900000, 22000],
  ['Shiv Sheet Metal Works (demo)', 'Sheet metal components', 9, 210000, 6000],
  ['Anand Rubber Moulders (demo)', 'Rubber parts', 14, 380000, 9000],
  ['Vishwakarma Tools & Dies (demo)', 'Tools and dies', 6, 120000, 2500],
  ['Ojas Powder Coaters (demo)', 'Surface coating', 4, 160000, 14000],
];

/** A believable self-assessment against SRMM v3.1: most indicators answered, a few left open, around Level 2. */
function demoSrmm() {
  const bank = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../data/sme/srmm_mfg.json'), 'utf8')) as { items: { id: string; o: [number, string][] | null; parts?: [string, string][] }[] };
  const scores: Record<string, number> = {}, multi: Record<string, number> = {};
  bank.items.forEach((q, i) => {
    if (i % 11 === 7) return;                                   // left open
    if (q.parts) { q.parts.forEach(([k], j) => { multi[`mfg_${q.id}_${k}`] = j < 2 ? 2 : j === 2 ? 1 : 0; }); return; }
    const opts = [...(q.o ?? [])].map((o) => +o[0]).sort((a, b) => b - a);
    if (!opts.length) return;
    const pick = i % 5 < 2 ? 0 : i % 5 < 4 ? Math.min(1, opts.length - 1) : opts.length - 1;
    scores[`mfg_${q.id}`] = opts[pick]!;
  });
  return { version: 'auto', scores, multi, remarks: {} };
}
const EXAMPLE = {
  profile: { employees: 85, turnover: 42, production: 1700, udyam: true, listed: false, listedBuyer: true, euExport: true, ukExport: true, cbamGood: 'steel', plastics: true, ewaste: false, battery: false, energyIntensive: false, eudr: 'none' },
  emissions: { diesel: 18000, petrol: 2400, lpg: 6000, png: 0, coal: 0, refrig: 12, grid: 620000, solar: 80000, steel: 1800, alu: 0, cement: 0, plastic: 12, road: 450000, air: 60000, rail: 20000 },
  esg: { water: 5200, waste: 140, recycled: 62, women: 14, training: 6, target: false, minwage: true, posh: true, coc: true, abc: false, grievance: true, privacy: false, supplierCode: false, ownerEsg: true },
  certs: [
    { id: 'zed', name: 'MSME ZED certification', level: 'bronze', expiry: '2027-08-31' }, { id: 'iso9001', name: 'ISO 9001 quality', level: 'held', expiry: '2027-03-15' },
    { id: 'iso14001', name: 'ISO 14001 environment', level: 'none', expiry: '' }, { id: 'iso45001', name: 'ISO 45001 safety', level: 'none', expiry: '' },
    { id: 'iso50001', name: 'ISO 50001 energy', level: 'none', expiry: '' }, { id: 'iso27001', name: 'ISO 27001 information security', level: 'none', expiry: '' },
    { id: 'ecovadis', name: 'EcoVadis rating', level: 'none', expiry: '' }, { id: 'greenco', name: 'CII GreenCo rating', level: 'none', expiry: '' },
  ],
  footprint: { products: [
    { name: 'M12 hex bolt, zinc plated', share: 60, steelPerT: 1.08, zincKgPerT: 9, packKgPerT: 6, outTkm: 450, pieceG: 28 },
    { name: 'Spring washer M10', share: 40, steelPerT: 1.05, zincKgPerT: 5, packKgPerT: 4, outTkm: 450, pieceG: 3 },
  ] },
  bills: { cd: 300, md: 340, pf: 0.86, units: 51700, energyRate: 8.2, demandRate: 450, excessMult: 1.5, pfPenalty: 18000, capCost: 800, peakShare: 35, shiftPct: 10, peakSur: 1.5, offRebate: 1.0 },
  solar: { roof: 1200, usable: 70, tariff: 8.2, costKw: 42000, yieldKwp: 1450 },
  credits: { newSolarKw: 120, effKwh: 45000, price: 500, share: 20 },
  calendar: { cto: '2027-03-31', factory: '2026-12-31', fire: '2027-01-15', done: {} },
  epr: { role: 'Brand owner', c1: 3.5, c2: 6.2, c3: 1.1, c4: 0, target: 100, bought: 7.0, registered: true },
  dpdp: {},
  people: { posh_ic: true, posh_ext: false, posh_report: false, hours: 2400, log: [{ date: '2025-08-12', what: 'Hand injury at press shop', days: 4 }, { date: '2025-11-03', what: 'Slip near plating tank, no lost time', days: 0 }] },
  csr: { netWorth: 18, profit1: 3.2, profit2: 4.1, profit3: 5.6, spent: 0 },
  cbam: { tonnesEU: 420, price: 75, eurInr: 98, benchmark: 1.37, defaultValue: 3.2, tonnesUK: 120, ukPrice: 45, gbpInr: 113 },
  eudr: { plots: [] },
  srmm: demoSrmm(),
  loan: { project: 'solar', amount: 0.55, tenor: 5 },
  share: { bench: true },
};

async function main() {
  const reset = process.argv.includes('--reset');
  await migrate(() => {});
  await autoSetup((m) => console.log(m));
  const names = [SME, ...MEMBERS.map((m) => m[0]), ...PARTNERS.map((p) => p[0])];
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = ANY($1)`, [names])).rows.map((r) => r.id as string));
  if (existing.length && !reset) { console.log('The SME demo already exists. Run "npm run demo:sme -- --reset" to create it again.'); return; }
  for (const id of existing) await platformTx(async (c) => { await purgeTenant(c, id); await c.query(`DELETE FROM tenant WHERE id = $1`, [id]); });

  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const tenant = (name: string, products: string[]) => platformTx(async (c) => {
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone, year_start_month) VALUES ($1,'IN','AR5','starter',$2,'INR','Asia/Kolkata',4) RETURNING id`, [name, products])).rows[0].id as string;
    await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'IN')`, [t, name]);
    return t;
  });
  const user = (t: string, email: string, name: string, role: string) => platformTx((c) => c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,false)`, [t, email, name, role, hash]));
  const docs = (t: string, fy: string, d: Record<string, unknown>) => tenantTx(t, async (c) => {
    for (const [m, data] of Object.entries(d)) await c.query(`INSERT INTO sme_doc (tenant_id, fy, module, data, updated_name) VALUES ($1,$2,$3,$4,'Demo')`, [t, fy, m, JSON.stringify(data)]);
  });

  // the SME
  const sme = await tenant(SME, ['sme']);
  await platformTx((c) => c.query(`INSERT INTO sme_company (tenant_id, sector, industry, state, udyam_no, is_example, grievance_token) VALUES ($1,'mfg','Fabricated metal products','Maharashtra','UDYAM-MH-26-0000000','true','d0e0000000000001')`, [sme]));
  await user(sme, 'owner@sme.demo', 'Demo Owner', 'super_admin');
  await user(sme, 'plant@sme.demo', 'Demo Plant Manager', 'manager');
  await user(sme, 'accounts@sme.demo', 'Demo Accounts Clerk', 'preparer');
  await docs(sme, PREV, { profile: EXAMPLE.profile, emissions: { ...EXAMPLE.emissions, grid: 655000, solar: 0, diesel: 21000 }, esg: EXAMPLE.esg, share: { bench: true } });
  await docs(sme, FY, EXAMPLE);
  await tenantTx(sme, async (c) => {
    for (const [item, qty, unit, price, haz, status] of [['MS turnings & borings', 95, 't', 28, false, 'listed'], ['Packaging film (LDPE)', 4, 't', 18, false, 'draft'], ['Used lubricating oil', 2000, 'L', 22, true, 'draft']] as const)
      await c.query(`INSERT INTO sme_scrap (tenant_id, item, qty, unit, price, hazardous, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sme, item, qty, unit, price, haz, status]);
    await c.query(`INSERT INTO sme_grievance (tenant_id, category, text, status, resolved_at) VALUES ($1,'Facilities','Drinking water cooler broken in shed 2 (demo)','resolved', now()), ($1,'Wages','Overtime pay for September not received yet (demo)','open', NULL)`, [sme]);
  });
  for (const fy of [PREV, FY]) await tenantTx(sme, (c) => compute(c, sme, fy));

  // five more cluster members, sharing anonymised figures
  const members: string[] = [];
  let firstPct = 0;
  for (const [i, [name, industry, turnover, grid, diesel]] of MEMBERS.entries()) {
    const t = await tenant(name, ['sme']);
    await platformTx((c) => c.query(`INSERT INTO sme_company (tenant_id, sector, industry, state, is_example) VALUES ($1,'mfg',$2,'Maharashtra',true)`, [t, industry]));
    await user(t, `member${i + 1}@sme.demo`, `Demo Owner ${i + 1}`, 'super_admin');
    await docs(t, FY, { profile: { employees: 20 + i * 15, turnover, production: 0, udyam: true }, emissions: { grid, diesel, lpg: 1200 * (i + 1), solar: i % 2 ? 30000 : 0 },
      esg: { water: 800 + i * 300, waste: 20 + i * 8, recycled: 30 + i * 10, women: 6 + i * 3, training: 2 + i, minwage: true, posh: i % 2 === 0, coc: true, grievance: i > 1, ownerEsg: i > 2 },
      bills: { cd: 100 + i * 40, md: 110 + i * 45, pf: 0.88 + i * 0.02, units: grid / 12, pfPenalty: i < 3 ? 4000 + i * 1500 : 0, peakShare: 30 }, solar: { roof: 400 + i * 150 }, share: { bench: true }, ...(i === 0 ? { srmm: demoSrmm() } : {}) });
    const out = await tenantTx(t, (c) => compute(c, t, FY));
    if (i === 0) firstPct = out.results.srmm.pct * 100;
    members.push(t);
  }

  // network partners
  const partner: Record<string, string> = {};
  for (const [name, kind, city, email] of PARTNERS) {
    const t = await tenant(name, ['smenet']);
    await platformTx((c) => c.query(`INSERT INTO sme_partner (tenant_id, kind, city) VALUES ($1,$2,$3)`, [t, kind, city]));
    await user(t, email, `Demo ${kind === 'ca_firm' ? 'CA' : kind[0]!.toUpperCase() + kind.slice(1)} user`, 'super_admin');
    partner[kind] = t;
  }
  await platformTx(async (c) => {
    // the buyer: the demo SME has NOT switched sharing on yet (so the consent step can be tried); four other suppliers have
    await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, purchase_share_pct) VALUES ($1,$2,3.1)`, [partner.buyer, sme]);
    for (const [i, m] of members.slice(0, 4).entries()) await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, purchase_share_pct, share, consent_at) VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() END)`, [partner.buyer, m, [6.4, 5.2, 4.0, 2.3][i], i !== 1]);
    // the cluster: all members share
    for (const m of [sme, ...members]) await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, share, consent_at) VALUES ($1,$2,true, now())`, [partner.cluster, m]);
    // the bank: borrowers
    await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, loan_cr, ev_cr) VALUES ($1,$2,5,30)`, [partner.bank, sme]);
    for (const [i, m] of members.entries()) await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, loan_cr, ev_cr, share, consent_at) VALUES ($1,$2,$3,$4,true, now())`, [partner.bank, m, [6, 2.2, 3.5, 1.2, 0.8][i], [20, 9, 12, 5, 4][i]]);
    // a validation request waiting at the CA firm
    await c.query(`INSERT INTO sme_ca_request (sme_tenant, fy, srmm_version, self_pct, status, ca_tenant) VALUES ($1,$2,'mfg',$4,'assigned',$3)`, [members[0], FY, partner.ca_firm, firstPct]);
  });

  console.log(`\nEKOTRACE SME demo ready (every figure is invented). Temporary password for every demo login: ${pw}\n`);
  console.log('  SME (sign in at /sme):  owner@sme.demo (owner) · plant@sme.demo (manager) · accounts@sme.demo (data entry)');
  console.log('  Partners (sign in at /):  buyer@sme.demo · cluster@sme.demo · bank@sme.demo · ca@sme.demo');
  console.log(`  Financial year with data: ${FY} (and ${PREV} for the trend)\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
