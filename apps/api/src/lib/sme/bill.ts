/**
 * Values on an Indian bill that the SME tool needs, read from the bill's text (pure, no I/O).
 * Electricity (HT/LT DISCOM bills): units, maximum demand, contract demand, power factor, PF penalty.
 * Diesel and LPG invoices: litres / kg, amount. Uses the platform's general bill reader for period,
 * supplier and amount, and keeps the line each value came from so the person checking can see why.
 * Nothing is saved here: the screen shows the values for the person to confirm or correct.
 */
import type { BillRead } from '../billRead.js';

export interface Field { value: number | string | null; line: string | null }
const num = (s: string) => Number(s.replace(/,/g, ''));
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** First number on a line matching `label` (or on the next line), within [min, max]. */
function find(ls: string[], label: RegExp, min: number, max: number, unit?: RegExp): Field {
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i]!;
    if (!label.test(l)) continue;
    const tail = l.replace(label, ' ');
    const cand = [tail, ls[i + 1] ?? ''];
    for (const t of cand) {
      if (unit && !unit.test(t) && t === tail && !/\d/.test(t)) continue;
      const m = t.match(/(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g);
      for (const x of m ?? []) { const v = num(x); if (v >= min && v <= max) return { value: v, line: l }; }
    }
  }
  return { value: null, line: null };
}

export function readIndianBill(text: string, type: 'electricity' | 'diesel' | 'lpg', general: BillRead): Record<string, Field> {
  const ls = lines(text);
  const from = (f: { value: string | number; line: string } | undefined): Field => (f ? { value: f.value, line: f.line } : { value: null, line: null });
  const period: Field = general.periodFrom && general.periodTo ? { value: `${general.periodFrom.value} to ${general.periodTo.value}`, line: general.periodTo.line } : from(general.issueDate);
  let amount = from(general.amount as { value: number; line: string } | undefined);
  // Indian bills: "Net Amount Payable Rs 5,12,300.00" (lakh grouping), when the general reader found none
  if (amount.value === null) amount = find(ls, /(net\s*amount\s*payable|amount\s*payable|net\s*payable|total\s*amount\s*due|bill\s*amount|amount\s*due)/i, 1, 1e10);
  if (type === 'electricity') {
    let units = find(ls, /(units?\s*consumed|net\s*units|total\s*units|consumption\s*\(?kwh\)?|kwh\s*consumed|billed\s*units|energy\s*consumption)/i, 1, 1e8);
    if (units.value === null && general.quantity && /kwh/i.test(general.quantity.unit)) units = { value: general.quantity.value, line: general.quantity.line };
    return {
      period,
      unitsKwh: units,
      maxDemandKva: find(ls, /(recorded\s*(max(imum)?\.?)?\s*demand|max(imum)?\.?\s*demand|\bmd\b|billing\s*demand\s*\(?recorded)/i, 1, 1e5),
      contractDemandKva: find(ls, /(contract(ed)?\s*demand|sanctioned\s*(load|demand)|\bcd\b)/i, 1, 1e5),
      powerFactor: find(ls, /(power\s*factor|\bp\.?\s*f\.?\b(?!\s*pen))/i, 0.3, 1),
      pfPenaltyInr: find(ls, /(p\.?\s*f\.?\s*(penalty|surcharge|charges?)|power\s*factor\s*(penalty|surcharge|charges?)|low\s*pf)/i, 0, 1e8),
      amountInr: amount,
      supplier: from(general.supplier),
    };
  }
  if (type === 'diesel') {
    let litres = find(ls, /(\bqty\b|quantity|litres?|liters?|\bltrs?\b|volume)/i, 1, 1e7);
    if (litres.value === null && general.quantity && /^(l|litre|liter)/i.test(general.quantity.unit)) litres = { value: general.quantity.value, line: general.quantity.line };
    return { date: from(general.issueDate), litres, amountInr: amount, supplier: from(general.supplier) };
  }
  const cyl = find(ls, /(cylinders?|\bnos\b|no\.? of cyl)/i, 1, 10000);
  let kg = find(ls, /(net\s*weight|\bkgs?\b|kilograms?)/i, 1, 1e7);
  if (kg.value === null && cyl.value !== null) {
    const size = find(ls, /(19\s*kg|47\.5\s*kg|14\.2\s*kg)/i, 14, 48);
    if (size.value !== null) kg = { value: Number(cyl.value) * Number(size.value), line: `${cyl.line} · ${size.line}` };
  }
  return { date: from(general.issueDate), cylinders: cyl, kg, amountInr: amount, supplier: from(general.supplier) };
}
