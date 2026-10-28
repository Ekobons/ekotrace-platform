/**
 * UAE MRV (package 'uaemrv'): Abu Dhabi facility MRV (EAD) and federal reporting (MOCCAE, national MRV system).
 *
 *   GET    /api/uae-mrv?year=                         overview: federal position, facilities with the year's result, calendar
 *   PUT    /api/uae-mrv/company/:year                 federal settings: designation, NRCC, IEQT submission, verifier (super admin, admin)
 *   POST   /api/uae-mrv/facilities                    add a reporting facility (super admin, admin); PUT / DELETE /api/uae-mrv/facilities/:id
 *   GET    /api/uae-mrv/facilities/:id?year=          the facility's year: streams with results, classes, tiers, checks, measures
 *   PUT    /api/uae-mrv/facilities/:id/years/:year    status, production, data gaps, QA, verification (status: super admin, admin)
 *   PUT    /api/uae-mrv/facilities/:id/years/:year/streams        all source streams of the year (super admin, admin, manager, preparer)
 *   POST   /api/uae-mrv/facilities/:id/years/:year/from-entries   fill / refresh streams from the approved inventory entries
 *   POST   /api/uae-mrv/measures                      mitigation measure (facility or company); PUT / DELETE /api/uae-mrv/measures/:mid
 *   GET    /api/uae-mrv/facilities/:id/years/:year/export        Excel laid out as the EAD template's sheets (C1 … J)
 *   GET    /api/uae-mrv/company/:year/export          Excel pack for the national MRV system (IEQT): Scope 1 and 2, by emirate and gas
 *
 * With the GHG inventory, streams can be filled from approved entries of the linked facility (calendar year,
 * split by days, 100% — operational control) and the federal Scope 1 and 2 come from the entries of the UAE
 * facilities; without it, everything is typed.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { PRODUCT } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { hasEkotrace, needProduct } from '../lib/products.js';
import { refdata } from './refdata.js';
import { kwhOf } from './dashboard.routes.js';
import {
  EMIRATES, FUEL, FUELS, MAX_VERIFIER_YEARS, NRCC_THRESHOLD, EAD_THRESHOLD, EAD_VERIFICATION_FROM, SECTORS, TIERS, calendar, eadStatus, facility, federal, matchFuel,
  type Gwp, type Sector, type Stream,
} from '../lib/uaeMrv.js';

const uuid = z.string().uuid();
const YEAR = z.coerce.number().int().min(2020).max(2100);
const idOf = (req: FastifyRequest, k = 'id') => uuid.parse((req.params as Record<string, string>)[k]);
const yearOf = (req: FastifyRequest) => YEAR.parse((req.params as { year: string }).year);
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const num = (x: unknown) => (x == null ? null : Number(x));
/** The last complete calendar year in the UAE. */
const lastYear = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(new Date())) - 1;
const canSetup = (req: FastifyRequest) => ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
const canData = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'preparer', 'platform_admin'].includes(req.user.role);
const LOCKED = new Set(['submitted', 'verified']);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null);
const txt = (max: number) => z.string().trim().max(max).nullable().default(null);

const facilityBody = z.object({
  name: z.string().trim().min(2).max(200), nodeId: uuid.nullable().default(null), emirate: z.enum(Object.keys(EMIRATES) as [string, ...string[]]),
  sector: z.enum(Object.keys(SECTORS) as [Sector, ...Sector[]]), subSector: txt(120), eadId: txt(80), permitNo: txt(80), operator: txt(200), address: txt(400),
  operationsStart: date, registeredOn: date, mpVersion: txt(40), mpSubmitted: date, mpChange: date, verifier: txt(200),
  verifierSince: z.number().int().min(2000).max(2100).nullable().default(null), notes: z.string().trim().max(4000).default(''),
});
const fnum = (max = 1e12) => z.number().min(-max).max(max).nullable().optional();
const streamBody = z.object({
  id: z.string().min(1).max(60), name: z.string().trim().min(1).max(200), kind: z.enum(['combustion', 'process', 'mass_balance', 'measured', 'gas']),
  fuel: z.string().refine((f) => FUEL.has(f), 'Unknown fuel').nullable().optional(), material: z.string().trim().max(200).nullable().optional(), mobile: z.boolean().optional(), fallback: z.boolean().optional(),
  adQty: z.number().min(0).max(1e12).nullable().optional(), adUnit: z.enum(['t', 'TJ', 'kNm3', 'kL']).optional(), density: z.number().positive().max(30).nullable().optional(), ncv: z.number().positive().max(10).nullable().optional(),
  ef: z.number().min(0).max(1000).nullable().optional(), of: z.number().min(0).max(1).nullable().optional(), carbon: z.number().min(0).max(1).nullable().optional(), direction: z.enum(['input', 'output']).optional(),
  biomass: z.number().min(0).max(1).nullable().optional(), ch4Ef: z.number().min(0).max(1e5).nullable().optional(), n2oEf: z.number().min(0).max(1e5).nullable().optional(),
  measuredCo2: fnum(), measuredCh4: z.number().min(0).max(1e12).nullable().optional(), gas: z.string().max(40).nullable().optional(), gasT: z.number().min(0).max(1e12).nullable().optional(),
  uncertainty: z.number().min(0).max(100).nullable().optional(), materiality: z.enum(['de_minimis', 'minor', 'major']).nullable().optional(),
  instrument: z.string().trim().max(300).optional(), efSource: z.string().trim().max(300).optional(), note: z.string().trim().max(2000).optional(), documentId: uuid.nullable().optional(),
  entryKey: z.string().max(80).nullable().optional(), entriesT: z.number().nullable().optional(), entries: z.number().int().nullable().optional(),
});
const measureBody = z.object({
  facilityId: uuid.nullable().default(null), title: z.string().trim().min(2).max(300),
  means: z.enum(['efficiency', 'clean_energy', 'sinks', 'ccus', 'fluorocarbons', 'offsetting', 'waste', 'fuel_switch', 'methane', 'other']),
  status: z.enum(['implemented', 'planned', 'studied']), startYear: z.number().int().min(2000).max(2100).nullable().default(null),
  tPerYear: z.number().min(0).max(1e9).nullable().default(null), capexAed: z.number().min(0).max(1e13).nullable().default(null), note: z.string().trim().max(2000).default(''),
});
export const MEANS: Record<string, string> = {
  efficiency: 'Energy efficiency', clean_energy: 'Clean / renewable energy', sinks: 'Natural carbon sinks', ccus: 'Carbon capture, use and storage', fluorocarbons: 'Alternatives to fluorocarbons',
  offsetting: 'Carbon offsetting (information only)', waste: 'Integrated waste management', fuel_switch: 'Fuel switching', methane: 'Methane leak and flaring reduction', other: 'Other',
};

const facilityView = (f: any) => ({
  id: f.id as string, name: f.name as string, nodeId: f.node_id as string | null, emirate: f.emirate as string, sector: f.sector as Sector, subSector: f.sub_sector, eadId: f.ead_id, permitNo: f.permit_no,
  operator: f.operator, address: f.address, operationsStart: iso(f.operations_start), registeredOn: iso(f.registered_on), mpVersion: f.mp_version, mpSubmitted: iso(f.mp_submitted), mpChange: iso(f.mp_change),
  verifier: f.verifier, verifierSince: f.verifier_since as number | null, notes: f.notes as string, updatedName: f.updated_name,
});
type FacilityV = ReturnType<typeof facilityView>;
const yearView = (y: any, year: number) => ({
  year, exists: !!y, status: (y?.status ?? 'draft') as 'draft' | 'ready' | 'submitted' | 'verified', submittedOn: iso(y?.submitted_on), reference: y?.reference ?? null,
  production: (y?.production ?? []) as { product: string; qty: number | null; unit: string }[], gaps: (y?.gaps ?? []) as { description: string; approach: string; t: number | null }[],
  qa: (y?.qa ?? '') as string, verifNotified: iso(y?.verif_notified), siteVisit: iso(y?.site_visit), verifiedOn: iso(y?.verified_on), opinion: y?.opinion ?? null, statementDoc: y?.statement_doc ?? null,
  updatedName: y?.updated_name ?? null, updatedAt: y?.updated_at ?? null,
});
const measureView = (m: any) => ({ id: m.id, facilityId: m.facility_id, title: m.title, means: m.means, status: m.status, startYear: m.start_year, tPerYear: num(m.t_per_year), capexAed: num(m.capex_aed), note: m.note, createdName: m.created_name });

async function gwpOf(c: Tx, tenant: string): Promise<{ set: string; gwp: Gwp }> {
  const set = ((await c.query(`SELECT gwp_set FROM tenant WHERE id = $1`, [tenant])).rows[0]?.gwp_set as string) ?? 'AR5';
  const gwp: Gwp = {};
  for (const r of (await c.query(`SELECT gas, value::float8 AS v FROM gwp_value WHERE gwp_set = $1`, [set])).rows) gwp[r.gas] = r.v;
  return { set, gwp };
}
async function getFacility(c: Tx, id: string) {
  const f = (await c.query(`SELECT * FROM mrv_facility WHERE id = $1`, [id])).rows[0];
  if (!f) throw notFound('Reporting facility');
  return facilityView(f);
}
async function streamsOf(c: Tx, id: string, year: number): Promise<Stream[]> {
  return (await c.query(`SELECT id, data, entry_key FROM mrv_stream WHERE facility_id = $1 AND year = $2 ORDER BY sort, id`, [id, year])).rows.map((r) => ({ ...(r.data as Stream), id: (r.data as Stream).id ?? r.id, entryKey: r.entry_key }));
}
async function yearRow(c: Tx, id: string, year: number) {
  return (await c.query(`SELECT * FROM mrv_year WHERE facility_id = $1 AND year = $2`, [id, year])).rows[0] ?? null;
}
async function ensureYear(c: Tx, tenant: string, id: string, year: number, who: string) {
  const y = await yearRow(c, id, year);
  if (y) return y;
  return (await c.query(`INSERT INTO mrv_year (tenant_id, facility_id, year, updated_name) VALUES ($1,$2,$3,$4) RETURNING *`, [tenant, id, year, who])).rows[0];
}
const lockedErr = (year: number) => new AppError(`The ${year} report is submitted: set it back to Ready (super admin, admin) before changing it`, 409, 'LOCKED');

/** Proposed source streams from the approved entries of one inventory facility in a calendar year. */
async function fromEntries(c: Tx, nodeId: string, year: number): Promise<Stream[]> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const SHARE = `((least(a.period_end, $3::date) - greatest(a.period_start, $2::date) + 1)::numeric / (a.period_end - a.period_start + 1))`;
  const rows = (await c.query(
    `SELECT cat.code AS cat, i.id AS iid, i.name AS item, sc.name AS sub, sc.is_bioenergy AS bio, a.unit, sum(a.quantity * ${SHARE})::float8 AS qty,
            sum(a.co2e_direct * ${SHARE})::float8 / 1000 AS t, count(*)::int AS n
       FROM activity a JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id JOIN subcategory sc ON sc.id = i.subcategory_id
      WHERE a.facility_id = $1 AND a.status = 'approved' AND a.period_start <= $3::date AND a.period_end >= $2::date
        AND cat.code IN ('stationary_combustion', 'mobile_combustion')
      GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 8 DESC`, [nodeId, from, to])).rows;
  const ref = await refdata();
  const units = new Map(ref.unitList.map((u) => [u.code, { dimension: u.dimension, to_base: Number(u.toBase) }]));
  const out: Stream[] = [];
  const merged = new Map<string, Stream>();
  for (const r of rows) {
    const mobile = r.cat === 'mobile_combustion';
    const kwh = await kwhOf(c, units, r.iid, `${r.item} ${r.sub}`, r.unit, r.qty, year, true);
    const f = matchFuel(`${r.item} ${r.sub}`, !!r.bio);
    const key = `item:${r.iid}`;
    const prev = merged.get(key);
    const tj = kwh == null ? null : Math.round(kwh * 3.6e-6 * 1e4) / 1e4;
    if (prev) { prev.adQty = Math.round(((prev.adQty ?? 0) + (tj ?? 0)) * 1e4) / 1e4; prev.entriesT = (prev.entriesT ?? 0) + r.t; prev.entries = (prev.entries ?? 0) + r.n; continue; }
    const s: Stream = {
      id: key, name: `${r.item}${mobile ? ' (fleet)' : ''}`, kind: 'combustion', fuel: f?.code ?? null, mobile, adQty: tj, adUnit: 'TJ',
      efSource: f ? `IPCC 2006 default for ${f.name}` : 'Choose the fuel or enter the emission factor', instrument: '', note: tj == null ? `No energy content for ${r.unit}: enter the activity data` : '',
      entryKey: key, entriesT: r.t, entries: r.n,
    };
    merged.set(key, s); out.push(s);
  }
  // fugitive and other gases released, by gas (Kyoto basket only)
  const gasRows = (await c.query(
    `SELECT r.gas, sum(r.kg_gas * ${SHARE})::float8 / 1000 AS t, sum(r.kg_co2e * ${SHARE})::float8 / 1000 AS co2e, count(DISTINCT a.id)::int AS n
       FROM activity a JOIN category cat ON cat.id = a.category_id JOIN activity_result r ON r.activity_id = a.id JOIN gas g ON g.code = r.gas
      WHERE a.facility_id = $1 AND a.status = 'approved' AND a.period_start <= $3::date AND a.period_end >= $2::date AND cat.code = 'fugitive' AND r.basis = 'direct' AND g.kyoto
      GROUP BY 1 HAVING sum(r.kg_gas) > 0 ORDER BY 3 DESC`, [nodeId, from, to])).rows;
  for (const g of gasRows) out.push({ id: `gas:${g.gas}`, name: `Released ${g.gas}`, kind: 'gas', gas: g.gas, gasT: g.t, entryKey: `gas:${g.gas}`, entriesT: g.co2e, entries: g.n, efSource: 'Mass of gas from the inventory entries', note: '' });
  return out;
}

/** The company's Scope 1 and 2 in the UAE from entries (company boundary), by emirate and gas. */
async function federalFromEntries(c: Tx, tenant: string, year: number) {
  const t = (await c.query('SELECT consolidation FROM tenant WHERE id = $1', [tenant])).rows[0];
  const W = t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
  const SHARE = `((least(a.period_end, $2::date) - greatest(a.period_start, $1::date) + 1)::numeric / (a.period_end - a.period_start + 1)) * ${W}`;
  const BASE = `FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN category cat ON cat.id = a.category_id
               WHERE f.country = 'AE' AND a.status = 'approved' AND a.period_start <= $2::date AND a.period_end >= $1::date`;
  const p = [`${year}-01-01`, `${year}-12-31`];
  const fac = (await c.query(
    `SELECT f.id, f.name, coalesce(substring(f.grid_region from 4), '') AS emirate, sum(a.co2e_direct * ${SHARE})::float8 / 1000 AS s1, sum(a.co2e_scope2 * ${SHARE})::float8 / 1000 AS s2, count(*)::int AS n
       ${BASE} GROUP BY 1, 2, 3 ORDER BY 4 DESC`, p)).rows.map((r) => ({ id: r.id as string, name: r.name as string, emirate: (r.emirate as string) || null, s1: r.s1 as number, s2: r.s2 as number, entries: r.n as number }));
  const byGas = (await c.query(
    `SELECT r.gas, sum(r.kg_gas * ${SHARE})::float8 / 1000 AS t, sum(r.kg_co2e * ${SHARE})::float8 / 1000 AS co2e
       ${BASE.replace('JOIN category cat ON cat.id = a.category_id', 'JOIN category cat ON cat.id = a.category_id JOIN activity_result r ON r.activity_id = a.id JOIN gas g ON g.code = r.gas')} AND r.basis = 'direct' AND g.kyoto
      GROUP BY 1 ORDER BY 3 DESC`, p)).rows.map((r) => ({ gas: r.gas as string, t: r.t as number, co2e: r.co2e as number }));
  const bySource = (await c.query(
    `SELECT cat.name AS category, i.name AS item, a.unit, sum(a.quantity * ${SHARE})::float8 AS qty, sum(a.co2e_direct * ${SHARE})::float8 / 1000 AS s1, sum(a.co2e_scope2 * ${SHARE})::float8 / 1000 AS s2
       ${BASE.replace('JOIN category cat ON cat.id = a.category_id', 'JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id')} AND (a.co2e_direct <> 0 OR a.co2e_scope2 <> 0)
      GROUP BY 1, 2, 3 ORDER BY 5 + 6 DESC`, p)).rows.map((r) => ({ category: r.category as string, item: r.item as string, unit: r.unit as string, qty: r.qty as number, s1: r.s1 as number, s2: r.s2 as number }));
  const s1 = fac.reduce((a, f) => a + f.s1, 0), s2 = fac.reduce((a, f) => a + f.s2, 0);
  return { s1, s2, facilities: fac, byGas, bySource };
}

/** Process and mass-balance emissions of a facility report linked to the inventory: not in its entries, so added to the federal Scope 1. */
const processStreams = (fy: { streams: Stream[]; result: { streams: { id: string; co2e: number }[] } }) =>
  fy.streams.reduce((a, s) => a + (!s.entryKey && (s.kind === 'process' || s.kind === 'mass_balance') ? fy.result.streams.find((r) => r.id === s.id)?.co2e ?? 0 : 0), 0);

const companyView = (r: any, year: number) => ({
  year, designated: (r?.designated ?? 'unknown') as 'yes' | 'no' | 'unknown', designationRef: r?.designation_ref ?? null, nrccNo: r?.nrcc_no ?? null, nrccRegistered: iso(r?.nrcc_registered),
  ieqtStatus: (r?.ieqt_status ?? 'not_started') as string, ieqtSubmitted: iso(r?.ieqt_submitted), ieqtRef: r?.ieqt_ref ?? null, verifier: r?.verifier ?? null,
  s1Typed: num(r?.s1_typed), s2Typed: num(r?.s2_typed), notes: r?.notes ?? '', updatedName: r?.updated_name ?? null,
});

/** One facility's year, worked out. */
async function facilityYear(c: Tx, tenant: string, f: FacilityV, year: number) {
  const { set, gwp } = await gwpOf(c, tenant);
  const streams = await streamsOf(c, f.id, year);
  const res = facility(streams, gwp);
  const y = yearView(await yearRow(c, f.id, year), year);
  const ead = eadStatus(f, streams.length ? res.direct : null, year);
  const problems = [...res.problems];
  const verifYears = f.verifierSince ? year - f.verifierSince + 1 : null;
  if (verifYears != null && verifYears > MAX_VERIFIER_YEARS) problems.push(`${f.verifier ?? 'The verifier'} has verified this facility ${verifYears} years running: at most ${MAX_VERIFIER_YEARS} consecutive years, then a two-year break`);
  if (ead.status === 'required' && year >= EAD_VERIFICATION_FROM && !f.verifier && !(f.operationsStart && Number(f.operationsStart.slice(0, 4)) === year)) problems.push(`Reporting year ${year} must be verified: name the accredited verifier`);
  if (f.mpChange && (!f.mpSubmitted || f.mpSubmitted < f.mpChange)) problems.push(`Significant change on ${f.mpChange}: a revised monitoring plan is due within 30 days`);
  if (res.co2Bio > 0) problems.push(`Biogenic CO₂ of ${res.co2Bio.toFixed(1)} t is reported apart and not counted in the total`);
  return { streams, result: res, year: y, ead, problems, gwpSet: set };
}

export async function uaeMrvRoutes(app: FastifyInstance) {
  needProduct(app, 'uaemrv');

  app.get('/api/uae-mrv', async (req) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: YEAR.optional() }).parse(req.query).year ?? lastYear();
    return tenantTx(tenant, async (c) => {
      const eko = await hasEkotrace(c, tenant);
      const facilities = [];
      let mrvS1 = 0, processOnly = 0;
      for (const r of (await c.query(`SELECT * FROM mrv_facility ORDER BY name`)).rows) {
        const f = facilityView(r), fy = await facilityYear(c, tenant, f, year);
        mrvS1 += fy.result.total;
        if (f.nodeId) processOnly += processStreams(fy);
        facilities.push({ ...f, result: { total: fy.result.total, direct: fy.result.direct, streams: fy.streams.length, problems: fy.problems.length + fy.result.streams.filter((s) => !s.ok).length, uncertainty: fy.result.uncertainty }, status: fy.year.status, ead: fy.ead });
      }
      const co = companyView((await c.query(`SELECT * FROM mrv_company_year WHERE tenant_id = $1 AND year = $2`, [tenant, year])).rows[0], year);
      const ent = eko ? await federalFromEntries(c, tenant, year) : null;
      const s1 = ent ? ent.s1 + processOnly : co.s1Typed ?? (facilities.length ? mrvS1 : null), s2 = ent ? ent.s2 : co.s2Typed;
      const measures = (await c.query(`SELECT * FROM mrv_measure WHERE facility_id IS NULL ORDER BY status, created_at`)).rows.map(measureView);
      return {
        year, facilities, company: co, federal: { s1, s2, ...federal(s1, s2, co.designated), source: ent ? 'entries' : co.s1Typed != null ? 'typed' : facilities.length ? 'facilities' : 'none', processOnly: ent ? processOnly : 0, byEmirate: ent?.facilities ?? [], byGas: ent?.byGas ?? [] },
        measures, calendar: calendar(year), emirates: EMIRATES, sectors: SECTORS, fuels: FUELS.map((f) => ({ code: f.code, name: f.name, ncv: f.ncv, co2: f.co2, ch4: f.ch4, n2o: f.n2o, ch4Mobile: f.ch4Mobile ?? null, n2oMobile: f.n2oMobile ?? null, density: f.density ?? null, gas: !!f.gas, biogenic: !!f.biogenic })),
        means: MEANS, tiers: TIERS, thresholds: { ead: EAD_THRESHOLD, nrcc: NRCC_THRESHOLD, verificationFrom: EAD_VERIFICATION_FROM },
        nodes: eko ? (await c.query(`SELECT id, name, grid_region FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows : [],
        gases: (await c.query(`SELECT code, name FROM gas WHERE kyoto ORDER BY sort, code`)).rows,
        ekotrace: eko, canSetup: canSetup(req), canData: canData(req),
      };
    });
  });

  app.put('/api/uae-mrv/company/:year', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const year = yearOf(req);
    const b = z.object({
      designated: z.enum(['yes', 'no', 'unknown']), designationRef: txt(200), nrccNo: txt(80), nrccRegistered: date,
      ieqtStatus: z.enum(['not_started', 'registered', 'draft', 'submitted', 'verified']), ieqtSubmitted: date, ieqtRef: txt(120), verifier: txt(200),
      s1Typed: z.number().min(0).max(1e10).nullable().default(null), s2Typed: z.number().min(0).max(1e10).nullable().default(null), notes: z.string().trim().max(4000).default(''),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(
        `INSERT INTO mrv_company_year (tenant_id, year, designated, designation_ref, nrcc_no, nrcc_registered, ieqt_status, ieqt_submitted, ieqt_ref, verifier, s1_typed, s2_typed, notes, updated_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (tenant_id, year) DO UPDATE SET designated=$3, designation_ref=$4, nrcc_no=$5, nrcc_registered=$6, ieqt_status=$7, ieqt_submitted=$8, ieqt_ref=$9, verifier=$10, s1_typed=$11, s2_typed=$12, notes=$13, updated_name=$14, updated_at=now()`,
        [tenant, year, b.designated, b.designationRef || null, b.nrccNo || null, b.nrccRegistered, b.ieqtStatus, b.ieqtSubmitted, b.ieqtRef || null, b.verifier || null, b.s1Typed, b.s2Typed, b.notes, req.user.name]);
      await audit(c, req, 'uaemrv.company', 'tenant', tenant, { year, ...b });
      return { ok: true };
    });
  });

  const nodeCheck = async (c: Tx, id: string | null) => {
    if (id && !(await c.query(`SELECT 1 FROM org_node WHERE id = $1 AND kind = 'facility'`, [id])).rowCount) throw new AppError('The inventory facility was not found');
  };
  const facCols = (b: z.infer<typeof facilityBody>) => [b.name, b.nodeId, b.emirate, b.sector, b.subSector || null, b.eadId || null, b.permitNo || null, b.operator || null, b.address || null,
    b.operationsStart, b.registeredOn, b.mpVersion || null, b.mpSubmitted, b.mpChange, b.verifier || null, b.verifierSince, b.notes];
  app.post('/api/uae-mrv/facilities', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = facilityBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await hasEkotrace(c, tenant))) b.nodeId = null;
      await nodeCheck(c, b.nodeId);
      if ((await c.query(`SELECT 1 FROM mrv_facility WHERE lower(name) = lower($1)`, [b.name])).rowCount) throw new AppError('A reporting facility with that name exists');
      const r = (await c.query(
        `INSERT INTO mrv_facility (tenant_id, name, node_id, emirate, sector, sub_sector, ead_id, permit_no, operator, address, operations_start, registered_on, mp_version, mp_submitted, mp_change, verifier, verifier_since, notes, created_name, updated_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING id`, [tenant, ...facCols(b), req.user.name])).rows[0];
      await audit(c, req, 'uaemrv.facility.create', 'mrv_facility', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/uae-mrv/facilities/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req), b = facilityBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await getFacility(c, id);
      if (!(await hasEkotrace(c, tenant))) b.nodeId = null;
      await nodeCheck(c, b.nodeId);
      if ((await c.query(`SELECT 1 FROM mrv_facility WHERE lower(name) = lower($1) AND id <> $2`, [b.name, id])).rowCount) throw new AppError('A reporting facility with that name exists');
      await c.query(
        `UPDATE mrv_facility SET name=$2, node_id=$3, emirate=$4, sector=$5, sub_sector=$6, ead_id=$7, permit_no=$8, operator=$9, address=$10, operations_start=$11, registered_on=$12, mp_version=$13,
                mp_submitted=$14, mp_change=$15, verifier=$16, verifier_since=$17, notes=$18, updated_name=$19, updated_at=now() WHERE id = $1`, [id, ...facCols(b), req.user.name]);
      await audit(c, req, 'uaemrv.facility.update', 'mrv_facility', id, b);
      return { ok: true };
    });
  });
  app.delete('/api/uae-mrv/facilities/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const f = await getFacility(c, id);
      if ((await c.query(`SELECT 1 FROM mrv_year WHERE facility_id = $1 AND status IN ('submitted', 'verified')`, [id])).rowCount) throw new AppError('A submitted report belongs to this facility: it cannot be removed', 409, 'LOCKED');
      await c.query(`DELETE FROM mrv_facility WHERE id = $1`, [id]);
      await audit(c, req, 'uaemrv.facility.delete', 'mrv_facility', id, { name: f.name });
      return { ok: true };
    });
  });

  app.get('/api/uae-mrv/facilities/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const year = z.object({ year: YEAR.optional() }).parse(req.query).year ?? lastYear();
    return tenantTx(tenant, async (c) => {
      const f = await getFacility(c, id);
      const fy = await facilityYear(c, tenant, f, year);
      const years = (await c.query(`SELECT year FROM mrv_year WHERE facility_id = $1 UNION SELECT DISTINCT year FROM mrv_stream WHERE facility_id = $1`, [id])).rows.map((r) => r.year as number);
      return {
        facility: f, ...fy, calendar: calendar(year, { registeredOn: f.registeredOn, mpChange: f.mpChange }),
        measures: (await c.query(`SELECT * FROM mrv_measure WHERE facility_id = $1 ORDER BY status, created_at`, [id])).rows.map(measureView),
        node: f.nodeId ? (await c.query(`SELECT id, name FROM org_node WHERE id = $1`, [f.nodeId])).rows[0] ?? null : null,
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 300`)).rows,
        years: [...new Set([year, lastYear(), lastYear() + 1, ...years])].sort((a, b) => b - a),
        ekotrace: await hasEkotrace(c, tenant), canSetup: canSetup(req), canData: canData(req),
      };
    });
  });

  app.put('/api/uae-mrv/facilities/:id/years/:year', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = idOf(req), year = yearOf(req);
    const b = z.object({
      status: z.enum(['draft', 'ready', 'submitted', 'verified']), submittedOn: date, reference: txt(120),
      production: z.array(z.object({ product: z.string().trim().min(1).max(200), qty: z.number().min(0).max(1e13).nullable(), unit: z.string().trim().max(40) })).max(50).default([]),
      gaps: z.array(z.object({ description: z.string().trim().min(1).max(500), approach: z.string().trim().max(500), t: z.number().min(0).max(1e9).nullable() })).max(50).default([]),
      qa: z.string().trim().max(8000).default(''), verifNotified: date, siteVisit: date, verifiedOn: date, opinion: z.enum(['unmodified', 'modified', 'adverse']).nullable().default(null), statementDoc: uuid.nullable().default(null),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await getFacility(c, id);
      const y = await ensureYear(c, tenant, id, year, req.user.name);
      const statusChange = b.status !== y.status;
      if (statusChange && !['super_admin', 'admin', 'platform_admin'].includes(req.user.role)) throw new AppError('A super admin or admin changes the report status', 403, 'FORBIDDEN');
      if (LOCKED.has(y.status) && LOCKED.has(b.status)) {
        // a submitted report: only the submission and verification details move on
        const P = (x: any[]) => JSON.stringify((x ?? []).map((r) => [r.product, r.qty ?? null, r.unit]));
        const G = (x: any[]) => JSON.stringify((x ?? []).map((r) => [r.description, r.approach, r.t ?? null]));
        if (P(b.production) !== P(y.production) || G(b.gaps) !== G(y.gaps) || b.qa !== (y.qa ?? '')) throw lockedErr(year);
      }
      if (LOCKED.has(b.status) && !LOCKED.has(y.status)) {
        const f = await getFacility(c, id), fy = await facilityYear(c, tenant, f, year);
        if (!fy.streams.length) throw new AppError('No source streams: nothing to submit');
        if (!b.submittedOn) throw new AppError('Give the date the report was submitted to EAD');
      }
      if (b.status === 'verified' && !b.verifiedOn) throw new AppError('Give the date of the verification statement');
      if (b.statementDoc && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.statementDoc])).rowCount) throw notFound('Document');
      await c.query(
        `UPDATE mrv_year SET status=$3, submitted_on=$4, reference=$5, production=$6, gaps=$7, qa=$8, verif_notified=$9, site_visit=$10, verified_on=$11, opinion=$12, statement_doc=$13, updated_name=$14, updated_at=now()
          WHERE facility_id = $1 AND year = $2`,
        [id, year, b.status, b.submittedOn, b.reference || null, JSON.stringify(b.production), JSON.stringify(b.gaps), b.qa, b.verifNotified, b.siteVisit, b.verifiedOn, b.opinion, b.statementDoc, req.user.name]);
      await audit(c, req, 'uaemrv.year', 'mrv_facility', id, { year, ...b });
      return { ok: true };
    });
  });

  app.put('/api/uae-mrv/facilities/:id/years/:year/streams', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = idOf(req), year = yearOf(req);
    const b = z.object({ streams: z.array(streamBody).max(300) }).parse(req.body);
    const ids = new Set(b.streams.map((s) => s.id));
    if (ids.size !== b.streams.length) throw new AppError('Two source streams have the same id');
    return tenantTx(tenant, async (c) => {
      await getFacility(c, id);
      const y = await ensureYear(c, tenant, id, year, req.user.name);
      if (LOCKED.has(y.status)) throw lockedErr(year);
      for (const s of b.streams) if (s.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [s.documentId])).rowCount) throw notFound('Document');
      await c.query(`DELETE FROM mrv_stream WHERE facility_id = $1 AND year = $2`, [id, year]);
      let i = 0;
      for (const s of b.streams) await c.query(`INSERT INTO mrv_stream (tenant_id, facility_id, year, sort, entry_key, data) VALUES ($1,$2,$3,$4,$5,$6)`, [tenant, id, year, i++, s.entryKey ?? null, JSON.stringify(s)]);
      await c.query(`UPDATE mrv_year SET updated_name = $3, updated_at = now() WHERE facility_id = $1 AND year = $2`, [id, year, req.user.name]);
      await audit(c, req, 'uaemrv.streams', 'mrv_facility', id, { year, streams: b.streams.length });
      return { ok: true };
    });
  });

  app.post('/api/uae-mrv/facilities/:id/years/:year/from-entries', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = idOf(req), year = yearOf(req);
    return tenantTx(tenant, async (c) => {
      if (!(await hasEkotrace(c, tenant))) throw new AppError('Filling from entries needs the GHG inventory package');
      const f = await getFacility(c, id);
      if (!f.nodeId) throw new AppError('Link the reporting facility to an inventory facility first');
      const y = await ensureYear(c, tenant, id, year, req.user.name);
      if (LOCKED.has(y.status)) throw lockedErr(year);
      const proposed = await fromEntries(c, f.nodeId, year);
      const current = await streamsOf(c, id, year);
      const byKey = new Map(current.filter((s) => s.entryKey).map((s) => [s.entryKey!, s]));
      let added = 0, updated = 0, removed = 0;
      const next: Stream[] = [];
      for (const s of current) {
        if (!s.entryKey) { next.push(s); continue; }
        const p = proposed.find((x) => x.entryKey === s.entryKey);
        if (!p) { removed++; continue; }
        // keep what people set (fuel, factors, uncertainty, instrument, notes); refresh the quantity from the entries
        next.push({ ...s, ...(p.kind === 'gas' ? { gasT: p.gasT } : { adQty: p.adQty, adUnit: 'TJ' as const }), entriesT: p.entriesT, entries: p.entries });
        updated++;
      }
      for (const p of proposed) if (!byKey.has(p.entryKey!)) { next.push(p); added++; }
      await c.query(`DELETE FROM mrv_stream WHERE facility_id = $1 AND year = $2`, [id, year]);
      let i = 0;
      for (const s of next) await c.query(`INSERT INTO mrv_stream (tenant_id, facility_id, year, sort, entry_key, data) VALUES ($1,$2,$3,$4,$5,$6)`, [tenant, id, year, i++, s.entryKey ?? null, JSON.stringify(s)]);
      await audit(c, req, 'uaemrv.from-entries', 'mrv_facility', id, { year, added, updated, removed });
      return { added, updated, removed };
    });
  });

  app.post('/api/uae-mrv/measures', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = measureBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.facilityId) await getFacility(c, b.facilityId);
      const r = (await c.query(`INSERT INTO mrv_measure (tenant_id, facility_id, title, means, status, start_year, t_per_year, capex_aed, note, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, b.facilityId, b.title, b.means, b.status, b.startYear, b.tPerYear, b.capexAed, b.note, req.user.name])).rows[0];
      await audit(c, req, 'uaemrv.measure.create', 'mrv_measure', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/uae-mrv/measures/:mid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const mid = idOf(req, 'mid'), b = measureBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.facilityId) await getFacility(c, b.facilityId);
      const r = await c.query(`UPDATE mrv_measure SET facility_id=$2, title=$3, means=$4, status=$5, start_year=$6, t_per_year=$7, capex_aed=$8, note=$9 WHERE id = $1`,
        [mid, b.facilityId, b.title, b.means, b.status, b.startYear, b.tPerYear, b.capexAed, b.note]);
      if (!r.rowCount) throw notFound('Measure');
      await audit(c, req, 'uaemrv.measure.update', 'mrv_measure', mid, b);
      return { ok: true };
    });
  });
  app.delete('/api/uae-mrv/measures/:mid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const mid = idOf(req, 'mid');
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM mrv_measure WHERE id = $1 RETURNING title`, [mid]);
      if (!r.rowCount) throw notFound('Measure');
      await audit(c, req, 'uaemrv.measure.delete', 'mrv_measure', mid, { title: r.rows[0].title });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------------------------------- exports --
  app.get('/api/uae-mrv/facilities/:id/years/:year/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = idOf(req), year = yearOf(req);
    const d = await tenantTx(tenant, async (c) => {
      const f = await getFacility(c, id);
      const fy = await facilityYear(c, tenant, f, year);
      const measures = (await c.query(`SELECT * FROM mrv_measure WHERE facility_id = $1 ORDER BY status, created_at`, [id])).rows.map(measureView);
      const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string;
      await audit(c, req, 'uaemrv.export', 'mrv_facility', id, { year });
      return { f, fy, measures, company };
    });
    const { f, fy, measures, company } = d;
    const R = new Map(fy.result.streams.map((r) => [r.id, r]));
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const sheet = (name: string, head: string[], widths: number[]) => { const ws = wb.addWorksheet(name); ws.addRow(head); styleHeader(ws, widths); return ws; };
    const kv = (name: string, rows: [string, unknown][]) => { const ws = sheet(name, ['Field', 'Value'], [44, 70]); rows.forEach((r) => ws.addRow(r)); return ws; };
    kv('C1 Identifiers', [
      ['Operator / company', f.operator || company], ['Facility', f.name], ['EAD facility ID', f.eadId], ['Environmental permit', f.permitNo], ['Emirate', EMIRATES[f.emirate]],
      ['Sector', SECTORS[f.sector].label], ['Sub-sector', f.subSector], ['Address', f.address], ['Reporting period', `1 January – 31 December ${year}`],
      ['Start of operations', f.operationsStart], ['Registered with EAD', f.registeredOn], ['Monitoring plan version', f.mpVersion], ['Monitoring plan submitted', f.mpSubmitted],
      ['Consolidation', 'Operational control (EAD guidance)'], ['GWP set', fy.gwpSet],
    ]);
    const c2 = kv('C2 Facility description', [
      ['Total emissions (tCO₂e)', round(fy.result.total)], ['CO₂ and methane (threshold basis, tCO₂e)', round(fy.result.direct)], ['Threshold (tCO₂e)', EAD_THRESHOLD], ['Status', fy.ead.text],
      ['Biogenic CO₂ reported apart (t)', round(fy.result.co2Bio)], ['Whole-facility uncertainty (±%)', fy.result.uncertainty == null ? '' : round(fy.result.uncertainty, 2)],
    ]);
    c2.addRow([]); c2.addRow(['Production', 'Quantity', 'Unit', 'Intensity (tCO₂e per unit)']).font = { bold: true };
    for (const p of fy.year.production) c2.addRow([p.product, p.qty, p.unit, p.qty ? round(fy.result.total / p.qty, 4) : '']);
    c2.addRow([]); c2.addRow(['By gas', 't', 'tCO₂e']).font = { bold: true };
    for (const g of fy.result.byGas) c2.addRow([g.gas, round(g.t, 4), round(g.co2e)]);
    const d1 = sheet('D1 Source streams', ['#', 'Source stream', 'Type', 'Method', 'Class (operator)', 'Class (worked out)', 'tCO₂e', 'Share %'], [5, 40, 18, 16, 16, 18, 14, 10]);
    fy.streams.forEach((s, i) => { const r = R.get(s.id)!; d1.addRow([i + 1, s.name, KIND[s.kind], s.fallback ? 'Fallback' : METHOD[s.kind], r.materiality.replace('_', ' '), r.autoMateriality.replace('_', ' '), round(r.co2e), fy.result.total ? round((r.co2e / fy.result.total) * 100, 2) : '']); });
    const d2 = sheet('D2 Calculation', ['#', 'Source stream', 'Fuel / material', 'Activity data', 'Unit', 'Density t/kL', 'NCV (TJ/unit)', 'TJ', 'EF', 'EF unit', 'Oxidation / conversion', 'Carbon t C/t', 'Biomass fraction', 'CH₄ kg/TJ', 'N₂O kg/TJ', 'CO₂ fossil t', 'CO₂ bio t', 'CH₄ t', 'N₂O t', 'tCO₂e', 'Uncertainty ±%', 'Tier', 'Tier needed', 'Instrument', 'Factor source', 'Notes'],
      [5, 32, 22, 14, 8, 10, 12, 12, 10, 12, 12, 10, 10, 10, 10, 12, 10, 10, 10, 12, 10, 8, 10, 24, 28, 36]);
    fy.streams.forEach((s, i) => {
      if (!['combustion', 'process', 'mass_balance'].includes(s.kind)) return;
      const r = R.get(s.id)!, fu = s.fuel ? FUEL.get(s.fuel) : undefined;
      d2.addRow([i + 1, s.name, fu?.name ?? s.material ?? '', s.adQty, s.adUnit ?? 't', s.density ?? fu?.density ?? '', s.ncv ?? (fu && s.adUnit !== 'TJ' ? fu.ncv / 1000 : ''), r.tj == null ? '' : round(r.tj, 4),
        s.kind === 'combustion' ? s.ef ?? fu?.co2 ?? '' : s.ef ?? '', s.kind === 'combustion' ? 'tCO₂/TJ' : s.kind === 'process' ? 'tCO₂/t' : '', s.of ?? 1, s.carbon ?? '', s.biomass ?? (fu?.biogenic ? 1 : 0),
        s.kind === 'combustion' ? s.ch4Ef ?? (s.mobile ? fu?.ch4Mobile : fu?.ch4) ?? '' : '', s.kind === 'combustion' ? s.n2oEf ?? (s.mobile ? fu?.n2oMobile : fu?.n2o) ?? '' : '',
        round(r.co2, 3), round(r.co2Bio, 3), round(r.ch4, 4), round(r.n2o, 4), round(r.co2e, 3), s.uncertainty ?? '', r.tier == null ? '' : r.tier || 'below 1', r.tierRequired || '', s.instrument ?? '', s.efSource ?? '', [s.note, ...r.problems].filter(Boolean).join(' · ')]);
    });
    const e = sheet('E Measured', ['#', 'Emission source', 'CO₂ t (measured)', 'CH₄ t (measured)', 'Biomass fraction', 'tCO₂e', 'Uncertainty ±%', 'Instrument (CEMS)', 'Notes'], [5, 36, 14, 14, 12, 12, 12, 28, 36]);
    fy.streams.forEach((s, i) => { if (s.kind !== 'measured') return; const r = R.get(s.id)!; e.addRow([i + 1, s.name, s.measuredCo2, s.measuredCh4, s.biomass ?? 0, round(r.co2e, 3), s.uncertainty ?? '', s.instrument ?? '', [s.note, ...r.problems].filter(Boolean).join(' · ')]); });
    const fb = sheet('F Fallback', ['#', 'Source stream', 'Why no tier is feasible', 'Uncertainty ±%', 'tCO₂e'], [5, 36, 60, 12, 12]);
    fy.streams.forEach((s, i) => { if (!s.fallback) return; fb.addRow([i + 1, s.name, s.note ?? '', s.uncertainty ?? '', round(R.get(s.id)!.co2e, 3)]); });
    fb.addRow([]); fb.addRow(['', 'Whole-facility uncertainty (must not exceed ±7.5% with a fallback approach)', '', fy.result.uncertainty == null ? '' : round(fy.result.uncertainty, 2)]);
    const g = sheet('G Methane', ['#', 'Source', 'Origin', 'CH₄ t', 'tCO₂e', 'Notes'], [5, 36, 18, 12, 12, 36]);
    fy.streams.forEach((s, i) => {
      const r = R.get(s.id)!;
      if (!r.ch4) return;
      g.addRow([i + 1, s.name, s.kind === 'combustion' ? 'Fuel combustion' : s.kind === 'measured' ? 'Measured' : s.kind === 'gas' ? 'Fugitive / vented' : 'Process', round(r.ch4, 4), round(r.ch4 * (fy.result.byGas.find((x) => x.gas === 'CH4')?.co2e ?? 0) / (fy.result.ch4 || 1), 3), s.note ?? '']);
    });
    const other = fy.streams.filter((s) => s.kind === 'gas' && s.gas && s.gas !== 'CH4' && s.gas !== 'CH4_fossil');
    if (other.length) { g.addRow([]); g.addRow(['', 'Other gases', 'Gas', 't', 'tCO₂e']).font = { bold: true }; other.forEach((s) => g.addRow(['', s.name, s.gas, s.gasT, round(R.get(s.id)!.co2e, 3)])); }
    const h = kv('H1 Verification & gaps', [
      ['Verifier', f.verifier], ['With this verifier since', f.verifierSince], ['Verification notified to EAD', fy.year.verifNotified], ['Site visit', fy.year.siteVisit], ['Verification statement', fy.year.verifiedOn],
      ['Opinion', fy.year.opinion], ['Submitted to EAD', fy.year.submittedOn], ['Reference', fy.year.reference],
    ]);
    h.addRow([]); h.addRow(['Data gap', 'Approach used', 'tCO₂e affected']).font = { bold: true };
    for (const x of fy.year.gaps) h.addRow([x.description, x.approach, x.t]);
    kv('I Management & QA', [['Management and quality assurance', fy.year.qa]]);
    const j = sheet('J Mitigation', ['Measure', 'Means', 'Status', 'Start year', 'tCO₂e a year', 'Capex (AED)', 'Notes'], [44, 30, 14, 10, 14, 14, 40]);
    for (const m of measures) j.addRow([m.title, MEANS[m.means], m.status, m.startYear, m.tPerYear, m.capexAed, m.note]);
    j.addRow([]); j.addRow(['Offsets and carbon removals are for information only and are not netted against reported emissions.']);
    const m = wb.addWorksheet('Method'); m.getColumn(1).width = 140;
    for (const line of [
      `${company} — ${f.name}: Scope 1 report for ${year} prepared in ${PRODUCT} along the sheets of the EAD Facility MRV template (C1–J). A draft: copy the values into the template on facilitymrv.ead.ae.`,
      'Calculation: CO₂ = activity data (TJ) × emission factor (tCO₂/TJ) × oxidation factor; process: tonnes × emission factor × conversion factor; mass balance: tonnes × carbon content × 44/12 (carbon out deducted); measured: as measured.',
      `Defaults: 2006 IPCC Guidelines Vol. 2 (Table 1.2 NCV, Table 1.4 CO₂, Tables 2.2–2.3 stationary and 3.2.1–3.2.2 road CH₄/N₂O) unless a supplier or laboratory value is given. GWP: ${fy.gwpSet}.`,
      'Tiers (activity data): Tier 1 ±7.5%, Tier 2 ±5%, Tier 3 ±2.5%, Tier 4 ±1.5%. Major source streams at least Tier 2, minor at least Tier 1; de minimis may be estimated.',
      'Classes: smallest streams first; de minimis while together below the higher of 1 kt and 2% of the total (2% capped at 20 kt); minor below the higher of 5 kt and 10% (capped at 100 kt); the rest major.',
      'Whole-facility uncertainty: square root of the sum of (stream emissions × stream uncertainty)², divided by the total (independent errors).',
      'Biogenic CO₂ (biomass fraction) is reported apart and not counted. Grid electricity (Scope 2) is not part of the EAD report.',
      ...(fy.problems.length || fy.result.streams.some((r) => !r.ok) ? ['', 'Checks still open:', ...fy.problems, ...fy.result.streams.flatMap((r) => r.problems.map((p) => `${fy.streams.find((s) => s.id === r.id)?.name}: ${p}`))] : []),
    ]) m.addRow([line]);
    return sendWorkbook(reply, wb, `EAD_MRV_${f.name.replace(/[^A-Za-z0-9]+/g, '_')}_${year}.xlsx`);
  });

  app.get('/api/uae-mrv/company/:year/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const year = yearOf(req);
    const d = await tenantTx(tenant, async (c) => {
      const eko = await hasEkotrace(c, tenant);
      const co = companyView((await c.query(`SELECT * FROM mrv_company_year WHERE tenant_id = $1 AND year = $2`, [tenant, year])).rows[0], year);
      const t = (await c.query(`SELECT name, consolidation, gwp_set FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const ent = eko ? await federalFromEntries(c, tenant, year) : null;
      const facs = [];
      for (const r of (await c.query(`SELECT * FROM mrv_facility ORDER BY name`)).rows) { const f = facilityView(r); facs.push({ f, fy: await facilityYear(c, tenant, f, year) }); }
      const measures = (await c.query(`SELECT m.*, f.name AS facility FROM mrv_measure m LEFT JOIN mrv_facility f ON f.id = m.facility_id ORDER BY m.facility_id NULLS FIRST, m.status`)).rows;
      await audit(c, req, 'uaemrv.export.federal', 'tenant', tenant, { year });
      return { co, t, ent, facs, measures };
    });
    const { co, t, ent, facs, measures } = d;
    const processOnly = ent ? facs.reduce((a, x) => a + (x.f.nodeId ? processStreams(x.fy) : 0), 0) : 0;
    const s1 = ent ? ent.s1 + processOnly : co.s1Typed ?? facs.reduce((a, x) => a + x.fy.result.total, 0), s2 = ent ? ent.s2 : co.s2Typed;
    const fed = federal(s1, s2, co.designated);
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const sheet = (name: string, head: string[], widths: number[]) => { const ws = wb.addWorksheet(name); ws.addRow(head); styleHeader(ws, widths); return ws; };
    const o = sheet('Organisation', ['Field', 'Value'], [44, 80]);
    for (const r of [
      ['Organisation', t.name], ['Reporting year', `${year} (calendar year)`], ['Consolidation approach', t.consolidation], ['GWP set', t.gwp_set],
      ['Designated source', co.designated], ['Designation reference', co.designationRef], ['Scope 1 (tCO₂e)', s1 == null ? '' : round(s1)], ['Scope 2 location-based (tCO₂e)', s2 == null ? '' : round(s2)],
      ['Scope 1 + 2 (tCO₂e)', fed.total == null ? '' : round(fed.total)], ['NRCC threshold (Cabinet Resolution 67 of 2024)', `${NRCC_THRESHOLD.toLocaleString('en-US')} tCO₂e — ${fed.large ? 'at or above' : 'below'}`],
      ['NRCC registration', co.nrccNo ? `${co.nrccNo}${co.nrccRegistered ? ` (${co.nrccRegistered})` : ''}` : ''], ['National MRV system (IEQT)', `${co.ieqtStatus}${co.ieqtSubmitted ? `, submitted ${co.ieqtSubmitted}` : ''}${co.ieqtRef ? `, ref. ${co.ieqtRef}` : ''}`],
      ['Verifier', co.verifier], ['Source of figures', ent ? `${PRODUCT} approved entries of UAE facilities${processOnly ? `, plus ${round(processOnly)} tCO₂e of process and mass-balance emissions recorded only in the facility MRV reports` : ''}` : co.s1Typed != null ? 'Typed' : 'Sum of the facility MRV reports (Scope 1 only)'],
    ] as [string, unknown][]) o.addRow(r);
    o.addRow([]); o.addRow(['Duties']).font = { bold: true }; fed.duties.forEach((x) => o.addRow(['', x]));
    if (ent) {
      const f = sheet('By facility', ['Facility', 'Emirate', 'Scope 1 tCO₂e', 'Scope 2 tCO₂e', 'Entries'], [36, 18, 16, 16, 10]);
      ent.facilities.forEach((x) => f.addRow([x.name, x.emirate ? EMIRATES[x.emirate] ?? x.emirate : 'Not set', round(x.s1), round(x.s2), x.entries]));
      const em = sheet('By emirate', ['Emirate', 'Scope 1 tCO₂e', 'Scope 2 tCO₂e'], [24, 16, 16]);
      const by = new Map<string, { s1: number; s2: number }>();
      ent.facilities.forEach((x) => { const k = x.emirate ? EMIRATES[x.emirate] ?? x.emirate : 'Not set'; const v = by.get(k) ?? { s1: 0, s2: 0 }; v.s1 += x.s1; v.s2 += x.s2; by.set(k, v); });
      [...by].forEach(([k, v]) => em.addRow([k, round(v.s1), round(v.s2)]));
      const g = sheet('Scope 1 by gas', ['Gas', 't', 'tCO₂e'], [20, 14, 14]); ent.byGas.forEach((x) => g.addRow([x.gas, round(x.t, 4), round(x.co2e)]));
      const a = sheet('Activity data', ['Category', 'Source', 'Quantity', 'Unit', 'Scope 1 tCO₂e', 'Scope 2 tCO₂e'], [30, 40, 16, 10, 14, 14]); ent.bySource.forEach((x) => a.addRow([x.category, x.item, round(x.qty, 3), x.unit, round(x.s1, 3), round(x.s2, 3)]));
    }
    if (facs.length) { const e = sheet('EAD facilities', ['Facility', 'Emirate', 'Sector', 'Scope 1 tCO₂e', 'Status', 'EAD position'], [32, 16, 30, 14, 12, 60]); facs.forEach(({ f, fy }) => e.addRow([f.name, EMIRATES[f.emirate], SECTORS[f.sector].label, round(fy.result.total), fy.year.status, fy.ead.text])); }
    const r = sheet('Reduction measures', ['Facility', 'Measure', 'Means', 'Status', 'Start year', 'tCO₂e a year', 'Notes'], [24, 44, 30, 12, 10, 14, 40]);
    for (const m of measures) r.addRow([m.facility ?? 'Company-wide', m.title, MEANS[m.means], m.status, m.start_year, num(m.t_per_year), m.note]);
    const mt = wb.addWorksheet('Method'); mt.getColumn(1).width = 140;
    for (const line of [
      `Prepared in ${PRODUCT} for the national MRV system (Integrated Emissions Quantification Tool) under Federal Decree-Law No. 11 of 2024 and Cabinet Resolution No. 67 of 2024. A data pack: enter the values on the platform.`,
      'Scope 1 and Scope 2 (location-based) under the GHG Protocol, activities in the UAE only, calendar year; entries spanning the year split by days; the company\'s consolidation approach applies.',
      'Records: keep the measured emissions data and evidence for at least five years and make them available to the authority on request.',
      'Federal adjustment period extended by one year from 31 May 2026 (Cabinet Resolution No. 147 of 2026). The Ministry\'s technical guidance on scopes, methods and deadlines is pending: check before submitting.',
    ]) mt.addRow([line]);
    return sendWorkbook(reply, wb, `UAE_MRV_federal_${year}.xlsx`);
  });
}

const KIND: Record<string, string> = { combustion: 'Fuel combustion', process: 'Process', mass_balance: 'Mass balance', measured: 'Measured source', gas: 'Other gas released' };
const METHOD: Record<string, string> = { combustion: 'Calculation', process: 'Calculation', mass_balance: 'Mass balance', measured: 'Measurement', gas: 'Calculation' };
const round = (x: number, dp = 2) => Math.round(x * 10 ** dp) / 10 ** dp;
