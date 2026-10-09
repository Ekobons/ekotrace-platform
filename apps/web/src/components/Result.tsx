/**
 * Calculation result: CO2e totals per basis on top; the split per gas below,
 * behind "Show split by gas"; then steps and warnings.
 * Used by the entry form (preview) and the entry detail drawer.
 */
import { useState } from 'react';
import { GasToggle, useGasSplit } from './GasToggle';
import { BASIS_LABEL, num, tco2e, type Basis } from '../lib/api';

interface Line { basis: Basis; gas: string; kgGas: number | null; kgCo2e: number; method: string; source?: string | null }

export function Result({ r }: { r: { gwpSet: string; totals: Record<Basis, number>; lines: Line[]; steps: string[]; warnings: string[] } }) {
  const [showSteps, setShowSteps] = useState(false);
  const [showGas, toggleGas] = useGasSplit();
  const gasCount = new Set(r.lines.filter((l) => l.kgGas != null).map((l) => l.gas)).size;
  const order: Basis[] = ['direct', 'wtt', 'outside_scopes', 'memo'];
  const cls: Record<Basis, string> = { direct: 's1', wtt: 's3', outside_scopes: 'bio', memo: 'memo' };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="total">
        {order.filter((b) => b === 'direct' || r.totals[b]).map((b) => (
          <div key={b} className={`stat ${cls[b]}`}>
            <small>{BASIS_LABEL[b]}</small>
            <b>{tco2e(r.totals[b])}</b>
            <small>t{b === 'outside_scopes' ? 'CO₂' : 'CO₂e'}{b === 'direct' ? ` · ${r.gwpSet}` : ''}</small>
          </div>
        ))}
      </div>
      {r.warnings.map((w, i) => <div key={i} className="note warn">{w}</div>)}
      <GasToggle open={showGas} onToggle={toggleGas} count={gasCount} />
      {showGas && <table className="t" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
        <thead><tr><th>Part</th><th>Gas</th><th className="num">kg of gas</th><th className="num">kg CO₂e</th><th>How</th></tr></thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>{BASIS_LABEL[l.basis]}</td>
              <td className="mono">{l.gas === 'CH4_fossil' ? 'CH₄ (fossil)' : l.gas === 'CO2_biogenic' ? 'CO₂ (biogenic)' : l.gas}</td>
              <td className="num">{num(l.kgGas)}</td>
              <td className="num">{num(l.kgCo2e)}</td>
              <td><span className={`chip ${l.method === 'gas' ? '' : 'grey'}`}>{l.method === 'gas' ? `gas × GWP ${r.gwpSet}` : `published total${l.source ? ` (${l.source})` : ''}`}</span></td>
            </tr>
          ))}
        </tbody>
      </table>}
      <div>
        <button className="btn ghost sm" onClick={() => setShowSteps(!showSteps)}>{showSteps ? 'Hide' : 'Show'} calculation steps ({r.steps.length})</button>
        {showSteps && <ol className="steps">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
      </div>
    </div>
  );
}
