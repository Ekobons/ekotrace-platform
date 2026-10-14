/**
 * Security settings of a company (Setup → Security & audit log) and of the platform.
 *
 *   Company (super admin)   require MFA for everyone; single sign-on with the company's identity provider
 *                           (OpenID Connect); reset a person's MFA (lost phone); export everything the
 *                           company holds (ZIP: every table as CSV, every file, a manifest of SHA-256 checksums).
 *   Platform admin          verify the audit log's hash chain; SIEM forwarding status; delete a suspended
 *                           company's data at the end of its contract, with a certificate of destruction.
 *   API                     GET /api/v1/audit-events — a SIEM pulls the company's sealed audit events
 *                           (API client with the "audit events" permission).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requirePlatformAdmin, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { encrypt, openFile } from '../lib/secrets.js';
import { checkUrl, discover } from '../lib/oidc.js';
import { seal, verify } from '../lib/auditlog.js';
import { Zip } from '../lib/zip.js';
import { countRows, purgeTenant, tenantTables } from '../db/purge.js';
import { config } from '../config.js';
import { applyRoles } from './scim.routes.js';
import { newToken, sha256 } from '../lib/password.js';
import { apiClient } from './meters.routes.js';
import { ssoRedirectUri } from './auth.routes.js';
import { PRODUCT, PRODUCT_SLUG } from '../lib/brand.js';

const SECRET_COL = /(hash|secret|token|password|verifier|nonce|^mfa_|recovery|^data$)/i;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const domainRe = /^(?=.{3,190}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!).filter((k) => !SECRET_COL.test(k) && !Buffer.isBuffer(rows[0]![k]));
  return [cols.join(','), ...rows.map((r) => cols.map((k) => csvCell(r[k])).join(','))].join('\r\n') + '\r\n';
}

/** Everything the company holds, as one ZIP. */
export async function exportCompany(c: Tx, tenantId: string, by: string) {
  const zip = new Zip();
  const t = (await c.query('SELECT * FROM tenant WHERE id = $1', [tenantId])).rows[0];
  if (!t) throw notFound('Company');
  const tables: Record<string, number> = {};
  const dataFiles: { path: string; rows: number; sha256: string }[] = [];
  const put = (path: string, rows: Record<string, unknown>[]) => {
    const body = toCsv(rows); zip.add(path, body); dataFiles.push({ path, rows: rows.length, sha256: sha(body) }); tables[path.replace(/^data\/|\.csv$/g, '')] = rows.length;
  };
  put('data/tenant.csv', [t]);
  for (const name of await tenantTables(c)) {
    const rows = (await c.query(`SELECT * FROM "${name}" WHERE tenant_id = $1`, [tenantId])).rows;
    if (rows.length) put(`data/${name}.csv`, rows);
  }
  put('data/audit_log.csv', (await c.query('SELECT id, at, user_name, user_id, action, entity, entity_id, detail, ip, seal_seq, hash FROM audit_log WHERE tenant_id = $1 ORDER BY id', [tenantId])).rows);
  const files: { path: string; size: number; sha256: string; kind: string }[] = [];
  const docs = (await c.query('SELECT id, kind, filename, data FROM document WHERE tenant_id = $1 ORDER BY uploaded_at', [tenantId])).rows;
  for (const d of docs) {
    d.data = openFile(d.data);
    const path = `files/${d.kind}/${d.id.slice(0, 8)}-${String(d.filename).replace(/[^\w.\- ()]/g, '_')}`;
    zip.add(path, d.data); files.push({ path, size: d.data.length, sha256: sha(d.data), kind: d.kind });
  }
  const manifest = { company: t.name, companyId: tenantId, exportedAt: new Date().toISOString(), exportedBy: by, format: 'CSV (UTF-8, comma-separated, one file per table) + original files',
    note: 'Password hashes, session tokens, MFA and SSO secrets are not exported.', tables, dataFiles, files };
  const mj = JSON.stringify(manifest, null, 2);
  zip.add('manifest.json', mj);
  zip.add('README.txt', `Export of ${t.name} from ${PRODUCT}, ${manifest.exportedAt}.\r\n\r\ndata/   one CSV per table (all of the company's records; audit_log.csv is the company's audit trail)\r\nfiles/  every stored file (bills, invoices, permits, statements…), by kind\r\nmanifest.json  row counts and the SHA-256 checksum of every file, to check the export is complete and unchanged\r\n\r\nPassword hashes, session tokens and MFA / SSO secrets are left out on purpose.\r\n`);
  return { zip: zip.finish(), manifestSha: sha(mj), tables, files: files.length };
}

async function ssoView(c: Tx, req: FastifyRequest, tenantId: string) {
  const s = (await c.query('SELECT * FROM sso_config WHERE tenant_id = $1', [tenantId])).rows[0];
  return { issuer: s?.issuer ?? '', clientId: s?.client_id ?? '', hasSecret: !!s?.client_secret, domains: s?.domains ?? [], enabled: !!s?.enabled, enforce: !!s?.enforce,
    requireMfa: s ? s.require_mfa : true, redirectUri: ssoRedirectUri(req), updatedBy: s?.updated_by ?? null, updatedAt: s?.updated_at ?? null };
}

export async function securityRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ company --
  app.get('/api/security', async (req) => {
    const tenant = requireTenant(req);
    if (!['platform_admin', 'super_admin', 'admin', 'verifier'].includes(req.user.role)) throw forbidden();
    return tenantTx(tenant, async (c) => {
      const t = (await c.query('SELECT mfa_required FROM tenant WHERE id = $1', [tenant])).rows[0];
      const people = (await c.query(
        `SELECT u.id, u.name, u.email, u.role, u.disabled, u.mfa_enabled_at IS NOT NULL AS mfa, cardinality(u.mfa_recovery) AS recovery_left, u.last_login_at,
                (SELECT a.detail->>'method' FROM audit_log a WHERE a.user_id = u.id AND a.action IN ('login', 'login.sso') ORDER BY a.id DESC LIMIT 1) AS last_method
           FROM app_user u ORDER BY u.disabled, u.name`)).rows;
      return { mfaRequired: t.mfa_required, sso: await ssoView(c, req, tenant), people, canEdit: ['platform_admin', 'super_admin'].includes(req.user.role),
        audit: { retentionMonths: config.auditRetentionMonths, siem: !!config.siemSyslog }, idleMinutes: Number(process.env.IDLE_MINUTES ?? 30) };
    });
  });

  app.put('/api/security/mfa', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ required: z.boolean() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query('UPDATE tenant SET mfa_required = $2 WHERE id = $1', [tenant, b.required]);
      await audit(c, req, 'security.mfa_policy', 'tenant', tenant, b);
      return { ok: true };
    });
  });

  app.put('/api/security/sso', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({
      issuer: z.string().trim().max(300), clientId: z.string().trim().min(1).max(200), clientSecret: z.string().max(500).optional(),
      domains: z.array(z.string().trim().toLowerCase().regex(domainRe, 'Not a valid email domain')).min(1, 'Add at least one email domain').max(20),
      enabled: z.boolean(), enforce: z.boolean(), requireMfa: z.boolean(),
    }).parse(req.body);
    try { checkUrl(b.issuer); } catch (e) { throw new AppError((e as Error).message); }
    const issuer = b.issuer.replace(/\/$/, '');
    if (b.enabled) { try { await discover(issuer); } catch (e) { throw new AppError(`The identity provider could not be reached at ${issuer} (${(e as Error).message})`); } }
    const taken = await platformTx(async (c) => (await c.query(`SELECT d FROM sso_config s, unnest(s.domains) d WHERE s.tenant_id <> $1 AND d = ANY($2)`, [tenant, b.domains])).rows.map((r) => r.d));
    if (taken.length) throw new AppError(`${taken.join(', ')} already signs in to another company`);
    const plat = b.domains.filter((d) => config.platformSso?.domains.includes(d));
    if (plat.length) throw new AppError(`${plat.join(', ')} is reserved for platform administrators`);
    if (b.enforce && !b.enabled) throw new AppError('Switch company sign-in on before making it the only way to sign in');
    return tenantTx(tenant, async (c) => {
      if (b.enforce) {
        const glass = (await c.query(`SELECT count(*)::int AS n FROM app_user WHERE role = 'super_admin' AND NOT disabled AND mfa_enabled_at IS NOT NULL`)).rows[0].n;
        if (!glass) throw new AppError('Before "company sign-in only", a super admin needs MFA set up: they keep password sign-in for emergencies (break-glass)');
      }
      const secret = b.clientSecret === undefined ? undefined : b.clientSecret ? encrypt(b.clientSecret) : null;
      await c.query(
        `INSERT INTO sso_config (tenant_id, issuer, client_id, client_secret, domains, enabled, enforce, require_mfa, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (tenant_id) DO UPDATE SET issuer = $2, client_id = $3, client_secret = CASE WHEN $10 THEN EXCLUDED.client_secret ELSE sso_config.client_secret END,
           domains = $5, enabled = $6, enforce = $7, require_mfa = $8, updated_by = $9, updated_at = now()`,
        [tenant, issuer, b.clientId, secret ?? null, [...new Set(b.domains)], b.enabled, b.enforce, b.requireMfa, req.user.name, secret !== undefined]);
      await audit(c, req, 'security.sso', 'tenant', tenant, { issuer, clientId: b.clientId, domains: b.domains, enabled: b.enabled, enforce: b.enforce, requireMfa: b.requireMfa, secretChanged: secret !== undefined });
      return { sso: await ssoView(c, req, tenant) };
    });
  });

  /** Check the identity provider answers (its published configuration). */
  app.post('/api/security/sso/test', async (req) => {
    requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ issuer: z.string().trim().max(300) }).parse(req.body);
    try {
      checkUrl(b.issuer);
      const d = await discover(b.issuer);
      return { ok: true, issuer: d.issuer, authorization: d.authorization_endpoint, token: d.token_endpoint, keys: d.jwks_uri };
    } catch (e) { return { ok: false, message: (e as Error).message }; }
  });

  /** A person lost their phone: their MFA is reset (they set it up again at next sign-in when required). */
  app.post('/api/users/:id/mfa/reset', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const u = (await c.query('SELECT id, name FROM app_user WHERE id = $1', [id])).rows[0];
      if (!u) throw notFound('Person');
      if (id === req.user.id) throw new AppError('Use your own account page to change your MFA');
      await c.query(`UPDATE app_user SET mfa_secret = NULL, mfa_pending = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL, mfa_recovery = '{}' WHERE id = $1`, [id]);
      await platformTx((p) => p.query('DELETE FROM session WHERE user_id = $1', [id]));
      await audit(c, req, 'mfa.reset', 'user', id, { name: u.name });
      return { ok: true };
    });
  });

  /** Everything the company holds (super admin): ZIP with CSV per table, every file, manifest with checksums. */
  app.get('/api/security/export', async (req, reply) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const r = await tenantTx(tenant, async (c) => {
      const out = await exportCompany(c, tenant, `${req.user.name} <${req.user.email}>`);
      await audit(c, req, 'company.export', 'tenant', tenant, { manifestSha256: out.manifestSha, files: out.files, tables: Object.keys(out.tables).length });
      return out;
    });
    const name = `${PRODUCT_SLUG}-export-${new Date().toISOString().slice(0, 10)}.zip`;
    return reply.header('Content-Type', 'application/zip').header('Content-Disposition', `attachment; filename="${name}"`).header('X-Manifest-SHA256', r.manifestSha).header('Cache-Control', 'no-store').send(r.zip);
  });

  // ------------------------------------------------------- account sync (SCIM) --
  const scimView = async (c: Tx, req: FastifyRequest) => {
    const t = (await c.query('SELECT prefix, default_role, created_by, created_at, last_used_at FROM scim_token')).rows[0] ?? null;
    const groups = (await c.query(`SELECT g.id, g.display_name, g.role, g.scope_node_id, g.facility_ids, g.updated_at, n.name AS scope_name,
                                          (SELECT count(*)::int FROM scim_member m WHERE m.group_id = g.id) AS members
                                     FROM scim_group g LEFT JOIN org_node n ON n.id = g.scope_node_id ORDER BY lower(g.display_name)`)).rows;
    const people = (await c.query(`SELECT count(*) FILTER (WHERE scim_managed)::int AS managed, count(*) FILTER (WHERE scim_managed AND NOT disabled)::int AS active FROM app_user`)).rows[0];
    return { token: t, baseUrl: `${config.publicUrl ?? `${req.protocol}://${req.headers.host}`}/scim/v2`, groups, people };
  };
  app.get('/api/security/scim', async (req) => {
    const tenant = requireTenant(req);
    if (!['platform_admin', 'super_admin', 'admin', 'verifier'].includes(req.user.role)) throw forbidden();
    return tenantTx(tenant, (c) => scimView(c, req));
  });
  /** A new token (shown once); the old one stops working. */
  app.post('/api/security/scim/token', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const token = `eks_${newToken()}`;
    return tenantTx(tenant, async (c) => {
      await c.query(`INSERT INTO scim_token (tenant_id, token_hash, prefix, created_by) VALUES ($1,$2,$3,$4)
                     ON CONFLICT (tenant_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, prefix = EXCLUDED.prefix, created_by = EXCLUDED.created_by, created_at = now(), last_used_at = NULL`,
        [tenant, sha256(token), token.slice(0, 10), req.user.name]);
      await audit(c, req, 'scim.token', 'tenant', tenant, { prefix: token.slice(0, 10) });
      return { ...(await scimView(c, req)), secret: token };
    });
  });
  app.delete('/api/security/scim/token', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    return tenantTx(tenant, async (c) => { await c.query('DELETE FROM scim_token WHERE tenant_id = $1', [tenant]); await audit(c, req, 'scim.token_revoke', 'tenant', tenant); return { ok: true }; });
  });
  app.put('/api/security/scim/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ defaultRole: z.enum(['verifier']).nullable() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('UPDATE scim_token SET default_role = $2 WHERE tenant_id = $1', [tenant, b.defaultRole])).rowCount) throw new AppError('Make a SCIM token first');
      const ids = (await c.query('SELECT id FROM app_user WHERE scim_managed')).rows.map((r) => r.id);
      await applyRoles(c, tenant, ids, b.defaultRole, req.ip);
      await audit(c, req, 'scim.settings', 'tenant', tenant, b);
      return scimView(c, req);
    });
  });
  /** What a provider group gives its members. */
  app.put('/api/security/scim/groups/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ role: z.enum(['super_admin', 'admin', 'manager', 'preparer', 'verifier']).nullable(), scopeNodeId: z.string().uuid().nullable().optional(), facilityIds: z.array(z.string().uuid()).max(500).default([]) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const g = (await c.query('SELECT id, display_name FROM scim_group WHERE id = $1', [id])).rows[0];
      if (!g) throw notFound('Group');
      if (b.role === 'admin') {
        const n = b.scopeNodeId ? (await c.query('SELECT kind FROM org_node WHERE id = $1', [b.scopeNodeId])).rows[0] : null;
        if (!n || n.kind === 'facility') throw new AppError('Choose the sub-group (or main entity) the Admins of this group run');
      }
      if (['manager', 'preparer'].includes(b.role ?? '') && b.facilityIds.length) {
        const ok = (await c.query(`SELECT count(*)::int AS n FROM org_node WHERE id = ANY($1) AND kind = 'facility'`, [b.facilityIds])).rows[0].n;
        if (ok !== new Set(b.facilityIds).size) throw new AppError('Some of the facilities do not exist');
      }
      await c.query('UPDATE scim_group SET role = $2, scope_node_id = $3, facility_ids = $4, updated_at = now() WHERE id = $1',
        [id, b.role, b.role === 'admin' ? b.scopeNodeId : null, ['manager', 'preparer'].includes(b.role ?? '') ? b.facilityIds : []]);
      const members = (await c.query('SELECT user_id FROM scim_member WHERE group_id = $1', [id])).rows.map((r) => r.user_id);
      const def = (await c.query('SELECT default_role FROM scim_token')).rows[0]?.default_role ?? null;
      await applyRoles(c, tenant, members, def, req.ip);
      await audit(c, req, 'scim.group_mapping', 'scim_group', id, { group: g.display_name, ...b });
      return scimView(c, req);
    });
  });

  // ------------------------------------------------------------------- alerts --
  app.get('/api/security/alerts', async (req) => {
    const tenant = requireTenant(req);
    if (!['platform_admin', 'super_admin', 'admin', 'verifier'].includes(req.user.role)) throw forbidden();
    const q = z.object({ open: z.coerce.boolean().optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => ({
      alerts: (await c.query(`SELECT id, rule, severity, title, detail, at, ack_by, ack_at, ack_note FROM security_alert WHERE tenant_id = $1 AND ($2::boolean IS NOT TRUE OR ack_at IS NULL) ORDER BY at DESC LIMIT 300`, [tenant, q.open ?? null])).rows,
      open: (await c.query(`SELECT count(*)::int AS n FROM security_alert WHERE tenant_id = $1 AND ack_at IS NULL`, [tenant])).rows[0].n,
      canAck: ['platform_admin', 'super_admin'].includes(req.user.role),
    }));
  });
  app.get('/api/security/alerts/count', async (req) => {
    if (req.user.role === 'platform_admin' && !req.user.tenantId) {
      return { open: await platformTx(async (c) => (await c.query(`SELECT count(*)::int AS n FROM security_alert WHERE tenant_id IS NULL AND ack_at IS NULL`)).rows[0].n) };
    }
    const tenant = requireTenant(req);
    if (!['platform_admin', 'super_admin', 'admin'].includes(req.user.role)) return { open: 0 };
    return { open: await tenantTx(tenant, async (c) => (await c.query(`SELECT count(*)::int AS n FROM security_alert WHERE tenant_id = $1 AND ack_at IS NULL`, [tenant])).rows[0].n) };
  });
  app.post('/api/security/alerts/:id/ack', async (req) => {
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const b = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body);
    const platform = req.user.role === 'platform_admin' && !req.user.tenantId;
    const run = async (c: Tx) => {
      const a = (await c.query(`UPDATE security_alert SET ack_by = $2, ack_at = now(), ack_note = $3 WHERE id = $1 AND ack_at IS NULL AND ($4 OR tenant_id IS NOT NULL) RETURNING id, title, tenant_id`, [id, req.user.name, b.note ?? null, platform])).rows[0];
      if (!a) throw notFound('Open alert');
      await audit(c, req, 'alert.acknowledge', 'security_alert', id, { title: a.title, note: b.note ?? null });
      return { ok: true };
    };
    if (platform) return platformTx(run);
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    return tenantTx(tenant, run);
  });
  app.get('/api/platform/alerts', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({ alerts: (await c.query(
      `SELECT a.id, a.tenant_id, t.name AS company, a.rule, a.severity, a.title, a.detail, a.at, a.ack_by, a.ack_at, a.ack_note
         FROM security_alert a LEFT JOIN tenant t ON t.id = a.tenant_id WHERE a.tenant_id IS NULL OR a.severity = 'high' ORDER BY a.at DESC LIMIT 300`)).rows }));
  });

  // ----------------------------------------------------------------- platform --
  app.get('/api/platform/audit/verify', async (req) => {
    requirePlatformAdmin(req);
    const r = await verify();
    await platformTx((c) => audit(c, req, 'audit.verify', undefined, null, { ok: r.ok, checked: r.checked }));
    return r;
  });
  app.get('/api/platform/siem', async (req) => {
    requirePlatformAdmin(req);
    await seal();
    return platformTx(async (c) => {
      const cur = (await c.query(`SELECT last_seq, last_error, updated_at FROM siem_cursor WHERE name = 'syslog'`)).rows[0] ?? null;
      const ch = (await c.query('SELECT last_seq FROM audit_chain WHERE id = 1')).rows[0];
      const target = config.siemSyslog ? (() => { const u = new URL(config.siemSyslog!); return `${u.protocol}//${u.hostname}:${u.port || '(default)'}`; })() : null;
      return { target, sealedThrough: Number(ch.last_seq), forwardedThrough: cur ? Number(cur.last_seq) : 0, lastError: cur?.last_error ?? null, updatedAt: cur?.updated_at ?? null, retentionMonths: config.auditRetentionMonths };
    });
  });

  /** End of contract: delete a suspended company's data, after its export was handed over; returns the certificate. */
  app.post('/api/platform/companies/:id/destroy', async (req) => {
    requirePlatformAdmin(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ confirm: z.string().trim().max(200), reason: z.string().trim().min(5, 'Give the reason (e.g. contract ended on …)').max(500), exportSha256: z.string().regex(/^[0-9a-f]{64}$/).optional() }).parse(req.body);
    return platformTx(async (c) => {
      const t = (await c.query('SELECT id, name, country, status FROM tenant WHERE id = $1', [id])).rows[0];
      if (!t) throw notFound('Company');
      if (t.status !== 'suspended') throw new AppError('Suspend the company first (nobody can sign in), then delete its data');
      if (b.confirm !== t.name) throw new AppError('Type the company name exactly to confirm');
      const rows = await countRows(c, id);
      const files = Number((await c.query('SELECT count(*) AS n FROM document WHERE tenant_id = $1', [id])).rows[0].n);
      await purgeTenant(c, id);
      const backups = new Date(Date.now() + config.backupRetentionDays * 86400e3).toISOString().slice(0, 10);
      const lastAudit = (await c.query('SELECT max(at) AS at FROM audit_log WHERE tenant_id = $1', [id])).rows[0].at;
      const auditUntil = new Date(new Date(lastAudit ?? Date.now()).getTime() + config.auditRetentionMonths * 30.44 * 86400e3).toISOString().slice(0, 10);
      const cert = (await c.query(
        `INSERT INTO destruction_certificate (tenant_id, company, country, requested_by, reason, rows_deleted, files_deleted, export_sha256, backups_until, audit_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, t.name, t.country, `${req.user.name} <${req.user.email}>`, b.reason, JSON.stringify(rows), files, b.exportSha256 ?? null, backups, auditUntil])).rows[0];
      await c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,'company.destroy','certificate',$4,$5,$6)`,
        [id, req.user.id, req.user.name, cert.id, JSON.stringify({ company: t.name, rows: Object.values(rows).reduce((a, n) => a + n, 0), files, reason: b.reason }), req.ip]);
      return { certificate: cert };
    });
  });
  app.get('/api/platform/certificates', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({ certificates: (await c.query('SELECT * FROM destruction_certificate ORDER BY performed_at DESC')).rows }));
  });
}

/** SIEM pull (no browser session): sealed audit events of the API client's company, in order. */
export async function auditApiRoutes(app: FastifyInstance) {
  app.get('/api/v1/audit-events', async (req) => {
    const k = await apiClient(req, 'audit_events');
    const q = z.object({ after: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(1000).default(500) }).parse(req.query);
    await seal();
    return tenantTx(k.tenant_id, async (c) => {
      const events = (await c.query(
        `SELECT seal_seq AS seq, id::text, at, user_name AS "user", user_id AS "userId", action, entity, entity_id AS "entityId", detail, ip, prev_hash AS "prevHash", hash
           FROM audit_log WHERE tenant_id = $1 AND seal_seq > $2 ORDER BY seal_seq LIMIT $3`, [k.tenant_id, q.after, q.limit])).rows;
      return { events, next: events.length ? Number(events[events.length - 1].seq) : q.after, more: events.length === q.limit };
    });
  });
}
