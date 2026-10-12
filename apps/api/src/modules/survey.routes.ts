/**
 * Surveys (Capture → Surveys): employee commuting asked in Ekotrace.
 *
 *   Admins (Super admin, Admin) create a survey for a year and some facilities, add the people to
 *   ask (each gets a personal 8-character code), open it and send the invitations (email from their
 *   mail app, or a CSV for a mail merge). People answer without signing in: "Answering a survey?"
 *   on the sign-in page, then their code. Managers and verifiers see the results; individual
 *   answers are for admins only.
 *
 *   Results: per facility, the average kg CO2e per respondent × the facility's headcount, with a
 *   95% range (finite population correction); a facility without answers uses the company average
 *   and is flagged. Publishing writes each facility's commuting record for the year (Scope 3 ·
 *   Employee commuting, one entry per mode and month), the same as typing it in.
 *
 * Public (no session): POST /api/public/survey/lookup {code}, PUT /api/public/survey {code, …}.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { commuteSurvey, workdaysPerWeek, type CommuteMode, type CarFuel, type SurveyAnswer } from '@ekotrace/calc';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { csvRows } from '../lib/csv.js';
import { calculate } from './calc.service.js';
import { contextFor, tenantSettings } from './activity.routes.js';
import { saveCommute, type Body as CommuteBody } from './commute.routes.js';

/** What people choose in the form → the commuting engine's modes. */
export const SURVEY_MODES: [key: string, label: string, mode: CommuteMode][] = [
  ['car', 'Car — I drive alone', 'car'], ['carpool', 'Car pool / lift share', 'carpool'], ['taxi', 'Taxi or ride-hailing', 'taxi'], ['moto', 'Motorbike', 'motorbike'],
  ['bus', 'Public bus', 'bus'], ['shuttle', 'Company shuttle / staff bus', 'shuttle'], ['metro', 'Metro / tram', 'metro'], ['train', 'Train', 'train'],
  ['scooter', 'E-scooter / e-bike', 'active'], ['walk', 'Walk or cycle', 'active'],
];
export const SURVEY_FUELS: [string, string][] = [['petrol', 'Petrol'], ['diesel', 'Diesel'], ['hybrid', 'Hybrid'], ['phev', 'Plug-in hybrid'], ['bev', 'Electric'], ['unknown', 'Not sure']];
const MODE_OF = new Map(SURVEY_MODES.map((m) => [m[0], m[2]]));
const LABEL = new Map(SURVEY_MODES.map((m) => [m[0], m[1]]));
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', open: 'Collecting answers', closed: 'Closed', published: 'Published to Scope 3' };
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const answerSchema = z.object({
  days: z.number().int().min(0).max(7),
  wfh: z.number().int().min(0).max(7).default(0),
  legs: z.array(z.object({ mode: z.string().refine((m) => MODE_OF.has(m), 'Unknown way of travelling'), km: z.number().finite().min(0).max(300) })).min(1).max(2),
  fuel: z.enum(SURVEY_FUELS.map((f) => f[0]) as [string, ...string[]]).default('unknown'),
  occ: z.number().int().min(1).max(9).default(2),
}).refine((a) => a.legs[0]!.km > 0 || MODE_OF.get(a.legs[0]!.mode) === 'active' || a.days === 0, 'Enter the one-way distance in km');
type Answer = z.infer<typeof answerSchema>;

/** One answer → the engine's form. */
export function toEngine(a: Answer, wfh: boolean): SurveyAnswer {
  const l0 = a.legs[0]!, l1 = a.legs[1];
  return {
    mode: MODE_OF.get(l0.mode)!, km: l0.km, days: a.days, fuel: a.fuel as CarFuel, occupants: l0.mode === 'carpool' || l1?.mode === 'carpool' ? a.occ : 1,
    mode2: l1 ? MODE_OF.get(l1.mode)! : null, km2: l1 ? l1.km : null, wfhDays: wfh ? a.wfh : 0,
  };
}

interface SurveyRow {
  id: string; tenant_id: string; name: string; year: number; close_at: string | null; weeks: number; wfh: boolean; facility_ids: string[]; headcount: Record<string, number>;
  status: string; created_at: string; published_at: string | null; published_by: string | null; published: unknown;
}
const settingsOf = (sv: SurveyRow) => ({ year: sv.year, workingDays: sv.weeks * workdaysPerWeek('sat_sun'), weekend: 'sat_sun' as const, homeworking: sv.wfh });

/** kg CO2e per unit of each commuting item for the survey year (with well-to-tank), looked up once. */
async function unitFactors(c: Tx, tenant: string, year: number, codes: string[]) {
  const t = await tenantSettings(tenant);
  const items = (await c.query('SELECT id, code FROM item WHERE code = ANY($1)', [codes])).rows as { id: number; code: string }[];
  const out = new Map<string, number>();
  for (const it of items) {
    try {
      const { result } = await calculate({ itemId: it.id, quantity: 1000, unit: it.code.startsWith('commute:home:') ? 'fte_h' : /^commute:(car|motorbike|active)/.test(it.code) ? 'km' : 'pkm',
        periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` }, contextFor(c, t.gwp_set, 'AE'));
      out.set(it.code, result.totals.scope3 / 1000);
    } catch { out.set(it.code, 0); }
  }
  return out;
}
const ALL_ITEMS = ['commute:car:average-car:petrol', 'commute:car:average-car:diesel', 'commute:car:average-car:hybrid', 'commute:car:average-car:phev', 'commute:car:average-car:bev',
  'commute:car:average-car:unknown', 'commute:motorbike:average', 'commute:taxi:regular-taxi', 'commute:bus:average-local-bus', 'commute:bus:coach', 'commute:rail:light-rail-and-tram',
  'commute:rail:national-rail', 'commute:active', 'commute:home:office-equipment'];

/** One respondent's year: kg CO2e and quantity per catalogue item. */
function personYear(a: Answer, sv: SurveyRow, f: Map<string, number>) {
  const r = commuteSurvey([toEngine(a, sv.wfh)], settingsOf(sv), 1);
  const lines = r.lines.map((l) => ({ item: l.item, unit: l.unit, q: l.quantity, kg: l.quantity * (f.get(l.item) ?? 0) }));
  return { kg: lines.reduce((s, l) => s + l.kg, 0), lines };
}

interface Resp { id: string; participant_id: string; facility_id: string; answers: Answer; entered_by: string | null; updated_at: string }
async function loadSurvey(c: Tx, id: string) {
  const sv = (await c.query('SELECT * FROM survey WHERE id = $1', [id])).rows[0] as SurveyRow | undefined;
  if (!sv) throw notFound('Survey');
  return sv;
}

/** Results per facility and in total, from the answers. */
export async function surveyResults(c: Tx, tenant: string, sv: SurveyRow) {
  const resps = (await c.query('SELECT id, participant_id, facility_id, answers, entered_by, updated_at FROM survey_response WHERE survey_id = $1', [sv.id])).rows as Resp[];
  const parts = (await c.query('SELECT id, facility_id, department FROM survey_participant WHERE survey_id = $1', [sv.id])).rows as { id: string; facility_id: string; department: string | null }[];
  const facs = (await c.query('SELECT id, name, employees FROM org_node WHERE id = ANY($1)', [sv.facility_ids])).rows as { id: string; name: string; employees: number | null }[];
  const f = await unitFactors(c, tenant, sv.year, ALL_ITEMS);
  const names = new Map((await c.query('SELECT code, name FROM item WHERE code = ANY($1)', [ALL_ITEMS])).rows.map((r) => [r.code as string, r.name as string]));
  const all = resps.map((r) => ({ r, ...personYear(r.answers, sv, f) }));
  const gMean = all.length ? all.reduce((s, x) => s + x.kg, 0) / all.length : 0;
  const out = { facs: [] as unknown[], tot: 0, totLo: 0, totHi: 0, n: all.length, N: 0, gMean, modes: {} as Record<string, number>, byItem: {} as Record<string, { name: string; q: number; unit: string; t: number }>, byDept: {} as Record<string, { n: number; kg: number }> };
  for (const fid of sv.facility_ids) {
    const fac = facs.find((x) => x.id === fid);
    if (!fac) continue;
    const N = Number(sv.headcount?.[fid] ?? fac.employees ?? 0) || 0;
    const xs = all.filter((x) => x.r.facility_id === fid), n = xs.length, useG = !n && all.length > 0, src = n ? xs : all;
    const m = src.length ? src.reduce((s, x) => s + x.kg, 0) / src.length : 0;
    const sd = src.length > 1 ? Math.sqrt(src.reduce((s, x) => s + (x.kg - m) ** 2, 0) / (src.length - 1)) : 0;
    const fpc = N > 1 && n < N ? Math.sqrt((N - n) / (N - 1)) : 0;
    const moe = src.length > 1 ? ((1.96 * sd) / Math.sqrt(src.length)) * (n ? fpc : 1) * N / 1000 : null;
    const t = (m * N) / 1000;
    out.tot += t; out.N += N;
    if (moe !== null) { out.totLo += Math.max(0, t - moe); out.totHi += t + moe; } else { out.totLo += t; out.totHi += t; }
    for (const x of src) for (const l of x.lines) {
      const k = out.byItem[l.item] ??= { name: names.get(l.item) ?? l.item, q: 0, unit: l.unit, t: 0 };
      k.q += (l.q / src.length) * N; k.t += (l.kg / src.length) * N / 1000;
    }
    out.facs.push({ id: fid, name: fac.name, N, n, invited: parts.filter((p) => p.facility_id === fid).length, rate: N ? n / N : 0, mean: m, t, moe, useG,
      low: n < Math.min(30, Math.ceil(N * 0.1)), fromFacility: sv.headcount?.[fid] === undefined || Number(sv.headcount[fid]) === Number(fac.employees) });
  }
  for (const x of all) {
    const k = x.r.answers.legs[0]?.mode; if (k) out.modes[k] = (out.modes[k] ?? 0) + 1;
    const d = parts.find((p) => p.id === x.r.participant_id)?.department || 'Not stated';
    const o = out.byDept[d] ??= { n: 0, kg: 0 }; o.n++; o.kg += x.kg;
  }
  return { ...out, people: all.map((x) => ({ id: x.r.id, kg: x.kg })) };
}

function newCode() { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += CODE_ABC[b[i]! % CODE_ABC.length]; return s; }
async function freshCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const used = await platformTx(async (c) => (await c.query('SELECT 1 FROM survey_participant WHERE code = $1', [code])).rowCount);
    if (!used) return code;
  }
  throw new AppError('Could not make a unique code; try again');
}
function inviteText(sv: { name: string; close_at: string | null }, p: { name: string; code: string }, company: string, link: string) {
  const due = sv.close_at ? ` by ${new Date(`${sv.close_at}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}` : '';
  return `Hi ${p.name.split(' ')[0]},\n\nWe're measuring the carbon footprint of commuting at ${company}. Please answer a 2-minute survey about how you usually get to work${due}.\n\n1. Open ${link}\n2. Your code: ${p.code}\n\nYour answers are only reported as averages. Thank you!`;
}
const linkFor = (req: FastifyRequest, code?: string) => `${req.protocol}://${req.headers.host ?? 'localhost'}/survey${code ? `?code=${code}` : ''}`;

/** Facilities the person may survey (create, add people) / see. */
async function guard(c: Tx, req: FastifyRequest, sv: SurveyRow, manage: boolean) {
  const s = await scopeOf(c, req.user);
  if (manage) {
    requireRole(req, 'super_admin', 'admin');
    if (!sv.facility_ids.every((f) => s.enter.has(f))) throw new AppError('This survey covers facilities outside your access', 403, 'FORBIDDEN');
  } else if (!sv.facility_ids.some((f) => s.see.has(f))) throw notFound('Survey');
  return s;
}
const admin = (req: FastifyRequest) => ['platform_admin', 'super_admin', 'admin'].includes(req.user.role);

const PEOPLE_SQL = `SELECT p.id, p.name, p.email, p.facility_id, f.name AS facility, p.department, p.code, p.sent_at, r.updated_at AS answered_at, r.entered_by
                      FROM survey_participant p JOIN org_node f ON f.id = p.facility_id LEFT JOIN survey_response r ON r.participant_id = p.id`;

export async function surveyRoutes(app: FastifyInstance) {
  app.get('/api/surveys/options', async () => ({ modes: SURVEY_MODES.map(([key, label]) => ({ key, label })), fuels: SURVEY_FUELS.map(([key, label]) => ({ key, label })), statuses: STATUS_LABEL }));

  app.get('/api/surveys', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'verifier');
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const rows = (await c.query(`SELECT s.*, (SELECT count(*)::int FROM survey_participant p WHERE p.survey_id = s.id) AS invited,
                                          (SELECT count(*)::int FROM survey_response r WHERE r.survey_id = s.id) AS answered
                                     FROM survey s ORDER BY s.created_at DESC`)).rows as (SurveyRow & { invited: number; answered: number })[];
      const vis = rows.filter((r) => r.facility_ids.some((f) => s.see.has(f)));
      const out = [];
      for (const r of vis) { const res = await surveyResults(c, tenant, r); out.push({ ...r, est: res.tot, N: res.N, canManage: admin(req) && r.facility_ids.every((f) => s.enter.has(f)) }); }
      return { surveys: out, canCreate: admin(req) };
    });
  });

  app.post('/api/surveys', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = z.object({ name: z.string().trim().min(1).max(120), year: z.number().int().min(2000).max(2100), closeAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      weeks: z.number().int().min(1).max(52).default(46), facilityIds: z.array(z.string().uuid()).min(1).max(500), wfh: z.boolean().default(false) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      if (!b.facilityIds.every((f) => s.enter.has(f))) throw new AppError('Choose facilities you manage', 403, 'FORBIDDEN');
      const facs = (await c.query(`SELECT id, employees FROM org_node WHERE id = ANY($1) AND kind = 'facility' AND active`, [b.facilityIds])).rows;
      if (facs.length !== b.facilityIds.length) throw new AppError('A facility was not found');
      const head = Object.fromEntries(facs.map((f) => [f.id, Number(f.employees ?? 0)]));
      const r = (await c.query(`INSERT INTO survey (tenant_id, name, year, close_at, weeks, wfh, facility_ids, headcount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, b.name, b.year, b.closeAt ?? null, b.weeks, b.wfh, b.facilityIds, JSON.stringify(head), req.user.id])).rows[0];
      await audit(c, req, 'survey.create', 'survey', r.id, { name: b.name, year: b.year, facilities: b.facilityIds.length });
      return { id: r.id };
    });
  });

  app.get('/api/surveys/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'verifier');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      const s = await guard(c, req, sv, false);
      const res = await surveyResults(c, tenant, sv);
      const people = (await c.query(`${PEOPLE_SQL} WHERE p.survey_id = $1 ORDER BY p.created_at, p.name`, [id])).rows;
      const isAdmin = admin(req);
      const answers = isAdmin ? (await c.query(`SELECT r.id, r.participant_id, r.facility_id, f.name AS facility, r.answers, r.updated_at, u.name AS entered_by
                                                   FROM survey_response r JOIN org_node f ON f.id = r.facility_id LEFT JOIN app_user u ON u.id::text = r.entered_by WHERE r.survey_id = $1 ORDER BY r.updated_at DESC`, [id])).rows
        .map((r) => ({ ...r, kg: res.people.find((p) => p.id === r.id)?.kg ?? 0 })) : [];
      const facilities = (await c.query('SELECT id, name, employees FROM org_node WHERE id = ANY($1) ORDER BY name', [sv.facility_ids])).rows;
      const pubBy = sv.published_by ? (await c.query('SELECT name FROM app_user WHERE id::text = $1', [sv.published_by])).rows[0]?.name ?? null : null;
      return {
        survey: { ...sv, published_by_name: pubBy }, facilities, results: { ...res, people: undefined },
        people: isAdmin ? people : people.map((p) => ({ id: p.id, facility_id: p.facility_id, facility: p.facility, department: p.department, answered_at: p.answered_at })),
        answers, canManage: isAdmin && sv.facility_ids.every((f) => s.enter.has(f)), canPublish: ['platform_admin', 'super_admin', 'admin', 'manager'].includes(req.user.role),
        link: linkFor(req),
      };
    });
  });

  app.patch('/api/surveys/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().trim().min(1).max(120).optional(), closeAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), weeks: z.number().int().min(1).max(52).optional(),
      wfh: z.boolean().optional(), headcount: z.record(z.string().uuid(), z.number().int().min(0).max(1e6)).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      if (sv.status === 'published') throw new AppError('Published: reopen the survey to change it');
      const head = b.headcount ? { ...sv.headcount, ...Object.fromEntries(Object.entries(b.headcount).filter(([k]) => sv.facility_ids.includes(k))) } : sv.headcount;
      await c.query('UPDATE survey SET name = COALESCE($2, name), close_at = CASE WHEN $3::boolean THEN $4::date ELSE close_at END, weeks = COALESCE($5, weeks), wfh = COALESCE($6, wfh), headcount = $7 WHERE id = $1',
        [id, b.name ?? null, b.closeAt !== undefined, b.closeAt ?? null, b.weeks ?? null, b.wfh ?? null, JSON.stringify(head)]);
      await audit(c, req, 'survey.update', 'survey', id, b);
      return { ok: true };
    });
  });

  app.post('/api/surveys/:id/status', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const st = z.object({ status: z.enum(['open', 'closed']) }).parse(req.body).status;
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      if (st === 'open' && !(await c.query('SELECT 1 FROM survey_participant WHERE survey_id = $1 LIMIT 1', [id])).rowCount) throw new AppError('Add the people to ask first');
      await c.query(`UPDATE survey SET status = $2, opened_at = CASE WHEN $2 = 'open' THEN coalesce(opened_at, now()) ELSE opened_at END, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END WHERE id = $1`, [id, st]);
      await audit(c, req, `survey.${st}`, 'survey', id, { name: sv.name });
      return { ok: true };
    });
  });

  app.delete('/api/surveys/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      if (sv.status === 'published') throw new AppError('Published surveys are kept: their answers stand behind the commuting figures');
      await c.query('DELETE FROM survey WHERE id = $1', [id]);
      await audit(c, req, 'survey.delete', 'survey', id, { name: sv.name });
      return { ok: true };
    });
  });

  /** Add people: rows, or text / CSV "name, email, facility, department" (facility by name; else the default). */
  app.post('/api/surveys/:id/participants', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ text: z.string().max(2_000_000).optional(), defaultFacilityId: z.string().uuid().optional(),
      rows: z.array(z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().max(200).optional(), facilityId: z.string().uuid().optional(), department: z.string().max(120).optional() })).max(20000).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      if (sv.status === 'published') throw new AppError('Published: reopen the survey to add people');
      const facs = (await c.query('SELECT id, name FROM org_node WHERE id = ANY($1)', [sv.facility_ids])).rows as { id: string; name: string }[];
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const facOf = (t: string) => { const n = norm(t); if (!n) return null; return facs.find((f) => f.id === t.trim() || norm(f.name) === n)?.id ?? facs.find((f) => norm(f.name).includes(n) || n.includes(norm(f.name)))?.id ?? null; };
      const def = b.defaultFacilityId && sv.facility_ids.includes(b.defaultFacilityId) ? b.defaultFacilityId : sv.facility_ids[0]!;
      const list = (b.rows ?? []).map((r) => ({ name: r.name, email: (r.email ?? '').toLowerCase(), fac: r.facilityId && sv.facility_ids.includes(r.facilityId) ? r.facilityId : def, dept: r.department ?? '' }));
      const problems: string[] = [];
      if (b.text) {
        for (const r of csvRows(b.text)) {
          const [name = '', email = '', fac = '', dept = ''] = r.map((x) => x.trim());
          if (!name || /^name$/i.test(name)) continue;
          if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { problems.push(`${name}: "${email}" is not an email address`); continue; }
          const f = fac ? facOf(fac) : def;
          if (fac && !f) problems.push(`${name}: facility "${fac}" is not in this survey; ${facs.find((x) => x.id === def)?.name} used`);
          list.push({ name, email: email.toLowerCase(), fac: f ?? def, dept });
        }
      }
      const have = new Set((await c.query('SELECT lower(email) AS e FROM survey_participant WHERE survey_id = $1 AND email IS NOT NULL', [id])).rows.map((r) => r.e as string));
      let added = 0, skipped = 0;
      for (const p of list) {
        if (p.email && have.has(p.email)) { skipped++; continue; }
        await c.query('INSERT INTO survey_participant (tenant_id, survey_id, name, email, facility_id, department, code) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [tenant, id, p.name, p.email || null, p.fac, p.dept || null, await freshCode()]);
        if (p.email) have.add(p.email);
        added++;
      }
      await audit(c, req, 'survey.people', 'survey', id, { added, skipped });
      return { added, skipped, problems: problems.slice(0, 50) };
    });
  });

  app.delete('/api/surveys/:id/participants/:pid', async (req) => {
    const tenant = requireTenant(req);
    const { id, pid } = z.object({ id: z.string().uuid(), pid: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      if ((await c.query('SELECT 1 FROM survey_response WHERE participant_id = $1', [pid])).rowCount) throw new AppError('This person has answered: they stay on the list');
      await c.query('DELETE FROM survey_participant WHERE id = $1 AND survey_id = $2', [pid, id]);
      return { ok: true };
    });
  });

  /** Invitations sent (from the person's mail app, a copied text or a mail merge). */
  app.post('/api/surveys/:id/sent', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ ids: z.array(z.string().uuid()).max(20000) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      const n = (await c.query('UPDATE survey_participant SET sent_at = now() WHERE survey_id = $1 AND id = ANY($2)', [id, b.ids])).rowCount ?? 0;
      return { marked: n };
    });
  });

  app.get('/api/surveys/:id/invitations', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const only = z.object({ unanswered: z.enum(['1']).optional() }).parse(req.query).unanswered === '1';
    const { sv, people, company } = await tenantTx(tenant, async (c) => {
      const s = await loadSurvey(c, id);
      await guard(c, req, s, true);
      return { sv: s, people: (await c.query(`${PEOPLE_SQL} WHERE p.survey_id = $1 ${only ? 'AND r.id IS NULL' : ''} ORDER BY f.name, p.name`, [id])).rows, company: (await tenantSettings(tenant)).name };
    });
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['name', 'email', 'facility', 'department', 'code', 'link', 'invitation'], ...people.map((p) => [p.name, p.email, p.facility, p.department, p.code, linkFor(req, p.code), inviteText(sv, p, company, linkFor(req, p.code))])];
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${sv.name.replace(/[^a-z0-9]+/gi, '_')}_invitations.csv"`)
      .send('﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n'));
  });

  /** An admin types in an employee's paper / phone answers. */
  app.put('/api/surveys/:id/participants/:pid/answer', async (req) => {
    const tenant = requireTenant(req);
    const { id, pid } = z.object({ id: z.string().uuid(), pid: z.string().uuid() }).parse(req.params);
    const b = z.object({ facilityId: z.string().uuid(), answers: answerSchema }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      if (sv.status === 'published') throw new AppError('Published: reopen the survey to change answers');
      if (!sv.facility_ids.includes(b.facilityId)) throw new AppError('That facility is not in this survey');
      const p = (await c.query('SELECT id FROM survey_participant WHERE id = $1 AND survey_id = $2', [pid, id])).rows[0];
      if (!p) throw notFound('Person');
      await c.query(`INSERT INTO survey_response (tenant_id, survey_id, participant_id, facility_id, answers, entered_by) VALUES ($1,$2,$3,$4,$5,$6)
                     ON CONFLICT (participant_id) DO UPDATE SET facility_id = EXCLUDED.facility_id, answers = EXCLUDED.answers, entered_by = EXCLUDED.entered_by, updated_at = now()`,
        [tenant, id, pid, b.facilityId, JSON.stringify(b.answers), req.user.id]);
      await audit(c, req, 'survey.answer_on_behalf', 'survey', id, { participant: pid });
      const f = await unitFactors(c, tenant, sv.year, ALL_ITEMS);
      return { kg: personYear(b.answers, sv, f).kg };
    });
  });

  /** Publish into Scope 3 · Employee commuting: each facility's commuting record for the year. */
  app.post('/api/surveys/:id/publish', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const dry = z.object({ dryRun: z.boolean().default(false) }).parse(req.body ?? {}).dryRun;
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      const s = await guard(c, req, sv, false);
      const resps = (await c.query('SELECT id, participant_id, facility_id, answers FROM survey_response WHERE survey_id = $1 ORDER BY created_at', [id])).rows as Resp[];
      if (!resps.length) throw new AppError('No answers yet');
      const res = await surveyResults(c, tenant, sv);
      const existing = new Map((await c.query(`SELECT r.facility_id, r.method, r.survey_id, (SELECT count(*)::int FROM activity a WHERE a.commute_record_id = r.id AND a.status = 'approved') AS approved
                                                 FROM commute_record r WHERE r.year = $1 AND r.facility_id = ANY($2)`, [sv.year, sv.facility_ids])).rows.map((r) => [r.facility_id, r]));
      const st = settingsOf(sv);
      const out: { facilityId: string; name: string; t: number; entries?: number; status: 'ok' | 'skipped'; reason?: string; replaces?: string | null }[] = [];
      for (const x of res.facs as { id: string; name: string; N: number; n: number; t: number; useG: boolean }[]) {
        const ex = existing.get(x.id);
        const replaces = ex ? (ex.survey_id === id ? 'this survey (earlier publish)' : ex.method === 'survey' ? 'a survey file uploaded in Add data' : 'figures typed in under Add data') : null;
        if (!s.enter.has(x.id)) { out.push({ facilityId: x.id, name: x.name, t: x.t, status: 'skipped', reason: 'no access to enter data', replaces }); continue; }
        if (ex?.approved) { out.push({ facilityId: x.id, name: x.name, t: x.t, status: 'skipped', reason: `${ex.approved} monthly entries already approved`, replaces }); continue; }
        if (!x.N) { out.push({ facilityId: x.id, name: x.name, t: 0, status: 'skipped', reason: 'headcount is 0', replaces }); continue; }
        if (dry) { out.push({ facilityId: x.id, name: x.name, t: x.t, status: 'ok', replaces }); continue; }
        const src = resps.filter((r) => r.facility_id === x.id);
        const use = src.length ? src : resps;
        const body: CommuteBody = {
          facilityId: x.id, year: sv.year, method: 'survey', headcount: x.N, workingDays: st.workingDays, weekend: 'sat_sun', homeworking: sv.wfh,
          rows: [], answers: use.map((r, i) => ({ row: i + 1, ...toEngine(r.answers, sv.wfh) })) as CommuteBody['answers'],
          survey: { file: `Ekotrace survey: ${sv.name}`, site: null }, note: `${src.length} of ${x.N} employees answered${src.length ? '' : ' (no answers here: company average used)'}`,
        };
        await c.query('SAVEPOINT pub');
        try {
          const r = await saveCommute(c, req, body, { surveyId: id });
          await c.query('RELEASE SAVEPOINT pub');
          out.push({ facilityId: x.id, name: x.name, t: r.kg / 1000, entries: r.entries, status: 'ok', replaces });
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT pub');
          out.push({ facilityId: x.id, name: x.name, t: x.t, status: 'skipped', reason: (e as Error).message, replaces });
        }
      }
      if (!dry) {
        const ok = out.filter((o) => o.status === 'ok');
        if (ok.length) await c.query(`UPDATE survey SET status = 'published', published_at = now(), published_by = $2, published = $3 WHERE id = $1`, [id, req.user.id, JSON.stringify(out)]);
        await audit(c, req, 'survey.publish', 'survey', id, { facilities: ok.length, skipped: out.length - ok.length, t: ok.reduce((a, o) => a + o.t, 0) });
      }
      return { dryRun: dry, facilities: out };
    });
  });

  /** Reopen a published survey (answers can change; publish again replaces the commuting records). */
  app.post('/api/surveys/:id/reopen', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const sv = await loadSurvey(c, id);
      await guard(c, req, sv, true);
      await c.query(`UPDATE survey SET status = 'open' WHERE id = $1`, [id]);
      await audit(c, req, 'survey.reopen', 'survey', id, { name: sv.name });
      return { ok: true };
    });
  });
}

// ------------------------------------------------------------------ public: answering --
const hits = new Map<string, { at: number; n: number }>();
function limit(key: string, max: number) {
  const now = Date.now(), w = hits.get(key);
  if (!w || now - w.at > 60_000) { hits.set(key, { at: now, n: 1 }); return; }
  if (++w.n > max) throw new AppError('Too many tries: wait a minute and try again', 429, 'RATE_LIMITED');
}
const codeSchema = z.string().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().length(8, 'Enter the 8-character code from your invitation'));

async function byCode(code: string) {
  return platformTx(async (c) => {
    const p = (await c.query(`SELECT p.id, p.name, p.facility_id, p.tenant_id, s.id AS survey_id FROM survey_participant p JOIN survey s ON s.id = p.survey_id WHERE p.code = $1`, [code])).rows[0];
    if (!p) throw new AppError('That code isn’t recognised. Check your invitation.', 404, 'NOT_FOUND');
    const sv = (await c.query('SELECT * FROM survey WHERE id = $1', [p.survey_id])).rows[0] as SurveyRow;
    if (sv.status !== 'open') throw new AppError(sv.status === 'draft' ? 'This survey hasn’t opened yet.' : 'This survey is closed. Thank you!', 409, 'CLOSED');
    const company = (await c.query('SELECT name FROM tenant WHERE id = $1', [p.tenant_id])).rows[0]?.name ?? '';
    const facilities = (await c.query('SELECT id, name FROM org_node WHERE id = ANY($1) ORDER BY name', [sv.facility_ids])).rows;
    const prev = (await c.query('SELECT facility_id, answers FROM survey_response WHERE participant_id = $1', [p.id])).rows[0] ?? null;
    return { p, sv, company, facilities, prev };
  });
}

export async function surveyPublicRoutes(app: FastifyInstance) {
  app.post('/api/public/survey/lookup', async (req) => {
    limit(`lookup:${req.ip}`, 20);
    const code = codeSchema.parse((req.body as { code?: string })?.code ?? '');
    const { p, sv, company, facilities, prev } = await byCode(code);
    return {
      company, survey: { name: sv.name, year: sv.year, wfh: sv.wfh, closeAt: sv.close_at }, firstName: String(p.name).split(' ')[0], facilities,
      facilityId: prev?.facility_id ?? p.facility_id, answers: prev?.answers ?? null,
      modes: SURVEY_MODES.map(([key, label]) => ({ key, label })), fuels: SURVEY_FUELS.map(([key, label]) => ({ key, label })),
    };
  });

  app.put('/api/public/survey', async (req) => {
    limit(`answer:${req.ip}`, 30);
    const b = z.object({ code: codeSchema, facilityId: z.string().uuid(), answers: answerSchema }).parse(req.body);
    const { p, sv } = await byCode(b.code);
    if (!sv.facility_ids.includes(b.facilityId)) throw new AppError('Choose one of the sites listed');
    return platformTx(async (c) => {
      await c.query(`INSERT INTO survey_response (tenant_id, survey_id, participant_id, facility_id, answers) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (participant_id) DO UPDATE SET facility_id = EXCLUDED.facility_id, answers = EXCLUDED.answers, entered_by = NULL, updated_at = now()`,
        [p.tenant_id, sv.id, p.id, b.facilityId, JSON.stringify(b.answers)]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1, NULL, 'survey respondent', 'survey.answer', 'survey', $2, $3, $4)`,
        [p.tenant_id, sv.id, JSON.stringify({ participant: p.id }), req.ip]);
      const f = await unitFactors(c, p.tenant_id, sv.year, ALL_ITEMS);
      return { ok: true, kg: Math.round(personYear(b.answers, sv, f).kg) };
    });
  });
}
