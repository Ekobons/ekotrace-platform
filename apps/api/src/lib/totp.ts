/**
 * Time-based one-time passwords (RFC 6238, as used by Microsoft Authenticator, Google Authenticator,
 * 1Password…): 6 digits, 30-second steps, HMAC-SHA1, one step of clock drift either way. A step that
 * was used once is refused afterwards (no replay).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer): string {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out: number[] = [];
  for (const ch of clean) { val = (val << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32(randomBytes(20));
export function codeAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
export const stepNow = (t = Date.now()) => Math.floor(t / 30_000);
/** The step the code belongs to, or null (wrong, or already used). */
export function checkCode(secret: string, code: string, lastStep: number | null, t = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepNow(t);
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(code))) return s;
  }
  return null;
}
export function otpauthUri(secret: string, account: string, issuer: string) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
/** Ten recovery codes like 7KQ2-M9XD-4TPA (shown once; only their SHA-256 is kept). */
export function recoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => base32(randomBytes(8)).slice(0, 12).replace(/(.{4})(?=.)/g, '$1-'));
}
