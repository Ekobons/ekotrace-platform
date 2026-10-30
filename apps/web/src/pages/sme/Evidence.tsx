/**
 * Proof documents for a page or one item on it: list, attach (button or drag & drop), open, remove.
 *   <Evidence module="certs" item="iso14001" />          compact (a line of files and an Attach button)
 *   <Evidence module="emissions" item="grid" label="Bills" />
 * Files belong to the financial year shown at the top of the page.
 * useProofCounts(module) gives the number of files per item, kept up to date as files are added or removed.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useSme } from './store';
import { smeFiles, fileSize, type SmeFile } from '../../lib/smeFiles';
import './evidence.css';

const CHANGED = 'sme-evidence-changed';
const MAX = 10 * 1024 * 1024;
const OK_EXT = /\.(pdf|jpe?g|png|docx|xlsx)$/i;
const kindOf = (f: SmeFile) => (f.mime === 'application/pdf' ? 'PDF' : f.mime.startsWith('image/') ? 'IMG' : /word/.test(f.mime) ? 'DOC' : /sheet/.test(f.mime) ? 'XLS' : 'FILE');
const announce = (module: string) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: module }));

/** Number of proof files per item of a page, for "3 of 7 have proof" counts. */
export function useProofCounts(module: string): Record<string, number> | null {
  const { fy } = useSme();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const load = useCallback(() => {
    smeFiles.list(fy, module).then((r) => {
      const out: Record<string, number> = {};
      for (const f of r.files) out[f.item_key] = (out[f.item_key] ?? 0) + 1;
      setCounts(out);
    }).catch(() => setCounts({}));
  }, [fy, module]);
  useEffect(() => {
    load();
    const on = (e: Event) => { if ((e as CustomEvent).detail === module) load(); };
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, [load, module]);
  return counts;
}

export function Evidence({ module, item = '', label = 'Proof', compact = true }: { module: string; item?: string; label?: string; compact?: boolean }) {
  const { d, fy } = useSme();
  const [files, setFiles] = useState<SmeFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => { smeFiles.list(fy, module, item).then((r) => setFiles(r.files)).catch(() => setFiles([])); }, [fy, module, item]);
  useEffect(load, [load]);
  const can = !!d?.canEdit;
  const add = async (list: File[]) => {
    if (!list.length) return;
    setErr(null);
    const bad = list.find((f) => f.size > MAX || !OK_EXT.test(f.name));
    if (bad) { setErr(bad.size > MAX ? `${bad.name} is larger than 10 MB.` : `${bad.name}: attach a PDF, a photo (JPG or PNG), or a Word or Excel file.`); return; }
    setBusy(true);
    try { for (const f of list.slice(0, 5)) await smeFiles.upload(fy, module, item, f); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); load(); announce(module); }
  };
  const remove = async (f: SmeFile) => {
    if (!window.confirm(`Remove ${f.name}?`)) return;
    try { await smeFiles.remove(f.id); } catch (e) { setErr((e as Error).message); }
    load(); announce(module);
  };
  const drop = can ? {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files)); },
  } : {};
  return (
    <div className={`sme-ev${compact ? ' compact' : ''}${over ? ' over' : ''}`} {...drop}>
      <span className="sme-ev-l">{label}</span>
      {files === null ? <span className="muted small">…</span> : files.map((f) => (
        <span key={f.id} className="sme-ev-f">
          <i className={`sme-ev-k k-${kindOf(f).toLowerCase()}`} aria-hidden="true">{kindOf(f)}</i>
          <button type="button" className="sme-ev-n" onClick={() => void smeFiles.open(f).catch((e: Error) => setErr(e.message))}
            title={`${f.name} · ${fileSize(f.size)}${f.uploaded_name ? ` · added by ${f.uploaded_name}` : ''}`}>{f.name}</button>
          {can && <button type="button" className="sme-ev-x" aria-label={`Remove ${f.name}`} onClick={() => void remove(f)}>✕</button>}
        </span>))}
      {files !== null && !files.length && !can && <span className="muted small">None attached</span>}
      {can && <>
        <button type="button" className="sme-ev-add" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : files?.length ? '+ Add' : '+ Attach'}</button>
        {files !== null && !files.length && !busy && <span className="sme-ev-hint">PDF or photo, up to 10 MB</span>}
        <input ref={input} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,application/pdf,image/jpeg,image/png" onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; void add(l); }} />
      </>}
      {err && <span className="sme-ev-err" role="alert">{err}</span>}
    </div>);
}

/** "3 of 7 have proof" as a small pill-like line. */
export function ProofCount({ have, of, what = 'have proof attached' }: { have: number; of: number; what?: string }) {
  return <span className={`sme-ev-count${have === of && of > 0 ? ' all' : ''}`}><b>{have}</b> of {of} {what}</span>;
}
