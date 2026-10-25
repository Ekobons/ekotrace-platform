/**
 * Open pages of the dedicated CBAM tool (no sign-in):
 *   CbamBrandSide     the left side of the CBAM sign-in page
 *   CbamSignup        create a free account (when sign-up is open) — /cbam-signup
 *   CbamStart         confirm the e-mail and choose a password — /cbam-start?token=
 *   CbamSupplierPage  a non-EU supplier answers an importer's request with an access code — /cbam-supplier
 *   CbamCalculator    free calculator: CN code, country, tonnes → certificates and cost to 2034 — /cbam-calculator
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type { CbamCalcResult, CbamCnRow } from '../lib/cbamComm';
import { BrandMark } from '../components/BrandMark';
import { CountrySelect } from '../components/CountrySelect';

const f = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: d }));
const eur = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `EUR ${Math.round(x).toLocaleString('en-GB')}`);

function useToolName() {
  const [info, setInfo] = useState<{ name: string; product: string; signup: boolean }>({ name: 'CBAM', product: '', signup: false });
  useEffect(() => { api.cbamPublicInfo().then((i) => { setInfo(i); document.title = i.name; }).catch(() => {}); }, []);
  return info;
}

/** The sign-in page's brand side for the CBAM tool: a border crossing with goods and their emissions. */
export function CbamBrandSide() {
  const info = useToolName();
  return <aside className="signin-brand cbsb">
    <div className="sb-top"><BrandMark size={36} /><b>{info.name}</b></div>
    <div className="sb-copy">
      <h2>CBAM, from the furnace to the declaration.</h2>
      <p>Exporters work out the embedded emissions of their steel, aluminium, cement, fertilisers and hydrogen and send them to their EU customers. Importers collect them, see the certificates and the cost to 2034, and file the declaration.</p>
    </div>
    <figure className="sb-chart cbsb-fig" aria-hidden="true">
      <svg viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet">
        <line x1="500" y1="10" x2="500" y2="290" className="cb-border" />
        <text x="250" y="28" className="cb-lab">Outside the EU</text><text x="750" y="28" className="cb-lab">EU</text>
        {[0, 1, 2, 3, 4].map((i) => <g key={i} className="cb-crate" style={{ ['--d' as string]: `${i * 0.9}s` }}>
          <rect x={60} y={70 + i * 42} width={70} height={28} rx={4} />
          <rect x={60} y={70 + i * 42} width={70 * (0.9 - i * 0.14)} height={6} className="cb-co2" />
        </g>)}
        <path d="M150 160 C 330 160, 380 160, 500 160 S 700 160, 860 160" className="cb-flow" />
        <g className="cb-cert"><rect x={800} y={110} width={140} height={100} rx={10} /><text x={870} y={155} textAnchor="middle">CBAM</text><text x={870} y={180} textAnchor="middle" className="cb-small">certificates</text></g>
      </svg>
    </figure>
  </aside>;
}

function PublicShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const info = useToolName();
  return <div className="cbpub">
    <header className="cbpub-top"><a href="/cbam" className="row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}><BrandMark size={30} /><b>{info.name}</b></a><span className="grow" />
      <a href="/cbam-calculator">Calculator</a>{info.signup && <a href="/cbam-signup">Create an account</a>}<a className="btn sm" href="/cbam">Sign in</a></header>
    <main className={`cbpub-main${wide ? ' wide' : ''}`}>{children}</main>
  </div>;
}

// ------------------------------------------------------------------ sign-up --
export function CbamSignup() {
  const info = useToolName();
  const [v, setV] = useState({ company: '', country: '', role: 'exporter', name: '', email: '', accept: false });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setDone((await api.cbamSignup({ ...v, email: v.email.trim(), company: v.company.trim(), name: v.name.trim() })).message); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return <PublicShell>
    <form className="card cbform" onSubmit={submit}>
      <span className="lbl">Free to start</span><h1>Create your {info.name} account</h1>
      {done ? <div className="note ok">{done}</div> : !info.signup ? <div className="note info">Accounts are opened by our team at the moment. Write to us and we will set you up — or try the free <a href="/cbam-calculator">calculator</a>.</div> : <>
        <div className="vform">
          <label className="field span2"><span>Company</span><input className="input" required value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} /></label>
          <label className="field"><span>Country</span><CountrySelect value={v.country} empty="Choose…" onChange={(c) => setV({ ...v, country: c })} /></label>
          <label className="field"><span>You are</span><select className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}><option value="exporter">An exporter to the EU (producer)</option><option value="importer">An importer into the EU</option><option value="both">Both</option></select></label>
          <label className="field"><span>Your name</span><input className="input" required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
          <label className="field"><span>Work e-mail</span><input className="input" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
          <label className="row small span2" style={{ gap: 6 }}><input type="checkbox" checked={v.accept} onChange={(e) => setV({ ...v, accept: e.target.checked })} /> I accept the terms of use and the privacy notice</label>
        </div>
        {err && <div className="note bad">{err}</div>}
        <button className="btn p" disabled={busy || !v.accept || !v.country}>{busy ? 'Sending…' : 'Create account'}</button>
        <div className="muted small">We send a link to confirm your e-mail. A 30-day trial; no card needed.</div>
      </>}
    </form>
  </PublicShell>;
}
export function CbamStart() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [pw, setPw] = useState({ a: '', b: '' });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw.a !== pw.b) { setErr('The two passwords are not the same'); return; }
    try {
      const r = await api.cbamSignupConfirm(token, pw.a);
      await api.login(r.email, pw.a).catch(() => {});
      setOk(r.email);
      window.setTimeout(() => { window.location.href = '/cbam/home'; }, 900);
    } catch (x) { setErr((x as Error).message); }
  };
  return <PublicShell>
    <form className="card cbform" onSubmit={submit}>
      <span className="lbl">Almost there</span><h1>Choose your password</h1>
      {ok ? <div className="note ok">Account ready for {ok}. Opening…</div> : <>
        <label className="field"><span>Password (at least 12 characters)</span><input className="input" type="password" autoComplete="new-password" required minLength={12} value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></label>
        <label className="field"><span>Password again</span><input className="input" type="password" autoComplete="new-password" required value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></label>
        {err && <div className="note bad">{err}</div>}
        <button className="btn p" disabled={!token}>Open my account</button>
      </>}
    </form>
  </PublicShell>;
}

// ------------------------------------------------------------------ supplier page --
type Me = { year: number; quarter: number | null; cn_codes: string[]; message: string; due_date: string | null; status: string; purpose: string; supplier: string; installation: string | null; registry_id: string | null; country: string | null;
  company: string; email: string; cnNames: Record<string, string>; responses: { id: string; via: string; filename: string | null; data: { goods: { cn: string; name: string; seeDirect: number | null; seeIndirect: number | null }[] }; status: string; review_note: string | null; submitted_at: string }[];
  messages: { side: string; author: string; body: string; at: string }[]; tool: string; editable: boolean };
async function sup<T>(method: string, path: string, body?: unknown, raw?: Blob, extra: Record<string, string> = {}): Promise<T> {
  const tok = sessionStorage.getItem('cbam-supplier') ?? '';
  const headers: Record<string, string> = { 'x-cbam-supplier': tok, ...extra };
  if (raw) headers['content-type'] = 'application/octet-stream'; else if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(d.message ?? `Request failed (${r.status})`, r.status, d.error);
  return d as T;
}
export function CbamSupplierPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [login, setLogin] = useState({ email: new URLSearchParams(window.location.search).get('email') ?? '', code: '' });
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'template' | 'form'>('template');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<{ name: string; country: string; registryId: string; verified: boolean; goods: { cn: string; name: string; seeDirect: string; seeIndirect: string; defaultShare: string }[] }>({ name: '', country: '', registryId: '', verified: false, goods: [] });
  const file = useRef<HTMLInputElement>(null);
  const load = () => sup<Me>('GET', '/api/public/cbam/supplier/me').then((m) => {
    setMe(m);
    setForm((o) => (o.goods.length ? o : { name: m.installation ?? '', country: m.country ?? '', registryId: m.registry_id ?? '', verified: false, goods: (m.cn_codes.length ? m.cn_codes : ['']).map((cn) => ({ cn, name: '', seeDirect: '', seeIndirect: '', defaultShare: '' })) }));
  }).catch(() => { sessionStorage.removeItem('cbam-supplier'); setMe(null); });
  useEffect(() => { if (sessionStorage.getItem('cbam-supplier')) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const signIn = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { const r = await sup<{ token: string }>('POST', '/api/public/cbam/supplier/login', { email: login.email.trim(), code: login.code.trim() }); sessionStorage.setItem('cbam-supplier', r.token); await load(); } catch (x) { setErr((x as Error).message); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => { setErr(null); setNote(null); try { await fn(); setNote(ok); await load(); } catch (x) { setErr((x as Error).message); } };
  if (!me) return <PublicShell>
    <form className="card cbform" onSubmit={signIn}>
      <span className="lbl">For suppliers outside the EU</span><h1>Answer a CBAM data request</h1>
      <p className="muted">Your EU customer sent you an e-mail with an access code. Sign in with the address it was sent to.</p>
      <label className="field"><span>E-mail</span><input className="input" type="email" required value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} /></label>
      <label className="field"><span>Access code</span><input className="input mono" required value={login.code} onChange={(e) => setLogin({ ...login, code: e.target.value })} /></label>
      {err && <div className="note bad">{err}</div>}
      <button className="btn p">Continue</button>
      <div className="muted small">Already use our CBAM tool? Sign in to your account and send your communication under <b>Answer a request</b> — no need to type anything again.</div>
    </form>
  </PublicShell>;
  const last = me.responses[0];
  const editable = me.editable;
  return <PublicShell wide>
    <section className="card" style={{ display: 'grid', gap: 8 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><div className="grow"><span className="lbl">Request from {me.company}</span><h1 style={{ margin: '2px 0' }}>{me.supplier} — {me.quarter ? `Q${me.quarter} ` : ''}{me.year}</h1></div>
        <button className="btn ghost sm" onClick={() => { void sup('POST', '/api/public/cbam/supplier/logout').catch(() => {}); sessionStorage.removeItem('cbam-supplier'); setMe(null); }}>Sign out</button></div>
      <div className="small">{me.purpose === 'precursor' ? 'Embedded emissions of the precursors you supply.' : 'Specific embedded emissions (tCO₂e per tonne) of the goods you sold them, for their EU CBAM declaration.'}{me.due_date ? <> Please answer by <b>{new Date(me.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b>.</> : null}</div>
      {me.cn_codes.length > 0 && <table className="t"><thead><tr><th>CN code</th><th>Goods</th></tr></thead><tbody>{me.cn_codes.map((c) => <tr key={c}><td className="mono">{c}</td><td className="small">{me.cnNames[c]}</td></tr>)}</tbody></table>}
      {me.message && <div className="note small">{me.message}</div>}
      {last && <div className={`note small ${last.status === 'accepted' ? 'ok' : last.status === 'rejected' ? 'bad' : 'info'}`}>
        {last.status === 'accepted' ? 'Accepted — thank you.' : last.status === 'rejected' ? <>Sent back: {last.review_note}. Please correct and send again.</> : `Sent ${new Date(last.submitted_at).toLocaleString('en-GB')} — waiting for ${me.company} to review.`}</div>}
    </section>
    {editable && <section className="card" style={{ display: 'grid', gap: 10 }}>
      <span className="lbl">Send your data</span>
      <div className="seg full"><button type="button" className={mode === 'template' ? 'on' : ''} onClick={() => setMode('template')}>Upload the EU template</button><button type="button" className={mode === 'form' ? 'on' : ''} onClick={() => setMode('form')}>Fill a short form</button></div>
      {mode === 'template' ? <>
        <div className="small">The European Commission's <b>CBAM Communication template for installations</b> (Excel), filled in. We read the goods and their specific embedded emissions from it; your customer sees the results, as in the template's summary.</div>
        <div><button className="btn p" onClick={() => file.current?.click()}>Choose the Excel file…</button></div>
        <input ref={file} type="file" accept=".xlsx" hidden onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ''; if (x) void act(() => sup('POST', '/api/public/cbam/supplier/template', undefined, x, { 'x-filename': encodeURIComponent(x.name) }), 'Template sent. Thank you!'); }} />
      </> : <>
        <div className="vform">
          <label className="field"><span>Installation</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Country</span><CountrySelect value={form.country} empty="Choose…" onChange={(c) => setForm({ ...form, country: c })} /></label>
          <label className="field"><span>Installation ID in the CBAM Registry (if any)</span><input className="input" value={form.registryId} onChange={(e) => setForm({ ...form, registryId: e.target.value })} /></label>
          <label className="row small" style={{ gap: 6, alignSelf: 'end' }}><input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Verified by an accredited verifier</label>
        </div>
        <div className="scroll"><table className="t"><thead><tr><th>CN code</th><th>Product name</th><th>SEE direct (tCO₂e/t)</th><th>SEE indirect (tCO₂e/t)</th><th>% from default values</th><th /></tr></thead>
          <tbody>{form.goods.map((g, i) => <tr key={i}>
            {(['cn', 'name', 'seeDirect', 'seeIndirect', 'defaultShare'] as const).map((k) => <td key={k}><input className={`input${k === 'cn' ? ' mono' : k === 'name' ? '' : ' num'}`} style={{ width: k === 'name' ? 180 : 110 }} value={g[k]} onChange={(e) => setForm({ ...form, goods: form.goods.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} /></td>)}
            <td><button className="btn sm ghost" onClick={() => setForm({ ...form, goods: form.goods.filter((_, j) => j !== i) })}>✕</button></td></tr>)}</tbody></table></div>
        <div><button className="btn sm" onClick={() => setForm({ ...form, goods: [...form.goods, { cn: '', name: '', seeDirect: '', seeIndirect: '', defaultShare: '' }] })}>+ Good</button></div>
        <div><button className="btn p" disabled={!form.name || !form.country || !form.goods.some((g) => g.cn && g.seeDirect)} onClick={() => void act(() => sup('POST', '/api/public/cbam/supplier/form', {
          installation: { name: form.name, country: form.country, registryId: form.registryId }, verified: form.verified,
          goods: form.goods.filter((g) => g.cn && g.seeDirect !== '').map((g) => ({ cn: g.cn, name: g.name, seeDirect: Number(g.seeDirect), seeIndirect: g.seeIndirect === '' ? null : Number(g.seeIndirect), defaultShare: g.defaultShare === '' ? null : Number(g.defaultShare) })),
        }), 'Sent. Thank you!')}>Send</button></div>
      </>}
      {note && <div className="note ok">{note}</div>}
      {err && <div className="note bad">{err}</div>}
    </section>}
    <section className="card" style={{ display: 'grid', gap: 6 }}>
      <span className="lbl">Messages with {me.company}</span>
      {me.messages.map((m, i) => <div key={i} className={`note small ${m.side === 'supplier' ? '' : 'info'}`}><b>{m.author}</b> · {new Date(m.at).toLocaleString('en-GB')}<div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div>)}
      {!me.messages.length && <div className="muted small">No message yet.</div>}
      <div className="row" style={{ gap: 8, alignItems: 'end' }}><label className="field grow"><span>Write to {me.company}</span><textarea className="input" rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
        <button className="btn" disabled={!msg.trim()} onClick={() => void act(async () => { await sup('POST', '/api/public/cbam/supplier/message', { body: msg.trim() }); setMsg(''); }, 'Message sent')}>Send</button></div>
    </section>
  </PublicShell>;
}

// ------------------------------------------------------------------ calculator --
export function CbamCalculator({ embedded }: { embedded?: boolean } = {}) {
  const info = useToolName();
  const init = new URLSearchParams(window.location.search);
  const [q, setQ] = useState(init.get('cn') ?? '');
  const [hits, setHits] = useState<CbamCnRow[]>([]);
  const [cn, setCn] = useState<CbamCnRow | null>(null);
  const [v, setV] = useState({ country: 'TR', tonnes: '1000', seeDirect: '', seeIndirect: '', price: '' });
  const [r, setR] = useState<CbamCalcResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = window.setTimeout(() => { api.cbamCn(q).then((x) => { setHits(x.codes); if (init.get('cn') && !cn) { const m = x.codes.find((c) => c.cn === init.get('cn')); if (m) setCn(m); } }).catch(() => {}); }, 200); return () => window.clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (e?: FormEvent) => {
    e?.preventDefault(); setErr(null);
    if (!cn) { setErr('Pick a CN code'); return; }
    try { setR(await api.cbamCalc({ cn: cn.cn, country: v.country, tonnes: Number(v.tonnes), seeDirect: v.seeDirect === '' ? null : Number(v.seeDirect), seeIndirect: v.seeIndirect === '' ? null : Number(v.seeIndirect), price: v.price === '' ? null : Number(v.price) })); } catch (x) { const d = (x as ApiError).details as { field: string; message: string }[] | undefined; setErr(d?.length ? d.map((y) => `${y.field === 'seeDirect' || y.field === 'seeIndirect' ? 'SEE (tCO₂e per tonne, at most 100)' : y.field}: ${y.message}`).join('; ') : (x as Error).message); }
  };
  const tot = useMemo(() => (r ? { def: r.years.some((y) => y.costDefault != null) ? r.years.reduce((a, y) => a + (y.costDefault ?? 0), 0) : null, act: r.years.some((y) => y.costActual != null) ? r.years.reduce((a, y) => a + (y.costActual ?? 0), 0) : null } : null), [r]);
  const max = r ? Math.max(1, ...r.years.map((y) => Math.max(y.costDefault ?? 0, y.costActual ?? 0))) : 1;
  const body = (
    <div className="cbcalc">
      <form className="card" style={{ display: 'grid', gap: 10, alignContent: 'start' }} onSubmit={go}>
        <span className="lbl">Free calculator · no account</span><h1 style={{ margin: 0 }}>What will CBAM cost?</h1>
        <label className="field"><span>Goods — CN code or words</span><input className="input" value={q} placeholder="e.g. 7208 or aluminium" onChange={(e) => { setQ(e.target.value); setCn(null); }} /></label>
        {!cn && hits.length > 0 && <div className="cmlist" style={{ maxHeight: 220 }}>{hits.slice(0, 30).map((h) => <button type="button" key={h.cn} className="cmcn" onClick={() => { setCn(h); setQ(h.cn); }}><span className="mono">{h.cn}</span><span><b>{h.category}</b><small className="muted">{h.name}</small></span></button>)}</div>}
        {cn && <div className="note info small"><b className="mono">{cn.cn}</b> — {cn.category}: {cn.name}</div>}
        <div className="vform">
          <label className="field"><span>Country of origin</span><CountrySelect value={v.country} onChange={(c) => setV({ ...v, country: c })} /></label>
          <label className="field"><span>Tonnes a year</span><input className="input num" type="number" min="0" value={v.tonnes} onChange={(e) => setV({ ...v, tonnes: e.target.value })} /></label>
          <label className="field"><span>Supplier's SEE direct (optional)</span><input className="input num" type="number" step="0.01" min="0" value={v.seeDirect} placeholder="tCO₂e/t" onChange={(e) => setV({ ...v, seeDirect: e.target.value })} /></label>
          <label className="field"><span>SEE indirect (optional)</span><input className="input num" type="number" step="0.01" min="0" value={v.seeIndirect} placeholder="tCO₂e/t" onChange={(e) => setV({ ...v, seeIndirect: e.target.value })} /></label>
          <label className="field span2"><span>Certificate price (EUR, optional)</span><input className="input num" type="number" min="0" value={v.price} placeholder="latest known price" onChange={(e) => setV({ ...v, price: e.target.value })} /></label>
        </div>
        {err && <div className="note bad">{err}</div>}
        <button className="btn p" disabled={!cn || !Number(v.tonnes)}>Calculate</button>
      </form>
      <section className="card" style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
        {!r ? <div className="muted">Pick the goods, the country and the tonnes. With your supplier's actual emissions you see what they save compared with the default values.</div> : <>
          <div className="kgrid2">
            <div className="stat"><small>Default values, {r.years[0]?.year}–2034</small><b>{eur(tot?.def)}</b></div>
            <div className="stat s2"><small>Supplier's actual values</small><b>{tot?.act == null ? '—' : eur(tot.act)}</b>{tot?.act != null && tot.def != null && tot.def > 0 && <small>{Math.round((1 - tot.act / tot.def) * 100)}% less</small>}</div>
          </div>
          <div className="fcbars" role="img" aria-label="Cost per year">{r.years.map((y) => <div key={y.year} className="fccol" title={`${y.year}: default ${eur(y.costDefault)}, actual ${eur(y.costActual)}`}>
            <div className="fcstack">{y.costDefault != null && <span className="fcghost" style={{ height: `${(y.costDefault / max) * 100}%` }} />}{y.costActual != null && <span className="fcbar" style={{ height: `${(y.costActual / max) * 100}%` }} />}</div><small>{y.year}</small></div>)}</div>
          <div className="scroll"><table className="t"><thead><tr><th>Year</th><th className="num">CBAM factor</th><th className="num">Default SEE (with mark-up)</th><th className="num">Benchmark</th><th className="num">Certificates (default)</th><th className="num">Cost (default)</th><th className="num">Cost (actual)</th></tr></thead>
            <tbody>{r.years.map((y) => <tr key={y.year}><td>{y.year}</td><td className="num">{Math.round(y.cbamFactor * 1000) / 10}%</td><td className="num">{f(y.seeDefault, 3)}{y.defaultIndicative ? ' *' : ''}</td><td className="num">{f(y.benchmark, 3)}</td><td className="num">{f(y.certDefault, 0)}</td><td className="num">{eur(y.costDefault)}</td><td className="num">{eur(y.costActual)}</td></tr>)}</tbody></table></div>
          <div className="muted small">{r.thresholdNote} {r.indirectCounts ? 'Indirect emissions count for these goods.' : 'Only direct emissions count for these goods.'} Price: {r.price == null ? 'none known' : `EUR ${f(r.price)} (${r.priceSource})`}. {r.indicative ? '* Sample default values — not the official ones. ' : ''}{r.note}</div>
          {r.years.every((y) => y.defaultValue == null) && <div className="note warn small">No default value is loaded for this CN code and country yet; only the actual values can be priced.</div>}
          {!embedded && <div className="note info small">Want this for all your imports, with your suppliers' data? <a href="/cbam-signup">Create a free {info.name} account</a>.</div>}
        </>}
      </section>
    </div>);
  return embedded ? body : <PublicShell wide>{body}</PublicShell>;
}
