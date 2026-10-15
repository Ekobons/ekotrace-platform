/**
 * Supplier portal (public page /supplier): a supplier's contact signs in with their work e-mail and the access code
 * from the invitation, answers the questionnaire section by section (saved as they go), attaches evidence and
 * submits. The customer reviews the answers before anything is used.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from '../components/BrandMark';
import { BRAND } from '../lib/brand';
import {
  SP_BOUNDARY, SP_DOCKIND, SP_STANDARDS, SP_STATUS, SP_TARGET, SP_UNITS, SP_VERIF, nf,
  type SPAnswers, type SPDerived, type SPDoc, type SPProduct, type SPProgress, type SPStatus,
} from '../lib/supplierPortal';

const TKEY = 'eko_supplier';
const getTok = () => { try { return sessionStorage.getItem(TKEY) ?? ''; } catch { return ''; } };
const setTok = (t: string) => { try { if (t) sessionStorage.setItem(TKEY, t); else sessionStorage.removeItem(TKEY); } catch { /* not kept */ } };

async function call<T>(method: string, path: string, body?: unknown, file?: File, extra: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-supplier-token': getTok(), ...extra };
  if (file) { headers['content-type'] = 'application/octet-stream'; headers['x-filename'] = encodeURIComponent(file.name); }
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`/api/public/supplier${path}`, { method, headers, body: file ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { setTok(''); throw Object.assign(new Error(d.message ?? 'Sign in again'), { signOut: true }); }
  if (!r.ok) throw new Error(d.message ?? `Request failed (${r.status})`);
  return d as T;
}

interface Me {
  id: string; year: number; contact_name: string | null; email: string; message: string; due_date: string | null; expires_at: string; status: SPStatus; answers: SPAnswers; documents: SPDoc[];
  submitted_at: string | null; submitted_by: string | null; review_note: string | null; supplier: string; company: string; company_currency: string; progress: SPProgress; derived: SPDerived; editable: boolean;
  score: { score: number; letter: string; parts: { key: string; label: string; points: number; max: number; note: string }[]; actions: string[] }; contribution: number | null;
}
type Step = 'profile' | 'inventory' | 'allocation' | 'targets' | 'products' | 'evidence' | 'submit';
const STEPS: [Step, string, string][] = [
  ['profile', 'Your company', 'Who you are and who to contact'], ['inventory', 'Emissions', 'Scope 1, 2 and 3 for the year'], ['allocation', 'Your share for us', 'Emissions relating to what we buy'],
  ['targets', 'Climate targets', 'Reduction and net-zero targets'], ['products', 'Product footprints', 'Carbon footprints of what you sell us'], ['evidence', 'Evidence', 'Reports, verification, EPDs'],
  ['submit', 'Review & submit', 'Check and send'],
];
const d8 = (x: string | null) => (x ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
const str = (x: number | null | undefined) => (x == null ? '' : String(x));

export function SupplierPortal() {
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!getTok()) { setMe(null); return; }
    try { setMe(await call<Me>('GET', '/me')); } catch (e) { setMe(null); if (!(e as { signOut?: boolean }).signOut) setErr((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.title = `Supplier portal · ${BRAND.name}`; }, []);
  const toast = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3500); };
  const out = async () => { await call('POST', '/logout').catch(() => {}); setTok(''); setMe(null); };
  return (
    <div className="cportal sportal">
      <header><BrandMark /><div><b>{BRAND.name}</b><small>Supplier portal</small></div><span className="grow" />
        {me && <><span className="small sp-who">{me.contact_name ?? me.email} · {me.supplier}</span><button className="btn sm ghost" onClick={() => void out()}>Sign out</button></>}</header>
      {!me ? <SignIn onDone={() => { setErr(null); void load(); }} err={err} /> : <Portal me={me} reload={load} toast={toast} />}
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>);
}

function SignIn({ onDone, err }: { onDone: () => void; err: string | null }) {
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [e, setE] = useState<string | null>(err); const [busy, setBusy] = useState(false);
  const go = async (ev: React.FormEvent) => {
    ev.preventDefault(); setBusy(true); setE(null);
    try { const r = await call<{ token: string }>('POST', '/login', { email, code }); setTok(r.token); onDone(); } catch (x) { setE((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="sp-signin">
      <div className="sp-intro">
        <span className="lbl">For suppliers</span>
        <h1>Share your emissions data with your customer</h1>
        <p>Your customer asked you, through {BRAND.name}, for your company's greenhouse-gas figures: your emissions, the part relating to what they buy from you, your climate targets and any product carbon footprints.</p>
        <ul><li>About 20–30 minutes; save and come back at any time.</li><li>Your customer reviews your answers before using them.</li><li>Only your customer sees what you send.</li></ul>
      </div>
      <form className="card csign" onSubmit={go}>
        <h2>Sign in</h2>
        <p className="muted small">Use the work e-mail the invitation was sent to and the access code in it.</p>
        <label className="field"><span>Work e-mail</span><input className="input" type="email" autoComplete="email" value={email} onChange={(x) => setEmail(x.target.value)} /></label>
        <label className="field"><span>Access code</span><input className="input mono" autoComplete="one-time-code" style={{ letterSpacing: '.12em', textTransform: 'uppercase' }} value={code} onChange={(x) => setCode(x.target.value)} /></label>
        {e && <div className="note bad">{e}</div>}
        <button className="btn p" disabled={busy || !email || !code}>{busy ? 'Checking…' : 'Sign in'}</button>
        <p className="muted small">No code, or it expired? Ask your contact at your customer for a new one.</p>
        <a className="muted small" href="/">Staff of the company: sign in here</a>
      </form>
    </div>);
}

function Portal({ me, reload, toast }: { me: Me; reload: () => Promise<void>; toast: (m: string) => void }) {
  const first = (STEPS.find(([k]) => k !== 'evidence' && k !== 'submit' && !me.progress.done[k as keyof SPProgress['done']])?.[0]) ?? 'submit';
  const [step, setStep] = useState<Step>(me.editable ? first : 'submit');
  const ro = !me.editable;
  const idx = STEPS.findIndex(([k]) => k === step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]![0]);
  const save = async (section: string, data: unknown, go = true) => {
    try { await call('PUT', '/answers', { section, data }); await reload(); toast('Saved'); if (go) next(); }
    catch (e) { toast((e as Error).message); }
  };
  const pct = Math.round((me.progress.n / me.progress.of) * 100);
  const [sc, st] = SP_STATUS[me.status];
  return <>
    <section className="sp-hero">
      <div className="grow">
        <span className="lbl">{me.company} · request for {me.year}</span>
        <h1>{me.supplier}</h1>
        <p>{me.company} asks for your {me.year} greenhouse-gas data.{me.due_date ? <> Please submit by <b>{d8(me.due_date)}</b>.</> : ''}</p>
        {me.message && <blockquote>{me.message}</blockquote>}
      </div>
      <div className="sp-prog">
        <div className="sp-ring" style={{ ['--p' as string]: `${pct}` }}><b>{me.progress.n}/{me.progress.of}</b><small>sections</small></div>
        <span className={`chip ${sc}`}>{st}</span>
      </div>
    </section>
    {me.status === 'queried' && me.review_note && <div className="note bad"><b>{me.company} asks you to check:</b> {me.review_note}<div className="small">Update the sections concerned and submit again.</div></div>}
    {me.status === 'submitted' && <div className="note info">Submitted on {d8(me.submitted_at)} by {me.submitted_by}. {me.company} is reviewing your answers; you will hear from them by e-mail.</div>}
    {me.status === 'accepted' && <div className="note ok">Thank you — {me.company} has reviewed and accepted your answers.</div>}
    <ScoreBox me={me} />
    <div className="sp-body">
      <nav className="sp-steps" aria-label="Sections">
        {STEPS.map(([k, l, sub], i) => {
          const done = k === 'evidence' ? me.documents.length > 0 : k === 'submit' ? ['submitted', 'accepted'].includes(me.status) : me.progress.done[k as keyof SPProgress['done']];
          return <button key={k} className={`${step === k ? 'on' : ''}${done ? ' done' : ''}`} onClick={() => setStep(k)}>
            <span className="n">{done ? '✓' : i + 1}</span><span><b>{l}</b><small>{sub}</small></span></button>;
        })}
      </nav>
      <div className="card sp-panel">
        {step === 'profile' && <Profile me={me} ro={ro} save={save} />}
        {step === 'inventory' && <Inventory me={me} ro={ro} save={save} reload={reload} toast={toast} />}
        {step === 'allocation' && <Allocation me={me} ro={ro} save={save} />}
        {step === 'targets' && <Targets me={me} ro={ro} save={save} />}
        {step === 'products' && <Products me={me} ro={ro} save={save} reload={reload} toast={toast} />}
        {step === 'evidence' && <Evidence me={me} ro={ro} reload={reload} toast={toast} next={next} />}
        {step === 'submit' && <Submit me={me} reload={reload} toast={toast} goto={setStep} />}
      </div>
    </div>
  </>;
}

const GRADE_C: Record<string, string> = { 'A+': '#0E7C66', A: '#2BA38A', B: '#7CC4A6', C: '#E9B44C', D: '#E39A5A', E: '#C2523C' };
function ScoreBox({ me }: { me: Me }) {
  const sc = me.score;
  const [open, setOpen] = useState(false);
  return (
    <section className="card sp-score">
      <div className="sp-sc-head">
        <span className="grade" style={{ width: 54, height: 54, fontSize: 22, background: GRADE_C[sc.letter] ?? '#9AA7A2' }}>{sc.letter}</span>
        <div><b className="sp-sc-n">{sc.score}<small>/100</small></b><div className="small muted">Your climate score{me.status === 'accepted' ? '' : ' with the answers so far'}</div></div>
        <div className="sp-scale" aria-hidden="true">{['A+', 'A', 'B', 'C', 'D', 'E'].map((l) => <span key={l} className={l === sc.letter ? 'on' : ''} style={{ background: GRADE_C[l] }}>{l}</span>)}</div>
        {me.contribution != null && <div className="sp-contrib"><b>{nf(me.contribution, 1)} tCO₂e</b><span className="small muted">{me.company}'s estimate of your emissions in its {me.year} report, from what it bought from you. Your own figures replace it.</span></div>}
        <button className="btn sm ghost" onClick={() => setOpen(!open)}>{open ? 'Hide details' : 'Score details and how to improve'}</button>
      </div>
      {open && <div className="sp-sc-body">
        <div className="sc-parts">{sc.parts.map((p) => <div key={p.key}><span className="small"><b>{p.label}</b> <span className="muted">{p.note}</span></span>
          <span className="sc-bar"><i style={{ width: `${(p.points / p.max) * 100}%` }} /></span><span className="small num">{p.points}/{p.max}</span></div>)}</div>
        {sc.actions.length > 0 && <div><b className="small">Recommended actions</b><ul className="small">{sc.actions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
        <p className="muted small" style={{ margin: 0 }}>The score is the same for every customer: measuring emissions (25), a reduction target (30), public disclosure such as CDP (15), sharing data with customers (20) and product footprints (10). A+ from 85, A 70, B 55, C 40, D 20.</p>
      </div>}
    </section>);
}

type SaveFn = (section: string, data: unknown, go?: boolean) => Promise<void>;
const Head = ({ t, sub }: { t: string; sub: ReactNode }) => <div className="sp-head"><h2>{t}</h2><p className="muted">{sub}</p></div>;
const Foot = ({ ro, onSave, ok = true, label = 'Save and continue' }: { ro: boolean; onSave: () => void; ok?: boolean; label?: string }) =>
  ro ? null : <div className="row sp-foot"><span className="grow muted small">Saved answers are kept; you can come back before submitting.</span><button className="btn p" disabled={!ok} onClick={onSave}>{label}</button></div>;

function Profile({ me, ro, save }: { me: Me; ro: boolean; save: SaveFn }) {
  const a = me.answers.profile ?? {};
  const [f, setF] = useState({ legalName: a.legalName ?? me.supplier, country: a.country ?? '', trn: a.trn ?? '', website: a.website ?? '', industry: a.industry ?? '', size: a.size ?? '',
    employees: str(a.employees), contactName: a.contactName ?? me.contact_name ?? '', contactRole: a.contactRole ?? '', phone: a.phone ?? '' });
  const t = (k: keyof typeof f, l: string, p = '') => <label className="field"><span>{l}</span><input className="input" disabled={ro} placeholder={p} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return <>
    <Head t="Your company" sub="As it appears in your records. The country can be a two-letter code (AE, IN, DE…)." />
    <div className="vform">
      {t('legalName', 'Legal name *')}{t('country', 'Country *', 'e.g. AE')}
      {t('trn', 'Tax / registration number')}{t('website', 'Website', 'https://')}
      {t('industry', 'Industry', 'e.g. Logistics, steel, IT services')}
      <label className="field"><span>Size</span><select className="input" disabled={ro} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}><option value="">—</option><option value="micro">Micro (under 10 people)</option><option value="small">Small (10–49)</option><option value="medium">Medium (50–249)</option><option value="large">Large (250+)</option></select></label>
      {t('employees', 'Employees')}<div className="field" />
      {t('contactName', 'Contact for this request *')}{t('contactRole', 'Their role')}{t('phone', 'Phone')}
    </div>
    <Foot ro={ro} ok={!!(f.legalName.trim() && f.country.trim() && f.contactName.trim())} onSave={() => void save('profile', {
      legalName: f.legalName.trim(), country: f.country.trim() || null, trn: f.trn.trim() || null, website: f.website.trim() || null, industry: f.industry.trim() || null, size: f.size || null,
      employees: f.employees.trim() ? Math.round(Number(f.employees)) : null, contactName: f.contactName.trim(), contactRole: f.contactRole.trim() || null, phone: f.phone.trim() || null })} />
  </>;
}

/** Upload a file to the request's evidence; returns its id. */
async function uploadEvidence(file: File, kind: string): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('The file is over 15 MB');
  return (await call<{ documentId: string }>('POST', '/evidence', undefined, file, { 'x-kind': kind })).documentId;
}
function AttachInline({ me, kinds, reload, toast, label }: { me: Me; kinds: (keyof typeof SP_DOCKIND)[]; reload: () => Promise<void>; toast: (m: string) => void; label: string }) {
  const [kind, setKind] = useState<string>(kinds[0]!);
  const [busy, setBusy] = useState(false);
  const mine = me.documents.filter((d) => kinds.includes(d.kind));
  return (
    <div className="sp-attach">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b className="small">{label}</b>
        {kinds.length > 1 && <select className="input sm" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What it is">{kinds.map((k) => <option key={k} value={k}>{SP_DOCKIND[k]}</option>)}</select>}
        <label className={`btn sm${busy ? ' dis' : ''}`}>{busy ? 'Uploading…' : 'Attach a file…'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png" disabled={busy}
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); try { await uploadEvidence(f, kind); toast('Attached'); await reload(); } catch (x) { toast((x as Error).message); } finally { setBusy(false); } }} /></label>
        <span className="muted small">PDF, JPEG or PNG · up to 15 MB</span>
      </div>
      {mine.length > 0 && <div className="small muted">{mine.map((d) => `📎 ${d.filename}`).join('  ·  ')}</div>}
    </div>);
}

function Inventory({ me, ro, save, reload, toast }: { me: Me; ro: boolean; save: SaveFn; reload: () => Promise<void>; toast: (m: string) => void }) {
  const a = me.answers.inventory ?? {};
  const [f, setF] = useState({ reports: a.reports ?? '', scope1: str(a.scope1), scope2Location: str(a.scope2Location), scope2Market: str(a.scope2Market), scope3: str(a.scope3), scope3Categories: a.scope3Categories ?? '',
    boundary: a.boundary ?? '', standard: a.standard ?? 'GHG Protocol Corporate Standard', verification: a.verification ?? '', verifier: a.verifier ?? '', revenue: str(a.revenue), currency: a.currency ?? me.company_currency, notes: a.notes ?? '' });
  const n = (k: keyof typeof f, l: string, hint?: string) => <label className="field"><span>{l}</span><input className="input num" inputMode="decimal" disabled={ro} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{hint && <small className="muted">{hint}</small>}</label>;
  const s1 = toNum(f.scope1), s2 = toNum(f.scope2Market) ?? toNum(f.scope2Location), rev = toNum(f.revenue);
  const intensity = s1 != null && s2 != null && rev ? ((s1 + s2) * 1000) / rev : null;
  const has = f.reports && f.reports !== 'no';
  const al = me.answers.allocation ?? {}, s2hi = Math.max(toNum(f.scope2Location) ?? 0, toNum(f.scope2Market) ?? 0);
  const clash = al.method === 'direct' && al.directT != null && s1 != null && al.directT > (s1 + s2hi) * 1.0001
    ? `Your share for ${me.company} (${nf(al.directT, 2)} tCO₂e, saved under "Your share for us") is more than these Scope 1 + 2 totals.`
    : al.method === 'revenue' && al.customerRevenue != null && rev && al.customerRevenue > rev * 1.0001 ? `Your sales to ${me.company} (${nf(al.customerRevenue, 0)}, saved under "Your share for us") are more than this revenue.` : null;
  const ok = !clash && (f.reports === 'no' || (!!f.reports && s1 != null && s2 != null && !!rev && /^[A-Z]{3}$/.test(f.currency)));
  return <>
    <Head t={`Emissions in ${me.year}`} sub="Your whole company's greenhouse-gas emissions for the year, in tonnes of CO₂ equivalent (tCO₂e), as in your own inventory or sustainability report." />
    <div className="sp-choice">
      {([['yes', 'We measure our emissions'], ['partial', 'We have estimates for part of it'], ['no', 'We do not measure them yet']] as const).map(([k, l]) =>
        <label key={k} className={f.reports === k ? 'on' : ''}><input type="radio" name="reports" disabled={ro} checked={f.reports === k} onChange={() => setF({ ...f, reports: k })} />{l}</label>)}
    </div>
    {f.reports === 'no' && <div className="note info small">That's fine — complete the other sections. Your customer will use average figures for now; if you can, tell us below when you expect to measure them.</div>}
    {has && <div className="vform">
      {n('scope1', 'Scope 1 · tCO₂e *', 'Fuel burnt, own vehicles, refrigerant leaks, processes')}{n('scope2Location', 'Scope 2 location-based · tCO₂e', 'Electricity, heat, cooling at grid average')}
      {n('scope2Market', 'Scope 2 market-based · tCO₂e', 'With your green tariffs or certificates; leave blank if you only have location-based')}{n('scope3', 'Scope 3 · tCO₂e (if known)')}
      <label className="field span2"><span>Scope 3 categories included</span><input className="input" disabled={ro} placeholder="e.g. 1 purchased goods, 4 upstream transport, 6 business travel" value={f.scope3Categories} onChange={(e) => setF({ ...f, scope3Categories: e.target.value })} /></label>
      {n('revenue', `Revenue in ${me.year} *`, 'Total, same period; used to share your emissions over your customers')}
      <label className="field"><span>Currency *</span><input className="input" disabled={ro} maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></label>
      <label className="field"><span>Boundary</span><select className="input" disabled={ro} value={f.boundary} onChange={(e) => setF({ ...f, boundary: e.target.value })}><option value="">—</option>{Object.entries(SP_BOUNDARY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Standard</span><input className="input" disabled={ro} value={f.standard} onChange={(e) => setF({ ...f, standard: e.target.value })} /></label>
      <label className="field"><span>Verification</span><select className="input" disabled={ro} value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })}><option value="">—</option>{Object.entries(SP_VERIF).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field"><span>Verifier</span><input className="input" disabled={ro || !f.verification || f.verification === 'none'} value={f.verifier} onChange={(e) => setF({ ...f, verifier: e.target.value })} /></label>
    </div>}
    <label className="field"><span>Notes (method, exclusions, what is estimated)</span><textarea className="input" rows={2} disabled={ro} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
    {!ro && f.reports && f.reports !== 'no' && <AttachInline me={me} kinds={['report', 'verification']} reload={reload} toast={toast} label="Your report or verification statement" />}
    {clash && <div className="note bad small" role="alert">{clash} Correct the figures, or change your share first.</div>}
    {intensity != null && <div className="sp-calc"><b>{nf(intensity, 4)} kg CO₂e per {f.currency}</b> of revenue (Scope 1 + 2{toNum(f.scope2Market) != null ? ', market-based' : ''}). Your customer may use this for what it buys from you.</div>}
    <Foot ro={ro} ok={ok} onSave={() => void save('inventory', {
      reports: f.reports || null, scope1: has ? s1 : null, scope2Location: has ? toNum(f.scope2Location) : null, scope2Market: has ? toNum(f.scope2Market) : null, scope3: has ? toNum(f.scope3) : null,
      scope3Categories: f.scope3Categories.trim() || null, boundary: f.boundary || null, standard: f.standard.trim() || null, verification: f.verification || null, verifier: f.verifier.trim() || null,
      revenue: has ? rev : null, currency: has ? f.currency : null, notes: f.notes.trim() || null })} />
  </>;
}

function Allocation({ me, ro, save }: { me: Me; ro: boolean; save: SaveFn }) {
  const a = me.answers.allocation ?? {}, inv = me.answers.inventory ?? {};
  const noInv = inv.reports === 'no';
  const [f, setF] = useState({ method: a.method ?? (noInv ? 'none' : ''), customerRevenue: str(a.customerRevenue), directT: str(a.directT), notes: a.notes ?? '' });
  const s12 = me.derived.s12, rev = inv.revenue ?? null, cr = toNum(f.customerRevenue);
  const alloc = f.method === 'direct' ? toNum(f.directT) : f.method === 'revenue' && s12 != null && rev && cr != null ? (s12 * cr) / rev : null;
  const s2max = Math.max(inv.scope2Location ?? 0, inv.scope2Market ?? 0), s12all = inv.scope1 != null ? inv.scope1 + s2max : null;
  const dT = toNum(f.directT);
  const err = f.method === 'direct' && dT != null && s12all != null && dT > s12all * 1.0001
    ? `This is more than your whole company's Scope 1 + 2 (${nf(s12all, 2)} tCO₂e, under Emissions). The share for ${me.company} is part of your own emissions — check both figures and that both are in tonnes.`
    : f.method === 'revenue' && cr != null && rev && cr > rev * 1.0001 ? `This is more than your total revenue (${nf(rev, 0)} ${inv.currency ?? ''}, under Emissions). Check both figures and the currency.` : null;
  const ok = !err && (f.method === 'none' || (f.method === 'revenue' && cr != null) || (f.method === 'direct' && dT != null));
  return <>
    <Head t={`Your emissions relating to ${me.company}`} sub={`The part of your Scope 1 and 2 emissions that relates to what ${me.company} bought from you in ${me.year}. This is what ends up in their Scope 3.`} />
    <div className="sp-choice col">
      <label className={f.method === 'revenue' ? 'on' : ''}><input type="radio" name="m" disabled={ro || noInv} checked={f.method === 'revenue'} onChange={() => setF({ ...f, method: 'revenue' })} />
        <span><b>By revenue</b><small>Your sales to {me.company} as a share of your revenue. Simple and common.</small></span></label>
      <label className={f.method === 'direct' ? 'on' : ''}><input type="radio" name="m" disabled={ro} checked={f.method === 'direct'} onChange={() => setF({ ...f, method: 'direct' })} />
        <span><b>We calculated it ourselves</b><small>From the products, volumes or sites that serve {me.company} (more accurate).</small></span></label>
      <label className={f.method === 'none' ? 'on' : ''}><input type="radio" name="m" disabled={ro} checked={f.method === 'none'} onChange={() => setF({ ...f, method: 'none' })} />
        <span><b>We cannot say</b><small>{me.company} will use your company intensity or average factors.</small></span></label>
    </div>
    {f.method === 'revenue' && <div className="vform"><label className="field"><span>Sales to {me.company} in {me.year} ({inv.currency ?? 'currency of your revenue'}) *</span>
      <input className="input num" inputMode="decimal" disabled={ro} value={f.customerRevenue} onChange={(e) => setF({ ...f, customerRevenue: e.target.value })} /></label><div className="field" /></div>}
    {f.method === 'direct' && <div className="vform"><label className="field"><span>Emissions relating to {me.company} · tCO₂e *</span>
      <input className="input num" inputMode="decimal" disabled={ro} value={f.directT} onChange={(e) => setF({ ...f, directT: e.target.value })} /></label><div className="field" /></div>}
    {f.method !== 'none' && <label className="field"><span>How it was worked out</span><textarea className="input" rows={2} disabled={ro} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>}
    {err && <div className="note bad small" role="alert">{err}</div>}
    {!err && alloc != null && <div className="sp-calc"><b>{nf(alloc, 2)} tCO₂e</b> relate to {me.company}{f.method === 'revenue' && rev && cr != null ? ` (${nf((cr / rev) * 100, 2)}% of your revenue)` : ''}.</div>}
    <Foot ro={ro} ok={ok} onSave={() => void save('allocation', { method: f.method || null, customerRevenue: f.method === 'revenue' ? cr : null, directT: f.method === 'direct' ? toNum(f.directT) : null, notes: f.notes.trim() || null })} />
  </>;
}

function Targets({ me, ro, save }: { me: Me; ro: boolean; save: SaveFn }) {
  const a = me.answers.targets ?? {};
  const [f, setF] = useState({ status: a.status ?? '', baseYear: str(a.baseYear), targetYear: str(a.targetYear), reductionPct: str(a.reductionPct), scopes: a.scopes ?? '', netZeroYear: str(a.netZeroYear), link: a.link ?? '' });
  const int = (s: string) => (s.trim() ? Math.round(Number(s)) : null);
  const has = f.status && f.status !== 'none';
  return <>
    <Head t="Climate targets" sub="Your company's emission-reduction target, if you have one." />
    <div className="sp-choice col">{Object.entries(SP_TARGET).map(([k, l]) =>
      <label key={k} className={f.status === k ? 'on' : ''}><input type="radio" name="t" disabled={ro} checked={f.status === k} onChange={() => setF({ ...f, status: k })} /><span><b>{l}</b></span></label>)}</div>
    {has && <div className="vform">
      {([['reductionPct', 'Reduction %'], ['baseYear', 'From base year'], ['targetYear', 'By year'], ['netZeroYear', 'Net-zero year (if any)']] as const).map(([k, l]) =>
        <label key={k} className="field"><span>{l}</span><input className="input num" inputMode="numeric" disabled={ro} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
      <label className="field"><span>Scopes covered</span><input className="input" disabled={ro} placeholder="e.g. Scope 1 + 2" value={f.scopes} onChange={(e) => setF({ ...f, scopes: e.target.value })} /></label>
      <label className="field"><span>Public link (SBTi dashboard, report)</span><input className="input" disabled={ro} placeholder="https://" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></label>
    </div>}
    <Foot ro={ro} ok={!!f.status} onSave={() => void save('targets', { status: f.status || null, baseYear: has ? int(f.baseYear) : null, targetYear: has ? int(f.targetYear) : null,
      reductionPct: has && f.reductionPct.trim() ? Number(f.reductionPct) : null, scopes: has ? f.scopes.trim() || null : null, netZeroYear: has ? int(f.netZeroYear) : null, link: has ? f.link.trim() || null : null })} />
  </>;
}

type PRow = { name: string; description: string; co2e: string; unit: string; standard: string; boundary: string; validFrom: string; validTo: string; verified: boolean; documentId: string };
function Products({ me, ro, save, reload, toast }: { me: Me; ro: boolean; save: SaveFn; reload: () => Promise<void>; toast: (m: string) => void }) {
  const a = me.answers.products ?? {};
  const toRow = (p: SPProduct): PRow => ({ name: p.name, description: p.description ?? '', co2e: String(p.co2e), unit: p.unit, standard: p.standard ?? '', boundary: p.boundary ?? 'cradle-to-gate', validFrom: p.validFrom ?? '', validTo: p.validTo ?? '', verified: !!p.verified, documentId: p.documentId ?? '' });
  const blank: PRow = { name: '', description: '', co2e: '', unit: 'kg', standard: SP_STANDARDS[0]!, boundary: 'cradle-to-gate', validFrom: '', validTo: '', verified: false, documentId: '' };
  const [none, setNone] = useState(!!a.none);
  const [rows, setRows] = useState<PRow[]>((a.items ?? []).map(toRow));
  const up = (i: number, x: Partial<PRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...x } : r)));
  const valid = rows.every((r) => r.name.trim() && Number(r.co2e) >= 0 && r.co2e.trim() !== '' && r.unit);
  const units = [...SP_UNITS, ...(me.answers.inventory?.currency ? [me.answers.inventory.currency] : []), me.company_currency, 'USD'].filter((u, i, x) => x.indexOf(u) === i);
  return <>
    <Head t="Product carbon footprints" sub="If you have footprints for what you sell us (an EPD or a product footprint to ISO 14067), give them per unit. They are more accurate than averages. Upload each product's document with it." />
    <label className="row small chkline" style={{ gap: 8 }}><input type="checkbox" disabled={ro} checked={none} onChange={(e) => setNone(e.target.checked)} /><b>We have no product footprints</b></label>
    {!none && <>
      {rows.map((r, i) => <div key={i} className="sp-prod">
        <div className="row"><b className="grow">Product {i + 1}</b>{!ro && <button className="btn sm ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}</div>
        <div className="vform">
          <label className="field span2"><span>Product *</span><input className="input" disabled={ro} value={r.name} onChange={(e) => up(i, { name: e.target.value })} /></label>
          <label className="field"><span>kg CO₂e per unit *</span><input className="input num" inputMode="decimal" disabled={ro} value={r.co2e} onChange={(e) => up(i, { co2e: e.target.value })} /></label>
          <label className="field"><span>Unit *</span><select className="input" disabled={ro} value={r.unit} onChange={(e) => up(i, { unit: e.target.value })}>{units.map((u) => <option key={u} value={u}>per {u}</option>)}</select></label>
          <label className="field"><span>Standard</span><select className="input" disabled={ro} value={r.standard} onChange={(e) => up(i, { standard: e.target.value })}>{SP_STANDARDS.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field"><span>Boundary</span><select className="input" disabled={ro} value={r.boundary} onChange={(e) => up(i, { boundary: e.target.value })}><option value="cradle-to-gate">Cradle to gate</option><option value="cradle-to-grave">Cradle to grave</option><option value="gate-to-gate">Gate to gate</option></select></label>
          <label className="field"><span>Valid from</span><input className="input" type="date" disabled={ro} value={r.validFrom} onChange={(e) => up(i, { validFrom: e.target.value })} /></label>
          <label className="field"><span>Valid to</span><input className="input" type="date" disabled={ro} value={r.validTo} onChange={(e) => up(i, { validTo: e.target.value })} /></label>
          <div className="field"><span>Document (EPD or footprint report)</span><div className="row" style={{ gap: 6 }}>
            <select className="input grow" disabled={ro} value={r.documentId} onChange={(e) => up(i, { documentId: e.target.value })}><option value="">—</option>{me.documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}</select>
            {!ro && <label className="btn sm" title="Upload the EPD for this product">Upload…<input type="file" hidden accept="application/pdf,image/jpeg,image/png"
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { const docId = await uploadEvidence(f, 'epd'); await reload(); up(i, { documentId: docId }); toast(`${f.name} attached to ${r.name || `product ${i + 1}`} — save to keep it`); } catch (x) { toast((x as Error).message); } }} /></label>}</div></div>
          <label className="row small chkline" style={{ gap: 8, alignSelf: 'end' }}><input type="checkbox" disabled={ro} checked={r.verified} onChange={(e) => up(i, { verified: e.target.checked })} />Independently verified</label>
        </div>
      </div>)}
      {!ro && rows.length < 50 && <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setRows([...rows, blank])}>+ Add a product</button>}
    </>}
    <Foot ro={ro} ok={none || (rows.length > 0 && valid)} onSave={() => void save('products', none ? { none: true, items: [] } : {
      none: false, items: rows.map((r) => ({ name: r.name.trim(), description: r.description.trim() || null, co2e: Number(r.co2e), unit: r.unit, standard: r.standard || null, boundary: r.boundary || null,
        validFrom: r.validFrom || null, validTo: r.validTo || null, verified: r.verified, documentId: r.documentId || null })) })} />
  </>;
}

function Evidence({ me, ro, reload, toast, next }: { me: Me; ro: boolean; reload: () => Promise<void>; toast: (m: string) => void; next: () => void }) {
  const [kind, setKind] = useState('report');
  const [busy, setBusy] = useState(false);
  const add = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('The file is over 15 MB');
    setBusy(true);
    try { await call('POST', '/evidence', undefined, file, { 'x-kind': kind }); toast('Attached'); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const del = async (id: string) => { try { await call('DELETE', `/evidence/${id}`); await reload(); } catch (e) { toast((e as Error).message); } };
  return <>
    <Head t="Evidence" sub="Your sustainability or emissions report, the verification statement, EPDs or product footprint reports. PDF, JPEG or PNG, up to 15 MB each." />
    {!ro && <div className="sp-drop">
      <label className="field"><span>What it is</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(SP_DOCKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className={`btn${busy ? ' dis' : ''}`}>{busy ? 'Uploading…' : 'Choose a file…'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png" disabled={busy} onChange={(e) => { void add(e.target.files?.[0]); e.target.value = ''; }} /></label>
    </div>}
    {!me.documents.length ? <div className="muted small">No files attached.</div> : <ul className="sp-docs">{me.documents.map((d) => <li key={d.id}><span className="grow"><b>{d.filename}</b><small>{SP_DOCKIND[d.kind]}{d.size ? ` · ${Math.round(d.size / 1024)} KB` : ''}</small></span>
      {!ro && <button className="btn sm ghost" onClick={() => void del(d.id)}>Remove</button>}</li>)}</ul>}
    {!ro && <div className="row sp-foot"><span className="grow muted small">Optional, but it makes your figures much easier to accept.</span><button className="btn p" onClick={next}>Continue</button></div>}
  </>;
}

function Submit({ me, reload, toast, goto }: { me: Me; reload: () => Promise<void>; toast: (m: string) => void; goto: (s: Step) => void }) {
  const [f, setF] = useState({ name: me.answers.declaration?.name ?? me.answers.profile?.contactName ?? '', title: me.answers.declaration?.title ?? me.answers.profile?.contactRole ?? '', confirm: false });
  const [busy, setBusy] = useState(false);
  const a = me.answers, inv = a.inventory ?? {}, d = me.derived;
  const missing = STEPS.filter(([k]) => k in me.progress.done && !me.progress.done[k as keyof SPProgress['done']]);
  const go = async () => {
    setBusy(true);
    try { await call('POST', '/submit', { name: f.name, title: f.title, confirm: true }); toast('Submitted — thank you'); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const Row = ({ l, v }: { l: string; v: ReactNode }) => <tr><td>{l}</td><td>{v}</td></tr>;
  return <>
    <Head t="Review & submit" sub={me.editable ? `Check your answers. Once submitted, ${me.company} reviews them; you can change them again only if they ask.` : 'What you sent.'} />
    <table className="t kv sp-sum"><tbody>
      <Row l="Company" v={<>{a.profile?.legalName ?? '—'} · {a.profile?.country ?? '—'}{a.profile?.contactName ? ` · contact ${a.profile.contactName}` : ''}</>} />
      <Row l={`Emissions ${me.year}`} v={inv.reports === 'no' ? 'Not measured yet' : inv.reports ? <>Scope 1 <b>{nf(inv.scope1)}</b> · Scope 2 <b>{nf(inv.scope2Market ?? inv.scope2Location)}</b>{inv.scope2Market != null ? ' (market)' : ''} · Scope 3 {nf(inv.scope3)} tCO₂e{inv.verification ? ` · ${SP_VERIF[inv.verification]}` : ''}</> : '—'} />
      <Row l="Revenue and intensity" v={d.intensity != null ? <>{nf(inv.revenue, 0)} {inv.currency} · <b>{nf(d.intensity, 4)} kg CO₂e / {inv.currency}</b></> : '—'} />
      <Row l={`Relating to ${me.company}`} v={d.allocated != null ? <b>{nf(d.allocated, 2)} tCO₂e</b> : a.allocation?.method === 'none' ? 'Not given' : '—'} />
      <Row l="Climate target" v={a.targets?.status ? `${SP_TARGET[a.targets.status]}${a.targets.reductionPct != null ? ` · −${a.targets.reductionPct}%${a.targets.targetYear ? ` by ${a.targets.targetYear}` : ''}` : ''}${a.targets.netZeroYear ? ` · net zero ${a.targets.netZeroYear}` : ''}` : '—'} />
      <Row l="Product footprints" v={a.products?.none ? 'None' : a.products?.items?.length ? a.products.items.map((p) => `${p.name}: ${nf(p.co2e, 3)} kg/${p.unit}`).join(' · ') : '—'} />
      <Row l="Evidence" v={me.documents.length ? me.documents.map((x) => x.filename).join(', ') : 'None'} />
    </tbody></table>
    {me.editable && (missing.length ? <div className="note warn">Still to complete: {missing.map(([k, l], i) => <span key={k}>{i ? ', ' : ''}<button className="linkbtn" onClick={() => goto(k)}>{l}</button></span>)}.</div> : <>
      <div className="vform">
        <label className="field"><span>Your name *</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Your title *</span><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      </div>
      <label className="row small chkline" style={{ gap: 8 }}><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} />
        <b>I confirm the information is accurate to the best of my knowledge and that I may share it with {me.company}.</b></label>
      <div className="row sp-foot"><span className="grow" /><button className="btn p" disabled={busy || !f.confirm || f.name.trim().length < 2 || f.title.trim().length < 2} onClick={() => void go()}>{busy ? 'Submitting…' : `Submit to ${me.company}`}</button></div>
    </>)}
  </>;
}
