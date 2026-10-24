/**
 * The collection cycle: what each facility owes for each metric of the registry, when, and where it stands.
 *
 * An obligation is facility × metric × period. A metric applies to a facility when the facility is in its
 * list (or, without a list, of one of its facility types, or any type); it is owed when the metric is
 * "required", or when the facility reports it (data this year or last). Its period follows the metric's
 * frequency; it is due on the due day of the month after the period (or later: due_months).
 *
 *   status   approved     every month of the period has data, all approved
 *            submitted    every month has data, some waiting for approval
 *            in_progress  some data, but drafts, sent back, or months missing
 *            missing      nothing
 *            excused      not owed this period, with a reason (collection_exception)
 *   timing   done (approved / submitted / excused) · upcoming · due_soon (within the "due soon" days) ·
 *            overdue · escalated (more than the escalation days late)
 *
 * People: the metric owner is responsible; without one, the facility's data preparers, then its manager.
 * Escalation goes to the facility manager and the admins of the sub-groups above it, or the super admins.
 */
import type { Tx } from '../db/pool.js';
import { subtreeFacilities } from './access.js';

export type Freq = 'monthly' | 'quarterly' | 'annual';
export interface MetricRow {
  id: string; code: string; name: string; definition: string; category_code: string; item_ids: number[]; unit: string | null; owner_user_id: string | null;
  facility_types: string[]; facility_ids: string[]; required: boolean; level: 'facility' | 'company'; source_system: string | null; methods: string[]; frequency: Freq; due_day: number | null;
  due_months: number; check_pct: number | null; evidence: 'required' | 'optional'; active: boolean; version: number;
}
export type ObStatus = 'approved' | 'submitted' | 'in_progress' | 'missing' | 'excused';
export type ObTiming = 'done' | 'upcoming' | 'due_soon' | 'overdue' | 'escalated';
export interface Person { id: string; name: string }
export interface Obligation {
  key: string; level: 'facility' | 'company'; facilityId: string; facility: string; facilityType: string | null; metricId: string; metricCode: string; metric: string; category: string; scope: number;
  frequency: Freq; period: string; periodEnd: string; label: string; due: string; status: ObStatus; timing: ObTiming; daysLate: number; completedAt: string | null; late: boolean;
  owner: Person | null; responsible: Person[]; escalateTo: Person[]; evidence: 'required' | 'optional'; withoutEvidence: number; entries: number;
  quantity: number | null; unit: string | null; otherUnits: number; exception: { reason: string; by: string | null; at: string } | null; reminders: { kind: string; at: string }[];
}

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Today's date where the company is. */
export function todayIn(tz: string, now = new Date()): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);

/** The periods of a year for a frequency: [first month, last month, label]. */
export function periodsOf(freq: Freq, year: number): [number, number, string][] {
  if (freq === 'annual') return [[1, 12, String(year)]];
  if (freq === 'quarterly') return [1, 2, 3, 4].map((q) => [q * 3 - 2, q * 3, `Q${q} ${year}`]);
  return MN.map((n, i) => [i + 1, i + 1, `${n} ${year}`]);
}
/** Due date: the due day of the Nth month after the period ends. */
export function dueOf(year: number, lastMonth: number, dueDay: number, dueMonths: number): string {
  const t = year * 12 + (lastMonth - 1) + dueMonths;
  return ymd(Math.floor(t / 12), (t % 12) + 1, dueDay);
}

// ------------------------------------------------------------------ the standard registry --
/** [category, name, reporting unit, frequency, due months, definition, methods, collected for the whole company] */
const STANDARD: [string, string, string | null, Freq, number, string, string[], boolean?][] = [
  ['stationary_combustion', 'Fuel burned on site', 'L', 'monthly', 1, 'Diesel, natural gas, LPG and other fuels burned in generators, boilers, furnaces and kitchens, from delivery notes, tank readings or bills.', ['form', 'upload', 'bill']],
  ['mobile_combustion', 'Fuel used by vehicles and mobile equipment', 'L', 'monthly', 1, 'Fuel bought for company vehicles, trucks and mobile machines (fuel cards, depot dispensing), or distance where fuel is not known.', ['form', 'upload', 'api']],
  ['fugitive', 'Refrigerant and gas top-ups', 'kg', 'quarterly', 1, 'Refrigerant (HFC) and other gases added to air conditioning, chillers, cold rooms and fire systems, from service reports.', ['form']],
  ['waste_treatment', 'Waste treated at own sites', 't', 'monthly', 1, 'Waste received and landfilled, composted or incinerated at sites the company operates, from weighbridge records.', ['form', 'upload', 'qr']],
  ['purchased_electricity', 'Electricity, heat and cooling bought', 'kWh_e', 'monthly', 1, 'Grid electricity, district cooling and heat bought, from utility bills or meter readings.', ['bill', 'api', 'form']],
  ['waste_generated', 'Waste sent to others', 't', 'monthly', 1, 'Waste collected by contractors, by type and treatment, from collection records and manifests.', ['form', 'qr', 'upload']],
  ['purchased_goods', 'Purchased goods and services', null, 'quarterly', 1, 'Spend on goods and services from the finance system, by supplier and category; supplier-specific data where suppliers give it.', ['upload', 'api'], true],
  ['capital_goods', 'Capital goods', null, 'quarterly', 1, 'Spend on equipment, vehicles, buildings and other assets from the asset register or finance system.', ['upload', 'api'], true],
  ['upstream_transport', 'Transport bought', null, 'quarterly', 1, 'Freight and logistics services bought (spend, or tonne-km from carriers).', ['upload', 'api'], true],
  ['business_travel', 'Business travel', null, 'quarterly', 1, 'Flights, hotel nights and ground travel from the travel agency or expense system.', ['upload', 'form'], true],
  ['employee_commuting', 'Employee commuting', null, 'annual', 3, 'How employees travel to work, from the yearly commuting survey, extrapolated to all employees.', ['survey'], true],
  ['upstream_leased', 'Upstream leased assets', null, 'annual', 1, 'Energy used in leased buildings and assets not counted in Scope 1 and 2.', ['form', 'upload'], true],
  ['downstream_transport', 'Transport of products sold', null, 'quarterly', 1, 'Freight and storage of products after they leave, paid by customers or others (tonne-km, warehouse area).', ['form'], true],
  ['downstream_leased', 'Assets leased out', null, 'annual', 1, 'Energy used by tenants in buildings and vehicles the company owns and leases out.', ['form'], true],
  ['processing_sold', 'Processing of sold products', null, 'annual', 1, 'Energy the processors of your intermediate products use for them, or their reported emissions.', ['form'], true],
  ['use_sold', 'Use of sold products', null, 'annual', 1, 'Units sold with their lifetime energy, fuel or refrigerant use, or a product footprint study.', ['form'], true],
  ['eol_sold', 'End-of-life of sold products', null, 'annual', 1, 'Tonnes of products and packaging sold, by material and disposal route.', ['form'], true],
  ['water_supply', 'Water withdrawn', 'm3', 'monthly', 1, 'Water bought from the utility or abstracted, from water bills or meters.', ['bill', 'form']],
  ['water_discharge', 'Water discharged', 'm3', 'monthly', 1, 'Wastewater sent to sewer or treatment, from bills, meters or estimates.', ['form']],
];
export const METHODS = ['form', 'upload', 'bill', 'api', 'qr', 'survey'] as const;

export const metricSnapshot = (m: Partial<MetricRow>) => ({
  name: m.name, definition: m.definition, category_code: m.category_code, item_ids: m.item_ids ?? [], unit: m.unit ?? null, owner_user_id: m.owner_user_id ?? null,
  facility_types: m.facility_types ?? [], facility_ids: m.facility_ids ?? [], required: m.required ?? false, level: m.level ?? 'facility', source_system: m.source_system ?? null, methods: m.methods ?? [],
  frequency: m.frequency, due_day: m.due_day ?? null, due_months: m.due_months ?? 1, check_pct: m.check_pct ?? null, evidence: m.evidence ?? 'optional', active: m.active ?? true,
});

/** A company without a registry gets the standard one (one metric per category it can report). */
export async function ensureMetrics(c: Tx, tenant: string, by = 'standard set'): Promise<void> {
  if (Number((await c.query(`SELECT count(*)::int AS n FROM metric`)).rows[0].n)) return;
  const cats = new Set((await c.query(`SELECT code FROM category WHERE active`)).rows.map((r) => r.code as string));
  let n = 0;
  for (const [cat, name, unit, frequency, dueMonths, definition, methods, company] of STANDARD) {
    if (!cats.has(cat)) continue;
    const code = `EKO-${String(++n).padStart(3, '0')}`;
    const m = (await c.query(
      `INSERT INTO metric (tenant_id, code, name, definition, category_code, unit, frequency, due_months, methods, level, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id, code) DO NOTHING RETURNING *`,
      [tenant, code, name, definition, cat, unit, frequency, dueMonths, methods, company ? 'company' : 'facility', by])).rows[0];
    if (m) await c.query(`INSERT INTO metric_version (tenant_id, metric_id, version, snapshot, reason, changed_by, approved_by) VALUES ($1,$2,1,$3,$4,$5,$5)`,
      [tenant, m.id, JSON.stringify(metricSnapshot(m)), 'Created from the standard catalogue', by]);
  }
}

/** The metric an entry belongs to (an item-specific metric first, else its category's). Needs aliases a (activity) and cat (category). */
export const METRIC_JOIN = `LEFT JOIN LATERAL (SELECT m.id AS metric_id, m.code AS metric_code, m.name AS metric_name, m.evidence, m.check_pct FROM metric m
     WHERE m.active AND m.category_code = cat.code AND (cardinality(m.item_ids) = 0 OR a.item_id = ANY(m.item_ids)) ORDER BY cardinality(m.item_ids) DESC LIMIT 1) mt ON true`;
/** Evidence behind an entry: a meter (reading or bill), a purchase file, bin scans, or a document linked from the vault. */
export const EVIDENCE_SQL = `(a.meter_id IS NOT NULL OR a.purchase_batch_id IS NOT NULL OR EXISTS (SELECT 1 FROM waste_scan ws2 WHERE ws2.activity_id = a.id) OR EXISTS (SELECT 1 FROM document_link dl WHERE dl.activity_id = a.id))`;

export interface CycleSettings { dueDay: number; remindDays: number; escalateDays: number; timezone: string; reminders: boolean }
export async function cycleSettings(c: Tx, tenant: string): Promise<CycleSettings> {
  const t = (await c.query(`SELECT due_day, remind_days, escalate_days, timezone, reminders FROM tenant WHERE id = $1`, [tenant])).rows[0];
  return { dueDay: t.due_day, remindDays: t.remind_days, escalateDays: t.escalate_days, timezone: t.timezone, reminders: t.reminders };
}

/** Who is responsible for each facility, and who hears about escalations. */
async function people(c: Tx, facs: string[]) {
  const users = (await c.query(`SELECT id, name, role, scope_node_id FROM app_user WHERE NOT disabled`)).rows as { id: string; name: string; role: string; scope_node_id: string | null }[];
  const byId = new Map(users.map((u) => [u.id, { id: u.id, name: u.name }]));
  const assigned = (await c.query(`SELECT uf.node_id AS f, u.id, u.role FROM user_facility uf JOIN app_user u ON u.id = uf.user_id WHERE NOT u.disabled AND uf.node_id = ANY($1) ORDER BY u.name`, [facs])).rows;
  const mgr = new Map((await c.query(`SELECT id, manager_user_id FROM org_node WHERE id = ANY($1)`, [facs])).rows.map((r) => [r.id as string, r.manager_user_id as string | null]));
  const admins: { id: string; facs: Set<string> }[] = [];
  for (const u of users.filter((x) => x.role === 'admin' && x.scope_node_id)) admins.push({ id: u.id, facs: await subtreeFacilities(c, u.scope_node_id) });
  const supers = users.filter((u) => u.role === 'super_admin').map((u) => byId.get(u.id)!);
  const resp = new Map<string, Person[]>(), esc = new Map<string, Person[]>();
  for (const f of facs) {
    const m = mgr.get(f), mp = m ? byId.get(m) : undefined;
    const preps = assigned.filter((a) => a.f === f && a.role === 'preparer').map((a) => byId.get(a.id)!).filter(Boolean);
    const mans = assigned.filter((a) => a.f === f && a.role === 'manager').map((a) => byId.get(a.id)!).filter(Boolean);
    resp.set(f, preps.length ? preps : mp ? [mp] : mans);
    const e = [...(mp ? [mp] : mans.slice(0, 1)), ...admins.filter((a) => a.facs.has(f)).map((a) => byId.get(a.id)!)];
    esc.set(f, e.length ? e : supers);
  }
  return { byId, resp, esc, supers };
}

/**
 * Every obligation of the given years for the given facilities. `today` decides timing (in the company's time zone).
 * Periods that have not started yet are left out.
 */
export async function obligations(c: Tx, tenant: string, opts: { years: number[]; facilities: string[]; today: string; metricId?: string; company?: boolean }): Promise<Obligation[]> {
  const set = await cycleSettings(c, tenant);
  const metrics = (await c.query(`SELECT m.*, cat.name AS cat_name, cat.scope FROM metric m JOIN category cat ON cat.code = m.category_code WHERE m.active ${opts.metricId ? 'AND m.id = $1' : ''} ORDER BY m.code`,
    opts.metricId ? [opts.metricId] : [])).rows as (MetricRow & { cat_name: string; scope: number })[];
  if (!metrics.length || (!opts.facilities.length && !opts.company)) return [];
  // items each metric covers: its own list, or (category-wide) the items no other metric of the category lists
  const itemsTaken = new Map<string, Set<number>>();
  for (const m of metrics) if (m.item_ids.length) { const s = itemsTaken.get(m.category_code) ?? new Set(); m.item_ids.forEach((i) => s.add(i)); itemsTaken.set(m.category_code, s); }
  const covers = (m: MetricRow, cat: string, item: number) => m.category_code === cat && (m.item_ids.length ? m.item_ids.includes(item) : !itemsTaken.get(cat)?.has(item));

  const facs = (await c.query(`SELECT id, name, facility_type FROM org_node WHERE id = ANY($1) AND kind = 'facility' AND active ORDER BY name`, [opts.facilities])).rows as { id: string; name: string; facility_type: string | null }[];
  // company-level metrics: one obligation for the whole company (the group node), from every facility's data
  const group = opts.company && metrics.some((m) => m.level === 'company') ? (await c.query(`SELECT id, name FROM org_node WHERE kind = 'group' LIMIT 1`)).rows[0] as { id: string; name: string } | undefined : undefined;
  const allIds = group ? (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((r) => r.id as string) : [];
  const ids = [...new Set([...facs.map((f) => f.id), ...allIds])], minY = Math.min(...opts.years), maxY = Math.max(...opts.years);
  const own = [...ids, ...(group ? [group.id] : [])];
  // facility × item reported this year or last
  const reported = (await c.query(`SELECT DISTINCT a.facility_id AS f, cat.code AS cat, a.item_id AS item FROM activity a JOIN category cat ON cat.id = a.category_id
                                    WHERE a.facility_id = ANY($1) AND extract(year FROM a.period_start) BETWEEN $2::int - 1 AND $3::int`, [ids, minY, maxY])).rows as { f: string; cat: string; item: number }[];
  // facility × item × month: entries by status, when first submitted, quantity in base units (spread over the months an entry covers), evidence
  const cells = (await c.query(
    `SELECT a.facility_id AS f, cat.code AS cat, a.item_id AS item, extract(year FROM mo.d)::int AS y, extract(month FROM mo.d)::int AS m, u.dimension AS dim,
            count(*) FILTER (WHERE a.status = 'draft')::int AS draft, count(*) FILTER (WHERE a.status = 'submitted')::int AS submitted,
            count(*) FILTER (WHERE a.status = 'approved')::int AS approved, count(*) FILTER (WHERE a.status = 'rejected')::int AS rejected,
            count(*) FILTER (WHERE a.status IN ('approved', 'submitted') AND NOT ${EVIDENCE_SQL})::int AS noev,
            min(coalesce(a.submitted_at, CASE WHEN a.status = 'approved' THEN a.created_at END)) FILTER (WHERE a.status IN ('approved', 'submitted')) AS sub,
            sum(a.quantity * u.to_base / greatest(1, (extract(year FROM age(date_trunc('month', a.period_end), date_trunc('month', a.period_start))) * 12
                + extract(month FROM age(date_trunc('month', a.period_end), date_trunc('month', a.period_start))) + 1)))
              FILTER (WHERE a.status <> 'rejected')::float8 AS qty_base
       FROM activity a JOIN category cat ON cat.id = a.category_id LEFT JOIN unit u ON u.code = a.unit
       CROSS JOIN LATERAL generate_series(date_trunc('month', a.period_start), date_trunc('month', a.period_end), interval '1 month') AS mo(d)
      WHERE a.facility_id = ANY($1) AND extract(year FROM mo.d) BETWEEN $2 AND $3 AND a.period_end - a.period_start < 366
      GROUP BY 1, 2, 3, 4, 5, 6`, [ids, minY, maxY])).rows as { f: string; cat: string; item: number; y: number; m: number; dim: string | null; draft: number; submitted: number; approved: number; rejected: number; noev: number; sub: Date | null; qty_base: number | null }[];
  const unitMap = new Map((await c.query(`SELECT code, dimension, to_base::float8 AS to_base FROM unit`)).rows.map((r) => [r.code as string, { dim: r.dimension as string, k: r.to_base as number }]));
  const exc = (await c.query(`SELECT facility_id AS f, metric_id AS m, period::text AS p, reason, by_name, at FROM collection_exception WHERE facility_id = ANY($1)`, [own])).rows;
  const sent = (await c.query(`SELECT key, kind, at FROM reminder_log WHERE key LIKE ANY($1) ORDER BY at`, [own.map((f) => `${f}:%`)])).rows as { key: string; kind: string; at: Date }[];
  const { byId, resp, esc, supers } = await people(c, ids);
  if (group) { resp.set(group.id, supers); esc.set(group.id, supers); }

  const out: Obligation[] = [];
  for (const m of metrics) {
    const owner = m.owner_user_id ? byId.get(m.owner_user_id) ?? null : null;
    const mu = m.unit ? unitMap.get(m.unit) : undefined;
    const company = m.level === 'company';
    if (company && !group) continue;
    const units = company ? [{ id: group!.id, name: `${group!.name} (company-wide)`, facility_type: null, cellIds: new Set(allIds) }] : facs.map((f) => ({ ...f, cellIds: new Set([f.id]) }));
    for (const f of units) {
      const applies = company || (m.facility_ids.length ? m.facility_ids.includes(f.id) : !m.facility_types.length || (!!f.facility_type && m.facility_types.includes(f.facility_type)));
      if (!applies) continue;
      if (!m.required && !reported.some((r) => f.cellIds.has(r.f) && covers(m, r.cat, r.item))) continue;
      const mine = cells.filter((x) => f.cellIds.has(x.f) && covers(m, x.cat, x.item));
      for (const y of opts.years) {
        for (const [m1, m2, label] of periodsOf(m.frequency, y)) {
          const period = ymd(y, m1, 1);
          if (period > opts.today) continue;                                        // not started
          const due = dueOf(y, m2, m.due_day ?? set.dueDay, m.due_months);
          const months = Array.from({ length: m2 - m1 + 1 }, (_, i) => m1 + i);
          const per = months.map((mo) => mine.filter((x) => x.y === y && x.m === mo));
          const st = per.map((cs) => {
            const t = cs.reduce((a, x) => ({ d: a.d + x.draft, s: a.s + x.submitted, ap: a.ap + x.approved, r: a.r + x.rejected }), { d: 0, s: 0, ap: 0, r: 0 });
            return t.d + t.s + t.ap + t.r === 0 ? 'missing' : t.d || t.r ? 'open' : t.s ? 'submitted' : 'approved';
          });
          const key = `${f.id}:${m.id}:${period}`;
          const ex = exc.find((e) => e.f === f.id && e.m === m.id && e.p === period);
          const status: ObStatus = ex ? 'excused' : st.every((s) => s === 'approved') ? 'approved' : st.every((s) => s === 'approved' || s === 'submitted') ? 'submitted'
            : st.every((s) => s === 'missing') ? 'missing' : 'in_progress';
          const flat = per.flat();
          // complete when the last month came in: the latest of each month's first submission
          const subs = per.map((cs) => cs.map((x) => x.sub).filter(Boolean).map((d) => +new Date(d as Date)).sort()[0]);
          const completedAt = status === 'approved' || status === 'submitted' ? new Date(Math.max(...(subs as number[]))).toISOString() : null;
          const today = opts.today, daysLate = daysBetween(due, today);
          const done = status === 'approved' || status === 'submitted' || status === 'excused';
          const timing: ObTiming = done ? 'done' : daysLate > set.escalateDays ? 'escalated' : daysLate > 0 ? 'overdue' : -daysLate <= set.remindDays ? 'due_soon' : 'upcoming';
          let qty: number | null = null, other = 0;
          for (const x of flat) {
            if (x.qty_base == null) continue;
            if (mu && x.dim === mu.dim) qty = (qty ?? 0) + x.qty_base / mu.k; else other++;
          }
          // escalation goes above the people responsible (else to the super admins)
          const who = owner ? [owner] : resp.get(f.id) ?? [];
          const above = (esc.get(f.id) ?? []).filter((p) => !who.some((w) => w.id === p.id));
          const escTo = above.length ? above : supers.filter((p) => !who.some((w) => w.id === p.id));
          out.push({
            key, level: m.level, facilityId: f.id, facility: f.name, facilityType: f.facility_type, metricId: m.id, metricCode: m.code, metric: m.name, category: m.cat_name, scope: m.scope,
            frequency: m.frequency, period, periodEnd: ymd(y, m2, 1), label, due, status, timing, daysLate: done ? 0 : Math.max(0, daysLate),
            completedAt, late: !!completedAt && completedAt.slice(0, 10) > due, owner, responsible: who, escalateTo: escTo,
            evidence: m.evidence, withoutEvidence: flat.reduce((a, x) => a + x.noev, 0), entries: flat.reduce((a, x) => a + x.draft + x.submitted + x.approved + x.rejected, 0),
            quantity: qty, unit: m.unit, otherUnits: other,
            exception: ex ? { reason: ex.reason, by: ex.by_name, at: new Date(ex.at).toISOString() } : null,
            reminders: sent.filter((s) => s.key === key).map((s) => ({ kind: s.kind, at: new Date(s.at).toISOString() })),
          });
        }
      }
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.facility.localeCompare(b.facility) || a.metricCode.localeCompare(b.metricCode));
}
