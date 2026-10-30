/**
 * EKOTRACE SME: e-mail reminders for the compliance calendar.
 *
 * Each company chooses who receives them and how many days before a due date (default 15 and 3), and whether
 * to be told once when a date has passed. Runs with the hourly platform reminders (lib/reminders.ts) but sends
 * only from 8 a.m. India time, so in practice once a day. Every reminder is recorded in sme_reminder_sent
 * (one row per item, due date and kind), so the same reminder never goes out twice, even with several servers.
 * One e-mail per person per run lists every item due. Without a mail server (mailOn() false) nothing is sent
 * and nothing is recorded, so reminders start as soon as e-mail is set up.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { platformTx, tenantTx, type Tx } from '../../db/pool.js';
import { appLink, mailOn, queueEmail } from '../mail.js';
import * as E from './engine.js';
import { cfg as loadCfg } from './settings.js';
import { fyOf, load } from './company.js';

export interface ReminderSettings { enabled: boolean; recipients: string[]; days: number[]; overdue: boolean }
export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, recipients: [], days: [15, 3], overdue: true };
/** Dates more than this many days late are not chased by e-mail (they stay on the calendar). */
export const OVERDUE_WINDOW = 30;

export interface CalItem { id: string; title: string; date: string; days: number; status: string; who?: string; go?: string | null; notes?: string }
export interface Chosen { item: CalItem; kind: string }
export const sentKey = (id: string, due: string, kind: string) => `${id}|${due}|${kind}`;

/**
 * Which reminders are due now (pure). An item d days away gets the reminder of the smallest chosen "days before"
 * that is ≥ d (15 and 3: at 15…4 days the 15-day one, at 3…0 the 3-day one); a missed day is caught up the next day.
 * A date that has passed gets one "overdue" reminder (within OVERDUE_WINDOW days). Done items and reminders already
 * in `sent` are skipped.
 */
export function pickReminders(items: CalItem[], s: Pick<ReminderSettings, 'days' | 'overdue'>, sent: Set<string>): Chosen[] {
  const days = [...new Set(s.days.filter((x) => Number.isInteger(x) && x >= 0))].sort((a, b) => a - b);
  const out: Chosen[] = [];
  for (const it of items) {
    if (it.status === 'done' || !Number.isFinite(it.days)) continue;
    let kind: string | null = null;
    if (it.days < 0) { if (s.overdue && it.days >= -OVERDUE_WINDOW) kind = 'overdue'; }
    else { const n = days.find((x) => it.days <= x); if (n !== undefined) kind = `d${n}`; }
    if (kind && !sent.has(sentKey(it.id, it.date, kind))) out.push({ item: it, kind });
  }
  return out;
}

export async function getSettings(c: Tx, tenant: string): Promise<ReminderSettings & { updated_name?: string | null; updated_at?: string | null }> {
  const r = (await c.query(`SELECT enabled, recipients, days, overdue, updated_name, updated_at FROM sme_reminder WHERE tenant_id = $1`, [tenant])).rows[0];
  return r ? { enabled: r.enabled, recipients: r.recipients, days: r.days, overdue: r.overdue, updated_name: r.updated_name, updated_at: r.updated_at } : { ...DEFAULT_REMINDERS };
}

/** The financial year the reminders read: the newest one (up to today's) that has calendar data, else any data, else today's. */
export async function reminderFy(c: Tx, tenant: string, now = new Date()): Promise<string> {
  const cur = fyOf(now);
  const r = (await c.query(`SELECT fy FROM sme_doc WHERE tenant_id = $1 AND fy <= $2 ORDER BY (module = 'calendar') DESC, fy DESC LIMIT 1`, [tenant, cur])).rows[0];
  return r?.fy ?? cur;
}

/** The calendar as the engine builds it for a company and year, on a given day. */
export async function calendarItems(c: Tx, tenant: string, fy: string, now = new Date()): Promise<CalItem[]> {
  const config = await loadCfg(now);
  const { d } = await load(c, tenant, fy);
  return E.calendar(d, config);
}

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const whenText = (it: CalItem) => (it.days < 0 ? `${-it.days} day${it.days === -1 ? '' : 's'} overdue` : it.days === 0 ? 'due today' : it.days === 1 ? 'due tomorrow' : `due in ${it.days} days`);

/** One company's reminders (inside its tenant transaction). */
export async function remindSme(c: Tx, tenant: string, now = new Date(), opts: { mail?: boolean } = {}): Promise<{ items: number; people: number; skipped?: string }> {
  if (!(opts.mail ?? mailOn())) return { items: 0, people: 0, skipped: 'e-mail is not set up' };
  if (!(await c.query(`SELECT pg_try_advisory_xact_lock(hashtext('sme-reminders:' || $1::text)) AS ok`, [tenant])).rows[0].ok) return { items: 0, people: 0, skipped: 'another server is sending' };
  const s = await getSettings(c, tenant);
  if (!s.enabled) return { items: 0, people: 0, skipped: 'reminders are off' };
  const people = (await c.query(`SELECT id, name, email FROM app_user WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND NOT disabled`, [tenant, s.recipients])).rows;
  if (!people.length) return { items: 0, people: 0, skipped: 'nobody chosen to receive them' };
  const items = await calendarItems(c, tenant, await reminderFy(c, tenant, now), now);
  const sent = new Set((await c.query(`SELECT item_id, due::text AS due, kind FROM sme_reminder_sent WHERE tenant_id = $1 AND due >= $2::date - 400`, [tenant, now.toISOString().slice(0, 10)])).rows
    .map((r: any) => sentKey(r.item_id, r.due, r.kind)));
  const picks: Chosen[] = [];
  // record first: a row another run has just written means that reminder is not sent again
  for (const p of pickReminders(items, s, sent)) {
    const ok = (await c.query(`INSERT INTO sme_reminder_sent (tenant_id, item_id, title, due, kind, recipients) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`,
      [tenant, p.item.id, p.item.title.slice(0, 200), p.item.date, p.kind, people.length])).rows[0];
    if (ok) picks.push(p);
  }
  if (!picks.length) return { items: 0, people: 0 };
  const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0]?.name ?? 'Your company';
  const late = picks.filter((p) => p.kind === 'overdue'), soon = picks.filter((p) => p.kind !== 'overdue');
  const line = (p: Chosen) => `• ${p.item.title}: ${fmt(p.item.date)}, ${whenText(p.item)}${p.item.who ? ` (${p.item.who})` : ''}${p.item.notes ? `\n  ${p.item.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`;
  const subject = `EKOTRACE SME: ${late.length ? `${late.length} date${late.length > 1 ? 's' : ''} passed` : ''}${late.length && soon.length ? ', ' : ''}${soon.length ? `${soon.length} due soon` : ''} · ${company}`;
  const body = [
    `Hello {name},`, '',
    `Reminder from the compliance calendar of ${company}.`, '',
    ...(late.length ? ['These dates have passed. If the work is done, mark it done in the calendar:', ...late.map(line), ''] : []),
    ...(soon.length ? ['Coming up:', ...soon.map(line), ''] : []),
    `Open the calendar: ${appLink('/sme/calendar') ?? 'EKOTRACE SME → Calendar'}`, '',
    'You receive this because you were chosen for calendar reminders. The owner or an admin can change this on the Calendar page.',
  ].join('\n');
  for (const u of people) await queueEmail(c, tenant, u.email, subject, body.replace('{name}', u.name));
  await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, entity, detail) VALUES ($1,'EKOTRACE SME reminders','sme.calendar.reminders','sme_reminder',$2)`,
    [tenant, JSON.stringify({ items: picks.map((p) => ({ id: p.item.id, due: p.item.date, kind: p.kind })), to: people.map((u: any) => u.email) })]);
  return { items: picks.length, people: people.length };
}

/** Every active SME company with reminders on. Sends from 8 a.m. India time (the hourly run makes it daily). */
export async function runSmeReminders(now = new Date(), log: (m: string) => void = () => {}, opts: { anyHour?: boolean; mail?: boolean } = {}) {
  if (!(opts.mail ?? mailOn())) return 0;
  const istHour = new Date(now.getTime() + 330 * 60e3).getUTCHours();
  if (!opts.anyHour && istHour < 8) return 0;
  const tenants = await platformTx(async (c) => (await c.query(`SELECT t.id, t.name FROM tenant t JOIN sme_reminder r ON r.tenant_id = t.id
    WHERE r.enabled AND t.status = 'active' AND 'sme' = ANY(t.products) AND t.access_expiry >= current_date`)).rows);
  let n = 0;
  for (const t of tenants) {
    try {
      const r = await tenantTx(t.id, (c) => remindSme(c, t.id, now, opts));
      if (r.items) { n += r.items; log(`[sme reminders] ${t.name}: ${r.items} item(s) → ${r.people} person(s)`); }
    } catch (e) { log(`[sme reminders] ${t.name}: ${(e as Error).message}`); }
  }
  return n;
}
