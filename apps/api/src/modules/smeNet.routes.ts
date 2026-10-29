/**
 * SME network (package 'smenet'): a listed buyer, an industry cluster, a bank or a CA firm.
 *
 * A partner sees an SME's figures only while that SME has switched sharing on (sme_link.share).
 * A cluster sees aggregates only, hidden until MIN_GROUP members share, so no single SME can be
 * singled out. A CA firm sees the requests the Ekobon team assigned to it, and records the result.
 *
 *   GET   /api/sme-net/overview?fy=        buyer: suppliers · cluster: aggregates · bank: financed emissions (PCAF)
 *   POST  /api/sme-net/links               invite an SME by its owner's e-mail (creates the SME if new)
 *   PATCH /api/sme-net/links/:id           purchase share, loan, equity + debt
 *   POST  /api/sme-net/links/:id/remind    remind an SME that has not shared yet
 *   GET   /api/sme-net/ca · /ca/:id · PATCH /ca/:id   CA firms: validation requests
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { needProduct } from '../lib/products.js';
import { hashPassword, temporaryPassword } from '../lib/password.js';
import { appLink, mailOn, queueEmail } from '../lib/mail.js';
import { levelFor } from '../lib/sme/engine.js';
import { compute, fyOf, isFy, uiConfig } from '../lib/sme/company.js';

export const MIN_GROUP = 5;
const fyParam = (req: FastifyRequest) => {
  const fy = (req.query as { fy?: string }).fy ?? fyOf();
  if (!isFy(fy)) throw new AppError('Choose a financial year like "FY 2025-26"');
  return fy;
};
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const pct = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]!; };

async function partnerKind(tenant: string): Promise<'buyer' | 'cluster' | 'bank' | 'ca_firm'> {
  const k = await tenantTx(tenant, async (c) => (await c.query(`SELECT kind FROM sme_partner WHERE tenant_id = $1`, [tenant])).rows[0]?.kind);
  if (!k) throw new AppError('This company is not set up as an SME network partner yet. The Ekobon team sets the kind (buyer, cluster, bank or CA firm) in the platform console.', 403, 'NO_PARTNER_KIND');
  return k;
}

export async function smeNetRoutes(app: FastifyInstance) {
  needProduct(app, 'smenet');

  app.get('/api/sme-net/overview', async (req) => {
    const t = requireTenant(req), fy = fyParam(req), kind = await partnerKind(t);
    const me = await tenantTx(t, async (c) => (await c.query(`SELECT t.name, p.kind, p.city FROM tenant t JOIN sme_partner p ON p.tenant_id = t.id WHERE t.id = $1`, [t])).rows[0]);
    // Partner reads go through platformTx: the link (and its consent) is checked in every query.
    return platformTx(async (c) => {
      if (kind === 'buyer') {
        const rows = (await c.query(`SELECT l.id AS link_id, l.share, l.purchase_share_pct, l.reminded_at, st.name, s.industry, s.state,
              r.scope1, r.scope2, r.scope3, r.esg_level, r.srmm_pct, r.srmm_level, r.cbam_see,
              (SELECT q.status FROM sme_ca_request q WHERE q.sme_tenant = l.sme_tenant AND q.fy = $2 ORDER BY q.created_at DESC LIMIT 1) AS ca_status
            FROM sme_link l JOIN tenant st ON st.id = l.sme_tenant LEFT JOIN sme_company s ON s.tenant_id = l.sme_tenant
            LEFT JOIN sme_result r ON r.tenant_id = l.sme_tenant AND r.fy = $2 WHERE l.partner_tenant = $1 ORDER BY l.purchase_share_pct DESC NULLS LAST, st.name`, [t, fy])).rows;
        const suppliers = rows.map((r: any) => r.share ? {
          linkId: r.link_id, name: r.name, industry: r.industry, state: r.state, purchaseSharePct: r.purchase_share_pct, shared: true,
          status: r.ca_status === 'validated' ? 'validated' : r.scope1 !== null ? 'responded' : 'no_data',
          scope12: r.scope1 !== null ? Number(r.scope1) + Number(r.scope2) : null, scope3: r.scope3, esgLevel: r.esg_level, srmmPct: r.srmm_pct, srmmLevel: r.srmm_level, cbamSee: r.cbam_see,
        } : { linkId: r.link_id, name: r.name, industry: r.industry, state: r.state, purchaseSharePct: r.purchase_share_pct, shared: false, status: r.reminded_at ? 'reminded' : 'pending' });
        const total = suppliers.reduce((a, s) => a + Number(s.purchaseSharePct ?? 0), 0) || 1;
        const resp = suppliers.filter((s: any) => s.scope12 != null);
        return { kind, partner: me, fy, suppliers, summary: { partners: suppliers.length, coveragePct: (resp.reduce((a, s) => a + Number(s.purchaseSharePct ?? 0), 0) / total) * 100, reportedScope12: resp.reduce((a: number, s: any) => a + s.scope12, 0) } };
      }
      if (kind === 'cluster') {
        const members = Number((await c.query(`SELECT count(*) AS n FROM sme_link WHERE partner_tenant = $1`, [t])).rows[0].n);
        const rows = (await c.query(`SELECT r.* FROM sme_link l JOIN sme_result r ON r.tenant_id = l.sme_tenant AND r.fy = $2 WHERE l.partner_tenant = $1 AND l.share AND r.bench_consent`, [t, fy])).rows;
        const base = { kind, partner: me, fy, members, sharing: rows.length, minGroup: MIN_GROUP };
        if (rows.length < MIN_GROUP) return { ...base, hidden: true };
        const ints = rows.map((r: any) => Number(r.intensity)).filter((v) => v > 0);
        const edges = [0, 5, 10, 15, 20, 30, 45, 60, Infinity], labels = ['<5', '5–10', '10–15', '15–20', '20–30', '30–45', '45–60', '>60'];
        const histogram = labels.map((label, i) => ({ label, count: ints.filter((v) => v >= edges[i]! && v < edges[i + 1]!).length }));
        const src: Record<string, number> = {}; let all = 0;
        for (const r of rows) { const tot = Number(r.scope1) + Number(r.scope2); for (const s of (r.sources ?? []) as { key: string; share: number }[]) { src[s.key] = (src[s.key] ?? 0) + s.share * tot; all += s.share * tot; } }
        return { ...base, hidden: false, medianIntensity: median(ints), p25: pct(ints, 0.25), p75: pct(ints, 0.75), histogram,
          hotspots: Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, v]) => ({ key, share: all ? v / all : 0 })),
          level2plusPct: (rows.filter((r: any) => r.esg_level >= 2).length / rows.length) * 100, savingsFoundInr: rows.reduce((a: number, r: any) => a + Number(r.savings_inr), 0),
          solarKw: rows.reduce((a: number, r: any) => a + Number(r.solar_kw), 0), pfFlagged: rows.filter((r: any) => r.pf_flagged).length };
      }
      if (kind === 'bank') {
        const rows = (await c.query(`SELECT l.id AS link_id, l.share, l.loan_cr, l.ev_cr, st.name, s.industry, r.scope1, r.scope2, r.solar_kw,
              (SELECT q.status FROM sme_ca_request q WHERE q.sme_tenant = l.sme_tenant AND q.fy = $2 ORDER BY q.created_at DESC LIMIT 1) AS ca_status
            FROM sme_link l JOIN tenant st ON st.id = l.sme_tenant LEFT JOIN sme_company s ON s.tenant_id = l.sme_tenant
            LEFT JOIN sme_result r ON r.tenant_id = l.sme_tenant AND r.fy = $2 WHERE l.partner_tenant = $1 ORDER BY l.loan_cr DESC NULLS LAST, st.name`, [t, fy])).rows;
        const borrowers = rows.map((r: any) => {
          const loan = Number(r.loan_cr ?? 0), ev = Number(r.ev_cr ?? 0);
          if (!r.share || r.scope1 === null) return { linkId: r.link_id, name: r.name, industry: r.industry, loanCr: loan, evCr: ev, status: r.share ? 'no_data' : 'awaiting_consent' };
          const em = Number(r.scope1) + Number(r.scope2), att = ev > 0 ? Math.min(1, loan / ev) : 0;
          // PCAF data quality: 1 verified (CA-validated), 2 reported but not verified
          return { linkId: r.link_id, name: r.name, industry: r.industry, loanCr: loan, evCr: ev, attribution: att, scope12: em, financed: att * em, pcaf: r.ca_status === 'validated' ? 1 : 2, solarReady: Number(r.solar_kw) > 0, status: 'reported' };
        });
        const rep = borrowers.filter((b: any) => b.financed !== undefined) as any[];
        const loanRep = rep.reduce((a, b) => a + b.loanCr, 0);
        return { kind, partner: me, fy, borrowers, summary: { financed: rep.reduce((a, b) => a + b.financed, 0), loansCovered: loanRep, loansTotal: borrowers.reduce((a: number, b: any) => a + b.loanCr, 0),
          pcafWeighted: loanRep ? rep.reduce((a, b) => a + b.pcaf * b.loanCr, 0) / loanRep : null, greenLeads: rep.filter((b) => b.solarReady).length } };
      }
      // CA firm: the requests assigned to it
      const items = (await c.query(`SELECT q.id, q.fy, q.srmm_version, q.self_pct, q.status, q.validated_pct, q.validated_level, q.updated_at, st.name AS company, s.sector, s.state
                                      FROM sme_ca_request q JOIN tenant st ON st.id = q.sme_tenant LEFT JOIN sme_company s ON s.tenant_id = q.sme_tenant
                                     WHERE q.ca_tenant = $1 ORDER BY q.updated_at DESC`, [t])).rows;
      return { kind, partner: me, fy, requests: items };
    });
  });

  // Invite an SME by its owner's e-mail. A new SME gets a company with the 'sme' package and a temporary password (shown once, and e-mailed when mail is set up).
  app.post('/api/sme-net/links', async (req) => {
    requireRole(req, 'super_admin', 'admin');
    const t = requireTenant(req), kind = await partnerKind(t);
    if (kind === 'ca_firm') throw forbidden('CA firms receive requests from the Ekobon team.');
    const b = z.object({
      email: z.string().trim().toLowerCase().email().max(190), company: z.string().trim().min(2).max(160).optional(), name: z.string().trim().min(2).max(120).optional(),
      purchaseSharePct: z.number().min(0).max(100).nullable().optional(), loanCr: z.number().min(0).max(1e6).nullable().optional(), evCr: z.number().min(0).max(1e7).nullable().optional(),
    }).parse(req.body);
    return platformTx(async (c) => {
      let sme = (await c.query(`SELECT u.tenant_id FROM app_user u JOIN tenant t ON t.id = u.tenant_id WHERE lower(u.email) = $1 AND 'sme' = ANY(t.products) AND NOT u.disabled`, [b.email])).rows[0]?.tenant_id as string | undefined;
      let temporary: string | null = null;
      if (!sme) {
        if ((await c.query(`SELECT 1 FROM app_user WHERE lower(email) = $1`, [b.email])).rowCount) throw new AppError('This e-mail belongs to a company that does not use EKOTRACE SME. Ask the Ekobon team to add the SME package to it.', 409, 'NOT_SME');
        if (!b.company) throw new AppError('This e-mail is not on EKOTRACE SME yet. Add the company name to invite them.', 400, 'NEED_COMPANY');
        temporary = temporaryPassword();
        const nt = (await c.query(`INSERT INTO tenant (name, country, gwp_set, plan, access_expiry, currency, timezone, products) VALUES ($1,'IN','AR5','trial',(current_date + interval '1 year')::date,'INR','Asia/Kolkata','{sme}') RETURNING id`, [b.company])).rows[0];
        await c.query(`INSERT INTO org_node (tenant_id, kind, name, country) VALUES ($1,'group',$2,'IN')`, [nt.id, b.company]);
        await c.query(`INSERT INTO sme_company (tenant_id) VALUES ($1)`, [nt.id]);
        await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash) VALUES ($1,$2,$3,'super_admin',$4)`, [nt.id, b.email, b.name ?? b.email, await hashPassword(temporary)]);
        sme = nt.id as string;
        if (mailOn()) {
          const link = appLink('/sme') ?? '/sme';
          await queueEmail(c, null, b.email, 'EKOTRACE SME: your account', `Hello,\n\n${(req.user.name)} has invited ${b.company} to EKOTRACE SME, to share sustainability data.\n\nSign in at ${link} with this e-mail and the temporary password: ${temporary}\nYou will be asked to choose your own password.\n`);
        }
      }
      await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, purchase_share_pct, loan_cr, ev_cr) VALUES ($1,$2,$3,$4,$5)
                     ON CONFLICT (partner_tenant, sme_tenant) DO UPDATE SET purchase_share_pct = COALESCE(EXCLUDED.purchase_share_pct, sme_link.purchase_share_pct), loan_cr = COALESCE(EXCLUDED.loan_cr, sme_link.loan_cr), ev_cr = COALESCE(EXCLUDED.ev_cr, sme_link.ev_cr)`,
        [t, sme, b.purchaseSharePct ?? null, b.loanCr ?? null, b.evCr ?? null]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'sme.net.invite','tenant',$4,$5,$6)`,
        [t, req.user.id, req.user.name, sme, JSON.stringify({ email: b.email, newCompany: !!temporary }), req.ip]);
      return { ok: true, newCompany: !!temporary, temporaryPassword: temporary, emailed: !!temporary && mailOn() };
    });
  });

  app.patch('/api/sme-net/links/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager');
    const t = requireTenant(req), id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ purchaseSharePct: z.number().min(0).max(100).nullable().optional(), loanCr: z.number().min(0).max(1e6).nullable().optional(), evCr: z.number().min(0).max(1e7).nullable().optional() }).parse(req.body);
    return tenantTx(t, async (c) => {
      const r = await c.query(`UPDATE sme_link SET purchase_share_pct = CASE WHEN $3 THEN $4 ELSE purchase_share_pct END, loan_cr = CASE WHEN $5 THEN $6 ELSE loan_cr END, ev_cr = CASE WHEN $7 THEN $8 ELSE ev_cr END
                                WHERE id = $1 AND partner_tenant = $2`, [id, t, b.purchaseSharePct !== undefined, b.purchaseSharePct ?? null, b.loanCr !== undefined, b.loanCr ?? null, b.evCr !== undefined, b.evCr ?? null]);
      if (!r.rowCount) throw notFound('Link');
      await audit(c, req, 'sme.net.link.update', 'sme_link', id, b);
      return { ok: true };
    });
  });

  app.post('/api/sme-net/links/:id/remind', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager');
    const t = requireTenant(req), id = z.string().uuid().parse((req.params as { id: string }).id);
    return platformTx(async (c) => {
      const l = (await c.query(`SELECT l.*, pt.name AS partner FROM sme_link l JOIN tenant pt ON pt.id = l.partner_tenant WHERE l.id = $1 AND l.partner_tenant = $2`, [id, t])).rows[0];
      if (!l) throw notFound('Link');
      if (l.share) throw new AppError('This SME already shares its data.', 409, 'ALREADY_SHARED');
      if (l.reminded_at && Date.now() - new Date(l.reminded_at).getTime() < 3 * 86400e3) throw new AppError('A reminder was sent in the last 3 days.', 429, 'TOO_SOON');
      await c.query(`UPDATE sme_link SET reminded_at = now() WHERE id = $1`, [id]);
      const owners = (await c.query(`SELECT email FROM app_user WHERE tenant_id = $1 AND role = 'super_admin' AND NOT disabled`, [l.sme_tenant])).rows;
      for (const o of owners) await queueEmail(c, l.sme_tenant, o.email, `EKOTRACE SME: ${l.partner} asks for your data`, `${l.partner} asks you to share your sustainability summary. Sign in to EKOTRACE SME and switch sharing on in Share & validate: ${appLink('/sme') ?? '/sme'}\n`);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, ip) VALUES ($1::uuid,$2,$3,'sme.net.remind','sme_link',$4,$5)`, [t, req.user.id, req.user.name, id, req.ip]);
      return { ok: true, emailed: mailOn() && owners.length > 0 };
    });
  });

  // ------------------------------------------------------------------ CA firms --
  async function caRequest(t: string, id: string) {
    const r = await platformTx(async (c) => (await c.query(`SELECT * FROM sme_ca_request WHERE id = $1 AND ca_tenant = $2`, [id, t])).rows[0]);
    if (!r) throw notFound('Request');
    return r;
  }
  app.get('/api/sme-net/ca/:id', async (req) => {
    const t = requireTenant(req);
    if ((await partnerKind(t)) !== 'ca_firm') throw forbidden();
    const r = await caRequest(t, z.string().uuid().parse((req.params as { id: string }).id));
    // the CA reads the SME's data for the assigned year only
    const out = await tenantTx(r.sme_tenant, (c) => compute(c, r.sme_tenant, r.fy));
    return { request: r, company: { name: out.company.name, sector: out.company.sector, industry: out.company.industry, state: out.company.state }, data: { srmm: out.d.srmm, esg: out.d.esg, certs: out.d.certs }, results: out.results, config: { srmm: uiConfig(out.cfg).srmm } };
  });
  app.patch('/api/sme-net/ca/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager');
    const t = requireTenant(req);
    if ((await partnerKind(t)) !== 'ca_firm') throw forbidden();
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const r = await caRequest(t, id);
    if (['validated', 'rejected'].includes(r.status)) throw new AppError('This request is closed.', 409, 'CLOSED');
    const b = z.object({ status: z.enum(['in_review', 'validated', 'rejected']), validatedPct: z.number().min(0).max(100).optional(), allSections30: z.boolean().default(true), notes: z.string().max(4000).optional() }).parse(req.body);
    let pctV: number | null = null, level: number | null = null;
    if (b.status === 'validated') {
      if (b.validatedPct === undefined) throw new AppError('Enter the validated score in %.');
      pctV = b.validatedPct; level = levelFor(b.validatedPct / 100, b.allSections30);
    }
    await platformTx(async (c) => {
      await c.query(`UPDATE sme_ca_request SET status = $2, validated_pct = $3, validated_level = $4, notes = COALESCE($5, notes), reviewer_name = $6, updated_at = now() WHERE id = $1`, [id, b.status, pctV, level, b.notes ?? null, req.user.name]);
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1::uuid,$2,$3,'sme.ca.review','sme_ca_request',$4,$5,$6)`,
        [t, req.user.id, req.user.name, id, JSON.stringify({ status: b.status, pct: pctV, level }), req.ip]);
    });
    return { ok: true, validatedLevel: level };
  });
}
