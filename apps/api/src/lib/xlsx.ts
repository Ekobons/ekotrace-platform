/**
 * Small helpers for Excel templates and uploads (exceljs).
 *   readSheet(buffer)      first sheet → rows keyed by the header text
 *   sendWorkbook(reply)    stream a workbook as a download
 */
import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';
import { AppError } from './errors.js';

export type Row = Record<string, string>;

export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('').trim();
  if (typeof v === 'object' && 'result' in v) return cellText(v.result as ExcelJS.CellValue);
  if (typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text ?? '').trim();
  return String(v).trim();
}

/** Rows of the first data sheet (or the sheet named), keyed by header (header matched without the trailing "*"). */
export async function readSheet(body: unknown, sheetName?: string): Promise<{ header: string[]; rows: { n: number; row: Row }[] }> {
  if (!Buffer.isBuffer(body) || body.length < 100) throw new AppError('Send the .xlsx file as the request body (Content-Type: application/octet-stream)');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(body as unknown as ArrayBuffer);
  } catch {
    throw new AppError('This is not an Excel (.xlsx) file');
  }
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets[0];
  if (!ws) throw new AppError('The workbook has no sheet');
  const header = ((ws.getRow(1).values as ExcelJS.CellValue[]) ?? []).map((v) => cellText(v).replace(/\s*\*/g, '').trim());
  const rows: { n: number; row: Row }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const row: Row = {};
    let any = false;
    header.forEach((h, i) => {
      if (!h) return;
      const t = cellText(r.getCell(i).value);
      if (t) any = true;
      row[h] = t;
    });
    if (any) rows.push({ n, row });
  });
  if (rows.length > 5000) throw new AppError('At most 5,000 rows per upload');
  return { header, rows };
}

export async function sendWorkbook(reply: FastifyReply, wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  return reply
    .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(Buffer.from(buf));
}

/** Header row styling + column widths; mandatory columns end with "*". */
export function styleHeader(ws: ExcelJS.Worksheet, widths: number[]) {
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C66' } };
  h.alignment = { vertical: 'middle' };
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Excel serial or text date → yyyy-mm-dd (accepts 2026-03-01, 01/03/2026, 1-Mar-2026). */
export function toIsoDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}
