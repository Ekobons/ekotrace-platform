/**
 * Settings come from environment variables (a .env file locally, the server's
 * secret store in production). Nothing secret is ever written in code.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
  devAuth: /^(1|true|yes)$/i.test(process.env.DEV_AUTH ?? ''),
  dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 20),
};
