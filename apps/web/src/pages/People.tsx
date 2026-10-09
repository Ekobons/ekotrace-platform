/**
 * People & access — prototype layout: stat strip, Users / Roles & permissions /
 * Access activity tabs, search and filters. Adding a person shows a temporary
 * password once; they must change it at first login.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, ROLE_LABEL, type OrgNode, type Person, type Role } from '../lib/api';
import { Icon } from '../components/Icon';

const ROLES: Role[] = ['super_admin', 'admin', 'manager', 'preparer', 'verifier'];
const PERMS: [string, Record<Exclude<Role, 'platform_admin'>, string>][] = [
  ['Sees', { super_admin: 'Whole company', admin: 'Own sub-group', manager: 'Facilities they manage', preparer: 'Assigned facilities', verifier: 'Whole company' }],
  ['Enters data', { super_admin: '✓', admin: '✓ own sub-group', manager: '✓', preparer: '✓', verifier: '—' }],
  ['Approves data', { super_admin: '✓', admin: '✓ own sub-group', manager: '✓ (not own entries)', preparer: '—', verifier: '—' }],
  ['Organisation', { super_admin: 'Edit all', admin: 'Edit own sub-group', manager: 'View', preparer: 'View', verifier: 'View' }],
  ['People', { super_admin: 'Everyone', admin: 'Managers & preparers in sub-group', manager: 'View', preparer: '—', verifier: '—' }],
  ['Methodology', { super_admin: 'Edit', admin: 'View', manager: '—', preparer: '—', verifier: 'View' }],
  ['Audit log', { super_admin: '✓', admin: '✓', manager: '—', preparer: '—', verifier: '✓' }],
];
const roleChip = (r: Role) => ({ super_admin: '', admin: 'info', manager: 'warn', preparer: 'grey', verifier: 'grey', platform_admin: 'bad' }[r]);

export function People() {
  const { can, me, toast } = useApp();
  const [tab, setTab] = useState<'users' | 'roles' | 'activity'>('users');
  const [users, setUsers] = useState<Person[]>([]);
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('active');
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const [secret, setSecret] = useState<{ who: string; pw: string } | null>(null);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof api.audit>>['events']>([]);

  const load = async () => { setUsers((await api.users()).users); setNodes((await api.org()).nodes); };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (tab === 'activity') api.audit({ action: 'login', limit: 200 }).then((a) => setActivity(a.events)).catch(() => setActivity([])); }, [tab]);

  const list = useMemo(() => users.filter((u) =>
    (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())) && (!role || u.role === role) &&
    (status === '' || (status === 'active' ? !u.disabled : u.disabled))), [users, q, role, status]);
  const active = users.filter((u) => !u.disabled);
  const week = Date.now() - 7 * 864e5;

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Setup</div><h1>People & access</h1><p className="sub">Who can see, enter and approve data for which part of the organisation.</p></div>
        {can('super_admin', 'admin') && <button className="btn p" onClick={() => setEdit('new')}><Icon name="plus" size={16} />Add person</button>}
      </div>
      <div className="total">
        <div className="stat"><small>Active people</small><b>{active.length}</b></div>
        <div className="stat"><small>Logged in this week</small><b>{active.filter((u) => u.last_login_at && new Date(u.last_login_at).getTime() > week).length}</b></div>
        <div className="stat"><small>Waiting for first login</small><b>{active.filter((u) => u.must_change_password).length}</b></div>
        <div className="stat"><small>Disabled</small><b>{users.length - active.length}</b></div>
      </div>
      <div className="tabs">{([['users', 'Users'], ['roles', 'Roles & permissions'], ['activity', 'Access activity']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'users' && (
        <div className="card flush">
          <div className="row" style={{ padding: 12 }}>
            <input className="input grow" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="disabled">Disabled</option><option value="">All</option></select>
          </div>
          <table className="t">
            <thead><tr><th>Person</th><th>Role</th><th>Access to</th><th>Last active</th><th /></tr></thead>
            <tbody>{list.map((u) => (
              <tr key={u.id} className={u.disabled ? 'off' : ''}>
                <td><div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><span className="avatar">{u.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span><div><b>{u.name}</b>{u.id === me.user.id && <span className="chip grey" style={{ marginLeft: 6 }}>you</span>}<div className="sub">{u.email}</div></div></div></td>
                <td><span className={`chip ${roleChip(u.role)}`}>{ROLE_LABEL[u.role]}</span></td>
                <td className="sub">{u.role === 'admin' ? `Sub-group: ${u.scope_name}` : ['super_admin', 'verifier'].includes(u.role) ? 'Whole company'
                  : [...new Map([...u.manages, ...u.facilities].map((f) => [f.id, f.name])).values()].join(', ') || 'No facilities yet'}</td>
                <td className="sub">{u.disabled ? 'Disabled' : u.must_change_password ? 'Not logged in yet' : u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
                <td>{u.canEdit && <button className="btn sm ghost" onClick={() => setEdit(u)}>Edit</button>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'roles' && (
        <div className="card flush" style={{ overflow: 'auto' }}>
          <table className="t">
            <thead><tr><th /> {ROLES.map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
            <tbody>{PERMS.map(([what, v]) => <tr key={what}><td><b>{what}</b></td>{ROLES.map((r) => <td key={r}>{v[r as Exclude<Role, 'platform_admin'>]}</td>)}</tr>)}</tbody>
          </table>
          <p className="sub" style={{ padding: 12 }}>Nobody approves their own entry. Platform admins (Ekobon) can open any company for support.</p>
        </div>
      )}
      {tab === 'activity' && (
        <div className="card flush">
          <table className="t">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>From</th></tr></thead>
            <tbody>{activity.map((e) => <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td>{e.user_name}</td><td>{e.action === 'login' ? 'Logged in' : e.action === 'login.failed' ? <span className="chip bad">Wrong password</span> : e.action}</td><td className="mono">{e.ip}</td></tr>)}</tbody>
          </table>
          {!activity.length && <div className="empty">No logins recorded yet (or you cannot see the audit log).</div>}
        </div>
      )}

      {edit && <PersonDialog person={edit === 'new' ? null : edit} nodes={nodes} onClose={() => setEdit(null)}
        onSaved={async (m, pw) => { setEdit(null); toast(m); if (pw) setSecret(pw); await load(); }} />}
      {secret && <SecretDialog {...secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function PersonDialog({ person, nodes, onClose, onSaved }: { person: Person | null; nodes: OrgNode[]; onClose: () => void; onSaved: (m: string, pw?: { who: string; pw: string }) => void }) {
  const { can, role: myRole } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const [name, setName] = useState(person?.name ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'preparer');
  const [scope, setScope] = useState(person?.scope_node_id ?? '');
  const [facs, setFacs] = useState<Set<string>>(new Set(person?.facilities.map((f) => f.id) ?? []));
  const [err, setErr] = useState<string | null>(null);
  const allowedRoles = myRole === 'admin' ? (['manager', 'preparer'] as Role[]) : ROLES;
  const facilities = nodes.filter((n) => n.kind === 'facility' && n.active && (can('super_admin') || n.canEdit));
  const groups = nodes.filter((n) => n.kind !== 'facility' && n.active);

  async function save() {
    setErr(null);
    const body = { name: name.trim(), role, scopeNodeId: role === 'admin' ? scope || null : null, facilityIds: ['manager', 'preparer'].includes(role) ? [...facs] : [] };
    try {
      if (person) { await api.updateUser(person.id, body); onSaved('Saved'); }
      else { const r = await api.createUser({ ...body, email: email.trim() }); onSaved('Person added', { who: `${r.user.name} (${r.user.email})`, pw: r.temporaryPassword }); }
    } catch (e) { setErr((e as Error).message); }
  }
  const act = async (fn: () => Promise<unknown>, m: string, pw = false) => {
    setErr(null);
    try { const r = await fn() as { temporaryPassword?: string }; onSaved(m, pw && r.temporaryPassword ? { who: `${person!.name} (${person!.email})`, pw: r.temporaryPassword } : undefined); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>{person ? `Edit ${person.name}` : 'Add a person'}</h2>
        <div className="row">
          <label className="field grow"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field grow"><span>Work email</span><input className="input" type="email" value={email} disabled={!!person} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
        <label className="field"><span>Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>{allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        {role === 'admin' && (
          <label className="field"><span>Runs this sub-group</span>
            <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">— choose —</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        )}
        {['manager', 'preparer'].includes(role) && (
          <div className="field"><span>Facilities</span>
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10, padding: 8, display: 'grid', gap: 4 }}>
              {facilities.map((f) => (
                <label key={f.id} className="row" style={{ gap: 8 }}><input type="checkbox" checked={facs.has(f.id)} onChange={(e) => { const s = new Set(facs); e.target.checked ? s.add(f.id) : s.delete(f.id); setFacs(s); }} />{f.name}</label>
              ))}
            </div>
            {role === 'manager' && <span className="sub" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>Managers also approve the facilities set to them in each facility's profile.</span>}
          </div>
        )}
        {err && <div className="note bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 6 }}>
            {person && <button className="btn sm" onClick={() => act(() => api.resetPassword(person.id), 'Password reset', true)}>Reset password</button>}
            {person && <button className="btn sm danger" onClick={() => act(() => api.updateUser(person.id, { disabled: !person.disabled }), person.disabled ? 'Enabled' : 'Disabled')}>{person.disabled ? 'Enable' : 'Disable'}</button>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
            <button className="btn p" disabled={name.trim().length < 2 || (!person && !email.includes('@'))} onClick={save}>{person ? 'Save' : 'Add person'}</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function SecretDialog({ who, pw, onClose }: { who: string; pw: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>Temporary password</h2>
        <p>For <b>{who}</b>. Give it to them privately (not by group email). It is shown only now; they must choose their own at first login.</p>
        <div className="secret">{pw}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(pw)}>Copy</button>
          <button className="btn p" onClick={() => ref.current?.close()}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
