/**
 * Audit & assurance (Disclose): the engagement (standard, level, provider, materiality, conclusion and statement),
 * period locks, samples with test results, findings to closure, and the verifier pack.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, type AFinding, type AssuranceData, type SampleItem } from '../lib/api';
import { csv, download, esc, RT_CSS } from '../lib/reports';
import { MN, fmt } from '../components/DashCharts';

type Tab = 'eng' | 'locks' | 'sample' | 'find' | 'pack';
const TABS: [Tab, string][] = [['eng', '◎ Engagement'], ['locks', '🔒 Period locks'], ['sample', '⊞ Sampling & testing'], ['find', '⚑ Findings'], ['pack', '⇩ Verifier pack']];
const STATUS: Record<string, string> = { planning: 'Planning', fieldwork: 'Fieldwork', reporting: 'Reporting', issued: 'Statement issued' };
const SEV_C: Record<string, string> = { high: 'bad', medium: 'warn', low: 'info' };
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function Assurance() {
  const { toast } = useApp();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>('eng');
  const [d, setD] = useState<AssuranceData | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  useEffect(() => { setD(null); api.assurance(year).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok); reload(); } catch (e) { toast((e as Error).message); } };
  const locked = d?.months.filter((m) => m.lock).length ?? 0;
  const mat = d?.engagement?.materiality ? (d.kpis.totalT * d.engagement.materiality) / 100 : null;
  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Disclose</span><h1>Audit & assurance</h1><div className="muted">Prepare for external assurance under ISO 14064-3, ISAE 3410 / 3000, ISSA 5000 or AA1000AS: lock approved months, give the verifier a reproducible sample, track findings to closure, and hand over the verifier pack.</div></div>
        <span className="grow" />
        <select className="input" style={{ width: 'auto' }} aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[0, 1, 2, 3].map((x) => new Date().getFullYear() - x).map((y) => <option key={y}>{y}</option>)}</select>
      </div>
      {!d ? <div className="card empty">Loading…</div> : <>
        <div className="kgrid4">
          <div className="card kpi"><span className="muted small">Approved entries {year}</span><b>{num(d.kpis.approved)}</b><span className="muted small">{fmt(d.kpis.totalT, 0)} tCO₂e</span></div>
          <div className="card kpi"><span className="muted small">With evidence (meter, bill, file, scans)</span><b>{Math.round(d.kpis.evidencePct)}%</b><span className="muted small">of approved entries</span></div>
          <div className="card kpi"><span className="muted small">Months locked</span><b>{locked} / 12</b><span className="muted small">{d.months.filter((m) => m.ready && !m.lock).length} ready to lock</span></div>
          <div className="card kpi"><span className="muted small">Open findings</span><b style={{ color: d.kpis.openFindings ? 'var(--warn)' : undefined }}>{d.kpis.openFindings}</b>
            <span className="muted small">{fmt(d.kpis.openImpactT, 1)} t estimated{mat != null ? ` · materiality ${fmt(mat, 0)} t` : ''}</span></div>
        </div>
        <div className="seg strong" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'eng' && <Engagement d={d} year={year} run={run} />}
        {tab === 'locks' && <Locks d={d} run={run} />}
        {tab === 'sample' && <Sampling d={d} year={year} run={run} reload={reload} />}
        {tab === 'find' && <Findings d={d} year={year} run={run} />}
        {tab === 'pack' && <Pack d={d} year={year} />}
      </>}
    </div>);
}

function Engagement({ d, year, run }: { d: AssuranceData; year: number; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const e = d.engagement;
  const [f, setF] = useState({ standard: e?.standard ?? 'ISO 14064-3', level: e?.level ?? 'limited', provider: e?.provider ?? '', lead: e?.lead ?? '', scope: e?.scope ?? 'Scope 1, Scope 2 (location- and market-based) and Scope 3',
    materiality: e?.materiality != null ? String(e.materiality) : '5', status: e?.status ?? 'planning', opinion: e?.opinion ?? '', issuedOn: e?.issuedOn?.slice(0, 10) ?? '' });
  const ro = !d.can.verify;
  const set = (k: keyof typeof f) => (x: { target: { value: string } }) => setF({ ...f, [k]: x.target.value });
  return (
    <div className="tagrid2">
      <section className="card tacard">
        <div className="row"><h2>Assurance engagement {year}</h2><span className="grow" />{e && <span className={`chip ${e.status === 'issued' ? '' : 'info'}`}>{STATUS[e.status]}</span>}</div>
        <div className="formgrid">
          <label className="field"><span>Assurance standard</span><select className="input" disabled={ro} value={f.standard} onChange={set('standard')}>{d.standards.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Level of assurance</span><select className="input" disabled={ro} value={f.level} onChange={set('level')}><option value="limited">Limited</option><option value="reasonable">Reasonable</option></select></label>
          <label className="field"><span>Assurance provider</span><input className="input" disabled={ro} value={f.provider} maxLength={160} onChange={set('provider')} /></label>
          <label className="field"><span>Lead verifier</span><input className="input" disabled={ro} value={f.lead} maxLength={160} onChange={set('lead')} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Subject matter (what is assured)</span><input className="input" disabled={ro} value={f.scope} maxLength={500} onChange={set('scope')} /></label>
          <label className="field"><span>Materiality (% of total)</span><input className="input num" disabled={ro} inputMode="decimal" value={f.materiality} onChange={(x) => setF({ ...f, materiality: x.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="field"><span>Status</span><select className="input" disabled={ro} value={f.status} onChange={set('status')}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Conclusion (as written in the statement)</span><textarea className="input" rows={3} disabled={ro} value={f.opinion} maxLength={4000} onChange={set('opinion')} /></label>
          <label className="field"><span>Statement date</span><input className="input" type="date" disabled={ro} value={f.issuedOn} onChange={set('issuedOn')} /></label>
          <label className="field"><span>Signed statement (PDF)</span>{e?.statementId ? <a className="btn sm" href={`/api/assurance/statement/${e.statementId}`} target="_blank" rel="noreferrer">{e.statementName}</a> : <span className="muted small">none yet</span>}
            {!ro && e && <input className="input" type="file" accept="application/pdf" onChange={(x) => { const file = x.target.files?.[0]; if (file) void run(() => api.uploadStatement(year, file), 'Statement attached'); }} />}</label>
        </div>
        {!ro && <div className="row"><span className="muted small">{e ? `Last saved by ${e.updatedBy ?? '—'} · ${d8(e.updatedAt)}` : 'Not set up yet'}</span><span className="grow" />
          <button className="btn p" onClick={() => void run(() => api.saveEngagement({ year, ...f, materiality: f.materiality ? Number(f.materiality) : undefined, provider: f.provider || undefined, lead: f.lead || undefined,
            opinion: f.opinion || undefined, issuedOn: f.issuedOn || undefined }), 'Engagement saved')}>Save</button></div>}
      </section>
      <section className="card tacard">
        <h2>Standards and levels</h2>
        <table className="t dt"><tbody>
          <tr><td><b>ISO 14064-3</b></td><td className="small">Verification and validation of GHG statements; pairs with an ISO 14064-1 inventory.</td></tr>
          <tr><td><b>ISAE 3410</b></td><td className="small">Assurance on GHG statements (IAASB), used by audit firms.</td></tr>
          <tr><td><b>ISAE 3000 (Revised)</b></td><td className="small">Assurance on non-financial information in general.</td></tr>
          <tr><td><b>ISSA 5000</b></td><td className="small">IAASB sustainability assurance standard (2024); expected under CSRD and ISSB-based regimes.</td></tr>
          <tr><td><b>AA1000AS v3</b></td><td className="small">AccountAbility standard, often with stakeholder reporting.</td></tr>
        </tbody></table>
        <p className="small muted"><b>Limited</b> assurance ("nothing has come to our attention…") needs fewer tests — CSRD starts here. <b>Reasonable</b> assurance ("presents fairly, in all material respects") needs larger samples and stronger evidence. Materiality is usually 5% of the total for the inventory; key items above half of it are always tested.</p>
      </section>
    </div>);
}

function Locks({ d, run }: { d: AssuranceData; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [un, setUn] = useState<{ month: string; reason: string } | null>(null);
  return (
    <section className="card tacard">
      <div className="row"><h2>Period locks</h2><span className="grow" /><span className="muted small">A locked month cannot be changed in any way — entries, imports, meters or recalculation. Unlocking needs a reason and is in the audit log.</span></div>
      <div className="lockgrid">{d.months.map((m) => {
        const st = m.lock ? 'locked' : m.ready ? 'ready' : m.approved || m.open ? 'open' : 'empty';
        return (
          <div key={m.month} className={`lockm ${st}`}>
            <b>{MN[Number(m.month.slice(5)) - 1]}</b>
            <span className="small">{m.lock ? '🔒 Locked' : m.ready ? 'Ready to lock' : m.open ? `${m.open} not approved` : 'No data'}</span>
            <span className="muted small">{m.approved} approved</span>
            {m.lock && <span className="muted small" title={m.lock.reason ?? ''}>{m.lock.lockedBy} · {d8(m.lock.lockedAt)}</span>}
            {d.can.admin && (m.lock
              ? <button className="btn xs" onClick={() => setUn({ month: m.month, reason: '' })}>Unlock</button>
              : <button className="btn xs p" disabled={!m.ready} onClick={() => void run(() => api.lockMonth(m.month), `${MN[Number(m.month.slice(5)) - 1]} locked`)}>Lock</button>)}
          </div>); })}</div>
      {un && <div className="row" style={{ gap: 6 }}><b>Unlock {un.month}</b><input className="input sm grow" autoFocus placeholder="Why, e.g. correction agreed with the verifier (finding #…)" value={un.reason} onChange={(e) => setUn({ ...un, reason: e.target.value })} />
        <button className="btn sm danger" disabled={un.reason.trim().length < 5} onClick={() => void run(async () => { await api.unlockMonth(un.month, un.reason.trim()); setUn(null); }, 'Unlocked')}>Unlock</button><button className="btn sm ghost" onClick={() => setUn(null)}>Cancel</button></div>}
    </section>);
}

function Sampling({ d, year, run, reload }: { d: AssuranceData; year: number; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; reload: () => void }) {
  const { toast } = useApp();
  const level = d.engagement?.level ?? 'limited';
  const [f, setF] = useState({ method: 'value' as 'random' | 'value', size: level === 'reasonable' ? '60' : '25', seed: '', keyPct: '' });
  const [open, setOpen] = useState<string | null>(d.samples[0]?.id ?? null);
  const [items, setItems] = useState<SampleItem[] | null>(null);
  const [ed, setEd] = useState<{ id: string; note: string; finding?: boolean; sev?: string; impact?: string } | null>(null);
  const [t2, setT2] = useState(0);
  useEffect(() => { setItems(null); if (open) api.sample(open).then((r) => setItems(r.items)).catch((e) => toast((e as Error).message)); }, [open, t2]); // eslint-disable-line react-hooks/exhaustive-deps
  const test = async (aid: string, result: 'agreed' | 'exception' | null, note?: string) => { try { await api.testItem(open!, aid, { result, note }); setEd(null); setT2((x) => x + 1); reload(); } catch (e) { toast((e as Error).message); } };
  const s = d.samples.find((x) => x.id === open);
  return <>
    {d.can.verify && <section className="card tacard">
      <div className="row"><h2>Draw a sample</h2><span className="grow" /><span className="muted small">Suggested for {level} assurance: {level === 'reasonable' ? '60' : '25'} entries. The seed is recorded, so the verifier can draw the same sample again.</span></div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 280 }}><span>Method</span><select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as 'value' })}>
          <option value="value">Value-weighted (larger tCO₂e more likely)</option><option value="random">Random (every entry equally likely)</option></select></label>
        <label className="field" style={{ width: 120 }}><span>Sample size</span><input className="input num" inputMode="numeric" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value.replace(/\D/g, '') })} /></label>
        <label className="field" style={{ width: 170 }}><span>Key items above (% of total)</span><input className="input num" inputMode="decimal" placeholder={d.engagement?.materiality ? String(d.engagement.materiality / 2) : '5'} value={f.keyPct} onChange={(e) => setF({ ...f, keyPct: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
        <label className="field" style={{ width: 150 }}><span>Seed (optional)</span><input className="input num" inputMode="numeric" placeholder="random" value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value.replace(/\D/g, '') })} /></label>
        <button className="btn p" disabled={!Number(f.size)} onClick={() => void run(async () => { const r = await api.drawSample({ year, method: f.method, size: Number(f.size), seed: f.seed ? Number(f.seed) : undefined, keyPct: f.keyPct ? Number(f.keyPct) : undefined }); setOpen(r.id); }, 'Sample drawn')}>Draw sample</button>
      </div>
    </section>}
    <section className="card tacard">
      <div className="row"><h2>Samples {year}</h2></div>
      {!d.samples.length ? <div className="muted">No sample yet.</div> : <div className="row" style={{ gap: 6 }}>{d.samples.map((x) => (
        <button key={x.id} className={`tplitem${x.id === open ? ' on' : ''}`} style={{ width: 'auto' }} onClick={() => setOpen(x.id)}>
          <b>{x.method === 'value' ? 'Value-weighted' : 'Random'} · {x.size} entries</b><span className="muted small">{d8(x.at)} · seed {x.seed} · {x.tested}/{x.size} tested{x.exceptions ? ` · ${x.exceptions} exception${x.exceptions === 1 ? '' : 's'}` : ''}</span></button>))}</div>}
      {s && <div className="muted small">Population: {num(s.population)} approved entries, {fmt(s.populationT, 0)} tCO₂e · {s.keyItems} key item{s.keyItems === 1 ? '' : 's'} always included · drawn by {s.by}</div>}
      {open && (!items ? <div className="muted">Loading…</div> : (
        <div className="scrollx"><table className="t">
          <thead><tr><th>Facility · period</th><th>What</th><th className="num">Quantity</th><th className="num">tCO₂e</th><th>Factor source</th><th>Evidence</th><th>Trail</th><th>Test</th></tr></thead>
          <tbody>{items.map((i) => [
            <tr key={i.id}>
              <td><b>{i.facility}</b>{i.key && <> <span className="chip warn">Key item</span></>}<div className="muted small">{i.from.slice(0, 7)}{i.to.slice(0, 7) !== i.from.slice(0, 7) ? ` – ${i.to.slice(0, 7)}` : ''}</div></td>
              <td>{i.item}<div className="muted small">{i.category}{i.dataType !== 'actual' ? ` · ${i.dataType}` : ''}{i.entryNote ? ` · ${i.entryNote}` : ''}</div></td>
              <td className="num nowrap">{fmt(i.qty, i.qty < 100 ? 2 : 0)} {i.unit}</td><td className="num"><b>{fmt(i.t, 2)}</b></td><td className="small">{i.source ?? 'own / supplier factor'}</td>
              <td>{i.evidence ? <span className="chip">{i.evidenceKind}</span> : <span className="chip warn">none attached</span>}</td>
              <td className="muted small">entered {i.enteredBy ?? '—'}<br />approved {i.approvedBy ?? '—'}</td>
              <td className="nowrap">{i.result ? <><span className={`chip ${i.result === 'agreed' ? '' : 'bad'}`}>{i.result === 'agreed' ? '✓ Agreed' : '✕ Exception'}</span><div className="muted small">{i.testedBy}</div></>
                : d.can.verify ? <><button className="btn xs p" onClick={() => void test(i.id, 'agreed')}>Agreed</button> <button className="btn xs" onClick={() => setEd({ id: i.id, note: '', finding: true, sev: 'medium', impact: '' })}>Exception</button></> : <span className="muted small">not tested</span>}
                {i.result && d.can.verify && <div><button className="btn xs ghost" onClick={() => void test(i.id, null)}>Undo</button></div>}</td>
            </tr>,
            i.note && <tr key={`${i.id}n`}><td colSpan={8} className="small" style={{ color: i.result === 'exception' ? 'var(--bad)' : undefined }}>Note: {i.note}</td></tr>,
            ed?.id === i.id && <tr key={`${i.id}e`}><td colSpan={8} style={{ background: 'var(--soft)' }}><div className="row" style={{ gap: 6 }}>
              <input className="input sm grow" autoFocus placeholder="What does not agree? e.g. bill shows 41,200 kWh, entry 45,500 kWh" value={ed.note} onChange={(e) => setEd({ ...ed, note: e.target.value })} />
              <label className="row small" style={{ gap: 4 }}><input type="checkbox" checked={!!ed.finding} onChange={(e) => setEd({ ...ed, finding: e.target.checked })} />Raise a finding</label>
              {ed.finding && <><select className="input sm" style={{ width: 'auto' }} value={ed.sev} onChange={(e) => setEd({ ...ed, sev: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
                <input className="input sm num" style={{ width: 110 }} placeholder="impact t" value={ed.impact} onChange={(e) => setEd({ ...ed, impact: e.target.value.replace(/[^0-9.-]/g, '') })} /></>}
              <button className="btn sm danger" disabled={!ed.note.trim()} onClick={async () => { await test(i.id, 'exception', ed.note.trim()); if (ed.finding) await run(() => api.raiseFinding({ year, activityId: i.id, severity: ed.sev!, kind: 'misstatement', text: ed.note.trim(), impactT: ed.impact ? Number(ed.impact) : undefined }), 'Finding raised'); }}>Save exception</button>
              <button className="btn sm ghost" onClick={() => setEd(null)}>Cancel</button></div></td></tr>]) }</tbody></table></div>))}
    </section>
  </>;
}

function Findings({ d, year, run }: { d: AssuranceData; year: number; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [f, setF] = useState({ severity: 'medium', kind: 'control', text: '', impact: '' });
  const [resp, setResp] = useState<{ id: string; text: string } | null>(null);
  const card = (x: AFinding) => (
    <div key={x.id} className="stmt">
      <div className="row" style={{ gap: 8 }}><span className={`chip ${SEV_C[x.severity]}`}>{x.severity}</span><span className="chip grey">{x.kind}</span>
        <span className={`chip ${x.status === 'closed' ? '' : x.status === 'responded' ? 'info' : 'warn'}`}>{x.status === 'closed' ? 'Closed' : x.status === 'responded' ? 'Responded — to close' : 'Open'}</span>
        {x.facility && <b>{x.facility}{x.period ? ` · ${x.period.slice(0, 7)}` : ''}{x.item ? ` · ${x.item}` : ''}</b>}<span className="grow" />
        {x.impactT != null && <span className="small">impact {fmt(x.impactT, 2)} t</span>}</div>
      <div>{x.text}</div>
      <div className="muted small">raised by {x.raisedBy} · {d8(x.raisedAt)}</div>
      {x.response && <div className="small" style={{ borderLeft: '3px solid var(--primary)', paddingLeft: 8 }}><b>Response</b> ({x.respondedBy}, {d8(x.respondedAt)}): {x.response}</div>}
      {x.status === 'closed' && <div className="muted small">closed by {x.closedBy} · {d8(x.closedAt)}{x.closeNote ? ` · ${x.closeNote}` : ''}</div>}
      <div className="row" style={{ gap: 6 }}>
        {x.status !== 'closed' && d.can.respond && <button className="btn xs" onClick={() => setResp({ id: x.id, text: x.response ?? '' })}>{x.response ? 'Change response' : 'Respond'}</button>}
        {x.status !== 'closed' && d.can.verify && <button className="btn xs p" onClick={() => void run(() => api.closeFinding(x.id, {}), 'Finding closed')}>Close</button>}
        {x.status === 'closed' && d.can.verify && <button className="btn xs ghost" onClick={() => void run(() => api.closeFinding(x.id, { reopen: true }), 'Reopened')}>Reopen</button>}
      </div>
      {resp?.id === x.id && <div className="row" style={{ gap: 6 }}><input className="input sm grow" autoFocus placeholder="What was done, e.g. bill attached and quantity corrected" value={resp.text} onChange={(e) => setResp({ ...resp, text: e.target.value })} />
        <button className="btn sm p" disabled={resp.text.trim().length < 3} onClick={() => void run(async () => { await api.respondFinding(x.id, resp.text.trim()); setResp(null); }, 'Response saved')}>Save</button><button className="btn sm ghost" onClick={() => setResp(null)}>Cancel</button></div>}
    </div>);
  return <>
    {d.can.verify && <section className="card tacard"><h2>Raise a finding</h2>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 120 }}><span>Severity</span><select className="input" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label className="field" style={{ width: 160 }}><span>Kind</span><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['misstatement', 'evidence', 'control', 'method', 'other'].map((k) => <option key={k}>{k}</option>)}</select></label>
        <label className="field grow"><span>Finding</span><input className="input" value={f.text} maxLength={2000} placeholder="e.g. Refrigerant top-ups are not reconciled with service reports" onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
        <label className="field" style={{ width: 130 }}><span>Impact (tCO₂e)</span><input className="input num" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value.replace(/[^0-9.-]/g, '') })} /></label>
        <button className="btn p" disabled={f.text.trim().length < 3} onClick={() => void run(async () => { await api.raiseFinding({ year, severity: f.severity, kind: f.kind, text: f.text.trim(), impactT: f.impact ? Number(f.impact) : undefined }); setF({ ...f, text: '', impact: '' }); }, 'Finding raised')}>Raise</button></div>
      <span className="muted small">Findings on a single entry are raised from its exception under Sampling & testing.</span></section>}
    <section className="card tacard"><h2>Findings {year} · {d.findings.length}</h2>{d.findings.length ? d.findings.map(card) : <div className="muted">No findings.</div>}</section>
  </>;
}

function Pack({ d, year }: { d: AssuranceData; year: number }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const p = await api.assurancePack(year);
      const samples = await Promise.all(d.samples.map(async (s) => ({ s, items: (await api.sample(s.id)).items })));
      const e = d.engagement, T = (head: string[], rows: (string | number)[][]) => `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      const f2 = (v: number) => v.toLocaleString('en', { maximumFractionDigits: 2 });
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verifier pack ${esc(p.company)} ${year}</title><style>${RT_CSS}</style></head><body>
        <div class="cover"><div class="eyb">Verifier pack · ${year}</div><h1>${esc(p.company)}</h1><table class="kv"><tbody>
        ${[['Standard', e?.standard ?? 'to be agreed'], ['Level of assurance', e?.level ?? '—'], ['Provider', e?.provider ?? '—'], ['Subject matter', e?.scope ?? '—'], ['Materiality', e?.materiality != null ? `${e.materiality}% of total` : '—'],
          ['Consolidation', p.consolidation], ['GWP', p.gwp], ['Base year', p.baseYear ?? '—'], ['Prepared', new Date().toLocaleString('en-GB')]].map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>
        <h2>GHG statement (approved entries)</h2>${T(['', 'tCO₂e'], [['Scope 1', f2(p.totals.s1)], ['Scope 2 — location-based', f2(p.totals.s2l)], ['Scope 2 — market-based', f2(p.totals.s2m)], ['Scope 3', f2(p.totals.s3)],
          ['<b>Total (location-based)</b>', `<b>${f2(p.totals.s1 + p.totals.s2l + p.totals.s3)}</b>`], ['Biogenic CO₂ (outside the scopes)', f2(p.totals.bio)], ['Approved entries', p.totals.n]])}
        <h2>Base-year recalculations (base year ${p.baseYear ?? ''})</h2>${p.restatements?.length ? T(['Decided', 'Change', 'Facility', 'tCO₂e', '% of base', 'Outcome', 'Recorded / decided by'], p.restatements.map((r) => [d8(r.decided_at), esc(r.title), esc(r.facility ?? 'Company'), f2(r.t), r.pct != null ? `${f2(r.pct)}%` : '—', r.status === 'rejected' ? `Rejected: ${esc(r.decision_note ?? '')}` : r.applied ? 'Restated' : 'Recorded (below threshold)', esc(`${r.proposed_name ?? ''} / ${r.decided_name ?? ''}`)])) : '<p>None.</p>'}
        <h2>Emission factor sources</h2>${T(['Source', 'Entries'], p.sources.map((s) => [esc(s.source), s.n]))}
        <h2>Period locks</h2>${T(['Month', 'Status', 'Locked by'], d.months.map((m) => [m.month, m.lock ? 'Locked' : m.ready ? 'Ready' : m.open ? `${m.open} not approved` : 'No data', m.lock ? `${esc(m.lock.lockedBy)} · ${d8(m.lock.lockedAt)}` : '']))}
        ${samples.map(({ s, items }) => `<h2>Sample · ${s.method === 'value' ? 'value-weighted' : 'random'} · seed ${s.seed}</h2><p class="small">Population ${s.population} entries, ${f2(s.populationT)} tCO₂e; ${s.keyItems} key items; drawn ${d8(s.at)} by ${esc(s.by)}.</p>`
          + T(['Facility · period', 'Item', 'Quantity', 'tCO₂e', 'Evidence', 'Result'], items.map((i) => [`${esc(i.facility)} · ${i.from.slice(0, 7)}${i.key ? ' (key)' : ''}`, esc(i.item), `${f2(i.qty)} ${esc(i.unit)}`, f2(i.t), esc(i.evidenceKind ?? 'none'), `${i.result ?? 'not tested'}${i.note ? ` — ${esc(i.note)}` : ''}`]))).join('')}
        <h2>Findings</h2>${d.findings.length ? T(['Finding', 'Severity', 'Impact t', 'Status'], d.findings.map((x) => [`${esc(x.text)}${x.response ? `<div class="small">Response: ${esc(x.response)}</div>` : ''}`, x.severity, x.impactT != null ? f2(x.impactT) : '—', x.status])) : '<p>None.</p>'}
        ${e?.opinion ? `<h2>Conclusion</h2><p>${esc(e.opinion)}</p>` : ''}
        <p class="small">Change trail: ${p.trail.length} events (separate CSV). Entries with factors: Reports → Templates & regulatory → dataset export.</p></body></html>`;
      download(`Verifier pack - ${p.company} - ${year}.html`, html, 'text/html;charset=utf-8');
      download(`Change trail - ${p.company} - ${year}.csv`, csv(['When', 'User', 'Action', 'Entry / object', 'Detail'], p.trail.map((t) => [new Date(t.at).toISOString(), t.user ?? '', t.action, t.entityId ?? '', JSON.stringify(t.detail ?? '')])));
    } catch (x) { toast((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="card tacard">
      <h2>Verifier pack {year}</h2>
      <p className="muted">One file for the assurance provider: the engagement, the GHG statement from approved entries (both Scope 2 methods, biogenic CO₂ separately), factor sources, period locks, every sample with its test results, findings with responses, and the conclusion — plus the full change trail of the year's entries as CSV.</p>
      <div className="row" style={{ gap: 8 }}><button className="btn p" disabled={busy} onClick={() => void make()}>{busy ? 'Preparing…' : 'Download verifier pack'}</button>
        <Link className="btn" to="/reports?rtab=audit">Granular audit view →</Link><Link className="btn" to="/reports?rtab=tpl">Reports & datasets →</Link></div>
    </section>);
}
