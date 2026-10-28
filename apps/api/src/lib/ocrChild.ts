/**
 * The OCR process: draws the pages of a scanned PDF and reads them with Tesseract, away from the server process.
 * Started by lib/ocr.ts with a memory limit and killed when a job runs too long, so a hostile or very large PDF can
 * neither freeze nor exhaust the server. Receives { id, data, maxPages } and answers { id, text, pages, confidence } or
 * { id, error } over IPC. Language data comes from @tesseract.js-data/eng (no download).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
type TWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let tw: Promise<TWorker> | null = null;
const getWorker = () => (tw ??= (async () => {
  const { createWorker } = await import('tesseract.js');
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  return createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none', logger: () => {} });
})());

interface Word { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
/** Words back into lines: same baseline → one line, left to right, a wide gap as a tab (as pdfText does). */
export function linesOf(words: Word[], px: number): string[] {
  const ws = words.filter((w) => w.text.trim()).sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const rows: Word[][] = [];
  for (const w of ws) {
    const mid = (w.bbox.y0 + w.bbox.y1) / 2, h = Math.max(4, w.bbox.y1 - w.bbox.y0);
    const row = rows.find((r) => { const r0 = r[0]!; return Math.abs((r0.bbox.y0 + r0.bbox.y1) / 2 - mid) < Math.max(h, r0.bbox.y1 - r0.bbox.y0) * 0.5; });
    if (row) row.push(w); else rows.push([w]);
  }
  return rows.map((r) => {
    r.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let line = '', end = -Infinity;
    for (const w of r) { if (line) line += w.bbox.x0 - end > px * 3 ? '\t' : ' '; line += w.text.trim(); end = w.bbox.x1; }
    return line;
  });
}

const MAX_PIXELS = 4096 * 4096;   // images inside the PDF larger than this are not decoded
async function read(data: Uint8Array, maxPages: number) {
  const task = getDocument({ data, disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0, stopAtErrors: false, maxImageSize: MAX_PIXELS, canvasMaxAreaInBytes: MAX_PIXELS * 4 } as never);
  const doc = await task.promise;
  const lines: string[] = []; let conf = 0, n = 0;
  try {
    const w = await getWorker();
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      if (!(base.width > 0 && base.height > 0) || base.width * base.height > 5e7) throw new Error('page size not readable');
      // about 200 dpi, at most ~3,000 px on the long side
      const scale = Math.min(200 / 72, 3000 / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const cf = (doc as unknown as { canvasFactory: { create: (w: number, h: number) => { canvas: { toBuffer: (t: string) => Buffer }; context: unknown }; destroy: (x: unknown) => void } }).canvasFactory;
      const cc = cf.create(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvasContext: cc.context as never, viewport: vp, canvas: cc.canvas as never }).promise;
      const png = cc.canvas.toBuffer('image/png');
      cf.destroy(cc); page.cleanup();
      const r = await w.recognize(png, {}, { blocks: true, text: true });
      const words: (Word & { confidence: number })[] = [];
      for (const b of r.data.blocks ?? []) for (const para of b.paragraphs) for (const ln of para.lines) for (const wd of ln.words) words.push({ text: wd.text, confidence: wd.confidence, bbox: wd.bbox });
      for (const wd of words) { conf += wd.confidence; n++; }
      lines.push(...linesOf(words, Math.max(6, scale * 4)), '');
    }
  } finally { await task.destroy(); }
  return { text: lines.join('\n'), pages: doc.numPages, confidence: n ? Math.round(conf / n) : 0 };
}

if (process.send) {
  process.on('message', (m: { id: number; data: Uint8Array; maxPages: number }) => {
    read(new Uint8Array(m.data), m.maxPages)
      .then((r) => process.send!({ id: m.id, ...r }))
      .catch((e) => process.send!({ id: m.id, error: (e as Error).message.slice(0, 160) }));
  });
  process.on('disconnect', () => process.exit(0));
}
