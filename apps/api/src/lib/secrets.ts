/**
 * Encryption of secrets stored in the database (MFA seeds, SSO client secrets): AES-256-GCM with
 * a server key (DATA_KEY, 64 hex characters, from the secret store). Without DATA_KEY a key file
 * (.data-key, readable by the server account only) is made on first start and reused.
 * Stored format: v1:<iv base64>:<tag base64>:<ciphertext base64>
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

let key: Buffer | null = null;
function dataKey(): Buffer {
  if (key) return key;
  const env = process.env.DATA_KEY;
  if (env) {
    const k = Buffer.from(env, /^[0-9a-f]{64}$/i.test(env) ? 'hex' : 'base64');
    if (k.length !== 32) throw new Error('DATA_KEY must be 32 bytes (64 hex characters)');
    return (key = k);
  }
  const f = resolve(process.cwd(), '.data-key');
  if (!existsSync(f)) {
    writeFileSync(f, randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn(`[security] DATA_KEY is not set: a key was made in ${f}. On servers put DATA_KEY in the secret store instead.`);
  }
  return (key = Buffer.from(readFileSync(f, 'utf8').trim(), 'hex'));
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dataKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}
export function decrypt(stored: string): string {
  const [v, iv, tag, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', dataKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
