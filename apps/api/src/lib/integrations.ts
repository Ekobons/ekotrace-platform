/**
 * Integration runs and health (Batch runs · RFP 3.3.5, 3.3.6, 6.2).
 *
 *   logTransfers(app)    every POST to the machine API (/api/v1/…) by a known client is logged as a run: records
 *                        received, accepted and refused (with reasons), the batch it fed, or why it failed.
 *                        A failed call tells the company's super admins and admins, at most once an hour per client.
 *   checkIntegrations()  hourly: a client expected to send every N hours that has gone quiet tells them once per gap.
 *                        Runs older than 400 days are removed.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { notify } from './notify.js';

export interface IngestClient { id: string; name: string; tenant_id: string }
declare module 'fastify' {
  interface FastifyRequest { ingestClient?: IngestClient; ingestPayload?: string }
}

const SOURCE = (url: string) => /^\/api\/v1\/meter-readings/.test(url) ? 'meter_readings' : /^\/api\/v1\/purchases\/[^?]+\/complete/.test(url) ? 'purchases_complete' : /^\/api\/v1\/purchases/.test(url) ? 'purchases' : null;
export const SOURCE_TEXT: Record<string, string> = { meter_readings: 'Meter readings', purchases: 'Purchase lines', purchases_complete: 'Purchase batch completed' };

async function admins(c: Tx) {
  return (await c.query(`SELECT id FROM app_user WHERE role IN ('super_admin', 'admin') AND NOT disabled`)).rows.map((r) => r.id as string);
}

/** What a call's response says about it. */
export function summarise(source: string, http: number, body: Record<string, unknown> | null, sent: unknown) {
  const req = (sent ?? {}) as { readings?: unknown[]; lines?: unknown[]; reference?: string };
  if (http >= 400) {
    const det = Array.isArray(body?.details) ? (body!.details as { field?: string; message?: string }[]).slice(0, 5).map((d) => `${d.field ? `${d.field}: ` : ''}${d.message ?? ''}`).join('; ') : '';
    const msg = String(body?.message ?? body?.error_description ?? body?.error ?? `HTTP ${http}`);
    return { status: 'failed' as const, received: (req.readings ?? req.lines ?? []).length, accepted: 0, rejected: (req.readings ?? req.lines ?? []).length, error: (det ? `${msg} — ${det}` : msg).slice(0, 2000), problems: [], reference: req.reference ?? null, ref: null as null | [string, string] };
  }
  const b = body ?? {};
  if (source === 'meter_readings') {
    const rej = (b.rejected as { index: number; reason: string }[] | undefined) ?? [];
    const received = Number(b.received ?? 0);
    return { status: rej.length ? 'partial' as const : 'ok' as const, received, accepted: Math.max(0, received - rej.length), rejected: rej.length, error: null, problems: rej.slice(0, 200).map((r) => ({ index: r.index, reason: r.reason })),
      reference: null, ref: b.batchId ? ['reading_batch', String(b.batchId)] as [string, string] : null };
  }
  if (source === 'purchases') {
    const pr = (b.problems as { index: number; problems: string[] }[] | undefined) ?? [];
    const received = Number(b.received ?? 0), n = Number(b.withProblems ?? pr.length);
    return { status: n ? 'partial' as const : 'ok' as const, received, accepted: Math.max(0, received - n), rejected: n, error: null, problems: pr.slice(0, 200).map((p) => ({ index: p.index, reason: p.problems.join('; ') })),
      reference: (b.reference as string) ?? null, ref: b.batchId ? ['purchase_batch', String(b.batchId)] as [string, string] : null };
  }
  return { status: 'ok' as const, received: 0, accepted: 0, rejected: 0, error: null, problems: [], reference: (b.reference as string) ?? null, ref: null };
}

/** Logs every POST a known client makes to the machine API. */
export function logTransfers(app: FastifyInstance) {
  app.addHook('onSend', async (req, _reply, payload) => {
    if (req.ingestClient && req.method === 'POST' && typeof payload === 'string' && payload.length < 2_000_000) req.ingestPayload = payload;
    return payload;
  });
  app.addHook('onResponse', async (req: FastifyRequest, reply) => {
    const k = req.ingestClient;
    const source = k && req.method === 'POST' ? SOURCE(req.url) : null;
    if (!k || !source) return;
    let body: Record<string, unknown> | null = null;
    try { body = req.ingestPayload ? JSON.parse(req.ingestPayload) : null; } catch { body = null; }
    const s = summarise(source, reply.statusCode, body, req.body);
    const reference = s.reference ?? (source === 'purchases_complete' ? decodeURIComponent(req.url.split('/')[4] ?? '') : null);
    try {
      await tenantTx(k.tenant_id, async (c) => {
        await c.query(
          `INSERT INTO integration_run (tenant_id, api_key_id, client, source, endpoint, status, http_status, received, accepted, rejected, error, problems, reference, ref_kind, ref_id, duration_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [k.tenant_id, k.id, k.name, source, `POST ${req.url.split('?')[0]}`.slice(0, 300), s.status, reply.statusCode, s.received, s.accepted, s.rejected, s.error, JSON.stringify(s.problems), reference,
           s.ref?.[0] ?? null, s.ref?.[1] ?? null, Math.round(reply.elapsedTime)]);
        if (s.status !== 'failed') return;
        const due = (await c.query(`UPDATE api_key SET fail_alert_at = now() WHERE id = $1 AND (fail_alert_at IS NULL OR fail_alert_at < now() - interval '1 hour') RETURNING id`, [k.id])).rowCount;
        if (due) await notify(c, k.tenant_id, await admins(c), { kind: 'integration', title: `Transfer failed: ${k.name}`, body: `${SOURCE_TEXT[source]} · HTTP ${reply.statusCode}\n${s.error ?? ''}\nNothing from this call was stored; the sending system must send it again.`, link: '/batches?tab=transfers' });
      });
    } catch (e) { req.log.error(e); }
  });
}

/** Hourly: quiet clients (no successful run within their expected interval) and retention. */
export async function checkIntegrations(log: (m: string) => void = () => {}) {
  await platformTx((c) => c.query(`DELETE FROM integration_run WHERE at < now() - interval '400 days'`));
  const late = await platformTx(async (c) => (await c.query(
    `SELECT k.id, k.name, k.tenant_id, k.expect_hours, coalesce(r.last_ok, k.created_at) AS since
       FROM api_key k JOIN tenant t ON t.id = k.tenant_id AND t.status = 'active'
       LEFT JOIN LATERAL (SELECT max(at) AS last_ok FROM integration_run WHERE api_key_id = k.id AND status <> 'failed') r ON true
      WHERE k.revoked_at IS NULL AND k.expect_hours IS NOT NULL AND coalesce(r.last_ok, k.created_at) < now() - make_interval(hours => k.expect_hours)
        AND (k.stale_alert_at IS NULL OR k.stale_alert_at < coalesce(r.last_ok, k.created_at))`)).rows);
  for (const k of late) {
    try {
      await tenantTx(k.tenant_id, async (c) => {
        const h = Math.round((Date.now() - new Date(k.since).getTime()) / 3600e3);
        await notify(c, k.tenant_id, await admins(c), { kind: 'integration', title: `No data from ${k.name} for ${h} hours`, body: `It is expected to send at least every ${k.expect_hours} hours. Check the sending system and its access key.`, link: '/batches' });
        await c.query(`UPDATE api_key SET stale_alert_at = now() WHERE id = $1`, [k.id]);
      });
      log(`[integrations] ${k.name}: quiet for more than ${k.expect_hours} h`);
    } catch (e) { log(`[integrations] ${(e as Error).message}`); }
  }
}
