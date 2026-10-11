/**
 * Platform console (Ekobon staff): companies, plans, access dates, suspend,
 * and the shared factor library. Creating a company creates its first
 * Super admin with a temporary password shown once.
 */
import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useApp } from '../App';
import { api, setTenant, type Company, type PlanLimits } from '../lib/api';
import { Icon } from '../components/Icon';

const lim = (n: number | null) => (n == null ? 'unlimited' : String(n));
export const planLine = (p: PlanLimits) => `${lim(p.facilities)} facilities · ${lim(p.users)} people · Eko AI ${p.ai ? 'on' : 'off'} · export ${p.export ? 'on' : 'off'} · dashboard groups ${p.groups ? 'on' : 'off'}`;

export function Console() {
  const { toast, reload } = useApp();
  const [list, setList] = useState<Company[]>([]);
  const [plans, setPlans] = useState<PlanLimits[]>([]);
  const [tab, setTab] = useState<'companies' | 'plans'>('companies');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [secret, setSecret] = useState<{ email: string; pw: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.companies().then((c) => { setList(c.companies); setPlans(c.plans); });
  useEffect(() => { load(); }, []);
  const today = new Date().toISOString().slice(0, 10);
  const update = async (id: string, b: Record<string, unknown>, m: string) => { setErr(null); try { await api.updateCompany(id, b); toast(m); load(); } catch (e) { setErr((e as Error).message); } };
  const open = async (id: string) => { setTenant(id); await reload(); location.href = '/organisation'; };
  const planOf = (code: string) => plans.find((p) => p.code === code);
  const use = (n: number, max: number | null) => <span style={{ color: max != null && n > max ? 'var(--bad)' : undefined, fontWeight: max != null && n > max ? 700 : undefined }} title={max != null && n > max ? 'Above the plan limit' : undefined}>{n}<span className="muted"> / {lim(max)}</span></span>;
  const daysLeft = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">Ekobon · platform</div><h1>Platform console</h1><p className="sub">Companies on this installation, their plans, subscription and access. The shared factor library is managed here too.</p></div>
        <div className="row"><NavLink to="/library" className="btn"><Icon name="book" size={16} />Factor library</NavLink><button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" size={16} />New company</button></div>
      </div>
      <div className="tabs"><button className={tab === 'companies' ? 'on' : ''} onClick={() => setTab('companies')}>Companies ({list.length})</button><button className={tab === 'plans' ? 'on' : ''} onClick={() => setTab('plans')}>Plans</button></div>
      {err && <div className="note bad">{err}</div>}
      {tab === 'plans' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {plans.map((p) => (
            <section key={p.code} className="card" style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
              <span className="eyebrow">Plan</span><b style={{ fontSize: 18 }}>{p.name}</b><span className="sub">{p.note}</span>
              <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                {p.facilities == null ? 'Unlimited' : p.facilities} facilities<br />{p.users == null ? 'Unlimited' : p.users} people<br />
                Eko AI {p.ai ? '✓' : '—'}<br />Data export {p.export ? '✓' : '—'}<br />Dashboard groups {p.groups ? '✓' : '—'}
              </div>
              <span className="sub">{list.filter((c) => c.plan === p.code).length} compan{list.filter((c) => c.plan === p.code).length === 1 ? 'y' : 'ies'}</span>
            </section>))}
          <div className="sub" style={{ gridColumn: '1 / -1' }}>Limits are checked when a facility or a person is added (or brought back), and features are switched off on the screens and refused by the server. Lowering a plan never deletes anything: a company above the new limits keeps what it has but cannot add more.</div>
        </div>
      ) : (
      <div className="card flush"><div className="scrollx">
        <table className="t">
          <thead><tr><th>Company</th><th>Plan</th><th>Subscription</th><th>Access until</th><th className="num">Facilities</th><th className="num">People</th><th className="num">Entries</th><th>Last login</th><th>Status</th><th /></tr></thead>
          <tbody>{list.map((c) => { const p = planOf(c.plan); const d = daysLeft(c.access_expiry); return (
            <tr key={c.id}>
              <td><b>{c.name}</b><div className="sub">{c.country} · {c.gwp_set}</div></td>
              <td><select className="input" style={{ height: 30 }} value={c.plan} onChange={(e) => update(c.id, { plan: e.target.value }, 'Plan changed')}>{plans.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select>
                {p && <div className="sub" style={{ fontSize: 11.5, maxWidth: 220 }}>{planLine(p)}</div>}</td>
              <td className="small">{c.price != null ? <>{c.billing_currency} {c.price.toLocaleString('en')} / {c.billing_cycle === 'monthly' ? 'month' : 'year'}</> : <span className="muted">price not set</span>}{c.po_ref && <div className="muted">PO {c.po_ref}</div>}</td>
              <td><input className="input" type="date" style={{ height: 30 }} defaultValue={c.access_expiry} onBlur={(e) => e.target.value !== c.access_expiry && update(c.id, { accessExpiry: e.target.value }, 'Access date changed')} />
                {d < 0 ? <span className="chip bad" style={{ marginLeft: 4 }}>expired</span> : d <= 30 ? <span className="chip warn" style={{ marginLeft: 4 }}>{d} d left</span> : null}</td>
              <td className="num">{use(c.facilities, p?.facilities ?? null)}</td><td className="num">{use(c.users, p?.users ?? null)}</td><td className="num">{c.entries}</td>
              <td className="sub">{c.last_login ? new Date(c.last_login).toLocaleDateString() : '—'}</td>
              <td>{c.status === 'active' ? <span className="chip">active</span> : <span className="chip bad">suspended</span>}</td>
              <td><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <button className="btn sm" onClick={() => open(c.id)}>Open</button>
                <button className="btn sm" onClick={() => setEditing(c)}>Edit</button>
                <button className="btn sm ghost danger" onClick={() => update(c.id, { status: c.status === 'active' ? 'suspended' : 'active' }, c.status === 'active' ? 'Suspended — its users are logged out' : 'Reactivated')}>{c.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
              </div></td>
            </tr>); })}
          </tbody>
        </table>
      </div></div>)}
      {adding && <NewCompany plans={plans} onClose={() => setAdding(false)} onDone={(s) => { setAdding(false); setSecret(s); load(); }} />}
      {editing && <EditCompany c={editing} plans={plans} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast('Company saved'); load(); }} />}
      {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
    </div>
  );
}

function EditCompany({ c, plans, onClose, onSaved }: { c: Company; plans: PlanLimits[]; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const [f, setF] = useState({ name: c.name, plan: c.plan, accessExpiry: c.access_expiry, price: c.price != null ? String(c.price) : '', billingCurrency: c.billing_currency ?? 'AED', billingCycle: c.billing_cycle ?? 'annual', poRef: c.po_ref ?? '', billingEmail: c.billing_email ?? '', notes: c.notes ?? '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const p = plans.find((x) => x.code === f.plan);
  const over = p && ((p.facilities != null && c.facilities > p.facilities) || (p.users != null && c.users > p.users));
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>{c.name}</h2>
        <label className="field"><span>Company name</span><input className="input" value={f.name} onChange={set('name')} /></label>
        <div className="row">
          <label className="field grow"><span>Plan</span><select className="input" value={f.plan} onChange={set('plan')}>{plans.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
          <label className="field grow"><span>Access until</span><input className="input" type="date" value={f.accessExpiry} onChange={set('accessExpiry')} /></label>
        </div>
        {p && <div className="sub">{p.name}: {planLine(p)}.</div>}
        {over && <div className="note warn">The company has {c.facilities} facilities and {c.users} people: above the {p!.name} limits. Nothing is removed; it cannot add more until it is under the limits.</div>}
        <h3>Subscription</h3>
        <div className="row">
          <label className="field grow"><span>Price</span><input className="input num" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="field" style={{ width: 90 }}><span>Currency</span><input className="input" maxLength={3} value={f.billingCurrency} onChange={(e) => setF({ ...f, billingCurrency: e.target.value.toUpperCase() })} /></label>
          <label className="field grow"><span>Billed</span><select className="input" value={f.billingCycle} onChange={set('billingCycle')}><option value="annual">Annually</option><option value="monthly">Monthly</option></select></label>
        </div>
        <div className="row">
          <label className="field grow"><span>PO / contract reference</span><input className="input" value={f.poRef} onChange={set('poRef')} /></label>
          <label className="field grow"><span>Billing email</span><input className="input" type="email" value={f.billingEmail} onChange={set('billingEmail')} /></label>
        </div>
        <label className="field"><span>Notes (Ekobon only)</span><textarea className="input" rows={3} value={f.notes} onChange={set('notes')} /></label>
        {err && <div className="note bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn p" disabled={f.name.trim().length < 2} onClick={async () => {
            setErr(null);
            try {
              await api.updateCompany(c.id, { name: f.name.trim(), plan: f.plan, accessExpiry: f.accessExpiry, price: f.price === '' ? null : Number(f.price), billingCurrency: f.billingCurrency || 'AED',
                billingCycle: f.billingCycle, poRef: f.poRef.trim() || null, billingEmail: f.billingEmail.trim() || null, notes: f.notes.trim() || null });
              onSaved();
            } catch (e) { setErr((e as Error).message); }
          }}>Save</button>
        </div>
      </div>
    </dialog>
  );
}

function NewCompany({ plans, onClose, onDone }: { plans: PlanLimits[]; onClose: () => void; onDone: (s: { email: string; pw: string }) => void }) {
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
          <label className="field grow"><span>Plan</span><select className="input" value={f.plan} onChange={set('plan')}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
          <label className="field grow"><span>Access until</span><input className="input" type="date" value={f.accessExpiry} onChange={set('accessExpiry')} /></label>
          <label className="field"><span>GWP</span><select className="input" value={f.gwpSet} onChange={set('gwpSet')}><option>AR4</option><option>AR5</option><option>AR6</option></select></label>
        </div>
        {plans.find((p) => p.code === f.plan) && <div className="sub">{planLine(plans.find((p) => p.code === f.plan)!)}</div>}
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
