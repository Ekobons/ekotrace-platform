/**
 * Grid electricity factors per country (Scope 2, location-based) — used for EV
 * charging now, for purchased electricity later. UK values come from DESNZ;
 * other countries are entered here with their source.
 */
import { useEffect, useState } from 'react';
import { api, num, type Factor } from '../../lib/api';
import { Prices } from '../../components/Prices';

export function GridTab() {
  const [gridId, setGridId] = useState<number | null>(null);
  const [rows, setRows] = useState<Factor[]>([]);
  const [f, setF] = useState({ region: 'AE', year: String(new Date().getFullYear()), co2e: '', source: '', title: '' });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const load = (id: number) => api.factors({ itemId: id, limit: 500 }).then((r) => setRows(r.factors));
  useEffect(() => {
    api.catalogue(true).then((c) => {
      const it = c.categories.flatMap((x) => x.subcategories).flatMap((s) => s.items).find((i) => i.code === 'grid:electricity');
      if (it) { setGridId(it.id); load(it.id); }
    });
  }, []);
  const add = async () => {
    setErr(null); setOk(null);
    try {
      await api.addFactor({ itemId: gridId, sourceCode: f.source.trim().slice(0, 40), sourceTitle: f.title.trim() || undefined, region: f.region.toUpperCase(), basis: 'scope2', unit: 'kWh_e',
        co2e: Number(f.co2e), validFrom: `${f.year}-01-01`, validTo: `${f.year}-12-31` });
      setOk(`Saved: ${f.region.toUpperCase()} ${f.year} = ${f.co2e} kg CO₂e/kWh. Entries are recalculated when saved again.`);
      setF({ ...f, co2e: '' });
      load(gridId!);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div><h2>Grid electricity factors</h2>
          <p className="sub">kg CO₂e per kWh of grid electricity, per country and year (Scope 2, location-based). Used for electric-vehicle charging. UK values come from DESNZ; for the UAE use the utility's or the national published factor and name it as the source.</p></div>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 90 }}><span>Country</span><input className="input mono" value={f.region} maxLength={2} onChange={(e) => setF({ ...f, region: e.target.value.toUpperCase() })} /></label>
          <label className="field" style={{ width: 100 }}><span>Year</span><input className="input mono" value={f.year} maxLength={4} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="field" style={{ width: 170 }}><span>kg CO₂e per kWh</span><input className="input num" inputMode="decimal" value={f.co2e} onChange={(e) => setF({ ...f, co2e: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0.000" /></label>
          <label className="field" style={{ width: 200 }}><span>Source (short)</span><input className="input" value={f.source} maxLength={40} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="e.g. DEWA 2024" /></label>
          <label className="field grow"><span>Reference (report, page, link)</span><input className="input" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <button className="btn p" disabled={!gridId || !(Number(f.co2e) > 0) || f.region.length !== 2 || f.year.length !== 4 || f.source.trim().length < 2} onClick={add}>Add</button>
        </div>
        {err && <div className="note bad">{err}</div>}
        {ok && <div className="note info">{ok}</div>}
        <div className="scroll" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
          <table className="t">
            <thead><tr><th>Country</th><th>Year</th><th className="num">kg CO₂e / kWh</th><th>Source</th><th>Version</th></tr></thead>
            <tbody>{rows.sort((a, b) => a.region.localeCompare(b.region) || b.valid_from.localeCompare(a.valid_from)).map((r) => (
              <tr key={r.id}><td className="mono">{r.region}</td><td>{r.valid_from.slice(0, 4)}</td><td className="num">{num(Number(r.co2e))}</td><td>{r.source}</td><td>v{r.version}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
      <Prices platform />
    </div>
  );
}
