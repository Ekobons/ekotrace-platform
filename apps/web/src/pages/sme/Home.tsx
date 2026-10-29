/** SME overview: the company, headline figures, readiness, what is due, money found, what needs attention, every module. */
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { Pill, Req, Sample } from './ui';
import { SME_GROUPS, SME_PAGES, relevant } from './nav';
import type { CSSProperties } from 'react';
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
      <section className="sme-hero">
        <div style={{ minWidth: 0 }}>
          <span className="lbl">{d.fy}{d.company.isExample && <Sample />}</span>
          <h1>{d.company.name}</h1>
          <p>{[d.company.industry, d.company.state, `${r.msmeClass} enterprise`].filter(Boolean).join(' · ')}</p>
          <div className="sme-hstats">
            <div><span>Scope 1 + 2</span><b>{f1(r.emissions.total)}</b><small>tCO₂e</small></div>
            <div><span>Intensity</span><b>{f1(r.emissions.intensity)}</b><small>t per ₹ crore</small></div>
            <div><span>Savings found</span><b>{lakh(r.money.savingsFound)}</b><small>per year</small></div>
          </div>
        </div>
        <div className="sme-ring">
          <svg viewBox="0 0 130 130" role="img" aria-label={`ESG readiness ${pct}%`}>
            <circle cx="65" cy="65" r="52" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="11" />
            <circle cx="65" cy="65" r="52" fill="none" stroke="#C6F06B" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} transform="rotate(-90 65 65)" />
            <text x="65" y="64" textAnchor="middle" fill="currentColor" style={{ font: '700 28px var(--f-ui)' }}>{pct}%</text>
            <text x="65" y="84" textAnchor="middle" fill="currentColor" opacity=".65" style={{ font: '600 9.5px var(--f-ui)', letterSpacing: '.1em' }}>READINESS</text>
          </svg>
          <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
            <span className="chip2">{r.esg.level ? `Level ${r.esg.level} · ${r.esg.levelName}` : 'Not yet rated'}</span>
            <span className="chip2">SRMM {f1(r.srmm.pct * 100)}%</span>
          </div>
        </div>
      </section>

      {stepsDone < steps.length && <div className="card sme-steps">
        <div className="row"><div className="grow"><h2>{empty ? 'Get started in five steps' : 'Your next steps'}</h2><p className="muted">{stepsDone} of {steps.length} done · each takes a few minutes</p></div>
          <div className="sme-steps-bar" aria-hidden="true"><b style={{ width: `${(stepsDone / steps.length) * 100}%` }} /></div></div>
        <ol>{steps.map((x, i) => <li key={x.to} className={x.done ? 'done' : i === firstOpen ? 'next' : ''}>
          <span className="n">{x.done ? '✓' : i + 1}</span><div className="grow"><b>{x.title}</b><small>{x.why}</small></div>
          {!x.done && <Link className={`btn${i === firstOpen ? ' p' : ''}`} to={x.to}>{i === firstOpen ? 'Start' : 'Open'}</Link>}</li>)}</ol>
      </div>}

      <div className="sme-hubs">
        {SME_GROUPS.slice(1).map((g) => {
          const pages = g.pages.filter((k) => relevant(k, d.data, r));
          const fig = HUB_FIG[g.key]?.(r);
          return <div key={g.key} className="sme-hub" style={{ '--gc': g.color, '--gs': g.soft } as CSSProperties}>
            <Link to={`/sme/${pages[0] ?? g.pages[0]}`} className="sme-hub-h"><span className="sme-hub-i"><Icon name={g.icon} /></span><span className="grow"><b>{g.title}</b><small>{g.sub}</small></span>{fig && <span className="sme-hub-f"><b>{fig[0]}</b><small>{fig[1]}</small></span>}</Link>
            <div className="sme-hub-l">{pages.map((k) => <Link key={k} to={`/sme/${k}`}><Icon name={SME_PAGES[k]!.icon} />{SME_PAGES[k]!.title}</Link>)}</div>
          </div>;
        })}
      </div>

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
