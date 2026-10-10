/**
 * Add data → Purchases: a few purchases typed by hand (larger volumes: upload or ERP API).
 * Each row: date, description, spend category (suggested as you type), amount and
 * currency, supplier and — when the supplier gave one — its own factor. "Check" calculates
 * without saving; "Save" publishes the rows as entries when all are complete.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, tco2e, type Category, type ManualLine, type ManualResult } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { Icon } from '../components/Icon';
import { TARGETS } from './Purchases';

interface Row extends ManualLine { itemName: string | null; cands: { itemId: number; name: string }[] }
const blank = (date: string, currency: string): Row => ({ date, description: '', itemId: null, itemName: null, cands: [], target: 'purchased_goods', amount: null, currency, supplier: '', supplierEf: null, supplierEfUnit: null, quantity: null, unit: null });

export function PurchaseEntry({ facilityId, period, onSaved }: { cat: Category; facilityId: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void }) {
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
        <div className="sub">For a few purchases. Exports from the ERP or finance system go through <Link to="/purchases">Capture → Purchases</Link> (any layout, any size) or the ERP API.</div></div></div>
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
