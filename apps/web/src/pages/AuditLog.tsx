/**
 * Setup → Security & audit log: the audit trail; sign-in & MFA (company MFA policy, single sign-on with the
 * company's identity provider, who uses MFA); data export & retention. Platform admin: audit chain check
 * and SIEM forwarding status.
 */
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { api, download, ROLE_LABEL, type SecuritySettings } from '../lib/api';

const LABEL: Record<string, string> = {
  login: 'Logged in', 'login.sso': 'Logged in (company account)', 'login.failed': 'Wrong password', 'login.mfa_failed': 'Wrong MFA code', 'login.sso_failed': 'Company sign-in refused',
  'login.password_refused_sso': 'Password refused (company sign-in only)', 'password.change': 'Changed password', 'mfa.enable': 'Set up MFA', 'mfa.disable': 'Switched MFA off',
  'mfa.reset': 'Reset someone\'s MFA', 'mfa.recovery_codes': 'New recovery codes', 'security.mfa_policy': 'Changed the MFA rule', 'security.sso': 'Changed company sign-in',
  'company.export': 'Exported all company data', 'user.create': 'Added a person', 'user.update': 'Changed a person',
  'user.reset_password': 'Reset a password', 'node.create': 'Added to organisation', 'node.update': 'Changed organisation', 'node.archive': 'Archived', 'node.delete': 'Removed from organisation',
  'methodology.update': 'Changed methodology', 'activity.create': 'Saved an entry', 'company.create': 'Company created', 'company.update': 'Company settings changed',
  'document.view': 'Opened a file', 'document.upload': 'Added a file',
};
const BAD = new Set(['login.failed', 'login.mfa_failed', 'login.sso_failed', 'login.password_refused_sso']);
const FILTERS: [string, string][] = [['', 'Everything'], ['login', 'Sign-ins'], ['mfa', 'MFA'], ['security', 'Security settings'], ['user', 'People'], ['node', 'Organisation'], ['activity', 'Data entries'], ['document', 'Files'], ['methodology', 'Methodology']];
type Tab = 'log' | 'signin' | 'data';
const d8 = (x: string | null) => (x ? new Date(x).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export function AuditLog() {
  const { role } = useApp();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab) || 'log');
  const showSecurity = ['super_admin', 'admin', 'verifier', 'platform_admin'].includes(role);
  return (
    <div className="page">
      <div className="row tahead"><div><span className="lbl">Setup</span><h1>Security & audit log</h1>
        <div className="muted">Who did what, when and from where — sealed so it cannot be altered — and how people sign in.</div></div></div>
      {showSecurity && <div className="seg strong" role="tablist">{([['log', '☰ Audit log'], ['signin', '🔐 Sign-in & MFA'], ['data', '⇩ Data export & retention']] as [Tab, string][]).map(([k, l]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === 'log' && <Log />}
      {tab === 'signin' && showSecurity && <SignIn />}
      {tab === 'data' && showSecurity && <DataTab />}
    </div>);
}

function Log() {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.audit>>['events']>([]);
  const [f, setF] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.audit({ action: f || undefined, limit: 500 }).then((r) => setEvents(r.events)).catch((e) => setErr(e.message)); }, [f]);
  return (
    <>
      <div className="note info small">Records cannot be changed or deleted — not from the application, not in the database. Each is sealed with the fingerprint of the one before it, so any tampering shows.</div>
      <div className="seg">{FILTERS.map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
      {err && <div className="note bad">{err}</div>}
      <div className="card flush">
        <div className="scroll">
          <table className="t">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th>From</th></tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString()}</td>
                <td>{e.user_name ?? '—'}</td>
                <td>{BAD.has(e.action) ? <span className="chip bad">{LABEL[e.action]}</span> : LABEL[e.action] ?? e.action}</td>
                <td className="sub" style={{ maxWidth: 480 }}>{e.detail ? summarize(e.detail) : ''}</td>
                <td className="mono">{e.ip}</td>
              </tr>))}
            </tbody>
          </table>
          {!events.length && <div className="empty">Nothing yet.</div>}
        </div>
      </div>
    </>);
}

function SignIn() {
  const { toast, me } = useApp();
  const [d, setD] = useState<SecuritySettings | null>(null);
  const [tick, setTick] = useState(0);
  const [f, setF] = useState({ issuer: '', clientId: '', clientSecret: '', domains: '', enabled: false, enforce: false, requireMfa: true });
  const [test, setTest] = useState<Awaited<ReturnType<typeof api.testSso>> | null>(null);
  useEffect(() => { api.security().then((x) => { setD(x); setF({ issuer: x.sso.issuer, clientId: x.sso.clientId, clientSecret: '', domains: x.sso.domains.join(', '), enabled: x.sso.enabled, enforce: x.sso.enforce, requireMfa: x.sso.requireMfa }); }).catch((e) => toast((e as Error).message)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="card empty">Loading…</div>;
  const ro = !d.canEdit;
  const active = d.people.filter((p) => !p.disabled);
  const withMfa = active.filter((p) => p.mfa).length;
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); setTick((t) => t + 1); } catch (e) { toast((e as Error).message); } };
  const meMfa = me.user.mfa?.enabled;
  return (
    <div className="secgrid">
      <section className="card secbox">
        <div className="row"><h2 className="grow">Multi-factor authentication</h2><span className={`chip ${withMfa === active.length ? '' : 'warn'}`}>{withMfa} of {active.length} people</span></div>
        <p className="sub">A code from an authenticator app (Microsoft Authenticator, Google Authenticator, a password manager) after the password. People who sign in with the company account use the company's own MFA instead.</p>
        <label className={`sectoggle${ro ? ' ro' : ''}`}><input type="checkbox" disabled={ro} checked={d.mfaRequired} onChange={(e) => run(() => api.setMfaPolicy(e.target.checked), e.target.checked ? 'MFA is now required: people without it set it up at their next sign-in' : 'MFA is now optional')} />
          <span><b>Require MFA for everyone who signs in with a password</b><span className="sub">Those without it are asked to set it up before they can do anything else.</span></span></label>
        {!meMfa && d.canEdit && <div className="note warn small">You have not set up MFA yourself yet: <a href="/account">do it on your account page</a>.</div>}
        <div className="scroll"><table className="t">
          <thead><tr><th>Person</th><th>Role</th><th>MFA</th><th>Last sign-in</th>{!ro && <th />}</tr></thead>
          <tbody>{active.map((p) => (
            <tr key={p.id}><td><b>{p.name}</b><div className="muted small">{p.email}</div></td><td className="small">{ROLE_LABEL[p.role]}</td>
              <td>{p.mfa ? <span className="chip">On · {p.recovery_left} codes</span> : <span className="chip warn">Off</span>}</td>
              <td className="small">{d8(p.last_login_at)}{p.last_method && <div className="muted">{p.last_method === 'sso' ? 'company account' : p.last_method === 'password+mfa' ? 'password + code' : 'password only'}</div>}</td>
              {!ro && <td>{p.mfa && p.id !== me.user.id && <button className="btn ghost xs" title="For a lost phone: they set MFA up again" onClick={() => { if (window.confirm(`Reset ${p.name}'s MFA? They will set it up again (and are signed out now).`)) run(() => api.resetUserMfa(p.id), 'MFA reset'); }}>Reset</button>}</td>}
            </tr>))}</tbody>
        </table></div>
      </section>

      <section className="card secbox">
        <div className="row"><h2 className="grow">Company sign-in (single sign-on)</h2>{d.sso.enabled ? <span className="chip">{d.sso.enforce ? 'On · only way in' : 'On'}</span> : <span className="chip grey">Off</span>}</div>
        <p className="sub">People sign in with their work account (Microsoft Entra ID, Okta, Google Workspace or any OpenID Connect provider). Leavers lose access as soon as IT disables their account. People still need a profile under People & access — the company account only proves who they are.</p>
        <ol className="sub small secsteps">
          <li>In the identity provider, register an application (web) with this <b>redirect address</b>: <code className="mono">{d.sso.redirectUri}</code></li>
          <li>Copy its <b>issuer</b> (Entra: https://login.microsoftonline.com/&lt;directory id&gt;/v2.0), <b>client id</b> and a <b>client secret</b> below.</li>
          <li>Add your email domains, <b>Test</b>, then switch it on.</li>
        </ol>
        <div className="vform">
          <label className="field span2"><span>Issuer</span><input className="input mono" disabled={ro} value={f.issuer} placeholder="https://login.microsoftonline.com/…/v2.0" onChange={(e) => setF({ ...f, issuer: e.target.value })} /></label>
          <label className="field"><span>Client id</span><input className="input mono" disabled={ro} value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} /></label>
          <label className="field"><span>Client secret {d.sso.hasSecret ? '(saved — leave empty to keep)' : ''}</span><input className="input" type="password" autoComplete="new-password" disabled={ro} value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} /></label>
          <label className="field span2"><span>Email domains (comma between)</span><input className="input" disabled={ro} value={f.domains} placeholder="example.com, group.example.com" onChange={(e) => setF({ ...f, domains: e.target.value })} /></label>
        </div>
        <label className={`sectoggle${ro ? ' ro' : ''}`}><input type="checkbox" disabled={ro} checked={f.requireMfa} onChange={(e) => setF({ ...f, requireMfa: e.target.checked })} />
          <span><b>The company sign-in must use MFA</b><span className="sub">Refused unless the provider reports a second factor (Entra: Conditional Access requiring MFA).</span></span></label>
        <label className={`sectoggle${ro ? ' ro' : ''}`}><input type="checkbox" disabled={ro} checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked, enforce: e.target.checked && f.enforce })} />
          <span><b>Switch company sign-in on</b><span className="sub">Adds "Sign in with your company account" for these domains; passwords still work.</span></span></label>
        <label className={`sectoggle${ro || !f.enabled ? ' ro' : ''}`}><input type="checkbox" disabled={ro || !f.enabled} checked={f.enforce} onChange={(e) => setF({ ...f, enforce: e.target.checked })} />
          <span><b>Company sign-in only</b><span className="sub">Passwords are refused — except for super admins who use MFA, kept for emergencies when the provider is down (break-glass).</span></span></label>
        {test && <div className={`note ${test.ok ? 'ok' : 'bad'} small`}>{test.ok ? <>Reached <b>{test.issuer}</b> — sign-in page, token service and signing keys found.</> : test.message}</div>}
        {!ro && <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={!f.issuer.trim()} onClick={async () => setTest(await api.testSso(f.issuer.trim()).catch((e) => ({ ok: false, message: (e as Error).message })))}>Test</button>
          <button className="btn p" disabled={!f.issuer.trim() || !f.clientId.trim() || !f.domains.trim()} onClick={() => run(() => api.saveSso({ issuer: f.issuer.trim(), clientId: f.clientId.trim(), ...(f.clientSecret ? { clientSecret: f.clientSecret } : {}),
            domains: f.domains.split(/[,\s]+/).map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean), enabled: f.enabled, enforce: f.enforce, requireMfa: f.requireMfa }), 'Company sign-in saved')}>Save</button>
          {d.sso.updatedBy && <span className="muted small">Last changed by {d.sso.updatedBy}, {d8(d.sso.updatedAt)}</span>}
        </div>}
      </section>

      <section className="card secbox">
        <h2>Sessions</h2>
        <ul className="sub small seclist">
          <li>A session ends after <b>{d.idleMinutes} minutes</b> without activity, after 12 hours at most, and at log-out (on the server, not just in the browser).</li>
          <li>The session key is a random value in a cookie scripts cannot read (HttpOnly, Secure, SameSite); never in a web address. A new one is made at every sign-in.</li>
          <li>5 wrong passwords or codes lock the account for 15 minutes. Every API request is rate-limited per person and per address.</li>
        </ul>
      </section>
      {me.user.role === 'platform_admin' && <PlatformAudit />}
    </div>);
}

export function PlatformAudit() {
  const [v, setV] = useState<Awaited<ReturnType<typeof api.auditVerify>> | null>(null);
  const [s, setS] = useState<Awaited<ReturnType<typeof api.siemStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.siemStatus().then(setS).catch(() => {}); }, []);
  return (
    <section className="card secbox">
      <h2>Audit log integrity & SIEM (platform)</h2>
      <div className="row" style={{ gap: 8 }}><button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { setV(await api.auditVerify()); } finally { setBusy(false); } }}>{busy ? 'Checking…' : 'Check the whole chain'}</button>
        {v && <span className={`chip ${v.ok ? '' : 'bad'}`}>{v.ok ? `Intact · ${v.checked.toLocaleString('en')} records` : `Broken at record ${v.problem?.seq}: ${v.problem?.what}`}</span>}</div>
      {s && <ul className="sub small seclist">
        <li>Sealed through record {s.sealedThrough.toLocaleString('en')}; kept {s.retentionMonths} months.</li>
        <li>{s.target ? <>Forwarding to <b className="mono">{s.target}</b>: sent through record {s.forwardedThrough.toLocaleString('en')}{s.lastError ? <> · <span className="chip bad">last error: {s.lastError}</span></> : null}.</> : 'No SIEM forwarding set up on this server (SIEM_SYSLOG). Companies can still pull events over the API.'}</li>
      </ul>}
    </section>);
}

function DataTab() {
  const { toast, role } = useApp();
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<SecuritySettings | null>(null);
  useEffect(() => { api.security().then(setD).catch(() => {}); }, []);
  const can = ['super_admin', 'platform_admin'].includes(role);
  return (
    <div className="secgrid">
      <section className="card secbox">
        <h2>Export everything</h2>
        <p className="sub">One ZIP with every record the company holds — each table as a CSV file (entries, results, organisation, people, meters, suppliers, targets, surveys, the audit trail…) — every stored file (bills, invoices, permits, statements), and a manifest with the SHA-256 checksum of each file to prove the copy is complete and unchanged. Password hashes, session keys and MFA / SSO secrets are left out.</p>
        <p className="sub">Use it to keep your own copy, to move to another system, or at the end of the contract before the data is deleted.</p>
        {can ? <div><button className="btn p" disabled={busy} onClick={async () => { setBusy(true); try { await download('/api/security/export', `ekotrace-export-${new Date().toISOString().slice(0, 10)}.zip`); toast('Export downloaded — the download is in the audit log'); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Preparing…' : 'Download the export (ZIP)'}</button></div>
          : <div className="muted small">The super admin can download it.</div>}
      </section>
      <section className="card secbox">
        <h2>Retention & deletion</h2>
        <ul className="sub small seclist">
          <li><b>Audit trail:</b> kept {d?.audit.retentionMonths ?? 24} months (never less than 12), then removed automatically; it cannot be shortened or edited by anyone.{d?.audit.siem ? ' Also forwarded to the security monitoring system (SIEM).' : ''}</li>
          <li><b>Files:</b> kept for the document vault's retention period (set there).</li>
          <li><b>End of contract:</b> after the export is handed over, Ekobon deletes all of the company's data and issues a <b>certificate of destruction</b> listing what was deleted. Encrypted backups expire on their own schedule (stated on the certificate). The audit trail stays until its retention ends.</li>
        </ul>
      </section>
    </div>);
}

function summarize(d: unknown): string {
  if (!d || typeof d !== 'object') return String(d ?? '');
  return Object.entries(d as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ').slice(0, 300);
}
