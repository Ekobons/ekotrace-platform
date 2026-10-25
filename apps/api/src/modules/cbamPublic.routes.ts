/**
 * Open parts of the CBAM tool (no company session):
 *
 *   GET  /api/public/cbam/info                       name of the CBAM tool, whether self-service sign-up is open
 *   GET  /api/public/cbam/cn?q=                      CN codes covered by CBAM (code or words)
 *   POST /api/public/cbam/calc                       free calculator: CN code, country, tonnes (and actual SEE) → certificates
 *                                                    and cost per year to 2034, default value vs actual
 *   POST /api/public/cbam/signup · /signup/confirm   self-service sign-up (setting CBAM_SIGNUP=on), confirmed by e-mail
 *
 *   Supplier page (/cbam-supplier), signed in with the request's e-mail and access code (header x-cbam-supplier):
 *   POST /api/public/cbam/supplier/login · /logout · GET /me · POST /template (the EU template, .xlsx) · /form · /message
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { CATEGORIES, cbamFactor, cnInfo, countsIndirect, markup } from '../lib/cbam.js';
import { calculate, commLists, fromWorkbook, sharedGoods, type SharedGoods } from '../lib/cbamComm.js';
import { appLink, mailOn, queueEmail } from '../lib/mail.js';
import { notify } from '../lib/notify.js';
import { PRODUCT, brandPack } from '../lib/brand.js';
import { hashPassword, passwordProblem } from '../lib/password.js';
import { localeOf } from '../lib/locale.js';
import { cleanCode } from './cbamSuite.routes.js';
import { benchmarkFor, defaultFor, loadRefs, routeLetters } from '../lib/cbamValues.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SESSION_H = 8;
export const cbamToolName = () => ((brandPack as { cbam?: { name?: string } } | null)?.cbam?.name ?? `${PRODUCT} CBAM`);
export const signupOpen = () => /^(on|1|true|yes)$/i.test(process.env.CBAM_SIGNUP ?? '');

const hits = new Map<string, { at: number; n: number }>();
function limit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now(), w = hits.get(key);
  if (!w || now - w.at > windowMs) { hits.set(key, { at: now, n: 1 }); return; }
  if (++w.n > max) throw new AppError('Too many tries: wait a minute and try again', 429, 'RATE_LIMITED');
}

// ------------------------------------------------------------------ CN codes --
type CnRow = { cn: string; name: string; category: string; sector: string };
let cnList: CnRow[] | null = null;
function cnAll(): CnRow[] {
  if (cnList) return cnList;
  const L = commLists();
  cnList = L.goods.flatMap((g) => g.cn.map((cn) => ({ cn, name: L.cnNames[cn] ?? '', category: g.name.trim(), sector: cnInfo(cn)?.sector ?? '' })));
  return cnList;
}

// ------------------------------------------------------------------ supplier session --
async function supplierSession(req: FastifyRequest) {
  const tok = String(req.headers['x-cbam-supplier'] ?? '');
  if (!/^[a-f0-9]{64}$/.test(tok)) throw new AppError('Sign in again', 401, 'UNAUTHENTICATED');
  return platformTx(async (c) => {
    const s = (await c.query(`SELECT s.tenant_id, q.id, q.status, q.contact_email, p.name AS supplier, t.name AS company FROM cbam_supplier_session s JOIN cbam_request q ON q.id = s.request_id
                                JOIN cbam_supplier p ON p.id = q.supplier_id JOIN tenant t ON t.id = q.tenant_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(tok)])).rows[0];
    if (!s || s.status === 'withdrawn') throw new AppError('Sign in again', 401, 'UNAUTHENTICATED');
    return { tenant: s.tenant_id as string, id: s.id as string, status: s.status as string, email: s.contact_email as string, supplier: s.supplier as string, company: s.company as string };
  });
}
const plog = (c: Tx, tenant: string, name: string, action: string, id: string, detail: unknown, ip: string) =>
  c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1, NULL, $2, $3, 'cbam_request', $4, $5, $6)`, [tenant, name, action, id, JSON.stringify(detail), ip]);

/** Save an answer and tell the company's CBAM staff. */
async function saveAnswer(k: Awaited<ReturnType<typeof supplierSession>>, via: 'template' | 'form', data: SharedGoods, filename: string | null, ip: string) {
  return tenantTx(k.tenant, async (c) => {
    if (k.status === 'accepted') throw new AppError('This request was already accepted');
    const r = (await c.query(`INSERT INTO cbam_response (tenant_id, request_id, via, from_name, from_email, filename, data) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [k.tenant, k.id, via, k.supplier, k.email, filename, JSON.stringify(data)])).rows[0];
    await c.query(`UPDATE cbam_request SET status = 'answered', updated_at = now() WHERE id = $1`, [k.id]);
    const staff = (await c.query(`SELECT id FROM app_user WHERE tenant_id = $1 AND role IN ('super_admin', 'admin', 'manager') AND NOT disabled`, [k.tenant])).rows.map((u) => u.id);
    await notify(c, k.tenant, staff, { kind: 'cbam', title: `CBAM data from ${k.supplier}`, body: `${data.goods.length} good(s) sent${via === 'template' ? ' with the EU template' : ''}. Review and accept.`, link: `/cbam/suppliers?tab=requests&request=${k.id}` });
    await plog(c, k.tenant, `${k.email} (supplier: ${k.supplier})`, 'cbam.supplier.answer', k.id, { via, goods: data.goods.length, filename }, ip);
    return { id: r.id, goods: data.goods.length };
  });
}

export async function cbamPublicRoutes(app: FastifyInstance) {
  app.get('/api/public/cbam/info', async () => ({ name: cbamToolName(), product: PRODUCT, signup: signupOpen() && mailOn() }));

  app.get('/api/public/cbam/cn', async (req) => {
    limit(`cn:${req.ip}`, 120);
    const q = z.object({ q: z.string().trim().max(80).default('') }).parse(req.query);
    const s = q.q.toLowerCase().replace(/\s+/g, ' ');
    const digits = s.replace(/[^0-9]/g, '');
    const all = cnAll();
    const hits2 = !s ? all.slice(0, 40) : all.filter((r) => (digits.length >= 2 && r.cn.startsWith(digits)) || (!/^\d+$/.test(s.replace(/\s/g, '')) && (r.name.toLowerCase().includes(s) || r.category.toLowerCase().includes(s))));
    return { total: hits2.length, codes: hits2.slice(0, 60) };
  });

  app.post('/api/public/cbam/calc', async (req) => {
    limit(`calc:${req.ip}`, 60);
    const b = z.object({
      cn: z.string().trim().transform((s) => s.replace(/\D/g, '')).refine((s) => /^\d{4,10}$/.test(s), 'A CN code'), country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()),
      tonnes: z.number().positive().max(1e9), seeDirect: z.number().min(0).max(100).nullable().optional(), seeIndirect: z.number().min(0).max(100).nullable().optional(),
      price: z.number().min(0).max(10000).nullable().optional(), from: z.number().int().min(2026).max(2034).default(2026),
    }).parse(req.body);
    const info = cnInfo(b.cn);
    if (!info) throw new AppError(`CN ${b.cn} is not a CBAM good`);
    const R = await platformTx((c) => loadRefs(c, [b.country], true));
    const latestPrice = R.filter((r) => r.kind === 'price').sort((x, y) => (y.year - x.year) || ((y.quarter ?? 0) - (x.quarter ?? 0)))[0] ?? null;
    const price = b.price ?? latestPrice?.value ?? null;
    const counts = countsIndirect(info.sector);
    const actual = b.seeDirect == null ? null : b.seeDirect + (counts ? b.seeIndirect ?? 0 : 0);
    const years = [];
    for (let y = b.from; y <= 2034; y++) {
      const dv = defaultFor(R, b.cn, b.country, y);
      const bm = benchmarkFor(R, b.cn, y, routeLetters(dv?.route));
      const sefa = (bm?.value ?? 0) * cbamFactor(y);
      const defSee = dv ? dv.value * (1 + markup(y, info.sector)) : null;
      const certDefault = defSee == null ? null : Math.max(0, defSee - sefa) * b.tonnes;
      const certActual = actual == null ? null : Math.max(0, actual - sefa) * b.tonnes;
      years.push({ year: y, cbamFactor: cbamFactor(y), markup: markup(y, info.sector), defaultValue: dv?.value ?? null, defaultDirect: dv?.direct ?? null, defaultIndirect: dv?.indirect ?? null, defaultIndicative: dv?.indicative ?? null, route: dv?.route ?? null, benchmark: bm?.value ?? null,
        notes: [dv?.note, bm?.note].filter((n): n is string => !!n),
        seeDefault: defSee, seeActual: actual, certDefault, certActual, costDefault: certDefault == null || price == null ? null : certDefault * price, costActual: certActual == null || price == null ? null : certActual * price });
    }
    return {
      cn: b.cn, name: commLists().cnNames[b.cn] ?? '', category: CATEGORIES[info.category]?.name ?? info.category, sector: info.sector, indirectCounts: counts, country: b.country, tonnes: b.tonnes,
      price, priceSource: b.price != null ? 'your price' : latestPrice ? `${latestPrice.source} (Q${latestPrice.quarter} ${latestPrice.year})` : null, years,
      thresholdNote: info.sector === 'electricity' || info.sector === 'hydrogen' ? 'Electricity and hydrogen are covered whatever the quantity.' : 'Importers bringing in 50 tonnes or less of CBAM goods in a year (all together) are exempt.',
      indicative: years.some((y) => y.defaultIndicative), note: 'Estimate only. Default values and benchmarks are the ones loaded in the tool; check them against the official publication.',
    };
  });

  // ------------------------------------------------------------------ sign-up --
  app.post('/api/public/cbam/signup', async (req) => {
    if (!signupOpen()) throw new AppError('Sign-up is not open: contact us for an account', 403, 'SIGNUP_CLOSED');
    limit(`su:${req.ip}`, 5, 3600_000);
    const b = z.object({
      company: z.string().trim().min(2).max(160), country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()), role: z.enum(['importer', 'exporter', 'both']),
      name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(190), accept: z.literal(true, { message: 'Accept the terms to continue' }),
    }).parse(req.body);
    limit(`sue:${b.email}`, 3, 3600_000);
    const token = randomBytes(32).toString('base64url');
    await platformTx(async (c) => {
      const exists = (await c.query('SELECT 1 FROM app_user WHERE lower(email) = $1', [b.email])).rowCount;
      // the same answer whether or not the address has an account (no account discovery); an existing account gets a hint instead
      if (exists) { await queueEmail(c, null, b.email, `${cbamToolName()}: you already have an account`, `Someone (maybe you) tried to sign up with this address. You already have an account: sign in, or reset your password from the sign-in page.`); return; }
      await c.query(`INSERT INTO cbam_signup (company, country, role, name, email, token_hash, expires_at, ip) VALUES ($1,$2,$3,$4,$5,$6, now() + interval '2 days', $7)`, [b.company, b.country, b.role, b.name, b.email, sha(token), req.ip]);
      const link = appLink(`/cbam-start?token=${token}`) ?? `/cbam-start?token=${token}`;
      await queueEmail(c, null, b.email, `${cbamToolName()}: confirm your e-mail`, `Hello ${b.name},\n\nConfirm your e-mail and choose a password to open your ${cbamToolName()} account for ${b.company}:\n\n${link}\n\nThe link is valid for 2 days. If you did not ask for this, ignore this message.\n`);
    });
    return { ok: true, message: 'Check your e-mail: we sent a link to confirm the address and choose a password.' };
  });
  app.post('/api/public/cbam/signup/confirm', async (req) => {
    limit(`suc:${req.ip}`, 10);
    const b = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) }).parse(req.body);
    const p = passwordProblem(b.password);
    if (p) throw new AppError(p);
    const hash = await hashPassword(b.password);
    return platformTx(async (c) => {
      const s = (await c.query(`SELECT * FROM cbam_signup WHERE token_hash = $1`, [sha(b.token)])).rows[0];
      if (!s || s.done_tenant || new Date(s.expires_at) < new Date()) throw new AppError('This link is not valid any more: sign up again', 400, 'BAD_TOKEN');
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [s.email])).rowCount) throw new AppError('This e-mail already has an account: sign in', 409, 'DUPLICATE');
      const loc = localeOf(s.country);
      const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, access_expiry, currency, timezone, products) VALUES ($1,$2,'AR6','trial',(current_date + interval '30 days')::date,$3,$4,'{cbam}') RETURNING id`,
        [s.company, s.country, loc.currency, loc.timezone])).rows[0];
      await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,$3)`, [t.id, s.company, s.country]);
      await c.query(`INSERT INTO cbam_settings (tenant_id, role, updated_name) VALUES ($1,$2,$3)`, [t.id, s.role, s.name]);
      const u = (await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,'super_admin',$4,false) RETURNING id`, [t.id, s.email, s.name, hash])).rows[0];
      await c.query(`UPDATE cbam_signup SET done_tenant = $2 WHERE id = $1`, [s.id, t.id]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'company.signup','tenant',$1::text,$4,$5)`,
        [t.id, u.id, s.name, JSON.stringify({ company: s.company, role: s.role, products: ['cbam'], plan: 'trial' }), req.ip]);
      return { ok: true, email: s.email };
    });
  });

  // ------------------------------------------------------------------ supplier page --
  app.post('/api/public/cbam/supplier/login', async (req) => {
    limit(`csl:${req.ip}`, 10);
    const b = z.object({ email: z.string().trim().toLowerCase().email().max(190), code: z.string().max(40) }).parse(req.body);
    limit(`csle:${b.email}`, 10);
    const code = cleanCode(b.code);
    return platformTx(async (c) => {
      const rows = (await c.query(`SELECT q.id, q.tenant_id, q.code_hash, q.code_expires, p.name AS supplier, t.name AS company FROM cbam_request q JOIN cbam_supplier p ON p.id = q.supplier_id JOIN tenant t ON t.id = q.tenant_id
                                    WHERE lower(q.contact_email) = $1 AND q.code_hash IS NOT NULL AND q.status <> 'withdrawn' AND t.status = 'active'`, [b.email])).rows;
      const h = Buffer.from(sha(code));
      const r = rows.find((x) => timingSafeEqual(Buffer.from(x.code_hash), h));
      if (!r) throw new AppError('That e-mail and access code do not match. Check the invitation, or ask your customer for a new code.', 401, 'UNAUTHENTICATED');
      if (r.code_expires && new Date(r.code_expires) < new Date()) throw new AppError('This access code has expired: ask your customer for a new one.', 401, 'UNAUTHENTICATED');
      const tok = randomBytes(32).toString('hex');
      await c.query(`DELETE FROM cbam_supplier_session WHERE request_id = $1 AND expires_at < now()`, [r.id]);
      await c.query(`INSERT INTO cbam_supplier_session (token_hash, tenant_id, request_id, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))`, [sha(tok), r.tenant_id, r.id, SESSION_H]);
      await plog(c, r.tenant_id, `${b.email} (supplier: ${r.supplier})`, 'cbam.supplier.login', r.id, {}, req.ip);
      return { token: tok, supplier: r.supplier, company: r.company };
    });
  });
  app.post('/api/public/cbam/supplier/logout', async (req) => {
    const tok = String(req.headers['x-cbam-supplier'] ?? '');
    if (/^[a-f0-9]{64}$/.test(tok)) await platformTx((c) => c.query('DELETE FROM cbam_supplier_session WHERE token_hash = $1', [sha(tok)]));
    return { ok: true };
  });
  app.get('/api/public/cbam/supplier/me', async (req) => {
    const k = await supplierSession(req);
    return tenantTx(k.tenant, async (c) => {
      const r = (await c.query(`SELECT q.year, q.quarter, q.cn_codes, q.message, q.due_date, q.status, q.purpose, p.name AS supplier, p.installation, p.registry_id, p.country FROM cbam_request q JOIN cbam_supplier p ON p.id = q.supplier_id WHERE q.id = $1`, [k.id])).rows[0];
      const responses = (await c.query(`SELECT id, via, filename, data, status, review_note, reviewed_at, submitted_at FROM cbam_response WHERE request_id = $1 ORDER BY submitted_at DESC`, [k.id])).rows;
      const messages = (await c.query(`SELECT side, author, body, at FROM cbam_request_message WHERE request_id = $1 ORDER BY at`, [k.id])).rows;
      const names = commLists().cnNames;
      return { ...r, company: k.company, email: k.email, cnNames: Object.fromEntries((r.cn_codes as string[]).map((x) => [x, names[x] ?? cnAll().find((y) => y.cn.startsWith(x))?.name ?? ''])), responses, messages, tool: cbamToolName(), editable: r.status !== 'accepted' };
    });
  });
  app.post('/api/public/cbam/supplier/template', { bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    const k = await supplierSession(req);
    limit(`cst:${k.id}`, 20);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'communication.xlsx')).slice(0, 200);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('Send the filled template (.xlsx)');
    let data: SharedGoods;
    try {
      const d = fromWorkbook(req.body);
      data = sharedGoods(d);
      const problems = calculate(d).checks.filter((x) => x.level === 'error').length;
      if (!data.goods.length) throw new AppError('The template has no goods (Summary_Products) with CN codes');
      if (data.goods.every((g) => g.seeDirect == null)) throw new AppError(`The template has no specific embedded emissions yet${problems ? ` (${problems} parts are incomplete)` : ''}`);
    } catch (e) { throw e instanceof AppError ? e : new AppError('Could not read this file — send the CBAM communication template for installations as .xlsx'); }
    return saveAnswer(k, 'template', data, filename, req.ip);
  });
  app.post('/api/public/cbam/supplier/form', async (req) => {
    const k = await supplierSession(req);
    const n = z.number().finite().min(0).max(100).nullable().optional();
    const b = z.object({
      installation: z.object({ name: z.string().trim().min(2).max(200), country: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()), registryId: z.string().trim().max(80).default(''), unlocode: z.string().trim().max(10).default(''), city: z.string().trim().max(120).default('') }),
      verified: z.boolean().default(false),
      goods: z.array(z.object({ cn: z.string().trim().transform((s) => s.replace(/\D/g, '')).refine((s) => /^\d{4,8}$/.test(s), 'CN code'), name: z.string().trim().max(200).default(''), seeDirect: z.number().finite().min(0).max(100), seeIndirect: n, defaultShare: n })).min(1).max(100),
    }).parse(req.body);
    const data: SharedGoods = { period: { start: null, end: null }, installation: b.installation, verified: b.verified,
      goods: b.goods.map((g) => ({ cn: g.cn, name: g.name, seeDirect: g.seeDirect, seeIndirect: g.seeIndirect ?? 0, defaultShare: g.defaultShare == null ? null : g.defaultShare / 100, embeddedElec: null, elecSource: '', category: commLists().goods.find((x) => x.cn.includes(g.cn))?.name.trim() ?? '', cpDue: null, rebate: null, currency: '' })) };
    return saveAnswer(k, 'form', data, null, req.ip);
  });
  app.post('/api/public/cbam/supplier/message', async (req) => {
    const k = await supplierSession(req);
    limit(`csm:${k.id}`, 20);
    const b = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    return tenantTx(k.tenant, async (c) => {
      await c.query(`INSERT INTO cbam_request_message (tenant_id, request_id, side, author, body) VALUES ($1,$2,'supplier',$3,$4)`, [k.tenant, k.id, `${k.supplier} (${k.email})`, b.body]);
      const staff = (await c.query(`SELECT id FROM app_user WHERE tenant_id = $1 AND role IN ('super_admin', 'admin', 'manager') AND NOT disabled`, [k.tenant])).rows.map((u) => u.id);
      await notify(c, k.tenant, staff, { kind: 'cbam', title: `Message from ${k.supplier}`, body: b.body.slice(0, 200), link: `/cbam/suppliers?tab=requests&request=${k.id}` });
      return { ok: true };
    });
  });
}
