/**
 * Targets & Actions (as in the prototype): one place for the net-zero plan.
 *
 *   Target register    KPIs, SBTi-compatible target structure, scenario comparison, objectives, top
 *                      actions; the main targets with the Scope 1+2 and Scope 3 paths and each facility
 *   SBTi setup         target structure and a readiness check against the SBTi near-term criteria
 *   Scenario analysis  scenarios compared (gap, capex, NPV) and the scenario lab (levers)
 *   Action portfolio   the action library sized from your own data, plus custom actions; select into a scenario
 *   ROI & cost         cost-benefit per action and per scenario, the marginal abatement cost curve
 *   Tracking           Net Zero trajectory, projection waterfall, delivery and estimated vs actual reduction
 *
 * Everyone views; managers and above change actions and scenarios; the super admin changes targets.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../App';
import { api, type ActionInput, type ActStatus, type RAction, type Sbti, type TargetsData } from '../lib/api';
import { ACT_CATS, ACT_LIB, COMMITTED, STATUS_CHIP, cbOf, frac, libAbate, libItem, scenStats, taData, type TA } from '../lib/targets';
import { Fit, MN, fmt, fmt0 } from '../components/DashCharts';
import { ViewBar, useView, type Data } from '../components/ViewBar';

type Tab = 'reg' | 'sbti' | 'scen' | 'port' | 'roi' | 'track';
const TABS: [Tab, string][] = [['reg', 'Target register'], ['sbti', 'SBTi setup'], ['scen', 'Scenario analysis'], ['port', 'Action portfolio'], ['roi', 'ROI & cost'], ['track', 'Tracking']];
const SBTI_TPL = [
  { id: 'nt15', n: 'SBTi near-term · 1.5 °C (absolute contraction)', d: 'Scope 1+2 at least 4.2% a year linear; Scope 3 at least 2.5% a year if Scope 3 ≥ 40% of total; 5–10 years from submission; 95% S1+2 and 67% S3 coverage.', rate12: 4.2, rate3: 2.5 },
  { id: 'wb2', n: 'SBTi near-term · well-below 2 °C', d: 'Scope 1+2 at least 2.5% a year (no longer accepted for Scope 1+2 by SBTi since 2022 — use for Scope 3 only).', rate12: 2.5, rate3: 2.5 },
  { id: 'nz', n: 'SBTi Net-Zero Standard', d: 'Near-term 1.5 °C targets plus a long-term target: at least 90% reduction across all scopes by 2050, with neutralisation of residual emissions.', rate12: 4.2, rate3: 2.5 },
  { id: 'int', n: 'Scope 3 supplier engagement target', d: '67% of Scope 3 emissions (by emissions) covered by suppliers with science-based targets within 5 years.', rate12: 4.2, rate3: 0 },
];
const sgn = (v: number, d = 1) => `${v <= 0 ? '−' : '+'}${fmt(Math.abs(v), d)}%`;
const kt = (v: number) => (Math.abs(v) >= 1000 ? `${fmt(v / 1000, 1)}k` : fmt0(v));

interface Ctx { t: TargetsData; x: TA; d: Data; acts: RAction[]; sid: string; setSid: (s: string) => void; money: (v: number, m?: boolean) => ReactNode; reload: () => void; go: (t: Tab) => void; open: (id: string | 'new') => void; facName: (id: string | null) => string; names: Map<string, string>; name: string }

export function Targets() {
  const v = useView();
  const { d, err, sp, set } = v;
  const { toast } = useApp();
  const [t, setT] = useState<TargetsData | null>(null);
  const [base, setBase] = useState<Data | null>(null);
  const [tick, setTick] = useState(0);
  const [sid0, setSid] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<string | 'new' | null>(null);
  const [imp, setImp] = useState(false);
  const [ns, setNs] = useState<{ name: string; copy: boolean } | null>(null);
  const tab = (sp.get('ttab') as Tab) || 'reg';
  const go = (k: Tab) => { set({ ttab: k === 'reg' ? null : k }); window.scrollTo(0, 0); };
  const reload = () => setTick((n) => n + 1);
  useEffect(() => { api.targets(d?.year).then(setT).catch((e) => toast((e as Error).message)); }, [tick, d?.year]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!d || !t) return;
    const by = t.baseYear ?? d.year - 1;
    if (by === d.year) { setBase(d); return; }
    api.dashboard({ year: by, node: v.group ? undefined : v.node || undefined, group: v.group || undefined, scope2: v.scope2, pend: v.pend ? '1' : undefined })
      .then((b) => setBase(b as unknown as Data)).catch(() => setBase(null));
  }, [d, t?.baseYear]); // eslint-disable-line react-hooks/exhaustive-deps
  const x = useMemo(() => (d && t && base ? taData(d, base, t) : null), [d, t, base]);
  // the actions in the viewed selection: company-wide, or for a facility viewed
  const acts = useMemo(() => (t && d ? t.actions.filter((a) => !a.facilityId || d.facilities.some((f) => f.id === a.facilityId)) : []), [t, d]);
  const sid = sid0 && t?.scenarios.some((s) => s.id === sid0) ? sid0 : t?.defaultScenario ?? '';
  const money = (val: number, m = false) => <span className="nowrap">{val < 0 ? '−' : ''}{t?.currency ?? ''} {m || Math.abs(val) >= 1e6 ? `${fmt(Math.abs(val) / 1e6, m ? 1 : 2)}m` : fmt0(Math.abs(val))}</span>;
  const names = useMemo(() => new Map((d?.facilities ?? []).map((f) => [f.id, f.name])), [d]);
  const facName = (id: string | null) => (id ? names.get(id) ?? 'Facility' : 'Company-wide');

  const head = (
    <>
      <div className="row tahead">
        <div><span className="lbl">Net zero</span><h1>Targets & Actions</h1><div className="muted">SBTi-aligned targets, scenarios and delivery economics</div></div>
        <span className="grow" />
        {t?.canTarget && <button className="btn" onClick={() => setImp(!imp)}>Import SBTi template</button>}
        {t?.canAct && <button className="btn p" onClick={() => setNs({ name: '', copy: true })}>Create scenario</button>}
      </div>
      <nav className="tabs" role="tablist">{TABS.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{n}</button>)}</nav>
    </>);
  if (!d || !t || !x) return <div className="page" style={{ gap: 12 }}><ViewBar v={v} />{head}<div className="card empty">{err ?? 'Loading…'}</div></div>;
  const C: Ctx = { t, x, d, acts, sid, setSid, money, reload, go, open: setDrawer, facName, names, name: v.name };
  return (
    <div className="page tapage" style={{ gap: 12 }}>
      <ViewBar v={v} />
      {head}
      {imp && <ImportPanel C={C} close={() => setImp(false)} />}
      {ns && (
        <section className="card row" style={{ gap: 8 }}>
          <b>New scenario</b>
          <input className="input" style={{ flex: 1, maxWidth: 320 }} autoFocus value={ns.name} placeholder="e.g. Accelerated, Low capex" onChange={(e) => setNs({ ...ns, name: e.target.value })} />
          <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={ns.copy} onChange={(e) => setNs({ ...ns, copy: e.target.checked })} /> Start from the current plan’s actions</label>
          <button className="btn p" onClick={async () => {
            if (!ns.name.trim()) { toast('Name the scenario.'); return; }
            try { const r = await api.addScenario(ns.name.trim(), ns.copy); setNs(null); setSid(r.id); toast('Scenario created — select its actions'); reload(); go('port'); } catch (e) { toast((e as Error).message); }
          }}>Create</button>
          <button className="btn ghost" onClick={() => setNs(null)}>Cancel</button>
        </section>)}
      {tab === 'sbti' ? <SbtiTab C={C} />
        : tab === 'scen' ? <><ScenCompare C={C} /><ScenarioLab C={C} /></>
        : tab === 'port' ? <Portfolio C={C} />
        : tab === 'roi' ? <><CostBenefit C={C} /><ActionsRoi C={C} /></>
        : tab === 'track' ? <><NzChart C={C} /><Projection C={C} /><Delivery C={C} /><ActualCard C={C} /></>
        : <><TaKpis C={C} /><Register C={C} /><TargetsPaths C={C} /></>}
      {drawer && <ActionDrawer C={C} id={drawer} close={() => setDrawer(null)} />}
    </div>
  );
}

const ScenPick = ({ C }: { C: Ctx }) => (
  <select className="input" style={{ width: 'auto' }} aria-label="Scenario" value={C.sid} onChange={(e) => C.setSid(e.target.value)}>
    {C.t.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
  </select>);
const Bar = ({ p, c = 'var(--primary)' }: { p: number; c?: string }) => <div className="bar" style={{ height: 7 }}><span style={{ width: `${Math.max(0, Math.min(100, p))}%`, background: c }} /></div>;

// ------------------------------------------------------------------ target register --
function TaKpis({ C }: { C: Ctx }) {
  const { x, acts, money } = C;
  const comm = acts.filter((a) => COMMITTED.includes(a.status) && !a.excluded), commT = comm.reduce((s, a) => s + a.abate, 0), inv = comm.reduce((s, a) => s + a.capex, 0), allCap = acts.reduce((s, a) => s + a.capex, 0);
  const tiles: [string, ReactNode, string, number][] = [
    [`${x.T.year} target`, `−${fmt(x.T.s12, 0)}%`, `Scope 1+2 vs ${x.by}`, 100],
    ['Current reduction', sgn(x.red12), `Scope 1+2, ${x.cy} to date vs same months ${x.by}`, x.T.s12 ? (Math.max(0, -x.red12) / x.T.s12) * 100 : 0],
    ['Committed abatement', `${fmt0(commT)} t/yr`, `${comm.length} approved or delivering actions`, x.baseT ? (commT / (x.baseT * x.T.s12 / 100)) * 100 : 0],
    ['Investment approved', money(inv, true), 'capex of committed actions', allCap ? (inv / allCap) * 100 : 0],
  ];
  return <div className="hk">{tiles.map(([l, v, s, p]) => <section key={l} className="card kc"><span className="muted">{l}</span><span className="v">{v}</span><Bar p={p} /><span className="ks">{s}</span></section>)}</div>;
}

function Register({ C }: { C: Ctx }) {
  const { t, x, acts, money, go, reload } = C;
  const { toast } = useApp();
  const sb = t.sbti, s3share = x.base3 / (x.baseT || 1);
  const [obj, setObj] = useState<{ name: string; scope: string; year: string; pct: string; growth: string } | null>(null);
  const kv = (k: string, v: string) => <div key={k} className="row kvrow"><span className="grow">{k}</span><b>{v}</b></div>;
  const objs = [{ id: 'm12', name: 'SBTi near-term · Scope 1+2', scope: 'Scope 1+2', year: x.T.year, pct: x.T.s12, growth: x.growth, main: true }, { id: 'm3', name: 'SBTi near-term · Scope 3', scope: 'Scope 3', year: x.T.year, pct: x.T.s3, growth: x.growth, main: true }, ...t.objectives.map((o) => ({ ...o, main: false }))];
  const baseOf = (scope: string) => (scope === 'Scope 1+2' ? x.base12 : scope === 'Scope 3' ? x.base3 : scope === 'Scope 1' ? x.b[0]! : scope === 'Scope 2' ? x.b[1]! : x.baseT);
  return (
    <>
      <div className="tagrid2">
        <section className="card tacard">
          <div className="row"><h2>SBTi-compatible target structure</h2><span className="grow" /><button className="btn sm ghost" onClick={() => go('sbti')}>Edit →</button></div>
          <div>{kv('Target type', sb.type)}{kv('Base year', String(x.by))}{kv('Scopes', sb.scopes)}{kv('Coverage', `${sb.cov12}% Scope 1+2; ${sb.cov3}% Scope 3`)}{kv('Ambition', `${sb.ambition} · −${fmt(x.T.s12, 0)}% S1+2, −${fmt(x.T.s3, 0)}% S3`)}{kv('Target year', String(x.T.year))}{kv('Validation status', sb.status)}</div>
          <span className="muted small">Scope 3 is {Math.round(s3share * 100)}% of base-year emissions{s3share >= 0.4 ? ' — above 40%, so SBTi requires a Scope 3 target.' : '.'}</span>
        </section>
        <section className="card tacard">
          <h2>Scenario comparison</h2>
          <div className="scrollx"><table className="t"><thead><tr><th>Scenario</th><th className="num">{x.T.year} gap</th><th className="num">Capex</th><th className="num">NPV</th></tr></thead>
            <tbody>{t.scenarios.map((s) => { const st = scenStats(x, acts, s.id); return <tr key={s.id}><td>{s.name}</td><td className="num" style={{ color: st.gap > 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 600 }}>{st.gap > 0 ? `${fmt(st.gap / 1000, 1)} kt` : 'met'}</td><td className="num">{money(st.capex, true)}</td><td className="num">{money(st.npv, true)}</td></tr>; })}</tbody></table></div>
          <div><button className="btn" onClick={() => go('scen')}>Open scenario modeller</button></div>
        </section>
      </div>
      <section className="card tacard">
        <div className="row"><h2>Objectives</h2><span className="grow" />{t.canTarget && <button className="btn sm" onClick={() => setObj({ name: '', scope: 'Scope 3', year: String(x.T.year), pct: '30', growth: String(x.growth) })}>+ Add objective</button>}</div>
        <div className="scrollx"><table className="t"><thead><tr><th>Name</th><th className="ctr">Scope</th><th>Base</th><th>Target year</th><th className="num">Reduction</th><th className="num">Growth / yr</th><th className="num">Target level</th><th className="ctr">Status</th><th /></tr></thead>
          <tbody>{objs.map((o) => (
            <tr key={o.id}><td><b>{o.name}</b>{o.main && <> <span className="chip c-info" style={{ fontSize: 10 }}>main</span></>}</td><td>{o.scope}</td><td>{x.by}</td><td>{o.year}</td><td className="num">−{fmt(o.pct, 0)}%</td><td className="num">{fmt(o.growth, 0)}%</td>
              <td className="num">{fmt0(baseOf(o.scope) * (1 - o.pct / 100))} t</td><td><span className={`chip ${o.main ? 'c-ok' : 'c-n'}`}>{o.main ? 'Set' : 'Internal'}</span></td>
              <td>{!o.main && t.canTarget && <button className="btn xs ghost danger" aria-label="Remove" onClick={async () => { try { await api.removeObjective(o.id); reload(); } catch (e) { toast((e as Error).message); } }}>✕</button>}</td></tr>))}</tbody></table></div>
        {obj && (
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 2, minWidth: 220 }}><span>Name</span><input className="input" value={obj.name} onChange={(e) => setObj({ ...obj, name: e.target.value })} /></label>
            <label className="field"><span>Scope</span><select className="input" value={obj.scope} onChange={(e) => setObj({ ...obj, scope: e.target.value })}>{['Scope 1+2', 'Scope 3', 'All scopes', 'Scope 1', 'Scope 2'].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field" style={{ width: 90 }}><span>Year</span><input className="input num" value={obj.year} onChange={(e) => setObj({ ...obj, year: e.target.value })} /></label>
            <label className="field" style={{ width: 110 }}><span>Reduction %</span><input className="input num" value={obj.pct} onChange={(e) => setObj({ ...obj, pct: e.target.value })} /></label>
            <label className="field" style={{ width: 110 }}><span>Growth %/yr</span><input className="input num" value={obj.growth} onChange={(e) => setObj({ ...obj, growth: e.target.value })} /></label>
            <button className="btn p" onClick={async () => {
              if (!obj.name.trim()) { toast('Name the objective.'); return; }
              try { await api.addObjective({ name: obj.name.trim(), scope: obj.scope, year: Number(obj.year), pct: Number(obj.pct), growth: Number(obj.growth) }); setObj(null); toast('Objective added'); reload(); } catch (e) { toast((e as Error).message); }
            }}>Save</button>
            <button className="btn ghost" onClick={() => setObj(null)}>Cancel</button>
          </div>)}
      </section>
      <section className="card tacard">
        <div className="row"><h2>Action portfolio</h2><span className="grow" /><button className="btn sm ghost" onClick={() => go('port')}>All actions →</button></div>
        <div className="scrollx"><table className="t"><thead><tr><th>Action</th><th>Owner</th><th className="num">Abatement</th><th className="num">Cost</th><th className="num">Payback</th><th className="ctr">Status</th></tr></thead>
          <tbody>{[...acts].sort((a, b) => b.abate - a.abate).slice(0, 6).map((a) => (
            <tr key={a.id}><td><b>{a.name}</b></td><td>{a.owner || '—'}</td><td className="num">{fmt0(a.abate)} t</td><td className="num">{money(a.capex, true)}</td><td className="num">{a.saving > 0 ? `${fmt(a.capex / a.saving, 1)} yrs` : '—'}</td><td><span className={`chip ${STATUS_CHIP[a.status]}`}>{a.status}</span></td></tr>))}
            {!acts.length && <tr><td colSpan={6} className="muted">No actions yet — pick them in Action portfolio.</td></tr>}</tbody></table></div>
      </section>
    </>);
}

function PathChart({ x, base, path, proj, color }: { x: TA; base: number; path: number[]; proj: number; color: string }) {
  const yrs = path.map((_, i) => x.by + i), ci = x.cy - x.by;
  return (
    <Fit minH={230}>{(W, H) => {
      const pad = 46, mx = Math.max(base, proj, 1) * 1.12, xx = (i: number) => pad + (i * (W - pad - 20)) / Math.max(1, yrs.length - 1), yy = (val: number) => H - 26 - (val / mx) * (H - 48);
      return (
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Target path">
          {[0, 0.5, 1].map((g) => { const val = (mx / 1.12) * g; return <g key={g}><line x1={pad} x2={W - 8} y1={yy(val)} y2={yy(val)} stroke="var(--line)" /><text x={pad - 6} y={yy(val) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">{kt(val)}</text></g>; })}
          <polyline points={path.map((val, i) => `${xx(i)},${yy(val)}`).join(' ')} fill="none" stroke="var(--fg2)" strokeWidth="2" strokeDasharray="6 4" />
          <circle cx={xx(0)} cy={yy(base)} r="5" fill="var(--fg2)"><title>{`${x.by} base: ${fmt0(base)} t`}</title></circle>
          {ci >= 0 && ci < yrs.length && <><circle cx={xx(ci)} cy={yy(proj)} r="6" fill={color} /><text x={xx(ci) + 10} y={yy(proj) - 8} fontSize="12.5" fontWeight="700" fill="var(--fg)" paintOrder="stroke" stroke="var(--surface)" strokeWidth="4">{`${x.cy} projected ${fmt0(proj)} t`}</text></>}
          {yrs.map((y, i) => <text key={y} x={xx(i)} y={H - 6} fontSize="12" textAnchor="middle" fill="var(--muted)">{y}</text>)}
        </svg>);
    }}</Fit>);
}

function TargetsPaths({ C }: { C: Ctx }) {
  const { t, x, d, reload } = C;
  const { toast } = useApp();
  const [f, setF] = useState({ year: String(x.T.year), s12: String(x.T.s12), s3: String(x.T.s3) });
  useEffect(() => { setF({ year: String(x.T.year), s12: String(x.T.s12), s3: String(x.T.s3) }); }, [x.T.year, x.T.s12, x.T.s3]);
  const yrs = Array.from({ length: Math.max(1, x.T.year - x.by + 1) }, (_, i) => x.by + i);
  const t12 = yrs.map(x.tgt12), t3 = yrs.map(x.tgt3), ci = Math.min(yrs.length - 1, Math.max(0, x.cy - x.by));
  const p12 = x.pr12, p3 = x.pr3;
  const st = (p: number, tg: number): [string, string] => (p <= tg ? ['On track', 'c-ok'] : p <= tg * 1.05 ? ['Slightly above path', 'c-warn'] : ['Off track', 'c-bad']);
  const card = (title: string, base: number, path: number[], proj: number, ytd: number, pct: number, color: string) => {
    const [l, c] = st(proj, path[ci]!);
    return (
      <section className="card tacard">
        <div className="row"><h2>{title}</h2><span className="grow" /><span className={`chip ${c}`}>{l}</span></div>
        <div className="row tafig"><div><span className="muted">{x.by} base</span><b>{fmt0(base)} t</b></div><div><span className="muted">{x.T.year} target (−{fmt(pct, 0)}%)</span><b>{fmt0(path[path.length - 1]!)} t</b></div><div><span className="muted">{x.cy} path</span><b>{fmt0(path[ci]!)} t</b></div><div><span className="muted">{x.cy} approved so far</span><b>{fmt0(ytd)} t</b></div></div>
        <PathChart x={x} base={base} path={path} proj={proj} color={color} />
        <span className="muted small">Projection scales approved {x.lastM ? `${MN[0]}–${MN[x.lastM - 1]}` : ''} data by the base year’s monthly pattern; entries covering several months are annualised{x.carried ? `, and ${x.carried} yearly source${x.carried > 1 ? 's' : ''} not entered yet this year carry the base-year figure` : ''}. Dashed line = straight-line path to {x.T.year}.</span>
      </section>);
  };
  const rows = d.facilities.map((fc) => {
    const p = x.part(new Set([fc.id])), B = p.base, P = p.proj;
    const tg = B * (1 - (x.T.s12 / 100) * (x.cy - x.by) / Math.max(1, x.T.year - x.by));
    return { fc, B, P, tg };
  }).sort((a, b) => b.B - a.B);
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
        <span className="muted">{C.name} · base year {x.by} · straight-line path to {x.T.year}</span><span className="grow" />
        {t.canTarget && <>
          <label className="field" style={{ width: 110 }}><span>Target year</span><input className="input num" inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} /></label>
          <label className="field" style={{ width: 130 }}><span>Scope 1+2 cut %</span><input className="input num" inputMode="decimal" value={f.s12} onChange={(e) => setF({ ...f, s12: e.target.value })} /></label>
          <label className="field" style={{ width: 130 }}><span>Scope 3 cut %</span><input className="input num" inputMode="decimal" value={f.s3} onChange={(e) => setF({ ...f, s3: e.target.value })} /></label>
          <button className="btn" onClick={async () => {
            const y = Number(f.year), a = Number(f.s12), b = Number(f.s3);
            if (!(y > x.by && y <= 2070) || !(a >= 0 && a <= 100) || !(b >= 0 && b <= 100)) { toast(`Use a year after ${x.by} and percentages between 0 and 100.`); return; }
            try { await api.saveTargets({ year: y, s12: a, s3: b }); toast('Targets saved'); reload(); } catch (e) { toast((e as Error).message); }
          }}>Save</button></>}
      </div>
      <div className="note info">Current target: Scope 1+2 down {fmt(x.T.s12, 0)}% and Scope 3 down {fmt(x.T.s3, 0)}% by {x.T.year} from {x.by}. SBTi’s near-term 1.5 °C minimum for Scope 1+2 is 4.2% a year (42% over 10 years). Projections use approved data only, so months still missing make the projection look lower than it will be.</div>
      <div className="tagrid2 even">{card('Scope 1 + 2', x.base12, t12, p12, x.y12, x.T.s12, 'var(--s2)')}{card('Scope 3', x.base3, t3, p3, x.y3, x.T.s3, 'var(--s3)')}</div>
      <section className="card tacard">
        <h2>Scope 1+2 by facility</h2>
        <div className="scrollx"><table className="t"><thead><tr><th>Facility</th><th className="num">{x.by} base</th><th className="num">{x.cy} path</th><th className="num">{x.cy} projected</th><th className="num">Gap</th><th className="ctr">Status</th></tr></thead>
          <tbody>{rows.map((r) => { const [l, c] = st(r.P, r.tg), gap = r.P - r.tg; return (
            <tr key={r.fc.id}><td><b>{r.fc.name}</b></td><td className="num">{fmt0(r.B)}</td><td className="num">{fmt0(r.tg)}</td><td className="num"><b>{fmt0(r.P)}</b></td>
              <td className="num" style={{ color: gap > 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 600 }}>{gap > 0 ? '+' : '−'}{fmt0(Math.abs(gap))} t</td><td>{r.B ? <span className={`chip ${c}`}>{l}</span> : <span className="muted">no base year data</span>}</td></tr>); })}</tbody></table></div>
      </section>
    </>);
}

function ImportPanel({ C, close }: { C: Ctx; close: () => void }) {
  const { x, reload } = C;
  const { toast } = useApp();
  const [tpl, setTpl] = useState('nt15'), [yr, setYr] = useState(x.T.year >= x.by + 5 ? x.T.year : x.by + 5);
  const T = SBTI_TPL.find((s) => s.id === tpl)!, n = yr - x.by;
  return (
    <section className="card tacard" style={{ borderColor: 'var(--primary)' }}>
      <div className="row"><h2>Import SBTi template</h2><span className="grow" /><button className="btn sm ghost" onClick={close}>Close</button></div>
      <div className="tplgrid">{SBTI_TPL.map((s) => <button key={s.id} className={`gcard${tpl === s.id ? ' on' : ''}`} onClick={() => setTpl(s.id)}><b>{s.n}</b><span className="muted" style={{ fontSize: 12.5 }}>{s.d}</span></button>)}</div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <label className="field"><span>Target year</span><select className="input" value={yr} onChange={(e) => setYr(Number(e.target.value))}>{[5, 7, 8, 10].map((k) => x.by + k).map((y) => <option key={y}>{y}</option>)}</select></label>
        <div className="soft grow" style={{ flexDirection: 'row' }}>Result: Scope 1+2 −{fmt(Math.min(90, T.rate12 * n), 0)}% and Scope 3 −{fmt(Math.min(90, T.rate3 * n), 0)}% by {yr} from {x.by}{tpl === 'nz' ? '; long-term −90% all scopes by 2050' : ''}{tpl === 'int' ? '; plus 67% supplier-engagement objective' : ''}.</div>
        <button className="btn p" onClick={async () => { try { const r = await api.applyTemplate(tpl, yr); toast(`Template applied — Scope 1+2 −${r.s12}%, Scope 3 −${r.s3}% by ${r.year}`); close(); reload(); } catch (e) { toast((e as Error).message); } }}>Apply template</button>
      </div>
      <span className="muted small">Rates follow the SBTi Corporate Near-Term Criteria (linear absolute contraction). Applying sets the main targets and the target structure; you can adjust them under SBTi setup.</span>
    </section>);
}

// ------------------------------------------------------------------ SBTi setup --
function SbtiTab({ C }: { C: Ctx }) {
  const { t, x, reload } = C;
  const { toast } = useApp();
  const ed = t.canTarget;
  const [E, setE] = useState<Sbti & { year: number }>({ ...t.sbti, year: x.T.year });
  useEffect(() => { setE({ ...t.sbti, year: x.T.year }); }, [t, x.T.year]);
  const n = x.T.year - x.by, r12 = n ? x.T.s12 / n : 0, r3 = n ? x.T.s3 / n : 0, s3sh = x.base3 / (x.baseT || 1);
  const approvedShare = (() => { const ms = x.lastM; if (!ms || !C.d.rows.length) return 0; const tot = C.d.rows.reduce((a, r) => a + r.n, 0), ap = C.d.rows.reduce((a, r) => a + r.approved, 0); return tot ? ap / tot : 0; })();
  const checks: [boolean, string, string][] = [
    [r12 >= 4.2, 'Scope 1+2 ambition ≥ 4.2% a year (1.5 °C)', `${fmt(r12, 2)}% a year`],
    [t.sbti.cov12 >= 95, 'Scope 1+2 boundary covers ≥ 95% of emissions', `${t.sbti.cov12}%`],
    [s3sh < 0.4 || (x.T.s3 > 0 && t.sbti.cov3 >= 67), 'Scope 3 target covering ≥ 67% when Scope 3 ≥ 40% of total', `Scope 3 = ${Math.round(s3sh * 100)}% of total; coverage ${t.sbti.cov3}%`],
    [s3sh < 0.4 || r3 >= 2.5 || t.supplierCoverage >= 0.67, 'Scope 3 ambition ≥ 2.5% a year, or 67% supplier engagement', `${fmt(r3, 2)}% a year · supplier coverage ${Math.round(t.supplierCoverage * 100)}%`],
    [n >= 5 && n <= 10, 'Target year 5–10 years from submission', `${x.T.year} (${n} years from base)`],
    [x.by >= 2015, 'Base year no earlier than 2015', String(x.by)],
    [approvedShare >= 0.9, 'Inventory complete enough to submit (≥ 90% approved)', `${Math.round(approvedShare * 100)}%`],
  ];
  const inp = (k: keyof Sbti | 'year', l: string) => <label className="field"><span>{l}</span><input className="input" disabled={!ed} value={String(E[k] ?? '')} onChange={(e) => setE({ ...E, [k]: e.target.value } as typeof E)} /></label>;
  const sel = (k: keyof Sbti, l: string, opts: string[]) => <label className="field"><span>{l}</span><select className="input" disabled={!ed} value={String(E[k])} onChange={(e) => setE({ ...E, [k]: e.target.value })}>{[...new Set([String(E[k]), ...opts])].map((o) => <option key={o}>{o}</option>)}</select></label>;
  return (
    <div className="tagrid2">
      <section className="card tacard">
        <h2>Target structure</h2>
        <div className="formgrid">
          {sel('type', 'Target type', ['Near-term absolute reduction', 'Near-term intensity reduction', 'Near-term + net-zero', 'Near-term absolute (S1+2) + supplier engagement (S3)'])}
          <label className="field"><span>Base year</span><input className="input" disabled value={x.by} title="Set under Methodology & boundaries" /></label>
          {inp('scopes', 'Scopes')}
          {sel('ambition', 'Ambition', ['1.5 °C', 'Well-below 2 °C', '1.5 °C · net zero 2050'])}
          {inp('cov12', 'Scope 1+2 coverage %')}{inp('cov3', 'Scope 3 coverage %')}{inp('year', 'Target year')}{inp('growth', 'Business growth % a year (for projections)')}
          {sel('status', 'Validation status', ['Draft for submission', 'Committed (letter sent)', 'Submitted for validation', 'Validated', 'Expired / to renew'])}
        </div>
        <div className="row"><span className="muted small">Reductions: Scope 1+2 −{fmt(x.T.s12, 0)}%, Scope 3 −{fmt(x.T.s3, 0)}% (set on Target register).</span><span className="grow" />
          {ed && <button className="btn p" onClick={async () => {
            try {
              await api.saveTargets({ year: Number(E.year), sbti: { type: E.type, scopes: E.scopes, cov12: Number(E.cov12), cov3: Number(E.cov3), ambition: E.ambition, status: E.status, growth: Number(E.growth) } });
              toast('Saved'); reload();
            } catch (e) { toast((e as Error).message); }
          }}>Save</button>}</div>
      </section>
      <section className="card tacard">
        <h2>Readiness check against SBTi criteria</h2>
        {checks.map(([ok, nm, val]) => <div key={nm} className="hitem"><span className={`chip ${ok ? 'c-ok' : 'c-warn'}`}>{ok ? '✓ Meets' : '! Review'}</span><span style={{ flex: 1 }}><b>{nm}</b><small>{val}</small></span></div>)}
        <span className="muted small">Indicative check from your data; SBTi validates the submission.</span>
      </section>
    </div>);
}

// ------------------------------------------------------------------ scenarios --
function ScenCompare({ C }: { C: Ctx }) {
  const { t, x, acts, money, reload } = C;
  const { toast } = useApp();
  return (
    <section className="card tacard">
      <div className="row"><h2>Scenario comparison · {x.T.year}</h2><span className="grow" /><span className="muted small">Actions belong to scenarios in Action portfolio. NPV at 8% over each action’s life.</span></div>
      <div className="scrollx"><table className="t"><thead><tr><th>Scenario</th><th className="num">Actions</th><th className="num">Abatement t/yr</th><th className="num">{x.T.year} projected</th><th className="num">{x.T.year} target</th><th className="num">Gap</th><th className="num">Capex</th><th className="num">NPV</th><th /></tr></thead>
        <tbody>{t.scenarios.map((s) => { const st = scenStats(x, acts, s.id); return (
          <tr key={s.id} className={C.sid === s.id ? 'sel' : ''}><td><b>{s.name}</b></td><td className="num">{st.n}</td><td className="num">{fmt0(st.ab)}</td><td className="num">{fmt0(st.proj)}</td><td className="num">{fmt0(x.tgt(x.T.year))}</td>
            <td className="num" style={{ fontWeight: 700, color: st.gap > 0 ? 'var(--bad)' : 'var(--ok)' }}>{st.gap > 0 ? `+${fmt0(st.gap)} t` : 'met'}</td><td className="num">{money(st.capex, true)}</td><td className="num">{money(st.npv, true)}</td>
            <td className="nowrap"><button className="btn sm" onClick={() => { C.setSid(s.id); C.go('port'); }}>Edit actions</button>
              {!s.isDefault && t.canAct && <button className="btn sm ghost danger" onClick={async () => { try { await api.removeScenario(s.id); reload(); } catch (e) { toast((e as Error).message); } }}>Remove</button>}</td></tr>); })}</tbody></table></div>
    </section>);
}

const LEVERS: [string, string, number, number, string][] = [
  ['ren', 'Renewable electricity & cooling', 0, 100, 'Solar, PPAs or green tariffs replacing grid supply'], ['ev', 'Fleet electrified', 0, 100, 'Diesel and petrol vehicles moved to EVs (charging still counted)'],
  ['eff', 'Energy efficiency', 0, 40, 'Less energy and water used across sites'], ['refr', 'Refrigerant leaks cut', 0, 100, 'Leak detection, low-GWP gases'],
  ['div', 'Landfill waste diverted', 0, 100, 'Recycling and waste-to-energy'], ['growth', 'Business growth per year', -5, 10, 'Applies to every path'],
];
function ScenarioLab({ C }: { C: Ctx }) {
  const { t, x, reload } = C;
  const { toast } = useApp();
  const [L, setL] = useState<Record<string, number>>({ ren: 20, ev: 30, eff: 10, refr: 50, div: 30, growth: x.growth });
  const [name, setName] = useState('');
  const yrs = Array.from({ length: Math.max(2, x.T.year - x.cy + 1) }, (_, i) => x.cy + i);
  const apply = (f: number) => x.ann.reduce((a, { r, t: v }) => {
    let val = v;
    if (r.kind || r.cat === 'water_supply') val *= 1 - (f * L.eff!) / 100;
    if (r.cat === 'purchased_electricity') val *= 1 - (f * L.ren!) / 100;
    if (r.cat === 'mobile_combustion' && !/electric|bev\b/i.test(r.item)) val *= 1 - ((f * L.ev!) / 100) * 0.75;
    if (r.cat === 'fugitive') val *= 1 - (f * L.refr!) / 100;
    if (r.cat === 'waste_generated' && (r.route === 'landfill' || /landfill/i.test(r.item))) val *= 1 - ((f * L.div!) / 100) * 0.95;
    return a + val;
  }, 0);
  const g = (y: number) => Math.pow(1 + L.growth! / 100, y - x.cy);
  const bauP = yrs.map((y) => x.cur * g(y)), scP = yrs.map((y, i) => apply(i / (yrs.length - 1)) * g(y));
  const tgP = yrs.map((y) => x.baseT * (1 - (x.T.s12 / 100) * (y - x.by) / Math.max(1, x.T.year - x.by)));
  const end = scP[scP.length - 1]!, tEnd = tgP[tgP.length - 1]!;
  return (
    <>
      <span className="muted">{C.name} · {C.d.facilities.length} facilities · starts from {x.cy} approved data, annualised · levers phase in evenly to {x.T.year}</span>
      <div className="tagrid2">
        <section className="card tacard" style={{ gap: 14 }}>
          <h2>Levers</h2>
          {LEVERS.map(([k, l, mn, mx, hint]) => (
            <label key={k} className="lever"><div className="row"><b>{l}</b><span className="grow" /><b>{L[k]}%</b></div>
              <input type="range" min={mn} max={mx} value={L[k]} onChange={(e) => setL({ ...L, [k]: Number(e.target.value) })} /><span className="muted small">{hint}</span></label>))}
          {t.canAct && <div className="row"><input className="input grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this scenario" />
            <button className="btn" onClick={async () => { if (!name.trim()) { toast('Name the scenario.'); return; } try { await api.saveLevers({ name: name.trim(), levers: L, end: Math.round(end), year: x.T.year }); setName(''); toast('Saved'); reload(); } catch (e) { toast((e as Error).message); } }}>Save</button></div>}
        </section>
        <section className="card tacard">
          <h2>Path to {x.T.year}</h2>
          <Fit minH={240}>{(W, H) => {
            const pad = 50, mxv = Math.max(...bauP, ...tgP, 1) * 1.1, xx = (i: number) => pad + (i * (W - pad - 20)) / Math.max(1, yrs.length - 1), yy = (val: number) => H - 26 - (val / mxv) * (H - 46);
            const line = (arr: number[], c: string, dash?: boolean) => <polyline points={arr.map((val, i) => `${xx(i)},${yy(val)}`).join(' ')} fill="none" stroke={c} strokeWidth="2.5" strokeDasharray={dash ? '6 4' : undefined} />;
            return <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Scenario paths">
              {[0, 0.5, 1].map((tt) => { const val = (mxv / 1.1) * tt; return <g key={tt}><line x1={pad} x2={W - 10} y1={yy(val)} y2={yy(val)} stroke="var(--line)" /><text x={pad - 6} y={yy(val) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">{kt(val)}</text></g>; })}
              {line(bauP, 'var(--muted)', true)}{line(tgP, 'var(--s3)', true)}{line(scP, 'var(--primary)')}
              {yrs.map((y, i) => <text key={y} x={xx(i)} y={H - 7} fontSize="12" textAnchor="middle" fill="var(--muted)">{y}</text>)}</svg>;
          }}</Fit>
          <div className="row lgd"><span><i className="ln" style={{ borderColor: 'var(--primary)' }} />This scenario</span><span><i className="ln dash" style={{ borderColor: 'var(--s3)' }} />Target path</span><span><i className="ln dash" style={{ borderColor: 'var(--muted)' }} />Business as usual</span></div>
          <div className="soft4">{[[`${x.cy} annualised`, `${fmt0(x.cur)} t`], [`${x.T.year} with levers`, `${fmt0(end)} t`], [`${x.T.year} target`, `${fmt0(tEnd)} t`], ['Gap', `${end > tEnd ? '+' : '−'}${fmt0(Math.abs(end - tEnd))} t`]].map(([l, val], i) => (
            <div key={l} className="soft"><span className="muted small">{l}</span><b style={{ fontSize: 21, color: i === 3 ? (end > tEnd ? 'var(--bad)' : 'var(--ok)') : 'var(--fg)' }}>{val}</b></div>))}</div>
          <span className="muted small">Target path uses your Scope 1+2 percentage on total emissions for a simple comparison. Refine per scope on Target register.</span>
        </section>
      </div>
      {t.levers.length > 0 && (
        <section className="card tacard"><h2>Saved scenarios</h2>
          {t.levers.map((s) => (
            <div key={s.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}><b>{s.name}</b>
              <span className="muted small">renewables {s.levers.ren}% · EVs {s.levers.ev}% · efficiency {s.levers.eff}% · refrigerants {s.levers.refr}% · diversion {s.levers.div}% · growth {s.levers.growth}%</span><span className="grow" />
              <b>{fmt0(s.end)} t in {s.year}</b><button className="btn sm" onClick={() => setL({ ...s.levers })}>Load</button>
              {t.canAct && <button className="btn sm ghost danger" onClick={async () => { await api.removeLevers(s.id).catch(() => {}); reload(); }}>✕</button>}</div>))}
        </section>)}
    </>);
}

// ------------------------------------------------------------------ action portfolio --
function Portfolio({ C }: { C: Ctx }) {
  const { t, x, acts, sid, reload } = C;
  const { toast } = useApp();
  const [lf, setLf] = useState<'all' | 'sel' | 'excl'>('all'), [cf, setCf] = useState('All');
  const inS = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded), ab = inS.reduce((s, a) => s + a.abate, 0);
  const need = x.cur * Math.pow(1 + x.growth / 100, x.T.year - x.cy) - x.tgt(x.T.year);
  const lib = ACT_LIB.map((it) => { const ex = acts.find((a) => a.lib === it.code) ?? null; return { it, ex, abt: ex ? ex.abate : libAbate(it, x) }; })
    .filter((r) => (cf === 'All' || r.it.cat === cf) && (lf === 'all' || (lf === 'sel' ? r.ex?.scenarioIds.includes(sid) : r.ex?.excluded)));
  const custom = acts.filter((a) => !a.lib && (cf === 'All' || a.cat === cf) && (lf === 'all' || (lf === 'sel' ? a.scenarioIds.includes(sid) : a.excluded)));
  const toggle = async (a: RAction) => { try { await api.updateAction(a.id, { scenarioIds: a.scenarioIds.includes(sid) ? a.scenarioIds.filter((s) => s !== sid) : [...a.scenarioIds, sid] }); reload(); } catch (e) { toast((e as Error).message); } };
  const pick = async (it: (typeof ACT_LIB)[number], ex: RAction | null) => {
    if (ex) { await toggle(ex); return; }
    const abate = Math.round(libAbate(it, x));
    try {
      await api.addAction({ lib: it.code, name: it.name, cat: it.cat, scopes: it.scopes, kpi: it.kpi, objVal: it.objVal, start: x.cy + it.start, end: x.cy + it.end, abate, capex: Math.round(abate * it.capexPerT), saving: Math.round(abate * it.savingPerT), life: 10, status: 'Idea', scenarioIds: [sid] });
      reload();
    } catch (e) { toast((e as Error).message); }
  };
  const scName = t.scenarios.find((s) => s.id === sid)?.name ?? '';
  const chips = (sc: number[]) => sc.map((s) => <span key={s} className={`codechip s${s}`}>{s}</span>);
  return (
    <>
      <div className="hk">
        <section className="card kc"><span className="muted">Scenario</span><span className="v" style={{ fontSize: 18 }}>{scName}</span></section>
        <section className="card kc"><span className="muted">Selected actions</span><span className="v">{inS.length}</span><span className="ks">in this scenario</span></section>
        <section className="card kc"><span className="muted">Potential reduction</span><span className="v">{fmt0(ab)} t/yr</span><span className="ks">{x.cur ? `${Math.round((ab / x.cur) * 100)}% of current emissions` : ''}</span></section>
        <section className="card kc"><span className="muted">Needed for {x.T.year}</span><span className="v">{fmt0(Math.max(0, need))} t/yr</span><span className="ks">{ab >= need ? '✓ covered by this scenario' : `${fmt0(need - ab)} t/yr still to find`}</span></section>
      </div>
      <section className="card tacard">
        <div className="row" style={{ gap: 8 }}>
          <ScenPick C={C} />
          <div className="seg">{([['all', 'All actions'], ['sel', 'Selected'], ['excl', 'Excluded']] as const).map(([k, n]) => <button key={k} className={lf === k ? 'on' : ''} onClick={() => setLf(k)}>{n}</button>)}</div>
          <select className="input" style={{ width: 'auto' }} aria-label="Category" value={cf} onChange={(e) => setCf(e.target.value)}>{['All', ...ACT_CATS].map((c) => <option key={c}>{c}</option>)}</select>
          <span className="grow" />{t.canAct && <button className="btn" onClick={() => C.open('new')}>+ Custom action</button>}
        </div>
        <div className="scrollx"><table className="t tatable"><thead><tr><th>Category</th><th>Reduction action</th><th>Scopes</th><th className="num">Reduction t/yr</th><th>Period</th><th className="num">Metric value</th><th className="ctr">Status</th><th /></tr></thead>
          <tbody>
            {lib.map(({ it, ex, abt }) => { const on = !!ex?.scenarioIds.includes(sid); return (
              <tr key={it.code} className={ex?.excluded ? 'excl' : ''}><td><span className="chip c-n">{it.cat}</span></td><td><b>{it.name}</b><div className="muted" style={{ fontSize: 12 }}>KPI: {ex?.kpi || it.kpi}</div></td><td className="nowrap">{chips(it.scopes)}</td>
                <td className="num"><b>{abt ? `−${fmt0(abt)}` : '—'}</b><div className="muted" style={{ fontSize: 11.5 }}>{x.cur && abt ? `${fmt(abt / x.cur * 100, 2)}%` : 'no data in scope'}</div></td>
                <td className="nowrap">{ex?.start ?? x.cy + it.start}–{ex?.end ?? x.cy + it.end}</td><td className="num">{ex?.objVal ?? it.objVal}%</td>
                <td>{ex ? <span className={`chip ${STATUS_CHIP[ex.status]}`}>{ex.status}</span> : <span className="muted">—</span>}</td>
                <td className="nowrap">{t.canAct && <><button className={`btn sm ${on ? '' : 'p'}`} onClick={() => void pick(it, ex)}>{on ? '✓ Selected' : 'Select'}</button>{ex && <button className="btn sm ghost" onClick={() => C.open(ex.id)}>Details</button>}</>}</td></tr>); })}
            {custom.map((a) => { const on = a.scenarioIds.includes(sid); return (
              <tr key={a.id} className={a.excluded ? 'excl' : ''}><td><span className="chip c-info">{a.cat}</span></td><td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>Custom · {C.facName(a.facilityId)}</div></td><td className="nowrap">{chips(a.scopes)}</td>
                <td className="num"><b>−{fmt0(a.abate)}</b></td><td className="nowrap">{a.start}–{a.end}</td><td className="num">{a.objVal != null ? `${a.objVal}%` : '—'}</td>
                <td><span className={`chip ${STATUS_CHIP[a.status]}`}>{a.status}</span></td>
                <td className="nowrap">{t.canAct && <><button className={`btn sm ${on ? '' : 'p'}`} onClick={() => void toggle(a)}>{on ? '✓ Selected' : 'Select'}</button><button className="btn sm ghost" onClick={() => C.open(a.id)}>Details</button></>}</td></tr>); })}
          </tbody></table></div>
        <span className="muted small">Reduction = current annual emissions of the activities the action affects × typical reduction × metric value (adoption). Library values are indicative; open Details to set your own KPI, timeline and costs.</span>
      </section>
    </>);
}

function ActionDrawer({ C, id, close }: { C: Ctx; id: string | 'new'; close: () => void }) {
  const { t, x, reload } = C;
  const { toast } = useApp();
  const a0 = id === 'new' ? null : C.acts.find((a) => a.id === id) ?? null;
  const [f, setF] = useState<ActionInput & { name: string }>(() => a0 ? { ...a0 } : { name: '', cat: 'Energy', scopes: [2], start: x.cy, end: x.cy + 2, status: 'Idea', life: 10, abate: 0, capex: 0, opex: 0, saving: 0, scenarioIds: [C.sid], facilityId: null });
  if (id !== 'new' && !a0) return null;
  const it = libItem(a0?.lib ?? null);
  const set = (k: keyof (ActionInput & { name: string }), v: unknown) => setF({ ...f, [k]: v });
  const n = (k: 'objVal' | 'start' | 'end' | 'abate' | 'capex' | 'opex' | 'saving' | 'life' | 'actual', l: string) => (
    <label className="field"><span>{l}</span><input className="input num" inputMode="decimal" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value === '' ? null : e.target.value)} /></label>);
  const txt = (k: 'kpi' | 'owner' | 'actualNote' | 'capexMeth' | 'opexMeth' | 'comment' | 'name', l: string, ph?: string) => (
    <label className="field"><span>{l}</span><input className="input" placeholder={ph} value={(f[k] as string | null) ?? ''} onChange={(e) => set(k, e.target.value)} /></label>);
  const recalc = it ? Math.round(libAbate(it, x, Number(f.objVal) || 0)) : null;
  const c = cbOf({ capex: Number(f.capex) || 0, opex: Number(f.opex) || 0, saving: Number(f.saving) || 0, life: Number(f.life) || 10, abate: Number(f.abate) || 0 });
  const save = async () => {
    const numK = ['objVal', 'start', 'end', 'abate', 'capex', 'opex', 'saving', 'life', 'actual'] as const;
    const b: ActionInput & { name: string } = { ...f };
    for (const k of numK) { const v = (f as Record<string, unknown>)[k]; (b as Record<string, unknown>)[k] = v === null || v === undefined || v === '' ? (k === 'objVal' || k === 'actual' ? null : undefined) : Number(String(v).replace(/,/g, '')); }
    // a library action: a new objective value (with the planned reduction left as it was) recalculates it
    if (a0 && it && Number(b.objVal) !== Number(a0.objVal) && Number(b.abate) === a0.abate && recalc !== null) b.abate = recalc;
    if (!b.name?.trim()) { toast('Name the action.'); return; }
    if (Number(b.end) < Number(b.start)) { toast('The end year is before the start year.'); return; }
    const body = { ...b } as Record<string, unknown>; delete body.id; delete body.facility; delete body.updatedAt;
    try {
      if (a0) await api.updateAction(a0.id, body as ActionInput); else await api.addAction({ ...(body as ActionInput), name: b.name.trim(), start: Number(b.start), end: Number(b.end) });
      toast('Saved'); close(); reload();
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <>
      <div className="sdrawerbg" onClick={close} />
      <aside className="sdrawer" role="dialog" aria-label="Action details">
        <div className="row"><span className="chip c-n">{f.cat || 'Action'}</span><span className="grow" /><button className="btn sm ghost" onClick={close}>Close ✕</button></div>
        <h2 style={{ fontSize: 19 }}>{a0 ? `Action quantification: ${a0.name}` : 'New action'}</h2>
        {it && <div className="note info">Max potential reduction at 100%: {fmt0(libAbate(it, x, 100))} t/yr</div>}
        <div className="formgrid">
          {!a0 && <>{txt('name', 'Action', 'e.g. Rooftop solar 450 kWp')}
            <label className="field"><span>Category</span><select className="input" value={f.cat} onChange={(e) => set('cat', e.target.value)}>{ACT_CATS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <label className="field"><span>Scopes</span><div className="row" style={{ gap: 8, height: 38 }}>{[1, 2, 3].map((s) => <label key={s} className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!f.scopes?.includes(s)} onChange={(e) => set('scopes', e.target.checked ? [...(f.scopes ?? []), s].sort() : (f.scopes ?? []).filter((z) => z !== s))} />{s}</label>)}</div></label></>}
          {txt('kpi', 'Following metric (KPI)')}{n('objVal', 'Objective value (%)')}{n('start', 'Start year')}{n('end', 'End year')}{txt('owner', 'Owner')}
          <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => set('status', e.target.value as ActStatus)}>{['Idea', 'Approved', 'In progress', 'Done'].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Facility</span><select className="input" value={f.facilityId ?? ''} onChange={(e) => set('facilityId', e.target.value || null)}><option value="">Company-wide</option>{C.d.facilities.map((fc) => <option key={fc.id} value={fc.id}>{fc.name}</option>)}</select></label>
          {n('abate', 'Planned reduction t CO₂e / yr')}
        </div>
        <b>Actual delivery</b>
        <div className="formgrid">{n('actual', 'Actual measured reduction t / yr')}{txt('actualNote', 'How it was measured', 'e.g. PV generation 640 MWh × grid factor')}</div>
        <b>Financial quantification ({t.currency})</b>
        <div className="formgrid">{n('capex', 'CapEx')}{n('opex', 'Annual OpEx')}{n('saving', 'Annual saving')}{n('life', 'Lifetime (years)')}{txt('capexMeth', 'CapEx methodology', 'e.g. 450 kWp × 3,500/kWp')}{txt('opexMeth', 'Saving / OpEx methodology', 'e.g. 680 MWh × 0.38/kWh')}</div>
        <div className="soft" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, fontSize: 13 }}><span>Payback <b>{c.pay !== null ? `${fmt(c.pay, 1)} yrs` : '—'}</b></span><span>ROI <b>{c.roi !== null ? `${fmt0(c.roi)}%` : '—'}</b></span><span>TCO <b>{C.money(c.tco)}</b></span><span>NPV 8% <b>{C.money(c.npv)}</b></span><span>{t.currency}/t <b>{c.cpt !== null ? fmt0(c.cpt) : '—'}</b></span></div>
        {txt('comment', 'Comment')}
        <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!f.excluded} onChange={(e) => set('excluded', e.target.checked)} /> Exclude from the plan (kept on the list, not counted)</label>
        <div className="row"><button className="btn p" onClick={() => void save()}>Save</button>
          <span className="muted small">{it ? `Changing the objective value recalculates the planned reduction: ${fmt0(recalc ?? 0)} t/yr` : ''}</span><span className="grow" />
          {a0 && <button className="btn ghost danger" onClick={async () => { try { await api.removeAction(a0.id); toast('Removed'); close(); reload(); } catch (e) { toast((e as Error).message); } }}>Remove</button>}</div>
      </aside>
    </>);
}

// ------------------------------------------------------------------ ROI & cost --
function CostBenefit({ C }: { C: Ctx }) {
  const { t, acts, sid, money } = C;
  const as = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded).map((a) => ({ a, cb: cbOf(a) })).sort((p, q) => (p.cb.cpt ?? 1e9) - (q.cb.cpt ?? 1e9));
  const tot = as.reduce((o, { cb }) => ({ capex: o.capex + cb.capex, opex: o.opex + cb.opex, sav: o.sav + cb.sav, ab: o.ab + cb.ab, npv: o.npv + cb.npv, tco: o.tco + cb.tco, netLife: o.netLife + cb.net * cb.life }), { capex: 0, opex: 0, sav: 0, ab: 0, npv: 0, tco: 0, netLife: 0 });
  const sc = t.scenarios.map((s) => {
    const cs = acts.filter((a) => a.scenarioIds.includes(s.id) && !a.excluded).map(cbOf), capex = cs.reduce((p, c) => p + c.capex, 0), netLife = cs.reduce((p, c) => p + c.net * c.life, 0);
    return { s, n: cs.length, ab: cs.reduce((p, c) => p + c.ab, 0), capex, opex: cs.reduce((p, c) => p + c.opex, 0), sav: cs.reduce((p, c) => p + c.sav, 0), npv: cs.reduce((p, c) => p + c.npv, 0), tco: cs.reduce((p, c) => p + c.tco, 0), roi: capex ? ((netLife - capex) / capex) * 100 : null };
  });
  return (
    <section className="card tacard">
      <div className="row"><div><h2>Cost-benefit analysis</h2><div className="muted small">Per action: CapEx, annual OpEx, annual saving, payback, ROI over its life, total cost of ownership (CapEx + OpEx × life), NPV at 8% and net cost per tonne. Sorted cheapest per tonne first.</div></div></div>
      <div><ScenPick C={C} /></div>
      <div className="scrollx"><table className="t"><thead><tr><th>Action</th><th className="num">t CO₂e / yr</th><th className="num">CapEx</th><th className="num">OpEx / yr</th><th className="num">Saving / yr</th><th className="num">Payback</th><th className="num">ROI (life)</th><th className="num">TCO</th><th className="num">NPV 8%</th><th className="num">{t.currency} / t</th><th /></tr></thead>
        <tbody>{as.map(({ a, cb }) => (
          <tr key={a.id}><td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.status} · {cb.life} yrs</div></td><td className="num">{fmt0(cb.ab)}</td><td className="num">{money(cb.capex)}</td><td className="num">{cb.opex ? money(cb.opex) : '—'}</td><td className="num">{money(cb.sav)}</td>
            <td className="num">{cb.pay !== null ? `${fmt(cb.pay, 1)} yrs` : '—'}</td><td className="num" style={{ color: cb.roi !== null && cb.roi < 0 ? 'var(--bad)' : undefined }}>{cb.roi !== null ? `${fmt0(cb.roi)}%` : '—'}</td><td className="num">{money(cb.tco)}</td>
            <td className="num" style={{ color: cb.npv < 0 ? 'var(--bad)' : 'var(--ok)' }}>{money(cb.npv)}</td><td className="num"><b style={{ color: cb.cpt !== null && cb.cpt < 0 ? 'var(--ok)' : undefined }}>{cb.cpt !== null ? fmt0(cb.cpt) : '—'}</b></td>
            <td>{t.canAct && <button className="btn sm ghost" onClick={() => C.open(a.id)}>Edit</button>}</td></tr>))}
          {!as.length ? <tr><td colSpan={11} className="muted">No actions selected in this scenario.</td></tr> : (
            <tr className="totrow"><td><b>Scenario total</b></td><td className="num"><b>{fmt0(tot.ab)}</b></td><td className="num"><b>{money(tot.capex)}</b></td><td className="num"><b>{money(tot.opex)}</b></td><td className="num"><b>{money(tot.sav)}</b></td><td />
              <td className="num"><b>{tot.capex ? `${fmt0(((tot.netLife - tot.capex) / tot.capex) * 100)}%` : '—'}</b></td><td className="num"><b>{money(tot.tco)}</b></td><td className="num"><b>{money(tot.npv)}</b></td><td /><td /></tr>)}</tbody></table></div>
      <h2 style={{ fontSize: 15 }}>Compare scenarios</h2>
      <div className="scrollx"><table className="t"><thead><tr><th>Scenario</th><th className="num">Actions</th><th className="num">t CO₂e / yr</th><th className="num">CapEx</th><th className="num">OpEx / yr</th><th className="num">Saving / yr</th><th className="num">ROI</th><th className="num">TCO</th><th className="num">NPV 8%</th></tr></thead>
        <tbody>{sc.map((r) => <tr key={r.s.id} className={r.s.id === sid ? 'totrow' : ''}><td><b>{r.s.name}</b></td><td className="num">{r.n}</td><td className="num">{fmt0(r.ab)}</td><td className="num">{money(r.capex)}</td><td className="num">{money(r.opex)}</td><td className="num">{money(r.sav)}</td><td className="num">{r.roi !== null ? `${fmt0(r.roi)}%` : '—'}</td><td className="num">{money(r.tco)}</td><td className="num">{money(r.npv)}</td></tr>)}</tbody></table></div>
      <span className="muted small">ROI = (net annual benefit × life − CapEx) ÷ CapEx. Net cost per tonne = (TCO − lifetime savings) ÷ lifetime tonnes; negative means the action pays for itself. Add OpEx and lifetime under each action’s Edit.</span>
    </section>);
}

function ActionsRoi({ C }: { C: Ctx }) {
  const { t, acts, money } = C;
  const live = acts.filter((a) => !a.excluded);
  const cpt = (a: RAction) => (a.abate ? (a.capex / (a.life || 10) - a.saving) / a.abate : null);
  const tot = { capex: live.reduce((s, a) => s + a.capex, 0), sav: live.reduce((s, a) => s + a.saving, 0), ab: live.reduce((s, a) => s + a.abate, 0), done: live.filter((a) => a.status === 'Done').reduce((s, a) => s + a.abate, 0) };
  const macc = live.filter((a) => cpt(a) !== null).sort((a, b) => cpt(a)! - cpt(b)!);
  return (
    <>
      <div className="row"><span className="muted">Reduction projects with cost, savings and tonnes. Cost per tonne = (capex ÷ life − annual saving) ÷ tonnes a year.</span><span className="grow" />{t.canAct && <button className="btn p" onClick={() => C.open('new')}>+ Add action</button>}</div>
      <div className="hk">
        <section className="card kc"><span className="muted">Abatement identified</span><span className="v">{fmt0(tot.ab)} t/yr</span></section>
        <section className="card kc"><span className="muted">Delivered (done)</span><span className="v">{fmt0(tot.done)} t/yr</span></section>
        <section className="card kc"><span className="muted">Capex</span><span className="v">{money(tot.capex, true)}</span></section>
        <section className="card kc"><span className="muted">Annual savings</span><span className="v">{money(tot.sav, true)}</span><span className="ks">{tot.sav ? `simple payback ${fmt(tot.capex / tot.sav, 1)} yrs` : ''}</span></section>
      </div>
      {macc.length > 0 && (
        <section className="card tacard"><div className="row"><h2>Marginal abatement cost curve</h2><span className="grow" /><span className="muted small">bar width = tonnes a year · height = {t.currency} per tonne · below the line pays for itself</span></div>
          <Fit minH={230}>{(W, H) => {
            const pad = 56, totAb = macc.reduce((s, a) => s + a.abate, 0) || 1, mx = Math.max(1, ...macc.map((a) => Math.abs(cpt(a)!)));
            let x0 = pad;
            return <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Marginal abatement cost curve">
              <line x1={pad} x2={W - 10} y1={H / 2} y2={H / 2} stroke="var(--fg2)" />
              <text x={pad - 6} y={H / 2 + 4} fontSize="12" textAnchor="end" fill="var(--muted)">0</text><text x={pad - 6} y={16} fontSize="12" textAnchor="end" fill="var(--muted)">+{fmt0(mx)}</text><text x={pad - 6} y={H - 8} fontSize="12" textAnchor="end" fill="var(--muted)">−{fmt0(mx)}</text>
              {macc.map((a) => { const w = (a.abate / totAb) * (W - pad - 10), cv = cpt(a)!, h = (Math.abs(cv) / mx) * (H / 2 - 14), r = <rect key={a.id} x={x0} y={cv < 0 ? H / 2 : H / 2 - h} width={Math.max(1, w - 2)} height={h} rx="2" fill={cv < 0 ? 'var(--primary)' : 'var(--s3)'}><title>{`${a.name}: ${fmt0(cv)} ${t.currency}/t, ${fmt0(a.abate)} t/yr`}</title></rect>; x0 += w; return r; })}
            </svg>;
          }}</Fit>
        </section>)}
      <section className="card tacard">
        <div className="scrollx"><table className="t"><thead><tr><th>Action</th><th>Category</th><th className="num">Capex</th><th className="num">Saving / yr</th><th className="num">t / yr</th><th className="num">Payback</th><th className="num">{t.currency} / t</th><th className="ctr">Status</th><th /></tr></thead>
          <tbody>{acts.map((a) => { const cv = cpt(a); return (
            <tr key={a.id} className={a.excluded ? 'excl' : ''}><td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{C.facName(a.facilityId)}{a.owner ? ` · ${a.owner}` : ''}</div></td><td>{a.cat}</td><td className="num">{fmt0(a.capex)}</td><td className="num">{fmt0(a.saving)}</td><td className="num"><b>{fmt0(a.abate)}</b></td>
              <td className="num">{a.saving > 0 ? `${fmt(a.capex / a.saving, 1)} yrs` : '—'}</td><td className="num" style={{ color: cv !== null && cv < 0 ? 'var(--ok)' : undefined, fontWeight: 600 }}>{cv === null ? '—' : fmt0(cv)}</td>
              <td><span className={`chip ${STATUS_CHIP[a.status]}`}>{a.status}</span></td><td>{t.canAct && <button className="btn sm" onClick={() => C.open(a.id)}>Edit</button>}</td></tr>); })}
            {!acts.length && <tr><td colSpan={9} className="muted">No actions yet.</td></tr>}</tbody></table></div>
      </section>
    </>);
}

// ------------------------------------------------------------------ tracking --
function NzChart({ C }: { C: Ctx }) {
  const { t, x, acts, sid, reload } = C;
  const { toast } = useApp();
  const [nz, setNz] = useState({ y: String(t.sbti.nzYear), r: String(t.sbti.resid) });
  const Y0 = x.by, Y1 = Number(t.sbti.nzYear) || 2040, res = Number(t.sbti.resid) || 10;
  const as = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded);
  const bau = (y: number) => (y < x.cy ? (y === Y0 ? x.baseT : x.cur) : x.cur * Math.pow(1 + x.growth / 100, y - x.cy));
  const scen = (y: number) => (y <= x.cy ? bau(y) : Math.max(0, bau(y) - as.reduce((s, a) => s + a.abate * frac(a, y), 0)));
  const resid = (x.baseT * res) / 100, tAt = x.tgt(x.T.year);
  const tgt = (y: number) => (y <= x.T.year ? x.tgt(y) : tAt + ((resid - tAt) * (y - x.T.year)) / Math.max(1, Y1 - x.T.year));
  const ys = Array.from({ length: Math.max(2, Y1 - Y0 + 1) }, (_, i) => Y0 + i), gap = scen(Y1) - resid;
  return (
    <section className="card tacard">
      <div className="row" style={{ alignItems: 'flex-start' }}><div className="grow"><h2>Net Zero {Y1} trajectory</h2><div className="muted small">Base year → near-term target ({x.T.year}) → Net Zero in {Y1} with at most {res}% residual emissions, neutralised by permanent removals. Scenario: {t.scenarios.find((s) => s.id === sid)?.name}.</div></div>
        <ScenPick C={C} />
        {t.canTarget && <><label className="row" style={{ gap: 6, fontSize: 12.5 }}>Net Zero year <input className="input num" style={{ width: 74 }} value={nz.y} onChange={(e) => setNz({ ...nz, y: e.target.value })} /></label>
          <label className="row" style={{ gap: 6, fontSize: 12.5 }}>Residual % <input className="input num" style={{ width: 60 }} value={nz.r} onChange={(e) => setNz({ ...nz, r: e.target.value })} /></label>
          <button className="btn sm" onClick={async () => { try { await api.saveTargets({ sbti: { nzYear: Number(nz.y), resid: Number(nz.r) } }); toast('Saved'); reload(); } catch (e) { toast((e as Error).message); } }}>Save</button></>}
      </div>
      <Fit minH={290}>{(W, H) => {
        const L = 56, R = 20, Tp = 18, B = 28, mx = Math.max(...ys.map(bau), x.baseT, 1) * 1.08;
        const xx = (y: number) => L + ((y - Y0) / Math.max(1, Y1 - Y0)) * (W - L - R), yy = (v: number) => Tp + (1 - v / mx) * (H - Tp - B);
        const path = (fn: (y: number) => number, from = Y0) => ys.filter((y) => y >= from).map((y, i) => `${i ? 'L' : 'M'}${xx(y).toFixed(1)} ${yy(fn(y)).toFixed(1)}`).join(' ');
        const lbl = { fontSize: 12.5, fill: 'var(--fg2)', fontWeight: 600, paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 4, strokeLinejoin: 'round' } as const;
        return <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Net Zero trajectory">
          {[0, 0.25, 0.5, 0.75, 1].map((g) => { const v = (mx / 1.08) * g; return <g key={g}><line x1={L} x2={W - R} y1={yy(v)} y2={yy(v)} stroke="var(--line)" /><text x={L - 6} y={yy(v) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">{kt(v)}</text></g>; })}
          {ys.filter((y) => (y - Y0) % 5 === 0 || y === Y1 || y === x.T.year).map((y) => <text key={y} x={xx(y)} y={H - 8} fontSize="12" textAnchor="middle" fill="var(--muted)">{y}</text>)}
          <rect x={xx(Y1) - 6} y={yy(resid)} width="12" height={Math.max(0, yy(0) - yy(resid))} fill="var(--s3)" opacity=".35"><title>{`Residual ${fmt0(resid)} t to neutralise with removals`}</title></rect>
          <path d={path(bau, x.cy)} fill="none" stroke="#E39A5A" strokeWidth="2" strokeDasharray="5 4" />
          <path d={path(tgt)} fill="none" stroke="var(--s3)" strokeWidth="2.2" strokeDasharray="2 3" />
          <path d={path(scen, x.cy)} fill="none" stroke="var(--primary)" strokeWidth="2.6" />
          <circle cx={xx(Y0)} cy={yy(x.baseT)} r="4.5" fill="var(--fg)" /><circle cx={xx(x.cy)} cy={yy(x.cur)} r="4.5" fill="var(--fg)" />
          <text x={xx(x.cy) + 9} y={yy(x.cur) + 18} {...lbl}>{`${x.cy} run-rate ${fmt0(x.cur)} t`}</text>
          <circle cx={xx(x.T.year)} cy={yy(tAt)} r="4" fill="var(--s3)" /><text x={xx(x.T.year)} y={yy(tAt) + 18} textAnchor="middle" {...lbl}>{`${x.T.year} target`}</text>
          <text x={xx(Y1) - 14} y={yy(resid) - 14} textAnchor="end" {...lbl}>{`Net Zero ${Y1}: residual ${fmt0(resid)} t`}</text>
        </svg>;
      }}</Fit>
      <div className="row lgd"><span><i style={{ background: 'var(--fg)' }} />Actual (base year, {x.cy} run-rate)</span><span><i style={{ background: '#E39A5A' }} />Business as usual (+{x.growth}%/yr)</span><span><i style={{ background: 'var(--primary)' }} />With selected actions</span><span><i style={{ background: 'var(--s3)' }} />Target pathway</span></div>
      <div className="soft4">{[[`Emissions in ${Y1} with actions`, `${fmt0(scen(Y1))} t`, `vs ${fmt0(bau(Y1))} t business as usual`], ['Allowed residual', `${fmt0(resid)} t`, `${res}% of base year`], ['Gap to Net Zero', gap > 0 ? `${fmt0(gap)} t` : 'Closed', gap > 0 ? `more reductions needed by ${Y1}` : 'actions reach the residual'], ['Removals needed', `${fmt0(Math.min(resid, scen(Y1)))} t/yr`, 'to neutralise residual emissions']].map(([l, v, s]) => (
        <div key={l} className="soft"><span className="muted small">{l}</span><b style={{ fontSize: 19, color: l!.startsWith('Gap') && gap > 0 ? 'var(--bad)' : undefined }}>{v}</b><span className="muted small">{s}</span></div>))}</div>
    </section>);
}

function Projection({ C }: { C: Ctx }) {
  const { x, acts, sid } = C;
  const as = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded), yrs = Array.from({ length: Math.max(1, x.T.year - x.cy + 1) }, (_, i) => x.cy + i);
  const red = yrs.map((y, i) => as.reduce((s, a) => s + a.abate * (frac(a, y) - (i ? frac(a, yrs[i - 1]!) : 0)), 0));
  const growthAdd = x.cur * (Math.pow(1 + x.growth / 100, x.T.year - x.cy) - 1), remaining = x.cur + growthAdd - red.reduce((s, v) => s + v, 0), target = x.tgt(x.T.year);
  const bars: [string, number, 'base' | 'up' | 'down' | 'tgt'][] = [[`${x.cy} run-rate`, x.cur, 'base'], [`Growth to ${x.T.year}`, growthAdd, 'up'], ...yrs.map((y, i) => [String(y), -red[i]!, 'down'] as [string, number, 'down']), ['Remaining', remaining, 'base'], ['Target', target, 'tgt']];
  const need = Math.max(1, x.cur + growthAdd - target), pct = Math.min(999, ((x.cur + growthAdd - remaining) / need) * 100);
  return (
    <section className="card tacard">
      <div className="row"><div className="grow"><h2>Absolute decarbonisation projection (tCO₂e)</h2><div className="muted small">{x.cy} run-rate from approved data, business growth {x.growth}% a year, then reductions as actions ramp up over their period.</div></div><ScenPick C={C} /></div>
      <div className="row" style={{ gap: 12 }}><b>Reduction target: {fmt0(Math.max(0, x.cur + growthAdd - target))} t</b><div className="bar" style={{ flex: 1, maxWidth: 300, height: 9 }}><span style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? 'var(--primary)' : 'var(--s3)' }} /></div><b>{fmt0(pct)}%</b><span className="muted small">covered by this scenario</span></div>
      <Fit minH={270}>{(W, H) => {
        const pad = 56, bw = (W - pad) / bars.length, mx = Math.max(x.cur + growthAdd, target, 1) * 1.1, yy = (v: number) => H - 28 - (v / mx) * (H - 50);
        let run = 0;
        return <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Decarbonisation projection">
          {[0, 0.5, 1].map((g) => { const v = (mx / 1.1) * g; return <g key={g}><line x1={pad} x2={W} y1={yy(v)} y2={yy(v)} stroke="var(--line)" /><text x={pad - 6} y={yy(v) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">{kt(v)}</text></g>; })}
          {bars.map(([l, v, k], i) => {
            const w = Math.min(bw * 0.7, 90), bx = pad + i * bw + (bw - w) / 2; let y0: number, y1: number, col: string;
            if (k === 'base' || k === 'tgt') { y0 = 0; y1 = v; run = v; col = k === 'tgt' ? 'var(--s3)' : 'var(--s2)'; } else { y0 = run; y1 = run + v; run = y1; col = k === 'up' ? '#E39A5A' : 'var(--primary)'; }
            const top = Math.max(y0, y1), bot = Math.min(y0, y1);
            return <g key={l + i}><rect x={bx} y={yy(top)} width={w} height={Math.max(1, yy(bot) - yy(top))} rx="3" fill={col}><title>{`${l}: ${fmt0(v)} t`}</title></rect>
              <text x={bx + w / 2} y={yy(top) - 5} fontSize="12" textAnchor="middle" fill="var(--fg2)">{k === 'down' ? (v ? fmt0(v) : '') : fmt0(v)}</text>
              <text x={bx + w / 2} y={H - 8} fontSize="12.5" textAnchor="middle" fill="var(--muted)">{l.length > 14 ? `${l.slice(0, 13)}…` : l}</text></g>;
          })}</svg>;
      }}</Fit>
      <div className="row lgd"><span><i style={{ background: 'var(--s2)' }} />Emissions</span><span><i style={{ background: '#E39A5A' }} />Growth</span><span><i style={{ background: 'var(--primary)' }} />Reductions by year</span><span><i style={{ background: 'var(--s3)' }} />{x.T.year} target</span></div>
    </section>);
}

function Delivery({ C }: { C: Ctx }) {
  const { t, x, acts, sid } = C;
  const as = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded).sort((a, b) => a.start - b.start);
  return (
    <section className="card tacard"><h2>Delivery tracking</h2>
      <div className="scrollx"><table className="t"><thead><tr><th>#</th><th>Action</th><th>Period</th><th className="num">Planned t/yr</th><th className="num">Expected by {x.cy}</th><th>Owner</th><th className="ctr">Status</th><th /></tr></thead>
        <tbody>{as.map((a, i) => (
          <tr key={a.id}><td>{i + 1}</td><td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.cat}</div></td><td>{a.start}–{a.end}</td><td className="num">{fmt0(a.abate)}</td><td className="num">{fmt0(a.abate * frac(a, x.cy))}</td><td>{a.owner || '—'}</td>
            <td><span className={`chip ${STATUS_CHIP[a.status]}`}>{a.status}</span></td><td>{t.canAct && <button className="btn sm ghost" onClick={() => C.open(a.id)}>Edit</button>}</td></tr>))}
          {!as.length && <tr><td colSpan={8} className="muted">No actions in this scenario yet — select some in Action portfolio.</td></tr>}</tbody></table></div>
    </section>);
}

function ActualCard({ C }: { C: Ctx }) {
  const { t, x, acts, sid } = C;
  const as = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded && COMMITTED.includes(a.status));
  return (
    <section className="card tacard"><h2>Estimated vs actual reduction</h2>
      <div className="scrollx"><table className="t"><thead><tr><th>Action</th><th className="num">Planned t/yr</th><th className="num">Expected by {x.cy}</th><th className="num">Actual measured t/yr</th><th className="num">Variance</th><th>How measured</th><th /></tr></thead>
        <tbody>{as.map((a) => { const exp = a.abate * frac(a, x.cy), v = a.actual !== null && exp ? (a.actual / exp - 1) * 100 : null; return (
          <tr key={a.id}><td><b>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.status}</div></td><td className="num">{fmt0(a.abate)}</td><td className="num">{fmt0(exp)}</td><td className="num"><b>{a.actual !== null ? fmt0(a.actual) : '—'}</b></td>
            <td className="num" style={{ color: v === null ? undefined : v < -10 ? 'var(--bad)' : 'var(--ok)' }}>{v === null ? '—' : `${v >= 0 ? '+' : '−'}${fmt0(Math.abs(v))}%`}</td><td style={{ fontSize: 12.5 }}>{a.actualNote || ''}</td>
            <td>{t.canAct && <button className="btn sm ghost" onClick={() => C.open(a.id)}>Update</button>}</td></tr>); })}
          {!as.length && <tr><td colSpan={7} className="muted">No approved or delivering actions in this scenario.</td></tr>}</tbody></table></div>
      <span className="muted small">Actual = measured reduction against the action’s KPI (e.g. solar generation × grid factor, litres of diesel avoided × factor). Enter it under Update.</span>
    </section>);
}
