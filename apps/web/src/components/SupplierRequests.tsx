/**
 * Suppliers → Supplier portal: invite suppliers to report for a year (access code shown once, optionally e-mailed),
 * follow their progress, review what they submit, and accept it (profile updated, chosen figures become
 * supplier-specific factors) or query it with a note.
 */
import { countryLabel } from '../lib/countries';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../App';
import { api, type Supplier, type SupplierPortalData, type SupplierRequestDetail } from '../lib/api';
import { SP_ESG_FACTS, SP_ESG_TOPIC, SP_DOCKIND, SP_STATUS, SP_TARGET, SP_VERIF, SP_BOUNDARY, nf } from '../lib/supplierPortal';
import { ItemPicker } from './ItemPicker';
import { Icon } from './Icon';

const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const t1 = (kg: number) => (kg / 1000).toLocaleString('en-GB', { maximumFractionDigits: kg < 10000 ? 1 : 0 });

export function SupplierRequests() {
  const { toast } = useApp();
  const [sp, setSp] = useSearchParams();
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [d, setD] = useState<SupplierPortalData | null>(null);
  const [tick, setTick] = useState(0);
  const [inviting, setInviting] = useState<{ id: string; name: string; email: string | null } | 'pick' | null>(null);
  const [code, setCode] = useState<{ supplier: string; email: string; code: string; expiresAt: string; emailed: boolean } | null>(null);
  const open = sp.get('request');
  const setOpen = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set('request', id); else n.delete('request'); setSp(n, { replace: true }); };
  useEffect(() => { api.supplierPortal(year).then(setD).catch((e) => toast((e as Error).message)); }, [year, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => setTick((t) => t + 1);
  // from the supplier list: "Engage suppliers" (?invite=1) or "Invite to the portal" on one supplier (?invite=<id>)
  const inv = sp.get('invite');
  useEffect(() => {
    if (!inv) return;
    const n = new URLSearchParams(sp); n.delete('invite'); setSp(n, { replace: true });
    if (inv === '1') setInviting('pick');
    else api.supplier(inv).then((r) => setInviting({ id: r.supplier.id, name: r.supplier.name, email: r.supplier.contact_email })).catch(() => setInviting('pick'));
  }, [inv]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  const by = (s: string) => d.requests.filter((r) => r.status === s).length;
  const answered = d.requests.filter((r) => r.status === 'accepted');
  const coveredKg = answered.reduce((a, r) => a + r.kg, 0);
  const newCode = async (id: string, supplier: string, email: string) => {
    try { const r = await api.supplierRequestCode(id, true); setCode({ supplier, email, ...r }); reload(); } catch (e) { toast((e as Error).message); }
  };
  const revoke = async (id: string) => { try { await api.supplierRequestRevoke(id); toast('Access removed'); reload(); } catch (e) { toast((e as Error).message); } };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <p className="muted small grow" style={{ margin: 0 }}>Ask suppliers for their own emissions, the share relating to your purchases, their climate targets and product footprints. They sign in at <b>/supplier</b> with their work e-mail and an access code — no account. Nothing they send is used until you accept it here.</p>
        <label className="field" style={{ minWidth: 120 }}><span>Reporting year</span><select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[0, 1, 2, 3].map((i) => new Date().getFullYear() - i).map((y) => <option key={y}>{y}</option>)}</select></label>
        {d.canManage && <button className="btn p" onClick={() => setInviting('pick')}>+ Invite a supplier</button>}
      </div>
      <div className="kgrid4">
        <div className="card kpi"><span className="muted small">Suppliers asked for {year}</span><b>{d.requests.filter((r) => !r.revoked).length}</b><span className="muted small">{by('invited')} not started · {by('in_progress')} in progress</span></div>
        <div className="card kpi"><span className="muted small">To review</span><b style={{ color: by('submitted') ? 'var(--warn)' : undefined }}>{by('submitted')}</b><span className="muted small">{by('queried')} sent back with a question</span></div>
        <div className="card kpi"><span className="muted small">Accepted</span><b>{by('accepted')}</b><span className="muted small">profile and factors applied</span></div>
        <div className="card kpi"><span className="muted small">Purchase emissions covered</span><b>{d.totalKg ? `${Math.round((coveredKg / d.totalKg) * 100)}%` : '—'}</b><span className="muted small">{t1(coveredKg)} of {t1(d.totalKg)} t from suppliers who answered</span></div>
      </div>
      <div className="card flush">
        {!d.requests.length ? <div className="empty" style={{ padding: 24 }}>No supplier asked for {year} yet.{d.suggest.length ? ' Start with the largest ones below.' : ''}</div> : (
          <div className="scroll"><table className="t sptable">
            <thead><tr><th>Supplier</th><th>Contact</th><th className="ctr">Status</th><th>Progress</th><th className="num">Your purchases tCO₂e</th><th className="num">Their figure for you</th><th>Due</th><th /></tr></thead>
            <tbody>{d.requests.map((r) => { const [c, t] = SP_STATUS[r.status]; return (
              <tr key={r.id} className={r.revoked ? 'dim' : ''}>
                <td style={{ minWidth: 190 }}><button className="linkbtn" style={{ textAlign: "left" }} onClick={() => setOpen(r.id)}><b>{r.supplier}</b></button>{r.country && <span className="muted small"> · {countryLabel(r.country)}</span>}</td>
                <td className="small">{r.contact_name ?? '—'}<div className="muted">{r.email}</div></td>
                <td><span className={`chip ${c}`}>{t}</span>{r.revoked && <div className="small muted">access removed</div>}{!r.revoked && r.expires_at && new Date(r.expires_at) < new Date() && <div className="small" style={{ color: 'var(--bad)' }}>code expired</div>}
                  {r.last_used_at && <div className="small muted">last seen {d8(r.last_used_at)}</div>}</td>
                <td style={{ minWidth: 120 }}><div className="brbar"><i style={{ width: `${(r.progress.n / r.progress.of) * 100}%`, background: 'var(--primary)' }} /></div><span className="small muted">{r.progress.n} of {r.progress.of} sections{r.documents ? ` · ${r.documents} file${r.documents > 1 ? 's' : ''}` : ''}</span></td>
                <td className="num small">{r.kg ? t1(r.kg) : '—'}</td>
                <td className="num small">{r.derived.allocated != null ? <b>{nf(r.derived.allocated, 1)} t</b> : r.derived.intensity != null ? <span>{nf(r.derived.intensity, 3)} kg/{r.derived.currency}</span> : '—'}</td>
                <td className="small nowrap">{d8(r.due_date)}</td>
                <td><div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 150 }}>{r.status === 'submitted' ? <button className="btn sm p" onClick={() => setOpen(r.id)}>Review</button> : <button className="btn sm" onClick={() => setOpen(r.id)}>Open</button>}{' '}
                  {d.canManage && r.status !== 'accepted' && <button className="btn sm ghost" onClick={() => void newCode(r.id, r.supplier, r.email)}>New code</button>}
                  {d.canManage && !r.revoked && <button className="btn sm ghost" onClick={() => void revoke(r.id)}>Remove access</button>}</div></td>
              </tr>); })}</tbody>
          </table></div>)}
      </div>
      {d.suggest.length > 0 && <div className="card">
        <h3 style={{ margin: '0 0 4px' }}>Largest suppliers not asked yet</h3>
        <p className="muted small" style={{ margin: '0 0 8px' }}>By emissions from your {year} purchases. Their own data replaces spend-based averages where it matters most.</p>
        <table className="t"><tbody>{d.suggest.map((s) => <tr key={s.id}><td><b>{s.name}</b>{s.country && <span className="muted small"> · {countryLabel(s.country)}</span>}{s.has_factor && <> <span className="chip grey">has own factor</span></>}</td>
          <td className="num small">{t1(s.kg)} t</td><td className="num small muted">{d.totalKg ? `${((s.kg / d.totalKg) * 100).toFixed(1)}%` : ''}</td>
          <td className="num">{d.canManage && <button className="btn sm" onClick={() => setInviting({ id: s.id, name: s.name, email: s.contact_email })}>Invite</button>}</td></tr>)}</tbody></table>
      </div>}
      {inviting && <InviteDrawer year={year} pre={inviting === 'pick' ? null : inviting} onClose={() => setInviting(null)} onDone={(c) => { setInviting(null); setCode(c); reload(); }} />}
      {code && <CodeBox c={code} onClose={() => setCode(null)} />}
      {open && <ReviewDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>);
}

function CodeBox({ c, onClose }: { c: { supplier: string; email: string; code: string; expiresAt: string; emailed: boolean }; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const link = `${location.origin}/supplier`;
  return (
    <dialog ref={dlg} className="drawer" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Access for {c.supplier}</div><h2>Access code</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <div className="sp-code mono">{c.code.replace(/(.{5})/, '$1 ')}</div>
        <div className="note warn small">Shown only now. {c.emailed ? `The invitation with this code was queued to ${c.email} (it is sent once a mail server is set up).` : `Give it to ${c.email} yourself.`}</div>
        <table className="t kv"><tbody><tr><td>Sign in at</td><td className="mono">{link}</td></tr><tr><td>Work e-mail</td><td>{c.email}</td></tr><tr><td>Valid until</td><td>{d8(c.expiresAt)}</td></tr></tbody></table>
        <div className="row"><span className="grow" /><button className="btn" onClick={() => { void navigator.clipboard?.writeText(`Sign in: ${link}\nWork e-mail: ${c.email}\nAccess code: ${c.code}`); }}>Copy</button><button className="btn p" onClick={() => dlg.current?.close()}>Done</button></div>
      </div>
    </dialog>);
}

function InviteDrawer({ year, pre, onClose, onDone }: { year: number; pre: { id: string; name: string; email: string | null } | null; onClose: () => void; onDone: (c: { supplier: string; email: string; code: string; expiresAt: string; emailed: boolean }) => void }) {
  const { toast } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [sup, setSup] = useState<{ id: string; name: string } | null>(pre);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Supplier[]>([]);
  useEffect(() => { if (sup || q.trim().length < 2) { setHits([]); return; } const t = setTimeout(() => api.suppliers({ q, limit: 8 }).then((r) => setHits(r.suppliers)).catch(() => {}), 200); return () => clearTimeout(t); }, [q, sup]);
  const [f, setF] = useState({ email: pre?.email ?? '', contactName: '', message: `Please share your ${year} greenhouse-gas emissions data. It helps us measure our Scope 3 emissions accurately.`, dueDate: '', months: 6, sendEmail: true, shareEstimate: false });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!sup) return;
    setBusy(true);
    try { const r = await api.supplierInvite({ supplierId: sup.id, year, email: f.email.trim(), contactName: f.contactName.trim(), message: f.message.trim(), dueDate: f.dueDate || null, months: f.months, sendEmail: f.sendEmail, shareEstimate: f.shareEstimate }); onDone({ supplier: sup.name, email: f.email.trim().toLowerCase(), ...r }); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Supplier portal · {year}</div><h2>Invite a supplier</h2></div><button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        <div className="vform">
          <div className="field span2"><span>Supplier</span>{sup ? <div className="row" style={{ gap: 8 }}><b className="grow">{sup.name}</b>{!pre && <button className="btn sm ghost" onClick={() => setSup(null)}>Change</button>}</div> : <>
            <input className="input" placeholder="Search your suppliers…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
            {hits.length > 0 && <div className="sp-hits">{hits.map((h) => <button key={h.id} onClick={() => { setSup({ id: h.id, name: h.name }); if (!f.email && h.contact_email) setF({ ...f, email: h.contact_email }); }}>{h.name}<small>{h.country ?? ''}{h.co2e ? ` · ${t1(h.co2e)} t` : ''}</small></button>)}</div>}</>}</div>
          <label className="field"><span>Contact's work e-mail</span><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="field"><span>Contact's name</span><input className="input" value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></label>
          <label className="field span2"><span>Message to the supplier</span><textarea className="input" rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
          <label className="field"><span>Please answer by</span><input className="input" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></label>
          <label className="field"><span>Code valid for</span><select className="input" value={f.months} onChange={(e) => setF({ ...f, months: Number(e.target.value) })}>{[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''}</option>)}</select></label>
          <label className="span2 row small chkline" style={{ gap: 8 }}><input type="checkbox" checked={f.sendEmail} onChange={(e) => setF({ ...f, sendEmail: e.target.checked })} /><b>E-mail the invitation with the access code</b></label>
          <label className="span2 row small chkline" style={{ gap: 8 }}><input type="checkbox" checked={f.shareEstimate} onChange={(e) => setF({ ...f, shareEstimate: e.target.checked })} />
            <span><b>Show the supplier our estimate of its emissions in our report</b> <span className="muted">(tCO₂e from our {year} purchases from it — motivates suppliers, but shares a figure from your inventory)</span></span></label>
        </div>
        <div className="row"><span className="grow" /><button className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button className="btn p" disabled={busy || !sup || !/^\S+@\S+\.\S+$/.test(f.email.trim())} onClick={go}>Invite</button></div>
      </div>
    </dialog>);
}

function ReviewDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { toast, role } = useApp();
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { dlg.current?.showModal(); }, []);
  const [r, setR] = useState<SupplierRequestDetail | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { api.supplierRequest(id).then(setR).catch((e) => toast((e as Error).message)); }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [note, setNote] = useState('');
  const [prof, setProf] = useState(true);
  const [inten, setInten] = useState<{ use: boolean; itemId: number | null; itemName: string | null }>({ use: true, itemId: null, itemName: null });
  const [prods, setProds] = useState<Record<number, { use: boolean; itemId: number | null; itemName: string | null }>>({});
  const [busy, setBusy] = useState(false);
  const decide = async (decision: 'accept' | 'query') => {
    if (!r) return;
    setBusy(true);
    try {
      const res = await api.supplierRequestReview(id, { decision, note: note.trim() || undefined, profile: prof, intensity: { use: inten.use && r.derived.intensity != null, itemId: inten.itemId },
        products: Object.entries(prods).filter(([, v]) => v.use).map(([k, v]) => ({ index: Number(k), itemId: v.itemId })) });
      toast(decision === 'query' ? 'Sent back to the supplier' : `Accepted: ${res.applied?.factors.length ?? 0} factor(s) created${res.linesRecalculated ? `, ${res.linesRecalculated} purchase lines recalculated` : ''}`);
      setTick((t) => t + 1); onChanged();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const a = r?.answers ?? {}, inv = a.inventory ?? {}, p = a.profile ?? {}, t = a.targets ?? {};
  const can = r?.canManage && role !== 'platform_admin';
  const Row = ({ l, v }: { l: string; v: React.ReactNode }) => <tr><td>{l}</td><td>{v ?? '—'}</td></tr>;
  return (
    <dialog ref={dlg} className="drawer wide" onClose={onClose}>
      <div className="in">
        <div className="row"><div className="grow"><div className="eyebrow">Supplier portal · {r?.year}</div><h2>{r?.supplier ?? 'Supplier'}</h2>
          {r && <div className="small muted">{r.contact_name ?? ''} {r.email} · invited {d8(r.created_at)} by {r.created_by ?? '—'}{r.submitted_at ? ` · submitted ${d8(r.submitted_at)} by ${r.submitted_by}` : ''}</div>}</div>
          <button className="btn ghost" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button></div>
        {!r ? <div className="muted">Loading…</div> : <>
          <div className="row" style={{ gap: 8 }}><span className={`chip ${SP_STATUS[r.status][0]}`}>{SP_STATUS[r.status][1]}</span><span className="small muted">{r.progress.n} of {r.progress.of} sections</span>
            {r.review_note && <span className="small">· {r.status === 'queried' ? 'Asked' : 'Note'}: “{r.review_note}”</span>}</div>
          {r.issues.length > 0 && <div className="note bad small">{r.issues.map((x) => <div key={x}>{x}</div>)}<div>Query these answers rather than accepting them.</div></div>}
          {r.status === 'invited' && <div className="note info small">The supplier has not started yet{r.last_used_at ? '' : ' (never signed in)'}.</div>}
          <h3 className="sp-h3">Company</h3>
          <table className="t kv"><tbody>
            <Row l="Legal name" v={p.legalName} /><Row l="Country · registration" v={[p.country && countryLabel(p.country), p.trn].filter(Boolean).join(' · ') || null} />
            <Row l="Industry · size" v={[p.industry, p.size, p.employees != null ? `${p.employees} people` : null].filter(Boolean).join(' · ') || null} />
            <Row l="Contact" v={[p.contactName, p.contactRole, p.phone].filter(Boolean).join(' · ') || null} />
          </tbody></table>
          <h3 className="sp-h3">Emissions {r.year}</h3>
          <table className="t kv"><tbody>
            <Row l="Measured" v={inv.reports === 'no' ? 'Not measured yet' : inv.reports === 'partial' ? 'Partly (estimates)' : inv.reports === 'yes' ? 'Yes' : null} />
            {inv.reports && inv.reports !== 'no' && <>
              <Row l="Scope 1 · 2 (location / market) · 3" v={<><b>{nf(inv.scope1)}</b> · {nf(inv.scope2Location)} / {nf(inv.scope2Market)} · {nf(inv.scope3)} tCO₂e{inv.scope3Categories ? <div className="muted small">Scope 3: {inv.scope3Categories}</div> : null}</>} />
              <Row l="Boundary · standard" v={[inv.boundary ? SP_BOUNDARY[inv.boundary] : null, inv.standard].filter(Boolean).join(' · ') || null} />
              <Row l="Verification" v={inv.verification ? `${SP_VERIF[inv.verification]}${inv.verifier ? ` · ${inv.verifier}` : ''}` : null} />
              <Row l="Revenue · intensity" v={r.derived.intensity != null ? <>{nf(inv.revenue, 0)} {inv.currency} · <b>{nf(r.derived.intensity, 4)} kg CO₂e per {inv.currency}</b> (Scope 1+2)</> : null} />
            </>}
            <Row l="Relating to you" v={r.derived.allocated != null ? <><b>{nf(r.derived.allocated, 2)} tCO₂e</b>{a.allocation?.method === 'revenue' && r.derived.share != null ? ` · ${nf(r.derived.share * 100, 2)}% of their revenue` : ' · their own calculation'}</> : a.allocation?.method === 'none' ? 'Not given' : null} />
            {inv.notes && <Row l="Notes" v={inv.notes} />}{a.allocation?.notes && <Row l="How the share was worked out" v={a.allocation.notes} />}
          </tbody></table>
          <h3 className="sp-h3">Climate target</h3>
          <table className="t kv"><tbody><Row l="Target" v={t.status ? `${SP_TARGET[t.status]}${t.reductionPct != null ? ` · −${t.reductionPct}%${t.baseYear ? ` from ${t.baseYear}` : ''}${t.targetYear ? ` by ${t.targetYear}` : ''}` : ''}${t.scopes ? ` (${t.scopes})` : ''}${t.netZeroYear ? ` · net zero ${t.netZeroYear}` : ''}` : null} />
            {t.link && <Row l="Link" v={<a href={t.link} target="_blank" rel="noreferrer noopener">{t.link}</a>} />}</tbody></table>
          <h3 className="sp-h3">Product footprints</h3>
          {a.products?.none ? <div className="muted small">None.</div> : !a.products?.items?.length ? <div className="muted small">—</div> :
            <table className="t"><thead><tr><th>Product</th><th className="num">kg CO₂e</th><th>Standard · boundary</th><th>Valid</th>{can && r.status === 'submitted' && <th>Use as factor for</th>}</tr></thead>
              <tbody>{a.products.items.map((x, i) => <tr key={i}><td><b>{x.name}</b>{x.documentId && <div className="small"><a href={`/api/supplier-portal/documents/${x.documentId}`} target="_blank" rel="noreferrer">document</a></div>}</td>
                <td className="num">{nf(x.co2e, 4)} / {x.unit}</td><td className="small">{x.standard ?? '—'}{x.boundary ? ` · ${x.boundary}` : ''}{x.verified ? ' · verified' : ''}</td><td className="small">{x.validFrom ?? '—'} → {x.validTo ?? '—'}</td>
                {can && r.status === 'submitted' && <td style={{ minWidth: 220 }}><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!prods[i]?.use} onChange={(e) => setProds({ ...prods, [i]: { itemId: prods[i]?.itemId ?? null, itemName: prods[i]?.itemName ?? null, use: e.target.checked } })} />use</label>
                  {prods[i]?.use && <ItemPicker compact value={prods[i]!.itemId} valueName={prods[i]!.itemName ?? 'everything from this supplier'} onPick={(it) => setProds({ ...prods, [i]: { use: true, itemId: it?.id ?? null, itemName: it?.name ?? null } })} />}</td>}</tr>)}</tbody></table>}
          <h3 className="sp-h3">ESG impact — double materiality</h3>
          {!a.esg?.topics?.length && !a.esg?.facts ? <div className="muted small">Not answered (optional).</div> : <>
            {a.esg.topics?.length ? <table className="t"><thead><tr><th>Topic</th><th className="num">Their impact (0–5)</th><th className="num">Effect on them (0–5)</th><th>Main issue</th></tr></thead>
              <tbody>{a.esg.topics.map((x) => <tr key={x.topic}><td><b>{x.topic}</b> {SP_ESG_TOPIC[x.topic] ?? ''}</td><td className="num">{x.impact ?? '—'}</td><td className="num">{x.financial ?? '—'}</td><td className="small">{x.note ?? ''}</td></tr>)}</tbody></table> : null}
            <table className="t kv"><tbody>{SP_ESG_FACTS.filter(([k]) => a.esg?.facts?.[k] != null && a.esg.facts[k] !== '').map(([k, l, ty]) => { const v = a.esg!.facts![k]; return <Row key={k} l={l} v={ty === 'bool' ? (v ? 'Yes' : 'No') : ty === 'text' && /^https?:/.test(String(v)) ? <a href={String(v)} target="_blank" rel="noreferrer noopener">{String(v)}</a> : String(v)} />; })}</tbody></table>
            <div className="muted small">Feeds the supplier column of ESG & materiality → Double materiality once accepted or submitted.</div></>}
          <h3 className="sp-h3">Evidence</h3>
          {!r.documents.length ? <div className="muted small">No files.</div> : <ul className="sp-docs">{r.documents.map((x) => <li key={x.id}><span className="grow"><a href={`/api/supplier-portal/documents/${x.id}`} target="_blank" rel="noreferrer"><b>{x.filename}</b></a><small>{SP_DOCKIND[x.kind]}</small></span></li>)}</ul>}
          {r.status === 'accepted' && r.applied && <div className="note ok small">Accepted by {r.reviewed_by} on {d8(r.reviewed_at)}: profile fields {r.applied.profile.join(', ') || 'none'}; {r.applied.factors.length} factor(s) created{r.applied.linesRecalculated ? `; ${r.applied.linesRecalculated} open purchase lines recalculated` : ''}.</div>}
          {r.factors.length > 0 && <details className="small"><summary><b>Supplier factors on record ({r.factors.length})</b></summary>
            <table className="t"><tbody>{r.factors.map((f) => <tr key={f.id}><td>{nf(f.co2e, 4)} kg / {f.unit}</td><td>{f.item ?? 'everything from this supplier'}</td><td className="muted">{f.source}</td><td className="small">{f.valid_from?.slice(0, 10)} → {f.valid_to?.slice(0, 10)}</td></tr>)}</tbody></table></details>}
          {can && r.status === 'submitted' && <div className="card brsub">
            <b>Your decision</b>
            <label className="row small chkline" style={{ gap: 8 }}><input type="checkbox" checked={prof} onChange={(e) => setProf(e.target.checked)} />Update the supplier's profile (country, registration, industry, size, contact, reports emissions, climate target)</label>
            {r.derived.intensity != null && <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}><label className="row chkline" style={{ gap: 8 }}><input type="checkbox" checked={inten.use} onChange={(e) => setInten({ ...inten, use: e.target.checked })} />
              Use <b>{nf(r.derived.intensity, 4)} kg CO₂e per {r.derived.currency}</b> for purchases from {r.supplier} in {r.year}–{r.year + 1}, for</label>
              {inten.use && <div style={{ minWidth: 260 }}><ItemPicker compact value={inten.itemId} valueName={inten.itemName ?? 'everything bought from this supplier'} onPick={(it) => setInten({ ...inten, itemId: it?.id ?? null, itemName: it?.name ?? null })} /></div>}</div>}
            <label className="field"><span>Note to the supplier (needed to query)</span><textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div className="row" style={{ gap: 8 }}><span className="grow small muted">Accepting recalculates the supplier's purchase lines not yet published; published ones change when their batch is reopened.</span>
              <button className="btn" disabled={busy} onClick={() => void decide('query')}>Query</button><button className="btn p" disabled={busy} onClick={() => void decide('accept')}>Accept</button></div>
          </div>}
        </>}
      </div>
    </dialog>);
}
