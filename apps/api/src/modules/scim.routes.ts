/**
 * Automatic account sync (SCIM 2.0, RFC 7643/7644) from the company's identity provider — Microsoft Entra ID
 * provisioning, Okta, OneLogin, JumpCloud. Joiners get an account, leavers are switched off at once, and
 * roles follow group membership:
 *
 *   /scim/v2/Users    create, read, filter (userName / externalId / emails.value eq "…"), replace, patch, delete
 *   /scim/v2/Groups   the same; members added and removed with PATCH (as Entra sends them)
 *
 * The provider authenticates with a company token (Authorization: Bearer …) made by the super admin under
 * Security & audit log → Sign-in & MFA; only its SHA-256 is kept. People added by SCIM have no usable
 * password: they sign in with the company account (SSO).
 *
 * Roles: the super admin maps provider groups to Ekotrace roles (an Admin group to its sub-group, Manager /
 * Preparer groups to their facilities). A person gets the highest role of their mapped groups; in no mapped
 * group they have no access (or read-only, if the company chooses). "Delete" in the provider switches the
 * person off; their history stays. The last active super admin is never removed by a sync.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { checkUserLimit } from '../lib/plans.js';
import { hashPassword, newToken, sha256 } from '../lib/password.js';
import { config } from '../config.js';

const U = 'urn:ietf:params:scim:schemas:core:2.0:User';
const G = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const RANK: Record<string, number> = { super_admin: 5, admin: 4, manager: 3, preparer: 2, verifier: 1 };
const BY = 'Identity provider (SCIM)';

class ScimError extends Error { constructor(public status: number, msg: string, public scimType?: string) { super(msg); } }
const err = (reply: FastifyReply, e: ScimError) => reply.code(e.status).type('application/scim+json').send({ schemas: [ERR], status: String(e.status), ...(e.scimType ? { scimType: e.scimType } : {}), detail: e.message });
const truthy = (v: unknown) => v === true || (typeof v === 'string' && v.toLowerCase() === 'true');

/** The company of the calling identity provider. */
async function tenantOf(req: FastifyRequest): Promise<{ tenant: string; defaultRole: string | null }> {
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ''));
  if (!m) throw new ScimError(401, 'Send the SCIM token as "Authorization: Bearer …"');
  const r = await platformTx(async (c) => (await c.query(
    `UPDATE scim_token s SET last_used_at = now() FROM tenant t WHERE t.id = s.tenant_id AND s.token_hash = $1 AND t.status = 'active' RETURNING s.tenant_id, s.default_role`, [sha256(m[1]!)])).rows[0]);
  if (!r) throw new ScimError(401, 'SCIM token not valid');
  return { tenant: r.tenant_id, defaultRole: r.default_role };
}

async function log(c: Tx, tenant: string, action: string, entityId: string | null, detail: unknown, ip: string) {
  await c.query(`INSERT INTO audit_log (tenant_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,'user',$4,$5,$6)`, [tenant, BY, action, entityId, JSON.stringify(detail), ip]);
}

const base = (req: FastifyRequest) => `${config.publicUrl ?? `${req.protocol}://${req.headers.host}`}/scim/v2`;
function userRes(req: FastifyRequest, u: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [given, ...rest] = String(u.name ?? '').split(' ');
  return { schemas: [U], id: u.id, externalId: u.external_id ?? undefined, userName: u.email, displayName: u.name,
    name: { formatted: u.name, givenName: given, familyName: rest.join(' ') || undefined },
    emails: [{ value: u.email, type: 'work', primary: true }], active: !!u.scim_active && !u.disabled,
    'urn:ekotrace:params:scim:user': { role: u.disabled ? null : u.role, managed: u.scim_managed },
    meta: { resourceType: 'User', created: u.created_at, location: `${base(req)}/Users/${u.id}` } };
}
async function groupRes(c: Tx, req: FastifyRequest, g: Record<string, any>, withMembers = true) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const members = withMembers ? (await c.query('SELECT u.id, u.email FROM scim_member m JOIN app_user u ON u.id = m.user_id WHERE m.group_id = $1', [g.id])).rows.map((m) => ({ value: m.id, display: m.email })) : undefined;
  return { schemas: [G], id: g.id, externalId: g.external_id ?? undefined, displayName: g.display_name, ...(members ? { members } : {}),
    meta: { resourceType: 'Group', created: g.created_at, lastModified: g.updated_at, location: `${base(req)}/Groups/${g.id}` } };
}

/** Recompute role, scope, facilities and access of SCIM-managed people from their mapped groups. */
export async function applyRoles(c: Tx, tenant: string, userIds: string[], defaultRole: string | null, ip = '') {
  for (const id of [...new Set(userIds)]) {
    const u = (await c.query('SELECT id, role, disabled, scim_active, scim_managed, scope_node_id FROM app_user WHERE id = $1', [id])).rows[0];
    if (!u || !u.scim_managed) continue;
    const groups = (await c.query(`SELECT g.role, g.scope_node_id, g.facility_ids FROM scim_member m JOIN scim_group g ON g.id = m.group_id WHERE m.user_id = $1 AND g.role IS NOT NULL`, [id])).rows;
    let role: string | null = null;
    for (const g of groups) if (!role || RANK[g.role]! > RANK[role]!) role = g.role;
    role ??= defaultRole;
    const scope = role === 'admin' ? groups.find((g) => g.role === 'admin' && g.scope_node_id)?.scope_node_id ?? null : null;
    const facs = ['manager', 'preparer'].includes(role ?? '') ? [...new Set(groups.filter((g) => g.role === role).flatMap((g) => g.facility_ids as string[]))] : [];
    let disabled = !u.scim_active || !role || (role === 'admin' && !scope);
    const newRole = role ?? u.role;
    // never remove the company's last active super admin
    if (u.role === 'super_admin' && !u.disabled && (disabled || newRole !== 'super_admin')) {
      const others = (await c.query(`SELECT count(*)::int AS n FROM app_user WHERE role = 'super_admin' AND NOT disabled AND id <> $1`, [id])).rows[0].n;
      if (!others) { await log(c, tenant, 'scim.kept_last_super_admin', id, { wouldBe: disabled ? 'no access' : newRole }, ip); continue; }
    }
    if (u.disabled && !disabled) {
      try { await checkUserLimit(c, tenant); } catch (e) { disabled = true; await log(c, tenant, 'scim.plan_limit', id, { message: (e as Error).message }, ip); }
    }
    const changed = u.role !== newRole || u.disabled !== disabled || (u.scope_node_id ?? null) !== scope;
    await c.query('UPDATE app_user SET role = $2, scope_node_id = $3, disabled = $4 WHERE id = $1', [id, newRole, scope, disabled]);
    await c.query('DELETE FROM user_facility WHERE user_id = $1', [id]);
    if (facs.length) await c.query(`INSERT INTO user_facility (user_id, node_id, tenant_id) SELECT $1, f, $2 FROM unnest($3::uuid[]) f JOIN org_node n ON n.id = f AND n.kind = 'facility'`, [id, tenant, facs]);
    if (disabled) await platformTx((p) => p.query('DELETE FROM session WHERE user_id = $1', [id]));
    if (changed) await log(c, tenant, 'scim.access', id, { role: disabled ? null : newRole, scope, facilities: facs.length, active: !disabled }, ip);
  }
}

// ------------------------------------------------------------------ parsing --
const emailOf = (b: Record<string, any>) => String(b.userName ?? (Array.isArray(b.emails) ? (b.emails.find((e: { primary?: boolean }) => e.primary) ?? b.emails[0])?.value : '') ?? '').trim().toLowerCase(); // eslint-disable-line @typescript-eslint/no-explicit-any
const nameOf = (b: Record<string, any>, email: string | undefined) => String(b.displayName || b.name?.formatted || [b.name?.givenName, b.name?.familyName].filter(Boolean).join(' ') || (email ?? '').split('@')[0]).trim().slice(0, 120); // eslint-disable-line @typescript-eslint/no-explicit-any
function filterOf(q: string | undefined): { attr: string; value: string } | null {
  if (!q) return null;
  const m = /^\s*([\w.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(q);
  if (!m) throw new ScimError(400, 'Only "<attribute> eq \\"value\\"" filters are supported', 'invalidFilter');
  return { attr: m[1]!.toLowerCase(), value: m[2]!.replace(/\\(.)/g, '$1') };
}

export async function scimRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/scim+json', { parseAs: 'string', bodyLimit: 1024 * 1024 }, (_r, body, done) => { try { done(null, JSON.parse(String(body) || '{}')); } catch (e) { done(e as Error); } });
  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof ScimError) return err(reply, e);
    if (e instanceof z.ZodError) return err(reply, new ScimError(400, e.issues.map((i) => i.message).join('; '), 'invalidValue'));
    if ((e as { code?: string }).code === '23505') return err(reply, new ScimError(409, 'Already exists', 'uniqueness'));
    reply.log.error(e);
    if (process.env.LOG_ERRORS === '1') console.error('[scim error]', e);
    return err(reply, new ScimError(500, 'Something went wrong'));
  });
  // the reply is sent only after the transaction commits (the handler returns the body; nothing is sent from inside it)
  const send = (reply: FastifyReply, code: number, body: unknown) => { reply.code(code).type('application/scim+json'); return body; };

  app.get('/scim/v2/ServiceProviderConfig', async (_req, reply) => send(reply, 200, {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'], patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 }, changePassword: { supported: false }, sort: { supported: false }, etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'Company SCIM token from Ekotrace (Security & audit log)' }] }));
  app.get('/scim/v2/ResourceTypes', async (_req, reply) => send(reply, 200, { schemas: [LIST], totalResults: 2, Resources: [
    { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: U },
    { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', schema: G }] }));

  // ------------------------------------------------------------------ users --
  app.get('/scim/v2/Users', async (req, reply) => {
    const { tenant } = await tenantOf(req);
    const q = z.object({ filter: z.string().max(300).optional(), startIndex: z.coerce.number().int().min(1).default(1), count: z.coerce.number().int().min(0).max(200).default(100) }).parse(req.query);
    const f = filterOf(q.filter);
    const where = !f ? 'true' : f.attr === 'username' || f.attr === 'emails.value' || f.attr === 'emails[type eq "work"].value' ? 'lower(email) = lower($1)' : f.attr === 'externalid' ? 'external_id = $1' : f.attr === 'id' ? 'id::text = $1' : null;
    if (!where) throw new ScimError(400, `Filtering on ${f!.attr} is not supported`, 'invalidFilter');
    return tenantTx(tenant, async (c) => {
      const params = f ? [f.value] : [];
      const total = Number((await c.query(`SELECT count(*) AS n FROM app_user WHERE ${where}`, params)).rows[0].n);
      const rows = (await c.query(`SELECT * FROM app_user WHERE ${where} ORDER BY created_at LIMIT ${q.count} OFFSET ${q.startIndex - 1}`, params)).rows;
      return send(reply, 200, { schemas: [LIST], totalResults: total, startIndex: q.startIndex, itemsPerPage: rows.length, Resources: rows.map((u) => userRes(req, u)) });
    });
  });
  app.get('/scim/v2/Users/:id', async (req, reply) => {
    const { tenant } = await tenantOf(req);
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const u = id.success ? (await c.query('SELECT * FROM app_user WHERE id = $1', [id.data])).rows[0] : null;
      if (!u) throw new ScimError(404, 'User not found');
      return send(reply, 200, userRes(req, u));
    });
  });
  app.post('/scim/v2/Users', async (req, reply) => {
    const { tenant, defaultRole } = await tenantOf(req);
    const b = (req.body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const email = emailOf(b);
    if (!z.string().email().safeParse(email).success) throw new ScimError(400, 'userName must be the person\'s email address', 'invalidValue');
    const pw = await hashPassword(newToken()); // nobody knows it: sign-in through the company account
    return tenantTx(tenant, async (c) => {
      const other = await platformTx(async (p) => (await p.query('SELECT tenant_id FROM app_user WHERE lower(email) = $1', [email])).rows[0]);
      if (other) throw new ScimError(409, other.tenant_id === tenant ? 'A person with this email exists: match on userName' : 'This email belongs to another organisation', 'uniqueness');
      const active = b.active === undefined ? true : truthy(b.active);
      const u = (await c.query(`INSERT INTO app_user (tenant_id, email, name, role, password_hash, must_change_password, created_by, external_id, scim_managed, scim_active, disabled)
                                VALUES ($1,$2,$3,'verifier',$4,false,NULL,$5,true,$6,true) RETURNING *`, [tenant, email, nameOf(b, email), pw, b.externalId ?? null, active])).rows[0];
      await log(c, tenant, 'scim.user_create', u.id, { email, externalId: b.externalId ?? null, active }, req.ip);
      await applyRoles(c, tenant, [u.id], defaultRole, req.ip);
      return send(reply, 201, userRes(req, (await c.query('SELECT * FROM app_user WHERE id = $1', [u.id])).rows[0]));
    });
  });

  /** Replace (PUT) or modify (PATCH) a person. */
  async function updateUser(req: FastifyRequest, reply: FastifyReply, patch: boolean) {
    const { tenant, defaultRole } = await tenantOf(req);
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const b = (req.body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return tenantTx(tenant, async (c) => {
      const u = id.success ? (await c.query('SELECT * FROM app_user WHERE id = $1', [id.data])).rows[0] : null;
      if (!u) throw new ScimError(404, 'User not found');
      const set: { email?: string; name?: string; externalId?: string | null; active?: boolean } = {};
      const apply = (path: string | undefined, value: unknown) => {
        const p = (path ?? '').toLowerCase();
        if (!p && value && typeof value === 'object') { for (const [k, v] of Object.entries(value as object)) apply(k, v); return; }
        if (p === 'active') set.active = truthy(value);
        else if (p === 'username' || p === 'emails' || p.startsWith('emails[')) { const e = typeof value === 'string' ? value : emailOf({ emails: Array.isArray(value) ? value : [value] }); if (e) set.email = e.toLowerCase(); }
        else if (p === 'displayname' || p === 'name.formatted') set.name = String(value).slice(0, 120);
        else if (p === 'name') set.name = nameOf({ name: value }, u.email);
        else if (p === 'externalid') set.externalId = value == null ? null : String(value);
        else if (p === 'name.givenname') set.name = `${value} ${String(u.name).split(' ').slice(1).join(' ')}`.trim();
        else if (p === 'name.familyname') set.name = `${String(u.name).split(' ')[0]} ${value}`.trim();
      };
      if (patch) {
        const ops = z.object({ Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown().optional() })).min(1) }).parse(b).Operations;
        for (const o of ops) { if (o.op.toLowerCase() === 'remove') { if ((o.path ?? '').toLowerCase() === 'externalid') set.externalId = null; continue; } apply(o.path, o.value); }
      } else {
        set.email = emailOf(b) || u.email; set.name = nameOf(b, set.email); set.externalId = b.externalId ?? u.external_id; set.active = b.active === undefined ? true : truthy(b.active);
      }
      if (set.email && set.email !== u.email) {
        if (!z.string().email().safeParse(set.email).success) throw new ScimError(400, 'userName must be an email address', 'invalidValue');
        const taken = await platformTx(async (p) => (await p.query('SELECT 1 FROM app_user WHERE lower(email) = $1 AND id <> $2', [set.email, u.id])).rowCount);
        if (taken) throw new ScimError(409, 'Another person has this email', 'uniqueness');
      }
      await c.query(`UPDATE app_user SET email = COALESCE($2, email), name = COALESCE($3, name), external_id = CASE WHEN $4 THEN $5 ELSE external_id END,
                       scim_active = COALESCE($6, scim_active), scim_managed = true WHERE id = $1`,
        [u.id, set.email ?? null, set.name ?? null, 'externalId' in set, set.externalId ?? null, set.active ?? null]);
      await log(c, tenant, 'scim.user_update', u.id, { ...set, firstSync: !u.scim_managed }, req.ip);
      await applyRoles(c, tenant, [u.id], defaultRole, req.ip);
      return send(reply, 200, userRes(req, (await c.query('SELECT * FROM app_user WHERE id = $1', [u.id])).rows[0]));
    });
  }
  app.put('/scim/v2/Users/:id', (req, reply) => updateUser(req, reply, false));
  app.patch('/scim/v2/Users/:id', (req, reply) => updateUser(req, reply, true));
  /** Removed in the provider: switched off (their history stays). */
  app.delete('/scim/v2/Users/:id', async (req, reply) => {
    const { tenant, defaultRole } = await tenantOf(req);
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const u = id.success ? (await c.query('SELECT id FROM app_user WHERE id = $1', [id.data])).rows[0] : null;
      if (!u) throw new ScimError(404, 'User not found');
      await c.query('UPDATE app_user SET scim_active = false, scim_managed = true WHERE id = $1', [u.id]);
      await c.query('DELETE FROM scim_member WHERE user_id = $1', [u.id]);
      await log(c, tenant, 'scim.user_delete', u.id, {}, req.ip);
      await applyRoles(c, tenant, [u.id], defaultRole, req.ip);
      { reply.code(204); return ''; }
    });
  });

  // ----------------------------------------------------------------- groups --
  app.get('/scim/v2/Groups', async (req, reply) => {
    const { tenant } = await tenantOf(req);
    const q = z.object({ filter: z.string().max(300).optional(), startIndex: z.coerce.number().int().min(1).default(1), count: z.coerce.number().int().min(0).max(200).default(100), excludedAttributes: z.string().optional() }).parse(req.query);
    const f = filterOf(q.filter);
    const where = !f ? 'true' : f.attr === 'displayname' ? 'lower(display_name) = lower($1)' : f.attr === 'externalid' ? 'external_id = $1' : f.attr === 'id' ? 'id::text = $1' : null;
    if (!where) throw new ScimError(400, `Filtering on ${f!.attr} is not supported`, 'invalidFilter');
    return tenantTx(tenant, async (c) => {
      const params = f ? [f.value] : [];
      const total = Number((await c.query(`SELECT count(*) AS n FROM scim_group WHERE ${where}`, params)).rows[0].n);
      const rows = (await c.query(`SELECT * FROM scim_group WHERE ${where} ORDER BY created_at LIMIT ${q.count} OFFSET ${q.startIndex - 1}`, params)).rows;
      const withMembers = !(q.excludedAttributes ?? '').toLowerCase().includes('members');
      return send(reply, 200, { schemas: [LIST], totalResults: total, startIndex: q.startIndex, itemsPerPage: rows.length, Resources: await Promise.all(rows.map((g) => groupRes(c, req, g, withMembers))) });
    });
  });
  app.get('/scim/v2/Groups/:id', async (req, reply) => {
    const { tenant } = await tenantOf(req);
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const g = id.success ? (await c.query('SELECT * FROM scim_group WHERE id = $1', [id.data])).rows[0] : null;
      if (!g) throw new ScimError(404, 'Group not found');
      return send(reply, 200, await groupRes(c, req, g));
    });
  });
  const memberIds = (v: unknown): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((m) => (typeof m === 'object' && m ? String((m as { value?: string }).value ?? '') : String(m))).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  async function setMembers(c: Tx, tenant: string, gid: string, add: string[], remove: string[] | 'all') {
    const before = (await c.query('SELECT user_id FROM scim_member WHERE group_id = $1', [gid])).rows.map((r) => r.user_id as string);
    if (remove === 'all') await c.query('DELETE FROM scim_member WHERE group_id = $1', [gid]);
    else if (remove.length) await c.query('DELETE FROM scim_member WHERE group_id = $1 AND user_id = ANY($2::uuid[])', [gid, remove]);
    if (add.length) await c.query(`INSERT INTO scim_member (tenant_id, group_id, user_id) SELECT $1, $2, u.id FROM app_user u WHERE u.id = ANY($3::uuid[]) ON CONFLICT DO NOTHING`, [tenant, gid, add]);
    return [...before, ...add];
  }
  app.post('/scim/v2/Groups', async (req, reply) => {
    const { tenant, defaultRole } = await tenantOf(req);
    const b = (req.body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = String(b.displayName ?? '').trim().slice(0, 200);
    if (!name) throw new ScimError(400, 'displayName is required', 'invalidValue');
    return tenantTx(tenant, async (c) => {
      const g = (await c.query('INSERT INTO scim_group (tenant_id, display_name, external_id) VALUES ($1,$2,$3) RETURNING *', [tenant, name, b.externalId ?? null])).rows[0];
      const touched = await setMembers(c, tenant, g.id, memberIds(b.members), []);
      await log(c, tenant, 'scim.group_create', g.id, { name, members: touched.length }, req.ip);
      await applyRoles(c, tenant, touched, defaultRole, req.ip);
      return send(reply, 201, await groupRes(c, req, g));
    });
  });
  async function updateGroup(req: FastifyRequest, reply: FastifyReply, patch: boolean) {
    const { tenant, defaultRole } = await tenantOf(req);
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    const b = (req.body ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return tenantTx(tenant, async (c) => {
      const g = id.success ? (await c.query('SELECT * FROM scim_group WHERE id = $1', [id.data])).rows[0] : null;
      if (!g) throw new ScimError(404, 'Group not found');
      let touched: string[] = [];
      let name: string | undefined, ext: string | null | undefined;
      if (patch) {
        const ops = z.object({ Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown().optional() })).min(1) }).parse(b).Operations;
        for (const o of ops) {
          const op = o.op.toLowerCase(), p = (o.path ?? '').toLowerCase();
          const one = /^members\[value eq "([^"]+)"\]$/i.exec(o.path ?? '');
          if (p === 'members' || one) {
            if (op === 'add') touched.push(...await setMembers(c, tenant, g.id, memberIds(o.value), []));
            else if (op === 'remove') {
              const ids = one ? [one[1]!] : memberIds(o.value);
              if (ids.length) { await setMembers(c, tenant, g.id, [], ids); touched.push(...ids); } else touched.push(...await setMembers(c, tenant, g.id, [], 'all'));
            }
            else if (op === 'replace') touched.push(...await setMembers(c, tenant, g.id, memberIds(o.value), 'all'));
          } else if (!p && o.value && typeof o.value === 'object') {
            const v = o.value as Record<string, unknown>;
            if (v.displayName) name = String(v.displayName); if ('externalId' in v) ext = v.externalId == null ? null : String(v.externalId);
            if (v.members) touched.push(...await setMembers(c, tenant, g.id, memberIds(v.members), op === 'replace' ? 'all' : []));
          } else if (p === 'displayname') name = String(o.value);
          else if (p === 'externalid') ext = op === 'remove' || o.value == null ? null : String(o.value);
        }
      } else {
        name = String(b.displayName ?? g.display_name); ext = b.externalId ?? g.external_id;
        touched = await setMembers(c, tenant, g.id, memberIds(b.members), 'all');
      }
      await c.query('UPDATE scim_group SET display_name = COALESCE($2, display_name), external_id = CASE WHEN $3 THEN $4 ELSE external_id END, updated_at = now() WHERE id = $1',
        [g.id, name ?? null, ext !== undefined, ext ?? null]);
      await log(c, tenant, 'scim.group_update', g.id, { name: name ?? g.display_name, changedMembers: touched.length }, req.ip);
      await applyRoles(c, tenant, touched, defaultRole, req.ip);
      if (patch) { reply.code(204); return ''; }
      return send(reply, 200, await groupRes(c, req, (await c.query('SELECT * FROM scim_group WHERE id = $1', [g.id])).rows[0]));
    });
  }
  app.put('/scim/v2/Groups/:id', (req, reply) => updateGroup(req, reply, false));
  app.patch('/scim/v2/Groups/:id', (req, reply) => updateGroup(req, reply, true));
  app.delete('/scim/v2/Groups/:id', async (req, reply) => {
    const { tenant, defaultRole } = await tenantOf(req);
    const id = z.string().uuid().safeParse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const g = id.success ? (await c.query('SELECT * FROM scim_group WHERE id = $1', [id.data])).rows[0] : null;
      if (!g) throw new ScimError(404, 'Group not found');
      const members = (await c.query('SELECT user_id FROM scim_member WHERE group_id = $1', [g.id])).rows.map((r) => r.user_id);
      await c.query('DELETE FROM scim_group WHERE id = $1', [g.id]);
      await log(c, tenant, 'scim.group_delete', g.id, { name: g.display_name, members: members.length }, req.ip);
      await applyRoles(c, tenant, members, defaultRole, req.ip);
      { reply.code(204); return ''; }
    });
  });
}
