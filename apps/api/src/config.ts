/**
 * Settings come from environment variables (a .env file locally, the server's
 * secret store in production). Nothing secret is ever written in code.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// Minimal .env loader (no dependency): KEY=value lines, # comments.
const envFile = resolve(process.cwd(), '.env');
const rootEnv = resolve(process.cwd(), '../../.env');
for (const f of [envFile, rootEnv]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  break;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing setting ${name} (see .env.example)`);
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 4000),
  brand: process.env.BRAND ?? 'ekotrace',
  /** 127.0.0.1 = only this computer can connect (laptop). Servers set HOST=0.0.0.0 behind HTTPS. */
  host: process.env.HOST ?? '127.0.0.1',
  dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 20),
  /** signs API access tokens (OAuth 2.0 client credentials). Set it on servers; without it tokens end when the server restarts. */
  tokenSecret: process.env.TOKEN_SECRET ?? randomBytes(32).toString('hex'),
  /** HTTPS in front (servers): adds Strict-Transport-Security */
  https: process.env.HTTPS === 'true',
  /** background jobs (large uploads, mapping, publishing) run in this process; WORKER=off on API-only servers */
  worker: process.env.WORKER !== 'off',
  /**
   * Optional AI mapping of purchase descriptions: an OpenAI-compatible chat endpoint the client has
   * approved (e.g. a model hosted in the UAE). Off unless all three are set AND the company switches it on.
   * Only descriptions, category texts and candidate category names are sent: never amounts, suppliers or files.
   */
  aiMap: process.env.AI_MAP_URL && process.env.AI_MAP_KEY && process.env.AI_MAP_MODEL
    ? { url: process.env.AI_MAP_URL.replace(/\/$/, ''), key: process.env.AI_MAP_KEY, model: process.env.AI_MAP_MODEL, name: process.env.AI_MAP_NAME ?? 'AI service' } : null,
  /**
   * Security settings (BEEAH web application security standard).
   *   TRUST_PROXY      the load balancer / WAF in front: "true", a hop count, or its addresses — the real
   *                    client address then comes from X-Forwarded-For (rate limits, audit log).
   *   DATA_KEY         32-byte key (64 hex characters) encrypting MFA and SSO secrets (AES-256-GCM). Keep it
   *                    in the server's secret store; without it a key file (.data-key) is made on first start.
   *   REQUIRE_ADMIN_MFA  platform admins must use MFA (default: on when HTTPS=true).
   *   RATE_LIMIT       "off" to switch rate limiting off (tests); RATE_LIMIT_USER / _IP / _LOGIN per minute.
   *   AUDIT_RETENTION_MONTHS  audit records kept (minimum 12, default 24).
   *   SIEM_SYSLOG      forward audit events: udp://host:514, tcp://host:514 or tls://host:6514 (RFC 5424).
   *   SIEM_TLS_CA      CA certificate file for tls:// (optional).
   *   BACKUP_RETENTION_DAYS  how long encrypted backups are kept (stated on destruction certificates).
   *   SECURITY_CONTACT where outsiders report vulnerabilities (/.well-known/security.txt).
   */
  trustProxy: (() => { const v = process.env.TRUST_PROXY; if (!v || v === 'false') return false; if (v === 'true') return true; return /^\d+$/.test(v) ? Number(v) : v; })() as boolean | number | string,
  requireAdminMfa: process.env.REQUIRE_ADMIN_MFA ? process.env.REQUIRE_ADMIN_MFA === 'true' : process.env.HTTPS === 'true',
  rateLimit: process.env.RATE_LIMIT === 'off' ? null : {
    user: Number(process.env.RATE_LIMIT_USER ?? 600), ip: Number(process.env.RATE_LIMIT_IP ?? 300), login: Number(process.env.RATE_LIMIT_LOGIN ?? 20),
  },
  auditRetentionMonths: Math.max(12, Number(process.env.AUDIT_RETENTION_MONTHS ?? 24)),
  siemSyslog: process.env.SIEM_SYSLOG ?? null,
  siemTlsCa: process.env.SIEM_TLS_CA ?? null,
  backupRetentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? 35),
  securityContact: process.env.SECURITY_CONTACT ?? null,
  /**
   * Platform administrators (Ekobon staff) sign in through Ekobon's own identity provider (OpenID Connect).
   *   PLATFORM_SSO_ISSUER, PLATFORM_SSO_CLIENT_ID, PLATFORM_SSO_CLIENT_SECRET, PLATFORM_SSO_DOMAINS (e.g. ekobon.com)
   *   PLATFORM_SSO_ONLY=true      no password sign-in for platform admins…
   *   PLATFORM_BREAKGLASS=a@x,b@y …except these accounts, which must use MFA (when the provider is down)
   */
  platformSso: process.env.PLATFORM_SSO_ISSUER && process.env.PLATFORM_SSO_CLIENT_ID ? {
    issuer: process.env.PLATFORM_SSO_ISSUER.replace(/\/$/, ''), clientId: process.env.PLATFORM_SSO_CLIENT_ID, clientSecret: process.env.PLATFORM_SSO_CLIENT_SECRET ?? null,
    domains: (process.env.PLATFORM_SSO_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
    only: process.env.PLATFORM_SSO_ONLY === 'true',
    breakGlass: (process.env.PLATFORM_BREAKGLASS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean),
  } as { issuer: string; clientId: string; clientSecret: string | null; domains: string[]; only: boolean; breakGlass: string[] } | null : null,
  /**
   * E-mail (reminders, escalations, sent-back entries). Without SMTP_URL nothing is sent: messages are
   * kept as "held" and people still see them in Inbox & to-dos.
   *   SMTP_URL   smtps://user:password@mail.example.com:465 or smtp://user:password@host:587 (STARTTLS is required
   *              except on this computer); keep it in the secret store
   *   MAIL_FROM  "Ekotrace <no-reply@example.com>"
   */
  smtpUrl: process.env.SMTP_URL ?? null,
  mailFrom: process.env.MAIL_FROM ?? 'Ekotrace <no-reply@ekotrace.local>',
  /** the address people open Ekotrace at (SSO sends people back here), e.g. https://ekotrace.example.com */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/$/, '') || null,
};
