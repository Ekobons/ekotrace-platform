/**
 * EKOTRACE SME plan & billing: Razorpay signatures, prices with GST, expiry extension, invoice numbering, and the
 * API (order → verify → applied once; webhook; roles; not configured). Razorpay is mocked: no network.
 *
 *   SME_BILLING_TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ekotrace_billing_test node --import tsx --test test/sme2-billing.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import pg from 'pg';

// the test database is set before anything opens the pool (billing → mail → pool)
const url = process.env.SME_BILLING_TEST_DATABASE_URL ?? 'postgres://ekotrace:ekotrace@127.0.0.1:5432/ekotrace_billing_test';
const dbName = new URL(url).pathname.slice(1);
if (!dbName.endsWith('_test')) throw new Error('SME_BILLING_TEST_DATABASE_URL must point to a database whose name ends in _test');
process.env.DATABASE_URL = url;
const B = await import('../src/lib/sme/billing.js');

const KEY_SECRET = 'test_key_secret_123', HOOK_SECRET = 'test_webhook_secret_456';
const ENV: Record<string, string> = {
  RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK_SECRET,
  SME_SELLER_NAME: 'Ekobon Test Pvt Ltd', SME_SELLER_ADDRESS: '1 Test Road, Pune 411001', SME_SELLER_STATE: 'Maharashtra', SME_SELLER_GSTIN: '27AAACE1234F1Z5', SME_INVOICE_PREFIX: 'SME',
};
const setEnv = (on: boolean) => { for (const [k, v] of Object.entries(ENV)) { if (on) process.env[k] = v; else delete process.env[k]; } };
const sig = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

// ------------------------------------------------------------------ pure logic --
test('signatures: payment (order|payment, key secret) and webhook (raw body, webhook secret)', () => {
  const good = sig(KEY_SECRET, 'order_1|pay_1');
  assert.equal(B.verifyPaymentSignature('order_1', 'pay_1', good, KEY_SECRET), true);
  assert.equal(B.verifyPaymentSignature('order_1', 'pay_2', good, KEY_SECRET), false);
  assert.equal(B.verifyPaymentSignature('order_1', 'pay_1', good, 'other'), false);
  assert.equal(B.verifyPaymentSignature('order_1', 'pay_1', 'not-hex', KEY_SECRET), false);
  const body = Buffer.from('{"event":"payment.captured"}');
  assert.equal(B.verifyWebhookSignature(body, sig(HOOK_SECRET, body.toString()), HOOK_SECRET), true);
  assert.equal(B.verifyWebhookSignature(Buffer.from('{"event":"payment.captured" }'), sig(HOOK_SECRET, body.toString()), HOOK_SECRET), false);
  assert.equal(B.verifyWebhookSignature(body, undefined, HOOK_SECRET), false);
});

test('prices: CGST + SGST in the seller\'s state (or state unknown), IGST elsewhere, 18%', () => {
  const a = B.priceOf(2999, 'Maharashtra', 'Maharashtra');
  assert.deepEqual([a.base, a.cgst, a.sgst, a.igst, a.total], [299900, 26991, 26991, 0, 353882]);
  const b = B.priceOf(2999, 'Maharashtra', 'Gujarat');
  assert.deepEqual([b.cgst, b.sgst, b.igst, b.total], [0, 0, 53982, 353882]);
  assert.equal(B.priceOf(2999, 'Maharashtra', null).intra, true);
  assert.equal(B.buyerState('Maharashtra', '24AAACG1234F1Z5'), 'Gujarat');     // the GSTIN decides
  assert.equal(B.buyerState('Other', null), null);
  assert.match(B.inWords(353882), /^Rupees Three Thousand Five Hundred Thirty Eight and Eighty Two Paise only$/);
  assert.equal(B.inWords(1234567800), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight only');
});

test('expiry: a year from the later of today and the current expiry', () => {
  assert.deepEqual(B.extendExpiry('2026-06-30', '2026-10-30'), { from: '2026-10-30', to: '2027-10-30' });   // lapsed → from today
  assert.deepEqual(B.extendExpiry('2027-03-31', '2026-10-30'), { from: '2027-04-01', to: '2028-03-31' });   // still running → added on
  assert.deepEqual(B.extendExpiry(null, '2028-02-29'), { from: '2028-02-29', to: '2029-02-28' });
  assert.equal(B.todayIn(new Date('2026-10-30T20:00:00Z')), '2026-10-31');                                   // India time
});

test('invoice numbers: per Indian financial year, at most 16 characters', () => {
  assert.equal(B.invoiceFy('2026-03-31'), '2025-26'); assert.equal(B.invoiceFy('2026-04-01'), '2026-27');
  assert.equal(B.invoiceNo('SME', '2026-27', 1), 'SME/26-27/00001');
  assert.ok(B.invoiceNo('ABCD', '2026-27', 99999).length <= 16);
});

// ------------------------------------------------------------------ API --
let app: Awaited<ReturnType<typeof import('../src/app.js')['buildApp']>>;
let pool: pg.Pool, p: pg.Client;
let admin = '', owner = '', prep = '', ownerB = '';
let sme = '', smeB = '';
const call = async (method: string, path: string, body?: unknown, cookie = admin) => {
  const r = await app.inject({ method: method as 'GET', url: path, payload: (body ?? (method === 'GET' ? undefined : {})) as object, headers: { cookie } });
  let json: any = null;
  try { json = r.json(); } catch { json = r.body; }
  return { status: r.statusCode, body: json, text: r.body, headers: r.headers };
};
const login = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'correct horse battery' } })).headers['set-cookie']).split(';')[0]!;
const hook = (event: string, payment: any) => {
  const raw = JSON.stringify({ entity: 'event', event, payload: { payment: { entity: payment } }, created_at: Math.floor(Date.now() / 1000) });
  return app.inject({ method: 'POST', url: '/api/public/sme/billing/webhook', payload: raw, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig(HOOK_SECRET, raw) } });
};

// Razorpay mocked: orders and payments live here
const rzp = { orders: new Map<string, any>(), payments: new Map<string, any>(), calls: [] as string[], n: 0 };
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = String(input?.url ?? input), m = init?.method ?? 'GET';
    if (!u.startsWith(B.RAZORPAY_API)) throw new Error(`unexpected network call ${u}`);
    rzp.calls.push(`${m} ${u.slice(B.RAZORPAY_API.length)}`);
    assert.equal(init.headers.authorization, `Basic ${Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    if (m === 'POST' && u.endsWith('/orders')) {
      const b = JSON.parse(init.body); const o = { id: `order_${++rzp.n}`, entity: 'order', amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created', notes: b.notes };
      rzp.orders.set(o.id, o); return json(200, o);
    }
    const pm = /\/payments\/([^/]+)(\/capture)?$/.exec(u);
    if (pm) {
      const pay = rzp.payments.get(decodeURIComponent(pm[1]!));
      if (!pay) return json(400, { error: { description: 'The id provided does not exist' } });
      if (pm[2]) { pay.status = 'captured'; }
      return json(200, pay);
    }
    return json(404, { error: { description: 'not mocked' } });
  }) as typeof fetch;
});

before(async () => {
  setEnv(true);
  const c0 = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await c0.connect(); await c0.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await c0.query(`CREATE DATABASE ${dbName}`); await c0.end();
  await (await import('../src/db/migrate.js')).migrate(() => {});
  app = await (await import('../src/app.js')).buildApp({ rateLimit: null });
  pool = (await import('../src/db/pool.js')).pool;
  const { hashPassword } = await import('../src/lib/password.js');
  const pw = await hashPassword('correct horse battery');
  p = new pg.Client({ connectionString: url });
  await p.connect(); await p.query(`SELECT set_config('app.platform','on',false)`);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES (NULL,'ops@ekobon.test','Ops','platform_admin',$1,false)`, [pw]);
  admin = await login('ops@ekobon.test');
  const mk = async (name: string, email: string) => (await call('POST', '/api/platform/companies', { name, country: 'IN', products: ['sme'], superAdmin: { name: 'SA', email } })).body.company.id as string;
  sme = await mk('Ganesh Fasteners', 'owner@sme.test');
  smeB = await mk('Surat Textiles', 'owner@b.test');
  await p.query(`UPDATE app_user SET password_hash = $1, must_change_password = false WHERE tenant_id IS NOT NULL`, [pw]);
  await p.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,'prep@sme.test','Prep','preparer',$2,false)`, [sme, pw]);
  owner = await login('owner@sme.test'); prep = await login('prep@sme.test'); ownerB = await login('owner@b.test');
  assert.equal((await call('PUT', '/api/sme/company', { state: 'Maharashtra' }, owner)).status, 200);
  assert.equal((await call('PUT', '/api/sme/company', { state: 'Gujarat' }, ownerB)).status, 200);
});
after(async () => { globalThis.fetch = realFetch; await p?.end(); await app?.close(); await pool?.end(); });

const expiryOf = async (t: string) => (await p.query(`SELECT access_expiry::text AS e FROM tenant WHERE id = $1`, [t])).rows[0].e as string;

test('API: plans with GST, only owner / admin can pay, order amount from the setting', async () => {
  const g = await call('GET', '/api/sme/billing', undefined, owner);
  assert.equal(g.status, 200); assert.equal(g.body.online, true); assert.equal(g.body.canPay, true); assert.equal(g.body.keyId, 'rzp_test_abc');
  const basic = g.body.plans.find((x: any) => x.id === 'basic');
  assert.equal(basic.price.total, 353882); assert.equal(basic.price.intra, true);
  assert.equal((await call('GET', '/api/sme/billing', undefined, prep)).body.canPay, false);
  assert.equal((await call('POST', '/api/sme/billing/order', { plan: 'basic' }, prep)).status, 403);
  assert.equal((await call('POST', '/api/sme/billing/order', { plan: 'free' }, owner)).status, 400);
  assert.equal((await call('POST', '/api/sme/billing/order', { plan: 'basic', amount: 1 }, owner)).body.amount, 353882);   // a browser amount is ignored
});

test('API: verify → signature checked, applied once, a year added, invoice numbered; webhook does not apply twice', async () => {
  await p.query(`UPDATE tenant SET access_expiry = current_date - 10, plan = 'trial' WHERE id = $1`, [sme]);
  const o = (await call('POST', '/api/sme/billing/order', { plan: 'basic' }, owner)).body;
  rzp.payments.set('pay_A', { id: 'pay_A', entity: 'payment', order_id: o.orderId, amount: o.amount, currency: 'INR', status: 'authorized', method: 'upi' });
  const bad = await call('POST', '/api/sme/billing/verify', { orderId: o.orderId, paymentId: 'pay_A', signature: sig('wrong', `${o.orderId}|pay_A`) }, owner);
  assert.equal(bad.status, 400); assert.equal(bad.body.error, 'BAD_SIGNATURE');
  const good = { orderId: o.orderId, paymentId: 'pay_A', signature: sig(KEY_SECRET, `${o.orderId}|pay_A`) };
  assert.equal((await call('POST', '/api/sme/billing/verify', good, prep)).status, 403);
  const v = await call('POST', '/api/sme/billing/verify', good, owner);
  assert.equal(v.status, 200, v.text); assert.equal(v.body.status, 'paid'); assert.equal(v.body.applied, true);
  assert.ok(rzp.calls.includes('POST /payments/pay_A/capture'));               // authorised only → captured by us
  const today = B.todayIn(), fy = B.invoiceFy(today);
  assert.equal(v.body.invoiceNo, B.invoiceNo('SME', fy, 1));
  assert.equal(await expiryOf(sme), B.addYear(today));
  const t = (await p.query(`SELECT t.plan, t.price, s.plan_id FROM tenant t JOIN sme_company s ON s.tenant_id = t.id WHERE t.id = $1`, [sme])).rows[0];
  assert.deepEqual([t.plan, Number(t.price), t.plan_id], ['starter', 2999, 'basic']);
  assert.equal((await p.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'sme.billing.paid' AND tenant_id = $1`, [sme])).rows[0].n, 1);

  // the same payment again: through the page, then through the webhook — nothing changes
  const again = await call('POST', '/api/sme/billing/verify', good, owner);
  assert.equal(again.body.applied, false);
  const w = await hook('payment.captured', rzp.payments.get('pay_A'));
  assert.equal(w.statusCode, 200); assert.equal(w.json().status, 'already');
  assert.equal(await expiryOf(sme), B.addYear(today));
  assert.equal((await p.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'sme.billing.paid' AND tenant_id = $1`, [sme])).rows[0].n, 1);

  // the invoice: Maharashtra buyer, Maharashtra seller → CGST + SGST
  const pay = (await call('GET', '/api/sme/billing', undefined, owner)).body.payments.find((x: any) => x.rp_payment_id === 'pay_A');
  const inv = (await call('GET', `/api/sme/billing/invoice/${pay.id}`, undefined, owner)).body.invoice;
  assert.equal(inv.number, v.body.invoiceNo); assert.equal(inv.intra, true); assert.equal(inv.cgst, 26991); assert.equal(inv.igst, 0); assert.equal(inv.total, 353882);
  assert.equal(inv.seller.gstin, ENV.SME_SELLER_GSTIN);
  assert.equal((await call('GET', `/api/sme/billing/invoice/${pay.id}`, undefined, ownerB)).status, 404);   // another company cannot see it
});

test('API: webhook alone applies a payment (browser closed), extends from the current expiry; next invoice number', async () => {
  const before = await expiryOf(sme);
  const o = (await call('POST', '/api/sme/billing/order', { plan: 'plus' }, owner)).body;
  const pay = { id: 'pay_B', entity: 'payment', order_id: o.orderId, amount: o.amount, currency: 'INR', status: 'captured', method: 'card' };
  const forged = await app.inject({ method: 'POST', url: '/api/public/sme/billing/webhook', payload: JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: pay } } }), headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig('nope', 'x') } });
  assert.equal(forged.statusCode, 400);
  const tampered = { ...pay, amount: 100 };
  assert.equal((await hook('payment.captured', tampered)).json().status, 'mismatch');
  const w = await hook('payment.captured', pay);
  assert.equal(w.statusCode, 200); assert.equal(w.json().status, 'applied');
  assert.equal(await expiryOf(sme), B.addYear(before));
  assert.equal((await hook('order.paid', pay)).json().status, 'already');
  const list = (await call('GET', '/api/sme/billing', undefined, owner)).body;
  assert.equal(list.current.planId, 'plus');
  const fy = B.invoiceFy(B.todayIn());
  assert.equal(list.payments.find((x: any) => x.rp_payment_id === 'pay_B').invoice_no, B.invoiceNo('SME', fy, 2));
});

test('API: a buyer in another state pays IGST; GSTIN must match the state; console lists every payment', async () => {
  const bad = await call('PUT', '/api/sme/billing/details', { gstin: '27AAACS1234F1Z5' }, ownerB);
  assert.equal(bad.status, 400);
  assert.equal((await call('PUT', '/api/sme/billing/details', { gstin: '24AAACS1234F1Z5', address: 'Ring Road, Surat' }, ownerB)).status, 200);
  const o = (await call('POST', '/api/sme/billing/order', { plan: 'basic' }, ownerB)).body;
  const pay = { id: 'pay_C', entity: 'payment', order_id: o.orderId, amount: o.amount, currency: 'INR', status: 'captured', method: 'netbanking' };
  assert.equal((await hook('payment.captured', pay)).json().status, 'applied');
  const row = (await call('GET', '/api/sme/billing', undefined, ownerB)).body.payments[0];
  const inv = (await call('GET', `/api/sme/billing/invoice/${row.id}`, undefined, ownerB)).body.invoice;
  assert.equal(inv.intra, false); assert.equal(inv.igst, 53982); assert.equal(inv.buyer.gstin, '24AAACS1234F1Z5'); assert.match(inv.placeOfSupply, /Gujarat \(24\)/);
  assert.equal(inv.number, B.invoiceNo('SME', B.invoiceFy(B.todayIn()), 3));     // one series for the platform
  const con = await call('GET', '/api/platform/sme/payments', undefined, admin);
  assert.equal(con.status, 200); assert.equal(con.body.payments.filter((x: any) => x.status === 'paid').length, 3);
  assert.equal((await call('GET', '/api/platform/sme/payments', undefined, owner)).status, 403);
});

test('API: the billing page alone gets the checkout policy; not configured → no online payment', async () => {
  const r = await app.inject({ method: 'GET', url: '/sme/billing' });
  const h = String(r.headers['content-security-policy']);
  assert.match(h, /script-src 'self' https:\/\/checkout\.razorpay\.com/);
  assert.doesNotMatch(String((await app.inject({ method: 'GET', url: '/sme/home' })).headers['content-security-policy']), /razorpay/);
  setEnv(false);
  try {
    const g = (await call('GET', '/api/sme/billing', undefined, owner)).body;
    assert.equal(g.online, false); assert.equal(g.keyId, null);
    assert.equal((await call('POST', '/api/sme/billing/order', { plan: 'basic' }, owner)).status, 503);
    assert.doesNotMatch(String((await app.inject({ method: 'GET', url: '/sme/billing' })).headers['content-security-policy']), /razorpay/);
    assert.ok((await call('GET', '/api/platform/sme/payments', undefined, admin)).body.missing.includes('RAZORPAY_KEY_ID'));
  } finally { setEnv(true); }
});
