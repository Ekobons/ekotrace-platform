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

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Category filter: a code, or a group shown as one tab (waste_*, water_*). */
const CAT_SQL = `(cat.code = $X OR ($X IN ('waste', 'water') AND cat.code LIKE $X || '_%'))`;

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
                (a.co2e_direct + a.co2e_scope2 + a.co2e_scope3)::float8 AS kg, cat.scope, cat.code AS category, a.created_by, a.submitted_by, a.review_note,
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
      const rows = (await c.query('SELECT id, facility_id, status, created_by, submitted_by FROM activity WHERE id = ANY($1) FOR UPDATE', [b.ids])).rows;
      const done: string[] = [], skipped: { id: string; reason: string }[] = [];
      // A company whose only user (verifiers aside) is its super admin approves its own entries: marked self-reviewed.
      const solo = req.user.role === 'super_admin' && Number((await c.query(`SELECT count(*)::int AS n FROM app_user WHERE NOT disabled AND role <> 'verifier'`)).rows[0].n) === 1;
      for (const a of rows) {
        const mine = a.created_by === me || a.submitted_by === me;
        let why: string | null = null, sql = '';
        if (!s.see.has(a.facility_id)) why = 'no access to this facility';
        else if (b.action === 'submit') {
          if (!s.enter.has(a.facility_id)) why = 'you cannot enter data for this facility';
          else if (a.status !== 'draft' && a.status !== 'rejected') why = `already ${a.status === 'approved' ? 'approved' : 'waiting for approval'}`;
          else sql = `UPDATE activity SET status = 'submitted', submitted_at = now(), submitted_by = $2, updated_at = now() WHERE id = $1`;
        } else if (b.action === 'withdraw') {
          if (a.status !== 'submitted') why = 'not waiting for approval';
          else if (a.submitted_by !== me && !s.enter.has(a.facility_id)) why = 'only the person who submitted it';
          else sql = `UPDATE activity SET status = 'draft', submitted_at = NULL, submitted_by = NULL, updated_at = now() WHERE id = $1`;
        } else {
          if (!s.approve.has(a.facility_id)) why = 'you cannot approve data for this facility';
          else if (mine && !solo) why = 'nobody approves their own entry';
          else if (b.action === 'approve' && a.status !== 'submitted') why = a.status === 'approved' ? 'already approved' : 'not submitted yet';
          else if (b.action === 'return' && a.status !== 'submitted' && a.status !== 'approved') why = 'not submitted';
          else sql = b.action === 'approve'
            ? `UPDATE activity SET status = 'approved', reviewed_at = now(), reviewed_by = $2, review_note = NULL, self_reviewed = ${mine ? 'true' : 'false'}, updated_at = now() WHERE id = $1`
            : `UPDATE activity SET status = 'rejected', reviewed_at = now(), reviewed_by = $2, review_note = $3, updated_at = now() WHERE id = $1`;
        }
        if (why) { skipped.push({ id: a.id, reason: why }); continue; }
        await c.query(sql, b.action === 'return' ? [a.id, me, b.note] : sql.includes('$2') ? [a.id, me] : [a.id]);
        done.push(a.id);
      }
      for (const id of b.ids) if (!rows.some((r) => r.id === id)) skipped.push({ id, reason: 'not found' });
      if (done.length) await audit(c, req, `activity.${b.action}`, 'activity', done.length === 1 ? done[0] : null, { ids: done, note: b.note ?? undefined });
      return { done: done.length, skipped };
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
