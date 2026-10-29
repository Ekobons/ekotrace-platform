/** Schemes: government and bank support matched to the company — what each gives, why it fits (or what is missing), and how to apply. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link } from 'react-router-dom';
import './save.css';
import { useSme } from './store';
import { Kpi, Kpis, Pill, SmeHead } from './ui';
import { n } from '../../lib/sme';

type Scheme = { id: string; title: string; detail: string; eligible: boolean; label: string; note: string; link: string | null };

/** How to apply, per scheme. Kept short and general: terms change, the official portal is the reference. */
const HOW: Record<string, { steps: string[]; go?: [string, string] }> = {
  adeetie: { steps: ['Check your industrial cluster is on the BEE ADEETIE list.', 'Get an investment-grade energy audit (BEE empanelled auditor).', 'Apply on the BEE portal with the audit and a loan sanction from a participating bank.'], go: ['bills', 'See your bill savings'] },
  zed: { steps: ['Register on the MSME ZED portal with your Udyam number.', 'Take the ZED pledge and apply for Bronze.', 'Complete the online self-assessment; the certificate follows a desk review.'], go: ['certs', 'Track it in Certifications'] },
  lean: { steps: ['Register on the MSME LEAN portal with your Udyam number.', 'Take the LEAN pledge and start at Basic level.', 'Choose a consultant from the portal for Intermediate and Advanced levels.'] },
  sidbi: { steps: ['Get quotes for the equipment or rooftop solar.', 'Approach a SIDBI branch or apply online with the quotes and your last two years’ financials.', 'Use the green-loan pack to show the savings and emissions cut.'], go: ['loan', 'Build the loan pack'] },
  state_solar: { steps: ['Read your DISCOM’s net-metering rules and connected-load limit.', 'Apply for net metering on the DISCOM portal before installing.', 'Ask the state nodal agency about any MSME capital support.'], go: ['solar', 'Size your rooftop system'] },
  ccts_offset: { steps: ['Add your solar or efficiency project to the EKOTRACE pool.', 'EKOTRACE bundles projects and handles one shared registration.', 'Revenue from credits is shared yearly.'], go: ['credits', 'Open Carbon credits'] },
};

export function SmeSchemes() {
  const { d } = useSme();
  if (!d) return <div className="card empty">Loading…</div>;
  const list = (d.results.schemes ?? []) as Scheme[];
  const p = (d.data.profile ?? {}) as any, cls = d.results.msmeClass as string;
  const yes = list.filter((x) => x.eligible), maybe = list.filter((x) => !x.eligible);
  const gaps: string[] = [];
  if (!p.udyam) gaps.push('Udyam registration is not marked in your profile; most MSME schemes need it.');
  if (cls === 'Large') gaps.push('Your turnover puts you above the MSME limit, so MSME-only schemes do not apply.');
  if (!n(p.turnover)) gaps.push('Turnover is not entered, so your MSME class is a guess.');
  const why = (x: Scheme) => {
    const r: string[] = [];
    if (!p.udyam || cls === 'Large') r.push(!p.udyam ? 'needs Udyam registration' : 'for MSMEs only');
    if (d.company.sector === 'svc' && /adeetie|lean/.test(x.id)) r.push('for manufacturers');
    return r.length ? `Not matched yet: ${r.join(', ')}.` : 'Check the conditions on the portal.';
  };

  const card = (x: Scheme) => {
    const how = HOW[x.id];
    return (
      <div className="sv-item" key={x.id}>
        <h3>{x.title} <Pill kind={x.eligible ? 'good' : 'watch'}>{x.label}</Pill></h3>
        <div />
        <div className="sv-body sv-scheme">
          <div className="sv-col">
            <p><span className="lbl">What it gives</span><br />{x.detail}</p>
            {x.eligible ? (x.note && <div className="sv-do"><b>For you:</b> {x.note}</div>) : <div className="note warn">{why(x)}{x.note ? ` ${x.note}` : ''}</div>}
          </div>
          {how && <div><span className="lbl">How to apply</span><ol className="sv-steps" style={{ marginTop: 8 }}>{how.steps.map((s) => <li key={s}><span>{s}</span></li>)}</ol></div>}
          <div className="row sv-span">
            {x.link && <a className="btn sm" href={x.link} target="_blank" rel="noopener noreferrer">Official portal<span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}> for {x.title} (opens in a new tab)</span></a>}
            {how?.go && <Link className="btn sm ghost" to={`/sme/${how.go[0]}`}>{how.go[1]}</Link>}
          </div>
        </div>
      </div>);
  };

  return (
    <>
      <SmeHead lede="Government and bank support matched to your profile and figures. Terms change, so confirm on the official portal before you apply." />
      <Kpis>
        <Kpi label="Likely for you" value={yes.length} unit={`of ${list.length} schemes`} good={yes.length > 0} />
        <Kpi label="Check first" value={maybe.length} unit="need something more" />
        <Kpi label="MSME class" value={cls || '—'} unit={p.udyam ? 'Udyam registered' : 'Udyam not marked'} />
      </Kpis>
      {gaps.length > 0 && <div className="sme-callout warn">{gaps.join(' ')} <Link to="/sme/profile">Update your profile</Link> to match more schemes.</div>}
      {!list.length && <div className="card empty">No schemes to show yet. Complete your <Link to="/sme/profile">profile</Link> first.</div>}
      {yes.length > 0 && <div className="card"><div className="sv-h2row"><h2>Likely for you</h2><span className="muted small">{yes.length} schemes</span></div>{yes.map(card)}</div>}
      {maybe.length > 0 && <div className="card"><div className="sv-h2row"><h2>Check first</h2><span className="muted small">You may qualify once the gap is closed</span></div>{maybe.map(card)}</div>}
    </>);
}
