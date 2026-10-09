/**
 * Login, logout, "who am I", change password.
 *
 * - Wrong email and wrong password give the same message (no hint which one).
 * - 5 wrong passwords lock the account for 15 minutes.
 * - New accounts get a temporary password that must be changed at first login.
 * - Logging out deletes the session on the server, not just the cookie.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx } from '../db/pool.js';
import { audit, authenticate, COOKIE, readCookie, SESSION_HOURS, setSessionCookie } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, newToken, passwordProblem, sha256, verifyPassword } from '../lib/password.js';

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;
let dummyHash: Promise<string> | null = null; // compared when the email is unknown, so timing gives nothing away

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const b = z.object({ email: z.string().email().max(190), password: z.string().min(1).max(200) }).parse(req.body);
    const fail = () => new AppError('Email or password is incorrect', 401, 'BAD_LOGIN');
    const user = await platformTx(async (c) => (await c.query(
      'SELECT id, tenant_id, name, role, password_hash, disabled, locked_until, failed_logins FROM app_user WHERE lower(email) = lower($1)', [b.email])).rows[0]);
    if (!user) {
      dummyHash ??= hashPassword('not-a-real-password');
      await verifyPassword(b.password, await dummyHash);
      throw fail();
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError(`Too many attempts. Try again after ${new Date(user.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`, 429, 'LOCKED');
    }
    const ok = await verifyPassword(b.password, user.password_hash);
    if (!ok || user.disabled) {
      await platformTx(async (c) => {
        await c.query(`UPDATE app_user SET failed_logins = failed_logins + 1,
                         locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
                       WHERE id = $1`, [user.id, LOCK_AFTER, LOCK_MINUTES]);
        await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, ip) VALUES ($1,$2,$3,'login.failed',$4)`, [user.tenant_id, user.id, user.name, req.ip]);
      });
      throw fail();
    }
    if (user.tenant_id) {
      const t = await platformTx(async (c) => (await c.query('SELECT status, access_expiry FROM tenant WHERE id = $1', [user.tenant_id])).rows[0]);
      if (t?.status !== 'active') throw new AppError('This company account is suspended. Contact your administrator.', 403, 'SUSPENDED');
      if (t.access_expiry < new Date().toISOString().slice(0, 10)) throw new AppError('This company\'s subscription has expired. Contact your administrator.', 403, 'EXPIRED');
    }
    const token = newToken();
    await platformTx(async (c) => {
      await c.query(`INSERT INTO session (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2, now() + make_interval(hours => $3), $4, $5)`,
        [sha256(token), user.id, SESSION_HOURS, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300)]);
      await c.query('UPDATE app_user SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, ip) VALUES ($1,$2,$3,'login',$4)`, [user.tenant_id, user.id, user.name, req.ip]);
      await c.query(`DELETE FROM session WHERE expires_at < now()`); // tidy up old sessions
    });
    setSessionCookie(reply, token, req.protocol === 'https');
    return { ok: true };
  });

  app.post('/api/auth/logout', { config: { public: true } }, async (req, reply) => {
    const token = readCookie(req, COOKIE);
    if (token) await platformTx((c) => c.query('DELETE FROM session WHERE token_hash = $1', [sha256(token)]));
    setSessionCookie(reply, null, req.protocol === 'https');
    return { ok: true };
  });

  // Everything below needs a valid session.
  await app.register(async (s) => {
    s.addHook('onRequest', authenticate);

    s.get('/api/auth/me', async (req) => {
      const u = req.user;
      const company = u.tenantId
        ? await tenantTx(u.tenantId, async (c) => (await c.query(
            `SELECT t.id, t.name, t.country, t.gwp_set, t.plan, t.status, t.access_expiry, t.consolidation, t.base_year,
                    (SELECT name FROM org_node WHERE kind = 'subgroup' AND id = $2) AS scope_name
               FROM tenant t WHERE t.id = $1`, [u.tenantId, u.scopeNodeId])).rows[0] ?? null)
        : null;
      return { user: u, company };
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
  });
}
