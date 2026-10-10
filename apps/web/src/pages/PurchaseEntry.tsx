/**
 * Add data → Purchases: upload an Excel / CSV export (any layout, any size — the same
 * upload as Capture → Purchases, with this page's facility for lines that name none), or
 * type a few purchases by hand.
 * Each row: date, description, spend category (suggested as you type), amount and
 * currency, supplier and — when the supplier gave one — its own factor. "Check" calculates
 * without saving; "Save" publishes the rows as entries when all are complete.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, download, num, tco2e, type Category, type ManualLine, type ManualResult, type CapitalItem, type PurchaseMeta, type UploadResult } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { Icon } from '../components/Icon';
import { PublishedLinesView } from './PublishedPurchases';
import { BatchList, ColumnSetup, FactorBanner, TARGETS, UploadBox } from './Purchases';

interface Row extends ManualLine { itemName: string | null; cands: { itemId: number; name: string }[] }
const blank = (date: string, currency: string): Row => ({ date, description: '', itemId: null, itemName: null, cands: [], target: 'purchased_goods', amount: null, currency, supplier: '', supplierEf: null, supplierEfUnit: null, quantity: null, unit: null });

export function PurchaseEntry(props: { cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void }) {
  const [mode, setMode] = useState<'upload' | 'hand' | 'published' | 'capital'>('upload');
  const [meta, setMeta] = useState<PurchaseMeta | null>(null);
  const [up, setUp] = useState<UploadResult | null>(null);
  const nav = useNavigate();
  useEffect(() => { api.purchaseMeta().then(setMeta).catch(() => {}); }, []);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FactorBanner meta={meta} />
      <div className="row" style={{ gap: 10 }}>
        <div className="seg" role="group" aria-label="How to add purchases">
          <button className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}><Icon name="upload" /> Upload Excel / CSV</button>
          <button className={mode === 'hand' ? 'on' : ''} onClick={() => setMode('hand')}><Icon name="edit" /> Type by hand</button>
          <button className={mode === 'published' ? 'on' : ''} onClick={() => setMode('published')}>Published lines</button>
          <button className={mode === 'capital' ? 'on' : ''} onClick={() => setMode('capital')}>Capital goods list</button>
        </div>
        <span className="sub grow">{mode === 'upload' ? <>An export from the ERP or finance system, any layout, up to 200,000 lines; <button className="link" onClick={() => download('/api/purchases/template', 'Ekotrace purchases template.xlsx')}>template</button>.</> : mode === 'hand' ? 'For a few purchases; saved straight as entries.' : mode === 'published' ? 'Every published line, all batches: filter, open, download.' : 'Products counted as capital goods (Scope 3.2) when a purchase is matched to them.'}</span>
      </div>
      {mode === 'upload' && !up && <UploadBox onUploaded={setUp} />}
      {mode === 'upload' && up && meta && <ColumnSetup meta={meta} up={up} defaultFacility={props.facilityId}
        onCancel={() => { api.deleteBatch(up.batchId).catch(() => {}); setUp(null); }} onStarted={(id) => nav(`/purchases/${id}`)} />}
      {mode === 'hand' && <ManualGrid {...props} />}
      {mode === 'published' && <PublishedLinesView />}
      {mode === 'capital' && <CapitalList />}
      {(mode === 'upload' || mode === 'hand') && <BatchList title="Batches" />}
    </div>
  );
}

function ManualGrid({ facilityId, period, onSaved }: { cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void }) {
  const { toast } = useApp();
  const [currency, setCurrency] = useState('AED');
  const [rows, setRows] = useState<Row[]>(() => [blank(period.periodStart, 'AED')]);
  const [res, setRes] = useState<ManualResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [own, setOwn] = useState<number | null>(null);
  useEffect(() => { api.purchaseMeta().then((m) => { setCurrency(m.currency); setRows((r) => r.map((x) => ({ ...x, currency: x.currency || m.currency }))); }).catch(() => {}); }, []);
  useEffect(() => { setRows((r) => r.map((x) => (x.date && x.date >= period.periodStart && x.date <= period.periodEnd ? x : { ...x, date: period.periodStart }))); }, [period.periodStart, period.periodEnd]);
  const set = (i: number, p: Partial<Row>) => { setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x))); setRes(null); };
  // suggestions from the description, once typed
  const suggest = async (i: number, text: string) => {
    if (text.trim().length < 3) return;
    try { const r = await api.spendItems(text, 5); set(i, { cands: r.items.map((x) => ({ itemId: x.id, name: x.name })), ...(rows[i]!.itemId ? {} : r.items[0] ? { itemId: r.items[0].id, itemName: r.items[0].name } : {}) }); } catch { /* ignore */ }
  };
  const send = async (dryRun: boolean) => {
    setErr(null); setBusy(true);
    try {
      const lines = rows.filter((r) => r.description.trim()).map(({ itemName: _n, cands: _c, ...r }) => ({ ...r, supplier: r.supplier || null, quantity: r.quantity ?? null, unit: r.unit || null,
        supplierEf: r.supplierEf ?? null, supplierEfUnit: r.supplierEf != null ? r.supplierEfUnit || (r.unit || currency) : null }));
      const r = await api.manualPurchases({ facilityId, dryRun, lines });
      setRes(r);
      if (r.saved) { toast(`Saved: ${r.entries} entr${r.entries === 1 ? 'y' : 'ies'}, ${tco2e(r.co2e ?? 0)} tCO₂e`); setRows([blank(period.periodStart, currency)]); setRes(null); onSaved(); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const total = res?.lines.reduce((s, l) => s + (l.co2e ?? 0), 0) ?? 0;

  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div className="row"><div className="grow"><h3>Purchases typed by hand</h3>
        <div className="sub">For a few purchases, at the facility chosen above. Larger volumes: upload a file, or connect the ERP through the API.</div></div></div>
      <div className="scrollx"><table className="t compact entrygrid">
        <thead><tr><th>Date</th><th style={{ minWidth: 220 }}>Description</th><th style={{ minWidth: 240 }}>Spend category</th><th>Scope 3</th><th className="num">Amount</th><th>Cur.</th><th>Supplier</th><th>Supplier factor</th><th className="num">kg CO₂e</th><th /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const out = res?.lines[i];
          return (
            <tr key={i}>
              <td><input className="input sm" type="date" value={r.date} min={period.periodStart} max={period.periodEnd} onChange={(e) => set(i, { date: e.target.value })} /></td>
              <td><input className="input sm" value={r.description} placeholder="e.g. Office chairs" onChange={(e) => set(i, { description: e.target.value })} onBlur={(e) => suggest(i, e.target.value)} /></td>
              <td><ItemPicker value={r.itemId} valueName={r.itemName} candidates={r.cands} compact onPick={(it) => set(i, { itemId: it?.id ?? null, itemName: it?.name ?? null })} /></td>
              <td><select className="input sm" style={{ width: 150 }} value={r.target} onChange={(e) => set(i, { target: e.target.value })}><option value="purchased_goods">3.1 Purchased</option>{TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td><input className="input sm num" type="number" step="any" value={r.amount ?? ''} onChange={(e) => set(i, { amount: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 110 }} /></td>
              <td><input className="input sm" value={r.currency} maxLength={3} onChange={(e) => set(i, { currency: e.target.value.toUpperCase() })} style={{ width: 56 }} /></td>
              <td><input className="input sm" style={{ width: 150 }} value={r.supplier ?? ''} onChange={(e) => set(i, { supplier: e.target.value })} /></td>
              <td>{own === i || r.supplierEf != null ? (
                <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <input className="input sm" type="number" step="any" placeholder="kg CO₂e" value={r.supplierEf ?? ''} onChange={(e) => set(i, { supplierEf: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 80 }} />
                  <span className="muted small">per</span>
                  <select className="input sm" value={r.supplierEfUnit ?? r.currency} onChange={(e) => { const u = e.target.value; set(i, { supplierEfUnit: u, ...(/^[A-Z]{3}$/.test(u) ? { unit: null, quantity: null } : { unit: u }) }); }}>
                    {[r.currency, 'kg', 't', 'L', 'm3', 'kWh', 'pcs'].map((u) => <option key={u}>{u}</option>)}</select>
                  {r.supplierEfUnit && !/^[A-Z]{3}$/.test(r.supplierEfUnit) && <input className="input sm" type="number" step="any" placeholder={`qty ${r.supplierEfUnit}`} value={r.quantity ?? ''} onChange={(e) => set(i, { quantity: e.target.value === '' ? null : Number(e.target.value), unit: r.supplierEfUnit })} style={{ width: 80 }} />}
                </span>) : <button className="link small" onClick={() => setOwn(i)}>add</button>}</td>
              <td className="num">{out ? (out.co2e != null ? num(out.co2e, 4) : <span className={`chip ${out.status === 'problem' ? 'bad' : 'warn'}`} title={[...out.problems, out.calc_error].filter(Boolean).join('; ')}>{out.status === 'unmapped' ? 'choose category' : out.problems[0] ?? out.calc_error ?? out.status}</span>) : ''}</td>
              <td>{rows.length > 1 && <button className="btn ghost sm" aria-label="Remove row" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}><Icon name="x" /></button>}</td>
            </tr>);
        })}</tbody>
      </table></div>
      <div className="row"><button className="btn sm" onClick={() => setRows((r) => [...r, blank(r[r.length - 1]?.date ?? period.periodStart, currency)])}><Icon name="plus" />Row</button>
        <div className="grow" />{res && <span className="sub">Total {tco2e(total)} tCO₂e</span>}</div>
      {res?.lines.some((l) => l.steps.length) && (
        <details><summary className="small">How each row was calculated</summary>
          {res.lines.map((l, i) => l.steps.length ? <div key={i} className="small" style={{ margin: '6px 0' }}><b>{rows[i]?.description}</b>{l.factor && <span className="muted"> · {l.factor.source}</span>}<ol className="steps">{l.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>{l.warnings.map((w) => <div key={w} className="note warn">{w}</div>)}</div> : null)}
        </details>
      )}
      {res && !res.allReady && <div className="note warn">Complete the rows marked in the last column, then save.</div>}
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" disabled={busy || !rows.some((r) => r.description.trim())} onClick={() => send(true)}>Check</button>
        <button className="btn p" disabled={busy || !facilityId || !rows.some((r) => r.description.trim())} onClick={() => send(false)}>Save</button>
      </div>
    </div>
  );
}

/** The capital-goods list: products matched to purchases count as capital goods (3.2) when marked. */
function CapitalList() {
  const { role, toast } = useApp();
  const [items, setItems] = useState<CapitalItem[] | null>(null);
  const [show, setShow] = useState<'all' | 'capital' | 'not'>('all');
  const [q, setQ] = useState('');
  useEffect(() => { api.capitalList().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  const edit = role === 'platform_admin';
  const flip = async (it: CapitalItem) => {
    try { await api.setCapital(it.id, !it.capital); setItems((l) => l!.map((x) => (x.id === it.id ? { ...x, capital: !it.capital, note: it.capital ? 'Marked not capital by the platform administrator' : null } : x))); toast(`${it.name}: ${it.capital ? 'not capital' : 'capital good'}`); }
    catch (e) { toast((e as Error).message); }
  };
  if (!items) return <div className="card muted">Loading…</div>;
  const ql = q.trim().toLowerCase();
  const rows = items.filter((i) => (show === 'all' || (show === 'capital') === i.capital) && (!ql || `${i.name} ${i.group} ${i.naics}`.toLowerCase().includes(ql)));
  const groups = [...new Set(rows.map((r) => r.group ?? 'Other'))];
  const nCap = items.filter((i) => i.capital).length;
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="grow"><h3>Capital goods list</h3>
          <div className="sub">{nCap} products count as capital goods: machinery, vehicles, IT and electrical equipment, buildings and construction. {items.length - nCap} products of the old list are parts, materials or consumables and count as purchased goods. An account marked “capital” on a batch's Accounts tab still makes its purchases capital goods.</div></div>
        <div className="seg">{(['all', 'capital', 'not'] as const).map((k) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{k === 'all' ? 'All' : k === 'capital' ? 'Capital' : 'Not capital'}</button>)}</div>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
      </div>
      <div className="scrollx"><table className="t compact">
        <thead><tr><th>Product</th><th>NAICS</th><th className="num">kg CO₂e / USD</th><th>Counts as</th>{edit && <th />}</tr></thead>
        <tbody>{groups.map((g) => [
          <tr key={g} className="sectionrow"><td colSpan={edit ? 5 : 4}><b>{g}</b></td></tr>,
          ...rows.filter((r) => (r.group ?? 'Other') === g).map((r) => (
            <tr key={r.id}><td>{r.name}</td><td className="muted">{r.naics}</td><td className="num">{r.factor != null ? r.factor.toFixed(3) : '—'}</td>
              <td>{r.capital ? <span className="chip">Capital good (3.2)</span> : <span title={r.note ?? ''}><span className="chip grey">Purchased goods (3.1)</span> <span className="muted" style={{ fontSize: 12 }}>{r.note}</span></span>}</td>
              {edit && <td><button className="btn ghost sm" onClick={() => flip(r)}>{r.capital ? 'Not capital' : 'Capital'}</button></td>}</tr>)),
        ])}</tbody>
      </table></div>
      {!edit && <div className="sub">The list is shared by all companies; the platform administrator keeps it.</div>}
    </div>
  );
}
