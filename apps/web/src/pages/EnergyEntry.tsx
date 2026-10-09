/**
 * Add data — Electricity, heat & cooling (Scope 2).
 *   Electricity  kWh / MWh; grid region (facility's by default); market-based: certificates claimed,
 *                supplier factor (from the list or typed in); else residual mix / grid average.
 *   Heat & steam kWh / MWh / GJ / MMBtu; UK DESNZ factor, else the supplier's.
 *   Cooling      TRh / kWh; supplier factor per TRh, or plant efficiency (kWh per TRh, or COP) × grid.
 * Location- and market-based are shown side by side, with T&D losses and upstream (Scope 3.3).
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { api, ApiError, num, tco2e, type CalcResponse, type Category, type Certificate, type GridRegion, type SupplierFactor } from '../lib/api';
import { Result } from '../components/Result';
import { MonthGrid } from '../components/MonthGrid';

const UNITS: Record<string, [string, string][]> = {
  grid: [['kWh_e', 'kWh'], ['MWh_e', 'MWh']],
  heat_steam: [['kWh_th', 'kWh'], ['MWh_th', 'MWh'], ['GJ_th', 'GJ'], ['MMBtu_th', 'MMBtu']],
  cooling: [['TRh', 'TRh (ton-hour)'], ['kWh_c', 'kWh of cooling'], ['MWh_c', 'MWh of cooling']],
};
const ENERGY: Record<string, 'electricity' | 'heat' | 'cooling'> = { grid: 'electricity', heat_steam: 'heat', cooling: 'cooling' };
const TECH: Record<string, string> = { solar: 'Solar', wind: 'Wind', hydro: 'Hydro', biomass: 'Biomass', biogas: 'Biogas', geothermal: 'Geothermal', nuclear: 'Nuclear', other: 'Other' };

export function EnergyEntry({ cat, facilityId, facilityRegion, country, period, onSaved, monthly }: {
  cat: Category; facilityId: string; facilityRegion: string | null; country: string; period: { periodStart: string; periodEnd: string }; onSaved: () => void;
  /** month by month for this year */
  monthly?: number;
}) {
  const { toast } = useApp();
  const [subCode, setSubCode] = useState('grid');
  const sub = cat.subcategories.find((s) => s.code === subCode);
  const item = sub?.items[0];
  const energy = ENERGY[subCode]!;
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('kWh_e');
  const [region, setRegion] = useState<string>('');
  const [regions, setRegions] = useState<GridRegion[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierFactor[]>([]);
  const [supplierMode, setSupplierMode] = useState<'none' | 'list' | 'typed'>('none');
  const [supplierId, setSupplierId] = useState('');
  const [typed, setTyped] = useState({ name: '', co2e: '', source: '' });
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [coolMethod, setCoolMethod] = useState<'supplier' | 'efficiency'>('supplier');
  const [eff, setEff] = useState({ kind: 'kwhPerTrh' as 'kwhPerTrh' | 'cop', value: '' });
  const [dataType, setDataType] = useState('actual');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<CalcResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.gridRegions().then((r) => setRegions(r.regions)).catch(() => setRegions([])); }, []);
  useEffect(() => { setUnit(UNITS[subCode]![0]![0]); setSupplierMode(subCode === 'grid' ? 'none' : 'list'); setSupplierId(''); setClaims({}); setResult(null); }, [subCode]);
  useEffect(() => { api.supplierFactors(energy).then((r) => setSuppliers(r.suppliers)).catch(() => setSuppliers([])); }, [energy]);
  useEffect(() => {
    if (!facilityId || energy !== 'electricity') { setCerts([]); return; }
    api.certificates({ facilityId, usable: true }).then((r) => setCerts(r.certificates)).catch(() => setCerts([]));
  }, [facilityId, energy]);
  useEffect(() => { setRegion(''); }, [facilityId]);

  const regionsHere = regions.filter((g) => g.country === country);
  const effectiveRegion = region || facilityRegion || country;
  const forPeriod = suppliers.filter((s) => s.valid_from <= period.periodEnd && s.valid_to >= period.periodStart);
  const otherSuppliers = suppliers.filter((s) => !forPeriod.includes(s));
  const supUnit = energy === 'electricity' ? 'kWh_e' : energy === 'heat' ? 'kWh_th' : 'TRh';

  const payload = useMemo(() => {
    if (!item || quantity === '' || !facilityId) return null;
    const certificates = Object.entries(claims).filter(([, v]) => Number(v) > 0).map(([certificateId, v]) => ({ certificateId, kwh: Number(v) }));
    const e: Record<string, unknown> = {};
    if (region) e.gridRegion = region;
    if (supplierMode === 'list' && supplierId) e.supplierFactorId = supplierId;
    if (supplierMode === 'typed' && typed.name && typed.co2e !== '' && typed.source.length >= 2) e.supplier = { name: typed.name, co2e: Number(typed.co2e), unit: supUnit, source: typed.source };
    if (certificates.length) e.certificates = certificates;
    if (energy === 'cooling') e.cooling = coolMethod === 'supplier' ? { method: 'supplier' } : { method: 'efficiency', [eff.kind]: Number(eff.value) || undefined };
    return { itemId: item.id, unit, quantity: Number(quantity), facilityId, ...period, energy: e };
  }, [item, quantity, unit, facilityId, period, region, supplierMode, supplierId, typed, claims, energy, coolMethod, eff, supUnit]);

  /** Month by month: same supplier, region and plant; each month's reading. Certificates are claimed month by month. */
  const buildMonth = useMemo(() => (q: number, p: { periodStart: string; periodEnd: string }) => {
    if (!item || !facilityId) return null;
    const e: Record<string, unknown> = {};
    if (region) e.gridRegion = region;
    if (supplierMode === 'list') { if (!supplierId) return null; e.supplierFactorId = supplierId; }
    if (supplierMode === 'typed') { if (!(typed.name && typed.co2e !== '' && typed.source.length >= 2)) return null; e.supplier = { name: typed.name, co2e: Number(typed.co2e), unit: supUnit, source: typed.source }; }
    if (energy === 'cooling') e.cooling = coolMethod === 'supplier' ? { method: 'supplier' } : { method: 'efficiency', [eff.kind]: Number(eff.value) || undefined };
    return { itemId: item.id, unit, quantity: q, ...p, energy: e };
  }, [item, unit, facilityId, region, supplierMode, supplierId, typed, energy, coolMethod, eff, supUnit]);

  useEffect(() => {
    setError(null);
    if (!payload) { setResult(null); return; }
    const t = window.setTimeout(() => api.calculate(payload).then(setResult).catch((e: ApiError) => { setResult(null); setError(e.message); }), 300);
    return () => window.clearTimeout(t);
  }, [payload]);

  const save = async () => {
    if (!payload) return;
    try {
      const r = await api.saveActivity({ ...payload, dataType, note: note || undefined });
      toast(`Saved: ${tco2e(r.totals.scope2)} tCO₂e location-based · ${tco2e(r.totals.scope2_market)} tCO₂e market-based`);
      setQuantity(''); setNote(''); setClaims({}); onSaved();
      if (energy === 'electricity') api.certificates({ facilityId, usable: true }).then((x) => setCerts(x.certificates));
    } catch (e) { setError((e as Error).message); }
  };

  const kwhTotal = Number(quantity || 0) * (unit === 'MWh_e' ? 1000 : 1);
  const claimed = Object.values(claims).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <div className="grid2">
      <div className="card" style={{ padding: 12 }}>
        <div className="eyebrow" style={{ padding: '4px 8px 8px' }}>Energy bought</div>
        <div className="list">
          {cat.subcategories.map((s) => <button key={s.id} className={s.code === subCode ? 'on' : ''} onClick={() => setSubCode(s.code)}><span>{s.name}</span></button>)}
        </div>
        <p className="sub" style={{ padding: '10px 8px 0', fontSize: 12 }}>
          Both Scope 2 figures are reported: <b>location-based</b> (grid average of the region) and <b>market-based</b> (what you buy: certificates, contracts, supplier).
          T&D losses and upstream emissions go to Scope 3.3.
        </p>
      </div>

      <div className="card" style={{ display: 'grid', gap: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          {!monthly && <label className="field" style={{ width: 170 }}>
            <span>{energy === 'cooling' ? 'Cooling used' : energy === 'heat' ? 'Heat / steam used' : 'Electricity used'}</span>
            <input className="input num" inputMode="decimal" value={quantity} placeholder="0" onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>}
          <label className="field" style={{ width: 170 }}><span>Unit</span>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>{UNITS[subCode]!.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          {energy !== 'heat' && (
            <label className="field grow" style={{ minWidth: 240 }}><span>Grid region (location-based)</span>
              <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Facility's: {regions.find((g) => g.code === (facilityRegion || country))?.name ?? (facilityRegion || country)}</option>
                {regionsHere.map((g) => <option key={g.code} value={g.code}>{g.name} ({g.code})</option>)}
              </select></label>
          )}
        </div>
        {energy !== 'heat' && !regions.find((g) => g.code === effectiveRegion)?.factors?.some((f) => f.basis === 'scope2') && (
          <div className="sub">No grid factor for {effectiveRegion} yet{effectiveRegion.includes('-') ? ` — the ${effectiveRegion.slice(0, 2)} national average is used if it has one` : ''}. The platform admin adds it in the factor library.</div>
        )}

        {energy === 'cooling' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="seg" style={{ justifySelf: 'start' }}>
              <button className={coolMethod === 'supplier' ? 'on' : ''} onClick={() => setCoolMethod('supplier')}>Supplier's factor</button>
              <button className={coolMethod === 'efficiency' ? 'on' : ''} onClick={() => setCoolMethod('efficiency')}>Plant efficiency × grid</button>
            </div>
            {coolMethod === 'efficiency' && (
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label className="field" style={{ width: 220 }}><span>Efficiency given as</span>
                  <select className="input" value={eff.kind} onChange={(e) => setEff({ ...eff, kind: e.target.value as 'cop' })}><option value="kwhPerTrh">kWh of electricity per TRh</option><option value="cop">COP (cooling ÷ electricity)</option></select></label>
                <label className="field" style={{ width: 140 }}><span>{eff.kind === 'cop' ? 'COP' : 'kWh per TRh'}</span>
                  <input className="input num" inputMode="decimal" value={eff.value} placeholder={eff.kind === 'cop' ? 'e.g. 4.5' : 'e.g. 0.85'} onChange={(e) => setEff({ ...eff, value: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
                <span className="sub" style={{ paddingBottom: 10 }}>From the supplier's sustainability report or the plant's records.</span>
              </div>
            )}
          </div>
        )}

        {(energy !== 'cooling' || coolMethod === 'supplier') && (
          <fieldset className="box">
            <legend>{energy === 'electricity' ? 'Market-based: supplier factor (optional)' : "Supplier's factor"}</legend>
            <div className="seg" style={{ justifySelf: 'start' }}>
              {energy === 'electricity' && <button className={supplierMode === 'none' ? 'on' : ''} onClick={() => setSupplierMode('none')}>None — residual mix / grid average</button>}
              <button className={supplierMode === 'list' ? 'on' : ''} onClick={() => setSupplierMode('list')}>From the list</button>
              <button className={supplierMode === 'typed' ? 'on' : ''} onClick={() => setSupplierMode('typed')}>Enter it</button>
            </div>
            {supplierMode === 'list' && (
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{suppliers.length ? 'Choose…' : 'No supplier factors yet — add them under Energy certificates & suppliers'}</option>
                {forPeriod.length > 0 && <optgroup label="Valid for this period">{forPeriod.map((s) => <option key={s.id} value={s.id}>{s.supplier} · {num(Number(s.co2e))} kg/{s.unit.replace(/_.*/, '')} · {s.valid_from.slice(0, 7)}–{s.valid_to.slice(0, 7)}{s.shared ? ' · shared' : ''}</option>)}</optgroup>}
                {otherSuppliers.length > 0 && <optgroup label="Other periods">{otherSuppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier} · {num(Number(s.co2e))} kg/{s.unit.replace(/_.*/, '')} · {s.valid_from.slice(0, 7)}–{s.valid_to.slice(0, 7)}</option>)}</optgroup>}
              </select>
            )}
            {supplierMode === 'typed' && (
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <label className="field" style={{ width: 180 }}><span>Supplier</span><input className="input" value={typed.name} maxLength={120} onChange={(e) => setTyped({ ...typed, name: e.target.value })} /></label>
                <label className="field" style={{ width: 160 }}><span>kg CO₂e per {energy === 'cooling' ? 'TRh' : 'kWh'}</span><input className="input num" inputMode="decimal" value={typed.co2e} onChange={(e) => setTyped({ ...typed, co2e: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
                <label className="field grow"><span>Source (report, bill, year)</span><input className="input" value={typed.source} maxLength={200} onChange={(e) => setTyped({ ...typed, source: e.target.value })} /></label>
              </div>
            )}
          </fieldset>
        )}

        {energy === 'electricity' && monthly && <div className="sub">Certificates and contracts are claimed one month at a time: choose a month to claim them.</div>}
        {energy === 'electricity' && !monthly && (
          <fieldset className="box">
            <legend>Market-based: certificates & contracts claimed (optional)</legend>
            {certs.length ? (
              <table className="t">
                <thead><tr><th>Certificate / contract</th><th>Vintage</th><th className="num">MWh left</th><th className="num">Claim (kWh)</th></tr></thead>
                <tbody>{certs.map((c) => {
                  const left = Number(c.mwh) - Number(c.claimed_mwh);
                  return (
                    <tr key={c.id}>
                      <td><b>{TECH[c.technology]}</b> · {c.standard || c.instrument.replace('_', ' ')} {c.reference && <span className="sub mono">{c.reference}</span>}<div className="sub">{c.market}{c.facility ? ` · ${c.facility} only` : ''}{Number(c.co2e_per_kwh) ? ` · ${num(Number(c.co2e_per_kwh))} kg/kWh` : ' · 0 kg/kWh'}</div></td>
                      <td className="mono">{c.vintage_from.slice(0, 7)} – {c.vintage_to.slice(0, 7)}</td>
                      <td className="num">{num(left)}</td>
                      <td className="num"><input className="input num sm" style={{ width: 120 }} inputMode="decimal" value={claims[c.id] ?? ''} placeholder="0"
                        onChange={(e) => setClaims({ ...claims, [c.id]: e.target.value.replace(/[^0-9.]/g, '') })} />
                        {kwhTotal > 0 && !claims[c.id] && <button className="btn ghost sm" onClick={() => setClaims({ ...claims, [c.id]: String(Math.max(0, Math.min(left * 1000, kwhTotal - claimed))) })}>Cover</button>}
                      </td>
                    </tr>);
                })}</tbody>
              </table>
            ) : <div className="sub">No certificates with MWh left for this facility. Add I-RECs, RECs, GOs, PPAs or green tariffs under Energy certificates & suppliers.</div>}
            {claimed > 0 && <div className="sub">{num(claimed)} kWh of {num(kwhTotal)} kWh covered by certificates{claimed > kwhTotal ? ' — more than the electricity used' : ''}.</div>}
          </fieldset>
        )}

        {monthly ? <MonthGrid year={monthly} facilityId={facilityId} build={buildMonth} onSaved={onSaved} bases={['scope2', 'scope2_market']}
          label={energy === 'cooling' ? 'Cooling used' : energy === 'heat' ? 'Heat / steam used' : 'Electricity used'}
          unitName={UNITS[subCode]!.find(([c]) => c === unit)?.[1] ?? unit}
          hint="Tip: copy the 12 monthly readings from the bills or the meter sheet (a row or a column) and paste them into January."
          dup={{ category: 'purchased_electricity', same: (a) => a.item === item?.name }} /> : <>
        <div className="row">
          <label className="field" style={{ width: 160 }}><span>Data type</span>
            <select className="input" value={dataType} onChange={(e) => setDataType(e.target.value)}><option value="actual">Actual</option><option value="estimated">Estimated</option><option value="proxy">Proxy</option></select></label>
          <label className="field grow"><span>Note / reference</span><input className="input" value={note} maxLength={1000} placeholder="Bill number, meter, account…" onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        {error && <div className="note bad">{error}</div>}
        {result ? <Result r={result} energy /> : !error && <div className="note info">Enter the {energy === 'cooling' ? 'cooling' : energy === 'heat' ? 'heat' : 'electricity'} used to see both Scope 2 figures and how they were calculated.</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn p" disabled={!result || !facilityId} onClick={save}>Save entry</button>
        </div></>}
      </div>
    </div>
  );
}
