/**
 * Entries & results: everything saved for the company, a summary per gas,
 * and a drawer showing exactly how each entry was calculated.
 */
import { useEffect, useRef, useState } from 'react';
import { unitLabel, api, BASIS_LABEL, num, tco2e, type Activity } from '../lib/api';
import { useApp } from '../App';
import { ENERGY_UNITS, Result } from '../components/Result';
import { Icon } from '../components/Icon';
import { GasToggle, useGasSplit } from '../components/GasToggle';

export function Entries() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Activity[]>([]);
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
    api.activities({ year, limit: 1000 }).then((r) => setRows(r.activities));
    api.byGas(year).then((r) => setGas(r.rows));
  }, [year, reload]);

  const sum = (k: keyof Activity) => rows.reduce((s, a) => s + Number(a[k] ?? 0), 0);
  const show = async (id: string) => { setOpen(await api.activity(id)); dlg.current?.showModal(); };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture</div><h1>Entries & results</h1><p className="sub">Everything saved for this company. Click an entry to see how it was calculated.</p></div>
        {canRecalc && <button className="btn sm" style={{ alignSelf: 'flex-end' }} title="Recalculate entries that have a warning (e.g. a missing grid factor or next year's factors not yet loaded)" onClick={() => recalc({ year, onlyWithWarnings: true })}>Recalculate entries with warnings</button>}
        <label className="field"><span>Year</span>
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2022, 2023, 2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}</select>
        </label>
      </div>

      <div className="total">
        <div className="stat s1"><small>Scope 1</small><b>{tco2e(sum('co2e_direct'))}</b><small>tCO₂e</small></div>
        <div className="stat s2"><small>Scope 2 · location-based</small><b>{tco2e(sum('co2e_scope2'))}</b><small>tCO₂e</small></div>
        <div className="stat s2m"><small>Scope 2 · market-based</small><b>{tco2e(sum('co2e_scope2_market'))}</b><small>tCO₂e</small></div>
        <div className="stat s3"><small>Scope 3.3 · upstream + T&D losses</small><b>{tco2e(sum('co2e_wtt') + sum('co2e_td'))}</b><small>tCO₂e</small></div>
        <div className="stat bio"><small>Biogenic CO₂ (outside scopes)</small><b>{tco2e(sum('co2_biogenic'))}</b><small>tCO₂</small></div>
        <div className="stat memo"><small>Memo: non-Kyoto gases</small><b>{tco2e(sum('co2e_memo'))}</b><small>tCO₂e</small></div>
      </div>

      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px 10px' }}>
          <div className="grow"><h2>By greenhouse gas · {year}</h2><p className="sub">Each gas in kg and in CO₂e. Totals given by a source without a gas split appear as “CO2e”.</p></div>
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
        <div style={{ padding: '14px 16px 6px' }}><h2>Entries · {rows.length}</h2></div>
        {rows.length ? (
          <div className="scroll">
            <table className="t">
              <thead><tr><th>Period</th><th>Facility</th><th>Category</th><th>Item</th><th className="num">Quantity</th><th className="num">Scope 1 tCO₂e</th><th className="num">Scope 2 loc.</th><th className="num">Scope 2 mkt.</th><th className="num">Scope 3.3</th><th>GWP</th><th>Type</th></tr></thead>
              <tbody>{rows.map((a) => (
                <tr key={a.id} className="click" onClick={() => show(a.id)}>
                  <td>{a.period_start.slice(0, 7)}</td><td>{a.facility}</td><td>{a.category}</td><td>{a.vehicle ? <><b>{a.vehicle}</b> · </> : null}{a.item}</td>
                  <td className="num">{num(a.quantity)} {unitLabel(a.unit)}</td><td className="num">{tco2e(a.co2e_direct)}</td><td className="num">{tco2e(Number(a.co2e_scope2 ?? 0))}</td><td className="num">{tco2e(Number(a.co2e_scope2_market ?? 0))}</td><td className="num">{tco2e(Number(a.co2e_wtt) + Number(a.co2e_td ?? 0))}</td>
                  <td>{a.gwp_set}</td><td><span className="chip grey">{a.data_type}</span></td>
                </tr>))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No entries for {year}.</div>}
      </div>

      <dialog ref={dlg} className="drawer" onClose={() => setOpen(null)}>
        {open && (
          <div className="in">
            <div className="row"><div className="grow"><div className="eyebrow">Entry · {open.period_start} to {open.period_end}</div><h2>{open.vehicle ? `${open.vehicle} · ` : ''}{open.item}</h2></div>
              <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
            <div className="row"><div className="sub grow">{num(open.quantity)} {open.unit} · {open.data_type} · saved {new Date(open.created_at).toLocaleString()}</div>
              {canRecalc && <button className="btn ghost sm" onClick={() => recalc({ ids: [open.id], onlyWithWarnings: false })}>Recalculate</button>}</div>
            <Result r={{ gwpSet: open.gwp_set, totals: { direct: Number(open.co2e_direct), scope2: Number(open.co2e_scope2 ?? 0), scope2_market: Number(open.co2e_scope2_market ?? 0), td_loss: Number(open.co2e_td ?? 0), wtt: Number(open.co2e_wtt), outside_scopes: Number(open.co2_biogenic), memo: Number(open.co2e_memo) },
              lines: open.lines.map((l) => ({ basis: l.basis, gas: l.gas, kgGas: l.kg_gas, kgCo2e: l.kg_co2e, method: l.method, source: l.source })), steps: open.steps, warnings: open.warnings, factors: open.factors, cv: open.inputs?.cv }} quantity={Number(open.quantity)} unitName={open.unit} energy={ENERGY_UNITS.has(open.unit)} />
          </div>
        )}
      </dialog>
    </div>
  );
}
