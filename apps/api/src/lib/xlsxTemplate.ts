/**
 * Fill an existing Excel workbook (.xlsx) in place, without loading it into a spreadsheet model.
 *
 * Official templates (such as the EU CBAM communication template) carry formulas, named ranges, data validation,
 * conditional formats, protection and hidden sheets that general-purpose libraries drop or rewrite. Here the
 * package is only unzipped, the XML of the cells being filled is edited, and everything else is written back
 * byte for byte. The workbook is marked to recalculate on open, so every formula reflects the new inputs.
 *
 * Also reads cell values (the cached results Excel saved) from a filled workbook, for importing.
 */
import { inflateRawSync } from 'node:zlib';
import { Zip } from './zip.js';

export type CellValue = string | number | boolean | Date | null | undefined;

interface Entry { name: string; data: Buffer }

/** Reads every file of a zip package (stored or deflated entries). */
export function unzip(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not an Excel (.xlsx) file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged Excel file');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(local + 26), lelen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error('Unsupported compression in Excel file');
    out.push({ name, data });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');

export function colNum(col: string) { let n = 0; for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function colName(n: number) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
const splitRef = (ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) throw new Error(`Bad cell ${ref}`); return { col: colNum(m[1]!), row: Number(m[2]) }; };

/** Excel date serial (1900 system) of a date, at midnight UTC. */
export const excelDate = (d: Date) => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
export const fromExcelDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);

function cellXml(ref: string, style: string | null, v: CellValue): string {
  const s = style ? ` s="${style}"` : '';
  if (v == null || v === '') return `<c r="${ref}"${s}/>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date) return `<c r="${ref}"${s}><v>${excelDate(v)}</v></c>`;
  if (typeof v === 'number') { if (!Number.isFinite(v)) return `<c r="${ref}"${s}/>`; return `<c r="${ref}"${s}><v>${v}</v></c>`; }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

/** One worksheet's XML with an index of its rows, edited cell by cell. */
class SheetXml {
  constructor(public xml: string) {}
  private rowSpan(row: number): { start: number; end: number; open: string; selfClosing: boolean } | null {
    const re = new RegExp(`<row r="${row}"[\\s>/]`);
    const m = re.exec(this.xml);
    if (!m) return null;
    const start = m.index;
    const tagEnd = this.xml.indexOf('>', start);
    const open = this.xml.slice(start, tagEnd + 1);
    if (open.endsWith('/>')) return { start, end: tagEnd + 1, open, selfClosing: true };
    const close = this.xml.indexOf('</row>', tagEnd);
    return { start, end: close + 6, open, selfClosing: false };
  }
  set(ref: string, v: CellValue) {
    const { col, row } = splitRef(ref);
    let span = this.rowSpan(row);
    if (!span) {
      // insert a new row before the first row with a higher number
      const sd = this.xml.indexOf('<sheetData');
      const sdEnd = this.xml.indexOf('</sheetData>');
      let insertAt = sdEnd;
      const re = /<row r="(\d+)"/g; re.lastIndex = sd;
      let m: RegExpExecArray | null;
      while ((m = re.exec(this.xml)) && m.index < sdEnd) { if (Number(m[1]) > row) { insertAt = m.index; break; } }
      if (sdEnd < 0) throw new Error('Worksheet has no data');
      if (this.xml.slice(sd, sd + 13) === '<sheetData/>') { this.xml = this.xml.slice(0, sd) + `<sheetData><row r="${row}">${cellXml(ref, null, v)}</row></sheetData>` + this.xml.slice(sd + 12); return; }
      this.xml = this.xml.slice(0, insertAt) + `<row r="${row}">${cellXml(ref, null, v)}</row>` + this.xml.slice(insertAt);
      return;
    }
    if (span.selfClosing) {
      const open = span.open.slice(0, -2) + '>';
      this.xml = this.xml.slice(0, span.start) + open + cellXml(ref, null, v) + '</row>' + this.xml.slice(span.end);
      return;
    }
    const body = this.xml.slice(span.start, span.end);
    const cre = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>[\s\S]*?<\/c>)/g;
    let m: RegExpExecArray | null;
    let insertRel = body.length - 6; // before </row>
    while ((m = cre.exec(body))) {
      const c = colNum(m[1]!);
      if (c === col) {
        const style = /\ss="(\d+)"/.exec(m[3] ?? '')?.[1] ?? null;
        const next = body.slice(0, m.index) + cellXml(ref, style, v) + body.slice(m.index + m[0].length);
        this.xml = this.xml.slice(0, span.start) + next + this.xml.slice(span.end);
        return;
      }
      if (c > col) { insertRel = m.index; break; }
    }
    const next = body.slice(0, insertRel) + cellXml(ref, null, v) + body.slice(insertRel);
    this.xml = this.xml.slice(0, span.start) + next + this.xml.slice(span.end);
  }
}

function sheetPaths(entries: Entry[]): Map<string, string> {
  const wb = entries.find((e) => e.name === 'xl/workbook.xml')?.data.toString('utf8');
  const rels = entries.find((e) => e.name === 'xl/_rels/workbook.xml.rels')?.data.toString('utf8');
  if (!wb || !rels) throw new Error('Not an Excel workbook');
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1], t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t}`);
  }
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1], id = /r:id="([^"]+)"/.exec(m[0])?.[1];
    if (name && id && target.has(id)) out.set(unesc(name), target.get(id)!);
  }
  return out;
}

/** Writes values into named sheets of a template and returns the new workbook. */
export function fillTemplate(template: Buffer, cells: { sheet: string; ref: string; v: CellValue }[]): Buffer {
  const entries = unzip(template);
  const paths = sheetPaths(entries);
  const edited = new Map<string, SheetXml>();
  for (const c of cells) {
    const path = paths.get(c.sheet);
    if (!path) throw new Error(`Template has no sheet ${c.sheet}`);
    let sx = edited.get(path);
    if (!sx) { sx = new SheetXml(entries.find((e) => e.name === path)!.data.toString('utf8')); edited.set(path, sx); }
    sx.set(c.ref, c.v);
  }
  const zip = new Zip();
  for (const e of entries) {
    if (edited.has(e.name)) zip.add(e.name, edited.get(e.name)!.xml);
    else if (e.name === 'xl/workbook.xml') {
      let x = e.data.toString('utf8');
      x = /<calcPr\b/.test(x) ? x.replace(/<calcPr\b([^>]*?)\s*(\/?)>/, (_m, a: string, sl: string) => `<calcPr${a.replace(/\s(fullCalcOnLoad|forceFullCalc)="[^"]*"/g, '')} fullCalcOnLoad="1"${sl ? '/' : ''}>`) : x.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
      zip.add(e.name, x);
    } else zip.add(e.name, e.data);
  }
  return zip.finish();
}

/** Reads cached values of a filled workbook: get(sheet, ref) → string | number | boolean | null. */
export function readWorkbook(buf: Buffer) {
  const entries = unzip(buf);
  const paths = sheetPaths(entries);
  const ssXml = entries.find((e) => e.name === 'xl/sharedStrings.xml')?.data.toString('utf8') ?? '';
  const shared: string[] = [];
  for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...(m[1] ?? '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1] ?? ''));
    shared.push(parts.join(''));
  }
  const cache = new Map<string, Map<string, string | number | boolean>>();
  const sheet = (name: string) => {
    let s = cache.get(name);
    if (s) return s;
    s = new Map();
    const path = paths.get(name);
    const xml = path ? entries.find((e) => e.name === path)?.data.toString('utf8') ?? '' : '';
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const inner = m[3];
      if (!inner) continue;
      const t = /\st="([^"]+)"/.exec(m[2] ?? '')?.[1];
      const vRaw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let v: string | number | boolean | undefined;
      if (t === 'inlineStr') v = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1] ?? '')).join('');
      else if (vRaw == null) continue;
      else if (t === 's') v = shared[Number(vRaw)] ?? '';
      else if (t === 'str') v = unesc(vRaw);
      else if (t === 'b') v = vRaw === '1';
      else if (t === 'e') continue;
      else v = Number(vRaw);
      if (v === '') continue;
      s.set(m[1]!, v);
    }
    cache.set(name, s);
    return s;
  };
  return {
    sheets: [...paths.keys()],
    get(name: string, ref: string): string | number | boolean | null { return sheet(name).get(ref) ?? null; },
  };
}
export { colName as columnName };
