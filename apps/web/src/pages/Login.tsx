/** Login and change-password screens. */
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api.login(email.trim(), password); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="loginwrap">
      <form className="card loginbox" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}><div className="mark">e</div><div><b style={{ color: 'var(--fg)' }}>ekotrace</b><small style={{ color: 'var(--muted)' }}>Carbon operating system</small></div></div>
        <h1>Log in</h1>
        <label className="field"><span>Work email</span><input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="note bad">{err}</div>}
        <button className="btn p" disabled={busy} style={{ height: 42 }}>{busy ? 'Checking…' : 'Log in'}</button>
        <p className="sub">Forgot your password? Ask your company's Super admin or Admin to reset it.</p>
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
      <p className="sub">Tip: a short sentence you will remember is long and strong, e.g. “sharjah sunrise over the gulf”.</p>
      {err && <div className="note bad">{err}</div>}
      {ok && <div className="note ok">Password changed.</div>}
      <button className="btn p" style={{ height: 42 }}>Save password</button>
      {forced && <button type="button" className="btn ghost" onClick={async () => { await api.logout().catch(() => {}); location.href = '/'; }}>Log out</button>}
    </form>
  );
  return forced ? <div className="loginwrap">{box}</div> : box;
}
