/**
 * Compliance Position Desk (package 'compliance'): which regulations apply, their obligations and deadlines, status.
 *
 *   GET    /api/compliance?year=           regulations with applicability and reason; obligations due in the year (and
 *                                          earlier ones still open) with status — set by people, or read from the
 *                                          modules (BRSR, UAE MRV, CBAM); the company's own obligations; profile
 *   PUT    /api/compliance/profile         the facts that decide applicability (super admin, admin)
 *   PUT    /api/compliance/status          an obligation's status, owner, note, evidence, completed on, date moved (super admin, admin, manager)
 *   POST   /api/compliance/custom          the company's own obligation; PUT / DELETE /api/compliance/custom/:id (super admin, admin, manager)
 *   GET    /api/compliance/export?year=    Excel: register and calendar
 *   GET    /api/compliance/calendar.ics?year=   the deadlines as calendar events
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { PRODUCT, PRODUCT_SLUG } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { needProduct, productsOf } from '../lib/products.js';
import { DEFAULT_PROFILE, REGULATION, REGULATIONS, effective, instances, sameDay, type Applies, type Profile, type Status } from '../lib/compliance.js';

const uuid = z.string().uuid();
const YEAR = z.coerce.number().int().min(2020).max(2100);
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const date = z.string().regex(/^(20\d\d|2100)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Not a date');
const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);
const canSetup = (req: FastifyRequest) => ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
/** Today in the company's time zone. */
async function todayOf(c: Tx, tenant: string) {
  const tz = ((await c.query(`SELECT timezone FROM tenant WHERE id = $1`, [tenant])).rows[0]?.timezone as string) || 'UTC';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); }
}

const profileBody = z.object({
  fyEndMonth: z.number().int().min(1).max(12), countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(60).transform((v) => [...new Set(v)]),
  employees: z.number().int().min(0).max(1e7).nullable(), turnoverEur: z.number().min(0).max(1e13).nullable(), euTurnoverEur: z.number().min(0).max(1e13).nullable(),
  euSubsidiaryTurnoverEur: z.number().min(0).max(1e13).nullable(), euEntity: z.boolean(),
  listed: z.enum(['none', 'india', 'sgx', 'asx', 'lse', 'eu', 'other']), sgxSti: z.boolean(), sgxCapOver1bn: z.boolean(),
  indiaTop: z.enum(['top150', 'top250', 'top500', 'top1000', 'listed_other', 'none']), cctsObligated: z.boolean().nullable(),
  cbamImportTonnes: z.number().min(0).max(1e9).nullable(), cbamExporter: z.boolean().nullable(),
  uaeDesignated: z.enum(['yes', 'no', 'unknown']), uaeScope12: z.number().min(0).max(1e10).nullable(), eadFacility: z.boolean().nullable(),
  usRevenueUsd: z.number().min(0).max(1e13).nullable(), californiaBusiness: z.boolean(), auGroup: z.enum(['group1', 'group2', 'group3', 'none']), ukQuoted: z.boolean(), ukLarge: z.boolean(),
});

const hasTable = async (c: Tx, t: string) => !!(await c.query(`SELECT to_regclass($1) AS t`, [t])).rows[0].t;
/** Facts the other modules already know, used where the profile leaves them empty. */
async function facts(c: Tx, tenant: string, products: string[]) {
  const t = (await c.query(`SELECT country FROM tenant WHERE id = $1`, [tenant])).rows[0];
  const cs = new Set<string>([t.country, ...(await c.query(`SELECT DISTINCT country FROM org_node WHERE kind = 'facility' AND active AND country IS NOT NULL`)).rows.map((r) => r.country as string)]);
  if ([...cs].some((x) => EU.has(x))) cs.add('EU');
  const f: Partial<Profile> & { sources: Record<string, string> } = { countries: [...cs].sort(), sources: { countries: 'Company and facility countries' } };
  if (products.includes('ccts') && await hasTable(c, 'ccts_entity')) { const n = Number((await c.query(`SELECT count(*)::int AS n FROM ccts_entity`)).rows[0].n); if (n) { f.cctsObligated = true; f.sources.cctsObligated = `${n} obligated ${n === 1 ? 'entity' : 'entities'} in India CCTS`; } }
  if ((products.includes('cbam') || products.includes('ekotrace')) && await hasTable(c, 'cbam_import')) {
    // goods counted for the 50-tonne threshold: electricity (2716, in MWh) and hydrogen (2804 10 00) are outside it; the last full year when there is one
    const thisYear = new Date().getUTCFullYear();
    const r = (await c.query(`SELECT year, sum(mass)::float8 AS t FROM cbam_import WHERE cn NOT LIKE '2716%' AND cn NOT LIKE '280410%' GROUP BY year ORDER BY (year < $1) DESC, year DESC LIMIT 1`, [thisYear])).rows[0];
    if (r) { f.cbamImportTonnes = r.t; f.sources.cbamImportTonnes = `CBAM imports ${r.year}${r.year >= thisYear ? ' (year to date)' : ''}`; }
    if (Number((await c.query(`SELECT count(*)::int AS n FROM cbam_communication WHERE status IN ('final', 'sent')`)).rows[0].n)) { f.cbamExporter = true; f.sources.cbamExporter = 'CBAM communications to importers'; }
  }
  if (products.includes('uaemrv') && await hasTable(c, 'mrv_facility')) {
    if ((await c.query(`SELECT 1 FROM mrv_facility WHERE emirate = 'AZ' AND sector <> 'other' LIMIT 1`)).rowCount) { f.eadFacility = true; f.sources.eadFacility = 'Abu Dhabi facility in a covered sector in UAE MRV (threshold not checked)'; }
    const y = (await c.query(`SELECT designated, s1_typed, s2_typed, year FROM mrv_company_year ORDER BY year DESC LIMIT 1`)).rows[0];
    if (y && y.designated !== 'unknown') { f.uaeDesignated = y.designated; f.sources.uaeDesignated = `UAE MRV federal position ${y.year}`; }
  }
  return f;
}
/** Profile in effect: what people set, then what the modules know, then the defaults. */
function merge(stored: Partial<Profile>, f: Partial<Profile>): Profile {
  const p: Profile = { ...DEFAULT_PROFILE };
  for (const k of Object.keys(DEFAULT_PROFILE) as (keyof Profile)[]) {
    const sv = stored[k], fv = f[k];
    const empty = (v: unknown) => v == null || (Array.isArray(v) && !v.length) || v === 'unknown';
    (p as any)[k] = !empty(sv) ? sv : !empty(fv) ? fv : DEFAULT_PROFILE[k];
  }
  if (stored.countries?.length) p.countries = [...new Set([...stored.countries, ...(f.countries ?? [])])].sort();
  return p;
}

/** Status read from the modules for an obligation instance (null when the module cannot tell). */
async function auto(c: Tx, products: string[], reg: string, ob: string, period: number): Promise<{ status: Status; note: string } | null> {
  if (reg === 'in_brsr' && products.includes('brsr') && await hasTable(c, 'brsr_report')) {
    const r = (await c.query(`SELECT status, provider, approach FROM brsr_report WHERE fy = $1`, [period - 1])).rows[0];
    if (!r) return null;
    if (ob === 'brsr') return r.status === 'final' ? { status: 'done', note: 'BRSR Core year marked final' } : { status: 'in_progress', note: `BRSR Core year in ${r.status}` };
    if (ob === 'core_assurance') return r.provider ? { status: 'in_progress', note: `Provider: ${r.provider} (${r.approach})` } : null;
  }
  if (reg === 'ae_federal' && ob === 'ieqt' && products.includes('uaemrv') && await hasTable(c, 'mrv_company_year')) {
    const r = (await c.query(`SELECT ieqt_status, ieqt_submitted FROM mrv_company_year WHERE year = $1`, [period])).rows[0];
    if (!r || r.ieqt_status === 'not_started') return null;
    return ['submitted', 'verified'].includes(r.ieqt_status) ? { status: 'done', note: `IEQT ${r.ieqt_status}${r.ieqt_submitted ? ` ${iso(r.ieqt_submitted)}` : ''}` } : { status: 'in_progress', note: `IEQT: ${r.ieqt_status}` };
  }
  if (reg === 'ae_ead' && products.includes('uaemrv') && await hasTable(c, 'mrv_year')) {
    const rows = (await c.query(`SELECT f.name, y.status, y.verif_notified, f.mp_submitted FROM mrv_facility f LEFT JOIN mrv_year y ON y.facility_id = f.id AND y.year = $1 WHERE f.emirate = 'AZ' AND f.sector <> 'other'`, [period])).rows;
    if (!rows.length) return null;
    if (ob === 'report') { const done = rows.filter((r) => ['submitted', 'verified'].includes(r.status)).length; return done === rows.length ? { status: 'done', note: `All ${rows.length} Abu Dhabi facility reports submitted` } : rows.some((r) => r.status) ? { status: 'in_progress', note: `${done} of ${rows.length} facility reports submitted` } : null; }
    if (ob === 'notify') { const n = rows.filter((r) => r.verif_notified).length; return n === rows.length ? { status: 'done', note: 'Verification notified for every facility' } : n ? { status: 'in_progress', note: `${n} of ${rows.length} notified` } : null; }
    if (ob === 'registration') { const n = rows.filter((r) => r.mp_submitted && iso(r.mp_submitted)! >= `${period - 1}-04-01` && iso(r.mp_submitted)! <= `${period}-03-31`).length; return n === rows.length ? { status: 'done', note: 'Monitoring plans submitted for every facility' } : n ? { status: 'in_progress', note: `${n} of ${rows.length} monitoring plans` } : null; }
  }
  if (reg === 'in_ccts' && products.includes('ccts') && await hasTable(c, 'ccts_month')) {
    if (ob === 'form_a') { const n = Number((await c.query(`SELECT count(*)::int AS n FROM ccts_month WHERE month >= $1 AND month <= $2`, [`${period - 1}-04-01`, `${period}-03-01`])).rows[0].n); return n ? { status: 'in_progress', note: `${n} entity-months entered` } : null; }
  }
  return null;
}

type Row = {
  reg: string; obligation: string; period: number; label: string; title: string; detail: string; due: string | null; dueNote: string | null; moved: boolean;
  status: Status; setStatus: Status | null; source: 'set' | 'module' | 'none'; autoStatus: Status | null; autoNote: string | null; owner: string | null; note: string;
  documentId: string | null; doneOn: string | null; penalty: string | null; module: { route: string; label: string } | null; voluntary: boolean; applies: Applies; updatedName: string | null;
  custom?: { id: string; regulation: string; jurisdiction: string; recurrence: 'once' | 'annual'; firstDue: string; owner: string | null };
};
async function load(c: Tx, tenant: string, year: number) {
  const products = await productsOf(c, tenant);
  const stored = ((await c.query(`SELECT data FROM cp_profile WHERE tenant_id = $1`, [tenant])).rows[0]?.data ?? {}) as Partial<Profile>;
  const f = await facts(c, tenant, products);
  const profile = merge(stored, f);
  const today = await todayOf(c, tenant);
  const regs = REGULATIONS.map((r) => ({ code: r.code, ...r.applies(profile) }));
  const statuses = new Map((await c.query(`SELECT * FROM cp_status`)).rows.map((r) => [`${r.reg}|${r.obligation}|${r.period}`, r]));
  const all = instances(profile, regs, year - 2, year + 2);
  const every = [];   // every instance in reach (for the 90-day window), then those shown for the year
  for (const it of all) {
    const st = statuses.get(`${it.reg}|${it.obligation}|${it.period}`);
    const due = st?.due_override ? iso(st.due_override) : it.due;
    const a = await auto(c, products, it.reg, it.obligation, it.period);
    const R = REGULATION.get(it.reg)!, O = R.obligations.find((o) => o.code === it.obligation)!;
    const applies = regs.find((r) => r.code === it.reg)!.applies;
    // a regulation that may apply, or a recommended step, is never overdue: it is open until settled
    const status = effective((st?.status ?? a?.status ?? null) as Status | null, applies === 'applies' && !O.voluntary ? due : null, today);
    every.push({
      reg: it.reg, obligation: it.obligation, period: it.period, label: it.label, title: O.title, detail: O.detail, due, dueNote: it.dueNote, moved: !!st?.due_override,
      status, setStatus: (st?.status ?? null) as Status | null, source: st?.status ? 'set' : a ? 'module' : 'none', autoStatus: a?.status ?? null, autoNote: a?.note ?? null,
      owner: st?.owner ?? null, note: st?.note ?? '', documentId: st?.document_id ?? null, doneOn: iso(st?.done_on),
      penalty: O.penalty ?? null, module: O.module ?? null, voluntary: !!O.voluntary,
      applies, updatedName: st?.updated_name ?? null,
    } as Row);
  }
  // the company's own obligations: once, or every year on the same day (29 February → 28 February)
  const custom = (await c.query(`SELECT * FROM cp_custom ORDER BY due_date`)).rows;
  for (const x of custom) {
    const first = iso(x.due_date)!, y0 = Number(first.slice(0, 4));
    const periods = x.recurrence === 'annual' ? [year - 1, year, year + 1].filter((y) => y >= y0) : [y0];
    for (const period of periods) {
      const st = statuses.get(`custom:${x.id}|-|${period}`);
      const due = st?.due_override ? iso(st.due_override)! : x.recurrence === 'annual' ? sameDay(first, period) : first;
      every.push({ reg: `custom:${x.id}`, obligation: '-', period, label: x.recurrence === 'annual' ? String(period) : 'once', title: x.title, detail: x.detail, due, dueNote: null, moved: !!st?.due_override,
        status: effective((st?.status ?? null) as Status | null, due, today), setStatus: (st?.status ?? null) as Status | null, source: st?.status ? 'set' : 'none', autoStatus: null, autoNote: null,
        owner: st?.owner ?? x.owner, note: st?.note ?? '', documentId: st?.document_id ?? null, doneOn: iso(st?.done_on), penalty: null, module: null, voluntary: false, applies: 'applies', updatedName: st?.updated_name ?? null,
        custom: { id: x.id, regulation: x.regulation, jurisdiction: x.jurisdiction, recurrence: x.recurrence, firstDue: first, owner: x.owner } });
    }
  }
  // shown for the year: due in it, or due the year before and still overdue (older gaps are history); undated ones in their period's year
  const rows = every.filter((r) => { const dy = r.due ? Number(r.due.slice(0, 4)) : r.period; return dy === year || (dy === year - 1 && r.status === 'overdue') || (r.due == null && r.period === year); });
  const in90 = new Date(`${today}T00:00:00Z`); in90.setUTCDate(in90.getUTCDate() + 90);
  const upcoming = every.filter((x) => x.due && x.due >= today && x.due <= in90.toISOString().slice(0, 10) && x.status !== 'done' && x.status !== 'not_applicable').sort((a, b) => a.due!.localeCompare(b.due!));
  rows.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title));
  return { profile, stored, facts: f, regs, rows, upcoming, today, products };
}

export async function complianceRoutes(app: FastifyInstance) {
  needProduct(app, 'compliance');

  app.get('/api/compliance', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const today = await todayOf(c, tenant);
      const year = z.object({ year: YEAR.optional() }).parse(req.query).year ?? Number(today.slice(0, 4));
      const d = await load(c, tenant, year);
      const regs = d.regs.map((r) => {
        const R = REGULATION.get(r.code)!;
        const mine = d.rows.filter((x) => x.reg === r.code);
        return { code: r.code, name: R.name, jurisdiction: R.jurisdiction, authority: R.authority, source: R.source, summary: R.summary, applies: r.applies, reason: r.reason,
          counts: { total: mine.length, done: mine.filter((x) => x.status === 'done').length, overdue: mine.filter((x) => x.status === 'overdue').length, open: mine.filter((x) => x.status === 'not_started' || x.status === 'in_progress').length } };
      });
      return {
        year, today: d.today, profile: d.profile, stored: d.stored, facts: d.facts, regulations: regs, obligations: d.rows,
        upcoming: d.upcoming,
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 300`)).rows,
        products: d.products, canSetup: canSetup(req), canEdit: canEdit(req),
      };
    });
  });

  app.put('/api/compliance/profile', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = profileBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`INSERT INTO cp_profile (tenant_id, data, updated_name) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET data = $2, updated_name = $3, updated_at = now()`, [tenant, JSON.stringify(b), req.user.name]);
      await audit(c, req, 'compliance.profile', 'tenant', tenant, b);
      return { ok: true };
    });
  });

  app.put('/api/compliance/status', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = z.object({
      reg: z.string().regex(/^[a-z0-9_:-]{2,60}$/), obligation: z.string().regex(/^[a-z0-9_-]{1,40}$/), period: z.number().int().min(2000).max(2100),
      status: z.enum(['not_started', 'in_progress', 'done', 'not_applicable']).nullable(), owner: z.string().trim().max(120).nullable().default(null), note: z.string().trim().max(2000).default(''),
      documentId: uuid.nullable().default(null), doneOn: date.nullable().default(null), dueOverride: date.nullable().default(null),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.reg.startsWith('custom:')) { if (b.obligation !== '-' || !uuid.safeParse(b.reg.slice(7)).success || !(await c.query(`SELECT 1 FROM cp_custom WHERE id = $1`, [b.reg.slice(7)])).rowCount) throw notFound('Obligation'); }
      else if (!REGULATION.get(b.reg)?.obligations.some((o) => o.code === b.obligation)) throw notFound('Obligation');
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
      if (b.status === 'done' && !b.doneOn) throw new AppError('Give the date it was completed');
      if (b.status === 'not_applicable' && !b.note) throw new AppError('Say why it does not apply');
      if (b.dueOverride && !b.note) throw new AppError('Say why the date moved (e.g. an extension granted)');
      if (b.status == null && !b.owner && !b.note && !b.documentId && !b.dueOverride) {
        await c.query(`DELETE FROM cp_status WHERE reg = $1 AND obligation = $2 AND period = $3`, [b.reg, b.obligation, b.period]);   // nothing left: as the module says
      } else {
        await c.query(`INSERT INTO cp_status (tenant_id, reg, obligation, period, status, owner, note, document_id, done_on, due_override, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (tenant_id, reg, obligation, period) DO UPDATE SET status=$5, owner=$6, note=$7, document_id=$8, done_on=$9, due_override=$10, updated_name=$11, updated_at=now()`,
          [tenant, b.reg, b.obligation, b.period, b.status, b.owner || null, b.note, b.documentId, b.status === 'done' ? b.doneOn : null, b.dueOverride, req.user.name]);
      }
      await audit(c, req, 'compliance.status', 'cp_status', null, b);
      return { ok: true };
    });
  });

  const customBody = z.object({
    title: z.string().trim().min(2).max(300), regulation: z.string().trim().max(300).default(''), jurisdiction: z.string().trim().max(80).default(''), dueDate: date,
    recurrence: z.enum(['once', 'annual']).default('once'), owner: z.string().trim().max(120).nullable().default(null), detail: z.string().trim().max(2000).default(''),
  });
  app.post('/api/compliance/custom', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = customBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO cp_custom (tenant_id, title, regulation, jurisdiction, due_date, recurrence, owner, detail, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, b.title, b.regulation, b.jurisdiction, b.dueDate, b.recurrence, b.owner || null, b.detail, req.user.name])).rows[0];
      await audit(c, req, 'compliance.custom.create', 'cp_custom', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/compliance/custom/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = uuid.parse((req.params as { id: string }).id), b = customBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const old = (await c.query(`SELECT due_date, recurrence FROM cp_custom WHERE id = $1`, [id])).rows[0];
      if (!old) throw notFound('Obligation');
      const oldYear = Number(iso(old.due_date)!.slice(0, 4)), newYear = Number(b.dueDate.slice(0, 4));
      if (old.recurrence === 'once' && b.recurrence === 'once' && oldYear !== newYear) await c.query(`UPDATE cp_status SET period = $3 WHERE reg = $1 AND period = $2`, [`custom:${id}`, oldYear, newYear]);
      const r = await c.query(`UPDATE cp_custom SET title=$2, regulation=$3, jurisdiction=$4, due_date=$5, recurrence=$6, owner=$7, detail=$8 WHERE id = $1`, [id, b.title, b.regulation, b.jurisdiction, b.dueDate, b.recurrence, b.owner || null, b.detail]);
      if (!r.rowCount) throw notFound('Obligation');
      await audit(c, req, 'compliance.custom.update', 'cp_custom', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/compliance/custom/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM cp_custom WHERE id = $1 RETURNING title`, [id]);
      if (!r.rowCount) throw notFound('Obligation');
      await c.query(`DELETE FROM cp_status WHERE reg = $1`, [`custom:${id}`]);
      await audit(c, req, 'compliance.custom.delete', 'cp_custom', id, { title: r.rows[0].title });
      return { ok: true };
    });
  });

  app.get('/api/compliance/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: YEAR }).parse(req.query).year;
    const d = await tenantTx(tenant, async (c) => { const x = await load(c, tenant, year); const name = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string; await audit(c, req, 'compliance.export', 'tenant', tenant, { year }); return { ...x, name }; });
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const rg = wb.addWorksheet('Regulations');
    rg.addRow(['Regulation', 'Jurisdiction', 'Authority', 'Applies', 'Why', 'Summary', 'Source']);
    styleHeader(rg, [44, 18, 30, 14, 60, 80, 50]);
    for (const r of d.regs) { const R = REGULATION.get(r.code)!; rg.addRow([R.name, R.jurisdiction, R.authority, r.applies.replace('_', ' '), r.reason, R.summary, R.source]); }
    const ob = wb.addWorksheet(`Obligations ${year}`);
    ob.addRow(['Due', 'Regulation', 'Obligation', 'Period', 'Status', 'Owner', 'Completed', 'Note', 'Due note', 'Penalty']);
    styleHeader(ob, [12, 36, 50, 12, 14, 18, 12, 40, 40, 40]);
    for (const x of d.rows) ob.addRow([x.due ?? 'not set', REGULATION.get(x.reg)?.name ?? `Own: ${(x as any).custom?.regulation || '—'}`, x.title, x.label, x.status.replace('_', ' '), x.owner, x.doneOn, x.note || x.autoNote || '', x.dueNote, x.penalty]);
    const mt = wb.addWorksheet('Method'); mt.getColumn(1).width = 140;
    for (const line of [
      `${d.name} — compliance position for ${year}, prepared in ${PRODUCT} on ${d.today}.`,
      'Applicability from the company profile and the facts recorded in the other modules (countries of facilities, CCTS entities, CBAM imports and communications, UAE MRV facilities and federal position).',
      'Obligations due in the year, plus those of the year before still open (overdue). Status as set by people, otherwise as read from the module (BRSR, UAE MRV, CCTS). Dates as published by each authority (checked October 2026); where an authority has not set a date, it says so.',
      'This register is a working tool, not legal advice: confirm applicability and dates with counsel and the authorities.',
    ]) mt.addRow([line]);
    return sendWorkbook(reply, wb, `Compliance_${year}.xlsx`);
  });

  app.get('/api/compliance/calendar.ics', async (req, reply) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: YEAR }).parse(req.query).year;
    const d = await tenantTx(tenant, (c) => load(c, tenant, year));
    const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
    // RFC 5545: lines longer than 75 octets folded with CRLF + space, without splitting a UTF-8 character
    const fold = (line: string) => { const out: string[] = []; let cur = '', n = 0; for (const ch of line) { const b = Buffer.byteLength(ch); if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; } cur += ch; n += b; } out.push(cur); return out.join('\r\n '); };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${PRODUCT}//Compliance desk//EN`, 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(`${PRODUCT} compliance ${year}`)}`];
    for (const x of d.rows) {
      if (!x.due || x.status === 'done' || x.status === 'not_applicable') continue;
      const day = x.due.replace(/-/g, ''), next = new Date(`${x.due}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      lines.push('BEGIN:VEVENT', `UID:${tenant}-${x.reg.replace(':', '-')}-${x.obligation}-${x.period}@${PRODUCT_SLUG}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
        `SUMMARY:${esc(`${x.title} (${x.label})`)}`, `DESCRIPTION:${esc(`${REGULATION.get(x.reg)?.name ?? 'Own obligation'}. ${x.detail}${x.dueNote ? ` ${x.dueNote}.` : ''}`)}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', `attachment; filename="compliance_${year}.ics"`).send(`${lines.map(fold).join('\r\n')}\r\n`);
  });
}
