/**
 * EKOTRACE SME's open pages (no sign-in):
 *   SmeBrandSide      the left side of the SME sign-in page (/sme)
 *   SmeSignup         /sme-signup   a company opens its own account (when self-service sign-up is on)
 *   SmeStart          /sme-start    the link in the confirmation e-mail: choose a password
 *   SmeGrievancePage  /sme-grievance?t=…  the workers' page behind the company's QR code (anonymous)
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { BRAND } from '../../lib/brand';
import { BrandMark } from '../../components/BrandMark';
import { smePublic } from '../../lib/sme';
import './sme.css';
import { t as tr } from './i18n';

const tool = () => `${BRAND.name} SME`;
const Tick = () => <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>;

export function SmeBrandSide() {
  useEffect(() => { document.title = tool(); }, []);
  return <aside className="signin-brand smesb">
    <div className="sb-top"><BrandMark size={36} /><b>{tool()}</b></div>
    <div className="sb-copy">
      <h2>{tr('Carbon, ESG and compliance, made simple for MSMEs.')}</h2>
      <ul className="smesb-list">
        <li><Tick />{tr('Know which rules apply to you: BRSR, CBAM, EPR, DPDP, POSH and more')}</li>
        <li><Tick />{tr('Scope 1, 2 and 3 from your bills, and your ICAI SRMM level')}</li>
        <li><Tick />{tr('Find savings: power bill penalties, rooftop solar, scrap, schemes')}</li>
        <li><Tick />{tr('Share your data with buyers, banks and your CA, only with your consent')}</li>
      </ul>
    </div>
    <figure className="sb-chart" aria-hidden="true">
      <svg viewBox="0 0 1000 260" preserveAspectRatio="xMidYMid meet">
        {[0, 1, 2, 3, 4].map((i) => <rect key={i} x={110 + i * 170} y={230 - (i + 1) * 40} width={110} height={(i + 1) * 40} rx={8} fill={i === 4 ? '#C6F06B' : `rgba(198,240,107,${0.18 + i * 0.12})`} />)}
        {['Formative', 'Developing', 'Emerging', 'Established'].map((t, i) => <text key={t} x={335 + i * 170} y={252} textAnchor="middle" fill="#B9D3CA" style={{ font: '600 15px var(--f-ui)' }}>{tr(t)}</text>)}
        <text x={165} y={252} textAnchor="middle" fill="#B9D3CA" style={{ font: '600 15px var(--f-ui)' }}>{tr('Start')}</text>
      </svg>
      <figcaption><span>{tr('Your readiness, step by step')}</span><span>{tr('ICAI SRMM levels')}</span></figcaption>
    </figure>
  </aside>;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="cbpub">
    <header className="cbpub-top"><a href="/sme" className="row" style={{ gap: 10, textDecoration: 'none', color: 'inherit' }}><BrandMark size={30} /><b>{tool()}</b></a><span className="grow" /><a className="btn sm" href="/sme">Sign in</a></header>
    <main className="cbpub-main">{children}</main>
  </div>;
}

export function SmeSignup() {
  const [info, setInfo] = useState<{ signup: boolean; states: string[] } | null>(null);
  const [v, setV] = useState({ company: '', sector: 'mfg', industry: '', state: '', name: '', email: '', phone: '', accept: false });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = `Create an account · ${tool()}`; smePublic.info().then(setInfo).catch(() => setInfo({ signup: false, states: [] })); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setDone((await smePublic.signup({ ...v, phone: v.phone || undefined })).message); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return <Shell>
    <form className="card cbform" onSubmit={submit}>
      <span className="lbl">For Indian MSMEs</span><h1>Create your {tool()} account</h1>
      {!info ? <p className="muted">Loading…</p> : done ? <div className="note ok">{done}</div> : !info.signup ? <div className="note info">Accounts are opened by our team, your industry association or your bank at the moment. Ask them for an invitation, or write to the {BRAND.name} team.</div> : <>
        <div className="vform">
          <label className="field span2"><span>Company name</span><input className="input" required minLength={2} value={v.company} onChange={set('company')} /></label>
          <label className="field"><span>You mainly</span><select className="input" value={v.sector} onChange={set('sector')}><option value="mfg">Make goods (manufacturing)</option><option value="svc">Provide services</option></select></label>
          <label className="field"><span>State</span><select className="input" required value={v.state} onChange={set('state')}><option value="">Choose…</option>{info.states.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field span2"><span>Industry (e.g. fasteners, textiles, IT services)</span><input className="input" value={v.industry} onChange={set('industry')} /></label>
          <label className="field"><span>Your name</span><input className="input" required minLength={2} value={v.name} onChange={set('name')} /></label>
          <label className="field"><span>Mobile (optional)</span><input className="input" inputMode="tel" value={v.phone} onChange={set('phone')} /></label>
          <label className="field span2"><span>E-mail</span><input className="input" type="email" required value={v.email} onChange={set('email')} /></label>
          <label className="row small span2" style={{ gap: 6 }}><input type="checkbox" checked={v.accept} onChange={(e) => setV({ ...v, accept: e.target.checked })} /> I accept the terms of use and the privacy notice</label>
        </div>
        {err && <div className="note bad">{err}</div>}
        <button className="btn p" disabled={busy || !v.accept || !v.state}>{busy ? 'Sending…' : 'Create account'}</button>
        <div className="muted small">We send a link to confirm your e-mail. Your data stays yours: nobody sees it unless you choose to share.</div>
      </>}
    </form>
  </Shell>;
}

export function SmeStart() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [pw, setPw] = useState({ a: '', b: '' });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw.a !== pw.b) { setErr('The two passwords are not the same'); return; }
    try {
      const r = await smePublic.confirm(token, pw.a);
      await api.login(r.email, pw.a).catch(() => {});
      setOk(r.email);
      window.setTimeout(() => { window.location.href = '/sme/profile'; }, 900);
    } catch (x) { setErr((x as Error).message); }
  };
  return <Shell>
    <form className="card cbform" onSubmit={submit}>
      <span className="lbl">Almost there</span><h1>Choose your password</h1>
      {ok ? <div className="note ok">Account ready for {ok}. Opening…</div> : <>
        <label className="field"><span>Password (at least 12 characters)</span><input className="input" type="password" autoComplete="new-password" required minLength={12} value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></label>
        <label className="field"><span>Password again</span><input className="input" type="password" autoComplete="new-password" required value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></label>
        {err && <div className="note bad">{err}</div>}
        <button className="btn p" disabled={!token}>Open my account</button>
        {!token && <div className="note bad">This page needs the link from your e-mail.</div>}
      </>}
    </form>
  </Shell>;
}

/** Bilingual (English / Hindi) page a worker opens by scanning the QR poster. No name, phone or IP is kept. */
const T = {
  en: { title: 'Tell us about a problem at work', sub: 'Your message goes to the company management. You do not need to give your name.', cat: 'About', text: 'What happened?', send: 'Send', bad: 'This QR code is not valid. Ask for the current poster.', cats: { Safety: 'Safety', Wages: 'Wages', Harassment: 'Harassment', Facilities: 'Facilities', Other: 'Other' } as Record<string, string> },
  hi: { title: 'काम पर किसी समस्या के बारे में बताएं', sub: 'आपका संदेश कंपनी प्रबंधन को जाता है। अपना नाम देना ज़रूरी नहीं है।', cat: 'विषय', text: 'क्या हुआ?', send: 'भेजें', bad: 'यह QR कोड मान्य नहीं है। नया पोस्टर मांगें।', cats: { Safety: 'सुरक्षा', Wages: 'वेतन', Harassment: 'उत्पीड़न', Facilities: 'सुविधाएं', Other: 'अन्य' } as Record<string, string> },
};
export function SmeGrievancePage() {
  const token = new URLSearchParams(window.location.search).get('t') ?? '';
  const [lang, setLang] = useState<'en' | 'hi'>('hi');
  const [info, setInfo] = useState<{ company: string; categories: string[] } | null | 'bad'>(null);
  const [v, setV] = useState({ category: 'Other', text: '' });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = T[lang];
  useEffect(() => { document.title = tool(); if (!/^[0-9a-f]{16}$/.test(token)) { setInfo('bad'); return; } smePublic.grievance(token).then(setInfo).catch(() => setInfo('bad')); }, [token]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setDone((await smePublic.sendGrievance(token, { ...v, language: lang })).message); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return <div className="cbpub">
    <header className="cbpub-top"><BrandMark size={28} /><b>{info && info !== 'bad' ? info.company : tool()}</b><span className="grow" />
      <div className="seg"><button type="button" className={lang === 'hi' ? 'on' : ''} onClick={() => setLang('hi')}>हिंदी</button><button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button></div></header>
    <main className="cbpub-main">
      <form className="card cbform" onSubmit={submit} lang={lang}>
        {info === null ? <p className="muted">…</p> : info === 'bad' ? <div className="note bad">{t.bad}</div> : done ? <div className="note ok">{done}</div> : <>
          <h1>{t.title}</h1><p className="muted">{t.sub}</p>
          <div className="field"><span>{t.cat}</span><div className="sme-cats">{info.categories.map((c) => <button key={c} type="button" className={`btn sm${v.category === c ? ' p' : ''}`} onClick={() => setV({ ...v, category: c })}>{t.cats[c] ?? c}</button>)}</div></div>
          <label className="field"><span>{t.text}</span><textarea className="input" rows={6} required minLength={5} maxLength={2000} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></label>
          {err && <div className="note bad">{err}</div>}
          <button className="btn p" disabled={busy || v.text.trim().length < 5}>{busy ? '…' : t.send}</button>
        </>}
      </form>
    </main>
  </div>;
}
