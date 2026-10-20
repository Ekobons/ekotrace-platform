/**
 * Enter → Review → Approved, as in the prototype's Add data.
 *
 *   GET    /api/data/status?facilityId=&year=     per category and month: drafts, waiting, approved, sent back;
 *                                                the facility's type and manager, who approves, the categories it reports
 *   GET    /api/review?facilityId=&category=&from=&to=&stage=open|approved
 *                                                entries of a facility, category (or group: waste, water) and months
 *   POST   /api/activities/review {ids, action, note?}
 *            submit    draft or sent back → waiting (people who can enter the facility)
 *            withdraw  waiting → draft (the person who submitted it, or who can enter the facility)
 *            approve   waiting → approved (people who can approve the facility, not their own entry)
 *            return    waiting or approved → sent back, with a note (same people as approve)
 *   DELETE /api/activities/:id                    a draft or sent-back entry typed in Add data
 *
 * Nobody approves an entry they entered or submitted. Each change is in the audit log.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { audit, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { approvalSettings, needsL2, selfAllowed } from './approvals.routes.js';
import { EVIDENCE_SQL, METRIC_JOIN } from '../lib/collection.js';
import { notify } from '../lib/notify.js';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Category filter: a code, or a group shown as one tab (waste_*, water_*). */
/** A tab's entries: its category (waste_*, water_* for the waste and water tabs). The Purchases tab also holds every
 *  entry published from purchase files — capital goods (3.2), upstream transport (3.4), leased assets (3.8) and
 *  purchases moved to business travel (3.6, also shown in its own tab) — so nothing published is left without a place. */
const CAT_SQL = `(cat.code = $X OR ($X IN ('waste', 'water') AND cat.code LIKE $X || '_%')
  OR ($X = 'purchased_goods' AND (cat.code IN ('capital_goods', 'upstream_transport', 'upstream_leased') OR a.purchase_batch_id IS NOT NULL)))`;

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/api/data/status', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid(), year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      assertCan(s.see, q.facilityId);
      const f = (await c.query(`SELECT n.id, n.name, n.facility_type, n.manager_user_id, u.name AS manager FROM org_node n LEFT JOIN app_user u ON u.id = n.manager_user_id WHERE n.id = $1`, [q.facilityId])).rows[0];
      if (!f) throw notFound('Facility');
      const cells = (await c.query(
        `SELECT cat.code AS cat, extract(month FROM a.period_start)::int AS m,
                count(*) FILTER (WHERE a.status = 'draft')::int AS draft, count(*) FILTER (WHERE a.status = 'submitted')::int AS submitted,
                count(*) FILTER (WHERE a.status = 'approved')::int AS approved, count(*) FILTER (WHERE a.status = 'rejected')::int AS rejected
           FROM activity a JOIN category cat ON cat.id = a.category_id
          WHERE a.facility_id = $1 AND extract(year FROM a.period_start) = $2 GROUP BY 1, 2 ORDER BY 1, 2`, [q.facilityId, q.year])).rows;
      // Categories the facility reports: anything entered this year or last year.
      const usual = (await c.query(`SELECT DISTINCT cat.code FROM activity a JOIN category cat ON cat.id = a.category_id
                                     WHERE a.facility_id = $1 AND extract(year FROM a.period_start) IN ($2::int, $2::int - 1)`, [q.facilityId, q.year])).rows.map((r) => r.code as string);
      const mgrIsMe = f.manager_user_id && String(f.manager_user_id) === String(req.user.id);
      return {
        facility: { id: f.id, name: f.name, type: f.facility_type, manager: f.manager },
        approver: f.manager && !mgrIsMe ? f.manager : 'an admin or super admin',
        canEnter: s.enter.has(q.facilityId), canApprove: s.approve.has(q.facilityId), usual, cells,
      };
    });
  });

  app.get('/api/review', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid(), category: z.string().max(60), from: ymd, to: ymd, stage: z.enum(['open', 'approved']).default('open') }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      assertCan(s.see, q.facilityId);
      const me = String(req.user.id);
      const rows = (await c.query(
        `SELECT a.id, a.period_start::text AS period_start, a.period_end::text AS period_end, i.name AS item, a.quantity::float8 AS quantity, a.unit, a.data_type, a.note, a.status,
                (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3)::float8 AS kg, cat.scope, cat.code AS category, cat.name AS category_name, cat.ghg_category, a.created_by, a.submitted_by, a.review_note,
                a.submitted_at, a.reviewed_at, ue.name AS entered_by, ur.name AS reviewed_by_name, v.name AS vehicle, mt.name AS meter, ws.name AS waste_site,
                a.commute_record_id IS NOT NULL AS commute, a.purchase_batch_id IS NOT NULL AS purchase
           FROM activity a JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id
           LEFT JOIN app_user ue ON ue.id::text = a.created_by LEFT JOIN app_user ur ON ur.id::text = a.reviewed_by
           LEFT JOIN vehicle v ON v.id = a.vehicle_id LEFT JOIN meter mt ON mt.id = a.meter_id LEFT JOIN waste_site ws ON ws.id = a.waste_site_id
          WHERE a.facility_id = $1 AND ${CAT_SQL.replaceAll('$X', '$2')} AND a.period_start >= $3 AND a.period_start <= $4
            AND (CASE WHEN $5 = 'approved' THEN a.status = 'approved' ELSE a.status <> 'approved' END)
          ORDER BY a.period_start, cat.code, i.name LIMIT 2000`, [q.facilityId, q.category, q.from, q.to, q.stage])).rows;
      const canEnter = s.enter.has(q.facilityId), canApprove = s.approve.has(q.facilityId);
      return {
        entries: rows.map(({ created_by, submitted_by, ...r }) => {
          const mine = created_by === me || submitted_by === me;
          return { ...r, mine, canApprove: canApprove && !mine && r.status === 'submitted', canReturn: canApprove && !mine && (r.status === 'submitted' || r.status === 'approved'),
            canSubmit: canEnter && (r.status === 'draft' || r.status === 'rejected'), canWithdraw: r.status === 'submitted' && (submitted_by === me || canEnter),
            canDelete: canEnter && (r.status === 'draft' || r.status === 'rejected') && !r.commute && !r.purchase };
        }),
        canEnter, canApprove,
      };
    });
  });

  app.post('/api/activities/review', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(2000), action: z.enum(['submit', 'withdraw', 'approve', 'return']), note: z.string().trim().max(1000).optional() }).parse(req.body);
    if (b.action === 'return' && !b.note) throw new AppError('Say why it is sent back, so the person can fix it');
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const me = String(req.user.id);
      const rows = (await c.query(`SELECT a.id, a.facility_id, a.status, a.created_by, a.submitted_by, a.approval_stage, a.l1_by, cat.code AS cat, (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3)::float8 AS kg,
                                          EXISTS (SELECT 1 FROM period_lock pl WHERE pl.month BETWEEN date_trunc('month', a.period_start)::date AND date_trunc('month', a.period_end)::date) AS locked,
                                          coalesce((a.inputs->'wasteInfo'->>'hazardous')::boolean, false) AS haz, nullif(trim(a.inputs->'wasteInfo'->>'ref'), '') AS manifest,
                                          mt.metric_code, mt.evidence = 'required' AND NOT ${EVIDENCE_SQL} AS needs_evidence, fo.name AS facility, i.name AS item, a.period_start::text AS month
                                     FROM activity a JOIN category cat ON cat.id = a.category_id JOIN org_node fo ON fo.id = a.facility_id JOIN item i ON i.id = a.item_id ${METRIC_JOIN}
                                    WHERE a.id = ANY($1) FOR UPDATE OF a`, [b.ids])).rows;
      const done: string[] = [], skipped: { id: string; reason: string }[] = [], toL2: string[] = [];
      const set = await approvalSettings(c, tenant), canL2 = ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
      // A company whose only user (verifiers aside) is its super admin approves its own entries: marked self-reviewed.
      const solo = req.user.role === 'super_admin' && Number((await c.query(`SELECT count(*)::int AS n FROM app_user WHERE NOT disabled AND role <> 'verifier'`)).rows[0].n) === 1;
      for (const a of rows) {
        const mine = a.created_by === me || a.submitted_by === me;
        let why: string | null = null, sql = '';
        if (!s.see.has(a.facility_id)) why = 'no access to this facility';
        else if (a.locked) why = 'the month is locked for assurance';
        else if (b.action === 'submit') {
          if (!s.enter.has(a.facility_id)) why = 'you cannot enter data for this facility';
          else if (a.status !== 'draft' && a.status !== 'rejected') why = `already ${a.status === 'approved' ? 'approved' : 'waiting for approval'}`;
          // hazardous waste travels with a manifest / consignment note in most jurisdictions (EU, UK, US, UAE…): no number, no submission
          else if (a.cat === 'waste_generated' && a.haz && !a.manifest) why = 'hazardous waste needs its manifest number';
          // the metric registry asks for evidence (a bill, meter, file or linked document)
          else if (a.needs_evidence) why = `metric ${a.metric_code} needs evidence: link a bill or document in the Document vault first`;
          else sql = `UPDATE activity SET status = 'submitted', submitted_at = now(), submitted_by = $2, approval_stage = NULL, l1_by = NULL, l1_at = NULL, updated_at = now() WHERE id = $1`;
        } else if (b.action === 'withdraw') {
          if (a.status !== 'submitted') why = 'not waiting for approval';
          else if (a.submitted_by !== me && !s.enter.has(a.facility_id)) why = 'only the person who submitted it';
          else sql = `UPDATE activity SET status = 'draft', submitted_at = NULL, submitted_by = NULL, approval_stage = NULL, l1_by = NULL, l1_at = NULL, updated_at = now() WHERE id = $1`;
        } else {
          const self = mine && !solo && selfAllowed(set, req.user.role, Number(a.kg));
          if (req.user.role === 'platform_admin') why = 'platform staff do not approve company data';
          else if (!s.approve.has(a.facility_id)) why = 'you cannot approve data for this facility';
          else if (mine && !solo && !self) why = set.selfApproval ? 'self-approval is not allowed for your role or for an entry this large' : 'nobody approves their own entry';
          else if (self && b.action === 'approve' && !b.note) why = 'approving your own entry needs a note confirming you checked it against its evidence';
          else if (b.action === 'approve' && a.status !== 'submitted') why = a.status === 'approved' ? 'already approved' : 'not submitted yet';
          else if (b.action === 'approve' && a.needs_evidence) why = `metric ${a.metric_code} needs evidence before approval`;
          else if (b.action === 'return' && a.status !== 'submitted' && a.status !== 'approved') why = 'not submitted';
          else if (a.approval_stage === 'L2' && b.action === 'approve' && !canL2) why = 'level 2 is approved by an admin or the super admin';
          else if (a.approval_stage === 'L2' && b.action === 'approve' && a.l1_by === me) why = 'level 2 is approved by someone other than level 1';
          else if (b.action === 'approve' && !a.approval_stage && needsL2(set, Number(a.kg), a.cat) && !solo) {
            // level 1 done: on to level 2
            sql = `UPDATE activity SET approval_stage = 'L2', l1_by = $2, l1_at = now(), updated_at = now() WHERE id = $1`; toL2.push(a.id);
          } else sql = b.action === 'approve'
            ? `UPDATE activity SET status = 'approved', reviewed_at = now(), reviewed_by = $2, review_note = NULL, self_reviewed = ${mine ? 'true' : 'false'}, self_review_note = ${mine ? '$3' : 'NULL'}, updated_at = now() WHERE id = $1`
            : `UPDATE activity SET status = 'rejected', reviewed_at = now(), reviewed_by = $2, review_note = $3, approval_stage = NULL, l1_by = NULL, l1_at = NULL, updated_at = now() WHERE id = $1`;
        }
        if (why) { skipped.push({ id: a.id, reason: why }); continue; }
        await c.query(sql, b.action === 'return' || sql.includes('$3') ? [a.id, me, b.note ?? null] : sql.includes('$2') ? [a.id, me] : [a.id]);
        done.push(a.id);
      }
      for (const id of b.ids) if (!rows.some((r) => r.id === id)) skipped.push({ id, reason: 'not found' });
      // sent back: the people who entered or submitted it hear about it (in their Inbox, and by e-mail)
      if (b.action === 'return') {
        const back = rows.filter((r) => done.includes(r.id));
        const per = new Map<string, typeof back>();
        for (const r of back) for (const u of new Set([r.created_by, r.submitted_by].filter((x): x is string => !!x && x !== me && /^[0-9a-f-]{36}$/.test(x)))) per.set(u, [...(per.get(u) ?? []), r]);
        for (const [u, rs] of per) await notify(c, tenant, [u], {
          kind: 'returned', title: rs.length === 1 ? `Sent back: ${rs[0]!.facility} · ${rs[0]!.item} · ${rs[0]!.month.slice(0, 7)}` : `${rs.length} entries sent back to you`,
          body: `${req.user.name}: ${b.note}\n\n${rs.slice(0, 20).map((r) => `• ${r.facility} · ${r.item} · ${r.month.slice(0, 7)}`).join('\n')}`, link: '/inbox',
        });
      }
      const final = done.filter((id) => !toL2.includes(id));
      if (final.length) await audit(c, req, `activity.${b.action}`, 'activity', final.length === 1 ? final[0] : null, { ids: final, note: b.note ?? undefined });
      if (toL2.length) await audit(c, req, 'activity.approve_l1', 'activity', toL2.length === 1 ? toL2[0] : null, { ids: toL2 });
      return { done: done.length, skipped, toLevel2: toL2.length };
    });
  });

  app.delete('/api/activities/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const a = (await c.query('SELECT id, facility_id, status, commute_record_id, purchase_batch_id, quantity, unit FROM activity WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!a || !s.see.has(a.facility_id)) throw notFound('Entry');
      assertCan(s.enter, a.facility_id);
      if (a.status !== 'draft' && a.status !== 'rejected') throw new AppError(a.status === 'approved' ? 'Approved entries are kept. Ask an approver to send it back first.' : 'Withdraw it from review first', 409, 'LOCKED');
      if (a.commute_record_id) throw new AppError('This entry comes from the commuting record of the year: change or remove the record under Employee commuting', 409, 'LOCKED');
      if (a.purchase_batch_id) throw new AppError('This entry comes from published purchase lines: change them under Purchases', 409, 'LOCKED');
      await c.query('DELETE FROM activity WHERE id = $1', [id]);
      await audit(c, req, 'activity.delete', 'activity', id, { quantity: Number(a.quantity), unit: a.unit });
      return { ok: true };
    });
  });
}
