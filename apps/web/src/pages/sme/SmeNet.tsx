/**
 * SME network: what a partner company sees at /sme-net.
 *   buyer    – its suppliers: who shares, their figures (only when shared), invite and remind
 *   cluster  – anonymised aggregates of its members (hidden below the minimum group)
 *   bank     – borrowers and financed emissions on the PCAF method
 *   ca_firm  – SRMM validation requests assigned by the Ekobon team (SmeNetCa.tsx)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { LEVELS, f0, f1, f2, n, smeNetApi, type PartnerKind } from '../../lib/sme';
import { Kpi, Kpis, Pill, copyText } from './ui';
import { Bars, EditNum, FySelect, NetHead, fyList, errText, rupees, srcLabel, useLoad } from './netShared';
import { CaFirm } from './SmeNetCa';

type Overview = Awaited<ReturnType<typeof smeNetApi.overview>>;
const KIND: Record<PartnerKind, string> = { buyer: 'Buyer', cluster: 'Industry cluster', bank: 'Bank', ca_firm: 'CA firm' };

export function SmeNet() {
  const [fy, setFy] = useState<string | undefined>(undefined);
  const { data, error, reload } = useLoad(() => smeNetApi.overview(fy), [fy]);
  const [cur, setCur] = useState<string | null>(null);
  if (data && !cur) {
    setCur(data.fy);
    // The current year is usually still being filled: open the previous one when it has nothing yet.
    const empty = data.kind === 'buyer' ? !(data.suppliers as any[]).some((s) => s.scope12 != null)
      : data.kind === 'bank' ? !(data.borrowers as any[]).some((b) => b.status === 'reported') : data.kind === 'cluster' ? !!data.hidden : false;
    if (empty && fy === undefined) setFy(fyList(data.fy)[1]);
  }
  if (error && !data) return <div className="page"><div className="card net-lock"><div className="ic"><Icon name="info" /></div><div><h2>SME network</h2><p>{error}</p></div></div></div>;
  if (!data) return <div className="page"><div className="card empty">Loading…</div></div>;
  const fyPick = data.kind === 'ca_firm' ? null : <FySelect value={data.fy} current={cur ?? data.fy} onChange={setFy} />;
  const eyebrow = <>{KIND[data.kind]} · {data.partner.name}{data.partner.city ? ` · ${data.partner.city}` : ''}</>;
  return (
    <div className="page">
      {data.kind === 'buyer' && <Buyer o={data} eyebrow={eyebrow} fyPick={fyPick} reload={reload} />}
      {data.kind === 'cluster' && <Cluster o={data} eyebrow={eyebrow} fyPick={fyPick} reload={reload} />}
      {data.kind === 'bank' && <Bank o={data} eyebrow={eyebrow} fyPick={fyPick} reload={reload} />}
      {data.kind === 'ca_firm' && <CaFirm o={data} eyebrow={eyebrow} reload={reload} />}
    </div>);
}

type ViewProps = { o: Overview; eyebrow: React.ReactNode; fyPick: React.ReactNode; reload: () => void };

/* ------------------------------------------------------------------ invite --- */
function Invite({ kind, onDone }: { kind: 'buyer' | 'cluster' | 'bank'; onDone: () => void }) {
  const { toast } = useApp();
  const [f, setF] = useState({ email: '', company: '', name: '', share: '', loan: '', ev: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ email: string; company: string; newCompany: boolean; temporaryPassword: string | null; emailed: boolean } | null>(null);
  const pwRef = useRef<HTMLElement>(null);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const who = kind === 'buyer' ? 'supplier' : kind === 'bank' ? 'borrower' : 'member';
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await smeNetApi.invite({ email: f.email.trim(), company: f.company.trim() || undefined, name: f.name.trim() || undefined,
        purchaseSharePct: kind === 'buyer' ? num(f.share) : undefined, loanCr: kind === 'bank' ? num(f.loan) : undefined, evCr: kind === 'bank' ? num(f.ev) : undefined });
      setRes({ email: f.email.trim(), company: f.company.trim(), ...r });
      setF({ email: '', company: '', name: '', share: '', loan: '', ev: '' });
      onDone();
    } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
  };
  return (
    <div className="card net-sec">
      <div><h2>Invite a {who}</h2>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Enter the owner’s e-mail. If the company is not on EKOTRACE SME yet, add its name and we create its account. You see its figures only after it switches sharing on.</p></div>
      {res && (res.temporaryPassword ? (
        <div className="net-pw" role="status">
          <b>{res.company || res.email} is set up. Give them this temporary password.</b>
          <code ref={pwRef}>{res.temporaryPassword}</code>
          <p>It is shown <b>only once</b>. They sign in at <b>{window.location.origin}/sme</b> with <b>{res.email}</b> and this password, then choose their own.{res.emailed ? ' We have also e-mailed it to them.' : ' E-mail is not set up on this server, so please pass it on yourself.'}</p>
          <div className="row">
            <button type="button" className="btn sm" onClick={async () => { const ok = await copyText(res.temporaryPassword!, pwRef.current); toast(ok ? 'Password copied' : 'Selected, press Ctrl+C to copy'); }}><Icon name="paste" />Copy password</button>
            <button type="button" className="btn sm ghost" onClick={() => setRes(null)}>I have passed it on</button>
          </div>
        </div>) : (
        <div className="note" style={{ background: 'var(--primary-soft)' }} role="status">{res.email} already uses EKOTRACE SME and is now linked to you. They will see your request in Share &amp; validate.{' '}<button type="button" className="btn sm ghost" onClick={() => setRes(null)}>OK</button></div>))}
      <form className="net-form" onSubmit={send}>
        <label className="field"><span>Owner’s e-mail</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="owner@company.in" /></label>
        <label className="field"><span>Company name <small>if new</small></span><input className="input" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="e.g. Shree Ganesh Fasteners" /></label>
        <label className="field"><span>Contact name <small>optional</small></span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        {kind === 'buyer' && <label className="field"><span>Share of your purchases <small>%</small></span><input className="input num" type="number" min={0} max={100} step="any" value={f.share} onChange={(e) => setF({ ...f, share: e.target.value })} /></label>}
        {kind === 'bank' && <label className="field"><span>Loan outstanding <small>₹ crore</small></span><input className="input num" type="number" min={0} step="any" value={f.loan} onChange={(e) => setF({ ...f, loan: e.target.value })} /></label>}
        {kind === 'bank' && <label className="field"><span>Its equity + debt <small>₹ crore</small></span><input className="input num" type="number" min={0} step="any" value={f.ev} onChange={(e) => setF({ ...f, ev: e.target.value })} /></label>}
        <div><button className="btn p" disabled={busy || !f.email}>{busy ? 'Inviting…' : 'Invite'}</button></div>
      </form>
      {err && <div className="note bad">{err}</div>}
    </div>);
}

function useInvite(kind: 'buyer' | 'cluster' | 'bank') {
  const { can } = useApp();
  const [open, setOpen] = useState(false);
  const allowed = can('super_admin', 'admin');
  const label = kind === 'buyer' ? 'Invite a supplier' : kind === 'bank' ? 'Invite a borrower' : 'Invite members';
  const button = allowed ? <button className={`btn${open ? '' : ' p'}`} onClick={() => setOpen(!open)}><Icon name={open ? 'x' : 'plus'} />{open ? 'Close' : label}</button> : null;
  return { open: open && allowed, button };
}

const staleYear = (fy: string) => <div className="sme-callout">Partners have shared, but nothing is entered for {fy} yet. Most companies complete a year after it ends in March, so try the previous year.</div>;

/* ------------------------------------------------------------------ buyer --- */
function Buyer({ o, eyebrow, fyPick, reload }: ViewProps) {
  const { can, toast } = useApp();
  const inv = useInvite('buyer');
  const edit = can('super_admin', 'admin', 'manager');
  const S = (o.suppliers ?? []) as any[];
  const sum = o.summary as { partners: number; coveragePct: number; reportedScope12: number };
  const sharing = S.filter((s) => s.shared).length;
  const [busy, setBusy] = useState<string | null>(null);
  const remind = async (s: any) => {
    setBusy(s.linkId);
    try { const r = await smeNetApi.remind(s.linkId); toast(r.emailed ? `Reminder e-mailed to ${s.name}` : `Reminder noted for ${s.name}. E-mail is not set up, so please also call them.`); reload(); }
    catch (e) { toast(errText(e)); } finally { setBusy(null); }
  };
  const status = (s: any) => s.status === 'validated' ? <Pill kind="good">CA-validated</Pill> : s.status === 'responded' ? <Pill kind="good">Shared</Pill>
    : s.status === 'no_data' ? <Pill kind="watch">Shared · no {o.fy} data</Pill> : s.status === 'reminded' ? <Pill kind="soon">Reminded</Pill> : <Pill kind="soon">Not shared yet</Pill>;
  const dash = <span className="muted">—</span>;
  return (
    <>
      <NetHead icon="building" eyebrow={eyebrow} title="Your suppliers" lede="Value-chain partners and the sustainability summary each one shares with you, for BRSR Core. Figures appear only while a supplier keeps sharing switched on.">{fyPick}{inv.button}</NetHead>
      {inv.open && <Invite kind="buyer" onDone={reload} />}
      <Kpis>
        <Kpi label="Suppliers linked" value={f0(sum.partners)} unit={`${sharing} sharing with you`} />
        <Kpi label="Coverage" value={`${f0(sum.coveragePct)}%`} unit="of linked purchase value has reported" good={sum.coveragePct >= 75} />
        <Kpi label="Reported Scope 1 + 2" value={f1(sum.reportedScope12)} unit={`tCO₂e · ${o.fy}`} />
        <Kpi label="Waiting for" value={f0(S.length - sharing)} unit="suppliers to switch sharing on" />
      </Kpis>
      {sharing > 0 && S.every((s) => !s.shared || s.status === 'no_data') && staleYear(o.fy)}
      <div className="card">
        <div className="row"><h2 className="grow">Suppliers</h2><span className="muted small">Sorted by share of your purchases</span></div>
        {!S.length ? <div className="empty">No suppliers yet. Invite the ones that make up 2% or more of your purchases first; BRSR Core asks for them.</div> : (
          <div className="sme-scroll" style={{ marginTop: 8 }}>
            <table className="sme-tbl"><thead><tr><th>Supplier</th><th className="r">Share of purchases</th><th>Status</th><th className="r">Scope 1 + 2</th><th className="r">Scope 3</th><th className="r">ESG level</th><th className="r">SRMM</th><th className="r">CBAM</th><th /></tr></thead>
              <tbody>{S.map((s) => (
                <tr key={s.linkId}>
                  <td className="net-name"><b>{s.name}</b><small>{[s.industry, s.state].filter(Boolean).join(' · ')}</small></td>
                  <td className="r"><EditNum label={`Share of purchases for ${s.name}`} value={s.purchaseSharePct} unit="%" max={100} canEdit={edit}
                    onSave={async (v) => { try { await smeNetApi.updateLink(s.linkId, { purchaseSharePct: v }); toast('Purchase share saved'); reload(); } catch (e) { toast(errText(e)); throw e; } }} /></td>
                  <td>{status(s)}</td>
                  <td className="r">{s.shared && s.scope12 != null ? `${f1(s.scope12)} t` : dash}</td>
                  <td className="r">{s.shared && s.scope3 != null && n(s.scope3) > 0 ? `${f1(s.scope3)} t` : dash}</td>
                  <td className="r">{s.shared && s.esgLevel != null ? (s.esgLevel ? `${s.esgLevel} · ${LEVELS[s.esgLevel]}` : 'Not yet rated') : dash}</td>
                  <td className="r">{s.shared && s.srmmPct != null && n(s.srmmPct) > 0 ? `${f1(s.srmmPct)}%` : dash}</td>
                  <td className="r">{s.shared && s.cbamSee != null ? `${f2(s.cbamSee)} t/t` : dash}</td>
                  <td className="r">{!s.shared && edit && <button className="btn sm" disabled={busy === s.linkId} onClick={() => remind(s)}>{busy === s.linkId ? 'Sending…' : 'Remind'}</button>}</td>
                </tr>))}</tbody></table>
          </div>)}
        <p className="muted small" style={{ margin: '12px 0 0' }}>Coverage is the share of your linked purchase value whose supplier has reported. CBAM is embedded emissions per tonne of product, for EU exports. A reminder can be sent once every 3 days.</p>
      </div>
    </>);
}

/* ------------------------------------------------------------------ cluster --- */
function Cluster({ o, eyebrow, fyPick, reload }: ViewProps) {
  const inv = useInvite('cluster');
  const head = <NetHead icon="grid" eyebrow={eyebrow} title="Cluster overview" lede="Anonymised figures across your member companies: how intense their emissions are, where they come from and the savings already found. No single company can be picked out.">{fyPick}{inv.button}</NetHead>;
  const min = n(o.minGroup) || 5, sharing = n(o.sharing), members = n(o.members);
  if (o.hidden) return (
    <>
      {head}
      {inv.open && <Invite kind="cluster" onDone={reload} />}
      <Kpis><Kpi label="Members linked" value={f0(members)} unit="companies" /><Kpi label="Sharing for benchmarks" value={f0(sharing)} unit={`for ${o.fy}`} /><Kpi label="Needed to show figures" value={f0(min)} unit="companies at least" /></Kpis>
      <div className="card net-lock">
        <div className="ic"><Icon name="lock" /></div>
        <div><h2>Figures appear once {min} members share</h2>
          <p>To protect each company, cluster figures are shown only when at least {min} members have switched sharing on and agreed to anonymous benchmarking for {o.fy}. With fewer, one company’s numbers could be worked out from the totals.</p>
          <p>{sharing} of {members} {members === 1 ? 'member is' : 'members are'} sharing so far. {sharing < min ? `${min - sharing} more needed.` : ''} Invite more members, or ask existing ones to switch sharing on in their Share &amp; validate page. If this is the current year, the previous year may already have enough.</p>
          <div className="net-meter" style={{ ['--n' as string]: min }}>{Array.from({ length: min }, (_, i) => <i key={i} className={i < sharing ? 'on' : ''} />)}</div>
        </div>
      </div>
    </>);
  const hist = (o.histogram ?? []) as { label: string; count: number }[];
  const hmax = Math.max(...hist.map((h) => h.count), 1);
  const med = n(o.medianIntensity);
  const edges = [0, 5, 10, 15, 20, 30, 45, 60, Infinity];
  const midBin = edges.findIndex((e, i) => med >= e && med < edges[i + 1]!);
  const hot = (o.hotspots ?? []) as { key: string; share: number }[];
  return (
    <>
      {head}
      {inv.open && <Invite kind="cluster" onDone={reload} />}
      <Kpis>
        <Kpi label="Members sharing" value={`${f0(sharing)} of ${f0(members)}`} unit={`companies · ${o.fy}`} />
        <Kpi label="Median intensity" value={f1(med)} unit="tCO₂e per ₹ crore turnover" />
        <Kpi label="Readiness Level 2+" value={`${f0(o.level2plusPct)}%`} unit="of sharing members" />
        <Kpi label="Savings found" value={rupees(o.savingsFoundInr)} unit="per year, across members" good />
      </Kpis>
      <div className="sme-grid2">
        <div className="card"><h2>Emission intensity spread</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Companies by tCO₂e per ₹ crore of turnover. The dark bar holds the median.</p>
          <div className="net-hist" role="img" aria-label={`Histogram of intensity, median ${f1(med)}`}>
            {hist.map((h, i) => <div key={h.label}><span>{h.count || ''}</span><i className={i === midBin ? 'mid' : ''} style={{ height: `${(h.count / hmax) * 82}%` }} /></div>)}
          </div>
          <div className="net-hist-l">{hist.map((h) => <span key={h.label}>{h.label}</span>)}</div>
          <div className="net-spread">
            <div><small>Lower quarter</small><b>{f1(o.p25)}</b></div><div><small>Median</small><b>{f1(med)}</b></div><div><small>Upper quarter</small><b>{f1(o.p75)}</b></div>
          </div>
        </div>
        <div className="card"><h2>Hotspots across members</h2>
          <p className="muted small" style={{ margin: '4px 0 12px' }}>Share of the members’ combined Scope 1 + 2 emissions.</p>
          {hot.length ? <Bars rows={hot.map((h) => ({ label: srcLabel(h.key), value: h.share * 100 }))} fmt={(v) => `${f0(v)}%`} /> : <p className="muted">No source split yet.</p>}
        </div>
      </div>
      <div className="card"><h2>Joint project leads</h2>
        <table className="sme-tbl" style={{ marginTop: 8 }}><tbody>
          <tr><td>Rooftop solar that fits on members’ roofs<br /><span className="muted small">A group purchase usually lowers the price per kW</span></td><td className="r">{f0(o.solarKw)} kWp</td></tr>
          <tr><td>Members flagged for low power factor<br /><span className="muted small">A joint capacitor drive removes the penalty on their bills</span></td><td className="r">{f0(o.pfFlagged)} of {f0(sharing)}</td></tr>
          <tr><td>Savings found in bills, solar and scrap</td><td className="r">{rupees(o.savingsFoundInr)}/yr</td></tr>
        </tbody></table>
      </div>
    </>);
}

/* ------------------------------------------------------------------ bank --- */
function Bank({ o, eyebrow, fyPick, reload }: ViewProps) {
  const { can, toast } = useApp();
  const inv = useInvite('bank');
  const edit = can('super_admin', 'admin', 'manager');
  const B = (o.borrowers ?? []) as any[];
  const sum = o.summary as { financed: number; loansCovered: number; loansTotal: number; pcafWeighted: number | null; greenLeads: number };
  const upd = async (id: string, b: { loanCr?: number | null; evCr?: number | null }) => {
    try { await smeNetApi.updateLink(id, b); toast('Saved'); reload(); } catch (e) { toast(errText(e)); throw e; }
  };
  const status = (b: any) => b.status === 'reported' ? (b.pcaf === 1 ? <Pill kind="good">Reported · CA-validated</Pill> : <Pill kind="good">Reported</Pill>)
    : b.status === 'no_data' ? <Pill kind="watch">Sharing · no {o.fy} data</Pill> : <Pill kind="soon">Awaiting consent</Pill>;
  const dash = <span className="muted">—</span>;
  const shared = B.filter((b) => b.status !== 'awaiting_consent').length;
  return (
    <>
      <NetHead icon="chart" eyebrow={eyebrow} title="Financed emissions" lede="Your SME borrowers’ emissions attributed to your loans, on the PCAF method. Data quality improves as borrowers report through EKOTRACE SME and get their figures validated by a CA.">{fyPick}{inv.button}</NetHead>
      {inv.open && <Invite kind="bank" onDone={reload} />}
      <Kpis>
        <Kpi label="Financed emissions" value={f1(sum.financed)} unit={`tCO₂e · ${o.fy}`} />
        <Kpi label="Loans covered" value={`₹${f2(sum.loansCovered)} Cr`} unit={`of ₹${f2(sum.loansTotal)} Cr linked (${f0(sum.loansTotal ? (sum.loansCovered / sum.loansTotal) * 100 : 0)}%)`} />
        <Kpi label="Data quality" value={sum.pcafWeighted == null ? '—' : f1(sum.pcafWeighted)} unit="PCAF score, loan-weighted · 1 is best" />
        <Kpi label="Green loan leads" value={f0(sum.greenLeads)} unit="borrowers with rooftop solar potential" good={sum.greenLeads > 0} />
      </Kpis>
      {shared > 0 && B.every((b) => b.status !== 'reported') && staleYear(o.fy)}
      <div className="card">
        <div className="row"><h2 className="grow">Borrowers</h2><span className="muted small">Sorted by loan size</span></div>
        {!B.length ? <div className="empty">No borrowers linked yet. Invite your SME borrowers by the owner’s e-mail.</div> : (
          <div className="sme-scroll" style={{ marginTop: 8 }}>
            <table className="sme-tbl"><thead><tr><th>Borrower</th><th className="r">Loan</th><th className="r">Equity + debt</th><th className="r">Attribution</th><th className="r">Scope 1 + 2</th><th className="r">Financed</th><th className="r">PCAF</th><th>Status</th></tr></thead>
              <tbody>{B.map((b) => (
                <tr key={b.linkId}>
                  <td className="net-name"><b>{b.name}</b><small>{b.industry || ' '}</small></td>
                  <td className="r"><EditNum label={`Loan to ${b.name}, ₹ crore`} value={b.loanCr} unit="₹ Cr" canEdit={edit} onSave={(v) => upd(b.linkId, { loanCr: v })} /></td>
                  <td className="r"><EditNum label={`Equity plus debt of ${b.name}, ₹ crore`} value={b.evCr} unit="₹ Cr" canEdit={edit} onSave={(v) => upd(b.linkId, { evCr: v })} /></td>
                  <td className="r">{b.attribution != null ? `${f1(b.attribution * 100)}%` : dash}</td>
                  <td className="r">{b.scope12 != null ? `${f1(b.scope12)} t` : dash}</td>
                  <td className="r"><b>{b.financed != null ? `${f1(b.financed)} t` : dash}</b></td>
                  <td className="r">{b.pcaf ?? dash}</td>
                  <td>{status(b)}{b.solarReady && <div style={{ marginTop: 4 }}><span className="chip info">Solar lead</span></div>}</td>
                </tr>))}
                {sum.financed > 0 && <tr className="tot"><td>Total reported</td><td className="r">₹{f2(sum.loansCovered)} Cr</td><td /><td /><td /><td className="r">{f1(sum.financed)} t</td><td className="r">{sum.pcafWeighted == null ? '' : f1(sum.pcafWeighted)}</td><td /></tr>}
              </tbody></table>
          </div>)}
      </div>
      <div className="card"><h2>How this is worked out</h2>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13.5 }}>Attribution = loan ÷ the borrower’s equity + debt (capped at 100%). Financed emissions = attribution × the borrower’s Scope 1 + 2. PCAF data quality: 1 = reported and verified (CA-validated), 2 = reported, not verified. Borrowers who have not switched sharing on are left out of the totals, not estimated.</p>
      </div>
    </>);
}
