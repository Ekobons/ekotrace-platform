/** SME console · Settings: versioned configuration (factors, tariffs, SRMM banks…). Edit as JSON, save a draft, activate. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { dmy, smeAdminApi } from '../../lib/sme';
import { ApiError } from '../../lib/api';
import { Pill } from './ui';
import { errText, useLoad } from './netShared';

const when = (s: string | null | undefined) => (s ? `${dmy(s)} ${new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : '—');
const vStatus = (s: string) => (s === 'active' ? <Pill kind="good">Active</Pill> : s === 'draft' ? <Pill kind="soon">Draft</Pill> : <Pill kind="watch">Retired</Pill>);

export function ConsoleSettings() {
  const [key, setKey] = useState<string | null>(null);
  const list = useLoad(() => smeAdminApi.settings(), []);
  if (key) return <SettingKey k={key} onBack={() => { setKey(null); list.reload(); }} />;
  if (list.error) return <div className="card empty">{list.error}</div>;
  if (!list.data) return <div className="card empty">Loading…</div>;
  const items = new Map(list.data.items.map((i) => [i.skey, i]));
  return (
    <div className="card net-sec">
      <div><h2>Settings</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Every setting is versioned. Changes are saved as a draft first and take effect for all SME companies only when you activate them. Older versions stay available to roll back.</p></div>
      <div className="net-keys">
        {list.data.keys.map((k) => { const i = items.get(k.key); return (
          <button key={k.key} className="net-key" onClick={() => setKey(k.key)}>
            <b>{k.label}</b>
            <small>{i ? `Active v${i.active ?? '—'}${i.activated_at ? ` · since ${dmy(i.activated_at)}` : ''}` : 'Not stored yet'}</small>
            <span className="row" style={{ gap: 6 }}><code>{k.key}</code>{i && i.drafts > 0 && <span className="chip warn">{i.drafts} draft{i.drafts > 1 ? 's' : ''}</span>}{i && Number(i.latest) > Number(i.active) && !i.drafts && <span className="chip grey">newer retired</span>}</span>
          </button>); })}
      </div>
    </div>);
}

function SettingKey({ k, onBack }: { k: string; onBack: () => void }) {
  const { toast } = useApp();
  const meta = useLoad(() => smeAdminApi.setting(k), [k]);
  const [sel, setSel] = useState<number | null>(null);
  const [item, setItem] = useState<{ version: number; status: string; data: any; note: string | null } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);   // non-null while editing
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiErr, setApiErr] = useState<string | null>(null);
  const versions = meta.data?.versions ?? [];
  useEffect(() => { if (meta.data && sel === null) setSel(meta.data.active.version); }, [meta.data, sel]);
  useEffect(() => {
    if (sel === null) return;
    let live = true; setLoadErr(null);
    smeAdminApi.settingVersion(k, sel).then((r) => { if (live) setItem(r.item); }).catch((e) => { if (live) setLoadErr(errText(e)); });
    return () => { live = false; };
  }, [k, sel]);
  const parsed = useMemo(() => {
    if (text === null) return { ok: true as const };
    try { const v = JSON.parse(text); if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false as const, msg: 'The setting must be a JSON object: { … }.' }; return { ok: true as const, v }; }
    catch (e) { return { ok: false as const, msg: `Not valid JSON: ${errText(e)}` }; }
  }, [text]);
  if (meta.error) return <><button className="btn ghost net-back" onClick={onBack}>← All settings</button><div className="card empty">{meta.error}</div></>;
  if (!meta.data) return <div className="card empty">Loading…</div>;
  const cur = versions.find((v) => v.version === sel);
  const showErr = (e: unknown) => {
    if (e instanceof ApiError && e.details?.length) setApiErr(`${e.message} ${e.details.map((d) => `${d.field}: ${d.message}`).join('; ')}`);
    else setApiErr(errText(e));
    setTimeout(() => document.querySelector('.net-apierr')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  };
  const save = async () => {
    if (!parsed.ok || !('v' in parsed)) return;
    setBusy(true); setApiErr(null);
    try { const r = await smeAdminApi.saveDraft(k, parsed.v, note.trim() || null); toast(`Draft v${r.version} saved`); setText(null); setNote(''); setSel(r.version); meta.reload(); }
    catch (e) { showErr(e); } finally { setBusy(false); }
  };
  const activate = async (v: number) => {
    if (!window.confirm(`Activate version ${v} of “${meta.data!.label}”? It takes effect for every SME company straight away.`)) return;
    setBusy(true); setApiErr(null);
    try { await smeAdminApi.activate(k, v); toast(`Version ${v} is now active`); meta.reload(); setItem(null); setSel(v); const r = await smeAdminApi.settingVersion(k, v); setItem(r.item); }
    catch (e) { showErr(e); } finally { setBusy(false); }
  };
  const shown = item && item.version === sel ? item : null;
  return (
    <>
      <button className="btn ghost net-back" onClick={onBack}>← All settings</button>
      <div className="card"><span className="lbl">Setting · <code className="mono">{k}</code></span><h2 style={{ fontSize: 18, marginTop: 2 }}>{meta.data.label}</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Active: version {meta.data.active.version}. {versions.length} version{versions.length === 1 ? '' : 's'} in all.</p></div>
      <div className="net-con net-con-v">
        <div className="card" style={{ padding: 8 }}>
          <div className="net-vlist">{versions.map((v) => (
            <button key={v.version} className={v.version === sel ? 'on' : ''} onClick={() => { if (text !== null && !window.confirm('Discard your unsaved edits?')) return; setText(null); setApiErr(null); setSel(v.version); }}>
              <b>v{v.version}</b><span>{vStatus(v.status)}</span><span className="muted small">{dmy(v.created_at)}</span>
              <small>{v.note || 'No note'}{v.created_name ? ` · ${v.created_name}` : ''}</small>
            </button>))}</div>
        </div>
        <div className="card net-sec">
          {loadErr && <div className="note bad">{loadErr}</div>}
          {!shown ? <div className="empty">Loading version…</div> : (
            <>
              <div className="row">
                <div className="grow"><h2>{text !== null ? `New draft, based on v${shown.version}` : `Version ${shown.version}`} {text === null && vStatus(shown.status)}</h2>
                  {text === null && cur && <p className="muted small" style={{ margin: '4px 0 0' }}>Saved {when(cur.created_at)}{cur.created_name ? ` by ${cur.created_name}` : ''}{cur.activated_at ? ` · activated ${when(cur.activated_at)}${cur.activated_name ? ` by ${cur.activated_name}` : ''}` : ''}{shown.note ? ` · “${shown.note}”` : ''}</p>}</div>
                {text === null && <>
                  {shown.status !== 'active' && <button className="btn p" disabled={busy} onClick={() => activate(shown.version)}><Icon name="check" />{shown.status === 'draft' ? 'Activate' : 'Activate again (roll back)'}</button>}
                  <button className="btn" onClick={() => { setApiErr(null); setText(JSON.stringify(shown.data, null, 2)); }}><Icon name="edit" />Edit as new draft</button>
                </>}
              </div>
              {text === null
                ? <textarea className="net-json" readOnly value={JSON.stringify(shown.data, null, 2)} aria-label={`Version ${shown.version} as JSON`} spellCheck={false} />
                : (
                  <>
                    <textarea className={`net-json${parsed.ok ? '' : ' bad'}`} value={text} onChange={(e) => setText(e.target.value)} aria-label="Edit setting as JSON" spellCheck={false} autoFocus />
                    {!parsed.ok && <div className="note bad">{parsed.msg}</div>}
                    <div className="net-form net-form3">
                      <label className="field"><span>What changed (note)</span><input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. CEA grid factor v20 for FY 2025-26" /></label>
                      <button className="btn" onClick={() => { setText(null); setApiErr(null); }}>Cancel</button>
                      <button className="btn p" disabled={busy || !parsed.ok} onClick={save}>{busy ? 'Saving…' : 'Save draft'}</button>
                    </div>
                    <p className="muted small" style={{ margin: 0 }}>Saving checks the setting so the calculations keep working. A draft changes nothing until it is activated.</p>
                  </>)}
              {apiErr && <div className="note bad net-apierr" role="alert"><b>Not saved.</b> {apiErr}</div>}
            </>)}
        </div>
      </div>
    </>);
}
