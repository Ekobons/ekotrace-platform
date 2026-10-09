/**
 * Entries & results: everything saved for the company, a summary per gas,
 * and a drawer showing exactly how each entry was calculated.
 */
import { useEffect, useRef, useState } from 'react';
import { api, BASIS_LABEL, num, tco2e, type Activity } from '../lib/api';
import { Result } from '../components/Result';
import { Icon } from '../components/Icon';
import { GasToggle, useGasSplit } from '../components/GasToggle';

export function Entries() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Activity[]>([]);
  const [gas, setGas] = useState<Awaited<ReturnType<typeof api.byGas>>['rows']>([]);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof api.activity>> | null>(null);
  const [showGas, toggleGas] = useGasSplit();
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    api.activities({ year, limit: 1000 }).then((r) => setRows(r.activities));
    api.byGas(year).then((r) => setGas(r.rows));
  }, [year]);

  const sum = (k: keyof Activity) => rows.reduce((s, a) => s + Number(a[k]), 0);
  const show = async (id: string) => { setOpen(await api.activity(id)); dlg.current?.showModal(); };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture</div><h1>Entries & results</h1><p className="sub">Everything saved for this company. Click an entry to see how it was calculated.</p></div>
        <label className="field"><span>Year</span>
          <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2022, 2023, 2024, 2025, 2026, 2027].map((y) => <option key={y}>{y}</option>)}</select>
        </label>
      </div>

      <div className="total">
        <div className="stat s1"><small>Scope 1</small><b>{tco2e(sum('co2e_direct'))}</b><small>tCO₂e</small></div>
        <div className="stat s3"><small>Well-to-tank (Scope 3.3)</small><b>{tco2e(sum('co2e_wtt'))}</b><small>tCO₂e</small></div>
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
              <thead><tr><th>Period</th><th>Facility</th><th>Category</th><th>Item</th><th className="num">Quantity</th><th className="num">Scope 1 tCO₂e</th><th className="num">WTT</th><th>GWP</th><th>Type</th></tr></thead>
              <tbody>{rows.map((a) => (
                <tr key={a.id} className="click" onClick={() => show(a.id)}>
                  <td>{a.period_start.slice(0, 7)}</td><td>{a.facility}</td><td>{a.category}</td><td>{a.item}</td>
                  <td className="num">{num(a.quantity)} {a.unit}</td><td className="num">{tco2e(a.co2e_direct)}</td><td className="num">{tco2e(a.co2e_wtt)}</td>
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
            <div className="row"><div className="grow"><div className="eyebrow">Entry · {open.period_start} to {open.period_end}</div><h2>{open.item}</h2></div>
              <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
            <div className="sub">{num(open.quantity)} {open.unit} · {open.data_type} · saved {new Date(open.created_at).toLocaleString()}</div>
            <Result r={{ gwpSet: open.gwp_set, totals: { direct: Number(open.co2e_direct), wtt: Number(open.co2e_wtt), outside_scopes: Number(open.co2_biogenic), memo: Number(open.co2e_memo) },
              lines: open.lines.map((l) => ({ basis: l.basis, gas: l.gas, kgGas: l.kg_gas, kgCo2e: l.kg_co2e, method: l.method, source: l.source })), steps: open.steps, warnings: open.warnings, factors: open.factors }} quantity={Number(open.quantity)} unitName={open.unit} />
          </div>
        )}
      </dialog>
    </div>
  );
}
