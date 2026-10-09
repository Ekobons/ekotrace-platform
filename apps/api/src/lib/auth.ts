/**
 * Who is calling, and what they may do.
 *
 * Login creates a session; the browser keeps a random token in an http-only
 * cookie (JavaScript cannot read it) and the database keeps only its SHA-256.
 *
 * Roles (as in the prototype)
 *   platform_admin  Ekobon staff: companies, shared factor library; can open any company
 *   super_admin     the whole company: structure, people, methodology, all data
 *   admin           one sub-group and everything under it
 *   manager         the facilities they manage: enter and approve
 *   preparer        the facilities assigned to them: enter and submit
 *   verifier        read-only, whole company (auditors)
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { platformTx, type Tx } from '../db/pool.js';
import { AppError, forbidden } from './errors.js';
import { sha256 } from './password.js';

export type Role = 'platform_admin' | 'super_admin' | 'admin' | 'manager' | 'preparer' | 'verifier';
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** company the request acts on (platform admin: the one chosen in the x-tenant-id header) */
  tenantId: string | null;
  scopeNodeId: string | null;
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest { user: User }
}

export const COOKIE = 'eko_sid';
export const SESSION_HOURS = 12;
/** A session ends after this many minutes without any request (BEEAH standard 4.9: inactivity timeout). */
export const IDLE_MINUTES = Number(process.env.IDLE_MINUTES ?? 30);

export function readCookie(req: FastifyRequest, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSessionCookie(reply: FastifyReply, token: string | null, secure: boolean) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : ''].filter(Boolean).join('; ');
  reply.header('set-cookie', token ? `${COOKIE}=${token}; ${attrs}; Max-Age=${SESSION_HOURS * 3600}` : `${COOKIE}=; ${attrs}; Max-Age=0`);
}

/** onRequest hook for every protected route. */
export async function authenticate(req: FastifyRequest) {
  // Changes must come as JSON (or a file upload): a plain HTML form on another site cannot send these.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const ct = String(req.headers['content-type'] ?? '');
    if (req.method !== 'DELETE' && !/^application\/(json|octet-stream)/.test(ct)) throw new AppError('Unsupported request', 415, 'UNSUPPORTED');
  }
  const token = readCookie(req, COOKIE);
  if (!token) throw new AppError('Please log in', 401, 'UNAUTHENTICATED');
  const row = await platformTx(async (c) => (await c.query(
    `UPDATE session s SET last_seen_at = now()
       FROM app_user u
      WHERE s.token_hash = $1 AND u.id = s.user_id AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(mins => $2) AND NOT u.disabled
      RETURNING u.id, u.name, u.email, u.role, u.tenant_id, u.scope_node_id, u.must_change_password`, [sha256(token), IDLE_MINUTES])).rows[0]);
  if (!row) throw new AppError('Your session has ended — please log in again', 401, 'UNAUTHENTICATED');

  let tenantId: string | null = row.tenant_id;
  if (row.role === 'platform_admin') {
    const t = req.headers['x-tenant-id'];
    tenantId = typeof t === 'string' && /^[0-9a-f-]{36}$/i.test(t) ? t : null;
  }
  req.user = { id: row.id, name: row.name, email: row.email, role: row.role, tenantId, scopeNodeId: row.scope_node_id, mustChangePassword: row.must_change_password };
  // A temporary password must be changed before anything else.
  if (row.must_change_password && !req.url.startsWith('/api/auth/')) throw new AppError('Please set your own password first', 403, 'MUST_CHANGE_PASSWORD');
}

export function requireRole(req: FastifyRequest, ...roles: Role[]) {
  if (req.user.role === 'platform_admin' || roles.includes(req.user.role)) return;
  throw forbidden();
}

/** Only platform staff may change the shared catalogue, units and factors. */
export function requirePlatformAdmin(req: FastifyRequest) {
  if (req.user.role !== 'platform_admin') throw forbidden('Only the platform administrator can do this');
}

export function requireTenant(req: FastifyRequest): string {
  if (!req.user.tenantId) throw new AppError('Choose a company first', 400, 'NO_TENANT');
  return req.user.tenantId;
}

/** Write one line to the audit log (inside the caller's transaction when given). */
export async function audit(c: Tx, req: FastifyRequest, action: string, entity?: string, entityId?: string | number | null, detail?: unknown) {
  await c.query(
    'INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [req.user?.tenantId ?? null, req.user?.id ?? null, req.user?.name ?? null, action, entity ?? null, entityId != null ? String(entityId) : null, detail ? JSON.stringify(detail) : null, req.ip],
  );
}
