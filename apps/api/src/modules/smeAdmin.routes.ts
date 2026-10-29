/**
 * EKOTRACE SME in the platform console (platform admins only).
 *
 *   GET  /api/platform/sme/overview                 counts, sign-ups by month, CA queue, revenue
 *   GET  /api/platform/sme/companies                SME companies with their latest figures
 *   GET  /api/platform/sme/partners · PUT /partners/:tenantId   network companies and their kind
 *   GET/POST/DELETE /api/platform/sme/links         SME ↔ partner links (sharing stays off until the SME switches it on)
 *   GET  /api/platform/sme/ca · PATCH /ca/:id       CA validation queue: assign a CA firm
 *   GET  /api/platform/sme/settings · /settings/:key · /settings/:key/:version   versioned settings
 *   POST /api/platform/sme/settings/:key            new draft · POST …/:version/activate
 *   GET  /api/platform/sme/scrap · PATCH /scrap/:id listings: block or release
 *   GET  /api/platform/sme/credits · PATCH /credits/:id   pooled credit projects
 *   GET  /api/platform/sme/benchmark · /benchmark.csv     anonymised, consented figures only
 * Company creation, plans, users and the audit log are the console's existing screens.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformTx, type Tx } from '../db/pool.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { KEYS, KEY_LABEL, activate, active, createDraft, getVersion, versions, type Key } from '../lib/sme/settings.js';
import { fyOf, isFy } from '../lib/sme/company.js';

const fyParam = (req: FastifyRequest) => { const fy = (req.query as { fy?: string }).fy ?? fyOf(); if (!isFy(fy)) throw new AppError('Choose a financial year like "FY 2025-26"'); return fy; };
const keyParam = (req: FastifyRequest): Key => { const k = (req.params as { key: string }).key; if (!(KEYS as readonly string[]).includes(k)) throw notFound('Setting'); return k as Key; };
const log = (c: Tx, req: FastifyRequest, action: string, entity: string, id: string | null, detail?: unknown) =>
  c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES (NULL,$1,$2,$3,$4,$5,$6,$7)`, [req.user.id, req.user.name, action, entity, id, detail ? JSON.stringify(detail) : null, req.ip]);

export async function smeAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => { if (req.url.startsWith('/api/platform/sme')) requirePlatformAdmin(req); });

  app.get('/api/platform/sme/overview', async (req) => {
    const fy = fyParam(req);
    const plans = (await active()).plans?.items ?? [];
    return platformTx(async (c) => {
      const companies = (await c.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE t.status = 'active')::int AS active, count(*) FILTER (WHERE t.plan = 'trial')::int AS trial,
                                               count(*) FILTER (WHERE t.created_at > now() - interval '30 days')::int AS new30
                                          FROM tenant t LEFT JOIN sme_company s ON s.tenant_id = t.id WHERE 'sme' = ANY(t.products) AND NOT COALESCE(s.is_example, false)`)).rows[0];
      const withData = (await c.query(`SELECT count(DISTINCT tenant_id)::int AS n FROM sme_doc WHERE fy = $1 AND module = 'emissions'`, [fy])).rows[0].n;
      const users = (await c.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE u.last_login_at > now() - interval '30 days')::int AS active30 FROM app_user u JOIN tenant t ON t.id = u.tenant_id WHERE 'sme' = ANY(t.products) AND NOT u.disabled`)).rows[0];
      const ca = (await c.query(`SELECT status, count(*)::int AS n FROM sme_ca_request GROUP BY status`)).rows;
      const partners = (await c.query(`SELECT kind, count(*)::int AS n FROM sme_partner GROUP BY kind`)).rows;
      const signups = (await c.query(`SELECT to_char(created_at, 'YYYY-MM') AS month, count(*)::int AS n FROM tenant WHERE 'sme' = ANY(products) AND created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1`)).rows;
      const totals = (await c.query(`SELECT count(*)::int AS n, COALESCE(sum(scope1 + scope2), 0)::float8 AS s12, COALESCE(avg(esg_pct), 0)::float8 AS esg FROM sme_result WHERE fy = $1`, [fy])).rows[0];
      const priced = (await c.query(`SELECT COALESCE(sum(price), 0)::float8 AS sum FROM tenant WHERE 'sme' = ANY(products) AND status = 'active'`)).rows[0].sum;
      return { fy, companies, withData, users, ca, partners, signups, totals, revenue: priced, plans };
    });
  });

  app.get('/api/platform/sme/companies', async (req) => {
    const fy = fyParam(req);
    const q = (req.query as { search?: string; state?: string }) ?? {};
    return platformTx(async (c) => ({
      fy,
      companies: (await c.query(`SELECT t.id, t.name, t.plan, t.status, t.access_expiry, t.created_at, s.sector, s.industry, s.state, s.is_example,
            r.scope1, r.scope2, r.esg_pct, r.esg_level, r.srmm_pct, r.savings_inr, r.bench_consent,
            (SELECT count(*)::int FROM sme_doc d WHERE d.tenant_id = t.id AND d.fy = $1) AS modules,
            (SELECT max(u.last_login_at) FROM app_user u WHERE u.tenant_id = t.id) AS last_login,
            (SELECT count(*)::int FROM sme_link l WHERE l.sme_tenant = t.id) AS partners,
            (SELECT count(*)::int FROM sme_link l WHERE l.sme_tenant = t.id AND l.share) AS sharing
          FROM tenant t LEFT JOIN sme_company s ON s.tenant_id = t.id LEFT JOIN sme_result r ON r.tenant_id = t.id AND r.fy = $1
         WHERE 'sme' = ANY(t.products) AND ($2::text IS NULL OR t.name ILIKE '%' || $2 || '%' OR s.industry ILIKE '%' || $2 || '%') AND ($3::text IS NULL OR s.state = $3)
         ORDER BY t.created_at DESC LIMIT 500`, [fy, q.search || null, q.state || null])).rows,
    }));
  });

  // ------------------------------------------------------------------ network partners --
  app.get('/api/platform/sme/partners', async () => platformTx(async (c) => ({
    partners: (await c.query(`SELECT t.id, t.name, t.status, p.kind, p.city,
        (SELECT count(*)::int FROM sme_link l WHERE l.partner_tenant = t.id) AS links,
        (SELECT count(*)::int FROM sme_link l WHERE l.partner_tenant = t.id AND l.share) AS sharing
      FROM tenant t LEFT JOIN sme_partner p ON p.tenant_id = t.id WHERE 'smenet' = ANY(t.products) ORDER BY p.kind NULLS FIRST, t.name`)).rows,
  })));
  app.put('/api/platform/sme/partners/:tenantId', async (req) => {
    const id = z.string().uuid().parse((req.params as { tenantId: string }).tenantId);
    const b = z.object({ kind: z.enum(['buyer', 'cluster', 'bank', 'ca_firm']), city: z.string().trim().max(80).default('') }).parse(req.body);
    return platformTx(async (c) => {
      const t = (await c.query(`SELECT products FROM tenant WHERE id = $1`, [id])).rows[0];
      if (!t) throw notFound('Company');
      if (!t.products.includes('smenet')) throw new AppError('Switch on the SME network package for this company first.', 400, 'NO_PACKAGE');
      await c.query(`INSERT INTO sme_partner (tenant_id, kind, city) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO UPDATE SET kind = EXCLUDED.kind, city = EXCLUDED.city`, [id, b.kind, b.city]);
      await log(c, req, 'sme.partner.set', 'tenant', id, b);
      return { ok: true };
    });
  });

  app.get('/api/platform/sme/links', async (req) => {
    const q = req.query as { partner?: string; sme?: string };
    return platformTx(async (c) => ({
      links: (await c.query(`SELECT l.*, pt.name AS partner, p.kind, st.name AS sme FROM sme_link l JOIN tenant pt ON pt.id = l.partner_tenant LEFT JOIN sme_partner p ON p.tenant_id = l.partner_tenant JOIN tenant st ON st.id = l.sme_tenant
                              WHERE ($1::uuid IS NULL OR l.partner_tenant = $1) AND ($2::uuid IS NULL OR l.sme_tenant = $2) ORDER BY pt.name, st.name LIMIT 1000`, [q.partner || null, q.sme || null])).rows,
    }));
  });
  app.post('/api/platform/sme/links', async (req) => {
    const b = z.object({ partnerTenant: z.string().uuid(), smeTenant: z.string().uuid(), purchaseSharePct: z.number().min(0).max(100).nullable().optional(), loanCr: z.number().min(0).nullable().optional(), evCr: z.number().min(0).nullable().optional() }).parse(req.body);
    return platformTx(async (c) => {
      const p = (await c.query(`SELECT products FROM tenant WHERE id = $1`, [b.partnerTenant])).rows[0], s = (await c.query(`SELECT products FROM tenant WHERE id = $1`, [b.smeTenant])).rows[0];
      if (!p?.products.includes('smenet')) throw new AppError('The partner needs the SME network package.');
      if (!s?.products.includes('sme')) throw new AppError('The SME needs the EKOTRACE SME package.');
      await c.query(`INSERT INTO sme_link (partner_tenant, sme_tenant, purchase_share_pct, loan_cr, ev_cr) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (partner_tenant, sme_tenant) DO NOTHING`,
        [b.partnerTenant, b.smeTenant, b.purchaseSharePct ?? null, b.loanCr ?? null, b.evCr ?? null]);
      await log(c, req, 'sme.link.create', 'sme_link', null, b);
      return { ok: true };
    });
  });
  app.delete('/api/platform/sme/links/:id', async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return platformTx(async (c) => {
      const r = (await c.query(`DELETE FROM sme_link WHERE id = $1 RETURNING partner_tenant, sme_tenant`, [id])).rows[0];
      if (!r) throw notFound('Link');
      await log(c, req, 'sme.link.delete', 'sme_link', id, r);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ CA validation queue --
  app.get('/api/platform/sme/ca', async () => platformTx(async (c) => ({
    requests: (await c.query(`SELECT q.*, st.name AS company, s.state, ct.name AS ca_firm FROM sme_ca_request q JOIN tenant st ON st.id = q.sme_tenant LEFT JOIN sme_company s ON s.tenant_id = q.sme_tenant LEFT JOIN tenant ct ON ct.id = q.ca_tenant
                               ORDER BY array_position(ARRAY['requested','assigned','in_review','validated','rejected'], q.status), q.created_at`)).rows,
    firms: (await c.query(`SELECT t.id, t.name, p.city FROM sme_partner p JOIN tenant t ON t.id = p.tenant_id WHERE p.kind = 'ca_firm' AND t.status = 'active' ORDER BY t.name`)).rows,
  })));
  app.patch('/api/platform/sme/ca/:id', async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ caTenant: z.string().uuid().nullable().optional(), status: z.enum(['requested', 'rejected']).optional(), notes: z.string().max(4000).optional() }).parse(req.body);
    return platformTx(async (c) => {
      const r = (await c.query(`SELECT * FROM sme_ca_request WHERE id = $1`, [id])).rows[0];
      if (!r) throw notFound('Request');
      if (b.caTenant && !(await c.query(`SELECT 1 FROM sme_partner WHERE tenant_id = $1 AND kind = 'ca_firm'`, [b.caTenant])).rowCount) throw new AppError('Choose a CA firm.');
      const status = b.caTenant ? 'assigned' : b.status ?? r.status;
      await c.query(`UPDATE sme_ca_request SET ca_tenant = COALESCE($2, ca_tenant), status = $3, notes = COALESCE($4, notes), updated_at = now() WHERE id = $1`, [id, b.caTenant ?? null, status, b.notes ?? null]);
      await log(c, req, 'sme.ca.assign', 'sme_ca_request', id, { caTenant: b.caTenant, status });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ settings --
  app.get('/api/platform/sme/settings', async () => {
    await active();   // stores version 1 of any key that has none yet
    return platformTx(async (c) => ({
      keys: KEYS.map((k) => ({ key: k, label: KEY_LABEL[k] })),
      items: (await c.query(`SELECT skey, max(version) AS latest, max(version) FILTER (WHERE status = 'active') AS active, max(activated_at) FILTER (WHERE status = 'active') AS activated_at,
                                    count(*) FILTER (WHERE status = 'draft')::int AS drafts FROM sme_setting GROUP BY skey`)).rows,
    }));
  });
  app.get('/api/platform/sme/settings/:key', async (req) => {
    const k = keyParam(req);
    await active();
    return platformTx(async (c) => ({ key: k, label: KEY_LABEL[k], versions: await versions(c, k), active: await getVersion(c, k) }));
  });
  app.get('/api/platform/sme/settings/:key/:version', async (req) => {
    const k = keyParam(req), v = z.coerce.number().int().positive().parse((req.params as { version: string }).version);
    return platformTx(async (c) => ({ item: await getVersion(c, k, v) }));
  });
  app.post('/api/platform/sme/settings/:key', { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const k = keyParam(req);
    const b = z.object({ data: z.record(z.string(), z.any()), note: z.string().max(300).nullable().optional() }).parse(req.body);
    return platformTx(async (c) => {
      const v = await createDraft(c, k, b.data, b.note ?? null, req.user.name);
      await log(c, req, 'sme.setting.draft', 'sme_setting', `${k}@${v}`, { note: b.note });
      return { version: v };
    });
  });
  app.post('/api/platform/sme/settings/:key/:version/activate', async (req) => {
    const k = keyParam(req), v = z.coerce.number().int().positive().parse((req.params as { version: string }).version);
    return platformTx(async (c) => {
      await activate(c, k, v, req.user.name);
      await log(c, req, 'sme.setting.activate', 'sme_setting', `${k}@${v}`);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ scrap market --
  app.get('/api/platform/sme/scrap', async () => platformTx(async (c) => ({
    listings: (await c.query(`SELECT x.*, t.name AS company, s.state FROM sme_scrap x JOIN tenant t ON t.id = x.tenant_id LEFT JOIN sme_company s ON s.tenant_id = x.tenant_id
                               WHERE x.status IN ('listed', 'blocked', 'sold') ORDER BY x.hazardous DESC, x.updated_at DESC LIMIT 500`)).rows,
  })));
  app.patch('/api/platform/sme/scrap/:id', async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ status: z.enum(['listed', 'blocked']), note: z.string().max(300).nullable().optional() }).parse(req.body);
    return platformTx(async (c) => {
      const r = await c.query(`UPDATE sme_scrap SET status = $2, admin_note = $3, updated_at = now() WHERE id = $1`, [id, b.status, b.note ?? null]);
      if (!r.rowCount) throw notFound('Listing');
      await log(c, req, 'sme.scrap.moderate', 'sme_scrap', id, b);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ carbon credit pool --
  app.get('/api/platform/sme/credits', async () => platformTx(async (c) => ({
    projects: (await c.query(`SELECT x.*, t.name AS company, s.state FROM sme_credit x JOIN tenant t ON t.id = x.tenant_id LEFT JOIN sme_company s ON s.tenant_id = x.tenant_id ORDER BY x.created_at DESC LIMIT 1000`)).rows,
    totals: (await c.query(`SELECT status, count(*)::int AS n, COALESCE(sum(tco2e_per_year), 0)::float8 AS t FROM sme_credit GROUP BY status`)).rows,
  })));
  app.patch('/api/platform/sme/credits/:id', async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ status: z.enum(['proposed', 'accepted', 'registered', 'issued', 'rejected']) }).parse(req.body);
    return platformTx(async (c) => {
      const r = await c.query(`UPDATE sme_credit SET status = $2 WHERE id = $1`, [id, b.status]);
      if (!r.rowCount) throw notFound('Project');
      await log(c, req, 'sme.credit.status', 'sme_credit', id, b);
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ benchmark (anonymised, consented) --
  const benchRows = (c: Tx, fy: string) => c.query(`SELECT r.industry, r.state, r.sector, r.scope1, r.scope2, r.scope3, r.intensity, r.esg_pct, r.esg_level, r.srmm_pct, r.srmm_level, r.cbam_see
                                                      FROM sme_result r LEFT JOIN sme_company s ON s.tenant_id = r.tenant_id WHERE r.fy = $1 AND r.bench_consent AND NOT COALESCE(s.is_example, false)`, [fy]);
  app.get('/api/platform/sme/benchmark', async (req) => {
    const fy = fyParam(req);
    return platformTx(async (c) => {
      const rows = (await benchRows(c, fy)).rows;
      const by = new Map<string, number[]>();
      for (const r of rows) { const k = r.industry || 'Not stated'; by.set(k, [...(by.get(k) ?? []), Number(r.intensity)]); }
      const groups = [...by.entries()].map(([industry, a]) => {
        const s = a.filter((x) => x > 0).sort((x, y) => x - y);
        return { industry, n: a.length, median: a.length >= 5 && s.length ? s[Math.floor(s.length / 2)] : null, shown: a.length >= 5 };
      }).sort((a, b) => b.n - a.n);
      return { fy, companies: rows.length, groups, minGroup: 5 };
    });
  });
  app.get('/api/platform/sme/benchmark.csv', async (req, reply) => {
    const fy = fyParam(req);
    const rows = await platformTx(async (c) => { const r = (await benchRows(c, fy)).rows; await log(c, req, 'sme.benchmark.export', 'sme_result', fy); return r; });
    const cols = ['industry', 'state', 'sector', 'scope1', 'scope2', 'scope3', 'intensity', 'esg_pct', 'esg_level', 'srmm_pct', 'srmm_level', 'cbam_see'];
    // text that a spreadsheet would run as a formula gets a leading apostrophe
    const esc = (v: unknown) => { if (v === null || v === undefined) return ''; let s = String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="sme-benchmark-${fy.replace(/\s/g, '')}.csv"`);
    return [cols.join(','), ...rows.map((r: any) => cols.map((k) => esc(r[k])).join(','))].join('\n');
  });
}
