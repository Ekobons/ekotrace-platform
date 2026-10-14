/**
 * The audit log is append-only (database triggers refuse changes and deletions) and sealed in a
 * hash chain: each sealed record carries the hash of the one before, so a changed, removed or
 * inserted record shows up in verify(). Sealing runs every few seconds in the background.
 *
 * Retention: records older than AUDIT_RETENTION_MONTHS (never less than 12) are removed once a day;
 * the chain then starts from the first record kept (its anchor is recorded).
 *
 * SIEM: with SIEM_SYSLOG set, sealed records are forwarded in order as RFC 5424 syslog messages
 * (UDP, TCP or TLS; JSON body); a SIEM can also pull them over the API (GET /api/v1/audit-events,
 * an API client with the "audit events" permission).
 */
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { createSocket } from 'node:dgram';
import { hostname } from 'node:os';
import { readFileSync } from 'node:fs';
import { platformTx } from '../db/pool.js';
import { config } from '../config.js';
import { runAlerts } from './alerts.js';

export async function seal(): Promise<number> {
  return platformTx(async (c) => Number((await c.query('SELECT audit_seal() AS n')).rows[0].n));
}

export interface ChainCheck { ok: boolean; checked: number; firstSeq: number; lastSeq: number; unsealed: number; problem?: { seq: number; id: string; what: string }; purgedThrough: string | null }
/** Recompute the chain. */
export async function verify(): Promise<ChainCheck> {
  await seal();
  return platformTx(async (c) => {
    const ch = (await c.query('SELECT * FROM audit_chain WHERE id = 1')).rows[0];
    const bad = (await c.query(
      `WITH x AS (
         SELECT a.id, a.seal_seq, a.hash, a.prev_hash, audit_row_hash(a, a.prev_hash) AS calc,
                lag(a.hash) OVER (ORDER BY a.seal_seq) AS before, lag(a.seal_seq) OVER (ORDER BY a.seal_seq) AS before_seq
           FROM audit_log a WHERE a.seal_seq IS NOT NULL)
       SELECT id::text, seal_seq, CASE
                WHEN calc <> hash THEN 'the record was changed after it was sealed'
                WHEN prev_hash <> coalesce(before, $1) THEN 'the record before it was changed or removed'
                WHEN seal_seq <> coalesce(before_seq + 1, $2) THEN 'records are missing before it' END AS what
         FROM x WHERE calc <> hash OR prev_hash <> coalesce(before, $1) OR seal_seq <> coalesce(before_seq + 1, $2)
        ORDER BY seal_seq LIMIT 1`, [ch.anchor_hash, ch.first_seq])).rows[0];
    const n = (await c.query(`SELECT count(*) FILTER (WHERE seal_seq IS NOT NULL)::int AS sealed, count(*) FILTER (WHERE seal_seq IS NULL)::int AS unsealed,
                                     max(seal_seq) AS last, max(hash) FILTER (WHERE seal_seq = (SELECT max(seal_seq) FROM audit_log)) AS last_hash FROM audit_log`)).rows[0];
    let problem = bad ? { seq: Number(bad.seal_seq), id: bad.id, what: bad.what } : undefined;
    // the newest records removed: the chain head no longer matches
    if (!problem && Number(n.last ?? ch.first_seq - 1) !== Number(ch.last_seq)) problem = { seq: Number(ch.last_seq), id: '', what: 'the newest records were removed' };
    if (!problem && n.last && n.last_hash !== ch.last_hash) problem = { seq: Number(n.last), id: '', what: 'the newest record does not match the chain head' };
    return { ok: !problem, checked: n.sealed, firstSeq: Number(ch.first_seq), lastSeq: Number(ch.last_seq), unsealed: n.unsealed, problem, purgedThrough: ch.purged_through };
  });
}

export async function purge(months = config.auditRetentionMonths): Promise<number> {
  return platformTx(async (c) => Number((await c.query('SELECT audit_purge($1) AS n', [months])).rows[0].n));
}

// ------------------------------------------------------------------ syslog --
// facility 13 (log audit); severity notice, or for alerts: error (high), warning (medium / low)
const SEV: Record<string, number> = { high: 3, medium: 4, low: 4 };
export function syslogLine(e: Record<string, unknown>): string {
  const alert = String(e.action).startsWith('alert.');
  const PRI = 13 * 8 + (alert ? SEV[String((e.detail as { severity?: string } | null)?.severity)] ?? 4 : 5);
  const ts = new Date(String(e.at)).toISOString();
  const msg = JSON.stringify({ seq: e.seal_seq, id: e.id, tenant: e.tenant_id, company: e.company ?? null, user: e.user_name, userId: e.user_id, action: e.action,
    entity: e.entity, entityId: e.entity_id, ip: e.ip, detail: e.detail, hash: e.hash });
  return `<${PRI}>1 ${ts} ${hostname()} ekotrace - ${String(e.action).replace(/[^\w.-]/g, '_').slice(0, 32)} [ekotrace@32473 seq="${e.seal_seq}"] ${msg}`;
}

async function send(url: URL, lines: string[]) {
  if (url.protocol === 'udp:') {
    const s = createSocket('udp4');
    try { for (const l of lines) await new Promise<void>((ok, no) => s.send(Buffer.from(l), Number(url.port || 514), url.hostname, (e) => (e ? no(e) : ok()))); } finally { s.close(); }
    return;
  }
  // TCP / TLS: octet-counted frames (RFC 6587)
  await new Promise<void>((ok, no) => {
    const opts = { host: url.hostname, port: Number(url.port || (url.protocol === 'tls:' ? 6514 : 514)) };
    const sock = url.protocol === 'tls:' ? tlsConnect({ ...opts, servername: url.hostname, minVersion: 'TLSv1.2', ...(config.siemTlsCa ? { ca: readFileSync(config.siemTlsCa) } : {}) }) : tcpConnect(opts);
    sock.setTimeout(10_000, () => sock.destroy(new Error('timeout')));
    sock.once('error', no);
    sock.once(url.protocol === 'tls:' ? 'secureConnect' : 'connect', () => {
      const body = lines.map((l) => `${Buffer.byteLength(l)} ${l}`).join('');
      sock.end(body, () => ok());
    });
  });
}

/** Forward sealed records not sent yet. Returns how many were sent. */
export async function forward(target = config.siemSyslog): Promise<number> {
  if (!target) return 0;
  const url = new URL(target);
  if (!['udp:', 'tcp:', 'tls:'].includes(url.protocol)) throw new Error('SIEM_SYSLOG must be udp://, tcp:// or tls://');
  let sent = 0;
  for (;;) {
    const { rows, last } = await platformTx(async (c) => {
      const cur = Number((await c.query(`INSERT INTO siem_cursor (name) VALUES ('syslog') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING last_seq`)).rows[0].last_seq);
      const r = (await c.query(`SELECT a.*, t.name AS company FROM audit_log a LEFT JOIN tenant t ON t.id = a.tenant_id WHERE a.seal_seq > $1 ORDER BY a.seal_seq LIMIT 500`, [cur])).rows;
      return { rows: r, last: cur };
    });
    if (!rows.length) return sent;
    try { await send(url, rows.map(syslogLine)); }
    catch (e) { await platformTx((c) => c.query(`UPDATE siem_cursor SET last_error = $1, updated_at = now() WHERE name = 'syslog'`, [(e as Error).message.slice(0, 300)])); throw e; }
    const to = Number(rows[rows.length - 1].seal_seq);
    await platformTx((c) => c.query(`UPDATE siem_cursor SET last_seq = $1, last_error = NULL, updated_at = now() WHERE name = 'syslog' AND last_seq = $2`, [to, last]));
    sent += rows.length;
  }
}

/** Background: seal every 10 s, forward to the SIEM, remove expired records once a day. */
let timer: NodeJS.Timeout | null = null;
export function startAuditWorker(log: (m: string) => void = console.log) {
  let lastPurge = 0, busy = false;
  timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      await seal();
      if (await runAlerts()) await seal();
      if (config.siemSyslog) await forward().catch((e) => log(`[audit] SIEM forwarding failed: ${(e as Error).message}`));
      if (Date.now() - lastPurge > 86400e3) { lastPurge = Date.now(); const n = await purge(); if (n) log(`[audit] ${n} records past the ${config.auditRetentionMonths}-month retention removed`); }
    } catch (e) { log(`[audit] ${(e as Error).message}`); } finally { busy = false; }
  }, 10_000);
  timer.unref();
}
export function stopAuditWorker() { if (timer) clearInterval(timer); timer = null; }
