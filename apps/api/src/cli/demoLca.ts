/**
 * Product LCA demo (DEMO, not real): four product models built from the indicative library.
 *   Recycled aggregate        own product, published v1
 *   Crumb rubber from ELT     own product, waiting for review
 *   Recycled HDPE pellet      own product, draft, with a solar scenario
 *   Steel rebar               an invented supplier's product, published: its factor is used for purchases of rebar
 */
import type { Tx } from '../db/pool.js';
import { footprint, type Line } from '../lib/lca.js';
import { recalcSupplier } from '../modules/purchases/suppliers.routes.js';
import { normSupplier } from '../modules/purchases/fields.js';

type In = [name: string, stage: string, qty: number, unit: string, code: string | null, co2e: number | null, dq: string, source: string];

export async function demoLca(c: Tx, t: string) {
  const u = async (email: string) => (await c.query(`SELECT id, name FROM app_user WHERE tenant_id = $1 AND email = $2`, [t, email])).rows[0] as { id: string; name: string };
  const sa = await u('superadmin@beeah.demo'), ad = await u('admin@beeah.demo'), mg = await u('manager@beeah.demo');
  const lib = new Map((await c.query(`SELECT id, code, co2e::float8 AS co2e, unit FROM lci_factor WHERE tenant_id IS NULL`)).rows.map((r) => [r.code as string, r]));
  const year = new Date().getUTCFullYear() - 1;

  const make = async (p: { name: string; description: string; fu: string; supplierId?: string | null; status: string; inputs: In[]; notes?: string }) => {
    const id = (await c.query(
      `INSERT INTO lca_product (tenant_id, name, description, supplier_id, declared_unit, fu, ref_year, notes, status, created_by, created_name, last_edit_by, last_edit_name, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'t',$5,$6,$7,'draft',$8,$9,$8,$9, now() - interval '30 days', now() - interval '3 days') RETURNING id`,
      [t, p.name, p.description, p.supplierId ?? null, p.fu, year, p.notes ?? 'DEMO — invented model built from indicative factors', mg.id, mg.name])).rows[0].id as string;
    const ids: string[] = [];
    for (const [k, [name, stage, qty, unit, code, co2e, dq, source]] of p.inputs.entries()) {
      const f = code ? lib.get(code) : null;
      ids.push((await c.query(`INSERT INTO lca_input (tenant_id, product_id, position, name, stage, qty, unit, co2e_per_unit, lci_id, dq, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [t, id, k + 1, name, stage, qty, f?.unit ?? unit, co2e ?? f?.co2e ?? 0, f?.id ?? null, dq, source])).rows[0].id as string);
    }
    const L = (await c.query(`SELECT id, name, stage, qty::float8 AS qty, unit, co2e_per_unit::float8 AS co2e_per_unit, dq, lci_id, source FROM lca_input WHERE product_id = $1 ORDER BY position`, [id])).rows as Line[];
    const r = footprint(L, 'cradle_to_gate');
    if (p.status !== 'draft') await c.query(`UPDATE lca_product SET status = 'review', sent_by = $2, sent_name = $3, sent_at = now() - interval '2 days' WHERE id = $1`, [id, mg.id, mg.name]);
    if (p.status === 'published') {
      await c.query(`UPDATE lca_product SET verified_by = $2, verified_name = $3, verified_at = now() - interval '1 day' WHERE id = $1`, [id, ad.id, ad.name]);
      await c.query(`INSERT INTO lca_publication (tenant_id, product_id, version, factor, declared_unit, stages, inputs, dq, verified_name, published_name, published_at) VALUES ($1,$2,1,$3,'t',$4,$5,$6,$7,$8, now() - interval '1 day')`,
        [t, id, r.total, JSON.stringify(r.stages), JSON.stringify(r.lines.map(({ id: _i, share: _s, ...l }) => l)), r.dq, ad.name, sa.name]);
      let ef: string | null = null;
      if (p.supplierId) {
        ef = (await c.query(`INSERT INTO supplier_ef (tenant_id, supplier_id, co2e, unit, source, boundary, created_by, lca_product_id) VALUES ($1,$2,$3,'t',$4,'Cradle-to-gate',$5,$6) RETURNING id`,
          [t, p.supplierId, r.total, `Product LCA: ${p.name} v1 (ISO 14067 / GHG Protocol Product Standard, Cradle-to-gate, ${year}; verified by ${ad.name})`, sa.id, id])).rows[0].id;
      }
      await c.query(`UPDATE lca_product SET status = 'published', version = 1, published_factor = $2, published_at = now() - interval '1 day', published_name = $3, supplier_ef_id = $4 WHERE id = $1`, [id, r.total, sa.name, ef]);
    }
    return { id, ids, total: r.total };
  };

  const agg = await make({
    name: 'Recycled aggregate 0–40 mm (DEMO)', description: 'Crushed and screened construction & demolition waste, sold as road sub-base (DEMO, invented model).',
    fu: '1 tonne of recycled aggregate at the plant gate', status: 'published',
    inputs: [
      ['C&D waste feedstock (burden-free)', 'raw', 1050, 'kg', 'cd_waste', null, 'measured', 'Weighbridge records (DEMO)'],
      ['Electricity, UAE grid — crusher and screens', 'manufacturing', 4.2, 'kWh', 'grid', null, 'measured', 'Sub-meter (DEMO)'],
      ['Diesel, loaders and excavator', 'manufacturing', 1.1, 'litre', 'diesel', null, 'measured', 'Fuel log (DEMO)'],
      ['Water, dust suppression', 'manufacturing', 0.05, 'm³', 'water', null, 'estimated', 'Estimate (DEMO)'],
      ['Inbound haulage of C&D waste, 25 km', 'transport', 26.25, 't-km', 'road', null, 'estimated', '1.05 t × 25 km (DEMO)'],
    ],
  });
  await c.query(`INSERT INTO lca_scenario (tenant_id, product_id, name, changes, created_name) VALUES ($1,$2,'Electric loader instead of diesel',$3,$4)`,
    [t, agg.id, JSON.stringify([{ inputId: agg.ids[2], qty: 0 }, { inputId: agg.ids[1], qty: 9.5 }]), mg.name]);

  await make({
    name: 'Crumb rubber from end-of-life tyres (DEMO)', description: 'Granulated rubber 1–4 mm for sports surfaces and asphalt (DEMO, invented model).',
    fu: '1 tonne of crumb rubber at the plant gate', status: 'review',
    inputs: [
      ['End-of-life tyres feedstock (burden-free)', 'raw', 1150, 'kg', 'elt', null, 'measured', 'Gate records (DEMO)'],
      ['Electricity, UAE grid — shredders and granulators', 'manufacturing', 380, 'kWh', 'grid', null, 'measured', 'Sub-meter (DEMO)'],
      ['Diesel, yard machinery', 'manufacturing', 3, 'litre', 'diesel', null, 'estimated', 'Share of site fuel (DEMO)'],
      ['Woven PP bulk bag', 'packaging', 1, 'unit', 'bag', null, 'supplier', 'Supplier data (DEMO)'],
      ['Tyre collection, 40 km', 'transport', 46, 't-km', 'road', null, 'estimated', '1.15 t × 40 km (DEMO)'],
    ],
  });

  const hdpe = await make({
    name: 'Recycled HDPE pellet (DEMO)', description: 'Washed, extruded HDPE pellet from post-consumer bottles and drums (DEMO, invented model).',
    fu: '1 tonne of HDPE pellet at the plant gate', status: 'draft',
    inputs: [
      ['Post-consumer HDPE bales (burden-free)', 'raw', 1250, 'kg', null, 0, 'measured', 'Cut-off approach: waste enters burden-free (DEMO)'],
      ['Electricity, UAE grid — washing line and extruder', 'manufacturing', 650, 'kWh', 'grid', null, 'measured', 'Sub-meter (DEMO)'],
      ['Water, desalinated — washing', 'manufacturing', 2, 'm³', 'water', null, 'estimated', 'Estimate (DEMO)'],
      ['LDPE film, pallet wrap', 'packaging', 2, 'kg', 'film', null, 'estimated', 'Estimate (DEMO)'],
      ['Bale collection, 60 km', 'transport', 75, 't-km', 'road', null, 'estimated', '1.25 t × 60 km (DEMO)'],
    ],
  });
  await c.query(`INSERT INTO lca_scenario (tenant_id, product_id, name, changes, created_name) VALUES ($1,$2,'On-site solar for the line',$3,$4)`,
    [t, hdpe.id, JSON.stringify([{ inputId: hdpe.ids[1], lciId: lib.get('solar')!.id }]), mg.name]);

  // the supplier's product: purchases of rebar move to an invented supplier, whose published footprint becomes its factor
  const sname = 'Desert Rebar Mills (DEMO, not real)';
  const sid = (await c.query(`INSERT INTO supplier (tenant_id, name, norm, country, origin, note) VALUES ($1,$2,$3,'AE','manual','DEMO — invented supplier') RETURNING id`, [t, sname, normSupplier(sname)])).rows[0].id as string;
  await c.query(`UPDATE purchase_line SET supplier_id = $2 WHERE tenant_id = $1 AND description ILIKE 'Steel rebar%'`, [t, sid]);
  const reb = await make({
    name: 'Steel rebar B500B (DEMO)', description: `Hot-rolled reinforcing bar from ${sname}, modelled with the supplier (DEMO, invented model).`,
    fu: '1 tonne of rebar at the mill gate', status: 'published', supplierId: sid,
    inputs: [
      ['Steel scrap melted in EAF', 'raw', 1080, 'kg', 'steel_r', null, 'supplier', 'Supplier mill data (DEMO)'],
      ['Electricity, UAE grid — rolling mill', 'manufacturing', 120, 'kWh', 'grid', null, 'supplier', 'Supplier mill data (DEMO)'],
      ['LPG, reheating furnace', 'manufacturing', 25, 'litre', 'lpg', null, 'supplier', 'Supplier mill data (DEMO)'],
      ['Scrap delivery, 150 km', 'transport', 150, 't-km', 'road', null, 'estimated', '1 t × 150 km (DEMO)'],
    ],
  });
  const lines = await recalcSupplier(c, t, [sid], sa.id);
  console.log(`Product LCA: 4 DEMO models (aggregate ${agg.total.toFixed(1)} kg/t published, crumb rubber in review, HDPE pellet draft, rebar ${reb.total.toFixed(0)} kg/t published as a supplier factor, ${lines} purchase lines recalculated).`);
}
