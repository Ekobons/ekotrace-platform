/**
 * Rate limiting on every API request (BEEAH standard 4.3 / 4.7): per signed-in session, per client
 * address when not signed in, and a tighter limit per address on sign-in. Counted per minute in this
 * server process; with several servers, the WAF / anti-DDoS service in front adds a shared limit.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { COOKIE, readCookie } from './auth.js';

export interface Limits { user: number; ip: number; login: number }
const LOGIN = /^\/api\/(auth\/(login|mfa|sso\/start)|v1\/oauth\/token|public\/(contractor|survey)\/(login|start|code))/;

export function rateLimiter(limits: Limits) {
  const win = new Map<string, { start: number; n: number }>();
  let swept = Date.now();
  return async function limit(req: FastifyRequest, reply: FastifyReply) {
    if (!req.url.startsWith('/api/')) return;
    const now = Date.now();
    if (now - swept > 60_000) { for (const [k, w] of win) if (now - w.start > 60_000) win.delete(k); swept = now; }
    const checks: [string, number][] = [];
    if (LOGIN.test(req.url)) checks.push([`login:${req.ip}`, limits.login]);
    const sid = readCookie(req, COOKIE) ?? (/^Bearer\s+(\S+)/.exec(String(req.headers.authorization ?? ''))?.[1] ?? null);
    checks.push(sid ? [`s:${createHash('sha256').update(sid).digest('hex').slice(0, 32)}`, limits.user] : [`ip:${req.ip}`, limits.ip]);
    for (const [k, max] of checks) {
      let w = win.get(k);
      if (!w || now - w.start >= 60_000) { w = { start: now, n: 0 }; win.set(k, w); }
      w.n++;
      if (w.n > max) {
        const retry = Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000));
        reply.header('Retry-After', String(retry));
        return reply.code(429).send({ error: 'RATE_LIMITED', message: `Too many requests. Please wait ${retry} seconds.` });
      }
      if (k.startsWith('s:') || k.startsWith('ip:')) { reply.header('RateLimit-Limit', String(max)); reply.header('RateLimit-Remaining', String(Math.max(0, max - w.n))); }
    }
  };
}
