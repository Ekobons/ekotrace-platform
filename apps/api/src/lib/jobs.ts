/**
 * Background jobs: work too long for one request (reading a 50,000-line file, mapping,
 * publishing). Jobs are rows in the `job` table; the worker in each API process claims
 * one at a time with FOR UPDATE SKIP LOCKED, so several servers can share the queue and
 * a job never runs twice at once. A job left "running" by a stopped server is put back
 * in the queue at start-up (at most 3 attempts).
 */
import { platformTx, type Tx } from '../db/pool.js';

export interface Job { id: number; tenant_id: string; kind: string; ref: string | null; args: Record<string, unknown>; attempts: number; created_by: string | null }
type Handler = (job: Job) => Promise<void>;
const handlers = new Map<string, Handler>();

export function registerJob(kind: string, fn: Handler) { handlers.set(kind, fn); }

export async function enqueue(c: Tx, tenantId: string, kind: string, ref: string | null, args: Record<string, unknown> = {}, by?: string | null): Promise<number> {
  return (await c.query('INSERT INTO job (tenant_id, kind, ref, args, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [tenantId, kind, ref, JSON.stringify(args), by ?? null])).rows[0].id;
}

/** Claims and runs the oldest queued job. Returns false when the queue is empty. */
export async function runNextJob(): Promise<boolean> {
  const job = await platformTx(async (c) => (await c.query(
    `UPDATE job SET status = 'running', started_at = now(), attempts = attempts + 1
      WHERE id = (SELECT id FROM job WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, tenant_id, kind, ref, args, attempts, created_by`)).rows[0] as Job | undefined);
  if (!job) return false;
  const fn = handlers.get(job.kind);
  try {
    if (!fn) throw new Error(`No handler for job "${job.kind}"`);
    await fn(job);
    await platformTx((c) => c.query(`UPDATE job SET status = 'done', finished_at = now(), error = NULL WHERE id = $1`, [job.id]));
  } catch (e) {
    await platformTx((c) => c.query(`UPDATE job SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`, [job.id, (e as Error).message.slice(0, 2000)]));
  }
  return true;
}

/** Runs every queued job now (tests, CLI). */
export async function drainJobs(max = 1000) { for (let i = 0; i < max && (await runNextJob()); i++); }

let timer: NodeJS.Timeout | null = null, busy = false;
export async function startWorker(intervalMs = 500) {
  if (timer) return;
  await platformTx((c) => c.query(
    `UPDATE job SET status = CASE WHEN attempts < 3 THEN 'queued' ELSE 'failed' END,
            error = CASE WHEN attempts < 3 THEN error ELSE 'Stopped three times while running' END
      WHERE status = 'running' AND started_at < now() - interval '10 minutes'`));
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { while (await runNextJob()); } catch { /* database unavailable: try again on the next tick */ } finally { busy = false; }
  }, intervalMs);
  timer.unref();
}
export function stopWorker() { if (timer) clearInterval(timer); timer = null; }
