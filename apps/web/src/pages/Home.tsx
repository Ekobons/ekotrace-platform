/**
 * Home, as in the prototype (MOD13), one per role.
 *
 *  Super admin / admin   cycle strip (the month's data: due date, submissions in, overdue / escalated),
 *                        tiles (emissions with the change vs last year on complete months and the
 *                        scope split; Scope 1+2 vs the target path; data approved; reductions),
 *                        monthly emissions against last year and the target path, "Needs your
 *                        decision", facilities (tCO₂e, vs last year, the twelve months, this month's
 *                        data), biggest sources.
 *  One-user company      the month in three steps (enter, review and approve, report) and its checklist.
 *  Manager               approval queue (approve the clean ones at once), overdue at their sites.
 *  Data preparer         due date, done for the month, sent back, on-time record; the month's
 *                        checklist per facility; to fix (sent back, drafts, earlier gaps).
 *  Verifier              approved data, evidence, the largest approved entries to sample, readiness.
 *
 * A month's data is due on the company's due day of the next month (Methodology); reminders go
 * some days before, and it escalates some days after. "Required" = the categories each facility
 * reports (data this year or last year).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { api, ROLE_LABEL, type HomeData, type Role, type TargetsData } from '../lib/api';
import { Fit, MN, fmt, fmt0 } from '../components/DashCharts';
import { CONS, S, ViewBar, sum, useView, type Ctx, type Data, type Row } from '../components/ViewBar';

const ROLE_C: Record<string, string> = { super_admin: 'r-sa', admin: 'r-ad', manager: 'r-mg', preparer: 'r-dp', verifier: 'r-vf', platform_admin: 'r-op' };
export const RoleChip = ({ role }: { role: Role }) => <span className={`chip ${ROLE_C[role] ?? 'c-n'}`}><i className="rdot" />{ROLE_LABEL[role]}</span>;
const CAT_NAME: Record<string, string> = {
  stationary_combustion: 'Stationary combustion', mobile_combustion: 'Vehicles', fugitive: 'Refrigerants', waste: 'Waste', purchased_electricity: 'Electricity, heat & cooling',
  water: 'Water', business_travel: 'Business travel', employee_commuting: 'Employee commuting', purchased_goods: 'Purchases',
};
const catLink = (cat: string) => `/data/${cat === 'waste' ? 'waste_generated' : cat === 'water' ? 'water_supply' : cat}`;
const dayMs = 864e5;

type MSt = 'approved' | 'review' | 'partial' | 'missing' | 'future' | 'none';
type CSt = 'approved' | 'submitted' | 'draft' | 'returned' | 'missing';
type CalS = 'On time' | 'Late' | 'Overdue' | 'Escalated' | 'Due soon' | 'Upcoming' | 'Sent back';

/** Everything Home works out from the view (dashboard rows) and /api/home. */
function useHome(d: Data | null, c: Ctx | null, h: HomeData | null) {
  return useMemo(() => {
    if (!d || !c || !h) return null;
    const now = new Date(), y = d.year, nowY = now.getFullYear();
    const open = y < nowY ? 12 : y > nowY ? 0 : now.getMonth();       // months whose data can be due (before this month)
    const cm = Math.max(1, open);                                       // the cycle month: the last one
    const cellOf = (f: string, cat: string, m: number) => h.cells.find((x) => x.f === f && x.cat === cat && x.m === m);
    const catSt = (f: string, cat: string, m: number): CSt => {
      const x = cellOf(f, cat, m); if (!x) return 'missing';
      return x.rejected ? 'returned' : x.draft && !x.submitted && !x.approved ? 'draft' : x.submitted || x.draft ? 'submitted' : 'approved';
    };
    const monthSt = (f: HomeData['facilities'][number], m: number): MSt => {
      if (m > open) return 'future';
      if (!f.usual.length) return 'none';
      const sts = f.usual.map((k) => catSt(f.id, k, m));
      if (sts.every((x) => x === 'approved')) return 'approved';
      if (sts.every((x) => x === 'missing')) return 'missing';
      if (sts.every((x) => x === 'approved' || x === 'submitted')) return 'review';
      return 'partial';
    };
    // collection calendar: each facility × category it reports × month so far
    const items: { f: HomeData['facilities'][number]; cat: string; m: number; due: Date; st: CSt; s: CalS; days: number }[] = [];
    for (const f of h.facilities) for (let m = 1; m <= open; m++) for (const cat of f.usual) {
      const due = new Date(y, m, h.settings.dueDay, 23, 59), st = catSt(f.id, cat, m), days = Math.floor((now.getTime() - due.getTime()) / dayMs);
      const sub = cellOf(f.id, cat, m)?.sub;
      const s: CalS = st === 'approved' || st === 'submitted' ? (sub && new Date(sub) > due ? 'Late' : 'On time')
        : st === 'returned' ? (days > h.settings.escalateDays ? 'Escalated' : days > 0 ? 'Overdue' : 'Sent back')
        : days > h.settings.escalateDays ? 'Escalated' : days > 0 ? 'Overdue' : -days <= h.settings.remindDays ? 'Due soon' : 'Upcoming';
      items.push({ f, cat, m, due, st, s, days });
    }
    const cur = items.filter((i) => i.m === cm), due = cur.length ? cur[0]!.due : open ? new Date(y, cm, h.settings.dueDay, 23, 59) : null;
    const cyc = { cm, due, days: due ? Math.ceil((due.getTime() - now.getTime()) / dayMs) : null, done: cur.filter((i) => i.s === 'On time' || i.s === 'Late').length, n: cur.length,
      overdue: items.filter((i) => i.s === 'Overdue').length, esc: items.filter((i) => i.s === 'Escalated').length, items };
    // data approved: the share of required facility-category-months fully approved, months so far
    const req = items.length, appr = items.filter((i) => i.st === 'approved').length;
    const gaps = h.facilities.filter((f) => Array.from({ length: open }, (_, i) => monthSt(f, i + 1)).some((x) => x === 'missing' || x === 'partial')).length;
    // the target path: base-year months × the straight-line reduction to the target year
    const T = h.settings.target, base = h.settings.baseYear;
    const yrs = base ? y - base : 0, span = base ? Math.max(1, T.year - base) : 1;
    const k12 = 1 - (T.s12 / 100) * yrs / span, k3 = 1 - (T.s3 / 100) * yrs / span;
    const bm = (m: number) => d.baseMonthly.find((x) => x.m === m) ?? { s1: 0, s2: 0, s3: 0 };
    const pathM = (m: number) => { const b = bm(m); return (b.s1 + b.s2) * k12 + b.s3 * k3; };
    const cmFull = c.months.filter((m) => c.full(m));
    const useM = cmFull.length ? cmFull : c.months;
    const s12 = sum(c.cur.filter((r) => useM.includes(r.m)), (r) => r.s1 + r.s2);
    const path12 = base && base < y && d.baseMonthly.length ? sum(useM, (m) => (bm(m).s1 + bm(m).s2) * k12) : 0;
    const vsPath = path12 ? (s12 / path12 - 1) * 100 : null;
    const compl = (m: number) => c.inShare(m);
    return { y, open, cm, catSt, monthSt, cyc, req, appr, comp: req ? appr / req : 1, gaps, T, base, k12, k3, pathM, s12, path12, vsPath, nFull: cmFull.length, compl, cellOf };
  }, [d, c, h]);
}
type H = NonNullable<ReturnType<typeof useHome>>;

export function Home() {
  const { me, role } = useApp();
  const v = useView();
  const { d, c, err, set, pend, name } = v;
  const [h, setH] = useState<HomeData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.home({ year: d?.year ?? v.year, node: v.group ? undefined : v.node || undefined, group: v.group || undefined }).then(setH).catch(() => setH(null)); }, [d?.year, v.node, v.group, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const x = useHome(d, c, h);
  const pick = (id: string) => set({ node: id, group: null });
  const hr = new Date().getHours(), first = me.user.name.replace(/^Dr\.?\s+/, '').split(' ')[0];
  const head = (
    <div className="hhead">
      <div><h1>Good {hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'}, {first}</h1>
        <div className="muted"><RoleChip role={role} />{h?.solo && <span className="chip c-n">only user</span>} <b>{name}</b> · {d ? `${d.year} · ${c?.periodLabel}` : ''} · {d?.facilities.length ?? 0} facilit{d?.facilities.length === 1 ? 'y' : 'ies'}{d ? ` · ${CONS[d.consolidation] ?? d.consolidation}` : ''}</div></div>
      <span className="grow" />
      <label className="row" style={{ gap: 6, fontSize: 12 }}><input type="checkbox" checked={pend} onChange={(e) => set({ pend: e.target.checked ? '1' : null })} /> Include entries waiting for approval</label>
    </div>);
  const body = !d || !c || !h || !x ? <div className="card empty">{err ?? 'Loading…'}</div>
    : role === 'preparer' ? <HomePreparer x={x} h={h} />
    : role === 'manager' ? <HomeManager x={x} h={h} d={d} c={c} reload={() => setTick((t) => t + 1)} pick={pick} />
    : role === 'verifier' ? <HomeVerifier x={x} h={h} d={d} c={c} />
    : h.solo ? <HomeSolo x={x} h={h} d={d} c={c} />
    : <HomeLeader x={x} h={h} d={d} c={c} pick={pick} />;
  return <div className="page" style={{ gap: 12 }}><ViewBar v={v} />{head}{body}</div>;
}

// ------------------------------------------------------------------ shared pieces --
const dueTxt = (x: H) => {
  const c = x.cyc; if (!c.due) return '—';
  const d = c.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return d + (c.days === null ? '' : c.days > 1 ? ` · in ${c.days} days` : c.days === 1 ? ' · tomorrow' : c.days === 0 ? ' · today' : ` · ${-c.days} days ago`);
};
function CycleStrip({ x, children }: { x: H; children?: ReactNode }) {
  const c = x.cyc, pct = c.n ? (c.done / c.n) * 100 : 100, late = c.days !== null && c.days < 0;
  return (
    <section className="cyc">
      <div className="cyc-l"><span className="lbl">{MN[c.cm - 1]} {x.y} data</span><b>Due {dueTxt(x)}</b></div>
      <div className="cyc-p"><div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}><span>{c.done} of {c.n} submissions in</span><b>{Math.round(pct)}%</b></div>
        <div className="bar" style={{ height: 8 }}><span style={{ width: `${pct}%`, background: late && pct < 100 ? 'var(--bad)' : 'var(--primary)' }} /></div></div>
      <div className="cyc-s">{c.overdue > 0 && <span className="chip c-bad">{c.overdue} overdue</span>}{c.esc > 0 && <span className="chip c-bad">{c.esc} escalated</span>}{!c.overdue && !c.esc && <span className="chip c-ok">Nothing overdue</span>}</div>
      <div className="row" style={{ gap: 6 }}>{children}</div>
    </section>);
}
/** Reductions delivered (as in the prototype): actions done, in the facilities viewed or company-wide. */
function Delivered({ d }: { d: Data }) {
  const [t, setT] = useState<TargetsData | null>(null);
  useEffect(() => { api.targets(d.year).then(setT).catch(() => setT(null)); }, [d.year]);
  const ids = new Set(d.facilities.map((f) => f.id));
  const done = (t?.actions ?? []).filter((a) => a.status === 'Done' && !a.excluded && (!a.facilityId || ids.has(a.facilityId)));
  const tn = done.reduce((s, a) => s + (a.actual ?? a.abate), 0), sav = done.reduce((s, a) => s + a.saving, 0);
  return <Tile lbl="Reductions delivered" v={<>{t ? fmt0(tn) : '—'} <small>t/yr</small></>} sub={t ? `${done.length} action${done.length === 1 ? '' : 's'} done · ${t.currency} ${fmt(sav / 1e6, 2)}m saved a year` : ''} to="/targets?ttab=track" />;
}
function Tile({ lbl, v, sub, to, col, bar, barCol }: { lbl: string; v: ReactNode; sub: ReactNode; to?: string; col?: string; bar?: number | [number, string][]; barCol?: string }) {
  const nav = useNavigate();
  return (
    <button className="card htile" disabled={!to} onClick={() => to && nav(to)}>
      <span className="muted">{lbl}</span><span className="hv" style={col ? { color: col } : undefined}>{v}</span>
      {bar !== undefined && <div className="bar" style={{ height: 6 }}>{Array.isArray(bar) ? bar.map(([w, cl], i) => <span key={i} style={{ width: `${w}%`, background: cl }} />) : <span style={{ width: `${Math.max(0, Math.min(100, bar))}%`, background: barCol ?? 'var(--primary)' }} />}</div>}
      <span className="ks">{sub}</span>
    </button>);
}
function EmTile({ c, d }: { c: Ctx; d: Data }) {
  const w = (v: number) => (c.total ? (v / c.total) * 100 : 0);
  return <Tile lbl={`Emissions · ${d.year} ${c.periodLabel}`} v={<>{fmt0(c.total)} <small>tCO₂e</small></>} to="/dashboards"
    bar={[[w(c.s[0]!), 'var(--s1)'], [w(c.s[1]!), 'var(--s2)'], [w(c.s[2]!), 'var(--s3)']]}
    sub={<>{c.yoy !== null && <><b style={{ color: c.yoy > 0 ? 'var(--bad)' : 'var(--ok)' }}>{c.yoy > 0 ? '▲ +' : '▼ −'}{fmt(Math.abs(c.yoy), 1)}%</b> vs {d.cmpYear}, {c.nFull} complete month{c.nFull === 1 ? '' : 's'}<br /></>}S1 {fmt0(c.s[0]!)} · S2 {fmt0(c.s[1]!)} · S3 {fmt0(c.s[2]!)}</>} />;
}
function PathTile({ x }: { x: H }) {
  if (x.vsPath === null) return <Tile lbl="Target path" v="—" sub={x.base && x.y <= x.base ? `${x.y} is the base year: pick a later year` : 'Set the base year and targets under Methodology'} to="/methodology" />;
  const ok = x.vsPath <= 0;
  return <Tile lbl="Scope 1+2 vs target path" v={`${ok ? '' : '+'}${fmt(x.vsPath, 1)}%`} col={ok ? 'var(--ok)' : 'var(--bad)'} to="/kpis?tab=target"
    sub={ok ? <><span className="chip c-ok">On track</span> {fmt0(x.path12 - x.s12)} t below the {x.T.year} path · {x.nFull} complete months</>
      : <><span className="chip c-bad">Above path</span> {fmt0(x.s12 - x.path12)} t over · {x.nFull} complete months · target −{x.T.s12}% by {x.T.year}</>} />;
}

/** Monthly emissions by scope; grey line = same month last year; amber dashed = target path. */
function TrendCard({ x, d, c, span }: { x: H; d: Data; c: Ctx; span?: number }) {
  const L = 48, B = 26, Tp = 12;
  const rows = MN.map((lbl, i) => {
    const m = i + 1, rs = d.rows.filter((r) => r.m === m), v = S.map((f) => sum(rs, f)), tot = v[0]! + v[1]! + v[2]!;
    const pm = d.prevMonthly.find((p) => p.m === m), last = pm ? pm.s1 + pm.s2 + pm.s3 : 0;
    const open = m <= x.open, cpl = open ? x.compl(m) : null;
    return { m, i, lbl, v, tot, last, path: x.base && x.base < x.y ? x.pathM(m) : null, open, cpl };
  });
  const closed = rows.filter((r) => r.open && (r.cpl ?? 0) >= 0.999 && r.tot && r.path !== null), below = closed.filter((r) => r.tot <= (r.path ?? 0)).length;
  const mx = Math.max(1, ...rows.map((r) => Math.max(r.tot, r.last, r.path ?? 0))) * 1.08;
  const draw = (W: number, H0: number) => { const bw = (W - L) / 12, yy = (val: number) => Tp + (1 - val / mx) * (H0 - Tp - B);
  const line = (k: 'last' | 'path') => rows.filter((r) => r[k] !== null && (k !== 'last' || d.prevMonthly.length)).map((r) => `${(L + r.i * bw + bw / 2).toFixed(1)},${yy(r[k] as number).toFixed(1)}`).join(' ');
  return (
      <svg viewBox={`0 0 ${W} ${H0}`} width={W} height={H0} role="img" aria-label="Monthly emissions against last year and the target path">
        {[0, 1, 2, 3, 4].map((g) => { const val = (mx / 1.08) * g / 4; return <g key={g}><line x1={L} x2={W} y1={yy(val)} y2={yy(val)} stroke="var(--line)" /><text x={L - 6} y={yy(val) + 4} fontSize="12" textAnchor="end" fill="var(--muted)">{val >= 1000 ? `${fmt(val / 1000, 1)}k` : fmt0(val)}</text></g>; })}
        {rows.map((r) => {
          const w = Math.min(bw * 0.6, 64), bx = L + r.i * bw + (bw - w) / 2, op = r.open && (r.cpl ?? 1) < 0.999 ? 0.45 : 1; let acc = 0;
          return (
            <g key={r.m}>
              {r.v.map((val, k) => { const hh = (val / mx) * (H0 - Tp - B); if (hh <= 0) return null; const yv = yy(0) - acc - hh; acc += hh; return <rect key={k} x={bx} y={yv} width={w} height={hh} fill={`var(--s${k + 1})`} opacity={op}><title>{`${r.lbl} · Scope ${k + 1}: ${fmt0(val)} t`}</title></rect>; })}
              {r.open && (r.cpl ?? 1) < 0.999 && <text x={bx + w / 2} y={yy(r.tot) - 6} fontSize="11.5" textAnchor="middle" fill="var(--warn)">{r.tot ? `${Math.round((r.cpl ?? 0) * 100)}% in` : 'due'}</text>}
              <text x={bx + w / 2} y={H0 - 7} fontSize="12.5" textAnchor="middle" fill={r.open ? 'var(--fg2)' : 'var(--muted)'}>{r.lbl}</text>
              <rect x={L + r.i * bw} y={Tp} width={bw} height={H0 - Tp - B} fill="transparent"><title>{`${r.lbl} ${x.y}: ${r.tot ? `${fmt0(r.tot)} t` : 'no data yet'} · ${r.lbl} ${d.cmpYear}: ${fmt0(r.last)} t${r.path !== null ? ` · target path: ${fmt0(r.path)} t` : ''}${r.open ? ` · data in ${Math.round((r.cpl ?? 0) * 100)}%` : ''}`}</title></rect>
            </g>);
        })}
        {d.prevMonthly.length > 0 && <polyline points={line('last')} fill="none" stroke="var(--muted)" strokeWidth="2" />}
        {rows.some((r) => r.path !== null) && <polyline points={line('path')} fill="none" stroke="#D99A1E" strokeWidth="2.4" strokeDasharray="6 4" />}
      </svg>); };
  const msg = closed.length ? `${below} of ${closed.length} complete months at or below the target path` : 'No complete months yet';
  return (
    <section className="card hcard2" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="row"><div><h2>Monthly emissions</h2><div className="muted" style={{ fontSize: 12 }}>Is each month below the path to the target? Pale bars are months still being filled in.</div></div><span className="grow" />
        <span className={`chip ${closed.length && below === closed.length ? 'c-ok' : below >= closed.length / 2 && closed.length ? 'c-warn' : closed.length ? 'c-bad' : 'c-warn'}`}>{msg}</span><Link className="btn sm ghost" to="/dashboards">Dashboards →</Link></div>
      <Fit minH={280}>{draw}</Fit>
      <div className="row lgd"><span><i style={{ background: 'var(--s1)' }} />Scope 1</span><span><i style={{ background: 'var(--s2)' }} />Scope 2</span><span><i style={{ background: 'var(--s3)' }} />Scope 3</span>
        <span><i className="ln" style={{ borderColor: 'var(--muted)' }} />Same month {d.cmpYear}</span><span><i className="ln dash" style={{ borderColor: '#D99A1E' }} />Target path {x.T.year}</span>
        {c.cmpOn ? null : <span className="muted">no {d.cmpYear} data to compare</span>}</div>
    </section>);
}

const SHADE = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
function Hotspots({ c, n = 5 }: { c: Ctx; n?: number }) {
  const g = new Map<string, { t: number; sc: number }>();
  for (const r of c.cur) {
    const k = (r.cat === 'purchased_goods' || r.cat === 'capital_goods') && r.grp ? r.grp.split(' › ')[0]! : r.item;
    const vals = [r.s1, r.s2, r.s3 + r.s33], t = vals[0]! + vals[1]! + vals[2]!; if (!t) continue;
    const o = g.get(k) ?? { t: 0, sc: vals.indexOf(Math.max(...vals)) + 1 }; o.t += t; g.set(k, o);
  }
  const tot = c.total || 1, top = [...g.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, n);
  return (
    <section className="card hcard2"><div className="row"><h2>Biggest sources</h2><span className="grow" /><Link className="btn sm ghost" to="/dashboards?tab=scopes">Dashboards →</Link></div>
      {top.length ? top.map(([k, o]) => <div key={k} className="hs"><span className="nm" title={k}>{k}</span><span className="bar" style={{ height: 7 }}><span style={{ width: `${(o.t / top[0]![1].t) * 100}%`, background: SHADE[o.sc - 1] }} /></span><b>{Math.round((o.t / tot) * 100)}%</b></div>)
        : <span className="muted" style={{ fontSize: 13 }}>No approved data in this period.</span>}
      {top.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Top {top.length} = {Math.round((sum(top, (t) => t[1].t) / tot) * 100)}% of the total — reduction effort pays most here.</div>}
    </section>);
}

function MonthStrip({ x, f }: { x: H; f: HomeData['facilities'][number] }) {
  const LBL: Record<MSt, string> = { approved: 'Approved', review: 'In review', partial: 'Partial', missing: 'Missing', future: 'Future', none: 'Nothing reported' };
  return <span className="mstrip">{MN.map((m, i) => { const st = x.monthSt(f, i + 1); return <span key={m} className={`pcell ${st}`} title={`${m} · ${LBL[st]}`} />; })}</span>;
}
function FacLeague({ x, h, d, c, n = 8, span, pick }: { x: H; h: HomeData; d: Data; c: Ctx; n?: number; span?: number; pick: (id: string) => void }) {
  const fm = c.nFull ? c.months.filter((m) => c.full(m)) : c.months;
  const rows = h.facilities.map((f) => {
    const t = sum(c.cur.filter((r) => r.f === f.id), (r) => r.s1 + r.s2 + r.s3 + r.s33);
    const tc = sum(d.rows.filter((r) => r.f === f.id && fm.includes(r.m)), (r) => r.s1 + r.s2 + r.s3 + r.s33), b = sum(d.prevRows.filter((r) => r.f === f.id && fm.includes(r.m)), (r) => r.s1 + r.s2 + r.s3 + r.s33);
    const st = x.cyc.items.filter((i) => i.f.id === f.id && i.m === x.cyc.cm), done = st.filter((i) => i.s === 'On time' || i.s === 'Late').length;
    return { f, t, ch: b ? (tc / b - 1) * 100 : null, done, n: st.length,
      late: st.some((i) => i.s === 'Overdue' || i.s === 'Escalated'),
      earlier: new Set(x.cyc.items.filter((i) => i.f.id === f.id && i.m !== x.cyc.cm && (i.s === 'Overdue' || i.s === 'Escalated')).map((i) => i.m)).size };
  }).sort((a, b) => b.t - a.t);
  return (
    <section className="card hcard2" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="row"><h2>Facilities</h2><span className="grow" /><Link className="btn sm ghost" to="/kpis">KPI dashboard →</Link></div>
      <div className="scrollx"><table className="t ht"><thead><tr><th>Facility</th><th className="num">tCO₂e</th><th className="num">vs {d.cmpYear}</th><th>Months {x.y}</th><th>{MN[x.cyc.cm - 1]} data</th></tr></thead>
        <tbody>{rows.slice(0, n).map((r) => (
          <tr key={r.f.id} className="clk" onClick={() => pick(r.f.id)}>
            <td><b>{r.f.name}</b><div className="muted" style={{ fontSize: 11.5 }}>{r.f.type ?? 'Facility'}{r.f.manager ? ` · ${r.f.manager}` : ''}</div></td>
            <td className="num"><b>{fmt0(r.t)}</b></td>
            <td className="num" style={{ color: r.ch === null ? 'inherit' : r.ch > 0 ? 'var(--bad)' : 'var(--ok)' }}>{r.ch === null ? '—' : `${r.ch > 0 ? '+' : '−'}${fmt(Math.abs(r.ch), 0)}%`}</td>
            <td><MonthStrip x={x} f={r.f} /></td>
            <td className="nowrap">{r.late ? <span className="chip c-bad">Overdue</span> : r.n ? <span className={`chip ${r.done === r.n ? 'c-ok' : 'c-n'}`}>{r.done}/{r.n}</span> : <span className="muted small">—</span>}
              {r.earlier > 0 && <span className="chip c-warn" style={{ marginLeft: 4 }} title="earlier months with data not submitted after the due date">+{r.earlier} late month{r.earlier > 1 ? 's' : ''}</span>}</td>
          </tr>))}</tbody></table></div>
    </section>);
}

type Dec = [cls: string, kind: string, title: string, detail: string, to: string, cta: string];
function Decisions({ x, h, n = 6 }: { x: H; h: HomeData; n?: number }) {
  const { role } = useApp();
  const out: Dec[] = [];
  const now = Date.now();
  if (h.approvals.length) { const old = Math.max(0, ...h.approvals.map((a) => (a.at ? (now - new Date(a.at).getTime()) / dayMs : 0))); out.push(['c-warn', 'Approve', `${h.approvals.length} entr${h.approvals.length > 1 ? 'ies' : 'y'} waiting for you`, `oldest ${Math.floor(old)} days · ${h.approvals.filter((a) => a.warn).length} with warnings`, '/approvals', 'Review']); }
  if (x.cyc.esc) out.push(['c-bad', 'Escalated', `${x.cyc.esc} submission${x.cyc.esc > 1 ? 's' : ''} badly overdue`, `more than ${h.settings.escalateDays} days past the due date`, '/data/stationary_combustion', 'Chase']);
  if (x.cyc.overdue) out.push(['c-bad', 'Overdue', `${x.cyc.overdue} submission${x.cyc.overdue > 1 ? 's' : ''} past due`, `due on day ${h.settings.dueDay} of the next month`, '/data/stationary_combustion', 'Open']);
  if (h.batches.failed && role !== 'preparer') out.push(['c-bad', 'Integration', `${h.batches.failed} purchase file${h.batches.failed > 1 ? 's' : ''} failed`, 'read or calculation stopped', '/purchases', 'Retry']);
  if (h.batches.review && role !== 'preparer') out.push(['c-info', 'Batch', `${h.batches.review} purchase batch${h.batches.review > 1 ? 'es' : ''} ready to review`, 'pulled from the ERP or uploaded', '/purchases', 'Review']);
  if (role === 'super_admin' && h.settings.accessExpiry) { const dl = Math.ceil((new Date(h.settings.accessExpiry).getTime() - now) / dayMs); if (dl <= 60) out.push(['c-warn', 'Plan', `Subscription ends in ${dl} days`, 'renew with the Ekobon team', '/help', 'Renew']); }
  for (const m of h.mine.filter((e) => e.status === 'rejected')) out.push(['c-bad', 'Sent back', `${CAT_NAME[m.cat] ?? m.category} · ${MN[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`, `${m.facility} · ${m.review_note ?? 'see the note'}`, `${catLink(m.cat)}?stage=review&facility=${m.f}`, 'Fix']);
  const drafts = h.mine.filter((e) => e.status === 'draft');
  if (drafts.length) out.push(['c-n', 'Draft', `${drafts.length} draft${drafts.length > 1 ? 's' : ''} not submitted`, [...new Set(drafts.map((e) => e.facility))].slice(0, 2).join(', '), `${catLink(drafts[0]!.cat)}?stage=review&facility=${drafts[0]!.f}`, 'Submit']);
  return (
    <section className="card hcard2"><div className="row"><h2>Needs your decision</h2><span className={`chip ${out.length ? 'c-warn' : 'c-ok'}`}>{out.length}</span><span className="grow" /></div>
      {out.length ? out.slice(0, n).map(([cls, k, t, dd, to, cta], i) => (
        <div key={i} className="hitem"><span className={`chip ${cls}`}>{k}</span><span style={{ flex: 1, minWidth: 0 }}><b>{t}</b><small>{dd}</small></span><Link className="btn sm" to={to}>{cta}</Link></div>))
        : <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>Nothing needs you right now.</div>}
    </section>);
}

function Checklist({ x, h, title, span }: { x: H; h: HomeData; title: string; span?: number }) {
  const cm = x.cyc.cm;
  const rows = h.facilities.flatMap((f) => f.usual.map((cat) => ({ f, cat, st: x.catSt(f.id, cat, cm) })));
  const done = rows.filter((r) => r.st === 'submitted' || r.st === 'approved').length, pct = rows.length ? (done / rows.length) * 100 : 100;
  const ACT: Record<CSt, [string, string]> = { missing: ['Add', 'p'], draft: ['Submit', ''], returned: ['Fix', ''], submitted: ['', ''], approved: ['', ''] };
  const open = h.facilities.filter((f) => rows.some((r) => r.f.id === f.id && r.st !== 'submitted' && r.st !== 'approved'));
  const ok = h.facilities.filter((f) => f.usual.length && !open.includes(f));
  return (
    <section className="card hcard2 chkcard" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="row"><div><h2>{title}</h2><div className="muted" style={{ fontSize: 12 }}>{done} of {rows.length} done</div></div><span className="grow" /><div className="ring" style={{ ['--p' as string]: pct }}><b>{Math.round(pct)}%</b></div></div>
      <div className="chkgrid">{open.map((f) => (
        <div key={f.id} className="chkfac"><b>{f.name}</b>
          {rows.filter((r) => r.f.id === f.id).map((r) => { const [lbl, cls] = ACT[r.st]; return (
            <div key={r.cat} className={`chkrow ${r.st}`}><span className="dot" /><span style={{ flex: 1 }}>{CAT_NAME[r.cat] ?? r.cat}</span>
              {lbl ? <Link className={`btn sm ${cls}`} to={`${catLink(r.cat)}${r.st === 'missing' ? '' : '?stage=review'}${r.st === 'missing' ? '?' : '&'}facility=${f.id}`}>{lbl}</Link>
                : <span className={`chip ${r.st === 'approved' ? 'c-ok' : 'c-warn'}`}>{r.st === 'approved' ? '✓ Approved' : 'Submitted'}</span>}</div>); })}
        </div>))}</div>
      {ok.length > 0 && <div className="row" style={{ gap: 6, fontSize: 12.5 }}><span className="muted">All in:</span>{ok.map((f) => <span key={f.id} className="chip c-ok">✓ {f.name}</span>)}</div>}
      {!rows.length && <div className="muted" style={{ fontSize: 13 }}>No regular monthly data for these facilities yet: start under Add data.</div>}
    </section>);
}

// ------------------------------------------------------------------ homes --
function HomeLeader({ x, h, d, c, pick }: { x: H; h: HomeData; d: Data; c: Ctx; pick: (id: string) => void }) {
  return <>
    <CycleStrip x={x}><Link className="btn sm" to={`/data/stationary_combustion`}>Add data</Link></CycleStrip>
    <div className="htiles">
      <EmTile c={c} d={d} /><PathTile x={x} />
      <Tile lbl="Data approved" v={`${Math.round(x.comp * 100)}%`} sub={x.gaps ? `${x.gaps} ${x.gaps === 1 ? 'facility has' : 'facilities have'} gaps this year` : 'All facilities complete'} bar={x.comp * 100} barCol={x.comp > 0.9 ? 'var(--primary)' : 'var(--warn)'} to="/entries" />
      <Delivered d={d} />
    </div>
    <div className="hgrid"><TrendCard x={x} d={d} c={c} span={2} /><Decisions x={x} h={h} /><FacLeague x={x} h={h} d={d} c={c} span={2} pick={pick} /><Hotspots c={c} /></div>
  </>;
}
function HomeSolo({ x, h, d, c }: { x: H; h: HomeData; d: Data; c: Ctx }) {
  const cm = x.cyc.cm, miss = h.facilities.reduce((a, f) => a + f.usual.filter((k) => x.catSt(f.id, k, cm) === 'missing').length, 0);
  const mine = h.approvals.length, drafts = h.mine.filter((e) => e.status === 'draft').length;
  const Step = ({ i, t, dd, st, children }: { i: number; t: string; dd: string; st: 'done' | 'now' | 'next'; children?: ReactNode }) => (
    <div className={`sstep ${st}`}><span className="sn">{st === 'done' ? '✓' : i}</span><div style={{ flex: 1, minWidth: 0 }}><b>{t}</b><small>{dd}</small></div>{children}</div>);
  return <>
    <CycleStrip x={x}><Link className="btn sm p" to="/data/stationary_combustion">Add data</Link></CycleStrip>
    <div className="htiles"><EmTile c={c} d={d} /><PathTile x={x} />
      <Tile lbl={`To enter for ${MN[cm - 1]}`} v={miss} sub="required items missing" col={miss ? 'var(--warn)' : 'var(--ok)'} to="/data/stationary_combustion" />
      <Tile lbl="To review" v={mine} sub="your own submitted entries" to="/data/stationary_combustion?stage=review" /></div>
    <div className="hgrid">
      <section className="card hcard2"><div><h2>{MN[cm - 1]} {x.y} in three steps</h2><div className="muted" style={{ fontSize: 12 }}>You are the only user, so you enter and review. Entries you approve are marked self-reviewed; a verifier can sample them.</div></div>
        <div className="ssteps">
          <Step i={1} t="Enter the month’s data" dd={miss ? `${miss} required item${miss > 1 ? 's' : ''} missing` : 'Everything required is entered'} st={miss ? 'now' : 'done'}>{miss > 0 && <Link className="btn sm p" to="/data/stationary_combustion">Add data</Link>}</Step>
          <Step i={2} t="Review and approve" dd={mine ? `${mine} submitted entr${mine > 1 ? 'ies' : 'y'} to check against bills${drafts ? ` · ${drafts} drafts` : ''}` : 'Nothing waiting'} st={mine ? (miss ? 'next' : 'now') : miss ? 'next' : 'done'}>{mine > 0 && <Link className={`btn sm ${miss ? '' : 'p'}`} to="/data/stationary_combustion?stage=review">Review</Link>}</Step>
          <Step i={3} t="Report" dd="Once everything is approved, the dashboards and reports are final" st={!miss && !mine ? 'now' : 'next'}><Link className="btn sm ghost" to="/dashboards">Dashboards</Link></Step>
        </div></section>
      <Checklist x={x} h={h} title={`${MN[cm - 1]} ${x.y} checklist`} span={2} />
      <TrendCard x={x} d={d} c={c} span={2} /><Hotspots c={c} />
    </div>
  </>;
}
function HomeManager({ x, h, d, c, reload, pick }: { x: H; h: HomeData; d: Data; c: Ctx; reload: () => void; pick: (id: string) => void }) {
  const { toast } = useApp();
  const ap = h.approvals, warn = ap.filter((a) => a.warn), clean = ap.filter((a) => !a.warn);
  const old = Math.max(0, ...ap.map((a) => (a.at ? (Date.now() - new Date(a.at).getTime()) / dayMs : 0)));
  const act = async (ids: string[]) => { const r = await api.reviewAction(ids, 'approve'); toast(`${r.done} approved${r.skipped.length ? ` · ${r.skipped.length} not: ${r.skipped[0]!.reason}` : ''}`); reload(); };
  return <>
    <CycleStrip x={x}><Link className="btn sm" to="/data/stationary_combustion">Add data</Link></CycleStrip>
    <div className="htiles">
      <Tile lbl="Waiting for your approval" v={ap.length} sub={ap.length ? `oldest ${Math.floor(old)} days · ${warn.length} with warnings` : 'all clear'} col={ap.length ? 'var(--warn)' : 'var(--ok)'} to={ap[0] ? `${catLink(ap[0].cat)}?stage=review&facility=${ap[0].f}` : undefined} />
      <EmTile c={c} d={d} /><PathTile x={x} />
      <Tile lbl="Overdue at your sites" v={x.cyc.overdue + x.cyc.esc} sub={x.cyc.esc ? `${x.cyc.esc} already escalated` : 'past the due date'} col={x.cyc.overdue + x.cyc.esc ? 'var(--bad)' : 'var(--ok)'} />
    </div>
    <div className="hgrid">
      <section className="card hcard2"><div className="row"><h2>Approval queue</h2><span className={`chip ${ap.length ? 'c-warn' : 'c-ok'}`}>{ap.length}</span><span className="grow" /><Link className="btn sm ghost" to="/approvals">All approvals →</Link>{clean.length > 0 && <button className="btn sm p" onClick={() => void act(clean.map((a) => a.id))}>Approve {clean.length} clean</button>}</div>
        {ap.length ? ap.slice(0, 6).map((a) => (
          <div key={a.id} className="hitem"><span style={{ flex: 1, minWidth: 0 }}><b>{CAT_NAME[a.cat] ?? a.category} · {MN[Number(a.month.slice(5, 7)) - 1]} {a.month.slice(0, 4)}</b>
            <small>{a.facility} · {fmt(a.qty, 0)} {a.unit} · {fmt(a.kg / 1000, 1)} t · by {a.by ?? '—'}</small>{a.warn && <small style={{ color: 'var(--warn)' }}>! {a.warn}</small>}</span>
            {a.warn ? <Link className="btn sm" to={`${catLink(a.cat)}?stage=review&facility=${a.f}`}>Check</Link> : <button className="btn sm p" onClick={() => void act([a.id])}>Approve</button>}</div>))
          : <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>Nothing waiting for you.</div>}
      </section>
      <FacLeague x={x} h={h} d={d} c={c} n={6} span={2} pick={pick} /><TrendCard x={x} d={d} c={c} span={2} /><Hotspots c={c} />
    </div>
  </>;
}
function HomePreparer({ x, h }: { x: H; h: HomeData }) {
  const c = x.cyc, sent = h.mine.filter((e) => e.status === 'rejected'), drafts = h.mine.filter((e) => e.status === 'draft');
  const earlier = x.cyc.items.filter((i) => i.m !== c.cm && i.st === 'missing');
  const doneAll = c.items.filter((i) => i.s === 'On time' || i.s === 'Late'), onTime = doneAll.length ? Math.round((doneAll.filter((i) => i.s === 'On time').length / doneAll.length) * 100) : 100;
  const fix = [...sent.map((e) => ['Sent back', 'c-bad', `${CAT_NAME[e.cat] ?? e.category} · ${MN[Number(e.month.slice(5, 7)) - 1]}`, `${e.facility} · ${e.review_note ?? ''}`, `${catLink(e.cat)}?stage=review&facility=${e.f}`, 'Fix'] as const),
    ...drafts.map((e) => ['Draft', 'c-n', `${CAT_NAME[e.cat] ?? e.category} · ${MN[Number(e.month.slice(5, 7)) - 1]}`, `${e.facility} · not submitted`, `${catLink(e.cat)}?stage=review&facility=${e.f}`, 'Submit'] as const),
    ...earlier.map((i) => ['Earlier', 'c-warn', `${CAT_NAME[i.cat] ?? i.cat} · ${MN[i.m - 1]}`, `${i.f.name} · missing`, `${catLink(i.cat)}?facility=${i.f.id}`, 'Add'] as const)];
  return <>
    <CycleStrip x={x}><Link className="btn sm p" to="/data/stationary_combustion">Add data</Link></CycleStrip>
    <div className="htiles">
      <Tile lbl={`${MN[c.cm - 1]} ${x.y} due`} v={c.due ? c.due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'} sub={c.days !== null ? (c.days >= 0 ? `${c.days} days left` : `${-c.days} days late`) : ''} col={c.days !== null && c.days < 3 ? 'var(--warn)' : undefined} />
      <Tile lbl={`Done for ${MN[c.cm - 1]}`} v={`${c.done} / ${c.n}`} sub="submissions" bar={c.n ? (c.done / c.n) * 100 : 100} to="/data/stationary_combustion" />
      <Tile lbl="Sent back to you" v={sent.length} sub={sent.length ? 'fix and resubmit' : 'nothing returned'} col={sent.length ? 'var(--bad)' : 'var(--ok)'} />
      <Tile lbl="On-time record" v={`${onTime}%`} sub="this year" />
    </div>
    <div className="hgrid">
      <Checklist x={x} h={h} title={`Your ${MN[c.cm - 1]} ${x.y} checklist`} span={2} />
      <section className="card hcard2"><div className="row"><h2>To fix</h2><span className={`chip ${fix.length ? 'c-warn' : 'c-ok'}`}>{fix.length}</span></div>
        {fix.length ? fix.slice(0, 7).map(([k, cls, t, dd, to, cta], i) => <div key={i} className="hitem"><span className={`chip ${cls}`}>{k}</span><span style={{ flex: 1, minWidth: 0 }}><b>{t}</b><small>{dd}</small></span><Link className="btn sm" to={to}>{cta}</Link></div>)
          : <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>Nothing sent back, no drafts, no earlier gaps.</div>}
        <div className="tipbox" style={{ fontSize: 12.5, marginTop: 'auto' }}><b>Faster entry</b><div>Upload the bill and Ekotrace reads the numbers; meter readings can arrive by themselves.</div><Link className="btn sm ghost" style={{ paddingLeft: 0 }} to="/help">How to enter data →</Link></div>
      </section>
    </div>
  </>;
}
function HomeVerifier({ x, h, d, c }: { x: H; h: HomeData; d: Data; c: Ctx }) {
  const V = h.verifier, compMonths = Array.from({ length: x.open }, (_, i) => i + 1).filter((m) => h.facilities.every((f) => ['approved', 'none'].includes(x.monthSt(f, m)))).length;
  const est = sum(d.rows, (r: Row) => r.estimated), all = sum(d.rows, (r: Row) => r.n);
  const checks: [string, boolean, string][] = [
    ['Every required month approved', x.comp >= 0.999, `${Math.round(x.comp * 100)}% approved`],
    ['Estimated or proxy data', all ? est / all < 0.1 : true, all ? `${Math.round((est / all) * 100)}% of entries` : 'none'],
    ['Self-reviewed entries', V.self === 0, V.self ? `${V.self} to sample` : 'none'],
    ['Entries with evidence (bill, meter, files)', V.n ? V.evidence / V.n >= 0.5 : true, V.n ? `${Math.round((V.evidence / V.n) * 100)}%` : '—'],
  ];
  return <>
    <div className="htiles"><EmTile c={c} d={d} />
      <Tile lbl="Approved data" v={`${V.n} entries`} sub={`${Math.round(x.comp * 100)}% of required data approved`} to="/entries" />
      <Tile lbl="Backed by evidence" v={V.n ? `${Math.round((V.evidence / V.n) * 100)}%` : '—'} sub={`${V.evidence} of ${V.n} come from bills or meters${V.self ? ` · ${V.self} self-reviewed` : ''}`} bar={V.n ? (V.evidence / V.n) * 100 : 0} barCol="var(--s3)" />
      <Tile lbl="Complete months" v={`${compMonths} / ${x.open}`} sub="every facility fully approved" to="/audit" />
    </div>
    <div className="hgrid">
      <section className="card hcard2"><div className="row"><h2>Sample to test</h2><span className="grow" /><Link className="btn sm ghost" to="/entries">Entries →</Link></div>
        {V.sample.map((s) => <div key={s.id} className="hitem"><span style={{ flex: 1, minWidth: 0 }}><b>{s.category} · {MN[Number(s.month.slice(5, 7)) - 1]} {s.month.slice(0, 4)}</b><small>{s.facility} · {fmt0(s.kg / 1000)} t · approved by {s.approved_by ?? '—'}{s.self_reviewed ? ' (self-reviewed)' : ''}</small></span>{s.evidence ? <span className="chip c-ok">Bill / meter</span> : <span className="chip c-warn">Typed in</span>}</div>)}
        <div className="muted" style={{ fontSize: 12 }}>Largest approved entries first — the ones that move the total.</div></section>
      <section className="card hcard2"><div className="row"><h2>Assurance readiness</h2></div>
        {checks.map(([nm, ok, t]) => <div key={nm} className="hs hs2"><span className="nm">{nm}</span><span className={`chip ${ok ? 'c-ok' : 'c-warn'}`}>{ok ? 'OK' : t}</span></div>)}</section>
      <section className="card hcard2"><div className="row"><h2>Where to look</h2></div>
        <div className="hitem"><span style={{ flex: 1 }}><b>Audit log</b><small>every entry, approval and change, with who and when</small></span><Link className="btn sm" to="/audit">Open</Link></div>
        <div className="hitem"><span style={{ flex: 1 }}><b>Methodology</b><small>boundaries, GWP set, factor sources</small></span><Link className="btn sm" to="/methodology">Open</Link></div>
        <div className="hitem"><span style={{ flex: 1 }}><b>Dashboards</b><small>totals by scope, category and facility</small></span><Link className="btn sm" to="/dashboards">Open</Link></div></section>
    </div>
  </>;
}
