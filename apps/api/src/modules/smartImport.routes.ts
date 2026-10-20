/**
 * Smart import (Capture → Smart import): any emissions spreadsheet → proposed entries → reviewed → created and
 * submitted for approval, with the file kept in the document vault as their evidence. lib/smartImport does the work.
 *
 *   GET  /api/smart-import                    files imported (with their counts)
 *   POST /api/smart-import                    upload (.xlsx / .csv): layout of each sheet (AI or worked out), rows proposed
 *   GET  /api/smart-import/:id                sheets with their layout, activities and facilities found, rows, catalogue
 *   PUT  /api/smart-import/:id/sheets/:sid    change a sheet's layout → its rows are proposed again
 *   PUT  /api/smart-import/:id/items          set (or confirm) the catalogue item of an activity; remember it if asked
 *   PUT  /api/smart-import/:id/facilities     set the facility a name stands for; remember it if asked
 *   PUT  /api/smart-import/:id/rows           leave rows out, or bring them back
 *   POST /api/smart-import/:id/create         create the ready rows as entries and submit them for approval
 *   DELETE /api/smart-import/:id              drop an import (entries already created stay)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normText } from '@ekotrace/calc';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { sealFile } from '../lib/secrets.js';
import { detectKind, previewFile, type Cell } from '../lib/sheet.js';
import { tenantAi } from '../lib/ai.js';
import { aiItems, aiMap, applyMap, bodyOf, candidates, guessMap, keyOf, loadCatalogue, sheetMapSchema, unitFor, type Catalogue, type SheetMap } from '../lib/smartImport.js';
import { calculate, calcInputSchema } from './calc.service.js';
import { contextFor, saveEntry, saveSchema } from './activity.routes.js';

const ENTER = ['super_admin', 'admin', 'manager', 'preparer'] as const;
const MAX_FILE = 20 * 1024 * 1024, MAX_ROWS = 5000, MAX_COLS = 80;
const idP = (req: FastifyRequest) => z.string().uuid().parse((req.params as { id: string }).id);
const STRONG = 0.6;

async function jobOf(c: Tx, id: string) {
  const j = (await c.query(`SELECT * FROM import_job WHERE id = $1`, [id])).rows[0];
  if (!j) throw notFound('Import');
  return j;
}
const cleanCell = (c: Cell): string | number | null => (c == null ? null : c instanceof Date ? c.toISOString().slice(0, 10) : typeof c === 'number' ? c : typeof c === 'boolean' ? String(c) : String(c).slice(0, 500));

/** Facilities the person may enter data for, with normalised names. */
async function enterable(c: Tx, req: FastifyRequest) {
  const s = await scopeOf(c, req.user);
  return (await c.query(`SELECT id, name, country, grid_region FROM org_node WHERE kind = 'facility' AND active AND id = ANY($1) ORDER BY name`, [[...s.enter]])).rows as { id: string; name: string; country: string; grid_region: string | null }[];
}

/** Propose the rows of some sheets again from their layout (rows already created stay). */
async function propose(c: Tx, tenant: string, jobId: string, sheetIds: string[]) {
  for (const sid of sheetIds) {
    const sh = (await c.query(`SELECT rows, mapping FROM import_sheet WHERE id = $1`, [sid])).rows[0];
    const person = (await c.query(`SELECT row_no, col, status FROM import_row WHERE sheet_id = $1 AND person`, [sid])).rows as { row_no: number; col: number | null; status: string }[];
    await c.query(`DELETE FROM import_row WHERE sheet_id = $1 AND status <> 'created'`, [sid]);
    const done = new Set((await c.query(`SELECT row_no, col FROM import_row WHERE sheet_id = $1`, [sid])).rows.map((r) => `${r.row_no}|${r.col}`));
    const rows = applyMap(sh.rows as Cell[][], sheetMapSchema.parse(sh.mapping)).filter((r) => !done.has(`${r.rowNo}|${r.col}`));
    for (let i = 0; i < rows.length; i += 1000) {
      const p = rows.slice(i, i + 1000);
      await c.query(
        `INSERT INTO import_row (tenant_id, job_id, sheet_id, row_no, col, facility_text, period_start, period_end, description, category_text, quantity, unit_text, note, data_type, problems)
         SELECT $1, $2, $3, rn, cl, ft, ps, pe, de, ct, q, ut, nt, dt, CASE WHEN pr = '' THEN '{}'::text[] ELSE string_to_array(pr, E'\x1f') END
           FROM unnest($4::int[], $5::int[], $6::text[], $7::date[], $8::date[], $9::text[], $10::text[], $11::numeric[], $12::text[], $13::text[], $14::text[], $15::text[])
                AS x(rn, cl, ft, ps, pe, de, ct, q, ut, nt, dt, pr)`,
        [tenant, jobId, sid, p.map((r) => r.rowNo), p.map((r) => r.col), p.map((r) => r.facilityText), p.map((r) => r.periodStart), p.map((r) => r.periodEnd), p.map((r) => r.description),
         p.map((r) => r.categoryText), p.map((r) => r.quantity), p.map((r) => r.unitText), p.map((r) => r.note), p.map((r) => r.dataType), p.map((r) => r.problems.join('\u001f'))]);
    }
    // a person's "leave out" survives a new layout when the same cell comes back
    for (const x of person.filter((r) => r.status === 'excluded'))
      await c.query(`UPDATE import_row SET status = 'excluded', person = true WHERE sheet_id = $1 AND row_no = $2 AND col IS NOT DISTINCT FROM $3 AND status <> 'created'`, [sid, x.row_no, x.col]);
  }
}

/**
 * Facility, item, unit, duplicates and a dry-run calculation for the rows not created yet (or `ids`). AI (when the
 * company allows it) chooses among the candidates for activities the text match is unsure of.
 */
async function resolve(c: Tx, req: FastifyRequest, tenant: string, jobId: string, opts: { cat?: Catalogue; useAi?: boolean } = {}) {
  const cat = opts.cat ?? await loadCatalogue(c);
  const facs = await enterable(c, req);
  const rules = (await c.query(`SELECT kind, pattern, item_id, facility_id FROM import_rule`)).rows as { kind: string; pattern: string; item_id: number | null; facility_id: string | null }[];
  const ruleOf = (kind: string, text: string | null) => (text ? rules.find((r) => r.kind === kind && r.pattern === normText(text)) : undefined);
  const rows = (await c.query(`SELECT * FROM import_row WHERE job_id = $1 AND status <> 'created' ORDER BY id`, [jobId])).rows;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const facOf = (text: string | null): string | null => {
    if (!text) return facs.length === 1 ? facs[0]!.id : null;
    const r = ruleOf('facility', text); if (r?.facility_id && facs.some((f) => f.id === r.facility_id)) return r.facility_id;
    const t = norm(text);
    const exact = facs.filter((f) => norm(f.name) === t); if (exact.length === 1) return exact[0]!.id;
    const part = facs.filter((f) => norm(f.name).includes(t) || t.includes(norm(f.name))); if (part.length === 1) return part[0]!.id;
    return null;
  };
  // activities: one decision per description + unit
  type G = { key: string; description: string; unit: string | null; category: string | null; item: number | null; method: string | null; conf: number | null; cands: number[] };
  const groups = new Map<string, G>();
  for (const r of rows) {
    const key = keyOf(r.description, r.unit_text);
    if (groups.has(key)) continue;
    const manual = rows.find((x) => keyOf(x.description, x.unit_text) === key && ['manual', 'rule'].includes(x.item_method) && x.item_id);
    if (manual) { groups.set(key, { key, description: r.description, unit: r.unit_text, category: r.category_text, item: manual.item_id, method: manual.item_method, conf: 1, cands: [] }); continue; }
    const rule = ruleOf('item', r.description);
    if (rule?.item_id && cat.byId.has(rule.item_id)) { groups.set(key, { key, description: r.description, unit: r.unit_text, category: r.category_text, item: rule.item_id, method: 'rule', conf: 1, cands: [] }); continue; }
    if (!r.description) { groups.set(key, { key, description: '', unit: r.unit_text, category: r.category_text, item: null, method: null, conf: null, cands: [] }); continue; }
    const k = candidates(cat, r.description, r.category_text, r.unit_text);
    const prevAi = rows.find((x) => keyOf(x.description, x.unit_text) === key && x.item_method === 'ai' && x.item_id);
    groups.set(key, prevAi ? { key, description: r.description, unit: r.unit_text, category: r.category_text, item: prevAi.item_id, method: 'ai', conf: Number(prevAi.item_conf ?? 0.7), cands: k.list.map((x) => x.itemId) }
      : { key, description: r.description, unit: r.unit_text, category: r.category_text, item: k.best, method: k.best ? 'text' : null, conf: k.best ? k.confidence : null, cands: k.list.map((x) => x.itemId) });
  }
  let aiNote: string | null = null;
  if (opts.useAi) {
    const ai = await tenantAi(c, tenant);
    const allow = ai && (await c.query(`SELECT ai_import FROM tenant WHERE id = $1`, [tenant])).rows[0]?.ai_import;
    const unsure = [...groups.values()].filter((g) => g.method === 'text' ? (g.conf ?? 0) < STRONG : !g.method && g.cands.length).filter((g) => g.cands.length).slice(0, ai?.maxGroups ?? 300);
    if (ai && allow && unsure.length) {
      try {
        const res = await aiItems(ai, cat, unsure.map((g) => ({ key: g.key, text: [g.description, g.category].filter(Boolean).join(' · ') + (g.unit ? ` | ${g.unit}` : ''), candidates: g.cands })));
        for (const x of res) { const g = groups.get(x.key); if (g && x.itemId) { g.item = x.itemId; g.method = 'ai'; g.conf = x.confidence; } }
      } catch (e) { aiNote = `AI not used for the activities: ${(e as Error).message}`; }
    }
  }
  // per row
  const t = (await c.query(`SELECT gwp_set FROM tenant WHERE id = $1`, [tenant])).rows[0];
  for (const r of rows) {
    const g = groups.get(keyOf(r.description, r.unit_text))!;
    const problems: string[] = (r.problems ?? []).filter((p: string) => p.startsWith('No month'));
    const facility = r.facility_id && r.facility_person ? r.facility_id : facOf(r.facility_text);
    if (!facility) problems.push(r.facility_text ? `Facility "${r.facility_text}" not recognised` : 'No facility: choose it for this sheet');
    const item = g.item ? cat.byId.get(g.item) : undefined;
    if (!item) problems.push(r.description ? 'Activity not recognised: choose the item' : 'No activity: set the activity column');
    const unit = item ? unitFor(cat, item, r.unit_text) : null;
    if (item && !unit) problems.push(r.unit_text ? `Unit "${r.unit_text}" does not fit ${item.name}` : `No unit: ${item.name} needs one of ${item.units.join(', ')}`);
    if (Number(r.quantity) < 0) problems.push('Negative quantity');
    let status = problems.length ? 'problem' : g.method === 'ai' || (g.method === 'text' && (g.conf ?? 0) < STRONG) ? 'check' : 'ready';
    let co2e: number | null = null, warnings: string[] = [];
    if (!problems.length && facility && item && unit && r.period_start) {
      const ps = r.period_start instanceof Date ? r.period_start.toISOString().slice(0, 10) : String(r.period_start).slice(0, 10);
      const pe = r.period_end instanceof Date ? r.period_end.toISOString().slice(0, 10) : String(r.period_end).slice(0, 10);
      const dup = (await c.query(`SELECT 1 FROM activity WHERE facility_id = $1 AND item_id = $2 AND period_start = $3 AND period_end = $4 AND quantity = $5 AND status <> 'rejected' LIMIT 1`,
        [facility, item.id, ps, pe, unit === r.unit ? r.quantity : r.quantity])).rowCount;
      const b = bodyOf(cat, { item_id: item.id, unit, quantity: Number(r.quantity), period_start: ps, period_end: pe, facility_id: facility, description: r.description, data_type: r.data_type, note: r.note });
      if ('problem' in b) { problems.push(b.problem); status = 'problem'; }
      else {
        try {
          const f = facs.find((x) => x.id === facility)!;
          const parsed = calcInputSchema.parse(b.body);
          const { result } = await calculate(parsed, contextFor(c, t.gwp_set, f.country, f));
          co2e = result.totals.direct + result.totals.scope2 + result.totals.scope3;
          warnings = result.warnings.slice(0, 3);
        } catch (e) { problems.push((e as Error).message); status = 'problem'; }
      }
      if (dup && status !== 'problem') { problems.push('Already entered (same facility, activity, period and quantity)'); status = 'excluded'; }
    }
    if (r.status === 'excluded' && r.person) status = 'excluded';
    await c.query(`UPDATE import_row SET facility_id = $2, item_id = $3, item_method = $4, item_conf = $5, unit = $6, status = $7, problems = $8, co2e = $9, warnings = $10 WHERE id = $1`,
      [r.id, facility, item?.id ?? null, item ? g.method : null, item ? g.conf : null, unit, status, problems, co2e, warnings]);
  }
  if (opts.useAi) await c.query(`UPDATE import_job SET ai_note = coalesce($2, ai_note) WHERE id = $1`, [jobId, aiNote]);
}

export async function smartImportRoutes(app: FastifyInstance) {
  app.get('/api/smart-import', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    return tenantTx(tenant, async (c) => ({
      jobs: (await c.query(
        `SELECT j.id, j.filename, j.status, j.ai_used, j.created_name, j.created_at, j.done_at,
                count(r.*) FILTER (WHERE r.status = 'ready')::int AS ready, count(r.*) FILTER (WHERE r.status = 'check')::int AS "check",
                count(r.*) FILTER (WHERE r.status = 'problem')::int AS problem, count(r.*) FILTER (WHERE r.status = 'created')::int AS created, count(r.*)::int AS rows
           FROM import_job j LEFT JOIN import_row r ON r.job_id = j.id GROUP BY j.id ORDER BY j.created_at DESC LIMIT 100`)).rows,
      ai: !!(await tenantAi(c, tenant)) && !!(await c.query(`SELECT ai_import FROM tenant WHERE id = $1`, [tenant])).rows[0]?.ai_import,
    }));
  });

  app.post('/api/smart-import', { bodyLimit: MAX_FILE }, async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'data.xlsx')).slice(0, 200);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
    const kind = detectKind(buf, filename);
    if (kind === 'xls') throw new AppError('Old .xls files cannot be read: save it as .xlsx');
    if (kind !== 'xlsx' && kind !== 'csv') throw new AppError('Send an Excel (.xlsx) or CSV file');
    const sheets = (await previewFile(buf, kind, MAX_ROWS)).sheets.filter((s) => s.rows.length > 1);
    if (!sheets.length) throw new AppError('The file has no data');
    const defaultYear = new Date().getUTCFullYear() - 1;
    // the layout of each sheet: the company's AI when allowed (first 40 rows), else worked out from the headings
    const { ai, facilities } = await tenantTx(tenant, async (c) => {
      const a = await tenantAi(c, tenant);
      const allow = a && (await c.query(`SELECT ai_import FROM tenant WHERE id = $1`, [tenant])).rows[0]?.ai_import;
      return { ai: allow ? a : null, facilities: (await enterable(c, req)).map((f) => f.name) };
    });
    let aiNote: string | null = null, aiUsed = false;
    const maps: { map: SheetMap; by: 'ai' | 'auto' }[] = [];
    for (const s of sheets) {
      let m: SheetMap | null = null;
      if (ai) {
        try { m = await aiMap(ai, s.name, s.rows, facilities, defaultYear); if (m) aiUsed = true; } catch (e) { aiNote = `AI not used for the layout: ${(e as Error).message}`; }
      }
      maps.push(m ? { map: m, by: 'ai' } : { map: guessMap(s.rows, s.name, defaultYear), by: 'auto' });
    }
    return tenantTx(tenant, async (c) => {
      // the file goes to the document vault: the evidence of every entry created from it
      const h = createHash('sha256').update(buf).digest('hex');
      const prior = (await c.query(`SELECT id FROM document WHERE sha256 = $1`, [h])).rows[0];
      const docId = prior?.id ?? (await c.query(
        `INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by, doc_type, title, note)
         VALUES ($1, 'vault', $2, $3, $4, $5, $6, $7, 'data', $8, 'Imported with Smart import') RETURNING id`,
        [tenant, filename, kind === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf.length, h, sealFile(buf), req.user.id, `Data file: ${filename}`])).rows[0].id;
      const job = (await c.query(`INSERT INTO import_job (tenant_id, filename, document_id, ai_used, ai_note, created_by, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tenant, filename, docId, aiUsed, aiNote, req.user.id, req.user.name])).rows[0].id as string;
      const ids: string[] = [];
      for (const [i, s] of sheets.entries()) {
        const rows = s.rows.map((r) => r.slice(0, MAX_COLS).map(cleanCell));
        ids.push((await c.query(`INSERT INTO import_sheet (tenant_id, job_id, sort, name, rows, total_rows, mapping, proposed_by, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [tenant, job, i, s.name.slice(0, 120), JSON.stringify(rows), rows.length, JSON.stringify(maps[i]!.map), maps[i]!.by,
           rows.length >= MAX_ROWS ? `Only the first ${MAX_ROWS.toLocaleString('en')} rows are read` : null])).rows[0].id);
      }
      await propose(c, tenant, job, ids);
      await resolve(c, req, tenant, job, { useAi: true });
      await audit(c, req, 'smart_import.upload', 'import_job', job, { filename, sheets: sheets.length, ai: aiUsed });
      return { id: job };
    });
  });

  app.get('/api/smart-import/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req);
    const q = z.object({ status: z.enum(['ready', 'check', 'problem', 'excluded', 'created', 'all']).default('all'), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const job = await jobOf(c, id);
      const sheets = (await c.query(`SELECT id, name, mapping, proposed_by, note, total_rows, (SELECT jsonb_agg(x) FROM (SELECT jsonb_array_elements(rows) x LIMIT 25) y) AS head
                                       FROM import_sheet WHERE job_id = $1 ORDER BY sort`, [id])).rows;
      const counts = Object.fromEntries((await c.query(`SELECT status, count(*)::int AS n, sum(co2e)::float8 AS kg FROM import_row WHERE job_id = $1 GROUP BY 1`, [id])).rows.map((r) => [r.status, { n: r.n, kg: r.kg ?? 0 }]));
      const activities = (await c.query(
        `SELECT r.description, r.unit_text, min(r.category_text) AS category, count(*)::int AS rows, sum(r.quantity)::float8 AS quantity, sum(r.co2e)::float8 AS kg,
                min(r.item_id) AS item_id, min(i.name) AS item, min(r.item_method) AS method, min(r.item_conf)::float8 AS conf, min(r.unit) AS unit,
                count(*) FILTER (WHERE r.status = 'problem')::int AS problems, count(*) FILTER (WHERE r.status = 'check')::int AS "check", count(*) FILTER (WHERE r.status = 'created')::int AS created
           FROM import_row r LEFT JOIN item i ON i.id = r.item_id WHERE r.job_id = $1 GROUP BY 1, 2 ORDER BY sum(r.co2e) DESC NULLS LAST, 4 DESC`, [id])).rows;
      const facilities = (await c.query(
        `SELECT r.facility_text, min(r.facility_id::text) AS facility_id, min(f.name) AS facility, count(*)::int AS rows FROM import_row r LEFT JOIN org_node f ON f.id = r.facility_id
          WHERE r.job_id = $1 GROUP BY 1 ORDER BY 4 DESC`, [id])).rows;
      const rows = (await c.query(
        `SELECT r.id, s.name AS sheet, r.row_no, r.facility_text, f.name AS facility, r.period_start::text, r.period_end::text, r.description, r.quantity::float8, r.unit_text, r.unit, i.name AS item,
                r.item_method, r.status, r.problems, r.warnings, r.co2e::float8, r.activity_id, r.person, r.data_type
           FROM import_row r JOIN import_sheet s ON s.id = r.sheet_id LEFT JOIN org_node f ON f.id = r.facility_id LEFT JOIN item i ON i.id = r.item_id
          WHERE r.job_id = $1 AND ($2 = 'all' OR r.status = $2) ORDER BY s.sort, r.row_no, r.col LIMIT 300 OFFSET $3`, [id, q.status, q.offset])).rows;
      const cat = (await c.query(
        `SELECT i.id, i.name, c.name AS category, c.code AS category_code, s.units FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
          WHERE i.active AND s.active AND c.code = ANY($1) ORDER BY c.sort, s.sort, i.sort, i.name`, [['stationary_combustion', 'mobile_combustion', 'fugitive', 'purchased_electricity', 'water_supply', 'water_discharge', 'waste_generated']])).rows;
      return { job, sheets, counts, activities, facilities, rows, catalogue: cat, enterable: await enterable(c, req) };
    });
  });

  app.put('/api/smart-import/:id/sheets/:sid', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req), sid = z.string().uuid().parse((req.params as { sid: string }).sid);
    const m = sheetMapSchema.parse((req.body as { mapping?: unknown })?.mapping);
    return tenantTx(tenant, async (c) => {
      const job = await jobOf(c, id);
      if (job.status === 'done') throw new AppError('This import is finished');
      if (!(await c.query(`UPDATE import_sheet SET mapping = $3, proposed_by = 'person' WHERE id = $1 AND job_id = $2`, [sid, id, JSON.stringify(m)])).rowCount) throw notFound('Sheet');
      await propose(c, tenant, id, [sid]);
      await resolve(c, req, tenant, id, { useAi: true });
      await audit(c, req, 'smart_import.layout', 'import_job', id, { sheet: sid, mapping: m });
      return { ok: true };
    });
  });

  app.put('/api/smart-import/:id/items', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req);
    const b = z.object({ description: z.string().nullable(), unitText: z.string().nullable(), itemId: z.number().int().nullable(), remember: z.boolean().default(false) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await jobOf(c, id);
      const cat = await loadCatalogue(c);
      if (b.itemId && !cat.byId.has(b.itemId)) throw new AppError('This item cannot be imported here');
      const key = keyOf(b.description, b.unitText);
      const ids = (await c.query(`SELECT id, description, unit_text FROM import_row WHERE job_id = $1 AND status <> 'created'`, [id])).rows.filter((r) => keyOf(r.description, r.unit_text) === key).map((r) => r.id);
      await c.query(`UPDATE import_row SET item_id = $2, item_method = $3, item_conf = $4 WHERE id = ANY($1)`, [ids, b.itemId, b.itemId ? 'manual' : null, b.itemId ? 1 : null]);
      if (b.remember && b.itemId && b.description)
        await c.query(`INSERT INTO import_rule (tenant_id, kind, pattern, item_id, created_name) VALUES ($1, 'item', $2, $3, $4) ON CONFLICT (tenant_id, kind, pattern) DO UPDATE SET item_id = EXCLUDED.item_id`,
          [tenant, normText(b.description), b.itemId, req.user.name]);
      await resolve(c, req, tenant, id, { cat });
      await audit(c, req, 'smart_import.item', 'import_job', id, b);
      return { rows: ids.length };
    });
  });

  app.put('/api/smart-import/:id/facilities', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req);
    const b = z.object({ text: z.string().nullable(), facilityId: z.string().uuid().nullable(), remember: z.boolean().default(false) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await jobOf(c, id);
      if (b.facilityId && !(await enterable(c, req)).some((f) => f.id === b.facilityId)) throw new AppError('You cannot enter data for this facility', 403);
      const n = (await c.query(`UPDATE import_row SET facility_id = $3::uuid, facility_person = $3::uuid IS NOT NULL WHERE job_id = $1 AND facility_text IS NOT DISTINCT FROM $2::text AND status <> 'created'`, [id, b.text, b.facilityId])).rowCount;
      if (b.remember && b.facilityId && b.text)
        await c.query(`INSERT INTO import_rule (tenant_id, kind, pattern, facility_id, created_name) VALUES ($1, 'facility', $2, $3, $4) ON CONFLICT (tenant_id, kind, pattern) DO UPDATE SET facility_id = EXCLUDED.facility_id`,
          [tenant, normText(b.text), b.facilityId, req.user.name]);
      await resolve(c, req, tenant, id);
      await audit(c, req, 'smart_import.facility', 'import_job', id, b);
      return { rows: n };
    });
  });

  app.put('/api/smart-import/:id/rows', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req);
    const b = z.object({ ids: z.array(z.number().int()).min(1).max(5000), excluded: z.boolean() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await jobOf(c, id);
      await c.query(`UPDATE import_row SET status = CASE WHEN $3 THEN 'excluded' ELSE 'problem' END, person = $3 WHERE job_id = $1 AND id = ANY($2) AND status <> 'created'`, [id, b.ids, b.excluded]);
      if (!b.excluded) await resolve(c, req, tenant, id);
      return { ok: true };
    });
  });

  app.post('/api/smart-import/:id/create', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req);
    return tenantTx(tenant, async (c) => {
      const job = await jobOf(c, id);
      const cat = await loadCatalogue(c);
      const t = (await c.query(`SELECT id, gwp_set, flight_rf FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const rows = (await c.query(`SELECT * FROM import_row WHERE job_id = $1 AND status = 'ready' ORDER BY id`, [id])).rows;
      let created = 0, failed = 0, submitted = 0, kg = 0;
      for (const r of rows) {
        const d = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : String(x).slice(0, 10));
        const b = bodyOf(cat, { item_id: r.item_id, unit: r.unit, quantity: Number(r.quantity), period_start: d(r.period_start), period_end: d(r.period_end), facility_id: r.facility_id, description: r.description, data_type: r.data_type, note: r.note ? `${r.note} · Smart import: ${job.filename}` : `Smart import: ${job.filename}` });
        await c.query('SAVEPOINT row');
        try {
          if ('problem' in b) throw new AppError(b.problem);
          const e = await saveEntry(c, req, t, saveSchema.parse(b.body), { quiet: true });
          if (job.document_id) await c.query(`INSERT INTO document_link (tenant_id, document_id, activity_id, linked_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [tenant, job.document_id, e.id, req.user.id]);
          // created by the importer, submitted for approval: a person reviewed every row (maker); the approver checks
          const sub = await c.query(`UPDATE activity SET status = 'submitted', submitted_at = now(), submitted_by = $2 WHERE id = $1 AND status = 'draft'
                                       AND NOT (coalesce((inputs->'wasteInfo'->>'hazardous')::boolean, false) AND coalesce(trim(inputs->'wasteInfo'->>'ref'), '') = '')`, [e.id, req.user.id]);
          await c.query(`UPDATE import_row SET status = 'created', activity_id = $2, co2e = $3 WHERE id = $1`, [r.id, e.id, e.totals.direct + e.totals.scope2 + e.totals.scope3]);
          await c.query('RELEASE SAVEPOINT row');
          created++; submitted += sub.rowCount ?? 0; kg += e.totals.direct + e.totals.scope2 + e.totals.scope3;
        } catch (err) {
          await c.query('ROLLBACK TO SAVEPOINT row');
          await c.query(`UPDATE import_row SET status = 'problem', problems = $2 WHERE id = $1`, [r.id, [(err as Error).message]]);
          failed++;
        }
      }
      const left = Number((await c.query(`SELECT count(*) FROM import_row WHERE job_id = $1 AND status IN ('ready', 'check', 'problem')`, [id])).rows[0].count);
      const summary = { created, submitted, failed, kg, left };
      await c.query(`UPDATE import_job SET status = CASE WHEN $2 = 0 THEN 'done' ELSE status END, done_at = CASE WHEN $2 = 0 THEN now() ELSE done_at END, summary = $3 WHERE id = $1`, [id, left, JSON.stringify(summary)]);
      await audit(c, req, 'smart_import.create', 'import_job', id, summary);
      return summary;
    });
  });

  app.delete('/api/smart-import/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...ENTER);
    const id = idP(req);
    return tenantTx(tenant, async (c) => {
      await jobOf(c, id);
      await c.query(`DELETE FROM import_job WHERE id = $1`, [id]);
      await audit(c, req, 'smart_import.delete', 'import_job', id, {});
      return { ok: true };
    });
  });
}
