/**
 * Compact dashboard charts (same design as the prototype's dashboards): stacked bars with
 * reference lines, donut, treemap, horizontal bars and legends, card and stat-strip frames.
 * Every mark has a title (hover) with its value; legends carry the numbers as text.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A box that fills the space its card gives it (at least minH tall) and draws its chart at the real
 * pixel size, so text stays the same size whatever the screen and the chart grows with the card.
 */
export function Fit({ minH, children, className }: { minH: number; children: (w: number, h: number) => ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const r = e!.contentRect; setS((p) => (p && Math.abs(p.w - r.width) < 1 && Math.abs(p.h - r.height) < 1 ? p : { w: r.width, h: r.height })); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return <div ref={ref} className={`fit${className ? ' ' + className : ''}`} style={{ minHeight: minH }}>{s && s.w > 0 ? children(Math.round(s.w), Math.max(minH, Math.round(s.h))) : null}</div>;
}

export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const PAL = ['#1F6F5C', '#2BA38A', '#86CDB4', '#E9B44C', '#C2523C', '#6B4FA8', '#2E6FB0', '#9AA7A2', '#D27A3A', '#4F7F2E'];
export const SC = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
export const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
export const fmt0 = (v: number) => fmt(Math.round(v));
export const fmtT = (v: number) => (Math.abs(v) < 10 ? fmt(v, Math.abs(v) < 1 ? 2 : 1) : fmt0(v));

export interface Part { v: number; c: string; n: string; go?: () => void }   // go: open the entries behind it
export interface BarRow { lbl: string; parts: Part[]; line?: number | null; line2?: number | null; dim?: boolean; go?: () => void }

export function Bars({ rows, unit = 't', h = 170, label = 'Chart' }: { rows: BarRow[]; unit?: string; h?: number; w?: number; label?: string }) {
  return <Fit minH={Math.round(h * 1.3)}>{(w, hh) => <BarsSvg rows={rows} unit={unit} W={w} H={hh} label={label} />}</Fit>;
}
function BarsSvg({ rows, unit, W, H, label }: { rows: BarRow[]; unit: string; W: number; H: number; label: string }) {
  const L = 46, B = 24, T = 10, n = rows.length, bw = (W - L) / Math.max(1, n);
  const tot = (r: BarRow) => r.parts.reduce((a, p) => a + (p.v || 0), 0);
  if (!rows.some((r) => tot(r) > 0 || (r.line ?? 0) > 0 || (r.line2 ?? 0) > 0)) return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <line x1={L} x2={W} y1={H - B} y2={H - B} stroke="var(--line)" />
      {rows.map((r, i) => <text key={r.lbl + i} x={L + i * ((W - L) / Math.max(1, rows.length)) + (W - L) / Math.max(1, rows.length) / 2} y={H - 6} fontSize="12.5" textAnchor="middle" fill="var(--muted)">{r.lbl}</text>)}
      <text x={(L + W) / 2} y={(H - B) / 2} fontSize="13" textAnchor="middle" fill="var(--muted)">No data for this selection and period</text>
    </svg>);
  const mx = Math.max(1e-9, ...rows.map((r) => Math.max(tot(r), r.line ?? 0, r.line2 ?? 0))) * 1.1;
  const yy = (v: number) => T + (1 - v / mx) * (H - T - B);
  const tick = (v: number) => (v >= 1e6 ? `${fmt(v / 1e6, 1)}M` : v >= 1000 ? `${fmt(v / 1000, 1)}k` : fmt(v, v < 10 ? 1 : 0));
  const line = (k: 'line' | 'line2') => rows.map((r, i) => (r[k] == null ? null : `${(L + i * bw + bw / 2).toFixed(1)},${yy(r[k]!).toFixed(1)}`)).filter(Boolean) as string[];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => { const v = (mx / 1.1) * g; return <g key={g}><line x1={L} x2={W} y1={yy(v)} y2={yy(v)} stroke="var(--line)" /><text x={L - 6} y={yy(v) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">{tick(v)}</text></g>; })}
      {rows.map((r, i) => {
        const w = Math.min(bw * 0.64, 72), x = L + i * bw + (bw - w) / 2;
        let acc = 0;
        return (
          <g key={r.lbl + i} className={r.go ? 'drill' : undefined} onClick={r.go} role={r.go ? 'link' : undefined} tabIndex={r.go ? 0 : undefined} onKeyDown={r.go ? (e) => { if (e.key === 'Enter') r.go!(); } : undefined} aria-label={r.go ? `${r.lbl}: open the entries` : undefined}>
            {r.go && <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />}
            {r.parts.map((p, k) => { const hh = ((p.v || 0) / mx) * (H - T - B); if (hh <= 0) return null; const y = yy(0) - acc - hh; acc += hh;
              return <rect key={k} x={x} y={y} width={w} height={hh} fill={p.c} opacity={r.dim ? 0.4 : 1}><title>{`${r.lbl}${p.n ? ` · ${p.n}` : ''}: ${fmtT(p.v)} ${unit}`}</title></rect>; })}
            <text x={x + w / 2} y={H - 6} fontSize="12.5" textAnchor="middle" fill="var(--fg2)">{r.lbl}</text>
          </g>);
      })}
      {(['line', 'line2'] as const).map((k, j) => { const pts = line(k); const col = j ? '#D99A1E' : 'var(--muted)';
        return pts.length > 1 ? <polyline key={k} points={pts.join(' ')} fill="none" stroke={col} strokeWidth="2" strokeDasharray={j ? '5 4' : undefined} /> : null; })}
    </svg>
  );
}

export function Donut({ parts, center, sub, size: size0 = 150 }: { parts: Part[]; center: string; sub?: string; size?: number }) {
  const size = Math.round(size0 * 1.15);
  const tot = parts.reduce((a, p) => a + Math.max(0, p.v || 0), 0) || 1, R = size / 2 - 4, r = R * 0.62, c = size / 2;
  let a0 = -Math.PI / 2;
  const P = (ang: number, rad: number) => [c + rad * Math.cos(ang), c + rad * Math.sin(ang)];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Breakdown">
      {parts.filter((p) => p.v > 0).map((p, i) => {
        const a1 = a0 + (p.v / tot) * Math.PI * 2 - 0.0001, big = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = P(a0, R), [x1, y1] = P(a1, R), [x2, y2] = P(a1, r), [x3, y3] = P(a0, r);
        a0 = a1;
        return <path key={i} d={`M${x0} ${y0} A${R} ${R} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${big} 0 ${x3} ${y3}Z`} fill={p.c} stroke="var(--surface)" strokeWidth="1.5"><title>{`${p.n}: ${fmtT(p.v)} (${Math.round((p.v / tot) * 100)}%)`}</title></path>;
      })}
      <text x={c} y={c - 1} textAnchor="middle" fontSize={size / 8.5} fontWeight="700" fill="var(--fg)">{center}</text>
      <text x={c} y={c + size / 11} textAnchor="middle" fontSize={size / 14} fill="var(--muted)">{sub ?? ''}</text>
    </svg>
  );
}

export function Legend({ parts, unit, tot }: { parts: Part[]; unit?: string; tot?: number }) {
  const T = tot || parts.reduce((a, p) => a + (p.v || 0), 0) || 1;
  return <div className="dleg">{parts.filter((p) => p.v > 0).map((p) => (
    <div key={p.n} className={p.go ? 'drill' : undefined} onClick={p.go} role={p.go ? 'link' : undefined} tabIndex={p.go ? 0 : undefined} onKeyDown={p.go ? (e) => { if (e.key === 'Enter') p.go!(); } : undefined}><i style={{ background: p.c }} /><span className="nm" title={p.go ? `${p.n} — open the entries` : p.n}>{p.n}</span><b>{p.v < 100 ? fmt(p.v, p.v < 10 ? 2 : 1) : fmt0(p.v)}{unit ? ` ${unit}` : ''}</b><span className="muted">{Math.round((p.v / T) * 100)}%</span></div>))}</div>;
}

export function Treemap({ items, H = 210 }: { items: Part[]; W?: number; H?: number }) {
  if (!items.reduce((a, i) => a + i.v, 0)) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  return <Fit minH={Math.round(H * 1.2)}>{(w, h) => <TreemapSvg items={items} W={w} H={h} />}</Fit>;
}
function TreemapSvg({ items, W, H }: { items: Part[]; W: number; H: number }) {
  const out: { it: Part; x: number; y: number; w: number; h: number }[] = [];
  const tot0 = items.reduce((a, i) => a + i.v, 0);
  if (!tot0) return <div className="muted" style={{ fontSize: 13 }}>No data.</div>;
  const split = (its: Part[], x: number, y: number, w: number, h: number) => {
    if (!its.length) return;
    if (its.length === 1) { out.push({ it: its[0]!, x, y, w, h }); return; }
    const tot = its.reduce((a, i) => a + i.v, 0);
    let acc = 0, k = 0;
    while (k < its.length - 1 && acc + its[k]!.v < tot / 2) { acc += its[k]!.v; k++; }
    if (k === 0) { acc = its[0]!.v; k = 1; }
    const f = acc / tot, A = its.slice(0, k), Bs = its.slice(k);
    if (w >= h) { split(A, x, y, w * f, h); split(Bs, x + w * f, y, w * (1 - f), h); } else { split(A, x, y, w, h * f); split(Bs, x, y + h * f, w, h * (1 - f)); }
  };
  split(items.filter((i) => i.v > 0).sort((a, b) => b.v - a.v), 0, 0, W, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Treemap">
      {out.map(({ it, x, y, w, h }, i) => (
        <g key={i} className={it.go ? 'drill' : undefined} onClick={it.go}>
          <rect x={x + 1} y={y + 1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx="4" fill={it.c}><title>{`${it.n}: ${fmtT(it.v)} t (${Math.round((it.v / tot0) * 100)}%)`}</title></rect>
          {w > 80 && h > 40 ? <>
            <text x={x + 8} y={y + 19} fontSize="13" fontWeight="600" fill="#fff">{it.n.length > w / 7.5 ? `${it.n.slice(0, Math.floor(w / 7.5))}…` : it.n}</text>
            <text x={x + 8} y={y + 35} fontSize="12" fill="#fff" opacity=".9">{fmtT(it.v)} t · {Math.round((it.v / tot0) * 100)}%</text>
          </> : w > 34 && h > 18 ? <text x={x + w / 2} y={y + h / 2 + 4} fontSize="11.5" fontWeight="600" textAnchor="middle" fill="#fff">{Math.max(1, Math.round((it.v / tot0) * 100))}%</text> : null}
        </g>))}
    </svg>
  );
}

export interface HItem { n: string; v: number; c?: string; d?: number; p?: number; parts?: { v: number; c: string }[]; onClick?: () => void }
export function HBars({ items, unit, c }: { items: HItem[]; unit?: string; c?: string }) {
  const mx = Math.max(1e-9, ...items.map((i) => i.v));
  if (!items.length) return <div className="muted" style={{ fontSize: 13 }}>No data for this selection.</div>;
  return (
    <div className="dhb">{items.map((i, k) => (
      <div key={i.n + k} className={i.onClick ? 'click' : ''} onClick={i.onClick} title={i.onClick ? 'Show only this' : undefined}>
        <span className="nm" title={i.n}>{i.n}</span>
        <span className="bar">{i.parts ? i.parts.map((p, j) => <span key={j} style={{ width: `${(p.v / mx) * 100}%`, background: p.c }} />) : <span style={{ width: `${(i.v / mx) * 100}%`, background: i.c ?? c ?? 'var(--primary)' }} />}</span>
        <b>{fmt(i.v, i.d ?? (i.v < 10 ? 1 : 0))}{unit ? ` ${unit}` : ''}</b>
        {i.p !== undefined ? <span className="muted">{Math.round(i.p)}%</span> : <span />}
      </div>))}</div>
  );
}

export function DCard({ title, sub, right, span, children }: { title: ReactNode; sub?: string; right?: ReactNode; span?: number; children: ReactNode }) {
  return (
    <section className="card dcard" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="dch"><h3>{title}</h3>{sub && <span className="muted">{sub}</span>}<span style={{ flex: 1 }} />{right}</div>
      {children}
    </section>
  );
}

export function DStat({ cells }: { cells: [ReactNode, ReactNode, ReactNode?, string?][] }) {
  return <section className="card dstat">{cells.map(([l, v, s, c], i) => <div key={i}><span className="muted">{l}</span><b style={c ? { color: c } : undefined}>{v}</b>{s ? <small>{s}</small> : null}</div>)}</section>;
}
export const Dot = ({ c }: { c: string }) => <i className="sdot" style={{ background: c }} />;
