/**
 * Grid regions and their electricity factors (platform admin).
 *   Regions: country averages (AE) and sub-regions — emirate / state / grid (AE-DU, US-CAMX…).
 *   Per region and year: location-based grid factor, residual mix (market-based), T&D losses
 *   (kg/kWh or a loss %), upstream (well-to-tank). UK values come from DESNZ.
 * Also: the shared supplier-factor list and the shared fuel price list.
 */
import { useEffect, useState } from 'react';
import { api, num, type GridRegion } from '../../lib/api';
import { Prices } from '../../components/Prices';
import { Suppliers } from '../EnergyRegister';
import { Icon } from '../../components/Icon';

const KIND = { location: 'Grid factor (location-based)', residual: 'Residual mix (market-based)', td_loss: 'T&D losses (Scope 3.3)', wtt: 'Upstream of generation (Scope 3.3)' } as const;
type Kind = keyof typeof KIND;
const BASIS_KIND: Record<string, Kind> = { scope2: 'location', scope2_market: 'residual', td_loss: 'td_loss', wtt: 'wtt' };

export function GridTab() {
  const [regions, setRegions] = useState<GridRegion[]>([]);
  const [country, setCountry] = useState('AE');
  const [f, setF] = useState({ region: 'AE', kind: 'location' as Kind, year: String(new Date().getFullYear()), co2e: '', lossPct: '', asPct: true, source: '', reference: '' });
  const [nr, setNr] = useState({ code: '', name: '', kind: 'subnational' as 'subnational' | 'grid' | 'country' });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const load = () => api.gridRegions().then((r) => setRegions(r.regions));
  useEffect(() => { load(); }, []);
  const countries = [...new Set(regions.map((r) => r.country))];
  const shown = regions.filter((r) => r.country === country);
  const years = [...new Set(shown.flatMap((r) => (r.factors ?? []).map((x) => x.year)))].sort((a, b) => b - a);

  const add = async () => {
    setErr(null); setOk(null);
    try {
      const pct = f.kind === 'td_loss' && f.asPct;
      const r = await api.addRegionFactor(f.region, { kind: f.kind, year: Number(f.year), ...(pct ? { lossPct: Number(f.lossPct) } : { co2e: Number(f.co2e) }), source: f.source.trim(), reference: f.reference.trim() || undefined });
      setOk(`${KIND[f.kind]} for ${f.region} ${f.year} saved: ${num(r.co2e)} kg CO₂e/kWh. Recalculate entries with warnings to apply it.`);
      setF({ ...f, co2e: '', lossPct: '' }); load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div><h2>Grid regions & electricity factors</h2>
          <p className="sub">Location-based Scope 2 uses the factor of the facility's grid region: a sub-region (emirate, state, grid) when it has a factor, else the country average. Market-based uses certificates and supplier factors first, then the region's residual mix, then the grid average. UK factors come from DESNZ; enter others with their source (e.g. the utility's sustainability report, the national inventory).</p></div>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ width: 120 }}><span>Country</span>
            <select className="input" value={country} onChange={(e) => { setCountry(e.target.value); setF({ ...f, region: e.target.value }); }}>{countries.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <div className="scroll" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          <table className="t">
            <thead><tr><th>Region</th><th>Code</th><th>Kind</th>{years.length ? years.map((y) => <th key={y} className="num">{y}</th>) : <th>Factors</th>}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.code}>
                <td>{r.name}</td><td className="mono">{r.code}</td><td>{r.kind}</td>
                {years.length ? years.map((y) => {
                  const fs = (r.factors ?? []).filter((x) => x.year === y);
                  return <td key={y} className="num" style={{ fontSize: 12 }}>{fs.map((x) => <div key={x.id} title={`${x.source}${x.note ? ` — ${x.note}` : ''}`}><span className="sub">{({ scope2: 'grid', scope2_market: 'residual', td_loss: 'T&D', wtt: 'upstream' } as Record<string, string>)[x.basis]}</span> {num(Number(x.co2e))}</div>)}</td>;
                }) : <td className="sub">none yet</td>}
              </tr>))}</tbody>
          </table>
        </div>

        <fieldset className="box">
          <legend>Add a factor</legend>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 210 }}><span>Region</span>
              <select className="input" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>{shown.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}</select></label>
            <label className="field" style={{ width: 250 }}><span>Factor</span>
              <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field" style={{ width: 90 }}><span>Year</span><input className="input mono" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '') })} /></label>
            {f.kind === 'td_loss' && (
              <label className="row" style={{ gap: 6, fontSize: 13, paddingBottom: 10 }}><input type="checkbox" checked={f.asPct} onChange={(e) => setF({ ...f, asPct: e.target.checked })} />as loss %</label>
            )}
            {f.kind === 'td_loss' && f.asPct
              ? <label className="field" style={{ width: 120 }}><span>Losses %</span><input className="input num" inputMode="decimal" value={f.lossPct} onChange={(e) => setF({ ...f, lossPct: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
              : <label className="field" style={{ width: 150 }}><span>kg CO₂e per kWh</span><input className="input num" inputMode="decimal" value={f.co2e} onChange={(e) => setF({ ...f, co2e: e.target.value.replace(/[^0-9.]/g, '') })} /></label>}
            <label className="field" style={{ width: 170 }}><span>Source (short)</span><input className="input" maxLength={40} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="e.g. DEWA 2024" /></label>
            <label className="field grow"><span>Reference (report, page, link)</span><input className="input" maxLength={200} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
            <button className="btn p" disabled={f.year.length !== 4 || f.source.trim().length < 2 || (f.kind === 'td_loss' && f.asPct ? !(Number(f.lossPct) > 0) : f.co2e === '')} onClick={add}>Add</button>
          </div>
          {f.kind === 'td_loss' && f.asPct && <div className="sub">Losses as % of electricity delivered: T&D factor = loss % × the region's grid factor of that year (add the grid factor first).</div>}
          {f.kind === 'residual' && <div className="sub">The residual mix is the grid mix once certificates and contracts sold to others are removed (e.g. AIB for Europe). Where none is published, market-based falls back to the grid average, with a disclosure note.</div>}
        </fieldset>
        {err && <div className="note bad">{err}</div>}
        {ok && <div className="note info">{ok}</div>}

        <fieldset className="box">
          <legend>Add a region</legend>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 140 }}><span>Code</span><input className="input mono" value={nr.code} maxLength={13} placeholder="AE-DU / US-CAMX" onChange={(e) => setNr({ ...nr, code: e.target.value.toUpperCase() })} /></label>
            <label className="field grow"><span>Name</span><input className="input" value={nr.name} maxLength={120} onChange={(e) => setNr({ ...nr, name: e.target.value })} placeholder="e.g. Dubai (DEWA)" /></label>
            <label className="field" style={{ width: 200 }}><span>Kind</span>
              <select className="input" value={nr.kind} onChange={(e) => setNr({ ...nr, kind: e.target.value as 'grid' })}><option value="country">Country average</option><option value="subnational">State / emirate / province</option><option value="grid">Grid sub-region</option></select></label>
            <button className="btn" disabled={!/^[A-Z]{2}(-[A-Z0-9]{1,10})?$/.test(nr.code) || nr.name.trim().length < 2} onClick={async () => {
              setErr(null); try { await api.addGridRegion(nr); setCountry(nr.code.slice(0, 2)); setNr({ code: '', name: '', kind: 'subnational' }); load(); } catch (e) { setErr((e as Error).message); }
            }}><Icon name="plus" />Add region</button>
          </div>
        </fieldset>
      </div>
      <Suppliers canEdit platform />
      <Prices platform />
    </div>
  );
}

export { BASIS_KIND };
