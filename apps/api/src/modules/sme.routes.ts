/**
 * EKOTRACE SME — the SME's own screens (package 'sme').
 *
 *   GET  /api/sme/data?fy=              module documents, calculated results and what the screens need from the settings
 *   PUT  /api/sme/data/:module?fy=      save one module (optimistic version check), returns fresh results
 *   PUT  /api/sme/company               name, sector, industry, state, Udyam number
 *   POST /api/sme/answer                answer a buyer's questionnaire from stored data
 *   POST /api/sme/scan                  read a bill PDF (text or OCR) → values to confirm; nothing is saved
 *   scrap, grievances, partner links (consent), CA validation requests, credit-pool projects
 *
 * Super admins and admins change everything; managers and data preparers enter data; verifiers read.
 * Every change is written to the audit log.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { needProduct } from '../lib/products.js';
import { pdfText } from '../lib/pdfText.js';
import { ocrEnabled, ocrPdf } from '../lib/ocr.js';
import { readBill } from '../lib/billRead.js';
import * as E from '../lib/sme/engine.js';
import { cfg } from '../lib/sme/settings.js';
import { MODULES, STATES, compute, ensureCompany, fyOf, isFy, load, uiConfig, years } from '../lib/sme/company.js';
import { readIndianBill } from '../lib/sme/bill.js';

const fyParam = (req: FastifyRequest) => {
  const fy = (req.query as { fy?: string }).fy ?? fyOf();
  if (!isFy(fy)) throw new AppError('Choose a financial year like "FY 2025-26"');
  return fy;
};
const canEnter = (req: FastifyRequest) => requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
const canManage = (req: FastifyRequest) => requireRole(req, 'super_admin', 'admin');

export async function smeRoutes(app: FastifyInstance) {
  needProduct(app, 'sme');

  // ------------------------------------------------------------------ data --
  app.get('/api/sme/data', async (req) => {
    const t = requireTenant(req), fy = fyParam(req);
    return tenantTx(t, async (c) => {
      const out = await compute(c, t, fy);
      return { fy, years: await years(c, t), company: pick(out.company), data: out.d, meta: out.meta, results: out.results, config: uiConfig(out.cfg),
        canEdit: ['platform_admin', 'super_admin', 'admin', 'manager', 'preparer'].includes(req.user.role), canManage: ['platform_admin', 'super_admin', 'admin'].includes(req.user.role) };
    });
  });

  app.put('/api/sme/data/:module', async (req) => {
    canEnter(req);
    const t = requireTenant(req), fy = fyParam(req);
    const mod = (req.params as { module: string }).module;
    if (!(MODULES as readonly string[]).includes(mod)) throw notFound('Module');
    // certifications are a list; every other module is one object
    const b = z.object({ data: mod === 'certs' ? z.array(z.record(z.string(), z.any())).max(60) : z.record(z.string(), z.any()), version: z.number().int().optional() }).parse(req.body);
    if (JSON.stringify(b.data).length > 95_000) throw new AppError('That is too much data for one save.', 413, 'TOO_LARGE');
    return tenantTx(t, async (c) => {
      const before = (await c.query(`SELECT data, version FROM sme_doc WHERE tenant_id = $1 AND fy = $2 AND module = $3`, [t, fy, mod])).rows[0];
      if (before && b.version !== undefined && b.version !== before.version) throw new AppError('Someone else changed this page. Reload to see their changes.', 409, 'STALE');
      // joining the anonymous benchmark is a consent: only the owner (super admin) may change it
      if (mod === 'share' && !!(b.data as any).bench !== !!before?.data?.bench && !['super_admin', 'platform_admin'].includes(req.user.role)) {
        throw new AppError('Only the owner (super admin) can change consent to the benchmark.', 403, 'FORBIDDEN');
      }
      const v = (await c.query(`INSERT INTO sme_doc (tenant_id, fy, module, data, updated_name) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (tenant_id, fy, module) DO UPDATE SET data = EXCLUDED.data, version = sme_doc.version + 1, updated_name = EXCLUDED.updated_name, updated_at = now() RETURNING version`,
        [t, fy, mod, JSON.stringify(b.data), req.user.name])).rows[0].version;
      await audit(c, req, 'sme.data.save', 'sme_doc', `${fy}/${mod}`, { before: before?.data ?? null, after: b.data });
      const out = await compute(c, t, fy);
      return { version: v, results: out.results };
    });
  });

  app.put('/api/sme/company', async (req) => {
    canManage(req);
    const t = requireTenant(req);
    const b = z.object({
      name: z.string().trim().min(2).max(160).optional(), sector: z.enum(['mfg', 'svc']).optional(), industry: z.string().trim().max(160).optional(),
      state: z.enum(STATES as [string, ...string[]]).optional(), udyamNo: z.string().trim().max(40).nullable().optional(),
    }).parse(req.body);
    return tenantTx(t, async (c) => {
      const before = await ensureCompany(c, t);
      if (b.name) await c.query(`UPDATE tenant SET name = $2 WHERE id = $1`, [t, b.name]);
      await c.query(`UPDATE sme_company SET sector = COALESCE($2, sector), industry = COALESCE($3, industry), state = COALESCE($4, state), udyam_no = CASE WHEN $5 THEN $6 ELSE udyam_no END WHERE tenant_id = $1`,
        [t, b.sector ?? null, b.industry ?? null, b.state ?? null, b.udyamNo !== undefined, b.udyamNo ?? null]);
      await audit(c, req, 'sme.company.update', 'sme_company', t, { before: pick(before), after: b });
      return { company: pick(await ensureCompany(c, t)) };
    });
  });

  app.post('/api/sme/answer', async (req) => {
    const t = requireTenant(req), fy = fyParam(req);
    const b = z.object({ questions: z.array(z.string().max(500)).max(200) }).parse(req.body);
    const config = await cfg();
    return tenantTx(t, async (c) => {
      const { d } = await load(c, t, fy);
      return { answers: b.questions.map((q) => q.trim()).filter(Boolean).map((q) => ({ question: q, ...E.answer(d, config, q) })) };
    });
  });

  // A bill as a PDF (a DISCOM download or a phone-scanner PDF): text, or OCR when it is a scan. Values come back for the person to check.
  app.post('/api/sme/scan', { bodyLimit: 15 * 1024 * 1024 }, async (req) => {
    canEnter(req);
    requireTenant(req);
    const type = (req.query as { type?: string }).type;
    if (!['electricity', 'diesel', 'lpg'].includes(type ?? '')) throw new AppError('Choose electricity, diesel or LPG.');
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('Upload the bill as a PDF. Most phone scanner apps can save a photo as a PDF.');
    let text = '', ocr = false;
    try { const p = await pdfText(new Uint8Array(buf)); text = p.text; ocr = p.scanned; } catch { throw new AppError('This PDF could not be read. Try another copy of the bill.'); }
    if (ocr) {
      if (!ocrEnabled()) throw new AppError('This bill is a scan and reading scans is switched off on this server. Type the numbers in instead.', 503, 'OCR_OFF');
      const o = await ocrPdf(new Uint8Array(buf));
      text = o.text;
    }
    const general = readBill(text, type === 'electricity' ? 'electricity' : 'fuel');
    const fields = readIndianBill(text, type as 'electricity' | 'diesel' | 'lpg', general);
    return { fields, scanned: ocr, missing: Object.entries(fields).filter(([, v]) => v.value === null).map(([k]) => k) };
  });

  // ------------------------------------------------------------------ scrap market --
  app.get('/api/sme/scrap', async (req) => {
    const t = requireTenant(req);
    return tenantTx(t, async (c) => {
      const co = await ensureCompany(c, t);
      const listings = (await c.query(`SELECT id, item, qty, unit, price, hazardous, status, admin_note, created_at, updated_at FROM sme_scrap WHERE tenant_id = $1 AND status <> 'withdrawn' ORDER BY created_at`, [t])).rows;
      return { listings, state: co.state };
    });
  });
  const scrapBody = z.object({ item: z.string().trim().min(2).max(200), qty: z.number().min(0).max(1e7), unit: z.enum(['t', 'kg', 'kL', 'L', 'nos']), price: z.number().min(0).max(1e7), hazardous: z.boolean().default(false) });
  app.post('/api/sme/scrap', async (req) => {
    canEnter(req);
    const t = requireTenant(req), b = scrapBody.parse(req.body);
    return tenantTx(t, async (c) => {
      const r = (await c.query(`INSERT INTO sme_scrap (tenant_id, item, qty, unit, price, hazardous) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [t, b.item, b.qty, b.unit, b.price, b.hazardous])).rows[0];
      await audit(c, req, 'sme.scrap.add', 'sme_scrap', r.id, b);
      return { id: r.id };
    });
  });
  app.patch('/api/sme/scrap/:id', async (req) => {
    canEnter(req);
    const t = requireTenant(req), id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ qty: z.number().min(0).max(1e7).optional(), price: z.number().min(0).max(1e7).optional(), status: z.enum(['draft', 'listed', 'sold', 'withdrawn']).optional() }).parse(req.body);
    return tenantTx(t, async (c) => {
      const row = (await c.query(`SELECT * FROM sme_scrap WHERE id = $1`, [id])).rows[0];
      if (!row) throw notFound('Listing');
      if (row.status === 'blocked') throw new AppError('This listing was paused by the EKOTRACE team. Contact support.', 403, 'BLOCKED');
      await c.query(`UPDATE sme_scrap SET qty = COALESCE($2, qty), price = COALESCE($3, price), status = COALESCE($4, status), updated_at = now() WHERE id = $1`, [id, b.qty ?? null, b.price ?? null, b.status ?? null]);
      await audit(c, req, 'sme.scrap.update', 'sme_scrap', id, { before: { qty: row.qty, price: row.price, status: row.status }, after: b });
      return { ok: true };
    });
  });
  app.get('/api/sme/recyclers', async (req) => {
    const t = requireTenant(req);
    const config = await cfg();
    const st = await tenantTx(t, async (c) => (await ensureCompany(c, t)).state);
    const list = ((config.recyclers?.items ?? []) as any[]).filter((r) => r.active !== false);
    return { recyclers: list.sort((a, b) => Number(b.state === st) - Number(a.state === st)).slice(0, 30) };
  });

  // ------------------------------------------------------------------ worker grievances --
  app.get('/api/sme/grievances', async (req) => {
    const t = requireTenant(req);
    return tenantTx(t, async (c) => {
      const co = await ensureCompany(c, t);
      const items = (await c.query(`SELECT id, category, text, language, status, created_at, resolved_at FROM sme_grievance WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 300`, [t])).rows;
      return { token: co.grievance_token, items };
    });
  });
  app.patch('/api/sme/grievances/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager');
    const t = requireTenant(req), id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ status: z.enum(['open', 'resolved']) }).parse(req.body);
    return tenantTx(t, async (c) => {
      const r = await c.query(`UPDATE sme_grievance SET status = $2, resolved_at = CASE WHEN $2 = 'resolved' THEN now() END WHERE id = $1`, [id, b.status]);
      if (!r.rowCount) throw notFound('Grievance');
      await audit(c, req, 'sme.grievance.status', 'sme_grievance', id, b);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ partners and consent --
  app.get('/api/sme/links', async (req) => {
    const t = requireTenant(req);
    // the partner's name and kind live in its own (isolated) rows: read across companies, limited to this SME's links
    return platformTx(async (c) => ({
      links: (await c.query(`SELECT l.id, l.share, l.consent_at, l.revoked_at, l.purchase_share_pct, l.loan_cr, l.created_at, p.kind, p.city, pt.name
                               FROM sme_link l LEFT JOIN sme_partner p ON p.tenant_id = l.partner_tenant JOIN tenant pt ON pt.id = l.partner_tenant
                              WHERE l.sme_tenant = $1 ORDER BY p.kind, pt.name`, [t])).rows,
    }));
  });
  app.put('/api/sme/links/:id', async (req) => {
    requireRole(req, 'super_admin');
    const t = requireTenant(req), id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ share: z.boolean() }).parse(req.body);
    return tenantTx(t, async (c) => {
      const r = await c.query(`UPDATE sme_link SET share = $2, consent_at = CASE WHEN $2 THEN now() ELSE consent_at END, revoked_at = CASE WHEN $2 THEN NULL ELSE now() END
                                WHERE id = $1 AND sme_tenant = $3`, [id, b.share, t]);
      if (!r.rowCount) throw notFound('Partner');
      await audit(c, req, b.share ? 'sme.consent.given' : 'sme.consent.revoked', 'sme_link', id);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ CA validation --
  app.get('/api/sme/ca-requests', async (req) => {
    const t = requireTenant(req);
    return platformTx(async (c) => ({
      items: (await c.query(`SELECT r.id, r.fy, r.srmm_version, r.self_pct, r.status, r.validated_pct, r.validated_level, r.publish_on_icai, r.notes, r.reviewer_name, r.created_at, r.updated_at, ct.name AS ca_firm
                               FROM sme_ca_request r LEFT JOIN tenant ct ON ct.id = r.ca_tenant WHERE r.sme_tenant = $1 ORDER BY r.created_at DESC`, [t])).rows,
    }));
  });
  app.post('/api/sme/ca-requests', async (req) => {
    requireRole(req, 'super_admin');
    const t = requireTenant(req), fy = fyParam(req);
    const b = z.object({ publish: z.boolean().default(false) }).parse(req.body ?? {});
    return tenantTx(t, async (c) => {
      if ((await c.query(`SELECT 1 FROM sme_ca_request WHERE sme_tenant = $1 AND fy = $2 AND status IN ('requested', 'assigned', 'in_review')`, [t, fy])).rowCount) {
        throw new AppError('A validation request for this year is already open.', 409, 'DUPLICATE');
      }
      const out = await compute(c, t, fy);
      if (!out.results.srmm.eligible) throw new AppError('The SRMM self-assessment is not yet eligible for a level: each section needs at least 30% and the total above 30%.', 400, 'NOT_ELIGIBLE');
      const r = (await c.query(`INSERT INTO sme_ca_request (sme_tenant, fy, srmm_version, self_pct, publish_on_icai) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [t, fy, out.results.srmm.version, out.results.srmm.pct * 100, b.publish])).rows[0];
      await audit(c, req, 'sme.ca.request', 'sme_ca_request', r.id, { fy });
      return { id: r.id };
    });
  });

  // ------------------------------------------------------------------ carbon credit pool --
  app.get('/api/sme/credit-projects', async (req) => {
    const t = requireTenant(req);
    return tenantTx(t, async (c) => ({ items: (await c.query(`SELECT * FROM sme_credit WHERE tenant_id = $1 ORDER BY created_at DESC`, [t])).rows }));
  });
  app.post('/api/sme/credit-projects', async (req) => {
    canManage(req);
    const t = requireTenant(req);
    const b = z.object({ type: z.enum(['solar', 'efficiency', 'fuel_switch']), capacityKw: z.number().min(0).max(1e5).nullable().optional(), kwhPerYear: z.number().min(0).max(1e9).nullable().optional(), litresPerYear: z.number().min(0).max(1e8).nullable().optional() }).parse(req.body);
    const config = await cfg();
    // solar and efficiency save grid electricity; a fuel switch saves the diesel no longer burned
    const kwh = b.type === 'solar' ? (b.capacityKw ?? 0) * (config.solar.default?.yieldKwp ?? 1450) : b.type === 'efficiency' ? b.kwhPerYear ?? 0 : null;
    if (b.type === 'fuel_switch' && !(b.litresPerYear! > 0)) throw new AppError('Enter the diesel no longer burned, in litres a year.');
    const tco2e = b.type === 'fuel_switch' ? (b.litresPerYear! * config.factors.items.diesel.factor) / 1000 : ((kwh ?? 0) * config.factors.items.grid.factor) / 1000;
    return tenantTx(t, async (c) => {
      const r = (await c.query(`INSERT INTO sme_credit (tenant_id, type, capacity_kw, kwh_per_year, tco2e_per_year, created_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [t, b.type, b.capacityKw ?? null, kwh, tco2e, req.user.name])).rows[0];
      await audit(c, req, 'sme.credit.add', 'sme_credit', r.id, { ...b, kwh, tco2e });
      return { id: r.id, tco2ePerYear: tco2e };
    });
  });
}

/** The SME's company row as the screens see it (no token). */
function pick(c: any) {
  return c ? { id: c.tenant_id, name: c.name, sector: c.sector, industry: c.industry, state: c.state, udyamNo: c.udyam_no, isExample: c.is_example } : null;
}
