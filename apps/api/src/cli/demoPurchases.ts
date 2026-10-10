/**
 * Demo purchases (made up): two ERP exports for 2025 in one layout — Jan–Jun reviewed and
 * published, Jul–Dec uploaded and waiting for review (remembered decisions already applied,
 * a few new descriptions, a cost centre written differently, EUR lines without a rate).
 * Spend factors: the DEMO placeholder file unless the real EPA file is loaded.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { normText } from '@ekotrace/calc';
import { platformTx, tenantTx } from '../db/pool.js';
import { importEpa, parseEpa } from '../import/epa.js';
import { drainJobs, enqueue } from '../lib/jobs.js';
import type { User } from '../lib/auth.js';
import { calcLines, publishBatch } from '../modules/purchases/pipeline.js';
import { signature } from '../modules/purchases/fields.js';
import '../modules/purchases/purchases.routes.js'; // registers the background job handlers

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../../../data');
const OFFICE = ['BEEAH Headquarters', 'Al Zahia Community'];
const PLANTS = ['Sharjah Waste-to-Energy', "Al Saja'a Recycling Complex"];
const SITES = [...PLANTS, "Al Saja'a Landfill", 'Fleet Depot Sharjah'];
const ALL = [...OFFICE, ...SITES, 'Data Centre Dubai'];
// description, category, GL account, vendor, AED per line (or [qty, unit, AED per unit]), facilities, lines a month, currency
type P = [string, string, string, string, number | [number, string, number], string[], number, string?];
const CATALOGUE: P[] = [
  ['A4 copier paper 80gsm', 'Office supplies', 'Office expenses', 'Gulf Stationery LLC', 850, OFFICE, 4],
  ['Printer toner cartridges', 'Office supplies', 'Office expenses', 'Gulf Stationery L.L.C.', 1400, OFFICE, 2],
  ['Laptop Dell Latitude 7450', 'IT hardware', 'IT equipment', 'Tech Distribution FZE', 6900, ALL, 2],
  ['Microsoft 365 E3 licences', 'Software', 'IT subscriptions', 'Microsoft Ireland Operations', 2400, ['BEEAH Headquarters'], 1, 'EUR'],
  ['Cloud hosting monthly', 'IT services', 'IT subscriptions', 'Amazon Web Services EMEA', 3800, ['Data Centre Dubai'], 1, 'USD'],
  ['Mobile and data plans', 'Telecom', 'Telephone', 'Emirates Integrated Telecommunications', 5200, ALL, 1],
  ['Internet leased line', 'Telecom', 'Telephone', 'Etisalat', 7800, ['BEEAH Headquarters', 'Data Centre Dubai'], 1],
  ['OPC cement 50kg bags', 'Construction materials', 'Materials', 'Emirates Cement LLC', [40, 't', 380], ["Al Saja'a Landfill", "Al Saja'a Recycling Complex"], 3],
  ['Ready mix concrete C40', 'Construction materials', 'Materials', 'Unibeton Ready Mix', [60, 'm3', 290], ["Al Saja'a Landfill"], 2],
  ['Steel rebar 16mm', 'Construction materials', 'Materials', 'Emirates Steel', [12, 't', 2900], ["Al Saja'a Recycling Complex"], 1],
  ['Safety gloves and PPE', 'PPE', 'Health & safety', 'Al Masaood Safety', 2200, SITES, 3],
  ['Staff uniforms', 'PPE', 'Staff costs', 'Uniform House Trading', 4500, SITES, 1],
  ['Truck tyres 315/80R22.5', 'Fleet spares', 'Fleet maintenance', 'Michelin Middle East', 9600, ['Fleet Depot Sharjah'], 3],
  ['Vehicle spare parts', 'Fleet spares', 'Fleet maintenance', 'Al Futtaim Auto', 3100, ['Fleet Depot Sharjah'], 8],
  ['Engine oil 15W-40', 'Fleet spares', 'Fleet maintenance', 'ENOC Lubricants', 2700, ['Fleet Depot Sharjah'], 2],
  ['Diesel for generators', 'Fuel', 'Fuel', 'ADNOC Distribution', 18500, PLANTS, 2],
  ['Airfare business travel', 'Travel', 'Travel expenses', 'Emirates', 4200, OFFICE, 6],
  ['Hotel accommodation', 'Travel', 'Travel expenses', 'Marriott Hotels', 2300, OFFICE, 5],
  ['Taxi and ride hailing', 'Travel', 'Travel expenses', 'Careem', 180, ALL, 12],
  ['Courier charges', 'Logistics', 'Freight & courier', 'Aramex', 260, ALL, 8],
  ['Freight container haulage', 'Logistics', 'Freight & courier', 'Gulf Logistics LLC', 6400, PLANTS, 3],
  ['Consultancy fees strategy', 'Professional services', 'Consulting', 'Advisory Partners FZ', 45000, ['BEEAH Headquarters'], 1],
  ['External audit fees', 'Professional services', 'Audit fees', 'Big Four Audit LLP', 38000, ['BEEAH Headquarters'], 1],
  ['Legal fees', 'Professional services', 'Legal', 'Al Tamimi Advocates', 16000, ['BEEAH Headquarters'], 1],
  ['Office cleaning contract', 'Facility services', 'Facility management', 'Emrill Services', 12500, OFFICE, 1],
  ['Security guards monthly', 'Facility services', 'Facility management', 'Transguard Group', 21000, ALL, 1],
  ['Staff catering', 'Facility services', 'Staff welfare', 'Gulf Catering Co', 9800, [...PLANTS, 'BEEAH Headquarters'], 2],
  ['Landscaping maintenance', 'Facility services', 'Facility management', 'Green Oasis Landscaping', 7600, ['Al Zahia Community'], 1],
  ['Skip hire and waste collection', 'Facility services', 'Facility management', 'Tadweer Services', 3400, OFFICE, 1],
  ['Office rent Al Khan tower', 'Rent', 'Rent', 'Al Khan Properties', 85000, ['BEEAH Headquarters'], 1],
  ['Property insurance premium', 'Insurance', 'Insurance', 'Orient Insurance', 26000, ['BEEAH Headquarters'], 1],
  ['Advertising campaign', 'Marketing', 'Marketing', 'Publicis Middle East', 32000, ['BEEAH Headquarters'], 1],
  ['Training course ISO 14064', 'Training', 'Training', 'Learning Hub Training', 5500, ['BEEAH Headquarters'], 1],
  ['First aid and medical supplies', 'Health', 'Health & safety', 'Life Pharmacy', 900, SITES, 2],
  ['Office chairs', 'Furniture', 'Office furniture', 'Royal Furniture LLC', 3800, OFFICE, 1],
  ['HVAC maintenance contract', 'Facility services', 'Repairs & maintenance', 'Emirates Facilities Management', 8900, [...OFFICE, 'Data Centre Dubai'], 1],
  ['Electricity DEWA', 'Utilities', 'Utilities', 'DEWA', 64000, ['Data Centre Dubai'], 1],
  ['Bottled drinking water', 'Pantry', 'Staff welfare', 'Masafi', 650, ALL, 2],
];
// Jul–Dec only: new kinds of purchase the remembered mappings do not know yet
const NEW_H2: P[] = [
  ['Solar panels 550W for site office', 'Capital projects', 'Capital WIP', 'Sun Power Trading', 48000, ["Al Saja'a Recycling Complex"], 1],
  ['Drone survey services', 'Professional services', 'Survey', 'Falcon Eye Drones', 14000, ["Al Saja'a Landfill"], 1],
  ['Conference fee London', 'Training', 'Training', 'Climate Week Ltd', 1800, ['BEEAH Headquarters'], 1, 'GBP'],
  ['Membership Emirates Green Building Council', 'Memberships', 'Subscriptions', 'Emirates GBC', 7500, ['BEEAH Headquarters'], 1],
];
const HEADERS = ['PO Number', 'Line', 'Order Date', 'Item Description', 'Category Name', 'Account Description', 'Vendor Name', 'Qty', 'UOM', 'Line Amount', 'Currency', 'Cost Centre'];

/** A seeded random number generator (the demo is the same every time). */
function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

async function exportFile(months: number[], extra: P[], seed: number): Promise<{ buf: Buffer; lines: number }> {
  const r = rng(seed);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PO lines');
  ws.addRow(['BEEAH Group — purchase order lines (DEMO, made up)']);
  ws.addRow(HEADERS);
  let po = 4500000 + seed * 1000, n = 0;
  for (const m of months) {
    for (const p of [...CATALOGUE, ...extra]) {
      const [desc, cat, gl, vendor, price, facs, perMonth, cur] = p;
      for (let k = 0; k < perMonth; k++) {
        const fac = facs[Math.floor(r() * facs.length)]!;
        const day = 1 + Math.floor(r() * 27);
        const f = 0.6 + r() * 0.8;
        let qty: number | null = null, uom: string | null = null, amount: number;
        if (Array.isArray(price)) { qty = Math.round(price[0] * f * 10) / 10; uom = price[1]; amount = Math.round(qty * price[2] * 100) / 100; }
        else amount = Math.round(price * f * 100) / 100;
        const site = fac === 'BEEAH Headquarters' && months[0]! >= 6 && r() < 0.3 ? 'HQ Sharjah' : fac; // H2: written differently sometimes
        ws.addRow([po++, 1, new Date(Date.UTC(2025, m, day)), desc, cat, gl, vendor, qty, uom, amount, cur ?? 'AED', site]);
        n++;
      }
    }
    if (m === 2 || m === 8) { ws.addRow([po++, 1, new Date(Date.UTC(2025, m, 20)), 'A4 copier paper 80gsm (credit note)', 'Office supplies', 'Office expenses', 'Gulf Stationery LLC', null, null, -420, 'AED', 'BEEAH Headquarters']); n++; }
  }
  if (months.includes(3)) { ws.addRow([po++, 1, new Date(Date.UTC(2025, 3, 14)), 'Excavator Caterpillar 320', 'Machinery', 'Capital WIP', 'Al Bahar Caterpillar', 1, 'pcs', 612000, 'AED', "Al Saja'a Landfill"]); n++; }
  return { buf: Buffer.from(await wb.xlsx.writeBuffer()), lines: n };
}

export async function demoPurchases(t: string, superAdmin: User) {
  // factors: the real EPA file when loaded, else the demo placeholders
  const real = (await platformTx((c) => c.query(`SELECT 1 FROM factor_source WHERE code LIKE 'EPA-SC-%'`))).rowCount;
  if (!real) {
    const p = parseEpa(readFileSync(join(DATA, 'epa', 'DEMO_placeholder_factors_USD2022.csv'), 'utf8'), 'DEMO_placeholder_factors_USD2022.csv');
    await platformTx((c) => importEpa(c, p, { demo: true, createdBy: 'demo' }));
  }
  await tenantTx(t, async (c) => {
    // DEMO exchange rates (company's own): EUR Jan–Jun 2025 only, GBP 2025 average
    const eur = [0.962, 0.958, 0.925, 0.893, 0.887, 0.869];
    for (const [i, v] of eur.entries()) await c.query(`INSERT INTO fx_rate (tenant_id, currency, kind, period, per_usd, source) VALUES ($1, 'EUR', 'month', $2, $3, 'DEMO rate (not real)')`, [t, `2025-${String(i + 1).padStart(2, '0')}-01`, v]);
    await c.query(`INSERT INTO fx_rate (tenant_id, currency, kind, period, per_usd, source) VALUES ($1, 'GBP', 'year', '2025-01-01', 0.76, 'DEMO rate (not real)')`, [t]);
    // a supplier with its own factor (EPD, per tonne of cement)
    const s = (await c.query(`INSERT INTO supplier (tenant_id, name, norm, reference, origin) VALUES ($1, 'Emirates Cement LLC', 'emirates cement', 'V-10023', 'manual') RETURNING id`, [t])).rows[0].id;
    await c.query(`INSERT INTO supplier_ef (tenant_id, supplier_id, co2e, unit, source, boundary) VALUES ($1, $2, 840, 't', 'DEMO EPD (not real): OPC cement, cradle to gate', 'cradle-to-gate')`, [t, s]);
  });
  const columns = { date: 'Order Date', description: 'Item Description', category: 'Category Name', gl: 'Account Description', supplier: 'Vendor Name', quantity: 'Qty', unit: 'UOM', amount: 'Line Amount', currency: 'Currency', facility: 'Cost Centre', po: 'PO Number' };
  const upload = async (name: string, file: { buf: Buffer }) => tenantTx(t, async (c) => {
    const sha = createHash('sha256').update(file.buf).digest('hex');
    const doc = (await c.query(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1, 'purchases', $2, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $3, $4, $5, $6) RETURNING id`,
      [t, `${name}.xlsx`, file.buf.length, sha, file.buf, superAdmin.id])).rows[0].id;
    const settings = { kind: 'xlsx', headerRow: 1, columns, dateFormat: 'dmy', currency: 'AED', facilityId: null, period: null };
    const b = (await c.query(`INSERT INTO purchase_batch (tenant_id, source, name, document_id, settings, status, created_by) VALUES ($1, 'upload', $2, $3, $4, 'queued', $5) RETURNING id`,
      [t, name, doc, JSON.stringify(settings), superAdmin.id])).rows[0].id;
    await c.query(`INSERT INTO purchase_profile (tenant_id, name, signature, settings) VALUES ($1, 'ERP purchase order lines', $2, $3) ON CONFLICT (tenant_id, signature) DO NOTHING`,
      [t, signature(HEADERS), JSON.stringify(settings)]);
    await enqueue(c, t, 'purchase_ingest', b, {}, superAdmin.id);
    return b as string;
  });
  // what a reviewer decided on the first file (remembered for the next one)
  const decide = async (batch: string, like: string, d: { decision?: string; target?: string; capital?: boolean; item?: string }) => tenantTx(t, async (c) => {
    const item = d.item ? (await c.query('SELECT id FROM item WHERE code = $1', [d.item])).rows[0]?.id ?? null : null;
    const g = await c.query(`UPDATE purchase_group SET decision = coalesce($3, decision), target = $4, capital = coalesce($5, capital), updated_by = $6,
                                    item_id = coalesce($7, item_id), map_method = CASE WHEN $7::int IS NULL THEN map_method ELSE 'manual' END, confidence = CASE WHEN $7::int IS NULL THEN confidence ELSE 1 END
                              WHERE batch_id = $1 AND description ILIKE $2 RETURNING description`,
      [batch, like, d.decision ?? null, d.target ?? null, d.capital ?? null, superAdmin.id, item]);
    for (const r of g.rows) await c.query(`INSERT INTO purchase_rule (tenant_id, field, pattern, item_id, decision, target, capital, created_by) VALUES ($1, 'text', $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, field, pattern) DO NOTHING`,
      [t, normText(r.description), item, d.decision ?? null, d.target ?? null, d.capital ?? null, superAdmin.id]);
  });

  const h1 = await upload('ERP purchase orders Jan–Jun 2025', await exportFile([0, 1, 2, 3, 4, 5], [], 1));
  await drainJobs();
  for (const like of ['Airfare%', 'Hotel%', 'Taxi%']) await decide(h1, like, { decision: 'move', target: 'business_travel' });
  for (const like of ['Courier%', 'Freight%']) await decide(h1, like, { decision: 'move', target: 'upstream_transport' });
  await decide(h1, 'Office rent%', { decision: 'move', target: 'upstream_leased' });
  for (const like of ['Diesel%', 'Electricity%', 'Skip hire%']) await decide(h1, like, { decision: 'exclude' });
  for (const like of ['Engine oil%', 'Bottled%']) await decide(h1, like, { decision: 'keep' });
  for (const like of ['Excavator%']) await decide(h1, like, { decision: 'keep', capital: true });
  for (const like of ['Laptop%', 'Office chairs%', 'HVAC%']) await decide(h1, like, { decision: 'keep' });
  // categories a reviewer chose by hand (the placeholder list is short; the EPA list has closer ones, e.g. 336390 motor vehicle parts)
  await decide(h1, 'Truck tyres%', { item: 'epa:naics:326211' });
  await decide(h1, 'Landscaping%', { item: 'epa:naics:561730' });
  await decide(h1, 'Vehicle spare parts%', { item: 'epa:naics:811111' });
  await decide(h1, 'Excavator%', { item: 'epa:naics:333120' });
  const r1 = await tenantTx(t, async (c) => { await calcLines(c, h1); return publishBatch(c, t, h1, superAdmin); });
  const h2 = await upload('ERP purchase orders Jul–Dec 2025', await exportFile([6, 7, 8, 9, 10, 11], NEW_H2, 2));
  await drainJobs();
  const counts = await tenantTx(t, async (c) => (await c.query(`SELECT status, count(*)::int AS n FROM purchase_line WHERE batch_id = $1 GROUP BY 1 ORDER BY 1`, [h2])).rows);
  console.log(`Purchases: Jan–Jun 2025 published (${r1.lines} lines → ${r1.entries} entries, ${(r1.co2e / 1000).toFixed(0)} tCO2e${real ? '' : ', DEMO placeholder factors'}); Jul–Dec to review (${counts.map((x) => `${x.n} ${x.status}`).join(', ')}).`);
}
