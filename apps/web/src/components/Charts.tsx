/**
 * Small, dependency-free charts (SVG / CSS) shared by Dashboards and Supplier analytics:
 * ranked bar lists, stacked monthly columns, a share bar and KPI tiles. Every chart keeps
 * its numbers readable as text (labels, titles on hover) so it works without colour too.
 */
import type { ReactNode } from 'react';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** tonnes with sensible precision, from kg */
export const t = (kg: number | null | undefined) => {
  const v = (kg ?? 0) / 1000;
  const a = Math.abs(v);
  return a >= 1000 ? Math.round(v).toLocaleString('en') : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : a > 0 ? v.toFixed(2) : '0';
};
export const usdShort = (v: number | null | undefined) => {
  const a = Math.abs(v ?? 0);
  return a >= 1e9 ? `$${((v ?? 0) / 1e9).toFixed(1)}bn` : a >= 1e6 ? `$${((v ?? 0) / 1e6).toFixed(1)}m` : a >= 1e3 ? `$${Math.round((v ?? 0) / 1e3)}k` : `$${Math.round(v ?? 0)}`;
};
const pct = (v: number) => (v >= 0.995 ? '100%' : v >= 0.1 ? `${Math.round(v * 100)}%` : v >= 0.001 ? `${(v * 100).toFixed(1)}%` : v > 0 ? '<0.1%' : '0%');
let names: Intl.DisplayNames | null = null;
export const countryName = (code: string | null | undefined) => {
  if (!code) return 'Country not known';
  try { names ??= new Intl.DisplayNames(['en'], { type: 'region' }); return names.of(code) ?? code; } catch { return code; }
};

export function Kpi({ label, value, unit, sub, tone, children }: { label: string; value: string; unit?: string; sub?: ReactNode; tone?: 's1' | 's2' | 's3' | 'bio' | 'memo' | 's2m'; children?: ReactNode }) {
  return (
    <div className={`stat kpi ${tone ?? ''}`}>
      <small>{label}</small>
      <b>{value}{unit && <span className="kpi-unit"> {unit}</span>}</b>
      {sub && <div className="kpi-sub">{sub}</div>}
      {children}
    </div>
  );
}

/** Change against an earlier value: ▲ more (bad for emissions), ▼ less. */
export function Delta({ now, before, label }: { now: number; before: number | null | undefined; label: string }) {
  if (!before) return <span className="muted">no {label} data</span>;
  const d = (now - before) / Math.abs(before);
  return <span className={d > 0.005 ? 'delta up' : d < -0.005 ? 'delta down' : 'delta'}>{d > 0.005 ? '▲' : d < -0.005 ? '▼' : '='} {pct(Math.abs(d))} vs {label}</span>;
}

export interface BarRow { key: string; label: ReactNode; value: number; sub?: ReactNode; extra?: ReactNode; color?: string; onClick?: () => void }
/** Ranked horizontal bars: label, bar, value and share of the total. */
export function BarList({ rows, format = t, unit = 't', total, max = 12, empty = 'Nothing yet.', color }: { rows: BarRow[]; format?: (v: number) => string; unit?: string; total?: number; max?: number; empty?: string; color?: string }) {
  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  const sum = total ?? rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const top = Math.max(...shown.map((r) => r.value), 0) || 1;
  if (!rows.length) return <div className="sub">{empty}</div>;
  return (
    <div className="barlist">
      {shown.map((r) => (
        <div key={r.key} className={`bl-row ${r.onClick ? 'click' : ''}`} onClick={r.onClick} role={r.onClick ? 'button' : undefined} tabIndex={r.onClick ? 0 : undefined}
          onKeyDown={(e) => { if (r.onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.onClick(); } }}>
          <div className="bl-label"><span>{r.label}</span>{r.sub && <small>{r.sub}</small>}</div>
          <div className="bl-track"><div className="bl-bar" style={{ width: `${Math.max(0, (r.value / top) * 100)}%`, background: r.color ?? color }} /></div>
          <div className="bl-val num">{format(r.value)}{unit ? ` ${unit}` : ''}<small>{sum ? pct(r.value / sum) : ''}</small></div>
          {r.extra && <div className="bl-extra">{r.extra}</div>}
        </div>
      ))}
      {rest.length > 0 && <div className="sub" style={{ paddingTop: 4 }}>+ {rest.length} more · {format(rest.reduce((s, r) => s + r.value, 0))} {unit}</div>}
    </div>
  );
}

export type MonthDatum = { m: number } & Record<string, number | null | undefined>;
export interface Series { key: string; label: string; color: string; dashed?: boolean }
/** Stacked columns per month (12 slots); values in kg, shown in tonnes. */
export function MonthColumns({ data, series, height = 200, format = t, unit = 't' }: { data: MonthDatum[]; series: Series[]; height?: number; format?: (v: number) => string; unit?: string }) {
  const byMonth = new Map<number, MonthDatum>();
  for (const d of data) byMonth.set(Number(d.m), d);
  const totals = MONTHS.map((_, i) => series.reduce((s, x) => s + Math.max(0, Number(byMonth.get(i + 1)?.[x.key] ?? 0)), 0));
  const top = niceMax(Math.max(...totals, 0));
  const W = 640, H = height, L = 44, B = 22, T = 8, cw = (W - L - 8) / 12;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const ticks = [0, top / 2, top];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Monthly ${series.map((s) => s.label).join(', ')}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {ticks.map((v) => <g key={v}><line x1={L} x2={W - 4} y1={y(v)} y2={y(v)} className="gridline" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="axis">{format(v)}</text></g>)}
        {MONTHS.map((mn, i) => {
          let acc = 0;
          const d = byMonth.get(i + 1);
          return (
            <g key={mn}>
              {series.map((s) => {
                const v = Math.max(0, Number(d?.[s.key] ?? 0));
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v); acc += v;
                return <rect key={s.key} x={L + i * cw + cw * 0.18} width={cw * 0.64} y={y1} height={Math.max(0.5, y0 - y1)} fill={s.color} rx={1.5}><title>{`${mn}: ${s.label} ${format(v)} ${unit}`}</title></rect>;
              })}
              {!d && <rect x={L + i * cw + cw * 0.18} width={cw * 0.64} y={y(0) - 2} height={2} className="nodata"><title>{`${mn}: no monthly data`}</title></rect>}
              <text x={L + i * cw + cw / 2} y={H - 6} textAnchor="middle" className="axis">{mn}</text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 && <figcaption className="legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</figcaption>}
    </figure>
  );
}
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** One bar split into parts (e.g. Scope 1 / 2 / 3 shares). */
export function ShareBar({ parts, format = t, unit = 't' }: { parts: { key: string; label: string; value: number; color: string }[]; format?: (v: number) => string; unit?: string }) {
  const sum = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <div className="sharebar" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value / sum)}`).join(', ')}>
        {parts.map((p) => p.value > 0 && <div key={p.key} style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} title={`${p.label}: ${format(p.value)} ${unit} (${pct(p.value / sum)})`} />)}
      </div>
      <div className="legend">{parts.map((p) => <span key={p.key}><i style={{ background: p.color }} />{p.label} <b>{pct(Math.max(0, p.value) / sum)}</b></span>)}</div>
    </div>
  );
}

/** A soft palette for categorical bars (countries, groups…), colour-blind friendly order. */
export const PALETTE = ['#0E7C66', '#2BA38A', '#E3B25A', '#1D5E80', '#8A7B3C', '#A63E2A', '#6B8F3A', '#7A5C99', '#C77D3E', '#3F7F99', '#9A9A6B', '#5B6B66'];
