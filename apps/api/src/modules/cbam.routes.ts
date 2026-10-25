/**
 * CBAM (EU Carbon Border Adjustment Mechanism), both sides.
 *
 * Producer (non-EU installation operator, e.g. a UAE plant selling to the EU):
 *   GET    /api/cbam?year=                          installations, processes, reports of the year, imports summary, references
 *   POST   /api/cbam/installations                  PUT/DELETE /api/cbam/installations/:id
 *   POST   /api/cbam/installations/:id/processes    PUT/DELETE /api/cbam/processes/:id
 *   POST   /api/cbam/reports                        a reporting year for an installation (one line per process)
 *   GET    /api/cbam/reports/:id                    lines with precursors, goods and specific embedded emissions
 *   PUT    /api/cbam/reports/:id                    period, electricity factor, verification, carbon price, status
 *   PUT    /api/cbam/lines/:id                      activity level, attributed emissions, electricity, default share, parameters
 *   POST   /api/cbam/lines/:id/precursors · goods   DELETE /api/cbam/precursors/:id · /api/cbam/goods/:id
 *   GET    /api/cbam/reports/:id/export             summary emissions report (Annex IV 1.2 of IR 2025/2547), data for EU
 *                                                    importers per CN code and the O3CI entry sheet, as .xlsx
 * Importer (EU authorised CBAM declarant):
 *   GET    /api/cbam/imports?year=                  lines with embedded emissions, free allocation adjustment, certificates
 *   POST   /api/cbam/imports                        PUT/DELETE /api/cbam/imports/:id
 *   POST   /api/cbam/imports/upload?commit=0|1      lines from the customs broker's Excel / CSV
 *   GET    /api/cbam/imports/template               the upload template
 *   GET    /api/cbam/declaration?year=              the annual declaration workbook
 *   POST   /api/cbam/reference                      own default value, benchmark or price;  DELETE /api/cbam/reference/:id
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { cbamOnly } from '../lib/cbamAccess.js';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { CATEGORIES, CN, SECTORS, cbamFactor, cnInfo, countsIndirect, importCalc, lineSee, markup, quarterOf, type Sector } from '../lib/cbam.js';
import { cellText, detectKind, findHeaderRow, sheetRows, type Cell } from '../lib/sheet.js';
import { sendWorkbook, styleHeader, toIsoDate } from '../lib/xlsx.js';
import { measured } from '../lib/restate.js';
import { PRODUCT } from '../lib/brand.js';
import { airports } from '../lib/airports.js';

const EDIT = ['super_admin', 'admin', 'manager'] as const;
const uuid = z.string().uuid();
const idOf = (req: FastifyRequest) => uuid.parse((req.params as { id: string }).id);
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const cnCode = z.string().trim().transform((s) => s.replace(/\D/g, '')).refine((s) => /^[0-9]{4,8}$/.test(s), 'A CN code of 4 to 8 digits');
const country = z.string().trim().regex(/^[A-Za-z]{2}$/, 'A country').transform((s) => s.toUpperCase());
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional().transform((v) => (v === '' || v === undefined ? null : v) as z.infer<T> | null);
const n0 = z.number().finite().min(0);
const r4 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1e4) / 1e4);

// --------------------------------------------------------------- loaders --
async function report(c: Tx, id: string) {
  const r = (await c.query(`SELECT r.*, r.elec_ef::float8 AS elec_ef, i.name AS installation, i.facility_id, i.country, i.registry_id FROM cbam_report r JOIN cbam_installation i ON i.id = r.installation_id WHERE r.id = $1`, [id])).rows[0];
  if (!r) throw notFound('CBAM report');
  const lines = (await c.query(
    `SELECT l.id, l.process_id, p.name AS process, p.category, p.route, l.activity_t::float8 AS activity_t, l.direct_t::float8 AS direct_t, l.elec_mwh::float8 AS elec_mwh,
            l.default_share::float8 AS default_share, l.params
       FROM cbam_report_line l JOIN cbam_process p ON p.id = l.process_id WHERE l.report_id = $1 ORDER BY p.name`, [id])).rows;
  const ids = lines.map((l) => l.id);
  const prec = (await c.query(`SELECT id, line_id, category, cn, origin, quantity_t::float8 AS quantity_t, see_direct::float8 AS see_direct, see_indirect::float8 AS see_indirect, source, supplier, installation_ref, period
                                 FROM cbam_precursor WHERE line_id = ANY($1) ORDER BY category`, [ids])).rows;
  const goods = (await c.query(`SELECT id, line_id, cn, description, quantity_t::float8 AS quantity_t FROM cbam_good WHERE line_id = ANY($1) ORDER BY cn`, [ids])).rows;
  const out = lines.map((l) => {
    const cat = CATEGORIES[l.category]!;
    const P = prec.filter((p) => p.line_id === l.id);
    return { ...l, categoryName: cat.name, sector: cat.sector, precursors: P, goods: goods.filter((g) => g.line_id === l.id), see: lineSee(l, P, r.elec_ef, cat.sector) };
  });
  return { report: r, lines: out };
}

async function refs(c: Tx) {
  return (await c.query(`SELECT id, kind, cn, country, route, year, quarter, value::float8 AS value, source, indicative, tenant_id IS NOT NULL AS own FROM cbam_reference ORDER BY kind, year DESC, quarter, cn`)).rows as
    { id: string; kind: string; cn: string | null; country: string | null; route: string | null; year: number; quarter: number | null; value: number; source: string; indicative: boolean; own: boolean }[];
}
/** The best reference value: same kind and year (or the latest before), longest CN prefix, same country first. */
function pick(R: Awaited<ReturnType<typeof refs>>, kind: string, cn: string, ctry: string | null, year: number) {
  const c = R.filter((r) => r.kind === kind && r.cn && cn.startsWith(r.cn) && (!r.country || r.country === ctry) && r.year <= year)
    .sort((a, b) => (b.cn!.length - a.cn!.length) || (Number(!!b.country) - Number(!!a.country)) || (b.year - a.year) || (Number(b.own) - Number(a.own)));
  return c[0] ?? null;
}
const priceOf = (R: Awaited<ReturnType<typeof refs>>, year: number, q: number) => R.find((r) => r.kind === 'price' && r.year === year && r.quarter === q && r.own) ?? R.find((r) => r.kind === 'price' && r.year === year && r.quarter === q) ?? null;

async function imports(c: Tx, year: number) {
  const R = await refs(c);
  const rows = (await c.query(`SELECT *, mass::float8 AS mass, see_direct::float8 AS see_direct, see_indirect::float8 AS see_indirect, default_value::float8 AS default_value, benchmark::float8 AS benchmark,
                                      carbon_price_eur::float8 AS carbon_price_eur FROM cbam_import WHERE year = $1 ORDER BY quarter, import_date NULLS LAST, cn`, [year])).rows;
  return rows.map((x) => {
    const info = cnInfo(x.cn);
    const sector = (info?.sector ?? 'iron_steel') as Sector;
    const dv = x.default_value ?? pick(R, 'default', x.cn, x.origin, year)?.value ?? null;
    const bm = x.benchmark ?? pick(R, 'benchmark', x.cn, null, year)?.value ?? null;
    const pr = priceOf(R, year, x.quarter);
    const calc = importCalc({ year, quarter: x.quarter, mass: x.mass, sector, source: x.source, see_direct: x.see_direct, see_indirect: x.see_indirect, default_value: dv, benchmark: bm, carbon_price_eur: x.carbon_price_eur }, pr?.value ?? null);
    if (!info) calc.problems.unshift(`CN ${x.cn} is not a CBAM good (Annex I)`);
    if (!pr) calc.problems.push(`No certificate price for Q${x.quarter} ${year} yet`);
    return { ...x, sector, category: info?.category ?? null, categoryName: info ? CATEGORIES[info.category]!.name : null, defaultUsed: dv, defaultFromLibrary: x.default_value == null && dv != null, benchmarkUsed: bm, benchmarkFromLibrary: x.benchmark == null && bm != null, calc };
  });
}

const importBody = z.object({
  year: z.number().int().min(2026).max(2100), importDate: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), quarter: z.number().int().min(1).max(4).optional(),
  cn: cnCode, description: z.string().trim().max(300).default(''), origin: country, mass: z.number().finite().positive().max(1e9),
  procedure: opt(z.string().trim().max(40)), customsRef: opt(z.string().trim().max(80)), supplier: opt(z.string().trim().max(200)),
  installation: opt(z.string().trim().max(200)), installationIdReg: opt(z.string().trim().max(80)), route: opt(z.string().trim().max(120)), reportId: opt(uuid),
  source: z.enum(['actual', 'default']).default('default'), seeDirect: opt(n0), seeIndirect: opt(n0), defaultValue: opt(n0), benchmark: opt(n0), carbonPriceEur: opt(n0),
  verifierRef: opt(z.string().trim().max(200)), notes: z.string().trim().max(2000).default(''),
});
type ImportBody = z.infer<typeof importBody>;
const importCols = (b: ImportBody) => {
  const q = b.quarter ?? (b.importDate ? quarterOf(b.importDate) : null);
  if (!q) throw new AppError('Give the import date or the quarter');
  if (b.importDate && Number(b.importDate.slice(0, 4)) !== b.year) throw new AppError('The import date is not in the declaration year');
  return [b.year, b.importDate, q, b.cn, b.description, b.origin, b.mass, b.procedure, b.customsRef, b.supplier, b.installation, b.installationIdReg, b.route, b.reportId,
    b.source, b.seeDirect, b.seeIndirect, b.defaultValue, b.benchmark, b.carbonPriceEur, b.verifierRef, b.notes];
};
const IMPORT_COLS = 'year, import_date, quarter, cn, description, origin, mass, procedure, customs_ref, supplier, installation, installation_id_reg, route, report_id, source, see_direct, see_indirect, default_value, benchmark, carbon_price_eur, verifier_ref, notes';

/** Fill an import line's actual emissions from the company's own installation report (same CN code). */
async function fromOwnReport(c: Tx, b: ImportBody) {
  if (!b.reportId) return b;
  const d = await report(c, b.reportId);
  const line = d.lines.find((l) => l.goods.some((g: { cn: string }) => b.cn.startsWith(g.cn) || g.cn.startsWith(b.cn)));
  if (!line || line.see.seeDirect == null) throw new AppError(`The ${d.report.year} report of ${d.report.installation} has no good with CN ${b.cn} and an activity level`);
  return { ...b, source: 'actual' as const, seeDirect: r4(line.see.seeDirect), seeIndirect: r4(line.see.seeIndirect), installation: b.installation ?? d.report.installation, installationIdReg: b.installationIdReg ?? d.report.registry_id,
    route: b.route ?? line.route, verifierRef: b.verifierRef ?? (d.report.verifier_name ? `${d.report.verifier_name}${d.report.verification_date ? `, ${String(d.report.verification_date).slice(0, 10)}` : ''}` : null) };
}

export async function cbamRoutes(app: FastifyInstance) {
  cbamOnly(app);
  app.get('/api/cbam', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2023).max(2100).optional() }).parse(req.query);
    const year = q.year ?? new Date().getUTCFullYear();
    return tenantTx(tenant, async (c) => {
      const inst = (await c.query(`SELECT i.*, f.name AS facility FROM cbam_installation i LEFT JOIN org_node f ON f.id = i.facility_id ORDER BY i.name`)).rows;
      const procs = (await c.query(`SELECT * FROM cbam_process ORDER BY name`)).rows;
      const reps = (await c.query(`SELECT r.id, r.installation_id, r.year, r.status, r.verifier_name, r.verification_date, r.updated_at FROM cbam_report r ORDER BY r.year DESC`)).rows;
      const thisYear = [];
      for (const r of reps.filter((x) => x.year === year)) {
        const d = await report(c, r.id);
        thisYear.push({ ...r, lines: d.lines.map((l) => ({ id: l.id, process: l.process, category: l.category, categoryName: l.categoryName, route: l.route, activity_t: l.activity_t, goods: l.goods.map((g: { cn: string }) => g.cn), see: l.see })) });
      }
      const imp = await imports(c, year);
      const sum = (f: (x: typeof imp[number]) => number | null | undefined) => imp.reduce((a, x) => a + (f(x) ?? 0), 0);
      const facilities = (await c.query(`SELECT id, name, country FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows;
      return {
        year, installations: inst.map((i) => ({ ...i, processes: procs.filter((p) => p.installation_id === i.id), reports: reps.filter((r) => r.installation_id === i.id) })),
        reports: thisYear, facilities,
        imports: { lines: imp.length, mass: sum((x) => x.mass), embedded: sum((x) => x.calc.embedded), certificates: sum((x) => x.calc.certificates), cost: sum((x) => x.calc.cost), problems: imp.filter((x) => x.calc.problems.length).length },
        categories: CATEGORIES, sectors: SECTORS, cn: CN, references: await refs(c), cbamFactor: cbamFactor(year), markup: { other: markup(year, 'iron_steel'), fertilisers: markup(year, 'fertilisers') },
        can: { edit: canEdit(req) },
      };
    });
  });

  // ---------------------------------------------------------- installations --
  const instBody = z.object({
    name: z.string().trim().min(2).max(200), facilityId: opt(uuid), registryId: opt(z.string().trim().max(80)), unlocode: opt(z.string().trim().max(10)),
    address: opt(z.string().trim().max(300)), city: opt(z.string().trim().max(120)), postcode: opt(z.string().trim().max(20)), country,
    lat: opt(z.number().min(-90).max(90)), lon: opt(z.number().min(-180).max(180)),
    operatorName: opt(z.string().trim().max(200)), operatorReg: opt(z.string().trim().max(80)), operatorAddress: opt(z.string().trim().max(300)), operatorCountry: opt(country),
    contactName: opt(z.string().trim().max(120)), contactEmail: opt(z.string().trim().email().max(200)), contactPhone: opt(z.string().trim().max(40)), notes: z.string().trim().max(2000).default(''),
  });
  const instCols = (b: z.infer<typeof instBody>) => [b.name, b.facilityId, b.registryId, b.unlocode, b.address, b.city, b.postcode, b.country, b.lat, b.lon, b.operatorName, b.operatorReg, b.operatorAddress, b.operatorCountry, b.contactName, b.contactEmail, b.contactPhone, b.notes];
  app.post('/api/cbam/installations', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = instBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO cbam_installation (tenant_id, name, facility_id, registry_id, unlocode, address, city, postcode, country, lat, lon, operator_name, operator_reg, operator_address, operator_country, contact_name, contact_email, contact_phone, notes, created_name)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`, [tenant, ...instCols(b), req.user.name])).rows[0];
      await audit(c, req, 'cbam.installation.create', 'cbam_installation', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/cbam/installations/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req), b = instBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE cbam_installation SET name=$2, facility_id=$3, registry_id=$4, unlocode=$5, address=$6, city=$7, postcode=$8, country=$9, lat=$10, lon=$11, operator_name=$12, operator_reg=$13, operator_address=$14,
                                 operator_country=$15, contact_name=$16, contact_email=$17, contact_phone=$18, notes=$19, updated_at=now() WHERE id = $1`, [id, ...instCols(b)]);
      if (!r.rowCount) throw notFound('Installation');
      await audit(c, req, 'cbam.installation.update', 'cbam_installation', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/cbam/installations/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      if ((await c.query(`SELECT 1 FROM cbam_report WHERE installation_id = $1 AND status <> 'draft'`, [id])).rowCount) throw new AppError('This installation has verified reports: they stay on record', 409, 'IN_USE');
      const r = await c.query(`DELETE FROM cbam_installation WHERE id = $1 RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Installation');
      await audit(c, req, 'cbam.installation.delete', 'cbam_installation', id, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  const procBody = z.object({ category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]), route: z.string().trim().max(120).default(''), name: z.string().trim().min(2).max(200) })
    .refine((b) => !CATEGORIES[b.category]!.routes.length || CATEGORIES[b.category]!.routes.includes(b.route), 'Choose the production route');
  app.post('/api/cbam/installations/:id/processes', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req), b = procBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query(`SELECT 1 FROM cbam_installation WHERE id = $1`, [id])).rowCount) throw notFound('Installation');
      const r = (await c.query(`INSERT INTO cbam_process (tenant_id, installation_id, category, route, name) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tenant, id, b.category, b.route, b.name])).rows[0];
      // open reports of the installation get a line for the new process
      await c.query(`INSERT INTO cbam_report_line (tenant_id, report_id, process_id) SELECT $1, id, $2 FROM cbam_report WHERE installation_id = $3 AND status = 'draft'`, [tenant, r.id, id]);
      await audit(c, req, 'cbam.process.create', 'cbam_installation', id, b);
      return { id: r.id };
    });
  });
  app.put('/api/cbam/processes/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req), b = procBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE cbam_process SET category=$2, route=$3, name=$4 WHERE id = $1 RETURNING installation_id`, [id, b.category, b.route, b.name]);
      if (!r.rowCount) throw notFound('Process');
      await audit(c, req, 'cbam.process.update', 'cbam_installation', r.rows[0].installation_id, { process: id, ...b });
      return { ok: true };
    });
  });
  app.delete('/api/cbam/processes/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      if ((await c.query(`SELECT 1 FROM cbam_report_line l JOIN cbam_report r ON r.id = l.report_id WHERE l.process_id = $1 AND r.status <> 'draft'`, [id])).rowCount) throw new AppError('Used in a verified report', 409, 'IN_USE');
      const r = await c.query(`DELETE FROM cbam_process WHERE id = $1 RETURNING installation_id, name`, [id]);
      if (!r.rowCount) throw notFound('Process');
      await audit(c, req, 'cbam.process.delete', 'cbam_installation', r.rows[0].installation_id, { process: id, name: r.rows[0].name });
      return { ok: true };
    });
  });

  // ---------------------------------------------------------------- reports --
  app.post('/api/cbam/reports', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = z.object({ installationId: uuid, year: z.number().int().min(2023).max(2100) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query(`SELECT 1 FROM cbam_installation WHERE id = $1`, [b.installationId])).rowCount) throw notFound('Installation');
      if ((await c.query(`SELECT 1 FROM cbam_report WHERE installation_id = $1 AND year = $2`, [b.installationId, b.year])).rowCount) throw new AppError(`There is already a ${b.year} report for this installation`, 409);
      const prev = (await c.query(`SELECT elec_ef, elec_ef_source, monitoring_plan FROM cbam_report WHERE installation_id = $1 ORDER BY year DESC LIMIT 1`, [b.installationId])).rows[0];
      const r = (await c.query(`INSERT INTO cbam_report (tenant_id, installation_id, year, period_start, period_end, elec_ef, elec_ef_source, monitoring_plan, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, b.installationId, b.year, `${b.year}-01-01`, `${b.year}-12-31`, prev?.elec_ef ?? null, prev?.elec_ef_source ?? null, prev?.monitoring_plan ?? null, req.user.name])).rows[0];
      await c.query(`INSERT INTO cbam_report_line (tenant_id, report_id, process_id) SELECT $1, $2, id FROM cbam_process WHERE installation_id = $3`, [tenant, r.id, b.installationId]);
      // goods of last year carried over (CN codes only)
      await c.query(`INSERT INTO cbam_good (tenant_id, line_id, cn, description)
                     SELECT $1, nl.id, g.cn, g.description FROM cbam_good g JOIN cbam_report_line ol ON ol.id = g.line_id JOIN cbam_report o ON o.id = ol.report_id
                       JOIN cbam_report_line nl ON nl.process_id = ol.process_id AND nl.report_id = $2
                      WHERE o.installation_id = $3 AND o.year = $4 - 1`, [tenant, r.id, b.installationId, b.year]);
      await audit(c, req, 'cbam.report.create', 'cbam_report', r.id, b);
      return { id: r.id };
    });
  });

  app.get('/api/cbam/reports/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const d = await report(c, id);
      // the installation's facility: Scope 1 and 2 of the year in the inventory, to check the attributed emissions against
      const inv = d.report.facility_id ? await measured(c, tenant, d.report.year, [d.report.facility_id]) : null;
      return { ...d, inventory: inv, can: { edit: canEdit(req) && d.report.status === 'draft', reopen: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role) && d.report.status !== 'draft' } };
    });
  });

  const reportBody = z.object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    elecEf: opt(n0.max(5)), elecEfSource: opt(z.string().trim().max(300)), monitoringPlan: opt(z.string().trim().max(300)),
    verifierName: opt(z.string().trim().max(200)), verifierAccreditation: opt(z.string().trim().max(120)), verifierCountry: opt(country),
    verificationDate: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), siteVisitDate: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), opinion: opt(z.string().trim().max(2000)),
    carbonPrice: z.object({ instrument: z.string().trim().max(200), country: z.string().trim().max(2), eurPerT: n0.nullable(), amount: n0.nullable(), currency: z.string().trim().max(3), rebate: z.string().trim().max(500), evidence: z.string().trim().max(500) }).nullable().optional(),
    notes: z.string().trim().max(4000).default(''), sharedWith: z.string().trim().max(1000).default(''),
    status: z.enum(['draft', 'verified', 'shared']).default('draft'),
  });
  app.put('/api/cbam/reports/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req), b = reportBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const d = await report(c, id);
      const was = d.report.status;
      if (was !== 'draft' && b.status === 'draft' && !['super_admin', 'admin', 'platform_admin'].includes(req.user.role)) throw new AppError('A super admin or admin reopens a verified report', 403);
      if (was !== 'draft' && b.status !== 'draft' && was === b.status) {
        // after verification only the disclosure fields change
        await c.query(`UPDATE cbam_report SET shared_with = $2, notes = $3, updated_name = $4, updated_at = now() WHERE id = $1`, [id, b.sharedWith, b.notes, req.user.name]);
        return { ok: true };
      }
      if (b.status !== 'draft') {
        const miss = [!b.verifierName && 'verifier', !b.verificationDate && 'verification date', !b.opinion && 'verification opinion',
          d.lines.some((l) => !l.activity_t) && 'activity level of every process', d.lines.some((l) => !l.goods.length) && 'goods (CN codes) of every process',
          d.lines.some((l) => countsIndirect(l.sector) && l.elec_mwh && b.elecEf == null) && 'electricity emission factor'].filter(Boolean);
        if (miss.length) throw new AppError(`Before marking it verified, complete: ${miss.join(', ')}`);
        if (b.periodEnd < b.periodStart) throw new AppError('The period ends before it starts');
      }
      await c.query(`UPDATE cbam_report SET period_start=$2, period_end=$3, elec_ef=$4, elec_ef_source=$5, monitoring_plan=$6, verifier_name=$7, verifier_accreditation=$8, verifier_country=$9, verification_date=$10,
                       site_visit_date=$11, opinion=$12, carbon_price=$13, notes=$14, shared_with=$15, status=$16, updated_name=$17, updated_at=now() WHERE id = $1`,
        [id, b.periodStart, b.periodEnd, b.elecEf, b.elecEfSource, b.monitoringPlan, b.verifierName, b.verifierAccreditation, b.verifierCountry, b.verificationDate, b.siteVisitDate, b.opinion,
          b.carbonPrice ? JSON.stringify(b.carbonPrice) : null, b.notes, b.sharedWith, b.status, req.user.name]);
      await audit(c, req, `cbam.report.${b.status === was ? 'update' : b.status}`, 'cbam_report', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/cbam/reports/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM cbam_report WHERE id = $1 AND status = 'draft' RETURNING year`, [id]);
      if (!r.rowCount) throw new AppError('Only a draft report can be removed', 409);
      await audit(c, req, 'cbam.report.delete', 'cbam_report', id, { year: r.rows[0].year });
      return { ok: true };
    });
  });

  const draftLine = async (c: Tx, lineId: string) => {
    const l = (await c.query(`SELECT l.report_id, r.status, p.category FROM cbam_report_line l JOIN cbam_report r ON r.id = l.report_id JOIN cbam_process p ON p.id = l.process_id WHERE l.id = $1`, [lineId])).rows[0];
    if (!l) throw notFound('Process line');
    if (l.status !== 'draft') throw new AppError('The report is verified: reopen it to change figures', 409);
    return l as { report_id: string; status: string; category: string };
  };
  app.put('/api/cbam/lines/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ activityT: opt(n0), directT: opt(n0), elecMwh: opt(n0), defaultShare: z.number().min(0).max(1).default(0), params: z.record(z.string().max(40), z.string().max(120)).default({}) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const l = await draftLine(c, id);
      await c.query(`UPDATE cbam_report_line SET activity_t=$2, direct_t=$3, elec_mwh=$4, default_share=$5, params=$6 WHERE id = $1`, [id, b.activityT, b.directT, b.elecMwh, b.defaultShare, JSON.stringify(b.params)]);
      await c.query(`UPDATE cbam_report SET updated_name = $2, updated_at = now() WHERE id = $1`, [l.report_id, req.user.name]);
      await audit(c, req, 'cbam.line.update', 'cbam_report', l.report_id, { line: id, ...b });
      return { ok: true };
    });
  });
  app.post('/api/cbam/lines/:id/precursors', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]]), cn: opt(cnCode), origin: opt(country), quantityT: n0, seeDirect: n0, seeIndirect: n0.default(0),
      source: z.enum(['actual', 'default']).default('actual'), supplier: opt(z.string().trim().max(200)), installationRef: opt(z.string().trim().max(120)), period: opt(z.string().trim().max(40)) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const l = await draftLine(c, id);
      const r = (await c.query(`INSERT INTO cbam_precursor (tenant_id, line_id, category, cn, origin, quantity_t, see_direct, see_indirect, source, supplier, installation_ref, period) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tenant, id, b.category, b.cn, b.origin, b.quantityT, b.seeDirect, b.seeIndirect, b.source, b.supplier, b.installationRef, b.period])).rows[0];
      await audit(c, req, 'cbam.precursor.create', 'cbam_report', l.report_id, b);
      return { id: r.id };
    });
  });
  app.delete('/api/cbam/precursors/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const p = (await c.query(`SELECT line_id FROM cbam_precursor WHERE id = $1`, [id])).rows[0];
      if (!p) throw notFound('Precursor');
      const l = await draftLine(c, p.line_id);
      await c.query(`DELETE FROM cbam_precursor WHERE id = $1`, [id]);
      await audit(c, req, 'cbam.precursor.delete', 'cbam_report', l.report_id, { precursor: id });
      return { ok: true };
    });
  });
  app.post('/api/cbam/lines/:id/goods', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    const b = z.object({ cn: cnCode, description: z.string().trim().max(300).default(''), quantityT: opt(n0) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const l = await draftLine(c, id);
      const info = cnInfo(b.cn);
      if (!info) throw new AppError(`CN ${b.cn} is not a CBAM good (Annex I of Regulation 2023/956)`);
      if (CATEGORIES[info.category]!.sector !== CATEGORIES[l.category]!.sector) throw new AppError(`CN ${b.cn} is ${SECTORS[info.sector].toLowerCase()}, not ${SECTORS[CATEGORIES[l.category]!.sector].toLowerCase()}`);
      const r = (await c.query(`INSERT INTO cbam_good (tenant_id, line_id, cn, description, quantity_t) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tenant, id, b.cn, b.description || info.description, b.quantityT])).rows[0];
      await audit(c, req, 'cbam.good.create', 'cbam_report', l.report_id, b);
      return { id: r.id };
    });
  });
  app.delete('/api/cbam/goods/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const g = (await c.query(`SELECT line_id FROM cbam_good WHERE id = $1`, [id])).rows[0];
      if (!g) throw notFound('Good');
      const l = await draftLine(c, g.line_id);
      await c.query(`DELETE FROM cbam_good WHERE id = $1`, [id]);
      await audit(c, req, 'cbam.good.delete', 'cbam_report', l.report_id, { good: id });
      return { ok: true };
    });
  });

  // ------------------------------------------------------- producer export --
  app.get('/api/cbam/reports/:id/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const { wb, name } = await tenantTx(tenant, async (c) => {
      const d = await report(c, id);
      const R = d.report;
      const inst = (await c.query(`SELECT * FROM cbam_installation WHERE id = $1`, [R.installation_id])).rows[0];
      const wb = new ExcelJS.Workbook();
      wb.creator = PRODUCT;
      const head = (ws: ExcelJS.Worksheet, title: string, sub: string) => {
        ws.addRow([title]).font = { bold: true, size: 14 };
        ws.addRow([sub]).font = { italic: true, color: { argb: 'FF6B7C78' } };
        ws.addRow([]);
      };
      const sec = (ws: ExcelJS.Worksheet, t: string) => { const r = ws.addRow([t]); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C66' } }; };
      const kv = (ws: ExcelJS.Worksheet, k: string, v: unknown) => { const r = ws.addRow([k, v ?? '']); r.getCell(1).font = { color: { argb: 'FF4B5B57' } }; };
      const d2 = (x: unknown) => (x ? String(x instanceof Date ? x.toISOString() : x).slice(0, 10) : '');
      const status = R.status === 'draft' ? 'DRAFT — not verified' : `Verified ${d2(R.verification_date)}`;

      // 1 · Summary emissions report (Annex IV point 1.2 of IR (EU) 2025/2547)
      const s = wb.addWorksheet('Summary emissions report');
      s.columns = [{ width: 46 }, { width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 22 }];
      head(s, `CBAM summary emissions report — ${R.installation} — ${R.year}`, `Reporting period ${d2(R.period_start)} to ${d2(R.period_end)} · ${status} · prepared with ${PRODUCT}. In English, as required (IR (EU) 2025/2547).`);
      sec(s, '1. Operator');
      kv(s, 'Name', inst.operator_name); kv(s, 'Registration number', inst.operator_reg); kv(s, 'Address', inst.operator_address); kv(s, 'Country', inst.operator_country ?? inst.country);
      kv(s, 'Contact', [inst.contact_name, inst.contact_email, inst.contact_phone].filter(Boolean).join(' · '));
      sec(s, '2. Installation');
      kv(s, 'Name', inst.name); kv(s, 'CBAM Registry identifier', inst.registry_id); kv(s, 'UN/LOCODE', inst.unlocode);
      kv(s, 'Address', [inst.address, inst.postcode, inst.city, inst.country].filter(Boolean).join(', '));
      kv(s, 'Coordinates of the main emission source', inst.lat != null ? `${Number(inst.lat).toFixed(6)}, ${Number(inst.lon).toFixed(6)}` : '');
      sec(s, '3. Production processes and routes');
      s.addRow(['Process', 'Aggregated goods category', 'Route', 'Activity level (t)', 'Goods (CN)']).font = { bold: true };
      for (const l of d.lines) s.addRow([l.process, l.categoryName, l.route || '—', l.activity_t, l.goods.map((g: { cn: string }) => g.cn).join(', ')]);
      sec(s, '4. Specific embedded emissions of each good (tCO2e per tonne)');
      s.addRow(['CN code', 'Good', 'Direct SEE', 'Indirect SEE', 'Indirect counted', 'SEE (CBAM)', 'Share on default values', 'Process']).font = { bold: true };
      for (const l of d.lines) for (const g of l.goods) s.addRow([g.cn, g.description, r4(l.see.seeDirect), r4(l.see.seeIndirect), l.see.counted ? 'yes (cement, fertilisers)' : 'no (Annex II good)', r4(l.see.seeTotal), `${Math.round(l.see.defaultShare * 100)}%`, l.process]);
      sec(s, '5. Direct emissions');
      s.addRow(['Process', 'Attributed direct emissions (tCO2e)', 'Of which from precursors', 'Total direct']).font = { bold: true };
      for (const l of d.lines) s.addRow([l.process, l.direct_t, r4(l.see.directTotal - Number(l.direct_t ?? 0)), r4(l.see.directTotal)]);
      s.addRow(['Installation total (attributed)', d.lines.reduce((a, l) => a + Number(l.direct_t ?? 0), 0)]).font = { bold: true };
      sec(s, '6. Indirect emissions');
      kv(s, 'Electricity emission factor (tCO2/MWh)', R.elec_ef); kv(s, 'Source of the factor', R.elec_ef_source);
      s.addRow(['Process', 'Electricity consumed (MWh)', 'Indirect emissions (tCO2e)']).font = { bold: true };
      for (const l of d.lines) s.addRow([l.process, l.elec_mwh, r4(Number(l.elec_mwh ?? 0) * Number(R.elec_ef ?? 0))]);
      sec(s, '7–11. Heat flows, zero-rated fuels, waste gases, CO2 capture, on-site electricity');
      kv(s, 'As described in the notes', R.notes || '—');
      sec(s, '12–16. Precursors');
      s.addRow(['Process', 'Precursor', 'CN', 'Origin', 'Quantity (t)', 'SEE direct', 'SEE indirect', 'Values']).font = { bold: true };
      for (const l of d.lines) for (const p of l.precursors) s.addRow([l.process, CATEGORIES[p.category]?.name ?? p.category, p.cn, p.origin, p.quantity_t, p.see_direct, p.see_indirect, `${p.source}${p.supplier ? ` · ${p.supplier}` : ''}${p.installation_ref ? ` · ${p.installation_ref}` : ''}`]);
      sec(s, 'Qualifying parameters');
      for (const l of d.lines) for (const [k, v] of Object.entries(l.params ?? {})) if (v) kv(s, `${l.process} · ${CATEGORIES[l.category]!.params.find((p) => p.key === k)?.label ?? k}`, v);
      sec(s, 'Carbon price paid (Article 9)');
      const cp = R.carbon_price as Record<string, unknown> | null;
      if (cp && (cp.instrument || cp.eurPerT)) { kv(s, 'Instrument', cp.instrument); kv(s, 'Country', cp.country); kv(s, 'EUR per tonne CO2e', cp.eurPerT); kv(s, 'Amount paid', `${cp.amount ?? ''} ${cp.currency ?? ''}`); kv(s, 'Rebates or compensation', cp.rebate); kv(s, 'Evidence', cp.evidence); }
      else kv(s, 'Carbon price effectively paid', 'None');
      sec(s, 'Verification');
      kv(s, 'Monitoring plan', R.monitoring_plan); kv(s, 'Accredited verifier', R.verifier_name); kv(s, 'Accreditation', R.verifier_accreditation); kv(s, 'Verifier country', R.verifier_country);
      kv(s, 'Site visit', d2(R.site_visit_date)); kv(s, 'Verification date', d2(R.verification_date)); kv(s, 'Opinion', R.opinion);

      // 2 · For EU importers: one row per good
      const im = wb.addWorksheet('For EU importers');
      im.addRow(['Installation', 'CBAM Registry identifier', 'Country', 'Reporting period', 'CN code', 'Good', 'Aggregated goods category', 'Production route', 'Direct SEE (tCO2e/t)', 'Indirect SEE (tCO2e/t)', 'SEE for CBAM (tCO2e/t)', 'Share on default values', 'Carbon price paid (EUR/tCO2e)', 'Verifier', 'Verification date', 'Status']);
      styleHeader(im, [28, 20, 9, 22, 11, 34, 24, 24, 14, 14, 14, 12, 14, 26, 14, 18]);
      for (const l of d.lines) for (const g of l.goods)
        im.addRow([R.installation, inst.registry_id ?? '', inst.country, `${d2(R.period_start)} to ${d2(R.period_end)}`, g.cn, g.description, l.categoryName, l.route || '', r4(l.see.seeDirect), r4(l.see.seeIndirect), r4(l.see.seeTotal), r4(l.see.defaultShare), cp?.eurPerT ?? '', R.verifier_name ?? '', d2(R.verification_date), status]);

      // 3 · O3CI entry: the values in the order the CBAM Registry operator portal asks for them
      const o = wb.addWorksheet('O3CI entry');
      o.columns = [{ width: 16 }, { width: 44 }, { width: 50 }];
      head(o, 'CBAM Registry — O3CI portal: what to enter', 'Copy each value into the portal screen named in the first column. The portal is filled in on screen; this sheet keeps the values together.');
      o.addRow(['Screen', 'Field', 'Value']).font = { bold: true };
      const e = (sc: string, f: string, v: unknown) => o.addRow([sc, f, v ?? '']);
      e('Operator', 'Operator name', inst.operator_name); e('Operator', 'Registration / identification number', inst.operator_reg); e('Operator', 'Address', inst.operator_address); e('Operator', 'Country', inst.operator_country ?? inst.country);
      e('Operator', 'Contact person', inst.contact_name); e('Operator', 'E-mail', inst.contact_email); e('Operator', 'Phone', inst.contact_phone);
      e('Installation', 'Installation name', inst.name); e('Installation', 'Address', inst.address); e('Installation', 'City', inst.city); e('Installation', 'Post code', inst.postcode); e('Installation', 'Country', inst.country);
      e('Installation', 'UN/LOCODE', inst.unlocode); e('Installation', 'Latitude', inst.lat != null ? Number(inst.lat).toFixed(6) : ''); e('Installation', 'Longitude', inst.lon != null ? Number(inst.lon).toFixed(6) : '');
      for (const l of d.lines) {
        e('Production process', 'Aggregated goods category', l.categoryName); e('Production process', 'Production route', l.route || '—');
        for (const g of l.goods) {
          e('Emissions', `CN ${g.cn} — reporting period`, `${d2(R.period_start)} to ${d2(R.period_end)}`);
          e('Emissions', `CN ${g.cn} — specific direct embedded emissions (tCO2e/t)`, r4(l.see.seeDirect));
          e('Emissions', `CN ${g.cn} — specific indirect embedded emissions (tCO2e/t)`, r4(l.see.seeIndirect));
          e('Emissions', `CN ${g.cn} — share of default values`, `${Math.round(l.see.defaultShare * 100)}%`);
          for (const [k, v] of Object.entries(l.params ?? {})) if (v) e('Emissions', `CN ${g.cn} — ${CATEGORIES[l.category]!.params.find((p) => p.key === k)?.label ?? k}`, v);
        }
      }
      e('Verification', 'Verifier', R.verifier_name); e('Verification', 'Verification date', d2(R.verification_date));
      e('Disclosure', 'Share with (EORI numbers of EU importers)', R.shared_with);
      return { wb, name: `CBAM ${R.installation} ${R.year}`.replace(/[^\w\- ]/g, '') };
    });
    await tenantTx(tenant, (c) => audit(c, req, 'cbam.report.export', 'cbam_report', id, {}));
    return sendWorkbook(reply, wb, `${name}.xlsx`);
  });

  // ---------------------------------------------------------------- imports --
  app.get('/api/cbam/imports', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2026).max(2100).default(new Date().getUTCFullYear()) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const L = await imports(c, q.year);
      const ownReports = (await c.query(`SELECT r.id, r.year, r.status, i.name AS installation FROM cbam_report r JOIN cbam_installation i ON i.id = r.installation_id ORDER BY r.year DESC, i.name`)).rows;
      const R = await refs(c);
      return { year: q.year, lines: L, ownReports, prices: [1, 2, 3, 4].map((qq) => ({ quarter: qq, price: priceOf(R, q.year, qq)?.value ?? null })), cbamFactor: cbamFactor(q.year), can: { edit: canEdit(req) } };
    });
  });
  app.post('/api/cbam/imports', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b0 = importBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const b = await fromOwnReport(c, b0);
      const r = (await c.query(`INSERT INTO cbam_import (tenant_id, ${IMPORT_COLS}, created_name) VALUES ($1,${Array.from({ length: 22 }, (_, i) => `$${i + 2}`).join(',')},$24) RETURNING id`, [tenant, ...importCols(b), req.user.name])).rows[0];
      await audit(c, req, 'cbam.import.create', 'cbam_import', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/cbam/imports/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req), b0 = importBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const b = await fromOwnReport(c, b0);
      const cols = IMPORT_COLS.split(', ');
      const r = await c.query(`UPDATE cbam_import SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...importCols(b)]);
      if (!r.rowCount) throw notFound('Import line');
      await audit(c, req, 'cbam.import.update', 'cbam_import', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/cbam/imports/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM cbam_import WHERE id = $1 RETURNING cn, mass`, [id]);
      if (!r.rowCount) throw notFound('Import line');
      await audit(c, req, 'cbam.import.delete', 'cbam_import', id, r.rows[0]);
      return { ok: true };
    });
  });

  const TEMPLATE = ['Import date *', 'CN code *', 'Description', 'Country of origin *', 'Net mass (t) *', 'Customs procedure', 'Customs declaration no.', 'Supplier', 'Installation', 'Installation CBAM Registry ID',
    'Production route', 'Emissions (actual/default)', 'Direct SEE (tCO2e/t)', 'Indirect SEE (tCO2e/t)', 'Carbon price paid (EUR/t)', 'Verification report'];
  app.get('/api/cbam/imports/template', async (req, reply) => {
    requireTenant(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Imports');
    ws.addRow(TEMPLATE);
    styleHeader(ws, [14, 12, 30, 16, 14, 14, 20, 26, 26, 22, 22, 18, 16, 16, 16, 24]);
    ws.addRow(['2026-03-14', '72071114', 'Billets of non-alloy steel', 'TR', 1200, '40', '26DE…', 'Example Steel (not real)', 'Example mill', '', 'Basic oxygen steelmaking', 'default', '', '', '', '']).font = { italic: true, color: { argb: 'FF6B7C78' } };
    const how = wb.addWorksheet('How to fill');
    how.columns = [{ width: 30 }, { width: 100 }];
    for (const r of [
      ['One row per customs declaration line', 'The grey row is an example: delete it. Columns are recognised by their names; the order does not matter.'],
      ['CN code', '8 digits as on the customs declaration (spaces allowed). Only CBAM goods are accepted (Annex I: cement, fertilisers, iron and steel, aluminium, hydrogen, electricity).'],
      ['Country of origin', 'Two-letter code (TR, IN, AE…) or the country name.'],
      ['Net mass', 'Tonnes (MWh for electricity).'],
      ['Emissions', '"actual" when the installation gave you verified data (fill the SEE columns), otherwise "default": the default value for the CN code and country is used with the mark-up of the year.'],
    ]) how.addRow(r);
    return sendWorkbook(reply, wb, 'CBAM imports template.xlsx');
  });

  app.post('/api/cbam/imports/upload', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const q = z.object({ commit: z.coerce.number().int().min(0).max(1).default(0), year: z.coerce.number().int().min(2026).max(2100) }).parse(req.query);
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'imports.xlsx'));
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('Send the file');
    const kind = detectKind(req.body, filename);
    if (kind !== 'xlsx' && kind !== 'csv') throw new AppError('Send an Excel (.xlsx) or CSV file');
    const all: Cell[][] = [];
    for await (const r of sheetRows(req.body, kind)) { all.push(r); if (all.length > 20000) throw new AppError('At most 20,000 rows per file'); }
    const h = findHeaderRow(all);
    const low = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const header = (all[h] ?? []).map((c) => low(cellText(c)));
    const col = (...names: string[]) => header.findIndex((x) => names.some((n) => x === n || x.startsWith(n)));
    const C = {
      date: col('import date', 'date'), cn: col('cn code', 'cn', 'commodity code', 'tariff code', 'hs code'), desc: col('description', 'goods description'), origin: col('country of origin', 'origin'),
      mass: col('net mass', 'mass', 'quantity', 'net weight'), proc: col('customs procedure', 'procedure'), ref: col('customs declaration', 'declaration', 'mrn'), supplier: col('supplier', 'exporter', 'consignor'),
      inst: col('installation cbam registry', 'installation id'), instName: col('installation'), route: col('production route', 'route'), src: col('emissions', 'source'),
      dir: col('direct see', 'direct'), ind: col('indirect see', 'indirect'), cp: col('carbon price'), ver: col('verification report', 'verifier'),
    };
    if (C.cn < 0 || C.mass < 0 || C.origin < 0) throw new AppError(`CN code, country of origin and net mass columns are needed. Columns seen: ${(all[h] ?? []).map((c) => cellText(c)).filter(Boolean).slice(0, 12).join(', ')}`);
    const names = [...airports().countries.entries()];
    const toCountry = (s: string) => { const x = s.trim(); if (/^[A-Za-z]{2}$/.test(x)) return x.toUpperCase(); return names.find(([, n]) => n.toLowerCase() === x.toLowerCase())?.[0] ?? x; };
    const num = (s: string) => { const x = Number(s.replace(/[\s,]/g, '')); return s.trim() === '' || !Number.isFinite(x) ? null : x; };
    const out: { row: number; cn: string; origin: string; mass: number | null; ok: boolean; problems: string[] }[] = [];
    const good: ImportBody[] = [];
    for (const [i, r] of all.slice(h + 1).entries()) {
      const g = (k: number) => (k >= 0 ? cellText(r[k] ?? null) : '');
      if (!g(C.cn) && !g(C.mass)) continue;
      const date = C.date >= 0 ? toIsoDate(g(C.date)) : null;
      const src = /actual|real|verified/i.test(g(C.src)) ? 'actual' : 'default';
      const parsed = importBody.safeParse({
        year: q.year, importDate: date, quarter: date ? undefined : 1, cn: g(C.cn), description: g(C.desc), origin: toCountry(g(C.origin)), mass: num(g(C.mass)),
        procedure: g(C.proc) || null, customsRef: g(C.ref) || null, supplier: g(C.supplier) || null, installation: g(C.instName) || null, installationIdReg: g(C.inst) || null, route: g(C.route) || null,
        source: src, seeDirect: num(g(C.dir)), seeIndirect: num(g(C.ind)), carbonPriceEur: num(g(C.cp)), verifierRef: g(C.ver) || null,
      });
      const problems: string[] = [];
      if (!parsed.success) problems.push(...parsed.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`));
      else {
        if (!cnInfo(parsed.data.cn)) problems.push(`CN ${parsed.data.cn} is not a CBAM good`);
        if (date && Number(date.slice(0, 4)) !== q.year) problems.push(`Date ${date} is not in ${q.year}`);
        if (!date) problems.push('No import date: put in Q1, change it if needed');
        if (src === 'actual' && parsed.data.seeDirect == null) problems.push('"actual" without the direct SEE');
      }
      const fatal = !parsed.success || problems.some((p) => /not a CBAM|not in|without/.test(p));
      out.push({ row: h + i + 2, cn: g(C.cn), origin: g(C.origin), mass: num(g(C.mass)), ok: !fatal, problems });
      if (!fatal && parsed.success) good.push(parsed.data);
    }
    if (!q.commit) return { lines: out.slice(0, 500), ok: good.length, problems: out.filter((x) => !x.ok).length };
    return tenantTx(tenant, async (c) => {
      for (const b of good) await c.query(`INSERT INTO cbam_import (tenant_id, ${IMPORT_COLS}, created_name) VALUES ($1,${Array.from({ length: 22 }, (_, i) => `$${i + 2}`).join(',')},$24)`, [tenant, ...importCols(b), req.user.name]);
      await audit(c, req, 'cbam.import.upload', 'cbam_import', null, { file: filename, imported: good.length, skipped: out.length - good.length });
      return { imported: good.length, skipped: out.length - good.length };
    });
  });

  // ----------------------------------------------------- declaration export --
  app.get('/api/cbam/declaration', async (req, reply) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2026).max(2100) }).parse(req.query);
    const wb = await tenantTx(tenant, async (c) => {
      const L = await imports(c, q.year);
      const co = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const wb = new ExcelJS.Workbook();
      wb.creator = PRODUCT;
      const t = (x: number | null) => (x == null ? '' : Math.round(x * 1000) / 1000);
      // summary
      const s = wb.addWorksheet('Declaration summary');
      s.columns = [{ width: 52 }, { width: 22 }];
      s.addRow([`CBAM annual declaration ${q.year} — ${co.name}`]).font = { bold: true, size: 14 };
      s.addRow([`Prepared with ${PRODUCT}. Figures to enter in the CBAM Registry (declarant portal) by 30 September ${q.year + 1}. Check every value before filing.`]).font = { italic: true, color: { argb: 'FF6B7C78' } };
      s.addRow([]);
      const tot = (f: (x: typeof L[number]) => number | null | undefined) => L.reduce((a, x) => a + (f(x) ?? 0), 0);
      for (const [k, v] of [
        ['Import lines', L.length], ['Total net mass imported (t; MWh for electricity)', t(tot((x) => x.mass))],
        ['Total embedded emissions (tCO2e)', t(tot((x) => x.calc.embedded))], ['Free allocation adjustment (tCO2e)', t(tot((x) => x.calc.faa))],
        [`CBAM factor ${q.year}`, cbamFactor(q.year)], ['Certificates to surrender', t(tot((x) => x.calc.certificates))], ['Estimated cost (EUR)', Math.round(tot((x) => x.calc.cost))],
        ['Lines with problems', L.filter((x) => x.calc.problems.length).length],
      ] as [string, unknown][]) s.addRow([k, v]);
      // by CN and origin
      const g = wb.addWorksheet('Goods by CN and origin');
      g.addRow(['CN code', 'Aggregated goods category', 'Country of origin', 'Net mass (t)', 'Embedded emissions (tCO2e)', 'SEE (tCO2e/t)', 'Of which on default values (t)', 'Free allocation adjustment (tCO2e)', 'Certificates']);
      styleHeader(g, [12, 26, 16, 14, 18, 14, 18, 20, 14]);
      const groups = new Map<string, typeof L>();
      for (const x of L) { const k = `${x.cn}|${x.origin}`; groups.set(k, [...(groups.get(k) ?? []), x]); }
      for (const [k, xs] of groups) {
        const [cn, origin] = k.split('|');
        const mass = xs.reduce((a, x) => a + x.mass, 0), emb = xs.reduce((a, x) => a + (x.calc.embedded ?? 0), 0);
        g.addRow([cn, xs[0]!.categoryName ?? '', origin, t(mass), t(emb), mass ? t(emb / mass) : '', t(xs.filter((x) => x.source === 'default').reduce((a, x) => a + x.mass, 0)), t(xs.reduce((a, x) => a + x.calc.faa, 0)), t(xs.reduce((a, x) => a + (x.calc.certificates ?? 0), 0))]);
      }
      // installations and verification
      const v = wb.addWorksheet('Installations & verification');
      v.addRow(['Installation', 'CBAM Registry ID', 'Country', 'Production route', 'CN codes', 'Net mass (t)', 'Emissions', 'Direct SEE', 'Indirect SEE', 'Verification report', 'Carbon price paid (EUR/t)']);
      styleHeader(v, [28, 20, 10, 22, 18, 12, 10, 12, 12, 30, 16]);
      const inst = new Map<string, typeof L>();
      for (const x of L) { const k = `${x.installation ?? x.supplier ?? '(not given)'}|${x.installation_id_reg ?? ''}|${x.origin}|${x.source}`; inst.set(k, [...(inst.get(k) ?? []), x]); }
      for (const [k, xs] of inst) { const [n, id, o, src] = k.split('|'); v.addRow([n, id, o, xs[0]!.route ?? '', [...new Set(xs.map((x) => x.cn))].join(', '), t(xs.reduce((a, x) => a + x.mass, 0)), src, xs[0]!.see_direct ?? '', xs[0]!.see_indirect ?? '', xs[0]!.verifier_ref ?? '', xs[0]!.carbon_price_eur ?? '']); }
      // certificates
      const ce = wb.addWorksheet('Certificates');
      ce.addRow(['Quarter', 'CN code', 'Origin', 'Net mass (t)', 'SEE used (tCO2e/t)', 'Default mark-up', 'CBAM benchmark', 'SEFA (tCO2e/t)', 'Carbon price deduction (tCO2e/t)', 'Certificates', 'Price (EUR)', 'Cost (EUR)', 'Problems']);
      styleHeader(ce, [9, 12, 9, 12, 14, 12, 14, 12, 16, 12, 10, 12, 50]);
      for (const x of L) ce.addRow([`Q${x.quarter}`, x.cn, x.origin, x.mass, t(x.calc.see), x.calc.markup ? `${x.calc.markup * 100}%` : '', x.benchmarkUsed ?? '', t(x.calc.sefa), t(x.calc.priceDeduct), t(x.calc.certificates), x.calc.price ?? '', x.calc.cost == null ? '' : Math.round(x.calc.cost), x.calc.problems.join('; ')]);
      // lines
      const li = wb.addWorksheet('Import lines');
      li.addRow(TEMPLATE.map((x) => x.replace(' *', '')).concat(['Default value', 'CBAM benchmark']));
      styleHeader(li, [14, 12, 30, 12, 14, 12, 20, 26, 26, 22, 22, 14, 14, 14, 14, 24, 12, 12]);
      for (const x of L) li.addRow([x.import_date ? String(x.import_date instanceof Date ? x.import_date.toISOString() : x.import_date).slice(0, 10) : `Q${x.quarter}`, x.cn, x.description, x.origin, x.mass, x.procedure ?? '', x.customs_ref ?? '', x.supplier ?? '', x.installation ?? '', x.installation_id_reg ?? '', x.route ?? '', x.source,
        x.see_direct ?? '', x.see_indirect ?? '', x.carbon_price_eur ?? '', x.verifier_ref ?? '', x.defaultUsed ?? '', x.benchmarkUsed ?? '']);
      await audit(c, req, 'cbam.declaration.export', 'cbam_import', null, { year: q.year, lines: L.length });
      return wb;
    });
    return sendWorkbook(reply, wb, `CBAM declaration ${q.year}.xlsx`);
  });

  // ------------------------------------------------------------- references --
  app.post('/api/cbam/reference', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const b = z.object({ kind: z.enum(['default', 'benchmark', 'price']), cn: opt(cnCode), country: opt(country), route: opt(z.string().trim().max(120)), year: z.number().int().min(2023).max(2100),
      quarter: opt(z.number().int().min(1).max(4)), value: n0, source: z.string().trim().min(2).max(300) }).parse(req.body);
    if (b.kind !== 'price' && !b.cn) throw new AppError('Give the CN code');
    if (b.kind === 'price' && !b.quarter) throw new AppError('Give the quarter');
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO cbam_reference (tenant_id, kind, cn, country, route, year, quarter, value, source, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, b.kind, b.cn, b.country, b.route, b.year, b.quarter, b.value, b.source, req.user.name])).rows[0];
      await audit(c, req, 'cbam.reference.create', 'cbam_reference', r.id, b);
      return { id: r.id };
    });
  });
  app.delete('/api/cbam/reference/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM cbam_reference WHERE id = $1 AND tenant_id IS NOT NULL RETURNING kind`, [id]);
      if (!r.rowCount) throw notFound('Reference value');
      await audit(c, req, 'cbam.reference.delete', 'cbam_reference', id, {});
      return { ok: true };
    });
  });
}
