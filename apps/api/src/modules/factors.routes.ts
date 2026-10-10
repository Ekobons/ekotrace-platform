/**
 * Emission factors: browse, add a corrected version, import a DESNZ file,
 * review import issues.
 *
 * Factors are never edited in place. A correction is a new version; the old
 * one is kept as "superseded", so any entry calculated with it can still show
 * exactly which value was used.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, platformTx, tx } from '../db/pool.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { parseDesnz } from '../import/desnz.js';
import { importDesnz } from '../import/desnzWrite.js';
import { importEpa, importOldList, parseEpa } from '../import/epa.js';
import { csvObjects } from '../lib/csv.js';

export async function factorRoutes(app: FastifyInstance) {
  app.get('/api/factors', async (req) => {
    const q = z.object({
      itemId: z.coerce.number().int().optional(), subcategoryId: z.coerce.number().int().optional(), year: z.coerce.number().int().optional(),
      basis: z.enum(['direct', 'wtt', 'outside_scopes', 'memo', 'scope2']).optional(), status: z.enum(['active', 'superseded', 'all']).default('active'),
      limit: z.coerce.number().int().min(1).max(2000).default(500),
    }).parse(req.query);
    const rows = await query(
      `SELECT f.id, f.item_id, i.name AS item, sc.name AS subcategory, f.basis, f.unit, f.co2e, f.region, f.valid_from, f.valid_to,
              f.status, f.version, f.supersedes_id, f.note, s.code AS source, s.gwp_set,
              (SELECT json_agg(json_build_object('gas', g.gas, 'kgPerUnit', g.kg_per_unit) ORDER BY g.gas) FROM factor_gas g WHERE g.factor_id = f.id) AS gases
         FROM factor f JOIN item i ON i.id = f.item_id JOIN subcategory sc ON sc.id = i.subcategory_id JOIN factor_source s ON s.id = f.source_id
        WHERE ($1::int IS NULL OR f.item_id = $1) AND ($2::int IS NULL OR i.subcategory_id = $2)
          AND ($3::int IS NULL OR $3 BETWEEN extract(year FROM f.valid_from) AND extract(year FROM f.valid_to))
          AND ($4::text IS NULL OR f.basis = $4) AND ($5 = 'all' OR f.status = $5)
        ORDER BY i.sort, i.name, f.valid_from DESC, f.basis, f.unit LIMIT $6`,
      [q.itemId ?? null, q.subcategoryId ?? null, q.year ?? null, q.basis ?? null, q.status, q.limit]);
    return { factors: rows };
  });

  app.get('/api/factor-sources', async () => ({
    sources: await query('SELECT id, code, publisher, title, year, version, gwp_set, url, licence, imported_at FROM factor_source ORDER BY year DESC NULLS LAST, code'),
  }));

  /** Add a factor (e.g. a country-specific value) or a corrected version of an existing one. */
  app.post('/api/admin/factors', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({
      itemId: z.number().int(), sourceCode: z.string().min(2).max(40), sourceTitle: z.string().max(200).optional(),
      region: z.string().length(2).or(z.literal('GLOBAL')).default('GLOBAL'), basis: z.enum(['direct', 'wtt', 'outside_scopes', 'memo', 'scope2']),
      unit: z.string(), co2e: z.number().finite().nullable(), gases: z.array(z.object({ gas: z.string(), kgPerUnit: z.number().finite().min(0) })).max(10).default([]),
      validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(500).optional(),
    }).parse(req.body);
    if (b.co2e == null && !b.gases.length) throw new AppError('Give a CO2e value, a gas split, or both');
    return tx(async (c) => {
      const src = (await c.query(`INSERT INTO factor_source (code, publisher, title) VALUES ($1,'Platform admin',COALESCE($2,$1))
                                  ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, [b.sourceCode, b.sourceTitle ?? null])).rows[0].id;
      const prev = (await c.query(`UPDATE factor SET status = 'superseded' WHERE item_id=$1 AND region=$2 AND basis=$3 AND unit=$4 AND valid_from=$5 AND status='active' RETURNING id, version`,
        [b.itemId, b.region, b.basis, b.unit, b.validFrom])).rows[0];
      const f = (await c.query(`INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, version, supersedes_id, note, created_by)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [b.itemId, src, b.region, b.basis, b.unit, b.co2e, b.validFrom, b.validTo, (prev?.version ?? 0) + 1, prev?.id ?? null, b.note ?? null, req.user.id])).rows[0];
      for (const g of b.gases) await c.query('INSERT INTO factor_gas (factor_id, gas, kg_per_unit) VALUES ($1,$2,$3)', [f.id, g.gas, g.kgPerUnit]);
      return { factor: f, replaced: prev?.id ?? null };
    });
  });

  app.get('/api/factors/:id/history', async (req) => {
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const rows = await query(`WITH RECURSIVE h AS (
        SELECT f.* FROM factor f WHERE f.id = $1
        UNION ALL SELECT p.* FROM factor p JOIN h ON p.id = h.supersedes_id)
      SELECT h.id, h.version, h.co2e, h.status, h.created_by, h.created_at, h.note, s.code AS source FROM h JOIN factor_source s ON s.id = h.source_id ORDER BY h.version DESC`, [id]);
    if (!rows.length) throw notFound('Factor');
    return { history: rows };
  });

  /**
   * Upload a DESNZ flat file (.xlsx) as the raw request body. Preview first
   * (?preview=1) to see what it contains; then send again without preview to import.
   */
  app.post('/api/admin/import/desnz', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const preview = z.object({ preview: z.coerce.boolean().optional() }).parse(req.query).preview;
    if (!Buffer.isBuffer(req.body) || req.body.length < 1000) throw new AppError('Send the .xlsx file as the request body (Content-Type: application/octet-stream)');
    const dir = mkdtempSync(join(tmpdir(), 'desnz-'));
    try {
      const file = join(dir, 'upload.xlsx');
      writeFileSync(file, req.body);
      const parsed = await parseDesnz(file);
      const summary = { year: parsed.year, version: parsed.version, gwpSet: parsed.gwpSet, fuelRows: parsed.fuels.length, gasRows: parsed.gases.length };
      if (preview) return { preview: true, ...summary };
      const result = await platformTx((c) => importDesnz(c, parsed, { createdBy: req.user.id }));
      return { preview: false, ...summary, ...result };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * US EPA supply chain factors (CSV, raw body, header x-filename). ?preview=1 first.
   */
  app.post('/api/admin/import/epa', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const preview = z.object({ preview: z.coerce.boolean().optional() }).parse(req.query).preview;
    if (!Buffer.isBuffer(req.body) || req.body.length < 100) throw new AppError('Send the EPA .csv file as the request body (Content-Type: application/octet-stream)');
    const filename = String(req.headers['x-filename'] ?? '');
    let parsed;
    try { parsed = parseEpa(req.body.toString('utf8'), filename); } catch (e) { throw new AppError((e as Error).message); }
    const summary = { version: parsed.version, priceYear: parsed.priceYear, rows: parsed.rows.length, skipped: parsed.skipped, sample: parsed.rows.slice(0, 5) };
    if (preview) return { preview: true, ...summary };
    return { preview: false, ...summary, ...(await platformTx((c) => importEpa(c, parsed, { createdBy: req.user.id }))) };
  });

  /**
   * The previous Ekotrace purchased-goods list, exported from its database as CSV:
   * purchase_goods_categories_ef (required), purchase_category, purchase_subcategory, typesofpurchase.
   */
  app.post('/api/admin/import/old-purchases', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({
      factors: z.string().min(10), categories: z.string().optional(), subcategories: z.string().optional(), types: z.string().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).default('USD'), priceYear: z.number().int().min(1990).max(2100).default(2022), preview: z.boolean().optional(),
    }).parse(req.body);
    const list = { factors: csvObjects(b.factors), categories: b.categories ? csvObjects(b.categories) : undefined, subcategories: b.subcategories ? csvObjects(b.subcategories) : undefined, types: b.types ? csvObjects(b.types) : undefined };
    if (!list.factors.length || !Object.keys(list.factors[0]!).some((k) => /^product$/i.test(k))) throw new AppError('purchase_goods_categories_ef export expected (columns id, product, NAIC_code, EFkgC02e_ccy…)');
    if (b.preview) return { preview: true, rows: list.factors.length, withNaics: list.factors.filter((r) => Object.entries(r).some(([k, v]) => /^naic_code$/i.test(k) && /\d/.test(v))).length, columns: Object.keys(list.factors[0]!) };
    return { preview: false, ...(await platformTx((c) => importOldList(c, list, { currency: b.currency, priceYear: b.priceYear, createdBy: req.user.id }))) };
  });

  app.get('/api/admin/import-issues', async (req) => {
    requirePlatformAdmin(req);
    return { issues: await query(`SELECT i.id, s.code AS source, i.severity, i.message, i.resolved, i.created_at FROM import_issue i
                                   LEFT JOIN factor_source s ON s.id = i.source_id ORDER BY i.resolved, i.severity DESC, i.id`) };
  });

  app.patch('/api/admin/import-issues/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const b = z.object({ resolved: z.boolean() }).parse(req.body);
    const [r] = await query('UPDATE import_issue SET resolved = $2 WHERE id = $1 RETURNING id, resolved', [id, b.resolved]);
    if (!r) throw notFound('Issue');
    return r;
  });
}
