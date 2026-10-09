/**
 * Who is calling. TEMPORARY: login (passwords, SSO, MFA) is the next step.
 *
 * Until then, with DEV_AUTH=true (laptop only) every request acts as a
 * platform admin, and the client is chosen with the `x-tenant-id` header.
 * With DEV_AUTH=false every request is refused, so this can never be
 * deployed open by mistake.
 */
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { AppError, forbidden } from './errors.js';

export type Role = 'platform_admin' | 'super_admin' | 'admin' | 'manager' | 'preparer' | 'verifier';
export interface User { id: string; role: Role; tenantId: string | null }

declare module 'fastify' {
  interface FastifyRequest { user: User }
}

export async function authenticate(req: FastifyRequest) {
  if (!config.devAuth) throw new AppError('Login required', 401, 'UNAUTHENTICATED');
  const t = req.headers['x-tenant-id'];
  req.user = { id: 'dev-user', role: 'platform_admin', tenantId: typeof t === 'string' && t ? t : null };
}

/** Only platform staff may change the shared catalogue, units and factors. */
export function requirePlatformAdmin(req: FastifyRequest) {
  if (req.user.role !== 'platform_admin') throw forbidden('Only the platform administrator can change the shared factor library');
}

export function requireTenant(req: FastifyRequest): string {
  if (!req.user.tenantId) throw new AppError('Choose a company first', 400, 'NO_TENANT');
  return req.user.tenantId;
}
