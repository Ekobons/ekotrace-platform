/**
 * Energy management & savings (Net zero → Energy management, or its own menu without the GHG inventory).
 *   Portfolio  every site's year: energy by carrier, kWh/m², EnPI against the baseline, avoided energy and cost, flags
 *   Site       one site: actual against the baseline model (IPMVP Option C) with CUSUM; months with variables and
 *              typed energy; the model and its quality (ASHRAE Guideline 14); measures; energy review (ISO 50001 SEUs)
 *   Measures   the register of energy-saving measures with expected and verified savings, payback and NPV
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import { BarList, MonthColumns, PALETTE } from '../components/Charts';
import {
  CARRIERS, enApi, lastYear,
  type Carrier, type Detail, type Measure, type MeasureBody, type MonthBody, type Overview, type Seu, type SeuBody, type Site, type SiteBody, type Variable,
} from '../lib/energyMgmt';

const f0 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 0 }));
const f1 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const mwh = (kwh: number | null | undefined) => (kwh == null ? '—' : (kwh / 1000).toLocaleString('en-US', { maximumFractionDigits: kwh >= 1e6 ? 0 : 1 }));
const pc = (x: number | null | undefined) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const okNum = (v: string) => v.trim() === '' || Number.isFinite(Number(v.replace(/,/g, '')));
const parse = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
const s = (x: number | null | undefined) => (x == null ? '' : String(x));
const COLORS: Record<Carrier, string> = { electricity: PALETTE[0]!, fuel: PALETTE[2]!, heat: PALETTE[5]!, cooling: PALETTE[3]!, transport: PALETTE[6]! };
const VARS: Variable[] = ['production', 'cdd', 'hdd', 'occupancy'];
const STATUS: Record<Measure['status'], [string, string]> = { idea: ['grey', 'Idea'], approved: ['info', 'Approved'], implemented: ['', 'Implemented'], verified: ['', 'Verified'], dropped: ['grey', 'Dropped'] };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function EnergyMgmt() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const year = sp.get('y') ? Number(sp.get('y')) : lastYear();
  const tab = sp.get('tab') ?? 'portfolio';
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const reload = () => setTick((x) => x + 1);
  useEffect(() => { let live = true; setO((x) => (x && x.year === year ? x : null)); enApi.overview(year).then((x) => { if (live) setO(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <div className="page"><div className="card empty">Loading…</div></div>;
  const sid = sp.get('s') ?? o.sites[0]?.id ?? null;
  const open = (id: string) => { const n = new URLSearchParams(sp); n.set('tab', 'site'); n.set('s', id); setSp(n, { replace: true }); };
  const years = [...new Set([year, lastYear(), lastYear() + 1, lastYear() - 1, lastYear() - 2])].sort((a, b) => b - a);
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Net zero · Energy</span><h1>Energy management</h1>
          <div className="muted">Energy use by site and carrier, baselines adjusted for weather and production (IPMVP Option C), savings and their cost, energy performance indicators (ISO 50001), energy-saving measures with payback, and the energy review.</div></div>
        <label className="field" style={{ minWidth: 110 }}><span>Year</span><select className="input" value={year} onChange={(e) => set('y', e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button className="btn" onClick={() => enApi.exportAll(year).catch((e) => toast((e as Error).message))}><Icon name="download" /> Portfolio (Excel)</button>
        {o.canSetup && <button className="btn p" onClick={() => setAdding(true)}>+ Site</button>}
      </div>
      <div className="seg strong" role="tablist" style={{ margin: '4px 0 12px' }}>
        {([['portfolio', 'Portfolio'], ['site', `Site${o.sites.length ? ` · ${o.sites.length}` : ''}`], ['measures', `Measures${o.measures.length ? ` · ${o.measures.length}` : ''}`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'portfolio' ? null : k)}>{l}</button>))}
      </div>
      {!o.sites.length ? (
        <div className="card" style={{ padding: 24 }}><h3 style={{ marginTop: 0 }}>No site in the energy programme yet</h3>
          <p className="muted" style={{ maxWidth: 760 }}>Add each site you manage energy for: its type and floor area, the baseline year, the variables that drive its energy (production, cooling degree days…) and its tariffs. {o.ekotrace ? 'Link it to an inventory facility and its energy comes from the approved entries.' : 'Its energy is typed month by month.'}</p>
          {o.canSetup && <button className="btn p" onClick={() => setAdding(true)}>+ Add a site</button>}</div>
      ) : tab === 'portfolio' ? <Portfolio o={o} open={open} />
        : tab === 'site' && sid ? <SiteTab key={`${sid}:${year}`} o={o} id={sid} year={year} pick={(x) => set('s', x)} onChanged={reload} />
          : <MeasuresTab o={o} onSaved={reload} />}
      {adding && <SiteDrawer o={o} site={null} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); if (id) open(id); reload(); }} />}
    </div>);
}

// ------------------------------------------------------------------------------------------ portfolio --
function Portfolio({ o, open }: { o: Overview; open: (id: string) => void }) {
  const total = o.sites.reduce((a, x) => a + x.year.total, 0), prior = o.sites.reduce((a, x) => a + (x.year.priorTotal ?? 0), 0);
  const saving = o.sites.reduce((a, x) => a + (x.year.saving ?? 0), 0), saveCost = o.sites.reduce((a, x) => a + (x.year.savingCost ?? 0), 0), saveT = o.sites.reduce((a, x) => a + (x.year.savingT ?? 0), 0);
  const cost = o.sites.reduce((a, x) => a + (x.year.cost ?? 0), 0);
  const flagged = o.sites.filter((x) => x.year.anomalies > 0).length;
  const series = CARRIERS.filter((k) => o.monthly.some((m) => m[k])).map((k) => ({ key: k, label: o.carriers[k], color: COLORS[k] }));
  const data = o.monthly.map((m, i) => ({ m: i + 1, ...Object.fromEntries(CARRIERS.map((k) => [k, m[k]])) }));
  const eui = o.sites.filter((x) => x.year.eui != null);
  return (
    <>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Energy, {o.year}</span><b>{mwh(total)} <small className="muted">MWh</small></b>
          <span className="muted small">{prior ? `${pc((total - prior) / prior)} on the same months of ${o.year - 1}` : 'No comparison year'}</span></div>
        <div className="card kpi"><span className="muted small">Energy cost</span><b>{f0(cost || null)} <small className="muted">{o.currency}</small></b><span className="muted small">At the sites' tariffs</span></div>
        <div className="card kpi"><span className="muted small">Avoided against the baselines</span><b>{mwh(saving || null)} <small className="muted">MWh</small></b>
          <span className="muted small">{saveCost ? `${f0(saveCost)} ${o.currency}` : '—'} · {saveT ? `${f1(saveT)} tCO₂e` : '—'} · weather- and production-adjusted</span></div>
        <div className="card kpi"><span className="muted small">Sites with flagged months</span><b>{flagged} <small className="muted">of {o.sites.length}</small></b><span className="muted small">Off the model by more than 2 standard errors and 5%</span></div>
      </div>
      <div className="ccgrid" style={{ marginTop: 12 }}>
        <div className="card"><h3 style={{ margin: '0 0 4px' }}>Energy by month and carrier, MWh</h3><MonthColumns data={data} series={series} format={(v) => mwh(v)} unit="MWh" /></div>
        <div className="card"><h3 style={{ margin: '0 0 6px' }}>Energy use intensity, kWh/m² a year</h3>
          {eui.length ? <BarList rows={eui.sort((a, b) => b.year.eui! - a.year.eui!).map((x) => ({ key: x.id, label: x.name, sub: o.siteTypes[x.siteType], value: x.year.eui!, onClick: () => open(x.id) }))} format={(v) => f0(v)} unit="kWh/m²" />
            : <div className="muted small">Needs a full year of energy and the floor area.</div>}</div>
      </div>
      <div className="card flush" style={{ marginTop: 12 }}>
        <div className="scrollx"><table className="t">
          <thead><tr><th>Site</th><th className="num">Months</th><th className="num">MWh</th><th className="num">EnPI vs baseline</th><th className="num">Avoided MWh</th><th className="num">Avoided {o.currency}</th><th className="ctr">Model</th><th>Target</th><th className="num">Flags</th></tr></thead>
          <tbody>{o.sites.map((x) => (
            <tr key={x.id} className="click" style={{ cursor: 'pointer' }} onClick={() => open(x.id)}>
              <td><b>{x.name}</b><div className="muted small">{o.siteTypes[x.siteType]}{x.baselineYear ? ` · baseline ${x.baselineYear}` : ''}</div></td>
              <td className="num">{x.year.monthsIn}</td><td className="num">{mwh(x.year.total)}</td>
              <td className="num">{x.year.enpiChange == null ? '—' : <span className={x.year.enpiChange <= 0 ? 'ok-t' : 'warn-t'}>{pc(x.year.enpiChange)}</span>}</td>
              <td className="num">{x.year.saving == null ? '—' : mwh(x.year.saving)}</td><td className="num">{f0(x.year.savingCost)}</td>
              <td className="ctr">{x.year.modelValid == null ? <span className="muted">—</span> : <span className={`chip ${x.year.modelValid ? '' : 'warn'}`} title={x.year.cvrmse != null ? `CV(RMSE) ${x.year.cvrmse.toFixed(1)}%` : undefined}>{x.year.modelValid ? 'G14 ✓' : 'Indicative'}</span>}</td>
              <td className="small">{x.year.target ? <span className={x.year.target.onTrack ? 'ok-t' : 'warn-t'}>−{x.year.target.pct}% by {x.year.target.year}{x.year.target.onTrack == null ? '' : x.year.target.onTrack ? ' · on track' : ' · behind'}</span> : '—'}</td>
              <td className="num">{x.year.anomalies ? <span className="warn-t">{x.year.anomalies}</span> : <span className="muted">0</span>}</td></tr>))}</tbody>
        </table></div>
      </div>
    </>);
}

// ------------------------------------------------------------------------------------------------ site --
function SiteTab({ o, id, year, pick, onChanged }: { o: Overview; id: string; year: number; pick: (id: string) => void; onChanged: () => void }) {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const sub = sp.get('v') ?? 'months';
  const setSub = (v: string) => { const n = new URLSearchParams(sp); if (v === 'months') n.delete('v'); else n.set('v', v); setSp(n, { replace: true }); };
  const [d, setD] = useState<Detail | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const reload = () => { setTick((x) => x + 1); onChanged(); };
  useEffect(() => { let live = true; enApi.detail(id, year).then((x) => { if (live) setD(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [id, year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  const S = d.site, M = d.model;
  const unit = S.enpiVar === 'floor' ? 'm²' : S.enpiVar === 'production' ? S.productionUnit ?? 'unit' : S.enpiVar ? o.variables[S.enpiVar] : null;
  return (
    <>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="field" style={{ minWidth: 260 }}><span>Site</span><select className="input" value={id} onChange={(e) => pick(e.target.value)}>{o.sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <span className="grow" />
        <button className="btn" onClick={() => enApi.exportSite(id, year, S.name).catch((e) => toast((e as Error).message))}><Icon name="download" /> M&amp;V report (Excel)</button>
        {d.canSetup && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Site &amp; model</button>}
      </div>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Energy, {year}</span><b>{mwh(d.total)} <small className="muted">MWh</small></b>
          <span className="muted small">{CARRIERS.filter((k) => d.totals[k]).map((k) => `${o.carriers[k]} ${mwh(d.totals[k])}`).join(' · ') || 'No energy yet'}{d.cost != null ? ` · ${f0(d.cost)} ${o.currency}` : ''}</span></div>
        <div className="card kpi"><span className="muted small">EnPI{unit ? `, kWh per ${unit}` : ''}</span><b>{d.enpi == null ? '—' : f1(d.enpi)}</b>
          <span className="muted small">{d.enpiChange == null ? (S.enpiVar ? 'No baseline to compare' : 'Choose an EnPI driver') : `${pc(d.enpiChange)} vs ${d.base}`}{d.target ? ` · target −${d.target.pct}% by ${d.target.year} (${f1(d.target.enpi)})${d.target.onTrack == null ? '' : d.target.onTrack ? ', on track' : ', behind'}` : ''}</span></div>
        <div className="card kpi"><span className="muted small">Avoided against the baseline</span><b>{d.saving == null ? '—' : mwh(d.saving)} <small className="muted">MWh</small></b>
          <span className="muted small">{d.savedMonths} months · {d.savingCost != null ? `${f0(d.savingCost)} ${o.currency}` : '—'} · {d.savingT != null ? `${f1(d.savingT)} tCO₂e` : '—'}</span></div>
        <div className="card kpi"><span className="muted small">Baseline model ({d.base ?? 'no baseline'})</span><b style={{ fontSize: 18 }}>{!M ? '—' : M.valid ? 'Meets Guideline 14' : 'Indicative'}</b>
          <span className="muted small">{M?.coef.length ? `R² ${M.r2?.toFixed(2) ?? '—'} · CV(RMSE) ${M.cvrmse?.toFixed(1)}% · NMBE ${M.nmbe?.toFixed(2)}%` : 'Needs 9+ baseline months'}</span></div>
      </div>
      {d.problems.length > 0 && <div className="note warn small" style={{ marginTop: 10 }}>{d.problems.map((p, i) => <div key={i}>{p}</div>)}</div>}
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ margin: '0 0 2px' }}>{S.modelTarget === 'total' ? 'Total energy' : o.carriers[S.modelTarget]}: actual and expected, {year}</h3>
        <div className="muted small">Bars: actual kWh (amber when flagged). Line: what the baseline model expects with this year's variables. Dashed: cumulative avoided energy (CUSUM).</div>
        <SavingsChart d={d} />
      </div>
      <div className="seg" role="tablist" style={{ margin: '12px 0' }}>
        {([['months', 'Months'], ['model', 'Baseline model'], ['measures', `Measures (${d.measures.length})`], ['seu', `Energy review (${d.seus.length})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>))}
      </div>
      {sub === 'months' && <MonthsGrid key={`${d.site.id}:${tick}`} o={o} d={d} onSaved={reload} />}
      {sub === 'model' && <ModelCard o={o} d={d} />}
      {sub === 'measures' && <MeasureList o={o} list={d.measures} sites={[S]} canEdit={d.canMeasures} onSaved={reload} />}
      {sub === 'seu' && <SeuList o={o} d={d} onSaved={reload} />}
      {editing && <SiteDrawer o={o} site={S} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </>);
}

function SavingsChart({ d }: { d: Detail }) {
  const W = 760, H = 230, L = 52, R = 52, T = 10, B = 24, cw = (W - L - R) / 12;
  const top = Math.max(1, ...d.months.map((m) => Math.max(m.actual ?? 0, m.expected ?? 0))) * 1.08;
  const cus = d.months.map((m) => m.cusum).filter((x): x is number => x != null);
  const cMax = Math.max(1, ...cus.map(Math.abs));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const yc = (v: number) => T + (H - T - B) * (0.5 - v / (2 * cMax));
  const xm = (i: number) => L + i * cw + cw / 2;
  const line = (pts: [number, number | null][]) => pts.filter((p) => p[1] != null).map((p, k) => `${k ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} role="img" aria-label="Actual and expected energy by month">
        {[0, top / 2, top].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="gridline" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="axis">{mwh(v)}</text></g>)}
        {cus.length > 0 && <><text x={W - R + 6} y={yc(cMax) + 4} className="axis">{mwh(cMax)}</text><text x={W - R + 6} y={yc(0) + 4} className="axis">0</text><text x={W - R + 6} y={yc(-cMax) + 4} className="axis">−{mwh(cMax)}</text></>}
        {d.months.map((m, i) => (
          <g key={m.month}>
            {m.actual != null && <rect x={L + i * cw + cw * 0.2} width={cw * 0.6} y={y(m.actual)} height={Math.max(0.5, y(0) - y(m.actual))} rx={2} fill={m.anomaly ? 'var(--warn)' : 'var(--primary)'} opacity={0.85}><title>{`${MON[i]}: actual ${mwh(m.actual)} MWh${m.expected != null ? `, expected ${mwh(m.expected)} MWh` : ''}${m.anomaly ? ` — ${m.anomaly}` : ''}`}</title></rect>}
            <text x={xm(i)} y={H - 6} textAnchor="middle" className="axis">{MON[i]}</text>
          </g>))}
        <path d={line(d.months.map((m, i) => [xm(i), m.expected == null ? null : y(m.expected)]))} fill="none" stroke="var(--ink, #10302A)" strokeWidth={2} />
        {d.months.map((m, i) => (m.expected != null ? <circle key={i} cx={xm(i)} cy={y(m.expected)} r={2.6} fill="var(--ink, #10302A)" /> : null))}
        <path d={line(d.months.map((m, i) => [xm(i), m.cusum == null ? null : yc(m.cusum)]))} fill="none" stroke={PALETTE[2]} strokeWidth={2} strokeDasharray="5 4" />
      </svg>
      <figcaption className="legend"><span><i style={{ background: 'var(--primary)' }} />Actual</span><span><i style={{ background: 'var(--ink, #10302A)' }} />Expected (baseline model)</span><span><i style={{ background: PALETTE[2] }} />CUSUM avoided (right axis)</span><span><i style={{ background: 'var(--warn)' }} />Flagged month</span></figcaption>
    </figure>);
}

function MonthsGrid({ o, d, onSaved }: { o: Overview; d: Detail; onSaved: () => void }) {
  const { toast } = useApp();
  const shown = CARRIERS.filter((k) => k === 'electricity' || d.months.some((m) => m.energy[k] != null));
  const vars = VARS.filter((v) => v === 'cdd' || d.site.modelVars.includes(v) || d.site.enpiVar === v || d.months.some((m) => m[v] != null));
  const init = () => d.months.map((m) => ({
    month: m.month, note: m.note, ...Object.fromEntries(vars.map((v) => [v, s(m[v])])),
    ...Object.fromEntries(shown.map((k) => [`e_${k}`, m.source[k] === 'typed' ? s(m.energy[k]) : ''])),
  })) as Record<string, string>[];
  const [rows, setRows] = useState(init);
  const orig = useRef(JSON.stringify(init()));
  const dirty = JSON.stringify(rows) !== orig.current;
  const ok = rows.every((r) => Object.entries(r).every(([k, v]) => k === 'month' || k === 'note' || okNum(v)));
  const up = (i: number, k: string, v: string) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const paste = (i: number, k: string, text: string) => {
    const vals = text.split(/\r?\n/).map((x) => x.split('\t')[0]!.trim()).filter((x) => x !== '');
    if (vals.length < 2) return false;
    setRows((x) => x.map((r, j) => (j >= i && j - i < vals.length ? { ...r, [k]: vals[j - i]!.replace(/,/g, '') } : r)));
    return true;
  };
  const save = async () => {
    const body: MonthBody[] = rows.map((r, i) => {
      const m = d.months[i]!;
      const energy: Partial<Record<Carrier, number | null>> = {};
      for (const k of CARRIERS) energy[k] = shown.includes(k) ? parse(r[`e_${k}`] ?? '') : m.source[k] === 'typed' ? m.energy[k] ?? null : null;
      return { month: r.month!, note: (r.note ?? '').trim(), production: vars.includes('production') ? parse(r.production ?? '') : m.production, cdd: vars.includes('cdd') ? parse(r.cdd ?? '') : m.cdd, hdd: vars.includes('hdd') ? parse(r.hdd ?? '') : m.hdd, occupancy: vars.includes('occupancy') ? parse(r.occupancy ?? '') : m.occupancy, energy };
    });
    try { await enApi.months(d.site.id, body); toast('Saved'); onSaved(); } catch (e) { toast((e as Error).message); }
  };
  const unitOf = (v: Variable) => (v === 'production' ? d.site.productionUnit ?? '' : v === 'occupancy' ? 'FTE' : '°C·days');
  return (
    <div className="card flush">
      <div className="row vfilters"><div className="grow"><b>Months, {d.year}</b>
        <div className="muted small">{d.ekotrace && d.site.nodeId ? 'Energy in grey comes from the approved entries; type a figure to replace it for that month.' : 'Type the energy of each month in kWh.'} Paste a column from Excel into the first month to fill downwards. Degree days from a weather service (base 18 °C is common in the Gulf).</div></div>
        {d.canData && <button className="btn p" disabled={!dirty || !ok} onClick={save}>{dirty ? 'Save' : 'Saved'}</button>}</div>
      <div className="scrollx"><table className="t small">
        <thead><tr><th>Month</th>{shown.map((k) => <th key={k} className="num">{o.carriers[k]}<div className="muted" style={{ fontWeight: 400 }}>kWh</div></th>)}
          {vars.map((v) => <th key={v} className="num">{o.variables[v]}<div className="muted" style={{ fontWeight: 400 }}>{unitOf(v)}</div></th>)}
          <th className="num">Expected</th><th className="num">Avoided</th><th>Flag / note</th></tr></thead>
        <tbody>{rows.map((r, i) => {
          const m = d.months[i]!;
          return (
            <tr key={r.month}>
              <td className="nowrap">{MON[i]} {d.year}</td>
              {shown.map((k) => <td key={k}><input className="input sm num" style={{ width: 120 }} inputMode="decimal" aria-label={`${o.carriers[k]} ${MON[i]}`} disabled={!d.canData}
                placeholder={m.source[k] === 'entries' ? f0(m.energy[k]) : ''} value={r[`e_${k}`] ?? ''} onChange={(e) => up(i, `e_${k}`, e.target.value)} onPaste={(e) => { if (paste(i, `e_${k}`, e.clipboardData.getData('text'))) e.preventDefault(); }} /></td>)}
              {vars.map((v) => <td key={v}><input className="input sm num" style={{ width: 96 }} inputMode="decimal" aria-label={`${o.variables[v]} ${MON[i]}`} disabled={!d.canData}
                value={r[v] ?? ''} onChange={(e) => up(i, v, e.target.value)} onPaste={(e) => { if (paste(i, v, e.clipboardData.getData('text'))) e.preventDefault(); }} /></td>)}
              <td className="num">{f0(m.expected)}</td><td className="num">{m.saving == null ? '—' : <span className={m.saving >= 0 ? 'ok-t' : 'warn-t'}>{f0(m.saving)}</span>}</td>
              <td>{m.anomaly && <div className="warn-t small">{m.anomaly}</div>}<input className="input sm" style={{ minWidth: 160 }} disabled={!d.canData} value={r.note ?? ''} placeholder="note" onChange={(e) => up(i, 'note', e.target.value)} /></td>
            </tr>);
        })}</tbody>
      </table></div>
    </div>);
}

function ModelCard({ o, d }: { o: Overview; d: Detail }) {
  const M = d.model, S = d.site;
  if (!M) return <div className="card"><p className="muted">{S.baselineYear ? `The baseline year (${S.baselineYear}) must be before ${d.year}.` : 'Choose a baseline year under Site & model.'}</p></div>;
  const r = (x: number | null | undefined, dp = 2) => (x == null ? '—' : x.toFixed(dp));
  return (
    <div className="ccgrid">
      <div className="card"><h3 style={{ margin: '0 0 8px' }}>Baseline model, {d.base}</h3>
        <div className="note info small" style={{ fontFamily: 'var(--mono, monospace)' }}>{M.coef.length ? `kWh = ${f0(M.coef[0])}${M.vars.map((v, i) => ` + ${r(M.coef[i + 1], 3)} × ${o.variables[v]}`).join('')}` : 'No model yet'}</div>
        <table className="t small"><tbody>
          <tr><td className="muted">Energy modelled</td><td>{S.modelTarget === 'total' ? 'Total energy' : o.carriers[S.modelTarget]}</td></tr>
          <tr><td className="muted">Months used</td><td>{M.n}</td></tr>
          <tr><td className="muted">R²</td><td>{r(M.r2, 3)}</td></tr>
          <tr><td className="muted">CV(RMSE)</td><td>{r(M.cvrmse)}% <span className="muted">(≤ 15%)</span></td></tr>
          <tr><td className="muted">NMBE</td><td>{r(M.nmbe)}% <span className="muted">(within ±5%)</span></td></tr>
          <tr><td className="muted">Standard error</td><td>{f0(M.se)} kWh</td></tr>
          {M.vars.map((v, i) => <tr key={v}><td className="muted">t-statistic, {o.variables[v]}</td><td>{r(M.t[i + 1])} <span className="muted">(|t| ≥ 2)</span></td></tr>)}
        </tbody></table>
        <div style={{ marginTop: 8 }}><span className={`chip ${M.valid ? '' : 'warn'}`}>{M.valid ? 'Meets ASHRAE Guideline 14' : 'Indicative only'}</span></div>
        {M.problems.length > 0 && <div className="note warn small" style={{ marginTop: 8 }}>{M.problems.map((p, i) => <div key={i}>{p}</div>)}</div>}</div>
      <div className="card"><h3 style={{ margin: '0 0 8px' }}>How savings are worked out</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>IPMVP Option C (whole facility): the model is fitted on the baseline year's months by least squares.</li>
          <li>Each month of {d.year}, the model gives the energy the site would have used with that month's {M.vars.length ? M.vars.map((v) => o.variables[v].toLowerCase()).join(' and ') : 'conditions (no variable: the baseline average)'}.</li>
          <li>Avoided energy = expected − actual; CUSUM is the running sum. Valued at the site tariff and the carrier's emission intensity{d.kgPerKwh[S.modelTarget === 'total' ? 'electricity' : S.modelTarget] != null ? '' : ' (no intensity set)'}.</li>
          <li>A month is flagged when it is off the model, after the saving of its neighbouring months (two either side), by more than 2 standard errors and by more than 5% of the expected month.</li>
          <li>Change the energy modelled, the variables or the baseline year under Site &amp; model. Use variables with |t| ≥ 2; leave out those that are not significant.</li>
        </ul></div>
    </div>);
}

function MeasureList({ o, list, sites, canEdit, onSaved }: { o: Overview; list: Measure[]; sites: Site[]; canEdit: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState<Measure | 'new' | null>(null);
  const live = list.filter((m) => m.status !== 'dropped');
  const exp = live.reduce((a, m) => a + (m.kwhExpected ?? 0), 0), ver = live.reduce((a, m) => a + (m.kwhVerified ?? 0), 0), save = live.reduce((a, m) => a + (m.econ.saveYear ?? 0), 0), capex = live.reduce((a, m) => a + (m.capex ?? 0), 0);
  return (
    <div className="card flush">
      <div className="row vfilters"><div className="grow"><b>Energy-saving measures</b>
        <div className="muted small">Expected {mwh(exp)} MWh a year · verified {mwh(ver)} MWh · saving {f0(save)} {o.currency} a year · capex {f0(capex)} {o.currency}{save > 0 ? ` · payback ${(capex / save).toFixed(1)} years` : ''}</div></div>
        {canEdit && <button className="btn sm p" onClick={() => setOpen('new')}>+ Measure</button>}</div>
      {!list.length ? <div className="empty" style={{ padding: 18 }}>No measures yet.</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Measure</th>{sites.length > 1 && <th>Site</th>}<th className="ctr">Status</th><th className="num">Expected MWh/yr</th><th className="num">Verified MWh/yr</th><th className="num">Saving {o.currency}/yr</th><th className="num">Capex</th><th className="num">Payback</th><th className="num">NPV (8%)</th><th className="num">tCO₂e/yr</th></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.id} className="click" style={{ cursor: canEdit ? 'pointer' : undefined }} onClick={() => canEdit && setOpen(m)}>
              <td><b>{m.title}</b><div className="muted small">{o.categories[m.category]} · {o.carriers[m.carrier]}{m.ipmvp ? ` · IPMVP ${m.ipmvp}` : ''}</div></td>
              {sites.length > 1 && <td className="small">{m.site ?? sites.find((x) => x.id === m.siteId)?.name}</td>}
              <td className="ctr"><span className={`chip ${STATUS[m.status][0]}`}>{STATUS[m.status][1]}</span></td>
              <td className="num">{mwh(m.kwhExpected)}</td><td className="num">{mwh(m.kwhVerified)}</td><td className="num">{f0(m.econ.saveYear)}</td><td className="num">{f0(m.capex)}</td>
              <td className="num">{m.econ.payback == null ? '—' : `${m.econ.payback.toFixed(1)} yr`}</td><td className="num">{m.econ.npv == null ? '—' : <span className={m.econ.npv >= 0 ? 'ok-t' : 'warn-t'}>{f0(m.econ.npv)}</span>}</td><td className="num">{f1(m.econ.tYear)}</td></tr>))}</tbody>
        </table></div>)}
      {open && <MeasureDrawer o={o} m={open === 'new' ? null : open} sites={sites} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onSaved(); }} />}
    </div>);
}

function MeasuresTab({ o, onSaved }: { o: Overview; onSaved: () => void }) {
  return <MeasureList o={o} list={o.measures} sites={o.sites} canEdit={o.canMeasures} onSaved={onSaved} />;
}

function MeasureDrawer({ o, m, sites, onClose, onDone }: { o: Overview; m: Measure | null; sites: Site[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ siteId: m?.siteId ?? sites[0]?.id ?? '', title: m?.title ?? '', category: m?.category ?? 'lighting', carrier: m?.carrier ?? 'electricity' as Carrier, status: m?.status ?? 'idea' as Measure['status'],
    implementedOn: m?.implementedOn ?? '', kwhExpected: s(m?.kwhExpected), kwhVerified: s(m?.kwhVerified), ipmvp: m?.ipmvp ?? '', capex: s(m?.capex), opexYear: s(m?.opexYear), lifeYears: s(m?.lifeYears), owner: m?.owner ?? '', mvPlan: m?.mvPlan ?? '', note: m?.note ?? '' });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const done = f.status === 'implemented' || f.status === 'verified';
  const ok = f.title.trim().length >= 2 && f.siteId && [f.kwhExpected, f.kwhVerified, f.capex, f.opexYear, f.lifeYears].every(okNum) && (!done || f.implementedOn) && (f.status !== 'verified' || (f.kwhVerified.trim() && f.ipmvp));
  const body = (): MeasureBody => ({ siteId: f.siteId, title: f.title.trim(), category: f.category, carrier: f.carrier, status: f.status, implementedOn: f.implementedOn || null, kwhExpected: parse(f.kwhExpected), kwhVerified: parse(f.kwhVerified),
    ipmvp: (f.ipmvp || null) as MeasureBody['ipmvp'], capex: parse(f.capex), opexYear: parse(f.opexYear), lifeYears: parse(f.lifeYears), owner: f.owner.trim() || null, mvPlan: f.mvPlan.trim(), note: f.note.trim() });
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  const n = (k: keyof typeof f, label: string, ph = '') => <label className="field"><span>{label}</span><input className="input num" inputMode="decimal" value={f[k] as string} placeholder={ph} onChange={(e) => up({ [k]: e.target.value } as Partial<typeof f>)} /></label>;
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Energy-saving measure</div><h2>{m ? m.title : 'Add a measure'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        <label className="field span2"><span>Measure</span><input className="input" value={f.title} placeholder="e.g. VSDs on chilled-water pumps" onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="field"><span>Site</span><select className="input" value={f.siteId} onChange={(e) => up({ siteId: e.target.value })}>{sites.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field"><span>Category</span><select className="input" value={f.category} onChange={(e) => up({ category: e.target.value })}>{Object.entries(o.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Energy saved</span><select className="input" value={f.carrier} onChange={(e) => up({ carrier: e.target.value as Carrier })}>{CARRIERS.map((k) => <option key={k} value={k}>{o.carriers[k]}</option>)}</select></label>
        <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => up({ status: e.target.value as Measure['status'] })}>{(Object.keys(STATUS) as Measure['status'][]).map((k) => <option key={k} value={k}>{STATUS[k][1]}</option>)}</select></label>
        <label className="field"><span>Implemented on</span><input type="date" className="input" value={f.implementedOn} onChange={(e) => up({ implementedOn: e.target.value })} /></label>
        <label className="field"><span>IPMVP option</span><select className="input" value={f.ipmvp} onChange={(e) => up({ ipmvp: e.target.value })}><option value="">—</option><option value="A">A — retrofit isolation, key parameter measured</option><option value="B">B — retrofit isolation, all parameters measured</option><option value="C">C — whole facility</option><option value="D">D — calibrated simulation</option></select></label>
        {n('kwhExpected', 'Expected saving, kWh a year')}{n('kwhVerified', 'Verified saving, kWh a year')}
        {n('capex', `Capex (${o.currency})`)}{n('opexYear', `Extra running cost a year (${o.currency})`)}
        {n('lifeYears', 'Life (years)')}<label className="field"><span>Owner</span><input className="input" value={f.owner} onChange={(e) => up({ owner: e.target.value })} /></label>
        <label className="field span2"><span>M&amp;V plan (what is measured, how, for how long)</span><textarea className="input" rows={2} value={f.mvPlan} onChange={(e) => up({ mvPlan: e.target.value })} /></label>
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
      {done && !f.implementedOn && <div className="note warn small">Give the date it was implemented.</div>}
      {f.status === 'verified' && (!f.kwhVerified.trim() || !f.ipmvp) && <div className="note warn small">A verified measure needs its verified saving and the IPMVP option used.</div>}
      <div className="row">{m && <button className="btn" onClick={() => go(() => enApi.deleteMeasure(m.id))}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
        <button className="btn p" disabled={!ok} onClick={() => go(() => (m ? enApi.saveMeasure(m.id, body()) : enApi.addMeasure(body())))}>Save</button></div>
    </div></dialog>);
}

function SeuList({ o, d, onSaved }: { o: Overview; d: Detail; onSaved: () => void }) {
  const [open, setOpen] = useState<Seu | 'new' | null>(null);
  const share = d.seus.reduce((a, x) => a + (x.sharePct ?? 0), 0);
  return (
    <div className="card flush">
      <div className="row vfilters"><div className="grow"><b>Energy review: significant energy uses (ISO 50001)</b>
        <div className="muted small">The uses that account for most of the energy or the most potential to save: their share, the variables that drive them, how their performance is measured and the controls that keep it. {share ? `Together ${share.toFixed(0)}% of the site's energy.` : ''}</div></div>
        {d.canMeasures && <button className="btn sm p" onClick={() => setOpen('new')}>+ Significant use</button>}</div>
      {!d.seus.length ? <div className="empty" style={{ padding: 18 }}>No significant energy uses recorded.</div> : (
        <table className="t"><thead><tr><th>Use</th><th>Carrier</th><th className="num">Share</th><th>Relevant variables</th><th>EnPI</th><th>Operational controls</th><th>Owner</th></tr></thead>
          <tbody>{d.seus.map((x) => (
            <tr key={x.id} className="click" style={{ cursor: d.canMeasures ? 'pointer' : undefined }} onClick={() => d.canMeasures && setOpen(x)}><td><b>{x.name}</b></td><td className="small">{o.carriers[x.carrier]}</td><td className="num">{x.sharePct == null ? '—' : `${x.sharePct}%`}</td>
              <td className="small">{x.variables}</td><td className="small">{x.enpi}</td><td className="small">{x.controls}</td><td className="small">{x.owner ?? '—'}</td></tr>))}</tbody></table>)}
      {open && <SeuDrawer o={o} x={open === 'new' ? null : open} siteId={d.site.id} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onSaved(); }} />}
    </div>);
}

function SeuDrawer({ o, x, siteId, onClose, onDone }: { o: Overview; x: Seu | null; siteId: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ name: x?.name ?? '', carrier: x?.carrier ?? 'electricity' as Carrier, sharePct: s(x?.sharePct), variables: x?.variables ?? '', enpi: x?.enpi ?? '', controls: x?.controls ?? '', owner: x?.owner ?? '' });
  const up = (v: Partial<typeof f>) => setF((w) => ({ ...w, ...v }));
  const body = (): SeuBody => ({ siteId, name: f.name.trim(), carrier: f.carrier, sharePct: parse(f.sharePct), variables: f.variables.trim(), enpi: f.enpi.trim(), controls: f.controls.trim(), owner: f.owner.trim() || null });
  const ok = f.name.trim().length >= 2 && okNum(f.sharePct) && (parse(f.sharePct) ?? 0) <= 100;
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Energy review</div><h2>{x ? x.name : 'Add a significant energy use'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        <label className="field span2"><span>Use</span><input className="input" value={f.name} placeholder="e.g. Chillers, compressed air, kiln" onChange={(e) => up({ name: e.target.value })} /></label>
        <label className="field"><span>Carrier</span><select className="input" value={f.carrier} onChange={(e) => up({ carrier: e.target.value as Carrier })}>{CARRIERS.map((k) => <option key={k} value={k}>{o.carriers[k]}</option>)}</select></label>
        <label className="field"><span>Share of the site's energy, %</span><input className="input num" value={f.sharePct} onChange={(e) => up({ sharePct: e.target.value })} /></label>
        <label className="field span2"><span>Relevant variables</span><input className="input" value={f.variables} placeholder="e.g. outdoor temperature, production volume" onChange={(e) => up({ variables: e.target.value })} /></label>
        <label className="field span2"><span>EnPI</span><input className="input" value={f.enpi} placeholder="e.g. kW per ton of refrigeration" onChange={(e) => up({ enpi: e.target.value })} /></label>
        <label className="field span2"><span>Operational controls</span><textarea className="input" rows={2} value={f.controls} placeholder="Set points, schedules, maintenance" onChange={(e) => up({ controls: e.target.value })} /></label>
        <label className="field"><span>Owner</span><input className="input" value={f.owner} onChange={(e) => up({ owner: e.target.value })} /></label>
      </div>
      <div className="row">{x && <button className="btn" onClick={() => go(() => enApi.deleteSeu(x.id))}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={!ok} onClick={() => go(() => (x ? enApi.saveSeu(x.id, body()) : enApi.addSeu(body())))}>Save</button></div>
    </div></dialog>);
}

function SiteDrawer({ o, site, onClose, onDone }: { o: Overview; site: Site | null; onClose: () => void; onDone: (id?: string) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({
    name: site?.name ?? '', nodeId: site?.nodeId ?? '', siteType: site?.siteType ?? 'office', floorM2: s(site?.floorM2), baselineYear: s(site?.baselineYear ?? lastYear() - 1), modelTarget: site?.modelTarget ?? 'total',
    modelVars: site?.modelVars ?? [] as Variable[], enpiVar: site?.enpiVar ?? '', productionUnit: site?.productionUnit ?? '', targetPct: s(site?.targetPct), targetYear: s(site?.targetYear), notes: site?.notes ?? '',
    tariffs: Object.fromEntries(CARRIERS.map((k) => [k, s(site?.tariffs[k])])) as Record<Carrier, string>, factors: Object.fromEntries(CARRIERS.map((k) => [k, s(site?.factors[k])])) as Record<Carrier, string>,
  });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const pickNode = (id: string) => { const n = o.nodes.find((x) => x.id === id); up({ nodeId: id, ...(n && !f.name ? { name: n.name } : {}), ...(n?.floor_m2 && !f.floorM2 ? { floorM2: String(n.floor_m2) } : {}) }); };
  const toggleVar = (v: Variable) => up({ modelVars: f.modelVars.includes(v) ? f.modelVars.filter((x) => x !== v) : f.modelVars.length >= 2 ? f.modelVars : [...f.modelVars, v] });
  const nums = [f.floorM2, f.baselineYear, f.targetPct, f.targetYear, ...Object.values(f.tariffs), ...Object.values(f.factors)];
  const ok = f.name.trim().length >= 2 && nums.every(okNum);
  const body = (): SiteBody => ({
    name: f.name.trim(), nodeId: f.nodeId || null, siteType: f.siteType, floorM2: parse(f.floorM2), baselineYear: parse(f.baselineYear), modelTarget: f.modelTarget as SiteBody['modelTarget'], modelVars: f.modelVars,
    enpiVar: (f.enpiVar || null) as SiteBody['enpiVar'], productionUnit: f.productionUnit.trim() || null, targetPct: parse(f.targetPct), targetYear: parse(f.targetYear), notes: f.notes.trim(),
    tariffs: Object.fromEntries(CARRIERS.map((k) => [k, parse(f.tariffs[k])])), factors: o.ekotrace ? site?.factors ?? {} : Object.fromEntries(CARRIERS.map((k) => [k, parse(f.factors[k])])),
  });
  const save = async () => { try { if (site) { await enApi.saveSite(site.id, body()); onDone(); } else onDone((await enApi.addSite(body())).id); toast('Saved'); } catch (e) { toast((e as Error).message); } };
  const del = async () => { if (!site) return; try { await enApi.deleteSite(site.id); toast('Removed'); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Energy management</div><h2>{site ? site.name : 'Add a site'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        {o.ekotrace && <label className="field span2"><span>Inventory facility (energy from its approved entries)</span><select className="input" value={f.nodeId} onChange={(e) => pickNode(e.target.value)}><option value="">— not linked: typed energy —</option>{o.nodes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="field span2"><span>Site name</span><input className="input" value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
        <label className="field"><span>Type</span><select className="input" value={f.siteType} onChange={(e) => up({ siteType: e.target.value })}>{Object.entries(o.siteTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Floor area, m²</span><input className="input num" value={f.floorM2} onChange={(e) => up({ floorM2: e.target.value })} /></label>
        <label className="field"><span>Baseline year</span><input className="input num" value={f.baselineYear} onChange={(e) => up({ baselineYear: e.target.value })} /></label>
        <label className="field"><span>Energy modelled</span><select className="input" value={f.modelTarget} onChange={(e) => up({ modelTarget: e.target.value as typeof f.modelTarget })}><option value="total">Total energy</option>{CARRIERS.map((k) => <option key={k} value={k}>{o.carriers[k]}</option>)}</select></label>
        <div className="field span2"><span>Variables that drive the energy (up to two)</span>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap', marginTop: 4 }}>{VARS.map((v) => <label key={v} className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={f.modelVars.includes(v)} disabled={!f.modelVars.includes(v) && f.modelVars.length >= 2} onChange={() => toggleVar(v)} />{o.variables[v]}</label>)}</div></div>
        <label className="field"><span>EnPI: energy per</span><select className="input" value={f.enpiVar} onChange={(e) => up({ enpiVar: e.target.value })}><option value="">—</option><option value="floor">m² of floor area</option>{VARS.map((v) => <option key={v} value={v}>{o.variables[v]}</option>)}</select></label>
        <label className="field"><span>Production unit</span><input className="input" value={f.productionUnit} placeholder="t, pallets, rooms sold…" onChange={(e) => up({ productionUnit: e.target.value })} /></label>
        <label className="field"><span>EnPI target, % reduction</span><input className="input num" value={f.targetPct} onChange={(e) => up({ targetPct: e.target.value })} /></label>
        <label className="field"><span>Target year</span><input className="input num" value={f.targetYear} onChange={(e) => up({ targetYear: e.target.value })} /></label>
        <div className="field span2"><span>Tariffs, {o.currency} per kWh</span>
          <div className="row small" style={{ gap: 10, flexWrap: 'wrap', marginTop: 4 }}>{CARRIERS.map((k) => <label key={k} className="field" style={{ width: 150 }}><span>{o.carriers[k]}</span><input className="input num" value={f.tariffs[k]} onChange={(e) => up({ tariffs: { ...f.tariffs, [k]: e.target.value } })} /></label>)}</div></div>
        {!o.ekotrace && <div className="field span2"><span>Emission factors, kgCO₂e per kWh (to value savings in tCO₂e)</span>
          <div className="row small" style={{ gap: 10, flexWrap: 'wrap', marginTop: 4 }}>{CARRIERS.map((k) => <label key={k} className="field" style={{ width: 150 }}><span>{o.carriers[k]}</span><input className="input num" value={f.factors[k]} onChange={(e) => up({ factors: { ...f.factors, [k]: e.target.value } })} /></label>)}</div></div>}
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
      </div>
      <div className="row">{site && <button className="btn" onClick={del}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={!ok} onClick={save}>Save</button></div>
    </div></dialog>);
}
