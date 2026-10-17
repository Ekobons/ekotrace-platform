/**
 * ESG & materiality.
 *  Frameworks & set-up   which frameworks the company reports under, what kind of materiality assessment each one needs
 *                        (double: ESRS; impact: GRI; financial: IFRS S1/S2, SASB; none: VSME, ADX, DFM, Tadawul, CDP),
 *                        industry, thresholds, value chain, stakeholders consulted, methodology.
 *  Double materiality    every ESRS topic scored for impact (inside-out) and financial effect (outside-in), the matrix,
 *                        suppliers' own view from the supplier portal, decision with reasons, approval by a second person.
 *  ESG data              questions of the material topics for the industry, with the reference in each framework chosen.
 *  Content index         where each answer sits in each framework.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, download, type EsgData, type EsgFinancial, type EsgImpact, type EsgQuestion, type EsgStakeholder, type EsgTopic } from '../lib/api';
import { Icon } from '../components/Icon';

type Tab = 'setup' | 'dma' | 'data' | 'index';
const TABS: [Tab, string][] = [['setup', 'Frameworks & set-up'], ['dma', 'Double materiality'], ['data', 'ESG data'], ['index', 'Content index']];
const MAT: Record<string, [string, string]> = { double: ['Double materiality', 'bad'], impact: ['Impact materiality', 'warn'], financial: ['Financial materiality', 'info'], none: ['No assessment required', 'grey'] };
const STATUS: Record<string, [string, string]> = { draft: ['Draft', 'grey'], review: ['Waiting for approval', 'warn'], approved: ['Approved', ''] };
const PILLAR: Record<string, string> = { E: '#2E9E6B', S: '#3B7DD8', G: '#8A5CC9' };
const f2 = (x: number | null | undefined) => (x == null ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: 2 }));
type Act = (fn: () => Promise<unknown>, msg: string) => Promise<void>;

/** Same scoring as the server (lib/esg.ts). */
const v15 = (x?: number) => (x != null && x >= 1 && x <= 5 ? x : null);
const mean = (xs: (number | null)[]) => { const ok = xs.filter((x): x is number => x != null); return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null; };
function impactScore(i: EsgImpact): number | null {
  const sev = i.nature === 'positive' ? mean([v15(i.scale), v15(i.scope)]) : mean([v15(i.scale), v15(i.scope), v15(i.irremediability)]);
  if (sev == null) return null;
  if (i.type !== 'potential' || (i.humanRights && i.nature !== 'positive')) return Math.round(sev * 100) / 100;
  const l = v15(i.likelihood);
  return l == null ? null : Math.round(((sev * l) / 5) * 100) / 100;
}
const financialScore = (f: EsgFinancial) => { const m = v15(f.magnitude), l = v15(f.likelihood); return m == null || l == null ? null : Math.round(((m * l) / 5) * 100) / 100; };

export function Esg() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'setup') as Tab;
  const year = Number(sp.get('year') ?? new Date().getFullYear() - 1);
  const set = (x: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(x)) { if (v) n.set(k, v); else n.delete(k); } setSp(n, { replace: true }); };
  const [d, setD] = useState<EsgData | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.esg(year).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const act: Act = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  const now = new Date().getFullYear();
  const years = [...new Set([...(d?.years ?? []), now, now - 1, now - 2, year])].sort((a, b) => b - a);
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose</span><h1>ESG & materiality</h1>
          <div className="muted">Choose the frameworks you report under, run the materiality assessment they need — double materiality where ESRS applies — and collect the ESG data of your material topics, with the questions that fit your industry.</div></div>
        <label className="field" style={{ minWidth: 110 }}><span>Reporting year</span>
          <select className="input" value={year} onChange={(e) => set({ year: e.target.value })}>{years.map((y) => <option key={y}>{y}</option>)}</select></label>
        {d?.assessment && <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => download(`/api/esg/export?year=${year}`, `ESG ${year}.xlsx`).catch((e) => toast((e as Error).message))}><Icon name="download" /> Export (Excel)</button>}
      </div>
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}>{l}</button>)}</div>
      {!d ? <div className="card empty">Loading…</div> : <>
        {tab === 'setup' && <Setup key={`${year}-${tick}`} d={d} act={act} next={() => set({ tab: 'dma' })} />}
        {tab === 'dma' && <Dma d={d} act={act} />}
        {tab === 'data' && <DataTab d={d} act={act} />}
        {tab === 'index' && <IndexTab d={d} />}
      </>}
    </div>
  );
}

function NeedsBanner({ d, codes }: { d: EsgData; codes: string[] }) {
  const sel = d.catalogue.frameworks.filter((f) => codes.includes(f.code));
  const imp = sel.some((f) => f.materiality === 'double' || f.materiality === 'impact'), fin = sel.some((f) => f.materiality === 'double' || f.materiality === 'financial');
  const dbl = sel.some((f) => f.materiality === 'double');
  if (!sel.length) return <div className="note info small">Choose the frameworks you report under. The tool tells you which kind of materiality assessment they need.</div>;
  const by = (k: string[]) => sel.filter((f) => k.includes(f.materiality)).map((f) => f.name).join(', ');
  return <div className={`note ${imp && fin ? 'warn' : 'info'} small`}>
    {dbl ? <><b>Double materiality assessment required</b> ({by(['double'])}): assess every topic for its impact on people and the environment <i>and</i> its financial effect on the company; a topic is material if either is.</>
      : imp && fin ? <><b>Both sides needed</b> — impact materiality for {by(['impact'])} and financial materiality for {by(['financial'])}. In practice this is a double materiality assessment.</>
        : imp ? <><b>Impact materiality</b> ({by(['impact'])}): material topics are those with significant impacts on the economy, environment and people.</>
          : fin ? <><b>Financial materiality</b> ({by(['financial'])}): material topics are sustainability risks and opportunities that could affect the company's prospects.</>
            : <><b>No materiality assessment required</b> by {by(['none'])}. One is still recommended to decide what to report and to prepare for ISSB or ESRS.</>}
  </div>;
}

// ------------------------------------------------------------------ set-up --
function Setup({ d, act, next }: { d: EsgData; act: Act; next: () => void }) {
  const a = d.assessment;
  const [fw, setFw] = useState<string[]>(a?.frameworks ?? []);
  const [industry, setIndustry] = useState(a?.industry ?? '');
  const [ti, setTi] = useState(String(a?.threshold_impact ?? 3)), [tf, setTf] = useState(String(a?.threshold_financial ?? 3));
  const [vc, setVc] = useState(a?.value_chain ?? ''), [meth, setMeth] = useState(a?.methodology ?? '');
  const [st, setSt] = useState<EsgStakeholder[]>(a?.stakeholders ?? []);
  const ro = !d.can.edit || a?.status === 'review';
  const ind = d.catalogue.industries.find((i) => i.code === industry);
  const save = () => act(() => api.esgSetup({ year: d.year, industry: industry || null, frameworks: fw, thresholdImpact: Number(ti), thresholdFinancial: Number(tf), valueChain: vc, methodology: meth,
    stakeholders: st.filter((s) => s.group.trim()).map((s) => ({ group: s.group.trim(), method: s.method.trim(), when: s.when.trim(), people: s.people.trim() })) }), 'Saved');
  const regions = [...new Set(d.catalogue.frameworks.map((f) => f.region))];
  return <>
    {a?.status === 'review' && <div className="note warn small">Waiting for approval — approve or return it on the Double materiality tab before changing the set-up.</div>}
    <div className="card"><h3 style={{ marginTop: 0 }}>1 · Which frameworks do you report under?</h3>
      {regions.map((r) => <div key={r}><div className="eyebrow" style={{ margin: '10px 0 6px' }}>{r}</div>
        <div className="esg-fw">{d.catalogue.frameworks.filter((f) => f.region === r).map((f) => <label key={f.code} className={`esg-fwc${fw.includes(f.code) ? ' on' : ''}`}>
          <div className="row" style={{ gap: 8 }}><input type="checkbox" disabled={ro} checked={fw.includes(f.code)} onChange={(e) => setFw(e.target.checked ? [...fw, f.code] : fw.filter((x) => x !== f.code))} />
            <b className="grow">{f.name}</b><span className={`chip ${MAT[f.materiality]![1]}`}>{MAT[f.materiality]![0]}</span></div>
          <div className="small">{f.who}</div><div className="muted small">{f.note}</div></label>)}</div></div>)}
      <div style={{ marginTop: 12 }}><NeedsBanner d={d} codes={fw} /></div>
    </div>
    <div className="card"><h3 style={{ marginTop: 0 }}>2 · Industry and thresholds</h3>
      <div className="vform">
        <label className="field"><span>Industry (sets the industry questions and the topics usually material)</span><select className="input" disabled={ro} value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">Choose…</option>{d.catalogue.industries.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}</select></label>
        <div className="field"><span>Usually material in this industry</span><div className="row" style={{ gap: 4, flexWrap: 'wrap', minHeight: 36, alignItems: 'center' }}>{ind ? ind.likely.map((c) => <span key={c} className="chip info">{c} {d.catalogue.topics.find((t) => t.code === c)?.name}</span>) : <span className="muted small">—</span>}</div></div>
        <label className="field"><span>Impact threshold (1–5): material at or above</span><input className="input num" disabled={ro} value={ti} onChange={(e) => setTi(e.target.value)} /></label>
        <label className="field"><span>Financial threshold (1–5): material at or above</span><input className="input num" disabled={ro} value={tf} onChange={(e) => setTf(e.target.value)} /></label>
        <label className="field span2"><span>Value chain covered (upstream, own operations, downstream)</span><textarea className="input" rows={3} disabled={ro} value={vc} onChange={(e) => setVc(e.target.value)} /></label>
        <label className="field span2"><span>Method (how the long list was built, who scored, how stakeholder input was used)</span><textarea className="input" rows={3} disabled={ro} value={meth} onChange={(e) => setMeth(e.target.value)} /></label>
      </div>
    </div>
    <div className="card"><h3 style={{ marginTop: 0 }}>3 · Stakeholders consulted</h3>
      <div className="scrollx"><table className="t"><thead><tr><th>Group</th><th>How</th><th>When</th><th className="num">People</th><th /></tr></thead>
        <tbody>{st.map((s, i) => <tr key={i}>
          {(['group', 'method', 'when', 'people'] as const).map((k) => <td key={k}><input className={`input${k === 'people' ? ' num' : ''}`} disabled={ro} value={s[k]} placeholder={{ group: 'e.g. Employees', method: 'Survey, interviews…', when: 'YYYY-MM', people: '' }[k]} onChange={(e) => setSt(st.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>)}
          <td>{!ro && <button className="btn ghost" aria-label="Remove" onClick={() => setSt(st.filter((_, j) => j !== i))}><Icon name="x" /></button>}</td></tr>)}
          {!st.length && <tr><td colSpan={5} className="muted">None yet. ESRS and GRI expect affected stakeholders to be engaged — employees, communities, suppliers, customers, investors.</td></tr>}</tbody></table></div>
      {!ro && <button className="btn ghost" onClick={() => setSt([...st, { group: '', method: '', when: '', people: '' }])}><Icon name="plus" /> Add a group</button>}
    </div>
    {!ro && <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="btn p" disabled={!fw.length} onClick={() => void save()}>Save set-up</button>{a && <button className="btn" onClick={next}>Go to the assessment →</button>}</div>}
  </>;
}

// --------------------------------------------------------- double materiality --
function Matrix({ d, pick }: { d: EsgData; pick: (t: EsgTopic) => void }) {
  const W = 420, H = 360, P = 40, sx = (x: number) => P + (x / 5) * (W - P - 12), sy = (y: number) => H - P - (y / 5) * (H - P - 12);
  const ti = d.assessment?.threshold_impact ?? 3, tf = d.assessment?.threshold_financial ?? 3;
  const pts = d.topics.filter((t) => t.assessed);
  return <svg viewBox={`0 0 ${W} ${H}`} className="esg-mx" role="img" aria-label="Double materiality matrix">
    <rect x={sx(tf)} y={sy(5)} width={sx(5) - sx(tf)} height={sy(ti) - sy(5)} fill="#F2C46D33" />
    <rect x={sx(0)} y={sy(5)} width={sx(5) - sx(0)} height={sy(ti) - sy(5)} fill="#F2C46D1A" />
    <rect x={sx(tf)} y={sy(ti)} width={sx(5) - sx(tf)} height={sy(0) - sy(ti)} fill="#F2C46D1A" />
    {[0, 1, 2, 3, 4, 5].map((g) => <g key={g}><line x1={sx(g)} x2={sx(g)} y1={sy(0)} y2={sy(5)} stroke="#0001" /><line x1={sx(0)} x2={sx(5)} y1={sy(g)} y2={sy(g)} stroke="#0001" />
      <text x={sx(g)} y={H - P + 14} fontSize="10" textAnchor="middle" fill="#567">{g}</text><text x={P - 8} y={sy(g) + 3} fontSize="10" textAnchor="end" fill="#567">{g}</text></g>)}
    <line x1={sx(tf)} x2={sx(tf)} y1={sy(0)} y2={sy(5)} stroke="#C98A10" strokeDasharray="4 3" /><line x1={sx(0)} x2={sx(5)} y1={sy(ti)} y2={sy(ti)} stroke="#C98A10" strokeDasharray="4 3" />
    <text x={(sx(0) + sx(5)) / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="#345">Financial materiality (effect on the company) →</text>
    <text transform={`translate(12 ${(sy(0) + sy(5)) / 2}) rotate(-90)`} fontSize="11" textAnchor="middle" fill="#345">Impact materiality (on people and planet) →</text>
    {pts.map((t) => { const x = sx(t.financialScore ?? 0), y = sy(t.impactScore ?? 0); return <g key={t.code} style={{ cursor: 'pointer' }} onClick={() => pick(t)}>
      <circle cx={x} cy={y} r={11} fill={t.material ? PILLAR[t.pillar] : '#fff'} stroke={PILLAR[t.pillar]} strokeWidth={2} />
      <text x={x} y={y + 3.5} fontSize="9.5" fontWeight="700" textAnchor="middle" fill={t.material ? '#fff' : PILLAR[t.pillar]}>{t.code}</text><title>{`${t.code} ${t.name}: impact ${f2(t.impactScore)}, financial ${f2(t.financialScore)}${t.material ? ' — material' : ''}`}</title></g>; })}
  </svg>;
}

function Dma({ d, act }: { d: EsgData; act: Act }) {
  const { me } = useApp();
  const [open, setOpen] = useState<EsgTopic | null>(null);
  const [note, setNote] = useState('');
  const a = d.assessment;
  if (!a) return <div className="card empty">Set up the year first: frameworks and industry on the first tab.</div>;
  const done = d.topics.filter((t) => t.assessed).length;
  const ro = !d.can.edit || a.status === 'review';
  return <>
    <div className="kgrid4">
      <div className="card kpi"><div className="lbl">Status</div><div><span className={`chip ${STATUS[a.status]![1]}`}>{STATUS[a.status]![0]}</span></div><div className="muted small">{a.status === 'approved' ? `${a.approved_name ?? ''} · ${a.approved_at ? new Date(a.approved_at).toLocaleDateString('en-GB') : ''}` : a.status === 'review' ? `sent by ${a.sent_name ?? ''}` : a.approval_note ? `Returned: ${a.approval_note}` : `last change ${a.updated_name ?? ''}`}</div></div>
      <div className="card kpi"><div className="lbl">Topics assessed</div><div className="v">{done} / {d.topics.length}</div></div>
      <div className="card kpi"><div className="lbl">Material topics</div><div className="v">{d.material.length}</div><div className="muted small">{d.material.join(' · ') || '—'}</div></div>
      <div className="card kpi"><div className="lbl">Suppliers who answered</div><div className="v">{d.suppliersAnswered}</div><div className="muted small">ESG impact section of the supplier portal</div></div>
    </div>
    <NeedsBanner d={d} codes={a.frameworks} />
    <div className="cols2">
      <div className="card"><h3 style={{ marginTop: 0 }}>Matrix</h3><Matrix d={d} pick={setOpen} />
        <div className="muted small">Filled = material. Dashed lines: thresholds (impact {a.threshold_impact}, financial {a.threshold_financial}). <span style={{ color: PILLAR.E }}>● Environment</span> <span style={{ color: PILLAR.S }}>● Social</span> <span style={{ color: PILLAR.G }}>● Governance</span></div></div>
      <div className="card"><h3 style={{ marginTop: 0 }}>How topics are scored</h3>
        <div className="small"><p><b>Impact</b> (inside-out) — severity is the average of <i>scale</i>, <i>scope</i> and <i>irremediability</i> (scale and scope for positive impacts), 1–5. Actual impacts count at full severity; potential impacts are multiplied by likelihood ÷ 5, except potential negative human-rights impacts, where severity alone decides.</p>
          <p><b>Financial</b> (outside-in) — magnitude × likelihood ÷ 5 of the risk or opportunity over the short, medium or long term.</p>
          <p>A topic is material when a score needed by your frameworks reaches its threshold. You can decide otherwise, with a written reason. Topics marked ● are usually material in your industry; supplier ratings come from the supplier portal.</p></div>
        {a.status === 'draft' && d.can.submit && <button className="btn p" onClick={() => void act(() => api.esgSubmit(d.year), 'Sent for approval')}>Send for approval</button>}
        {a.status === 'review' && d.can.decide && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><input className="input grow" placeholder="Note (needed to return)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn p" onClick={() => void act(() => api.esgDecide(d.year, 'approve', note || undefined), 'Approved')}>Approve</button><button className="btn" onClick={() => void act(() => api.esgDecide(d.year, 'return', note), 'Returned')}>Return</button></div>}
        {a.status === 'review' && !d.can.decide && <div className="note info small">A super admin or admin who did not prepare it approves it.</div>}
        {a.status === 'approved' && ['super_admin', 'admin'].includes(me.user.role) && <button className="btn ghost" onClick={() => void act(() => api.esgDecide(d.year, 'reopen'), 'Reopened')}>Reopen</button>}
      </div>
    </div>
    <div className="card"><div className="scrollx"><table className="t">
      <thead><tr><th>Topic</th><th className="num">Impact</th><th className="num">Financial</th><th className="ctr">Suppliers</th><th className="ctr">Material</th><th /></tr></thead>
      <tbody>{d.topics.map((t) => <tr key={t.code}>
        <td><b style={{ color: PILLAR[t.pillar] }}>{t.code}</b> {t.likely && <span title="Usually material in your industry">●</span>} <b>{t.name}</b><div className="muted small">{t.sub}</div></td>
        <td className="num">{f2(t.impactScore)}</td><td className="num">{f2(t.financialScore)}</td>
        <td className="ctr">{t.suppliers.n ? <span className={`chip ${t.suppliers.high.length ? 'warn' : 'grey'}`} title={t.suppliers.list.map((s) => `${s.supplier}: ${s.impact}`).join('\n')}>{t.suppliers.n} · avg {f2(t.suppliers.avgImpact)}</span> : '—'}</td>
        <td className="ctr">{!t.assessed ? <span className="chip grey">Not assessed</span> : t.material ? <span className="chip">Material{t.override != null ? ' (decided)' : ''}</span> : <span className="chip grey">Not material{t.override != null ? ' (decided)' : ''}</span>}</td>
        <td><button className="btn ghost" onClick={() => setOpen(t)}>{ro ? 'View' : 'Assess'}</button></td></tr>)}</tbody></table></div></div>
    {open && <TopicDrawer d={d} t={open} ro={ro} onClose={() => setOpen(null)} act={act} />}
  </>;
}

function Scale({ label, v, set, ro, hint }: { label: string; v?: number; set: (x: number | undefined) => void; ro: boolean; hint: string }) {
  return <label className="field"><span>{label}</span><select className="input" disabled={ro} value={v ?? ''} onChange={(e) => set(e.target.value ? Number(e.target.value) : undefined)}>
    <option value="">—</option>{[1, 2, 3, 4, 5].map((i) => <option key={i} value={i}>{i} · {hint.split('|')[i - 1]}</option>)}</select></label>;
}

function TopicDrawer({ d, t, ro, onClose, act }: { d: EsgData; t: EsgTopic; ro: boolean; onClose: () => void; act: Act }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [i, setI] = useState<EsgImpact>(t.impact ?? { type: 'actual', nature: 'negative', where: ['own'] });
  const [f, setF] = useState<EsgFinancial>(t.financial ?? { kind: 'risk', horizon: 'medium' });
  const [mat, setMat] = useState<string>(t.override == null ? '' : t.override ? 'yes' : 'no');
  const [why, setWhy] = useState(t.rationale);
  const iS = useMemo(() => impactScore(i), [i]), fS = useMemo(() => financialScore(f), [f]);
  const ui = (x: Partial<EsgImpact>) => setI((o) => ({ ...o, ...x })), uf = (x: Partial<EsgFinancial>) => setF((o) => ({ ...o, ...x }));
  const a = d.assessment!;
  const byScore = (d.needs.impact && iS != null && iS >= a.threshold_impact) || (d.needs.financial && fS != null && fS >= a.threshold_financial) || (!d.needs.impact && !d.needs.financial && ((iS ?? 0) >= a.threshold_impact || (fS ?? 0) >= a.threshold_financial));
  const save = () => act(async () => { await api.esgTopic(t.code, { year: d.year, impact: i, financial: f, material: mat === '' ? null : mat === 'yes', rationale: why }); dlg.current?.close(); }, 'Topic saved');
  const sev = 'Minimal|Low|Medium|High|Very high';
  return <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
    <div className="row"><div className="grow"><div className="eyebrow">Double materiality · {t.code}{t.likely ? ' · usually material in your industry' : ''}</div><h2>{t.name}</h2><div className="muted small">{t.sub}</div></div>
      <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
    <div className="card"><div className="row"><h3 className="grow" style={{ margin: 0 }}>Impact on people and the environment</h3><span className="chip info">Score {f2(iS)}</span></div>
      <div className="vform">
        <label className="field"><span>Actual or potential</span><select className="input" disabled={ro} value={i.type ?? ''} onChange={(e) => ui({ type: e.target.value as EsgImpact['type'] })}><option value="actual">Actual (happening)</option><option value="potential">Potential (could happen)</option></select></label>
        <label className="field"><span>Negative or positive</span><select className="input" disabled={ro} value={i.nature ?? ''} onChange={(e) => ui({ nature: e.target.value as EsgImpact['nature'] })}><option value="negative">Negative</option><option value="positive">Positive</option></select></label>
        <Scale label="Scale — how grave or beneficial" v={i.scale} set={(x) => ui({ scale: x })} ro={ro} hint={sev} />
        <Scale label="Scope — how widespread" v={i.scope} set={(x) => ui({ scope: x })} ro={ro} hint="Very local|Local|Regional|National|Global" />
        {i.nature !== 'positive' && <Scale label="Irremediability — how hard to put right" v={i.irremediability} set={(x) => ui({ irremediability: x })} ro={ro} hint="Easily remedied|Remedied short term|Remedied with effort|Hard to remedy|Irreversible" />}
        {i.type === 'potential' && <Scale label="Likelihood" v={i.likelihood} set={(x) => ui({ likelihood: x })} ro={ro} hint="Very unlikely|Unlikely|Possible|Likely|Very likely" />}
        {i.type === 'potential' && i.nature !== 'positive' && <label className="field"><span>Human-rights impact?</span><select className="input" disabled={ro} value={i.humanRights ? 'yes' : 'no'} onChange={(e) => ui({ humanRights: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes — severity takes precedence over likelihood</option></select></label>}
        <div className="field"><span>Where in the value chain</span><div className="row" style={{ gap: 12, minHeight: 36, alignItems: 'center' }}>{(['upstream', 'own', 'downstream'] as const).map((w) => <label key={w} className="small"><input type="checkbox" disabled={ro} checked={!!i.where?.includes(w)} onChange={(e) => ui({ where: e.target.checked ? [...(i.where ?? []), w] : (i.where ?? []).filter((x) => x !== w) })} /> {w === 'own' ? 'Own operations' : w[0]!.toUpperCase() + w.slice(1)}</label>)}</div></div>
        <label className="field span2"><span>Describe the impact</span><textarea className="input" rows={2} disabled={ro} value={i.description ?? ''} onChange={(e) => ui({ description: e.target.value })} /></label>
      </div></div>
    <div className="card"><div className="row"><h3 className="grow" style={{ margin: 0 }}>Financial effect on the company</h3><span className="chip info">Score {f2(fS)}</span></div>
      <div className="vform">
        <label className="field"><span>Risk or opportunity</span><select className="input" disabled={ro} value={f.kind ?? ''} onChange={(e) => uf({ kind: e.target.value as EsgFinancial['kind'] })}><option value="risk">Risk</option><option value="opportunity">Opportunity</option></select></label>
        <label className="field"><span>Time horizon</span><select className="input" disabled={ro} value={f.horizon ?? ''} onChange={(e) => uf({ horizon: e.target.value as EsgFinancial['horizon'] })}><option value="short">Short term (≤ 1 year)</option><option value="medium">Medium term (1–5 years)</option><option value="long">Long term (&gt; 5 years)</option></select></label>
        <Scale label="Magnitude — effect on cash flows, cost of capital, access to finance" v={f.magnitude} set={(x) => uf({ magnitude: x })} ro={ro} hint={sev} />
        <Scale label="Likelihood" v={f.likelihood} set={(x) => uf({ likelihood: x })} ro={ro} hint="Very unlikely|Unlikely|Possible|Likely|Very likely" />
        <label className="field span2"><span>Describe the risk or opportunity</span><textarea className="input" rows={2} disabled={ro} value={f.description ?? ''} onChange={(e) => uf({ description: e.target.value })} /></label>
      </div></div>
    {t.suppliers.n > 0 && <div className="card"><h3 style={{ marginTop: 0 }}>What your suppliers said ({t.suppliers.n})</h3>
      <table className="t"><thead><tr><th>Supplier</th><th className="num">Their impact</th><th className="num">Effect on them</th><th>Note</th></tr></thead>
        <tbody>{t.suppliers.list.map((s, k) => <tr key={k}><td>{s.supplier}</td><td className="num">{s.impact}</td><td className="num">{s.financial ?? '—'}</td><td className="small">{s.note ?? ''}</td></tr>)}</tbody></table>
      <div className="muted small">0–5 ratings from the supplier portal. Use them as stakeholder input for upstream impacts.</div></div>}
    <div className="card"><h3 style={{ marginTop: 0 }}>Decision</h3>
      <div className="small">By the scores and thresholds this topic is <b>{byScore ? 'material' : 'not material'}</b>.</div>
      <div className="vform">
        <label className="field"><span>Materiality</span><select className="input" disabled={ro} value={mat} onChange={(e) => setMat(e.target.value)}><option value="">Follow the scores</option><option value="yes">Material (decided)</option><option value="no">Not material (decided)</option></select></label>
        <label className="field span2"><span>Reason {mat ? '(required)' : '(optional)'}</span><textarea className="input" rows={2} disabled={ro} value={why} onChange={(e) => setWhy(e.target.value)} /></label>
      </div></div>
    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>{!ro && <button className="btn p" disabled={!!mat && !why.trim()} onClick={() => void save()}>Save</button>}<button className="btn ghost" onClick={() => dlg.current?.close()}>Close</button></div>
  </div></dialog>;
}

// ------------------------------------------------------------------ ESG data --
function Answer({ q, d, act }: { q: EsgQuestion; d: EsgData; act: Act }) {
  const [v, setV] = useState(q.answer?.value ?? ''), [n, setN] = useState(q.answer?.note ?? '');
  const dirty = v !== (q.answer?.value ?? '') || n !== (q.answer?.note ?? '');
  const ro = !d.can.edit;
  const save = () => act(() => api.esgAnswer(d.year, q.code, v.trim() || null, n.trim()), 'Saved');
  return <tr>
    <td className="small muted">{q.code}</td>
    <td>{q.text}{q.industry && <span className="chip info" style={{ marginLeft: 6 }}>industry</span>}
      <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 3 }}>{(d.assessment?.frameworks ?? []).filter((c) => q.refs[c]).map((c) => <span key={c} className="chip grey" title={d.catalogue.frameworks.find((x) => x.code === c)?.name}>{c.toUpperCase()} {q.refs[c]}</span>)}</div></td>
    <td style={{ minWidth: 170 }}>{q.type === 'yesno' ? <select className="input" disabled={ro} value={v} onChange={(e) => setV(e.target.value)}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select>
      : q.type === 'text' ? <textarea className="input" rows={2} disabled={ro} value={v} onChange={(e) => setV(e.target.value)} />
        : <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="input num" disabled={ro} value={v} placeholder={q.autoValue != null ? q.autoValue.toLocaleString('en-GB') : ''} onChange={(e) => setV(e.target.value)} /><span className="small muted">{q.unit ?? (q.type === 'percent' ? '%' : '')}</span></div>}
      {q.autoValue != null && !v && <div className="small muted">From your inventory: {q.autoValue.toLocaleString('en-GB')}</div>}</td>
    <td><input className="input" disabled={ro} value={n} placeholder="Source, scope, note" onChange={(e) => setN(e.target.value)} /></td>
    <td>{!ro && dirty && <button className="btn p" onClick={() => void save()}>Save</button>}</td>
  </tr>;
}

function DataTab({ d, act }: { d: EsgData; act: Act }) {
  if (!d.assessment) return <div className="card empty">Set up the year first: frameworks and industry on the first tab.</div>;
  const topics = [...new Set(d.questions.map((q) => q.topic))];
  return <>
    <div className="note info small">{d.material.length ? <>Questions for your <b>{d.material.length} material topics</b></> : <>No topic is material yet — showing the topics <b>usually material in your industry</b></>}, general and industry-specific ({d.catalogue.industries.find((i) => i.code === d.assessment!.industry)?.name ?? 'no industry chosen'}), with the reference in each framework you chose. {d.answered} of {d.questions.length} answered; greenhouse-gas figures come from your inventory unless you overwrite them.</div>
    {topics.map((tc) => { const t = d.topics.find((x) => x.code === tc)!; return <div className="card" key={tc}>
      <h3 style={{ marginTop: 0 }}><span style={{ color: PILLAR[t.pillar] }}>{tc}</span> {t.name} {t.material ? <span className="chip">Material</span> : <span className="chip grey">Likely in your industry</span>}</h3>
      <div className="scrollx"><table className="t"><thead><tr><th>Code</th><th>Question</th><th>Answer</th><th>Note</th><th /></tr></thead>
        <tbody>{d.questions.filter((q) => q.topic === tc).map((q) => <Answer key={`${q.code}-${q.answer?.updated_at ?? ''}`} q={q} d={d} act={act} />)}</tbody></table></div></div>; })}
    {!topics.length && <div className="card empty">Choose an industry or assess the topics to see the questions.</div>}
  </>;
}

function IndexTab({ d }: { d: EsgData }) {
  const a = d.assessment;
  if (!a) return <div className="card empty">Set up the year first.</div>;
  const fws = d.catalogue.frameworks.filter((f) => a.frameworks.includes(f.code));
  return <>{fws.map((f) => { const qs = d.questions.filter((q) => q.refs[f.code]); return <div className="card" key={f.code}>
    <h3 style={{ marginTop: 0 }}>{f.name} <span className={`chip ${MAT[f.materiality]![1]}`}>{MAT[f.materiality]![0]}</span></h3>
    {qs.length ? <div className="scrollx"><table className="t"><thead><tr><th>Reference</th><th>Disclosure</th><th>Topic</th><th className="num">Value</th><th className="ctr">Status</th></tr></thead>
      <tbody>{qs.map((q) => { const val = q.answer?.value ?? (q.autoValue != null ? q.autoValue.toLocaleString('en-GB') : null); return <tr key={q.code}><td><b>{q.refs[f.code]}</b></td><td>{q.text}</td><td>{q.topic}</td>
        <td className="num">{val ? `${val}${q.unit && q.type !== 'text' && q.type !== 'yesno' ? ` ${q.unit}` : q.type === 'percent' ? ' %' : ''}` : '—'}</td>
        <td className="ctr">{q.answer ? <span className="chip">Answered</span> : q.autoValue != null ? <span className="chip info">From inventory</span> : <span className="chip warn">Missing</span>}</td></tr>; })}</tbody></table></div>
      : <div className="muted small">None of the questions shown map to this framework.</div>}</div>; })}
    {!fws.length && <div className="card empty">Choose frameworks on the first tab.</div>}</>;
}
