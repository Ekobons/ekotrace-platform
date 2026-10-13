/**
 * Approvals (as in the prototype): entries submitted for the facilities you look after. Each one is
 * checked against the facility's 6-month average for that item; approve it, or send it back with a
 * note. "Approve all without warnings" approves every entry inside its usual range. Entries waiting
 * for someone else are listed below with who they wait for. With level 2 switched on (Methodology),
 * large entries go on to an admin or the super admin after level 1.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { api, num, unitLabel, type ApprovalRow, type ApprovalsData } from '../lib/api';
import { ENERGY_UNITS, Result } from '../components/Result';
import { Icon } from '../components/Icon';
import { MN, fmt } from '../components/DashCharts';

const ml = (m: string) => `${MN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function Approvals() {
  const { toast } = useApp();
  const [d, setD] = useState<ApprovalsData | null>(null);
  const [tick, setTick] = useState(0);
  const [ret, setRet] = useState<{ id: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Awaited<ReturnType<typeof api.activity>> | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { api.approvals().then(setD).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const act = async (ids: string[], action: 'approve' | 'return', note?: string) => {
    setBusy(true);
    try {
      const r = await api.reviewAction(ids, action, note);
      const l2 = r.toLevel2 ?? 0, final = r.done - l2;
      toast(action === 'return' ? 'Sent back with your note' : [final ? `${final} approved` : '', l2 ? `${l2} reviewed — now waiting for level-2 approval` : '', r.skipped.length ? `${r.skipped.length} skipped (${r.skipped[0]!.reason})` : ''].filter(Boolean).join(' · '));
      setRet(null); reload();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const show = async (id: string) => { try { setOpen(await api.activity(id)); dlg.current?.showModal(); } catch (e) { toast((e as Error).message); } };
  // filters: facility, category, month, check, level, search — applied to both lists
  const [F, setF] = useState({ fac: '', cat: '', month: '', check: '', level: '', q: '' });
  const all = [...(d?.mine ?? []), ...(d?.others ?? [])];
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const facs = uniq(all.map((l) => l.facility)).sort(), cats = uniq(all.map((l) => l.category)).sort(), months = uniq(all.map((l) => l.month.slice(0, 7))).sort().reverse();
  const keep = (l: ApprovalRow) => (!F.fac || l.facility === F.fac) && (!F.cat || l.category === F.cat) && (!F.month || l.month.startsWith(F.month))
    && (!F.check || (F.check === 'warn' ? l.check && !l.check.ok : F.check === 'ok' ? l.check?.ok : !l.check))
    && (!F.level || (F.level === 'L2' ? l.stage === 'L2' : l.stage !== 'L2'))
    && (!F.q || `${l.item} ${l.note ?? ''} ${l.by ?? ''}`.toLowerCase().includes(F.q.toLowerCase()));
  const mine = (d?.mine ?? []).filter(keep), others = (d?.others ?? []).filter(keep), filtered = Object.values(F).some(Boolean);
  const clean = mine.filter((l) => !l.check || l.check.ok);
  const sel = (k: keyof typeof F, label: string, opts: [string, string][]) => (
    <select className="input sm" aria-label={label} style={{ width: 'auto', maxWidth: 230 }} value={F[k]} onChange={(e) => setF({ ...F, [k]: e.target.value })}>
      <option value="">{label}</option>{opts.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>);

  const row = (l: ApprovalRow, can: boolean) => (
    <tr key={l.id}>
      <td><b>{l.facility}</b><div className="muted small">{ml(l.month)}</div></td>
      <td>{l.category}{l.stage === 'L2' && <> <span className="chip c-info">Level 2</span></>}
        <div className="muted small">{l.item}{l.note ? ` · ${l.note}` : ''}{l.dataType && l.dataType !== 'actual' ? ` · ${l.dataType}` : ''}</div>
        {l.stage === 'L2' && l.l1 && <div className="muted small">Level 1 approved by {l.l1}</div>}
        {can && l.willNeedL2 && <div className="muted small">Goes on to level 2 after your approval</div>}</td>
      <td className="num nowrap">{fmt(l.qty, l.qty < 100 ? 2 : 0)} <span className="muted">{unitLabel(l.unit)}</span></td>
      <td className="num"><b>{fmt(l.kg / 1000, 2)}</b><div><button className="btn xs ghost" onClick={() => void show(l.id)}>How calculated</button></div></td>
      <td className="small" style={{ color: l.check ? (l.check.ok ? 'var(--ok)' : 'var(--warn)') : 'var(--muted)', maxWidth: 240 }}>{l.check ? l.check.txt : 'No history to compare'}</td>
      <td className="muted small nowrap">{l.by?.replace(/ \(.*\)$/, '') ?? '—'}<br />{l.at ? new Date(l.at).toLocaleDateString('en-GB') : ''}</td>
      <td>{can ? (ret?.id === l.id
        ? <div className="row nowrap" style={{ gap: 6 }}><input className="input sm" autoFocus style={{ minWidth: 200 }} placeholder="What needs fixing?" value={ret.note} onChange={(e) => setRet({ id: l.id, note: e.target.value })} />
            <button className="btn sm danger" disabled={busy || !ret.note.trim()} onClick={() => void act([l.id], 'return', ret.note.trim())}>Send back</button><button className="btn sm ghost" onClick={() => setRet(null)}>Cancel</button></div>
        : <div className="row nowrap" style={{ gap: 6 }}><button className="btn sm p" disabled={busy} onClick={() => void act([l.id], 'approve')}>Approve</button><button className="btn sm" disabled={busy} onClick={() => setRet({ id: l.id, note: '' })}>Send back</button></div>)
        : <span className="muted small">{l.mine ? 'Your entry → ' : 'Waiting for '}{l.waitingFor}</span>}</td>
    </tr>);
  const head = <thead><tr><th>Facility</th><th>What</th><th className="num">Quantity</th><th className="num">tCO₂e</th><th>Check</th><th>Entered</th><th /></tr></thead>;

  return (
    <div className="page">
      <div className="row tahead">
        <div><span className="lbl">Capture</span><h1>Approvals</h1><div className="muted">Entries submitted for facilities you look after. Approved data flows into dashboards and reports.</div></div>
        <span className="grow" />
        {d && d.settings.l2 && <span className="chip c-info">Level 2 on · ≥ {fmt(d.settings.minT, 0)} t{d.settings.cats.length ? ` or ${d.settings.cats.length} categories` : ''}</span>}
        {clean.length > 0 && <button className="btn p" disabled={busy} onClick={() => void act(clean.map((l) => l.id), 'approve')}>Approve all {clean.length}{filtered ? ' shown' : ''} without warnings</button>}
      </div>
      {!d ? <div className="card empty">Loading…</div> : <>
        <div className="row apfilt">
          <input className="input sm" type="search" placeholder="Search item, note, person" style={{ width: 220 }} value={F.q} onChange={(e) => setF({ ...F, q: e.target.value })} />
          {sel('fac', 'All facilities', facs.map((x) => [x, x]))}
          {sel('cat', 'All categories', cats.map((x) => [x, x]))}
          {sel('month', 'All months', months.map((m) => [m, ml(m)]))}
          {sel('check', 'Any check', [['warn', 'With warnings'], ['ok', 'In usual range'], ['none', 'No history']])}
          {d.settings.l2 && sel('level', 'Any level', [['L1', 'Level 1'], ['L2', 'Level 2']])}
          {filtered && <button className="btn sm ghost" onClick={() => setF({ fac: '', cat: '', month: '', check: '', level: '', q: '' })}>Clear filters</button>}
          <span className="grow" /><span className="muted small">{mine.length + others.length} of {all.length} shown</span>
        </div>
        <section className="card tacard">
          <div className="row"><h2>Waiting for you · {mine.length}{filtered ? ` of ${d.mine.length}` : ''}</h2><span className="grow" /><span className="muted small">Check = quantity against the facility’s average for the same item over the 6 months before (limit ±{d.settings.checkPct}%). Nobody approves their own entry.</span></div>
          <div className="scrollx"><table className="t">{head}<tbody>{mine.map((l) => row(l, true))}{!mine.length && <tr><td colSpan={7} className="muted">{d.mine.length ? 'Nothing matches the filters.' : 'Nothing waiting for your approval.'}</td></tr>}</tbody></table></div>
        </section>
        {others.length > 0 && (
          <section className="card tacard">
            <h2>Waiting for someone else · {others.length}</h2>
            <div className="scrollx"><table className="t">{head}<tbody>{others.map((l) => row(l, false))}</tbody></table></div>
          </section>)}
        <div className="row muted small" style={{ gap: 12 }}><span>Approval levels and the check limit are set under</span><Link to="/methodology" className="btn xs ghost">Methodology & boundaries →</Link><span>Month by month status:</span><Link to="/progress" className="btn xs ghost">Data progress →</Link></div>
      </>}
      <dialog ref={dlg} className="drawer" onClose={() => setOpen(null)}>
        {open && (
          <div className="in">
            <div className="row"><div className="grow"><div className="eyebrow">Entry · {open.period_start} to {open.period_end}</div><h2>{open.vehicle ? `${open.vehicle} · ` : ''}{open.waste_site ? `${open.waste_site} · ` : ''}{open.item}</h2></div>
              <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
            <div className="sub">{num(open.quantity)} {unitLabel(open.unit)} · {open.data_type} · saved {new Date(open.created_at).toLocaleString()}</div>
            <Result r={{ gwpSet: open.gwp_set, totals: { direct: Number(open.co2e_direct), scope2: Number(open.co2e_scope2 ?? 0), scope2_market: Number(open.co2e_scope2_market ?? 0), td_loss: Number(open.co2e_td ?? 0), scope3: Number(open.co2e_scope3 ?? 0), wtt: Number(open.co2e_wtt), outside_scopes: Number(open.co2_biogenic), memo: Number(open.co2e_memo) },
              lines: open.lines.map((x) => ({ basis: x.basis, gas: x.gas, kgGas: x.kg_gas, kgCo2e: x.kg_co2e, method: x.method, source: x.source })), steps: open.steps, warnings: open.warnings, factors: open.factors, cv: open.inputs?.cv }} quantity={Number(open.quantity)} unitName={open.unit} energy={ENERGY_UNITS.has(open.unit)} />
          </div>)}
      </dialog>
    </div>);
}
