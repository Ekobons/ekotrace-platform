/**
 * Green loan: a bank-ready pack from this year's results (emissions, intensity, savings, solar, ESG, SRMM)
 * with the loan details the company enters. Prints cleanly (browser print / save as PDF).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useSme } from './store';
import { Choice, Num, Pill, Req, Sample, SmeHead, Text } from './ui';
import { smeApi, crore, dmy, f0, f1, lakh, n, LEVELS, type SmeCaRequest } from '../../lib/sme';
import './share.css';

const PROJECTS: [string, string][] = [
  ['solar', 'Rooftop solar'],
  ['pf', 'Power factor correction (capacitors)'],
  ['bills', 'All power bill fixes'],
  ['other', 'Other energy-saving project'],
];
const OPEN = ['requested', 'assigned', 'in_review'];

export function SmeLoan() {
  const { d, fy, get, error } = useSme();
  const [ca, setCa] = useState<SmeCaRequest[]>([]);
  useEffect(() => { smeApi.caRequests().then((r) => setCa(r.items)).catch(() => { /* shown as "not asked" */ }); }, []);
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading…</div>;

  const r = d.results, p = d.data.profile ?? {}, em = r.emissions, b = r.bills, so = r.solar, es = r.esg, sr = r.srmm;
  const pr: string = get('loan.project') || 'solar';
  const amount = n(get('loan.amount')) * 1e7, tenor = n(get('loan.tenor')), bank: string = get('loan.bank') ?? '';
  const proj = pr === 'solar' ? { name: `Rooftop solar, ${f0(so.kw)} kWp`, cost: n(so.cost), save: n(so.save), co2: n(so.co2) as number | null, ready: n(so.kw) > 0, fix: <>Add your roof area in <Link to="/sme/solar">Solar</Link> and your grid units in <Link to="/sme/emissions">Emissions</Link>.</> }
    : pr === 'pf' ? { name: `Power factor correction, ${f0(b.kvarRounded)} kVAr capacitors`, cost: n(b.capex), save: n(b.pfSave), co2: null, ready: n(b.pfSave) > 0, fix: <>No power factor penalty found. Check your bill in the <Link to="/sme/bills">Bill analyser</Link>.</> }
    : pr === 'bills' ? { name: 'Power bill fixes: contract demand, power factor, time-of-day', cost: n(b.capex), save: n(b.total), co2: null, ready: n(b.total) > 0, fix: <>Add your power bill in the <Link to="/sme/bills">Bill analyser</Link>.</> }
    : { name: (get('loan.purpose') as string) || 'Energy-saving project', cost: n(get('loan.otherCost')) * 1e5, save: n(get('loan.otherSave')) * 1e5, co2: null, ready: n(get('loan.otherSave')) > 0, fix: <>Enter the project cost and yearly saving from your supplier’s quote.</> };
  const repay = tenor > 0 ? amount / tenor : 0;
  const payback = proj.save > 0 && proj.cost > 0 ? proj.cost / proj.save : 0;
  const mine = ca.filter((c) => c.fy === fy);
  const validated = mine.find((c) => c.status === 'validated'), caOpen = mine.find((c) => OPEN.includes(c.status));
  const caText = validated ? `Validated by CA: ${f1(validated.validated_pct)}%, Level ${validated.validated_level} · ${LEVELS[validated.validated_level ?? 0]}` : caOpen ? 'CA validation requested' : 'Self-assessed, not yet validated by a CA';
  const certs = ((d.data.certs ?? []) as any[]).filter((c) => c.level && c.level !== 'none').map((c) => `${c.name}${c.level !== 'held' ? ` (${c.level})` : ''}`);
  const schemes = ((r.schemes ?? []) as any[]).filter((s) => s.eligible);
  const hasData = Object.keys(d.meta).length > 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <SmeHead lede="A ready file for your bank: the project, what it saves, the emissions it cuts and your ESG profile, all from your own figures." />
      <div className="row sme-noprint"><button className="btn p" type="button" onClick={() => window.print()}><Icon name="download" />Print or save as PDF</button>
        <span className="muted small">Choose “Save as PDF” in the print window to e-mail it.</span></div>

      <div className="sme-grid2 sme-noprint">
        <div className="card">
          <h2>Your loan</h2>
          <div style={{ marginTop: 6 }}>
            <Choice path="loan.project" label="What the loan is for" options={PROJECTS} />
            {pr === 'other' && <>
              <Text path="loan.purpose" label="Describe the project" />
              <Num path="loan.otherCost" label="Project cost" unit="₹ lakh" hint="From the supplier’s quote" />
              <Num path="loan.otherSave" label="Yearly saving" unit="₹ lakh" hint="Your estimate, shown as yours in the pack" />
            </>}
            <Num path="loan.amount" label="Loan amount" unit="₹ cr" out={amount ? `= ${lakh(amount)}` : ''} />
            <Num path="loan.tenor" label="Repayment period" unit="years" />
            <Text path="loan.bank" label="Bank or lender" />
          </div>
        </div>
        <div className="card">
          <h2>What a bank will look at</h2>
          <div style={{ marginTop: 6 }}>
            <Req title={proj.save > 0 ? `The project saves ${lakh(proj.save)} a year` : 'Project saving not known yet'} pill={!proj.ready ? 'Missing data' : repay ? (proj.save >= repay ? 'Covers repayment' : 'Covers part') : 'No loan amount'} kind={!proj.ready ? 'soon' : repay ? (proj.save >= repay ? 'good' : 'soon') : 'watch'}>
              {!proj.ready ? proj.fix : repay ? `Principal repayment is about ${lakh(repay)} a year over ${f0(tenor)} years (before interest).` : 'Enter the loan amount and repayment period to compare.'}
            </Req>
            <Req title={`ESG readiness ${f0(es.overall)}%`} pill={es.level ? `Level ${es.level} · ${es.levelName}` : 'Not yet rated'} kind={es.level >= 2 ? 'good' : 'soon'}>{es.level >= 2 ? 'Meets the Developing level many green-loan desks ask for.' : <>Improve it in <Link to="/sme/esg">ESG</Link>; each section needs at least 30%.</>}</Req>
            <Req title={`SRMM ${f1(sr.pct * 100)}%`} pill={validated ? 'CA validated' : caOpen ? 'CA requested' : 'Self-assessed'} kind={validated ? 'good' : 'watch'}>{validated ? 'Banks treat CA-validated figures as the best data quality.' : <>Banks rate CA-validated figures higher. <Link to="/sme/share">Ask a CA to validate</Link>.</>}</Req>
            <Req title="Udyam registration" pill={p.udyam ? 'Registered' : 'Not recorded'} kind={p.udyam ? 'good' : 'soon'}>{p.udyam ? 'Needed for MSME green-finance schemes.' : <>Most MSME schemes need it. Update your <Link to="/sme/profile">Profile</Link>.</>}</Req>
          </div>
        </div>
      </div>
      {!hasData && <div className="sme-callout warn sme-noprint">Your figures are empty. Add your bills in <Link to="/sme/emissions">Emissions</Link> before you print the pack.</div>}
      <p className="lbl sme-noprint" style={{ margin: '6px 0 -4px' }}>The pack, as your bank will see it</p>

      <article className="sml-pack" aria-label="Green loan pack">
        <header>
          <div style={{ minWidth: 0 }}>
            <span className="lbl">Green loan application pack{d.company.isExample && <Sample />}</span>
            <h2>{d.company.name}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{[d.company.industry, d.company.state, `${r.msmeClass} enterprise`].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, textAlign: 'right' }}>{fy}<br />Prepared {dmy(today)}{bank && <><br />For {bank}</>}</div>
        </header>

        <section>
          <h3>Loan request</h3>
          <div className="sml-cols">
            <table className="sme-tbl"><tbody>
              <tr><td>Purpose</td><td className="r" style={{ whiteSpace: 'normal' }}>{proj.name}</td></tr>
              <tr><td>Amount requested</td><td className="r">{amount ? `${crore(amount)} (${lakh(amount)})` : '—'}</td></tr>
              <tr><td>Repayment period</td><td className="r">{tenor ? `${f0(tenor)} years` : '—'}</td></tr>
              <tr><td>Principal repayment a year</td><td className="r">{repay ? lakh(repay) : '—'}</td></tr>
            </tbody></table>
            <table className="sme-tbl"><tbody>
              <tr><td>Project cost</td><td className="r">{proj.cost ? lakh(proj.cost) : '—'}</td></tr>
              <tr><td>Yearly saving</td><td className="r">{proj.save ? lakh(proj.save) : '—'}</td></tr>
              <tr><td>Simple payback</td><td className="r">{payback ? `${f1(payback)} years` : '—'}</td></tr>
              <tr><td>Emissions cut</td><td className="r">{proj.co2 ? `${f1(proj.co2)} tCO₂e a year` : 'Not estimated'}</td></tr>
            </tbody></table>
          </div>
        </section>

        <div className="sml-cols">
          <section>
            <h3>Company</h3>
            <table className="sme-tbl"><tbody>
              <tr><td>Turnover</td><td className="r">{n(p.turnover) ? `₹${f1(p.turnover)} crore` : '—'}</td></tr>
              <tr><td>Employees</td><td className="r">{n(p.employees) ? f0(p.employees) : '—'}</td></tr>
              <tr><td>MSME class</td><td className="r">{r.msmeClass}</td></tr>
              <tr><td>Udyam registered</td><td className="r">{p.udyam ? 'Yes' : 'No'}{d.company.udyamNo ? ` · ${d.company.udyamNo}` : ''}</td></tr>
              <tr><td>Certifications</td><td className="r" style={{ whiteSpace: 'normal' }}>{certs.length ? certs.join(', ') : 'None'}</td></tr>
            </tbody></table>
          </section>
          <section>
            <h3>Emissions, {fy}</h3>
            <table className="sme-tbl"><tbody>
              <tr><td>Scope 1 (fuels, refrigerants)</td><td className="r">{f1(em.s1)} tCO₂e</td></tr>
              <tr><td>Scope 2 (grid electricity)</td><td className="r">{f1(em.s2)} tCO₂e</td></tr>
              <tr><td>Scope 3 (as reported)</td><td className="r">{f1(em.s3)} tCO₂e</td></tr>
              <tr><td>Intensity</td><td className="r">{f1(em.intensity)} t per ₹ crore</td></tr>
              <tr><td>Renewable electricity</td><td className="r">{f1(em.renewablePct)}%</td></tr>
            </tbody></table>
          </section>
          <section>
            <h3>Savings found</h3>
            <table className="sme-tbl"><tbody>
              <tr><td>Power bill fixes</td><td className="r">{lakh(b.total)} a year</td></tr>
              <tr><td>Rooftop solar ({f0(so.kw)} kWp)</td><td className="r">{lakh(so.save)} a year</td></tr>
              <tr><td>Solar cost and payback</td><td className="r">{so.kw ? `${lakh(so.cost)} · ${f1(so.paybackYears)} years` : '—'}</td></tr>
              <tr className="tot"><td>Total</td><td className="r">{lakh(r.money.savingsFound)} a year</td></tr>
            </tbody></table>
          </section>
          <section>
            <h3>ESG and SRMM</h3>
            <table className="sme-tbl"><tbody>
              <tr><td>ESG readiness</td><td className="r">{f0(es.overall)}% · {es.level ? `Level ${es.level} ${es.levelName}` : 'Not yet rated'}</td></tr>
              <tr><td>Environment · Social · Governance</td><td className="r">{f0(es.E)}% · {f0(es.S)}% · {f0(es.G)}%</td></tr>
              <tr><td>SRMM {sr.versionLabel}</td><td className="r">{f1(sr.pct * 100)}% · {sr.label}</td></tr>
              <tr><td>Assurance</td><td className="r" style={{ whiteSpace: 'normal' }}>{caText}</td></tr>
            </tbody></table>
          </section>
        </div>

        {schemes.length > 0 && <section>
          <h3>Schemes this loan can combine with</h3>
          <table className="sme-tbl"><tbody>{schemes.map((s) => <tr key={s.id}><td style={{ color: 'var(--fg)' }}><b>{s.title}</b>{s.note && <><br /><span className="muted">{s.note}</span></>}</td><td className="r"><Pill kind="good">{s.label}</Pill></td></tr>)}</tbody></table>
        </section>}

        <footer>
          Figures are reported by the company and calculated with EKOTRACE SME (emission factors {d.config.factors?.version ?? ''}: CEA grid, IPCC and DEFRA fuels). {validated ? 'The SRMM level has been validated by a Chartered Accountant.' : 'They have not been audited.'} Savings and payback are estimates from the company’s own bills{pr === 'other' ? ' and the figures it entered for this project' : ''}.
          <div className="sml-sig"><div>Authorised signatory, {d.company.name}</div><div>Date</div></div>
        </footer>
      </article>
    </>);
}
