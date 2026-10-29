/**
 * EKOTRACE SME open pages (no sign-in).
 *
 *   GET  /api/public/sme/info                     whether self-service sign-up is open (SME_SIGNUP=on and e-mail set up)
 *   POST /api/public/sme/signup · /signup/confirm self-service sign-up, confirmed by e-mail (as the CBAM tool)
 *   GET  /api/public/sme/grievance/:token         the worker grievance page behind a company's QR code
 *   POST /api/public/sme/grievance/:token         send a grievance (anonymous; rate-limited)
 */
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { platformTx } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { appLink, mailOn, queueEmail } from '../lib/mail.js';
import { hashPassword, passwordProblem } from '../lib/password.js';
import { STATES } from '../lib/sme/company.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const smeSignupOpen = () => /^(on|1|true|yes)$/i.test(process.env.SME_SIGNUP ?? '') && mailOn();
const hits = new Map<string, { at: number; n: number }>();
function limit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now(), w = hits.get(key);
  if (!w || now - w.at > windowMs) { hits.set(key, { at: now, n: 1 }); return; }
  if (++w.n > max) throw new AppError('Too many tries: wait a while and try again', 429, 'RATE_LIMITED');
}
const CATEGORIES = ['Safety', 'Wages', 'Harassment', 'Facilities', 'Other'];

export async function smePublicRoutes(app: FastifyInstance) {
  app.get('/api/public/sme/info', async () => ({ signup: smeSignupOpen(), states: STATES }));

  app.post('/api/public/sme/signup', async (req) => {
    if (!smeSignupOpen()) throw new AppError('Sign-up is not open yet. Contact the EKOTRACE team for an account.', 403, 'SIGNUP_CLOSED');
    limit(`smesu:${req.ip}`, 5, 3600_000);
    const b = z.object({
      company: z.string().trim().min(2).max(160), sector: z.enum(['mfg', 'svc']), industry: z.string().trim().max(160).default(''), state: z.enum(STATES as [string, ...string[]]),
      name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(190), phone: z.string().trim().max(30).optional(),
      accept: z.literal(true, { message: 'Accept the terms to continue' }),
    }).parse(req.body);
    limit(`smesue:${b.email}`, 3, 3600_000);
    const token = randomBytes(32).toString('base64url');
    await platformTx(async (c) => {
      // the same answer whether or not the address has an account (no account discovery)
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = $1', [b.email])).rowCount) {
        await queueEmail(c, null, b.email, 'EKOTRACE SME: you already have an account', 'Someone (maybe you) tried to sign up with this address. You already have an account: sign in at the EKOTRACE SME page.');
        return;
      }
      await c.query(`INSERT INTO sme_signup (company, sector, industry, state, name, email, phone, token_hash, expires_at, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '2 days', $9)`,
        [b.company, b.sector, b.industry, b.state, b.name, b.email, b.phone ?? null, sha(token), req.ip]);
      const link = appLink(`/sme-start?token=${token}`) ?? `/sme-start?token=${token}`;
      await queueEmail(c, null, b.email, 'EKOTRACE SME: confirm your e-mail', `Hello ${b.name},\n\nConfirm your e-mail and choose a password to open the EKOTRACE SME account for ${b.company}:\n\n${link}\n\nThe link is valid for 2 days. If you did not ask for this, ignore this message.\n`);
    });
    return { ok: true, message: 'Check your e-mail: we sent a link to confirm the address and choose a password.' };
  });

  app.post('/api/public/sme/signup/confirm', async (req) => {
    limit(`smesuc:${req.ip}`, 10);
    const b = z.object({ token: z.string().min(20).max(100), password: z.string().min(1).max(200) }).parse(req.body);
    const p = passwordProblem(b.password);
    if (p) throw new AppError(p);
    const hash = await hashPassword(b.password);
    return platformTx(async (c) => {
      const s = (await c.query(`SELECT * FROM sme_signup WHERE token_hash = $1`, [sha(b.token)])).rows[0];
      if (!s || s.done_tenant || new Date(s.expires_at) < new Date()) throw new AppError('This link is not valid any more: sign up again', 400, 'BAD_TOKEN');
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [s.email])).rowCount) throw new AppError('This e-mail already has an account: sign in', 409, 'DUPLICATE');
      const t = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, access_expiry, currency, timezone, products) VALUES ($1,'IN','AR5','trial',(current_date + interval '1 year')::date,'INR','Asia/Kolkata','{sme}') RETURNING id`, [s.company])).rows[0];
      await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'IN')`, [t.id, s.company]);
      await c.query(`INSERT INTO sme_company (tenant_id, sector, industry, state) VALUES ($1,$2,$3,$4)`, [t.id, s.sector, s.industry, s.state]);
      const u = (await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,'super_admin',$4,false) RETURNING id`, [t.id, s.email, s.name, hash])).rows[0];
      await c.query(`UPDATE sme_signup SET done_tenant = $2 WHERE id = $1`, [s.id, t.id]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'company.signup','tenant',$1::text,$4,$5)`,
        [t.id, u.id, s.name, JSON.stringify({ company: s.company, products: ['sme'], plan: 'trial' }), req.ip]);
      return { ok: true, email: s.email };
    });
  });

  app.get('/api/public/sme/grievance/:token', async (req) => {
    limit(`smegv:${req.ip}`, 60);
    const token = z.string().regex(/^[0-9a-f]{16}$/).parse((req.params as { token: string }).token);
    const r = await platformTx(async (c) => (await c.query(`SELECT t.name FROM sme_company s JOIN tenant t ON t.id = s.tenant_id WHERE s.grievance_token = $1 AND t.status = 'active'`, [token])).rows[0]);
    if (!r) throw new AppError('This QR code is not valid.', 404, 'NOT_FOUND');
    return { company: r.name, categories: CATEGORIES };
  });
  app.post('/api/public/sme/grievance/:token', async (req) => {
    limit(`smegp:${req.ip}`, 5, 3600_000);
    const token = z.string().regex(/^[0-9a-f]{16}$/).parse((req.params as { token: string }).token);
    const b = z.object({ text: z.string().trim().min(5, 'Write a few words about the problem').max(2000), category: z.enum(CATEGORIES as [string, ...string[]]).default('Other'), language: z.string().max(5).optional() }).parse(req.body);
    await platformTx(async (c) => {
      const t = (await c.query(`SELECT s.tenant_id FROM sme_company s JOIN tenant t ON t.id = s.tenant_id WHERE s.grievance_token = $1 AND t.status = 'active'`, [token])).rows[0];
      if (!t) throw new AppError('This QR code is not valid.', 404, 'NOT_FOUND');
      await c.query(`INSERT INTO sme_grievance (tenant_id, category, text, language) VALUES ($1,$2,$3,$4)`, [t.tenant_id, b.category, b.text, b.language ?? null]);
      // no IP or personal data is stored with the grievance; the audit line records only that one arrived
      await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, entity) VALUES ($1,'Worker (QR page)','sme.grievance.received','sme_grievance')`, [t.tenant_id]);
    });
    return { ok: true, message: 'Thank you. Your message has been sent to the company. धन्यवाद, आपका संदेश कंपनी को भेज दिया गया है।' };
  });
}
