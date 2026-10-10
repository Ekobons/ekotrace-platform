/**
 * Published purchases, line by line: the lines behind the entries, across batches.
 *
 * Entries are monthly sums (facility × month × spend category); the lines stay stored with
 * their factor, exchange rate and result, so any total can be opened down to the invoice line.
 * The list is paged on the server (a 50,000-line batch is never sent to the browser at once),
 * with filters, totals for the whole selection and a download of the selection as Excel or CSV.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../../db/pool.js';
import { requireTenant } from '../../lib/auth.js';
import { scopeOf } from '../../lib/access.js';

const filters = z.object({
  batch: z.string().uuid().optional(), activity: z.string().uuid().optional(), facility: z.string().uuid().optional(), supplier: z.string().uuid().optional(),
  item: z.coerce.number().int().optional(), category: z.string().max(40).optional(), year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(), method: z.enum(['supplier', 'spend']).optional(), estimate: z.enum(['yes', 'no']).optional(),
  q: z.string().max(200).optional(),
});
type Filters = z.infer<typeof filters>;
const MAX_EXPORT = 250_000;

async function where(c: Tx, req: FastifyRequest, f: Filters) {
  const scope = await scopeOf(c, req.user);
  const params: unknown[] = [[...scope.see]];
  const conds = [`l.status = 'published'`, `l.facility_id = ANY($1)`];
  const add = (sql: string, v: unknown) => { params.push(v); conds.push(sql.replace('?', `$${params.length}`)); };
  if (f.batch) add('l.batch_id = ?', f.batch);
  if (f.activity) add('l.activity_id = ?', f.activity);
  if (f.facility) add('l.facility_id = ?', f.facility);
  if (f.supplier) add('l.supplier_id = ?', f.supplier);
  if (f.item) add('l.item_id = ?', f.item);
  if (f.category) add('cat.code = ?', f.category);
  if (f.year) add('extract(year FROM l.period_start) = ?', f.year);
  if (f.month) add('extract(month FROM l.period_start) = ?', f.month);
  if (f.method) add('l.method = ?', f.method);
  if (f.estimate === 'yes') conds.push(`i.code LIKE 'purchase:%'`);
  if (f.estimate === 'no') conds.push(`i.code NOT LIKE 'purchase:%'`);
  if (f.q) add(`(lower(l.description) LIKE ? OR lower(coalesce(l.supplier_text,'')) LIKE $${params.length + 1} OR lower(coalesce(l.po_ref,'')) LIKE $${params.length + 1} OR lower(coalesce(l.gl_account,'')) LIKE $${params.length + 1})`, `%${f.q.toLowerCase()}%`);
  return { params, sql: conds.join(' AND ') };
}
const FROM = `FROM purchase_line l JOIN activity a ON a.id = l.activity_id JOIN category cat ON cat.id = a.category_id
              LEFT JOIN org_node fac ON fac.id = l.facility_id LEFT JOIN item i ON i.id = l.item_id LEFT JOIN supplier s ON s.id = l.supplier_id
              LEFT JOIN purchase_batch b ON b.id = l.batch_id`;
const COLS = `l.id, l.row_no, b.name AS file, to_char(l.purchase_date,'YYYY-MM-DD') AS date, to_char(l.period_start,'YYYY-MM') AS month, fac.name AS facility,
              l.description, l.gl_account, l.category_text, l.po_ref, coalesce(s.name, l.supplier_text) AS supplier, l.amount::float8 AS amount, l.currency,
              l.usd::float8 AS usd, cat.name AS category, i.name AS item, (i.code LIKE 'purchase:%') AS estimate, l.method,
              l.co2e::float8 AS co2e, l.fx_per_usd::float8 AS fx, l.cpi_ratio::float8 AS cpi, l.activity_id, l.batch_id`;

export async function publishedLineRoutes(app: FastifyInstance) {
  app.get('/api/purchases/published', async (req) => {
    const tenant = requireTenant(req);
    const q = filters.extend({
      offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(500).default(100),
      sort: z.enum(['date', 'co2e', 'usd']).default('co2e'),
    }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const w = await where(c, req, q);
      const tot = (await c.query(
        `SELECT count(*)::int AS lines, coalesce(sum(l.usd), 0)::float8 AS usd, coalesce(sum(l.co2e), 0)::float8 AS co2e, count(DISTINCT l.activity_id)::int AS entries,
                count(DISTINCT l.supplier_id)::int AS suppliers, count(*) FILTER (WHERE i.code LIKE 'purchase:%')::int AS estimated
           ${FROM} WHERE ${w.sql}`, w.params)).rows[0];
      const order = q.sort === 'date' ? 'l.purchase_date DESC NULLS LAST, l.id' : q.sort === 'usd' ? 'abs(l.usd) DESC NULLS LAST, l.id' : 'abs(l.co2e) DESC NULLS LAST, l.id';
      const lines = (await c.query(`SELECT ${COLS} ${FROM} WHERE ${w.sql} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${q.offset}`, w.params)).rows;
      // what the filters can offer, within the current selection (largest first)
      const opts = async (sel: string, grp: string) => (await c.query(`SELECT ${sel}, coalesce(sum(l.co2e), 0)::float8 AS co2e, count(*)::int AS n ${FROM} WHERE ${w.sql} GROUP BY ${grp} ORDER BY 3 DESC LIMIT 60`, w.params)).rows;
      return {
        total: tot, lines,
        options: {
          facilities: await opts('fac.id, fac.name', 'fac.id, fac.name'),
          categories: await opts('cat.code AS id, cat.name', 'cat.code, cat.name'),
          items: await opts('i.id, i.name', 'i.id, i.name'),
          months: (await c.query(`SELECT DISTINCT to_char(l.period_start,'YYYY-MM') AS m ${FROM} WHERE ${w.sql} ORDER BY 1`, w.params)).rows.map((r) => r.m),
        },
      };
    });
  });

  app.get('/api/purchases/published/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const q = filters.extend({ format: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const rows = await tenantTx(tenant, async (c) => {
      const w = await where(c, req, q);
      return (await c.query(`SELECT ${COLS} ${FROM} WHERE ${w.sql} ORDER BY l.period_start, fac.name, l.batch_id, l.row_no LIMIT ${MAX_EXPORT}`, w.params)).rows;
    });
    const head: [string, string, number][] = [
      ['Date', 'date', 11], ['Month', 'month', 9], ['Facility', 'facility', 22], ['Description', 'description', 40], ['Account', 'gl_account', 18],
      ['Category in file', 'category_text', 18], ['PO / document', 'po_ref', 14], ['Supplier', 'supplier', 26], ['Amount', 'amount', 12], ['Currency', 'currency', 8],
      ['USD', 'usd', 12], ['Scope 3 category', 'category', 24], ['Spend category', 'item', 34], ['Average factor', 'estimate', 9], ['Method', 'method', 9],
      ['kg CO2e', 'co2e', 12], ['Currency per USD', 'fx', 10], ['Price index ratio', 'cpi', 10], ['File', 'file', 24], ['Row in file', 'row_no', 8], ['Entry id', 'activity_id', 36],
    ];
    const val = (r: Record<string, unknown>, k: string) => (k === 'estimate' ? (r[k] ? 'yes' : '') : r[k] ?? '');
    const name = `Ekotrace published purchases ${new Date().toISOString().slice(0, 10)}`;
    if (q.format === 'csv') {
      const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const body = '﻿' + [head.map((h) => esc(h[0])).join(','), ...rows.map((r) => head.map((h) => esc(val(r, h[1]))).join(','))].join('\r\n');
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}.csv"`).send(body);
    }
    const out = new PassThrough();
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
    const ws = wb.addWorksheet('Published purchases', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = head.map(([header, key, width]) => ({ header, key, width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).commit();
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    void (async () => {
      for (const r of rows) ws.addRow(Object.fromEntries(head.map((h) => [h[1], val(r, h[1])]))).commit();
      ws.commit();
      await wb.commit();
    })().catch((e) => out.destroy(e));
    return reply.send(out);
  });
}
