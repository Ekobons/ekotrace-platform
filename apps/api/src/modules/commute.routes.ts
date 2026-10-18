/**
 * Employee commuting (Scope 3.7): one record per facility and year.
 *
 *   GET    /api/commuting/options           modes, car fuels, catalogue items, defaults
 *   GET    /api/commuting?year=             facilities the person sees, with their record (if any)
 *   GET    /api/commuting/record?facilityId=&year=   the record with its answers and monthly entries
 *   POST   /api/commuting/survey            read a survey export (.csv / .xlsx): columns, answers, what was not recognised
 *   POST   /api/commuting/preview           distances and tCO2e, nothing saved
 *   PUT    /api/commuting                   save: the record, the answers, and one entry per mode and month
 *   DELETE /api/commuting/:id               remove the record and its entries
 *   GET    /api/commuting/survey-template   the survey file to fill in (or to copy into a form tool)
 *
 * The entries are generated from the record (split by each month's working days) and change
 * only with it; once any of them is approved the record is locked.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  CAR_FUELS, COMMUTE_MODES, commuteSurvey, commuteTyped, defaultWorkingDays, fuelOf, modeOf, monthShares, splitByMonth, workdaysByMonth,
  type CommuteMode, type CommuteResult, type SurveyAnswer,
} from '@ekotrace/calc';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { cellText, detectKind, findHeaderRow, sheetRows, type Cell } from '../lib/sheet.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { calculate } from './calc.service.js';
import { contextFor, saveEntry, tenantSettings } from './activity.routes.js';
import { PRODUCT } from '../lib/brand.js';

const MODE_KEYS = COMMUTE_MODES.map((m) => m.key) as [CommuteMode, ...CommuteMode[]];
const FUEL_KEYS = CAR_FUELS.map((f) => f.key) as [string, ...string[]];
const WEEKEND = z.enum(['sat_sun', 'fri_sat', 'sun']);
const num = z.number().finite();

const typedRow = z.object({
  mode: z.enum(MODE_KEYS), itemCode: z.string().max(80).optional(), fuel: z.enum(FUEL_KEYS).optional(),
  employees: num.min(0).max(1e6), oneWayKm: num.min(0).max(500).optional(), daysPerWeek: num.min(0).max(7).optional(),
  occupants: num.min(1).max(60).optional(), annualKm: num.min(0).max(1e10).optional(),
});
const answer = z.object({
  row: z.number().int().optional(), mode: z.enum(MODE_KEYS), km: num.min(0).max(500).nullable().optional(), days: num.min(0).max(7).nullable().optional(),
  occupants: num.min(1).max(60).nullable().optional(), fuel: z.enum(FUEL_KEYS).optional(), mode2: z.enum(MODE_KEYS).nullable().optional(), km2: num.min(0).max(500).nullable().optional(),
  wfhDays: num.min(0).max(7).nullable().optional(),
});
const body = z.object({
  facilityId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  method: z.enum(['typed', 'survey']),
  headcount: z.number().int().min(0).max(1e6),
  workingDays: num.positive().max(366),
  weekend: WEEKEND.default('sat_sun'),
  homeworking: z.boolean().optional(),
  holidays: num.min(0).max(100).optional(),
  leave: num.min(0).max(100).optional(),
  rows: z.array(typedRow).max(200).default([]),
  answers: z.array(answer).max(100_000).default([]),
  survey: z.object({ file: z.string().max(300).optional(), columns: z.record(z.string(), z.string()).optional(), site: z.string().max(200).nullable().optional(),
    unrecognised: z.number().int().optional() }).optional(),
  note: z.string().max(1000).optional().nullable(),
});
export type Body = z.infer<typeof body>;
export { body as commuteBody, compute as commuteCompute, priced as commutePriced };

function compute(b: Body): CommuteResult {
  const s = { year: b.year, workingDays: b.workingDays, weekend: b.weekend, homeworking: b.homeworking };
  try {
    return b.method === 'survey' ? commuteSurvey(b.answers as SurveyAnswer[], s, b.headcount) : commuteTyped(b.rows as Parameters<typeof commuteTyped>[0], s, b.headcount || undefined);
  } catch (e) { throw new AppError((e as Error).message); }
}

async function facilityFor(c: Tx, req: FastifyRequest, id: string, enter: boolean) {
  const f = (await c.query(`SELECT id, name, country, grid_region, employees FROM org_node WHERE id = $1 AND kind = 'facility' AND active`, [id])).rows[0];
  if (!f) throw notFound('Facility');
  const scope = await scopeOf(c, req.user);
  assertCan(enter ? scope.enter : scope.see, f.id, enter ? 'enter data for this facility' : 'see this facility');
  return f as { id: string; name: string; country: string; grid_region: string | null; employees: number | null };
}

/** Emissions of each line for the whole year (kg CO2e, Scope 3.7 incl. well-to-tank). */
async function priced(c: Tx, tenant: { gwp_set: string }, fac: { id: string; country: string; grid_region: string | null }, b: Body, r: CommuteResult) {
  const codes = r.lines.map((l) => l.item);
  const items = new Map<string, { id: number; name: string }>((await c.query(`SELECT code, id, name FROM item WHERE code = ANY($1) AND active`, [codes])).rows.map((x) => [x.code, { id: x.id, name: x.name }]));
  const lines = [];
  const warnings = [...r.warnings];
  for (const l of r.lines) {
    const it = items.get(l.item);
    if (!it) throw new AppError(`Factors for ${l.item} are not loaded: ask the platform administrator to load the DESNZ factor files.`);
    const { result } = await calculate({ itemId: it.id, quantity: l.quantity, unit: l.unit, periodStart: `${b.year}-01-01`, periodEnd: `${b.year}-12-31` }, contextFor(c, tenant.gwp_set, fac.country, fac));
    for (const w of result.warnings) if (!warnings.includes(w)) warnings.push(w);
    lines.push({ ...l, itemId: it.id, name: it.name, kg: result.totals.scope3, perUnit: l.quantity ? result.totals.scope3 / l.quantity : 0, source: result.factors[0]?.source ?? null });
  }
  return { ...r, lines, warnings, kg: lines.reduce((a, l) => a + l.kg, 0) };
}

const RECORD = `SELECT r.id, r.facility_id, f.name AS facility, r.year, r.method, r.survey_id, sv.name AS survey_name, r.headcount, r.working_days::float8 AS working_days, r.weekend, r.rows, r.survey, r.result, r.note,
                       r.created_by, r.created_at, r.updated_by, r.updated_at, u.name AS updated_by_name,
                       (SELECT count(*)::int FROM activity a WHERE a.commute_record_id = r.id) AS entries,
                       (SELECT count(*)::int FROM activity a WHERE a.commute_record_id = r.id AND a.status = 'approved') AS approved,
                       (SELECT count(*)::int FROM commute_response x WHERE x.record_id = r.id) AS answers
                  FROM commute_record r JOIN org_node f ON f.id = r.facility_id LEFT JOIN app_user u ON u.id::text = r.updated_by LEFT JOIN survey sv ON sv.id = r.survey_id`;

// ------------------------------------------------------------------ survey file --
const COLS: [key: string, test: (h: string) => boolean][] = [
  ['km2', (h) => /second|2nd|then|other/.test(h) && /dist|km|kilomet|mile/.test(h)],
  ['mode2', (h) => /second|2nd|then|other/.test(h) && /mode|transport|way|travel|how/.test(h)],
  ['days', (h) => /day/.test(h)],
  ['km', (h) => /dist|km|kilomet|mile|how far/.test(h)],
  ['occupants', (h) => /people|occupan|passeng|persons|how many|car.?pool size|sharing/.test(h)],
  ['fuel', (h) => /fuel|engine|power|car type|vehicle type|type of car/.test(h)],
  ['site', (h) => /site|facility|office|location|workplace|branch|campus/.test(h)],
  ['mode', (h) => /mode|transport|how do you|how you|way to work|travel to work|commute|get to work|means/.test(h)],
];
/** Header → field, first match wins, each field used once. */
export function guessColumns(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const x = h.toLowerCase();
    if (!x || /employee id|^id$|name|email|timestamp|date|department|comment/.test(x)) continue;
    const hit = COLS.find(([k, t]) => !out[k] && t(x));
    if (hit) out[hit[0]] = h;
  }
  return out;
}
const firstNumber = (s: string) => { const m = /-?\d+(?:[.,]\d+)?/.exec(s.replace(/,(?=\d{3}\b)/g, '')); return m ? Number(m[0].replace(',', '.')) : null; };
function daysOf(s: string, per: number) {
  if (!s) return null;
  if (/every|daily|all|full/i.test(s)) return per;
  if (/never|none|remote|home/i.test(s)) return 0;
  return firstNumber(s);
}

async function readSurvey(buf: Buffer, filename: string, opts: { map?: Record<string, string>; site?: string | null; facilityName?: string; per: number }) {
  const kind = detectKind(buf, filename);
  if (kind === 'xls') throw new AppError('Old Excel (.xls): save the file as .xlsx or .csv and upload again');
  if (kind === 'unknown') throw new AppError('Upload the survey export as .xlsx or .csv');
  const all: Cell[][] = [];
  for await (const r of sheetRows(buf, kind)) { all.push(r); if (all.length > 100_001) throw new AppError('At most 100,000 answers per file'); }
  if (all.length < 2) throw new AppError('The file has no answers');
  const h = findHeaderRow(all);
  const headers = (all[h] ?? []).map((c) => cellText(c));
  const columns = { ...guessColumns(headers), ...(opts.map ?? {}) };
  if (!columns.mode) throw new AppError(`No column for the way people travel to work. Columns found: ${headers.filter(Boolean).join(', ')}`);
  const at = (k: string) => headers.indexOf(columns[k] ?? '\u0000');
  const ix = { mode: at('mode'), km: at('km'), days: at('days'), occ: at('occupants'), fuel: at('fuel'), mode2: at('mode2'), km2: at('km2'), site: at('site') };
  const miles = (k: 'km' | 'km2') => /mile/i.test(columns[k] ?? '') && !/km|kilomet/i.test(columns[k] ?? '');
  const rows = all.slice(h + 1);
  // which rows belong to this facility (when the file has a site column)
  const sites = new Map<string, number>();
  if (ix.site >= 0) for (const r of rows) { const v = cellText(r[ix.site]); if (v) sites.set(v, (sites.get(v) ?? 0) + 1); }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let site = opts.site ?? null;
  if (ix.site >= 0 && site == null && opts.facilityName) {
    const f = norm(opts.facilityName);
    site = [...sites.keys()].find((v) => norm(v) === f) ?? [...sites.keys()].find((v) => norm(v).includes(f) || f.includes(norm(v))) ?? null;
  }
  const answers: (SurveyAnswer & { row: number })[] = [];
  const unrecognised = new Map<string, number>();
  let otherSite = 0, blank = 0;
  rows.forEach((r, i) => {
    if (ix.site >= 0 && sites.size && site !== '*') { if (!site || cellText(r[ix.site]) !== site) { otherSite++; return; } }
    const mt = cellText(r[ix.mode]);
    if (!mt) { blank++; return; }
    const mode = modeOf(mt);
    if (!mode) { unrecognised.set(mt, (unrecognised.get(mt) ?? 0) + 1); return; }
    const km = ix.km >= 0 ? firstNumber(cellText(r[ix.km])) : null;
    const km2 = ix.km2 >= 0 ? firstNumber(cellText(r[ix.km2])) : null;
    const m2 = ix.mode2 >= 0 ? modeOf(cellText(r[ix.mode2])) : null;
    answers.push({
      row: h + 2 + i, mode, km: km == null ? null : miles('km') ? km * 1.609344 : km,
      days: ix.days >= 0 ? daysOf(cellText(r[ix.days]), opts.per) : null,
      occupants: ix.occ >= 0 ? firstNumber(cellText(r[ix.occ])) : null,
      fuel: ix.fuel >= 0 ? fuelOf(cellText(r[ix.fuel])) : 'unknown',
      mode2: m2 && m2 !== 'wfh' ? m2 : null, km2: km2 == null ? null : miles('km2') ? km2 * 1.609344 : km2,
    });
  });
  return {
    headers, columns, answers, blank, otherSite, site,
    sites: [...sites.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })),
    unrecognised: [...unrecognised.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count })),
  };
}

/**
 * Save a facility's commuting for a year: the record (typed in, a survey file, or an Ekotrace survey),
 * its answers, and one entry per mode and month split by working days. Replaces the earlier record;
 * refused once any of its monthly entries is approved.
 */
export async function saveCommute(c: Tx, req: FastifyRequest, b: Body, opts: { surveyId?: string } = {}) {
  const tenant = requireTenant(req);
  const fac = await facilityFor(c, req, b.facilityId, true);
  const t = await tenantSettings(tenant);
  const old = (await c.query(`${RECORD} WHERE r.facility_id = $1 AND r.year = $2 FOR UPDATE OF r`, [b.facilityId, b.year])).rows[0];
  if (old?.approved) throw new AppError(`${old.approved} of this record's monthly entries are approved: it can no longer be changed. Ask an approver to reject them first.`, 409, 'LOCKED');
  const r = await priced(c, t, fac, b, compute(b));
  const result = { ...r, settings: { holidays: b.holidays ?? null, leave: b.leave ?? null } };
  const rec = old
    ? (await c.query(`UPDATE commute_record SET method=$2, headcount=$3, working_days=$4, weekend=$5, rows=$6, survey=$7, result=$8, note=$9, updated_by=$10, survey_id=$11, updated_at=now() WHERE id=$1 RETURNING id`,
        [old.id, b.method, b.headcount, b.workingDays, b.weekend, JSON.stringify(b.method === 'typed' ? b.rows : []), b.method === 'survey' ? JSON.stringify(b.survey ?? {}) : null, JSON.stringify(result), b.note ?? null, req.user.id, opts.surveyId ?? null])).rows[0]
    : (await c.query(`INSERT INTO commute_record (tenant_id, facility_id, year, method, headcount, working_days, weekend, rows, survey, result, note, created_by, updated_by, survey_id)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13) RETURNING id`,
        [tenant, fac.id, b.year, b.method, b.headcount, b.workingDays, b.weekend, JSON.stringify(b.method === 'typed' ? b.rows : []), b.method === 'survey' ? JSON.stringify(b.survey ?? {}) : null,
         JSON.stringify(result), b.note ?? null, req.user.id, opts.surveyId ?? null])).rows[0];
  // answers kept for audit
  await c.query('DELETE FROM commute_response WHERE record_id = $1', [rec.id]);
  if (b.method === 'survey' && b.answers.length) {
    const A = b.answers;
    await c.query(
      `INSERT INTO commute_response (tenant_id, record_id, row_no, mode, km, days, occupants, fuel, mode2, km2)
       SELECT $1, $2, * FROM unnest($3::int[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::text[], $9::text[], $10::numeric[])`,
      [tenant, rec.id, A.map((a, i) => a.row ?? i + 1), A.map((a) => a.mode), A.map((a) => a.km ?? null), A.map((a) => a.days ?? null), A.map((a) => a.occupants ?? null),
       A.map((a) => a.fuel ?? null), A.map((a) => a.mode2 ?? null), A.map((a) => a.km2 ?? null)]);
  }
  // the year as monthly entries (working days of each month), replacing the previous ones
  await c.query('DELETE FROM activity_result WHERE activity_id IN (SELECT id FROM activity WHERE commute_record_id = $1)', [rec.id]);
  await c.query('DELETE FROM activity WHERE commute_record_id = $1', [rec.id]);
  const shares = monthShares(b.year, b.weekend);
  const note = `Employee commuting ${b.year}, ${b.method === 'survey' ? `survey (${b.answers.length} answers for ${b.headcount} employees)` : 'typed in'}; split by working days per month`;
  let entries = 0;
  for (const l of r.lines) {
    const parts = splitByMonth(l.quantity, shares);
    for (let m = 0; m < 12; m++) {
      if (!(parts[m]! > 0)) continue;
      const last = new Date(Date.UTC(b.year, m + 1, 0)).getUTCDate();
      const mm = String(m + 1).padStart(2, '0');
      const e = await saveEntry(c, req, t, { facilityId: fac.id, itemId: l.itemId, quantity: parts[m]!, unit: l.unit, periodStart: `${b.year}-${mm}-01`, periodEnd: `${b.year}-${mm}-${last}`,
        dataType: l.measured ? 'actual' : 'estimated', note }, { quiet: true });
      await c.query('UPDATE activity SET commute_record_id = $2 WHERE id = $1', [e.id, rec.id]);
      entries++;
    }
  }
  await audit(c, req, old ? 'commute.update' : 'commute.create', 'commute_record', rec.id,
    { facility: fac.name, year: b.year, method: b.method, headcount: b.headcount, workingDays: b.workingDays, answers: b.answers.length || undefined, kgCo2e: Math.round(r.kg), entries });
  return { id: rec.id, entries, ...result };
}

// ------------------------------------------------------------------------ routes --
export async function commuteRoutes(app: FastifyInstance) {
  app.get('/api/commuting/options', async (req) => {
    requireTenant(req);
    const year = z.object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) }).parse(req.query).year;
    return tenantTx(requireTenant(req), async (c) => {
      const items = (await c.query(
        `SELECT i.code, i.name, s.code AS sub, s.name AS sub_name, i.default_unit AS unit, i.note FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category k ON k.id = s.category_id
          WHERE k.code = 'employee_commuting' AND i.active ORDER BY s.sort, i.sort, i.name`)).rows;
      return {
        modes: COMMUTE_MODES, fuels: CAR_FUELS, items,
        defaults: Object.fromEntries((['sat_sun', 'fri_sat', 'sun'] as const).map((w) => [w, { weekdays: workdaysByMonth(year, w).reduce((a, x) => a + x, 0), workingDays: defaultWorkingDays(year, w) }])),
        holidays: 12, leave: 22,
      };
    });
  });

  app.get('/api/commuting', async (req) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query).year;
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const facs = (await c.query(`SELECT f.id, f.name, p.name AS parent, f.employees FROM org_node f LEFT JOIN org_node p ON p.id = f.parent_id
                                    WHERE f.kind = 'facility' AND f.active ORDER BY p.name NULLS FIRST, f.name`)).rows.filter((f) => scope.see.has(f.id));
      const recs = new Map((await c.query(`${RECORD} WHERE r.year = $1`, [year])).rows.map((r) => [r.facility_id, r]));
      return {
        facilities: facs.map((f) => {
          const r = recs.get(f.id);
          return { ...f, canEnter: scope.enter.has(f.id), record: r ? { id: r.id, method: r.method, headcount: r.headcount, kg: r.result?.kg ?? 0, personKm: r.result?.personKm ?? 0,
            responseRate: r.result?.responseRate ?? null, entries: r.entries, approved: r.approved, updated_at: r.updated_at, updated_by_name: r.updated_by_name } : null };
        }),
      };
    });
  });

  app.get('/api/commuting/record', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid(), year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const fac = await facilityFor(c, req, q.facilityId, false);
      const r = (await c.query(`${RECORD} WHERE r.facility_id = $1 AND r.year = $2`, [q.facilityId, q.year])).rows[0] ?? null;
      const answers = r?.method === 'survey' ? (await c.query(`SELECT row_no AS row, mode, km::float8 AS km, days::float8 AS days, occupants::float8 AS occupants, fuel, mode2, km2::float8 AS km2
                                                                FROM commute_response WHERE record_id = $1 ORDER BY row_no`, [r.id])).rows : [];
      const months = r ? (await c.query(`SELECT extract(month FROM a.period_start)::int AS m, sum(a.co2e_scope3)::float8 / 1000 AS t, count(*)::int AS n,
                                                  count(*) FILTER (WHERE a.status = 'approved')::int AS approved
                                             FROM activity a WHERE a.commute_record_id = $1 GROUP BY 1 ORDER BY 1`, [r.id])).rows : [];
      return { facility: { id: fac.id, name: fac.name, employees: fac.employees }, record: r, answers, months };
    });
  });

  app.post('/api/commuting/survey', { bodyLimit: 30 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const q = z.object({ facilityId: z.string().uuid(), map: z.string().max(2000).optional(), site: z.string().max(200).optional(), weekend: WEEKEND.default('sat_sun') }).parse(req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length < 10) throw new AppError('Send the survey file as the request body (Content-Type: application/octet-stream)');
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'survey'));
    let map: Record<string, string> | undefined;
    if (q.map) { try { map = z.record(z.string(), z.string()).parse(JSON.parse(q.map)); } catch { throw new AppError('Column choice not understood'); } }
    return tenantTx(tenant, async (c) => {
      const fac = await facilityFor(c, req, q.facilityId, true);
      const out = await readSurvey(req.body as Buffer, filename, { map, site: q.site ?? null, facilityName: fac.name, per: q.weekend === 'sun' ? 6 : 5 });
      return { file: filename, ...out };
    });
  });

  app.post('/api/commuting/preview', async (req) => {
    const tenant = requireTenant(req);
    const b = body.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const fac = await facilityFor(c, req, b.facilityId, true);
      const t = await tenantSettings(tenant);
      return priced(c, t, fac, b, compute(b));
    });
  });

  app.put('/api/commuting', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const b = body.parse(req.body);
    return tenantTx(tenant, (c) => saveCommute(c, req, b));
  });

  app.delete('/api/commuting/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`${RECORD} WHERE r.id = $1`, [id])).rows[0];
      if (!r) throw notFound('Commuting record');
      await facilityFor(c, req, r.facility_id, true);
      if (r.approved) throw new AppError(`${r.approved} of this record's monthly entries are approved: it cannot be removed.`, 409, 'LOCKED');
      await c.query('DELETE FROM activity_result WHERE activity_id IN (SELECT id FROM activity WHERE commute_record_id = $1)', [id]);
      const n = (await c.query('DELETE FROM activity WHERE commute_record_id = $1', [id])).rowCount ?? 0;
      await c.query('DELETE FROM commute_record WHERE id = $1', [id]);
      await audit(c, req, 'commute.delete', 'commute_record', id, { facility: r.facility, year: r.year, entries: n });
      return { ok: true, entries: n };
    });
  });

  app.get('/api/commuting/survey-template', async (req, reply) => {
    requireTenant(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Answers');
    ws.addRow(['Employee ID (optional)', 'Site', 'Main way to work', 'One-way distance (km)', 'Days at the workplace per week', 'People in the car, including you', 'Car fuel', 'Second way (if you change)', 'Second distance (km)']);
    styleHeader(ws, [20, 24, 24, 20, 18, 20, 16, 24, 18]);
    const ex = [
      ['E001', 'Head office', 'Car, driving alone', 18, 5, 1, 'Petrol', '', ''],
      ['E002', 'Head office', 'Car-pool / lift', 25, 4, 3, 'Hybrid', '', ''],
      ['E003', 'Head office', 'Public bus', 6, 5, '', '', 'Metro / tram', 14],
      ['E004', 'Head office', 'Staff shuttle bus', 32, 5, '', '', '', ''],
      ['E005', 'Head office', 'Works from home', '', 0, '', '', '', ''],
    ];
    for (const r of ex) ws.addRow(r).font = { italic: true, color: { argb: 'FF6B7C78' } };
    const modes = COMMUTE_MODES.map((m) => `"${m.label}"`).join(',');
    if (modes.length < 255) {
      (ws as unknown as { dataValidations: { add: (r: string, v: object) => void } }).dataValidations.add('C2:C5000', { type: 'list', allowBlank: true, formulae: [`"${COMMUTE_MODES.map((m) => m.label).join(',')}"`] });
      (ws as unknown as { dataValidations: { add: (r: string, v: object) => void } }).dataValidations.add('G2:G5000', { type: 'list', allowBlank: true, formulae: [`"${CAR_FUELS.map((f) => f.label).join(',')}"`] });
    }
    const how = wb.addWorksheet('How to fill');
    how.columns = [{ width: 30 }, { width: 90 }];
    const lines: [string, string][] = [
      ['Employee commuting survey', 'One row per employee. The grey rows on "Answers" are examples: delete them before uploading.'],
      ['Main way to work', `The way used for most of the distance. Accepted: ${COMMUTE_MODES.map((m) => m.label).join('; ')} (similar words such as "Dubai Metro", "Careem", "drive" are recognised).`],
      ['One-way distance (km)', 'Home to the workplace, one way, in km (a column named in miles is converted).'],
      ['Days at the workplace per week', 'Usual number of days travelled to the workplace in a working week (0 = works from home all week).'],
      ['People in the car', 'For cars only, including the driver. 1 = drives alone.'],
      ['Car fuel', CAR_FUELS.map((f) => f.label).join(', ')],
      ['Second way', 'Optional: when people change, e.g. bus then metro: main way = bus, second way = metro, each with its distance.'],
      ['Site', 'Optional: the workplace, when one file covers several facilities. Upload the file once per facility; the rows of other sites are left out.'],
      ['Who to ask', 'Everyone at the facility if possible. Results are scaled up to the facility\'s headcount; aim for at least 30% of employees answering.'],
      ['Form tools', 'The same questions can be asked in Microsoft Forms or Google Forms; export the answers as .xlsx or .csv and upload them.'],
    ];
    for (const [a, b] of lines) { const r = how.addRow([a, b]); r.getCell(1).font = { bold: true }; r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; }
    return sendWorkbook(reply, wb, `${PRODUCT} commuting survey.xlsx`);
  });
}
