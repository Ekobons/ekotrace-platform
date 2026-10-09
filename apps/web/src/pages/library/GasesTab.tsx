/** Gases and their global warming potentials in each IPCC report. */
import { useEffect, useState } from 'react';
import { api, num } from '../../lib/api';

export function GasesTab() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.gases>> | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { api.gases().then(setData); }, []);
  if (!data) return <div className="card empty">Loading…</div>;
  const rows = data.gases.filter((g) => !q || `${g.code} ${g.name} ${g.family}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="total">{data.gwpSets.map((s) => <div key={s.code} className="stat"><b>{s.code}</b><small>{s.name}<br />{s.note}</small></div>)}</div>
      <div className="note info">Each company chooses its GWP set (Company & facilities). Factors are stored as kg of each gas, so the same entry is recalculated in AR4, AR5 or AR6. Kyoto gases count in the scopes; others (CFCs, HCFCs, halons…) are reported separately as memo items.</div>
      <div className="card flush">
        <div className="row" style={{ padding: 12 }}><input className="input grow" placeholder="Search gases…" value={q} onChange={(e) => setQ(e.target.value)} /><span className="sub">{rows.length} gases</span></div>
        <div className="scroll">
          <table className="t">
            <thead><tr><th>Gas</th><th>Formula</th><th>Group</th><th>Counted</th><th className="num">AR4</th><th className="num">AR5</th><th className="num">AR6</th></tr></thead>
            <tbody>{rows.map((g) => (
              <tr key={g.code}>
                <td>{g.name} <span className="mono sub">{g.code}</span></td><td className="mono">{g.formula}</td><td>{g.family}</td>
                <td>{g.kyoto ? <span className="chip">in scopes</span> : <span className="chip grey">memo</span>}</td>
                <td className="num">{num(g.gwp?.AR4)}</td><td className="num">{num(g.gwp?.AR5)}</td><td className="num">{num(g.gwp?.AR6)}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
