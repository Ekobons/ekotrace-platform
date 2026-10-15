/**
 * Suppliers (Value chain): everyone the company buys from — registered automatically from
 * uploads, the ERP API and manual entry (one record per supplier however its name is written),
 * or added here. Three tabs:
 *   Suppliers       the list, each supplier's profile, names seen, own emission factors
 *   Check names     possible duplicates (merge / keep apart) and names linked automatically (confirm / split)
 *   Analytics       spend and emissions by country, product group, sector, Scope 3 category, month; top suppliers
 */
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, tco2e, type Supplier, type SupplierAnalytics, type SupplierFactor2, type SupplierDoc, type SupplierEngagement, type SupplierImportResult, type SupplierProfile, type SupplierReview } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { SupplierRequests } from '../components/SupplierRequests';
import { SupplierEngagementTab } from '../components/SupplierEngagementTab';
import { Icon } from '../components/Icon';
import { countryName, t as tonnes, usdShort } from '../components/Charts';
import { Bars, DCard, Donut, DStat, HBars, Legend, MN, PAL as PAL2, Treemap, fmt0, fmtT, type BarRow } from '../components/DashCharts';

const MANAGE = ['super_admin', 'admin', 'manager'];
const UNITS = ['kg', 't', 'L', 'm3', 'kWh', 'pcs', 'AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR'];
const usd = (v: number) => `$${Math.round(v).toLocaleString('en')}`;
const TARGET_LABEL: Record<string, string> = { sbti_validated: 'SBTi target (validated)', sbti_committed: 'SBTi commitment', own: 'Own target', none: 'No target', unknown: 'Not known' };
const SCOPE3_LABEL: Record<string, string> = { purchased_goods: '3.1 Purchased goods & services', capital_goods: '3.2 Capital goods', upstream_transport: '3.4 Upstream transport', business_travel: '3.6 Business travel', upstream_leased: '3.8 Upstream leased assets' };
type Tab = 'list' | 'review' | 'analytics' | 'portal' | 'engagement';

export function Suppliers() {
  const { role } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'list';
  const setTab = (t: Tab, extra: Record<string, string> = {}) => setSp({ ...(t === 'list' ? {} : { tab: t }), ...extra });
  const [counts, setCounts] = useState<{ all: number; review: number; incomplete: number; autoLinked: number } | null>(null);
  const loadCounts = () => api.supplierCounts().then((r) => setCounts(r.counts)).catch(() => {});
  useEffect(() => { loadCounts(); }, []);
  const canManage = MANAGE.includes(role);
  const toCheck = (counts?.review ?? 0) + (counts?.autoLinked ?? 0);

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Value chain</div><h1>Suppliers</h1>
          <p className="sub">Everyone you buy from — registered from purchases (one record however the name is written) or added here by hand or from a list — and prospects you may buy from. Engage them on the supplier portal: their own figures replace spend-based estimates, and their targets shape your Scope 3 trajectory.</p></div>
      </div>
      <div className="tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Suppliers{counts ? ` (${counts.all.toLocaleString('en')})` : ''}</button>
        <button className={tab === 'engagement' ? 'on' : ''} onClick={() => setTab('engagement')}>Engagement</button>
        <button className={tab === 'portal' ? 'on' : ''} onClick={() => setTab('portal')}>Supplier portal</button>
        <button className={tab === 'analytics' ? 'on' : ''} onClick={() => setTab('analytics')}>Spend analytics</button>
        <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')}>Check names{toCheck ? <span className="chip warn" style={{ marginLeft: 6 }}>{toCheck}</span> : ''}</button>
      </div>
      {tab === 'list' && <SupplierList canManage={canManage} counts={counts} onChanged={loadCounts} />}
      {tab === 'review' && <ReviewTab canManage={canManage} onChanged={loadCounts} />}
      {tab === 'analytics' && <Analytics />}
      {tab === 'portal' && <SupplierRequests />}
      {tab === 'engagement' && <SupplierEngagementTab />}
    </div>
  );
}

// ------------------------------------------------------------------ list --
export const STAGE_LABEL: Record<string, string> = { not_engaged: 'Not engaged', invited: 'Invited', signed_in: 'Signed in', started: 'Survey started', submitted: 'Submitted', finished: 'Finished' };
const GRADE_C: Record<string, string> = { 'A+': '#0E7C66', A: '#2BA38A', B: '#7CC4A6', C: '#E9B44C', D: '#E39A5A', E: '#C2523C' };
export function Grade({ l, size = 30 }: { l?: string; size?: number }) {
  if (!l) return <span className="muted">—</span>;
  return <span className="grade" style={{ width: size, height: size, background: GRADE_C[l] ?? '#9AA7A2', fontSize: size * 0.42 }} title={`Climate score ${l}`}>{l}</span>;
}
const Yes = ({ v, t }: { v?: boolean; t: string }) => v ? <span className="yn y" title={t}>✓</span> : <span className="yn n" title={`No: ${t.toLowerCase()}`}>✕</span>;

function SupplierList({ canManage, counts, onChanged }: { canManage: boolean; counts: { all: number; review: number; incomplete: number } | null; onChanged: () => void }) {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const filter = sp.get('filter') ?? 'all';
  const country = sp.get('country') ?? '';
  const stage = sp.get('stage') ?? '';
  const dept = sp.get('dept') ?? '';
  const [hideProspects, setHideProspects] = useState(false);
  const [sort, setSort] = useState('co2e');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [meta, setMeta] = useState<{ stages: Partial<Record<string, number>>; departments: string[]; prospects: number }>({ stages: {}, departments: [], prospects: 0 });
  const [total, setTotal] = useState(0);
  const open = sp.get('open');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const load = () => api.suppliers({ q, code: code || undefined, filter, offset, limit: 50, sort, country: country || undefined, stage: stage || undefined, department: dept || undefined, kind: hideProspects ? 'current' : undefined })
    .then((r) => { setRows(r.suppliers); setTotal(r.total); setMeta({ stages: r.stages ?? {}, departments: r.departments ?? [], prospects: r.counts?.prospects ?? 0 }); });
  useEffect(() => { const t = window.setTimeout(load, q || code ? 250 : 0); return () => window.clearTimeout(t); }, [q, code, filter, offset, sort, country, stage, dept, hideProspects]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged(); };
  const FILTERS: [string, string, number | undefined][] = [['all', 'All', counts?.all], ['review', 'Possible duplicates', counts?.review], ['incomplete', 'Profile incomplete', counts?.incomplete], ['with_factor', 'With own factor', undefined], ['without_factor', 'Spend-based only', undefined]];
  const allStages = Object.values(meta.stages).reduce((a: number, n) => a + (n ?? 0), 0);

  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <span className="grow muted small">Suppliers come from purchases (uploads, ERP API, typed in) or are added here — one by one or from a list. Prospects are suppliers you do not buy from yet.</span>
        <a className="btn sm ghost" href={`/api/suppliers/export?year=${new Date().getFullYear() - 1}`}><Icon name="download" />Download list</a>
        {canManage && <button className="btn sm" onClick={() => setImporting(true)}><Icon name="upload" />Import a list</button>}
        {canManage && <button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" />Add supplier</button>}
        {canManage && <button className="btn sm p" onClick={() => setSp({ tab: 'portal', invite: '1' })}>Engage suppliers</button>}
      </div>
      {adding && <AddSupplierDrawer departments={meta.departments} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); changed(); if (id) setParam('open', id); }} />}
      {importing && <ImportDrawer onClose={() => setImporting(false)} onDone={() => { setImporting(false); changed(); }} />}
      <div className="seg stagebar" role="tablist" aria-label="Engagement">
        <button className={!stage ? 'on' : ''} onClick={() => { setParam('stage', null); setOffset(0); }}>All<span className="meta">{allStages || ''}</span></button>
        {Object.entries(STAGE_LABEL).map(([k, l]) => <button key={k} className={stage === k ? 'on' : ''} onClick={() => { setParam('stage', k); setOffset(0); }}>{l}<span className="meta">{meta.stages[k] ?? 0}</span></button>)}
      </div>
      <div className="card flush">
        <div className="sfilters">
          <label className="field"><span>Supplier name</span><input className="input sm" type="search" placeholder="Search a supplier…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></label>
          <label className="field"><span>Internal code</span><input className="input sm" type="search" placeholder="Vendor number…" value={code} onChange={(e) => { setCode(e.target.value); setOffset(0); }} /></label>
          <label className="field"><span>Procurement department</span><select className="input sm" value={dept} onChange={(e) => { setParam('dept', e.target.value || null); setOffset(0); }}><option value="">All</option>{meta.departments.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="field"><span>Sort by</span><select className="input sm" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }} aria-label="Sort by">
            <option value="co2e">↓ CO₂ emitted</option><option value="spend">↓ Spend</option><option value="lines">↓ Purchase lines</option><option value="name">Name A–Z</option></select></label>
          <label className="row small chkline sp-hide"><input type="checkbox" checked={hideProspects} onChange={(e) => { setHideProspects(e.target.checked); setOffset(0); }} />Hide prospects{meta.prospects ? ` (${meta.prospects})` : ''}</label>
        </div>
        <div className="row" style={{ padding: '0 12px 10px', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, l, n]) => <button key={k} className={`chipbtn ${filter === k ? 'on' : ''}`} onClick={() => { setParam('filter', k === 'all' ? null : k); setOffset(0); }}>{l}{n !== undefined && <span className="meta">{n.toLocaleString('en')}</span>}</button>)}
          {country && <button className="chipbtn on" onClick={() => setParam('country', null)} title="Remove the country filter">{country === 'none' ? 'Country not known' : countryName(country)} <Icon name="x" /></button>}
        </div>
        {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">{filter === 'all' && !q && !country && !stage ? 'No suppliers yet: add them here, import a list, or they appear with the first purchase upload.' : 'No supplier matches.'}</div> : (
          <div className="scrollx"><table className="t suptable">
            <thead><tr><th>Supplier</th><th>Internal code</th><th className="c">Score</th><th className="c">GHG report</th><th className="c">SBTi</th><th>Completion</th><th>Type</th><th>Department</th><th className="num">tCO₂e</th><th>Factor</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={`click ${open === s.id ? 'sel' : ''}`} onClick={() => setParam('open', open === s.id ? null : s.id)}>
                <td style={{ minWidth: 200 }}><b>{s.name}</b>{s.review === 'possible_duplicate' && <span className="chip warn" style={{ marginLeft: 6 }} title={`${Math.round((s.duplicate_score ?? 0) * 100)}% alike`}>same as {s.duplicate_of_name}?</span>}
                  <div className="muted small">{[s.country && countryName(s.country), STAGE_LABEL[s.stage ?? 'not_engaged'], s.sbtiList ? `SBTi list: ${s.sbtiList.status}` : null].filter(Boolean).join(' · ')}</div></td>
                <td className="small mono">{s.reference ?? <span className="muted">—</span>}</td>
                <td className="c"><Grade l={s.letter} /></td>
                <td className="c"><Yes v={s.ghgReport} t="Measures and reports its emissions" /></td>
                <td className="c"><Yes v={s.sbti} t="Science-based target validated" /></td>
                <td>{s.completion != null ? <span className="pctpill" style={{ ['--p' as string]: `${s.completion}%` }}>{s.completion}%</span> : <span className="muted small">—</span>}</td>
                <td>{s.kind === 'prospect' ? <span className="chip info">Prospect</span> : <span className="chip grey">Current supplier</span>}</td>
                <td className="small">{s.department ?? <span className="muted">—</span>}</td>
                <td className="num">{tco2e(s.co2e)}</td>
                <td>{s.factors ? <span className="chip">own factor</span> : <span className="chip grey">spend-based</span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {total > 50 && <div className="row" style={{ padding: 8, justifyContent: 'flex-end' }}><span className="muted small">{offset + 1}–{Math.min(total, offset + 50)} of {total.toLocaleString('en')}</span>
          <button className="btn sm" disabled={!offset} onClick={() => setOffset(offset - 50)} aria-label="Previous page">‹</button><button className="btn sm" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)} aria-label="Next page">›</button></div>}
        {total > 0 && total <= 50 && <div className="muted small" style={{ padding: '8px 12px' }}>Showing {total} of {total}</div>}
      </div>
      {open && <SupplierPanel key={open} id={open} canManage={canManage} onChanged={changed} onClose={() => setParam('open', null)} onOpen={(id) => setParam('open', id)} />}
    </>
  );
}

function Completeness({ v }: { v: number }) {
  return <span className="complete" title={`Profile ${Math.round(v * 100)}% complete (country, vendor number, industry, contact, reports emissions, climate target)`}><span className="cov"><div style={{ width: `${Math.round(v * 100)}%` }} /></span>{Math.round(v * 100)}%</span>;
}

const CDP_SCORES = ['A', 'A-', 'B', 'B-', 'C', 'C-', 'D', 'D-', 'F'];
function AddSupplierDrawer({ departments, onClose, onDone }: { departments: string[]; onClose: () => void; onDone: (id?: string) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ name: '', kind: 'current', reference: '', country: '', department: '', industry: '', size: '', website: '', contactName: '', contactEmail: '', reportsEmissions: 'unknown', climateTarget: 'unknown',
    cdpScore: '', reductionPct: '', targetYear: '', netZeroYear: '', note: '', invite: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<{ code: string; email: string } | null>(null);
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const txt = (k: keyof typeof f, l: string, p = '', cls = 'field') => <label className={cls}><span>{l}</span><input className="input" placeholder={p} value={String(f[k])} onChange={(e) => up({ [k]: e.target.value })} /></label>;
  const go = async () => {
    setBusy(true); setErr(null);
    const o = (v: string) => v.trim() || undefined;
    const target = f.reductionPct || f.netZeroYear ? { reductionPct: f.reductionPct ? Number(f.reductionPct) : null, targetYear: f.targetYear ? Number(f.targetYear) : null, netZeroYear: f.netZeroYear ? Number(f.netZeroYear) : null, source: 'Entered by hand' } : undefined;
    try {
      const r = await api.addSupplier({ name: f.name.trim(), kind: f.kind, reference: o(f.reference), country: o(f.country), department: o(f.department), industry: o(f.industry), size: f.size || undefined, website: o(f.website),
        contactName: o(f.contactName), contactEmail: o(f.contactEmail), reportsEmissions: f.reportsEmissions, climateTarget: f.climateTarget, cdpScore: f.cdpScore || undefined, target, note: o(f.note) });
      if (f.invite && f.contactEmail.trim()) {
        const inv = await api.supplierInvite({ supplierId: r.id, year: new Date().getFullYear() - 1, email: f.contactEmail.trim(), contactName: f.contactName.trim(), message: '', dueDate: null, months: 6, sendEmail: true });
        setCode({ code: inv.code, email: f.contactEmail.trim() });
        toast('Supplier added and invited'); return;
      }
      toast('Supplier added'); onDone(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={() => (code ? onDone() : onClose())}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Suppliers</div><h2>Add a supplier</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {code ? <>
          <div className="note ok">Added and invited to the supplier portal for {new Date().getFullYear() - 1}.</div>
          <div className="sp-code mono">{code.code.replace(/(.{5})/, '$1 ')}</div>
          <div className="note warn small">The access code is shown only now. The invitation with it was queued to {code.email} (sent once a mail server is set up). Sign-in page: {location.origin}/supplier</div>
          <div className="row"><span className="grow" /><button className="btn p" onClick={() => dlg.current?.close()}>Done</button></div>
        </> : <>
          <div className="vform">
            {txt('name', 'Name *', 'Legal or trading name', 'field span2')}
            <div className="field span2"><span>Type</span><div className="sp-choice">
              {([['current', 'Current supplier', 'You buy from them'], ['prospect', 'Prospect', 'You may buy from them — compare before choosing']] as const).map(([k, l, sub]) =>
                <label key={k} className={f.kind === k ? 'on' : ''}><input type="radio" name="kind" checked={f.kind === k} onChange={() => up({ kind: k })} /><span><b>{l}</b><small>{sub}</small></span></label>)}</div></div>
            {txt('reference', 'Internal code / vendor number', 'as in the ERP — links future purchases')}{txt('country', 'Country', 'AE, India, Germany…')}
            <label className="field"><span>Procurement department</span><input className="input" list="sup-depts" value={f.department} onChange={(e) => up({ department: e.target.value })} placeholder="e.g. Fleet, Facilities, IT" />
              <datalist id="sup-depts">{departments.map((d) => <option key={d} value={d} />)}</datalist></label>
            {txt('industry', 'Industry / what they supply')}
            <label className="field"><span>Size</span><select className="input" value={f.size} onChange={(e) => up({ size: e.target.value })}><option value="">—</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            {txt('website', 'Website', 'https://')}
            {txt('contactName', 'Sustainability contact')}{txt('contactEmail', 'Contact e-mail')}
            <label className="field"><span>Reports its emissions</span><select className="input" value={f.reportsEmissions} onChange={(e) => up({ reportsEmissions: e.target.value })}><option value="unknown">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field"><span>CDP climate score</span><select className="input" value={f.cdpScore} onChange={(e) => up({ cdpScore: e.target.value })}><option value="">Not known</option>{CDP_SCORES.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="field"><span>Climate target</span><select className="input" value={f.climateTarget} onChange={(e) => up({ climateTarget: e.target.value })}>{Object.entries(TARGET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <div className="field"><span>Target, if known</span><div className="row" style={{ gap: 6 }}>
              <input className="input num" placeholder="−%" aria-label="Reduction %" value={f.reductionPct} onChange={(e) => up({ reductionPct: e.target.value })} />
              <input className="input num" placeholder="by year" aria-label="Target year" value={f.targetYear} onChange={(e) => up({ targetYear: e.target.value })} />
              <input className="input num" placeholder="net zero" aria-label="Net-zero year" value={f.netZeroYear} onChange={(e) => up({ netZeroYear: e.target.value })} /></div></div>
            {txt('note', 'Note', '', 'field span2')}
            <label className="span2 row small chkline" style={{ gap: 8 }}><input type="checkbox" checked={f.invite} disabled={!/\S+@\S+\.\S+/.test(f.contactEmail)} onChange={(e) => up({ invite: e.target.checked })} />
              <b>Invite the contact to the supplier portal now</b> <span className="muted">(for {new Date().getFullYear() - 1}; needs the contact e-mail)</span></label>
          </div>
          <div className="sub">The name and internal code are checked against existing suppliers and every spelling seen in purchases, so the same supplier is not added twice. Purchases later uploaded under this name or code link to it.</div>
          {err && <div className="note bad">{err}</div>}
          <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={busy || !f.name.trim()} onClick={() => void go()}>{f.invite ? 'Add and invite' : 'Add supplier'}</button></div>
        </>}
      </div>
    </dialog>);
}

function ImportDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<SupplierImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (commit: boolean, f = file) => {
    if (!f) return;
    setBusy(true); setErr(null);
    try { const r = await api.importSuppliers(f, commit); setRes(r); if (commit) { toast(`${r.created} suppliers added, ${r.updated} completed`); onDone(); } } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const template = () => {
    const csv = 'Supplier name,Internal code,Type,Country,Procurement department,Industry,Contact name,Contact email,Website,CDP score\nExample Supplier LLC,V-10001,current,AE,Facilities,Cleaning services,Jane Doe,jane@example.com,https://example.com,\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'supplier-list-template.csv'; a.click();
  };
  const ACT: Record<string, [string, string]> = { new: ['', 'New'], update: ['info', 'Completes'], same: ['grey', 'Already there'], error: ['bad', 'Error'] };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Suppliers</div><h2>Import a supplier list</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <p className="sub" style={{ margin: 0 }}>An Excel or CSV export of your vendor master or a list you keep. Columns are recognised by their names: supplier name (required), internal code / vendor number, type (current / prospect), country, procurement department, industry, contact name and e-mail, website, CDP score. Existing suppliers are found by name, known spellings or code; only their empty fields are filled.</p>
        <div className="sp-drop">
          <label className="btn">{file ? file.name : 'Choose a file…'}<input type="file" hidden accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setRes(null); if (f) void run(false, f); }} /></label>
          <button className="btn ghost sm" onClick={template}><Icon name="download" />Template</button>
        </div>
        {err && <div className="note bad">{err}</div>}
        {res && <>
          <div className="small"><b>Columns used:</b> {Object.entries(res.columns).map(([k, v]) => `${k} ← “${v}”`).join(' · ')}</div>
          <div className="row" style={{ gap: 8 }}>{(['new', 'update', 'same', 'error'] as const).map((k) => <span key={k} className={`chip ${ACT[k]![0]}`}>{ACT[k]![1]}: {res.totals[k]}</span>)}</div>
          <div className="scroll" style={{ maxHeight: 340 }}><table className="t small"><thead><tr><th className="num">Row</th><th>Supplier</th><th>What happens</th><th>Detail</th></tr></thead>
            <tbody>{res.rows.map((r) => <tr key={r.row}><td className="num">{r.row}</td><td><b>{r.name}</b></td><td><span className={`chip ${ACT[r.action]![0]}`}>{ACT[r.action]![1]}</span></td><td className={r.action === 'error' ? '' : 'muted'} style={r.action === 'error' ? { color: 'var(--bad)' } : undefined}>{r.detail}</td></tr>)}</tbody></table></div>
        </>}
        <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button className="btn p" disabled={busy || !res || res.committed || !(res.totals.new + res.totals.update)} onClick={() => void run(true)}>{busy ? 'Working…' : res ? `Add ${res.totals.new} · complete ${res.totals.update}` : 'Import'}</button></div>
      </div>
    </dialog>);
}

const METHOD_LABEL: Record<string, string> = { new: 'first seen', exact: 'same name', alias: 'known spelling', reference: 'same vendor number', similar: 'near-identical name', merged: 'merged', manual: 'added by hand' };
type ProfileForm = { name: string; country: string; reference: string; trn: string; website: string; industry: string; size: string; contactName: string; contactEmail: string; reportsEmissions: string; climateTarget: string; note: string;
  kind: string; department: string; cdpScore: string; cdpYear: string; reductionPct: string; baseYear: string; targetYear: string; netZeroYear: string };
const formOf = (s: SupplierProfile): ProfileForm => ({ name: s.name, country: s.country ?? '', reference: s.reference ?? '', trn: s.trn ?? '', website: s.website ?? '', industry: s.industry ?? '', size: s.size ?? '',
  contactName: s.contact_name ?? '', contactEmail: s.contact_email ?? '', reportsEmissions: s.reports_emissions ?? 'unknown', climateTarget: s.climate_target ?? 'unknown', note: s.note ?? '',
  kind: s.kind ?? 'current', department: s.department ?? '', cdpScore: s.cdp_score ?? '', cdpYear: s.cdp_year ? String(s.cdp_year) : '',
  reductionPct: s.target?.reductionPct != null ? String(s.target.reductionPct) : '', baseYear: s.target?.baseYear ? String(s.target.baseYear) : '', targetYear: s.target?.targetYear ? String(s.target.targetYear) : '', netZeroYear: s.target?.netZeroYear ? String(s.target.netZeroYear) : '' });

function SupplierPanel({ id, canManage, onChanged, onClose, onOpen }: { id: string; canManage: boolean; onChanged: () => void; onClose: () => void; onOpen: (id: string) => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.supplier>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [nf, setNf] = useState<{ itemId: number | null; itemName: string | null; co2e: string; unit: string; priceYear: string; source: string; boundary: string; validFrom: string; validTo: string } | null>(null);
  const [merge, setMerge] = useState('');
  const [cands, setCands] = useState<Supplier[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const load = () => api.supplier(id).then((r) => { setD(r); setForm(formOf(r.supplier)); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadedId = d?.supplier.id;
  useEffect(() => { if (loadedId) box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [loadedId]);
  useEffect(() => { if (merge.length < 2) { setCands([]); return; } const t = window.setTimeout(() => api.suppliers({ q: merge, limit: 8 }).then((r) => setCands(r.suppliers.filter((s) => s.id !== id))), 250); return () => window.clearTimeout(t); }, [merge, id]);
  if (!d || !form) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const s = d.supplier;
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(s));
  const money = nf && /^[A-Z]{3}$/.test(nf.unit);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); load(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  const saveProfile = () => act(() => api.patchSupplier(id, {
    name: form.name.trim(), country: form.country || null, reference: form.reference.trim() || null, trn: form.trn.trim() || null, website: form.website.trim() || null, industry: form.industry.trim() || null,
    size: form.size || null, contactName: form.contactName.trim() || null, contactEmail: form.contactEmail.trim() || null, reportsEmissions: form.reportsEmissions, climateTarget: form.climateTarget, note: form.note.trim() || null,
    kind: form.kind, department: form.department.trim() || null, cdpScore: form.cdpScore || null, cdpYear: form.cdpYear ? Number(form.cdpYear) : null,
    target: form.reductionPct || form.netZeroYear || form.targetYear ? { reductionPct: form.reductionPct ? Number(form.reductionPct) : null, baseYear: form.baseYear ? Number(form.baseYear) : null,
      targetYear: form.targetYear ? Number(form.targetYear) : null, netZeroYear: form.netZeroYear ? Number(form.netZeroYear) : null, source: s.target?.source ?? 'Entered by hand' } : null,
  }), 'Profile saved');
  const saveEf = async () => {
    if (!nf) return;
    try {
      const r = await api.addSupplierEf(id, { itemId: nf.itemId, co2e: Number(nf.co2e), unit: nf.unit, priceYear: money && nf.priceYear ? Number(nf.priceYear) : null, source: nf.source, boundary: nf.boundary || undefined,
        validFrom: nf.validFrom || undefined, validTo: nf.validTo || undefined });
      toast(`Factor saved · ${r.linesRecalculated.toLocaleString('en')} open lines recalculated`); setNf(null); load(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  const F = (k: keyof ProfileForm, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field"><span>{label}</span><input className="input" value={form[k]} disabled={!canManage} onChange={(e) => setForm({ ...form, [k]: k === 'country' ? e.target.value.toUpperCase() : e.target.value })} {...extra} /></label>);
  const monthly = d.months.filter((m) => m.month.startsWith(d.months.at(-1)?.month.slice(0, 4) ?? '')).map((m) => ({ m: Number(m.month.slice(5, 7)), co2e: m.co2e }));

  return (
    <div className="card" ref={box} style={{ display: 'grid', gap: 14, scrollMarginTop: 12 }}>
      <div className="row"><div className="grow"><div className="eyebrow">Supplier</div><h2>{s.name}</h2>
        <div className="sub">{[s.reference && `vendor ${s.reference}`, s.country && countryName(s.country), `from ${s.origin}`].filter(Boolean).join(' · ')}</div></div>
        <Completeness v={s.completeness ?? 0} />
        <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      {err && <div className="note bad">{err}</div>}
      <ScoreCard e={d.engagement} supplierId={id} canManage={canManage} />
      {s.review === 'possible_duplicate' && d.duplicateOf && (
        <div className="note warn row" style={{ gap: 8 }}>
          <span className="grow">Possibly the same supplier as <a href="#" onClick={(e) => { e.preventDefault(); onOpen(d.duplicateOf!.id); }}>{d.duplicateOf.name}</a> ({Math.round((s.duplicate_score ?? 0) * 100)}% alike).</span>
          {canManage && <><button className="btn sm p" onClick={() => act(() => api.mergeSupplier(id, d.duplicateOf!.id), `Merged into ${d.duplicateOf!.name}`).then(() => onOpen(d.duplicateOf!.id))}>Same supplier: merge</button>
            <button className="btn sm" onClick={() => act(() => api.keepSupplierSeparate(id), 'Kept as a separate supplier')}>Different supplier</button></>}
        </div>
      )}
      <div className="cols2">
        <fieldset className="box"><legend>Profile</legend>
          <div className="grid2">
            {F('name', 'Name')}{F('reference', 'Vendor number (ERP)')}
            {F('country', 'Country (2 letters, e.g. AE)', { maxLength: 2 })}{F('trn', 'Tax registration number (TRN)')}
            {F('industry', 'Industry / what they supply')}
            <label className="field"><span>Size</span><select className="input" value={form.size} disabled={!canManage} onChange={(e) => setForm({ ...form, size: e.target.value })}><option value="">—</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            {F('contactName', 'Sustainability contact')}{F('contactEmail', 'Contact e-mail', { type: 'email' })}
            {F('website', 'Website')}
            <label className="field"><span>Reports its emissions</span><select className="input" value={form.reportsEmissions} disabled={!canManage} onChange={(e) => setForm({ ...form, reportsEmissions: e.target.value })}><option value="unknown">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field"><span>Climate target</span><select className="input" value={form.climateTarget} disabled={!canManage} onChange={(e) => setForm({ ...form, climateTarget: e.target.value })}>{Object.entries(TARGET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Type</span><select className="input" value={form.kind} disabled={!canManage} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="current">Current supplier</option><option value="prospect">Prospect</option></select></label>
            {F('department', 'Procurement department')}
            <label className="field"><span>CDP climate score</span><select className="input" value={form.cdpScore} disabled={!canManage} onChange={(e) => setForm({ ...form, cdpScore: e.target.value })}><option value="">Not known</option>{CDP_SCORES.map((c) => <option key={c}>{c}</option>)}</select></label>
            {F('cdpYear', 'CDP year', { inputMode: 'numeric' })}
            <div className="field" style={{ gridColumn: '1 / -1' }}><span>Declared reduction target{s.target?.source ? ` · ${s.target.source}` : ''}</span><div className="row" style={{ gap: 6 }}>
              {([['reductionPct', '−%'], ['baseYear', 'from year'], ['targetYear', 'by year'], ['netZeroYear', 'net zero']] as const).map(([k, p]) =>
                <input key={k} className="input num" placeholder={p} aria-label={p} disabled={!canManage} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />)}</div></div>
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Note</span><textarea className="input" rows={2} value={form.note} disabled={!canManage} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          {canManage && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn sm" disabled={!dirty} onClick={() => setForm(formOf(s))}>Undo</button><button className="btn sm p" disabled={!dirty || !form.name.trim()} onClick={saveProfile}>Save profile</button></div>}
        </fieldset>
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div><h3>Emissions by month{monthly.length ? ` (${d.months.at(-1)!.month.slice(0, 4)})` : ''}</h3>
            {monthly.length ? <Bars rows={MN.map((lbl, i) => { const x = monthly.find((m) => m.m === i + 1); return { lbl, parts: x ? [{ v: (x.co2e ?? 0) / 1000, c: 'var(--s3)', n: 'tCO₂e' }] : [] }; })} h={120} /> : <div className="sub">No calculated purchases yet.</div>}</div>
          <div><h3>Default spend category</h3>
            <div className="sub">Used for this supplier's purchases that their description does not identify (e.g. “Monthly charges”). A clear description still wins.</div>
            {canManage ? <ItemPicker value={d.defaultItem?.id ?? null} valueName={d.defaultItem?.name ?? null} placeholder="none — description decides"
              onPick={(it) => act(() => api.patchSupplier(id, { defaultItemId: it?.id ?? null }), it ? `Default: ${it.name}` : 'Default removed')} /> : <div>{d.defaultItem?.name ?? <span className="muted">none</span>}</div>}
            {canManage && d.suggestedDefault && <div className="note info row" style={{ gap: 8, marginTop: 6 }}><span className="grow">{Math.round(d.suggestedDefault.share * 100)}% of what is bought from this supplier is <b>{d.suggestedDefault.name}</b>.</span>
              <button className="btn xs" onClick={() => act(() => api.patchSupplier(id, { defaultItemId: d.suggestedDefault!.id }), `Default: ${d.suggestedDefault!.name}`)}>Use as default</button></div>}
          </div>
          <div><h3>What is bought</h3>
            {d.categories.length ? <table className="t compact"><thead><tr><th>Spend category</th><th className="num">Lines</th><th className="num">USD</th><th className="num">tCO₂e</th></tr></thead>
              <tbody>{d.categories.map((c, i) => <tr key={i}><td>{c.item ?? <span className="muted">no category yet</span>}</td><td className="num">{c.lines}</td><td className="num">{usd(c.usd ?? 0)}</td><td className="num">{tco2e(c.co2e ?? 0)}</td></tr>)}</tbody></table> : <div className="sub">No purchases yet.</div>}</div>
        </div>
      </div>
      <div className="cols2">
        <div><h3>Names seen in purchases</h3>
          <div className="sub">How each spelling in the files was linked to this supplier. A wrong link can be split off as its own supplier.</div>
          <table className="t compact"><thead><tr><th>As written</th><th>Linked by</th><th className="num">Lines</th><th /></tr></thead>
            <tbody>{d.names.map((n) => (
              <tr key={n.id}><td>{n.name_seen}</td><td className="small">{METHOD_LABEL[n.method] ?? n.method}{n.method === 'similar' && n.score ? ` · ${Math.round(n.score * 100)}%` : ''}{n.method === 'similar' && (n.confirmed ? <span className="chip" style={{ marginLeft: 4 }}>checked</span> : <span className="chip warn" style={{ marginLeft: 4 }}>to check</span>)}</td>
                <td className="num">{n.lines.toLocaleString('en')}</td>
                <td>{canManage && n.method === 'similar' && !n.confirmed && <span className="row" style={{ gap: 4 }}>
                  <button className="btn xs" onClick={() => act(() => api.supplierMatch(n.id, 'confirm'), 'Link confirmed')}>Right</button>
                  <button className="btn xs" onClick={() => act(() => api.supplierMatch(n.id, 'split'), `“${n.name_seen}” is now its own supplier`)}>Wrong: split</button></span>}</td></tr>))}
              {!d.names.length && <tr><td colSpan={4} className="muted">No purchases yet.</td></tr>}</tbody></table>
          {canManage && <fieldset className="box" style={{ marginTop: 12 }}><legend>Same supplier under another record?</legend>
            <input className="input sm" placeholder="Search the other record…" value={merge} onChange={(e) => setMerge(e.target.value)} />
            {cands.map((c) => <div key={c.id} className="row" style={{ gap: 6, marginTop: 4 }}><span className="grow small">{c.name} · {c.lines} lines{c.reference ? ` · vendor ${c.reference}` : ''}</span>
              <button className="btn xs" onClick={() => act(async () => { const r = await api.mergeSupplier(c.id, id); setMerge(''); return r; }, `Merged into ${s.name}`)}>Merge into {s.name}</button></div>)}
          </fieldset>}
        </div>
        <SupplierDocs id={id} docs={d.documents} canManage={canManage} onChanged={load} />
        <div><h3>Own emission factors</h3>
          {d.factors.length ? <table className="t compact"><thead><tr><th>Applies to</th><th className="num">kg CO₂e</th><th>per</th><th>Valid</th><th>Source</th><th /></tr></thead>
            <tbody>{d.factors.map((f: SupplierFactor2) => (
              <tr key={f.id}><td>{f.item ?? 'everything bought'}</td><td className="num">{num(f.co2e, 5)}</td><td>{f.unit}{f.price_year ? ` (${f.price_year})` : ''}</td><td className="small">{f.valid_from.slice(0, 4)}–{f.valid_to.slice(0, 4)}</td><td className="small">{f.source}{f.boundary ? ` · ${f.boundary}` : ''}</td>
                <td>{canManage && <button className="btn ghost sm" aria-label="Remove" onClick={() => act(() => api.deleteSupplierEf(id, f.id), 'Factor removed')}><Icon name="x" /></button>}</td></tr>))}</tbody></table>
            : <div className="sub">None: purchases from this supplier are spend-based.</div>}
          {canManage && !nf && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setNf({ itemId: null, itemName: null, co2e: '', unit: 'kg', priceYear: '', source: '', boundary: 'cradle-to-gate', validFrom: '', validTo: '' })}><Icon name="plus" />Add a factor</button>}
          {nf && (
            <fieldset className="box" style={{ marginTop: 8 }}><legend>New factor</legend>
              <div className="cols2">
                <label className="field"><span>For</span><ItemPicker value={nf.itemId} valueName={nf.itemName ?? 'everything bought from this supplier'} onPick={(it) => setNf({ ...nf, itemId: it?.id ?? null, itemName: it?.name ?? null })} /></label>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <label className="field"><span>kg CO₂e</span><input className="input" type="number" min="0" step="any" value={nf.co2e} onChange={(e) => setNf({ ...nf, co2e: e.target.value })} style={{ width: 110 }} /></label>
                  <label className="field"><span>per</span><select className="input" value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
                  {money && <label className="field"><span>money of year</span><input className="input" type="number" value={nf.priceYear} placeholder="purchase year" onChange={(e) => setNf({ ...nf, priceYear: e.target.value })} style={{ width: 110 }} /></label>}
                </div>
                <label className="field"><span>Source (EPD number, report…)</span><input className="input" value={nf.source} onChange={(e) => setNf({ ...nf, source: e.target.value })} /></label>
                <label className="field"><span>Boundary</span><input className="input" value={nf.boundary} onChange={(e) => setNf({ ...nf, boundary: e.target.value })} /></label>
                <label className="field"><span>Valid from (optional)</span><input className="input" type="date" value={nf.validFrom} onChange={(e) => setNf({ ...nf, validFrom: e.target.value })} /></label>
                <label className="field"><span>Valid to (optional)</span><input className="input" type="date" value={nf.validTo} onChange={(e) => setNf({ ...nf, validTo: e.target.value })} /></label>
              </div>
              <div className="sub">Per kg, t, L, m³, kWh or piece: used when the purchase line has a quantity in that unit (else the spend is used). Per currency: kg CO₂e per unit of money spent with this supplier.</div>
              <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setNf(null)}>Cancel</button><button className="btn sm p" disabled={!nf.co2e || nf.source.trim().length < 2} onClick={saveEf}>Save factor</button></div>
            </fieldset>
          )}
        </div>
      </div>
    </div>
  );
}

function ScoreCard({ e, supplierId, canManage }: { e: SupplierEngagement; supplierId: string; canManage: boolean }) {
  const [, setSp] = useSearchParams();
  return (
    <div className="scorecard">
      <div className="sc-grade"><Grade l={e.letter} size={56} /><div><b>{e.score}</b><small>/ 100</small></div><span className="small muted">Climate score</span></div>
      <div className="sc-parts">{e.parts.map((p) => <div key={p.key}><span className="small"><b>{p.label}</b> <span className="muted">{p.note}</span></span>
        <span className="sc-bar"><i style={{ width: `${(p.points / p.max) * 100}%` }} /></span><span className="small num">{p.points}/{p.max}</span></div>)}</div>
      <div className="sc-side">
        <div className="small"><span className="muted">Engagement</span><br /><b>{STAGE_LABEL[e.stage]}</b>{e.request ? ` · ${e.request.year}` : ''}{e.completion != null ? ` · ${e.completion}% answered` : ''}</div>
        {e.sbtiList ? <div className="small"><span className="muted">SBTi list</span><br /><b>{e.sbtiList.status}</b>{e.sbtiList.classification ? ` · ${e.sbtiList.classification}` : ''}{e.sbtiList.netZeroYear ? ` · net zero ${e.sbtiList.netZeroYear}` : ''}<div className="muted">as “{e.sbtiList.name}”</div></div>
          : <div className="small muted">Not found in the SBTi list.</div>}
        {e.request ? <button className="btn sm" onClick={() => setSp({ tab: 'portal', request: e.request!.id })}>Open the request</button>
          : canManage && <button className="btn sm p" onClick={() => setSp({ tab: 'portal', invite: supplierId })}>Invite to the portal</button>}
      </div>
      {e.actions.length > 0 && <details className="sc-act small"><summary>How this supplier can improve ({e.actions.length})</summary><ul>{e.actions.map((a) => <li key={a}>{a}</li>)}</ul></details>}
    </div>);
}

const DOCKIND: Record<string, string> = { report: 'Sustainability / emissions report', verification: 'Verification statement', epd: 'EPD or product footprint', cdp: 'CDP response', contract: 'Contract or clause', other: 'Other' };
function SupplierDocs({ id, docs, canManage, onChanged }: { id: string; docs: SupplierDoc[]; canManage: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const [kind, setKind] = useState('report');
  const [busy, setBusy] = useState(false);
  const add = async (f?: File) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) return toast('The file is over 20 MB');
    setBusy(true);
    try { await api.uploadSupplierDoc(id, f, kind); toast(`${f.name} attached`); onChanged(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div style={{ gridColumn: '1 / -1' }}><h3>Documents</h3>
      <div className="sub">The supplier's sustainability report, verification statement, EPDs, CDP response or contract clauses — kept with its record. Files the supplier sent on the portal are listed too.</div>
      {docs.length ? <ul className="sp-docs" style={{ marginTop: 6 }}>{docs.map((x) => <li key={`${x.from}${x.id}`}>
        <span className="grow"><a href={`/api/supplier-portal/documents/${x.id}`} target="_blank" rel="noreferrer"><b>{x.filename}</b></a>
          <small>{DOCKIND[x.kind] ?? x.kind}{x.size ? ` · ${Math.max(1, Math.round(x.size / 1024))} KB` : ''} · {x.from === 'portal' ? `sent by the supplier on the portal${x.year ? ` (${x.year})` : ''}` : `added by ${x.by ?? '—'}${x.at ? `, ${new Date(x.at).toLocaleDateString('en-GB')}` : ''}`}</small></span>
        {canManage && x.from === 'staff' && <button className="btn sm ghost" onClick={async () => { try { await api.deleteSupplierDoc(id, x.id); onChanged(); } catch (e) { toast((e as Error).message); } }}>Remove</button>}</li>)}</ul>
        : <div className="muted small" style={{ marginTop: 6 }}>No documents yet.</div>}
      {canManage && <div className="sp-drop" style={{ marginTop: 8 }}>
        <label className="field"><span>What it is</span><select className="input sm" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(DOCKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className={`btn sm${busy ? ' dis' : ''}`}><Icon name="upload" />{busy ? 'Uploading…' : 'Upload a document'}<input type="file" hidden disabled={busy} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <span className="muted small">PDF, image, Excel or Word · up to 20 MB</span>
      </div>}
    </div>);
}

// ---------------------------------------------------------------- review --
function ReviewTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<SupplierReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.supplierReview().then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); try { await fn(); toast(msg); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  if (!d) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const open = (id: string) => nav(`/suppliers?open=${id}`);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {err && <div className="note bad">{err}</div>}
      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h3>Possible duplicates <span className="chip warn">{d.duplicates.length}</span></h3>
          <p className="sub">New names that look like an existing supplier but differ in a way that needs a person (a different vendor number, an extra word, a short name). Until decided they stay separate suppliers.</p></div>
        {!d.duplicates.length ? <div className="empty">Nothing to check.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>New name</th><th /><th>Existing supplier</th><th className="num">Alike</th><th /></tr></thead>
            <tbody>{d.duplicates.map((x) => (
              <tr key={x.id}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(x.id); }}><b>{x.name}</b></a><div className="muted small">{[x.reference && `vendor ${x.reference}`, x.country, `${x.lines.toLocaleString('en')} lines`].filter(Boolean).join(' · ')}</div></td>
                <td className="muted">≈</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(x.other_id); }}>{x.other_name}</a><div className="muted small">{[x.other_reference && `vendor ${x.other_reference}`, x.other_country, `${x.other_lines.toLocaleString('en')} lines`].filter(Boolean).join(' · ')}</div></td>
                <td className="num">{x.score ? `${Math.round(x.score * 100)}%` : ''}</td>
                <td>{canManage && <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn xs p" disabled={!!busy} onClick={() => act(x.id, () => api.mergeSupplier(x.id, x.other_id), `${x.name} merged into ${x.other_name}`)}>Same: merge</button>
                  <button className="btn xs" disabled={!!busy} onClick={() => act(x.id, () => api.keepSupplierSeparate(x.id), 'Kept apart')}>Different</button></span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h3>Linked automatically <span className="chip info">{d.autoLinked.length}</span></h3>
          <p className="sub">Names linked to an existing supplier because they differ only by a typo, spacing or a generic word. Their lines already count under that supplier; confirm, or split a wrong link off as its own supplier.</p></div>
        {!d.autoLinked.length ? <div className="empty">Nothing to check.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>As written</th><th /><th>Linked to</th><th className="num">Alike</th><th className="num">Lines</th><th /></tr></thead>
            <tbody>{d.autoLinked.map((x) => (
              <tr key={x.id}>
                <td>{x.name_seen}</td><td className="muted">→</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(x.supplier_id); }}>{x.supplier}</a>{x.similar_to && x.similar_to !== x.supplier && <div className="muted small">matched with “{x.similar_to}”</div>}</td>
                <td className="num">{x.score ? `${Math.round(x.score * 100)}%` : ''}</td><td className="num">{x.lines.toLocaleString('en')}</td>
                <td>{canManage && <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn xs" disabled={!!busy} onClick={() => act(`m${x.id}`, () => api.supplierMatch(x.id, 'confirm'), 'Confirmed')}>Right</button>
                  <button className="btn xs" disabled={!!busy} onClick={() => act(`m${x.id}`, () => api.supplierMatch(x.id, 'split'), `“${x.name_seen}” is now its own supplier`)}>Wrong: split</button></span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {canManage && d.autoLinked.length > 1 && <div className="row" style={{ padding: 10, justifyContent: 'flex-end' }}>
          <button className="btn sm" disabled={!!busy} onClick={() => act('all', async () => { for (const x of d.autoLinked) await api.supplierMatch(x.id, 'confirm'); }, `${d.autoLinked.length} links confirmed`)}>Confirm all {d.autoLinked.length}</button></div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- analytics --
function Analytics() {
  const nav = useNavigate();
  const [year, setYear] = useState<number | undefined>();
  const [d, setD] = useState<SupplierAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<'co2e' | 'usd'>('co2e');
  const [itemView, setItemView] = useState<'group' | 'item'>('group');
  useEffect(() => { setD(null); api.supplierAnalytics(year).then(setD).catch((e) => setErr(e.message)); }, [year]);
  const groups = useMemo(() => {
    if (!d) return [];
    const m = new Map<string, { usd: number; co2e: number; items: number }>();
    for (const r of d.byItem) { const g = m.get(r.group) ?? { usd: 0, co2e: 0, items: 0 }; g.usd += r.usd ?? 0; g.co2e += r.co2e ?? 0; g.items++; m.set(r.group, g); }
    return [...m.entries()].map(([group, v]) => ({ group, ...v }));
  }, [d]);
  if (!d) return <div className="card empty">{err ?? 'Loading…'}</div>;
  if (!d.totals.lines) return <div className="card empty"><h3>No calculated purchases{d.year ? ` in ${d.year}` : ''} yet</h3><p className="sub">Upload purchases (Add data → Purchased goods & services); analytics count lines that are calculated (ready or published).</p></div>;
  const val = (r: { usd: number | null; co2e: number | null }) => (metric === 'co2e' ? r.co2e ?? 0 : r.usd ?? 0);
  const fmt = metric === 'co2e' ? tonnes : usdShort;
  const unit = metric === 'co2e' ? 't' : '';
  const sorted = <T extends { usd: number | null; co2e: number | null }>(rows: T[]) => [...rows].sort((a, b) => val(b) - val(a));
  const p = d.profiles;
  const pctOf = (n: number) => (p.suppliers ? `${Math.round((n / p.suppliers) * 100)}%` : '—');
  const supplierShare = d.totals.co2e ? d.totals.co2e_supplier / d.totals.co2e : 0;

  const v = (x: { usd: number | null; co2e: number | null }) => (metric === 'co2e' ? (x.co2e ?? 0) / 1000 : x.usd ?? 0);   // tonnes or USD
  const u = metric === 'co2e' ? 't' : 'USD';
  const tot = metric === 'co2e' ? d.totals.co2e / 1000 : d.totals.usd;
  const top = [...d.top].sort((a, b) => v(b) - v(a));
  const cParts = sorted(d.byCountry).map((r, i) => ({ n: countryName(r.country), v: v(r), c: r.country ? PAL2[i % PAL2.length]! : '#9AA7A2' }));
  const s3 = sorted(d.byScope3).map((r, i) => ({ n: SCOPE3_LABEL[r.category] ?? r.category, v: v(r), c: PAL2[(i + 3) % PAL2.length]! }));
  const tParts = d.targets.map((r, i) => ({ n: TARGET_LABEL[r.target] ?? r.target, v: (r.co2e ?? 0) / 1000, c: r.target === 'unknown' ? '#C9D9D2' : r.target === 'none' ? '#C2523C' : PAL2[i % PAL2.length]! }));
  const q = [{ n: "Supplier's own factor", v: d.totals.co2e_supplier / 1000, c: 'var(--ok)' }, { n: 'Spend-based average', v: (d.totals.co2e - d.totals.co2e_supplier) / 1000, c: '#E9B44C' }];
  const mrows: BarRow[] = MN.map((lbl, i) => { const m = d.byMonth.find((x) => Number(x.month.slice(5, 7)) === i + 1);
    return { lbl, parts: !m ? [] : metric === 'co2e' ? [{ v: (m.co2e_supplier ?? 0) / 1000, c: 'var(--ok)', n: "Supplier's own factor" }, { v: ((m.co2e ?? 0) - (m.co2e_supplier ?? 0)) / 1000, c: '#E9B44C', n: 'Spend-based' }] : [{ v: m.usd ?? 0, c: 'var(--info)', n: 'Spend' }] }; });
  const fmtV = (x: number) => (metric === 'co2e' ? `${fmtT(x)} t` : usdShort(x));

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="dhead">
        <div><span className="muted">{d.totals.lines.toLocaleString('en')} calculated purchase lines in {d.year}{d.totals.no_supplier ? ` · ${d.totals.no_supplier.toLocaleString('en')} without a supplier` : ''}</span></div>
        <span style={{ flex: 1 }} />
        <select className="input" value={d.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{d.years.map((y) => <option key={y}>{y}</option>)}</select>
        <div className="seg" role="group" aria-label="Show"><button className={metric === 'co2e' ? 'on' : ''} onClick={() => setMetric('co2e')}>Emissions</button><button className={metric === 'usd' ? 'on' : ''} onClick={() => setMetric('usd')}>Spend (USD)</button></div>
      </div>
      <DStat cells={[
        ['Suppliers with purchases', d.totals.suppliers.toLocaleString('en'), `${p.suppliers.toLocaleString('en')} in the list`],
        ['Spend', usdShort(d.totals.usd), 'USD, at the exchange rates used'],
        ['Emissions', <>{fmt0(d.totals.co2e / 1000)} <small>tCO₂e</small></>, 'purchases, capital goods, moved lines'],
        ["Suppliers' own factors", `${Math.round(supplierShare * 100)}%`, 'of purchase emissions; the rest is spend-based', supplierShare ? 'var(--ok)' : undefined],
        ['Concentration', `${d.concentration.n80} of ${d.concentration.suppliers}`, `suppliers make 80% of emissions (${d.concentration.n50} make 50%)`],
      ]} />
      <div className="dgrid">
        <DCard title="By supplier country" sub="click a country to list its suppliers">
          <div className="dsplit"><Donut parts={cParts} center={String(d.byCountry.filter((r) => r.country).length)} sub="countries" size={124} /><Legend parts={cParts} unit={u === 't' ? 't' : ''} /></div>
          <HBars items={sorted(d.byCountry).slice(0, 6).map((r) => ({ n: `${countryName(r.country)} · ${r.suppliers}`, v: v(r), p: tot ? (v(r) / tot) * 100 : 0, onClick: () => nav(`/suppliers?country=${r.country || 'none'}`) }))} unit={u === 't' ? 't' : ''} c="var(--s2)" />
        </DCard>
        <DCard title="By product" span={2} right={<div className="seg"><button className={itemView === 'group' ? 'on' : ''} onClick={() => setItemView('group')}>Groups</button><button className={itemView === 'item' ? 'on' : ''} onClick={() => setItemView('item')}>Spend categories</button></div>}>
          {itemView === 'group'
            ? <Treemap items={sorted(groups).map((g, i) => ({ n: g.group, v: v(g), c: PAL2[i % PAL2.length]! }))} W={640} H={200} />
            : <HBars items={sorted(d.byItem).slice(0, 12).map((r) => ({ n: r.item ?? 'Not mapped', v: v(r), d: 1, p: tot ? (v(r) / tot) * 100 : 0 }))} unit={u === 't' ? 't' : ''} c="var(--s3)" />}
        </DCard>
        <DCard title="Largest suppliers" span={2} sub="engage these first: ask for their own factors, complete their profiles">
          <HBars items={top.slice(0, 10).map((x) => ({ n: x.name, v: v(x), d: 1, p: tot ? (v(x) / tot) * 100 : 0, c: x.own_factor ? 'var(--ok)' : 'var(--s3)', onClick: () => nav(`/suppliers?open=${x.id}`) }))} unit={u === 't' ? 't' : ''} />
          <div className="lgd"><span><i style={{ background: 'var(--ok)' }} />own factor</span><span><i style={{ background: 'var(--s3)' }} />spend-based</span></div>
        </DCard>
        <DCard title="By Scope 3 category"><div className="dsplit"><Donut parts={s3} center={metric === 'co2e' ? fmt0(tot) : usdShort(tot)} sub={metric === 'co2e' ? 't' : ''} size={124} /><Legend parts={s3} unit={u === 't' ? 't' : ''} /></div></DCard>
        <DCard title={metric === 'co2e' ? 'Emissions by month (t)' : 'Spend by month (USD)'} span={2}>
          <Bars rows={mrows} unit={u} h={165} />
          {metric === 'co2e' && <div className="lgd"><span><i style={{ background: 'var(--ok)' }} />Supplier's own factor</span><span><i style={{ background: '#E9B44C' }} />Spend-based</span></div>}
        </DCard>
        <DCard title="Data quality"><div className="dsplit"><Donut parts={q} center={`${Math.round(supplierShare * 100)}%`} sub="specific" size={124} /><Legend parts={q} unit="t" /></div></DCard>
        <DCard title="By industry sector" span={2}><HBars items={sorted(d.bySector).slice(0, 10).map((r) => ({ n: r.sector, v: v(r), d: 1, p: tot ? (v(r) / tot) * 100 : 0 }))} unit={u === 't' ? 't' : ''} c="var(--s2)" /></DCard>
        <DCard title="Climate targets of suppliers"><div className="dsplit"><Donut parts={tParts} center={`${p.target}`} sub="with a target" size={124} /><Legend parts={tParts} unit="t" /></div></DCard>
        <DCard title="Supplier profiles" span={2} sub={`how much is known about the ${p.suppliers.toLocaleString('en')} suppliers`}>
          <HBars items={([['Country', p.country], ['Vendor number', p.reference], ['Industry', p.industry], ['Sustainability contact', p.contact], ['Reports its emissions', p.reports], ['Has a climate target', p.target], ['Own emission factor', p.own_factor]] as [string, number][])
            .map(([n, x]) => ({ n, v: x, p: p.suppliers ? (x / p.suppliers) * 100 : 0, c: 'var(--primary)' }))} unit="" />
          {p.review > 0 && <div className="sins">{p.review} possible duplicate{p.review === 1 ? '' : 's'} to check under “Check names”.</div>}
        </DCard>
      </div>
      <div className="card flush">
        <div style={{ padding: '12px 14px 4px' }}><h3 style={{ fontSize: 13.5 }}>Largest suppliers · detail</h3></div>
        <div className="scrollx"><table className="t dt">
          <thead><tr><th>#</th><th>Supplier</th><th>Country</th><th>Mainly</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th className="num">Share</th><th>Factor</th><th>Profile</th></tr></thead>
          <tbody>{top.map((x, i) => (
            <tr key={x.id} className="click" onClick={() => nav(`/suppliers?open=${x.id}`)}>
              <td className="muted">{i + 1}</td><td><b>{x.name}</b></td><td className="small">{x.country ? countryName(x.country) : <span className="muted">—</span>}</td>
              <td className="small">{x.main_item ?? '—'}</td><td className="num">{x.lines.toLocaleString('en')}</td><td className="num">{usd(x.usd)}</td><td className="num">{tonnes(x.co2e)}</td>
              <td className="num">{tot ? `${((v(x) / tot) * 100).toFixed(1)}%` : ''}</td>
              <td>{x.own_factor ? <span className="chip">own factor</span> : <span className="chip grey">spend-based</span>}</td><td><Completeness v={x.completeness} /></td>
            </tr>))}</tbody>
        </table></div>
      </div>
      <span className="muted small">{fmtV(tot)} in {d.year}</span>
    </div>
  );
}
