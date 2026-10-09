/**
 * Demo company for trying the tool on a laptop: "BEEAH Group (demo)" with the
 * prototype's structure, one person per role and a few months of fuel data.
 *
 *   npm run demo
 *
 * All demo people share one password, printed once. Demo only — never run this
 * on a server with real clients.
 */
import { platformTx, pool, type Tx } from '../db/pool.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { calculate } from '../modules/calc.service.js';

const NAME = 'BEEAH Group (demo)';
const TREE: [string, [string, string, string][]][] = [
  ['Real Estate', [['BEEAH Headquarters', 'Office', 'Sharjah'], ['Al Zahia Community', 'Residential', 'Sharjah']]],
  ['Waste Management', [['Sharjah Waste-to-Energy', 'Plant', 'Sharjah'], ["Al Saja'a Recycling Complex", 'Plant', 'Sharjah'], ['Fleet Depot Sharjah', 'Fleet depot', 'Sharjah']]],
  ['Technology', [['Data Centre Dubai', 'Data centre', 'Dubai']]],
];
const PEOPLE: [string, string, string, string | null, string[]][] = [
  // name, email, role, admin of sub-group, facilities (manager/preparer)
  ['Nikhil (Super admin)', 'superadmin@beeah.demo', 'super_admin', null, []],
  ['Layla (Admin)', 'admin@beeah.demo', 'admin', 'Waste Management', []],
  ['Hessa (Manager)', 'manager@beeah.demo', 'manager', null, ['Sharjah Waste-to-Energy', "Al Saja'a Recycling Complex"]],
  ['Aisha (Data preparer)', 'preparer@beeah.demo', 'preparer', null, ['Sharjah Waste-to-Energy']],
  ['Verifier (read-only)', 'verifier@beeah.demo', 'verifier', null, []],
];
// item code, unit, monthly quantity, facility
const DATA: [string, string, number, string][] = [
  ['desnz:diesel-100-mineral-diesel', 'L', 18500, 'Sharjah Waste-to-Energy'],
  ['desnz:natural-gas', 'm3', 42000, 'Sharjah Waste-to-Energy'],
  ['desnz:diesel-100-mineral-diesel', 'L', 6200, "Al Saja'a Recycling Complex"],
  ['desnz:lpg', 'kg', 900, 'BEEAH Headquarters'],
  ['desnz:diesel-100-mineral-diesel', 'L', 2400, 'Data Centre Dubai'],
];

async function main() {
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  await platformTx(async (c: Tx) => {
    if ((await c.query('SELECT 1 FROM tenant WHERE name = $1', [NAME])).rowCount) throw new Error(`"${NAME}" already exists`);
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, consolidation, base_year) VALUES ($1,'AE','AR5','operational',2025) RETURNING id`, [NAME])).rows[0].id;
    const group = (await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'AE') RETURNING id`, [t, 'BEEAH Group'])).rows[0].id;
    const ids = new Map<string, string>();
    for (const [sub, facs] of TREE) {
      const s = (await c.query(`INSERT INTO org_node (tenant_id, kind, parent_id, name, country) VALUES ($1,'subgroup',$2,$3,'AE') RETURNING id`, [t, group, sub])).rows[0].id;
      ids.set(sub, s);
      for (const [f, type, loc] of facs) {
        const id = (await c.query(`INSERT INTO org_node (tenant_id, kind, parent_id, name, facility_type, location, country, employees, floor_area_m2)
                                   VALUES ($1,'facility',$2,$3,$4,$5,'AE',$6,$7) RETURNING id`,
          [t, s, f, type, loc, 40 + Math.round(Math.random() * 300), 2000 + Math.round(Math.random() * 20000)])).rows[0].id;
        ids.set(f, id);
      }
    }
    const users = new Map<string, string>();
    for (const [name, email, role, sub, facs] of PEOPLE) {
      const u = (await c.query(`INSERT INTO app_user (tenant_id, email, name, role, scope_node_id, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id`,
        [t, email, name, role, sub ? ids.get(sub) : null, hash])).rows[0].id;
      users.set(role, u);
      for (const f of facs) await c.query('INSERT INTO user_facility (user_id, node_id, tenant_id) VALUES ($1,$2,$3)', [u, ids.get(f), t]);
    }
    await c.query(`UPDATE org_node SET manager_user_id = $1 WHERE id = ANY($2)`, [users.get('manager'), [ids.get('Sharjah Waste-to-Energy'), ids.get("Al Saja'a Recycling Complex")]]);

    // Fuel data: Jan 2025 – Sep 2026, small monthly variation.
    let n = 0;
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 0; m < (y === 2026 ? 9 : 12); m++) {
        for (const [code, unit, qty, fac] of DATA) {
          const item = (await c.query('SELECT id FROM item WHERE code = $1', [code])).rows[0]?.id;
          if (!item) continue;
          const q = Math.round(qty * (0.85 + 0.3 * Math.abs(Math.sin(m * 1.7 + y))));
          const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
          const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
          const { result, item: it, gwpSet } = await calculate({ itemId: item, unit, quantity: q, periodStart: start, periodEnd: end }, { gwpSet: 'AR5', region: 'AE' });
          const a = (await c.query(
            `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, data_type, gwp_set,
                                   co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, steps, warnings, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'actual',$9,$10,$11,$12,$13,$14,$15,'approved',$16) RETURNING id`,
            [t, ids.get(fac), it.category_id, item, start, end, q, unit, gwpSet, result.totals.direct, result.totals.wtt, result.totals.outside_scopes,
             result.totals.memo, JSON.stringify(result.steps), JSON.stringify(result.warnings), users.get('preparer')])).rows[0].id;
          await c.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
                         SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
            [a, t, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas), result.lines.map((l) => l.kgCo2e),
             result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)]);
          n++;
        }
      }
    }
    console.log(`\nDemo company "${NAME}" created: ${TREE.length} sub-groups, ${[...ids.keys()].length - TREE.length} facilities, ${n} fuel entries (Jan 2025 – Sep 2026).`);
  });
  console.log('\nDemo logins (all with the same password, shown once):');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(24)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().catch((e) => { console.error('Demo not created:', e.message); process.exitCode = 1; }).finally(() => pool.end());
