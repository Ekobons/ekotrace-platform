/**
 * Password hashing with scrypt (built into Node; no extra package).
 * Parameters follow OWASP guidance for scrypt: N = 2^17, r = 8, p = 1.
 * Stored format: scrypt$N$r$p$salt(base64)$hash(base64)
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 2 ** 17, R = 8, P = 1, LEN = 32;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Password rules: long enough to resist guessing; no other composition rules (NIST 800-63B). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters';
  if (pw.length > 200) return 'Too long';
  if (/^(.)\1+$/.test(pw)) return 'Too simple';
  return null;
}

/** A readable random password for new accounts (shown once, must be changed at first login). */
export function temporaryPassword(): string {
  const words = randomBytes(12).toString('base64url');
  return `Eko-${words.slice(0, 6)}-${words.slice(6, 12)}`;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
