/**
 * EKOFIN counterparties: the register of companies lent to or invested in (one record each, shared by
 * every portfolio), and a profile with identifiers and sector, financials by year, emissions on record
 * with their PCAF score, the sector factors that apply, and where the company is held.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../App';
import { CountrySelect } from '../../components/CountrySelect';
import { fin, fullAmount, money, parseAmount, SCORE_SHORT, tco2, type Counterparty, type CounterpartyBody, type CounterpartyProfile, type FinMeta, type Score } from '../../lib/ekofin';
import { ASSET_SHORT, dateLabel, Drawer, ScoreChip } from './common';

export function FinCounterparties() {
  const { toast } = useApp();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Counterparty[] | null>(null);
  const [meta, setMeta] = useState<FinMeta | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { fin.meta().then(setMeta).catch((e) => toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = window.setTimeout(() => fin.counterparties(q.trim() || undefined).then((r) => setList(r.counterparties)).catch((e) => toast((e as Error).message)), q ? 250 : 0); return () => window.clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page">
      <div className="row tahead" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><span className="lbl">EKOFIN</span><h1>Counterparties</h1>
          <div className="muted">Every company lent to or invested in, once, whatever the portfolio. Its financials and reported emissions are used by every holding in it.</div></div>
        {meta?.canEdit && <button className="btn p" onClick={() => setAdding(true)}>+ Counterparty</button>}
      </div>
      <div className="card flush">
        <div className="row vfilters"><input className="input grow" style={{ maxWidth: 320 }} placeholder="Search name, LEI, ISIN or customer ID" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{list ? `${list.length}${list.length === 2000 ? '+' : ''} counterparties` : ''}</span></div>
        <div className="scroll"><table className="t">
          <thead><tr><th>Counterparty</th><th>Identifiers</th><th>Sector</th><th className="num">Holdings</th><th className="num">Financials</th><th className="ctr">Best score on record</th></tr></thead>
          <tbody>{(list ?? []).map((c) => (
            <tr key={c.id} className="click" onClick={() => nav(`/fin/counterparties/${c.id}`)}>
              <td><b>{c.name}</b><div className="muted small">{[c.country, c.listed ? 'listed' : null].filter(Boolean).join(' · ')}</div></td>
              <td className="small mono">{[c.lei, c.isin, c.local_id].filter(Boolean).join(' · ') || <span className="muted">—</span>}</td>
              <td className="small">{c.sector_code ? `${c.sector_standard} ${c.sector_code}` : <span className="chip warn">no sector</span>}{c.sector_name && <div className="muted">{c.sector_name}</div>}</td>
              <td className="num">{c.holdings}</td>
              <td className="num small">{c.fin_year ? `FY ${c.fin_year}` : <span className="muted">none</span>}</td>
              <td className="ctr">{c.best_score ? <><ScoreChip score={c.best_score as Score} /> <span className="muted small">{c.em_year}</span></> : <span className="muted small">estimates only</span>}</td>
            </tr>))}
            {list && !list.length && <tr><td colSpan={6} className="empty">{q ? 'No counterparty matches.' : 'No counterparties yet. They are created when you upload holdings, or here.'}</td></tr>}</tbody>
        </table></div>
      </div>
      {adding && meta && <CounterpartyDrawer meta={meta} cp={null} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); if (id) nav(`/fin/counterparties/${id}`); }} />}
    </div>);
}

export function FinCounterpartyProfile() {
  const { toast } = useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<CounterpartyProfile | null>(null);
  const [meta, setMeta] = useState<FinMeta | null>(null);
  const [tick, setTick] = useState(0);
  const [drawer, setDrawer] = useState<null | 'edit' | 'fin' | 'em'>(null);
  useEffect(() => { fin.meta().then(setMeta).catch((e) => toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (id) fin.counterparty(id).then(setP).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const del = (fn: () => Promise<unknown>) => { if (confirm('Remove this record?')) fn().then(() => { toast('Removed'); reload(); }).catch((e) => toast((e as Error).message)); };
  if (!p || !meta) return <div className="page"><div className="card empty">Loading…</div></div>;
  const c = p.counterparty, edit = meta.canEdit;
  return (
    <div className="page">
      <div className="row tahead" style={{ alignItems: 'flex-end' }}>
        <div className="grow"><span className="lbl"><Link to="/fin/counterparties">Counterparties</Link></span><h1>{c.name}</h1>
          <div className="muted">{[c.country, c.listed ? 'Listed' : 'Not listed', c.sector_code ? `${c.sector_standard} ${c.sector_code}${c.sector_name ? ` · ${c.sector_name}` : ''}` : 'No sector code: sector estimates cannot be made'].filter(Boolean).join(' · ')}</div>
          <div className="muted small mono">{[c.lei && `LEI ${c.lei}`, c.isin && `ISIN ${c.isin}`, c.local_id && `ID ${c.local_id}`].filter(Boolean).join(' · ')}</div></div>
        {edit && <button className="btn" onClick={() => setDrawer('edit')}>Edit</button>}
      </div>

      <div className="ccgrid">
        <div className="card flush">
          <div className="row vfilters"><h3 className="grow" style={{ margin: 0 }}>Emissions on record</h3>{edit && <button className="btn sm p" onClick={() => setDrawer('em')}>+ Emissions</button>}</div>
          <table className="t"><thead><tr><th>Year</th><th className="ctr">Score</th><th className="num">Scope 1 t</th><th className="num">Scope 2 t</th><th className="num">Scope 3 t</th><th>Source</th><th /></tr></thead>
            <tbody>{p.emissions.map((e) => (
              <tr key={e.id}><td>{e.year}</td><td className="ctr"><ScoreChip score={e.score} /></td><td className="num">{tco2(e.s1)}</td><td className="num">{tco2(e.s2)}</td><td className="num">{tco2(e.s3)}</td>
                <td className="small">{e.source}{e.document && <div className="muted">{e.document}</div>}<div className="muted">{e.created_name} · {dateLabel(e.created_at)}</div></td>
                <td>{edit && <button className="btn sm ghost danger" onClick={() => del(() => fin.deleteEmissions(e.id))}>Remove</button>}</td></tr>))}
              {!p.emissions.length && <tr><td colSpan={7} className="empty small">No reported emissions: holdings use sector estimates (score 4 or 5). Ask the company for its Scope 1 and 2.</td></tr>}</tbody></table>
        </div>
        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>Sector factors that apply</h3>
          {p.factors.length ? <table className="t"><tbody>{p.factors.map((f) => (
            <tr key={`${f.library}${f.basis}`}><td className="small"><b>{f.basis === 'revenue' ? 'Per million revenue (score 4)' : 'Per million assets (score 5)'}</b><div className="muted">{f.library} · {f.sector_standard} {f.sector_code}{f.sector_name ? ` ${f.sector_name}` : ''} · {f.region} · {f.year}</div></td>
              <td className="num small">{tco2(f.s1 + f.s2)} t / {f.currency}m</td></tr>))}</tbody></table>
            : <div className="muted small">{c.sector_code ? 'No factor in the libraries your portfolios use matches this sector code.' : 'Add the sector code to use sector factors.'}</div>}
        </div>
      </div>

      <div className="card flush">
        <div className="row vfilters"><h3 className="grow" style={{ margin: 0 }}>Financials by year</h3>{edit && <button className="btn sm p" onClick={() => setDrawer('fin')}>+ Financial year</button>}</div>
        <div className="scrollx"><table className="t"><thead><tr><th>Year</th><th>Currency</th><th className="num">EVIC</th><th className="num">Total equity</th><th className="num">Total debt</th><th className="num">Revenue</th><th className="num">Total assets</th><th>Source</th><th /></tr></thead>
          <tbody>{p.financials.map((f) => (
            <tr key={f.id}><td>FY {f.year}</td><td>{f.currency}</td>{[f.evic, f.equity, f.debt, f.revenue, f.total_assets].map((x, i) => <td key={i} className="num" title={fullAmount(x)}>{money(x)}</td>)}
              <td className="small">{f.source || '—'}<div className="muted">{f.updated_name} · {dateLabel(f.updated_at)}</div></td>
              <td>{edit && <button className="btn sm ghost danger" onClick={() => del(() => fin.deleteFinancials(f.id))}>Remove</button>}</td></tr>))}
            {!p.financials.length && <tr><td colSpan={9} className="empty small">No financials: without EVIC (listed) or equity + debt, the company's emissions cannot be attributed; only the asset estimate (score 5) works.</td></tr>}</tbody></table></div>
      </div>

      <div className="card flush">
        <div className="row vfilters"><h3 style={{ margin: 0 }}>Held in</h3></div>
        <table className="t"><thead><tr><th>Portfolio</th><th>Reporting date</th><th>Asset class</th><th>Loan ID</th><th className="num">Outstanding</th></tr></thead>
          <tbody>{p.holdings.map((h) => (
            <tr key={h.id} className="click" onClick={() => nav(`/fin/portfolios?p=${h.portfolio_id}&d=${h.period_id}`)}><td>{h.portfolio}</td><td>{dateLabel(h.as_of)}{h.status === 'locked' ? ' · locked' : ''}</td><td>{ASSET_SHORT[h.asset_class]}</td><td className="small">{h.internal_ref ?? '—'}</td><td className="num">{h.currency} {money(h.outstanding)}</td></tr>))}
            {!p.holdings.length && <tr><td colSpan={5} className="empty small">Not held in any portfolio.</td></tr>}</tbody></table>
      </div>
      {edit && !p.holdings.length && <div><button className="btn ghost danger" onClick={() => confirm(`Delete ${c.name}?`) && fin.deleteCounterparty(c.id).then(() => { toast('Deleted'); nav('/fin/counterparties'); }).catch((e) => toast((e as Error).message))}>Delete counterparty</button></div>}

      {drawer === 'edit' && <CounterpartyDrawer meta={meta} cp={c} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer === 'fin' && <FinancialsDrawer p={p} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer === 'em' && <EmissionsDrawer p={p} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
    </div>);
}

function CounterpartyDrawer({ meta, cp, onClose, onDone }: { meta: FinMeta; cp: Counterparty | null; onClose: () => void; onDone: (id?: string) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState<CounterpartyBody>({ name: cp?.name ?? '', country: cp?.country ?? null, lei: cp?.lei ?? null, isin: cp?.isin ?? null, localId: cp?.local_id ?? null, listed: cp?.listed ?? false,
    sectorStandard: cp?.sector_standard ?? 'NACE', sectorCode: cp?.sector_code ?? null, sectorName: cp?.sector_name ?? null, contactEmail: cp?.contact_email ?? null, note: cp?.note ?? '' });
  const up = (x: Partial<CounterpartyBody>) => setF((o) => ({ ...o, ...x }));
  const txt = (k: 'lei' | 'isin' | 'localId' | 'sectorCode' | 'sectorName' | 'contactEmail', l: string, ph = '') => <label className="field"><span>{l}</span><input className="input" value={f[k] ?? ''} placeholder={ph} onChange={(e) => up({ [k]: e.target.value || null })} /></label>;
  return (
    <Drawer eyebrow="Counterparty" title={cp ? cp.name : 'New counterparty'} wide onClose={onClose} foot={(close) => <><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={!f.name.trim()} onClick={async () => { try { const r = await fin.saveCounterparty({ ...f, name: f.name.trim() }, cp?.id); toast('Saved'); close(); onDone(r.id); } catch (e) { toast((e as Error).message); } }}>Save</button></>}>
      <div className="vform">
        <label className="field span2"><span>Legal name</span><input className="input" value={f.name} onChange={(e) => up({ name: e.target.value })} /></label>
        <label className="field"><span>Country</span><CountrySelect value={f.country ?? ''} empty="Not known" onChange={(v) => up({ country: v || null })} /></label>
        <label className="row chkline" style={{ gap: 6, alignSelf: 'end' }}><input type="checkbox" checked={f.listed} onChange={(e) => up({ listed: e.target.checked })} />Listed on a stock exchange (attribution uses EVIC)</label>
        {txt('lei', 'LEI', '20 characters')}
        {txt('isin', 'ISIN', 'for listed securities')}
        {txt('localId', 'Customer / registration ID')}
        {txt('contactEmail', 'Sustainability contact e-mail')}
        <label className="field"><span>Sector standard</span><select className="input" value={f.sectorStandard} onChange={(e) => up({ sectorStandard: e.target.value })}>{meta.standards.map((s) => <option key={s}>{s}</option>)}</select></label>
        {txt('sectorCode', 'Sector code', 'e.g. C24 or C24.10')}
        <div className="span2">{txt('sectorName', 'Sector name')}</div>
        <label className="field span2"><span>Note</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
    </Drawer>);
}

function FinancialsDrawer({ p, onClose, onDone }: { p: CounterpartyProfile; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const last = p.financials[0];
  const [f, setF] = useState({ year: String(new Date().getUTCFullYear() - 1), currency: last?.currency ?? 'USD', evic: '', equity: '', debt: '', revenue: '', totalAssets: '', source: '' });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const vals = { evic: parseAmount(f.evic), equity: parseAmount(f.equity), debt: parseAmount(f.debt), revenue: parseAmount(f.revenue), totalAssets: parseAmount(f.totalAssets) };
  const bad = Object.values(vals).some((v) => Number.isNaN(v)) || !Object.values(vals).some((v) => v != null) || !/^\d{4}$/.test(f.year) || !/^[A-Za-z]{3}$/.test(f.currency);
  const n = (k: keyof typeof vals, l: string, hint: string) => <label className="field"><span>{l}</span><input className="input num" value={f[k]} placeholder={hint} onChange={(e) => up({ [k]: e.target.value })} />{vals[k] != null && !Number.isNaN(vals[k]) && <small className="muted">{fullAmount(vals[k])}</small>}</label>;
  return (
    <Drawer eyebrow={p.counterparty.name} title="Financial year" onClose={onClose} foot={(close) => <><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={bad} onClick={async () => { try { await fin.saveFinancials(p.counterparty.id, { year: Number(f.year), currency: f.currency.toUpperCase(), ...vals, source: f.source.trim() }); toast('Saved'); close(); onDone(); } catch (e) { toast((e as Error).message); } }}>Save</button></>}>
      <div className="muted small">The same year again replaces it. Amounts in full or as 120m / 1.2bn.</div>
      <div className="vform">
        <label className="field"><span>Financial year</span><input className="input num" value={f.year} onChange={(e) => up({ year: e.target.value })} /></label>
        <label className="field"><span>Currency</span><input className="input" maxLength={3} value={f.currency} onChange={(e) => up({ currency: e.target.value.toUpperCase() })} /></label>
        {n('evic', 'EVIC', 'listed: market cap + debt')}
        {n('revenue', 'Revenue', 'for the sector estimate')}
        {n('equity', 'Total equity', 'book value')}
        {n('debt', 'Total debt', '')}
        {n('totalAssets', 'Total assets', '')}
        <label className="field"><span>Source</span><input className="input" value={f.source} placeholder="e.g. Annual report 2025" onChange={(e) => up({ source: e.target.value })} /></label>
      </div>
    </Drawer>);
}

function EmissionsDrawer({ p, onClose, onDone }: { p: CounterpartyProfile; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ year: String(new Date().getUTCFullYear() - 1), score: '2', s1: '', s2: '', s3: '', source: '', documentId: '', note: '' });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const s1 = parseAmount(f.s1), s2 = parseAmount(f.s2), s3 = parseAmount(f.s3);
  const bad = s1 == null || s2 == null || [s1, s2, s3].some((v) => Number.isNaN(v) || (v != null && v < 0)) || f.source.trim().length < 2 || (f.score === '1' && !f.documentId);
  return (
    <Drawer eyebrow={p.counterparty.name} title="Emissions for a year" onClose={onClose} foot={(close) => <><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={bad} onClick={async () => { try { await fin.saveEmissions(p.counterparty.id, { year: Number(f.year), score: Number(f.score) as 1 | 2 | 3, s1: s1!, s2: s2!, s3, source: f.source.trim(), documentId: f.documentId || null, note: f.note }); toast('Saved'); close(); onDone(); } catch (e) { toast((e as Error).message); } }}>Save</button></>}>
      <div className="vform">
        <label className="field"><span>Year</span><input className="input num" value={f.year} onChange={(e) => up({ year: e.target.value })} /></label>
        <label className="field"><span>What it is</span><select className="input" value={f.score} onChange={(e) => up({ score: e.target.value })}>
          {([1, 2, 3] as Score[]).map((s) => <option key={s} value={s}>Score {s} · {SCORE_SHORT[s]}</option>)}</select></label>
        <label className="field"><span>Scope 1 · tCO₂e</span><input className="input num" value={f.s1} onChange={(e) => up({ s1: e.target.value })} /></label>
        <label className="field"><span>Scope 2 · tCO₂e</span><input className="input num" value={f.s2} onChange={(e) => up({ s2: e.target.value })} /></label>
        <label className="field"><span>Scope 3 · tCO₂e (optional)</span><input className="input num" value={f.s3} onChange={(e) => up({ s3: e.target.value })} /></label>
        <label className="field"><span>Source</span><input className="input" value={f.source} placeholder="e.g. Sustainability report 2025, p. 41" onChange={(e) => up({ source: e.target.value })} /></label>
        <label className="field span2"><span>Report or assurance statement (Document vault){f.score === '1' ? ' · needed for score 1' : ''}</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}>
          <option value="">None</option>{p.documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="field span2"><span>Note</span><input className="input" value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
      </div>
      <div className="muted small">Score 1: verified by a third party. Score 2: reported, not verified. Score 3: calculated from the company's energy use or production. The same year and score again replaces it.</div>
    </Drawer>);
}
