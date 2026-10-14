/**
 * Single sign-on with the company's identity provider over OpenID Connect (Microsoft Entra ID,
 * Okta, Google Workspace, Ping, ADFS…): authorization code flow with PKCE (S256), state and nonce.
 *
 * The ID token is checked here: signature (RS256 / PS256 / ES256 against the provider's published
 * keys), issuer, audience, expiry and nonce. The provider's addresses must be https (http only for a
 * provider on this computer in development), and must not point at private network addresses on servers.
 */
import { createHash, createPublicKey, randomBytes, verify as cverify, constants, type JsonWebKey } from 'node:crypto';
import { isIP } from 'node:net';
import { config } from '../config.js';

export interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; end_session_endpoint?: string }
const cache = new Map<string, { at: number; d: Discovery }>();
const keys = new Map<string, { at: number; keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[] }>();

function privateHost(h: string) {
  const host = h.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (!isIP(host)) return false;
  return /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1' || /^f[cd]/i.test(host) || /^fe80/i.test(host);
}
/** An address of the identity provider: https, a public host (dev: http on localhost allowed). */
export function checkUrl(u: string): URL {
  let url: URL;
  try { url = new URL(u); } catch { throw new Error(`Not a valid address: ${u}`); }
  const local = privateHost(url.hostname);
  if (config.https || process.env.NODE_ENV === 'production') {
    if (url.protocol !== 'https:') throw new Error('The identity provider must use https');
    if (local) throw new Error('The identity provider cannot be on a private network address');
  } else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('The identity provider must use https');
  if (url.username || url.password) throw new Error('No user name or password in the address');
  return url;
}

async function getJson(u: string, init?: RequestInit) {
  checkUrl(u);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(u, { ...init, redirect: 'error', signal: ctl.signal, headers: { accept: 'application/json', ...(init?.headers ?? {}) } });
    const text = await r.text();
    if (text.length > 1_000_000) throw new Error('Answer too large');
    const j = JSON.parse(text || '{}');
    if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(t); }
}

export async function discover(issuer: string): Promise<Discovery> {
  const iss = issuer.replace(/\/$/, '');
  const hit = cache.get(iss);
  if (hit && Date.now() - hit.at < 3600e3) return hit.d;
  const d = await getJson(`${iss}/.well-known/openid-configuration`) as Discovery;
  for (const k of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) if (!d[k]) throw new Error(`The provider's configuration has no ${k}`);
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) checkUrl(d[k]);
  if (d.issuer.replace(/\/$/, '') !== iss) throw new Error(`The provider says its issuer is ${d.issuer}, not ${iss}`);
  cache.set(iss, { at: Date.now(), d });
  return d;
}

const b64u = (b: Buffer) => b.toString('base64url');
export function newFlow() {
  const verifier = b64u(randomBytes(32));
  return { state: b64u(randomBytes(24)), nonce: b64u(randomBytes(16)), verifier, challenge: b64u(createHash('sha256').update(verifier).digest()) };
}
export function authorizeUrl(d: Discovery, p: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; loginHint?: string }) {
  const q = new URLSearchParams({ response_type: 'code', client_id: p.clientId, redirect_uri: p.redirectUri, scope: 'openid email profile', state: p.state, nonce: p.nonce,
    code_challenge: p.challenge, code_challenge_method: 'S256', response_mode: 'query', ...(p.loginHint ? { login_hint: p.loginHint } : {}) });
  return `${d.authorization_endpoint}${d.authorization_endpoint.includes('?') ? '&' : '?'}${q}`;
}

export async function exchange(d: Discovery, p: { clientId: string; clientSecret: string | null; code: string; redirectUri: string; verifier: string }): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier });
  if (p.clientSecret) body.set('client_secret', p.clientSecret);
  const j = await getJson(d.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (typeof j.id_token !== 'string') throw new Error('The provider sent no ID token');
  return j.id_token;
}

async function jwks(d: Discovery, refresh = false) {
  const hit = keys.get(d.jwks_uri);
  if (hit && !refresh && Date.now() - hit.at < 3600e3) return hit.keys;
  const j = await getJson(d.jwks_uri);
  if (!Array.isArray(j.keys)) throw new Error('The provider published no signing keys');
  keys.set(d.jwks_uri, { at: Date.now(), keys: j.keys });
  return j.keys as (JsonWebKey & { kid?: string; alg?: string; use?: string })[];
}

export interface IdClaims { iss: string; aud: string | string[]; sub: string; exp: number; iat?: number; nbf?: number; nonce?: string; email?: string; preferred_username?: string; upn?: string; name?: string; amr?: string[]; acr?: string; tid?: string }
const ALGS: Record<string, { hash: string; pss?: boolean; ec?: boolean }> = { RS256: { hash: 'sha256' }, PS256: { hash: 'sha256', pss: true }, ES256: { hash: 'sha256', ec: true } };

export async function verifyIdToken(d: Discovery, token: string, p: { clientId: string; nonce: string; now?: number }): Promise<IdClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
  const alg = ALGS[header.alg];
  if (!alg) throw new Error(`ID token signed with ${header.alg}: not accepted`);
  let list = await jwks(d);
  let jwk = list.find((k) => (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig'));
  if (!jwk) { list = await jwks(d, true); jwk = list.find((k) => (!header.kid || k.kid === header.kid) && (!k.use || k.use === 'sig')); }
  if (!jwk) throw new Error('The ID token was signed with an unknown key');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2]!, 'base64url');
  const ok = alg.ec ? cverify(alg.hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig)
    : cverify(alg.hash, data, alg.pss ? { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } : key, sig);
  if (!ok) throw new Error('The ID token signature is not valid');
  const c = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as IdClaims;
  const now = Math.floor((p.now ?? Date.now()) / 1000), skew = 300;
  if (c.iss !== d.issuer) throw new Error('The ID token is from another issuer');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(p.clientId)) throw new Error('The ID token is for another application');
  if (typeof c.exp !== 'number' || c.exp + skew < now) throw new Error('The ID token has expired');
  if (c.nbf && c.nbf - skew > now) throw new Error('The ID token is not valid yet');
  if (c.iat && c.iat - skew > now) throw new Error('The ID token was issued in the future');
  if (c.nonce !== p.nonce) throw new Error('The sign-in does not match (nonce)');
  return c;
}

/** The person's email from the token (Entra: email, else preferred_username / upn). */
export const emailOf = (c: IdClaims) => (c.email || c.preferred_username || c.upn || '').toLowerCase();
/** Did the provider report a second factor? (amr "mfa", or an MFA-level acr) */
export const usedMfa = (c: IdClaims) => (c.amr ?? []).some((m) => ['mfa', 'otp', 'hwk', 'swk', 'fido', 'sms', 'face', 'fpt', 'pop'].includes(m)) || /mfa|multi|possession/i.test(c.acr ?? '');
