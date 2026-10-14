/**
 * What is viewed and when, shared by Home, Dashboards and the KPI dashboard (as in the prototype's
 * top bar): VIEWING — the company, a sub-group, a facility or a dashboard group; PERIOD — the year,
 * the months (year to date, a quarter, a month) and the comparison; Scope 2 basis. Kept in the URL
 * (?year=&node=&group=&per=&cmp=&scope2=&pend=), so a view can be shared or bookmarked.
 *
 * Also the year's dashboard rows and the context computed from them (totals by scope, months with
 * complete data, change against last year on the complete months only).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type DashGroup, type OrgNode } from '../lib/api';
import { Icon } from './Icon';
import { MN, fmt } from './DashCharts';

export interface Row {
  f: string; m: number; cat: string; item: string; grp: string; sub: string; unit: string; s1: number; s2: number; s3: number; s33: number; bio: number; memo: number;
  n: number; approved: number; estimated: number; qty: number; rec: number; kind: 'fuel' | 'electricity' | 'cooling' | 'heat' | null; kwh: number | null;
  m3: number | null; route: string; flow: string; gri: string; haz: boolean | null; contractor: string | null; wgri?: string | null;
  span?: number | null;   // months an entry covers when it spans more than a month (m = 0)
}
export interface Data {
  year: number; years: number[]; group: { id: string; name: string } | null; pend: boolean; consolidation: string; scope2: 'location' | 'market';
  baseYear: { year: number; total: number | null } | null; restated?: { s1: number; s2: number; s3: number; items: { title: string; trigger: string; facility: string | null }[] } | null; cmpYear: number; rows: Row[]; prevRows: Row[];
  prevMonthly: { m: number; s1: number; s2: number; s3: number }[]; baseMonthly: { m: number; s1: number; s2: number; s3: number }[];
  facilities: { id: string; name: string; parent: string | null; type: string | null; employees: number | null; area: number | null; weight: number }[];
  categories: { code: string; name: string; scope: number; ghg_category: number | null; ghg: string }[]; s3Names: Record<number, string>;
  purchases: { byGroup: { name: string; t: number }[]; bySupplier: { name: string; t: number }[]; byMethod: { method: string; t: number; lines: number }[]; suppliers: number; withTarget: number };
  filled: [string, number][]; waiting: [string, number][]; approvedIn: [string, number][];
}

export const CONS: Record<string, string> = { operational: 'operational control', financial: 'financial control', equity: 'equity share' };
export const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + (f(x) || 0), 0);
export const tot = (r: Row) => r.s1 + r.s2 + r.s3 + r.s33;
export const S = [(r: Row) => r.s1, (r: Row) => r.s2, (r: Row) => r.s3 + r.s33];
export const pc = (v: number, t: number) => (!t ? '0%' : v > 0 && v / t < 0.005 ? '<1%' : `${Math.round((v / t) * 100)}%`);
export const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
export const signPct = (p: number, d = 1) => `${p > 0 ? '+' : '−'}${fmt(Math.abs(p), d)}%`;


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


export function ctx(d: Data, per: string, cmp: 'prev' | 'none') {
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
  // a facility-month is in when it has data that counts in this view (approved, or also waiting when "include waiting")
  const apprIn = new Set((d.approvedIn ?? []).map(([f, m]) => `${f}|${m}`));
  const isIn = (f: string, m: number) => (d.pend ? filled.has(`${f}|${m}`) : apprIn.has(`${f}|${m}`));
  const full = (m: number) => rep.length > 0 && rep.every((f) => isIn(f.id, m));
  const inShare = (m: number) => (rep.length ? rep.filter((f) => isIn(f.id, m)).length / rep.length : 1);
  const complete = rep.length && months.length ? sum(months, (m) => rep.filter((f) => isIn(f.id, m)).length) / (rep.length * months.length) : 1;
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
    cur, months, nMax, ytd, periodLabel, rep, full, complete, isIn, inShare, waiting, filled, cmpOn, nFull: fullM.length, yoy: yoyOf(tot), yoyS: S.map(yoyOf),
    s, total, staff, area, cat, k: months.length ? 12 / months.length : 1,
    prevBy: (m: number) => { const rs = d.prevRows.filter((r) => r.m === m); return cmpOn && rs.length ? sum(rs, tot) : null; },
  };
}
export type Ctx = ReturnType<typeof ctx>;

/** The view in the URL, the year's data and its context. */
export function useView() {
  const { tenant } = useApp();
  const [sp, setSp] = useSearchParams();
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

  return { year, node, group, scope2, per, cmp, pend, set, panel, setPanel, nodes, groups, baseYr, d, c, err, root, here, kind, name, nFac, pick, sp };
}
export type View = ReturnType<typeof useView>;

/** The two pickers (VIEWING, PERIOD) and their panels, with what goes on the right. */
export function ViewBar({ v, right }: { v: View; right?: ReactNode }) {
  const { role } = useApp();
  const { d, c, panel, setPanel, kind, name, nFac, nodes, root, here, groups, group, set, per, cmp, scope2, baseYr, pick } = v;
  return (<>
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
        {right}
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

  </>);
}
