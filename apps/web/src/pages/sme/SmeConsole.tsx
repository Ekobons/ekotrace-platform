/**
 * SME console (platform admins, /console/sme): the EKOTRACE SME sections of the platform console.
 * Companies are created in the main console (/console) with the 'sme' or 'smenet' package; this page
 * manages what is SME-specific: partners, links, CA validation, settings, scrap, credits, benchmark.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { LEVELS, dmy, f0, f1, n, smeAdminApi, smePublic, type PartnerKind } from '../../lib/sme';
import { Kpi, Kpis, Pill } from './ui';
import { Bars, FySelect, NetHead, currentFy, fyList, errText, rupees, useLoad } from './netShared';
import { CaStatus } from './SmeNetCa';
import { ConsoleSettings } from './SmeConsoleSettings';

const TABS = [
  ['overview', 'Overview', 'chart'], ['companies', 'SME companies', 'building'], ['partners', 'Partners', 'users'], ['links', 'Links', 'plug'],
  ['ca', 'CA validation', 'shield'], ['settings', 'Settings', 'gear'], ['scrap', 'Scrap moderation', 'cycle'], ['credits', 'Carbon credit pool', 'leaf'], ['benchmark', 'Benchmark', 'gauge'],
] as const;
type Tab = (typeof TABS)[number][0];
const KIND: Record<PartnerKind, string> = { buyer: 'Buyer', cluster: 'Cluster', bank: 'Bank', ca_firm: 'CA firm' };
const dash = <span className="muted">—</span>;
const Loading = ({ error }: { error?: string | null }) => <div className="card empty">{error ?? 'Loading…'}</div>;
const Sec = ({ title, lede, tools, children }: { title: string; lede?: ReactNode; tools?: ReactNode; children?: ReactNode }) => (
  <div className="card net-sec">
    <div className="row" style={{ alignItems: 'flex-start' }}><div className="grow"><h2>{title}</h2>{lede && <p className="muted small" style={{ margin: '4px 0 0', maxWidth: '80ch' }}>{lede}</p>}</div>{tools}</div>
    {children}
  </div>);

export function SmeConsole() {
  const [sp, setSp] = useSearchParams();
  const tab = (TABS.find((t) => t[0] === sp.get('tab'))?.[0] ?? 'overview') as Tab;
  // SME data for a year is mostly complete after it ends, so the console opens on the previous year.
  const [fy, setFy] = useState(fyList(currentFy())[1]!);
  const go = (t: Tab) => setSp(t === 'overview' ? {} : { tab: t }, { replace: true });
  return (
    <div className="page">
      <NetHead icon="building" eyebrow="Platform console · EKOTRACE SME" title="SME console" lede="Everything specific to the SME tool and its partner network. Create companies, plans and users in the main console.">
        <Link className="btn" to="/console"><Icon name="gear" />Main console</Link>
      </NetHead>
      <div className="net-con">
        <nav className="net-tabs" aria-label="SME console sections">
          {TABS.map(([k, l, i]) => <button key={k} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)}><Icon name={i} />{l}</button>)}
        </nav>
        <div className="net-sec" style={{ minWidth: 0 }}>
          {tab === 'overview' && <Overview fy={fy} setFy={setFy} go={go} />}
          {tab === 'companies' && <Companies fy={fy} setFy={setFy} />}
          {tab === 'partners' && <Partners />}
          {tab === 'links' && <Links />}
          {tab === 'ca' && <CaQueue />}
          {tab === 'settings' && <ConsoleSettings />}
          {tab === 'scrap' && <Scrap />}
          {tab === 'credits' && <Credits />}
          {tab === 'benchmark' && <Benchmark fy={fy} setFy={setFy} />}
        </div>
      </div>
    </div>);
}

/* ------------------------------------------------------------------ overview --- */
function Overview({ fy, setFy, go }: { fy: string; setFy: (s: string) => void; go: (t: Tab) => void }) {
  const { data: o, error } = useLoad(() => smeAdminApi.overview(fy), [fy]);
  if (!o) return <Loading error={error} />;
  const c = o.companies ?? {}, u = o.users ?? {}, t = o.totals ?? {};
  const ca = new Map<string, number>((o.ca ?? []).map((x: any) => [x.status, x.n]));
  const part = new Map<string, number>((o.partners ?? []).map((x: any) => [x.kind, x.n]));
  const months = (o.signups ?? []) as { month: string; n: number }[];
  const mmax = Math.max(...months.map((m) => m.n), 1);
  const waiting = n(ca.get('requested'));
  return (
    <>
      <div className="row"><span className="muted small grow">Figures for companies below exclude demo companies. Results are for the chosen year.</span><FySelect value={fy} current={currentFy()} onChange={setFy} /></div>
      <div className="sme-kpis net-k3">
        <Kpi label="SME companies" value={f0(c.total)} unit={`${f0(c.active)} active · ${f0(c.trial)} on trial`} />
        <Kpi label="New in 30 days" value={f0(c.new30)} unit="companies" />
        <Kpi label="With emissions data" value={f0(o.withData)} unit={`companies · ${o.fy}`} />
        <Kpi label="SME users" value={f0(u.total)} unit={`${f0(u.active30)} signed in within 30 days`} />
        <Kpi label="Scope 1 + 2 tracked" value={f0(t.s12)} unit={`tCO₂e across ${f0(t.n)} results`} />
        <Kpi label="Contract value" value={rupees(o.revenue)} unit="active SME companies" />
      </div>
      {waiting > 0 && <div className="sme-callout warn">{waiting} CA validation request{waiting > 1 ? 's are' : ' is'} waiting for a firm. <button className="btn sm" onClick={() => go('ca')}>Assign</button></div>}
      <div className="sme-grid2">
        <div className="card"><h2>Sign-ups, last 12 months</h2>
          {months.length ? <div className="net-months">{months.map((m) => <div key={m.month}><span>{m.n}</span><i style={{ height: `${(m.n / mmax) * 70}%` }} /><small>{new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</small></div>)}</div>
            : <p className="muted">No sign-ups yet.</p>}
        </div>
        <div className="card"><h2>CA validation queue</h2>
          <table className="sme-tbl" style={{ marginTop: 8 }}><tbody>
            {['requested', 'assigned', 'in_review', 'validated', 'rejected'].map((s) => <tr key={s}><td><CaStatus s={s} /></td><td className="r">{f0(ca.get(s) ?? 0)}</td></tr>)}
          </tbody></table></div>
      </div>
      <div className="sme-grid2">
        <div className="card"><div className="row"><h2 className="grow">Network partners</h2><button className="btn sm ghost" onClick={() => go('partners')}>Manage</button></div>
          <table className="sme-tbl" style={{ marginTop: 8 }}><tbody>
            {(['buyer', 'cluster', 'bank', 'ca_firm'] as PartnerKind[]).map((k) => <tr key={k}><td>{KIND[k]}</td><td className="r">{f0(part.get(k) ?? 0)}</td></tr>)}
          </tbody></table></div>
        <div className="card"><div className="row"><h2 className="grow">Plans</h2><button className="btn sm ghost" onClick={() => go('settings')}>Edit in Settings</button></div>
          <table className="sme-tbl" style={{ marginTop: 8 }}><thead><tr><th>Plan</th><th>Modules</th><th className="r">Price</th></tr></thead><tbody>
            {(o.plans ?? []).map((p: any) => <tr key={p.id}><td><b>{p.name}</b>{p.ca_validation && <div className="muted small">Includes CA validation</div>}</td><td>{p.modules === 'all' ? 'All' : `${p.modules.length} modules`}</td><td className="r">{n(p.price_inr) ? `₹${f0(p.price_inr)}` : 'Free'}</td></tr>)}
          </tbody></table></div>
      </div>
    </>);
}

/* ------------------------------------------------------------------ companies --- */
function Companies({ fy, setFy }: { fy: string; setFy: (s: string) => void }) {
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [state, setState] = useState('');
  const states = useLoad(() => smePublic.info().then((r) => r.states).catch(() => [] as string[]), []);
  const { data, error } = useLoad(() => smeAdminApi.companies({ fy, search, state }), [fy, search, state]);
  const rows = data?.companies ?? [];
  return (
    <Sec title="SME companies" lede={<>Companies with the EKOTRACE SME package and their figures for the chosen year. To add a company, create it in the <Link to="/console">main console</Link> and switch on the EKOTRACE SME package; its owner then signs in at /sme.</>}
      tools={<Link className="btn p" to="/console"><Icon name="plus" />Create a company</Link>}>
      <form className="net-tools" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <div className="grow" style={{ minWidth: 180 }}><input className="input" type="search" placeholder="Search name or industry" aria-label="Search companies" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setSearch(''); }} /></div>
        <select className="input" aria-label="State" value={state} onChange={(e) => setState(e.target.value)}><option value="">All states</option>{(states.data ?? []).map((s) => <option key={s}>{s}</option>)}</select>
        <FySelect value={fy} current={currentFy()} onChange={setFy} />
        <button className="btn">Search</button>
      </form>
      {!data ? <Loading error={error} /> : !rows.length ? <div className="empty">{search || state ? 'No companies match.' : 'No SME companies yet.'}</div> : (
        <div className="sme-scroll">
          <table className="sme-tbl"><thead><tr><th>Company</th><th>Plan</th><th className="r">Modules</th><th className="r">Scope 1 + 2</th><th className="r">ESG</th><th className="r">SRMM</th><th className="r">Savings</th><th className="r">Partners</th><th>Last sign-in</th></tr></thead>
            <tbody>{rows.map((c: any) => (
              <tr key={c.id}>
                <td className="net-name"><b>{c.name} {c.is_example && <span className="chip warn">Demo</span>}</b><small>{[c.industry, c.state].filter(Boolean).join(' · ') || 'Profile not filled'}</small></td>
                <td>{c.plan}{c.status !== 'active' && <div><Pill kind="apply">{c.status}</Pill></div>}<div className="muted small">to {dmy(c.access_expiry)}</div></td>
                <td className="r">{f0(c.modules)}</td>
                <td className="r">{c.scope1 == null ? dash : `${f1(n(c.scope1) + n(c.scope2))} t`}</td>
                <td className="r">{c.esg_pct == null ? dash : <>{f0(c.esg_pct)}%<div className="muted small">{c.esg_level ? `L${c.esg_level} ${LEVELS[c.esg_level]}` : 'Not rated'}</div></>}</td>
                <td className="r">{c.srmm_pct == null || !n(c.srmm_pct) ? dash : `${f1(c.srmm_pct)}%`}</td>
                <td className="r">{c.savings_inr == null ? dash : `${rupees(c.savings_inr)}/yr`}</td>
                <td className="r">{c.partners ? `${c.sharing} of ${c.partners} sharing` : dash}{c.bench_consent && <div className="muted small">benchmark consent</div>}</td>
                <td>{c.last_login ? dmy(c.last_login) : <span className="muted">Never</span>}</td>
              </tr>))}</tbody></table>
        </div>)}
      {data && rows.length >= 500 && <p className="muted small">Showing the newest 500. Narrow the search to see others.</p>}
    </Sec>);
}

/* ------------------------------------------------------------------ partners --- */
function Partners() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => smeAdminApi.partners(), []);
  const [edit, setEdit] = useState<Record<string, { kind: PartnerKind | ''; city: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const save = async (id: string) => {
    const e = edit[id]; if (!e || !e.kind) return;
    setBusy(id);
    try { await smeAdminApi.setPartner(id, e.kind, e.city.trim()); toast('Partner saved'); setEdit(({ [id]: _, ...rest }) => rest); reload(); } catch (x) { toast(errText(x)); } finally { setBusy(null); }
  };
  return (
    <Sec title="Network partners" lede={<>Companies with the SME network package. Set what each one is: the kind decides what it sees at /sme-net. Add new partners in the <Link to="/console">main console</Link> with the “SME network” package switched on.</>}>
      {!data.partners.length ? <div className="empty">No companies with the SME network package yet.</div> : (
        <div className="sme-scroll">
          <table className="sme-tbl"><thead><tr><th>Company</th><th>Kind</th><th>City</th><th className="r">SMEs linked</th><th /></tr></thead>
            <tbody>{data.partners.map((p) => {
              const e = edit[p.id] ?? { kind: p.kind ?? '', city: p.city ?? '' };
              const dirty = !!edit[p.id] && (e.kind !== (p.kind ?? '') || e.city !== (p.city ?? ''));
              return (
                <tr key={p.id}>
                  <td className="net-name"><b>{p.name}</b><small>{p.status}{!p.kind && ' · not set up yet'}</small></td>
                  <td><select className="input sm" aria-label={`Kind of ${p.name}`} value={e.kind} onChange={(x) => setEdit({ ...edit, [p.id]: { ...e, kind: x.target.value as PartnerKind } })}>
                    {!p.kind && <option value="">Choose…</option>}{(Object.keys(KIND) as PartnerKind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></td>
                  <td><input className="input sm" style={{ width: 130 }} aria-label={`City of ${p.name}`} value={e.city} onChange={(x) => setEdit({ ...edit, [p.id]: { ...e, city: x.target.value } })} /></td>
                  <td className="r">{p.links ? `${p.sharing} of ${p.links} sharing` : dash}</td>
                  <td className="r"><button className="btn sm p" disabled={!dirty || !e.kind || busy === p.id} onClick={() => save(p.id)}>Save</button></td>
                </tr>); })}</tbody></table>
        </div>)}
    </Sec>);
}

/* ------------------------------------------------------------------ links --- */
function Links() {
  const { toast } = useApp();
  const [partner, setPartner] = useState('');
  const { data, error, reload } = useLoad(() => smeAdminApi.links({ partner }), [partner]);
  const partners = useLoad(() => smeAdminApi.partners(), []);
  const smes = useLoad(() => smeAdminApi.companies({}), []);
  const [f, setF] = useState({ partnerTenant: '', smeTenant: '', share: '', loan: '', ev: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const kindOf = partners.data?.partners.find((p) => p.id === f.partnerTenant)?.kind;
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await smeAdminApi.addLink({ partnerTenant: f.partnerTenant, smeTenant: f.smeTenant, purchaseSharePct: num(f.share), loanCr: num(f.loan), evCr: num(f.ev) });
      toast('Link added. Sharing stays off until the SME switches it on.'); setF({ ...f, smeTenant: '', share: '', loan: '', ev: '' }); reload();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  const del = async (l: any) => {
    if (!window.confirm(`Remove the link between ${l.partner} and ${l.sme}? The partner stops seeing this SME.`)) return;
    try { await smeAdminApi.deleteLink(l.id); toast('Link removed'); reload(); } catch (x) { toast(errText(x)); }
  };
  return (
    <>
      <Sec title="Add a link" lede="Connect an SME to a partner. The partner sees nothing until the SME switches sharing on in its own Share & validate page.">
        <form className="net-form" onSubmit={add}>
          <label className="field"><span>Partner</span><select className="input" required value={f.partnerTenant} onChange={(e) => setF({ ...f, partnerTenant: e.target.value })}>
            <option value="">Choose…</option>{(partners.data?.partners ?? []).filter((p) => p.kind && p.kind !== 'ca_firm').map((p) => <option key={p.id} value={p.id}>{p.name} ({KIND[p.kind!]})</option>)}</select></label>
          <label className="field"><span>SME company</span><select className="input" required value={f.smeTenant} onChange={(e) => setF({ ...f, smeTenant: e.target.value })}>
            <option value="">Choose…</option>{(smes.data?.companies ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {kindOf === 'buyer' && <label className="field"><span>Share of purchases (%)</span><input className="input num" type="number" min={0} max={100} step="any" value={f.share} onChange={(e) => setF({ ...f, share: e.target.value })} /></label>}
          {kindOf === 'bank' && <label className="field"><span>Loan (₹ crore)</span><input className="input num" type="number" min={0} step="any" value={f.loan} onChange={(e) => setF({ ...f, loan: e.target.value })} /></label>}
          {kindOf === 'bank' && <label className="field"><span>Equity + debt (₹ crore)</span><input className="input num" type="number" min={0} step="any" value={f.ev} onChange={(e) => setF({ ...f, ev: e.target.value })} /></label>}
          <div><button className="btn p" disabled={busy || !f.partnerTenant || !f.smeTenant}><Icon name="plus" />Add link</button></div>
        </form>
        {err && <div className="note bad">{err}</div>}
      </Sec>
      <Sec title="Links" tools={<select className="input" style={{ maxWidth: 280 }} aria-label="Filter by partner" value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">All partners</option>{(partners.data?.partners ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}>
        {!data ? <Loading error={error} /> : !data.links.length ? <div className="empty">No links{partner ? ' for this partner' : ''} yet.</div> : (
          <div className="sme-scroll">
            <table className="sme-tbl"><thead><tr><th>Partner</th><th>SME</th><th>Sharing</th><th className="r">Purchases</th><th className="r">Loan</th><th className="r">Equity + debt</th><th>Linked</th><th /></tr></thead>
              <tbody>{data.links.map((l: any) => (
                <tr key={l.id}>
                  <td className="net-name"><b>{l.partner}</b><small>{l.kind ? KIND[l.kind as PartnerKind] : 'Kind not set'}</small></td>
                  <td>{l.sme}</td>
                  <td>{l.share ? <><Pill kind="good">Sharing</Pill>{l.consent_at && <div className="muted small">since {dmy(l.consent_at)}</div>}</> : l.revoked_at ? <><Pill kind="apply">Stopped</Pill><div className="muted small">{dmy(l.revoked_at)}</div></> : <Pill kind="soon">Not shared</Pill>}</td>
                  <td className="r">{l.purchase_share_pct == null ? dash : `${f1(l.purchase_share_pct)}%`}</td>
                  <td className="r">{l.loan_cr == null ? dash : `₹${f1(l.loan_cr)} Cr`}</td>
                  <td className="r">{l.ev_cr == null ? dash : `₹${f1(l.ev_cr)} Cr`}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dmy(l.created_at)}</td>
                  <td className="r"><button className="btn sm danger" onClick={() => del(l)}>Remove</button></td>
                </tr>))}</tbody></table>
          </div>)}
      </Sec>
    </>);
}

/* ------------------------------------------------------------------ CA queue --- */
function CaQueue() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => smeAdminApi.ca(), []);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [rej, setRej] = useState<{ id: string; notes: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const run = async (id: string, b: Parameters<typeof smeAdminApi.assignCa>[1], msg: string) => {
    setBusy(id);
    try { await smeAdminApi.assignCa(id, b); toast(msg); setRej(null); reload(); } catch (x) { toast(errText(x)); } finally { setBusy(null); }
  };
  return (
    <Sec title="CA validation queue" lede="SME companies asking for their SRMM self-assessment to be validated. Assign each to a CA firm; the firm reviews it in its own SME network view and records the result. Reject only requests that should not go ahead (for example, the plan does not include validation).">
      {!data.firms.length && <div className="sme-callout warn">No active CA firm yet. Set a partner’s kind to “CA firm” in Partners.</div>}
      {!data.requests.length ? <div className="empty">No validation requests yet.</div> : (
        <div className="sme-scroll">
          <table className="sme-tbl"><thead><tr><th>Company</th><th className="r">Self-assessed</th><th>Status</th><th>CA firm</th><th className="r">Result</th><th style={{ minWidth: 250 }}>Action</th></tr></thead>
            <tbody>{data.requests.map((r: any) => {
              const open = r.status === 'requested' || r.status === 'assigned';
              const firm = pick[r.id] ?? r.ca_tenant ?? '';
              return (
                <tr key={r.id}>
                  <td className="net-name"><b>{r.company}</b><small>{r.fy} · {r.srmm_version === 'svc' ? 'SRMM v3.2 Services' : 'SRMM v3.1 Manufacturing'}<br />{[r.state, `asked ${dmy(r.created_at)}`].filter(Boolean).join(' · ')}</small></td>
                  <td className="r">{r.self_pct == null ? dash : `${f1(r.self_pct)}%`}</td>
                  <td><CaStatus s={r.status} />{r.publish_on_icai && <div className="muted small">Publish on ICAI</div>}</td>
                  <td style={{ minWidth: 150 }}>{r.ca_firm ?? <span className="muted">Not assigned</span>}{r.reviewer_name && <div className="muted small">{r.reviewer_name}</div>}</td>
                  <td className="r">{r.validated_pct == null ? dash : `${f1(r.validated_pct)}% · L${r.validated_level ?? 0}`}</td>
                  <td>{!open ? <span className="muted small">{r.notes || (r.status === 'in_review' ? 'The firm is reviewing.' : '')}</span> : rej?.id === r.id ? (
                    <div className="net-sec" style={{ gap: 6 }}>
                      <textarea className="input" style={{ height: 64, padding: 8, width: '100%' }} placeholder="Reason, shown to the company" value={rej?.notes ?? ''} onChange={(e) => setRej({ id: r.id, notes: e.target.value })} />
                      <div className="row"><button className="btn sm danger" disabled={!rej?.notes.trim() || busy === r.id} onClick={() => run(r.id, { status: 'rejected', notes: rej?.notes.trim() ?? '' }, 'Request rejected')}>Reject</button><button className="btn sm ghost" onClick={() => setRej(null)}>Cancel</button></div>
                    </div>) : (
                    <div className="row" style={{ gap: 6 }}>
                      <select className="input sm" style={{ maxWidth: 230 }} aria-label={`CA firm for ${r.company}`} value={firm} onChange={(e) => setPick({ ...pick, [r.id]: e.target.value })}>
                        <option value="">Choose a firm…</option>{data.firms.map((f) => <option key={f.id} value={f.id}>{f.name}{f.city ? `, ${f.city}` : ''}</option>)}</select>
                      <button className="btn sm p" disabled={!firm || firm === r.ca_tenant || busy === r.id} onClick={() => run(r.id, { caTenant: firm }, 'CA firm assigned')}>{r.ca_tenant ? 'Reassign' : 'Assign'}</button>
                      <button className="btn sm ghost danger" onClick={() => setRej({ id: r.id, notes: '' })}>Reject…</button>
                    </div>)}</td>
                </tr>); })}</tbody></table>
        </div>)}
    </Sec>);
}

/* ------------------------------------------------------------------ scrap --- */
function Scrap() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => smeAdminApi.scrap(), []);
  const [show, setShow] = useState<'all' | 'listed' | 'blocked' | 'sold'>('all');
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const L = data.listings.filter((x: any) => show === 'all' || x.status === show);
  const set = async (x: any, status: 'listed' | 'blocked') => {
    const nt = (note[x.id] ?? x.admin_note ?? '').trim();
    if (status === 'blocked' && !nt) { toast('Add a note so the company knows why it was blocked'); return; }
    setBusy(x.id);
    try { await smeAdminApi.moderateScrap(x.id, status, nt || null); toast(status === 'blocked' ? 'Listing blocked' : 'Listing approved'); reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  const per = (u: string) => (u === 'nos' ? 'piece' : u);
  return (
    <Sec title="Scrap moderation" lede="Listings SME companies put up for sale to recyclers. Hazardous waste can only go to an authorised recycler: check those first. Blocking hides the listing and shows your note to the company."
      tools={<div className="seg">{(['all', 'listed', 'blocked', 'sold'] as const).map((k) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{k === 'all' ? 'All' : k[0]!.toUpperCase() + k.slice(1)}</button>)}</div>}>
      {!L.length ? <div className="empty">No listings{show !== 'all' ? ` marked ${show}` : ''}.</div> : (
        <div className="sme-scroll">
          <table className="sme-tbl"><thead><tr><th>Item</th><th>Company</th><th className="r">Quantity</th><th className="r">Expected price</th><th>Status</th><th style={{ minWidth: 300 }}>Moderation</th></tr></thead>
            <tbody>{L.map((x: any) => (
              <tr key={x.id}>
                <td className="net-name"><b>{x.item}</b><small>{x.hazardous ? <span className="chip bad">Hazardous</span> : 'Non-hazardous'} · {dmy(x.updated_at)}</small></td>
                <td>{x.company}<div className="muted small">{x.state}</div></td>
                <td className="r">{f1(x.qty)} {x.unit}</td>
                <td className="r">₹{f0(x.price)}/{per(x.unit)}</td>
                <td>{x.status === 'listed' ? <Pill kind="good">Listed</Pill> : x.status === 'blocked' ? <Pill kind="apply">Blocked</Pill> : <Pill kind="watch">Sold</Pill>}</td>
                <td>{x.status === 'sold' ? <span className="muted small">{x.admin_note ?? 'Sold'}</span> : (
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input sm grow" style={{ minWidth: 140 }} placeholder="Note to the company" aria-label={`Note for ${x.item}`} maxLength={300} value={note[x.id] ?? x.admin_note ?? ''} onChange={(e) => setNote({ ...note, [x.id]: e.target.value })} />
                    {x.status === 'blocked' ? <button className="btn sm p" disabled={busy === x.id} onClick={() => set(x, 'listed')}>Approve</button> : <button className="btn sm danger" disabled={busy === x.id} onClick={() => set(x, 'blocked')}>Block</button>}
                  </div>)}</td>
              </tr>))}</tbody></table>
        </div>)}
    </Sec>);
}

/* ------------------------------------------------------------------ credits --- */
const CR_STATUS = ['proposed', 'accepted', 'registered', 'issued', 'rejected'] as const;
const CR_LABEL: Record<string, string> = { proposed: 'Proposed', accepted: 'Accepted', registered: 'Registered', issued: 'Credits issued', rejected: 'Rejected' };
const CR_TYPE: Record<string, string> = { solar: 'Rooftop solar', efficiency: 'Energy efficiency', fuel_switch: 'Fuel switch' };
function Credits() {
  const { toast } = useApp();
  const { data, error, reload } = useLoad(() => smeAdminApi.credits(), []);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return <Loading error={error} />;
  const tot = new Map(data.totals.map((t) => [t.status, t]));
  const live = data.totals.filter((t) => t.status !== 'rejected').reduce((a, t) => a + n(t.t), 0);
  const change = async (id: string, status: (typeof CR_STATUS)[number]) => {
    setBusy(id);
    try { await smeAdminApi.creditStatus(id, status); toast(`Marked ${CR_LABEL[status]!.toLowerCase()}`); reload(); } catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <Kpis>
        <Kpi label="In the pool" value={f0(live)} unit="tCO₂e per year, excluding rejected" />
        {CR_STATUS.filter((s) => s !== 'rejected').map((s) => <Kpi key={s} label={CR_LABEL[s]!} value={f0(tot.get(s)?.n ?? 0)} unit={`${f0(tot.get(s)?.t ?? 0)} tCO₂e/yr`} />)}
      </Kpis>
      <Sec title="Carbon credit pool" lede="Solar, efficiency and fuel-switch projects that SME companies offered to the pooled programme. Move each through accepted → registered → credits issued as the programme progresses.">
        {!data.projects.length ? <div className="empty">No projects offered yet. Companies add them from their Carbon credits page.</div> : (
          <div className="sme-scroll">
            <table className="sme-tbl"><thead><tr><th>Company</th><th>Project</th><th className="r">Size</th><th className="r">Generation / saving</th><th className="r">tCO₂e / yr</th><th>Added</th><th>Status</th></tr></thead>
              <tbody>{data.projects.map((p: any) => (
                <tr key={p.id}>
                  <td className="net-name"><b>{p.company}</b><small>{p.state}</small></td>
                  <td>{CR_TYPE[p.type] ?? p.type}</td>
                  <td className="r">{p.capacity_kw == null ? dash : `${f1(p.capacity_kw)} kW`}</td>
                  <td className="r">{p.kwh_per_year == null ? dash : `${f0(p.kwh_per_year)} kWh`}</td>
                  <td className="r"><b>{f1(p.tco2e_per_year)}</b></td>
                  <td>{dmy(p.created_at)}{p.created_name && <div className="muted small">{p.created_name}</div>}</td>
                  <td><select className="input sm" aria-label={`Status of ${p.company} project`} disabled={busy === p.id} value={p.status} onChange={(e) => change(p.id, e.target.value as (typeof CR_STATUS)[number])}>
                    {CR_STATUS.map((s) => <option key={s} value={s}>{CR_LABEL[s]}</option>)}</select></td>
                </tr>))}</tbody></table>
          </div>)}
      </Sec>
    </>);
}

/* ------------------------------------------------------------------ benchmark --- */
function Benchmark({ fy, setFy }: { fy: string; setFy: (s: string) => void }) {
  const { toast } = useApp();
  const { data, error } = useLoad(() => smeAdminApi.benchmark(fy), [fy]);
  const [busy, setBusy] = useState(false);
  const csv = async () => { setBusy(true); try { await smeAdminApi.benchmarkCsv(fy); } catch (e) { toast(errText(e)); } finally { setBusy(false); } };
  const shown = (data?.groups ?? []).filter((g) => g.shown && g.median != null);
  return (
    <Sec title="Benchmark" lede={<>Anonymised figures from companies that agreed to benchmarking, demo companies excluded. A group’s median is shown only with at least {data?.minGroup ?? 5} companies, so no single company can be identified. The CSV holds one row per company with no names, and the download is logged.</>}
      tools={<div className="row"><FySelect value={fy} current={currentFy()} onChange={setFy} /><button className="btn" disabled={busy || !data?.companies} onClick={csv}><Icon name="download" />CSV</button></div>}>
      {!data ? <Loading error={error} /> : !data.companies ? <div className="empty">No consented results for {data.fy} yet. Try the previous year.</div> : (
        <>
          <Kpis><Kpi label="Companies" value={f0(data.companies)} unit={`consented · ${data.fy}`} /><Kpi label="Industry groups" value={f0(data.groups.length)} unit={`${shown.length} large enough to show`} /></Kpis>
          {shown.length > 0 && <Bars rows={shown.map((g) => ({ label: g.industry, value: n(g.median) }))} fmt={(v) => f1(v)} />}
          <div className="sme-scroll">
            <table className="sme-tbl"><thead><tr><th>Industry</th><th className="r">Companies</th><th className="r">Median intensity</th></tr></thead>
              <tbody>{data.groups.map((g) => (
                <tr key={g.industry}><td>{g.industry}</td><td className="r">{f0(g.n)}</td>
                  <td className="r">{g.shown && g.median != null ? `${f1(g.median)} t / ₹ Cr` : <span className="muted">Hidden, fewer than {data.minGroup}</span>}</td></tr>))}</tbody></table>
          </div>
        </>)}
    </Sec>);
}
