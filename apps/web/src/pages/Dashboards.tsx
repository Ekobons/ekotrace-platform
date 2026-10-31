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
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type CreditData, type DashGroup, type OrgNode, type TargetsData } from '../lib/api';
import { Icon } from '../components/Icon';
import { Bars, DCard, Donut, Dot, DStat, HBars, Legend, MN, PAL, SC, Treemap, fmt, fmt0, fmtT, type BarRow, type Part } from '../components/DashCharts';
import { CONS, S, ViewBar, pc, range, signPct, sum, tot, useView, type Ctx, type Data, type Row } from '../components/ViewBar';

/** Opening the entries behind a figure: Entries & results filtered to the same year, period, facilities and status. */
type Drill = { cats?: string[]; fid?: string; m?: number; scope?: number; items?: string[]; wtt?: boolean; label: string };
const DrillCtx = createContext<(o: Drill) => void>(() => {});
const useDrill = () => useContext(DrillCtx);
const pad2 = (m: number) => String(m).padStart(2, '0');

type Tab = 'overview' | 'scopes' | 'facilities' | 'energy' | 'water' | 'waste' | 'travel' | 'chain' | 'netzero';
const DTABS: [Tab, string][] = [['overview', 'Overview'], ['scopes', 'Scopes & categories'], ['facilities', 'Facilities'], ['energy', 'Energy'], ['water', 'Water'], ['waste', 'Waste'], ['travel', 'Mobility & travel'], ['chain', 'Value chain'], ['netzero', 'Net zero']];
export function Dashboards() {
  const v = useView();
  const { role } = useApp();
  const { d, c, err, set, pend, name } = v;
  const tab = (v.sp.get('tab') as Tab) || 'overview';
  const nav = useNavigate();
  const drill = (o: Drill) => {
    if (!d || !c) return;
    const q = new URLSearchParams({ y: String(d.year) });
    // the dashboard's month rule: an entry under 40 days counts in the month it starts; a longer one only in the full-year view
    const ms = o.m ? [o.m] : c.months;
    q.set('dm', ms.join(','));
    q.set('whole', !o.m && c.ytd && c.nMax === 12 ? '1' : '0');
    // facilities by id: the view's, without those the consolidation leaves out (weight 0)
    const fids = o.fid ? [o.fid] : d.facilities.filter((f) => f.weight > 0).map((f) => f.id);
    if (o.fid || v.kind !== 'COMPANY' || fids.length < d.facilities.length) q.set('fids', fids.join(','));
    if (d.consolidation === 'equity') q.set('cons', 'equity');
    if (o.cats?.length) q.set('cats', o.cats.join('|'));
    if (o.scope) q.set('scope', String(o.scope));
    if (o.items?.length) q.set('items', o.items.join('|'));
    if (o.wtt) q.set('wtt', '1');
    q.set('status', pend ? 'counted' : 'approved');
    q.set('from', `${o.label} · ${name}`);
    nav(`/entries?${q}`);
  };
  return (
    <DrillCtx.Provider value={drill}>
    <div className="page dashpage" style={{ gap: 12 }}>
      <ViewBar v={v} />
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
          : tab === 'water' ? <Water d={d} c={c} />
          : tab === 'waste' ? <Waste d={d} c={c} />
          : tab === 'travel' ? <Travel c={c} />
          : tab === 'chain' ? <Chain d={d} c={c} />
          : tab === 'netzero' ? <NetZero d={d} c={c} />
          : <Overview d={d} c={c} go={(t) => set({ tab: t })} />}
        <div className="muted small">Click a month, a scope, a source or a category to open the entries behind it.</div>
      </>}
    </div>
    </DrillCtx.Provider>
  );
}

// ------------------------------------------------------------- context --


/** 12 bars for the year: empty outside the period, pale where not every facility has data yet. */
function monthRows(c: Ctx, parts: (rs: Row[]) => Part[], line?: (m: number) => number | null, go?: (m: number) => void): BarRow[] {
  return MN.map((lbl, i) => {
    const m = i + 1, on = c.months.includes(m);
    return { lbl, parts: on ? parts(c.cur.filter((r) => r.m === m)) : [], line: line ? line(m) : undefined, dim: on && !c.full(m), go: on && go ? () => go(m) : undefined };
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
const WTT = 'Fuel- and energy-related (well-to-tank, grid losses)';
function sources(c: Ctx) {
  const m = new Map<string, { n: string; v: number; s: 1 | 2 | 3; cats: Set<string>; items: Set<string>; group: boolean }>();
  const add = (n: string, s: 1 | 2 | 3, v: number, r: Row) => { if (!v) return; const k = `${s}|${n}`; const o = m.get(k) ?? { n, v: 0, s, cats: new Set<string>(), items: new Set<string>(), group: n !== r.item }; o.v += v; o.cats.add(r.cat); o.items.add(r.item); m.set(k, o); };
  for (const r of c.cur) { const n = sourceOf(r); add(n, 1, r.s1, r); add(n, 2, r.s2, r); add(n, 3, r.s3, r); add(WTT, 3, r.s33, r); }
  const used = { 1: 0, 2: 0, 3: 0 };
  return [...m.values()].filter((x) => x.v > 0).sort((a, b) => b.v - a.v).map((x) => ({ n: x.n, v: x.v, s: x.s, cats: [...x.cats], items: [...x.items], group: x.group, c: SHADE[x.s][used[x.s]++ % SHADE[x.s].length]! }));
}
/** What opening a source shows: its item (purchases: the spend categories behind the group), or the entries with upstream energy emissions. */
const srcDrill = (t: { n: string; s: number; cats: string[]; items: string[] }): Drill =>
  t.n === WTT ? { wtt: true, label: t.n } : { items: t.items, cats: t.cats, scope: t.s, label: t.n };
/** The categories behind a GHG Protocol code ('3.3' is the upstream energy part of fuel and energy entries). */
const codeDrill = (d: Data, k: string, label: string): Drill | null => {
  if (k === '3.3') return { wtt: true, label };
  const cats = d.categories.filter((x) => x.ghg === k).map((x) => x.code);
  return cats.length ? { cats, label } : null;
};
function upDown(c: Ctx) {
  const g = { up: new Map<string, number>(), own: new Map<string, number>(), down: new Map<string, number>() };
  for (const r of c.cur) for (const [code, v, s] of ghgParts(c, r)) { const k = s < 3 ? 'own' : Number(code.split('.')[1]) <= 8 ? 'up' : 'down'; g[k].set(code, (g[k].get(code) ?? 0) + v); }
  return g;
}
const mapSum = (m: Map<string, number>) => [...m.values()].reduce((a, v) => a + v, 0);
const T = (v: number) => `${fmtT(v)} t`;

// ------------------------------------------------------------ overview --
/** The company's carbon credits for a year (retired, approved), for the Net zero cards. Company-wide: credits are not split by facility. */
function useCredits(year: number | null) {
  const [cr, setCr] = useState<CreditData | null>(null);
  useEffect(() => { if (year) api.credits(year).then(setCr).catch(() => setCr(null)); else setCr(null); }, [year]);
  return cr;
}
const CC: Record<string, string> = { avoidance: '#E9B44C', removal_nature: '#3E9B5F', removal_technical: '#6B4FA8' };

function Overview({ d, c, go }: { d: Data; c: Ctx; go: (t: Tab) => void }) {
  const drill = useDrill();
  const cr = useCredits(d.year), ret = cr?.summary.retired ?? 0, off = Math.min(ret, c.total);
  const nzParts: Part[] = [{ v: Math.max(0, c.total - off), c: 'var(--s2)', n: 'Net emissions' }, ...(off ? [{ v: off, c: '#6B4FA8', n: 'Offset by retired credits' }] : [])];
  const w = (v: number) => pc(v, c.total);
  const rows = monthRows(c, (rs) => [0, 1, 2].map((i) => ({ v: sum(rs, S[i]!), c: SC[i]!, n: `Scope ${i + 1}` })), c.cmpOn ? c.prevBy : undefined, (m) => drill({ m, label: `${MN[m - 1]} ${d.year}` }));
  const parts: Part[] = [0, 1, 2].map((i) => ({ v: c.s[i]!, c: SC[i]!, n: `Scope ${i + 1}` }));
  const nCat = (s: number) => new Set(c.cur.flatMap((r) => ghgParts(c, r).filter((p) => p[2] === s).map((p) => p[0]))).size;
  const big = [0, 1, 2].sort((x, y) => c.s[y]! - c.s[x]!)[0]!;
  const lever = ['fuel switching, fleet electrification and refrigerant leak control', 'renewable electricity (on-site solar, green tariff, I-RECs) and cooling efficiency', 'supplier engagement and waste diversion'][big];
  const tm = sources(c);
  const tmTop: Part[] = [...tm.slice(0, 7).map((t) => ({ n: t.n, v: t.v, c: t.c, go: () => drill(srcDrill(t)) })), ...(tm.length > 7 ? [{ n: `Other ${tm.length - 7} sources`, v: sum(tm.slice(7), (x) => x.v), c: '#9AA7A2' }] : [])];
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
              <tr key={i} className="drill" onClick={() => drill({ scope: i + 1, label: `Scope ${i + 1}` })} title={`Open the Scope ${i + 1} entries`}><td className="nowrap"><Dot c={SC[i]!} /> S{i + 1} <span className="muted" style={{ fontSize: 10.5 }}>{nCat(i + 1)} cat.</span></td>
                <td className="num"><b>{fmtT(c.s[i]!)}</b></td><td className="num">{w(c.s[i]!)}</td>
                <td className="num" style={{ color: ch === null ? 'inherit' : ch > 0 ? 'var(--bad)' : 'var(--ok)' }}>{ch === null ? '—' : signPct(ch, 0)}</td></tr>); })}</tbody></table>
        </div>
        <div className="sbar">{parts.map((p) => <span key={p.n} style={{ flex: p.v || 0.0001, background: p.c }} title={p.n} />)}</div>
        <div className="sins"><b>Scope {big + 1} is {w(c.s[big]!)} of the total.</b> Main levers: {lever}.</div>
        <div className="muted" style={{ fontSize: 12.5 }}>{c.cmpOn ? (c.nFull ? `vs ${yy} = the ${c.nFull} complete month${c.nFull === 1 ? '' : 's'} against the same months of ${d.cmpYear}. ` : `vs ${yy} = the same months of ${d.cmpYear}. `) : ''}Scope 2 {d.scope2}-based.</div>
      </DCard>
      <DCard title="Where emissions come from" span={2} sub={`box size = tCO₂e · colour = scope · all ${tm.length} sources listed`}>
        <div className="tmwrap"><div><Treemap items={tmTop} W={320} H={215} /></div>
          <div className="tml">{tm.map((t) => (
            <div key={`${t.s}${t.n}`} className="drill" onClick={() => drill(srcDrill(t))} title="Open the entries"><i style={{ background: t.c }} /><span className="nm" title={`${t.n} · Scope ${t.s}`}>{t.n}</span><b>{t.v < 100 ? fmt(t.v, 1) : fmt0(t.v)} t</b>
              <span className="muted">{c.total ? ((t.v / c.total) * 100 < 1 ? '<1' : Math.round((t.v / c.total) * 100)) : 0}%</span></div>))}</div></div>
      </DCard>
      <DCard title="Top 5 contributors">
        {tm.slice(0, 5).map((t, i) => <div key={`${t.s}${t.n}`} className="t5 drill" onClick={() => drill(srcDrill(t))} title="Open the entries"><span className="rk">{i + 1}</span><span style={{ flex: 1, minWidth: 0 }}><b>{t.n}</b><small>{fmtT(t.v)} t · {w(t.v)}</small></span><i style={{ background: t.c }} /></div>)}
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
        <div className="dsplit"><Donut parts={nzParts} center={pc(off, c.total)} sub="offset" size={118} />
          <Legend parts={nzParts} unit="t" /></div>
        <div className="muted" style={{ fontSize: 13 }}>{ret ? `${fmt0(ret)} t of credits retired for ${d.year} (whole company), reported beside gross emissions, never instead.` : `No retired carbon credits recorded for ${d.year}.`}</div>
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => go('netzero')}>Net zero detail →</button>
      </DCard>
    </div>
  </>;
}

// ---------------------------------------------------- scopes & categories --
function Scopes({ d, c }: { d: Data; c: Ctx }) {
  const drill = useDrill();
  const goCode = (k: string, m?: number) => { const o = codeDrill(d, k, `${k} ${ghgName(d, c, k)}`); return o ? () => drill({ ...o, m, label: m ? `${o.label} · ${MN[m - 1]}` : o.label }) : undefined; };
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
      {[0, 1, 2].map((i) => { const parts = [...sc[i]!.entries()].sort((a, b) => b[1] - a[1]).map(([k, v], j) => ({ n: `${k} ${ghgName(d, c, k)}`, v, c: PAL[(j + i + 1) % PAL.length]!, go: goCode(k) })); return (
        <DCard key={i} title={<><Dot c={SC[i]!} />Scope {i + 1}</>}><div className="dsplit"><Donut parts={parts} center={fmt0(c.s[i]!)} sub="t" size={130} /><Legend parts={parts} unit="t" /></div></DCard>); })}
      <DCard title="By GHG Protocol category and month (tCO₂e)" span={3}>
        <div className="scrollx"><table className="t dt"><thead><tr><th>Category</th>{MN.map((m) => <th key={m} className="num">{m}</th>)}{whole.size > 0 && <th className="num">Whole year</th>}<th className="num">Total</th><th className="num">Share</th></tr></thead>
          <tbody>{allCodes.map(({ k, ms, t }) => { const mx = Math.max(...ms) || 1, s = k[0]; return (
            <tr key={k}><td className={`nowrap${goCode(k) ? ' drill' : ''}`} onClick={goCode(k)}><span className={`codechip s${s}`}>{k}</span> {ghgName(d, c, k)}</td>
              {ms.map((v: number, i: number) => <td key={i} className={`num hm${v && goCode(k) ? ' drill' : ''}`} onClick={v ? goCode(k, i + 1) : undefined} style={{ background: v ? `color-mix(in srgb, var(--s${s}) ${Math.round(10 + (v / mx) * (s === '1' ? 28 : 45))}%, transparent)` : 'transparent' }}>{v ? fmtT(v) : ''}</td>)}
              {whole.size > 0 && <td className="num">{whole.get(k) ? fmtT(whole.get(k)!) : ''}</td>}
              <td className="num"><b>{fmtT(t)}</b></td><td className="num">{c.total ? fmt((t / c.total) * 100, 1) : 0}%</td></tr>); })}</tbody></table></div>
      </DCard>
    </div>
  </>;
}

// ---------------------------------------------------------------- facilities --
function Facilities({ d, c, pick }: { d: Data; c: Ctx; pick: (id: string) => void }) {
  const drill = useDrill();
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
            return <td key={i} className={`num hm${v ? ' drill' : ''}`} onClick={v ? () => drill({ fid: x.f.id, m, label: `${x.f.name} · ${MN[m - 1]}` }) : undefined} title={!has ? 'No data yet' : wt ? 'Entries waiting for approval' : 'Approved — click to open the entries'} style={{ background: v ? `color-mix(in srgb, var(--primary) ${Math.round(8 + (v / mx) * 62)}%, transparent)` : 'transparent', ...(wt || !has ? { outline: '1.5px dashed var(--warn)', outlineOffset: -3 } : {}) }}>{v ? fmtT(v) : '—'}</td>; })}</tr>)}</tbody></table></div>
        <div className="muted" style={{ fontSize: 12.5 }}>Dashed outline = month not fully approved, or no data yet.</div>
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
        {noKwh > 0 && <div className="muted" style={{ fontSize: 12.5 }}>{noKwh} vehicle entries are recorded by distance: their emissions count, their energy is not converted.</div>}</DCard>
      <DCard title="Energy mix"><div className="dsplit"><Donut parts={mix} center={fmt0(total)} sub="MWh" size={140} /><Legend parts={mix} unit="MWh" /></div></DCard>
      <DCard title="By facility (MWh)" span={2}><HBars items={fac} unit="MWh" c="var(--s2)" /></DCard>
      <DCard title="Renewable electricity"><div className="dsplit"><Donut parts={[{ n: 'Renewable', v: ren, c: '#E9B44C' }, { n: 'Grid & other', v: Math.max(0, elec - ren), c: 'var(--line2)' }]} center={pc(ren, elec)} sub="renewable" size={130} />
        <div className="muted" style={{ fontSize: 13, flex: 1, minWidth: 150 }}>Add I-RECs or green tariffs under Energy certificates & suppliers to lift the market-based renewable share.</div></div></DCard>
    </div>
  </>;
}

// ----------------------------------------------------------------- water --
const GRI: Record<string, string> = { third_party: 'Third-party water (utility, tanker, TSE)', groundwater: 'Groundwater', seawater: 'Seawater', surface: 'Surface water' };
const W_PAL = ['#2E6FB0', '#7FB8D4', '#1F6F5C', '#86CDB4', '#E9B44C', '#9AA7A2', '#6B4FA8'];
const m3 = (r: Row) => r.m3 ?? 0;
function Water({ d, c }: { d: Data; c: Ctx }) {
  const w = c.cur.filter((r) => r.cat.startsWith('water_'));
  if (!w.length) return <div className="card muted">No water entered for this selection. Add it under Add data → Water: what each facility takes in by source, reuses, and lets out, typed in or from water bills and meters.</div>;
  const inn = w.filter((r) => r.flow === 'withdrawal'), out = w.filter((r) => r.flow === 'discharge'), re = w.filter((r) => r.flow === 'reuse');
  const W = sum(inn, m3), D = sum(out, m3), R = sum(re, m3), cons = W - D, em = sum(w, tot);
  const by = (rs: Row[], key: (r: Row) => string) => { const m = new Map<string, number>(); for (const r of rs) m.set(key(r), (m.get(key(r)) ?? 0) + m3(r)); return [...m.entries()].filter(([, v]) => v).sort((a, b) => b[1] - a[1]); };
  const src = by(inn, (r) => r.item), col = new Map(src.map(([n], i) => [n, W_PAL[i % W_PAL.length]!]));
  const srcParts = src.map(([n, v]) => ({ n, v, c: col.get(n)! }));
  const rows = monthRows(c, (rs) => src.map(([n]) => ({ v: sum(rs.filter((r) => r.flow === 'withdrawal' && r.item === n), m3), c: col.get(n)!, n })));
  rows.forEach((r, i) => { if (c.months.includes(i + 1)) r.line2 = sum(out.filter((x) => x.m === i + 1), m3); });
  const gIn = by(inn, (r) => r.gri), gOut = by(out, (r) => r.gri), ML = (v: number) => fmt(v / 1000, v < 10000 ? 2 : 1);
  const facs = d.facilities.map((f) => { const a = sum(inn.filter((r) => r.f === f.id), m3), b = sum(out.filter((r) => r.f === f.id), m3); return { f, w: a, d: b, per: f.employees ? (a * c.k) / f.employees : null }; }).filter((x) => x.w || x.d).sort((a, b) => b.w - a.w);
  const emBy = new Map<string, number>(); for (const r of w) if (tot(r)) emBy.set(r.item, (emBy.get(r.item) ?? 0) + tot(r));
  return <>
    <DStat cells={[['Water withdrawn', <>{fmt0(W)} <small>m³</small></>, `${c.periodLabel} · ${ML(W)} ML`], ['Discharged', `${fmt0(D)} m³`, `${pc(D, W)} of withdrawal`],
      ['Consumption', `${fmt0(cons)} m³`, 'withdrawn − discharged', cons < 0 ? 'var(--bad)' : undefined], ['Recycled or reused', `${fmt0(R)} m³`, `${pc(R, W + R)} of water used`, R ? 'var(--ok)' : undefined],
      ['Water emissions', T(em), 'supply 3.1 · treatment 3.5'], ['Per employee', c.staff ? `${fmt(W / c.staff, 1)} m³` : '—', c.staff ? 'withdrawn, in the period' : 'add employees']]} />
    <div className="dgrid">
      <DCard title="Water withdrawn by month and source (m³)" span={2}><Bars rows={rows} unit="m³" h={175} label="Water by month" />
        <div className="lgd">{srcParts.map((p) => <span key={p.n}><i style={{ background: p.c }} />{p.n}</span>)}<span><i className="ln dash" style={{ borderColor: '#D99A1E' }} />Discharged</span><span className="muted">pale = month still filling</span></div></DCard>
      <DCard title="By source"><div className="dsplit"><Donut parts={srcParts} center={fmt0(W)} sub="m³" size={130} /><Legend parts={srcParts} unit="m³" /></div></DCard>
      <DCard title="Water balance · GRI 303 (megalitres)" span={2}>
        <table className="t dt"><thead><tr><th /><th className="num">Withdrawal</th><th className="num">Discharge</th></tr></thead>
          <tbody>{Object.keys(GRI).filter((k) => gIn.some(([g]) => g === k) || gOut.some(([g]) => g === k)).map((k) => (
            <tr key={k}><td>{GRI[k]}</td><td className="num">{ML(gIn.find(([g]) => g === k)?.[1] ?? 0)}</td><td className="num">{ML(gOut.find(([g]) => g === k)?.[1] ?? 0)}</td></tr>))}
            <tr><td><b>Total</b></td><td className="num"><b>{ML(W)}</b></td><td className="num"><b>{ML(D)}</b></td></tr>
            <tr><td>Consumption (withdrawal − discharge)</td><td className="num" colSpan={2}><b>{ML(cons)}</b></td></tr>
            <tr><td>Recycled or reused on site</td><td className="num" colSpan={2}>{ML(R)}</td></tr></tbody></table>
        <div className="muted" style={{ fontSize: 12.5 }}>Water lost by evaporation, in products or to irrigation counts as consumption. Water stress areas are not assessed.</div></DCard>
      <DCard title="Emissions by source (tCO₂e)"><HBars unit="t" c="var(--s3)" items={[...emBy.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, d: 2 }))} />
        <div className="muted" style={{ fontSize: 12.5 }}>Own wells, sea intake and rain: no Scope 3 (their energy is in your electricity and fuel). Mains water uses DESNZ's UK water supply factor unless the utility's own factor was entered.</div></DCard>
      <DCard title="By facility (m³)" span={2}><HBars unit="m³" c="#2E6FB0" items={facs.map((x) => ({ n: x.f.name, v: x.w, p: W ? (x.w / W) * 100 : 0 }))} /></DCard>
      <DCard title="Withdrawn per employee (m³ / year)"><HBars unit="m³" c="#7FB8D4" items={facs.filter((x) => x.per !== null).map((x) => ({ n: x.f.name, v: x.per!, d: 1 })).sort((a, b) => b.v - a.v)} /></DCard>
    </div>
  </>;
}

// ----------------------------------------------------------------- waste --
/** Route of waste sent out: from the factor's treatment route, else from its name. */
const ROUTE_NAME: Record<string, string> = { reuse: 'Re-use', open_loop: 'Recycling', closed_loop: 'Recycling', composting: 'Composting / digestion', ad: 'Composting / digestion', combustion: 'Waste-to-energy', landfill: 'Landfill' };
/** GRI 306 operation chosen on the entry (re-use, incineration without energy recovery, other disposal) */
const GRI_NAME: Record<string, string> = { reuse: 'Re-use', recycling: 'Recycling', composting: 'Composting / digestion', ad: 'Composting / digestion', incin_er: 'Waste-to-energy', incin_noer: 'Incineration', landfill: 'Landfill', other: 'Other' };
export const route = (r: Row) => { if (r.wgri && GRI_NAME[r.wgri]) return GRI_NAME[r.wgri]!; if (r.route === 'treatment') return 'Other'; if (r.route && ROUTE_NAME[r.route]) return ROUTE_NAME[r.route]!; const t = `${r.item} ${r.sub}`.toLowerCase();
  return /re-?use/.test(t) ? 'Re-use' : /recycl/.test(t) ? 'Recycling' : /compost|anaerobic|digest/.test(t) ? 'Composting / digestion'
    : /incinerat|energy recovery|waste-to-energy|combust/.test(t) ? 'Waste-to-energy' : /landfill/.test(t) ? 'Landfill' : 'Other'; };
const ROUTE_C: Record<string, string> = { Landfill: '#C2523C', Recycling: '#2BA38A', 'Re-use': '#1F6F5C', 'Composting / digestion': '#86CDB4', 'Waste-to-energy': '#E9B44C', Incineration: '#B07A2A', Other: '#9AA7A2' };
/** diverted from landfill (a common municipal measure: waste-to-energy counts; GRI 306 treats it as disposal) */
export const DIVERT = new Set(['Re-use', 'Recycling', 'Composting / digestion', 'Waste-to-energy']);
/** GRI 306-4 / 306-5: recovery is diverted from disposal; incineration with energy recovery is disposal */
const GRI306: [string, string, string[]][] = [['Diverted from disposal', 'Preparation for re-use', ['Re-use']], ['Diverted from disposal', 'Recycling', ['Recycling']], ['Diverted from disposal', 'Other recovery (composting, digestion)', ['Composting / digestion']],
  ['Directed to disposal', 'Incineration with energy recovery', ['Waste-to-energy']], ['Directed to disposal', 'Incineration without energy recovery', ['Incineration']], ['Directed to disposal', 'Landfilling', ['Landfill']], ['Directed to disposal', 'Other disposal', ['Other']]];
export const tonnes = (r: Row) => (r.unit === 't' ? r.qty : r.unit === 'kg' ? r.qty / 1000 : 0);
function Waste({ d, c }: { d: Data; c: Ctx }) {
  const own = c.cur.filter((r) => r.cat === 'waste_generated'), site = c.cur.filter((r) => r.cat === 'waste_treatment');
  const total = sum(own, tonnes), div = sum(own.filter((r) => DIVERT.has(route(r))), tonnes), haz = sum(own.filter((r) => r.haz), tonnes);
  const recov = sum(own.filter((r) => ['Re-use', 'Recycling', 'Composting / digestion'].includes(route(r))), tonnes);
  const by = new Map<string, number>(); for (const r of own) by.set(route(r), (by.get(route(r)) ?? 0) + tonnes(r));
  const parts = [...by.entries()].filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, c: ROUTE_C[n] ?? '#9AA7A2' }));
  const rows = monthRows(c, (rs) => parts.map((p) => ({ v: sum(rs.filter((r) => r.cat === 'waste_generated' && route(r) === p.n), tonnes), c: p.c, n: p.n })));
  const rate: BarRow[] = MN.map((lbl, i) => { const ls = own.filter((r) => r.m === i + 1), t = sum(ls, tonnes), dv = sum(ls.filter((r) => DIVERT.has(route(r))), tonnes); return { lbl, parts: t ? [{ v: (dv / t) * 100, c: '#2BA38A', n: 'Diverted from landfill %' }] : [] }; });
  const siteBy = new Map<string, number>(); for (const r of site) siteBy.set(r.item, (siteBy.get(r.item) ?? 0) + tot(r));
  const cons = new Map<string, number>(); for (const r of own) { const k = r.contractor || 'Not given'; cons.set(k, (cons.get(k) ?? 0) + tonnes(r)); }
  const cell = (h: boolean | null, names: string[]) => sum(own.filter((r) => !!r.haz === !!h && names.includes(route(r))), tonnes);
  const t1 = (v: number) => (v ? fmt(v, v < 10 ? 2 : 1) : '—');
  return <>
    <DStat cells={[['Waste generated', <>{fmt(total, 1)} <small>t</small></>, 'sent to others, all streams'], ['Diverted from landfill', pc(div, total), 're-use, recycling, composting, waste-to-energy', 'var(--ok)'],
      ['Recovered (GRI 306-4)', pc(recov, total), 're-use, recycling, composting'], ['Hazardous', `${fmt(haz, 1)} t`, `${pc(haz, total)} of waste`, haz ? 'var(--warn)' : undefined],
      ['Waste emissions', `${fmt(sum(own, tot), 1)} t`, 'Scope 3 category 5'], ['Treated at own sites', T(sum(site, tot)), 'Scope 1']]} />
    <div className="dgrid">
      <DCard title="Waste by month and route (t)" span={2}><Bars rows={rows} unit="t" h={175} label="Waste by month" /><div className="lgd">{parts.map((p) => <span key={p.n}><i style={{ background: p.c }} />{p.n}</span>)}</div></DCard>
      <DCard title="By route"><div className="dsplit"><Donut parts={parts} center={pc(div, total)} sub="diverted" size={130} /><Legend parts={parts} unit="t" /></div></DCard>
      <DCard title="Waste by disposal method · GRI 306 (t)" span={2}>
        <table className="t dt"><thead><tr><th /><th>Operation</th><th className="num">Hazardous</th><th className="num">Non-hazardous</th><th className="num">Total</th></tr></thead>
          <tbody>{GRI306.map(([g, n, names], i) => { const h = cell(true, names), nh = cell(false, names); return (
            <tr key={n}><td className="muted small">{i === 0 || GRI306[i - 1]![0] !== g ? g : ''}</td><td>{n}</td><td className="num">{t1(h)}</td><td className="num">{t1(nh)}</td><td className="num"><b>{t1(h + nh)}</b></td></tr>); })}
            <tr><td /><td><b>Waste generated</b></td><td className="num"><b>{t1(haz)}</b></td><td className="num"><b>{t1(total - haz)}</b></td><td className="num"><b>{t1(total)}</b></td></tr></tbody></table>
        <div className="muted" style={{ fontSize: 12.5 }}>All off-site (sent to other companies). Waste the company treats for others at its own sites is operations, not waste generated: shown separately below.</div></DCard>
      <DCard title="By contractor (t)"><HBars unit="t" c="var(--s3)" items={[...cons.entries()].sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v, d: 1, p: total ? (v / total) * 100 : 0 }))} /></DCard>
      <DCard title="Diverted from landfill by month (%)" span={2}><Bars rows={rate} unit="%" h={150} label="Diversion rate" /></DCard>
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
const nzOk = (S: CreditData['summary']) => S.netZero.residual > 0;
function NetZero({ d, c }: { d: Data; c: Ctx }) {
  const allNow = sum(d.rows, tot), ann = c.nMax < 12 ? (allNow * 12) / c.nMax : allNow, prev = sum(d.prevRows, tot);
  const cr = useCredits(d.year), crPrev = useCredits(d.prevRows.length ? d.cmpYear : null);
  const ret = cr?.summary.retired ?? 0, retPrev = crPrev?.summary.retired ?? 0;
  const split = (g: number, r: number) => [{ v: Math.max(0, g - Math.min(r, g)), c: 'var(--s2)', n: 'Net emissions' }, { v: Math.min(r, g), c: '#6B4FA8', n: 'Offset by retired credits' }];
  const rows: BarRow[] = [...(d.prevRows.length ? [{ lbl: String(d.cmpYear), parts: split(prev, retPrev) }] : []),
    { lbl: c.nMax < 12 ? `${d.year} (annualised)` : String(d.year), parts: split(ann, ret) }];
  const S = cr?.summary, pipe = cr ? cr.lots.reduce((a, l) => a + l.available, 0) + cr.summary.pipeline.contracted : null;
  // reductions delivered (actions done, from Targets & actions), counted for the months viewed
  const [tg, setTg] = useState<TargetsData | null>(null);
  useEffect(() => { api.targets(d.year).then(setTg).catch(() => setTg(null)); }, [d.year]);
  const ids = new Set(d.facilities.map((f) => f.id));
  const doneT = (tg?.actions ?? []).filter((a) => a.status === 'Done' && !a.excluded && (!a.facilityId || ids.has(a.facilityId))).reduce((s, a) => s + (a.actual ?? a.abate), 0);
  const red = (doneT * c.months.length) / 12, resid = tg ? (sum(d.prevRows, tot) * (tg.sbti.resid ?? 10)) / 100 : null;
  const path = [{ v: c.total, c: 'var(--s2)', n: 'Emissions' }, { v: red, c: '#E9B44C', n: 'Reduced & avoided' }];
  return <>
    <DStat cells={[[`Gross emissions ${d.year}`, <>{fmt0(c.total)} <small>t</small></>, c.periodLabel], [`Credits retired ${d.year}`, `${fmt0(ret)} t`, S && ret ? `${Math.round(S.removalShare * 100)}% removals · whole company` : 'removals and avoidance', '#6B4FA8'],
      ['Net after credits', T(Math.max(0, c.total - ret)), 'shown alongside gross, never instead'], ['Reductions delivered', tg ? `${fmt0(doneT)} t/yr` : '—', 'completed actions'], ['Credits in pipeline', pipe === null ? '—' : `${fmt0(pipe)} t`, 'held or contracted, not retired']]} />
    <div className="dgrid">
      <DCard title="Emissions vs offsets by year (tCO₂e)" span={2}><Bars rows={rows} unit="t" h={175} label="Emissions by year" />
        <div className="lgd"><span><i style={{ background: 'var(--s2)' }} />Net emissions</span><span><i style={{ background: '#6B4FA8' }} />Offset by retired credits</span>{S ? <span className="muted">Net zero {S.netZero.year}: residual ≤ {fmt0(S.netZero.residual)} t a year ({S.netZero.residPct}% of the {S.netZero.baseYear} base year) neutralised by permanent removals</span> : tg && resid !== null && <span className="muted">Net zero {tg.sbti.nzYear}: residual ≤ {fmt0(resid)} t neutralised by permanent removals</span>}</div></DCard>
      <DCard title="Path to net zero" right={<Link className="btn sm ghost" to="/targets?ttab=track">Targets →</Link>}><div className="dsplit"><Donut parts={path} center={`${Math.round(c.total + red ? (red / (c.total + red)) * 100 : 0)}%`} sub="addressed" size={118} /><Legend parts={path} unit="t" /></div></DCard>
      <DCard title="Credit portfolio" span={2} sub={`retired for ${d.year} by type`} right={<Link className="btn sm ghost" to={`/credits?year=${d.year}`}>Carbon credits →</Link>}>
        {S && ret ? <HBars unit="t" c="#6B4FA8" items={Object.entries(S.byCategory).filter(([, v]) => v > 0).map(([k, v]) => ({ n: cr!.categories[k]!, v, d: 0, c: CC[k] }))} />
          : <div className="muted" style={{ fontSize: 13 }}>No credits retired for {d.year}{cr?.lots.length ? ` (${cr.lots.length} purchase${cr.lots.length === 1 ? '' : 's'} in the register)` : ''}; gross and net are the same. Record purchases and retirements under Carbon credits.</div>}
        {S && nzOk(S) && <div className="muted" style={{ fontSize: 13 }}>Removals held or contracted for the residual at net zero: {fmt0(S.netZero.removalsHeld)} t of {fmt0(S.netZero.residual)} t a year.</div>}</DCard>
      <DCard title="Good practice"><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}><li>Report gross emissions first; credits separately.</li><li>SBTi targets count reductions only — credits do not.</li><li>Use permanent removals for the residual at net zero.</li></ul></DCard>
    </div>
  </>;
}
