/**
 * Text of a PDF, line by line (PDF.js: no fonts loaded, no XFA forms; PDF.js 6 never evaluates code from the file).
 * Pieces of text are grouped into lines by their vertical position and ordered left
 * to right, with a wide gap kept as a tab so label / value columns stay apart.
 * A PDF with (almost) no text is a scan: it needs OCR or manual entry.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pdfText(data: Uint8Array, maxPages = 12): Promise<{ text: string; pages: number; scanned: boolean }> {
  // A copy: PDF.js takes over (detaches) the buffer it is given.
  const task = getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0, stopAtErrors: false });
  const doc = await task.promise;
  const lines: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = new Map<number, { x: number; w: number; s: string }[]>();
      for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
        if (!it.str?.trim()) continue;
        const y = Math.round(it.transform[5]! / 3) * 3;
        (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4]!, w: it.width, s: it.str });
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        const parts = rows.get(y)!.sort((a, b) => a.x - b.x);
        let line = '', end = -Infinity;
        for (const q of parts) {
          if (line) line += q.x - end > 18 ? '\t' : q.x - end > 1.5 ? ' ' : '';
          line += q.s.trim();
          end = q.x + q.w;
        }
        lines.push(line.replace(/[ ]{2,}/g, ' '));
      }
      lines.push('');
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const text = lines.join('\n');
  return { text, pages: doc.numPages, scanned: text.replace(/\s/g, '').length < 40 };
}
