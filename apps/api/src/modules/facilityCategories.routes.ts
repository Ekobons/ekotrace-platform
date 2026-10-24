/**
 * Which Scope 1, 2 and 3 categories apply to a facility.
 *
 *   GET /api/facilities/:id/categories   every data category with: applies, reason, who changed it, and
 *                                         whether the facility has data in it (this year or last)
 *   PUT /api/facilities/:id/categories   {categories: [{code, applicable, reason?}]} — super admins, admins of the
 *                                         facility, its manager. A category made not applicable needs a reason.
 *
 * No row = applies. Not applicable = hidden in Add data and never "Missing"; entries made before stay and count.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';

/** The categories a facility has marked not applicable (codes). */
export async function notApplicable(c: Tx, facilityId: string): Promise<Map<string, string>> {
  const r = await c.query(`SELECT category_code, reason FROM facility_category WHERE facility_id = $1 AND NOT applicable`, [facilityId]);
  return new Map(r.rows.map((x) => [x.category_code as string, x.reason as string]));
}

/** SQL condition: the activity's category applies to its facility (aliases a = activity, cat = category). */
export const APPLIES_SQL = `NOT EXISTS (SELECT 1 FROM facility_category fcx WHERE fcx.facility_id = a.facility_id AND fcx.category_code = cat.code AND NOT fcx.applicable)`;

export async function facilityCategoryRoutes(app: FastifyInstance) {
  app.get('/api/facilities/:id/categories', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      assertCan(s.see, id);
      const f = (await c.query(`SELECT id, name FROM org_node WHERE id = $1 AND kind = 'facility'`, [id])).rows[0];
      if (!f) throw notFound('Facility');
      const rows = (await c.query(
        `SELECT cat.code, cat.name, cat.scope, cat.ghg_category, coalesce(fc.applicable, true) AS applicable, coalesce(fc.reason, '') AS reason,
                fc.updated_name, fc.updated_at,
                EXISTS (SELECT 1 FROM activity a WHERE a.facility_id = $1 AND a.category_id = cat.id
                         AND extract(year FROM a.period_start) >= extract(year FROM now()) - 1) AS has_data
           FROM category cat LEFT JOIN facility_category fc ON fc.facility_id = $1 AND fc.category_code = cat.code
          WHERE cat.active ORDER BY cat.scope, cat.sort`, [id])).rows;
      return { facility: f, canEdit: canEdit(req.user.role, s.approve.has(id)), categories: rows };
    });
  });

  app.put('/api/facilities/:id/categories', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ categories: z.array(z.object({ code: z.string().min(1).max(60), applicable: z.boolean(), reason: z.string().trim().max(300).optional() })).min(1).max(100) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      assertCan(s.see, id);
      if (!canEdit(req.user.role, s.approve.has(id))) throw new AppError('Only super admins, admins and the facility’s manager can change its categories', 403, 'FORBIDDEN');
      const codes = new Set((await c.query(`SELECT code FROM category WHERE active`)).rows.map((r) => r.code as string));
      const before = await notApplicable(c, id);
      const changes: string[] = [];
      for (const x of b.categories) {
        if (!codes.has(x.code)) throw new AppError(`Unknown category ${x.code}`);
        if (!x.applicable && !(x.reason ?? '').trim()) throw new AppError(`Give a reason why ${x.code} does not apply (it goes in the report's boundary note)`);
        const was = !before.has(x.code);
        if (was !== x.applicable || (!x.applicable && before.get(x.code) !== x.reason)) changes.push(`${x.code}: ${x.applicable ? 'applies' : `not applicable (${x.reason})`}`);
        await c.query(
          `INSERT INTO facility_category (tenant_id, facility_id, category_code, applicable, reason, updated_by, updated_name, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,(SELECT name FROM app_user WHERE id = $6),now())
           ON CONFLICT (facility_id, category_code) DO UPDATE SET applicable = EXCLUDED.applicable, reason = EXCLUDED.reason,
             updated_by = EXCLUDED.updated_by, updated_name = EXCLUDED.updated_name, updated_at = now()
           WHERE facility_category.applicable IS DISTINCT FROM EXCLUDED.applicable OR facility_category.reason IS DISTINCT FROM EXCLUDED.reason`,
          [tenant, id, x.code, x.applicable, x.applicable ? '' : x.reason!.trim(), req.user.id]);
      }
      if (changes.length) await audit(c, req, 'facility.categories', 'org_node', id, { changes });
      return { ok: true, changed: changes.length };
    });
  });
}

const canEdit = (role: string, approves: boolean) => ['platform_admin', 'super_admin', 'admin'].includes(role) || (role === 'manager' && approves);
