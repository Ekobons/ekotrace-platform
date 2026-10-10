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
  /** Share of the profile filled in (country, vendor number, industry, contact, reports emissions, climate target). */
  const COMPLETE = `((s.country IS NOT NULL)::int + (s.reference IS NOT NULL)::int + (s.industry IS NOT NULL)::int + (s.contact_email IS NOT NULL)::int
                     + (coalesce(s.reports_emissions, 'unknown') <> 'unknown')::int + (coalesce(s.climate_target, 'unknown') <> 'unknown')::int) / 6.0`;

  app.get('/api/suppliers', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ q: z.string().max(200).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50),
      filter: z.enum(['all', 'with_factor', 'without_factor', 'review', 'incomplete']).default('all'), country: z.string().max(10).optional(),
      sort: z.enum(['co2e', 'spend', 'name', 'lines']).default('co2e') }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const params: unknown[] = [q.limit, q.offset];
      const conds = ['true'];
      if (q.q) { params.push(`%${q.q.toLowerCase()}%`); conds.push(`(lower(s.name) LIKE $${params.length} OR s.norm LIKE $${params.length} OR lower(coalesce(s.reference,'')) LIKE $${params.length} OR EXISTS (SELECT 1 FROM unnest(s.aliases) a WHERE a LIKE $${params.length}))`); }
      if (q.filter === 'with_factor') conds.push('EXISTS (SELECT 1 FROM supplier_ef e WHERE e.supplier_id = s.id)');
      if (q.filter === 'without_factor') conds.push('NOT EXISTS (SELECT 1 FROM supplier_ef e WHERE e.supplier_id = s.id)');
      if (q.filter === 'review') conds.push(`s.review = 'possible_duplicate'`);
      if (q.filter === 'incomplete') conds.push(`${COMPLETE} < 1`);
      if (q.country) { params.push(q.country === 'none' ? null : q.country); conds.push(q.country === 'none' ? `s.country IS NULL AND $${params.length}::text IS NULL` : `s.country = $${params.length}`); }
      const order = { co2e: 'coalesce(x.co2e, 0) DESC', spend: 'coalesce(x.usd, 0) DESC', name: 's.name', lines: 'coalesce(x.lines, 0) DESC' }[q.sort];
      const rows = (await c.query(
        `SELECT s.id, s.name, s.aliases, s.country, s.reference, s.contact_email, s.industry, s.origin, s.active, s.review, s.duplicate_score, s.created_at,
                d.name AS duplicate_of_name, d.id AS duplicate_of, round(${COMPLETE}, 2)::float8 AS completeness,
                coalesce(x.lines, 0) AS lines, coalesce(x.usd, 0)::float8 AS usd, coalesce(x.co2e, 0)::float8 AS co2e, coalesce(x.supplier_lines, 0) AS supplier_lines,
                (SELECT count(*)::int FROM supplier_ef e WHERE e.supplier_id = s.id) AS factors, count(*) OVER () AS total
           FROM supplier s LEFT JOIN supplier d ON d.id = s.duplicate_of
           LEFT JOIN LATERAL (SELECT count(*)::int AS lines, sum(usd) AS usd, sum(co2e) FILTER (WHERE status IN ('ready','published')) AS co2e,
                                     count(*) FILTER (WHERE method = 'supplier')::int AS supplier_lines FROM purchase_line l WHERE l.supplier_id = s.id) x ON true
          WHERE ${conds.join(' AND ')}
          ORDER BY ${order}, s.name LIMIT $1 OFFSET $2`, params)).rows;
      const counts = (await c.query(`SELECT count(*)::int AS all, count(*) FILTER (WHERE review = 'possible_duplicate')::int AS review, count(*) FILTER (WHERE ${COMPLETE} < 1)::int AS incomplete FROM supplier s`)).rows[0];
      const autoLinked = Number((await c.query(`SELECT count(*) FROM supplier_match WHERE method = 'similar' AND NOT confirmed`)).rows[0].count);
      return { total: Number(rows[0]?.total ?? 0), counts: { ...counts, autoLinked }, suppliers: rows.map(({ total: _t, ...r }) => r) };
    });
  });

  /** What a person should look at: possible duplicates, and names linked automatically. */
  app.get('/api/suppliers/review', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => ({
      duplicates: (await c.query(
        `SELECT s.id, s.name, s.country, s.reference, s.duplicate_score::float8 AS score, d.id AS other_id, d.name AS other_name, d.country AS other_country, d.reference AS other_reference,
                (SELECT count(*)::int FROM purchase_line l WHERE l.supplier_id = s.id) AS lines, (SELECT count(*)::int FROM purchase_line l WHERE l.supplier_id = d.id) AS other_lines
           FROM supplier s JOIN supplier d ON d.id = s.duplicate_of WHERE s.review = 'possible_duplicate' ORDER BY s.duplicate_score DESC NULLS LAST, s.name LIMIT 500`)).rows,
      autoLinked: (await c.query(
        `SELECT m.id, m.name_seen, m.similar_to, m.score::float8 AS score, m.created_at, s.id AS supplier_id, s.name AS supplier,
                (SELECT count(*)::int FROM purchase_line l WHERE l.supplier_norm = m.norm) AS lines
           FROM supplier_match m JOIN supplier s ON s.id = m.supplier_id WHERE m.method = 'similar' AND NOT m.confirmed ORDER BY m.score, m.created_at DESC LIMIT 500`)).rows,
    }));
  });

  app.get('/api/suppliers/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query(`SELECT s.*, round(${COMPLETE}, 2)::float8 AS completeness FROM supplier s WHERE id = $1`, [id])).rows[0];
      if (!s) throw notFound('Supplier');
      const factors = (await c.query(
        `SELECT e.id, e.item_id, i.name AS item, e.co2e::float8 AS co2e, e.unit, e.price_year, to_char(e.valid_from,'YYYY-MM-DD') AS valid_from, to_char(e.valid_to,'YYYY-MM-DD') AS valid_to,
                e.source, e.boundary, e.created_at FROM supplier_ef e LEFT JOIN item i ON i.id = e.item_id WHERE e.supplier_id = $1 ORDER BY e.created_at DESC`, [id])).rows;
      const categories = (await c.query(
        `SELECT i.name AS item, count(*)::int AS lines, sum(l.usd)::float8 AS usd, sum(l.co2e) FILTER (WHERE l.status IN ('ready','published'))::float8 AS co2e FROM purchase_line l LEFT JOIN item i ON i.id = l.item_id
          WHERE l.supplier_id = $1 GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 15`, [id])).rows;
      const names = (await c.query(
        `SELECT m.id, m.name_seen, m.method, m.score::float8 AS score, m.confirmed, (SELECT count(*)::int FROM purchase_line l WHERE l.supplier_norm = m.norm) AS lines
           FROM supplier_match m WHERE m.supplier_id = $1 ORDER BY lines DESC LIMIT 50`, [id])).rows;
      const months = (await c.query(
        `SELECT to_char(period_start, 'YYYY-MM') AS month, sum(usd)::float8 AS usd, sum(co2e) FILTER (WHERE status IN ('ready','published'))::float8 AS co2e
           FROM purchase_line WHERE supplier_id = $1 AND period_start IS NOT NULL GROUP BY 1 ORDER BY 1`, [id])).rows;
      const duplicateOf = s.duplicate_of ? (await c.query('SELECT id, name FROM supplier WHERE id = $1', [s.duplicate_of])).rows[0] ?? null : null;
      return { supplier: s, factors, categories, names, months, duplicateOf };
    });
  });

  app.post('/api/suppliers', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const b = z.object({ name: z.string().trim().min(1).max(300), country: z.string().regex(/^[A-Z]{2}$/).optional(), reference: z.string().max(120).optional(), contactEmail: z.string().email().max(200).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const norm = normSupplier(b.name);
      if (!norm) throw new AppError('Name needed');
      const same = (await c.query(`SELECT name FROM supplier WHERE norm = $1 OR $1 = ANY(aliases) OR ($2::text IS NOT NULL AND lower(reference) = lower($2))`, [norm, b.reference ?? null])).rows[0];
      if (same) throw new AppError(`This supplier already exists: ${same.name}`, 409);
      const r = (await c.query(
        `INSERT INTO supplier (tenant_id, name, norm, country, reference, contact_email) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenant, b.name, norm, b.country ?? null, b.reference ?? null, b.contactEmail ?? null])).rows[0];
      await c.query(`INSERT INTO supplier_match (tenant_id, supplier_id, name_seen, norm, method, confirmed) VALUES ($1,$2,$3,$4,'manual',true) ON CONFLICT (tenant_id, norm) DO NOTHING`, [tenant, r.id, b.name, norm]);
      await audit(c, req, 'supplier.create', 'supplier', r.id, b);
      return r;
    });
  });

  /** The profile, completed by a person (names from the files stay as aliases). */
  app.patch('/api/suppliers/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = uuid.parse((req.params as { id: string }).id);
    const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
    const b = z.object({
      name: z.string().trim().min(1).max(300).optional(), country: opt(z.string().regex(/^[A-Z]{2}$/)), reference: opt(z.string().max(120)), trn: opt(z.string().max(40)),
      website: opt(z.string().max(200)), industry: opt(z.string().max(120)), size: opt(z.enum(['micro', 'small', 'medium', 'large'])), contactName: opt(z.string().max(120)),
      contactEmail: opt(z.string().email().max(200)), reportsEmissions: opt(z.enum(['yes', 'no', 'unknown'])), climateTarget: opt(z.enum(['sbti_validated', 'sbti_committed', 'own', 'none', 'unknown'])),
      note: opt(z.string().max(2000)), active: z.boolean().optional(),
    }).parse(req.body);
    const cols: Record<string, string> = { name: 'name', country: 'country', reference: 'reference', trn: 'trn', website: 'website', industry: 'industry', size: 'size', contactName: 'contact_name',
      contactEmail: 'contact_email', reportsEmissions: 'reports_emissions', climateTarget: 'climate_target', note: 'note', active: 'active' };
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('SELECT 1 FROM supplier WHERE id = $1', [id])).rowCount) throw notFound('Supplier');
      const sets: string[] = [], vals: unknown[] = [id];
      for (const [k, v] of Object.entries(b)) { if (v === undefined) continue; vals.push(v); sets.push(`${cols[k]} = $${vals.length}`); }
      if (b.reference) {
        const other = (await c.query(`SELECT name FROM supplier WHERE id <> $1 AND lower(reference) = lower($2)`, [id, b.reference])).rows[0];
        if (other) throw new AppError(`Vendor number ${b.reference} belongs to ${other.name}: merge the two suppliers instead`, 409);
      }
      if (sets.length) await c.query(`UPDATE supplier SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
      await audit(c, req, 'supplier.update', 'supplier', id, b);
      return { ok: true };
    });
  });

  /** Two records of one supplier: lines, factors and names move to `intoId`. */
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
      await c.query(`UPDATE supplier SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || $2::text[]) a WHERE a <> norm),
                            country = coalesce(country, $3), reference = coalesce(reference, $4), contact_email = coalesce(contact_email, $5), industry = coalesce(industry, $6),
                            review = CASE WHEN duplicate_of = $7 THEN 'ok' ELSE review END, duplicate_of = CASE WHEN duplicate_of = $7 THEN NULL ELSE duplicate_of END, updated_at = now()
                      WHERE id = $1`, [into.id, [from.norm, ...from.aliases], from.country, from.reference, from.contact_email, from.industry, id]);
      const lines = await c.query('UPDATE purchase_line SET supplier_id = $2 WHERE supplier_id = $1', [id, into.id]);
      await c.query('UPDATE supplier_ef SET supplier_id = $2 WHERE supplier_id = $1', [id, into.id]);
      await c.query(`UPDATE supplier_match SET supplier_id = $2, method = CASE WHEN method = 'new' THEN 'merged' ELSE method END, confirmed = true WHERE supplier_id = $1`, [id, into.id]);
      await c.query('DELETE FROM supplier WHERE id = $1', [id]);
      await recalcSupplier(c, tenant, [into.id], req.user.id);
      await audit(c, req, 'supplier.merge', 'supplier', into.id, { merged: from.name, into: into.name, lines: lines.rowCount });
      return { lines: lines.rowCount };
    });
  });

  /** A possible duplicate that is a different supplier. */
  app.post('/api/suppliers/:id/keep-separate', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE supplier SET review = 'ok', duplicate_of = NULL, duplicate_score = NULL WHERE id = $1 RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Supplier');
      await audit(c, req, 'supplier.keep_separate', 'supplier', id, r.rows[0]);
      return { ok: true };
    });
  });

  /** A name linked automatically: right (confirm) or wrong (split it off as its own supplier). */
  app.post('/api/suppliers/matches/:id/:action', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const p = z.object({ id: z.coerce.number().int().positive(), action: z.enum(['confirm', 'split']) }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query('SELECT * FROM supplier_match WHERE id = $1', [p.id])).rows[0];
      if (!m) throw notFound('Name');
      if (p.action === 'confirm') { await c.query('UPDATE supplier_match SET confirmed = true WHERE id = $1', [p.id]); return { ok: true }; }
      const s = (await c.query(
        `INSERT INTO supplier (tenant_id, name, norm, origin) VALUES ($1, $2, $3, 'upload') ON CONFLICT (tenant_id, norm) DO UPDATE SET updated_at = now() RETURNING id`,
        [tenant, m.name_seen, m.norm])).rows[0];
      await c.query(`UPDATE supplier SET aliases = array_remove(aliases, $2) WHERE id = $1`, [m.supplier_id, m.norm]);
      await c.query(`UPDATE supplier_match SET supplier_id = $2, method = 'manual', confirmed = true WHERE id = $1`, [p.id, s.id]);
      const lines = await c.query(`UPDATE purchase_line SET supplier_id = $2 WHERE supplier_norm = $1`, [m.norm, s.id]);
      await recalcSupplier(c, tenant, [m.supplier_id, s.id], req.user.id);
      await audit(c, req, 'supplier.split', 'supplier', s.id, { name: m.name_seen, from: m.supplier_id, lines: lines.rowCount });
      return { supplierId: s.id, lines: lines.rowCount };
    });
  });

  /**
   * Supplier analytics for a year: by country, spend category, Scope 3 category, month; the
   * largest suppliers, concentration, data quality and how complete the profiles are.
   * Calculated lines (ready or published) count; excluded and unmapped lines do not.
   */
  app.get('/api/suppliers/analytics', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const years = (await c.query(`SELECT DISTINCT extract(year FROM period_start)::int AS y FROM purchase_line WHERE period_start IS NOT NULL ORDER BY 1 DESC`)).rows.map((r) => r.y);
      const year = q.year ?? years[0] ?? new Date().getFullYear();
      const W = `l.status IN ('ready','published') AND extract(year FROM l.period_start) = $1`;
      const CAT = `CASE WHEN g.decision = 'move' AND g.target IS NOT NULL THEN g.target WHEN coalesce(l.capital, g.capital) THEN 'capital_goods' ELSE 'purchased_goods' END`;
      const one = async (sql: string) => (await c.query(sql, [year])).rows;
      const totals = (await one(`SELECT count(DISTINCT l.supplier_id)::int AS suppliers, count(*)::int AS lines, coalesce(sum(l.usd), 0)::float8 AS usd, coalesce(sum(l.co2e), 0)::float8 AS co2e,
                                        coalesce(sum(l.co2e) FILTER (WHERE l.method = 'supplier'), 0)::float8 AS co2e_supplier, count(*) FILTER (WHERE l.supplier_id IS NULL)::int AS no_supplier
                                   FROM purchase_line l WHERE ${W}`))[0];
      const byCountry = await one(`SELECT coalesce(s.country, '') AS country, count(DISTINCT s.id)::int AS suppliers, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e
                                     FROM purchase_line l LEFT JOIN supplier s ON s.id = l.supplier_id WHERE ${W} GROUP BY 1 ORDER BY 4 DESC NULLS LAST`);
      const byItem = await one(`SELECT coalesce(i.attrs->>'group', sc.name, 'Not mapped') AS "group", i.name AS item, count(DISTINCT l.supplier_id)::int AS suppliers, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e
                                  FROM purchase_line l LEFT JOIN item i ON i.id = l.item_id LEFT JOIN subcategory sc ON sc.id = i.subcategory_id WHERE ${W} GROUP BY 1, 2 ORDER BY 5 DESC NULLS LAST LIMIT 25`);
      const bySector = await one(`SELECT coalesce(sc.name, 'Not mapped') AS sector, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e FROM purchase_line l LEFT JOIN item i ON i.id = l.item_id
                                    LEFT JOIN subcategory sc ON sc.id = i.subcategory_id WHERE ${W} GROUP BY 1 ORDER BY 3 DESC NULLS LAST`);
      const byScope3 = await one(`SELECT ${CAT} AS category, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e FROM purchase_line l
                                    JOIN purchase_group g ON g.batch_id = l.batch_id AND g.key = l.group_key WHERE ${W} GROUP BY 1 ORDER BY 3 DESC`);
      const byMonth = await one(`SELECT to_char(l.period_start, 'YYYY-MM') AS month, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e,
                                        sum(l.co2e) FILTER (WHERE l.method = 'supplier')::float8 AS co2e_supplier FROM purchase_line l WHERE ${W} GROUP BY 1 ORDER BY 1`);
      const top = await one(`SELECT s.id, s.name, s.country, s.industry, sum(l.usd)::float8 AS usd, sum(l.co2e)::float8 AS co2e, count(*)::int AS lines,
                                    bool_or(l.method = 'supplier') AS own_factor, round(${COMPLETE}, 2)::float8 AS completeness,
                                    (array_agg(i.name ORDER BY l.co2e DESC NULLS LAST))[1] AS main_item
                               FROM purchase_line l JOIN supplier s ON s.id = l.supplier_id LEFT JOIN item i ON i.id = l.item_id WHERE ${W}
                              GROUP BY s.id ORDER BY 6 DESC NULLS LAST LIMIT 25`);
      // concentration: how many suppliers make up 50 % and 80 % of the emissions
      const cum = await one(`SELECT co2e FROM (SELECT sum(l.co2e)::float8 AS co2e FROM purchase_line l WHERE ${W} AND l.supplier_id IS NOT NULL GROUP BY l.supplier_id) x ORDER BY co2e DESC NULLS LAST`);
      const tot = cum.reduce((s, r) => s + Math.max(0, r.co2e ?? 0), 0);
      let run = 0, n50 = 0, n80 = 0;
      for (const [i, r] of cum.entries()) { run += Math.max(0, r.co2e ?? 0); if (!n50 && run >= 0.5 * tot) n50 = i + 1; if (!n80 && run >= 0.8 * tot) { n80 = i + 1; break; } }
      const profiles = (await c.query(
        `SELECT count(*)::int AS suppliers, count(*) FILTER (WHERE country IS NOT NULL)::int AS country, count(*) FILTER (WHERE reference IS NOT NULL)::int AS reference,
                count(*) FILTER (WHERE industry IS NOT NULL)::int AS industry, count(*) FILTER (WHERE contact_email IS NOT NULL)::int AS contact,
                count(*) FILTER (WHERE reports_emissions = 'yes')::int AS reports, count(*) FILTER (WHERE climate_target IN ('sbti_validated','sbti_committed','own'))::int AS target,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM supplier_ef e WHERE e.supplier_id = s.id))::int AS own_factor,
                count(*) FILTER (WHERE review = 'possible_duplicate')::int AS review FROM supplier s`)).rows[0];
      const targets = await one(`SELECT coalesce(s.climate_target, 'unknown') AS target, count(DISTINCT s.id)::int AS suppliers, sum(l.co2e)::float8 AS co2e
                                   FROM purchase_line l JOIN supplier s ON s.id = l.supplier_id WHERE ${W} GROUP BY 1 ORDER BY 3 DESC NULLS LAST`);
      return { year, years, totals, byCountry, byItem, bySector, byScope3, byMonth, top, concentration: { suppliers: cum.length, n50, n80 }, profiles, targets };
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
