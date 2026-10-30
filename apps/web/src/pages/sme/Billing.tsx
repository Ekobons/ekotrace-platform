/**
 * Plan & billing: the company's plan and end date, the plans with GST, online payment with Razorpay Checkout
 * (only when the platform has switched it on — otherwise bank transfer through the support address), invoice
 * details (GSTIN, address), the payments list and a printable GST tax invoice per payment.
 * Also the platform console's Payments tab (SmeConsolePayments).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { call } from '../../lib/api';
import { dmy } from '../../lib/sme';
import { SME_PAGES } from './nav';
import { Pill, SmeHead } from './ui';
import './billing.css';

interface Price { base: number; cgst: number; sgst: number; igst: number; total: number; intra: boolean; rate: number }
interface PlanRow { id: string; name: string; modules: string[] | 'all'; ca_validation: boolean; price_inr: number; price: Price | null }
interface Payment { id: string; plan_id: string; plan_name: string; amount_paise: number; status: 'created' | 'paid' | 'failed'; rp_payment_id: string | null; method: string | null; failure: string | null; period_from: string | null; period_to: string | null; invoice_no: string | null; created_name: string | null; created_at: string; paid_at: string | null }
interface Billing {
  online: boolean; keyId: string | null; support: string | null; product: string; gstRate: number; sellerState: string | null; note: string | null;
  company: { name: string; state: string; gstin: string | null; address: string | null; billingEmail: string | null; gstState: string | null };
  current: { planId: string | null; planName: string | null; platformPlan: string; trial: boolean; expiry: string; today: string };
  plans: PlanRow[]; payments: Payment[]; canPay: boolean; canEdit: boolean;
}

/** ₹3,538.82 from paise (whole rupees without decimals). */
export const rs = (paise: number) => { const r = Number(paise) / 100; return `₹${r.toLocaleString('en-IN', Number.isInteger(r) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
const METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', bank_transfer: 'Bank transfer' };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

declare global { interface Window { Razorpay?: any } }
let checkoutJs: Promise<void> | null = null;
/** Razorpay Checkout must be loaded from Razorpay (never self-hosted); this page's security policy allows exactly that script. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  checkoutJs ??= new Promise<void>((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.async = true;
    s.onload = () => ok();
    s.onerror = () => { checkoutJs = null; fail(new Error('The payment window could not be opened. Check your internet connection and try again.')); };
    document.head.appendChild(s);
  });
  return checkoutJs;
}

export function SmeBilling() {
  const [b, setB] = useState<Billing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [inv, setInv] = useState<string | null>(null);
  const poll = useRef<number | null>(null);
  const load = useCallback(() => call<Billing>('GET', '/api/sme/billing').then((x) => { setB(x); setErr(null); return x; }).catch((e) => { setErr(errText(e)); return null; }), []);
  useEffect(() => { void load(); return () => { if (poll.current) window.clearInterval(poll.current); }; }, [load]);

  // The payment window needs this page's own security policy, which comes with a full page load of /sme/billing.
  // Arriving through the menu keeps the previous page's stricter policy, so load the page once more.
  useEffect(() => {
    if (!b?.online || import.meta.env.DEV) return;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const first = nav ? new URL(nav.name).pathname : '';
    if (first !== '/sme/billing') window.location.replace(window.location.href);
  }, [b?.online]);

  if (err && !b) return <div className="card empty">{err}</div>;
  if (!b) return <div className="card empty">Loading…</div>;

  const cur = b.current, left = daysBetween(cur.today, cur.expiry);
  const curPlan = b.plans.find((p) => p.id === cur.planId) ?? null;
  const curLabel = curPlan?.name ?? (cur.trial ? 'Trial' : 'Set up by our team');
  const paid = b.payments.filter((p) => p.status === 'paid');
  const support = b.support;

  /** after the payment window: the server checks the signature and records the payment (the webhook does the same if this page is closed) */
  const confirm = async (orderId: string, r: any) => {
    setBusy('confirm'); setMsg({ kind: 'info', text: 'Payment received by the bank. Confirming…' });
    try {
      const v = await call<{ status: string; message?: string; invoiceNo?: string; expiry?: string }>('POST', '/api/sme/billing/verify', { orderId, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature });
      if (v.status === 'paid') {
        setMsg({ kind: 'ok', text: `Thank you — payment received. Your access now runs until ${dmy(v.expiry ?? '')}. Invoice ${v.invoiceNo ?? ''} is below.` });
        await load();
      } else {
        setMsg({ kind: 'info', text: v.message ?? 'Waiting for the bank to confirm. This page updates by itself.' });
        let n = 0;
        poll.current = window.setInterval(async () => {
          const x = await load();
          if (x?.payments.some((p) => p.status === 'paid' && p.rp_payment_id === r.razorpay_payment_id) || ++n > 24) {
            if (poll.current) window.clearInterval(poll.current);
            if (x?.payments.some((p) => p.rp_payment_id === r.razorpay_payment_id && p.status === 'paid')) setMsg({ kind: 'ok', text: 'Thank you — payment confirmed. Your invoice is below.' });
          }
        }, 5000);
      }
    } catch (e) { setMsg({ kind: 'bad', text: errText(e) }); }
    setBusy(null);
  };

  const pay = async (plan: PlanRow) => {
    setMsg(null); setBusy(plan.id);
    try {
      const o = await call<{ orderId: string; amount: number; currency: string; keyId: string; name: string; description: string; prefill: { name: string; email: string } }>('POST', '/api/sme/billing/order', { plan: plan.id });
      await loadCheckout();
      const rz = new window.Razorpay!({
        key: o.keyId, amount: o.amount, currency: o.currency, order_id: o.orderId, name: o.name, description: o.description,
        prefill: o.prefill, theme: { color: '#0E7C66' },
        handler: (r: any) => { void confirm(o.orderId, r); },
        modal: { ondismiss: () => setBusy((x) => (x === plan.id ? null : x)), confirm_close: true },
      });
      rz.on('payment.failed', (r: any) => {
        const why = String(r?.error?.description ?? 'The payment did not go through.');
        setMsg({ kind: 'bad', text: `${why} No money was taken for this attempt; you can try again.` });
        void call('POST', '/api/sme/billing/failed', { orderId: o.orderId, reason: why }).catch(() => undefined);
      });
      rz.open();
    } catch (e) { setMsg({ kind: 'bad', text: errText(e) }); setBusy(null); }
  };

  return (
    <>
      <SmeHead lede="Your plan, how long your access runs, and paying for the next year. Every payment has a GST tax invoice you can print." />

      {msg && <div className={`note ${msg.kind}`} role="status">{msg.text}</div>}

      <div className="card bil-now">
        <div className="bil-now-main">
          <span className="lbl">Your plan</span>
          <b className="bil-now-plan">{curLabel}</b>
          <span className="muted">{curPlan ? (curPlan.price_inr ? `${rs(curPlan.price_inr * 100)} a year + GST` : 'Free') : cur.trial ? 'Free trial of every page' : 'No plan paid online yet'}</span>
        </div>
        <div className="bil-now-main">
          <span className="lbl">Access until</span>
          <b className="bil-now-plan">{dmy(cur.expiry)}</b>
          <span>{left < 0 ? <Pill kind="overdue">Ended</Pill> : left <= 30 ? <Pill kind="soon">{left === 0 ? 'Ends today' : `${left} day${left === 1 ? '' : 's'} left`}</Pill> : <Pill kind="good">{left} days left</Pill>}</span>
        </div>
        <p className="bil-now-note muted small">After this date nobody in the company can sign in until the plan is renewed. Paying now adds one year after this date, so you lose no days by paying early.</p>
      </div>

      <div className="card">
        <div className="bil-h"><h2>Plans</h2><span className="muted small">Prices are per year. GST at {b.gstRate}% is added.</span></div>
        {!b.online && <div className="bil-off">
          <b>Online payment is not switched on yet.</b>
          <p>Pay by bank transfer instead: {support ? <>write to <a href={`mailto:${support}?subject=${encodeURIComponent(`Plan payment — ${b.company.name}`)}`}>{support}</a></> : 'contact the team that set up your account'} with the plan you want. We send the bank details and a GST invoice, and extend your access when the money arrives.</p>
        </div>}
        <div className="bil-plans">
          {b.plans.map((p) => {
            const isCur = p.id === cur.planId, pr = p.price;
            return (
              <div key={p.id} className={`bil-plan${isCur ? ' cur' : ''}`}>
                <div className="bil-plan-h"><b>{p.name}</b>{isCur && <span className="chip">Your plan</span>}</div>
                {pr ? <>
                  <div className="bil-price"><span className="num">{rs(pr.total)}</span><small>a year, incl. GST</small></div>
                  <div className="bil-split muted small">{rs(pr.base)} + GST {rs(pr.cgst + pr.sgst + pr.igst)}{pr.intra ? ` (CGST ${pr.rate / 2}% + SGST ${pr.rate / 2}%)` : ` (IGST ${pr.rate}%)`}</div>
                </> : <div className="bil-price"><span className="num">Free</span><small>no payment</small></div>}
                <ul className="bil-inc">
                  {p.modules === 'all' ? <li>Every page of the tool</li> : <>
                    {p.modules.map((m) => <li key={m}>{SME_PAGES[m]?.title ?? m}</li>)}
                  </>}
                  {p.ca_validation ? <li>CA validation of your SRMM self-assessment</li> : null}
                </ul>
                {pr && b.online && b.canPay && <button type="button" className={`btn ${isCur ? '' : 'p'} bil-pay`} disabled={!!busy} onClick={() => void pay(p)}>
                  {busy === p.id ? 'Opening…' : isCur ? `Renew for ${rs(pr.total)}` : `Pay ${rs(pr.total)}`}</button>}
              </div>);
          })}
        </div>
        {b.online && !b.canPay && <p className="muted small" style={{ margin: '12px 0 0' }}>Only the company’s owner or an admin can pay.</p>}
        {b.online && b.canPay && <p className="muted small" style={{ margin: '12px 0 0' }}>You pay on Razorpay’s secure window by UPI, card or net banking. We never see your card or bank details.</p>}
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          GST: CGST + SGST when your company is in {b.sellerState ?? 'the same state as ours'}, IGST otherwise{b.company.gstState ? ` — you are billed as ${b.company.gstState}` : ''}. Check the GST treatment with your CA.
        </p>
      </div>

      <div className="bil-cols">
        <Details b={b} onSaved={load} />
        <div className="card">
          <div className="bil-h"><h2>Payments</h2>{paid.length > 0 && <span className="muted small">{paid.length} paid</span>}</div>
          {b.payments.length === 0 ? <p className="muted bil-empty">No payments yet. {b.online ? 'When you pay for a plan, the payment and its invoice appear here.' : 'Payments by bank transfer are added here by our team, with the invoice.'}</p> : (
            <div className="sme-scroll"><table className="sme-tbl bil-tbl">
              <thead><tr><th>Date</th><th>Plan</th><th className="r">Amount</th><th>Status</th><th /></tr></thead>
              <tbody>{b.payments.map((p) => (
                <tr key={p.id}>
                  <td>{dmy(p.paid_at ?? p.created_at)}</td>
                  <td>{p.plan_name}{p.period_to && <div className="muted small">to {dmy(p.period_to)}</div>}</td>
                  <td className="r">{rs(p.amount_paise)}{p.method && <div className="muted small">{METHOD[p.method] ?? p.method}</div>}</td>
                  <td>{p.status === 'paid' ? <Pill kind="good">Paid</Pill> : p.status === 'failed' ? <Pill kind="overdue">Failed</Pill> : <Pill kind="grey">Not completed</Pill>}
                    {p.status !== 'paid' && p.failure && <div className="muted small">{p.failure}</div>}</td>
                  <td className="r">{p.status === 'paid' && <button type="button" className="btn sm" onClick={() => setInv(p.id)}>Invoice</button>}</td>
                </tr>))}</tbody>
            </table></div>)}
        </div>
      </div>

      {inv && <InvoiceModal url={`/api/sme/billing/invoice/${inv}`} onClose={() => setInv(null)} />}
    </>);
}

/* ------------------------------------------------------------------ invoice details --- */
function Details({ b, onSaved }: { b: Billing; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ gstin: b.company.gstin ?? '', address: b.company.address ?? '', billingEmail: b.company.billingEmail ?? '' });
  const [st, setSt] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = f.gstin !== (b.company.gstin ?? '') || f.address !== (b.company.address ?? '') || f.billingEmail !== (b.company.billingEmail ?? '');
  const save = async () => {
    setSaving(true); setSt(null);
    try { await call('PUT', '/api/sme/billing/details', { gstin: f.gstin.trim() || null, address: f.address.trim() || null, billingEmail: f.billingEmail.trim() || null }); await onSaved(); setSt({ kind: 'ok', text: 'Saved. New invoices use these details.' }); }
    catch (e) { setSt({ kind: 'bad', text: errText(e) }); }
    setSaving(false);
  };
  const ro = !b.canEdit;
  return (
    <div className="card">
      <div className="bil-h"><h2>Invoice details</h2></div>
      <p className="muted small" style={{ margin: '2px 0 12px' }}>Printed on your invoices as the buyer. Add your GSTIN if the company is registered for GST, so you can claim the input tax credit.</p>
      <dl className="bil-dl">
        <dt>Company</dt><dd>{b.company.name}</dd>
        <dt>State</dt><dd>{b.company.state || <span className="muted">Not set</span>} <Link to="/sme/profile" className="small">Change in Profile</Link></dd>
      </dl>
      <div className="bil-form">
        <label><span>GSTIN <small className="muted">(optional)</small></span>
          <input className="input mono" value={f.gstin} maxLength={15} disabled={ro} placeholder="27AAACG1234F1Z5" onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().replace(/\s/g, '') })} /></label>
        <label><span>Billing address</span>
          <textarea className="input" rows={3} value={f.address} maxLength={400} disabled={ro} placeholder="Plot, street, area, city, PIN" onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <label><span>Send invoices also to <small className="muted">(optional)</small></span>
          <input className="input" type="email" value={f.billingEmail} maxLength={190} disabled={ro} placeholder="accounts@yourcompany.in" onChange={(e) => setF({ ...f, billingEmail: e.target.value })} /></label>
      </div>
      {st && <div className={`note ${st.kind}`} style={{ marginTop: 10 }}>{st.text}</div>}
      {!ro && <div className="row" style={{ marginTop: 12 }}><button type="button" className="btn p" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save details'}</button></div>}
      {ro && <p className="muted small" style={{ margin: '10px 0 0' }}>Only the owner or an admin can change these.</p>}
    </div>);
}

/* ------------------------------------------------------------------ tax invoice --- */
interface Invoice {
  id: string; number: string; date: string; fy: string; placeOfSupply: string; rate: number; intra: boolean; cgst: number; sgst: number; igst: number; total: number; words: string; reverseCharge: string;
  seller: { name: string; address: string; state: string; stateCode: string; gstin: string; pan: string | null; email: string | null; sac: string; product?: string };
  buyer: { name: string; state: string | null; gstin: string | null; address: string | null; posState: string | null };
  line: { description: string; sac: string; qty: number; taxable: number };
  payment: { id: string; method: string | null; order: string };
}

/** The invoice in a layer over the page (outside the app frame, so it prints on its own). */
export function InvoiceModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { call<{ invoice: Invoice }>('GET', url).then((r) => setInv(r.invoice)).catch((e) => setErr(errText(e))); }, [url]);
  useEffect(() => {
    document.body.classList.add('bil-modal-open');
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => { document.body.classList.remove('bil-modal-open'); window.removeEventListener('keydown', k); };
  }, [onClose]);
  return createPortal(
    <div className="bil-overlay" role="dialog" aria-modal="true" aria-label="Tax invoice" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bil-sheet">
        <div className="bil-bar bil-noprint">
          <b className="grow">{inv ? `Invoice ${inv.number}` : 'Invoice'}</b>
          <button type="button" className="btn p" disabled={!inv} onClick={() => window.print()}>Print or save as PDF</button>
          <button type="button" className="btn ghost" onClick={onClose}>Close</button>
        </div>
        {err ? <div className="note bad">{err}</div> : !inv ? <p className="muted">Loading…</p> : <InvoiceDoc inv={inv} />}
      </div>
    </div>, document.body);
}

function InvoiceDoc({ inv }: { inv: Invoice }) {
  const s = inv.seller, b = inv.buyer, tax = inv.cgst + inv.sgst + inv.igst;
  return (
    <article className="bil-inv">
      <header className="bil-inv-h">
        <div><h1>Tax invoice</h1><span className="muted small">Original for recipient</span></div>
        <dl><dt>Invoice no.</dt><dd className="mono">{inv.number}</dd><dt>Date</dt><dd>{dmy(inv.date)}</dd><dt>Place of supply</dt><dd>{inv.placeOfSupply}</dd><dt>Reverse charge</dt><dd>{inv.reverseCharge}</dd></dl>
      </header>
      <section className="bil-inv-parties">
        <div><span className="lbl">From (supplier)</span><b>{s.name}</b><p>{s.address}</p><p>{s.state} (state code {s.stateCode})</p><p>GSTIN <span className="mono">{s.gstin}</span>{s.pan ? <> · PAN <span className="mono">{s.pan}</span></> : null}</p>{s.email && <p>{s.email}</p>}</div>
        <div><span className="lbl">Bill to (recipient)</span><b>{b.name}</b>{b.address && <p>{b.address}</p>}<p>{b.state || '—'}</p><p>{b.gstin ? <>GSTIN <span className="mono">{b.gstin}</span></> : 'Not registered for GST'}</p></div>
      </section>
      <table className="bil-inv-t">
        <thead><tr><th>Description</th><th>SAC</th><th className="r">Qty</th><th className="r">Taxable value</th></tr></thead>
        <tbody>
          <tr><td>{inv.line.description}</td><td className="mono">{inv.line.sac}</td><td className="r">{inv.line.qty}</td><td className="r">{rs(inv.line.taxable)}</td></tr>
          {inv.intra ? <>
            <tr className="tax"><td colSpan={3}>CGST @ {inv.rate / 2}%</td><td className="r">{rs(inv.cgst)}</td></tr>
            <tr className="tax"><td colSpan={3}>SGST @ {inv.rate / 2}%</td><td className="r">{rs(inv.sgst)}</td></tr>
          </> : <tr className="tax"><td colSpan={3}>IGST @ {inv.rate}%</td><td className="r">{rs(inv.igst)}</td></tr>}
          <tr className="tot"><td colSpan={3}>Total (taxable {rs(inv.line.taxable)} + tax {rs(tax)})</td><td className="r">{rs(inv.total)}</td></tr>
        </tbody>
      </table>
      <p className="bil-words"><span className="lbl">Amount in words</span> {inv.words}</p>
      <p className="small">Paid online{inv.payment.method ? ` by ${METHOD[inv.payment.method] ?? inv.payment.method}` : ''} · payment reference <span className="mono">{inv.payment.id}</span></p>
      <footer className="bil-inv-f">
        <span>This is a computer-generated invoice.</span>
        <span className="bil-sign">For {s.name}<br /><br />Authorised signatory</span>
      </footer>
    </article>);
}

/* ------------------------------------------------------------------ platform console: Payments tab --- */
interface ConsolePayment { id: string; company: string; plan_name: string; amount_paise: number; gst_paise: number; status: string; rp_payment_id: string | null; rp_order_id: string; method: string | null; failure: string | null; via: string | null; period_to: string | null; invoice_no: string | null; created_name: string | null; created_at: string; paid_at: string | null }
export function SmeConsolePayments() {
  const [d, setD] = useState<{ online: boolean; missing: string[]; support: string | null; payments: ConsolePayment[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'paid' | 'open'>('all');
  const [inv, setInv] = useState<string | null>(null);
  useEffect(() => { call<NonNullable<typeof d>>('GET', '/api/platform/sme/payments').then(setD).catch((e) => setErr(errText(e))); }, []);
  if (!d) return <div className="card empty">{err ?? 'Loading…'}</div>;
  const rows = d.payments.filter((p) => show === 'all' || (show === 'paid' ? p.status === 'paid' : p.status !== 'paid'));
  const paid = d.payments.filter((p) => p.status === 'paid');
  const sum = paid.reduce((a, p) => a + Number(p.amount_paise), 0), gst = paid.reduce((a, p) => a + Number(p.gst_paise), 0);
  return (
    <div className="card net-sec">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 260 }}><h2>Payments</h2>
          <p className="muted small" style={{ margin: '4px 0 0', maxWidth: '80ch' }}>Online plan payments by SME companies (Razorpay). A payment is recorded when the browser confirms it or when Razorpay’s webhook arrives, whichever is first, and never twice.</p></div>
        <div className="seg">{(['all', 'paid', 'open'] as const).map((k) => <button key={k} type="button" className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{k === 'all' ? 'All' : k === 'paid' ? 'Paid' : 'Not completed'}</button>)}</div>
      </div>
      {d.online ? <div className="note ok" style={{ marginTop: 12 }}>Online payment is on.</div>
        : <div className="note info" style={{ marginTop: 12 }}>Online payment is off: companies see “pay by bank transfer — contact us”{d.support ? ` (${d.support})` : ' (no support e-mail in the brand pack)'}. To switch it on, set on the server: <span className="mono">{d.missing.join(', ')}</span> (see .env.example).</div>}
      <div className="bil-con-k">
        <div><span className="lbl">Paid</span><b>{paid.length}</b></div>
        <div><span className="lbl">Received</span><b>{rs(sum)}</b></div>
        <div><span className="lbl">of which GST</span><b>{rs(gst)}</b></div>
      </div>
      {rows.length === 0 ? <p className="muted">No payments{show !== 'all' ? ' in this view' : ' yet'}.</p> : (
        <div className="sme-scroll"><table className="sme-tbl">
          <thead><tr><th>Date</th><th>Company</th><th>Plan</th><th className="r">Amount</th><th>Status</th><th>Invoice</th><th>Reference</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}>
              <td>{dmy(p.paid_at ?? p.created_at)}</td>
              <td><b>{p.company}</b>{p.created_name && <div className="muted small">by {p.created_name}</div>}</td>
              <td>{p.plan_name}{p.period_to && <div className="muted small">to {dmy(p.period_to)}</div>}</td>
              <td className="r">{rs(p.amount_paise)}{p.method && <div className="muted small">{METHOD[p.method] ?? p.method}</div>}</td>
              <td>{p.status === 'paid' ? <Pill kind="good">Paid</Pill> : p.status === 'failed' ? <Pill kind="overdue">Failed</Pill> : <Pill kind="grey">Not completed</Pill>}
                {p.status !== 'paid' && p.failure && <div className="muted small">{p.failure}</div>}{p.via && <div className="muted small">via {p.via === 'webhook' ? 'webhook' : 'page'}</div>}</td>
              <td>{p.invoice_no ? <button type="button" className="btn sm" onClick={() => setInv(p.id)}>{p.invoice_no}</button> : <span className="muted">—</span>}</td>
              <td className="mono small">{p.rp_payment_id ?? p.rp_order_id}</td>
            </tr>))}</tbody>
        </table></div>)}
      {inv && <InvoiceModal url={`/api/platform/sme/payments/${inv}/invoice`} onClose={() => setInv(null)} />}
    </div>);
}
