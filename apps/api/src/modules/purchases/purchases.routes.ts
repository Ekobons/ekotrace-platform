/**
 * Purchased goods & services: upload (any layout), API, manual entry; review by group; publish.
 * See pipeline.ts for what happens to the lines.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { classify, normText, OVERLAP_LABEL } from '@ekotrace/calc';
import { tenantTx, type Tx } from '../../db/pool.js';
import { config } from '../../config.js';
import { audit, requireRole, requireTenant, type User } from '../../lib/auth.js';
import { scopeOf } from '../../lib/access.js';
import { AppError, notFound } from '../../lib/errors.js';
import { enqueue, registerJob, type Job } from '../../lib/jobs.js';
import { detectKind, findHeaderRow, previewFile, cellText } from '../../lib/sheet.js';
import { sendWorkbook, styleHeader } from '../../lib/xlsx.js';
import { apiClient } from '../meters.routes.js';
import { FIELDS, FIELD_LABEL, guessColumns, signature, normSupplier, type Field } from './fields.js';
import {
  buildLine, calcLines, explainLine, groupKey, insertLines, loadFacilities, mapGroups, MAX_LINES, prepareBatch, publishBatch, readFileLines, reopenBatch, spendIndex,
  type BatchSettings, type RawLine,
} from './pipeline.js';

const ENTER = ['super_admin', 'admin', 'manager', 'preparer'] as const;
const uuid = z.string().uuid();
const idParam = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);
const SPEND_CATEGORIES = ['purchased_goods', 'capital_goods', 'upstream_transport', 'business_travel', 'upstream_leased'];
const MAX_UPLOAD = 60 * 1024 * 1024;

// ---------------------------------------------------------------- jobs --
async function setBatch(tenant: string, id: string, status: string, error?: string | null) {
  await tenantTx(tenant, (c) => c.query(`UPDATE purchase_batch SET status = $2, error = coalesce($3, error), updated_at = now() WHERE id = $1`, [id, status, error ?? null]));
}
async function afterLines(job: Job, origin: 'upload' | 'api' | 'manual') {
  await setBatch(job.tenant_id, job.ref!, 'mapping');
  await tenantTx(job.tenant_id, async (c) => {
    await prepareBatch(c, job.tenant_id, job.ref!, origin);
    await mapGroups(c, job.tenant_id, job.ref!, { jobId: job.id });
    await calcLines(c, job.ref!, { jobId: job.id });
    await c.query(`UPDATE purchase_batch SET status = 'review', updated_at = now() WHERE id = $1`, [job.ref]);
  });
}
const guarded = (fn: (job: Job) => Promise<void>, failStatus = 'failed') => async (job: Job) => {
  try { await fn(job); } catch (e) { await setBatch(job.tenant_id, job.ref!, failStatus, (e as Error).message); throw e; }
};
registerJob('purchase_ingest', guarded(async (job) => {
  await setBatch(job.tenant_id, job.ref!, 'reading', null);
  await readFileLines(job.id, job.tenant_id, job.ref!);
  await afterLines(job, 'upload');
}));
registerJob('purchase_map', guarded((job) => afterLines(job, 'api')));
registerJob('purchase_calc', guarded(async (job) => {
  await tenantTx(job.tenant_id, async (c) => {
    if (job.args.remap) await mapGroups(c, job.tenant_id, job.ref!, { jobId: job.id });
    await calcLines(c, job.ref!, { jobId: job.id, keys: job.args.keys as string[] | undefined });
    await c.query(`UPDATE purchase_batch SET status = CASE WHEN status IN ('queued','mapping') THEN 'review' ELSE status END, updated_at = now() WHERE id = $1`, [job.ref]);
  });
}, 'review'));
registerJob('purchase_publish', guarded(async (job) => {
  await setBatch(job.tenant_id, job.ref!, 'publishing', null);
  const r = await tenantTx(job.tenant_id, (c) => publishBatch(c, job.tenant_id, job.ref!, job.args.user as User));
  await tenantTx(job.tenant_id, async (c) => {
    if (!r.entries) await c.query(`UPDATE purchase_batch SET status = 'review' WHERE id = $1`, [job.ref]);
    await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail) VALUES ($1, $2, $5, 'purchases.publish', 'purchase_batch', $3, $4)`,
      [job.tenant_id, (job.args.user as User).id, job.ref, JSON.stringify(r), (job.args.user as User).name]);
  });
}, 'review'));

// ---------------------------------------------------------------- helpers --
async function batchRow(c: Tx, id: string) {
  const b = (await c.query('SELECT * FROM purchase_batch WHERE id = $1', [id])).rows[0];
  if (!b) throw notFound('Purchase batch');
  return b;
}
/** Batches with lines of facilities the person cannot see are refused (unless they see everything). */
async function assertSees(c: Tx, req: FastifyRequest, batchId: string) {
  const scope = await scopeOf(c, req.user);
  if (['super_admin', 'platform_admin', 'verifier'].includes(req.user.role)) return scope;
  const other = (await c.query(`SELECT 1 FROM purchase_line WHERE batch_id = $1 AND facility_id IS NOT NULL AND NOT (facility_id = ANY($2)) LIMIT 1`, [batchId, [...scope.see]])).rowCount;
  const own = (await c.query(`SELECT created_by FROM purchase_batch WHERE id = $1`, [batchId])).rows[0]?.created_by === req.user.id;
  if (other && !own) throw new AppError('This batch has lines of facilities you cannot see', 403, 'FORBIDDEN');
  return scope;
}
const jobOf = async (c: Tx, batchId: string) => (await c.query(`SELECT id, kind, status, progress, error FROM job WHERE ref = $1 ORDER BY id DESC LIMIT 1`, [batchId])).rows[0] ?? null;

const lineSchema = z.object({
  date: z.string().max(40).optional().nullable(), description: z.string().trim().min(1).max(1000), amount: z.union([z.number(), z.string().max(40)]).optional().nullable(),
  currency: z.string().max(8).optional().nullable(), quantity: z.union([z.number(), z.string().max(40)]).optional().nullable(), unit: z.string().max(30).optional().nullable(),
  supplier: z.string().max(300).optional().nullable(), category: z.string().max(300).optional().nullable(), glAccount: z.string().max(300).optional().nullable(),
  poNumber: z.string().max(120).optional().nullable(), facility: z.string().max(200).optional().nullable(), supplierEf: z.number().min(0).optional().nullable(),
  supplierEfUnit: z.string().max(30).optional().nullable(), capital: z.boolean().optional().nullable(),
  supplierRef: z.string().max(80).optional().nullable(), supplierCountry: z.string().max(80).optional().nullable(),
});
const toRaw = (l: z.infer<typeof lineSchema>): RawLine => ({
  date: l.date ?? null, description: l.description, amount: l.amount ?? null, currency: l.currency ?? null, quantity: l.quantity ?? null, unit: l.unit ?? null,
  supplier: l.supplier ?? null, category: l.category ?? null, gl: l.glAccount ?? null, po: l.poNumber ?? null, facility: l.facility ?? null,
  supplierEf: l.supplierEf ?? null, supplierEfUnit: l.supplierEfUnit ?? null, capital: l.capital == null ? null : l.capital ? 'yes' : 'no',
  supplierRef: l.supplierRef ?? null, supplierCountry: l.supplierCountry ?? null,
});

// ----------------------------------------------------------------- routes --
export async function purchaseRoutes(app: FastifyInstance) {
  app.get('/api/purchases/meta', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const t = (await c.query('SELECT fx_method, currency, ai_mapping FROM tenant WHERE id = $1', [tenant])).rows[0];
      const cats = (await c.query(`SELECT id, code, name, ghg_category FROM category WHERE code = ANY($1) ORDER BY sort`, [SPEND_CATEGORIES])).rows;
      const factorSet = (await c.query(
        `SELECT s.code, s.title, count(*)::int AS n FROM factor f JOIN factor_source s ON s.id = f.source_id JOIN item i ON i.id = f.item_id JOIN subcategory sc ON sc.id = i.subcategory_id
           JOIN category ca ON ca.id = sc.category_id WHERE ca.code = 'purchased_goods' AND f.status = 'active' GROUP BY 1, 2 ORDER BY 3 DESC`)).rows;
      return {
        fields: FIELDS.map((f) => ({ field: f, label: FIELD_LABEL[f] })), fxMethod: t.fx_method, currency: t.currency, aiMapping: t.ai_mapping,
        aiAvailable: !!config.aiMap, aiName: config.aiMap?.name ?? null, overlap: OVERLAP_LABEL, categories: cats, factorSets: factorSet, maxLines: MAX_LINES,
      };
    });
  });

  app.patch('/api/purchases/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ aiMapping: z.boolean() }).parse(req.body);
    if (b.aiMapping && !config.aiMap) throw new AppError('No approved AI service is configured on this deployment');
    return tenantTx(tenant, async (c) => {
      await c.query('UPDATE tenant SET ai_mapping = $2 WHERE id = $1', [tenant, b.aiMapping]);
      await audit(c, req, 'purchases.ai_mapping', 'tenant', tenant, b);
      return b;
    });
  });

  /** Step 1: the file. Stored, its sheets and first rows returned with a guess of the columns. */
  app.post('/api/purchases/upload', { bodyLimit: MAX_UPLOAD }, async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 10) throw new AppError('Send the file as the request body (Content-Type: application/octet-stream)');
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'purchases')).replace(/[^\w.\- ()&]/g, '_').slice(0, 200);
    const kind = detectKind(buf, filename);
    if (kind === 'xls') throw new AppError('Old Excel format (.xls): save it as .xlsx or .csv first');
    if (kind === 'unknown') throw new AppError('Upload an Excel (.xlsx) or CSV file');
    const again = z.object({ again: z.coerce.boolean().optional() }).parse(req.query).again;
    const sha = createHash('sha256').update(buf).digest('hex');
    let preview;
    try { preview = await previewFile(buf, kind); } catch { throw new AppError('The file could not be read: is it a valid .xlsx or .csv?'); }
    const sheets = preview.sheets.filter((s) => s.rows.length);
    if (!sheets.length) throw new AppError('The file has no rows');
    return tenantTx(tenant, async (c) => {
      const old = (await c.query(
        `SELECT b.id, b.name, b.created_at FROM purchase_batch b JOIN document d ON d.id = b.document_id WHERE d.sha256 = $1 ORDER BY b.created_at DESC LIMIT 1`, [sha])).rows[0];
      if (old && !again) throw new AppError(`This file was already uploaded on ${new Date(old.created_at).toISOString().slice(0, 10)} ("${old.name}"). Upload it again only if it is meant to be counted twice.`, 409, 'DUPLICATE_FILE');
      const doc = (await c.query(
        `INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1, 'purchases', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, sha256) DO UPDATE SET uploaded_at = document.uploaded_at RETURNING id`,
        [tenant, filename, kind === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf.length, sha, buf, req.user.id])).rows[0];
      const t = (await c.query('SELECT currency FROM tenant WHERE id = $1', [tenant])).rows[0];
      const out = sheets.map((s) => {
        const headerRow = findHeaderRow(s.rows);
        const headers = s.rows[headerRow]!.map((h) => cellText(h));
        return { name: s.name, headerRow, headers, rows: s.rows.slice(0, 12).map((r) => r.map((x) => cellText(x))), guess: guessColumns(headers), signature: signature(headers) };
      });
      // a layout seen before
      const profiles = (await c.query('SELECT id, name, signature, settings FROM purchase_profile WHERE signature = ANY($1)', [out.map((s) => s.signature)])).rows;
      const b = (await c.query(
        `INSERT INTO purchase_batch (tenant_id, source, name, document_id, settings, status, created_by) VALUES ($1, 'upload', $2, $3, $4, 'setup', $5) RETURNING id`,
        [tenant, filename.replace(/\.(xlsx|csv|txt)$/i, ''), doc.id, JSON.stringify({ kind }), req.user.id])).rows[0];
      await audit(c, req, 'purchases.upload', 'purchase_batch', b.id, { filename, size: buf.length });
      return { batchId: b.id, filename, kind, defaultCurrency: t.currency, sheets: out.map((s) => ({ ...s, profile: profiles.find((p) => p.signature === s.signature) ?? null })) };
    });
  });

  /** Step 2: which column is which → read the whole file in the background. */
  app.post('/api/purchases/batches/:id/setup', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    const b = z.object({
      sheet: z.string().max(200).optional(), headerRow: z.number().int().min(0).max(14),
      columns: z.partialRecord(z.enum(FIELDS), z.union([z.string().max(200), z.array(z.string().max(200)).min(1).max(3)])),
      dateFormat: z.enum(['dmy', 'mdy', 'ymd']).default('dmy'), currency: z.string().regex(/^[A-Z]{3}$/),
      facilityId: uuid.nullable().optional(), period: z.object({ year: z.number().int().min(2000).max(2100).optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).nullable().optional(),
      name: z.string().trim().min(1).max(120).optional(), remember: z.boolean().default(true), headers: z.array(z.string()).max(300).optional(),
    }).parse(req.body);
    if (!b.columns.description) throw new AppError('Choose the description column');
    if (!b.columns.amount && !b.columns.quantity) throw new AppError('Choose the amount column');
    if (!b.columns.date && !b.period) throw new AppError('Choose the date column, or the period the file covers');
    if (!b.columns.facility && !b.facilityId) throw new AppError('Choose the facility column, or the facility the file belongs to');
    return tenantTx(tenant, async (c) => {
      const batch = await batchRow(c, id);
      if (batch.status !== 'setup' && batch.status !== 'failed') throw new AppError('This batch has already been read');
      if (b.facilityId) {
        const scope = await scopeOf(c, req.user);
        if (!scope.enter.has(b.facilityId)) throw new AppError('You cannot enter data for that facility', 403, 'FORBIDDEN');
      }
      const settings: BatchSettings & { kind: string } = {
        kind: batch.settings.kind, sheet: b.sheet, headerRow: b.headerRow, columns: b.columns as BatchSettings['columns'], dateFormat: b.dateFormat, currency: b.currency,
        facilityId: b.facilityId ?? null, period: b.period ?? null,
      };
      await c.query(`UPDATE purchase_batch SET settings = $2, name = coalesce($3, name), status = 'queued', error = NULL, updated_at = now() WHERE id = $1`, [id, JSON.stringify(settings), b.name ?? null]);
      if (b.remember && b.headers?.length) {
        const sig = signature(b.headers);
        await c.query(
          `INSERT INTO purchase_profile (tenant_id, name, signature, settings) VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, signature) DO UPDATE SET settings = EXCLUDED.settings, used_at = now()`,
          [tenant, b.name ?? batch.name, sig, JSON.stringify({ ...settings, kind: undefined })]);
      }
      const job = await enqueue(c, tenant, 'purchase_ingest', id, {}, req.user.id);
      await audit(c, req, 'purchases.setup', 'purchase_batch', id, { columns: b.columns });
      return { batchId: id, jobId: job };
    });
  });

  app.get('/api/purchases/batches', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const all = ['super_admin', 'platform_admin', 'verifier'].includes(req.user.role);
      const rows = (await c.query(
        `SELECT b.id, b.name, b.source, b.status, b.error, b.created_at, b.published_at, b.created_by, u.name AS created_by_name,
                coalesce(s.lines, 0) AS lines, coalesce(s.ready, 0) AS ready, coalesce(s.published, 0) AS published, coalesce(s.attention, 0) AS attention,
                coalesce(s.usd, 0) AS usd, coalesce(s.co2e, 0) AS co2e, j.progress, j.status AS job_status
           FROM purchase_batch b LEFT JOIN app_user u ON u.id::text = b.created_by
           LEFT JOIN LATERAL (SELECT count(*)::int AS lines, count(*) FILTER (WHERE status = 'ready')::int AS ready, count(*) FILTER (WHERE status = 'published')::int AS published,
                                     count(*) FILTER (WHERE status IN ('problem','unmapped','flagged'))::int AS attention, sum(usd)::float8 AS usd,
                                     sum(co2e) FILTER (WHERE status IN ('ready','published'))::float8 AS co2e,
                                     bool_and(facility_id IS NULL OR facility_id = ANY($1)) AS visible
                                FROM purchase_line l WHERE l.batch_id = b.id) s ON true
           LEFT JOIN LATERAL (SELECT progress, status FROM job WHERE ref = b.id ORDER BY id DESC LIMIT 1) j ON true
          WHERE $2 OR s.visible IS NOT FALSE OR b.created_by = $3
          ORDER BY b.created_at DESC LIMIT 200`, [[...scope.see], all, req.user.id])).rows;
      return { batches: rows };
    });
  });

  app.get('/api/purchases/batches/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idParam(req);
    return tenantTx(tenant, async (c) => {
      const b = await batchRow(c, id);
      await assertSees(c, req, id);
      const counts = (await c.query(
        `SELECT status, count(*)::int AS lines, coalesce(sum(usd), 0)::float8 AS usd, coalesce(sum(co2e), 0)::float8 AS co2e FROM purchase_line WHERE batch_id = $1 GROUP BY status`, [id])).rows;
      const byCategory = (await c.query(
        `SELECT CASE WHEN g.decision = 'move' AND g.target IS NOT NULL THEN g.target WHEN coalesce(l.capital, g.capital) THEN 'capital_goods' ELSE 'purchased_goods' END AS category,
                count(*)::int AS lines, sum(l.co2e)::float8 AS co2e, sum(l.usd)::float8 AS usd
           FROM purchase_line l JOIN purchase_group g ON g.batch_id = l.batch_id AND g.key = l.group_key
          WHERE l.batch_id = $1 AND l.status IN ('ready','published') GROUP BY 1 ORDER BY 3 DESC NULLS LAST`, [id])).rows;
      const byMethod = (await c.query(`SELECT method, count(*)::int AS lines, sum(co2e)::float8 AS co2e FROM purchase_line WHERE batch_id = $1 AND status IN ('ready','published') GROUP BY 1`, [id])).rows;
      const problems = (await c.query(
        `SELECT p AS problem, count(*)::int AS lines FROM (SELECT unnest(problems) AS p FROM purchase_line WHERE batch_id = $1
           UNION ALL SELECT calc_error FROM purchase_line WHERE batch_id = $1 AND calc_error IS NOT NULL AND cardinality(problems) = 0 AND status = 'problem') x
          GROUP BY 1 ORDER BY 2 DESC LIMIT 25`, [id])).rows;
      const groups = (await c.query(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE item_id IS NULL)::int AS unmapped, count(*) FILTER (WHERE overlap IS NOT NULL AND overlap <> 'capital_goods' AND decision IS NULL)::int AS flagged, count(*) FILTER (WHERE overlap = 'capital_goods' AND decision IS NULL AND NOT capital)::int AS capital_hint,
                count(*) FILTER (WHERE map_method IN ('text','ai') AND confidence < 0.6)::int AS check FROM purchase_group WHERE batch_id = $1`, [id])).rows[0];
      const facilitiesMissing = (await c.query(
        `SELECT facility_text AS value, count(*)::int AS lines FROM purchase_line WHERE batch_id = $1 AND facility_id IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 50`, [id])).rows;
      const entries = (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'approved')::int AS approved FROM activity WHERE purchase_batch_id = $1`, [id])).rows[0];
      const period = (await c.query(`SELECT to_char(min(period_start),'YYYY-MM-DD') AS "from", to_char(max(period_end),'YYYY-MM-DD') AS "to" FROM purchase_line WHERE batch_id = $1`, [id])).rows[0];
      const filename = b.document_id ? (await c.query('SELECT filename, size FROM document WHERE id = $1', [b.document_id])).rows[0] : null;
      return { batch: { ...b, file: filename }, job: await jobOf(c, id), counts, byCategory, byMethod, problems, groups, facilitiesMissing, entries, period };
    });
  });

  /** Groups of a batch (one per distinct description), with filters. */
  app.get('/api/purchases/batches/:id/groups', async (req) => {
    const tenant = requireTenant(req);
    const id = idParam(req);
    const q = z.object({
      filter: z.enum(['all', 'unmapped', 'check', 'flagged', 'capital', 'excluded', 'moved', 'mapped']).default('all'), q: z.string().max(200).optional(),
      offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(200).default(50), sort: z.enum(['spend', 'lines', 'name', 'confidence']).default('spend'),
    }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      await batchRow(c, id);
      await assertSees(c, req, id);
      const where = {
        all: 'true', unmapped: 'g.item_id IS NULL', check: `g.map_method IN ('text','ai') AND g.confidence < 0.6`, flagged: `g.overlap IS NOT NULL AND g.overlap <> 'capital_goods' AND g.decision IS NULL`, capital: `g.overlap = 'capital_goods' OR g.capital`,
        excluded: `g.decision = 'exclude'`, moved: `g.decision = 'move'`, mapped: 'g.item_id IS NOT NULL',
      }[q.filter];
      const order = { spend: 'abs(g.usd) DESC', lines: 'g.lines DESC', name: 'g.description', confidence: 'g.confidence NULLS FIRST' }[q.sort];
      const params: unknown[] = [id, q.limit, q.offset];
      let search = '';
      if (q.q) { params.push(`%${q.q.toLowerCase()}%`); search = ` AND (lower(g.description) LIKE $4 OR lower(coalesce(g.category_text,'')) LIKE $4 OR lower(coalesce(g.supplier,'')) LIKE $4)`; }
      const rows = (await c.query(
        `SELECT g.key, g.description, g.category_text, g.gl_account, g.supplier, g.lines, g.usd::float8 AS usd, g.item_id, i.name AS item_name, i.attrs->>'naics' AS naics,
                g.map_method, g.confidence::float8 AS confidence, g.candidates, g.overlap, g.overlap_why, g.decision, g.target, g.capital,
                (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) AS n FROM purchase_line l WHERE l.batch_id = g.batch_id AND l.group_key = g.key GROUP BY status) s) AS statuses,
                (SELECT sum(co2e)::float8 FROM purchase_line l WHERE l.batch_id = g.batch_id AND l.group_key = g.key) AS co2e,
                count(*) OVER () AS total
           FROM purchase_group g LEFT JOIN item i ON i.id = g.item_id
          WHERE g.batch_id = $1 AND ${where}${search}
          ORDER BY ${order}, g.key LIMIT $2 OFFSET $3`, params)).rows;
      // names of the candidates
      const ids = [...new Set(rows.flatMap((r) => (r.candidates ?? []).map((x: { itemId: number }) => x.itemId)))];
      const names = new Map((await c.query('SELECT id, name FROM item WHERE id = ANY($1)', [ids])).rows.map((r) => [r.id, r.name]));
      return {
        total: Number(rows[0]?.total ?? 0),
        groups: rows.map(({ total: _t, ...r }) => ({ ...r, candidates: (r.candidates ?? []).slice(0, 5).map((x: { itemId: number; score: number }) => ({ ...x, name: names.get(x.itemId) })) })),
      };
    });
  });

  /** Map / decide groups: spend category, keep / move / exclude, capital goods; optionally remembered for next time. */
  app.patch('/api/purchases/batches/:id/groups', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    const b = z.object({
      keys: z.array(z.string().max(400)).min(1).max(5000), itemId: z.number().int().positive().nullable().optional(),
      decision: z.enum(['keep', 'move', 'exclude']).nullable().optional(), target: z.enum(['business_travel', 'upstream_transport', 'upstream_leased', 'capital_goods']).nullable().optional(),
      capital: z.boolean().optional(), remember: z.boolean().default(true),
    }).parse(req.body);
    if (b.decision === 'move' && !b.target) throw new AppError('Choose the category to move to');
    return tenantTx(tenant, async (c) => {
      const batch = await batchRow(c, id);
      await assertSees(c, req, id);
      if (['reading', 'mapping', 'publishing', 'queued'].includes(batch.status)) throw new AppError('The batch is still being processed: try again in a moment', 409);
      const published = Number((await c.query(`SELECT count(*) FROM purchase_line WHERE batch_id = $1 AND group_key = ANY($2) AND status = 'published'`, [id, b.keys])).rows[0].count);
      if (published) throw new AppError(`${published} of these lines are published: reopen the batch to change them`, 409);
      if (b.itemId) {
        const ok = (await c.query(`SELECT 1 FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category ca ON ca.id = s.category_id WHERE i.id = $1 AND ca.code = 'purchased_goods' AND i.active`, [b.itemId])).rowCount;
        if (!ok) throw new AppError('Not a spend category');
      }
      const sets: string[] = [], vals: unknown[] = [id, b.keys, req.user.id];
      if (b.itemId !== undefined) { vals.push(b.itemId); sets.push(`item_id = $${vals.length}`, `map_method = CASE WHEN $${vals.length}::int IS NULL THEN NULL ELSE 'manual' END`, `confidence = CASE WHEN $${vals.length}::int IS NULL THEN NULL ELSE 1 END`); }
      if (b.decision !== undefined) { vals.push(b.decision); sets.push(`decision = $${vals.length}`); vals.push(b.decision === 'move' ? b.target : null); sets.push(`target = $${vals.length}`); }
      if (b.capital !== undefined) { vals.push(b.capital); sets.push(`capital = $${vals.length}`); }
      if (!sets.length) throw new AppError('Nothing to change');
      const g = await c.query(`UPDATE purchase_group SET ${sets.join(', ')}, updated_by = $3, updated_at = now() WHERE batch_id = $1 AND key = ANY($2) RETURNING key, description`, vals);
      // the category of a re-mapped group may now overlap (or no longer)
      if (b.itemId !== undefined) {
        const naics = b.itemId ? (await c.query(`SELECT attrs->>'naics' AS n FROM item WHERE id = $1`, [b.itemId])).rows[0]?.n : null;
        const { detectOverlap } = await import('@ekotrace/calc');
        for (const r of (await c.query(`SELECT key, description, category_text, gl_account, decision FROM purchase_group WHERE batch_id = $1 AND key = ANY($2)`, [id, b.keys])).rows) {
          const o = detectOverlap([r.description, r.category_text, r.gl_account].filter(Boolean).join(' '), naics);
          await c.query(`UPDATE purchase_group SET overlap = $3, overlap_why = $4 WHERE batch_id = $1 AND key = $2`, [id, r.key, o?.target ?? null, o?.why ?? null]);
        }
      }
      if (b.remember) {
        for (const r of g.rows) {
          await c.query(
            `INSERT INTO purchase_rule (tenant_id, field, pattern, item_id, decision, target, capital, created_by) VALUES ($1, 'text', $2, $3, $4, $5, $6, $7)
             ON CONFLICT (tenant_id, field, pattern) DO UPDATE SET item_id = coalesce(EXCLUDED.item_id, purchase_rule.item_id), decision = coalesce(EXCLUDED.decision, purchase_rule.decision),
                    target = coalesce(EXCLUDED.target, purchase_rule.target), capital = coalesce(EXCLUDED.capital, purchase_rule.capital), created_by = EXCLUDED.created_by`,
            [tenant, normText(r.description), b.itemId ?? null, b.decision ?? null, b.decision === 'move' ? b.target : null, b.capital ?? null, req.user.id]);
        }
      }
      const n = Number((await c.query(`SELECT count(*) FROM purchase_line WHERE batch_id = $1 AND group_key = ANY($2)`, [id, b.keys])).rows[0].count);
      if (n > 20000) { await enqueue(c, tenant, 'purchase_calc', id, { keys: b.keys }, req.user.id); return { groups: g.rowCount, lines: n, background: true }; }
      await calcLines(c, id, { keys: b.keys });
      return { groups: g.rowCount, lines: n, background: false };
    });
  });

  app.get('/api/purchases/batches/:id/lines', async (req) => {
    const tenant = requireTenant(req);
    const id = idParam(req);
    const q = z.object({ status: z.enum(['problem', 'unmapped', 'flagged', 'excluded', 'ready', 'published', 'duplicate', 'warning']).optional(), group: z.string().max(400).optional(),
      q: z.string().max(200).optional(), offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      await batchRow(c, id);
      await assertSees(c, req, id);
      const params: unknown[] = [id, q.limit, q.offset];
      const conds = ['l.batch_id = $1'];
      if (q.status === 'duplicate') conds.push('l.dup_of IS NOT NULL');
      else if (q.status === 'warning') conds.push('cardinality(l.warnings) > 0');
      else if (q.status) { params.push(q.status); conds.push(`l.status = $${params.length}`); }
      if (q.group) { params.push(q.group); conds.push(`l.group_key = $${params.length}`); }
      if (q.q) { params.push(`%${q.q.toLowerCase()}%`); conds.push(`(lower(l.description) LIKE $${params.length} OR lower(coalesce(l.supplier_text,'')) LIKE $${params.length} OR lower(coalesce(l.po_ref,'')) LIKE $${params.length})`); }
      const rows = (await c.query(
        `SELECT l.id, l.row_no, to_char(l.purchase_date,'YYYY-MM-DD') AS date, to_char(l.period_start,'YYYY-MM') AS month, l.description, l.category_text, l.supplier_text, l.po_ref,
                f.name AS facility, l.facility_text, l.amount::float8 AS amount, l.currency, l.quantity::float8 AS quantity, l.unit, l.status, l.method, i.name AS item, l.co2e::float8 AS co2e,
                l.usd::float8 AS usd, l.fx_per_usd::float8 AS fx, l.fx_kind, l.cpi_ratio::float8 AS cpi, l.problems, l.warnings, l.calc_error, l.dup_of, l.activity_id, count(*) OVER () AS total
           FROM purchase_line l LEFT JOIN org_node f ON f.id = l.facility_id LEFT JOIN item i ON i.id = l.item_id
          WHERE ${conds.join(' AND ')} ORDER BY l.row_no LIMIT $2 OFFSET $3`, params)).rows;
      return { total: Number(rows[0]?.total ?? 0), lines: rows.map(({ total: _t, ...r }) => r) };
    });
  });

  app.get('/api/purchases/lines/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.coerce.number().int().positive().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const l = (await c.query(`SELECT batch_id FROM purchase_line WHERE id = $1`, [id])).rows[0];
      if (!l) throw notFound('Line');
      await assertSees(c, req, l.batch_id);
      return explainLine(c, String(id));
    });
  });

  /** A facility written in the file that was not recognised → one of the company's facilities. */
  app.post('/api/purchases/batches/:id/facilities', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    const b = z.object({ value: z.string().max(200).nullable(), facilityId: uuid }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const batch = await batchRow(c, id);
      const scope = await scopeOf(c, req.user);
      if (!scope.enter.has(b.facilityId)) throw new AppError('You cannot enter data for that facility', 403, 'FORBIDDEN');
      const r = await c.query(
        `UPDATE purchase_line SET facility_id = $3, problems = array(SELECT p FROM unnest(problems) p WHERE p NOT LIKE 'Facility %')
          WHERE batch_id = $1 AND facility_id IS NULL AND status <> 'published' AND coalesce(facility_text, '') = coalesce($2, '') RETURNING group_key`, [id, b.value, b.facilityId]);
      // a value → its facility; no value written → the batch's facility for lines without one
      const settings = b.value ? { ...batch.settings, facilityMap: { ...(batch.settings.facilityMap ?? {}), [b.value]: b.facilityId } } : { ...batch.settings, facilityId: b.facilityId };
      await c.query('UPDATE purchase_batch SET settings = $2 WHERE id = $1', [id, JSON.stringify(settings)]);
      await calcLines(c, id, { keys: [...new Set(r.rows.map((x) => x.group_key))] });
      return { lines: r.rowCount };
    });
  });

  /** After exchange rates, price indices or supplier factors were added: calculate the batch again. */
  app.post('/api/purchases/batches/:id/recalculate', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    const remap = z.object({ remap: z.boolean().default(false) }).parse(req.body ?? {}).remap;
    return tenantTx(tenant, async (c) => {
      await batchRow(c, id);
      await assertSees(c, req, id);
      return { jobId: await enqueue(c, tenant, 'purchase_calc', id, { remap }, req.user.id) };
    });
  });

  app.post('/api/purchases/batches/:id/publish', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    return tenantTx(tenant, async (c) => {
      const b = await batchRow(c, id);
      await assertSees(c, req, id);
      if (['reading', 'mapping', 'publishing', 'queued', 'setup'].includes(b.status)) throw new AppError('The batch is not ready to publish', 409);
      const ready = Number((await c.query(`SELECT count(*) FROM purchase_line WHERE batch_id = $1 AND status = 'ready'`, [id])).rows[0].count);
      if (!ready) throw new AppError('No lines are ready to publish');
      await c.query(`UPDATE purchase_batch SET status = 'publishing' WHERE id = $1`, [id]);
      const u = req.user;
      return { jobId: await enqueue(c, tenant, 'purchase_publish', id, { user: { id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId, scopeNodeId: u.scopeNodeId } }, u.id), lines: ready };
    });
  });

  app.post('/api/purchases/batches/:id/reopen', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    return tenantTx(tenant, async (c) => {
      await batchRow(c, id);
      await assertSees(c, req, id);
      const r = await reopenBatch(c, id);
      await audit(c, req, 'purchases.reopen', 'purchase_batch', id, r);
      return r;
    });
  });

  app.patch('/api/purchases/batches/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    const b = z.object({ name: z.string().trim().min(1).max(120).optional(), includeDuplicates: z.boolean().optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const batch = await batchRow(c, id);
      await assertSees(c, req, id);
      if (b.name) await c.query('UPDATE purchase_batch SET name = $2 WHERE id = $1', [id, b.name]);
      if (b.includeDuplicates !== undefined) {
        await c.query('UPDATE purchase_batch SET settings = $2 WHERE id = $1', [id, JSON.stringify({ ...batch.settings, includeDuplicates: b.includeDuplicates })]);
        await c.query(b.includeDuplicates
          ? `UPDATE purchase_line SET problems = array_remove(problems, 'Duplicate of a line uploaded earlier') WHERE batch_id = $1 AND status <> 'published'`
          : `UPDATE purchase_line SET problems = array_append(problems, 'Duplicate of a line uploaded earlier') WHERE batch_id = $1 AND dup_of IS NOT NULL AND status <> 'published' AND NOT ('Duplicate of a line uploaded earlier' = ANY(problems))`, [id]);
        await calcLines(c, id);
      }
      return { ok: true };
    });
  });

  app.delete('/api/purchases/batches/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const id = idParam(req);
    return tenantTx(tenant, async (c) => {
      const b = await batchRow(c, id);
      await assertSees(c, req, id);
      const n = Number((await c.query(`SELECT count(*) FROM activity WHERE purchase_batch_id = $1`, [id])).rows[0].count);
      if (n) throw new AppError('Entries of this batch are published: reopen it first', 409);
      if (['reading', 'mapping', 'publishing'].includes(b.status)) throw new AppError('The batch is being processed: try again in a moment', 409);
      await c.query(`DELETE FROM job WHERE ref = $1 AND status = 'queued'`, [id]);
      await c.query('DELETE FROM purchase_batch WHERE id = $1', [id]);
      if (b.document_id) await c.query(`DELETE FROM document WHERE id = $1 AND kind = 'purchases' AND NOT EXISTS (SELECT 1 FROM purchase_batch WHERE document_id = $1)`, [b.document_id]);
      await audit(c, req, 'purchases.delete', 'purchase_batch', id, { name: b.name });
      return { ok: true };
    });
  });

  /** Spend categories for the picker: text search plus the matcher's ranking. */
  app.get('/api/purchases/items', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ q: z.string().max(200).default(''), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const ix = await spendIndex(c);
      const ranked = q.q ? classify(ix.index, q.q, q.limit).candidates.map((x) => x.itemId) : [];
      const like = q.q ? (await c.query(
        `SELECT i.id FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category ca ON ca.id = s.category_id
          WHERE ca.code = 'purchased_goods' AND i.active AND (i.name ILIKE $1 OR i.attrs->>'naics' LIKE $2 OR EXISTS (SELECT 1 FROM unnest(i.aliases) a WHERE a ILIKE $1)) LIMIT $3`,
        [`%${q.q}%`, `${q.q.replace(/\D/g, '') || 'x'}%`, q.limit])).rows.map((r) => r.id) : [];
      const ids = [...new Set([...like, ...ranked])].slice(0, q.limit);
      const rows = (await c.query(
        `SELECT i.id, i.name, i.attrs->>'naics' AS naics, coalesce(i.attrs->>'group', s.name) AS "group", f.co2e::float8 AS co2e, f.unit, f.price_year, fs.code AS source
           FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category ca ON ca.id = s.category_id
           LEFT JOIN LATERAL (SELECT f.* FROM factor f JOIN factor_source x ON x.id = f.source_id WHERE f.item_id = i.id AND f.status = 'active' ORDER BY (x.code = 'DEMO-SPEND'), f.valid_from DESC LIMIT 1) f ON true
           LEFT JOIN factor_source fs ON fs.id = f.source_id
          WHERE ${q.q ? 'i.id = ANY($1)' : `ca.code = 'purchased_goods' AND i.active AND $1::int[] IS NOT NULL`} ORDER BY ${q.q ? 'array_position($1, i.id)' : 's.sort, i.name'} LIMIT ${q.limit}`,
        [q.q ? ids : []])).rows;
      return { items: rows };
    });
  });

  /** Remembered mappings. */
  app.get('/api/purchases/rules', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => ({
      rules: (await c.query(
        `SELECT r.id, r.field, r.pattern, r.item_id, i.name AS item, r.decision, r.target, r.capital, r.hits, r.created_at, u.name AS created_by
           FROM purchase_rule r LEFT JOIN item i ON i.id = r.item_id LEFT JOIN app_user u ON u.id::text = r.created_by ORDER BY r.created_at DESC LIMIT 2000`)).rows,
    }));
  });
  app.delete('/api/purchases/rules/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = idParam(req);
    return tenantTx(tenant, async (c) => {
      const r = await c.query('DELETE FROM purchase_rule WHERE id = $1 RETURNING pattern', [id]);
      if (!r.rowCount) throw notFound('Rule');
      await audit(c, req, 'purchases.rule.delete', 'purchase_rule', id, r.rows[0]);
      return { ok: true };
    });
  });

  /** An Excel template (any layout is accepted; this one needs no column choices). */
  app.get('/api/purchases/template', async (req, reply) => {
    requireTenant(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Purchases');
    const cols = ['Date', 'Description', 'Category', 'Amount', 'Currency', 'Quantity', 'Unit', 'Supplier', 'GL account', 'PO number', 'Facility', 'Supplier EF', 'Supplier EF unit', 'Capital goods'];
    ws.addRow(cols);
    ws.addRow([new Date('2026-03-15'), 'A4 copier paper 80gsm', 'Office supplies', 4250, 'AED', 50, 'box', 'Gulf Stationery LLC', 'Office expenses', 'PO-26-0412', 'BEEAH Headquarters', null, null, 'No']);
    ws.addRow([new Date('2026-03-20'), 'Ready mix concrete C40', 'Construction materials', 182000, 'AED', 400, 'm3', 'Emirates Concrete', 'Capital WIP', 'PO-26-0433', 'Al Saja\'a Recycling Complex', 210, 'm3', 'Yes']);
    styleHeader(ws, [12, 40, 24, 14, 10, 10, 8, 26, 20, 14, 28, 12, 14, 12]);
    ws.getColumn(1).numFmt = 'dd/mm/yyyy';
    const help = wb.addWorksheet('How to fill');
    [['Any layout is accepted: on upload you choose which column is which, and the choice is remembered for the next file with the same columns.'],
     ['Required: Description, Amount (or Quantity with a supplier factor), and the Date and Facility unless they are the same for the whole file.'],
     ['Amount: what was paid, in the Currency (default: the company currency). Credit notes as negative amounts.'],
     ['Supplier EF: the supplier\'s own emission factor in kg CO2e per "Supplier EF unit" (kg, t, L, m3, kWh, pcs… or a currency such as AED).'],
     ['Capital goods: Yes for purchases capitalised as assets (reported in Scope 3.2).']].forEach((r) => help.addRow(r));
    help.getColumn(1).width = 140;
    return sendWorkbook(reply, wb, 'Ekotrace purchases template.xlsx');
  });

  /**
   * Purchases typed on the screen: calculated at once; published when every line is ready
   * (or only checked, with `dryRun`).
   */
  app.post('/api/purchases/manual', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ENTER);
    const b = z.object({
      facilityId: uuid, dryRun: z.boolean().default(false), name: z.string().trim().max(120).optional(),
      lines: z.array(lineSchema.extend({ itemId: z.number().int().positive().nullable().optional(), target: z.enum(SPEND_CATEGORIES as [string, ...string[]]).default('purchased_goods') })).min(1).max(500),
    }).parse(req.body);
    const ROLLBACK = new Error('dry-run');
    let result: unknown;
    try {
      await tenantTx(tenant, async (c) => {
        const scope = await scopeOf(c, req.user);
        if (!scope.enter.has(b.facilityId)) throw new AppError('You cannot enter data for that facility', 403, 'FORBIDDEN');
        const t = (await c.query('SELECT currency FROM tenant WHERE id = $1', [tenant])).rows[0];
        const batch = (await c.query(
          `INSERT INTO purchase_batch (tenant_id, source, name, settings, status, created_by) VALUES ($1, 'manual', $2, $3, 'review', $4) RETURNING id`,
          [tenant, b.name || `Entered by ${req.user.name}, ${new Date().toISOString().slice(0, 10)}`, JSON.stringify({ headerRow: 0, columns: {}, dateFormat: 'ymd', currency: t.currency, facilityId: b.facilityId }), req.user.id])).rows[0];
        const fac = await loadFacilities(c);
        const settings: BatchSettings = { headerRow: 0, columns: {}, dateFormat: 'ymd', currency: t.currency, facilityId: b.facilityId, includeDuplicates: true };
        const lines = b.lines.map((l, i) => {
          const x = buildLine({ ...toRaw(l), facility: null }, i + 1, settings, fac);
          return { ...x, groupKey: `${groupKey(x.description, x.categoryText)}#${l.itemId ?? 'none'}#${l.target}#${i}` };
        });
        await insertLines(c, tenant, batch.id, lines);
        await prepareBatch(c, tenant, batch.id, 'manual');
        for (const [i, l] of b.lines.entries()) {
          const capital = l.target === 'capital_goods';
          const move = !capital && l.target !== 'purchased_goods';
          await c.query(`UPDATE purchase_group SET item_id = $3, map_method = CASE WHEN $3::int IS NULL THEN NULL ELSE 'manual' END, confidence = 1, decision = $4, target = $5, capital = $6
                          WHERE batch_id = $1 AND key = $2`, [batch.id, lines[i]!.groupKey, l.itemId ?? null, move ? 'move' : 'keep', move ? l.target : null, capital]);
        }
        await calcLines(c, batch.id);
        const rows = (await c.query(
          `SELECT l.row_no, l.status, l.method, l.co2e::float8 AS co2e, l.problems, l.calc_error, l.warnings, i.name AS item FROM purchase_line l LEFT JOIN item i ON i.id = l.item_id WHERE l.batch_id = $1 ORDER BY row_no`, [batch.id])).rows;
        const explained: Awaited<ReturnType<typeof explainLine>>[] = [];
        for (const r of (await c.query(`SELECT id FROM purchase_line WHERE batch_id = $1 ORDER BY row_no`, [batch.id])).rows) explained.push(await explainLine(c, r.id));
        const allReady = rows.every((r) => r.status === 'ready');
        const lineResults = rows.map((r, i) => ({ ...r, steps: explained[i]?.steps ?? [], factor: explained[i]?.factor ?? null }));
        if (b.dryRun || !allReady) { result = { saved: false, allReady, lines: lineResults }; throw ROLLBACK; }
        const pub = await publishBatch(c, tenant, batch.id, req.user);
        await audit(c, req, 'purchases.manual', 'purchase_batch', batch.id, { lines: rows.length, co2e: pub.co2e });
        result = { saved: true, allReady, batchId: batch.id, entries: pub.entries, co2e: pub.co2e, lines: lineResults };
      });
    } catch (e) { if (e !== ROLLBACK) throw e; }
    return result;
  });
}

// ------------------------------------------------------------- machine API --
/**
 * For ERP systems (SAP, Oracle, Dynamics…) sending purchase lines:
 *   POST /api/v1/purchases                 { reference, name?, currency?, facility?, complete?, lines: [...] }  (≤ 10,000 lines per call)
 *   POST /api/v1/purchases/{reference}/complete    all lines sent: map and calculate
 *   GET  /api/v1/purchases/{reference}     status and counts
 * A batch collects every call with the same reference until it is completed; it is then
 * reviewed and published on the screen, like an upload.
 */
export async function purchaseIngestRoutes(app: FastifyInstance) {
  const ref = z.string().trim().min(1).max(120).regex(/^[\w.:\-/ ]+$/, 'Letters, digits and . : - / _ only');
  app.post('/api/v1/purchases', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    if (!/^application\/json/.test(String(req.headers['content-type'] ?? ''))) throw new AppError('Send JSON (Content-Type: application/json)', 415, 'UNSUPPORTED');
    const k = await apiClient(req, 'purchases');
    const b = z.object({
      reference: ref, name: z.string().trim().max(120).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), facility: z.string().max(200).optional(),
      dateFormat: z.enum(['dmy', 'mdy', 'ymd']).default('ymd'), complete: z.boolean().default(false), lines: z.array(lineSchema).max(10000),
    }).parse(req.body);
    return tenantTx(k.tenant_id, async (c) => {
      const t = (await c.query('SELECT currency FROM tenant WHERE id = $1', [k.tenant_id])).rows[0];
      let batch = (await c.query(`SELECT id, status, settings FROM purchase_batch WHERE external_ref = $1`, [b.reference])).rows[0];
      if (batch && batch.status !== 'receiving') throw new AppError(`Batch "${b.reference}" is already complete (${batch.status}): use a new reference`, 409, 'BATCH_CLOSED');
      const fac = await loadFacilities(c);
      if (!batch) {
        const settings: BatchSettings = { headerRow: 0, columns: {}, dateFormat: b.dateFormat, currency: b.currency ?? t.currency, facilityId: b.facility ? (fac.ids.has(b.facility) ? b.facility : fac.byName.get(b.facility.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) ?? null) : null };
        if (b.facility && !settings.facilityId) throw new AppError(`Facility "${b.facility}" not found`, 400);
        batch = (await c.query(
          `INSERT INTO purchase_batch (tenant_id, source, name, external_ref, settings, status, created_by) VALUES ($1, 'api', $2, $3, $4, 'receiving', $5) RETURNING id, status, settings`,
          [k.tenant_id, b.name ?? `${k.name}: ${b.reference}`, b.reference, JSON.stringify(settings), `api:${k.name}`])).rows[0];
      }
      const start = Number((await c.query('SELECT coalesce(max(row_no), 0) AS n FROM purchase_line WHERE batch_id = $1', [batch.id])).rows[0].n);
      if (start + b.lines.length > MAX_LINES) throw new AppError(`A batch holds at most ${MAX_LINES.toLocaleString('en')} lines: start a new reference`, 400);
      const lines = b.lines.map((l, i) => buildLine(toRaw(l), start + i + 1, batch.settings as BatchSettings, fac));
      for (let i = 0; i < lines.length; i += 2000) await insertLines(c, k.tenant_id, batch.id, lines.slice(i, i + 2000));
      const problems = lines.map((l, i) => ({ index: i, problems: l.problems })).filter((x) => x.problems.length);
      if (b.complete) {
        await c.query(`UPDATE purchase_batch SET status = 'queued' WHERE id = $1`, [batch.id]);
        await enqueue(c, k.tenant_id, 'purchase_map', batch.id, {}, `api:${k.name}`);
      }
      await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, entity, entity_id, detail) VALUES ($1, $4, 'purchases.api', 'purchase_batch', $2, $3)`,
        [k.tenant_id, batch.id, JSON.stringify({ client: k.name, lines: lines.length, complete: b.complete }), `API client: ${k.name}`]);
      return { reference: b.reference, batchId: batch.id, received: lines.length, totalLines: start + lines.length, withProblems: problems.length, problems: problems.slice(0, 200), complete: b.complete };
    });
  });

  app.post('/api/v1/purchases/:reference/complete', async (req) => {
    const k = await apiClient(req, 'purchases');
    const r = ref.parse((req.params as { reference: string }).reference);
    return tenantTx(k.tenant_id, async (c) => {
      const batch = (await c.query(`SELECT id, status FROM purchase_batch WHERE external_ref = $1`, [r])).rows[0];
      if (!batch) throw notFound(`Batch "${r}"`);
      if (batch.status !== 'receiving') throw new AppError(`Batch "${r}" is already complete (${batch.status})`, 409, 'BATCH_CLOSED');
      await c.query(`UPDATE purchase_batch SET status = 'queued' WHERE id = $1`, [batch.id]);
      await enqueue(c, k.tenant_id, 'purchase_map', batch.id, {}, `api:${k.name}`);
      return { reference: r, status: 'queued' };
    });
  });

  app.get('/api/v1/purchases/:reference', async (req) => {
    const k = await apiClient(req, 'purchases');
    const r = ref.parse((req.params as { reference: string }).reference);
    return tenantTx(k.tenant_id, async (c) => {
      const batch = (await c.query(`SELECT id, name, status, error, created_at, published_at FROM purchase_batch WHERE external_ref = $1`, [r])).rows[0];
      if (!batch) throw notFound(`Batch "${r}"`);
      const counts = Object.fromEntries((await c.query(`SELECT status, count(*)::int AS n FROM purchase_line WHERE batch_id = $1 GROUP BY 1`, [batch.id])).rows.map((x) => [x.status, x.n]));
      return { reference: r, status: batch.status, error: batch.error, lines: counts, createdAt: batch.created_at, publishedAt: batch.published_at };
    });
  });
}

export { normSupplier, type Field };
