/**
 * Evidence of one entry (in the entry drawers): files linked to it, the bills of its meter, collection scans.
 * Attach a file here and it goes to the document vault, filed under the entry's facility and period.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type EvidenceFile } from '../lib/api';
import { useApp } from '../App';
import { FilePreview, FileTag, sizeOf } from './FilePreview';

const HOW: Record<EvidenceFile['how'], string> = { linked: 'Linked', 'meter bill': 'Bill of the meter', 'collection scan': 'Collection scan' };
const QUICK: [string, string][] = [['invoice', 'Invoice / receipt'], ['bill', 'Utility bill'], ['meter', 'Meter photo / reading sheet'], ['statement', 'Supplier or contractor statement'], ['manifest', 'Waste manifest / ticket'], ['travel', 'Travel booking / report'], ['refrigerant', 'Refrigerant service log'], ['data', 'Data file'], ['other', 'Other']];

export function Evidence({ activityId, onChange }: { activityId: string; onChange?: () => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<Awaited<ReturnType<typeof api.evidence>> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [type, setType] = useState('invoice');
  const [busy, setBusy] = useState(false);
  const load = () => api.evidence(activityId).then(setD).catch((e) => toast((e as Error).message));
  useEffect(() => { setD(null); setOpen(null); load(); }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="evid"><b>Evidence</b><span className="muted small">Loading…</span></div>;
  const attach = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.vaultUpload(f, { type, facilityId: d.facilityId, periodFrom: d.periodStart, periodTo: d.periodEnd, linkActivityIds: [activityId] });
      toast(r.message ?? `${f.name} attached and filed in the document vault`); await load(); onChange?.();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const unlink = async (f: EvidenceFile) => {
    try { await api.vaultUnlink(f.id, activityId); toast(`${f.filename} is no longer linked (it stays in the vault)`); await load(); onChange?.(); } catch (e) { toast((e as Error).message); }
  };
  const sel = d.files.find((f) => f.id === open);
  return (
    <div className="evid">
      <div className="row" style={{ gap: 8 }}>
        <b className="grow">Evidence · {d.files.length ? `${d.files.length} file${d.files.length === 1 ? '' : 's'}` : 'none yet'}</b>
        <Link to="/vault" className="small">Document vault →</Link>
      </div>
      {d.files.map((f) => (
        <div key={f.id} className={`evrow${open === f.id ? ' on' : ''}`}>
          <FileTag name={f.filename} />
          <button type="button" className="linkbtn grow" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
            <b>{f.title || f.filename}</b><span className="muted small">{f.typeName} · {sizeOf(f.size)} · {HOW[f.how]}{f.linked_by ? ` by ${f.linked_by}` : ''}</span>
          </button>
          {f.canUnlink && <button type="button" className="btn ghost sm" title="Remove the link (the file stays in the vault)" onClick={() => unlink(f)}>Unlink</button>}
        </div>))}
      {sel && <FilePreview path={`/api/vault/${sel.id}/file`} filename={sel.filename} contentType={sel.content_type} height={360} />}
      {!d.files.length && <div className="muted small">No bill, invoice or other file supports this entry yet. Verifiers look for one on every material entry.</div>}
      {d.locked && <div className="note info small">This month is locked for assurance: files can be added, not removed.</div>}
      {d.canAdd && (
        <div className="row evadd" style={{ gap: 8 }}>
          <select className="input sm" aria-label="Kind of file" value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }}>{QUICK.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className={`btn sm${busy ? ' dis' : ''}`}>{busy ? 'Uploading…' : '+ Attach a file'}
            <input type="file" hidden disabled={busy} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.doc,.txt,.eml,.msg" onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <span className="muted small">PDF, image, Excel, Word, CSV or email · up to 25 MB</span>
        </div>)}
    </div>);
}
