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

      <SpendImports onDone={load} />

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

/** Spend-based factors for purchased goods & services: the EPA file, and the previous Ekotrace list. */
function SpendImports({ onDone }: { onDone: () => void }) {
  const { toast } = useApp();
  const [epa, setEpa] = useState<{ file: File; p: Awaited<ReturnType<typeof api.importEpa>> } | null>(null);
  const [old, setOld] = useState<Record<string, File>>({});
  const [oldPrev, setOldPrev] = useState<Awaited<ReturnType<typeof api.importOldPurchases>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const oldBody = async (preview: boolean) => ({ factors: await old.factors!.text(), categories: await old.categories?.text(), subcategories: await old.subcategories?.text(), types: await old.types?.text(), preview });
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <h2>Spend-based factors (purchased goods &amp; services)</h2>
      <p className="sub">US EPA <b>Supply Chain GHG Emission Factors v1.3</b> by NAICS-6: the CSV <span className="mono">SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv</span> (kg CO₂e per 2022 USD, purchaser price). The factors with margins are used. Demo placeholder factors are retired automatically.</p>
      <div className="row"><input type="file" accept=".csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setErr(null); try { setEpa({ file: f, p: await api.importEpa(f, true) }); } catch (x) { setErr((x as Error).message); } }} /></div>
      {epa && <div className="note ok"><b>EPA v{epa.p.version}</b> · {epa.p.rows} NAICS commodities · per {epa.p.priceYear} USD · e.g. {epa.p.sample.slice(0, 3).map((x) => `${x.title} ${x.withMargins}`).join('; ')}
        <div className="row" style={{ marginTop: 8 }}><button className="btn p" onClick={async () => { try { const r = await api.importEpa(epa.file, false); toast(r.skipped === true ? 'Already imported' : `Imported: ${r.factors} factors`); setEpa(null); onDone(); } catch (x) { setErr((x as Error).message); } }}>Import</button><button className="btn" onClick={() => setEpa(null)}>Cancel</button></div></div>}
      <details><summary className="small">The previous Ekotrace purchased-goods list (CSV exports of its database)</summary>
        <div className="grid3" style={{ marginTop: 8 }}>
          {[['factors', 'purchase_goods_categories_ef *'], ['categories', 'dbo.purchase_category'], ['subcategories', 'dbo.purchase_subcategory'], ['types', 'dbo.typesofpurchase']].map(([k, l]) => (
            <label key={k} className="field"><span>{l}</span><input type="file" accept=".csv" onChange={(e) => { const f = e.target.files?.[0]; setOld((o) => { const n = { ...o }; if (f) n[k!] = f; else delete n[k!]; return n; }); setOldPrev(null); }} /></label>))}
        </div>
        <p className="sub">Each product (e.g. “Cereal - Barley grain”, “LPG”) becomes a spend category with the EPA factor of its NAICS code; the old category › subcategory and the capital goods type are kept. The old per-currency and per-kg values are not used (Ekotrace converts each purchase itself). Load the EPA file first.</p>
        <div className="row"><button className="btn" disabled={!old.factors} onClick={async () => { setErr(null); try { setOldPrev(await api.importOldPurchases(await oldBody(true))); } catch (x) { setErr((x as Error).message); } }}>Check</button>
          {oldPrev?.preview && <><span className="sub">{oldPrev.rows} rows → {oldPrev.products} products.</span><button className="btn p" onClick={async () => { try { const r = await api.importOldPurchases(await oldBody(false)); toast(`${r.created} products added, ${r.updated} updated${r.notFound?.length ? `, ${r.notFound.length} without an EPA code` : ''}`); setOldPrev(null); onDone(); } catch (x) { setErr((x as Error).message); } }}>Import</button></>}</div>
      </details>
      {err && <div className="note bad">{err}</div>}
    </div>
  );
}
