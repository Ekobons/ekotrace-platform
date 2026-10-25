/**
 * CBAM Exporter package: the pages a CBAM-only company sees instead of the full tool.
 *   CbamHome       the year at a glance: which quarters are done per installation, the goods' embedded emissions
 *   CbamReporting  the year's reporting: goods by quarter, installation emissions, communications, annual Excel
 * The communication itself, installations, the annual report and reference values reuse the CBAM page (Cbam `only`).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, download } from '../lib/api';
import type { CbamSummary } from '../lib/cbamComm';
import { Icon } from '../components/Icon';

const f = (x: number | null | undefined, d = 3) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: d }));
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`);
const Q = [1, 2, 3, 4];
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'grey'], final: ['Final', ''], sent: ['Sent', 'info'] };
const quarter = (y: number, q: number) => ({ start: `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, end: new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10) });
const thisYear = new Date().getFullYear();
const nowQ = Math.floor(new Date().getMonth() / 3) + 1;

function useSummary(year: number) {
  const { toast } = useApp();
  const [s, setS] = useState<CbamSummary | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setS(null); api.cbamSummary(year).then(setS).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [s, () => setTick((t) => t + 1)] as const;
}
const YearPick = ({ year, set }: { year: number; set: (y: number) => void }) => <label className="field" style={{ minWidth: 110 }}><span>Year</span>
  <select className="input" value={year} onChange={(e) => set(Number(e.target.value))}>{[thisYear - 2, thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y}>{y}</option>)}</select></label>;

// ------------------------------------------------------------------ home --
export function CbamHome() {
  const { toast, tenant } = useApp();
  const nav = useNavigate();
  const [year, setYear] = useState(thisYear);
  const [s] = useSummary(year);
  const file = useRef<HTMLInputElement>(null);
  if (!s) return <div className="page"><div className="card empty">Loading…</div></div>;
  const open = (id: string) => nav(`/cbam/comms?comm=${id}`);
  const start = async (q: number, inst?: CbamSummary['installations'][number]) => {
    try {
      // copy the installation's latest quarter before this one, so the set-up carries over
      const prev = inst ? Q.filter((x) => x < q && inst.cells[x]).map((x) => inst.cells[x]!.id).pop() : undefined;
      const r = await api.cbamCommCreate(prev ? { copyFrom: prev, period: quarter(year, q) } : { period: quarter(year, q) });
      open(r.id);
    } catch (e) { toast((e as Error).message); }
  };
  const sent = s.comms.filter((c) => c.status === 'sent').length;
  const toFix = s.comms.filter((c) => c.status === 'draft').length;
  const fresh = !s.registered && !s.comms.length && !s.latest;
  return <div className="page">
    <div className="row tahead" style={{ flexWrap: 'wrap' }}>
      <div className="grow"><span className="lbl">CBAM Exporter</span><h1>{tenant?.name ?? 'CBAM'}</h1>
        <div className="muted">Embedded emissions of the goods you sell to the EU, quarter by quarter, in the format your importers need.</div></div>
      <YearPick year={year} set={setYear} />
    </div>

    {fresh && <section className="card cmstart">
      <span className="lbl">Get started</span><h3 style={{ margin: '4px 0 10px' }}>Three steps to your first communication</h3>
      <ol className="cmsteps">
        <li><b>Add your installation</b><span className="muted small">The plant as registered in the CBAM Registry, with its production processes.</span><Link className="btn sm" to="/cbam/installations">Installations →</Link></li>
        <li><b>Fill in the quarter</b><span className="muted small">Fuels, production, precursors and the goods you sell — the embedded emissions are worked out as you type.</span><button className="btn sm p" onClick={() => void start(nowQ)}>Start Q{nowQ} {year}</button></li>
        <li><b>Send it to your importers</b><span className="muted small">Download the Commission's Excel template, filled in, and mark it sent.</span><button className="btn sm" onClick={() => file.current?.click()}><Icon name="upload" size={14} /> Or import last quarter's file</button></li>
      </ol>
    </section>}

    {!fresh && <div className="kgrid4">
      <div className="card kpi"><span className="muted small">Installations</span><b>{s.registered || s.installations.length}</b><span className="muted small">{s.installations.length} reported in {year}</span></div>
      <div className="card kpi"><span className="muted small">Communications {year}</span><b>{s.comms.length}</b><span className="muted small">{sent} sent · {s.comms.length - sent - toFix} final · {toFix} draft</span></div>
      <div className="card kpi"><span className="muted small">Goods reported</span><b>{new Set(s.goods.map((g) => g.cn)).size}</b><span className="muted small">CN codes in {year}</span></div>
      <div className="card kpi"><span className="muted small">Latest</span><b style={{ fontSize: 20 }}>{s.latest?.period || '—'}</b><span className="muted small">{s.latest ? <a href="#" onClick={(e) => { e.preventDefault(); open(s.latest!.id); }}>{STATUS[s.latest.status]?.[0]} · open</a> : 'no communication yet'}</span></div>
    </div>}

    {!fresh && <section className="card">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><div className="grow"><span className="lbl">Quarter tracker</span><h3 style={{ margin: '2px 0 0' }}>{year} — communications per installation</h3></div>
        {s.can.edit && <button className="btn sm" onClick={() => file.current?.click()}><Icon name="upload" size={14} /> Import a filled template</button>}
        <button className="btn sm" onClick={() => void download(`/api/cbam/comms/summary/export?year=${year}`, `CBAM_summary_${year}.xlsx`).catch((e) => toast((e as Error).message))}><Icon name="download" size={14} /> Annual summary</button></div>
      <div className="scroll" style={{ marginTop: 10 }}><table className="t cmtrack">
        <thead><tr><th>Installation</th>{Q.map((q) => <th key={q} className="ctr">Q{q}{year === thisYear && q === nowQ ? ' · now' : ''}</th>)}</tr></thead>
        <tbody>{s.installations.map((i) => <tr key={i.name}><td><b>{i.name}</b></td>{Q.map((q) => {
          const c = i.cells[q];
          return <td key={q} className="ctr">{c
            ? <button className="cmcell" onClick={() => open(c.id)}><span className={`chip ${STATUS[c.status]?.[1]}`}>{STATUS[c.status]?.[0]}</span>{c.errors > 0 && <small className="bad">{c.errors} to fix</small>}</button>
            : s.can.edit && (year < thisYear || q <= nowQ) ? <button className="btn sm ghost" onClick={() => void start(q, i)}>+ Start</button> : <span className="muted">—</span>}</td>;
        })}</tr>)}
          {!s.installations.length && <tr><td colSpan={5} className="muted small">No communication in {year} yet. {s.can.edit && <button className="btn sm p" onClick={() => void start(year === thisYear ? nowQ : 1)}>Start Q{year === thisYear ? nowQ : 1}</button>}</td></tr>}</tbody></table></div>
    </section>}

    {s.goods.length > 0 && <section className="card">
      <span className="lbl">Your goods</span><h3 style={{ margin: '2px 0 10px' }}>Specific embedded emissions (SEE total) by quarter</h3>
      <div className="scroll"><table className="t">
        <thead><tr><th>CN code</th><th>Product</th>{Q.map((q) => <th key={q} className="num">Q{q}</th>)}<th>Unit</th><th className="num">Default values (latest)</th></tr></thead>
        <tbody>{s.goods.map((g, k) => {
          const vals = Q.map((q) => g.q[q]?.seeTotal ?? null);
          const last = [...Q].reverse().find((q) => g.q[q]);
          return <tr key={k}><td className="mono">{g.cn}</td><td><b>{g.name || '—'}</b><div className="muted small cmclip" title={g.cnName}>{g.installation} · {g.cnName}</div></td>
            {vals.map((v, i) => { const p = i > 0 ? vals[i - 1] : null; const up = v != null && p != null && v > p * 1.02, dn = v != null && p != null && v < p * 0.98;
              return <td key={i} className="num">{f(v)}{up && <span className="bad small"> ▲</span>}{dn && <span className="ok small"> ▼</span>}</td>; })}
            <td className="muted">{g.unit}</td><td className="num">{pct(last ? g.q[last]?.defaultShare : null)}</td></tr>;
        })}</tbody></table></div>
      <div className="muted small" style={{ marginTop: 6 }}>▲ / ▼ more than 2% up or down on the quarter before. A high share from default values usually means a precursor supplier has not sent its own data.</div>
    </section>}

    <div className="cbamgrid">
      <Link className="card cmlink" to="/cbam/comms"><Icon name="doc" /><span><b>Communications to importers</b><small className="muted">Fill in a quarter, download the Commission's Excel</small></span></Link>
      <Link className="card cmlink" to="/cbam/reporting"><Icon name="chart" /><span><b>Reports</b><small className="muted">The year by quarter, annual summary in Excel</small></span></Link>
    </div>
    <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void api.cbamCommImport(x).then((r) => open(r.id)).catch((er) => toast((er as Error).message)); }} />
  </div>;
}

// ------------------------------------------------------------------ reporting --
export function CbamReporting() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [year, setYear] = useState(thisYear);
  const [s] = useSummary(year);
  const [view, setView] = useState<'total' | 'split'>('total');
  if (!s) return <div className="page"><div className="card empty">Loading…</div></div>;
  const dl = (path: string, name: string) => void download(path, name).catch((e) => toast((e as Error).message));
  return <div className="page">
    <div className="row tahead" style={{ flexWrap: 'wrap' }}>
      <div className="grow"><span className="lbl">CBAM</span><h1>Reports</h1><div className="muted">The year by quarter, from your communications to importers. Each quarter's full file is the Commission's template.</div></div>
      <YearPick year={year} set={setYear} />
      <button className="btn p" style={{ alignSelf: 'end' }} onClick={() => dl(`/api/cbam/comms/summary/export?year=${year}`, `CBAM_summary_${year}.xlsx`)}><Icon name="download" size={16} /> Annual summary (Excel)</button>
    </div>
    {!s.comms.length && <div className="card empty">No communication with a reporting period in {year}. <Link to="/cbam/comms">Start one →</Link></div>}

    {s.goods.length > 0 && <section className="card">
      <div className="row" style={{ gap: 10 }}><div className="grow"><span className="lbl">Goods</span><h3 style={{ margin: '2px 0 0' }}>Specific embedded emissions by quarter</h3></div>
        <div className="seg sm"><button className={view === 'total' ? 'on' : ''} onClick={() => setView('total')}>Total</button><button className={view === 'split' ? 'on' : ''} onClick={() => setView('split')}>Direct / indirect</button></div></div>
      <div className="scroll" style={{ marginTop: 10 }}><table className="t">
        <thead><tr><th>CN code</th><th>Product</th><th>Installation</th>{Q.map((q) => <th key={q} className="num">Q{q}</th>)}<th>Unit</th></tr></thead>
        <tbody>{s.goods.map((g, k) => <tr key={k}><td className="mono">{g.cn}</td><td><b>{g.name || '—'}</b><div className="muted small cmclip" title={g.cnName}>{g.cnName}</div></td><td>{g.installation}</td>
          {Q.map((q) => { const v = g.q[q]; return <td key={q} className="num">{!v ? '—' : view === 'total' ? <b>{f(v.seeTotal, 4)}</b> : <>{f(v.seeDirect, 4)}<div className="muted small">+ {f(v.seeIndirect, 4)}</div></>}</td>; })}
          <td className="muted">{g.unit}</td></tr>)}</tbody></table></div>
    </section>}

    {s.installations.length > 0 && <section className="card">
      <span className="lbl">Installations</span><h3 style={{ margin: '2px 0 10px' }}>Emissions by quarter (tCO₂e)</h3>
      <div className="scroll"><table className="t">
        <thead><tr><th>Installation</th>{Q.map((q) => <th key={q} className="num">Q{q} direct</th>)}<th className="num">Year direct</th><th className="num">Year indirect</th></tr></thead>
        <tbody>{s.installations.map((i) => { const d = Q.map((q) => i.emissions[q]?.direct ?? null); const ind = Q.map((q) => i.emissions[q]?.indirect ?? null);
          return <tr key={i.name}><td><b>{i.name}</b></td>{d.map((v, k) => <td key={k} className="num">{f(v, 2)}</td>)}
            <td className="num"><b>{f(d.reduce<number>((a, b) => a + (b ?? 0), 0), 2)}</b></td><td className="num">{f(ind.reduce<number>((a, b) => a + (b ?? 0), 0), 2)}</td></tr>; })}</tbody></table></div>
    </section>}

    {s.comms.length > 0 && <section className="card">
      <span className="lbl">Communications</span><h3 style={{ margin: '2px 0 10px' }}>Sent and in progress</h3>
      <div className="scroll"><table className="t">
        <thead><tr><th>Quarter</th><th>Installation</th><th>Communication</th><th>Status</th><th>Sent to</th><th /></tr></thead>
        <tbody>{s.comms.map((c) => <tr key={c.id} className="click" onClick={() => nav(`/cbam/comms?comm=${c.id}`)}><td>Q{c.quarter}</td><td>{c.installation}</td><td><b>{c.title}</b></td>
          <td><span className={`chip ${STATUS[c.status]?.[1]}`}>{STATUS[c.status]?.[0]}</span>{c.errors > 0 && <div><span className="chip bad">{c.errors} to fix</span></div>}</td>
          <td className="small">{c.sentTo || <span className="muted">—</span>}</td>
          <td className="num" onClick={(e) => e.stopPropagation()}><button className="btn sm ghost" title="Download the template" onClick={() => dl(`/api/cbam/comms/${c.id}/export`, `CBAM_Communication_${c.period.replace(/\s+/g, '_')}.xlsx`)}><Icon name="download" size={15} /></button></td></tr>)}</tbody></table></div>
    </section>}
    <div className="muted small">The installation's yearly report for the CBAM Registry (verified, from 2026) is under <Link to="/cbam/annual">Annual emissions report</Link>.</div>
  </div>;
}
