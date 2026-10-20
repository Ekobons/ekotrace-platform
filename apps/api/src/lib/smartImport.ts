/**
 * Smart import: a company's own emissions spreadsheet (any layout) → proposed entries.
 *
 *   1. Layout of each sheet (`SheetMap`): which row holds the headings, whether data runs down (one row per entry)
 *      or across (one column per month), which column is the facility, the month or date, the activity, the quantity,
 *      the unit — proposed by the company's AI (first 40 rows) or worked out from the headings, and changeable.
 *   2. Rows: the map applied to every row (totals and blank quantities skipped).
 *   3. Resolution: facility by name (or a remembered answer), activity by the catalogue text match (or a remembered
 *      answer, or the AI choosing among the candidates), unit among the item's units; a dry-run calculation gives
 *      the emissions and any problem; entries already in the platform are marked as duplicates.
 *
 * The AI never invents an item, a facility or a number: it proposes a layout (checked) and picks among candidates.
 */
import { z } from 'zod';
import { buildIndex, classify, normText, type ClassIndex } from '@ekotrace/calc';

import type { Tx } from '../db/pool.js';
import { cellText, findHeaderRow, type Cell } from './sheet.js';
import { aiChat, jsonOf, type AiConfig } from './ai.js';
import { aiChoose } from './aiMap.js';

export const SUPPORTED = ['stationary_combustion', 'mobile_combustion', 'fugitive', 'purchased_electricity', 'water_supply', 'water_discharge', 'waste_generated'];
const ROLES = ['facility', 'date', 'month', 'year', 'description', 'category', 'quantity', 'unit', 'note', 'dataType'] as const;
export type Role = typeof ROLES[number];

export const sheetMapSchema = z.object({
  use: z.boolean().default(true),
  headerRow: z.number().int().min(0).max(200).default(0),
  layout: z.enum(['rows', 'months']).default('rows'),
  cols: z.object(Object.fromEntries(ROLES.map((r) => [r, z.number().int().min(0).max(200).nullable().optional()])) as Record<Role, z.ZodOptional<z.ZodNullable<z.ZodNumber>>>).default({}),
  months: z.array(z.object({ col: z.number().int().min(0).max(200), month: z.string().regex(/^\d{4}-\d{2}$/) })).max(120).default([]),
  constant: z.object({
    facility: z.string().max(200).nullable().optional(), year: z.number().int().min(2000).max(2100).nullable().optional(),
    month: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(), unit: z.string().max(40).nullable().optional(), description: z.string().max(200).nullable().optional(),
  }).default({}),
});
export type SheetMap = z.infer<typeof sheetMapSchema>;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "Jan 2025", "January-25", "2025-01", "01/2025", a date → "2025-01"; a month name alone → with `year`. */
export function monthOf(c: Cell | undefined, year?: number | null): string | null {
  if (c instanceof Date) return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}`;
  if (typeof c === 'number' && c > 20000 && c < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + c * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; }
  const t = cellText(c).toLowerCase();
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(t);
  if (m && +m[2]! >= 1 && +m[2]! <= 12) return `${m[1]}-${pad(+m[2]!)}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m && +m[1]! >= 1 && +m[1]! <= 12) return `${m[2]}-${pad(+m[1]!)}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);   // dd/mm/yyyy
  if (m && +m[2]! >= 1 && +m[2]! <= 12) return `${m[3]}-${pad(+m[2]!)}`;
  m = /^([a-z]{3,9})\.?[\s'’\-/]*(\d{2}|\d{4})?$/.exec(t);
  if (m) {
    const i = MONTHS.indexOf(m[1]!.slice(0, 3));
    if (i >= 0 && (m[1]!.length === 3 || m[1]!.startsWith(MONTHS[i]!))) {
      const y = m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : year;
      return y ? `${y}-${pad(i + 1)}` : null;
    }
  }
  return null;
}
export function numOf(c: Cell | undefined): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const t = cellText(c).replace(/[\s,]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!t || !/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}

/** The layout worked out from the headings (no AI). */
export function guessMap(rows: Cell[][], sheetName: string, defaultYear: number): SheetMap {
  const headerRow = findHeaderRow(rows);
  const head = (rows[headerRow] ?? []).map((c) => cellText(c).toLowerCase());
  const yearInName = /(20\d{2})/.exec(sheetName)?.[1] ?? head.join(' ').match(/(20\d{2})/)?.[1];
  const year = yearInName ? Number(yearInName) : defaultYear;
  const months = head.map((h, col) => ({ col, month: monthOf(rows[headerRow]?.[col] ?? h, year) })).filter((x): x is { col: number; month: string } => !!x.month);
  const find = (re: RegExp, not?: RegExp) => { const i = head.findIndex((h, k) => re.test(h) && !(not?.test(h)) && !months.some((m) => m.col === k)); return i >= 0 ? i : null; };
  const cols: SheetMap['cols'] = {
    facility: find(/site|facility|location|plant|branch|entity|building|office|depot|premises/),
    date: find(/date|period|billing/, /year/),
    month: find(/^month|month$/),
    year: find(/^year$|^fy|financial year|reporting year/),
    description: find(/fuel|source|activity|description|item|material|refrigerant|gas|energy type|type|stream|commodity/, /unit|scope|data type/),
    category: find(/category|scope|group|class/),
    quantity: find(/qty|quantity|consumption|usage|volume|total|reading|tonnes|litres|kwh|top.?up|refill|recharge|weight|\(kg\)|\(t\)|\(m3\)|\(l\)/, /unit|date|cost|price|aed|usd|amount/),
    unit: find(/^unit|uom|units$|^unit of measure/),
    note: find(/note|comment|remark|reference|invoice|bill no/),
    dataType: find(/data type|actual|estimate/),
  };
  if (cols.date != null && cols.date === cols.month) cols.month = null;
  // no quantity heading: the column that is (mostly) numbers in the rows below, not a year, a date or money
  if (cols.quantity == null && months.length < 3) {
    const used = new Set(Object.values(cols).filter((x): x is number => x != null));
    const data = rows.slice(headerRow + 1, headerRow + 21);
    const width = Math.max(0, ...data.map((r) => r.length));
    for (let k = 0; k < width && cols.quantity == null; k++) {
      if (used.has(k) || /amount|cost|price|aed|usd|eur|sar|value \(|year|account|no\.?$|number|code|id$/.test(head[k] ?? '')) continue;
      const vals = data.map((r) => r[k]).filter((v) => v != null && v !== '');
      const nums = vals.filter((v) => typeof v === 'number' || numOf(v) != null).map((v) => numOf(v)!);
      if (vals.length >= 1 && nums.length / vals.length >= 0.6 && !nums.every((x) => x >= 1990 && x <= 2100 && Number.isInteger(x))) cols.quantity = k;
    }
  }
  const layout: SheetMap['layout'] = months.length >= 3 ? 'months' : 'rows';
  return { use: layout === 'months' || cols.quantity != null, headerRow, layout, cols: layout === 'months' ? { ...cols, quantity: null, date: null, month: null } : cols, months: layout === 'months' ? months : [],
    constant: { year: cols.year == null && !months.length ? year : null, description: cols.description == null ? sheetName : null } };
}

/** The layout proposed by the company's AI from the first 40 rows; null if it gives nothing usable. */
export async function aiMap(ai: AiConfig, name: string, rows: Cell[][], facilities: string[], defaultYear: number): Promise<SheetMap | null> {
  const sample = rows.slice(0, 40).map((r) => r.slice(0, 30).map((c) => cellText(c).slice(0, 50)));
  const system = 'You read company spreadsheets of greenhouse-gas activity data (fuel, electricity, refrigerants, water, waste) and describe their layout. ' +
    'Reply with JSON only: {"use":bool,"headerRow":n,"layout":"rows"|"months","cols":{"facility":n|null,"date":n|null,"month":n|null,"year":n|null,"description":n|null,"category":n|null,"quantity":n|null,"unit":n|null,"note":n|null,"dataType":n|null},' +
    '"months":[{"col":n,"month":"YYYY-MM"}],"constant":{"facility":str|null,"year":n|null,"month":"YYYY-MM"|null,"unit":str|null,"description":str|null}}. ' +
    'Indexes are 0-based positions in the rows given. "rows" = one entry per row with a quantity column; "months" = one column per month (list them in "months"). ' +
    'Use "constant" for values written once (e.g. a facility or year in the title, a unit in a heading). use=false for sheets with no activity quantities (notes, summaries, factors, charts data).';
  const user = JSON.stringify({ sheet: name, facilitiesOfTheCompany: facilities.slice(0, 60), defaultYear, rows: sample });
  const text = await aiChat(ai, system, user, { json: true, maxTokens: 1500 });
  const parsed = sheetMapSchema.safeParse(jsonOf(text));
  if (!parsed.success) return null;
  const m = parsed.data;
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (const r of ROLES) if (m.cols[r] != null && m.cols[r]! >= width) m.cols[r] = null;
  m.months = m.months.filter((x) => x.col < width);
  if (m.headerRow >= rows.length) m.headerRow = 0;
  return m;
}

export interface ProposedRow { rowNo: number; col: number | null; facilityText: string | null; periodStart: string | null; periodEnd: string | null; description: string | null; categoryText: string | null; quantity: number; unitText: string | null; note: string | null; dataType: string; problems: string[] }

const TOTAL = /^(grand\s+)?(sub\s*-?\s*)?total|^sum\b|^average\b/i;
/** Every row of a sheet through its map. */
export function applyMap(rows: Cell[][], m: SheetMap): ProposedRow[] {
  if (!m.use) return [];
  const out: ProposedRow[] = [];
  const head = rows[m.headerRow] ?? [];
  const unitInHeading = (col: number | null | undefined) => (col == null ? null : /\(([^)]{1,15})\)\s*$/.exec(cellText(head[col]))?.[1] ?? null);
  const get = (r: Cell[], k: Role) => (m.cols[k] == null ? undefined : r[m.cols[k]!]);
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const desc = cellText(get(r, 'description')) || m.constant.description || null;
    const fac = cellText(get(r, 'facility')) || m.constant.facility || null;
    if ((desc && TOTAL.test(desc)) || (fac && TOTAL.test(fac)) || r.some((c) => typeof c === 'string' && TOTAL.test(c.trim()) && r.indexOf(c) < 2)) continue;
    const base = {
      rowNo: i + 1, facilityText: fac, description: desc, categoryText: cellText(get(r, 'category')) || null,
      note: cellText(get(r, 'note')) || null, dataType: /estim/i.test(cellText(get(r, 'dataType'))) ? 'estimated' : /proxy/i.test(cellText(get(r, 'dataType'))) ? 'proxy' : 'actual',
    };
    const unitFor = (col: number | null | undefined) => cellText(get(r, 'unit')) || m.constant.unit || unitInHeading(col) || null;
    const period = (month: string | null, wholeYear?: number | null) => {
      if (month) { const [y, mm] = month.split('-').map(Number); return { periodStart: `${month}-01`, periodEnd: `${month}-${pad(lastDay(y!, mm!))}` }; }
      if (wholeYear) return { periodStart: `${wholeYear}-01-01`, periodEnd: `${wholeYear}-12-31` };
      return { periodStart: null, periodEnd: null };
    };
    if (m.layout === 'months') {
      for (const mc of m.months) {
        const q = numOf(r[mc.col]);
        if (q == null || q === 0) continue;
        out.push({ ...base, col: mc.col, ...period(mc.month), quantity: q, unitText: unitFor(null), problems: [] });
      }
      continue;
    }
    const q = numOf(get(r, 'quantity'));
    if (q == null || q === 0) continue;
    const y = numOf(get(r, 'year')) ?? m.constant.year ?? null;
    const month = monthOf(get(r, 'date'), y) ?? monthOf(get(r, 'month'), y) ?? m.constant.month ?? null;
    const p = period(month, month ? null : y);
    out.push({ ...base, col: m.cols.quantity ?? null, ...p, quantity: q, unitText: unitFor(m.cols.quantity), problems: p.periodStart ? [] : ['No month or year: set the date column or a year'] });
  }
  return out;
}

// ------------------------------------------------------------ resolution --
export interface CatItem { id: number; name: string; code: string; category: string; calc_method: string; units: string[]; attrs: Record<string, unknown>; tokens: string[]; alias: string }
export interface UnitRow { code: string; name: string; dimension: string; aliases: string[] }
export interface Catalogue { items: CatItem[]; index: ClassIndex; byId: Map<number, CatItem>; units: UnitRow[]; fuels: ClassIndex; factorUnits: Map<number, Set<string>> }

export async function loadCatalogue(c: Tx): Promise<Catalogue> {
  const items = (await c.query(
    `SELECT i.id, i.name, i.code, i.aliases, i.attrs, s.units, s.name AS sub, c.code AS category, c.name AS cat_name, c.calc_method
       FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
      WHERE i.active AND s.active AND c.active AND c.code = ANY($1)`, [SUPPORTED])).rows;
  const units = (await c.query(`SELECT code, name, dimension, aliases FROM unit WHERE active`)).rows as UnitRow[];
  const list: CatItem[] = items.map((r) => ({ id: r.id, name: r.name, code: r.code, category: r.category, calc_method: r.calc_method, units: r.units ?? [], attrs: r.attrs ?? {},
    tokens: words(r.name), alias: ` ${(r.aliases ?? []).join(' ').toLowerCase()} ${String(r.sub ?? '').toLowerCase()} ` }));
  const fu = (await c.query(`SELECT item_id, array_agg(DISTINCT unit) AS units FROM factor WHERE status = 'active' AND item_id = ANY($1) GROUP BY 1`, [list.map((i) => i.id)])).rows;
  return {
    items: list, byId: new Map(list.map((i) => [i.id, i])), units, factorUnits: new Map(fu.map((r) => [r.item_id as number, new Set(r.units as string[])])),
    index: buildIndex(items.map((r) => ({ id: r.id, name: `${r.name} ${r.cat_name}`, aliases: r.aliases, group: r.sub }))),
    fuels: buildIndex(items.filter((r) => r.calc_method === 'combustion').map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, group: r.sub }))),
  };
}

const n = (s: string) => s.toLowerCase().replace(/[\s._()]/g, '').replace('³', '3').replace('²', '2');
/** The unit for an item from what the sheet says ("Litres", "kWh", "MT", "m3"…). */
export function unitFor(cat: Catalogue, item: CatItem, text: string | null): string | null {
  const allowed = item.units;
  if (!text) return allowed.length === 1 ? allowed[0]! : null;
  const t = n(text);
  const hits = cat.units.filter((u) => n(u.code) === t || n(u.name) === t || u.aliases.some((a) => n(a) === t) || (t.startsWith(n(u.code)) && t.length - n(u.code).length <= 3 && /^(kwh|mwh|gj|mj)/.test(t)));
  const inItem = hits.find((u) => allowed.includes(u.code));
  if (inItem) return inItem.code;
  // "kWh" on electricity means kWh (electricity), on cooling kWh (cooling)…
  for (const h of hits) { const v = allowed.find((a) => a.startsWith(`${h.code}_`)); if (v) return v; }
  const dims = new Set(cat.units.filter((u) => allowed.includes(u.code)).map((u) => u.dimension));
  return hits.find((u) => dims.has(u.dimension))?.code ?? null;
}

const STOP = new Set(['the', 'and', 'of', 'for', 'used', 'use', 'consumption', 'consumed', 'total', 'qty', 'quantity', 'monthly', 'month', 'usage', 'in', 'at', 'by', 'from', 'to', 'per', 'litres', 'liters', 'litre', 'liter', 'kg', 'kwh', 'mwh', 'm3', 'tonnes', 'tons', 'units']);
export const words = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

/**
 * Candidate items for an activity description: words of the description found in the item's name (most), at the
 * start of it, in its aliases or subcategory; shorter names first on a tie. Only items whose units and factors
 * fit the unit given; confidence = share of the description explained × how clearly the best beats the next.
 */
export function candidates(cat: Catalogue, description: string, categoryText: string | null, unitText: string | null) {
  const w = words(`${description} ${categoryText ?? ''}`);
  const dw = words(description);
  if (!w.length) return { best: null, confidence: 0, list: [] as { itemId: number; score: number }[] };
  const fits = (it: CatItem) => {
    if (!unitText) return true;
    const u = unitFor(cat, it, unitText);
    if (!u) return false;
    const fu = cat.factorUnits.get(it.id);
    if (!fu || !fu.size) return true;   // electricity, heat…: factors by grid region, not by item
    const dim = cat.units.find((x) => x.code === u)?.dimension;
    return [...fu].some((x) => x === u || cat.units.find((y) => y.code === x)?.dimension === dim);
  };
  const scored = cat.items.map((it) => {
    let s = 0, hit = 0;
    for (const x of w) {
      const inName = it.tokens.includes(x) || (x.length >= 4 && it.tokens.some((t) => t.startsWith(x) || x.startsWith(t) && t.length >= 4));
      if (inName) { s += dw.includes(x) ? 3 : 1.5; if (dw.includes(x)) hit++; } else if (it.alias.includes(` ${x}`)) { s += 1; if (dw.includes(x)) hit += 0.5; }
    }
    if (it.tokens[0] && it.tokens[0] === dw[0]) s += 1;
    return { it, s: s - 0.05 * it.tokens.length, hit };
  }).filter((x) => x.s > 0.5).sort((a, b) => b.s - a.s);
  const ok = scored.filter((x) => fits(x.it));
  const list = (ok.length ? ok : scored).slice(0, 8).map((x) => ({ itemId: x.it.id, score: Math.round(x.s * 100) / 100 }));
  if (!ok.length) return { best: null, confidence: 0, list };
  const top = ok[0]!, next = ok.find((x) => x.it.name !== top.it.name);
  const coverage = Math.min(1, top.hit / Math.max(1, dw.length));
  const margin = next ? (top.s - next.s) / top.s : 1;
  return { best: top.it.id, confidence: Math.round(coverage * (0.55 + 0.45 * Math.min(1, margin * 4)) * 1000) / 1000, list };
}

/** The entry to calculate for a resolved row (null with the reason when it cannot be built). */
export function bodyOf(cat: Catalogue, r: { item_id: number; unit: string; quantity: number; period_start: string; period_end: string; facility_id: string; description: string | null; data_type: string; note: string | null }):
  { body: Record<string, unknown> } | { problem: string } {
  const it = cat.byId.get(r.item_id);
  if (!it) return { problem: 'Activity not supported by smart import' };
  const base = { facilityId: r.facility_id, itemId: it.id, unit: r.unit, periodStart: r.period_start, periodEnd: r.period_end, dataType: r.data_type, note: r.note ?? undefined };
  if (it.calc_method === 'fugitive') return { body: { ...base, fugitive: { method: 'quantity', released: r.quantity } } };
  if (it.calc_method === 'vehicle') {
    const dim = cat.units.find((u) => u.code === r.unit)?.dimension;
    if (dim === 'distance') return { body: { ...base, quantity: r.quantity, vehicle: { method: 'distance' } } };
    if (dim === 'electricity') return { body: { ...base, quantity: r.quantity, vehicle: { method: 'electricity' } } };
    if (it.attrs.fuel) return { body: { ...base, quantity: r.quantity, vehicle: { method: 'fuel' } } };
    const f = classify(cat.fuels, r.description ?? '', 1);
    if (!f.itemId) return { problem: 'Vehicle fuel not known: choose a vehicle type with its fuel' };
    return { body: { ...base, quantity: r.quantity, vehicle: { method: 'fuel', fuelItemId: f.itemId } } };
  }
  return { body: { ...base, quantity: r.quantity } };
}

/** AI choice among catalogue candidates for activity descriptions (only the description and candidate names are sent). */
export async function aiItems(ai: AiConfig, cat: Catalogue, groups: { key: string; text: string; candidates: number[] }[]) {
  return aiChoose(ai, groups.map((g) => ({ key: g.key, text: g.text, candidates: g.candidates.slice(0, 8).map((id) => ({ id, name: `${cat.byId.get(id)?.name ?? ''} (${cat.byId.get(id)?.category.replace(/_/g, ' ') ?? ''})` })) })),
    { system: 'You match company activity descriptions (fuels, electricity, refrigerants, water, waste, vehicles) to items of a greenhouse-gas catalogue. For each line choose the single best item id from its candidates, or null if none fits; the unit is given after "|". Reply with JSON only: {"results":[{"key":"…","id":123 or null,"confidence":0.0-1.0}]}' });
}

export const keyOf = (description: string | null, unitText: string | null) => `${normText(description ?? '') || '(blank)'}|${(unitText ?? '').toLowerCase().trim()}`;
