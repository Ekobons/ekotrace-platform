/**
 * India CCTS / GEI tracker (Disclose → CCTS). One page per obligated entity and compliance year.
 *
 *   GET    /api/ccts                          entities with this year's GEI, CCC position and data in; sectors; facilities
 *   POST   /api/ccts                          add an obligated entity (super admin, admin)
 *   GET    /api/ccts/:id?fy=                  the entity, its targets, the year month by month, result, projection, CCC account, measures
 *   PUT    /api/ccts/:id                      change the entity (super admin, admin)
 *   DELETE /api/ccts/:id                      remove an entity with no CCC transactions (super admin, admin)
 *   PUT    /api/ccts/:id/targets              the notified targets per compliance year (super admin, admin)
 *   PUT    /api/ccts/:id/months               monthly output and typed emission components (super admin, admin, manager)
 *   POST   /api/ccts/:id/ccc                  record a CCC transaction: issued, bought, sold, surrendered (super admin, admin)
 *   DELETE /api/ccts/ccc/:txid                remove one
 *   POST   /api/ccts/:id/measures             add an emission-reduction measure (super admin, admin, manager); PUT/DELETE /api/ccts/measures/:mid
 *   GET    /api/ccts/:id/form-a?fy=           Excel: Form A draft (performance assessment), monthly data, method
 *
 * Fuel and grid electricity come from the approved EKOTRACE entries of the facilities inside the entity's boundary
 * (entries spanning several months are split by days), unless the entity is set to typed figures or a month overrides them.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { PRODUCT } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { SECTORS, account, calendar, fyLabel, fyMonths, month, year, type CccTxn, type MonthIn } from '../lib/ccts.js';

const uuid = z.string().uuid();
const idOf = (req: FastifyRequest, k = 'id') => uuid.parse((req.params as Record<string, string>)[k]);
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const num = (x: unknown) => (x == null ? null : Number(x));
const currentFy = () => { const d = new Date(); return d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };
const canSetup = (req: FastifyRequest) => ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
const canData = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const MONTH_KEYS = ['output', 'fuel_t', 'process_t', 'pfc_t', 'grid_mwh', 're_mwh', 'heat_t', 'export_mwh', 'export_ef', 'transfer_t'] as const;

const entityBody = z.object({
  name: z.string().trim().min(2).max(200), registrationNo: z.string().trim().max(80).nullable().default(null),
  sector: z.enum(Object.keys(SECTORS) as [string, ...string[]]), subSector: z.string().trim().max(120).nullable().default(null),
  state: z.string().trim().max(80).nullable().default(null), address: z.string().trim().max(400).nullable().default(null),
  outputUnit: z.string().trim().min(1).max(40).optional(), product: z.string().trim().max(120).nullable().default(null),
  baselineOutput: z.number().positive().max(1e12).nullable().default(null), baselineGei: z.number().positive().max(1e6).nullable().default(null),
  gridEf: z.number().min(0).max(5).default(0.727), energySource: z.enum(['entries', 'manual']).default('entries'),
  facilityIds: z.array(uuid).max(50).default([]), acva: z.string().trim().max(200).nullable().default(null),
  priceInr: z.number().min(0).max(1e6).nullable().default(null), notes: z.string().trim().max(4000).default(''),
});
type EntityBody = z.infer<typeof entityBody>;

async function entity(c: Tx, id: string) {
  const e = (await c.query(`SELECT * FROM ccts_entity WHERE id = $1`, [id])).rows[0];
  if (!e) throw notFound('CCTS entity');
  return e;
}
const entityView = (e: any) => ({
  id: e.id, name: e.name, registrationNo: e.registration_no, sector: e.sector, subSector: e.sub_sector, state: e.state, address: e.address,
  outputUnit: e.output_unit, product: e.product, baselineOutput: num(e.baseline_output), baselineGei: num(e.baseline_gei), gridEf: Number(e.grid_ef),
  energySource: e.energy_source as 'entries' | 'manual', facilityIds: e.facility_ids as string[], acva: e.acva, priceInr: num(e.price_inr), notes: e.notes,
  createdName: e.created_name, createdAt: e.created_at, updatedName: e.updated_name, updatedAt: e.updated_at,
});

/** Fuel (tCO2e, Scope 1 stationary combustion, fossil) and grid electricity (MWh) per month from approved entries, split by days. */
async function fromEntries(c: Tx, facilities: string[], fy: number) {
  const out = new Map<string, { fuel_t: number; grid_mwh: number; entries: number }>();
  if (!facilities.length) return out;
  const rows = (await c.query(
    `SELECT to_char(mo.m, 'YYYY-MM-DD') AS month,
            coalesce(sum(CASE WHEN cat.code = 'stationary_combustion' THEN a.co2e_direct * share END), 0)::float8 / 1000 AS fuel_t,
            coalesce(sum(CASE WHEN it.code = 'grid:electricity' AND u.dimension = 'electricity' THEN a.quantity * u.to_base * share END), 0)::float8 / 1000 AS grid_mwh,
            count(DISTINCT a.id)::int AS entries
       FROM generate_series($2::date, $3::date, interval '1 month') mo(m)
       JOIN activity a ON a.period_start <= (mo.m + interval '1 month - 1 day')::date AND a.period_end >= mo.m::date
       JOIN category cat ON cat.id = a.category_id JOIN item it ON it.id = a.item_id JOIN unit u ON u.code = a.unit
       CROSS JOIN LATERAL (SELECT ((least(a.period_end, (mo.m + interval '1 month - 1 day')::date) - greatest(a.period_start, mo.m::date) + 1)::numeric
                                   / (a.period_end - a.period_start + 1)) AS share) s
      WHERE a.facility_id = ANY($1) AND a.status = 'approved' AND (cat.code = 'stationary_combustion' OR it.code = 'grid:electricity')
      GROUP BY 1`, [facilities, `${fy}-04-01`, `${fy + 1}-03-01`])).rows;
  for (const r of rows) out.set(r.month, { fuel_t: r.fuel_t, grid_mwh: r.grid_mwh, entries: r.entries });
  return out;
}

async function yearOf(c: Tx, e: ReturnType<typeof entityView>, fy: number) {
  const typed = new Map((await c.query(`SELECT * FROM ccts_month WHERE entity_id = $1 AND month >= $2 AND month <= $3`, [e.id, `${fy}-04-01`, `${fy + 1}-03-01`])).rows.map((r) => [iso(r.month)!, r]));
  const fe = e.energySource === 'entries' ? await fromEntries(c, e.facilityIds, fy) : new Map();
  const target = (await c.query(`SELECT target_gei::float8 AS t FROM ccts_target WHERE entity_id = $1 AND fy = $2`, [e.id, fy])).rows[0]?.t ?? null;
  const months = fyMonths(fy).map((m) => {
    const t = typed.get(m);
    const inp: MonthIn = { month: m, fromEntries: fe.get(m) ?? { fuel_t: 0, grid_mwh: 0, entries: 0 }, output: null, fuel_t: null, process_t: null, pfc_t: null, grid_mwh: null, re_mwh: null, heat_t: null, export_mwh: null, export_ef: null, transfer_t: null };
    for (const k of MONTH_KEYS) inp[k] = num(t?.[k]);
    return { ...month(inp, e.gridEf, e.energySource), typed: Object.fromEntries(MONTH_KEYS.map((k) => [k, inp[k]])), entries: fe.get(m) ?? null, note: t?.note ?? '', updatedName: t?.updated_name ?? null };
  });
  return year(fy, months, target, e.baselineGei);
}

const txView = (t: any) => ({ id: t.id, kind: t.kind, fy: t.fy, quantity: Number(t.quantity), price_inr: num(t.price_inr), onDate: iso(t.on_date), reference: t.reference, note: t.note, createdName: t.created_name });
async function txns(c: Tx, id: string) {
  return (await c.query(`SELECT * FROM ccts_ccc WHERE entity_id = $1 ORDER BY on_date DESC, created_at DESC`, [id])).rows.map(txView);
}
const measureView = (m: any) => ({ id: m.id, fy: m.fy, title: m.title, yearDone: m.year_done, beforeT: num(m.before_t), afterT: num(m.after_t), investmentInr: num(m.investment_inr), note: m.note, createdName: m.created_name });

async function facilitiesCheck(c: Tx, ids: string[]) {
  if (!ids.length) return;
  const n = Number((await c.query(`SELECT count(*)::int AS n FROM org_node WHERE kind = 'facility' AND id = ANY($1)`, [ids])).rows[0].n);
  if (n !== new Set(ids).size) throw new AppError('One of the facilities was not found');
}
const cols = (b: EntityBody) => [b.name, b.registrationNo || null, b.sector, b.subSector || null, b.state || null, b.address || null, b.outputUnit ?? SECTORS[b.sector]!.unit,
  b.product || SECTORS[b.sector]!.product, b.baselineOutput, b.baselineGei, b.gridEf, b.energySource, [...new Set(b.facilityIds)], b.acva || null, b.priceInr, b.notes];

export async function cctsRoutes(app: FastifyInstance) {
  app.get('/api/ccts', async (req) => {
    const tenant = requireTenant(req);
    const fy = z.object({ fy: z.coerce.number().int().min(2023).max(2100).optional() }).parse(req.query).fy ?? currentFy();
    return tenantTx(tenant, async (c) => {
      const list = [];
      for (const r of (await c.query(`SELECT * FROM ccts_entity ORDER BY name`)).rows) {
        const e = entityView(r), y = await yearOf(c, e, fy), acc = account(await txns(c, e.id), fy, y.ccc, e.priceInr);
        list.push({ ...e, result: { gei: y.gei, target: y.target, monthsIn: y.monthsIn, ccc: y.ccc, projected: y.projection?.ccc ?? y.ccc, output: y.output, emissions: y.emissions }, held: acc.held });
      }
      return {
        fy, label: fyLabel(fy), entities: list, sectors: SECTORS, calendar: calendar(fy),
        facilities: (await c.query(`SELECT id, name, country FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows,
        canSetup: canSetup(req), canData: canData(req),
      };
    });
  });

  app.post('/api/ccts', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = entityBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await facilitiesCheck(c, b.facilityIds);
      const r = (await c.query(
        `INSERT INTO ccts_entity (tenant_id, name, registration_no, sector, sub_sector, state, address, output_unit, product, baseline_output, baseline_gei, grid_ef, energy_source, facility_ids, acva, price_inr, notes, created_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`, [tenant, ...cols(b), req.user.name])).rows[0];
      await audit(c, req, 'ccts.entity.create', 'ccts_entity', r.id, b);
      return { id: r.id };
    });
  });

  app.get('/api/ccts/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const fy = z.object({ fy: z.coerce.number().int().min(2023).max(2100).optional() }).parse(req.query).fy ?? currentFy();
    return tenantTx(tenant, async (c) => {
      const e = entityView(await entity(c, id));
      const y = await yearOf(c, e, fy);
      const T = await txns(c, id);
      const targets = (await c.query(`SELECT fy, target_gei::float8 AS "targetGei" FROM ccts_target WHERE entity_id = $1 ORDER BY fy`, [id])).rows;
      const prev = fy > 2023 ? await yearOf(c, e, fy - 1) : null;
      return {
        entity: e, fy, label: fyLabel(fy), targets, year: y, previous: prev && prev.monthsIn ? { fy: prev.fy, label: prev.label, gei: prev.gei, output: prev.output, emissions: prev.emissions, target: prev.target, ccc: prev.ccc } : null,
        account: account(T as CccTxn[], fy, y.ccc, e.priceInr), projectedAccount: y.projection ? account(T as CccTxn[], fy, y.projection.ccc, e.priceInr) : null, txns: T,
        measures: (await c.query(`SELECT * FROM ccts_measure WHERE entity_id = $1 ORDER BY fy DESC, created_at`, [id])).rows.map(measureView),
        calendar: calendar(fy), years: [...new Set([...targets.map((t: { fy: number }) => t.fy), fy, currentFy(), 2025])].sort((a, b) => b - a),
        facilities: (await c.query(`SELECT id, name FROM org_node WHERE id = ANY($1)`, [e.facilityIds])).rows,
        sectors: SECTORS, canSetup: canSetup(req), canData: canData(req),
      };
    });
  });

  app.put('/api/ccts/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req), b = entityBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await entity(c, id);
      await facilitiesCheck(c, b.facilityIds);
      await c.query(
        `UPDATE ccts_entity SET name=$2, registration_no=$3, sector=$4, sub_sector=$5, state=$6, address=$7, output_unit=$8, product=$9, baseline_output=$10, baseline_gei=$11, grid_ef=$12,
                energy_source=$13, facility_ids=$14, acva=$15, price_inr=$16, notes=$17, updated_name=$18, updated_at=now() WHERE id = $1`, [id, ...cols(b), req.user.name]);
      await audit(c, req, 'ccts.entity.update', 'ccts_entity', id, b);
      return { ok: true };
    });
  });

  app.delete('/api/ccts/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      const e = await entity(c, id);
      if ((await c.query(`SELECT 1 FROM ccts_ccc WHERE entity_id = $1 LIMIT 1`, [id])).rowCount) throw new AppError('This entity has CCC transactions; remove them first', 409, 'IN_USE');
      await c.query(`DELETE FROM ccts_entity WHERE id = $1`, [id]);
      await audit(c, req, 'ccts.entity.delete', 'ccts_entity', id, { name: e.name });
      return { ok: true };
    });
  });

  app.put('/api/ccts/:id/targets', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    const b = z.object({ targets: z.array(z.object({ fy: z.number().int().min(2023).max(2100), targetGei: z.number().positive().max(1e6).nullable() })).max(30) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const e = entityView(await entity(c, id));
      for (const t of b.targets) {
        if (t.targetGei == null) { await c.query(`DELETE FROM ccts_target WHERE entity_id = $1 AND fy = $2`, [id, t.fy]); continue; }
        await c.query(`INSERT INTO ccts_target (tenant_id, entity_id, fy, target_gei) VALUES ($1,$2,$3,$4) ON CONFLICT (entity_id, fy) DO UPDATE SET target_gei = EXCLUDED.target_gei`, [tenant, id, t.fy, t.targetGei]);
      }
      await audit(c, req, 'ccts.targets', 'ccts_entity', id, b);
      const warnings = b.targets.filter((t) => t.targetGei != null && e.baselineGei && t.targetGei > e.baselineGei).map((t) => `The ${fyLabel(t.fy)} target is above the baseline GEI — check it against the gazette schedule`);
      return { ok: true, warnings };
    });
  });

  app.put('/api/ccts/:id/months', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = idOf(req);
    const v = z.number().min(0).max(1e12).nullable().default(null);
    const b = z.object({ months: z.array(z.object({
      month: z.string().regex(/^\d{4}-\d{2}-01$/), output: v, fuel_t: v, process_t: v, pfc_t: v, grid_mwh: v, re_mwh: v, heat_t: v, export_mwh: v,
      export_ef: z.number().min(0).max(5).nullable().default(null), transfer_t: v, note: z.string().trim().max(1000).default(''),
    })).min(1).max(24) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await entity(c, id);
      for (const m of b.months) {
        const vals = MONTH_KEYS.map((k) => m[k]);
        if (vals.every((x) => x == null) && !m.note) { await c.query(`DELETE FROM ccts_month WHERE entity_id = $1 AND month = $2`, [id, m.month]); continue; }
        await c.query(
          `INSERT INTO ccts_month (tenant_id, entity_id, month, ${MONTH_KEYS.join(', ')}, note, updated_name, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
           ON CONFLICT (entity_id, month) DO UPDATE SET ${MONTH_KEYS.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}, note = EXCLUDED.note, updated_name = EXCLUDED.updated_name, updated_at = now()`,
          [tenant, id, m.month, ...vals, m.note, req.user.name]);
      }
      await audit(c, req, 'ccts.months', 'ccts_entity', id, { months: b.months.map((m) => m.month) });
      return { ok: true };
    });
  });

  app.post('/api/ccts/:id/ccc', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    const b = z.object({
      kind: z.enum(['issued', 'bought', 'sold', 'surrendered']), fy: z.number().int().min(2023).max(2100), quantity: z.number().int().positive().max(1e9),
      priceInr: z.number().min(0).max(1e6).nullable().default(null), onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reference: z.string().trim().max(200).nullable().default(null), note: z.string().trim().max(1000).default(''),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`SELECT 1 FROM ccts_entity WHERE id = $1 FOR UPDATE`, [id]);
      await entity(c, id);
      if (b.kind === 'sold' || b.kind === 'surrendered') {
        const held = account((await txns(c, id)) as CccTxn[], b.fy, null, null).held;
        if (b.quantity > held + 1e-9) throw new AppError(`Only ${held} CCCs are held; record the purchase or issuance first`);
      }
      const r = (await c.query(`INSERT INTO ccts_ccc (tenant_id, entity_id, kind, fy, quantity, price_inr, on_date, reference, note, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, id, b.kind, b.fy, b.quantity, b.priceInr, b.onDate, b.reference, b.note, req.user.name])).rows[0];
      await audit(c, req, `ccts.ccc.${b.kind}`, 'ccts_ccc', r.id, { entity: id, ...b });
      return { id: r.id };
    });
  });

  app.delete('/api/ccts/ccc/:txid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const txid = idOf(req, 'txid');
    return tenantTx(tenant, async (c) => {
      const t = (await c.query(`SELECT * FROM ccts_ccc WHERE id = $1`, [txid])).rows[0];
      if (!t) throw notFound('CCC transaction');
      if (t.kind === 'issued' || t.kind === 'bought') {
        const rest = (await txns(c, t.entity_id)).filter((x) => x.id !== txid) as CccTxn[];
        if (account(rest, t.fy, null, null).held < -1e-9) throw new AppError('Removing it would leave fewer CCCs than were sold or surrendered');
      }
      await c.query(`DELETE FROM ccts_ccc WHERE id = $1`, [txid]);
      await audit(c, req, 'ccts.ccc.delete', 'ccts_ccc', txid, txView(t));
      return { ok: true };
    });
  });

  const measureBody = z.object({
    fy: z.number().int().min(2023).max(2100), title: z.string().trim().min(2).max(300), yearDone: z.number().int().min(1990).max(2100).nullable().default(null),
    beforeT: z.number().min(0).max(1e12).nullable().default(null), afterT: z.number().min(0).max(1e12).nullable().default(null),
    investmentInr: z.number().min(0).max(1e15).nullable().default(null), note: z.string().trim().max(1000).default(''),
  });
  app.post('/api/ccts/:id/measures', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = idOf(req), b = measureBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await entity(c, id);
      const r = (await c.query(`INSERT INTO ccts_measure (tenant_id, entity_id, fy, title, year_done, before_t, after_t, investment_inr, note, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenant, id, b.fy, b.title, b.yearDone, b.beforeT, b.afterT, b.investmentInr, b.note, req.user.name])).rows[0];
      await audit(c, req, 'ccts.measure.create', 'ccts_measure', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/ccts/measures/:mid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const mid = idOf(req, 'mid'), b = measureBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE ccts_measure SET fy=$2, title=$3, year_done=$4, before_t=$5, after_t=$6, investment_inr=$7, note=$8 WHERE id = $1`, [mid, b.fy, b.title, b.yearDone, b.beforeT, b.afterT, b.investmentInr, b.note]);
      if (!r.rowCount) throw notFound('Measure');
      await audit(c, req, 'ccts.measure.update', 'ccts_measure', mid, b);
      return { ok: true };
    });
  });
  app.delete('/api/ccts/measures/:mid', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const mid = idOf(req, 'mid');
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`DELETE FROM ccts_measure WHERE id = $1 RETURNING title`, [mid]);
      if (!r.rowCount) throw notFound('Measure');
      await audit(c, req, 'ccts.measure.delete', 'ccts_measure', mid, { title: r.rows[0].title });
      return { ok: true };
    });
  });

  app.get('/api/ccts/:id/form-a', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = idOf(req);
    const fy = z.object({ fy: z.coerce.number().int().min(2023).max(2100) }).parse(req.query).fy;
    const d = await tenantTx(tenant, async (c) => {
      const e = entityView(await entity(c, id));
      const y = await yearOf(c, e, fy);
      const acc = account((await txns(c, id)) as CccTxn[], fy, y.ccc, e.priceInr);
      const measures = (await c.query(`SELECT * FROM ccts_measure WHERE entity_id = $1 AND fy = $2 ORDER BY created_at`, [id, fy])).rows.map(measureView);
      const facs = (await c.query(`SELECT name FROM org_node WHERE id = ANY($1) ORDER BY name`, [e.facilityIds])).rows.map((r) => r.name as string);
      await audit(c, req, 'ccts.formA.export', 'ccts_entity', id, { fy });
      return { e, y, acc, measures, facs };
    });
    const { e, y, acc, measures, facs } = d;
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const a = wb.addWorksheet('Form A draft');
    const kv: [string, unknown][] = [
      ['FORM A — Performance Assessment Document (draft prepared in ' + PRODUCT + ')', null],
      ['Not the official BEE pro-forma: copy the values into the form issued by BEE.', null],
      ['', null],
      ['Compliance year', fyLabel(fy)], ['Name of the obligated entity', e.name], ['Registration no.', e.registrationNo ?? ''], ['Sector', SECTORS[e.sector]?.label ?? e.sector],
      ['Sub-sector', e.subSector ?? ''], ['State', e.state ?? ''], ['Accredited carbon verification agency (ACVA)', e.acva ?? ''],
      ['', null],
      [`Equivalent product output (${e.outputUnit})`, y.output], ['Total GHG emissions (tCO2e)', y.emissions], [`Achieved GEI (tCO2e/${e.outputUnit})`, y.gei],
      [`Target GEI ${fyLabel(fy)} (tCO2e/${e.outputUnit})`, y.target], [`Baseline GEI 2023-24 (tCO2e/${e.outputUnit})`, e.baselineGei], [`Baseline output 2023-24 (${e.outputUnit})`, e.baselineOutput],
      ['CCCs eligible for issuance (tCO2e)', y.ccc != null && y.ccc > 0 ? Math.floor(y.ccc) : 0], ['CCCs to surrender (tCO2e)', y.ccc != null && y.ccc < 0 ? Math.ceil(-y.ccc) : 0],
      ['CCCs held now', acc.held], ['Months with output and emissions', `${y.monthsIn} of 12`],
    ];
    for (const [k, v] of kv) a.addRow([k, v as ExcelJS.CellValue]);
    a.getColumn(1).width = 58; a.getColumn(2).width = 24;
    a.getRow(1).font = { bold: true, size: 13 }; a.getRow(2).font = { italic: true, color: { argb: 'FF8A5A00' } };
    a.eachRow((r, i) => { if (i > 3) { r.getCell(1).font = { bold: true }; if (typeof r.getCell(2).value === 'number') r.getCell(2).numFmt = '#,##0.0000'; } });
    a.addRow([]); a.addRow(['Emission-reduction measures']).font = { bold: true };
    a.addRow(['Measure', 'Year implemented', 'tCO2e a year before', 'tCO2e a year after', 'Investment (INR)']).font = { bold: true };
    for (const m of measures) a.addRow([m.title, m.yearDone, m.beforeT, m.afterT, m.investmentInr]);
    a.getColumn(3).width = 20; a.getColumn(4).width = 20; a.getColumn(5).width = 18;

    const ms = wb.addWorksheet('Monthly data');
    ms.addRow(['Month', `Output (${e.outputUnit})`, 'Fuel combustion tCO2e', 'Fuel from', 'Process tCO2e', 'PFC tCO2e', 'Grid electricity MWh', 'Electricity from', 'Of which renewable MWh',
      'Electricity tCO2e', 'Purchased heat tCO2e', 'Exported power tCO2e', 'CO2 transferred out t', 'Total tCO2e', 'GEI', 'Complete', 'Notes / problems']);
    for (const m of y.months) ms.addRow([m.month.slice(0, 7), m.output, m.fuel, m.sources.fuel, m.process, m.pfc, m.gridMwh, m.sources.grid, m.reMwh, m.electricity, m.heat, -m.exported, -m.transfer, m.total, m.gei, m.complete ? 'yes' : 'no', [(m as { note?: string }).note, ...m.problems].filter(Boolean).join(' · ')]);
    ms.addRow(['Year', y.output, y.components.fuel, '', y.components.process, y.components.pfc, null, '', null, y.components.electricity, y.components.heat, -y.components.exported, -y.components.transfer, y.emissions, y.gei]).font = { bold: true };
    styleHeader(ms, [10, 16, 18, 10, 14, 12, 16, 12, 16, 16, 16, 16, 16, 14, 12, 10, 50]);
    ms.eachRow((r, i) => { if (i > 1) for (const k of [2, 3, 5, 6, 7, 9, 10, 11, 12, 13, 14]) r.getCell(k).numFmt = '#,##0.000'; if (i > 1) r.getCell(15).numFmt = '0.0000'; });

    const mt = wb.addWorksheet('Method');
    for (const line of [
      'BEE, Detailed Procedure for Compliance Mechanism under CCTS (v1.0, July 2024), Annex III eq. II.',
      'Total emissions = direct energy + direct process (CO2, PFCs; GWP AR5) + purchased electricity and heat − exported power − CO2 transferred out for permanent storage or use.',
      `Purchased electricity: grid MWh less documented renewable MWh × ${e.gridEf} tCO2/MWh (CEA average of the baseline year, held constant).`,
      'Exported power: MWh × its heat-rate factor where given, else the grid factor.',
      e.energySource === 'entries' ? `Fuel combustion and grid electricity: approved ${PRODUCT} entries of ${facs.join(', ') || '(no facility linked)'}; Scope 1 stationary combustion (fossil; biogenic CO2 outside the boundary); entries spanning several months split by days; a typed month value replaces the entries.` : 'Fuel combustion and grid electricity: typed per month.',
      'GEI = total emissions ÷ equivalent product output, over the months with both output and emissions.',
      'CCCs = (target GEI − achieved GEI) × output: positive = eligible for issuance, negative = to surrender. Environmental compensation on CCCs not surrendered: 2 × the average CCC price of the trading cycle.',
      'Excluded: biomass and biogenic CO2, approved alternate fuels in co-processing, colony and construction energy, transport outside the plant, office refrigerants.',
    ]) mt.addRow([line]);
    mt.getColumn(1).width = 150;
    const fname = `CCTS_FormA_${e.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${fyLabel(fy)}.xlsx`;
    return sendWorkbook(reply, wb, fname);
  });
}

