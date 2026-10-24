/**
 * Collection calendar (Capture): what each facility owes for each metric of the registry, by period —
 * due dates, who is responsible, where it stands (approved, in review, in progress, missing, excused) and
 * whether it is due soon, overdue or escalated. Reminders go out by themselves (Inbox and e-mail); managers
 * and admins can also remind people now, or excuse a period with a reason.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, type CalendarData, type Obligation } from '../lib/api';
import { Icon } from '../components/Icon';

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d8 = (x: string) => new Date(x.length === 10 ? `${x}T00:00:00` : x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dm = (x: string) => new Date(`${x}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const SPEND = ['purchased_goods', 'capital_goods'];
/** Where to enter the data for an obligation. */
export function entryLink(o: Pick<Obligation, 'facilityId' | 'period' | 'metricId' | 'level'>, cat: string) {
  const y = o.period.slice(0, 4), m = Number(o.period.slice(5, 7));
  if (SPEND.includes(cat)) return '/purchases';
  if (cat === 'employee_commuting') return '/surveys';
  const route = cat.startsWith('waste_') ? 'waste_generated' : cat.startsWith('water_') ? 'water_supply' : cat;
  return o.level === 'company' ? `/data/${route}?year=${y}&month=${m}` : `/data/${route}?facility=${o.facilityId}&year=${y}&month=${m}`;
}
/** One word and a colour for where an obligation stands. */
export function stateOf(o: Obligation): [string, string] {
  if (o.status === 'excused') return ['Excused', 'grey'];
  if (o.status === 'approved') return [o.late ? 'Approved · late' : 'Approved', 'ok'];
  if (o.status === 'submitted') return [o.late ? 'In review · late' : 'In review', 'info'];
  const part = o.status === 'in_progress' ? ' · partial' : '';
  if (o.timing === 'escalated') return [`Escalated${part}`, 'bad strong'];
  if (o.timing === 'overdue') return [`Overdue${part}`, 'bad'];
  if (o.timing === 'due_soon') return [`Due soon${part}`, 'warn'];
  return [o.status === 'in_progress' ? 'In progress' : 'Open', 'grey'];
}
type Filter = '' | 'due_soon' | 'late' | 'escalated' | 'progress' | 'done' | 'excused';
const match = (o: Obligation, f: Filter) => !f || (f === 'due_soon' ? o.timing === 'due_soon' : f === 'late' ? o.timing === 'overdue' || o.timing === 'escalated'
  : f === 'escalated' ? o.timing === 'escalated' : f === 'progress' ? o.status === 'in_progress' || o.status === 'submitted' : f === 'done' ? o.status === 'approved' : o.status === 'excused');

export function CollectionCalendar() {
  const { toast, me } = useApp();
  const [sp, setSp] = useSearchParams();
  const now = new Date().getFullYear();
  const [year, setYear] = useState(Number(sp.get('year')) || now);
  const [d, setD] = useState<CalendarData | null>(null);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>(sp.get('view') === 'list' || sp.get('timing') || sp.get('mine') || window.innerWidth < 760 ? 'list' : 'grid');
  const [filter, setFilter] = useState<Filter>((sp.get('timing') as Filter) ?? '');
  const [fac, setFac] = useState('');
  const [mine, setMine] = useState(sp.get('mine') === '1');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  useEffect(() => { api.metrics().then((L) => setCats(Object.fromEntries(L.metrics.map((m) => [m.id, m.category_code])))).catch(() => {}); }, []);
  useEffect(() => { setD(null); api.calendar({ year }).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { const n = new URLSearchParams(); if (year !== now) n.set('year', String(year)); if (view === 'list') n.set('view', 'list'); if (filter) n.set('timing', filter); if (mine) n.set('mine', '1'); setSp(n, { replace: true }); }, [year, view, filter, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = d?.obligations ?? [];
  const facs = useMemo(() => [...new Map(all.map((o) => [o.facilityId, o.facility])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [all]);
  const rows = all.filter((o) => (!fac || o.facilityId === fac) && (!mine || o.responsible.some((p) => p.id === me.user.id) || o.escalateTo.some((p) => p.id === me.user.id)) && match(o, filter));
  const cnt = (f: Filter) => all.filter((o) => match(o, f)).length;
  const due = all.filter((o) => o.status === 'approved' || o.status === 'submitted');
  const onTime = due.length ? Math.round((due.filter((o) => !o.late).length / due.length) * 100) : null;
  const open = all.find((o) => o.key === openKey) ?? null;
  const remind = async (keys: string[]) => {
    try { const r = await api.calendarRemind(keys); toast(r.sent ? `Reminder sent for ${r.sent} item${r.sent > 1 ? 's' : ''} to ${r.people} ${r.people === 1 ? 'person' : 'people'}${r.skipped ? ` · ${r.skipped} skipped (done, or already reminded today)` : ''}` : 'Nothing to remind: done, or already reminded today'); setSel(new Set()); reload(); }
    catch (e) { toast((e as Error).message); }
  };
  const chaseable = rows.filter((o) => o.canChase && o.timing !== 'done');
  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Capture</span><h1>Collection calendar · {year}</h1>
          <div className="muted">What each facility owes for each metric of the <Link to="/metrics">metric registry</Link>, when it is due and where it stands. People get reminders before the due date, after it, and their managers when it is badly late.</div></div>
        <span className="grow" />
        <select className="input" aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }}>{[now + 1, now, now - 1, now - 2, now - 3].map((y) => <option key={y}>{y}</option>)}</select>
      </div>
      {d && <Rules d={d} onChanged={reload} />}
      <div className="kgrid6">
        {([['due_soon', 'Due soon', `within ${d?.settings.remindDays ?? 3} days`, 'var(--warn)'], ['late', 'Overdue', 'past the due date', 'var(--bad)'], ['escalated', 'Escalated', `over ${d?.settings.escalateDays ?? 7} days late`, 'var(--bad)'],
          ['progress', 'In progress · review', 'started or waiting for approval', 'var(--info)'], ['done', 'Approved', onTime == null ? 'nothing in yet' : `${onTime}% in on time`, 'var(--ok)'], ['excused', 'Excused', 'not owed, with a reason', undefined]] as [Filter, string, string, string | undefined][])
          .map(([k, l, sub, col]) => (
            <button key={k} type="button" className={`card kpi vk${filter === k ? ' on' : ''}`} onClick={() => { setFilter(filter === k ? '' : k); if (k !== 'done' && k !== 'excused' && k !== 'progress') setView('list'); }}>
              <span className="muted small">{l}</span><b style={{ color: cnt(k) ? col : undefined }}>{d ? cnt(k) : '…'}</b><span className="muted small">{sub}</span></button>))}
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="seg strong" role="tablist">
          <button role="tab" aria-selected={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>By month</button>
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        </div>
        <select className="input" aria-label="Facility" value={fac} onChange={(e) => setFac(e.target.value)} style={{ maxWidth: 260 }}><option value="">All facilities</option>{facs.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        {filter && <button className="btn sm ghost" onClick={() => setFilter('')}>Clear filter ×</button>}
        <span className="grow" />
        {view === 'list' && chaseable.length > 0 && <button className="btn" disabled={!sel.size} onClick={() => remind([...sel])}><Icon name="inbox" /> Remind selected ({sel.size})</button>}
      </div>
      {!d ? <div className="card empty">Loading…</div> : !all.length ? (
        <div className="card empty">Nothing is owed in {year} yet. A facility owes a metric when the metric is required for it, or when it reports that metric. Set metrics up in the <Link to="/metrics">metric registry</Link>.</div>
      ) : view === 'grid' ? <Grid rows={rows} year={year} today={d.today} onOpen={setOpenKey} /> : (
        <div className="card flush"><div className="scroll"><table className="t caltable">
          <thead><tr><th style={{ width: 28 }}>{chaseable.length > 0 && <input type="checkbox" aria-label="Select all" checked={sel.size > 0 && chaseable.every((o) => sel.has(o.key))} onChange={(e) => setSel(e.target.checked ? new Set(chaseable.map((o) => o.key)) : new Set())} />}</th>
            <th>Due</th><th>Facility</th><th>Metric</th><th>Period</th><th className="ctr">Status</th><th>Responsible</th><th className="num">Data in</th><th>Reminders</th></tr></thead>
          <tbody>{rows.map((o) => { const [t, c] = stateOf(o); return (
            <tr key={o.key} className={`click${openKey === o.key ? ' sel' : ''}`} onClick={() => setOpenKey(o.key)}>
              <td onClick={(e) => e.stopPropagation()}>{o.canChase && o.timing !== 'done' && <input type="checkbox" aria-label="Select" checked={sel.has(o.key)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(o.key); else n.delete(o.key); setSel(n); }} />}</td>
              <td className="nowrap small"><b>{dm(o.due)}</b>{o.daysLate > 0 && <div style={{ color: 'var(--bad)' }}>{o.daysLate} day{o.daysLate > 1 ? 's' : ''} late</div>}</td>
              <td className="small">{o.facility}</td>
              <td className="small"><span className="mono muted">{o.metricCode}</span> {o.metric}</td>
              <td className="small nowrap">{o.label}</td>
              <td><span className={`chip ${c}`}>{t}</span>{o.evidence === 'required' && o.withoutEvidence > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{o.withoutEvidence} without evidence</div>}</td>
              <td className="small">{o.responsible.map((p) => p.name).join(', ') || <span style={{ color: 'var(--bad)' }}>Nobody — assign a preparer or owner</span>}</td>
              <td className="num small">{o.quantity != null ? `${num(o.quantity, 4)} ${o.unit}` : o.entries ? `${o.entries} entr${o.entries > 1 ? 'ies' : 'y'}` : '—'}</td>
              <td className="small muted">{o.reminders.length ? `${o.reminders.length} · last ${dm(o.reminders[o.reminders.length - 1]!.at.slice(0, 10))}` : '—'}</td>
            </tr>); })}
            {!rows.length && <tr><td colSpan={9} className="muted">Nothing matches these filters.</td></tr>}</tbody>
        </table></div></div>)}
      {open && <ObDrawer o={open} cat={cats[open.metricId] ?? ''} settings={d!.settings} onClose={() => setOpenKey(null)} onChanged={reload} onRemind={(k) => remind([k])} />}
    </div>);
}

/** The rules: due day, reminders, escalation, e-mail. A super admin changes them here. */
function Rules({ d, onChanged }: { d: CalendarData; onChanged: () => void }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(d.settings);
  useEffect(() => setF(d.settings), [d.settings]);
  const s = d.settings;
  const save = async (b: Partial<typeof f>, msg: string) => { try { await api.calendarSettings(b); toast(msg); onChanged(); } catch (e) { toast((e as Error).message); } };
  const run = async () => { try { const r = await api.calendarRun(); toast(r.skipped ? `Not sent: ${r.skipped}` : `Sent: ${r.due_soon} due soon, ${r.overdue} overdue, ${r.escalated} escalated → ${r.people} message${r.people === 1 ? '' : 's'}`); onChanged(); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="card calrules">
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <span className="small">Monthly data due on <b>day {s.dueDay}</b> of the next month (a metric can set its own) · reminder <b>{s.remindDays} days before</b> · overdue the day after · escalated after <b>{s.escalateDays} days</b> late</span>
        <span className={`chip ${s.reminders ? '' : 'grey'}`}>Reminders {s.reminders ? 'on' : 'off'}</span>
        <span className={`chip ${d.mailOn ? '' : 'grey'}`} title={d.mailOn ? 'Reminders also go by e-mail' : 'No mail server is set for this platform: reminders appear in Inbox & to-dos only'}>E-mail {d.mailOn ? 'on' : 'not set up'}</span>
        <span className="grow" />
        {d.canSettings && !edit && <><button className="btn sm" onClick={() => setEdit(true)}>Change rules</button><button className="btn sm" onClick={run} disabled={!s.reminders}>Send due reminders now</button></>}
      </div>
      {edit && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 120 }}><span>Due day</span><input className="input num" type="number" min={1} max={28} value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: Number(e.target.value) })} /></label>
          <label className="field" style={{ width: 150 }}><span>Remind days before</span><input className="input num" type="number" min={0} max={30} value={f.remindDays} onChange={(e) => setF({ ...f, remindDays: Number(e.target.value) })} /></label>
          <label className="field" style={{ width: 150 }}><span>Escalate after days late</span><input className="input num" type="number" min={1} max={90} value={f.escalateDays} onChange={(e) => setF({ ...f, escalateDays: Number(e.target.value) })} /></label>
          <label className="row small" style={{ gap: 6, paddingBottom: 8 }}><input type="checkbox" checked={f.reminders} onChange={(e) => setF({ ...f, reminders: e.target.checked })} /> Send reminders automatically</label>
          <span className="grow" />
          <button className="btn" onClick={() => { setF(s); setEdit(false); }}>Cancel</button>
          <button className="btn p" onClick={async () => { await save({ dueDay: f.dueDay, remindDays: f.remindDays, escalateDays: f.escalateDays, reminders: f.reminders }, 'Collection rules saved'); setEdit(false); }}>Save</button>
        </div>)}
    </div>);
}

/** Facility × metric rows, months across; quarters and years span their months. */
function Grid({ rows, year, today, onOpen }: { rows: Obligation[]; year: number; today: string; onOpen: (k: string) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { facility: string; metric: string; code: string; freq: string; obs: Obligation[] }>();
    for (const o of rows) { const k = `${o.facility}|${o.metricCode}`; const g = m.get(k) ?? { facility: o.facility, metric: o.metric, code: o.metricCode, freq: o.frequency, obs: [] }; g.obs.push(o); m.set(k, g); }
    return [...m.values()].sort((a, b) => a.facility.localeCompare(b.facility) || a.code.localeCompare(b.code));
  }, [rows]);
  const thisMonth = today.slice(0, 4) === String(year) ? Number(today.slice(5, 7)) : 0;
  let last = '';
  return (
    <div className="card flush"><div className="scroll"><table className="t calgrid">
      <thead><tr><th>Facility · metric</th>{MN.map((m, i) => <th key={m} className={i + 1 === thisMonth ? 'now' : ''}>{m}</th>)}</tr></thead>
      <tbody>{groups.map((g) => {
        const head = g.facility !== last; last = g.facility;
        const cells: ReactElement[] = [];
        for (let mo = 1; mo <= 12;) {
          const o = g.obs.find((x) => Number(x.period.slice(5, 7)) === mo);
          const span = g.freq === 'annual' ? 12 : g.freq === 'quarterly' ? 3 : 1;
          if (!o) { cells.push(<td key={mo} colSpan={span} className="calempty" />); mo += span; continue; }
          const [t0, c] = stateOf(o), t = t0.replace(' · partial', '').replace(' · late', '');
          cells.push(<td key={mo} colSpan={span}><button className={`calcell ${c}`} title={`${o.facility} · ${o.metric} · ${o.label}\nDue ${d8(o.due)} · ${t0}`} onClick={() => onOpen(o.key)}>
            <span>{t}</span><small>due {dm(o.due)}</small></button></td>);
          mo += span;
        }
        return [
          head ? <tr key={`${g.facility}-h`} className="calfac"><td colSpan={13}>{g.facility}</td></tr> : null,
          <tr key={`${g.facility}-${g.code}`}><td className="calname"><span className="mono muted small">{g.code}</span> {g.metric}</td>{cells}</tr>,
        ];
      })}</tbody>
    </table></div>
    <div className="row small muted" style={{ gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
      {[['Approved', 'ok'], ['In review', 'info'], ['Open', 'grey'], ['Due soon', 'warn'], ['Overdue', 'bad'], ['Escalated', 'bad strong'], ['Excused', 'grey']].map(([t, c]) => <span key={t} className={`chip ${c}`}>{t}</span>)}
      <span>Click a period to see who is responsible, the reminders sent, and to enter, remind or excuse it.</span></div>
    </div>);
}

function ObDrawer({ o, cat, settings, onClose, onChanged, onRemind }: { o: Obligation; cat: string; settings: CalendarData['settings']; onClose: () => void; onChanged: () => void; onRemind: (k: string) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [why, setWhy] = useState('');
  const [t, c] = stateOf(o);
  const excuse = async () => { try { await api.calendarExcuse({ facilityId: o.facilityId, metricId: o.metricId, period: o.period, reason: why }); toast('Excused for this period'); onChanged(); } catch (e) { toast((e as Error).message); } };
  const unexcuse = async () => { try { await api.calendarUnexcuse({ facilityId: o.facilityId, metricId: o.metricId, period: o.period }); toast('Owed again'); onChanged(); } catch (e) { toast((e as Error).message); } };
  const KIND: Record<string, string> = { due_soon: 'Due-soon reminder', overdue: 'Overdue reminder', escalated: 'Escalation' };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">{o.metricCode} · {o.label}</div><h2>{o.facility}</h2><div className="muted small">{o.metric} · Scope {o.scope} · {o.category}</div></div>
          <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <div className="row" style={{ gap: 8 }}><span className={`chip ${c}`}>{t}</span><span className="small">due {d8(o.due)}{o.daysLate > 0 ? ` · ${o.daysLate} days late` : ''}</span></div>
        <dl className="mdl">
          <div><dt>Data in</dt><dd>{o.entries ? `${o.entries} entr${o.entries > 1 ? 'ies' : 'y'}` : 'Nothing yet'}{o.quantity != null ? ` · ${num(o.quantity, 6)} ${o.unit}` : ''}{o.otherUnits ? ` (+${o.otherUnits} in other units)` : ''}</dd></div>
          {o.completedAt && <div><dt>Complete since</dt><dd>{d8(o.completedAt)} {o.late ? <span className="chip warn">after the due date</span> : <span className="chip">on time</span>}</dd></div>}
          <div><dt>Evidence</dt><dd>{o.evidence === 'required' ? (o.withoutEvidence ? `${o.withoutEvidence} entr${o.withoutEvidence > 1 ? 'ies' : 'y'} without evidence` : 'Required — all entries have it') : 'Optional'}</dd></div>
          <div><dt>Responsible</dt><dd>{o.owner ? `${o.owner.name} (metric owner)` : o.responsible.map((p) => p.name).join(', ') || 'Nobody — assign a data preparer to the facility or an owner to the metric'}</dd></div>
          <div><dt>Escalation to</dt><dd>{o.escalateTo.map((p) => p.name).join(', ') || '—'} <span className="muted small">after {settings.escalateDays} days late</span></dd></div>
          <div><dt>Reminders sent</dt><dd>{o.reminders.length ? <ul className="small plain">{o.reminders.map((r) => <li key={r.kind}>{KIND[r.kind] ?? 'Reminder by hand'} · {d8(r.at)}</li>)}</ul> : 'None yet'}</dd></div>
          {o.exception && <div><dt>Excused</dt><dd>{o.exception.reason} <span className="muted small">· {o.exception.by} · {d8(o.exception.at)}</span></dd></div>}
        </dl>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {o.canEnter && o.status !== 'approved' && o.status !== 'excused' && <Link className="btn p" to={entryLink(o, cat)}>Enter the data</Link>}
          {o.canChase && o.timing !== 'done' && <button className="btn" onClick={() => onRemind(o.key)}><Icon name="inbox" /> Remind now</button>}
          {o.canChase && o.exception && <button className="btn" onClick={unexcuse}>Owed after all</button>}
        </div>
        {o.canChase && !o.exception && o.status !== 'approved' && o.status !== 'submitted' && (
          <div className="card soft"><b className="small">Not owed for this period?</b>
            <div className="muted small">For example: the facility was closed, or the generator did not run. Kept with your name and the reason, and shown to verifiers.</div>
            <div className="row" style={{ gap: 8, marginTop: 8 }}><input className="input grow" placeholder="Reason" value={why} onChange={(e) => setWhy(e.target.value)} /><button className="btn" disabled={why.trim().length < 3} onClick={excuse}>Excuse</button></div>
          </div>)}
      </div>
    </dialog>);
}
