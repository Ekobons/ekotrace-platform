/**
 * Test files for trying the platform at scale (all made up — DEMO, not real data):
 *
 *   purchases-10k-2026.xlsx   10,000 purchase lines, Jan–Sep 2026, in an SAP-like export layout:
 *                             ~200 invented suppliers, vendor numbers on most lines, the same
 *                             supplier written several ways on the rest (to show duplicate
 *                             detection), supplier countries, AED/USD/EUR/GBP/INR/SAR, credit
 *                             notes, repeated lines, unknown cost centres, capital items, travel.
 *   bills/*.pdf               DEMO electricity and district-cooling bills (SEWA, DEWA and
 *                             Empower-like layouts) for the demo company's utility accounts,
 *                             every page marked "DEMO / SPECIMEN — NOT A REAL BILL".
 *
 *   npx tsx src/cli/makeTestFiles.ts [out-dir]        (default ./test-files)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';

function rng(seed: number) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const r = rng(20260930);
const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
/** Index with a long tail: a few suppliers get most of the lines, as in real spend. */
const zipf = (n: number) => Math.min(n - 1, Math.floor(n * Math.pow(r(), 2.2)));

// ------------------------------------------------------------------- suppliers --
const PREFIX = ['Gulf', 'Al Noor', 'Al Rashid', 'Desert Rose', 'Falcon', 'Pearl', 'Oasis', 'Crescent', 'Union', 'Al Fajer', 'Zenith', 'Atlas', 'Bright Star',
  'Al Qasba', 'Horizon', 'Sahara', 'Al Wahda', 'Palm', 'Marina', 'Al Buhaira', 'Coral', 'Mirage', 'Al Khaleej', 'Silver Line', 'Corniche', 'Dune', 'Al Majaz', 'Saffron'];
const SUFFIX = ['LLC', 'Trading LLC', 'FZE', 'FZCO', 'Co. LLC', 'Est.', 'General Trading LLC', 'Services LLC'];
type Sector = 'stationery' | 'it' | 'telecom' | 'construction' | 'steel' | 'ppe' | 'tyres' | 'autoparts' | 'lubricants' | 'fuel' | 'travel' | 'hotel' | 'courier'
  | 'freight' | 'consulting' | 'audit' | 'legal' | 'cleaning' | 'security' | 'catering' | 'landscaping' | 'electrical' | 'chemicals' | 'printing' | 'furniture'
  | 'medical' | 'uniforms' | 'water' | 'machinery' | 'software' | 'training' | 'insurance' | 'rent' | 'marketing' | 'plastics' | 'hvac';
const SECTOR_WORD: Record<Sector, string[]> = {
  stationery: ['Stationery', 'Office Supplies', 'Paper Products'], it: ['Computers', 'IT Solutions', 'Technology Distribution'], telecom: ['Telecom', 'Networks'],
  construction: ['Building Materials', 'Cement Products', 'Readymix'], steel: ['Steel', 'Metal Industries'], ppe: ['Safety Equipment', 'Industrial Safety'],
  tyres: ['Tyres', 'Tyre Centre'], autoparts: ['Auto Spare Parts', 'Motors Spares', 'Heavy Equipment Parts'], lubricants: ['Lubricants', 'Oils & Lubricants'],
  fuel: ['Petroleum', 'Fuel Supply'], travel: ['Travel & Tourism', 'Travels'], hotel: ['Hotel', 'Hotel Apartments'], courier: ['Express Courier', 'Courier Services'],
  freight: ['Logistics', 'Freight Forwarding', 'Shipping & Logistics'], consulting: ['Management Consultancy', 'Consulting'], audit: ['Chartered Accountants', 'Auditing'],
  legal: ['Advocates & Legal Consultants'], cleaning: ['Cleaning Services', 'Facility Cleaning'], security: ['Security Services', 'Guarding Services'],
  catering: ['Catering', 'Food Services'], landscaping: ['Landscaping', 'Gardens & Landscaping'], electrical: ['Electrical', 'Electromechanical'],
  chemicals: ['Chemicals', 'Industrial Chemicals'], printing: ['Printing Press', 'Printing & Publishing'], furniture: ['Furniture', 'Office Furniture'],
  medical: ['Medical Supplies', 'Pharmacy'], uniforms: ['Uniforms', 'Garments'], water: ['Drinking Water', 'Mineral Water'], machinery: ['Heavy Equipment', 'Machinery'],
  software: ['Software', 'Digital Solutions'], training: ['Training Centre', 'Training Institute'], insurance: ['Insurance'], rent: ['Real Estate', 'Properties'],
  marketing: ['Advertising', 'Media & Events'], plastics: ['Plastic Industries', 'Packaging'], hvac: ['Air Conditioning', 'HVAC Contracting'],
};
const PER_SECTOR: Partial<Record<Sector, number>> = { travel: 4, hotel: 4, legal: 2, audit: 2, insurance: 3, rent: 3, fuel: 3, telecom: 2, water: 3, courier: 4 };
interface Supplier { name: string; ref: string; country: string; ccy: string; sector: Sector; foreign: boolean }
const suppliers: Supplier[] = [];
const bySector = new Map<Sector, Supplier[]>();
let vno = 100120;
const used = new Set<string>();
for (const sector of Object.keys(SECTOR_WORD) as Sector[]) {
  const list: Supplier[] = [];
  for (let k = 0; k < (PER_SECTOR[sector] ?? 6); k++) {
    let name = '';
    for (let tries = 0; tries < 50 && (!name || used.has(name)); tries++) name = `${pick(PREFIX)} ${pick(SECTOR_WORD[sector])} ${pick(SUFFIX)}`;
    used.add(name);
    const s: Supplier = { name, ref: `V${vno += 7 + Math.floor(r() * 30)}`, country: 'AE', ccy: 'AED', sector, foreign: false };
    list.push(s); suppliers.push(s);
  }
  bySector.set(sector, list);
}
// invented suppliers abroad (paid in their own currency)
const FOREIGN: [string, string, string, Sector][] = [
  ['Rheinwerk Pumpen GmbH', 'DE', 'EUR', 'machinery'], ['Nordhafen Messtechnik GmbH', 'DE', 'EUR', 'electrical'], ['Milano Valvole S.p.A.', 'IT', 'EUR', 'machinery'],
  ['Bharat Polymers Pvt Ltd', 'IN', 'INR', 'plastics'], ['Deccan Safety Products Pvt Ltd', 'IN', 'INR', 'ppe'], ['Coimbatore Textiles Pvt Ltd', 'IN', 'INR', 'uniforms'],
  ['Shenzhen Brightway Electronics Co., Ltd', 'CN', 'USD', 'it'], ['Qingdao Heavy Tyre Co., Ltd', 'CN', 'USD', 'tyres'], ['Ningbo Hydraulic Parts Co., Ltd', 'CN', 'USD', 'autoparts'],
  ['Northbridge Software Ltd', 'GB', 'GBP', 'software'], ['Kestrel Environmental Consulting Ltd', 'GB', 'GBP', 'consulting'], ['Lakeside Analytics Inc', 'US', 'USD', 'software'],
  ['Cascade Cloud Services Inc', 'US', 'USD', 'it'], ['Riyadh Packaging Co', 'SA', 'SAR', 'plastics'], ['Dammam Industrial Chemicals Co', 'SA', 'SAR', 'chemicals'],
];
for (const [name, country, ccy, sector] of FOREIGN) {
  const s: Supplier = { name, ref: `V${vno += 11}`, country, ccy, sector, foreign: true };
  suppliers.push(s); bySector.get(sector)!.push(s);
}
// the same supplier created twice in the ERP (second vendor number, name written a little differently)
const DUP_MASTERS: Supplier[] = [];
for (const s of [...suppliers].filter((x) => !x.foreign).sort(() => r() - 0.5).slice(0, 10)) {
  const d: Supplier = { ...s, name: variant(s.name, 'typo'), ref: `V${vno += 13}` };
  DUP_MASTERS.push(d); bySector.get(s.sector)!.push(d);
}

/** The same name as another system or a person might write it. */
function variant(name: string, how?: string): string {
  const kinds = ['upper', 'llc', 'nosuffix', 'typo', 'trading', 'dash', 'co', 'space'];
  const k = how ?? pick(kinds);
  switch (k) {
    case 'upper': return name.toUpperCase();
    case 'llc': return name.replace(/\bLLC\b/, 'L.L.C.').replace(/\bFZE\b/, 'F.Z.E.').replace(/\bCo\. LLC\b/, 'Company L.L.C');
    case 'nosuffix': return name.replace(/\s+(LLC|Trading LLC|FZE|FZCO|Co\. LLC|Est\.|General Trading LLC|Services LLC|GmbH|Pvt Ltd|Ltd|Inc|Co\., Ltd|S\.p\.A\.|Co)$/, '');
    case 'trading': return /Trading/.test(name) ? name.replace(/ (General )?Trading/, '') : name.replace(/ (LLC|FZE|FZCO)$/, ' Trading $1');
    case 'dash': return name.replace(/^Al /, 'Al-').replace(/ & /, ' and ');
    case 'co': return name.replace(/ (LLC|FZE|FZCO|Est\.)$/, ' Co.');
    case 'space': return name.replace(/^(\w+) (\w+)/, (_m, a: string, b: string) => (a.length + b.length < 14 ? `${a}${b}` : `${a} ${b}`));
    case 'typo': {
      const w = name.split(' ');
      const i = w.findIndex((x, j) => j > 0 && x.length >= 6 && /^[A-Za-z]+$/.test(x));
      if (i < 0) return `${name} `.trim().replace(/a/, 'e');
      const x = w[i]!; const p = 2 + Math.floor(r() * (x.length - 4));
      w[i] = x.slice(0, p) + x[p + 1] + x[p] + x.slice(p + 2);              // two letters swapped
      return w.join(' ');
    }
    default: return name;
  }
}

// -------------------------------------------------------------------- products --
const HQ = 'BEEAH Headquarters', ZAHIA = 'Al Zahia Community', WTE = 'Sharjah Waste-to-Energy', REC = "Al Saja'a Recycling Complex", LF = "Al Saja'a Landfill",
  FLEET = 'Fleet Depot Sharjah', DC = 'Data Centre Dubai';
const OFFICE = [HQ, ZAHIA], PLANTS = [WTE, REC], SITES = [WTE, REC, LF, FLEET], ALL = [HQ, ZAHIA, WTE, REC, LF, FLEET, DC];
/** Cost centres as the ERP writes them (some differ from the facility names; two are not in Ekotrace at all). */
const CC: Record<string, string[]> = {
  [HQ]: ['BEEAH Headquarters', 'BEEAH Headquarters', 'HQ Sharjah', 'BEEAH HQ'], [ZAHIA]: ['Al Zahia Community'], [WTE]: ['Sharjah Waste-to-Energy', 'WtE Plant Sharjah'],
  [REC]: ["Al Saja'a Recycling Complex", 'Sajaa Recycling'], [LF]: ["Al Saja'a Landfill", 'Saja Landfill'], [FLEET]: ['Fleet Depot Sharjah'], [DC]: ['Data Centre Dubai'],
};
const UNKNOWN_CC = ['Ajman Transfer Station', 'CC-4410 Projects'];
// [descriptions, category, GL account, sector, AED per line or [qty range, unit, AED per unit], facilities, weight, capital?]
type Price = number | [number, number, string, number];
type Product = [string[], string, string, Sector, Price, string[], number, boolean?];
const PRODUCTS: Product[] = [
  [['A4 copier paper 80gsm', 'Copy paper A4 (box of 5 reams)', 'Paper A3/A4 white'], 'Office supplies', 'Office expenses', 'stationery', 950, OFFICE, 30],
  [['Printer toner cartridge', 'Toner HP 26A black', 'Ink cartridges assorted'], 'Office supplies', 'Office expenses', 'stationery', 1300, OFFICE, 18],
  [['Files, folders and pens', 'Stationery items assorted', 'Notebooks and diaries'], 'Office supplies', 'Office expenses', 'stationery', 420, ALL, 25],
  [['Laptop 14in i7 16GB', 'Notebook computer', 'Laptop with docking station'], 'IT hardware', 'IT equipment', 'it', 6800, ALL, 14],
  [['24in LED monitor', 'Computer monitor 27"'], 'IT hardware', 'IT equipment', 'it', 1100, ALL, 10],
  [['Network switch 48 port', 'Wi-Fi access points', 'Structured cabling CAT6'], 'IT hardware', 'IT equipment', 'it', 5200, [HQ, DC], 6],
  [['Server rack and UPS', 'Rack servers (2 nodes)'], 'Capital projects', 'Capital WIP', 'it', 185000, [DC], 0.15, true],
  [['Mobile and data plans', 'Corporate mobile lines monthly'], 'Telecom', 'Telephone', 'telecom', 5400, ALL, 9],
  [['Internet leased line 1Gbps', 'MPLS link monthly'], 'Telecom', 'Telephone', 'telecom', 7800, [HQ, DC], 5],
  [['Cloud hosting monthly', 'Virtual servers subscription'], 'IT services', 'IT subscriptions', 'software', 12500, [DC], 4],
  [['ERP licence renewal', 'Software subscription annual', 'Data analytics platform licences'], 'Software', 'IT subscriptions', 'software', 22000, [HQ], 4],
  [['OPC cement 50kg bags', 'Ordinary Portland cement bulk'], 'Construction materials', 'Materials', 'construction', [20, 60, 't', 380], [LF, REC], 10],
  [['Ready mix concrete C40', 'Readymix concrete C30'], 'Construction materials', 'Materials', 'construction', [30, 90, 'm3', 290], [LF, REC], 8],
  [['Interlock pavers', 'Concrete blocks 20cm'], 'Construction materials', 'Materials', 'construction', 8200, [LF, ZAHIA], 5],
  [['Steel rebar 16mm', 'Reinforcement steel bars'], 'Construction materials', 'Materials', 'steel', [5, 20, 't', 2900], [REC, LF], 5],
  [['Steel plates and sections', 'MS angles and channels'], 'Workshop materials', 'Repairs & maintenance', 'steel', 6400, [WTE, REC, FLEET], 6],
  [['Safety gloves and PPE', 'Safety shoes', 'Hard hats and hi-vis vests', 'Disposable coveralls'], 'PPE', 'Health & safety', 'ppe', 2300, SITES, 30],
  [['Staff uniforms', 'Work uniforms with logo', 'Coveralls cotton'], 'PPE', 'Staff costs', 'uniforms', 4600, SITES, 10],
  [['Truck tyres 315/80R22.5', 'Tyres 385/65R22.5', 'Loader tyres 23.5R25'], 'Fleet spares', 'Fleet maintenance', 'tyres', 9800, [FLEET], 22],
  [['Vehicle spare parts', 'Brake pads and discs', 'Filters (oil/air/fuel)', 'Hydraulic hoses and fittings', 'Compactor body spare parts'], 'Fleet spares', 'Fleet maintenance', 'autoparts', 3100, [FLEET, WTE], 95],
  [['Engine oil 15W-40', 'Hydraulic oil ISO 68', 'Grease EP2'], 'Fleet spares', 'Fleet maintenance', 'lubricants', 2700, [FLEET, WTE], 25],
  [['Diesel for generators', 'Gasoil delivered to site'], 'Fuel', 'Fuel', 'fuel', 18500, PLANTS, 9],
  [['Airfare business travel', 'Air tickets DXB-LHR', 'Flight tickets for conference'], 'Travel', 'Travel expenses', 'travel', 4300, OFFICE, 22],
  [['Hotel accommodation', 'Hotel stay 3 nights'], 'Travel', 'Travel expenses', 'hotel', 2300, OFFICE, 15],
  [['Courier charges', 'Express document delivery'], 'Logistics', 'Freight & courier', 'courier', 260, ALL, 40],
  [['Freight container haulage', 'Trucking of recyclables', 'Sea freight import'], 'Logistics', 'Freight & courier', 'freight', 6400, [...PLANTS, FLEET], 26],
  [['Consultancy fees strategy', 'Environmental consultancy', 'Engineering design services'], 'Professional services', 'Consulting', 'consulting', 42000, [HQ], 8],
  [['External audit fees', 'ESG assurance fees'], 'Professional services', 'Audit fees', 'audit', 38000, [HQ], 1.2],
  [['Legal fees', 'Legal retainer monthly'], 'Professional services', 'Legal', 'legal', 16000, [HQ], 2],
  [['Office cleaning contract', 'Deep cleaning services'], 'Facility services', 'Facility management', 'cleaning', 12500, [...OFFICE, DC], 9],
  [['Security guards monthly', 'CCTV monitoring service'], 'Facility services', 'Facility management', 'security', 21000, ALL, 9],
  [['Staff catering', 'Pantry supplies', 'Meals for site staff'], 'Facility services', 'Staff welfare', 'catering', 9800, [...PLANTS, HQ], 20],
  [['Landscaping maintenance', 'Irrigation repairs', 'Plants and soil'], 'Facility services', 'Facility management', 'landscaping', 7600, [ZAHIA, HQ], 9],
  [['Electrical cables and fittings', 'LED light fittings', 'Circuit breakers and panels'], 'Electrical', 'Repairs & maintenance', 'electrical', 3500, ALL, 30],
  [['Water treatment chemicals', 'Lime and activated carbon (flue gas)', 'Degreaser and solvents'], 'Chemicals', 'Materials', 'chemicals', 14500, [WTE, REC], 22],
  [['Printing of brochures', 'Business cards and letterheads', 'Signage printing'], 'Marketing', 'Marketing', 'printing', 2200, [HQ], 10],
  [['Advertising campaign', 'Event management fees', 'Social media campaign'], 'Marketing', 'Marketing', 'marketing', 32000, [HQ], 4],
  [['Office chairs', 'Workstations and desks', 'Meeting room furniture'], 'Furniture', 'Office furniture', 'furniture', 3800, OFFICE, 6],
  [['First aid and medical supplies', 'Medicines for clinic'], 'Health', 'Health & safety', 'medical', 900, SITES, 12],
  [['Bottled drinking water', 'Water gallons 5 gal'], 'Pantry', 'Staff welfare', 'water', 650, ALL, 24],
  [['HDPE bags and liners', 'Plastic bins 240L', 'Stretch film and packaging'], 'Operations consumables', 'Materials', 'plastics', 5600, [REC, WTE], 28],
  [['HVAC maintenance contract', 'Chiller servicing', 'AC split units'], 'Facility services', 'Repairs & maintenance', 'hvac', 8900, [...OFFICE, DC], 10],
  [['Pump overhaul', 'Conveyor belt replacement', 'Shredder blades'], 'Plant maintenance', 'Repairs & maintenance', 'machinery', 24000, PLANTS, 14],
  [['Wheel loader 3.5 m3', 'Compactor truck 20 m3', 'Diesel generator 500 kVA'], 'Capital projects', 'Capital WIP', 'machinery', 690000, [LF, FLEET, WTE], 0.3, true],
  [['Training course ISO 14064', 'Forklift operator training', 'First aid training'], 'Training', 'Training', 'training', 5500, [HQ, ...SITES], 6],
  [['Property insurance premium', 'Motor fleet insurance'], 'Insurance', 'Insurance', 'insurance', 26000, [HQ], 1.5],
  [['Office rent', 'Warehouse rent quarterly'], 'Rent', 'Rent', 'rent', 85000, [HQ, ZAHIA], 1.5],
  [['Electricity DEWA', 'Electricity charges'], 'Utilities', 'Utilities', 'fuel', 64000, [DC], 0.6],
];

/** How the second system writes each supplier: the proper name or one of one to three fixed variants. */
const SPELL = new Map<Supplier, string[]>();
const spellings = (s: Supplier) => {
  let v = SPELL.get(s);
  if (!v) { v = [s.name, s.name]; const k = 1 + Math.floor(r() * 3); for (let i = 0; i < k; i++) v.push(variant(s.name)); SPELL.set(s, v); }
  return v;
};

// ------------------------------------------------------------------ the xlsx --
const FX_HINT: Record<string, number> = { AED: 1, USD: 1 / 3.6725, EUR: 0.86 / 3.6725, GBP: 0.75 / 3.6725, INR: 85 / 3.6725, SAR: 3.75 / 3.6725 };
async function purchases(out: string, total = 10_000) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ME2N export');
  ws.addRow(['BEEAH Group — purchase order lines Jan–Sep 2026 — DEMO TEST DATA (made up, not real suppliers or spend)']);
  ws.addRow([]);
  const H = ['Document No', 'Item', 'Posting Date', 'Vendor No', 'Vendor Name', 'Vendor Country', 'Material Description', 'Purchase Category', 'GL Account Name', 'Quantity', 'Unit of Measure', 'Net Amount', 'Currency', 'Plant'];
  ws.addRow(H).font = { bold: true };
  const weights = PRODUCTS.map((p) => p[6]);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const pickProduct = () => { let x = r() * sumW; for (const p of PRODUCTS) { x -= p[6]; if (x <= 0) return p; } return PRODUCTS[0]!; };
  const countryText = (s: Supplier) => {
    if (s.country !== 'AE') return pick([s.country, ({ DE: 'Germany', IT: 'Italy', IN: 'India', CN: 'China', GB: 'United Kingdom', US: 'USA', SA: 'Saudi Arabia' } as Record<string, string>)[s.country] ?? s.country]);
    return pick(['United Arab Emirates', 'UAE', 'AE', 'AE', '']);
  };
  let po = 4510000000, n = 0, credit = 0, dupes = 0, unknown = 0, noRef = 0;
  const rows: unknown[][] = [];
  while (n < total) {
    const p = pickProduct();
    const [descs, cat, gl, sector, price, facs] = p;
    const pool = bySector.get(sector)!;
    const s0 = pool[zipf(pool.length)]!;
    const fac = pick(facs);
    const month = Math.floor(r() * 9), day = 1 + Math.floor(r() * 28);
    const f = Math.exp((r() - 0.5) * 1.1);                                  // spread around the usual price
    let qty: number | null = null, uom: string | null = null, aed: number;
    if (Array.isArray(price)) { qty = Math.round((price[0] + r() * (price[1] - price[0])) * 10) / 10; uom = price[2]; aed = qty * price[3] * (0.9 + r() * 0.2); }
    else { aed = price * f; if (r() < 0.35) { qty = 1 + Math.floor(r() * 20); uom = pick(['EA', 'PC', 'Each', 'NOS']); } }
    const ccy = s0.foreign ? s0.ccy : r() < 0.04 ? 'USD' : 'AED';
    let amount = Math.round(aed * FX_HINT[ccy]! * 100) / 100;
    // a third of lines come from the second entity's system: no vendor number, supplier name typed by hand
    const legacy = r() < 0.3;
    if (legacy) noRef++;
    const vname = legacy ? pick(spellings(s0)) : s0.name;
    const cc = r() < 0.004 ? (unknown++, pick(UNKNOWN_CC)) : (r() < 0.9 ? CC[fac]![0]! : pick(CC[fac]!));
    let desc = pick(descs);
    if (r() < 0.004) { amount = -Math.round(amount * (0.2 + r() * 0.6) * 100) / 100; desc = `${desc} - credit note`; credit++; }
    const row = [String(po++), 10 * (1 + Math.floor(r() * 4)), new Date(Date.UTC(2026, month, day)), legacy ? null : s0.ref, vname, legacy ? null : countryText(s0),
      desc, cat, gl, qty, uom, amount, ccy, cc];
    rows.push(row); n++;
    if (n < total && r() < 0.0015) { rows.push([...row]); n++; dupes++; }       // the same line exported twice
  }
  rows.sort((a, b) => (a[2] as Date).getTime() - (b[2] as Date).getTime());
  for (const row of rows) ws.addRow(row);
  ws.getColumn(3).numFmt = 'dd.mm.yyyy';
  ws.getColumn(12).numFmt = '#,##0.00';
  ws.columns.forEach((c, i) => { c.width = [14, 6, 12, 10, 40, 20, 40, 24, 24, 9, 9, 14, 8, 26][i]; });
  // a second sheet: the vendor master as the ERP has it (for reference)
  const vm = wb.addWorksheet('Vendor master (DEMO)');
  vm.addRow(['Vendor No', 'Vendor Name', 'Country', 'Note']).font = { bold: true };
  for (const s of [...suppliers, ...DUP_MASTERS]) vm.addRow([s.ref, s.name, s.country, DUP_MASTERS.includes(s) ? 'second vendor number for the same company' : '']);
  writeFileSync(join(out, 'purchases-10k-2026.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));
  const legacyNames = new Set(rows.filter((x) => !x[3]).map((x) => x[4]));
  return { lines: rows.length, suppliers: suppliers.length + DUP_MASTERS.length, credit, dupes, unknown, noRef, distinctNames: new Set(rows.map((x) => x[4])).size, legacyNames: legacyNames.size };
}

// ------------------------------------------------------------------- the bills --
const dd = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmon = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
const money = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number) => Math.round(v).toLocaleString('en');

interface BillSpec { brand: string; colour: [number, number, number]; title: string; header: string[]; rows: (string | [string, string])[]; footer: string }
async function billPdf(b: BillSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`DEMO specimen bill — ${b.brand} — not real`); doc.setProducer('Ekotrace test files (DEMO)');
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [cr, cg, cb] = b.colour;
  page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: rgb(cr, cg, cb) });
  page.drawText(b.title, { x: 40, y: 806, size: 15, font: bold, color: rgb(1, 1, 1) });
  page.drawText('DEMO / SPECIMEN - NOT A REAL BILL', { x: 40, y: 786, size: 9, font: bold, color: rgb(1, 0.92, 0.6) });
  let y = 745;
  for (const h of b.header) { page.drawText(h, { x: 40, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) }); y -= 14; }
  y -= 8;
  const text = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont, size = 10) => p.drawText(s, { x, y: yy, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  for (const row of b.rows) {
    if (Array.isArray(row)) { text(page, row[0], 40, y, font); text(page, row[1], 300, y, /total|amount due/i.test(row[0]) ? bold : font); y -= 18; }
    else { y -= 6; page.drawRectangle({ x: 36, y: y - 4, width: 523, height: 18, color: rgb(cr * 0.15 + 0.85, cg * 0.15 + 0.85, cb * 0.15 + 0.85) }); text(page, row, 40, y, bold, 11); y -= 22; }
  }
  // diagonal watermark, drawn last and light
  page.drawText('DEMO - SPECIMEN', { x: 110, y: 260, size: 64, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(35) });
  page.drawText(b.footer, { x: 40, y: 48, size: 7.5, font, color: rgb(0.4, 0.4, 0.4) });
  page.drawText('Made up for testing Ekotrace. Not issued by any utility; layout only resembles common UAE bills. Do not use for reporting.', { x: 40, y: 36, size: 7.5, font, color: rgb(0.6, 0.1, 0.1) });
  return doc.save();
}

/** Accounts the demo company has meters for (see cli/demo.ts). */
export const BILL_ACCOUNTS = [
  { kind: 'sewa', account: '2003317745', facility: REC, base: 118000 },
  { kind: 'sewa', account: '2003318102', facility: LF, base: 17500 },
  { kind: 'sewa', account: '2003320088', facility: FLEET, base: 36000 },
  { kind: 'sewa', account: '2003324417', facility: ZAHIA, base: 61000 },
  { kind: 'sewa', account: '2001458876', facility: HQ, base: 95000, from: 7 },                    // HQ: earlier months already in the demo
  { kind: 'dewa', account: '2045118763', facility: `${DC} (annex supply)`, base: 42000 },
  { kind: 'empower', account: 'EMP-DC-77310', facility: DC, base: 26500 },
] as const;

async function bills(out: string) {
  const dir = join(out, 'bills'); mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const season = (m: number) => 0.78 + 0.42 * Math.sin(((m - 1.5) / 12) * 2 * Math.PI) ** 2 * (m >= 3 && m <= 9 ? 1 : 0.4); // summer peak
  for (const a of BILL_ACCOUNTS) {
    const first = 'from' in a ? a.from : 0;
    for (let k = first; k < 9; k++) {
      const q = Math.round(a.base * season(k) * (0.95 + r() * 0.1));
      let spec: BillSpec, name: string;
      if (a.account === '2001458876' && k > 7) break;                                  // HQ: 15 Aug – 14 Sep only (later bills not issued yet)
      if (a.kind === 'sewa') {
        // SEWA HQ bills run 15th to 14th (as in the demo); the others calendar months
        const hq = a.account === '2001458876';
        const from = hq ? new Date(Date.UTC(2026, k, 15)) : new Date(Date.UTC(2026, k, 1)), to = hq ? new Date(Date.UTC(2026, k + 1, 14)) : new Date(Date.UTC(2026, k + 1, 0));
        const issued = new Date(to.getTime() + 6 * 86400000);
        const prev = 400000 + k * 61000 + Number(a.account.slice(-3)) * 10;
        const amt = q * 0.38 + 0.05 * q * 0.38 + 140;
        spec = { brand: 'SEWA', colour: [0.0, 0.42, 0.55], title: 'Sharjah Electricity, Water and Gas Authority', footer: `DEMO specimen - premises: ${a.facility}`,
          header: ['TAX INVOICE', `Premises: ${a.facility}, Sharjah`],
          rows: [['Account No:', a.account], ['Bill No:', `INV-26-${a.account.slice(-4)}${String(k + 1).padStart(2, '0')}`], ['Bill Date:', dd(issued)], ['Billing Period:', `${dd(from)} - ${dd(to)}`],
            'Electricity', ['Previous Reading', int(prev)], ['Current Reading', int(prev + q)], ['Consumption', `${int(q)} kWh`], ['Rate', '0.38 AED/kWh'], ['Electricity charges', `AED ${money(q * 0.38)}`],
            'Charges', ['Meter / service fee', 'AED 140.00'], ['VAT 5%', `AED ${money(0.05 * q * 0.38)}`], ['Total Amount Due', `AED ${money(amt)}`]] };
        name = `SEWA-${a.account}-${to.toISOString().slice(0, 7)}.pdf`;
      } else if (a.kind === 'dewa') {
        const from = new Date(Date.UTC(2026, k, 1)), to = new Date(Date.UTC(2026, k + 1, 0)), issued = new Date(Date.UTC(2026, k + 1, 4));
        const energy = q * 0.305, fuel = q * 0.065, meter = 30, vat = 0.05 * (energy + fuel + meter);
        spec = { brand: 'DEWA', colour: [0.0, 0.5, 0.33], title: 'Dubai Electricity & Water Authority', footer: `DEMO specimen - premise: ${a.facility}`,
          header: ['Tax Invoice', `Premise: ${a.facility}, Dubai`],
          rows: [['Contract Account No.', a.account], ['Invoice No.', `10${a.account.slice(-5)}${String(k + 1).padStart(3, '0')}`], ['Invoice Date', dmon(issued)], ['Billing period', `From ${dd(from)} To ${dd(to)}`],
            'Electricity', ['Electricity consumption', `${int(q)} kWh`], ['Electricity charges (slab tariff)', `AED ${money(energy)}`], ['Fuel surcharge (6.5 fils/kWh)', `AED ${money(fuel)}`], ['Meter service charge', 'AED 30.00'],
            'Summary', ['VAT 5%', `AED ${money(vat)}`], ['Total amount due', `AED ${money(energy + fuel + meter + vat)}`]] };
        name = `DEWA-${a.account}-${to.toISOString().slice(0, 7)}.pdf`;
      } else {
        const from = new Date(Date.UTC(2026, k, 1)), to = new Date(Date.UTC(2026, k + 1, 0)), issued = new Date(Date.UTC(2026, k + 1, 7));
        const consumption = q * 0.165, capacity = 18450, vat = 0.05 * (consumption + capacity);
        spec = { brand: 'Empower', colour: [0.05, 0.25, 0.5], title: 'Emirates Central Cooling Systems Corporation (Empower)', footer: `DEMO specimen - premise: ${a.facility}`,
          header: ['District cooling - Tax Invoice', `Premise: ${a.facility}`],
          rows: [['Premise No.', a.account], ['Bill No.', `EMP${String(26000 + k * 37)}`], ['Statement Date', dd(issued)], ['Billing Period', `${dd(from)} - ${dd(to)}`],
            'Cooling', ['Contracted capacity', '450 RT'], ['Consumption', `${int(q)} TRh`], ['Consumption charge (0.165 AED/TRh)', `AED ${money(consumption)}`], ['Capacity charge', `AED ${money(capacity)}`],
            'Summary', ['VAT 5%', `AED ${money(vat)}`], ['Total Amount Due', `AED ${money(consumption + capacity + vat)}`]] };
        name = `Empower-${a.account}-${to.toISOString().slice(0, 7)}.pdf`;
      }
      writeFileSync(join(dir, name), await billPdf(spec));
      files.push(name);
    }
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? 'test-files';
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const p = await purchases(out);
  const b = await bills(out);
  console.log(`purchases-10k-2026.xlsx: ${p.lines.toLocaleString('en')} lines, ${p.suppliers} suppliers in the vendor master (10 created twice), ${p.distinctNames} different supplier spellings,`);
  console.log(`  ${p.noRef.toLocaleString('en')} lines without a vendor number, ${p.credit} credit notes, ${p.dupes} repeated lines, ${p.unknown} unknown cost centres`);
  console.log(`bills/: ${b.length} DEMO PDFs (${(Date.now() - t0) / 1000}s)`);
}
