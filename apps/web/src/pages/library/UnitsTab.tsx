/**
 * Units & conversions. Each unit has one number: its size in the base unit of
 * its measure (e.g. 1 US gallon = 3.785411784 L). The matrix below is derived
 * from those numbers, so it is always consistent. Click a value to correct it.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../App';
import { api, num, type Unit } from '../../lib/api';

const DIM_LABEL: Record<string, string> = { mass: 'Mass', volume: 'Volume', energy_net: 'Energy — net calorific value', energy_gross: 'Energy — gross calorific value' };

export function UnitsTab() {
  const { toast } = useApp();
  const [units, setUnits] = useState<Unit[]>([]);
  const [dim, setDim] = useState('mass');
  const [edit, setEdit] = useState<{ code: string; value: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nu, setNu] = useState({ code: '', name: '', toBase: '' });
  const load = () => api.units().then((u) => setUnits(u.units));
  useEffect(() => { load(); }, []);

  const dims = [...new Set(units.map((u) => u.dimension))];
  const list = units.filter((u) => u.dimension === dim && u.active);
  const base = list.find((u) => u.is_base);

  async function saveEdit() {
    if (!edit) return;
    setErr(null);
    try { await api.updateUnit(edit.code, { toBase: Number(edit.value) }); toast('Unit updated — every conversion with it follows'); setEdit(null); load(); }
    catch (e) { setErr((e as Error).message); }
  }
  async function add() {
    setErr(null);
    try { await api.addUnit({ code: nu.code, name: nu.name, dimension: dim, toBase: Number(nu.toBase) }); setNu({ code: '', name: '', toBase: '' }); toast('Unit added'); load(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="seg">{dims.map((d) => <button key={d} className={d === dim ? 'on' : ''} onClick={() => setDim(d)}>{DIM_LABEL[d] ?? d}</button>)}</div>
      <div className="note info">Net and gross energy are separate on purpose: the ratio between them depends on the fuel, so it is never a fixed unit conversion. Bills in the UAE and UK usually state gross values (therm, MMBtu).</div>
      {err && <div className="note bad">{err}</div>}
      <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)' }}>
        <div className="card flush">
          <table className="t">
            <thead><tr><th>Unit</th><th className="num">= how many {base?.name}</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.code}>
                <td>{u.name} <span className="mono sub">{u.code}</span>{u.is_base && <span className="chip" style={{ marginLeft: 6 }}>base</span>}</td>
                <td className="num">{edit?.code === u.code
                  ? <input className="input num" autoFocus style={{ width: 160 }} value={edit.value} onChange={(e) => setEdit({ code: u.code, value: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} />
                  : num(u.to_base, 12)}</td>
                <td>{!u.is_base && (edit?.code === u.code
                  ? <><button className="btn sm p" onClick={saveEdit}>Save</button> <button className="btn sm ghost" onClick={() => setEdit(null)}>Cancel</button></>
                  : <button className="btn sm ghost" onClick={() => setEdit({ code: u.code, value: String(u.to_base) })}>Edit</button>)}</td>
              </tr>))}
            </tbody>
          </table>
          <div className="row" style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
            <input className="input" style={{ width: 90 }} placeholder="code" value={nu.code} onChange={(e) => setNu({ ...nu, code: e.target.value })} />
            <input className="input grow" placeholder="name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
            <input className="input num" style={{ width: 120 }} placeholder={`= ? ${base?.code ?? ''}`} value={nu.toBase} onChange={(e) => setNu({ ...nu, toBase: e.target.value })} />
            <button className="btn sm" disabled={!nu.code || !nu.name || !(Number(nu.toBase) > 0)} onClick={add}>Add unit</button>
          </div>
        </div>
        <div className="card flush" style={{ overflow: 'auto' }}>
          <div style={{ padding: '12px 14px 4px' }}><h3>Conversion matrix</h3><p className="sub">1 unit in the row = value × unit in the column</p></div>
          <table className="t">
            <thead><tr><th />{list.map((c) => <th key={c.code} className="num">{c.code}</th>)}</tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.code}><td><b className="mono">{r.code}</b></td>{list.map((c) => <td key={c.code} className="num" style={r.code === c.code ? { color: 'var(--muted)' } : undefined}>{num(r.to_base / c.to_base, 6)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
