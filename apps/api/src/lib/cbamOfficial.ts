/**
 * Reading the Commission's published CBAM files as they come:
 *   - "Default values" workbook: an Overview, a Version History, one sheet per country (code, description, direct,
 *     indirect, total, production route), "Other Countries and Territories" and "Annex IV" (highest default values);
 *   - "CBAM Benchmarks" workbook: one "Benchmarks" sheet (CN code, description, column A value and route,
 *     column B value and route; extra routes on the rows below a code).
 * Numbers may be text with a decimal comma; "-", "N/A" and "see below" mean no value.
 */
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Tx } from '../db/pool.js';
import { airports } from './airports.js';
import { cnInfo } from './cbam.js';

export interface OfficialRow {
  kind: 'default' | 'highest' | 'benchmark'; cn: string; country: string | null; value: number;
  direct: number | null; indirect: number | null; route: string | null; basis: 'A' | 'B' | null; description: string;
}
export interface OfficialFile {
  kind: 'defaults' | 'benchmarks'; source: string; version: string | null; legal: string[];
  rows: OfficialRow[];
  countries: { sheet: string; name: string; code: string | null; values: number }[];
  unknown: string[];               // country sheets that could not be matched to a country code
  skipped: { sheet: string; row: number; why: string }[];
}

const text = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return text(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
    return '';
  }
  return String(v);
};
const num = (v: ExcelJS.CellValue): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = text(v).trim();
  if (!s || /^(-|–|—|n\/?a|see below)$/i.test(s)) return null;
  const x = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};
/** "(F)(1)" → "F1", "(C)/(F)" → "C/F", "(A)" → "A". */
export const normRoute = (s: string) => s.split('/').map((p) => [...p.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim()).join('')).filter(Boolean).join('/') || null;

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const ALIAS: [string, string][] = [
  ['korearepublicof', 'KR'], ['southkorea', 'KR'], ['northkorea', 'KP'], ['iranislamicrepublicof', 'IR'], ['turkiye', 'TR'], ['vietnam', 'VN'], ['ivorycoast', 'CI'],
  ['russianfederation', 'RU'], ['congodemocraticrepublicof', 'CD'], ['democraticrepublicofthecongo', 'CD'], ['congo', 'CG'], ['newcaledonia', 'NC'], ['moldovarepublicof', 'MD'],
  ['tanzaniaunitedrepublicof', 'TZ'], ['syrianarabrepublic', 'SY'], ['laopeoplesdemocraticrepublic', 'LA'], ['bruneidarussalam', 'BN'], ['unitedstatesofamerica', 'US'],
  ['taiwan', 'TW'], ['hongkong', 'HK'], ['macao', 'MO'], ['palestine', 'PS'], ['kosovo', 'XK'],
];
export function countryCode(name: string): string | null {
  const f = fold(name);
  if (!f) return null;
  for (const [code, n] of airports().countries) if (fold(n) === f) return code;
  const exact = ALIAS.find(([k]) => k === f);
  if (exact) return exact[1];
  const pre = ALIAS.filter(([k]) => f.startsWith(k)).sort((a, b) => b[0].length - a[0].length)[0];
  if (pre) return pre[1];
  for (const [code, n] of airports().countries) if (f.startsWith(fold(n)) && fold(n).length >= 4) return code;
  return null;
}

const rowsOf = (ws: ExcelJS.Worksheet) => { const out: ExcelJS.CellValue[][] = []; ws.eachRow({ includeEmpty: true }, (r, i) => { out[i - 1] = (r.values as ExcelJS.CellValue[]).slice(1); }); return out; };
const isOther = (s: string) => /^other\s+countries/i.test(s.replace(/^_/, '').trim());

function legalRefs(wb: ExcelJS.Workbook) {
  const all = new Set<string>();
  for (const ws of wb.worksheets.filter((w) => /overview|version/i.test(w.name))) for (const r of rowsOf(ws)) for (const c of r ?? []) for (const m of text(c).matchAll(/\(EU\)\s*(\d{4}\/\d+)/g)) all.add(m[1]!);
  return [...all].filter((x) => x !== '2023/956').sort();
}
/** Merged cells repeat their value on every row they cover: keep each value once. */
const unique = (rows: OfficialRow[]) => { const seen = new Set<string>(); return rows.filter((r) => { const k = [r.kind, r.basis, r.cn, r.country, r.route, r.value].join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); };
function versionOf(wb: ExcelJS.Workbook) {
  const ws = wb.worksheets.find((w) => /version/i.test(w.name));
  if (!ws) return null;
  const rs = rowsOf(ws).filter((r) => r && typeof r[0] === 'number');
  const last = rs[rs.length - 1];
  if (!last) return null;
  const d = last[1] instanceof Date ? (last[1] as Date).toISOString().slice(0, 10) : text(last[1]);
  return `version ${last[0]}${d ? ` of ${d}` : ''}`;
}

/** Recognise and read one of the Commission's files; null when the workbook is something else. */
export async function readOfficial(buf: Buffer): Promise<OfficialFile | null> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { return null; }
  const legal = legalRefs(wb), version = versionOf(wb);
  const skipped: OfficialFile['skipped'] = [];

  const bm = wb.worksheets.find((w) => /^benchmarks?$/i.test(w.name.trim()));
  if (bm && rowsOf(bm).slice(0, 5).some((r) => (r ?? []).some((c) => /column a/i.test(text(c))))) {
    const R = rowsOf(bm);
    const h = R.findIndex((r) => (r ?? []).some((c) => /column a/i.test(text(c))));
    const rows: OfficialRow[] = [];
    let cur: { cn: string; description: string } | null = null;
    for (let i = h + 1; i < R.length; i++) {
      const r = R[i] ?? [];
      const a = text(r[0]).trim();
      if (a) {
        const d = a.replace(/\D/g, '');
        if (/^\d{4,10}$/.test(d) && /^[\d\s]+$/.test(a)) {
          if (!cnInfo(d)) { skipped.push({ sheet: bm.name, row: i + 1, why: `CN ${d} is not a CBAM good` }); cur = null; continue; }
          cur = { cn: d, description: text(r[1]).trim() };
        } else { cur = null; continue; }          // a sector heading
      }
      if (!cur) continue;
      const va = num(r[2]), vb = num(r[4]);
      if (va != null) rows.push({ kind: 'benchmark', basis: 'A', cn: cur.cn, country: null, value: va, direct: null, indirect: null, route: normRoute(text(r[3])), description: cur.description });
      if (vb != null) rows.push({ kind: 'benchmark', basis: 'B', cn: cur.cn, country: null, value: vb, direct: null, indirect: null, route: normRoute(text(r[5])), description: cur.description });
    }
    return { kind: 'benchmarks', legal, version, rows: unique(rows), countries: [], unknown: [], skipped, source: `CBAM benchmarks — Implementing Regulation (EU) ${legal.join(', ') || '2025/2620'} (Commission file${version ? `, ${version}` : ''})` };
  }

  const sheets = wb.worksheets.filter((w) => !/^(overview|version history)$/i.test(w.name.trim()));
  const tables = sheets.map((ws) => ({ ws, R: rowsOf(ws) })).map((x) => ({ ...x, h: x.R.slice(0, 6).findIndex((r) => /cn code/i.test(text((r ?? [])[0]))) })).filter((x) => x.h >= 0);
  if (tables.length < 2) return null;
  const rows: OfficialRow[] = [];
  const countries: OfficialFile['countries'] = [];
  const unknown: string[] = [];
  for (const { ws, R, h } of tables) {
    const title = text((R[0] ?? [])[0]).trim() || ws.name;
    const annexIV = /^annex\s*iv$/i.test(ws.name.trim()) || /^annex\s*iv$/i.test(title);
    const other = isOther(title) || isOther(ws.name);
    const code = annexIV || other ? null : countryCode(title) ?? countryCode(ws.name);
    if (!annexIV && !other && !code) { unknown.push(title); continue; }
    let n = 0;
    for (let i = h + 1; i < R.length; i++) {
      const r = R[i] ?? [];
      const a = text(r[0]).trim();
      const d = a.replace(/\D/g, '');
      if (!/^[\d\s]+$/.test(a) || !/^\d{4,10}$/.test(d)) continue;      // sector headings
      if (!cnInfo(d)) { skipped.push({ sheet: ws.name, row: i + 1, why: `CN ${d} is not a CBAM good` }); continue; }
      const description = text(r[1]).trim();
      if (annexIV) {
        const v = num(r[2]);
        if (v == null) continue;
        rows.push({ kind: 'highest', cn: d, country: null, value: v, direct: null, indirect: null, route: normRoute(text(r[3])), basis: null, description });
      } else {
        const total = num(r[4]);
        if (total == null) continue;                                    // "-": the other-countries value applies
        rows.push({ kind: 'default', cn: d, country: code, value: total, direct: num(r[2]), indirect: num(r[3]), route: normRoute(text(r[5])), basis: null, description });
      }
      n++;
    }
    countries.push({ sheet: ws.name, name: annexIV ? 'Annex IV — highest values' : other ? 'Other countries and territories' : title, code, values: n });
  }
  if (!rows.length) return null;
  return { kind: 'defaults', legal, version, rows: unique(rows), countries, unknown, skipped, source: `Default values — Implementing Regulation (EU) ${legal.join(', ') || '2025/2621'} (Commission file${version ? `, ${version}` : ''})` };
}

/** Replace the shared values of the file's kind(s) with the file's values (platform transaction). */
export async function storeOfficial(c: Tx, o: OfficialFile, by: { id: string | null; name: string }, ip: string | null, year = 2026) {
  const kinds = o.kind === 'defaults' ? ['default', 'highest'] : ['benchmark'];
  const del = await c.query(`DELETE FROM cbam_reference WHERE tenant_id IS NULL AND kind = ANY($1)`, [kinds]);
  const N = 9;
  for (let i = 0; i < o.rows.length; i += 400) {
    const part = o.rows.slice(i, i + 400);
    const vals = part.map((_, k) => `(NULL, ${Array.from({ length: N }, (_, j) => `$${k * N + j + 4}`).join(',')}, $1, $2, false, $3)`).join(',');
    await c.query(`INSERT INTO cbam_reference (tenant_id, kind, cn, country, value, direct, indirect, route, basis, description, year, source, indicative, created_name) VALUES ${vals}`,
      [year, o.source, by.name, ...part.flatMap((r) => [r.kind, r.cn, r.country, r.value, r.direct, r.indirect, r.route, r.basis, r.description.slice(0, 500)])]);
  }
  await c.query(`INSERT INTO audit_log (user_id, user_name, action, entity, detail, ip) VALUES ($1,$2,'cbam.reference.official','cbam_reference',$3,$4)`,
    [by.id, by.name, JSON.stringify({ kind: o.kind, source: o.source, rows: o.rows.length, replaced: del.rowCount }), ip]);
  return { imported: o.rows.length, replaced: del.rowCount ?? 0 };
}

const OFFICIAL = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/cbam/official');
/** Start-up: load the Commission's files shipped with the code that have not been loaded yet (default values first). */
export async function loadShippedOfficial(c: Tx, log: (m: string) => void) {
  let files: string[] = [];
  try { files = readdirSync(OFFICIAL).filter((f) => /\.xlsx$/i.test(f)).sort(); } catch { return; }
  const done = new Set((await c.query(`SELECT sha256 FROM cbam_official_file`)).rows.map((r) => r.sha256 as string));
  for (const f of files) {
    const buf = readFileSync(join(OFFICIAL, f));
    const sha = createHash('sha256').update(buf).digest('hex');
    if (done.has(sha)) continue;
    const o = await readOfficial(buf);
    if (!o || o.unknown.length) { log(`[setup] CBAM: ${f} not recognised${o?.unknown.length ? ` (countries: ${o.unknown.join(', ')})` : ''}`); continue; }
    const r = await storeOfficial(c, o, { id: null, name: 'system (shipped file)' }, null);
    await c.query(`INSERT INTO cbam_official_file (sha256, filename, kind, source, rows) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sha256) DO NOTHING`, [sha, f, o.kind, o.source, r.imported]);
    log(`[setup] CBAM ${o.kind}: ${r.imported} values loaded from ${f}${r.replaced ? ` (${r.replaced} replaced)` : ''}`);
  }
}
