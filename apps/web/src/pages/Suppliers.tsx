/**
 * Suppliers (Value chain): everyone the company buys from — registered automatically from
 * uploads and the ERP API, or added here — with spend, emissions and their own emission
 * factors. A supplier factor replaces the spend-based estimate for its lines.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, num, tco2e, type Supplier, type SupplierFactor2 } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { Icon } from '../components/Icon';

const MANAGE = ['super_admin', 'admin', 'manager'];
const UNITS = ['kg', 't', 'L', 'm3', 'kWh', 'pcs', 'AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR'];
const usd = (v: number) => `$${Math.round(v).toLocaleString('en')}`;

export function Suppliers() {
  const { role } = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const canManage = MANAGE.includes(role);
  const load = () => api.suppliers({ q, filter, offset, limit: 50 }).then((r) => { setRows(r.suppliers); setTotal(r.total); });
  useEffect(() => { const t = window.setTimeout(load, q ? 250 : 0); return () => window.clearTimeout(t); }, [q, filter, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Value chain</div><h1>Suppliers</h1>
          <p className="sub">Registered from purchase uploads and the ERP API (spellings such as “LLC” / “L.L.C.” are one supplier), or added here. A supplier's own emission factor — from an EPD, a product footprint or its own inventory — replaces the spend-based estimate for its purchases.</p></div>
        {canManage && <button className="btn p" style={{ alignSelf: 'flex-end' }} onClick={() => setAdding(true)}><Icon name="plus" />Add supplier</button>}
      </div>
      {adding && <AddSupplier onDone={(id) => { setAdding(false); load(); if (id) setOpen(id); }} />}
      <div className="card flush">
        <div className="row" style={{ padding: 12, gap: 6 }}>
          {[['all', 'All'], ['with_factor', 'With own factor'], ['without_factor', 'Spend-based only']].map(([k, l]) => <button key={k} className={`btn sm ${filter === k ? 'p' : ''}`} onClick={() => { setFilter(k!); setOffset(0); }}>{l}</button>)}
          <div className="grow" /><input className="input sm" type="search" placeholder="Search name or vendor number…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ width: 260 }} />
        </div>
        {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">No suppliers yet: they appear with the first purchase upload.</div> : (
          <table className="t">
            <thead><tr><th>Supplier</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th>Factor</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={`click ${open === s.id ? 'sel' : ''}`} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <td><b>{s.name}</b><div className="muted small">{[s.reference && `vendor ${s.reference}`, s.country, s.aliases.length ? `also: ${s.aliases.slice(0, 3).join(', ')}` : ''].filter(Boolean).join(' · ')}</div></td>
                <td className="num">{s.lines.toLocaleString('en')}</td><td className="num">{usd(s.usd)}</td><td className="num">{tco2e(s.co2e)}</td>
                <td>{s.factors ? <span className="chip">own factor{s.supplier_lines ? ` · ${s.supplier_lines.toLocaleString('en')} lines` : ''}</span> : <span className="chip grey">spend-based</span>}</td>
              </tr>))}</tbody>
          </table>
        )}
        {total > 50 && <div className="row" style={{ padding: 8, justifyContent: 'flex-end' }}><span className="muted small">{offset + 1}–{Math.min(total, offset + 50)} of {total.toLocaleString('en')}</span>
          <button className="btn sm" disabled={!offset} onClick={() => setOffset(offset - 50)}>‹</button><button className="btn sm" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}>›</button></div>}
      </div>
      {open && <SupplierPanel key={open} id={open} canManage={canManage} onChanged={load} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AddSupplier({ onDone }: { onDone: (id?: string) => void }) {
  const [f, setF] = useState({ name: '', country: '', reference: '', contactEmail: '' });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <h3>New supplier</h3>
      <div className="grid3">
        <label className="field"><span>Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Vendor number (ERP)</span><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        <label className="field"><span>Country (2 letters)</span><input className="input" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} /></label>
        <label className="field"><span>Sustainability contact e-mail</span><input className="input" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></label>
      </div>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => onDone()}>Cancel</button>
        <button className="btn p" disabled={!f.name.trim()} onClick={async () => { try { const r = await api.addSupplier(Object.fromEntries(Object.entries(f).filter(([, v]) => v))); onDone(r.id); } catch (e) { setErr((e as Error).message); } }}>Add</button></div>
    </div>
  );
}

function SupplierPanel({ id, canManage, onChanged, onClose }: { id: string; canManage: boolean; onChanged: () => void; onClose: () => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.supplier>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nf, setNf] = useState<{ itemId: number | null; itemName: string | null; co2e: string; unit: string; priceYear: string; source: string; boundary: string; validFrom: string; validTo: string } | null>(null);
  const [merge, setMerge] = useState('');
  const [cands, setCands] = useState<Supplier[]>([]);
  const load = () => api.supplier(id).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (merge.length < 2) { setCands([]); return; } const t = window.setTimeout(() => api.suppliers({ q: merge, limit: 8 }).then((r) => setCands(r.suppliers.filter((s) => s.id !== id))), 250); return () => window.clearTimeout(t); }, [merge, id]);
  if (!d) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const s = d.supplier;
  const money = nf && /^[A-Z]{3}$/.test(nf.unit);
  const save = async () => {
    if (!nf) return;
    try {
      const r = await api.addSupplierEf(id, { itemId: nf.itemId, co2e: Number(nf.co2e), unit: nf.unit, priceYear: money && nf.priceYear ? Number(nf.priceYear) : null, source: nf.source, boundary: nf.boundary || undefined,
        validFrom: nf.validFrom || undefined, validTo: nf.validTo || undefined });
      toast(`Factor saved · ${r.linesRecalculated.toLocaleString('en')} open lines recalculated`); setNf(null); load(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="row"><div className="grow"><div className="eyebrow">Supplier</div><h2>{s.name}</h2>
        <div className="sub">{[s.reference && `vendor ${s.reference}`, s.country, s.contact_email, `from ${s.origin}`].filter(Boolean).join(' · ')}</div></div>
        <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      {err && <div className="note bad">{err}</div>}
      <div className="cols2">
        <div><h3>Own emission factors</h3>
          {d.factors.length ? <table className="t compact"><thead><tr><th>Applies to</th><th className="num">kg CO₂e</th><th>per</th><th>Valid</th><th>Source</th><th /></tr></thead>
            <tbody>{d.factors.map((f: SupplierFactor2) => (
              <tr key={f.id}><td>{f.item ?? 'everything bought'}</td><td className="num">{num(f.co2e, 5)}</td><td>{f.unit}{f.price_year ? ` (${f.price_year})` : ''}</td><td className="small">{f.valid_from.slice(0, 4)}–{f.valid_to.slice(0, 4)}</td><td className="small">{f.source}{f.boundary ? ` · ${f.boundary}` : ''}</td>
                <td>{canManage && <button className="btn ghost sm" aria-label="Remove" onClick={async () => { try { await api.deleteSupplierEf(id, f.id); load(); onChanged(); } catch (e) { setErr((e as Error).message); } }}><Icon name="x" /></button>}</td></tr>))}</tbody></table>
            : <div className="sub">None: purchases from this supplier are spend-based.</div>}
          {canManage && !nf && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setNf({ itemId: null, itemName: null, co2e: '', unit: 'kg', priceYear: '', source: '', boundary: 'cradle-to-gate', validFrom: '', validTo: '' })}><Icon name="plus" />Add a factor</button>}
          {nf && (
            <fieldset className="box" style={{ marginTop: 8 }}><legend>New factor</legend>
              <div className="cols2">
                <label className="field"><span>For</span><ItemPicker value={nf.itemId} valueName={nf.itemName ?? 'everything bought from this supplier'} onPick={(it) => setNf({ ...nf, itemId: it?.id ?? null, itemName: it?.name ?? null })} /></label>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <label className="field"><span>kg CO₂e</span><input className="input" type="number" min="0" step="any" value={nf.co2e} onChange={(e) => setNf({ ...nf, co2e: e.target.value })} style={{ width: 110 }} /></label>
                  <label className="field"><span>per</span><select className="input" value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></label>
                  {money && <label className="field"><span>money of year</span><input className="input" type="number" value={nf.priceYear} placeholder="purchase year" onChange={(e) => setNf({ ...nf, priceYear: e.target.value })} style={{ width: 110 }} /></label>}
                </div>
                <label className="field"><span>Source (EPD number, report…)</span><input className="input" value={nf.source} onChange={(e) => setNf({ ...nf, source: e.target.value })} /></label>
                <label className="field"><span>Boundary</span><input className="input" value={nf.boundary} onChange={(e) => setNf({ ...nf, boundary: e.target.value })} /></label>
                <label className="field"><span>Valid from (optional)</span><input className="input" type="date" value={nf.validFrom} onChange={(e) => setNf({ ...nf, validFrom: e.target.value })} /></label>
                <label className="field"><span>Valid to (optional)</span><input className="input" type="date" value={nf.validTo} onChange={(e) => setNf({ ...nf, validTo: e.target.value })} /></label>
              </div>
              <div className="sub">Per kg, t, L, m³, kWh or piece: used when the purchase line has a quantity in that unit (else the spend is used). Per currency: kg CO₂e per unit of money spent with this supplier.</div>
              <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setNf(null)}>Cancel</button><button className="btn sm p" disabled={!nf.co2e || nf.source.trim().length < 2} onClick={save}>Save factor</button></div>
            </fieldset>
          )}
        </div>
        <div><h3>What is bought</h3>
          {d.categories.length ? <table className="t compact"><thead><tr><th>Spend category</th><th className="num">Lines</th><th className="num">USD</th><th className="num">tCO₂e</th></tr></thead>
            <tbody>{d.categories.map((c, i) => <tr key={i}><td>{c.item ?? <span className="muted">no category yet</span>}</td><td className="num">{c.lines}</td><td className="num">{usd(c.usd ?? 0)}</td><td className="num">{tco2e(c.co2e ?? 0)}</td></tr>)}</tbody></table> : <div className="sub">No purchases yet.</div>}
          {canManage && <fieldset className="box" style={{ marginTop: 12 }}><legend>Same supplier under another name?</legend>
            <input className="input sm" placeholder="Search the other spelling…" value={merge} onChange={(e) => setMerge(e.target.value)} />
            {cands.map((c) => <div key={c.id} className="row" style={{ gap: 6, marginTop: 4 }}><span className="grow small">{c.name} · {c.lines} lines</span>
              <button className="btn xs" onClick={async () => { try { const r = await api.mergeSupplier(c.id, id); toast(`Merged: ${r.lines} lines moved`); setMerge(''); load(); onChanged(); } catch (e) { setErr((e as Error).message); } }}>Merge into {s.name}</button></div>)}
          </fieldset>}
        </div>
      </div>
    </div>
  );
}
