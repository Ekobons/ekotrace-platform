/**
 * Bills: drop the PDFs in one place. Each is read (supplier, account, period,
 * consumption, amount), matched to its meter by account number, and waits for a person
 * to check it against the PDF shown beside the fields. Confirming books it as the
 * meter's reading for the billing period; the monthly entries follow.
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, blobUrl, num, tco2e, unitLabel, type Bill, type Facility, type Meter } from '../lib/api';
import { MeterForm, type MeterDraft } from '../components/MeterForm';
import { Icon } from '../components/Icon';

const STATUS: Record<string, string> = { to_check: 'To check', checked: 'Ready to publish', confirmed: 'Published', rejected: 'Rejected' };
const UNITS: [string, string][] = [['kWh_e', 'kWh (electricity)'], ['MWh_e', 'MWh (electricity)'], ['TRh', 'TRh (cooling)'], ['kWh_c', 'kWh (cooling)'], ['kWh_th', 'kWh (heat)'], ['m3', 'm³'], ['kWh', 'kWh (gas, net CV)'], ['kg', 'kg'], ['L', 'litres']];
const ITEM_FOR: Record<string, string> = { electricity: 'grid:electricity', cooling: 'cooling:district', heat: 'heat:district', gas: 'desnz:natural-gas' };

export function Bills() {
  const { toast } = useApp();
  const [status, setStatus] = useState<string>('to_check');
  const [bills, setBills] = useState<Bill[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [queue, setQueue] = useState<{ name: string; state: 'waiting' | 'reading' | 'done' | 'duplicate' | 'error'; msg?: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = () => api.bills(status).then((r) => { setBills(r.bills); setCounts(r.counts); });
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length < files.length) toast(`${files.length - pdfs.length} file(s) skipped: only PDF bills`);
    const q = pdfs.map((f) => ({ name: f.name, state: 'waiting' as const }));
    setQueue(q);
    for (const [i, f] of pdfs.entries()) {
      setQueue((x) => x.map((y, k) => (k === i ? { ...y, state: 'reading' } : y)));
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error('larger than 15 MB');
        const b = await api.uploadBill(f);
        setQueue((x) => x.map((y, k) => (k === i ? { ...y, state: b.duplicate ? 'duplicate' : 'done', msg: b.duplicate ? `already uploaded (${STATUS[b.status]})` : b.scanned ? 'scan: enter the figures' : b.found.missing?.length ? `to complete: ${b.found.missing.join(', ')}` : 'read' } : y)));
      } catch (e) { setQueue((x) => x.map((y, k) => (k === i ? { ...y, state: 'error', msg: (e as Error).message } : y))); }
    }
    setStatus('to_check'); load();
  };

  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Capture</div><h1>Bills</h1>
        <p className="sub">Electricity, cooling, heat and gas bills as PDF. Each bill is read, matched to its meter by the account number, checked by a person and then booked for its billing period — split over the calendar months it covers.</p></div></div>

      <div className={`card drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]); }} onClick={() => input.current?.click()}>
        <Icon name="upload" />
        <div><b>Drop PDF bills here</b>, or click to choose — as many as you like.<div className="sub">Each file up to 15 MB. The same file twice is recognised. Scanned bills (images) are kept for the figures to be typed in.</div></div>
        <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      {queue.length > 0 && (
        <div className="card" style={{ display: 'grid', gap: 4 }}>
          {queue.map((q, i) => <div key={i} className="row" style={{ gap: 8, fontSize: 13 }}>
            <span className={`chip ${q.state === 'error' ? 'bad' : q.state === 'duplicate' ? 'grey' : q.state === 'done' ? '' : 'info'}`}>{q.state === 'waiting' ? 'waiting' : q.state === 'reading' ? 'reading…' : q.state === 'done' ? 'read' : q.state}</span>
            <span className="grow">{q.name}</span><span className="muted small">{q.msg}</span></div>)}
        </div>
      )}

      <div className="tabs">{Object.entries(STATUS).map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => { setStatus(k); setOpen(null); }}>{l} ({counts[k] ?? 0})</button>)}</div>
      <div className="card flush">
        {bills.length ? (
          <table className="t">
            <thead><tr><th>Bill</th><th>Supplier · account</th><th>Period</th><th className="num">Consumption</th><th className="num">Amount</th><th>Meter</th><th /></tr></thead>
            <tbody>{bills.map((b) => (
              <tr key={b.id} className={`click ${open === b.id ? 'sel' : ''}`} onClick={() => setOpen(open === b.id ? null : b.id)}>
                <td>{b.filename}<div className="muted small">uploaded {b.created_at.slice(0, 10)}{b.bill_no ? ` · no. ${b.bill_no}` : ''}</div></td>
                <td>{b.supplier ?? <span className="chip warn">?</span>}<div className="muted small mono">{b.account_no ?? '—'}</div></td>
                <td className="mono small">{b.period_from && b.period_to ? `${b.period_from} – ${b.period_to}` : <span className="chip warn">?</span>}</td>
                <td className="num">{b.quantity != null ? <>{num(Number(b.quantity))} <span className="muted small">{unitLabel(b.unit ?? '')}</span></> : b.scanned ? <span className="chip warn">scan</span> : <span className="chip warn">?</span>}</td>
                <td className="num">{b.amount != null ? `${b.currency ?? ''} ${Number(b.amount).toLocaleString('en', { minimumFractionDigits: 2 })}` : '—'}</td>
                <td>{b.meter ? <>{b.meter}<div className="muted small">{b.facility}</div></> : <span className="chip warn">no meter</span>}</td>
                <td>{b.status === 'confirmed' ? <span className="chip">booked</span> : b.status === 'rejected' ? <span className="chip grey">rejected</span> : b.found.missing?.length || !b.meter_id ? <span className="chip warn">to complete</span> : <span className="chip info">ready to check</span>}</td>
              </tr>))}</tbody>
          </table>
        ) : <div className="empty">No bills {STATUS[status]!.toLowerCase()}.</div>}
      </div>
      {open && <BillReview key={open} id={open} onChanged={load} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function BillReview({ id, onChanged, onClose, category }: { id: string; onChanged: () => void; onClose: () => void; category?: string }) {
  const { toast, role } = useApp();
  const [b, setB] = useState<Awaited<ReturnType<typeof api.bill>> | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [f, setF] = useState<Record<string, string>>({});
  const [newMeter, setNewMeter] = useState<MeterDraft | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showText, setShowText] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const load = async () => {
    const x = await api.bill(id);
    setB(x);
    setF({ meterId: x.meter_id ?? '', supplier: x.supplier ?? '', accountNo: x.account_no ?? '', billNo: x.bill_no ?? '', periodFrom: x.period_from ?? '', periodTo: x.period_to ?? '',
      issueDate: x.issue_date ?? '', quantity: x.quantity != null ? String(Number(x.quantity)) : '', unit: x.unit ?? 'kWh_e', amount: x.amount != null ? String(Number(x.amount)) : '', currency: x.currency ?? 'AED', note: x.note ?? '' });
  };
  useEffect(() => {
    load().catch((e) => setErr(e.message));
    api.meters().then((r) => setMeters(r.meters.filter((m) => m.reading_type === 'interval' && m.active && (!category || m.category === category || (category === 'waste' && m.category.startsWith('waste_'))))));
    api.facilities().then((r) => setFacilities(r.facilities.filter((x) => x.canEnter)));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let url: string | null = null; if (b?.document_id) blobUrl(`/api/documents/${b.document_id}`).then((u) => { url = u; setPdf(u); }).catch(() => setPdf(null)); return () => { if (url) URL.revokeObjectURL(url); }; }, [b?.document_id]);

  if (!b) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const locked = b.status === 'confirmed' || b.status === 'rejected';
  const body = () => ({ meterId: f.meterId || null, supplier: f.supplier || null, accountNo: f.accountNo || null, billNo: f.billNo || null, periodFrom: f.periodFrom || null, periodTo: f.periodTo || null,
    issueDate: f.issueDate || null, quantity: f.quantity === '' ? null : Number(f.quantity), unit: f.unit || null, amount: f.amount === '' ? null : Number(f.amount), currency: f.currency || null, note: f.note || null });
  const act = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); try { await fn(); toast(ok); await load(); onChanged(); } catch (e) { setErr((e as Error).message); } };
  const hint = (k: string) => { const x = (b.found as Record<string, { line?: string } | undefined>)[k]; return x?.line ? <small className="muted" title={x.line}>read from: “{x.line.slice(0, 70)}”</small> : null; };
  const field = (k: string, label: string, w: number, type = 'text', h?: string) => (
    <label className="field" style={{ width: w }}><span>{label}</span>
      <input className={`input ${type === 'num' ? 'num' : ''}`} type={type === 'date' ? 'date' : 'text'} disabled={locked} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: type === 'num' ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value })} />
      {h && hint(h)}</label>);
  const energy = b.energy ?? (f.unit === 'TRh' || f.unit === 'kWh_c' ? 'cooling' : f.unit === 'm3' ? 'gas' : 'electricity');
  const days = f.periodFrom && f.periodTo ? Math.round((Date.parse(f.periodTo) - Date.parse(f.periodFrom)) / 86400000) + 1 : null;

  return (
    <div className="billreview">
      <div className="card pdfpane">{pdf ? <iframe title="Bill" src={pdf} /> : <div className="empty">Preview not available.</div>}</div>
      <div className="card" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <div className="row"><div className="grow"><div className="eyebrow">{STATUS[b.status]}</div><h2>{b.filename}</h2></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {b.found.problem && <div className="note bad">{b.found.problem}</div>}
        {b.scanned && <div className="note warn">This PDF is a scan (an image, no text): type the figures from the preview.</div>}
        {!b.scanned && (b.found.missing?.length ?? 0) > 0 && !locked && <div className="note warn">Not found on the bill: {b.found.missing!.join(', ')}. Please fill in from the preview.</div>}
        {b.status === 'checked' && <div className="note info">Checked by {b.checked_by_name ?? 'a user'}: waiting in “Ready to publish”. A change sends it back to check.</div>}
        {b.status === 'confirmed' && <div className="note ok">Published by {b.checked_by_name ?? 'a user'} on {b.checked_at?.slice(0, 10)}.</div>}
        {b.status === 'rejected' && <div className="note info">Rejected: {b.note}</div>}

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {field('supplier', 'Supplier', 170, 'text', 'supplier')}{field('accountNo', 'Account no.', 170, 'text', 'account')}{field('billNo', 'Bill no.', 150)}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {field('periodFrom', 'Period from', 160, 'date', 'periodFrom')}{field('periodTo', 'Period to', 160, 'date')}{field('issueDate', 'Bill date', 160, 'date')}
          {days && <span className="sub" style={{ paddingTop: 26 }}>{days} days</span>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {field('quantity', 'Consumption', 160, 'num', 'quantity')}
          <label className="field" style={{ width: 180 }}><span>Unit</span><select className="input" disabled={locked} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          {field('amount', 'Amount', 130, 'num', 'amount')}{field('currency', 'Currency', 90)}
        </div>
        {!locked && (b.found.candidates?.length ?? 0) > 1 && (
          <div className="sub">Other figures on the bill: {b.found.candidates!.slice(0, 6).map((c, i) => (
            <button key={i} className="btn ghost sm" title={c.line} onClick={() => setF({ ...f, quantity: String(c.value), unit: c.unit })}>{num(c.value)} {unitLabel(c.unit)}</button>))}</div>
        )}

        <fieldset className="box"><legend>Meter (utility account)</legend>
          <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <select className="input grow" disabled={locked} value={f.meterId} onChange={(e) => setF({ ...f, meterId: e.target.value })}>
              <option value="">Choose the meter…</option>
              {meters.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.facility}{m.account_no ? ` · account ${m.account_no}` : ''} · {unitLabel(m.unit)}</option>)}
            </select>
            {!locked && ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role) && ITEM_FOR[energy] && (
              <button className="btn sm" onClick={async () => {
                const cat = await api.catalogue();
                const item = cat.categories.flatMap((c) => c.subcategories.flatMap((s) => s.items)).find((i) => i.code === ITEM_FOR[energy]);
                if (item) setNewMeter({ itemId: item.id, unit: f.unit, template: {}, name: `${f.supplier || 'Utility'} ${f.accountNo}`.trim(), accountNo: f.accountNo, readingType: 'interval', frequency: 'month' });
              }}><Icon name="plus" />New meter for this account</button>)}
          </div>
          {b.found.matchedBy && f.meterId === b.meter_id && <div className="sub">Matched by {b.found.matchedBy}.</div>}
        </fieldset>
        {newMeter && <MeterForm draft={newMeter} facilities={facilities} onDone={async (m) => { setNewMeter(null); if (m) { setMeters((x) => [...x, m]); setF((x) => ({ ...x, meterId: m.id })); } }} />}

        {err && <div className="note bad">{err}</div>}
        {b.entries.length > 0 && (
          <table className="t"><thead><tr><th>Entries from this meter in the period</th><th className="num">Quantity</th><th className="num">tCO₂e</th><th>Status</th></tr></thead>
            <tbody>{b.entries.map((e) => <tr key={e.id}><td className="mono">{e.period_start.slice(0, 7)}</td><td className="num">{num(Number(e.quantity))} {unitLabel(e.unit)}</td>
              <td className="num">{tco2e(Number(e.co2e_scope2) || Number(e.co2e_direct))}</td><td><span className="chip grey">{e.status}</span></td></tr>)}</tbody></table>
        )}
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn ghost sm" onClick={() => setShowText(!showText)}>{showText ? 'Hide' : 'Show'} text read</button>
          <div className="grow" />
          {(b.status === 'to_check' || b.status === 'checked') && <>
            {rejecting === null ? <button className="btn ghost danger" onClick={() => setRejecting('')}>Reject</button> : <>
              <input className="input" style={{ width: 240 }} autoFocus value={rejecting} placeholder="Why? e.g. duplicate, not ours, water only" onChange={(e) => setRejecting(e.target.value)} />
              <button className="btn danger" disabled={rejecting.trim().length < 2} onClick={() => act(() => api.rejectBill(id, rejecting.trim()), 'Bill rejected')}>Reject</button>
              <button className="btn ghost" onClick={() => setRejecting(null)}>Cancel</button></>}
            <button className="btn" onClick={() => act(() => api.patchBill(id, body()), 'Saved')}>Save</button>
            <button className="btn p" disabled={!f.meterId || !f.periodFrom || !f.periodTo || f.quantity === ''} onClick={() => act(() => api.checkBill(id, body()), 'Checked: the bill is in the preview, ready to publish')}><Icon name="check" />Checked — add to preview</button>
          </>}
          {(b.status === 'confirmed' || b.status === 'rejected') && ['platform_admin', 'super_admin', 'admin', 'manager'].includes(role) && <button className="btn" onClick={() => act(() => api.reopenBill(id), 'Bill reopened')}>Reopen</button>}
        </div>
        {showText && <pre className="code" style={{ maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{b.text || '(no text)'}</pre>}
      </div>
    </div>
  );
}
