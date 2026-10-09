/**
 * Platform console (Ekobon staff): companies, plans, access dates, suspend,
 * and the shared factor library. Creating a company creates its first
 * Super admin with a temporary password shown once.
 */
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../App';
import { api, setTenant, type Company } from '../lib/api';
import { Icon } from '../components/Icon';

export function Console() {
  const { toast, reload } = useApp();
  const [list, setList] = useState<Company[]>([]);
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ email: string; pw: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.companies().then((c) => setList(c.companies));
  useEffect(() => { load(); }, []);
  const today = new Date().toISOString().slice(0, 10);
  const update = async (id: string, b: Record<string, unknown>, m: string) => { setErr(null); try { await api.updateCompany(id, b); toast(m); load(); } catch (e) { setErr((e as Error).message); } };
  const open = async (id: string) => { setTenant(id); await reload(); location.href = '/organisation'; };

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Ekobon · platform</div><h1>Platform console</h1><p className="sub">Companies on this installation, their plans and access. The shared factor library is managed here too.</p></div>
        <div className="row"><NavLink to="/library" className="btn"><Icon name="book" size={16} />Factor library</NavLink><button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" size={16} />New company</button></div>
      </div>
      {err && <div className="note bad">{err}</div>}
      <div className="card flush">
        <table className="t">
          <thead><tr><th>Company</th><th>Plan</th><th>Access until</th><th className="num">Users</th><th className="num">Facilities</th><th className="num">Entries</th><th>Last login</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.id}>
              <td><b>{c.name}</b><div className="sub">{c.country} · {c.gwp_set}</div></td>
              <td><select className="input" style={{ height: 30 }} value={c.plan} onChange={(e) => update(c.id, { plan: e.target.value }, 'Plan changed')}>{['trial', 'starter', 'professional', 'enterprise'].map((p) => <option key={p}>{p}</option>)}</select></td>
              <td><input className="input" type="date" style={{ height: 30 }} defaultValue={c.access_expiry} onBlur={(e) => e.target.value !== c.access_expiry && update(c.id, { accessExpiry: e.target.value }, 'Access date changed')} />
                {c.access_expiry < today && <span className="chip bad" style={{ marginLeft: 4 }}>expired</span>}</td>
              <td className="num">{c.users}</td><td className="num">{c.facilities}</td><td className="num">{c.entries}</td>
              <td className="sub">{c.last_login ? new Date(c.last_login).toLocaleDateString() : '—'}</td>
              <td>{c.status === 'active' ? <span className="chip">active</span> : <span className="chip bad">suspended</span>}</td>
              <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <button className="btn sm" onClick={() => open(c.id)}>Open</button>
                <button className="btn sm ghost danger" onClick={() => update(c.id, { status: c.status === 'active' ? 'suspended' : 'active' }, c.status === 'active' ? 'Suspended — its users are logged out' : 'Reactivated')}>{c.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
              </div></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      {adding && <NewCompany onClose={() => setAdding(false)} onDone={(s) => { setAdding(false); setSecret(s); load(); }} />}
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function NewCompany({ onClose, onDone }: { onClose: () => void; onDone: (s: { email: string; pw: string }) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const [f, setF] = useState({ name: '', country: 'AE', gwpSet: 'AR5', plan: 'enterprise', accessExpiry: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10), saName: '', saEmail: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>New company</h2>
        <label className="field"><span>Company name</span><input className="input" value={f.name} onChange={set('name')} /></label>
        <div className="row">
          <label className="field" style={{ width: 80 }}><span>Country</span><input className="input" maxLength={2} value={f.country} onChange={set('country')} /></label>
          <label className="field grow"><span>Plan</span><select className="input" value={f.plan} onChange={set('plan')}>{['trial', 'starter', 'professional', 'enterprise'].map((p) => <option key={p}>{p}</option>)}</select></label>
          <label className="field grow"><span>Access until</span><input className="input" type="date" value={f.accessExpiry} onChange={set('accessExpiry')} /></label>
          <label className="field"><span>GWP</span><select className="input" value={f.gwpSet} onChange={set('gwpSet')}><option>AR4</option><option>AR5</option><option>AR6</option></select></label>
        </div>
        <h3>First Super admin</h3>
        <div className="row">
          <label className="field grow"><span>Name</span><input className="input" value={f.saName} onChange={set('saName')} /></label>
          <label className="field grow"><span>Work email</span><input className="input" type="email" value={f.saEmail} onChange={set('saEmail')} /></label>
        </div>
        {err && <div className="note bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn p" disabled={f.name.trim().length < 2 || f.saName.trim().length < 2 || !f.saEmail.includes('@')} onClick={async () => {
            setErr(null);
            try {
              const r = await api.createCompany({ name: f.name.trim(), country: f.country.toUpperCase(), gwpSet: f.gwpSet, plan: f.plan, accessExpiry: f.accessExpiry, superAdmin: { name: f.saName.trim(), email: f.saEmail.trim() } });
              onDone({ email: r.superAdmin.email, pw: r.superAdmin.temporaryPassword });
            } catch (e) { setErr((e as Error).message); }
          }}>Create company</button>
        </div>
      </div>
    </dialog>
  );
}

function Secret({ email, pw, onClose }: { email: string; pw: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>Company created</h2>
        <p>Super admin login: <b>{email}</b>. Temporary password, shown only now — send it privately; they must change it at first login:</p>
        <div className="secret">{pw}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => navigator.clipboard?.writeText(pw)}>Copy</button><button className="btn p" onClick={() => ref.current?.close()}>Done</button></div>
      </div>
    </dialog>
  );
}
