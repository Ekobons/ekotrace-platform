/**
 * Metric registry (Setup) — the data dictionary, separate from the emission factors (RFP 3.2.1):
 * what is collected (a unique ID and an approved definition), in which reporting unit and with which
 * conversions, who owns it, which facilities report it, from which source system and how, how often and
 * by when, the check limit, whether evidence is required, and its scope and category. Every change is a
 * new version with its reason; an admin's change waits for a super admin's approval.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, ROLE_LABEL, type Metric, type MetricChange, type MetricData, type MetricList, type MetricVersion } from '../lib/api';
import { Icon } from '../components/Icon';

const FREQ: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Yearly' };
const METHOD: Record<string, string> = { form: 'Form', upload: 'File upload', bill: 'Bill / meter', api: 'API (system)', qr: 'QR field app', survey: 'Survey' };
const LABEL: Record<string, string> = {
  name: 'Name', definition: 'Definition', category_code: 'Category', item_ids: 'Items', unit: 'Reporting unit', owner_user_id: 'Owner', facility_types: 'Facility types',
  facility_ids: 'Facilities', required: 'Required', level: 'Collected', source_system: 'Source system', methods: 'Collection methods', frequency: 'Frequency', due_day: 'Due day', due_months: 'Due after',
  check_pct: 'Check limit', evidence: 'Evidence', active: 'Active',
};
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const toData = (m: Metric): MetricData => ({
  name: m.name, definition: m.definition, category_code: m.category_code, item_ids: m.item_ids, unit: m.unit, owner_user_id: m.owner_user_id, facility_types: m.facility_types,
  facility_ids: m.facility_ids, required: m.required, level: m.level, source_system: m.source_system, methods: m.methods, frequency: m.frequency, due_day: m.due_day, due_months: m.due_months,
  check_pct: m.check_pct, evidence: m.evidence, active: m.active,
});
export const dueText = (m: Pick<MetricData, 'frequency' | 'due_day' | 'due_months'>, dueDay: number) =>
  `${ord(m.due_day ?? dueDay)} of the ${m.due_months === 1 ? 'next month' : `${ord(m.due_months)} month after`}`;

/** A value of a field, in words (for the details and the change lists). */
function show(L: MetricList, k: string, v: unknown): string {
  if (v == null || (Array.isArray(v) && !v.length)) return k === 'facility_types' || k === 'facility_ids' ? 'All' : k === 'item_ids' ? 'Whole category' : k === 'due_day' ? `Company default (${L.settings.dueDay})` : k === 'check_pct' ? `Company default (±${L.settings.checkPct}%)` : k === 'unit' ? 'Company currency' : k === 'owner_user_id' ? 'Facility preparers' : k === 'source_system' ? 'Not set' : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (k === 'level') return v === 'company' ? 'Once for the whole company' : 'Per facility';
  if (k === 'owner_user_id') return L.users.find((u) => u.id === v)?.name ?? 'Someone who left';
  if (k === 'category_code') return L.categories.find((c) => c.code === v)?.name ?? String(v);
  if (k === 'item_ids') { const items = L.categories.flatMap((c) => c.items); return (v as number[]).map((i) => items.find((x) => x.id === i)?.name ?? `#${i}`).join(', '); }
  if (k === 'facility_ids') return (v as string[]).map((i) => L.facilities.find((f) => f.id === i)?.name ?? '—').join(', ');
  if (k === 'methods') return (v as string[]).map((x) => METHOD[x] ?? x).join(', ');
  if (k === 'frequency') return FREQ[String(v)] ?? String(v);
  if (k === 'check_pct') return `±${v}%`;
  if (k === 'due_months') return `${v} month${v === 1 ? '' : 's'}`;
  if (k === 'unit') return L.units.find((u) => u.code === v)?.name ?? String(v);
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

export function MetricRegistry() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const [L, setL] = useState<MetricList | null>(null);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('');
  const [retired, setRetired] = useState(false);
  const tab = sp.get('tab') === 'changes' ? 'changes' : 'metrics';
  const openId = sp.get('metric');
  const [editing, setEditing] = useState<Metric | 'new' | null>(null);
  useEffect(() => { api.metrics().then(setL).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const rows = useMemo(() => (L?.metrics ?? []).filter((m) => (retired || m.active) && (!scope || String(m.scope) === scope)
    && (!q || `${m.code} ${m.name} ${m.definition} ${m.category} ${m.owner_name ?? ''} ${m.source_system ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [L, q, scope, retired]);
  if (!L) return <div className="page"><div className="card empty">Loading…</div></div>;
  const act = L.metrics.filter((m) => m.active), pending = L.changes.filter((c) => c.status === 'pending');
  const open = L.metrics.find((m) => m.id === openId) ?? null;
  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Setup</span><h1>Metric registry</h1>
          <div className="muted">The data dictionary: what is collected, in which unit, by whom, how often and with what proof. It is separate from the emission factors and drives the Collection calendar, reminders, checks on entry and the evidence rule. Every change is kept as a version; an admin's change waits for a super admin.</div></div>
        <span className="grow" />
        {L.canEdit && <button className="btn p" onClick={() => setEditing('new')}>+ New metric</button>}
      </div>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Active metrics</span><b>{act.length}</b><span className="muted small">{L.metrics.length - act.length} retired</span></div>
        <div className="card kpi"><span className="muted small">With a named owner</span><b>{act.filter((m) => m.owner_user_id).length}/{act.length}</b><span className="muted small">others: the facility's data preparers</span></div>
        <div className="card kpi"><span className="muted small">Required at every facility they apply to</span><b>{act.filter((m) => m.required).length}</b><span className="muted small">{act.filter((m) => m.evidence === 'required').length} need evidence before submission</span></div>
        <button type="button" className={`card kpi vk${tab === 'changes' ? ' on' : ''}`} onClick={() => set('tab', 'changes')}><span className="muted small">Changes waiting for approval</span>
          <b style={{ color: pending.length ? 'var(--warn)' : undefined }}>{pending.length}</b><span className="muted small">{L.canApprove ? 'yours to approve or reject' : 'a super admin approves'}</span></button>
      </div>
      <div className="seg strong" role="tablist">
        <button role="tab" aria-selected={tab === 'metrics'} className={tab === 'metrics' ? 'on' : ''} onClick={() => set('tab', null)}>Metrics</button>
        <button role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'on' : ''} onClick={() => set('tab', 'changes')}>Changes{pending.length ? ` (${pending.length})` : ''}</button>
      </div>
      {tab === 'metrics' ? (
        <div className="card flush">
          <div className="row vfilters">
            <select className="input" aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">All scopes</option><option value="1">Scope 1</option><option value="2">Scope 2</option><option value="3">Scope 3</option></select>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} /> Show retired</label>
            <label className="vsearch grow"><span aria-hidden="true">⌕</span><input placeholder="Search ID, name, definition, owner, source…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
            <span className="muted small">{rows.length} metric{rows.length === 1 ? '' : 's'}</span>
          </div>
          <div className="scroll"><table className="t mtable">
            <thead><tr><th>ID</th><th>Metric</th><th>Scope · category</th><th>Unit</th><th>Frequency · due</th><th>Owner</th><th>Applies to</th><th>Evidence</th><th className="num">Check</th><th className="ctr">Version</th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id} className={`click${m.active ? '' : ' dim'}${openId === m.id ? ' sel' : ''}`} onClick={() => set('metric', m.id)}>
                <td className="mono nowrap"><b>{m.code}</b></td>
                <td style={{ minWidth: 240 }}><b>{m.name}</b>{m.pending > 0 && <> <span className="chip warn">change waiting</span></>}{!m.active && <> <span className="chip grey">Retired</span></>}
                  <div className="muted small clamp2">{m.definition}</div></td>
                <td className="small"><span className="chip grey">S{m.scope}</span> {m.category}{m.item_ids.length > 0 && <div className="muted">{m.item_ids.length} item{m.item_ids.length > 1 ? 's' : ''}</div>}</td>
                <td className="small nowrap">{m.unit ?? <span className="muted">currency</span>}</td>
                <td className="small">{FREQ[m.frequency]}<div className="muted">{dueText(m, L.settings.dueDay)}</div></td>
                <td className="small">{m.owner_name ?? <span className="muted">Facility preparers</span>}</td>
                <td className="small">{m.level === 'company' ? 'Whole company, once' : m.facility_ids.length ? `${m.facility_ids.length} facilit${m.facility_ids.length > 1 ? 'ies' : 'y'}` : m.facility_types.length ? m.facility_types.join(', ') : 'All facilities'}
                  <div className="muted">{m.required ? 'Required' : 'Where reported'}</div></td>
                <td>{m.evidence === 'required' ? <span className="chip warn">Required</span> : <span className="chip grey">Optional</span>}</td>
                <td className="num small">±{m.check_pct ?? L.settings.checkPct}%</td>
                <td className="num small">v{m.version}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={10} className="muted">No metrics match.</td></tr>}</tbody>
          </table></div>
        </div>
      ) : <Changes L={L} onChanged={reload} />}
      {open && !editing && <MetricDrawer L={L} m={open} onClose={() => set('metric', null)} onEdit={() => setEditing(open)} />}
      {editing && <EditDrawer L={L} m={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); reload(); if (id) set('metric', id); }} />}
    </div>);
}

function useDialog(onClose: () => void) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  return { ref: dlg, onClose, close: () => dlg.current?.close() };
}

function MetricDrawer({ L, m, onClose, onEdit }: { L: MetricList; m: Metric; onClose: () => void; onEdit: () => void }) {
  const d = useDialog(onClose);
  const [h, setH] = useState<MetricVersion[] | null>(null);
  useEffect(() => { api.metricHistory(m.id).then((r) => setH(r.versions)).catch(() => setH([])); }, [m.id, m.version]);
  const conv = m.unit_dim ? L.units.filter((u) => u.dimension === m.unit_dim && u.code !== m.unit) : [];
  const base = L.units.find((u) => u.code === m.unit);
  const facs = L.facilities.filter((f) => (m.facility_ids.length ? m.facility_ids.includes(f.id) : !m.facility_types.length || (f.type && m.facility_types.includes(f.type))));
  const rows: [string, string][] = [
    ['Definition', m.definition || '—'], ['Scope · category', `Scope ${m.scope} · ${m.category}`], ['Items', show(L, 'item_ids', m.item_ids)],
    ['Reporting unit', show(L, 'unit', m.unit)], ['Owner', m.owner_name ?? 'The facility\'s data preparers (else its manager)'],
    ['Collected', show(L, 'level', m.level)],
    ['Applies to', m.level === 'company' ? 'The whole company (one submission, from a central system)' : `${show(L, m.facility_ids.length ? 'facility_ids' : 'facility_types', m.facility_ids.length ? m.facility_ids : m.facility_types)} · ${facs.length} facilit${facs.length === 1 ? 'y' : 'ies'} today`],
    ['Owed', m.level === 'company' ? (m.required ? 'Every period (required)' : 'When the company reports it (data this year or last)') : m.required ? 'By every facility it applies to (required)' : 'By facilities that report it (data this year or last)'],
    ['Source system', m.source_system || '—'], ['Collection methods', show(L, 'methods', m.methods)],
    ['Frequency · due', `${FREQ[m.frequency]} · due on the ${dueText(m, L.settings.dueDay)}`], ['Check on entry', `Flagged when more than ${show(L, 'check_pct', m.check_pct)} off the 6-month average`],
    ['Evidence', m.evidence === 'required' ? 'Required: a bill, meter reading, source file or linked document before it can be submitted or approved' : 'Optional'],
  ];
  return (
    <dialog ref={d.ref} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">{m.code} · version {m.version}{m.active ? '' : ' · retired'}</div><h2>{m.name}</h2></div>
          {L.canEdit && <button className="btn" onClick={onEdit}><Icon name="edit" /> {L.canApprove ? 'Change' : 'Propose a change'}</button>}
          <button className="btn ghost" onClick={d.close} aria-label="Close"><Icon name="x" /></button></div>
        {m.pending > 0 && <div className="note warn small">A change to this metric is waiting for a super admin. See Changes.</div>}
        <dl className="mdl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {base && conv.length > 0 && (
          <section><h3 className="h3">Conversion rules</h3>
            <p className="muted small">Entries in any of these units are converted to {base.name} for this metric (on the calendar and in totals). Units of another kind (for example kilograms for a fuel measured in litres) are converted with the fuel's density or calorific value when the emissions are calculated.</p>
            <div className="convs">{conv.map((u) => <span key={u.code} className="chip grey">1 {u.code} = {num(u.to_base / base.to_base)} {base.code}</span>)}</div>
          </section>)}
        <section><h3 className="h3">Version history</h3>
          {!h ? <div className="muted small">Loading…</div> : (
            <ol className="vhist">{h.map((v) => (
              <li key={v.version}><div className="row"><b>Version {v.version}</b><span className="muted small">{d8(v.at)} · changed by {v.changed_by ?? '—'}{v.approved_by && v.approved_by !== v.changed_by ? ` · approved by ${v.approved_by}` : ''}</span></div>
                <div className="small">{v.reason}</div>
                {v.version > 1 && v.changes && <ul className="small diffl">{Object.entries(v.changes).map(([k, [a, b]]) => <li key={k}><span className="muted">{LABEL[k] ?? k}:</span> <s>{show(L, k, a)}</s> → <b>{show(L, k, b)}</b></li>)}</ul>}
              </li>))}</ol>)}
        </section>
      </div>
    </dialog>);
}

const EMPTY: MetricData = { name: '', definition: '', category_code: 'stationary_combustion', item_ids: [], unit: null, owner_user_id: null, facility_types: [], facility_ids: [], required: false,
  level: 'facility', source_system: null, methods: ['form'], frequency: 'monthly', due_day: null, due_months: 1, check_pct: null, evidence: 'optional', active: true };

function EditDrawer({ L, m, onClose, onSaved }: { L: MetricList; m: Metric | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const { toast } = useApp();
  const d = useDialog(onClose);
  const [f, setF] = useState<MetricData>(m ? toData(m) : EMPTY);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (x: Partial<MetricData>) => setF((o) => ({ ...o, ...x }));
  const cat = L.categories.find((c) => c.code === f.category_code);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const dims = [...new Set(L.units.map((u) => u.dimension))];
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.metricSave({ ...f, id: m?.id, reason, source_system: f.source_system || null });
      toast(r.pending ? 'Sent to the super admin for approval' : m ? `Saved as version ${r.version}` : `Created ${r.code}`);
      onSaved(r.pending ? undefined : r.id);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={d.ref} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">{m ? `${m.code} · version ${m.version}` : 'New metric'}</div><h2>{m ? (L.canApprove ? 'Change metric' : 'Propose a change') : 'New metric'}</h2></div>
          <button className="btn ghost" onClick={d.close} aria-label="Close"><Icon name="x" /></button></div>
        {!L.canApprove && <div className="note small">Your change goes to a super admin, who approves or rejects it. Until then the current version stays in use.</div>}
        <div className="vform">
          <label className="field span2"><span>Name</span><input className="input" value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
          <label className="field span2"><span>Approved definition</span><textarea className="input" rows={3} value={f.definition} onChange={(e) => up({ definition: e.target.value })} /></label>
          <label className="field"><span>Category</span><select className="input" value={f.category_code} onChange={(e) => up({ category_code: e.target.value, item_ids: [] })}>
            {L.categories.map((c) => <option key={c.code} value={c.code}>Scope {c.scope} · {c.name}</option>)}</select></label>
          <label className="field"><span>Reporting unit</span><select className="input" value={f.unit ?? ''} onChange={(e) => up({ unit: e.target.value || null })}>
            <option value="">Money (company currency)</option>{dims.map((dm) => <optgroup key={dm} label={dm.replace(/_/g, ' ')}>{L.units.filter((u) => u.dimension === dm).map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}</optgroup>)}</select></label>
          {cat && cat.items.length > 0 && (
            <details className="field span2"><summary>Items: {f.item_ids.length ? `${f.item_ids.length} chosen` : 'the whole category (items no other metric lists)'}</summary>
              <div className="chkgrid">{cat.items.map((i) => <label key={i.id} className="small"><input type="checkbox" checked={f.item_ids.includes(i.id)} onChange={() => up({ item_ids: toggle(f.item_ids, i.id) })} /> {i.name} <span className="muted">· {i.sub}</span></label>)}</div>
            </details>)}
          <label className="field"><span>Owner</span><select className="input" value={f.owner_user_id ?? ''} onChange={(e) => up({ owner_user_id: e.target.value || null })}>
            <option value="">The facility's data preparers</option>{L.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {ROLE_LABEL[u.role]}</option>)}</select></label>
          <label className="field"><span>Source system</span><input className="input" value={f.source_system ?? ''} placeholder="e.g. SAP MM, fuel cards, DEWA bills" onChange={(e) => up({ source_system: e.target.value })} /></label>
          <div className="field span2"><span>Collection methods</span><div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{L.methods.map((x) => <label key={x} className="small"><input type="checkbox" checked={f.methods.includes(x)} onChange={() => up({ methods: toggle(f.methods, x) })} /> {METHOD[x] ?? x}</label>)}</div></div>
          <div className="field span2"><span>Collected</span><div className="row" style={{ gap: 14 }}>
            <label className="small"><input type="radio" checked={f.level === 'facility'} onChange={() => up({ level: 'facility' })} /> Per facility</label>
            <label className="small"><input type="radio" checked={f.level === 'company'} onChange={() => up({ level: 'company', facility_ids: [], facility_types: [] })} /> Once for the whole company (finance system, travel agency, survey)</label></div></div>
          {f.level === 'facility' && <><div className="field span2"><span>Applies to facility types (none ticked: all)</span><div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {L.facilityTypes.map((t) => <label key={t} className="small"><input type="checkbox" checked={f.facility_types.includes(t)} disabled={f.facility_ids.length > 0} onChange={() => up({ facility_types: toggle(f.facility_types, t) })} /> {t}</label>)}
            {!L.facilityTypes.length && <span className="muted small">No facility types set yet (Organisation & groups).</span>}</div></div>
          <details className="field span2"><summary>Or only these facilities: {f.facility_ids.length ? `${f.facility_ids.length} chosen` : 'none chosen'}</summary>
            <div className="chkgrid">{L.facilities.map((x) => <label key={x.id} className="small"><input type="checkbox" checked={f.facility_ids.includes(x.id)} onChange={() => up({ facility_ids: toggle(f.facility_ids, x.id) })} /> {x.name} <span className="muted">· {x.type ?? 'no type'}</span></label>)}</div></details></>}
          <label className="span2 row small chkline"><input type="checkbox" checked={f.required} onChange={(e) => up({ required: e.target.checked })} /><b>{f.level === 'company' ? 'Required: owed every period (otherwise only when the company reports it)' : 'Required: every facility it applies to must report it (otherwise only facilities that report it are expected to)'}</b></label>
          <label className="field"><span>Frequency</span><select className="input" value={f.frequency} onChange={(e) => up({ frequency: e.target.value as MetricData['frequency'] })}>{Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <div className="field"><span>Due</span><div className="row" style={{ gap: 6 }}>
            <select className="input" aria-label="Due day" value={f.due_day ?? ''} onChange={(e) => up({ due_day: e.target.value ? Number(e.target.value) : null })}><option value="">Day {L.settings.dueDay} (company)</option>{Array.from({ length: 28 }, (_, i) => <option key={i + 1} value={i + 1}>Day {i + 1}</option>)}</select>
            <select className="input" aria-label="Months after the period" value={f.due_months} onChange={(e) => up({ due_months: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n === 1 ? 'of the next month' : `${n} months after`}</option>)}</select></div></div>
          <label className="field"><span>Check limit on entry (± % vs 6-month average)</span><input className="input num" inputMode="numeric" placeholder={`Company: ${L.settings.checkPct}`} value={f.check_pct ?? ''} onChange={(e) => up({ check_pct: e.target.value ? Math.max(1, Math.min(500, Number(e.target.value) || 0)) : null })} /></label>
          <label className="field"><span>Evidence</span><select className="input" value={f.evidence} onChange={(e) => up({ evidence: e.target.value as MetricData['evidence'] })}><option value="optional">Optional</option><option value="required">Required before submission and approval</option></select></label>
          {m && <label className="span2 row small chkline"><input type="checkbox" checked={!f.active} onChange={(e) => up({ active: !e.target.checked })} /><b>Retire this metric (kept with its history; no longer on the calendar)</b></label>}
          <label className="field span2"><span>Reason for the change (kept in the version history)</span><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Plants must report fuel monthly with delivery notes (audit finding 2026-03)" /></label>
        </div>
        <div className="row"><span className="grow" /><button className="btn" onClick={d.close}>Cancel</button>
          <button className="btn p" disabled={busy || f.name.trim().length < 2 || reason.trim().length < 3} onClick={save}>{L.canApprove ? (m ? 'Save new version' : 'Create metric') : 'Send for approval'}</button></div>
      </div>
    </dialog>);
}

function Changes({ L, onChanged }: { L: MetricList; onChanged: () => void }) {
  const { toast } = useApp();
  const [note, setNote] = useState<Record<string, string>>({});
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); onChanged(); } catch (e) { toast((e as Error).message); } };
  if (!L.changes.length) return <div className="card empty">No changes proposed yet. Admins' changes appear here for a super admin to approve or reject.</div>;
  const ST: Record<MetricChange['status'], [string, string]> = { pending: ['warn', 'Waiting'], approved: ['', 'Approved'], rejected: ['bad', 'Rejected'], withdrawn: ['grey', 'Withdrawn'] };
  return (
    <div className="mchanges">{L.changes.map((c) => (
      <div key={c.id} className="card">
        <div className="row"><span className={`chip ${ST[c.status][0]}`}>{ST[c.status][1]}</span><b>{c.code ? `${c.code} · ${c.name}` : `New metric · ${c.name}`}</b><span className="grow" />
          <span className="muted small">proposed by {c.proposed_name} · {d8(c.proposed_at)}{c.decided_at && c.status !== 'pending' ? ` · ${c.status} by ${c.decided_name} · ${d8(c.decided_at)}` : ''}</span></div>
        <div className="small" style={{ margin: '6px 0' }}>{c.reason}</div>
        <table className="t small"><thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead>
          <tbody>{Object.entries(c.changes).map(([k, [a, b]]) => <tr key={k}><td>{LABEL[k] ?? k}</td><td className="muted">{c.metric_id ? show(L, k, a) : '—'}</td><td><b>{show(L, k, b)}</b></td></tr>)}</tbody></table>
        {c.decision_note && <div className="small muted" style={{ marginTop: 6 }}>Note: {c.decision_note}</div>}
        {c.status === 'pending' && (
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {L.canApprove && !c.mine && <>
              <input className="input grow" placeholder="Note (needed to reject)" value={note[c.id] ?? ''} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} />
              <button className="btn" onClick={() => act(() => api.metricDecide(c.id, 'reject', note[c.id]), 'Rejected')}>Reject</button>
              <button className="btn p" onClick={() => act(() => api.metricDecide(c.id, 'approve', note[c.id] || undefined), 'Approved — new version in use')}>Approve</button></>}
            {c.mine && <button className="btn" onClick={() => act(() => api.metricWithdraw(c.id), 'Withdrawn')}>Withdraw</button>}
          </div>)}
      </div>))}
    </div>);
}
