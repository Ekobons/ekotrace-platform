/**
 * Compliance calendar: every filing and renewal that applies, grouped by month, with licence dates, the company's
 * own dates, "done" ticks, a download for the user's own calendar (.ics) and e-mail reminder settings.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../App';
import { call, download } from '../../lib/api';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead, Text } from './ui';
import { dmy } from '../../lib/sme';
import './comply.css';
import './calendar.css';

interface Due { id: string; title: string; date: string; freq: string; who: string; go: string | null; days: number; status: 'overdue' | 'soon' | 'later' | 'done'; own?: boolean; notes?: string }
interface Own { id: string; title: string; date: string; repeat: 'yearly' | 'once'; notes?: string }
type Filter = 'open' | 'overdue' | 'soon' | 'later' | 'done' | 'all';
const FILTERS: [Filter, string][] = [['open', 'To do'], ['overdue', 'Overdue'], ['soon', 'Due soon'], ['later', 'Later'], ['done', 'Done'], ['all', 'All']];

const when = (x: Due) => (x.status === 'done' ? 'Done' : x.days < -1 ? `${-x.days} days overdue` : x.days === -1 ? '1 day overdue' : x.days === 0 ? 'Due today' : x.days === 1 ? 'Tomorrow' : `In ${x.days} days`);
const day = (s: string) => new Date(`${s}T00:00:00`);

export function SmeCalendar() {
  const { d, fy, get, set } = useSme();
  const { toast } = useApp();
  const [filter, setFilter] = useState<Filter>('open');
  if (!d) return <div className="card empty">Loading…</div>;
  const all = (d.results.calendar ?? []) as Due[];
  // a tick shows at once; the server confirms it on the next save
  const items = all.map((x) => { const t = get(`calendar.done.${x.id}`); return t === undefined ? x : { ...x, status: t ? 'done' : x.days < 0 ? 'overdue' : x.status === 'done' ? (x.days <= 45 ? 'soon' : 'later') : x.status } as Due; });
  const count = (f: Filter) => items.filter((x) => (f === 'all' ? true : f === 'open' ? x.status !== 'done' : x.status === f)).length;
  const shown = items.filter((x) => (filter === 'all' ? true : filter === 'open' ? x.status !== 'done' : x.status === filter));
  const months: [string, Due[]][] = [];
  for (const x of shown) { const k = x.date.slice(0, 7), last = months[months.length - 1]; if (last && last[0] === k) last[1].push(x); else months.push([k, [x]]); }
  const noLicence = !get('calendar.cto') && !get('calendar.factory') && !get('calendar.fire');
  const upcoming = items.filter((x) => x.status !== 'done' && x.days >= 0).length;
  const ics = async () => {
    try { await download(`/api/sme/calendar.ics?fy=${encodeURIComponent(fy)}`, 'ekotrace-sme-calendar.ics'); toast('Calendar file downloaded. Open it to add the dates.'); } catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <SmeHead lede="Every recurring filing and renewal that applies to you, in date order, with your own dates added. Dates are typical; confirm them for your state.">
        <button type="button" className="btn" disabled={!upcoming} onClick={() => void ics()} title="Download every upcoming date as a calendar file">Add to my calendar</button>
      </SmeHead>
      <Kpis>
        <Kpi label="Overdue" value={count('overdue')} unit={count('overdue') ? 'need action now' : 'nothing late'} good={!count('overdue')} />
        <Kpi label="Due in 45 days" value={count('soon')} unit="prepare now" />
        <Kpi label="Later" value={count('later')} unit="on the list" />
        <Kpi label="Done" value={count('done')} unit={`of ${items.length}`} />
      </Kpis>

      <div className="cmp-main">
        <div className="card">
          <div className="cmp-h2row"><h2>Due dates</h2>
            <div className="seg cmp-filter" role="group" aria-label="Show">
              {FILTERS.map(([k, t]) => <button key={k} type="button" className={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{t}<span className="ct">{count(k)}</span></button>)}
            </div>
          </div>
          {months.map(([k, xs]) => (
            <section key={k} className="cal-month">
              <span className="lbl">{day(`${k}-01`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
              {xs.map((x) => {
                const dt = day(x.date);
                return (
                  <div key={x.id} className={`cal-item ${x.status}`}>
                    <div className="cal-date" aria-hidden="true"><b>{dt.getDate()}</b><small>{dt.toLocaleDateString('en-IN', { weekday: 'short' })}</small></div>
                    <div style={{ minWidth: 0 }}>
                      <h3>{x.title}{x.own && <span className="cal-own">Your date</span>}</h3>
                      <p>{dmy(x.date)} · {x.freq}{x.own ? '' : ` · ${x.who}`}{x.go && <Link to={`/sme/${x.go}`}>Open</Link>}</p>
                      {x.notes && <p className="cal-notes">{x.notes}</p>}
                    </div>
                    <div className="cal-end">
                      <Pill kind={x.status}>{when(x)}</Pill>
                      <label className="cmp-tick"><input type="checkbox" disabled={!d.canEdit} checked={x.status === 'done'} onChange={(e) => set(`calendar.done.${x.id}`, e.target.checked)} />Done</label>
                    </div>
                  </div>);
              })}
            </section>))}
          {!shown.length && (
            <p className="empty">{!items.length ? <>No dates yet. Complete your <Link to="/sme/profile">Profile</Link> and add your licence dates.</>
              : filter === 'overdue' ? 'Nothing overdue.' : filter === 'done' ? 'Nothing marked done yet.' : 'Nothing in this view.'}</p>)}
        </div>

        <div className="cmp-stack">
          <OwnDates />
          <div className="card"><h2>Your licence dates</h2>
            <p className="cmp-sub">Enter the expiry date printed on each licence. It appears in the calendar with reminders.</p>
            <Text path="calendar.cto" label="Consent to Operate expiry" type="date" />
            <Text path="calendar.factory" label="Factory licence expiry" type="date" />
            <Text path="calendar.fire" label="Fire NOC expiry" type="date" />
            {noLicence && <div className="sme-callout warn" style={{ marginTop: 8 }}>Licence renewals are the dates most often missed. Add them here.</div>}
            <p className="cmp-sub" style={{ marginTop: 10, marginBottom: 0 }}>Certificate expiry dates come from <Link to="/sme/certs">Certifications</Link>.</p>
          </div>
          <Reminders />
          <div className="card"><h2>Other ways to be reminded</h2>
            <p className="cmp-sub"><b>Add to my calendar</b> (top of the page) downloads every upcoming date as one file. Open it on your phone or computer to add the dates to Google Calendar, Outlook or Apple Calendar, each with an alert 3 days before. It is a copy: after you add or change dates here, download it again.</p>
            <p className="cmp-sub" style={{ marginBottom: 0 }}>WhatsApp reminders are not sent automatically. Ready-made messages to send yourself are on the <Link to="/sme/whatsapp">WhatsApp</Link> page.</p>
          </div>
        </div>
      </div>
    </>);
}

/** The company's own dates: add, change, remove (saved with the calendar). */
function OwnDates() {
  const { d, get, set } = useSme();
  const list: Own[] = Array.isArray(get('calendar.custom')) ? get('calendar.custom') : [];
  const blank = { title: '', date: '', repeat: 'once' as Own['repeat'], notes: '' };
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const can = !!d?.canEdit;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!f.title.trim()) return setErr('Give the date a name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return setErr('Choose the date.');
    setErr('');
    const row: Own = { id: editing ?? `c${Date.now().toString(36)}`, title: f.title.trim().slice(0, 120), date: f.date, repeat: f.repeat, notes: f.notes.trim().slice(0, 500) };
    set('calendar.custom', editing ? list.map((x) => (x.id === editing ? row : x)) : [...list, row].slice(0, 100));
    setF(blank); setEditing(null); setOpen(false);
  };
  const edit = (x: Own) => { setF({ title: x.title, date: x.date, repeat: x.repeat === 'yearly' ? 'yearly' : 'once', notes: x.notes ?? '' }); setEditing(x.id); setOpen(true); setErr(''); };
  const remove = (x: Own) => { if (window.confirm(`Remove "${x.title}" from the calendar?`)) set('calendar.custom', list.filter((y) => y.id !== x.id)); };
  const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
  return (
    <div className="card">
      <div className="cmp-h2row"><h2>Your own dates</h2>{can && !open && <button type="button" className="btn sm" onClick={() => { setOpen(true); setEditing(null); setF(blank); }}>+ Add a date</button>}</div>
      <p className="cmp-sub">Anything else you must not miss: a boiler inspection, insurance renewal, a buyer audit, AMC visits.</p>
      {sorted.length > 0 && <ul className="cal-own-list">{sorted.map((x) => (
        <li key={x.id}>
          <div><b>{x.title}</b><small>{dmy(x.date)} · {x.repeat === 'yearly' ? 'every year' : 'once'}{x.notes ? ` · ${x.notes}` : ''}</small></div>
          {can && <span className="cal-own-act"><button type="button" className="btn xs ghost" onClick={() => edit(x)}>Change</button><button type="button" className="btn xs ghost danger" onClick={() => remove(x)} aria-label={`Remove ${x.title}`}>Remove</button></span>}
        </li>))}</ul>}
      {!sorted.length && !open && <p className="muted small" style={{ margin: 0 }}>{can ? 'None yet.' : 'None added.'}</p>}
      {can && open && (
        <form className="cmp-form" onSubmit={save} noValidate>
          <label className="wide"><span>What</span><input className="input" value={f.title} maxLength={120} placeholder="e.g. Boiler inspection" onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></label>
          <label><span>Date</span><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label><span>Repeats</span><select className="input" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value as Own['repeat'] })}><option value="once">Once</option><option value="yearly">Every year</option></select></label>
          <label className="wide"><span>Notes<small> (optional)</small></span><input className="input" value={f.notes} maxLength={500} placeholder="Who to call, what to bring" onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
          {err && <p className="cmp-err" role="alert">{err}</p>}
          <div className="wide row" style={{ gap: 8 }}><button className="btn p sm" type="submit">{editing ? 'Save changes' : 'Add to calendar'}</button><button type="button" className="btn sm ghost" onClick={() => { setOpen(false); setEditing(null); setErr(''); }}>Cancel</button></div>
        </form>)}
    </div>);
}

interface Person { id: string; name: string; email: string; role: string }
interface RemSettings { enabled: boolean; recipients: string[]; days: number[]; overdue: boolean; updated_name?: string | null; updated_at?: string | null }
interface RemInfo { mail: boolean; settings: RemSettings; fy: string; people: Person[]; recent: { item_id: string; title: string; due: string; kind: string; recipients: number; sent_at: string }[] }
const DAY_CHOICES = [30, 15, 7, 3, 1];
const kindText = (k: string) => (k === 'overdue' ? 'date passed' : `${k.slice(1)} days before`);

/** E-mail reminders: on/off, who receives them, how many days before. */
function Reminders() {
  const { d, fy } = useSme();
  const { role, toast } = useApp();
  const [info, setInfo] = useState<RemInfo | null>(null);
  const [s, setS] = useState<RemSettings | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { call<RemInfo>('GET', '/api/sme/calendar/reminders').then((r) => { setInfo(r); setS(r.settings); }).catch((e) => setErr((e as Error).message)); }, []);
  const can = ['super_admin', 'admin', 'manager', 'platform_admin'].includes(role);
  const upd = (p: Partial<RemSettings>) => { setS((x) => (x ? { ...x, ...p } : x)); setDirty(true); };
  const save = async () => {
    if (!s) return;
    setBusy(true); setErr('');
    try {
      const r = await call<{ settings: RemSettings }>('PUT', '/api/sme/calendar/reminders', { enabled: s.enabled, recipients: s.recipients, days: s.days, overdue: s.overdue });
      setS(r.settings); setInfo((i) => (i ? { ...i, settings: r.settings } : i)); setDirty(false); toast('Reminder settings saved');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (!d) return null;
  return (
    <div className="card">
      <div className="cmp-h2row"><h2>E-mail reminders</h2>{info && s && <Pill kind={s.enabled && info.mail ? 'good' : 'watch'}>{!info.mail ? 'E-mail not set up' : s.enabled ? 'On' : 'Off'}</Pill>}</div>
      {!info && !err && <p className="muted small">Loading…</p>}
      {err && <p className="note bad small" role="alert">{err}</p>}
      {info && s && <>
        {!info.mail && <div className="note warn small cal-note">E-mail is not set up on this server yet, so no reminder e-mails can go out. Your choices are kept, and reminders start once EKOTRACE support sets up e-mail. Until then use <b>Add to my calendar</b>.</div>}
        <p className="cmp-sub">An e-mail to the people you choose, before each date that is not marked done, and once when a date has passed. Each reminder is sent only once.</p>
        <label className="cal-sw"><input type="checkbox" disabled={!can} checked={s.enabled} onChange={(e) => upd({ enabled: e.target.checked })} /><span>Send reminder e-mails</span></label>
        <fieldset className="cal-fs" disabled={!can}>
          <legend>Who receives them</legend>
          {info.people.map((p) => (
            <label key={p.id} className="cal-person"><input type="checkbox" checked={s.recipients.includes(p.id)} onChange={(e) => upd({ recipients: e.target.checked ? [...s.recipients, p.id] : s.recipients.filter((x) => x !== p.id) })} />
              <span><b>{p.name}</b><small>{p.email}</small></span></label>))}
        </fieldset>
        <fieldset className="cal-fs" disabled={!can}>
          <legend>Days before the date</legend>
          <div className="cal-days">{DAY_CHOICES.map((n) => {
            const on = s.days.includes(n);
            return <button key={n} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => { const next = on ? s.days.filter((x) => x !== n) : [...s.days, n].sort((a, b) => b - a); if (next.length) upd({ days: next }); }}>{n}</button>;
          })}</div>
          <label className="cal-person" style={{ marginTop: 8 }}><input type="checkbox" checked={s.overdue} onChange={(e) => upd({ overdue: e.target.checked })} /><span>Also once when a date has passed</span></label>
        </fieldset>
        {can && <div className="row" style={{ gap: 8, marginTop: 12 }}><button type="button" className="btn p sm" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>{dirty && <span className="muted small">Not saved yet</span>}</div>}
        {!can && <p className="muted small" style={{ margin: '10px 0 0' }}>The owner, an admin or a manager can change these.</p>}
        {info.fy !== fy && <p className="muted small" style={{ margin: '10px 0 0' }}>Reminders follow the dates entered for {info.fy}.</p>}
        {info.recent.length > 0 && <div className="cal-recent"><span className="lbl">Last sent</span>
          <ul>{info.recent.slice(0, 5).map((r) => <li key={`${r.item_id}-${r.due}-${r.kind}`}><span>{r.title || r.item_id}</span><small>{dmy(r.sent_at)} · {kindText(r.kind)} · to {r.recipients}</small></li>)}</ul></div>}
      </>}
    </div>);
}
