/**
 * Methodology & boundaries — consolidation approach as three cards with live
 * totals (operational control / financial control / equity share), the
 * facility table that drives them, GWP set and base year.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, tco2e, type ApprovalsData } from '../lib/api';
import { Prices } from '../components/Prices';
import { Restatements } from '../components/Restatements';

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
          <p className="sub">The year targets are measured from. Changes that must be reflected in it (acquisitions, sales, better methods, errors) are recorded under <a href="#restatements">Base year &amp; restatements</a> below.</p>
        </div>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Flights · radiative forcing</h2>
          <select className="input" disabled={!edit} value={tenant?.flight_rf === false ? 'no' : 'yes'} onChange={(e) => save({ flightRf: e.target.value === 'yes' }, e.target.value === 'yes' ? 'Flights now include radiative forcing' : 'Flights now exclude radiative forcing')}>
            <option value="yes">With radiative forcing — DESNZ recommendation</option><option value="no">Without radiative forcing (CO₂, CH₄, N₂O only)</option>
          </select>
          <p className="sub">Radiative forcing adds the warming effect of aircraft emissions at altitude (contrails, NOx), about 70% more than the fuel's CO₂e. Applies to new flight entries; each entry shows which was used.</p>
        </div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Reduction targets</h2>
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ width: 120 }}><span>Target year</span><input className="input num" inputMode="numeric" disabled={!edit} defaultValue={tenant?.target_year ?? 2030} key={`ty${tenant?.target_year}`} onBlur={(e) => Number(e.target.value) !== tenant?.target_year && void save({ targetYear: Number(e.target.value) }, `Target year ${e.target.value}`)} /></label>
            <label className="field" style={{ width: 140 }}><span>Scope 1+2 · % below base</span><input className="input num" inputMode="decimal" disabled={!edit} defaultValue={tenant?.target_s12 ?? 42} key={`t12${tenant?.target_s12}`} onBlur={(e) => Number(e.target.value) !== tenant?.target_s12 && void save({ targetS12: Number(e.target.value) }, `Scope 1+2 target −${e.target.value}%`)} /></label>
            <label className="field" style={{ width: 140 }}><span>Scope 3 · % below base</span><input className="input num" inputMode="decimal" disabled={!edit} defaultValue={tenant?.target_s3 ?? 25} key={`t3${tenant?.target_s3}`} onBlur={(e) => Number(e.target.value) !== tenant?.target_s3 && void save({ targetS3: Number(e.target.value) }, `Scope 3 target −${e.target.value}%`)} /></label>
          </div>
          <p className="sub">From the base year {tenant?.base_year ?? ''} along a straight line to the target year (SBTi 1.5 °C: about −42% Scope 1+2 by 2030 from a recent base year). Home and the KPI dashboard compare each month with this path.</p>
        </div>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <h2>Collection rules</h2>
          <div className="row" style={{ gap: 10 }}>
            <label className="field" style={{ width: 150 }}><span>Due day of next month</span><input className="input num" inputMode="numeric" disabled={!edit} defaultValue={tenant?.due_day ?? 10} key={`dd${tenant?.due_day}`} onBlur={(e) => Number(e.target.value) !== tenant?.due_day && void save({ dueDay: Number(e.target.value) }, `Data due on day ${e.target.value}`)} /></label>
            <label className="field" style={{ width: 150 }}><span>“Due soon” days before</span><input className="input num" inputMode="numeric" disabled={!edit} defaultValue={tenant?.remind_days ?? 3} key={`rd${tenant?.remind_days}`} onBlur={(e) => Number(e.target.value) !== tenant?.remind_days && void save({ remindDays: Number(e.target.value) }, 'Saved')} /></label>
            <label className="field" style={{ width: 150 }}><span>Escalated after days late</span><input className="input num" inputMode="numeric" disabled={!edit} defaultValue={tenant?.escalate_days ?? 7} key={`ed${tenant?.escalate_days}`} onBlur={(e) => Number(e.target.value) !== tenant?.escalate_days && void save({ escalateDays: Number(e.target.value) }, 'Saved')} /></label>
          </div>
          <p className="sub">A month’s data is due on this day of the following month. Home shows what is due, overdue and escalated for the categories each facility reports.</p>
        </div>
      </div>
      <Restatements />
      <ApprovalLevels edit={edit} />
      <Prices canEdit={['platform_admin', 'super_admin', 'admin'].includes(role)} />
      <div className="note info">Standards: GHG Protocol Corporate Standard; factors DESNZ (UK) 2022–2026 and IPCC 2006 where DESNZ has none; kWh on net calorific value unless entered as gross. Vehicles: DESNZ per km / mile by class and powertrain, or by fuel used; electricity for electric vehicles in Scope 2 (location-based grid factor of the facility's country).</div>
    </div>
  );
}

/** Approval levels (as in the prototype): level 1 always; level 2 optional, for large entries or chosen categories. */
function ApprovalLevels({ edit }: { edit: boolean }) {
  const { toast } = useApp();
  const [d, setD] = useState<ApprovalsData | null>(null);
  const [P, setP] = useState<{ l2: boolean; minT: string; cats: string[]; checkPct: string; selfApproval: boolean; selfMaxT: string } | null>(null);
  useEffect(() => { api.approvals().then((x) => { setD(x); setP({ l2: x.settings.l2, minT: String(x.settings.minT), cats: x.settings.cats, checkPct: String(x.settings.checkPct), selfApproval: !!x.settings.selfApproval, selfMaxT: x.settings.selfMaxT == null ? '' : String(x.settings.selfMaxT) }); }).catch(() => {}); }, []);
  if (!d || !P) return null;
  const groups = [...new Map(d.categories.map((c) => { const g = c.code.startsWith('waste_') ? 'waste' : c.code.startsWith('water_') ? 'water' : c.code; return [g, g === 'waste' ? 'Waste' : g === 'water' ? 'Water' : c.name] as [string, string]; })).entries()];
  const save = async () => {
    try { const r = await api.saveApprovalSettings({ l2: P.l2, minT: Math.max(0, Number(P.minT) || 0), cats: P.cats, checkPct: Math.max(1, Math.round(Number(P.checkPct) || 35)), selfApproval: P.selfApproval, selfMaxT: P.selfMaxT.trim() === '' ? null : Math.max(0, Number(P.selfMaxT) || 0) }); setD({ ...d, settings: r }); toast(r.l2 ? `Level 2 for entries of ${r.minT} t or more${r.cats.length ? ` and ${r.cats.length} categories` : ''}` : 'One approval level'); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h2>Approval levels</h2>
        <div className="soft"><b>Level 1 · checker</b><span className="muted" style={{ fontSize: 13 }}>The facility manager (or sub-group admin, or the super admin) approves or sends back each entry. Nobody approves their own entry.</span></div>
        <label className="row" style={{ gap: 8, fontSize: 13.5 }}><input type="checkbox" disabled={!edit} checked={P.l2} onChange={(e) => setP({ ...P, l2: e.target.checked })} /> <b>Add a level-2 approval</b> by a sub-group admin or the super admin (a different person from level 1)</label>
        <div style={{ opacity: P.l2 ? 1 : 0.5, display: 'grid', gap: 8 }}>
          <label className="field" style={{ width: 220 }}><span>For entries of at least (tCO₂e)</span><input className="input num" inputMode="decimal" disabled={!edit} value={P.minT} onChange={(e) => setP({ ...P, minT: e.target.value })} /></label>
          <div><span className="lbl">…or always for these categories</span>
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>{groups.map(([code, name]) => { const on = P.cats.includes(code); return (
              <label key={code} className={`chip ${on ? 'c-info' : 'c-n'}`} style={{ cursor: edit ? 'pointer' : 'default' }}><input type="checkbox" disabled={!edit} checked={on} style={{ marginRight: 4 }} onChange={() => setP({ ...P, cats: on ? P.cats.filter((x) => x !== code) : [...P.cats, code] })} />{name}</label>); })}</div></div>
        </div>
        {edit && <div><button className="btn p" onClick={() => void save()}>Save</button></div>}
      </div>
      <div className="card" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        <h2>Quantity check</h2>
        <label className="field" style={{ width: 220 }}><span>Flag entries more than ± % from usual</span><input className="input num" inputMode="numeric" disabled={!edit} value={P.checkPct} onChange={(e) => setP({ ...P, checkPct: e.target.value })} /></label>
        <p className="sub">Each entry waiting for approval is compared with the same item at the same facility over the 6 months before. Entries outside the limit are flagged in Approvals and on Home, and are left out of “Approve all without warnings”.</p>
        {edit && <div><button className="btn" onClick={() => void save()}>Save</button></div>}
      </div>
      <div className="card" style={{ display: 'grid', gap: 10, gridColumn: '1 / -1' }}>
        <h2>Self-approval</h2>
        <label className="row" style={{ gap: 8, fontSize: 13.5 }}><input type="checkbox" disabled={!edit} checked={P.selfApproval} onChange={(e) => setP({ ...P, selfApproval: e.target.checked })} />
          <b>Allow super admins, admins and managers to approve their own entries</b></label>
        <div style={{ opacity: P.selfApproval ? 1 : 0.5, display: 'grid', gap: 8 }}>
          <label className="field" style={{ width: 300 }}><span>…only below this size (tCO₂e; blank: any size)</span><input className="input num" inputMode="decimal" disabled={!edit || !P.selfApproval} value={P.selfMaxT} onChange={(e) => setP({ ...P, selfMaxT: e.target.value })} /></label>
        </div>
        <p className="sub">Off by default. When on, approving your own entry needs a note saying what it was checked against; the entry is marked <b>self-reviewed</b> on the entry, in the data-quality report ("segregation of duties") and in the verifier pack. Data preparers and platform staff never approve. Level 2, when it applies, is always a different person. Verifiers and frameworks expect an independent check (the BEEAH RFP asks for one): leave it off where that applies.</p>
        {edit && <div><button className="btn" onClick={() => void save()}>Save</button></div>}
      </div>
    </div>);
}
