/**
 * Factor sources, the yearly DESNZ upload (preview first, then import) and
 * the list of points the importer flagged for review.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../App';
import { api } from '../../lib/api';

export function SourcesTab() {
  const { toast } = useApp();
  const [sources, setSources] = useState<Awaited<ReturnType<typeof api.sources>>['sources']>([]);
  const [issues, setIssues] = useState<Awaited<ReturnType<typeof api.issues>>['issues']>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.importDesnz>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { api.sources().then((s) => setSources(s.sources)); api.issues().then((i) => setIssues(i.issues)); };
  useEffect(load, []);

  async function doPreview(f: File) {
    setFile(f); setPreview(null); setErr(null); setBusy(true);
    try { setPreview(await api.importDesnz(f, true)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function doImport() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.importDesnz(file, false);
      toast(r.skipped ? 'This exact file was already imported — nothing changed' : `Imported DESNZ ${r.year}: ${r.factors} factors`);
      setFile(null); setPreview(null); load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <h2>Load a new DESNZ (DEFRA) year</h2>
        <p className="sub">Each June the UK government publishes new conversion factors. Download the <b>flat file</b> (.xlsx) from gov.uk and choose it here. You will see what it contains before anything is saved. Loading a corrected file for a year already loaded keeps the old values as history.</p>
        <div className="row">
          <input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && doPreview(e.target.files[0])} />
          {busy && <span className="sub">Reading…</span>}
        </div>
        {preview && (
          <div className="note ok">
            <b>DESNZ {preview.year}</b> (version {preview.version}) · uses {preview.gwpSet} · {preview.fuelRows} fuel factors · {preview.gasRows} gases.
            <div className="row" style={{ marginTop: 8 }}><button className="btn p" disabled={busy} onClick={doImport}>Import DESNZ {preview.year}</button><button className="btn" onClick={() => { setPreview(null); setFile(null); }}>Cancel</button></div>
          </div>
        )}
        {err && <div className="note bad">{err}</div>}
      </div>

      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h2>Sources</h2></div>
        <table className="t">
          <thead><tr><th>Code</th><th>Title</th><th>Version</th><th>GWP set</th><th>Loaded</th></tr></thead>
          <tbody>{sources.map((s) => (
            <tr key={s.id}><td className="mono">{s.code}</td><td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</td><td>{s.version ?? '—'}</td><td>{s.gwp_set ?? '—'}</td><td>{s.imported_at.slice(0, 10)}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <div className="card flush">
        <div style={{ padding: '14px 16px 6px' }}><h2>For review · {issues.filter((i) => !i.resolved).length} open</h2><p className="sub">Points the importer flagged. Nothing was changed silently.</p></div>
        <div className="scroll" style={{ maxHeight: 360 }}>
          <table className="t">
            <tbody>{issues.map((i) => (
              <tr key={i.id} className={i.resolved ? 'off' : ''}>
                <td><span className={`chip ${i.severity === 'warning' ? 'warn' : i.severity === 'error' ? 'bad' : 'info'}`}>{i.severity}</span></td>
                <td className="mono">{i.source}</td><td>{i.message}</td>
                <td><button className="btn sm ghost" onClick={async () => { await api.resolveIssue(i.id, !i.resolved); load(); }}>{i.resolved ? 'Reopen' : 'Mark reviewed'}</button></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
