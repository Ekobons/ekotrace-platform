/**
 * CBAM exporter portal: the communication an installation outside the EU sends its EU importers each reporting
 * period, following the European Commission's "CBAM Communication template for installations" (v2.1).
 *
 * Step by step, in the template's order: installation and period → goods and processes → emissions (source
 * streams) → energy and data quality → production processes → purchased precursors → products and carbon price
 * → review. Every change is saved and recalculated by the API with the template's formulas; the download is the
 * official workbook with every input cell filled.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, download } from '../lib/api';
import type { CommData, CommLists, CommListItem, CommPrecursor, CommProcess, CommProduct, CommResult, CommStream, CommView, Step } from '../lib/cbamComm';
import { Icon } from '../components/Icon';
import { CountrySelect } from '../components/CountrySelect';

const f = (x: number | null | undefined, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: d }));
const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toLocaleString('en-GB', { maximumFractionDigits: d })}%`);
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ONLY_DIRECT = 'Only direct production';
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'grey'], final: ['Final', ''], sent: ['Sent to importers', 'info'] };
const STEPS: [Step, string, string][] = [
  ['installation', 'Installation & period', 'Who, where and when'],
  ['goods', 'Goods & processes', 'What you make and buy in'],
  ['emissions', 'Fuels & emissions', 'Source streams, PFC, measured'],
  ['energy', 'Energy & data quality', 'Balances, indirect emissions'],
  ['processes', 'Production processes', 'Output, attributed emissions'],
  ['precursors', 'Purchased precursors', 'Embedded emissions bought in'],
  ['products', 'Products & carbon price', 'CN codes for your importers'],
  ['review', 'Review & download', 'Results and the Excel file'],
];
/** IPCC 2006 Guidelines, Vol. 2, Tables 1.2 and 1.4 (default NCV, GJ/t; CO₂ factor, tCO₂/TJ) and typical densities, kg/l. */
const FUELS: [string, number, number, number | null][] = [
  ['Diesel / gas oil', 43.0, 74.1, 0.84], ['LPG', 47.3, 63.1, 0.54], ['Natural gas', 48.0, 56.1, null], ['Heavy fuel oil', 40.4, 77.4, 0.98],
  ['Motor gasoline', 44.3, 69.3, 0.74], ['Kerosene', 43.8, 71.9, 0.8], ['Other bituminous coal', 25.8, 94.6, null], ['Anthracite', 26.7, 98.3, null],
  ['Petroleum coke', 32.5, 97.5, null], ['Coke oven coke', 28.2, 107, null],
];
const STEEL = ['Iron or steel products', 'Crude steel', 'Pig iron', 'Direct reduced iron', 'Alloys (FeMn, FeCr, FeNi)'];
const ALU = ['Aluminium products', 'Unwrought aluminium'];
const PARAMS_FOR: Record<string, string[]> = {
  ...Object.fromEntries(STEEL.map((c) => [c, ['mn', 'cr', 'ni', 'otherAlloys', 'carbonPct', 'scrapSteel', 'otherMaterials', 'preConsumerScrap']])),
  ...Object.fromEntries(ALU.map((c) => [c, ['scrapAl', 'preConsumerScrap', 'nonAl']])),
  Cement: ['clinker'], 'Calcined clays ': ['calcined'], Ammonia: ['concentration'], 'Nitric acid': ['concentration'], Urea: ['ureaPct', 'nTotal'],
  'Mixed fertilisers': ['nTotal', 'nAmmonium', 'nNitrate', 'nUrea', 'nOther', 'nitricAcid', 'ureaPct'],
};
const quarter = (y: number, q: number) => ({ start: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, end: new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10) });
const uid = (p: string, taken: string[]) => { let i = 1; while (taken.includes(`${p}${i}`)) i++; return `${p}${i}`; };

// ------------------------------------------------------------------ inputs --
type Num = number | null;
function NumIn({ v, on, ph, w, disabled, aria }: { v: Num; on: (x: Num) => void; ph?: string; w?: number; disabled?: boolean; aria?: string }) {
  const [t, setT] = useState(v == null ? '' : String(v));
  const last = useRef(v);
  useEffect(() => { if (v !== last.current) { last.current = v; setT(v == null ? '' : String(v)); } }, [v]);
  return <input className="input num" inputMode="decimal" aria-label={aria} disabled={disabled} style={w ? { width: w } : undefined} value={t} placeholder={ph}
    onChange={(e) => {
      const s = e.target.value; setT(s);
      const c = s.replace(/,/g, '').trim();
      const n = c === '' ? null : Number(c);
      if (c === '' || Number.isFinite(n)) { last.current = n; on(n); }
    }} />;
}
/** Percent shown 0–100, stored as a fraction (as the template's product sheet). */
function PctIn({ v, on, aria }: { v: Num; on: (x: Num) => void; aria?: string }) {
  return <NumIn v={v == null ? null : Math.round(v * 1e8) / 1e6} on={(x) => on(x == null ? null : x / 100)} ph="%" aria={aria} />;
}
function Txt({ v, on, ph, aria }: { v: string; on: (x: string) => void; ph?: string; aria?: string }) {
  return <input className="input" value={v} placeholder={ph} aria-label={aria} onChange={(e) => on(e.target.value)} />;
}
function Sel({ v, on, opts, blank = '—', aria }: { v: string; on: (x: string) => void; opts: (string | [string, string])[]; blank?: string | null; aria?: string }) {
  return <select className="input" value={v} aria-label={aria} onChange={(e) => on(e.target.value)}>
    {blank != null && <option value="">{blank}</option>}
    {opts.map((o) => { const [k, l] = typeof o === 'string' ? [o, o.trim()] : o; return <option key={k} value={k}>{l}</option>; })}
    {v && !opts.some((o) => (typeof o === 'string' ? o : o[0]) === v) && <option value={v}>{v}</option>}
  </select>;
}
const Field = ({ l, children, span, hint }: { l: string; children: React.ReactNode; span?: boolean; hint?: React.ReactNode }) =>
  <label className={`field${span ? ' span2' : ''}`}><span>{l}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
function YesNo({ v, on }: { v: boolean; on: (x: boolean) => void }) {
  return <div className="seg sm"><button type="button" className={v ? 'on' : ''} onClick={() => on(true)}>Yes</button><button type="button" className={!v ? 'on' : ''} onClick={() => on(false)}>No</button></div>;
}

// ------------------------------------------------------------------ list --
export function CbamComms({ commId, open }: { commId: string | null; open: (id: string | null) => void }) {
  const { toast } = useApp();
  const [lists, setLists] = useState<CommLists | null>(null);
  useEffect(() => { api.cbamCommLists().then(setLists).catch((e) => toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lists) return <div className="card empty">Loading…</div>;
  return commId ? <Editor key={commId} id={commId} lists={lists} back={() => open(null)} open={open} /> : <CommList lists={lists} open={open} />;
}

function CommList({ open }: { lists: CommLists; open: (id: string) => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<{ comms: CommListItem[]; installations: { id: string; name: string; country: string }[]; can: { edit: boolean } } | null>(null);
  const [tick, setTick] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api.cbamComms().then(setD).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); setTick((t) => t + 1); } catch (e) { toast((e as Error).message); } };
  if (!d) return <div className="card empty">Loading…</div>;
  return <>
    <section className="card cmhero">
      <div className="grow">
        <span className="lbl">Exporter portal</span>
        <h3 style={{ margin: '4px 0 6px' }}>Communication to your EU importers</h3>
        <div className="muted small" style={{ maxWidth: 760 }}>Each reporting period (usually a quarter) your EU importers need the embedded emissions of the goods you sell them, in the European Commission's
          <b> CBAM Communication template for installations</b>. Fill it in here step by step — the calculations run as you type — and download the official Excel, ready to send.</div>
      </div>
      {d.can.edit && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" size={16} /> Import a filled template</button>
        <button className="btn p" onClick={() => setNewOpen(true)}>+ New communication</button>
        <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void run(async () => { const r = await api.cbamCommImport(x); open(r.id); }, 'Template imported'); }} />
      </div>}
    </section>
    {!d.comms.length && <div className="card empty">No communication yet. Start one for the quarter, or import an Excel template you filled before — the next quarters can then be copied from it.</div>}
    {d.comms.length > 0 && <section className="card" style={{ padding: 0 }}><div className="scroll"><table className="t">
      <thead><tr><th>Communication</th><th>Period</th><th>Goods (SEE total)</th><th>Status</th><th>Updated</th><th /></tr></thead>
      <tbody>{d.comms.map((c) => <tr key={c.id} className="click" onClick={() => open(c.id)}>
        <td><b>{c.title}</b><div className="muted small">{c.processes} process{c.processes === 1 ? '' : 'es'} · {c.products} product{c.products === 1 ? '' : 's'}</div></td>
        <td>{c.period || '—'}</td>
        <td className="small">{c.goods.slice(0, 3).map((g, i) => <div key={i}><span className="mono">{g.cn}</span> {g.name} <b>{f(g.seeTotal)}</b> <span className="muted">{g.unit}</span></div>)}{c.goods.length > 3 && <div className="muted">+{c.goods.length - 3} more</div>}{!c.goods.length && <span className="muted">—</span>}</td>
        <td><span className={`chip ${STATUS[c.status]![1]}`}>{STATUS[c.status]![0]}</span>{c.errors > 0 && <div><span className="chip bad">{c.errors} to fix</span></div>}</td>
        <td className="small">{d8(c.updatedAt)}<div className="muted">{c.updatedName}</div></td>
        <td className="num" onClick={(e) => e.stopPropagation()}>
          <button className="btn sm ghost" title="Download the Excel" onClick={() => void download(`/api/cbam/comms/${c.id}/export`, `CBAM_Communication_${c.period || 'period'}.xlsx`).catch((e) => toast((e as Error).message))}><Icon name="download" size={15} /></button>
          {d.can.edit && <button className="btn sm ghost" title="Copy to the next period" onClick={() => void run(async () => { const r = await api.cbamCommCreate({ copyFrom: c.id }); open(r.id); }, 'Copied to the next period')}><Icon name="paste" size={15} /></button>}
          {d.can.edit && <button className="btn sm ghost" title="Delete" onClick={() => { if (confirm(`Delete “${c.title}”?`)) void run(() => api.cbamCommDelete(c.id), 'Deleted'); }}><Icon name="bin" size={15} /></button>}
        </td></tr>)}</tbody></table></div></section>}
    {newOpen && <NewComm installations={d.installations} comms={d.comms} onClose={() => setNewOpen(false)} done={(id) => { setNewOpen(false); open(id); }} />}
  </>;
}

function NewComm({ installations, comms, onClose, done }: { installations: { id: string; name: string }[]; comms: CommListItem[]; onClose: () => void; done: (id: string) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [q, setQ] = useState(Math.floor(now.getUTCMonth() / 3) + 1);
  const [inst, setInst] = useState('');
  const [copy, setCopy] = useState(comms[0]?.id ?? '');
  const [from, setFrom] = useState<'blank' | 'copy'>(comms.length ? 'copy' : 'blank');
  const go = async () => {
    try {
      const period = quarter(year, q);
      const r = await api.cbamCommCreate(from === 'copy' && copy ? { copyFrom: copy, period } : { installationId: inst || null, period });
      done(r.id);
    } catch (e) { toast((e as Error).message); }
  };
  return <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
    <div className="row"><div className="grow"><div className="eyebrow">CBAM · communication</div><h2>New communication</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
    <Field l="Reporting period">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 100 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>{[now.getUTCFullYear() - 2, now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1].map((y) => <option key={y}>{y}</option>)}</select>
        <div className="seg">{[1, 2, 3, 4].map((x) => <button key={x} type="button" className={q === x ? 'on' : ''} onClick={() => setQ(x)}>Q{x}</button>)}</div>
      </div>
    </Field>
    {comms.length > 0 && <div className="seg full"><button type="button" className={from === 'copy' ? 'on' : ''} onClick={() => setFrom('copy')}>Copy a previous one</button><button type="button" className={from === 'blank' ? 'on' : ''} onClick={() => setFrom('blank')}>Start blank</button></div>}
    {from === 'copy' && comms.length > 0
      ? <Field l="Copy from" hint="Installation, goods, processes, precursors, fuels and products are copied; update the amounts for the new period."><select className="input" value={copy} onChange={(e) => setCopy(e.target.value)}>{comms.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
      : <Field l="Installation (optional)" hint="Its address and contact are filled in for you. Installations are kept under the Installations tab."><select className="input" value={inst} onChange={(e) => setInst(e.target.value)}><option value="">— enter the details yourself</option>{installations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>}
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="btn ghost" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" onClick={() => void go()}>Create</button></div>
  </div></dialog>;
}

// ------------------------------------------------------------------ editor --
function Editor({ id, lists, back, open }: { id: string; lists: CommLists; back: () => void; open: (id: string) => void }) {
  const { toast } = useApp();
  const [v, setV] = useState<CommView | null>(null);
  const [d, setD] = useState<CommData | null>(null);
  const [step, setStep] = useState<Step>('installation');
  const [save, setSave] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const timer = useRef<number | null>(null);
  const pending = useRef<CommData | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { api.cbamComm(id).then((x) => { setV(x); setD(x.data); }).catch((e) => toast((e as Error).message)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const data = pending.current; if (!data) return;
    pending.current = null; setSave('saving');
    try { const x = await api.cbamCommSave(id, { data }); setV((o) => (o ? { ...o, comm: x.comm, result: x.result } : x)); setSave(pending.current ? 'dirty' : 'saved'); }
    catch (e) { setSave('error'); toast((e as Error).message); }
  };
  useEffect(() => () => { if (pending.current) void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (fn: (x: CommData) => void) => setD((prev) => {
    if (!prev) return prev;
    const n = structuredClone(prev); fn(n);
    pending.current = n; setSave('dirty');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
    return n;
  });
  if (!v || !d) return <div className="card empty">Loading…</div>;
  const ed = v.can?.edit !== false;
  const R = v.result;
  const issues = (s: Step) => R.checks.filter((c) => c.step === s);
  const errors = R.checks.filter((c) => c.level === 'error');
  const idx = STEPS.findIndex(([k]) => k === step);
  const setStatus = async (status: string) => { await flush(); try { const x = await api.cbamCommSave(id, { status }); setV((o) => (o ? { ...o, comm: x.comm, result: x.result } : x)); toast(status === 'draft' ? 'Back to draft' : status === 'final' ? 'Marked final' : 'Marked as sent'); } catch (e) { toast((e as Error).message); } };
  const dl = async () => { await flush(); try { await download(`/api/cbam/comms/${id}/export`, `CBAM_Communication_${(d.installation.name || 'installation').replace(/[^A-Za-z0-9]+/g, '_')}_${v.comm.period.replace(/\s+/g, '_') || 'period'}.xlsx`); } catch (e) { toast((e as Error).message); } };
  const P = { d, edit, R, lists, ed };
  return <>
    <div className="row cmhead">
      <button className="btn ghost sm" onClick={() => void flush().then(back)}>← All communications</button>
      <div className="grow">
        <input className="cmtitle" value={v.comm.title} aria-label="Title" disabled={!ed} onChange={(e) => { const t = e.target.value; setV({ ...v, comm: { ...v.comm, title: t } }); }} onBlur={(e) => { if (e.target.value.trim()) void api.cbamCommSave(id, { title: e.target.value.trim() }).catch((x) => toast((x as Error).message)); }} />
        <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`chip ${STATUS[v.comm.status]![1]}`}>{STATUS[v.comm.status]![0]}</span>
          {v.comm.period && <span className="chip grey">{v.comm.period}</span>}
          <span className="muted">{save === 'saving' ? 'Saving…' : save === 'dirty' ? 'Unsaved changes' : save === 'error' ? 'Not saved — check your connection' : `Saved${v.comm.updatedName ? ` · ${v.comm.updatedName}` : ''}`}</span>
          <span className="muted">· {v.comm.template}</span>
        </div>
      </div>
      {ed && <button className="btn sm" title="Replace the data with a filled template" onClick={() => file.current?.click()}><Icon name="upload" size={15} /> Load from Excel</button>}
      <button className="btn p" onClick={() => void dl()}><Icon name="download" size={16} /> Download Excel</button>
      <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x && confirm('Replace everything in this communication with the contents of the file?')) void api.cbamCommImport(x, id).then(() => api.cbamComm(id)).then((y) => { setV(y); setD(y.data); toast('Loaded from the file'); }).catch((er) => toast((er as Error).message)); }} />
    </div>
    <div className="entrylayout">
      <nav className="card catrail" aria-label="Steps">
        <span className="lbl" style={{ padding: '4px 10px' }}>Steps</span>
        <div className="catlist">{STEPS.map(([k, l, sub], i) => {
          const e = issues(k).filter((c) => c.level === 'error').length;
          return <button key={k} className={`catbtn${k === step ? ' on' : ''}`} onClick={() => setStep(k)}>
            <span className={`cmnum${k === 'review' ? (errors.length ? ' bad' : ' ok') : e ? ' bad' : ''}`}>{k === 'review' ? <Icon name={errors.length ? 'info' : 'check'} size={14} /> : i + 1}</span>
            <span><b>{l}</b><small className={e ? 'bad' : 'muted'} style={{ fontWeight: 500 }}>{k === 'review' ? (errors.length ? `${errors.length} to fix` : 'Ready') : e ? `${e} to fix` : sub}</small></span>
          </button>;
        })}</div>
        <div className="catfoot small muted">
          {R.products.slice(0, 4).map((p) => <div key={p.i} className="row" style={{ gap: 6 }}><span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.products[p.i]?.name || d.products[p.i]?.cn}</span><b>{f(p.seeTotal)}</b></div>)}
          {R.products.length > 0 && <div>tCO₂e per tonne (SEE total)</div>}
        </div>
      </nav>
      <section className="card cmbody">
        <div><span className="lbl">Step {idx + 1} of {STEPS.length}</span><h2 style={{ margin: '2px 0 0' }}>{STEPS[idx]![1]}</h2></div>
        {issues(step).length > 0 && step !== 'review' && <div className="note warn small"><b>To complete:</b><ul className="steps" style={{ marginTop: 4 }}>{issues(step).slice(0, 8).map((c, i) => <li key={i}>{c.msg}</li>)}</ul>{issues(step).length > 8 && <div>…and {issues(step).length - 8} more</div>}</div>}
        <fieldset disabled={!ed} className="cmfs">
          {step === 'installation' && <StepInstallation {...P} />}
          {step === 'goods' && <StepGoods {...P} />}
          {step === 'emissions' && <StepEmissions {...P} />}
          {step === 'energy' && <StepEnergy {...P} />}
          {step === 'processes' && <StepProcesses {...P} />}
          {step === 'precursors' && <StepPrecursors {...P} />}
          {step === 'products' && <StepProducts {...P} />}
        </fieldset>
        {step === 'review' && <StepReview {...P} v={v} go={setStep} setStatus={setStatus} dl={dl} copyNext={async () => { await flush(); const r = await api.cbamCommCreate({ copyFrom: id }); open(r.id); toast('Copied to the next period'); }}
          sentTo={(s) => void api.cbamCommSave(id, { sentTo: s }).then((x) => setV((o) => (o ? { ...o, comm: x.comm } : x))).catch((e) => toast((e as Error).message))} />}
        <div className="row" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          {idx > 0 && <button className="btn" onClick={() => setStep(STEPS[idx - 1]![0])}>← {STEPS[idx - 1]![1]}</button>}
          <span className="grow" />
          {idx < STEPS.length - 1 && <button className="btn p" onClick={() => setStep(STEPS[idx + 1]![0])}>{STEPS[idx + 1]![1]} →</button>}
        </div>
      </section>
    </div>
  </>;
}
interface SP { d: CommData; edit: (fn: (x: CommData) => void) => void; R: CommResult; lists: CommLists; ed: boolean }
const good = (lists: CommLists, name: string) => lists.goods.find((g) => g.name === name);

// ------------------------------------------------------------- 1 installation --
function StepInstallation({ d, edit }: SP) {
  const y0 = d.period.start ? Number(d.period.start.slice(0, 4)) : new Date().getUTCFullYear();
  const I = d.installation, V = d.verifier;
  const ti = (k: keyof CommData['installation'], l: string, ph = '', span = false) => <Field l={l} span={span}><Txt v={I[k]} ph={ph} on={(x) => edit((n) => { n.installation[k] = x; })} /></Field>;
  const tv = (k: keyof CommData['verifier'], l: string, ph = '', span = false) => <Field l={l} span={span}><Txt v={V[k]} ph={ph} on={(x) => edit((n) => { n.verifier[k] = x; })} /></Field>;
  const isQ = (q: number) => { const x = quarter(y0, q); return d.period.start === x.start && d.period.end === x.end; };
  return <>
    <h4 className="cmh">Reporting period</h4>
    <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
      <Field l="Quarter"><div className="row" style={{ gap: 6 }}>
        <select className="input" style={{ width: 96 }} value={y0} onChange={(e) => { const y = Number(e.target.value); const q = d.period.start ? Math.floor((Number(d.period.start.slice(5, 7)) - 1) / 3) + 1 : 1; edit((n) => { n.period = quarter(y, q); }); }}>{[y0 - 2, y0 - 1, y0, y0 + 1].map((y) => <option key={y}>{y}</option>)}</select>
        <div className="seg">{[1, 2, 3, 4].map((q) => <button key={q} type="button" className={isQ(q) ? 'on' : ''} onClick={() => edit((n) => { n.period = quarter(y0, q); })}>Q{q}</button>)}</div>
      </div></Field>
      <Field l="Start"><input type="date" className="input" value={d.period.start ?? ''} onChange={(e) => edit((n) => { n.period.start = e.target.value || null; })} /></Field>
      <Field l="End"><input type="date" className="input" value={d.period.end ?? ''} onChange={(e) => edit((n) => { n.period.end = e.target.value || null; })} /></Field>
    </div>
    <h4 className="cmh">About the installation</h4>
    <div className="vform">
      {ti('name', 'Name of the installation (English)', 'e.g. Gulf Steel Works, Rolling Mill 2', true)}
      {ti('nameLocal', 'Name in the local language (optional)', '', true)}
      {ti('economicActivity', 'Economic activity', 'e.g. Manufacture of basic iron and steel', true)}
      {ti('street', 'Street, number', '', true)}
      <Field l="Country"><CountrySelect value={I.country} empty="Choose…" onChange={(c) => edit((n) => { n.installation.country = c; })} /></Field>
      {ti('city', 'City')}
      {ti('postcode', 'Post code')}{ti('poBox', 'P.O. Box')}
      {ti('unlocode', 'UN/LOCODE', 'e.g. AE SHJ — required')}<span />
      {ti('lat', 'Latitude of the main emission source', 'e.g. 25.329000 or 25°19\'44"N')}{ti('lon', 'Longitude', 'e.g. 55.645000')}
      {ti('repName', 'Authorised representative')}{ti('email', 'E-mail')}{ti('phone', 'Telephone')}
    </div>
    <details className="cmdet">
      <summary><b>Verifier</b> <span className="muted small">— only if the report was verified</span></summary>
      <div className="vform" style={{ marginTop: 10 }}>
        {tv('company', 'Verifier company', '', true)}{tv('street', 'Street, number', '', true)}
        {tv('city', 'City')}{tv('postcode', 'Post code')}
        <Field l="Country"><CountrySelect value={V.country} empty="—" onChange={(c) => edit((n) => { n.verifier.country = c; })} /></Field><span />
        {tv('repName', 'Authorised representative')}{tv('email', 'E-mail')}{tv('phone', 'Telephone')}{tv('fax', 'Fax')}
        <Field l="Accreditation member state"><CountrySelect value={V.accreditationState} empty="—" onChange={(c) => edit((n) => { n.verifier.accreditationState = c; })} /></Field>
        {tv('accreditationBody', 'National accreditation body')}{tv('registration', 'Registration number from the accreditation body', '', true)}
      </div>
    </details>
  </>;
}

// ------------------------------------------------------------- 2 goods & processes --
function StepGoods({ d, edit, lists }: SP) {
  const cats = d.goods.map((g) => g.category).filter(Boolean);
  const precSuggest = [...new Set(cats.flatMap((c) => good(lists, c)?.chain ?? []))].filter((c) => !cats.includes(c));
  return <>
    <h4 className="cmh">(a) Aggregated goods categories</h4>
    <div className="muted small">Every category produced here, including precursors made in the installation. Pick the production routes where the category has several.</div>
    {d.goods.map((g, i) => {
      const gt = good(lists, g.category);
      return <div key={i} className="cmrow">
        <span className="cmid">G{i + 1}</span>
        <Field l="Category"><Sel v={g.category} blank="Choose…" opts={lists.goods.map((x) => x.name)} on={(x) => edit((n) => { n.goods[i] = { category: x, routes: [] }; })} /></Field>
        <div className="grow">{gt?.routeRelevant ? <Field l="Production routes"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{gt.routes.map((r) => <button key={r} type="button" className={`chipbtn${g.routes.includes(r) ? ' on' : ''}`}
          onClick={() => edit((n) => { const rs = n.goods[i]!.routes; n.goods[i]!.routes = rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r].slice(0, 6); })}>{r}</button>)}</div></Field>
          : g.category && <div className="muted small" style={{ paddingTop: 22 }}>All production routes{gt?.precursors.length ? ` · relevant precursors: ${gt.chain.slice(1).join(', ')}` : ''}</div>}</div>
        <button className="btn sm ghost" aria-label="Remove" onClick={() => edit((n) => { n.goods.splice(i, 1); })}><Icon name="x" size={15} /></button>
      </div>;
    })}
    {d.goods.length < lists.limits.goods && <div><button className="btn sm" onClick={() => edit((n) => { n.goods.push({ category: '', routes: [] }); })}>+ Goods category</button></div>}

    <h4 className="cmh">(b) Production processes</h4>
    <div className="muted small">One per aggregated goods category (and route). If one process also makes another listed category (e.g. ammonia inside nitric acid), tick it.</div>
    {d.processes.map((p, i) => <div key={p.id} className="cmrow">
      <span className="cmid">P{i + 1}</span>
      <Field l="Name of the process"><Txt v={p.name} ph="e.g. Cold drawing line" on={(x) => edit((n) => { n.processes[i]!.name = x; })} /></Field>
      <Field l="Goods category"><Sel v={p.category} blank="Choose…" opts={cats} on={(x) => edit((n) => { n.processes[i]!.category = x; n.processes[i]!.production = []; })} /></Field>
      <div className="grow"><Field l="Includes"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{[ONLY_DIRECT, ...cats.filter((c) => c !== p.category)].map((c) => <button key={c} type="button" className={`chipbtn${p.includes.includes(c) ? ' on' : ''}`}
        onClick={() => edit((n) => { const x = n.processes[i]!; x.includes = x.includes.includes(c) ? x.includes.filter((y) => y !== c) : [...x.includes, c].slice(0, 6); })}>{c === ONLY_DIRECT ? 'Only direct production' : c}</button>)}</div></Field></div>
      <button className="btn sm ghost" aria-label="Remove" onClick={() => edit((n) => { n.processes.splice(i, 1); for (const q of n.processes) delete q.consumedIn[p.id]; for (const q of n.precursors) delete q.consumedIn[p.id]; n.products = n.products.filter((x) => x.processId !== p.id); })}><Icon name="x" size={15} /></button>
    </div>)}
    {d.processes.length < lists.limits.processes && <div><button className="btn sm" disabled={!cats.length} onClick={() => edit((n) => { const id = uid('p', n.processes.map((x) => x.id)); n.processes.push(newProcess(id, cats.find((c) => !n.processes.some((x) => x.category === c)) ?? cats[0] ?? '')); })}>+ Production process</button>{!cats.length && <span className="muted small"> Add a goods category first.</span>}</div>}

    <h4 className="cmh">Purchased precursors</h4>
    <div className="muted small">Precursors bought from outside the installation (e.g. billets, clinker, ammonia), with the country where they were produced.{precSuggest.length > 0 && <> Relevant for your goods: {precSuggest.join(', ')}.</>}</div>
    {d.precursors.map((p, i) => {
      const gt = good(lists, p.category);
      return <div key={p.id} className="cmrow">
        <span className="cmid">PP{i + 1}</span>
        <Field l="Name"><Txt v={p.name} ph="e.g. Steel billets — supplier X" on={(x) => edit((n) => { n.precursors[i]!.name = x; })} /></Field>
        <Field l="Goods category"><Sel v={p.category} blank="Choose…" opts={[...precSuggest, ...lists.goods.map((g) => g.name).filter((g) => !precSuggest.includes(g))]} on={(x) => edit((n) => { n.precursors[i]!.category = x; n.precursors[i]!.routes = []; n.precursors[i]!.purchased = []; })} /></Field>
        <Field l="Country of production"><CountrySelect value={p.country} empty="Choose…" onChange={(c) => edit((n) => { n.precursors[i]!.country = c; })} /></Field>
        <div className="grow">{gt?.routeRelevant && <Field l="Routes"><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{gt.routes.map((r) => <button key={r} type="button" className={`chipbtn${p.routes.includes(r) ? ' on' : ''}`}
          onClick={() => edit((n) => { const x = n.precursors[i]!; x.routes = x.routes.includes(r) ? x.routes.filter((y) => y !== r) : [...x.routes, r].slice(0, 5); })}>{r}</button>)}</div></Field>}</div>
        <button className="btn sm ghost" aria-label="Remove" onClick={() => edit((n) => { n.precursors.splice(i, 1); })}><Icon name="x" size={15} /></button>
      </div>;
    })}
    {d.precursors.length < lists.limits.precursors && <div><button className="btn sm" onClick={() => edit((n) => { n.precursors.push(newPrecursor(uid('pp', n.precursors.map((x) => x.id)), precSuggest[0] ?? '')); })}>+ Purchased precursor</button></div>}
  </>;
}
const newProcess = (id: string, category: string): CommProcess => ({ id, name: '', category, includes: [ONLY_DIRECT], production: [], market: null, consumedIn: {}, nonCbam: null, heatApplicable: false, wasteGasApplicable: false, dirEm: null,
  heat: { imp: null, impEf: null, exp: null, expEf: null }, wasteGas: { imp: null, impEf: null, exp: null, expEf: null }, elecMwh: null, elecEf: null, elecSource: '', elecExported: 0, elecExportedEf: null, carbon: { share: null, price: null, rebate: null } });
const newPrecursor = (id: string, category: string): CommPrecursor => ({ id, name: '', category, country: '', routes: [], purchased: [], consumedIn: {}, other: 0, seeDirect: null, seeDirectSource: '', elecPerT: null, elecPerTSource: '', elecEf: null, elecEfSource: '', justification: '' });

// ------------------------------------------------------------- 3 emissions --
function StepEmissions({ d, edit, R, lists }: SP) {
  const [litres, setLitres] = useState<{ i: number; l: Num; dens: Num } | null>(null);
  const emptyStream = (): CommStream => ({ method: 'Combustion', name: '', ad: null, unit: 't', ncv: null, ef: null, efUnit: 'tCO2/TJ', carbon: null, oxf: null, convf: null, bio: null });
  const S = (i: number, fn: (s: CommStream) => void) => edit((n) => { fn(n.streams[i]!); });
  return <>
    <h4 className="cmh">(a) Source streams — calculation-based</h4>
    <div className="muted small">Fuels and materials of the whole installation for the period. Activity data in tonnes (or 1000 Nm³ for gases); net calorific value in GJ/t; emission factor in tCO₂/TJ, or per tonne for process emissions. Mass balance: carbon content in tC/t, outputs as negative amounts.</div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="muted small" style={{ alignSelf: 'center' }}>Add a fuel with IPCC default values:</span>
      {FUELS.map(([n, ncv, ef]) => <button key={n} type="button" className="chipbtn" onClick={() => edit((x) => { x.streams.push({ ...emptyStream(), name: n, ncv, ef }); })}>+ {n}</button>)}</div>
    {d.streams.map((s, i) => {
      const o = R.streams[i];
      const mb = s.method === 'Mass Balance';
      const dens = FUELS.find(([n]) => n === s.name)?.[3] ?? null;
      return <div key={i} className="cmstream">
        <div className="cmsl">
          <span className="cmid">{i + 1}</span>
          <Field l="Method"><Sel v={s.method} blank={null} opts={lists.lists.method} on={(x) => S(i, (y) => { y.method = x; if (x === 'Process emissions' && y.efUnit === 'tCO2/TJ') y.efUnit = 'tCO2/t'; })} /></Field>
          <div className="grow"><Field l="Source stream"><Txt v={s.name} ph="e.g. Natural gas" on={(x) => S(i, (y) => { y.name = x; })} /></Field></div>
          <Field l={`Activity data (${s.unit === '1000Nm3' ? '1000 Nm³' : 't'})`}><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><NumIn v={s.ad} on={(x) => S(i, (y) => { y.ad = x; })} w={120} aria="Activity data" />
            <Sel v={s.unit} blank={null} opts={lists.lists.adUnits} on={(x) => S(i, (y) => { y.unit = x; })} aria="Unit" /></div></Field>
          <div className="cmout">{o?.problem ? <span className="chip bad">{o.problem}</span> : <><b>{f(o?.co2, 4)}</b><span className="muted small">tCO₂{o && o.bio > 0 ? ` · bio ${f(o.bio, 3)}` : ''}</span></>}</div>
          <button className="btn sm ghost" aria-label="Remove" onClick={() => edit((n) => { n.streams.splice(i, 1); })}><Icon name="x" size={15} /></button>
        </div>
        <div className="cmsl sub">
          {!mb && <Field l="NCV (GJ/t)"><NumIn v={s.ncv} on={(x) => S(i, (y) => { y.ncv = x; })} w={100} aria="NCV" /></Field>}
          {!mb && <Field l="Emission factor"><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><NumIn v={s.ef} on={(x) => S(i, (y) => { y.ef = x; })} w={100} aria="Emission factor" /><Sel v={s.efUnit} blank={null} opts={lists.lists.efUnits} on={(x) => S(i, (y) => { y.efUnit = x; })} aria="EF unit" /></div></Field>}
          {mb && <Field l="Carbon content (tC/t)"><NumIn v={s.carbon} on={(x) => S(i, (y) => { y.carbon = x; })} w={110} aria="Carbon content" /></Field>}
          {s.method === 'Combustion' && <Field l="Oxidation factor %"><NumIn v={s.oxf} ph="100" on={(x) => S(i, (y) => { y.oxf = x; })} w={80} aria="Oxidation factor" /></Field>}
          {s.method === 'Process emissions' && <Field l="Conversion factor %"><NumIn v={s.convf} ph="100" on={(x) => S(i, (y) => { y.convf = x; })} w={80} aria="Conversion factor" /></Field>}
          <Field l="Biomass %"><NumIn v={s.bio} ph="0" on={(x) => S(i, (y) => { y.bio = x; })} w={70} aria="Biomass" /></Field>
          {s.unit === 't' && !mb && (litres?.i === i
            ? <div className="row" style={{ gap: 6, alignItems: 'end' }}>
                <Field l="Litres"><NumIn v={litres.l} on={(x) => setLitres({ ...litres, l: x })} w={110} /></Field>
                <Field l="Density kg/l"><NumIn v={litres.dens} on={(x) => setLitres({ ...litres, dens: x })} w={80} /></Field>
                <button className="btn sm p" disabled={litres.l == null || litres.dens == null} onClick={() => { S(i, (y) => { y.ad = Math.round(litres.l! * litres.dens! / 1000 * 1e6) / 1e6; }); setLitres(null); }}>Use {f(litres.l != null && litres.dens != null ? litres.l * litres.dens / 1000 : null, 4)} t</button>
                <button className="btn sm ghost" onClick={() => setLitres(null)}>Cancel</button></div>
            : <button type="button" className="btn sm ghost" style={{ alignSelf: 'end' }} onClick={() => setLitres({ i, l: null, dens })}>Enter in litres…</button>)}
        </div>
      </div>;
    })}
    {!d.streams.length && <div className="muted small">No source stream yet — add the fuels burnt and materials used.</div>}
    {d.streams.length > 0 && <div className="note small"><b>Total CO₂ from source streams: {f(R.streams.reduce((a, s) => a + (s.co2 ?? 0), 0), 4)} tCO₂</b></div>}
    {d.streams.length < lists.limits.streams && <div><button className="btn sm" onClick={() => edit((n) => { n.streams.push(emptyStream()); })}>+ Source stream</button></div>}
    <div className="muted small">IPCC defaults are a start: use your own laboratory analyses or supplier values where you have them, and record the data quality in the next step.</div>

    <details className="cmdet" open={d.pfc.length > 0}>
      <summary><b>(b) PFC emissions</b> <span className="muted small">— primary aluminium smelters only</span></summary>
      {d.pfc.map((p, i) => <div key={i} className="vform cmbox">
        <Field l="Method"><Sel v={p.method} opts={lists.lists.pfcMethod} on={(x) => edit((n) => { n.pfc[i]!.method = x; })} /></Field>
        <Field l="Technology type"><Txt v={p.technology} ph="e.g. Centre Worked Pre-Bake (CWPB)" on={(x) => edit((n) => { n.pfc[i]!.technology = x; })} /></Field>
        <Field l="Primary aluminium produced (t)"><NumIn v={p.ad} on={(x) => edit((n) => { n.pfc[i]!.ad = x; })} /></Field>
        {p.method === 'Overvoltage method' ? <>
          <Field l="AEO — anode effect overvoltage (mV/cell)"><NumIn v={p.aeo} on={(x) => edit((n) => { n.pfc[i]!.aeo = x; })} /></Field>
          <Field l="CE — current efficiency"><NumIn v={p.ce} on={(x) => edit((n) => { n.pfc[i]!.ce = x; })} /></Field>
          <Field l="OVC — overvoltage coefficient"><NumIn v={p.ovc} on={(x) => edit((n) => { n.pfc[i]!.ovc = x; })} /></Field>
        </> : <>
          <Field l="Anode effect frequency (per cell-day)"><NumIn v={p.frequency} on={(x) => edit((n) => { n.pfc[i]!.frequency = x; })} /></Field>
          <Field l="Anode effect duration (minutes)"><NumIn v={p.duration} on={(x) => edit((n) => { n.pfc[i]!.duration = x; })} /></Field>
          <Field l="SEF(CF₄) — slope emission factor"><NumIn v={p.sef} on={(x) => edit((n) => { n.pfc[i]!.sef = x; })} /></Field>
        </>}
        <Field l="F(C₂F₆) — weight fraction of C₂F₆"><NumIn v={p.fC2F6} on={(x) => edit((n) => { n.pfc[i]!.fC2F6 = x; })} /></Field>
        <Field l="Collection efficiency (fraction, e.g. 0.98)"><NumIn v={p.collection} on={(x) => edit((n) => { n.pfc[i]!.collection = x; })} /></Field>
        <div className="row span2"><span className="grow">PFC emissions: <b>{f(R.pfc[i], 2)}</b> tCO₂e (GWP CF₄ {lists.consts.gwpCF4}, C₂F₆ {lists.consts.gwpC2F6})</span><button className="btn sm ghost" onClick={() => edit((n) => { n.pfc.splice(i, 1); })}>Remove</button></div>
      </div>)}
      {d.pfc.length < lists.limits.pfc && <button className="btn sm" onClick={() => edit((n) => { n.pfc.push({ method: 'Slope method', technology: '', ad: null, frequency: null, duration: null, sef: null, aeo: null, ce: null, ovc: null, fC2F6: null, collection: null }); })}>+ PFC emissions</button>}
    </details>

    <details className="cmdet" open={d.measured.length > 0}>
      <summary><b>(c) Emission sources — measurement-based</b> <span className="muted small">— continuous emission monitoring (CEMS), e.g. N₂O from nitric acid</span></summary>
      {d.measured.map((m, i) => <div key={i} className="vform cmbox">
        <Field l="Name"><Txt v={m.name} on={(x) => edit((n) => { n.measured[i]!.name = x; })} /></Field>
        <Field l="Greenhouse gas"><Sel v={m.gas} opts={lists.lists.cemsGas} on={(x) => edit((n) => { n.measured[i]!.gas = x; })} /></Field>
        <Field l="Hourly concentration, average (g/Nm³)"><NumIn v={m.conc} on={(x) => edit((n) => { n.measured[i]!.conc = x; })} /></Field>
        <Field l="Hours operating in the period"><NumIn v={m.hours} on={(x) => edit((n) => { n.measured[i]!.hours = x; })} /></Field>
        <Field l="Flue gas flow, average (1000 Nm³/h)"><NumIn v={m.flow} on={(x) => edit((n) => { n.measured[i]!.flow = x; })} /></Field>
        <Field l="Biomass fraction %"><NumIn v={m.bio} on={(x) => edit((n) => { n.measured[i]!.bio = x; })} /></Field>
        {m.gas === 'CO2' && <><Field l="Energy content, fossil (TJ)"><NumIn v={m.energyFossil} on={(x) => edit((n) => { n.measured[i]!.energyFossil = x; })} /></Field>
          <Field l="Energy content, biomass (TJ)"><NumIn v={m.energyBio} on={(x) => edit((n) => { n.measured[i]!.energyBio = x; })} /></Field></>}
        <div className="row span2"><span className="grow">Emissions: <b>{f(R.measured[i], 2)}</b> tCO₂e{m.gas === 'N2O' && ` (GWP N₂O ${lists.consts.gwpN2O})`}</span><button className="btn sm ghost" onClick={() => edit((n) => { n.measured.splice(i, 1); })}>Remove</button></div>
      </div>)}
      {d.measured.length < lists.limits.measured && <button className="btn sm" onClick={() => edit((n) => { n.measured.push({ name: '', gas: 'CO2', bio: null, conc: null, hours: null, flow: null, energyFossil: null, energyBio: null }); })}>+ Measured emission source</button>}
    </details>
  </>;
}

// ------------------------------------------------------------- 4 energy & quality --
function StepEnergy({ d, edit, R, lists }: SP) {
  const G = R.ghg;
  const ov = (k: keyof CommData['ghg'], auto: number, label: string) => <tr><td>{label}</td><td className="num">{f(auto, 4)}</td>
    <td><NumIn v={d.ghg[k]} ph="use calculated" on={(x) => edit((n) => { n.ghg[k] = x; })} w={140} aria={label} /></td></tr>;
  return <>
    <h4 className="cmh">1 · Fuel balance</h4>
    <div className="muted small">Energy of the fuels burnt, split by use. The total comes from the source streams; enter a figure only to replace it.</div>
    <div className="scroll"><table className="t"><thead><tr><th>TJ</th><th className="num">From source streams</th><th>Total fuel input (manual)</th><th>Direct fuel for CBAM goods</th><th>Fuel for electricity</th><th>Fuel for non-CBAM goods</th><th className="num">Rest</th></tr></thead>
      <tbody><tr><td>Fuel input</td><td className="num">{f(R.fuel.fromStreams, 5)}</td>
        <td><NumIn v={d.fuel.total} ph="calculated" on={(x) => edit((n) => { n.fuel.total = x; })} w={120} /></td>
        <td><NumIn v={d.fuel.cbam} on={(x) => edit((n) => { n.fuel.cbam = x; })} w={120} /></td>
        <td><NumIn v={d.fuel.electricity} on={(x) => edit((n) => { n.fuel.electricity = x; })} w={120} /></td>
        <td><NumIn v={d.fuel.nonCbam} on={(x) => edit((n) => { n.fuel.nonCbam = x; })} w={120} /></td>
        <td className="num">{f(R.fuel.rest, 5)}</td></tr></tbody></table></div>

    <h4 className="cmh">2 · Greenhouse gas balance of the installation</h4>
    <div className="scroll"><table className="t"><thead><tr><th>tCO₂e</th><th className="num">Calculated (step 3)</th><th>Manual entry (replaces it)</th></tr></thead>
      <tbody>
        {ov('co2', G.auto.co2, 'Total CO₂ emissions')}
        {ov('biomass', G.auto.biomass, 'Biomass emissions')}
        {ov('n2o', G.auto.n2o, 'Total N₂O emissions')}
        {ov('pfc', G.auto.pfc, 'Total PFC emissions')}
        <tr className="sectionrow"><td><b>Total direct emissions</b></td><td className="num"><b>{f(G.direct, 4)}</b></td><td /></tr>
        <tr><td><b>Total indirect emissions</b> <span className="chip warn">always entered</span><div className="muted small">Electricity consumed by the whole installation × its emission factor.</div></td>
          <td className="num">{G.indirectSuggested > 0 && <button className="btn sm" title="Sum of electricity × factor over the production processes" onClick={() => edit((n) => { n.ghg.indirect = Math.round(G.indirectSuggested * 1e6) / 1e6; })}>Use {f(G.indirectSuggested, 4)} from processes</button>}</td>
          <td><NumIn v={d.ghg.indirect} on={(x) => edit((n) => { n.ghg.indirect = x; })} w={140} aria="Total indirect emissions" /></td></tr>
        <tr className="sectionrow"><td><b>Total emissions</b></td><td className="num"><b>{f(G.total, 4)}</b></td><td /></tr>
      </tbody></table></div>

    <h4 className="cmh">3 · Data quality and quality assurance</h4>
    <div className="vform">
      <Field l="General information on data quality" span hint="Highest level that describes most of your data."><Sel v={d.quality.general} opts={lists.lists.dataQuality} on={(x) => edit((n) => { n.quality.general = x; })} /></Field>
      <Field l="Justification for using default values (if relevant)"><Sel v={d.quality.justification} opts={lists.lists.justification} on={(x) => edit((n) => { n.quality.justification = x; })} /></Field>
      <Field l="Quality assurance"><Sel v={d.quality.assurance} opts={lists.lists.verification} on={(x) => edit((n) => { n.quality.assurance = x; })} /></Field>
    </div>
  </>;
}

// ------------------------------------------------------------- 5 processes --
function StepProcesses({ d, edit, R, lists }: SP) {
  const [sel, setSel] = useState(d.processes[0]?.id ?? '');
  const [share, setShare] = useState<Num>(null);
  const i = Math.max(0, d.processes.findIndex((p) => p.id === sel));
  const p = d.processes[i];
  if (!p) return <div className="card empty">Add the production processes under step 2 first.</div>;
  const gt = good(lists, p.category);
  const routes = gt?.routes ?? ['All production routes'];
  const node = R.nodes.find((n) => n.id === p.id);
  const unit = gt?.unit ?? 't';
  const total = p.production.reduce<number>((a, b) => a + (b ?? 0), 0);
  const used = (p.market ?? 0) + Object.values(p.consumedIn).reduce<number>((a, b) => a + (b ?? 0), 0) + (p.nonCbam ?? 0);
  const others = d.processes.filter((q) => q.id !== p.id);
  const U = (fn: (x: CommProcess) => void) => edit((n) => { fn(n.processes[i]!); });
  return <>
    {d.processes.length > 1 && <div className="seg">{d.processes.map((q, k) => <button key={q.id} type="button" className={q.id === p.id ? 'on' : ''} onClick={() => setSel(q.id)}>P{k + 1} {q.name || 'unnamed'}</button>)}</div>}
    <div className="note info small"><b>{p.name || 'Unnamed process'}</b> · {p.category || 'no category'} · results per {unit}: SEE direct <b>{f(node?.seeDirect)}</b>, indirect <b>{f(node?.seeIndirect)}</b>, total <b>{f(node?.seeTotal)}</b> tCO₂e/{unit}</div>

    <h4 className="cmh">(a) Total production in the period ({unit})</h4>
    <div className="vform">{routes.map((r, k) => <Field key={r} l={gt?.routeRelevant ? r : 'Total production'}><NumIn v={p.production[k] ?? null} on={(x) => U((y) => { const a = [...y.production]; while (a.length < k) a.push(null); a[k] = x; y.production = a; })} /></Field>)}</div>
    <h4 className="cmh">(b)–(d) Where the output went ({unit})</h4>
    <div className="vform">
      <Field l="Produced for the market"><NumIn v={p.market} on={(x) => U((y) => { y.market = x; })} /></Field>
      <Field l="Consumed for non-CBAM goods in the installation"><NumIn v={p.nonCbam} on={(x) => U((y) => { y.nonCbam = x; })} /></Field>
      {others.map((q) => <Field key={q.id} l={`Used in “${q.name || 'unnamed'}”`}><NumIn v={p.consumedIn[q.id] ?? null} on={(x) => U((y) => { y.consumedIn[q.id] = x; })} /></Field>)}
    </div>
    <div className={`note small ${total > 0 && Math.abs(total - used) < 1e-6 ? 'ok' : 'warn'}`}>Control: production {f(total, 4)} − (market + used + non-CBAM) {f(used, 4)} = <b>{f(total - used, 4)}</b> {unit}{total > 0 && Math.abs(total - used) < 1e-6 ? ' ✓' : ' — should be 0'}
      {total > 0 && p.market == null && <> · <button type="button" className="btn sm" onClick={() => U((y) => { y.market = Math.round((total - Object.values(y.consumedIn).reduce<number>((a, b) => a + (b ?? 0), 0) - (y.nonCbam ?? 0)) * 1e6) / 1e6; })}>Put the rest to the market</button></>}</div>

    <h4 className="cmh">(f)–(g) Attributed emissions</h4>
    <div className="vform">
      <Field l="Measurable heat imported or exported?"><YesNo v={p.heatApplicable} on={(x) => U((y) => { y.heatApplicable = x; })} /></Field>
      <Field l="Waste gases imported or exported?"><YesNo v={p.wasteGasApplicable} on={(x) => U((y) => { y.wasteGasApplicable = x; })} /></Field>
      <Field l="Directly attributable emissions (tCO₂e)" span hint={<>The part of the installation's direct emissions ({f(R.ghg.direct, 4)} tCO₂e) that belongs to this process.{' '}
        <span className="row" style={{ gap: 6, display: 'inline-flex', alignItems: 'center' }}>Share <NumIn v={share} on={setShare} w={70} ph="%" /> % <button type="button" className="btn sm" disabled={share == null} onClick={() => U((y) => { y.dirEm = Math.round(R.ghg.direct * (share ?? 0) / 100 * 1e9) / 1e9; })}>Use</button>
          {d.processes.length === 1 && <button type="button" className="btn sm" onClick={() => U((y) => { y.dirEm = Math.round(R.ghg.direct * 1e9) / 1e9; })}>All of it</button>}</span></>}>
        <NumIn v={p.dirEm} on={(x) => U((y) => { y.dirEm = x; })} /></Field>
    </div>
    {p.heatApplicable && <><h4 className="cmh">(h) Measurable heat</h4><div className="vform">
      <Field l="Imported net heat (TJ)"><NumIn v={p.heat.imp} on={(x) => U((y) => { y.heat.imp = x; })} /></Field><Field l="Emission factor of imported heat (tCO₂/TJ)"><NumIn v={p.heat.impEf} on={(x) => U((y) => { y.heat.impEf = x; })} /></Field>
      <Field l="Exported net heat (TJ)"><NumIn v={p.heat.exp} on={(x) => U((y) => { y.heat.exp = x; })} /></Field><Field l="Emission factor of exported heat (tCO₂/TJ)"><NumIn v={p.heat.expEf} on={(x) => U((y) => { y.heat.expEf = x; })} /></Field>
    </div></>}
    {p.wasteGasApplicable && <><h4 className="cmh">(i) Waste gases</h4><div className="muted small">Credited at the natural gas factor ({lists.consts.efNatGas} tCO₂/TJ); exported waste gas × 0.667, as in the template.</div><div className="vform">
      <Field l="Imported waste gas (TJ)"><NumIn v={p.wasteGas.imp} on={(x) => U((y) => { y.wasteGas.imp = x; })} /></Field><Field l="Emission factor (tCO₂/TJ)"><NumIn v={p.wasteGas.impEf} on={(x) => U((y) => { y.wasteGas.impEf = x; })} /></Field>
      <Field l="Exported waste gas (TJ)"><NumIn v={p.wasteGas.exp} on={(x) => U((y) => { y.wasteGas.exp = x; })} /></Field><Field l="Emission factor (tCO₂/TJ)"><NumIn v={p.wasteGas.expEf} on={(x) => U((y) => { y.wasteGas.expEf = x; })} /></Field>
    </div></>}
    <h4 className="cmh">(j) Electricity consumed</h4>
    <div className="vform">
      <Field l="Electricity consumption (MWh)"><NumIn v={p.elecMwh} on={(x) => U((y) => { y.elecMwh = x; })} /></Field>
      <Field l="Emission factor (tCO₂/MWh)"><NumIn v={p.elecEf} on={(x) => U((y) => { y.elecEf = x; })} /></Field>
      <Field l="Source of the emission factor" hint="Section D.4 of Annex III of Implementing Regulation (EU) 2023/1773; “Mix” when several apply."><Sel v={p.elecSource} opts={lists.lists.elecSource} on={(x) => U((y) => { y.elecSource = x; })} /></Field>
      <div className="muted small" style={{ alignSelf: 'end' }}>Indirect emissions: <b>{f(node?.attrIndirect, 4)}</b> tCO₂e</div>
    </div>
    <h4 className="cmh">(k) Electricity exported from the process</h4>
    <div className="vform">
      <Field l="Amount exported (MWh)"><NumIn v={p.elecExported} on={(x) => U((y) => { y.elecExported = x; })} /></Field>
      <Field l="Emission factor (tCO₂/MWh)"><NumIn v={p.elecExportedEf} on={(x) => U((y) => { y.elecExportedEf = x; })} /></Field>
    </div>
    <div className="note small">Attributed direct emissions: <b>{f(node?.attrDirect, 4)}</b> tCO₂e (directly attributable + heat + waste gases − exported electricity).</div>
  </>;
}

// ------------------------------------------------------------- 6 precursors --
function StepPrecursors({ d, edit, R, lists }: SP) {
  const [sel, setSel] = useState(d.precursors[0]?.id ?? '');
  const i = Math.max(0, d.precursors.findIndex((p) => p.id === sel));
  const p = d.precursors[i];
  if (!p) return <div className="card empty">No purchased precursor. If you buy in precursors (e.g. billets, clinker, ammonia), add them under step 2; otherwise skip this step.</div>;
  const gt = good(lists, p.category);
  const routes = gt?.routes ?? ['All production routes'];
  const unit = gt?.unit ?? 't';
  const total = p.purchased.reduce<number>((a, b) => a + (b ?? 0), 0);
  const used = Object.values(p.consumedIn).reduce<number>((a, b) => a + (b ?? 0), 0) + (p.other ?? 0);
  const U = (fn: (x: CommPrecursor) => void) => edit((n) => { fn(n.precursors[i]!); });
  const node = R.nodes.find((n) => n.id === p.id);
  const needsJust = [p.seeDirectSource, p.elecPerTSource].some((s) => s === 'Default' || s === 'Unknown');
  return <>
    {d.precursors.length > 1 && <div className="seg">{d.precursors.map((q, k) => <button key={q.id} type="button" className={q.id === p.id ? 'on' : ''} onClick={() => setSel(q.id)}>PP{k + 1} {q.name || 'unnamed'}</button>)}</div>}
    <div className="note info small"><b>{p.name || 'Unnamed precursor'}</b> · {p.category || 'no category'}{p.country && ` · produced in ${p.country}`}</div>
    <h4 className="cmh">(a) Purchased in the period ({unit})</h4>
    <div className="vform">{routes.map((r, k) => <Field key={r} l={gt?.routeRelevant ? r : 'Total purchased'}><NumIn v={p.purchased[k] ?? null} on={(x) => U((y) => { const a = [...y.purchased]; while (a.length < k) a.push(null); a[k] = x; y.purchased = a; })} /></Field>)}</div>
    <h4 className="cmh">(b)–(c) Where it was used ({unit})</h4>
    <div className="vform">
      {d.processes.map((q) => <Field key={q.id} l={`Consumed in “${q.name || 'unnamed'}”`}><NumIn v={p.consumedIn[q.id] ?? null} on={(x) => U((y) => { y.consumedIn[q.id] = x; })} /></Field>)}
      <Field l="Other uses (sold, non-CBAM goods)"><NumIn v={p.other} on={(x) => U((y) => { y.other = x; })} /></Field>
    </div>
    <div className={`note small ${total > 0 && Math.abs(total - used) < 1e-6 ? 'ok' : 'warn'}`}>Control: purchased {f(total, 4)} − used {f(used, 4)} = <b>{f(total - used, 4)}</b> {unit}{total > 0 && Math.abs(total - used) < 1e-6 ? ' ✓' : ' — should be 0'}</div>
    <h4 className="cmh">(e) Embedded emissions of this precursor</h4>
    <div className="muted small">From your supplier's communication (measured), or the Commission's default values where the supplier gave none.</div>
    <div className="scroll"><table className="t"><thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Source</th></tr></thead><tbody>
      <tr><td>Specific embedded direct emissions — SEE (direct)</td><td><NumIn v={p.seeDirect} on={(x) => U((y) => { y.seeDirect = x; })} w={120} /></td><td className="muted">tCO₂e/{unit}</td><td><Sel v={p.seeDirectSource} opts={lists.lists.measDefault} on={(x) => U((y) => { y.seeDirectSource = x; })} /></td></tr>
      <tr><td>Specific electricity consumption (for SEE indirect)</td><td><NumIn v={p.elecPerT} on={(x) => U((y) => { y.elecPerT = x; })} w={120} /></td><td className="muted">MWh/{unit}</td><td><Sel v={p.elecPerTSource} opts={lists.lists.measDefault} on={(x) => U((y) => { y.elecPerTSource = x; })} /></td></tr>
      <tr><td>Electricity emission factor (for SEE indirect)</td><td><NumIn v={p.elecEf} on={(x) => U((y) => { y.elecEf = x; })} w={120} /></td><td className="muted">tCO₂e/MWh</td><td><Sel v={p.elecEfSource} opts={lists.lists.elecSource} on={(x) => U((y) => { y.elecEfSource = x; })} /></td></tr>
      <tr className="sectionrow"><td>Specific embedded indirect emissions — SEE (indirect)</td><td className="num"><b>{f(node?.seeIndirect, 4)}</b></td><td className="muted">tCO₂e/{unit}</td><td /></tr>
    </tbody></table></div>
    {(needsJust || p.justification) && <div className="vform"><Field l="Justification for using default values"><Sel v={p.justification} opts={lists.lists.justification} on={(x) => U((y) => { y.justification = x; })} /></Field></div>}
  </>;
}

// ------------------------------------------------------------- 7 products --
function StepProducts({ d, edit, R, lists }: SP) {
  const [all, setAll] = useState(false);
  const blank = (pid: string): CommProduct => ({ processId: pid, cn: '', name: '', reducingAgent: '', millId: '', params: {}, cpType: '', cpShare: null, currency: d.carbonCurrency, cpDue: null, rebateType: '', rebateShare: null, rebate: null });
  const anyCarbon = d.processes.some((p) => p.carbon.price != null || p.carbon.share != null);
  return <>
    <h4 className="cmh">Goods supplied (CN codes)</h4>
    <div className="muted small">One line per CN code and product name your importers will see — the name as on invoices helps them match it. The embedded emissions come from the production process.</div>
    {d.products.map((p, i) => {
      const proc = d.processes.find((x) => x.id === p.processId);
      const gt = proc ? good(lists, proc.category) : undefined;
      const res = R.products[i];
      const keys = all ? lists.params.map((x) => x.key) : PARAMS_FOR[proc?.category ?? ''] ?? [];
      const steel = proc && STEEL.includes(proc.category);
      const U = (fn: (x: CommProduct) => void) => edit((n) => { fn(n.products[i]!); });
      const node = R.nodes.find((n) => n.id === p.processId);
      return <div key={i} className="cmbox">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <span className="cmid">{i + 1}</span>
          <Field l="Production process"><Sel v={p.processId} blank="Choose…" opts={d.processes.map((x) => [x.id, x.name || 'unnamed'])} on={(x) => U((y) => { y.processId = x; y.cn = ''; })} /></Field>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}><Field l="CN code"><select className="input" value={p.cn} onChange={(e) => U((y) => { y.cn = e.target.value; })}>
            <option value="">{gt ? 'Choose…' : 'Pick the process first'}</option>
            {(gt?.cn ?? []).map((c) => <option key={c} value={c}>{c} — {(lists.cnNames[c] ?? '').slice(0, 110)}</option>)}
          </select></Field></div>
          <Field l="Product name (with the importer)"><Txt v={p.name} ph="e.g. HR coil 3 mm" on={(x) => U((y) => { y.name = x; })} /></Field>
          <button className="btn sm ghost" aria-label="Remove" onClick={() => edit((n) => { n.products.splice(i, 1); })}><Icon name="x" size={15} /></button>
        </div>
        {res && res.seeTotal != null && <div className="cmres">
          <span>SEE direct <b>{f(res.seeDirect)}</b></span><span>indirect <b>{f(res.seeIndirect)}</b></span><span>total <b>{f(res.seeTotal)}</b> {res.unit}</span>
          <span>from default values <b>{pct(res.defaultShare)}</b></span><span>embedded electricity <b>{f(res.embeddedElec)}</b> MWh/{gt?.unit ?? 't'}</span><span>electricity factor source <b>{res.elecSource || '—'}</b></span>
        </div>}
        <details className="cmdet">
          <summary><b>Qualifying parameters</b> <span className="muted small">— optional, for the goods that have them</span></summary>
          <div className="vform" style={{ marginTop: 8 }}>
            {steel && <><Field l="Main reducing agent of the precursor"><Sel v={p.reducingAgent} opts={lists.lists.reducingAgent} on={(x) => U((y) => { y.reducingAgent = x; })} /></Field>
              <Field l="Steel mill identification number"><Txt v={p.millId} on={(x) => U((y) => { y.millId = x; })} /></Field></>}
            {lists.params.filter((x) => keys.includes(x.key)).map((x) => <Field key={x.key} l={x.label}>{x.kind === 'bool'
              ? <Sel v={p.params[x.key] == null ? '' : p.params[x.key] ? 'yes' : 'no'} opts={[['yes', 'Calcined'], ['no', 'Not calcined']]} on={(s) => U((y) => { y.params[x.key] = s === '' ? null : s === 'yes'; })} />
              : <PctIn v={(p.params[x.key] as number | null) ?? null} on={(n) => U((y) => { y.params[x.key] = n; })} aria={x.label} />}</Field>)}
            {!keys.length && !steel && <div className="muted small span2">No qualifying parameter for this category.</div>}
          </div>
          <label className="row small" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every parameter of the template</label>
        </details>
        <details className="cmdet" open={!!p.cpType && p.cpType !== 'None'}>
          <summary><b>Carbon price due in the country of production</b> <span className="muted small">— carbon tax or ETS paid on these emissions, and any rebate</span></summary>
          <div className="vform" style={{ marginTop: 8 }}>
            <Field l="Type of instrument"><Sel v={p.cpType} opts={['None', ...lists.lists.carbonPrice]} on={(x) => U((y) => { y.cpType = x; })} /></Field>
            <Field l="Share of embedded emissions covered (%)"><PctIn v={p.cpShare} on={(x) => U((y) => { y.cpShare = x; })} /></Field>
            <Field l="Currency"><Sel v={p.currency} opts={lists.currencies.map(([c, n]) => [c, `${c} — ${n}`])} on={(x) => U((y) => { y.currency = x; })} /></Field>
            <Field l={`Carbon price due per ${gt?.unit ?? 't'} produced`} hint={node?.cpDue ? <button type="button" className="btn sm" onClick={() => U((y) => { y.cpDue = Math.round((node.cpDue ?? 0) * 1e6) / 1e6; y.rebate = Math.round((node.rebate ?? 0) * 1e6) / 1e6; })}>Use {f(node.cpDue, 4)} from the calculator below</button> : undefined}>
              <NumIn v={p.cpDue} on={(x) => U((y) => { y.cpDue = x; })} /></Field>
            <Field l="Type of rebate"><Sel v={p.rebateType} opts={['None', ...lists.lists.rebate]} on={(x) => U((y) => { y.rebateType = x; })} /></Field>
            <Field l="Share covered by the rebate (%)"><PctIn v={p.rebateShare} on={(x) => U((y) => { y.rebateShare = x; })} /></Field>
            <Field l={`Rebate per ${gt?.unit ?? 't'} produced`}><NumIn v={p.rebate} on={(x) => U((y) => { y.rebate = x; })} /></Field>
            <div className="muted small" style={{ alignSelf: 'end' }}>Effective carbon price: <b>{f(res?.effectiveCp, 4)}</b> {p.currency}/{gt?.unit ?? 't'}</div>
          </div>
        </details>
      </div>;
    })}
    {d.products.length < lists.limits.products && <div className="row" style={{ gap: 6 }}>{d.processes.map((p) => <button key={p.id} className="btn sm" onClick={() => edit((n) => { n.products.push(blank(p.id)); })}>+ Product from {p.name || 'unnamed'}</button>)}{!d.processes.length && <span className="muted small">Add the production processes under step 2 first.</span>}</div>}

    <details className="cmdet" open={anyCarbon}>
      <summary><b>Carbon price calculator</b> <span className="muted small">— sheet F of the template: per process, the share of its own emissions covered, the price and rebate per tCO₂e</span></summary>
      <div className="vform" style={{ marginTop: 8 }}><Field l="Currency"><Sel v={d.carbonCurrency} opts={lists.currencies.map(([c, n]) => [c, `${c} — ${n}`])} on={(x) => edit((n) => { n.carbonCurrency = x; })} /></Field></div>
      <div className="scroll"><table className="t"><thead><tr><th>Process</th><th className="num">SE (own, tCO₂e/t)</th><th>Share covered %</th><th>Price per tCO₂e</th><th>Rebate per tCO₂e</th><th className="num">CP due per t</th><th className="num">Rebate per t</th></tr></thead>
        <tbody>{d.processes.map((p, k) => { const n = R.nodes.find((x) => x.id === p.id); const se = n && n.total > 0 ? (n.attrDirect + n.attrIndirect) / n.total : null;
          return <tr key={p.id}><td>{p.name || 'unnamed'}</td><td className="num">{f(se, 4)}</td>
            <td><PctIn v={p.carbon.share} on={(x) => edit((m) => { m.processes[k]!.carbon.share = x; })} /></td>
            <td><NumIn v={p.carbon.price} on={(x) => edit((m) => { m.processes[k]!.carbon.price = x; })} w={110} /></td>
            <td><NumIn v={p.carbon.rebate} on={(x) => edit((m) => { m.processes[k]!.carbon.rebate = x; })} w={110} /></td>
            <td className="num">{f(n?.cpDue, 4)}</td><td className="num">{f(n?.rebate, 4)}</td></tr>; })}</tbody></table></div>
      <div className="muted small">Per tonne results include the carbon price paid on precursors made in the installation, as the template's tool does.</div>
    </details>
  </>;
}

// ------------------------------------------------------------- 8 review --
function StepReview({ d, R, v, go, setStatus, dl, copyNext, sentTo }: SP & { v: CommView; go: (s: Step) => void; setStatus: (s: string) => Promise<void>; dl: () => Promise<void>; copyNext: () => Promise<void>; sentTo: (s: string) => void }) {
  const errors = R.checks.filter((c) => c.level === 'error'), warns = R.checks.filter((c) => c.level === 'warn');
  const [to, setTo] = useState(v.comm.sentTo);
  const stepName = (s: Step) => STEPS.find(([k]) => k === s)?.[1] ?? s;
  return <>
    <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Direct emissions</span><b>{f(R.ghg.direct, 2)}</b><span className="muted small">tCO₂e, installation</span></div>
      <div className="card kpi"><span className="muted small">Indirect emissions</span><b>{f(R.ghg.indirect, 2)}</b><span className="muted small">tCO₂e, installation</span></div>
      <div className="card kpi"><span className="muted small">Goods for importers</span><b>{d.products.length}</b><span className="muted small">{new Set(d.products.map((p) => p.cn)).size} CN codes</span></div>
      <div className="card kpi"><span className="muted small">Checks</span><b className={errors.length ? 'bad' : ''}>{errors.length ? `${errors.length} to fix` : 'Complete'}</b><span className="muted small">{warns.length} note{warns.length === 1 ? '' : 's'}</span></div>
    </div>
    {R.checks.length > 0 && <div className={`note small ${errors.length ? 'warn' : 'info'}`}>
      <ul className="steps">{[...errors, ...warns].slice(0, 30).map((c, i) => <li key={i}><span className={`chip ${c.level === 'error' ? 'bad' : 'warn'}`}>{c.level === 'error' ? 'Fix' : 'Note'}</span> {c.msg} — <a href="#" onClick={(e) => { e.preventDefault(); go(c.step); }}>{stepName(c.step)}</a></li>)}</ul></div>}

    <h4 className="cmh">What your importers receive (Summary_Products)</h4>
    <div className="scroll"><table className="t">
      <thead><tr><th>CN code</th><th>Product</th><th>Process</th><th className="num">SEE direct</th><th className="num">SEE indirect</th><th className="num">SEE total</th><th>Unit</th><th className="num">Default values</th><th className="num">Electricity MWh/t</th><th className="num">Effective carbon price</th></tr></thead>
      <tbody>{R.products.map((p) => { const x = d.products[p.i]!; return <tr key={p.i}>
        <td className="mono">{x.cn || '—'}</td><td><b>{x.name || '—'}</b><div className="muted small cmclip" title={p.cnName}>{p.cnName}</div></td><td>{p.processName}</td>
        <td className="num">{f(p.seeDirect, 4)}</td><td className="num">{f(p.seeIndirect, 4)}</td><td className="num"><b>{f(p.seeTotal, 4)}</b></td><td>{p.unit}</td>
        <td className="num">{pct(p.defaultShare)}</td><td className="num">{f(p.embeddedElec, 4)}</td><td className="num">{p.effectiveCp ? `${f(p.effectiveCp, 2)} ${x.currency}` : '—'}</td></tr>; })}
        {!R.products.length && <tr><td colSpan={10} className="muted small">No product yet — add them in step 7.</td></tr>}</tbody></table></div>

    <h4 className="cmh">Production processes and precursors (Summary_Processes)</h4>
    <div className="scroll"><table className="t">
      <thead><tr><th>Process / precursor</th><th className="num">Amount</th><th className="num">Attributed direct</th><th className="num">Attributed indirect</th><th className="num">SEE direct</th><th className="num">SEE indirect</th><th>Precursors in the SEE</th></tr></thead>
      <tbody>{R.nodes.map((n) => <tr key={n.id}><td><b>{n.name || 'unnamed'}</b><div className="muted small">{n.kind === 'process' ? 'production process' : 'purchased precursor'} · {n.category}</div></td>
        <td className="num">{f(n.total, 3)} {n.unit}</td><td className="num">{n.kind === 'process' ? f(n.attrDirect, 4) : '—'}</td><td className="num">{n.kind === 'process' ? f(n.attrIndirect, 4) : '—'}</td>
        <td className="num">{f(n.seeDirect, 4)}</td><td className="num">{f(n.seeIndirect, 4)}</td>
        <td className="small">{n.chain.map((c) => <div key={c.id}>{c.name}: {f(c.perUnit, 4)} t/t → {f(c.seeDirect, 4)} direct{c.isDefault && <span className="chip warn" style={{ marginLeft: 4 }}>default</span>}</div>)}{!n.chain.length && <span className="muted">—</span>}</td></tr>)}</tbody></table></div>

    <section className="card cmdl">
      <div className="grow"><b>Official Excel, filled in</b><div className="muted small">{v.comm.template}. All sheets, formulas, drop-downs and protection are kept; Excel recalculates when it opens. Send it to your importers — they copy the values from Summary_Communication into their CBAM report.</div></div>
      <button className="btn p" onClick={() => void dl()}><Icon name="download" size={16} /> Download Excel</button>
    </section>
    <div className="vform">
      <Field l="Sent to (importers, EORI numbers, dates)" span><textarea className="input" rows={2} value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => { if (to !== v.comm.sentTo) sentTo(to); }} /></Field>
    </div>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {v.comm.status === 'draft' && <button className="btn" disabled={errors.length > 0} title={errors.length ? 'Fix the problems first' : ''} onClick={() => void setStatus('final')}><Icon name="check" size={15} /> Mark final</button>}
      {v.comm.status === 'final' && <button className="btn" onClick={() => void setStatus('sent')}>Mark as sent to importers</button>}
      {v.comm.status !== 'draft' && <button className="btn ghost" onClick={() => void setStatus('draft')}>Back to draft</button>}
      <span className="grow" />
      <button className="btn" onClick={() => void copyNext()}><Icon name="paste" size={15} /> Copy to the next period</button>
    </div>
  </>;
}
