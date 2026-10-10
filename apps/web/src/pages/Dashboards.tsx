/**
 * Dashboards (same compact design as the prototype): a one-line header, tabs, a stat strip
 * and a grid of small cards. Tabs: Overview · Scopes & categories · Facilities · Value chain ·
 * Mobility & travel · Waste (Energy, Water and Net zero follow with their modules).
 * Every view is built from the year's rows (facility × month × category × item, in tonnes)
 * that the API returns under the company's consolidation approach.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type OrgNode } from '../lib/api';
import { Bars, DCard, Donut, Dot, DStat, HBars, Legend, MN, PAL, SC, Treemap, fmt, fmt0, fmtT, type BarRow, type Part } from '../components/DashCharts';

interface Row { f: string; m: number; cat: string; item: string; grp: string; s1: number; s2: number; s3: number; s33: number; bio: number; memo: number; n: number; approved: number; estimated: number }
interface Data {
  year: number; years: number[]; consolidation: string; scope2: 'location' | 'market'; baseYear: { year: number; total: number | null } | null;
  rows: Row[]; prevMonthly: { m: number; s1: number; s2: number; s3: number }[];
  facilities: { id: string; name: string; parent: string | null; type: string | null; employees: number | null; area: number | null; weight: number }[];
  categories: { code: string; name: string; scope: number; ghg_category: number | null; ghg: string }[]; s3Names: Record<number, string>;
  purchases: { byGroup: { name: string; t: number }[]; bySupplier: { name: string; t: number }[]; byMethod: { method: string; t: number; lines: number }[]; suppliers: number; withTarget: number };
}
type Tab = 'overview' | 'scopes' | 'facilities' | 'chain' | 'travel' | 'waste';
const TABS: [Tab | 'energy' | 'water' | 'netzero', string][] = [['overview', 'Overview'], ['scopes', 'Scopes & categories'], ['facilities', 'Facilities'], ['energy', 'Energy'], ['water', 'Water'], ['waste', 'Waste'], ['travel', 'Mobility & travel'], ['chain', 'Value chain'], ['netzero', 'Net zero']];
const LATER = new Set(['energy', 'water', 'netzero']);
const CONS: Record<string, string> = { operational: 'operational control', financial: 'financial control', equity: 'equity share' };
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const total = (r: { s1: number; s2: number; s3: number; s33?: number }) => r.s1 + r.s2 + r.s3 + (r.s33 ?? 0);

export function Dashboards() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tab = ((sp.get('tab') as Tab) || 'overview');
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;
  const node = sp.get('node') ?? '';
  const scope2 = (sp.get('scope2') as 'location' | 'market') || 'location';
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  useEffect(() => { api.org().then((r) => setNodes(r.nodes.filter((n) => n.canSee && n.active))).catch(() => {}); }, []);
  useEffect(() => { setErr(null); api.dashboard({ year, node: node || undefined, scope2 }).then((x) => setD(x as unknown as Data)).catch((e) => setErr(e.message)); }, [year, node, scope2]);
  const c = useMemo(() => (d ? ctx(d) : null), [d]);
  if (!d || !c) return <div className="page"><div className="card empty">{err ?? 'Loading…'}</div></div>;
  const label = nodes.find((n) => n.id === node)?.name ?? 'Whole group';

  return (
    <div className="page" style={{ gap: 12 }}>
      <div className="dhead">
        <div><h1>Dashboards</h1><span className="muted">{label} · {d.year} · {CONS[d.consolidation] ?? d.consolidation} · {c.nMonths} months with data · {c.entries ? Math.round((100 * c.approved) / c.entries) : 0}% of entries approved</span></div>
        <span style={{ flex: 1 }} />
        <select className="input" value={d.year} onChange={(e) => set('year', e.target.value)} aria-label="Year">{(d.years.length ? d.years : [d.year]).map((y) => <option key={y}>{y}</option>)}</select>
        <select className="input" value={node} onChange={(e) => set('node', e.target.value || null)} aria-label="Part of the group" style={{ maxWidth: 200 }}>
          <option value="">Whole group</option>
          <optgroup label="Sub-groups">{nodes.filter((n) => n.kind === 'subgroup').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup>
          <optgroup label="Facilities">{nodes.filter((n) => n.kind === 'facility').map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</optgroup>
        </select>
        <div className="seg" role="group" aria-label="Scope 2"><button className={scope2 === 'location' ? 'on' : ''} onClick={() => set('scope2', null)}>Location</button><button className={scope2 === 'market' ? 'on' : ''} onClick={() => set('scope2', 'market')}>Market</button></div>
      </div>
      <nav className="tabs dtabs">{TABS.map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} disabled={LATER.has(k)} title={LATER.has(k) ? 'Comes with its module' : undefined} onClick={() => set('tab', k === 'overview' ? null : k)}>{n}</button>)}</nav>
      {!d.rows.length ? <div className="card empty"><h3>No entries in {d.year}</h3><p className="sub">Add data under Add data, or pick another year.</p></div>
        : tab === 'scopes' ? <Scopes d={d} c={c} />
        : tab === 'facilities' ? <Facilities d={d} c={c} onPick={(id) => set('node', id)} />
        : tab === 'chain' ? <Chain d={d} c={c} go={() => nav('/suppliers?tab=analytics')} />
        : tab === 'travel' ? <Travel d={d} c={c} />
        : tab === 'waste' ? <Waste d={d} c={c} />
        : <Overview d={d} c={c} />}
    </div>
  );
}

// ------------------------------------------------------------- context --
function ctx(d: Data) {
  const rows = d.rows;
  const s = [sum(rows, (r) => r.s1), sum(rows, (r) => r.s2), sum(rows, (r) => r.s3 + r.s33)];
  const tot = s[0]! + s[1]! + s[2]!;
  const months = [...new Set(rows.filter((r) => r.m > 0).map((r) => r.m))].sort((a, b) => a - b);
  const prevBy = new Map(d.prevMonthly.map((r) => [r.m, r]));
  // vs last year: the months with data this year against the same months last year (entries for whole years left out of both)
  const cur = sum(rows.filter((r) => r.m > 0), total), prevSame = sum(months, (m) => { const p = prevBy.get(m); return p ? p.s1 + p.s2 + p.s3 : 0; });
  const scopeOf = (r: Row) => [r.s1, r.s2, r.s3 + r.s33];
  const staff = sum(d.facilities, (f) => f.employees ?? 0), area = sum(d.facilities, (f) => f.area ?? 0);
  const cat = new Map(d.categories.map((x) => [x.code, x]));
  return {
    rows, s, tot, months, nMonths: months.length, prevBy, yoy: prevSame ? (cur / prevSame - 1) * 100 : null, staff, area, cat, scopeOf,
    entries: sum(rows, (r) => r.n), approved: sum(rows, (r) => r.approved), estimated: sum(rows, (r) => r.estimated), bio: sum(rows, (r) => r.bio), memo: sum(rows, (r) => r.memo),
    annual: sum(rows.filter((r) => r.m === 0), total),
  };
}
type C = ReturnType<typeof ctx>;
const pct = (v: number, t: number) => (t ? `${Math.round((v / t) * 100)}%` : '0%');
const yoyTxt = (c: C, y: number) => (c.yoy === null ? `no ${y - 1} data to compare` : <span><span style={{ color: c.yoy > 0 ? 'var(--bad)' : 'var(--ok)' }}>{c.yoy > 0 ? '▲ +' : '▼ −'}{fmt(Math.abs(c.yoy), 1)}%</span> vs {y - 1} ({c.nMonths} months)</span>);
/** GHG Protocol code of a row: Scope 1/2 by category, Scope 3 by its category; 3.3 split off. */
function ghgParts(c: C, r: Row): [string, number, number][] {
  const k = c.cat.get(r.cat), out: [string, number, number][] = [];
  if (r.s1) out.push([k?.ghg ?? '1.0', r.s1, 1]);
  if (r.s2) out.push([k?.ghg ?? '2.1', r.s2, 2]);
  if (r.s3) out.push([k?.ghg ?? '3.0', r.s3, 3]);
  if (r.s33) out.push(['3.3', r.s33, 3]);
  return out;
}
function ghgName(d: Data, c: C, code: string) {
  if (code.startsWith('3.')) return `${code} ${d.s3Names[Number(code.slice(2))] ?? ''}`;
  const k = [...c.cat.values()].find((x) => x.ghg === code);
  return `${code} ${k?.name ?? ''}`;
}
function monthRows(d: Data, c: C, parts: (rs: Row[]) => Part[], prevLine = false): BarRow[] {
  return MN.map((lbl, i) => {
    const m = i + 1, has = c.months.includes(m), rs = c.rows.filter((r) => r.m === m), p = c.prevBy.get(m);
    return { lbl, parts: has ? parts(rs) : [], ...(prevLine && p ? { line: p.s1 + p.s2 + p.s3 } : {}) };
  });
}

// ------------------------------------------------------------ overview --
function Overview({ d, c }: { d: Data; c: C }) {
  const scopeParts = (rs: Row[]): Part[] => [0, 1, 2].map((i) => ({ v: sum(rs, (r) => c.scopeOf(r)[i]!), c: SC[i]!, n: `Scope ${i + 1}` }));
  // sources: spend-based purchases by product group, everything else by item
  const src = new Map<string, { v: number; s: number }>();
  for (const r of c.rows) {
    const k = (r.cat === 'purchased_goods' || r.cat === 'capital_goods') && r.grp ? r.grp.split(' › ')[0]! : r.item;
    const sc = r.s1 ? 1 : r.s2 ? 2 : 3;
    const o = src.get(k) ?? { v: 0, s: sc }; o.v += total(r); src.set(k, o);
  }
  const shade: Record<number, string[]> = { 1: ['#0E4F3F', '#1F6F5C', '#3E8B76'], 2: ['#1E8C74', '#2BA38A', '#5DBBA4'], 3: ['#C99A2E', '#E9B44C', '#D27A3A', '#B8862C', '#E6C377'] }, used: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
  const tm = [...src.entries()].sort((a, b) => b[1].v - a[1].v).map(([n, o]) => ({ n, v: o.v, c: shade[o.s]![used[o.s]!++ % shade[o.s]!.length]! }));
  const tmTop = tm.slice(0, 7).concat(tm.length > 7 ? [{ n: `Other ${tm.length - 7} sources`, v: sum(tm.slice(7), (x) => x.v), c: '#9AA7A2' }] : []);
  // upstream (3.1–3.8) · own operations (S1 + S2) · downstream (3.9–3.15)
  const up = new Map<string, number>(), down = new Map<string, number>();
  let own = 0;
  for (const r of c.rows) for (const [code, v, sc] of ghgParts(c, r)) { if (sc < 3) own += v; else (Number(code.slice(2)) <= 8 ? up : down).set(code, ((Number(code.slice(2)) <= 8 ? up : down).get(code) ?? 0) + v); }
  const U = sum([...up.values()], (v) => v), Dn = sum([...down.values()], (v) => v), all = U + own + Dn || 1;
  const big = [0, 1, 2].sort((x, y) => c.s[y]! - c.s[x]!)[0]!;
  const lever = ['fuel switching, fleet electrification and refrigerant leak control', 'renewable electricity (on-site solar, green tariff, I-RECs) and cooling efficiency', 'supplier engagement and waste diversion'][big];
  const prevS = [0, 1, 2].map((i) => sum(c.months, (m) => { const p = c.prevBy.get(m); return p ? [p.s1, p.s2, p.s3][i]! : 0; }));
  const curS = [0, 1, 2].map((i) => sum(c.rows.filter((r) => r.m > 0), (r) => c.scopeOf(r)[i]!));
  const status = [{ n: 'Approved', v: c.approved, c: 'var(--primary)' }, { n: 'Waiting for approval', v: c.entries - c.approved, c: '#E9B44C' }];
  return <>
    <DStat cells={[
      ['Total emissions', <>{fmt0(c.tot)} <small>tCO₂e</small></>, yoyTxt(c, d.year)],
      [<><Dot c="var(--s1)" />Scope 1</>, `${fmt0(c.s[0]!)} t`, `${pct(c.s[0]!, c.tot)} · direct`],
      [<><Dot c="var(--s2)" />Scope 2</>, `${fmt0(c.s[1]!)} t`, `${pct(c.s[1]!, c.tot)} · ${d.scope2}-based`],
      [<><Dot c="var(--s3)" />Scope 3</>, `${fmt0(c.s[2]!)} t`, `${pct(c.s[2]!, c.tot)} · value chain`],
      ['Per employee', c.staff ? `${fmt(c.tot / c.staff, 2)} t` : '—', c.area ? `${fmt0((c.tot * 1000) / c.area)} kg / m²` : ''],
    ]} />
    <div className="dgrid">
      <DCard title="Scope-wise emissions by month" span={2}>
        <Bars rows={monthRows(d, c, scopeParts, true)} h={175} label="Monthly emissions by scope" />
        <div className="lgd"><span><i style={{ background: 'var(--s1)' }} />Scope 1</span><span><i style={{ background: 'var(--s2)' }} />Scope 2</span><span><i style={{ background: 'var(--s3)' }} />Scope 3</span>
          {d.prevMonthly.some((r) => r.m > 0) && <span><i className="ln" style={{ borderColor: 'var(--muted)' }} />{d.year - 1}</span>}{c.annual > 0 && <span className="muted">{fmt0(c.annual)} t entered for whole periods (e.g. a landfill's year) is in the totals, not the months</span>}</div>
      </DCard>
      <DCard title="Scope split">
        <div className="dsplit" style={{ flexWrap: 'nowrap' }}>
          <Donut parts={[0, 1, 2].map((i) => ({ v: c.s[i]!, c: SC[i]!, n: `Scope ${i + 1}` }))} center={fmt0(c.tot)} sub="tCO₂e" size={116} />
          <table className="t dt sst"><thead><tr><th /><th className="num">t</th><th className="num">%</th><th className="num">vs {String(d.year - 1).slice(2)}</th></tr></thead>
            <tbody>{[0, 1, 2].map((i) => { const ch = prevS[i] ? (curS[i]! / prevS[i]! - 1) * 100 : null; return (
              <tr key={i}><td style={{ whiteSpace: 'nowrap' }}><Dot c={SC[i]!} /> S{i + 1}</td><td className="num"><b>{fmt0(c.s[i]!)}</b></td><td className="num">{pct(c.s[i]!, c.tot)}</td>
                <td className="num" style={{ color: ch === null ? 'inherit' : ch > 0 ? 'var(--bad)' : 'var(--ok)' }}>{ch === null ? '—' : `${ch > 0 ? '+' : '−'}${fmt(Math.abs(ch), 0)}%`}</td></tr>); })}</tbody></table>
        </div>
        <div className="sbar">{[0, 1, 2].map((i) => <span key={i} style={{ flex: c.s[i]! || 0.0001, background: SC[i] }} />)}</div>
        <div className="sins"><b>Scope {big + 1} is {pct(c.s[big]!, c.tot)} of the total.</b> Main levers: {lever}.</div>
      </DCard>
      <DCard title="Where emissions come from" span={2} sub={`box size = tCO₂e · colour = scope · all ${tm.length} sources listed`}>
        <div className="tmwrap"><div><Treemap items={tmTop} W={320} H={215} /></div>
          <div className="tml">{tm.map((t) => <div key={t.n}><i style={{ background: t.c }} /><span className="nm" title={t.n}>{t.n}</span><b>{fmtT(t.v)} t</b><span className="muted">{c.tot ? ((t.v / c.tot) * 100 < 1 ? '<1' : Math.round((t.v / c.tot) * 100)) : 0}%</span></div>)}</div></div>
      </DCard>
      <DCard title="Top 5 contributors">
        {tm.slice(0, 5).map((t, i) => <div key={t.n} className="t5"><span className="rk">{i + 1}</span><span style={{ flex: 1, minWidth: 0 }}><b>{t.n}</b><small>{fmt0(t.v)} t · {pct(t.v, c.tot)}</small></span><i style={{ background: t.c }} /></div>)}
      </DCard>
      <DCard title="Upstream · own operations · downstream" span={2}>
        <div className="vchain">
          <div style={{ flex: Math.max(U, all * 0.06) }} className="vc up"><b>{fmt0(U)} t</b><small>Upstream · {pct(U, all)}</small></div>
          <div style={{ flex: Math.max(own, all * 0.06) }} className="vc own"><b>{fmt0(own)} t</b><small>Own operations (S1+S2) · {pct(own, all)}</small></div>
          <div style={{ flex: Math.max(Dn, all * 0.06) }} className="vc down"><b>{fmt0(Dn)} t</b><small>Downstream</small></div>
        </div>
        <div className="vcl">
          <div><span className="lbl">Upstream</span>{[...up.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k}>{ghgName(d, c, k)}<b>{fmt0(v)}</b></div>)}{!up.size && <div className="muted">none measured</div>}</div>
          <div><span className="lbl">Downstream</span>{[...down.entries()].map(([k, v]) => <div key={k}>{ghgName(d, c, k)}<b>{fmt0(v)}</b></div>)}{!down.size && <div className="muted">No downstream sources measured (categories 3.9–3.15).</div>}</div>
        </div>
      </DCard>
      <DCard title="Data status">
        <div className="dsplit"><Donut parts={status} center={pct(c.approved, c.entries)} sub="approved" size={118} /><Legend parts={status} unit="entries" /></div>
        <div className="muted" style={{ fontSize: 12 }}>{fmt0(c.estimated)} entries estimated (not actual data){c.bio ? ` · ${fmtT(c.bio)} t biogenic CO₂ reported outside the scopes` : ''}{d.baseYear?.total ? ` · base year ${d.baseYear.year}: ${fmt0(d.baseYear.total)} t` : ''}.</div>
      </DCard>
    </div>
  </>;
}

// ------------------------------------------------- scopes & categories --
function Scopes({ d, c }: { d: Data; c: C }) {
  const by: Record<number, Map<string, number>> = { 1: new Map(), 2: new Map(), 3: new Map() };
  const codes = new Map<string, number[]>();
  for (const r of c.rows) for (const [code, v, sc] of ghgParts(c, r)) {
    by[sc]!.set(code, (by[sc]!.get(code) ?? 0) + v);
    const a = codes.get(code) ?? Array(12).fill(0); if (r.m > 0) a[r.m - 1] += v; codes.set(code, a);
  }
  const yearTot = (code: string) => sum(c.rows.flatMap((r) => ghgParts(c, r)).filter(([k]) => k === code), ([, v]) => v);
  return <>
    <DStat cells={[...[0, 1, 2].map((i): [ReactNode, ReactNode, ReactNode] => [<><Dot c={SC[i]!} />Scope {i + 1}</>, `${fmt0(c.s[i]!)} t`, `${pct(c.s[i]!, c.tot)} of total · ${by[i + 1]!.size} categories`]),
      ['Categories reported', `${codes.size} of 22`, 'GHG Protocol codes with data']]} />
    <div className="dgrid">
      {[1, 2, 3].map((sc) => { const parts = [...by[sc]!.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ n: ghgName(d, c, k), v, c: PAL[(i + sc) % PAL.length]! })); const t = sum(parts, (p) => p.v);
        return <DCard key={sc} title={<><Dot c={SC[sc - 1]!} />Scope {sc}</>}><div className="dsplit"><Donut parts={parts} center={fmt0(t)} sub="t" size={130} /><Legend parts={parts} unit="t" /></div></DCard>; })}
      <DCard title="By GHG Protocol category and month (tCO₂e)" span={3}>
        <div className="scrollx"><table className="t dt"><thead><tr><th>Category</th>{MN.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total</th><th className="num">Share</th></tr></thead>
          <tbody>{[...codes.keys()].sort((a, b) => yearTot(b) - yearTot(a)).map((k) => { const ms = codes.get(k)!, t = yearTot(k), mx = Math.max(...ms) || 1, s = k[0];
            return <tr key={k}><td><span className={`codechip s${s}`}>{k}</span> {ghgName(d, c, k).slice(k.length + 1)}</td>
              {ms.map((v, i) => <td key={i} className="num hm" style={{ background: v ? `color-mix(in srgb, var(--s${s}) ${Math.round(10 + (v / mx) * (s === '1' ? 28 : 45))}%, transparent)` : 'transparent' }}>{v ? fmt0(v) : ''}</td>)}
              <td className="num"><b>{fmt0(t)}</b></td><td className="num">{c.tot ? fmt((t / c.tot) * 100, 1) : 0}%</td></tr>; })}</tbody></table></div>
        {c.annual > 0 && <div className="muted" style={{ fontSize: 11.5 }}>Months show entries for one month; {fmt0(c.annual)} t entered for longer periods is in the totals only.</div>}
      </DCard>
    </div>
  </>;
}

// ----------------------------------------------------------- facilities --
function Facilities({ d, c, onPick }: { d: Data; c: C; onPick: (id: string) => void }) {
  const k = c.nMonths ? 12 / c.nMonths : 1;
  const rows = d.facilities.map((f) => { const rs = c.rows.filter((r) => r.f === f.id); const s = [0, 1, 2].map((i) => sum(rs, (r) => c.scopeOf(r)[i]!)); const t = s[0]! + s[1]! + s[2]!;
    return { f, s, t, int: f.employees ? (t * k) / f.employees : null, m2: f.area ? (t * k * 1000) / f.area : null, months: MN.map((_, i) => sum(rs.filter((r) => r.m === i + 1), total)) }; })
    .filter((x) => x.t !== 0).sort((a, b) => b.t - a.t);
  const mx = Math.max(1e-9, ...rows.flatMap((x) => x.months));
  const hi = rows.filter((x) => x.int !== null).sort((a, b) => b.int! - a.int!)[0];
  return <>
    <DStat cells={[['Facilities', String(rows.length), 'with entries this year'], ['Largest', rows[0]?.f.name ?? '—', rows[0] ? `${fmt0(rows[0].t)} t · ${pct(rows[0].t, c.tot)}` : ''],
      ['Average per facility', `${fmt0(c.tot / (rows.length || 1))} t`, String(d.year)], ['Highest intensity', hi?.f.name ?? '—', hi ? `${fmt(hi.int!, 1)} t / employee / yr` : 'add employees to facility profiles']]} />
    <div className="dgrid">
      <DCard title="Emissions by facility and scope" span={2} sub="click a facility to show only its figures">
        <HBars items={rows.map((x) => ({ n: x.f.name, v: x.t, parts: x.s.map((v, i) => ({ v, c: SC[i]! })), onClick: () => onPick(x.f.id) }))} unit="t" />
      </DCard>
      <DCard title="Share of total"><div className="dsplit"><Donut parts={rows.map((x, i) => ({ n: x.f.name, v: x.t, c: PAL[i % PAL.length]! }))} center={String(rows.length)} sub="facilities" size={130} /><Legend parts={rows.map((x, i) => ({ n: x.f.name, v: x.t, c: PAL[i % PAL.length]! }))} unit="t" /></div></DCard>
      <DCard title="Intensity (annualised)"><HBars items={rows.filter((x) => x.int !== null).map((x) => ({ n: x.f.name, v: x.int!, d: 1 })).sort((a, b) => b.v - a.v)} unit="t / employee" c="var(--s3)" /></DCard>
      <DCard title="Per floor area (annualised)" span={2}><HBars items={rows.filter((x) => x.m2 !== null).map((x) => ({ n: x.f.name, v: x.m2! })).sort((a, b) => b.v - a.v)} unit="kg / m²" c="var(--s1)" /></DCard>
      <DCard title="Heatmap · facility × month (tCO₂e)" span={3}>
        <div className="scrollx"><table className="t dt"><thead><tr><th>Facility</th>{MN.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
          <tbody>{rows.map((x) => <tr key={x.f.id}><td><b>{x.f.name}</b></td>{x.months.map((v, i) => <td key={i} className="num hm" style={{ background: v ? `color-mix(in srgb, var(--primary) ${Math.round(8 + (v / mx) * 62)}%, transparent)` : 'transparent' }}>{v ? fmt0(v) : c.months.includes(i + 1) ? '—' : ''}</td>)}</tr>)}</tbody></table></div>
        <div className="muted" style={{ fontSize: 11.5 }}>— = no entry for that month while other facilities have one: a gap to chase.</div>
      </DCard>
    </div>
  </>;
}

// ----------------------------------------------------------- value chain --
function Chain({ d, c, go }: { d: Data; c: C; go: () => void }) {
  const up = new Map<string, number>();
  for (const r of c.rows) for (const [code, v, sc] of ghgParts(c, r)) if (sc === 3) up.set(code, (up.get(code) ?? 0) + v);
  const upParts = [...up.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ n: ghgName(d, c, k), v, c: PAL[(i + 3) % PAL.length]! }));
  const P = d.purchases, pt = sum(P.byMethod, (m) => m.t), sup = P.byMethod.find((m) => m.method === 'supplier')?.t ?? 0;
  const q = [{ n: 'Supplier-specific', v: sup, c: 'var(--ok)' }, { n: 'Spend-based average', v: pt - sup, c: '#E9B44C' }];
  const p31 = sum(c.rows.filter((r) => r.cat === 'purchased_goods'), (r) => r.s3);
  return <>
    <DStat cells={[['Scope 3', <>{fmt0(c.s[2]!)} <small>t</small></>, `${pct(c.s[2]!, c.tot)} of total`], ['Purchased goods & services', `${fmt0(p31)} t`, 'category 3.1'],
      ['Supplier-specific data', pt ? pct(sup, pt) : '—', 'of purchase emissions'], ['Suppliers', String(P.suppliers), `${P.withTarget} with science-based targets`]]} />
    <div className="dgrid">
      <DCard title="Scope 3 by category"><div className="dsplit"><Donut parts={upParts} center={fmt0(sum(upParts, (p) => p.v))} sub="t" size={140} /><Legend parts={upParts} unit="t" /></div></DCard>
      <DCard title="Purchases by category" span={2}>{P.byGroup.length ? <Treemap items={P.byGroup.map((g, i) => ({ n: g.name, v: g.t, c: PAL[i % PAL.length]! }))} W={640} H={180} /> : <div className="muted" style={{ fontSize: 13 }}>No published purchases in this period yet. Publish a purchases batch (Add data → Purchases); its lines appear here.</div>}</DCard>
      <DCard title="Top suppliers by emissions" span={2} right={<button className="btn sm ghost" onClick={go}>Suppliers →</button>}><HBars items={P.bySupplier.map((s) => ({ n: s.name, v: s.t, d: 1 }))} unit="t" c="var(--s3)" /></DCard>
      <DCard title="Data quality of purchase emissions"><div className="dsplit"><Donut parts={q} center={pt ? pct(sup, pt) : '—'} sub="specific" size={130} /><Legend parts={q} unit="t" /></div></DCard>
    </div>
  </>;
}

// ------------------------------------------------------ mobility & travel --
function Travel({ d, c }: { d: Data; c: C }) {
  const rs = c.rows.filter((r) => r.cat === 'mobile_combustion' || r.cat === 'business_travel');
  const fleet = rs.filter((r) => r.cat === 'mobile_combustion'), travel = rs.filter((r) => r.cat === 'business_travel');
  const parts = [{ n: 'Fleet (Scope 1)', v: sum(fleet, total), c: '#1F6F5C' }, { n: 'Business travel (3.6)', v: sum(travel, total), c: '#E9B44C' }];
  const items = new Map<string, number>(); for (const r of rs) items.set(r.item, (items.get(r.item) ?? 0) + total(r));
  const tt = sum(parts, (p) => p.v);
  return <>
    <DStat cells={[['Mobility emissions', <>{fmt0(tt)} <small>t</small></>, 'fleet and business travel'], ['Fleet', `${fmt0(parts[0]!.v)} t`, `${fleet.length ? new Set(fleet.map((r) => r.item)).size : 0} vehicle types / fuels`], ['Business travel', `${fmt0(parts[1]!.v)} t`, 'from purchases (spend-based until distances are entered)'], ['Share of total', pct(tt, c.tot), String(d.year)]]} />
    <div className="dgrid">
      <DCard title="By month (tCO₂e)" span={2}><Bars rows={monthRows(d, c, (m) => [{ v: sum(m.filter((r) => r.cat === 'mobile_combustion'), total), c: '#1F6F5C', n: 'Fleet' }, { v: sum(m.filter((r) => r.cat === 'business_travel'), total), c: '#E9B44C', n: 'Business travel' }])} h={175} />
        <div className="lgd">{parts.map((p) => <span key={p.n}><i style={{ background: p.c }} />{p.n}</span>)}</div></DCard>
      <DCard title="Split"><div className="dsplit"><Donut parts={parts} center={fmt0(tt)} sub="t" size={130} /><Legend parts={parts} unit="t" /></div></DCard>
      <DCard title="By activity" span={3}><HBars items={[...items.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, d: 1, p: tt ? (v / tt) * 100 : 0 }))} unit="t" c="#1F6F5C" /></DCard>
    </div>
  </>;
}

// ----------------------------------------------------------------- waste --
function Waste({ d, c }: { d: Data; c: C }) {
  const rs = c.rows.filter((r) => r.cat === 'waste_treatment' || r.cat === 'waste_generated');
  const items = new Map<string, number>(); for (const r of rs) items.set(r.item, (items.get(r.item) ?? 0) + total(r));
  const parts = [...items.entries()].sort((a, b) => b[1] - a[1]).map(([n, v], i) => ({ n, v, c: PAL[i % PAL.length]! }));
  const own = sum(rs.filter((r) => r.cat === 'waste_treatment'), total), out = sum(rs.filter((r) => r.cat === 'waste_generated'), total), bio = sum(rs, (r) => r.bio);
  return <>
    <DStat cells={[['Waste emissions', <>{fmt0(own + out)} <small>t</small></>, pct(own + out, c.tot) + ' of total'], ['Own sites (Scope 1)', `${fmt0(own)} t`, 'landfill, waste-to-energy, composting, wastewater'], ['Sent to others (3.5)', `${fmtT(out)} t`, 'office and site waste'], ['Biogenic CO₂', `${fmt0(bio)} t`, 'reported outside the scopes']]} />
    <div className="dgrid">
      <DCard title="Waste emissions by month (tCO₂e)" span={2}><Bars rows={monthRows(d, c, (m) => parts.slice(0, 6).map((p) => ({ v: sum(m.filter((r) => r.item === p.n), total), c: p.c, n: p.n })))} h={175} />
        {c.annual > 0 && <div className="muted" style={{ fontSize: 11.5 }}>Landfill methane is entered for the whole year (decay of all waste in place): in the totals, not the months.</div>}</DCard>
      <DCard title="By treatment"><div className="dsplit"><Donut parts={parts} center={fmt0(own + out)} sub="t" size={130} /><Legend parts={parts} unit="t" /></div></DCard>
    </div>
  </>;
}
