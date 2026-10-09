/**
 * Energy certificates & suppliers (Setup).
 *   Certificates & contracts  I-REC / REC / GO / REGO, PPAs, green tariffs: MWh held, technology,
 *                             market, vintage, references; how much entries have claimed.
 *   Supplier factors          market-based factor of the utility / heat / cooling supplier per period
 *                             (company's own; the shared list is kept by the platform admin).
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, num, type Certificate, type Facility, type SupplierFactor } from '../lib/api';
import { Icon } from '../components/Icon';

const TECH = ['solar', 'wind', 'hydro', 'biomass', 'biogas', 'geothermal', 'nuclear', 'other'] as const;
const INSTRUMENT: Record<string, string> = { certificate: 'Certificate (EAC)', ppa: 'Power purchase agreement', green_tariff: 'Green tariff', other: 'Other contract' };
const year = new Date().getFullYear();

export function EnergyRegister() {
  const { role } = useApp();
  const canEdit = ['platform_admin', 'super_admin', 'admin'].includes(role);
  const [tab, setTab] = useState<'certs' | 'suppliers'>('certs');
  return (
    <div className="page">
      <div className="head"><div>
        <div className="eyebrow">Setup · Scope 2</div>
        <h1>Energy certificates & suppliers</h1>
        <p className="sub">What the market-based Scope 2 figure is built from: certificates and contracts you hold, and your suppliers' emission factors.</p>
      </div></div>
      <div className="tabs">
        <button className={tab === 'certs' ? 'on' : ''} onClick={() => setTab('certs')}>Certificates & contracts</button>
        <button className={tab === 'suppliers' ? 'on' : ''} onClick={() => setTab('suppliers')}>Supplier factors</button>
      </div>
      {tab === 'certs' ? <Certificates canEdit={canEdit} /> : <Suppliers canEdit={canEdit} />}
    </div>
  );
}

function Certificates({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Certificate[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [edit, setEdit] = useState<Certificate | 'new' | null>(null);
  const [claims, setClaims] = useState<{ cert: Certificate; list: { kwh: number; period_start: string; facility: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.certificates().then((r) => setRows(r.certificates)).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.facilities().then((r) => setFacilities(r.facilities)); }, []);
  const held = rows.reduce((s, r) => s + Number(r.mwh), 0), used = rows.reduce((s, r) => s + Number(r.claimed_mwh), 0);
  return (
    <div className="card flush">
      <div className="row" style={{ padding: '14px 16px 6px' }}>
        <div className="grow"><h2>Certificates & contracts</h2>
          <p className="sub">Each MWh can be claimed once. Entries claim them when electricity is entered; the tool stops claims beyond what is held. GHG Protocol: same market as the consumption, vintage close to the reporting period, retired on your behalf.</p></div>
        {canEdit && <button className="btn p" onClick={() => setEdit('new')}><Icon name="plus" />Add</button>}
      </div>
      {rows.length > 0 && <div className="sub" style={{ padding: '0 16px 8px' }}>{num(held)} MWh held · {num(used)} MWh claimed · {num(held - used)} MWh left</div>}
      {err && <div className="note bad" style={{ margin: 12 }}>{err}</div>}
      {rows.length ? (
        <div className="scroll">
          <table className="t">
            <thead><tr><th>Type</th><th>Source</th><th>Market</th><th>Vintage</th><th className="num">MWh</th><th className="num">Claimed</th><th className="num">Left</th><th>Reference</th><th>Facility</th>{canEdit && <th />}</tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}>
                <td>{c.standard || INSTRUMENT[c.instrument]}<div className="sub">{INSTRUMENT[c.instrument]}{Number(c.co2e_per_kwh) ? ` · ${num(Number(c.co2e_per_kwh))} kg/kWh` : ''}</div></td>
                <td style={{ textTransform: 'capitalize' }}>{c.technology}</td>
                <td className="mono">{c.market}</td>
                <td className="mono">{c.vintage_from.slice(0, 7)} – {c.vintage_to.slice(0, 7)}</td>
                <td className="num">{num(Number(c.mwh))}</td>
                <td className="num">{c.claims ? <button className="btn ghost sm" onClick={async () => setClaims({ cert: c, list: (await api.certificateClaims(c.id)).claims })}>{num(Number(c.claimed_mwh))}</button> : '0'}</td>
                <td className="num"><b>{num(Number(c.mwh) - Number(c.claimed_mwh))}</b></td>
                <td className="mono sub">{c.reference}{c.supplier && <div>{c.supplier}</div>}</td>
                <td>{c.facility ?? <span className="sub">any</span>}</td>
                {canEdit && <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" aria-label="Edit" onClick={() => setEdit(c)}><Icon name="edit" /></button>
                  {!c.claims && <button className="btn ghost sm" aria-label="Delete" onClick={async () => { setErr(null); try { await api.deleteCertificate(c.id); load(); } catch (e) { setErr((e as Error).message); } }}><Icon name="x" /></button>}
                </td>}
              </tr>))}</tbody>
          </table>
        </div>
      ) : <div className="empty">No certificates or contracts yet.</div>}
      {edit && <CertForm cert={edit === 'new' ? null : edit} facilities={facilities} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {claims && (
        <Modal title={`Claims on ${claims.cert.reference || claims.cert.technology}`} onClose={() => setClaims(null)}>
          <table className="t"><thead><tr><th>Month</th><th>Facility</th><th className="num">kWh</th></tr></thead>
            <tbody>{claims.list.map((k, i) => <tr key={i}><td className="mono">{k.period_start.slice(0, 7)}</td><td>{k.facility}</td><td className="num">{num(Number(k.kwh))}</td></tr>)}</tbody></table>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal wide" onClose={onClose}>
      <div className="in">
        <div className="row"><h2 className="grow">{title}</h2><button className="btn ghost" onClick={() => ref.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </dialog>
  );
}

function CertForm({ cert, facilities, onClose, onSaved }: { cert: Certificate | null; facilities: Facility[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    instrument: cert?.instrument ?? 'certificate', standard: cert?.standard ?? 'I-REC', technology: cert?.technology ?? 'solar',
    mwh: cert ? String(Number(cert.mwh)) : '', co2ePerKwh: cert ? String(Number(cert.co2e_per_kwh)) : '0', market: cert?.market ?? 'AE',
    vintageFrom: cert?.vintage_from ?? `${year}-01-01`, vintageTo: cert?.vintage_to ?? `${year}-12-31`, reference: cert?.reference ?? '', supplier: cert?.supplier ?? '',
    facilityId: cert?.facility_id ?? '', retiredOn: cert?.retired_on ?? '', note: cert?.note ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const b = { ...f, mwh: Number(f.mwh), co2ePerKwh: Number(f.co2ePerKwh || 0), facilityId: f.facilityId || null, retiredOn: f.retiredOn || null, standard: f.standard || null };
    try { cert ? await api.updateCertificate(cert.id, b) : await api.addCertificate(b); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  const locked = !!cert?.claims;
  return (
    <Modal title={cert ? 'Edit certificate / contract' : 'Add a certificate or contract'} onClose={onClose}>
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ width: 220 }}><span>Instrument</span>
          <select className="input" value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value as 'ppa' })}>{Object.entries(INSTRUMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field" style={{ width: 150 }}><span>Standard</span>
          <input className="input" list="standards" value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value })} />
          <datalist id="standards"><option value="I-REC" /><option value="REC" /><option value="GO" /><option value="REGO" /><option value="TIGR" /><option value="DEWA Green Certificate" /></datalist></label>
        <label className="field" style={{ width: 150 }}><span>Source</span>
          <select className="input" value={f.technology} disabled={locked} onChange={(e) => setF({ ...f, technology: e.target.value as 'solar' })}>{TECH.map((t) => <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t}</option>)}</select></label>
        <label className="field" style={{ width: 120 }}><span>MWh</span><input className="input num" inputMode="decimal" value={f.mwh} onChange={(e) => setF({ ...f, mwh: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        <label className="field" style={{ width: 150 }}><span>kg CO₂e / kWh</span><input className="input num" inputMode="decimal" value={f.co2ePerKwh} disabled={locked} onChange={(e) => setF({ ...f, co2ePerKwh: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
      </div>
      <div className="sub">0 for solar, wind, hydro, geothermal and nuclear. For biomass / biogas, the certificate's or supplier's factor if one is stated.{locked ? ' Source and factor cannot change: entries already claim this certificate.' : ''}</div>
      <div className="row" style={{ gap: 8 }}>
        <label className="field" style={{ width: 100 }}><span>Market</span><input className="input mono" maxLength={2} value={f.market} onChange={(e) => setF({ ...f, market: e.target.value.toUpperCase() })} /></label>
        <label className="field" style={{ width: 170 }}><span>Vintage from</span><input className="input" type="date" value={f.vintageFrom} onChange={(e) => setF({ ...f, vintageFrom: e.target.value })} /></label>
        <label className="field" style={{ width: 170 }}><span>Vintage to</span><input className="input" type="date" value={f.vintageTo} onChange={(e) => setF({ ...f, vintageTo: e.target.value })} /></label>
        <label className="field" style={{ width: 170 }}><span>Retired on</span><input className="input" type="date" value={f.retiredOn} onChange={(e) => setF({ ...f, retiredOn: e.target.value })} /></label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Reference (registry, serial numbers, contract no.)</span><input className="input mono" value={f.reference} maxLength={500} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        <label className="field" style={{ width: 200 }}><span>Seller / generator</span><input className="input" value={f.supplier} maxLength={120} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></label>
        <label className="field" style={{ width: 220 }}><span>For facility</span>
          <select className="input" value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })}><option value="">Any facility</option>{facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
      <label className="field"><span>Note</span><input className="input" value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn p" disabled={!(Number(f.mwh) > 0) || f.market.length !== 2} onClick={save}>{cert ? 'Save' : 'Add'}</button>
      </div>
    </Modal>
  );
}

export function Suppliers({ canEdit, platform }: { canEdit: boolean; platform?: boolean }) {
  const [rows, setRows] = useState<SupplierFactor[]>([]);
  const [f, setF] = useState({ supplier: '', energy: 'electricity' as 'electricity' | 'heat' | 'cooling', co2e: '', unit: 'kWh_e', from: `${year}-01`, to: `${year}-12`, renewablePct: '', source: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.supplierFactors().then((r) => setRows(r.suppliers)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const unitsFor = (e: string) => (e === 'electricity' ? [['kWh_e', 'kWh']] : e === 'heat' ? [['kWh_th', 'kWh'], ['GJ_th', 'GJ'], ['MMBtu_th', 'MMBtu']] : [['TRh', 'TRh'], ['kWh_c', 'kWh of cooling']]);
  const last = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };
  const add = async () => {
    setErr(null);
    try {
      await api.addSupplierFactor({ supplier: f.supplier, energy: f.energy, co2e: Number(f.co2e), unit: f.unit, validFrom: `${f.from}-01`, validTo: last(f.to), renewablePct: f.renewablePct ? Number(f.renewablePct) : undefined, source: f.source });
      setF({ ...f, co2e: '', source: '' }); load();
    } catch (e) { setErr((e as Error).message); }
  };
  const shown = rows.filter((r) => (platform ? r.shared : true));
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div><h2>{platform ? 'Supplier factors (shared list)' : 'Supplier factors'}</h2>
        <p className="sub">The emission factor your supplier publishes for what it delivers (market-based Scope 2): a utility's kg CO₂e per kWh, a district-cooling company's kg CO₂e per TRh. Use the figure for the period, from its sustainability report or your bill. {platform ? 'Shared with every company.' : 'The shared list kept by the platform also appears when entering data.'}</p></div>
      {canEdit && (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 200 }}><span>Supplier</span><input className="input" value={f.supplier} maxLength={120} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="e.g. SEWA, Empower" /></label>
          <label className="field" style={{ width: 140 }}><span>Energy</span>
            <select className="input" value={f.energy} onChange={(e) => { const en = e.target.value as 'heat'; setF({ ...f, energy: en, unit: unitsFor(en)[0]![0]! }); }}><option value="electricity">Electricity</option><option value="heat">Heat & steam</option><option value="cooling">Cooling</option></select></label>
          <label className="field" style={{ width: 130 }}><span>kg CO₂e</span><input className="input num" inputMode="decimal" value={f.co2e} onChange={(e) => setF({ ...f, co2e: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="field" style={{ width: 120 }}><span>per</span><select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{unitsFor(f.energy).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className="field" style={{ width: 140 }}><span>From month</span><input className="input" type="month" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field" style={{ width: 140 }}><span>To month</span><input className="input" type="month" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <label className="field" style={{ width: 110 }}><span>Renewable %</span><input className="input num" inputMode="decimal" value={f.renewablePct} onChange={(e) => setF({ ...f, renewablePct: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="field grow" style={{ minWidth: 220 }}><span>Source</span><input className="input" value={f.source} maxLength={200} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Report, page, year" /></label>
          <button className="btn p" disabled={f.supplier.trim().length < 2 || f.co2e === '' || f.source.trim().length < 2} onClick={add}><Icon name="plus" />Add</button>
        </div>
      )}
      {err && <div className="note bad">{err}</div>}
      {shown.length ? (
        <div className="scroll" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          <table className="t">
            <thead><tr><th>Supplier</th><th>Energy</th><th className="num">kg CO₂e</th><th>Period</th><th className="num">Renewable</th><th>Source</th>{!platform && <th>List</th>}{canEdit && <th />}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <td><b>{r.supplier}</b></td><td style={{ textTransform: 'capitalize' }}>{r.energy}</td>
                <td className="num">{num(Number(r.co2e))} / {r.unit === 'TRh' ? 'TRh' : r.unit.replace(/_.*/, '')}</td>
                <td className="mono">{r.valid_from.slice(0, 7)} – {r.valid_to.slice(0, 7)}</td>
                <td className="num">{r.renewable_pct != null ? `${num(Number(r.renewable_pct))}%` : ''}</td>
                <td>{r.source}</td>
                {!platform && <td>{r.shared ? <span className="chip grey">shared</span> : <span className="chip">own</span>}</td>}
                {canEdit && <td>{(platform ? r.shared : !r.shared) && <button className="btn ghost sm" aria-label="Delete" onClick={async () => { setErr(null); try { await api.deleteSupplierFactor(r.id); load(); } catch (e) { setErr((e as Error).message); } }}><Icon name="x" /></button>}</td>}
              </tr>))}</tbody>
          </table>
        </div>
      ) : <div className="empty">No supplier factors yet.</div>}
    </div>
  );
}
