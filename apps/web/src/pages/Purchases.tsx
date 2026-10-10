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
import { ApiError, api, download, num, tco2e, type BatchDetail, type Columns, type Facility, type LineStatus, type PurchaseBatch, type PurchaseField, type PurchaseGroup, type PurchaseLine, type PurchaseMeta, type UploadResult, type PurchaseAccount } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { Icon } from '../components/Icon';

const ENTER = ['super_admin', 'admin', 'manager', 'preparer'];
const BATCH_STATUS: Record<string, [string, string]> = {
  setup: ['Choose columns', 'warn'], receiving: ['Receiving from API', 'info'], queued: ['Waiting', 'info'], reading: ['Reading file', 'info'], mapping: ['Mapping', 'info'],
  review: ['To review', 'warn'], publishing: ['Publishing', 'info'], published: ['Published', ''], failed: ['Failed', 'bad'],
};
const LINE_STATUS: Record<LineStatus, [string, string]> = {
  new: ['new', 'grey'], problem: ['problem', 'bad'], unmapped: ['no category', 'warn'], flagged: ['other category?', 'warn'], check: ['to confirm', 'warn'], excluded: ['excluded', 'grey'], ready: ['ready', 'info'], published: ['published', ''],
};
const SOURCE: Record<string, string> = { upload: 'File', manual: 'Entered', api: 'ERP API' };
const METHOD: Record<string, string> = { rule: 'remembered', text: 'description', ai: 'AI', manual: 'by hand', code: 'code in file', supplier: 'supplier default', gl: 'account default', category: 'category default', fallback: 'average factor (estimate)' };
export const TARGETS: [string, string][] = [['business_travel', 'Business travel (3.6)'], ['upstream_transport', 'Upstream transport (3.4)'], ['upstream_leased', 'Upstream leased assets (3.8)'], ['capital_goods', 'Capital goods (3.2)']];
const CAT_NAME: Record<string, string> = { purchased_goods: 'Purchased goods & services (3.1)', capital_goods: 'Capital goods (3.2)', upstream_transport: 'Upstream transport (3.4)', business_travel: 'Business travel (3.6)', upstream_leased: 'Upstream leased assets (3.8)' };
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${Math.round(v).toLocaleString('en')}`);
const running = (s: string) => ['queued', 'reading', 'mapping', 'publishing'].includes(s);

export function FactorBanner({ meta }: { meta: PurchaseMeta | null }) {
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
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [rev, setRev] = useState(0);
  const canEnter = ENTER.includes(role);
  useEffect(() => { api.purchaseMeta().then(setMeta); }, []);
  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Capture · Scope 3.1</div><h1>Purchases</h1>
          <p className="sub">All purchase batches (uploads, ERP API, entered by hand). Upload and enter purchases under Add data → Purchases.</p></div>
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          {canEnter && <Link className="btn" to="/data/purchased_goods"><Icon name="plus" />Add purchases</Link>}
        </div>
      </div>
      <FactorBanner meta={meta} />
      {canEnter && !upload && <UploadBox onUploaded={setUpload} />}
      {upload && meta && <ColumnSetup meta={meta} up={upload} onCancel={() => { api.deleteBatch(upload.batchId).catch(() => {}); setUpload(null); setRev((r) => r + 1); }} onStarted={(id) => { setUpload(null); nav(`/purchases/${id}`); }} />}
      <BatchList key={rev} />
    </div>
  );
}

/** Every purchase batch with its state; follows running ones. */
export function BatchList({ title }: { title?: string }) {
  const nav = useNavigate();
  const [batches, setBatches] = useState<PurchaseBatch[] | null>(null);
  const load = () => api.purchaseBatches().then((r) => setBatches(r.batches));
  useEffect(() => { load(); }, []);
  useEffect(() => { // follow running batches
    if (!batches?.some((b) => running(b.status))) return;
    const t = window.setTimeout(load, 1500);
    return () => window.clearTimeout(t);
  }, [batches]);
  return (
    <div className="card flush">
      {title && <div style={{ padding: '14px 16px 4px' }}><h3>{title}</h3></div>}
      {batches === null ? <div className="empty">Loading…</div> : batches.length ? (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Batch</th><th>Source</th><th>State</th><th className="num">Lines</th><th className="num">To confirm / fix</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th>Added</th></tr></thead>
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
        </table></div>
      ) : <div className="empty">No purchases yet. Upload an export from your ERP, download the template, or enter purchases by hand.</div>}
    </div>
  );
}

export function UploadBox({ onUploaded }: { onUploaded: (u: UploadResult) => void }) {
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
export function ColumnSetup({ meta, up, onCancel, onStarted, defaultFacility }: { meta: PurchaseMeta; up: UploadResult; onCancel: () => void; onStarted: (id: string) => void; defaultFacility?: string }) {
  const [sheetIx, setSheetIx] = useState(() => Math.max(0, up.sheets.findIndex((s) => s.profile)) || 0);
  const sheet = up.sheets[sheetIx]!;
  const [headerRow, setHeaderRow] = useState(sheet.profile?.settings.headerRow ?? sheet.headerRow);
  const headers = useMemo(() => (sheet.rows[headerRow] ?? []).map((h) => h.trim()), [sheet, headerRow]);
  const [cols, setCols] = useState<Columns>(sheet.profile?.settings.columns ?? sheet.guess);
  const [dateFormat, setDateFormat] = useState<'dmy' | 'mdy' | 'ymd'>(sheet.profile?.settings.dateFormat ?? 'dmy');
  const [currency, setCurrency] = useState(sheet.profile?.settings.currency ?? up.defaultCurrency);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [facilityId, setFacilityId] = useState(sheet.profile?.settings.facilityId ?? defaultFacility ?? '');
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
        sheet: sheet.name === 'CSV' ? undefined : sheet.name, headerRow, columns: cols, dateFormat, currency, facilityId: facilityId || null,
        period: cols.date ? null : { year: Number(year) }, name, remember, headers,
      });
      onStarted(r.batchId);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const FIELD_ORDER: PurchaseField[] = ['date', 'amount', 'currency', 'supplier', 'supplierRef', 'supplierCountry', 'category', 'gl', 'facility', 'quantity', 'unit', 'po', 'supplierEf', 'supplierEfUnit', 'capital'];
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
        <label className="field" style={{ minWidth: 280 }}><span>{cols.facility ? 'Lines with no facility written go to' : 'No facility column: facility of the whole file *'}</span><select className="input" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
          <option value="">{cols.facility ? '— decide later, in the review —' : '— choose —'}</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.parent_name ? `${f.parent_name} › ` : ''}{f.name}</option>)}</select></label>
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember this layout</label>
      </div>
      <div className="scrollx"><table className="t compact">
        <thead><tr><th>Description</th><th>Date</th><th className="num">Amount</th><th>Currency</th><th>Supplier</th><th>Category / GL</th><th>Facility</th></tr></thead>
        <tbody>{sample.map((r, i) => (
          <tr key={i}><td>{desc.map((h) => r[idx(h)]).filter(Boolean).join(' — ') || <span className="bad">—</span>}</td><td>{r[idx(cols.date as string)] ?? (cols.date ? '' : year)}</td>
            <td className="num">{r[idx(cols.amount as string)] ?? ''}</td><td>{r[idx(cols.currency as string)] || currency}</td><td>{r[idx(cols.supplier as string)] ?? ''}</td>
            <td>{[r[idx(cols.category as string)], r[idx(cols.gl as string)]].filter(Boolean).join(' · ')}</td><td>{(cols.facility && r[idx(cols.facility as string)]) || <span className={facilityId ? '' : 'bad'}>{facilities.find((f) => f.id === facilityId)?.name ?? 'no facility'}</span>}</td></tr>))}</tbody>
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
  const [tab, setTab] = useState<'groups' | 'lines' | 'summary' | 'accounts'>('groups');
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
  const G = d.groups;
  const pct = (v: number) => (G.co2e ? Math.round((100 * v) / G.co2e) : 0);
  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow"><Link to="/data/purchased_goods">Purchases</Link> · {SOURCE[b.source]}{b.file ? ` · ${b.file.filename}` : ''}{b.external_ref ? ` · ref ${b.external_ref}` : ''}</div>
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

      {!busy && G.total > 0 && (
        <div className="card review" style={{ display: 'grid', gap: 8 }}>
          <div className="row"><h3 className="grow">Review by impact</h3>
            <span className="muted small">the largest kinds of purchase, up to</span>
            {role === 'super_admin' && canEnter ? <select className="input sm" style={{ width: 'auto' }} value={String(G.coverage)} title="Company setting"
              onChange={(e) => act(async () => { await api.purchaseSettings({ reviewCoverage: Number(e.target.value) }); await api.recalcBatch(id!); }, 'Review coverage changed')}>
              {[0.8, 0.9, 0.95, 0.98, 1].map((v) => <option key={v} value={String(v)}>{Math.round(v * 100)}%</option>)}</select> : <b className="small">{Math.round(G.coverage * 100)}%</b>}
            <span className="muted small">of the batch's emissions, need a person; the small rest is accepted as it is</span></div>
          <div className="revbar" role="img" aria-label="Review coverage">
            <span className="c" style={{ flex: Math.max(0.001, G.co2e_confirmed) }} title="Large groups confirmed" />
            <span className="t" style={{ flex: Math.max(0.001, G.co2e_material - G.co2e_confirmed) }} title="Large groups to confirm" />
            <span className="a" style={{ flex: Math.max(0.001, G.co2e_auto) }} title="Small groups, accepted as they are" />
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--primary)' }} />Confirmed: {G.material_confirmed} of {G.material} large groups · {pct(G.co2e_confirmed)}% of emissions</span>
            <span><i style={{ background: 'var(--s3)' }} />To confirm: {G.check} groups · {pct(G.co2e_material - G.co2e_confirmed)}%</span>
            <span><i style={{ background: 'var(--line2)' }} />Accepted as they are: {G.auto.toLocaleString('en')} small groups · {pct(G.co2e_auto)}%</span>
            {G.fallback > 0 && <span className="muted">{G.fallback} groups use an average factor (estimate)</span>}
          </div>
        </div>
      )}
      <div className="stats">
        <div className={`stat ${count('check') ? 'warnb' : ''}`}><div className="lbl">To confirm</div><div className="v">{count('check').toLocaleString('en')}</div><div className="muted small">lines in {G.check} large groups · {tco2e(co2('check'))} tCO₂e</div></div>
        <div className="stat"><div className="lbl">Ready to publish</div><div className="v">{count('ready').toLocaleString('en')}</div><div className="muted small">{tco2e(co2('ready'))} tCO₂e</div></div>
        <div className="stat s3"><div className="lbl">Published</div><div className="v">{count('published').toLocaleString('en')}</div><div className="muted small">{tco2e(co2('published'))} tCO₂e{count('published') > 0 && <> · <Link to={`/purchases/published?batch=${id}`}>open lines</Link></>}</div></div>
        <div className={`stat ${attention ? 'warnb' : ''}`}><div className="lbl">Problems</div><div className="v">{attention.toLocaleString('en')}</div>
          <div className="muted small">{count('problem')} to fix{count('unmapped') ? ` · ${count('unmapped')} no category` : ''}{count('flagged') ? ` · ${count('flagged')} other category?` : ''}</div></div>
        <div className="stat"><div className="lbl">Excluded</div><div className="v">{count('excluded').toLocaleString('en')}</div><div className="muted small">already counted elsewhere, or not a purchase</div></div>
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
        <button className={tab === 'groups' ? 'on' : ''} onClick={() => setTab('groups')}>Purchases ({d.groups.total.toLocaleString('en')} kinds)</button>
        <button className={tab === 'accounts' ? 'on' : ''} onClick={() => setTab('accounts')}>Accounts</button>
        <button className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>Lines ({total.toLocaleString('en')})</button>
        <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Summary</button>
      </div>
      {tab === 'groups' && <Groups key={rev} batchId={id!} d={d} canEdit={canEnter && !busy} onChanged={refresh} />}
      {tab === 'lines' && <Lines key={rev} batchId={id!} />}
      {tab === 'accounts' && <Accounts key={rev} batchId={id!} canEdit={canEnter && !busy} onChanged={refresh} />}
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
  ['check', 'To confirm', (d) => d.groups.check], ['all', 'All', (d) => d.groups.total], ['flagged', 'Other category', (d) => d.groups.flagged], ['capital', 'Capital goods', (d) => d.groups.capital_hint],
  ['excluded', 'Excluded', (d) => d.groups.excluded], ['fallback', 'Average factor', (d) => d.groups.fallback], ['auto', 'Small, accepted', (d) => d.groups.auto], ['unmapped', 'No category', (d) => d.groups.unmapped || null],
];

function Groups({ batchId, d, canEdit, onChanged }: { batchId: string; d: BatchDetail; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const [filter, setFilter] = useState(d.groups.check ? 'check' : d.groups.unmapped ? 'unmapped' : 'all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('co2e');
  const [scope, setScope] = useState<'text' | 'supplier' | 'gl'>('text');
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
    try { const r = await api.patchGroups(batchId, { keys, remember, scope, ...b }); toast(r.background ? `${r.lines.toLocaleString('en')} lines: recalculating in the background` : `${r.groups} group${r.groups === 1 ? '' : 's'} · ${r.lines.toLocaleString('en')} lines updated`); setSel(new Set()); load(); onChanged(); }
    catch (e) { setErr((e as Error).message); }
  };
  const all = rows?.length ? rows.every((r) => sel.has(r.key)) : false;

  return (
    <div className="card flush">
      <div className="row" style={{ padding: 12, gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(([k, l, n]) => { const c = n(d); return <button key={k} className={`btn sm ${filter === k ? 'p' : ''}`} onClick={() => setFilter(k)}>{l}{c != null ? ` (${c.toLocaleString('en')})` : ''}</button>; })}
        <div className="grow" />
        {canEdit && filter === 'check' && !!rows?.length && <button className="btn sm p" title="The categories and decisions shown on this page are right" onClick={() => patch(rows.map((r) => r.key), { confirm: true })}>Confirm these {rows.length}</button>}
        <input className="input sm" type="search" placeholder="Search description, category, supplier…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <select className="input sm" value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto' }}><option value="co2e">by emissions</option><option value="spend">by spend</option><option value="lines">by lines</option><option value="confidence">least sure first</option><option value="name">A–Z</option></select>
      </div>
      {canEdit && sel.size > 0 && (
        <div className="bulkbar">
          <b>{sel.size} selected</b>
          <ItemPicker value={null} compact placeholder="Set category for all selected…" onPick={(it) => it && patch([...sel], { itemId: it.id })} />
          <button className="btn sm" onClick={() => patch([...sel], { decision: 'keep' })}>Keep in 3.1</button>
          <select className="input sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ width: 'auto' }}>{TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <button className="btn sm" onClick={() => patch([...sel], moveTo === 'capital_goods' ? { capital: true, decision: 'keep' } : { decision: 'move', target: moveTo })}>Move</button>
          <button className="btn sm" onClick={() => patch([...sel], { decision: 'exclude' })}>Exclude</button>
          <button className="btn sm p" onClick={() => patch([...sel], { confirm: true })}>Confirm as shown</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      {err && <div className="note bad" style={{ margin: 12 }}>{err}</div>}
      {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">Nothing here.</div> : (
        <div className="scrollx"><table className="t groups">
          <thead><tr>{canEdit && <th style={{ width: 28 }}><input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.key)))} /></th>}
            <th>Purchase</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th style={{ minWidth: 280 }}>Spend category</th><th style={{ minWidth: 220 }}>Scope 3 category</th><th className="num">tCO₂e</th><th /></tr></thead>
          <tbody>{rows.map((g) => (
            <Fragment key={g.key}>
              <tr className={sel.has(g.key) ? 'sel' : ''}>
                {canEdit && <td><input type="checkbox" checked={sel.has(g.key)} onChange={() => setSel((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })} /></td>}
                <td style={{ maxWidth: 380 }}><b>{g.description}</b>
                  <div className="muted small">{[g.supplier, g.gl_account && `account ${g.gl_account}`, g.category_text].filter(Boolean).join(' · ')}</div>
                  {g.statuses && (g.statuses.problem ?? 0) > 0 && <span className="chip bad">{g.statuses.problem} with problems</span>}
                </td>
                <td className="num"><button className="link" onClick={() => setLineOf(lineOf === g.key ? null : g.key)}>{g.lines.toLocaleString('en')}</button></td>
                <td className="num">{usd(g.usd)}</td>
                <td>
                  {canEdit ? <ItemPicker value={g.item_id} valueName={g.item_name} candidates={g.candidates} onPick={(it) => patch([g.key], { itemId: it?.id ?? null })} /> : (g.item_name ?? <span className="muted">—</span>)}
                  <div className="row" style={{ gap: 4, marginTop: 3 }}>
                    {g.map_method && <span className={`chip ${g.map_method === 'fallback' ? 'warn' : 'grey'}`}>{METHOD[g.map_method]}</span>}
                    {g.confidence != null && g.map_method === 'text' && <span className={`chip ${g.confidence >= 0.6 ? '' : 'warn'}`}>{Math.round(g.confidence * 100)}% sure</span>}
                    {g.naics && <span className="muted small">NAICS {g.naics}</span>}
                  </div>
                </td>
                <td>
                  {g.overlap && !(g.overlap === 'capital_goods' && g.capital) && <div className={`chip ${g.decision ? 'grey' : 'warn'}`} title={g.overlap_why ?? ''}>{d.batch && (CAT_NAME[g.overlap] ?? OVERLAP_TEXT[g.overlap] ?? g.overlap)}?</div>}
                  {g.decision === 'move' && <div className="small">→ moved to {CAT_NAME[g.target ?? ''] ?? g.target}</div>}
                  {g.decision === 'exclude' && <div className="small">{g.overlap === 'not_purchase' ? 'not a purchase: left out' : 'excluded (counted elsewhere)'}</div>}
                  {g.capital && <div className="small">→ capital goods (3.2){g.capital_why ? <span className="muted"> · {g.capital_why}</span> : null}</div>}
                  {!g.decision && !g.capital && !g.overlap && <div className="small muted">3.1 Purchased goods &amp; services</div>}
                  {canEdit && (g.overlap || g.decision || g.capital) && (
                    <div className="row" style={{ gap: 4, marginTop: 4 }}>
                      {g.overlap && g.overlap !== 'capital_goods' && !['fuel', 'energy', 'waste'].includes(g.overlap) && g.decision !== 'move' && <button className="btn xs" onClick={() => patch([g.key], { decision: 'move', target: g.overlap })}>Move</button>}
                      {g.overlap === 'capital_goods' && !g.capital && <button className="btn xs" onClick={() => patch([g.key], { capital: true, decision: 'keep' })}>Capital goods</button>}
                      {g.decision !== 'keep' && !g.capital && <button className="btn xs" onClick={() => patch([g.key], { decision: 'keep' })}>Keep in 3.1</button>}
                      {(g.decision && g.decision !== 'keep' || g.capital) && <button className="btn xs" onClick={() => patch([g.key], { decision: 'keep', capital: false })}>Back to 3.1</button>}
                      {g.decision !== 'exclude' && g.overlap !== 'capital_goods' && <button className="btn xs" onClick={() => patch([g.key], { decision: 'exclude' })}>Exclude</button>}
                    </div>
                  )}
                  {g.overlap_why && <div className="muted small">{g.overlap_why}</div>}
                </td>
                <td className="num">{g.co2e != null ? tco2e(g.co2e) : '—'}{g.batch_co2e && g.co2e ? <div className="muted small">{((100 * g.co2e) / g.batch_co2e).toFixed(g.co2e / g.batch_co2e < 0.01 ? 2 : 1)}%</div> : null}</td>
                <td>{g.material && !g.confirmed ? (canEdit ? <button className="btn xs p" onClick={() => patch([g.key], { confirm: true })} title="The category and decision shown are right">Confirm</button> : <span className="chip warn">to confirm</span>)
                  : g.confirmed ? <span className="chip" title="Settled by a person or a remembered choice">✓</span> : <span className="chip grey" title="Small: accepted as it is">small</span>}</td>
              </tr>
              {lineOf === g.key && <tr className="sub-row"><td colSpan={canEdit ? 8 : 7}><Lines batchId={batchId} group={g.key} compact /></td></tr>}
            </Fragment>
          ))}</tbody>
        </table></div>
      )}
      <div className="row" style={{ padding: 12 }}>
        {canEdit && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember my choices</label>}
        {canEdit && remember && <label className="row" style={{ gap: 6, fontSize: 13 }}>for
          <select className="input sm" value={scope} onChange={(e) => setScope(e.target.value as 'text')} style={{ width: 'auto' }}>
            <option value="text">this description</option><option value="supplier">everything from this supplier</option><option value="gl">everything in this account</option></select></label>}
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
const OVERLAP_TEXT: Record<string, string> = { fuel: 'Fuel (Scope 1 / 3.3)', energy: 'Electricity / water (Scope 2 / 3.3)', waste: 'Waste (3.5)', not_purchase: 'Not a purchase' };

const ACCOUNT_TYPES: [string, string][] = [['', 'Purchase (default)'], ['capital', 'Capital (Scope 3.2)'], ['not_purchase', 'Not a purchase (VAT, salaries…)']];
/** The accounts of a batch: their type and default category, remembered for every upload. */
function Accounts({ batchId, canEdit, onChanged }: { batchId: string; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<PurchaseAccount[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.purchaseAccounts(batchId).then((r) => setRows(r.accounts)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [batchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (a: PurchaseAccount, b: { accountType?: string | null; itemId?: number | null; target?: string | null }) => {
    setErr(null);
    try { const r = await api.setPurchaseAccount({ account: a.account, batchId, ...b }); toast(`Saved for every upload · ${r.lines.toLocaleString('en')} lines updated`); load(); onChanged(); }
    catch (e) { setErr((e as Error).message); }
  };
  if (!rows) return <div className="card empty">{err ?? 'Loading…'}</div>;
  if (!rows.length) return <div className="card empty">The file has no account (GL) column. Choose one when uploading to use account settings.</div>;
  return (
    <div className="card flush">
      <div style={{ padding: '14px 16px 4px' }}><h3>Accounts (GL)</h3>
        <p className="sub">Set once, used for every upload: the account's type decides capital goods and what is not a purchase; its default category is used for purchases whose description and supplier do not identify them; a Scope 3 category moves its lines (e.g. Travel → business travel).</p></div>
      {err && <div className="note bad" style={{ margin: 12 }}>{err}</div>}
      <div className="scrollx"><table className="t">
        <thead><tr><th>Account</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th>Type</th><th style={{ minWidth: 260 }}>Default spend category</th><th>Scope 3 category</th></tr></thead>
        <tbody>{rows.map((a) => (
          <tr key={a.account}>
            <td><b>{a.account}</b><div className="muted small">{a.groups} kinds of purchase{a.capital_groups ? ` · ${a.capital_groups} capital` : ''}</div></td>
            <td className="num">{a.lines.toLocaleString('en')}</td><td className="num">{usd(a.usd)}</td><td className="num">{a.co2e != null ? tco2e(a.co2e) : '—'}</td>
            <td><select className="input sm" disabled={!canEdit} value={a.accountType ?? ''} onChange={(e) => save(a, { accountType: e.target.value || null })} style={{ width: 'auto' }}>
              {ACCOUNT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td>{canEdit ? <ItemPicker value={a.itemId} valueName={a.item} compact placeholder="none (description decides)" onPick={(it) => save(a, { itemId: it?.id ?? null })} /> : a.item ?? <span className="muted">—</span>}</td>
            <td><select className="input sm" disabled={!canEdit || a.accountType === 'not_purchase'} value={a.target ?? ''} onChange={(e) => save(a, { target: e.target.value || null })} style={{ width: 'auto' }}>
              <option value="">as mapped (3.1 / 3.2)</option>{TARGETS.filter(([k]) => k !== 'capital_goods').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

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
          {[['', 'All'], ['check', 'To confirm'], ['problem', 'Problems'], ['unmapped', 'No category'], ['flagged', 'Other category?'], ['ready', 'Ready'], ['published', 'Published'], ['excluded', 'Excluded'], ['duplicate', 'Duplicates'], ['warning', 'With warnings']].map(([k, l]) =>
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
