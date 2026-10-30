/** SME overview: the company, headline figures, readiness, what is due, money found, what needs attention, every module. */
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { Pill, Req, Sample } from './ui';
import { SME_GROUPS, SME_PAGES, relevant } from './nav';
import { useState, type CSSProperties } from 'react';
import { dmy, f0, f1, lakh } from '../../lib/sme';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The one figure shown on each section's card. */
const HUB_FIG: Record<string, (r: any) => [string, string] | null> = {
  carbon: (r) => (r.emissions.total > 0 ? [f1(r.emissions.total), 'tCO₂e'] : null),
  save: (r) => (r.money.savingsFound > 0 ? [lakh(r.money.savingsFound), 'a year'] : null),
  comply: (r) => { const n = (r.calendar as { status: string }[]).filter((x) => x.status === 'overdue' || x.status === 'soon').length; return [String(n), n === 1 ? 'due soon' : 'due soon']; },
  export: (r) => (r.cbam.applies ? [lakh(r.money.cbamAvoidedInr), 'saved for buyer'] : null),
  share: (r) => (r.srmm.pct > 0 ? [`${f1(r.srmm.pct * 100)}%`, 'SRMM'] : null),
};

export function SmeHome() {
  const { d, error } = useSme();
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading your data…</div>;
  const r = d.results, C = 2 * Math.PI * 52, pct = Math.round(r.esg.overall);
  const due = (r.calendar as { id: string; title: string; date: string; status: string; days: number }[]).filter((x) => x.status !== 'done').slice(0, 4);
  const attention = (r.requirements as { key: string; status: string; label: string; title: string; detail: string; action: string; go: string | null }[]).filter((x) => x.status === 'apply' || x.status === 'likely').slice(0, 4);
  const w = r.emissions.withS3 || 1;
  const top = (r.emissions.rows as { key: string; label: string; tco2e: number }[]).filter((x) => x.tco2e > 0).sort((a, b) => b.tco2e - a.tco2e).slice(0, 5);
  const empty = Object.keys(d.meta).length === 0;
  const prof = d.data.profile ?? {};
  const steps = [
    { title: 'Tell us about your company', why: 'Six answers decide which rules apply to you', to: '/sme/profile', done: !!(prof.employees && prof.turnover) },
    { title: 'Add your yearly bills', why: 'Electricity, diesel and LPG give your carbon footprint', to: '/sme/emissions', done: r.emissions.total > 0 },
    { title: 'Answer the ESG questions', why: 'Water, waste, people and policies give your readiness score', to: '/sme/esg', done: !!d.meta.esg },
    { title: 'Check your power bill', why: 'Most factories find penalties they can stop paying', to: '/sme/bills', done: !!d.meta.bills },
    { title: 'Score your SRMM level', why: 'The ICAI maturity level buyers and banks ask for', to: '/sme/srmm', done: !!r.srmm.eligible },
  ];
  const stepsDone = steps.filter((x) => x.done).length, firstOpen = steps.findIndex((x) => !x.done);
  return (
    <>
      <section className="sme-hero2">
        <div className="sme-hero2-co">
          <span className="lbl">{d.fy}{d.company.isExample && <Sample />}</span>
          <h1>{d.company.name}</h1>
          <p>{[d.company.industry, d.company.state, `${r.msmeClass} enterprise`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="sme-hero2-st">
          <div><span>Scope 1 + 2</span><b>{f1(r.emissions.total)} <small>tCO₂e</small></b></div>
          <div><span>Intensity</span><b>{f1(r.emissions.intensity)} <small>t / ₹ cr</small></b></div>
          <div><span>Savings found</span><b>{lakh(r.money.savingsFound)} <small>/ yr</small></b></div>
          <div className="sme-rd"><svg viewBox="0 0 130 130" role="img" aria-label={`ESG readiness ${pct}%`}>
            <circle cx="65" cy="65" r="52" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="14" />
            <circle cx="65" cy="65" r="52" fill="none" stroke="#C6F06B" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 65 65)" />
            <text x="65" y="76" textAnchor="middle" fill="currentColor" style={{ font: '700 34px var(--f-ui)' }}>{pct}%</text></svg>
            <span><span>ESG readiness</span><b>{r.esg.level ? `Level ${r.esg.level} · ${r.esg.levelName}` : 'Not yet rated'}</b></span></div>
        </div>
      </section>

      {stepsDone < steps.length && <div className="card sme-steps">
        <div className="row"><div className="grow"><h2>{empty ? 'Get started in five steps' : 'Your next steps'}</h2><p className="muted">{stepsDone} of {steps.length} done · each takes a few minutes</p></div>
          <div className="sme-steps-bar" aria-hidden="true"><b style={{ width: `${(stepsDone / steps.length) * 100}%` }} /></div></div>
        <ol>{steps.map((x, i) => <li key={x.to} className={x.done ? 'done' : i === firstOpen ? 'next' : ''}>
          <span className="n">{x.done ? '✓' : i + 1}</span><div className="grow"><b>{x.title}</b><small>{x.why}</small></div>
          {!x.done && <Link className={`btn${i === firstOpen ? ' p' : ''}`} to={x.to}>{i === firstOpen ? 'Start' : 'Open'}</Link>}</li>)}</ol>
      </div>}

      <SectionPanel />

      <div className="sme-grid2">
        <div className="card"><div className="row"><h2 className="grow">Due next</h2><Link to="/sme/calendar">Full calendar</Link></div>
          <table className="sme-tbl" style={{ marginTop: 8 }}><tbody>
            {due.map((x) => <tr key={x.id}><td>{x.title}<br /><span className="muted">{dmy(x.date)}</span></td><td className="r"><Pill kind={x.status}>{x.days < 0 ? `${-x.days} days overdue` : `in ${x.days} days`}</Pill></td></tr>)}
            {!due.length && <tr><td className="muted">Nothing due. Add your licence dates in Calendar.</td></tr>}
          </tbody></table></div>
        <div className="card"><div className="row"><h2 className="grow">Money on the table</h2><Link to="/sme/bills">Details</Link></div>
          <table className="sme-tbl" style={{ marginTop: 8 }}><tbody>
            <tr><td>Power bill penalties & time-of-day</td><td className="r">{lakh(r.money.bills)}/yr</td></tr>
            <tr><td>Rooftop solar ({f0(r.solar.kw)} kWp)</td><td className="r">{lakh(r.money.solar)}/yr</td></tr>
            <tr><td>Scrap listed for sale</td><td className="r">{lakh(r.money.scrap)}</td></tr>
            <tr><td>Carbon credits (pooled)</td><td className="r">{lakh(r.money.credits)}/yr</td></tr>
            {r.cbam.applies && <tr><td>CBAM cost avoided for your EU buyer</td><td className="r">{lakh(r.money.cbamAvoidedInr)}/yr</td></tr>}
          </tbody></table></div>
      </div>

      <div className="sme-grid2">
        <div className="card"><h2>Where emissions come from</h2>
          <div className="sme-bar" style={{ marginTop: 12 }}>
            <div style={{ width: `${(r.emissions.s1 / w) * 100}%`, background: 'var(--s1)' }} /><div style={{ width: `${(r.emissions.s2 / w) * 100}%`, background: 'var(--s2)' }} /><div style={{ width: `${(r.emissions.s3 / w) * 100}%`, background: 'var(--s3)' }} />
          </div>
          <div className="sme-legend"><span><i style={{ background: 'var(--s1)' }} />Scope 1 <b className="num">{f1(r.emissions.s1)} t</b></span><span><i style={{ background: 'var(--s2)' }} />Scope 2 <b className="num">{f1(r.emissions.s2)} t</b></span><span><i style={{ background: 'var(--s3)' }} />Scope 3 <b className="num">{f1(r.emissions.s3)} t</b></span></div>
          <table className="sme-tbl" style={{ marginTop: 12 }}><tbody>
            {top.map((x) => <tr key={x.key}><td>{x.label}</td><td className="r">{f1(x.tco2e)} t</td></tr>)}
            {!top.length && <tr><td className="muted">No data yet. <Link to="/sme/emissions">Add your bills</Link>.</td></tr>}
          </tbody></table></div>
        <div className="card"><h2>Readiness level</h2>
          <div className="sme-ladder">{[1, 2, 3, 4].map((i) => <div key={i} className={r.esg.level >= i ? 'on' : ''} style={{ height: `${25 + i * 18}%` }}>{i}</div>)}</div>
          <div className="sme-ladder-l"><span>Formative<br />30–50</span><span>Developing<br />&gt;50–65</span><span>Emerging<br />&gt;65–80</span><span>Established<br />&gt;80</span></div>
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {([['Environment', r.esg.E], ['Social', r.esg.S], ['Governance', r.esg.G]] as [string, number][]).map(([l, v]) => (
              <div key={l} className="sme-secbar"><span>{l}</span><div className="sme-track"><b style={{ width: `${v}%` }} /><em /></div><span className="num">{f0(v)}%</span></div>))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Each section needs at least 30% to be rated. The marker shows that floor.</p>
          <Req title={`SRMM ${r.srmm.versionLabel}`} pill={`${f1(r.srmm.pct * 100)}%`} kind={r.srmm.eligible ? 'good' : 'soon'} action={<Link to="/sme/srmm">Open SRMM</Link>}>
            {r.srmm.label}{r.srmm.open ? ` · ${r.srmm.open} indicators still to score` : ''}</Req>
        </div>
      </div>

      <div className="card"><div className="row"><h2 className="grow">Needs attention</h2><Link to="/sme/applies">Everything that applies</Link></div>
        {attention.map((x) => <Req key={x.key} title={x.title} pill={x.label} kind={x.status} action={x.action ? <><b>Next:</b> {x.action} {x.go && <Link to={`/sme/${x.go}`}>Open</Link>}</> : null}>{x.detail}</Req>)}
        {!attention.length && <p className="muted">Nothing urgent.</p>}
      </div>

    </>);
}

/** One line about where each page stands, from the results. */
const PAGE_LINE: Record<string, (r: any, d: any) => string | null> = {
  profile: (_r, d) => (d.data.profile?.employees ? 'Filled in' : 'Six quick answers'),
  applies: (r) => { const n = (r.requirements as { status: string }[]).filter((x) => x.status === 'apply').length; return `${n} rule${n === 1 ? '' : 's'} apply now`; },
  emissions: (r) => (r.emissions.total > 0 ? `${f1(r.emissions.total)} tCO₂e (Scope 1 + 2)` : 'Add your yearly bills'),
  esg: (r) => `${Math.round(r.esg.overall)}% · ${r.esg.level ? `Level ${r.esg.level}` : 'not yet rated'}`,
  srmm: (r) => `${f1(r.srmm.pct * 100)}% · ${r.srmm.open} to score`,
  plan: () => 'Actions, savings and a target',
  footprint: (_r, d) => { const n = (d.data.footprint?.products ?? []).length; return n ? `${n} product${n === 1 ? '' : 's'}` : 'Per product'; },
  certs: (_r, d) => { const n = (d.data.certs ?? []).filter((c: any) => c.level && c.level !== 'none').length; return `${n} held`; },
  bills: (r) => (r.money.bills > 0 ? `${lakh(r.money.bills)} a year to save` : 'Check one month’s bill'),
  solar: (r) => (r.solar.kw > 0 ? `${f0(r.solar.kw)} kWp · ${lakh(r.money.solar)} a year` : 'Add your roof area'),
  schemes: (r) => { const n = (r.schemes as { eligible: boolean }[]).filter((x) => x.eligible).length; return `${n} likely for you`; },
  scrap: (r) => (r.money.scrap > 0 ? `${lakh(r.money.scrap)} listed` : 'Sell waste'),
  credits: (r) => (r.money.credits > 0 ? `${lakh(r.money.credits)} a year` : 'Pooled projects'),
  calendar: (r) => { const n = (r.calendar as { status: string }[]).filter((x) => x.status === 'overdue' || x.status === 'soon').length; return n ? `${n} due soon` : 'Nothing due soon'; },
  epr: () => 'Plastic, e-waste, batteries',
  dpdp: (r) => `${Math.round(r.dpdpPct)}% of checklist done`,
  people: (r) => `LTIFR ${f1(r.safety.ltifr)} · POSH`,
  csr: (r) => (r.csr.applies ? 'Applies to you' : 'Not required'),
  cbam: (r) => (r.cbam.applies ? `${f1(r.cbam.see)} tCO₂e per tonne` : 'EU and UK'),
  eudr: () => 'Plot locations and documents',
  scan: () => 'PDF bill to figures',
  questionnaire: () => 'Answer buyer questions',
  whatsapp: () => 'Message for your team',
  share: () => 'Consent and CA validation',
  report: () => 'One-page PDF for buyers',
  loan: () => 'Bank-ready pack',
};

/** The sections as tabs; the open tab shows its pages with where each stands. */
function SectionPanel() {
  const { d } = useSme();
  const [tab, setTab] = useState<string>(() => { try { return localStorage.getItem('eko_sme_hometab') ?? 'carbon'; } catch { return 'carbon'; } });
  if (!d) return null;
  const r = d.results;
  const groups = SME_GROUPS.slice(1);
  const g = groups.find((x) => x.key === tab) ?? groups[0]!;
  const pick = (k: string) => { setTab(k); try { localStorage.setItem('eko_sme_hometab', k); } catch { /* not kept */ } };
  const pages = g.pages.filter((k) => relevant(k, d.data, r));
  return (
    <section className="card sme-sp" style={{ '--gc': g.color, '--gs': g.soft } as CSSProperties}>
      <div className="sme-sp-tabs" role="tablist" aria-label="Sections">
        {groups.map((x) => <button key={x.key} type="button" role="tab" aria-selected={x.key === g.key} className={x.key === g.key ? 'on' : ''} style={{ '--tc': x.color, '--ts': x.soft } as CSSProperties} onClick={() => pick(x.key)}><Icon name={x.icon} />{x.title}</button>)}
      </div>
      <div className="sme-sp-body" role="tabpanel">
        {pages.map((k) => <Link key={k} to={`/sme/${k}`} className="sme-sp-item">
          <span className="i"><Icon name={SME_PAGES[k]!.icon} /></span>
          <span className="t"><b>{SME_PAGES[k]!.title}</b><small>{PAGE_LINE[k]?.(r, d) ?? SME_PAGES[k]!.sub}</small></span><span className="go" aria-hidden="true">›</span>
        </Link>)}
        {!pages.length && <p className="muted" style={{ margin: 0 }}>Not needed for you now: your Profile says you do not export to the EU or UK. <Link to="/sme/profile">Change</Link></p>}
      </div>
    </section>);
}
