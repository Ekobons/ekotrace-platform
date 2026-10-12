/**
 * Dashboards, as in the Ekotrace prototype: a top bar with two pickers (VIEWING: the company, a
 * sub-group, a facility or a dashboard group; PERIOD: year, months and comparison), a header
 * line (period, consolidation, approved data or approved + waiting, % of required data in),
 * nine tabs (Overview · Scopes & categories · Facilities · Energy · Water · Waste · Mobility &
 * travel · Value chain · Net zero) and compact cards: stat strip, stacked monthly bars with the
 * comparison year as a line, donuts, a treemap of every source, top contributors.
 *
 * Every figure comes from the year's rows (facility × month × category × item, in tonnes, with
 * quantities and kWh) under the company's consolidation approach. By default only approved
 * entries count; "Include waiting" adds the entries waiting for approval. Months where not
 * every facility has data yet are drawn pale, and the change against last year uses only the
 * complete months.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type DashGroup, type OrgNode } from '../lib/api';
import { Icon } from '../components/Icon';
import { Bars, DCard, Donut, Dot, DStat, HBars, Legend, MN, PAL, SC, Treemap, fmt, fmt0, fmtT, type BarRow, type Part } from '../components/DashCharts';

interface Row {
  f: string; m: number; cat: string; item: string; grp: string; sub: string; unit: string; s1: number; s2: number; s3: number; s33: number; bio: number; memo: number;
  n: number; approved: number; estimated: number; qty: number; rec: number; kind: 'fuel' | 'electricity' | 'cooling' | 'heat' | null; kwh: number | null;
}
interface Data {
  year: number; years: number[]; group: { id: string; name: string } | null; pend: boolean; consolidation: string; scope2: 'location' | 'market';
  baseYear: { year: number; total: number | null } | null; cmpYear: number; rows: Row[]; prevRows: Row[];
  facilities: { id: string; name: string; parent: string | null; type: string | null; employees: number | null; area: number | null; weight: number }[];
  categories: { code: string; name: string; scope: number; ghg_category: number | null; ghg: string }[]; s3Names: Record<number, string>;
  purchases: { byGroup: { name: string; t: number }[]; bySupplier: { name: string; t: number }[]; byMethod: { method: string; t: number; lines: number }[]; suppliers: number; withTarget: number };
  filled: [string, number][]; waiting: [string, number][];
}
type Tab = 'overview' | 'scopes' | 'facilities' | 'energy' | 'water' | 'waste' | 'travel' | 'chain' | 'netzero';
const DTABS: [Tab, string][] = [['overview', 'Overview'], ['scopes', 'Scopes & categories'], ['facilities', 'Facilities'], ['energy', 'Energy'], ['water', 'Water'], ['waste', 'Waste'], ['travel', 'Mobility & travel'], ['chain', 'Value chain'], ['netzero', 'Net zero']];
const CONS: Record<string, string> = { operational: 'operational control', financial: 'financial control', equity: 'equity share' };
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const tot = (r: Row) => r.s1 + r.s2 + r.s3 + r.s33;
const S = [(r: Row) => r.s1, (r: Row) => r.s2, (r: Row) => r.s3 + r.s33];
const pc = (v: number, t: number) => (!t ? '0%' : v > 0 && v / t < 0.005 ? '<1%' : `${Math.round((v / t) * 100)}%`);
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const signPct = (p: number, d = 1) => `${p > 0 ? '+' : '−'}${fmt(Math.abs(p), d)}%`;

export function Dashboards() {
  const { role, tenant } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'overview';
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;
  const node = sp.get('node') ?? '';
  const group = sp.get('group') ?? '';
  const scope2 = (sp.get('scope2') as 'location' | 'market') || 'location';
  const per = sp.get('per') ?? 'ytd';
  const cmp: 'prev' | 'none' = sp.get('cmp') === 'none' ? 'none' : 'prev';
  const pend = sp.get('pend') === '1';
  const set = (o: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(o)) if (v) n.set(k, v); else n.delete(k); setSp(n); };
  const [panel, setPanel] = useState<'scope' | 'period' | null>(null);
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [groups, setGroups] = useState<DashGroup[]>([]);
  const [baseYr, setBaseYr] = useState<number | null>(null);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.org().then((r) => setNodes(r.nodes.filter((n) => n.canSee && n.active))).catch(() => {}); api.dashGroups().then((r) => setGroups(r.allowed ? r.groups : [])).catch(() => {}); }, []);
  useEffect(() => {
    setErr(null);
    api.dashboard({ year, node: group ? undefined : node || undefined, group: group || undefined, scope2, pend: pend ? '1' : undefined })
      .then((x) => { const dd = x as unknown as Data; setD(dd); if (dd.baseYear) setBaseYr(dd.baseYear.year); }).catch((e) => setErr((e as Error).message));
  }, [year, node, group, scope2, pend]);
  const c = useMemo(() => (d ? ctx(d, per, cmp) : null), [d, per, cmp]);

  // what is viewed
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => !n.parent_id || !byId.has(n.parent_id)) ?? null;
  const here = node ? byId.get(node) ?? null : root;
  const kind = d?.group ? 'DASHBOARD GROUP' : !here || here.kind === 'group' ? 'COMPANY' : here.kind === 'subgroup' ? 'SUB-GROUP' : 'FACILITY';
  const name = d?.group?.name ?? here?.name ?? tenant?.name ?? 'Company';
  const nFac = d?.facilities.length ?? 0;
  const pick = (id: string | null) => { set({ node: id && id !== root?.id ? id : null, group: null }); setPanel(null); };

  return (
    <div className="page" style={{ gap: 12 }}>
      <div className="dtop">
        <button className={`pickbtn${panel === 'scope' ? ' on' : ''}`} onClick={() => setPanel(panel === 'scope' ? null : 'scope')} aria-expanded={panel === 'scope'}>
          <Icon name="tree" size={20} /><span className="pl"><small>VIEWING · {kind}</small><b>{name}</b></span>
          <span className="chip grey">{nFac} {nFac === 1 ? 'facility' : 'facilities'}</span><span className="car">{panel === 'scope' ? '▴' : '▾'}</span>
        </button>
        <button className={`pickbtn${panel === 'period' ? ' on' : ''}`} onClick={() => setPanel(panel === 'period' ? null : 'period')} aria-expanded={panel === 'period'}>
          <Icon name="calendar" size={20} /><span className="pl"><small>PERIOD</small><b>{d ? `${d.year} · ${c?.periodLabel ?? ''}` : '…'}</b></span>
          <span className="chip grey">{c?.cmpOn ? `vs ${d!.cmpYear}` : 'no comparison'}</span><span className="car">{panel === 'period' ? '▴' : '▾'}</span>
        </button>
        <span className="grow" />
        {role !== 'verifier' && <Link className="btn p" to="/data/stationary_combustion"><Icon name="plus" size={16} />Add data</Link>}
      </div>

      {panel === 'scope' && (
        <div className="dpanel">
          <div className="pcol" style={{ flex: '2 1 460px' }}>
            <div className="row"><span className="lbl">Click a name to view it</span><span className="grow" /><button className="btn sm ghost" onClick={() => setPanel(null)}>Close ✕</button></div>
            <div className="plist"><OrgRows nodes={nodes} root={root} cur={d?.group ? null : here?.id ?? null} pick={pick} /></div>
          </div>
          <div className="pcol" style={{ flex: '1 1 280px' }}>
            <span className="lbl">Dashboard groups</span>
            {groups.length ? groups.map((g) => (
              <button key={g.id} className={`prow${group === g.id ? ' on' : ''}`} onClick={() => { set({ group: g.id, node: null }); setPanel(null); }}>
                <span className="pic grp"><Icon name="grid" size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}><b>{g.name}</b><small>{g.facilityIds.length} facilities</small></span>
                {group === g.id && <span className="chip">Viewing</span>}
              </button>))
              : <div className="muted" style={{ fontSize: 13, padding: '6px 0' }}>No groups yet.{role !== 'verifier' ? ' Create one under Organisation › Dashboard groups.' : ''}</div>}
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, borderTop: '1px solid var(--line)', paddingTop: 10 }}>You see the facilities your access allows. Groups only appear when you can see every facility in them, so there are no partial totals.</div>
          </div>
        </div>)}

      {panel === 'period' && d && c && (
        <div className="dpanel">
          <div className="pcol"><span className="lbl">1 · Year</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{[...new Set([d.year, ...d.years])].sort((a, b) => b - a).map((y) => (
              <button key={y} className={`pchip${d.year === y ? ' on' : ''}`} onClick={() => set({ year: String(y), per: null })}>{y === baseYr ? `${y} · base year` : y}</button>))}</div>
          </div>
          <div className="pcol" style={{ flex: '1 1 360px' }}><span className="lbl">2 · Which months</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button className={`pchip${per === 'ytd' ? ' on' : ''}`} onClick={() => set({ per: null })}>{c.nMax < 12 ? 'Year to date' : 'Full year'}</button>
              {[1, 2, 3, 4].map((q) => <button key={q} className={`pchip${per === `q${q}` ? ' on' : ''}`} disabled={(q - 1) * 3 >= c.nMax} onClick={() => set({ per: `q${q}` })}>Q{q}</button>)}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>or one month</span>
            <div className="pmonths">{MN.map((m, i) => <button key={m} className={`pchip${per === `m${i + 1}` ? ' on' : ''}`} disabled={i >= c.nMax} onClick={() => set({ per: `m${i + 1}` })}>{m}</button>)}</div>
          </div>
          <div className="pcol"><span className="lbl">3 · Compare with</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button className={`pchip${cmp === 'prev' ? ' on' : ''}`} disabled={!d.prevRows.length} title={d.prevRows.length ? undefined : `No ${d.cmpYear} entries to compare with`} onClick={() => set({ cmp: null })}>Same months last year</button>
              <button className={`pchip${cmp === 'none' ? ' on' : ''}`} onClick={() => set({ cmp: 'none' })}>No comparison</button>
            </div>
            <span className="lbl" style={{ marginTop: 6 }}>Scope 2</span>
            <div className="seg"><button className={scope2 === 'location' ? 'on' : ''} onClick={() => set({ scope2: null })}>Location-based</button><button className={scope2 === 'market' ? 'on' : ''} onClick={() => set({ scope2: 'market' })}>Market-based</button></div>
            <button className="btn p" style={{ marginTop: 6 }} onClick={() => setPanel(null)}>Done</button>
          </div>
        </div>)}

      {!d || !c ? <div className="card empty">{err ?? 'Loading…'}</div> : <>
        <div className="dhead">
          <div><h1>Dashboards</h1>
            <span className="muted">{name} · {d.year} · {c.periodLabel} · {CONS[d.consolidation] ?? d.consolidation} · {pend ? 'approved + waiting' : 'approved data'}{c.rep.length ? ` · ${Math.round(c.complete * 100)}% of required data in` : ''}</span></div>
          <span className="grow" />
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={pend} onChange={(e) => set({ pend: e.target.checked ? '1' : null })} /> Include waiting</label>
          <Link className="btn sm ghost" to="/entries">Entries & results →</Link>
        </div>
        <nav className="tabs dtabs" role="tablist">{DTABS.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => set({ tab: k === 'overview' ? null : k })}>{n}</button>)}</nav>
        {!c.cur.length && tab !== 'water' && tab !== 'netzero'
          ? <div className="card muted">No {pend ? '' : 'approved '}entries for {name} in {d.year} · {c.periodLabel}.{pend ? '' : ' Tick “Include waiting” to see the entries waiting for approval.'}</div>
          : tab === 'scopes' ? <Scopes d={d} c={c} />
          : tab === 'facilities' ? <Facilities d={d} c={c} pick={(id) => set({ node: id, group: null })} />
          : tab === 'energy' ? <Energy d={d} c={c} />
          : tab === 'water' ? <Water c={c} />
          : tab === 'waste' ? <Waste d={d} c={c} />
          : tab === 'travel' ? <Travel c={c} />
          : tab === 'chain' ? <Chain d={d} c={c} />
          : tab === 'netzero' ? <NetZero d={d} c={c} />
          : <Overview d={d} c={c} go={(t) => set({ tab: t })} />}
      </>}
    </div>
  );
}

function OrgRows({ nodes, root, cur, pick }: { nodes: OrgNode[]; root: OrgNode | null; cur: string | null; pick: (id: string) => void }) {
  const kids = (id: string) => nodes.filter((n) => n.parent_id === id).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const facsUnder = (id: string): number => kids(id).reduce((a, k) => a + (k.kind === 'facility' ? 1 : facsUnder(k.id)), 0);
  const out: ReactNode[] = [];
  const walk = (n: OrgNode, depth: number) => {
    out.push(
      <button key={n.id} className={`prow${cur === n.id ? ' on' : ''}`} style={{ paddingLeft: 12 + depth * 22 }} onClick={() => pick(n.id)}>
        <span className={`pic ${n.kind}`}><Icon name={n.kind === 'facility' ? 'building' : 'grid'} size={15} /></span>
        <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: n.kind === 'facility' ? 600 : 700 }}>{n.name}</b>
          <small>{n.kind === 'group' ? 'Main entity' : n.kind === 'subgroup' ? `Sub-group · ${facsUnder(n.id)} facilities` : n.facility_type ?? 'Facility'}</small></span>
        {cur === n.id && <span className="chip">Viewing</span>}
      </button>);
    for (const k of kids(n.id)) walk(k, depth + 1);
  };
  if (root) walk(root, 0);
  return <>{out}</>;
}

// ------------------------------------------------------------- context --
function ctx(d: Data, per: string, cmp: 'prev' | 'none') {
  const nowY = new Date().getFullYear();
  const lastData = Math.max(0, ...d.filled.map((x) => x[1]), ...d.rows.filter((r) => r.m > 0).map((r) => r.m));
  const nMax = d.year < nowY ? 12 : Math.max(1, lastData);
  const ytd = per === 'ytd';
  const months = per.startsWith('q') ? range((Number(per[1]) - 1) * 3 + 1, Number(per[1]) * 3).filter((m) => m <= nMax) : per.startsWith('m') ? [Number(per.slice(1))] : range(1, nMax);
  const with0 = ytd && nMax === 12; // entries for a whole year count only in the full-year view
  const inP = (r: Row) => (r.m === 0 ? with0 : months.includes(r.m));
  const cur = d.rows.filter(inP);
  const periodLabel = !months.length ? 'no months' : months.length === 1 ? MN[months[0]! - 1]! : `${MN[months[0]! - 1]}–${MN[months[months.length - 1]! - 1]}`;
  // completeness: the facilities in the totals that report monthly (activity data in at least half
  // the months so far) are expected every month; a month is complete when all of them have data
  const filled = new Set(d.filled.map(([f, m]) => `${f}|${m}`)), waiting = new Set(d.waiting.map(([f, m]) => `${f}|${m}`));
  const rep = d.facilities.filter((f) => f.weight > 0 && range(1, nMax).filter((m) => filled.has(`${f.id}|${m}`)).length >= Math.ceil(nMax / 2));
  const full = (m: number) => rep.length > 0 && rep.every((f) => filled.has(`${f.id}|${m}`));
  const complete = rep.length && months.length ? sum(months, (m) => rep.filter((f) => filled.has(`${f.id}|${m}`)).length) / (rep.length * months.length) : 1;
  // change vs last year on the complete months only
  const cmpOn = cmp === 'prev' && d.prevRows.length > 0;
  const fullM = rep.length ? months.filter(full) : months, cm = fullM.length ? fullM : months;
  const inC = (r: Row) => (r.m === 0 ? with0 && cm.length === 12 : cm.includes(r.m));
  const curC = d.rows.filter(inC), prevC = cmpOn ? d.prevRows.filter(inC) : [];
  const yoyOf = (f: (r: Row) => number) => { const b = sum(prevC, f); return cmpOn && b ? (sum(curC, f) / b - 1) * 100 : null; };
  const s = S.map((f) => sum(cur, f));
  const total = s[0]! + s[1]! + s[2]!;
  const staff = sum(d.facilities, (f) => f.employees ?? 0), area = sum(d.facilities, (f) => f.area ?? 0);
  const cat = new Map(d.categories.map((x) => [x.code, x]));
  return {
    cur, months, nMax, ytd, periodLabel, rep, full, complete, waiting, filled, cmpOn, nFull: fullM.length, yoy: yoyOf(tot), yoyS: S.map(yoyOf),
    s, total, staff, area, cat, k: months.length ? 12 / months.length : 1,
    prevBy: (m: number) => { const rs = d.prevRows.filter((r) => r.m === m); return cmpOn && rs.length ? sum(rs, tot) : null; },
  };
}
type Ctx = ReturnType<typeof ctx>;

/** 12 bars for the year: empty outside the period, pale where not every facility has data yet. */
function monthRows(c: Ctx, parts: (rs: Row[]) => Part[], line?: (m: number) => number | null): BarRow[] {
  return MN.map((lbl, i) => {
    const m = i + 1, on = c.months.includes(m);
    return { lbl, parts: on ? parts(c.cur.filter((r) => r.m === m)) : [], line: line ? line(m) : undefined, dim: on && !c.full(m) };
  });
}
const yoyTxt = (c: Ctx, y: number) => (c.yoy === null ? (c.cmpOn ? '' : 'no comparison') : <><span style={{ color: c.yoy > 0 ? 'var(--bad)' : 'var(--ok)' }}>{c.yoy > 0 ? '▲ +' : '▼ −'}{fmt(Math.abs(c.yoy), 1)}%</span> vs {y} ({c.nFull ? `${c.nFull} full month${c.nFull === 1 ? '' : 's'}` : 'same months'})</>);

/** GHG Protocol code of a row's parts: Scope 1/2 by category, Scope 3 by its category, 3.3 split off. */
function ghgParts(c: Ctx, r: Row): [string, number, 1 | 2 | 3][] {
  const k = c.cat.get(r.cat), out: [string, number, 1 | 2 | 3][] = [];
  if (r.s1) out.push([k?.scope === 1 ? k.ghg : '1.0', r.s1, 1]);
  if (r.s2) out.push([k?.scope === 2 ? k.ghg : '2.1', r.s2, 2]);
  if (r.s3) out.push([k?.scope === 3 ? k.ghg : '3.0', r.s3, 3]);
  if (r.s33) out.push(['3.3', r.s33, 3]);
  return out;
}
function ghgName(d: Data, c: Ctx, code: string) {
  if (code.startsWith('3.')) return d.s3Names[Number(code.slice(2))] ?? code;
  if (code === '2.1') return 'Purchased electricity, heat & cooling';
  return [...c.cat.values()].find((x) => x.ghg === code)?.name ?? code;
}
const sourceOf = (r: Row) => ((r.cat === 'purchased_goods' || r.cat === 'capital_goods') && r.grp ? r.grp.split(' › ')[0]! : r.item);
const SHADE: Record<1 | 2 | 3, string[]> = { 1: ['#0E4F3F', '#1F6F5C', '#3E8B76'], 2: ['#1E8C74', '#2BA38A', '#5DBBA4'], 3: ['#C99A2E', '#E9B44C', '#D27A3A', '#B8862C', '#E6C377'] };
/** Every source with its scope (well-to-tank and grid losses are their own Scope 3 source). */
function sources(c: Ctx) {
  const m = new Map<string, { n: string; v: number; s: 1 | 2 | 3 }>();
  const add = (n: string, s: 1 | 2 | 3, v: number) => { if (!v) return; const k = `${s}|${n}`; const o = m.get(k) ?? { n, v: 0, s }; o.v += v; m.set(k, o); };
  for (const r of c.cur) { const n = sourceOf(r); add(n, 1, r.s1); add(n, 2, r.s2); add(n, 3, r.s3); add('Fuel- and energy-related (well-to-tank, grid losses)', 3, r.s33); }
  const used = { 1: 0, 2: 0, 3: 0 };
  return [...m.values()].filter((x) => x.v > 0).sort((a, b) => b.v - a.v).map((x) => ({ n: x.n, v: x.v, s: x.s, c: SHADE[x.s][used[x.s]++ % SHADE[x.s].length]! }));
}
function upDown(c: Ctx) {
  const g = { up: new Map<string, number>(), own: new Map<string, number>(), down: new Map<string, number>() };
  for (const r of c.cur) for (const [code, v, s] of ghgParts(c, r)) { const k = s < 3 ? 'own' : Number(code.split('.')[1]) <= 8 ? 'up' : 'down'; g[k].set(code, (g[k].get(code) ?? 0) + v); }
  return g;
}
const mapSum = (m: Map<string, number>) => [...m.values()].reduce((a, v) => a + v, 0);
const T = (v: number) => `${fmtT(v)} t`;

// ------------------------------------------------------------ overview --
function Overview({ d, c, go }: { d: Data; c: Ctx; go: (t: Tab) => void }) {
  const w = (v: number) => pc(v, c.total);
  const rows = monthRows(c, (rs) => [0, 1, 2].map((i) => ({ v: sum(rs, S[i]!), c: SC[i]!, n: `Scope ${i + 1}` })), c.cmpOn ? c.prevBy : undefined);
  const parts: Part[] = [0, 1, 2].map((i) => ({ v: c.s[i]!, c: SC[i]!, n: `Scope ${i + 1}` }));
  const nCat = (s: number) => new Set(c.cur.flatMap((r) => ghgParts(c, r).filter((p) => p[2] === s).map((p) => p[0]))).size;
  const big = [0, 1, 2].sort((x, y) => c.s[y]! - c.s[x]!)[0]!;
  const lever = ['fuel switching, fleet electrification and refrigerant leak control', 'renewable electricity (on-site solar, green tariff, I-RECs) and cooling efficiency', 'supplier engagement and waste diversion'][big];
  const tm = sources(c);
  const tmTop = [...tm.slice(0, 7), ...(tm.length > 7 ? [{ n: `Other ${tm.length - 7} sources`, v: sum(tm.slice(7), (x) => x.v), c: '#9AA7A2', s: 3 as const }] : [])];
  const ud = upDown(c), U = mapSum(ud.up), O = mapSum(ud.own), Dn = mapSum(ud.down), all = U + O + Dn || 1;
  const yy = String(d.cmpYear).slice(2);
  return <>
    <DStat cells={[
      ['Total emissions', <>{fmt0(c.total)} <small>tCO₂e</small></>, yoyTxt(c, d.cmpYear)],
      [<><Dot c="var(--s1)" />Scope 1</>, T(c.s[0]!), `${w(c.s[0]!)} · direct`],
      [<><Dot c="var(--s2)" />Scope 2</>, T(c.s[1]!), `${w(c.s[1]!)} · purchased energy`],
      [<><Dot c="var(--s3)" />Scope 3</>, T(c.s[2]!), `${w(c.s[2]!)} · value chain`],
      ['Per employee', c.staff ? `${fmt(c.total / c.staff, 2)} t` : '—', c.area ? `${fmt0((c.total * 1000) / c.area)} kg / m²` : c.staff ? '' : 'add employees to the facilities'],
    ]} />
    <div className="dgrid">
      <DCard title="Scope-wise emissions by month" span={2}>
        <Bars rows={rows} unit="t" h={175} label="Monthly emissions by scope" />
        <div className="lgd"><span><i style={{ background: 'var(--s1)' }} />Scope 1</span><span><i style={{ background: 'var(--s2)' }} />Scope 2</span><span><i style={{ background: 'var(--s3)' }} />Scope 3</span>
          {c.cmpOn && <span><i className="ln" style={{ borderColor: 'var(--muted)' }} />{d.cmpYear}</span>}<span className="muted">pale = month still filling</span></div>
      </DCard>
      <DCard title="Scope split">
        <div className="dsplit" style={{ flexWrap: 'nowrap' }}>
          <Donut parts={parts} center={fmt0(c.total)} sub="tCO₂e" size={116} />
          <table className="t dt sst"><thead><tr><th /><th className="num">t</th><th className="num">%</th><th className="num">vs {yy}</th></tr></thead>
            <tbody>{[0, 1, 2].map((i) => { const ch = c.yoyS[i]!; return (
              <tr key={i}><td className="nowrap"><Dot c={SC[i]!} /> S{i + 1} <span className="muted" style={{ fontSize: 10.5 }}>{nCat(i + 1)} cat.</span></td>
                <td className="num"><b>{fmtT(c.s[i]!)}</b></td><td className="num">{w(c.s[i]!)}</td>
                <td className="num" style={{ color: ch === null ? 'inherit' : ch > 0 ? 'var(--bad)' : 'var(--ok)' }}>{ch === null ? '—' : signPct(ch, 0)}</td></tr>); })}</tbody></table>
        </div>
        <div className="sbar">{parts.map((p) => <span key={p.n} style={{ flex: p.v || 0.0001, background: p.c }} title={p.n} />)}</div>
        <div className="sins"><b>Scope {big + 1} is {w(c.s[big]!)} of the total.</b> Main levers: {lever}.</div>
        <div className="muted" style={{ fontSize: 11 }}>{c.cmpOn ? (c.nFull ? `vs ${yy} = the ${c.nFull} complete month${c.nFull === 1 ? '' : 's'} against the same months of ${d.cmpYear}. ` : `vs ${yy} = the same months of ${d.cmpYear}. `) : ''}Scope 2 {d.scope2}-based.</div>
      </DCard>
      <DCard title="Where emissions come from" span={2} sub={`box size = tCO₂e · colour = scope · all ${tm.length} sources listed`}>
        <div className="tmwrap"><div><Treemap items={tmTop} W={320} H={215} /></div>
          <div className="tml">{tm.map((t) => (
            <div key={`${t.s}${t.n}`}><i style={{ background: t.c }} /><span className="nm" title={`${t.n} · Scope ${t.s}`}>{t.n}</span><b>{t.v < 100 ? fmt(t.v, 1) : fmt0(t.v)} t</b>
              <span className="muted">{c.total ? ((t.v / c.total) * 100 < 1 ? '<1' : Math.round((t.v / c.total) * 100)) : 0}%</span></div>))}</div></div>
      </DCard>
      <DCard title="Top 5 contributors">
        {tm.slice(0, 5).map((t, i) => <div key={`${t.s}${t.n}`} className="t5"><span className="rk">{i + 1}</span><span style={{ flex: 1, minWidth: 0 }}><b>{t.n}</b><small>{fmtT(t.v)} t · {w(t.v)}</small></span><i style={{ background: t.c }} /></div>)}
      </DCard>
      <DCard title="Upstream · own operations · downstream" span={2}>
        <div className="vchain">
          <div style={{ flex: Math.max(U, all * 0.06) }} className="vc up"><b>{fmt0(U)} t</b><small>Upstream · {Math.round((U / all) * 100)}%</small></div>
          <div style={{ flex: Math.max(O, all * 0.06) }} className="vc own"><b>{fmt0(O)} t</b><small>Own operations (S1+S2) · {Math.round((O / all) * 100)}%</small></div>
          <div style={{ flex: Math.max(Dn, all * 0.06) }} className="vc down"><b>{fmt0(Dn)} t</b><small>Downstream</small></div>
        </div>
        <div className="vcl">
          <div><span className="lbl">Upstream</span>{ud.up.size ? [...ud.up.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k}><span>{k} {ghgName(d, c, k)}</span><b>{fmtT(v)}</b></div>) : <div className="muted">none measured</div>}</div>
          <div><span className="lbl">Downstream</span>{ud.down.size ? [...ud.down.entries()].map(([k, v]) => <div key={k}><span>{k} {ghgName(d, c, k)}</span><b>{fmtT(v)}</b></div>) : <div className="muted">No downstream sources measured. Categories 3.9–3.15 are excluded with a reason under Methodology & boundaries.</div>}</div>
        </div>
      </DCard>
      <DCard title="Net zero · emissions vs offsets">
        <div className="dsplit"><Donut parts={[{ v: c.total, c: 'var(--s2)', n: 'Net emissions' }]} center="0%" sub="offset" size={118} />
          <Legend parts={[{ v: c.total, c: 'var(--s2)', n: 'Net emissions' }]} unit="t" /></div>
        <div className="muted" style={{ fontSize: 12 }}>No retired carbon credits or completed reduction actions recorded for {d.year}.</div>
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go('netzero')}>Net zero detail →</button>
      </DCard>
    </div>
  </>;
}

// ---------------------------------------------------- scopes & categories --
function Scopes({ d, c }: { d: Data; c: Ctx }) {
  const sc: Map<string, number>[] = [new Map(), new Map(), new Map()];
  const codes = new Map<string, number[]>();
  for (const r of c.cur) for (const [code, v, s] of ghgParts(c, r)) {
    sc[s - 1]!.set(code, (sc[s - 1]!.get(code) ?? 0) + v);
    if (r.m > 0) { const a = codes.get(code) ?? Array(12).fill(0); a[r.m - 1] += v; codes.set(code, a); }
  }
  const whole = new Map<string, number>(); for (const r of c.cur) if (r.m === 0) for (const [code, v] of ghgParts(c, r)) whole.set(code, (whole.get(code) ?? 0) + v);
  const allCodes = [...new Set([...codes.keys(), ...whole.keys()])].map((k) => ({ k, ms: codes.get(k) ?? Array(12).fill(0), t: sum(codes.get(k) ?? [], (x) => x) + (whole.get(k) ?? 0) })).sort((a, b) => b.t - a.t);
  return <>
    <DStat cells={[...[0, 1, 2].map((i) => [<><Dot c={SC[i]!} />Scope {i + 1}</>, T(c.s[i]!), `${pc(c.s[i]!, c.total)} of total · ${sc[i]!.size} categories`] as [ReactNode, ReactNode, ReactNode]),
      ['Categories reported', `${allCodes.length} of 22`, 'GHG Protocol codes with data']]} />
    <div className="dgrid">
      {[0, 1, 2].map((i) => { const parts = [...sc[i]!.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], j) => ({ n: `${k} ${ghgName(d, c, k)}`, v, c: PAL[(j + i + 1) % PAL.length]! })); return (
        <DCard key={i} title={<><Dot c={SC[i]!} />Scope {i + 1}</>}><div className="dsplit"><Donut parts={parts} center={fmt0(c.s[i]!)} sub="t" size={130} /><Legend parts={parts} unit="t" /></div></DCard>); })}
      <DCard title="By GHG Protocol category and month (tCO₂e)" span={3}>
        <div className="scrollx"><table className="t dt"><thead><tr><th>Category</th>{MN.map((m) => <th key={m} className="num">{m}</th>)}{whole.size > 0 && <th className="num">Whole year</th>}<th className="num">Total</th><th className="num">Share</th></tr></thead>
          <tbody>{allCodes.map(({ k, ms, t }) => { const mx = Math.max(...ms) || 1, s = k[0]; return (
            <tr key={k}><td className="nowrap"><span className={`codechip s${s}`}>{k}</span> {ghgName(d, c, k)}</td>
              {ms.map((v: number, i: number) => <td key={i} className="num hm" style={{ background: v ? `color-mix(in srgb, var(--s${s}) ${Math.round(10 + (v / mx) * (s === '1' ? 28 : 45))}%, transparent)` : 'transparent' }}>{v ? fmtT(v) : ''}</td>)}
              {whole.size > 0 && <td className="num">{whole.get(k) ? fmtT(whole.get(k)!) : ''}</td>}
              <td className="num"><b>{fmtT(t)}</b></td><td className="num">{c.total ? fmt((t / c.total) * 100, 1) : 0}%</td></tr>); })}</tbody></table></div>
      </DCard>
    </div>
  </>;
}

// ---------------------------------------------------------------- facilities --
function Facilities({ d, c, pick }: { d: Data; c: Ctx; pick: (id: string) => void }) {
  const rows = d.facilities.map((f) => { const rs = c.cur.filter((r) => r.f === f.id), t = sum(rs, tot); return { f, t, s: S.map((g) => sum(rs, g)), int: f.employees ? (t * c.k) / f.employees : null, m2: f.area ? (t * c.k * 1000) / f.area : null }; }).sort((a, b) => b.t - a.t);
  const hi = rows.filter((x) => x.int !== null).sort((a, b) => b.int! - a.int!)[0];
  const cell = (f: string, m: number) => sum(c.cur.filter((r) => r.f === f && r.m === m), tot);
  const mx = Math.max(1e-9, ...rows.flatMap((x) => c.months.map((m) => cell(x.f.id, m))));
  const share = rows.filter((x) => x.t > 0).map((x, i) => ({ n: x.f.name, v: x.t, c: PAL[i % PAL.length]! }));
  return <>
    <DStat cells={[['Facilities', d.facilities.length, `${d.facilities.filter((f) => f.weight > 0).length} in the totals · ${c.rep.length} report monthly`], ['Largest', rows[0]?.f.name ?? '—', rows[0] ? `${T(rows[0].t)} · ${pc(rows[0].t, c.total)}` : ''],
      ['Average per facility', T(c.total / (d.facilities.length || 1)), `${d.year} · ${c.periodLabel}`], ['Highest intensity', hi?.f.name ?? '—', hi ? `${fmt(hi.int!, 1)} t / employee / yr` : 'add employees to the facilities']]} />
    <div className="dgrid">
      <DCard title="Emissions by facility and scope" span={2} sub="click a facility to view only it"><HBars unit="t" items={rows.map((x) => ({ n: x.f.name, v: x.t, parts: x.s.map((v, i) => ({ v, c: SC[i]! })), onClick: () => pick(x.f.id) }))} /></DCard>
      <DCard title="Share of total"><div className="dsplit"><Donut parts={share} center={String(d.facilities.length)} sub="facilities" size={130} /><Legend parts={share} unit="t" /></div></DCard>
      <DCard title="Intensity (annualised)"><HBars unit="t / employee" c="var(--s3)" items={rows.filter((x) => x.int !== null).map((x) => ({ n: x.f.name, v: x.int!, d: 1 })).sort((a, b) => b.v - a.v)} /></DCard>
      <DCard title="Per floor area (annualised)" span={2}><HBars unit="kg / m²" c="var(--s1)" items={rows.filter((x) => x.m2 !== null).map((x) => ({ n: x.f.name, v: x.m2! })).sort((a, b) => b.v - a.v)} /></DCard>
      <DCard title="Heatmap · facility × month (tCO₂e)" span={3}>
        <div className="scrollx"><table className="t dt"><thead><tr><th>Facility</th>{MN.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
          <tbody>{rows.map((x) => <tr key={x.f.id}><td className="nowrap"><b>{x.f.name}</b></td>{MN.map((_, i) => { const m = i + 1; if (!c.months.includes(m)) return <td key={i} />;
            const v = cell(x.f.id, m), wt = c.waiting.has(`${x.f.id}|${m}`), has = c.filled.has(`${x.f.id}|${m}`);
            return <td key={i} className="num hm" title={!has ? 'No data yet' : wt ? 'Entries waiting for approval' : 'Approved'} style={{ background: v ? `color-mix(in srgb, var(--primary) ${Math.round(8 + (v / mx) * 62)}%, transparent)` : 'transparent', ...(wt || !has ? { outline: '1.5px dashed var(--warn)', outlineOffset: -3 } : {}) }}>{v ? fmtT(v) : '—'}</td>; })}</tr>)}</tbody></table></div>
        <div className="muted" style={{ fontSize: 11.5 }}>Dashed outline = month not fully approved, or no data yet.</div>
      </DCard>
    </div>
  </>;
}

// ---------------------------------------------------------------- energy --
function Energy({ d, c }: { d: Data; c: Ctx }) {
  const el = c.cur.filter((r) => r.kind && r.kwh), mwh = (r: Row) => (r.kwh ?? 0) / 1000;
  const total = sum(el, mwh), elec = sum(el.filter((r) => r.kind === 'electricity'), mwh), ren = sum(el, (r) => r.rec) / 1000;
  const by = new Map<string, number>(); for (const r of el) by.set(r.item, (by.get(r.item) ?? 0) + mwh(r));
  const items = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const col = new Map(items.map(([n], i) => [n, PAL[i % PAL.length]!]));
  const mix = items.map(([n, v]) => ({ n, v, c: col.get(n)! }));
  const rows = monthRows(c, (rs) => items.map(([n]) => ({ v: sum(rs.filter((r) => r.item === n && r.kind && r.kwh), mwh), c: col.get(n)!, n })));
  const fac = d.facilities.map((f) => ({ n: f.name, v: sum(el.filter((r) => r.f === f.id), mwh) })).filter((x) => x.v).sort((a, b) => b.v - a.v);
  const noKwh = c.cur.filter((r) => r.kind === 'fuel' && r.kwh === null).length;
  return <>
    <DStat cells={[['Total energy', <>{fmt0(total)} <small>MWh</small></>, 'fuels at net calorific value'], ['Electricity', `${fmt0(elec)} MWh`, `${pc(elec, total)} of energy`],
      ['Renewable share', `${elec ? fmt((ren / elec) * 100, 1) : '0'}%`, `${fmt0(ren)} MWh with certificates`, ren ? 'var(--ok)' : undefined], ['Energy emissions', T(sum(c.cur.filter((r) => r.kind), tot)), 'from these sources'],
      ['Per m²', c.area ? `${fmt0(((total * 1000) / c.area) * c.k)} kWh` : '—', 'annualised']]} />
    <div className="dgrid">
      <DCard title="Energy by month and source (MWh)" span={2}><Bars rows={rows} unit="MWh" h={175} label="Energy by month" />
        <div className="lgd">{mix.map((p) => <span key={p.n}><i style={{ background: p.c }} />{p.n}</span>)}</div>
        {noKwh > 0 && <div className="muted" style={{ fontSize: 11.5 }}>{noKwh} vehicle entries are recorded by distance: their emissions count, their energy is not converted.</div>}</DCard>
      <DCard title="Energy mix"><div className="dsplit"><Donut parts={mix} center={fmt0(total)} sub="MWh" size={140} /><Legend parts={mix} unit="MWh" /></div></DCard>
      <DCard title="By facility (MWh)" span={2}><HBars items={fac} unit="MWh" c="var(--s2)" /></DCard>
      <DCard title="Renewable electricity"><div className="dsplit"><Donut parts={[{ n: 'Renewable', v: ren, c: '#E9B44C' }, { n: 'Grid & other', v: Math.max(0, elec - ren), c: 'var(--line2)' }]} center={pc(ren, elec)} sub="renewable" size={130} />
        <div className="muted" style={{ fontSize: 12, flex: 1, minWidth: 150 }}>Add I-RECs or green tariffs under Energy certificates & suppliers to lift the market-based renewable share.</div></div></DCard>
    </div>
  </>;
}

// ----------------------------------------------------------------- water --
function Water({ c }: { c: Ctx }) {
  return <>
    <DStat cells={[['Water used', <>— <small>m³</small></>, c.periodLabel], ['Per employee', '—', 'for the period'], ['Water emissions', '—', 'supply and treatment'], ['Monthly average', '—', '']]} />
    <div className="dgrid"><DCard title="Water" span={3}><div className="muted" style={{ fontSize: 13, lineHeight: 1.55 }}>Water withdrawal, consumption and discharge are not captured in Ekotrace yet. When the water module is added, this tab shows water by month, by type and by facility, per employee, and the emissions from supply and treatment.</div></DCard></div>
  </>;
}

// ----------------------------------------------------------------- waste --
const route = (r: Row) => { const t = `${r.item} ${r.sub}`.toLowerCase();
  return /recycl|reuse|re-use/.test(t) ? 'Recycling' : /compost|anaerobic|digest/.test(t) ? 'Composting / AD' : /clinical|hazard|medical/.test(t) ? 'Clinical / hazardous'
    : /incinerat|energy recovery|waste-to-energy|combust/.test(t) ? 'Waste-to-energy' : /wastewater|sewage/.test(t) ? 'Wastewater' : /landfill/.test(t) ? 'Landfill' : 'Other'; };
const ROUTE_C: Record<string, string> = { Landfill: '#C2523C', Recycling: '#2BA38A', 'Composting / AD': '#86CDB4', 'Waste-to-energy': '#E9B44C', 'Clinical / hazardous': '#6B4FA8', Wastewater: '#2E6FB0', Other: '#9AA7A2' };
const DIVERT = new Set(['Recycling', 'Composting / AD', 'Waste-to-energy']);
const tonnes = (r: Row) => (r.unit === 't' ? r.qty : r.unit === 'kg' ? r.qty / 1000 : 0);
function Waste({ d, c }: { d: Data; c: Ctx }) {
  const own = c.cur.filter((r) => r.cat === 'waste_generated'), site = c.cur.filter((r) => r.cat === 'waste_treatment');
  const total = sum(own, tonnes), div = sum(own.filter((r) => DIVERT.has(route(r))), tonnes), haz = sum(own.filter((r) => route(r) === 'Clinical / hazardous'), tonnes);
  const by = new Map<string, number>(); for (const r of own) by.set(route(r), (by.get(route(r)) ?? 0) + tonnes(r));
  const parts = [...by.entries()].filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, c: ROUTE_C[n]! }));
  const rows = monthRows(c, (rs) => parts.map((p) => ({ v: sum(rs.filter((r) => r.cat === 'waste_generated' && route(r) === p.n), tonnes), c: p.c, n: p.n })));
  const rate: BarRow[] = MN.map((lbl, i) => { const ls = own.filter((r) => r.m === i + 1), t = sum(ls, tonnes), dv = sum(ls.filter((r) => DIVERT.has(route(r))), tonnes); return { lbl, parts: t ? [{ v: (dv / t) * 100, c: '#2BA38A', n: 'Diverted %' }] : [] }; });
  const siteBy = new Map<string, number>(); for (const r of site) siteBy.set(r.item, (siteBy.get(r.item) ?? 0) + tot(r));
  return <>
    <DStat cells={[['Waste sent out', <>{fmt(total, 1)} <small>t</small></>, 'all streams'], ['Diverted from landfill', pc(div, total), 'recycled, composted or waste-to-energy', 'var(--ok)'],
      ['Hazardous / clinical', `${fmt(haz, 1)} t`, 'incinerated'], ['Waste emissions', `${fmt(sum(own, tot), 1)} t`, 'Scope 3 category 5'], ['Treated at own sites', T(sum(site, tot)), 'Scope 1']]} />
    <div className="dgrid">
      <DCard title="Waste by month and route (t)" span={2}><Bars rows={rows} unit="t" h={175} label="Waste by month" /><div className="lgd">{parts.map((p) => <span key={p.n}><i style={{ background: p.c }} />{p.n}</span>)}</div></DCard>
      <DCard title="By route"><div className="dsplit"><Donut parts={parts} center={pc(div, total)} sub="diverted" size={130} /><Legend parts={parts} unit="t" /></div></DCard>
      <DCard title="Diversion rate by month (%)" span={2}><Bars rows={rate} unit="%" h={150} label="Diversion rate" /></DCard>
      <DCard title="By facility (t)"><HBars unit="t" c="var(--s3)" items={d.facilities.map((f) => ({ n: f.name, v: sum(own.filter((r) => r.f === f.id), tonnes), d: 1 })).filter((x) => x.v).sort((a, b) => b.v - a.v)} /></DCard>
      {site.length > 0 && <DCard title="Treatment at own sites (tCO₂e)" span={3}><HBars unit="t" c="var(--s1)" items={[...siteBy.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, d: 1 }))} /></DCard>}
    </div>
  </>;
}

// ------------------------------------------------------ mobility & travel --
function Travel({ c }: { c: Ctx }) {
  const isCommute = (r: Row) => r.cat === 'employee_commuting' || c.cat.get(r.cat)?.ghg === '3.7';
  const G: [string, string, (r: Row) => boolean][] = [['Company fleet', 'var(--s1)', (r) => r.cat === 'mobile_combustion'], ['Business travel', '#2E6FB0', (r) => r.cat === 'business_travel'], ['Employee commuting', '#E9B44C', isCommute]];
  const tr = c.cur.filter((r) => G.some((g) => g[2](r)));
  const parts = G.map(([n, col, f]) => ({ n, v: sum(tr.filter(f), tot), c: col }));
  const rows = monthRows(c, (rs) => G.map(([n, col, f]) => ({ v: sum(rs.filter(f), tot), c: col, n })));
  const by = new Map<string, { q: number; u: string; t: number }>();
  for (const r of tr) { const k = `${r.item}|${r.unit}`; const o = by.get(k) ?? { q: 0, u: r.unit, t: 0 }; o.q += r.qty; o.t += tot(r); by.set(k, o); }
  const fleet = tr.filter(G[0]![2]), tt = sum(tr, tot);
  return <>
    <DStat cells={[['Mobility emissions', <>{fmt0(tt)} <small>t</small></>, 'fleet, travel and commuting'], ['Fleet fuel', `${fmt0(sum(fleet.filter((r) => r.unit === 'L'), (r) => r.qty))} L`, 'vehicles entered by litres'],
      ['Distance driven', `${fmt0(sum(fleet.filter((r) => r.unit === 'km'), (r) => r.qty))} km`, 'vehicles entered by distance'], ['Business travel', T(parts[1]!.v), 'Scope 3.6'], ['Commuting', T(parts[2]!.v), 'Scope 3.7']]} />
    <div className="dgrid">
      <DCard title="By month (tCO₂e)" span={2}><Bars rows={rows} unit="t" h={175} label="Mobility by month" /><div className="lgd">{parts.map((p) => <span key={p.n}><i style={{ background: p.c }} />{p.n}</span>)}</div></DCard>
      <DCard title="Split"><div className="dsplit"><Donut parts={parts} center={fmt0(tt)} sub="t" size={130} /><Legend parts={parts} unit="t" /></div></DCard>
      <DCard title="By activity" span={3}>
        <div className="scrollx"><table className="t dt"><thead><tr><th>Activity</th><th className="num">Quantity</th><th className="num">tCO₂e</th><th className="num">kg / unit</th></tr></thead>
          <tbody>{[...by.entries()].sort((a, b) => b[1].t - a[1].t).map(([k, o]) => <tr key={k}><td>{k.split('|')[0]}</td><td className="num">{o.q ? `${fmt0(o.q)} ${o.u}` : 'spend-based'}</td><td className="num"><b>{fmt(o.t, 1)}</b></td><td className="num">{o.q ? fmt((o.t * 1000) / o.q, 3) : '—'}</td></tr>)}
            {!by.size && <tr><td colSpan={4} className="muted">No data.</td></tr>}</tbody></table></div>
      </DCard>
    </div>
  </>;
}

// ------------------------------------------------------------- value chain --
function Chain({ d, c }: { d: Data; c: Ctx }) {
  const ud = upDown(c);
  const up = [...ud.up.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ n: `${k} ${ghgName(d, c, k)}`, v, c: PAL[(i + 3) % PAL.length]! }));
  const pr = c.cur.filter((r) => r.cat === 'purchased_goods' || r.cat === 'capital_goods'), pt = sum(pr, tot);
  const byCat = new Map<string, number>(); for (const r of pr) { const k = sourceOf(r); byCat.set(k, (byCat.get(k) ?? 0) + tot(r)); }
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([n, v], i) => ({ n, v, c: PAL[i % PAL.length]! }));
  const P = d.purchases, mt = sum(P.byMethod, (m) => m.t), msup = P.byMethod.find((m) => m.method === 'supplier')?.t ?? 0;
  const q = mt ? [{ n: 'Supplier-specific', v: msup, c: 'var(--ok)' }, { n: 'Spend-based average', v: mt - msup, c: '#E9B44C' }] : [];
  return <>
    <DStat cells={[['Scope 3', <>{fmt0(c.s[2]!)} <small>t</small></>, `${pc(c.s[2]!, c.total)} of total`], ['Purchased goods & capital goods', T(pt), 'categories 3.1 and 3.2'],
      ['Supplier-specific data', mt ? pc(msup, mt) : '—', `of purchase emissions · ${d.year}`], ['Suppliers', P.suppliers, `${P.withTarget} with science-based targets`]]} />
    <div className="dgrid">
      <DCard title="Scope 3 by category"><div className="dsplit"><Donut parts={up} center={fmt0(mapSum(ud.up))} sub="t upstream" size={140} /><Legend parts={up} unit="t" /></div></DCard>
      <DCard title="Purchases by category" span={2}>{cats.length ? <Treemap items={cats} W={640} H={180} /> : <div className="muted" style={{ fontSize: 13 }}>No approved purchase lines in this period yet. Publish a purchases file under Purchases; the lines are mapped to spend categories and appear here.</div>}</DCard>
      <DCard title="Top suppliers by emissions" span={2} sub={`${d.year}, all months`} right={<Link className="btn sm ghost" to="/suppliers">Suppliers →</Link>}>
        <HBars unit="t" c="var(--s3)" items={P.bySupplier.slice(0, 8).map((s) => ({ n: s.name, v: s.t, d: 1 }))} /></DCard>
      <DCard title="Data quality of purchase emissions"><div className="dsplit"><Donut parts={q} center={mt ? pc(msup, mt) : '—'} sub="specific" size={130} /><Legend parts={q} unit="t" /></div></DCard>
    </div>
  </>;
}

// ---------------------------------------------------------------- net zero --
function NetZero({ d, c }: { d: Data; c: Ctx }) {
  const allNow = sum(d.rows, tot), ann = c.nMax < 12 ? (allNow * 12) / c.nMax : allNow, prev = sum(d.prevRows, tot);
  const rows: BarRow[] = [...(d.prevRows.length ? [{ lbl: String(d.cmpYear), parts: [{ v: prev, c: 'var(--s2)', n: 'Net emissions' }] }] : []),
    { lbl: c.nMax < 12 ? `${d.year} (annualised)` : String(d.year), parts: [{ v: ann, c: 'var(--s2)', n: 'Net emissions' }] }];
  return <>
    <DStat cells={[[`Gross emissions ${d.year}`, <>{fmt0(c.total)} <small>t</small></>, c.periodLabel], [`Credits retired ${d.year}`, '0 t', 'removals and avoidance', '#6B4FA8'],
      ['Net after credits', T(c.total), 'shown alongside gross, never instead'], ['Reductions delivered', '—', 'completed actions'], ['Credits in pipeline', '—', 'contracted, not retired']]} />
    <div className="dgrid">
      <DCard title="Emissions vs offsets by year (tCO₂e)" span={2}><Bars rows={rows} unit="t" h={175} label="Emissions by year" />
        <div className="lgd"><span><i style={{ background: 'var(--s2)' }} />Net emissions</span><span><i style={{ background: '#6B4FA8' }} />Offset by retired credits</span></div></DCard>
      <DCard title="Path to net zero"><div className="dsplit"><Donut parts={[{ v: c.total, c: 'var(--s2)', n: 'Emissions' }]} center="0%" sub="addressed" size={118} /><Legend parts={[{ v: c.total, c: 'var(--s2)', n: 'Emissions' }]} unit="t" /></div></DCard>
      <DCard title="Credit portfolio" span={2}><div className="muted" style={{ fontSize: 13 }}>No carbon credits recorded. Credits and reduction actions come with the targets and net zero module; until then gross and net are the same.</div></DCard>
      <DCard title="Good practice"><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}><li>Report gross emissions first; credits separately.</li><li>SBTi targets count reductions only — credits do not.</li><li>Use permanent removals for the residual at net zero.</li></ul></DCard>
    </div>
  </>;
}
