/**
 * Organisation & groups: main entity → sub-groups → facilities.
 *
 * Super admin edits everything; an Admin edits inside their own sub-group.
 * Everyone in the company can read the tree (it is needed to enter data).
 * Removing a node that has history or children archives it instead.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireTenant } from '../lib/auth.js';
import { scopeOf, subtreeNodes } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';

const nodeFields = z.object({
  name: z.string().trim().min(1).max(160),
  facilityType: z.string().max(60).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  country: z.string().length(2).optional(),
  floorAreaM2: z.number().min(0).nullable().optional(),
  employees: z.number().int().min(0).nullable().optional(),
  ownershipPct: z.number().min(0).max(100).optional(),
  operationalControl: z.boolean().optional(),
  financialControl: z.boolean().optional(),
  managerUserId: z.string().uuid().nullable().optional(),
  /** grid region for electricity (null = the country's national average) */
  gridRegion: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,10})?$/).nullable().optional(),
});

/** Which nodes this person may change. */
async function editable(c: Tx, req: FastifyRequest): Promise<Set<string> | 'all'> {
  const r = req.user.role;
  if (r === 'platform_admin' || r === 'super_admin') return 'all';
  if (r === 'admin') return subtreeNodes(c, req.user.scopeNodeId);
  return new Set();
}
const canEdit = (e: Set<string> | 'all', id: string) => e === 'all' || e.has(id);

export async function orgRoutes(app: FastifyInstance) {
  app.get('/api/org', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const nodes = (await c.query(
        `SELECT n.id, n.parent_id, n.kind, n.name, n.facility_type, n.location, n.country, n.floor_area_m2, n.employees, n.ownership_pct,
                n.operational_control, n.financial_control, n.active, n.sort, n.manager_user_id, u.name AS manager_name, n.grid_region,
                (SELECT count(*)::int FROM activity a WHERE a.facility_id = n.id) AS entries
           FROM org_node n LEFT JOIN app_user u ON u.id = n.manager_user_id
          ORDER BY n.kind = 'group' DESC, n.sort, n.name`)).rows;
      const e = await editable(c, req);
      const scope = await scopeOf(c, req.user);
      return { nodes: nodes.map((n) => ({ ...n, canEdit: canEdit(e, n.id), canSee: n.kind !== 'facility' || scope.see.has(n.id), canEnter: scope.enter.has(n.id) })) };
    });
  });

  app.post('/api/org/nodes', async (req) => {
    const tenant = requireTenant(req);
    const b = nodeFields.extend({ parentId: z.string().uuid(), kind: z.enum(['subgroup', 'facility']) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const parent = (await c.query('SELECT id, kind, country FROM org_node WHERE id = $1', [b.parentId])).rows[0];
      if (!parent) throw notFound('Parent');
      if (parent.kind === 'facility') throw new AppError('A facility cannot contain other nodes');
      if (!canEdit(await editable(c, req), parent.id)) throw forbidden('You can only add inside your own part of the organisation');
      const r = (await c.query(
        `INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country, floor_area_m2, employees, ownership_pct,
                               operational_control, financial_control, manager_user_id, grid_region)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,100),COALESCE($11,true),COALESCE($12,true),$13,$14) RETURNING *`,
        [tenant, b.parentId, b.kind, b.name, b.facilityType ?? null, b.location ?? null, (b.country ?? parent.country).toUpperCase(),
         b.floorAreaM2 ?? null, b.employees ?? null, b.ownershipPct ?? null, b.operationalControl ?? null, b.financialControl ?? null, b.managerUserId ?? null, b.gridRegion ?? null])).rows[0];
      await audit(c, req, 'node.create', b.kind, r.id, { name: b.name });
      return r;
    });
  });

  app.patch('/api/org/nodes/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = nodeFields.partial().extend({ parentId: z.string().uuid().optional(), active: z.boolean().optional(), sort: z.number().int().optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const before = (await c.query('SELECT * FROM org_node WHERE id = $1', [id])).rows[0];
      if (!before) throw notFound('Node');
      const e = await editable(c, req);
      if (!canEdit(e, id)) throw forbidden('You can only change your own part of the organisation');
      if (b.parentId) {
        if (before.kind === 'group') throw new AppError('The main entity cannot be moved');
        const p = (await c.query('SELECT kind FROM org_node WHERE id = $1', [b.parentId])).rows[0];
        if (!p || p.kind === 'facility') throw new AppError('Move it under the main entity or a sub-group');
        if ((await subtreeNodes(c, id)).has(b.parentId)) throw new AppError('A node cannot be moved inside itself');
        if (!canEdit(e, b.parentId)) throw forbidden('You can only move it within your own part of the organisation');
      }
      const r = (await c.query(
        `UPDATE org_node SET name = COALESCE($2, name), facility_type = CASE WHEN $3 THEN $4 ELSE facility_type END,
                location = CASE WHEN $5 THEN $6 ELSE location END, country = COALESCE($7, country),
                floor_area_m2 = CASE WHEN $8 THEN $9 ELSE floor_area_m2 END, employees = CASE WHEN $10 THEN $11 ELSE employees END,
                ownership_pct = COALESCE($12, ownership_pct), operational_control = COALESCE($13, operational_control),
                financial_control = COALESCE($14, financial_control), manager_user_id = CASE WHEN $15 THEN $16 ELSE manager_user_id END,
                parent_id = COALESCE($17, parent_id), active = COALESCE($18, active), sort = COALESCE($19, sort),
                grid_region = CASE WHEN $20 THEN $21 ELSE grid_region END
          WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.facilityType !== undefined, b.facilityType ?? null, b.location !== undefined, b.location ?? null, b.country?.toUpperCase() ?? null,
         b.floorAreaM2 !== undefined, b.floorAreaM2 ?? null, b.employees !== undefined, b.employees ?? null, b.ownershipPct ?? null,
         b.operationalControl ?? null, b.financialControl ?? null, b.managerUserId !== undefined, b.managerUserId ?? null,
         b.parentId ?? null, b.active ?? null, b.sort ?? null, b.gridRegion !== undefined, b.gridRegion ?? null])).rows[0];
      const changed = Object.fromEntries(Object.keys(b).map((k) => [k, (b as Record<string, unknown>)[k]]));
      await audit(c, req, 'node.update', before.kind, id, { name: before.name, changed });
      return r;
    });
  });

  app.delete('/api/org/nodes/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const n = (await c.query('SELECT kind, name FROM org_node WHERE id = $1', [id])).rows[0];
      if (!n) throw notFound('Node');
      if (n.kind === 'group') throw new AppError('The main entity cannot be removed');
      if (!canEdit(await editable(c, req), id)) throw forbidden();
      const used = (await c.query(
        `SELECT EXISTS (SELECT 1 FROM org_node WHERE parent_id = $1) OR EXISTS (SELECT 1 FROM activity WHERE facility_id = $1) AS used`, [id])).rows[0].used;
      if (used) {
        await c.query('UPDATE org_node SET active = false WHERE id = $1', [id]);
        await audit(c, req, 'node.archive', n.kind, id, { name: n.name });
        return { removed: false, archived: true, message: 'It has data or contains other nodes, so it was archived instead (hidden, history kept).' };
      }
      await c.query('DELETE FROM user_facility WHERE node_id = $1', [id]);
      await c.query('DELETE FROM org_node WHERE id = $1', [id]);
      await audit(c, req, 'node.delete', n.kind, id, { name: n.name });
      return { removed: true, archived: false };
    });
  });
}
