/**
 * Calculation result: CO2e totals per basis on top; the split per gas below,
 * behind "Show split by gas"; then steps and warnings.
 * Used by the entry form (preview) and the entry detail drawer.
 */
import { useState } from 'react';
import { GasToggle, useGasSplit } from './GasToggle';
import { BASIS_LABEL, num, tco2e, type Basis, type CvUsed, type FactorUsed } from '../lib/api';

interface Line { basis: Basis; gas: string; kgGas: number | null; kgCo2e: number; method: string; source?: string | null }

/** Units of purchased energy: such entries show Scope 2 location- and market-based side by side. */
export const ENERGY_UNITS = new Set(['kWh_e', 'MWh_e', 'kWh_th', 'MWh_th', 'GJ_th', 'MMBtu_th', 'kWh_c', 'MWh_c', 'TRh']);

export function Result({ r, quantity, unitName, energy }: {
  r: { gwpSet: string; totals: Record<Basis, number>; lines: Line[]; steps: string[]; warnings: string[]; factors?: FactorUsed[]; cv?: CvUsed };
  /** for entries saved before factors were stored: the factor is derived as total ÷ quantity */
  quantity?: number; unitName?: string;
  /** purchased energy (Scope 2 entry) */
  energy?: boolean;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const [showGas, toggleGas] = useGasSplit();
  const gasCount = new Set(r.lines.filter((l) => l.kgGas != null).map((l) => l.gas)).size;
  const order: Basis[] = ['direct', 'scope2', 'scope2_market', 'scope3', 'td_loss', 'wtt', 'outside_scopes', 'memo'];
  const cls: Record<Basis, string> = { direct: 's1', scope2: 's2', scope2_market: 's2m', td_loss: 's3', wtt: 's3', scope3: 's3', outside_scopes: 'bio', memo: 'memo' };
  const s3only = !!r.totals.scope3 && !r.totals.direct;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="total">
        {order.filter((b) => (energy ? b === 'scope2' || b === 'scope2_market' : b === 'direct' && !s3only) || r.totals[b]).map((b) => (
          <div key={b} className={`stat ${cls[b]}`}>
            <small>{BASIS_LABEL[b]}</small>
            <b>{tco2e(r.totals[b])}</b>
            <small>t{b === 'outside_scopes' ? 'CO₂' : 'CO₂e'}{b === 'direct' || b === 'scope2' ? ` · ${r.gwpSet}` : ''}</small>
          </div>
        ))}
      </div>
      {r.cv && (
        <div className="note info">
          <b>Own calorific value:</b> {ef(r.cv.value)} {r.cv.energyUnitName} per {r.cv.perUnitName}. The quantity becomes{' '}
          <b>{num(r.cv.convertedQuantity)} {r.cv.convertedUnitName}</b>, and the factors for that unit are applied.
        </div>
      )}
      <FactorTable r={r} order={order} quantity={quantity} unitName={unitName} />
      {r.warnings.map((w, i) => <div key={i} className="note warn">{w}</div>)}
      {gasCount > 0 && <GasToggle open={showGas} onToggle={toggleGas} count={gasCount} />}
      {gasCount > 0 && showGas && <table className="t" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
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

/** Number with up to 6 significant digits and thousands separators. */
const ef = (n: number) => n.toLocaleString('en', { maximumSignificantDigits: 6 });

/**
 * The CO2e emission factor behind each total, so anyone can cross-check:
 * quantity × factor = result.
 */
function FactorTable({ r, order, quantity, unitName }: {
  r: { gwpSet: string; totals: Record<Basis, number>; factors?: FactorUsed[] }; order: Basis[]; quantity?: number; unitName?: string;
}) {
  let rows: FactorUsed[] = r.factors ?? [];
  if (!rows.length && quantity && unitName) {
    rows = order.filter((b) => r.totals[b]).map((b) => ({
      basis: b, factorId: null, source: 'Total ÷ quantity', validFrom: null, co2ePerUnit: r.totals[b] / quantity, unit: unitName, unitName,
      perEnteredUnit: r.totals[b] / quantity, enteredUnit: unitName, enteredUnitName: unitName, quantity, method: 'published' as const,
    }));
  }
  if (!rows.length) return null;
  rows = [...rows].sort((a, b) => order.indexOf(a.basis) - order.indexOf(b.basis));
  return (
    <table className="t eftable" style={{ border: '1px solid var(--line)', borderRadius: 12 }}>
      <thead><tr><th>Emission factor</th><th className="num">CO₂e factor</th><th>Source</th><th className="num">Check</th></tr></thead>
      <tbody>{rows.map((f, i) => {
        const gas = f.basis === 'outside_scopes' ? 'CO₂' : 'CO₂e';
        const converted = f.unit !== f.enteredUnit;
        return (
          <tr key={i}>
            <td>{BASIS_LABEL[f.basis]}{f.label && <div className="muted small">{f.label}</div>}</td>
            <td className="num">
              <b>{ef(f.perEnteredUnit)}</b> <span className="muted">kg {gas}/{f.enteredUnitName}</span>
              {converted && <div className="muted small">= {ef(f.co2ePerUnit)} kg {gas}/{f.unitName}</div>}
              {f.published && <div className="muted small">{f.source} published ({f.published.gwpSet}): {ef(f.published.co2ePerUnit)} kg/{f.unitName}</div>}
            </td>
            <td>{f.source}<div className="muted small">{
              f.method === 'gas' ? (f.factorId ? `gas split × GWP ${r.gwpSet}` : f.source.startsWith('IPCC') || f.source.startsWith('measured') ? `IPCC method, gases × GWP ${r.gwpSet}` : f.source.startsWith('GWP') ? 'methane × GWP' : 'gas composition × GWP')
              : f.factorId ? 'published total' : f.source === 'Total ÷ quantity' ? 'older entry: derived' : f.label?.startsWith('Supplier') ? 'supplier factor' : f.label ? 'contractual instrument' : ''}</div></td>
            <td className="num mono">{num(f.quantity)} × {ef(f.perEnteredUnit)}<div className="muted small">= {tco2e(f.quantity * f.perEnteredUnit)} t{gas}</div></td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}
