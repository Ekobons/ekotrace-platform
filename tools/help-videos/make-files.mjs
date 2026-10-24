// Makes the specimen files the help videos upload. Every file is invented: a fictional
// utility ("Harbourline Power & Water"), made-up figures, and marked DEMO / SPECIMEN.
//   node tools/help-videos/make-files.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const req = createRequire(join(here, '../../apps/api/package.json'));
const { PDFDocument, StandardFonts, rgb, degrees } = req('pdf-lib');

export const ACCOUNT = 'HPW-7730-4412';
const out = join(here, 'files'); mkdirSync(out, { recursive: true });
const dd = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const fmt = (n) => n.toLocaleString('en-US');

const usage = { 7: 41250, 8: 43980, 9: 39410 };
let reading = 1_284_500;
for (const [m, kwh] of Object.entries(usage).map(([m, k]) => [Number(m), k])) {
  const from = new Date(Date.UTC(2026, m - 1, 1)), to = new Date(Date.UTC(2026, m, 0)), issued = new Date(Date.UTC(2026, m, 6));
  const prev = reading; reading += kwh;
  const doc = await PDFDocument.create();
  doc.setTitle('DEMO specimen bill — fictional utility — not real'); doc.setProducer('Ekotrace help videos (DEMO)');
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: rgb(0.13, 0.36, 0.55) });
  page.drawText('Harbourline Power & Water (fictional)', { x: 40, y: 806, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText('DEMO / SPECIMEN - NOT A REAL BILL', { x: 40, y: 786, size: 9, font: bold, color: rgb(1, 0.92, 0.6) });
  let y = 740;
  const row = (a, b, f = font) => { page.drawText(a, { x: 40, y, size: 10, font }); page.drawText(b, { x: 300, y, size: 10, font: f }); y -= 18; };
  const head = (s) => { y -= 6; page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 18, color: rgb(0.87, 0.91, 0.95) }); page.drawText(s, { x: 40, y, size: 11, font: bold }); y -= 22; };
  page.drawText('TAX INVOICE', { x: 40, y, size: 12, font: bold }); y -= 24;
  row('Account No:', ACCOUNT);
  row('Bill No:', `HPW-26-${String(m).padStart(2, '0')}0457`);
  row('Bill Date:', dd(issued));
  row('Billing Period:', `${dd(from)} - ${dd(to)}`);
  row('Premises:', 'Al Qusais Packaging Plant (demo)');
  head('Electricity');
  row('Previous Reading', fmt(prev));
  row('Current Reading', fmt(reading));
  row('Consumption', `${fmt(kwh)} kWh`);
  row('Rate', '0.38 AED/kWh');
  row('Total Amount Due', `AED ${fmt(Math.round(kwh * 0.38 * 1.05 * 100) / 100)}`, bold);
  page.drawText('DEMO - SPECIMEN', { x: 110, y: 260, size: 64, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
  page.drawText('Made up for the Ekotrace help videos. The utility is fictional; no real bill. Do not use for reporting.', { x: 40, y: 36, size: 7.5, font, color: rgb(0.6, 0.1, 0.1) });
  const name = `Harbourline-${ACCOUNT}-2026-${String(m).padStart(2, '0')}.pdf`;
  writeFileSync(join(out, name), await doc.save());
  console.log(name);
}

// A small purchase export (made up; the suppliers are fictional) for the purchases video.
{
  const L = [
    ['Gulfcrest Packaging LLC', 'Corrugated cartons 5-ply 600x400', 'Packaging materials', '510300 Materials', 84500],
    ['Polymera Trading FZE', 'PET resin granules 25 kg bags', 'Raw materials - polymers', '510100 Raw materials', 162000],
    ['Gulfcrest Packaging LLC', 'Stretch film 23 micron rolls', 'Packaging materials', '510300 Materials', 18400],
    ['Inkwell Industrial Supplies', 'Flexo printing inks', 'Chemicals', '510200 Consumables', 22600],
    ['Palmwood Pallets', 'Wooden pallets 1200x1000', 'Packaging materials', '510300 Materials', 31500],
    ['Deskline Office Co.', 'Office stationery', 'Office supplies', '620100 Office', 3900],
    ['Sandline Freight', 'Inbound freight Jebel Ali to Al Qusais', 'Logistics', '540200 Freight', 12800],
    ['Watchpoint Security Services', 'Security guarding services', 'Facility services', '560100 Services', 21000],
    ['Saffron Catering', 'Staff canteen catering', 'Facility services', '560100 Services', 17500],
  ];
  const rows = [['Invoice date', 'Supplier', 'Description', 'Category', 'GL account', 'Amount', 'Currency', 'Facility']];
  for (const [m, f] of [['07', 1], ['08', 1.06], ['09', 0.97]])
    L.forEach(([s, d, c, gl, a], i) => rows.push([`${String(3 + i * 3).padStart(2, '0')}/${m}/2026`, s, d, c, gl, Math.round(a * f), 'AED', 'Al Qusais Packaging Plant']));
  rows.push([`28/09/2026`, 'Lumenbyte IT Solutions', 'Laptops for production planning team (6 units)', 'IT equipment', '150200 Fixed assets - IT', 46000, 'AED', 'Al Qusais Packaging Plant']);
  const csv = rows.map((r) => r.map((x) => (/[",]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(',')).join('\n') + '\n';
  writeFileSync(join(out, 'Purchases-Q3-2026-DEMO.csv'), csv);
  console.log('Purchases-Q3-2026-DEMO.csv');
}

// A site report in the company's own layout (made up) for the smart import video.
{
  const ExcelJS = req('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Q3 site data');
  ws.addRow(['DEMO — Al Qusais plant, monthly utilities & consumables log (made up)']);
  ws.addRow([]);
  ws.addRow(['Site', 'Month', 'Item', 'Qty', 'UoM', 'Remarks']);
  const items = [['Diesel - standby generator', [1250, 980, 1430], 'litres', 'fuel log'], ['LPG forklifts', [610, 585, 640], 'kg', 'cylinder delivery notes'],
    ['Refrigerant top-up R-410A', [0, 4.5, 0], 'kg', 'AC service report'], ['Municipal water', [1840, 1920, 1785], 'm3', 'water bill'],
    ['General waste to landfill', [6.2, 5.8, 6.6], 'tonnes', 'hauler tickets'], ['Cardboard recycled', [11.4, 12.1, 10.9], 'tonnes', 'recycler receipts']];
  for (const [it, q, u, r] of items) ['Jul-2026', 'Aug-2026', 'Sep-2026'].forEach((m, i) => { if (q[i]) ws.addRow(['Al Qusais Packaging Plant', m, it, q[i], u, r]); });
  ws.getRow(3).font = { bold: true }; ws.columns.forEach((c, i) => { c.width = [28, 11, 30, 9, 9, 24][i]; });
  await wb.xlsx.writeFile(join(out, 'Site-log-Q3-2026-DEMO.xlsx'));
  console.log('Site-log-Q3-2026-DEMO.xlsx');
}
