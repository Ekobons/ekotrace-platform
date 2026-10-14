/**
 * Base year & restatements (Methodology): the base year as measured, the changes recorded against it
 * (structural, method, error), their approval by a second person, the significance test (alone or with
 * earlier recorded changes) and the restated base year that targets, the Net Zero path, KPIs and reports use.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, type Restatement, type RestatementData } from '../lib/api';
import { Icon } from './Icon';

const f1 = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const sg = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${f1(Math.abs(x))}`;
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STRUCT = ['acquisition', 'divestment', 'insourcing', 'outsourcing'];
const HINT: Record<string, string> = {
  acquisition: 'Add the acquired operation\'s base-year emissions (from its own records), as if it had always been part of the company.',
  divestment: 'Remove the sold or closed facility\'s base-year emissions. Choose the facility and use its figures.',
  insourcing: 'Add the base-year emissions of the activity now run in-house (previously in Scope 3, now Scope 1 or 2).',
  outsourcing: 'Remove the base-year emissions of the activity now bought from others (move them to Scope 3 if still counted there).',
  method: 'The difference the improved method makes to the base year (recalculate the base year with the new method and enter the change).',
  factor: 'The difference new emission factors or GWP values make to the base year.',
  error: 'The correction to the base year (a double count, a missing site, a wrong unit).',
  boundary: 'The effect of the change in boundary or consolidation approach on the base year.',
  other: 'Describe the change and its effect on the base year.',
};

export function Restatements() {
  const { toast } = useApp();
  const [d, setD] = useState<RestatementData | null>(null);
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [thr, setThr] = useState('');
  useEffect(() => { api.restatements().then((x) => { setD(x); setThr(String(x.threshold)); }).catch(() => {}); }, [tick]);
  useEffect(() => { if (location.hash === '#restatements') document.getElementById('restatements')?.scrollIntoView(); }, [d === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  const reload = () => setTick((t) => t + 1);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  const approve = async (id: string) => {
    try {
      const res = await api.restatementDecide(id, 'approve', note[id] || undefined);
      toast(res.applied ? `Base year restated: ${f1(res.before)} → ${f1(res.after)} t${res.alsoApplied ? ` (with ${res.alsoApplied} earlier change${res.alsoApplied > 1 ? 's' : ''})` : ''}`
        : `Approved and recorded: ${f1(res.pct)}% of the base year, below the ${d.threshold}% threshold (recorded so far ${f1(res.cumulativePct)}%)`);
      reload();
    } catch (e) { toast((e as Error).message); }
  };
  const m = d.measured, r = d.restated, diff = r.total - m.total;
  const ST = (x: Restatement): [string, string] => x.status === 'pending' ? ['warn', 'Waiting for approval'] : x.status === 'rejected' ? ['bad', 'Rejected'] : x.status === 'withdrawn' ? ['grey', 'Withdrawn']
    : x.applied ? ['', 'Restated'] : ['info', 'Recorded · below threshold'];
  return (
    <div className="card" id="restatements" style={{ display: 'grid', gap: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="grow"><h2>Base year {d.baseYear} &amp; restatements</h2>
          <p className="sub" style={{ margin: 0 }}>When the company changes (an acquisition, a sale, work brought in-house or outsourced), when a better method or factor is adopted, or when an error is found, the base year is recalculated so that progress against targets compares like with like (GHG Protocol ch. 5, ISO 14064-1 §6.4.1). A second person approves each change.</p></div>
        {d.canPropose && <button className="btn p" onClick={() => setAdding(true)}>+ Record a change</button>}
      </div>
      <div className="rsgrid">
        <div className="rsbox"><span className="muted small">As measured (approved entries)</span><b>{f1(m.total)} t</b><span className="small muted">S1 {f1(m.s1)} · S2 {f1(m.s2)} · S3 {f1(m.s3)}</span></div>
        <div className="rsbox"><span className="muted small">Restatements applied</span><b style={{ color: diff ? (diff < 0 ? 'var(--ok)' : 'var(--warn)') : undefined }}>{diff ? `${sg(diff)} t` : 'None'}</b><span className="small muted">{d.items.filter((x) => x.applied).length} change{d.items.filter((x) => x.applied).length === 1 ? '' : 's'}</span></div>
        <div className="rsbox strong"><span className="muted small">Restated base year — used by targets, Net Zero path, KPIs, reports</span><b>{f1(r.total)} t</b><span className="small muted">S1 {f1(r.s1)} · S2 {f1(r.s2)} (market {f1(r.s2m)}) · S3 {f1(r.s3)}</span></div>
        <div className="rsbox"><span className="muted small">Significance threshold</span>
          {d.canSettings ? <span className="row" style={{ gap: 6 }}><input className="input num sm" style={{ width: 70 }} value={thr} onChange={(e) => setThr(e.target.value)} aria-label="Threshold %" /><b style={{ fontSize: 18 }}>%</b>
            {Number(thr) !== d.threshold && <button className="btn sm p" onClick={() => act(() => api.restatementSettings(Number(thr)), `Threshold ${thr}%`)}>Save</button>}</span> : <b>{d.threshold}%</b>}
          <span className="small muted">Recorded below it: {d.recorded.n} · net {sg(d.recorded.net)} t ({f1(d.recorded.pct)}%)</span></div>
      </div>
      {!d.items.length ? <div className="muted small">No changes recorded for {d.baseYear}.</div> : (
        <div className="scroll"><table className="t rstable">
          <thead><tr><th>Change</th><th>Trigger</th><th>Facility</th><th className="num">S1</th><th className="num">S2</th><th className="num">S3</th><th className="num">% of base</th><th>Status</th><th>Recorded / decided</th></tr></thead>
          <tbody>{d.items.map((x) => { const [c, t] = ST(x); return (
            <tr key={x.id}>
              <td style={{ minWidth: 220 }}><b>{x.title}</b>{x.description && <div className="muted small">{x.description}</div>}{x.document && <div className="small"><Icon name="doc" /> {x.document}</div>}
                {x.base_year !== d.baseYear && <div className="small" style={{ color: 'var(--warn)' }}>For base year {x.base_year}</div>}</td>
              <td className="small">{d.triggers[x.trigger]}{x.effective && <div className="muted">{d8(x.effective)}</div>}</td>
              <td className="small">{x.facility ?? 'Whole company'}{x.facility && !x.facility_active && <div className="muted">switched off — already left out</div>}</td>
              <td className="num small">{sg(x.s1)}</td><td className="num small">{sg(x.s2)}{x.s2m != null && x.s2m !== x.s2 && <div className="muted">mkt {sg(x.s2m)}</div>}</td><td className="num small">{sg(x.s3)}</td>
              <td className="num small">{x.pct != null ? `${f1(x.pct)}%` : '—'}</td>
              <td><span className={`chip ${c}`}>{t}</span>{x.force && <div className="small muted">restate anyway</div>}{x.applied_with_title && <div className="small muted">applied with “{x.applied_with_title}”</div>}</td>
              <td className="small">{x.proposed_name} · {d8(x.proposed_at)}{x.decided_name && x.status !== 'pending' && <div className="muted">{x.status} by {x.decided_name} · {d8(x.decided_at)}</div>}
                {x.decision_note && <div className="muted">“{x.decision_note}”</div>}
                {x.status === 'pending' && d.canDecide && !x.mine && (
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <input className="input sm grow" placeholder="Note (needed to reject)" value={note[x.id] ?? ''} onChange={(e) => setNote({ ...note, [x.id]: e.target.value })} />
                    <button className="btn sm" onClick={() => act(() => api.restatementDecide(x.id, 'reject', note[x.id]), 'Rejected')}>Reject</button>
                    <button className="btn sm p" onClick={() => void approve(x.id)}>Approve</button>
                  </div>)}
                {x.status === 'pending' && x.mine && <div style={{ marginTop: 6 }}><button className="btn sm" onClick={() => act(() => api.restatementWithdraw(x.id), 'Withdrawn')}>Withdraw</button></div>}
              </td>
            </tr>); })}</tbody>
        </table></div>)}
      {adding && <AddDrawer d={d} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </div>);
}

function AddDrawer({ d, onClose, onDone }: { d: RestatementData; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ trigger: 'divestment', title: '', description: '', facilityId: '', effective: '', s1: '', s2: '', s2m: '', s3: '', documentId: '', force: false });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const [busy, setBusy] = useState(false);
  const fill = async (sign: 1 | -1) => {
    if (!f.facilityId) return;
    try { const x = await api.restatementFacility(f.facilityId); const r = (v: number) => String(Math.round(v * sign * 1000) / 1000); up({ s1: r(x.s1), s2: r(x.s2), s2m: r(x.s2m), s3: r(x.s3) }); toast(`${x.facility.name}: ${f1(x.s1 + x.s2 + x.s3)} t in ${x.year}`); }
    catch (e) { toast((e as Error).message); }
  };
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const total = num(f.s1) + num(f.s2) + num(f.s3), pct = d.restated.total ? (Math.abs(total) / d.restated.total) * 100 : 0;
  const net = d.recorded.net + total, netPct = d.restated.total ? (Math.abs(net) / d.restated.total) * 100 : 0;
  const fac = d.facilities.find((x) => x.id === f.facilityId);
  const save = async () => {
    setBusy(true);
    try {
      await api.restatementPropose({ trigger: f.trigger, title: f.title, description: f.description, facilityId: f.facilityId || null, effective: f.effective || null,
        s1: num(f.s1), s2: num(f.s2), s2m: f.s2m.trim() === '' ? null : num(f.s2m), s3: num(f.s3), documentId: f.documentId || null, force: f.force });
      toast('Recorded — waiting for a second person to approve'); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Base year {d.baseYear}</div><h2>Record a change to the base year</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <div className="vform">
          <label className="field"><span>What happened</span><select className="input" value={f.trigger} onChange={(e) => up({ trigger: e.target.value })}>{Object.entries(d.triggers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>When</span><input className="input" type="date" value={f.effective} onChange={(e) => up({ effective: e.target.value })} /></label>
          <div className="note info small span2">{HINT[f.trigger]}</div>
          <label className="field span2"><span>Title</span><input className="input" value={f.title} placeholder={f.trigger === 'divestment' ? 'e.g. Sale of the Al Ain recycling plant' : 'e.g. Landfill gas measured instead of modelled'} onChange={(e) => up({ title: e.target.value })} /></label>
          <label className="field span2"><span>Description and how the change was calculated</span><textarea className="input" rows={3} value={f.description} onChange={(e) => up({ description: e.target.value })} /></label>
          <label className="field"><span>Facility concerned (optional)</span><select className="input" value={f.facilityId} onChange={(e) => up({ facilityId: e.target.value })}><option value="">The whole company</option>{d.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' (switched off)'}</option>)}</select></label>
          <div className="field"><span>Use its base-year emissions</span><div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" disabled={!f.facilityId} onClick={() => fill(-1)}>− remove them</button><button type="button" className="btn sm" disabled={!f.facilityId} onClick={() => fill(1)}>+ add them</button></div></div>
          {fac && !fac.active && <div className="note warn small span2">{fac.name} is switched off, so its data is already left out of the base year in every view. This record documents the change and counts towards the threshold; it is not subtracted again.</div>}
          {[['s1', 'Scope 1'], ['s2', 'Scope 2 (location-based)'], ['s2m', 'Scope 2 market-based (blank: same)'], ['s3', 'Scope 3']].map(([k, l]) => (
            <label key={k} className="field"><span>{l} · tCO₂e (+ adds, − removes)</span><input className="input num" inputMode="decimal" value={f[k as 's1']} onChange={(e) => up({ [k]: e.target.value })} /></label>))}
          <label className="field span2"><span>Evidence (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <div className="span2 rscheck">
            <b>{sg(total)} t · {f1(pct)}% of the base year</b> (threshold {d.threshold}%).{' '}
            {pct >= d.threshold ? 'Significant: the base year will be restated when approved.' : netPct >= d.threshold ? `With the ${d.recorded.n} change${d.recorded.n === 1 ? '' : 's'} already recorded (net ${f1(netPct)}%), the threshold is reached: all will be applied when approved.` : 'Below the threshold: it will be recorded and count towards the next change, unless you restate anyway.'}
          </div>
          <label className="span2 row small chkline"><input type="checkbox" checked={f.force} onChange={(e) => up({ force: e.target.checked })} /><b>Restate anyway, even below the threshold (company policy)</b></label>
        </div>
        <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button className="btn p" disabled={busy || f.title.trim().length < 3 || !total && !num(f.s2m)} onClick={save}>Record for approval</button></div>
      </div>
    </dialog>);
}
