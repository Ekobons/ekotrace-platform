/**
 * Methodology & boundaries — consolidation approach as three cards with live
 * totals (operational control / financial control / equity share), the
 * facility table that drives them, GWP set and base year.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, tco2e } from '../lib/api';
import { Prices } from '../components/Prices';

type Approach = 'operational' | 'financial' | 'equity';
const CARDS: [Approach, string, string][] = [
  ['operational', 'Operational control', '100 % of every facility the company runs day to day; nothing for the rest.'],
  ['financial', 'Financial control', '100 % of facilities it directs financially (gets most of the economic benefit).'],
  ['equity', 'Equity share', 'Its ownership % of every facility, whoever runs it.'],
];

export function Methodology() {
  const { can, tenant, reload, toast, role } = useApp();
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [b, setB] = useState<Awaited<ReturnType<typeof api.boundaries>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const edit = can('super_admin');
  const load = () => api.boundaries(year).then(setB);
  useEffect(() => { load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body: Record<string, unknown>, m: string) => {
    setErr(null);
    try { await api.updateTenant(body); await reload(); await load(); toast(m); } catch (e) { setErr((e as Error).message); }
  };
  const setFac = async (id: string, body: Record<string, unknown>) => {
    try { await api.updateNode(id, body); await load(); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Setup</div><h1>Methodology & boundaries</h1><p className="sub">How the company's inventory is drawn up (GHG Protocol Corporate Standard). {edit ? 'Only a Super admin can change it.' : 'Read-only for your role.'}</p></div>
        <label className="field"><span>Show totals for</span><select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[2022, 2023, 2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}</select></label>
      </div>
      {err && <div className="note bad">{err}</div>}

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h2>Consolidation approach</h2>
        <div className="cards3">
          {CARDS.map(([k, label, help]) => (
            <button key={k} className={`choice ${b?.current === k ? 'on' : ''}`} disabled={!edit} onClick={() => save({ consolidation: k }, `Now using ${label.toLowerCase()}`)}>
              <span className="row" style={{ justifyContent: 'space-between' }}><b>{label}</b>{b?.current === k && <span className="chip">in use</span>}</span>
              <b className="big">{b ? tco2e(b.totals[k]) : '…'}</b>
              <small className="sub">tCO₂e Scope 1 in {year}</small>
              <small className="sub">{help}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h2>Facilities in the boundary</h2><p className="sub">Tick who controls each facility and the ownership share; the totals above follow.</p></div>
        <table className="t">
          <thead><tr><th>Facility</th><th>Sub-group</th><th>Operational control</th><th>Financial control</th><th className="num">Ownership %</th><th className="num">Scope 1 tCO₂e (100 %)</th></tr></thead>
          <tbody>{b?.facilities.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td><td className="sub">{f.parent_name}</td>
              <td><input type="checkbox" disabled={!edit} checked={f.operational_control} onChange={(e) => setFac(f.id, { operationalControl: e.target.checked })} /></td>
              <td><input type="checkbox" disabled={!edit} checked={f.financial_control} onChange={(e) => setFac(f.id, { financialControl: e.target.checked })} /></td>
              <td className="num">{edit
                ? <input className="input num" style={{ width: 80, height: 30 }} defaultValue={f.ownership_pct} onBlur={(e) => Number(e.target.value) !== Number(f.ownership_pct) && setFac(f.id, { ownershipPct: Number(e.target.value) })} />
                : `${f.ownership_pct} %`}</td>
              <td className="num">{tco2e(Number(f.co2e_direct))}</td>
            </tr>))}
          </tbody>
        </table>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Global warming potentials</h2>
          <select className="input" disabled={!edit} value={tenant?.gwp_set} onChange={(e) => save({ gwpSet: e.target.value }, `Now reporting in ${e.target.value}`)}>
            <option value="AR4">AR4 (IPCC 2007)</option><option value="AR5">AR5 (IPCC 2014) — UNFCCC standard, used by DESNZ</option><option value="AR6">AR6 (IPCC 2021) — latest</option>
          </select>
          <p className="sub">Applies to new calculations. Saved entries keep the set they were calculated with, shown on each entry.</p>
        </div>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Base year</h2>
          <select className="input" disabled={!edit} value={tenant?.base_year} onChange={(e) => save({ baseYear: Number(e.target.value) }, `Base year set to ${e.target.value}`)}>
            {[2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
          </select>
          <p className="sub">The year targets are measured from. Restatements (when the base year must be recalculated) come with the targets module.</p>
        </div>
      </div>
      <Prices canEdit={['platform_admin', 'super_admin', 'admin'].includes(role)} />
      <div className="note info">Standards: GHG Protocol Corporate Standard; factors DESNZ (UK) 2022–2026 and IPCC 2006 where DESNZ has none; kWh on net calorific value unless entered as gross. Vehicles: DESNZ per km / mile by class and powertrain, or by fuel used; electricity for electric vehicles in Scope 2 (location-based grid factor of the facility's country).</div>
    </div>
  );
}
