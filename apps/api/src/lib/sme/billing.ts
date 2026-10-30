/**
 * EKOTRACE SME plan & billing: prices with GST, Razorpay (orders, payment and webhook signatures, capture),
 * applying a payment once (access extended by a year, plan set, invoice numbered, audit, receipt) and the
 * tax invoice. Razorpay is called with fetch (REST, Basic auth); nothing here trusts amounts from the browser.
 *
 * Environment
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   API keys (Dashboard → Account & Settings → API keys)
 *   RAZORPAY_WEBHOOK_SECRET                the secret typed when adding the webhook (…/api/public/sme/billing/webhook)
 *   SME_SELLER_NAME, SME_SELLER_ADDRESS, SME_SELLER_STATE, SME_SELLER_GSTIN   the platform operator, printed on invoices
 *   SME_SELLER_PAN, SME_SELLER_EMAIL (optional), SME_SELLER_SAC (default 997331), SME_INVOICE_PREFIX (1–4 letters/digits, default SME)
 * Online payment is "on" only when the three Razorpay values and the seller's name, address, state and GSTIN are set.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../../db/pool.js';
import { AppError } from '../errors.js';
import { mailOn, queueEmail, appLink } from '../mail.js';
import { brandPack } from '../brand.js';

export const GST_RATE = 18;   // % — IT / software services; the operator's CA confirms the rate and SAC
export const RAZORPAY_API = 'https://api.razorpay.com/v1';

/** GST state codes (first two digits of a GSTIN). */
export const GST_STATE: Record<string, string> = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07', Rajasthan: '08',
  'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14', Mizoram: '15', Tripura: '16', Meghalaya: '17',
  Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22', 'Madhya Pradesh': '23', Gujarat: '24',
  'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30', Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33',
  Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36', 'Andhra Pradesh': '37', Ladakh: '38',
};
export const stateOfCode = (code: string) => Object.entries(GST_STATE).find(([, c]) => c === code)?.[0] ?? null;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// ------------------------------------------------------------------ configuration --
export interface Seller { name: string; address: string; state: string; stateCode: string; gstin: string; pan: string | null; email: string | null; sac: string; prefix: string }
export function razorpay(): { keyId: string; keySecret: string; webhookSecret: string } | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim(), keySecret = process.env.RAZORPAY_KEY_SECRET?.trim(), webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  return keyId && keySecret && webhookSecret ? { keyId, keySecret, webhookSecret } : null;
}
/** The support address of the brand (null when the brand pack has a placeholder). */
export function supportEmail(): string | null {
  const e = String(process.env.SME_SELLER_EMAIL ?? brandPack?.supportEmail ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
export function seller(): Seller | null {
  const name = process.env.SME_SELLER_NAME?.trim(), address = process.env.SME_SELLER_ADDRESS?.trim(), state = process.env.SME_SELLER_STATE?.trim();
  const gstin = process.env.SME_SELLER_GSTIN?.trim().toUpperCase();
  if (!name || !address || !state || !gstin || !GST_STATE[state] || !GSTIN_RE.test(gstin)) return null;
  const prefix = (process.env.SME_INVOICE_PREFIX ?? 'SME').trim().toUpperCase();
  return { name, address, state, stateCode: GST_STATE[state]!, gstin, pan: process.env.SME_SELLER_PAN?.trim() || gstin.slice(2, 12), email: supportEmail(),
    sac: (process.env.SME_SELLER_SAC ?? '997331').trim(), prefix: /^[A-Z0-9]{1,4}$/.test(prefix) ? prefix : 'SME' };
}
/** What is missing before online payment can be switched on (names of settings; shown to platform admins only). */
export function missingSetup(): string[] {
  const m: string[] = [];
  for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'SME_SELLER_NAME', 'SME_SELLER_ADDRESS', 'SME_SELLER_STATE', 'SME_SELLER_GSTIN']) if (!process.env[k]?.trim()) m.push(k);
  if (process.env.SME_SELLER_STATE?.trim() && !GST_STATE[process.env.SME_SELLER_STATE.trim()]) m.push('SME_SELLER_STATE (a state name, e.g. Maharashtra)');
  if (process.env.SME_SELLER_GSTIN?.trim() && !GSTIN_RE.test(process.env.SME_SELLER_GSTIN.trim().toUpperCase())) m.push('SME_SELLER_GSTIN (15 characters)');
  return m;
}
export const onlineOn = () => !!razorpay() && !!seller();

/**
 * Security headers for the one page that opens Razorpay Checkout (/sme/billing), only while online payment is on.
 * Checkout is a script from checkout.razorpay.com that opens a frame from api.razorpay.com (and, for some banks and
 * UPI apps, a pop-up), so this page allows exactly those origins; cross-origin isolation (COEP) is not possible with a
 * third-party payment frame, and COOP keeps pop-ups. Every other page keeps the strict default.
 */
export function checkoutHeaders(url: string): Record<string, string> | null {
  if (!/^\/sme\/billing(?:[/?#]|$)/.test(url) || !onlineOn()) return null;
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' blob:; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.razorpay.com; frame-src 'self' blob: https://api.razorpay.com https://checkout.razorpay.com; object-src 'none'; connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.razorpay.com",
    'Cross-Origin-Embedder-Policy': 'unsafe-none',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(self "https://api.razorpay.com"), usb=()',
  };
}

// ------------------------------------------------------------------ prices --
export interface Plan { id: string; name: string; price_inr: number; modules: string[] | 'all'; ca_validation?: boolean }
export const paidPlans = (plans: any): Plan[] => ((plans?.items ?? []) as Plan[]).filter((p) => p && typeof p.id === 'string' && Number(p.price_inr) > 0);

/** The buyer's GST state: from the GSTIN when there is one, else the company's state (null = not known). */
export function buyerState(state: string | null | undefined, gstin: string | null | undefined): string | null {
  if (gstin && GSTIN_RE.test(gstin)) return stateOfCode(gstin.slice(0, 2));
  return state && GST_STATE[state] ? state : null;
}
/**
 * Tax on a plan price (rupees, before GST). Same state as the seller (or the buyer's state not known: the place of
 * supply is then the seller's location, IGST Act s.12(2)(b)) → CGST + SGST, half each; otherwise IGST. All in paise.
 */
export function priceOf(priceInr: number, sellerState: string | null, buyer: string | null, rate = GST_RATE) {
  const base = Math.round(Number(priceInr) * 100);
  const intra = !buyer || !sellerState || buyer === sellerState;
  const half = Math.round((base * rate) / 200);
  const cgst = intra ? half : 0, sgst = intra ? half : 0, igst = intra ? 0 : Math.round((base * rate) / 100);
  return { base, cgst, sgst, igst, total: base + cgst + sgst + igst, intra, rate };
}

// ------------------------------------------------------------------ signatures --
const hmac = (key: string, data: string | Buffer) => createHmac('sha256', key).update(data).digest('hex');
function same(a: string, b: string) {
  const x = Buffer.from(a, 'utf8'), y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Checkout handler: HMAC-SHA256 of "order_id|payment_id" with the key secret (order id from our own record). */
export const verifyPaymentSignature = (orderId: string, paymentId: string, signature: string, secret: string) =>
  typeof signature === 'string' && /^[0-9a-f]{64}$/.test(signature) && same(hmac(secret, `${orderId}|${paymentId}`), signature);
/** Webhook: HMAC-SHA256 of the raw request body with the webhook secret (X-Razorpay-Signature). */
export const verifyWebhookSignature = (raw: Buffer | string, signature: string | undefined, secret: string) =>
  typeof signature === 'string' && /^[0-9a-f]{64}$/.test(signature) && same(hmac(secret, raw), signature);

// ------------------------------------------------------------------ Razorpay REST --
async function rp(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
  const k = razorpay();
  if (!k) throw new AppError('Online payment is not switched on.', 503, 'PAYMENT_OFF');
  let r: Response;
  try {
    r = await fetch(`${RAZORPAY_API}${path}`, {
      method, signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Basic ${Buffer.from(`${k.keyId}:${k.keySecret}`).toString('base64')}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new AppError('The payment service could not be reached. Try again in a minute.', 502, 'PAYMENT_SERVICE'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AppError(`The payment service refused: ${String(j?.error?.description ?? r.status).slice(0, 200)}`, 502, 'PAYMENT_SERVICE');
  return j;
}
export const createOrder = (amountPaise: number, receipt: string, notes: Record<string, string>) =>
  rp('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt: receipt.slice(0, 40), notes }) as Promise<{ id: string; amount: number; currency: string; status: string }>;
export const fetchPayment = (paymentId: string) => rp('GET', `/payments/${encodeURIComponent(paymentId)}`);
export const capturePayment = (paymentId: string, amountPaise: number) => rp('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: 'INR' });

// ------------------------------------------------------------------ dates & numbers --
/** Today in India (yyyy-mm-dd). */
export const todayIn = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
function addDays(iso: string, n: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addYear(iso: string) {
  const [y, m, d] = iso.split('-');
  const md = `${m}-${d}` === '02-29' ? '02-28' : `${m}-${d}`;
  return `${Number(y) + 1}-${md}`;
}
/** A year more: from the later of today and the current expiry. */
export function extendExpiry(current: string | null, today: string) {
  const cur = current ? String(current).slice(0, 10) : null;
  if (cur && cur >= today) return { from: addDays(cur, 1), to: addYear(cur) };
  return { from: today, to: addYear(today) };
}
/** Indian financial year of a date, as "2026-27". */
export function invoiceFy(iso: string) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), s = m >= 4 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
/** "SME/26-27/00001": at most 16 characters (GST rule 46). */
export const invoiceNo = (prefix: string, fy: string, seq: number) => `${prefix}/${fy.slice(2)}/${String(seq).padStart(5, '0')}`;
/** Next serial number of the financial year (platform transaction; the row lock keeps numbers consecutive). */
export async function nextInvoiceSeq(c: Tx, fy: string): Promise<number> {
  return (await c.query(`INSERT INTO sme_invoice_seq (fy, last) VALUES ($1, 1) ON CONFLICT (fy) DO UPDATE SET last = sme_invoice_seq.last + 1 RETURNING last`, [fy])).rows[0].last as number;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n: number) { return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`; }
function three(n: number) { const h = Math.floor(n / 100), r = n % 100; return [h ? `${ONES[h]} Hundred` : '', r ? two(r) : ''].filter(Boolean).join(' '); }
/** Amount in words, Indian system: "Rupees Three Thousand Five Hundred Thirty Eight and Eighty Two Paise only". */
export function inWords(paise: number) {
  let r = Math.floor(paise / 100); const p = paise % 100;
  const parts: string[] = [];
  const cr = Math.floor(r / 1e7); r %= 1e7; const lk = Math.floor(r / 1e5); r %= 1e5; const th = Math.floor(r / 1e3); r %= 1e3;
  if (cr) parts.push(`${three(cr)} Crore`); if (lk) parts.push(`${two(lk)} Lakh`); if (th) parts.push(`${two(th)} Thousand`); if (r) parts.push(three(r));
  return `Rupees ${parts.join(' ') || 'Zero'}${p ? ` and ${two(p)} Paise` : ''} only`;
}
const dmyText = (iso: string | null) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('-') : '—');
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------------ applying a payment --
export type ApplyResult = { status: 'applied' | 'already' | 'unknown' | 'mismatch'; payment?: any };
/**
 * Records a captured payment against our order, once. Runs in a platform transaction (the invoice counter is
 * shared by every company). The order row is locked, so the browser handler and the webhook cannot both apply it.
 */
export async function applyPayment(c: Tx, p: { orderId: string; paymentId: string; amount: number; currency?: string; method?: string | null; via: 'checkout' | 'webhook'; user?: { id: string; name: string } | null; ip?: string | null; now?: Date }): Promise<ApplyResult> {
  const row = (await c.query(`SELECT * FROM sme_payment WHERE rp_order_id = $1 FOR UPDATE`, [p.orderId])).rows[0];
  if (!row) return { status: 'unknown' };
  if (row.status === 'paid') return { status: row.rp_payment_id === p.paymentId ? 'already' : 'mismatch', payment: row };
  if ((await c.query(`SELECT 1 FROM sme_payment WHERE rp_payment_id = $1`, [p.paymentId])).rowCount) return { status: 'already', payment: row };
  if (Number(p.amount) !== Number(row.amount_paise) || (p.currency && p.currency !== 'INR')) return { status: 'mismatch', payment: row };

  const now = p.now ?? new Date(), today = todayIn(now);
  const t = (await c.query(`SELECT id, name, access_expiry, plan, billing_email FROM tenant WHERE id = $1 FOR UPDATE`, [row.tenant_id])).rows[0];
  const period = extendExpiry(t.access_expiry, today);
  const fy = invoiceFy(today), seq = await nextInvoiceSeq(c, fy), no = invoiceNo(row.seller?.prefix ?? 'SME', fy, seq);
  const paid = (await c.query(`UPDATE sme_payment SET status = 'paid', rp_payment_id = $2, method = $3, via = $4, paid_at = $5, period_from = $6, period_to = $7,
      invoice_fy = $8, invoice_seq = $9, invoice_no = $10, failure = NULL WHERE id = $1 RETURNING *`,
    [row.id, p.paymentId, p.method ?? null, p.via, now, period.from, period.to, fy, seq, no])).rows[0];
  // a paid company is no longer on trial (tenant.plan is the platform plan; the SME plan is sme_company.plan_id)
  await c.query(`UPDATE tenant SET access_expiry = $2, plan = CASE WHEN plan = 'trial' THEN 'starter' ELSE plan END, price = $3, billing_currency = 'INR', billing_cycle = 'annual' WHERE id = $1`,
    [row.tenant_id, period.to, Number(row.base_paise) / 100]);
  await c.query(`INSERT INTO sme_company (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [row.tenant_id]);
  await c.query(`UPDATE sme_company SET plan_id = $2 WHERE tenant_id = $1`, [row.tenant_id, row.plan_id]);
  await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,'sme.billing.paid','sme_payment',$4,$5,$6)`,
    [row.tenant_id, p.user?.id ?? null, p.user?.name ?? (p.via === 'webhook' ? 'Razorpay webhook' : null), row.id,
      JSON.stringify({ plan: row.plan_id, amount_inr: Number(row.amount_paise) / 100, payment: p.paymentId, order: p.orderId, invoice: no, expiry_before: t.access_expiry, expiry_after: period.to, via: p.via }), p.ip ?? null]);
  if (mailOn()) {
    const to = [...new Set([row.created_email, t.billing_email].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];
    const link = appLink('/sme/billing');
    const body = `Thank you. We received your payment for ${t.name}.\n\n  Plan: ${row.plan_name}\n  Amount paid: ${inr(Number(row.amount_paise))} (incl. GST)\n  Invoice: ${no}\n  Payment reference: ${p.paymentId}\n  Access until: ${period.to.split('-').reverse().join('-')}\n\n`
      + `${link ? `Your tax invoice is on the Plan & billing page: ${link}\n\n` : 'Your tax invoice is on the Plan & billing page.\n\n'}${row.seller?.name ?? ''}\n`;
    for (const e of to) await queueEmail(c, row.tenant_id, e, `Payment received — invoice ${no}`, body);
  }
  return { status: 'applied', payment: paid };
}

/** The tax invoice of a paid payment (everything printed comes from the row: seller and buyer as they were then). */
export function invoiceOf(p: any) {
  const s = p.seller ?? {}, b = p.buyer ?? {};
  const intra = Number(p.igst_paise) === 0;
  return {
    id: p.id, number: p.invoice_no, date: p.paid_at ? todayIn(new Date(p.paid_at)) : null, fy: p.invoice_fy,
    seller: s, buyer: b, placeOfSupply: b.posState ? `${b.posState} (${GST_STATE[b.posState] ?? '—'})` : `${s.state} (${s.stateCode})`,
    line: { description: `${s.product ?? 'EKOTRACE SME'} — ${p.plan_name} plan, annual subscription, ${dmyText(p.period_from)} to ${dmyText(p.period_to)}`, sac: s.sac, qty: 1, taxable: Number(p.base_paise) },
    rate: Number(p.gst_rate), intra, cgst: Number(p.cgst_paise), sgst: Number(p.sgst_paise), igst: Number(p.igst_paise), total: Number(p.amount_paise), words: inWords(Number(p.amount_paise)),
    payment: { id: p.rp_payment_id, method: p.method, order: p.rp_order_id }, reverseCharge: 'No',
  };
}
