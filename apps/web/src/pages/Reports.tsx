/**
 * Reports (as in the prototype), for the company, sub-group, facility or group and period viewed:
 *
 *   Summary                 total and scopes, equivalents, against the same months last year, by GHG Protocol
 *                           category, top 10 sources, next steps
 *   GHG Protocol inventory  every category 1.1–3.15: measured, no data or excluded (with a justification)
 *   Granular audit view     every approved entry with its factor, quality and how it was captured
 *   Data quality            actual / estimated / proxy, data-quality gauges, quality controls to fix or justify
 *   Templates & regulatory  report templates (board, GHG Protocol, MOCCAE layout, your own), MRV dataset
 *   Versions                freeze the inventory and compare it with today
 *
 * Location- or market-based Scope 2 is switched at the top; "Download report" gives the GHG Protocol report.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, num, unitLabel, type RepCheck, type RepLine, type RepSettings, type RepTemplate, type TargetsData } from '../lib/api';
import { CAPTURED, DT_C, EXCL_DEFAULT, GHG_CATS, RSECS, dtypeOf, download, factorsCsv, ghgName, inventory, inventoryCsv, lineConf, lineT, mrvCsv, reportBody, reportHtml, templateList, type RepCtx } from '../lib/reports';
import { fmt, fmt0 } from '../components/DashCharts';
import { CONS, ViewBar, useView } from '../components/ViewBar';
import { ENERGY_UNITS, Result } from '../components/Result';
import { Icon } from '../components/Icon';

type Tab = 'sum' | 'inv' | 'audit' | 'dq' | 'tpl' | 'ver';
const TABS: [Tab, string][] = [['sum', 'Summary'], ['inv', 'GHG Protocol inventory'], ['audit', 'Granular audit view'], ['dq', 'Data quality'], ['tpl', 'Templates & regulatory'], ['ver', 'Versions']];
const EQUIV: [string, string, number][] = [['🚗', 'cars driven for a year', 4.6], ['✈️', 'return flights Dubai–London (economy)', 1.1], ['🏠', 'UAE residents’ yearly footprint', 21], ['🌳', 'trees growing for a year to absorb it', 0.022]];

export function Reports() {
  const v = useView();
  const { d, c, err, sp, set, pend } = v;
  const { me, toast } = useApp();
  const tab = (sp.get('rtab') as Tab) || 'sum';
  const mb = d?.scope2 === 'market';
  const [lines, setLines] = useState<RepLine[] | null>(null);
  const [st, setSt] = useState<RepSettings | null>(null);
  const [checks, setChecks] = useState<{ checks: RepCheck[]; canJustify: boolean } | null>(null);
  const [tg, setTg] = useState<TargetsData | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((x) => x + 1);
  const q = d ? { year: d.year, node: v.group ? undefined : v.node || undefined, group: v.group || undefined, pend: pend ? '1' : undefined } : null;
  useEffect(() => { if (q) { setLines(null); api.reportLines(q).then((r) => setLines(r.lines)).catch((e) => toast((e as Error).message)); } }, [d?.year, v.node, v.group, pend]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q) api.reportQuality(q).then(setChecks).catch(() => setChecks(null)); }, [d?.year, v.node, v.group, pend, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.reportSettings().then(setSt).catch(() => setSt(null)); }, [tick]);
  useEffect(() => { if (d) api.targets(d.year).then(setTg).catch(() => setTg(null)); }, [d?.year]);
  // the period viewed: its months (entries for a longer period count in the full-year view only)
  const months = c?.months ?? [], full = months.length === 12;
  const inP = (m: number) => (m === 0 ? full : months.includes(m));
  const rows = useMemo(() => (d && c ? d.rows.filter((r) => inP(r.m)) : []), [d, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => (d && c ? d.prevRows.filter((r) => inP(r.m)) : []), [d, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const pLines = useMemo(() => (lines ?? []).filter((l) => inP(l.m)), [lines, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const inv = useMemo(() => (d ? inventory(rows, d.categories) : null), [rows, d]);
  const period = d && c ? `${d.year} · ${c.periodLabel}` : '';
  const consolidation = d ? CONS[d.consolidation] ?? d.consolidation : '';
  const ctx: RepCtx | null = d && inv && st ? { d, rows, prev, months, inv, lines: pLines, mb, label: v.name, period, settings: st, checks: checks?.checks ?? null, targets: tg, preparedBy: me.user.name, consolidation } : null;
  const exportOk = me.company?.planLimits?.export !== false;
  const getReport = (t: RepTemplate) => { if (!ctx) return; download(`${t.name} – ${v.name} – ${period}.html`.replace(/[\\/:*?"<>|]/g, '-'), reportHtml(t, ctx), 'text/html;charset=utf-8'); };
  const printReport = (t: RepTemplate) => { if (!ctx) return; const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to print the report'); return; } w.document.write(reportHtml(t, ctx)); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); };
  const ghgp = st ? templateList(st.templates).find((t) => t.base === 'ghgp')! : null;

  return (
    <div className="page" style={{ gap: 12 }}>
      <ViewBar v={v} />
      <div className="row tahead">
        <div><span className="lbl">Disclose</span><h1>Reports</h1><div className="muted">{v.name} · {period} · {pend ? 'approved + waiting' : 'approved data'} · {consolidation} · GHG Protocol Corporate Standard</div></div>
        <span className="grow" />
        <div className="seg"><button className={!mb ? 'on' : ''} onClick={() => set({ scope2: null })}>Location-based</button><button className={mb ? 'on' : ''} onClick={() => set({ scope2: 'market' })}>Market-based</button></div>
        {ghgp && <button className="btn" disabled={!ctx} onClick={() => printReport(ghgp)}>Print / PDF</button>}
        {ghgp && <button className="btn p" disabled={!ctx} onClick={() => getReport(ghgp)}>Download report</button>}
      </div>
      <nav className="tabs" role="tablist">{TABS.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => set({ rtab: k === 'sum' ? null : k })}>{n}</button>)}</nav>
      {!d || !c || !inv || !st ? <div className="card empty">{err ?? 'Loading…'}</div>
        : tab === 'inv' ? <Inventory ctx={ctx!} exportOk={exportOk} reload={reload} go={(code) => set({ rtab: 'audit', rcode: code })} />
        : tab === 'audit' ? <Audit ctx={ctx!} loading={!lines} code={sp.get('rcode') ?? ''} setCode={(x) => set({ rcode: x || null })} />
        : tab === 'dq' ? <Quality ctx={ctx!} q={checks} year={d.year} reload={reload} />
        : tab === 'tpl' ? <Templates ctx={ctx!} reload={reload} getReport={getReport} printReport={printReport} exportOk={exportOk} />
        : tab === 'ver' ? <Versions ctx={ctx!} reload={reload} />
        : <Summary ctx={ctx!} />}
    </div>);
}

// ------------------------------------------------------------------ summary --
function Summary({ ctx }: { ctx: RepCtx }) {
  const { d, inv, prev, lines, mb } = ctx;
  const p = inventory(prev, d.categories), staff = d.facilities.reduce((a, f) => a + (f.employees ?? 0) * f.weight, 0) || 0;
  const yoy = (a: number, b: number) => (b ? <span style={{ color: a > b ? 'var(--bad)' : 'var(--ok)', fontWeight: 700 }}>{a > b ? '+' : '−'}{fmt(Math.abs(a / b - 1) * 100, 0)}%</span> : <span className="muted">—</span>);
  const src = new Map<string, number>(); for (const l of lines) src.set(l.item, (src.get(l.item) ?? 0) + lineT(l, mb));
  const top = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), mx = top[0]?.[1] || 1;
  const codes = Object.keys(inv.byCode).filter((k) => inv.byCode[k]! > 0).sort((a, b) => inv.byCode[b]! - inv.byCode[a]!);
  const next = [inv.byCode['3.1'] && inv.byCode['3.1'] / (inv.tot || 1) > 0.1 ? 'Engage the suppliers behind purchased goods — replace spend averages with their own factors.' : '',
    inv.s[1] / (inv.tot || 1) > 0.4 ? 'Scope 2 is the largest share — renewable electricity (solar, green tariff) is the biggest lever.' : '',
    'Close the gaps flagged in Data quality before locking the year.', 'Review actions against the target path in Targets & actions.'].filter(Boolean);
  return (
    <>
      <section className="card repcover">
        <div><span className="lbl" style={{ color: 'var(--primary)' }}>General overview</span><h2>{fmt0(inv.tot)} tCO₂e</h2><div className="rc-sub">{ctx.label} · {ctx.period} · {mb ? 'market' : 'location'}-based Scope 2</div></div>
        <div className="row" style={{ gap: 22 }}>{[0, 1, 2].map((i) => <div key={i}><div className="rc-sub">Scope {i + 1}</div><b>{fmt0(inv.s[i]!)}</b> <span className="rc-sub">t · {inv.tot ? Math.round((inv.s[i]! / inv.tot) * 100) : 0}%</span></div>)}
          <div><div className="rc-sub">Per employee</div><b>{staff ? fmt(inv.tot / staff, 1) : '—'}</b> <span className="rc-sub">t</span></div></div>
      </section>
      <section className="card tacard"><h2>Is equivalent to</h2>
        <div className="hk">{EQUIV.map(([ic, n, k]) => <div key={n} className="soft"><span style={{ fontSize: 24 }}>{ic}</span><b style={{ fontSize: 21 }}>{fmt0(inv.tot / k)}</b><span className="muted small">{n}</span></div>)}</div>
        <span className="muted" style={{ fontSize: 11.5 }}>Indicative conversions: car 4.6 t/yr (US EPA), Dubai–London return ~1.1 t, UAE per-capita ~21 t, tree ~22 kg/yr.</span></section>
      <div className="tagrid2 even">
        <section className="card tacard">
          <h2>{ctx.period} vs same months of {d.cmpYear}</h2>
          <div className="scrollx"><table className="t"><thead><tr><th /><th className="num">Absolute tCO₂e</th><th className="num">vs {d.cmpYear}</th><th className="num">Per employee t</th></tr></thead>
            <tbody>{[0, 1, 2].map((i) => <tr key={i}><td><b>Scope {i + 1}</b></td><td className="num">{fmt0(inv.s[i]!)}</td><td className="num">{prev.length ? yoy(inv.s[i]!, p.s[i]!) : '—'}</td><td className="num">{staff ? fmt(inv.s[i]! / staff, 2) : '—'}</td></tr>)}
              <tr className="totrow"><td><b>Total</b></td><td className="num"><b>{fmt0(inv.tot)}</b></td><td className="num">{prev.length ? yoy(inv.tot, p.tot) : '—'}</td><td className="num"><b>{staff ? fmt(inv.tot / staff, 2) : '—'}</b></td></tr></tbody></table></div>
          {codes.length > 0 && <><h2 style={{ marginTop: 6 }}>By GHG Protocol category</h2>
            {codes.map((k) => <div key={k} className="repbar"><span>{ghgName(k)}</span><div className="bar"><span style={{ width: `${(inv.byCode[k]! / inv.tot) * 100}%`, background: `var(--s${k[0]})` }} /></div><b>{fmt0(inv.byCode[k]!)} t · {Math.round((inv.byCode[k]! / inv.tot) * 100)}%</b></div>)}</>}
        </section>
        <section className="card tacard">
          <h2>Top 10 emission sources</h2>
          {top.map(([n, val]) => <div key={n} className="repbar"><span title={n}>{n}</span><div className="bar"><span style={{ width: `${(val / mx) * 100}%`, background: 'var(--primary)' }} /></div><b>{fmt0(val)} t</b></div>)}
          {!top.length && <span className="muted">No approved entries in this period.</span>}
          <h2 style={{ marginTop: 8 }}>Next steps</h2>
          {next.map((t) => <div key={t} className="hitem"><span className="chip c-info">Next</span><span style={{ flex: 1, fontSize: 13.5 }}>{t}</span></div>)}
        </section>
      </div>
    </>);
}

// ------------------------------------------------------------------ inventory --
function Inventory({ ctx, exportOk, reload, go }: { ctx: RepCtx; exportOk: boolean; reload: () => void; go: (code: string) => void }) {
  const { inv, settings: st, mb, lines } = ctx;
  const { toast } = useApp();
  const ex = { ...EXCL_DEFAULT, ...st.excl }, tot = inv.tot || 1;
  const saveEx = async (code: string, text: string) => { if ((ex[code] ?? '') === text) return; try { await api.saveReportSettings({ excl: { [code]: text } }); toast('Justification saved'); reload(); } catch (e) { toast((e as Error).message); } };
  const fname = (k: string) => `${k} – ${ctx.label} – ${ctx.period}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  return (
    <>
      <section className="card tacard">
        <div className="row" style={{ alignItems: 'flex-start' }}><div className="grow"><h2>Inventory by GHG Protocol category</h2><div className="muted small">All 15 Scope 3 categories are listed; categories without data need a justification for exclusion. {mb ? 'Scope 2 market-based: contractual instruments (certificates, supplier factors) and residual factors.' : 'Scope 2 location-based: grid average factors.'}</div></div>
          {exportOk ? <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => download(fname('GHG inventory'), inventoryCsv(inv, st.excl))}>Export regulatory file</button>
            <button className="btn sm" onClick={() => download(fname('Emission factors'), factorsCsv(lines, mb))}>Export emission factors</button>
            <button className="btn sm" onClick={() => download(fname('Entries'), mrvCsv(lines, mb))}>Export entries</button></div> : <span className="chip c-n">Export: Starter plan and above</span>}
        </div>
        <div className="scrollx"><table className="t"><thead><tr><th>Code</th><th>Category</th><th className="num">tCO₂e</th><th>Share</th><th>Status</th><th>Exclusion justification / detail</th></tr></thead>
          <tbody>{[1, 2, 3].map((sc) => [
            <tr key={`s${sc}`} className="scoperow"><td colSpan={6}><b>Scope {sc}</b> · {fmt(inv.s[sc - 1]!, 1)} tCO₂e · {Math.round((inv.s[sc - 1]! / tot) * 100)}%</td></tr>,
            ...GHG_CATS.filter((g) => g[1] === sc).map(([code, , name, desc]) => {
              const val = inv.byCode[code] ?? 0;
              return (
                <tr key={code}><td><span className={`codechip s${sc}`}>{code}</span></td><td><b>{name}</b><div className="muted" style={{ fontSize: 12 }}>{desc}</div></td><td className="num">{val ? fmt(val, 1) : '—'}</td>
                  <td style={{ minWidth: 120 }}>{val > 0 && <div className="row nowrap" style={{ gap: 6 }}><div className="bar" style={{ width: 60, height: 7 }}><span style={{ width: `${(val / tot) * 100}%`, background: `var(--s${sc})` }} /></div><span className="small">{fmt((val / tot) * 100, 1)}%</span></div>}</td>
                  <td>{val ? <span className="chip c-ok">Measured</span> : sc < 3 ? <span className="chip c-warn">No data</span> : <span className="chip c-n">Excluded</span>}</td>
                  <td style={{ minWidth: 240 }}>{val ? <button className="btn xs ghost" onClick={() => go(code)}>View entries →</button>
                    : st.canEntity ? <input className="input sm" style={{ width: '100%' }} defaultValue={ex[code] ?? ''} key={`${code}${ex[code]}`} placeholder="Why it is excluded" onBlur={(e) => void saveEx(code, e.target.value.trim())} />
                    : <span className="small">{ex[code] || <span style={{ color: 'var(--bad)' }}>Justification required</span>}</span>}</td></tr>);
            })])}
            <tr className="scoperow"><td colSpan={2}><b>Total (GHG Protocol)</b></td><td className="num"><b>{fmt(inv.tot, 1)}</b></td><td colSpan={3} /></tr></tbody></table></div>
      </section>
      <section className="card tacard"><h2>Method statement</h2>
        <div className="rprev" dangerouslySetInnerHTML={{ __html: reportBody({ id: 'm', base: null, name: '', audience: null, note: null, sections: ['method'] }, ctx).replace('<h2>Methodology</h2>', '') }} />
        <div className="note warn">Factors are DESNZ / IPCC defaults unless a supplier or local factor was used; check the factor sources (Export emission factors) before external reporting.</div></section>
    </>);
}

// ------------------------------------------------------------------ audit view --
function Audit({ ctx, loading, code, setCode }: { ctx: RepCtx; loading: boolean; code: string; setCode: (c: string) => void }) {
  const { lines, mb, d } = ctx;
  const { toast } = useApp();
  const [F, setF] = useState({ q: '', fac: '', cap: '' });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof api.activity>> | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => setPage(0), [F, code]);
  const q = F.q.toLowerCase();
  const ls = lines.filter((l) => (!F.fac || l.f === F.fac) && (!code || l.code === code) && (!F.cap || l.captured === F.cap) && (!q || `${l.item} ${l.note ?? ''} ${l.asset ?? ''} ${l.source ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => lineT(b, mb) - lineT(a, mb));
  const per = 40, pageLs = ls.slice(page * per, page * per + per), sum = ls.reduce((a, l) => a + lineT(l, mb), 0);
  const codes = [...new Set(lines.map((l) => l.code))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const show = async (id: string) => { try { setOpen(await api.activity(id)); dlg.current?.showModal(); } catch (e) { toast((e as Error).message); } };
  return (
    <section className="card tacard">
      <div className="row apfilt">
        <input className="input sm" type="search" style={{ width: 230 }} placeholder="Search activity, note, asset, factor" value={F.q} onChange={(e) => setF({ ...F, q: e.target.value })} />
        <select className="input sm" style={{ width: 'auto' }} value={F.fac} onChange={(e) => setF({ ...F, fac: e.target.value })}><option value="">All facilities</option>{d.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select className="input sm" style={{ width: 'auto' }} value={code} onChange={(e) => setCode(e.target.value)}><option value="">All categories</option>{codes.map((k) => <option key={k} value={k}>{ghgName(k)}</option>)}</select>
        <select className="input sm" style={{ width: 'auto' }} value={F.cap} onChange={(e) => setF({ ...F, cap: e.target.value })}><option value="">Any capture method</option>{Object.entries(CAPTURED).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <span className="grow" /><b>{loading ? 'Loading…' : `${ls.length.toLocaleString('en')} entries · ${fmt(sum, 1)} tCO₂e`}</b>
      </div>
      <div className="scrollx"><table className="t"><thead><tr><th>Facility · month</th><th>Category</th><th>Activity</th><th className="num">Quantity</th><th className="num">Factor kg/unit</th><th className="num">tCO₂e</th><th>Quality</th><th>Captured</th></tr></thead>
        <tbody>{pageLs.map((l) => { const t = lineT(l, mb), cf = lineConf(l), raw = t / (l.w || 1); return (
          <tr key={l.id}><td className="small"><b>{l.facility}</b><div className="muted">{l.m ? new Date(`${l.from}T00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : `${l.from} → ${l.to}`}</div></td>
            <td className="small nowrap"><span className={`codechip s${l.code[0]}`}>{l.code}</span> {l.category}</td>
            <td className="small" style={{ maxWidth: 300 }}>{l.item}{l.asset && <span className="muted"> · {l.asset}</span>}<div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.note ?? ''}</div></td>
            <td className="num nowrap">{fmt(l.qty, l.qty < 100 ? 2 : 0)} <span className="muted">{unitLabel(l.unit)}</span></td>
            <td className="num">{l.qty ? fmt((raw * 1000) / l.qty, (raw * 1000) / l.qty < 1 ? 4 : 2) : '—'}<div className="muted" style={{ fontSize: 11 }}>{l.source ?? ''}</div></td>
            <td className="num"><b>{fmt(t, 2)}</b><div><button className="btn xs ghost" onClick={() => void show(l.id)}>ⓘ Method</button></div></td>
            <td><span className={`chip ${cf[0] === 'High' ? 'c-ok' : cf[0] === 'Medium' ? 'c-info' : 'c-warn'}`} title={`±${Math.round(cf[1] * 100)}% · ${cf[2]}`}>{cf[0]}</span></td>
            <td className="muted small">{CAPTURED[l.captured]}{l.evidence ? ' · evidence' : ''}</td></tr>); })}
          {!pageLs.length && <tr><td colSpan={8} className="muted">{loading ? 'Loading…' : 'No entries match.'}</td></tr>}</tbody></table></div>
      {ls.length > per && <div className="row"><span className="grow" /><span className="muted small">{page * per + 1}–{Math.min(ls.length, page * per + per)} of {ls.length}</span>
        <button className="btn sm" disabled={!page} onClick={() => setPage(page - 1)}>‹</button><button className="btn sm" disabled={(page + 1) * per >= ls.length} onClick={() => setPage(page + 1)}>›</button></div>}
      <dialog ref={dlg} className="drawer" onClose={() => setOpen(null)}>
        {open && (<div className="in">
          <div className="row"><div className="grow"><div className="eyebrow">Entry · {open.period_start} to {open.period_end}</div><h2>{open.item}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
          <div className="sub">{num(open.quantity)} {unitLabel(open.unit)} · {open.data_type} · saved {new Date(open.created_at).toLocaleString()}</div>
          <Result r={{ gwpSet: open.gwp_set, totals: { direct: Number(open.co2e_direct), scope2: Number(open.co2e_scope2 ?? 0), scope2_market: Number(open.co2e_scope2_market ?? 0), td_loss: Number(open.co2e_td ?? 0), scope3: Number(open.co2e_scope3 ?? 0), wtt: Number(open.co2e_wtt), outside_scopes: Number(open.co2_biogenic), memo: Number(open.co2e_memo) },
            lines: open.lines.map((x) => ({ basis: x.basis, gas: x.gas, kgGas: x.kg_gas, kgCo2e: x.kg_co2e, method: x.method, source: x.source })), steps: open.steps, warnings: open.warnings, factors: open.factors, cv: open.inputs?.cv }} quantity={Number(open.quantity)} unitName={open.unit} energy={ENERGY_UNITS.has(open.unit)} />
        </div>)}
      </dialog>
    </section>);
}

// ------------------------------------------------------------------ data quality --
function Quality({ ctx, q, year, reload }: { ctx: RepCtx; q: { checks: RepCheck[]; canJustify: boolean } | null; year: number; reload: () => void }) {
  const { lines, mb } = ctx;
  const { toast } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [just, setJust] = useState('');
  const tot = lines.reduce((a, l) => a + lineT(l, mb), 0) || 1;
  const g: Record<string, number> = { Actual: 0, Estimated: 0, Proxy: 0 }; for (const l of lines) g[dtypeOf(l)]! += lineT(l, mb);
  const act = lines.filter((l) => l.method !== 'spend').reduce((a, l) => a + lineT(l, mb), 0), sup = lines.filter((l) => l.method === 'supplier' || l.method === 'supplier_ef').reduce((a, l) => a + lineT(l, mb), 0),
    ev = lines.filter((l) => l.evidence).reduce((a, l) => a + lineT(l, mb), 0);
  const conf: Record<string, number> = { High: 0, Medium: 0, Low: 0 }; let u2 = 0; for (const l of lines) { const cf = lineConf(l), t = lineT(l, mb); conf[cf[0]]! += t; u2 += (t * cf[1]) ** 2; }
  const gauge = (lbl: string, val: number, sub: string) => <section className="card kc"><span className="muted">{lbl}</span><span className="v">{Math.round(val * 100)}%</span><div className="bar" style={{ height: 7 }}><span style={{ width: `${val * 100}%`, background: 'var(--primary)' }} /></div><span className="ks">{sub}</span></section>;
  return (
    <>
      <section className="card tacard"><h2>Actual, estimated and proxy data</h2>
        <div className="hk">{Object.entries(g).map(([k, val]) => <div key={k} className="soft"><span className={`chip ${DT_C[k]}`} style={{ alignSelf: 'flex-start' }}>{k}</span><b style={{ fontSize: 21 }}>{fmt((val / tot) * 100, 1)}%</b><span className="muted small">{fmt0(val)} tCO₂e</span></div>)}</div>
        <span className="muted small">Set per entry in Add data. Measured data is Actual, survey extrapolations are Estimated, spend-based purchases are Proxy.</span></section>
      <div className="hk">
        {gauge('Activity-based data', act / tot, 'of emissions; the rest is spend-based')}{gauge('Supplier-specific factors', sup / tot, 'of emissions')}{gauge('Backed by evidence', ev / tot, 'of emissions have a bill, meter or source file')}
        <section className="card kc"><span className="muted">Overall uncertainty</span><span className="v">±{fmt((Math.sqrt(u2) / tot) * 100, 1)}%</span><span className="ks">High {Math.round((conf.High! / tot) * 100)}% · Medium {Math.round((conf.Medium! / tot) * 100)}% · Low {Math.round((conf.Low! / tot) * 100)}%</span></section>
      </div>
      <section className="card tacard">
        <div><h2>Quality controls</h2><div className="muted small">Automatic checks on {ctx.label}, {year}. Fix the data, or justify why it is right.</div></div>
        {!q ? <div className="muted">Loading…</div> : (
          <div className="scrollx"><table className="t"><thead><tr><th>Control</th><th>Area</th><th>Status</th><th>Indicator</th><th /></tr></thead>
            <tbody>{q.checks.map((k) => { const s = !k.n ? ['OK', 'c-ok'] : k.justified ? ['Justified', 'c-info'] : ['To check', 'c-warn']; return [
              <tr key={k.id}><td><b>{k.name}</b>{k.justified && k.n > 0 && <div className="muted" style={{ fontSize: 12 }}>“{k.justified.text}” — {k.justified.by}</div>}</td><td className="muted small">{k.area}</td>
                <td><span className={`chip ${s[1]}`}>{s[0]}</span></td><td className="small">{k.n} warning{k.n === 1 ? '' : 's'}</td>
                <td>{k.n > 0 && <button className="btn sm" onClick={() => { setOpen(open === k.id ? null : k.id); setJust(k.justified?.text ?? ''); }}>{open === k.id ? 'Hide' : 'View'}</button>}</td></tr>,
              open === k.id && <tr key={`${k.id}o`}><td colSpan={5} style={{ background: 'var(--soft)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>{k.items.slice(0, 15).map((t) => <span key={t}>• {t}</span>)}{k.n > 15 && <span className="muted">+{k.n - 15} more</span>}</div>
                {q.canJustify && <div className="row" style={{ marginTop: 8 }}><input className="input sm grow" value={just} onChange={(e) => setJust(e.target.value)} placeholder="Justification, e.g. plant shutdown in July explains the drop" />
                  <button className="btn sm p" onClick={async () => { try { await api.justifyCheck(k.id, year, just.trim()); toast(just.trim() ? 'Marked justified' : 'Justification removed'); reload(); } catch (e) { toast((e as Error).message); } }}>{just.trim() ? 'Mark justified' : 'Remove justification'}</button></div>}
              </td></tr>]; })}</tbody></table></div>)}
      </section>
    </>);
}

// ------------------------------------------------------------------ templates --
function Templates({ ctx, reload, getReport, printReport, exportOk }: { ctx: RepCtx; reload: () => void; getReport: (t: RepTemplate) => void; printReport: (t: RepTemplate) => void; exportOk: boolean }) {
  const { settings: st } = ctx;
  const { toast } = useApp();
  const list = templateList(st.templates);
  const [cur, setCur] = useState(list[0]!.id);
  const [E, setE] = useState<(RepTemplate & { isNew?: boolean }) | null>(null);
  const [ent, setEnt] = useState(st.entity);
  const t = list.find((x) => x.id === cur) ?? list[0]!;
  const saveT = async () => {
    if (!E || !E.name.trim() || !E.sections.length) { toast('Name the template and include at least one section.'); return; }
    try { const r = await api.saveTemplate({ id: E.isNew || !st.templates.some((s) => s.id === E.id) ? undefined : E.id, base: st.templates.some((s) => s.id === E.id) ? E.base : E.isNew ? null : E.base, name: E.name.trim(), audience: E.audience, note: E.note, sections: E.sections });
      setE(null); setCur(r.id); toast('Template saved'); reload(); } catch (e) { toast((e as Error).message); }
  };
  const move = (k: string, dir: number) => { if (!E) return; const s = [...E.sections], i = s.indexOf(k), j = i + dir; if (j < 0 || j >= s.length) return; [s[i], s[j]] = [s[j]!, s[i]!]; setE({ ...E, sections: s }); };
  const fname = `MRV dataset – ${ctx.label} – ${ctx.period}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  return (
    <div className="tplwrap">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <section className="card tacard">
          <div className="row"><h2>Report templates</h2><span className="grow" />{st.canEdit && <button className="btn sm" onClick={() => setE({ id: '', base: null, name: '', audience: '', note: '', sections: ['cover', 'summary'], isNew: true })}>+ New</button>}</div>
          {list.map((x) => <button key={x.id} className={`tplitem${x.id === t.id ? ' on' : ''}`} onClick={() => { setCur(x.id); setE(null); }}><b>{x.name}</b><span className="muted small">{x.audience} · {x.sections.length} sections{x.builtin ? ' · built-in' : ''}</span></button>)}
          <div className="tipbox"><b>MRV dataset</b><div className="small">One row per approved entry with facility, scope, category, activity, unit, factor, source, data type and evidence — for upload to the MOCCAE MRV platform or a verifier.</div>
            <button className="btn sm" style={{ marginTop: 6 }} disabled={!exportOk} onClick={() => download(fname, mrvCsv(ctx.lines, ctx.mb))}>Export MRV dataset (CSV)</button></div>
        </section>
        <section className="card tacard"><h2>Reporting entity</h2>
          {(['legal', 'licence', 'emirate', 'sector', 'mrvId', 'contact'] as const).map((k) => (
            <label key={k} className="field"><span>{{ legal: 'Legal name', licence: 'Trade licence', emirate: 'Emirate', sector: 'Sector', mrvId: 'MOCCAE / MRV ID', contact: 'Reporting contact' }[k]}</span>
              <input className="input" disabled={!st.canEntity} value={ent[k] ?? ''} placeholder={k === 'legal' ? st.company.name : 'to be completed'} onChange={(e) => setEnt({ ...ent, [k]: e.target.value })} /></label>))}
          {st.canEntity && <div><button className="btn" onClick={async () => { try { await api.saveReportSettings({ entity: ent }); toast('Saved'); reload(); } catch (e) { toast((e as Error).message); } }}>Save</button></div>}
          <span className="muted small">Printed on the report cover.</span>
        </section>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {E && (
          <section className="card tacard" style={{ border: '2px solid var(--primary)' }}>
            <div className="row"><h2>{E.isNew ? 'New template' : 'Edit template'}</h2><span className="grow" /><button className="btn sm ghost" onClick={() => setE(null)}>Cancel</button></div>
            <div className="formgrid"><label className="field"><span>Name</span><input className="input" value={E.name} onChange={(e) => setE({ ...E, name: e.target.value })} /></label>
              <label className="field"><span>Audience</span><input className="input" value={E.audience ?? ''} onChange={(e) => setE({ ...E, audience: e.target.value })} /></label></div>
            <label className="field"><span>Note printed at the top (optional)</span><input className="input" value={E.note ?? ''} onChange={(e) => setE({ ...E, note: e.target.value })} /></label>
            <span className="lbl">Sections · tick to include, arrows to reorder</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{[...E.sections, ...RSECS.map((s) => s[0]).filter((k) => !E.sections.includes(k))].map((k) => { const on = E.sections.includes(k), i = E.sections.indexOf(k); return (
              <div key={k} className="row nowrap secrow" style={{ background: on ? 'var(--soft)' : 'transparent' }}>
                <input type="checkbox" checked={on} aria-label="Include" onChange={() => setE({ ...E, sections: on ? E.sections.filter((z) => z !== k) : [...E.sections, k] })} />
                <span className="grow" style={{ fontWeight: on ? 600 : 400, color: on ? undefined : 'var(--muted)' }}>{on ? `${i + 1}. ` : ''}{RSECS.find((s) => s[0] === k)?.[1]}</span>
                {on && <><button className="btn xs ghost" disabled={!i} aria-label="Move up" onClick={() => move(k, -1)}>↑</button><button className="btn xs ghost" disabled={i === E.sections.length - 1} aria-label="Move down" onClick={() => move(k, 1)}>↓</button></>}</div>); })}</div>
            <div className="row"><button className="btn p" onClick={() => void saveT()}>Save template</button>{!E.isNew && t.builtin && <span className="muted small">Saving keeps your version in place of the built-in one.</span>}</div>
          </section>)}
        <section className="card tacard">
          <div className="row"><div className="grow"><h2>{t.name}</h2><div className="muted small">{ctx.label} · {ctx.period} · {ctx.mb ? 'market' : 'location'}-based Scope 2</div></div>
            {st.canEdit && <button className="btn sm" onClick={() => setE({ ...t })}>Edit sections</button>}
            {st.canEdit && !t.builtin && <button className="btn sm ghost danger" onClick={async () => { await api.removeTemplate(t.id).catch(() => {}); setCur(RTPL_FIRST); reload(); }}>Delete</button>}
            <button className="btn sm" onClick={() => printReport(t)}>Print / PDF</button><button className="btn sm p" onClick={() => getReport(t)}>Download report</button></div>
          <div className="rprev" dangerouslySetInnerHTML={{ __html: reportBody(t, ctx) }} />
        </section>
      </div>
    </div>);
}
const RTPL_FIRST = 'board';

// ------------------------------------------------------------------ versions --
function Versions({ ctx, reload }: { ctx: RepCtx; reload: () => void }) {
  const { settings: st, inv } = ctx;
  const { toast, role } = useApp();
  const [name, setName] = useState('');
  const [cmp, setCmp] = useState<string | null>(null);
  const vc = st.versions.find((x) => x.id === cmp) ?? null;
  return (
    <>
      <section className="card tacard">
        <div className="row"><div className="grow"><h2>Saved versions</h2><div className="muted small">Freeze the inventory at a point in time (e.g. before external assurance) and compare it with today’s numbers.</div></div>
          {st.canEdit && <><input className="input" style={{ maxWidth: 240 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Version name, e.g. Q3 board pack" />
            <button className="btn p" onClick={async () => {
              if (!name.trim()) { toast('Name the version.'); return; }
              try { await api.saveVersion({ name: name.trim(), label: ctx.label, period: ctx.period, scope2: ctx.mb ? 'market' : 'location', s: inv.s, byCode: Object.fromEntries(Object.entries(inv.byCode).map(([k, val]) => [k, Math.round(val * 1000) / 1000])) }); setName(''); toast('Version saved'); reload(); }
              catch (e) { toast((e as Error).message); }
            }}>Save current version</button></>}</div>
        <div className="scrollx"><table className="t"><thead><tr><th>Version</th><th>Scope</th><th className="num">S1</th><th className="num">S2</th><th className="num">S3</th><th className="num">Total</th><th>Saved</th><th /></tr></thead>
          <tbody>{st.versions.map((x) => (
            <tr key={x.id} className={x.id === cmp ? 'sel' : ''}><td><b>{x.name}</b></td><td className="small">{x.label} · {x.period} · {x.scope2}-based</td><td className="num">{fmt0(x.s1)}</td><td className="num">{fmt0(x.s2)}</td><td className="num">{fmt0(x.s3)}</td><td className="num"><b>{fmt0(x.s1 + x.s2 + x.s3)}</b></td>
              <td className="muted small">{new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {x.by}</td>
              <td className="nowrap"><button className="btn sm" onClick={() => setCmp(cmp === x.id ? null : x.id)}>{cmp === x.id ? 'Hide' : 'Compare'}</button>
                {role === 'super_admin' && <button className="btn sm ghost danger" onClick={async () => { await api.removeVersion(x.id).catch(() => {}); if (cmp === x.id) setCmp(null); reload(); }}>✕</button>}</td></tr>))}
            {!st.versions.length && <tr><td colSpan={8} className="muted">No saved versions yet.</td></tr>}</tbody></table></div>
      </section>
      {vc && (
        <section className="card tacard"><h2>{vc.name} vs now</h2>
          <div className="scrollx"><table className="t"><thead><tr><th>Category</th><th className="num">Version</th><th className="num">Now</th><th className="num">Change</th></tr></thead>
            <tbody>{[...new Set([...Object.keys(vc.byCode), ...Object.keys(inv.byCode)])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((k) => { const a = vc.byCode[k] ?? 0, b = inv.byCode[k] ?? 0, dv = b - a; return (
              <tr key={k}><td>{ghgName(k)}</td><td className="num">{fmt(a, 1)}</td><td className="num">{fmt(b, 1)}</td><td className="num" style={{ color: Math.abs(dv) < 0.05 ? 'var(--muted)' : dv > 0 ? 'var(--bad)' : 'var(--ok)', fontWeight: 600 }}>{Math.abs(dv) < 0.05 ? '—' : `${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv), 1)}`}</td></tr>); })}
              <tr className="totrow"><td><b>Total</b></td><td className="num"><b>{fmt(vc.s1 + vc.s2 + vc.s3, 1)}</b></td><td className="num"><b>{fmt(inv.tot, 1)}</b></td><td className="num"><b>{fmt(inv.tot - (vc.s1 + vc.s2 + vc.s3), 1)}</b></td></tr></tbody></table></div>
          <span className="muted small">Differences come from entries added, corrected or approved since the version was saved{vc.label !== ctx.label || vc.period !== ctx.period ? ` — note the version covers ${vc.label} · ${vc.period}, the view now is ${ctx.label} · ${ctx.period}` : ''}{vc.scope2 !== (ctx.mb ? 'market' : 'location') ? `; it was saved with ${vc.scope2}-based Scope 2` : ''}.</span>
        </section>)}
    </>);
}
