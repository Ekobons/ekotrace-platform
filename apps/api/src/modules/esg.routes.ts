/**
 * ESG: frameworks, double materiality assessment, ESG data.
 *
 *   GET  /api/esg?year=                 assessment of the year (frameworks, topics with scores, supplier input), the
 *                                       questions of the material topics for the industry with answers, catalogue
 *   PUT  /api/esg/assessment            create or change the year's set-up (industry, frameworks, thresholds, value chain,
 *                                       stakeholders, methodology); any change to an approved assessment returns it to draft
 *   PUT  /api/esg/topics/:topic         impact and financial assessment of one topic, materiality decision and reason
 *   POST /api/esg/assessment/submit     send for approval (super admin, admin, manager)
 *   POST /api/esg/assessment/decide     approve or return: super admin or admin who did not send it or last change it
 *   PUT  /api/esg/answers               one ESG data point of the year
 *   GET  /api/esg/export?year=          workbook: material topics, IROs, ESG data with framework references, content index
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { FRAMEWORKS, INDUSTRIES, QUESTIONS, TOPICS, financialScore, impactScore, needs, questionsFor } from '../lib/esg.js';
import { measured } from '../lib/restate.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { PRODUCT } from '../lib/brand.js';

const EDIT = ['super_admin', 'admin', 'manager'] as const;
const canEdit = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const yearQ = z.object({ year: z.coerce.number().int().min(2015).max(2100).default(new Date().getUTCFullYear() - 1) });
const s15 = z.number().int().min(1).max(5).nullable().optional().transform((x) => x ?? undefined);

/** Everything the page shows for one year. */
async function load(c: Tx, tenant: string, year: number) {
  const a = (await c.query(`SELECT *, threshold_impact::float8 AS threshold_impact, threshold_financial::float8 AS threshold_financial FROM esg_assessment WHERE year = $1`, [year])).rows[0] ?? null;
  const rows = a ? (await c.query(`SELECT topic, impact, financial, impact_score::float8 AS impact_score, financial_score::float8 AS financial_score, material, rationale FROM esg_topic WHERE assessment_id = $1`, [a.id])).rows : [];
  const ind = INDUSTRIES.find((i) => i.code === a?.industry);
  const nd = needs(a?.frameworks ?? []);
  // suppliers' own view of the topics (supplier portal, ESG impact section) for the year
  const sup = (await c.query(`SELECT s.name, r.answers->'esg' AS esg FROM supplier_request r JOIN supplier s ON s.id = r.supplier_id
                                WHERE r.year = $1 AND r.status IN ('submitted', 'accepted') AND jsonb_typeof(r.answers->'esg'->'topics') = 'array'`, [year])).rows as { name: string; esg: { topics?: { topic: string; impact?: number | null; financial?: number | null; note?: string | null }[] } }[];
  const topics = TOPICS.map((t) => {
    const r = rows.find((x) => x.topic === t.code);
    const iS = r?.impact_score ?? null, fS = r?.financial_score ?? null;
    const byScore = (nd.impact && iS != null && iS >= (a?.threshold_impact ?? 3)) || (nd.financial && fS != null && fS >= (a?.threshold_financial ?? 3)) || (!nd.impact && !nd.financial && ((iS ?? 0) >= (a?.threshold_impact ?? 3) || (fS ?? 0) >= (a?.threshold_financial ?? 3)));
    const sv = sup.flatMap((s) => (s.esg.topics ?? []).filter((x) => x.topic === t.code && x.impact != null).map((x) => ({ supplier: s.name, impact: Number(x.impact), financial: x.financial == null ? null : Number(x.financial), note: x.note ?? null })));
    return {
      ...t, likely: !!ind?.likely.includes(t.code), impact: r?.impact ?? null, financial: r?.financial ?? null, impactScore: iS, financialScore: fS,
      override: r?.material ?? null, material: r?.material ?? (r ? byScore : false), assessed: !!r && (iS != null || fS != null), rationale: r?.rationale ?? '',
      suppliers: { n: sv.length, avgImpact: sv.length ? sv.reduce((x, y) => x + y.impact, 0) / sv.length : null, high: sv.filter((x) => x.impact >= 4).map((x) => x.supplier), list: sv },
    };
  });
  const material = topics.filter((t) => t.material).map((t) => t.code);
  const Q = questionsFor(a?.industry ?? null, material.length ? material : (ind?.likely ?? []));
  const ans = (await c.query(`SELECT code, value, num::float8 AS num, note, updated_name, updated_at FROM esg_answer WHERE year = $1`, [year])).rows;
  const facs = (await c.query(`SELECT id FROM org_node WHERE kind = 'facility' AND active`)).rows.map((r) => r.id as string);
  const inv = await measured(c, tenant, year, facs);
  const auto: Record<string, number> = { s1: inv.s1, s2: inv.s2, s2m: inv.s2m, s3: inv.s3, total: inv.total };
  const questions = Q.map((q) => {
    const x = ans.find((y) => y.code === q.code);
    return { ...q, answer: x ?? null, autoValue: q.auto && auto[q.auto] ? Math.round(auto[q.auto]! * 10) / 10 : null };
  });
  return { assessment: a, needs: nd, topics, material, questions, suppliersAnswered: sup.length, answered: questions.filter((q) => q.answer || q.autoValue != null).length };
}

export async function esgRoutes(app: FastifyInstance) {
  app.get('/api/esg', async (req) => {
    const tenant = requireTenant(req);
    const { year } = yearQ.parse(req.query);
    return tenantTx(tenant, async (c) => {
      const d = await load(c, tenant, year);
      const me = req.user.id, a = d.assessment;
      return {
        year, ...d, catalogue: { frameworks: FRAMEWORKS, industries: INDUSTRIES, topics: TOPICS },
        years: (await c.query(`SELECT year FROM esg_assessment ORDER BY year DESC`)).rows.map((r) => r.year as number),
        can: { edit: canEdit(req), submit: canEdit(req) && a?.status === 'draft', decide: ['super_admin', 'admin'].includes(req.user.role) && a?.status === 'review' && a.sent_by !== me && a.updated_by !== me },
      };
    });
  });

  const reopenIfApproved = async (c: Tx, req: FastifyRequest, id: string) =>
    c.query(`UPDATE esg_assessment SET status = CASE WHEN status = 'approved' THEN 'draft' ELSE status END, updated_by = $2, updated_name = $3, updated_at = now() WHERE id = $1`, [id, req.user.id, req.user.name]);

  app.put('/api/esg/assessment', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = z.object({
      year: z.number().int().min(2015).max(2100), industry: z.enum(INDUSTRIES.map((i) => i.code) as [string, ...string[]]).nullable(),
      frameworks: z.array(z.enum(FRAMEWORKS.map((f) => f.code) as [string, ...string[]])).max(FRAMEWORKS.length),
      thresholdImpact: z.number().min(1).max(5).default(3), thresholdFinancial: z.number().min(1).max(5).default(3),
      valueChain: z.string().trim().max(4000).default(''), methodology: z.string().trim().max(8000).default(''),
      stakeholders: z.array(z.object({ group: z.string().trim().min(1).max(120), method: z.string().trim().max(200).default(''), when: z.string().trim().max(40).default(''), people: z.string().trim().max(40).default('') })).max(30).default([]),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const ex = (await c.query(`SELECT id, status FROM esg_assessment WHERE year = $1`, [b.year])).rows[0];
      if (ex?.status === 'review') throw new AppError('Waiting for approval: approve or return it first', 409);
      const id = ex ? ex.id : (await c.query(`INSERT INTO esg_assessment (tenant_id, year) VALUES ($1,$2) RETURNING id`, [tenant, b.year])).rows[0].id;
      await c.query(`UPDATE esg_assessment SET industry=$2, frameworks=$3, threshold_impact=$4, threshold_financial=$5, value_chain=$6, methodology=$7, stakeholders=$8 WHERE id = $1`,
        [id, b.industry, b.frameworks, b.thresholdImpact, b.thresholdFinancial, b.valueChain, b.methodology, JSON.stringify(b.stakeholders)]);
      await reopenIfApproved(c, req, id);
      await audit(c, req, ex ? 'esg.assessment.update' : 'esg.assessment.create', 'esg_assessment', id, b);
      return { id };
    });
  });

  app.put('/api/esg/topics/:topic', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const topic = z.enum(TOPICS.map((t) => t.code) as [string, ...string[]]).parse((req.params as { topic: string }).topic);
    const b = z.object({
      year: z.number().int().min(2015).max(2100),
      impact: z.object({ type: z.enum(['actual', 'potential']).optional(), nature: z.enum(['negative', 'positive']).optional(), scale: s15, scope: s15, irremediability: s15, likelihood: s15,
        humanRights: z.boolean().optional(), where: z.array(z.enum(['upstream', 'own', 'downstream'])).max(3).default([]), description: z.string().trim().max(2000).default('') }).nullable(),
      financial: z.object({ kind: z.enum(['risk', 'opportunity']).optional(), magnitude: s15, likelihood: s15, horizon: z.enum(['short', 'medium', 'long']).optional(), description: z.string().trim().max(2000).default('') }).nullable(),
      material: z.boolean().nullable().default(null), rationale: z.string().trim().max(4000).default(''),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const a = (await c.query(`SELECT id, status FROM esg_assessment WHERE year = $1`, [b.year])).rows[0];
      if (!a) throw new AppError('Set up the year first (industry and frameworks)');
      if (a.status === 'review') throw new AppError('Waiting for approval: approve or return it first', 409);
      if (b.material !== null && !b.rationale) throw new AppError('Give the reason when deciding materiality against the scores');
      const iS = impactScore(b.impact), fS = financialScore(b.financial);
      await c.query(`INSERT INTO esg_topic (tenant_id, assessment_id, topic, impact, financial, impact_score, financial_score, material, rationale) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                     ON CONFLICT (assessment_id, topic) DO UPDATE SET impact = EXCLUDED.impact, financial = EXCLUDED.financial, impact_score = EXCLUDED.impact_score, financial_score = EXCLUDED.financial_score,
                       material = EXCLUDED.material, rationale = EXCLUDED.rationale`,
        [tenant, a.id, topic, b.impact ? JSON.stringify(b.impact) : null, b.financial ? JSON.stringify(b.financial) : null, iS, fS, b.material, b.rationale]);
      await reopenIfApproved(c, req, a.id);
      await audit(c, req, 'esg.topic.assess', 'esg_assessment', a.id, { topic, ...b, impactScore: iS, financialScore: fS });
      return { impactScore: iS, financialScore: fS };
    });
  });

  app.post('/api/esg/assessment/submit', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const { year } = z.object({ year: z.number().int() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const d = await load(c, tenant, year);
      const a = d.assessment;
      if (!a) throw notFound('Assessment');
      if (a.status !== 'draft') throw new AppError('Only a draft can be sent for approval');
      const miss = [!a.industry && 'industry', !a.frameworks.length && 'frameworks', d.topics.some((t) => !t.assessed) && `assessment of every topic (${d.topics.filter((t) => !t.assessed).map((t) => t.code).join(', ')})`,
        !(a.stakeholders as unknown[]).length && 'stakeholders consulted'].filter(Boolean);
      if (miss.length) throw new AppError(`Complete first: ${miss.join('; ')}`);
      await c.query(`UPDATE esg_assessment SET status = 'review', sent_by = $2, sent_name = $3 WHERE id = $1`, [a.id, req.user.id, req.user.name]);
      const who = (await c.query(`SELECT id FROM app_user WHERE role IN ('super_admin', 'admin') AND NOT disabled AND id <> $1`, [req.user.id])).rows.map((x) => x.id as string);
      await notify(c, tenant, who, { kind: 'esg', title: `Double materiality ${year} to approve`, body: `${d.material.length} material topics · ${req.user.name}`, link: `/esg?year=${year}&tab=dma` });
      await audit(c, req, 'esg.assessment.submit', 'esg_assessment', a.id, { year, material: d.material });
      return { ok: true };
    });
  });
  app.post('/api/esg/assessment/decide', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    if (req.user.role === 'platform_admin') throw forbidden('The company approves its own materiality assessment');
    const b = z.object({ year: z.number().int(), decision: z.enum(['approve', 'return', 'reopen']), note: z.string().trim().max(2000).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const a = (await c.query(`SELECT * FROM esg_assessment WHERE year = $1 FOR UPDATE`, [b.year])).rows[0];
      if (!a) throw notFound('Assessment');
      if (b.decision === 'reopen') {
        if (a.status !== 'approved') throw new AppError('Only an approved assessment is reopened');
        await c.query(`UPDATE esg_assessment SET status = 'draft' WHERE id = $1`, [a.id]);
      } else {
        if (a.status !== 'review') throw new AppError('Not waiting for approval');
        if (a.sent_by === req.user.id || a.updated_by === req.user.id) throw forbidden('A second person approves: you prepared or sent this assessment');
        if (b.decision === 'return' && !b.note) throw new AppError('Say what needs to change');
        await c.query(`UPDATE esg_assessment SET status = $2, approved_by = $3, approved_name = $4, approved_at = $5, approval_note = $6 WHERE id = $1`,
          [a.id, b.decision === 'approve' ? 'approved' : 'draft', b.decision === 'approve' ? req.user.id : null, b.decision === 'approve' ? req.user.name : null, b.decision === 'approve' ? new Date() : null, b.note ?? null]);
        await notify(c, tenant, [a.sent_by], { kind: 'esg', title: b.decision === 'approve' ? `Double materiality ${b.year} approved` : `Double materiality ${b.year} returned`, body: b.note ?? req.user.name, link: `/esg?year=${b.year}&tab=dma` });
      }
      await audit(c, req, `esg.assessment.${b.decision}`, 'esg_assessment', a.id, b);
      return { ok: true };
    });
  });

  app.put('/api/esg/answers', async (req) => {
    const tenant = requireTenant(req); requireRole(req, ...EDIT);
    const b = z.object({ year: z.number().int().min(2015).max(2100), code: z.string().max(20), value: z.string().trim().max(4000).nullable(), note: z.string().trim().max(2000).default('') }).parse(req.body);
    const q = QUESTIONS.find((x) => x.code === b.code);
    if (!q) throw notFound('Question');
    let num: number | null = null;
    if (b.value && (q.type === 'number' || q.type === 'percent')) {
      num = Number(b.value.replace(/[\s,%]/g, ''));
      if (!Number.isFinite(num) || num < 0) throw new AppError('Enter a number');
      if (q.type === 'percent' && num > 100) throw new AppError('A percentage is at most 100');
    }
    if (b.value && q.type === 'yesno' && !['yes', 'no'].includes(b.value)) throw new AppError('Yes or no');
    return tenantTx(tenant, async (c) => {
      if (!b.value && !b.note) await c.query(`DELETE FROM esg_answer WHERE year = $1 AND code = $2`, [b.year, b.code]);
      else await c.query(`INSERT INTO esg_answer (tenant_id, year, code, value, num, note, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7)
                          ON CONFLICT (tenant_id, year, code) DO UPDATE SET value = EXCLUDED.value, num = EXCLUDED.num, note = EXCLUDED.note, updated_name = EXCLUDED.updated_name, updated_at = now()`,
        [tenant, b.year, b.code, b.value, num, b.note, req.user.name]);
      await audit(c, req, 'esg.answer', 'esg_answer', null, b);
      return { ok: true };
    });
  });

  app.get('/api/esg/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const { year } = yearQ.parse(req.query);
    const wb = await tenantTx(tenant, async (c) => {
      const d = await load(c, tenant, year);
      const a = d.assessment;
      if (!a) throw new AppError('Nothing assessed for this year yet');
      const co = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string;
      const fw = FRAMEWORKS.filter((f) => a.frameworks.includes(f.code));
      const wb = new ExcelJS.Workbook();
      wb.creator = PRODUCT;
      const s = wb.addWorksheet('Double materiality');
      s.columns = [{ width: 10 }, { width: 34 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 60 }];
      s.addRow([`${co} — double materiality assessment ${year}`]).font = { bold: true, size: 14 };
      s.addRow([`Industry: ${INDUSTRIES.find((i) => i.code === a.industry)?.name ?? '—'} · frameworks: ${fw.map((f) => f.name).join(', ')} · thresholds impact ${a.threshold_impact}, financial ${a.threshold_financial} (1–5) · status ${a.status}${a.approved_name ? ` (approved by ${a.approved_name})` : ''}`]).font = { italic: true };
      s.addRow([]);
      const h = s.addRow(['Topic', 'Name', 'Impact score', 'Financial score', 'Material', 'Suppliers (avg impact)', 'Reason / description']);
      h.font = { bold: true };
      for (const t of d.topics) s.addRow([t.code, t.name, t.impactScore ?? '—', t.financialScore ?? '—', t.material ? 'Yes' : 'No', t.suppliers.n ? `${t.suppliers.n} (${t.suppliers.avgImpact?.toFixed(1)})` : '—',
        [t.rationale, (t.impact as { description?: string } | null)?.description, (t.financial as { description?: string } | null)?.description].filter(Boolean).join(' · ')]);
      const iro = wb.addWorksheet('Impacts, risks, opportunities');
      iro.addRow(['Topic', 'Impact', 'Actual / potential', 'Negative / positive', 'Scale', 'Scope', 'Irremediability', 'Likelihood', 'Human rights', 'Value chain', 'Financial', 'Magnitude', 'Likelihood', 'Horizon', 'Description']);
      styleHeader(iro, [8, 10, 14, 14, 8, 8, 12, 10, 10, 22, 12, 10, 10, 10, 60]);
      for (const t of d.topics) {
        const i = (t.impact ?? {}) as Record<string, unknown>, f = (t.financial ?? {}) as Record<string, unknown>;
        iro.addRow([t.code, t.impactScore ?? '', i.type ?? '', i.nature ?? '', i.scale ?? '', i.scope ?? '', i.irremediability ?? '', i.likelihood ?? '', i.humanRights ? 'yes' : '', ((i.where as string[]) ?? []).join(', '), t.financialScore ?? '', f.magnitude ?? '', f.likelihood ?? '', f.horizon ?? '', [i.description, f.description].filter(Boolean).join(' / ')]);
      }
      const dat = wb.addWorksheet('ESG data');
      dat.addRow(['Code', 'Topic', 'Question', 'Value', 'Unit', 'Note', ...fw.map((f) => f.name)]);
      styleHeader(dat, [8, 8, 60, 16, 10, 40, ...fw.map(() => 18)]);
      for (const q of d.questions) dat.addRow([q.code, q.topic, q.text, q.answer?.value ?? (q.autoValue != null ? `${q.autoValue} (from the inventory)` : ''), q.unit ?? (q.type === 'percent' ? '%' : ''), q.answer?.note ?? '', ...fw.map((f) => q.refs[f.code] ?? '')]);
      const idx = wb.addWorksheet('Content index');
      idx.addRow(['Framework', 'Reference', 'Question', 'Value']);
      styleHeader(idx, [28, 22, 60, 20]);
      for (const f of fw) for (const q of d.questions.filter((x) => x.refs[f.code])) idx.addRow([f.name, q.refs[f.code], q.text, q.answer?.value ?? q.autoValue ?? 'not reported']);
      const m = wb.addWorksheet('Method & stakeholders');
      m.columns = [{ width: 30 }, { width: 90 }];
      m.addRow(['Value chain', a.value_chain]); m.addRow(['Methodology', a.methodology]);
      m.addRow(['Scoring', 'Impact severity = mean of scale, scope and irremediability (positive: scale and scope), 1–5; potential impacts × likelihood ÷ 5 except potential human-rights impacts (severity takes precedence); financial = magnitude × likelihood ÷ 5.']);
      for (const st of a.stakeholders as { group: string; method: string; when: string; people: string }[]) m.addRow([`Stakeholders: ${st.group}`, [st.method, st.when, st.people && `${st.people} people`].filter(Boolean).join(' · ')]);
      m.addRow(['Suppliers answering', d.suppliersAnswered]);
      await audit(c, req, 'esg.export', 'esg_assessment', a.id, { year });
      return wb;
    });
    return sendWorkbook(reply, wb, `ESG ${year} - double materiality and data.xlsx`);
  });
}
