/**
 * KPI dashboard, as in the prototype (MOD14 + v8).
 *
 *  My KPIs               six cards (changeable from each card's title) from a library of 19 KPIs —
 *                        emissions, intensity, energy, water, waste, mobility, value chain — by month,
 *                        quarter, half-year or year; bars green on target, amber off; dashed target line;
 *                        pale = period still filling. Aggregate, or compare the facilities. "Choose KPIs &
 *                        set targets": totals are targets per month (scaled to the frequency); percentages
 *                        and intensities are the level to stay below or above. Targets are kept per
 *                        viewing selection (company, sub-group, facility, dashboard group).
 *  Emissions vs target   actual against the target level (same period of the base year × the straight-line
 *                        path to the company's targets), tiles, chart and table.
 *  Benchmarks            per facility: tCO₂e a year, per m², per employee, energy use intensity against a
 *                        typical band for its type, water per employee.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, type HomeData, type KpiConfig } from '../lib/api';
import { Bars, DCard, HBars, MN, PAL, fmt, fmt0, type BarRow } from '../components/DashCharts';
import { ViewBar, sum, useView, type Ctx, type Data, type Row } from '../components/ViewBar';
import { DIVERT, route, tonnes } from './Dashboards';

type X = { staff: number; area: number; supsp: number | null };
interface Kpi { id: string; name: string; unit: string; area: string; dir: 'down' | 'up'; fn: (rs: Row[], x: X) => number | null; ratio: boolean }
const t3 = (r: Row) => r.s1 + r.s2 + r.s3 + r.s33;
const kwhOf = (rs: Row[], kind?: string) => sum(rs.filter((r) => (kind ? r.kind === kind : r.kind)), (r) => r.kwh ?? 0);
export const KPI_LIB: Kpi[] = ([
  ['tot', 'Total emissions', 'tCO₂e', 'Emissions', 'down', (rs: Row[]) => sum(rs, t3)],
  ['s12', 'Scope 1 + 2 emissions', 'tCO₂e', 'Emissions', 'down', (rs: Row[]) => sum(rs, (r) => r.s1 + r.s2)],
  ['s3', 'Scope 3 emissions', 'tCO₂e', 'Emissions', 'down', (rs: Row[]) => sum(rs, (r) => r.s3 + r.s33)],
  ['pemp', 'Emissions per employee', 'kgCO₂e / person', 'Intensity', 'down', (rs: Row[], x: X) => (x.staff ? (sum(rs, t3) * 1000) / x.staff : null)],
  ['pm2', 'Emissions per m² floor area', 'kgCO₂e / m²', 'Intensity', 'down', (rs: Row[], x: X) => (x.area ? (sum(rs, t3) * 1000) / x.area : null)],
  ['elec', 'Electricity consumption', 'MWh', 'Energy', 'down', (rs: Row[]) => kwhOf(rs, 'electricity') / 1000],
  ['ren', 'Renewable electricity share', '%', 'Energy', 'up', (rs: Row[]) => { const e = kwhOf(rs, 'electricity'); return e ? (sum(rs, (r) => r.rec) / e) * 100 : null; }],
  ['eui', 'Energy use intensity', 'kWh / m²', 'Energy', 'down', (rs: Row[], x: X) => (x.area ? kwhOf(rs) / x.area : null)],
  ['cool', 'District cooling', 'MWh cooling', 'Energy', 'down', (rs: Row[]) => kwhOf(rs, 'cooling') / 1000],
  ['water', 'Water consumption', 'm³', 'Water', 'down', (rs: Row[]) => sum(rs.filter((r) => r.flow === 'withdrawal'), (r) => r.m3 ?? 0)],
  ['wemp', 'Water per employee', 'm³ / person', 'Water', 'down', (rs: Row[], x: X) => (x.staff ? sum(rs.filter((r) => r.flow === 'withdrawal'), (r) => r.m3 ?? 0) / x.staff : null)],
  ['waste', 'Waste generated', 'tonnes', 'Waste', 'down', (rs: Row[]) => sum(rs.filter((r) => r.cat === 'waste_generated'), tonnes)],
  ['div', 'Waste diversion rate', '%', 'Waste', 'up', (rs: Row[]) => { const w = rs.filter((r) => r.cat === 'waste_generated'), t = sum(w, tonnes); return t ? (sum(w.filter((r) => DIVERT.has(route(r))), tonnes) / t) * 100 : null; }],
  ['fuel', 'Fleet fuel consumption', 'litres', 'Mobility', 'down', (rs: Row[]) => sum(rs.filter((r) => r.cat === 'mobile_combustion' && r.unit === 'L'), (r) => r.qty)],
  ['fleet', 'Fleet emissions', 'tCO₂e', 'Mobility', 'down', (rs: Row[]) => sum(rs.filter((r) => r.cat === 'mobile_combustion'), t3)],
  ['travel', 'Business travel emissions', 'tCO₂e', 'Mobility', 'down', (rs: Row[]) => sum(rs.filter((r) => r.cat === 'business_travel'), t3)],
  ['purch', 'Purchased goods & services emissions', 'tCO₂e', 'Value chain', 'down', (rs: Row[]) => sum(rs.filter((r) => r.cat === 'purchased_goods'), t3)],
  ['supsp', 'Supplier-specific share of purchase emissions', '%', 'Value chain', 'up', (_rs: Row[], x: X) => x.supsp],
  ['refr', 'Refrigerant top-ups', 'kg', 'Emissions', 'down', (rs: Row[]) => sum(rs.filter((r) => r.cat === 'fugitive' && r.unit === 'kg'), (r) => r.qty)],
] as [string, string, string, string, 'down' | 'up', Kpi['fn']][]).map(([id, name, unit, area, dir, fn]) => ({ id, name, unit, area, dir, fn, ratio: /%|\//.test(unit) }));
const AREAS = ['Emissions', 'Intensity', 'Energy', 'Water', 'Waste', 'Mobility', 'Value chain'];
const FREQ: Record<string, [string, number]> = { m: ['Monthly', 1], q: ['Quarterly', 3], h: ['Semi-annual', 6], y: ['Annual', 12] };
const BENCH: Record<string, [number | null, number | null, string]> = { Office: [150, 250, 'kWh/m²·yr'], Residential: [100, 180, 'kWh/m²·yr'], Clinic: [250, 400, 'kWh/m²·yr'], Laboratory: [300, 600, 'kWh/m²·yr'], Warehouse: [50, 120, 'kWh/m²·yr'], 'Data centre': [null, null, 'PUE'], 'Fleet depot': [null, null, ''] };

export function Kpis() {
  const { toast } = useApp();
  const v = useView();
  const { d, c, err, sp, set } = v;
  const tab = sp.get('ktab') ?? 'mine', freq = sp.get('kf') ?? 'm', cmp = sp.get('kcmp') === '1';
  const [cfg, setCfg] = useState<KpiConfig | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [panel, setPanel] = useState<{ q: string; list: string[]; tg: Record<string, string> } | null>(null);
  useEffect(() => { api.kpis().then(setCfg).catch(() => {}); }, []);
  useEffect(() => { api.home({ year: d?.year }).then(setHome).catch(() => {}); }, [d?.year]);
  const key = v.group ? `g:${v.group}` : v.node || 'company';
  const tg = cfg?.targets[key] ?? {};
  const head = (
    <div className="dhead">
      <div><h1>KPI dashboard</h1><span className="muted">{v.name} · {d ? `${d.year} · ${c?.periodLabel}` : ''}</span></div><span className="grow" />
      <div className="seg">{Object.entries(FREQ).map(([k, [n]]) => <button key={k} className={freq === k ? 'on' : ''} onClick={() => set({ kf: k === 'm' ? null : k })}>{n}</button>)}</div>
      {tab === 'mine' && <div className="seg"><button className={!cmp ? 'on' : ''} onClick={() => set({ kcmp: null })}>Aggregate</button><button className={cmp ? 'on' : ''} onClick={() => set({ kcmp: '1' })}>Compare facilities</button></div>}
      {tab === 'mine' && cfg && <button className="btn sm p" onClick={() => setPanel({ q: '', list: cfg.list.slice(), tg: Object.fromEntries(Object.entries(tg).map(([k, x]) => [k, String(x)])) })}>Choose KPIs & set targets</button>}
    </div>);
  const tabs = (
    <nav className="tabs dtabs" role="tablist">{[['mine', 'My KPIs'], ['target', 'Emissions vs target'], ['bench', 'Benchmarks']].map(([k, n]) => (
      <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => set({ ktab: k === 'mine' ? null : k })}>{n}</button>))}</nav>);
  const saveSlot = async (i: number, id: string) => {
    if (!cfg) return; const list = cfg.list.slice(); list[i] = id;
    if (!cfg.canChoose) { setCfg({ ...cfg, list }); return; }
    try { const r = await api.saveKpis({ list }); setCfg({ ...cfg, ...r }); } catch (e) { toast((e as Error).message); }
  };
  const savePanel = async () => {
    if (!cfg || !panel) return;
    if (!panel.list.length) { toast('Pick at least one KPI.'); return; }
    const clean: Record<string, number> = {};
    for (const [k, x] of Object.entries(panel.tg)) { const s = String(x).trim(); if (s !== '' && Number.isFinite(Number(s))) clean[k] = Number(s); }
    try {
      const r = await api.saveKpis({ ...(cfg.canChoose ? { list: panel.list } : {}), ...(cfg.canTarget ? { key, targets: clean } : {}) });
      setCfg({ ...cfg, ...r }); setPanel(null); toast('KPIs saved');
    } catch (e) { toast((e as Error).message); }
  };
  const set0 = cfg ? cfg.list.filter((id) => tg[id] !== undefined).length : 0;
  return (
    <div className="page" style={{ gap: 12 }}>
      <ViewBar v={v} />
      {!d || !c || !cfg ? <div className="card empty">{err ?? 'Loading…'}</div> : <>
        {head}{tabs}
        {tab === 'target' ? <Perf d={d} c={c} home={home} freq={freq} metric={sp.get('km') ?? 'tot'} setMetric={(m) => set({ km: m === 'tot' ? null : m })} setFreq={(f) => set({ kf: f === 'm' ? null : f })} name={v.name} />
          : tab === 'bench' ? <Bench d={d} c={c} />
          : <>
            <div className="row" style={{ gap: 8, fontSize: 12.5 }}><span className="chip c-info">{cfg.list.length} KPIs</span><span className={`chip ${set0 ? 'c-ok' : 'c-n'}`}>{set0} with a target for this selection</span>
              <span className="muted">Bars green when on target, amber when off; dashed line = target; pale = period still filling. Change a card’s KPI from its title.</span></div>
            <div className="dgrid">{cfg.list.map((id, i) => <KpiCard key={i + id} i={i} id={id} d={d} c={c} freq={freq} cmp={cmp} target={tg[id]} onPick={(nid) => void saveSlot(i, nid)} />)}</div>
          </>}
      </>}
      {panel && cfg && <>
        <div className="sdrawerbg" onClick={() => setPanel(null)} />
        <aside className="sdrawer" role="dialog" aria-label="Choose KPIs and set targets">
          <div className="row"><h2>KPIs and targets</h2><span className="grow" /><button className="btn sm ghost" onClick={() => setPanel(null)}>Close ✕</button></div>
          <div className="muted" style={{ fontSize: 12.5 }}>Tick the KPIs to show and set a target for <b>{v.name}</b>. Totals: target per month (scaled to the frequency). Percentages and intensities: the level to stay below or above.</div>
          <input className="input" type="search" placeholder="Search KPIs" value={panel.q} onChange={(e) => setPanel({ ...panel, q: e.target.value })} />
          <div className="kpilist">{AREAS.map((a) => { const ks = KPI_LIB.filter((k) => k.area === a && (!panel.q || k.name.toLowerCase().includes(panel.q.toLowerCase()))); return ks.length ? (
            <div key={a}><div className="lbl" style={{ marginTop: 6 }}>{a}</div>{ks.map((k) => (
              <div key={k.id} className="kpirow"><label className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}><input type="checkbox" disabled={!cfg.canChoose} checked={panel.list.includes(k.id)} onChange={() => setPanel({ ...panel, list: panel.list.includes(k.id) ? panel.list.filter((x) => x !== k.id) : [...panel.list, k.id] })} />
                <span><b style={{ fontSize: 13 }}>{k.name}</b><small className="muted"> {k.unit} · {k.dir === 'down' ? 'lower is better' : 'higher is better'}</small></span></label>
                <input className="input num" style={{ width: 120 }} inputMode="decimal" disabled={!cfg.canTarget} placeholder={k.ratio ? 'target' : 'per month'} value={panel.tg[k.id] ?? ''} onChange={(e) => setPanel({ ...panel, tg: { ...panel.tg, [k.id]: e.target.value.replace(/[^0-9.]/g, '') } })} /></div>))}</div>) : null; })}</div>
          <div className="row"><button className="btn p" onClick={() => void savePanel()}>Save</button><span className="muted" style={{ fontSize: 12 }}>{panel.list.length} selected{cfg.canTarget ? '' : ' · targets are set by admins'}{cfg.canChoose ? '' : ' · the KPIs shown are chosen by admins and managers'}</span></div>
        </aside></>}
    </div>
  );
}

/** A KPI's value per period (month, quarter, half, year) over the months with data so far. */
function series(k: Kpi, d: Data, c: Ctx, facs: string[] | null, freq: string) {
  const n = FREQ[freq]![1], fac = facs ? d.facilities.filter((f) => facs.includes(f.id)) : d.facilities;
  const x: X = { staff: sum(fac, (f) => f.employees ?? 0), area: sum(fac, (f) => f.area ?? 0), supsp: null };
  const pm = d.purchases.byMethod, pt = sum(pm, (m) => m.t);
  x.supsp = pt ? (sum(pm.filter((m) => m.method === 'supplier'), (m) => m.t) / pt) * 100 : null;
  const rows = facs ? d.rows.filter((r) => facs.includes(r.f)) : d.rows, out = [];
  for (let i = 0; i < 12; i += n) {
    const ms = Array.from({ length: n }, (_, j) => i + j + 1), done = ms.filter((m) => m <= c.nMax);
    const lbl = n === 1 ? MN[i]! : n === 3 ? `Q${i / 3 + 1}` : n === 6 ? `H${i / 6 + 1}` : String(d.year);
    const val = done.length ? k.fn(rows.filter((r) => done.includes(r.m)), { ...x, staff: x.staff, area: x.area }) : null;
    const comp = done.length ? sum(done, (m) => c.inShare(m)) / done.length : null;
    out.push({ lbl, v: val, done: done.length, of: n, comp });
  }
  return { out, x, rows };
}
function KpiCard({ i, id, d, c, freq, cmp, target, onPick }: { i: number; id: string; d: Data; c: Ctx; freq: string; cmp: boolean; target?: number; onPick: (id: string) => void }) {
  const k = KPI_LIB.find((x) => x.id === id) ?? KPI_LIB[0]!;
  const sel = <select className="kpisel" aria-label="KPI" value={k.id} onChange={(e) => onPick(e.target.value)}>{AREAS.map((a) => <optgroup key={a} label={a}>{KPI_LIB.filter((x) => x.area === a).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>)}</select>;
  if (cmp) {
    const vals = d.facilities.map((f) => ({ n: f.name, v: series(k, d, c, [f.id], 'y').out[0]!.v ?? 0 })).sort((a, b) => b.v - a.v);
    return <DCard title={sel}><HBars items={vals} unit={k.unit} c={PAL[i % PAL.length]} /><div className="muted" style={{ fontSize: 11.5 }}>{d.year} · {c.periodLabel} · compare facilities</div></DCard>;
  }
  const { out } = series(k, d, c, null, freq);
  const per = FREQ[freq]![1];
  const tgt = target === undefined ? null : k.ratio ? target : target * per;
  const rows: BarRow[] = out.map((r) => {
    const t = tgt === null ? null : k.ratio ? tgt : tgt * (r.done && r.done < r.of ? r.done / r.of : 1);
    const ok = r.v === null || t === null ? null : k.dir === 'down' ? r.v <= t : r.v >= t;
    return { lbl: r.lbl, parts: r.v === null ? [] : [{ v: r.v, c: ok === null ? PAL[i % PAL.length]! : ok ? '#2BA38A' : '#E3B25A', n: k.name }], line2: t, dim: r.comp !== null && r.comp < 0.9 };
  });
  const done = out.filter((r) => r.v !== null);
  const cur = k.ratio ? series(k, d, c, null, 'y').out[0]!.v : sum(done, (r) => r.v ?? 0);
  const tYtd = target === undefined ? null : k.ratio ? target : target * c.nMax;
  const ok = tYtd === null || cur === null ? null : k.dir === 'down' ? cur <= tYtd : cur >= tYtd;
  return (
    <DCard title={sel}>
      <div className="kpih"><b>{cur === null ? '—' : fmt(cur, cur < 100 ? 1 : 0)}</b><span className="muted">{k.unit} {k.ratio ? 'year to date' : 'YTD'}</span>
        {tYtd !== null ? <span className={`chip ${ok ? 'c-ok' : 'c-bad'}`}>{ok ? 'On target' : 'Off target'} · target {fmt(tYtd, tYtd < 100 ? 1 : 0)}</span> : <span className="chip c-n">No target</span>}</div>
      <Bars rows={rows} unit={k.unit} h={150} w={400} label={k.name} />
    </DCard>);
}

// ------------------------------------------------------------------ emissions vs target --
function Perf({ d, c, home, freq, metric, setMetric, setFreq, name }: { d: Data; c: Ctx; home: HomeData | null; freq: string; metric: string; setMetric: (m: string) => void; setFreq: (f: string) => void; name: string }) {
  if (!home) return <div className="card empty">Loading…</div>;
  const T = home.settings.target, base = home.settings.baseYear, y = d.year;
  if (!base || y <= base) return <section className="card muted">Performance against target starts after the base year ({base ?? 'not set'}) — pick a later year under Period, or set the base year under Methodology.</section>;
  if (!d.baseMonthly.length) return <section className="card muted">No {base} data yet: the target level is the same period of {base} reduced along the path to the targets.</section>;
  const n = FREQ[freq]![1], yrs = y - base, span = Math.max(1, T.year - base);
  const k12 = 1 - (T.s12 / 100) * yrs / span, k3 = 1 - (T.s3 / 100) * yrs / span;
  const staff = sum(d.facilities, (f) => f.employees ?? 0);
  const rows = [] as { lbl: string; ms: number[]; done: number; partial: boolean; a: number[] | null; t12: number; t3: number; comp: number | null }[];
  for (let i = 0; i < 12; i += n) {
    const ms = Array.from({ length: n }, (_, j) => i + j + 1), done = ms.filter((m) => m <= c.nMax);
    const b = [0, 0, 0]; for (const m of ms) { const bm = d.baseMonthly.find((x) => x.m === m); if (bm) { b[0] += bm.s1; b[1] += bm.s2; b[2] += bm.s3; } }
    const rs = d.rows.filter((r) => done.includes(r.m)), a = done.length ? [sum(rs, (r) => r.s1), sum(rs, (r) => r.s2), sum(rs, (r) => r.s3 + r.s33)] : null;
    const comp = done.length ? sum(done, (m) => c.inShare(m)) / done.length : null;
    rows.push({ lbl: n === 1 ? MN[i]! : n === 3 ? `Q${i / 3 + 1}` : n === 6 ? `H${i / 6 + 1}` : String(y), ms, done: done.length, partial: done.length > 0 && done.length < ms.length, a, t12: (b[0]! + b[1]!) * k12, t3: b[2]! * k3, comp });
  }
  const act = (r: typeof rows[number]) => (!r.a ? null : metric === 's12' ? r.a[0]! + r.a[1]! : metric === 's3' ? r.a[2]! : r.a[0]! + r.a[1]! + r.a[2]!);
  const tFull = (r: typeof rows[number]) => (metric === 's12' ? r.t12 : metric === 's3' ? r.t3 : r.t12 + r.t3);
  const tDone = (r: typeof rows[number]) => tFull(r) * (r.partial ? r.done / r.ms.length : 1);
  const doneRows = rows.filter((r) => r.a), ytdA = sum(doneRows, (r) => act(r) ?? 0), ytdT = sum(doneRows, tDone), yrT = sum(rows, tFull);
  const monthsDone = sum(rows, (r) => r.done), fc = monthsDone ? (ytdA / monthsDone) * 12 : 0, varY = ytdT ? (ytdA / ytdT - 1) * 100 : 0;
  const okD = (r: typeof rows[number]) => !!r.a && (r.comp === null || r.comp >= 0.9), full = rows.filter(okD), onTrack = full.filter((r) => (act(r) ?? 0) <= tDone(r)).length;
  const metName = ({ tot: 'Total (all scopes)', s12: 'Scope 1 + 2', s3: 'Scope 3' } as Record<string, string>)[metric] ?? 'Total';
  // chart
  const W = 760, H = 240, pad = 40, bw = (W - pad) / rows.length;
  const max = Math.max(1, ...rows.map((r) => Math.max(act(r) ?? 0, tDone(r)))) * 1.12, yy = (val: number) => H - 24 - (val / max) * (H - 44);
  const Tile = ({ l, val, s, col }: { l: string; val: string; s: string; col?: string }) => <section className="card kc"><span className="muted">{l}</span><span className="v" style={col ? { color: col } : undefined}>{val}</span><span className="ks">{s}</span></section>;
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="row"><div><h2 style={{ fontSize: 15 }}>Performance against target · {y}</h2>
        <div className="muted" style={{ fontSize: 12.5 }}>Target level = same period of {base} × the straight-line path to −{T.s12}% Scope 1+2 and −{T.s3}% Scope 3 by {T.year} ({y}: {Math.round((1 - k12) * 100)}% / {Math.round((1 - k3) * 100)}% below {base}). {d.pend ? 'Includes entries waiting approval.' : 'Approved data only.'}</div></div><span className="grow" />
        <div className="seg">{Object.entries(FREQ).map(([k, [nm]]) => <button key={k} className={freq === k ? 'on' : ''} onClick={() => setFreq(k)}>{nm}</button>)}</div>
        <div className="seg">{[['tot', 'Total'], ['s12', 'Scope 1+2'], ['s3', 'Scope 3']].map(([k, nm]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k!)}>{nm}</button>)}</div></div>
      <div className="hk">
        <Tile l={`${metName} · year to date`} val={`${fmt0(ytdA)} t`} s={`target to date ${fmt0(ytdT)} t`} />
        <Tile l="Against target to date" val={`${varY > 0 ? '+' : '−'}${fmt(Math.abs(varY), 1)}%`} s={varY > 0 ? 'above the target level' : 'below the target level'} col={varY > 0 ? 'var(--bad)' : 'var(--ok)'} />
        <Tile l="Full-year forecast" val={`${fmt0(fc)} t`} s={`run-rate vs ${fmt0(yrT)} t target`} col={fc > yrT ? 'var(--bad)' : 'var(--ok)'} />
        <Tile l="Periods on target" val={`${onTrack} of ${full.length}`} s={`${FREQ[freq]![0].toLowerCase()} periods with complete data`} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Emissions against target by period" style={{ display: 'block' }}>
        {[0, 1, 2, 3].map((g) => { const val = (max / 1.12) * g / 3, gy = yy(val); return <g key={g}><line x1={pad} x2={W} y1={gy} y2={gy} stroke="var(--line)" /><text x={pad - 6} y={gy + 4} fontSize="10" textAnchor="end" fill="var(--muted)">{val >= 1000 ? `${fmt(val / 1000, 1)}k` : fmt0(val)}</text></g>; })}
        {rows.map((r, i) => {
          const cx = pad + i * bw + bw / 2, w = Math.min(64, bw * 0.56), val = act(r), t = tDone(r), inc = r.comp !== null && r.comp < 0.9;
          return (
            <g key={r.lbl}>
              {val !== null ? <rect x={cx - w / 2} y={yy(val)} width={w} height={Math.max(1, H - 24 - yy(val))} rx="4" fill={inc ? 'var(--line2)' : val > t ? '#E3B25A' : 'var(--s2)'}><title>{`${r.lbl}: ${fmt0(val)} t vs target ${fmt0(t)} t${inc ? ' — data incomplete' : ''}`}</title></rect>
                : <rect x={cx - w / 2} y={H - 26} width={w} height="2" fill="var(--line2)" />}
              <line x1={cx - w / 2 - 6} x2={cx + w / 2 + 6} y1={yy(t)} y2={yy(t)} stroke="var(--fg)" strokeWidth="2.5" strokeDasharray={val === null ? '4 3' : undefined} />
              <text x={cx} y={H - 8} fontSize="11" textAnchor="middle" fill="var(--fg2)">{r.lbl}{r.partial ? '*' : ''}</text>
            </g>);
        })}
      </svg>
      <div className="row" style={{ gap: 14, fontSize: 12, color: 'var(--fg2)' }}>
        <span className="row" style={{ gap: 5 }}><i className="sw" style={{ background: 'var(--s2)' }} />At or below target</span><span className="row" style={{ gap: 5 }}><i className="sw" style={{ background: '#E3B25A' }} />Above target</span>
        <span className="row" style={{ gap: 5 }}><i className="sw" style={{ background: 'var(--line2)' }} />Data under 90% in</span><span className="row" style={{ gap: 5 }}><i style={{ width: 16, borderTop: '2.5px solid var(--fg)' }} />Target level</span>
        <span className="row" style={{ gap: 5 }}><i style={{ width: 16, borderTop: '2.5px dashed var(--fg)' }} />Target, no data yet</span>{rows.some((r) => r.partial) && <span>* part of the period so far; target scaled to the months with data</span>}</div>
      <div className="scrollx"><table className="t"><thead><tr><th>Period</th><th className="num">Actual tCO₂e</th><th className="num">Target tCO₂e</th><th className="num">Variance</th><th>Status</th><th className="num">S1+2 actual / target</th><th className="num">S3 actual / target</th><th className="num">kg CO₂e / employee</th><th>Data in</th></tr></thead>
        <tbody>{rows.map((r) => {
          const val = act(r), t = tDone(r), dv = val !== null && t ? (val / t - 1) * 100 : null, f = r.partial ? r.done / r.ms.length : 1;
          return (
            <tr key={r.lbl}><td><b>{r.lbl}</b>{r.partial && <span className="muted" style={{ fontSize: 11 }}> · {r.done} of {r.ms.length} months</span>}</td>
              <td className="num">{val === null ? <span className="muted">—</span> : <b>{fmt0(val)}</b>}</td><td className="num">{fmt0(t || tFull(r))}</td>
              <td className="num" style={{ fontWeight: 600, color: dv === null ? 'var(--muted)' : dv > 0 ? 'var(--bad)' : 'var(--ok)' }}>{dv === null ? '—' : `${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv), 1)}%`}</td>
              <td>{dv === null ? <span className="chip c-n">Not yet</span> : !okD(r) ? <span className="chip c-info">Data incomplete</span> : dv <= 0 ? <span className="chip c-ok">On target</span> : dv <= 5 ? <span className="chip c-warn">Slightly above</span> : <span className="chip c-bad">Above target</span>}</td>
              <td className="num" style={{ fontSize: 12.5 }}>{r.a ? `${fmt0(r.a[0]! + r.a[1]!)} / ${fmt0(r.t12 * f)}` : '—'}</td><td className="num" style={{ fontSize: 12.5 }}>{r.a ? `${fmt0(r.a[2]!)} / ${fmt0(r.t3 * f)}` : '—'}</td>
              <td className="num">{r.a && staff ? fmt0(((r.a[0]! + r.a[1]! + r.a[2]!) * 1000) / staff) : '—'}</td>
              <td>{r.comp === null ? '—' : <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><div className="bar" style={{ width: 56 }}><span style={{ width: `${r.comp * 100}%`, background: r.comp >= 0.9 ? 'var(--primary)' : 'var(--s3)' }} /></div><span style={{ fontSize: 12 }}>{Math.round(r.comp * 100)}%</span></div>}</td></tr>);
        })}</tbody></table></div>
      <div className="row"><span className="muted" style={{ fontSize: 12 }}>Viewing {name} · {d.facilities.length} facilities. Change it with Viewing at the top; change the targets under Methodology.</span><span className="grow" /><Link className="btn sm ghost" to="/methodology">Targets →</Link></div>
    </section>);
}

// ------------------------------------------------------------------ benchmarks --
function Bench({ d, c }: { d: Data; c: Ctx }) {
  const k = c.months.length ? 12 / c.months.length : 0;
  const rows = useMemo(() => d.facilities.map((f) => {
    const ls = c.cur.filter((r) => r.f === f.id), t = sum(ls, t3), kwh = sum(ls, (r) => r.kwh ?? 0), w = sum(ls.filter((r) => r.flow === 'withdrawal'), (r) => r.m3 ?? 0);
    const ar = f.area ?? 0, st = f.employees ?? 0, eui = ar ? (kwh * k) / ar : null, b = BENCH[f.type ?? ''] ?? [null, null, ''];
    return { f, t, w, ar, st, eui, b };
  }), [d, c, k]);
  return (
    <section className="card"><div className="scrollx"><table className="t">
      <thead><tr><th>Facility</th><th className="num">tCO₂e / yr</th><th className="num">kg CO₂e / m²</th><th className="num">t CO₂e / employee</th><th className="num">Energy use intensity</th><th>Typical for type</th><th className="num">m³ water / employee</th></tr></thead>
      <tbody>{rows.map((r) => {
        const bd = r.eui !== null && r.b[0] ? (r.eui < r.b[0] ? ['Better than typical', 'c-ok'] : r.eui <= (r.b[1] ?? 0) ? ['Within typical range', 'c-info'] : ['Above typical', 'c-bad']) : null;
        return (
          <tr key={r.f.id}><td><b>{r.f.name}</b><div className="muted" style={{ fontSize: 12 }}>{r.f.type ?? 'Facility'} · {r.ar ? `${fmt0(r.ar)} m²` : 'area missing'} · {r.st ? `${fmt0(r.st)} staff` : 'staff missing'}</div></td>
            <td className="num"><b>{fmt0(r.t * k)}</b></td><td className="num">{r.ar ? fmt((r.t * k * 1000) / r.ar, 1) : '—'}</td><td className="num">{r.st ? fmt((r.t * k) / r.st, 2) : '—'}</td>
            <td className="num">{r.eui !== null ? `${fmt0(r.eui)} kWh/m²` : '—'}</td>
            <td>{r.b[0] ? <><span className="muted" style={{ fontSize: 12 }}>{r.b[0]}–{r.b[1]} {r.b[2]}</span> {bd && <span className={`chip ${bd[1]}`}>{bd[0]}</span>}</> : <span className="muted" style={{ fontSize: 12 }}>no simple benchmark</span>}</td>
            <td className="num">{r.st ? fmt((r.w * k) / r.st, 1) : '—'}</td></tr>);
      })}</tbody></table></div>
      <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Annualised from {d.pend ? 'approved and waiting' : 'approved'} data, {d.year} · {c.periodLabel}. Floor area and employees come from each facility’s details. Typical ranges are indicative bands for the UAE climate; replace them with your chosen benchmark set (e.g. CIBSE TM46, Energy Star) before external use.</p>
    </section>);
}
