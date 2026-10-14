/**
 * Notifications: a line in each person's Inbox, and an e-mail unless they switched e-mails off.
 * E-mails carry the title and a short text and a link — no figures or files.
 */
import type { Tx } from '../db/pool.js';
import { appLink, queueEmail } from './mail.js';
import { PRODUCT } from './brand.js';

export interface Note { kind: string; title: string; body?: string; link?: string }

export async function notify(c: Tx, tenantId: string, userIds: (string | null | undefined)[], n: Note, opts: { email?: boolean } = {}): Promise<number> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  const users = (await c.query(`SELECT id, email, email_notify, disabled FROM app_user WHERE id = ANY($1) AND tenant_id = $2`, [ids, tenantId])).rows;
  for (const u of users) {
    if (u.disabled) continue;
    await c.query(`INSERT INTO notification (tenant_id, user_id, kind, title, body, link) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, u.id, n.kind, n.title, n.body ?? null, n.link ?? null]);
    if (opts.email !== false && u.email_notify) {
      const link = n.link ? appLink(n.link) : null;
      await queueEmail(c, tenantId, u.email, n.title, `${n.title}\n\n${n.body ?? ''}${link ? `\n\nOpen in ${PRODUCT}: ${link}` : ''}\n\n—\nYou receive this because you take part in your company's data collection in ${PRODUCT}. You can switch these e-mails off in Inbox & to-dos.`);
    }
  }
  return users.filter((u) => !u.disabled).length;
}
