/**
 * Help videos: a script drives the real app on the sample company and the screen is recorded, with a
 * title card, captions and a visible cursor. The webm recording is cut and converted to MP4 (ffmpeg).
 *
 *   APP_URL=http://localhost:4000 VIDEO_EMAIL=… VIDEO_PASSWORD=… node tools/help-videos/record.mjs [name…]
 *
 * Needs: the app running with the sample (demo) company, Playwright (PLAYWRIGHT_MODULE = path to its
 * index.js if not installed here), a Chromium (CHROMIUM_PATH) and ffmpeg on the PATH.
 * Videos go to apps/web/public/help/<name>.mp4 and are shipped with the app.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, '../../apps/web/public/help');
const W = 1280, H = 760;

export async function film(name, title, subtitle, steps, setup) {
  const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  const { chromium } = pw.default ?? pw;
  const tmp = join(HERE, '.rec', name);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  const browser = await chromium.launch({ args: ['--lang=en-GB'], env: { ...process.env, LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB' }, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } }, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Asia/Dubai' });
  const base = process.env.APP_URL ?? 'http://localhost:4000';
  const login = await ctx.request.post(`${base}/api/auth/login`, { data: { email: process.env.VIDEO_EMAIL, password: process.env.VIDEO_PASSWORD } });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  const page = await ctx.newPage();
  const t0 = Date.now();
  let start = 0;
  const v = helpers(page, base);
  try {
    if (setup) await setup(v);                          // data the video needs, before the cut point
    await v.go('/');
    start = (Date.now() - t0) / 1000;
    await v.card(title, subtitle);
    await steps(v);
    await v.say('', 300);
    await v.card(title, 'Done — see the manual for more.', 1800);
  } finally {
    await ctx.close(); await browser.close();
  }
  const webm = readdirSync(tmp).filter((f) => f.endsWith('.webm')).map((f) => join(tmp, f)).sort((a, b) => statSync(b).size - statSync(a).size)[0];
  mkdirSync(OUT, { recursive: true });
  const mp4 = join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, start)), '-i', webm, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart', '-an', mp4]);
  // WebM (VP9) too: Chromium builds without H.264 (some Linux browsers) play this one
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-an', join(OUT, `${name}.webm`)]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '3', '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:-1', join(OUT, `${name}.jpg`)]);
  rmSync(tmp, { recursive: true, force: true });
  return mp4;
}

function helpers(page, base) {
  const wait = (ms) => page.waitForTimeout(ms);
  const overlay = () => page.evaluate(() => {
    if (document.getElementById('hv-cap')) return;
    const cap = document.createElement('div'); cap.id = 'hv-cap';
    cap.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:900px;background:rgba(11,42,37,.93);color:#fff;font:600 17px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:12px 22px;border-radius:14px;z-index:2147483646;box-shadow:0 8px 28px rgba(0,0,0,.28);transition:opacity .35s;opacity:0;text-align:center;pointer-events:none';
    document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = 'hv-cur';
    cur.style.cssText = 'position:fixed;left:640px;top:400px;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:rgba(198,240,107,.55);border:2.5px solid #0E7C66;z-index:2147483647;pointer-events:none;transition:left .75s cubic-bezier(.45,0,.25,1),top .75s cubic-bezier(.45,0,.25,1),transform .18s;box-shadow:0 0 0 6px rgba(198,240,107,.18)';
    document.body.appendChild(cur);
  });
  const v = {
    page, wait,
    async go(path) { await page.goto(base + path); await page.waitForLoadState('networkidle').catch(() => {}); await wait(700); await overlay(); },
    /** full-screen title card */
    async card(title, sub, ms = 2600) {
      await page.evaluate(([t, s]) => {
        const c = document.createElement('div'); c.id = 'hv-card';
        c.style.cssText = 'position:fixed;inset:0;background:linear-gradient(135deg,#0B2A25,#0E7C66);color:#fff;display:grid;place-items:center;z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,sans-serif;opacity:0;transition:opacity .4s';
        c.innerHTML = `<div style="text-align:center;max-width:900px;padding:0 40px"><div style="font:700 14px/1 system-ui;letter-spacing:.14em;color:#C6F06B;margin-bottom:18px">CARBONTEK · HOW TO</div><div style="font:700 44px/1.15 system-ui">${t}</div><div style="font:400 20px/1.5 system-ui;margin-top:16px;color:#d8efe6">${s}</div></div>`;
        document.body.appendChild(c); requestAnimationFrame(() => { c.style.opacity = '1'; });
      }, [title, sub]);
      await wait(ms);
      await page.evaluate(() => { const c = document.getElementById('hv-card'); if (c) { c.style.opacity = '0'; setTimeout(() => c.remove(), 450); } });
      await wait(500);
    },
    async say(text, ms = 2600) {
      await overlay();
      await page.evaluate((t) => { const c = document.getElementById('hv-cap'); c.textContent = t; c.style.opacity = t ? '1' : '0'; }, text);
      if (ms) await wait(ms);
    },
    async point(loc, ms = 850) {
      await overlay();
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      const bx = await loc.boundingBox(); if (!bx) return;
      const x = bx.x + Math.min(bx.width / 2, 120), y = bx.y + bx.height / 2;
      await page.evaluate(([a, b]) => { const k = document.getElementById('hv-cur'); k.style.left = a + 'px'; k.style.top = b + 'px'; }, [x, y]);
      await page.mouse.move(x, y, { steps: 8 });
      await wait(ms);
    },
    async click(loc, ms = 600) {
      await v.point(loc);
      await page.evaluate(() => { const k = document.getElementById('hv-cur'); k.style.transform = 'scale(.65)'; setTimeout(() => { k.style.transform = ''; }, 180); });
      await loc.click(); await wait(ms);
    },
    async type(loc, text, ms = 300) {
      await v.point(loc, 500); await loc.click(); await loc.fill('');
      await loc.pressSequentially(String(text), { delay: 75 });
      await wait(ms);
    },
    async select(loc, value, ms = 700) { await v.point(loc, 600); await loc.selectOption(value); await wait(ms); },
    /** choose files in a (usually hidden) file input; the cursor goes to `at`, the visible drop zone */
    async upload(loc, files, at, ms = 800) { if (at) await v.point(at, 600); await loc.setInputFiles(files); await wait(ms); },
    /** paste text into a field, as Ctrl+V from Excel would */
    async paste(loc, text, ms = 900) {
      await v.point(loc, 500); await loc.click();
      await loc.evaluate((el, t) => { const dt = new DataTransfer(); dt.setData('text', t); dt.setData('text/plain', t); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
      await wait(ms);
    },
    /** a small spreadsheet drawn over the page (the user's Excel), a column highlighted as copied */
    async excel(title, head, rows, col, ms = 2600) {
      await page.evaluate(([t, h, r, c]) => {
        const d = document.createElement('div'); d.id = 'hv-xl';
        d.style.cssText = 'position:fixed;right:36px;top:90px;width:380px;background:#fff;border:1px solid #c9d2cc;border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,.28);z-index:2147483645;font:13px/1.3 Calibri,Segoe UI,system-ui,sans-serif;overflow:hidden;opacity:0;transition:opacity .35s';
        const cell = (x, i, hd) => `<td style="border:1px solid #e1e5e2;padding:5px 8px;${hd ? 'background:#f3f5f4;font-weight:700;' : ''}${i === c && !hd ? 'background:#dff3ea;outline:2px dashed #107c41;outline-offset:-2px;' : ''}${typeof x === 'number' ? 'text-align:right' : ''}">${x}</td>`;
        d.innerHTML = `<div style="background:#107c41;color:#fff;padding:7px 12px;font-weight:700">${t}</div><table style="border-collapse:collapse;width:100%"><tr>${h.map((x, i) => cell(x, i, true)).join('')}</tr>${r.map((row) => `<tr>${row.map((x, i) => cell(x, i, false)).join('')}</tr>`).join('')}</table><div style="padding:6px 10px;color:#555;background:#f8faf9">Selected column → Ctrl+C</div>`;
        document.body.appendChild(d); requestAnimationFrame(() => { d.style.opacity = '1'; });
      }, [title, head, rows, col]);
      await wait(ms);
    },
    async excelClose(ms = 500) { await page.evaluate(() => { const d = document.getElementById('hv-xl'); if (d) { d.style.opacity = '0'; setTimeout(() => d.remove(), 400); } }); await wait(ms); },
    async top(ms = 800) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await wait(ms); },
    /** id of a facility of the sample company, by name */
    async facility(name) {
      const r = await (await page.request.get(`${base}/api/facilities`)).json();
      const f = r.facilities.find((x) => x.name === name); if (!f) throw new Error(`facility ${name} not found`); return f.id;
    },
    /** call the app's API as the signed-in user (setup steps) */
    async api(method, path, data) {
      const r = await page.request.fetch(base + path, { method, data });
      if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
      return r.json();
    },
    /** headless Chromium has no PDF viewer: serve uploaded PDFs as a page showing the first page as an image */
    async pdfAsImage() {
      await page.route(/\/api\/documents\/[0-9a-f-]+$/, async (route) => {
        const res = await route.fetch();
        if (!(res.headers()['content-type'] ?? '').includes('pdf')) return route.fulfill({ response: res });
        const dir = mkdtempSync(join(tmpdir(), 'hv-pdf-'));
        writeFileSync(join(dir, 'a.pdf'), await res.body());
        execFileSync('pdftoppm', ['-png', '-r', '90', '-f', '1', '-l', '1', '-singlefile', join(dir, 'a.pdf'), join(dir, 'a')]);
        const png = readFileSync(join(dir, 'a.png')).toString('base64'); rmSync(dir, { recursive: true, force: true });
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<body style="margin:0;background:#525659;text-align:center"><img src="data:image/png;base64,${png}" style="width:96%;margin:12px auto;box-shadow:0 2px 10px #0006"></body>` });
      });
    },
    async scroll(y, ms = 900) { await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), y); await wait(ms); },
  };
  return v;
}
