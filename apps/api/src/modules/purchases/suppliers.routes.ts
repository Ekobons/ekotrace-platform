/**
 * Suppliers (from uploads, the API or added by hand) with their own emission factors,
 * and the currency settings used for spend: exchange rates and price indices.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx, platformTx } from '../../db/pool.js';
import { audit, requirePlatformAdmin, requireRole, requireTenant } from '../../lib/auth.js';
import { AppError, notFound } from '../../lib/errors.js';
import { enqueue } from '../../lib/jobs.js';
import { normSupplier } from './fields.js';
import { calcLines } from './pipeline.js';

const uuid = z.string().uuid();
const MANAGE = ['super_admin', 'admin', 'manager'] as const;

/** Recalculate unpublished lines of these suppliers in every open batch. */
async function recalcSupplier(c: Parameters<Parameters<typeof tenantTx>[1]>[0], tenant: string, supplierIds: string[], by: string) {
  const batches = (await c.query(
    `SELECT batch_id, count(*)::int AS n FROM purchase_line WHERE supplier_id = ANY($1) AND status <> 'published' GROUP BY 1`, [supplierIds])).rows;
  for (const b of batches) {
    if (b.n > 20000) await enqueue(c, tenant, 'purchase_calc', b.batch_id, {}, by);
    else await calcLines(c, b.batch_id, { supplierIds });
  }
  return batches.reduce((s, b) => s + b.n, 0);
}

export async function supplierRoutes(app: FastifyInstance) {
  app.get('/api/suppliers', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ q: z.string().max(200).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50),
      filter: z.enum(['all', 'with_factor', 'without_factor']).default('all') }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const params: unknown[] = [q.limit, q.offset];
      const conds = ['true'];
      if (q.q) { params.push(`%${q.q.toLowerCase()}%`); conds.push(`(lower(s.name) LIKE $${params.length} OR s.norm LIKE $${params.length} OR lower(coalesce(s.reference,'')) LIKE $${params.length})`); }
      if (q.filter === 'with_factor') conds.push('EXISTS (SELECT 1 FROM supplier_ef e WHERE e.supplier_id = s.id)');
      if (q.filter === 'without_factor') conds.push('NOT EXISTS (SELECT 1 FROM supplier_ef e WHERE e.supplier_id = s.id)');
      const rows = (await c.query(
        `SELECT s.id, s.name, s.aliases, s.country, s.reference, s.contact_email, s.origin, s.active, s.created_at,
                coalesce(x.lines, 0) AS lines, coalesce(x.usd, 0)::float8 AS usd, coalesce(x.co2e, 0)::float8 AS co2e, coalesce(x.supplier_lines, 0) AS supplier_lines,
                (SELECT count(*)::int FROM supplier_ef e WHERE e.supplier_id = s.id) AS factors, count(*) OVER () AS total
           FROM supplier s
           LEFT JOIN LATERAL (SELECT count(*)::int AS lines, sum(usd) AS usd, sum(co2e) FILTER (WHERE status IN ('ready','published')) AS co2e,
                                     count(*) FILTER (WHERE method = 'supplier')::int AS supplier_lines FROM purchase_line l WHERE l.supplier_id = s.id) x ON true
          WHERE ${conds.join(' AND ')}
          ORDER BY coalesce(x.usd, 0) DESC, s.name LIMIT $1 OFFSET $2`, params)).rows;
      return { total: Number(rows[0]?.total ?? 0), suppliers: rows.map(({ total: _t, ...r }) => r) };
    });
  });

  app.get('/api/suppliers/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query('SELECT * FROM supplier WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('Supplier');
      const factors = (await c.query(
        `SELECT e.id, e.item_id, i.name AS item, e.co2e::float8 AS co2e, e.unit, e.price_year, to_char(e.valid_from,'YYYY-MM-DD') AS valid_from, to_char(e.valid_to,'YYYY-MM-DD') AS valid_to,
                e.source, e.boundary, e.created_at FROM supplier_ef e LEFT JOIN item i ON i.id = e.item_id WHERE e.supplier_id = $1 ORDER BY e.created_at DESC`, [id])).rows;
      const categories = (await c.query(
        `SELECT i.name AS item, count(*)::int AS lines, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e FROM purchase_line l LEFT JOIN item i ON i.id = l.item_id
          WHERE l.supplier_id = $1 GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 15`, [id])).rows;
      return { supplier: s, factors, categories };
    });
  });

  app.post('/api/suppliers', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const b = z.object({ name: z.string().trim().min(1).max(300), country: z.string().regex(/^[A-Z]{2}$/).optional(), reference: z.string().max(120).optional(), contactEmail: z.string().email().max(200).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const norm = normSupplier(b.name);
      if (!norm) throw new AppError('Name needed');
      const r = (await c.query(
        `INSERT INTO supplier (tenant_id, name, norm, country, reference, contact_email) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, norm) DO NOTHING RETURNING id`,
        [tenant, b.name, norm, b.country ?? null, b.reference ?? null, b.contactEmail ?? null])).rows[0];
      if (!r) throw new AppError('A supplier with this name already exists', 409);
      await audit(c, req, 'supplier.create', 'supplier', r.id, b);
      return r;
    });
  });

  app.patch('/api/suppliers/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().trim().min(1).max(300).optional(), aliases: z.array(z.string().max(300)).max(50).optional(), country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
      reference: z.string().max(120).nullable().optional(), contactEmail: z.string().email().max(200).nullable().optional(), note: z.string().max(2000).nullable().optional(), active: z.boolean().optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query('SELECT * FROM supplier WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('Supplier');
      await c.query(
        `UPDATE supplier SET name = coalesce($2, name), aliases = coalesce($3, aliases), country = CASE WHEN $4::boolean THEN $5 ELSE country END,
                reference = CASE WHEN $6::boolean THEN $7 ELSE reference END, contact_email = CASE WHEN $8::boolean THEN $9 ELSE contact_email END,
                note = CASE WHEN $10::boolean THEN $11 ELSE note END, active = coalesce($12, active) WHERE id = $1`,
        [id, b.name ?? null, b.aliases ? [...new Set(b.aliases.map(normSupplier).filter(Boolean))] : null, b.country !== undefined, b.country ?? null,
         b.reference !== undefined, b.reference ?? null, b.contactEmail !== undefined, b.contactEmail ?? null, b.note !== undefined, b.note ?? null, b.active ?? null]);
      await audit(c, req, 'supplier.update', 'supplier', id, b);
      return { ok: true };
    });
  });

  /** Two spellings of one supplier: lines, factors and the other name move to `intoId`. */
  app.post('/api/suppliers/:id/merge', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ intoId: uuid }).parse(req.body);
    if (b.intoId === id) throw new AppError('Choose another supplier');
    return tenantTx(tenant, async (c) => {
      const from = (await c.query('SELECT * FROM supplier WHERE id = $1', [id])).rows[0];
      const into = (await c.query('SELECT * FROM supplier WHERE id = $1', [b.intoId])).rows[0];
      if (!from || !into) throw notFound('Supplier');
      await c.query(`UPDATE supplier SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || $2::text[]) a) WHERE id = $1`, [into.id, [from.norm, ...from.aliases]]);
      const lines = await c.query('UPDATE purchase_line SET supplier_id = $2 WHERE supplier_id = $1', [id, into.id]);
      await c.query('UPDATE supplier_ef SET supplier_id = $2 WHERE supplier_id = $1', [id, into.id]);
      await c.query('DELETE FROM supplier WHERE id = $1', [id]);
      await recalcSupplier(c, tenant, [into.id], req.user.id);
      await audit(c, req, 'supplier.merge', 'supplier', into.id, { merged: from.name, into: into.name, lines: lines.rowCount });
      return { lines: lines.rowCount };
    });
  });

  app.post('/api/suppliers/:id/factors', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({
      itemId: z.number().int().positive().nullable().optional(), co2e: z.number().finite().min(0), unit: z.string().min(1).max(10),
      priceYear: z.number().int().min(1990).max(2100).nullable().optional(), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      source: z.string().trim().min(2).max(300), boundary: z.string().max(120).optional(),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('SELECT 1 FROM supplier WHERE id = $1', [id])).rowCount) throw notFound('Supplier');
      const unit = (await c.query(`SELECT code, dimension FROM unit WHERE code = $1 OR $1 = ANY(aliases)`, [b.unit])).rows[0];
      if (!unit) throw new AppError(`Unit "${b.unit}" not known: use kg, t, L, m3, kWh, pcs or a currency (AED, USD…)`);
      const r = (await c.query(
        `INSERT INTO supplier_ef (tenant_id, supplier_id, item_id, co2e, unit, price_year, valid_from, valid_to, source, boundary, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,coalesce($7::date,'2000-01-01'),coalesce($8::date,'2100-12-31'),$9,$10,$11) RETURNING id`,
        [tenant, id, b.itemId ?? null, b.co2e, unit.code, unit.dimension.startsWith('money_') ? b.priceYear ?? null : null, b.validFrom ?? null, b.validTo ?? null, b.source, b.boundary ?? null, req.user.id])).rows[0];
      const lines = await recalcSupplier(c, tenant, [id], req.user.id);
      await audit(c, req, 'supplier.factor.create', 'supplier', id, b);
      return { id: r.id, linesRecalculated: lines };
    });
  });

  app.delete('/api/suppliers/:id/factors/:fid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const p = z.object({ id: uuid, fid: uuid }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const used = Number((await c.query(`SELECT count(*) FROM purchase_line WHERE supplier_ef_id = $1 AND status = 'published'`, [p.fid])).rows[0].count);
      if (used) throw new AppError(`Used by ${used} published lines: reopen those batches first`, 409);
      await c.query(`UPDATE purchase_line SET supplier_ef_id = NULL WHERE supplier_ef_id = $1`, [p.fid]);
      const r = await c.query('DELETE FROM supplier_ef WHERE id = $1 AND supplier_id = $2', [p.fid, p.id]);
      if (!r.rowCount) throw notFound('Factor');
      await recalcSupplier(c, tenant, [p.id], req.user.id);
      await audit(c, req, 'supplier.factor.delete', 'supplier', p.id, { factor: p.fid });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------- currencies --
  app.get('/api/currency', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ currency: z.string().regex(/^[A-Z]{3}$/).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const t = (await c.query('SELECT fx_method, currency FROM tenant WHERE id = $1', [tenant])).rows[0];
      const rates = (await c.query(
        `SELECT id, currency, kind, to_char(period,'YYYY-MM-DD') AS period, per_usd::float8 AS per_usd, source, tenant_id IS NOT NULL AS own FROM fx_rate
          WHERE ($1::text IS NULL OR currency = $1) ORDER BY currency, kind, period DESC LIMIT 2000`, [q.currency ?? null])).rows;
      const cpi = (await c.query(`SELECT region, year, value::float8 AS value, source FROM price_index ORDER BY region, year`)).rows;
      // currencies / months used by purchase lines that have no rate (the lines say so)
      const missing = (await c.query(
        `SELECT currency, to_char(period_start,'YYYY-MM') AS month, count(*)::int AS lines FROM purchase_line
          WHERE calc_error LIKE 'No exchange rate%' AND status <> 'published' GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 200`)).rows;
      const used = (await c.query(`SELECT currency, count(*)::int AS lines FROM purchase_line WHERE currency IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 30`)).rows;
      const fallbacks = (await c.query(
        `SELECT w AS warning, count(*)::int AS lines FROM (SELECT unnest(warnings) AS w FROM purchase_line WHERE status IN ('ready','published')) x GROUP BY 1 ORDER BY 2 DESC LIMIT 20`)).rows;
      return { fxMethod: t.fx_method, currency: t.currency, rates, cpi, missing, used, fallbacks };
    });
  });

  app.patch('/api/currency/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ fxMethod: z.enum(['month', 'year', 'fixed']).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query('UPDATE tenant SET fx_method = coalesce($2, fx_method), currency = coalesce($3, currency) WHERE id = $1', [tenant, b.fxMethod ?? null, b.currency ?? null]);
      await audit(c, req, 'methodology.currency', 'tenant', tenant, b);
      return b;
    });
  });

  /** Exchange rates (pasted rows). The company's own; the platform admin adds shared ones with shared=true. */
  app.post('/api/currency/rates', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = z.object({
      shared: z.boolean().default(false),
      rows: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), kind: z.enum(['month', 'year', 'fixed']), period: z.string().regex(/^\d{4}(-\d{2})?(-\d{2})?$/),
        perUsd: z.number().finite().positive(), source: z.string().trim().min(2).max(200) })).min(1).max(5000),
    }).parse(req.body);
    if (b.shared) requirePlatformAdmin(req);
    const norm = b.rows.map((r) => ({ ...r, period: r.kind === 'month' ? `${r.period.slice(0, 7)}-01` : `${r.period.slice(0, 4)}-01-01` }));
    const write = async (c: Parameters<Parameters<typeof tenantTx>[1]>[0]) => {
      for (const r of norm) {
        await c.query(
          `INSERT INTO fx_rate (tenant_id, currency, kind, period, per_usd, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), currency, kind, period) DO UPDATE SET per_usd = EXCLUDED.per_usd, source = EXCLUDED.source, created_by = EXCLUDED.created_by`,
          [b.shared ? null : tenant, r.currency, r.kind, r.period, r.perUsd, r.source, req.user.id]);
      }
    };
    if (b.shared) await platformTx(write);
    await tenantTx(tenant, async (c) => {
      if (!b.shared) await write(c);
      await audit(c, req, 'currency.rates', 'fx_rate', null, { shared: b.shared, rows: norm.length, currencies: [...new Set(norm.map((r) => r.currency))] });
    });
    return { saved: norm.length };
  });

  app.delete('/api/currency/rates/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = await c.query('DELETE FROM fx_rate WHERE id = $1 AND tenant_id = $2 RETURNING currency, period', [id, tenant]);
      if (!r.rowCount) throw new AppError('Only the company\'s own rates can be removed here', 404);
      await audit(c, req, 'currency.rate.delete', 'fx_rate', id, r.rows[0]);
      return { ok: true };
    });
  });

  /** Price index values (US CPI-U annual averages): platform admin. */
  app.post('/api/admin/price-index', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({ region: z.string().regex(/^[A-Z]{2}$/).default('US'), year: z.number().int().min(1990).max(2100), value: z.number().positive(), source: z.string().trim().min(2).max(300) }).parse(req.body);
    await platformTx((c) => c.query(
      `INSERT INTO price_index (region, year, value, source) VALUES ($1,$2,$3,$4) ON CONFLICT (region, year) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = now()`,
      [b.region, b.year, b.value, b.source]));
    return b;
  });
}
