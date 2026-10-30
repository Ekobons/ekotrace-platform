/**
 * Reduction plan: pick actions from the library (platform setting 'actions') or add your own, adjust the
 * figures to your site, track status and owner, and see the emissions path against a target.
 * Stored in the 'plan' module; every figure comes from the server (results.plan, lib/sme/plan.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { Kpi, Kpis, Sample, SmeHead } from './ui';
import { Evidence } from './Evidence';
import { smeApi, dmy, f0, f1, lakh, n } from '../../lib/sme';
import './plan.css';

interface Lib { id: string; title: string; plain: string; source?: string; sources?: string[]; share?: number; pct?: number; to?: string; toOptions?: string[]; per?: number; from?: 'solar' | 'pf'; link?: string; cost: { basis: string; rate?: number; unit?: string }; life: number; notes?: string; ref?: string }
interface Item { id: string; lib?: string | null; title?: string; source?: string; to?: string; share?: number | ''; pct?: number | ''; qty?: number | ''; cost?: number | ''; life?: number | ''; status?: string; owner?: string; date?: string }
interface PlanDoc { fy?: string; base?: 'this' | 'prior' | 'own'; baseYear?: number | ''; baseT?: number | ''; targetYear?: number | ''; targetPct?: number | ''; growth?: number | ''; prices?: Record<string, number | ''>; items?: Item[] }

export const STATUS: [string, string, string][] = [['idea', 'Idea', 'grey'], ['planned', 'Planned', 'info'], ['doing', 'In progress', 'warn'], ['done', 'Done', '']];
const statusChip = (s: string) => { const x = STATUS.find((y) => y[0] === s) ?? STATUS[0]!; return <span className={`chip ${x[2]}`}>{x[1]}</span>; };
const uid = () => Math.random().toString(36).slice(2, 9);
export const rupees = (v: unknown) => (Math.abs(n(v)) >= 1e5 ? lakh(v) : `₹${f0(v)}`);
const years = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v < 0.05 ? 'At once' : v < 1 ? `${f0(v * 12)} months` : `${f1(v)} years`);
const fyEndOf = (fy: string) => { const m = /^FY (\d{4})-/.exec(fy); return m ? Number(m[1]) + 1 : new Date().getFullYear(); };
const fyLabel = (end: number) => `FY ${end - 1}-${String(end % 100).padStart(2, '0')}`;
const SOURCE_NAME: Record<string, string> = { grid: 'grid electricity', diesel: 'diesel', petrol: 'petrol', lpg: 'LPG', png: 'piped gas (PNG)', coal: 'coal', solar: 'rooftop solar', refrig: 'refrigerant' };
const srcName = (k: string, F: Record<string, any>) => SOURCE_NAME[k] ?? (F[k]?.label as string | undefined)?.toLowerCase() ?? k;

type Tab = 'actions' | 'target' | 'prices';

export function SmePlan() {
  const { d, setModule, error } = useSme();
  const [tab, setTab] = useState<Tab>('actions');
  const [open, setOpen] = useState<string | null>(null);
  const [prev, setPrev] = useState<{ fy: string; doc: PlanDoc; total: number } | null>(null);
  const items0 = ((d?.data.plan ?? {}) as PlanDoc).items ?? [];
  const prevFy = d ? fyLabel(fyEndOf(d.fy) - 1) : '';
  // an empty plan: offer last year's
  useEffect(() => {
    if (!d || items0.length || !d.years.includes(prevFy)) return;
    let live = true;
    smeApi.data(prevFy).then((x) => { const doc = x.data.plan as PlanDoc | undefined; if (live && doc?.items?.length) setPrev({ fy: prevFy, doc, total: n(x.results.emissions?.total) }); }).catch(() => { /* nothing to offer */ });
    return () => { live = false; };
  }, [d?.fy, items0.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading…</div>;
  const A = (d.config.actions ?? { items: [], prices: {}, target: {} }) as { items: Lib[]; prices: Record<string, number>; target: { pct: number; year: number; rate_15c: number; note?: string }; note?: string };
  const libs = A.items ?? [];
  const lib = (id?: string | null) => libs.find((x) => x.id === id);
  const F = (d.config.factors?.items ?? {}) as Record<string, any>;
  const doc = (d.data.plan ?? {}) as PlanDoc;
  const P = d.results.plan ?? { rows: [], totals: { planned: {}, byStatus: {} }, path: [], base: {}, target: {}, prices: {} };
  const can = d.canEdit;
  const items = doc.items ?? [];
  const save = (next: Partial<PlanDoc>) => setModule('plan', { ...doc, ...next, fy: d.fy });
  const setItem = (id: string, v: Partial<Item>) => save({ items: items.map((x) => (x.id === id ? { ...x, ...v } : x)) });
  const add = (l: Lib | null) => { const id = uid(); save({ items: [...items, l ? { id, lib: l.id, status: 'idea' } : { id, lib: null, title: '', source: 'grid', share: 100, pct: 10, status: 'idea', life: 5 }] }); setOpen(id); setTab('actions'); };
  const remove = (id: string) => { if (window.confirm('Remove this action from your plan?')) save({ items: items.filter((x) => x.id !== id) }); };
  const copyPrev = () => {
    if (!prev) return;
    const pd = prev.doc;
    // last year's "this year" base becomes a fixed base year with that year's figure
    const base = pd.base === 'own' ? {} : pd.base === 'prior' ? { base: 'own' as const } : { base: 'own' as const, baseYear: fyEndOf(prev.fy), baseT: Math.round(prev.total * 10) / 10 };
    save({ ...pd, ...base, items: (pd.items ?? []).map((x) => ({ ...x })) });
    setPrev(null);
  };
  const row = (id: string) => (P.rows as any[]).find((r) => r.id === id);
  const T = P.totals ?? {}, pl = T.planned ?? {};
  const current = n(P.current), hasEm = current > 0;
  const sharePct = current > 0 ? (n(pl.tco2e) / current) * 100 : 0;
  const esgTarget = !!d.data.esg?.target;

  return (
    <>
      <SmeHead lede="Choose the actions that suit your factory, see what each saves in tonnes and rupees, and check whether they reach your target.">
        {d.company.isExample && <Sample />}
      </SmeHead>

      {!hasEm && <div className="sme-callout warn">No Scope 1 or 2 emissions are entered for {d.fy}, so actions cannot be sized yet. <Link to="/sme/emissions">Add your bills in Emissions</Link> first.</div>}
      {prev && can && <div className="sme-callout pl-copy"><span>Your plan for {prev.fy} has {prev.doc.items!.length} action{prev.doc.items!.length === 1 ? '' : 's'}. Each year keeps its own plan.</span><button type="button" className="btn sm p" onClick={copyPrev}>Bring it into {d.fy}</button></div>}

      <Kpis>
        <Kpi label="Cut a year" value={f1(pl.tco2e)} unit={`tCO₂e · ${f0(sharePct)}% of this year`} good={n(pl.tco2e) > 0} />
        <Kpi label="Saving a year" value={rupees(pl.save)} unit="at your prices" good={n(pl.save) > 0} />
        <Kpi label="Investment" value={rupees(pl.cost)} unit={pl.payback ? `pays back in ${years(pl.payback)}` : 'planned actions'} />
        <Kpi label={`Target ${P.target?.label ?? ''}`} value={P.base?.t > 0 ? (P.reaches ? 'On track' : `${f1(P.gap)} t short`) : '—'} unit={P.base?.t > 0 ? `${f0(P.target?.pct)}% below ${P.base?.label}` : 'set it below'} good={!!P.reaches} />
      </Kpis>
      <p className="muted small pl-kpinote">Counts actions marked planned, in progress or done. Ideas are shown but not counted.</p>

      <div className="seg pl-tabs" role="tablist">
        {([['actions', `Actions (${items.length})`], ['target', 'Target and path'], ['prices', 'Prices used']] as [Tab, string][]).map(([k, t]) =>
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}
      </div>

      {tab === 'actions' && <>
        <div className="card">
          <div className="pl-h2row"><h2>Your actions</h2>{n(T.tco2e) > 0 && <span className="muted small">All actions incl. ideas: {f1(T.tco2e)} t · {rupees(T.save)} a year</span>}</div>
          {!items.length && <div className="empty pl-empty">No actions yet. Start with the library below: LED lighting and compressed-air leaks are quick wins in most factories.</div>}
          <div className="pl-list">{items.map((it) => {
            const l = lib(it.lib), r = row(it.id), isOpen = open === it.id;
            if (it.lib && !l) return null;
            return (
              <div key={it.id} className={`pl-item${isOpen ? ' open' : ''}`}>
                <div className="pl-sum">
                  <button type="button" className="pl-t" onClick={() => setOpen(isOpen ? null : it.id)} aria-expanded={isOpen}>
                    <span className="pl-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                    <span><b>{l ? l.title : it.title || 'Your own action'}</b>
                      <small>{r ? (r.ready ? cutText(r, F) : r.why) : 'Calculating…'}{it.owner ? ` · ${it.owner}` : ''}{it.date ? ` · by ${dmy(it.date)}` : ''}</small></span>
                  </button>
                  <div className="pl-figs">
                    <span><b className="num">{r?.ready ? (r.lib === 'pf' ? '—' : f1(r.tco2e)) : '—'}</b><small>{r?.lib === 'pf' ? 'not counted' : 't a year'}</small></span>
                    <span><b className="num">{r?.ready ? rupees(r.save) : '—'}</b><small>saved a year</small></span>
                    <span><b className="num">{r && r.cost !== null ? rupees(r.cost) : '—'}</b><small>{r && r.cost === null ? 'enter size' : 'cost'}</small></span>
                    <span><b className="num">{r?.ready ? years(r.payback) : '—'}</b><small>payback</small></span>
                  </div>
                  <select className="input pl-status" aria-label="Status" disabled={!can} value={it.status ?? 'idea'} onChange={(e) => setItem(it.id, { status: e.target.value })}>
                    {STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </div>
                {r?.capped && <p className="note warn small pl-capped">Your actions on {srcName(r.source, F)} add up to more than you use, so they are scaled down to your total.</p>}
                {isOpen && <Detail it={it} l={l} r={r} F={F} can={can} onChange={(v) => setItem(it.id, v)} onRemove={() => remove(it.id)} />}
              </div>);
          })}</div>
        </div>

        <div className="card">
          <div className="pl-h2row"><h2>Action library</h2>{can && <button type="button" className="btn sm" onClick={() => add(null)}><Icon name="plus" />Your own action</button>}</div>
          <p className="muted" style={{ margin: '4px 0 12px' }}>{A.note}</p>
          <div className="pl-lib">{libs.map((l) => {
            const used = items.some((x) => x.lib === l.id);
            return (
              <div key={l.id} className={`pl-libc${used ? ' used' : ''}`}>
                <b>{l.title}</b>
                <p>{l.plain}</p>
                <small className="muted">{typical(l, F)}</small>
                <div className="pl-libf">{used ? <span className="chip">In your plan</span> : can ? <button type="button" className="btn sm" onClick={() => add(l)}><Icon name="plus" />Add</button> : null}</div>
              </div>);
          })}</div>
        </div>
      </>}

      {tab === 'target' && <TargetTab doc={doc} P={P} d={d} A={A} can={can} save={save} esgTarget={esgTarget} />}
      {tab === 'prices' && <PricesTab doc={doc} P={P} A={A} F={F} can={can} save={save} />}
    </>);
}

function cutText(r: any, F: Record<string, any>) {
  if (r.lib === 'solar') return `${f0(r.kw)} kWp makes ${f0(r.cut)} kWh a year`;
  if (r.lib === 'pf') return `${f0(r.kvar)} kVAr of capacitors · removes the penalty`;
  const s = `Cuts ${f0(r.cut)} ${r.unit} of ${srcName(r.source, F)}`;
  return r.to ? `${s}, adds ${f0(r.add)} ${r.addUnit} of ${srcName(r.to, F)}` : s;
}
function typical(l: Lib, F: Record<string, any>) {
  if (l.from === 'solar') return 'Figures from the Solar page';
  if (l.from === 'pf') return 'Figures from the Bill analyser';
  const src = l.sources ? l.sources.map((k) => srcName(k, F)).join(' or ') : srcName(l.source ?? 'grid', F);
  if (l.to) return `Replaces ${src} with ${(l.toOptions ?? [l.to]).map((k) => srcName(k, F)).join(' or ')}`;
  return `Typically ${f0(l.pct)}% less on about ${f0(l.share)}% of your ${src}`;
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="pl-f"><label htmlFor={id}>{label}{hint && <small>{hint}</small>}</label>{children(id)}</div>;
}
const numVal = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const numIn = (s: string): number | '' => (s === '' ? '' : Number(s));

function Detail({ it, l, r, F, can, onChange, onRemove }: { it: Item; l?: Lib; r: any; F: Record<string, any>; can: boolean; onChange: (v: Partial<Item>) => void; onRemove: () => void }) {
  const own = !l, from = l?.from;
  const basis = l?.cost.basis ?? 'lump';
  const rate = l?.cost.rate ?? 0;
  const ownSources = Object.keys(F).filter((k) => F[k].scope !== 3 && k !== 'solar');
  return (
    <div className="pl-detail">
      {l && <p className="pl-plain">{l.plain}</p>}
      <div className="pl-grid">
        {own && <Field label="What you will do">{(id) => <input id={id} className="input" disabled={!can} value={it.title ?? ''} placeholder="e.g. Insulate the plating tanks" onChange={(e) => onChange({ title: e.target.value })} />}</Field>}
        {own && <Field label="What it cuts">{(id) => <select id={id} className="input" disabled={!can} value={it.source ?? 'grid'} onChange={(e) => onChange({ source: e.target.value })}>{ownSources.map((k) => <option key={k} value={k}>{F[k].label}</option>)}</select>}</Field>}
        {l?.sources && l.sources.length > 1 && <Field label="Fuel it applies to">{(id) => <select id={id} className="input" disabled={!can} value={r?.source ?? it.source ?? l.sources![0]} onChange={(e) => onChange({ source: e.target.value })}>{l.sources!.map((k) => <option key={k} value={k}>{F[k]?.label ?? k}</option>)}</select>}</Field>}
        {l?.toOptions && <Field label="Replaced by">{(id) => <select id={id} className="input" disabled={!can} value={r?.to ?? it.to ?? l.to} onChange={(e) => onChange({ to: e.target.value })}>{l.toOptions!.map((k) => <option key={k} value={k}>{k === 'solar' ? 'Rooftop solar' : 'Grid electricity'}</option>)}</select>}</Field>}
        {!from && <>
          <Field label="Part of your use it touches" hint={l ? `Typical ${f0(l.share)}%` : 'Share of this source the action affects'}>{(id) => <div className="sme-unit"><input id={id} className="input num" type="number" min={0} max={100} step="any" disabled={!can} value={numVal(it.share)} placeholder={l ? String(l.share) : ''} onChange={(e) => onChange({ share: numIn(e.target.value) })} /><span>%</span></div>}</Field>
          <Field label={l?.to ? 'How much of that part is switched' : 'Saving on that part'} hint={l ? `Typical ${f0(l.pct)}%` : undefined}>{(id) => <div className="sme-unit"><input id={id} className="input num" type="number" min={0} max={100} step="any" disabled={!can} value={numVal(it.pct)} placeholder={l ? String(l.pct) : ''} onChange={(e) => onChange({ pct: numIn(e.target.value) })} /><span>%</span></div>}</Field>
        </>}
        {l && (basis === 'per_unit' || basis === 'per_kw') && <Field label={basis === 'per_kw' ? 'Size' : 'How many'} hint={`About ₹${f0(rate)} per ${basis === 'per_kw' ? 'kW' : (l.cost.unit ?? 'item').replace(/s$/, '')}`}>{(id) => <div className="sme-unit"><input id={id} className="input num" type="number" min={0} step="any" disabled={!can} value={numVal(it.qty)} onChange={(e) => onChange({ qty: numIn(e.target.value) })} /><span>{l.cost.unit === 'kVA of transformer' ? 'kVA' : basis === 'per_kw' ? 'kW' : 'nos'}</span></div>}</Field>}
        <Field label={own ? 'Cost' : 'Your quoted cost'} hint={own ? 'From a quote or your estimate' : 'Leave empty to use the typical cost'}>{(id) => <div className="sme-unit"><input id={id} className="input num" type="number" min={0} step="any" disabled={!can} value={numVal(it.cost)} onChange={(e) => onChange({ cost: numIn(e.target.value) })} /><span>₹</span></div>}</Field>
        {own && <Field label="Lasts">{(id) => <div className="sme-unit"><input id={id} className="input num" type="number" min={1} step="any" disabled={!can} value={numVal(it.life)} onChange={(e) => onChange({ life: numIn(e.target.value) })} /><span>years</span></div>}</Field>}
        <Field label="Owner">{(id) => <input id={id} className="input" disabled={!can} value={it.owner ?? ''} placeholder="Who makes it happen" onChange={(e) => onChange({ owner: e.target.value })} />}</Field>
        <Field label={it.status === 'done' ? 'Done on' : 'Target date'} hint="Counts from the financial year of this date">{(id) => <input id={id} className="input" type="date" disabled={!can} value={it.date ?? ''} onChange={(e) => onChange({ date: e.target.value })} />}</Field>
      </div>
      {from && <p className="small" style={{ margin: '10px 0 0' }}>{from === 'solar' ? <>Size, cost and saving come from <Link to="/sme/solar">Solar</Link>.</> : <>Penalty, capacitor size and cost come from the <Link to="/sme/bills">Bill analyser</Link>.</>}</p>}
      {r?.achieved && <p className="muted small" style={{ margin: '8px 0 0' }}>Done in or before this year, so it is already in this year’s figures and is not taken off the path again.</p>}
      {l?.notes && <p className="muted small pl-notes">{l.notes}{l.ref && <> <span className="pl-ref">Typical figures: {l.ref}.</span></>}</p>}
      <div className="pl-foot">
        <Evidence module="plan" item={it.id} label="Quote or invoice" />
        {can && <button type="button" className="btn sm ghost danger" onClick={onRemove}>Remove</button>}
      </div>
    </div>);
}

// ------------------------------------------------------------------ target --
function TargetTab({ doc, P, d, A, can, save, esgTarget }: { doc: PlanDoc; P: any; d: any; A: any; can: boolean; save: (v: Partial<PlanDoc>) => void; esgTarget: boolean }) {
  const { set } = useSme();
  const curEnd = fyEndOf(d.fy);
  const base = P.base ?? {}, tgt = P.target ?? {};
  const kind = doc.base ?? 'this';
  const yearsTo = Array.from({ length: Math.max(1, 2040 - curEnd) }, (_, i) => curEnd + 1 + i).filter((y) => y <= 2036 || y === 2040);
  const baseYears = Array.from({ length: curEnd - 2016 }, (_, i) => curEnd - 1 - i);
  const id = useId();
  const path15 = () => { const y = n(doc.targetYear) || tgt.year || A.target?.year || 2030; save({ targetYear: y, targetPct: Math.min(90, Math.round(n(A.target?.rate_15c ?? 4.2) * (y - n(base.year)) * 10) / 10) }); };
  return (
    <div className="pl-tgt">
      <div className="card">
        <div className="pl-h2row"><h2>Emissions path, Scope 1 and 2</h2>{d.company.isExample && <Sample />}</div>
        {n(base.t) > 0 ? <PathChart path={P.path} target={tgt} /> : <div className="empty">Add this year’s emissions to draw the path.</div>}
        {n(base.t) > 0 && (P.reaches
          ? <div className="note ok" style={{ marginTop: 10 }}>The counted actions bring emissions to {f1(P.endT)} t in {tgt.label}, within the target of {f1(tgt.t)} t.</div>
          : <div className="note warn" style={{ marginTop: 10 }}>The counted actions bring emissions to {f1(P.endT)} t in {tgt.label}: {f1(P.gap)} t above the target of {f1(tgt.t)} t. Add actions, widen their scope, or move ideas to planned.</div>)}
        {n(P.growth) > 0 && <p className="muted small" style={{ margin: '8px 0 0' }}>Assumes output grows {f1(P.growth)}% a year; each action’s share of the cut grows with it.</p>}
      </div>
      <div className="card">
        <h2>Your target</h2>
        <div className="pl-grid1">
          <Field label="Base year">{(i) => <select id={i} className="input" disabled={!can} value={kind} onChange={(e) => save({ base: e.target.value as PlanDoc['base'] })}>
            <option value="this">This year, {d.fy} ({f1(P.current)} t)</option>
            {P.prior !== null && P.prior !== undefined && <option value="prior">Last year, {fyLabel(curEnd - 1)} ({f1(P.prior)} t)</option>}
            <option value="own">An earlier year (enter it)</option>
          </select>}</Field>
          {kind === 'own' && <>
            <Field label="Which year">{(i) => <select id={i} className="input" disabled={!can} value={numVal(doc.baseYear)} onChange={(e) => save({ baseYear: numIn(e.target.value) })}><option value="">Choose…</option>{baseYears.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>}</Field>
            <Field label="Scope 1 + 2 that year" hint="From that year’s records">{(i) => <div className="sme-unit"><input id={i} className="input num" type="number" min={0} step="any" disabled={!can} value={numVal(doc.baseT)} onChange={(e) => save({ baseT: numIn(e.target.value) })} /><span>tCO₂e</span></div>}</Field>
            {base.kind !== 'own' && <p className="note warn small" style={{ margin: 0 }}>Enter the year and its total; until then this year is used.</p>}
          </>}
          <Field label="Target year">{(i) => <select id={i} className="input" disabled={!can} value={tgt.year ?? ''} onChange={(e) => save({ targetYear: Number(e.target.value) })}>{yearsTo.map((y) => <option key={y} value={y}>{fyLabel(y)} (March {y})</option>)}</select>}</Field>
          <Field label="Cut below the base year">{(i) => <div className="sme-unit"><input id={i} className="input num" type="number" min={0} max={100} step="any" disabled={!can} value={numVal(doc.targetPct)} placeholder={String(tgt.pct ?? A.target?.pct ?? 30)} onChange={(e) => save({ targetPct: numIn(e.target.value) })} /><span>%</span></div>}</Field>
          <Field label="Output growth" hint="Optional. More output usually means more energy">{(i) => <div className="sme-unit"><input id={i} className="input num" type="number" min={0} max={50} step="any" disabled={!can} value={numVal(doc.growth)} placeholder="0" onChange={(e) => save({ growth: numIn(e.target.value) })} /><span>% a year</span></div>}</Field>
        </div>
        {can && <div className="row pl-presets" aria-labelledby={id}><span id={id} className="muted small">Quick choice:</span>
          <button type="button" className="btn sm" onClick={() => save({ targetPct: A.target?.pct ?? 30, targetYear: A.target?.year ?? 2030 })}>{f0(A.target?.pct ?? 30)}% by {A.target?.year ?? 2030}</button>
          <button type="button" className="btn sm" onClick={path15}>1.5 °C path ({f1(A.target?.rate_15c ?? 4.2)}% a year)</button></div>}
        <p className="muted small" style={{ margin: '10px 0 0' }}>{A.target?.note}</p>
        <div className="pl-tsum">
          <div><span className="lbl">Base</span><b className="num">{f1(base.t)} t</b><small>{base.label}</small></div>
          <div><span className="lbl">Target</span><b className="num">{f1(tgt.t)} t</b><small>{tgt.label}</small></div>
          <div><span className="lbl">Cut needed</span><b className="num">{f1(Math.max(0, n(base.t) - n(tgt.t)))} t</b><small>{f0(tgt.pct)}%</small></div>
        </div>
        {n(base.t) > 0 && !esgTarget && <div className="sme-callout" style={{ marginTop: 12 }}>Your ESG answers say you have no reduction target yet.{can && <> <button type="button" className="linkbtn" onClick={() => set('esg.target', true)}>Record this target in ESG</button></>}</div>}
      </div>
    </div>);
}

/** Line chart: actual years, business as usual, with the counted actions, and the straight target line. */
export function PathChart({ path, target, compact = false }: { path: any[]; target: any; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700;
  if (!path?.length) return null;
  const W = compact || narrow ? 420 : 640, H = compact ? 210 : narrow ? 260 : 250, L = 48, R = compact || narrow ? 16 : 96, Tp = 14, B = 28;
  const vals = path.flatMap((p) => [p.actual, p.bau, p.withPlan, p.target]).filter((v) => v !== null && v !== undefined) as number[];
  const max = Math.max(...vals, 1) * 1.08;
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (path.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (path.length - 1));
  const y = (v: number) => Tp + (1 - v / top) * (H - Tp - B);
  const line = (k: string) => path.map((p, i) => (p[k] === null || p[k] === undefined ? null : `${x(i)},${y(p[k])}`)).filter(Boolean).join(' ');
  const last = (k: string) => { for (let i = path.length - 1; i >= 0; i--) if (path[i][k] !== null && path[i][k] !== undefined) return [i, path[i][k]] as [number, number]; return null; };
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const series: [string, string, string][] = [['bau', 'No action', 'pl-s-bau'], ['withPlan', 'With your plan', 'pl-s-plan'], ['target', 'Target', 'pl-s-tgt']];
  const h = hover !== null ? path[hover] : null;
  return (
    <div className="pl-chart">
      <div className="pl-legend" aria-hidden="true">
        <span><i className="pl-k-act" />Actual</span>{series.map(([, t, c]) => <span key={c}><i className={`pl-k ${c}`} />{t}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Emissions path to ${target?.label ?? ''}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="pl-grid" /><text x={L - 8} y={y(t) + 4} className="pl-ax" textAnchor="end">{f0(t)}</text></g>)}
        {path.map((p, i) => <text key={p.year} x={x(i)} y={H - 8} className="pl-ax" textAnchor="middle">{compact || narrow || path.length > 8 ? `’${String(p.year % 100).padStart(2, '0')}` : p.label.replace('FY ', '')}</text>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={Tp} y2={H - B} className="pl-cross" />}
        {series.map(([k, , c]) => <polyline key={k} points={line(k)} className={`pl-line ${c}`} />)}
        {path.map((p, i) => p.actual !== null && p.actual !== undefined ? <circle key={i} cx={x(i)} cy={y(p.actual)} r={5} className="pl-dot" /> : null)}
        {!compact && !narrow && series.map(([k, t, c]) => { const e = last(k); return e ? <text key={k} x={x(e[0]) + 8} y={y(e[1]) + 4 + (k === 'bau' ? -6 : k === 'target' ? 8 : 0)} className={`pl-dl ${c}`}>{t}</text> : null; })}
        {path.map((p, i) => <rect key={p.year} x={x(i) - (W - L - R) / Math.max(2, path.length - 1) / 2} y={Tp} width={(W - L - R) / Math.max(1, path.length - 1)} height={H - Tp - B} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />)}
      </svg>
      <div className="pl-read" aria-live="polite">{h ? <><b>{h.label}</b>{h.actual !== null && <span>Actual {f1(h.actual)} t</span>}{h.bau !== null && <span>No action {f1(h.bau)} t</span>}{h.withPlan !== null && <span>With plan {f1(h.withPlan)} t</span>}{h.target !== null && <span>Target {f1(h.target)} t</span>}</> : <span className="muted">tCO₂e a year. Point at a year to read its figures.</span>}</div>
      {!compact && <details className="pl-tbl"><summary>Show as a table</summary>
        <div className="sme-scroll"><table className="sme-tbl"><thead><tr><th>Year</th><th className="r">Actual</th><th className="r">No action</th><th className="r">With plan</th><th className="r">Target</th></tr></thead>
          <tbody>{path.map((p) => <tr key={p.year}><td>{p.label}</td>{['actual', 'bau', 'withPlan', 'target'].map((k) => <td key={k} className="r">{p[k] === null ? '—' : f1(p[k])}</td>)}</tr>)}</tbody></table></div></details>}
    </div>);
}
function niceStep(raw: number) { const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9))); const m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }

// ------------------------------------------------------------------ prices --
function PricesTab({ doc, P, A, F, can, save }: { doc: PlanDoc; P: any; A: any; F: Record<string, any>; can: boolean; save: (v: Partial<PlanDoc>) => void }) {
  const own = doc.prices ?? {};
  const keys = ['grid', ...Object.keys(A.prices ?? {})];
  return (
    <div className="card">
      <h2>Prices used for savings</h2>
      <p className="muted" style={{ margin: '4px 0 10px' }}>Electricity uses the energy rate from your power bill (Bill analyser). Fuels use typical prices until you enter what you pay.</p>
      <div className="pl-prices">{keys.map((k) => (
        <Field key={k} label={F[k]?.label ?? k} hint={k === 'grid' ? 'Empty: your bill’s energy rate' : `Empty: typical ₹${f0(A.prices[k])}`}>{(id) => <div className="sme-unit">
          <input id={id} className="input num" type="number" min={0} step="any" disabled={!can} value={numVal(own[k])} placeholder={f1(P.prices?.[k])} onChange={(e) => save({ prices: { ...own, [k]: numIn(e.target.value) } })} /><span>₹/{F[k]?.unit ?? 'unit'}</span></div>}</Field>))}
      </div>
    </div>);
}
