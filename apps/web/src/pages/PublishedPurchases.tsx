/**
 * Published purchases, line by line. Entries are monthly sums; this opens any of them (or a
 * whole batch, a month, a facility, a supplier) down to the lines of the file. The server
 * pages and totals the selection, so 50,000 lines or more stay quick; the selection
 * downloads as Excel or CSV with every line's factor, exchange rate and result.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download, num, tco2e, type PublishedLines } from '../lib/api';

const KEYS = ['batch', 'activity', 'facility', 'supplier', 'item', 'category', 'year', 'month', 'estimate', 'q'] as const;
const PAGE = 100;

export function PublishedPurchasesPage() {
  return (
    <div className="page">
      <div className="head"><div>
        <div className="eyebrow">Capture · Purchases</div>
        <h1>Published purchase lines</h1>
        <p className="sub">The lines behind the purchase entries. Entries are monthly sums per facility and category; every line stays here with its spend category, factor, exchange rate and result.</p>
      </div></div>
      <PublishedLinesView />
    </div>
  );
}

export function PublishedLinesView({ fixed }: { fixed?: Record<string, string> }) {
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => {
    const o: Record<string, string> = { ...fixed };
    for (const k of KEYS) { const v = sp.get(k); if (v) o[k] = v; }
    return o;
  }, [sp, fixed]);
  const [sort, setSort] = useState<'co2e' | 'date' | 'usd'>('co2e');
  const [page, setPage] = useState(0);
  const [d, setD] = useState<PublishedLines | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(f.q ?? '');
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); setPage(0); };
  useEffect(() => {
    setErr(null);
    api.publishedLines({ ...f, sort, offset: String(page * PAGE), limit: String(PAGE) }).then(setD).catch((e) => setErr((e as Error).message));
  }, [f, sort, page]);
  useEffect(() => { const t = window.setTimeout(() => { if ((f.q ?? '') !== q) set('q', q.trim() || null); }, 400); return () => window.clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams(f).toString();
  const T = d?.total;
  const pages = T ? Math.ceil(T.lines / PAGE) : 0;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field"><span>Month</span>
            <select className="input" value={f.year && f.month ? `${f.year}-${f.month.padStart(2, '0')}` : f.year ?? ''} onChange={(e) => { const v = e.target.value; const n = new URLSearchParams(sp); n.delete('year'); n.delete('month'); if (v) { const [y, m] = v.split('-'); n.set('year', y!); if (m) n.set('month', String(Number(m))); } setSp(n, { replace: true }); setPage(0); }}>
              <option value="">All</option>
              {[...new Set((d?.options.months ?? []).map((m) => m.slice(0, 4)))].map((y) => <optgroup key={y} label={y}><option value={y}>{y}, whole year</option>{d!.options.months.filter((m) => m.startsWith(y)).map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>)}
            </select></label>
          <label className="field"><span>Facility</span>
            <select className="input" value={f.facility ?? ''} onChange={(e) => set('facility', e.target.value || null)}><option value="">All</option>{d?.options.facilities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className="field"><span>Scope 3 category</span>
            <select className="input" value={f.category ?? ''} onChange={(e) => set('category', e.target.value || null)}><option value="">All</option>{d?.options.categories.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label className="field" style={{ maxWidth: 260 }}><span>Spend category</span>
            <select className="input" value={f.item ?? ''} onChange={(e) => set('item', e.target.value || null)}><option value="">All (largest first)</option>{d?.options.items.map((o) => <option key={o.id} value={o.id}>{o.name} · {tco2e(o.co2e)} t</option>)}</select></label>
          <label className="field"><span>Factor</span>
            <select className="input" value={f.estimate ?? ''} onChange={(e) => set('estimate', e.target.value || null)}><option value="">All</option><option value="no">Matched category</option><option value="yes">Average factor (estimate)</option></select></label>
          <label className="field grow" style={{ minWidth: 180 }}><span>Search</span><input className="input" value={q} placeholder="Description, supplier, PO, account" onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        {(f.batch || f.activity || f.supplier) && <div className="row" style={{ gap: 6 }}>
          {f.batch && !fixed?.batch && <span className="chip info">One batch <button className="link" onClick={() => set('batch', null)}>×</button></span>}
          {f.activity && <span className="chip info">One entry <button className="link" onClick={() => set('activity', null)}>×</button></span>}
          {f.supplier && <span className="chip info">One supplier <button className="link" onClick={() => set('supplier', null)}>×</button></span>}
        </div>}
      </div>

      {err && <div className="note bad">{err}</div>}
      {T && <div className="stats">
        <div className="stat"><div className="lbl">Lines</div><div className="v">{T.lines.toLocaleString('en')}</div><div className="muted small">in {T.entries.toLocaleString('en')} entries</div></div>
        <div className="stat s3"><div className="lbl">Emissions</div><div className="v">{tco2e(T.co2e)}</div><div className="muted small">tCO₂e</div></div>
        <div className="stat"><div className="lbl">Spend</div><div className="v">{(T.usd / 1e6).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}M</div><div className="muted small">USD at the purchase-month rate</div></div>
        <div className="stat"><div className="lbl">Suppliers</div><div className="v">{T.suppliers.toLocaleString('en')}</div><div className="muted small">{T.estimated ? `${T.estimated.toLocaleString('en')} lines on an average factor` : 'all lines matched to a category'}</div></div>
      </div>}

      <div className="card flush">
        <div className="row" style={{ padding: '12px 16px', gap: 8, flexWrap: 'wrap' }}>
          <div className="seg">{([['co2e', 'Largest emissions'], ['usd', 'Largest spend'], ['date', 'Latest']] as const).map(([k, l]) => <button key={k} className={sort === k ? 'on' : ''} onClick={() => { setSort(k); setPage(0); }}>{l}</button>)}</div>
          <span className="grow" />
          <button className="btn sm" disabled={!T?.lines} onClick={() => download(`/api/purchases/published/export?${qs}`, 'Ekotrace published purchases.xlsx')}>Download Excel</button>
          <button className="btn sm ghost" disabled={!T?.lines} onClick={() => download(`/api/purchases/published/export?${qs}${qs ? '&' : ''}format=csv`, 'Ekotrace published purchases.csv')}>CSV</button>
        </div>
        {!d ? <div className="empty">Loading…</div> : !d.lines.length ? <div className="empty">No published lines for this selection.</div> : (
          <div className="scrollx"><table className="t compact">
            <thead><tr><th>Date</th><th>Facility</th><th style={{ minWidth: 220 }}>Description</th><th>Supplier</th><th className="num">Amount</th><th>Spend category</th><th className="num">kg CO₂e</th><th>Batch</th></tr></thead>
            <tbody>{d.lines.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{l.date ?? l.month}</td><td>{l.facility}</td>
                <td>{l.description}{l.gl_account && <div className="muted small">{l.gl_account}{l.po_ref ? ` · ${l.po_ref}` : ''}</div>}</td>
                <td>{l.supplier ?? '—'}</td>
                <td className="num nowrap">{(l.amount ?? 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {l.currency}</td>
                <td>{l.item}{l.estimate && <span className="chip warn" style={{ marginLeft: 6 }}>estimate</span>}<div className="muted small">{l.category}{l.method === 'supplier' ? ' · supplier factor' : ''}</div></td>
                <td className="num">{(l.co2e ?? 0).toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                <td><Link to={`/purchases/${l.batch_id}`} className="muted small" title={l.file ?? ''}>row {l.row_no}</Link></td>
              </tr>))}
            </tbody>
          </table></div>)}
        {pages > 1 && <div className="row" style={{ padding: '10px 16px', gap: 8 }}>
          <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted small">Lines {(page * PAGE + 1).toLocaleString('en')}–{Math.min((page + 1) * PAGE, T!.lines).toLocaleString('en')} of {T!.lines.toLocaleString('en')}</span>
          <button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
          <span className="muted small">· the download has all {T!.lines.toLocaleString('en')} lines</span>
        </div>}
      </div>
    </div>
  );
}
