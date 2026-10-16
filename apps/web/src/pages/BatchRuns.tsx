/**
 * Batch runs (Capture): every batch of data that came in from a file or a connected system, whether it reconciles
 * with the source (control totals → received → published / excluded / problems → entries), the health of each
 * connected system (last success, failures, expected frequency) and every transfer, including failed calls.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type BatchRecon, type BatchRow, type BatchesData, type IntegrationSource, type Recon, type Transfer } from '../lib/api';
import { Icon } from '../components/Icon';

const f0 = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 0 });
const f2 = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 2 });
const t1 = (kg: number) => (kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: kg < 10000 ? 2 : 1 });
const dt = (x: string | null) => (x ? new Date(x).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (x: string | null) => {
  if (!x) return 'never';
  const h = (Date.now() - new Date(x).getTime()) / 3600e3;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};
const SRC: Record<string, string> = { upload: 'File upload', manual: 'Typed in', api: 'System (API)' };
const RECON: Record<Recon, [string, string]> = { balanced: ['', 'Reconciled'], differences: ['bad', 'Differences'], open: ['info', 'In review'], no_control: ['grey', 'No source totals'], failed: ['grey', 'Not processed'] };
const HEALTH: Record<IntegrationSource['health'], [string, string]> = {
  healthy: ['', 'Healthy'], warning: ['warn', 'Failures in the last 24 h'], failing: ['bad', 'Failing'], quiet: ['warn', 'Gone quiet'], never: ['grey', 'Nothing sent yet'], revoked: ['grey', 'Key revoked'],
};
const BSTATUS = (s: string): [string, string] => s === 'published' ? ['', 'Published'] : s === 'failed' ? ['bad', 'Failed'] : s === 'review' ? ['info', 'To review'] : s === 'receiving' ? ['grey', 'Receiving'] : ['grey', s[0]!.toUpperCase() + s.slice(1)];
const EXPECT: [number | null, string][] = [[null, 'Not set'], [1, 'Every hour'], [6, 'Every 6 hours'], [24, 'Daily'], [48, 'Every 2 days'], [168, 'Weekly'], [744, 'Monthly']];

export function BatchRuns() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'batches') as 'batches' | 'readings' | 'transfers';
  const days = Number(sp.get('days') ?? 30);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const [d, setD] = useState<BatchesData | null>(null);
  const [tick, setTick] = useState(0);
  const [recon, setRecon] = useState<string | null>(sp.get('batch'));
  const [xfer, setXfer] = useState<string | null>(null);
  const [only, setOnly] = useState<'all' | 'attention'>('all');
  useEffect(() => { api.batches(days).then(setD).catch((e) => toast((e as Error).message)); }, [days, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const rows = useMemo(() => (d?.batches ?? []).filter((b) => only === 'all' || b.recon === 'differences' || b.status === 'failed'), [d, only]);
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const failed = d.batches.filter((b) => b.status === 'failed').length, diff = d.batches.filter((b) => b.recon === 'differences').length;
  const bal = d.batches.filter((b) => b.recon === 'balanced').length, openN = d.batches.filter((b) => b.recon === 'open').length;
  const tf = d.transfers.filter((t) => t.status === 'failed').length, recv = d.transfers.reduce((a, t) => a + t.received, 0), refused = d.transfers.reduce((a, t) => a + t.rejected, 0);
  const attention = d.sources.filter((s) => ['failing', 'quiet', 'warning'].includes(s.health)).length;
  const retry = async (id: string) => { try { await api.batchRetry(id); toast('Queued to run again'); reload(); } catch (e) { toast((e as Error).message); } };
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Capture</span><h1>Batch runs</h1>
          <div className="muted">Every batch of data that came in from a file or a connected system (SAP, Oracle, meters, BMS): whether it reconciles with what the source sent, what was refused and why, and the health of each connection. Failed processing can be run again.</div></div>
        <label className="field" style={{ minWidth: 140 }}><span>Period</span>
          <select className="input" value={days} onChange={(e) => set('days', e.target.value === '30' ? null : e.target.value)}>{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></label>
      </div>

      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Batches</span><b>{d.batches.length}</b><span className="muted small">{failed ? <span style={{ color: 'var(--bad)' }}>{failed} failed · </span> : ''}{d.batches.filter((b) => b.status === 'review').length} to review · {d.readings.filter((r) => r.status === 'review').length} meter batches to review</span></div>
        <button type="button" className={`card kpi vk${only === 'attention' ? ' on' : ''}`} onClick={() => { setOnly(only === 'attention' ? 'all' : 'attention'); set('tab', null); }}>
          <span className="muted small">Reconciliation</span><b style={{ color: diff ? 'var(--bad)' : undefined }}>{diff ? `${diff} with differences` : `${bal} reconciled`}</b>
          <span className="muted small">{bal} reconciled · {openN} in review · {d.batches.filter((b) => b.recon === 'no_control').length} without source totals</span></button>
        {d.seesSources && <>
        <div className="card kpi"><span className="muted small">Transfers from systems</span><b>{d.transfers.length}</b><span className="muted small">{tf ? <span style={{ color: 'var(--bad)' }}>{tf} failed · </span> : ''}{f0(recv)} records received · {f0(refused)} refused</span></div>
        <div className="card kpi"><span className="muted small">Connected systems</span><b style={{ color: attention ? 'var(--warn)' : undefined }}>{attention ? `${attention} need attention` : `${d.sources.filter((s) => s.health === 'healthy').length} healthy`}</b>
          <span className="muted small">{d.sources.filter((s) => s.health !== 'revoked').length} active · <Link to="/integrations">keys and set-up →</Link></span></div>
        </>}
      </div>

      {d.seesSources && (
        <div className="brsrc">
          {d.sources.map((s) => <SourceCard key={s.id} s={s} can={d.canManage} onSaved={reload} />)}
          <div className="card brcard">
            <div className="row"><b className="grow">Purchase files</b><span className="chip grey">Upload</span></div>
            <div className="small muted">Spreadsheets loaded under Purchases</div>
            <div className="brnums"><span><b>{d.channels.uploads.n}</b> files</span><span><b style={{ color: d.channels.uploads.failed ? 'var(--bad)' : undefined }}>{d.channels.uploads.failed}</b> failed</span><span><b>{d.channels.uploads.review}</b> to review</span></div>
            <div className="small muted">Last {ago(d.channels.uploads.last)}</div>
          </div>
          <div className="card brcard">
            <div className="row"><b className="grow">Utility bills</b><span className="chip grey">PDF reading</span></div>
            <div className="small muted">Bills read automatically (DEWA, SEWA, ADDC, Empower…)</div>
            <div className="brnums"><span><b>{d.channels.bills.n}</b> bills</span><span><b>{d.channels.bills.review}</b> to check</span><span><b>{d.channels.bills.rejected}</b> rejected</span></div>
            <div className="small muted">Last {ago(d.channels.bills.last)}</div>
          </div>
        </div>
      )}

      <div className="seg strong" role="tablist">
        <button role="tab" aria-selected={tab === 'batches'} className={tab === 'batches' ? 'on' : ''} onClick={() => set('tab', null)}>Purchase batches ({d.batches.length})</button>
        {d.seesSources && <button role="tab" aria-selected={tab === 'readings'} className={tab === 'readings' ? 'on' : ''} onClick={() => set('tab', 'readings')}>Meter-reading batches ({d.readings.length})</button>}
        {d.seesSources && <button role="tab" aria-selected={tab === 'transfers'} className={tab === 'transfers' ? 'on' : ''} onClick={() => set('tab', 'transfers')}>Transfers{tf ? ` · ${tf} failed` : ` (${d.transfers.length})`}</button>}
      </div>

      {tab === 'batches' && (
        <div className="card flush">
          {only === 'attention' && <div className="row vfilters"><span className="grow small">Showing batches that failed or do not reconcile.</span><button className="btn sm" onClick={() => setOnly('all')}>Show all</button></div>}
          {!rows.length ? <div className="empty" style={{ padding: 24 }}>No batches in this period.</div> : (
            <div className="scroll"><table className="t brtable">
              <thead><tr><th>Started</th><th>Batch</th><th>Source</th><th className="ctr">Status</th><th className="num">Lines</th><th>Outcome</th><th className="num">tCO₂e</th><th>Reconciliation</th><th /></tr></thead>
              <tbody>{rows.map((b) => <BatchLine key={b.id} b={b} onRecon={() => setRecon(b.id)} onRetry={() => retry(b.id)} />)}</tbody>
            </table></div>)}
        </div>)}
      {tab === 'readings' && (
        <div className="card flush">
          {!d.readings.length ? <div className="empty" style={{ padding: 24 }}>No meter-reading batches in this period. Readings sent by systems wait for review here when the company reviews readings before publishing them.</div> : (
            <div className="scroll"><table className="t brtable">
              <thead><tr><th>Received</th><th>System</th><th className="num">Readings</th><th className="num">Refused</th><th>New · corrections · duplicates · conflicts</th><th className="ctr">Status</th></tr></thead>
              <tbody>{d.readings.map((r) => (
                <tr key={r.id}>
                  <td className="small nowrap">{dt(r.created_at)}</td><td><b>{r.client ?? '—'}</b></td><td className="num">{f0(r.received)}</td>
                  <td className="num" style={{ color: r.rejected ? 'var(--bad)' : undefined }}>{f0(r.rejected)}</td>
                  <td className="small">{f0(r.staged.new ?? 0)} · {f0(r.staged.changed ?? 0)} · {f0(r.staged.same ?? 0)} · <span style={{ color: r.staged.conflict ? 'var(--warn)' : undefined }}>{f0(r.staged.conflict ?? 0)}</span></td>
                  <td>{r.status === 'review' ? <span className="chip info">To review</span> : r.status === 'published' ? <span className="chip">Published</span> : <span className="chip grey">Discarded</span>}
                    {r.decided_by && <div className="small muted">{r.decided_by} · {dt(r.decided_at)}</div>}{r.status === 'review' && <div className="small muted">Add data → the category → Meter readings</div>}</td>
                </tr>))}</tbody>
            </table></div>)}
        </div>)}
      {tab === 'transfers' && (
        <div className="card flush">
          {!d.transfers.length ? <div className="empty" style={{ padding: 24 }}>No transfers from connected systems in this period.</div> : (
            <div className="scroll"><table className="t brtable">
              <thead><tr><th>When</th><th>System</th><th>What</th><th className="num">Received</th><th className="num">Accepted</th><th className="num">Refused</th><th>Result</th><th className="num">Time</th></tr></thead>
              <tbody>{d.transfers.map((t) => (
                <tr key={t.id} className="click" onClick={() => setXfer(t.id)}>
                  <td className="small nowrap">{dt(t.at)}</td><td><b>{t.client ?? '—'}</b></td>
                  <td className="small">{d.sourceText[t.source] ?? t.source}{t.reference && <div className="muted mono">{t.reference}</div>}</td>
                  <td className="num small">{f0(t.received)}</td><td className="num small">{f0(t.accepted)}</td><td className="num small" style={{ color: t.rejected ? 'var(--bad)' : undefined }}>{f0(t.rejected)}</td>
                  <td style={{ maxWidth: 360 }}>{t.status === 'ok' ? <span className="chip">OK</span> : t.status === 'partial' ? <span className="chip warn">Some refused</span> : <span className="chip bad">Failed · HTTP {t.http_status}</span>}
                    {t.error && <div className="small muted clamp2">{t.error}</div>}</td>
                  <td className="num small muted">{t.duration_ms != null ? `${f0(t.duration_ms)} ms` : ''}</td>
                </tr>))}</tbody>
            </table></div>)}
        </div>)}
      {recon && <ReconDrawer id={recon} onClose={() => setRecon(null)} onChanged={reload} />}
      {xfer && <TransferDrawer id={xfer} text={d.sourceText} onClose={() => setXfer(null)} />}
    </div>);
}

function SourceCard({ s, can, onSaved }: { s: IntegrationSource; can: boolean; onSaved: () => void }) {
  const { toast } = useApp();
  const [c, t] = HEALTH[s.health];
  const save = async (v: string) => { try { await api.sourceExpect(s.id, v ? Number(v) : null); toast('Saved'); onSaved(); } catch (e) { toast((e as Error).message); } };
  return (
    <div className={`card brcard${s.health === 'failing' ? ' bad' : s.health === 'quiet' || s.health === 'warning' ? ' warn' : ''}`}>
      <div className="row" style={{ gap: 6 }}><b className="grow">{s.name}</b><span className={`chip ${c}`}>{t}</span></div>
      <div className="small muted">{s.scopes.filter((x) => x !== 'audit_events').map((x) => x === 'meter_readings' ? 'Meter readings' : x === 'purchases' ? 'Purchase lines' : x).join(' · ')} · key {s.prefix}…</div>
      <div className="brnums"><span><b>{s.runs}</b> transfers</span><span><b style={{ color: s.failed ? 'var(--bad)' : undefined }}>{s.failed}</b> failed</span><span><b>{f0(s.accepted)}</b> of {f0(s.received)} records accepted</span></div>
      <div className="small">Last success <b>{ago(s.last_ok)}</b>{s.last_fail && <span className="muted"> · last failure {ago(s.last_fail)}</span>}</div>
      {s.health === 'quiet' && <div className="small" style={{ color: 'var(--warn)' }}>Nothing received for {s.quietHours} h (expected every {s.expect_hours} h).</div>}
      {s.health === 'failing' && s.last_error && <div className="small clamp2" style={{ color: 'var(--bad)' }}>{s.last_error}</div>}
      <label className="row small" style={{ gap: 6 }}><span className="muted">Expected</span>
        {can && !s.revoked_at ? <select className="input sm" value={s.expect_hours ?? ''} onChange={(e) => save(e.target.value)} aria-label={`How often ${s.name} sends`}>
          {EXPECT.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}</select> : <b>{EXPECT.find(([v]) => v === s.expect_hours)?.[1] ?? `every ${s.expect_hours} h`}</b>}</label>
    </div>);
}

function BatchLine({ b, onRecon, onRetry }: { b: BatchRow; onRecon: () => void; onRetry: () => void }) {
  const [sc, st] = BSTATUS(b.status), [rc, rt] = RECON[b.recon];
  const w = (n: number) => `${b.lines ? (n / b.lines) * 100 : 0}%`;
  return (
    <tr>
      <td className="small nowrap">{dt(b.created_at)}</td>
      <td style={{ minWidth: 220 }}><b>{b.name}</b>{b.external_ref && <div className="muted small mono">{b.external_ref}</div>}<div className="muted small">{b.created_by_name ?? ""}</div></td>
      <td className="small">{SRC[b.source] ?? b.source}</td>
      <td><span className={`chip ${sc}`}>{st}</span>{b.status === 'failed' && (b.error || b.job_error) && <div className="small clamp2" style={{ color: 'var(--bad)', maxWidth: 240 }}>{b.error ?? b.job_error}</div>}</td>
      <td className="num small">{f0(b.lines)}</td>
      <td className="small" style={{ minWidth: 170 }}>
        <div className="brbar"><i style={{ width: w(b.published), background: 'var(--primary)' }} /><i style={{ width: w(b.excluded), background: '#C9D3CF' }} /><i style={{ width: w(b.problem), background: 'var(--bad)' }} /><i style={{ width: w(b.pending), background: '#F2C46D' }} /></div>
        <span className="muted">{f0(b.published)} published · {f0(b.excluded)} excluded{b.problem ? ` · ${f0(b.problem)} problems` : ''}{b.pending ? ` · ${f0(b.pending)} in review` : ''}</span></td>
      <td className="num small">{b.published ? t1(b.pub_kg) : '—'}</td>
      <td><span className={`chip ${rc}`}>{rt}</span>{b.failedChecks.length > 0 && <div className="small muted clamp2" style={{ maxWidth: 220 }}>{b.failedChecks.join('; ')}</div>}</td>
      <td className="nowrap"><button className="btn sm" onClick={onRecon}>Reconcile</button>{' '}
        {b.retry ? <button className="btn sm p" onClick={onRetry}>Retry</button> : <Link className="btn sm ghost" to={`/purchases/${b.id}`}>Open</Link>}</td>
    </tr>);
}

const OUT: Record<string, [string, string]> = {
  published: ['Published', 'In entries'], excluded: ['Excluded in review', 'Not emissions (e.g. capital, taxes, intercompany) or out of scope'], duplicate: ['Duplicates', 'Same line already received in an earlier batch'],
  problem: ['Problems', 'Cannot be used as sent (missing date, amount or facility)'], pending: ['Still in review', 'Not yet published or excluded'],
};

function ReconDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [r, setR] = useState<BatchRecon | null>(null);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<{ lines: string; amounts: [string, string][] } | null>(null);
  useEffect(() => { api.batchRecon(id).then(setR).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const curs = r ? [...new Set([...Object.keys(r.received.amounts), ...Object.keys(r.batch.control?.amounts ?? {})])] : [];
  const startEdit = () => r && setEdit({ lines: r.batch.control?.lines != null ? String(r.batch.control.lines) : '', amounts: (curs.length ? curs : ['AED']).map((cu) => [cu, r.batch.control?.amounts?.[cu] != null ? String(r.batch.control.amounts[cu]) : '']) });
  const saveCtl = async () => {
    if (!edit) return;
    const amounts = Object.fromEntries(edit.amounts.filter(([cu, v]) => /^[A-Z]{3}$/.test(cu) && v.trim() !== '').map(([cu, v]) => [cu, Number(v.replace(/,/g, ''))]));
    const ctl = { ...(edit.lines.trim() ? { lines: Number(edit.lines.replace(/,/g, '')) } : {}), ...(Object.keys(amounts).length ? { amounts } : {}) };
    try { await api.batchControl(id, Object.keys(ctl).length ? ctl : null); toast('Source totals saved'); setEdit(null); setTick((t) => t + 1); onChanged(); } catch (e) { toast((e as Error).message); }
  };
  const retry = async () => { try { await api.batchRetry(id); toast('Queued to run again'); setTick((t) => t + 1); onChanged(); } catch (e) { toast((e as Error).message); } };
  const ctl = r?.batch.control;
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Reconciliation · {r ? SRC[r.batch.source] ?? r.batch.source : ''}</div><h2>{r?.batch.name ?? 'Batch'}</h2>
          {r && <div className="small muted">{r.batch.reference && <span className="mono">{r.batch.reference} · </span>}started {dt(r.batch.created_at)} by {r.batch.created_by ?? '—'}{r.batch.published_at && ` · published ${dt(r.batch.published_at)}`}</div>}</div>
          <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {!r ? <div className="muted">Loading…</div> : <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><span className={`chip ${RECON[r.state][0]}`}>{RECON[r.state][1]}</span><span className={`chip ${BSTATUS(r.batch.status)[0]}`}>{BSTATUS(r.batch.status)[1]}</span>
            {r.batch.error && <span className="small" style={{ color: 'var(--bad)' }}>{r.batch.error}</span>}<span className="grow" />
            {r.canRetry && <button className="btn sm p" onClick={retry}>Retry processing</button>}<Link className="btn sm ghost" to={`/purchases/${r.batch.id}`}>Open the batch →</Link></div>

          <div className="card brsub">
            <div className="row"><b className="grow">Source system totals</b>{r.canControl && !edit && <button className="btn sm" onClick={startEdit}>{ctl ? 'Change' : 'Enter totals'}</button>}</div>
            {!edit ? (ctl ? <div className="small">{ctl.lines != null && <span><b>{f0(ctl.lines)}</b> lines · </span>}{Object.entries(ctl.amounts ?? {}).map(([cu, v]) => <span key={cu}><b>{cu} {f2(v)}</b> · </span>)}<span className="muted">from {ctl.by ?? '—'}{ctl.at ? `, ${dt(ctl.at)}` : ''}</span></div>
              : <div className="small muted">The line count and total the source report shows (e.g. the SAP extract's footer). Systems can send them with the batch (<span className="mono">control</span>); for a file, enter them here. Without them, only the platform's own checks run.</div>)
              : <div className="vform">
                <label className="field"><span>Line count in the source</span><input className="input num" inputMode="numeric" value={edit.lines} onChange={(e) => setEdit({ ...edit, lines: e.target.value })} /></label><div className="field" />
                {edit.amounts.map(([cu, v], i) => <div key={i} className="field span2"><span>Total amount</span><div className="row" style={{ gap: 6 }}>
                  <input className="input" style={{ width: 80 }} value={cu} maxLength={3} aria-label="Currency" onChange={(e) => setEdit({ ...edit, amounts: edit.amounts.map((x, j) => j === i ? [e.target.value.toUpperCase(), x[1]] : x) })} />
                  <input className="input num grow" inputMode="decimal" value={v} aria-label={`Total in ${cu}`} onChange={(e) => setEdit({ ...edit, amounts: edit.amounts.map((x, j) => j === i ? [x[0], e.target.value] : x) })} /></div></div>)}
                <div className="span2 row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => setEdit({ ...edit, amounts: [...edit.amounts, ['', '']] })}>+ Currency</button><span className="grow" />
                  <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button><button className="btn sm p" onClick={saveCtl}>Save totals</button></div>
              </div>}
          </div>

          <table className="t brflow">
            <thead><tr><th>Step</th><th className="num">Lines</th>{curs.map((cu) => <th key={cu} className="num">{cu}</th>)}<th className="num">tCO₂e</th></tr></thead>
            <tbody>
              <tr className="muted"><td>Sent by the source</td><td className="num">{ctl?.lines != null ? f0(ctl.lines) : '—'}</td>{curs.map((cu) => <td key={cu} className="num">{ctl?.amounts?.[cu] != null ? f2(ctl.amounts[cu]!) : '—'}</td>)}<td /></tr>
              <tr><td><b>Received</b></td><td className="num"><b>{f0(r.received.lines)}</b></td>{curs.map((cu) => <td key={cu} className="num"><b>{f2(r.received.amounts[cu] ?? 0)}</b></td>)}<td /></tr>
              {r.outcomes.filter((o) => o.lines).map((o) => (
                <tr key={o.outcome}><td style={{ paddingLeft: 22 }}>{OUT[o.outcome]![0]}<div className="small muted">{OUT[o.outcome]![1]}</div></td><td className="num">{f0(o.lines)}</td>
                  {curs.map((cu) => <td key={cu} className="num">{o.amounts[cu] != null ? f2(o.amounts[cu]!) : '—'}</td>)}<td className="num">{o.kg ? t1(o.kg) : '—'}</td></tr>))}
              {r.entries.map((e) => <tr key={e.status}><td>Entries · {e.status}</td><td className="num">{f0(e.n)} entr{e.n === 1 ? 'y' : 'ies'}</td>{curs.map((cu) => <td key={cu} />)}<td className="num">{t1(e.kg)}</td></tr>)}
            </tbody>
          </table>

          <div className="brchecks">{r.checks.map((c) => (
            <div key={c.id} className={c.ok === false ? 'bad' : c.ok ? 'ok' : 'na'}><span className="ic">{c.ok === false ? '✕' : c.ok ? '✓' : '–'}</span><div><b>{c.name}</b><div className="small muted">{c.detail}</div></div></div>))}</div>

          {r.problems.length > 0 && <details className="small" open={r.state === 'differences'}><summary><b>Lines with problems ({r.problems.length}{r.problems.length === 100 ? '+' : ''})</b></summary>
            <table className="t"><tbody>{r.problems.map((p) => <tr key={p.row_no}><td className="num">Row {p.row_no}</td><td>{p.description ?? '—'}</td><td style={{ color: 'var(--bad)' }}>{[...p.problems, p.calc_error].filter(Boolean).join('; ')}</td></tr>)}</tbody></table></details>}
          {r.missing.length > 0 && <details className="small" open><summary><b>Published lines not in any entry ({r.missing.length})</b></summary>
            <div className="muted">Their entry was deleted after publishing. Reopen the batch and publish again, or record why.</div>
            <table className="t"><tbody>{r.missing.map((p) => <tr key={p.row_no}><td className="num">Row {p.row_no}</td><td>{p.description ?? '—'}</td><td className="num">{t1(p.kg)} t</td></tr>)}</tbody></table></details>}
          {(r.runs.length > 0 || r.jobs.length > 0) && <details className="small"><summary><b>History: transfers and processing</b></summary>
            <table className="t"><tbody>
              {r.runs.map((x) => <tr key={x.id}><td className="nowrap">{dt(x.at)}</td><td>{x.client} · {x.source === 'purchases_complete' ? 'completed the batch' : `sent ${f0(x.received)} lines`}</td><td>{x.status === 'failed' ? <span className="chip bad">Failed</span> : x.status === 'partial' ? <span className="chip warn">{x.rejected} with problems</span> : <span className="chip">OK</span>}{x.error && <div className="muted">{x.error}</div>}</td></tr>)}
              {r.jobs.map((j) => <tr key={j.id}><td className="nowrap">{dt(j.created_at)}</td><td>{JOB[j.kind] ?? j.kind}{j.attempts > 1 ? ` · ${j.attempts} attempts` : ''}</td><td>{j.status === 'failed' ? <span className="chip bad">Failed</span> : j.status === 'done' ? <span className="chip">Done</span> : <span className="chip info">{j.status}</span>}{j.error && <div className="muted">{j.error}</div>}</td></tr>)}
            </tbody></table></details>}
        </>}
      </div>
    </dialog>);
}
const JOB: Record<string, string> = { purchase_ingest: 'Read the file', purchase_map: 'Map and calculate', purchase_calc: 'Recalculate', purchase_publish: 'Publish' };

function TransferDrawer({ id, text, onClose }: { id: string; text: Record<string, string>; onClose: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [t, setT] = useState<Transfer | null>(null);
  useEffect(() => { api.transfer(id).then(setT).catch((e) => toast((e as Error).message)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Transfer</div><h2>{t ? `${t.client ?? '—'} · ${text[t.source] ?? t.source}` : 'Transfer'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {!t ? <div className="muted">Loading…</div> : <>
          <table className="kv t"><tbody>
            <tr><td>When</td><td>{new Date(t.at).toLocaleString('en-GB')}</td></tr>
            <tr><td>Call</td><td className="mono small">{t.endpoint} → HTTP {t.http_status}{t.duration_ms != null ? ` · ${t.duration_ms} ms` : ''}</td></tr>
            <tr><td>Records</td><td>{f0(t.received)} received · {f0(t.accepted)} accepted · {f0(t.rejected)} {t.status === 'failed' ? 'not stored' : 'refused or flagged'}</td></tr>
            {t.reference && <tr><td>Batch reference</td><td className="mono">{t.reference}</td></tr>}
            {t.ref_kind === 'purchase_batch' && t.ref_id && <tr><td>Batch</td><td><Link to={`/batches?batch=${t.ref_id}`} onClick={() => dlg.current?.close()}>Reconciliation →</Link></td></tr>}
          </tbody></table>
          {t.error && <div className="note bad small"><b>Why it failed:</b> {t.error}<div className="muted" style={{ marginTop: 4 }}>Nothing from this call was stored. Fix the cause in the sending system and send it again.</div></div>}
          {!!t.problems?.length && <><b className="small">Records refused or flagged ({t.problems.length}{t.problems.length === 200 ? '+' : ''})</b>
            <div className="scroll" style={{ maxHeight: 360 }}><table className="t small"><thead><tr><th className="num">Record</th><th>Reason</th></tr></thead>
              <tbody>{t.problems.map((p, i) => <tr key={i}><td className="num">#{p.index + 1}</td><td>{p.reason}</td></tr>)}</tbody></table></div></>}
        </>}
      </div>
    </dialog>);
}
