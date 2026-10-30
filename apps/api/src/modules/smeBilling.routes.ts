/**
 * EKOTRACE SME plan & billing (online payment with Razorpay, GST tax invoices).
 *
 *   GET  /api/sme/billing                   plans with GST for this company, current plan and expiry, payments, whether online payment is on
 *   PUT  /api/sme/billing/details           buyer details for invoices: GSTIN, billing address, billing e-mail (owner / admin)
 *   POST /api/sme/billing/order             start a payment: Razorpay order for a plan (amount from the 'plans' setting, never from the browser)
 *   POST /api/sme/billing/verify            after Checkout: payment signature checked, payment captured if needed, then applied once
 *   POST /api/sme/billing/failed            Checkout reported a failed attempt (kept as the reason shown in the list)
 *   GET  /api/sme/billing/invoice/:id       tax invoice of a paid payment
 *   GET  /api/platform/sme/payments         platform console: every payment, and what is missing to switch online payment on
 *   GET  /api/platform/sme/payments/:id/invoice
 *   POST /api/public/sme/billing/webhook    Razorpay webhook (no session; X-Razorpay-Signature over the raw body)
 *
 * Only the company's super admin or admin can pay. Applying is idempotent (one payment id, one application).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx } from '../db/pool.js';
import { audit, requirePlatformAdmin, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { needProduct } from '../lib/products.js';
import { PRODUCT } from '../lib/brand.js';
import { active } from '../lib/sme/settings.js';
import { ensureCompany } from '../lib/sme/company.js';
import {
  GSTIN_RE, GST_RATE, GST_STATE, applyPayment, buyerState, capturePayment, createOrder, fetchPayment, invoiceOf, missingSetup, onlineOn, paidPlans,
  priceOf, razorpay, seller, stateOfCode, supportEmail, todayIn, verifyPaymentSignature, verifyWebhookSignature,
} from '../lib/sme/billing.js';

const PAYERS = ['super_admin', 'admin'];
const canPay = (req: FastifyRequest) => { if (!PAYERS.includes(req.user.role)) throw forbidden('Only the company’s owner or an admin can pay for the plan.'); };
const PAY_COLS = `id, plan_id, plan_name, base_paise, cgst_paise, sgst_paise, igst_paise, amount_paise, gst_rate, status, rp_order_id, rp_payment_id, method, failure, via,
  period_from, period_to, invoice_no, created_name, created_at, paid_at`;
const uuid = (v: unknown) => { if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) throw notFound('Payment'); return v; };
const orders = new Map<string, number[]>();
function orderLimit(tenant: string) {   // a few checkouts an hour per company is plenty
  const now = Date.now(), list = (orders.get(tenant) ?? []).filter((t) => now - t < 3600_000);
  if (list.length >= 15) throw new AppError('Too many payment attempts in the last hour. Wait a while, or contact us.', 429, 'RATE_LIMITED');
  list.push(now); orders.set(tenant, list);
}

export async function smeBillingRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- the company's own page --
  await app.register(async (sme) => {
    needProduct(sme, 'sme');

    sme.get('/api/sme/billing', async (req) => {
      const t = requireTenant(req);
      const plansSetting = (await active()).plans ?? {};
      const s = seller();
      return tenantTx(t, async (c) => {
        const co = await ensureCompany(c, t);
        const ten = (await c.query(`SELECT plan, access_expiry, billing_email FROM tenant WHERE id = $1`, [t])).rows[0];
        const bState = buyerState(co.state, co.gstin);
        const plans = ((plansSetting.items ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, modules: p.modules, ca_validation: !!p.ca_validation,
          price_inr: Number(p.price_inr) || 0, price: Number(p.price_inr) > 0 ? priceOf(Number(p.price_inr), s?.state ?? null, bState) : null }));
        const payments = (await c.query(`SELECT ${PAY_COLS} FROM sme_payment WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [t])).rows;
        const current = plans.find((p) => p.id === co.plan_id) ?? null;
        return {
          online: onlineOn(), keyId: onlineOn() ? razorpay()!.keyId : null, support: supportEmail(), product: `${PRODUCT} SME`, gstRate: GST_RATE,
          sellerState: s?.state ?? null, note: plansSetting.note ?? null,
          company: { name: co.name, state: co.state, gstin: co.gstin, address: co.bill_address, billingEmail: ten.billing_email, gstState: bState },
          current: { planId: co.plan_id, planName: current?.name ?? null, platformPlan: ten.plan, trial: ten.plan === 'trial', expiry: ten.access_expiry, today: todayIn() },
          plans, payments, canPay: PAYERS.includes(req.user.role) && req.user.role !== 'platform_admin',
          canEdit: PAYERS.includes(req.user.role) || req.user.role === 'platform_admin',
        };
      });
    });

    sme.put('/api/sme/billing/details', async (req) => {
      if (![...PAYERS, 'platform_admin'].includes(req.user.role)) throw forbidden('Only the company’s owner or an admin can change billing details.');
      const t = requireTenant(req);
      const b = z.object({
        gstin: z.string().trim().toUpperCase().max(15).nullable().optional(),
        address: z.string().trim().max(400).nullable().optional(),
        billingEmail: z.string().trim().toLowerCase().max(190).nullable().optional(),
      }).parse(req.body);
      const gstin = b.gstin ? b.gstin : null;
      if (gstin && !GSTIN_RE.test(gstin)) throw new AppError('A GSTIN has 15 characters, like 27AAACG1234F1Z5. Leave it empty if the company is not registered for GST.');
      if (gstin && !stateOfCode(gstin.slice(0, 2))) throw new AppError('The first two digits of the GSTIN are not a known state code.');
      if (b.billingEmail && !z.string().email().safeParse(b.billingEmail).success) throw new AppError('Enter a valid e-mail address for invoices, or leave it empty.');
      return tenantTx(t, async (c) => {
        const before = await ensureCompany(c, t);
        if (gstin && before.state && GST_STATE[before.state] && GST_STATE[before.state] !== gstin.slice(0, 2)) {
          throw new AppError(`This GSTIN is registered in ${stateOfCode(gstin.slice(0, 2))} but the company’s state is ${before.state}. Check the GSTIN, or change the state in the company profile.`);
        }
        if (b.gstin !== undefined) await c.query(`UPDATE sme_company SET gstin = $2 WHERE tenant_id = $1`, [t, gstin]);
        if (b.address !== undefined) await c.query(`UPDATE sme_company SET bill_address = $2 WHERE tenant_id = $1`, [t, b.address || null]);
        if (b.billingEmail !== undefined) await c.query(`UPDATE tenant SET billing_email = $2 WHERE id = $1`, [t, b.billingEmail || null]);
        await audit(c, req, 'sme.billing.details', 'sme_company', t, { before: { gstin: before.gstin, address: before.bill_address }, after: b });
        return { ok: true };
      });
    });

    sme.post('/api/sme/billing/order', async (req) => {
      canPay(req);
      const t = requireTenant(req);
      const b = z.object({ plan: z.string().min(1).max(30) }).parse(req.body);
      const s = seller();
      if (!onlineOn() || !s) throw new AppError('Online payment is not switched on. Pay by bank transfer: contact us.', 503, 'PAYMENT_OFF');
      const plan = paidPlans((await active()).plans).find((p) => p.id === b.plan);
      if (!plan) throw new AppError('Choose one of the paid plans.', 400, 'BAD_PLAN');
      const info = await tenantTx(t, async (c) => {
        const co = await ensureCompany(c, t);
        const ten = (await c.query(`SELECT access_expiry FROM tenant WHERE id = $1`, [t])).rows[0];
        return { co, expiry: ten.access_expiry as string };
      });
      const limit = new Date(Date.now() + 730 * 86400e3).toISOString().slice(0, 10);
      if (info.expiry && info.expiry > limit) throw new AppError('Your access is already paid for more than two years ahead.', 409, 'PAID_AHEAD');
      orderLimit(t);
      const posState = buyerState(info.co.state, info.co.gstin);
      const price = priceOf(plan.price_inr, s.state, posState);
      const buyer = { name: info.co.name, state: info.co.state || null, gstin: info.co.gstin ?? null, address: info.co.bill_address ?? null, posState };
      const sellerSnap = { ...s, product: `${PRODUCT} SME` };
      const id = (await platformTx(async (c) => (await c.query(`SELECT gen_random_uuid() AS id`)).rows[0].id)) as string;
      const order = await createOrder(price.total, id, { tenant_id: t, plan: plan.id, payment: id });
      if (Number(order.amount) !== price.total) throw new AppError('The payment service returned a different amount. Nothing was charged; try again.', 502, 'PAYMENT_SERVICE');
      await tenantTx(t, async (c) => {
        await c.query(`INSERT INTO sme_payment (id, tenant_id, plan_id, plan_name, base_paise, cgst_paise, sgst_paise, igst_paise, amount_paise, gst_rate, rp_order_id, seller, buyer, created_by, created_name, created_email)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [id, t, plan.id, plan.name, price.base, price.cgst, price.sgst, price.igst, price.total, price.rate, order.id, JSON.stringify(sellerSnap), JSON.stringify(buyer), req.user.id, req.user.name, req.user.email]);
        await audit(c, req, 'sme.billing.order', 'sme_payment', id, { plan: plan.id, amount_inr: price.total / 100, order: order.id });
      });
      return {
        id, orderId: order.id, amount: price.total, currency: 'INR', keyId: razorpay()!.keyId, name: `${PRODUCT} SME`,
        description: `${plan.name} plan — 1 year`, prefill: { name: req.user.name, email: req.user.email },
      };
    });

    sme.post('/api/sme/billing/verify', async (req) => {
      canPay(req);
      const t = requireTenant(req);
      const b = z.object({ orderId: z.string().min(5).max(60), paymentId: z.string().min(5).max(60), signature: z.string().min(10).max(200) }).parse(req.body);
      const k = razorpay();
      if (!k) throw new AppError('Online payment is not switched on.', 503, 'PAYMENT_OFF');
      const row = await tenantTx(t, async (c) => (await c.query(`SELECT id, rp_order_id, amount_paise, status FROM sme_payment WHERE rp_order_id = $1 AND tenant_id = $2`, [b.orderId, t])).rows[0]);
      if (!row) throw notFound('Payment');
      if (!verifyPaymentSignature(row.rp_order_id, b.paymentId, b.signature, k.keySecret)) {
        await tenantTx(t, (c) => audit(c, req, 'sme.billing.bad_signature', 'sme_payment', row.id, { payment: b.paymentId }));
        throw new AppError('This payment could not be confirmed. If money left your account, contact us with the payment reference.', 400, 'BAD_SIGNATURE');
      }
      let pay = await fetchPayment(b.paymentId);
      if (pay.order_id !== row.rp_order_id) throw new AppError('This payment belongs to another order.', 400, 'BAD_PAYMENT');
      if (pay.status === 'authorized') pay = await capturePayment(b.paymentId, Number(row.amount_paise));
      if (pay.status !== 'captured') return { status: 'pending', message: 'Your bank has not confirmed the payment yet. This page updates as soon as it does; you do not need to pay again.' };
      const r = await platformTx((c) => applyPayment(c, { orderId: row.rp_order_id, paymentId: pay.id, amount: Number(pay.amount), currency: pay.currency, method: pay.method ?? null, via: 'checkout', user: { id: req.user.id, name: req.user.name }, ip: req.ip }));
      if (r.status === 'mismatch') throw new AppError('The amount paid does not match the order. Contact us with the payment reference.', 409, 'MISMATCH');
      return { status: 'paid', applied: r.status === 'applied', invoiceNo: r.payment?.invoice_no ?? null, expiry: r.payment?.period_to ?? null };
    });

    sme.post('/api/sme/billing/failed', async (req) => {
      canPay(req);
      const t = requireTenant(req);
      const b = z.object({ orderId: z.string().min(5).max(60), reason: z.string().max(300).default('') }).parse(req.body);
      await tenantTx(t, (c) => c.query(`UPDATE sme_payment SET failure = $3 WHERE rp_order_id = $1 AND tenant_id = $2 AND status <> 'paid'`, [b.orderId, t, b.reason.trim() || 'Payment not completed']));
      return { ok: true };
    });

    sme.get('/api/sme/billing/invoice/:id', async (req) => {
      const t = requireTenant(req), id = uuid((req.params as { id: string }).id);
      const p = await tenantTx(t, async (c) => (await c.query(`SELECT * FROM sme_payment WHERE id = $1 AND tenant_id = $2`, [id, t])).rows[0]);
      if (!p || p.status !== 'paid') throw notFound('Invoice');
      return { invoice: invoiceOf(p) };
    });
  });

  // ---------------------------------------------------------------- platform console --
  await app.register(async (con) => {
    con.addHook('preHandler', async (req) => requirePlatformAdmin(req));
    con.get('/api/platform/sme/payments', async () => platformTx(async (c) => ({
      online: onlineOn(), missing: missingSetup(), support: supportEmail(),
      payments: (await c.query(`SELECT p.id, p.tenant_id, t.name AS company, p.plan_id, p.plan_name, p.amount_paise, p.base_paise, p.cgst_paise + p.sgst_paise + p.igst_paise AS gst_paise,
          p.status, p.rp_order_id, p.rp_payment_id, p.method, p.failure, p.via, p.period_to, p.invoice_no, p.created_name, p.created_at, p.paid_at
        FROM sme_payment p JOIN tenant t ON t.id = p.tenant_id ORDER BY p.created_at DESC LIMIT 500`)).rows,
    })));
    con.get('/api/platform/sme/payments/:id/invoice', async (req) => {
      const id = uuid((req.params as { id: string }).id);
      const p = await platformTx(async (c) => (await c.query(`SELECT * FROM sme_payment WHERE id = $1`, [id])).rows[0]);
      if (!p || p.status !== 'paid') throw notFound('Invoice');
      return { invoice: invoiceOf(p) };
    });
  });
}

/** Razorpay webhook: public (no session), raw body for the signature. Answers 200 quickly for every genuine event. */
export async function smeBillingWebhook(app: FastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/api/public/sme/billing/webhook', async (req, reply) => {
    const k = razorpay();
    if (!k) return reply.code(503).send({ error: 'PAYMENT_OFF', message: 'Online payment is not switched on' });
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !verifyWebhookSignature(raw, req.headers['x-razorpay-signature'] as string | undefined, k.webhookSecret)) {
      return reply.code(400).send({ error: 'BAD_SIGNATURE', message: 'Signature does not match' });
    }
    let ev: any;
    try { ev = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'BAD_JSON', message: 'Not JSON' }); }
    const pay = ev?.payload?.payment?.entity;
    if (!pay?.id || !pay?.order_id) return { ok: true, ignored: true };
    if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
      if (pay.status && pay.status !== 'captured') return { ok: true, ignored: true };
      const r = await platformTx((c) => applyPayment(c, { orderId: pay.order_id, paymentId: pay.id, amount: Number(pay.amount), currency: pay.currency, method: pay.method ?? null, via: 'webhook', ip: req.ip }));
      if (r.status === 'mismatch') req.log.warn({ order: pay.order_id, payment: pay.id }, 'SME payment does not match its order');
      return { ok: true, status: r.status };
    }
    if (ev.event === 'payment.authorized') {
      // manual capture accounts: capture our own orders (the payment.captured event then applies it)
      const row = await platformTx(async (c) => (await c.query(`SELECT amount_paise, status FROM sme_payment WHERE rp_order_id = $1`, [pay.order_id])).rows[0]);
      if (row && row.status !== 'paid' && Number(row.amount_paise) === Number(pay.amount)) await capturePayment(pay.id, Number(pay.amount)).catch(() => undefined);
      return { ok: true };
    }
    if (ev.event === 'payment.failed') {
      const why = String(pay.error_description ?? 'Payment failed').slice(0, 300);
      await platformTx((c) => c.query(`UPDATE sme_payment SET status = 'failed', failure = $2 WHERE rp_order_id = $1 AND status = 'created'`, [pay.order_id, why]));
      return { ok: true };
    }
    return { ok: true, ignored: true };
  });
}
