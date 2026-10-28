/**
 * Reading scanned bills (PDFs that are images, no text) on our own server.
 *
 * Each page is drawn with PDF.js onto a canvas (@napi-rs/canvas) at about 200 dpi and read with Tesseract (tesseract.js,
 * WebAssembly). The English language data ships with the app (@tesseract.js-data/eng), so nothing is downloaded and
 * no page leaves the server — no outside OCR or AI service is used (BEEAH data residency, security standard section 5).
 *
 * The work runs in a separate process (lib/ocrChild.ts) with a memory limit: one job at a time, the time limit counted
 * from when the job starts, a short queue, and the process killed (and started again for the next job) when a job runs
 * too long or the process dies — a hostile or oversized PDF cannot freeze or exhaust the server.
 *
 * OCR=off switches it off (a scan is then flagged for typing, as before).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ocrEnabled = () => (process.env.OCR ?? 'on').toLowerCase() !== 'off';
const MAX_WAITING = 3;
const MEMORY_MB = 768;

let child: ChildProcess | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: OcrOut) => void; reject: (e: Error) => void; by?: ChildProcess }>();
type OcrOut = { text: string; pages: number; confidence: number };

/** The OCR process (same runtime and loader as this one: tsx in development, compiled JS in production). */
function proc(): ChildProcess {
  if (child && child.connected && child.exitCode == null) return child;
  const here = fileURLToPath(import.meta.url);
  const file = here.replace(/ocr\.(ts|js)$/, 'ocrChild.$1');
  const c = fork(file, [], { execArgv: [...process.execArgv.filter((a) => !a.startsWith('--max-old-space-size') && !a.startsWith('--test') && !a.startsWith('--watch') && !a.startsWith('--inspect')), `--max-old-space-size=${MEMORY_MB}`], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' });
  c.on('message', (m: { id: number; error?: string } & Partial<OcrOut>) => {
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve({ text: m.text ?? '', pages: m.pages ?? 0, confidence: m.confidence ?? 0 });
  });
  // only the jobs sent to this process fail with it
  c.on('exit', () => { if (child === c) child = null; for (const [id, p] of pending) if (p.by === c) { pending.delete(id); p.reject(new Error('OCR stopped')); } });
  c.on('error', () => { /* reported through exit */ });
  child = c;
  return c;
}
const kill = () => { const c = child; child = null; if (c && c.exitCode == null) c.kill('SIGKILL'); };

/** Stop the OCR process (tests, shutdown). */
export async function stopOcr() { kill(); }

let running: Promise<unknown> = Promise.resolve();
let waiting = 0;
/**
 * Text of a scanned PDF by OCR: up to `maxPages` pages, within `timeoutMs` once started. Returns the text and the
 * average word confidence (0–100); throws when OCR is off, busy, too slow or fails.
 */
export async function ocrPdf(data: Uint8Array, maxPages = 4, timeoutMs = 90_000): Promise<OcrOut> {
  if (!ocrEnabled()) throw new Error('OCR is switched off on this server');
  if (waiting >= MAX_WAITING) throw new Error('OCR is busy with other scans: type the figures, or upload again later');
  waiting++;
  const run = () => new Promise<OcrOut>((resolve, reject) => {
    waiting--;
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); kill(); reject(new Error('OCR took too long')); }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    try { const c = proc(); pending.get(id)!.by = c; c.send({ id, data, maxPages }); } catch (e) { clearTimeout(timer); pending.delete(id); kill(); reject(e as Error); }
  });
  // one job at a time; the next starts when this one ends, however it ends
  const job = running.then(run, run);
  running = job.catch(() => undefined);
  return job;
}
