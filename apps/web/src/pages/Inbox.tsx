/**
 * Inbox & to-dos (Capture): what is waiting for me — data I am responsible for that is due or late,
 * escalations at my facilities, entries sent back to me, approvals waiting for me, registry changes and
 * audit findings to answer — and my notifications (reminders, escalations, sent-back entries, registry
 * decisions), which also come by e-mail unless I switch that off.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, type InboxData, type Notice, type Obligation } from '../lib/api';
import { stateOf } from './CollectionCalendar';
import { Icon } from '../components/Icon';

const ago = (x: string) => {
  const s = (Date.now() - new Date(x).getTime()) / 1000;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
const dm = (x: string) => new Date(`${x}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const KIND: Record<string, [string, string]> = { reminder: ['Reminder', 'warn'], overdue: ['Overdue', 'bad'], escalated: ['Escalation', 'bad'], manual: ['Reminder', 'warn'], returned: ['Sent back', 'bad'], metric_change: ['Registry', 'info'], metric_decision: ['Registry', 'info'], restatement: ['Base year', 'info'] };
const CAT_ROUTE = (cat: string) => (cat.startsWith('waste_') ? 'waste_generated' : cat.startsWith('water_') ? 'water_supply' : cat);

export function Inbox({ onSeen }: { onSeen?: () => void }) {
  const { toast, role } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<InboxData | null>(null);
  const [tick, setTick] = useState(0);
  const [only, setOnly] = useState<'all' | 'unread'>('all');
  useEffect(() => { api.inbox().then(setD).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { setTick((t) => t + 1); onSeen?.(); };
  const read = async (b: { ids?: number[]; all?: boolean }) => { try { await api.inboxRead(b); reload(); } catch (e) { toast((e as Error).message); } };
  const openNote = (n: Notice) => { if (!n.read_at) void api.inboxRead({ ids: [n.id] }).then(() => onSeen?.()); if (n.link) nav(n.link); else reload(); };
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const late = d.mine.filter((o) => o.timing === 'overdue' || o.timing === 'escalated'), soon = d.mine.filter((o) => o.timing === 'due_soon');
  const todo = late.length + soon.length + d.escalations.length + d.returned.length + d.approvals + d.metricChanges + d.findings + (d.restatements ?? 0);
  const notes = d.notifications.filter((n) => only === 'all' || !n.read_at);
  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Capture</span><h1>Inbox &amp; to-dos</h1><div className="muted">What is waiting for you, and the reminders and notices sent to you.</div></div>
        <span className="grow" />
        <label className="row small" style={{ gap: 6 }} title={d.mailOn ? '' : 'No mail server is set up for this platform yet: notices appear here only'}>
          <input type="checkbox" checked={d.emailNotify} onChange={async (e) => { try { await api.inboxSettings(e.target.checked); toast(e.target.checked ? 'You will get e-mails too' : 'E-mails off — notices still appear here'); reload(); } catch (er) { toast((er as Error).message); } }} />
          Also send them to me by e-mail{d.mailOn ? '' : ' (not set up on this platform)'}</label>
      </div>
      <div className="ibgrid">
        <section className="card">
          <div className="row"><h2 className="h3 grow">To do</h2><span className={`chip ${todo ? 'warn' : ''}`}>{todo ? `${todo} open` : 'All clear'}</span></div>
          {!todo && <div className="empty small">Nothing waiting for you. {d.upcoming.length ? 'Coming up is listed below.' : ''}</div>}
          {late.length > 0 && <ObGroup title="Late — data you are responsible for" obs={late} />}
          {d.escalations.length > 0 && <ObGroup title="Escalated to you — badly late at your facilities" obs={d.escalations} />}
          {soon.length > 0 && <ObGroup title="Due soon" obs={soon} />}
          {d.returned.length > 0 && (
            <div className="ibgrp"><div className="eyebrow">Sent back to you</div>
              {d.returned.map((r) => (
                <Link key={r.id} className="ibrow" to={`/data/${CAT_ROUTE(r.cat)}?facility=${r.f}&year=${r.month.slice(0, 4)}&month=${Number(r.month.slice(5, 7))}`}>
                  <span className="chip bad">Fix</span><span className="grow"><b>{r.facility} · {r.item}</b> <span className="muted small">{r.month.slice(0, 7)}</span>
                    {r.note && <div className="small">“{r.note}” <span className="muted">— {r.by}</span></div>}</span><Icon name="chevron" /></Link>))}
            </div>)}
          {(d.approvals > 0 || d.metricChanges > 0 || d.findings > 0 || d.drafts > 0 || (d.restatements ?? 0) > 0) && (
            <div className="ibgrp"><div className="eyebrow">Other work</div>
              {d.approvals > 0 && <Link className="ibrow" to="/approvals"><span className="chip info">{d.approvals}</span><span className="grow">entr{d.approvals > 1 ? 'ies' : 'y'} waiting for your approval</span><Icon name="chevron" /></Link>}
              {d.metricChanges > 0 && <Link className="ibrow" to="/metrics?tab=changes"><span className="chip info">{d.metricChanges}</span><span className="grow">metric registry change{d.metricChanges > 1 ? 's' : ''} to approve or reject</span><Icon name="chevron" /></Link>}
              {(d.restatements ?? 0) > 0 && <Link className="ibrow" to="/methodology#restatements"><span className="chip info">{d.restatements}</span><span className="grow">base-year change{d.restatements! > 1 ? 's' : ''} to approve or reject</span><Icon name="chevron" /></Link>}
              {d.findings > 0 && <Link className="ibrow" to="/assurance"><span className="chip info">{d.findings}</span><span className="grow">open audit finding{d.findings > 1 ? 's' : ''} to answer</span><Icon name="chevron" /></Link>}
              {d.drafts > 0 && <Link className="ibrow" to="/entries"><span className="chip grey">{d.drafts}</span><span className="grow">draft{d.drafts > 1 ? 's' : ''} of yours not submitted yet</span><Icon name="chevron" /></Link>}
            </div>)}
          {d.upcoming.length > 0 && <ObGroup title="Coming up (next 31 days)" obs={d.upcoming} muted />}
          {role !== 'verifier' && <div className="small muted" style={{ marginTop: 8 }}>The whole cycle is on the <Link to="/calendar">Collection calendar</Link>.</div>}
        </section>
        <section className="card">
          <div className="row"><h2 className="h3 grow">Notifications</h2>
            <div className="seg sm"><button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>All</button><button className={only === 'unread' ? 'on' : ''} onClick={() => setOnly('unread')}>Unread ({d.unread})</button></div>
            {d.unread > 0 && <button className="btn sm" onClick={() => read({ all: true })}>Mark all read</button>}</div>
          {!notes.length ? <div className="empty small">{only === 'unread' ? 'Nothing unread.' : 'No notifications yet. Reminders, escalations, sent-back entries and registry decisions appear here.'}</div> : (
            <ul className="iblist">{notes.map((n) => { const [k, c] = KIND[n.kind] ?? ['Notice', 'grey']; return (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                <button type="button" onClick={() => openNote(n)}>
                  <span className="row" style={{ gap: 8 }}><span className={`chip ${c}`}>{k}</span><b className="grow">{n.title}</b><span className="muted small nowrap">{ago(n.at)}</span></span>
                  {n.body && <span className="small ibbody">{n.body}</span>}
                </button>
              </li>); })}</ul>)}
        </section>
      </div>
    </div>);
}

function ObGroup({ title, obs, muted }: { title: string; obs: Obligation[]; muted?: boolean }) {
  return (
    <div className="ibgrp"><div className="eyebrow">{title}</div>
      {obs.slice(0, 30).map((o) => { const [t, c] = stateOf(o); return (
        <Link key={o.key} className={`ibrow${muted ? ' dim' : ''}`} to="/calendar?view=list&mine=1">
          <span className={`chip ${c}`}>{t}</span>
          <span className="grow"><b>{o.facility}</b> · {o.metric} <span className="muted small">{o.metricCode} · {o.label}</span></span>
          <span className="small nowrap">due {dm(o.due)}</span><Icon name="chevron" /></Link>); })}
      {obs.length > 30 && <div className="muted small">…and {obs.length - 30} more on the calendar</div>}
    </div>);
}
