/** Scrap market: the company's own scrap listings (value, status, quotes) and the directory of checked recyclers. */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import './save.css';
import { useApp } from '../../App';
import { useSme } from './store';
import { Kpi, Kpis, Pill, Sample, SmeHead } from './ui';
import { f0, lakh, n, smeApi, type SmeScrap } from '../../lib/sme';

type Recycler = Awaited<ReturnType<typeof smeApi.recyclers>>['recyclers'][number];
const UNITS: [SmeScrap['unit'], string][] = [['t', 'tonnes'], ['kg', 'kg'], ['kL', 'kilolitres'], ['L', 'litres'], ['nos', 'pieces']];
const STATUS: Record<SmeScrap['status'], [string, string]> = {
  draft: ['Not listed', 'watch'], listed: ['Waiting for quotes', 'likely'], sold: ['Sold', 'done'], withdrawn: ['Withdrawn', 'watch'], blocked: ['Paused by EKOTRACE', 'overdue'],
};
/** price is per kg / litre / piece; tonnes and kilolitres are converted. */
const per = (u: string) => (u === 't' || u === 'kg' ? 'kg' : u === 'kL' || u === 'L' ? 'litre' : 'piece');
const factor = (u: string) => (u === 't' || u === 'kL' ? 1000 : 1);
const value = (x: Pick<SmeScrap, 'qty' | 'unit' | 'price'>) => n(x.qty) * factor(x.unit) * n(x.price);

export function SmeScrap() {
  const { d, reload } = useSme();
  const { toast } = useApp();
  const [items, setItems] = useState<SmeScrap[] | null>(null);
  const [recs, setRecs] = useState<Recycler[] | null>(null);
  const [state, setState] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ item: '', qty: '', unit: 't' as SmeScrap['unit'], price: '', hazardous: false });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { const r = await smeApi.scrap(); setItems(r.listings); setState(r.state); setErr(''); } catch (e) { setErr((e as Error).message); setItems((x) => x ?? []); }
  }, []);
  useEffect(() => {
    load();
    smeApi.recyclers().then((r) => setRecs(r.recyclers)).catch(() => setRecs([]));
  }, [load]);

  if (!d) return <div className="card empty">Loading…</div>;
  const can = d.canEdit;
  const open = (items ?? []).filter((x) => x.status === 'draft' || x.status === 'listed');
  const sold = (items ?? []).filter((x) => x.status === 'sold');
  const recycled = d.data.esg?.recycled;
  const anyHaz = (items ?? []).some((x) => x.hazardous && x.status !== 'sold') || form.hazardous;

  const patch = async (x: SmeScrap, b: Parameters<typeof smeApi.updateScrap>[1], msg: string) => {
    setBusy(x.id);
    try { await smeApi.updateScrap(x.id, b); await load(); await reload(); toast(msg); } catch (e) { toast((e as Error).message); await load(); }
    setBusy(null);
  };
  const move = (x: SmeScrap, status: 'draft' | 'listed' | 'sold' | 'withdrawn') => patch(x, { status },
    status === 'listed' ? (x.hazardous ? 'Listed. Quotes will come only from recyclers authorised for hazardous waste.' : 'Listed. The EKOTRACE team will ask registered recyclers for quotes.')
      : status === 'sold' ? 'Marked as sold' : status === 'withdrawn' ? 'Listing withdrawn' : 'Moved back to not listed');
  const edit = (x: SmeScrap, k: 'qty' | 'price', raw: string) => {
    const v = raw === '' ? 0 : Number(raw);
    if (Number.isNaN(v) || v < 0 || v === n(x[k])) return;
    patch(x, { [k]: v }, 'Saved');
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (form.item.trim().length < 2) { toast('Name the item, for example "MS turnings".'); return; }
    if (!(Number(form.qty) > 0)) { toast('Enter the quantity.'); return; }
    setAdding(true);
    try {
      await smeApi.addScrap({ item: form.item.trim(), qty: Number(form.qty), unit: form.unit, price: n(form.price), hazardous: form.hazardous });
      setForm({ item: '', qty: '', unit: form.unit, price: '', hazardous: false });
      await load(); await reload();
      toast('Added. Press "Get quotes" to send it to recyclers.');
    } catch (e2) { toast((e2 as Error).message); }
    setAdding(false);
  };
  const fv = value({ qty: Number(form.qty) || 0, unit: form.unit, price: Number(form.price) || 0 });

  return (
    <>
      <SmeHead lede="List scrap and waste for quotes from registered recyclers. Every sale is money back and raises your recycling rate.">
        {d.company.isExample && <Sample />}
      </SmeHead>
      <Kpis>
        <Kpi label="Value of open listings" value={lakh(d.results.money?.scrap)} unit="at your expected prices" good={n(d.results.money?.scrap) > 0} />
        <Kpi label="Open listings" value={items ? open.length : '—'} unit={`${open.filter((x) => x.status === 'listed').length} waiting for quotes`} />
        <Kpi label="Sold" value={items ? sold.length : '—'} unit={sold.length ? `${lakh(sold.reduce((a, x) => a + value(x), 0))} at listed prices` : 'none yet'} />
        <Kpi label="Recycling rate" value={recycled === undefined || recycled === '' ? '—' : `${f0(recycled)}%`} unit={<Link to="/sme/esg">of waste generated</Link>} good={n(recycled) >= 50} />
      </Kpis>

      <div className="card">
        <div className="sv-h2row"><h2>Your listings</h2>{items && items.length > 0 && <span className="muted small">Prices are what you expect per kg, litre or piece</span>}</div>
        {err && <p className="note bad" style={{ marginTop: 8 }}>{err}</p>}
        <div className="sme-scroll" style={{ marginTop: 8 }}>
          <table className="sme-tbl sv-lst">
            <thead><tr><th>Item</th><th className="r">Quantity</th><th className="r">Expected price</th><th className="r">Value</th><th>Status</th><th><span className="muted" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</span></th></tr></thead>
            <tbody>
              {(items ?? []).map((x) => {
                const lock = !can || x.status === 'blocked' || x.status === 'sold' || busy === x.id;
                const [label, kind] = STATUS[x.status] ?? [x.status, 'watch'];
                return (
                  <tr key={x.id}>
                    <td className="it"><b>{x.item}</b>
                      {x.hazardous && <small className="haz">Hazardous: only SPCB-authorised recyclers may take it</small>}
                      {x.status === 'blocked' && <small className="blk">{x.admin_note || 'Paused by the EKOTRACE team. Contact support.'}</small>}
                    </td>
                    <td className="r" data-l="Quantity">{lock ? <span className="num">{f0(x.qty)} {x.unit}</span> : (
                      <span className="in"><input key={`q${x.qty}`} className="input num" type="number" min={0} step="any" inputMode="decimal" defaultValue={Number(x.qty)} aria-label={`Quantity of ${x.item} in ${x.unit}`} onBlur={(e) => edit(x, 'qty', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /><small>{x.unit}</small></span>)}</td>
                    <td className="r" data-l="Price">{lock ? <span className="num">₹{f0(x.price)}/{per(x.unit)}</span> : (
                      <span className="in"><input key={`p${x.price}`} className="input num" type="number" min={0} step="any" inputMode="decimal" defaultValue={Number(x.price)} aria-label={`Price of ${x.item} per ${per(x.unit)}`} onBlur={(e) => edit(x, 'price', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} /><small>₹/{per(x.unit)}</small></span>)}</td>
                    <td className="r num" data-l="Value">{lakh(value(x))}</td>
                    <td data-l="Status"><Pill kind={kind}>{label}</Pill></td>
                    <td className="ac">{can && x.status !== 'blocked' && (
                      <div className="row">
                        {x.status === 'draft' && <button className="btn sm p" disabled={busy === x.id} onClick={() => move(x, 'listed')}>Get quotes</button>}
                        {x.status === 'listed' && <button className="btn sm" disabled={busy === x.id} onClick={() => move(x, 'sold')}>Mark sold</button>}
                        {x.status === 'sold' && <button className="btn sm" disabled={busy === x.id} onClick={() => move(x, 'draft')}>List again</button>}
                        {(x.status === 'draft' || x.status === 'listed') && <button className="btn sm ghost" disabled={busy === x.id} onClick={() => move(x, 'withdrawn')}>Withdraw</button>}
                      </div>)}</td>
                  </tr>);
              })}
              {items && !items.length && <tr><td colSpan={6} className="muted">Nothing listed yet. {can ? 'Add your first scrap item below: metal turnings, offcuts, packaging, used oil.' : ''}</td></tr>}
              {!items && <tr><td colSpan={6} className="muted">Loading listings…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {anyHaz && <div className="sme-callout warn"><b>Hazardous waste</b> (used oil, sludge, chemical drums, e-waste, batteries) can go only to a recycler authorised by the State Pollution Control Board for that waste. Keep the manifest from each pickup and include it in your Form 4 annual return. Quotes for hazardous items come only from authorised recyclers.</div>}

      <div className="sme-grid2">
        {can ? (
          <div className="card">
            <h2>Add scrap</h2>
            <form className="sv-form" onSubmit={add}>
              <label className="l">Item<input className="input" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="e.g. MS turnings, HDPE drums" maxLength={200} /></label>
              <div className="g2">
                <label className="l">Quantity<input className="input num" type="number" min={0} step="any" inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
                <label className="l">Unit<select className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as SmeScrap['unit'] })}>{UNITS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
              </div>
              <label className="l">Expected price<small>₹ per {per(form.unit)}{form.unit === 't' || form.unit === 'kL' ? ` (quantity is in ${form.unit === 't' ? 'tonnes' : 'kilolitres'})` : ''}</small><input className="input num" type="number" min={0} step="any" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
              <label className="sv-check"><input type="checkbox" checked={form.hazardous} onChange={(e) => setForm({ ...form, hazardous: e.target.checked })} /><span>Hazardous waste<small>Used oil, sludge, chemical containers, e-waste, batteries. Needs an authorised recycler.</small></span></label>
              <div className="row"><button className="btn p" type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add to my listings'}</button>{fv > 0 && <span className="muted small">Worth about {lakh(fv)}</span>}</div>
            </form>
          </div>) : (
          <div className="card"><h2>Add scrap</h2><p className="muted">You can see listings but not change them. Ask an admin or manager to add scrap.</p></div>)}

        <div className="card">
          <h2>Registered recyclers</h2>
          <p className="sv-sub">Checked by EKOTRACE for CPCB / SPCB authorisation{state ? `, ${state} first` : ''}. "Get quotes" sends your listing to them.</p>
          <table className="sme-tbl" style={{ marginTop: 8 }}><tbody>
            {(recs ?? []).map((r, i) => (
              <tr key={`${r.name}-${i}`}><td><b>{r.name}</b>{(r.city || r.state) && <span className="muted">, {[r.city, r.state].filter(Boolean).join(', ')}</span>}
                <br /><span className="muted small">{[r.materials, r.authorisation].filter(Boolean).join(' · ')}</span>
                {r.hazardous_ok && <> <Pill kind="good">Hazardous OK</Pill></>}</td>
                <td className="r small">{r.contact ?? ''}</td></tr>))}
            {recs && !recs.length && <tr><td className="muted">No checked recyclers are listed for {state || 'your state'} yet. You can still list scrap; the EKOTRACE team finds buyers for each listing.</td></tr>}
            {!recs && <tr><td className="muted">Loading…</td></tr>}
          </tbody></table>
        </div>
      </div>
    </>);
}
