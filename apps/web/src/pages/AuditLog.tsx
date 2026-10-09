/** Security & audit log — who did what, when, from where. */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

const LABEL: Record<string, string> = {
  login: 'Logged in', 'login.failed': 'Wrong password', 'password.change': 'Changed password', 'user.create': 'Added a person', 'user.update': 'Changed a person',
  'user.reset_password': 'Reset a password', 'node.create': 'Added to organisation', 'node.update': 'Changed organisation', 'node.archive': 'Archived', 'node.delete': 'Removed from organisation',
  'methodology.update': 'Changed methodology', 'activity.create': 'Saved an entry', 'company.create': 'Company created', 'company.update': 'Company settings changed',
};
const FILTERS: [string, string][] = [['', 'Everything'], ['login', 'Logins'], ['user', 'People'], ['node', 'Organisation'], ['activity', 'Data entries'], ['methodology', 'Methodology']];

export function AuditLog() {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.audit>>['events']>([]);
  const [f, setF] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.audit({ action: f || undefined, limit: 500 }).then((r) => setEvents(r.events)).catch((e) => setErr(e.message)); }, [f]);
  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">Setup</div><h1>Security & audit log</h1><p className="sub">Every login and change, kept for assurance. Entries cannot be edited or deleted from the application.</p></div></div>
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
                <td>{e.action === 'login.failed' ? <span className="chip bad">{LABEL[e.action]}</span> : LABEL[e.action] ?? e.action}</td>
                <td className="sub" style={{ maxWidth: 480 }}>{e.detail ? summarize(e.detail) : ''}</td>
                <td className="mono">{e.ip}</td>
              </tr>))}
            </tbody>
          </table>
          {!events.length && <div className="empty">Nothing yet.</div>}
        </div>
      </div>
    </div>
  );
}

function summarize(d: unknown): string {
  if (!d || typeof d !== 'object') return String(d ?? '');
  return Object.entries(d as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ').slice(0, 300);
}
