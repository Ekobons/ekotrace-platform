/**
 * Dashboard groups: any mix of facilities to view together (e.g. "Sharjah sites",
 * "SBTi boundary"). They never change the organisation. A person sees a group only if
 * they can see every facility in it — Ekotrace never shows partial totals. Anyone who can
 * enter or approve data creates groups from facilities they see; the creator or a Super
 * admin deletes them. Professional and Enterprise plans.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { planOf, requireFeature } from '../lib/plans.js';

export async function groupRoutes(app: FastifyInstance) {
  app.get('/api/dashboard-groups', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const plan = await planOf(c, tenant);
      const see = (await scopeOf(c, req.user)).see;
      const rows = (await c.query(
        `SELECT g.id, g.name, g.facility_ids, g.created_by, g.created_by_name, g.created_at,
                (SELECT json_agg(json_build_object('id', n.id, 'name', n.name, 'parent', p.name) ORDER BY n.name) FROM org_node n LEFT JOIN org_node p ON p.id = n.parent_id WHERE n.id = ANY(g.facility_ids)) AS facilities
           FROM dashboard_group g ORDER BY g.name`)).rows;
      const visible = rows.filter((g) => (g.facility_ids as string[]).every((f) => see.has(f)));
      return {
        allowed: plan.groups, hidden: rows.length - visible.length,
        groups: visible.map(({ facility_ids, ...g }) => ({ ...g, facilityIds: facility_ids, canDelete: g.created_by === req.user.id || ['super_admin', 'platform_admin'].includes(req.user.role) })),
      };
    });
  });

  app.post('/api/dashboard-groups', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const b = z.object({ name: z.string().trim().min(2).max(80), facilityIds: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await requireFeature(c, tenant, 'groups');
      const see = (await scopeOf(c, req.user)).see;
      const ids = [...new Set(b.facilityIds)];
      const real = (await c.query(`SELECT id FROM org_node WHERE id = ANY($1) AND kind = 'facility'`, [ids])).rows.map((r) => r.id as string);
      if (real.length !== ids.length) throw new AppError('Only facilities can be put in a group');
      if (ids.some((f) => !see.has(f))) throw forbidden('A group can only contain facilities you can see');
      if ((await c.query('SELECT 1 FROM dashboard_group WHERE lower(name) = lower($1)', [b.name])).rowCount) throw new AppError('A group with this name exists already', 409, 'DUPLICATE');
      const g = (await c.query(`INSERT INTO dashboard_group (tenant_id, name, facility_ids, created_by, created_by_name) VALUES ($1,$2,$3,$4,$5) RETURNING id, name`,
        [tenant, b.name, ids, req.user.id, req.user.name])).rows[0];
      await audit(c, req, 'group.create', 'dashboard_group', g.id, { name: b.name, facilities: ids.length });
      return g;
    });
  });

  app.delete('/api/dashboard-groups/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const g = (await c.query('SELECT * FROM dashboard_group WHERE id = $1', [id])).rows[0];
      if (!g) throw notFound('Group');
      if (g.created_by !== req.user.id && !['super_admin', 'platform_admin'].includes(req.user.role)) throw forbidden('Only who created the group or a Super admin can delete it');
      await c.query('DELETE FROM dashboard_group WHERE id = $1', [id]);
      await audit(c, req, 'group.delete', 'dashboard_group', id, { name: g.name });
      return { ok: true };
    });
  });
}
