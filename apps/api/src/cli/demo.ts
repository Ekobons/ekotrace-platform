/**
 * Demo company for trying the tool on a laptop: "BEEAH Group (demo)" with the
 * prototype's structure, one person per role and a few months of fuel data.
 *
 *   npm run demo
 *   npm run demo -- --reset     delete the demo company (and all its data) and create it again
 *
 * All demo people share one password, printed once. Demo only — never run this
 * on a server with real clients.
 */
import { platformTx, pool, type Tx } from '../db/pool.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { calculate } from '../modules/calc.service.js';
import { contextFor } from '../modules/activity.routes.js';
import { storeReadings, syncMeter, type MeterRow } from '../modules/meters.routes.js';
import { bookBill, createBill } from '../modules/bills.routes.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { demoPurchases } from './demoPurchases.js';

const NAME = 'BEEAH Group (demo)';
const TREE: [string, [string, string, string][]][] = [
  ['Real Estate', [['BEEAH Headquarters', 'Office', 'Sharjah'], ['Al Zahia Community', 'Residential', 'Sharjah']]],
  ['Waste Management', [['Sharjah Waste-to-Energy', 'Plant', 'Sharjah'], ["Al Saja'a Recycling Complex", 'Plant', 'Sharjah'], ["Al Saja'a Landfill", 'Landfill', 'Sharjah'], ['Fleet Depot Sharjah', 'Fleet depot', 'Sharjah']]],
  ['Technology', [['Data Centre Dubai', 'Data centre', 'Dubai']]],
];
const PEOPLE: [string, string, string, string | null, string[]][] = [
  // name, email, role, admin of sub-group, facilities (manager/preparer)
  ['Nikhil (Super admin)', 'superadmin@beeah.demo', 'super_admin', null, []],
  ['Layla (Admin)', 'admin@beeah.demo', 'admin', 'Waste Management', []],
  ['Hessa (Manager)', 'manager@beeah.demo', 'manager', null, ['Sharjah Waste-to-Energy', "Al Saja'a Recycling Complex", "Al Saja'a Landfill"]],
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

// Fleet: name, registration, vehicle type code, facility, in service from, retired on, usual method, charging, monthly quantity, unit
const FLEET: [string, string, string, string, string, string | null, 'distance' | 'fuel', 'site' | 'elsewhere' | null, number, string][] = [
  ['Refuse truck 01', 'SHJ 40101', 'veh:hgv:rigid-17-tonnes:average-laden', 'Fleet Depot Sharjah', '2023-03-01', null, 'distance', null, 4600, 'km'],
  ['Refuse truck 02', 'SHJ 40102', 'veh:hgv:rigid-17-tonnes:average-laden', 'Fleet Depot Sharjah', '2023-03-01', null, 'distance', null, 4300, 'km'],
  ['Refuse truck 03', 'SHJ 40103', 'veh:hgv:rigid-17-tonnes:average-laden', 'Fleet Depot Sharjah', '2024-06-01', null, 'fuel', null, 1650, 'L'],
  ['Refuse truck 04 (old)', 'SHJ 31877', 'veh:hgv:rigid-17-tonnes:average-laden', 'Fleet Depot Sharjah', '2019-01-01', '2025-12-31', 'distance', null, 3900, 'km'],
  ['Service van 1', 'SHJ 22301', 'veh:vans:average-up-to-3-5-tonnes:diesel', 'Fleet Depot Sharjah', '2024-01-01', null, 'distance', null, 2500, 'km'],
  ['Service van 2', 'SHJ 22302', 'veh:vans:average-up-to-3-5-tonnes:diesel', 'Fleet Depot Sharjah', '2024-01-01', null, 'distance', null, 2200, 'km'],
  ['Supervisor EV', 'SHJ 77001', 'veh:cars_by_size:medium-car:battery-electric-vehicle', 'Fleet Depot Sharjah', '2025-04-01', null, 'distance', 'site', 1500, 'km'],
  ['Forklift 1', '', 'mach:lpg', 'Sharjah Waste-to-Energy', '2022-01-01', null, 'fuel', null, 320, 'kg'],
  ['Forklift 2', '', 'mach:lpg', 'Sharjah Waste-to-Energy', '2022-01-01', null, 'fuel', null, 280, 'kg'],
  ['Wheel loader', '', 'mach:diesel', 'Sharjah Waste-to-Energy', '2021-05-01', null, 'fuel', null, 1900, 'L'],
  ['CEO car', 'SHJ 1', 'veh:cars_by_segment:executive:petrol', 'BEEAH Headquarters', '2024-02-01', null, 'distance', null, 1800, 'km'],
  ['Pool car (EV)', 'SHJ 1205', 'veh:cars_by_size:average-car:battery-electric-vehicle', 'BEEAH Headquarters', '2025-01-01', null, 'distance', 'elsewhere', 1400, 'km'],
  ['Pool car (plug-in)', 'SHJ 1206', 'veh:cars_by_size:medium-car:plug-in-hybrid-electric-vehicle', 'BEEAH Headquarters', '2025-01-01', null, 'distance', 'elsewhere', 1600, 'km'],
];

async function main() {
  const pw = temporaryPassword();
  const hash = await hashPassword(pw);
  let tenantId = '';
  await platformTx(async (c: Tx) => {
    const old = (await c.query('SELECT id FROM tenant WHERE name = $1', [NAME])).rows[0]?.id as string | undefined;
    if (old && !process.argv.includes('--reset')) throw new Error(`"${NAME}" already exists. Run "npm run demo -- --reset" to delete it and create it again.`);
    if (old) {
      // Demo company only (matched by its exact name): remove everything it holds.
      for (const sql of [
        'DELETE FROM certificate_claim WHERE tenant_id = $1', 'DELETE FROM energy_certificate WHERE tenant_id = $1', 'DELETE FROM supplier_factor WHERE tenant_id = $1',
        'DELETE FROM job WHERE tenant_id = $1', 'UPDATE purchase_line SET activity_id = NULL WHERE tenant_id = $1', 'DELETE FROM activity_result WHERE tenant_id = $1', 'DELETE FROM activity WHERE tenant_id = $1',
        'DELETE FROM purchase_batch WHERE tenant_id = $1', 'DELETE FROM purchase_rule WHERE tenant_id = $1', 'DELETE FROM purchase_profile WHERE tenant_id = $1', 'DELETE FROM supplier_ef WHERE tenant_id = $1', 'DELETE FROM supplier WHERE tenant_id = $1', 'DELETE FROM fx_rate WHERE tenant_id = $1', 'DELETE FROM vehicle WHERE tenant_id = $1',
        'DELETE FROM bill WHERE tenant_id = $1', 'DELETE FROM document WHERE tenant_id = $1', 'DELETE FROM meter_reading WHERE tenant_id = $1', 'DELETE FROM meter WHERE tenant_id = $1', 'DELETE FROM api_key WHERE tenant_id = $1',
        'DELETE FROM waste_deposit WHERE tenant_id = $1', 'DELETE FROM waste_site WHERE tenant_id = $1',
        'DELETE FROM price WHERE tenant_id = $1', 'DELETE FROM user_facility WHERE tenant_id = $1',
        'DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE tenant_id = $1)', 'DELETE FROM audit_log WHERE tenant_id = $1',
        'UPDATE org_node SET manager_user_id = NULL WHERE tenant_id = $1', 'DELETE FROM app_user WHERE tenant_id = $1', 'DELETE FROM tenant_catalogue WHERE tenant_id = $1',
        'DELETE FROM org_node WHERE tenant_id = $1 AND kind = \'facility\'', 'DELETE FROM org_node WHERE tenant_id = $1 AND kind = \'subgroup\'', 'DELETE FROM org_node WHERE tenant_id = $1',
        'DELETE FROM tenant WHERE id = $1',
      ]) await c.query(sql, [old]);
      console.log(`Old "${NAME}" deleted.`);
    }
    const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, consolidation, base_year) VALUES ($1,'AE','AR5','operational',2025) RETURNING id`, [NAME])).rows[0].id;
    tenantId = t;
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
          if (y === 2026 && code === 'desnz:natural-gas' && fac === 'Sharjah Waste-to-Energy') continue; // from the gas meter
          const item = (await c.query('SELECT id FROM item WHERE code = $1', [code])).rows[0]?.id;
          if (!item) continue;
          const q = Math.round(qty * (0.85 + 0.3 * Math.abs(Math.sin(m * 1.7 + y))));
          const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
          const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
          const { result, item: it, gwpSet } = await calculate({ itemId: item, unit, quantity: q, periodStart: start, periodEnd: end }, { gwpSet: 'AR5', region: 'AE' });
          const a = (await c.query(
            `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, data_type, gwp_set,
                                   co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, steps, warnings, status, created_by, factors)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'actual',$9,$10,$11,$12,$13,$14,$15,'approved',$16,$17) RETURNING id`,
            [t, ids.get(fac), it.category_id, item, start, end, q, unit, gwpSet, result.totals.direct, result.totals.wtt, result.totals.outside_scopes,
             result.totals.memo, JSON.stringify(result.steps), JSON.stringify(result.warnings), users.get('preparer'), JSON.stringify(result.factors)])).rows[0].id;
          await c.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
                         SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
            [a, t, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas), result.lines.map((l) => l.kgCo2e),
             result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)]);
          n++;
        }
      }
    }
    // Fleet and monthly vehicle data (only months each vehicle was in service).
    const veh: { id: string; item: number; fac: string; from: string; to: string | null; method: 'distance' | 'fuel'; charging: 'site' | 'elsewhere' | null; qty: number; unit: string }[] = [];
    for (const [name, reg, code, fac, from, retired, method, charging, qty, unit] of FLEET) {
      const item = (await c.query('SELECT id FROM item WHERE code = $1', [code])).rows[0]?.id;
      if (!item) { console.log(`  (skipped ${name}: vehicle type ${code} not loaded)`); continue; }
      const id = (await c.query(
        `INSERT INTO vehicle (tenant_id, facility_id, name, registration, item_id, ownership, charging, default_method, in_service_from, retired_on, retired_reason)
         VALUES ($1,$2,$3,$4,$5,'owned',$6,$7,$8,$9,$10) RETURNING id`,
        [t, ids.get(fac), name, reg || null, item, charging, method, from, retired, retired ? 'Replaced by a new truck' : null])).rows[0].id;
      veh.push({ id, item, fac, from, to: retired, method, charging, qty, unit });
    }
    let nv = 0;
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 0; m < (y === 2026 ? 9 : 12); m++) {
        const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
        for (const v of veh) {
          if (v.from > end || (v.to && v.to < start)) continue;
          const q = Math.round(v.qty * (0.85 + 0.3 * Math.abs(Math.sin(m * 1.3 + y + v.qty))));
          const { result, item: it, gwpSet, stored } = await calculate(
            { itemId: v.item, unit: v.unit, quantity: q, periodStart: start, periodEnd: end, vehicle: { method: v.method, charging: v.charging ?? undefined } },
            { gwpSet: 'AR5', region: 'AE' });
          const a = (await c.query(
            `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                                   co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, co2e_scope2, steps, warnings, status, created_by, factors, vehicle_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'actual',$10,$11,$12,$13,$14,$15,$16,$17,'approved',$18,$19,$20) RETURNING id`,
            [t, ids.get(v.fac), it.category_id, v.item, start, end, stored.quantity, stored.unit, JSON.stringify(stored.inputs), gwpSet,
             result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo, result.totals.scope2,
             JSON.stringify(result.steps), JSON.stringify(result.warnings), users.get('preparer'), JSON.stringify(result.factors), v.id])).rows[0].id;
          if (result.lines.length) {
            await c.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
                           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
              [a, t, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas), result.lines.map((l) => l.kgCo2e),
               result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)]);
          }
          nv++;
        }
      }
    }
    console.log(`Fleet: ${veh.length} vehicles (one retired), ${nv} monthly vehicle entries.`);

    // Scope 2. Grid regions: Sharjah sites on SEWA, the data centre on DEWA. Demo supplier factors and
    // a demo certificate are clearly marked: they are NOT real values. No grid factors are added (they are
    // shared by every company): location-based shows a warning until the platform admin adds them.
    await c.query(`UPDATE org_node SET grid_region = 'AE-SH' WHERE tenant_id = $1 AND kind = 'facility' AND name <> 'Data Centre Dubai'`, [t]);
    await c.query(`UPDATE org_node SET grid_region = 'AE-DU' WHERE tenant_id = $1 AND name = 'Data Centre Dubai'`, [t]);
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]);
    const DEMO = 'DEMO value — not a real factor; replace with the supplier\'s published figure';
    await c.query(`INSERT INTO supplier_factor (tenant_id, supplier, energy, co2e, unit, valid_from, valid_to, source) VALUES
      ($1, 'Demo utility (replace)', 'electricity', 0.45, 'kWh_e', '2025-01-01', '2026-12-31', $2),
      ($1, 'Demo district cooling (replace)', 'cooling', 0.6, 'TRh', '2025-01-01', '2026-12-31', $2)`, [t, DEMO]);
    const cert = (await c.query(`INSERT INTO energy_certificate (tenant_id, instrument, standard, technology, mwh, market, vintage_from, vintage_to, reference, supplier, note)
      VALUES ($1,'certificate','I-REC','solar',500,'AE','2025-01-01','2026-12-31','DEMO-IREC-0001','Demo solar park','DEMO certificate — not real') RETURNING id`, [t])).rows[0].id;
    const items = Object.fromEntries((await c.query(`SELECT code, id FROM item WHERE code IN ('grid:electricity','cooling:district')`)).rows.map((r) => [r.code, r.id]));
    const SCOPE2: [string, string, string, number, Record<string, unknown>][] = [
      ['Data Centre Dubai', 'grid:electricity', 'kWh_e', 380000, { supplier: { name: 'Demo utility (replace)', co2e: 0.45, unit: 'kWh_e', source: DEMO }, certificates: [{ certificateId: cert, kwh: 20000 }] }],
      ['BEEAH Headquarters', 'grid:electricity', 'kWh_e', 95000, {}],
      ['Sharjah Waste-to-Energy', 'grid:electricity', 'kWh_e', 140000, {}],
      ['BEEAH Headquarters', 'cooling:district', 'TRh', 180000, { supplier: { name: 'Demo district cooling (replace)', co2e: 0.6, unit: 'TRh', source: DEMO }, cooling: { method: 'supplier' } }],
    ];
    let ne = 0;
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 0; m < (y === 2026 ? 9 : 12); m++) {
        const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
        for (const [fac, code, unit, base, energy] of SCOPE2) {
          if (code === 'grid:electricity' && ((y === 2026 && fac === 'Data Centre Dubai') || (fac === 'BEEAH Headquarters' && (y === 2026 || m === 11)))) continue; // from the BMS meter / SEWA bills
          const q = Math.round(base * (0.8 + 0.4 * Math.abs(Math.sin(m * 0.9 + y + base))));
          const f = (await c.query('SELECT id, country, grid_region FROM org_node WHERE id = $1', [ids.get(fac)])).rows[0];
          const { result, item: it, gwpSet, stored } = await calculate({ itemId: items[code], unit, quantity: q, periodStart: start, periodEnd: end, energy } as never, contextFor(c, 'AR5', 'AE', f));
          const a = (await c.query(
            `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                                   co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, co2e_scope2, co2e_scope2_market, co2e_td, steps, warnings, status, created_by, factors)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'actual',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'approved',$20,$21) RETURNING id`,
            [t, f.id, it.category_id, items[code], start, end, stored.quantity, stored.unit, JSON.stringify(stored.inputs), gwpSet,
             result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo, result.totals.scope2, result.totals.scope2_market, result.totals.td_loss,
             JSON.stringify(result.steps), JSON.stringify(result.warnings), users.get('preparer'), JSON.stringify(result.factors)])).rows[0].id;
          for (const k of (stored.inputs.claims as { certificateId: string; kwh: number }[] | undefined) ?? []) {
            await c.query('INSERT INTO certificate_claim (tenant_id, certificate_id, activity_id, kwh) VALUES ($1,$2,$3,$4)', [t, k.certificateId, a, k.kwh]);
          }
          if (result.lines.length) {
            await c.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
                           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
              [a, t, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas), result.lines.map((l) => l.kgCo2e),
               result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)]);
          }
          ne++;
        }
      }
    }
    console.log(`Scope 2: ${ne} monthly electricity / cooling entries (demo supplier factors and a demo I-REC; location-based waits for the UAE grid factors).`);

    // Waste. Scope 1: a landfill with a DEMO tonnage history (estimated, not real), waste-to-energy,
    // composting, a wastewater plant. Scope 3.5: office waste sent to others.
    const DEMO_W = 'DEMO — not real data';
    const site = (await c.query(`INSERT INTO waste_site (tenant_id, facility_id, name, opened_year, params, note) VALUES ($1,$2,$3,2000,$4,$5) RETURNING id`,
      [t, ids.get("Al Saja'a Landfill"), "Al Saja'a landfill (demo history)", JSON.stringify({ climate: 'tropical_dry', siteType: 'managed_anaerobic', ox: 0.1, source: DEMO_W }), DEMO_W])).rows[0].id;
    for (let y = 2000; y <= 2025; y++) {
      await c.query(`INSERT INTO waste_deposit (tenant_id, site_id, year, waste_type, tonnes, source, estimated) VALUES ($1,$2,$3,'msw',$4,$5,true)`,
        [t, site, y, y <= 2020 ? 800000 : 800000 - (y - 2020) * 90000, DEMO_W]);
    }
    const wItems = Object.fromEntries((await c.query(`SELECT code, id FROM item WHERE code LIKE 'waste:%' OR code IN ('waste3:refuse:commercial-and-industrial-waste:landfill','waste3:paper:paper-and-board-mixed:closed_loop')`)).rows.map((r) => [r.code, r.id]));
    const put = async (fac: string, input: Record<string, unknown>) => {
      const f = (await c.query('SELECT id, country, grid_region FROM org_node WHERE id = $1', [ids.get(fac)])).rows[0];
      const { result, item: it, gwpSet, stored } = await calculate(input as never, contextFor(c, 'AR5', 'AE', f));
      const a = (await c.query(
        `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                               co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, co2e_scope3, steps, warnings, status, created_by, factors, waste_site_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'actual',$10,$11,$12,$13,$14,$15,$16,$17,'approved',$18,$19,$20) RETURNING id`,
        [t, f.id, it.category_id, it.id, input.periodStart, input.periodEnd, stored.quantity, stored.unit, JSON.stringify(stored.inputs), gwpSet,
         result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo, result.totals.scope3,
         JSON.stringify(result.steps), JSON.stringify(result.warnings), users.get('preparer'), JSON.stringify(result.factors), (stored.inputs.siteId as string) ?? null])).rows[0].id;
      if (result.lines.length) {
        await c.query(`INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
                       SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
          [a, t, result.lines.map((l) => l.basis), result.lines.map((l) => l.gas), result.lines.map((l) => l.kgGas), result.lines.map((l) => l.kgCo2e),
           result.lines.map((l) => l.factorId), result.lines.map((l) => l.method)]);
      }
    };
    let nw = 0;
    // Landfill: yearly (2025) and Jan–Sep 2026, gas to engines and a flare.
    for (const [ps, pe, m3] of [['2025-01-01', '2025-12-31', 20e6], ['2026-01-01', '2026-09-30', 15e6]] as const) {
      await put("Al Saja'a Landfill", { itemId: wItems['waste:landfill'], unit: 't', periodStart: ps, periodEnd: pe,
        waste: { process: 'landfill', siteId: site, method: 'fod', recovery: [{ device: 'engine', gasM3: m3 * 0.8, ch4Pct: 50 }, { device: 'flare_enclosed', gasM3: m3 * 0.2, ch4Pct: 50 }] } });
      nw++;
    }
    for (let y = 2025; y <= 2026; y++) {
      for (let m = 0; m < (y === 2026 ? 9 : 12); m++) {
        const ps = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        const pe = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
        const k = 0.85 + 0.3 * Math.abs(Math.sin(m + y));
        await put('Sharjah Waste-to-Energy', { itemId: wItems['waste:incineration'], unit: 't', periodStart: ps, periodEnd: pe,
          waste: { process: 'incineration', streams: [{ type: 'msw', tonnes: Math.round(25000 * k) }], technology: 'continuous_stoker', exportedMWh: Math.round(14000 * k) } });
        if (y === 2026) { /* composting 2026 from the weighbridge (weekly) */ } else await put("Al Saja'a Recycling Complex", { itemId: wItems['waste:composting'], unit: 't', periodStart: ps, periodEnd: pe,
          waste: { process: 'composting', tonnes: Math.round(3000 * k), basis: 'wet' } });
        await put('Al Zahia Community', { itemId: wItems['waste:wastewater'], unit: 'kg', periodStart: ps, periodEnd: pe,
          waste: { process: 'wastewater', kind: 'domestic', system: 'centralised_aerobic', measure: 'BOD', flowM3: Math.round(60000 * k), mgPerL: 250, nInfluentKg: Math.round(2400 * k), nEffluentKg: Math.round(600 * k), recovery: [] } });
        await put('BEEAH Headquarters', { itemId: wItems['waste3:refuse:commercial-and-industrial-waste:landfill'], unit: 't', quantity: Math.round(8 * k * 10) / 10, periodStart: ps, periodEnd: pe });
        if (wItems['waste3:paper:paper-and-board-mixed:closed_loop']) await put('BEEAH Headquarters', { itemId: wItems['waste3:paper:paper-and-board-mixed:closed_loop'], unit: 't', quantity: Math.round(1.5 * k * 10) / 10, periodStart: ps, periodEnd: pe });
        nw += 5;
      }
    }
    // ------------------------------------------------------------ meters & bills --
    // DEMO readings (not real): BMS hourly electricity at the data centre, a daily register gas
    // meter at the WtE plant, a weekly weighbridge at the composting plant, SEWA bills at HQ.
    const TZ = 'Asia/Dubai';
    const actor = { id: users.get('preparer') ?? null, name: 'demo', req: { user: { id: null, name: 'demo', tenantId: t }, ip: '127.0.0.1' } } as const;
    const tset = { id: t, gwp_set: 'AR5', timezone: TZ };
    const item = async (code: string) => (await c.query('SELECT id FROM item WHERE code = $1', [code])).rows[0].id as number;
    const addMeter = async (fac: string, v: Record<string, unknown>) => (await c.query(
      `INSERT INTO meter (tenant_id, facility_id, name, external_id, reading_type, frequency, unit, multiplier, item_id, template, account_no, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DEMO readings — not real') RETURNING *`,
      [t, ids.get(fac), v.name, v.ext, v.type, v.freq, v.unit, v.mult ?? 1, v.item, JSON.stringify(v.template ?? {}), v.account ?? null])).rows[0] as MeterRow;
    const local = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m, d, h) - 4 * 3600_000).toISOString();
    const end = Date.UTC(2026, 9, 1) - 4 * 3600_000;
    let nr = 0;
    // 1. Data centre: hourly kWh from the BMS (Jan–Sep 2026), DEMO supplier factor.
    const dc = await addMeter('Data Centre Dubai', { name: 'Main incomer (BMS)', ext: 'BMS-DC-MAIN', type: 'interval', freq: 'hour', unit: 'kWh_e', item: await item('grid:electricity'),
      template: { energy: { supplier: { name: 'Demo utility (replace)', co2e: 0.45, unit: 'kWh_e', source: DEMO } } } });
    const hours: { timestamp: string; value: number }[] = [];
    for (let ts = Date.UTC(2026, 0, 1) - 4 * 3600_000 + 3600_000; ts <= end; ts += 3600_000) {
      const h = new Date(ts + 4 * 3600_000).getUTCHours();
      const gap = ts > Date.UTC(2026, 5, 10) && ts < Date.UTC(2026, 5, 12); // two days missing in June (BMS outage)
      if (!gap) hours.push({ timestamp: new Date(ts).toISOString(), value: Math.round((480 + 90 * Math.sin((h - 9) / 24 * 2 * Math.PI) + 20 * Math.sin(ts / 9e8)) * 10) / 10 });
    }
    nr += (await storeReadings(c, t, dc, hours, 'api', TZ)).inserted;
    // 2. WtE boiler gas: daily register (m³), counts up.
    const gm = await addMeter('Sharjah Waste-to-Energy', { name: 'Boiler gas meter', ext: 'WTE-GAS-01', type: 'cumulative', freq: 'day', unit: 'm3', item: await item('desnz:natural-gas') });
    let reg = 1_250_000;
    const days: { timestamp: string; value: number }[] = [];
    for (let d = 0; Date.UTC(2026, 0, 1 + d) - 4 * 3600_000 <= end; d++) { days.push({ timestamp: local(2026, 0, 1 + d), value: reg }); reg += Math.round(1350 + 250 * Math.sin(d / 5)); }
    nr += (await storeReadings(c, t, gm, days, 'api', TZ)).inserted;
    // 3. Composting: weekly weighbridge totals (tonnes per week, ending Sunday midnight).
    const cm = await addMeter("Al Saja'a Recycling Complex", { name: 'Compost weighbridge', ext: 'WB-COMPOST', type: 'interval', freq: 'week', unit: 't', item: wItems['waste:composting'],
      template: { waste: { process: 'composting', basis: 'wet', tonnes: 0 } } });
    const weeks: { timestamp: string; value: number }[] = [];
    for (let w = 0; Date.UTC(2026, 0, 4 + 7 * w) - 4 * 3600_000 <= end; w++) weeks.push({ timestamp: local(2026, 0, 4 + 7 * w), value: Math.round(700 + 80 * Math.sin(w / 3)), ...(w === 0 ? { start: local(2026, 0, 1) } : {}) });
    nr += (await storeReadings(c, t, cm, weeks, 'upload', TZ)).inserted;
    let ns = 0;
    for (const m of [dc, gm, cm]) ns += (await syncMeter(c, tset, m, actor)).created;
    // 4. HQ electricity: SEWA bills 15th to 14th (PDFs made here, in a SEWA-like layout); Jan–Jul booked, August to check.
    await addMeter('BEEAH Headquarters', { name: 'SEWA account 2001458876', ext: 'SEWA-2001458876', type: 'interval', freq: 'month', unit: 'kWh_e', item: await item('grid:electricity'), account: '2001458876' });
    // utility accounts with no readings yet: the DEMO bills from `makeTestFiles` (test-files/bills) are for these
    for (const [fac, acc] of [["Al Saja'a Recycling Complex", '2003317745'], ["Al Saja'a Landfill", '2003318102'], ['Fleet Depot Sharjah', '2003320088'], ['Al Zahia Community', '2003324417']] as const)
      await addMeter(fac, { name: `SEWA account ${acc}`, ext: `SEWA-${acc}`, type: 'interval', freq: 'month', unit: 'kWh_e', item: await item('grid:electricity'), account: acc });
    await addMeter('Data Centre Dubai', { name: 'DEWA account 2045118763 (annex supply)', ext: 'DEWA-2045118763', type: 'interval', freq: 'month', unit: 'kWh_e', item: await item('grid:electricity'), account: '2045118763' });
    await addMeter('Data Centre Dubai', { name: 'Empower premise EMP-DC-77310', ext: 'EMP-DC-77310', type: 'interval', freq: 'month', unit: 'TRh', item: await item('cooling:district'), account: 'EMP-DC-77310',
      template: { energy: { supplier: { name: 'Demo district cooling (replace)', co2e: 0.6, unit: 'TRh', source: DEMO }, cooling: { method: 'supplier' } } } });
    const pdf = async (lines: (string | [string, string])[]) => {
      const doc = await PDFDocument.create(); const page = doc.addPage([595, 842]); const font = await doc.embedFont(StandardFonts.Helvetica);
      let yy = 800;
      for (const l of lines) { if (Array.isArray(l)) { page.drawText(l[0], { x: 40, y: yy, size: 10, font }); page.drawText(l[1], { x: 300, y: yy, size: 10, font }); } else page.drawText(l, { x: 40, y: yy, size: 10, font }); yy -= 18; }
      page.drawText('DEMO bill generated by Ekotrace - not a real SEWA document', { x: 40, y: 40, size: 8, font });
      return Buffer.from(await doc.save());
    };
    const dd = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    let nb = 0;
    for (let k = 0; k < 8; k++) {
      const from = new Date(Date.UTC(2025, 11 + k, 15)), to = new Date(Date.UTC(2026, k, 14)), issued = new Date(Date.UTC(2026, k, 20));
      const kwh = Math.round(95000 * (0.8 + 0.4 * Math.abs(Math.sin(k * 0.9 + 3))));
      const buf = await pdf(['Sharjah Electricity, Water and Gas Authority', 'TAX INVOICE', ['Account No:', '2001458876'], ['Bill No:', `INV-26-${String(41000 + k)}`], ['Bill Date:', dd(issued)],
        ['Billing Period:', `${dd(from)} - ${dd(to)}`], 'Electricity', ['Consumption', `${kwh.toLocaleString('en')} kWh`], ['Rate', '0.38 AED/kWh'], 'Water', ['Consumption', '1,250 IG'],
        ['Total Amount Due', `AED ${(kwh * 0.38 + 2400).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]]);
      const b = await createBill(c, t, buf, `SEWA-2001458876-${to.toISOString().slice(0, 7)}.pdf`, String(users.get('preparer')));
      if (k < 7) await bookBill(c, tset, b.id, actor);
      nb++;
    }
    console.log(`Meters: ${nr.toLocaleString('en')} DEMO readings (hourly, daily register, weekly), ${ns} monthly entries; ${nb} DEMO SEWA bills (7 booked, 1 to check).`);
    console.log(`Waste: a landfill with a DEMO tonnage history 2000–2025, ${nw} waste entries (landfill, waste-to-energy, composting, wastewater, office waste sent out).`);
    console.log(`\nDemo company "${NAME}" created: ${TREE.length} sub-groups, ${[...ids.keys()].length - TREE.length} facilities, ${n} fuel entries (Jan 2025 – Sep 2026).`);
  });
  // purchases run after the company exists (the pipeline commits in chunks, like a real upload)
  const sa = (await platformTx((c: Tx) => c.query(`SELECT id, name, email, role, tenant_id, scope_node_id FROM app_user WHERE tenant_id = $1 AND role = 'super_admin' LIMIT 1`, [tenantId]))).rows[0];
  await demoPurchases(tenantId, { id: sa.id, name: sa.name, email: sa.email, role: 'super_admin', tenantId, scopeNodeId: null, mustChangePassword: false });
  console.log('\nDemo logins (all with the same password, shown once):');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(24)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
}

main().catch((e) => { console.error('Demo not created:', e.message); process.exitCode = 1; }).finally(() => pool.end());
