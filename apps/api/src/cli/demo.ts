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
import { platformTx, pool, tenantTx, type Tx } from '../db/pool.js';
import { ensureMetrics, metricSnapshot } from '../lib/collection.js';
import { remindTenant } from '../lib/reminders.js';
import { measured } from '../lib/restate.js';
import { PRODUCT } from '../lib/brand.js';
import { applyMetric, metricBody } from '../modules/collection.routes.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { calculate } from '../modules/calc.service.js';
import { contextFor } from '../modules/activity.routes.js';
import { storeReadings, syncMeter, type MeterRow } from '../modules/meters.routes.js';
import { bookBill, createBill } from '../modules/bills.routes.js';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { demoPurchases } from './demoPurchases.js';
import { demoLca } from './demoLca.js';
import { demoCbam } from './demoCbam.js';
import { normSupplier } from '../modules/purchases/fields.js';
import { purgeTenant } from '../db/purge.js';
import { createHash, randomUUID } from 'node:crypto';
import { linkBins } from '../modules/contractor.routes.js';
import { sealFile } from '../lib/secrets.js';

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
  const ccode = temporaryPassword().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10).padEnd(10, 'X');   // contractor portal (demo)
  const hash = await hashPassword(pw);
  let tenantId = '';
  await platformTx(async (c: Tx) => {
    const old = (await c.query('SELECT id FROM tenant WHERE name = $1', [NAME])).rows[0]?.id as string | undefined;
    if (old && !process.argv.includes('--reset')) throw new Error(`"${NAME}" already exists. Run "npm run demo -- --reset" to delete it and create it again.`);
    if (old) {
      // Demo company only (matched by its exact name): remove everything it holds (its audit records stay until their retention ends).
      await purgeTenant(c, old);
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
    const wItems = Object.fromEntries((await c.query(`SELECT code, id FROM item WHERE code LIKE 'waste:%' OR code LIKE 'water:%' OR code IN ('waste3:refuse:commercial-and-industrial-waste:landfill','waste3:paper:paper-and-board-mixed:closed_loop',
  'waste3:electrical-items:weee-mixed:open_loop','waste3:refuse:organic-food-and-drink-waste:composting','waste3:electrical-items:batteries:open_loop')`)).rows.map((r) => [r.code, r.id]));
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
        // waste sent to others, with the details asked for in waste reporting (DEMO contractors, not real)
        await put('BEEAH Headquarters', { itemId: wItems['waste3:refuse:commercial-and-industrial-waste:landfill'], unit: 't', quantity: Math.round(8 * k * 10) / 10, periodStart: ps, periodEnd: pe,
          wasteInfo: { hazardous: false, contractor: 'DEMO Waste Collector LLC', ref: `DEMO-WC-${y}${m + 1}` } });
        if (wItems['waste3:paper:paper-and-board-mixed:closed_loop']) await put('BEEAH Headquarters', { itemId: wItems['waste3:paper:paper-and-board-mixed:closed_loop'], unit: 't', quantity: Math.round(1.5 * k * 10) / 10, periodStart: ps, periodEnd: pe,
          wasteInfo: { hazardous: false, contractor: 'DEMO Paper Recycler' } });
        if (wItems['waste3:refuse:organic-food-and-drink-waste:composting']) await put('Al Zahia Community', { itemId: wItems['waste3:refuse:organic-food-and-drink-waste:composting'], unit: 't', quantity: Math.round(4 * k * 10) / 10, periodStart: ps, periodEnd: pe,
          wasteInfo: { hazardous: false, contractor: 'DEMO Waste Collector LLC' } });
        if (m % 3 === 2 && wItems['waste3:electrical-items:weee-mixed:open_loop']) {
          await put('Data Centre Dubai', { itemId: wItems['waste3:electrical-items:weee-mixed:open_loop'], unit: 't', quantity: Math.round(1.2 * k * 10) / 10, periodStart: ps, periodEnd: pe,
            wasteInfo: { hazardous: true, contractor: 'DEMO E-waste Recycler', ref: `DEMO-HZ-${y}Q${Math.floor(m / 3) + 1}` } });
          await put('Fleet Depot Sharjah', { itemId: wItems['waste3:electrical-items:batteries:open_loop'], unit: 't', quantity: Math.round(0.4 * k * 100) / 100, periodStart: ps, periodEnd: pe,
            wasteInfo: { hazardous: true, contractor: 'DEMO E-waste Recycler' } });
          nw += 2;
        }
        // water (DEMO volumes, not real): in by source, reused, out by destination, m³
        const wv: [string, string, number][] = [
          ['BEEAH Headquarters', 'water:mains_desal', 1400], ['BEEAH Headquarters', 'water:sewer', 1150],
          ['Data Centre Dubai', 'water:mains_desal', 6200], ['Data Centre Dubai', 'water:sewer', 1600], ['Data Centre Dubai', 'water:reuse', 700],
          ['Al Zahia Community', 'water:mains_desal', 26000], ['Al Zahia Community', 'water:tse', 7000], ['Al Zahia Community', 'water:sewer', 20500], ['Al Zahia Community', 'water:irrigation', 7000],
          ['Fleet Depot Sharjah', 'water:tanker', 450], ['Fleet Depot Sharjah', 'water:tanker_out', 320],
          ["Al Saja'a Recycling Complex", 'water:groundwater', 2100], ["Al Saja'a Recycling Complex", 'water:mains_desal', 900], ["Al Saja'a Recycling Complex", 'water:irrigation', 600], ["Al Saja'a Recycling Complex", 'water:tanker_out', 1500],
          ['Sharjah Waste-to-Energy', 'water:mains_desal', 9000], ['Sharjah Waste-to-Energy', 'water:tanker_out', 2500], ['Sharjah Waste-to-Energy', 'water:reuse', 3000],
        ];
        const hot = 1 + 0.35 * Math.max(0, Math.sin(((m - 3) / 12) * 2 * Math.PI)); // more water in the hot months
        for (const [fac, code, v] of wv) if (wItems[code]) { await put(fac, { itemId: wItems[code], unit: 'm3', quantity: Math.round(v * k * hot), periodStart: ps, periodEnd: pe }); nw++; }
        nw += 6;
      }
    }
    // QR & field app (DEMO bins and scans, not real): Al Zahia Community, this month so far — open, ready to roll up.
    {
      const binItems = Object.fromEntries((await c.query(`SELECT code, id FROM item WHERE code IN ('waste3:paper:paper-and-board-mixed:closed_loop','waste3:refuse:organic-food-and-drink-waste:composting',
        'waste3:refuse:commercial-and-industrial-waste:landfill','waste3:electrical-items:batteries:open_loop')`)).rows.map((r) => [r.code, r.id]));
      const now = new Date(), y = now.getUTCFullYear(), mo = now.getUTCMonth(), day = now.getUTCDate();
      const bins: [string, string, string, string, boolean, string, number, number, number][] = [
        ['Al Zahia Community', 'Loading bay 1 · cardboard', 'Retail loading bay', 'waste3:paper:paper-and-board-mixed:closed_loop', false, 'DEMO Paper Recycler', 1100, 0.06, 45],
        ['Al Zahia Community', 'Food court · food waste', 'Food court back-of-house', 'waste3:refuse:organic-food-and-drink-waste:composting', false, 'DEMO Waste Collector LLC', 240, 0.5, 95],
        ['Al Zahia Community', 'Compactor · general waste', 'Service yard', 'waste3:refuse:commercial-and-industrial-waste:landfill', false, 'DEMO Waste Collector LLC', 20000, 0.15, 0],
        ['Al Zahia Community', 'Facilities store · used batteries', 'Facilities store', 'waste3:electrical-items:batteries:open_loop', true, 'DEMO E-waste Recycler', 120, 0.9, 0],
      ];
      let k = 0;
      for (const [fac, name, loc, code, haz, contractor, cap, dens, daily] of bins) {
        if (!binItems[code]) continue;
        const bin = (await c.query(`INSERT INTO waste_bin (tenant_id, facility_id, code, name, location, item_id, hazardous, contractor, capacity_l, density, created_by)
                                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'demo') RETURNING id`, [t, ids.get(fac), `DEMO${String(++k).padStart(4, '0')}`, name, loc, binItems[code], haz, contractor, cap, dens])).rows[0].id;
        const scan = (d: number, kind: string, kg: number, extra: { fill?: number; est?: boolean; manifest?: string } = {}) => c.query(
          `INSERT INTO waste_scan (tenant_id, bin_id, facility_id, kind, kg, fill_pct, estimated, manifest, at, by_user) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Omar (demo)')`,
          [t, bin, ids.get(fac), kind, kg, extra.fill ?? null, extra.est ?? false, extra.manifest ?? null, new Date(Date.UTC(y, mo, d, 6 + (d % 5), 15)).toISOString()]);
        if (daily) for (let d = 1; d < day; d++) await scan(d, d % 4 === 0 ? 'fill' : 'weigh', d % 4 === 0 ? Math.round(cap * 0.75 * dens) : Math.round(daily * (0.8 + 0.4 * Math.abs(Math.sin(d)))), d % 4 === 0 ? { fill: 75, est: true } : {});
        if (name.startsWith('Compactor')) for (const d of [3, 10].filter((x) => x < day)) await scan(d, 'collection', 2800 + d * 20, { manifest: `DEMO-WTN-${y}${mo + 1}-${d}` });
        if (haz && day > 5) await scan(5, 'collection', 85, { manifest: `DEMO-HZ-${y}${mo + 1}-05` });
      }
      // a DEMO contractor with portal access, and its statement for this month (food waste below the site's own figure: flagged)
      const wc = (await c.query(`INSERT INTO waste_contractor (tenant_id, name, email, contact, code_hash, expires_at, created_by) VALUES ($1,'DEMO Waste Collector LLC','collector@demo.example','DEMO contact · not real',$2,(current_date + interval '12 months')::date,'demo') RETURNING id`,
        [t, createHash('sha256').update(ccode).digest('hex')])).rows[0].id;
      await linkBins(c);
      const zb = (await c.query(`SELECT facility_id, item_id, gri, name FROM waste_bin WHERE contractor_id = $1`, [wc])).rows;
      const lines = zb.map((b) => ({ facilityId: b.facility_id, itemId: b.item_id, gri: b.gri, tonnes: b.name.startsWith('Compactor') ? Math.round(((2860 + 3000) / 1000) * 1.02 * 1000) / 1000 : 0.8 }));
      if (lines.length && day > 10) await c.query(`INSERT INTO contractor_statement (tenant_id, contractor_id, year, month, lines, note) VALUES ($1,$2,$3,$4,$5,'DEMO statement — not real')`, [t, wc, y, mo + 1, JSON.stringify(lines)]);
    }
    // ------------------------------------------------------------ business travel --
    // DEMO trips (not real): flights from airports, by type, hotel stays and taxis, Jan–Sep 2026.
    const hotelUae = (await c.query(`SELECT id FROM item WHERE code = 'bt:hotel:united-arab-emirates'`)).rows[0]?.id;
    const hotelSa = (await c.query(`SELECT id FROM item WHERE code = 'bt:hotel:saudi-arabia'`)).rows[0]?.id;
    const hotelUk = (await c.query(`SELECT id FROM item WHERE code = 'bt:hotel:uk-london'`)).rows[0]?.id;
    const taxi = (await c.query(`SELECT id FROM item WHERE code LIKE 'bt:taxi:%' ORDER BY sort LIMIT 1`)).rows[0]?.id;
    let nt = 0;
    if (hotelUae) for (let m = 0; m < 9; m++) {
      const ps = `2026-${String(m + 1).padStart(2, '0')}-01`, pe = new Date(Date.UTC(2026, m + 1, 0)).toISOString().slice(0, 10), per = { periodStart: ps, periodEnd: pe, unit: 'pkm' };
      const trips: [string, Record<string, unknown>][] = [
        ['BEEAH Headquarters', { ...per, trip: { kind: 'flight', from: 'SHJ', to: 'RUH', cls: 'economy', ret: true, trips: 2 + (m % 3) } }],
        ['BEEAH Headquarters', { ...per, trip: { kind: 'flight', from: 'DXB', to: m % 2 ? 'LHR' : 'FRA', cls: m % 4 === 0 ? 'business' : 'economy', ret: true, trips: 1 } }],
        ['Data Centre Dubai', { ...per, trip: { kind: 'flight', from: 'DXB', to: 'BOM', cls: 'economy', ret: true, trips: 1 + (m % 2) } }],
        ['BEEAH Headquarters', { ...per, itemId: hotelSa ?? hotelUae, unit: 'room_night', trip: { kind: 'hotel', rooms: 2, nights: 3 } }],
        ['BEEAH Headquarters', { ...per, itemId: m % 2 && hotelUk ? hotelUk : hotelUae, unit: 'room_night', trip: { kind: 'hotel', rooms: 1, nights: 4 } }],
      ];
      if (taxi) trips.push(['BEEAH Headquarters', { ...per, itemId: taxi, unit: 'pkm', trip: { kind: 'ground', km: 28, ret: true, trips: 6 } }]);
      for (const [fac, input] of trips) { await put(fac, input); nt++; }
    }
    console.log(`Business travel: ${nt} DEMO trips (flights, hotels, taxis).`);

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
      page.drawText(`DEMO bill generated by ${PRODUCT} - not a real SEWA document`, { x: 40, y: 40, size: 8, font });
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
    // ------------------------------------------------------------ survey --
    // An employee commuting survey collecting answers (DEMO people and answers, not real).
    const svFacs = ['BEEAH Headquarters', 'Data Centre Dubai'].map((f) => ids.get(f)!).filter(Boolean);
    const head = Object.fromEntries((await c.query('SELECT id, employees FROM org_node WHERE id = ANY($1)', [svFacs])).rows.map((r) => [r.id, Number(r.employees)]));
    const sv = (await c.query(`INSERT INTO survey (tenant_id, name, year, close_at, weeks, wfh, facility_ids, headcount, status, created_by, opened_at)
                               VALUES ($1,'Employee commuting 2026',2026,'2026-11-20',46,true,$2,$3,'open',$4,now() - interval '9 days') RETURNING id`,
      [t, svFacs, JSON.stringify(head), String(users.get('admin') ?? users.get('super_admin'))])).rows[0].id as string;
    const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const FIRST = ['Aisha', 'Omar', 'Fatima', 'Rashid', 'Mariam', 'Khalid', 'Noura', 'Yousef', 'Layla', 'Hamad', 'Sara', 'Ahmed', 'Priya', 'Arjun', 'Maria', 'John', 'Hessa', 'Faisal'];
    const LAST = ['Al Mansoori', 'Khan', 'Haddad', 'Nair', 'Al Suwaidi', 'Fernandes', 'Rahman', 'Al Ali', 'Menon', 'Saleh'];
    const DEPTS = ['Finance', 'Operations', 'IT', 'HR', 'Sustainability', 'Engineering'];
    const MODES: [string, number, number][] = [['car', 0.46, 24], ['carpool', 0.12, 28], ['shuttle', 0.18, 22], ['metro', 0.1, 16], ['taxi', 0.06, 12], ['bus', 0.05, 18], ['walk', 0.03, 1]];
    let rnd = 7; const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
    const pick = () => { let x = r(); for (const m of MODES) { if ((x -= m[1]) <= 0) return m; } return MODES[0]!; };
    let nsp = 0, nsa = 0;
    for (let i = 0; i < 72; i++) {
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
      const fac = svFacs[i % 5 === 4 && svFacs[1] ? 1 : 0]!;
      const code = Array.from({ length: 8 }, () => AL[Math.floor(r() * AL.length)]).join('');
      const pid = (await c.query(`INSERT INTO survey_participant (tenant_id, survey_id, name, email, facility_id, department, code, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now() - interval '9 days') RETURNING id`,
        [t, sv, `${name} (DEMO)`, `demo.${i + 1}@example.com`, fac, DEPTS[i % DEPTS.length], code])).rows[0].id;
      nsp++;
      if (r() < 0.62) {
        const [mode, , km] = pick();
        const wfh = r() < 0.3 ? 1 : 0;
        const legs = [{ mode, km: Math.max(1, Math.round(km * (0.4 + r() * 1.3))) }];
        if (mode === 'shuttle' && r() < 0.3) legs.push({ mode: 'metro', km: 6 });
        await c.query('INSERT INTO survey_response (tenant_id, survey_id, participant_id, facility_id, answers) VALUES ($1,$2,$3,$4,$5)',
          [t, sv, pid, fac, JSON.stringify({ days: 5 - wfh, wfh, legs, fuel: mode === 'car' ? (r() < 0.8 ? 'petrol' : 'hybrid') : mode === 'carpool' ? 'petrol' : 'unknown', occ: mode === 'carpool' ? 3 : 1 })]);
        nsa++;
      }
    }
    // Enter → Review → Approved (DEMO): September 2026 waiting for approval, one August entry sent back, an October draft.
    await c.query(`UPDATE org_node SET manager_user_id = $1 WHERE id = $2`, [users.get('manager'), ids.get('BEEAH Headquarters')]);
    const prep = String(users.get('preparer')), mgrU = String(users.get('manager'));
    await c.query(`UPDATE activity SET status = 'submitted', submitted_by = $2, submitted_at = now() - interval '2 days', created_by = $2 WHERE tenant_id = $1 AND period_start = '2026-09-01'`, [t, prep]);
    await c.query(`UPDATE activity SET status = 'rejected', reviewed_by = $3, reviewed_at = now() - interval '1 day', created_by = $2, submitted_by = $2,
                          review_note = 'DEMO: the quantity does not match the delivery note — please check'
                    WHERE id = (SELECT a.id FROM activity a JOIN category k ON k.id = a.category_id WHERE a.tenant_id = $1 AND a.period_start = '2026-08-01' AND k.code = 'stationary_combustion' ORDER BY a.created_at LIMIT 1)`, [t, prep, mgrU]);
    // ------------------------------------------------------------ targets & actions --
    // A current plan and an accelerated scenario with DEMO reduction actions (figures are illustrative, not real).
    const sa0 = String(users.get('super_admin'));
    const plan = (await c.query(`INSERT INTO scenario (tenant_id, name, is_default, created_by) VALUES ($1, 'Current plan', true, $2) RETURNING id`, [t, sa0])).rows[0].id as string;
    const acc = (await c.query(`INSERT INTO scenario (tenant_id, name, created_by) VALUES ($1, 'Accelerated', $2) RETURNING id`, [t, sa0])).rows[0].id as string;
    const ACTS: [string | null, string, string, number[], string, number | null, number, number, number, number, number, string, string, string | null, number | null, boolean][] = [
      // lib, name, category, scopes, KPI, metric %, start, end, t/yr, capex, saving/yr, status, owner, facility, actual t/yr, also in accelerated only
      ['solar', 'Rooftop and car-park solar PV', 'Energy', [2], 'Share of site electricity from on-site solar', 25, 2026, 2028, 78, 1250000, 165000, 'Approved', 'Hessa (DEMO)', null, null, false],
      ['hvac', 'Chiller and HVAC optimisation (setpoints, VSDs, free cooling)', 'Energy', [2], 'Cooling energy reduction', 60, 2026, 2028, 112, 420000, 210000, 'In progress', 'Facilities team (DEMO)', 'BEEAH Headquarters', 31, false],
      ['led', 'LED lighting and controls', 'Energy', [2], 'Sites retrofitted', 80, 2026, 2026, 46, 95000, 61000, 'Done', 'Facilities team (DEMO)', null, 41, false],
      ['evlight', 'Electrify light vehicles (cars, vans, pickups)', 'Fleet', [1, 2], 'Light fleet electrified', 40, 2026, 2030, 34, 640000, 52000, 'Idea', 'Fleet manager (DEMO)', null, null, false],
      ['recycle', 'Increase recycling and diversion from landfill', 'Waste', [3], 'Waste diverted from landfill', 50, 2026, 2029, 22, 60000, 9000, 'Approved', 'Sustainability (DEMO)', null, null, false],
      [null, 'WtE plant: flue-gas heat recovery and auxiliary load cut (DEMO)', 'Energy', [1], 'Auxiliary diesel and grid use avoided', null, 2027, 2029, 2400, 18500000, 2350000, 'Idea', 'Plant manager (DEMO)', 'Sharjah Waste-to-Energy', null, true],
      ['travel', 'Travel policy: rail / economy, fewer trips', 'Travel & commute', [3], 'Trips avoided or downgraded', 80, 2026, 2027, 18, 0, 140000, 'Approved', 'HR (DEMO)', null, null, false],
    ];
    for (const [lib, name, cat, sc, kpi, ov, s0, s1, ab, capex, sav, st, owner, facN, actual, accOnly] of ACTS) {
      await c.query(`INSERT INTO reduction_action (tenant_id, lib, name, cat, scopes, kpi, obj_val, start_year, end_year, abate, capex, saving, life, status, owner, facility_id, actual, actual_note, comment, scenario_ids, created_by, updated_by)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,10,$13,$14,$15,$16,$17,'DEMO figures — illustrative, not real',$18,$19,$19)`,
        [t, lib, name, cat, sc, kpi, ov, s0, s1, ab, capex, sav, st, owner, facN ? ids.get(facN) ?? null : null, actual, actual !== null ? 'DEMO: metered before/after' : null, accOnly ? [acc] : [plan, acc], sa0]);
    }
    await c.query(`UPDATE tenant SET sbti = $2 WHERE id = $1`, [t, JSON.stringify({ status: 'Committed (letter sent)', growth: 2, nzYear: 2040, resid: 10 })]);
    console.log(`Targets & actions: 2 scenarios, ${ACTS.length} DEMO reduction actions.`);
    console.log(`Survey: "Employee commuting 2026", ${nsp} DEMO people, ${nsa} answers (open).`);
    console.log(`Meters: ${nr.toLocaleString('en')} DEMO readings (hourly, daily register, weekly), ${ns} monthly entries; ${nb} DEMO SEWA bills (7 booked, 1 to check).`);
    console.log(`Waste: a landfill with a DEMO tonnage history 2000–2025, ${nw} waste and water entries (landfill, waste-to-energy, composting, wastewater, waste sent out with contractors, water in and out by facility).`);
    console.log(`\nDemo company "${NAME}" created: ${TREE.length} sub-groups, ${[...ids.keys()].length - TREE.length} facilities, ${n} fuel entries (Jan 2025 – Sep 2026).`);
  });
  // purchases run after the company exists (the pipeline commits in chunks, like a real upload)
  const sa = (await platformTx((c: Tx) => c.query(`SELECT id, name, email, role, tenant_id, scope_node_id FROM app_user WHERE tenant_id = $1 AND role = 'super_admin' LIMIT 1`, [tenantId]))).rows[0];
  await demoPurchases(tenantId, { id: sa.id, name: sa.name, email: sa.email, role: 'super_admin', tenantId, scopeNodeId: null, mustChangePassword: false });
  // Batch runs (DEMO, not real): source totals on the purchase files, three connected systems with 30 days of transfers, one failed batch
  await platformTx(async (c: Tx) => {
    const t = tenantId;
    const bs = (await c.query(`SELECT b.id, b.name, count(l.*)::int AS n, coalesce(jsonb_object_agg(z.cur, z.amt) FILTER (WHERE z.cur IS NOT NULL), '{}') AS amounts
                                 FROM purchase_batch b LEFT JOIN purchase_line l ON l.batch_id = b.id
                                 LEFT JOIN LATERAL (SELECT coalesce(currency, 'AED') AS cur, sum(amount)::float8 AS amt FROM purchase_line WHERE batch_id = b.id GROUP BY 1) z ON true
                                WHERE b.tenant_id = $1 GROUP BY b.id ORDER BY b.created_at`, [t])).rows;
    for (const [i, b] of bs.entries()) {
      const n = Number(b.n) / Math.max(1, Object.keys(b.amounts).length);   // the join repeats lines per currency
      const amounts = Object.fromEntries(Object.entries(b.amounts as Record<string, number>).map(([k, v]) => [k, Math.round(v * 100) / 100]));
      // the second file: the ERP footer says 3 more lines than the file holds (DEMO difference to investigate)
      await c.query(`UPDATE purchase_batch SET control = $2 WHERE id = $1`, [b.id, JSON.stringify({ lines: Math.round(n) + (i === 1 ? 3 : 0), amounts, by: 'DEMO ERP extract footer (not real)', at: new Date().toISOString() })]);
    }
    const key = async (name: string, scopes: string[], expect: number) => (await c.query(
      `INSERT INTO api_key (tenant_id, name, prefix, key_hash, scopes, created_by, created_at, last_used_at, expect_hours) VALUES ($1,$2,'ek_demo',$3,$4,'demo',now() - interval '60 days',now(),$5) RETURNING id`,
      [t, name, `demo-${randomUUID()}`, scopes, expect])).rows[0].id as string;
    const sap = await key('DEMO SAP S/4HANA purchases (not real)', ['purchases'], 24), bms = await key('DEMO BMS meter gateway (not real)', ['meter_readings'], 6), ora = await key('DEMO Oracle fleet fuel (not real)', ['meter_readings'], 24);
    const run = (k: string, name: string, source: string, hoursAgo: number, st: string, http: number, rec: number, rej: number, err: string | null, problems: unknown[] = [], reference: string | null = null) => c.query(
      `INSERT INTO integration_run (tenant_id, api_key_id, client, source, endpoint, status, http_status, received, accepted, rejected, error, problems, reference, duration_ms, at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now() - make_interval(hours => $15))`,
      [t, k, name, source, source === 'purchases' ? 'POST /api/v1/purchases' : 'POST /api/v1/meter-readings', st, http, rec, st === 'failed' ? 0 : rec - rej, rej, err, JSON.stringify(problems), reference, 120 + Math.round(Math.random() * 900), hoursAgo]);
    for (let d = 30; d >= 1; d--) {
      if (d === 12) await run(sap, 'DEMO SAP S/4HANA purchases (not real)', 'purchases', d * 24 + 2, 'failed', 401, 0, 0, 'Access token not valid or expired');
      const bad = d % 9 === 0 ? 2 : 0;
      await run(sap, 'DEMO SAP S/4HANA purchases (not real)', 'purchases', d * 24, bad ? 'partial' : 'ok', 200, 180 + (d * 37) % 90, bad, null,
        bad ? [{ index: 14, reason: 'Missing amount' }, { index: 61, reason: 'Facility "PLANT-99" not found' }] : [], `DEMO-SAP-${String(30 - d + 1).padStart(3, '0')}`);
      if (d <= 3) await run(ora, 'DEMO Oracle fleet fuel (not real)', 'meter_readings', d * 24 - 4, 'failed', 400, 412, 412, 'Some fields are missing or invalid — readings.12.timestamp: Invalid datetime');
      else await run(ora, 'DEMO Oracle fleet fuel (not real)', 'meter_readings', d * 24 - 4, 'ok', 200, 380 + (d * 13) % 60, 0, null);
      for (let h = 0; h < 24; h += 6) {
        const rej = (d + h) % 23 === 0 ? 1 : 0;
        await run(bms, 'DEMO BMS meter gateway (not real)', 'meter_readings', d * 24 - h - 1, rej ? 'partial' : 'ok', 200, 96, rej, null, rej ? [{ index: 40, reason: 'meter "BMS-CH-07" is inactive' }] : []);
      }
    }
    await c.query(`UPDATE api_key SET fail_alert_at = now() - interval '20 hours' WHERE id = $1`, [ora]);
    // an API batch whose mapping failed (DEMO): Retry runs it again
    const fb = (await c.query(`INSERT INTO purchase_batch (tenant_id, source, name, external_ref, settings, status, error, created_by, created_at)
                                VALUES ($1, 'api', 'DEMO SAP S/4HANA purchases (not real): DEMO-SAP-REJECTED', 'DEMO-SAP-REJECTED', '{"currency":"AED","columns":{},"headerRow":0,"dateFormat":"ymd"}', 'failed',
                                        'DEMO — the mapping job stopped: the server restarted while it ran', 'api:DEMO SAP S/4HANA purchases (not real)', now() - interval '2 days') RETURNING id`, [t])).rows[0].id;
    await c.query(`INSERT INTO job (tenant_id, kind, ref, status, attempts, error, created_by, created_at, started_at, finished_at)
                   VALUES ($1, 'purchase_map', $2, 'failed', 1, 'DEMO — the mapping job stopped: the server restarted while it ran', 'api:DEMO SAP', now() - interval '2 days', now() - interval '2 days', now() - interval '2 days')`, [t, fb]);
    console.log(`Batch runs: source totals on ${bs.length} purchase files (one with a DEMO difference), 3 DEMO connected systems with 30 days of transfers (Oracle failing), 1 failed batch to retry.`);
  });
  // Supplier portal (DEMO, not real): the four largest suppliers of the base year asked for their data
  const scode = temporaryPassword().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10).padEnd(10, 'Y');
  let sportal = '';
  await platformTx(async (c: Tx) => {
    const t = tenantId;
    const by = (await c.query(`SELECT base_year FROM tenant WHERE id = $1`, [t])).rows[0].base_year as number;
    const top = (await c.query(`SELECT s.id, s.name FROM purchase_line l JOIN supplier s ON s.id = l.supplier_id WHERE l.tenant_id = $1 AND l.status = 'published'
                                 GROUP BY s.id ORDER BY sum(l.co2e) DESC NULLS LAST LIMIT 4`, [t])).rows as { id: string; name: string }[];
    if (top.length < 4) return;
    // invented supplier records (no real company is shown with made-up figures): the lines of the four largest suppliers move to them
    const FAKE = ['Falcon Steel Works (DEMO, not real)', 'Oasis Cement Co (DEMO, not real)', 'Dunes Heavy Equipment (DEMO, not real)', 'Palm Ready Mix (DEMO, not real)'];
    for (const [i, s] of top.entries()) {
      const id = (await c.query(`INSERT INTO supplier (tenant_id, name, norm, country, origin) VALUES ($1,$2,$3,'AE','manual') RETURNING id`, [t, FAKE[i], normSupplier(FAKE[i]!)])).rows[0].id as string;
      await c.query(`UPDATE purchase_line SET supplier_id = $2 WHERE supplier_id = $1`, [s.id, id]);
      await c.query(`UPDATE supplier_ef SET supplier_id = $2 WHERE supplier_id = $1`, [s.id, id]);
      top[i] = { id, name: FAKE[i]! };
    }
    const slug = (n: string) => n.replace(/\(DEMO, not real\)/, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'supplier';
    const pdf = await PDFDocument.create(); const pg = pdf.addPage([595, 842]); const font = await pdf.embedFont(StandardFonts.Helvetica);
    pg.drawText('DEMO - not a real document', { x: 50, y: 790, size: 18, font }); pg.drawText(`${top[1]!.name}: sustainability report ${by} (DEMO, invented figures)`, { x: 50, y: 760, size: 11, font });
    const buf = Buffer.from(await pdf.save());
    const doc = (await c.query(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1,'supplier_evidence',$2,'application/pdf',$3,$4,$5,$6) RETURNING id`,
      [t, 'DEMO sustainability report (not real).pdf', buf.length, createHash('sha256').update(buf).digest('hex'), sealFile(buf), `${top[1]!.name} (supplier, DEMO)`])).rows[0].id as string;
    const full = (rev: number, s1: number, s2: number, sales: number, target: string) => ({
      profile: { legalName: 'DEMO — invented company details', country: 'AE', industry: 'DEMO industry', size: 'large', contactName: 'DEMO Contact', contactRole: 'Sustainability manager' },
      inventory: { reports: 'yes', scope1: s1, scope2Location: Math.round(s2 * 1.15), scope2Market: s2, scope3: s1 * 4, scope3Categories: '1, 4, 6, 7', boundary: 'operational', standard: 'GHG Protocol Corporate Standard',
        verification: 'limited', verifier: 'DEMO Assurance (not real)', revenue: rev, currency: 'AED', notes: 'DEMO — invented figures' },
      allocation: { method: 'revenue', customerRevenue: sales, notes: 'DEMO — sales to the customer from our ledger' },
      targets: { status: target, baseYear: 2022, targetYear: 2030, reductionPct: 42, scopes: 'Scope 1 + 2', netZeroYear: 2050 },
      products: { none: false, items: [{ name: 'DEMO product (not real)', co2e: 1.8, unit: 'kg', standard: 'EPD (ISO 14025 / EN 15804)', boundary: 'cradle-to-gate', verified: true, documentId: null as string | null }] },
    });
    const req = async (s: { id: string; name: string }, status: string, answers: unknown, docs: unknown[], code: string | null, daysAgo: number) => (await c.query(
      `INSERT INTO supplier_request (tenant_id, supplier_id, year, contact_name, email, message, due_date, code_hash, expires_at, status, answers, documents, submitted_at, submitted_by, reviewed_by, reviewed_at, created_by, created_at, last_used_at)
       VALUES ($1,$2,$3,'DEMO Contact',$4,$5,current_date + 30,$6,current_date + 180,$7,$8,$9,$10,$11,$12,$13,'demo',now() - make_interval(days => $14),$15) RETURNING id`,
      [t, s.id, by, `esg@${slug(s.name)}.example`, `DEMO — please share your ${by} greenhouse-gas data.`, code ? createHash('sha256').update(code).digest('hex') : null, status, JSON.stringify(answers), JSON.stringify(docs),
       ['submitted', 'accepted'].includes(status) ? new Date(Date.now() - 5 * 86400e3) : null, ['submitted', 'accepted'].includes(status) ? 'DEMO Contact, Sustainability manager' : null,
       status === 'accepted' ? 'Nikhil (Super admin)' : null, status === 'accepted' ? new Date(Date.now() - 2 * 86400e3) : null, daysAgo, status === 'invited' ? null : new Date(Date.now() - 86400e3)])).rows[0].id as string;
    // 1: accepted — its intensity is a supplier factor
    const a1 = full(250_000_000, 4200, 1800, 12_000_000, 'sbti_validated');
    const r1 = await req(top[0]!, 'accepted', { ...a1, declaration: { name: 'DEMO Contact', title: 'Sustainability manager', at: new Date().toISOString() } }, [], null, 40);
    const k1 = (6000 * 1000) / 250_000_000;
    await c.query(`INSERT INTO supplier_ef (tenant_id, supplier_id, co2e, unit, price_year, valid_from, valid_to, source, boundary, created_by, request_id)
                   VALUES ($1,$2,$3,'AED',$4,$5,$6,$7,'Supplier operations (Scope 1+2)','demo',$8)`,
      [t, top[0]!.id, k1, by, `${by}-01-01`, `${by + 1}-12-31`, `Supplier portal: ${top[0]!.name} ${by} — Scope 1+2 per unit of revenue (DEMO, not real)`, r1]);
    await c.query(`UPDATE supplier SET climate_target = 'sbti_validated', reports_emissions = 'yes' WHERE id = $1`, [top[0]!.id]);
    await c.query(`UPDATE supplier_request SET applied = $2 WHERE id = $1`, [r1, JSON.stringify({ profile: ['reports_emissions', 'climate_target'], factors: [{ kind: 'intensity', co2e: k1, unit: 'AED' }], linesRecalculated: 0 })]);
    // 2: submitted with a report and a product footprint — to review
    const a2 = full(80_000_000, 1500, 900, 6_500_000, 'sbti_committed'); a2.products.items[0]!.documentId = doc;
    await req(top[1]!, 'submitted', { ...a2, declaration: { name: 'DEMO Contact', title: 'Sustainability manager', at: new Date().toISOString() } }, [{ id: doc, filename: 'DEMO sustainability report (not real).pdf', kind: 'report', size: buf.length }], null, 25);
    // 3: in progress (the code is printed below so the portal can be tried)
    await req(top[2]!, 'in_progress', { profile: full(1, 1, 1, 1, 'own').profile, targets: { status: 'own', targetYear: 2030, reductionPct: 30 } }, [], scode, 12);
    // 4: invited, not started
    await req(top[3]!, 'invited', {}, [], null, 3);
    sportal = `esg@${slug(top[2]!.name)}.example`;
    // engagement (DEMO): departments on the largest suppliers; CDP scores, targets and prospects only on invented suppliers
    const DEPTS = ['Facilities', 'Fleet & logistics', 'IT', 'Construction', 'Waste operations', 'Corporate services'];
    const big = (await c.query(`SELECT s.id FROM supplier s JOIN purchase_line l ON l.supplier_id = s.id WHERE s.tenant_id = $1 GROUP BY s.id ORDER BY sum(l.co2e) DESC NULLS LAST LIMIT 40`, [t])).rows;
    for (const [i, r] of big.entries()) await c.query(`UPDATE supplier SET department = $2 WHERE id = $1`, [r.id, DEPTS[i % DEPTS.length]]);
    await c.query(`UPDATE supplier SET cdp_score = 'A-', cdp_year = $2, reports_emissions = 'yes', target = $3 WHERE id = $1`, [top[0]!.id, by, JSON.stringify({ reductionPct: 42, baseYear: 2022, targetYear: 2030, netZeroYear: 2050, source: 'Supplier portal (DEMO)' })]);
    await c.query(`UPDATE supplier SET cdp_score = 'B', cdp_year = $2 WHERE id = $1`, [top[1]!.id, by]);
    await c.query(`UPDATE supplier SET climate_target = 'own', target = $2 WHERE id = $1`, [top[2]!.id, JSON.stringify({ reductionPct: 30, baseYear: 2023, targetYear: 2030, source: 'DEMO' })]);
    for (const [n, dep, cdp, tgt] of [['Desert Bloom Biofuels (DEMO, not real)', 'Fleet & logistics', 'B', 'sbti_committed'], ['Gulf Green Concrete (DEMO, not real)', 'Construction', 'A', 'sbti_validated'], ['Solar Shade Facilities (DEMO, not real)', 'Facilities', null, 'own']] as const)
      await c.query(`INSERT INTO supplier (tenant_id, name, norm, country, kind, department, cdp_score, climate_target, reports_emissions, origin, note) VALUES ($1,$2,$3,'AE','prospect',$4,$5,$6,'yes','manual','DEMO — invented prospect')`,
        [t, n, normSupplier(n), dep, cdp, tgt]);
    // a DEMO SBTi list (invented companies) — only when no real list has been loaded on the platform
    if (!Number((await c.query(`SELECT count(*)::int AS n FROM sbti_company`)).rows[0].n)) {
      const L = [[top[0]!.name, 'Targets set', '1.5°C', 2050], [top[1]!.name, 'Committed', null, null], ['Gulf Green Concrete (DEMO, not real)', 'Targets set', '1.5°C', 2045], ['Desert Bloom Biofuels (DEMO, not real)', 'Committed', null, null], ['Coral Bay Packaging (DEMO, not real)', 'Targets set', 'Well-below 2°C', null]] as const;
      for (const [n, st, cl, nz] of L) await c.query(`INSERT INTO sbti_company (name, norm, location, sector, near_status, near_class, net_zero_year, published) VALUES ($1,$2,'United Arab Emirates','DEMO sector',$3,$4,$5,'2025 (DEMO)')`,
        [n, normSupplier(n), st, cl, nz]);
      await c.query(`INSERT INTO sbti_import (filename, rows, imported_by, demo) VALUES ('DEMO SBTi list (not real)', $1, 'demo', true)`, [L.length]);
    }
    console.log(`Supplier portal: 4 DEMO requests for ${by} (accepted with a supplier factor, submitted to review, in progress, invited).`);
  });
  // Product LCA (DEMO, not real)
  await tenantTx(tenantId, (c: Tx) => demoLca(c, tenantId));
  // CBAM (DEMO, not real)
  await tenantTx(tenantId, (c: Tx) => demoCbam(c, tenantId));
  // entries typed in during the year came in a few days after each month, most before the due date (before 2025 is locked below)
  await platformTx((c: Tx) => c.query(`UPDATE activity SET submitted_at = least(period_end + (2 + floor(random() * 11))::int, now() - interval '1 day')
                                         WHERE tenant_id = $1 AND status = 'approved' AND submitted_at IS NULL AND period_end < now()`, [tenantId]));
  // Audit & assurance (DEMO, not real): 2025 assured and locked month by month; 2026 engagement in planning.
  await platformTx(async (c: Tx) => {
    const t = tenantId;
    await c.query(`INSERT INTO assurance_engagement (tenant_id, year, standard, level, provider, lead, scope, materiality, status, opinion, issued_on, updated_by)
                   VALUES ($1, 2025, 'ISAE 3410', 'limited', 'DEMO Assurance Partners (not real)', 'DEMO lead verifier', 'Scope 1, Scope 2 (location- and market-based), Scope 3 categories 1, 3, 5, 6 and 7', 5, 'issued',
                           'DEMO — Based on the procedures performed and the evidence obtained, nothing has come to our attention that causes us to believe that the GHG statement is not prepared, in all material respects, in accordance with the GHG Protocol Corporate Standard.', '2026-03-31', 'demo'),
                          ($1, 2026, 'ISSA 5000', 'limited', 'DEMO Assurance Partners (not real)', 'DEMO lead verifier', 'Scope 1, Scope 2 and Scope 3', 5, 'planning', NULL, NULL, 'demo')`, [t]);
    const ready = (await c.query(`SELECT to_char(mo.d, 'YYYY-MM') AS m FROM generate_series('2025-01-01'::date, '2025-12-01'::date, interval '1 month') mo(d)
                                   WHERE NOT EXISTS (SELECT 1 FROM activity a WHERE a.tenant_id = $1 AND a.status <> 'approved' AND mo.d BETWEEN date_trunc('month', a.period_start) AND date_trunc('month', a.period_end))`, [t])).rows;
    for (const r of ready) await c.query(`INSERT INTO period_lock (tenant_id, month, locked_by, reason) VALUES ($1, $2::date, 'demo', 'DEMO — 2025 assured')`, [t, `${r.m}-01`]);
    const a = (await c.query(`SELECT a.id, a.facility_id FROM activity a JOIN category k ON k.id = a.category_id WHERE a.tenant_id = $1 AND a.status = 'approved' AND k.code = 'purchased_electricity'
                               AND a.period_start >= '2026-01-01' ORDER BY a.period_start LIMIT 1`, [t])).rows[0];
    if (a) await c.query(`INSERT INTO assurance_finding (tenant_id, year, activity_id, severity, kind, text, impact_t, raised_by) VALUES ($1, 2026, $2, 'medium', 'evidence',
                          'DEMO — Electricity for this month was typed in: attach the utility bill (or the meter export) so the quantity can be agreed.', 0, 'DEMO verifier')`, [t, a.id]);
    console.log(`Assurance: 2025 issued (DEMO), ${ready.length} months of 2025 locked; 2026 in planning with one DEMO finding.`);
  });
  // Document vault and message centre (DEMO, not real): files filed by facility and linked to entries; conversations with the team.
  await platformTx(async (c: Tx) => {
    const t = tenantId;
    const U = new Map((await c.query(`SELECT role, id, name FROM app_user WHERE tenant_id = $1`, [t])).rows.map((r) => [r.role as string, r as { id: string; name: string }]));
    const F = new Map((await c.query(`SELECT name, id FROM org_node WHERE tenant_id = $1 AND kind = 'facility'`, [t])).rows.map((r) => [r.name as string, r.id as string]));
    const mkPdf = async (title: string, lines: string[]) => {
      const doc = await PDFDocument.create(); const page = doc.addPage([595, 842]); const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      page.drawText('DEMO DOCUMENT - NOT REAL', { x: 40, y: 800, size: 9, font: bold });
      page.drawText(title, { x: 40, y: 770, size: 16, font: bold });
      let yy = 740; for (const l of lines) { page.drawText(l, { x: 40, y: yy, size: 10.5, font }); yy -= 18; }
      page.drawText(`Generated by ${PRODUCT} for the demo company. Names, figures and references are invented.`, { x: 40, y: 40, size: 8, font });
      return Buffer.from(await doc.save());
    };
    const today = new Date(); const plus = (d: number) => new Date(today.getTime() + d * 86400e3).toISOString().slice(0, 10);
    const add = async (o: { file: string; title: string; type: string; fac?: string; from?: string; to?: string; valid?: string; tags?: string[]; note?: string; by: string; lines: string[]; link?: string }) => {
      const buf = await mkPdf(o.title, o.lines);
      const id = (await c.query(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by, doc_type, title, facility_id, period_from, period_to, valid_until, tags, note)
                                 VALUES ($1,'vault',$2,'application/pdf',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [t, o.file, buf.length, createHash('sha256').update(buf).digest('hex'), sealFile(buf), U.get(o.by)?.id ?? null, o.type, o.title, o.fac ? F.get(o.fac) ?? null : null, o.from ?? null, o.to ?? null, o.valid ?? null, o.tags ?? [], o.note ?? null])).rows[0].id;
      if (o.link) await c.query(`INSERT INTO document_link (tenant_id, document_id, activity_id, linked_by) SELECT $1, $2, a.id, $3 FROM activity a WHERE ${o.link} ON CONFLICT DO NOTHING`, [t, id, U.get(o.by)?.name ?? 'demo']);
      return id;
    };
    const wte = 'Sharjah Waste-to-Energy', rec = "Al Saja'a Recycling Complex";
    const diesel = `a.tenant_id = $1 AND a.item_id = (SELECT id FROM item WHERE code = 'desnz:diesel-100-mineral-diesel')`;
    for (const [m, mm] of [['2026-01', 'Jan'], ['2026-02', 'Feb'], ['2026-03', 'Mar'], ['2026-04', 'Apr'], ['2026-05', 'May'], ['2026-06', 'Jun']]) {
      await add({ file: `DEMO-diesel-deliveries-WtE-${m}.pdf`, title: `Diesel delivery invoices - ${mm} 2026`, type: 'invoice', fac: wte, from: `${m}-01`, to: `${m}-28`, tags: ['diesel'], by: 'preparer',
        lines: ['Supplier: DEMO Fuel Supplies LLC (not real)', `Delivered to: ${wte}`, `Period: ${mm} 2026`, 'Product: Diesel (EN 590)', 'Quantity: 18,500 litres (sum of 6 delivery notes)'],
        link: `${diesel} AND a.facility_id = (SELECT id FROM org_node WHERE tenant_id = $1 AND name = '${wte.replace(/'/g, "''")}') AND to_char(a.period_start, 'YYYY-MM') = '${m}'` });
    }
    await add({ file: 'DEMO-diesel-deliveries-Recycling-2026-Q1.pdf', title: 'Diesel delivery invoices - Q1 2026', type: 'invoice', fac: rec, from: '2026-01-01', to: '2026-03-31', tags: ['diesel'], by: 'manager',
      lines: ['Supplier: DEMO Fuel Supplies LLC (not real)', `Delivered to: ${rec}`, 'Period: January - March 2026', 'Quantity: 18,600 litres'],
      link: `${diesel} AND a.facility_id = (SELECT id FROM org_node WHERE tenant_id = $1 AND name = '${rec.replace(/'/g, "''")}') AND a.period_start BETWEEN '2026-01-01' AND '2026-03-31'` });
    await add({ file: 'DEMO-refrigerant-service-log-WtE-2026-H1.pdf', title: 'Refrigerant service log - H1 2026', type: 'refrigerant', fac: wte, from: '2026-01-01', to: '2026-06-30', tags: ['R-410A', 'chillers'], by: 'manager',
      lines: ['Contractor: DEMO HVAC Services (not real)', 'Chiller 1: R-410A top-up 4.5 kg (March)', 'Chiller 2: no leak found', 'Leak test method: electronic detector'] });
    await add({ file: 'DEMO-environmental-permit-WtE.pdf', title: 'Environmental permit - Waste-to-Energy plant', type: 'permit', fac: wte, valid: plus(38), tags: ['permit'], by: 'super_admin',
      lines: ['Permit no.: DEMO-EP-2023-0412', `Holder: ${wte}`, 'Activity: thermal treatment of municipal solid waste', `Valid until: ${plus(38)}`], note: 'DEMO — renewal application to be filed' });
    await add({ file: 'DEMO-calibration-gas-meter-WtE.pdf', title: 'Gas flow meter calibration certificate', type: 'calibration', fac: wte, valid: plus(-12), tags: ['natural gas', 'meter'], by: 'manager',
      lines: ['Laboratory: DEMO Calibration Lab (not real)', 'Instrument: ultrasonic gas flow meter, serial DEMO-77812', 'Result: within +/- 0.5 % of reference', `Next calibration due: ${plus(-12)}`] });
    await add({ file: 'DEMO-energy-attribute-certificates-2025.pdf', title: 'Energy attribute certificates - 2025 consumption', type: 'certificate', from: '2025-01-01', to: '2025-12-31', tags: ['I-REC', 'market-based'], by: 'super_admin',
      lines: ['Registry: DEMO registry (not real)', 'Volume: 2,000 MWh, solar, same market', 'Vintage: 2025', 'Redeemed for: DEMO company, 2025 Scope 2 market-based'] });
    await add({ file: 'DEMO-travel-agency-report-2026-H1.pdf', title: 'Travel agency report - H1 2026', type: 'travel', from: '2026-01-01', to: '2026-06-30', tags: ['flights', 'hotels'], by: 'admin',
      lines: ['Agency: DEMO Travel Management (not real)', 'Flights: 214 segments, 1.9 million passenger-km', 'Hotel nights: 380'] });
    await add({ file: 'DEMO-waste-collection-contract.pdf', title: 'Waste collection and treatment contract', type: 'contract', fac: rec, valid: plus(400), from: '2025-01-01', to: '2027-12-31', by: 'super_admin',
      lines: ['Contractor: DEMO Waste Logistics (not real)', 'Scope: collection, transport and treatment of non-hazardous waste', 'Term: 2025 - 2027'] });
    await add({ file: 'DEMO-water-invoice-Recycling-2026-07.pdf', title: 'Water invoice - Jul 2026', type: 'bill', fac: rec, from: '2026-07-01', to: '2026-07-31', by: 'manager', tags: ['water'],
      lines: ['Utility: DEMO Water Utility (not real)', 'Consumption: 3,420 m3', 'Not yet linked to its entry'] });
    // conversations with the team (DEMO)
    const thread = async (who: string, topic: string, subject: string, page: string | null, msgs: [boolean, string, number][], status: string) => {
      const u = U.get(who)!; const t0 = Date.now() - msgs[0]![2] * 3600e3;
      const id = (await c.query(`INSERT INTO message_thread (tenant_id, created_by, topic, subject, page, status, created_at, last_company_at, last_team_at, team_read_at, closed_at, closed_by)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$7,NULL,NULL,NULL,NULL) RETURNING id`, [t, u.id, topic, subject, page, status, new Date(t0)])).rows[0].id;
      for (const [team, body, hAgo] of msgs) {
        const at = new Date(Date.now() - hAgo * 3600e3);
        await c.query(`INSERT INTO message (tenant_id, thread_id, author_id, author_name, from_team, body, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [t, id, team ? null : u.id, team ? `${PRODUCT} team (DEMO)` : u.name, team, body, at]);
        await c.query(`UPDATE message_thread SET ${team ? 'last_team_at' : 'last_company_at'} = $2, team_read_at = CASE WHEN $3 THEN $2 ELSE team_read_at END WHERE id = $1`, [id, at, team]);
      }
      if (status === 'closed') await c.query(`UPDATE message_thread SET closed_at = now(), closed_by = $2 WHERE id = $1`, [id, u.name]);
    };
    await thread('preparer', 'data_help', 'How do I enter district cooling billed in TRh?', '/data', [
      [false, 'DEMO — Our data centre gets a monthly district cooling bill in TRh. Which category do I use, and do I need the plant efficiency?', 50],
      [true, 'DEMO — Use Purchased energy → District cooling, unit TRh. If the supplier publishes kg CO2e per TRh, pick it under Supplier factor; otherwise enter the plant efficiency (kWh per TRh or COP) and the grid factor is applied.', 30]], 'answered');
    await thread('manager', 'problem', 'February diesel entry shows a factor warning', '/entries', [
      [false, 'DEMO — The Feb 2026 diesel entry at the WtE plant says "next year\'s factors are not loaded yet". Is the number wrong?', 3]], 'open');
    await thread('super_admin', 'feature', 'Request: Arabic version of the board report', '/reports', [
      [false, 'DEMO — Could the board summary be produced in Arabic as well as English?', 240],
      [true, 'DEMO — Thanks, noted for the report templates roadmap. We will let you know here when it is available.', 200],
      [false, 'DEMO — Great, thank you.', 190]], 'closed');
    await c.query(`INSERT INTO announcement (kind, title, body, tenant_ids, published_by, published_at) VALUES
      ('factors', 'DEMO — Grid electricity factors for the US, EU, Australia and Asia added', 'DEMO announcement. Location-based Scope 2 factors for 68 grid regions are now in the factor library. Entries with a missing-factor warning can be recalculated from Entries & results.', ARRAY[$1]::uuid[], $2 || ' team (DEMO)', now() - interval '2 days'),
      ('maintenance', 'DEMO — Planned maintenance, Saturday 06:00-07:00 UTC', 'DEMO announcement. ' || $2 || ' will be unavailable for up to one hour. Nothing you have saved is affected.', ARRAY[$1]::uuid[], $2 || ' team (DEMO)', now() - interval '6 days')`, [t, PRODUCT]);
    const nd = (await c.query(`SELECT count(*)::int AS n, (SELECT count(*)::int FROM document_link WHERE tenant_id = $1) AS l FROM document WHERE tenant_id = $1 AND kind = 'vault'`, [t])).rows[0];
    console.log(`Document vault: ${nd.n} DEMO files, ${nd.l} links to entries (one permit expiring, one calibration expired, one invoice not linked). Message centre: 3 DEMO conversations, 2 announcements.`);
  });
  // Metric registry and collection calendar (DEMO): owners and rules as versions, one change waiting for approval;
  // a few recent months left open so the calendar, reminders and escalations have something to show.
  await tenantTx(tenantId, async (c: Tx) => {
    const t = tenantId;
    await ensureMetrics(c, t, 'demo');
    const U = new Map((await c.query(`SELECT role, id, name FROM app_user WHERE tenant_id = $1`, [t])).rows.map((r) => [r.role as string, r as { id: string; name: string }]));
    const M = new Map((await c.query(`SELECT * FROM metric`)).rows.map((r) => [r.category_code as string, r]));
    const change = async (cat: string, set: Record<string, unknown>, reason: string, by: string) => {
      const m = M.get(cat); if (!m) return;
      await applyMetric(c, t, m.id, metricBody.parse({ ...metricSnapshot(m), ...set }), reason, U.get(by)!.name, U.get('super_admin')!.name);
    };
    await change('stationary_combustion', { required: true, facility_types: ['Plant'], source_system: 'Fuel delivery notes and tank dips (DEMO)', due_day: 10 },
      'DEMO — every plant reports fuel every month, even when nothing was delivered', 'super_admin');
    await change('purchased_electricity', { owner_user_id: U.get('admin')!.id, check_pct: 20, source_system: 'DEWA / SEWA bills and smart meters (DEMO)' },
      'DEMO — the energy team owns electricity; bills are exact, so a tighter check', 'admin');
    await change('fugitive', { evidence: 'required', source_system: 'HVAC contractor service reports (DEMO)' }, 'DEMO — refrigerant top-ups need the service report (assurance finding)', 'super_admin');
    const w = M.get('waste_generated');
    if (w) await c.query(`INSERT INTO metric_change (tenant_id, metric_id, proposal, reason, proposed_by, proposed_name) VALUES ($1,$2,$3,$4,$5,$6)`,
      [t, w.id, JSON.stringify({ ...metricSnapshot(w), evidence: 'required', source_system: 'Contractor manifests (DEMO)' }), 'DEMO — a manifest for every collection, as the contractor portal now provides them', U.get('admin')!.id, U.get('admin')!.name]);
    // open work: Sep 2026 fuel at the recycling complex not entered (overdue); WtE Sep electricity waiting for approval;
    // water at the busiest water site: July excused, August not entered (escalated), September not entered (overdue)
    const fac = async (name: string) => (await c.query(`SELECT id FROM org_node WHERE name = $1`, [name])).rows[0]?.id as string | undefined;
    const del = async (f: string | undefined, cat: string, months: string[]) => {
      if (!f) return;
      await c.query(`DELETE FROM document_link WHERE activity_id IN (SELECT a.id FROM activity a JOIN category k ON k.id = a.category_id WHERE a.facility_id = $1 AND k.code = $2 AND to_char(a.period_start, 'YYYY-MM') = ANY($3))`, [f, cat, months]);
      await c.query(`DELETE FROM activity_result WHERE activity_id IN (SELECT a.id FROM activity a JOIN category k ON k.id = a.category_id WHERE a.facility_id = $1 AND k.code = $2 AND to_char(a.period_start, 'YYYY-MM') = ANY($3))`, [f, cat, months]);
      await c.query(`DELETE FROM activity a USING category k WHERE k.id = a.category_id AND a.facility_id = $1 AND k.code = $2 AND to_char(a.period_start, 'YYYY-MM') = ANY($3) AND a.purchase_batch_id IS NULL AND a.meter_id IS NULL`, [f, cat, months]);
    };
    await del(await fac("Al Saja'a Recycling Complex"), 'stationary_combustion', ['2026-09']);
    const wte = await fac('Sharjah Waste-to-Energy');
    await c.query(`UPDATE activity a SET status = 'submitted', submitted_at = now() - interval '2 days', submitted_by = created_by FROM category k
                    WHERE k.id = a.category_id AND a.facility_id = $1 AND k.code = 'purchased_electricity' AND to_char(a.period_start, 'YYYY-MM') = '2026-09'`, [wte]);
    const ws = (await c.query(`SELECT a.facility_id AS f FROM activity a JOIN category k ON k.id = a.category_id WHERE k.code = 'water_supply' AND to_char(a.period_start, 'YYYY-MM') = '2026-08' AND a.meter_id IS NULL
                                GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)).rows[0]?.f as string | undefined;
    await del(ws, 'water_supply', ['2026-07', '2026-08', '2026-09']);
    if (ws && M.get('water_supply')) await c.query(`INSERT INTO collection_exception (tenant_id, facility_id, metric_id, period, reason, by_user, by_name) VALUES ($1,$2,$3,'2026-07-01',$4,$5,$6)`,
      [t, ws, M.get('water_supply').id, 'DEMO — site closed for the summer shutdown; no water drawn', U.get('manager')?.id ?? null, U.get('manager')?.name ?? 'demo']);
    // waste at the data centre and the fleet depot is collected every few months: the empty months are excused
    if (M.get('waste_generated')) await c.query(
      `INSERT INTO collection_exception (tenant_id, facility_id, metric_id, period, reason, by_name)
       SELECT $1, f.id, $2, mo.d::date, 'DEMO — collected every few months; nothing collected this month', $3
         FROM org_node f CROSS JOIN generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month') mo(d)
        WHERE f.name IN ('Data Centre Dubai', 'Fleet Depot Sharjah')
          AND NOT EXISTS (SELECT 1 FROM activity a JOIN category k ON k.id = a.category_id WHERE a.facility_id = f.id AND k.code = 'waste_generated' AND date_trunc('month', a.period_start) = mo.d)`,
      [t, M.get('waste_generated').id, U.get('manager')?.name ?? 'demo']);
    // meter months up to June were submitted and approved by the manager; July and August meter drafts are still waiting to be sent
    await c.query(`UPDATE activity SET status = 'approved', submitted_at = period_end + interval '6 days', submitted_by = created_by, reviewed_at = period_end + interval '8 days', reviewed_by = $1
                    WHERE status = 'draft' AND meter_id IS NOT NULL AND period_start < '2026-07-01'`, [U.get('manager')?.id ?? null]);
    // base-year restatement (DEMO): the landfill's 2025 methane re-estimated with measured gas (applied), an acquisition waiting for approval
    const all = (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((x) => x.id as string);
    const by = (await c.query(`SELECT base_year FROM tenant WHERE id = $1`, [t])).rows[0].base_year as number;
    const bm = await measured(c, t, by, all);
    const lf = await fac("Al Saja'a Landfill");
    if (bm.total > 0) {
      const cut = -Math.round(bm.total * 0.062);
      await c.query(`INSERT INTO base_restatement (tenant_id, base_year, trigger, title, description, facility_id, effective, s1_t, status, applied, applied_at, base_before, pct,
                                                   proposed_by, proposed_name, proposed_at, decided_by, decided_name, decided_at, decision_note)
                     VALUES ($1,$2,'method',$3,$4,$5,'2026-04-01',$6,'approved',true,now() - interval '20 days',$7,$8,$9,$10,now() - interval '24 days',$11,$12,now() - interval '20 days',$13)`,
        [t, by, 'DEMO — Landfill methane: measured gas replaces the model', 'DEMO — flow meters on the gas engines since 2026 allow the 2025 methane to be recalculated from measured gas; first-order-decay model replaced.',
         lf ?? null, cut, Math.round(bm.total), Math.round(Math.abs(cut) / bm.total * 10000) / 100, U.get('admin')!.id, U.get('admin')!.name, U.get('super_admin')!.id, U.get('super_admin')!.name, 'DEMO — checked against the engine logs']);
      await c.query(`INSERT INTO base_restatement (tenant_id, base_year, trigger, title, description, effective, s1_t, s2_t, s3_t, proposed_by, proposed_name, proposed_at)
                     VALUES ($1,$2,'acquisition',$3,$4,'2026-09-01',$5,$6,$7,$8,$9,now() - interval '2 days')`,
        [t, by, 'DEMO — Acquisition of a fleet services company (not real)', 'DEMO — its 2025 fuel and electricity from its own records, added as if it had always been part of the group.',
         Math.round(bm.total * 0.041), Math.round(bm.total * 0.006), Math.round(bm.total * 0.012), U.get('admin')!.id, U.get('admin')!.name]);
    }
    // carbon credits (DEMO projects, not real): four purchases, three approved retirements for the base year, one waiting
    const lot = async (v: unknown[]) => (await c.query(`INSERT INTO carbon_credit_lot (tenant_id, project, project_id, registry, methodology, category, project_type, country, vintage, quantity, price, supplier,
                                                        contract_date, status, delivered_on, serials, ccp, corsia, ca, permanence, notes, created_by, created_name)
                                                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'DEMO — not a real project or purchase',$21,$22) RETURNING id`,
      [t, ...v, U.get('admin')!.id, U.get('admin')!.name])).rows[0].id as string;
    const scale = Math.max(1, Math.round(bm.total / 100000));
    const lg = await lot(['DEMO — Landfill gas capture (not real)', 'GS-DEMO-1', 'Gold Standard', 'AMS-III.G', 'avoidance', 'Landfill gas capture', 'India', 2024, 8000 * scale, 9.5, 'DEMO broker', '2025-11-10', 'delivered', '2025-12-01', 'DEMO-GS-0001…', true, false, false, null]);
    const mg = await lot(['DEMO — Mangrove restoration (not real)', 'VCS-DEMO-2', 'Verra (VCS)', 'VM0033', 'removal_nature', 'Blue carbon (mangroves)', 'Pakistan', 2023, 3000 * scale, 27, 'DEMO developer', '2025-10-02', 'delivered', '2025-10-20', 'DEMO-VCS-0002…', true, false, false, '40 years, 20% buffer pool']);
    const bc = await lot(['DEMO — Biochar from date-palm waste (not real)', 'PURO-DEMO-3', 'Puro.earth', 'Puro Biochar 2022', 'removal_technical', 'Biochar', 'United Arab Emirates', 2025, 1200 * scale, 140, 'DEMO producer', '2025-09-15', 'delivered', '2026-01-15', 'DEMO-PURO-0003…', false, false, false, '1,000+ years']);
    await lot(['DEMO — Direct air capture offtake (not real)', null, 'Isometric', 'Isometric DAC protocol', 'removal_technical', 'DACCS', 'Oman', 2029, 1500 * scale, 410, 'DEMO DAC company', '2026-03-01', 'contracted', null, null, false, false, false, '10,000+ years']);
    const ret = async (lotId: string, q: number, on: string, y: number, purpose: string, approved: boolean) => c.query(
      `INSERT INTO carbon_credit_retirement (tenant_id, lot_id, quantity, retired_on, claim_year, purpose, serials, beneficiary, note, status, proposed_by, proposed_name, proposed_at, decided_by, decided_name, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,'DEMO serials','DEMO group (not real)','DEMO',$7,$8,$9,now() - interval '30 days',$10,$11,CASE WHEN $7 = 'approved' THEN now() - interval '28 days' END)`,
      [t, lotId, q, on, y, purpose, approved ? 'approved' : 'pending', U.get('admin')!.id, U.get('admin')!.name, approved ? U.get('super_admin')!.id : null, approved ? U.get('super_admin')!.name : null]);
    await ret(lg, 6000 * scale, '2026-03-20', by, 'voluntary', true);
    await ret(mg, 2000 * scale, '2026-03-20', by, 'bvcm', true);
    await ret(bc, 400 * scale, '2026-03-20', by, 'voluntary', true);
    await ret(bc, 300 * scale, '2026-10-01', by + 1, 'neutralisation', false);
    const r = await remindTenant(c, t);
    console.log(`Carbon credits: 4 DEMO purchases, 3 retirements approved for ${by}, 1 waiting. Base year: 1 DEMO restatement applied (landfill method), 1 waiting for approval (acquisition). Metric registry: ${M.size} metrics, 3 changed (versions), 1 change waiting for approval. Calendar: reminders ${r.due_soon} due soon, ${r.overdue} overdue, ${r.escalated} escalated → ${r.people} DEMO notices (e-mail held: no mail server).`);
  });
  console.log('\nDemo logins (all with the same password, shown once):');
  for (const [name, email] of PEOPLE) console.log(`  ${email.padEnd(24)} ${name}`);
  console.log(`\n  Password: ${pw}\n`);
  console.log(`Waste contractor portal (/contractor, DEMO): collector@demo.example · access code ${ccode}\n`);
  if (sportal) console.log(`Supplier portal (/supplier, DEMO): ${sportal} · access code ${scode}\n`);
}

main().catch((e) => { console.error('Demo not created:', e.message); process.exitCode = 1; }).finally(() => pool.end());
