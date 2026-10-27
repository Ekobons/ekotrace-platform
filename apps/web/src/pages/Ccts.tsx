/**
 * India CCTS / GEI tracker (Disclose → India CCTS). Per obligated entity and compliance year (April–March):
 * achieved GEI against the notified target, the CCCs that would be issued or must be surrendered, the projection to
 * year end and the GEI the remaining months need, monthly data (output and the emission components), the CCC
 * account, emission-reduction measures for Form A, and the entity's set-up (boundary, baseline, targets).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import {
  MONTH_KEYS, cctsApi, currentFy, fyLabel, monthName,
  type CctsDetail, type CctsList, type CctsMonth, type CctsTxn, type CctsMeasure, type EntityBody, type MonthBody, type MonthKey,
} from '../lib/ccts';

const f0 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const f1 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
const g4 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }));
const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
const inr = (x: number | null | undefined) => (x == null ? '—' : `₹${x >= 1e7 ? `${(x / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr` : x >= 1e5 ? `${(x / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} lakh` : x.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const d8 = (x: string) => new Date(`${x.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const TXN: Record<CctsTxn['kind'], string> = { issued: 'Issued by BEE', bought: 'Bought', sold: 'Sold', surrendered: 'Surrendered' };

export function Ccts() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const fy = sp.get('fy') ? Number(sp.get('fy')) : currentFy();
  const tab = sp.get('tab') ?? 'months';
  const [list, setList] = useState<CctsList | null>(null);
  const [d, setD] = useState<CctsDetail | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { cctsApi.list(fy).then(setList).catch((e) => toast((e as Error).message)); }, [fy, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const id = sp.get('e') ?? list?.entities[0]?.id ?? null;
  useEffect(() => { if (id) cctsApi.get(id, fy).then(setD).catch((e) => toast((e as Error).message)); else setD(null); }, [id, fy, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!list) return <div className="page"><div className="card empty">Loading…</div></div>;
  const years = [...new Set([...(d?.years ?? []), fy, currentFy(), 2025])].sort((a, b) => b - a);
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose · India</span><h1>India CCTS</h1>
          <div className="muted">Carbon Credit Trading Scheme, compliance mechanism. Each obligated entity's GEI (tCO₂e per tonne of equivalent product) against its notified target, and the Carbon Credit Certificates (CCCs) it earns or must surrender. Compliance years run April to March.</div></div>
        {list.entities.length > 0 && <label className="field" style={{ minWidth: 260 }}><span>Obligated entity</span>
          <select className="input" value={id ?? ''} onChange={(e) => set('e', e.target.value)}>{list.entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <label className="field" style={{ minWidth: 130 }}><span>Compliance year</span>
          <select className="input" value={fy} onChange={(e) => set('fy', e.target.value)}>{years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></label>
        {d && <button className="btn" onClick={() => cctsApi.formA(d.entity.id, fy, d.entity.name).catch((e) => toast((e as Error).message))}><Icon name="download" /> Form A (Excel)</button>}
        {list.canSetup && <button className="btn p" onClick={() => setEditing('new')}>+ Obligated entity</button>}
      </div>

      {list.entities.length > 1 && <EntityStrip list={list} active={id} pick={(x) => set('e', x)} />}

      {!list.entities.length ? (
        <div className="card" style={{ padding: 28 }}>
          <h3 style={{ marginTop: 0 }}>No obligated entity yet</h3>
          <p className="muted" style={{ maxWidth: 720 }}>Add each plant that is named in the MoEFCC gazette schedule (Greenhouse Gases Emission Intensity Target Rules, 2025): its registration number, sector, the 2023-24 baseline output and GEI, and the target GEI for each compliance year. Link the facilities inside its boundary and the tracker takes fuel and grid electricity from their approved entries.</p>
          {list.canSetup ? <button className="btn p" onClick={() => setEditing('new')}>+ Add an obligated entity</button> : <p className="muted small">A super admin or admin adds obligated entities.</p>}
        </div>
      ) : !d ? <div className="card empty">Loading…</div> : (
        <>
          <Headline d={d} />
          <div className="ccgrid">
            <div className="card"><h3 style={{ margin: '0 0 2px' }}>GEI month by month, {d.label}</h3>
              <div className="muted small">tCO₂e per {d.entity.outputUnit} of {d.entity.product ?? 'equivalent product'}. The line is the year to date; the dashed line the notified target.</div>
              <GeiChart d={d} /></div>
            <SideCard d={d} />
          </div>
          <div className="seg strong" role="tablist">
            {([['months', 'Monthly data'], ['ccc', `CCC account${d.txns.length ? ` (${d.txns.length})` : ''}`], ['measures', `Reduction measures${d.measures.length ? ` (${d.measures.length})` : ''}`], ['setup', 'Entity & targets']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'months' ? null : k)}>{l}</button>))}
          </div>
          {tab === 'months' && <MonthsTab d={d} onSaved={reload} />}
          {tab === 'ccc' && <CccTab d={d} onSaved={reload} />}
          {tab === 'measures' && <MeasuresTab d={d} onSaved={reload} />}
          {tab === 'setup' && <SetupTab d={d} list={list} onEdit={() => setEditing('edit')} onSaved={reload} />}
        </>
      )}
      {editing && <EntityDrawer list={list} entity={editing === 'edit' ? d?.entity ?? null : null}
        onClose={() => setEditing(null)} onDone={(newId) => { setEditing(null); if (newId) set('e', newId); reload(); }} onRemoved={() => { setEditing(null); set('e', null); reload(); }} />}
    </div>);
}

function EntityStrip({ list, active, pick }: { list: CctsList; active: string | null; pick: (id: string) => void }) {
  return (
    <div className="kgrid4">{list.entities.map((x) => {
      const ccc = x.result.projected;
      return (
        <button key={x.id} className={`card kpi vk ${x.id === active ? 'on' : ''}`} onClick={() => pick(x.id)}>
          <span className="muted small">{list.sectors[x.sector]?.label ?? x.sector}{x.state ? ` · ${x.state}` : ''}</span>
          <span style={{ fontWeight: 600 }}>{x.name}</span>
          <span className="small">GEI {g4(x.result.gei)} <span className="muted">vs target {g4(x.result.target)}</span></span>
          <span className="small">{ccc == null ? <span className="muted">{x.result.monthsIn} of 12 months in</span> : ccc >= 0 ? <span style={{ color: 'var(--ok)' }}>▲ {f0(ccc)} CCCs projected</span> : <span style={{ color: 'var(--bad)' }}>▼ {f0(-ccc)} CCCs short (projected)</span>}</span>
        </button>);
    })}</div>);
}

function Headline({ d }: { d: CctsDetail }) {
  const y = d.year, A = d.account, P = d.projectedAccount, u = d.entity.outputUnit;
  const ccc = y.projection?.ccc ?? y.ccc, ahead = y.gei != null && y.target != null ? y.gei <= y.target : null;
  const next = d.calendar.find((c) => c.date >= today()) ?? d.calendar[d.calendar.length - 1]!;
  const days = Math.round((new Date(`${next.date}T00:00:00`).getTime() - Date.now()) / 864e5);
  return (
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Achieved GEI {y.monthsIn < 12 ? 'year to date' : d.label}</span>
        <b style={{ color: ahead == null ? undefined : ahead ? 'var(--ok)' : 'var(--bad)' }}>{g4(y.gei)}</b>
        <span className="muted small">target {g4(y.target)}{y.target == null ? ' (not set)' : ''} · baseline {g4(y.baselineGei)} · tCO₂e/{u}</span></div>
      <div className="card kpi"><span className="muted small">{y.projection ? 'CCC position, projected to 31 March' : `CCC position ${d.label}`}</span>
        <b style={{ color: ccc == null ? undefined : ccc >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{ccc == null ? '—' : ccc >= 0 ? `+${f0(ccc)}` : `−${f0(-ccc)}`}</b>
        <span className="muted small">{ccc == null ? 'needs a target and a month with output and emissions' : ccc >= 0 ? 'CCCs eligible for issuance' : 'CCCs to surrender'}{y.projection && y.ccc != null ? ` · ${y.ccc >= 0 ? '+' : '−'}${f0(Math.abs(y.ccc))} on the months in` : ''}</span></div>
      <div className="card kpi"><span className="muted small">{ccc != null && ccc < 0 ? 'Cost to cover the shortfall' : 'Value of the surplus'}</span>
        {(() => {
          const acc = P ?? A;
          if (!acc.value) return <><b>—</b><span className="muted small">set a CCC price on the entity</span></>;
          if (ccc != null && ccc < 0) return <><b style={{ color: 'var(--bad)' }}>{inr(acc.value.toBuy)}</b><span className="muted small">{f0(acc.toBuy)} CCCs to buy after {f0(acc.held)} held · if not surrendered, environmental compensation {inr(acc.value.compensation)} (2 × price)</span></>;
          return <><b style={{ color: 'var(--ok)' }}>{inr(acc.value.surplus)}</b><span className="muted small">at ₹{f0(d.entity.priceInr)} per CCC · {f0(A.held)} CCCs held now</span></>;
        })()}</div>
      <div className="card kpi"><span className="muted small">Next: {next.label}</span><b>{d8(next.date)}</b>
        <span className="muted small">{days >= 0 ? `in ${days} days` : `${-days} days ago`} · {y.monthsIn} of 12 months with output and emissions</span></div>
    </div>);
}

/** Monthly GEI (dots), year-to-date GEI (line), target (dashed) and baseline (recessive), on one axis, April to March. */
function GeiChart({ d }: { d: CctsDetail }) {
  const y = d.year;
  const ytd: (number | null)[] = []; let o = 0, e = 0;
  for (const m of y.months) { if (m.complete) { o += m.output as number; e += m.total; } ytd.push(m.complete && o ? e / o : null); }
  const vals = [...y.months.map((m) => m.gei), ...ytd, y.target, y.baselineGei].filter((v): v is number => v != null && Number.isFinite(v));
  const [hover, setHover] = useState<number | null>(null);
  if (!vals.length) return <div className="empty" style={{ padding: 24 }}>No month has both output and emissions yet.</div>;
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo || hi * 0.05 || 1) * 0.25; lo -= pad; hi += pad;
  const W = 640, H = 230, L = 54, R = 14, T = 12, B = 26, cw = (W - L - R) / 12;
  const X = (i: number) => L + cw * i + cw / 2, Y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const line = ytd.map((v, i) => (v == null ? null : `${X(i)},${Y(v)}`)).filter(Boolean).join(' ');
  const hm = hover != null ? y.months[hover] : null;
  return (
    <figure className="chart" style={{ position: 'relative', margin: '8px 0 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`GEI by month ${d.label}`} style={{ width: '100%', height: H }} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="gridline" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" className="axis">{v.toFixed(3)}</text></g>)}
        {y.baselineGei != null && <g><line x1={L} x2={W - R} y1={Y(y.baselineGei)} y2={Y(y.baselineGei)} stroke="var(--muted)" strokeWidth={1} opacity={0.6} /><text x={W - R} y={Y(y.baselineGei) - 4} textAnchor="end" className="axis">baseline 2023-24</text></g>}
        {y.target != null && <g><line x1={L} x2={W - R} y1={Y(y.target)} y2={Y(y.target)} stroke="var(--bad)" strokeWidth={2} strokeDasharray="6 4" /><text x={L + 4} y={Y(y.target) - 5} className="axis" style={{ fill: 'var(--bad)' }}>target {y.target.toFixed(4)}</text></g>}
        {line && <polyline points={line} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" />}
        {y.months.map((m, i) => (
          <g key={m.month}>
            <rect x={L + cw * i} y={T} width={cw} height={H - T - B} fill={hover === i ? 'var(--primary-soft)' : 'transparent'} onMouseEnter={() => setHover(i)} />
            {m.gei != null && <circle cx={X(i)} cy={Y(m.gei)} r={4.5} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} pointerEvents="none" />}
            {ytd[i] != null && <circle cx={X(i)} cy={Y(ytd[i]!)} r={2.5} fill="var(--s1)" pointerEvents="none" />}
            <text x={X(i)} y={H - 8} textAnchor="middle" className="axis">{new Date(`${m.month}T00:00:00`).toLocaleDateString('en-GB', { month: 'short' })}</text>
          </g>))}
      </svg>
      {hm && hover != null && (
        <div className="charttip" style={{ position: 'absolute', top: 8, left: `${Math.min(70, ((X(hover) + 12) / W) * 100)}%`, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 8, padding: '6px 10px', fontSize: 12, pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
          <b>{monthName(hm.month)}</b>
          {hm.complete ? <><div>Month GEI {g4(hm.gei)}</div><div>Year to date {g4(ytd[hover])}</div><div className="muted">{f0(hm.total)} tCO₂e ÷ {f0(hm.output)} {d.entity.outputUnit}</div></> : <div className="muted">{hm.problems[0] ?? 'No data yet'}</div>}
        </div>)}
      <figcaption className="legend"><span><i style={{ background: 'var(--s2)' }} />Month</span><span><i style={{ background: 'var(--s1)' }} />Year to date</span><span><i style={{ background: 'var(--bad)' }} />Target</span>{y.baselineGei != null && <span><i style={{ background: 'var(--muted)' }} />Baseline</span>}</figcaption>
    </figure>);
}

function SideCard({ d }: { d: CctsDetail }) {
  const y = d.year, c = y.components;
  const parts = [
    { k: 'Fuel combustion', v: c.fuel, col: 'var(--s1)' }, { k: 'Process', v: c.process, col: 'var(--s3)' }, { k: 'PFCs', v: c.pfc, col: 'var(--bio)' },
    { k: 'Electricity', v: c.electricity, col: 'var(--s2)' }, { k: 'Purchased heat', v: c.heat, col: 'var(--info)' },
  ].filter((p) => p.v > 0);
  const gross = parts.reduce((a, p) => a + p.v, 0);
  const left = 12 - y.monthsIn;
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 8px' }}>{left > 0 && y.monthsIn ? 'What the rest of the year needs' : 'The year'}</h3>
      {left > 0 && y.monthsIn > 0 && y.requiredRest != null && y.target != null && (
        <div className={`note ${y.requiredRest >= y.target ? 'ok' : 'warn'}`} style={{ marginBottom: 10 }}>
          To meet {g4(y.target)} for the year, the remaining {left} month{left > 1 ? 's' : ''} must average a GEI of <b>{g4(Math.max(0, y.requiredRest))}</b>
          {y.gei != null && <> — {y.requiredRest >= y.gei ? 'above the year to date: on track if the current run-rate holds' : `${pct(1 - y.requiredRest / y.gei)} below the year to date`}</>}.
        </div>)}
      <div className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
        <span className="muted">Output</span><span>{f0(y.output)} {d.entity.outputUnit}{y.projection ? <span className="muted"> · {f0(y.projection.output)} projected</span> : ''}</span>
        <span className="muted">Emissions</span><span>{f0(y.emissions)} tCO₂e{y.projection ? <span className="muted"> · {f0(y.projection.emissions)} projected</span> : ''}</span>
        <span className="muted">Vs baseline</span><span>{y.vsBaseline == null ? '—' : `${y.vsBaseline >= 0 ? '−' : '+'}${pct(Math.abs(y.vsBaseline))} GEI`}{y.targetCut != null ? <span className="muted"> · target asks −{pct(y.targetCut)}</span> : ''}</span>
        {d.previous && <><span className="muted">{d.previous.label}</span><span>GEI {g4(d.previous.gei)} · {d.previous.ccc == null ? '' : d.previous.ccc >= 0 ? `+${f0(d.previous.ccc)} CCCs` : `−${f0(-d.previous.ccc)} CCCs`}</span></>}
      </div>
      {gross > 0 && <>
        <div className="muted small" style={{ margin: '12px 0 4px' }}>Emissions by source (tCO₂e){c.exported || c.transfer ? `, before deducting ${f0(c.exported + c.transfer)} exported or transferred` : ''}</div>
        <div style={{ display: 'flex', gap: 2, height: 12, borderRadius: 4, overflow: 'hidden' }}>{parts.map((p) => <i key={p.k} title={`${p.k}: ${f0(p.v)} t`} style={{ width: `${(p.v / gross) * 100}%`, background: p.col }} />)}</div>
        <div className="lgd" style={{ marginTop: 6 }}>{parts.map((p) => <span key={p.k}><i style={{ background: p.col }} />{p.k} {f0(p.v)} ({pct(p.v / gross)})</span>)}</div>
      </>}
    </div>);
}

// ------------------------------------------------------------------------------------- monthly data --
const COLS: { k: MonthKey; l: string; hint: string; entries?: 'fuel_t' | 'grid_mwh' }[] = [
  { k: 'output', l: 'Output', hint: 'equivalent product' },
  { k: 'fuel_t', l: 'Fuel tCO₂e', hint: 'combustion', entries: 'fuel_t' },
  { k: 'process_t', l: 'Process tCO₂e', hint: 'calcination…' },
  { k: 'pfc_t', l: 'PFC tCO₂e', hint: 'AR5' },
  { k: 'grid_mwh', l: 'Grid MWh', hint: 'bought', entries: 'grid_mwh' },
  { k: 're_mwh', l: 'RE MWh', hint: 'of grid' },
  { k: 'heat_t', l: 'Heat tCO₂e', hint: 'bought' },
  { k: 'export_mwh', l: 'Export MWh', hint: 'deducted' },
  { k: 'transfer_t', l: 'CO₂ out t', hint: 'CCUS' },
];
type Draft = Record<string, Record<MonthKey | 'note', string>>;
const toDraft = (months: CctsMonth[]): Draft => Object.fromEntries(months.map((m) => [m.month, { ...Object.fromEntries(MONTH_KEYS.map((k) => [k, m.typed[k] == null ? '' : String(m.typed[k])])), note: m.note } as Record<MonthKey | 'note', string>]));

function MonthsTab({ d, onSaved }: { d: CctsDetail; onSaved: () => void }) {
  const { toast } = useApp();
  const [draft, setDraft] = useState<Draft>(() => toDraft(d.year.months));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(toDraft(d.year.months)); }, [d]);
  const orig = useMemo(() => toDraft(d.year.months), [d]);
  const dirty = Object.keys(draft).filter((m) => JSON.stringify(draft[m]) !== JSON.stringify(orig[m]));
  const bad = Object.values(draft).some((r) => MONTH_KEYS.some((k) => r[k].trim() !== '' && !(Number(r[k].replace(/,/g, '')) >= 0)));
  const entries = d.entity.energySource === 'entries';
  const save = async () => {
    setBusy(true);
    try {
      const months: MonthBody[] = dirty.map((m) => ({ month: m, note: draft[m]!.note.trim(), ...Object.fromEntries(MONTH_KEYS.map((k) => { const s = draft[m]![k].replace(/,/g, '').trim(); return [k, s === '' ? null : Number(s)]; })) } as MonthBody));
      await cctsApi.months(d.entity.id, months);
      toast(`Saved ${months.length} month${months.length > 1 ? 's' : ''}`); onSaved();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  /** Paste a column from Excel into a cell: fills that column downwards. */
  const paste = (month: string, k: MonthKey, e: React.ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData('text');
    if (!/[\n\t]/.test(t.trim())) return;
    e.preventDefault();
    const rows = t.replace(/\r/g, '').split('\n').filter((r, i, a) => r !== '' || i < a.length - 1);
    const ms = d.year.months.map((m) => m.month), start = ms.indexOf(month), ci = COLS.findIndex((c) => c.k === k);
    setDraft((o) => {
      const n = { ...o };
      rows.forEach((r, ri) => { const m = ms[start + ri]; if (!m) return; r.split('\t').forEach((v, vi) => { const col = COLS[ci + vi]; if (col) n[m] = { ...n[m]!, [col.k]: v.trim().replace(/,/g, '') }; }); });
      return n;
    });
  };
  const y = d.year;
  return (
    <div className="card flush">
      <div className="row vfilters" style={{ flexWrap: 'wrap' }}>
        <span className="grow muted small">{entries
          ? <>Fuel combustion and grid electricity come from the approved entries of {d.facilities.map((f) => f.name).join(', ') || 'no facility yet (link one under Entity & targets)'}; the grey figure shows them. Type a value only to replace them for a month. Process emissions, PFCs, output and the rest are typed here. Paste a column from Excel into the first cell.</>
          : <>All figures are typed per month (the entity takes nothing from entries). Paste a column from Excel into the first cell.</>}</span>
        {d.canData && <button className="btn p" disabled={busy || !dirty.length || bad} onClick={save}>{dirty.length ? `Save ${dirty.length} month${dirty.length > 1 ? 's' : ''}` : 'Saved'}</button>}
      </div>
      <div className="scroll"><table className="t cctsgrid">
        <thead><tr><th>Month</th>{COLS.map((c) => <th key={c.k} className="num" title={c.hint}>{c.l}<div className="muted small" style={{ fontWeight: 400 }}>{c.k === 'output' ? d.entity.outputUnit : c.hint}</div></th>)}<th className="num">Total tCO₂e</th><th className="num">GEI</th><th>Note</th></tr></thead>
        <tbody>{y.months.map((m) => {
          const r = draft[m.month]!;
          return (
            <tr key={m.month} className={m.complete ? '' : 'dim'}>
              <td className="nowrap"><b>{monthName(m.month)}</b>{m.problems.length > 0 && <div className="small warn-t" title={m.problems.join(' · ')}>⚠ {m.problems[0]}</div>}</td>
              {COLS.map((c) => {
                const fromE = entries && c.entries && m.entries ? m.entries[c.entries] : null;
                const ph = fromE ? f1(fromE) : '';
                return <td key={c.k} className="num">{d.canData
                  ? <input className="input sm num" style={{ width: c.k === 'output' ? 88 : 72 }} inputMode="decimal" value={r[c.k]} placeholder={ph} aria-label={`${c.l} ${monthName(m.month)}`}
                      title={fromE ? `From ${m.entries?.entries} approved entr${m.entries?.entries === 1 ? 'y' : 'ies'}: ${f1(fromE)}` : undefined}
                      onChange={(e) => setDraft((o) => ({ ...o, [m.month]: { ...o[m.month]!, [c.k]: e.target.value } }))} onPaste={(e) => paste(m.month, c.k, e)} />
                  : <span>{r[c.k] || (ph ? <span className="muted">{ph}</span> : '—')}</span>}</td>;
              })}
              <td className="num small"><b>{m.total ? f1(m.total) : '—'}</b></td>
              <td className="num small"><b>{g4(m.gei)}</b></td>
              <td>{d.canData ? <input className="input sm" style={{ width: 150 }} value={r.note} onChange={(e) => setDraft((o) => ({ ...o, [m.month]: { ...o[m.month]!, note: e.target.value } }))} /> : <span className="small">{r.note}</span>}</td>
            </tr>);
        })}</tbody>
        <tfoot><tr><td><b>{y.label}</b></td><td className="num"><b>{f0(y.output)}</b></td><td className="num">{f0(y.components.fuel)}</td><td className="num">{f0(y.components.process)}</td><td className="num">{y.components.pfc ? f0(y.components.pfc) : '—'}</td>
          <td className="num muted small" colSpan={2}>electricity {f0(y.components.electricity)} tCO₂e</td><td className="num">{y.components.heat ? f0(y.components.heat) : '—'}</td><td className="num">{y.components.exported ? `−${f0(y.components.exported)}` : '—'}</td><td className="num">{y.components.transfer ? `−${f0(y.components.transfer)}` : '—'}</td>
          <td className="num"><b>{f0(y.emissions)}</b></td><td className="num"><b>{g4(y.gei)}</b></td><td className="muted small">{y.monthsIn} of 12 months complete</td></tr></tfoot>
      </table></div>
      <div className="muted small" style={{ padding: '8px 14px 12px' }}>Electricity = (grid MWh − documented renewable MWh) × {d.entity.gridEf} tCO₂/MWh, the CEA average of the baseline year held constant. Exported power is deducted at the grid factor unless the month gives its own. A month counts once it has output and emissions.</div>
    </div>);
}

// ------------------------------------------------------------------------------------- CCC account --
function CccTab({ d, onSaved }: { d: CctsDetail; onSaved: () => void }) {
  const { toast } = useApp();
  const A = d.account;
  const [f, setF] = useState({ kind: 'bought', fy: String(d.fy), quantity: '', priceInr: d.entity.priceInr != null ? String(d.entity.priceInr) : '', onDate: today(), reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const add = async () => {
    setBusy(true);
    try {
      await cctsApi.ccc(d.entity.id, { kind: f.kind, fy: Number(f.fy), quantity: Number(f.quantity), priceInr: f.priceInr.trim() === '' ? null : Number(f.priceInr), onDate: f.onDate, reference: f.reference.trim() || null, note: f.note.trim() });
      toast('Recorded'); up({ quantity: '', reference: '', note: '' }); onSaved();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const del = async (t: CctsTxn) => { try { await cctsApi.cccDelete(t.id); toast('Removed'); onSaved(); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="card flush">
      <div className="row" style={{ gap: 24, padding: '12px 14px', flexWrap: 'wrap' }}>
        {([['Held now', A.held], ['Issued', A.issued], ['Bought', A.bought], ['Sold', A.sold], ['Surrendered', A.surrendered]] as const).map(([l, v]) => <div key={l}><div className="muted small">{l}</div><b style={{ fontSize: 20 }}>{f0(v)}</b></div>)}
        <div className="grow" />
        <div className="small" style={{ maxWidth: 380 }}>{A.obligation > 0
          ? <span className="warn-t">{d.label}: {f0(A.obligation)} CCCs to surrender on the months in; {f0(A.surrenderedForYear)} surrendered so far, {f0(A.open)} still open{A.toBuy ? `, of which ${f0(A.toBuy)} beyond what is held` : ''}.</span>
          : A.expectedIssue > 0 ? <span style={{ color: 'var(--ok)' }}>{d.label}: {f0(A.expectedIssue)} CCCs eligible for issuance once verified (1 CCC = 1 tCO₂e).</span> : <span className="muted">{d.label}: no obligation on the months in.</span>}</div>
      </div>
      {d.canSetup && (
        <div className="row" style={{ gap: 8, padding: '0 14px 12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field"><span>Transaction</span><select className="input" value={f.kind} onChange={(e) => up({ kind: e.target.value })}>{Object.entries(TXN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>For compliance year</span><select className="input" value={f.fy} onChange={(e) => up({ fy: e.target.value })}>{d.years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></label>
          <label className="field" style={{ width: 120 }}><span>CCCs</span><input className="input num" inputMode="numeric" value={f.quantity} onChange={(e) => up({ quantity: e.target.value })} /></label>
          <label className="field" style={{ width: 120 }}><span>Price ₹/CCC</span><input className="input num" inputMode="decimal" value={f.priceInr} onChange={(e) => up({ priceInr: e.target.value })} /></label>
          <label className="field"><span>Date</span><input className="input" type="date" value={f.onDate} onChange={(e) => up({ onDate: e.target.value })} /></label>
          <label className="field grow"><span>Registry or exchange reference</span><input className="input" value={f.reference} onChange={(e) => up({ reference: e.target.value })} /></label>
          <button className="btn p" disabled={busy || !(Number.isInteger(Number(f.quantity)) && Number(f.quantity) > 0) || !f.onDate} onClick={add}>Record</button>
        </div>)}
      {!d.txns.length ? <div className="empty" style={{ padding: 24 }}>No CCC transactions yet. CCCs are issued by BEE on the ICM registry (run by Grid-India) after verification, and traded on the power exchanges.</div> : (
        <div className="scroll"><table className="t">
          <thead><tr><th>Date</th><th>Transaction</th><th>Year</th><th className="num">CCCs</th><th className="num">Price</th><th>Reference</th><th>By</th><th /></tr></thead>
          <tbody>{d.txns.map((t) => (
            <tr key={t.id}><td className="small nowrap">{d8(t.onDate)}</td><td><span className={`chip ${t.kind === 'surrendered' ? 'warn' : t.kind === 'sold' ? 'grey' : ''}`}>{TXN[t.kind]}</span></td><td className="small">{fyLabel(t.fy)}</td>
              <td className="num"><b>{t.kind === 'sold' || t.kind === 'surrendered' ? '−' : '+'}{f0(t.quantity)}</b></td><td className="num small">{t.price_inr != null ? `₹${f0(t.price_inr)}` : '—'}</td>
              <td className="small">{t.reference}{t.note && <div className="muted">{t.note}</div>}</td><td className="small muted">{t.createdName}</td>
              <td>{d.canSetup && <button className="btn sm ghost" aria-label="Remove" onClick={() => del(t)}><Icon name="x" /></button>}</td></tr>))}</tbody>
        </table></div>)}
      <div className="muted small" style={{ padding: '8px 14px 12px' }}>Banked CCCs can be sold or used in later years. CCCs not surrendered by the deadline attract environmental compensation of twice the average CCC price of the trading cycle (levied by CPCB).</div>
    </div>);
}

// ------------------------------------------------------------------------------------- measures --
function MeasuresTab({ d, onSaved }: { d: CctsDetail; onSaved: () => void }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState<CctsMeasure | 'new' | null>(null);
  const del = async (m: CctsMeasure) => { try { await cctsApi.measureDelete(m.id); toast('Removed'); onSaved(); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="card flush">
      <div className="row vfilters"><span className="grow muted small">Emission-reduction measures reported in Form A: the year it was implemented, emissions a year before and after, and the investment.</span>
        {d.canData && <button className="btn p" onClick={() => setEdit('new')}>+ Measure</button>}</div>
      {!d.measures.length ? <div className="empty" style={{ padding: 24 }}>No measures recorded.</div> : (
        <div className="scroll"><table className="t">
          <thead><tr><th>Measure</th><th>Year</th><th className="num">Done</th><th className="num">tCO₂e/yr before</th><th className="num">after</th><th className="num">Saving</th><th className="num">Investment</th><th className="num">₹ per t saved a year</th><th /></tr></thead>
          <tbody>{d.measures.map((m) => {
            const sav = m.beforeT != null && m.afterT != null ? m.beforeT - m.afterT : null;
            return (
              <tr key={m.id}><td><b>{m.title}</b>{m.note && <div className="muted small">{m.note}</div>}</td><td className="small">{fyLabel(m.fy)}</td><td className="num small">{m.yearDone ?? '—'}</td>
                <td className="num small">{f0(m.beforeT)}</td><td className="num small">{f0(m.afterT)}</td><td className="num"><b>{sav ? f0(sav) : '—'}</b></td>
                <td className="num small">{inr(m.investmentInr)}</td><td className="num small">{sav && m.investmentInr ? inr(m.investmentInr / sav) : '—'}</td>
                <td className="nowrap">{d.canData && <><button className="btn sm" onClick={() => setEdit(m)}>Edit</button> <button className="btn sm ghost" aria-label="Remove" onClick={() => del(m)}><Icon name="x" /></button></>}</td></tr>);
          })}</tbody>
        </table></div>)}
      {edit && <MeasureDrawer d={d} m={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onSaved(); }} />}
    </div>);
}

function MeasureDrawer({ d, m, onClose, onDone }: { d: CctsDetail; m: CctsMeasure | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const s = (x: number | null | undefined) => (x == null ? '' : String(x));
  const [f, setF] = useState({ fy: String(m?.fy ?? d.fy), title: m?.title ?? '', yearDone: s(m?.yearDone), beforeT: s(m?.beforeT), afterT: s(m?.afterT), investmentInr: s(m?.investmentInr), note: m?.note ?? '' });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  const save = async () => {
    const b = { fy: Number(f.fy), title: f.title.trim(), yearDone: n(f.yearDone), beforeT: n(f.beforeT), afterT: n(f.afterT), investmentInr: n(f.investmentInr), note: f.note.trim() };
    try { if (m) await cctsApi.measureSave(m.id, b); else await cctsApi.measure(d.entity.id, b); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); }
  };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{d.entity.name}</div><h2>{m ? 'Edit measure' : 'Emission-reduction measure'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        <label className="field span2"><span>Measure</span><input className="input" value={f.title} placeholder="e.g. Waste heat recovery, 12 MW" onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="field"><span>Reported for</span><select className="input" value={f.fy} onChange={(e) => up({ fy: e.target.value })}>{d.years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></label>
        <label className="field"><span>Year implemented</span><input className="input num" inputMode="numeric" value={f.yearDone} onChange={(e) => up({ yearDone: e.target.value })} /></label>
        <label className="field"><span>tCO₂e a year before</span><input className="input num" inputMode="decimal" value={f.beforeT} onChange={(e) => up({ beforeT: e.target.value })} /></label>
        <label className="field"><span>tCO₂e a year after</span><input className="input num" inputMode="decimal" value={f.afterT} onChange={(e) => up({ afterT: e.target.value })} /></label>
        <label className="field"><span>Investment (₹)</span><input className="input num" inputMode="decimal" value={f.investmentInr} onChange={(e) => up({ investmentInr: e.target.value })} /></label>
        <div className="field" />
        <label className="field span2"><span>Note</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
      <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={f.title.trim().length < 2} onClick={save}>Save</button></div>
    </div></dialog>);
}

// ------------------------------------------------------------------------------------- set-up --
function SetupTab({ d, list, onEdit, onSaved }: { d: CctsDetail; list: CctsList; onEdit: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const e = d.entity;
  const yrs = [...new Set([...d.targets.map((t) => t.fy), 2025, 2026, currentFy()])].sort((a, b) => a - b);
  const [tg, setTg] = useState<Record<number, string>>(() => Object.fromEntries(yrs.map((y) => [y, String(d.targets.find((t) => t.fy === y)?.targetGei ?? '')])));
  const saveTargets = async () => {
    try {
      const r = await cctsApi.targets(e.id, yrs.map((y) => ({ fy: y, targetGei: tg[y]!.trim() === '' ? null : Number(tg[y]) })));
      toast(r.warnings.length ? r.warnings.join(' · ') : 'Targets saved'); onSaved();
    } catch (x) { toast((x as Error).message); }
  };
  const row = (l: string, v: React.ReactNode) => <><span className="muted">{l}</span><span>{v}</span></>;
  return (
    <div className="ccgrid">
      <div className="card">
        <div className="row"><h3 className="grow" style={{ margin: 0 }}>Obligated entity</h3>{d.canSetup && <button className="btn sm" onClick={onEdit}>Edit</button>}</div>
        <div className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginTop: 10 }}>
          {row('Name (as in the gazette)', <b>{e.name}</b>)}{row('Registration no.', e.registrationNo ?? '—')}
          {row('Sector', `${list.sectors[e.sector]?.label ?? e.sector}${e.subSector ? ` · ${e.subSector}` : ''}`)}{row('State', e.state ?? '—')}
          {row('Equivalent product', `${e.product ?? '—'} (${e.outputUnit})`)}
          {row('Baseline 2023-24', `${f0(e.baselineOutput)} ${e.outputUnit} · GEI ${g4(e.baselineGei)}`)}
          {row('Grid factor', `${e.gridEf} tCO₂/MWh (CEA, baseline year)`)}
          {row('Fuel and grid electricity', e.energySource === 'entries' ? `from approved entries of: ${d.facilities.map((f) => f.name).join(', ') || 'no facility linked'}` : 'typed per month')}
          {row('Verifier (ACVA)', e.acva ?? '—')}{row('CCC price assumption', e.priceInr != null ? `₹${f0(e.priceInr)} per CCC` : '—')}
          {e.notes && row('Notes', e.notes)}
        </div>
      </div>
      <div className="card">
        <h3 style={{ margin: '0 0 4px' }}>Notified targets</h3>
        <div className="muted small">Target GEI per compliance year, from the gazette schedule row of this entity (tCO₂e/{e.outputUnit}).</div>
        <table className="t" style={{ marginTop: 8 }}><thead><tr><th>Compliance year</th><th className="num">Target GEI</th><th className="num">vs baseline</th></tr></thead>
          <tbody>{yrs.map((y) => {
            const v = Number(tg[y]); return (
              <tr key={y}><td>{fyLabel(y)}</td>
                <td className="num">{d.canSetup ? <input className="input sm num" style={{ width: 110 }} inputMode="decimal" value={tg[y]} onChange={(x) => setTg((o) => ({ ...o, [y]: x.target.value }))} /> : g4(v || null)}</td>
                <td className="num small">{v && e.baselineGei ? `${v <= e.baselineGei ? '−' : '+'}${pct(Math.abs(1 - v / e.baselineGei))}` : '—'}</td></tr>);
          })}</tbody></table>
        {d.canSetup && <div className="row" style={{ marginTop: 8 }}><span className="grow" /><button className="btn p sm" onClick={saveTargets}>Save targets</button></div>}
        <h3 style={{ margin: '16px 0 6px' }}>Compliance calendar {d.label}</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{d.calendar.map((c) => <li key={c.key}><b>{d8(c.date)}</b> — {c.label}</li>)}</ul>
      </div>
    </div>);
}

function EntityDrawer({ list, entity, onClose, onDone, onRemoved }: { list: CctsList; entity: CctsDetail['entity'] | null; onClose: () => void; onDone: (id?: string) => void; onRemoved: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const s = (x: number | null | undefined) => (x == null ? '' : String(x));
  const [f, setF] = useState({
    name: entity?.name ?? '', registrationNo: entity?.registrationNo ?? '', sector: entity?.sector ?? 'cement', subSector: entity?.subSector ?? '', state: entity?.state ?? '', address: entity?.address ?? '',
    outputUnit: entity?.outputUnit ?? 't', product: entity?.product ?? '', baselineOutput: s(entity?.baselineOutput), baselineGei: s(entity?.baselineGei), gridEf: s(entity?.gridEf ?? 0.727),
    energySource: entity?.energySource ?? 'entries', facilityIds: entity?.facilityIds ?? [], acva: entity?.acva ?? '', priceInr: s(entity?.priceInr), notes: entity?.notes ?? '',
  });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  const sec = list.sectors[f.sector];
  const save = async () => {
    const b: EntityBody = {
      name: f.name.trim(), registrationNo: f.registrationNo.trim() || null, sector: f.sector, subSector: f.subSector.trim() || null, state: f.state.trim() || null, address: f.address.trim() || null,
      outputUnit: f.outputUnit.trim() || sec?.unit || 't', product: f.product.trim() || null, baselineOutput: n(f.baselineOutput), baselineGei: n(f.baselineGei), gridEf: n(f.gridEf) ?? 0.727,
      energySource: f.energySource as 'entries' | 'manual', facilityIds: f.facilityIds, acva: f.acva.trim() || null, priceInr: n(f.priceInr), notes: f.notes.trim(),
    };
    try { const r = await cctsApi.save(b, entity?.id); toast(entity ? 'Saved' : 'Entity added — now enter its targets under Entity & targets'); onDone(r.id); } catch (e) { toast((e as Error).message); }
  };
  const remove = async () => { if (!entity) return; try { await cctsApi.remove(entity.id); toast('Removed'); onRemoved(); } catch (e) { toast((e as Error).message); } };
  const txt = (k: keyof typeof f, l: string, p = '', cls = 'field') => <label className={cls}><span>{l}</span><input className="input" value={String(f[k])} placeholder={p} onChange={(e) => up({ [k]: e.target.value } as Partial<typeof f>)} /></label>;
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">India CCTS</div><h2>{entity ? 'Edit obligated entity' : 'Add an obligated entity'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="note info small">Copy the entity's row from the MoEFCC gazette schedule: name, registration number, baseline equivalent output and GEI (2023-24). Targets are entered after saving.</div>
      <div className="vform">
        {txt('name', 'Name of the obligated entity (as in the gazette)', '', 'field span2')}
        {txt('registrationNo', 'Registration no.')}
        <label className="field"><span>Sector</span><select className="input" value={f.sector} onChange={(e) => { const x = list.sectors[e.target.value]; up({ sector: e.target.value, outputUnit: x?.unit ?? f.outputUnit }); }}>
          {Object.entries(list.sectors).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        {txt('subSector', 'Sub-sector', f.sector === 'textile' ? 'Spinning, Processing, Fibre, Composite' : f.sector === 'cement' ? 'e.g. Integrated, Grinding unit' : '')}
        {txt('state', 'State')}
        {txt('product', 'Equivalent product', sec?.product ?? '')}
        {txt('outputUnit', 'Output unit', sec?.unit ?? 't')}
        <label className="field"><span>Baseline output 2023-24 ({f.outputUnit})</span><input className="input num" inputMode="decimal" value={f.baselineOutput} onChange={(e) => up({ baselineOutput: e.target.value })} /></label>
        <label className="field"><span>Baseline GEI 2023-24 (tCO₂e/{f.outputUnit})</span><input className="input num" inputMode="decimal" value={f.baselineGei} onChange={(e) => up({ baselineGei: e.target.value })} /></label>
        <label className="field"><span>Grid factor, tCO₂/MWh (CEA, baseline year)</span><input className="input num" inputMode="decimal" value={f.gridEf} onChange={(e) => up({ gridEf: e.target.value })} /></label>
        <label className="field"><span>Fuel and grid electricity</span><select className="input" value={f.energySource} onChange={(e) => up({ energySource: e.target.value as 'entries' | 'manual' })}>
          <option value="entries">From approved entries of the facilities below</option><option value="manual">Typed per month</option></select></label>
        <div className="field span2"><span>Facilities inside the boundary (gate to gate)</span>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap', marginTop: 4 }}>{list.facilities.length ? list.facilities.map((x) => (
            <label key={x.id} className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={f.facilityIds.includes(x.id)} onChange={(e) => up({ facilityIds: e.target.checked ? [...f.facilityIds, x.id] : f.facilityIds.filter((y) => y !== x.id) })} />{x.name}</label>))
            : <span className="muted">No facilities yet (Setup → Organisation).</span>}</div></div>
        {txt('acva', 'Accredited carbon verification agency (ACVA)')}
        <label className="field"><span>CCC price assumption (₹ per CCC)</span><input className="input num" inputMode="decimal" value={f.priceInr} onChange={(e) => up({ priceInr: e.target.value })} /></label>
        {txt('address', 'Address', '', 'field span2')}
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
      </div>
      <div className="row">{entity && <button className="btn" onClick={remove}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
        <button className="btn p" disabled={f.name.trim().length < 2} onClick={save}>{entity ? 'Save' : 'Add entity'}</button></div>
    </div></dialog>);
}
