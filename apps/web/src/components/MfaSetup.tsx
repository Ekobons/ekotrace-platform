/**
 * Multi-factor authentication: set-up (QR code for an authenticator app, first code, recovery codes),
 * and the card on the account page (new recovery codes, switch off when not required).
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../App';
import { qrSvg } from '../pages/FieldApp';

function Codes({ codes, onDone, label = 'Done' }: { codes: string[]; onDone: () => void; label?: string }) {
  const [saved, setSaved] = useState(false);
  const save = () => {
    const blob = new Blob([`Ekotrace recovery codes — each works once\r\n\r\n${codes.join('\r\n')}\r\n`], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ekotrace-recovery-codes.txt'; a.click(); setSaved(true);
  };
  return (
    <div className="mfastep">
      <div className="note warn"><b>Save these recovery codes now.</b> They are shown once. Each lets you sign in once if you lose your phone. Keep them somewhere safe — a password manager, or printed in a drawer.</div>
      <div className="mfacodes">{codes.map((c) => <code key={c}>{c}</code>)}</div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={save}>Download as a text file</button>
        <button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(codes.join('\n')).catch(() => {}); setSaved(true); }}>Copy</button>
        <span className="grow" />
        <button type="button" className="btn p" disabled={!saved} title={saved ? undefined : 'Download or copy the codes first'} onClick={onDone}>{label}</button>
      </div>
    </div>);
}

/** Set-up, step by step. */
export function MfaSetup({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [s, setS] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { api.mfaSetup().then(setS).catch((e) => setErr((e as Error).message)); }, []);
  const box = (
    <div className={`card ${forced ? 'loginbox mfabox' : 'mfabox'}`}>
      <h1 style={forced ? undefined : { fontSize: 20 }}>Set up multi-factor authentication</h1>
      {forced && <p className="sub">Your company requires a second step when you sign in: a code from an app on your phone. It takes a minute.</p>}
      {codes ? <Codes codes={codes} onDone={onDone} label={forced ? 'Continue to Ekotrace' : 'Done'} /> : <>
        <ol className="mfasteps">
          <li><b>Install an authenticator app</b> on your phone if you have none: Microsoft Authenticator, Google Authenticator, or your password manager.</li>
          <li><b>Scan this QR code</b> with the app (Add account → scan a QR code).
            {s && <div className="mfaqr"><div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(s.uri, 4) }} />
              <div className="sub small">Can't scan? <button type="button" className="linkbtn" onClick={() => setShow(!show)}><u>Type the key instead</u></button>
                {show && <div className="mono mfakey">{s.secret.replace(/(.{4})/g, '$1 ').trim()}</div>}</div></div>}
          </li>
          <li><b>Type the 6-digit code</b> the app shows for Ekotrace:
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <input className="input mfacode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} aria-label="6-digit code" />
              <button type="button" className="btn p" disabled={code.replace(/\s/g, '').length !== 6} onClick={async () => { setErr(null); try { setCodes((await api.mfaEnable(code.replace(/\s/g, ''))).recoveryCodes); } catch (e) { setErr((e as Error).message); } }}>Confirm</button>
            </div></li>
        </ol>
        {err && <div className="note bad">{err}</div>}
        {forced && <button type="button" className="btn ghost" onClick={async () => { await api.logout().catch(() => {}); location.href = '/'; }}>Log out</button>}
      </>}
    </div>);
  return forced ? <div className="loginwrap">{box}</div> : box;
}

/** Account page: MFA status and changes. */
export function MfaCard() {
  const { me, reload, toast } = useApp();
  const m = me.user.mfa;
  const [mode, setMode] = useState<'' | 'setup' | 'codes' | 'off'>('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (me.user.via === 'sso') return <div className="card mfabox"><h2>Multi-factor authentication</h2><p className="sub">You signed in with your company account: your company's sign-in handles the second step.</p></div>;
  if (mode === 'setup') return <MfaSetup onDone={() => { setMode(''); reload(); toast('Multi-factor authentication is on'); }} />;
  return (
    <div className="card mfabox">
      <div className="row"><h2 className="grow">Multi-factor authentication</h2>{m?.enabled ? <span className="chip">On</span> : <span className="chip warn">Off</span>}</div>
      {m?.enabled ? <p className="sub">A code from your authenticator app is asked after your password. {m.recoveryLeft} recovery code{m.recoveryLeft === 1 ? '' : 's'} left.{m.required ? ' Required for your account.' : ''}</p>
        : <p className="sub">Add a second step to your sign-in: a code from an app on your phone. Anyone who learns your password still cannot get in.</p>}
      {codes ? <Codes codes={codes} onDone={() => { setCodes(null); setMode(''); reload(); }} /> : mode === 'codes' || mode === 'off' ? <>
        {mode === 'off' && <label className="field"><span>Your password</span><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>}
        <label className="field"><span>A current code from the app</span><input className="input mfacode" inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} /></label>
        {err && <div className="note bad">{err}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className={`btn ${mode === 'off' ? 'danger' : 'p'}`} onClick={async () => {
            setErr(null);
            try {
              if (mode === 'codes') setCodes((await api.mfaRecovery(code.replace(/\s/g, ''))).recoveryCodes);
              else { await api.mfaDisable(pw, code.replace(/\s/g, '')); setMode(''); reload(); toast('Multi-factor authentication is off'); }
            } catch (e) { setErr((e as Error).message); }
          }}>{mode === 'off' ? 'Switch off' : 'Make new recovery codes'}</button>
          <button type="button" className="btn ghost" onClick={() => { setMode(''); setErr(null); }}>Cancel</button>
        </div>
      </> : <div className="row" style={{ gap: 8 }}>
        {m?.enabled ? <>
          <button type="button" className="btn" onClick={() => { setMode('codes'); setCode(''); }}>New recovery codes</button>
          {!m.required && <button type="button" className="btn ghost danger" onClick={() => { setMode('off'); setCode(''); setPw(''); }}>Switch off</button>}
        </> : <button type="button" className="btn p" onClick={() => setMode('setup')}>Set up</button>}
      </div>}
    </div>);
}
