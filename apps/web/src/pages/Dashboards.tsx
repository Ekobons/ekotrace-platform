/**
 * Dashboards, in the Ekotrace 2.0 design: header, tabs (Overview · Emissions · Energy · Water ·
 * Waste · Mobility & travel), filter bar (year, months, comparison, Scope 2 method, part of the
 * group), then boxes: KPI cards, monthly column charts with the comparison year as a dashed
 * line, "where" and "what" bar lists, detail panels and "What moved" (computed from the data).
 *
 * Every figure comes from the year's rows (facility × month × category × item, in tonnes, with
 * quantities and kWh) and the same rows of the comparison year, under the company's
 * consolidation approach. Entries for a whole year (month 0) count only in the full-year view.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type OrgNode } from '../lib/api';
import { MN, fmt } from '../components/DashCharts';

interface Row {
  f: string; m: number; cat: string; item: string; grp: string; sub: string; unit: string; s1: number; s2: number; s3: number; s33: number; bio: number; memo: number;
  n: number; approved: number; estimated: number; qty: number; rec: number; kind: 'fuel' | 'electricity' | 'cooling' | 'heat' | null; kwh: number | null;
}
interface Data {
  year: number; years: number[]; consolidation: string; scope2: 'location' | 'market'; baseYear: { year: number; total: number | null } | null; cmpYear: number;
  rows: Row[]; prevRows: Row[];
  facilities: { id: string; name: string; parent: string | null; type: string | null; employees: number | null; area: number | null; weight: number }[];
  categories: { code: string; name: string; scope: number; ghg_category: number | null; ghg: string }[]; s3Names: Record<number, string>;
  purchases: { byGroup: { name: string; t: number }[]; bySupplier: { name: string; t: number }[]; byMethod: { method: string; t: number; lines: number }[]; suppliers: number; withTarget: number };
}
type Tab = 'overview' | 'emissions' | 'energy' | 'water' | 'waste' | 'travel';
type Sk = 'all' | 's1' | 's2' | 's3';
const TABS: [Tab | 'boards', string][] = [['overview', 'Overview'], ['emissions', 'Emissions'], ['energy', 'Energy'], ['water', 'Water'], ['waste', 'Waste'], ['travel', 'Mobility & travel'], ['boards', 'My boards']];
const CONS: Record<string, string> = { operational: 'operational control', financial: 'financial control', equity: 'equity share' };
const C = { s1: '#0B4F43', s2: '#2BA38A', s3: '#E3B25A' };
const PAL = ['#0B4F43', '#2BA38A', '#E3B25A', '#8CC7B6', '#2B7FA6', '#C2523C', '#5B6B66', '#0E7C66', '#B86E0E', '#6B4FA8'];
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const val = (r: Row, k: Sk) => (k === 'all' ? r.s1 + r.s2 + r.s3 + r.s33 : k === 's1' ? r.s1 : k === 's2' ? r.s2 : r.s3 + r.s33);
const tot = (r: Row) => val(r, 'all');
const chg = (cur: number, prev: number) => (prev ? (cur / prev - 1) * 100 : null);
const pctTxt = (p: number | null, suffix = '') => (p === null || !Number.isFinite(p) ? '' : `${p > 0 ? '+' : '−'}${fmt(Math.abs(p), Math.abs(p) < 10 ? 1 : 0)}%${suffix}`);
const cls = (p: number | null, upIsBad = true) => (p === null ? 'neu' : (p > 0) === upIsBad ? 'badc' : 'good');
const share = (v: number, t: number) => (t ? `${Math.round((v / t) * 100)}%` : '—');
/** tonnes → shown in t or kt, the same for the whole page */
function unitFor(total: number) { return Math.abs(total) >= 10000 ? { k: 1000, u: 'kt', d: 1 } : { k: 1, u: 't', d: Math.abs(total) < 100 ? 1 : 0 }; }
const kwhTxt = (k: number) => (k >= 1e6 ? `${fmt(k / 1e6, k >= 1e7 ? 1 : 2)} GWh` : k >= 1000 ? `${fmt(k / 1000, k >= 1e5 ? 0 : 1)} MWh` : `${fmt(k, 0)} kWh`);
const qtyTxt = (q: number, u: string) => (q >= 1e6 ? `${fmt(q / 1e6, 2)}M ${u}` : q >= 1e4 ? `${fmt(q / 1000, 1)}k ${u}` : `${fmt(q, q < 10 ? 1 : 0)} ${u}`);
const UNIT_LABEL: Record<string, string> = { L: 'L', kg: 'kg', m3: 'm³', t: 't', km: 'km', kWh_e: 'kWh', TRh: 'TRh' };

export function Dashboards() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = ((sp.get('tab') as Tab) || 'overview');
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;
  const node = sp.get('node') ?? '';
  const scope2 = (sp.get('scope2') as 'location' | 'market') || 'location';
  const period = sp.get('period') ?? 'year';
  const cmp = (sp.get('cmp') as 'prev' | 'base' | 'none') || 'prev';
  const set = (o: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [baseYear, setBaseYear] = useState<number | null>(null);
  useEffect(() => { api.org().then((r) => setNodes(r.nodes.filter((n) => n.canSee && n.active))).catch(() => {}); }, []);
  const cmpYear = cmp === 'base' && baseYear ? baseYear : undefined;
  useEffect(() => {
    setErr(null);
    api.dashboard({ year, node: node || undefined, scope2, cmp: cmpYear }).then((x) => { const dd = x as unknown as Data; setD(dd); if (dd.baseYear) setBaseYear(dd.baseYear.year); }).catch((e) => setErr(e.message));
  }, [year, node, scope2, cmpYear]);
  const c = useMemo(() => (d ? ctx(d, period, cmp === 'none' || (cmp === 'base' && !baseYear) ? null : d.cmpYear, nodes, node) : null), [d, period, cmp, baseYear, nodes, node]);
  if (!d || !c) return <div className="page"><div className="card empty">{err ?? 'Loading…'}</div></div>;

  const exportCsv = () => {
    const head = ['facility', 'month', 'category', 'item', 'scope1_t', 'scope2_t', 'scope3_t', 'wtt_td_t', 'biogenic_t', 'quantity', 'unit', 'kwh'];
    const fac = new Map(d.facilities.map((f) => [f.id, f.name]));
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = [head.join(','), ...c.cur.map((r) => [fac.get(r.f), r.m ? `${d.year}-${String(r.m).padStart(2, '0')}` : `${d.year} (whole year)`, r.cat, r.item, r.s1, r.s2, r.s3, r.s33, r.bio, r.qty, r.unit, r.kwh ?? ''].map(esc).join(','))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' })); a.download = `Ekotrace dashboard ${d.year} ${c.periodLabel}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const shareView = () => { navigator.clipboard?.writeText(window.location.href).then(() => toast('Link to this view copied'), () => toast('Copy the address bar to share this view')); };
  const pickNode = (id: string | null) => set({ node: id });

  return (
    <div className="page db">
      <div className="dbh">
        <div><div className="eyebrow">ANALYSE</div><h1>Dashboards</h1>
          <p>{c.path} · {d.year} · {c.periodLabel} · {CONS[d.consolidation] ?? d.consolidation} · Scope 2 {d.scope2}-based</p></div>
        <div className="row" style={{ gap: 8 }}><button className="dbtn" onClick={exportCsv}>Export</button><button className="dbtn" onClick={shareView}>Share view</button></div>
      </div>
      <nav className="dbtabs" role="tablist">{TABS.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} disabled={k === 'boards'} title={k === 'boards' ? 'Pinned views come in a later release' : undefined} onClick={() => set({ tab: k === 'overview' ? null : k })}>{n}</button>)}</nav>
      <div className="dbf">
        <select aria-label="Year" value={d.year} onChange={(e) => set({ year: e.target.value, period: null })}>{(d.years.length ? d.years : [d.year]).map((y) => <option key={y}>{y}</option>)}</select>
        <div className="seg" role="group" aria-label="Months">
          {[['year', c.lastM && c.lastM < 12 ? `Jan–${MN[c.lastM - 1]}` : 'Full year'], ['q1', 'Q1'], ['q2', 'Q2'], ['q3', 'Q3'], ['q4', 'Q4']].map(([k, n]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => set({ period: k === 'year' ? null : k })}>{n}</button>)}
        </div>
        <select aria-label="One month" value={period.startsWith('m') ? period : ''} onChange={(e) => set({ period: e.target.value || null })}><option value="">One month…</option>{MN.map((m, i) => <option key={m} value={`m${i + 1}`} disabled={!c.dataMonths.includes(i + 1)}>{m} {d.year}</option>)}</select>
        <select aria-label="Compare with" value={cmp} onChange={(e) => set({ cmp: e.target.value === 'prev' ? null : e.target.value })}>
          <option value="prev">vs {d.year - 1}</option>{baseYear && baseYear !== d.year - 1 && <option value="base">vs base year {baseYear}</option>}<option value="none">No comparison</option>
        </select>
        <div className="seg" role="group" aria-label="Scope 2 method"><button className={scope2 === 'location' ? 'on' : ''} onClick={() => set({ scope2: null })}>Location</button><button className={scope2 === 'market' ? 'on' : ''} onClick={() => set({ scope2: 'market' })}>Market</button></div>
        <select aria-label="Part of the group" value={node} onChange={(e) => pickNode(e.target.value || null)} style={{ maxWidth: 220 }}>
          <option value="">Whole group</option>
          <optgroup label="Entities & sub-groups">{nodes.filter((n) => n.kind === 'subgroup').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup>
          <optgroup label="Facilities">{nodes.filter((n) => n.kind === 'facility').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup>
        </select>
        <span className="note">{c.cmpY ? `Compared with the same months of ${c.cmpY}${c.cmpY === baseYear ? ' (base year)' : ''}` : 'No comparison'}</span>
      </div>
      {!d.rows.length ? <div className="bx"><h2>No entries in {d.year}</h2><p className="empty2">Add data under Add data, or pick another year.</p></div>
        : tab === 'emissions' ? <Emissions d={d} c={c} pick={pickNode} />
        : tab === 'energy' ? <Energy d={d} c={c} />
        : tab === 'water' ? <Water />
        : tab === 'waste' ? <Waste d={d} c={c} />
        : tab === 'travel' ? <Travel d={d} c={c} />
        : <Overview d={d} c={c} pick={pickNode} go={(t) => set({ tab: t })} />}
    </div>
  );
}

// ------------------------------------------------------------- context --
function ctx(d: Data, period: string, cmpY: number | null, nodes: OrgNode[], node: string) {
  const dataMonths = [...new Set(d.rows.filter((r) => r.m > 0).map((r) => r.m))].sort((a, b) => a - b);
  const lastM = dataMonths[dataMonths.length - 1] ?? 0;
  const want = period.startsWith('q') ? [1, 2, 3].map((i) => (Number(period[1]) - 1) * 3 + i) : period.startsWith('m') ? [Number(period.slice(1))] : MN.map((_, i) => i + 1);
  const whole = period === 'year';
  const months = want;
  const inP = (r: Row) => (r.m === 0 ? whole : months.includes(r.m));
  const cur = d.rows.filter(inP);
  // like for like: the comparison year's same months that have data this year
  const cmpMonths = months.filter((m) => dataMonths.includes(m));
  const prev = cmpY ? d.prevRows.filter((r) => (r.m === 0 ? whole : (cmpMonths.length ? cmpMonths : months).includes(r.m))) : [];
  const periodLabel = whole ? (lastM && lastM < 12 ? `Jan–${MN[lastM - 1]}` : 'Full year') : period.startsWith('q') ? `Q${period[1]}` : MN[Number(period.slice(1)) - 1]!;
  const total = sum(cur, tot);
  const un = unitFor(total);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = (id: string | null) => nodes.filter((n) => n.parent_id === id);
  const root = nodes.find((n) => !n.parent_id || !byId.has(n.parent_id)) ?? null;
  const facsOf = (id: string): Set<string> => { const n = byId.get(id); if (!n) return new Set(); if (n.kind === 'facility') return new Set([id]); const s = new Set<string>(); for (const k of kids(id)) for (const f of facsOf(k.id)) s.add(f); return s; };
  const here = node ? byId.get(node) ?? null : root;
  const path: string[] = []; for (let n = here; n; n = n.parent_id ? byId.get(n.parent_id) ?? null : null) path.unshift(n.name);
  const staff = sum(d.facilities, (f) => f.employees ?? 0), area = sum(d.facilities, (f) => f.area ?? 0);
  const cat = new Map(d.categories.map((x) => [x.code, x]));
  return { cur, prev, cmpY, months, whole, dataMonths, lastM, periodLabel, total, un, here, kids, facsOf, byId, path: path.join(' › ') || 'Whole group', staff, area, cat,
    t: (v: number) => `${fmt(v / un.k, un.d)}`, tu: (v: number) => `${fmt(v / un.k, un.d)} ${un.u}` };
}
type Ctx = ReturnType<typeof ctx>;
/** The same context with t or kt chosen for a tab's own total (small tabs in t). */
function withUnit(c: Ctx, total: number): Ctx { const un = unitFor(total); return { ...c, un, t: (v: number) => fmt(v / un.k, un.d), tu: (v: number) => `${fmt(v / un.k, un.d)} ${un.u}` }; }

/** GHG Protocol code of a row's parts: Scope 1/2 by category, Scope 3 by its category, 3.3 split off. */
function ghgParts(c: Ctx, r: Row): [string, number, 1 | 2 | 3][] {
  const k = c.cat.get(r.cat), out: [string, number, 1 | 2 | 3][] = [];
  if (r.s1) out.push([k?.ghg ?? '1.0', r.s1, 1]);
  if (r.s2) out.push([k?.scope === 2 ? k.ghg : '2.1', r.s2, 2]);
  if (r.s3) out.push([k?.ghg ?? '3.0', r.s3, 3]);
  if (r.s33) out.push(['3.3', r.s33, 3]);
  return out;
}
function ghgName(d: Data, c: Ctx, code: string) {
  if (code.startsWith('3.')) return d.s3Names[Number(code.slice(2))] ?? code;
  if (code === '2.1') return 'Purchased electricity, heat & cooling';
  return [...c.cat.values()].find((x) => x.ghg === code)?.name ?? code;
}
/** Sources: purchases by product group, everything else by item. */
const sourceOf = (r: Row) => ((r.cat === 'purchased_goods' || r.cat === 'capital_goods') && r.grp ? r.grp.split(' › ')[0]! : r.item);
const scopeTag = (r: Row): 1 | 2 | 3 => (r.s1 >= r.s2 && r.s1 >= r.s3 + r.s33 ? 1 : r.s2 >= r.s3 + r.s33 ? 2 : 3);
function groupBy(rows: Row[], key: (r: Row) => string, v: (r: Row) => number = tot) { const m = new Map<string, number>(); for (const r of rows) { const k = key(r); m.set(k, (m.get(k) ?? 0) + v(r)); } return m; }
const sorted = (m: Map<string, number>) => [...m.entries()].filter(([, v]) => v).sort((a, b) => b[1] - a[1]);

// ---------------------------------------------------------- building blocks --
interface Col { n: string; segs: { v: number; c: string; name: string }[]; line?: number | null; dim?: boolean }
function Cols({ cols, h = 260, fmtV }: { cols: Col[]; h?: number; fmtV: (v: number) => string }) {
  const totals = cols.map((c) => sum(c.segs, (s) => s.v));
  const mx = Math.max(1e-9, ...totals, ...cols.map((c) => c.line ?? 0)) * 1.08;
  const H = h - 24, n = cols.length;
  const pts = cols.map((c, i) => (c.line == null ? null : `${(((i + 0.5) / n) * 1000).toFixed(1)},${(H - (c.line / mx) * H * 0.9).toFixed(1)}`));
  const runs: string[][] = []; let cur: string[] = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }
  if (cur.length) runs.push(cur);
  return (
    <div className="cc" style={{ height: h }} role="img" aria-label="Column chart">
      <div className="cols">{cols.map((c, i) => (
        <div key={c.n + i} className={`col${c.dim ? ' dim' : ''}`} title={`${c.n}: ${fmtV(totals[i]!)}${c.line != null ? ` · comparison ${fmtV(c.line)}` : ''}`}>
          {totals[i] ? <span className="cv">{fmtV(totals[i]!)}</span> : null}
          {[...c.segs].reverse().map((s, k) => s.v > 0 ? <i key={k} style={{ height: `${((s.v / mx) * 90).toFixed(2)}%`, background: s.c }} title={`${c.n} · ${s.name}: ${fmtV(s.v)}`} /> : null)}
        </div>))}
      </div>
      <svg viewBox={`0 0 1000 ${H}`} preserveAspectRatio="none" style={{ height: H }} aria-hidden="true">
        {runs.map((r, i) => r.length > 1 ? <polyline key={i} points={r.join(' ')} fill="none" stroke="var(--fg)" strokeWidth="2" strokeDasharray="7 5" vectorEffect="non-scaling-stroke" /> : null)}
      </svg>
      <div className="xl">{cols.map((c, i) => <span key={c.n + i}>{c.n}</span>)}</div>
    </div>
  );
}
function Legend({ items, line }: { items: { n: string; c: string }[]; line?: string | null }) {
  return <div className="lg">{items.map((l) => <span key={l.n}><i style={{ background: l.c }} />{l.n}</span>)}{line && <span><i className="ln" />{line}</span>}</div>;
}
function Kpis({ cells }: { cells: { l: ReactNode; v: ReactNode; d?: ReactNode; dc?: string; sq?: string }[] }) {
  return <div className="k5">{cells.map((k, i) => <div key={i}><span className="lbl">{k.sq && <i className="sq" style={{ background: k.sq }} />}{k.l}</span><b>{k.v}</b>{k.d !== undefined && <span className={`dd ${k.dc ?? 'neu'}`}>{k.d}</span>}</div>)}</div>;
}
function Spark({ vals, c }: { vals: number[]; c: string }) {
  const mx = Math.max(1e-9, ...vals);
  return <div className="spark">{vals.map((v, i) => <i key={i} style={{ height: `${Math.max(2, (v / mx) * 100)}%`, background: c, opacity: v ? 1 : 0.2 }} />)}</div>;
}
interface PRow { n: string; v: number; txt: string; c: string }
function Panel({ t, s, rows, stack, note, empty }: { t: string; s?: string; rows: PRow[]; stack?: boolean; note?: ReactNode; empty?: string }) {
  const mx = Math.max(1e-9, ...rows.map((r) => r.v)), all = sum(rows, (r) => r.v) || 1;
  return (
    <section className="bx">
      <div><h3>{t}</h3>{s && <span className="lbl">{s}</span>}</div>
      {!rows.length ? <span className="empty2">{empty ?? 'No data for this selection.'}</span> : <>
        {stack && <div className="stk">{rows.map((r) => <i key={r.n} style={{ width: `${(r.v / all) * 100}%`, background: r.c }} title={`${r.n}: ${r.txt}`} />)}</div>}
        {rows.map((r) => (
          <div key={r.n} className="pr"><span className="n"><i style={{ background: r.c }} /><span title={r.n}>{r.n}</span></span>
            <div className="tr"><i style={{ width: `${((stack ? r.v / all : r.v / mx) * 100).toFixed(1)}%`, background: r.c }} /></div><b>{r.txt}</b></div>))}
      </>}
      {note && <span className="lbl" style={{ lineHeight: 1.4 }}>{note}</span>}
    </section>
  );
}
interface Mover { v: string; good: boolean; t: string; d: string }
function Moved({ title, movers, text }: { title: string; movers?: Mover[]; text?: ReactNode }) {
  return (
    <section className="bx moved">
      <div className="row" style={{ gap: 8 }}><h2>{title}</h2><span className="eko">Eko</span><span className="lbl" style={{ marginLeft: 'auto' }}>calculated from your entries</span></div>
      {movers ? (movers.length ? <div className="movers">{movers.map((m) => <div key={m.t}><b className={m.good ? 'good' : 'badc'}>{m.v}</b><strong>{m.t}</strong><span>{m.d}</span></div>)}</div>
        : <span className="empty2">Nothing to compare yet: the comparison year has no entries for these months.</span>) : <span style={{ fontSize: 14, lineHeight: 1.55 }}>{text}</span>}
    </section>
  );
}
/** The sources that changed most against the comparison year (same months). */
function movers(d: Data, c: Ctx, rows: Row[], prev: Row[], key: (r: Row) => string, v: (r: Row) => number = tot, n = 3): Mover[] {
  if (!c.cmpY || !prev.length) return [];
  const a = groupBy(rows, key, v), b = groupBy(prev, key, v);
  const fac = new Map(d.facilities.map((f) => [f.id, f.name]));
  return [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ k, diff: (a.get(k) ?? 0) - (b.get(k) ?? 0) })).filter((x) => Math.abs(x.diff) > 1e-6)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, n).map(({ k, diff }) => {
      const fa = groupBy(rows.filter((r) => key(r) === k), (r) => r.f, v), fb = groupBy(prev.filter((r) => key(r) === k), (r) => r.f, v);
      const top = [...new Set([...fa.keys(), ...fb.keys()])].map((f) => ({ f, x: (fa.get(f) ?? 0) - (fb.get(f) ?? 0) })).sort((p, q) => Math.abs(q.x) - Math.abs(p.x))[0];
      const was = b.get(k) ?? 0, now = a.get(k) ?? 0;
      return { v: `${diff > 0 ? '+' : '−'}${c.tu(Math.abs(diff))}`, good: diff < 0, t: k,
        d: `${was ? `${c.tu(was)} → ${c.tu(now)} (${pctTxt(chg(now, was))})` : `new this year: ${c.tu(now)}`}${top && fa.size + fb.size > 1 ? `; most of it at ${fac.get(top.f) ?? 'one facility'}` : ''}.` };
    });
}
function monthCols(c: Ctx, series: { n: string; c: string; v: (r: Row) => number }[], cum = false, cmpV?: (r: Row) => number): Col[] {
  let run = 0, runP = 0;
  const months = c.whole ? MN.map((_, i) => i + 1) : c.months;
  return months.map((m) => {
    const rs = c.cur.filter((r) => r.m === m), has = c.dataMonths.includes(m);
    const segs = series.map((s) => ({ v: sum(rs, s.v), c: s.c, name: s.n }));
    const t = sum(segs, (s) => s.v); run += t;
    const ps = c.prev.filter((r) => r.m === m), pv = cmpV && ps.length ? sum(ps, cmpV) : null; if (pv != null) runP += pv;
    if (cum && has) { const k = t ? run / t : 0; segs.forEach((s) => { s.v = t ? s.v * k : 0; }); }
    return { n: MN[m - 1]!, segs: has ? segs : [], line: pv == null ? null : cum ? runP : pv };
  });
}

// ------------------------------------------------------------ overview --
function Overview({ d, c, pick, go }: { d: Data; c: Ctx; pick: (id: string | null) => void; go: (t: Tab) => void }) {
  const [sk, setSk] = useState<Sk>('all');
  const [cum, setCum] = useState(false);
  const v = (r: Row) => val(r, sk);
  const cur = sum(c.cur, v), prev = sum(c.prev, v), yoy = c.cmpY && c.prev.length ? chg(cur, prev) : null;
  const s = (['s1', 's2', 's3'] as const).map((k) => sum(c.cur, (r) => val(r, k)));
  const keys = sk === 'all' ? (['s1', 's2', 's3'] as const) : [sk];
  const scName = { all: 'all scopes', s1: 'Scope 1', s2: 'Scope 2', s3: 'Scope 3' }[sk];
  const monthly = (f: (rs: Row[]) => number) => (c.whole ? MN.map((_, i) => i + 1) : c.months).map((m) => f(c.cur.filter((r) => r.m === m)));
  const entries = sum(c.cur, (r) => r.n), approved = sum(c.cur, (r) => r.approved), estimated = sum(c.cur, (r) => r.estimated);
  const base = d.baseYear?.total && c.whole ? chg(c.total, d.baseYear.total) : null;
  // where: the parts inside what is viewed
  const where = whereRows(c, v);
  const srcAll = new Map<string, { v: number; s: 1 | 2 | 3 }>();
  for (const r of c.cur) { const k = sourceOf(r), o = srcAll.get(k) ?? { v: 0, s: scopeTag(r) }; o.v += v(r); srcAll.set(k, o); }
  const what = [...srcAll.entries()].filter(([, o]) => o.v > 0).sort((a, b) => b[1].v - a[1].v).slice(0, 7);
  const wmax = Math.max(1e-9, ...what.map(([, o]) => o.v));
  // tiles
  const en = c.cur.filter((r) => r.kind), enK = sum(en, (r) => r.kwh ?? 0), enP = sum(c.prev.filter((r) => r.kind), (r) => r.kwh ?? 0);
  const elec = sum(en.filter((r) => r.kind === 'electricity'), (r) => r.kwh ?? 0), rec = sum(en, (r) => r.rec);
  const waste = c.cur.filter((r) => r.cat.startsWith('waste_')), wasteP = c.prev.filter((r) => r.cat.startsWith('waste_'));
  const mob = c.cur.filter((r) => r.cat === 'mobile_combustion' || r.cat === 'business_travel'), mobP = c.prev.filter((r) => r.cat === 'mobile_combustion' || r.cat === 'business_travel');
  const km = sum(c.cur.filter((r) => r.cat === 'mobile_combustion' && r.unit === 'km'), (r) => r.qty);
  const tiles = [
    { t: 'energy' as Tab, l: 'Energy', v: kwhTxt(enK), u: elec ? `${share(rec, elec)} of electricity renewable` : 'fuels, electricity and cooling', p: chg(enK, enP), sp: monthly((rs) => sum(rs.filter((r) => r.kind), (r) => r.kwh ?? 0)), c: '#2BA38A' },
    { t: 'water' as Tab, l: 'Water', v: '—', u: 'not captured yet', p: null, sp: [], c: '#2B7FA6' },
    { t: 'waste' as Tab, l: 'Waste', v: c.tu(sum(waste, tot)), u: 'emissions from waste', p: chg(sum(waste, tot), sum(wasteP, tot)), sp: monthly((rs) => sum(rs.filter((r) => r.cat.startsWith('waste_')), tot)), c: '#E3B25A' },
    { t: 'travel' as Tab, l: 'Mobility & travel', v: c.tu(sum(mob, tot)), u: km ? `${qtyTxt(km, 'km')} driven` : 'fleet and business travel', p: chg(sum(mob, tot), sum(mobP, tot)), sp: monthly((rs) => sum(rs.filter((r) => r.cat === 'mobile_combustion' || r.cat === 'business_travel'), tot)), c: '#5B6B66' },
  ];
  return <>
    <div className="dbf">
      <div className="seg" role="group" aria-label="Scope">{(['all', 's1', 's2', 's3'] as Sk[]).map((k) => <button key={k} className={sk === k ? 'on' : ''} onClick={() => setSk(k)}>{k === 'all' ? 'All scopes' : `Scope ${k[1]}`}</button>)}</div>
      <div className="seg" role="group" aria-label="View"><button className={!cum ? 'on' : ''} onClick={() => setCum(false)}>Monthly</button><button className={cum ? 'on' : ''} onClick={() => setCum(true)}>Cumulative</button></div>
    </div>
    <div className="herorow">
      <section className="hero">
        <span className="l">Emissions · {scName} · {d.year} {c.periodLabel}</span>
        <div><span className="v">{c.t(cur)}</span><span className="u">{c.un.u}CO₂e</span></div>
        <div className="chips">
          <span style={{ background: '#1F4A41', color: '#C6F06B' }}>{yoy === null ? 'no comparison' : `${pctTxt(yoy)} vs ${c.cmpY}`}</span>
          {base !== null && sk === 'all' && d.baseYear!.year !== c.cmpY && <span style={{ background: '#3A3012', color: '#F6D88A' }}>{pctTxt(base)} vs base year {d.baseYear!.year}</span>}
        </div>
        <div className="split">{s.map((x, i) => <div key={i} style={{ flex: Math.max(x, 0) || 0.0001, background: ['#8CC7B6', '#2BA38A', '#E3B25A'][i] }} />)}</div>
        <div className="sl">{s.map((x, i) => <span key={i}>Scope {i + 1} · {c.tu(x)} · {share(x, c.total)}</span>)}</div>
      </section>
      <section className="kside"><span className="lbl">Per employee</span><b>{c.staff ? `${fmt(c.total / c.staff, 1)} t` : '—'}</b>
        <span className="dd neu">{c.staff ? `${fmt(c.staff, 0)} employees` : 'add employees to the facilities'}{c.area ? ` · ${fmt((c.total * 1000) / c.area, 0)} kg/m²` : ''}</span><Spark vals={monthly((rs) => sum(rs, tot))} c="#8CC7B6" /></section>
      <section className="kside"><span className="lbl">Data confidence</span><b>{share(entries - estimated, entries)}</b>
        <span className="dd neu">actual data · {fmt(estimated, 0)} estimated entries</span><Spark vals={monthly((rs) => { const n = sum(rs, (r) => r.n); return n ? (n - sum(rs, (r) => r.estimated)) / n : 0; })} c="#2BA38A" /></section>
      <section className="kside"><span className="lbl">Approved</span><b>{share(approved, entries)}</b>
        <span className="dd neu">{fmt(entries - approved, 0)} entries waiting for approval</span><Spark vals={monthly((rs) => { const n = sum(rs, (r) => r.n); return n ? sum(rs, (r) => r.approved) / n : 0; })} c="#E3B25A" /></section>
    </div>
    <section className="bx">
      <div className="bxh"><div><h2>{cum ? 'Cumulative emissions' : 'Monthly emissions'} · {scName} · {c.path.split(' › ').pop()}</h2>
        <span className="lbl">{c.un.u}CO₂e · columns = {d.year}{c.cmpY ? ` · dashed = ${c.cmpY}` : ''}{c.whole && sum(c.cur.filter((r) => r.m === 0), v) ? ` · ${c.tu(sum(c.cur.filter((r) => r.m === 0), v))} entered for the whole year is in the totals, not the months` : ''}</span></div>
        <Legend items={keys.map((k) => ({ n: `Scope ${k[1]}`, c: C[k] }))} line={c.cmpY ? String(c.cmpY) : null} /></div>
      <Cols cols={monthCols(c, keys.map((k) => ({ n: `Scope ${k[1]}`, c: C[k], v: (r: Row) => val(r, k) })), cum, v)} fmtV={c.t} />
    </section>
    <div className="two">
      <section className="bx">
        <div className="bxh"><h2>Where · inside {c.here?.name ?? 'the group'}</h2><span className="lbl">click a row to view just that</span></div>
        <WhereList rows={where} c={c} pick={pick} />
        {c.here?.parent_id && <button className="dbtn" style={{ alignSelf: 'flex-start', height: 34 }} onClick={() => pick(c.byId.get(c.here!.parent_id!)?.parent_id ? c.here!.parent_id : null)}>↑ Up to {c.byId.get(c.here.parent_id)?.name ?? 'the group'}</button>}
      </section>
      <section className="bx">
        <div className="bxh"><h2>What</h2><span className="lbl">biggest sources · {scName}</span></div>
        {what.map(([n, o]) => (
          <div key={n} className="rb cat" style={{ gridTemplateColumns: '34px minmax(0, 1.8fr) minmax(0, 1.4fr) 70px' }}>
            <span className={`chipS s${o.s}`}>S{o.s}</span><span className="nm"><span title={n}>{n}</span></span>
            <div className="tr"><i style={{ width: `${(o.v / wmax) * 100}%`, background: C[`s${o.s}`] }} /></div><span className="v">{c.t(o.v)}</span>
          </div>))}
      </section>
    </div>
    <div className="tiles">{tiles.map((t) => (
      <button key={t.l} className="tile" onClick={() => go(t.t)}>
        <span className="th">{t.l}<span>Open →</span></span><b>{t.v}</b><span className="lbl">{t.u}</span>
        {t.sp.length ? <Spark vals={t.sp} c={t.c} /> : <div className="spark" />}
        <span className={`dd ${t.p === null ? 'neu' : cls(t.p)}`}>{t.p === null ? (t.t === 'water' ? 'comes with the water module' : '—') : `${pctTxt(t.p)} vs ${c.cmpY}`}</span>
      </button>))}
    </div>
    <Moved title={c.cmpY ? `What moved vs ${c.cmpY}` : 'What moved'} movers={movers(d, c, c.cur.filter((r) => v(r)), c.prev.filter((r) => v(r)), sourceOf, v)} />
  </>;
}

interface WRow { id: string; n: string; t: string; v: number; p: number | null; sub?: boolean }
function whereRows(c: Ctx, v: (r: Row) => number, withFacilities = false): WRow[] {
  const here = c.here;
  const kids = here ? c.kids(here.id) : [];
  const valOf = (rows: Row[], fs: Set<string>) => sum(rows.filter((r) => fs.has(r.f)), v);
  const one = (id: string, n: string, t: string, sub = false): WRow => { const fs = c.facsOf(id); const x = valOf(c.cur, fs); return { id, n, t, v: x, p: c.cmpY && c.prev.length ? chg(x, valOf(c.prev, fs)) : null, sub }; };
  const kindName = (k: string) => (k === 'facility' ? 'Facility' : k === 'subgroup' ? 'Entity / sub-group' : 'Group');
  const out: WRow[] = [];
  for (const k of kids.map((k) => one(k.id, k.name, kindName(k.kind))).filter((r) => r.v).sort((a, b) => b.v - a.v)) {
    out.push(k);
    if (withFacilities && c.byId.get(k.id)?.kind !== 'facility') {
      const fs = [...c.facsOf(k.id)].map((f) => one(f, c.byId.get(f)?.name ?? 'Facility', 'Facility', true)).filter((r) => r.v).sort((a, b) => b.v - a.v);
      out.push(...fs);
    }
  }
  return out;
}
function WhereList({ rows, c, pick }: { rows: WRow[]; c: Ctx; pick: (id: string) => void }) {
  if (!rows.length) return <span className="empty2">{c.here?.kind === 'facility' ? 'One facility: see "What" for its sources.' : 'No entries for this selection.'}</span>;
  const mx = Math.max(1e-9, ...rows.map((r) => r.v));
  return <>{rows.map((r) => (
    <button key={r.id + (r.sub ? 's' : '')} className={`rb${r.sub ? ' sub' : ''}`} onClick={() => pick(r.id)} title={`Show only ${r.n}`}>
      <span className="nm"><span>{r.n}</span>{!r.sub && <small>{r.t}</small>}</span>
      <div className="tr"><i style={{ width: `${(r.v / mx) * 100}%`, background: r.t === 'Facility' ? '#2BA38A' : '#0B4F43' }} /></div>
      <span className="v">{c.t(r.v)}</span><span className={`d ${cls(r.p)}`}>{pctTxt(r.p)}</span>
    </button>))}</>;
}

// ------------------------------------------------------------ emissions --
function Emissions({ d, c, pick }: { d: Data; c: Ctx; pick: (id: string | null) => void }) {
  const ks = ['s1', 's2', 's3'] as const;
  const cur = ks.map((k) => sum(c.cur, (r) => val(r, k))), prev = ks.map((k) => sum(c.prev, (r) => val(r, k)));
  const has = c.cmpY && c.prev.length;
  const p = (a: number, b: number) => (has ? chg(a, b) : null);
  const vsTxt = (x: number | null) => (x === null ? (c.cmpY ? `no ${c.cmpY} data` : 'no comparison') : `${pctTxt(x)} vs ${c.cmpY}`);
  const pt = p(c.total, sum(prev, (x) => x));
  const k = c.whole && c.lastM ? 12 / c.lastM : 1;
  // categories (GHG Protocol codes)
  const codes = new Map<string, { v: number; s: 1 | 2 | 3 }>(), codesP = new Map<string, number>();
  for (const r of c.cur) for (const [code, x, sc] of ghgParts(c, r)) { const o = codes.get(code) ?? { v: 0, s: sc }; o.v += x; codes.set(code, o); }
  for (const r of c.prev) for (const [code, x] of ghgParts(c, r)) codesP.set(code, (codesP.get(code) ?? 0) + x);
  const cats = [...codes.entries()].filter(([, o]) => o.v).sort((a, b) => b[1].v - a[1].v);
  const cmax = Math.max(1e-9, ...cats.map(([, o]) => o.v));
  // category × month
  const cm = new Map<string, number[]>();
  for (const r of c.cur) if (r.m > 0) for (const [code, x] of ghgParts(c, r)) { const a = cm.get(code) ?? Array(12).fill(0); a[r.m - 1] += x; cm.set(code, a); }
  const P = d.purchases, ptot = sum(P.byMethod, (m) => m.t), psup = P.byMethod.find((m) => m.method === 'supplier')?.t ?? 0;
  return <>
    <Kpis cells={[
      { l: 'Total emissions', v: c.tu(c.total), d: vsTxt(pt), dc: cls(pt) },
      ...ks.map((s, i) => ({ l: `Scope ${i + 1}`, sq: C[s], v: c.tu(cur[i]!), d: `${share(cur[i]!, c.total)} · ${vsTxt(p(cur[i]!, prev[i]!))}`, dc: cls(p(cur[i]!, prev[i]!)) })),
      { l: 'Per employee (annualised)', v: c.staff ? `${fmt((c.total * k) / c.staff, 1)} t` : '—', d: c.area ? `${fmt((c.total * k * 1000) / c.area, 0)} kg CO₂e / m²` : 'add floor areas for kg/m²' },
    ]} />
    <section className="bx">
      <div className="bxh"><div><h2>Emissions by month and scope</h2><span className="lbl">{c.un.u}CO₂e{c.cmpY ? ` · dashed = ${c.cmpY}` : ''}</span></div>
        <Legend items={ks.map((s, i) => ({ n: `Scope ${i + 1}`, c: C[s] }))} line={c.cmpY ? String(c.cmpY) : null} /></div>
      <Cols cols={monthCols(c, ks.map((s, i) => ({ n: `Scope ${i + 1}`, c: C[s], v: (r: Row) => val(r, s) })), false, tot)} fmtV={c.t} />
    </section>
    <div className="two">
      <section className="bx">
        <div className="bxh"><h2>By entity & facility</h2><span className="lbl">{c.cmpY ? `change vs ${c.cmpY}` : ''}</span></div>
        <WhereList rows={whereRows(c, tot, true)} c={c} pick={pick} />
      </section>
      <section className="bx">
        <div className="bxh"><h2>By category</h2><span className="lbl">GHG Protocol</span></div>
        {cats.map(([code, o]) => { const x = has ? chg(o.v, codesP.get(code) ?? 0) : null; return (
          <div key={code} className="rb cat"><span className={`chipS s${o.s}`}>{code}</span><span className="nm"><span title={ghgName(d, c, code)}>{ghgName(d, c, code)}</span></span>
            <div className="tr"><i style={{ width: `${(o.v / cmax) * 100}%`, background: C[`s${o.s}`] }} /></div><span className="v">{c.t(o.v)}</span><span className={`d ${cls(x)}`}>{pctTxt(x)}</span></div>); })}
      </section>
    </div>
    <Moved title={c.cmpY ? `What moved vs ${c.cmpY}` : 'What moved'} movers={movers(d, c, c.cur, c.prev, sourceOf)} />
    <section className="bx">
      <div className="bxh"><h2>By category and month</h2><span className="lbl">{c.un.u}CO₂e</span></div>
      <div className="scrollx"><table className="t dt"><thead><tr><th>Category</th>{MN.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>{cats.map(([code, o]) => { const ms = cm.get(code) ?? Array(12).fill(0), mx = Math.max(...ms) || 1;
          return <tr key={code}><td><span className={`chipS s${o.s}`} style={{ fontSize: 11, padding: '2px 6px', borderRadius: 99 }}>{code}</span> {ghgName(d, c, code)}</td>
            {ms.map((x: number, i: number) => <td key={i} className="num hm" style={{ background: x ? `color-mix(in srgb, ${C[`s${o.s}`]} ${Math.round(8 + (x / mx) * 40)}%, transparent)` : 'transparent' }}>{x ? c.t(x) : ''}</td>)}
            <td className="num"><b>{c.t(o.v)}</b></td></tr>; })}</tbody></table></div>
    </section>
    <div className="panels">
      <Panel t="Purchases by product group" s="published purchase lines · tCO₂e" rows={P.byGroup.slice(0, 6).map((g, i) => ({ n: g.name, v: g.t, txt: fmt(g.t, g.t < 10 ? 1 : 0), c: PAL[i % PAL.length]! }))} empty="No published purchases in this year." />
      <Panel t="Top suppliers" s="tCO₂e" rows={P.bySupplier.slice(0, 6).map((g) => ({ n: g.name, v: g.t, txt: fmt(g.t, g.t < 10 ? 1 : 0), c: '#E3B25A' }))} note={`${P.suppliers} suppliers · ${P.withTarget} with science-based targets`} empty="No published purchases in this year." />
      <Panel t="Data quality of purchases" s="share of purchase emissions" stack rows={ptot ? [{ n: 'Supplier-specific factor', v: psup, txt: share(psup, ptot), c: '#0E7C66' }, { n: 'Spend-based average', v: ptot - psup, txt: share(ptot - psup, ptot), c: '#E3B25A' }] : []} empty="No published purchases in this year." />
    </div>
  </>;
}

// ---------------------------------------------------------------- energy --
const fuelForm = (r: Row) => (r.cat === 'mobile_combustion' ? 'Vehicles & machinery' : r.sub || 'Other fuels');
function Energy({ d, c: c0 }: { d: Data; c: Ctx }) {
  const en = c0.cur.filter((r) => r.kind), enP = c0.prev.filter((r) => r.kind);
  const c = withUnit(c0, sum(en, tot));
  const K = (rs: Row[], f?: (r: Row) => boolean) => sum(f ? rs.filter(f) : rs, (r) => r.kwh ?? 0);
  const all = K(en), fuels = K(en, (r) => r.kind === 'fuel'), elec = K(en, (r) => r.kind === 'electricity'), cool = K(en, (r) => r.kind === 'cooling' || r.kind === 'heat');
  const rec = sum(en, (r) => r.rec), wtt = sum(en, (r) => r.s33);
  const has = c.cmpY && enP.length;
  const pe = has ? chg(all, K(enP)) : null, pf = has ? chg(fuels, K(enP, (r) => r.kind === 'fuel')) : null, pl = has ? chg(elec, K(enP, (r) => r.kind === 'electricity')) : null;
  const byDist = en.filter((r) => r.kwh === null && r.kind === 'fuel');
  const series = [
    { n: 'Fuels on site', c: '#0B4F43', v: (r: Row) => (r.cat === 'stationary_combustion' ? r.s1 : 0) },
    { n: 'Vehicles & machinery', c: '#8CC7B6', v: (r: Row) => (r.cat === 'mobile_combustion' ? r.s1 + r.s2 : 0) },
    { n: 'Electricity & cooling', c: '#2BA38A', v: (r: Row) => (r.cat === 'purchased_electricity' ? r.s2 : 0) },
    { n: 'Well-to-tank & grid losses', c: '#E3B25A', v: (r: Row) => (r.kind ? r.s33 : 0) },
  ];
  const energyT = (r: Row) => (r.kind ? r.s1 + r.s2 + r.s33 : 0);
  const fac = new Map(d.facilities.map((f) => [f.id, f]));
  const byFac = sorted(groupBy(en, (r) => r.f, (r) => r.kwh ?? 0));
  const qtyBy = new Map<string, { q: number; u: string }>();
  for (const r of en.filter((r) => r.kind === 'fuel' && r.unit !== 'km')) { const k = `${r.item}|${r.unit}`; const o = qtyBy.get(k) ?? { q: 0, u: UNIT_LABEL[r.unit] ?? r.unit }; o.q += r.qty; qtyBy.set(k, o); }
  const topFuels = [...qtyBy.entries()].sort((a, b) => b[1].q - a[1].q).slice(0, 5);
  return <>
    <Kpis cells={[
      { l: 'Energy used', v: kwhTxt(all), d: pe === null ? 'fuels, electricity and cooling' : `${pctTxt(pe)} vs ${c.cmpY}`, dc: cls(pe) },
      { l: 'From fuels', v: kwhTxt(fuels), d: pf === null ? `${share(fuels, all)} of energy` : `${share(fuels, all)} of energy · ${pctTxt(pf)}`, dc: cls(pf) },
      { l: 'Electricity', v: kwhTxt(elec), d: pl === null ? `${share(elec, all)} of energy` : `${pctTxt(pl)} vs ${c.cmpY}`, dc: cls(pl) },
      { l: 'Renewable electricity', v: share(rec, elec), d: rec ? `${kwhTxt(rec)} backed by certificates` : 'no certificates claimed', dc: 'neu' },
      { l: 'Well-to-tank & grid losses', v: c.tu(wtt), d: 'calculated, no entry needed' },
    ]} />
    <section className="bx">
      <div className="bxh"><div><h2>Energy-related emissions per month</h2><span className="lbl">{c.un.u}CO₂e{c.cmpY ? ` · dashed = ${c.cmpY}` : ''}</span></div><Legend items={series} line={c.cmpY ? String(c.cmpY) : null} /></div>
      <Cols cols={monthCols(c, series, false, energyT)} fmtV={c.t} h={230} />
    </section>
    <div className="panels">
      <Panel t="Fuel by form" s={`emissions from fuels burned · ${c.un.u}CO₂e`} rows={sorted(groupBy(en.filter((r) => r.kind === 'fuel'), fuelForm, (r) => r.s1 + r.s2)).map(([n, v], i) => ({ n, v, txt: c.t(v), c: PAL[i % PAL.length]! }))}
        note={byDist.length ? `${byDist.length} vehicle entries are recorded by distance: their emissions count, their energy is not converted.` : 'Biogenic CO₂ from bio fuels is reported separately.'} />
      <Panel t="Electricity & cooling by source" s="kWh bought" stack rows={[
        { n: 'Grid electricity', v: Math.max(0, elec - rec), txt: kwhTxt(Math.max(0, elec - rec)), c: '#2BA38A' },
        { n: 'Renewable (certificates, PPA)', v: rec, txt: kwhTxt(rec), c: '#C6F06B' },
        { n: 'District cooling & heat', v: cool, txt: kwhTxt(cool), c: '#2B7FA6' },
      ].filter((r) => r.v)} note={cool ? 'Cooling in kWh of cooling delivered (1 TRh = 3.517 kWh).' : undefined} />
      <Panel t="Well-to-tank by source" s={`upstream of fuels and power · ${c.un.u}CO₂e`} rows={sorted(groupBy(en, (r) => (r.cat === 'mobile_combustion' ? 'Vehicles & machinery' : r.cat === 'stationary_combustion' ? 'Fuels on site' : r.kind === 'electricity' ? 'Electricity (incl. grid losses)' : 'Cooling & heat'), (r) => r.s33)).map(([n, v], i) => ({ n, v, txt: c.t(v), c: PAL[i % PAL.length]! }))} />
      <Panel t="Energy by facility" s="kWh" rows={byFac.slice(0, 6).map(([f, v]) => ({ n: fac.get(f)?.name ?? 'Facility', v, txt: kwhTxt(v), c: '#0B4F43' }))} />
      <Panel t="Energy per m²" s="kWh / m² in the period, by facility" rows={byFac.filter(([f]) => fac.get(f)?.area).map(([f, v]) => ({ n: fac.get(f)!.name, v: v / fac.get(f)!.area!, txt: fmt(v / fac.get(f)!.area!, 0), c: '#2BA38A' })).sort((a, b) => b.v - a.v).slice(0, 6)} empty="Add floor areas to the facilities." />
      <Panel t="Top fuels" s={`quantities · ${c.periodLabel}`} rows={topFuels.map(([k, o], i) => ({ n: k.split('|')[0]!, v: i === 0 ? 1 : o.q / topFuels[0]![1].q, txt: qtyTxt(o.q, o.u), c: '#0B4F43' }))} empty="No fuels entered by quantity." />
    </div>
    <Moved title={c.cmpY ? `What moved vs ${c.cmpY}` : 'What moved'} movers={movers(d, c, en, enP, (r) => r.item, energyT)} />
  </>;
}

// ----------------------------------------------------------------- water --
function Water() {
  return (
    <section className="bx">
      <h2>Water</h2>
      <p className="empty2" style={{ margin: 0 }}>Water withdrawal, consumption, discharge and treatment are not captured in Ekotrace yet. When the water module is added, this tab shows them like the energy tab: withdrawn by source, discharged by destination, treatment level, litres per tonne handled and the water emissions (supply and treatment).</p>
    </section>
  );
}

// ----------------------------------------------------------------- waste --
const route = (r: Row) => { const t = `${r.item} ${r.sub}`.toLowerCase();
  return /recycl|reuse|re-use/.test(t) ? 'Recycling & reuse' : /compost|anaerobic|digest/.test(t) ? 'Composting / AD' : /incinerat|energy recovery|waste-to-energy|combust/.test(t) ? 'Incineration & energy recovery' : /wastewater|sewage/.test(t) ? 'Wastewater' : /landfill/.test(t) ? 'Landfill' : 'Other'; };
const ROUTE_C: Record<string, string> = { 'Recycling & reuse': '#0E7C66', 'Composting / AD': '#8CC7B6', 'Incineration & energy recovery': '#E3B25A', Wastewater: '#2B7FA6', Landfill: '#C2523C', Other: '#5B6B66' };
const tonnes = (r: Row) => (r.unit === 't' ? r.qty : r.unit === 'kg' ? r.qty / 1000 : 0);
function Waste({ d, c: c0 }: { d: Data; c: Ctx }) {
  const c = withUnit(c0, sum(c0.cur.filter((r) => r.cat.startsWith('waste_')), tot));
  const own = c.cur.filter((r) => r.cat === 'waste_generated'), site = c.cur.filter((r) => r.cat === 'waste_treatment');
  const ownP = c.prev.filter((r) => r.cat === 'waste_generated'), all = [...own, ...site], allP = c.prev.filter((r) => r.cat.startsWith('waste_'));
  const ownT = sum(own, tonnes), div = sum(own.filter((r) => ['Recycling & reuse', 'Composting / AD'].includes(route(r))), tonnes);
  const has = c.cmpY && allP.length;
  const pT = has && ownP.length ? chg(ownT, sum(ownP, tonnes)) : null, pE = has ? chg(sum(all, tot), sum(allP, tot)) : null;
  const divP = ownP.length ? sum(ownP.filter((r) => ['Recycling & reuse', 'Composting / AD'].includes(route(r))), tonnes) / (sum(ownP, tonnes) || 1) : null;
  const fac = new Map(d.facilities.map((f) => [f.id, f.name]));
  const routes = sorted(groupBy(all, route));
  const series = routes.map(([n]) => ({ n, c: ROUTE_C[n]!, v: (r: Row) => (r.cat.startsWith('waste_') && route(r) === n ? tot(r) : 0) }));
  const divFac = [...groupBy(own, (r) => r.f, tonnes).entries()].map(([f, t]) => { const dv = sum(own.filter((r) => r.f === f && ['Recycling & reuse', 'Composting / AD'].includes(route(r))), tonnes); return { n: fac.get(f) ?? 'Facility', v: t ? (dv / t) * 100 : 0 }; }).sort((a, b) => b.v - a.v);
  return <>
    <Kpis cells={[
      { l: 'Waste from our operations', v: `${fmt(ownT, ownT < 100 ? 1 : 0)} t`, d: pT === null ? 'sent to others (Scope 3.5)' : `${pctTxt(pT)} vs ${c.cmpY}`, dc: cls(pT) },
      { l: 'Diverted from landfill', v: share(div, ownT), d: divP === null || !ownT ? 'recycling, reuse, composting' : (Math.abs((div / ownT - divP) * 100) < 0.5 ? `same as ${c.cmpY}` : `${(div / ownT - divP) * 100 >= 0 ? '+' : '−'}${fmt(Math.abs((div / ownT - divP) * 100), 0)} pts vs ${c.cmpY}`), dc: divP === null || Math.abs(div / (ownT || 1) - divP) < 0.005 ? 'neu' : div / (ownT || 1) >= divP ? 'good' : 'badc' },
      { l: 'Emissions from waste', v: c.tu(sum(all, tot)), d: pE === null ? 'own sites and waste sent out' : `${pctTxt(pE)} vs ${c.cmpY}`, dc: cls(pE) },
      { l: 'Waste treated at own sites', v: qtyTxt(sum(site, tonnes), 't'), d: `${c.tu(sum(site, tot))} · Scope 1` },
      { l: 'Biogenic CO₂', v: c.tu(sum(all, (r) => r.bio)), d: 'reported outside the scopes' },
    ]} />
    <section className="bx">
      <div className="bxh"><div><h2>Waste emissions per month by route</h2><span className="lbl">{c.un.u}CO₂e{c.cmpY ? ` · dashed = ${c.cmpY}` : ''}{c.whole && sum(all.filter((r) => r.m === 0), tot) ? ` · ${c.tu(sum(all.filter((r) => r.m === 0), tot))} entered for the whole year (landfill methane) is in the totals, not the months` : ''}</span></div>
        <Legend items={series} line={c.cmpY ? String(c.cmpY) : null} /></div>
      <Cols cols={monthCols(c, series, false, (r) => (r.cat.startsWith('waste_') ? tot(r) : 0))} fmtV={c.t} h={230} />
    </section>
    <div className="panels">
      <Panel t="Waste from our operations by stream" s="tonnes" rows={sorted(groupBy(own, (r) => r.sub || r.item, tonnes)).map(([n, v], i) => ({ n, v, txt: `${fmt(v, v < 10 ? 1 : 0)} t`, c: PAL[i % PAL.length]! }))} empty="No waste entered under Waste → sent to others." />
      <Panel t="Where it goes" s="share of tonnes from our operations" stack rows={sorted(groupBy(own, route, tonnes)).map(([n, v]) => ({ n, v, txt: share(v, ownT), c: ROUTE_C[n]! }))} />
      <Panel t="Emissions by stream" s={`${c.un.u}CO₂e`} rows={sorted(groupBy(all, (r) => r.sub || r.item)).slice(0, 6).map(([n, v], i) => ({ n, v, txt: c.t(v), c: PAL[(i + 2) % PAL.length]! }))} />
      <Panel t="Treated at own sites" s="tonnes handled" rows={sorted(groupBy(site.filter((r) => tonnes(r)), (r) => r.item, tonnes)).map(([n, v]) => ({ n, v, txt: qtyTxt(v, 't'), c: ROUTE_C[route({ item: n, sub: '' } as Row)] ?? '#5B6B66' }))} empty="No waste treatment at own sites." />
      <Panel t="Diversion by facility" s="% of its waste diverted" rows={divFac.map((x) => ({ n: x.n, v: x.v, txt: `${fmt(x.v, 0)}%`, c: x.v >= 70 ? '#0E7C66' : '#E3B25A' }))} />
      <Panel t="Biogenic CO₂ by route" s={`${c.un.u} CO₂, outside the scopes`} rows={sorted(groupBy(all, route, (r) => r.bio)).map(([n, v]) => ({ n, v, txt: c.t(v), c: ROUTE_C[n]! }))} empty="None." />
    </div>
    <Moved title={c.cmpY ? `What moved vs ${c.cmpY}` : 'What moved'} movers={movers(d, c, all, allP, (r) => r.item)} />
  </>;
}

// ------------------------------------------------------ mobility & travel --
const fuelOf = (r: Row) => { const t = `${r.item} ${r.sub}`.toLowerCase(); return /bev|electric/.test(t) && !/hybrid|phev/.test(t) ? 'Electric' : /phev|hybrid/.test(t) ? 'Hybrid' : /lpg/.test(t) ? 'LPG' : /cng|natural gas/.test(t) ? 'CNG' : /petrol|gasoline/.test(t) ? 'Petrol' : 'Diesel'; };
const FUEL_C: Record<string, string> = { Diesel: '#0B4F43', Petrol: '#B86E0E', LPG: '#E3B25A', CNG: '#8CC7B6', Hybrid: '#2B7FA6', Electric: '#2BA38A' };
function Travel({ d, c: c0 }: { d: Data; c: Ctx }) {
  const c = withUnit(c0, sum(c0.cur.filter((r) => r.cat === 'mobile_combustion' || r.cat === 'business_travel'), tot));
  const fleet = c.cur.filter((r) => r.cat === 'mobile_combustion'), trips = c.cur.filter((r) => r.cat === 'business_travel');
  const fleetP = c.prev.filter((r) => r.cat === 'mobile_combustion'), tripsP = c.prev.filter((r) => r.cat === 'business_travel');
  const all = [...fleet, ...trips], allP = [...fleetP, ...tripsP];
  const km = fleet.filter((r) => r.unit === 'km'), kmT = sum(km, (r) => r.qty), evKm = sum(km.filter((r) => ['Electric', 'Hybrid'].includes(fuelOf(r))), (r) => r.qty);
  const has = c.cmpY && allP.length;
  const p = (a: Row[], b: Row[]) => (has ? chg(sum(a, tot), sum(b, tot)) : null);
  const fac = new Map(d.facilities.map((f) => [f.id, f.name]));
  const series = [
    { n: 'Fleet · fuel', c: '#0B4F43', v: (r: Row) => (r.cat === 'mobile_combustion' ? r.s1 + r.s33 : 0) },
    { n: 'Fleet · electricity', c: '#2BA38A', v: (r: Row) => (r.cat === 'mobile_combustion' ? r.s2 : 0) },
    { n: 'Business travel', c: '#E3B25A', v: (r: Row) => (r.cat === 'business_travel' ? tot(r) : 0) },
  ];
  const kmBy = groupBy(km, (r) => r.sub || r.item, (r) => r.qty), tBy = groupBy(km, (r) => r.sub || r.item);
  return <>
    <Kpis cells={[
      { l: 'Mobility & travel', v: c.tu(sum(all, tot)), d: p(all, allP) === null ? `${share(sum(all, tot), c.total)} of total` : `${pctTxt(p(all, allP))} vs ${c.cmpY}`, dc: cls(p(all, allP)) },
      { l: 'Fleet', v: c.tu(sum(fleet, tot)), d: p(fleet, fleetP) === null ? 'Scope 1 fuel, Scope 2 charging' : `${pctTxt(p(fleet, fleetP))} vs ${c.cmpY}`, dc: cls(p(fleet, fleetP)) },
      { l: 'Business travel', v: c.tu(sum(trips, tot)), d: p(trips, tripsP) === null ? 'Scope 3.6' : `${pctTxt(p(trips, tripsP))} vs ${c.cmpY}`, dc: cls(p(trips, tripsP)) },
      { l: 'Distance driven', v: qtyTxt(kmT, 'km'), d: kmT ? `${fmt((sum(km, tot) * 1e6) / kmT, 0)} g CO₂e / km` : 'vehicles entered by distance' },
      { l: 'Electric & hybrid', v: share(evKm, kmT), d: 'of distance driven' },
    ]} />
    <section className="bx">
      <div className="bxh"><div><h2>Mobility & travel emissions per month</h2><span className="lbl">{c.un.u}CO₂e{c.cmpY ? ` · dashed = ${c.cmpY}` : ''}</span></div><Legend items={series} line={c.cmpY ? String(c.cmpY) : null} /></div>
      <Cols cols={monthCols(c, series, false, (r) => (r.cat === 'mobile_combustion' || r.cat === 'business_travel' ? tot(r) : 0))} fmtV={c.t} h={230} />
    </section>
    <div className="panels">
      <Panel t="Fleet by vehicle type" s={`${c.un.u}CO₂e`} rows={sorted(groupBy(fleet, (r) => r.sub || r.item)).map(([n, v], i) => ({ n, v, txt: c.t(v), c: PAL[i % PAL.length]! }))} />
      <Panel t="Fleet by fuel" s="share of fleet emissions" stack rows={sorted(groupBy(fleet, fuelOf)).map(([n, v]) => ({ n, v, txt: share(v, sum(fleet, tot)), c: FUEL_C[n]! }))} />
      <Panel t="Distance by vehicle type" s="km" rows={sorted(kmBy).map(([n, v]) => ({ n, v, txt: qtyTxt(v, 'km'), c: '#2BA38A' }))} empty="No vehicles entered by distance." />
      <Panel t="Emissions per km" s="g CO₂e / km by vehicle type" rows={sorted(kmBy).map(([n, k]) => ({ n, v: k ? ((tBy.get(n) ?? 0) * 1e6) / k : 0, txt: fmt(k ? ((tBy.get(n) ?? 0) * 1e6) / k : 0, 0), c: '#0B4F43' })).sort((a, b) => b.v - a.v)} empty="No vehicles entered by distance." />
      <Panel t="Business travel" s={`${c.un.u}CO₂e by kind`} rows={sorted(groupBy(trips, (r) => r.item)).slice(0, 6).map(([n, v], i) => ({ n, v, txt: c.t(v), c: PAL[(i + 2) % PAL.length]! }))} note={trips.length ? 'From purchases (spend-based) until trips are entered with distances.' : undefined} empty="No business travel in this period." />
      <Panel t="By facility" s={`${c.un.u}CO₂e`} rows={sorted(groupBy(all, (r) => r.f)).slice(0, 6).map(([f, v]) => ({ n: fac.get(f) ?? 'Facility', v, txt: c.t(v), c: '#0B4F43' }))} />
    </div>
    <Moved title={c.cmpY ? `What moved vs ${c.cmpY}` : 'What moved'} movers={movers(d, c, all, allP, (r) => r.item)} />
  </>;
}
