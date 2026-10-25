/**
 * Automatic reminders for CBAM data requests: once the due date has passed, the supplier gets a reminder,
 * then one a week, at most three in all (manual reminders count too). Runs with the hourly reminders.
 */
import { platformTx } from '../db/pool.js';
import { appLink, queueEmail } from './mail.js';

export async function cbamAutoRemind(log: (m: string) => void = () => {}): Promise<number> {
  return platformTx(async (c) => {
    const due = (await c.query(`SELECT q.id, q.tenant_id, q.year, q.quarter, q.contact_email, q.due_date, t.name AS company FROM cbam_request q JOIN tenant t ON t.id = q.tenant_id
                                 WHERE q.status = 'open' AND q.due_date < current_date AND q.reminders < 3 AND t.status = 'active'
                                   AND (q.reminded_at IS NULL OR q.reminded_at < now() - interval '7 days') LIMIT 200`)).rows;
    for (const r of due) {
      const link = appLink('/cbam-supplier') ?? '/cbam-supplier';
      await queueEmail(c, r.tenant_id, r.contact_email, `Reminder — ${r.company}: CBAM emissions data for ${r.quarter ? `Q${r.quarter} ` : ''}${r.year}`,
        `${r.company} is still waiting for the embedded emissions of the goods you supplied (${r.quarter ? `Q${r.quarter} ` : ''}${r.year}); the due date was ${String(r.due_date instanceof Date ? r.due_date.toISOString() : r.due_date).slice(0, 10)}.\n\nAnswer on ${link} with this e-mail address and the access code from the first message. If you lost the code, reply and ask ${r.company} for a new one.`);
      await c.query(`UPDATE cbam_request SET reminders = reminders + 1, reminded_at = now() WHERE id = $1`, [r.id]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, entity, entity_id, detail) VALUES ($1,'system','cbam.request.auto_remind','cbam_request',$2,$3)`, [r.tenant_id, r.id, JSON.stringify({ to: r.contact_email })]);
    }
    if (due.length) log(`[cbam] ${due.length} reminder(s) queued`);
    return due.length;
  });
}
