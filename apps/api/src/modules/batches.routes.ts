/**
 * Batch runs (Capture · RFP 3.3.3, 3.3.5, 3.3.6, 6.2).
 *
 *   GET  /api/batches?days=                          sources and their health, batches with reconciliation status, transfers, failed jobs
 *   GET  /api/batches/purchase/:id                   a purchase batch's reconciliation: source control totals → received → outcome → entries
 *   PUT  /api/batches/purchase/:id/control           the source system's control totals (line count, total per currency)
 *   POST /api/batches/purchase/:id/retry             run failed processing again
 *   GET  /api/batches/readings/:id                   a meter-readings batch: received, refused (reasons), new / corrections / duplicates / conflicts
 *   GET  /api/batches/transfers/:id                  one transfer with the records refused and why
 *   PUT  /api/batches/sources/:id {expectHours}      how often a connected system is expected to send (alerts when it goes quiet)
 *
 * A batch reconciles when the platform received what the source says it sent (lines and totals), every line has
 * an outcome (published, excluded with a reason, or a problem), every published line is in an entry, and the
 * entries hold the same emissions as the published lines.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { enqueue } from '../lib/jobs.js';
import { SOURCE_TEXT } from '../lib/integrations.js';
import { controlSchema } from './purchases/purchases.routes.js';

const VIEW = ['super_admin', 'admin', 'manager', 'verifier', 'platform_admin'] as const;
const ALL = ['super_admin', 'admin', 'verifier', 'platform_admin'];
const ENTRY_T = `(a.co2e_direct + a.co2e_scope2 + a.co2e_scope3 + a.co2e_wtt + coalesce(a.co2e_td, 0))`;
const OPEN = `('new','unmapped','flagged','check','ready')`;

interface Stats {
  status: string; lines: number; problem: number; excluded: number; dup: number; pending: number; published: number; pubKg: number; noEntry: number;
  entries: number; approved: number; entryKg: number; amounts: Record<string, number>; control: { lines?: number; amounts?: Record<string, number>; by?: string; at?: string } | null;
}
export interface Check { id: string; name: string; ok: boolean | null; detail: string }

/** The reconciliation checks of a purchase batch, and its overall state. */
export function checks(s: Stats): { checks: Check[]; state: 'balanced' | 'differences' | 'open' | 'no_control' | 'failed' } {
  const f = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  const out: Check[] = [];
  const ctl = s.control;
  out.push(ctl?.lines !== undefined
    ? { id: 'lines', name: 'Lines received = lines the source sent', ok: s.lines === ctl.lines, detail: `source ${f(ctl.lines)} · received ${f(s.lines)}${s.lines !== ctl.lines ? ` · difference ${f(s.lines - ctl.lines)}` : ''}` }
    : { id: 'lines', name: 'Lines received = lines the source sent', ok: null, detail: `received ${f(s.lines)} · no control total from the source` });
  if (ctl?.amounts && Object.keys(ctl.amounts).length) {
    for (const [cur, v] of Object.entries(ctl.amounts)) {
      const got = s.amounts[cur] ?? 0;
      out.push({ id: `amount:${cur}`, name: `Total ${cur} received = source total`, ok: Math.abs(got - v) <= 0.01 + Math.abs(v) * 1e-9, detail: `source ${f(v)} · received ${f(got)}${Math.abs(got - v) > 0.01 ? ` · difference ${f(got - v)}` : ''}` });
    }
  } else out.push({ id: 'amount', name: 'Totals received = source totals', ok: null, detail: Object.entries(s.amounts).map(([k, v]) => `${k} ${f(v)}`).join(' · ') || 'no amounts' });
  const done = s.status === 'published';
  out.push({ id: 'outcome', name: 'Every line has an outcome (published, excluded or a problem)', ok: s.pending === 0 ? true : done ? false : null,
    detail: `${f(s.published)} published · ${f(s.excluded - s.dup)} excluded · ${f(s.dup)} duplicates · ${f(s.problem)} problems · ${f(s.pending)} still in review` });
  out.push({ id: 'entries', name: 'Every published line is in an entry', ok: s.published ? s.noEntry === 0 : null, detail: s.published ? `${f(s.published - s.noEntry)} of ${f(s.published)} lines in ${s.entries} entr${s.entries === 1 ? 'y' : 'ies'}` : 'nothing published yet' });
  const tol = Math.max(1, s.pubKg * 0.001);
  out.push({ id: 'co2e', name: 'Entries hold the emissions of the published lines', ok: s.published ? Math.abs(s.entryKg - s.pubKg) <= tol : null,
    detail: s.published ? `lines ${f(s.pubKg / 1000)} t · entries ${f(s.entryKg / 1000)} t${Math.abs(s.entryKg - s.pubKg) > tol ? ` · difference ${f((s.entryKg - s.pubKg) / 1000)} t` : ''}` : '—' });
  out.push({ id: 'approved', name: 'Entries approved', ok: s.entries ? s.approved === s.entries ? true : null : null, detail: s.entries ? `${s.approved} of ${s.entries} approved` : '—' });
  const hard = out.filter((c) => c.id !== 'approved');
  const state = s.status === 'failed' ? 'failed' : hard.some((c) => c.ok === false) ? 'differences' : !done ? 'open' : !ctl ? 'no_control' : 'balanced';
  return { checks: out, state };
}

const STATS_SQL = (where: string) => `
  SELECT b.id, b.name, b.source, b.external_ref, b.status, b.error, b.created_at, b.published_at, b.created_by, b.control, u.name AS created_by_name,
         coalesce(s.lines, 0) AS lines, coalesce(s.problem, 0) AS problem, coalesce(s.excluded, 0) AS excluded, coalesce(s.dup, 0) AS dup, coalesce(s.pending, 0) AS pending,
         coalesce(s.published, 0) AS published, coalesce(s.pub_kg, 0) AS pub_kg, coalesce(s.no_entry, 0) AS no_entry, coalesce(m.amounts, '{}') AS amounts,
         coalesce(e.n, 0) AS entries, coalesce(e.approved, 0) AS approved, coalesce(e.kg, 0) AS entry_kg, s.visible,
         j.id AS job_id, j.kind AS job_kind, j.status AS job_status, j.error AS job_error, j.attempts AS job_attempts
    FROM purchase_batch b LEFT JOIN app_user u ON u.id::text = b.created_by
    LEFT JOIN LATERAL (SELECT count(*)::int AS lines, count(*) FILTER (WHERE l.status = 'problem')::int AS problem, count(*) FILTER (WHERE l.status = 'excluded')::int AS excluded,
                              count(*) FILTER (WHERE l.status = 'excluded' AND l.dup_of IS NOT NULL)::int AS dup, count(*) FILTER (WHERE l.status IN ${OPEN})::int AS pending,
                              count(*) FILTER (WHERE l.status = 'published')::int AS published, coalesce(sum(l.co2e) FILTER (WHERE l.status = 'published'), 0)::float8 AS pub_kg,
                              count(*) FILTER (WHERE l.status = 'published' AND (l.activity_id IS NULL OR NOT EXISTS (SELECT 1 FROM activity x WHERE x.id = l.activity_id)))::int AS no_entry,
                              bool_and(l.facility_id IS NULL OR l.facility_id = ANY($1)) AS visible
                         FROM purchase_line l WHERE l.batch_id = b.id) s ON true
    LEFT JOIN LATERAL (SELECT jsonb_object_agg(cur, amt) AS amounts FROM (SELECT coalesce(l.currency, b.settings->>'currency', '—') AS cur, sum(l.amount)::float8 AS amt
                         FROM purchase_line l WHERE l.batch_id = b.id AND l.amount IS NOT NULL GROUP BY 1) z) m ON true
    LEFT JOIN LATERAL (SELECT count(*)::int AS n, count(*) FILTER (WHERE a.status = 'approved')::int AS approved, coalesce(sum(${ENTRY_T}), 0)::float8 AS kg
                         FROM activity a WHERE a.purchase_batch_id = b.id) e ON true
    LEFT JOIN LATERAL (SELECT id, kind, status, error, attempts FROM job WHERE ref = b.id ORDER BY id DESC LIMIT 1) j ON true
   WHERE ${where}`;

const toStats = (r: Record<string, unknown>): Stats => ({
  status: r.status as string, lines: r.lines as number, problem: r.problem as number, excluded: r.excluded as number, dup: r.dup as number, pending: r.pending as number,
  published: r.published as number, pubKg: r.pub_kg as number, noEntry: r.no_entry as number, entries: r.entries as number, approved: r.approved as number, entryKg: r.entry_kg as number,
  amounts: r.amounts as Record<string, number>, control: (r.control as Stats['control']) ?? null,
});

async function seesBatch(c: Tx, req: FastifyRequest, row: { visible: boolean | null; created_by: string | null }) {
  if (ALL.includes(req.user.role) || req.user.role === 'admin') return;
  if (row.visible === false && row.created_by !== req.user.id) throw forbidden('This batch has lines of facilities you cannot see');
}

export async function batchRoutes(app: FastifyInstance) {
  app.get('/api/batches', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...VIEW);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(400).default(30) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const all = ALL.includes(req.user.role) || req.user.role === 'admin';
      const since = `now() - make_interval(days => ${days})`;
      const batches = (await c.query(`${STATS_SQL(`(b.created_at >= ${since} OR b.status NOT IN ('published')) AND ($2 OR s.visible IS NOT FALSE OR b.created_by = $3)`)} ORDER BY b.created_at DESC LIMIT 300`,
        [[...scope.see], all, req.user.id])).rows.map((r) => {
        const { checks: ck, state } = checks(toStats(r));
        return { ...r, recon: state, failedChecks: ck.filter((x) => x.ok === false).map((x) => x.name), retry: r.status === 'failed' && !!r.job_id && r.job_status === 'failed' };
      });
      const readings = all ? (await c.query(
        `SELECT b.id, b.client, b.status, b.received, jsonb_array_length(b.rejected)::int AS rejected, b.created_at, b.decided_at, b.decided_by, b.result,
                coalesce(s.st, '{}') AS staged
           FROM reading_batch b LEFT JOIN LATERAL (SELECT jsonb_object_agg(state, n) AS st FROM (SELECT state, count(*)::int AS n FROM reading_staged WHERE batch_id = b.id GROUP BY 1) z) s ON true
          WHERE b.created_at >= ${since} OR b.status = 'review' ORDER BY b.created_at DESC LIMIT 200`)).rows : [];
      // integration health: one line per connected system (API client)
      const sources = all ? (await c.query(
        `SELECT k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at, k.expect_hours,
                r.runs, r.ok, r.partial, r.failed, r.received, r.accepted, r.rejected, l.last_run, l.last_ok, l.last_fail, l.last_error, l.last_status
           FROM api_key k
           LEFT JOIN LATERAL (SELECT count(*)::int AS runs, count(*) FILTER (WHERE status = 'ok')::int AS ok, count(*) FILTER (WHERE status = 'partial')::int AS partial,
                                     count(*) FILTER (WHERE status = 'failed')::int AS failed, coalesce(sum(received), 0)::int AS received, coalesce(sum(accepted), 0)::int AS accepted,
                                     coalesce(sum(rejected), 0)::int AS rejected
                                FROM integration_run WHERE api_key_id = k.id AND at >= ${since}) r ON true
           LEFT JOIN LATERAL (SELECT max(at) AS last_run, max(at) FILTER (WHERE status <> 'failed') AS last_ok, max(at) FILTER (WHERE status = 'failed') AS last_fail,
                                     (SELECT error FROM integration_run x WHERE x.api_key_id = k.id AND x.status = 'failed' ORDER BY at DESC LIMIT 1) AS last_error,
                                     (SELECT status FROM integration_run x WHERE x.api_key_id = k.id ORDER BY at DESC LIMIT 1) AS last_status
                                FROM integration_run WHERE api_key_id = k.id) l ON true
          WHERE NOT 'audit_events' = ALL(k.scopes) AND (k.revoked_at IS NULL OR k.revoked_at >= ${since})
          ORDER BY (k.revoked_at IS NOT NULL), k.name`)).rows.map((k) => {
        const lastOk = k.last_ok ? new Date(k.last_ok).getTime() : null, quietH = (Date.now() - (lastOk ?? new Date(k.created_at).getTime())) / 3600e3;
        const health = k.revoked_at ? 'revoked' : !k.last_run ? 'never' : k.last_status === 'failed' ? 'failing' : k.expect_hours && quietH > k.expect_hours ? 'quiet'
          : k.last_fail && Date.now() - new Date(k.last_fail).getTime() < 86400e3 ? 'warning' : 'healthy';
        return { ...k, health, quietHours: Math.round(quietH) };
      }) : [];
      const transfers = all ? (await c.query(
        `SELECT id, client, api_key_id, source, endpoint, status, http_status, received, accepted, rejected, error, reference, ref_kind, ref_id, duration_ms, at
           FROM integration_run WHERE at >= ${since} ORDER BY at DESC LIMIT 500`)).rows : [];
      const channels = {
        uploads: (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'review')::int AS review, max(created_at) AS last
                                   FROM purchase_batch WHERE source = 'upload' AND created_at >= ${since}`)).rows[0],
        bills: (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status IN ('to_check'))::int AS review, count(*) FILTER (WHERE status = 'rejected')::int AS rejected, max(created_at) AS last
                                 FROM bill WHERE created_at >= ${since}`)).rows[0],
      };
      return {
        days, batches, readings, sources, transfers, channels, sourceText: SOURCE_TEXT,
        canManage: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role), seesSources: all,
      };
    });
  });

  app.get('/api/batches/purchase/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...VIEW);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const r = (await c.query(STATS_SQL('b.id = $2'), [[...scope.see], id])).rows[0];
      if (!r) throw notFound('Batch');
      await seesBatch(c, req, r);
      const st = toStats(r);
      // every line's outcome, with its count, amounts by currency and emissions
      const rows = (await c.query(
        `SELECT CASE WHEN l.status = 'published' THEN 'published' WHEN l.status = 'excluded' AND l.dup_of IS NOT NULL THEN 'duplicate' WHEN l.status = 'excluded' THEN 'excluded'
                     WHEN l.status = 'problem' THEN 'problem' ELSE 'pending' END AS outcome,
                coalesce(l.currency, b.settings->>'currency', '—') AS cur, count(*)::int AS n, coalesce(sum(l.amount), 0)::float8 AS amount, coalesce(sum(l.co2e), 0)::float8 AS kg
           FROM purchase_line l JOIN purchase_batch b ON b.id = l.batch_id WHERE l.batch_id = $1 GROUP BY 1, 2`, [id])).rows as { outcome: string; cur: string; n: number; amount: number; kg: number }[];
      const ORDER = ['published', 'excluded', 'duplicate', 'problem', 'pending'];
      const outcomes = ORDER.map((o) => {
        const x = rows.filter((z) => z.outcome === o);
        return { outcome: o, lines: x.reduce((a, z) => a + z.n, 0), amounts: Object.fromEntries(x.map((z) => [z.cur, z.amount])), kg: x.reduce((a, z) => a + z.kg, 0) };
      });
      const problems = (await c.query(`SELECT row_no, description, problems, calc_error FROM purchase_line WHERE batch_id = $1 AND (status = 'problem' OR calc_error IS NOT NULL) ORDER BY row_no LIMIT 100`, [id])).rows;
      const missing = (await c.query(`SELECT row_no, description, co2e::float8 AS kg FROM purchase_line l WHERE batch_id = $1 AND status = 'published'
                                        AND (activity_id IS NULL OR NOT EXISTS (SELECT 1 FROM activity x WHERE x.id = l.activity_id)) ORDER BY row_no LIMIT 100`, [id])).rows;
      const entries = (await c.query(`SELECT a.status, count(*)::int AS n, coalesce(sum(${ENTRY_T}), 0)::float8 AS kg FROM activity a WHERE a.purchase_batch_id = $1 GROUP BY 1 ORDER BY 1`, [id])).rows;
      const runs = (await c.query(`SELECT id, client, source, status, http_status, received, accepted, rejected, error, at FROM integration_run WHERE ref_kind = 'purchase_batch' AND ref_id = $1 ORDER BY at`, [id])).rows;
      const jobs = (await c.query(`SELECT id, kind, status, attempts, error, created_at, started_at, finished_at FROM job WHERE ref = $1 ORDER BY id`, [id])).rows;
      const { checks: ck, state } = checks(st);
      return {
        batch: { id: r.id, name: r.name, source: r.source, reference: r.external_ref, status: r.status, error: r.error, created_at: r.created_at, published_at: r.published_at, created_by: r.created_by_name ?? r.created_by, control: r.control },
        received: { lines: st.lines, amounts: st.amounts }, outcomes, entries, checks: ck, state, problems, missing, runs, jobs,
        canControl: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role) || r.created_by === req.user.id,
        canRetry: ['super_admin', 'admin', 'platform_admin', 'manager'].includes(req.user.role) && r.status === 'failed' && r.job_status === 'failed',
      };
    });
  });

  app.put('/api/batches/purchase/:id/control', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ control: controlSchema.nullable() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT created_by FROM purchase_batch WHERE id = $1`, [id])).rows[0];
      if (!r) throw notFound('Batch');
      if (!['super_admin', 'admin'].includes(req.user.role) && r.created_by !== req.user.id) throw forbidden('The person who loaded the batch, or an admin, enters its control totals');
      await c.query(`UPDATE purchase_batch SET control = $2 WHERE id = $1`, [id, b.control ? JSON.stringify({ ...b.control, by: req.user.name, at: new Date().toISOString() }) : null]);
      await audit(c, req, 'batch.control', 'purchase_batch', id, b.control);
      return { ok: true };
    });
  });

  app.post('/api/batches/purchase/:id/retry', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query(`SELECT id, status FROM purchase_batch WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!b) throw notFound('Batch');
      const j = (await c.query(`SELECT id, kind, args, status, error FROM job WHERE ref = $1 ORDER BY id DESC LIMIT 1`, [id])).rows[0];
      if (b.status !== 'failed' || !j || j.status !== 'failed') throw new AppError('Only a batch whose processing failed can be run again', 409, 'NOT_FAILED');
      await c.query(`UPDATE purchase_batch SET status = 'queued', error = NULL, updated_at = now() WHERE id = $1`, [id]);
      const jobId = await enqueue(c, tenant, j.kind, id, j.args ?? {}, req.user.name);
      await audit(c, req, 'batch.retry', 'purchase_batch', id, { kind: j.kind, previousJob: j.id, previousError: j.error });
      return { ok: true, jobId };
    });
  });

  app.get('/api/batches/readings/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'verifier', 'platform_admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query(`SELECT id, client, status, received, rejected, result, created_at, decided_at, decided_by FROM reading_batch WHERE id = $1`, [id])).rows[0];
      if (!b) throw notFound('Batch');
      const staged = Object.fromEntries((await c.query(`SELECT state, count(*)::int AS n FROM reading_staged WHERE batch_id = $1 GROUP BY 1`, [id])).rows.map((r) => [r.state, r.n]));
      const meters = (await c.query(`SELECT m.name, m.external_id, f.name AS facility, count(*)::int AS n FROM reading_staged s JOIN meter m ON m.id = s.meter_id JOIN org_node f ON f.id = m.facility_id
                                       WHERE s.batch_id = $1 GROUP BY 1, 2, 3 ORDER BY 1`, [id])).rows;
      return { ...b, staged, meters };
    });
  });

  app.get('/api/batches/transfers/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'verifier', 'platform_admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`SELECT * FROM integration_run WHERE id = $1`, [id])).rows[0];
      if (!r) throw notFound('Transfer');
      return r;
    });
  });

  app.put('/api/batches/sources/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ expectHours: z.number().int().min(1).max(2160).nullable() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE api_key SET expect_hours = $2, stale_alert_at = NULL WHERE id = $1 RETURNING name`, [id, b.expectHours]);
      if (!r.rowCount) throw notFound('Connected system');
      await audit(c, req, 'integration.expect', 'api_key', id, { name: r.rows[0].name, ...b });
      return { ok: true };
    });
  });
}
