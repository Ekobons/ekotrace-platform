/**
 * Reading scanned bills (PDFs that are images, no text) on our own server.
 *
 * Each page is drawn with PDF.js onto a canvas (@napi-rs/canvas) at about 200 dpi and read with Tesseract (tesseract.js,
 * WebAssembly). The English language data ships with the app (@tesseract.js-data/eng), so nothing is downloaded and
 * no page leaves the server — no outside OCR or AI service is used (BEEAH data residency, security standard section 5).
 *
 * Words are put back into lines by their position, with a wide gap kept as a tab, as pdfText() does for text PDFs, so
 * the same bill reader works on both. What OCR reads is marked as such and every figure is checked by a person
 * against the page before the bill is booked.
 *
 * OCR=off switches it off (a scan is then flagged for typing, as before).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;
let worker: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

export const ocrEnabled = () => (process.env.OCR ?? 'on').toLowerCase() !== 'off';

async function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
      // local language data, no cache written, no network
      return createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none', logger: () => {}, errorHandler: () => {} });
    })();
    worker.catch(() => { worker = null; });
  }
  return worker;
}

/** Stop the OCR worker (tests, shutdown). */
export async function stopOcr() { if (worker) { const w = await worker.catch(() => null); worker = null; await w?.terminate(); } }

interface Word { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/** Words back into lines: same baseline → one line, ordered left to right, a wide gap as a tab. */
function linesOf(words: Word[], px: number): string[] {
  const ws = words.filter((w) => w.text.trim()).sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1));
  const rows: Word[][] = [];
  for (const w of ws) {
    const mid = (w.bbox.y0 + w.bbox.y1) / 2, h = Math.max(4, w.bbox.y1 - w.bbox.y0);
    const row = rows.find((r) => { const r0 = r[0]!; const m = (r0.bbox.y0 + r0.bbox.y1) / 2; return Math.abs(m - mid) < Math.max(h, r0.bbox.y1 - r0.bbox.y0) * 0.5; });
    if (row) row.push(w); else rows.push([w]);
  }
  return rows.map((r) => {
    r.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let line = '', end = -Infinity;
    for (const w of r) { if (line) line += w.bbox.x0 - end > px * 3 ? '\t' : ' '; line += w.text.trim(); end = w.bbox.x1; }
    return line;
  });
}

/**
 * Text of a scanned PDF by OCR: up to `maxPages` pages, within `timeoutMs`. Returns the text and the average word
 * confidence (0–100); throws when OCR is off or fails.
 */
export async function ocrPdf(data: Uint8Array, maxPages = 4, timeoutMs = 90_000): Promise<{ text: string; pages: number; confidence: number }> {
  if (!ocrEnabled()) throw new Error('OCR is switched off on this server');
  const run = async () => {
    const task = getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0, stopAtErrors: false });
    const doc = await task.promise;
    const lines: string[] = []; let conf = 0, n = 0;
    try {
      const w = await getWorker();
      for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        // about 200 dpi, at most ~3,000 px on the long side
        const scale = Math.min(200 / 72, 3000 / Math.max(base.width, base.height));
        const vp = page.getViewport({ scale });
        const cf = (doc as unknown as { canvasFactory: { create: (w: number, h: number) => { canvas: { toBuffer: (t: string) => Buffer }; context: unknown }; destroy: (x: unknown) => void } }).canvasFactory;
        const cc = cf.create(Math.ceil(vp.width), Math.ceil(vp.height));
        await page.render({ canvasContext: cc.context as never, viewport: vp, canvas: cc.canvas as never }).promise;
        const png = cc.canvas.toBuffer('image/png');
        cf.destroy(cc);
        page.cleanup();
        const r = await w.recognize(png, {}, { blocks: true, text: true });
        const words: Word[] = [];
        for (const b of r.data.blocks ?? []) for (const para of b.paragraphs) for (const ln of para.lines) for (const wd of ln.words) words.push({ text: wd.text, confidence: wd.confidence, bbox: wd.bbox });
        for (const wd of words) { conf += wd.confidence; n++; }
        lines.push(...linesOf(words, Math.max(6, scale * 4)), '');
      }
    } finally {
      await task.destroy();
    }
    return { text: lines.join('\n'), pages: doc.numPages, confidence: n ? Math.round(conf / n) : 0 };
  };
  // one page at a time across requests (Tesseract is single-threaded); a stuck job does not hold the server
  const job = queue.then(run, run);
  queue = job.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([job, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('OCR took too long')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}
