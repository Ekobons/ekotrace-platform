/** Shared pieces of the SME network and SME console screens (these pages sit outside the SME store). */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { f0, f1, n } from '../../lib/sme';
import './sme.css';
import './net.css';

/** Page heading in the SME style, without the SME store. */
export function NetHead({ icon, eyebrow, title, lede, children }: { icon: string; eyebrow: ReactNode; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="sme-head">
      <div className="sme-picon"><Icon name={icon} /></div>
      <div className="grow">
        <span className="lbl">{eyebrow}</span>
        <h1>{title}</h1>
        {lede && <p className="muted sme-lede">{lede}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>);
}

/** "FY 2026-27" and the three years before it. */
export function fyList(cur: string): string[] {
  const y = Number(/FY (\d{4})/.exec(cur)?.[1] ?? new Date().getFullYear());
  return [0, 1, 2, 3].map((i) => `FY ${y - i}-${String((y - i + 1) % 100).padStart(2, '0')}`);
}
export function FySelect({ value, current, onChange }: { value: string; current: string; onChange: (fy: string) => void }) {
  const years = fyList(current);
  if (!years.includes(value)) years.unshift(value);
  return (
    <label className="net-fy"><span className="sr">Financial year</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Financial year">
        {years.map((y) => <option key={y} value={y}>{y} (April–March)</option>)}
      </select>
    </label>);
}

/** The current Indian financial year, April–March. */
export function currentFy(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Load once (and again when deps change); keeps the last good value while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then((v) => { if (live) { setData(v); setError(null); } }).catch((e) => { if (live) setError(errText(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/** A number cell that editors can change in place; saves on blur or Enter. */
export function EditNum({ value, onSave, label, unit, canEdit, step = 'any', max }: { value: number | null | undefined; onSave: (v: number | null) => Promise<void>; label: string; unit?: string; canEdit: boolean; step?: string; max?: number }) {
  const shown = value === null || value === undefined ? '' : String(value);
  const [v, setV] = useState(shown);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(shown), [shown]);
  if (!canEdit) return <span className="num">{shown === '' ? '—' : `${f1(value)}${unit ? ` ${unit}` : ''}`}</span>;
  const commit = async () => {
    if (v === shown) return;
    const next = v.trim() === '' ? null : Number(v);
    if (next !== null && (Number.isNaN(next) || next < 0 || (max !== undefined && next > max))) { setV(shown); return; }
    setBusy(true);
    try { await onSave(next); } catch { setV(shown); } finally { setBusy(false); }
  };
  return (
    <span className="net-edit">
      <input className="input num" type="number" inputMode="decimal" min={0} max={max} step={step} aria-label={label} value={v} disabled={busy}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(shown); }} />
      {unit && <small>{unit}</small>}
    </span>);
}

/** Small horizontal bar chart: label, bar, value. */
export function Bars({ rows, fmt = (x) => f0(x), color = 'var(--primary)' }: { rows: { label: string; value: number; hint?: string }[]; fmt?: (v: number) => string; color?: string }) {
  const max = Math.max(...rows.map((r) => n(r.value)), 0) || 1;
  return (
    <div className="net-bars">
      {rows.map((r) => (
        <div key={r.label} className="net-barrow">
          <span className="net-bl" title={r.hint}>{r.label}</span>
          <span className="net-bt"><b style={{ width: `${(n(r.value) / max) * 100}%`, background: color }} /></span>
          <span className="num">{fmt(r.value)}</span>
        </div>))}
    </div>);
}

/** Labels for the emission sources the engine returns by key. */
export const SOURCE_LABEL: Record<string, string> = {
  grid: 'Grid electricity', diesel: 'Diesel (DG sets, vehicles)', petrol: 'Petrol (vehicles)', lpg: 'LPG', png: 'Piped natural gas', coal: 'Coal',
  refrig: 'AC refrigerant', solar: 'Rooftop solar', furnace_oil: 'Furnace oil', fo: 'Furnace oil', biomass: 'Biomass',
};
export const srcLabel = (k: string) => SOURCE_LABEL[k] ?? k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** ₹ in lakh below one crore, in crore above. */
export const rupees = (v: unknown) => (Math.abs(n(v)) >= 1e7 ? `₹${f1(n(v) / 1e7)} Cr` : `₹${f1(n(v) / 1e5)} L`);
