/**
 * Meters and their readings.
 *
 *   Register   per facility: what the meter measures (an item and the rest of the entry,
 *              saved from Add data — supplier, grid region, fuel, waste process…), how it
 *              reads (register / per interval), how often (hour, day, week, month,
 *              irregular), unit, multiplier, register maximum, its id in the sending system.
 *   Readings   arrive through the API (/api/v1/meter-readings with an API key), or are
 *              pasted / uploaded / typed. Same meter and time again = a correction.
 *   Entries    one per meter and calendar month (company time zone), created or updated
 *              when a month has ended: consumption, coverage, gaps and resets in the steps;
 *              partly covered months scaled up and marked estimated. An approved entry is
 *              never changed by new readings: the difference is reported instead.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { convert, meterMonths, tzOffset, type MeterMonth } from '@ekotrace/calc';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { newToken, sha256 } from '../lib/password.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { calcInputSchema, calculate, loadItem, type CalcInput } from './calc.service.js';
import { contextFor, tenantSettings } from './activity.routes.js';
import { refdata } from './refdata.js';

const FREQ = ['hour', 'day', 'week', 'month', 'irregular'] as const;
export const FREQ_LABEL: Record<(typeof FREQ)[number], string> = { hour: 'hourly', day: 'daily', week: 'weekly', month: 'monthly', irregular: 'irregular' };

/** The rest of the entry, as in Add data (no quantity, period or facility). */
const templateSchema = calcInputSchema.omit({ itemId: true, unit: true, quantity: true, periodStart: true, periodEnd: true, region: true, gwpSet: true }).partial().default({});

const meterBody = z.object({
  facilityId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  serial: z.string().trim().max(80).optional().nullable(),
  externalId: z.string().trim().min(1).max(120).regex(/^[\w.:\-/]+$/, 'Letters, digits and . : - / _ only').optional(),
  readingType: z.enum(['cumulative', 'interval']),
  frequency: z.enum(FREQ),
  unit: z.string().min(1),
  multiplier: z.number().finite().positive().default(1),
  rollover: z.number().finite().positive().optional().nullable(),
  itemId: z.number().int().positive(),
  template: templateSchema,
  gapFill: z.enum(['prorate', 'none']).default('prorate'),
  autoEntries: z.boolean().default(true),
  note: z.string().max(500).optional().nullable(),
  /** utility account / premise number printed on the bills */
  accountNo: z.string().trim().max(60).optional().nullable(),
});
type MeterBody = z.infer<typeof meterBody>;

export interface MeterRow {
  id: string; tenant_id: string; facility_id: string; name: string; serial: string | null; external_id: string; reading_type: 'cumulative' | 'interval';
  frequency: (typeof FREQ)[number]; unit: string; multiplier: string; rollover: string | null; item_id: number; template: Record<string, unknown>;
  gap_fill: 'prorate' | 'none'; auto_entries: boolean; active: boolean;
}

/**
 * The entry for one month: the meter's template with the month's consumption put where
 * the reading belongs (quantity; waste tonnes or flow; vehicle spend), converted to the unit
 * the entry needs.
 */
export async function inputFor(m: Pick<MeterRow, 'item_id' | 'template' | 'unit'>, qty: number, period: { periodStart: string; periodEnd: string }): Promise<CalcInput> {
  const item = await loadItem(m.item_id);
  const { units } = await refdata();
  const t = structuredClone(m.template) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const base = { ...t, itemId: m.item_id, ...period };
  if (item.calc_method === 'waste') {
    const w = t.waste ?? {};
    const to = (u: string) => convert(units, qty, m.unit, u);
    if (w.process === 'incineration') { if (!w.streams?.length) throw new AppError('The meter\'s waste type is missing'); w.streams[0].tonnes = to('t'); }
    else if (w.process === 'composting' || w.process === 'ad') w.tonnes = to('t');
    else if (w.process === 'wastewater') { if (w.mgPerL !== undefined) w.flowM3 = to('m3'); else w.organicsKg = to('kg'); }
    else throw new AppError('Landfill methane is modelled per year: it cannot come from a meter');
    return { ...base, unit: w.process === 'wastewater' ? 'kg' : 't', waste: w } as CalcInput;
  }
  if (item.calc_method === 'vehicle' && t.vehicle?.method === 'spend') throw new AppError('Spend is not a meter reading: use distance, fuel or electricity');
  if (item.calc_method === 'fugitive') return { ...base, unit: m.unit, fugitive: { method: 'quantity', released: qty } } as CalcInput;
  return { ...base, unit: m.unit, quantity: qty } as CalcInput;
}

/** What the meter's readings give per month, in the company time zone. */
export async function monthsOf(c: Tx, m: MeterRow, tz: string) {
  const rows = (await c.query('SELECT extract(epoch FROM ts) * 1000 AS t, extract(epoch FROM from_ts) * 1000 AS f, value FROM meter_reading WHERE meter_id = $1 ORDER BY ts', [m.id])).rows;
  return meterMonths({
    type: m.reading_type, frequency: m.frequency, multiplier: Number(m.multiplier), rollover: m.rollover ? Number(m.rollover) : null, gapFill: m.gap_fill, tz,
    readings: rows.map((r) => ({ t: Number(r.t), v: Number(r.value), ...(r.f != null ? { from: Number(r.f) } : {}) })),
  });
}

const localDate = (t: number, tz: string) => new Date(t + tzOffset(tz, t)).toISOString().slice(0, 10);
const num6 = (x: number) => Number(x.toPrecision(6));

export interface Actor { id: string | null; name: string; req: FastifyRequest | { user: { id: null; name: string; tenantId: string }; ip: string } }

/**
 * Create or update the monthly entries of a meter (months that have ended, with readings).
 * Approved entries are left as they are; a difference is reported.
 */
export async function syncMeter(c: Tx, t: { id: string; gwp_set: string; timezone: string }, m: MeterRow, actor: Actor, only?: Set<string>) {
  const out = { created: 0, updated: 0, unchanged: 0, locked: [] as string[], problems: [] as string[] };
  const fac = (await c.query('SELECT id, country, grid_region FROM org_node WHERE id = $1', [m.facility_id])).rows[0];
  const { months } = await monthsOf(c, m, t.timezone);
  for (const mo of months) {
    if (!mo.closed || mo.coverage === 0 || (only && !only.has(mo.month))) continue;
    const period = { periodStart: localDate(mo.start, t.timezone), periodEnd: localDate(mo.end - 1, t.timezone) };
    await c.query('SAVEPOINT meter_month');
    try {
      const input = await inputFor(m, mo.consumption, period);
      const { result, item, gwpSet, stored } = await calculate(input, contextFor(c, t.gwp_set, fac.country, fac));
      const steps = [
        `Meter ${m.name} (${m.external_id}), ${FREQ_LABEL[m.frequency]} ${m.reading_type === 'cumulative' ? 'register readings' : 'interval readings'}: ${mo.readings} reading${mo.readings === 1 ? '' : 's'} in ${mo.month}`
          + `${Number(m.multiplier) !== 1 ? `, × multiplier ${Number(m.multiplier)}` : ''}`,
        mo.filled
          ? `Measured ${num6(mo.measured)} ${m.unit} covering ${(mo.coverage * 100).toFixed(1)}% of the month → ${num6(mo.consumption)} ${m.unit} for the whole month (estimated)`
          : `Consumption in ${mo.month}: ${num6(mo.consumption)} ${m.unit}`,
        ...result.steps,
      ];
      const warnings = [...mo.issues.map((i) => `Meter: ${i}`), ...result.warnings];
      const dataType = mo.filled ? 'estimated' : 'actual';
      const inputs = { ...stored.inputs, meter: { id: m.id, month: mo.month, readings: mo.readings, coverage: mo.coverage, measured: mo.measured, filled: mo.filled } };
      const old = (await c.query('SELECT * FROM activity WHERE meter_id = $1 AND period_start = $2', [m.id, period.periodStart])).rows[0];
      const vals = [result.totals.direct, result.totals.wtt, result.totals.outside_scopes, result.totals.memo, result.totals.scope2, result.totals.scope2_market, result.totals.td_loss, result.totals.scope3];
      if (!old) {
        const a = (await c.query(
          `INSERT INTO activity (tenant_id, facility_id, category_id, item_id, period_start, period_end, quantity, unit, inputs, data_type, gwp_set,
                                 co2e_direct, co2e_wtt, co2_biogenic, co2e_memo, co2e_scope2, co2e_scope2_market, co2e_td, co2e_scope3,
                                 steps, warnings, note, created_by, factors, meter_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
          [t.id, m.facility_id, item.category_id, item.id, period.periodStart, period.periodEnd, stored.quantity, stored.unit, JSON.stringify(inputs), dataType, gwpSet,
           ...vals, JSON.stringify(steps), JSON.stringify(warnings), `From meter ${m.name}`, actor.id ?? actor.name, JSON.stringify(result.factors), m.id])).rows[0];
        await lines(c, a.id, t.id, result.lines);
        out.created++;
      } else {
        const same = Math.abs(Number(old.quantity) - stored.quantity) < 1e-9 * Math.max(1, stored.quantity)
          && Math.abs(Number(old.co2e_direct) - result.totals.direct) < 1e-6 && Math.abs(Number(old.co2e_scope2) - result.totals.scope2) < 1e-6
          && Math.abs(Number(old.co2e_scope3) - result.totals.scope3) < 1e-6 && JSON.stringify(old.warnings) === JSON.stringify(warnings);
        if (same) { out.unchanged++; await c.query('RELEASE SAVEPOINT meter_month'); continue; }
        if (old.status === 'approved') {
          out.locked.push(`${mo.month}: approved entry has ${num6(Number(old.quantity))} ${old.unit}; readings now give ${num6(stored.quantity)} ${stored.unit} — not changed`);
          await c.query('RELEASE SAVEPOINT meter_month'); continue;
        }
        await c.query(
          `UPDATE activity SET quantity=$2, unit=$3, inputs=$4, data_type=$5, gwp_set=$6, co2e_direct=$7, co2e_wtt=$8, co2_biogenic=$9, co2e_memo=$10, co2e_scope2=$11,
                  co2e_scope2_market=$12, co2e_td=$13, co2e_scope3=$14, steps=$15, warnings=$16, factors=$17, item_id=$18, category_id=$19, updated_at=now() WHERE id=$1`,
          [old.id, stored.quantity, stored.unit, JSON.stringify(inputs), dataType, gwpSet, ...vals, JSON.stringify(steps), JSON.stringify(warnings), JSON.stringify(result.factors), item.id, item.category_id]);
        await c.query('DELETE FROM activity_result WHERE activity_id = $1', [old.id]);
        await lines(c, old.id, t.id, result.lines);
        await audit(c, actor.req as FastifyRequest, 'activity.meter_update', 'activity', old.id, { meter: m.name, month: mo.month, before: Number(old.quantity), after: stored.quantity });
        out.updated++;
      }
      await c.query('RELEASE SAVEPOINT meter_month');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT meter_month');
      out.problems.push(`${mo.month}: ${(e as Error).message}`);
    }
  }
  if (out.created || out.updated) await audit(c, actor.req as FastifyRequest, 'meter.sync', 'meter', m.id, { meter: m.name, created: out.created, updated: out.updated, locked: out.locked.length });
  return out;
}

async function lines(c: Tx, activityId: string, tenantId: string, ls: { basis: string; gas: string; kgGas: number | null; kgCo2e: number; factorId: number | null; method: string }[]) {
  if (!ls.length) return;
  await c.query(
    `INSERT INTO activity_result (activity_id, tenant_id, basis, gas, kg_gas, kg_co2e, factor_id, method)
     SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::bigint[], $8::text[])`,
    [activityId, tenantId, ls.map((l) => l.basis), ls.map((l) => l.gas), ls.map((l) => l.kgGas), ls.map((l) => l.kgCo2e), ls.map((l) => l.factorId), ls.map((l) => l.method)]);
}

// --------------------------------------------------------------------- readings --
/** A timestamp with a zone ("Z" or "+04:00"); without one it is read in the company time zone. */
export function parseTs(s: string, tz: string): number | null {
  const x = s.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(x)) return null;
  // a date that does not exist (31 September) is refused, not rolled over to the next month
  const [y, mo, d] = x.slice(0, 10).split('-').map(Number);
  if (new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDate() !== d) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(x)) { const t = Date.parse(x); return Number.isFinite(t) ? t : null; }
  const asUtc = Date.parse(`${x.length === 10 ? `${x}T00:00` : x}Z`);
  if (!Number.isFinite(asUtc)) return null;
  return asUtc - tzOffset(tz, asUtc - tzOffset(tz, asUtc));
}

export const readingSchema = z.object({
  /** time of the reading (end of the interval); ISO 8601, e.g. 2026-03-01T00:00:00+04:00 */
  timestamp: z.string().min(1).max(40),
  value: z.number().finite(),
  /** interval readings: start of the interval (optional) */
  start: z.string().min(1).max(40).optional(),
});

/**
 * Store readings for one meter (upsert by time). Returns what changed and which months
 * (company time zone) the readings touch.
 */
export async function storeReadings(c: Tx, tenantId: string, m: MeterRow, rows: z.infer<typeof readingSchema>[], source: 'api' | 'upload' | 'manual', tz: string) {
  const rejected: { index: number; reason: string }[] = [];
  const ok: { t: number; f: number | null; v: number }[] = [];
  rows.forEach((r, index) => {
    const t = parseTs(r.timestamp, tz);
    const f = r.start ? parseTs(r.start, tz) : null;
    if (t === null) return rejected.push({ index, reason: `timestamp "${r.timestamp}" not understood (use ISO 8601, e.g. 2026-03-01T00:00:00+04:00)` });
    if (r.start && f === null) return rejected.push({ index, reason: `start "${r.start}" not understood` });
    if (f !== null && f >= t) return rejected.push({ index, reason: 'start must be before the timestamp' });
    if (t > Date.now() + 36 * 3_600_000) return rejected.push({ index, reason: 'timestamp is in the future' });
    if (m.reading_type === 'interval' && r.value < 0) return rejected.push({ index, reason: 'negative consumption' });
    ok.push({ t, f, v: r.value });
  });
  // Same time twice in one batch: the last one counts.
  const byT = new Map(ok.map((x) => [x.t, x]));
  const list = [...byT.values()];
  let inserted = 0, updated = 0;
  if (list.length) {
    const r = await c.query(
      `INSERT INTO meter_reading (tenant_id, meter_id, ts, from_ts, value, source)
       SELECT $1, $2, to_timestamp(t / 1000.0), CASE WHEN f IS NULL THEN NULL ELSE to_timestamp(f / 1000.0) END, v, $3
         FROM unnest($4::float8[], $5::float8[], $6::numeric[]) AS x(t, f, v)
       ON CONFLICT (meter_id, ts) DO UPDATE SET value = EXCLUDED.value, from_ts = EXCLUDED.from_ts, source = EXCLUDED.source, received_at = now()
         WHERE meter_reading.value IS DISTINCT FROM EXCLUDED.value OR meter_reading.from_ts IS DISTINCT FROM EXCLUDED.from_ts
       RETURNING (xmax = 0) AS inserted`,
      [tenantId, m.id, source, list.map((x) => x.t), list.map((x) => x.f), list.map((x) => x.v)]);
    for (const x of r.rows) x.inserted ? inserted++ : updated++;
  }
  // Months touched (an interval reading also touches the month its start is in; a register reading the next interval too).
  const months = new Set<string>();
  const mon = (t: number) => new Date(t + tzOffset(tz, t)).toISOString().slice(0, 7);
  for (const x of list) {
    months.add(mon(x.t - 1)); months.add(mon(x.t));
    if (x.f !== null) months.add(mon(x.f));
  }
  if (m.reading_type === 'cumulative' && list.length) {
    // the interval before / after a register reading changes too
    const near = (await c.query(
      `SELECT extract(epoch FROM (SELECT max(ts) FROM meter_reading WHERE meter_id = $1 AND ts < to_timestamp($2 / 1000.0))) * 1000 AS a,
              extract(epoch FROM (SELECT min(ts) FROM meter_reading WHERE meter_id = $1 AND ts > to_timestamp($3 / 1000.0))) * 1000 AS b`,
      [m.id, Math.min(...list.map((x) => x.t)), Math.max(...list.map((x) => x.t))])).rows[0];
    const lo = near.a != null ? Number(near.a) : Math.min(...list.map((x) => x.t));
    const hi = near.b != null ? Number(near.b) : Math.max(...list.map((x) => x.t));
    for (let t = lo; t <= hi + 1; t += 20 * 86_400_000) months.add(mon(t));
    months.add(mon(hi));
  }
  return { inserted, updated, unchanged: list.length - inserted - updated, rejected, months };
}

/**
 * Readings received through the API, kept for review: each compared with what the meter
 * already has — new, a correction (different value at the same time), the same again
 * (duplicate, skipped), or inside a period a booked bill already covers (conflict, skipped).
 */
export async function stageReadings(c: Tx, tenantId: string, batchId: string, m: MeterRow, rows: z.infer<typeof readingSchema>[], tz: string) {
  const rejected: { index: number; reason: string }[] = [];
  const ok = new Map<number, { t: number; f: number | null; v: number }>();
  rows.forEach((r, index) => {
    const t = parseTs(r.timestamp, tz), f = r.start ? parseTs(r.start, tz) : null;
    if (t === null) return rejected.push({ index, reason: `timestamp "${r.timestamp}" not understood (use ISO 8601, e.g. 2026-03-01T00:00:00+04:00)` });
    if (r.start && f === null) return rejected.push({ index, reason: `start "${r.start}" not understood` });
    if (f !== null && f >= t) return rejected.push({ index, reason: 'start must be before the timestamp' });
    if (t > Date.now() + 36 * 3_600_000) return rejected.push({ index, reason: 'timestamp is in the future' });
    if (m.reading_type === 'interval' && r.value < 0) return rejected.push({ index, reason: 'negative consumption' });
    ok.set(t, { t, f, v: r.value });
  });
  const list = [...ok.values()];
  if (list.length) await c.query(
    `INSERT INTO reading_staged (batch_id, tenant_id, meter_id, ts, from_ts, value, state, old_value, note)
     SELECT $1, $2, $3, x.ts, x.fr, x.v,
            CASE WHEN b.id IS NOT NULL THEN 'conflict' WHEN o.ts IS NOT NULL AND (r.ts IS NULL OR r.value <> x.v) THEN 'same' WHEN r.ts IS NULL THEN 'new'
                 WHEN r.value = x.v AND r.from_ts IS NOT DISTINCT FROM x.fr THEN 'same' ELSE 'changed' END,
            r.value, CASE WHEN b.id IS NOT NULL THEN 'a booked bill covers ' || b.period_from || ' – ' || b.period_to WHEN o.ts IS NOT NULL AND (r.ts IS NULL OR r.value <> x.v) THEN 'also in an earlier batch waiting for review' END
       FROM (SELECT to_timestamp(t / 1000.0) AS ts, CASE WHEN f IS NULL THEN NULL ELSE to_timestamp(f / 1000.0) END AS fr, v
               FROM unnest($4::float8[], $5::float8[], $6::numeric[]) AS u(t, f, v)) x
       LEFT JOIN meter_reading r ON r.meter_id = $3 AND r.ts = x.ts
       LEFT JOIN LATERAL (SELECT o.ts FROM reading_staged o JOIN reading_batch ob ON ob.id = o.batch_id
                           WHERE o.meter_id = $3 AND o.ts = x.ts AND o.batch_id <> $1 AND ob.status = 'review' AND o.value = x.v LIMIT 1) o ON true
       LEFT JOIN LATERAL (SELECT bl.id, bl.period_from, bl.period_to FROM bill bl JOIN meter_reading br ON br.meter_id = bl.meter_id AND br.ts = bl.reading_ts
                           WHERE bl.meter_id = $3 AND bl.status = 'confirmed' AND x.ts > coalesce(br.from_ts, br.ts) AND coalesce(x.fr, x.ts) < br.ts AND (r.source IS NULL OR r.source <> 'bill') LIMIT 1) b ON true
     ON CONFLICT (batch_id, meter_id, ts) DO UPDATE SET value = EXCLUDED.value, from_ts = EXCLUDED.from_ts, state = EXCLUDED.state, old_value = EXCLUDED.old_value, note = EXCLUDED.note`,
    [batchId, tenantId, m.id, list.map((x) => x.t), list.map((x) => x.f), list.map((x) => x.v)]);
  return { staged: list.length, rejected };
}

/** Publish a reviewed batch: new readings and corrections are stored, duplicates and conflicts skipped; entries follow. */
export async function publishReadings(c: Tx, t: { id: string; gwp_set: string; timezone: string }, batchId: string, actor: Actor) {
  const rows = (await c.query(`SELECT meter_id, ts, from_ts, value FROM reading_staged WHERE batch_id = $1 AND state IN ('new','changed') ORDER BY meter_id, ts`, [batchId])).rows;
  const per = new Map<string, z.infer<typeof readingSchema>[]>();
  for (const r of rows) { const a = per.get(r.meter_id) ?? []; a.push({ timestamp: new Date(r.ts).toISOString(), value: Number(r.value), ...(r.from_ts ? { start: new Date(r.from_ts).toISOString() } : {}) }); per.set(r.meter_id, a); }
  let inserted = 0, updated = 0, created = 0, changed = 0;
  const locked: string[] = [];
  for (const [mid, list] of per) {
    const m = (await c.query('SELECT * FROM meter WHERE id = $1', [mid])).rows[0] as MeterRow;
    const s = await storeReadings(c, t.id, m, list, 'api', t.timezone);
    inserted += s.inserted; updated += s.updated;
    if (m.auto_entries && (s.inserted || s.updated)) { const y = await syncMeter(c, t, m, actor, s.months); created += y.created; changed += y.updated; locked.push(...y.locked); }
  }
  return { inserted, updated, entries: { created, updated: changed, locked } };
}

// ------------------------------------------------------------------------ routes --
const SELECT_METER = `
  SELECT m.*, f.name AS facility, i.name AS item, i.code AS item_code, c.code AS category, c.name AS category_name, c.calc_method,
         (SELECT count(*)::int FROM meter_reading r WHERE r.meter_id = m.id) AS readings,
         (SELECT json_build_object('ts', r.ts, 'value', r.value, 'received_at', r.received_at) FROM meter_reading r WHERE r.meter_id = m.id ORDER BY r.ts DESC LIMIT 1) AS last,
         (SELECT count(*)::int FROM activity a WHERE a.meter_id = m.id) AS entries
    FROM meter m JOIN org_node f ON f.id = m.facility_id JOIN item i ON i.id = m.item_id
    JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id`;

async function facilityFor(c: Tx, req: FastifyRequest, facilityId: string, manage: boolean) {
  const f = (await c.query(`SELECT id, name, country, grid_region FROM org_node WHERE id = $1 AND kind = 'facility'`, [facilityId])).rows[0];
  if (!f) throw notFound('Facility');
  const scope = await scopeOf(c, req.user);
  assertCan(manage ? scope.enter : scope.see, f.id, manage ? 'manage the meters of this facility' : 'see this facility');
  return f as { id: string; name: string; country: string; grid_region: string | null };
}

/** Check a meter set-up by calculating one unit for the current month. */
async function checkMeter(c: Tx, t: { gwp_set: string }, fac: { id: string; country: string; grid_region: string | null }, b: MeterBody) {
  const { units } = await refdata();
  if (!units.get(b.unit)) throw new AppError(`Unknown unit ${b.unit}`);
  const item = await loadItem(b.itemId);
  if (item.code === 'waste:landfill') throw new AppError('Landfill methane is modelled per year from the tonnage history: it cannot come from a meter');
  const now = new Date();
  const p = { periodStart: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`, periodEnd: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-28` };
  try {
    await calculate(await inputFor({ item_id: b.itemId, template: b.template as Record<string, unknown>, unit: b.unit }, 1, p), contextFor(c, t.gwp_set, fac.country, fac));
  } catch (e) {
    throw new AppError(`The meter's entry does not calculate: ${(e as Error).message}`);
  }
}

export async function meterRoutes(app: FastifyInstance) {
  app.get('/api/meters', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const rows = (await c.query(`${SELECT_METER} WHERE ($1::uuid IS NULL OR m.facility_id = $1) ORDER BY f.name, m.name`, [q.facilityId ?? null])).rows;
      return { meters: rows.filter((r) => scope.see.has(r.facility_id)).map((r) => ({ ...r, canEdit: scope.enter.has(r.facility_id) })) };
    });
  });

  /** A meter, its months (consumption, coverage, issues, entry) and its latest readings. */
  app.get('/api/meters/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query(`${SELECT_METER} WHERE m.id = $1`, [id])).rows[0];
      if (!m) throw notFound('Meter');
      const scope = await scopeOf(c, req.user);
      assertCan(scope.see, m.facility_id, 'see this meter');
      const agg = await monthsOf(c, m, t.timezone);
      const entries = (await c.query(`SELECT id, period_start::text, quantity, unit, status, data_type, co2e_direct, co2e_scope2, co2e_scope2_market, co2e_scope3, updated_at
                                        FROM activity WHERE meter_id = $1 ORDER BY period_start`, [id])).rows;
      const recent = (await c.query('SELECT ts, from_ts, value, source, received_at FROM meter_reading WHERE meter_id = $1 ORDER BY ts DESC LIMIT 100', [id])).rows;
      const months = agg.months.map((mo: MeterMonth) => ({ ...mo, entry: entries.find((e) => e.period_start.slice(0, 7) === mo.month) ?? null }));
      return { ...m, canEdit: scope.enter.has(m.facility_id), timezone: t.timezone, months: months.reverse(), issues: agg.issues, recent };
    });
  });

  app.post('/api/meters', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = meterBody.parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const f = await facilityFor(c, req, b.facilityId, true);
      await checkMeter(c, t, f, b);
      const ext = b.externalId ?? `${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${newToken().slice(0, 6).toLowerCase()}`;
      const r = (await c.query(
        `INSERT INTO meter (tenant_id, facility_id, name, serial, external_id, reading_type, frequency, unit, multiplier, rollover, item_id, template, gap_fill, auto_entries, note, created_by, account_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [tenant, f.id, b.name, b.serial ?? null, ext, b.readingType, b.frequency, b.unit, b.multiplier, b.rollover ?? null, b.itemId, JSON.stringify(b.template),
         b.gapFill, b.autoEntries, b.note ?? null, req.user.id, b.accountNo || null]).catch((e) => { if (e.code === '23505') throw new AppError(`Meter id "${ext}" is already used`); throw e; })).rows[0];
      await audit(c, req, 'meter.add', 'meter', r.id, { facility: f.name, name: b.name, externalId: ext });
      return (await c.query(`${SELECT_METER} WHERE m.id = $1`, [r.id])).rows[0];
    });
  });

  app.patch('/api/meters/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = meterBody.omit({ facilityId: true }).extend({ active: z.boolean().optional() }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query('SELECT * FROM meter WHERE id = $1', [id])).rows[0];
      if (!m) throw notFound('Meter');
      const f = await facilityFor(c, req, m.facility_id, true);
      await checkMeter(c, t, f, { ...b, facilityId: m.facility_id });
      await c.query(
        `UPDATE meter SET name=$2, serial=$3, external_id=COALESCE($4, external_id), reading_type=$5, frequency=$6, unit=$7, multiplier=$8, rollover=$9, item_id=$10,
                template=$11, gap_fill=$12, auto_entries=$13, note=$14, active=COALESCE($15, active), account_no=$16, updated_at=now() WHERE id=$1`,
        [id, b.name, b.serial ?? null, b.externalId ?? null, b.readingType, b.frequency, b.unit, b.multiplier, b.rollover ?? null, b.itemId, JSON.stringify(b.template),
         b.gapFill, b.autoEntries, b.note ?? null, b.active ?? null, b.accountNo || null]).catch((e) => { if (e.code === '23505') throw new AppError('That meter id is already used'); throw e; });
      await audit(c, req, 'meter.update', 'meter', id, b);
      return (await c.query(`${SELECT_METER} WHERE m.id = $1`, [id])).rows[0];
    });
  });

  /** Delete a meter with no entries (its readings go with it); otherwise set it inactive. */
  app.delete('/api/meters/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query('SELECT * FROM meter WHERE id = $1', [id])).rows[0];
      if (!m) throw notFound('Meter');
      await facilityFor(c, req, m.facility_id, true);
      if ((await c.query('SELECT 1 FROM activity WHERE meter_id = $1 LIMIT 1', [id])).rowCount) throw new AppError('This meter has entries: set it inactive instead');
      await c.query('DELETE FROM meter WHERE id = $1', [id]);
      await audit(c, req, 'meter.delete', 'meter', id, { name: m.name });
      return { ok: true };
    });
  });

  /** Readings pasted, uploaded or typed. Then the ended months are brought up to date (if automatic). */
  app.post('/api/meters/:id/readings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ readings: z.array(readingSchema).min(1).max(50000), source: z.enum(['upload', 'manual']).default('upload') }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query('SELECT * FROM meter WHERE id = $1', [id])).rows[0] as MeterRow | undefined;
      if (!m) throw notFound('Meter');
      await facilityFor(c, req, m.facility_id, true);
      const s = await storeReadings(c, tenant, m, b.readings, b.source, t.timezone);
      await audit(c, req, 'meter.readings', 'meter', id, { source: b.source, inserted: s.inserted, updated: s.updated, rejected: s.rejected.length });
      const sync = m.auto_entries && m.active && (s.inserted || s.updated) ? await syncMeter(c, t, m, { id: req.user.id, name: req.user.name, req }, s.months) : null;
      return { ...s, months: [...s.months], sync };
    });
  });

  app.delete('/api/meters/:id/readings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const q = z.object({ ts: z.string() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query('SELECT * FROM meter WHERE id = $1', [id])).rows[0];
      if (!m) throw notFound('Meter');
      await facilityFor(c, req, m.facility_id, true);
      const r = await c.query('DELETE FROM meter_reading WHERE meter_id = $1 AND ts = $2::timestamptz RETURNING value', [id, q.ts]);
      await audit(c, req, 'meter.reading_delete', 'meter', id, { ts: q.ts, value: r.rows[0]?.value });
      return { removed: r.rowCount };
    });
  });

  /** Create / update the monthly entries now. */
  app.post('/api/meters/:id/sync', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query('SELECT * FROM meter WHERE id = $1', [id])).rows[0] as MeterRow | undefined;
      if (!m) throw notFound('Meter');
      await facilityFor(c, req, m.facility_id, true);
      return syncMeter(c, t, m, { id: req.user.id, name: req.user.name, req });
    });
  });

  // ------------------------------------------------------------- API keys --
  app.get('/api/api-keys', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    return tenantTx(tenant, async (c) => ({ keys: (await c.query('SELECT id, name, prefix, scopes, created_at, last_used_at, revoked_at FROM api_key ORDER BY created_at DESC')).rows }));
  });
  /** A new key: shown once, only its hash is kept. */
  app.post('/api/api-keys', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ name: z.string().trim().min(2).max(80), scopes: z.array(z.enum(['meter_readings', 'purchases'])).min(1).max(2).default(['meter_readings']) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const key = `ek_${newToken()}`;
      const r = (await c.query('INSERT INTO api_key (tenant_id, name, prefix, key_hash, scopes, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, prefix, scopes, created_at',
        [tenant, b.name, key.slice(0, 10), sha256(key), [...new Set(b.scopes)], req.user.id])).rows[0];
      await audit(c, req, 'api_key.create', 'api_key', r.id, { name: b.name, prefix: r.prefix, scopes: r.scopes });
      return { ...r, key };
    });
  });
  app.delete('/api/api-keys/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = await c.query('UPDATE api_key SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING name', [id]);
      if (!r.rowCount) throw notFound('Active key');
      await audit(c, req, 'api_key.revoke', 'api_key', id, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  // ------------------------------------------------- readings received, for review --
  const batchSummary = async (c: Tx, id: string) => (await c.query(
    `SELECT m.id AS meter_id, m.name AS meter, f.name AS facility, f.id AS facility_id, m.unit, m.reading_type, c.code AS category,
            count(*) FILTER (WHERE s.state = 'new')::int AS new, count(*) FILTER (WHERE s.state = 'changed')::int AS changed,
            count(*) FILTER (WHERE s.state = 'same')::int AS same, count(*) FILTER (WHERE s.state = 'conflict')::int AS conflict,
            min(coalesce(s.from_ts, s.ts)) AS first, max(s.ts) AS last,
            sum(s.value) FILTER (WHERE s.state IN ('new','changed') AND m.reading_type = 'interval')::float8 AS total,
            (SELECT json_agg(x ORDER BY x.month) FROM (SELECT to_char((s2.ts - interval '1 second') AT TIME ZONE (SELECT timezone FROM tenant WHERE id = s2.tenant_id), 'YYYY-MM') AS month, sum(s2.value)::float8 AS qty, count(*)::int AS n
                                                     FROM reading_staged s2 WHERE s2.batch_id = s.batch_id AND s2.meter_id = s.meter_id AND s2.state IN ('new','changed') GROUP BY 1) x) AS months,
            (SELECT json_agg(json_build_object('ts', s3.ts, 'value', s3.value, 'old', s3.old_value, 'state', s3.state, 'note', s3.note) ORDER BY s3.ts)
               FROM (SELECT * FROM reading_staged s3 WHERE s3.batch_id = s.batch_id AND s3.meter_id = s.meter_id AND s3.state IN ('changed','conflict') ORDER BY s3.ts LIMIT 20) s3) AS samples
       FROM reading_staged s JOIN meter m ON m.id = s.meter_id JOIN org_node f ON f.id = m.facility_id JOIN item i ON i.id = m.item_id
       JOIN subcategory sc ON sc.id = i.subcategory_id JOIN category c ON c.id = sc.category_id
      WHERE s.batch_id = $1 GROUP BY s.batch_id, s.meter_id, m.id, f.id, c.code ORDER BY f.name, m.name`, [id])).rows;

  app.get('/api/reading-batches', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ status: z.enum(['review', 'published', 'discarded']).optional(), category: z.string().max(40).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const see = (await scopeOf(c, req.user)).see;
      const batches = (await c.query(
        `SELECT b.id, b.source, b.client, b.status, b.received, jsonb_array_length(b.rejected)::int AS rejected, b.result, b.created_at, b.decided_at, b.decided_by,
                (SELECT count(*)::int FROM reading_staged s WHERE s.batch_id = b.id) AS readings,
                (SELECT array_agg(DISTINCT c.code) FROM reading_staged s JOIN meter m ON m.id = s.meter_id JOIN item i ON i.id = m.item_id JOIN subcategory sc ON sc.id = i.subcategory_id JOIN category c ON c.id = sc.category_id WHERE s.batch_id = b.id) AS categories,
                (SELECT array_agg(DISTINCT m.facility_id) FROM reading_staged s JOIN meter m ON m.id = s.meter_id WHERE s.batch_id = b.id) AS facilities
           FROM reading_batch b WHERE ($1::text IS NULL OR b.status = $1) ORDER BY b.created_at DESC LIMIT 200`, [q.status ?? null])).rows;
      const review = (await c.query(`SELECT review_readings FROM tenant WHERE id = $1`, [tenant])).rows[0].review_readings;
      return {
        review,
        batches: batches.filter((b) => (b.facilities ?? []).some((f: string) => see.has(f)) && (!q.category || (b.categories ?? []).some((x: string) => x === q.category || (q.category === 'waste' && x.startsWith('waste_'))))),
      };
    });
  });

  app.get('/api/reading-batches/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query('SELECT * FROM reading_batch WHERE id = $1', [id])).rows[0];
      if (!b) throw notFound('Batch');
      const see = (await scopeOf(c, req.user)).see;
      return { ...b, meters: (await batchSummary(c, id)).filter((m) => see.has(m.facility_id)) };
    });
  });

  app.post('/api/reading-batches/:id/publish', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query('SELECT * FROM reading_batch WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!b) throw notFound('Batch');
      if (b.status !== 'review') throw new AppError('This batch is already ' + b.status);
      const scope = await scopeOf(c, req.user);
      for (const m of await batchSummary(c, id)) assertCan(scope.enter, m.facility_id, 'publish readings of this facility');
      const r = await publishReadings(c, t, id, { id: req.user.id, name: req.user.name, req });
      await c.query(`UPDATE reading_batch SET status = 'published', result = $2, decided_at = now(), decided_by = $3 WHERE id = $1`, [id, JSON.stringify(r), req.user.name]);
      await audit(c, req, 'meter.readings_publish', 'reading_batch', id, r);
      return r;
    });
  });

  app.post('/api/reading-batches/:id/discard', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE reading_batch SET status = 'discarded', decided_at = now(), decided_by = $2 WHERE id = $1 AND status = 'review' RETURNING id`, [id, req.user.name]);
      if (!r.rowCount) throw new AppError('Only a batch waiting for review can be discarded');
      await audit(c, req, 'meter.readings_discard', 'reading_batch', id, {});
      return { ok: true };
    });
  });

  /** Readings sent through the API: kept for review (default) or stored at once. */
  app.patch('/api/tenant/review-readings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ review: z.boolean() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query('UPDATE tenant SET review_readings = $2 WHERE id = $1', [tenant, b.review]);
      await audit(c, req, 'methodology.review_readings', 'tenant', tenant, b);
      return b;
    });
  });

  /** Company time zone (month boundaries for meters). */
  app.patch('/api/tenant/timezone', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ timezone: z.string().refine((z2) => { try { new Intl.DateTimeFormat('en', { timeZone: z2 }); return true; } catch { return false; } }, 'Unknown time zone') }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query('UPDATE tenant SET timezone = $2 WHERE id = $1', [tenant, b.timezone]);
      await audit(c, req, 'methodology.timezone', 'tenant', tenant, b);
      return { timezone: b.timezone };
    });
  });
}

// ------------------------------------------------------------- machine API --
/**
 * For systems that send readings (BMS, utility portal, IoT platform, data logger):
 *   Authorization: Bearer ek_…   (Integrations & API → API keys)
 *   GET  /api/v1/meters           the company's meters and their ids
 *   POST /api/v1/meter-readings   { "readings": [ { "meterId": "...", "timestamp": "2026-03-01T00:00:00+04:00", "value": 1234.5, "start"?: "..." } ] }
 * Readings for a meter and time already received replace the earlier value. Each reading is
 * checked on its own: rejected ones are listed with the reason, the others are stored.
 */
// OAuth 2.0 client credentials: client id + secret → access token (JWT, HS256, 1 hour).
const b64 = (x: Buffer | string) => Buffer.from(x).toString('base64url');
const TOKEN_TTL = 3600;
function signToken(claims: Record<string, unknown>) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${b64(createHmac('sha256', config.tokenSecret).update(`${head}.${body}`).digest())}`;
}
function verifyToken(tok: string): { sub: string; tid: string; exp: number } | null {
  const [h, b, sig] = tok.split('.');
  if (!h || !b || !sig) return null;
  const want = createHmac('sha256', config.tokenSecret).update(`${h}.${b}`).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(b, 'base64url').toString());
    return typeof c.exp === 'number' && c.exp * 1000 > Date.now() && c.aud === 'ekotrace-api' ? c : null;
  } catch { return null; }
}
/** Requests per client per minute (per server). */
const RATE = 120;
const hits = new Map<string, { at: number; n: number }>();
function rateLimit(id: string) {
  const now = Date.now(), w = hits.get(id);
  if (!w || now - w.at > 60_000) { hits.set(id, { at: now, n: 1 }); return; }
  if (++w.n > RATE) throw new AppError(`Too many requests: at most ${RATE} a minute. Send readings in batches (up to 100,000 per request).`, 429, 'RATE_LIMITED');
}

const KEY_SQL = `SELECT k.id, k.name, k.tenant_id, k.scopes FROM api_key k JOIN tenant t ON t.id = k.tenant_id
                  WHERE k.revoked_at IS NULL AND t.status = 'active' AND `;
const SCOPE_TEXT: Record<string, string> = { meter_readings: 'send meter readings', purchases: 'send purchase lines' };
/** The client calling: an access token from /api/v1/oauth/token (or, for simple set-ups, the secret itself), allowed `scope`. */
export async function apiClient(req: FastifyRequest, scope: 'meter_readings' | 'purchases') {
  const h = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(\S+)$/.exec(h);
  if (!m) throw new AppError('Send an access token as "Authorization: Bearer …" (POST /api/v1/oauth/token)', 401, 'UNAUTHENTICATED');
  const tok = m[1]!;
  const claims = tok.startsWith('ek_') ? null : verifyToken(tok);
  if (!tok.startsWith('ek_') && !claims) throw new AppError('Access token not valid or expired', 401, 'UNAUTHENTICATED');
  const k = await platformTx(async (c) => (await c.query(claims ? `${KEY_SQL} k.id = $1` : `${KEY_SQL} k.key_hash = $1`, [claims ? claims.sub : sha256(tok)])).rows[0]);
  if (!k || (claims && claims.tid !== k.tenant_id)) throw new AppError('API client not valid or revoked', 401, 'UNAUTHENTICATED');
  if (!k.scopes.includes(scope)) throw new AppError(`This client cannot ${SCOPE_TEXT[scope]}`, 403, 'FORBIDDEN');
  rateLimit(k.id);
  await platformTx((c) => c.query('UPDATE api_key SET last_used_at = now() WHERE id = $1', [k.id]));
  return k as { id: string; name: string; tenant_id: string };
}

export async function meterIngestRoutes(app: FastifyInstance) {
  const keyOf = (req: FastifyRequest) => apiClient(req, 'meter_readings');

  /** OAuth 2.0 token endpoint (client credentials grant), form-encoded or JSON. */
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  app.post('/api/v1/oauth/token', async (req, reply) => {
    const b = z.object({ grant_type: z.literal('client_credentials'), client_id: z.string().uuid(), client_secret: z.string().startsWith('ek_') }).safeParse(req.body);
    reply.header('Cache-Control', 'no-store');
    if (!b.success) { reply.code(400); return { error: 'invalid_request', error_description: 'grant_type=client_credentials, client_id and client_secret are required' }; }
    rateLimit(`token:${b.data.client_id}`);
    const k = await platformTx(async (c) => (await c.query(`${KEY_SQL} k.id = $1 AND k.key_hash = $2`, [b.data.client_id, sha256(b.data.client_secret)])).rows[0]);
    if (!k) { reply.code(401); return { error: 'invalid_client' }; }
    const now = Math.floor(Date.now() / 1000);
    return { access_token: signToken({ sub: k.id, tid: k.tenant_id, scope: k.scopes.join(' '), aud: 'ekotrace-api', iat: now, exp: now + TOKEN_TTL }), token_type: 'Bearer', expires_in: TOKEN_TTL, scope: k.scopes.join(' ') };
  });
  const pseudo = (req: FastifyRequest, k: { name: string; tenant_id: string }) => ({ user: { id: null, name: `API key: ${k.name}`, tenantId: k.tenant_id }, ip: req.ip });

  app.get('/api/v1/meters', async (req) => {
    const k = await keyOf(req);
    return tenantTx(k.tenant_id, async (c) => ({
      meters: (await c.query(
        `SELECT m.external_id AS "meterId", m.name, f.name AS facility, m.reading_type AS "readingType", m.frequency, m.unit, m.active,
                (SELECT max(ts) FROM meter_reading r WHERE r.meter_id = m.id) AS "lastReading"
           FROM meter m JOIN org_node f ON f.id = m.facility_id ORDER BY f.name, m.name`)).rows,
    }));
  });

  app.post('/api/v1/meter-readings', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const ct = String(req.headers['content-type'] ?? '');
    if (!/^application\/json/.test(ct)) throw new AppError('Send JSON (Content-Type: application/json)', 415, 'UNSUPPORTED');
    const k = await keyOf(req);
    const b = z.object({ readings: z.array(z.object({ meterId: z.string().min(1).max(120) }).and(readingSchema)).min(1).max(100000) }).parse(req.body);
    const t = await tenantSettings(k.tenant_id);
    return tenantTx(k.tenant_id, async (c) => {
      const ids = [...new Set(b.readings.map((r) => r.meterId))];
      const meters = new Map(((await c.query('SELECT * FROM meter WHERE external_id = ANY($1)', [ids])).rows as (MeterRow & { external_id: string })[]).map((m) => [m.external_id, m]));
      const rejected: { index: number; reason: string }[] = [];
      const per = new Map<string, { idx: number[]; rows: z.infer<typeof readingSchema>[] }>();
      b.readings.forEach((r, i) => {
        const m = meters.get(r.meterId);
        if (!m) return rejected.push({ index: i, reason: `unknown meterId "${r.meterId}"` });
        if (!m.active) return rejected.push({ index: i, reason: `meter "${r.meterId}" is inactive` });
        const g = per.get(m.id) ?? { idx: [], rows: [] };
        g.idx.push(i); g.rows.push({ timestamp: r.timestamp, value: r.value, ...(r.start ? { start: r.start } : {}) });
        per.set(m.id, g);
      });
      if ((await c.query('SELECT review_readings FROM tenant WHERE id = $1', [k.tenant_id])).rows[0].review_readings) {
        const batch = (await c.query(`INSERT INTO reading_batch (tenant_id, source, client, received) VALUES ($1, 'api', $2, $3) RETURNING id`, [k.tenant_id, k.name, b.readings.length])).rows[0].id as string;
        let staged = 0;
        for (const [mid, g] of per) {
          const m = [...meters.values()].find((x) => x.id === mid)!;
          const s = await stageReadings(c, k.tenant_id, batch, m, g.rows, t.timezone);
          s.rejected.forEach((x) => rejected.push({ index: g.idx[x.index]!, reason: x.reason }));
          staged += s.staged;
        }
        const st = Object.fromEntries((await c.query(`SELECT state, count(*)::int AS n FROM reading_staged WHERE batch_id = $1 GROUP BY 1`, [batch])).rows.map((r) => [r.state, r.n]));
        await c.query(`UPDATE reading_batch SET rejected = $2 WHERE id = $1`, [batch, JSON.stringify(rejected.slice(0, 1000))]);
        await c.query(
          'INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7)',
          [k.tenant_id, `API key: ${k.name}`, 'meter.readings_api', 'reading_batch', batch, JSON.stringify({ received: b.readings.length, staged, rejected: rejected.length }), req.ip]);
        return { received: b.readings.length, batchId: batch, status: 'review', new: st.new ?? 0, corrections: st.changed ?? 0, duplicates: st.same ?? 0, conflicts: st.conflict ?? 0,
          rejected: rejected.sort((a, z2) => a.index - z2.index).slice(0, 1000), note: 'Readings wait for review in Ekotrace (Add data → the category → Meter readings) before they are published.' };
      }
      let inserted = 0, updated = 0, unchanged = 0;
      const out: { meterId: string; inserted: number; updated: number; entries?: unknown }[] = [];
      const actor = { id: null, name: `api:${k.name}`, req: pseudo(req, k) };
      for (const [mid, g] of per) {
        const m = [...meters.values()].find((x) => x.id === mid)!;
        const s = await storeReadings(c, k.tenant_id, m, g.rows, 'api', t.timezone);
        s.rejected.forEach((x) => rejected.push({ index: g.idx[x.index]!, reason: x.reason }));
        inserted += s.inserted; updated += s.updated; unchanged += s.unchanged;
        const sync = m.auto_entries && (s.inserted || s.updated) ? await syncMeter(c, t, m, actor, s.months) : undefined;
        out.push({ meterId: m.external_id, inserted: s.inserted, updated: s.updated, ...(sync ? { entries: sync } : {}) });
      }
      await c.query(
        'INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7)',
        [k.tenant_id, `API key: ${k.name}`, 'meter.readings_api', 'api_key', k.id, JSON.stringify({ received: b.readings.length, inserted, updated, rejected: rejected.length }), req.ip]);
      return { received: b.readings.length, inserted, updated, unchanged, rejected: rejected.sort((a, z2) => a.index - z2.index).slice(0, 1000), meters: out };
    });
  });
}
