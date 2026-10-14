/**
 * E-mail out. Messages are queued in email_outbox inside the transaction that decides to send them, so a
 * rolled-back change sends nothing; the worker delivers them (several servers share the queue: FOR UPDATE
 * SKIP LOCKED). Without a mail server (SMTP_URL) messages are "held" — nothing leaves the platform.
 * TLS is required (smtps://, or STARTTLS on smtp://) except to a mail server on this computer.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';
import { platformTx, type Tx } from '../db/pool.js';

export const mailOn = () => !!config.smtpUrl;

export async function queueEmail(c: Tx, tenantId: string | null, to: string, subject: string, body: string) {
  await c.query(`INSERT INTO email_outbox (tenant_id, to_email, subject, body, status) VALUES ($1,$2,$3,$4,$5)`,
    [tenantId, to, subject.replace(/[\r\n]+/g, ' ').slice(0, 200), body, mailOn() ? 'queued' : 'held']);
}

let transport: Transporter | null = null;
function smtp(): Transporter {
  if (transport) return transport;
  const u = new URL(config.smtpUrl!);
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  transport = nodemailer.createTransport({
    host: u.hostname, port: Number(u.port || (u.protocol === 'smtps:' ? 465 : 587)), secure: u.protocol === 'smtps:', requireTLS: u.protocol !== 'smtps:' && !local,
    auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
    tls: { minVersion: 'TLSv1.2' },
  });
  return transport;
}

/** Sends queued messages (up to max). Returns how many went out. */
export async function deliverEmails(max = 50): Promise<number> {
  if (!mailOn()) return 0;
  return platformTx(async (c) => {
    const rows = (await c.query(`SELECT id, to_email, subject, body, attempts FROM email_outbox WHERE status = 'queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1`, [max])).rows;
    let n = 0;
    for (const r of rows) {
      try {
        await smtp().sendMail({ from: config.mailFrom, to: r.to_email, subject: r.subject, text: r.body });
        await c.query(`UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, error = NULL WHERE id = $1`, [r.id]); n++;
      } catch (e) {
        await c.query(`UPDATE email_outbox SET status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END, attempts = attempts + 1, error = $2 WHERE id = $1`, [r.id, (e as Error).message.slice(0, 500)]);
      }
    }
    // kept 90 days
    await c.query(`DELETE FROM email_outbox WHERE created_at < now() - interval '90 days'`);
    return n;
  });
}

/** A link into Ekotrace for e-mails (needs PUBLIC_URL). */
export const appLink = (path: string) => (config.publicUrl ? config.publicUrl + path : null);
