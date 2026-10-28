/**
 * Compliance Position Desk (Disclose → Compliance desk, or its own menu without the GHG inventory).
 *   Position     every regulation in the library: applies / may apply / does not apply, and why; progress this year
 *   Obligations  what falls due in the year (and last year's still open): status from people or from the modules
 *   Calendar     the year month by month; download as .ics for Outlook or Google Calendar
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import { cpApi, type Applies, type CustomBody, type Desk, type Obligation, type Profile, type Status } from '../lib/compliance';

const d8 = (x: string | null | undefined) => (x ? new Date(`${x.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const APPLIES: Record<Applies, [string, string]> = { applies: ['warn', 'Applies'], may_apply: ['info', 'May apply'], not_applicable: ['grey', 'Does not apply'] };
const STATUS: Record<Status, [string, string]> = { not_started: ['grey', 'Not started'], in_progress: ['info', 'In progress'], done: ['', 'Done'], not_applicable: ['grey', 'Not applicable'], overdue: ['bad', 'Overdue'] };
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const daysTo = (due: string, today: string) => Math.round((new Date(`${due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);

export function ComplianceDesk() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const thisYear = new Date().getFullYear();
  const year = sp.get('y') ? Number(sp.get('y')) : thisYear;
  const tab = sp.get('tab') ?? 'position';
  const [d, setD] = useState<Desk | null>(null);
  const [tick, setTick] = useState(0);
  const [profile, setProfile] = useState(false);
  const [open, setOpen] = useState<Obligation | null>(null);
  const [custom, setCustom] = useState<Obligation | 'new' | null>(null);
  const reload = () => setTick((x) => x + 1);
  useEffect(() => { let live = true; setD((x) => (x && x.year === year ? x : null)); cpApi.get(year).then((x) => { if (live) setD(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const regFilter = sp.get('r');
  const applies = d.regulations.filter((r) => r.applies === 'applies'), maybe = d.regulations.filter((r) => r.applies === 'may_apply');
  const live = d.obligations.filter((o) => o.status !== 'not_applicable');
  const done = live.filter((o) => o.status === 'done').length, overdue = live.filter((o) => o.status === 'overdue');
  const next = d.upcoming[0];
  const years = [...new Set([year, thisYear - 1, thisYear, thisYear + 1])].sort((a, b) => b - a);
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose · Compliance</span><h1>Compliance desk</h1>
          <div className="muted">Which climate and sustainability regulations apply to the company and why, what each requires and when, and where each obligation stands — read from the modules where they can tell, set by people elsewhere.</div></div>
        <label className="field" style={{ minWidth: 110 }}><span>Year</span><select className="input" value={year} onChange={(e) => set('y', e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button className="btn" onClick={() => cpApi.ics(year).catch((e) => toast((e as Error).message))}><Icon name="calendar" /> Calendar (.ics)</button>
        <button className="btn" onClick={() => cpApi.exportXlsx(year).catch((e) => toast((e as Error).message))}><Icon name="download" /> Register (Excel)</button>
        <button className="btn" onClick={() => setProfile(true)}><Icon name="building" /> Company profile</button>
      </div>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Regulations that apply</span><b>{applies.length}</b><span className="muted small">{maybe.length ? `${maybe.length} may apply: complete the profile` : 'All checked'}</span></div>
        <div className="card kpi"><span className="muted small">Obligations due in {year}</span><b>{done} <small className="muted">of {live.length} done</small></b>
          <div style={{ height: 6, background: 'var(--bg)', borderRadius: 4, marginTop: 6 }}><div style={{ width: `${live.length ? (done / live.length) * 100 : 0}%`, height: 6, borderRadius: 4, background: 'var(--primary)' }} /></div></div>
        <div className="card kpi"><span className="muted small">Overdue</span><b style={{ color: overdue.length ? 'var(--bad)' : undefined }}>{overdue.length}</b><span className="muted small">{overdue[0] ? `${overdue[0].title} (${d8(overdue[0].due)})` : 'Nothing overdue'}</span></div>
        <div className="card kpi"><span className="muted small">Next deadline</span><b style={{ fontSize: 18 }}>{next ? d8(next.due) : '—'}</b><span className="muted small">{next ? `${next.title} · in ${daysTo(next.due!, d.today)} days` : 'Nothing in the next 90 days'}</span></div>
      </div>
      <div className="seg strong" role="tablist" style={{ margin: '12px 0' }}>
        {([['position', 'Position'], ['obligations', `Obligations · ${live.length}`], ['calendar', 'Calendar']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'position' ? null : k)}>{l}</button>))}
      </div>
      {tab === 'position' && <Position d={d} pick={(code) => { const n = new URLSearchParams(sp); n.set('tab', 'obligations'); n.set('r', code); setSp(n, { replace: true }); }} />}
      {tab === 'obligations' && <Obligations d={d} filter={regFilter} clear={() => set('r', null)} open={setOpen} onCustom={() => setCustom('new')} />}
      {tab === 'calendar' && <Calendar d={d} open={setOpen} />}
      {profile && <ProfileDrawer d={d} onClose={() => setProfile(false)} onDone={() => { setProfile(false); reload(); }} />}
      {open && <StatusDrawer d={d} o={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} onEditCustom={() => { setCustom(open); setOpen(null); }} />}
      {custom && <CustomDrawer o={custom === 'new' ? null : custom} onClose={() => setCustom(null)} onDone={() => { setCustom(null); reload(); }} />}
    </div>);
}

function Position({ d, pick }: { d: Desk; pick: (code: string) => void }) {
  const order: Applies[] = ['applies', 'may_apply', 'not_applicable'];
  return (
    <div className="cpgrid">{[...d.regulations].sort((a, b) => order.indexOf(a.applies) - order.indexOf(b.applies)).map((r) => (
      <div key={r.code} className={`card cpcard ${r.applies}`}>
        <div className="row" style={{ gap: 8, alignItems: 'start' }}><div className="grow"><span className="muted small">{r.jurisdiction}</span><div style={{ fontWeight: 600 }}>{r.name}</div></div><span className={`chip ${APPLIES[r.applies][0]}`}>{APPLIES[r.applies][1]}</span></div>
        <div className="small" style={{ margin: '6px 0' }}>{r.reason}</div>
        <div className="muted small" style={{ marginBottom: 8 }}>{r.summary}</div>
        <div className="row small" style={{ gap: 10, flexWrap: 'wrap' }}>
          {r.applies !== 'not_applicable' && <button className="linkbtn" onClick={() => pick(r.code)}><b>{r.counts.done}</b>/{r.counts.total} done in {d.year}{r.counts.overdue ? <span className="bad-t"> · {r.counts.overdue} overdue</span> : ''} →</button>}
          <span className="grow" /><a href={r.source} target="_blank" rel="noreferrer" className="muted">{r.authority}</a>
        </div>
      </div>))}</div>);
}

function Obligations({ d, filter, clear, open, onCustom }: { d: Desk; filter: string | null; clear: () => void; open: (o: Obligation) => void; onCustom: () => void }) {
  const [st, setSt] = useState<'all' | 'open' | 'overdue' | 'done'>('all');
  const rows = d.obligations.filter((o) => (!filter || o.reg === filter) && (st === 'all' || (st === 'open' ? o.status === 'not_started' || o.status === 'in_progress' : o.status === st)));
  const reg = (code: string) => d.regulations.find((r) => r.code === code);
  return (
    <div className="card flush">
      <div className="row vfilters" style={{ flexWrap: 'wrap' }}>
        <div className="seg">{(['all', 'open', 'overdue', 'done'] as const).map((k) => <button key={k} className={st === k ? 'on' : ''} onClick={() => setSt(k)}>{k === 'all' ? 'All' : k[0]!.toUpperCase() + k.slice(1)}</button>)}</div>
        {filter && <span className="chip info">{reg(filter)?.name ?? 'Own obligations'} <button className="linkbtn" aria-label="Clear filter" onClick={clear}>✕</button></span>}
        <span className="grow" />{d.canEdit && <button className="btn sm p" onClick={onCustom}>+ Own obligation</button>}
      </div>
      {!rows.length ? <div className="empty" style={{ padding: 18 }}>Nothing here.</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Due</th><th>Obligation</th><th>Regulation</th><th>Period</th><th className="ctr">Status</th><th>Owner</th><th>In the tool</th></tr></thead>
          <tbody>{rows.map((o) => (
            <tr key={`${o.reg}|${o.obligation}|${o.period}`} className="click" style={{ cursor: 'pointer' }} onClick={() => open(o)}>
              <td className="nowrap">{o.due ? <>{d8(o.due)}{o.moved && <span className="muted small"> · moved</span>}{o.status !== 'done' && o.status !== 'not_applicable' && o.due >= d.today && daysTo(o.due, d.today) <= 30 && <div className="warn-t small">in {daysTo(o.due, d.today)} days</div>}</> : <span className="muted small">{o.dueNote ?? 'not set'}</span>}</td>
              <td style={{ minWidth: 260 }}><b>{o.title}</b>{o.applies === 'may_apply' && <span className="chip info" style={{ marginLeft: 6 }}>may apply</span>}<div className="muted small">{o.autoNote ?? o.note ?? ''}</div></td>
              <td className="small">{o.custom ? <>{o.custom.regulation || 'Own obligation'}{o.custom.jurisdiction ? ` · ${o.custom.jurisdiction}` : ''}</> : reg(o.reg)?.name}</td>
              <td className="small nowrap">{o.label}</td>
              <td className="ctr"><span className={`chip ${STATUS[o.status][0]}`} title={o.source === 'module' ? 'Read from the module' : o.updatedName ? `Set by ${o.updatedName}` : undefined}>{STATUS[o.status][1]}{o.source === 'module' ? ' ·auto' : ''}</span></td>
              <td className="small">{o.owner ?? '—'}</td>
              <td className="small" onClick={(e) => e.stopPropagation()}>{o.module ? <Link to={o.module.route}>{o.module.label} →</Link> : '—'}</td></tr>))}</tbody>
        </table></div>)}
    </div>);
}

function Calendar({ d, open }: { d: Desk; open: (o: Obligation) => void }) {
  const byMonth = MON.map((_, i) => d.obligations.filter((o) => o.due && Number(o.due.slice(0, 4)) === d.year && Number(o.due.slice(5, 7)) === i + 1));
  const undated = d.obligations.filter((o) => !o.due);
  const carried = d.obligations.filter((o) => o.due && Number(o.due.slice(0, 4)) < d.year);
  return (
    <>
      {carried.length > 0 && <div className="note bad small" style={{ marginBottom: 10 }}>Still open from {d.year - 1}: {carried.map((o) => `${o.title} (${d8(o.due)})`).join(' · ')}</div>}
      <div className="cpcal">{MON.map((m, i) => (
        <div key={m} className={`card cpmonth ${d.today.slice(0, 7) === `${d.year}-${String(i + 1).padStart(2, '0')}` ? 'now' : ''}`}>
          <b className="small">{m}</b>
          {!byMonth[i]!.length ? <div className="muted small">—</div> : byMonth[i]!.map((o) => (
            <button key={`${o.reg}|${o.obligation}|${o.period}`} className="cpitem" onClick={() => open(o)}>
              <span className={`dot ${o.status}`} /><span className="grow"><span className="small"><b>{Number(o.due!.slice(8))}</b> {o.title}</span><span className="muted small" style={{ display: 'block' }}>{d.regulations.find((r) => r.code === o.reg)?.jurisdiction ?? o.custom?.jurisdiction ?? ''} · {o.label}</span></span>
            </button>))}
        </div>))}</div>
      {undated.length > 0 && <div className="card" style={{ marginTop: 12 }}><b className="small">No date set yet</b>{undated.map((o) => <div key={`${o.reg}|${o.obligation}|${o.period}`} className="small" style={{ marginTop: 4 }}><button className="linkbtn" onClick={() => open(o)}>{o.title}</button> <span className="muted">— {o.dueNote}</span></div>)}</div>}
    </>);
}

function StatusDrawer({ d, o, onClose, onDone, onEditCustom }: { d: Desk; o: Obligation; onClose: () => void; onDone: () => void; onEditCustom: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const set0 = o.source === 'set';
  const [f, setF] = useState({ status: set0 && o.setStatus && (o.setStatus !== 'not_started' || o.source === 'module') ? o.setStatus : '', owner: o.owner ?? '', note: o.note, documentId: o.documentId ?? '', doneOn: o.doneOn ?? '', dueOverride: o.moved ? o.due ?? '' : '' });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const R = d.regulations.find((r) => r.code === o.reg);
  const ok = (f.status !== 'done' || f.doneOn) && (f.status !== 'not_applicable' || f.note.trim()) && (!f.dueOverride || f.note.trim());
  const save = async (clear = false) => {
    try {
      await cpApi.status(clear ? { reg: o.reg, obligation: o.obligation, period: o.period, status: null, owner: null, note: '', documentId: null, doneOn: null, dueOverride: null }
        : { reg: o.reg, obligation: o.obligation, period: o.period, status: (f.status || null) as Exclude<Status, 'overdue'> | null, owner: f.owner.trim() || null, note: f.note.trim(), documentId: f.documentId || null, doneOn: f.doneOn || null, dueOverride: f.dueOverride || null });
      toast('Saved'); onDone();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{R?.name ?? o.custom?.regulation ?? 'Own obligation'} · {o.label}</div><h2>{o.title}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="note info small">{o.detail}{o.due ? ` Due ${d8(o.due)}.` : ''}{o.dueNote ? ` ${o.dueNote}.` : ''}{o.penalty ? ` Penalty: ${o.penalty}.` : ''}</div>
      {o.source === 'module' && <div className="note small">Status read from the module: <b>{STATUS[o.status][1]}</b>{o.autoNote ? ` — ${o.autoNote}` : ''}. Setting a status here takes over from it.</div>}
      {o.module && <div className="small" style={{ margin: '6px 0' }}><Link to={o.module.route}>Open {o.module.label} →</Link></div>}
      <fieldset className="vform plain" disabled={!d.canEdit}>
        <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => up({ status: e.target.value })}>
          <option value="">{o.source === 'module' ? 'As the module says' : 'Not started'}</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="not_applicable">Not applicable</option>{o.autoNote != null || o.source === 'module' ? <option value="not_started">Not started</option> : null}</select></label>
        <label className="field"><span>Owner</span><input className="input" value={f.owner} onChange={(e) => up({ owner: e.target.value })} /></label>
        {f.status === 'done' && <label className="field"><span>Completed on</span><input type="date" className="input" value={f.doneOn} onChange={(e) => up({ doneOn: e.target.value })} /></label>}
        <label className="field"><span>Date moved to (extension)</span><input type="date" className="input" value={f.dueOverride} onChange={(e) => up({ dueOverride: e.target.value })} /></label>
        <label className="field span2"><span>Note{f.status === 'not_applicable' ? ' — why it does not apply' : f.dueOverride ? ' — why the date moved' : ''}</span><textarea className="input" rows={3} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
        <label className="field span2"><span>Evidence (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </fieldset>
      <div className="row">{o.custom && d.canEdit && <button className="btn" onClick={onEditCustom}>Edit obligation</button>}{o.source === 'set' && d.canEdit && <button className="btn" onClick={() => save(true)}>Clear</button>}<span className="grow" />
        <button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>{d.canEdit && <button className="btn p" disabled={!ok} onClick={() => save()}>Save</button>}</div>
    </div></dialog>);
}

function CustomDrawer({ o, onClose, onDone }: { o: Obligation | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const c = o?.custom;
  const [f, setF] = useState({ title: o?.title ?? '', regulation: c?.regulation ?? '', jurisdiction: c?.jurisdiction ?? '', dueDate: c?.firstDue ?? '', recurrence: c?.recurrence ?? 'annual', owner: c?.owner ?? '', detail: o?.detail ?? '' });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const body = (): CustomBody => ({ title: f.title.trim(), regulation: f.regulation.trim(), jurisdiction: f.jurisdiction.trim(), dueDate: f.dueDate, recurrence: f.recurrence as 'once' | 'annual', owner: f.owner.trim() || null, detail: f.detail.trim() });
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Own obligation</div><h2>{o ? o.title : 'Add an obligation'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="note info small">Permits and licences, local regulations, lender or investor covenants, voluntary commitments (SBTi, CDP)…</div>
      <div className="vform">
        <label className="field span2"><span>Obligation</span><input className="input" value={f.title} placeholder="e.g. Renew the environmental permit" onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="field"><span>Regulation / source</span><input className="input" value={f.regulation} onChange={(e) => up({ regulation: e.target.value })} /></label>
        <label className="field"><span>Jurisdiction</span><input className="input" value={f.jurisdiction} onChange={(e) => up({ jurisdiction: e.target.value })} /></label>
        <label className="field"><span>Due</span><input type="date" className="input" value={f.dueDate} onChange={(e) => up({ dueDate: e.target.value })} /></label>
        <label className="field"><span>Repeats</span><select className="input" value={f.recurrence} onChange={(e) => up({ recurrence: e.target.value as 'once' | 'annual' })}><option value="annual">Every year on that day</option><option value="once">Once</option></select></label>
        <label className="field"><span>Owner</span><input className="input" value={f.owner} onChange={(e) => up({ owner: e.target.value })} /></label>
        <label className="field span2"><span>What it requires</span><textarea className="input" rows={3} value={f.detail} onChange={(e) => up({ detail: e.target.value })} /></label>
      </div>
      <div className="row">{c && <button className="btn" onClick={() => go(() => cpApi.deleteCustom(c.id))}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
        <button className="btn p" disabled={f.title.trim().length < 2 || !f.dueDate} onClick={() => go(() => (c ? cpApi.saveCustom(c.id, body()) : cpApi.addCustom(body())))}>Save</button></div>
    </div></dialog>);
}

function ProfileDrawer({ d, onClose, onDone }: { d: Desk; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const S = d.stored, F = d.facts;
  const [p, setP] = useState<Profile>({ ...d.profile, countries: (S.countries ?? []) as string[] });
  const [n, setN] = useState({ employees: S.employees ?? '', turnoverEur: S.turnoverEur ?? '', euTurnoverEur: S.euTurnoverEur ?? '', euSubsidiaryTurnoverEur: S.euSubsidiaryTurnoverEur ?? '', cbamImportTonnes: S.cbamImportTonnes ?? '', uaeScope12: S.uaeScope12 ?? '', usRevenueUsd: S.usRevenueUsd ?? '', countries: (S.countries ?? []).join(', ') } as Record<string, string | number>);
  const up = (x: Partial<Profile>) => setP((v) => ({ ...v, ...x }));
  const num = (k: string) => { const v = String(n[k] ?? '').replace(/,/g, '').trim(); return v === '' ? null : Number(v); };
  const okN = ['employees', 'turnoverEur', 'euTurnoverEur', 'euSubsidiaryTurnoverEur', 'cbamImportTonnes', 'uaeScope12', 'usRevenueUsd'].every((k) => num(k) == null || Number.isFinite(num(k)!));
  const tri = (v: boolean | null) => (v == null ? '' : v ? 'yes' : 'no');
  const fromTri = (v: string) => (v === '' ? null : v === 'yes');
  const hint = (k: keyof Profile) => (F.sources?.[k] ? <span className="muted small"> · from {F.sources[k]}{F[k] != null ? `: ${typeof F[k] === 'number' ? Math.round(F[k] as number).toLocaleString('en-US') : Array.isArray(F[k]) ? (F[k] as string[]).join(', ') : String(F[k])}` : ''}</span> : null);
  const save = async () => {
    const body: Profile = { ...p, employees: num('employees'), turnoverEur: num('turnoverEur'), euTurnoverEur: num('euTurnoverEur'), euSubsidiaryTurnoverEur: num('euSubsidiaryTurnoverEur'), cbamImportTonnes: num('cbamImportTonnes'),
      uaeScope12: num('uaeScope12'), usRevenueUsd: num('usRevenueUsd'), countries: String(n.countries).split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)) };
    try { await cpApi.profile(body); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); }
  };
  const t = (k: string, label: string, ph = '') => <label className="field"><span>{label}</span><input className="input num" value={n[k] ?? ''} placeholder={ph} onChange={(e) => setN({ ...n, [k]: e.target.value })} /></label>;
  const chk = (k: keyof Profile, label: string) => <label className="row small chkline" style={{ gap: 6 }}><input type="checkbox" checked={!!p[k]} onChange={(e) => up({ [k]: e.target.checked } as Partial<Profile>)} />{label}</label>;
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Compliance desk</div><h2>Company profile</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="note info small">These facts decide which regulations apply. Empty fields use what the modules already know (shown after each field). Not legal advice: confirm with counsel.</div>
      <fieldset className="vform plain" disabled={!d.canSetup}>
        <label className="field"><span>Financial year ends in</span><select className="input" value={p.fyEndMonth} onChange={(e) => up({ fyEndMonth: Number(e.target.value) })}>{MON.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label className="field"><span>Other countries of operation (ISO codes; EU for any member state){hint('countries')}</span><input className="input" value={n.countries} placeholder="e.g. EU, GB, US" onChange={(e) => setN({ ...n, countries: e.target.value })} /></label>
        <h3 className="span2" style={{ margin: '8px 0 0' }}>Size and listing</h3>
        {t('employees', 'Employees (group)')}{t('turnoverEur', 'Net turnover, EUR (group)')}
        <label className="field"><span>Listed on</span><select className="input" value={p.listed} onChange={(e) => up({ listed: e.target.value as Profile['listed'] })}><option value="none">Not listed</option><option value="india">NSE / BSE (India)</option><option value="sgx">SGX (Singapore)</option><option value="asx">ASX (Australia)</option><option value="lse">London Stock Exchange</option><option value="eu">EU regulated market</option><option value="other">Other exchange</option></select></label>
        <label className="field"><span>India: rank by market capitalisation</span><select className="input" value={p.indiaTop} onChange={(e) => up({ indiaTop: e.target.value as Profile['indiaTop'] })}><option value="none">Not listed in India</option><option value="top150">Top 150</option><option value="top250">Top 250</option><option value="top500">Top 500</option><option value="top1000">Top 1,000</option><option value="listed_other">Listed, below the top 1,000</option></select></label>
        <div className="field span2"><span>Singapore</span><div className="row" style={{ gap: 18 }}>{chk('sgxSti', 'STI constituent on 30 June 2025')}{chk('sgxCapOver1bn', 'Market cap S$1 billion or more on 30 June 2025')}</div></div>
        <h3 className="span2" style={{ margin: '8px 0 0' }}>European Union</h3>
        <div className="field span2">{chk('euEntity', 'The reporting company is established in the EU')}</div>
        {t('euTurnoverEur', 'EU net turnover, EUR (non-EU groups)')}{t('euSubsidiaryTurnoverEur', 'Largest EU subsidiary or branch turnover, EUR')}
        <label className="field"><span>CBAM goods imported into the EU, tonnes a year{hint('cbamImportTonnes')}</span><input className="input num" value={n.cbamImportTonnes ?? ''} onChange={(e) => setN({ ...n, cbamImportTonnes: e.target.value })} /></label>
        <label className="field"><span>Sells CBAM goods to EU buyers{hint('cbamExporter')}</span><select className="input" value={tri(p.cbamExporter)} onChange={(e) => up({ cbamExporter: fromTri(e.target.value) })}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        <h3 className="span2" style={{ margin: '8px 0 0' }}>India and UAE</h3>
        <label className="field"><span>Obligated entities under India CCTS{hint('cctsObligated')}</span><select className="input" value={tri(p.cctsObligated)} onChange={(e) => up({ cctsObligated: fromTri(e.target.value) })}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        <label className="field"><span>UAE: designated as a source{hint('uaeDesignated')}</span><select className="input" value={p.uaeDesignated} onChange={(e) => up({ uaeDesignated: e.target.value as Profile['uaeDesignated'] })}><option value="unknown">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        {t('uaeScope12', 'UAE Scope 1 + 2, tCO₂e a year')}
        <label className="field"><span>Abu Dhabi facility at or above 25,000 t in a covered sector{hint('eadFacility')}</span><select className="input" value={tri(p.eadFacility)} onChange={(e) => up({ eadFacility: fromTri(e.target.value) })}><option value="">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        <h3 className="span2" style={{ margin: '8px 0 0' }}>United States, Australia, United Kingdom</h3>
        {t('usRevenueUsd', 'Revenue, USD (US-based entity)')}<div className="field">{chk('californiaBusiness', 'Does business in California')}</div>
        <label className="field"><span>Australia: AASB S2 group</span><select className="input" value={p.auGroup} onChange={(e) => up({ auGroup: e.target.value as Profile['auGroup'] })}><option value="none">Not an Australian reporting entity</option><option value="group1">Group 1 (from 1 Jan 2025)</option><option value="group2">Group 2 (from 1 Jul 2026)</option><option value="group3">Group 3 (from 1 Jul 2027)</option></select></label>
        <div className="field">{chk('ukQuoted', 'UK quoted company')}{chk('ukLarge', 'Large UK unquoted company or LLP')}</div>
      </fieldset>
      <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>{d.canSetup && <button className="btn p" disabled={!okN} onClick={save}>Save</button>}</div>
    </div></dialog>);
}
