/** Compliance calendar: every filing and renewal that applies, grouped by month, with licence dates and "done" ticks. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead, Text } from './ui';
import { dmy } from '../../lib/sme';
import './comply.css';

interface Due { id: string; title: string; date: string; freq: string; who: string; go: string | null; days: number; status: 'overdue' | 'soon' | 'later' | 'done' }
type Filter = 'open' | 'overdue' | 'soon' | 'later' | 'done' | 'all';
const FILTERS: [Filter, string][] = [['open', 'To do'], ['overdue', 'Overdue'], ['soon', 'Due soon'], ['later', 'Later'], ['done', 'Done'], ['all', 'All']];

const when = (x: Due) => (x.status === 'done' ? 'Done' : x.days < -1 ? `${-x.days} days overdue` : x.days === -1 ? '1 day overdue' : x.days === 0 ? 'Due today' : x.days === 1 ? 'Tomorrow' : `In ${x.days} days`);
const day = (s: string) => new Date(`${s}T00:00:00`);

export function SmeCalendar() {
  const { d, get, set } = useSme();
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

  return (
    <>
      <SmeHead lede="Every recurring filing and renewal that applies to you, in date order. Dates are typical; confirm them for your state." />
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
                      <h3>{x.title}</h3>
                      <p>{dmy(x.date)} · {x.freq} · {x.who}{x.go && <Link to={`/sme/${x.go}`}>Open</Link>}</p>
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
          <div className="card"><h2>Your licence dates</h2>
            <p className="cmp-sub">Enter the expiry date printed on each licence. It appears in the calendar with reminders.</p>
            <Text path="calendar.cto" label="Consent to Operate expiry" type="date" />
            <Text path="calendar.factory" label="Factory licence expiry" type="date" />
            <Text path="calendar.fire" label="Fire NOC expiry" type="date" />
            {noLicence && <div className="sme-callout warn" style={{ marginTop: 8 }}>Licence renewals are the dates most often missed. Add them here.</div>}
          </div>
          <div className="card"><h2>Reminders</h2>
            <p className="cmp-sub">Reminders go out on WhatsApp and email 45, 15 and 3 days before each date.</p>
            <Link to="/sme/whatsapp">WhatsApp reminders</Link>
            <p className="cmp-sub" style={{ marginTop: 12 }}>Certificate expiry dates come from <Link to="/sme/certs">Certifications</Link>.</p>
          </div>
        </div>
      </div>
    </>);
}
