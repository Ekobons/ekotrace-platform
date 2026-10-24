/**
 * EKOFIN portfolios & holdings: portfolios (loan book, fund, mandate) and their reporting dates; the
 * holdings at a date with each one's attribution, PCAF score and financed emissions; upload of the loan
 * book, holdings added by hand, a layer chosen with a reason, lock / unlock, export.
 */
import { useEffect, useMemo, useState } from 'react';
import { productName } from '../../lib/brand';
import { Link } from 'react-router-dom';
import { useApp } from '../../App';
import { fin, fullAmount, money, parseAmount, pct, SCORE_SHORT, tco2, type AssetClass, type Counterparty, type FinLine, type FinMeta, type FinPeriodData, type FinPortfolio, type ImportResult, type Score } from '../../lib/ekofin';
import { ASSET_SHORT, dateLabel, Drawer, PeriodPicker, ScoreChip, usePeriodChoice } from './common';

export function FinPortfolios() {
  const { toast } = useApp();
  const pc = usePeriodChoice();
  const [meta, setMeta] = useState<FinMeta | null>(null);
  const [d, setD] = useState<FinPeriodData | null>(null);
  const [tick, setTick] = useState(0);
  const [drawer, setDrawer] = useState<null | 'portfolio-new' | 'portfolio-edit' | 'period' | 'import' | 'holding-new' | 'unlock' | { line: FinLine }>(null);
  const [q, setQ] = useState(''), [ac, setAc] = useState(''), [sc, setSc] = useState('');
  useEffect(() => { fin.meta().then(setMeta).catch((e) => toast((e as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setD(null); if (pc.period) fin.period(pc.period.id).then(setD).catch((e) => toast((e as Error).message)); }, [pc.period?.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { setTick((t) => t + 1); pc.reload(); };
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  const lines = useMemo(() => (d?.lines ?? []).filter((l) => (!q || `${l.name} ${l.internalRef ?? ''} ${l.sector ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    && (!ac || l.assetClass === ac) && (!sc || (sc === 'none' ? !l.result.score : String(l.result.score) === sc))), [d, q, ac, sc]);

  if (!pc.portfolios || !meta) return <div className="page"><div className="card empty">Loading…</div></div>;
  const P = pc.portfolio, D = pc.period, locked = d?.period.status === 'locked', cur = P?.currency ?? 'USD';
  const editable = !!d && !locked && meta.canEdit;
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="grow"><span className="lbl">{productName('ekofin')}</span><h1>Portfolios & holdings</h1>
          <div className="muted">Each portfolio has reporting dates; the holdings at a date are the outstanding amounts on that day. Upload the loan book or positions file, or add holdings one by one.</div></div>
        {P && <PeriodPicker portfolios={pc.portfolios} portfolio={P} period={D} choose={pc.choose} />}
        {meta.canManage && <button className="btn" onClick={() => setDrawer('portfolio-new')}>+ Portfolio</button>}
      </div>

      {!P ? <div className="card empty"><h2>No portfolio yet</h2><p className="sub">{meta.canManage ? 'Create the first one: a loan book, a fund or an investment mandate.' : 'A super admin or admin creates portfolios.'}</p></div> : (<>
        <div className="card">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <h2>{P.name}{P.archived && <span className="chip grey" style={{ marginLeft: 8 }}>archived</span>}</h2>
              <div className="muted small">{meta.kinds[P.kind] ?? P.kind} · reporting currency {P.currency} · {P.factor_library ? <>sector factors: {P.factor_library}</> : <b className="bad">no sector factor library chosen</b>} · Scope 3 {P.include_scope3 ? 'included' : 'not included'}{P.description ? ` · ${P.description}` : ''}</div>
              <div className="row small" style={{ gap: 6, marginTop: 8 }}>{P.periods.map((x) => (
                <button key={x.id} className={`chip ${x.id === D?.id ? '' : 'grey'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => pc.choose(P.id, x.id)}>{dateLabel(x.as_of)} · {x.holdings}{x.status === 'locked' ? ' · locked' : ''}</button>))}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {meta.canManage && <button className="btn sm" onClick={() => setDrawer('portfolio-edit')}>Settings</button>}
              {meta.canEdit && <button className="btn sm" onClick={() => setDrawer('period')}>+ Reporting date</button>}
            </div>
          </div>
        </div>

        {!D ? <div className="card empty">Add a reporting date to start: the date of the outstanding amounts (for example 31 Dec 2025).</div> : !d ? <div className="card empty">Calculating…</div> : (<>
          {d.warnings.map((w) => <div key={w} className="note warn small">{w}</div>)}
          {locked && <div className="note info small">Locked by {d.period.lockedName} on {dateLabel(d.period.lockedAt)}. The figures are kept as they were; changes to counterparties no longer move them.</div>}
          <div className="card flush">
            <div className="row vfilters" style={{ gap: 8 }}>
              <input className="input grow" style={{ maxWidth: 260 }} placeholder="Search counterparty, loan ID, sector" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="input" value={ac} onChange={(e) => setAc(e.target.value)} aria-label="Asset class"><option value="">All asset classes</option>{Object.entries(meta.assetClasses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select className="input" value={sc} onChange={(e) => setSc(e.target.value)} aria-label="PCAF score"><option value="">All scores</option>{([1, 2, 3, 4, 5] as Score[]).map((s) => <option key={s} value={s}>{s} · {SCORE_SHORT[s]}</option>)}<option value="none">No result</option></select>
              <span className="grow" />
              {editable && <button className="btn sm" onClick={() => setDrawer('holding-new')}>+ Holding</button>}
              {editable && <button className="btn sm p" onClick={() => setDrawer('import')}>Upload holdings</button>}
              <button className="btn sm" onClick={() => fin.exportPeriod(D.id, `ekofin-${P.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${D.as_of}.csv`).catch((e) => toast((e as Error).message))}>Export CSV</button>
              {!locked && meta.canLock && d.lines.length > 0 && <button className="btn sm" onClick={() => confirm('Lock this reporting date? The figures are kept as they are now and holdings can no longer change.') && act(() => fin.lock(D.id), 'Locked')}>Lock</button>}
              {locked && meta.canUnlock && <button className="btn sm" onClick={() => setDrawer('unlock')}>Unlock</button>}
              {!locked && meta.canManage && <button className="btn sm ghost danger" onClick={() => confirm(`Delete the reporting date ${dateLabel(D.as_of)} and its ${d.lines.length} holdings?`) && act(async () => { await fin.deletePeriod(D.id); pc.choose(P.id, null); }, 'Reporting date deleted')}>Delete date</button>}
            </div>
            <div className="scroll"><table className="t ftable">
              <thead><tr><th>Counterparty</th><th>Asset class</th><th className="num">Outstanding ({cur})</th><th className="num">Attribution</th><th className="ctr">Score</th><th className="num">Financed tCO₂e</th>{d.portfolio.includeScope3 && <th className="num">Scope 3 t</th>}<th /></tr></thead>
              <tbody>{lines.map((l) => (
                <tr key={l.id} className={`click${l.excluded ? ' dim' : ''}`} onClick={() => setDrawer({ line: l })}>
                  <td><b>{l.name}</b><div className="muted small">{[l.internalRef, l.sector, l.country].filter(Boolean).join(' · ')}</div></td>
                  <td className="small">{ASSET_SHORT[l.assetClass]}</td>
                  <td className="num">{money(l.outstanding)}{l.currency !== cur && <div className="muted small">{l.currency} {money(l.outstandingOrig)}</div>}</td>
                  <td className="num">{pct(l.result.attribution, 2)}</td>
                  <td className="ctr"><ScoreChip score={l.result.score} forced={!!l.forceScore} /></td>
                  <td className="num"><b>{tco2(l.result.financed?.total)}</b></td>
                  {d.portfolio.includeScope3 && <td className="num">{tco2(l.result.financed?.s3)}</td>}
                  <td className="ctr">{(l.result.warnings.length > 0 || l.excluded) && <span className="chip warn" title={[l.excluded, ...l.result.warnings].filter(Boolean).join('\n')}>{l.result.warnings.length || 1}</span>}</td>
                </tr>))}
                {!lines.length && <tr><td colSpan={8} className="empty">{d.lines.length ? 'No holdings match the filters.' : 'No holdings at this date yet. Upload the loan book or add holdings by hand.'}</td></tr>}</tbody>
              {d.lines.length > 0 && <tfoot><tr><td><b>{d.summary.holdings} holdings</b>{d.summary.missing ? <span className="muted small"> · {d.summary.missing} without a result</span> : null}</td><td />
                <td className="num"><b>{money(d.summary.outstanding)}</b></td><td /><td className="ctr small">{d.summary.score?.toFixed(2) ?? '—'}</td>
                <td className="num"><b>{tco2(d.summary.financed.total)}</b></td>{d.portfolio.includeScope3 && <td className="num">{tco2(d.summary.financed.s3)}</td>}<td /></tr></tfoot>}
            </table></div>
          </div>
        </>)}
      </>)}

      {(drawer === 'portfolio-new' || drawer === 'portfolio-edit') && <PortfolioDrawer meta={meta} p={drawer === 'portfolio-edit' ? P : null} onClose={() => setDrawer(null)}
        onDone={(id) => { setDrawer(null); if (id) pc.choose(id, null); reload(); }} />}
      {drawer === 'period' && P && <PeriodDrawer p={P} onClose={() => setDrawer(null)} onDone={(id) => { setDrawer(null); pc.choose(P.id, id); reload(); }} />}
      {drawer === 'import' && D && <ImportDrawer periodId={D.id} has={d?.lines.length ?? 0} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer === 'holding-new' && D && <HoldingDrawer meta={meta} periodId={D.id} cur={cur} line={null} editable onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer === 'unlock' && D && <UnlockDrawer periodId={D.id} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
      {drawer && typeof drawer === 'object' && D && <HoldingDrawer meta={meta} periodId={D.id} cur={cur} line={drawer.line} editable={editable} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); reload(); }} />}
    </div>);
}

function PortfolioDrawer({ meta, p, onClose, onDone }: { meta: FinMeta; p: FinPortfolio | null; onClose: () => void; onDone: (id?: string) => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: p?.name ?? '', kind: p?.kind ?? 'loan_book', currency: p?.currency ?? 'USD', factorLibrary: p?.factor_library ?? meta.libraries[0]?.library ?? '', includeScope3: p?.include_scope3 ?? false, description: p?.description ?? '', archived: p?.archived ?? false });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const save = async (close: () => void) => {
    try {
      const r = await fin.savePortfolio({ ...f, name: f.name.trim(), currency: f.currency.toUpperCase(), factorLibrary: f.factorLibrary || null }, p?.id);
      toast(p ? 'Saved' : 'Portfolio created'); close(); onDone(r.id);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <Drawer eyebrow={productName('ekofin')} title={p ? 'Portfolio settings' : 'New portfolio'} onClose={onClose} foot={(close) => <>
      {p && meta.canManage && <button className="btn ghost danger" onClick={() => confirm(`Delete ${p.name} with all its reporting dates and holdings?`) && fin.deletePortfolio(p.id).then(() => { toast('Deleted'); close(); onDone(); }).catch((e) => toast((e as Error).message))}>Delete</button>}
      <span className="grow" /><button className="btn" onClick={close}>Cancel</button><button className="btn p" disabled={f.name.trim().length < 2 || !/^[A-Za-z]{3}$/.test(f.currency)} onClick={() => save(close)}>{p ? 'Save' : 'Create'}</button></>}>
      <div className="vform">
        <label className="field span2"><span>Name</span><input className="input" value={f.name} placeholder="e.g. Corporate loan book" onChange={(e) => up({ name: e.target.value })} /></label>
        <label className="field"><span>Type</span><select className="input" value={f.kind} onChange={(e) => up({ kind: e.target.value })}>{Object.entries(meta.kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Reporting currency</span><input className="input" maxLength={3} value={f.currency} onChange={(e) => up({ currency: e.target.value.toUpperCase() })} /></label>
        <label className="field span2"><span>Sector factor library (for estimates, scores 4 and 5)</span><select className="input" value={f.factorLibrary} onChange={(e) => up({ factorLibrary: e.target.value })}>
          <option value="">None</option>{meta.libraries.map((l) => <option key={l.library} value={l.library}>{l.library} · {l.n} factors · {l.from_year}–{l.to_year}</option>)}</select></label>
        {!meta.libraries.length && <div className="note warn small span2">No sector factor library is loaded yet. Ekobon loads one in the platform console; until then only reported emissions give results.</div>}
        <label className="row chkline span2" style={{ gap: 6 }}><input type="checkbox" checked={f.includeScope3} onChange={(e) => up({ includeScope3: e.target.checked })} />Show the counterparties' Scope 3 (reported separately from Scope 1+2)</label>
        <label className="field span2"><span>Description</span><textarea className="input" rows={2} value={f.description} onChange={(e) => up({ description: e.target.value })} /></label>
        {p && <label className="row chkline span2" style={{ gap: 6 }}><input type="checkbox" checked={f.archived} onChange={(e) => up({ archived: e.target.checked })} />Archived (kept, hidden from the default choice)</label>}
      </div>
    </Drawer>);
}

function PeriodDrawer({ p, onClose, onDone }: { p: FinPortfolio; onClose: () => void; onDone: (id: string) => void }) {
  const { toast } = useApp();
  const [asOf, setAsOf] = useState(`${new Date().getUTCFullYear() - 1}-12-31`);
  const [copy, setCopy] = useState(p.periods[0]?.id ?? '');
  return (
    <Drawer eyebrow={p.name} title="New reporting date" onClose={onClose} foot={(close) => <><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={!asOf} onClick={async () => { try { const r = await fin.addPeriod(p.id, { asOf, copyFrom: copy || null }); toast(r.copied ? `Created with ${r.copied} holdings copied` : 'Created'); close(); onDone(r.id); } catch (e) { toast((e as Error).message); } }}>Create</button></>}>
      <label className="field"><span>Date of the outstanding amounts</span><input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
      <label className="field"><span>Start from</span><select className="input" value={copy} onChange={(e) => setCopy(e.target.value)}>
        <option value="">Empty (upload or add holdings)</option>{p.periods.map((x) => <option key={x.id} value={x.id}>Copy the {x.holdings} holdings of {dateLabel(x.as_of)}</option>)}</select></label>
      <div className="muted small">Copied holdings keep their amounts; update them with a new upload (replace) or one by one. Financials and emissions belong to the counterparty, so each date uses the newest year up to its own.</div>
    </Drawer>);
}

function UnlockDrawer({ periodId, onClose, onDone }: { periodId: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [reason, setReason] = useState('');
  return (
    <Drawer title="Unlock reporting date" onClose={onClose} foot={(close) => <><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={reason.trim().length < 5} onClick={async () => { try { await fin.unlock(periodId, reason.trim()); toast('Unlocked'); close(); onDone(); } catch (e) { toast((e as Error).message); } }}>Unlock</button></>}>
      <div className="note warn small">The kept figures are discarded and recalculated from the current data. The reason goes to the audit log.</div>
      <label className="field"><span>Reason</span><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Restatement after the auditor corrected two exposures" /></label>
    </Drawer>);
}

function ImportDrawer({ periodId, has, onClose, onDone }: { periodId: string; has: number; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'add' | 'replace'>(has ? 'replace' : 'add');
  const [r, setR] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = async (f: File) => { setFile(f); setR(null); setBusy(true); try { setR(await fin.importBook(periodId, f, false, mode)); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const commit = async (close: () => void) => {
    if (!file) return; setBusy(true);
    try { const x = await fin.importBook(periodId, file, true, mode); toast(`${x.saved.holdings} holdings saved · ${x.saved.counterparties} new counterparties`); close(); onDone(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Drawer eyebrow={productName('ekofin')} title="Upload holdings" wide onClose={onClose} foot={(close) => <><button className="btn" onClick={() => fin.template()}>Download the template</button><span className="grow" /><button className="btn" onClick={close}>Cancel</button>
      <button className="btn p" disabled={busy || !r || r.totals.error > 0 || !r.totals.rows} onClick={() => commit(close)}>{busy ? 'Working…' : `Save ${r?.totals.rows ?? ''} holdings`}</button></>}>
      <div className="muted small">Excel (.xlsx) or CSV from your loan or positions system. Columns are found by their headings: counterparty name and outstanding amount are needed; LEI, ISIN, customer ID, country, sector code, asset class, currency, and the company's financials and reported emissions are used when present.</div>
      <div className="row">
        <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => e.target.files?.[0] && preview(e.target.files[0])} />
        {has > 0 && <div className="seg"><button className={mode === 'replace' ? 'on' : ''} onClick={() => { setMode('replace'); if (file) preview(file); }}>Replace the {has} holdings</button><button className={mode === 'add' ? 'on' : ''} onClick={() => { setMode('add'); if (file) preview(file); }}>Add to them</button></div>}
      </div>
      {busy && !r && <div className="muted">Reading the file…</div>}
      {r && <>
        <div className="row small" style={{ gap: 8 }}><span className="chip">{r.totals.match} matched to counterparties on record</span><span className="chip info">{r.totals.new} new counterparties</span>{r.totals.error > 0 && <span className="chip bad">{r.totals.error} rows with problems</span>}</div>
        <div className="muted small">Columns used: {Object.entries(r.columns).map(([k, v]) => `${v} → ${k}`).join(' · ')}</div>
        {r.totals.error > 0 && <div className="note bad small">Fix the rows with problems in the file and choose it again. Nothing is saved while a row has a problem.</div>}
        <div className="scroll" style={{ maxHeight: 360 }}><table className="t">
          <thead><tr><th className="num">Row</th><th>Counterparty</th><th /><th>What happens</th></tr></thead>
          <tbody>{[...r.rows].sort((a, b) => Number(b.action === 'error') - Number(a.action === 'error')).map((x) => (
            <tr key={x.row}><td className="num small">{x.row}</td><td><b>{x.name}</b></td>
              <td>{x.action === 'error' ? <span className="chip bad">problem</span> : x.action === 'new' ? <span className="chip info">new</span> : <span className="chip">matched</span>}</td>
              <td className={`small${x.action === 'error' ? ' bad' : ''}`}>{x.detail}</td></tr>))}</tbody>
        </table></div>
      </>}
    </Drawer>);
}

/** A holding: how its result was reached (formula, inputs, layer), the layer choice, and editing. */
function HoldingDrawer({ meta, periodId, cur, line, editable, onClose, onDone }: { meta: FinMeta; periodId: string; cur: string; line: FinLine | null; editable: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [cp, setCp] = useState<{ id: string; name: string } | null>(line ? { id: line.counterpartyId, name: line.name } : null);
  const [f, setF] = useState({ assetClass: (line?.assetClass ?? 'business_loan') as AssetClass, outstanding: line ? String(line.outstandingOrig) : '', currency: line?.currency ?? cur, internalRef: line?.internalRef ?? '', origination: '', note: '' });
  const [layer, setLayer] = useState<string>(line?.forceScore ? String(line.forceScore) : ''), [reason, setReason] = useState(line?.forceReason ?? '');
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const amount = parseAmount(f.outstanding);
  const valid = !!cp && amount != null && !Number.isNaN(amount) && amount >= 0 && /^[A-Za-z]{3}$/.test(f.currency);
  const save = async (close: () => void) => {
    if (!valid) return;
    const b = { counterpartyId: cp!.id, assetClass: f.assetClass, outstanding: amount!, currency: f.currency.toUpperCase(), internalRef: f.internalRef.trim() || null, origination: f.origination || null, note: f.note };
    try { if (line) await fin.saveHolding(line.id, b); else await fin.addHolding(periodId, b); toast(line ? 'Saved' : 'Holding added'); close(); onDone(); } catch (e) { toast((e as Error).message); }
  };
  const R = line?.result;
  return (
    <Drawer eyebrow={line ? ASSET_SHORT[line.assetClass] : productName('ekofin')} title={line ? line.name : 'Add a holding'} wide onClose={onClose} foot={(close) => <>
      {line && editable && <button className="btn ghost danger" onClick={() => confirm('Remove this holding?') && fin.deleteHolding(line.id).then(() => { toast('Removed'); close(); onDone(); }).catch((e) => toast((e as Error).message))}>Remove</button>}
      {line && <Link className="btn" to={`/fin/counterparties/${line.counterpartyId}`}>Counterparty profile</Link>}
      <span className="grow" /><button className="btn" onClick={close}>Close</button>{editable && <button className="btn p" disabled={!valid} onClick={() => save(close)}>{line ? 'Save' : 'Add holding'}</button>}</>}>
      {R && <div className="card" style={{ background: '#F8FAF9' }}>
        <div className="row"><ScoreChip score={R.score} forced={!!line!.forceScore} /><b className="grow">{R.score ? meta.scores[R.score] : 'No result'}</b><b>{tco2(R.financed?.total)} tCO₂e</b><span className="muted small">Scope 1+2 financed</span></div>
        <ol className="small" style={{ margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>{R.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        {(line!.excluded || R.warnings.length > 0) && <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--warn)' }}>{[line!.excluded, ...R.warnings].filter(Boolean).map((w) => <li key={w!}>{w}</li>)}</ul>}
        {R.available.length > 0 && <div className="muted small" style={{ marginTop: 6 }}>Layers that can be calculated: {R.available.map((s) => `${s} (${SCORE_SHORT[s]})`).join(', ')}</div>}
      </div>}
      {line && editable && meta.canLayer && R && R.available.length > 1 && (
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field"><span>Layer used</span><select className="input" value={layer} onChange={(e) => setLayer(e.target.value)}>
            <option value="">Best available</option>{R.available.map((s) => <option key={s} value={s}>{s} · {SCORE_SHORT[s]}</option>)}</select></label>
          {layer && <label className="field grow"><span>Why (goes to the audit log)</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
          <button className="btn sm" disabled={!!layer && reason.trim().length < 3} onClick={() => fin.setLayer(line.id, layer ? (Number(layer) as Score) : null, reason.trim()).then(() => { toast('Layer saved'); onDone(); }).catch((e) => toast((e as Error).message))}>Apply</button>
        </div>)}
      {editable ? (
        <div className="vform">
          <div className="field span2"><span>Counterparty</span><CounterpartyPicker value={cp} onChange={setCp} /></div>
          <label className="field"><span>Asset class</span><select className="input" value={f.assetClass} onChange={(e) => up({ assetClass: e.target.value as AssetClass })}>{Object.entries(meta.assetClasses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Loan / position ID</span><input className="input" value={f.internalRef} onChange={(e) => up({ internalRef: e.target.value })} /></label>
          <label className="field"><span>Outstanding at the reporting date</span><input className="input num" inputMode="decimal" value={f.outstanding} placeholder="e.g. 25,000,000 or 25m" onChange={(e) => up({ outstanding: e.target.value })} />
            {amount != null && !Number.isNaN(amount) && <small className="muted">{fullAmount(amount)}</small>}</label>
          <label className="field"><span>Currency</span><input className="input" maxLength={3} value={f.currency} onChange={(e) => up({ currency: e.target.value.toUpperCase() })} /></label>
          {!line && <label className="field"><span>Origination date (optional)</span><input className="input" type="date" value={f.origination} onChange={(e) => up({ origination: e.target.value })} /></label>}
        </div>
      ) : line && <div className="muted small">Outstanding {line.currency} {fullAmount(line.outstandingOrig)}{line.internalRef ? ` · ${line.internalRef}` : ''}. This date is locked or you cannot edit holdings.</div>}
    </Drawer>);
}

/** Search the counterparty register; create a new one by name when it is not there. */
export function CounterpartyPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const { toast } = useApp();
  const [q, setQ] = useState(''), [hits, setHits] = useState<Counterparty[]>([]);
  useEffect(() => { if (q.trim().length < 2) { setHits([]); return; } const t = window.setTimeout(() => fin.counterparties(q.trim()).then((r) => setHits(r.counterparties.slice(0, 8))).catch(() => {}), 250); return () => window.clearTimeout(t); }, [q]);
  if (value) return <div className="row"><b className="grow">{value.name}</b><button className="btn sm" onClick={() => onChange(null)}>Change</button></div>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <input className="input" placeholder="Name, LEI, ISIN or customer ID" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {hits.map((h) => <button key={h.id} className="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={() => onChange({ id: h.id, name: h.name })}>{h.name}<span className="muted small">{[h.country, h.lei, h.isin, h.sector_code].filter(Boolean).join(' · ')}</span></button>)}
      {q.trim().length >= 2 && !hits.some((h) => h.name.toLowerCase() === q.trim().toLowerCase()) && (
        <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => fin.saveCounterparty({ name: q.trim(), country: null, lei: null, isin: null, localId: null, listed: false, sectorStandard: 'NACE', sectorCode: null, sectorName: null, contactEmail: null, note: '' })
          .then((r) => { onChange({ id: r.id!, name: q.trim() }); toast('Counterparty created: add its sector and financials on its profile'); }).catch((e) => toast((e as Error).message))}>+ Create “{q.trim()}”</button>)}
    </div>);
}
