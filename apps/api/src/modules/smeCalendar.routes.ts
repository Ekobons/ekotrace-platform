/**
 * EKOTRACE SME compliance calendar: "Add to my calendar" and e-mail reminders.
 *
 *   GET /api/sme/calendar.ics?fy=          every upcoming item as calendar events (RFC 5545); monthly and yearly ones repeat
 *   GET /api/sme/calendar/reminders        e-mail reminder settings, the company's people, recent reminders, whether e-mail is set up
 *   PUT /api/sme/calendar/reminders        change them (owner, admins, managers)
 *
 * The dates themselves (licences, done ticks, the company's own dates) are saved with the 'calendar' module.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { mailOn } from '../lib/mail.js';
import { needProduct } from '../lib/products.js';
import { fyOf, isFy } from '../lib/sme/company.js';
import { calendarItems, getSettings, reminderFy } from '../lib/sme/reminders.js';

const fyParam = (req: FastifyRequest) => {
  const fy = (req.query as { fy?: string }).fy ?? fyOf();
  if (!isFy(fy)) throw new AppError('Choose a financial year like "FY 2025-26"');
  return fy;
};
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
// RFC 5545: lines longer than 75 octets folded with CRLF + space, without splitting a UTF-8 character
export const fold = (line: string) => { const out: string[] = []; let cur = '', n = 0; for (const ch of line) { const b = Buffer.byteLength(ch); if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; } out.push(cur); return out.join('\r\n '); };
const ymd = (iso: string) => iso.replace(/-/g, '');
const nextDay = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

const Settings = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.string().uuid()).max(20),
  days: z.array(z.number().int().min(1).max(90)).min(1).max(5),
  overdue: z.boolean(),
});

export async function smeCalendarRoutes(app: FastifyInstance) {
  needProduct(app, 'sme');

  app.get('/api/sme/calendar.ics', async (req, reply) => {
    const t = requireTenant(req), fy = fyParam(req);
    const { items, company } = await tenantTx(t, async (c) => ({
      items: await calendarItems(c, t, fy),
      company: (await c.query(`SELECT name FROM tenant WHERE id = $1`, [t])).rows[0]?.name as string ?? '',
    }));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EKOTRACE SME//Compliance calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`${company} compliance (EKOTRACE SME)`)}`];
    for (const x of items) {
      if (x.status === 'done' || x.days < 0) continue;
      const rep = (x as { repeat?: string | null }).repeat;
      const desc = [!x.own && x.who && `With: ${x.who}`, x.notes, 'From the EKOTRACE SME compliance calendar. Dates are typical; confirm them for your state.'].filter(Boolean).join('\n');
      lines.push('BEGIN:VEVENT', `UID:${t}-${x.id.replace(/[^A-Za-z0-9_.-]/g, '-')}@ekotrace-sme`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(x.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(x.date))}`,
        ...(rep === 'monthly' ? ['RRULE:FREQ=MONTHLY'] : rep === 'yearly' ? ['RRULE:FREQ=YEARLY'] : []),
        `SUMMARY:${esc(x.title)}`, `DESCRIPTION:${esc(desc)}`, 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P3D', `DESCRIPTION:${esc(`${x.title} in 3 days`)}`, 'END:VALARM', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'attachment; filename="ekotrace-sme-calendar.ics"').send(`${lines.map(fold).join('\r\n')}\r\n`);
  });

  app.get('/api/sme/calendar/reminders', async (req) => {
    const t = requireTenant(req);
    return tenantTx(t, async (c) => ({
      mail: mailOn(),
      settings: await getSettings(c, t),
      fy: await reminderFy(c, t),
      people: (await c.query(`SELECT id, name, email, role FROM app_user WHERE tenant_id = $1 AND NOT disabled ORDER BY name`, [t])).rows,
      recent: (await c.query(`SELECT item_id, title, due::text AS due, kind, recipients, sent_at FROM sme_reminder_sent WHERE tenant_id = $1 ORDER BY sent_at DESC, id DESC LIMIT 10`, [t])).rows,
    }));
  });

  app.put('/api/sme/calendar/reminders', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager');
    const t = requireTenant(req), b = Settings.parse(req.body);
    const days = [...new Set(b.days)].sort((x, y) => y - x);
    return tenantTx(t, async (c) => {
      const ok = (await c.query(`SELECT id FROM app_user WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND NOT disabled`, [t, b.recipients])).rows.map((r) => r.id as string);
      if (ok.length !== new Set(b.recipients).size) throw new AppError('Reminders can go only to people of your company.');
      if (b.enabled && !ok.length) throw new AppError('Choose at least one person to receive the reminders.');
      const before = await getSettings(c, t);
      await c.query(`INSERT INTO sme_reminder (tenant_id, enabled, recipients, days, overdue, updated_name, updated_at) VALUES ($1,$2,$3,$4,$5,$6, now())
        ON CONFLICT (tenant_id) DO UPDATE SET enabled = EXCLUDED.enabled, recipients = EXCLUDED.recipients, days = EXCLUDED.days, overdue = EXCLUDED.overdue, updated_name = EXCLUDED.updated_name, updated_at = now()`,
        [t, b.enabled, ok, days, b.overdue, req.user.name]);
      await audit(c, req, 'sme.calendar.reminders', 'sme_reminder', t, { before, after: { ...b, days } });
      return { settings: await getSettings(c, t) };
    });
  });
}
