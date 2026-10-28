/**
 * Platform console (Ekobon staff): companies, plans, access dates, suspend,
 * and the shared factor library. Creating a company creates its first
 * Super admin with a temporary password shown once.
 */
import { CountrySelect } from '../components/CountrySelect';
import { countryLabel } from '../lib/countries';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { api, setTenant, type Company, type DestructionCertificate, type PlanLimits } from '../lib/api';
import { AlertList, PlatformAudit } from './AuditLog';
import { Icon } from '../components/Icon';
import { BRAND, productName, productSlug } from '../lib/brand';

const lim = (n: number | null) => (n == null ? 'unlimited' : String(n));
export const planLine = (p: PlanLimits) => `${lim(p.facilities)} facilities · ${lim(p.users)} people · Eko AI ${p.ai ? 'on' : 'off'} · export ${p.export ? 'on' : 'off'} · dashboard groups ${p.groups ? 'on' : 'off'}`;

export function Console() {
  const { toast, reload } = useApp();
  const [list, setList] = useState<Company[]>([]);
  const [plans, setPlans] = useState<PlanLimits[]>([]);
  const [tab, setTab] = useState<'companies' | 'plans' | 'security'>('companies');
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
        <div><div className="eyebrow">Ekobon · platform</div><h1>Platform console</h1><p className="sub">Companies on this installation, their plans, subscription and access. The shared emission factors are under Emission factors in the side menu.</p></div>
        <div className="row"><button className="btn p" onClick={() => setAdding(true)}><Icon name="plus" size={16} />New company</button></div>
      </div>
      <div className="tabs"><button className={tab === 'companies' ? 'on' : ''} onClick={() => setTab('companies')}>Companies ({list.length})</button><button className={tab === 'plans' ? 'on' : ''} onClick={() => setTab('plans')}>Plans</button><button className={tab === 'security' ? 'on' : ''} onClick={() => setTab('security')}>Security & deletions</button></div>
      {err && <div className="note bad">{err}</div>}
      {tab === 'security' ? <ConsoleSecurity /> : tab === 'plans' ? (
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
          <thead><tr><th>Company</th><th>Plan</th><th>Subscription</th><th>Access until</th><th className="num">Facilities</th><th className="num">People</th><th className="num">Entries</th><th>Last login</th><th className="ctr">Status</th><th /></tr></thead>
          <tbody>{list.map((c) => { const p = planOf(c.plan); const d = daysLeft(c.access_expiry); return (
            <tr key={c.id}>
              <td><b>{c.name}</b><div className="sub">{countryLabel(c.country)} · {c.gwp_set}</div><div className="row" style={{ gap: 4, marginTop: 3 }}>{(c.products ?? ['ekotrace']).map((p) => <span key={p} className="chip grey">{PRODUCT_LABEL[p]}</span>)}</div></td>
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

type Prod = 'ekotrace' | 'ekofin' | 'cbam' | 'ccts' | 'brsr' | 'uaemrv' | 'energy' | 'compliance';
const PRODUCT_LABEL: Record<Prod, string> = { get ekotrace() { return productName('ekotrace'); }, get ekofin() { return productName('ekofin'); }, get cbam() { return productName('cbam'); }, ccts: 'India CCTS', brsr: 'BRSR Core', uaemrv: 'UAE MRV', energy: 'Energy management', compliance: 'Compliance desk' };
/** The packages the company has, chosen one by one: EKOTRACE (own GHG inventory), EKOFIN (financed emissions), CBAM Exporter, India CCTS, BRSR Core, UAE MRV — in any mix. */
function ProductBoxes({ value, onChange }: { value: Prod[]; onChange: (v: Prod[]) => void }) {
  const flip = (p: Prod) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="field"><span>Products</span>
      <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('ekotrace')} onChange={() => flip('ekotrace')} />EKOTRACE · own GHG inventory</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('ekofin')} onChange={() => flip('ekofin')} />{productName('ekofin') === 'EKOFIN' ? 'EKOFIN · financed emissions' : 'Financed emissions'} (banks, investors)</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('cbam')} onChange={() => flip('cbam')} />CBAM Exporter · CBAM only, simpler menu (included with {productName('ekotrace')})</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('ccts')} onChange={() => flip('ccts')} />India CCTS · GEI tracker for obligated entities</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('brsr')} onChange={() => flip('brsr')} />BRSR Core · SEBI, listed companies</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('uaemrv')} onChange={() => flip('uaemrv')} />UAE MRV · Abu Dhabi facility MRV and federal reporting</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('energy')} onChange={() => flip('energy')} />Energy management · baselines, savings, measures, ISO 50001</label>
        <label className="row chkline" style={{ gap: 6 }}><input type="checkbox" checked={value.includes('compliance')} onChange={() => flip('compliance')} />Compliance desk · which regulations apply, obligations and deadlines</label>
      </div>
      {(['ccts', 'brsr', 'uaemrv', 'energy', 'compliance'] as Prod[]).some((p) => value.includes(p)) && <small className="muted">{value.includes('ekotrace') ? `With ${productName('ekotrace')}, the add-on packages read its approved entries and sit in its menu.` : `Without ${productName('ekotrace')}, each add-on package has a small menu of its own and its figures are typed.`}</small>}
      {!value.length && <small className="bad">Choose at least one</small>}
    </div>);
}

function EditCompany({ c, plans, onClose, onSaved }: { c: Company; plans: PlanLimits[]; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const [prods, setProds] = useState<Prod[]>(c.products ?? ['ekotrace']);
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
        <ProductBoxes value={prods} onChange={setProds} />
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
        {c.status === 'suspended' && <Destroy c={c} onDone={() => { ref.current?.close(); onSaved(); }} />}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn p" disabled={f.name.trim().length < 2 || !prods.length} onClick={async () => {
            setErr(null);
            try {
              await api.updateCompany(c.id, { name: f.name.trim(), plan: f.plan, products: prods, accessExpiry: f.accessExpiry, price: f.price === '' ? null : Number(f.price), billingCurrency: f.billingCurrency || 'AED',
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
  const [prods, setProds] = useState<Prod[]>(['ekotrace']);
  const [f, setF] = useState({ name: '', country: '', gwpSet: 'AR5', plan: 'enterprise', accessExpiry: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10), saName: '', saEmail: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <dialog ref={ref} className="modal" onClose={onClose}>
      <div className="in">
        <h2>New company</h2>
        <label className="field"><span>Company name</span><input className="input" value={f.name} onChange={set('name')} /></label>
        <div className="row">
          <label className="field" style={{ minWidth: 200 }}><span>Country</span><CountrySelect value={f.country} onChange={(c) => setF({ ...f, country: c })} /></label>
          <label className="field grow"><span>Plan</span><select className="input" value={f.plan} onChange={set('plan')}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
          <label className="field grow"><span>Access until</span><input className="input" type="date" value={f.accessExpiry} onChange={set('accessExpiry')} /></label>
          <label className="field"><span>GWP</span><select className="input" value={f.gwpSet} onChange={set('gwpSet')}><option>AR4</option><option>AR5</option><option>AR6</option></select></label>
        </div>
        {plans.find((p) => p.code === f.plan) && <div className="sub">{planLine(plans.find((p) => p.code === f.plan)!)}</div>}
        <ProductBoxes value={prods} onChange={setProds} />
        <h3>First Super admin</h3>
        <div className="row">
          <label className="field grow"><span>Name</span><input className="input" value={f.saName} onChange={set('saName')} /></label>
          <label className="field grow"><span>Work email</span><input className="input" type="email" value={f.saEmail} onChange={set('saEmail')} /></label>
        </div>
        {err && <div className="note bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => ref.current?.close()}>Cancel</button>
          <button className="btn p" disabled={f.name.trim().length < 2 || f.saName.trim().length < 2 || !f.saEmail.includes('@') || !prods.length} onClick={async () => {
            setErr(null);
            try {
              const r = await api.createCompany({ name: f.name.trim(), country: f.country.toUpperCase(), gwpSet: f.gwpSet, plan: f.plan, products: prods, accessExpiry: f.accessExpiry, superAdmin: { name: f.saName.trim(), email: f.saEmail.trim() } });
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

/** End of contract: delete a suspended company's data and keep the certificate. */
function Destroy({ c, onDone }: { c: Company; onDone: () => void }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ confirm: '', reason: '', sha: '' });
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn ghost danger" style={{ justifySelf: 'start' }} onClick={() => setOpen(true)}>Delete all of this company's data…</button>;
  return (
    <div className="destroybox">
      <h3>Delete all of {c.name}'s data</h3>
      <ol className="sub small">
        <li>The company downloads its export (Security & audit log → Data export) — or open the company and download it for them.</li>
        <li>Paste the export's manifest checksum (the X-Manifest-SHA256 of the download, shown in its audit record) so the certificate names it.</li>
        <li>Type the company name. Everything it holds is deleted at once and cannot be brought back. Its audit trail stays until its retention ends.</li>
      </ol>
      <label className="field"><span>Reason (on the certificate)</span><input className="input" value={f.reason} placeholder="e.g. Contract ended 31 Dec 2026; data return confirmed by …" onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      <label className="field"><span>Export manifest SHA-256 (optional)</span><input className="input mono" value={f.sha} onChange={(e) => setF({ ...f, sha: e.target.value.trim().toLowerCase() })} /></label>
      <label className="field"><span>Type <b>{c.name}</b> to confirm</span><input className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
      {err && <div className="note bad">{err}</div>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn danger" disabled={f.confirm !== c.name || f.reason.trim().length < 5} onClick={async () => {
          setErr(null);
          try { const r = await api.destroyCompany(c.id, { confirm: f.confirm, reason: f.reason.trim(), ...(f.sha ? { exportSha256: f.sha } : {}) }); downloadCertificate(r.certificate); toast('Deleted — the certificate was downloaded'); onDone(); }
          catch (e) { setErr((e as Error).message); }
        }}>Delete for good</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>);
}

function certificateHtml(c: DestructionCertificate) {
  const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const rows = Object.entries(c.rows_deleted).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Certificate of destruction — ${esc(c.company)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;color:#10201C}h1{font-size:24px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:10px 0}td,th{border-bottom:1px solid #DDE5E0;padding:5px 8px;text-align:left}td.n{text-align:right}.k td:first-child{color:#5B6B66;width:34%}.box{border:1px solid #C9D9D2;border-radius:10px;padding:16px 18px;margin:16px 0}small{color:#5B6B66}</style></head><body>
<small>${BRAND.name}</small><h1>Certificate of secure data destruction</h1><small>Certificate ${esc(c.id)}</small>
<div class="box"><table class="k"><tr><td>Company</td><td><b>${esc(c.company)}</b> (${esc(c.country)})</td></tr><tr><td>Company id</td><td>${esc(c.tenant_id)}</td></tr>
<tr><td>Deleted on</td><td>${esc(new Date(c.performed_at).toUTCString())}</td></tr><tr><td>Performed by</td><td>${esc(c.requested_by)}</td></tr><tr><td>Reason</td><td>${esc(c.reason)}</td></tr>
<tr><td>Export handed over</td><td>${c.export_sha256 ? `manifest SHA-256 <code>${esc(c.export_sha256)}</code>` : 'not recorded'}</td></tr></table></div>
<p>All records and files held for the company in the ${BRAND.name} production database were permanently deleted in one transaction: <b>${total.toLocaleString('en')} records</b> in ${rows.length} tables and <b>${c.files_deleted.toLocaleString('en')} stored files</b>. The deletion was verified: no record of the company remains in those tables.</p>
<p><b>Backups:</b> encrypted backups taken before this date still hold copies; they expire and are destroyed by <b>${esc(c.backups_until)}</b> under the backup retention schedule, and are not restored except for disaster recovery of the whole service.</p>
<p><b>Audit trail:</b> the company's security audit records (who signed in or changed what, when, from where) are append-only and are kept until <b>${esc(c.audit_until)}</b>, then removed automatically.</p>
<table><thead><tr><th>Table</th><th class="n">Records deleted</th></tr></thead><tbody>${rows.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="n">${n.toLocaleString('en')}</td></tr>`).join('')}</tbody></table>
<p style="margin-top:40px">Signed for Ekobon: ______________________ &nbsp; Date: ____________</p></body></html>`;
}
function downloadCertificate(c: DestructionCertificate) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([certificateHtml(c)], { type: 'text/html' }));
  a.download = `certificate-of-destruction-${c.company.replace(/[^\w]+/g, '-')}.html`; a.click();
}

function ConsoleSecurity() {
  const { toast } = useApp();
  const [certs, setCerts] = useState<DestructionCertificate[] | null>(null);
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof api.platformAlerts>>['alerts'] | null>(null);
  const loadAlerts = () => api.platformAlerts().then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]));
  useEffect(() => { api.destructionCertificates().then((r) => setCerts(r.certificates)).catch(() => setCerts([])); loadAlerts(); }, []);
  return (
    <div className="secgrid">
      <section className="card secbox" style={{ gridColumn: '1 / -1' }}>
        <h2>Security alerts</h2>
        <p className="sub">Platform alerts (failed sign-in bursts, company data deleted, audit chain checks) and every company's high alerts. Companies review their own under Security & audit log.</p>
        {!alerts ? <div className="muted">Loading…</div> : <AlertList alerts={alerts} showCompany canAck onAck={async (id, note) => { try { await api.ackAlert(id, note); loadAlerts(); window.dispatchEvent(new Event('eko-alerts')); } catch (e) { toast((e as Error).message); } }} />}
      </section>
      <PlatformAudit />
      <section className="card secbox">
        <h2>Certificates of destruction</h2>
        <p className="sub">To delete a company's data at the end of its contract: suspend it, then Edit → "Delete all of this company's data".</p>
        {!certs ? <div className="muted">Loading…</div> : !certs.length ? <div className="muted small">None yet.</div> : (
          <table className="t"><thead><tr><th>Company</th><th>Deleted</th><th>By</th><th className="num">Records</th><th className="num">Files</th><th /></tr></thead>
            <tbody>{certs.map((c) => <tr key={c.id}><td><b>{c.company}</b></td><td className="small">{new Date(c.performed_at).toLocaleString('en-GB')}</td><td className="small">{c.requested_by}</td>
              <td className="num">{Object.values(c.rows_deleted).reduce((a, n) => a + n, 0).toLocaleString('en')}</td><td className="num">{c.files_deleted}</td>
              <td><button className="btn ghost xs" onClick={() => downloadCertificate(c)}>Certificate</button></td></tr>)}</tbody></table>)}
      </section>
    </div>);
}
