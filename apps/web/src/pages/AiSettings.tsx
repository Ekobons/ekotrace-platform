/**
 * Setup → Integrations, AI & batch runs → AI (super admin): which AI service the company connects (its own Claude,
 * ChatGPT, Gemini, Azure OpenAI, another OpenAI-compatible service, or the platform's), the key (stored encrypted,
 * never shown again), and when AI may run. A test call checks the connection.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, type AiSettings } from '../lib/api';

const WHEN: [AiSettings['purchases'], string, string][] = [
  ['large', 'Large unidentified purchases only (recommended)', 'After the first calculation, the kinds of purchase a person must confirm (the top of the emissions, see Review coverage) that the text match could not identify. The AI proposes one of the candidates; a person still confirms. Lowest cost.'],
  ['unidentified', 'Every unidentified purchase', 'Every kind of purchase the text match could not identify, large or small, up to the limit below. Small ones are then accepted with the AI answer instead of an average factor.'],
  ['off', 'Never', 'Connected, but not used for purchases.'],
];

export function AiSettingsPage() {
  const { toast } = useApp();
  const [d, setD] = useState<AiSettings | null>(null);
  const [f, setF] = useState({ enabled: false, provider: '', model: '', baseUrl: '', key: '', purchases: 'large' as AiSettings['purchases'], maxGroups: '300' });
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const load = () => api.aiSettings().then((x) => {
    setD(x); setF({ enabled: x.enabled, provider: x.provider ?? '', model: x.model ?? '', baseUrl: x.baseUrl ?? '', key: '', purchases: x.purchases, maxGroups: String(x.maxGroups) });
  }).catch((e) => toast((e as Error).message));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const P = d.providers.find((p) => p.code === f.provider);
  const keySaved = !!d.keyHint && d.provider === f.provider;
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const save = async () => {
    setBusy(true);
    try {
      await api.aiSave({ enabled: f.enabled, provider: f.provider || null, model: f.model.trim() || null, baseUrl: f.baseUrl.trim() || null, key: f.key.trim() || undefined, purchases: f.purchases, maxGroups: Number(f.maxGroups) || 300 });
      toast('Saved'); setTest(null); await load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const runTest = async () => { setBusy(true); try { setTest(await api.aiTest()); await load(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Setup · Super admin</div><h1>AI</h1>
        <p className="sub">Connect the AI service your company has approved — your own Claude, ChatGPT, Gemini or Azure OpenAI account, or another service — and decide when it may run. Nothing is sent to any AI until it is switched on here.</p></div></div>
      {!d.onPlan && <div className="note warn small">AI is not on the {d.planName} plan (Professional and above). You can prepare the connection; it cannot be switched on.</div>}
      <div className="cols2" style={{ alignItems: 'start' }}>
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>Connection</h2>
          <div className="vform">
            <label className="field span2"><span>AI service</span>
              <select className="input" value={f.provider} onChange={(e) => up({ provider: e.target.value, model: d.providers.find((p) => p.code === e.target.value)?.models[0] ?? '', key: '' })}>
                <option value="">Choose…</option>{d.providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
            {P && <div className="span2 muted small">{P.note}</div>}
            {P && P.code !== 'platform' && <>
              <label className="field"><span>Model</span>
                <input className="input" list="ai-models" value={f.model} placeholder={P.models[0] ?? 'model name'} onChange={(e) => up({ model: e.target.value })} />
                <datalist id="ai-models">{P.models.map((m) => <option key={m} value={m} />)}</datalist></label>
              <label className="field"><span>API key {keySaved ? `(saved ${d.keyHint}; leave empty to keep)` : ''}</span>
                <input className="input" type="password" autoComplete="off" value={f.key} placeholder={keySaved ? '••••••••' : 'paste the key'} onChange={(e) => up({ key: e.target.value })} /></label>
              {P.needsUrl && <label className="field span2"><span>Address (https)</span><input className="input" value={f.baseUrl} placeholder="https://…/chat/completions" onChange={(e) => up({ baseUrl: e.target.value })} /></label>}
            </>}
          </div>
          <label className="row chkline" style={{ gap: 8 }}><input type="checkbox" checked={f.enabled} disabled={!d.onPlan} onChange={(e) => up({ enabled: e.target.checked })} /><b>Use AI</b> <span className="muted small">— the master switch: off stops every AI call at once</span></label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn p" disabled={busy || (f.enabled && !f.provider)} onClick={() => void save()}>Save</button>
            <button className="btn" disabled={busy || !d.provider} onClick={() => void runTest()}>Test the connection</button>
            <span className="small muted grow">{d.testedAt ? `Last test ${new Date(d.testedAt).toLocaleString('en-GB')}: ${d.testOk ? 'worked' : 'failed'}` : 'Not tested yet'}{d.updatedBy ? ` · changed by ${d.updatedBy}` : ''}</span>
          </div>
          {test && <div className={`note ${test.ok ? 'ok' : 'bad'} small`}>{test.message}</div>}
          <div className="note info small">The key is stored encrypted and is never shown again — only its last 4 characters. Use a key made for this purpose, with a spending limit in your AI account. Every change and test is in the audit log (without the key).</div>
        </div>
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <h2>When AI runs</h2>
          <div className="eyebrow">Purchases (Scope 3) — mapping descriptions to spend categories</div>
          <div style={{ display: 'grid', gap: 6 }}>{WHEN.map(([k, l, txt]) => (
            <label key={k} className="soft" style={{ cursor: 'pointer' }}><span className="row" style={{ gap: 8 }}><input type="radio" name="aiwhen" checked={f.purchases === k} onChange={() => up({ purchases: k })} /><b>{l}</b></span>
              <span className="muted" style={{ fontSize: 12.5 }}>{txt}</span></label>))}</div>
          <label className="field" style={{ maxWidth: 320 }}><span>At most this many kinds of purchase per file</span><input className="input num" inputMode="numeric" value={f.maxGroups} onChange={(e) => up({ maxGroups: e.target.value })} /></label>
          <div className="small">
            <p style={{ margin: '0 0 6px' }}><b>What is sent:</b> the purchase description, the category or account title from the file, and the names of up to 5 candidate categories found by the text match. <b>Never</b> amounts, suppliers, people, facilities or the file.</p>
            <p style={{ margin: 0 }}><b>What the AI may do:</b> choose one of the candidates, or none. It cannot invent a category or a factor; its answer is marked <i>AI</i> and, for large purchases, waits for a person to confirm. If the service does not answer, the file carries on without it and says so.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
