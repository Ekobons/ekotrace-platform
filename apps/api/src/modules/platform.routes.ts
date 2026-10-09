/**
 * Platform console (Ekobon staff only): companies, plans, access dates.
 * Creating a company also creates its main entity and its first Super admin
 * (temporary password shown once).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx } from '../db/pool.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';

const plan = z.enum(['trial', 'starter', 'professional', 'enterprise']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function platformRoutes(app: FastifyInstance) {
  app.get('/api/platform/companies', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({
      companies: (await c.query(
        `SELECT t.id, t.name, t.country, t.gwp_set, t.plan, t.status, t.access_start, t.access_expiry, t.created_at,
                (SELECT count(*)::int FROM app_user u WHERE u.tenant_id = t.id AND NOT u.disabled) AS users,
                (SELECT count(*)::int FROM org_node n WHERE n.tenant_id = t.id AND n.kind = 'facility' AND n.active) AS facilities,
                (SELECT count(*)::int FROM activity a WHERE a.tenant_id = t.id) AS entries,
                (SELECT max(u.last_login_at) FROM app_user u WHERE u.tenant_id = t.id) AS last_login
           FROM tenant t ORDER BY t.name`)).rows,
    }));
  });

  app.post('/api/platform/companies', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({
      name: z.string().trim().min(2).max(160), country: z.string().length(2).default('AE'), gwpSet: z.enum(['AR4', 'AR5', 'AR6']).default('AR5'),
      plan: plan.default('enterprise'), accessExpiry: date.optional(),
      superAdmin: z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(190) }),
    }).parse(req.body);
    const pw = temporaryPassword();
    const hash = await hashPassword(pw);
    return platformTx(async (c) => {
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [b.superAdmin.email])).rowCount) {
        throw new AppError('Someone with this email already has an account', 409, 'DUPLICATE');
      }
      const t = (await c.query(
        `INSERT INTO tenant (name, country, gwp_set, plan, access_expiry) VALUES ($1,$2,$3,$4,COALESCE($5::date, (current_date + interval '1 year')::date)) RETURNING *`,
        [b.name, b.country.toUpperCase(), b.gwpSet, b.plan, b.accessExpiry ?? null])).rows[0];
      await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,$3)`, [t.id, b.name, t.country]);
      const u = (await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, created_by) VALUES ($1,$2,$3,'super_admin',$4,$5) RETURNING id, email`,
        [t.id, b.superAdmin.email.toLowerCase(), b.superAdmin.name, hash, req.user.id])).rows[0];
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'company.create','tenant',$1::text,$4,$5)`,
        [t.id, req.user.id, req.user.name, JSON.stringify({ name: b.name, plan: b.plan, superAdmin: u.email }), req.ip]);
      return { company: t, superAdmin: { email: u.email, temporaryPassword: pw } };
    });
  });

  app.patch('/api/platform/companies/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().trim().min(2).max(160).optional(), plan: plan.optional(), status: z.enum(['active', 'suspended']).optional(),
      accessExpiry: date.optional(), notes: z.string().max(1000).nullable().optional() }).parse(req.body);
    return platformTx(async (c) => {
      const r = (await c.query(`UPDATE tenant SET name = COALESCE($2, name), plan = COALESCE($3, plan), status = COALESCE($4, status),
                                  access_expiry = COALESCE($5::date, access_expiry), notes = CASE WHEN $6 THEN $7 ELSE notes END
                                WHERE id = $1 RETURNING *`, [id, b.name ?? null, b.plan ?? null, b.status ?? null, b.accessExpiry ?? null, b.notes !== undefined, b.notes ?? null])).rows[0];
      if (!r) throw notFound('Company');
      if (b.status === 'suspended') await c.query('DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE tenant_id = $1)', [id]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'company.update','tenant',$1::text,$4,$5)`,
        [id, req.user.id, req.user.name, JSON.stringify(b), req.ip]);
      return r;
    });
  });

}
