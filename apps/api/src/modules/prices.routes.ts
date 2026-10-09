/**
 * Price list for spend-based entries (spend ÷ price = litres or kWh).
 *
 * Two layers: the platform list (tenant_id NULL, kept by Ekobon, e.g. the UAE
 * monthly fuel prices) and a company's own prices (its contract or card prices),
 * which win over the platform list. Every price has a source and a validity period.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx, query, tenantTx } from '../db/pool.js';
import { audit, requireRole } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function priceRoutes(app: FastifyInstance) {
  /** Fuels and electricity that can carry a price. */
  app.get('/api/price-items', async () => ({
    items: await query(
      `SELECT i.id, i.name, i.default_unit, s.name AS sub FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
        WHERE i.active AND (i.code = 'grid:electricity' OR (c.code = 'stationary_combustion' AND s.code IN ('liquid_fuels','gaseous_fuels','biofuel')))
        ORDER BY (i.code = 'grid:electricity') DESC, s.sort, i.sort, i.name`),
  }));

  app.get('/api/prices', async (req) => {
    const q = z.object({ region: z.string().length(2).optional(), itemId: z.coerce.number().int().optional() }).parse(req.query);
    const run = async (c: { query: (s: string, p: unknown[]) => Promise<{ rows: unknown[] }> }) => (await c.query(
      `SELECT p.id, p.tenant_id IS NULL AS platform, p.region, p.item_id, i.name AS item, p.currency, p.price, p.unit, p.valid_from::text, p.valid_to::text, p.source, p.created_at
         FROM price p JOIN item i ON i.id = p.item_id
        WHERE ($1::text IS NULL OR p.region = $1) AND ($2::int IS NULL OR p.item_id = $2)
        ORDER BY i.name, p.region, p.valid_from DESC`, [q.region ?? null, q.itemId ?? null])).rows;
    return { prices: req.user.tenantId ? await tenantTx(req.user.tenantId, run) : await platformTx(run) };
  });

  const body = z.object({
    region: z.string().length(2).transform((s) => s.toUpperCase()), itemId: z.number().int().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/), price: z.number().finite().positive(), unit: z.string().min(1),
    validFrom: isoDate, validTo: isoDate, source: z.string().trim().min(2).max(200),
  }).refine((b) => b.validTo >= b.validFrom, { message: 'The end date is before the start date' });

  /** Platform admin without a company open: platform list. Otherwise (Super admin, Admin): the company's own price. */
  app.post('/api/prices', async (req) => {
    const b = body.parse(req.body);
    const [it] = await query<{ code: string }>('SELECT code FROM item WHERE id = $1', [b.itemId]);
    if (!it) throw notFound('Fuel');
    const [u] = await query<{ dimension: string }>('SELECT dimension FROM unit WHERE code = $1', [b.unit]);
    if (!u) throw new AppError(`Unknown unit ${b.unit}`);
    if ((it.code === 'grid:electricity') !== (u.dimension === 'electricity')) throw new AppError(it.code === 'grid:electricity' ? 'Electricity is priced per kWh or MWh' : 'Fuel is priced per litre, kg, m³…');
    const insert = async (c: Parameters<Parameters<typeof platformTx>[0]>[0], tenant: string | null) => {
      const r = (await c.query(
        `INSERT INTO price (tenant_id, region, item_id, currency, price, unit, valid_from, valid_to, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, b.region, b.itemId, b.currency, b.price, b.unit, b.validFrom, b.validTo, b.source, req.user.id])).rows[0];
      if (tenant) await audit(c, req, 'price.add', 'price', r.id, b);
      return r;
    };
    if (!req.user.tenantId) {
      requireRole(req); // platform admin only
      return platformTx((c) => insert(c, null));
    }
    requireRole(req, 'super_admin', 'admin');
    return tenantTx(req.user.tenantId, (c) => insert(c, req.user.tenantId!));
  });

  app.delete('/api/prices/:id', async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const del = async (c: Parameters<Parameters<typeof platformTx>[0]>[0]) => {
      const r = await c.query(`DELETE FROM price WHERE id = $1 AND ${req.user.tenantId ? 'tenant_id IS NOT NULL' : 'tenant_id IS NULL'} RETURNING id`, [id]);
      if (!r.rowCount) throw notFound('Price');
      return { ok: true };
    };
    if (!req.user.tenantId) { requireRole(req); return platformTx(del); }
    requireRole(req, 'super_admin', 'admin');
    return tenantTx(req.user.tenantId, del);
  });
}
