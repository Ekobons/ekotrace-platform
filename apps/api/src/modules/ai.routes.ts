/**
 * AI connection of the company (Setup → Integrations → AI), super admin only.
 *
 *   GET  /api/ai/settings     provider, model, address, key hint, when AI runs, plan, last test
 *   PUT  /api/ai/settings     change them; a new key replaces the old one (omit it to keep the old one)
 *   POST /api/ai/test         a small request to the service: is it reachable and does it answer in JSON?
 *
 * The key is encrypted at rest and never returned (only its last 4 characters). Every change is in the audit
 * log without the key.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { encrypt, decrypt } from '../lib/secrets.js';
import { planOf } from '../lib/plans.js';
import { config } from '../config.js';
import { AI_PROVIDERS, aiChat, checkAddress, configOf, jsonOf, type AiProvider } from '../lib/ai.js';

const PROVIDERS = Object.keys(AI_PROVIDERS) as [AiProvider, ...AiProvider[]];

export async function aiRoutes(app: FastifyInstance) {
  app.get('/api/ai/settings', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin');
    return tenantTx(tenant, async (c) => {
      const t = (await c.query(`SELECT ai_mapping, ai_provider, ai_model, ai_base_url, ai_key_hint, ai_purchases, ai_max_groups, ai_import, ai_tested_at, ai_test_ok, ai_updated_by FROM tenant WHERE id = $1`, [tenant])).rows[0];
      const plan = await planOf(c, tenant);
      return {
        enabled: t.ai_mapping, provider: t.ai_provider, model: t.ai_model, baseUrl: t.ai_base_url, keyHint: t.ai_key_hint, purchases: t.ai_purchases, maxGroups: t.ai_max_groups, importAllowed: t.ai_import,
        testedAt: t.ai_tested_at, testOk: t.ai_test_ok, updatedBy: t.ai_updated_by, onPlan: plan.ai, planName: plan.name,
        providers: Object.entries(AI_PROVIDERS).filter(([k]) => k !== 'platform' || config.aiMap).map(([k, v]) => ({ code: k, ...v, url: v.needsUrl ? null : v.url, name: k === 'platform' ? `${v.name}: ${config.aiMap?.name}` : v.name })),
      };
    });
  });

  app.put('/api/ai/settings', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin');
    const b = z.object({
      enabled: z.boolean(), provider: z.enum(PROVIDERS).nullable(), model: z.string().trim().max(120).nullable().default(null),
      baseUrl: z.string().trim().max(500).nullable().default(null), key: z.string().trim().min(8).max(500).optional(),
      purchases: z.enum(['off', 'large', 'unidentified']).default('large'), maxGroups: z.number().int().min(1).max(5000).default(300), importAllowed: z.boolean().default(true),
    }).parse(req.body);
    if (b.provider === 'platform' && !config.aiMap) throw new AppError('No platform AI service on this server');
    if (b.provider && AI_PROVIDERS[b.provider].needsUrl) {
      if (!b.baseUrl) throw new AppError('Enter the address of the service');
      const bad = await checkAddress(b.baseUrl); if (bad) throw new AppError(bad);
    }
    if (b.provider && b.provider !== 'platform' && !b.model) throw new AppError('Enter the model name');
    return tenantTx(tenant, async (c) => {
      if (b.enabled) {
        if (!(await planOf(c, tenant)).ai) throw new AppError('AI is not on this plan (Professional and above)', 403, 'PLAN_LIMIT');
        if (!b.provider) throw new AppError('Choose an AI service first');
      }
      const cur = (await c.query(`SELECT ai_provider, ai_key FROM tenant WHERE id = $1`, [tenant])).rows[0];
      // a key belongs to its provider: changing the provider without a new key drops the old one
      const keepKey = !b.key && cur.ai_key && cur.ai_provider === b.provider;
      if (b.enabled && b.provider !== 'platform' && !b.key && !keepKey) throw new AppError('Enter the API key');
      const key = b.provider === 'platform' || !b.provider ? null : b.key ? encrypt(b.key) : keepKey ? cur.ai_key : null;
      const hint = b.key ? `…${b.key.slice(-4)}` : keepKey ? undefined : null;
      await c.query(
        `UPDATE tenant SET ai_mapping = $2, ai_provider = $3, ai_model = $4, ai_base_url = $5, ai_key = $6, ai_key_hint = CASE WHEN $7::boolean THEN ai_key_hint ELSE $8 END,
                ai_purchases = $9, ai_max_groups = $10, ai_updated_by = $11, ai_import = $13, ai_tested_at = CASE WHEN $12::boolean THEN ai_tested_at END, ai_test_ok = CASE WHEN $12::boolean THEN ai_test_ok END WHERE id = $1`,
        [tenant, b.enabled, b.provider, b.provider === 'platform' ? null : b.model, b.provider && AI_PROVIDERS[b.provider].needsUrl ? b.baseUrl : null, key,
         hint === undefined, hint ?? null, b.purchases, b.maxGroups, req.user.name, !b.key && cur.ai_provider === b.provider, b.importAllowed]);
      const { key: _k, ...logged } = b; void _k;
      await audit(c, req, 'ai.settings', 'tenant', tenant, { ...logged, keyChanged: !!b.key });
      return { ok: true };
    });
  });

  app.post('/api/ai/test', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin');
    const t = await tenantTx(tenant, async (c) => (await c.query(`SELECT ai_provider, ai_model, ai_base_url, ai_key FROM tenant WHERE id = $1`, [tenant])).rows[0]);
    if (!t.ai_provider) throw new AppError('Choose and save an AI service first');
    const cfg = configOf(t.ai_provider, t.ai_model, t.ai_base_url, t.ai_key ? decrypt(t.ai_key) : null);
    if (!cfg) throw new AppError('The connection is incomplete: provider, model, key (and address) are needed');
    const t0 = Date.now();
    let ok = false, message: string;
    try {
      const text = await aiChat(cfg, 'Reply with JSON only.', 'Classify "copier paper A4" into one of: [{"id":1,"name":"Stationery and office supplies"},{"id":2,"name":"Ready-mix concrete"}]. Reply {"id": <id>}.', { json: true, timeoutMs: 30_000, maxTokens: 50 });
      const j = jsonOf<{ id?: number }>(text);
      ok = j.id === 1;
      message = ok ? `${cfg.name} answered correctly in ${((Date.now() - t0) / 1000).toFixed(1)} s` : `${cfg.name} answered, but not as expected: ${text.slice(0, 120)}`;
    } catch (e) { message = (e as Error).message; }
    await tenantTx(tenant, async (c) => {
      await c.query(`UPDATE tenant SET ai_tested_at = now(), ai_test_ok = $2 WHERE id = $1`, [tenant, ok]);
      await audit(c, req, 'ai.test', 'tenant', tenant, { ok, message });
    });
    return { ok, message };
  });
}
