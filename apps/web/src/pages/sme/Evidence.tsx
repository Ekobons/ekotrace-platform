/**
 * Proof documents for a page or one item on it: list, attach, open, remove.
 *   <Evidence module="certs" item="iso14001" />          compact (a line of files and an Attach button)
 *   <Evidence module="emissions" item="grid" label="Bills" />
 * Files belong to the financial year shown at the top of the page.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSme } from './store';
import { smeFiles, fileSize, type SmeFile } from '../../lib/smeFiles';
import './evidence.css';

export function Evidence({ module, item = '', label = 'Proof', compact = true }: { module: string; item?: string; label?: string; compact?: boolean }) {
  const { d, fy } = useSme();
  const [files, setFiles] = useState<SmeFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => { smeFiles.list(fy, module, item).then((r) => setFiles(r.files)).catch(() => setFiles([])); }, [fy, module, item]);
  useEffect(load, [load]);
  const add = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setErr('Files can be at most 10 MB.'); return; }
    setBusy(true); setErr(null);
    try { await smeFiles.upload(fy, module, item, f); load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const can = !!d?.canEdit;
  return (
    <div className={`sme-ev${compact ? ' compact' : ''}`}>
      <span className="sme-ev-l">{label}</span>
      {files === null ? <span className="muted">…</span> : files.map((f) => (
        <span key={f.id} className="sme-ev-f">
          <button type="button" className="linkbtn" onClick={() => void smeFiles.open(f)} title={`${f.name} · ${fileSize(f.size)}${f.uploaded_name ? ` · ${f.uploaded_name}` : ''}`}>{f.name}</button>
          {can && <button type="button" className="sme-ev-x" aria-label={`Remove ${f.name}`} onClick={async () => { if (window.confirm(`Remove ${f.name}?`)) { await smeFiles.remove(f.id).catch(() => {}); load(); } }}>✕</button>}
        </span>))}
      {files !== null && !files.length && !can && <span className="muted">none</span>}
      {can && <><button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : '+ Attach'}</button>
        <input ref={input} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void add(f); }} /></>}
      {err && <span className="sme-ev-err">{err}</span>}
    </div>);
}
