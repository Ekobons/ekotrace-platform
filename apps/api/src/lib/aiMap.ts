/**
 * Optional AI step for mapping purchase descriptions to spend categories.
 *
 * Runs only when the deployment has an approved AI endpoint (AI_MAP_URL / AI_MAP_KEY /
 * AI_MAP_MODEL, any OpenAI-compatible chat API) AND the company has switched it on.
 * For each description the model may only choose among the candidates found by the text
 * matcher (or none), so it cannot invent a category. What is sent: the description, the
 * category text / GL title from the file, and candidate category names — never amounts,
 * supplier names, people or the file itself.
 */
import { config } from '../config.js';

export interface AiGroup { key: string; text: string; candidates: { id: number; name: string }[] }
export interface AiChoice { key: string; itemId: number | null; confidence: number }

const CHUNK = 40;

export async function aiChoose(groups: AiGroup[], opts: { timeoutMs?: number } = {}): Promise<AiChoice[]> {
  const ai = config.aiMap;
  if (!ai) throw new Error('No AI service configured');
  const out: AiChoice[] = [];
  for (let i = 0; i < groups.length; i += CHUNK) {
    const part = groups.slice(i, i + CHUNK).filter((g) => g.candidates.length);
    if (!part.length) continue;
    const body = {
      model: ai.model, temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You classify company purchase lines into spend categories for greenhouse-gas accounting. For each line choose the single best category id from its candidates, or null if none fits. Reply with JSON only: {"results":[{"key":"…","id":123 or null,"confidence":0.0-1.0}]}' },
        { role: 'user', content: JSON.stringify(part.map((g) => ({ key: g.key, line: g.text.slice(0, 300), candidates: g.candidates.map((c) => ({ id: c.id, name: c.name })) }))) },
      ],
    };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${ai.url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` }, body: JSON.stringify(body), signal: ctl.signal });
    } finally { clearTimeout(t); }
    if (!res.ok) throw new Error(`${ai.name} answered ${res.status}`);
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    let parsed: { results?: { key: string; id: number | null; confidence?: number }[] };
    try { parsed = JSON.parse(j.choices?.[0]?.message?.content ?? '{}'); } catch { throw new Error(`${ai.name}: answer was not JSON`); }
    for (const r of parsed.results ?? []) {
      const g = part.find((x) => x.key === r.key);
      if (!g) continue;
      const ok = r.id != null && g.candidates.some((c) => c.id === r.id);   // only a candidate may be chosen
      out.push({ key: g.key, itemId: ok ? r.id : null, confidence: ok ? Math.max(0, Math.min(1, Number(r.confidence ?? 0.7))) : 0 });
    }
  }
  return out;
}
