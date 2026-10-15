/**
 * Supplier engagement (Value chain).
 *
 *   POST /api/suppliers/import?commit=0|1     a supplier list (Excel / CSV): preview, then create new suppliers and fill blanks of existing ones
 *   GET  /api/suppliers/export                every supplier with engagement, score, SBTi and the year's purchase emissions (CSV)
 *   GET  /api/suppliers/engagement?year=      emissions-weighted SBTi / CDP / score splits, non-SBTi suppliers by country and category,
 *                                             C-or-lower suppliers by category, the engagement funnel, and supplier trajectories to 2050
 *   GET  /api/sbti                            the SBTi list loaded on the platform (rows, when, by whom)
 *   POST /api/sbti/import                     load the SBTi "companies taking action" export (platform admin; replaces the list)
 *
 * Trajectories: each supplier's emissions in the chosen year (from purchases) follow its declared target — the
 * reduction % from its base year to the target year as a straight line, then on to a 90 % cut by its net-zero year —
 * or, without numbers, the SBTi pathway of its classification (1.5 °C: 4.2 %/yr; well-below 2 °C: 2.5 %/yr).
 * Credibility: high = science-based target validated; average = committed or own target with numbers; weak = none.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx } from '../db/pool.js';
import { audit, requirePlatformAdmin, requireRole, requireTenant } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { cellText, detectKind, findHeaderRow, sheetRows, type Cell } from '../lib/sheet.js';
import { normSupplier } from './purchases/fields.js';
import { countryCode } from './purchases/supplierMatch.js';
import { ENGAGE_JOIN, engagement, supplierBody } from './purchases/suppliers.routes.js';
import { STAGE_SQL, sbtiCommitted, sbtiSet } from '../lib/supplierScore.js';

const MANAGE = ['super_admin', 'admin', 'manager'] as const;
const low = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function readTable(buf: unknown, filename: string, max = 5000) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
  const kind = detectKind(buf, filename);
  if (kind === 'xls') throw new AppError('Save the file as .xlsx or .csv');
  if (kind === 'unknown') throw new AppError('Send an Excel (.xlsx) or CSV file');
  const all: Cell[][] = [];
  for await (const r of sheetRows(buf, kind)) { all.push(r); if (all.length > max + 20) throw new AppError(`At most ${max.toLocaleString('en')} rows per file`); }
  const h = findHeaderRow(all);
  return { header: (all[h] ?? []).map((c) => cellText(c)), rows: all.slice(h + 1) };
}
/** Index of the first header matching one of the names (whole words). */
const col = (header: string[], names: string[]) => {
  const H = header.map(low);
  for (const n of names) { const i = H.findIndex((x) => x === n); if (i >= 0) return i; }
  for (const n of names) { const i = H.findIndex((x) => ` ${x} `.includes(` ${n} `)); if (i >= 0) return i; }
  return -1;
};

const LIST_COLS: Record<string, string[]> = {
  name: ['supplier name', 'vendor name', 'supplier', 'vendor', 'company name', 'company', 'name'],
  reference: ['internal code', 'vendor number', 'vendor no', 'vendor code', 'supplier code', 'supplier number', 'supplier id', 'vendor id', 'code'],
  country: ['country', 'supplier country', 'vendor country'], department: ['procurement department', 'department', 'category owner', 'buyer', 'purchasing category'],
  contactName: ['contact name', 'sustainability contact', 'contact person', 'contact'], contactEmail: ['contact email', 'e mail', 'email', 'mail'],
  website: ['website', 'web site', 'url'], industry: ['industry', 'sector', 'what they supply'], kind: ['type', 'supplier type', 'status'], cdpScore: ['cdp score', 'cdp'], trn: ['trn', 'tax number', 'vat number', 'registration number'],
};
const FIELD_TEXT: Record<string, string> = { name: 'Name', reference: 'Internal code / vendor number', country: 'Country', department: 'Procurement department', contactName: 'Contact name', contactEmail: 'Contact e-mail', website: 'Website', industry: 'Industry', kind: 'Type (current / prospect)', cdpScore: 'CDP score', trn: 'Tax / registration number' };

export async function supplierEngagementRoutes(app: FastifyInstance) {
  app.post('/api/suppliers/import', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...MANAGE);
    const { commit } = z.object({ commit: z.coerce.number().int().min(0).max(1).default(0) }).parse(req.query);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'suppliers.csv'));
    const t = await readTable(req.body, filename);
    const map = Object.fromEntries(Object.entries(LIST_COLS).map(([k, names]) => [k, col(t.header, names)])) as Record<string, number>;
    if (map.name! < 0) throw new AppError(`No supplier name column found. Columns seen: ${t.header.filter(Boolean).slice(0, 12).join(', ')}`);
    return tenantTx(tenant, async (c) => {
      const out: { row: number; name: string; action: 'new' | 'update' | 'same' | 'error'; detail: string }[] = [];
      let created = 0, updated = 0;
      const seen = new Set<string>();
      for (const [i, r] of t.rows.entries()) {
        const get = (k: string) => (map[k]! >= 0 ? cellText(r[map[k]!]) : '');
        const name = get('name');
        if (!name) continue;
        const kindTxt = low(get('kind'));
        const parsed = supplierBody.safeParse({
          name, reference: get('reference'), country: get('country'), department: get('department'), contactName: get('contactName'), contactEmail: get('contactEmail'), website: get('website'),
          industry: get('industry'), trn: get('trn'), kind: /prospect|potential|new/.test(kindTxt) ? 'prospect' : 'current', cdpScore: get('cdpScore').toUpperCase() || undefined,
        });
        if (!parsed.success) { out.push({ row: i + 1, name, action: 'error', detail: parsed.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`).join('; ') }); continue; }
        const b = parsed.data, norm = normSupplier(b.name);
        if (!norm) { out.push({ row: i + 1, name, action: 'error', detail: 'Name has no letters or digits' }); continue; }
        if (seen.has(norm)) { out.push({ row: i + 1, name, action: 'same', detail: 'Repeated in the file' }); continue; }
        seen.add(norm);
        const ex = (await c.query(`SELECT * FROM supplier WHERE norm = $1 OR $1 = ANY(aliases) OR ($2::text IS NOT NULL AND lower(reference) = lower($2)) ORDER BY (norm = $1) DESC LIMIT 1`, [norm, b.reference ?? null])).rows[0];
        if (ex) {
          // fill only what is blank: the file never overwrites what someone typed
          const fill: [string, unknown][] = ([['reference', b.reference], ['country', b.country], ['department', b.department], ['contact_name', b.contactName], ['contact_email', b.contactEmail],
            ['website', b.website], ['industry', b.industry], ['trn', b.trn], ['cdp_score', b.cdpScore]] as [string, unknown][]).filter(([k, v]) => v && !ex[k]);
          out.push({ row: i + 1, name, action: fill.length ? 'update' : 'same', detail: fill.length ? `${ex.name}: adds ${fill.map(([k]) => k.replace('_', ' ')).join(', ')}` : `Already there as ${ex.name}` });
          if (commit && fill.length) { await c.query(`UPDATE supplier SET ${fill.map(([k], j) => `${k} = $${j + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [ex.id, ...fill.map(([, v]) => v)]); updated++; }
          continue;
        }
        out.push({ row: i + 1, name, action: 'new', detail: [b.kind === 'prospect' ? 'prospect' : null, b.reference ? `code ${b.reference}` : null, b.country, b.department].filter(Boolean).join(' · ') });
        if (commit) {
          const id = (await c.query(
            `INSERT INTO supplier (tenant_id, name, norm, country, reference, contact_email, contact_name, industry, website, kind, department, cdp_score, trn, origin)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'list') RETURNING id`,
            [tenant, b.name, norm, b.country ?? null, b.reference ?? null, b.contactEmail ?? null, b.contactName ?? null, b.industry ?? null, b.website ?? null, b.kind, b.department ?? null, b.cdpScore ?? null, b.trn ?? null])).rows[0].id;
          await c.query(`INSERT INTO supplier_match (tenant_id, supplier_id, name_seen, norm, method, confirmed) VALUES ($1,$2,$3,$4,'manual',true) ON CONFLICT (tenant_id, norm) DO NOTHING`, [tenant, id, b.name, norm]);
          created++;
        }
      }
      const n = (a: string) => out.filter((x) => x.action === a).length;
      if (commit) await audit(c, req, 'supplier.import', 'supplier', null, { filename, created, updated, errors: n('error') });
      return { committed: !!commit, columns: Object.fromEntries(Object.entries(map).filter(([, v]) => v >= 0).map(([k, v]) => [FIELD_TEXT[k], t.header[v]])),
        totals: { new: n('new'), update: n('update'), same: n('same'), error: n('error') }, created, updated, rows: out.slice(0, commit ? 200 : 500) };
    });
  });

  app.get('/api/suppliers/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const { year } = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getUTCFullYear() - 1) }).parse(req.query);
    const rows = await tenantTx(tenant, async (c) => (await c.query(
      `SELECT s.*, ${STAGE_SQL} AS stage, rq.status AS rq_status, rq.answers AS rq_answers, sb.sbti_name, sb.near_status, sb.near_class, sb.net_zero_status, sb.net_zero_year,
              coalesce(x.kg, 0)::float8 AS kg, coalesce(x.usd, 0)::float8 AS usd
         FROM supplier s ${ENGAGE_JOIN}
         LEFT JOIN LATERAL (SELECT sum(l.co2e) AS kg, sum(l.usd) AS usd FROM purchase_line l WHERE l.supplier_id = s.id AND l.status IN ('ready','check','published') AND extract(year FROM l.period_start) = $1) x ON true
        WHERE s.active ORDER BY coalesce(x.kg, 0) DESC, s.name`, [year])).rows);
    const STAGE: Record<string, string> = { not_engaged: 'Not engaged', invited: 'Invited', signed_in: 'Signed in', started: 'Survey started', submitted: 'Submitted', finished: 'Finished' };
    const q = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Supplier', 'Internal code', 'Type', 'Procurement department', 'Country', 'Industry', 'Contact', 'Contact e-mail', `tCO2e ${year} (purchases)`, `Spend ${year} (USD)`,
      'Engagement', 'Completion %', 'Score', 'Grade', 'GHG report', 'SBTi target validated', 'SBTi list status', 'SBTi classification', 'Net-zero year', 'CDP score', 'Climate target'];
    const lines = rows.map((r) => {
      const e = engagement(r);
      return [r.name, r.reference, r.kind, r.department, r.country, r.industry, r.contact_name, r.contact_email, (r.kg / 1000).toFixed(3), Math.round(r.usd), STAGE[r.stage], e.completion ?? '', e.score, e.letter,
        e.ghgReport ? 'yes' : 'no', e.sbti ? 'yes' : 'no', r.near_status ?? '', r.near_class ?? '', r.target?.netZeroYear ?? r.net_zero_year ?? '', r.cdp_score ?? '', r.climate_target ?? ''].map(q).join(',');
    });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="suppliers-${year}.csv"`).send('﻿' + [head.join(','), ...lines].join('\n'));
  });

  app.get('/api/suppliers/engagement', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const years = (await c.query(`SELECT DISTINCT extract(year FROM period_start)::int AS y FROM purchase_line WHERE period_start IS NOT NULL AND status IN ('ready','check','published') ORDER BY 1 DESC`)).rows.map((r) => r.y as number);
      const year = q.year ?? years[0] ?? new Date().getFullYear() - 1;
      const CAT = `CASE WHEN g.decision = 'move' AND g.target IS NOT NULL THEN g.target WHEN coalesce(l.capital, g.capital) THEN 'capital_goods' ELSE 'purchased_goods' END`;
      const rows = (await c.query(
        `SELECT s.id, s.name, s.country, s.kind, s.reports_emissions, s.climate_target, s.cdp_score, s.target, ${STAGE_SQL} AS stage, rq.status AS rq_status, rq.answers AS rq_answers,
                sb.sbti_name, sb.near_status, sb.near_class, sb.near_year, sb.net_zero_status, sb.net_zero_year, x.kg, x.cat
           FROM (SELECT l.supplier_id, sum(l.co2e)::float8 AS kg, (array_agg(${CAT} ORDER BY l.co2e DESC NULLS LAST))[1] AS cat
                   FROM purchase_line l JOIN purchase_group g ON g.batch_id = l.batch_id AND g.key = l.group_key
                  WHERE l.status IN ('ready','check','published') AND extract(year FROM l.period_start) = $1 AND l.supplier_id IS NOT NULL GROUP BY 1) x
           JOIN supplier s ON s.id = x.supplier_id ${ENGAGE_JOIN}
          ORDER BY x.kg DESC NULLS LAST`, [year])).rows;
      const total = rows.reduce((a, r) => a + Math.max(0, r.kg ?? 0), 0);
      const sup = rows.map((r) => {
        const e = engagement(r);
        const a = r.rq_status && ['submitted', 'accepted'].includes(r.rq_status) ? (r.rq_answers?.targets ?? null) : null;
        const validated = e.sbti, committed = !validated && (r.climate_target === 'sbti_committed' || a?.status === 'sbti_committed' || sbtiCommitted(r.near_status));
        const sbtiKey = validated ? 'validated' : committed ? 'committed' : (r.climate_target === 'own' || a?.status === 'own') ? 'own' : (r.climate_target === 'none' || a?.status === 'none') ? 'none' : 'unknown';
        // declared target → path
        const pct = a?.reductionPct ?? r.target?.reductionPct ?? null, base = a?.baseYear ?? r.target?.baseYear ?? year, ty = a?.targetYear ?? r.target?.targetYear ?? null;
        const nz = a?.netZeroYear ?? r.target?.netZeroYear ?? r.net_zero_year ?? null;
        let rate: number | null = pct != null && ty && ty > base ? pct / (ty - base) : null;                       // % of base-year emissions a year
        if (rate == null && (validated || sbtiSet(r.near_status))) rate = /1\.5/.test(r.near_class ?? '') || !r.near_class ? 4.2 : 2.5;
        if (rate == null && committed) rate = 2.5;
        const until = ty ?? (rate != null ? 2030 : null);
        const cred = validated ? 'high' : rate != null ? 'average' : 'weak';
        const at = (y: number) => {
          const E = Math.max(0, r.kg ?? 0);
          if (rate == null || y <= year) return E;
          const tEnd = until ?? year, lin = (yy: number) => E * Math.max(0, 1 - (rate! / 100) * (Math.min(yy, tEnd) - year));
          if (y <= tEnd || !nz || nz <= tEnd) return lin(y);
          const vT = lin(tEnd), floor = E * 0.1;                                    // net zero: about 90 % below, the rest neutralised
          return vT <= floor ? vT : vT + (floor - vT) * Math.min(1, (y - tEnd) / (nz - tEnd));
        };
        return { id: r.id, name: r.name, country: r.country ?? '', category: r.cat ?? 'purchased_goods', kg: Math.max(0, r.kg ?? 0), stage: r.stage, letter: e.letter, score: e.score,
          sbti: sbtiKey, cdp: r.cdp_score ?? 'unscored', cred, at, target: pct != null ? { pct, base, ty, nz } : rate != null ? { rate, nz } : null };
      });
      const W = <K extends string>(key: (s: typeof sup[number]) => K) => {
        const m = new Map<K, { kg: number; n: number }>();
        for (const s of sup) { const k = key(s), v = m.get(k) ?? { kg: 0, n: 0 }; v.kg += s.kg; v.n++; m.set(k, v); }
        return [...m.entries()].map(([k, v]) => ({ key: k, kg: v.kg, n: v.n, share: total ? v.kg / total : 0 })).sort((a, b) => b.kg - a.kg);
      };
      const notSbti = sup.filter((s) => s.sbti !== 'validated' && s.sbti !== 'committed');
      const lowScore = sup.filter((s) => ['C', 'D', 'E'].includes(s.letter));
      const by = (list: typeof sup, key: (s: typeof sup[number]) => string) => { const m = new Map<string, number>(); for (const s of list) m.set(key(s), (m.get(key(s)) ?? 0) + s.kg); return [...m.entries()].map(([k, kg]) => ({ key: k, kg })).sort((a, b) => b.kg - a.kg); };
      const tYears = [year, 2030, 2035, 2040, 2045, 2050].filter((y, i, a) => y >= year && a.indexOf(y) === i);
      const TOP = 300;
      const traj = sup.slice(0, TOP).map(({ at, ...s }) => ({ ...s, path: tYears.map(at) }));
      const rest = sup.slice(TOP);
      if (rest.length) traj.push({ id: 'others', name: `${rest.length} other suppliers`, country: '', category: 'purchased_goods', kg: rest.reduce((a, s) => a + s.kg, 0), stage: 'not_engaged', letter: 'E', score: 0, sbti: 'unknown', cdp: 'unscored', cred: 'weak', target: null, path: tYears.map((y) => rest.reduce((a, s) => a + s.at(y), 0)) });
      const sb = (await c.query(`SELECT (SELECT count(*)::int FROM sbti_company) AS rows, i.imported_at, i.filename, i.demo FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT * FROM sbti_import ORDER BY id DESC LIMIT 1) i ON true`)).rows[0];
      const matched = Number((await c.query(`SELECT count(*)::int AS n FROM supplier s ${ENGAGE_JOIN} WHERE sb.near_status IS NOT NULL`)).rows[0].n);
      return {
        year, years, total, suppliers: sup.length,
        sbti: W((s) => s.sbti), cdp: W((s) => s.cdp), letters: W((s) => s.letter), stages: W((s) => s.stage),
        notSbtiByCountry: by(notSbti, (s) => s.country || ''), notSbtiByCategory: by(notSbti, (s) => s.category), lowByCategory: by(lowScore, (s) => s.category), lowByCountry: by(lowScore, (s) => s.country || ''),
        trajectory: { years: tYears, rows: traj },
        sbtiList: { ...sb, matched }, canImportSbti: req.user.role === 'platform_admin',
      };
    });
  });

  app.get('/api/sbti', async () => platformTx(async (c) => (await c.query(`SELECT (SELECT count(*)::int FROM sbti_company) AS rows, i.imported_at, i.filename, i.imported_by, i.demo
                                                                             FROM (SELECT 1) one LEFT JOIN LATERAL (SELECT * FROM sbti_import ORDER BY id DESC LIMIT 1) i ON true`)).rows[0]));

  app.post('/api/sbti/import', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    requirePlatformAdmin(req);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'sbti.xlsx'));
    const t = await readTable(req.body, filename, 100_000);
    const H = t.header.map(low);
    const find = (test: (h: string) => boolean) => H.findIndex(test);
    const ix = {
      name: col(t.header, ['company name', 'company', 'organisation name', 'organization name', 'name']), isin: col(t.header, ['isin']), lei: col(t.header, ['lei']),
      location: col(t.header, ['location', 'country', 'headquarters country']), region: col(t.header, ['region']), sector: col(t.header, ['sector']),
      nearStatus: find((h) => /near term/.test(h) && /status/.test(h)) >= 0 ? find((h) => /near term/.test(h) && /status/.test(h)) : find((h) => /^(target )?status$/.test(h) || h === 'target status'),
      nearClass: find((h) => /near term/.test(h) && /classification/.test(h)) >= 0 ? find((h) => /near term/.test(h) && /classification/.test(h)) : find((h) => /classification/.test(h)),
      nearYear: find((h) => /near term/.test(h) && /target year/.test(h)),
      nzStatus: find((h) => /net zero/.test(h) && /(status|committed|commitment)/.test(h)), nzYear: find((h) => /net zero/.test(h) && /year/.test(h)),
      date: find((h) => /date|published/.test(h)),
    };
    if (ix.name < 0 || ix.nearStatus < 0) throw new AppError(`This does not look like the SBTi list: need a company name column and a (near-term) target status column. Columns seen: ${t.header.filter(Boolean).slice(0, 15).join(', ')}`);
    const g = (r: Cell[], i: number) => (i >= 0 ? cellText(r[i]) : '') || null;
    const yr = (s: string | null) => { const m = s && /(20\d\d)/.exec(s); return m ? Number(m[1]) : null; };
    return platformTx(async (c) => {
      await c.query(`DELETE FROM sbti_company`);
      let n = 0;
      const batch: unknown[][] = [];
      const flush = async () => {
        if (!batch.length) return;
        const vals = batch.map((_, i) => `(${Array.from({ length: 13 }, (__, j) => `$${i * 13 + j + 1}`).join(',')})`).join(',');
        await c.query(`INSERT INTO sbti_company (name, norm, isin, lei, location, region, sector, near_status, near_class, near_year, net_zero_status, net_zero_year, published) VALUES ${vals}`, batch.flat());
        batch.length = 0;
      };
      for (const r of t.rows) {
        const name = g(r, ix.name); if (!name) continue;
        const norm = normSupplier(name); if (!norm) continue;
        batch.push([name.slice(0, 300), norm, g(r, ix.isin), g(r, ix.lei), g(r, ix.location), g(r, ix.region), g(r, ix.sector), g(r, ix.nearStatus), g(r, ix.nearClass), yr(g(r, ix.nearYear)), g(r, ix.nzStatus), yr(g(r, ix.nzYear)), g(r, ix.date)]);
        n++;
        if (batch.length >= 500) await flush();
      }
      await flush();
      await c.query(`INSERT INTO sbti_import (filename, rows, imported_by) VALUES ($1,$2,$3)`, [filename, n, req.user.name]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, detail) VALUES (NULL, $1, $2, 'sbti.import', 'sbti_company', $3)`, [req.user.id, req.user.name, JSON.stringify({ filename, rows: n, read: t.rows.length })]);
      return { rows: n, columns: Object.fromEntries(Object.entries(ix).filter(([, v]) => v >= 0).map(([k, v]) => [k, t.header[v]])) };
    });
  });
}

export { countryCode };
