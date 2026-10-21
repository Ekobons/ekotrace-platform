/**
 * Sign-in, sign-out, "who am I", change password, multi-factor authentication, single sign-on.
 *
 * - Wrong email and wrong password give the same message (no hint which one).
 * - 5 wrong passwords (or codes) lock the account for 15 minutes.
 * - New accounts get a temporary password that must be changed at first sign-in.
 * - Logging out deletes the session on the server, not just the cookie.
 * - MFA (authenticator app, RFC 6238): asked after the password when the person has it set up;
 *   when the company (or, for platform admins, the deployment) requires it, a person without it must
 *   set it up before doing anything else. Ten recovery codes, each usable once.
 * - SSO (OpenID Connect): the company's identity provider signs people in; the email decides the company.
 *   With "SSO only", password sign-in is refused, except for super admins who use MFA (break-glass).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, authenticate, COOKIE, readCookie, SESSION_HOURS, setSessionCookie } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, newToken, passwordProblem, sha256, verifyPassword } from '../lib/password.js';
import { PLANS, type PlanCode } from '../lib/plans.js';
import { checkCode, newSecret, otpauthUri, recoveryCodes } from '../lib/totp.js';
import { decrypt, encrypt } from '../lib/secrets.js';
import { authorizeUrl, discover, emailOf, exchange, newFlow, usedMfa, verifyIdToken } from '../lib/oidc.js';
import { config } from '../config.js';
import { PRODUCT } from '../lib/brand.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
const CHALLENGE_MINUTES = 5;
let dummyHash: Promise<string> | null = null; // compared when the email is unknown, so timing gives nothing away

const BRAND = PRODUCT;
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** What this person's company and role require. */
async function policyOf(c: Tx, u: { id: string; tenant_id: string | null; role: string; mfa_enabled_at: string | null }) {
  const t = u.tenant_id ? (await c.query('SELECT mfa_required FROM tenant WHERE id = $1', [u.tenant_id])).rows[0] : null;
  const sso = u.tenant_id ? (await c.query('SELECT enabled, enforce FROM sso_config WHERE tenant_id = $1', [u.tenant_id])).rows[0] : null;
  return {
    mfaEnabled: !!u.mfa_enabled_at,
    mfaRequired: !!t?.mfa_required || (u.role === 'platform_admin' && config.requireAdminMfa),
    ssoOnly: !!(sso?.enabled && sso?.enforce),
  };
}

async function openSession(req: FastifyRequest, reply: FastifyReply, user: { id: string; tenant_id: string | null; name: string }, method: string, enrol = false, detail?: unknown) {
  const token = newToken();
  await platformTx(async (c) => {
    await c.query(`INSERT INTO session (token_hash, user_id, expires_at, ip, user_agent, method, mfa_enrol) VALUES ($1,$2, now() + make_interval(hours => $3), $4, $5, $6, $7)`,
      [sha256(token), user.id, SESSION_HOURS, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300), method, enrol]);
    await c.query('UPDATE app_user SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
    await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.tenant_id, user.id, user.name, method === 'sso' ? 'login.sso' : 'login', JSON.stringify({ method, ...(detail as object ?? {}) }), req.ip]);
    await c.query(`DELETE FROM session WHERE expires_at < now()`); // tidy up old sessions
    await c.query(`DELETE FROM login_challenge WHERE expires_at < now()`);
    await c.query(`DELETE FROM sso_state WHERE expires_at < now()`);
  });
  setSessionCookie(reply, token, req.protocol === 'https');
}

async function failed(c: Tx, req: FastifyRequest, u: { id: string; tenant_id: string | null; name: string }, action: string, detail?: unknown) {
  await c.query(`UPDATE app_user SET failed_logins = failed_logins + 1,
                   locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
                 WHERE id = $1`, [u.id, LOCK_AFTER, LOCK_MINUTES]);
  await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)`, [u.tenant_id, u.id, u.name, action, detail ? JSON.stringify(detail) : null, req.ip]);
}

async function companyOk(tenantId: string | null) {
  if (!tenantId) return;
  const t = await platformTx(async (c) => (await c.query('SELECT status, access_expiry FROM tenant WHERE id = $1', [tenantId])).rows[0]);
  if (t?.status !== 'active') throw new AppError('This company account is suspended. Contact your administrator.', 403, 'SUSPENDED');
  if (t.access_expiry < new Date().toISOString().slice(0, 10)) throw new AppError('This company\'s subscription has expired. Contact your administrator.', 403, 'EXPIRED');
}

export const ssoRedirectUri = (req: FastifyRequest) => `${config.publicUrl ?? `${req.protocol}://${req.headers.host}`}/api/auth/sso/callback`;

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const b = z.object({ email: z.string().email().max(190), password: z.string().min(1).max(200) }).parse(req.body);
    const fail = () => new AppError('Email or password is incorrect', 401, 'BAD_LOGIN');
    const user = await platformTx(async (c) => (await c.query(
      'SELECT id, tenant_id, name, role, password_hash, disabled, locked_until, failed_logins, mfa_enabled_at FROM app_user WHERE lower(email) = lower($1)', [b.email])).rows[0]);
    if (!user) {
      dummyHash ??= hashPassword('not-a-real-password');
      await verifyPassword(b.password, await dummyHash);
      // unknown accounts are logged too (password-guessing across many names shows up as a burst)
      await platformTx((c) => c.query(`INSERT INTO audit_log (user_name, action, detail, ip) VALUES ($1,'login.failed',$2,$3)`, [b.email.toLowerCase().slice(0, 190), JSON.stringify({ unknownAccount: true }), req.ip]));
      throw fail();
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await platformTx((c) => c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, ip) VALUES ($1,$2,$3,'login.locked',$4)`, [user.tenant_id, user.id, user.name, req.ip]));
      throw new AppError(`Too many attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`, 429, 'LOCKED');
    }
    const ok = await verifyPassword(b.password, user.password_hash);
    if (!ok || user.disabled) {
      await platformTx((c) => failed(c, req, user, 'login.failed'));
      throw fail();
    }
    await companyOk(user.tenant_id);
    const pol = await platformTx((c) => policyOf(c, user));
    const ps = config.platformSso;
    if (user.role === 'platform_admin' && ps?.only) {
      const glass = ps.breakGlass.includes(String(b.email).toLowerCase());
      if (!glass || !pol.mfaEnabled) {
        await platformTx((c) => c.query(`INSERT INTO audit_log (user_id, user_name, action, detail, ip) VALUES ($1,$2,'login.password_refused_sso',$3,$4)`, [user.id, user.name, JSON.stringify({ platform: true, breakGlass: glass }), req.ip]));
        throw new AppError(glass ? 'Break-glass accounts must have multi-factor authentication set up' : 'Platform administrators sign in with the Ekobon account: use "Sign in with your company account".', 403, 'SSO_REQUIRED');
      }
    }
    if (pol.ssoOnly && !(user.role === 'super_admin' && pol.mfaEnabled)) {
      await platformTx((c) => c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, ip) VALUES ($1,$2,$3,'login.password_refused_sso',$4)`, [user.tenant_id, user.id, user.name, req.ip]));
      throw new AppError('Your company signs in with its company account: use "Sign in with your company account".', 403, 'SSO_REQUIRED');
    }
    if (pol.mfaEnabled) {
      const challenge = newToken();
      await platformTx((c) => c.query(`INSERT INTO login_challenge (token_hash, user_id, expires_at, ip) VALUES ($1,$2, now() + make_interval(mins => $3), $4)`,
        [sha256(challenge), user.id, CHALLENGE_MINUTES, req.ip]));
      return { mfa: true, challenge };
    }
    await openSession(req, reply, user, 'password', pol.mfaRequired);
    return { ok: true, enrolMfa: pol.mfaRequired };
  });

  /** Second step: the 6-digit code from the authenticator app, or a recovery code. */
  app.post('/api/auth/mfa', { config: { public: true } }, async (req, reply) => {
    const b = z.object({ challenge: z.string().min(20).max(200), code: z.string().trim().max(20).optional(), recoveryCode: z.string().trim().max(40).optional() })
      .refine((x) => x.code || x.recoveryCode, 'Enter the code').parse(req.body);
    const ch = await platformTx(async (c) => (await c.query(
      `SELECT l.token_hash, l.attempts, u.id, u.tenant_id, u.name, u.mfa_secret, u.mfa_last_step, u.mfa_recovery, u.disabled, u.locked_until
         FROM login_challenge l JOIN app_user u ON u.id = l.user_id WHERE l.token_hash = $1 AND l.expires_at > now()`, [sha256(b.challenge)])).rows[0]);
    if (!ch) throw new AppError('The sign-in took too long — enter your password again', 401, 'CHALLENGE_EXPIRED');
    if (ch.disabled || (ch.locked_until && new Date(ch.locked_until) > new Date())) throw new AppError('Too many attempts. Try again later.', 429, 'LOCKED');
    let step: number | null = null, usedRecovery = false;
    if (b.code) step = ch.mfa_secret ? checkCode(decrypt(ch.mfa_secret), b.code.replace(/\s/g, ''), ch.mfa_last_step == null ? null : Number(ch.mfa_last_step)) : null;
    else if (b.recoveryCode) usedRecovery = (ch.mfa_recovery as string[]).includes(sha256(normCode(b.recoveryCode)));
    if (step == null && !usedRecovery) {
      await platformTx(async (c) => {
        await c.query(`UPDATE login_challenge SET attempts = attempts + 1 WHERE token_hash = $1`, [ch.token_hash]);
        if (ch.attempts + 1 >= LOCK_AFTER) await c.query(`DELETE FROM login_challenge WHERE token_hash = $1`, [ch.token_hash]);
        await failed(c, req, ch, 'login.mfa_failed', { recovery: !!b.recoveryCode });
      });
      throw new AppError(b.recoveryCode ? 'That recovery code is not valid or was used already' : 'That code is not right — check the time on your phone and try the newest code', 401, 'BAD_CODE');
    }
    await platformTx(async (c) => {
      await c.query(`DELETE FROM login_challenge WHERE token_hash = $1`, [ch.token_hash]);
      if (step != null) await c.query('UPDATE app_user SET mfa_last_step = $2 WHERE id = $1', [ch.id, step]);
      if (usedRecovery) await c.query('UPDATE app_user SET mfa_recovery = array_remove(mfa_recovery, $2) WHERE id = $1', [ch.id, sha256(normCode(b.recoveryCode!))]);
    });
    await openSession(req, reply, ch, 'password+mfa', false, usedRecovery ? { recoveryCode: true, recoveryLeft: ch.mfa_recovery.length - 1 } : undefined);
    return { ok: true, recoveryLeft: usedRecovery ? ch.mfa_recovery.length - 1 : undefined };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    const token = readCookie(req, COOKIE);
    if (token) await platformTx((c) => c.query('DELETE FROM session WHERE token_hash = $1', [sha256(token)]));
    setSessionCookie(reply, null, req.protocol === 'https');
    return { ok: true };
  });

  // ------------------------------------------------------------------ single sign-on --
  /** Which company's identity provider (by email domain); returns where to send the browser. */
  app.post('/api/auth/sso/start', { config: { public: true } }, async (req) => {
    const b = z.object({ email: z.string().trim().email().max(190) }).parse(req.body);
    const domain = b.email.split('@')[1]!.toLowerCase();
    const ps = config.platformSso;
    if (ps && ps.domains.includes(domain)) {
      let d;
      try { d = await discover(ps.issuer); } catch (e) { throw new AppError(`The Ekobon sign-in service could not be reached (${(e as Error).message})`, 502, 'SSO_UNAVAILABLE'); }
      const f = newFlow();
      await platformTx((c) => c.query(`INSERT INTO sso_state (state_hash, tenant_id, nonce, code_verifier, expires_at) VALUES ($1,NULL,$2,$3, now() + interval '10 minutes')`, [sha256(f.state), f.nonce, f.verifier]));
      return { url: authorizeUrl(d, { clientId: ps.clientId, redirectUri: ssoRedirectUri(req), state: f.state, nonce: f.nonce, challenge: f.challenge, loginHint: b.email }) };
    }
    const cfg = await platformTx(async (c) => (await c.query(
      `SELECT s.* FROM sso_config s JOIN tenant t ON t.id = s.tenant_id WHERE s.enabled AND $1 = ANY(s.domains) AND t.status = 'active' LIMIT 1`, [domain])).rows[0]);
    if (!cfg) throw new AppError(`Company sign-in is not set up for @${domain}. Sign in with your password, or ask your administrator.`, 404, 'NO_SSO');
    let d;
    try { d = await discover(cfg.issuer); } catch (e) { throw new AppError(`Your company's sign-in service could not be reached (${(e as Error).message})`, 502, 'SSO_UNAVAILABLE'); }
    const f = newFlow();
    await platformTx((c) => c.query(`INSERT INTO sso_state (state_hash, tenant_id, nonce, code_verifier, expires_at) VALUES ($1,$2,$3,$4, now() + interval '10 minutes')`,
      [sha256(f.state), cfg.tenant_id, f.nonce, f.verifier]));
    return { url: authorizeUrl(d, { clientId: cfg.client_id, redirectUri: ssoRedirectUri(req), state: f.state, nonce: f.nonce, challenge: f.challenge, loginHint: b.email }) };
  });

  /** The identity provider sends the browser back here. */
  app.get('/api/auth/sso/callback', { config: { public: true } }, async (req, reply) => {
    const q = z.object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional(), error_description: z.string().max(1000).optional() }).parse(req.query);
    const back = (msg: string) => reply.redirect(`/?sso_error=${encodeURIComponent(msg.slice(0, 200))}`);
    if (q.error) return back(q.error_description?.split('\n')[0] || q.error);
    if (!q.code || !q.state) return back('The sign-in was not completed');
    const st = await platformTx(async (c) => (await c.query(`DELETE FROM sso_state WHERE state_hash = $1 RETURNING *, expires_at > now() AS live`, [sha256(q.state!)])).rows[0]);
    if (!st || !st.live) return back('The sign-in took too long or was already used — try again');
    const ps = config.platformSso;
    const cfg = st.tenant_id
      ? await platformTx(async (c) => (await c.query('SELECT * FROM sso_config WHERE tenant_id = $1 AND enabled', [st.tenant_id])).rows[0])
      : ps ? { issuer: ps.issuer, client_id: ps.clientId, client_secret: null as string | null, domains: ps.domains, require_mfa: true, plainSecret: ps.clientSecret } : null;
    if (!cfg) return back('Company sign-in is switched off');
    const refuse = async (why: string, detail: object = {}) => {
      await platformTx((c) => c.query(`INSERT INTO audit_log (tenant_id, action, detail, ip) VALUES ($1,'login.sso_failed',$2,$3)`, [st.tenant_id, JSON.stringify({ reason: why, ...detail }), req.ip]));
      return back(why);
    };
    let claims;
    try {
      const d = await discover(cfg.issuer);
      const idToken = await exchange(d, { clientId: cfg.client_id, clientSecret: 'plainSecret' in cfg ? cfg.plainSecret : cfg.client_secret ? decrypt(cfg.client_secret) : null, code: q.code, redirectUri: ssoRedirectUri(req), verifier: st.code_verifier });
      claims = await verifyIdToken(d, idToken, { clientId: cfg.client_id, nonce: st.nonce });
    } catch (e) { return refuse(`Company sign-in failed: ${(e as Error).message}`); }
    const email = emailOf(claims);
    if (!email) return refuse('Your company account has no email address');
    const domain = email.split('@')[1] ?? '';
    if (!(cfg.domains as string[]).includes(domain)) return refuse(`${email} is not in a domain set up for this company`, { email });
    if (cfg.require_mfa && !usedMfa(claims)) return refuse('Your company sign-in did not use multi-factor authentication, which is required', { email, amr: claims.amr ?? null });
    const user = await platformTx(async (c) => (await c.query(st.tenant_id
      ? 'SELECT id, tenant_id, name, disabled FROM app_user WHERE tenant_id = $1 AND lower(email) = $2'
      : `SELECT id, tenant_id, name, disabled FROM app_user WHERE $1::uuid IS NULL AND tenant_id IS NULL AND role = 'platform_admin' AND lower(email) = $2`, [st.tenant_id, email])).rows[0]);
    if (!user) return refuse(st.tenant_id ? `${email} has no ${BRAND} account in this company — ask your administrator to add you` : `${email} is not a platform administrator`, { email });
    if (user.disabled) return refuse('Your account is switched off — contact your administrator', { email });
    try { await companyOk(user.tenant_id); } catch (e) { return back((e as Error).message); }
    await openSession(req, reply, user, 'sso', false, { issuer: cfg.issuer, mfa: usedMfa(claims) });
    return reply.redirect('/');
  });

  // Everything below needs a valid session.
  await app.register(async (s) => {
    s.addHook('onRequest', authenticate);

    s.get('/api/auth/me', async (req) => {
      const u = req.user;
      const company = u.tenantId
        ? await tenantTx(u.tenantId, async (c) => (await c.query(
            `SELECT t.id, t.name, t.country, t.gwp_set, t.plan, t.products, t.status, t.access_expiry, t.consolidation, t.base_year, t.timezone, t.currency, t.logo_id IS NOT NULL AS has_logo,
                    (SELECT name FROM org_node WHERE kind = 'subgroup' AND id = $2) AS scope_name
               FROM tenant t WHERE t.id = $1`, [u.tenantId, u.scopeNodeId])).rows[0] ?? null)
        : null;
      const plan = company ? PLANS[company.plan as PlanCode] ?? PLANS.trial : null;
      const m = await platformTx(async (c) => {
        const r = (await c.query('SELECT id, tenant_id, role, mfa_enabled_at, cardinality(mfa_recovery) AS left FROM app_user WHERE id = $1', [u.id])).rows[0];
        return { ...(await policyOf(c, r)), recoveryLeft: Number(r.left) };
      });
      return { user: { ...u, mfa: { enabled: m.mfaEnabled, required: m.mfaRequired, recoveryLeft: m.recoveryLeft } }, company: company ? { ...company, planLimits: plan } : null };
    });

    s.post('/api/auth/password', async (req) => {
      const b = z.object({ current: z.string().min(1).max(200), next: z.string().max(200) }).parse(req.body);
      const problem = passwordProblem(b.next);
      if (problem) throw new AppError(problem);
      if (b.next === b.current) throw new AppError('Choose a password different from the current one');
      const row = await platformTx(async (c) => (await c.query('SELECT password_hash FROM app_user WHERE id = $1', [req.user.id])).rows[0]);
      if (!(await verifyPassword(b.current, row.password_hash))) throw new AppError('The current password is not correct', 400, 'BAD_PASSWORD');
      const hash = await hashPassword(b.next);
      const token = readCookie(req, COOKIE) ?? '';
      await platformTx(async (c) => {
        await c.query('UPDATE app_user SET password_hash = $2, must_change_password = false WHERE id = $1', [req.user.id, hash]);
        // Other sessions of this person are ended; this one stays.
        await c.query('DELETE FROM session WHERE user_id = $1 AND token_hash <> $2', [req.user.id, sha256(token)]);
        await audit(c, req, 'password.change', 'user', req.user.id);
      });
      return { ok: true };
    });

    // ---------------------------------------------------------------- MFA set-up --
    /** Start: a new secret for the authenticator app (shown as a QR code). */
    s.post('/api/auth/mfa/setup', async (req) => {
      const r = await platformTx(async (c) => (await c.query('SELECT email, mfa_enabled_at FROM app_user WHERE id = $1', [req.user.id])).rows[0]);
      if (r.mfa_enabled_at) throw new AppError('Multi-factor authentication is already set up');
      const secret = newSecret();
      await platformTx((c) => c.query('UPDATE app_user SET mfa_pending = $2 WHERE id = $1', [req.user.id, encrypt(secret)]));
      return { secret, uri: otpauthUri(secret, r.email, BRAND) };
    });
    /** Finish: the first code proves the app works; returns the recovery codes (shown once). */
    s.post('/api/auth/mfa/enable', async (req) => {
      const b = z.object({ code: z.string().trim().max(10) }).parse(req.body);
      const r = await platformTx(async (c) => (await c.query('SELECT mfa_pending, mfa_enabled_at FROM app_user WHERE id = $1', [req.user.id])).rows[0]);
      if (r.mfa_enabled_at) throw new AppError('Multi-factor authentication is already set up');
      if (!r.mfa_pending) throw new AppError('Start the set-up first');
      const secret = decrypt(r.mfa_pending);
      const step = checkCode(secret, b.code.replace(/\s/g, ''), null);
      if (step == null) throw new AppError('That code is not right — scan the QR code again or check the time on your phone', 400, 'BAD_CODE');
      const codes = recoveryCodes();
      const token = readCookie(req, COOKIE) ?? '';
      await platformTx(async (c) => {
        await c.query(`UPDATE app_user SET mfa_secret = mfa_pending, mfa_pending = NULL, mfa_enabled_at = now(), mfa_last_step = $2, mfa_recovery = $3 WHERE id = $1`,
          [req.user.id, step, codes.map((x) => sha256(normCode(x)))]);
        await c.query(`UPDATE session SET mfa_enrol = false, method = 'password+mfa' WHERE token_hash = $1`, [sha256(token)]);
        await c.query('DELETE FROM session WHERE user_id = $1 AND token_hash <> $2', [req.user.id, sha256(token)]);
        await audit(c, req, 'mfa.enable', 'user', req.user.id);
      });
      return { recoveryCodes: codes };
    });
    /** New recovery codes (the old ones stop working); needs a current code. */
    s.post('/api/auth/mfa/recovery', async (req) => {
      const b = z.object({ code: z.string().trim().max(10) }).parse(req.body);
      const r = await platformTx(async (c) => (await c.query('SELECT mfa_secret, mfa_last_step FROM app_user WHERE id = $1', [req.user.id])).rows[0]);
      if (!r.mfa_secret) throw new AppError('Multi-factor authentication is not set up');
      const step = checkCode(decrypt(r.mfa_secret), b.code.replace(/\s/g, ''), r.mfa_last_step == null ? null : Number(r.mfa_last_step));
      if (step == null) throw new AppError('That code is not right', 400, 'BAD_CODE');
      const codes = recoveryCodes();
      await platformTx(async (c) => {
        await c.query('UPDATE app_user SET mfa_recovery = $2, mfa_last_step = $3 WHERE id = $1', [req.user.id, codes.map((x) => sha256(normCode(x))), step]);
        await audit(c, req, 'mfa.recovery_codes', 'user', req.user.id);
      });
      return { recoveryCodes: codes };
    });
    /** Switch off (only when not required): password and a current code. */
    s.post('/api/auth/mfa/disable', async (req) => {
      const b = z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(10) }).parse(req.body);
      const r = await platformTx(async (c) => (await c.query('SELECT id, tenant_id, role, password_hash, mfa_secret, mfa_last_step, mfa_enabled_at FROM app_user WHERE id = $1', [req.user.id])).rows[0]);
      if (!r.mfa_secret) throw new AppError('Multi-factor authentication is not set up');
      if ((await platformTx((c) => policyOf(c, r))).mfaRequired) throw new AppError('Multi-factor authentication is required for your account and cannot be switched off');
      if (!(await verifyPassword(b.password, r.password_hash))) throw new AppError('The password is not correct', 400, 'BAD_PASSWORD');
      if (checkCode(decrypt(r.mfa_secret), b.code.replace(/\s/g, ''), r.mfa_last_step == null ? null : Number(r.mfa_last_step)) == null) throw new AppError('That code is not right', 400, 'BAD_CODE');
      await platformTx(async (c) => {
        await c.query(`UPDATE app_user SET mfa_secret = NULL, mfa_pending = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery = '{}' WHERE id = $1`, [req.user.id]);
        await audit(c, req, 'mfa.disable', 'user', req.user.id);
      });
      return { ok: true };
    });
  });
}
