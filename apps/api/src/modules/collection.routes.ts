/**
 * Metric registry, collection calendar and Inbox & to-dos (RFP 3.2.1, 3.4.1, 3.4.10).
 *
 * Registry (everyone in the company can read it)
 *   GET    /api/metrics                         metrics, changes waiting for approval, and the lists to choose from
 *   GET    /api/metrics/:id/history             every version, what changed, why, who changed and approved it
 *   POST   /api/metrics {id?, reason, …}        a super admin's change applies at once; an admin's waits for a super admin
 *   POST   /api/metrics/changes/:id {decision, note?}   approve or reject (super admin, not their own proposal)
 *   DELETE /api/metrics/changes/:id             withdraw your own proposal
 *
 * Calendar
 *   GET    /api/calendar?year&node&group        obligations of the facilities in view (facility × metric × period)
 *   POST   /api/calendar/remind {keys}          remind the people responsible now (once a day each)
 *   POST   /api/calendar/exception {facilityId, metricId, period, reason}   not owed this period (with the reason)
 *   DELETE /api/calendar/exception?facilityId&metricId&period
 *   PUT    /api/calendar/settings {reminders?, dueDay?, remindDays?, escalateDays?}   (super admin)
 *   POST   /api/calendar/run                    run today's reminders now (super admin)
 *
 * Inbox
 *   GET    /api/inbox                           my to-dos and notifications
 *   GET    /api/inbox/count                     unread notifications and open to-dos (the menu badge)
 *   POST   /api/inbox/read {ids?, all?}         mark read
 *   PUT    /api/inbox/settings {emailNotify}    e-mails on or off for me
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { METHODS, cycleSettings, ensureMetrics, metricSnapshot, obligations, todayIn, type MetricRow, type Obligation } from '../lib/collection.js';
import { remindNow, remindTenant } from '../lib/reminders.js';
import { notify } from '../lib/notify.js';
import { mailOn } from '../lib/mail.js';
import { viewFacs } from './reports.routes.js';
import { SELF_ROLES, approvalSettings } from './approvals.routes.js';

const EDIT = ['super_admin', 'admin', 'platform_admin'];
const CHASE = ['super_admin', 'admin', 'manager', 'platform_admin'];
const WHOLE = ['super_admin', 'verifier', 'platform_admin'];
/** Facilities (or, for the super admin, the company itself) a person may chase or excuse. */
async function chaseable(c: Tx, req: FastifyRequest, ids: string[]) {
  const s = await scopeOf(c, req.user);
  const group = (await c.query(`SELECT id FROM org_node WHERE kind = 'group' LIMIT 1`)).rows[0]?.id as string | undefined;
  return ids.every((f) => s.approve.has(f) || (f === group && ['super_admin', 'platform_admin'].includes(req.user.role)));
}
const FIELD_LABEL: Record<string, string> = {
  name: 'Name', definition: 'Definition', category_code: 'Category', item_ids: 'Items', unit: 'Reporting unit', owner_user_id: 'Owner', facility_types: 'Facility types',
  facility_ids: 'Facilities', required: 'Required', source_system: 'Source system', methods: 'Collection methods', frequency: 'Frequency', due_day: 'Due day', due_months: 'Due after (months)',
  check_pct: 'Check limit ±%', evidence: 'Evidence', active: 'Active',
};

export const metricBody = z.object({
  name: z.string().trim().min(2).max(120), definition: z.string().trim().max(2000).default(''), category_code: z.string().max(60),
  item_ids: z.array(z.number().int()).max(200).default([]), unit: z.string().max(20).nullable().default(null), owner_user_id: z.string().uuid().nullable().default(null),
  facility_types: z.array(z.string().trim().min(1).max(60)).max(30).default([]), facility_ids: z.array(z.string().uuid()).max(500).default([]), required: z.boolean().default(false), level: z.enum(['facility', 'company']).default('facility'),
  source_system: z.string().trim().max(120).nullable().default(null), methods: z.array(z.enum(METHODS)).max(6).default([]), frequency: z.enum(['monthly', 'quarterly', 'annual']),
  due_day: z.number().int().min(1).max(28).nullable().default(null), due_months: z.number().int().min(1).max(6).default(1), check_pct: z.number().int().min(1).max(500).nullable().default(null),
  evidence: z.enum(['required', 'optional']).default('optional'), active: z.boolean().default(true),
});
type MetricData = z.infer<typeof metricBody>;

async function checkMetric(c: Tx, d: MetricData) {
  const cat = (await c.query(`SELECT id FROM category WHERE code = $1 AND active`, [d.category_code])).rows[0];
  if (!cat) throw new AppError('Unknown category');
  if (d.item_ids.length) {
    const ok = Number((await c.query(`SELECT count(*)::int AS n FROM item i JOIN subcategory s ON s.id = i.subcategory_id WHERE i.id = ANY($1) AND s.category_id = $2`, [d.item_ids, cat.id])).rows[0].n);
    if (ok !== new Set(d.item_ids).size) throw new AppError('Some items are not in this category');
  }
  if (d.unit && !(await c.query(`SELECT 1 FROM unit WHERE code = $1`, [d.unit])).rowCount) throw new AppError('Unknown unit');
  if (d.owner_user_id && !(await c.query(`SELECT 1 FROM app_user WHERE id = $1 AND NOT disabled AND role <> 'verifier'`, [d.owner_user_id])).rowCount) throw new AppError('The owner must be an active person of the company (not a verifier)');
  if (d.facility_ids.length && Number((await c.query(`SELECT count(*)::int AS n FROM org_node WHERE id = ANY($1) AND kind = 'facility'`, [d.facility_ids])).rows[0].n) !== new Set(d.facility_ids).size) throw new AppError('Unknown facility');
}

/** What changed: field → [before, after]. */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of Object.keys(after)) {
    const a = before?.[k] ?? null, b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}

/** Applies a change: a new metric (with the next code) or a new version of one. */
export async function applyMetric(c: Tx, tenant: string, id: string | null, d: MetricData, reason: string, changedBy: string, approvedBy: string): Promise<{ id: string; code: string; version: number }> {
  await checkMetric(c, d);
  const snap = metricSnapshot(d as Partial<MetricRow>);
  if (!id) {
    const next = Number((await c.query(`SELECT coalesce(max(substring(code FROM 5)::int), 0) + 1 AS n FROM metric WHERE code ~ '^EKO-[0-9]+$'`)).rows[0].n);
    const code = `EKO-${String(next).padStart(3, '0')}`;
    const m = (await c.query(
      `INSERT INTO metric (tenant_id, code, name, definition, category_code, item_ids, unit, owner_user_id, facility_types, facility_ids, required, source_system, methods, frequency, due_day, due_months, check_pct, evidence, active, updated_by, level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [tenant, code, d.name, d.definition, d.category_code, d.item_ids, d.unit, d.owner_user_id, d.facility_types, d.facility_ids, d.required, d.source_system, d.methods, d.frequency, d.due_day, d.due_months, d.check_pct, d.evidence, d.active, changedBy, d.level])).rows[0];
    await c.query(`INSERT INTO metric_version (tenant_id, metric_id, version, snapshot, changes, reason, changed_by, approved_by) VALUES ($1,$2,1,$3,$4,$5,$6,$7)`,
      [tenant, m.id, JSON.stringify(snap), JSON.stringify(diff(null, snap)), reason, changedBy, approvedBy]);
    return { id: m.id, code, version: 1 };
  }
  const cur = (await c.query(`SELECT * FROM metric WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!cur) throw notFound('Metric');
  const ch = diff(metricSnapshot(cur), snap);
  if (!Object.keys(ch).length) throw new AppError('Nothing changed');
  const v = cur.version + 1;
  await c.query(
    `UPDATE metric SET name=$2, definition=$3, category_code=$4, item_ids=$5, unit=$6, owner_user_id=$7, facility_types=$8, facility_ids=$9, required=$10, source_system=$11, methods=$12,
            frequency=$13, due_day=$14, due_months=$15, check_pct=$16, evidence=$17, active=$18, version=$19, updated_at=now(), updated_by=$20, level=$21 WHERE id = $1`,
    [id, d.name, d.definition, d.category_code, d.item_ids, d.unit, d.owner_user_id, d.facility_types, d.facility_ids, d.required, d.source_system, d.methods, d.frequency, d.due_day, d.due_months, d.check_pct, d.evidence, d.active, v, changedBy, d.level]);
  await c.query(`INSERT INTO metric_version (tenant_id, metric_id, version, snapshot, changes, reason, changed_by, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenant, id, v, JSON.stringify(snap), JSON.stringify(ch), reason, changedBy, approvedBy]);
  return { id, code: cur.code, version: v };
}

const calSel = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), node: z.string().uuid().optional(), group: z.string().uuid().optional() });

/** Obligations I am responsible for, and escalations that reach me (current and last year). */
async function myObligations(c: Tx, req: FastifyRequest, tenant: string) {
  const set = await cycleSettings(c, tenant), today = todayIn(set.timezone), y = Number(today.slice(0, 4)), me = String(req.user.id);
  const see = [...(await scopeOf(c, req.user)).see];
  const all = await obligations(c, tenant, { years: [y - 1, y], facilities: see, today, company: true });
  const open = all.filter((o) => o.timing !== 'done' && o.timing !== 'upcoming' && o.daysLate <= 180);
  return {
    today,
    mine: open.filter((o) => o.responsible.some((p) => p.id === me)),
    escalations: open.filter((o) => o.timing === 'escalated' && o.escalateTo.some((p) => p.id === me) && !o.responsible.some((p) => p.id === me)),
    upcoming: all.filter((o) => o.timing === 'upcoming' && o.responsible.some((p) => p.id === me) && o.due <= addDays(today, 31)),
  };
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

async function approvalsForMe(c: Tx, req: FastifyRequest): Promise<number> {
  const s = await scopeOf(c, req.user), me = String(req.user.id);
  if (!s.approve.size || req.user.role === 'platform_admin') return 0;
  const set = await approvalSettings(c, req.user.tenantId!), self = set.selfApproval && SELF_ROLES.includes(req.user.role);
  const solo = req.user.role === 'super_admin' && Number((await c.query(`SELECT count(*)::int AS n FROM app_user WHERE NOT disabled AND role <> 'verifier'`)).rows[0].n) === 1;
  const canL2 = ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
  return Number((await c.query(
    `SELECT count(*)::int AS n FROM activity a WHERE a.facility_id = ANY($1) AND a.status = 'submitted'
        AND ($2 OR (coalesce(a.created_by, '') <> $3 AND coalesce(a.submitted_by, '') <> $3)
             OR ($5 AND ($6::numeric IS NULL OR (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3) / 1000 < $6::numeric)))
        AND (a.approval_stage IS DISTINCT FROM 'L2' OR ($4 AND coalesce(a.l1_by, '') <> $3))`, [[...s.approve], solo, me, canL2, self, set.selfMaxT])).rows[0].n);
}

export async function collectionRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------------ registry --
  app.get('/api/metrics', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      await ensureMetrics(c, tenant);
      const metrics = (await c.query(
        `SELECT m.*, cat.name AS category, cat.scope, u.name AS owner_name, un.name AS unit_name, un.dimension AS unit_dim,
                (SELECT count(*)::int FROM metric_change mc WHERE mc.metric_id = m.id AND mc.status = 'pending') AS pending
           FROM metric m JOIN category cat ON cat.code = m.category_code LEFT JOIN app_user u ON u.id = m.owner_user_id LEFT JOIN unit un ON un.code = m.unit
          ORDER BY m.active DESC, m.code`)).rows;
      const changes = (await c.query(
        `SELECT mc.id, mc.metric_id, m.code, coalesce(m.name, mc.proposal->>'name') AS name, mc.proposal, mc.reason, mc.status, mc.proposed_by, mc.proposed_name, mc.proposed_at, mc.decided_name, mc.decided_at, mc.decision_note
           FROM metric_change mc LEFT JOIN metric m ON m.id = mc.metric_id ORDER BY (mc.status = 'pending') DESC, mc.proposed_at DESC LIMIT 100`)).rows
        .map((r) => ({ ...r, mine: r.proposed_by === req.user.id, changes: null as unknown }));
      for (const ch of changes) {
        const cur = ch.metric_id ? metrics.find((m) => m.id === ch.metric_id) : null;
        ch.changes = diff(cur ? metricSnapshot(cur) : null, metricSnapshot(ch.proposal));
      }
      const cats = (await c.query(`SELECT c.code, c.name, c.scope, coalesce(json_agg(json_build_object('id', i.id, 'name', i.name, 'sub', s.name) ORDER BY s.sort, i.sort) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
                                     FROM category c LEFT JOIN subcategory s ON s.category_id = c.id AND s.active LEFT JOIN item i ON i.subcategory_id = s.id AND i.active
                                    WHERE c.active GROUP BY c.code, c.name, c.scope, c.sort ORDER BY c.scope, c.sort`)).rows;
      const units = (await c.query(`SELECT code, name, dimension, to_base::float8 AS to_base FROM unit WHERE active ORDER BY dimension, sort`)).rows;
      const users = (await c.query(`SELECT id, name, role FROM app_user WHERE NOT disabled AND role <> 'verifier' ORDER BY name`)).rows;
      const facilities = (await c.query(`SELECT id, name, facility_type AS type FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows;
      const set = await cycleSettings(c, tenant);
      return {
        metrics, changes, categories: cats, units, users, facilities, facilityTypes: [...new Set(facilities.map((f) => f.type).filter(Boolean))].sort(), methods: METHODS,
        settings: { dueDay: set.dueDay, checkPct: ((await c.query(`SELECT approval FROM tenant WHERE id = $1`, [tenant])).rows[0].approval?.checkPct ?? 35) as number },
        canEdit: EDIT.includes(req.user.role), canApprove: ['super_admin', 'platform_admin'].includes(req.user.role),
      };
    });
  });

  app.get('/api/metrics/:id/history', async (req) => {
    const tenant = requireTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const m = (await c.query(`SELECT id, code, name FROM metric WHERE id = $1`, [id])).rows[0];
      if (!m) throw notFound('Metric');
      const versions = (await c.query(`SELECT version, changes, reason, changed_by, approved_by, at FROM metric_version WHERE metric_id = $1 ORDER BY version DESC`, [id])).rows;
      return { metric: m, versions, labels: FIELD_LABEL };
    });
  });

  app.post('/api/metrics', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = metricBody.extend({ id: z.string().uuid().optional(), reason: z.string().trim().min(3, 'Say why (kept in the version history)').max(500) }).parse(req.body);
    const { id, reason, ...d } = b;
    return tenantTx(tenant, async (c) => {
      await checkMetric(c, d);
      if (id && !(await c.query(`SELECT 1 FROM metric WHERE id = $1`, [id])).rowCount) throw notFound('Metric');
      if (req.user.role === 'admin') {
        if (id && (await c.query(`SELECT 1 FROM metric_change WHERE metric_id = $1 AND status = 'pending'`, [id])).rowCount) throw new AppError('A change to this metric is already waiting for approval', 409, 'PENDING');
        const ch = (await c.query(`INSERT INTO metric_change (tenant_id, metric_id, proposal, reason, proposed_by, proposed_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [tenant, id ?? null, JSON.stringify(metricSnapshot(d as Partial<MetricRow>)), reason, req.user.id, req.user.name])).rows[0];
        const supers = (await c.query(`SELECT id FROM app_user WHERE role = 'super_admin' AND NOT disabled`)).rows.map((r) => r.id as string);
        await notify(c, tenant, supers, { kind: 'metric_change', title: `${req.user.name} proposes a change to the metric registry`, body: `${d.name}: ${reason}`, link: '/metrics?tab=changes' });
        await audit(c, req, 'metric.propose', 'metric_change', ch.id, { metric: id ?? null, name: d.name, reason });
        return { pending: true, changeId: ch.id };
      }
      const r = await applyMetric(c, tenant, id ?? null, d, reason, req.user.name, req.user.name);
      await audit(c, req, id ? 'metric.update' : 'metric.create', 'metric', r.id, { code: r.code, version: r.version, reason });
      return { pending: false, ...r };
    });
  });

  app.post('/api/metrics/changes/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() }).parse(req.body);
    if (b.decision === 'reject' && !b.note) throw new AppError('Say why it is rejected');
    return tenantTx(tenant, async (c) => {
      const ch = (await c.query(`SELECT * FROM metric_change WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!ch) throw notFound('Change');
      if (ch.status !== 'pending') throw new AppError('Already decided', 409, 'DECIDED');
      if (ch.proposed_by === req.user.id) throw forbidden('Someone else approves your own proposal');
      if (req.user.role === 'platform_admin') throw forbidden('Registry changes are decided by the company\'s super admin, not platform staff');
      let out: { id: string; code: string; version: number } | null = null;
      if (b.decision === 'approve') out = await applyMetric(c, tenant, ch.metric_id, metricBody.parse(ch.proposal), ch.reason, ch.proposed_name ?? 'admin', req.user.name);
      await c.query(`UPDATE metric_change SET status = $2, decided_by = $3, decided_name = $4, decided_at = now(), decision_note = $5, metric_id = coalesce(metric_id, $6) WHERE id = $1`,
        [id, b.decision === 'approve' ? 'approved' : 'rejected', req.user.id, req.user.name, b.note ?? null, out?.id ?? null]);
      await notify(c, tenant, [ch.proposed_by], { kind: 'metric_decision', title: `Your change to "${ch.proposal.name}" was ${b.decision === 'approve' ? 'approved' : 'rejected'}`, body: b.note ?? undefined, link: '/metrics' });
      await audit(c, req, `metric.${b.decision}`, 'metric_change', id, { metric: out?.id ?? ch.metric_id, version: out?.version, note: b.note });
      return { ok: true, ...out };
    });
  });

  app.delete('/api/metrics/changes/:id', async (req) => {
    const tenant = requireTenant(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE metric_change SET status = 'withdrawn', decided_at = now(), decided_name = $3 WHERE id = $1 AND proposed_by = $2 AND status = 'pending'`, [id, req.user.id, req.user.name]);
      if (!r.rowCount) throw notFound('Your pending change');
      await audit(c, req, 'metric.withdraw', 'metric_change', id);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------------ calendar --
  app.get('/api/calendar', async (req) => {
    const tenant = requireTenant(req);
    const q = calSel.parse(req.query);
    return tenantTx(tenant, async (c) => {
      await ensureMetrics(c, tenant);
      const set = await cycleSettings(c, tenant), today = todayIn(set.timezone), year = q.year ?? Number(today.slice(0, 4));
      const facs = await viewFacs(c, req, { year, node: q.node, group: q.group });
      // company-wide metrics: for people who see the whole company, and their owners
      const whole = WHOLE.includes(req.user.role);
      const owns = (await c.query(`SELECT 1 FROM metric WHERE level = 'company' AND owner_user_id = $1 AND active`, [req.user.id])).rowCount;
      const obs = (await obligations(c, tenant, { years: [year], facilities: facs, today, company: !q.node && !q.group && (whole || !!owns) }))
        .filter((o) => o.level === 'facility' || whole || o.owner?.id === req.user.id);
      const s = await scopeOf(c, req.user);
      return {
        year, today, settings: set, mailOn: mailOn(), me: req.user.id,
        obligations: obs.map((o) => ({ ...o,
          canChase: o.level === 'company' ? ['super_admin', 'platform_admin'].includes(req.user.role) : CHASE.includes(req.user.role) && s.approve.has(o.facilityId),
          canEnter: o.level === 'company' ? ['super_admin', 'admin', 'platform_admin'].includes(req.user.role) || o.owner?.id === req.user.id : s.enter.has(o.facilityId) })),
        canSettings: ['super_admin', 'platform_admin'].includes(req.user.role),
      };
    });
  });

  app.post('/api/calendar/remind', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = z.object({ keys: z.array(z.string().regex(/^[0-9a-f-]{36}:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$/)).min(1).max(500) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await chaseable(c, req, b.keys.map((k) => k.split(':')[0]!)))) throw forbidden('You can only chase facilities you manage');
      const r = await remindNow(c, tenant, b.keys, req.user.name);
      await audit(c, req, 'collection.remind', 'collection', null, { keys: b.keys.length, sent: r.sent, people: r.people });
      return r;
    });
  });

  const excBody = z.object({ facilityId: z.string().uuid(), metricId: z.string().uuid(), period: z.string().regex(/^\d{4}-\d{2}-01$/) });
  app.post('/api/calendar/exception', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = excBody.extend({ reason: z.string().trim().min(3, 'Say why nothing is owed').max(500) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await chaseable(c, req, [b.facilityId]))) throw forbidden('You can only excuse facilities you manage');
      if (!(await c.query(`SELECT 1 FROM metric WHERE id = $1`, [b.metricId])).rowCount) throw notFound('Metric');
      await c.query(`INSERT INTO collection_exception (tenant_id, facility_id, metric_id, period, reason, by_user, by_name) VALUES ($1,$2,$3,$4,$5,$6,$7)
                     ON CONFLICT (facility_id, metric_id, period) DO UPDATE SET reason = EXCLUDED.reason, by_user = EXCLUDED.by_user, by_name = EXCLUDED.by_name, at = now()`,
        [tenant, b.facilityId, b.metricId, b.period, b.reason, req.user.id, req.user.name]);
      await audit(c, req, 'collection.excuse', 'collection', `${b.facilityId}:${b.metricId}:${b.period}`, { reason: b.reason });
      return { ok: true };
    });
  });

  app.delete('/api/calendar/exception', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const q = excBody.parse(req.query);
    return tenantTx(tenant, async (c) => {
      if (!(await chaseable(c, req, [q.facilityId]))) throw forbidden();
      const r = await c.query(`DELETE FROM collection_exception WHERE facility_id = $1 AND metric_id = $2 AND period = $3`, [q.facilityId, q.metricId, q.period]);
      if (!r.rowCount) throw notFound('Exception');
      await audit(c, req, 'collection.unexcuse', 'collection', `${q.facilityId}:${q.metricId}:${q.period}`);
      return { ok: true };
    });
  });

  app.put('/api/calendar/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ reminders: z.boolean().optional(), dueDay: z.number().int().min(1).max(28).optional(), remindDays: z.number().int().min(0).max(30).optional(), escalateDays: z.number().int().min(1).max(90).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`UPDATE tenant SET reminders = coalesce($2, reminders), due_day = coalesce($3, due_day), remind_days = coalesce($4, remind_days), escalate_days = coalesce($5, escalate_days) WHERE id = $1`,
        [tenant, b.reminders ?? null, b.dueDay ?? null, b.remindDays ?? null, b.escalateDays ?? null]);
      await audit(c, req, 'collection.settings', 'tenant', tenant, b);
      return cycleSettings(c, tenant);
    });
  });

  app.post('/api/calendar/run', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    return tenantTx(tenant, async (c) => {
      const r = await remindTenant(c, tenant);
      await audit(c, req, 'collection.run', 'collection', null, r);
      return r;
    });
  });

  // ------------------------------------------------------------------------ inbox --
  app.get('/api/inbox', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const me = String(req.user.id);
      const ob = await myObligations(c, req, tenant);
      const approvals = await approvalsForMe(c, req);
      const returned = (await c.query(
        `SELECT a.id, a.facility_id AS f, fo.name AS facility, cat.code AS cat, cat.name AS category, i.name AS item, a.period_start::text AS month, a.review_note AS note, ur.name AS by, a.reviewed_at AS at
           FROM activity a JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id JOIN org_node fo ON fo.id = a.facility_id LEFT JOIN app_user ur ON ur.id::text = a.reviewed_by
          WHERE a.status = 'rejected' AND (a.created_by = $1 OR a.submitted_by = $1) ORDER BY a.reviewed_at DESC NULLS LAST LIMIT 100`, [me])).rows;
      const drafts = Number((await c.query(`SELECT count(*)::int AS n FROM activity WHERE status = 'draft' AND created_by = $1`, [me])).rows[0].n);
      const metricChanges = ['super_admin', 'platform_admin'].includes(req.user.role)
        ? Number((await c.query(`SELECT count(*)::int AS n FROM metric_change WHERE status = 'pending' AND proposed_by IS DISTINCT FROM $1`, [req.user.id])).rows[0].n) : 0;
      const findings = ['super_admin', 'admin', 'platform_admin'].includes(req.user.role)
        ? Number((await c.query(`SELECT count(*)::int AS n FROM assurance_finding WHERE status = 'open'`)).rows[0].n) : 0;
      const restatements = ['super_admin', 'admin', 'platform_admin'].includes(req.user.role)
        ? Number((await c.query(`SELECT count(*)::int AS n FROM base_restatement WHERE status = 'pending' AND proposed_by IS DISTINCT FROM $1`, [req.user.id])).rows[0].n) : 0;
      const credits = ['super_admin', 'admin'].includes(req.user.role)
        ? Number((await c.query(`SELECT count(*)::int AS n FROM carbon_credit_retirement WHERE status = 'pending' AND proposed_by IS DISTINCT FROM $1`, [req.user.id])).rows[0].n) : 0;
      const notes = (await c.query(`SELECT id, kind, title, body, link, at, read_at FROM notification WHERE user_id = $1 ORDER BY at DESC LIMIT 150`, [req.user.id])).rows;
      const u = (await c.query(`SELECT email_notify FROM app_user WHERE id = $1`, [req.user.id])).rows[0];
      return {
        today: ob.today, mine: ob.mine, escalations: ob.escalations, upcoming: ob.upcoming, approvals, returned, drafts, metricChanges, findings, restatements, credits,
        notifications: notes, unread: notes.filter((n) => !n.read_at).length, emailNotify: u?.email_notify ?? true, mailOn: mailOn(),
      };
    });
  });

  app.get('/api/inbox/count', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const unread = Number((await c.query(`SELECT count(*)::int AS n FROM notification WHERE user_id = $1 AND read_at IS NULL`, [req.user.id])).rows[0].n);
      const ob = await myObligations(c, req, tenant);
      const returned = Number((await c.query(`SELECT count(*)::int AS n FROM activity WHERE status = 'rejected' AND (created_by = $1 OR submitted_by = $1)`, [String(req.user.id)])).rows[0].n);
      const approvals = await approvalsForMe(c, req);
      const late = (o: Obligation) => o.timing === 'overdue' || o.timing === 'escalated';
      return { unread, todo: ob.mine.filter(late).length + ob.escalations.length + returned + approvals, approvals };
    });
  });

  app.post('/api/inbox/read', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ ids: z.array(z.number().int()).max(500).optional(), all: z.boolean().optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = b.all
        ? await c.query(`UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [req.user.id])
        : await c.query(`UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2)`, [req.user.id, b.ids ?? []]);
      return { read: r.rowCount };
    });
  });

  app.put('/api/inbox/settings', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ emailNotify: z.boolean() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query(`UPDATE app_user SET email_notify = $2 WHERE id = $1`, [req.user.id, b.emailNotify]);
      await audit(c, req, 'user.email_notify', 'app_user', req.user.id, b);
      return b;
    });
  });
}
