/**
 * The company's AI connection (Setup → Integrations → AI): its own Claude (Anthropic), ChatGPT (OpenAI), Gemini
 * (Google), Azure OpenAI or any OpenAI-compatible service (e.g. a model hosted in-country), or the platform's
 * approved service (AI_MAP_* in the server settings). The key is stored encrypted and never sent back.
 *
 * What is sent is decided by the caller and kept small: for purchase mapping, descriptions, category texts and
 * candidate category names — never amounts, suppliers, people or files.
 *
 * Addresses: a custom address must be https and must not point into a private network (no requests to the
 * server's own network on a company's say-so); AI_ALLOW_PRIVATE_URLS=true lifts this for tests and on-premise
 * models.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Tx } from '../db/pool.js';
import { config } from '../config.js';
import { decrypt } from './secrets.js';
import { planOf } from './plans.js';

export type AiProvider = 'platform' | 'anthropic' | 'openai' | 'gemini' | 'azure' | 'compatible';
export const AI_PROVIDERS: Record<AiProvider, { name: string; url: string | null; models: string[]; needsUrl: boolean; note: string }> = {
  anthropic: { name: 'Claude (Anthropic)', url: 'https://api.anthropic.com/v1/messages', models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'], needsUrl: false, note: 'API key from console.anthropic.com' },
  openai: { name: 'ChatGPT (OpenAI)', url: 'https://api.openai.com/v1/chat/completions', models: [], needsUrl: false, note: 'API key from platform.openai.com; enter the model name from your account' },
  gemini: { name: 'Gemini (Google)', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: [], needsUrl: false, note: 'API key from Google AI Studio; enter the model name' },
  azure: { name: 'Azure OpenAI', url: null, models: [], needsUrl: true, note: 'The chat-completions address of your deployment (…/openai/deployments/<name>/chat/completions?api-version=…) and its key; your data stays in your Azure region' },
  compatible: { name: 'Other (OpenAI-compatible)', url: null, models: [], needsUrl: true, note: 'Any service with an OpenAI-style /chat/completions address, e.g. a model hosted in-country' },
  platform: { name: 'Platform AI service', url: null, models: [], needsUrl: false, note: 'The service approved by the platform operator (no key needed)' },
};

export interface AiConfig { provider: AiProvider; name: string; url: string; key: string; model: string; style: 'anthropic' | 'openai' | 'azure' }

/** The company's AI connection, or null when AI is off, not set up or not on its plan. */
export async function tenantAi(c: Tx, tenant: string): Promise<(AiConfig & { purchases: 'off' | 'large' | 'unidentified'; maxGroups: number }) | null> {
  const t = (await c.query(`SELECT ai_mapping, ai_provider, ai_model, ai_base_url, ai_key, ai_purchases, ai_max_groups FROM tenant WHERE id = $1`, [tenant])).rows[0];
  if (!t?.ai_mapping || !t.ai_provider || !(await planOf(c, tenant)).ai) return null;
  const cfg = configOf(t.ai_provider, t.ai_model, t.ai_base_url, t.ai_key ? decrypt(t.ai_key) : null);
  return cfg ? { ...cfg, purchases: t.ai_purchases, maxGroups: t.ai_max_groups } : null;
}

export function configOf(provider: AiProvider, model: string | null, baseUrl: string | null, key: string | null): AiConfig | null {
  if (provider === 'platform') {
    const p = config.aiMap;
    return p ? { provider, name: p.name, url: `${p.url}/chat/completions`, key: p.key, model: p.model, style: 'openai' } : null;
  }
  const P = AI_PROVIDERS[provider];
  const url = P.needsUrl ? baseUrl : P.url;
  if (!url || !key || !model) return null;
  return { provider, name: P.name, url, key, model, style: provider === 'anthropic' ? 'anthropic' : provider === 'azure' ? 'azure' : 'openai' };
}

const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\./];
/** A custom address must be https and must not resolve into a private network. */
export async function checkAddress(raw: string): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return 'Not a valid address'; }
  if (process.env.AI_ALLOW_PRIVATE_URLS === 'true') return null;
  if (u.protocol !== 'https:') return 'The address must start with https://';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'Addresses inside a private network are not allowed';
  const addrs = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((x) => x.address)).catch(() => null);
  if (!addrs) return 'The address could not be found';
  if (addrs.some((a) => PRIVATE.some((re) => re.test(a)))) return 'Addresses inside a private network are not allowed';
  return null;
}

/** One request: a system instruction and a user message; the answer's text. */
export async function aiChat(cfg: AiConfig, system: string, user: string, opts: { timeoutMs?: number; maxTokens?: number; json?: boolean } = {}): Promise<string> {
  if (cfg.provider === 'azure' || cfg.provider === 'compatible') { const bad = await checkAddress(cfg.url); if (bad) throw new Error(bad); }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
  try {
    if (cfg.style === 'anthropic') {
      const res = await fetch(cfg.url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, max_tokens: opts.maxTokens ?? 4000, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      });
      if (!res.ok) throw new Error(`${cfg.name} answered ${res.status}${await errText(res)}`);
      const j = await res.json() as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter((x) => x.type === 'text').map((x) => x.text ?? '').join('');
    }
    const res = await fetch(cfg.url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', ...(cfg.style === 'azure' ? { 'api-key': cfg.key } : { authorization: `Bearer ${cfg.key}` }) },
      body: JSON.stringify({ model: cfg.model, temperature: 0, max_tokens: opts.maxTokens ?? 4000, ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) throw new Error(`${cfg.name} answered ${res.status}${await errText(res)}`);
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`${cfg.name} did not answer in time`);
    throw e;
  } finally { clearTimeout(t); }
}
async function errText(res: Response) {
  try { const j = await res.json() as { error?: { message?: string } | string }; const m = typeof j.error === 'string' ? j.error : j.error?.message; return m ? `: ${String(m).slice(0, 200)}` : ''; } catch { return ''; }
}

/** The JSON object in an answer (models sometimes wrap it in text or a code block). */
export function jsonOf<T>(text: string): T {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The answer was not JSON');
  return JSON.parse(text.slice(a, b + 1)) as T;
}
