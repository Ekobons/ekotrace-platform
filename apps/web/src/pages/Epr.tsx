/**
 * Extended Producer Responsibility (Disclose → EPR, or its own menu without the GHG inventory).
 *   Overview      every stream's year: obligation, certificates applied, shortfall carried, compensation exposure,
 *                 recycled content, the annual return; recyclers: certificates generated, sold and in stock
 *   Stream        year by year: quantities placed on the market, base, target, obligation, carried, met, shortfall;
 *                 certificates; settings and the regime's rules
 *   Certificates  every certificate bought, generated and sold
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import { eprApi, periodOf, type Cert, type CertBody, type Overview, type OverviewStream, type Regime, type RegimeInfo, type ReturnStatus, type Stream, type StreamBody, type StreamDetail, type YearRow } from '../lib/epr';

const t1 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 1 }));
const money = (x: number | null | undefined, cur: string) => (x == null ? '—' : `${cur} ${Math.round(x).toLocaleString('en-US')}`);
const d8 = (x: string | null | undefined) => (x ? new Date(`${x.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const RET: Record<ReturnStatus, [string, string]> = { not_started: ['grey', 'Not started'], in_progress: ['info', 'In progress'], filed: ['', 'Filed'] };
const pctOf = (met: number, req: number | null) => (req && req > 0 ? Math.min(100, (met / req) * 100) : met > 0 ? 100 : 0);

export function Epr() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const thisYear = new Date().getFullYear();
  const year = sp.get('y') ? Number(sp.get('y')) : thisYear;
  const sid = sp.get('s');
  const tab = sp.get('tab') ?? 'overview';
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<Stream | 'new' | null>(null);
  const reload = () => setTick((x) => x + 1);
  useEffect(() => { let live = true; eprApi.overview(year).then((x) => { if (live) setO(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <div className="page"><div className="card empty">Loading…</div></div>;
  const years = [...new Set([year, thisYear - 2, thisYear - 1, thisYear, thisYear + 1])].sort((a, b) => b - a);
  const india = o.streams.some((s) => o.library[s.regime].period === 'india_fy');
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose · Extended producer responsibility</span><h1>EPR</h1>
          <div className="muted">What the company owes for the packaging, electronics, batteries and tyres it places on the market, the certificates that meet it, what is carried forward and what a gap would cost — and, for recyclers, the certificates generated and sold.</div></div>
        <label className="field" style={{ minWidth: 150 }}><span>Year{india ? ' (India: FY ending)' : ''}</span><select className="input" value={year} onChange={(e) => set('y', e.target.value)}>{years.map((y) => <option key={y} value={y}>{india ? `${y} · FY ${y - 1}-${String(y % 100).padStart(2, '0')}` : y}</option>)}</select></label>
        <button className="btn" onClick={() => eprApi.exportXlsx(year).catch((e) => toast((e as Error).message))}><Icon name="download" /> Position (Excel)</button>
        {o.canSetup && <button className="btn p" onClick={() => setEdit('new')}><Icon name="plus" /> Stream</button>}
      </div>
      {sid ? <StreamView id={sid} year={year} o={o} back={() => set('s', null)} onEdit={setEdit} reloadAll={reload} /> : (
        <>
          <Kpis o={o} />
          <div className="seg strong" role="tablist" style={{ margin: '12px 0' }}>
            {([['overview', 'Streams'], ['certs', 'Certificates']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'overview' ? null : k)}>{l}</button>)}
          </div>
          {tab === 'overview' ? <Streams o={o} open={(id) => set('s', id)} onAdd={() => setEdit('new')} /> : <AllCerts o={o} year={year} />}
        </>)}
      {edit && <StreamDrawer o={o} s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={(id) => { setEdit(null); reload(); if (id) set('s', id); }} onDeleted={() => { setEdit(null); set('s', null); reload(); }} />}
    </div>);
}

function Kpis({ o }: { o: Overview }) {
  const prod = o.streams.filter((s) => s.active && s.role !== 'recycler' && s.position?.required != null), rec = o.streams.filter((s) => s.active && s.role === 'recycler');
  const req = prod.reduce((t, s) => t + (s.position?.required ?? 0), 0), met = prod.reduce((t, s) => t + (s.position?.met ?? 0), 0);
  const short = prod.reduce((t, s) => t + (s.position?.shortfall ?? 0), 0);
  const cur = [...new Set(prod.filter((s) => s.position?.ecExposure).map((s) => s.currency))];
  const ec = prod.reduce((t, s) => t + (s.position?.ecExposure ?? 0), 0);
  const due = prod.filter((s) => s.returnDue), filed = due.filter((s) => s.returnStatus === 'filed').length;
  const stock = rec.reduce((t, s) => t + (s.stock?.available ?? 0), 0);
  return (
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Obligation this year</span><b>{t1(req)} <small className="muted">t</small></b><span className="muted small">{prod.length} producer {prod.length === 1 ? 'stream' : 'streams'}, carried shortfalls included</span></div>
      <div className="card kpi"><span className="muted small">Met with certificates</span><b>{req ? Math.round(pctOf(met, req)) : 0}%</b>
        <div style={{ height: 6, background: 'var(--bg)', borderRadius: 4, marginTop: 6 }}><div style={{ width: `${pctOf(met, req)}%`, height: 6, borderRadius: 4, background: 'var(--primary)' }} /></div><span className="muted small">{t1(met)} t applied</span></div>
      <div className="card kpi"><span className="muted small">Shortfall</span><b style={{ color: short ? 'var(--bad)' : undefined }}>{t1(short)} <small className="muted">t</small></b><span className="muted small">{ec && cur.length === 1 ? `Compensation exposure ${money(ec, cur[0]!)}` : ec ? 'Compensation in several currencies' : 'No compensation exposure'}</span></div>
      <div className="card kpi"><span className="muted small">{rec.length ? 'Certificates in stock' : 'Annual returns filed'}</span><b>{rec.length ? <>{t1(stock)} <small className="muted">t</small></> : `${filed} of ${due.length}`}</b><span className="muted small">{rec.length ? `${rec.length} recycler ${rec.length === 1 ? 'stream' : 'streams'}; returns filed ${filed} of ${due.length}` : due[0] ? `Due ${d8(due[0].returnDue)}` : '—'}</span></div>
    </div>);
}

function Streams({ o, open, onAdd }: { o: Overview; open: (id: string) => void; onAdd: () => void }) {
  if (!o.streams.length) return (
    <div className="card empty" style={{ padding: 24 }}><b>No streams yet</b><div className="muted small" style={{ margin: '6px 0 12px' }}>A stream is one EPR registration line: e.g. India plastic packaging Category I as a brand owner, e-waste IT equipment as a producer, EU packaging in Germany, or a recycling plant generating certificates.</div>
      {o.canSetup && <button className="btn p" onClick={onAdd}><Icon name="plus" /> Add the first stream</button>}</div>);
  return (
    <div className="cpgrid">{o.streams.map((s) => <StreamCard key={s.id} s={s} lib={o.library[s.regime]} roles={o.roles} open={() => open(s.id)} />)}</div>);
}

function StreamCard({ s, lib, roles, open }: { s: OverviewStream; lib: RegimeInfo; roles: Record<string, string>; open: () => void }) {
  const p = s.position;
  const rec = s.role === 'recycler';
  return (
    <button className={`card cpcard eprcard ${!s.active ? 'not_applicable' : p?.shortfall ? 'applies' : 'ok'}`} onClick={open}>
      <div className="row" style={{ gap: 8, alignItems: 'start' }}>
        <div className="grow"><span className="muted small">{lib.short}{s.country ? ` · ${s.country}` : ''} · {roles[s.role]}</span><div style={{ fontWeight: 600 }}>{s.name}</div><span className="muted small">{lib.categories[s.category]}</span></div>
        {!s.active ? <span className="chip grey">Inactive</span> : !rec && s.returnDue ? <span className={`chip ${RET[s.returnStatus][0]}`}>{s.returnStatus === 'filed' ? 'Return filed' : `Return ${RET[s.returnStatus][1].toLowerCase()}`}</span> : null}
      </div>
      {rec ? (
        <div className="eprnums"><div><span className="muted small">Generated</span><b>{t1(s.stock?.generated)} t</b></div><div><span className="muted small">Sold</span><b>{t1(s.stock?.sold)} t</b></div><div><span className="muted small">In stock</span><b>{t1(s.stock?.available)} t</b></div></div>
      ) : s.regime === 'eu_ppwr' ? (
        <div className="eprnums"><div><span className="muted small">Placed {s.label}</span><b>{t1(p?.base)} t</b></div><div><span className="muted small">Fees</span><b>{s.fee == null ? '—' : money(s.fee, s.currency)}</b></div><div><span className="muted small">Registered</span><b>{s.registration || s.registeredOn ? 'Yes' : <span className="bad-t">No</span>}</b></div></div>
      ) : p?.required == null && !p?.met ? (
        <div className="muted small" style={{ marginTop: 10 }}>{p?.warnings[0] ?? 'No figures for this year yet. Open the stream to type the quantities and the target or obligation the scheme sets.'}</div>
      ) : (
        <>
          <div className="eprnums"><div><span className="muted small">Obligation {s.label}</span><b>{t1(p?.required)} t</b></div><div><span className="muted small">Met</span><b>{t1(p?.met)} t</b></div><div><span className="muted small">Shortfall</span><b className={p?.shortfall ? 'bad-t' : ''}>{t1(p?.shortfall)} t</b></div></div>
          <div style={{ height: 6, background: 'var(--bg)', borderRadius: 4, margin: '8px 0 4px' }}><div style={{ width: `${pctOf(p?.met ?? 0, p?.required ?? null)}%`, height: 6, borderRadius: 4, background: p?.shortfall ? '#E9B44C' : 'var(--primary)' }} /></div>
          <div className="muted small">{p?.carriedIn ? `${t1(p.carriedIn)} t carried from earlier years. ` : ''}{p?.ecExposure ? `Exposure ${money(p.ecExposure, s.currency)}. ` : ''}{p?.rcRequired != null ? `Recycled content ${t1(p.rcActual)} of ${t1(p.rcRequired)} t.` : ''}</div>
        </>)}
      {p?.warnings.length && p.required != null ? <div className="warn-t small" style={{ marginTop: 6 }}>⚠ {p.warnings[0]}</div> : null}
    </button>);
}

function AllCerts({ o, year }: { o: Overview; year: number }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<(Cert & { stream: OverviewStream })[] | null>(null);
  useEffect(() => {
    Promise.all(o.streams.map((s) => eprApi.stream(s.id, year).then((d) => d.certs.map((c) => ({ ...c, stream: s }))))).then((x) => setRows(x.flat().sort((a, b) => (b.tradedOn ?? '').localeCompare(a.tradedOn ?? '')))).catch((e) => toast((e as Error).message));
  }, [o, year]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="card empty">Loading…</div>;
  if (!rows.length) return <div className="card empty" style={{ padding: 18 }}>No certificates recorded yet. Open a stream to add them.</div>;
  return (
    <div className="card flush"><div className="scrollx"><table className="t">
      <thead><tr><th>Date</th><th>Stream</th><th>Type</th><th>Kind</th><th>Counts for</th><th className="num">Tonnes</th><th className="num">Price / t</th><th>Certificate no.</th><th>Counterparty</th></tr></thead>
      <tbody>{rows.map((c) => { const per = o.library[c.stream.regime].period; return (
        <tr key={c.id}><td className="nowrap">{d8(c.tradedOn)}</td><td>{c.stream.name}</td><td>{c.direction === 'out' ? 'Sold' : c.stream.role === 'recycler' ? 'Generated' : 'Bought'}</td><td className="small">{o.kinds[c.kind]}</td>
          <td className="small nowrap">{c.year != null ? periodOf(per, c.year) : c.generatedYear != null ? `gen. ${periodOf(per, c.generatedYear)}` : '—'}</td><td className="num">{t1(c.tonnes)}</td><td className="num">{c.price == null ? '—' : c.price.toLocaleString('en-US')}</td><td className="small">{c.certificateNo ?? '—'}</td><td className="small">{c.counterparty ?? '—'}</td></tr>); })}</tbody>
    </table></div></div>);
}

function StreamView({ id, year, o, back, onEdit, reloadAll }: { id: string; year: number; o: Overview; back: () => void; onEdit: (s: Stream) => void; reloadAll: () => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<StreamDetail | null>(null);
  const [tick, setTick] = useState(0);
  const [cert, setCert] = useState<Cert | 'new' | null>(null);
  const [ret, setRet] = useState<number | null>(null);
  const reload = () => { setTick((x) => x + 1); reloadAll(); };
  useEffect(() => { let live = true; eprApi.stream(id, year).then((x) => { if (live) setD(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [id, year, tick, o]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  const s = d.stream, L = d.library, rec = s.role === 'recycler', ppwr = s.regime === 'eu_ppwr';
  const p = d.positions.find((x) => x.year === year) ?? null;
  const per = (y: number) => periodOf(L.period, y);
  return (
    <>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '4px 0 10px' }}>
        <button className="btn ghost sm" onClick={back}>‹ All streams</button>
        <div className="grow"><b style={{ fontSize: 18 }}>{s.name}</b> <span className="muted small">· {L.short}{s.country ? ` · ${s.country}` : ''} · {o.roles[s.role]} · {L.categories[s.category]}{s.registration ? ` · reg. ${s.registration}` : ''}</span></div>
        {d.canSetup && <button className="btn" onClick={() => onEdit(s)}><Icon name="gear" /> Settings</button>}
      </div>
      {rec ? (
        <div className="kgrid4">
          <div className="card kpi"><span className="muted small">Certificates generated</span><b>{t1(d.stock?.generated)} t</b></div>
          <div className="card kpi"><span className="muted small">Sold</span><b>{t1(d.stock?.sold)} t</b></div>
          <div className="card kpi"><span className="muted small">In stock</span><b>{t1(d.stock?.available)} t</b><span className="muted small">{s.certPrice != null && d.stock ? `Worth ${money(d.stock.available * s.certPrice, s.currency)} at the assumed price` : ''}</span></div>
          <div className="card kpi"><span className="muted small">Lapsed</span><b>{t1(d.stock?.lapsed)} t</b><span className="muted small">{L.certValidityYears ? `Valid ${L.certValidityYears} years after the year generated` : 'No validity limit recorded'}</span></div>
        </div>
      ) : (
        <div className="kgrid4">
          <div className="card kpi"><span className="muted small">Obligation {per(year)}</span><b>{t1(p?.obligation)} t</b><span className="muted small">{p?.typed ? 'As typed from the portal' : p?.targetPct != null ? `${p.targetPct}% of ${t1(p.base)} t (${p.baseFrom})` : ppwr ? 'EU: fees per tonne, no tonnage target' : 'Target % not set'}</span></div>
          <div className="card kpi"><span className="muted small">Required incl. carried</span><b>{t1(p?.required)} t</b><span className="muted small">{p?.carriedIn ? `${t1(p.carriedIn)} t carried` : 'Nothing carried'}{p?.recyclingMin != null ? ` · recycling ≥ ${t1(p.recyclingMin)} t` : ''}</span></div>
          <div className="card kpi"><span className="muted small">Met with certificates</span><b>{t1(p?.met)} t</b><span className="muted small">{p?.metRecycling ? `${t1(p.metRecycling)} t recycling` : ''}{p?.recyclingShortfall ? <span className="bad-t"> · recycling short {t1(p.recyclingShortfall)} t</span> : ''}</span></div>
          <div className="card kpi"><span className="muted small">Shortfall</span><b style={{ color: p?.shortfall ? 'var(--bad)' : undefined }}>{t1(p?.shortfall)} t</b><span className="muted small">{p?.ecExposure != null ? `Exposure ${money(p.ecExposure, s.currency)}` : 'Set the compensation rate in Settings'}{p?.costToClose != null && p.shortfall ? ` · ${money(p.costToClose, s.currency)} to buy` : ''}</span></div>
        </div>)}
      {p?.warnings.map((w) => <div key={w} className="note warn small" style={{ marginTop: 8 }}>{w}</div>)}
      <YearsCard d={d} onReturn={setRet} reload={reload} />
      <div className="card flush" style={{ marginTop: 12 }}>
        <div className="row vfilters"><b className="grow">Certificates</b>{d.canCerts && <button className="btn sm p" onClick={() => setCert('new')}>+ {rec ? 'Generated or sold' : 'Certificate bought'}</button>}</div>
        {!d.certs.length ? <div className="empty" style={{ padding: 16 }}>None recorded.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>Date</th><th>Type</th><th>Kind</th><th>{rec ? 'Generated in' : 'Counts for'}</th><th className="num">Tonnes</th><th className="num">Price / t</th><th>Certificate no.</th><th>Counterparty</th><th>End product</th></tr></thead>
            <tbody>{d.certs.map((c) => (
              <tr key={c.id} className="click" style={{ cursor: d.canCerts ? 'pointer' : undefined }} onClick={() => d.canCerts && setCert(c)}>
                <td className="nowrap">{d8(c.tradedOn)}</td><td>{c.direction === 'out' ? 'Sold' : rec ? 'Generated' : 'Bought'}</td><td className="small">{o.kinds[c.kind]}</td>
                <td className="small nowrap">{rec ? (c.direction === 'out' ? (c.year != null ? `sold ${per(c.year)}` : '—') : c.generatedYear != null ? per(c.generatedYear) : '—') : c.year != null ? per(c.year) : '—'}</td>
                <td className="num">{t1(c.tonnes)}</td><td className="num">{c.price == null ? '—' : c.price.toLocaleString('en-US')}</td><td className="small">{c.certificateNo ?? '—'}</td><td className="small">{c.counterparty ?? '—'}</td><td className="small">{c.endProduct ?? '—'}</td></tr>))}</tbody>
          </table></div>)}
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <b className="small">How this regime works</b>
        <div className="muted small" style={{ marginTop: 4 }}>{L.notes}</div>
        <div className="muted small" style={{ marginTop: 4 }}>{L.returnNote}.{L.carryYears ? ` Shortfalls carried up to ${L.carryYears} years.` : ''} {L.source && <a href={L.source} target="_blank" rel="noreferrer">{L.authority} portal</a>}</div>
      </div>
      {cert && <CertDrawer d={d} o={o} c={cert === 'new' ? null : cert} year={year} onClose={() => setCert(null)} onDone={() => { setCert(null); reload(); }} />}
      {ret != null && <ReturnDrawer d={d} o={o} year={ret} onClose={() => setRet(null)} onDone={() => { setRet(null); reload(); }} />}
    </>);
}

type Cell = 'placed' | 'preConsumer' | 'suppliedToPibo' | 'recycledTonnes' | 'obligationTyped';
function YearsCard({ d, onReturn, reload }: { d: StreamDetail; onReturn: (y: number) => void; reload: () => void }) {
  const { toast } = useApp();
  const s = d.stream, L = d.library, rec = s.role === 'recycler', plastic = s.regime === 'in_plastic', ppwr = s.regime === 'eu_ppwr';
  const allYears = [...new Set([...d.years.map((y) => y.year), ...d.positions.map((p) => p.year), d.year, d.year - 1, d.year - 2])].sort((a, b) => a - b);
  const init = () => Object.fromEntries(allYears.map((y) => { const r = d.years.find((x) => x.year === y); return [y, { placed: r?.placed ?? null, preConsumer: r?.preConsumer ?? null, suppliedToPibo: r?.suppliedToPibo ?? null, recycledTonnes: r?.recycledTonnes ?? null, obligationTyped: r?.obligationTyped ?? null, note: r?.note ?? '' }]; }));
  const [v, setV] = useState<Record<number, Record<Cell, number | null> & { note: string }>>(init);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setV(init()); setDirty(false); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // the obligation typed from the portal is always offered where the library has no target; pre-consumer, PIBO and portal columns otherwise on request
  const needTyped = s.regime === 'in_battery' || s.regime === 'other';
  const used = (k: Cell) => d.years.some((y) => y[k] != null);
  const [more, setMore] = useState(false);
  const optional: [Cell, string][] = [...(plastic ? [['preConsumer', 'Pre-consumer (t)'], ['suppliedToPibo', 'Supplied to PIBOs (t)']] as [Cell, string][] : []), ...(!needTyped && !ppwr ? [['obligationTyped', 'Obligation from portal (t)']] as [Cell, string][] : [])];
  const cols: [Cell, string][] = rec ? [['placed', 'Processed (t)']] : [['placed', 'Placed on the market (t)'], ...optional.filter(([k]) => more || used(k)), ...(needTyped ? [['obligationTyped', 'Obligation (t)']] as [Cell, string][] : []), ['recycledTonnes', 'Recycled content (t)']];
  const hidden = optional.filter(([k]) => !used(k)).length;
  const filed = (y: number) => d.years.find((x) => x.year === y)?.returnStatus === 'filed';
  const save = async () => {
    try {
      await eprApi.years(s.id, allYears.filter((y) => !filed(y)).map((y) => ({ year: y, ...v[y]! })));
      toast('Saved'); setDirty(false); reload();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card flush" style={{ marginTop: 12 }}>
      <div className="row vfilters"><b className="grow">Year by year</b><span className="muted small">{L.units}; {L.period === 'india_fy' ? 'April–March' : 'calendar years'}</span>{!rec && hidden > 0 && <button className="linkbtn small" onClick={() => setMore(!more)}>{more ? 'Fewer columns' : 'Pre-consumer, PIBO and portal columns'}</button>}{d.canData && <button className="btn sm p" disabled={!dirty} onClick={save}>Save figures</button>}</div>
      <div className="scrollx"><table className="t">
        <thead><tr><th>Period</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}{!rec && !ppwr && <><th className="num">Base × target</th><th className="num">Obligation (t)</th><th className="num">Carried in</th><th className="num">Met (t)</th><th className="num">Shortfall</th></>}{!rec && <th className="num">Recycled content</th>}{!rec && <th className="ctr">Return</th>}</tr></thead>
        <tbody>{allYears.map((y) => {
          const p = d.positions.find((x) => x.year === y), r = d.years.find((x) => x.year === y), lock = filed(y) || !d.canData;
          return (
            <tr key={y} className={y === d.year ? 'sel' : ''}>
              <td className="nowrap"><b>{periodOf(L.period, y)}</b></td>
              {cols.map(([k]) => <td key={k} className="num"><input className="input num cell" disabled={lock} value={v[y]?.[k] ?? ''} placeholder="—" onChange={(e) => { const t = e.target.value.replace(/,/g, '').trim(); const n = t === '' ? null : Number(t); if (t !== '' && !Number.isFinite(n)) return; setV({ ...v, [y]: { ...v[y]!, [k]: n } }); setDirty(true); }} /></td>)}
              {!rec && !ppwr && <><td className="num small" title={p?.baseFrom}>{t1(p?.base)}{p?.targetPct != null ? ` × ${p.targetPct}%` : ''}</td><td className="num">{t1(p?.obligation)}{p?.typed ? <span className="muted small"> typed</span> : ''}</td>
                <td className="num small">{p?.carriedIn ? t1(p.carriedIn) : '—'}</td><td className="num">{t1(p?.met)}</td><td className={`num ${p?.shortfall ? 'bad-t' : ''}`}>{t1(p?.shortfall)}</td></>}
              {!rec && <td className="num small">{p?.rcRequired != null ? <span className={p.rcShortfall ? 'bad-t' : ''}>{t1(p.rcActual)} / {t1(p.rcRequired)}{p.rcPct != null ? ` (${p.rcPct}%)` : ''}</span> : '—'}{p?.rcCarried ? <div className="muted small">{t1(p.rcCarried)} t carried</div> : null}</td>}
              {!rec && <td className="ctr"><button className="linkbtn" onClick={() => onReturn(y)}><span className={`chip ${RET[r?.returnStatus ?? 'not_started'][0]}`}>{RET[r?.returnStatus ?? 'not_started'][1]}</span></button></td>}
            </tr>); })}</tbody>
      </table></div>
    </div>);
}

function CertDrawer({ d, o, c, year, onClose, onDone }: { d: StreamDetail; o: Overview; c: Cert | null; year: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const s = d.stream, rec = s.role === 'recycler', L = d.library;
  const [f, setF] = useState({ direction: c?.direction ?? 'in', kind: c?.kind ?? 'recycling', year: c?.year ?? (rec ? null : year), generatedYear: c?.generatedYear ?? (rec ? year : null), tonnes: c ? String(c.tonnes) : '', price: c?.price != null ? String(c.price) : '',
    certificateNo: c?.certificateNo ?? '', counterparty: c?.counterparty ?? '', counterpartyReg: c?.counterpartyReg ?? '', endProduct: c?.endProduct ?? '', tradedOn: c?.tradedOn ?? '', documentId: c?.documentId ?? '', note: c?.note ?? '' });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const yrs = Array.from({ length: 8 }, (_, i) => year + 1 - i);
  const tonnes = Number(f.tonnes.replace(/,/g, ''));
  const ok = Number.isFinite(tonnes) && tonnes > 0 && (rec ? (f.direction === 'out' || f.generatedYear != null) : f.year != null);
  const body = (): CertBody => ({ streamId: s.id, direction: f.direction as 'in' | 'out', kind: f.kind as Cert['kind'], year: f.year, generatedYear: f.generatedYear, tonnes, price: f.price.trim() ? Number(f.price.replace(/,/g, '')) : null,
    certificateNo: f.certificateNo.trim() || null, counterparty: f.counterparty.trim() || null, counterpartyReg: f.counterpartyReg.trim() || null, endProduct: f.endProduct.trim() || null, tradedOn: f.tradedOn || null, documentId: f.documentId || null, note: f.note.trim() });
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  const yearSel = (val: number | null, set: (y: number | null) => void, none = false) => <select className="input" value={val ?? ''} onChange={(e) => set(e.target.value ? Number(e.target.value) : null)}>{none && <option value="">—</option>}{yrs.map((y) => <option key={y} value={y}>{periodOf(L.period, y)}</option>)}</select>;
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{s.name}</div><h2>{c ? 'Certificate' : rec ? 'Certificates generated or sold' : 'Certificate bought'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        {rec && <label className="field span2"><span>Type</span><select className="input" value={f.direction} onChange={(e) => up({ direction: e.target.value as 'in' | 'out' })}><option value="in">Generated (from tonnes processed)</option><option value="out">Sold to a producer</option></select></label>}
        <label className="field"><span>Kind</span><select className="input" value={f.kind} onChange={(e) => up({ kind: e.target.value as Cert['kind'] })}>{Object.entries(o.kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Tonnes</span><input className="input num" value={f.tonnes} onChange={(e) => up({ tonnes: e.target.value })} /></label>
        {!rec && <label className="field"><span>Counts for (compliance year)</span>{yearSel(f.year, (y) => up({ year: y }))}</label>}
        {(rec ? f.direction === 'in' : true) && <label className="field"><span>Generated in{rec ? '' : ' (for validity)'}</span>{yearSel(f.generatedYear, (y) => up({ generatedYear: y }), !rec)}</label>}
        {rec && f.direction === 'out' && <label className="field"><span>Sold in</span>{yearSel(f.year, (y) => up({ year: y }))}</label>}
        <label className="field"><span>Price per tonne ({s.currency})</span><input className="input num" value={f.price} onChange={(e) => up({ price: e.target.value })} /></label>
        <label className="field"><span>Date</span><input type="date" className="input" value={f.tradedOn} onChange={(e) => up({ tradedOn: e.target.value })} /></label>
        <label className="field"><span>Certificate number</span><input className="input" value={f.certificateNo} onChange={(e) => up({ certificateNo: e.target.value })} /></label>
        <label className="field"><span>{f.direction === 'out' ? 'Buyer' : rec ? 'Source of the waste' : 'Recycler / processor'}</span><input className="input" value={f.counterparty} onChange={(e) => up({ counterparty: e.target.value })} /></label>
        <label className="field"><span>Their registration no.</span><input className="input" value={f.counterpartyReg} onChange={(e) => up({ counterpartyReg: e.target.value })} /></label>
        {s.regime === 'in_tyre' && <label className="field"><span>End product</span><select className="input" value={f.endProduct} onChange={(e) => up({ endProduct: e.target.value })}><option value="">—</option>{['Reclaimed rubber', 'Crumb rubber', 'Crumb rubber modified bitumen', 'Recovered carbon black', 'Pyrolysis oil / char (continuous)', 'Pyrolysis oil / char (batch)'].map((x) => <option key={x}>{x}</option>)}</select></label>}
        <label className="field span2"><span>Evidence (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{o.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field span2"><span>Note</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
      <div className="row">{c && <button className="btn" onClick={() => go(() => eprApi.deleteCert(c.id))}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
        <button className="btn p" disabled={!ok} onClick={() => go(() => (c ? eprApi.saveCert(c.id, body()) : eprApi.addCert(body())))}>Save</button></div>
    </div></dialog>);
}

function ReturnDrawer({ d, o, year, onClose, onDone }: { d: StreamDetail; o: Overview; year: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const r: YearRow | undefined = d.years.find((x) => x.year === year);
  const [f, setF] = useState({ status: r?.returnStatus ?? 'not_started', filedOn: r?.filedOn ?? '', returnRef: r?.returnRef ?? '', documentId: r?.documentId ?? '' });
  const can = d.canCerts;
  const save = async () => { try { await eprApi.ret(d.stream.id, year, { status: f.status as ReturnStatus, filedOn: f.filedOn || null, returnRef: f.returnRef.trim() || null, documentId: f.documentId || null }); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{d.stream.name}</div><h2>Annual return {periodOf(d.library.period, year)}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="note info small">{d.library.returnNote}{r?.returnDue ? ` — due ${d8(r.returnDue)}` : ''}. Filing locks the year's figures; set it back to in progress to change them.</div>
      <fieldset className="vform plain" disabled={!can}>
        <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ReturnStatus })}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="filed">Filed</option></select></label>
        {f.status === 'filed' && <label className="field"><span>Filed on</span><input type="date" className="input" value={f.filedOn} onChange={(e) => setF({ ...f, filedOn: e.target.value })} /></label>}
        <label className="field"><span>Acknowledgement / reference</span><input className="input" value={f.returnRef} onChange={(e) => setF({ ...f, returnRef: e.target.value })} /></label>
        <label className="field span2"><span>Evidence (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => setF({ ...f, documentId: e.target.value })}><option value="">None</option>{o.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </fieldset>
      <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>{can && <button className="btn p" disabled={f.status === 'filed' && !f.filedOn} onClick={save}>Save</button>}</div>
    </div></dialog>);
}

const mapText = (m: Record<string, number>) => Object.entries(m).sort().map(([y, v]) => `${y}=${v}`).join('; ');
const parseMap = (t: string): Record<string, number> | null => {
  const out: Record<string, number> = {};
  for (const part of t.split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean)) { const m = /^(\d{4})\s*[=:]\s*(\d+(\.\d+)?)%?$/.exec(part); if (!m || Number(m[2]) > 100) return null; out[m[1]!] = Number(m[2]); }
  return out;
};
function StreamDrawer({ o, s, onClose, onDone, onDeleted }: { o: Overview; s: Stream | null; onClose: () => void; onDone: (id?: string) => void; onDeleted: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ regime: (s?.regime ?? 'in_plastic') as Regime, role: s?.role ?? 'brand_owner', category: s?.category ?? 'cat1', name: s?.name ?? '', country: s?.country ?? '', scheme: s?.scheme ?? '', registration: s?.registration ?? '',
    avgLife: s?.avgLife != null ? String(s.avgLife) : '', foodContact: s?.foodContact ?? false, targetPct: mapText(s?.targetPct ?? {}), recyclingPct: mapText(s?.recyclingPct ?? {}), rcPct: mapText(s?.rcPct ?? {}),
    ecRate: s?.ecRate != null ? String(s.ecRate) : '', certPrice: s?.certPrice != null ? String(s.certPrice) : '', feeRate: s?.feeRate != null ? String(s.feeRate) : '', currency: s?.currency ?? 'INR', pro: s?.pro ?? '', registeredOn: s?.registeredOn ?? '', notes: s?.notes ?? '', active: s?.active ?? true });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const L = o.library[f.regime];
  const maps = [parseMap(f.targetPct), parseMap(f.recyclingPct), parseMap(f.rcPct)];
  const n = (t: string) => (t.trim() === '' ? null : Number(t.replace(/,/g, '')));
  const nums = [f.avgLife, f.ecRate, f.certPrice, f.feeRate].every((t) => t.trim() === '' || Number.isFinite(Number(t.replace(/,/g, ''))));
  const needLife = (f.regime === 'in_ewaste' || f.regime === 'in_battery') && f.role !== 'recycler';
  const ok = f.name.trim().length >= 2 && maps.every(Boolean) && nums && (!needLife || f.avgLife.trim() !== '') && (f.regime !== 'eu_ppwr' || /^[A-Z]{2}$/.test(f.country));
  const body = (): StreamBody => ({ regime: f.regime, role: f.role as Stream['role'], category: f.category, name: f.name.trim(), country: f.country ? f.country.toUpperCase() : null, scheme: f.scheme.trim(), registration: f.registration.trim() || null,
    avgLife: n(f.avgLife), foodContact: f.foodContact, targetPct: maps[0]!, recyclingPct: maps[1]!, rcPct: maps[2]!, ecRate: n(f.ecRate), certPrice: n(f.certPrice), feeRate: n(f.feeRate), currency: f.currency.toUpperCase(),
    pro: f.pro.trim() || null, registeredOn: f.registeredOn || null, notes: f.notes.trim(), active: f.active });
  const save = async () => { try { if (s) { await eprApi.saveStream(s.id, body()); toast('Saved'); onDone(); } else { const r = await eprApi.addStream(body()); toast('Stream added'); onDone(r.id); } } catch (e) { toast((e as Error).message); } };
  const del = async () => { if (!s) return; try { await eprApi.deleteStream(s.id); toast('Removed'); onDeleted(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">EPR</div><h2>{s ? s.name : 'Add a stream'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        <label className="field"><span>Regime</span><select className="input" value={f.regime} onChange={(e) => { const r = e.target.value as Regime; up({ regime: r, category: Object.keys(o.library[r].categories)[0]!, currency: r === 'eu_ppwr' ? 'EUR' : r.startsWith('in_') ? 'INR' : f.currency }); }}>{Object.entries(o.library).map(([k, x]) => <option key={k} value={k}>{x.name}</option>)}</select></label>
        <label className="field"><span>Category</span><select className="input" value={f.category} onChange={(e) => up({ category: e.target.value })}>{Object.entries(L.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Role</span><select className="input" value={f.role} onChange={(e) => up({ role: e.target.value as Stream['role'] })}>{Object.entries(o.roles).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Name</span><input className="input" value={f.name} placeholder="e.g. PET bottles and HDPE jars" onChange={(e) => up({ name: e.target.value })} /></label>
        {(f.regime === 'eu_ppwr' || f.regime === 'other') && <label className="field"><span>{f.regime === 'eu_ppwr' ? 'Member state (ISO code)' : 'Country (ISO code)'}</span><input className="input" value={f.country} maxLength={2} placeholder="DE" onChange={(e) => up({ country: e.target.value.toUpperCase() })} /></label>}
        {f.regime === 'other' && <label className="field"><span>Scheme</span><input className="input" value={f.scheme} placeholder="e.g. UAE EPR framework (MOCCAE)" onChange={(e) => up({ scheme: e.target.value })} /></label>}
        <label className="field"><span>Registration no.</span><input className="input" value={f.registration} onChange={(e) => up({ registration: e.target.value })} /></label>
        <label className="field"><span>Registered on</span><input type="date" className="input" value={f.registeredOn} onChange={(e) => up({ registeredOn: e.target.value })} /></label>
        {(f.regime === 'in_ewaste' || f.regime === 'in_battery') && <label className="field"><span>Average life (years){needLife ? '' : ' — optional'}</span><input className="input num" value={f.avgLife} onChange={(e) => up({ avgLife: e.target.value })} /></label>}
        {f.regime === 'in_plastic' && f.role !== 'recycler' && <div className="field"><label className="row small chkline" style={{ gap: 6 }}><input type="checkbox" checked={f.foodContact} onChange={(e) => up({ foodContact: e.target.checked })} />Food-contact packaging (recycled-content shortfall may be carried three years)</label></div>}
        <label className="field"><span>Producer responsibility organisation / agency</span><input className="input" value={f.pro} onChange={(e) => up({ pro: e.target.value })} /></label>
        <h3 className="span2" style={{ margin: '8px 0 0' }}>Money</h3>
        <label className="field"><span>Currency</span><input className="input" maxLength={3} value={f.currency} onChange={(e) => up({ currency: e.target.value.toUpperCase() })} /></label>
        {f.role === 'recycler' ? null : f.regime === 'eu_ppwr' ? <label className="field"><span>PRO fee per tonne</span><input className="input num" value={f.feeRate} onChange={(e) => up({ feeRate: e.target.value })} /></label>
          : <label className="field"><span>Environmental compensation per tonne of shortfall</span><input className="input num" value={f.ecRate} onChange={(e) => up({ ecRate: e.target.value })} /></label>}
        <label className="field"><span>Certificate price per tonne (assumed)</span><input className="input num" value={f.certPrice} onChange={(e) => up({ certPrice: e.target.value })} /></label>
        {f.role !== 'recycler' && <>
        <h3 className="span2" style={{ margin: '8px 0 0' }}>Targets from the portal (replace the library's)</h3>
        <div className="note info small span2">Year = the year the period ends in{L.period === 'india_fy' ? ' (2027 = FY 2026-27)' : ''}. Write <code>2026=70; 2027=80</code>. Leave empty to use the regime's published targets.</div>
        <label className="field"><span>Obligation %</span><input className={`input ${maps[0] ? '' : 'bad'}`} value={f.targetPct} onChange={(e) => up({ targetPct: e.target.value })} /></label>
        {f.regime === 'in_plastic' && <label className="field"><span>Recycling share %</span><input className={`input ${maps[1] ? '' : 'bad'}`} value={f.recyclingPct} onChange={(e) => up({ recyclingPct: e.target.value })} /></label>}
        <label className="field"><span>Recycled content %</span><input className={`input ${maps[2] ? '' : 'bad'}`} value={f.rcPct} onChange={(e) => up({ rcPct: e.target.value })} /></label>
        </>}
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
        {s && <div className="field span2"><label className="row small chkline" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => up({ active: e.target.checked })} />Active</label></div>}
        <div className="note small span2">{L.notes}</div>
      </div>
      <div className="row">{s && <button className="btn" onClick={del}>Delete</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={!ok} onClick={save}>Save</button></div>
    </div></dialog>);
}
