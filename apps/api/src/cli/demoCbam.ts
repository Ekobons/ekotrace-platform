/**
 * CBAM demo (DEMO, not real):
 *  - producer side: the recycling complex's aluminium line as a CBAM installation with two processes
 *    (secondary unwrought aluminium, aluminium extrusions) and a 2026 report in draft with invented figures
 *  - importer side: 2026 import lines (steel billets, clinker, urea, aluminium from the own installation)
 *  - illustrative default values and benchmarks for the demo company only, marked as such
 */
import type { Tx } from '../db/pool.js';

export async function demoCbam(c: Tx, t: string) {
  const fac = (await c.query(`SELECT id FROM org_node WHERE tenant_id = $1 AND kind = 'facility' AND name ILIKE 'Al Saja%Recycling%' LIMIT 1`, [t])).rows[0]?.id ?? null;
  const co = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [t])).rows[0].name as string;
  const inst = (await c.query(
    `INSERT INTO cbam_installation (tenant_id, facility_id, name, registry_id, unlocode, address, city, country, lat, lon, operator_name, operator_reg, operator_address, operator_country, contact_name, contact_email, notes, created_name)
     VALUES ($1,$2,'Aluminium recovery line (DEMO)','DEMO-AE-0001 (not real)','AE SHJ','DEMO address, Al Saja''a industrial area','Sharjah','AE',25.329000,55.645000,$3,'DEMO-TL-000000','DEMO address, Sharjah','AE','DEMO Contact','cbam@demo.example','DEMO — invented installation for the CBAM walkthrough','demo') RETURNING id`,
    [t, fac, `${co}`])).rows[0].id as string;
  const proc = async (category: string, route: string, name: string) => (await c.query(`INSERT INTO cbam_process (tenant_id, installation_id, category, route, name) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [t, inst, category, route, name])).rows[0].id as string;
  const p1 = await proc('unwrought_aluminium', 'Secondary melting (recycling)', 'Secondary aluminium remelt (DEMO)');
  const p2 = await proc('aluminium_products', '', 'Extrusion press (DEMO)');
  const rep = (await c.query(`INSERT INTO cbam_report (tenant_id, installation_id, year, period_start, period_end, elec_ef, elec_ef_source, monitoring_plan, notes, updated_name)
     VALUES ($1,$2,2026,'2026-01-01','2026-12-31',0.4041,'DEMO — indicative UAE grid factor; use the factor required by IR 2025/2547 Annex III','DEMO monitoring plan v1','No measurable heat flows, waste gases or CO2 capture (DEMO).','demo') RETURNING id`, [t, inst])).rows[0].id as string;
  const line = async (p: string, a: number, d: number, e: number, params: Record<string, string>) =>
    (await c.query(`INSERT INTO cbam_report_line (tenant_id, report_id, process_id, activity_t, direct_t, elec_mwh, default_share, params) VALUES ($1,$2,$3,$4,$5,$6,0,$7) RETURNING id`, [t, rep, p, a, d, e, JSON.stringify(params)])).rows[0].id as string;
  const l1 = await line(p1, 12000, 2400, 9600, { scrap_t: '1.05', pre_consumer_scrap: '35', alloys: '' });
  const l2 = await line(p2, 5000, 450, 4000, { scrap_t: '0', pre_consumer_scrap: '0', alloys: '' });
  await c.query(`INSERT INTO cbam_good (tenant_id, line_id, cn, description, quantity_t) VALUES ($1,$2,'76012000','Unwrought aluminium alloys',6900),($1,$3,'76042100','Hollow profiles of aluminium alloys',5000)`, [t, l1, l2]);
  // the extrusion press uses the remelt's own billets: their embedded emissions are added (direct 0.20, indirect 0.32 t/t)
  await c.query(`INSERT INTO cbam_precursor (tenant_id, line_id, category, cn, origin, quantity_t, see_direct, see_indirect, source, supplier, installation_ref, period)
                 VALUES ($1,$2,'unwrought_aluminium','76012000','AE',5100,0.20,0.3233,'actual','Own remelt (DEMO)','DEMO-AE-0001','2026')`, [t, l2]);

  // illustrative references for the demo company (not the official values)
  const src = 'DEMO — illustrative value, replace with the official value (IR (EU) 2025/2621 defaults, IR (EU) 2025/2620 benchmarks)';
  for (const [kind, cn, ctry, v] of [['default', '7207', 'TR', 2.31], ['default', '25231000', 'TR', 1.41], ['default', '310210', 'EG', 1.25], ['default', '7601', null, 8.2],
    ['benchmark', '7207', null, 1.364], ['benchmark', '25231000', null, 0.693], ['benchmark', '310210', null, 0.548], ['benchmark', '7601', null, 1.464], ['benchmark', '7604', null, 1.464]] as [string, string, string | null, number][])
    await c.query(`INSERT INTO cbam_reference (tenant_id, kind, cn, country, year, value, source, indicative, created_name) VALUES ($1,$2,$3,$4,2026,$5,$6,true,'demo')`, [t, kind, cn, ctry, v, src]);

  const imp = async (d: string, cn: string, desc: string, origin: string, mass: number, sup: string, src2: string, extra: Record<string, unknown> = {}) =>
    c.query(`INSERT INTO cbam_import (tenant_id, year, import_date, quarter, cn, description, origin, mass, procedure, supplier, installation, installation_id_reg, route, source, see_direct, see_indirect, verifier_ref, report_id, created_name)
             VALUES ($1,2026,$2,$3,$4,$5,$6,$7,'40',$8,$9,$10,$11,$12,$13,$14,$15,$16,'demo')`,
      [t, d, Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1, cn, desc, origin, mass, sup, extra.installation ?? null, extra.reg ?? null, extra.route ?? null, src2, extra.dir ?? null, extra.ind ?? null, extra.ver ?? null, extra.report ?? null]);
  await imp('2026-02-11', '72071114', 'Billets of non-alloy steel (DEMO)', 'TR', 1200, 'Anatolia Steel (DEMO, not real)', 'default');
  await imp('2026-05-20', '72071114', 'Billets of non-alloy steel (DEMO)', 'TR', 800, 'Anatolia Steel (DEMO, not real)', 'actual', { installation: 'Anatolia mill (DEMO)', reg: 'DEMO-TR-0042', route: 'Electric arc furnace', dir: 0.62, ind: 0.21, ver: 'DEMO Verification (not real), 2026-04-30' });
  await imp('2026-03-03', '25231000', 'Grey cement clinker (DEMO)', 'TR', 5000, 'Marmara Cement (DEMO, not real)', 'default');
  await imp('2026-07-15', '31021010', 'Urea (DEMO)', 'EG', 2500, 'Nile Fertilisers (DEMO, not real)', 'default');
  await imp('2026-08-28', '76012000', 'Unwrought aluminium alloys — from our own line (DEMO)', 'AE', 900, co, 'actual', { installation: 'Aluminium recovery line (DEMO)', reg: 'DEMO-AE-0001 (not real)', route: 'Secondary melting (recycling)', dir: 0.2, ind: 0.3233, report: rep });
  console.log('CBAM: 1 DEMO installation with a 2026 report in draft, 5 DEMO import lines for 2026, illustrative default values and benchmarks (DEMO, not official).');
}
