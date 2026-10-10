/**
 * Suppliers (Value chain): everyone the company buys from — registered automatically from
 * uploads, the ERP API and manual entry (one record per supplier however its name is written),
 * or added here. Three tabs:
 *   Suppliers       the list, each supplier's profile, names seen, own emission factors
 *   Check names     possible duplicates (merge / keep apart) and names linked automatically (confirm / split)
 *   Analytics       spend and emissions by country, product group, sector, Scope 3 category, month; top suppliers
 */
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, tco2e, type Supplier, type SupplierAnalytics, type SupplierFactor2, type SupplierProfile, type SupplierReview } from '../lib/api';
import { ItemPicker } from '../components/ItemPicker';
import { Icon } from '../components/Icon';
import { countryName, t as tonnes, usdShort } from '../components/Charts';
import { Bars, DCard, Donut, DStat, HBars, Legend, MN, PAL as PAL2, Treemap, fmt0, fmtT, type BarRow } from '../components/DashCharts';

const MANAGE = ['super_admin', 'admin', 'manager'];
const UNITS = ['kg', 't', 'L', 'm3', 'kWh', 'pcs', 'AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR'];
const usd = (v: number) => `$${Math.round(v).toLocaleString('en')}`;
const TARGET_LABEL: Record<string, string> = { sbti_validated: 'SBTi target (validated)', sbti_committed: 'SBTi commitment', own: 'Own target', none: 'No target', unknown: 'Not known' };
const SCOPE3_LABEL: Record<string, string> = { purchased_goods: '3.1 Purchased goods & services', capital_goods: '3.2 Capital goods', upstream_transport: '3.4 Upstream transport', business_travel: '3.6 Business travel', upstream_leased: '3.8 Upstream leased assets' };
type Tab = 'list' | 'review' | 'analytics';

export function Suppliers() {
  const { role } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'list';
  const setTab = (t: Tab, extra: Record<string, string> = {}) => setSp({ ...(t === 'list' ? {} : { tab: t }), ...extra });
  const [counts, setCounts] = useState<{ all: number; review: number; incomplete: number; autoLinked: number } | null>(null);
  const loadCounts = () => api.supplierCounts().then((r) => setCounts(r.counts)).catch(() => {});
  useEffect(() => { loadCounts(); }, []);
  const canManage = MANAGE.includes(role);
  const toCheck = (counts?.review ?? 0) + (counts?.autoLinked ?? 0);

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Value chain</div><h1>Suppliers</h1>
          <p className="sub">Every supplier is registered from purchase uploads, the ERP API and manual entries — one record however the name is written (vendor number first, then name and known spellings, then near-identical names). Names that may be the same supplier wait for a person under “Check names”. Complete the profile here; a supplier's own emission factor replaces the spend-based estimate for its purchases.</p></div>
      </div>
      <div className="tabs">
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Suppliers{counts ? ` (${counts.all.toLocaleString('en')})` : ''}</button>
        <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')}>Check names{toCheck ? <span className="chip warn" style={{ marginLeft: 6 }}>{toCheck}</span> : ''}</button>
        <button className={tab === 'analytics' ? 'on' : ''} onClick={() => setTab('analytics')}>Analytics</button>
      </div>
      {tab === 'list' && <SupplierList canManage={canManage} counts={counts} onChanged={loadCounts} />}
      {tab === 'review' && <ReviewTab canManage={canManage} onChanged={loadCounts} />}
      {tab === 'analytics' && <Analytics />}
    </div>
  );
}

// ------------------------------------------------------------------ list --
function SupplierList({ canManage, counts, onChanged }: { canManage: boolean; counts: { all: number; review: number; incomplete: number } | null; onChanged: () => void }) {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const filter = sp.get('filter') ?? 'all';
  const country = sp.get('country') ?? '';
  const [sort, setSort] = useState('co2e');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [total, setTotal] = useState(0);
  const open = sp.get('open');
  const [adding, setAdding] = useState(false);
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const load = () => api.suppliers({ q, filter, offset, limit: 50, sort, country: country || undefined }).then((r) => { setRows(r.suppliers); setTotal(r.total); });
  useEffect(() => { const t = window.setTimeout(load, q ? 250 : 0); return () => window.clearTimeout(t); }, [q, filter, offset, sort, country]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged(); };
  const FILTERS: [string, string, number | undefined][] = [['all', 'All', counts?.all], ['review', 'Possible duplicates', counts?.review], ['incomplete', 'Profile incomplete', counts?.incomplete], ['with_factor', 'With own factor', undefined], ['without_factor', 'Spend-based only', undefined]];

  return (
    <>
      {adding && <AddSupplier onDone={(id) => { setAdding(false); changed(); if (id) setParam('open', id); }} />}
      <div className="card flush">
        <div className="row" style={{ padding: 12, gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(([k, l, n]) => <button key={k} className={`chipbtn ${filter === k ? 'on' : ''}`} onClick={() => { setParam('filter', k === 'all' ? null : k); setOffset(0); }}>{l}{n !== undefined && <span className="meta">{n.toLocaleString('en')}</span>}</button>)}
          {country && <button className="chipbtn on" onClick={() => setParam('country', null)} title="Remove the country filter">{country === 'none' ? 'Country not known' : countryName(country)} <Icon name="x" /></button>}
          <div className="grow" />
          <select className="input sm" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }} aria-label="Sort by" style={{ width: 150 }}>
            <option value="co2e">Most emissions</option><option value="spend">Most spend</option><option value="lines">Most lines</option><option value="name">Name A–Z</option>
          </select>
          <input className="input sm" type="search" placeholder="Search name, spelling or vendor number…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ width: 260 }} />
          {canManage && <button className="btn sm p" onClick={() => setAdding(true)}><Icon name="plus" />Add supplier</button>}
        </div>
        {rows === null ? <div className="empty">Loading…</div> : !rows.length ? <div className="empty">{filter === 'all' && !q && !country ? 'No suppliers yet: they appear with the first purchase upload.' : 'No supplier matches.'}</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>Supplier</th><th>Country</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th>Factor</th><th>Profile</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id} className={`click ${open === s.id ? 'sel' : ''}`} onClick={() => setParam('open', open === s.id ? null : s.id)}>
                <td><b>{s.name}</b>{s.review === 'possible_duplicate' && <span className="chip warn" style={{ marginLeft: 6 }} title={`${Math.round((s.duplicate_score ?? 0) * 100)}% alike`}>same as {s.duplicate_of_name}?</span>}
                  <div className="muted small">{[s.reference && `vendor ${s.reference}`, s.aliases.length ? `${s.aliases.length} other spelling${s.aliases.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</div></td>
                <td className="small">{s.country ? countryName(s.country) : <span className="muted">—</span>}</td>
                <td className="num">{s.lines.toLocaleString('en')}</td><td className="num">{usd(s.usd)}</td><td className="num">{tco2e(s.co2e)}</td>
                <td>{s.factors ? <span className="chip">own factor</span> : <span className="chip grey">spend-based</span>}</td>
                <td><Completeness v={s.completeness ?? 0} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
        {total > 50 && <div className="row" style={{ padding: 8, justifyContent: 'flex-end' }}><span className="muted small">{offset + 1}–{Math.min(total, offset + 50)} of {total.toLocaleString('en')}</span>
          <button className="btn sm" disabled={!offset} onClick={() => setOffset(offset - 50)} aria-label="Previous page">‹</button><button className="btn sm" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)} aria-label="Next page">›</button></div>}
      </div>
      {open && <SupplierPanel key={open} id={open} canManage={canManage} onChanged={changed} onClose={() => setParam('open', null)} onOpen={(id) => setParam('open', id)} />}
    </>
  );
}

function Completeness({ v }: { v: number }) {
  return <span className="complete" title={`Profile ${Math.round(v * 100)}% complete (country, vendor number, industry, contact, reports emissions, climate target)`}><span className="cov"><div style={{ width: `${Math.round(v * 100)}%` }} /></span>{Math.round(v * 100)}%</span>;
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
      <div className="sub">The name and vendor number are checked against existing suppliers and every spelling seen in purchases.</div>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => onDone()}>Cancel</button>
        <button className="btn p" disabled={!f.name.trim()} onClick={async () => { try { const r = await api.addSupplier(Object.fromEntries(Object.entries(f).filter(([, v]) => v))); onDone(r.id); } catch (e) { setErr((e as Error).message); } }}>Add</button></div>
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = { new: 'first seen', exact: 'same name', alias: 'known spelling', reference: 'same vendor number', similar: 'near-identical name', merged: 'merged', manual: 'added by hand' };
type ProfileForm = { name: string; country: string; reference: string; trn: string; website: string; industry: string; size: string; contactName: string; contactEmail: string; reportsEmissions: string; climateTarget: string; note: string };
const formOf = (s: SupplierProfile): ProfileForm => ({ name: s.name, country: s.country ?? '', reference: s.reference ?? '', trn: s.trn ?? '', website: s.website ?? '', industry: s.industry ?? '', size: s.size ?? '',
  contactName: s.contact_name ?? '', contactEmail: s.contact_email ?? '', reportsEmissions: s.reports_emissions ?? 'unknown', climateTarget: s.climate_target ?? 'unknown', note: s.note ?? '' });

function SupplierPanel({ id, canManage, onChanged, onClose, onOpen }: { id: string; canManage: boolean; onChanged: () => void; onClose: () => void; onOpen: (id: string) => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.supplier>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [nf, setNf] = useState<{ itemId: number | null; itemName: string | null; co2e: string; unit: string; priceYear: string; source: string; boundary: string; validFrom: string; validTo: string } | null>(null);
  const [merge, setMerge] = useState('');
  const [cands, setCands] = useState<Supplier[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const load = () => api.supplier(id).then((r) => { setD(r); setForm(formOf(r.supplier)); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadedId = d?.supplier.id;
  useEffect(() => { if (loadedId) box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [loadedId]);
  useEffect(() => { if (merge.length < 2) { setCands([]); return; } const t = window.setTimeout(() => api.suppliers({ q: merge, limit: 8 }).then((r) => setCands(r.suppliers.filter((s) => s.id !== id))), 250); return () => window.clearTimeout(t); }, [merge, id]);
  if (!d || !form) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const s = d.supplier;
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(s));
  const money = nf && /^[A-Z]{3}$/.test(nf.unit);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); load(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  const saveProfile = () => act(() => api.patchSupplier(id, {
    name: form.name.trim(), country: form.country || null, reference: form.reference.trim() || null, trn: form.trn.trim() || null, website: form.website.trim() || null, industry: form.industry.trim() || null,
    size: form.size || null, contactName: form.contactName.trim() || null, contactEmail: form.contactEmail.trim() || null, reportsEmissions: form.reportsEmissions, climateTarget: form.climateTarget, note: form.note.trim() || null,
  }), 'Profile saved');
  const saveEf = async () => {
    if (!nf) return;
    try {
      const r = await api.addSupplierEf(id, { itemId: nf.itemId, co2e: Number(nf.co2e), unit: nf.unit, priceYear: money && nf.priceYear ? Number(nf.priceYear) : null, source: nf.source, boundary: nf.boundary || undefined,
        validFrom: nf.validFrom || undefined, validTo: nf.validTo || undefined });
      toast(`Factor saved · ${r.linesRecalculated.toLocaleString('en')} open lines recalculated`); setNf(null); load(); onChanged();
    } catch (e) { setErr((e as Error).message); }
  };
  const F = (k: keyof ProfileForm, label: string, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <label className="field"><span>{label}</span><input className="input" value={form[k]} disabled={!canManage} onChange={(e) => setForm({ ...form, [k]: k === 'country' ? e.target.value.toUpperCase() : e.target.value })} {...extra} /></label>);
  const monthly = d.months.filter((m) => m.month.startsWith(d.months.at(-1)?.month.slice(0, 4) ?? '')).map((m) => ({ m: Number(m.month.slice(5, 7)), co2e: m.co2e }));

  return (
    <div className="card" ref={box} style={{ display: 'grid', gap: 14, scrollMarginTop: 12 }}>
      <div className="row"><div className="grow"><div className="eyebrow">Supplier</div><h2>{s.name}</h2>
        <div className="sub">{[s.reference && `vendor ${s.reference}`, s.country && countryName(s.country), `from ${s.origin}`].filter(Boolean).join(' · ')}</div></div>
        <Completeness v={s.completeness ?? 0} />
        <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
      {err && <div className="note bad">{err}</div>}
      {s.review === 'possible_duplicate' && d.duplicateOf && (
        <div className="note warn row" style={{ gap: 8 }}>
          <span className="grow">Possibly the same supplier as <a href="#" onClick={(e) => { e.preventDefault(); onOpen(d.duplicateOf!.id); }}>{d.duplicateOf.name}</a> ({Math.round((s.duplicate_score ?? 0) * 100)}% alike).</span>
          {canManage && <><button className="btn sm p" onClick={() => act(() => api.mergeSupplier(id, d.duplicateOf!.id), `Merged into ${d.duplicateOf!.name}`).then(() => onOpen(d.duplicateOf!.id))}>Same supplier: merge</button>
            <button className="btn sm" onClick={() => act(() => api.keepSupplierSeparate(id), 'Kept as a separate supplier')}>Different supplier</button></>}
        </div>
      )}
      <div className="cols2">
        <fieldset className="box"><legend>Profile</legend>
          <div className="grid2">
            {F('name', 'Name')}{F('reference', 'Vendor number (ERP)')}
            {F('country', 'Country (2 letters, e.g. AE)', { maxLength: 2 })}{F('trn', 'Tax registration number (TRN)')}
            {F('industry', 'Industry / what they supply')}
            <label className="field"><span>Size</span><select className="input" value={form.size} disabled={!canManage} onChange={(e) => setForm({ ...form, size: e.target.value })}><option value="">—</option><option value="micro">Micro</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            {F('contactName', 'Sustainability contact')}{F('contactEmail', 'Contact e-mail', { type: 'email' })}
            {F('website', 'Website')}
            <label className="field"><span>Reports its emissions</span><select className="input" value={form.reportsEmissions} disabled={!canManage} onChange={(e) => setForm({ ...form, reportsEmissions: e.target.value })}><option value="unknown">Not known</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field"><span>Climate target</span><select className="input" value={form.climateTarget} disabled={!canManage} onChange={(e) => setForm({ ...form, climateTarget: e.target.value })}>{Object.entries(TARGET_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <label className="field" style={{ marginTop: 8 }}><span>Note</span><textarea className="input" rows={2} value={form.note} disabled={!canManage} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          {canManage && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button className="btn sm" disabled={!dirty} onClick={() => setForm(formOf(s))}>Undo</button><button className="btn sm p" disabled={!dirty || !form.name.trim()} onClick={saveProfile}>Save profile</button></div>}
        </fieldset>
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div><h3>Emissions by month{monthly.length ? ` (${d.months.at(-1)!.month.slice(0, 4)})` : ''}</h3>
            {monthly.length ? <Bars rows={MN.map((lbl, i) => { const x = monthly.find((m) => m.m === i + 1); return { lbl, parts: x ? [{ v: (x.co2e ?? 0) / 1000, c: 'var(--s3)', n: 'tCO₂e' }] : [] }; })} h={120} /> : <div className="sub">No calculated purchases yet.</div>}</div>
          <div><h3>Default spend category</h3>
            <div className="sub">Used for this supplier's purchases that their description does not identify (e.g. “Monthly charges”). A clear description still wins.</div>
            {canManage ? <ItemPicker value={d.defaultItem?.id ?? null} valueName={d.defaultItem?.name ?? null} placeholder="none — description decides"
              onPick={(it) => act(() => api.patchSupplier(id, { defaultItemId: it?.id ?? null }), it ? `Default: ${it.name}` : 'Default removed')} /> : <div>{d.defaultItem?.name ?? <span className="muted">none</span>}</div>}
            {canManage && d.suggestedDefault && <div className="note info row" style={{ gap: 8, marginTop: 6 }}><span className="grow">{Math.round(d.suggestedDefault.share * 100)}% of what is bought from this supplier is <b>{d.suggestedDefault.name}</b>.</span>
              <button className="btn xs" onClick={() => act(() => api.patchSupplier(id, { defaultItemId: d.suggestedDefault!.id }), `Default: ${d.suggestedDefault!.name}`)}>Use as default</button></div>}
          </div>
          <div><h3>What is bought</h3>
            {d.categories.length ? <table className="t compact"><thead><tr><th>Spend category</th><th className="num">Lines</th><th className="num">USD</th><th className="num">tCO₂e</th></tr></thead>
              <tbody>{d.categories.map((c, i) => <tr key={i}><td>{c.item ?? <span className="muted">no category yet</span>}</td><td className="num">{c.lines}</td><td className="num">{usd(c.usd ?? 0)}</td><td className="num">{tco2e(c.co2e ?? 0)}</td></tr>)}</tbody></table> : <div className="sub">No purchases yet.</div>}</div>
        </div>
      </div>
      <div className="cols2">
        <div><h3>Names seen in purchases</h3>
          <div className="sub">How each spelling in the files was linked to this supplier. A wrong link can be split off as its own supplier.</div>
          <table className="t compact"><thead><tr><th>As written</th><th>Linked by</th><th className="num">Lines</th><th /></tr></thead>
            <tbody>{d.names.map((n) => (
              <tr key={n.id}><td>{n.name_seen}</td><td className="small">{METHOD_LABEL[n.method] ?? n.method}{n.method === 'similar' && n.score ? ` · ${Math.round(n.score * 100)}%` : ''}{n.method === 'similar' && (n.confirmed ? <span className="chip" style={{ marginLeft: 4 }}>checked</span> : <span className="chip warn" style={{ marginLeft: 4 }}>to check</span>)}</td>
                <td className="num">{n.lines.toLocaleString('en')}</td>
                <td>{canManage && n.method === 'similar' && !n.confirmed && <span className="row" style={{ gap: 4 }}>
                  <button className="btn xs" onClick={() => act(() => api.supplierMatch(n.id, 'confirm'), 'Link confirmed')}>Right</button>
                  <button className="btn xs" onClick={() => act(() => api.supplierMatch(n.id, 'split'), `“${n.name_seen}” is now its own supplier`)}>Wrong: split</button></span>}</td></tr>))}
              {!d.names.length && <tr><td colSpan={4} className="muted">No purchases yet.</td></tr>}</tbody></table>
          {canManage && <fieldset className="box" style={{ marginTop: 12 }}><legend>Same supplier under another record?</legend>
            <input className="input sm" placeholder="Search the other record…" value={merge} onChange={(e) => setMerge(e.target.value)} />
            {cands.map((c) => <div key={c.id} className="row" style={{ gap: 6, marginTop: 4 }}><span className="grow small">{c.name} · {c.lines} lines{c.reference ? ` · vendor ${c.reference}` : ''}</span>
              <button className="btn xs" onClick={() => act(async () => { const r = await api.mergeSupplier(c.id, id); setMerge(''); return r; }, `Merged into ${s.name}`)}>Merge into {s.name}</button></div>)}
          </fieldset>}
        </div>
        <div><h3>Own emission factors</h3>
          {d.factors.length ? <table className="t compact"><thead><tr><th>Applies to</th><th className="num">kg CO₂e</th><th>per</th><th>Valid</th><th>Source</th><th /></tr></thead>
            <tbody>{d.factors.map((f: SupplierFactor2) => (
              <tr key={f.id}><td>{f.item ?? 'everything bought'}</td><td className="num">{num(f.co2e, 5)}</td><td>{f.unit}{f.price_year ? ` (${f.price_year})` : ''}</td><td className="small">{f.valid_from.slice(0, 4)}–{f.valid_to.slice(0, 4)}</td><td className="small">{f.source}{f.boundary ? ` · ${f.boundary}` : ''}</td>
                <td>{canManage && <button className="btn ghost sm" aria-label="Remove" onClick={() => act(() => api.deleteSupplierEf(id, f.id), 'Factor removed')}><Icon name="x" /></button>}</td></tr>))}</tbody></table>
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
              <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn sm" onClick={() => setNf(null)}>Cancel</button><button className="btn sm p" disabled={!nf.co2e || nf.source.trim().length < 2} onClick={saveEf}>Save factor</button></div>
            </fieldset>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- review --
function ReviewTab({ canManage, onChanged }: { canManage: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<SupplierReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.supplierReview().then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => { setBusy(key); try { await fn(); toast(msg); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  if (!d) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const open = (id: string) => nav(`/suppliers?open=${id}`);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {err && <div className="note bad">{err}</div>}
      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h3>Possible duplicates <span className="chip warn">{d.duplicates.length}</span></h3>
          <p className="sub">New names that look like an existing supplier but differ in a way that needs a person (a different vendor number, an extra word, a short name). Until decided they stay separate suppliers.</p></div>
        {!d.duplicates.length ? <div className="empty">Nothing to check.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>New name</th><th /><th>Existing supplier</th><th className="num">Alike</th><th /></tr></thead>
            <tbody>{d.duplicates.map((x) => (
              <tr key={x.id}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(x.id); }}><b>{x.name}</b></a><div className="muted small">{[x.reference && `vendor ${x.reference}`, x.country, `${x.lines.toLocaleString('en')} lines`].filter(Boolean).join(' · ')}</div></td>
                <td className="muted">≈</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(x.other_id); }}>{x.other_name}</a><div className="muted small">{[x.other_reference && `vendor ${x.other_reference}`, x.other_country, `${x.other_lines.toLocaleString('en')} lines`].filter(Boolean).join(' · ')}</div></td>
                <td className="num">{x.score ? `${Math.round(x.score * 100)}%` : ''}</td>
                <td>{canManage && <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn xs p" disabled={!!busy} onClick={() => act(x.id, () => api.mergeSupplier(x.id, x.other_id), `${x.name} merged into ${x.other_name}`)}>Same: merge</button>
                  <button className="btn xs" disabled={!!busy} onClick={() => act(x.id, () => api.keepSupplierSeparate(x.id), 'Kept apart')}>Different</button></span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h3>Linked automatically <span className="chip info">{d.autoLinked.length}</span></h3>
          <p className="sub">Names linked to an existing supplier because they differ only by a typo, spacing or a generic word. Their lines already count under that supplier; confirm, or split a wrong link off as its own supplier.</p></div>
        {!d.autoLinked.length ? <div className="empty">Nothing to check.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>As written</th><th /><th>Linked to</th><th className="num">Alike</th><th className="num">Lines</th><th /></tr></thead>
            <tbody>{d.autoLinked.map((x) => (
              <tr key={x.id}>
                <td>{x.name_seen}</td><td className="muted">→</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(x.supplier_id); }}>{x.supplier}</a>{x.similar_to && x.similar_to !== x.supplier && <div className="muted small">matched with “{x.similar_to}”</div>}</td>
                <td className="num">{x.score ? `${Math.round(x.score * 100)}%` : ''}</td><td className="num">{x.lines.toLocaleString('en')}</td>
                <td>{canManage && <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  <button className="btn xs" disabled={!!busy} onClick={() => act(`m${x.id}`, () => api.supplierMatch(x.id, 'confirm'), 'Confirmed')}>Right</button>
                  <button className="btn xs" disabled={!!busy} onClick={() => act(`m${x.id}`, () => api.supplierMatch(x.id, 'split'), `“${x.name_seen}” is now its own supplier`)}>Wrong: split</button></span>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        {canManage && d.autoLinked.length > 1 && <div className="row" style={{ padding: 10, justifyContent: 'flex-end' }}>
          <button className="btn sm" disabled={!!busy} onClick={() => act('all', async () => { for (const x of d.autoLinked) await api.supplierMatch(x.id, 'confirm'); }, `${d.autoLinked.length} links confirmed`)}>Confirm all {d.autoLinked.length}</button></div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- analytics --
function Analytics() {
  const nav = useNavigate();
  const [year, setYear] = useState<number | undefined>();
  const [d, setD] = useState<SupplierAnalytics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [metric, setMetric] = useState<'co2e' | 'usd'>('co2e');
  const [itemView, setItemView] = useState<'group' | 'item'>('group');
  useEffect(() => { setD(null); api.supplierAnalytics(year).then(setD).catch((e) => setErr(e.message)); }, [year]);
  const groups = useMemo(() => {
    if (!d) return [];
    const m = new Map<string, { usd: number; co2e: number; items: number }>();
    for (const r of d.byItem) { const g = m.get(r.group) ?? { usd: 0, co2e: 0, items: 0 }; g.usd += r.usd ?? 0; g.co2e += r.co2e ?? 0; g.items++; m.set(r.group, g); }
    return [...m.entries()].map(([group, v]) => ({ group, ...v }));
  }, [d]);
  if (!d) return <div className="card empty">{err ?? 'Loading…'}</div>;
  if (!d.totals.lines) return <div className="card empty"><h3>No calculated purchases{d.year ? ` in ${d.year}` : ''} yet</h3><p className="sub">Upload purchases (Add data → Purchased goods & services); analytics count lines that are calculated (ready or published).</p></div>;
  const val = (r: { usd: number | null; co2e: number | null }) => (metric === 'co2e' ? r.co2e ?? 0 : r.usd ?? 0);
  const fmt = metric === 'co2e' ? tonnes : usdShort;
  const unit = metric === 'co2e' ? 't' : '';
  const sorted = <T extends { usd: number | null; co2e: number | null }>(rows: T[]) => [...rows].sort((a, b) => val(b) - val(a));
  const p = d.profiles;
  const pctOf = (n: number) => (p.suppliers ? `${Math.round((n / p.suppliers) * 100)}%` : '—');
  const supplierShare = d.totals.co2e ? d.totals.co2e_supplier / d.totals.co2e : 0;

  const v = (x: { usd: number | null; co2e: number | null }) => (metric === 'co2e' ? (x.co2e ?? 0) / 1000 : x.usd ?? 0);   // tonnes or USD
  const u = metric === 'co2e' ? 't' : 'USD';
  const tot = metric === 'co2e' ? d.totals.co2e / 1000 : d.totals.usd;
  const top = [...d.top].sort((a, b) => v(b) - v(a));
  const cParts = sorted(d.byCountry).map((r, i) => ({ n: countryName(r.country), v: v(r), c: r.country ? PAL2[i % PAL2.length]! : '#9AA7A2' }));
  const s3 = sorted(d.byScope3).map((r, i) => ({ n: SCOPE3_LABEL[r.category] ?? r.category, v: v(r), c: PAL2[(i + 3) % PAL2.length]! }));
  const tParts = d.targets.map((r, i) => ({ n: TARGET_LABEL[r.target] ?? r.target, v: (r.co2e ?? 0) / 1000, c: r.target === 'unknown' ? '#C9D9D2' : r.target === 'none' ? '#C2523C' : PAL2[i % PAL2.length]! }));
  const q = [{ n: "Supplier's own factor", v: d.totals.co2e_supplier / 1000, c: 'var(--ok)' }, { n: 'Spend-based average', v: (d.totals.co2e - d.totals.co2e_supplier) / 1000, c: '#E9B44C' }];
  const mrows: BarRow[] = MN.map((lbl, i) => { const m = d.byMonth.find((x) => Number(x.month.slice(5, 7)) === i + 1);
    return { lbl, parts: !m ? [] : metric === 'co2e' ? [{ v: (m.co2e_supplier ?? 0) / 1000, c: 'var(--ok)', n: "Supplier's own factor" }, { v: ((m.co2e ?? 0) - (m.co2e_supplier ?? 0)) / 1000, c: '#E9B44C', n: 'Spend-based' }] : [{ v: m.usd ?? 0, c: 'var(--info)', n: 'Spend' }] }; });
  const fmtV = (x: number) => (metric === 'co2e' ? `${fmtT(x)} t` : usdShort(x));

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="dhead">
        <div><span className="muted">{d.totals.lines.toLocaleString('en')} calculated purchase lines in {d.year}{d.totals.no_supplier ? ` · ${d.totals.no_supplier.toLocaleString('en')} without a supplier` : ''}</span></div>
        <span style={{ flex: 1 }} />
        <select className="input" value={d.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{d.years.map((y) => <option key={y}>{y}</option>)}</select>
        <div className="seg" role="group" aria-label="Show"><button className={metric === 'co2e' ? 'on' : ''} onClick={() => setMetric('co2e')}>Emissions</button><button className={metric === 'usd' ? 'on' : ''} onClick={() => setMetric('usd')}>Spend (USD)</button></div>
      </div>
      <DStat cells={[
        ['Suppliers with purchases', d.totals.suppliers.toLocaleString('en'), `${p.suppliers.toLocaleString('en')} in the list`],
        ['Spend', usdShort(d.totals.usd), 'USD, at the exchange rates used'],
        ['Emissions', <>{fmt0(d.totals.co2e / 1000)} <small>tCO₂e</small></>, 'purchases, capital goods, moved lines'],
        ["Suppliers' own factors", `${Math.round(supplierShare * 100)}%`, 'of purchase emissions; the rest is spend-based', supplierShare ? 'var(--ok)' : undefined],
        ['Concentration', `${d.concentration.n80} of ${d.concentration.suppliers}`, `suppliers make 80% of emissions (${d.concentration.n50} make 50%)`],
      ]} />
      <div className="dgrid">
        <DCard title="By supplier country" sub="click a country to list its suppliers">
          <div className="dsplit"><Donut parts={cParts} center={String(d.byCountry.filter((r) => r.country).length)} sub="countries" size={124} /><Legend parts={cParts} unit={u === 't' ? 't' : ''} /></div>
          <HBars items={sorted(d.byCountry).slice(0, 6).map((r) => ({ n: `${countryName(r.country)} · ${r.suppliers}`, v: v(r), p: tot ? (v(r) / tot) * 100 : 0, onClick: () => nav(`/suppliers?country=${r.country || 'none'}`) }))} unit={u === 't' ? 't' : ''} c="var(--s2)" />
        </DCard>
        <DCard title="By product" span={2} right={<div className="seg"><button className={itemView === 'group' ? 'on' : ''} onClick={() => setItemView('group')}>Groups</button><button className={itemView === 'item' ? 'on' : ''} onClick={() => setItemView('item')}>Spend categories</button></div>}>
          {itemView === 'group'
            ? <Treemap items={sorted(groups).map((g, i) => ({ n: g.group, v: v(g), c: PAL2[i % PAL2.length]! }))} W={640} H={200} />
            : <HBars items={sorted(d.byItem).slice(0, 12).map((r) => ({ n: r.item ?? 'Not mapped', v: v(r), d: 1, p: tot ? (v(r) / tot) * 100 : 0 }))} unit={u === 't' ? 't' : ''} c="var(--s3)" />}
        </DCard>
        <DCard title="Largest suppliers" span={2} sub="engage these first: ask for their own factors, complete their profiles">
          <HBars items={top.slice(0, 10).map((x) => ({ n: x.name, v: v(x), d: 1, p: tot ? (v(x) / tot) * 100 : 0, c: x.own_factor ? 'var(--ok)' : 'var(--s3)', onClick: () => nav(`/suppliers?open=${x.id}`) }))} unit={u === 't' ? 't' : ''} />
          <div className="lgd"><span><i style={{ background: 'var(--ok)' }} />own factor</span><span><i style={{ background: 'var(--s3)' }} />spend-based</span></div>
        </DCard>
        <DCard title="By Scope 3 category"><div className="dsplit"><Donut parts={s3} center={metric === 'co2e' ? fmt0(tot) : usdShort(tot)} sub={metric === 'co2e' ? 't' : ''} size={124} /><Legend parts={s3} unit={u === 't' ? 't' : ''} /></div></DCard>
        <DCard title={metric === 'co2e' ? 'Emissions by month (t)' : 'Spend by month (USD)'} span={2}>
          <Bars rows={mrows} unit={u} h={165} />
          {metric === 'co2e' && <div className="lgd"><span><i style={{ background: 'var(--ok)' }} />Supplier's own factor</span><span><i style={{ background: '#E9B44C' }} />Spend-based</span></div>}
        </DCard>
        <DCard title="Data quality"><div className="dsplit"><Donut parts={q} center={`${Math.round(supplierShare * 100)}%`} sub="specific" size={124} /><Legend parts={q} unit="t" /></div></DCard>
        <DCard title="By industry sector" span={2}><HBars items={sorted(d.bySector).slice(0, 10).map((r) => ({ n: r.sector, v: v(r), d: 1, p: tot ? (v(r) / tot) * 100 : 0 }))} unit={u === 't' ? 't' : ''} c="var(--s2)" /></DCard>
        <DCard title="Climate targets of suppliers"><div className="dsplit"><Donut parts={tParts} center={`${p.target}`} sub="with a target" size={124} /><Legend parts={tParts} unit="t" /></div></DCard>
        <DCard title="Supplier profiles" span={2} sub={`how much is known about the ${p.suppliers.toLocaleString('en')} suppliers`}>
          <HBars items={([['Country', p.country], ['Vendor number', p.reference], ['Industry', p.industry], ['Sustainability contact', p.contact], ['Reports its emissions', p.reports], ['Has a climate target', p.target], ['Own emission factor', p.own_factor]] as [string, number][])
            .map(([n, x]) => ({ n, v: x, p: p.suppliers ? (x / p.suppliers) * 100 : 0, c: 'var(--primary)' }))} unit="" />
          {p.review > 0 && <div className="sins">{p.review} possible duplicate{p.review === 1 ? '' : 's'} to check under “Check names”.</div>}
        </DCard>
      </div>
      <div className="card flush">
        <div style={{ padding: '12px 14px 4px' }}><h3 style={{ fontSize: 13.5 }}>Largest suppliers · detail</h3></div>
        <div className="scrollx"><table className="t dt">
          <thead><tr><th>#</th><th>Supplier</th><th>Country</th><th>Mainly</th><th className="num">Lines</th><th className="num">Spend (USD)</th><th className="num">tCO₂e</th><th className="num">Share</th><th>Factor</th><th>Profile</th></tr></thead>
          <tbody>{top.map((x, i) => (
            <tr key={x.id} className="click" onClick={() => nav(`/suppliers?open=${x.id}`)}>
              <td className="muted">{i + 1}</td><td><b>{x.name}</b></td><td className="small">{x.country ? countryName(x.country) : <span className="muted">—</span>}</td>
              <td className="small">{x.main_item ?? '—'}</td><td className="num">{x.lines.toLocaleString('en')}</td><td className="num">{usd(x.usd)}</td><td className="num">{tonnes(x.co2e)}</td>
              <td className="num">{tot ? `${((v(x) / tot) * 100).toFixed(1)}%` : ''}</td>
              <td>{x.own_factor ? <span className="chip">own factor</span> : <span className="chip grey">spend-based</span>}</td><td><Completeness v={x.completeness} /></td>
            </tr>))}</tbody>
        </table></div>
      </div>
      <span className="muted small">{fmtV(tot)} in {d.year}</span>
    </div>
  );
}
