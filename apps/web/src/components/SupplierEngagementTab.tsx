/**
 * Suppliers → Engagement: how committed the supply chain is, weighted by the emissions of the year's purchases —
 * SBTi objectives, CDP scores, climate scores, the engagement funnel; where the non-committed and low-scoring
 * emissions sit (country, Scope 3 category); and supplier trajectories to 2050 from their declared targets, with
 * credibility. The SBTi list (public) is loaded by the platform admin and matched to suppliers by name.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api, type EngagementData } from '../lib/api';
import { Bars, DCard, Donut, HBars, Legend, PAL, fmt0, type BarRow, type Part } from './DashCharts';
import { countryName } from './Charts';
import { Icon } from './Icon';

const SBTI: Record<string, [string, string]> = { validated: ['Science-based target validated', '#0E7C66'], committed: ['Committed to the SBTi', '#7CC4A6'], own: ['Own target', '#E9B44C'], none: ['No target', '#C2523C'], unknown: ['Not known', '#C9D3CF'] };
const CDP_C: Record<string, string> = { A: '#0E7C66', 'A-': '#2BA38A', B: '#6B4FA8', 'B-': '#9C86CF', C: '#2E6FB0', 'C-': '#7FA7D6', D: '#E39A5A', 'D-': '#F0C29B', F: '#C2523C', unscored: '#C9D3CF' };
const GRADE: Record<string, string> = { 'A+': '#0E7C66', A: '#2BA38A', B: '#7CC4A6', C: '#E9B44C', D: '#E39A5A', E: '#C2523C' };
const STAGE: Record<string, [string, string]> = { finished: ['Finished', '#0E7C66'], submitted: ['Submitted', '#2BA38A'], started: ['Survey started', '#7CC4A6'], signed_in: ['Signed in', '#B6E36B'], invited: ['Invited', '#E9B44C'], not_engaged: ['Not engaged', '#C9D3CF'] };
const CAT: Record<string, string> = { purchased_goods: '3.1 Purchased goods & services', capital_goods: '3.2 Capital goods', upstream_transport: '3.4 Upstream transport', business_travel: '3.6 Business travel', upstream_leased: '3.8 Upstream leased assets' };
const CRED: Record<string, [string, string]> = { high: ['High — SBTi validated', '#0E7C66'], average: ['Average — committed or own target with numbers', '#E9B44C'], weak: ['Weak — no target (kept flat)', '#C2523C'] };
const t = (kg: number) => kg / 1000;
const pc = (x: number) => `${Math.round(x * 100)}%`;

export function SupplierEngagementTab() {
  const { toast, role } = useApp();
  const [year, setYear] = useState<number | undefined>();
  const [d, setD] = useState<EngagementData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.supplierEngagement(year).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  if (!d.suppliers) return <div className="card empty">No calculated purchases with a supplier in {d.year} yet. Engagement is weighted by the emissions of what you buy from each supplier.</div>;
  const parts = (rows: { key: string; kg: number }[], lab: Record<string, [string, string]> | Record<string, string>, colours?: Record<string, string>): Part[] =>
    rows.map((r, i) => { const l = (lab as Record<string, unknown>)[r.key]; return { v: t(r.kg), n: Array.isArray(l) ? l[0] : (l as string) ?? (r.key || 'Not known'), c: Array.isArray(l) ? l[1] : colours?.[r.key] ?? PAL[i % PAL.length]! }; });
  const share = (keys: string[], rows: { key: string; share: number }[]) => rows.filter((r) => keys.includes(r.key)).reduce((a, r) => a + r.share, 0);
  const cty = (rows: { key: string; kg: number }[]) => rows.slice(0, 7).map((r, i) => ({ v: t(r.kg), n: r.key ? countryName(r.key) : 'Country not known', c: PAL[i % PAL.length]! }));
  const cat = (rows: { key: string; kg: number }[]) => rows.map((r, i) => ({ v: t(r.kg), n: CAT[r.key] ?? r.key, c: PAL[i % PAL.length]! }));
  const wScore = d.trajectory.rows.reduce((a, r) => a + r.score * r.kg, 0) / Math.max(1, d.trajectory.rows.reduce((a, r) => a + r.kg, 0));
  const pie = (title: string, p: Part[], center: string, sub: string) => <DCard title={title}><div className="dsplit"><Donut parts={p} center={center} sub={sub} size={128} /><Legend parts={p} unit="t" /></div></DCard>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <p className="muted small grow" style={{ margin: 0 }}>Weighted by the emissions of your {d.year} purchases from each supplier ({fmt0(t(d.total))} tCO₂e from {d.suppliers} suppliers), so the suppliers that matter most count most.</p>
        <label className="field" style={{ minWidth: 120 }}><span>Purchases of</span><select className="input" value={d.year} onChange={(e) => setYear(Number(e.target.value))}>{(d.years.length ? d.years : [d.year]).map((y) => <option key={y}>{y}</option>)}</select></label>
      </div>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Emissions with a validated science-based target</span><b>{pc(share(['validated'], d.sbti))}</b><span className="muted small">{pc(share(['validated', 'committed'], d.sbti))} incl. committed (SBTi supplier-engagement target: 67%)</span></div>
        <div className="card kpi"><span className="muted small">Emissions whose supplier answered</span><b>{pc(share(['finished', 'submitted'], d.stages))}</b><span className="muted small">{pc(share(['finished', 'submitted', 'started', 'signed_in', 'invited'], d.stages))} asked on the supplier portal</span></div>
        <div className="card kpi"><span className="muted small">Average climate score</span><b>{Math.round(wScore)}<small className="muted"> /100</small></b><span className="muted small">weighted by emissions · {pc(share(['C', 'D', 'E'], d.letters))} at C or below</span></div>
        <div className="card kpi"><span className="muted small">Emissions with a CDP score</span><b>{pc(1 - share(['unscored'], d.cdp))}</b><span className="muted small">{pc(share(['A', 'A-', 'B', 'B-'], d.cdp))} scored B or better</span></div>
      </div>
      <div className="dgrid dgrid4">
        {pie('Supplier SBTi objectives · weighted by emissions', parts(d.sbti, SBTI), pc(share(['validated'], d.sbti)), 'validated')}
        {pie('Supplier CDP score · weighted by emissions', parts(d.cdp, {}, CDP_C).map((p) => ({ ...p, n: p.n === 'unscored' ? 'Unscored' : p.n })), pc(1 - share(['unscored'], d.cdp)), 'scored')}
        {pie('Climate score · weighted by emissions', parts(d.letters, {}, GRADE), `${Math.round(wScore)}`, 'average')}
        <DCard title="Engagement funnel · weighted by emissions"><HBars unit="t" items={['not_engaged', 'invited', 'signed_in', 'started', 'submitted', 'finished'].map((k) => { const r = d.stages.find((x) => x.key === k); return { n: `${STAGE[k]![0]} (${r?.n ?? 0})`, v: t(r?.kg ?? 0), c: STAGE[k]![1] }; })} /></DCard>
        {pie('Not SBTi-engaged suppliers · by country (tCO₂e)', cty(d.notSbtiByCountry), fmt0(t(d.notSbtiByCountry.reduce((a, r) => a + r.kg, 0))), 't')}
        {pie('Not SBTi-engaged suppliers · by category (tCO₂e)', cat(d.notSbtiByCategory), fmt0(t(d.notSbtiByCategory.reduce((a, r) => a + r.kg, 0))), 't')}
        {pie('Suppliers scored C or lower · by category (tCO₂e)', cat(d.lowByCategory), fmt0(t(d.lowByCategory.reduce((a, r) => a + r.kg, 0))), 't')}
        {pie('Suppliers scored C or lower · by country (tCO₂e)', cty(d.lowByCountry), fmt0(t(d.lowByCountry.reduce((a, r) => a + r.kg, 0))), 't')}
      </div>
      <Trajectory d={d} />
      <SbtiCard d={d} canImport={d.canImportSbti && role === 'platform_admin'} onDone={() => setTick((x) => x + 1)} />
    </div>);
}

function Trajectory({ d }: { d: EngagementData }) {
  const [scen, setScen] = useState<'declared' | 'validated' | 'none'>('declared');
  const [group, setGroup] = useState<'supplier' | 'cred'>('supplier');
  const [cred, setCred] = useState<Record<string, boolean>>({ high: true, average: true, weak: true });
  const [cat, setCat] = useState('');
  const [cty, setCty] = useState('');
  const Y = d.trajectory.years;
  const rows = useMemo(() => d.trajectory.rows.filter((r) => cred[r.cred] && (!cat || r.category === cat) && (!cty || r.country === cty)), [d, cred, cat, cty]);
  const val = (r: typeof rows[number], i: number) => scen === 'none' || (scen === 'validated' && r.cred !== 'high') ? r.path[0]! : r.path[i]!;
  const top = rows.filter((r) => r.id !== 'others').slice(0, 6);
  const bars: BarRow[] = Y.map((y, i) => ({
    lbl: String(y),
    parts: group === 'cred' ? (['high', 'average', 'weak'] as const).map((k) => ({ v: t(rows.filter((r) => r.cred === k).reduce((a, r) => a + val(r, i), 0)), c: CRED[k]![1], n: CRED[k]![0] }))
      : [...top.map((r, j) => ({ v: t(val(r, i)), c: PAL[j % PAL.length]!, n: r.name })), { v: t(rows.filter((r) => !top.includes(r)).reduce((a, r) => a + val(r, i), 0)), c: '#C9D3CF', n: 'All other suppliers' }],
  }));
  const first = bars[0]!.parts.reduce((a, p) => a + p.v, 0), last = bars.at(-1)!.parts.reduce((a, p) => a + p.v, 0);
  const cats = [...new Set(d.trajectory.rows.map((r) => r.category))], ctys = [...new Set(d.trajectory.rows.map((r) => r.country).filter(Boolean))].sort();
  const legend: Part[] = bars[0]!.parts.map((p) => ({ ...p, v: p.v }));
  return (
    <DCard title="Supplier emission trajectories (tCO₂e)" sub={`${d.year} purchases → ${Y.at(-1)}`}>
      <div className="trajbar">
        <label className="field"><span>Scenario</span><select className="input sm" value={scen} onChange={(e) => setScen(e.target.value as typeof scen)}>
          <option value="declared">Optimistic — every declared target is met</option><option value="validated">Prudent — only SBTi-validated targets are met</option><option value="none">No action — emissions stay as today</option></select></label>
        <label className="field"><span>Show by</span><select className="input sm" value={group} onChange={(e) => setGroup(e.target.value as typeof group)}><option value="supplier">Supplier</option><option value="cred">Trajectory credibility</option></select></label>
        <label className="field"><span>Category</span><select className="input sm" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All</option>{cats.map((c) => <option key={c} value={c}>{CAT[c] ?? c}</option>)}</select></label>
        <label className="field"><span>Country</span><select className="input sm" value={cty} onChange={(e) => setCty(e.target.value)}><option value="">All</option>{ctys.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}</select></label>
        <div className="field"><span>Credibility</span><div className="row" style={{ gap: 10 }}>{(['high', 'average', 'weak'] as const).map((k) =>
          <label key={k} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={cred[k]} onChange={(e) => setCred({ ...cred, [k]: e.target.checked })} />{k[0]!.toUpperCase() + k.slice(1)}</label>)}</div></div>
      </div>
      <div className="dsplit" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 3, minWidth: 0 }}><Bars rows={bars} unit="t" h={220} label="Supplier emissions by year" /></div>
        <div style={{ flex: 1, minWidth: 180 }}><Legend parts={legend} unit="t" />
          <div className="small" style={{ marginTop: 8 }}><b>{first ? `−${Math.round((1 - last / first) * 100)}%` : '—'}</b> by {Y.at(-1)} in this scenario</div></div>
      </div>
      <details className="small"><summary>How trajectories are drawn, and the suppliers behind them</summary>
        <p className="muted">Each supplier starts from the emissions of your {d.year} purchases from it. A declared target (from its answers on the supplier portal or its profile) is followed as a straight line — the reduction % spread over the years from its base year to its target year — then on to about 90% below by its net-zero year. Without numbers, a validated or committed SBTi target follows the SBTi pathway (1.5 °C: 4.2% a year; well-below 2 °C: 2.5%) to 2030. Suppliers with no target stay flat. Your purchases from each supplier are assumed constant.</p>
        <div className="scrollx"><table className="t compact"><thead><tr><th>Supplier</th><th>Credibility</th><th>Target</th>{Y.map((y) => <th key={y} className="num">{y}</th>)}</tr></thead>
          <tbody>{rows.slice(0, 25).map((r) => <tr key={r.id}><td>{r.name}</td><td><span className="dot" style={{ background: CRED[r.cred]![1] }} /> {r.cred}</td>
            <td className="small">{r.target ? r.target.pct != null ? `−${r.target.pct}% ${r.target.base}→${r.target.ty}${r.target.nz ? ` · NZ ${r.target.nz}` : ''}` : `${r.target.rate}%/yr${r.target.nz ? ` · NZ ${r.target.nz}` : ''}` : '—'}</td>
            {Y.map((_, i) => <td key={i} className="num">{fmt0(t(val(r, i)))}</td>)}</tr>)}</tbody></table></div></details>
    </DCard>);
}

function SbtiCard({ d, canImport, onDone }: { d: EngagementData; canImport: boolean; onDone: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const L = d.sbtiList;
  const up = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { const r = await api.sbtiImport(f); toast(`SBTi list loaded: ${r.rows.toLocaleString('en')} companies`); onDone(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="card row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 260 }}>
        <h3 style={{ margin: '0 0 4px' }}>SBTi list</h3>
        <p className="muted small" style={{ margin: 0 }}>The Science Based Targets initiative publishes the companies that have set or committed to targets. Suppliers are matched to it by name (legal forms ignored), so their status is known without asking them. Shared by every company on the platform; updated by the platform administrator from the SBTi's own download.</p>
      </div>
      <div className="small" style={{ minWidth: 220 }}>
        {L.rows ? <><b>{L.rows.toLocaleString('en')}</b> companies{L.demo ? ' (DEMO list, not real)' : ''}<br /><span className="muted">loaded {L.imported_at ? new Date(L.imported_at).toLocaleDateString('en-GB') : '—'}{L.filename ? ` from ${L.filename}` : ''}</span><br /><b>{L.matched}</b> of your suppliers found in it</>
          : <span className="muted">Not loaded yet.</span>}
      </div>
      {canImport && <label className={`btn sm${busy ? ' dis' : ''}`}><Icon name="upload" />{busy ? 'Loading…' : 'Load the SBTi list (.xlsx / .csv)'}<input type="file" hidden accept=".xlsx,.csv" disabled={busy} onChange={(e) => { void up(e.target.files?.[0]); e.target.value = ''; }} /></label>}
    </div>);
}
