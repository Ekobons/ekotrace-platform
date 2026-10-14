/** Shows a stored file beside its details: PDFs and images inline, other files as a download. */
import { useEffect, useState } from 'react';
import { blobUrl, download } from '../lib/api';

export const extOf = (name: string) => ((name.split('.').pop() ?? 'file').slice(0, 4) || 'file').toUpperCase();
export const sizeOf = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export function FileTag({ name }: { name: string }) {
  const e = extOf(name);
  const k = e === 'PDF' ? 'pdf' : ['PNG', 'JPG', 'JPEG', 'WEBP'].includes(e) ? 'img' : ['XLSX', 'XLS', 'CSV'].includes(e) ? 'xls' : ['DOCX', 'DOC', 'TXT'].includes(e) ? 'doc' : 'oth';
  return <span className={`filetag ${k}`} aria-hidden="true">{e}</span>;
}

export function FilePreview({ path, filename, contentType, height = 460 }: { path: string; filename: string; contentType: string; height?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const viewable = contentType === 'application/pdf' || contentType.startsWith('image/');
  useEffect(() => {
    let u: string | null = null; setUrl(null); setErr(null);
    if (viewable) blobUrl(path).then((x) => { u = x; setUrl(x); }).catch((e) => setErr((e as Error).message));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [path, viewable]);
  return (
    <div className="fprev">
      {!viewable ? <div className="empty small">No preview for this kind of file.</div>
        : err ? <div className="note bad">{err}</div>
          : !url ? <div className="empty small">Loading…</div>
            : contentType === 'application/pdf' ? <iframe title={filename} src={url} style={{ height }} />
              : <img src={url} alt={filename} style={{ maxHeight: height }} />}
      <div className="row" style={{ gap: 8 }}><span className="muted small grow">{filename}</span>
        <button type="button" className="btn sm" onClick={() => download(`${path}${path.includes('?') ? '&' : '?'}download=1`, filename).catch(() => {})}>Download</button></div>
    </div>);
}
