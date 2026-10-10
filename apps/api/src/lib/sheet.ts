/**
 * Reading any table a company exports — CSV (any delimiter, UTF-8 or Windows-1252) or
 * Excel .xlsx (streamed, row by row, so a 200,000-row file never sits in memory as a
 * workbook) — as rows of plain values, plus finding the header row.
 */
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { csvRows } from './csv.js';

export type Cell = string | number | Date | boolean | null;
export type Kind = 'xlsx' | 'csv' | 'xls' | 'unknown';

export function detectKind(buf: Buffer, filename = ''): Kind {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'xlsx';                       // ZIP (PK)
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0) return 'xls';                        // old binary Excel
  if (/\.(csv|txt|tsv)$/i.test(filename) || !buf.subarray(0, 4096).includes(0)) return 'csv';
  return 'unknown';
}

/** UTF-8 when valid, else Windows-1252 (Excel "CSV" on Windows). */
export function decodeText(buf: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}

function cellValue(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return cellValue(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return cellValue(o.text);
    if ('error' in o) return null;
  }
  return String(v);
}

/** The sheets of a workbook with their first rows (for choosing the sheet and the columns). */
export async function previewXlsx(buf: Buffer, maxRows = 40): Promise<{ name: string; rows: Cell[][] }[]> {
  const out: { name: string; rows: Cell[][] }[] = [];
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buf), { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', worksheets: 'emit' } as never);
  for await (const ws of reader as unknown as AsyncIterable<AsyncIterable<{ number: number; values: unknown[] }> & { name: string }>) {
    const rows: Cell[][] = [];
    for await (const row of ws) {
      if (rows.length < maxRows) rows.push(rowValues(row.values, row.number, rows.length));
      // keep reading to reach the next sheet (rows are streamed; nothing is kept)
    }
    out.push({ name: ws.name, rows: rows.filter((r) => r.some((c) => c !== null && c !== '')) });
  }
  return out;
}
/** Excel skips empty rows: keep row positions out of it (we index by order of non-empty rows). */
function rowValues(values: unknown[], _n: number, _i: number): Cell[] {
  const v = (values ?? []).slice(1).map(cellValue);
  while (v.length && (v[v.length - 1] === null || v[v.length - 1] === '')) v.pop();
  return v;
}

/** Every row of one sheet (xlsx) or of the file (csv), in order, empty rows skipped. */
export async function* sheetRows(buf: Buffer, kind: Kind, sheet?: string): AsyncGenerator<Cell[]> {
  if (kind === 'csv') {
    for (const r of csvRows(decodeText(buf))) if (r.some((c) => c.trim() !== '')) yield r;
    return;
  }
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buf), { sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'cache', worksheets: 'emit' } as never);
  let first = true;
  for await (const ws of reader as unknown as AsyncIterable<AsyncIterable<{ number: number; values: unknown[] }> & { name: string }>) {
    const take = sheet ? ws.name === sheet : first;
    first = false;
    for await (const row of ws) {
      if (!take) continue;
      const v = rowValues(row.values, row.number, 0);
      if (v.some((c) => c !== null && c !== '')) yield v;
    }
  }
}

export async function previewFile(buf: Buffer, kind: Kind, maxRows = 40): Promise<{ sheets: { name: string; rows: Cell[][] }[] }> {
  if (kind === 'csv') {
    const rows: Cell[][] = [];
    for (const r of csvRows(decodeText(buf.length > 2_000_000 ? buf.subarray(0, 2_000_000) : buf))) {
      if (r.some((c) => c.trim() !== '')) rows.push(r);
      if (rows.length >= maxRows) break;
    }
    return { sheets: [{ name: 'CSV', rows }] };
  }
  return { sheets: await previewXlsx(buf, maxRows) };
}

/** The header row: the first of the top rows with the most text labels, followed by data. */
export function findHeaderRow(rows: Cell[][]): number {
  let best = 0, bestScore = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const labels = r.filter((c) => typeof c === 'string' && c.trim() !== '' && !/^[\d\s.,()\-/:%]+$/.test(c)).length;
    const filled = r.filter((c) => c !== null && c !== '').length;
    const next = rows[i + 1];
    const followedByData = next ? next.filter((c) => c !== null && c !== '').length >= Math.max(2, Math.floor(filled / 2)) : false;
    const score = labels * 2 + (labels === filled ? 3 : 0) + (followedByData ? 2 : 0);
    if (score > bestScore && labels >= 2) { best = i; bestScore = score; }
  });
  return best;
}

export const cellText = (c: Cell | undefined): string => (c == null ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim();
