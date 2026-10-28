/**
 * SEBI BRSR Core (Disclose → BRSR Core): the nine attributes for a financial year (April–March), the previous year
 * beside it, readiness for reasonable assurance or assessment, and the BRSR Core of the value chain.
 *
 *   GET    /api/brsr?fy=                       the year: settings, every KPI (value, previous year, source, review), detail, checks, value chain
 *   PUT    /api/brsr/:fy                       the year's settings: revenue, PPP rate, output, boundary, provider, approach, status (super admin, admin)
 *   PUT    /api/brsr/:fy/values                typed values and overrides with notes, evidence, owner (super admin, admin, manager, preparer)
 *   POST   /api/brsr/:fy/review                mark KPIs ready or reviewed (reviewed: super admin, admin, not the last person to change it)
 *   GET    /api/brsr/:fy/suggest-partners      upstream partners from purchase files (≥ 2% of spend, up to 75% cumulative)
 *   POST   /api/brsr/:fy/partners              add a value-chain partner; PUT / DELETE /api/brsr/partners/:pid
 *   GET    /api/brsr/:fy/export                Excel: BRSR Core table, value chain, detail, method
 *
 * Auto KPIs come from the approved entries of the boundary's facilities: entries that cross the year's ends are
 * split by days, and the company's consolidation approach (Methodology & boundaries) applies.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { PRODUCT } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { refdata } from './refdata.js';
import { kwhOf } from './dashboard.routes.js';
import { ATTRIBUTES, KPI, KPIS, PPP_DEFAULT, VC_KPIS, checks, derive, fyLabel, revenuePpp, wasteCategory, wasteRoute, type Values } from '../lib/brsr.js';

const FY = z.coerce.number().int().min(2020).max(2100);
const fyOf = (req: FastifyRequest) => FY.parse((req.params as { fy: string }).fy);
const currentFy = () => { const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number); return m! >= 4 ? y! - 1 : y! - 2; }; // the last completed year
const num = (x: unknown) => (x == null ? null : Number(x));
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'preparer', 'platform_admin'].includes(req.user.role);
const canSetup = (req: FastifyRequest) => ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
const AUTO = new Set(KPIS.filter((k) => k.kind === 'auto').map((k) => k.code));
const ENTERABLE = new Set(KPIS.filter((k) => k.kind !== 'derived').map((k) => k.code));

async function report(c: Tx, tenant: string, fy: number) {
  return (await c.query(`SELECT * FROM brsr_report WHERE tenant_id = $1 AND fy = $2`, [tenant, fy])).rows[0] ?? null;
}
async function ensure(c: Tx, tenant: string, fy: number, who: string) {
  const r = await report(c, tenant, fy);
  if (r) return r;
  return (await c.query(`INSERT INTO brsr_report (tenant_id, fy, ppp_factor, updated_name) VALUES ($1,$2,$3,$4) RETURNING *`, [tenant, fy, PPP_DEFAULT, who])).rows[0];
}

/** The year's environmental figures from approved entries (tonnes, kL, GJ), with the detail behind them. */
export async function fromEntries(c: Tx, tenant: string, fy: number, facilityIds: string[] | null) {
  const facs = facilityIds?.length ? facilityIds : (await c.query(`SELECT id FROM org_node WHERE kind = 'facility'`)).rows.map((r) => r.id as string);
  const t = (await c.query('SELECT consolidation FROM tenant WHERE id = $1', [tenant])).rows[0];
  const W = t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
  const from = `${fy}-04-01`, to = `${fy + 1}-03-31`;
  const SHARE = `((least(a.period_end, $3::date) - greatest(a.period_start, $2::date) + 1)::numeric / (a.period_end - a.period_start + 1)) * ${W}`;
  const BASE = `FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id
                JOIN subcategory sc ON sc.id = i.subcategory_id JOIN unit u ON u.code = a.unit
               WHERE a.facility_id = ANY($1) AND a.status = 'approved' AND a.period_start <= $3::date AND a.period_end >= $2::date`;
  const rows = (await c.query(
    `SELECT cat.code AS cat, i.id AS iid, i.name AS item, sc.name AS sub, sc.is_bioenergy AS bio, a.unit, i.attrs,
            coalesce((a.inputs->'wasteInfo'->>'hazardous')::boolean, false) AS haz, nullif(a.inputs->'wasteInfo'->>'gri', '') AS wgri,
            sum(a.quantity * ${SHARE})::float8 AS qty, sum(a.co2e_direct * ${SHARE})::float8 / 1000 AS s1, sum(a.co2e_scope2 * ${SHARE})::float8 / 1000 AS s2,
            sum(coalesce((SELECT sum(k.kwh) FROM certificate_claim k WHERE k.activity_id = a.id), 0) * ${SHARE})::float8 AS rec, count(*)::int AS n
       ${BASE} GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9`, [facs, from, to])).rows;
  const gases = (await c.query(
    `SELECT coalesce(g.family, CASE WHEN r.gas = 'CO2e' THEN 'Not split by gas' ELSE r.gas END) AS family, sum(r.kg_co2e * ${SHARE})::float8 / 1000 AS t
       ${BASE.replace('JOIN unit u ON u.code = a.unit', 'JOIN unit u ON u.code = a.unit JOIN activity_result r ON r.activity_id = a.id LEFT JOIN gas g ON g.code = r.gas')} AND r.basis = 'direct'
      GROUP BY 1 ORDER BY 2 DESC`, [facs, from, to])).rows.map((r) => ({ gas: r.family as string, t: r.t as number }));
  const ref = await refdata();
  const units = new Map(ref.unitList.map((u) => [u.code, { dimension: u.dimension, to_base: Number(u.toBase) }]));
  const v: Values = { 'ghg.s1': 0, 'ghg.s2': 0, 'water.withdrawal': 0, 'water.discharge': 0, 'energy.total': 0, 'energy.renewable': 0,
    'waste.a': 0, 'waste.b': 0, 'waste.c': 0, 'waste.d': 0, 'waste.e': 0, 'waste.g': 0, 'waste.h': 0,
    'waste.recycled': 0, 'waste.reused': 0, 'waste.other_recovery': 0, 'waste.incineration': 0, 'waste.landfill': 0, 'waste.other_disposal': 0 };
  const add = (k: string, x: number) => { v[k] = (v[k] ?? 0) + x; };
  const detail = { energy: new Map<string, { gj: number; renewable: boolean }>(), water: new Map<string, number>(), waste: new Map<string, number>(), entries: { ghg: 0, energy: 0, water: 0, waste: 0 }, missingEnergy: 0 };
  const addD = <T>(m: Map<string, T>, k: string, f: (old: T | undefined) => T) => m.set(k, f(m.get(k)));
  for (const r of rows) {
    add('ghg.s1', r.s1); add('ghg.s2', r.s2);
    if (r.s1 || r.s2) detail.entries.ghg += r.n;
    const u = units.get(r.unit);
    const fuel = r.cat === 'stationary_combustion' || r.cat === 'mobile_combustion';
    if (fuel || r.cat === 'purchased_electricity') {
      const kwh = await kwhOf(c, units, r.iid, `${r.item} ${r.sub}`, r.unit, r.qty, fy, fuel);
      if (kwh == null) { detail.missingEnergy += r.n; continue; }
      const gj = kwh * 0.0036, recGj = Math.min(gj, r.rec * 0.0036);
      const renewable = fuel ? !!r.bio : false;
      add('energy.total', gj); add('energy.renewable', renewable ? gj : recGj);
      const key = fuel ? `${r.cat === 'mobile_combustion' ? 'Vehicles' : 'Fuels'} — ${r.sub}` : u?.dimension === 'heat' ? 'Purchased heat & steam' : u?.dimension === 'cooling' ? 'District cooling' : 'Grid electricity';
      if (fuel || recGj <= 0) addD(detail.energy, key, (o) => ({ gj: (o?.gj ?? 0) + gj, renewable: fuel ? renewable : false }));
      else { addD(detail.energy, `${key} — renewable (certificates / contracts)`, (o) => ({ gj: (o?.gj ?? 0) + recGj, renewable: true })); if (gj - recGj > 0) addD(detail.energy, key, (o) => ({ gj: (o?.gj ?? 0) + gj - recGj, renewable: false })); }
      detail.entries.energy += r.n;
    } else if (r.cat === 'water_supply' || r.cat === 'water_discharge') {
      const kl = u ? (r.qty * u.to_base) / 1000 : 0;    // litres → kL
      const flow = r.attrs?.flow as string | undefined;
      if (flow === 'withdrawal') { add('water.withdrawal', kl); addD(detail.water, `Withdrawal — ${r.item}`, (o) => (o ?? 0) + kl); }
      if (flow === 'discharge') { add('water.discharge', kl); addD(detail.water, `Discharge — ${r.item}`, (o) => (o ?? 0) + kl); }
      detail.entries.water += r.n;
    } else if (r.cat === 'waste_generated') {
      const tonnes = u ? (r.qty * u.to_base) / 1000 : 0;  // kg → t
      const cat = wasteCategory(r.sub, r.item, r.haz), route = wasteRoute(r.wgri, (r.attrs?.route as string) ?? null);
      add(`waste.${cat}`, tonnes); add(`waste.${route}`, tonnes);
      addD(detail.waste, `${cat}|${route}`, (o) => (o ?? 0) + tonnes);
      detail.entries.waste += r.n;
    }
  }
  v['water.consumption'] = (v['water.withdrawal'] ?? 0) - (v['water.discharge'] ?? 0);
  return {
    values: v, gases,
    detail: {
      energy: [...detail.energy].map(([k, x]) => ({ source: k, gj: x.gj, renewable: x.renewable })).sort((a, b) => b.gj - a.gj),
      water: [...detail.water].map(([k, kl]) => ({ line: k, kl })).sort((a, b) => a.line.localeCompare(b.line)),
      waste: [...detail.waste].map(([k, t]) => { const [cat, route] = k.split('|'); return { cat: cat!, route: route!, t }; }),
      entries: detail.entries, missingEnergy: detail.missingEnergy,
    },
  };
}

const SOURCE: Record<string, string> = {
  ghg: 'approved entries, Scope 1 (fuels, vehicles, process, fugitive, own waste sites) and Scope 2 location-based',
  water: 'approved water entries (withdrawal by source, discharge by destination)', energy: 'approved fuel, vehicle and energy entries; renewable = bioenergy and electricity covered by certificates or contracts',
  waste: 'approved waste entries, categories under the Waste Management Rules 2016, routes from each entry\'s method',
};

/** The whole year: base values (auto, overridden or typed), derived values, sources and review state. */
async function yearData(c: Tx, tenant: string, fy: number) {
  const r = await report(c, tenant, fy);
  const auto = await fromEntries(c, tenant, fy, r?.facility_ids ?? null);
  const stored = r ? (await c.query(`SELECT v.*, d.filename FROM brsr_value v LEFT JOIN document d ON d.id = v.document_id WHERE v.report_id = $1`, [r.id])).rows : [];
  const S = new Map(stored.map((x) => [x.kpi as string, x]));
  const base: Values = {};
  for (const k of KPIS) {
    if (k.kind === 'derived') continue;
    const s = S.get(k.code);
    base[k.code] = s?.value != null ? Number(s.value) : k.kind === 'auto' ? (auto.values[k.code] ?? null) : null;
  }
  const ctx = { revenue: num(r?.revenue_inr), ppp: num(r?.ppp_factor) ?? PPP_DEFAULT, output: num(r?.output_qty) };
  const all = derive(base, ctx);
  const rows = KPIS.map((k) => {
    const s = S.get(k.code);
    const overridden = k.kind === 'auto' && s?.value != null;
    return {
      code: k.code, value: all[k.code] ?? null, auto: k.kind === 'auto' ? auto.values[k.code] ?? null : null, overridden,
      source: k.kind === 'derived' ? 'derived' : overridden ? 'override' : k.kind === 'auto' ? 'entries' : s?.value != null ? 'typed' : 'missing',
      note: s?.note ?? '', documentId: s?.document_id ?? null, document: s?.filename ?? null, owner: s?.owner_name ?? null,
      review: (s?.review ?? 'open') as 'open' | 'ready' | 'reviewed', reviewedName: s?.reviewed_name ?? null, reviewedAt: s?.reviewed_at ?? null, updatedName: s?.updated_name ?? null, updatedAt: s?.updated_at ?? null,
    };
  });
  return { report: r, ctx, values: all, rows, auto, problems: checks(all) };
}

const reportView = (r: any, fy: number) => ({
  fy, label: fyLabel(fy), exists: !!r, revenueInr: num(r?.revenue_inr), pppFactor: num(r?.ppp_factor) ?? PPP_DEFAULT, outputQty: num(r?.output_qty), outputUnit: r?.output_unit ?? null,
  facilityIds: (r?.facility_ids as string[] | null) ?? null, provider: r?.provider ?? null, approach: r?.approach ?? 'assurance', status: r?.status ?? 'draft', notes: r?.notes ?? '',
  updatedName: r?.updated_name ?? null, updatedAt: r?.updated_at ?? null,
});
const partnerView = (p: any) => ({ id: p.id, side: p.side, name: p.name, supplierId: p.supplier_id, amountInr: num(p.amount_inr), attributable: num(p.attributable), values: p.values as Values, note: p.note, updatedName: p.updated_name });

/** Value chain: partners, their attributable figures and coverage of purchases and sales. */
function valueChain(partners: ReturnType<typeof partnerView>[], v: Values) {
  const side = (s: 'upstream' | 'downstream') => {
    const ps = partners.filter((p) => p.side === s);
    const amount = ps.reduce((a, p) => a + (p.amountInr ?? 0), 0);
    const total = s === 'upstream' ? v['incl.purchases'] : v['open.sales'];
    const att: Values = {};
    for (const k of VC_KPIS) {
      const xs = ps.filter((p) => p.values[k] != null);
      att[k] = xs.length ? xs.reduce((a, p) => a + Number(p.values[k]) * (p.attributable ?? 1), 0) : null;
    }
    const share = (p: { amountInr: number | null }) => (total && p.amountInr != null ? p.amountInr / total : null);
    return { partners: ps.map((p) => ({ ...p, share: share(p), belowTwo: share(p) != null && share(p)! < 0.02 })), amount, total: total ?? null, coverage: total ? amount / total : null, attributable: att };
  };
  return { upstream: side('upstream'), downstream: side('downstream') };
}

export async function brsrRoutes(app: FastifyInstance) {
  app.get('/api/brsr', async (req) => {
    const tenant = requireTenant(req);
    const fy = z.object({ fy: FY.optional() }).parse(req.query).fy ?? currentFy();
    return tenantTx(tenant, async (c) => {
      const cur = await yearData(c, tenant, fy), prev = await yearData(c, tenant, fy - 1);
      const partners = cur.report ? (await c.query(`SELECT * FROM brsr_partner WHERE report_id = $1 ORDER BY side, amount_inr DESC NULLS LAST, name`, [cur.report.id])).rows.map(partnerView) : [];
      const core = cur.rows.filter((r) => KPI.get(r.code)!.inCore);
      const enterable = cur.rows.filter((r) => KPI.get(r.code)!.kind !== 'derived');
      return {
        report: reportView(cur.report, fy), attributes: ATTRIBUTES, kpis: KPIS,
        rows: cur.rows.map((r) => ({ ...r, previous: prev.values[r.code] ?? null })),
        revenuePpp: revenuePpp(cur.ctx), previousRevenuePpp: revenuePpp(prev.ctx), previousExists: !!prev.report,
        gases: cur.auto.gases, detail: cur.auto.detail, problems: cur.problems,
        readiness: {
          kpis: enterable.length, filled: enterable.filter((r) => r.value != null).length, ready: enterable.filter((r) => r.review !== 'open').length,
          reviewed: enterable.filter((r) => r.review === 'reviewed').length, evidence: enterable.filter((r) => r.documentId).length,
          coreFilled: core.filter((r) => r.value != null).length, core: core.length,
        },
        sources: SOURCE, valueChain: valueChain(partners, cur.values), years: [...new Set([fy, fy - 1, currentFy(), currentFy() - 1, ...(await c.query(`SELECT fy FROM brsr_report ORDER BY fy DESC`)).rows.map((x) => x.fy as number)])].sort((a, b) => b - a),
        facilities: (await c.query(`SELECT id, name FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows,
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 300`)).rows,
        canEdit: canEdit(req), canSetup: canSetup(req), canReview: ['super_admin', 'admin'].includes(req.user.role),
      };
    });
  });

  app.put('/api/brsr/:fy', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const fy = fyOf(req);
    const b = z.object({
      revenueInr: z.number().min(0).max(1e16).nullable(), pppFactor: z.number().positive().max(1000).nullable(), outputQty: z.number().positive().max(1e15).nullable(),
      outputUnit: z.string().trim().max(40).nullable(), facilityIds: z.array(z.string().uuid()).max(500).nullable(), provider: z.string().trim().max(200).nullable(),
      approach: z.enum(['assurance', 'assessment', 'none']), status: z.enum(['draft', 'ready', 'final']), notes: z.string().trim().max(4000).default(''),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.facilityIds?.length) {
        const n = Number((await c.query(`SELECT count(*)::int AS n FROM org_node WHERE kind = 'facility' AND id = ANY($1)`, [b.facilityIds])).rows[0].n);
        if (n !== new Set(b.facilityIds).size) throw new AppError('One of the facilities was not found');
      }
      const r = await ensure(c, tenant, fy, req.user.name);
      await c.query(`UPDATE brsr_report SET revenue_inr=$2, ppp_factor=$3, output_qty=$4, output_unit=$5, facility_ids=$6, provider=$7, approach=$8, status=$9, notes=$10, updated_name=$11, updated_at=now() WHERE id = $1`,
        [r.id, b.revenueInr, b.pppFactor, b.outputQty, b.outputUnit || null, b.facilityIds?.length ? [...new Set(b.facilityIds)] : null, b.provider || null, b.approach, b.status, b.notes, req.user.name]);
      await audit(c, req, 'brsr.report', 'brsr_report', r.id, { fy, ...b });
      return { ok: true };
    });
  });

  app.put('/api/brsr/:fy/values', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const fy = fyOf(req);
    const b = z.object({ values: z.array(z.object({
      kpi: z.string().refine((k) => ENTERABLE.has(k), 'Not a KPI that can be entered'), value: z.number().min(-1e16).max(1e16).nullable(),
      note: z.string().trim().max(2000).default(''), documentId: z.string().uuid().nullable().default(null), owner: z.string().trim().max(120).nullable().default(null),
    })).min(1).max(200) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await ensure(c, tenant, fy, req.user.name);
      if (r.status === 'final') throw new AppError(`${fyLabel(fy)} is marked final; a super admin or admin reopens it first`, 409, 'FINAL');
      for (const x of b.values) {
        if (x.value != null && x.value < 0 && x.kpi !== 'water.consumption') throw new AppError(`${KPI.get(x.kpi)!.label}: a value cannot be negative`);
        if (AUTO.has(x.kpi) && x.value != null && !x.note) throw new AppError(`${KPI.get(x.kpi)!.label}: say why the value from entries is replaced`);
        if (x.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [x.documentId])).rowCount) throw notFound('Document');
        const prev = (await c.query(`SELECT value, note, document_id, owner_name FROM brsr_value WHERE report_id = $1 AND kpi = $2`, [r.id, x.kpi])).rows[0];
        const same = prev && num(prev.value) === x.value && prev.note === x.note && (prev.document_id ?? null) === x.documentId && (prev.owner_name ?? null) === (x.owner || null);
        if (same) continue;
        if (x.value == null && !x.note && !x.documentId && !x.owner) { await c.query(`DELETE FROM brsr_value WHERE report_id = $1 AND kpi = $2`, [r.id, x.kpi]); continue; }
        // any change sends the KPI back to open: it must be reviewed again
        await c.query(
          `INSERT INTO brsr_value (tenant_id, report_id, kpi, value, note, document_id, owner_name, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (report_id, kpi) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note, document_id = EXCLUDED.document_id, owner_name = EXCLUDED.owner_name,
             updated_name = EXCLUDED.updated_name, updated_at = now(), review = 'open', reviewed_name = NULL, reviewed_at = NULL`,
          [tenant, r.id, x.kpi, x.value, x.note, x.documentId, x.owner || null, req.user.name]);
      }
      await audit(c, req, 'brsr.values', 'brsr_report', r.id, { fy, values: b.values.map((x) => ({ kpi: x.kpi, value: x.value })) });
      return { ok: true };
    });
  });

  app.post('/api/brsr/:fy/review', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const fy = fyOf(req);
    const b = z.object({ kpis: z.array(z.string().refine((k) => ENTERABLE.has(k))).min(1).max(200), review: z.enum(['open', 'ready', 'reviewed']) }).parse(req.body);
    if (b.review === 'reviewed' && !['super_admin', 'admin'].includes(req.user.role)) throw forbidden(req.user.role === 'platform_admin' ? 'BRSR values are reviewed by the company\'s super admin or admin, not platform staff' : 'A super admin or admin of the company reviews BRSR values');
    return tenantTx(tenant, async (c) => {
      const r = await ensure(c, tenant, fy, req.user.name);
      if (r.status === 'final') throw new AppError(`${fyLabel(fy)} is marked final`, 409, 'FINAL');
      let skipped = 0;
      for (const k of b.kpis) {
        const prev = (await c.query(`SELECT updated_name FROM brsr_value WHERE report_id = $1 AND kpi = $2`, [r.id, k])).rows[0];
        if (b.review === 'reviewed' && prev?.updated_name === req.user.name) { skipped++; continue; }   // never review your own entry
        await c.query(
          `INSERT INTO brsr_value (tenant_id, report_id, kpi, review, reviewed_name, reviewed_at, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (report_id, kpi) DO UPDATE SET review = EXCLUDED.review, reviewed_name = EXCLUDED.reviewed_name, reviewed_at = EXCLUDED.reviewed_at`,
          [tenant, r.id, k, b.review, b.review === 'reviewed' ? req.user.name : null, b.review === 'reviewed' ? new Date() : null, prev ? prev.updated_name : null]);
      }
      await audit(c, req, `brsr.review.${b.review}`, 'brsr_report', r.id, { fy, kpis: b.kpis, skipped });
      return { ok: true, skipped };
    });
  });

  app.get('/api/brsr/:fy/suggest-partners', async (req) => {
    const tenant = requireTenant(req);
    const fy = fyOf(req);
    return tenantTx(tenant, async (c) => {
      const rows = (await c.query(
        `SELECT s.id, s.name, sum(l.usd)::float8 AS usd FROM purchase_line l JOIN supplier s ON s.id = l.supplier_id
          WHERE l.status = 'published' AND coalesce(l.purchase_date, l.period_start) BETWEEN $1 AND $2 AND l.usd > 0 GROUP BY 1, 2 ORDER BY 3 DESC`, [`${fy}-04-01`, `${fy + 1}-03-31`])).rows;
      const total = (await c.query(`SELECT coalesce(sum(usd), 0)::float8 AS t FROM purchase_line WHERE status = 'published' AND coalesce(purchase_date, period_start) BETWEEN $1 AND $2 AND usd > 0`, [`${fy}-04-01`, `${fy + 1}-03-31`])).rows[0].t as number;
      const out = []; let cum = 0;
      for (const r of rows) { const sh = total ? r.usd / total : 0; if (sh < 0.02 || cum >= 0.75) break; cum += sh; out.push({ supplierId: r.id, name: r.name, usd: r.usd, share: sh, cumulative: cum }); }
      return { total, suggestions: out };
    });
  });

  const partnerBody = z.object({
    side: z.enum(['upstream', 'downstream']), name: z.string().trim().min(2).max(200), supplierId: z.string().uuid().nullable().default(null),
    amountInr: z.number().min(0).max(1e16).nullable().default(null), attributable: z.number().min(0).max(1).nullable().default(null),
    values: z.record(z.string(), z.number().min(0).max(1e15).nullable()).default({}).refine((o) => Object.keys(o).every((k) => VC_KPIS.includes(k)), 'Only the value-chain KPIs'),
    note: z.string().trim().max(2000).default(''),
  });
  app.post('/api/brsr/:fy/partners', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const fy = fyOf(req), b = partnerBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.supplierId && !(await c.query(`SELECT 1 FROM supplier WHERE id = $1`, [b.supplierId])).rowCount) throw notFound('Supplier');
      const r = await ensure(c, tenant, fy, req.user.name);
      const p = (await c.query(`INSERT INTO brsr_partner (tenant_id, report_id, side, name, supplier_id, amount_inr, attributable, values, note, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, r.id, b.side, b.name, b.supplierId, b.amountInr, b.attributable, JSON.stringify(b.values), b.note, req.user.name])).rows[0];
      await audit(c, req, 'brsr.partner.create', 'brsr_partner', p.id, { fy, ...b });
      return { id: p.id };
    });
  });
  app.put('/api/brsr/partners/:pid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const pid = z.string().uuid().parse((req.params as { pid: string }).pid), b = partnerBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.supplierId && !(await c.query(`SELECT 1 FROM supplier WHERE id = $1`, [b.supplierId])).rowCount) throw notFound('Supplier');
      const r = await c.query(`UPDATE brsr_partner SET side=$2, name=$3, supplier_id=$4, amount_inr=$5, attributable=$6, values=$7, note=$8, updated_name=$9, updated_at=now() WHERE id = $1`,
        [pid, b.side, b.name, b.supplierId, b.amountInr, b.attributable, JSON.stringify(b.values), b.note, req.user.name]);
      if (!r.rowCount) throw notFound('Value-chain partner');
      await audit(c, req, 'brsr.partner.update', 'brsr_partner', pid, b);
      return { ok: true };
    });
  });
  app.delete('/api/brsr/partners/:pid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const pid = z.string().uuid().parse((req.params as { pid: string }).pid);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM brsr_partner WHERE id = $1 RETURNING name`, [pid]);
      if (!r.rowCount) throw notFound('Value-chain partner');
      await audit(c, req, 'brsr.partner.delete', 'brsr_partner', pid, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  app.get('/api/brsr/:fy/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const fy = fyOf(req);
    const d = await tenantTx(tenant, async (c) => {
      const cur = await yearData(c, tenant, fy), prev = await yearData(c, tenant, fy - 1);
      const partners = cur.report ? (await c.query(`SELECT * FROM brsr_partner WHERE report_id = $1 ORDER BY side, amount_inr DESC NULLS LAST`, [cur.report.id])).rows.map(partnerView) : [];
      const company = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string;
      await audit(c, req, 'brsr.export', 'brsr_report', cur.report?.id ?? null, { fy });
      return { cur, prev, partners, company };
    });
    const { cur, prev, partners, company } = d;
    const rep = reportView(cur.report, fy);
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const ws = wb.addWorksheet('BRSR Core');
    ws.addRow(['S. No.', 'Attribute', 'Parameter', 'Measurement', `${fyLabel(fy)} (current)`, `${fyLabel(fy - 1)} (previous)`, 'Data & assessment or assurance approach', 'Review']);
    let n = 0;
    const approach = (code: string) => {
      const k = KPI.get(code)!, row = cur.rows.find((r) => r.code === code)!;
      const head = code.split('.')[0]!;
      const src = k.kind === 'derived' ? 'Derived from the rows above' : row.source === 'entries' ? `From ${PRODUCT}: ${SOURCE[head] ?? 'approved entries'}` : row.source === 'override' ? `Value from entries replaced: ${row.note}` : row.source === 'typed' ? 'Entered' : 'Not available';
      return [src, row.note && row.source !== 'override' ? row.note : '', row.document ? `Evidence: ${row.document}` : ''].filter(Boolean).join(' · ');
    };
    for (const [a, name] of Object.entries(ATTRIBUTES)) {
      n++;
      ws.addRow([n, name]).font = { bold: true };
      for (const k of KPIS.filter((x) => x.attr === Number(a) && x.inCore)) {
        const row = cur.rows.find((r) => r.code === k.code)!;
        ws.addRow(['', '', `${k.group ? `${k.group}: ` : ''}${k.label}`, k.unit, row.value, prev.values[k.code] ?? null, approach(k.code), row.review]);
      }
    }
    styleHeader(ws, [7, 34, 70, 22, 18, 18, 70, 10]);
    ws.eachRow((r, i) => { if (i > 1) { r.getCell(5).numFmt = '#,##0.####'; r.getCell(6).numFmt = '#,##0.####'; r.alignment = { vertical: 'top', wrapText: true }; } });

    const inp = wb.addWorksheet('Inputs');
    inp.addRow(['Code', 'Attribute', 'Input', 'Unit', fyLabel(fy), fyLabel(fy - 1), 'Source', 'Note', 'Evidence', 'Owner', 'Review', 'Reviewed by']);
    for (const k of KPIS.filter((x) => x.kind !== 'derived')) {
      const row = cur.rows.find((r) => r.code === k.code)!;
      inp.addRow([k.code, k.attr, k.label, k.unit, row.value, prev.values[k.code] ?? null, row.source, row.note, row.document ?? '', row.owner ?? '', row.review, row.reviewedName ?? '']);
    }
    styleHeader(inp, [22, 9, 60, 14, 18, 18, 12, 40, 30, 18, 10, 18]);

    const vc = valueChain(partners, cur.values);
    const v = wb.addWorksheet('Value chain');
    v.addRow(['Side', 'Partner', 'Purchases / sales with the company (₹)', 'Share', 'Attributable share', ...VC_KPIS.map((k) => `${KPI.get(k)!.label} (${KPI.get(k)!.unit})`), 'Note']);
    for (const s of ['upstream', 'downstream'] as const) {
      for (const p of vc[s].partners) v.addRow([s, p.name, p.amountInr, p.share, p.attributable ?? 1, ...VC_KPIS.map((k) => p.values[k] ?? null), p.note]);
      v.addRow([s, 'Total attributable', vc[s].amount, vc[s].coverage, '', ...VC_KPIS.map((k) => vc[s].attributable[k] ?? null), 'coverage of total purchases / sales']).font = { bold: true };
    }
    styleHeader(v, [12, 34, 22, 10, 12, ...VC_KPIS.map(() => 18), 40]);
    v.eachRow((r, i) => { if (i > 1) { r.getCell(4).numFmt = '0.0%'; r.getCell(5).numFmt = '0%'; } });

    const det = wb.addWorksheet('Detail');
    det.addRow(['Scope 1 by gas', 'tCO2e']).font = { bold: true };
    for (const g of cur.auto.gases) det.addRow([g.gas, g.t]);
    det.addRow([]); det.addRow(['Energy by source', 'GJ', 'Renewable']).font = { bold: true };
    for (const e of cur.auto.detail.energy) det.addRow([e.source, e.gj, e.renewable ? 'yes' : 'no']);
    det.addRow([]); det.addRow(['Water', 'kL']).font = { bold: true };
    for (const w of cur.auto.detail.water) det.addRow([w.line, w.kl]);
    det.addRow([]); det.addRow(['Waste category', 'Route', 't']).font = { bold: true };
    for (const w of cur.auto.detail.waste) det.addRow([KPI.get(`waste.${w.cat}`)!.label, KPI.get(`waste.${w.route}`)!.label, w.t]);
    det.getColumn(1).width = 60; det.getColumn(2).width = 40; det.getColumn(3).width = 14;

    const m = wb.addWorksheet('Method');
    for (const line of [
      `${company} — BRSR Core ${fyLabel(fy)} (April ${fy} to March ${fy + 1}). Prepared in ${PRODUCT}. Status: ${rep.status}. ${rep.approach === 'none' ? 'No assessment or assurance.' : `Reasonable ${rep.approach}${rep.provider ? ` by ${rep.provider}` : ''}.`}`,
      'Format: SEBI LODR master circular Annexure 17A (BRSR Core), as amended by SEBI/HO/CFD/CFD-PoD-1/P/CIR/2025/42 (28 March 2025). Calculations: Industry Standards on Reporting of BRSR Core (ISF, December 2024).',
      `Revenue from operations: ₹${rep.revenueInr?.toLocaleString('en-IN') ?? '—'}. PPP conversion rate: ${rep.pppFactor} ₹ per international $ (IMF implied PPP conversion rate) → USD ${revenuePpp(cur.ctx)?.toFixed(2) ?? '—'} million (PPP). Intensities are per USD million (PPP).`,
      `Output for intensity per unit: ${rep.outputQty?.toLocaleString('en-IN') ?? '—'} ${rep.outputUnit ?? ''}.`,
      `Boundary: ${rep.facilityIds?.length ? `${rep.facilityIds.length} facilities` : 'every facility of the company'}; consolidation approach as set under Methodology & boundaries; approved entries only; entries crossing the year's ends split by days.`,
      'GHG: Scope 1 and Scope 2 (location-based) under the GHG Protocol with the factors shown in each entry (CEA for Indian grid electricity where set as the grid region).',
      'Energy: fuels converted with their calorific values; electricity, heat and cooling as bought; renewable = biomass, biogas and biofuels, and electricity covered by renewable certificates or contracts. GJ = kWh × 0.0036.',
      'Water: consumption = withdrawal − discharge from metered data. Waste: categories A–H under the Waste Management Rules 2016 (as amended); recovery and disposal routes from each entry\'s disposal method; incineration (with or without energy recovery) is a disposal operation.',
      'Value chain: partners each ≥ 2% of purchases or sales, up to 75% cumulative; their figures × the share attributable to business with the company.',
      ...(cur.problems.length ? ['', 'Checks still open:', ...cur.problems] : []),
    ]) m.addRow([line]);
    m.getColumn(1).width = 160;
    return sendWorkbook(reply, wb, `BRSR_Core_${fyLabel(fy).replace(/\s/g, '_')}.xlsx`);
  });
}
