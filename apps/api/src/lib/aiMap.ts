/**
 * AI step for mapping purchase descriptions to spend categories (lib/ai: the company's AI connection).
 *
 * Runs only when the company has AI switched on and connected (Setup → Integrations → AI), on the
 * Professional or Enterprise plan. For each description the model may only choose among the candidates
 * found by the text matcher (or none), so it cannot invent a category. What is sent: the description,
 * the category text / account title from the file, and candidate category names — never amounts,
 * supplier names, people or the file itself.
 */
import { aiChat, jsonOf, type AiConfig } from './ai.js';

export interface AiGroup { key: string; text: string; candidates: { id: number; name: string }[] }
export interface AiChoice { key: string; itemId: number | null; confidence: number }

const CHUNK = 40;
const SYSTEM = 'You classify company purchase lines into spend categories for greenhouse-gas accounting. For each line choose the single best category id from its candidates, or null if none fits. Reply with JSON only: {"results":[{"key":"…","id":123 or null,"confidence":0.0-1.0}]}';

export async function aiChoose(cfg: AiConfig, groups: AiGroup[], opts: { timeoutMs?: number } = {}): Promise<AiChoice[]> {
  const out: AiChoice[] = [];
  for (let i = 0; i < groups.length; i += CHUNK) {
    const part = groups.slice(i, i + CHUNK).filter((g) => g.candidates.length);
    if (!part.length) continue;
    const text = await aiChat(cfg, SYSTEM, JSON.stringify(part.map((g) => ({ key: g.key, line: g.text.slice(0, 300), candidates: g.candidates.map((c) => ({ id: c.id, name: c.name })) }))), { json: true, timeoutMs: opts.timeoutMs });
    let parsed: { results?: { key: string; id: number | null; confidence?: number }[] };
    try { parsed = jsonOf(text); } catch { throw new Error(`${cfg.name}: the answer was not JSON`); }
    for (const r of parsed.results ?? []) {
      const g = part.find((x) => x.key === r.key);
      if (!g) continue;
      const ok = r.id != null && g.candidates.some((c) => c.id === r.id);   // only a candidate may be chosen
      out.push({ key: g.key, itemId: ok ? r.id : null, confidence: ok ? Math.max(0, Math.min(1, Number(r.confidence ?? 0.7))) : 0 });
    }
  }
  return out;
}
