/**
 * Entries & results: everything saved for the company, a summary per gas,
 * and a drawer showing exactly how each entry was calculated.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { unitLabel, api, BASIS_LABEL, num, tco2e, type Activity } from '../lib/api';
import { useApp } from '../App';
import { rememberWork, workContext } from '../lib/workContext';
import { ENERGY_UNITS, Result } from '../components/Result';
import { Icon } from '../components/Icon';
import { GasToggle, useGasSplit } from '../components/GasToggle';
import { Evidence } from '../components/Evidence';
import { PartInfo } from '../components/PartInfo';

const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'c-n'], submitted: ['Waiting approval', 'c-warn'], approved: ['Approved', 'c-ok'], rejected: ['Sent back', 'c-bad'] };

const LIMIT = 5000;

/** Correct a wrong entry from here: send an approved (or waiting) entry back with a reason, then delete it or fix it in Add data. */
function EntryFix({ a, onDone }: { a: { id: string; status: string; review_note?: string | null }; onDone: (deleted: boolean) => void }) {
  const { toast } = useApp();
  const [why, setWhy] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<boolean>) => { setBusy(true); try { if (await fn()) { setWhy(null); setDel(false); } } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const back = () => run(async () => { const r = await api.reviewAction([a.id], 'return', why!.trim()); if (r.skipped.length) { toast(`Not sent back: ${r.skipped[0]!.reason}`); return false; } toast('Sent back — you can now delete it or correct it'); onDone(false); return true; });
  const remove = () => run(async () => { await api.deleteActivity(a.id); toast('Entry deleted'); onDone(true); return true; });
  if (a.status === 'approved' || a.status === 'submitted') return (
    <div className="note small" style={{ display: 'grid', gap: 8 }}>
      {why === null ? <div className="row" style={{ gap: 8 }}><span className="grow">{a.status === 'approved' ? 'Wrong facility, month or figure? An approver sends it back first; then it can be deleted or corrected.' : 'Waiting for approval. To remove it, send it back first.'}</span>
        <button className="btn sm ghost danger" onClick={() => setWhy('')}>Send back…</button></div>
        : <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}><label className="field grow"><span>Why is it sent back?</span><input className="input" autoFocus value={why} placeholder="e.g. entered for the wrong facility" onChange={(e) => setWhy(e.target.value)} /></label>
          <button className="btn sm p" disabled={busy || !why.trim()} onClick={() => void back()}>Send back</button><button className="btn sm ghost" onClick={() => setWhy(null)}>Cancel</button></div>}
    </div>);
  if (a.status === 'draft' || a.status === 'rejected') return (
    <div className="note small" style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ gap: 8 }}><span className="grow">{a.status === 'rejected' ? <>Sent back{a.review_note ? `: “${a.review_note}”` : ''}. Delete it, or correct it in Add data and submit again.</> : 'Draft — not counted yet.'}</span>
        {!del ? <button className="btn sm ghost danger" onClick={() => setDel(true)}>Delete…</button>
          : <><span>Delete this entry for good?</span><button className="btn sm danger" disabled={busy} onClick={() => void remove()}>Delete</button><button className="btn sm ghost" onClick={() => setDel(false)}>Keep</button></>}</div>
    </div>);
  return null;
}
export function Entries() {
  // filters live in the address, so a dashboard figure can open exactly the entries behind it
  const [sp, setSp] = useSearchParams();
  const { tenant: tn } = useApp();
  const tenantId = tn?.id;
  const nav = useNavigate();
  const loc = useLocation();
  type Drill = { cats: string[]; fids: string[]; dm: number[]; whole: boolean; scope: number; items: string[]; wtt: boolean; cons: string; from: string };
  const NO_DRILL: Drill = { cats: [], fids: [], dm: [], whole: true, scope: 0, items: [], wtt: false, cons: '', from: '' };
  const parse = (q: URLSearchParams) => ({
    year: Number(q.get('y')) || workContext(tenantId).year || new Date().getFullYear(), status: q.get('status') ?? '', cat: q.get('cat') ?? '', month: q.get('m') ?? '', fac: q.get('fac') ?? '', item: q.get('item') ?? '',
    drill: { cats: q.get('cats')?.split('|').filter(Boolean) ?? [], fids: q.get('fids')?.split(',').filter(Boolean) ?? [], dm: (q.get('dm') ?? '').split(',').map(Number).filter((m) => m >= 1 && m <= 12),
      whole: q.get('whole') !== '0', scope: Number(q.get('scope')) || 0, items: q.get('items')?.split('|').filter(Boolean) ?? [], wtt: q.get('wtt') === '1', cons: q.get('cons') ?? '', from: q.get('from') ?? '' } as Drill,
  });
  const init = parse(sp);
  const [year, setYear] = useState(init.year);
  useEffect(() => { rememberWork(tenantId, { year }); }, [year, tenantId]);
  const [rows, setRows] = useState<Activity[]>([]);
  const [years, setYears] = useState<{ year: number; n: number; approved: number }[]>([]);
  const [status, setStatus] = useState(init.status);
  const [cat, setCat] = useState(init.cat);
  const [month, setMonth] = useState(init.month);
  const [fac, setFac] = useState(init.fac);
  const [item, setItem] = useState(init.item);
  // from a dashboard: the categories, facilities, months (the dashboard's month rule), scope, items or upstream energy behind the figure clicked
  const [drill, setDrill] = useState<Drill>(init.drill);
  const drilled = !!(drill.cats.length || drill.fids.length || drill.dm.length || drill.scope || drill.items.length || drill.wtt);
  const written = useRef<string | null>(null);
  const toQuery = () => {
    const q = new URLSearchParams();
    q.set('y', String(year));
    if (status) q.set('status', status); if (cat) q.set('cat', cat); if (month) q.set('m', month); if (fac) q.set('fac', fac); if (item) q.set('item', item);
    if (drill.cats.length) q.set('cats', drill.cats.join('|')); if (drill.fids.length) q.set('fids', drill.fids.join(','));
    if (drill.dm.length) { q.set('dm', drill.dm.join(',')); q.set('whole', drill.whole ? '1' : '0'); }
    if (drill.scope) q.set('scope', String(drill.scope)); if (drill.items.length) q.set('items', drill.items.join('|')); if (drill.wtt) q.set('wtt', '1');
    if (drill.cons && drilled) q.set('cons', drill.cons); if (drill.from && drilled) q.set('from', drill.from);
    return q;
  };
  // filters → address
  useEffect(() => { const q = toQuery(); written.current = q.toString(); if (q.toString() !== sp.toString()) setSp(q, { replace: true }); }, [year, status, cat, month, fac, item, drill]); // eslint-disable-line react-hooks/exhaustive-deps
  // address → filters, when it changes from outside (the menu, back / forward, a pasted link)
  useEffect(() => {
    if (written.current === null || sp.toString() === written.current) return;
    const x = parse(sp); written.current = sp.toString();
    setYear(x.year); setStatus(x.status); setCat(x.cat); setMonth(x.month); setFac(x.fac); setItem(x.item); setDrill(x.drill);
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearAll = () => { setMonth(''); setFac(''); setItem(''); setCat(''); setStatus(''); setDrill(NO_DRILL); };
  const back = () => { if (loc.key !== 'default') nav(-1); else nav('/dashboards'); };
  const [gas, setGas] = useState<Awaited<ReturnType<typeof api.byGas>>['rows']>([]);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof api.activity>> | null>(null);
  const [showGas, toggleGas] = useGasSplit();
  const dlg = useRef<HTMLDialogElement>(null);
  const { role, toast } = useApp();
  const canRecalc = ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role);
  const [reload, setReload] = useState(0);
  const recalc = async (b: { ids?: string[]; year?: number; onlyWithWarnings?: boolean }) => {
    try {
      const r = await api.recalculate(b);
      toast(`${r.checked} entr${r.checked === 1 ? 'y' : 'ies'} checked, ${r.changed} updated${r.problems.length ? ` · ${r.problems.length} could not be recalculated` : ''}`);
      setReload((x) => x + 1);
      if (b.ids && open) setOpen(await api.activity(b.ids[0]!));
    } catch (e) { toast((e as Error).message); }
  };

  useEffect(() => {
    // 'counted' = what the dashboards count with "Include waiting": every status except sent back (filtered here)
    api.activities({ year, status: status && status !== 'counted' ? status : undefined, limit: LIMIT }).then((r) => { setRows(r.activities); setYears(r.years ?? []); });
    api.byGas(year).then((r) => setGas(r.rows));
  }, [year, status, reload]);

  const cats = [...new Set(rows.map((a) => a.category))].sort();
  const facs = [...new Set(rows.map((a) => a.facility))].sort();
  const months = [...new Set(rows.map((a) => a.period_start.slice(0, 7)))].sort();
  // items offered: those of the entries left by the category and facility filters
  const items = [...new Set(rows.filter((a) => (!cat || a.category === cat) && (!fac || a.facility === fac)).map((a) => a.item))].sort();
  const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  // an entry belongs to a month when its period covers it (a whole-year entry shows in every month)
  const inMonth = (a: Activity) => !month || (a.period_start.slice(0, 7) <= month && a.period_end.slice(0, 7) >= month);
  // the dashboard's month rule: an entry under 40 days counts in the month it starts; a longer one only in the full-year view
  const days = (a: Activity) => (Date.parse(`${a.period_end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.period_start.slice(0, 10)}T00:00:00Z`)) / 86_400_000;
  const inRange = (a: Activity) => !drill.dm.length || (days(a) < 40 ? drill.dm.includes(Number(a.period_start.slice(5, 7))) : drill.whole);
  // a scope holds the entries with emissions in it, as the dashboards count them (Scope 3 includes the upstream part of fuels and energy)
  const inScope = (a: Activity) => !drill.scope || (drill.scope === 1 ? Number(a.co2e_direct) > 0 : drill.scope === 2 ? Number(a.co2e_scope2 ?? 0) > 0 || Number(a.co2e_scope2_market ?? 0) > 0 : Number(a.co2e_scope3 ?? 0) > 0 || Number(a.co2e_wtt) > 0 || Number(a.co2e_td ?? 0) > 0);
  const inDrill = (a: Activity) => (!drill.cats.length || drill.cats.includes(a.category_code ?? '')) && (!drill.fids.length || drill.fids.includes(a.facility_id ?? '')) && inRange(a) && inScope(a)
    && (!drill.items.length || drill.items.includes(a.item)) && (!drill.wtt || Number(a.co2e_wtt) > 0 || Number(a.co2e_td ?? 0) > 0);
  const shown = rows.filter((a) => (!cat || a.category === cat) && (!fac || a.facility === fac) && (!item || a.item === item) && (status !== 'counted' || a.status !== 'rejected') && inMonth(a) && inDrill(a));
  const filtered = !!(cat || fac || item || month || status || drilled);
  const sum = (k: keyof Activity) => shown.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  // quantity of the entries shown: one figure when they share a unit, else per unit
  const qty = (() => {
    const by = new Map<string, number>();
    for (const a of shown) if (a.quantity != null) by.set(a.unit, (by.get(a.unit) ?? 0) + Number(a.quantity));
    const parts = [...by].sort((x, y) => y[1] - x[1]);
    if (!parts.length) return { text: '—', mixed: false };
    const t = parts.slice(0, 3).map(([u, v]) => `${num(v)} ${unitLabel(u)}`).join(' · ') + (parts.length > 3 ? ` · +${parts.length - 3} units` : '');
    return { text: t, mixed: parts.length > 1 };
  })();
  const yearList = [...new Set([...years.map((y) => y.year), new Date().getFullYear(), year])].sort((a, b) => b - a);
  const other = years.filter((y) => y.year !== year && y.n > 0);
  const show = async (id: string) => { setOpen(await api.activity(id)); dlg.current?.showModal(); };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture</div><h1>Entries & results</h1><p className="sub">Everything saved for this company. Click an entry to see how it was calculated.</p></div>
        {canRecalc && <button className="btn sm" style={{ alignSelf: 'flex-end' }} title="Recalculate entries that have a warning (e.g. a missing grid factor or next year's factors not yet loaded)" onClick={() => recalc({ year, onlyWithWarnings: true })}>Recalculate entries with warnings</button>}
        <label className="field"><span>Year</span>
          <select className="input" value={year} onChange={(e) => { setYear(Number(e.target.value)); setMonth(''); setDrill((x) => ({ ...x, dm: [], whole: true })); }}>{yearList.map((y) => { const c = years.find((x) => x.year === y); return <option key={y} value={y}>{y}{c ? ` (${c.n})` : ''}</option>; })}</select>
        </label>
      </div>

      {drilled && <div className="drillbar card flush" style={{ marginBottom: 8 }}>
        <b>From the dashboard:</b> {drill.from || 'selected figure'}
        {drill.dm.length > 0 && drill.dm.length < 12 && <span className="chip grey">{drill.dm.length === 1 ? monthName(`${year}-${String(drill.dm[0]).padStart(2, '0')}`) : `${monthName(`${year}-${String(drill.dm[0]).padStart(2, '0')}`)}–${monthName(`${year}-${String(drill.dm[drill.dm.length - 1]).padStart(2, '0')}`)}`}</span>}
        {drill.fids.length > 0 && <span className="chip grey">{drill.fids.length === 1 ? rows.find((a) => a.facility_id === drill.fids[0])?.facility ?? '1 facility' : `${drill.fids.length} facilities`}</span>}
        {drill.scope > 0 && <span className="chip grey">Scope {drill.scope}{drill.scope === 2 ? ' (location- and market-based shown)' : ''}</span>}
        {drill.wtt && <span className="chip grey">upstream energy (well-to-tank, grid losses)</span>}
        {status === 'counted' && <span className="chip grey">approved and waiting</span>}
        <span className="grow" /><button className="linkbtn" onClick={back}>‹ Back to the dashboard</button>
        <button className="btn xs ghost" onClick={clearAll}>Show all entries</button>
        {drill.cons === 'equity' && <div className="muted small" style={{ flexBasis: '100%' }}>Entries show their full values; the dashboard counts each facility at its ownership share (equity share), so its figure is lower where a facility is not wholly owned.</div>}
        {drill.dm.length > 0 && !drill.whole && <div className="muted small" style={{ flexBasis: '100%' }}>As on the dashboard, entries covering more than a month (a quarter, the year) are not counted in single months.</div>}
      </div>}
      {rows.length >= LIMIT && <div className="note warn small" style={{ marginBottom: 8 }}>Only the latest {LIMIT.toLocaleString('en-US')} entries of {year} are listed: the totals may be short. Use the filters, or Excel exports, for the full year.</div>}
      <div className="total">
        <div className="stat s1"><small>Scope 1<PartInfo part="direct" /></small><b>{tco2e(sum('co2e_direct'))}</b><small>tCO₂e</small></div>
        <div className="stat s2"><small>Scope 2 · location-based<PartInfo part="scope2" /></small><b>{tco2e(sum('co2e_scope2'))}</b><small>tCO₂e</small></div>
        <div className="stat s2m"><small>Scope 2 · market-based<PartInfo part="scope2_market" /></small><b>{tco2e(sum('co2e_scope2_market'))}</b><small>tCO₂e</small></div>
        <div className="stat s3"><small>Scope 3.3 · upstream<PartInfo part="wtt" /> + T&D losses<PartInfo part="td_loss" /></small><b>{tco2e(sum('co2e_wtt') + sum('co2e_td'))}</b><small>tCO₂e</small></div>
        <div className="stat s3"><small>Scope 3 · other categories (purchases, waste, travel…)<PartInfo part="scope3" /></small><b>{tco2e(sum('co2e_scope3'))}</b><small>tCO₂e</small></div>
        <div className="stat bio"><small>Biogenic CO₂ (outside scopes)<PartInfo part="outside_scopes" /></small><b>{tco2e(sum('co2_biogenic'))}</b><small>tCO₂</small></div>
        <div className="stat memo"><small>Memo: non-Kyoto gases<PartInfo part="memo" /></small><b>{tco2e(sum('co2e_memo'))}</b><small>tCO₂e</small></div>
      </div>

      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px 10px' }}>
          <div className="grow"><h2>By greenhouse gas<PartInfo part="gases" /> · {year}{filtered ? <span className="muted small"> · whole year, filters not applied</span> : null}</h2><p className="sub">Each gas in kg and in CO₂e. Totals given by a source without a gas split appear as “CO2e”.</p></div>
          {gas.length > 0 && <GasToggle open={showGas} onToggle={toggleGas} count={new Set(gas.filter((g) => g.kg_gas != null).map((g) => g.gas)).size} />}
        </div>
        {!gas.length ? <div className="empty">No entries for {year}.</div> : showGas && (
          <table className="t">
            <thead><tr><th>Category</th><th>Part</th><th>Gas</th><th className="num">kg of gas</th><th className="num">tCO₂e</th></tr></thead>
            <tbody>{gas.map((g, i) => (
              <tr key={i}><td>{g.category}</td><td>{BASIS_LABEL[g.basis]}</td><td className="mono">{g.gas}</td><td className="num">{num(g.kg_gas)}</td><td className="num">{tco2e(g.kg_co2e)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h2>Entries · {shown.length}{!status && shown.length ? ` · ${shown.filter((a) => a.status === 'approved').length} approved` : ''}</h2>
          <p className="sub">Every status unless filtered; the total row and the cards above follow the filters. Dashboards and reports count approved entries only. Purchase files create one entry per facility, month and spend category — their lines are under Add data → Purchases → Published lines.</p>
          {!rows.length && other.length > 0 && <div className="note info small">No entries in {year}. Entries exist in {other.map((y) => <button key={y.year} className="btn xs ghost" onClick={() => setYear(y.year)}>{y.year} ({y.n})</button>)}</div>}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 0', padding: '0 16px 12px' }}>
        <select className="input sm" style={{ width: 'auto' }} aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthName(m)} {year}</option>)}</select>
        <select className="input sm" style={{ width: 'auto', maxWidth: 260 }} aria-label="Facility" value={fac} onChange={(e) => setFac(e.target.value)}>
          <option value="">All facilities ({facs.length})</option>{facs.map((f) => <option key={f}>{f}</option>)}</select>
        <select className="input sm" style={{ width: 'auto', maxWidth: 260 }} aria-label="Category" value={cat} onChange={(e) => { setCat(e.target.value); setItem(''); }}>
          <option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input sm" style={{ width: 'auto', maxWidth: 280 }} aria-label="Item" value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">All items ({items.length})</option>{items.map((x) => <option key={x}>{x}</option>)}{item && !items.includes(item) && <option>{item}</option>}</select>
        <select className="input sm" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="approved">Approved</option><option value="counted">Approved and waiting (not sent back)</option><option value="submitted">Waiting approval</option><option value="draft">Draft</option><option value="rejected">Sent back</option></select>
        {filtered && <button className="btn sm ghost" onClick={clearAll}>Clear filters</button>}
        <span className="grow" /><span className="muted small">{filtered ? 'The totals (row below and cards above) follow the filters' : 'All entries of the year, every status'}</span>
      </div>
        {rows.length ? (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Period</th><th>Facility</th><th>Category</th><th>Item</th><th className="num">Quantity</th><th className="num">Scope 1 tCO₂e<PartInfo part="direct" /></th><th className="num">Scope 2 loc.<PartInfo part="scope2" /></th><th className="num">Scope 2 mkt.<PartInfo part="scope2_market" /></th><th className="num">Scope 3.3<PartInfo part="td_loss" label="Scope 3.3 (T&D and upstream)" /></th><th className="num">Scope 3 other<PartInfo part="scope3" /></th><th>GWP</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>{shown.length > 1 && <tr className="totrow">
                  <td colSpan={4}><b>Total · {shown.length} entries</b>{filtered ? <span className="muted small"> · filtered</span> : null}</td>
                  <td className="num" title={qty.mixed ? 'Different units: summed per unit' : undefined}>{qty.text}</td>
                  <td className="num">{tco2e(sum('co2e_direct'))}</td><td className="num">{tco2e(sum('co2e_scope2'))}</td><td className="num">{tco2e(sum('co2e_scope2_market'))}</td>
                  <td className="num">{tco2e(sum('co2e_wtt') + sum('co2e_td'))}</td><td className="num">{tco2e(sum('co2e_scope3'))}</td><td colSpan={3} />
                </tr>}
                {shown.map((a) => (
                <tr key={a.id} className="click" onClick={() => show(a.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(a.period_start + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</td><td>{a.facility}</td><td>{a.category}{a.purchase_batch_id && <div className="muted small">from a purchase file</div>}</td><td>{a.vehicle ? <><b>{a.vehicle}</b> · </> : null}{a.waste_site ? <><b>{a.waste_site}</b> · </> : null}{a.item}</td>
                  <td className="num">{num(a.quantity)} {unitLabel(a.unit)}</td><td className="num">{tco2e(a.co2e_direct)}</td><td className="num">{tco2e(Number(a.co2e_scope2 ?? 0))}</td><td className="num">{tco2e(Number(a.co2e_scope2_market ?? 0))}</td><td className="num">{tco2e(Number(a.co2e_wtt) + Number(a.co2e_td ?? 0))}</td><td className="num">{a.ghg_category ? <>{tco2e(Number(a.co2e_scope3 ?? 0))} <span className="chip grey">3.{a.ghg_category}</span></> : tco2e(Number(a.co2e_scope3 ?? 0))}</td>
                  <td>{a.gwp_set}</td><td><span className="chip grey">{a.data_type}</span></td><td><span className={`chip ${STATUS[a.status]?.[1] ?? 'c-n'}`}>{STATUS[a.status]?.[0] ?? a.status}</span></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No entries for {year}{status ? ' with this status' : ''}.</div>}
      </div>

      <dialog ref={dlg} className="drawer" onClose={() => setOpen(null)}>
        {open && (
          <div className="in">
            <div className="row"><div className="grow"><div className="eyebrow">Entry · {open.period_start} to {open.period_end}</div><h2>{open.vehicle ? `${open.vehicle} · ` : ''}{open.waste_site ? `${open.waste_site} · ` : ''}{open.item}</h2></div>
              <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
            <div className="row"><div className="sub grow">{num(open.quantity)} {unitLabel(open.unit)}{open.unit === 't' && open.item === 'Landfill methane' ? ' CH₄ generated' : ''} · {open.data_type} · saved {new Date(open.created_at).toLocaleString()}</div>
              {canRecalc && <button className="btn ghost sm" onClick={() => recalc({ ids: [open.id], onlyWithWarnings: false })}>Recalculate</button>}</div>
            <EntryFix a={open} onDone={async (deleted) => { setReload((x) => x + 1); if (deleted) dlg.current?.close(); else setOpen(await api.activity(open.id)); }} />
            <Result r={{ gwpSet: open.gwp_set, totals: { direct: Number(open.co2e_direct), scope2: Number(open.co2e_scope2 ?? 0), scope2_market: Number(open.co2e_scope2_market ?? 0), td_loss: Number(open.co2e_td ?? 0), scope3: Number(open.co2e_scope3 ?? 0), wtt: Number(open.co2e_wtt), outside_scopes: Number(open.co2_biogenic), memo: Number(open.co2e_memo) },
              lines: open.lines.map((l) => ({ basis: l.basis, gas: l.gas, kgGas: l.kg_gas, kgCo2e: l.kg_co2e, method: l.method, source: l.source })), steps: open.steps, warnings: open.warnings, factors: open.factors, cv: open.inputs?.cv }} quantity={Number(open.quantity)} unitName={open.unit} energy={ENERGY_UNITS.has(open.unit)} />
            <Evidence activityId={open.id} />
          </div>
        )}
      </dialog>
    </div>
  );
}
