/**
 * EKOFIN sector factor library: tCO2e per million of revenue (PCAF score 4) or of total assets (score 5)
 * by sector code, region and year. Shared by every company; loaded and removed by Ekobon staff.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../../App';
import { fin, tco2, type FactorRow, type FinLibrary } from '../../lib/ekofin';
import { dateLabel, Drawer } from './common';

export function FinFactors() {
  const { toast } = useApp();
  const [lib, setLib] = useState<string | undefined>();
  const [d, setD] = useState<{ libraries: FinLibrary[]; library: string | null; rows: FactorRow[]; canEdit: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { fin.factors(lib).then(setD).catch((e) => toast((e as Error).message)); }, [lib, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const rows = d.rows.filter((r) => !q || `${r.sector_code} ${r.sector_name ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="row tahead" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><span className="lbl">EKOFIN · setup</span><h1>Sector factor library</h1>
          <div className="muted">Estimates for companies without reported emissions: tCO₂e per million of revenue (PCAF score 4) or of total assets (score 5). A shorter sector code covers every longer one that starts with it. Each portfolio chooses its library in its settings.</div></div>
        {d.canEdit && <><button className="btn" onClick={() => fin.factorTemplate().catch((e) => toast((e as Error).message))}>Template</button><button className="btn p" onClick={() => setLoading(true)}>Load factors</button></>}
      </div>
      {!d.libraries.length ? <div className="card empty"><h2>No library loaded</h2><p className="sub">{d.canEdit ? 'Load a factor set (for example the PCAF emission factor database or EXIOBASE) with the template. Check its licence allows use in this platform.' : 'Ekobon loads the sector factors. Until then, only holdings with reported emissions get a result.'}</p></div> : (<>
        <div className="row" style={{ gap: 8 }}>{d.libraries.map((l) => (
          <button key={l.library} className={`card kpi${l.library === d.library ? ' on' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', padding: 12, borderColor: l.library === d.library ? 'var(--primary)' : undefined }} onClick={() => setLib(l.library)}>
            <b>{l.library}</b><div className="muted small">{l.n} factors · {l.from_year}–{l.to_year} · {l.standards.join(', ')}{l.loaded_at ? ` · loaded ${dateLabel(l.loaded_at)}` : ''}</div></button>))}</div>
        <div className="card flush">
          <div className="row vfilters"><input className="input" style={{ maxWidth: 260 }} placeholder="Sector code or name" value={q} onChange={(e) => setQ(e.target.value)} /><span className="grow" />
            {d.canEdit && d.library && <button className="btn sm ghost danger" onClick={() => confirm(`Remove the whole library “${d.library}”?`) && fin.deleteLibrary(d.library!).then((r) => { toast(`${r.deleted} factors removed`); setLib(undefined); setTick((t) => t + 1); }).catch((e) => toast((e as Error).message))}>Remove library</button>}</div>
          <div className="scroll"><table className="t">
            <thead><tr><th>Sector</th><th>Region</th><th className="num">Year</th><th>Per million of</th><th className="num">Scope 1</th><th className="num">Scope 2</th><th className="num">Scope 3</th><th>Source</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td><b className="mono">{r.sector_standard} {r.sector_code}</b><div className="muted small">{r.sector_name}</div></td><td>{r.region}</td><td className="num">{r.year}</td>
                <td className="small">{r.currency} {r.basis === 'revenue' ? 'revenue' : 'assets'}</td><td className="num">{tco2(r.s1)}</td><td className="num">{tco2(r.s2)}</td><td className="num">{tco2(r.s3)}</td><td className="small">{r.source}</td></tr>))}</tbody>
          </table></div>
        </div>
      </>)}
      {loading && <LoadDrawer onClose={() => setLoading(false)} onDone={(l) => { setLoading(false); setLib(l); setTick((t) => t + 1); }} />}
    </div>);
}

function LoadDrawer({ onClose, onDone }: { onClose: () => void; onDone: (lib?: string) => void }) {
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [r, setR] = useState<Awaited<ReturnType<typeof fin.importFactors>> | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Drawer eyebrow="Sector factor library" title="Load factors" onClose={onClose} foot={(close) => <><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={busy || !file || !r || r.errors.length > 0 || !r.rows} onClick={async () => { setBusy(true); try { const x = await fin.importFactors(file!, true); toast(`${x.saved} factors loaded`); close(); onDone(x.libraries[0]); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>Load {r?.rows ?? ''} factors</button></>}>
      <div className="muted small">Excel or CSV in the template's columns. A factor already in the library (same library, sector, region, year and basis) is replaced.</div>
      <input type="file" accept=".xlsx,.csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f); setR(null); try { setR(await fin.importFactors(f, false)); } catch (x) { toast((x as Error).message); } }} />
      {r && <><div className="row small" style={{ gap: 8 }}><span className="chip">{r.rows} factors ready</span><span className="chip grey">{r.libraries.join(', ')}</span>{r.errors.length > 0 && <span className="chip bad">{r.errors.length} rows with problems</span>}</div>
        {r.errors.length > 0 && <ul className="small bad" style={{ margin: 0, paddingLeft: 18 }}>{r.errors.slice(0, 30).map((x) => <li key={x.row}>Row {x.row}: {x.detail}</li>)}</ul>}</>}
    </Drawer>);
}
