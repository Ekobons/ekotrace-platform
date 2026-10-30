/**
 * EKOTRACE SME calendar: the company's own dates, the .ics export, and e-mail reminders (which ones are due,
 * never the same one twice, only to the people chosen).
 *
 *   node --import tsx --test test/sme2-calendar.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as E from '../src/lib/sme/engine.js';
import { DEFAULTS } from '../src/lib/sme/defaults.js';
import { pickReminders, sentKey, type CalItem } from '../src/lib/sme/reminders.js';
import { fold } from '../src/modules/smeCalendar.routes.js';

const NOW = new Date('2026-10-28T06:00:00Z');      // 11:30 a.m. in India
const cfg: any = { ...DEFAULTS, today: NOW };

// ------------------------------------------------------------------ engine --
test('calendar: own dates — once and yearly, notes, done ticks; old data without them still works', () => {
  const d: any = { profile: { state: 'Maharashtra' }, calendar: { cto: '2027-03-31', done: { 'own-b': true },
    custom: [
      { id: 'a', title: 'Boiler inspection', date: '2026-11-12', repeat: 'once', notes: 'Call Patil' },
      { id: 'b', title: 'Insurance renewal', date: '2026-12-01', repeat: 'once' },
      { id: 'c', title: 'Society AGM', date: '2025-08-20', repeat: 'yearly' },
      { id: 'd', title: '', date: '2026-11-01' },                    // no title: ignored
      { id: 'e', title: 'Bad date', date: '2026-13-45' },              // invalid: ignored
    ] } };
  const cal = E.calendar(d, cfg);
  const a = cal.find((x: any) => x.id === 'own-a'), b = cal.find((x: any) => x.id === 'own-b'), c = cal.find((x: any) => x.id === 'own-c');
  assert.equal(a.days, 15); assert.equal(a.status, 'soon'); assert.equal(a.notes, 'Call Patil'); assert.equal(a.freq, 'Once'); assert.equal(a.repeat, null);
  assert.equal(b.status, 'done');
  assert.equal(c.date, '2027-08-20'); assert.equal(c.repeat, 'yearly'); assert.equal(c.freq, 'Every year');   // the next one
  assert.equal(cal.filter((x: any) => x.own).length, 3);
  assert.ok(cal.find((x: any) => x.id === 'cto'));
  for (let i = 1; i < cal.length; i++) assert.ok(cal[i - 1].date <= cal[i].date);
  // a date that is today is "due today" all day long (India time), not moved to next year
  const late = E.calendar({ profile: {}, calendar: { custom: [{ id: 'x', title: 'Today', date: '2026-10-28', repeat: 'yearly' }] } }, { ...cfg, today: new Date('2026-10-28T17:00:00Z') });
  assert.equal(late.find((x: any) => x.id === 'own-x').days, 0);
  // the first version had no custom list
  assert.ok(E.calendar({ profile: {}, calendar: { cto: '2027-01-01', done: {} } }, cfg).length > 0);
  // a once-only date that has passed shows as overdue
  const od = E.calendar({ profile: {}, calendar: { custom: [{ id: 'o', title: 'Old', date: '2026-10-20' }] } }, cfg).find((x: any) => x.id === 'own-o');
  assert.equal(od.status, 'overdue'); assert.equal(od.days, -8);
});

test('reminders: the smallest "days before" that applies, once; overdue once; done and far items skipped', () => {
  const it = (id: string, days: number, status = days < 0 ? 'overdue' : 'soon'): CalItem => ({ id, title: id, date: `D${id}`, days, status });
  const items = [it('far', 40, 'later'), it('d15', 15), it('d10', 10), it('d3', 3), it('today', 0), it('late', -2), it('old', -45), it('done', 2, 'done')];
  const s = { days: [15, 3], overdue: true };
  const got = pickReminders(items, s, new Set()).map((p) => `${p.item.id}:${p.kind}`);
  assert.deepEqual(got, ['d15:d15', 'd10:d15', 'd3:d3', 'today:d3', 'late:overdue']);
  // already sent → not again
  const sent = new Set([sentKey('d15', 'Dd15', 'd15'), sentKey('late', 'Dlate', 'overdue')]);
  assert.deepEqual(pickReminders(items, s, sent).map((p) => p.item.id), ['d10', 'd3', 'today']);
  // overdue off; one threshold only
  assert.deepEqual(pickReminders(items, { days: [7], overdue: false }, new Set()).map((p) => `${p.item.id}:${p.kind}`), ['d3:d7', 'today:d7']);
});

test('ics: lines folded at 75 octets without splitting a character', () => {
  const long = `SUMMARY:${'₹'.repeat(60)}`;
  for (const l of fold(long).split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75);
  assert.equal(fold(long).replace(/\r\n /g, ''), long);
});

// ------------------------------------------------------------------ API --
const url = process.env.SME_CAL_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_sme_cal_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('SME_CAL_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;
let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool;
let admin = '', owner = '', prep = '', sme = '', other = '';
const call = async (method: string, path: string, body?: unknown, cookie = admin) => {
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' || method === 'DELETE' ? undefined : {})) as object, headers: { cookie } });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body, headers: r.headers };
};
const login = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'correct horse battery' } })).headers['set-cookie']).split(';')[0]!;
const FYS = 'FY 2026-27', FY = encodeURIComponent(FYS);

before(async () => {
  const c0 = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await c0.connect(); await c0.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await c0.query(`CREATE DATABASE ${dbName}`); await c0.end();
  await (await import('../src/db/migrate.js')).migrate(() => {});
  app = await (await import('../src/app.js')).buildApp({ rateLimit: null });
  pool = (await import('../src/db/pool.js')).pool;
  const { hashPassword } = await import('../src/lib/password.js');
  const pw = await hashPassword('correct horse battery');
  const p = new pg.Client({ connectionString: url });
  await p.connect(); await p.query(`SELECT set_config('app.platform','on',false)`);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES (NULL,'ops@ekobon.test','Ops','platform_admin',$1,false)`, [pw]);
  admin = await login('ops@ekobon.test');
  const mk = async (name: string, email: string) => (await call('POST', '/api/platform/companies', { name, country: 'IN', products: ['sme'], superAdmin: { name: 'SA', email } })).body.company.id as string;
  sme = await mk('Ganesh Fasteners', 'owner@sme.test');
  other = await mk('Other SME', 'other@sme.test');
  await p.query(`UPDATE app_user SET password_hash = $1, must_change_password = false WHERE tenant_id IS NOT NULL`, [pw]);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'prep@sme.test','Prep','preparer',$2,false)`, [sme, pw]);
  await p.end();
  owner = await login('owner@sme.test'); prep = await login('prep@sme.test');
});
after(async () => { await app?.close(); await pool?.end(); });

test('API: own dates saved with the calendar module; .ics has the upcoming ones with repeats', async () => {
  const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), past = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const data = { cto: '2030-03-31', done: {}, custom: [
    { id: 'k1', title: 'Boiler inspection, Hall 2', date: soon, repeat: 'once', notes: 'Inspector: Mr Patil; bring logbook' },
    { id: 'k2', title: 'Old once', date: past, repeat: 'once' },
    { id: 'k3', title: 'Society AGM', date: past, repeat: 'yearly' }] };
  assert.equal((await call('PUT', `/api/sme/data/calendar?fy=${FY}`, { data }, prep)).status, 200);
  const d = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body;
  assert.equal(d.results.calendar.filter((x: any) => x.own).length, 3);
  const r = await call('GET', `/api/sme/calendar.ics?fy=${FY}`, undefined, prep);
  assert.equal(r.status, 200); assert.match(String(r.headers['content-type']), /text\/calendar/);
  const ics = r.text;
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n')); assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, l);
  const flat = ics.replace(/\r\n /g, '');
  assert.match(flat, /SUMMARY:Boiler inspection\\, Hall 2/);
  assert.match(flat, /Inspector: Mr Patil\\; bring logbook/);
  assert.match(flat, new RegExp(`DTSTART;VALUE=DATE:${soon.replace(/-/g, '')}`));
  assert.doesNotMatch(flat, /Old once/);                                       // passed: not "upcoming"
  assert.match(flat, /SUMMARY:Society AGM[\s\S]*?END:VEVENT/);
  assert.match(flat, /RRULE:FREQ=MONTHLY/);                                    // PF and ESI every month
  assert.equal((flat.match(/BEGIN:VEVENT/g) ?? []).length, (flat.match(/END:VEVENT/g) ?? []).length);
  // another company cannot read it
  assert.doesNotMatch((await call('GET', `/api/sme/calendar.ics?fy=${FY}`, undefined, await login('other@sme.test'))).text, /Boiler/);
});

test('API: reminder settings — who may change them, only own people; e-mails never sent twice', async () => {
  const g = (await call('GET', '/api/sme/calendar/reminders', undefined, owner)).body;
  assert.equal(g.settings.enabled, false); assert.deepEqual(g.settings.days, [15, 3]); assert.equal(typeof g.mail, 'boolean');
  const me = g.people.find((p: any) => p.email === 'owner@sme.test').id, prepId = g.people.find((p: any) => p.email === 'prep@sme.test').id;
  const otherUser = (await call('GET', '/api/sme/calendar/reminders', undefined, await login('other@sme.test'))).body.people[0].id;
  assert.equal((await call('PUT', '/api/sme/calendar/reminders', { enabled: true, recipients: [me], days: [15, 3], overdue: true }, prep)).status, 403);
  assert.equal((await call('PUT', '/api/sme/calendar/reminders', { enabled: true, recipients: [otherUser], days: [15, 3], overdue: true }, owner)).status, 400);
  assert.equal((await call('PUT', '/api/sme/calendar/reminders', { enabled: true, recipients: [], days: [15], overdue: true }, owner)).status, 400);
  const put = await call('PUT', '/api/sme/calendar/reminders', { enabled: true, recipients: [me, prepId], days: [3, 15, 15], overdue: true }, owner);
  assert.equal(put.status, 200); assert.deepEqual(put.body.settings.days, [15, 3]);

  const { tenantTx, platformTx } = await import('../src/db/pool.js');
  const { remindSme, runSmeReminders } = await import('../src/lib/sme/reminders.js');
  const outbox = async () => platformTx(async (c) => (await c.query(`SELECT to_email, subject, body FROM email_outbox WHERE tenant_id = $1 ORDER BY id`, [sme])).rows);
  // without e-mail set up nothing is sent or recorded
  assert.equal((await tenantTx(sme, (c) => remindSme(c, sme, new Date(), { mail: false }))).skipped, 'e-mail is not set up');
  const now = new Date();
  const r1 = await tenantTx(sme, (c) => remindSme(c, sme, now, { mail: true }));
  assert.ok(r1.items >= 2, JSON.stringify(r1)); assert.equal(r1.people, 2);
  const mails = await outbox();
  assert.equal(mails.length, 2);
  assert.match(mails[0].body, /Boiler inspection, Hall 2/); assert.match(mails[0].body, /Old once/);      // 10 days: the 15-day reminder; passed: overdue
  assert.match(mails[0].subject, /passed/);
  // the same day again, and through the platform run: nothing new
  assert.equal((await tenantTx(sme, (c) => remindSme(c, sme, now, { mail: true }))).items, 0);
  await runSmeReminders(now, () => {}, { anyHour: true, mail: true });
  assert.equal((await outbox()).length, 2);
  // a week later the boiler is 3 days away: one more reminder, only for it
  const r2 = await tenantTx(sme, (c) => remindSme(c, sme, new Date(now.getTime() + 7 * 864e5), { mail: true }));
  assert.ok(r2.items >= 1);
  const m2 = (await outbox()).slice(2);
  assert.equal(m2.length, 2); assert.match(m2[0].body, /Boiler inspection/); assert.doesNotMatch(m2[0].body, /Old once/);
  // marked done: no more reminders for it
  const cal = (await call('GET', `/api/sme/data?fy=${FY}`, undefined, owner)).body.data.calendar;
  await call('PUT', `/api/sme/data/calendar?fy=${FY}`, { data: { ...cal, done: { 'own-k1': true } } }, owner);
  const r3 = await tenantTx(sme, (c) => remindSme(c, sme, new Date(now.getTime() + 9 * 864e5), { mail: true }));
  assert.ok(!(await outbox()).slice(4).some((m: any) => /Boiler/.test(m.body)), JSON.stringify(r3));
  const recent = (await call('GET', '/api/sme/calendar/reminders', undefined, owner)).body.recent;
  assert.ok(recent.some((x: any) => x.item_id === 'own-k1' && x.kind === 'd15'));
  assert.ok(recent.some((x: any) => x.item_id === 'own-k1' && x.kind === 'd3'));
  // switched off: nothing
  await call('PUT', '/api/sme/calendar/reminders', { enabled: false, recipients: [me], days: [15, 3], overdue: true }, owner);
  assert.equal((await tenantTx(sme, (c) => remindSme(c, sme, new Date(now.getTime() + 20 * 864e5), { mail: true }))).skipped, 'reminders are off');
});
