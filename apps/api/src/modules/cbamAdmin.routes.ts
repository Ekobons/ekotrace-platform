/**
 * Platform staff load the Commission's CBAM default values and benchmarks (any spreadsheet layout) into the shared
 * library used by every company and by the free calculator.
 *
 *   POST /api/platform/cbam/reference/preview          the file → its columns, first rows and a guess of the mapping
 *   POST /api/platform/cbam/reference/import?…          the file + mapping → shared rows (replacing the same kind, year and source)
 *   POST /api/platform/cbam/reference/official          the Commission's default-values or benchmarks workbook as published → every value
 *   DELETE /api/platform/cbam/reference?kind&year&source  remove a loaded set
 *
 * The preview recognises the Commission's own files (one sheet per country, Annex IV, the Benchmarks sheet) and says so;
 * those are loaded with /official, which keeps direct, indirect, production route and benchmark column.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx } from '../db/pool.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { cellText, detectKind, findHeaderRow, sheetRows, type Cell } from '../lib/sheet.js';
import { cnInfo, markup } from '../lib/cbam.js';
import { airports } from '../lib/airports.js';
import { readOfficial, storeOfficial, type OfficialFile } from '../lib/cbamOfficial.js';

/** What a Commission file holds, for the preview. */
function summary(o: OfficialFile) {
  const by = (k: string) => o.rows.filter((r) => r.kind === k).length;
  return {
    kind: o.kind, source: o.source, version: o.version, legal: o.legal, total: o.rows.length,
    defaults: by('default'), highest: by('highest'), benchmarksA: o.rows.filter((r) => r.basis === 'A').length, benchmarksB: o.rows.filter((r) => r.basis === 'B').length,
    countries: o.countries.filter((c) => c.code).length, other: o.countries.some((c) => c.name.startsWith('Other')),
    unknown: o.unknown, skipped: o.skipped.length, problems: o.skipped.slice(0, 10),
    sample: o.rows.slice(0, 8).map((r) => ({ kind: r.kind, cn: r.cn, country: r.country, value: r.value, direct: r.direct, indirect: r.indirect, route: r.route, basis: r.basis, description: r.description.slice(0, 90) })),
  };
}

async function readAll(body: unknown, filename: string) {
  if (!Buffer.isBuffer(body) || !body.length) throw new AppError('Send the file');
  const kind = detectKind(body, filename);
  if (kind !== 'xlsx' && kind !== 'csv') throw new AppError('Send an Excel (.xlsx) or CSV file');
  const all: Cell[][] = [];
  for await (const r of sheetRows(body, kind)) { all.push(r); if (all.length > 200_000) throw new AppError('At most 200,000 rows'); }
  const h = findHeaderRow(all);
  const header = (all[h] ?? []).map((c) => cellText(c).trim());
  return { header, rows: all.slice(h + 1).map((r) => header.map((_, i) => cellText(r[i] ?? null).trim())).filter((r) => r.some((x) => x !== '')) };
}
const low = (s: string) => s.toLowerCase();
function guess(header: string[]) {
  const find = (...ws: string[]) => header.findIndex((x) => ws.some((w) => low(x).includes(w)));
  return { cn: find('cn code', 'cn', 'commodity', 'tariff'), country: find('country', 'origin'), value: find('default value', 'total', 'value', 'benchmark', 'see') };
}
const num = (s: string) => { const x = Number(s.replace(/\s/g, '').replace(',', '.')); return s === '' || !Number.isFinite(x) ? null : x; };

export async function cbamAdminRoutes(app: FastifyInstance) {
  app.post('/api/platform/cbam/reference/preview', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'values.xlsx'));
    const o = Buffer.isBuffer(req.body) && /\.xlsx$/i.test(name) ? await readOfficial(req.body) : null;
    if (o) return { official: summary(o), header: [], sample: [], total: o.rows.length, guess: { cn: -1, country: -1, value: -1 } };
    const f = await readAll(req.body, name);
    return { official: null, header: f.header, sample: f.rows.slice(0, 15), total: f.rows.length, guess: guess(f.header) };
  });

  app.post('/api/platform/cbam/reference/import', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({
      kind: z.enum(['default', 'benchmark']), year: z.coerce.number().int().min(2023).max(2100), source: z.string().trim().min(3).max(300),
      cnCol: z.coerce.number().int().min(0), countryCol: z.coerce.number().int().min(-1).default(-1), valueCol: z.coerce.number().int().min(0),
      includesMarkup: z.enum(['0', '1']).default('0'), indicative: z.enum(['0', '1']).default('0'),
    }).parse(req.query);
    const f = await readAll(req.body, decodeURIComponent(String(req.headers['x-filename'] ?? 'values.xlsx')));
    const names = [...airports().countries.entries()];
    const toCountry = (s: string) => { if (!s) return null; if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase(); return names.find(([, n]) => low(n) === low(s))?.[0] ?? null; };
    const ok: { cn: string; country: string | null; value: number }[] = [];
    const skipped: { row: number; why: string }[] = [];
    f.rows.forEach((r, i) => {
      const cn = (r[q.cnCol] ?? '').replace(/\D/g, '');
      const v = num(r[q.valueCol] ?? '');
      const ctry = q.countryCol >= 0 ? toCountry(r[q.countryCol] ?? '') : null;
      if (!/^\d{4,10}$/.test(cn)) { skipped.push({ row: i + 2, why: 'no CN code' }); return; }
      const info = cnInfo(cn);
      if (!info) { skipped.push({ row: i + 2, why: `CN ${cn} is not a CBAM good` }); return; }
      if (v == null || v < 0) { skipped.push({ row: i + 2, why: 'no value' }); return; }
      if (q.countryCol >= 0 && r[q.countryCol] && !ctry) { skipped.push({ row: i + 2, why: `country "${r[q.countryCol]}" not recognised` }); return; }
      // values that already include the year's mark-up are stored without it (the tool adds the mark-up of each year)
      ok.push({ cn, country: ctry, value: q.kind === 'default' && q.includesMarkup === '1' ? v / (1 + markup(q.year, info.sector)) : v });
    });
    if (!ok.length) throw new AppError(`No usable row (${skipped.slice(0, 3).map((s) => `row ${s.row}: ${s.why}`).join('; ')})`);
    return platformTx(async (c) => {
      const del = await c.query(`DELETE FROM cbam_reference WHERE tenant_id IS NULL AND kind = $1 AND year = $2 AND source = $3`, [q.kind, q.year, q.source]);
      for (let i = 0; i < ok.length; i += 500) {
        const part = ok.slice(i, i + 500);
        const vals = part.map((_, k) => `(NULL, $1, $${k * 3 + 6}, $${k * 3 + 7}, $2, $${k * 3 + 8}, $3, $4, $5)`).join(',');
        await c.query(`INSERT INTO cbam_reference (tenant_id, kind, cn, country, year, value, source, indicative, created_name) VALUES ${vals}`,
          [q.kind, q.year, q.source, q.indicative === '1', req.user.name, ...part.flatMap((x) => [x.cn, x.country, x.value])]);
      }
      await c.query(`INSERT INTO audit_log (user_id, user_name, action, entity, detail, ip) VALUES ($1,$2,'cbam.reference.import','cbam_reference',$3,$4)`,
        [req.user.id, req.user.name, JSON.stringify({ kind: q.kind, year: q.year, source: q.source, rows: ok.length, replaced: del.rowCount, skipped: skipped.length }), req.ip]);
      return { imported: ok.length, replaced: del.rowCount ?? 0, skipped: skipped.length, problems: skipped.slice(0, 20) };
    });
  });

  app.post('/api/platform/cbam/reference/official', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ year: z.coerce.number().int().min(2026).max(2100).default(2026) }).parse(req.query);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('Send the file');
    const o = await readOfficial(req.body);
    if (!o) throw new AppError("This is not one of the Commission's CBAM default-value or benchmark workbooks: use the column mapping instead");
    if (o.unknown.length) throw new AppError(`Country not recognised: ${o.unknown.join(', ')}`);
    return platformTx(async (c) => ({ ...summary(o), ...(await storeOfficial(c, o, { id: req.user.id, name: req.user.name }, req.ip, q.year)) }));
  });

  app.get('/api/platform/cbam/reference/sets', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({ sets: (await c.query(`SELECT kind, year, source, indicative, count(*)::int AS rows, max(created_at) AS loaded FROM cbam_reference WHERE tenant_id IS NULL AND kind <> 'price' GROUP BY kind, year, source, indicative ORDER BY max(created_at) DESC`)).rows }));
  });
  app.delete('/api/platform/cbam/reference', async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ kind: z.enum(['default', 'benchmark', 'highest']), year: z.coerce.number().int(), source: z.string().min(1).max(300) }).parse(req.query);
    return platformTx(async (c) => {
      const r = await c.query(`DELETE FROM cbam_reference WHERE tenant_id IS NULL AND kind = $1 AND year = $2 AND source = $3`, [q.kind, q.year, q.source]);
      await c.query(`INSERT INTO audit_log (user_id, user_name, action, entity, detail, ip) VALUES ($1,$2,'cbam.reference.remove','cbam_reference',$3,$4)`, [req.user.id, req.user.name, JSON.stringify({ ...q, rows: r.rowCount }), req.ip]);
      return { removed: r.rowCount ?? 0 };
    });
  });
}
