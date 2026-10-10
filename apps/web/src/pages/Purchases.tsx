/**
 * Purchased goods & services (Capture → Purchases).
 *
 *   list      every batch (upload, manual, ERP API) with its progress and state
 *   upload    any CSV / Excel layout: choose which column is which (remembered per layout)
 *   batch     review by group (one per distinct description): spend category, overlap with
 *             other categories (keep / move / exclude), capital goods; facilities not
 *             recognised; lines with problems; publish → entries; reopen
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../App';
import { ApiError, api, download, num, tco2e, type BatchDetail, type Columns, type Facility, type LineStatus, type PurchaseBatch, type PurchaseField, type PurchaseGroup, type PurchaseLine, type PurchaseMeta, type UploadResult } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { Icon } from '../components/Icon';

const ENTER = ['super_admin', 'admin', 'manager', 'preparer'];
const BATCH_STATUS: Record<string, [string, string]> = {
  setup: ['Choose columns', 'warn'], receiving: ['Receiving from API', 'info'], queued: ['Waiting', 'info'], reading: ['Reading file', 'info'], mapping: ['Mapping', 'info'],
  review: ['To review', 'warn'], publishing: ['Publishing', 'info'], published: ['Published', ''], failed: ['Failed', 'bad'],
};
const LINE_STATUS: Record<LineStatus, [string, string]> = {
  new: ['new', 'grey'], problem: ['problem', 'bad'], unmapped: ['no category', 'warn'], flagged: ['other category?', 'warn'], excluded: ['excluded', 'grey'], ready: ['ready', 'info'], published: ['published', ''],
};
const SOURCE: Record<string, string> = { upload: 'File', manual: 'Entered', api: 'ERP API' };
const METHOD: Record<string, string> = { rule: 'remembered', text: 'text match', ai: 'AI', manual: 'by hand', code: 'code in file' };
export const TARGETS: [string, string][] = [['business_travel', 'Business travel (3.6)'], ['upstream_transport', 'Upstream transport (3.4)'], ['upstream_leased', 'Upstream leased assets (3.8)'], ['capital_goods', 'Capital goods (3.2)']];
const CAT_NAME: Record<string, string> = { purchased_goods: 'Purchased goods & services (3.1)', capital_goods: 'Capital goods (3.2)', upstream_transport: 'Upstream transport (3.4)', business_travel: 'Business travel (3.6)', upstream_leased: 'Upstream leased assets (3.8)' };
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en')}`);
const running = (s: string) => ['queued', 'reading', 'mapping', 'publishing'].includes(s);

function FactorBanner({ meta }: { meta: PurchaseMeta | null }) {
  if (!meta) return null;
  const demoOnly = meta.factorSets.length > 0 && meta.factorSets.every((f) => f.code === 'DEMO-SPEND');
  if (!meta.factorSets.length) return <div className="note warn">No spend-based factors are loaded yet: a platform admin loads the US EPA supply chain factors (v1.3) under Factors &amp; dictionary. Lines with a supplier's own factor can still be calculated.</div>;
  if (demoOnly) return <div className="note warn"><b>Demo factors.</b> The spend-based factors loaded are made-up placeholders for the demo, not EPA values. Load the EPA v1.3 file before any real reporting.</div>;
  return null;
}

export function Purchases() {
  const { role } = useApp();
  const nav = useNavigate();
  const [meta, setMeta] = useState<PurchaseMeta | null>(null);
  const [batches, setBatches] = useState<PurchaseBatch[] | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const canEnter = ENTER.includes(role);
  const load = () => api.purchaseBatches().then((r) => setBatches(r.batches));
  useEffect(() => { api.purchaseMeta().then(setMeta); load(); }, []);
  useEffect(() => { // follow running batches
    if (!batches?.some((b) => running(b.status))) return;
    const t = window.setTimeout(load, 1500);
    return () => window.clearTimeout(t);
  }, [batches]);

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture · Scope 3.1</div><h1>Purchases</h1>
          <p className="sub">Purchased goods &amp; services from your ERP or finance system: upload an export in any layout, or connect the ERP through the API. Lines are grouped by description, mapped to a spend category, checked for overlap with other categories, and published as entries.</p></div>
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <button className="btn" onClick={() => download('/api/purchases/template', 'Ekotrace purchases template.xlsx')}><Icon name="doc" />Template</button>
          {canEnter && <Link className="btn" to="/data/purchased_goods"><Icon name="edit" />Enter by hand</Link>}
        </div>
      </div>
      <FactorBanner meta={meta} />
      {canEnter && !upload && <UploadBox onUploaded={setUpload} />}
      {upload && meta && <ColumnSetup meta={meta} up={upload} onCancel={() => { api.deleteBatch(upload.batchId).catch(() => {}); setUpload(null); }} onStarted={(id) => { setUpload(null); nav(`/purchases/${id}`); }} />}
      <div className="card flush">
        {batches === null ? <div className="empty">Loading…</div> : batches.length ? (
          <table className="t">
            <thead><tr><th>Batch</th><th>Source</th><th>State</th><th className="num">Lines</th><th className="num">Need attention</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th>Added</th></tr></thead>
            <tbody>{batches.map((b) => {
              const [label, tone] = BATCH_STATUS[b.status] ?? [b.status, 'grey'];
              const p = b.progress;
              return (
                <tr key={b.id} className="click" onClick={() => nav(`/purchases/${b.id}`)}>
                  <td><b>{b.name}</b>{b.error && b.status === 'failed' && <div className="bad small">{b.error}</div>}</td>
                  <td>{SOURCE[b.source]}</td>
                  <td><span className={`chip ${tone}`}>{label}</span>{running(b.status) && p?.done != null && <div className="muted small">{p.stage} {p.done.toLocaleString('en')}{p.total ? ` / ${p.total.toLocaleString('en')}` : ''}</div>}</td>
                  <td className="num">{b.lines.toLocaleString('en')}</td>
                  <td className="num">{b.attention ? <span className="chip warn">{b.attention.toLocaleString('en')}</span> : '—'}</td>
                  <td className="num">{usd(b.usd)}</td>
                  <td className="num">{tco2e(b.co2e)}</td>
                  <td className="muted small">{new Date(b.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}{b.created_by_name ? ` · ${b.created_by_name}` : ''}</td>
                </tr>);
            })}</tbody>
          </table>
        ) : <div className="empty">No purchases yet. Upload an export from your ERP, download the template, or enter purchases by hand.</div>}
      </div>
    </div>
  );
}

function UploadBox({ onUploaded }: { onUploaded: (u: UploadResult) => void }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dup, setDup] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const send = async (f: File, again = false) => {
    setErr(null); setDup(null);
    if (f.size > 60 * 1024 * 1024) { setErr('The file is larger than 60 MB: split it, or send the lines through the API.'); return; }
    setBusy(`Uploading ${f.name}…`);
    try { onUploaded(await api.uploadPurchases(f, again)); }
    catch (e) { if (e instanceof ApiError && e.code === 'DUPLICATE_FILE') { setDup(f); setErr(e.message); } else setErr((e as Error).message); }
    finally { setBusy(null); }
  };
  return (
    <>
      <div className={`card drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) send(f); }} onClick={() => !busy && input.current?.click()}>
        <Icon name="upload" />
        <div><b>{busy ?? 'Drop an export here'}</b>{!busy && ', or click to choose: Excel (.xlsx) or CSV, any layout.'}
          <div className="sub">Up to 200,000 lines (60 MB). On the next step you say which column is which; the choice is remembered for files with the same columns.</div></div>
        <input ref={input} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ''; }} />
      </div>
      {err && <div className="note bad">{err}{dup && <> <button className="btn sm" onClick={() => send(dup, true)}>Upload it again anyway</button></>}</div>}
    </>
  );
}

// ------------------------------------------------------------ column setup --
function ColumnSetup({ meta, up, onCancel, onStarted }: { meta: PurchaseMeta; up: UploadResult; onCancel: () => void; onStarted: (id: string) => void }) {
  const [sheetIx, setSheetIx] = useState(() => Math.max(0, up.sheets.findIndex((s) => s.profile)) || 0);
  const sheet = up.sheets[sheetIx]!;
  const [headerRow, setHeaderRow] = useState(sheet.profile?.settings.headerRow ?? sheet.headerRow);
  const headers = useMemo(() => (sheet.rows[headerRow] ?? []).map((h) => h.trim()), [sheet, headerRow]);
  const [cols, setCols] = useState<Columns>(sheet.profile?.settings.columns ?? sheet.guess);
  const [dateFormat, setDateFormat] = useState<'dmy' | 'mdy' | 'ymd'>(sheet.profile?.settings.dateFormat ?? 'dmy');
  const [currency, setCurrency] = useState(sheet.profile?.settings.currency ?? up.defaultCurrency);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState(sheet.profile?.settings.facilityId ?? '');
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [name, setName] = useState(up.filename.replace(/\.(xlsx|csv|txt)$/i, ''));
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.facilities().then((f) => setFacilities(f.facilities.filter((x) => x.canEnter))); }, []);
  useEffect(() => { if (!sheet.profile) { setHeaderRow(sheet.headerRow); setCols(sheet.guess); } }, [sheetIx]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (f: PurchaseField, v: string | string[] | undefined) => setCols((c) => { const n = { ...c }; if (!v || (Array.isArray(v) && !v.length)) delete n[f]; else n[f] = v; return n; });
  const desc = Array.isArray(cols.description) ? cols.description : cols.description ? [cols.description] : [];
  const idx = (h?: string) => (h ? headers.indexOf(h) : -1);
  const sample = sheet.rows.slice(headerRow + 1, headerRow + 6);
  const start = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.setupBatch(up.batchId, {
        sheet: sheet.name === 'CSV' ? undefined : sheet.name, headerRow, columns: cols, dateFormat, currency, facilityId: cols.facility ? null : facilityId || null,
        period: cols.date ? null : { year: Number(year) }, name, remember, headers,
      });
      onStarted(r.batchId);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const FIELD_ORDER: PurchaseField[] = ['date', 'amount', 'currency', 'supplier', 'category', 'gl', 'facility', 'quantity', 'unit', 'po', 'supplierEf', 'supplierEfUnit', 'capital'];
  const labelOf = (f: PurchaseField) => meta.fields.find((x) => x.field === f)?.label ?? f;
  const colSelect = (f: PurchaseField) => (
    <label className="field" key={f}><span>{labelOf(f)}{['amount'].includes(f) ? ' *' : ''}</span>
      <select className="input" value={(cols[f] as string) ?? ''} onChange={(e) => set(f, e.target.value || undefined)}>
        <option value="">— not in the file —</option>{headers.filter(Boolean).map((h) => <option key={h}>{h}</option>)}</select></label>
  );

  return (
    <div className="card" style={{ display: 'grid', gap: 14 }}>
      <div className="row"><div className="grow"><div className="eyebrow">Upload · {up.filename}</div><h2>Which column is which?</h2>
        <div className="sub">{sheet.profile ? <>Layout recognised: <b>{sheet.profile.name}</b>. Check and continue.</> : 'Best guess from the column names: check each one.'}</div></div>
        <button className="btn ghost" onClick={onCancel} aria-label="Cancel"><Icon name="x" /></button></div>
      {up.sheets.length > 1 && <div className="tabs">{up.sheets.map((s, i) => <button key={s.name} className={i === sheetIx ? 'on' : ''} onClick={() => setSheetIx(i)}>{s.name}</button>)}</div>}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field"><span>Header row</span><select className="input" value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
          {sheet.rows.slice(0, 12).map((r, i) => <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).slice(0, 4).join(' · ').slice(0, 60)}</option>)}</select></label>
        <label className="field grow"><span>Name of this batch</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <div className="grid3">
        <label className="field"><span>Description * (one or two columns)</span>
          <select className="input" value={desc[0] ?? ''} onChange={(e) => set('description', [e.target.value, ...desc.slice(1)].filter(Boolean))}>
            <option value="">— choose —</option>{headers.filter(Boolean).map((h) => <option key={h}>{h}</option>)}</select></label>
        <label className="field"><span>… and (optional)</span>
          <select className="input" value={desc[1] ?? ''} onChange={(e) => set('description', [desc[0] ?? '', e.target.value].filter(Boolean))}>
            <option value="">—</option>{headers.filter(Boolean).filter((h) => h !== desc[0]).map((h) => <option key={h}>{h}</option>)}</select></label>
        {FIELD_ORDER.map(colSelect)}
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {cols.date && <label className="field"><span>Dates written as</span><select className="input" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as 'dmy')}>
          <option value="dmy">day/month/year (31/03/2026)</option><option value="mdy">month/day/year (03/31/2026)</option><option value="ymd">year-month-day (2026-03-31)</option></select></label>}
        {!cols.date && <label className="field"><span>No date column: year of the file</span><input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 110 }} /></label>}
        <label className="field"><span>{cols.currency ? 'Currency when the cell is empty' : 'Currency of the amounts'}</span><input className="input" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} style={{ width: 90 }} /></label>
        {!cols.facility && <label className="field" style={{ minWidth: 260 }}><span>No facility column: facility of the whole file</span><select className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
          <option value="">— choose —</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.parent_name ? `${f.parent_name} › ` : ''}{f.name}</option>)}</select></label>}
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this layout</label>
      </div>
      <div className="scrollx"><table className="t compact">
        <thead><tr><th>Description</th><th>Date</th><th className="num">Amount</th><th>Currency</th><th>Supplier</th><th>Category / GL</th><th>Facility</th></tr></thead>
        <tbody>{sample.map((r, i) => (
          <tr key={i}><td>{desc.map((h) => r[idx(h)]).filter(Boolean).join(' — ') || <span className="bad">—</span>}</td><td>{r[idx(cols.date as string)] ?? (cols.date ? '' : year)}</td>
            <td className="num">{r[idx(cols.amount as string)] ?? ''}</td><td>{r[idx(cols.currency as string)] || currency}</td><td>{r[idx(cols.supplier as string)] ?? ''}</td>
            <td>{[r[idx(cols.category as string)], r[idx(cols.gl as string)]].filter(Boolean).join(' · ')}</td><td>{cols.facility ? r[idx(cols.facility as string)] : facilities.find((f) => f.id === facilityId)?.name ?? ''}</td></tr>))}</tbody>
      </table></div>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn p" disabled={busy || !desc.length || (!cols.amount && !cols.quantity)} onClick={start}>{busy ? 'Starting…' : 'Read the whole file'}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ batch --
export function PurchaseBatchPage() {
  const { id } = useParams<{ id: string }>();
  const { role, toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<BatchDetail | null>(null);
  const [tab, setTab] = useState<'groups' | 'lines' | 'summary'>('groups');
  const [err, setErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const canEnter = ENTER.includes(role);
  const load = () => api.purchaseBatch(id!).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = !!d && (running(d.batch.status) || d.job?.status === 'queued' || d.job?.status === 'running');
  useEffect(() => { if (!busy) return; const t = window.setTimeout(load, 1200); return () => window.clearTimeout(t); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const wasBusy = useRef(false);
  useEffect(() => { if (wasBusy.current && !busy) setRev((r) => r + 1); wasBusy.current = busy; }, [busy]);
  const refresh = () => { load(); setRev((r) => r + 1); };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); refresh(); } catch (e) { setErr((e as Error).message); } };

  if (!d) return <div className="page"><div className="card empty">{err ?? 'Loading…'}</div></div>;
  const b = d.batch;
  const count = (s: LineStatus) => d.counts.find((c) => c.status === s)?.lines ?? 0;
  const co2 = (s: LineStatus) => d.counts.find((c) => c.status === s)?.co2e ?? 0;
  const total = d.counts.reduce((s, c) => s + c.lines, 0);
  const [label, tone] = BATCH_STATUS[b.status] ?? [b.status, 'grey'];
  const p = d.job?.progress;
  const attention = count('problem') + count('unmapped') + count('flagged');
  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow"><Link to="/purchases">Purchases</Link> · {SOURCE[b.source]}{b.file ? ` · ${b.file.filename}` : ''}{b.external_ref ? ` · ref ${b.external_ref}` : ''}</div>
          <h1>{b.name} <span className={`chip ${tone}`} style={{ verticalAlign: 'middle' }}>{label}</span></h1>
          <p className="sub">{total.toLocaleString('en')} lines{d.period.from ? ` · ${d.period.from.slice(0, 7)} to ${d.period.to?.slice(0, 7)}` : ''} · {d.groups.total.toLocaleString('en')} distinct descriptions · {d.entries.n ? `${d.entries.n} entries published` : 'not published yet'}</p></div>
        {canEnter && !busy && b.status !== 'setup' && (
          <div className="row" style={{ alignSelf: 'flex-end' }}>
            <button className="btn" onClick={() => act(() => api.recalcBatch(id!), 'Recalculating in the background')} title="After adding exchange rates, a price index or supplier factors">Recalculate</button>
            {d.entries.n > 0 && <button className="btn" onClick={() => act(() => api.reopenBatch(id!), 'Reopened: entries taken back')}>Reopen</button>}
            {!d.entries.n && <button className="btn danger" onClick={() => act(async () => { await api.deleteBatch(id!); nav('/purchases'); }, 'Batch deleted')}>Delete</button>}
            <button className="btn p" disabled={!count('ready')} onClick={() => act(() => api.publishBatch(id!), 'Publishing in the background')}>Publish {count('ready').toLocaleString('en')} ready lines</button>
          </div>
        )}
      </div>
      <FactorBannerLoader />
      {busy && (
        <div className="card" style={{ display: 'grid', gap: 6 }}>
          <b>{p?.stage ? `${p.stage[0]!.toUpperCase()}${p.stage.slice(1)}…` : 'Waiting for the worker…'}</b>
          <div className="cov big"><i style={{ width: `${p?.total ? Math.min(100, Math.round(100 * (p.done ?? 0) / p.total)) : 15}%` }} /></div>
          <span className="muted small">{p?.done != null ? `${p.done.toLocaleString('en')}${p.total ? ` of ${p.total.toLocaleString('en')}` : ''}` : ''} This runs in the background: you can leave this page.</span>
        </div>
      )}
      {b.status === 'failed' && <div className="note bad">{b.error}</div>}
      {b.error && b.status !== 'failed' && <div className="note warn">{b.error}</div>}
      {err && <div className="note bad">{err}</div>}

      <div className="stats">
        <div className="stat"><div className="lbl">Ready to publish</div><div className="v">{count('ready').toLocaleString('en')}</div><div className="muted small">{tco2e(co2('ready'))} tCO₂e</div></div>
        <div className="stat s3"><div className="lbl">Published</div><div className="v">{count('published').toLocaleString('en')}</div><div className="muted small">{tco2e(co2('published'))} tCO₂e</div></div>
        <div className={`stat ${attention ? 'warnb' : ''}`}><div className="lbl">Need attention</div><div className="v">{attention.toLocaleString('en')}</div>
          <div className="muted small">{count('problem')} problems · {count('unmapped')} no category · {count('flagged')} other category?</div></div>
        <div className="stat"><div className="lbl">Excluded</div><div className="v">{count('excluded').toLocaleString('en')}</div><div className="muted small">already counted elsewhere</div></div>
      </div>

      {(d.facilitiesMissing.length > 0 || d.problems.length > 0) && !busy && (
        <div className="cols2">
          {d.facilitiesMissing.length > 0 && <FacilityFix batchId={id!} missing={d.facilitiesMissing} onDone={refresh} canEnter={canEnter} />}
          {d.problems.length > 0 && (
            <div className="card"><h3>Problems</h3>
              <table className="t compact"><tbody>{d.problems.map((x) => (
                <tr key={x.problem}><td>{x.problem}{/No exchange rate/.test(x.problem) && <> · <Link to="/currency">add the rate</Link></>}{/Duplicate/.test(x.problem) && canEnter && <> · <button className="link" onClick={() => act(() => api.patchBatch(id!, { includeDuplicates: true }), 'Duplicates included')}>count them anyway</button></>}</td><td className="num">{x.lines.toLocaleString('en')}</td></tr>))}</tbody></table></div>
          )}
        </div>
      )}

      <div className="tabs">
        <button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>By description ({d.groups.total.toLocaleString('en')})</button>
        <button className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>Lines ({total.toLocaleString('en')})</button>
        <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Summary</button>
      </div>
      {tab === 'groups' && <Groups key={rev} batchId={id!} d={d} canEdit={canEnter && !busy} onChanged={refresh} />}
      {tab === 'lines' && <Lines key={rev} batchId={id!} />}
      {tab === 'summary' && <Summary d={d} />}
    </div>
  );
}
function FactorBannerLoader() { const [m, setM] = useState<PurchaseMeta | null>(null); useEffect(() => { api.purchaseMeta().then(setM).catch(() => {}); }, []); return <FactorBanner meta={m} />; }

function FacilityFix({ batchId, missing, onDone, canEnter }: { batchId: string; missing: BatchDetail['facilitiesMissing']; onDone: () => void; canEnter: boolean }) {
  const [fac, setFac] = useState<Facility[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.facilities().then((f) => setFac(f.facilities.filter((x) => x.canEnter))); }, []);
  return (
    <div className="card"><h3>Facilities not recognised</h3>
      <div className="sub">Choose the facility each value in the file stands for (remembered for this batch).</div>
      <table className="t compact"><tbody>{missing.map((m) => (
        <tr key={m.value ?? ''}><td>{m.value ? <b>{m.value}</b> : <span className="muted">no facility written</span>}</td><td className="num">{m.lines.toLocaleString('en')} lines</td>
          <td>{canEnter && <select className="input sm" defaultValue="" onChange={async (e) => { if (!e.target.value) return; try { await api.mapFacility(batchId, m.value, e.target.value); onDone(); } catch (x) { setErr((x as Error).message); } }}>
            <option value="">— facility —</option>{fac.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}</td></tr>))}</tbody></table>
      {err && <div className="note bad">{err}</div>}
    </div>
  );
}

const FILTERS: [string, string, (d: BatchDetail) => number | null][] = [
  ['all', 'All', (d) => d.groups.total], ['unmapped', 'No category', (d) => d.groups.unmapped], ['check', 'Check (low confidence)', (d) => d.groups.check],
  ['flagged', 'Other category?', (d) => d.groups.flagged], ['capital', 'Capital goods?', (d) => d.groups.capital_hint], ['moved', 'Moved', () => null], ['excluded', 'Excluded', () => null],
];

function Groups({ batchId, d, canEdit, onChanged }: { batchId: string; d: BatchDetail; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const [filter, setFilter] = useState(d.groups.flagged ? 'flagged' : d.groups.unmapped ? 'unmapped' : 'all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('spend');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<PurchaseGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [remember, setRemember] = useState(true);
  const [moveTo, setMoveTo] = useState('business_travel');
  const [err, setErr] = useState<string | null>(null);
  const [lineOf, setLineOf] = useState<string | null>(null);
  const LIMIT = 50;
  const load = () => api.purchaseGroups(batchId, { filter, q, sort, offset, limit: LIMIT }).then((r) => { setRows(r.groups); setTotal(r.total); });
  useEffect(() => { const t = window.setTimeout(load, q ? 250 : 0); return () => window.clearTimeout(t); }, [filter, q, sort, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOffset(0); setSel(new Set()); }, [filter, q, sort]);
  const patch = async (keys: string[], b: Parameters<typeof api.patchGroups>[1] extends infer T ? Omit<T & object, 'keys'> : never) => {
    setErr(null);
    try { const r = await api.patchGroups(batchId, { keys, remember, ...b }); toast(r.background ? `${r.lines.toLocaleString('en')} lines: recalculating in the background` : `${r.groups} group${r.groups === 1 ? '' : 's'} · ${r.lines.toLocaleString('en')} lines updated`); setSel(new Set()); load(); onChanged(); }
    catch (e) { setErr((e as Error).message); }
  };
  const all = rows?.length ? rows.every((r) => sel.has(r.key)) : false;

  return (
    <div className="card flush">
      <div className="row" style={{ padding: 12, gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(([k, l, n]) => { const c = n(d); return <button key={k} className={`btn sm ${filter === k ? 'p' : ''}`} onClick={() => setFilter(k)}>{l}{c != null ? ` (${c.toLocaleString('en')})` : ''}</button>; })}
        <div className="grow" />
        <input className="input sm" type="search" placeholder="Search description, category, supplier…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <select className="input sm" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }}><option value="spend">by spend</option><option value="lines">by lines</option><option value="confidence">least sure first</option><option value="name">A–Z</option></select>
      </div>
      {canEdit && sel.size > 0 && (
        <div className="bulkbar">
          <b>{sel.size} selected</b>
          <ItemPicker value={null} compact placeholder="Set category for all selected…" onPick={(it) => it && patch([...sel], { itemId: it.id })} />
          <button className="btn sm" onClick={() => patch([...sel], { decision: 'keep' })}>Keep in 3.1</button>
          <select className="input sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ width: 'auto' }}>{TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn sm" onClick={() => patch([...sel], moveTo === 'capital_goods' ? { capital: true, decision: 'keep' } : { decision: 'move', target: moveTo })}>Move</button>
          <button className="btn sm" onClick={() => patch([...sel], { decision: 'exclude' })}>Exclude</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      {err && <div className="note bad" style={{ margin: 12 }}>{err}</div>}
      {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">Nothing here.</div> : (
        <div className="scrollx"><table className="t groups">
          <thead><tr>{canEdit && <th style={{ width: 28 }}><input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.key)))} /></th>}
            <th>Description</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th style={{ minWidth: 280 }}>Spend category</th><th style={{ minWidth: 220 }}>Other category?</th><th className="num">tCO₂e</th></tr></thead>
          <tbody>{rows.map((g) => (
            <Fragment key={g.key}>
              <tr className={sel.has(g.key) ? 'sel' : ''}>
                {canEdit && <td><input type="checkbox" checked={sel.has(g.key)} onChange={() => setSel((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })} /></td>}
                <td style={{ maxWidth: 380 }}><b>{g.description}</b>
                  <div className="muted small">{[g.category_text, g.gl_account, g.supplier].filter(Boolean).join(' · ')}</div>
                  {g.statuses && (g.statuses.problem ?? 0) > 0 && <span className="chip bad">{g.statuses.problem} with problems</span>}
                </td>
                <td className="num"><button className="link" onClick={() => setLineOf(lineOf === g.key ? null : g.key)}>{g.lines.toLocaleString('en')}</button></td>
                <td className="num">{usd(g.usd)}</td>
                <td>
                  {canEdit ? <ItemPicker value={g.item_id} valueName={g.item_name} candidates={g.candidates} onPick={(it) => patch([g.key], { itemId: it?.id ?? null })} /> : (g.item_name ?? <span className="muted">—</span>)}
                  <div className="row" style={{ gap: 4, marginTop: 3 }}>
                    {g.map_method && <span className="chip grey">{METHOD[g.map_method]}</span>}
                    {g.confidence != null && g.map_method !== 'manual' && g.map_method !== 'rule' && <span className={`chip ${g.confidence >= 0.6 ? '' : 'warn'}`}>{Math.round(g.confidence * 100)}%</span>}
                    {g.naics && <span className="muted small">NAICS {g.naics}</span>}
                  </div>
                </td>
                <td>
                  {g.overlap && !(g.overlap === 'capital_goods' && g.capital) && <div className={`chip ${g.decision ? 'grey' : 'warn'}`} title={g.overlap_why ?? ''}>{d.batch && (CAT_NAME[g.overlap] ?? OVERLAP_TEXT[g.overlap] ?? g.overlap)}?</div>}
                  {g.decision === 'move' && <div className="small">→ moved to {CAT_NAME[g.target ?? ''] ?? g.target}</div>}
                  {g.decision === 'exclude' && <div className="small">excluded (counted elsewhere)</div>}
                  {g.capital && <div className="small">→ capital goods (3.2)</div>}
                  {canEdit && (g.overlap || g.decision || g.capital) && (
                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                      {g.overlap && g.overlap !== 'capital_goods' && !['fuel', 'energy', 'waste'].includes(g.overlap) && g.decision !== 'move' && <button className="btn xs" onClick={() => patch([g.key], { decision: 'move', target: g.overlap })}>Move</button>}
                      {g.overlap === 'capital_goods' && !g.capital && <button className="btn xs" onClick={() => patch([g.key], { capital: true, decision: 'keep' })}>Capital goods</button>}
                      {g.decision !== 'keep' && !g.capital && <button className="btn xs" onClick={() => patch([g.key], { decision: 'keep' })}>Keep in 3.1</button>}
                      {(g.decision && g.decision !== 'keep' || g.capital) && <button className="btn xs" onClick={() => patch([g.key], { decision: 'keep', capital: false })}>Back to 3.1</button>}
                      {g.decision !== 'exclude' && g.overlap !== 'capital_goods' && <button className="btn xs" onClick={() => patch([g.key], { decision: 'exclude' })}>Exclude</button>}
                    </div>
                  )}
                  {g.overlap_why && !g.decision && <div className="muted small">{g.overlap_why}</div>}
                </td>
                <td className="num">{g.co2e != null ? tco2e(g.co2e) : '—'}</td>
              </tr>
              {lineOf === g.key && <tr className="sub-row"><td colSpan={canEdit ? 7 : 6}><Lines batchId={batchId} group={g.key} compact /></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
      <div className="row" style={{ padding: 12 }}>
        {canEdit && <label className="row" style={{ gap: 6, fontSize: 13 }} title="Next uploads with the same description get the same category and decision"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember my choices for future uploads</label>}
        <div className="grow" />
        {total > LIMIT && <>
          <span className="muted small">{offset + 1}–{Math.min(total, offset + LIMIT)} of {total.toLocaleString('en')}</span>
          <button className="btn sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>‹</button>
          <button className="btn sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>›</button>
        </>}
      </div>
    </div>
  );
}
const OVERLAP_TEXT: Record<string, string> = { fuel: 'Fuel (Scope 1 / 3.3)', energy: 'Electricity / water (Scope 2 / 3.3)', waste: 'Waste (3.5)' };

function Lines({ batchId, group, compact }: { batchId: string; group?: string; compact?: boolean }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<PurchaseLine[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const LIMIT = compact ? 20 : 100;
  useEffect(() => {
    const t = window.setTimeout(() => api.purchaseLines(batchId, { status, q, group, offset, limit: LIMIT }).then((r) => { setRows(r.lines); setTotal(r.total); }), q ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [status, q, offset, group]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={compact ? '' : 'card flush'}>
      {!compact && (
        <div className="row" style={{ padding: 12, gap: 6 }}>
          {[['', 'All'], ['problem', 'Problems'], ['unmapped', 'No category'], ['flagged', 'Other category?'], ['ready', 'Ready'], ['published', 'Published'], ['excluded', 'Excluded'], ['duplicate', 'Duplicates'], ['warning', 'With warnings']].map(([k, l]) =>
            <button key={k} className={`btn sm ${status === k ? 'p' : ''}`} onClick={() => { setStatus(k!); setOffset(0); }}>{l}</button>)}
          <div className="grow" />
          <input className="input sm" type="search" placeholder="Search description, supplier, PO…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ width: 240 }} />
        </div>
      )}
      {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">No lines.</div> : (
        <div className="scrollx"><table className="t compact">
          <thead><tr><th className="num">Row</th><th>Date</th><th>Description</th><th>Supplier</th><th>Facility</th><th className="num">Amount</th><th>State</th><th>Method</th><th className="num">kg CO₂e</th></tr></thead>
          <tbody>{rows.map((l) => (
            <Fragment key={l.id}>
              <tr className="click" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <td className="num muted">{l.row_no}</td><td className="mono small">{l.date ?? l.month}</td>
                <td style={{ maxWidth: 320 }}>{l.description}{l.po_ref && <span className="muted small"> · {l.po_ref}</span>}</td>
                <td className="small">{l.supplier_text}</td><td className="small">{l.facility ?? <span className="bad">{l.facility_text ?? '—'}</span>}</td>
                <td className="num">{l.amount != null ? `${l.currency ?? ''} ${num(l.amount)}` : l.quantity != null ? `${num(l.quantity)} ${l.unit ?? ''}` : '—'}</td>
                <td><span className={`chip ${LINE_STATUS[l.status][1]}`}>{LINE_STATUS[l.status][0]}</span>{l.dup_of && <span className="chip grey">duplicate</span>}</td>
                <td className="small">{l.method === 'supplier' ? 'supplier factor' : l.method === 'spend' ? 'spend-based' : '—'}</td>
                <td className="num">{l.co2e != null ? num(l.co2e, 4) : '—'}</td>
              </tr>
              {open === l.id && <tr className="sub-row"><td colSpan={9}><LineDetail line={l} /></td></tr>}
            </Fragment>))}</tbody>
        </table></div>
      )}
      {total > LIMIT && (
        <div className="row" style={{ padding: 8, justifyContent: 'flex-end' }}>
          <span className="muted small">{offset + 1}–{Math.min(total, offset + LIMIT)} of {total.toLocaleString('en')}</span>
          <button className="btn sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>‹</button>
          <button className="btn sm" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>›</button>
        </div>
      )}
    </div>
  );
}

function LineDetail({ line }: { line: PurchaseLine }) {
  const [x, setX] = useState<Awaited<ReturnType<typeof api.purchaseLine>> | null>(null);
  useEffect(() => { api.purchaseLine(line.id).then(setX).catch(() => {}); }, [line.id]);
  return (
    <div style={{ display: 'grid', gap: 6, padding: '4px 0' }}>
      {line.problems.map((p) => <div key={p} className="note bad">{p}</div>)}
      {line.calc_error && !line.problems.length && <div className="note bad">{line.calc_error}</div>}
      {line.category_text && <div className="small"><span className="muted">Category in the file:</span> {line.category_text}</div>}
      {line.item && <div className="small"><span className="muted">Spend category:</span> {line.item}</div>}
      {x?.factor && <div className="small"><span className="muted">Factor:</span> {Number(x.factor.value.toPrecision(4))} {x.factor.unit} · {x.factor.source}</div>}
      {x?.steps.length ? <ol className="steps">{x.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
      {x?.warnings.map((w) => <div key={w} className="note warn">{w}</div>)}
    </div>
  );
}

function Summary({ d }: { d: BatchDetail }) {
  const tot = d.byCategory.reduce((s, c) => s + (c.co2e ?? 0), 0);
  const methods = Object.fromEntries(d.byMethod.map((m) => [m.method, m]));
  return (
    <div className="cols2">
      <div className="card"><h3>By Scope 3 category (ready + published)</h3>
        <table className="t compact"><thead><tr><th>Category</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th className="num">Share</th></tr></thead>
          <tbody>{d.byCategory.map((c) => <tr key={c.category}><td>{CAT_NAME[c.category] ?? c.category}</td><td className="num">{c.lines.toLocaleString('en')}</td><td className="num">{usd(c.usd)}</td><td className="num">{tco2e(c.co2e ?? 0)}</td><td className="num">{tot ? `${Math.round(100 * (c.co2e ?? 0) / tot)}%` : '—'}</td></tr>)}</tbody></table></div>
      <div className="card"><h3>Data quality: method</h3>
        <table className="t compact"><tbody>
          <tr><td>Supplier-specific factor</td><td className="num">{(methods.supplier?.lines ?? 0).toLocaleString('en')} lines</td><td className="num">{tco2e(methods.supplier?.co2e ?? 0)} t</td></tr>
          <tr><td>Spend-based (average)</td><td className="num">{(methods.spend?.lines ?? 0).toLocaleString('en')} lines</td><td className="num">{tco2e(methods.spend?.co2e ?? 0)} t</td></tr>
        </tbody></table>
        <p className="sub">GHG Protocol: supplier-specific data is more accurate than spend-based averages. Ask large suppliers for their factors (Suppliers page).</p></div>
    </div>
  );
}
