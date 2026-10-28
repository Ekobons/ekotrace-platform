/**
 * SEBI BRSR Core (Disclose → BRSR Core): the nine attributes for a financial year with the previous year beside them.
 * Environmental KPIs are worked out from approved entries (and can be overridden with a reason); HR, finance and
 * procurement figures are entered; ratios are derived. Each KPI carries a note, evidence and an owner, and goes
 * open → ready → reviewed before assurance or assessment. The value chain tab holds the top partners and their
 * attributable figures. Excel export gives the BRSR Core table.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { Icon } from '../components/Icon';
import { brsrApi, fyLabel, type BrsrData, type Kpi, type Partner, type PartnerBody, type ReportBody, type Review, type Row } from '../lib/brsr';

const fmt = (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-IN', { maximumFractionDigits: dp, minimumFractionDigits: 0 }));
const inr = (x: number | null | undefined) => (x == null ? '—' : x >= 1e7 ? `₹${(x / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} cr` : `₹${x.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`);
const parse = (s: string) => { const t = s.replace(/,/g, '').trim(); return t === '' ? null : Number(t); };
const okNum = (s: string) => s.trim() === '' || Number.isFinite(Number(s.replace(/,/g, '')));
const thisFy = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() - 1 : d.getFullYear() - 2; };
const REVIEW: Record<Review, [string, string]> = { open: ['grey', 'Open'], ready: ['info', 'Ready'], reviewed: ['', 'Reviewed'] };
const SRC: Record<Row['source'], string> = { entries: 'From entries', override: 'Replaced', typed: 'Entered', missing: 'Missing', derived: 'Worked out' };

export function Brsr() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const fy = sp.get('fy') ? Number(sp.get('fy')) : thisFy();
  const tab = sp.get('a') ?? '1';
  const [d, setD] = useState<BrsrData | null>(null);
  const [tick, setTick] = useState(0);
  const [settings, setSettings] = useState(false);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    let live = true;
    if (d && d.report.fy !== fy) setD(null);
    brsrApi.get(fy).then((x) => { if (live) setD(x); }).catch((e) => { if (live) toast((e as Error).message); });
    return () => { live = false; };
  }, [fy, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const R = d.report, rd = d.readiness;
  const row = (c: string) => d.rows.find((r) => r.code === c)!;
  const byAttr = (a: number) => {
    const ks = d.kpis.filter((k) => k.attr === a && k.kind !== 'derived'), rs = ks.map((k) => row(k.code));
    return { total: ks.length, filled: rs.filter((r) => r.value != null).length, reviewed: rs.filter((r) => r.review === 'reviewed').length };
  };
  const ghg = (row('ghg.s1').value ?? 0) + (row('ghg.s2').value ?? 0);
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Disclose · India</span><h1>BRSR Core</h1>
          <div className="muted">SEBI's Business Responsibility and Sustainability Report — Core: nine attributes with their KPIs, for reasonable assurance or assessment. Environmental figures come from approved entries; the rest is entered here.</div></div>
        <label className="field" style={{ minWidth: 140 }}><span>Financial year</span>
          <select className="input" value={fy} onChange={(e) => set('fy', e.target.value)}>{d.years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select></label>
        <button className="btn" onClick={() => setSettings(true)}><Icon name="gear" /> Year settings</button>
        <button className="btn p" onClick={() => brsrApi.exportXlsx(fy).catch((e) => toast((e as Error).message))}><Icon name="download" /> BRSR Core (Excel)</button>
      </div>

      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Core rows filled</span><b>{rd.coreFilled} <small className="muted">of {rd.core}</small></b>
          <div className="ccmeter"><i style={{ width: `${(rd.coreFilled / Math.max(1, rd.core)) * 100}%` }} /></div>
          <span className="muted small">{rd.reviewed} of {rd.kpis} inputs reviewed · {rd.evidence} with evidence</span></div>
        <div className="card kpi"><span className="muted small">Scope 1 + 2</span><b>{fmt(ghg, 0)} <small className="muted">tCO₂e</small></b>
          <span className="muted small">{fmt(row('ghg.int_ppp').value, 2)} tCO₂e per USD Mn (PPP){row('ghg.int_out').value != null ? ` · ${fmt(row('ghg.int_out').value, 4)} per ${R.outputUnit ?? 'unit'}` : ''}</span></div>
        <div className="card kpi"><span className="muted small">Energy · renewable share</span><b>{fmt(row('energy.total').value, 0)} <small className="muted">GJ</small></b>
          <span className="muted small">{fmt(row('energy.re_share').value, 1)}% renewable · water {fmt(row('water.consumption').value, 0)} kL · waste {fmt(row('waste.total').value, 1)} t</span></div>
        <div className="card kpi"><span className="muted small">{R.approach === 'none' ? 'No assurance' : `Reasonable ${R.approach}`}</span><b style={{ fontSize: 20 }}>{R.status === 'final' ? 'Final' : R.status === 'ready' ? 'Ready for the provider' : 'Draft'}</b>
          <span className="muted small">{R.provider ?? 'Provider not set'} · revenue {inr(R.revenueInr)}{d.revenuePpp != null ? ` = USD ${fmt(d.revenuePpp, 1)} Mn (PPP at ${R.pppFactor})` : ' — set it for the intensities'}</span></div>
      </div>

      {d.problems.length > 0 && <div className="note warn" style={{ margin: '12px 0' }}><b>Checks a verifier would raise:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
      {!R.exists && <div className="note info" style={{ margin: '12px 0' }}>{fyLabel(fy)} has not been set up. Open <b>Year settings</b> to enter the revenue from operations, the PPP rate and the boundary; values entered below start the year too.</div>}

      <div className="brsrgrid">
        <nav className="card flush brsrnav" aria-label="BRSR Core attributes">
          {Object.entries(d.attributes).map(([a, name]) => {
            const s = byAttr(Number(a));
            return (
              <button key={a} className={tab === a ? 'on' : ''} onClick={() => set('a', a)}>
                <span className="n">{a}</span><span className="grow">{name}</span>
                <span className={`chip ${s.filled === s.total ? '' : 'grey'}`} title={`${s.filled} of ${s.total} filled · ${s.reviewed} reviewed`}>{s.filled}/{s.total}</span>
              </button>);
          })}
          <button className={tab === 'vc' ? 'on' : ''} onClick={() => set('a', 'vc')}><span className="n"><Icon name="users" /></span><span className="grow">Value chain</span><span className="chip grey">{d.valueChain.upstream.partners.length + d.valueChain.downstream.partners.length}</span></button>
        </nav>
        <div>{tab === 'vc' ? <ValueChain d={d} onSaved={reload} /> : <Attribute key={`${fy}:${tab}`} d={d} attr={Number(tab)} onSaved={reload} />}</div>
      </div>
      {settings && <Settings d={d} onClose={() => setSettings(false)} onDone={() => { setSettings(false); reload(); }} />}
    </div>);
}

function Attribute({ d, attr, onSaved }: { d: BrsrData; attr: number; onSaved: () => void }) {
  const { toast } = useApp();
  const kpis = d.kpis.filter((k) => k.attr === attr);
  const rows = new Map(d.rows.map((r) => [r.code, r]));
  const init = () => Object.fromEntries(kpis.filter((k) => k.kind === 'typed').map((k) => [k.code, rows.get(k.code)!.value == null ? '' : String(rows.get(k.code)!.value)]));
  const [draft, setDraft] = useState<Record<string, string>>(init);
  const orig = useMemo(init, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(init()); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<Kpi | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dirty = Object.keys(draft).filter((k) => draft[k] !== orig[k]);
  const bad = Object.values(draft).some((v) => !okNum(v));
  const final = d.report.status === 'final';
  const save = async () => {
    try {
      await brsrApi.values(d.report.fy, dirty.map((k) => { const r = rows.get(k)!; return { kpi: k, value: parse(draft[k]!), note: r.note, documentId: r.documentId, owner: r.owner }; }));
      toast(`Saved ${dirty.length}`); onSaved();
    } catch (e) { toast((e as Error).message); }
  };
  const review = async (to: Review) => {
    try { const r = await brsrApi.review(d.report.fy, [...sel], to); toast(r.skipped ? `Done; ${r.skipped} skipped — you changed them, someone else reviews` : 'Done'); setSel(new Set()); onSaved(); }
    catch (e) { toast((e as Error).message); }
  };
  const enterable = kpis.filter((k) => k.kind !== 'derived');
  const groups: (string | undefined)[] = [...new Set(kpis.map((k) => k.group))];
  const head = kpis[0]?.code.split('.')[0] ?? '';
  return (
    <div className="card flush">
      <div className="row vfilters" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="grow"><b>{attr} · {d.attributes[attr]}</b>{d.sources[head] && <div className="muted small">Worked out from {d.sources[head]}.</div>}</div>
        {sel.size > 0 && <>
          <span className="muted small">{sel.size} selected</span>
          {d.canEdit && <button className="btn sm" disabled={final} onClick={() => review('ready')}>Mark ready</button>}
          {d.canReview && <button className="btn sm" disabled={final} onClick={() => review('reviewed')}>Mark reviewed</button>}
          {d.canEdit && <button className="btn sm ghost" disabled={final} onClick={() => review('open')}>Reopen</button>}
        </>}
        {d.canEdit && <button className="btn p" disabled={final || !dirty.length || bad} onClick={save}>{dirty.length ? `Save ${dirty.length}` : 'Saved'}</button>}
      </div>
      <div className="scrollx"><table className="t brsrtable">
        <thead><tr><th style={{ width: 28 }}><input type="checkbox" aria-label="Select all" checked={enterable.length > 0 && enterable.every((k) => sel.has(k.code))} onChange={(e) => setSel(e.target.checked ? new Set(enterable.map((k) => k.code)) : new Set())} /></th>
          <th>Parameter</th><th>Unit</th><th className="num">{fyLabel(d.report.fy)}</th><th className="num">{fyLabel(d.report.fy - 1)}</th><th>Source</th><th className="ctr">Review</th></tr></thead>
        <tbody>{groups.map((g) => (
          <Fragment key={g ?? '-'}>{g && <tr className="grp"><td /><td colSpan={6}><b className="small">{g}</b></td></tr>}
            {kpis.filter((k) => k.group === g).map((k) => {
              const r = rows.get(k.code)!;
              return (
                <tr key={k.code} className={k.kind === 'derived' ? 'derived' : ''}>
                  <td>{k.kind !== 'derived' && <input type="checkbox" aria-label={`Select ${k.label}`} checked={sel.has(k.code)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(k.code); else n.delete(k.code); setSel(n); }} />}</td>
                  <td className="brsrlbl">{k.kind === 'derived' ? <b>{k.label}</b> : k.label}{!k.inCore && <span className="muted small"> · input</span>}{k.hint && <div className="muted small">{k.hint}</div>}
                    {r.note && <div className="small" style={{ color: 'var(--info)' }}>“{r.note}”</div>}</td>
                  <td className="small nowrap muted">{k.unit}</td>
                  <td className="num">{k.kind === 'typed' && d.canEdit && !final
                    ? <input className="input sm num" style={{ width: 130 }} inputMode="decimal" aria-label={k.label} value={draft[k.code] ?? ''} onChange={(e) => setDraft((o) => ({ ...o, [k.code]: e.target.value }))} />
                    : <b>{fmt(r.value, k.dp)}</b>}
                    {r.overridden && <div className="muted small">entries: {fmt(r.auto, k.dp)}</div>}</td>
                  <td className="num small muted">{fmt(r.previous, k.dp)}</td>
                  <td className="small nowrap"><span className={r.source === 'missing' ? 'warn-t' : r.source === 'override' ? 'warn-t' : 'muted'}>{SRC[r.source]}</span>
                    {r.document && <div title={r.document}><Icon name="doc" /> evidence</div>}{r.owner && <div className="muted">{r.owner}</div>}
                    {k.kind !== 'derived' && d.canEdit && !final && <div><button className="linkbtn small" onClick={() => setOpen(k)}>{k.kind === 'auto' ? 'Replace / note…' : 'Note & evidence…'}</button></div>}</td>
                  <td className="ctr">{k.kind !== 'derived' && <span className={`chip ${REVIEW[r.review][0]}`} title={r.reviewedName ? `Reviewed by ${r.reviewedName}` : undefined}>{REVIEW[r.review][1]}</span>}</td>
                </tr>);
            })}</Fragment>))}
        </tbody>
      </table></div>
      {attr <= 4 && <Detail d={d} attr={attr} />}
      {open && <RowDrawer d={d} k={open} r={rows.get(open.code)!} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onSaved(); }} />}
    </div>);
}

function Detail({ d, attr }: { d: BrsrData; attr: number }) {
  const label = (c: string) => d.kpis.find((k) => k.code === c)?.label ?? c;
  const block = (title: string, body: React.ReactNode) => <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--line)' }}><div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>{body}</div>;
  if (attr === 1) return block(`Scope 1 by gas (from ${d.detail.entries.ghg} entries)`, d.gases.length ? <div className="lgd">{d.gases.map((g) => <span key={g.gas}><b>{g.gas}</b> {fmt(g.t, 2)} t</span>)}</div> : <span className="muted small">No approved entries in the year.</span>);
  if (attr === 2) return block('Water by source and destination', d.detail.water.length ? <table className="t small"><tbody>{d.detail.water.map((w) => <tr key={w.line}><td>{w.line}</td><td className="num">{fmt(w.kl, 0)} kL</td></tr>)}</tbody></table> : <span className="muted small">No approved water entries in the year.</span>);
  if (attr === 3) return block('Energy by source', d.detail.energy.length ? <table className="t small"><tbody>{d.detail.energy.map((e) => <tr key={e.source}><td>{e.source}</td><td className="num">{fmt(e.gj, 0)} GJ</td><td>{e.renewable ? <span className="chip">renewable</span> : <span className="chip grey">non-renewable</span>}</td></tr>)}</tbody></table> : <span className="muted small">No approved fuel or energy entries in the year.</span>);
  const cats = [...new Set(d.detail.waste.map((w) => w.cat))].sort(), routes = ['recycled', 'reused', 'other_recovery', 'incineration', 'landfill', 'other_disposal'];
  return block('Waste by category and route (t)', cats.length ? (
    <div className="scrollx"><table className="t small"><thead><tr><th>Category</th>{routes.map((r) => <th key={r} className="num">{label(`waste.${r}`).replace(/^(Recovered through|Disposed of by) /, '')}</th>)}</tr></thead>
      <tbody>{cats.map((c) => <tr key={c}><td style={{ minWidth: 200 }}>{label(`waste.${c}`)}</td>{routes.map((r) => { const x = d.detail.waste.find((w) => w.cat === c && w.route === r); return <td key={r} className="num">{x ? fmt(x.t, 3) : '—'}</td>; })}</tr>)}</tbody></table></div>)
    : <span className="muted small">No approved waste entries in the year.</span>);
}

function RowDrawer({ d, k, r, onClose, onDone }: { d: BrsrData; k: Kpi; r: Row; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const auto = k.kind === 'auto';
  const [f, setF] = useState({ value: auto ? (r.overridden ? String(r.value) : '') : (r.value == null ? '' : String(r.value)), note: r.note, documentId: r.documentId ?? '', owner: r.owner ?? '' });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const needNote = auto && f.value.trim() !== '' && !f.note.trim();
  const save = async () => {
    try { await brsrApi.values(d.report.fy, [{ kpi: k.code, value: parse(f.value), note: f.note.trim(), documentId: f.documentId || null, owner: f.owner.trim() || null }]); toast('Saved — sent back to open for review'); onDone(); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">{d.attributes[k.attr]}</div><h2>{k.label}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      {auto && <div className="note info small">From approved entries: <b>{fmt(r.auto, k.dp)} {k.unit}</b>. Leave the value empty to keep it; type a value only to replace it, with the reason.</div>}
      <div className="vform">
        <label className="field"><span>{auto ? 'Replace with' : 'Value'} ({k.unit})</span><input className="input num" inputMode="decimal" value={f.value} onChange={(e) => up({ value: e.target.value })} /></label>
        <label className="field"><span>Owner (who provides it)</span><input className="input" value={f.owner} placeholder="e.g. HR, Finance, Plant EHS" onChange={(e) => up({ owner: e.target.value })} /></label>
        <label className="field span2"><span>{auto ? 'Reason / note' : 'Note (source, basis, estimate)'}</span><textarea className="input" rows={3} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
        <label className="field span2"><span>Evidence (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
      {needNote && <div className="note warn small">Say why the value from entries is replaced.</div>}
      <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={needNote || !okNum(f.value)} onClick={save}>Save</button></div>
    </div></dialog>);
}

function Settings({ d, onClose, onDone }: { d: BrsrData; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const R = d.report, s = (x: number | null) => (x == null ? '' : String(x));
  const [f, setF] = useState({ revenueInr: s(R.revenueInr), pppFactor: s(R.pppFactor), outputQty: s(R.outputQty), outputUnit: R.outputUnit ?? '', all: !R.facilityIds?.length, facilityIds: R.facilityIds ?? [],
    provider: R.provider ?? '', approach: R.approach, status: R.status, notes: R.notes });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const save = async () => {
    const b: ReportBody = { revenueInr: parse(f.revenueInr), pppFactor: parse(f.pppFactor), outputQty: parse(f.outputQty), outputUnit: f.outputUnit.trim() || null, facilityIds: f.all ? null : f.facilityIds,
      provider: f.provider.trim() || null, approach: f.approach, status: f.status, notes: f.notes.trim() };
    try { await brsrApi.saveReport(R.fy, b); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); }
  };
  const rev = parse(f.revenueInr), ppp = parse(f.pppFactor);
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">BRSR Core</div><h2>{R.label} settings</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      {!d.canSetup && <div className="note info small">Only a super admin or admin changes these.</div>}
      <div className="vform">
        <label className="field"><span>Revenue from operations (₹, audited P&amp;L, excluding other income)</span><input className="input num" inputMode="decimal" value={f.revenueInr} onChange={(e) => up({ revenueInr: e.target.value })} /></label>
        <label className="field"><span>PPP conversion rate (₹ per international $, IMF)</span><input className="input num" inputMode="decimal" value={f.pppFactor} onChange={(e) => up({ pppFactor: e.target.value })} /></label>
        <div className="field span2 muted small">{rev != null && ppp ? `Revenue adjusted for PPP: USD ${fmt(rev / ppp / 1e6, 2)} million. ` : ''}The Industry Standards use the IMF implied PPP conversion rate (22.4 as of April 2024). Use the latest IMF value and disclose it.</div>
        <label className="field"><span>Physical output (for intensity per unit)</span><input className="input num" inputMode="decimal" value={f.outputQty} onChange={(e) => up({ outputQty: e.target.value })} /></label>
        <label className="field"><span>Output unit</span><input className="input" value={f.outputUnit} placeholder="t of product; FTE for service companies" onChange={(e) => up({ outputUnit: e.target.value })} /></label>
        <div className="field span2"><span>Boundary</span>
          <label className="row small chkline" style={{ gap: 6, marginTop: 4 }}><input type="checkbox" checked={f.all} onChange={(e) => up({ all: e.target.checked })} />Every facility of the company</label>
          {!f.all && <div className="row small" style={{ gap: 14, flexWrap: 'wrap', marginTop: 6 }}>{d.facilities.map((x) => (
            <label key={x.id} className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={f.facilityIds.includes(x.id)} onChange={(e) => up({ facilityIds: e.target.checked ? [...f.facilityIds, x.id] : f.facilityIds.filter((y) => y !== x.id) })} />{x.name}</label>))}</div>}</div>
        <label className="field"><span>Assessment or assurance</span><select className="input" value={f.approach} onChange={(e) => up({ approach: e.target.value as ReportBody['approach'] })}>
          <option value="assurance">Reasonable assurance</option><option value="assessment">Assessment (ISF standards)</option><option value="none">None this year</option></select></label>
        <label className="field"><span>Provider</span><input className="input" value={f.provider} onChange={(e) => up({ provider: e.target.value })} /></label>
        <label className="field"><span>Status</span><select className="input" value={f.status} onChange={(e) => up({ status: e.target.value as ReportBody['status'] })}>
          <option value="draft">Draft</option><option value="ready">Ready for the provider</option><option value="final">Final (locks the values)</option></select></label>
        <div className="field" />
        <label className="field span2"><span>Notes (scope, estimates, restated comparatives)</span><textarea className="input" rows={3} value={f.notes} onChange={(e) => up({ notes: e.target.value })} /></label>
      </div>
      <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
        <button className="btn p" disabled={!d.canSetup || ![f.revenueInr, f.pppFactor, f.outputQty].every(okNum) || (!f.all && !f.facilityIds.length)} onClick={save}>Save</button></div>
    </div></dialog>);
}

// ------------------------------------------------------------------------------------- value chain --
function ValueChain({ d, onSaved }: { d: BrsrData; onSaved: () => void }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState<Partner | { side: 'upstream' | 'downstream' } | null>(null);
  const [sug, setSug] = useState<Awaited<ReturnType<typeof brsrApi.suggest>> | null>(null);
  const vcK = d.kpis.filter((k) => k.vc);
  const loadSug = async () => { try { setSug(await brsrApi.suggest(d.report.fy)); } catch (e) { toast((e as Error).message); } };
  const add = async (s: { supplierId: string; name: string }) => {
    try { await brsrApi.addPartner(d.report.fy, { side: 'upstream', name: s.name, supplierId: s.supplierId, amountInr: null, attributable: null, values: {}, note: '' }); toast(`Added ${s.name}`); onSaved(); }
    catch (e) { toast((e as Error).message); }
  };
  const side = (s: 'upstream' | 'downstream') => {
    const S = d.valueChain[s];
    return (
      <div className="card flush" style={{ marginBottom: 12 }}>
        <div className="row vfilters"><div className="grow"><b>{s === 'upstream' ? 'Upstream — suppliers' : 'Downstream — customers, dealers, distributors'}</b>
          <div className="muted small">{S.total ? `${fmt((S.coverage ?? 0) * 100, 1)}% of ${s === 'upstream' ? 'purchases' : 'sales'} covered (${inr(S.amount)} of ${inr(S.total)})` : `Enter total ${s === 'upstream' ? 'purchases (attribute 7)' : 'sales (attribute 9)'} to see the coverage`}</div></div>
          {s === 'upstream' && d.canEdit && <button className="btn sm" onClick={loadSug}>Suggest from purchase files</button>}
          {d.canEdit && <button className="btn sm p" onClick={() => setEdit({ side: s })}>+ Partner</button>}</div>
        {s === 'upstream' && sug && (
          <div style={{ padding: '0 14px 10px' }}>{sug.suggestions.length ? <table className="t small"><thead><tr><th>Supplier (≥ 2% of spend)</th><th className="num">Share</th><th className="num">Cumulative</th><th /></tr></thead>
            <tbody>{sug.suggestions.map((x) => <tr key={x.supplierId}><td>{x.name}</td><td className="num">{fmt(x.share * 100, 1)}%</td><td className="num">{fmt(x.cumulative * 100, 1)}%</td>
              <td>{S.partners.some((p) => p.supplierId === x.supplierId) ? <span className="muted">added</span> : <button className="btn sm" onClick={() => add(x)}>Add</button>}</td></tr>)}</tbody></table>
            : <span className="muted small">No published purchase lines in {fyLabel(d.report.fy)} with a supplier above 2% of spend.</span>}</div>)}
        {!S.partners.length ? <div className="empty" style={{ padding: 18 }}>No {s} partners yet.</div> : (
          <div className="scrollx"><table className="t">
            <thead><tr><th>Partner</th><th className="num">With the company</th><th className="num">Share</th><th className="num">Attributable</th>{vcK.map((k) => <th key={k.code} className="num" title={k.label}>{k.label.replace(/^Total /, '').replace(/ \(A\+B.*$/, '')}<div className="muted small" style={{ fontWeight: 400 }}>{k.unit}</div></th>)}<th /></tr></thead>
            <tbody>{S.partners.map((p) => (
              <tr key={p.id}><td style={{ minWidth: 230 }}><b>{p.name}</b>{p.note && <div className="muted small">{p.note}</div>}</td><td className="num small">{inr(p.amountInr)}</td>
                <td className="num small">{p.share != null ? <span className={p.belowTwo ? 'warn-t' : ''} title={p.belowTwo ? 'Below the 2% threshold' : undefined}>{fmt(p.share * 100, 1)}%</span> : '—'}</td>
                <td className="num small">{fmt((p.attributable ?? 1) * 100, 0)}%</td>
                {vcK.map((k) => <td key={k.code} className="num small">{fmt(p.values[k.code], k.dp)}</td>)}
                <td>{d.canEdit && <button className="btn sm" onClick={() => setEdit(p)}>Edit</button>}</td></tr>))}</tbody>
            <tfoot><tr><td><b>Attributable to the company</b></td><td className="num"><b>{inr(S.amount)}</b></td><td className="num">{S.coverage != null ? `${fmt(S.coverage * 100, 1)}%` : ''}</td><td />
              {vcK.map((k) => <td key={k.code} className="num"><b>{fmt(S.attributable[k.code], k.dp)}</b></td>)}<td /></tr></tfoot>
          </table></div>)}
      </div>);
  };
  return (
    <div>
      <div className="note info small" style={{ marginBottom: 12 }}>Value-chain partners are the top upstream and downstream partners, each at least 2% of purchases or sales by value; coverage can stop at 75%. Each partner's figures count to the extent attributable to its business with the company. Voluntary for the top 250 listed companies from FY 2025-26; assessment or assurance voluntary from FY 2026-27.</div>
      {side('upstream')}{side('downstream')}
      {edit && <PartnerDrawer d={d} p={'id' in edit ? edit : null} side={edit.side} onClose={() => setEdit(null)} onDone={() => { setEdit(null); onSaved(); }} />}
    </div>);
}

function PartnerDrawer({ d, p, side, onClose, onDone }: { d: BrsrData; p: Partner | null; side: 'upstream' | 'downstream'; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const vcK = d.kpis.filter((k) => k.vc);
  const s = (x: number | null | undefined) => (x == null ? '' : String(x));
  const [f, setF] = useState({ side: p?.side ?? side, name: p?.name ?? '', amountInr: s(p?.amountInr), attributable: p?.attributable != null ? String(Math.round(p.attributable * 1000) / 10) : '', note: p?.note ?? '',
    values: Object.fromEntries(vcK.map((k) => [k.code, s(p?.values[k.code])])) as Record<string, string> });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const ok = f.name.trim().length >= 2 && [f.amountInr, f.attributable, ...Object.values(f.values)].every(okNum) && (parse(f.attributable) ?? 0) <= 100;
  const body = (): PartnerBody => ({ side: f.side, name: f.name.trim(), supplierId: p?.supplierId ?? null, amountInr: parse(f.amountInr), attributable: f.attributable.trim() ? parse(f.attributable)! / 100 : null,
    values: Object.fromEntries(Object.entries(f.values).map(([k, v]) => [k, parse(v)])), note: f.note.trim() });
  const save = async () => { try { if (p) await brsrApi.savePartner(p.id, body()); else await brsrApi.addPartner(d.report.fy, body()); toast('Saved'); onDone(); } catch (e) { toast((e as Error).message); } };
  const del = async () => { if (!p) return; try { await brsrApi.deletePartner(p.id); toast('Removed'); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}><div className="in">
      <div className="row"><div className="grow"><div className="eyebrow">Value chain · {fyLabel(d.report.fy)}</div><h2>{p ? p.name : 'Add a partner'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
      <div className="vform">
        <label className="field span2"><span>Partner</span><input className="input" value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
        <label className="field"><span>Side</span><select className="input" value={f.side} onChange={(e) => up({ side: e.target.value as 'upstream' | 'downstream' })}><option value="upstream">Upstream (supplier)</option><option value="downstream">Downstream (customer, dealer)</option></select></label>
        <label className="field"><span>{f.side === 'upstream' ? 'Purchases from it' : 'Sales to it'} in the year (₹)</span><input className="input num" inputMode="decimal" value={f.amountInr} onChange={(e) => up({ amountInr: e.target.value })} /></label>
        <label className="field"><span>Share attributable to business with the company (%)</span><input className="input num" inputMode="decimal" value={f.attributable} placeholder="100" onChange={(e) => up({ attributable: e.target.value })} /></label>
        <div className="field muted small">e.g. our purchases ÷ the supplier's revenue. Its figures below are its whole figures; the tool applies this share.</div>
        {vcK.map((k) => <label key={k.code} className="field"><span>{k.label} ({k.unit})</span><input className="input num" inputMode="decimal" value={f.values[k.code]} onChange={(e) => up({ values: { ...f.values, [k.code]: e.target.value } })} /></label>)}
        <label className="field span2"><span>Note (source: BRSR, sustainability report, questionnaire; estimates)</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
      <div className="row">{p && <button className="btn" onClick={del}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={!ok} onClick={save}>Save</button></div>
    </div></dialog>);
}
