/**
 * What a purchase line can carry, how file columns are recognised, and how cell values
 * are read (dates in any common layout, amounts with thousands separators, credit notes…).
 */
import { createHash } from 'node:crypto';
import { cellText, type Cell } from '../../lib/sheet.js';

export const FIELDS = ['date', 'description', 'amount', 'currency', 'quantity', 'unit', 'supplier', 'category', 'gl', 'po', 'facility', 'supplierEf', 'supplierEfUnit', 'capital', 'supplierRef', 'supplierCountry'] as const;
export type Field = typeof FIELDS[number];
export const FIELD_LABEL: Record<Field, string> = {
  date: 'Date (purchase / invoice / posting)', description: 'Description', amount: 'Amount (spend)', currency: 'Currency', quantity: 'Quantity', unit: 'Unit of quantity',
  supplier: 'Supplier / vendor', category: 'Category (as in your system)', gl: 'GL account / account name', po: 'PO / invoice number', facility: 'Facility / site / cost centre',
  supplierEf: 'Supplier emission factor', supplierEfUnit: 'Unit of supplier factor', capital: 'Capital goods (yes / no)', supplierRef: 'Vendor number (ERP)', supplierCountry: 'Supplier country',
};
/** Header words for each field, best first. */
const HINTS: Record<Field, string[]> = {
  date: ['purchase date', 'invoice date', 'posting date', 'document date', 'po date', 'order date', 'date', 'period', 'month'],
  description: ['description', 'item description', 'line description', 'material description', 'product description', 'original desc', 'comm desc', 'desc', 'item name', 'product', 'material', 'narration', 'particulars', 'details', 'item'],
  amount: ['purchase order line amount', 'line amount', 'net amount', 'amount', 'total amount', 'total', 'value / quantity', 'value', 'spend', 'amt', 'line total', 'cost'],
  currency: ['currency', 'currency code', 'ccy', 'curr'],
  quantity: ['quantity', 'qty', 'quantity ordered', 'qty ordered'],
  unit: ['uom', 'uom name', 'unit of measure', 'unit'],
  supplier: ['supplier name', 'vendor name', 'supplier', 'vendor', 'party name', 'party'],
  category: ['category name', 'product category', 'spend category', 'item category', 'commodity', 'category', 'comm code'],
  gl: ['account description', 'gl account', 'acct title', 'account name', 'gl', 'account code', 'acct code', 'account', 'cost element'],
  po: ['po number', 'po#', 'po', 'order', 'invoice no', 'invoice number', 'document no', 'reference'],
  facility: ['facility', 'site', 'cost centre', 'cost center', 'location', 'plant', 'branch', 'business unit'],
  supplierEf: ['vendor specific ef', 'supplier specific ef', 'supplier ef', 'supplier emission factor', 'emission factor'],
  supplierEfUnit: ['vendor specific unit', 'supplier ef unit', 'ef unit'],
  supplierRef: ['vendor number', 'vendor no', 'vendor code', 'vendor id', 'vendor #', 'supplier number', 'supplier no', 'supplier code', 'supplier id', 'vendor account'],
  supplierCountry: ['supplier country', 'vendor country', 'country of supplier', 'country of origin', 'origin country'],
  capital: ['capital', 'capex', 'type of purchase', 'asset'],
};
const norm = (s: string) => s.toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^a-z0-9#/ ]/g, '').trim();

export type Columns = Partial<Record<Field, string | string[]>>;

/** Best guess of which header is which field; each header used once (description may take two). */
export function guessColumns(headers: string[]): Columns {
  const H = headers.map((h) => ({ h, n: norm(h) })).filter((x) => x.n);
  const used = new Set<string>();
  const out: Columns = {};
  const order: Field[] = ['amount', 'date', 'currency', 'quantity', 'unit', 'supplierEf', 'supplierEfUnit', 'supplierRef', 'supplierCountry', 'supplier', 'category', 'gl', 'po', 'facility', 'capital', 'description'];
  for (const f of order) {
    let best: { h: string; score: number } | undefined;
    for (const [rank, hint] of HINTS[f].entries()) {
      for (const { h, n } of H) {
        if (used.has(h)) continue;
        if (f === 'amount' && /unit price|^price$|rate/.test(n)) continue;          // a unit price is not the line amount
        const score = n === hint ? 100 - rank : n.startsWith(`${hint} `) || n.endsWith(` ${hint}`) ? 60 - rank : (hint.length > 3 && n.includes(hint)) ? 30 - rank : 0;
        if (f === 'date' && /due|delivery|created/.test(n) && score < 100) continue;
        if (score > 0 && (!best || score > best.score)) best = { h, score };
      }
    }
    if (best) { out[f] = best.h; used.add(best.h); }
  }
  // a second descriptive column ("Item Name" next to "Description") makes descriptions clearer
  if (typeof out.description === 'string') {
    const extra = H.find(({ h, n }) => !used.has(h) && ['item name', 'item description', 'material description', 'product', 'comm desc'].includes(n));
    if (extra) out.description = [out.description, extra.h];
  }
  return out;
}

export function signature(headers: string[]): string {
  return createHash('sha256').update(headers.map(norm).filter(Boolean).sort().join('|')).digest('hex').slice(0, 32);
}

// ------------------------------------------------------------- values --
export type DateFormat = 'dmy' | 'mdy' | 'ymd';
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? dt.toISOString().slice(0, 10) : null;
};

/** A date from a cell: Excel date, Excel serial number, or text in the company's layout. */
export function readDate(c: Cell, fmt: DateFormat = 'dmy'): string | null {
  if (c == null || c === '') return null;
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c.toISOString().slice(0, 10);
  if (typeof c === 'number') return c > 20000 && c < 80000 ? new Date(Date.UTC(1899, 11, 30) + c * 86400000).toISOString().slice(0, 10) : null;
  const s = String(c).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return fmt === 'mdy' ? iso(+m[3]!, +m[1]!, +m[2]!) : iso(+m[3]!, +m[2]!, +m[1]!);
  m = /^(\d{1,2})[-\s/.]([a-z]{3,9})[-\s/.,]*(\d{2,4})/i.exec(s);                        // 31-Mar-2024
  if (m) { const mo = MONTHS[m[2]!.slice(0, 3).toLowerCase()]; if (mo) return iso(+m[3]!, mo, +m[1]!); }
  m = /^([a-z]{3,9})[-\s/.,]+(\d{1,2})[,\s]+(\d{4})/i.exec(s);                           // March 31, 2024
  if (m && MONTHS[m[1]!.slice(0, 3).toLowerCase()]) return iso(+m[3]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, +m[2]!);
  m = /^([a-z]{3,9})[-\s/.,']*(\d{2,4})$/i.exec(s);                                       // Mar-24, March 2024 → 1st of the month
  if (m && MONTHS[m[1]!.slice(0, 3).toLowerCase()]) return iso(+m[2]!, MONTHS[m[1]!.slice(0, 3).toLowerCase()]!, 1);
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s);                                                  // 2024-03
  if (m) return iso(+m[1]!, +m[2]!, 1);
  return null;
}

/** An amount: "1,234.50", "1.234,50", "(1,234.50)" or "1,234.50-" (credit), "AED 1,200". Currency found in the cell is returned too. */
export function readAmount(c: Cell): { value: number | null; currency?: string } {
  if (c == null || c === '') return { value: null };
  if (typeof c === 'number') return { value: Number.isFinite(c) ? c : null };
  let s = String(c).trim();
  const cur = /\b([A-Z]{3})\b/.exec(s)?.[1];
  s = s.replace(/[A-Za-z$€£¥₹\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (/,\d{1,2}$/.test(s) && (s.includes('.') || (s.match(/,/g) ?? []).length === 1 && !/,\d{3}$/.test(s))) s = s.replace(/\./g, '').replace(',', '.');  // 1.234,56
  else s = s.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(s)) return { value: null, ...(cur ? { currency: cur } : {}) };
  const v = Number(s) * (neg ? -1 : 1);
  return { value: Number.isFinite(v) ? v : null, ...(cur ? { currency: cur } : {}) };
}

export function readBool(c: Cell): boolean | null {
  const s = cellText(c).toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1|capital|capex|capital goods?|asset)$/.test(s)) return true;
  if (/^(n|no|false|0|opex|standard goods|standard services|goods|services)$/.test(s)) return false;
  return null;
}

export const normSupplier = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(?:[a-z]\.\s?){2,}[a-z]?\.?/g, (m) => `${m.replace(/[.\s]/g, '')} `)       // F.Z.E. / L.L.C / W.L.L → fze / llc / wll
  .replace(/\b(wll|spc|psc|pjsc|saoc|saog|bsc)\b/g, ' ')
  .replace(/\b(llc|l\.l\.c|ltd|limited|co|company|fze|fzco|fz|est|establishment|trading|inc|plc|pvt|private|group|the|and|&)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();
