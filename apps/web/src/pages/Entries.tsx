/**
 * Entries & results: everything saved for the company, a summary per gas,
 * and a drawer showing exactly how each entry was calculated.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { unitLabel, api, BASIS_LABEL, num, tco2e, type Activity } from '../lib/api';
import { useApp } from '../App';
import { ENERGY_UNITS, Result } from '../components/Result';
import { Icon } from '../components/Icon';
import { GasToggle, useGasSplit } from '../components/GasToggle';
import { Evidence } from '../components/Evidence';

const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'c-n'], submitted: ['Waiting approval', 'c-warn'], approved: ['Approved', 'c-ok'], rejected: ['Sent back', 'c-bad'] };

export function Entries() {
  // filters live in the address, so a dashboard figure can open exactly the entries behind it
  const [sp, setSp] = useSearchParams();
  const [year, setYear] = useState(() => Number(sp.get('y')) || new Date().getFullYear());
  const [rows, setRows] = useState<Activity[]>([]);
  const [years, setYears] = useState<{ year: number; n: number; approved: number }[]>([]);
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [cat, setCat] = useState(sp.get('cat') ?? '');
  const [month, setMonth] = useState(sp.get('m') ?? '');
  const [fac, setFac] = useState(sp.get('fac') ?? '');
  // from a dashboard: the categories, facilities, months, scope, item or upstream energy behind the figure clicked
  const [drill, setDrill] = useState(() => ({ cats: sp.get('cats')?.split('|').filter(Boolean) ?? [], facs: sp.get('facs')?.split('|').filter(Boolean) ?? [], mfrom: sp.get('mfrom') ?? '', mto: sp.get('mto') ?? '',
    scope: Number(sp.get('scope')) || 0, item: sp.get('item') ?? '', wtt: sp.get('wtt') === '1', from: sp.get('from') ?? '' }));
  const drilled = !!(drill.cats.length || drill.facs.length || drill.mfrom || drill.scope || drill.item || drill.wtt);
  useEffect(() => {
    const q = new URLSearchParams();
    q.set('y', String(year));
    if (status) q.set('status', status); if (cat) q.set('cat', cat); if (month) q.set('m', month); if (fac) q.set('fac', fac);
    if (drill.cats.length) q.set('cats', drill.cats.join('|')); if (drill.facs.length) q.set('facs', drill.facs.join('|'));
    if (drill.mfrom) { q.set('mfrom', drill.mfrom); q.set('mto', drill.mto); } if (drill.scope) q.set('scope', String(drill.scope));
    if (drill.item) q.set('item', drill.item); if (drill.wtt) q.set('wtt', '1'); if (drill.from && (drilled || month)) q.set('from', drill.from);
    setSp(q, { replace: true });
  }, [year, status, cat, month, fac, drill]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearAll = () => { setMonth(''); setFac(''); setCat(''); setStatus(''); setDrill({ cats: [], facs: [], mfrom: '', mto: '', scope: 0, item: '', wtt: false, from: '' }); };
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
    api.activities({ year, status: status || undefined, limit: 5000 }).then((r) => { setRows(r.activities); setYears(r.years ?? []); });
    api.byGas(year).then((r) => setGas(r.rows));
  }, [year, status, reload]);

  const cats = [...new Set(rows.map((a) => a.category))].sort();
  const facs = [...new Set(rows.map((a) => a.facility))].sort();
  const months = [...new Set(rows.map((a) => a.period_start.slice(0, 7)))].sort();
  const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  // an entry belongs to a month when its period covers it (a whole-year entry shows in every month)
  const inMonth = (a: Activity) => !month || (a.period_start.slice(0, 7) <= month && a.period_end.slice(0, 7) >= month);
  const inRange = (a: Activity) => !drill.mfrom || (a.period_start.slice(0, 7) <= drill.mto && a.period_end.slice(0, 7) >= drill.mfrom);
  // a scope holds the entries with emissions in it, as the dashboards count them (Scope 3 includes the upstream part of fuels and energy)
  const inScope = (a: Activity) => !drill.scope || (drill.scope === 1 ? Number(a.co2e_direct) > 0 : drill.scope === 2 ? Number(a.co2e_scope2 ?? 0) > 0 || Number(a.co2e_scope2_market ?? 0) > 0 : Number(a.co2e_scope3 ?? 0) > 0 || Number(a.co2e_wtt) > 0 || Number(a.co2e_td ?? 0) > 0);
  const inDrill = (a: Activity) => (!drill.cats.length || drill.cats.includes(a.category_code ?? '')) && (!drill.facs.length || drill.facs.includes(a.facility)) && inRange(a) && inScope(a)
    && (!drill.item || a.item === drill.item) && (!drill.wtt || Number(a.co2e_wtt) > 0 || Number(a.co2e_td ?? 0) > 0);
  const shown = rows.filter((a) => (!cat || a.category === cat) && (!fac || a.facility === fac) && inMonth(a) && inDrill(a));
  const filtered = !!(cat || fac || month || status || drilled);
  const sum = (k: keyof Activity) => shown.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const yearList = [...new Set([...years.map((y) => y.year), new Date().getFullYear(), year])].sort((a, b) => b - a);
  const other = years.filter((y) => y.year !== year && y.n > 0);
  const show = async (id: string) => { setOpen(await api.activity(id)); dlg.current?.showModal(); };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture</div><h1>Entries & results</h1><p className="sub">Everything saved for this company. Click an entry to see how it was calculated.</p></div>
        {canRecalc && <button className="btn sm" style={{ alignSelf: 'flex-end' }} title="Recalculate entries that have a warning (e.g. a missing grid factor or next year's factors not yet loaded)" onClick={() => recalc({ year, onlyWithWarnings: true })}>Recalculate entries with warnings</button>}
        <label className="field"><span>Year</span>
          <select className="input" value={year} onChange={(e) => { setYear(Number(e.target.value)); setMonth(''); }}>{yearList.map((y) => { const c = years.find((x) => x.year === y); return <option key={y} value={y}>{y}{c ? ` (${c.n})` : ''}</option>; })}</select>
        </label>
      </div>

      {(drilled || (!!drill.from && !!month)) && <div className="drillbar card flush" style={{ marginBottom: 8 }}>
        <b>From the dashboard:</b> {drill.from || 'selected figure'}
        {drill.mfrom && <span className="chip grey">{drill.mfrom === drill.mto ? drill.mfrom : `${drill.mfrom} to ${drill.mto}`}</span>}
        {drill.facs.length > 0 && <span className="chip grey">{drill.facs.length === 1 ? drill.facs[0] : `${drill.facs.length} facilities`}</span>}
        {drill.scope > 0 && <span className="chip grey">Scope {drill.scope}</span>}
        {drill.wtt && <span className="chip grey">upstream energy (well-to-tank, grid losses)</span>}
        <span className="grow" /><Link to="/dashboards" className="linkbtn" onClick={(e) => { e.preventDefault(); window.history.back(); }}>‹ Back to the dashboard</Link>
        <button className="btn xs ghost" onClick={() => { if (!drilled) setMonth(''); setDrill({ cats: [], facs: [], mfrom: '', mto: '', scope: 0, item: '', wtt: false, from: '' }); }}>Show all entries</button>
      </div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
        <select className="input sm" style={{ width: 'auto' }} aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All months</option>{months.map((m) => <option key={m} value={m}>{monthName(m)} {year}</option>)}</select>
        <select className="input sm" style={{ width: 'auto', maxWidth: 260 }} aria-label="Facility" value={fac} onChange={(e) => setFac(e.target.value)}>
          <option value="">All facilities ({facs.length})</option>{facs.map((f) => <option key={f}>{f}</option>)}</select>
        <select className="input sm" style={{ width: 'auto', maxWidth: 260 }} aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="input sm" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="approved">Approved</option><option value="submitted">Waiting approval</option><option value="draft">Draft</option><option value="rejected">Sent back</option></select>
        {filtered && <button className="btn sm ghost" onClick={clearAll}>Clear filters</button>}
        <span className="grow" /><span className="muted small">{filtered ? 'Totals below follow the filters' : 'All entries of the year, every status'}</span>
      </div>
      <div className="total">
        <div className="stat s1"><small>Scope 1</small><b>{tco2e(sum('co2e_direct'))}</b><small>tCO₂e</small></div>
        <div className="stat s2"><small>Scope 2 · location-based</small><b>{tco2e(sum('co2e_scope2'))}</b><small>tCO₂e</small></div>
        <div className="stat s2m"><small>Scope 2 · market-based</small><b>{tco2e(sum('co2e_scope2_market'))}</b><small>tCO₂e</small></div>
        <div className="stat s3"><small>Scope 3.3 · upstream + T&D losses</small><b>{tco2e(sum('co2e_wtt') + sum('co2e_td'))}</b><small>tCO₂e</small></div>
        <div className="stat s3"><small>Scope 3 · other categories (purchases, waste, travel…)</small><b>{tco2e(sum('co2e_scope3'))}</b><small>tCO₂e</small></div>
        <div className="stat bio"><small>Biogenic CO₂ (outside scopes)</small><b>{tco2e(sum('co2_biogenic'))}</b><small>tCO₂</small></div>
        <div className="stat memo"><small>Memo: non-Kyoto gases</small><b>{tco2e(sum('co2e_memo'))}</b><small>tCO₂e</small></div>
      </div>

      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px 10px' }}>
          <div className="grow"><h2>By greenhouse gas · {year}{filtered ? <span className="muted small"> · whole year, filters not applied</span> : null}</h2><p className="sub">Each gas in kg and in CO₂e. Totals given by a source without a gas split appear as “CO2e”.</p></div>
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
          <p className="sub">Every status unless filtered; the totals above follow the filters. Dashboards and reports count approved entries only. Purchase files create one entry per facility, month and spend category — their lines are under Add data → Purchases → Published lines.</p>
          {!rows.length && other.length > 0 && <div className="note info small">No entries in {year}. Entries exist in {other.map((y) => <button key={y.year} className="btn xs ghost" onClick={() => setYear(y.year)}>{y.year} ({y.n})</button>)}</div>}</div>
        {rows.length ? (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Period</th><th>Facility</th><th>Category</th><th>Item</th><th className="num">Quantity</th><th className="num">Scope 1 tCO₂e</th><th className="num">Scope 2 loc.</th><th className="num">Scope 2 mkt.</th><th className="num">Scope 3.3</th><th className="num">Scope 3 other</th><th>GWP</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>{shown.map((a) => (
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
            <Result r={{ gwpSet: open.gwp_set, totals: { direct: Number(open.co2e_direct), scope2: Number(open.co2e_scope2 ?? 0), scope2_market: Number(open.co2e_scope2_market ?? 0), td_loss: Number(open.co2e_td ?? 0), scope3: Number(open.co2e_scope3 ?? 0), wtt: Number(open.co2e_wtt), outside_scopes: Number(open.co2_biogenic), memo: Number(open.co2e_memo) },
              lines: open.lines.map((l) => ({ basis: l.basis, gas: l.gas, kgGas: l.kg_gas, kgCo2e: l.kg_co2e, method: l.method, source: l.source })), steps: open.steps, warnings: open.warnings, factors: open.factors, cv: open.inputs?.cv }} quantity={Number(open.quantity)} unitName={open.unit} energy={ENERGY_UNITS.has(open.unit)} />
            <Evidence activityId={open.id} />
          </div>
        )}
      </dialog>
    </div>
  );
}
