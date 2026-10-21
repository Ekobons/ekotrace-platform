/**
 * EKOFIN demo company for trying financed emissions on a laptop: "Gulf Demo Bank (demo)" with EKOFIN and
 * EKOTRACE switched on, a super admin and an analyst, a DEMO sector factor library, a corporate loan book and
 * an equity fund with two reporting dates, and counterparties with a mix of reported data and estimates.
 *
 *   npm run demo:fin
 *   npm run demo:fin -- --reset     delete the demo bank (and all its data) and create it again
 *
 * Every figure here is INVENTED for the demo (companies, amounts, emissions and the factor library). The
 * library is named "DEMO factors (illustrative, not for reporting)" so it is never mistaken for real data.
 * Demo only — never run this on a server with real clients.
 */
import { platformTx, pool, tenantTx } from '../db/pool.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { normCompany } from '../lib/ekofin.js';
import { purgeTenant } from '../db/purge.js';

const NAME = 'Gulf Demo Bank (demo)';
export const DEMO_LIBRARY = 'DEMO factors (illustrative, not for reporting)';
const PEOPLE: [string, string, string][] = [['Demo Super Admin', 'admin@bank.demo', 'super_admin'], ['Demo Analyst', 'analyst@bank.demo', 'manager'], ['Demo Auditor', 'auditor@bank.demo', 'verifier']];
// sector code, name, revenue factor S1/S2/S3 and asset factor S1/S2 (tCO2e per USD million) — INVENTED
const FACTORS: [string, string, number, number, number, number, number][] = [
  ['A', 'Agriculture, forestry and fishing', 420, 40, 600, 160, 15], ['B', 'Mining and quarrying', 520, 60, 2400, 180, 20], ['C', 'Manufacturing', 160, 45, 700, 110, 30],
  ['C20', 'Manufacture of chemicals', 380, 90, 900, 230, 55], ['C23', 'Manufacture of cement, glass and ceramics', 1900, 110, 600, 900, 50], ['C24', 'Manufacture of basic metals', 1100, 160, 900, 650, 90],
  ['D', 'Electricity, gas, steam supply', 2600, 30, 500, 420, 5], ['F', 'Construction', 70, 20, 450, 55, 15], ['G', 'Wholesale and retail trade', 18, 22, 300, 20, 25],
  ['H', 'Transportation and storage', 640, 25, 260, 250, 10], ['I', 'Accommodation and food', 45, 70, 280, 25, 40], ['J', 'Information and communication', 6, 25, 120, 4, 15], ['L', 'Real estate', 12, 35, 90, 3, 9],
];
// name, country, listed, ISIN, sector, asset class, outstanding (USD m), financials (EVIC | equity, debt, revenue, total assets; USD m), reported [score, s1, s2] or null
type Co = [string, string, boolean, string | null, string, string, number, { evic?: number; equity?: number; debt?: number; revenue?: number; assets?: number } | null, [1 | 2, number, number] | null];
const BOOK: Co[] = [
  ['Desert Steel Industries', 'AE', false, null, 'C24.10', 'business_loan', 85, { equity: 420, debt: 380, revenue: 1250, assets: 980 }, [2, 1150000, 210000]],
  ['Gulf Cement Company', 'AE', true, 'AEG000000013', 'C23.51', 'business_loan', 60, { evic: 1400, revenue: 520 }, [1, 1820000, 60000]],
  ['Emirates Aluminium Rolling', 'AE', false, null, 'C24.42', 'business_loan', 45, { equity: 260, debt: 310, revenue: 690 }, null],
  ['Al Noor Power', 'AE', false, null, 'D35.11', 'business_loan', 120, { equity: 900, debt: 1600, revenue: 480 }, [2, 2100000, 12000]],
  ['Coastal Petrochemicals', 'SA', true, 'SAG000000028', 'C20.14', 'business_loan', 70, { evic: 5200, revenue: 2100 }, null],
  ['Falcon Logistics', 'AE', false, null, 'H49.41', 'business_loan', 25, { equity: 40, debt: 95, revenue: 210 }, null],
  ['Oasis Hotels', 'AE', false, null, 'I55.10', 'business_loan', 35, { equity: 180, debt: 260, revenue: 140 }, null],
  ['Palm Real Estate Development', 'AE', false, null, 'L68.10', 'business_loan', 150, { equity: 1300, debt: 900, revenue: 380 }, null],
  ['Sahara Trading', 'AE', false, null, 'G46.90', 'business_loan', 18, null, null],
  ['Red Sea Construction', 'SA', false, null, 'F41.20', 'business_loan', 40, { equity: 120, debt: 160, revenue: 610 }, null],
  ['Date Palm Farms', 'AE', false, null, 'A01.22', 'business_loan', 9, null, null],
  ['Kingdom Mining', 'SA', false, null, 'B07.29', 'business_loan', 55, { equity: 700, debt: 450, revenue: 820 }, [2, 640000, 95000]],
];
const FUND: Co[] = [
  ['Gulf Cement Company', 'AE', true, 'AEG000000013', 'C23.51', 'listed_equity', 22, { evic: 1400, revenue: 520 }, [1, 1820000, 60000]],
  ['Coastal Petrochemicals', 'SA', true, 'SAG000000028', 'C20.14', 'listed_equity', 30, { evic: 5200, revenue: 2100 }, null],
  ['Arabian Telecom', 'SA', true, 'SAG000000036', 'J61.10', 'listed_equity', 40, { evic: 18000, revenue: 6200 }, [2, 42000, 610000]],
  ['Emirates Retail Group', 'AE', true, 'AEG000000047', 'G47.11', 'listed_equity', 15, { evic: 3100, revenue: 4400 }, null],
  ['Gulf Logistics Bond 2029', 'AE', true, 'XS0000000051', 'H52.10', 'corporate_bond', 25, { evic: 2600, revenue: 900 }, null],
];

async function main() {
  const reset = process.argv.includes('--reset');
  const existing = await platformTx(async (c) => (await c.query(`SELECT id FROM tenant WHERE name = $1`, [NAME])).rows[0]?.id as string | undefined);
  if (existing && !reset) { console.log(`${NAME} already exists. Run "npm run demo:fin -- --reset" to create it again.`); return; }
  if (existing) await platformTx(async (c) => { await purgeTenant(c, existing); await c.query(`DELETE FROM tenant WHERE id = $1`, [existing]); });
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  const t = await platformTx(async (c) => {
    const id = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, products, currency, timezone) VALUES ($1,'AE','AR5','enterprise',ARRAY['ekofin','ekotrace'],'AED','Asia/Dubai') RETURNING id`, [NAME])).rows[0].id as string;
    await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'AE')`, [id, NAME]);
    for (const [name, email, role] of PEOPLE)
      await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,false) ON CONFLICT DO NOTHING`, [id, email, name, role, hash]);
    // the DEMO factor library (shared table; replaced each time)
    await c.query(`DELETE FROM fin_factor WHERE library = $1`, [DEMO_LIBRARY]);
    for (const [code, name, r1, r2, r3, a1, a2] of FACTORS)
      for (const [basis, s1, s2, s3] of [['revenue', r1, r2, r3], ['assets', a1, a2, null]] as const)
        await c.query(`INSERT INTO fin_factor (library, sector_standard, sector_code, sector_name, region, year, basis, currency, s1, s2, s3, source, created_name) VALUES ($1,'NACE',$2,$3,'GLOBAL',2024,$4,'USD',$5,$6,$7,'DEMO — invented values','demo')`,
          [DEMO_LIBRARY, code, name, basis, s1, s2, s3]);
    return id;
  });
  await tenantTx(t, async (c) => {
    const cps = new Map<string, string>();
    const cp = async (x: Co) => {
      if (cps.has(x[0])) return cps.get(x[0])!;
      const [name, country, listed, isin, sector] = x;
      const id = (await c.query(`INSERT INTO fin_counterparty (tenant_id, name, norm, country, isin, listed, sector_standard, sector_code, note, created_name) VALUES ($1,$2,$3,$4,$5,$6,'NACE',$7,'DEMO company — invented','demo') RETURNING id`,
        [t, name, normCompany(name), country, isin, listed, sector])).rows[0].id as string;
      const f = x[7], e = x[8], m = 1e6;
      if (f) await c.query(`INSERT INTO fin_financials (tenant_id, counterparty_id, year, currency, evic, equity, debt, revenue, total_assets, source, updated_name) VALUES ($1,$2,2024,'USD',$3,$4,$5,$6,$7,'DEMO','demo')`,
        [t, id, f.evic ? f.evic * m : null, f.equity ? f.equity * m : null, f.debt ? f.debt * m : null, f.revenue ? f.revenue * m : null, f.assets ? f.assets * m : null]);
      if (e) await c.query(`INSERT INTO fin_emission (tenant_id, counterparty_id, year, score, s1, s2, source, created_name) VALUES ($1,$2,2024,$3,$4,$5,'DEMO — invented report','demo')`, [t, id, e[0], e[1], e[2]]);
      cps.set(name, id);
      return id;
    };
    const portfolio = async (name: string, kind: string, rows: Co[], shrink: number) => {
      const p = (await c.query(`INSERT INTO fin_portfolio (tenant_id, name, kind, currency, factor_library, description, created_name) VALUES ($1,$2,$3,'USD',$4,'DEMO portfolio','demo') RETURNING id`, [t, name, kind, DEMO_LIBRARY])).rows[0].id;
      for (const [asOf, k] of [['2024-12-31', shrink], ['2025-12-31', 1]] as const) {
        const pe = (await c.query(`INSERT INTO fin_period (tenant_id, portfolio_id, as_of, created_name) VALUES ($1,$2,$3,'demo') RETURNING id`, [t, p, asOf])).rows[0].id;
        for (const [i, x] of rows.entries())
          await c.query(`INSERT INTO fin_holding (tenant_id, period_id, counterparty_id, asset_class, outstanding, currency, internal_ref, created_name) VALUES ($1,$2,$3,$4,$5,'USD',$6,'demo')`,
            [t, pe, await cp(x), x[5], Math.round(x[6] * 1e6 * k), `${kind === 'fund' ? 'POS' : 'LN'}-${String(i + 1).padStart(4, '0')}`]);
      }
    };
    await portfolio('Corporate loan book', 'loan_book', BOOK, 0.9);
    await portfolio('Gulf Equity Fund', 'fund', FUND, 1.1);
  });
  console.log(`\n${NAME} created with EKOFIN and EKOTRACE: 2 portfolios, ${BOOK.length + FUND.length - 2} counterparties, the "${DEMO_LIBRARY}" library.`);
  console.log('All figures are invented for the demo.\n');
  for (const [, email, role] of PEOPLE) console.log(`  ${email.padEnd(22)} ${role}`);
  console.log(`  password (all three):  ${pw}\n`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
