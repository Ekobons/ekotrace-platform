/**
 * Reading a utility bill's text: supplier, account, bill number, billing period, issue
 * date, consumption (with its unit) and the amount. Pure function, no I/O.
 *
 * Works on wording common to UAE / GCC bills (DEWA, SEWA, TAQA / ADDC / AADC,
 * Etihad WE, Empower, Tabreed, Emicool…) and generic English bills. Every value found
 * keeps the line it came from, so the person checking can see why; nothing is booked
 * until a person confirms.
 */
export type Energy = 'electricity' | 'gas' | 'cooling' | 'heat' | 'fuel';
export interface Found<T> { value: T; line: string }
export interface Candidate { energy: Energy; value: number; unit: string; line: string; score: number }
export interface BillRead {
  supplier?: Found<string> & { energy?: Energy; region?: string };
  account?: Found<string>;
  billNo?: Found<string>;
  periodFrom?: Found<string>;
  periodTo?: Found<string>;
  issueDate?: Found<string>;
  amount?: Found<number> & { currency: string };
  quantity?: Candidate;
  candidates: Candidate[];
  missing: string[];
}

const SUPPLIERS: { re: RegExp; name: string; energy?: Energy; region?: string }[] = [
  { re: /Dubai Electricity\s*(and|&)\s*Water Authority|\bDEWA\b/i, name: 'DEWA', energy: 'electricity', region: 'AE-DU' },
  { re: /Sharjah Electricity,?\s*Water\s*(and|&)\s*Gas Authority|\bSEWA\b/i, name: 'SEWA', energy: 'electricity', region: 'AE-SH' },
  { re: /Abu Dhabi Distribution|\bADDC\b/i, name: 'ADDC (TAQA Distribution)', energy: 'electricity', region: 'AE-AZ' },
  { re: /Al Ain Distribution|\bAADC\b/i, name: 'AADC (TAQA Distribution)', energy: 'electricity', region: 'AE-AZ' },
  { re: /TAQA Distribution/i, name: 'TAQA Distribution', energy: 'electricity', region: 'AE-AZ' },
  { re: /Etihad Water\s*(and|&)\s*Electricity|EtihadWE|\bFEWA\b/i, name: 'Etihad WE', energy: 'electricity' },
  { re: /\bEmpower\b|Emirates Central Cooling/i, name: 'Empower', energy: 'cooling' },
  { re: /\bTabreed\b|National Central Cooling/i, name: 'Tabreed', energy: 'cooling' },
  { re: /\bEmicool\b/i, name: 'Emicool', energy: 'cooling' },
  { re: /Emirates Gas|\bEmGas\b/i, name: 'Emirates Gas', energy: 'gas' },
];

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE = String.raw`(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s\-]?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[\s\-,]*\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})`;

/** A date as written on a bill → yyyy-mm-dd. Numeric dates are day / month / year (UAE order). */
export function parseDate(s: string): string | null {
  const x = s.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
  if (r) { y = +r[1]!; m = +r[2]!; d = +r[3]!; }
  else if ((r = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(x))) { d = +r[1]!; m = +r[2]!; y = +r[3]!; }
  else if ((r = /^(\d{1,2})[\s\-]?([A-Za-z]{3,})[\s\-,]*(\d{2,4})$/.exec(x))) { d = +r[1]!; m = MONTHS[r[2]!.slice(0, 4).toLowerCase()] ?? MONTHS[r[2]!.slice(0, 3).toLowerCase()] ?? 0; y = +r[3]!; }
  else if ((r = /^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/.exec(x))) { m = MONTHS[r[1]!.slice(0, 3).toLowerCase()] ?? 0; d = +r[2]!; y = +r[3]!; }
  else return null;
  if (y < 100) y += 2000;
  if (!m || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}
const num = (s: string) => Number(s.replace(/[,\s]/g, ''));

const UNIT_RE = String.raw`(kWh|KWH|Kwh|kwh|MWh|MWH|TR[\s\-]?h(?:r|rs|ours?)?|RT[\s\-]?h(?:r|rs|ours?)?|Ton[\s\-]?hours?|refrigeration ton[\s\-]?hours?|m3|m³|M3|cubic met(?:er|re)s?|kg|KG|litres?|liters?|Ltrs?)`;
const NUM_RE = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;

function unitOf(u: string, energy: Energy): { unit: string; energy: Energy } | null {
  const x = u.toLowerCase().replace(/\s|-/g, '');
  if (x === 'kwh') return energy === 'cooling' ? { unit: 'kWh_c', energy } : energy === 'gas' ? { unit: 'kWh', energy } : { unit: 'kWh_e', energy: 'electricity' };
  if (x === 'mwh') return energy === 'cooling' ? { unit: 'MWh_c', energy } : { unit: 'MWh_e', energy: 'electricity' };
  if (/^(trh|rth|tonhour|refrigerationtonhour)/.test(x)) return { unit: 'TRh', energy: 'cooling' };
  if (/^(m3|m³|cubicmet)/.test(x)) return { unit: 'm3', energy: 'gas' };
  if (x === 'kg') return { unit: 'kg', energy: energy === 'fuel' ? 'fuel' : 'gas' };
  if (/^(litre|liter|ltr)/.test(x)) return { unit: 'L', energy: 'fuel' };
  return null;
}

export function readBill(text: string): BillRead {
  const lines = text.split(/\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  const all = lines.join('\n');
  const out: BillRead = { candidates: [], missing: [] };
  const first = <T>(res: RegExp[], pick: (m: RegExpExecArray) => T | null): Found<T> | undefined => {
    for (const re of res) for (const l of lines) {
      const m = re.exec(l);
      if (m) { const v = pick(m); if (v !== null && v !== undefined && v !== '') return { value: v, line: l.trim() }; }
    }
    return undefined;
  };

  const sup = SUPPLIERS.find((s) => s.re.test(all));
  if (sup) out.supplier = { value: sup.name, energy: sup.energy, region: sup.region, line: lines.find((l) => sup.re.test(l))!.trim() };
  const energy: Energy = sup?.energy ?? 'electricity';

  out.account = first([
    /(?:contract\s+account|account)\s*(?:no\.?|number|#)?\s*[:\-]?\s*\t?\s*([A-Z0-9][A-Z0-9\-\/]{4,})/i,
    /(?:premise|premises|customer|consumer)\s*(?:no\.?|number|#|id)\s*[:\-]?\s*\t?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i,
  ], (m) => (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(m[1]!) ? null : m[1]!));
  out.billNo = first([/(?:bill|invoice|tax invoice)\s*(?:no\.?|number|#)\s*[:\-]?\s*\t?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i], (m) => m[1]!);
  out.issueDate = first([new RegExp(String.raw`(?:bill|invoice|issue|statement)\s*date\s*[:\-]?\s*\t?\s*${DATE}`, 'i')], (m) => parseDate(m[1]!));

  // Billing period: "Period 01/03/2026 - 31/03/2026", "From 01-Mar-2026 To 31-Mar-2026", or reading dates.
  const range = [
    new RegExp(String.raw`(?:billing|bill|consumption|service|supply|invoice)?\s*period[^\d\n]{0,25}${DATE}\s*(?:-|–|to|till|until)\s*${DATE}`, 'i'),
    new RegExp(String.raw`from\s*[:\-]?\s*${DATE}\s*(?:-|–|to|till|until)\s*${DATE}`, 'i'),
    new RegExp(String.raw`^\s*${DATE}\s*(?:-|–|to)\s*${DATE}\s*$`, 'i'),
  ];
  for (const re of range) {
    for (const l of lines) {
      const m = re.exec(l);
      const a = m && parseDate(m[1]!), b = m && parseDate(m[2]!);
      if (a && b && a <= b) { out.periodFrom = { value: a, line: l.trim() }; out.periodTo = { value: b, line: l.trim() }; break; }
    }
    if (out.periodFrom) break;
  }
  if (!out.periodFrom) {
    const prev = first([new RegExp(String.raw`previous\s*(?:meter\s*)?reading\s*date\s*[:\-]?\s*\t?\s*${DATE}`, 'i'), new RegExp(String.raw`(?:from|start)\s*date\s*[:\-]?\s*\t?\s*${DATE}`, 'i')], (m) => parseDate(m[1]!));
    const cur = first([new RegExp(String.raw`(?:current|present)\s*(?:meter\s*)?reading\s*date\s*[:\-]?\s*\t?\s*${DATE}`, 'i'), new RegExp(String.raw`(?:to|end)\s*date\s*[:\-]?\s*\t?\s*${DATE}`, 'i')], (m) => parseDate(m[1]!));
    if (prev && cur && prev.value < cur.value) { out.periodFrom = prev; out.periodTo = cur; }
  }

  // Amount due.
  const amt = new RegExp(String.raw`(?:total\s+amount\s+(?:due|payable)|amount\s+(?:due|payable)|total\s+(?:due|payable)|net\s+amount|total\s+bill\s+amount|current\s+charges)[^\d\n]{0,20}?(AED|SAR|USD|QAR|OMR|KWD|BHD|EGP|INR|Dhs?\.?)?\s*\t?\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*(AED|SAR|USD|QAR|OMR|KWD|BHD|EGP|INR)?`, 'i');
  const a = first([amt], (m) => num(m[2]!));
  if (a) { const m = amt.exec(a.line)!; const cur = (m[1] ?? m[3] ?? 'AED').toUpperCase().replace(/^DHS?\.?$/, 'AED'); out.amount = { ...a, currency: cur }; }

  // Consumption: every "number unit" on the page, scored by the words around it.
  const qre = new RegExp(String.raw`${NUM_RE}\s*${UNIT_RE}(?![\w/])`, 'g');
  const labelOnly = new RegExp(String.raw`(?:consumption|usage|units\s+consumed|energy\s+used)[^\d\n]*\(?\s*${UNIT_RE}\s*\)?`, 'i');
  lines.forEach((l, i) => {
    const consider = (value: number, u: string, line: string, bonus: number) => {
      const um = unitOf(u, energy);
      if (!um || !(value > 0)) return;
      let score = bonus;
      if (/consum|usage|units\s+consumed|energy\s+used|total\s+(?:kwh|energy|units)|billed\s+(?:units|quantity)|net\s+consumption/i.test(line)) score += 5;
      if (/total/i.test(line)) score += 1;
      if (/reading|meter\s+no|previous|present|current\s+read|index/i.test(line)) score -= 4;
      if (/rate|tariff|slab|fils|per\s+(?:kwh|unit)|aed\s*\/|\/\s*kwh|price|charge\s+per/i.test(line)) score -= 6;
      if (/water|imperial|\bIG\b|gallon/i.test(line)) score -= 8;
      if (/average|daily|per\s+day|last\s+year|same\s+period/i.test(line)) score -= 3;
      if (/fuel\s+surcharge|carbon|co2|emission/i.test(line)) score -= 5;
      out.candidates.push({ energy: um.energy, value, unit: um.unit, line: line.trim(), score });
    };
    for (const m of l.matchAll(qre)) {
      const before = l.slice(0, m.index ?? 0);
      if (/(AED|Dhs?|SAR|USD|fils)\s*$/i.test(before)) continue;
      consider(num(m[1]!), m[2]!, l, 0);
    }
    // "Consumption (kWh)" with the value on its own, on the same line after a tab or on the next line.
    const lab = labelOnly.exec(l);
    if (lab && !qre.test(l)) {
      const after = l.slice((lab.index ?? 0) + lab[0].length);
      const same = new RegExp(String.raw`^\s*[:\-]?\s*\t?\s*${NUM_RE}\s*$`).exec(after);
      const next = lines[i + 1] && new RegExp(String.raw`^\s*${NUM_RE}\s*$`).exec(lines[i + 1]!);
      const v = same?.[1] ?? next?.[1];
      if (v) consider(num(v), lab[1]!, `${l.trim()}${same ? '' : ` ${lines[i + 1]!.trim()}`}`, 1);
    }
    qre.lastIndex = 0;
  });
  // Previous / current register readings → consumption, when no total is given.
  const prevR = first([/previous\s*(?:meter\s*)?reading\s*[:\-]?\s*\t?\s*(\d[\d,]*(?:\.\d+)?)(?!\s*[\/.\-]\d)/i], (m) => num(m[1]!));
  const curR = first([/(?:current|present)\s*(?:meter\s*)?reading\s*[:\-]?\s*\t?\s*(\d[\d,]*(?:\.\d+)?)(?!\s*[\/.\-]\d)/i], (m) => num(m[1]!));
  if (prevR && curR && curR.value > prevR.value && !out.candidates.some((c) => c.score >= 4)) {
    const um = unitOf(energy === 'cooling' ? 'TRh' : energy === 'gas' ? 'm3' : 'kWh', energy)!;
    out.candidates.push({ energy: um.energy, value: curR.value - prevR.value, unit: um.unit, line: `${prevR.line} / ${curR.line} (difference)`, score: 3 });
  }
  out.candidates.sort((x, y) => y.score - x.score || y.value - x.value);
  const best = out.candidates[0];
  if (best && best.score > -2) out.quantity = best;

  for (const [k, label] of [['supplier', 'supplier'], ['account', 'account number'], ['periodFrom', 'billing period'], ['quantity', 'consumption'], ['amount', 'amount']] as const) {
    if (!out[k]) out.missing.push(label);
  }
  return out;
}
