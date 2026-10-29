/** SME overview: the company, headline figures, readiness, what is due, money found, what needs attention, every module. */
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { Pill, Req, Sample } from './ui';
import { SME_GROUPS, SME_PAGES } from './nav';
import { dmy, f0, f1, lakh } from '../../lib/sme';

export function SmeHome() {
  const { d, error } = useSme();
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading your data…</div>;
  const r = d.results, C = 2 * Math.PI * 52, pct = Math.round(r.esg.overall);
  const due = (r.calendar as { id: string; title: string; date: string; status: string; days: number }[]).filter((x) => x.status !== 'done').slice(0, 4);
  const attention = (r.requirements as { key: string; status: string; label: string; title: string; detail: string; action: string; go: string | null }[]).filter((x) => x.status === 'apply' || x.status === 'likely').slice(0, 6);
  const w = r.emissions.withS3 || 1;
  const top = (r.emissions.rows as { key: string; label: string; tco2e: number }[]).filter((x) => x.tco2e > 0).sort((a, b) => b.tco2e - a.tco2e).slice(0, 5);
  const empty = Object.keys(d.meta).length === 0;
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

      {empty && <div className="sme-callout">Start with <Link to="/sme/profile">Profile</Link> (six answers decide what applies to you), then add your yearly bills in <Link to="/sme/emissions">Emissions</Link>.</div>}

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

      <div className="card"><div className="row"><h2 className="grow">Needs attention</h2><span className="muted">{attention.length} items</span></div>
        {attention.map((x) => <Req key={x.key} title={x.title} pill={x.label} kind={x.status} action={x.action ? <><b>Next:</b> {x.action} {x.go && <Link to={`/sme/${x.go}`}>Open</Link>}</> : null}>{x.detail}</Req>)}
        {!attention.length && <p className="muted">Nothing urgent.</p>}
      </div>

      <div className="card"><h2>All modules</h2>
        {SME_GROUPS.slice(1).map((g) => (
          <div key={g.key} style={{ marginTop: 12 }}><span className="lbl">{g.title}</span>
            <div className="sme-mods" style={{ marginTop: 8 }}>{g.pages.map((k) => <Link key={k} className="sme-mod" to={`/sme/${k}`}><span className="mi"><Icon name={SME_PAGES[k]!.icon} /></span><span><b>{SME_PAGES[k]!.title}</b><small>{SME_PAGES[k]!.sub}</small></span></Link>)}</div>
          </div>))}
      </div>
    </>);
}
