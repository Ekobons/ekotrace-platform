/**
 * Bills and meter readings inside each Add data tab (electricity & cooling, fuels, waste).
 *
 *   Bills       PDFs dropped here belong to this category. Each is read and matched to its
 *               account (meter) by the account number, then checked by a person against the
 *               PDF. Checked bills wait in "Ready to publish": a preview of what each becomes
 *               (months, quantity, estimated emissions) with what blocks it — the same file,
 *               the same bill number, a period another bill or meter readings already cover.
 *               Publishing books the clean ones.
 *   Readings    readings sent through the API wait in batches with the same preview: new,
 *               corrections, duplicates (skipped), conflicts with booked bills (skipped).
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, num, unitLabel, type Bill, type BillPreview, type ReadingBatch, type ReadingBatchMeter } from '../lib/api';
import { Icon } from '../components/Icon';
import { BillReview } from './Bills';

const when = (s: string) => new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const KIND: Record<string, string> = { purchased_electricity: 'electricity, cooling and heat bills', stationary_combustion: 'fuel and gas invoices', waste: 'waste collection invoices and hauler tickets' };
type Tab = 'to_check' | 'checked' | 'confirmed' | 'rejected';
const TABS: [Tab, string][] = [['to_check', 'To check'], ['checked', 'Ready to publish'], ['confirmed', 'Published'], ['rejected', 'Rejected']];

export function CategoryBills({ category }: { category: string }) {
  const { toast } = useApp();
  const [tab, setTab] = useState<Tab>('to_check');
  const [bills, setBills] = useState<Bill[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [queue, setQueue] = useState<{ name: string; state: string; msg?: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = () => api.bills(tab === 'checked' ? 'checked' : tab, category).then((r) => { setBills(r.bills); setCounts(r.counts); });
  useEffect(() => { setOpen(null); load(); }, [tab, category]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length < files.length) toast(`${files.length - pdfs.length} file(s) skipped: only PDF bills`);
    setQueue(pdfs.map((f) => ({ name: f.name, state: 'waiting' })));
    for (const [i, f] of pdfs.entries()) {
      setQueue((x) => x.map((y, k) => (k === i ? { ...y, state: 'reading' } : y)));
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error('larger than 15 MB');
        const b = await api.uploadBill(f, category);
        setQueue((x) => x.map((y, k) => (k === i ? { ...y, state: b.duplicate ? 'duplicate' : 'read', msg: b.duplicate ? `the same file was uploaded before (${TABS.find((t) => t[0] === b.status)?.[1].toLowerCase()}): not added again` : b.scanned ? 'scan: type the figures' : b.found.missing?.length ? `to complete: ${b.found.missing.join(', ')}` : b.meter_id ? `account ${b.account_no} → ${b.meter}` : 'no account matched yet' } : y)));
      } catch (e) { setQueue((x) => x.map((y, k) => (k === i ? { ...y, state: 'error', msg: (e as Error).message } : y))); }
    }
    setTab('to_check'); load();
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className={`card drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]); }} onClick={() => input.current?.click()}>
        <Icon name="upload" />
        <div><b>Drop PDF {KIND[category] ?? 'bills'} here</b>, or click to choose — as many as you like.
          <div className="sub">Each is read and matched to its account by the account number. Nothing counts until a person has checked it and it is published. The same file twice is not added again; the same bill number or an overlapping period is stopped in the preview.</div></div>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      {queue.length > 0 && (
        <div className="card" style={{ display: 'grid', gap: 4 }}>
          {queue.map((q, i) => <div key={i} className="row" style={{ gap: 8, fontSize: 13 }}>
            <span className={`chip ${q.state === 'error' ? 'bad' : q.state === 'duplicate' ? 'warn' : q.state === 'read' ? '' : 'info'}`}>{q.state === 'reading' ? 'reading…' : q.state}</span>
            <span className="grow">{q.name}</span><span className="muted small">{q.msg}</span></div>)}
          <div className="row"><span className="grow" /><button className="btn ghost sm" onClick={() => setQueue([])}>Clear</button></div>
        </div>
      )}
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({counts[k] ?? 0})</button>)}</div>
      {tab === 'checked' ? <PublishPreview category={category} onDone={() => { load(); }} onOpen={setOpen} /> : (
        <div className="card flush">
          {bills.length ? (
            <table className="t">
              <thead><tr><th>Bill</th><th>Supplier · account</th><th>Period</th><th className="num">Quantity</th><th className="num">Amount</th><th>Account (meter)</th><th /></tr></thead>
              <tbody>{bills.map((b) => (
                <tr key={b.id} className={`click ${open === b.id ? 'sel' : ''}`} onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <td>{b.filename}<div className="muted small">uploaded {b.created_at.slice(0, 10)}{b.bill_no ? ` · no. ${b.bill_no}` : ''}</div></td>
                  <td>{b.supplier ?? <span className="chip warn">?</span>}<div className="muted small mono">{b.account_no ?? '—'}</div></td>
                  <td className="mono small">{b.period_from && b.period_to ? `${b.period_from} – ${b.period_to}` : <span className="chip warn">?</span>}</td>
                  <td className="num">{b.quantity != null ? <>{num(Number(b.quantity))} <span className="muted small">{unitLabel(b.unit ?? '')}</span></> : b.scanned ? <span className="chip warn">scan</span> : <span className="chip warn">?</span>}</td>
                  <td className="num">{b.amount != null ? `${b.currency ?? ''} ${Number(b.amount).toLocaleString('en', { minimumFractionDigits: 2 })}` : '—'}</td>
                  <td>{b.meter ? <>{b.meter}<div className="muted small">{b.facility}</div></> : <span className="chip warn">no account</span>}</td>
                  <td>{b.status === 'confirmed' ? <span className="chip">published</span> : b.status === 'rejected' ? <span className="chip grey">rejected</span> : b.found.missing?.length || !b.meter_id ? <span className="chip warn">to complete</span> : <span className="chip info">to check</span>}</td>
                </tr>))}</tbody>
            </table>
          ) : <div className="empty">{tab === 'to_check' ? 'No bills waiting to be checked. Drop PDFs above.' : `No bills ${TABS.find((t) => t[0] === tab)![1].toLowerCase()}.`}</div>}
        </div>)}
      {open && <BillReview key={open} id={open} category={category} onChanged={load} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PublishPreview({ category, onDone, onOpen }: { category: string; onDone: () => void; onOpen: (id: string) => void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<BillPreview[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = () => api.billPreview(category).then((r) => { setRows(r.bills); setSel(new Set(r.bills.filter((b) => b.ok).map((b) => b.id))); });
  useEffect(() => { load(); }, [category]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="card empty">Loading…</div>;
  if (!rows.length) return <div className="card empty">No checked bills. Open a bill under “To check”, compare it with the PDF and press “Checked — add to preview”.</div>;
  const chosen = rows.filter((r) => sel.has(r.id));
  const publish = async () => {
    setBusy(true);
    try {
      const r = await api.publishBills(chosen.map((b) => b.id));
      toast(`Published ${r.booked} bill${r.booked === 1 ? '' : 's'} · entries ${r.entries.created} created, ${r.entries.updated} updated${r.failed.length ? ` · ${r.failed.length} not published` : ''}`);
      await load(); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const blocked = rows.filter((r) => !r.ok).length;
  return (
    <div className="card flush">
      <div className="row" style={{ padding: '12px 16px', gap: 10, flexWrap: 'wrap' }}>
        <div className="grow"><b>Preview before publishing</b>
          <div className="sub">What each checked bill becomes: its quantity split over the calendar months by days, and the estimated emissions. {blocked ? `${blocked} bill${blocked === 1 ? ' is' : 's are'} stopped (red): fix or reject ${blocked === 1 ? 'it' : 'them'}.` : 'Nothing is stopped.'}</div></div>
        <span className="muted small">{chosen.length} selected · {(chosen.reduce((a, b) => a + (b.co2e ?? 0), 0)).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tCO₂e</span>
        <button className="btn p" disabled={!chosen.length || busy} onClick={publish}><Icon name="check" />{busy ? 'Publishing…' : `Publish ${chosen.length} bill${chosen.length === 1 ? '' : 's'}`}</button>
      </div>
      <div className="scrollx"><table className="t">
        <thead><tr><th /><th>Account (meter)</th><th>Bill</th><th>Period</th><th className="num">Quantity</th><th>Months</th><th className="num">tCO₂e (est.)</th><th>Check</th></tr></thead>
        <tbody>{rows.map((b) => (
          <tr key={b.id} style={b.ok ? undefined : { background: 'var(--bad-bg)' }}>
            <td><input type="checkbox" disabled={!b.ok} checked={sel.has(b.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(b.id); else n.delete(b.id); setSel(n); }} aria-label="Publish this bill" /></td>
            <td>{b.meter}<div className="muted small">{b.facility}{b.account_no ? ` · ${b.account_no}` : ''}</div></td>
            <td><button className="link" onClick={() => onOpen(b.id)}>{b.filename}</button><div className="muted small">{b.supplier}{b.bill_no ? ` · no. ${b.bill_no}` : ''}</div></td>
            <td className="mono small">{b.period_from} – {b.period_to}<div className="muted small">{b.days} days</div></td>
            <td className="num">{num(b.qty)} <span className="muted small">{unitLabel(b.meterUnit)}</span></td>
            <td className="small">{b.months.map((m) => <div key={m.month} className="mono">{m.month}: {Math.round(m.qty).toLocaleString('en')} <span className="muted">({m.days} d)</span></div>)}</td>
            <td className="num">{b.co2e == null ? '—' : (b.co2e).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td style={{ maxWidth: 320 }}>{b.issues.length ? b.issues.map((i, k) => <div key={k} className={`small ${i.level === 'block' ? 'bad' : 'warn'}`} style={{ color: i.level === 'block' ? 'var(--bad)' : 'var(--warn)' }}>{i.level === 'block' ? '■ ' : '▲ '}{i.text}</div>) : <span className="chip">ready</span>}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

/** Meter readings received through the API: one card per batch, previewed, then published or discarded. */
export function ReadingBatches({ category }: { category: string }) {
  const { toast, role } = useApp();
  const [status, setStatus] = useState<'review' | 'published' | 'discarded'>('review');
  const [d, setD] = useState<{ review: boolean; batches: ReadingBatch[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api.readingBatches({ status, category }).then(setD).catch(() => setD({ review: true, batches: [] }));
  useEffect(() => { setOpen(null); load(); }, [status, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const canDecide = ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="grow"><b>Readings received through the API</b>
          <div className="sub">Meters connected to a building system, utility portal or logger send readings in batches. {d?.review === false ? 'They are stored at once (review is switched off).' : 'Each batch waits here with a preview — new readings, corrections, duplicates and readings inside a period a booked bill already covers — until it is published.'}</div></div>
        {role === 'super_admin' && d && <label className="row" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={d.review} onChange={async (e) => { try { await api.setReviewReadings(e.target.checked); toast(e.target.checked ? 'API readings now wait for review' : 'API readings are now stored at once'); load(); } catch (er) { toast((er as Error).message); } }} />Review before publishing</label>}
      </div>
      <div className="tabs">{([['review', 'To review'], ['published', 'Published'], ['discarded', 'Discarded']] as const).map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}</div>
      {!d ? <div className="card empty">Loading…</div> : !d.batches.length ? <div className="card empty">No batches {status === 'review' ? 'waiting for review' : status}.</div> : d.batches.map((b) => (
        <div key={b.id} className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div className="grow"><b>{b.client ?? b.source}</b> <span className="muted small">· received {when(b.created_at)} · {b.received.toLocaleString('en')} readings{Number(b.rejected) ? ` · ${b.rejected} refused` : ''}</span>
              {b.result && <div className="sub">Published by {b.decided_by}: {b.result.inserted} new, {b.result.updated} corrected · entries {b.result.entries.created} created, {b.result.entries.updated} updated</div>}</div>
            <button className="btn sm" onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? 'Hide' : 'Preview'}</button>
            {status === 'review' && canDecide && <>
              <button className="btn ghost sm danger" onClick={async () => { try { await api.discardReadings(b.id); toast('Batch discarded'); load(); } catch (e) { toast((e as Error).message); } }}>Discard</button>
              <button className="btn p sm" onClick={async () => { try { const r = await api.publishReadings(b.id); toast(`Published: ${r.inserted} new, ${r.updated} corrected · entries ${r.entries.created} created, ${r.entries.updated} updated${r.entries.locked.length ? ` · ${r.entries.locked.length} approved month(s) not changed` : ''}`); load(); } catch (e) { toast((e as Error).message); } }}><Icon name="check" />Publish</button>
            </>}
          </div>
          {open === b.id && <BatchPreview id={b.id} />}
        </div>))}
    </div>
  );
}

function BatchPreview({ id }: { id: string }) {
  const [m, setM] = useState<ReadingBatchMeter[] | null>(null);
  useEffect(() => { api.readingBatch(id).then((r) => setM(r.meters)).catch(() => setM([])); }, [id]);
  if (!m) return <div className="muted">Loading…</div>;
  return (
    <div className="scrollx"><table className="t compact">
      <thead><tr><th>Meter</th><th className="num">New</th><th className="num">Corrections</th><th className="num">Duplicates (skipped)</th><th className="num">Conflicts (skipped)</th><th>From – to</th><th>By month (new + corrected)</th></tr></thead>
      <tbody>{m.map((x) => (
        <tr key={x.meter_id}>
          <td>{x.meter}<div className="muted small">{x.facility} · {unitLabel(x.unit)} · {x.reading_type === 'interval' ? 'consumption per interval' : 'register'}</div></td>
          <td className="num">{x.new.toLocaleString('en')}</td>
          <td className="num">{x.changed ? <b style={{ color: 'var(--warn)' }}>{x.changed}</b> : 0}</td>
          <td className="num">{x.same.toLocaleString('en')}</td>
          <td className="num">{x.conflict ? <b style={{ color: 'var(--bad)' }}>{x.conflict}</b> : 0}</td>
          <td className="mono small">{when(x.first)}<br />{when(x.last)}</td>
          <td className="small">{(x.months ?? []).map((mo) => <div key={mo.month} className="mono">{mo.month}: {x.reading_type === 'interval' ? `${Math.round(mo.qty).toLocaleString('en')} ${unitLabel(x.unit)}` : `${mo.n} readings`}</div>)}
            {(x.samples ?? []).slice(0, 4).map((s, i) => <div key={i} className="small" style={{ color: s.state === 'conflict' ? 'var(--bad)' : 'var(--warn)' }}>{when(s.ts)}: {s.state === 'changed' ? `${num(Number(s.old))} → ${num(Number(s.value))}` : `${num(Number(s.value))} — ${s.note}`}</div>)}</td>
        </tr>))}</tbody>
    </table></div>
  );
}
