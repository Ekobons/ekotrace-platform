/**
 * CSV reading (RFC 4180): quoted fields with commas, quotes ("") and line breaks; CRLF or LF;
 * byte-order mark; delimiter detected (comma, semicolon, tab or pipe — Excel in many
 * European locales saves with semicolons). Rows are produced one at a time, so a large
 * file is never held twice in memory.
 */

/** The delimiter used most consistently in the first lines. */
export function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).slice(0, 20).filter((l) => l.trim());
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const min = Math.min(...counts), max = Math.max(...counts);
    const score = min > 0 ? min * 10 - (max - min) : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
function countOutsideQuotes(line: string, d: string): number {
  let n = 0, q = false;
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
  return n;
}

/** Yields each row as an array of strings. */
export function* csvRows(text: string, delimiter?: string): Generator<string[]> {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter ?? detectDelimiter(text.slice(0, 20000));
  let row: string[] = [], field = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { q = true; i++; continue; }
    if (ch === d) { row.push(field); field = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      row.push(field); field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      if (row.length > 1 || row[0] !== '') yield row;
      row = [];
      continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') yield row; }
}

/** Whole file as objects keyed by the header row. */
export function csvObjects(text: string): Record<string, string>[] {
  const it = csvRows(text);
  const head = it.next();
  if (head.done) return [];
  const cols = head.value.map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const r of it) out.push(Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
  return out;
}
