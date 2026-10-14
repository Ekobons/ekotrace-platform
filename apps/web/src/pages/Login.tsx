/** Login and change-password screens. */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

export function Login({ onDone }: { onDone: () => void }) {
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
  return (
    <div className="loginwrap">
      <form className="card loginbox" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><div className="mark">e</div><div><b style={{ color: 'var(--fg)' }}>ekotrace</b><small style={{ color: 'var(--muted)' }}>Carbon operating system</small></div></div>
        {mode === 'code' ? <>
          <h1>Enter your code</h1>
          <p className="sub">{recovery ? 'Type one of the recovery codes you saved when you set up multi-factor authentication. Each works once.' : 'Open your authenticator app and type the 6-digit code shown for Ekotrace.'}</p>
          <label className="field"><span>{recovery ? 'Recovery code' : '6-digit code'}</span>
            <input className="input mfacode" autoFocus inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" required maxLength={recovery ? 20 : 7} value={code} onChange={(e) => setCode(e.target.value)} placeholder={recovery ? 'XXXX-XXXX-XXXX' : '123 456'} /></label>
          {err && <div className="note bad">{err}</div>}
          <button className="btn p" disabled={busy} style={{ height: 42 }}>{busy ? 'Checking…' : 'Continue'}</button>
          <button type="button" className="btn ghost" onClick={() => { setRecovery(!recovery); setCode(''); setErr(null); }}>{recovery ? 'Use the code from the app instead' : 'Lost your phone? Use a recovery code'}</button>
          <button type="button" className="btn ghost" onClick={() => { setMode('password'); setChallenge(''); setErr(null); }}>← Start again</button>
        </> : mode === 'sso' ? <>
          <h1>Company sign-in</h1>
          <p className="sub">Sign in with your company's Microsoft, Google or other work account. Your email tells us which company.</p>
          <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {err && <div className="note bad">{err}</div>}
          <button className="btn p" disabled={busy} style={{ height: 42 }}>{busy ? 'Opening…' : 'Continue to your company sign-in'}</button>
          <button type="button" className="btn ghost" onClick={() => { setMode('password'); setErr(null); }}>← Sign in with a password instead</button>
        </> : <>
          <h1>Log in</h1>
          <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {err && <div className="note bad">{err}</div>}
          <button className="btn p" disabled={busy} style={{ height: 42 }}>{busy ? 'Checking…' : 'Log in'}</button>
          <div className="ordiv"><span>or</span></div>
          <button type="button" className="btn" style={{ height: 42 }} onClick={() => { setMode('sso'); setErr(null); }}>Sign in with your company account (SSO)</button>
          <p className="sub">Forgot your password? Ask your company's Super admin or Admin to reset it.</p>
          <a className="btn ghost" href="/survey" style={{ justifySelf: 'start' }}>Answering a survey? Enter your code →</a>
          <a className="btn ghost" href={`/contractor${binCode ? `?bin=${binCode}` : ''}`} style={{ justifySelf: 'start' }}>Waste contractor? Sign in with your access code →</a>
        </>}
      </form>
    </div>
  );
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
