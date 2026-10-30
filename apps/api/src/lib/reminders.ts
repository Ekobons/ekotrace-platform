/**
 * Reminders and escalation for the collection calendar. Runs every hour (and on demand):
 *
 *   due soon   to the people responsible, "due soon" days before the due date
 *   overdue    to the people responsible, the day after the due date
 *   escalated  to the facility manager and the admins above the facility (else the super admins),
 *              more than the escalation days late
 *
 * One reminder of each kind per obligation (reminder_log), gathered into one message per person and kind,
 * so nobody gets a flood. Periods more than 180 days late are not chased any more (they show on the calendar).
 * Several servers: a per-company advisory lock lets only one of them send.
 */
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { cycleSettings, ensureMetrics, obligations, todayIn, type Obligation, type Person } from './collection.js';
import { notify } from './notify.js';
import { deliverEmails } from './mail.js';
import { PRODUCT } from './brand.js';
import { checkIntegrations } from './integrations.js';
import { cbamAutoRemind } from './cbamReminders.js';

const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const obLine = (o: Obligation) => `${o.facility} · ${o.metric} (${o.metricCode}) · ${o.label} · due ${fmt(o.due)}${o.daysLate ? ` · ${o.daysLate} day${o.daysLate > 1 ? 's' : ''} late` : ''}`;
const TITLE: Record<string, (n: number) => string> = {
  due_soon: (n) => `${n} data submission${n > 1 ? 's' : ''} due soon`,
  overdue: (n) => `${n} data submission${n > 1 ? 's are' : ' is'} overdue`,
  escalated: (n) => `Escalation: ${n} submission${n > 1 ? 's' : ''} badly overdue at your facilities`,
  manual: (n) => `Reminder: ${n} data submission${n > 1 ? 's' : ''} to send`,
};
const INTRO: Record<string, string> = {
  due_soon: 'These are due soon. Enter the data in Add data and submit it for approval:',
  overdue: 'These are past their due date. Please enter and submit the data, or tell your manager why it cannot be sent:',
  escalated: 'You are told because these are more than the agreed number of days late. Please follow up with the people responsible:',
  manual: 'Your administrator asks you to send these:',
};

/** Sends one message per person and kind for the obligations given. Returns the number of people told. */
async function send(c: Tx, tenant: string, kind: string, items: { o: Obligation; to: Person[] }[], by: string, logKind = kind): Promise<number> {
  const per = new Map<string, Obligation[]>();
  for (const { o, to } of items) for (const p of to) per.set(p.id, [...(per.get(p.id) ?? []), o]);
  let n = 0;
  for (const [uid, obs] of per) {
    const lines = obs.slice(0, 40).map((o) => `• ${obLine(o)}`).join('\n') + (obs.length > 40 ? `\n…and ${obs.length - 40} more` : '');
    n += await notify(c, tenant, [uid], { kind: kind === 'due_soon' ? 'reminder' : kind, title: TITLE[kind]!(obs.length), body: `${INTRO[kind]}\n\n${lines}`, link: kind === 'escalated' ? '/calendar?timing=late' : '/calendar?mine=1' });
  }
  for (const { o, to } of items) {
    await c.query(`INSERT INTO reminder_log (tenant_id, key, kind, recipients, by_name) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [tenant, o.key, logKind, to.map((p) => p.id), by]);
  }
  return n;
}

/** One company's reminders. */
export async function remindTenant(c: Tx, tenant: string, now = new Date()): Promise<{ due_soon: number; overdue: number; escalated: number; people: number; skipped?: string }> {
  const zero = { due_soon: 0, overdue: 0, escalated: 0, people: 0 };
  if (!(await c.query(`SELECT pg_try_advisory_xact_lock(hashtext('reminders:' || $1::text)) AS ok`, [tenant])).rows[0].ok) return { ...zero, skipped: 'another server is sending' };
  const set = await cycleSettings(c, tenant);
  if (!set.reminders) return { ...zero, skipped: 'reminders are switched off' };
  await ensureMetrics(c, tenant);
  const today = todayIn(set.timezone, now), y = Number(today.slice(0, 4));
  const facs = (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((r) => r.id as string);
  const obs = (await obligations(c, tenant, { years: [y - 1, y], facilities: facs, today, company: true })).filter((o) => o.timing !== 'done' && o.timing !== 'upcoming' && o.daysLate <= 180);
  const has = (o: Obligation, k: string) => o.reminders.some((r) => r.kind === k);
  const out = { ...zero };
  const soon = obs.filter((o) => o.timing === 'due_soon' && !has(o, 'due_soon') && o.responsible.length);
  const late = obs.filter((o) => (o.timing === 'overdue' || o.timing === 'escalated') && !has(o, 'overdue') && o.responsible.length);
  const esc = obs.filter((o) => o.timing === 'escalated' && !has(o, 'escalated') && o.escalateTo.length);
  out.people += await send(c, tenant, 'due_soon', soon.map((o) => ({ o, to: o.responsible })), `${PRODUCT} reminders`); out.due_soon = soon.length;
  out.people += await send(c, tenant, 'overdue', late.map((o) => ({ o, to: o.responsible })), `${PRODUCT} reminders`); out.overdue = late.length;
  out.people += await send(c, tenant, 'escalated', esc.map((o) => ({ o, to: o.escalateTo })), `${PRODUCT} reminders`); out.escalated = esc.length;
  if (out.due_soon + out.overdue + out.escalated) {
    await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, detail) VALUES ($1,$3,'collection.reminders',$2)`, [tenant, JSON.stringify(out), `${PRODUCT} reminders`]);
  }
  return out;
}

/** A reminder sent by hand from the calendar: once a day per obligation. */
export async function remindNow(c: Tx, tenant: string, keys: string[], by: string, now = new Date()): Promise<{ sent: number; people: number; skipped: number }> {
  const set = await cycleSettings(c, tenant);
  const today = todayIn(set.timezone, now), y = Number(today.slice(0, 4));
  const facs = [...new Set(keys.map((k) => k.split(':')[0]!))];
  const obs = (await obligations(c, tenant, { years: [y - 1, y], facilities: facs, today, company: true })).filter((o) => keys.includes(o.key));
  const kind = `manual:${today}`;
  const todo = obs.filter((o) => o.timing !== 'done' && !o.reminders.some((r) => r.kind === kind) && o.responsible.length);
  const people = await send(c, tenant, 'manual', todo.map((o) => ({ o, to: o.responsible })), by, kind);
  return { sent: todo.length, people, skipped: keys.length - todo.length };
}

/** Every active company with reminders on. */
export async function runReminders(now = new Date(), log: (m: string) => void = () => {}) {
  const tenants = await platformTx(async (c) => (await c.query(`SELECT id, name FROM tenant WHERE status = 'active' AND reminders AND access_expiry >= current_date`)).rows);
  for (const t of tenants) {
    try {
      const r = await tenantTx(t.id, (c) => remindTenant(c, t.id, now));
      if (r.people) log(`[reminders] ${t.name}: ${r.due_soon} due soon, ${r.overdue} overdue, ${r.escalated} escalated → ${r.people} message(s)`);
    } catch (e) { log(`[reminders] ${t.name}: ${(e as Error).message}`); }
  }
}

let mailTimer: NodeJS.Timeout | null = null, remTimer: NodeJS.Timeout | null = null;
/** Background: e-mail every 30 seconds, reminders a minute after start and then every hour. */
export function startCollectionWorker(log: (m: string) => void = console.log) {
  let busy = false;
  mailTimer = setInterval(async () => {
    if (busy) return; busy = true;
    try { const n = await deliverEmails(); if (n) log(`[mail] ${n} e-mail(s) sent`); } catch (e) { log(`[mail] ${(e as Error).message}`); } finally { busy = false; }
  }, 30_000);
  mailTimer.unref();
  const rem = () => runReminders(new Date(), log).then(() => checkIntegrations(log)).then(() => cbamAutoRemind(log)).then(() => import('./sme/reminders.js')).then((m) => m.runSmeReminders(new Date(), log)).catch((e) => log(`[reminders] ${(e as Error).message}`));
  setTimeout(rem, 60_000).unref();
  remTimer = setInterval(rem, 3600_000);
  remTimer.unref();
}
export function stopCollectionWorker() { if (mailTimer) clearInterval(mailTimer); if (remTimer) clearInterval(remTimer); mailTimer = remTimer = null; }
