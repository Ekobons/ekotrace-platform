/**
 * Audit & assurance (Disclose): what an external assurance provider needs, under any of the usual standards
 * (ISO 14064-3, ISAE 3410, ISAE 3000, ISSA 5000, AA1000AS v3), at limited or reasonable assurance.
 *
 *   Engagement     standard, level, provider, scope, materiality, status, conclusion and the signed statement
 *   Period locks   a month whose entries are all approved can be locked; nothing in it can then be added, changed
 *                  or removed — enforced by the database (trigger on activity) whatever screen or import tries.
 *                  Unlocking needs a reason (audit log).
 *   Samples        random (seeded, reproducible) or value-weighted (monetary-unit style: larger tCO2e more likely),
 *                  with every key item (an entry above the key-item threshold) always included. Each entry is
 *                  tested: agreed / exception, with a note.
 *   Findings       raised by the verifier (or an admin): severity, kind, estimated misstatement; the company
 *                  responds; the verifier closes. Open findings and their total impact against materiality.
 *   Pack           everything above with the totals and factor sources, for the verifier's file.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';

const yearQ = z.object({ year: z.coerce.number().int().min(2000).max(2100) });
const STANDARDS = ['ISO 14064-3', 'ISAE 3410', 'ISAE 3000 (Revised)', 'ISSA 5000', 'AA1000AS v3', 'Other'] as const;
const ADMIN = ['super_admin', 'admin'] as const;
const canVerify = (req: FastifyRequest) => ['verifier', 'super_admin', 'admin', 'platform_admin'].includes(req.user.role);
/** tCO2e of an entry as reported (location-based Scope 2), before the consolidation weight. */
const T_SQL = `((a.co2e_direct + a.co2e_scope2 + a.co2e_scope3 + a.co2e_wtt + coalesce(a.co2e_td, 0)) / 1000)`;
const EVIDENCE_SQL = `(a.meter_id IS NOT NULL OR a.purchase_batch_id IS NOT NULL OR EXISTS (SELECT 1 FROM waste_scan ws WHERE ws.activity_id = a.id))`;

/** The consolidation weight of a facility (as in the reports): entries outside the boundary weigh 0 and are not sampled. */
async function weightSql(c: Tx) {
  const t = (await c.query(`SELECT consolidation FROM tenant WHERE id = nullif(current_setting('app.tenant_id', true), '')::uuid`)).rows[0];
  return t?.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t?.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
}

/** Seeded PRNG (mulberry32): the same seed draws the same sample, so the verifier can reproduce it. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function months(c: Tx, year: number) {
  const rows = (await c.query(
    `SELECT extract(month FROM mo.d)::int AS m, a.status, count(DISTINCT a.id)::int AS n
       FROM activity a CROSS JOIN LATERAL generate_series(date_trunc('month', a.period_start), date_trunc('month', a.period_end), interval '1 month') AS mo(d)
      WHERE extract(year FROM mo.d) = $1 GROUP BY 1, 2`, [year])).rows;
  const locks = (await c.query(`SELECT to_char(month, 'YYYY-MM') AS month, locked_by AS "lockedBy", locked_at AS "lockedAt", reason FROM period_lock WHERE extract(year FROM month) = $1`, [year])).rows;
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1, by = (s: string) => rows.filter((r) => r.m === m && r.status === s).reduce((a, r) => a + r.n, 0);
    const key = `${year}-${String(m).padStart(2, '0')}`, lock = locks.find((l) => l.month === key) ?? null;
    const open = by('draft') + by('submitted') + by('rejected');
    return { month: key, approved: by('approved'), open, ready: !open && by('approved') > 0, lock };
  });
}

export async function assuranceRoutes(app: FastifyInstance) {
  app.get('/api/assurance', async (req) => {
    const tenant = requireTenant(req);
    const { year } = yearQ.parse(req.query);
    return tenantTx(tenant, async (c) => {
      const eng = (await c.query(`SELECT e.*, d.filename AS statement_name FROM assurance_engagement e LEFT JOIN document d ON d.id = e.statement_id WHERE e.year = $1`, [year])).rows[0] ?? null;
      const W = await weightSql(c);
      const k = (await c.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE ${EVIDENCE_SQL})::int AS ev, coalesce(sum(${T_SQL} * ${W}), 0)::float8 AS t
                                  FROM activity a JOIN org_node f ON f.id = a.facility_id WHERE a.status = 'approved' AND extract(year FROM a.period_start) = $1 AND ${W} > 0`, [year])).rows[0];
      const samples = (await c.query(`SELECT s.id, s.method, s.seed, s.size, s.key_items AS "keyItems", s.population, s.population_t::float8 AS "populationT", s.created_by AS "by", s.created_at AS at,
                                             count(t.*) FILTER (WHERE t.result IS NOT NULL)::int AS tested, count(t.*) FILTER (WHERE t.result = 'exception')::int AS exceptions
                                        FROM assurance_sample s LEFT JOIN assurance_test t ON t.sample_id = s.id WHERE s.year = $1 GROUP BY s.id ORDER BY s.created_at DESC`, [year])).rows;
      const findings = (await c.query(`SELECT x.id, x.severity, x.kind, x.text, x.impact_t::float8 AS "impactT", x.status, x.response, x.responded_by AS "respondedBy", x.responded_at AS "respondedAt",
                                              x.raised_by AS "raisedBy", x.raised_at AS "raisedAt", x.closed_by AS "closedBy", x.closed_at AS "closedAt", x.close_note AS "closeNote",
                                              x.activity_id AS "activityId", f.name AS facility, i.name AS item, a.period_start::text AS period
                                         FROM assurance_finding x LEFT JOIN activity a ON a.id = x.activity_id LEFT JOIN item i ON i.id = a.item_id LEFT JOIN org_node f ON f.id = coalesce(x.facility_id, a.facility_id)
                                        WHERE x.year = $1 ORDER BY (x.status = 'closed'), x.raised_at DESC`, [year])).rows;
      const r = req.user.role;
      return {
        standards: STANDARDS, engagement: eng && { standard: eng.standard, level: eng.level, provider: eng.provider, lead: eng.lead, scope: eng.scope, materiality: eng.materiality == null ? null : Number(eng.materiality),
          status: eng.status, opinion: eng.opinion, issuedOn: eng.issued_on, statementId: eng.statement_id, statementName: eng.statement_name, updatedBy: eng.updated_by, updatedAt: eng.updated_at },
        kpis: { approved: k.n, evidencePct: k.n ? (k.ev / k.n) * 100 : 0, totalT: k.t, openFindings: findings.filter((f) => f.status !== 'closed').length,
          openImpactT: findings.filter((f) => f.status !== 'closed').reduce((a, f) => a + (f.impactT ?? 0), 0) },
        months: await months(c, year), samples, findings,
        can: { admin: r === 'platform_admin' || (ADMIN as readonly string[]).includes(r), verify: ['verifier', 'super_admin', 'admin', 'platform_admin'].includes(r), respond: r !== 'verifier' },
      };
    });
  });

  app.put('/api/assurance/engagement', async (req) => {
    const tenant = requireTenant(req);
    if (!canVerify(req)) throw forbidden();
    const b = z.object({
      year: z.number().int().min(2000).max(2100), standard: z.enum(STANDARDS), level: z.enum(['limited', 'reasonable']), provider: z.string().trim().max(160).optional(), lead: z.string().trim().max(160).optional(),
      scope: z.string().trim().max(500).optional(), materiality: z.number().positive().max(20).optional(), status: z.enum(['planning', 'fieldwork', 'reporting', 'issued']),
      opinion: z.string().trim().max(4000).optional(), issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);
    if (b.status === 'issued' && !b.opinion) throw new AppError('Write the conclusion as it appears in the assurance statement');
    return tenantTx(tenant, async (c) => {
      await c.query(`INSERT INTO assurance_engagement (tenant_id, year, standard, level, provider, lead, scope, materiality, status, opinion, issued_on, updated_by)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                     ON CONFLICT (tenant_id, year) DO UPDATE SET standard = EXCLUDED.standard, level = EXCLUDED.level, provider = EXCLUDED.provider, lead = EXCLUDED.lead, scope = EXCLUDED.scope,
                       materiality = EXCLUDED.materiality, status = EXCLUDED.status, opinion = EXCLUDED.opinion, issued_on = EXCLUDED.issued_on, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [tenant, b.year, b.standard, b.level, b.provider || null, b.lead || null, b.scope || null, b.materiality ?? null, b.status, b.opinion || null, b.issuedOn ?? null, req.user.name]);
      await audit(c, req, 'assurance.engagement', 'assurance_engagement', String(b.year), b);
      return { ok: true };
    });
  });

  /** The signed assurance statement (PDF, body = the file). */
  app.post('/api/assurance/statement', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req);
    if (!canVerify(req)) throw forbidden();
    const year = z.coerce.number().int().min(2000).max(2100).parse(req.headers['x-year']);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('Send the statement as a PDF');
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'assurance-statement.pdf')).replace(/[^\w.\- ()]/g, '_').slice(0, 160);
    const h = createHash('sha256').update(buf).digest('hex');
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('SELECT 1 FROM assurance_engagement WHERE year = $1', [year])).rowCount) throw new AppError('Save the engagement first');
      const id = (await c.query('SELECT id FROM document WHERE sha256 = $1', [h])).rows[0]?.id ?? (await c.query(
        `INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1,'assurance',$2,'application/pdf',$3,$4,$5,$6) RETURNING id`,
        [tenant, filename, buf.length, h, buf, req.user.name])).rows[0].id;
      await c.query('UPDATE assurance_engagement SET statement_id = $2, updated_by = $3, updated_at = now() WHERE year = $1', [year, id, req.user.name]);
      await audit(c, req, 'assurance.statement', 'document', id, { year, filename });
      return { id, filename };
    });
  });

  app.get('/api/assurance/statement/:id', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const d = await tenantTx(tenant, async (c) => (await c.query(`SELECT filename, data FROM document WHERE id = $1 AND kind = 'assurance'`, [id])).rows[0]);
    if (!d) throw notFound('Statement');
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${String(d.filename).replace(/[^\w.\- ]/g, '_')}"`).send(d.data);
  });

  // -------------------------------------------------------------------- locks --
  app.post('/api/assurance/locks', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const b = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), reason: z.string().trim().max(500).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const m = (await months(c, Number(b.month.slice(0, 4)))).find((x) => x.month === b.month)!;
      if (m.lock) throw new AppError('Already locked');
      if (m.open) throw new AppError(`${m.open} entr${m.open === 1 ? 'y is' : 'ies are'} not approved yet in this month (draft, waiting or sent back): approve or remove them first`);
      await c.query('INSERT INTO period_lock (tenant_id, month, locked_by, reason) VALUES ($1, $2::date, $3, $4)', [tenant, `${b.month}-01`, req.user.name, b.reason || null]);
      await audit(c, req, 'period.lock', 'period_lock', b.month, { reason: b.reason, approved: m.approved });
      return { ok: true };
    });
  });

  app.post('/api/assurance/locks/:month/unlock', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...ADMIN);
    const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse((req.params as { month: string }).month);
    const b = z.object({ reason: z.string().trim().min(5, 'Say why it is unlocked (at least a few words)').max(500) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('DELETE FROM period_lock WHERE month = $1::date', [`${month}-01`])).rowCount) throw notFound('Lock');
      await audit(c, req, 'period.unlock', 'period_lock', month, { reason: b.reason });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ samples --
  app.post('/api/assurance/samples', async (req) => {
    const tenant = requireTenant(req);
    if (!canVerify(req)) throw forbidden();
    const b = z.object({ year: z.number().int().min(2000).max(2100), method: z.enum(['random', 'value']), size: z.number().int().min(1).max(500),
      seed: z.number().int().min(1).max(2 ** 31 - 1).optional(), keyPct: z.number().min(0.1).max(50).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const W = await weightSql(c);
      const pop = (await c.query(`SELECT a.id, (${T_SQL} * ${W})::float8 AS t FROM activity a JOIN org_node f ON f.id = a.facility_id
                                   WHERE a.status = 'approved' AND extract(year FROM a.period_start) = $1 AND ${W} > 0 ORDER BY a.id`, [b.year])).rows as { id: string; t: number }[];
      if (!pop.length) throw new AppError('No approved entries this year to sample from');
      const total = pop.reduce((a, x) => a + Math.max(0, x.t), 0);
      const eng = (await c.query('SELECT materiality FROM assurance_engagement WHERE year = $1', [b.year])).rows[0];
      const keyPct = b.keyPct ?? (eng?.materiality ? Number(eng.materiality) / 2 : 5);   // key items: half of materiality, or 5% of the total
      const key = pop.filter((x) => total && x.t >= (total * keyPct) / 100);
      const rest = pop.filter((x) => !key.includes(x));
      const seed = b.seed ?? Math.floor(Math.random() * 2 ** 31);
      const r = rng(seed), want = Math.max(0, Math.min(b.size - key.length, rest.length));
      let picked: { id: string; t: number }[] = [];
      if (b.method === 'random') {
        const a = [...rest];
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
        picked = a.slice(0, want);
      } else if (want) {
        // value-weighted, systematic: every "interval" tCO2e along the cumulative total, from a random start
        const rt = rest.reduce((a, x) => a + Math.max(0, x.t), 0), step = rt / want;
        let next = r() * step, cum = 0;
        for (const x of rest) { cum += Math.max(0, x.t); if (cum >= next && picked.length < want) { picked.push(x); while (next <= cum) next += step; } }
      }
      const s = (await c.query(`INSERT INTO assurance_sample (tenant_id, year, method, seed, size, key_items, population, population_t, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, b.year, b.method, seed, key.length + picked.length, key.length, pop.length, total, req.user.name])).rows[0];
      for (const x of [...key.map((k) => ({ ...k, key: true })), ...picked.map((p) => ({ ...p, key: false }))]) {
        await c.query('INSERT INTO assurance_test (sample_id, activity_id, tenant_id, key_item) VALUES ($1,$2,$3,$4)', [s.id, x.id, tenant, x.key]);
      }
      await audit(c, req, 'assurance.sample', 'assurance_sample', s.id, { year: b.year, method: b.method, seed, size: key.length + picked.length, keyItems: key.length, keyPct });
      return { id: s.id, seed, size: key.length + picked.length, keyItems: key.length, keyPct };
    });
  });

  app.get('/api/assurance/samples/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const items = (await c.query(
        `SELECT a.id, t.key_item AS "key", t.result, t.note, t.tested_by AS "testedBy", t.tested_at AS "testedAt", f.name AS facility, a.period_start::text AS "from", a.period_end::text AS "to",
                cat.name AS category, i.name AS item, a.quantity::float8 AS qty, a.unit, ${T_SQL}::float8 AS t, a.factors->0->>'source' AS source, a.data_type AS "dataType", a.note AS "entryNote",
                ${EVIDENCE_SQL} AS evidence, CASE WHEN a.meter_id IS NOT NULL THEN 'meter / bill' WHEN a.purchase_batch_id IS NOT NULL THEN 'purchases file' WHEN EXISTS (SELECT 1 FROM waste_scan ws WHERE ws.activity_id = a.id) THEN 'QR scans' ELSE NULL END AS "evidenceKind",
                cu.name AS "enteredBy", ru.name AS "approvedBy", a.reviewed_at AS "approvedAt"
           FROM assurance_test t JOIN activity a ON a.id = t.activity_id JOIN org_node f ON f.id = a.facility_id JOIN item i ON i.id = a.item_id JOIN category cat ON cat.id = a.category_id
           LEFT JOIN app_user cu ON cu.id::text = a.created_by::text LEFT JOIN app_user ru ON ru.id::text = a.reviewed_by
          WHERE t.sample_id = $1 ORDER BY t.key_item DESC, a.period_start, f.name`, [id])).rows;
      if (!items.length && !(await c.query('SELECT 1 FROM assurance_sample WHERE id = $1', [id])).rowCount) throw notFound('Sample');
      return { items };
    });
  });

  app.put('/api/assurance/samples/:sid/tests/:aid', async (req) => {
    const tenant = requireTenant(req);
    if (!canVerify(req)) throw forbidden();
    const p = z.object({ sid: z.string().uuid(), aid: z.string().uuid() }).parse(req.params);
    const b = z.object({ result: z.enum(['agreed', 'exception']).nullable(), note: z.string().trim().max(1000).optional() }).parse(req.body);
    if (b.result === 'exception' && !b.note) throw new AppError('Describe the exception');
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE assurance_test SET result = $3, note = $4, tested_by = $5, tested_at = now() WHERE sample_id = $1 AND activity_id = $2`, [p.sid, p.aid, b.result, b.note || null, req.user.name]);
      if (!r.rowCount) throw notFound('Sample item');
      await audit(c, req, 'assurance.test', 'activity', p.aid, { sample: p.sid, result: b.result, note: b.note });
      return { ok: true };
    });
  });

  // ----------------------------------------------------------------- findings --
  app.post('/api/assurance/findings', async (req) => {
    const tenant = requireTenant(req);
    if (!canVerify(req)) throw forbidden();
    const b = z.object({ year: z.number().int().min(2000).max(2100), activityId: z.string().uuid().optional(), facilityId: z.string().uuid().optional(),
      severity: z.enum(['low', 'medium', 'high']), kind: z.enum(['misstatement', 'evidence', 'control', 'method', 'other']), text: z.string().trim().min(3).max(2000), impactT: z.number().min(-1e7).max(1e7).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`INSERT INTO assurance_finding (tenant_id, year, activity_id, facility_id, severity, kind, text, impact_t, raised_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [tenant, b.year, b.activityId ?? null, b.facilityId ?? null, b.severity, b.kind, b.text, b.impactT ?? null, req.user.name])).rows[0];
      await audit(c, req, 'assurance.finding', 'assurance_finding', r.id, b);
      return { id: r.id };
    });
  });

  app.put('/api/assurance/findings/:id/respond', async (req) => {
    const tenant = requireTenant(req);
    if (req.user.role === 'verifier') throw forbidden('The company responds to a finding; the verifier closes it');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ response: z.string().trim().min(3).max(2000) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE assurance_finding SET response = $2, responded_by = $3, responded_at = now(), status = 'responded' WHERE id = $1 AND status <> 'closed'`, [id, b.response, req.user.name]);
      if (!r.rowCount) throw new AppError('Finding not found or already closed');
      await audit(c, req, 'assurance.finding.respond', 'assurance_finding', id, b);
      return { ok: true };
    });
  });

  app.put('/api/assurance/findings/:id/close', async (req) => {
    const tenant = requireTenant(req);
    if (!['verifier', 'super_admin', 'platform_admin'].includes(req.user.role)) throw forbidden('The verifier (or the super admin) closes a finding');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ note: z.string().trim().max(1000).optional(), reopen: z.boolean().optional() }).parse(req.body ?? {});
    return tenantTx(tenant, async (c) => {
      const r = b.reopen
        ? await c.query(`UPDATE assurance_finding SET status = 'open', closed_by = NULL, closed_at = NULL, close_note = $2 WHERE id = $1`, [id, b.note || null])
        : await c.query(`UPDATE assurance_finding SET status = 'closed', closed_by = $2, closed_at = now(), close_note = $3 WHERE id = $1 AND status <> 'closed'`, [id, req.user.name, b.note || null]);
      if (!r.rowCount) throw notFound('Finding');
      await audit(c, req, b.reopen ? 'assurance.finding.reopen' : 'assurance.finding.close', 'assurance_finding', id, b);
      return { ok: true };
    });
  });

  /** For the verifier's file: totals (both Scope 2 methods, with the consolidation), factor sources and the change trail of the year's entries. */
  app.get('/api/assurance/pack', async (req) => {
    const tenant = requireTenant(req);
    const { year } = yearQ.parse(req.query);
    return tenantTx(tenant, async (c) => {
      const t = (await c.query('SELECT name, consolidation, gwp_set, base_year, country, currency FROM tenant WHERE id = $1', [tenant])).rows[0];
      const W = t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
      const tot = (await c.query(`SELECT coalesce(sum(a.co2e_direct * ${W}), 0)::float8 / 1000 AS s1, coalesce(sum(a.co2e_scope2 * ${W}), 0)::float8 / 1000 AS s2l,
                                         coalesce(sum(coalesce(a.co2e_scope2_market, a.co2e_scope2) * ${W}), 0)::float8 / 1000 AS s2m,
                                         coalesce(sum((a.co2e_scope3 + a.co2e_wtt + coalesce(a.co2e_td, 0)) * ${W}), 0)::float8 / 1000 AS s3, coalesce(sum(a.co2_biogenic * ${W}), 0)::float8 / 1000 AS bio,
                                         count(*)::int AS n
                                    FROM activity a JOIN org_node f ON f.id = a.facility_id WHERE a.status = 'approved' AND extract(year FROM a.period_start) = $1`, [year])).rows[0];
      const sources = (await c.query(`SELECT coalesce(a.factors->0->>'source', 'own / supplier factor') AS source, count(*)::int AS n FROM activity a
                                       WHERE a.status = 'approved' AND extract(year FROM a.period_start) = $1 GROUP BY 1 ORDER BY 2 DESC`, [year])).rows;
      const trail = (await c.query(`SELECT l.at, l.user_name AS "user", l.action, l.entity_id AS "entityId", l.detail FROM audit_log l
                                     WHERE (l.entity = 'activity' AND l.entity_id IN (SELECT a.id::text FROM activity a WHERE extract(year FROM a.period_start) = $1))
                                        OR l.action LIKE 'period.%' OR l.action LIKE 'assurance.%' OR l.action = 'methodology.update'
                                     ORDER BY l.at LIMIT 20000`, [year])).rows;
      return { company: t.name, consolidation: t.consolidation, gwp: t.gwp_set, baseYear: t.base_year, totals: tot, sources, trail };
    });
  });
}
