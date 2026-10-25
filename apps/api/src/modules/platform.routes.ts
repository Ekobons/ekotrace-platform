/**
 * Platform console (Ekobon staff only): companies, plans, access dates.
 * Creating a company also creates its main entity and its first Super admin
 * (temporary password shown once).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { localeOf } from '../lib/locale.js';
import { platformTx } from '../db/pool.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { PLANS } from '../lib/plans.js';

const plan = z.enum(['trial', 'starter', 'professional', 'enterprise']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Products a company has: EKOTRACE (own footprint), EKOFIN (financed emissions), CBAM Exporter (CBAM only), in any mix. */
const products = z.array(z.enum(['ekotrace', 'ekofin', 'cbam'])).min(1).max(3).transform((p) => [...new Set(p)]);

export async function platformRoutes(app: FastifyInstance) {
  app.get('/api/platform/companies', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({
      companies: (await c.query(
        `SELECT t.id, t.name, t.country, t.gwp_set, t.plan, t.products, t.status, t.access_start, t.access_expiry, t.created_at, t.notes,
                t.price::float8 AS price, t.billing_currency, t.billing_cycle, t.po_ref, t.billing_email,
                (SELECT count(*)::int FROM app_user u WHERE u.tenant_id = t.id AND NOT u.disabled) AS users,
                (SELECT count(*)::int FROM org_node n WHERE n.tenant_id = t.id AND n.kind = 'facility' AND n.active) AS facilities,
                (SELECT count(*)::int FROM activity a WHERE a.tenant_id = t.id) AS entries,
                (SELECT max(u.last_login_at) FROM app_user u WHERE u.tenant_id = t.id) AS last_login
           FROM tenant t ORDER BY t.name`)).rows,
      plans: Object.values(PLANS),
    }));
  });

  app.post('/api/platform/companies', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({
      name: z.string().trim().min(2).max(160), country: z.string().regex(/^[A-Za-z]{2}$/, 'Country as a 2-letter ISO code, e.g. GB, US, DE, IN'), gwpSet: z.enum(['AR4', 'AR5', 'AR6']).default('AR5'),
      plan: plan.default('enterprise'), accessExpiry: date.optional(), products: products.default(['ekotrace']),
      superAdmin: z.object({ name: z.string().trim().min(2).max(120), email: z.string().email().max(190) }),
    }).parse(req.body);
    const pw = temporaryPassword();
    const hash = await hashPassword(pw);
    return platformTx(async (c) => {
      if ((await c.query('SELECT 1 FROM app_user WHERE lower(email) = lower($1)', [b.superAdmin.email])).rowCount) {
        throw new AppError('Someone with this email already has an account', 409, 'DUPLICATE');
      }
      const t = (await c.query(
        `INSERT INTO tenant (name, country, gwp_set, plan, access_expiry, currency, timezone, products) VALUES ($1,$2,$3,$4,COALESCE($5::date, (current_date + interval '1 year')::date),$6,$7,$8) RETURNING *`,
        [b.name, b.country.toUpperCase(), b.gwpSet, b.plan, b.accessExpiry ?? null, localeOf(b.country).currency, localeOf(b.country).timezone, b.products])).rows[0];
      await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,$3)`, [t.id, b.name, t.country]);
      const u = (await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, created_by) VALUES ($1,$2,$3,'super_admin',$4,$5) RETURNING id, email`,
        [t.id, b.superAdmin.email.toLowerCase(), b.superAdmin.name, hash, req.user.id])).rows[0];
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'company.create','tenant',$1::text,$4,$5)`,
        [t.id, req.user.id, req.user.name, JSON.stringify({ name: b.name, plan: b.plan, products: b.products, superAdmin: u.email }), req.ip]);
      return { company: t, superAdmin: { email: u.email, temporaryPassword: pw } };
    });
  });

  app.patch('/api/platform/companies/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().trim().min(2).max(160).optional(), plan: plan.optional(), products: products.optional(), status: z.enum(['active', 'suspended']).optional(),
      accessExpiry: date.optional(), notes: z.string().max(1000).nullable().optional(),
      price: z.number().min(0).max(1e9).nullable().optional(), billingCurrency: z.string().regex(/^[A-Z]{3}$/).optional(), billingCycle: z.enum(['annual', 'monthly']).optional(),
      poRef: z.string().trim().max(80).nullable().optional(), billingEmail: z.string().email().max(190).nullable().optional().or(z.literal('').transform(() => null)) }).parse(req.body);
    return platformTx(async (c) => {
      const r = (await c.query(`UPDATE tenant SET name = COALESCE($2, name), plan = COALESCE($3, plan), status = COALESCE($4, status),
                                  access_expiry = COALESCE($5::date, access_expiry), notes = CASE WHEN $6 THEN $7 ELSE notes END
                                WHERE id = $1 RETURNING *`, [id, b.name ?? null, b.plan ?? null, b.status ?? null, b.accessExpiry ?? null, b.notes !== undefined, b.notes ?? null])).rows[0];
      if (!r) throw notFound('Company');
      const extra: [string, unknown][] = [['products', b.products], ['price', b.price], ['billing_currency', b.billingCurrency], ['billing_cycle', b.billingCycle], ['po_ref', b.poRef], ['billing_email', b.billingEmail]];
      for (const [col, v] of extra) if (v !== undefined) await c.query(`UPDATE tenant SET ${col} = $2 WHERE id = $1`, [id, v]);
      if (b.status === 'suspended') await c.query('DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE tenant_id = $1)', [id]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'company.update','tenant',$1::text,$4,$5)`,
        [id, req.user.id, req.user.name, JSON.stringify(b), req.ip]);
      return r;
    });
  });

}
