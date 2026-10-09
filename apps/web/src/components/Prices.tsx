/**
 * Price list for spend-based entries (spend ÷ price = litres or kWh).
 * Platform admin: the shared list for every company. Super admin / Admin: the
 * company's own prices (contract or fuel-card prices), which win over the shared list.
 */
import { useEffect, useState } from 'react';
import { api, num, type Price } from '../lib/api';
import { Icon } from './Icon';

const month = () => new Date().toISOString().slice(0, 7);
const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };

export function Prices({ platform, canEdit = true }: { platform?: boolean; canEdit?: boolean }) {
  const [items, setItems] = useState<{ id: number; name: string; default_unit: string | null; sub: string }[]>([]);
  const [rows, setRows] = useState<Price[]>([]);
  const [f, setF] = useState({ itemId: 0, region: 'AE', currency: 'AED', price: '', unit: 'L', from: month(), to: month(), source: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.prices().then((r) => setRows(r.prices)).catch((e) => setErr(e.message));
  useEffect(() => { api.priceItems().then((r) => { setItems(r.items); const d = r.items.find((i) => /diesel \(100%/i.test(i.name)) ?? r.items[0]; if (d) setF((x) => ({ ...x, itemId: d.id, unit: d.default_unit ?? 'L' })); }); load(); }, []);
  const item = items.find((i) => i.id === f.itemId);
  const elec = item?.name.startsWith('Grid');
  const add = async () => {
    setErr(null);
    try {
      await api.addPrice({ itemId: f.itemId, region: f.region, currency: f.currency, price: Number(f.price), unit: elec ? 'kWh_e' : f.unit, validFrom: `${f.from}-01`, validTo: lastDay(f.to), source: f.source });
      setF({ ...f, price: '' }); load();
    } catch (e) { setErr((e as Error).message); }
  };
  const shown = rows.filter((r) => (platform ? r.platform : true));
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div><h2>{platform ? 'Fuel & electricity prices (shared list)' : 'Fuel & electricity prices'}</h2>
        <p className="sub">For entries by spend: amount ÷ price = litres (or kWh). {platform ? 'This list is used by every company unless it has its own price for the same month.' : "Your company's own prices (contract or fuel-card prices) are used before the shared list."} Each price applies to whole months.</p></div>
      {canEdit && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '2 1 240px' }}><span>Fuel</span>
            <select className="input" value={f.itemId} onChange={(e) => { const it = items.find((i) => i.id === Number(e.target.value)); setF({ ...f, itemId: Number(e.target.value), unit: it?.default_unit && !it.name.startsWith('Grid') ? it.default_unit : 'L' }); }}>
              {[...new Set(items.map((i) => i.sub))].map((g) => <optgroup key={g} label={g}>{items.filter((i) => i.sub === g).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</optgroup>)}
            </select></label>
          <label className="field" style={{ width: 80 }}><span>Country</span><input className="input mono" maxLength={2} value={f.region} onChange={(e) => setF({ ...f, region: e.target.value.toUpperCase() })} /></label>
          <label className="field" style={{ width: 120 }}><span>Price</span><input className="input num" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="field" style={{ width: 80 }}><span>Currency</span><input className="input mono" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></label>
          <label className="field" style={{ width: 100 }}><span>per</span>
            {elec ? <input className="input" value="kWh" disabled /> : (
              <select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
                <option value="L">litre</option><option value="gal_us">US gallon</option><option value="gal_uk">imperial gallon</option><option value="kg">kg</option><option value="m3">m³</option>
              </select>)}</label>
          <label className="field" style={{ width: 140 }}><span>From month</span><input className="input" type="month" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></label>
          <label className="field" style={{ width: 140 }}><span>To month</span><input className="input" type="month" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <label className="field" style={{ flex: '2 1 200px' }}><span>Source</span><input className="input" maxLength={200} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder={platform ? 'e.g. UAE Fuel Price Committee, Mar 2026' : 'e.g. ADNOC fuel card statement'} /></label>
          <button className="btn p" disabled={!f.itemId || !(Number(f.price) > 0) || f.region.length !== 2 || f.currency.length !== 3 || f.source.trim().length < 2} onClick={add}><Icon name="plus" />Add</button>
        </div>
      )}
      {err && <div className="note bad">{err}</div>}
      {shown.length ? (
        <div className="scroll" style={{ border: '1px solid var(--line)', borderRadius: 12, maxHeight: 420 }}>
          <table className="t">
            <thead><tr><th>Fuel</th><th>Country</th><th className="num">Price</th><th>Months</th><th>Source</th>{!platform && <th>List</th>}{canEdit && <th />}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td>{r.item}</td><td className="mono">{r.region}</td>
                <td className="num">{num(Number(r.price))} {r.currency}/{r.unit === 'kWh_e' ? 'kWh' : r.unit}</td>
                <td className="mono">{r.valid_from.slice(0, 7)}{r.valid_to.slice(0, 7) !== r.valid_from.slice(0, 7) ? ` → ${r.valid_to.slice(0, 7)}` : ''}</td>
                <td>{r.source}</td>
                {!platform && <td>{r.platform ? <span className="chip grey">shared</span> : <span className="chip">own</span>}</td>}
                {canEdit && <td>{(platform ? r.platform : !r.platform) && <button className="btn ghost sm" aria-label="Delete price" onClick={async () => { setErr(null); try { await api.deletePrice(r.id); load(); } catch (e) { setErr((e as Error).message); } }}><Icon name="x" /></button>}</td>}
              </tr>))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">No prices yet.</div>}
    </div>
  );
}
