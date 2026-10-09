/**
 * People & access.
 *
 * - Super admin manages everyone in the company.
 * - Admin manages Managers and Data preparers working inside their sub-group.
 * - A new person gets a temporary password, shown once, to be changed at first login.
 * - Nobody can disable or demote themselves, and the last Super admin stays.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireTenant, type Role } from '../lib/auth.js';
import { subtreeFacilities } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';

const companyRole = z.enum(['super_admin', 'admin', 'manager', 'preparer', 'verifier']);

/** May the caller give `role` (with these facilities / sub-group) to someone? */
async function checkGrant(c: Tx, req: FastifyRequest, role: Role, scopeNodeId: string | null | undefined, facilityIds: string[]) {
  const me = req.user;
  if (me.role === 'platform_admin' || me.role === 'super_admin') return;
  if (me.role !== 'admin') throw forbidden('Only a Super admin or Admin can manage people');
  if (!['manager', 'preparer'].includes(role)) throw forbidden('An Admin can add Managers and Data preparers');
  const mine = await subtreeFacilities(c, me.scopeNodeId);
  if (facilityIds.some((f) => !mine.has(f))) throw forbidden('Only facilities in your own sub-group can be assigned');
  if (scopeNodeId) throw forbidden();
}

async function setFacilities(c: Tx, tenant: string, userId: string, ids: string[]) {
  await c.query('DELETE FROM user_facility WHERE user_id = $1', [userId]);
  if (ids.length) {
    const ok = (await c.query(`SELECT count(*)::int n FROM org_node WHERE id = ANY($1) AND kind = 'facility'`, [ids])).rows[0].n;
    if (ok !== new Set(ids).size) throw new AppError('Some of the facilities do not exist');
    await c.query('INSERT INTO user_facility (user_id, node_id, tenant_id) SELECT $1, unnest($2::uuid[]), $3', [userId, ids, tenant]);
  }
}

export async function peopleRoutes(app: FastifyInstance) {
  app.get('/api/users', async (req) => {
    const tenant = requireTenant(req);
    if (req.user.role === 'preparer') throw forbidden();
    return tenantTx(tenant, async (c) => {
      const users = (await c.query(
        `SELECT u.id, u.name, u.email, u.role, u.scope_node_id, s.name AS scope_name, u.disabled, u.last_login_at, u.created_at, u.must_change_password,
                COALESCE((SELECT json_agg(json_build_object('id', n.id, 'name', n.name) ORDER BY n.name)
                            FROM user_facility uf JOIN org_node n ON n.id = uf.node_id WHERE uf.user_id = u.id), '[]') AS facilities,
                COALESCE((SELECT json_agg(json_build_object('id', n.id, 'name', n.name) ORDER BY n.name)
                            FROM org_node n WHERE n.manager_user_id = u.id), '[]') AS manages
           FROM app_user u LEFT JOIN org_node s ON s.id = u.scope_node_id
          ORDER BY u.disabled, CASE u.role WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3 WHEN 'preparer' THEN 4 ELSE 5 END, u.name`)).rows;
      let editableIds: Set<string> | 'all' = 'all';
      if (req.user.role === 'admin') {
        const mine = await subtreeFacilities(c, req.user.scopeNodeId);
        editableIds = new Set(users.filter((u) => ['manager', 'preparer'].includes(u.role) && u.facilities.every((f: { id: string }) => mine.has(f.id))).map((u) => u.id));
      } else if (!['platform_admin', 'super_admin'].includes(req.user.role)) editableIds = new Set();
      return { users: users.map((u) => ({ ...u, canEdit: u.id !== req.user.id && (editableIds === 'all' || editableIds.has(u.id)) })) };
    });
  });

  app.post('/api/users', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({
      name: z.string().trim().min(2).max(120), email: z.string().email().max(190), role: companyRole,
      scopeNodeId: z.string().uuid().nullable().optional(), facilityIds: z.array(z.string().uuid()).max(500).default([]),
    }).parse(req.body);
    if (b.role === 'admin' && !b.scopeNodeId) throw new AppError('Choose the sub-group this Admin runs');
    const pw = temporaryPassword();
    const hash = await hashPassword(pw);
    return tenantTx(tenant, async (c) => {
      await checkGrant(c, req, b.role, b.scopeNodeId, b.facilityIds);
      if (b.scopeNodeId) {
        const n = (await c.query('SELECT kind FROM org_node WHERE id = $1', [b.scopeNodeId])).rows[0];
        if (!n || n.kind === 'facility') throw new AppError('An Admin runs the main entity or a sub-group, not a single facility');
      }
      const taken = await platformTx(async (p) => (await p.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [b.email])).rowCount);
      if (taken) throw new AppError('Someone with this email already has an account', 409, 'DUPLICATE');
      const u = (await c.query(
        `INSERT INTO app_user (tenant_id, email, name, role, scope_node_id, password_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, email, role`, [tenant, b.email.toLowerCase(), b.name, b.role, b.role === 'admin' ? b.scopeNodeId : null, hash, req.user.id])).rows[0];
      await setFacilities(c, tenant, u.id, ['manager', 'preparer'].includes(b.role) ? b.facilityIds : []);
      await audit(c, req, 'user.create', 'user', u.id, { email: u.email, role: u.role });
      return { user: u, temporaryPassword: pw };
    });
  });

  app.patch('/api/users/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({
      name: z.string().trim().min(2).max(120).optional(), role: companyRole.optional(), scopeNodeId: z.string().uuid().nullable().optional(),
      facilityIds: z.array(z.string().uuid()).max(500).optional(), disabled: z.boolean().optional(),
    }).parse(req.body);
    if (id === req.user.id && (b.role || b.disabled)) throw new AppError('You cannot change your own role or disable yourself');
    return tenantTx(tenant, async (c) => {
      const u = (await c.query('SELECT id, role, scope_node_id FROM app_user WHERE id = $1', [id])).rows[0];
      if (!u) throw notFound('Person');
      const role: Role = b.role ?? u.role;
      const current: string[] = (await c.query('SELECT node_id FROM user_facility WHERE user_id = $1', [id])).rows.map((r) => r.node_id);
      const facs = b.facilityIds ?? current;
      await checkGrant(c, req, u.role, null, current); // may the caller manage this person at all?
      await checkGrant(c, req, role, b.scopeNodeId, facs);
      const scope = role === 'admin' ? (b.scopeNodeId ?? u.scope_node_id) : null;
      if (role === 'admin' && !scope) throw new AppError('Choose the sub-group this Admin runs');
      if ((u.role === 'super_admin' && (role !== 'super_admin' || b.disabled))) {
        const others = (await c.query(`SELECT count(*)::int n FROM app_user WHERE role = 'super_admin' AND NOT disabled AND id <> $1`, [id])).rows[0].n;
        if (!others) throw new AppError('The company needs at least one active Super admin');
      }
      const r = (await c.query(`UPDATE app_user SET name = COALESCE($2, name), role = $3, scope_node_id = $4, disabled = COALESCE($5, disabled)
                                WHERE id = $1 RETURNING id, name, email, role, disabled`, [id, b.name ?? null, role, scope, b.disabled ?? null])).rows[0];
      if (b.facilityIds || b.role) await setFacilities(c, tenant, id, ['manager', 'preparer'].includes(role) ? facs : []);
      if (b.disabled) await platformTx((p) => p.query('DELETE FROM session WHERE user_id = $1', [id]));
      await audit(c, req, 'user.update', 'user', id, b);
      return r;
    });
  });

  app.post('/api/users/:id/reset-password', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    if (id === req.user.id) throw new AppError('Use “Change password” for your own account');
    const pw = temporaryPassword();
    const hash = await hashPassword(pw);
    return tenantTx(tenant, async (c) => {
      const u = (await c.query('SELECT role FROM app_user WHERE id = $1', [id])).rows[0];
      if (!u) throw notFound('Person');
      const current: string[] = (await c.query('SELECT node_id FROM user_facility WHERE user_id = $1', [id])).rows.map((r) => r.node_id);
      await checkGrant(c, req, u.role, null, current);
      await c.query('UPDATE app_user SET password_hash = $2, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = $1', [id, hash]);
      await platformTx((p) => p.query('DELETE FROM session WHERE user_id = $1', [id]));
      await audit(c, req, 'user.reset_password', 'user', id);
      return { temporaryPassword: pw };
    });
  });

  /** Security & audit log. */
  app.get('/api/audit', async (req) => {
    const tenant = requireTenant(req);
    if (!['platform_admin', 'super_admin', 'verifier', 'admin'].includes(req.user.role)) throw forbidden();
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), action: z.string().max(40).optional(), before: z.coerce.number().int().optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => ({
      events: (await c.query(
        `SELECT id, at, user_name, action, entity, entity_id, detail, ip FROM audit_log
          WHERE tenant_id = $1 AND ($2::text IS NULL OR action LIKE $2 || '%') AND ($3::bigint IS NULL OR id < $3)
          ORDER BY id DESC LIMIT $4`, [tenant, q.action ?? null, q.before ?? null, q.limit])).rows,
    }));
  });

}
