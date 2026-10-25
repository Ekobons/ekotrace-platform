/**
 * The dedicated CBAM tool (importers and exporters):
 *   CbamHomeByRole     importer dashboard, exporter tracker, or both
 *   ImporterHome       imports by CN code, category, country and supplier; 50 t threshold; certificates to hold; alerts
 *   CbamSuppliers      suppliers (import) or precursor suppliers (exporter), data requests, answers with credibility checks
 *   CbamForecast       certificates and cost to 2034 with assumptions and supplier-switch scenarios
 *   CbamLibrary        CN codes covered, with category, routes and rules, and the key rules with official links
 *   CbamSettings       role, EORI
 *   CbamAnswer         answer an EU customer's request from this account with a communication
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, downloadPost } from '../lib/api';
import type { CbamAgg, CbamCnRow, CbamRequestRow, CbamRequestView, CbamRole, CbamSupplierRow, CommListItem, CommLists, ForecastAssumptions, ForecastGroup, ForecastResult, ImporterOverview } from '../lib/cbamComm';
import { Icon } from '../components/Icon';
import { BarList, countryName } from '../components/Charts';
import { CountrySelect } from '../components/CountrySelect';
import { CbamHome } from './CbamPackage';

const f = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: d }));
const f0 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('en-GB'));
const eur = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `EUR ${Math.round(x).toLocaleString('en-GB')}`);
const pct = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toLocaleString('en-GB', { maximumFractionDigits: d })}%`);
const d8 = (x: string | null | undefined) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const thisYear = new Date().getFullYear();
const YEARS = [2026, 2027, 2028, 2029];
const REQ_STATUS: Record<string, [string, string]> = { open: ['Waiting', 'grey'], answered: ['To review', 'warn'], accepted: ['Accepted', ''], rejected: ['Sent back', 'bad'], withdrawn: ['Withdrawn', 'grey'] };
const CHECK: Record<string, [string, string]> = { ok: ['plausible', ''], low: ['unusually low', 'bad'], high: ['unusually high', 'bad'], nodefault: ['no default to compare', 'grey'], missing: ['no value', 'grey'] };

function Head({ eyebrow, title, sub, right }: { eyebrow: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return <div className="row tahead" style={{ flexWrap: 'wrap', gap: 12 }}>
    <div className="grow"><span className="lbl">{eyebrow}</span><h1>{title}</h1>{sub && <div className="muted">{sub}</div>}</div>{right}</div>;
}
const YearSel = ({ year, set, years = YEARS }: { year: number; set: (y: number) => void; years?: number[] }) => <label className="field" style={{ minWidth: 110 }}><span>Year</span>
  <select className="input" value={year} onChange={(e) => set(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>;
function Drawer({ title, eyebrow, onClose, children, wide }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  return <dialog ref={dlg} className={`drawer${wide ? ' wide' : ''}`} onClose={onClose}><div className="in">
    <div className="row"><div className="grow"><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
    {children}
  </div></dialog>;
}

// ------------------------------------------------------------------ role --
export function useCbamRole(enabled = true): CbamRole | null {
  const { tenant } = useApp();
  const [role, setRole] = useState<CbamRole | null>(null);
  useEffect(() => { if (!tenant || !enabled) return; api.cbamSettings().then((s) => setRole(s.role)).catch(() => setRole('both')); const h = () => api.cbamSettings().then((s) => setRole(s.role)).catch(() => {}); window.addEventListener('cbam-role', h); return () => window.removeEventListener('cbam-role', h); }, [tenant?.id, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return role;
}
export function CbamHomeByRole() {
  const role = useCbamRole();
  if (!role) return <div className="page"><div className="card empty">Loading…</div></div>;
  if (role === 'exporter') return <CbamHome />;
  return <>
    <ImporterHome />
    {role === 'both' && <CbamHome embedded />}
  </>;
}

// ------------------------------------------------------------------ importer home --
type Dim = 'byCn' | 'byCategory' | 'byOrigin' | 'bySupplier';
type Metric = 'cost' | 'embedded' | 'mass';
export function ImporterHome() {
  const { toast, tenant } = useApp();
  const nav = useNavigate();
  const [year, setYear] = useState(Math.max(2026, thisYear));
  const [d, setD] = useState<ImporterOverview | null>(null);
  const [dim, setDim] = useState<Dim>('byCn');
  const [metric, setMetric] = useState<Metric>('cost');
  useEffect(() => { setD(null); api.cbamImporter(year).then(setD).catch((e) => toast((e as Error).message)); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const T = d.totals, th = d.threshold;
  const rows = (d[dim] as CbamAgg[]).map((a) => ({ key: a.key, label: dim === 'byOrigin' ? `${countryName(a.label)} (${a.label})` : dim === 'byCn' ? <span><span className="mono">{a.label}</span> <span className="muted small">{a.sub}</span></span> : a.label,
    value: metric === 'cost' ? a.cost : metric === 'embedded' ? a.embedded : a.mass,
    sub: `${f(a.mass, 1)} t · ${a.mass ? pct(a.defaultMass / a.mass) : '—'} on default values${a.sub && dim === 'bySupplier' ? ` · ${a.sub}` : ''}${a.problems ? ` · ${a.problems} with problems` : ''}`,
    onClick: dim === 'bySupplier' ? () => nav('/cbam/suppliers') : undefined }));
  const fmt = metric === 'cost' ? (v: number) => f0(v) : (v: number) => f(v, 1);
  const unit = metric === 'cost' ? 'EUR' : metric === 'embedded' ? 'tCO₂e' : 't';
  return <div className="page">
    <Head eyebrow="CBAM · importer" title={tenant?.name ?? 'Imports'} sub="Goods you import into the EU: embedded emissions, certificates and cost, from your customs lines and your suppliers' data."
      right={<YearSel year={year} set={setYear} />} />
    {!T.lines ? <section className="card cmstart">
      <span className="lbl">Get started</span><h3 style={{ margin: '4px 0 10px' }}>Three steps to your first estimate</h3>
      <ol className="cmsteps">
        <li><b>Load your imports</b><span className="muted small">The customs broker's file (CN code, country, tonnes, supplier) — any layout.</span><Link className="btn sm p" to="/cbam/imports">Imports →</Link></li>
        <li><b>Ask suppliers for data</b><span className="muted small">Each non-EU supplier gets a link and code to send actual emissions — or upload the EU template.</span><Link className="btn sm" to="/cbam/suppliers">Suppliers →</Link></li>
        <li><b>See the cost to 2034</b><span className="muted small">Certificates with the free allocation phasing out, default vs actual values, cleaner suppliers.</span><Link className="btn sm" to="/cbam/forecast">Forecast →</Link></li>
      </ol>
    </section> : <>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">CBAM goods imported</span><b>{f(T.mass, 1)} <small className="muted">t</small></b><span className="muted small">{T.lines} customs lines</span></div>
        <div className="card kpi"><span className="muted small">Embedded emissions</span><b>{f0(T.embedded)} <small className="muted">tCO₂e</small></b><span className="muted small">{T.mass ? pct(T.defaultMass / T.mass) : '—'} of tonnes on default values</span></div>
        <div className="card kpi"><span className="muted small">Certificates (estimate)</span><b>{f0(T.certificates)}</b><span className="muted small">after free allocation adjustment {f0(T.faa)}</span></div>
        <div className="card kpi"><span className="muted small">Estimated cost</span><b>{eur(T.cost)}</b><span className="muted small">{T.markupCost > 0 ? `${eur(T.markupCost)} from default-value mark-ups` : 'at the quarters\' certificate prices'}</span></div>
      </div>
      {d.alerts.length > 0 && <section className="card" style={{ display: 'grid', gap: 6 }}>
        {d.alerts.map((a, i) => <div key={i} className={`note small ${a.level === 'bad' ? 'bad' : a.level === 'warn' ? 'warn' : 'info'}`}>{a.msg}{a.link && <> · <Link to={a.link}>Open</Link></>}</div>)}
      </section>}
      <div className="cbamgrid">
        <section className="card" style={{ display: 'grid', gap: 8 }}>
          <span className="lbl">De minimis threshold</span>
          <h3 style={{ margin: 0 }}>{f(th.mass, 1)} t of {th.limit} t in {year}</h3>
          <div className={`cmmeter ${th.status}`} role="img" aria-label={`${Math.round(th.share * 100)}% of the threshold`}><span style={{ width: `${Math.min(100, th.share * 100)}%` }} /><i style={{ left: '90%' }} title="90% — apply for authorised declarant status" /></div>
          <div className="row small muted" style={{ gap: 12, flexWrap: 'wrap' }}>{th.byQuarter.map((m, i) => <span key={i}>to Q{i + 1}: <b>{f(m, 1)} t</b></span>)}</div>
          <div className={`note small ${th.status === 'over' ? 'bad' : th.status === 'near' ? 'warn' : 'ok'}`}>{th.message}</div>
          <div className="muted small">Counts every CBAM good except electricity and hydrogen, which are covered whatever the quantity{th.alwaysCovered ? ` (${th.alwaysCovered} such line${th.alwaysCovered === 1 ? '' : 's'})` : ''}.</div>
        </section>
        <section className="card" style={{ display: 'grid', gap: 8 }}>
          <span className="lbl">Certificates</span>
          <h3 style={{ margin: 0 }}>To hold at the end of each quarter</h3>
          <table className="t"><thead><tr><th>Quarter</th><th className="num">Due so far</th><th className="num">To hold ({pct(d.holdingShare)})</th><th className="num">Price</th><th className="num">Value</th></tr></thead>
            <tbody>{d.holding.map((h) => <tr key={h.quarter}><td>Q{h.quarter}</td><td className="num">{f0(h.certificatesSoFar)}</td><td className="num"><b>{f0(h.toHold)}</b></td><td className="num">{h.price == null ? '—' : f(h.price)}</td><td className="num">{eur(h.value)}</td></tr>)}</tbody></table>
          <div className="muted small">Certificates for {year} imports are sold from {d8(d.deadlines.salesStart > `${year + 1}` ? d.deadlines.salesStart : `${year + 1}-02-01`)}; the declaration and surrender are due by <b>{d8(d.deadlines.declarationDue)}</b>.</div>
        </section>
      </div>
      <section className="card">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="grow"><span className="lbl">Where it comes from</span><h3 style={{ margin: '2px 0 0' }}>{metric === 'cost' ? 'Estimated cost' : metric === 'embedded' ? 'Embedded emissions' : 'Tonnes'} by {dim === 'byCn' ? 'CN code' : dim === 'byCategory' ? 'product category' : dim === 'byOrigin' ? 'country of origin' : 'supplier'}</h3></div>
          <div className="seg sm">{([['byCn', 'CN code'], ['byCategory', 'Product'], ['byOrigin', 'Country'], ['bySupplier', 'Supplier']] as [Dim, string][]).map(([k, l]) => <button key={k} className={dim === k ? 'on' : ''} onClick={() => setDim(k)}>{l}</button>)}</div>
          <div className="seg sm">{([['cost', 'Cost'], ['embedded', 'tCO₂e'], ['mass', 'Tonnes']] as [Metric, string][]).map(([k, l]) => <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{l}</button>)}</div>
        </div>
        <div style={{ marginTop: 10 }}><BarList rows={rows} format={fmt} unit={unit} max={12} empty="No imports in this year." /></div>
      </section>
      <section className="card">
        <span className="lbl">By quarter</span>
        <table className="t" style={{ marginTop: 6 }}><thead><tr><th>Quarter</th><th className="num">Tonnes</th><th className="num">Embedded tCO₂e</th><th className="num">Estimated cost</th></tr></thead>
          <tbody>{d.byQuarter.map((q) => <tr key={q.quarter}><td>Q{q.quarter} {year}</td><td className="num">{f(q.mass, 1)}</td><td className="num">{f0(q.embedded)}</td><td className="num">{eur(q.cost)}</td></tr>)}</tbody></table>
      </section>
    </>}
    <div className="cbamgrid">
      <Link className="card cmlink" to="/cbam/imports"><Icon name="upload" /><span><b>Imports & declaration</b><small className="muted">Customs lines, the broker's file, the declaration workbook</small></span></Link>
      <Link className="card cmlink" to="/cbam/suppliers"><Icon name="users" /><span><b>Suppliers & data requests</b><small className="muted">{d.requests.open} waiting · {d.requests.answered} to review{d.requests.overdue ? ` · ${d.requests.overdue} overdue` : ''}</small></span></Link>
      <Link className="card cmlink" to="/cbam/forecast"><Icon name="chart" /><span><b>Cost forecast to 2034</b><small className="muted">Price path, volumes, free allocation phase-out, supplier scenarios</small></span></Link>
      <Link className="card cmlink" to="/cbam/library"><Icon name="book" /><span><b>CN codes & rules</b><small className="muted">What is covered, how it is counted, official texts</small></span></Link>
    </div>
  </div>;
}

// ------------------------------------------------------------------ suppliers & requests --
export function CbamSuppliers({ kind = 'import' }: { kind?: 'import' | 'precursor' }) {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'requests' ? 'requests' : 'suppliers';
  const [year, setYear] = useState(Math.max(2026, thisYear));
  const [d, setD] = useState<{ suppliers: CbamSupplierRow[]; loose: { name: string; country: string; mass: number; lines: number }[]; can: { edit: boolean } } | null>(null);
  const [reqs, setReqs] = useState<CbamRequestRow[] | null>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<CbamSupplierRow | 'new' | { name: string; country: string } | null>(null);
  const [ask, setAsk] = useState<CbamSupplierRow | null>(null);
  const reqId = sp.get('request');
  const set = (x: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(x)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
  useEffect(() => { api.cbamSuppliers(year).then(setD).catch((e) => toast((e as Error).message)); api.cbamRequests({ purpose: kind }).then((r) => setReqs(r.requests)).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const run = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  if (!d || !reqs) return <div className="page"><div className="card empty">Loading…</div></div>;
  const list = d.suppliers.filter((s) => s.kind === kind);
  const toReview = reqs.filter((r) => r.to_review > 0).length;
  return <div className="page">
    <Head eyebrow={kind === 'import' ? 'CBAM · importer' : 'CBAM · exporter'} title={kind === 'import' ? 'Suppliers & data requests' : 'Precursor suppliers'}
      sub={kind === 'import' ? 'The installations outside the EU you buy CBAM goods from. Ask each for its actual emissions per quarter: they answer with a link and code — a short form, the EU template, or straight from their own account.'
        : 'Suppliers of the precursors you buy in (e.g. billets, clinker, ammonia). Ask them for their embedded emissions and use the answer in your communication.'}
      right={kind === 'import' ? <YearSel year={year} set={setYear} /> : undefined} />
    <div className="tabs"><button className={tab === 'suppliers' ? 'on' : ''} onClick={() => set({ tab: null })}>Suppliers ({list.length})</button><button className={tab === 'requests' ? 'on' : ''} onClick={() => set({ tab: 'requests' })}>Data requests{toReview ? <span className="segn">{toReview}</span> : ''}</button></div>
    {tab === 'suppliers' && <>
      {d.can.edit && <div className="row"><span className="grow" /><button className="btn p" onClick={() => setEdit('new')}>+ Supplier</button></div>}
      {kind === 'import' && d.loose.length > 0 && <div className="note info small">Suppliers named on import lines but not yet in the list: {d.loose.slice(0, 8).map((l) => <button key={l.name} className="chipbtn" style={{ margin: '2px 4px' }} onClick={() => setEdit({ name: l.name, country: l.country })}>+ {l.name} <span className="meta">{f(l.mass, 1)} t</span></button>)}</div>}
      {!list.length ? <div className="card empty">No supplier yet. {kind === 'import' ? 'Add the installations you import from — import lines with the same supplier name are linked automatically.' : 'Add the companies you buy precursors from.'}</div>
        : <section className="card" style={{ padding: 0 }}><div className="scroll"><table className="t">
          <thead><tr><th>Supplier</th><th>Installation</th><th>Contact</th>{kind === 'import' && <th className="num">{year} tonnes</th>}{kind === 'import' && <th className="num">On default values</th>}<th>Last request</th><th className="num">Values kept</th><th /></tr></thead>
          <tbody>{list.map((s) => <tr key={s.id}>
            <td><b>{s.name}</b><div className="muted small">{s.country ? countryName(s.country) : '—'}</div></td>
            <td className="small">{s.installation ?? '—'}{s.registry_id && <div className="muted mono">{s.registry_id}</div>}</td>
            <td className="small">{s.contact_name ?? ''}<div className="muted">{s.contact_email ?? <span className="bad">no e-mail</span>}</div></td>
            {kind === 'import' && <td className="num">{f(s.mass, 1)}</td>}
            {kind === 'import' && <td className="num">{s.lines ? `${s.default_lines} of ${s.lines} lines` : '—'}</td>}
            <td>{s.last_request ? <a href="#" onClick={(e) => { e.preventDefault(); set({ tab: 'requests', request: s.last_request!.id }); }}><span className={`chip ${REQ_STATUS[s.last_request.status]?.[1]}`}>{REQ_STATUS[s.last_request.status]?.[0]}</span> <span className="small muted">{s.last_request.quarter ? `Q${s.last_request.quarter} ` : ''}{s.last_request.year}</span></a> : <span className="muted small">none</span>}</td>
            <td className="num">{s.values || '—'}</td>
            <td className="num" style={{ whiteSpace: 'nowrap' }}>{d.can.edit && <>
              <button className="btn sm" onClick={() => setAsk(s)}>Request data</button>
              <button className="btn sm ghost" aria-label="Edit" onClick={() => setEdit(s)}><Icon name="edit" size={15} /></button>
              <button className="btn sm ghost" aria-label="Delete" onClick={() => { if (confirm(`Delete ${s.name}? Its requests and kept values go too.`)) void run(() => api.cbamSupplierDelete(s.id), 'Deleted'); }}><Icon name="bin" size={15} /></button></>}</td>
          </tr>)}</tbody></table></div></section>}
    </>}
    {tab === 'requests' && <>
      {!reqs.length ? <div className="card empty">No data request yet. Under Suppliers, choose <b>Request data</b>.</div>
        : <section className="card" style={{ padding: 0 }}><div className="scroll"><table className="t">
          <thead><tr><th>Supplier</th><th>Period</th><th>CN codes</th><th>Status</th><th>Due</th><th>Sent to</th><th className="num">Reminders</th></tr></thead>
          <tbody>{reqs.map((r) => <tr key={r.id} className={`click${r.id === reqId ? ' sel' : ''}`} onClick={() => set({ request: r.id })}>
            <td><b>{r.supplier}</b><div className="muted small">{r.country ? countryName(r.country) : ''}</div></td>
            <td>{r.quarter ? `Q${r.quarter} ` : 'Year '}{r.year}</td>
            <td className="small mono">{r.cn_codes.slice(0, 4).join(', ')}{r.cn_codes.length > 4 ? ` +${r.cn_codes.length - 4}` : ''}{!r.cn_codes.length && <span className="muted">all</span>}</td>
            <td><span className={`chip ${REQ_STATUS[r.status]?.[1]}`}>{REQ_STATUS[r.status]?.[0]}</span>{r.to_review > 0 && <div className="small warn">{r.to_review} answer to review</div>}</td>
            <td className={`small ${r.status === 'open' && r.due_date && r.due_date.slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'bad' : ''}`}>{d8(r.due_date)}</td>
            <td className="small">{r.contact_email}</td><td className="num">{r.reminders || '—'}</td></tr>)}</tbody></table></div></section>}
    </>}
    {edit && <SupplierDrawer kind={kind} s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); toast(m); reload(); }} />}
    {ask && <RequestDrawer s={ask} kind={kind} year={year} onClose={() => setAsk(null)} onSent={(id) => { setAsk(null); reload(); set({ tab: 'requests', request: id }); }} />}
    {reqId && <RequestView id={reqId} kind={kind} onClose={() => set({ request: null })} onChanged={reload} />}
  </div>;
}

function SupplierDrawer({ kind, s, onClose, onSaved }: { kind: 'import' | 'precursor'; s: CbamSupplierRow | { name: string; country: string } | null; onClose: () => void; onSaved: (m: string) => void }) {
  const { toast } = useApp();
  const full = s && 'id' in s ? s : null;
  const [v, setV] = useState({ name: s?.name ?? '', country: (s?.country ?? '') as string, installation: full?.installation ?? '', registryId: full?.registry_id ?? '', contactName: full?.contact_name ?? '', contactEmail: full?.contact_email ?? '', notes: full?.notes ?? '' });
  const up = (x: Partial<typeof v>) => setV((o) => ({ ...o, ...x }));
  const t = (k: keyof typeof v, l: string, ph = '', span = false) => <label className={`field${span ? ' span2' : ''}`}><span>{l}</span><input className="input" value={v[k]} placeholder={ph} onChange={(e) => up({ [k]: e.target.value })} /></label>;
  const save = async () => {
    try {
      const r = await api.cbamSupplierSave({ kind, name: v.name.trim(), country: v.country || null, installation: v.installation.trim() || null, registryId: v.registryId.trim() || null, contactName: v.contactName.trim() || null, contactEmail: v.contactEmail.trim() || null, notes: v.notes.trim() }, full?.id);
      onSaved(full ? 'Saved' : r.linked ? `Supplier added — ${r.linked} import line${r.linked === 1 ? '' : 's'} linked` : 'Supplier added');
    } catch (e) { toast((e as Error).message); }
  };
  return <Drawer eyebrow={kind === 'import' ? 'CBAM · supplier' : 'CBAM · precursor supplier'} title={full ? full.name : 'New supplier'} onClose={onClose}>
    <div className="vform">
      {t('name', 'Name (as on your import lines)', 'e.g. Anatolia Steel', true)}
      <label className="field"><span>Country</span><CountrySelect value={v.country} empty="—" onChange={(c) => up({ country: c })} /></label>
      {t('installation', 'Installation', 'plant name')}
      {t('registryId', 'Installation ID in the CBAM Registry', 'if known', true)}
      {t('contactName', 'Contact person')}{t('contactEmail', 'Contact e-mail', 'gets the data requests')}
      {t('notes', 'Notes', '', true)}
    </div>
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="btn p" disabled={v.name.trim().length < 2} onClick={() => void save()}>Save</button></div>
  </Drawer>;
}

function RequestDrawer({ s, kind, year, onClose, onSent }: { s: CbamSupplierRow; kind: 'import' | 'precursor'; year: number; onClose: () => void; onSent: (id: string) => void }) {
  const { toast } = useApp();
  const q0 = Math.max(1, Math.floor(new Date().getMonth() / 3));
  const [v, setV] = useState({ year, quarter: q0 as number | null, cn: '', due: '', message: '', email: s.contact_email ?? '', send: true });
  const [done, setDone] = useState<{ id: string; code: string; email: string; emailed: boolean } | null>(null);
  const go = async () => {
    try {
      const r = await api.cbamRequestCreate({ supplierId: s.id, purpose: kind, year: v.year, quarter: v.quarter, cnCodes: v.cn.split(/[\s,;]+/).map((x) => x.replace(/\D/g, '')).filter(Boolean), message: v.message, dueDate: v.due || null, contactEmail: v.email.trim() || undefined, sendEmail: v.send });
      setDone(r);
    } catch (e) { toast((e as Error).message); }
  };
  return <Drawer eyebrow={`Data request · ${s.name}`} title={done ? 'Request sent' : 'Ask for emissions data'} onClose={() => (done ? onSent(done.id) : onClose())}>
    {done ? <>
      <div className="note ok">The request {done.emailed ? `was e-mailed to ${done.email}` : 'is ready'}. Give the supplier this access code if the e-mail does not reach them — it is shown only now.</div>
      <div className="cmcode mono">{done.code}</div>
      <div className="muted small">The supplier signs in on <b>{window.location.origin}/cbam-supplier</b> with <b>{done.email}</b> and the code. They can fill a short form, upload the EU communication template, or — if they use this tool too — send their communication from their account.</div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn p" onClick={() => onSent(done.id)}>Open the request</button></div>
    </> : <>
      <div className="vform">
        <label className="field"><span>Year</span><select className="input" value={v.year} onChange={(e) => setV({ ...v, year: Number(e.target.value) })}>{[...YEARS, 2025].sort().map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className="field"><span>Period</span><select className="input" value={v.quarter ?? ''} onChange={(e) => setV({ ...v, quarter: e.target.value ? Number(e.target.value) : null })}><option value="">Whole year</option>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select></label>
        <label className="field span2"><span>CN codes</span><input className="input" value={v.cn} placeholder={kind === 'import' ? 'leave empty: the CN codes of your import lines from this supplier' : 'e.g. 72071114'} onChange={(e) => setV({ ...v, cn: e.target.value })} /></label>
        <label className="field"><span>Answer by</span><input type="date" className="input" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></label>
        <label className="field"><span>Send to</span><input className="input" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
        <label className="field span2"><span>Message (optional)</span><textarea className="input" rows={3} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} placeholder="e.g. Please use your verified values for the installation that produced our order no. …" /></label>
        <label className="row small span2" style={{ gap: 6 }}><input type="checkbox" checked={v.send} onChange={(e) => setV({ ...v, send: e.target.checked })} /> E-mail the request with the access code</label>
      </div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="btn p" disabled={!v.email.includes('@')} onClick={() => void go()}>Send request</button></div>
    </>}
  </Drawer>;
}

function RequestView({ id, kind, onClose, onChanged }: { id: string; kind: 'import' | 'precursor'; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp();
  const [v, setV] = useState<CbamRequestView | null>(null);
  const [tick, setTick] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [apply, setApply] = useState(true);
  const [comms, setComms] = useState<CommListItem[]>([]);
  const [use, setUse] = useState({ comm: '', prec: '' });
  const [lists, setLists] = useState<{ comm: string; precs: { id: string; name: string }[] }>({ comm: '', precs: [] });
  useEffect(() => { api.cbamRequest(id).then(setV).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (kind === 'precursor') api.cbamComms().then((r) => setComms(r.comms)).catch(() => {}); }, [kind]);
  useEffect(() => { if (use.comm && use.comm !== lists.comm) api.cbamComm(use.comm).then((c) => setLists({ comm: use.comm, precs: c.data.precursors.map((p) => ({ id: p.id, name: p.name || 'unnamed' })) })).catch(() => {}); }, [use.comm]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>, m: string) => { try { await fn(); toast(m); setTick((t) => t + 1); onChanged(); } catch (e) { toast((e as Error).message); } };
  if (!v) return null;
  const R = v.request, ed = v.can.edit;
  const live = ['open', 'answered', 'rejected'].includes(R.status);
  return <Drawer wide eyebrow={`Data request · ${R.supplier}`} title={`${R.quarter ? `Q${R.quarter} ` : ''}${R.year}${R.cn_codes.length ? ` · ${R.cn_codes.join(', ')}` : ''}`} onClose={onClose}>
    <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className={`chip ${REQ_STATUS[R.status]?.[1]}`}>{REQ_STATUS[R.status]?.[0]}</span>
      <span className="muted">to {R.contact_email} · sent {d8(R.created_at)} by {R.created_name}{R.due_date ? ` · answer by ${d8(R.due_date)}` : ''}{R.reminders ? ` · ${R.reminders} reminder${R.reminders === 1 ? '' : 's'}` : ''}</span>
    </div>
    {R.message && <div className="note small">{R.message}</div>}
    {ed && live && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      <button className="btn sm" onClick={() => void run(() => api.cbamRequestRemind(id), 'Reminder sent')}>Send a reminder</button>
      <button className="btn sm" onClick={() => void api.cbamRequestCode(id, false).then((r) => setCode(r.code)).catch((e) => toast((e as Error).message))}>New access code</button>
      <button className="btn sm ghost" onClick={() => { if (confirm('Withdraw this request? The supplier can no longer answer it.')) void run(() => api.cbamRequestWithdraw(id), 'Withdrawn'); }}>Withdraw</button>
    </div>}
    {code && <div className="note ok small">New access code (shown once): <b className="mono">{code}</b> — the old one no longer works.</div>}

    <h4 className="cmh">Answers</h4>
    {!v.responses.length && <div className="muted small">No answer yet.</div>}
    {v.responses.map((x) => <div key={x.id} className="cmbox">
      <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`chip ${x.status === 'accepted' ? '' : x.status === 'rejected' ? 'bad' : 'warn'}`}>{x.status === 'submitted' ? 'To review' : x.status === 'accepted' ? 'Accepted' : 'Sent back'}</span>
        <b>{x.via === 'template' ? 'EU template' : x.via === 'form' ? 'Short form' : 'From their account'}</b>
        <span className="muted">{x.from_name}{x.filename ? ` · ${x.filename}` : ''} · {d8(x.submitted_at)}</span>
        {x.data.verified && <span className="chip info">verified</span>}
      </div>
      {x.data.installation?.name && <div className="small">Installation: <b>{x.data.installation.name}</b>{x.data.installation.country ? `, ${countryName(x.data.installation.country)}` : ''}{x.data.installation.registryId ? ` · ${x.data.installation.registryId}` : ''}{x.data.period?.start ? ` · period ${x.data.period.start} to ${x.data.period.end}` : ''}</div>}
      <div className="scroll"><table className="t"><thead><tr><th>CN code</th><th>Product</th><th className="num">SEE direct</th><th className="num">SEE indirect</th><th className="num">Counted</th><th className="num">Default value</th><th>Check</th><th className="num">From defaults</th></tr></thead>
        <tbody>{x.goods.map((g, i) => <tr key={i} className={g.inRequest ? '' : 'muted'}><td className="mono">{g.cn}</td><td>{g.name || '—'}{!g.inRequest && <div className="small">not asked for</div>}</td>
          <td className="num">{f(g.seeDirect, 4)}</td><td className="num">{f(g.seeIndirect, 4)}</td><td className="num"><b>{f(g.relevant, 4)}</b></td><td className="num">{f(g.defaultValue, 4)}</td>
          <td><span className={`chip ${CHECK[g.check.level]?.[1]}`} title={g.check.msg}>{CHECK[g.check.level]?.[0]}</span>{g.check.ratio != null && <div className="small muted">{pct(g.check.ratio)} of default</div>}</td>
          <td className="num">{pct(g.defaultShare)}</td></tr>)}</tbody></table></div>
      {x.review_note && <div className="note small">{x.status === 'rejected' ? 'Sent back' : 'Note'}: {x.review_note} — {x.reviewed_name}, {d8(x.reviewed_at)}</div>}
      {ed && x.status === 'submitted' && <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field grow"><span>Note to the supplier (needed to send back)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {kind === 'import' && <label className="row small" style={{ gap: 6, paddingBottom: 9 }}><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Use on the matching import lines</label>}
        <button className="btn ghost" disabled={!note.trim()} onClick={() => void run(() => api.cbamResponseReview(x.id, { decision: 'reject', note: note.trim() }), 'Sent back to the supplier')}>Send back</button>
        <button className="btn p" onClick={() => void run(async () => { const r = await api.cbamResponseReview(x.id, { decision: 'accept', note: note.trim(), apply }); if (r.lines) toast(`${r.lines} import line${r.lines === 1 ? '' : 's'} now use these values`); }, 'Accepted')}>Accept</button>
      </div>}
      {ed && kind === 'precursor' && x.status === 'accepted' && <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field"><span>Use in communication</span><select className="input" value={use.comm} onChange={(e) => setUse({ comm: e.target.value, prec: '' })}><option value="">Choose…</option>{comms.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="field"><span>Purchased precursor</span><select className="input" value={use.prec} onChange={(e) => setUse({ ...use, prec: e.target.value })}><option value="">Choose…</option>{lists.precs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn" disabled={!use.comm || !use.prec} onClick={() => void run(() => api.cbamResponseToComm(x.id, { commId: use.comm, precursorId: use.prec }), 'Values put into the communication')}>Fill the precursor</button>
      </div>}
    </div>)}

    <h4 className="cmh">Messages</h4>
    <div style={{ display: 'grid', gap: 6 }}>{v.messages.map((m, i) => <div key={i} className={`note small ${m.side === 'supplier' ? 'info' : ''}`}><b>{m.author}</b> · {d8(m.at)}<div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div>)}
      {!v.messages.length && <div className="muted small">No message yet.</div>}</div>
    {ed && R.status !== 'withdrawn' && <div className="row" style={{ gap: 8, alignItems: 'end' }}><label className="field grow"><span>Write to the supplier (e-mailed)</span><textarea className="input" rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
      <button className="btn" disabled={!msg.trim()} onClick={() => void run(async () => { await api.cbamRequestMessage(id, msg.trim()); setMsg(''); }, 'Message sent')}>Send</button></div>}
  </Drawer>;
}

// ------------------------------------------------------------------ forecast --
export function CbamForecast() {
  const { toast } = useApp();
  const [year, setYear] = useState(Math.max(2026, thisYear));
  const [base, setBase] = useState<{ groups: ForecastGroup[]; lastPrice: number | null; can: { edit: boolean } } | null>(null);
  const [a, setA] = useState<ForecastAssumptions | null>(null);
  const [res, setRes] = useState<ForecastResult | null>(null);
  const [cmp, setCmp] = useState<ForecastResult | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => { setBase(null); api.cbamForecast(year).then((r) => { setBase(r); setA(r.assumptions); setRes(r.result); }).catch((e) => toast((e as Error).message)); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!a || !base) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.cbamForecastRun(year, a).then((r) => setRes(r.result)).catch((e) => toast((e as Error).message));
      // the same without switches and on default values: what actual data and cleaner suppliers save
      api.cbamForecastRun(year, { ...a, basis: 'default', switches: [] }).then((r) => setCmp(r.result)).catch(() => {});
    }, 350);
  }, [a]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!base || !a || !res) return <div className="page"><div className="card empty">Loading…</div></div>;
  const up = (x: Partial<ForecastAssumptions>) => setA({ ...a, ...x });
  const sw = (key: string) => a.switches.find((s) => s.key === key)?.see ?? null;
  const setSw = (key: string, see: number | null) => up({ switches: see == null ? a.switches.filter((s) => s.key !== key) : [...a.switches.filter((s) => s.key !== key), { key, see }] });
  const max = Math.max(...res.years.map((y) => Math.max(y.cost, cmp?.years.find((c) => c.year === y.year)?.cost ?? 0)), 1);
  const exportX = () => void downloadPost('/api/cbam/forecast/export', { year, assumptions: a }, `CBAM forecast ${a.from}-${a.to}.xlsx`).catch((e) => toast((e as Error).message));
  return <div className="page">
    <Head eyebrow="CBAM · importer" title="Cost forecast" sub="Certificates and cost each year from your imports, as the free allocation is phased out (none left from 2034) and the default-value mark-up rises. Change the assumptions; nothing is saved until you choose to."
      right={<YearSel year={year} set={setYear} />} />
    {!base.groups.length ? <div className="card empty">No CBAM import lines in {year} to forecast from. Load your imports first.</div> : <>
      <section className="card">
        <span className="lbl">Assumptions</span>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end', marginTop: 6 }}>
          <label className="field"><span>From</span><select className="input" value={a.from} onChange={(e) => up({ from: Number(e.target.value) })}>{[2026, 2027, 2028, 2029, 2030].map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className="field"><span>To</span><select className="input" value={a.to} onChange={(e) => up({ to: Number(e.target.value) })}>{[2030, 2032, 2034, 2036, 2040].map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className="field"><span>Certificate price {a.from} (EUR)</span><input className="input num" type="number" step="1" style={{ width: 120 }} value={a.price} onChange={(e) => up({ price: Number(e.target.value) || 0 })} /></label>
          <label className="field"><span>Price change / year (%)</span><input className="input num" type="number" step="0.5" style={{ width: 110 }} value={Math.round(a.priceGrowth * 1000) / 10} onChange={(e) => up({ priceGrowth: Number(e.target.value) / 100 })} /></label>
          <label className="field"><span>Tonnes change / year (%)</span><input className="input num" type="number" step="1" style={{ width: 110 }} value={Math.round(a.volumeGrowth * 1000) / 10} onChange={(e) => up({ volumeGrowth: Number(e.target.value) / 100 })} /></label>
          <label className="field"><span>Emissions</span><div className="seg"><button className={a.basis === 'actual' ? 'on' : ''} onClick={() => up({ basis: 'actual' })}>Actual where known</button><button className={a.basis === 'default' ? 'on' : ''} onClick={() => up({ basis: 'default' })}>Default values</button></div></label>
          <span className="grow" />
          {base.can.edit && <button className="btn" onClick={() => void api.cbamForecastSave(a).then(() => toast('Assumptions saved')).catch((e) => toast((e as Error).message))}>Save assumptions</button>}
          <button className="btn" onClick={exportX}><Icon name="download" size={15} /> Excel</button>
        </div>
        {base.lastPrice != null && <div className="muted small" style={{ marginTop: 6 }}>Latest certificate price in the tool: EUR {f(base.lastPrice)}.</div>}
      </section>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Total {a.from}–{a.to}</span><b>{eur(res.total)}</b><span className="muted small">this scenario</span></div>
        <div className="card kpi"><span className="muted small">All on default values</span><b>{eur(cmp?.total)}</b><span className="muted small">no supplier data, no switches</span></div>
        <div className="card kpi"><span className="muted small">Saved by actual data and switches</span><b>{cmp ? eur(cmp.total - res.total) : '—'}</b><span className="muted small">{cmp && cmp.total ? pct((cmp.total - res.total) / cmp.total) : ''}</span></div>
        <div className="card kpi"><span className="muted small">{a.to}</span><b>{eur(res.years.at(-1)?.cost)}</b><span className="muted small">{f0(res.years.at(-1)?.certificates)} certificates</span></div>
      </div>
      <section className="card">
        <span className="lbl">Cost per year</span>
        <div className="fcbars" role="img" aria-label="Cost per year">{res.years.map((y) => { const c = cmp?.years.find((z) => z.year === y.year); return <div key={y.year} className="fccol" title={`${y.year}: ${eur(y.cost)}${c ? ` (default values: ${eur(c.cost)})` : ''}`}>
          <div className="fcstack">{c && <span className="fcghost" style={{ height: `${(c.cost / max) * 100}%` }} />}<span className="fcbar" style={{ height: `${(y.cost / max) * 100}%` }} /></div>
          <small>{y.year}</small><small className="muted">{y.cost >= 1e6 ? `${f(y.cost / 1e6, 1)}m` : `${f0(y.cost / 1e3)}k`}</small></div>; })}</div>
        <div className="row small muted" style={{ gap: 12 }}><span><i className="fckey" /> this scenario</span><span><i className="fckey ghost" /> all on default values</span></div>
        <div className="scroll" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>Year</th><th className="num">CBAM factor</th><th className="num">Price</th><th className="num">Tonnes</th><th className="num">Embedded tCO₂e</th><th className="num">Free allocation adj.</th><th className="num">Certificates</th><th className="num">Cost</th></tr></thead>
          <tbody>{res.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{pct(y.cbamFactor, 1)}</td><td className="num">{f(y.price)}</td><td className="num">{f0(y.mass)}</td><td className="num">{f0(y.embedded)}</td><td className="num">{f0(y.faa)}</td><td className="num">{f0(y.certificates)}</td><td className="num"><b>{eur(y.cost)}</b>{y.missing > 0 && <div className="small bad">{f0(y.missing)} t without a value</div>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card">
        <span className="lbl">Scenarios by supplier and CN code</span>
        <div className="muted small">Type a lower SEE to see what buying from a cleaner installation would save (e.g. a scrap-based EAF instead of a blast furnace).</div>
        <div className="scroll" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>CN · origin · supplier</th><th className="num">Tonnes {year}</th><th className="num">Actual SEE</th><th className="num">Default value</th><th>Switch to SEE</th><th className="num">Cost {a.from}–{a.to}</th></tr></thead>
          <tbody>{base.groups.map((g) => { const r = res.groups.find((x) => x.key === g.key); return <tr key={g.key}><td><span className="mono">{g.cn}</span> · {g.origin} · <b>{g.supplier}</b></td><td className="num">{f(g.mass, 1)}</td><td className="num">{f(g.seeActual, 3)}</td><td className="num">{f(g.defaultValue, 3)}</td>
            <td><input className="input num" type="number" step="0.01" min="0" style={{ width: 100 }} value={sw(g.key) ?? ''} placeholder="—" onChange={(e) => setSw(g.key, e.target.value === '' ? null : Number(e.target.value))} /></td><td className="num">{eur(r?.total)}</td></tr>; })}</tbody></table></div>
      </section>
      <div className="muted small">Estimate: free allocation adjustment = CBAM benchmark × CBAM factor of the year; default values with the mark-up of the year; carbon price paid deducted where given on the import lines. Load the official default values and benchmarks for accurate figures.</div>
    </>}
  </div>;
}

// ------------------------------------------------------------------ library --
const RULES: { t: string; d: string }[] = [
  { t: 'Who pays', d: 'The authorised CBAM declarant (the EU importer or its indirect customs representative) buys and surrenders CBAM certificates for the embedded emissions of CBAM goods imported in a calendar year.' },
  { t: 'De minimis — 50 tonnes', d: 'An importer bringing in 50 tonnes or less of CBAM goods in a calendar year, all together, is exempt. Electricity and hydrogen are covered whatever the quantity. Above the threshold every import of the year counts; importers above 90% are flagged and must apply for authorised declarant status before going over.' },
  { t: 'Declaration', d: 'Once a year, by 30 September of the following year (2026 imports: 30 September 2027), in the CBAM Registry: goods by CN code and origin, embedded emissions, verification and certificates surrendered.' },
  { t: 'Certificates', d: 'Sold on a central platform from 1 February 2027 (for 2026 imports), priced on EU ETS auctions. At the end of each quarter the declarant holds certificates for at least 50% of the embedded emissions of the goods imported since the start of the year.' },
  { t: 'Free allocation adjustment', d: 'Certificates are reduced by the CBAM benchmark times the CBAM factor of the year, which falls from 97.5% in 2026 to 0 in 2034 as free allocation ends in the EU ETS.' },
  { t: 'Actual or default values', d: 'Embedded emissions come from the installation (actual values, verified by an accredited verifier) or from the Commission\'s default values per CN code and country, with a mark-up that rises over the first years (fertilisers: a small mark-up only).' },
  { t: 'Direct and indirect emissions', d: 'Indirect emissions (electricity) count for cement and fertilisers; for iron and steel, aluminium, hydrogen and electricity only direct emissions count. Both are reported.' },
  { t: 'Carbon price paid abroad', d: 'A carbon price effectively paid in the country of origin can be deducted from the certificates, with evidence; the Commission may publish default carbon prices for third countries.' },
  { t: 'Penalties', d: 'EUR 100 per tonne of embedded emissions for which certificates were not surrendered, harmonised with the EU ETS; three to five times that for importing above the threshold without authorisation.' },
  { t: 'Exporters outside the EU', d: 'Installations register in the CBAM Registry\'s operator portal (O3CI), monitor emissions, get them verified, and share them with their importers — or send the Commission\'s communication template.' },
];
const LINKS: [string, string][] = [
  ['Regulation (EU) 2023/956 — the CBAM Regulation (EUR-Lex)', 'https://eur-lex.europa.eu/eli/reg/2023/956/oj'],
  ['Regulation (EU) 2025/2083 — CBAM simplification (EUR-Lex)', 'https://eur-lex.europa.eu/eli/reg/2025/2083/oj'],
  ['CBAM legislation and guidance (European Commission)', 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-legislation-and-guidance_en'],
  ['CBAM Registry and reporting (European Commission)', 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-registry-and-reporting_en'],
];
export function CbamLibrary() {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ total: number; codes: CbamCnRow[] } | null>(null);
  const [lists, setLists] = useState<CommLists | null>(null);
  const [sel, setSel] = useState<CbamCnRow | null>(null);
  const [refs, setRefs] = useState<{ kind: string; cn: string | null; country: string | null; year: number; value: number; source: string; indicative: boolean }[]>([]);
  const [rule, setRule] = useState('');
  useEffect(() => { api.cbamCommLists().then(setLists).catch(() => {}); api.cbam(Math.max(2026, thisYear)).then((d) => setRefs(d.references as typeof refs)).catch(() => {}); }, []);
  useEffect(() => { const t = window.setTimeout(() => { api.cbamCn(q).then(setRes).catch((e) => toast((e as Error).message)); }, 200); return () => window.clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = sel && lists ? lists.goods.find((x) => x.name.trim() === sel.category) : null;
  const rs = sel ? refs.filter((r) => r.cn && sel.cn.startsWith(r.cn) && r.kind !== 'price') : [];
  const rules = RULES.filter((r) => !rule || `${r.t} ${r.d}`.toLowerCase().includes(rule.toLowerCase()));
  return <div className="page">
    <Head eyebrow="CBAM" title="CN codes & rules" sub="Which goods are covered, how their emissions are counted, and the main rules — with the official texts." />
    <div className="cbamgrid">
      <section className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        <span className="lbl">CN codes covered</span>
        <input className="input" placeholder="Search a CN code (7208…) or words (aluminium, urea, cement…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="muted small">{res ? `${res.total} code${res.total === 1 ? '' : 's'}${res.total > res.codes.length ? `, first ${res.codes.length} shown` : ''}` : ''}</div>
        <div className="cmlist">{res?.codes.map((c) => <button key={c.cn} className={`cmcn${sel?.cn === c.cn ? ' on' : ''}`} onClick={() => setSel(c)}><span className="mono">{c.cn}</span><span><b>{c.category}</b><small className="muted">{c.name}</small></span></button>)}</div>
      </section>
      <section className="card" style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
        {!sel ? <div className="muted">Pick a CN code to see how it is treated.</div> : <>
          <span className="lbl">CN {sel.cn}</span><h3 style={{ margin: 0 }}>{sel.category}</h3>
          <div className="small">{sel.name}</div>
          <table className="t"><tbody>
            <tr><td>Sector</td><td>{sel.sector.replace('_', ' and ')}</td></tr>
            <tr><td>Emissions counted</td><td>{['cement', 'fertilisers'].includes(sel.sector) ? 'Direct and indirect (electricity)' : 'Direct only (indirect reported)'}</td></tr>
            <tr><td>50 t threshold</td><td>{['electricity', 'hydrogen'].includes(sel.sector) ? 'Not applicable: always covered' : 'Counts towards the 50 t a year'}</td></tr>
            {g && <tr><td>Production routes</td><td>{g.routes.join(' · ')}</td></tr>}
            {g && g.chain.length > 1 && <tr><td>Relevant precursors</td><td>{g.chain.slice(1).join(', ')}</td></tr>}
            {g && <tr><td>Unit</td><td>{g.unit === 'MWh' ? 'MWh' : 'tonnes'}</td></tr>}
          </tbody></table>
          <span className="lbl">Default values and benchmarks in the tool</span>
          {rs.length ? <table className="t"><thead><tr><th>Kind</th><th>Country</th><th>Year</th><th className="num">Value</th><th>Source</th></tr></thead>
            <tbody>{rs.slice(0, 12).map((r, i) => <tr key={i}><td>{r.kind === 'default' ? 'Default value' : 'CBAM benchmark'}</td><td>{r.country ?? 'all'}</td><td>{r.year}</td><td className="num">{f(r.value, 3)}</td><td className="small">{r.source}{r.indicative && <span className="chip warn" style={{ marginLeft: 4 }}>illustrative</span>}</td></tr>)}</tbody></table>
            : <div className="muted small">None loaded for this code yet.</div>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Link className="btn sm" to={`/cbam-calculator?cn=${sel.cn}`}>Cost calculator →</Link></div>
        </>}
      </section>
    </div>
    <section className="card" style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><div className="grow"><span className="lbl">Rules</span><h3 style={{ margin: '2px 0 0' }}>The main rules in plain words</h3></div><input className="input" style={{ maxWidth: 280 }} placeholder="Search the rules" value={rule} onChange={(e) => setRule(e.target.value)} /></div>
      <div className="cmrules">{rules.map((r) => <div key={r.t} className="cmrule"><b>{r.t}</b><p>{r.d}</p></div>)}</div>
      <div className="muted small">Summary of Regulation (EU) 2023/956 as amended by Regulation (EU) 2025/2083. Always check the official texts:</div>
      <ul className="steps">{LINKS.map(([t, u]) => <li key={u}><a href={u} target="_blank" rel="noreferrer noopener">{t}</a></li>)}</ul>
    </section>
  </div>;
}

// ------------------------------------------------------------------ settings --
export function CbamSettings() {
  const { toast, can } = useApp();
  const [s, setS] = useState<{ role: CbamRole; eori: string } | null>(null);
  useEffect(() => { api.cbamSettings().then((x) => setS({ role: x.role, eori: x.eori ?? '' })).catch((e) => toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <div className="page"><div className="card empty">Loading…</div></div>;
  const save = async () => { try { await api.cbamSettingsSave({ role: s.role, eori: s.eori.trim() || null }); window.dispatchEvent(new Event('cbam-role')); toast('Saved — the menu follows your role'); } catch (e) { toast((e as Error).message); } };
  const ROLES: [CbamRole, string, string][] = [['importer', 'Importer into the EU', 'You declare CBAM goods and buy certificates: imports, suppliers\' data, certificates, forecast.'], ['exporter', 'Exporter to the EU', 'Your installation makes CBAM goods for EU customers: communications, installations, precursor suppliers.'], ['both', 'Both', 'Everything above.']];
  return <div className="page">
    <Head eyebrow="CBAM" title="Settings" />
    <section className="card" style={{ display: 'grid', gap: 10, maxWidth: 760 }}>
      <span className="lbl">Your role in CBAM</span>
      <div className="cmroles">{ROLES.map(([k, t, d]) => <button key={k} className={`cmrole${s.role === k ? ' on' : ''}`} disabled={!can('super_admin', 'admin')} onClick={() => setS({ ...s, role: k })}><b>{t}</b><small>{d}</small></button>)}</div>
      <label className="field" style={{ maxWidth: 320 }}><span>EORI number (importers)</span><input className="input" value={s.eori} placeholder="e.g. DE123456789012345" onChange={(e) => setS({ ...s, eori: e.target.value })} /></label>
      {can('super_admin', 'admin') && <div><button className="btn p" onClick={() => void save()}>Save</button></div>}
    </section>
  </div>;
}

// ------------------------------------------------------------------ answer a customer's request --
export function CbamAnswer() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [v, setV] = useState({ email: '', code: '' });
  const [r, setR] = useState<Awaited<ReturnType<typeof api.cbamAnswerLookup>> | null>(null);
  const [comms, setComms] = useState<CommListItem[]>([]);
  const [comm, setComm] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { api.cbamComms().then((x) => setComms(x.comms)).catch(() => {}); }, []);
  const best = useMemo(() => (r ? comms.find((c) => c.periodStart?.startsWith(String(r.year)) && (!r.quarter || Math.floor((Number(c.periodStart.slice(5, 7)) - 1) / 3) + 1 === r.quarter)) : null), [r, comms]);
  useEffect(() => { if (best && !comm) setComm(best.id); }, [best]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="page">
    <Head eyebrow="CBAM · exporter" title="Answer a customer's request" sub="An EU customer asked you for emissions data and sent you an e-mail with an access code. Send your communication from here — no need to fill anything again." />
    <section className="card" style={{ display: 'grid', gap: 10, maxWidth: 820 }}>
      {sent ? <><div className="note ok">Sent to {sent}. They will review it and may write back by e-mail.</div><div><button className="btn" onClick={() => { setSent(null); setR(null); setV({ email: '', code: '' }); setComm(''); }}>Answer another request</button></div></> : <>
        <div className="vform">
          <label className="field"><span>E-mail the request was sent to</span><input className="input" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
          <label className="field"><span>Access code</span><input className="input mono" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="from the e-mail" /></label>
        </div>
        {!r && <div><button className="btn p" disabled={!v.email.includes('@') || v.code.trim().length < 6} onClick={() => void api.cbamAnswerLookup(v.email.trim(), v.code.trim()).then(setR).catch((e) => toast((e as Error).message))}>Find the request</button></div>}
        {r && <>
          <div className="note info small"><b>{r.company}</b> asks for {r.quarter ? `Q${r.quarter} ` : ''}{r.year}{r.cnCodes.length ? ` · CN ${r.cnCodes.join(', ')}` : ''}{r.dueDate ? ` · by ${d8(r.dueDate)}` : ''}.{r.message && <div style={{ marginTop: 4 }}>{r.message}</div>}</div>
          <label className="field"><span>Send this communication</span><select className="input" value={comm} onChange={(e) => setComm(e.target.value)}><option value="">Choose…</option>{comms.map((c) => <option key={c.id} value={c.id}>{c.title}{c.status !== 'draft' ? ` (${c.status})` : ' (draft)'}{c.errors ? ` — ${c.errors} to fix` : ''}</option>)}</select></label>
          {comms.find((c) => c.id === comm)?.errors ? <div className="note warn small">This communication still has problems to fix; your customer may send it back.</div> : null}
          <div className="row" style={{ gap: 8 }}><button className="btn p" disabled={!comm} onClick={() => void api.cbamAnswer(v.email.trim(), v.code.trim(), comm).then((x) => setSent(x.company)).catch((e) => toast((e as Error).message))}>Send to {r.company}</button>
            <button className="btn ghost" onClick={() => nav('/cbam/comms')}>Open communications</button></div>
          <div className="muted small">Your customer receives the installation and, per good, the specific embedded emissions (direct and indirect), the share from default values and the embedded electricity — not your fuel and production details.</div>
        </>}
      </>}
    </section>
  </div>;
}
