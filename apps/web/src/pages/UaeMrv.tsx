/**
 * UAE MRV (Disclose → UAE MRV, or its own menu without the GHG inventory).
 *   Overview   who reports what: each facility against EAD's 25,000 t threshold, the federal position, the calendar
 *   Facility   one Abu Dhabi facility's year: source streams with tiers and classes, production and QA, verification
 *              and data gaps, mitigation measures, monitoring plan; the EAD template sheets in Excel
 *   Federal    designation, NRCC registration above 0.5 MtCO₂e, the national MRV system (IEQT) submission, the data pack
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import {
  lastYear, mrvApi,
  type CompanyBody, type Detail, type Facility, type FacilityBody, type Kind, type Materiality, type Measure, type MeasureBody, type Overview, type Stream, type YearBody, type YearStatus,
} from '../lib/uaeMrv';

const t0 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 0 }));
const t2 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const d8 = (x: string | null | undefined) => (x ? new Date(`${x.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const okNum = (v: string) => v.trim() === '' || Number.isFinite(Number(v.replace(/,/g, '')));
const parse = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
const s = (x: number | null | undefined) => (x == null ? '' : String(x));
const KIND: Record<Kind, string> = { combustion: 'Fuel combustion', process: 'Process', mass_balance: 'Mass balance', measured: 'Measured (CEMS)', gas: 'Other gas released' };
const CLASS: Record<Materiality, string> = { de_minimis: 'De minimis', minor: 'Minor', major: 'Major' };
const STATUS: Record<YearStatus, [string, string]> = { draft: ['grey', 'Draft'], ready: ['info', 'Ready'], submitted: ['', 'Submitted to EAD'], verified: ['', 'Verified'] };
const EAD_CHIP: Record<string, [string, string]> = { required: ['warn', 'Must report'], below: ['grey', 'Below 25,000 t'], voluntary: ['grey', 'Voluntary'], not_abu_dhabi: ['grey', 'Not Abu Dhabi'], unknown: ['grey', 'To check'] };

export function UaeMrv() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const year = sp.get('y') ? Number(sp.get('y')) : lastYear();
  const tab = sp.get('tab') ?? 'overview';
  const [o, setO] = useState<Overview | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const reload = () => setTick((x) => x + 1);
  useEffect(() => { let live = true; mrvApi.overview(year).then((x) => { if (live) setO(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return <div className="page"><div className="card empty">Loading…</div></div>;
  const fid = sp.get('f') ?? o.facilities.find((f) => f.ead.status === 'required')?.id ?? o.facilities[0]?.id ?? null;
  const years = [...new Set([year, lastYear(), lastYear() + 1, lastYear() - 1])].sort((a, b) => b - a);
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose · UAE</span><h1>UAE MRV</h1>
          <div className="muted">Abu Dhabi facility MRV (EAD Resolution No. 3 of 2026): Scope 1 per facility, source streams, tiers and verification. Federal reporting (Federal Decree-Law No. 11 of 2024, Cabinet Resolution No. 67 of 2024): Scope 1 and 2 on the national MRV system, and the National Register for Carbon Credits from 0.5 MtCO₂e.</div></div>
        <label className="field" style={{ minWidth: 120 }}><span>Reporting year</span>
          <select className="input" value={year} onChange={(e) => set('y', e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <button className="btn" onClick={() => mrvApi.exportFederal(year).catch((e) => toast((e as Error).message))}><Icon name="download" /> Federal pack (Excel)</button>
        {o.canSetup && <button className="btn p" onClick={() => setAdding(true)}>+ Reporting facility</button>}
      </div>
      <div className="seg strong" role="tablist" style={{ margin: '4px 0 12px' }}>
        {([['overview', 'Overview'], ['facility', `Facility MRV (EAD)${o.facilities.length ? ` · ${o.facilities.length}` : ''}`], ['federal', 'Federal (MOCCAE)']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set('tab', k === 'overview' ? null : k)}>{l}</button>))}
      </div>
      {tab === 'overview' && <OverviewTab o={o} open={(id) => { const n = new URLSearchParams(sp); n.set('tab', 'facility'); n.set('f', id); setSp(n, { replace: true }); }} onAdd={() => setAdding(true)} />}
      {tab === 'facility' && (fid ? <FacilityTab key={`${fid}:${year}`} o={o} id={fid} year={year} pick={(x) => set('f', x)} onChanged={reload} />
        : <div className="card" style={{ padding: 24 }}><h3 style={{ marginTop: 0 }}>No reporting facility yet</h3><p className="muted">Add each facility that reports to EAD (or that you track for the federal report): its emirate, sector and EAD identifiers.</p>{o.canSetup && <button className="btn p" onClick={() => setAdding(true)}>+ Reporting facility</button>}</div>)}
      {tab === 'federal' && <FederalTab key={o.year} o={o} onSaved={reload} />}
      {adding && <FacilityDrawer o={o} f={null} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); if (id) { const n = new URLSearchParams(sp); n.set('tab', 'facility'); n.set('f', id); setSp(n, { replace: true }); } reload(); }} />}
    </div>);
}

// ------------------------------------------------------------------------------------------ overview --
function OverviewTab({ o, open, onAdd }: { o: Overview; open: (id: string) => void; onAdd: () => void }) {
  const must = o.facilities.filter((f) => f.ead.status === 'required');
  const F = o.federal;
  const next = o.calendar.find((c) => c.date >= today());
  const share = F.total != null ? Math.min(1, F.total / o.thresholds.nrcc) : 0;
  return (
    <>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Facilities that must report to EAD</span><b>{must.length} <small className="muted">of {o.facilities.length}</small></b>
          <span className="muted small">25,000 tCO₂e of CO₂ and methane, covered sectors in Abu Dhabi</span></div>
        <div className="card kpi"><span className="muted small">Scope 1 of the reporting facilities, {o.year}</span><b>{t0(o.facilities.reduce((a, f) => a + f.result.total, 0))} <small className="muted">tCO₂e</small></b>
          <span className="muted small">{o.facilities.reduce((a, f) => a + f.result.problems, 0)} checks open</span></div>
        <div className="card kpi"><span className="muted small">Company Scope 1 + 2 in the UAE</span><b>{t0(F.total)} <small className="muted">tCO₂e</small></b>
          <div className="bar" style={{ height: 6, background: 'var(--bg)', borderRadius: 4, margin: '4px 0' }}><div style={{ width: `${share * 100}%`, height: 6, borderRadius: 4, background: F.large ? 'var(--warn)' : 'var(--primary)' }} /></div>
          <span className="muted small">{F.large ? 'At or above 0.5 Mt: NRCC registration and verification' : `${t0(o.thresholds.nrcc)} t NRCC threshold`} · {F.source === 'entries' ? 'from entries' : F.source === 'typed' ? 'typed' : F.source === 'facilities' ? 'facility reports (Scope 1)' : 'no figures'}</span></div>
        <div className="card kpi"><span className="muted small">Next date</span><b style={{ fontSize: 18 }}>{next ? d8(next.date) : '—'}</b><span className="muted small">{next?.what ?? 'Nothing due'}</span></div>
      </div>
      <div className="card flush" style={{ marginTop: 12 }}>
        <div className="row vfilters"><b className="grow">Reporting facilities, {o.year}</b>{o.canSetup && <button className="btn sm" onClick={onAdd}>+ Reporting facility</button>}</div>
        {!o.facilities.length ? <div className="empty" style={{ padding: 18 }}>No reporting facility yet.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>Facility</th><th>Emirate</th><th>Sector</th><th className="num">Scope 1 tCO₂e</th><th className="num">CO₂ + CH₄ vs 25,000 t</th><th>EAD</th><th className="ctr">Report</th><th className="num">Checks</th></tr></thead>
            <tbody>{o.facilities.map((f) => (
              <tr key={f.id} className="click" onClick={() => open(f.id)} style={{ cursor: 'pointer' }}>
                <td><b>{f.name}</b>{f.eadId && <div className="muted small">{f.eadId}</div>}</td><td>{o.emirates[f.emirate]}</td><td className="small">{o.sectors[f.sector].label}</td>
                <td className="num">{t0(f.result.total)}</td><td className="num">{f.result.streams ? `${Math.round((f.result.direct / o.thresholds.ead) * 100)}%` : '—'}</td>
                <td><span className={`chip ${EAD_CHIP[f.ead.status]![0]}`} title={f.ead.text}>{EAD_CHIP[f.ead.status]![1]}</span></td>
                <td className="ctr"><span className={`chip ${STATUS[f.status][0]}`}>{STATUS[f.status][1]}</span></td>
                <td className="num">{f.result.problems ? <span className="warn-t">{f.result.problems}</span> : <span className="muted">0</span>}</td></tr>))}</tbody>
          </table></div>)}
      </div>
      <div className="card" style={{ marginTop: 12 }}><h3 style={{ margin: '0 0 8px' }}>Calendar {o.year}</h3>
        <table className="t small"><tbody>{o.calendar.map((c, i) => <tr key={i} className={c.date < today() ? 'muted' : ''}><td className="nowrap">{d8(c.date)}</td><td><span className="chip grey">{c.who}</span></td><td>{c.what}</td></tr>)}</tbody></table>
      </div>
    </>);
}

// ------------------------------------------------------------------------------------------ facility --
function FacilityTab({ o, id, year, pick, onChanged }: { o: Overview; id: string; year: number; pick: (id: string) => void; onChanged: () => void }) {
  const { toast, can } = useApp();
  const [sp, setSp] = useSearchParams();
  const sub = sp.get('s') ?? 'streams';
  const setSub = (v: string) => { const n = new URLSearchParams(sp); if (v === 'streams') n.delete('s'); else n.set('s', v); setSp(n, { replace: true }); };
  const [d, setD] = useState<Detail | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = () => { setTick((x) => x + 1); onChanged(); };
  useEffect(() => { let live = true; mrvApi.detail(id, year).then((x) => { if (live) setD(x); }).catch((e) => toast((e as Error).message)); return () => { live = false; }; }, [id, year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  const R = d.result, locked = d.year.status === 'submitted' || d.year.status === 'verified';
  const fill = async () => {
    setBusy(true);
    try { const r = await mrvApi.fromEntries(id, year); toast(`From entries: ${r.added} added, ${r.updated} refreshed${r.kept ? `, ${r.kept} kept on their own units` : ''}${r.removed ? `, ${r.removed} removed` : ''}${r.skipped ? `, ${r.skipped} you removed left out` : ''}`); reload(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const open = d.problems.length + R.streams.filter((x) => !x.ok).length;
  return (
    <>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <label className="field" style={{ minWidth: 260 }}><span>Facility</span>
          <select className="input" value={id} onChange={(e) => pick(e.target.value)}>{o.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <span className={`chip ${STATUS[d.year.status][0]}`} style={{ alignSelf: 'end', marginBottom: 8 }}>{STATUS[d.year.status][1]}</span>
        <span className="grow" />
        {d.ekotrace && d.facility.nodeId && d.canData && !locked && <button className="btn" disabled={busy} onClick={fill}><Icon name="feed" /> {d.streams.some((x) => x.entryKey) ? 'Refresh from entries' : 'Fill from entries'}</button>}
        <button className="btn" onClick={() => mrvApi.exportFacility(id, year, d.facility.name).catch((e) => toast((e as Error).message))}><Icon name="download" /> EAD report (Excel)</button>
        {d.canSetup && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Facility</button>}
      </div>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Scope 1, {year}</span><b>{t0(R.total)} <small className="muted">tCO₂e</small></b>
          <span className="muted small">{R.byGas.map((g) => `${g.gas} ${t0(g.co2e)}`).join(' · ') || 'No source streams'} · GWP {d.gwpSet}</span></div>
        <div className="card kpi"><span className="muted small">CO₂ and methane against 25,000 t</span><b>{t0(R.direct)} <small className="muted">t</small></b>
          <span className="muted small">{d.ead.text}</span></div>
        <div className="card kpi"><span className="muted small">Whole-facility uncertainty</span><b>{R.uncertainty == null ? '—' : `±${R.uncertainty.toFixed(1)}%`}</b>
          <span className="muted small">{R.uncertaintyComplete ? "From the streams' activity-data uncertainty" : 'Incomplete: some streams have no uncertainty'}{d.streams.some((x) => x.fallback) ? ' · fallback: at most ±7.5%' : ''}</span></div>
        <div className="card kpi"><span className="muted small">Checks</span><b>{open}</b><span className="muted small">{R.streams.filter((x) => x.ok).length} of {R.streams.length} streams complete</span></div>
      </div>
      {d.problems.length > 0 && <div className="note warn small" style={{ marginTop: 10 }}>{d.problems.map((p, i) => <div key={i}>{p}</div>)}</div>}
      {locked && <div className="note info small" style={{ marginTop: 10 }}>The {year} report is {d.year.status === 'verified' ? 'verified' : 'submitted'} ({d8(d.year.submittedOn)}{d.year.reference ? `, ref. ${d.year.reference}` : ''}): it is locked. A super admin or admin sets it back to Ready to change it.</div>}
      <div className="seg" role="tablist" style={{ margin: '12px 0' }}>
        {([['streams', `Source streams (${d.streams.length})`], ['production', 'Production & QA'], ['verification', 'Verification & data gaps'], ['mitigation', `Mitigation (${d.measures.length})`], ['plan', 'Monitoring plan & dates']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => setSub(k)}>{l}</button>))}
      </div>
      {sub === 'streams' && <StreamsView o={o} d={d} locked={locked} onSaved={reload} />}
      {sub === 'production' && <ProductionView d={d} locked={locked} onSaved={reload} />}
      {sub === 'verification' && <VerificationView d={d} locked={locked} onSaved={reload} />}
      {sub === 'mitigation' && <Measures o={o} list={d.measures} facilityId={id} canEdit={can('super_admin', 'admin', 'manager')} onSaved={reload} />}
      {sub === 'plan' && <PlanView d={d} />}
      {editing && <FacilityDrawer o={o} f={d.facility} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </>);
}

function StreamsView({ o, d, locked, onSaved }: { o: Overview; d: Detail; locked: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState<Stream | 'new' | null>(null);
  const R = new Map(d.result.streams.map((r) => [r.id, r]));
  const fuel = (c?: string | null) => o.fuels.find((f) => f.code === c);
  const total = d.result.total;
  const save = async (list: Stream[]) => { await mrvApi.saveStreams(d.facility.id, d.year.year, list, d.year.updatedAt); onSaved(); };
  return (
    <div className="card flush">
      <div className="row vfilters"><div className="grow"><b>Source streams</b>
        <div className="muted small">Classes from the totals: de minimis below {t0(d.result.thresholds.deMinimis)} t together, minor below {t0(d.result.thresholds.minor)} t; major streams need Tier 2 (±5%), minor Tier 1 (±7.5%).</div></div>
        {d.canData && !locked && <button className="btn sm p" onClick={() => setOpen('new')}>+ Source stream</button>}</div>
      {!d.streams.length ? <div className="empty" style={{ padding: 18 }}>{d.ekotrace && d.facility.nodeId ? 'No source streams yet: fill them from the inventory entries, or add them.' : 'No source streams yet.'}</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Source stream</th><th>Type</th><th className="num">Activity</th><th className="num">TJ</th><th className="num">tCO₂e</th><th className="num">Share</th><th>Class</th><th className="ctr">Tier</th><th>Status</th></tr></thead>
          <tbody>{d.streams.map((x) => {
            const r = R.get(x.id)!;
            const act = x.kind === 'measured' ? `${t2(x.measuredCo2)} t CO₂` : x.kind === 'gas' ? `${t2(x.gasT)} t ${x.gas ?? ''}` : `${t2(x.adQty)} ${x.adUnit ?? 't'}`;
            return (
              <tr key={x.id} className="click" style={{ cursor: 'pointer' }} onClick={() => setOpen(x)}>
                <td style={{ minWidth: 220 }}><b>{x.name}</b><div className="muted small">{[fuel(x.fuel)?.name ?? x.material, x.mobile && 'fleet', x.entryKey && `from ${x.entries ?? 0} ${x.entries === 1 ? 'entry' : 'entries'}`, x.fallback && 'fallback'].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{KIND[x.kind]}</td><td className="num small">{act}</td><td className="num small">{r.tj == null ? '—' : t2(r.tj)}</td>
                <td className="num"><b>{t0(r.co2e)}</b>{r.co2Bio > 0 && <div className="muted small">+{t0(r.co2Bio)} bio</div>}</td>
                <td className="num small">{total ? `${((r.co2e / total) * 100).toFixed(1)}%` : '—'}</td>
                <td className="small">{CLASS[r.materiality]}{x.materiality && x.materiality !== r.autoMateriality && <span className="warn-t"> *</span>}</td>
                <td className="ctr small">{x.kind === 'measured' || x.kind === 'gas' ? <span className="muted">—</span> : r.tier == null ? <span className="muted">?</span> : <span className={`chip ${r.tierRequired && r.tier < r.tierRequired ? 'bad' : ''}`}>{r.tier ? `T${r.tier}` : '<T1'}{r.tierRequired ? ` / T${r.tierRequired}` : ''}</span>}</td>
                <td className="small">{r.ok ? <span className="chip">Complete</span> : <span className="warn-t" title={r.problems.join('\n')}>{r.problems[0]}{r.problems.length > 1 ? ` (+${r.problems.length - 1})` : ''}</span>}</td>
              </tr>);
          })}</tbody>
          <tfoot><tr><td colSpan={4}><b>Total</b>{d.result.co2Bio > 0 && <span className="muted small"> · biogenic CO₂ {t0(d.result.co2Bio)} t reported apart</span>}</td><td className="num"><b>{t0(total)}</b></td><td colSpan={4} /></tr></tfoot>
        </table></div>)}
      {open && <StreamDrawer o={o} d={d} st={open === 'new' ? null : open} locked={locked} onClose={() => setOpen(null)}
        onSave={async (x) => { const list = open === 'new' ? [...d.streams, x] : d.streams.map((y) => (y.id === x.id ? x : y)); await save(list); setOpen(null); }}
        onRemove={async () => { if (open === 'new') return; await save(d.streams.filter((y) => y.id !== open.id)); setOpen(null); }} />}
    </div>);
}

function StreamDrawer({ o, d, st, locked, onClose, onSave, onRemove }: { o: Overview; d: Detail; st: Stream | null; locked: boolean; onClose: () => void; onSave: (s: Stream) => Promise<void>; onRemove: () => Promise<void> }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({
    name: st?.name ?? '', kind: st?.kind ?? 'combustion' as Kind, fuel: st?.fuel ?? '', material: st?.material ?? '', mobile: !!st?.mobile, fallback: !!st?.fallback,
    adQty: s(st?.adQty), adUnit: st?.adUnit ?? 't', addToFederal: !!st?.addToFederal, density: s(st?.density), ncv: s(st?.ncv), ef: s(st?.ef), of: s(st?.of), carbon: s(st?.carbon), direction: st?.direction ?? 'input',
    biomass: s(st?.biomass), ch4Ef: s(st?.ch4Ef), n2oEf: s(st?.n2oEf), measuredCo2: s(st?.measuredCo2), measuredCh4: s(st?.measuredCh4), gas: st?.gas ?? '', gasT: s(st?.gasT),
    uncertainty: s(st?.uncertainty), materiality: st?.materiality ?? '', instrument: st?.instrument ?? '', efSource: st?.efSource ?? '', note: st?.note ?? '', documentId: st?.documentId ?? '',
  });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const fu = o.fuels.find((x) => x.code === f.fuel);
  const nums = [f.adQty, f.density, f.ncv, f.ef, f.of, f.carbon, f.biomass, f.ch4Ef, f.n2oEf, f.measuredCo2, f.measuredCh4, f.gasT, f.uncertainty];
  const ok = f.name.trim().length > 0 && nums.every(okNum) && [f.of, f.biomass, f.carbon].every((v) => (parse(v) ?? 0) <= 1);
  const r = st ? d.result.streams.find((x) => x.id === st.id) : undefined;
  const body = (): Stream => ({
    ...(st ?? {}), id: st?.id ?? `s${Date.now().toString(36)}`, name: f.name.trim(), kind: f.kind, fuel: f.fuel || null, material: f.material.trim() || null, mobile: f.mobile, fallback: f.fallback,
    adQty: parse(f.adQty), adUnit: f.adUnit as Stream['adUnit'], density: parse(f.density), ncv: parse(f.ncv), ef: parse(f.ef), of: parse(f.of), carbon: parse(f.carbon), direction: f.direction as 'input' | 'output',
    biomass: parse(f.biomass), ch4Ef: parse(f.ch4Ef), n2oEf: parse(f.n2oEf), measuredCo2: parse(f.measuredCo2), measuredCh4: parse(f.measuredCh4), gas: f.gas || null, gasT: parse(f.gasT), addToFederal: (f.kind === 'process' || f.kind === 'mass_balance') && f.addToFederal,
    uncertainty: parse(f.uncertainty), materiality: (f.materiality || null) as Materiality | null, instrument: f.instrument.trim(), efSource: f.efSource.trim(), note: f.note.trim(), documentId: f.documentId || null,
  });
  const go = async (fn: () => Promise<void>) => { try { await fn(); toast('Saved'); } catch (e) { toast((e as Error).message); } };
  const num = (k: keyof typeof f, label: string, ph = '') => <label className="field"><span>{label}</span><input className="input num" inputMode="decimal" value={f[k] as string} placeholder={ph} disabled={locked} onChange={(e) => up({ [k]: e.target.value } as Partial<typeof f>)} /></label>;
  const calc = f.kind === 'combustion' || f.kind === 'process' || f.kind === 'mass_balance';
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{d.facility.name} · {d.year.year}</div><h2>{st ? st.name : 'Add a source stream'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      {r && <div className={`note ${r.ok ? 'info' : 'warn'} small`}>{t2(r.co2e)} tCO₂e{r.tj != null ? ` from ${t2(r.tj)} TJ` : ''} · CO₂ {t2(r.co2)} t{r.co2Bio ? ` (+${t2(r.co2Bio)} t biogenic)` : ''} · CH₄ {t2(r.ch4)} t · N₂O {t2(r.n2o)} t · {CLASS[r.autoMateriality]} by the totals{r.problems.map((p, i) => <div key={i}>• {p}</div>)}</div>}
      {st?.entryKey && <div className="note info small">Filled from {st.entries} approved inventory entries ({t2(st.entriesT)} tCO₂e there with the inventory's own factors). Refreshing updates the quantity and keeps what you set here.</div>}
      <fieldset className="vform plain" disabled={locked}>
        <label className="field span2"><span>Source stream</span><input className="input" value={f.name} placeholder="e.g. Natural gas to gas turbines GT1–GT3" onChange={(e) => up({ name: e.target.value })} /></label>
        <label className="field"><span>Type</span><select className="input" value={f.kind} onChange={(e) => { const k = e.target.value as Kind; up({ kind: k, ...(k !== 'combustion' && (f.adUnit === 'TJ' || f.adUnit === 'kNm3') ? { adUnit: 't' as const } : {}) }); }}>{(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></label>
        {f.kind === 'combustion' ? <label className="field"><span>Fuel (IPCC 2006 defaults)</span><select className="input" value={f.fuel} onChange={(e) => up({ fuel: e.target.value })}><option value="">— own factors —</option>{o.fuels.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
          : f.kind === 'gas' ? <label className="field"><span>Gas</span><select className="input" value={f.gas} onChange={(e) => up({ gas: e.target.value })}><option value="">—</option>{o.gases.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}</select></label>
            : <label className="field"><span>Material / source</span><input className="input" value={f.material} placeholder={f.kind === 'process' ? 'e.g. Limestone (CaCO₃)' : f.kind === 'mass_balance' ? 'e.g. Coking coal in, steel out' : 'e.g. Stack 2 (CEMS)'} onChange={(e) => up({ material: e.target.value })} /></label>}
        {calc && <>
          {num('adQty', 'Activity data')}
          <label className="field"><span>Unit</span><select className="input" value={f.adUnit} onChange={(e) => up({ adUnit: e.target.value as typeof f.adUnit })}>
            <option value="t">tonnes</option>{f.kind === 'combustion' && <option value="TJ">TJ (net calorific)</option>}{f.kind === 'combustion' && <option value="kNm3">thousand Nm³</option>}<option value="kL">kL (with density)</option></select></label>
          {f.adUnit === 'kL' && num('density', 't per kL', fu?.density ? String(fu.density) : '')}
          {f.kind === 'combustion' && f.adUnit !== 'TJ' && num('ncv', f.adUnit === 'kNm3' ? 'NCV, TJ per thousand Nm³' : 'NCV, TJ per t', f.adUnit === 'kNm3' ? (f.fuel === 'natural_gas' ? '0.036' : '') : fu ? String(fu.ncv / 1000) : '')}
          {f.kind !== 'mass_balance' && num('ef', f.kind === 'combustion' ? 'Emission factor, tCO₂/TJ' : 'Emission factor, tCO₂ per t', fu ? String(fu.co2) : '')}
          {f.kind !== 'mass_balance' && num('of', f.kind === 'combustion' ? 'Oxidation factor (0–1)' : 'Conversion factor (0–1)', '1')}
          {f.kind === 'mass_balance' && <>{num('carbon', 'Carbon content, t C per t')}
            <label className="field"><span>Carbon</span><select className="input" value={f.direction} onChange={(e) => up({ direction: e.target.value as 'input' | 'output' })}><option value="input">In (adds CO₂)</option><option value="output">Out in products or waste (deducted)</option></select></label></>}
          {f.kind === 'combustion' && <>{num('ch4Ef', 'CH₄, kg/TJ', fu ? String(f.mobile ? fu.ch4Mobile ?? fu.ch4 : fu.ch4) : '')}{num('n2oEf', 'N₂O, kg/TJ', fu ? String(f.mobile ? fu.n2oMobile ?? fu.n2o : fu.n2o) : '')}
            <label className="row small chkline" style={{ gap: 6 }}><input type="checkbox" checked={f.mobile} onChange={(e) => up({ mobile: e.target.checked })} />Road or rail fleet (mobile CH₄ and N₂O)</label></>}
          {num('biomass', 'Biomass fraction (0–1)', fu?.biogenic ? '1' : '0')}
        </>}
        {f.kind === 'measured' && <>{num('measuredCo2', 'CO₂ measured, t')}{num('measuredCh4', 'CH₄ measured, t')}{num('biomass', 'Biomass fraction of the CO₂ (0–1)', '0')}</>}
        {f.kind === 'gas' && num('gasT', 'Released, tonnes of gas')}
        {num('uncertainty', f.kind === 'measured' ? 'Measurement uncertainty, ±%' : 'Activity-data uncertainty, ±%', 'e.g. 2.5')}
        <label className="field"><span>Class</span><select className="input" value={f.materiality} onChange={(e) => up({ materiality: e.target.value })}><option value="">Worked out from the totals</option>{(Object.keys(CLASS) as Materiality[]).map((k) => <option key={k} value={k}>{CLASS[k]}</option>)}</select></label>
        <label className="field"><span>Measuring instrument</span><input className="input" value={f.instrument} placeholder="e.g. Coriolis meter FT-201, calibrated 03/2025" onChange={(e) => up({ instrument: e.target.value })} /></label>
        <label className="field"><span>Factor source</span><input className="input" value={f.efSource} placeholder="IPCC 2006 default / supplier certificate / lab analysis" onChange={(e) => up({ efSource: e.target.value })} /></label>
        {d.ekotrace && d.facility.nodeId && (f.kind === 'process' || f.kind === 'mass_balance') && <label className="row small chkline span2" style={{ gap: 6 }}><input type="checkbox" checked={f.addToFederal} onChange={(e) => up({ addToFederal: e.target.checked })} />Not in the inventory entries: add to the federal Scope 1 (leave off if the fuels or materials are already entered)</label>}
        {calc && <label className="row small chkline span2" style={{ gap: 6 }}><input type="checkbox" checked={f.fallback} onChange={(e) => up({ fallback: e.target.checked })} />Fallback approach: no tier is technically feasible or the cost is unreasonable (say why below)</label>}
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
        <label className="field span2"><span>Evidence (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </fieldset>
      <div className="row">{st && d.canData && !locked && <button className="btn" onClick={() => go(onRemove)}>Remove</button>}<span className="grow" />
        <button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>{d.canData && !locked && <button className="btn p" disabled={!ok} onClick={() => go(() => onSave(body()))}>Save</button>}</div>
    </div></dialog>);
}

const yearBody = (d: Detail): YearBody => ({ status: d.year.status, submittedOn: d.year.submittedOn, reference: d.year.reference, production: d.year.production, gaps: d.year.gaps, qa: d.year.qa, verifNotified: d.year.verifNotified, siteVisit: d.year.siteVisit, verifiedOn: d.year.verifiedOn, opinion: d.year.opinion, statementDoc: d.year.statementDoc });

function ProductionView({ d, locked, onSaved }: { d: Detail; locked: boolean; onSaved: () => void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(d.year.production.map((p) => ({ product: p.product, qty: s(p.qty), unit: p.unit })));
  const [qa, setQa] = useState(d.year.qa);
  const ok = rows.every((r) => okNum(r.qty) && (r.product.trim() || (!r.qty && !r.unit)));
  const save = async () => {
    try { await mrvApi.saveYear(d.facility.id, d.year.year, { ...yearBody(d), production: rows.filter((r) => r.product.trim()).map((r) => ({ product: r.product.trim(), qty: parse(r.qty), unit: r.unit.trim() })), qa }); toast('Saved'); onSaved(); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card">
      <h3 style={{ margin: '0 0 4px' }}>Production (sheet C2)</h3>
      <div className="muted small" style={{ marginBottom: 8 }}>Products and quantities for EAD's benchmarking; they do not change the emissions. Intensity = Scope 1 ÷ quantity.</div>
      <table className="t small"><thead><tr><th>Product</th><th className="num">Quantity</th><th>Unit</th><th className="num">tCO₂e per unit</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}><td><input className="input" value={r.product} disabled={locked} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))} /></td>
            <td><input className="input num" inputMode="decimal" value={r.qty} disabled={locked} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
            <td><input className="input" style={{ width: 90 }} value={r.unit} disabled={locked} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} /></td>
            <td className="num">{parse(r.qty) ? (d.result.total / parse(r.qty)!).toFixed(4) : '—'}</td>
            <td>{!locked && <button className="btn sm ghost" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="x" /></button>}</td></tr>))}</tbody></table>
      {!locked && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setRows([...rows, { product: '', qty: '', unit: 't' }])}>+ Product</button>}
      <h3 style={{ margin: '18px 0 4px' }}>Management and quality assurance (sheet I)</h3>
      <div className="muted small" style={{ marginBottom: 6 }}>Responsibilities, calibration and maintenance of instruments, data checks, document control, how errors are corrected (within 30 days).</div>
      <textarea className="input" rows={6} value={qa} disabled={locked} onChange={(e) => setQa(e.target.value)} style={{ width: '100%' }} />
      {d.canData && !locked && <div className="row" style={{ marginTop: 10 }}><span className="grow" /><button className="btn p" disabled={!ok} onClick={save}>Save</button></div>}
    </div>);
}

function VerificationView({ d, locked, onSaved }: { d: Detail; locked: boolean; onSaved: () => void }) {
  const { toast } = useApp();
  const Y = d.year;
  const [f, setF] = useState({ status: Y.status, submittedOn: Y.submittedOn ?? '', reference: Y.reference ?? '', verifNotified: Y.verifNotified ?? '', siteVisit: Y.siteVisit ?? '', verifiedOn: Y.verifiedOn ?? '', opinion: Y.opinion ?? '', statementDoc: Y.statementDoc ?? '' });
  const [gaps, setGaps] = useState(Y.gaps.map((g) => ({ description: g.description, approach: g.approach, t: s(g.t) })));
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const save = async () => {
    try {
      await mrvApi.saveYear(d.facility.id, Y.year, {
        ...yearBody(d), status: f.status, submittedOn: f.submittedOn || null, reference: f.reference.trim() || null, verifNotified: f.verifNotified || null, siteVisit: f.siteVisit || null, verifiedOn: f.verifiedOn || null,
        opinion: (f.opinion || null) as YearBody['opinion'], statementDoc: f.statementDoc || null, gaps: gaps.filter((g) => g.description.trim()).map((g) => ({ description: g.description.trim(), approach: g.approach.trim(), t: parse(g.t) })),
      });
      toast('Saved'); onSaved();
    } catch (e) { toast((e as Error).message); }
  };
  const date = (k: keyof typeof f, label: string) => <label className="field"><span>{label}</span><input type="date" className="input" value={f[k]} onChange={(e) => up({ [k]: e.target.value } as Partial<typeof f>)} /></label>;
  const need = Y.year >= 2026;
  return (
    <div className="card">
      <div className="note info small">{need ? `Reporting year ${Y.year} must be verified by an ISO 14065-accredited verifier: notify EAD of the planned verification by 1 July ${Y.year}, start by mid-year with a site visit, and submit the statement with the report by 31 March ${Y.year + 1}.` : `Verification is voluntary for ${Y.year}; it is required from reporting year 2026.`} A verifier may serve the same facility at most 6 consecutive years{d.facility.verifier ? ` — ${d.facility.verifier}${d.facility.verifierSince ? ` since ${d.facility.verifierSince}` : ''}` : ''}.</div>
      <div className="vform">
        <label className="field"><span>Report status</span><select className="input" value={f.status} disabled={!d.canSetup} onChange={(e) => up({ status: e.target.value as YearStatus })}>
          {(Object.keys(STATUS) as YearStatus[]).map((k) => <option key={k} value={k}>{STATUS[k][1]}</option>)}</select></label>
        {date('submittedOn', 'Submitted to EAD on')}
        <label className="field"><span>EAD reference</span><input className="input" value={f.reference} onChange={(e) => up({ reference: e.target.value })} /></label>
        {date('verifNotified', 'Planned verification notified on')}
        {date('siteVisit', 'Site visit')}
        {date('verifiedOn', 'Verification statement dated')}
        <label className="field"><span>Opinion</span><select className="input" value={f.opinion} onChange={(e) => up({ opinion: e.target.value })}><option value="">—</option><option value="unmodified">Unmodified</option><option value="modified">Modified (qualified)</option><option value="adverse">Adverse</option></select></label>
        <label className="field"><span>Verification statement (Document vault)</span><select className="input" value={f.statementDoc} onChange={(e) => up({ statementDoc: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
      <h3 style={{ margin: '16px 0 4px' }}>Data gaps (sheet H1)</h3>
      <div className="muted small" style={{ marginBottom: 6 }}>Missing or faulty data in the year, the approach used to close the gap (e.g. average of neighbouring months, conservative estimate) and the emissions affected.</div>
      <table className="t small"><thead><tr><th>Data gap</th><th>Approach used</th><th className="num">tCO₂e affected</th><th /></tr></thead>
        <tbody>{gaps.map((g, i) => (
          <tr key={i}><td><input className="input" value={g.description} disabled={locked} onChange={(e) => setGaps(gaps.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} /></td>
            <td><input className="input" value={g.approach} disabled={locked} onChange={(e) => setGaps(gaps.map((x, j) => (j === i ? { ...x, approach: e.target.value } : x)))} /></td>
            <td><input className="input num" style={{ width: 110 }} value={g.t} disabled={locked} onChange={(e) => setGaps(gaps.map((x, j) => (j === i ? { ...x, t: e.target.value } : x)))} /></td>
            <td>{!locked && <button className="btn sm ghost" aria-label="Remove" onClick={() => setGaps(gaps.filter((_, j) => j !== i))}><Icon name="x" /></button>}</td></tr>))}</tbody></table>
      {!locked && <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setGaps([...gaps, { description: '', approach: '', t: '' }])}>+ Data gap</button>}
      {d.canData && <div className="row" style={{ marginTop: 12 }}><span className="grow" /><button className="btn p" disabled={!gaps.every((g) => okNum(g.t))} onClick={save}>Save</button></div>}
    </div>);
}

function PlanView({ d }: { d: Detail }) {
  const F = d.facility;
  const row = (k: string, v: ReactNode) => <tr><td className="muted" style={{ width: 260 }}>{k}</td><td>{v}</td></tr>;
  return (
    <div className="ccgrid">
      <div className="card"><h3 style={{ margin: '0 0 8px' }}>Facility and monitoring plan</h3>
        <table className="t small"><tbody>
          {row('EAD facility ID', F.eadId ?? '—')}{row('Environmental permit', F.permitNo ?? '—')}{row('Operator', F.operator ?? '—')}{row('Sector', F.subSector ? `${F.sector} · ${F.subSector}` : F.sector)}
          {row('Start of operations', d8(F.operationsStart))}{row('Registered with EAD', d8(F.registeredOn))}
          {row('Monitoring plan', F.mpVersion ? `version ${F.mpVersion}, submitted ${d8(F.mpSubmitted)}` : 'not recorded')}{row('Last significant change', d8(F.mpChange))}
          {row('Verifier', F.verifier ? `${F.verifier}${F.verifierSince ? ` (since ${F.verifierSince})` : ''}` : '—')}
          {row('Inventory facility', d.node?.name ?? (d.ekotrace ? 'not linked' : 'typed figures (no GHG inventory)'))}
        </tbody></table>
        <div className="muted small" style={{ marginTop: 8 }}>The monitoring plan (EAD Excel template) describes the facility, methods and standards, data sources, measuring equipment, QA/QC, data management and the emission sources. It is due 90 days after registration, then by 31 March each year with the verifier's review, and revised within 30 days of a significant change.</div></div>
      <div className="card"><h3 style={{ margin: '0 0 8px' }}>Dates</h3>
        <table className="t small"><tbody>{d.calendar.map((c, i) => <tr key={i} className={c.date < today() ? 'muted' : ''}><td className="nowrap">{d8(c.date)}</td><td>{c.what}</td></tr>)}</tbody></table></div>
    </div>);
}

function Measures({ o, list, facilityId, canEdit, onSaved }: { o: Overview; list: Measure[]; facilityId: string | null; canEdit: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState<Measure | 'new' | null>(null);
  const total = list.filter((m) => m.status === 'implemented').reduce((a, m) => a + (m.tPerYear ?? 0), 0);
  return (
    <div className="card flush">
      <div className="row vfilters"><div className="grow"><b>{facilityId ? 'Mitigation measures (sheet J)' : 'Company-wide reduction measures'}</b>
        <div className="muted small">Actions taken, planned or studied. Offsets and removals are information only: never netted against reported emissions.{total ? ` Implemented: ${t0(total)} tCO₂e a year.` : ''}</div></div>
        {canEdit && <button className="btn sm p" onClick={() => setOpen('new')}>+ Measure</button>}</div>
      {!list.length ? <div className="empty" style={{ padding: 18 }}>No measures yet.</div> : (
        <table className="t"><thead><tr><th>Measure</th><th>Means</th><th className="ctr">Status</th><th className="num">From</th><th className="num">tCO₂e a year</th><th className="num">Capex AED</th></tr></thead>
          <tbody>{list.map((m) => (
            <tr key={m.id} className="click" style={{ cursor: canEdit ? 'pointer' : undefined }} onClick={() => canEdit && setOpen(m)}><td><b>{m.title}</b>{m.note && <div className="muted small">{m.note}</div>}</td><td className="small">{o.means[m.means]}</td>
              <td className="ctr"><span className={`chip ${m.status === 'implemented' ? '' : m.status === 'planned' ? 'info' : 'grey'}`}>{m.status}</span></td><td className="num small">{m.startYear ?? '—'}</td><td className="num">{t0(m.tPerYear)}</td><td className="num small">{t0(m.capexAed)}</td></tr>))}</tbody></table>)}
      {open && <MeasureDrawer o={o} m={open === 'new' ? null : open} facilityId={facilityId} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onSaved(); }} />}
    </div>);
}

function MeasureDrawer({ o, m, facilityId, onClose, onDone }: { o: Overview; m: Measure | null; facilityId: string | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ title: m?.title ?? '', means: m?.means ?? 'efficiency', status: m?.status ?? 'planned', startYear: s(m?.startYear), tPerYear: s(m?.tPerYear), capexAed: s(m?.capexAed), note: m?.note ?? '' });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const ok = f.title.trim().length >= 2 && [f.startYear, f.tPerYear, f.capexAed].every(okNum);
  const body = (): MeasureBody => ({ facilityId, title: f.title.trim(), means: f.means, status: f.status as MeasureBody['status'], startYear: parse(f.startYear), tPerYear: parse(f.tPerYear), capexAed: parse(f.capexAed), note: f.note.trim() });
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Mitigation</div><h2>{m ? m.title : 'Add a measure'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        <label className="field span2"><span>Measure</span><input className="input" value={f.title} onChange={(e) => up({ title: e.target.value })} /></label>
        <label className="field"><span>Means</span><select className="input" value={f.means} onChange={(e) => up({ means: e.target.value })}>{Object.entries(o.means).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => up({ status: e.target.value as typeof f.status })}><option value="implemented">Implemented</option><option value="planned">Planned</option><option value="studied">Being studied</option></select></label>
        <label className="field"><span>Start year</span><input className="input num" value={f.startYear} onChange={(e) => up({ startYear: e.target.value })} /></label>
        <label className="field"><span>tCO₂e saved a year</span><input className="input num" value={f.tPerYear} onChange={(e) => up({ tPerYear: e.target.value })} /></label>
        <label className="field"><span>Capex (AED)</span><input className="input num" value={f.capexAed} onChange={(e) => up({ capexAed: e.target.value })} /></label>
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
      <div className="row">{m && <button className="btn" onClick={() => go(() => mrvApi.deleteMeasure(m.id))}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
        <button className="btn p" disabled={!ok} onClick={() => go(() => (m ? mrvApi.saveMeasure(m.id, body()) : mrvApi.addMeasure(body())))}>Save</button></div>
    </div></dialog>);
}

function FacilityDrawer({ o, f, onClose, onDone }: { o: Overview; f: Facility | null; onClose: () => void; onDone: (id?: string) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [v, setV] = useState({
    name: f?.name ?? '', nodeId: f?.nodeId ?? '', emirate: f?.emirate ?? 'AZ', sector: f?.sector ?? 'industry', subSector: f?.subSector ?? '', eadId: f?.eadId ?? '', permitNo: f?.permitNo ?? '', operator: f?.operator ?? '', address: f?.address ?? '',
    operationsStart: f?.operationsStart ?? '', registeredOn: f?.registeredOn ?? '', mpVersion: f?.mpVersion ?? '', mpSubmitted: f?.mpSubmitted ?? '', mpChange: f?.mpChange ?? '', verifier: f?.verifier ?? '', verifierSince: s(f?.verifierSince), notes: f?.notes ?? '',
  });
  const up = (x: Partial<typeof v>) => setV((o2) => ({ ...o2, ...x }));
  const pickNode = (id: string) => { const n = o.nodes.find((x) => x.id === id); const em = n?.grid_region?.startsWith('AE-') ? n.grid_region.slice(3) : null; up({ nodeId: id, ...(n && !v.name ? { name: n.name } : {}), ...(em && o.emirates[em] ? { emirate: em } : {}) }); };
  const n = (x: string) => x.trim() || null;
  const body = (): FacilityBody => ({ name: v.name.trim(), nodeId: v.nodeId || null, emirate: v.emirate, sector: v.sector as FacilityBody['sector'], subSector: n(v.subSector), eadId: n(v.eadId), permitNo: n(v.permitNo), operator: n(v.operator), address: n(v.address),
    operationsStart: v.operationsStart || null, registeredOn: v.registeredOn || null, mpVersion: n(v.mpVersion), mpSubmitted: v.mpSubmitted || null, mpChange: v.mpChange || null, verifier: n(v.verifier), verifierSince: parse(v.verifierSince), notes: v.notes.trim() });
  const ok = v.name.trim().length >= 2 && okNum(v.verifierSince);
  const save = async () => { try { if (f) { await mrvApi.saveFacility(f.id, body()); onDone(); } else onDone((await mrvApi.addFacility(body())).id); toast('Saved'); } catch (e) { toast((e as Error).message); } };
  const del = async () => { if (!f) return; try { await mrvApi.deleteFacility(f.id); toast('Removed'); onDone(); } catch (e) { toast((e as Error).message); } };
  const t = (k: keyof typeof v, label: string, ph = '', cls = 'field') => <label className={cls}><span>{label}</span><input className="input" value={v[k]} placeholder={ph} onChange={(e) => up({ [k]: e.target.value } as Partial<typeof v>)} /></label>;
  const dt = (k: keyof typeof v, label: string) => <label className="field"><span>{label}</span><input type="date" className="input" value={v[k]} onChange={(e) => up({ [k]: e.target.value } as Partial<typeof v>)} /></label>;
  const sec = o.sectors[v.sector as keyof typeof o.sectors];
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">UAE MRV</div><h2>{f ? f.name : 'Add a reporting facility'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="note info small">EAD applies per facility: one or more fixed units on adjacent sites under common operational control. Geographically separate sites report on their own.</div>
      <div className="vform">
        {o.ekotrace && <label className="field span2"><span>Inventory facility (to fill source streams from its entries)</span><select className="input" value={v.nodeId} onChange={(e) => pickNode(e.target.value)}><option value="">— not linked —</option>{o.nodes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {t('name', 'Facility name', '', 'field span2')}
        <label className="field"><span>Emirate</span><select className="input" value={v.emirate} onChange={(e) => up({ emirate: e.target.value })}>{Object.entries(o.emirates).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select></label>
        <label className="field"><span>Sector</span><select className="input" value={v.sector} onChange={(e) => up({ sector: e.target.value as Facility['sector'] })}>{Object.entries(o.sectors).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</select></label>
        <div className="field span2 muted small">{sec?.hint}{v.emirate !== 'AZ' ? ' · Outside Abu Dhabi the EAD programme does not apply; the facility still counts for the federal report.' : ''}</div>
        {t('subSector', 'Sub-sector', 'e.g. Steel (EAF), Cement, Refinery')}{t('operator', 'Operator (legal entity)')}
        {t('eadId', 'EAD facility ID')}{t('permitNo', 'Environmental permit no.')}
        {t('address', 'Address', '', 'field span2')}
        {dt('operationsStart', 'Start of operations')}{dt('registeredOn', 'Registered with EAD')}
        {t('mpVersion', 'Monitoring plan version')}{dt('mpSubmitted', 'Monitoring plan submitted')}
        {dt('mpChange', 'Last significant change')}<div className="field" />
        {t('verifier', 'Verifier (ISO 14065 accredited)')}{t('verifierSince', 'With this verifier since (year)')}
        <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={v.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
      </div>
      <div className="row">{f && <button className="btn" onClick={del}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={!ok} onClick={save}>Save</button></div>
    </div></dialog>);
}

// ------------------------------------------------------------------------------------------- federal --
function FederalTab({ o, onSaved }: { o: Overview; onSaved: () => void }) {
  const { toast, can } = useApp();
  const C = o.company, F = o.federal;
  const [f, setF] = useState({ designated: C.designated, designationRef: C.designationRef ?? '', nrccNo: C.nrccNo ?? '', nrccRegistered: C.nrccRegistered ?? '', ieqtStatus: C.ieqtStatus, ieqtSubmitted: C.ieqtSubmitted ?? '', ieqtRef: C.ieqtRef ?? '', verifier: C.verifier ?? '', s1Typed: s(C.s1Typed), s2Typed: s(C.s2Typed), notes: C.notes });
  const up = (x: Partial<typeof f>) => setF((v) => ({ ...v, ...x }));
  const save = async () => {
    const b: CompanyBody = { designated: f.designated, designationRef: f.designationRef.trim() || null, nrccNo: f.nrccNo.trim() || null, nrccRegistered: f.nrccRegistered || null, ieqtStatus: f.ieqtStatus, ieqtSubmitted: f.ieqtSubmitted || null,
      ieqtRef: f.ieqtRef.trim() || null, verifier: f.verifier.trim() || null, s1Typed: parse(f.s1Typed), s2Typed: parse(f.s2Typed), notes: f.notes.trim() };
    try { await mrvApi.company(o.year, b); toast('Saved'); onSaved(); } catch (e) { toast((e as Error).message); }
  };
  const byEm = new Map<string, { s1: number; s2: number }>();
  F.byEmirate.forEach((x) => { const k = x.emirate ? o.emirates[x.emirate] ?? x.emirate : 'Emirate not set'; const v = byEm.get(k) ?? { s1: 0, s2: 0 }; v.s1 += x.s1; v.s2 += x.s2; byEm.set(k, v); });
  return (
    <>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Scope 1, {o.year}</span><b>{t0(F.s1)} <small className="muted">tCO₂e</small></b><span className="muted small">{F.source === 'entries' ? `Approved entries of UAE facilities${F.processOnly ? ` + ${t0(F.processOnly)} t process emissions from the facility reports` : ''}${F.unlinked ? ` + ${t0(F.unlinked)} t from facility reports not linked to the inventory` : ''}` : F.source === 'typed' ? 'Typed' : F.source === 'facilities' ? 'Sum of the facility reports' : 'No figures yet'}</span></div>
        <div className="card kpi"><span className="muted small">Scope 2 (location-based)</span><b>{t0(F.s2)} <small className="muted">tCO₂e</small></b><span className="muted small">Grid electricity, heat and cooling bought</span></div>
        <div className="card kpi"><span className="muted small">Scope 1 + 2 vs 0.5 Mt</span><b>{t0(F.total)}</b><span className="muted small">{F.large ? 'NRCC registration and annual verification required' : 'Below the NRCC threshold'}</span></div>
        <div className="card kpi"><span className="muted small">National MRV system (IEQT)</span><b style={{ fontSize: 18 }}>{({ not_started: 'Not started', registered: 'Registered', draft: 'Draft', submitted: 'Submitted', verified: 'Verified' } as Record<string, string>)[C.ieqtStatus]}</b><span className="muted small">{C.ieqtSubmitted ? `Submitted ${d8(C.ieqtSubmitted)}` : 'Organisation approved by the emirate focal point first'}</span></div>
      </div>
      <div className="ccgrid" style={{ marginTop: 12 }}>
        <div className="card"><h3 style={{ margin: '0 0 6px' }}>Duties for {o.year}</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{F.duties.map((x, i) => <li key={i} style={{ marginBottom: 4 }}>{x}</li>)}</ul>
          <div className="muted small" style={{ marginTop: 8 }}>The federal adjustment period was extended by one year from 31 May 2026 (Cabinet Resolution No. 147 of 2026). The Ministry's technical guidance on scopes, methods and deadlines is still pending. Penalties under the Decree-Law: AED 50,000 to 2,000,000, doubled for a repeat within two years.</div>
          {(F.byEmirate.length > 0 || F.byGas.length > 0) && <><h3 style={{ margin: '14px 0 6px' }}>By emirate</h3>
            <table className="t small"><thead><tr><th>Emirate</th><th className="num">Scope 1</th><th className="num">Scope 2</th></tr></thead><tbody>{[...byEm].map(([k, x]) => <tr key={k}><td>{k}</td><td className="num">{t0(x.s1)}</td><td className="num">{t0(x.s2)}</td></tr>)}</tbody></table>
            <h3 style={{ margin: '14px 0 6px' }}>Scope 1 by gas</h3>
            <table className="t small"><thead><tr><th>Gas</th><th className="num">t</th><th className="num">tCO₂e</th></tr></thead><tbody>{F.byGas.map((g) => <tr key={g.gas}><td>{g.gas}</td><td className="num">{t2(g.t)}</td><td className="num">{t0(g.co2e)}</td></tr>)}</tbody></table></>}
        </div>
        <div className="card"><h3 style={{ margin: '0 0 6px' }}>Federal position, {o.year}</h3>
          <fieldset className="vform plain" disabled={!o.canSetup}>
            <label className="field"><span>Designated as a source</span><select className="input" value={f.designated} onChange={(e) => up({ designated: e.target.value as typeof f.designated })}><option value="unknown">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field"><span>Designation reference</span><input className="input" value={f.designationRef} placeholder="Ministry or emirate authority letter" onChange={(e) => up({ designationRef: e.target.value })} /></label>
            <label className="field"><span>NRCC registration no.</span><input className="input" value={f.nrccNo} onChange={(e) => up({ nrccNo: e.target.value })} /></label>
            <label className="field"><span>Registered on</span><input type="date" className="input" value={f.nrccRegistered} onChange={(e) => up({ nrccRegistered: e.target.value })} /></label>
            <label className="field"><span>IEQT status</span><select className="input" value={f.ieqtStatus} onChange={(e) => up({ ieqtStatus: e.target.value as typeof f.ieqtStatus })}><option value="not_started">Not started</option><option value="registered">Organisation registered</option><option value="draft">Inventory in draft</option><option value="submitted">Submitted</option><option value="verified">Verified</option></select></label>
            <label className="field"><span>Submitted on</span><input type="date" className="input" value={f.ieqtSubmitted} onChange={(e) => up({ ieqtSubmitted: e.target.value })} /></label>
            <label className="field"><span>Submission reference</span><input className="input" value={f.ieqtRef} onChange={(e) => up({ ieqtRef: e.target.value })} /></label>
            <label className="field"><span>Verifier (authorised by the Ministry)</span><input className="input" value={f.verifier} onChange={(e) => up({ verifier: e.target.value })} /></label>
            {!o.ekotrace && <><label className="field"><span>Scope 1, tCO₂e (typed)</span><input className="input num" value={f.s1Typed} placeholder="empty = sum of the facility reports" onChange={(e) => up({ s1Typed: e.target.value })} /></label>
              <label className="field"><span>Scope 2, tCO₂e (typed)</span><input className="input num" value={f.s2Typed} onChange={(e) => up({ s2Typed: e.target.value })} /></label></>}
            <label className="field span2"><span>Notes</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
          </fieldset>
          {o.canSetup && <div className="row"><span className="grow" /><button className="btn p" disabled={![f.s1Typed, f.s2Typed].every(okNum)} onClick={save}>Save</button></div>}
        </div>
      </div>
      <div style={{ marginTop: 12 }}><Measures o={o} list={o.measures} facilityId={null} canEdit={can('super_admin', 'admin', 'manager')} onSaved={onSaved} /></div>
    </>);
}

