/**
 * Carbon credits (Net zero): the credit portfolio (purchases by project, registry, type, vintage, quality
 * labels, delivery), retirements against a reporting year and purpose (approved by a second person), and the
 * year's gross emissions beside credits retired and net after credits. Credits never change the inventory.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type CreditData, type CreditLot, type CreditLotBody, type CreditRetirement } from '../lib/api';
import { Icon } from '../components/Icon';

const f0 = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 0 });
const f1 = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 1 });
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const money = (x: number, cur = 'USD') => `${cur} ${x.toLocaleString('en-GB', { maximumFractionDigits: x < 100 ? 2 : 0 })}`;
export const CAT_C: Record<string, string> = { avoidance: '#E9B44C', removal_nature: '#3E9B5F', removal_technical: '#6B4FA8' };
const CAT_S: Record<string, string> = { avoidance: 'Avoidance', removal_nature: 'Nature removal', removal_technical: 'Technical removal' };
const today = () => new Date().toISOString().slice(0, 10);

export function CarbonCredits() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const year = sp.get('year') ? Number(sp.get('year')) : undefined;
  const tab = sp.get('tab') === 'retirements' ? 'retirements' : 'portfolio';
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const [d, setD] = useState<CreditData | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<CreditLot | 'new' | null>(null);
  const [retiring, setRetiring] = useState<CreditLot | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [showCancelled, setShowCancelled] = useState(false);
  useEffect(() => { api.credits(year).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message); } };
  const lots = useMemo(() => (d?.lots ?? []).filter((l) => showCancelled || l.status !== 'cancelled'), [d, showCancelled]);
  if (!d) return <div className="page"><div className="card empty">Loading…</div></div>;
  const S = d.summary, pending = d.retirements.filter((r) => r.status === 'pending');
  const avail = d.lots.reduce((a, l) => a + l.available, 0);
  const nz = S.netZero, cover = nz.residual ? Math.min(1, nz.removalsHeld / nz.residual) : 0;
  return (
    <div className="page">
      <div className="row tahead" style={{ flexWrap: 'wrap' }}>
        <div className="grow"><span className="lbl">Net zero</span><h1>Carbon credits</h1>
          <div className="muted">Credits bought, held and retired. They are reported beside the inventory, never inside it: gross emissions stay as measured, and credits do not count towards reduction targets. Each retirement is approved by a second person before it counts.</div></div>
        <label className="field" style={{ minWidth: 120 }}><span>Reporting year</span>
          <select className="input" value={d.year} onChange={(e) => set('year', e.target.value)}>{d.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        {d.canEdit && <button className="btn p" onClick={() => setEditing('new')}>+ Record a purchase</button>}
      </div>

      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Gross emissions {d.year}</span><b>{f0(S.gross.total)} <small className="muted">t</small></b><span className="muted small">S1 {f0(S.gross.s1)} · S2 {f0(S.gross.s2)} · S3 {f0(S.gross.s3)} · approved entries</span></div>
        <div className="card kpi"><span className="muted small">Credits retired for {d.year}</span><b style={{ color: '#6B4FA8' }}>{f0(S.retired)} <small className="muted">t</small></b>
          <span className="muted small">{S.retired ? `${Math.round(S.removalShare * 100)}% removals` : 'none approved'}{S.pending ? ` · ${f1(S.pending)} t waiting` : ''}</span></div>
        <div className="card kpi"><span className="muted small">Net after credits</span><b>{f0(S.net)} <small className="muted">t</small></b><span className="muted small">shown beside gross, never instead</span></div>
        <div className="card kpi"><span className="muted small">Held and in the pipeline</span><b>{f0(avail + S.pipeline.contracted)} <small className="muted">t</small></b><span className="muted small">{f0(avail)} t delivered, not retired · {f0(S.pipeline.contracted)} t contracted</span></div>
      </div>

      <div className="ccgrid">
        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>{d.year}: gross emissions and credits</h3>
          <div className="ccbar" aria-label="Gross emissions and credits retired">
            <div className="ccrow"><span>Gross</span><div><i style={{ width: '100%', background: 'var(--s2)' }} /></div><b>{f0(S.gross.total)} t</b></div>
            <div className="ccrow"><span>Credits retired</span><div>{Object.entries(S.byCategory).filter(([, v]) => v > 0).map(([k, v]) => <i key={k} title={`${d.categories[k]}: ${f1(v)} t`} style={{ width: `${S.gross.total ? Math.min(100, (v / S.gross.total) * 100) : 0}%`, background: CAT_C[k] }} />)}</div><b>{f0(S.retired)} t</b></div>
            <div className="ccrow"><span>Net after credits</span><div><i style={{ width: `${S.gross.total ? Math.max(0, (S.net / S.gross.total) * 100) : 0}%`, background: 'var(--s1)' }} /></div><b>{f0(S.net)} t</b></div>
          </div>
          <div className="lgd" style={{ marginTop: 8 }}>{Object.entries(d.categories).map(([k, v]) => <span key={k}><i style={{ background: CAT_C[k] }} />{v}{S.byCategory[k] ? ` · ${f1(S.byCategory[k]!)} t` : ''}</span>)}</div>
          {S.retired > 0 && <div className="muted small" style={{ marginTop: 6 }}>By purpose: {Object.entries(S.byPurpose).filter(([, v]) => v > 0).map(([k, v]) => `${d.purposes[k]} ${f1(v)} t`).join(' · ')}{S.cost ? ` · cost ${money(S.cost)}` : ''}</div>}
        </div>
        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>Residual emissions at net zero ({nz.year})</h3>
          <div className="muted small">Target residual: {nz.residPct}% of the {nz.baseYear} base year ({f0(nz.baseTotal)} t) = <b>{f0(nz.residual)} t a year</b>, to be neutralised by permanent removals. Removals held or contracted:</div>
          <div className="ccmeter"><i style={{ width: `${cover * 100}%` }} /></div>
          <div className="small"><b>{f0(nz.removalsHeld)} t</b> <span className="muted">· {Math.round(cover * 100)}% of one year's residual</span></div>
          <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.55 }}>
            <li>Report gross emissions first; credits separately (GHG Protocol).</li>
            <li>SBTi targets count reductions only. Before net zero, credits can be bought as beyond value chain mitigation.</li>
            <li>Prefer credits with the ICVCM CCP label; a corresponding adjustment is needed for some claims.</li>
          </ul>
        </div>
      </div>

      <div className="seg strong" role="tablist">
        <button role="tab" aria-selected={tab === 'portfolio'} className={tab === 'portfolio' ? 'on' : ''} onClick={() => set('tab', null)}>Portfolio ({d.lots.filter((l) => l.status !== 'cancelled').length})</button>
        <button role="tab" aria-selected={tab === 'retirements'} className={tab === 'retirements' ? 'on' : ''} onClick={() => set('tab', 'retirements')}>Retirements{pending.length ? ` · ${pending.length} waiting` : ''}</button>
      </div>

      {tab === 'portfolio' ? (
        <div className="card flush">
          <div className="row vfilters"><span className="grow muted small">One line per purchase (lot). Retire credits from a delivered lot once they are cancelled on the registry.</span>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancelled</label></div>
          {!lots.length ? <div className="empty" style={{ padding: 24 }}>No carbon credits recorded yet.{d.canEdit ? ' Record a purchase to start the register.' : ''}</div> : (
            <div className="scroll"><table className="t cctable">
              <thead><tr><th>Project</th><th>Type</th><th className="num">Vintage</th><th className="num">Quantity</th><th>Use</th><th className="num">Price</th><th>Status</th><th>Labels</th><th /></tr></thead>
              <tbody>{lots.map((l) => (
                <tr key={l.id} className={l.status === 'cancelled' ? 'dim' : ''}>
                  <td style={{ minWidth: 230 }}><b>{l.project}</b><div className="muted small">{l.registry}{l.project_id ? ` · ${l.project_id}` : ''}{l.methodology ? ` · ${l.methodology}` : ''}{l.country ? ` · ${l.country}` : ''}</div>
                    {l.supplier && <div className="muted small">Bought from {l.supplier}{l.contract_date ? ` · ${d8(l.contract_date)}` : ''}</div>}{l.document && <div className="small"><Icon name="doc" /> {l.document}</div>}</td>
                  <td className="small"><span className="ccdot" style={{ background: CAT_C[l.category] }} />{CAT_S[l.category]}{l.project_type && <div className="muted">{l.project_type}</div>}{l.permanence && <div className="muted">{l.permanence}</div>}</td>
                  <td className="num small">{l.vintage}</td>
                  <td className="num small"><b>{f1(l.quantity)} t</b></td>
                  <td className="small" style={{ minWidth: 150 }}>
                    <div className="ccuse"><i style={{ width: `${(l.retired / l.quantity) * 100}%`, background: '#6B4FA8' }} /><i style={{ width: `${(l.waiting / l.quantity) * 100}%`, background: '#C9B8E8' }} /></div>
                    <span className="muted">{f1(l.retired)} retired{l.waiting ? ` · ${f1(l.waiting)} waiting` : ''}{l.status === 'delivered' ? ` · ${f1(l.available)} available` : ''}</span></td>
                  <td className="num small">{l.price != null ? `${l.currency} ${f1(l.price)}/t` : '—'}</td>
                  <td>{l.status === 'delivered' ? <span className="chip">Delivered</span> : l.status === 'contracted' ? <span className="chip info">Contracted</span> : <span className="chip grey">Cancelled</span>}
                    {l.delivered_on && <div className="muted small">{d8(l.delivered_on)}</div>}</td>
                  <td className="small">{[l.ccp && 'CCP', l.corsia && 'CORSIA', l.ca && 'Corresponding adj.'].filter(Boolean).map((x) => <span key={x as string} className="chip grey" style={{ marginRight: 4 }}>{x}</span>)}</td>
                  <td className="nowrap">{d.canEdit && <>
                    {l.status === 'delivered' && l.available > 0 && <button className="btn sm p" onClick={() => setRetiring(l)}>Retire</button>}{' '}
                    <button className="btn sm" onClick={() => setEditing(l)}>Edit</button></>}</td>
                </tr>))}</tbody>
            </table></div>)}
        </div>
      ) : (
        <div className="card flush">
          {!d.retirements.length ? <div className="empty" style={{ padding: 24 }}>No retirements recorded.</div> : (
            <div className="scroll"><table className="t cctable">
              <thead><tr><th>Retired</th><th>Project</th><th className="num">Tonnes</th><th>For year · purpose</th><th>Registry record</th><th>Status</th><th>Recorded / decided</th></tr></thead>
              <tbody>{d.retirements.map((r) => <RetRow key={r.id} r={r} d={d} note={note[r.id] ?? ''} setNote={(v) => setNote({ ...note, [r.id]: v })} act={act} />)}</tbody>
            </table></div>)}
        </div>
      )}
      {editing && <LotDrawer d={d} lot={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {retiring && <RetireDrawer d={d} lot={retiring} onClose={() => setRetiring(null)} onDone={() => { setRetiring(null); set('tab', 'retirements'); reload(); }} />}
    </div>);
}

function RetRow({ r, d, note, setNote, act }: { r: CreditRetirement; d: CreditData; note: string; setNote: (v: string) => void; act: (fn: () => Promise<unknown>, msg: string) => Promise<void> }) {
  const st: [string, string] = r.status === 'pending' ? ['warn', 'Waiting for approval'] : r.status === 'approved' ? ['', 'Approved · counts'] : r.status === 'rejected' ? ['bad', 'Rejected'] : ['grey', 'Withdrawn'];
  return (
    <tr className={r.status === 'withdrawn' || r.status === 'rejected' ? 'dim' : ''}>
      <td className="small nowrap">{d8(r.retired_on)}</td>
      <td style={{ minWidth: 200 }}><b>{r.project}</b><div className="muted small"><span className="ccdot" style={{ background: CAT_C[r.category] }} />{CAT_S[r.category]} · vintage {r.vintage} · {r.registry}</div></td>
      <td className="num small"><b>{f1(r.quantity)}</b></td>
      <td className="small"><b>{r.claim_year}</b><div className="muted">{d.purposes[r.purpose]}</div></td>
      <td className="small">{r.serials && <div className="mono">{r.serials}</div>}{r.beneficiary && <div className="muted">On behalf of {r.beneficiary}</div>}
        {r.registry_url && <div><a href={r.registry_url} target="_blank" rel="noreferrer noopener">Registry record ↗</a></div>}{r.document && <div><Icon name="doc" /> {r.document}</div>}{r.note && <div className="muted">{r.note}</div>}</td>
      <td><span className={`chip ${st[0]}`}>{st[1]}</span></td>
      <td className="small">{r.proposed_name} · {d8(r.proposed_at)}{r.decided_name && r.status !== 'pending' && <div className="muted">{r.status} by {r.decided_name} · {d8(r.decided_at)}</div>}
        {r.decision_note && <div className="muted">“{r.decision_note}”</div>}
        {r.status === 'pending' && d.canDecide && !r.mine && (
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <input className="input sm grow" placeholder="Note (needed to reject)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn sm" onClick={() => act(() => api.creditDecide(r.id, 'reject', note), 'Rejected')}>Reject</button>
            <button className="btn sm p" onClick={() => act(() => api.creditDecide(r.id, 'approve', note || undefined), `Approved: ${f1(r.quantity)} t count for ${r.claim_year}`)}>Approve</button>
          </div>)}
        {r.status === 'pending' && r.mine && <div style={{ marginTop: 6 }}><span className="muted">Another super admin or admin approves it. </span><button className="btn sm" onClick={() => act(() => api.creditWithdraw(r.id), 'Withdrawn')}>Withdraw</button></div>}
      </td>
    </tr>);
}

const blank = (): Record<keyof CreditLotBody, string | boolean> => ({
  project: '', projectId: '', registry: 'Verra (VCS)', methodology: '', category: 'removal_nature', projectType: '', country: '', vintage: String(new Date().getFullYear() - 1), quantity: '', price: '',
  currency: 'USD', supplier: '', contractDate: '', status: 'contracted', deliveredOn: '', serials: '', ccp: false, corsia: false, ca: false, permanence: '', documentId: '', notes: '',
});

function LotDrawer({ d, lot, onClose, onDone }: { d: CreditData; lot: CreditLot | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState(() => lot ? {
    project: lot.project, projectId: lot.project_id ?? '', registry: lot.registry, methodology: lot.methodology ?? '', category: lot.category, projectType: lot.project_type ?? '', country: lot.country ?? '',
    vintage: String(lot.vintage), quantity: String(lot.quantity), price: lot.price != null ? String(lot.price) : '', currency: lot.currency, supplier: lot.supplier ?? '', contractDate: lot.contract_date?.slice(0, 10) ?? '',
    status: lot.status, deliveredOn: lot.delivered_on?.slice(0, 10) ?? '', serials: lot.serials ?? '', ccp: lot.ccp, corsia: lot.corsia, ca: lot.ca, permanence: lot.permanence ?? '', documentId: lot.document_id ?? '', notes: lot.notes,
  } : blank());
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const [busy, setBusy] = useState(false);
  const s = (k: keyof CreditLotBody) => String(f[k]);
  const used = lot ? lot.retired + lot.waiting : 0;
  const save = async () => {
    setBusy(true);
    const o = (k: keyof CreditLotBody) => s(k).trim() || null;
    try {
      await api.creditLotSave({
        project: s('project').trim(), projectId: o('projectId'), registry: s('registry'), methodology: o('methodology'), category: s('category'), projectType: o('projectType'), country: o('country'),
        vintage: Number(s('vintage')), quantity: Number(s('quantity')), price: s('price').trim() === '' ? null : Number(s('price')), currency: s('currency').toUpperCase(), supplier: o('supplier'),
        contractDate: o('contractDate'), status: s('status'), deliveredOn: s('status') === 'delivered' ? (o('deliveredOn') ?? today()) : null, serials: o('serials'),
        ccp: !!f.ccp, corsia: !!f.corsia, ca: !!f.ca, permanence: o('permanence'), documentId: o('documentId'), notes: s('notes').trim(),
      }, lot?.id);
      toast(lot ? 'Saved' : 'Purchase recorded'); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const del = async () => { if (!lot) return; try { await api.creditLotDelete(lot.id); toast('Removed'); onDone(); } catch (e) { toast((e as Error).message); } };
  const txt = (k: keyof CreditLotBody, l: string, p = '', cls = 'field') => <label className={cls}><span>{l}</span><input className="input" value={s(k)} placeholder={p} onChange={(e) => up({ [k]: e.target.value })} /></label>;
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Carbon credits</div><h2>{lot ? 'Edit purchase' : 'Record a credit purchase'}</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <div className="vform">
          {txt('project', 'Project name', 'e.g. Mangrove restoration, Sindh', 'field span2')}
          <label className="field"><span>Registry / standard</span><select className="input" value={s('registry')} onChange={(e) => up({ registry: e.target.value })}>{[...new Set([...d.registries, s('registry')])].map((r) => <option key={r}>{r}</option>)}</select></label>
          {txt('projectId', 'Project ID on the registry', 'e.g. VCS 2250')}
          <label className="field"><span>Type</span><select className="input" value={s('category')} disabled={used > 0} onChange={(e) => up({ category: e.target.value })}>{Object.entries(d.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          {txt('projectType', 'Project type', s('category') === 'avoidance' ? 'e.g. Landfill gas capture' : s('category') === 'removal_technical' ? 'e.g. Biochar, DACCS' : 'e.g. Afforestation (ARR), blue carbon')}
          {txt('methodology', 'Methodology', 'e.g. VM0033')}
          {txt('country', 'Country')}
          <label className="field"><span>Vintage (year the reduction or removal happened)</span><input className="input num" inputMode="numeric" disabled={used > 0} value={s('vintage')} onChange={(e) => up({ vintage: e.target.value })} /></label>
          <label className="field"><span>Quantity · tCO₂e (credits){used ? ` · at least ${f1(used)}` : ''}</span><input className="input num" inputMode="decimal" value={s('quantity')} onChange={(e) => up({ quantity: e.target.value })} /></label>
          <label className="field"><span>Price per tonne</span><input className="input num" inputMode="decimal" value={s('price')} onChange={(e) => up({ price: e.target.value })} /></label>
          {txt('currency', 'Currency', 'USD')}
          {txt('supplier', 'Bought from (developer, broker, exchange)')}
          <label className="field"><span>Contract date</span><input className="input" type="date" value={s('contractDate')} onChange={(e) => up({ contractDate: e.target.value })} /></label>
          <label className="field"><span>Status</span><select className="input" value={s('status')} disabled={used > 0} onChange={(e) => up({ status: e.target.value })}>
            <option value="contracted">Contracted (not yet in our registry account)</option><option value="delivered">Delivered (in our registry account)</option><option value="cancelled">Cancelled (not delivered)</option></select></label>
          {s('status') === 'delivered' ? <label className="field"><span>Delivered on</span><input className="input" type="date" value={s('deliveredOn')} onChange={(e) => up({ deliveredOn: e.target.value })} /></label> : <div className="field" />}
          {txt('serials', 'Serial numbers (range)', '', 'field span2')}
          {txt('permanence', 'Permanence / durability', 'e.g. 1,000+ years; 40 years with buffer pool')}
          <label className="field"><span>Contract or certificate (Document vault)</span><select className="input" value={s('documentId')} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <div className="span2 row small" style={{ gap: 18, flexWrap: 'wrap' }}>
            {([['ccp', 'ICVCM CCP label'], ['corsia', 'CORSIA eligible'], ['ca', 'Corresponding adjustment (Article 6)']] as const).map(([k, l]) => (
              <label key={k} className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={!!f[k]} onChange={(e) => up({ [k]: e.target.checked })} />{l}</label>))}
          </div>
          <label className="field span2"><span>Notes (due diligence, ratings, co-benefits)</span><textarea className="input" rows={3} value={s('notes')} onChange={(e) => up({ notes: e.target.value })} /></label>
        </div>
        <div className="row">{lot && !used && <button className="btn" onClick={del}>Remove</button>}<span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button className="btn p" disabled={busy || s('project').trim().length < 2 || !(Number(s('quantity')) > 0) || !(Number(s('vintage')) >= 1990)} onClick={save}>{lot ? 'Save' : 'Record purchase'}</button></div>
      </div>
    </dialog>);
}

function RetireDrawer({ d, lot, onClose, onDone }: { d: CreditData; lot: CreditLot; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [f, setF] = useState({ quantity: String(lot.available), retiredOn: today(), claimYear: String(d.year), purpose: 'voluntary', serials: '', beneficiary: '', registryUrl: '', documentId: '', note: '' });
  const up = (x: Partial<typeof f>) => setF((o) => ({ ...o, ...x }));
  const [busy, setBusy] = useState(false);
  const q = Number(f.quantity);
  const save = async () => {
    setBusy(true);
    try {
      await api.creditRetire(lot.id, { quantity: q, retiredOn: f.retiredOn, claimYear: Number(f.claimYear), purpose: f.purpose, serials: f.serials.trim() || null, beneficiary: f.beneficiary.trim() || null,
        registryUrl: f.registryUrl.trim() || null, documentId: f.documentId || null, note: f.note.trim() });
      toast('Recorded — waiting for a second person to approve'); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">{lot.project} · vintage {lot.vintage}</div><h2>Record a retirement</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <div className="note info small">Retire (cancel) the credits on the registry first, then record them here with the serials and the registry's retirement statement. {f1(lot.available)} t of this lot are available.</div>
        <div className="vform">
          <label className="field"><span>Tonnes retired</span><input className="input num" inputMode="decimal" value={f.quantity} onChange={(e) => up({ quantity: e.target.value })} /></label>
          <label className="field"><span>Retired on (registry date)</span><input className="input" type="date" value={f.retiredOn} onChange={(e) => up({ retiredOn: e.target.value })} /></label>
          <label className="field"><span>Used for reporting year</span><input className="input num" inputMode="numeric" value={f.claimYear} onChange={(e) => up({ claimYear: e.target.value })} /></label>
          <label className="field"><span>Purpose</span><select className="input" value={f.purpose} onChange={(e) => up({ purpose: e.target.value })}>
            {Object.entries(d.purposes).map(([k, v]) => <option key={k} value={k} disabled={k === 'neutralisation' && lot.category === 'avoidance'}>{v}{k === 'neutralisation' && lot.category === 'avoidance' ? ' — removals only' : ''}</option>)}</select></label>
          <label className="field span2"><span>Serial numbers retired</span><input className="input mono" value={f.serials} onChange={(e) => up({ serials: e.target.value })} /></label>
          <label className="field"><span>Retired on behalf of (as on the statement)</span><input className="input" value={f.beneficiary} onChange={(e) => up({ beneficiary: e.target.value })} /></label>
          <label className="field"><span>Link to the public registry record</span><input className="input" value={f.registryUrl} placeholder="https://registry…" onChange={(e) => up({ registryUrl: e.target.value })} /></label>
          <label className="field span2"><span>Retirement statement (Document vault)</span><select className="input" value={f.documentId} onChange={(e) => up({ documentId: e.target.value })}><option value="">None</option>{d.documents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field span2"><span>Note</span><textarea className="input" rows={2} value={f.note} onChange={(e) => up({ note: e.target.value })} /></label>
        </div>
        <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button>
          <button className="btn p" disabled={busy || !(q > 0) || q > lot.available + 1e-9 || !f.retiredOn} onClick={save}>Record for approval</button></div>
      </div>
    </dialog>);
}
