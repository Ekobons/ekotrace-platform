/** Login and change-password screens. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { BRAND } from '../lib/brand';
import { BrandMark } from '../components/BrandMark';
import { CbamBrandSide } from './CbamPublic';
import { forgetWork } from '../lib/workContext';

export function Login({ onDone }: { onDone: () => void }) {
  // a new log-in starts from the defaults (first facility, this year)
  useEffect(() => { forgetWork(); }, []);
  // a bin's QR label opened before signing in: a contractor goes to the portal with that bin chosen
  const binCode = /^\/scan\/([A-Za-z0-9]+)/.exec(window.location.pathname)?.[1] ?? '';
  const [mode, setMode] = useState<'password' | 'code' | 'sso'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  // a company sign-in that came back with a problem
  const [err, setErr] = useState<string | null>(() => new URLSearchParams(window.location.search).get('sso_error'));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (new URLSearchParams(window.location.search).has('sso_error')) window.history.replaceState(null, '', window.location.pathname); }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (mode === 'sso') { const r = await api.ssoStart(email.trim()); window.location.href = r.url; return; }
      if (mode === 'code') {
        const r = await api.loginMfa(challenge, recovery ? { recoveryCode: code.trim() } : { code: code.replace(/\s/g, '') });
        if (r.recoveryLeft !== undefined) window.alert(`Recovery code used. ${r.recoveryLeft} left — make new ones on your account page if you are running low.`);
        onDone(); return;
      }
      const r = await api.login(email.trim(), password);
      if (r.mfa && r.challenge) { setChallenge(r.challenge); setMode('code'); setCode(''); setPassword(''); return; }
      onDone();
    } catch (x) {
      const m = (x as Error).message;
      setErr(m);
      if ((x as { code?: string }).code === 'CHALLENGE_EXPIRED') { setMode('password'); setChallenge(''); }
      if ((x as { code?: string }).code === 'SSO_REQUIRED') setMode('sso');
    } finally { setBusy(false); }
  }
  // the CBAM tool's own sign-in page
  const cbam = /^\/cbam(\/|$)/.test(window.location.pathname);
  return (
    <div className="signin">
      {cbam ? <CbamBrandSide /> : <BrandSide />}
      <main className="signin-form">
        <form className="sf" onSubmit={submit}>
          {mode === 'code' ? <>
            <h1>Enter your code</h1>
            <p className="sf-sub">{recovery ? 'Type one of the recovery codes you saved when you set up multi-factor authentication. Each works once.' : `Open your authenticator app and type the 6-digit code shown for ${BRAND.name}.`}</p>
            <label className="field"><span>{recovery ? 'Recovery code' : '6-digit code'}</span>
              <input className="input mfacode" autoFocus inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" required maxLength={recovery ? 20 : 7} value={code} onChange={(e) => setCode(e.target.value)} placeholder={recovery ? 'XXXX-XXXX-XXXX' : '123 456'} /></label>
            {err && <div className="note bad" role="alert">{err}</div>}
            <button className="btn p sf-go" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
            <div className="sf-alt">
              <button type="button" className="linkbtn" onClick={() => { setRecovery(!recovery); setCode(''); setErr(null); }}>{recovery ? 'Use the code from the app instead' : 'Lost your phone? Use a recovery code'}</button>
              <button type="button" className="linkbtn" onClick={() => { setMode('password'); setChallenge(''); setErr(null); }}>Start again</button>
            </div>
          </> : mode === 'sso' ? <>
            <h1>Company sign-in</h1>
            <p className="sf-sub">Sign in with your company's Microsoft, Google or other work account. Your email tells us which company you belong to.</p>
            <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {err && <div className="note bad" role="alert">{err}</div>}
            <button className="btn p sf-go" disabled={busy}>{busy ? 'Opening…' : 'Continue to your company sign-in'}</button>
            <div className="sf-alt"><button type="button" className="linkbtn" onClick={() => { setMode('password'); setErr(null); }}>Sign in with a password instead</button></div>
          </> : <>
            <h1>Sign in</h1>
            <p className="sf-sub">Use your work email and password, or your company account.</p>
            <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {err && <div className="note bad" role="alert">{err}</div>}
            <button className="btn p sf-go" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="btn sf-sso" onClick={() => { setMode('sso'); setErr(null); }}>Sign in with your company account</button>
            <p className="sf-note">Forgot your password? Your company's super admin or admin can reset it.</p>
            {cbam ? <div className="sf-other">
              <span>New here?</span>
              <a href="/cbam-signup">Create a free account</a>
              <a href="/cbam-supplier">Suppliers: answer a CBAM data request with your access code</a>
              <a href="/cbam-calculator">Free CBAM cost calculator — no account</a>
            </div> : <div className="sf-other">
              <span>Not a {BRAND.name} user?</span>
              <a href="/survey">Answer a commuting survey with your code</a>
              <a href={`/contractor${binCode ? `?bin=${binCode}` : ''}`}>Waste contractors: sign in with your access code</a>
              <a href="/supplier">Suppliers: share your emissions data with your access code</a>
            </div>}
          </>}
        </form>
      </main>
    </div>
  );
}

/**
 * The brand side: the product, one line on what it does, and a field of monthly bars stepping down from the
 * base year to net zero along the target path (illustrative, not data). The bars grow in once on load.
 */
const BARS = (() => {
  const n = 84, out: { h: number; future: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), trend = 1 - 0.86 * t ** 1.15;                 // base year → near zero
    const season = 0.07 * Math.sin(i * 0.52) + 0.035 * Math.sin(i * 1.9 + 1);
    out.push({ h: Math.max(0.05, trend + season * (1 - t * 0.6)), future: i >= 30 });
  }
  return out;
})();
function BrandSide() {
  const W = 1000, H = 300, bw = W / BARS.length;
  return (
    <aside className="signin-brand">
      <div className="sb-top"><BrandMark size={36} /><b>{BRAND.name}</b></div>
      <div className="sb-copy">
        <h2>Every tonne, traced back to where it came from.</h2>
        <p>Activity data from every site, emission factors you can check, and approvals your auditor can follow — from the base year to net zero.</p>
      </div>
      <figure className="sb-chart" aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H + 30}`} preserveAspectRatio="none">
          {BARS.map((b, i) => {
            const h = b.h * H, last = i >= BARS.length - 6;
            return <rect key={i} className={`sb-bar${b.future ? ' f' : ''}${last ? ' l' : ''}`} x={i * bw + bw * 0.22} y={H - h} width={bw * 0.56} height={h} rx={1.5}
              style={{ ['--d' as string]: `${i * 14}ms` }} />;
          })}
          <path className="sb-path" d={`M0 ${H * 0.02} C ${W * 0.35} ${H * 0.18}, ${W * 0.62} ${H * 0.62}, ${W} ${H * 0.9}`} />
          <line className="sb-base" x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} />
        </svg>
        <figcaption><span>Base year</span><span>Net zero</span></figcaption>
      </figure>
    </aside>);
}

export function ChangePassword({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (next !== again) { setErr('The two new passwords are not the same'); return; }
    try { await api.changePassword(current, next); setOk(true); window.setTimeout(onDone, 800); } catch (x) { setErr((x as Error).message); }
  }
  const box = (
    <form className="card loginbox" onSubmit={submit}>
      <h1>{forced ? 'Set your own password' : 'Change password'}</h1>
      {forced && <p className="sub">You logged in with a temporary password. Choose your own before continuing.</p>}
      <label className="field"><span>{forced ? 'Temporary password' : 'Current password'}</span><input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label className="field"><span>New password (at least 12 characters)</span><input className="input" type="password" autoComplete="new-password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field"><span>New password again</span><input className="input" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      <p className="sub">Tip: a short sentence you will remember is long and strong, e.g. “sunrise over the quiet harbour”.</p>
      {err && <div className="note bad">{err}</div>}
      {ok && <div className="note ok">Password changed.</div>}
      <button className="btn p" style={{ height: 42 }}>Save password</button>
      {forced && <button type="button" className="btn ghost" onClick={async () => { await api.logout().catch(() => {}); location.href = '/'; }}>Log out</button>}
    </form>
  );
  return forced ? <div className="loginwrap">{box}</div> : box;
}
