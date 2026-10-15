/**
 * Product LCA (Value chain): product carbon footprints to ISO 14067 / the GHG Protocol Product Standard.
 * Products · LCA workspace (seven steps from goal & scope to review) · Life-cycle inventory and library ·
 * Scenarios · Published factors. A verified, published footprint of a supplier's product becomes that
 * supplier's factor, so purchases of the product are calculated with it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type LcaData, type LcaDetail, type LcaImportLine, type LcaLine, type LcaProduct, type LcaScenario, type LciFactor } from '../lib/api';
import { Icon } from '../components/Icon';
import { ItemPicker } from '../components/ItemPicker';
import { DCard, Donut, HBars, Legend } from '../components/DashCharts';

export const STAGE_C: Record<string, string> = { raw: '#1F6F5C', packaging: '#86CDB4', manufacturing: '#2E6FB0', transport: '#E9B44C', use: '#6B4FA8', eol: '#C2523C' };
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'grey'], review: ['In review', 'warn'], verified: ['Verified', 'info'], published: ['Published', ''] };
const DQC = (q: number | null | undefined) => (q == null ? 'grey' : q >= 0.85 ? '' : q >= 0.7 ? 'info' : 'warn');
const kg = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-GB') : Math.abs(x) >= 1 ? x.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : Number(x.toPrecision(3)).toString());
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pct = (x: number) => `${Math.round(x * 100)}%`;
type DrawerState = null | { k: 'product'; p: LcaProduct | null; copy?: string } | { k: 'input'; line: LcaLine | null; stage: string } | { k: 'import' } | { k: 'scenario'; s: LcaScenario | null; seed?: LcaScenario['changes']; name?: string } | { k: 'library'; f: LciFactor | null };
type SetDrawer = (x: DrawerState) => void;
type Act = (fn: () => Promise<unknown>, msg: string) => Promise<void>;
type Tab = 'products' | 'workspace' | 'inventory' | 'scenarios' | 'published';
const TABS: [Tab, string][] = [['products', 'Products'], ['workspace', 'LCA workspace'], ['inventory', 'Life-cycle inventory'], ['scenarios', 'Scenarios'], ['published', 'Published factors']];

function StageBar({ stages, w = 140 }: { stages: Record<string, number>; w?: number }) {
  const tot = Object.values(stages).reduce((a, v) => a + Math.max(0, v), 0);
  if (!tot) return <span className="muted small">—</span>;
  return <div className="sbar" style={{ width: w }} title={Object.entries(stages).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${pct(v / tot)}`).join(' · ')}>
    {Object.entries(stages).filter(([, v]) => v > 0).map(([k, v]) => <span key={k} style={{ flex: v, background: STAGE_C[k] }} />)}</div>;
}
const Status = ({ p }: { p: Pick<LcaProduct, 'status' | 'version' | 'changed_since_publish'> }) => <>
  <span className={`chip ${STATUS[p.status]![1]}`}>{STATUS[p.status]![0]}</span>{p.version > 0 && <span className="chip grey" style={{ marginLeft: 4 }}>v{p.version}</span>}
  {p.version > 0 && p.changed_since_publish && p.status !== 'published' && <span className="chip warn" style={{ marginLeft: 4 }} title="The model changed since the last publication; the published factor stays in use until it is republished">republish</span>}</>;

export function ProductLca() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : sp.get('product') ? 'workspace' : 'products') as Tab;
  const pid = sp.get('product');
  const set = (x: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(x)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
  const [d, setD] = useState<LcaData | null>(null);
  const [det, setDet] = useState<LcaDetail | null>(null);
  const [tick, setTick] = useState(0);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  useEffect(() => { api.lca().then(setD).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = pid ?? d?.products[0]?.id ?? null;
  useEffect(() => { if (current && tab !== 'products' && tab !== 'published') api.lcaProduct(current).then(setDet).catch((e) => toast((e as Error).message)); }, [current, tab, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const open = (id: string, t: Tab = 'workspace') => set({ product: id, tab: t });
  const P = det && det.product.id === current ? det : null;

  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Product LCA</span><h1>Product footprints</h1>
          <div className="muted">Cradle-to-gate footprints of your products and your suppliers' products (ISO 14067, GHG Protocol Product Standard). A second person verifies each model before it is published; a published supplier product becomes that supplier's factor for your purchases.</div></div>
        {tab !== 'products' && tab !== 'published' && d.products.length > 0 && <label className="field" style={{ minWidth: 240 }}><span>Product</span>
          <select className="input" value={current ?? ''} onChange={(e) => set({ product: e.target.value })}>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {d.can.edit && <button className="btn p" onClick={() => setDrawer({ k: 'product', p: null })}>+ New product</button>}
      </div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}>{l}{k === 'products' ? ` (${d.products.length})` : ''}</button>)}</div>

      {tab === 'products' && <ProductsTab d={d} open={open} />}
      {tab !== 'products' && tab !== 'published' && !d.products.length && <div className="card empty">No product modelled yet. {d.can.edit && <button className="btn sm" onClick={() => setDrawer({ k: 'product', p: null })}>+ New product</button>}</div>}
      {tab !== 'products' && tab !== 'published' && d.products.length > 0 && !P && <div className="card empty">Loading…</div>}
      {tab === 'workspace' && P && <Workspace d={d} x={P} act={act} setDrawer={setDrawer} goScenarios={() => set({ tab: 'scenarios' })} />}
      {tab === 'inventory' && P && <Inventory d={d} x={P} act={act} setDrawer={setDrawer} />}
      {tab === 'scenarios' && P && <Scenarios d={d} x={P} act={act} setDrawer={setDrawer} />}
      {tab === 'published' && <Published d={d} open={open} />}

      {drawer?.k === 'product' && <ProductDrawer d={d} p={drawer.p} copy={drawer.copy} onClose={() => setDrawer(null)} onDone={(id) => { setDrawer(null); if (id) set({ product: id, tab: 'workspace' }); reload(); }} />}
      {drawer?.k === 'input' && P && <InputDrawer d={d} x={P} line={drawer.line} stage={drawer.stage} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer?.k === 'import' && P && <ImportDrawer x={P} d={d} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer?.k === 'scenario' && P && <ScenarioDrawer d={d} x={P} s={drawer.s} seed={drawer.seed} name={drawer.name} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); set({ tab: 'scenarios' }); reload(); }} />}
      {drawer?.k === 'library' && <LibraryDrawer d={d} f={drawer.f} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- products --
function ProductsTab({ d, open }: { d: LcaData; open: (id: string, t?: Tab) => void }) {
  const C = d.counts;
  const own = d.products.filter((p) => !p.supplier_id), sup = d.products.filter((p) => p.supplier_id);
  return <>
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Products modelled</span><b>{C.products}</b><span className="muted small">{own.length} own · {sup.length} from suppliers</span></div>
      <div className="card kpi"><span className="muted small">Published footprints</span><b style={{ color: 'var(--primary)' }}>{C.published}</b><span className="muted small">{C.suppliers} used as supplier factors</span></div>
      <div className="card kpi"><span className="muted small">Waiting for review</span><b style={{ color: C.review ? 'var(--warn)' : undefined }}>{C.review}</b><span className="muted small">verified by a second person</span></div>
      <div className="card kpi"><span className="muted small">Purchases calculated with them</span><b>{C.purchaseLines.toLocaleString('en-GB')} <small className="muted">lines</small></b><span className="muted small">{kg(C.purchaseT)} tCO₂e</span></div>
    </div>
    {C.indicative > 0 && <div className="note info small">The shared library holds {C.indicative} <b>indicative</b> factors to start with. Replace them with licensed ecoinvent / EF 3.1 data, EPDs or your own measurements before a footprint is disclosed or used in a claim.</div>}
    <div className="card">
      <h3 style={{ margin: '0 0 8px' }}>Products</h3>
      {!d.products.length ? <div className="muted">None yet.</div> : <div className="scroll"><table className="t">
        <thead><tr><th>Product</th><th>From</th><th className="num">Footprint</th><th>Life-cycle stages</th><th className="num">Data quality</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>{d.products.map((p) => <tr key={p.id} className="click" onClick={() => open(p.id)}>
          <td><b>{p.name}</b><div className="muted small">{p.fu} · {d.boundaries[p.boundary]}</div></td>
          <td>{p.supplier ?? <span className="chip grey">own product</span>}</td>
          <td className="num"><b>{kg(p.total)}</b> <span className="muted small">kg CO₂e / {p.declared_unit}</span>
            {p.version > 0 && p.published_factor != null && Math.abs(p.published_factor - p.total) > 1e-6 && <div className="muted small">published {kg(p.published_factor)}</div>}</td>
          <td><StageBar stages={p.stages} /></td>
          <td className="num"><span className={`chip ${DQC(p.dq)}`}>{p.dq == null ? '—' : pct(p.dq)}</span></td>
          <td><Status p={p} /></td>
          <td className="small muted">{d8(p.updated_at)}<div>{p.last_edit_name}</div></td></tr>)}</tbody></table></div>}
      <div className="row small muted" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>{Object.entries(d.stages).map(([k, v]) => <span key={k}><i className="sdot" style={{ background: STAGE_C[k] }} /> {v}</span>)}</div>
    </div>
    <div className="dgrid">
      <DCard title="Footprint comparison" sub="kg CO₂e per declared unit" span={2}>
        <HBars items={[...d.products].sort((a, b) => b.total - a.total).map((p) => ({ n: `${p.name} (per ${p.declared_unit})`, v: p.total, parts: Object.entries(p.stages).filter(([, v]) => v > 0).map(([k, v]) => ({ v, c: STAGE_C[k]! })), onClick: () => open(p.id) }))} unit="kg" />
      </DCard>
      <DCard title="Linked to purchased goods" sub="supplier products">
        {!sup.length ? <div className="muted small">Model a supplier's product (choose the supplier in goal & scope) and publish it: purchases from that supplier are then calculated with the footprint instead of a spend factor.</div> :
          <div className="vstack" style={{ display: 'grid', gap: 8 }}>{sup.map((p) => <div key={p.id} className="row" style={{ gap: 8 }}>
            <div className="grow"><b className="small">{p.name}</b><div className="muted small">{p.supplier}{p.item ? ` · ${p.item}` : ' · everything bought from them'}</div></div>
            {p.supplier_ef_id ? <span className="chip" title="Purchase lines calculated with this factor">{p.lines} lines</span> : <span className="chip grey">not published</span>}</div>)}</div>}
      </DCard>
    </div>
  </>;
}

// --------------------------------------------------------------- workspace --
const STEPS: { k: string; t: string; s: string; stages?: string[] }[] = [
  { k: 'scope', t: 'Goal & scope', s: 'Declared unit, boundary, rules' },
  { k: 'bom', t: 'Bill of materials', s: 'Raw materials', stages: ['raw'] },
  { k: 'pack', t: 'Packaging', s: 'Primary and transport packaging', stages: ['packaging'] },
  { k: 'mfg', t: 'Manufacturing energy', s: 'Electricity, fuels, water', stages: ['manufacturing'] },
  { k: 'tr', t: 'Transport legs', s: 'Inbound and outbound freight', stages: ['transport'] },
  { k: 'use', t: 'Use & end of life', s: 'Only for cradle-to-grave', stages: ['use', 'eol'] },
  { k: 'review', t: 'Review & verify', s: 'Second person, then publish' },
];

function Workspace({ d, x, act, setDrawer, goScenarios }: { d: LcaData; x: LcaDetail; act: Act; setDrawer: SetDrawer; goScenarios: () => void }) {
  const [step, setStep] = useState('scope');
  const p = x.product, R = x.result;
  const done = (k: string) => k === 'scope' ? true : k === 'review' ? p.status === 'published' : (STEPS.find((s) => s.k === k)!.stages ?? []).some((st) => x.inputs.some((i) => i.stage === st));
  const S = STEPS.find((s) => s.k === step)!;
  return (
    <div className="lca-ws">
      <nav className="sp-steps" aria-label="Steps">
        {STEPS.map((s, i) => <button key={s.k} className={`${step === s.k ? 'on' : ''} ${done(s.k) ? 'done' : ''}`} onClick={() => setStep(s.k)}>
          <span className="n">{i + 1}</span><span><b>{s.t}</b><small>{s.stages ? `${x.inputs.filter((l) => s.stages!.includes(l.stage)).length} inputs` : s.s}</small></span></button>)}
      </nav>
      <section className="card sp-panel">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><div className="grow"><span className="lbl">{p.supplier ?? 'Own product'}</span><h2 style={{ margin: 0 }}>{p.name}</h2></div><Status p={p} /></div>
        {p.review_note && p.status === 'draft' && <div className="note warn small"><b>Returned:</b> {p.review_note}</div>}
        {step === 'scope' && <>
          <table className="t sp-sum"><tbody>
            <tr><td>Functional / declared unit</td><td><b>{p.fu}</b> · footprint per <b>{p.declared_unit}</b></td></tr>
            <tr><td>System boundary</td><td>{d.boundaries[p.boundary]}{p.boundary === 'cradle_to_gate' && <span className="muted small"> · use and end of life are kept in the model but not counted</span>}</td></tr>
            <tr><td>Standard</td><td>{p.standard}</td></tr>
            <tr><td>Allocation</td><td>{p.allocation}</td></tr>
            <tr><td>Cut-off</td><td>{p.cutoff}</td></tr>
            <tr><td>Reference year</td><td>{p.ref_year}</td></tr>
            <tr><td>Supplier</td><td>{p.supplier ? <>{p.supplier}<div className="muted small">Once published, purchases from this supplier{p.item ? ` under “${p.item}”` : ''} with a quantity in {p.declared_unit} are calculated with this footprint.</div></> : 'None — your own product'}</td></tr>
            {p.description && <tr><td>Description</td><td>{p.description}</td></tr>}
            {p.notes && <tr><td>Notes</td><td className="small">{p.notes}</td></tr>}
          </tbody></table>
          {x.can.edit && <div className="row" style={{ gap: 8 }}><button className="btn" onClick={() => setDrawer({ k: 'product', p })}><Icon name="edit" size={15} /> Edit goal & scope</button>
            <button className="btn ghost" onClick={() => setDrawer({ k: 'product', p: null, copy: p.id })}>Copy as a new product</button></div>}
        </>}
        {S.stages && <>
          <p className="muted small" style={{ margin: 0 }}>Amounts per {p.fu.toLowerCase().startsWith('1 ') ? p.fu.slice(2) : p.declared_unit}. Choose a library factor or enter the supplier's own value; mark how good each figure is.</p>
          {S.stages.some((st) => p.boundary === 'cradle_to_gate' ? ['use', 'eol'].includes(st) : p.boundary === 'gate_to_gate' ? !['manufacturing', 'packaging'].includes(st) : false) &&
            <div className="note info small">Outside the {d.boundaries[p.boundary]} boundary: these inputs are kept but not counted in the footprint.</div>}
          <InputTable d={d} lines={x.inputs.filter((l) => S.stages!.includes(l.stage))} can={x.can.edit} act={act} edit={(l) => setDrawer({ k: 'input', line: l, stage: l.stage })} />
          {x.can.edit && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{S.stages.map((st) => <button key={st} className="btn" onClick={() => setDrawer({ k: 'input', line: null, stage: st })}>+ Add {d.stages[st]!.toLowerCase()} input</button>)}
            {step === 'bom' && <button className="btn ghost" onClick={() => setDrawer({ k: 'import' })}><Icon name="upload" size={15} /> Import bill of materials</button>}</div>}
        </>}
        {step === 'review' && <Review d={d} x={x} act={act} />}
      </section>
      <aside className="lca-res">
        <DCard title="Footprint" sub={`per ${p.declared_unit}`}>
          <div style={{ display: 'grid', justifyItems: 'center', gap: 6 }}>
            <Donut parts={Object.entries(R.stages).map(([k, v]) => ({ n: d.stages[k]!, v, c: STAGE_C[k]! }))} center={kg(R.total)} sub={`kg CO₂e / ${p.declared_unit}`} size={150} />
            <Legend parts={Object.entries(R.stages).map(([k, v]) => ({ n: d.stages[k]!, v, c: STAGE_C[k]! }))} unit="kg" />
            <div className="row small" style={{ gap: 8 }}><span className="muted">Data quality</span><span className={`chip ${DQC(R.dq)}`}>{R.dq == null ? '—' : pct(R.dq)}</span>
              {R.excluded > 0 && <span className="muted" title="Inputs outside the boundary">+{kg(R.excluded)} kg outside boundary</span>}</div>
            {p.version > 0 && p.published_factor != null && <div className="muted small">Published v{p.version}: {kg(p.published_factor)} kg CO₂e / {p.declared_unit}</div>}
          </div>
        </DCard>
        <DCard title="Hotspots" sub="largest inputs">
          <HBars items={x.hotspots.filter((h) => h.kg > 0).map((h) => ({ n: h.name, v: h.kg, c: STAGE_C[h.stage], p: h.share * 100 }))} unit="kg" />
        </DCard>
        <DCard title="Ecodesign levers" sub="lower library factor, same material">
          {!x.levers.length ? <div className="muted small">No like-for-like lower factor in the library.</div> :
            <div style={{ display: 'grid', gap: 8 }}>{x.levers.map((l) => <div key={l.inputId} className="small">
              <div><b>{l.input}</b> → {l.to}</div>
              <div className="row" style={{ gap: 8 }}><span className="muted grow">saves {kg(l.saves)} kg ({pct(l.pct)})</span>
                {x.can.edit && <button className="btn sm ghost" onClick={() => setDrawer({ k: 'scenario', s: null, seed: [{ inputId: l.inputId, lciId: l.toId }], name: `${l.to.split(',')[0]} instead` })}>Try as scenario</button>}</div></div>)}
              {x.scenarios.length > 0 && <button className="btn sm ghost" onClick={goScenarios}>{x.scenarios.length} scenario{x.scenarios.length > 1 ? 's' : ''} →</button>}</div>}
        </DCard>
      </aside>
    </div>
  );
}

function InputTable({ d, lines, can, act, edit, showStage }: { d: LcaData; lines: LcaLine[]; can: boolean; act: Act; edit: (l: LcaLine) => void; showStage?: boolean }) {
  if (!lines.length) return <div className="muted small">No inputs yet.</div>;
  const lib = new Map(d.library.map((f) => [f.id, f]));
  return <div className="scroll"><table className="t">
    <thead><tr><th>Input</th>{showStage && <th>Stage</th>}<th className="num">Amount</th><th className="num">kg CO₂e / unit</th><th className="num">kg CO₂e</th><th className="num">Share</th><th>Data</th>{can && <th />}</tr></thead>
    <tbody>{lines.map((l) => { const f = l.lci_id ? lib.get(l.lci_id) : null; return <tr key={l.id} style={l.counted ? undefined : { opacity: 0.55 }}>
      <td><b>{l.name}</b><div className="muted small">{f ? <>Library: {f.name}{f.indicative && <span className="chip warn" style={{ marginLeft: 4 }}>indicative</span>}</> : 'Own value'}{l.source ? ` · ${l.source}` : ''}</div></td>
      {showStage && <td><i className="sdot" style={{ background: STAGE_C[l.stage] }} /> {d.stages[l.stage]}</td>}
      <td className="num">{kg(l.qty)} {l.unit}</td><td className="num">{kg(l.co2e_per_unit)}</td><td className="num"><b>{kg(l.kg)}</b></td>
      <td className="num">{l.counted ? pct(l.share) : <span className="muted small">outside</span>}</td>
      <td><span className={`chip ${DQC(d.dqWeights[l.dq])}`}>{d.dqLabels[l.dq]}</span></td>
      {can && <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}><button className="btn sm ghost" onClick={() => edit(l)} aria-label="Edit"><Icon name="edit" size={15} /></button>
        <button className="btn sm ghost" aria-label="Remove" onClick={() => act(() => api.lcaInputDelete(l.id), 'Input removed')}><Icon name="x" size={15} /></button></td>}</tr>; })}</tbody></table></div>;
}

function Review({ d, x, act }: { d: LcaData; x: LcaDetail; act: Act }) {
  const p = x.product;
  const [note, setNote] = useState('');
  const lib = new Map(d.library.map((f) => [f.id, f]));
  const ind = x.inputs.filter((l) => l.counted && l.lci_id && lib.get(l.lci_id)?.indicative);
  const indShare = ind.reduce((a, l) => a + l.share, 0);
  const est = x.inputs.filter((l) => l.counted && l.dq === 'estimated').reduce((a, l) => a + l.share, 0);
  const checks: [boolean, string][] = [
    [x.inputs.length > 0 && x.result.total > 0, `Inventory: ${x.inputs.length} inputs, ${kg(x.result.total)} kg CO₂e per ${p.declared_unit}`],
    [indShare < 0.5, `Indicative library factors: ${pct(indShare)} of the footprint${indShare ? ' — replace with licensed or primary data before disclosure' : ''}`],
    [est < 0.3, `Estimated data: ${pct(est)} of the footprint`],
    [(x.result.dq ?? 0) >= 0.7, `Data quality score ${x.result.dq == null ? '—' : pct(x.result.dq)} (Verified 100 · Measured 90 · Supplier 80 · Estimated 50, emission-weighted)`],
  ];
  const tl: [string, string | null, string | null][] = [['Last edited', p.last_edit_name, p.updated_at], ['Sent for review', p.sent_name, p.sent_at], ['Verified', p.verified_name, p.verified_at], ['Published', p.published_name, p.published_at]];
  return <>
    <ul className="lca-checks">{checks.map(([ok, t], i) => <li key={i}><span className={`chip ${ok ? '' : 'warn'}`}>{ok ? '✓' : '!'}</span> {t}</li>)}</ul>
    <table className="t sp-sum"><tbody>{tl.map(([k, who, at]) => <tr key={k}><td>{k}</td><td>{who ? <>{who} · {d8(at)}</> : '—'}</td></tr>)}</tbody></table>
    {p.status === 'review' && p.review_note && <div className="note info small">Note from the sender: {p.review_note}</div>}
    {(x.can.submit || x.can.verify) && <label className="field"><span>{x.can.verify ? 'Review note (needed to return it)' : 'Note for the reviewer (optional)'}</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {x.can.submit && <button className="btn p" onClick={() => act(() => api.lcaSubmit(p.id, note.trim() || undefined), 'Sent for review')}>Send for review</button>}
      {x.can.verify && <><button className="btn p" onClick={() => act(() => api.lcaVerify(p.id, 'verify', note.trim() || undefined), 'Verified')}>Verify</button>
        <button className="btn" onClick={() => act(() => api.lcaVerify(p.id, 'return', note.trim() || undefined), 'Returned to the author')}>Return with note</button></>}
      {x.can.publish && <button className="btn p" onClick={() => act(() => api.lcaPublish(p.id), p.supplier_id ? 'Published: the supplier factor is updated and purchases recalculated' : 'Published')}>Publish v{p.version + 1}</button>}
      {p.status === 'review' && !x.can.verify && <span className="muted small">Waiting for a super admin, admin or verifier who did not edit or send it.</span>}
      {p.status === 'verified' && !x.can.publish && <span className="muted small">Verified: a super admin or admin publishes it.</span>}
      {p.status === 'published' && <span className="muted small">Published. Any change returns the model to draft; v{p.version} stays in use until the next version is published.</span>}
    </div>
    {x.publications.length > 0 && <><h3 style={{ margin: '8px 0 0' }}>Versions</h3><div className="scroll"><table className="t">
      <thead><tr><th>Version</th><th className="num">Footprint</th><th>Stages</th><th className="num">Data quality</th><th>Verified by</th><th>Published</th></tr></thead>
      <tbody>{x.publications.map((v) => <tr key={v.id}><td>v{v.version}</td><td className="num">{kg(v.factor)} <span className="muted small">kg / {v.declared_unit}</span></td><td><StageBar stages={v.stages} w={110} /></td>
        <td className="num">{v.dq == null ? '—' : pct(v.dq)}</td><td>{v.verified_name}</td><td className="small">{v.published_name} · {d8(v.published_at)}</td></tr>)}</tbody></table></div></>}
  </>;
}

// --------------------------------------------------------------- inventory --
function Inventory({ d, x, act, setDrawer }: { d: LcaData; x: LcaDetail; act: Act; setDrawer: SetDrawer }) {
  const [stage, setStage] = useState('');
  const lib = d.library.filter((f) => !stage || f.stage === stage);
  return <>
    <div className="card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><h3 className="grow" style={{ margin: 0 }}>{x.product.name}: inventory</h3>
        {x.can.edit && <><button className="btn" onClick={() => setDrawer({ k: 'input', line: null, stage: 'raw' })}>+ Add input</button><button className="btn ghost" onClick={() => setDrawer({ k: 'import' })}><Icon name="upload" size={15} /> Import bill of materials</button></>}</div>
      {Object.keys(d.stages).map((st) => { const L = x.inputs.filter((l) => l.stage === st); if (!L.length) return null;
        return <div key={st} style={{ marginTop: 12 }}><div className="row small" style={{ gap: 8 }}><i className="sdot" style={{ background: STAGE_C[st] }} /><b>{d.stages[st]}</b><span className="muted">{kg(x.result.stages[st] ?? 0)} kg CO₂e</span></div>
          <InputTable d={d} lines={L} can={x.can.edit} act={act} edit={(l) => setDrawer({ k: 'input', line: l, stage: l.stage })} /></div>; })}
      {!x.inputs.length && <div className="muted small" style={{ marginTop: 8 }}>No inputs yet.</div>}
    </div>
    <div className="card">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><div className="grow"><h3 style={{ margin: 0 }}>Factor library</h3><div className="muted small">kg CO₂e per unit. The shared rows are indicative; add your company's licensed or measured factors.</div></div>
        <select className="input" style={{ width: 180 }} value={stage} onChange={(e) => setStage(e.target.value)}><option value="">All stages</option>{Object.entries(d.stages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {d.can.library && <button className="btn" onClick={() => setDrawer({ k: 'library', f: null })}>+ Company factor</button>}</div>
      <div className="scroll"><table className="t">
        <thead><tr><th>Factor</th><th>Stage</th><th className="num">kg CO₂e</th><th>per</th><th>Source</th>{d.can.library && <th />}</tr></thead>
        <tbody>{lib.map((f) => <tr key={f.id}><td><b>{f.name}</b> {f.indicative ? <span className="chip warn">indicative</span> : f.own ? <span className="chip info">company</span> : null}</td>
          <td><i className="sdot" style={{ background: STAGE_C[f.stage] }} /> {d.stages[f.stage]}</td><td className="num">{kg(f.co2e)}</td><td>{f.unit}</td><td className="small muted">{f.source}</td>
          {d.can.library && <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>{f.own && <><button className="btn sm ghost" aria-label="Edit" onClick={() => setDrawer({ k: 'library', f })}><Icon name="edit" size={15} /></button>
            <button className="btn sm ghost" aria-label="Remove" onClick={() => act(() => api.lcaLibraryDelete(f.id), 'Factor removed')}><Icon name="x" size={15} /></button></>}</td>}</tr>)}</tbody></table></div>
    </div>
  </>;
}

// --------------------------------------------------------------- scenarios --
function Scenarios({ d, x, act, setDrawer }: { d: LcaData; x: LcaDetail; act: Act; setDrawer: SetDrawer }) {
  const p = x.product;
  const rows = [{ id: 'base', name: 'Baseline (current model)', total: x.result.total, stages: x.result.stages, dq: x.result.dq, delta: 0, pct: 0 }, ...x.scenarios];
  const lib = new Map(d.library.map((f) => [f.id, f])), inp = new Map(x.inputs.map((l) => [l.id, l]));
  return <>
    <div className="card">
      <div className="row" style={{ gap: 8 }}><div className="grow"><h3 style={{ margin: 0 }}>{p.name}: what if</h3><div className="muted small">Swap a material or energy source, change an amount or a factor, and compare. Scenarios never change the model.</div></div>
        {x.can.edit && <button className="btn p" onClick={() => setDrawer({ k: 'scenario', s: null })}>+ New scenario</button>}</div>
      <div className="scroll"><table className="t">
        <thead><tr><th>Scenario</th><th className="num">kg CO₂e / {p.declared_unit}</th><th className="num">Change</th><th>Stages</th><th>What changes</th>{x.can.edit && <th />}</tr></thead>
        <tbody>{rows.map((s) => <tr key={s.id}><td><b>{s.name}</b></td><td className="num"><b>{kg(s.total)}</b></td>
          <td className="num">{s.id === 'base' ? '—' : <span className={`chip ${s.delta < 0 ? '' : s.delta > 0 ? 'bad' : 'grey'}`}>{s.delta > 0 ? '+' : ''}{kg(s.delta)} ({s.pct > 0 ? '+' : ''}{Math.round(s.pct * 100)}%)</span>}</td>
          <td><StageBar stages={s.stages} w={120} /></td>
          <td className="small">{'changes' in s ? (s as LcaScenario).changes.map((c, i) => { const l = inp.get(c.inputId); return <div key={i}>{l?.name ?? 'removed input'}: {[c.lciId ? `→ ${lib.get(c.lciId)?.name ?? 'factor'}` : '', c.qty != null ? `amount ${kg(c.qty)} ${l?.unit ?? ''}` : '', c.co2e != null ? `factor ${kg(c.co2e)}` : ''].filter(Boolean).join(' · ')}</div>; }) : <span className="muted">—</span>}</td>
          {x.can.edit && <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>{s.id !== 'base' && <><button className="btn sm ghost" aria-label="Edit" onClick={() => setDrawer({ k: 'scenario', s: s as LcaScenario })}><Icon name="edit" size={15} /></button>
            <button className="btn sm ghost" aria-label="Remove" onClick={() => act(() => api.lcaScenarioDelete(s.id), 'Scenario removed')}><Icon name="x" size={15} /></button></>}</td>}</tr>)}</tbody></table></div>
    </div>
    <DCard title="Scenario comparison" sub={`kg CO₂e per ${p.declared_unit}`}>
      <HBars items={rows.map((s) => ({ n: s.name, v: s.total, parts: Object.entries(s.stages).filter(([, v]) => v > 0).map(([k, v]) => ({ v, c: STAGE_C[k]! })) }))} unit="kg" />
    </DCard>
  </>;
}

// --------------------------------------------------------------- published --
function Published({ d, open }: { d: LcaData; open: (id: string, t?: Tab) => void }) {
  const pub = d.products.filter((p) => p.version > 0);
  return <div className="card">
    <h3 style={{ margin: '0 0 4px' }}>Published factors</h3>
    <div className="muted small" style={{ marginBottom: 8 }}>Draft → In review → Verified by a second person → Published (the version goes up). A supplier's product is used for purchases from that supplier; when the model changes it shows <span className="chip warn">republish</span> until the next version is published.</div>
    {!pub.length ? <div className="muted">Nothing published yet.</div> : <div className="scroll"><table className="t">
      <thead><tr><th>Product</th><th className="num">Factor</th><th>Version</th><th>Verified</th><th>Published</th><th>Used for</th></tr></thead>
      <tbody>{pub.map((p) => <tr key={p.id} className="click" onClick={() => open(p.id)}>
        <td><b>{p.name}</b><div className="muted small">{p.standard} · {d.boundaries[p.boundary]} · {p.ref_year}</div></td>
        <td className="num"><b>{kg(p.published_factor ?? 0)}</b> <span className="muted small">kg CO₂e / {p.declared_unit}</span></td>
        <td><Status p={p} /></td><td className="small">{p.verified_name ?? '—'}</td><td className="small">{p.published_name} · {d8(p.published_at)}</td>
        <td className="small">{p.supplier_id ? <>{p.supplier}{p.item ? ` · ${p.item}` : ''}<div><b>{p.lines}</b> purchase lines</div></> : <span className="muted">Own product: for disclosure and customers</span>}</td></tr>)}</tbody></table></div>}
  </div>;
}

// ----------------------------------------------------------------- drawers --
function Drawer({ title, eyebrow, onClose, children, foot }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  return <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
    <div className="row"><div className="grow"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
    {children}
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>{foot}<button className="btn ghost" onClick={() => dlg.current?.close()}>Cancel</button></div>
  </div></dialog>;
}

function SupplierSearch({ value, name, onPick }: { value: string | null; name: string | null; onPick: (s: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { const t = window.setTimeout(() => { if (q.trim().length >= 2) api.suppliers({ q: q.trim(), limit: 8, sort: 'name' }).then((r) => setRes(r.suppliers)).catch(() => setRes([])); else setRes([]); }, 200); return () => window.clearTimeout(t); }, [q]);
  return <div>
    {value ? <div className="row" style={{ gap: 8 }}><b className="grow">{name}</b><button className="btn sm ghost" onClick={() => onPick(null)}>Own product instead</button></div> :
      <><input className="input" placeholder="Search suppliers… (leave empty for your own product)" value={q} onChange={(e) => setQ(e.target.value)} />
        {res.length > 0 && <div className="vpicklist">{res.map((s) => <div key={s.id} className="vpickrow" onClick={() => { onPick(s); setQ(''); }}>{s.name}</div>)}</div>}</>}
  </div>;
}

function ProductDrawer({ d, p, onClose, onDone, copy }: { d: LcaData; p: LcaProduct | null; onClose: () => void; onDone: (id?: string) => void; copy?: string }) {
  const { toast } = useApp();
  const src = p ?? (copy ? d.products.find((x) => x.id === copy) ?? null : null);
  const [f, setF] = useState(() => ({
    name: p ? p.name : src ? `${src.name} (copy)` : '', description: src?.description ?? '', supplierId: src?.supplier_id ?? null as string | null, supplier: src?.supplier ?? null as string | null,
    itemId: src?.item_id ?? null as number | null, item: src?.item ?? null as string | null, declaredUnit: src?.declared_unit ?? 't', fu: src?.fu ?? '1 tonne at factory gate', boundary: src?.boundary ?? 'cradle_to_gate',
    standard: src?.standard ?? 'ISO 14067 / GHG Protocol Product Standard', allocation: src?.allocation ?? 'Mass allocation', cutoff: src?.cutoff ?? '1% of mass', refYear: String(src?.ref_year ?? new Date().getFullYear() - 1), notes: src?.notes ?? '',
  }));
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const [busy, setBusy] = useState(false);
  const locked = !!p && p.version > 0 && !!p.supplier_id;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.lcaProductSave({ name: f.name.trim(), description: f.description.trim(), supplierId: f.supplierId, itemId: f.itemId, declaredUnit: f.declaredUnit, fu: f.fu.trim(), boundary: f.boundary,
        standard: f.standard.trim(), allocation: f.allocation.trim(), cutoff: f.cutoff.trim(), refYear: Number(f.refYear), notes: f.notes.trim(), ...(p ? {} : { copyFrom: copy ?? null }) }, p?.id);
      toast(p ? 'Saved' : 'Product created'); onDone(r.id);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const del = async () => { if (!p) return; try { await api.lcaProductDelete(p.id); toast('Removed'); onDone(); } catch (e) { toast((e as Error).message); } };
  return <Drawer eyebrow="Product LCA · goal & scope" title={p ? p.name : copy ? 'Copy as a new product' : 'New product'} onClose={onClose}
    foot={<>{p && p.version === 0 && <button className="btn ghost" onClick={del}>Remove</button>}<button className="btn p" disabled={busy || f.name.trim().length < 2 || !f.fu.trim()} onClick={save}>{p ? 'Save' : 'Create'}</button></>}>
    {p && p.status !== 'draft' && <div className="note info small">Saving returns the model to draft{p.version > 0 ? `; v${p.version} stays in use until the next version is published` : ''}.</div>}
    <div className="vform">
      <label className="field span2"><span>Product name</span><input className="input" value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
      <label className="field span2"><span>Description</span><input className="input" value={f.description} onChange={(e) => up({ description: e.target.value })} /></label>
      <div className="field span2"><span>Supplier (whose product it is)</span>{locked ? <b>{f.supplier}</b> : <SupplierSearch value={f.supplierId} name={f.supplier} onPick={(s) => up({ supplierId: s?.id ?? null, supplier: s?.name ?? null })} />}</div>
      {f.supplierId && <div className="field span2"><span>Spend category it is bought under (optional)</span><ItemPicker compact value={f.itemId} valueName={f.item ?? 'everything bought from this supplier'} onPick={(it) => up({ itemId: it?.id ?? null, item: it?.name ?? null })} /></div>}
      <label className="field"><span>Declared unit (footprint per)</span><select className="input" value={f.declaredUnit} onChange={(e) => up({ declaredUnit: e.target.value })}>{['t', 'kg', 'pcs', 'L', 'm3', 'kWh'].map((u) => <option key={u}>{u}</option>)}</select></label>
      <label className="field"><span>Functional unit</span><input className="input" value={f.fu} onChange={(e) => up({ fu: e.target.value })} /></label>
      <label className="field"><span>System boundary</span><select className="input" value={f.boundary} onChange={(e) => up({ boundary: e.target.value })}>{Object.entries(d.boundaries).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Reference year</span><input className="input num" inputMode="numeric" value={f.refYear} onChange={(e) => up({ refYear: e.target.value })} /></label>
      <label className="field"><span>Standard</span><input className="input" value={f.standard} onChange={(e) => up({ standard: e.target.value })} /></label>
      <label className="field"><span>Allocation</span><input className="input" value={f.allocation} onChange={(e) => up({ allocation: e.target.value })} /></label>
      <label className="field"><span>Cut-off rule</span><input className="input" value={f.cutoff} onChange={(e) => up({ cutoff: e.target.value })} /></label>
      <label className="field span2"><span>Notes (data sources, assumptions)</span><textarea className="input" rows={3} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
    </div>
  </Drawer>;
}

function InputDrawer({ d, x, line, stage, onClose, onDone }: { d: LcaData; x: LcaDetail; line: LcaLine | null; stage: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState(() => ({ name: line?.name ?? '', stage: line?.stage ?? stage, qty: line ? String(line.qty) : '', unit: line?.unit ?? 'kg', lciId: line?.lci_id ?? '', own: line ? (line.lci_id ? '' : String(line.co2e_per_unit)) : '', dq: line?.dq ?? 'estimated', source: line?.source ?? '' }));
  const up = (v: Partial<typeof f>) => setF((o) => ({ ...o, ...v }));
  const libSt = d.library.filter((l) => l.stage === f.stage);
  const fac = d.library.find((l) => l.id === f.lciId);
  const per = fac ? fac.co2e : Number(f.own);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.lcaInputSave({ name: f.name.trim() || fac?.name || '', stage: f.stage, qty: Number(f.qty), unit: fac?.unit ?? f.unit.trim(), co2ePerUnit: fac ? null : Number(f.own), lciId: f.lciId || null, dq: f.dq, source: f.source.trim() }, x.product.id, line?.id);
      toast(line ? 'Saved' : 'Input added'); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <Drawer eyebrow={`${x.product.name} · inventory`} title={line ? 'Edit input' : 'Add input'} onClose={onClose}
    foot={<button className="btn p" disabled={busy || !f.qty || !Number.isFinite(Number(f.qty)) || (!fac && (f.own === '' || !Number.isFinite(Number(f.own))))} onClick={save}>{line ? 'Save' : 'Add'}</button>}>
    {x.product.status !== 'draft' && <div className="note info small">Changing the inventory returns the model to draft.</div>}
    <div className="vform">
      <label className="field"><span>Life-cycle stage</span><select className="input" value={f.stage} onChange={(e) => up({ stage: e.target.value, lciId: '' })}>{Object.entries(d.stages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Factor</span><select className="input" value={f.lciId} onChange={(e) => { const l = d.library.find((y) => y.id === e.target.value); up({ lciId: e.target.value, unit: l?.unit ?? f.unit, name: f.name || l?.name || '' }); }}>
        <option value="">Own value (supplier data, EPD, measured)</option>{libSt.map((l) => <option key={l.id} value={l.id}>{l.name} · {kg(l.co2e)} kg / {l.unit}{l.indicative ? ' (indicative)' : ''}</option>)}</select></label>
      <label className="field span2"><span>Input name</span><input className="input" value={f.name} placeholder={fac?.name ?? 'e.g. Steel scrap, Grid electricity — extruder'} onChange={(e) => up({ name: e.target.value })} /></label>
      <label className="field"><span>Amount per {x.product.declared_unit}</span><input className="input num" inputMode="decimal" value={f.qty} onChange={(e) => up({ qty: e.target.value })} /></label>
      <label className="field"><span>Unit</span><input className="input" value={fac ? fac.unit : f.unit} disabled={!!fac} onChange={(e) => up({ unit: e.target.value })} /></label>
      {!fac && <label className="field"><span>kg CO₂e per {f.unit || 'unit'}</span><input className="input num" inputMode="decimal" value={f.own} onChange={(e) => up({ own: e.target.value })} /></label>}
      <label className="field"><span>Data quality</span><select className="input" value={f.dq} onChange={(e) => up({ dq: e.target.value })}>{Object.entries(d.dqLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field span2"><span>Source (meter, invoice, supplier sheet, EPD number…)</span><input className="input" value={f.source} onChange={(e) => up({ source: e.target.value })} /></label>
    </div>
    {Number(f.qty) >= 0 && Number.isFinite(per) && f.qty !== '' && <div className="sp-calc">{kg(Number(f.qty))} {fac?.unit ?? f.unit} × {kg(per)} = <b>{kg(Number(f.qty) * per)} kg CO₂e</b> per {x.product.declared_unit}</div>}
    {fac?.indicative && <div className="note warn small">Indicative factor — replace with licensed ecoinvent / EF 3.1 data or the supplier's own value before disclosure.</div>}
  </Drawer>;
}

function ImportDrawer({ x, d, onClose, onDone }: { x: LcaDetail; d: LcaData; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [text, setText] = useState('input,stage,amount,unit,kgCO2e_per_unit\n');
  const [replace, setReplace] = useState(false);
  const [prev, setPrev] = useState<{ lines: LcaImportLine[]; ok: number; problems: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (commit: boolean) => {
    setBusy(true);
    try {
      const r = await api.lcaImport(x.product.id, { text, replace, commit });
      if (commit) { toast(`${r.imported} inputs imported${r.skipped ? `, ${r.skipped} skipped` : ''}`); onDone(); } else setPrev({ lines: r.lines!, ok: r.ok!, problems: r.problems! });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const file = async (fl: File | undefined) => { if (fl) { setText(await fl.text()); setPrev(null); } };
  return <Drawer eyebrow={`${x.product.name} · inventory`} title="Import bill of materials" onClose={onClose}
    foot={<><button className="btn" disabled={busy} onClick={() => run(false)}>Check</button><button className="btn p" disabled={busy || !prev?.ok} onClick={() => run(true)}>Import {prev?.ok ?? ''} lines</button></>}>
    <div className="note info small">One line per input: <b>input, stage, amount, unit, kgCO2e_per_unit</b> (comma, semicolon or tab separated — paste from Excel). Amounts are per {x.product.declared_unit}. Leave the factor blank to match the library by name; stages: {Object.values(d.stages).join(', ')}.</div>
    <label className="field"><span>CSV or text file</span><input type="file" accept=".csv,.txt,.tsv" onChange={(e) => file(e.target.files?.[0])} /></label>
    <label className="field"><span>Or paste</span><textarea className="input mono" rows={8} value={text} onChange={(e) => { setText(e.target.value); setPrev(null); }} /></label>
    <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setPrev(null); }} />Replace the current inventory ({x.inputs.length} inputs) instead of adding</label>
    {prev && <div className="scroll"><table className="t">
      <thead><tr><th>Row</th><th>Input</th><th>Stage</th><th className="num">Amount</th><th className="num">kg CO₂e / unit</th><th>Check</th></tr></thead>
      <tbody>{prev.lines.map((l) => <tr key={l.row}><td>{l.row}</td><td>{l.name}{l.lciName && <div className="muted small">library: {l.lciName}</div>}</td><td>{l.stage ? d.stages[l.stage] : '—'}</td>
        <td className="num">{l.qty ?? '—'} {l.unit}</td><td className="num">{l.co2e == null ? '—' : kg(l.co2e)}</td>
        <td>{l.problems.length ? <span className="chip bad">{l.problems.join('; ')}</span> : <span className="chip">ok</span>}</td></tr>)}</tbody></table></div>}
  </Drawer>;
}

function ScenarioDrawer({ d, x, s, seed, name, onClose, onDone }: { d: LcaData; x: LcaDetail; s: LcaScenario | null; seed?: LcaScenario['changes']; name?: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const init = s?.changes ?? seed ?? [];
  const [nm, setNm] = useState(s?.name ?? name ?? '');
  const [ch, setCh] = useState<Record<string, { lciId: string; qty: string; co2e: string }>>(() => Object.fromEntries(init.map((c) => [c.inputId, { lciId: c.lciId ?? '', qty: c.qty != null ? String(c.qty) : '', co2e: c.co2e != null ? String(c.co2e) : '' }])));
  const lib = useMemo(() => new Map(d.library.map((f) => [f.id, f])), [d.library]);
  const up = (id: string, v: Partial<{ lciId: string; qty: string; co2e: string }>) => setCh((o) => ({ ...o, [id]: { ...(o[id] ?? { lciId: '', qty: '', co2e: '' }), ...v } }));
  const preview = x.inputs.reduce((a, l) => {
    if (!l.counted) return a;
    const c = ch[l.id]; const f = c?.lciId ? lib.get(c.lciId) : undefined;
    const per = c?.co2e ? Number(c.co2e) : f ? f.co2e : l.co2e_per_unit, q = c?.qty ? Number(c.qty) : l.qty;
    return a + q * per;
  }, 0);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const changes = Object.entries(ch).filter(([, v]) => v.lciId || v.qty !== '' || v.co2e !== '').map(([inputId, v]) => ({ inputId, lciId: v.lciId || null, qty: v.qty === '' ? null : Number(v.qty), co2e: v.co2e === '' ? null : Number(v.co2e) }));
      await api.lcaScenarioSave({ name: nm.trim(), changes }, x.product.id, s?.id);
      toast(s ? 'Saved' : 'Scenario created'); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <Drawer eyebrow={`${x.product.name} · scenarios`} title={s ? 'Edit scenario' : 'New scenario'} onClose={onClose}
    foot={<button className="btn p" disabled={busy || nm.trim().length < 2} onClick={save}>{s ? 'Save' : 'Create'}</button>}>
    <label className="field"><span>Scenario name</span><input className="input" value={nm} placeholder="e.g. Recycled steel, on-site solar" onChange={(e) => setNm(e.target.value)} /></label>
    <div className="sp-calc">Baseline {kg(x.result.total)} → scenario <b>{kg(preview)}</b> kg CO₂e / {x.product.declared_unit} ({x.result.total ? `${preview < x.result.total ? '' : '+'}${Math.round(((preview - x.result.total) / x.result.total) * 100)}%` : '—'})</div>
    <div className="scroll"><table className="t">
      <thead><tr><th>Input</th><th>Replace with library factor</th><th className="num">New amount</th><th className="num">New factor</th></tr></thead>
      <tbody>{x.inputs.map((l) => { const c = ch[l.id]; const alts = d.library.filter((f) => f.stage === l.stage && f.unit === l.unit && f.id !== l.lci_id);
        return <tr key={l.id}><td><b>{l.name}</b><div className="muted small">{kg(l.qty)} {l.unit} × {kg(l.co2e_per_unit)}</div></td>
          <td><select className="input" value={c?.lciId ?? ''} onChange={(e) => up(l.id, { lciId: e.target.value })}><option value="">— no change —</option>{alts.map((f) => <option key={f.id} value={f.id}>{f.name} · {kg(f.co2e)}</option>)}</select></td>
          <td><input className="input num" style={{ width: 100 }} inputMode="decimal" placeholder={String(l.qty)} value={c?.qty ?? ''} onChange={(e) => up(l.id, { qty: e.target.value })} /></td>
          <td><input className="input num" style={{ width: 100 }} inputMode="decimal" placeholder={String(l.co2e_per_unit)} value={c?.co2e ?? ''} onChange={(e) => up(l.id, { co2e: e.target.value })} /></td></tr>; })}</tbody></table></div>
  </Drawer>;
}

function LibraryDrawer({ d, f, onClose, onDone }: { d: LcaData; f: LciFactor | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [v, setV] = useState({ name: f?.name ?? '', unit: f?.unit ?? 'kg', co2e: f ? String(f.co2e) : '', stage: f?.stage ?? 'raw', source: f?.source ?? '' });
  const up = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.lcaLibrarySave({ name: v.name.trim(), unit: v.unit.trim(), co2e: Number(v.co2e), stage: v.stage, source: v.source.trim() }, f?.id); toast(r.models ? `Saved: ${r.models} models updated and returned to draft` : 'Saved'); onDone(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <Drawer eyebrow="Product LCA · factor library" title={f ? 'Edit company factor' : 'Add a company factor'} onClose={onClose}
    foot={<button className="btn p" disabled={busy || v.name.trim().length < 2 || v.co2e === '' || !Number.isFinite(Number(v.co2e)) || v.source.trim().length < 2} onClick={save}>Save</button>}>
    {f && <div className="note info small">Models using this factor take the new value and return to draft.</div>}
    <div className="vform">
      <label className="field span2"><span>Name</span><input className="input" value={v.name} placeholder="e.g. Steel billet, supplier EPD S-P-01234" onChange={(e) => up({ name: e.target.value })} /></label>
      <label className="field"><span>Stage</span><select className="input" value={v.stage} onChange={(e) => up({ stage: e.target.value })}>{Object.entries(d.stages).map(([k, s]) => <option key={k} value={k}>{s}</option>)}</select></label>
      <label className="field"><span>Unit</span><input className="input" value={v.unit} placeholder="kg, kWh, litre, t-km, m³, unit" onChange={(e) => up({ unit: e.target.value })} /></label>
      <label className="field"><span>kg CO₂e per unit</span><input className="input num" inputMode="decimal" value={v.co2e} onChange={(e) => up({ co2e: e.target.value })} /></label>
      <label className="field span2"><span>Source (database and version, EPD number, measurement)</span><input className="input" value={v.source} onChange={(e) => up({ source: e.target.value })} /></label>
    </div>
  </Drawer>;
}
