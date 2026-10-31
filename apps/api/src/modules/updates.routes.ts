/**
 * Weekly updates (platform admin only).
 *
 * The weekly research run (a scheduled Claude task) commits one file per week to
 * data/updates/<YYYY-MM-DD>.json: new emission factor releases, CBAM changes, US CPI, monthly
 * exchange rates, tech and market news, and draft LinkedIn posts. `loadUpdates` reads the files
 * at every start (a changed file is read again; decisions already taken are kept).
 *
 * Nothing changes the factor, rate or index tables by itself:
 *   - exchange rates and the US CPI are applied with one click (Apply), which writes the shared
 *     rates / the annual index exactly as the Currencies & price index screen would;
 *   - factor files and other items say which screen to use and are marked done by hand;
 *   - LinkedIn drafts are approved, rejected or marked posted (nothing is posted from here).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx, type Tx } from '../db/pool.js';
import { audit, requirePlatformAdmin } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';

export const UPDATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/updates');

const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,79}$/, 'key: lower-case letters, digits, . _ - (2–80)');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fxRow = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  perUsd: z.number().positive(),
  source: z.string().trim().min(2).max(300),
});
const cpiRow = z.object({ region: z.string().regex(/^[A-Z]{2}$/).default('US'), year: z.number().int().min(1990).max(2100), value: z.number().positive(), source: z.string().trim().min(2).max(300) });
const apply = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fx'), rows: z.array(fxRow).min(1).max(500) }),
  z.object({ kind: z.literal('cpi'), rows: z.array(cpiRow).min(1).max(20) }),
]);
export const updateFile = z.object({
  week: day,
  summary: z.string().max(2000).default(''),
  items: z.array(z.object({
    key,
    stream: z.enum(['factors', 'cbam', 'cpi', 'fx', 'tech', 'market', 'regulation', 'standards']),
    title: z.string().trim().min(2).max(200),
    detail: z.string().max(4000).default(''),
    impact: z.string().max(2000).default(''),
    published: day.nullish(),
    sources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000) })).max(10).default([]),
    whereTo: z.string().max(300).default(''),
    apply: apply.nullish(),
  })).max(100).default([]),
  linkedin: z.array(z.object({ key, title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(4000) })).max(10).default([]),
});
export type UpdateFile = z.infer<typeof updateFile>;

/** Writes one weekly file: new items are added, existing ones get the new wording but keep their decision. */
export async function storeUpdateFile(c: Tx, name: string, f: UpdateFile, sha256: string) {
  for (const i of f.items) {
    await c.query(
      `INSERT INTO platform_update (key, week, stream, title, detail, impact, published, sources, apply, where_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (key) DO UPDATE SET week = EXCLUDED.week, stream = EXCLUDED.stream, title = EXCLUDED.title, detail = EXCLUDED.detail,
         impact = EXCLUDED.impact, published = EXCLUDED.published, sources = EXCLUDED.sources, where_to = EXCLUDED.where_to,
         apply = CASE WHEN platform_update.status = 'applied' THEN platform_update.apply ELSE EXCLUDED.apply END, loaded_at = now()`,
      [i.key, f.week, i.stream, i.title, i.detail, i.impact, i.published ?? null, JSON.stringify(i.sources), i.apply ? JSON.stringify(i.apply) : null, i.whereTo]);
  }
  for (const p of f.linkedin) {
    await c.query(
      `INSERT INTO platform_update_post (key, week, title, body) VALUES ($1,$2,$3,$4)
       ON CONFLICT (key) DO UPDATE SET week = EXCLUDED.week, title = EXCLUDED.title,
         body = CASE WHEN platform_update_post.status = 'draft' THEN EXCLUDED.body ELSE platform_update_post.body END, loaded_at = now()`,
      [p.key, f.week, p.title, p.body]);
  }
  await c.query(
    `INSERT INTO platform_update_file (name, sha256, week, summary) VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, week = EXCLUDED.week, summary = EXCLUDED.summary, loaded_at = now()`,
    [name, sha256, f.week, f.summary]);
}

/** Every start: loads new or changed files of data/updates. A bad file is reported and skipped. */
export async function loadUpdates(c: Tx, log: (m: string) => void = () => {}, dir = UPDATES_DIR) {
  if (!existsSync(dir)) return 0;
  const known = new Map((await c.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM platform_update_file')).rows.map((r) => [r.name, r.sha256]));
  let n = 0;
  for (const name of readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    const raw = readFileSync(join(dir, name));
    const sha = createHash('sha256').update(raw).digest('hex');
    if (known.get(name) === sha) continue;
    const parsed = updateFile.safeParse((() => { try { return JSON.parse(raw.toString('utf8')); } catch { return null; } })());
    if (!parsed.success) { log(`[updates] ${name} skipped: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`); continue; }
    await storeUpdateFile(c, name, parsed.data, sha);
    n++;
  }
  if (n) log(`[updates] ${n} weekly update file(s) loaded`);
  return n;
}

export async function updatesRoutes(app: FastifyInstance) {
  app.get('/api/platform/updates', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({
      weeks: (await c.query(`SELECT to_char(week,'YYYY-MM-DD') AS week, summary, name, loaded_at FROM platform_update_file ORDER BY week DESC LIMIT 52`)).rows,
      items: (await c.query(
        `SELECT key, to_char(week,'YYYY-MM-DD') AS week, stream, title, detail, impact, to_char(published,'YYYY-MM-DD') AS published, sources, apply,
                where_to AS "whereTo", status, decided_name AS "decidedName", decided_at AS "decidedAt", note
           FROM platform_update ORDER BY week DESC, (status = 'new') DESC, stream, title LIMIT 1000`)).rows,
      posts: (await c.query(
        `SELECT key, to_char(week,'YYYY-MM-DD') AS week, title, body, status, decided_name AS "decidedName", decided_at AS "decidedAt"
           FROM platform_update_post ORDER BY week DESC, key LIMIT 200`)).rows,
    }));
  });

  /** Count for the side menu: open items and drafts. */
  app.get('/api/platform/updates/count', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => (await c.query(
      `SELECT (SELECT count(*)::int FROM platform_update WHERE status = 'new') + (SELECT count(*)::int FROM platform_update_post WHERE status = 'draft') AS open`)).rows[0]);
  });

  /** Apply (exchange rates, CPI), mark done (manual items), dismiss, or reopen. */
  app.post('/api/platform/updates/:key/decide', async (req) => {
    requirePlatformAdmin(req);
    const k = key.parse((req.params as { key: string }).key);
    const b = z.object({ action: z.enum(['apply', 'done', 'dismiss', 'reopen']), note: z.string().trim().max(500).default('') }).parse(req.body);
    return platformTx(async (c) => {
      const u = (await c.query('SELECT key, stream, title, apply, status FROM platform_update WHERE key = $1 FOR UPDATE', [k])).rows[0];
      if (!u) throw notFound('Update');
      if (b.action === 'reopen') {
        if (u.status === 'applied') throw new AppError('Applied rates and indices stay; correct them in Currencies & price index', 409, 'APPLIED');
      } else if (u.status !== 'new') throw new AppError(`Already ${u.status}`, 409, 'DECIDED');
      let written = 0;
      if (b.action === 'apply') {
        const a = u.apply ? apply.parse(u.apply) : null;
        if (!a) throw new AppError('Nothing to apply automatically: use the screen named on the item, then mark it done', 400, 'MANUAL');
        if (a.kind === 'fx') {
          for (const r of a.rows) {
            await c.query(
              `INSERT INTO fx_rate (tenant_id, currency, kind, period, per_usd, source, created_by) VALUES (NULL,$1,'month',$2,$3,$4,$5)
               ON CONFLICT (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), currency, kind, period)
               DO UPDATE SET per_usd = EXCLUDED.per_usd, source = EXCLUDED.source, created_by = EXCLUDED.created_by`,
              [r.currency, `${r.month}-01`, r.perUsd, r.source, req.user.id]);
            written++;
          }
        } else {
          for (const r of a.rows) {
            await c.query(
              `INSERT INTO price_index (region, year, value, source) VALUES ($1,$2,$3,$4)
               ON CONFLICT (region, year) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now()`,
              [r.region, r.year, r.value, r.source]);
            written++;
          }
        }
      }
      const status = { apply: 'applied', done: 'done', dismiss: 'dismissed', reopen: 'new' }[b.action];
      await c.query(
        `UPDATE platform_update SET status = $2, note = $3,
           decided_by = CASE WHEN $2 = 'new' THEN NULL ELSE $4::uuid END, decided_name = CASE WHEN $2 = 'new' THEN NULL ELSE $5 END,
           decided_at = CASE WHEN $2 = 'new' THEN NULL ELSE now() END WHERE key = $1`,
        [k, status, b.note, req.user.id, req.user.name]);
      await audit(c, req, `update.${b.action}`, 'platform_update', k, { title: u.title, stream: u.stream, rows: written, note: b.note || undefined });
      return { key: k, status, rows: written };
    });
  });

  /** LinkedIn drafts: approve, reject, mark posted, or back to draft; the text can be edited while a draft. */
  app.patch('/api/platform/updates/posts/:key', async (req) => {
    requirePlatformAdmin(req);
    const k = key.parse((req.params as { key: string }).key);
    const b = z.object({ status: z.enum(['draft', 'approved', 'rejected', 'posted']).optional(), body: z.string().trim().min(2).max(4000).optional() }).parse(req.body);
    return platformTx(async (c) => {
      const p = (await c.query('SELECT status FROM platform_update_post WHERE key = $1 FOR UPDATE', [k])).rows[0];
      if (!p) throw notFound('Post');
      if (b.body && p.status !== 'draft' && b.status !== 'draft') throw new AppError('Only a draft can be edited', 409, 'NOT_DRAFT');
      const status = b.status ?? p.status;
      await c.query(
        `UPDATE platform_update_post SET status = $2, body = coalesce($3, body),
           decided_by = CASE WHEN $2 = 'draft' THEN NULL ELSE $4::uuid END, decided_name = CASE WHEN $2 = 'draft' THEN NULL ELSE $5 END,
           decided_at = CASE WHEN $2 = 'draft' THEN NULL ELSE now() END WHERE key = $1`,
        [k, status, b.body ?? null, req.user.id, req.user.name]);
      await audit(c, req, 'update.post', 'platform_update_post', k, { status, edited: !!b.body });
      return { key: k, status };
    });
  });
}
