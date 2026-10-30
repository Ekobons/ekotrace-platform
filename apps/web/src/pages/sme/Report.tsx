/**
 * Buyer report: a one-page (two at most) sustainability summary in the shape of BRSR value-chain disclosures,
 * for listed customers and other buyers. The owner chooses the sections (module 'report'); it prints on A4
 * through the browser (Print / Save as PDF), no PDF library.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useApp } from '../../App';
import { useSme } from './store';
import { SmeHead } from './ui';
import { smeApi, dmy, f0, f1, f2, n, LEVELS, type SmeCaRequest } from '../../lib/sme';
import { PathChart, rupees, STATUS } from './Plan';
import './plan.css';
import './report.css';

const SECTIONS: [string, string, string][] = [
  ['emissions', 'Greenhouse gas emissions', 'Scope 1, 2 and 3, intensity, change from last year'],
  ['energy', 'Energy', 'Total energy and renewable share'],
  ['water', 'Water and waste', 'Water withdrawn, waste and recycling'],
  ['people', 'People and safety', 'Workforce, women, training, injuries'],
  ['policies', 'Policies', 'Code of conduct, POSH, privacy, grievances'],
  ['certs', 'Certifications', 'ZED, ISO and others held'],
  ['ratings', 'ESG and SRMM', 'Readiness level, SRMM score, CA validation'],
  ['plan', 'Reduction target and actions', 'From your Reduction plan'],
  ['method', 'How the figures were made', 'Factors used and estimates'],
];
const OPEN = ['requested', 'assigned', 'in_review'];

export function SmeReport() {
  const { d, fy, get, set, error } = useSme();
  const { me } = useApp();
  const [ca, setCa] = useState<SmeCaRequest[] | null>(null);
  useEffect(() => { smeApi.caRequests().then((r) => setCa(r.items)).catch(() => setCa([])); }, []);
  if (error) return <div className="card empty">{error}</div>;
  if (!d) return <div className="card empty">Loading…</div>;

  const can = d.canEdit;
  const on = (k: string) => get(`report.sections.${k}`) !== false;
  const r = d.results, em = r.emissions, en = r.energy ?? {}, es = r.esg, sr = r.srmm, sf = r.safety ?? {}, P = r.plan;
  const p = d.data.profile ?? {}, e = d.data.esg ?? {}, ppl = d.data.people ?? {};
  const qty = (k: string) => n((em.rows as any[]).find((x) => x.key === k)?.quantity);
  const mine = (ca ?? []).filter((c) => c.fy === fy);
  const validated = mine.find((c) => c.status === 'validated'), caOpen = mine.find((c) => OPEN.includes(c.status));
  const certs = ((d.data.certs ?? []) as any[]).filter((c) => c.level && !['none', 'inprogress', 'committed'].includes(c.level));
  const working = ((d.data.certs ?? []) as any[]).filter((c) => ['inprogress', 'committed'].includes(c.level));
  const used = (em.rows as any[]).filter((x) => x.quantity > 0);
  const counted = ((P?.rows ?? []) as any[]).filter((x) => ['planned', 'doing', 'done'].includes(x.status));
  const hasData = em.total > 0;
  const preparedBy: string = get('report.preparedBy') || me.user.name;
  const today = new Date().toISOString().slice(0, 10);
  const yes = (v: unknown) => (v ? 'Yes' : 'No');
  const shown = SECTIONS.filter(([k]) => on(k)).length;
  const est: string[] = (em.quality?.estimated ?? []).map((k: string) => (em.rows as any[]).find((x) => x.key === k)?.label).filter(Boolean);
  const partial: string[] = (em.quality?.partial ?? []).map((k: string) => (em.rows as any[]).find((x) => x.key === k)?.label).filter(Boolean);

  return (
    <>
      <SmeHead lede="A one-page summary for your buyers, in the shape of the BRSR value-chain questions listed companies ask suppliers. Choose what to include, then print it or save it as a PDF.">
        <button type="button" className="btn p" onClick={() => window.print()}><Icon name="download" />Print or save as PDF</button>
      </SmeHead>

      <div className="rp-setup sme-noprint">
        <div className="card">
          <h2>What to include</h2>
          <div className="rp-checks">{SECTIONS.map(([k, t, s]) => (
            <label key={k} className="rp-check"><input type="checkbox" disabled={!can} checked={on(k)} onChange={(ev) => set(`report.sections.${k}`, ev.target.checked)} /><span><b>{t}</b><small>{s}</small></span></label>))}</div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>{shown} of {SECTIONS.length} sections. Company details and the footer are always included.</p>
        </div>
        <div className="card">
          <h2>Prepared by</h2>
          <div className="rp-form">
            <label><span>Name</span><input className="input" disabled={!can} value={get('report.preparedBy') ?? ''} placeholder={me.user.name} onChange={(ev) => set('report.preparedBy', ev.target.value)} /></label>
            <label><span>Designation</span><input className="input" disabled={!can} value={get('report.designation') ?? ''} placeholder="e.g. Director" onChange={(ev) => set('report.designation', ev.target.value)} /></label>
            <label><span>For (buyer, optional)</span><input className="input" disabled={!can} value={get('report.forBuyer') ?? ''} placeholder="e.g. Bharat Auto Components Ltd" onChange={(ev) => set('report.forBuyer', ev.target.value)} /></label>
          </div>
          <p className="muted small" style={{ margin: '10px 0 0' }}>In the print window choose <b>Save as PDF</b> and A4 to e-mail it. Turn off the browser’s “Headers and footers” for a clean page.</p>
        </div>
      </div>
      {!hasData && <div className="sme-callout warn sme-noprint">No emissions are entered for {fy} yet. <Link to="/sme/emissions">Add your bills in Emissions</Link> before you send this to a buyer.</div>}
      <p className="lbl sme-noprint" style={{ margin: '6px 0 -4px' }}>The report, as your buyer will see it</p>

      <article className={`rp-doc${d.company.isExample ? ' sample' : ''}`} aria-label="Buyer report">
        {d.company.isExample && <div className="rp-wm" aria-hidden="true">Sample</div>}
        <header className="rp-head">
          <div style={{ minWidth: 0 }}>
            <span className="rp-kicker">Supplier sustainability summary · BRSR value-chain format</span>
            <h2>{d.company.name}</h2>
            <div className="rp-sub">{[d.company.industry, d.company.state, `${r.msmeClass} enterprise`, d.company.udyamNo ? `Udyam ${d.company.udyamNo}` : null].filter(Boolean).join(' · ')}</div>
          </div>
          <div className="rp-meta"><b>{fy}</b><span>1 April to 31 March</span>{get('report.forBuyer') && <span>For {get('report.forBuyer')}</span>}</div>
        </header>
        {d.company.isExample && <p className="rp-samplenote">Sample company: every figure is invented for demonstration.</p>}

        <div className="rp-cols">
          {on('emissions') && <Sec t="Greenhouse gas emissions">
            <Rows rows={[
              ['Scope 1 (fuels, refrigerants)', `${f1(em.s1)} tCO₂e`],
              ['Scope 2 (electricity, location-based)', `${f1(em.s2)} tCO₂e`],
              em.greenKwh > 0 ? ['Scope 2, market-based', `${f1(em.s2Market)} tCO₂e`] : null,
              ['Scope 1 + 2', `${f1(em.total)} tCO₂e`, true],
              ['Scope 3 (categories reported)', em.s3 > 0 ? `${f1(em.s3)} tCO₂e` : 'Not reported'],
              ['Intensity (Scope 1 + 2)', n(p.turnover) > 0 ? `${f2(em.intensity)} t per ₹ crore` : 'Turnover not given'],
              ['Last year, Scope 1 + 2', em.prior?.total > 0 ? `${f1(em.prior.total)} t, now ${f1(Math.abs(em.change))}% ${em.change > 0 ? "higher" : "lower"}` : 'No prior-year data'],
            ]} />
          </Sec>}
          {on('energy') && <Sec t="Energy">
            <Rows rows={[
              ['Total energy used', `${f0(en.total)} GJ`],
              ['Grid electricity', `${f0(qty('grid'))} kWh`],
              ['Rooftop solar used', `${f0(qty('solar'))} kWh`],
              ['Renewable share of electricity', `${f1(em.renewablePct)}%`],
              ['Renewable share of all energy', `${f1(en.pct)}%`],
            ]} />
          </Sec>}
          {on('water') && <Sec t="Water and waste">
            <Rows rows={[
              ['Water withdrawn', n(e.water) > 0 ? `${f0(e.water)} kL` : 'Not recorded'],
              ['Waste generated', n(e.waste) > 0 ? `${f1(e.waste)} t` : 'Not recorded'],
              ['Recycled or reused', n(e.waste) > 0 ? `${f0(e.recycled)}%` : '—'],
            ]} />
          </Sec>}
          {on('people') && <Sec t="People and safety">
            <Rows rows={[
              ['Employees and workers', n(p.employees) > 0 ? f0(p.employees) : 'Not given'],
              ['Women in the workforce', e.women !== undefined && e.women !== '' ? `${f0(e.women)}%` : 'Not recorded'],
              ['Training per employee', n(e.training) > 0 ? `${f1(e.training)} hours a year` : 'Not recorded'],
              ['Lost-time injuries', sf.entries > 0 || ppl.noIncidents ? `${f0(sf.lti)}` : 'Not recorded'],
              ['LTIFR (per million hours)', sf.entries > 0 || ppl.noIncidents ? f2(sf.ltifr) : '—'],
            ]} />
          </Sec>}
          {on('policies') && <Sec t="Policies">
            <Rows rows={[
              ['Code of conduct', yes(e.coc)],
              ['Anti-bribery policy', yes(e.abc)],
              ['POSH Internal Committee', yes(e.posh || ppl.posh_ic)],
              ['Data privacy policy (DPDP Act)', yes(e.privacy)],
              ['Grievance channel for workers', yes(e.grievance)],
              ['Supplier code of conduct', yes(e.supplierCode)],
              ['Minimum wages paid to all', yes(e.minwage)],
            ]} />
          </Sec>}
          {on('certs') && <Sec t="Certifications">
            {certs.length ? <Rows rows={certs.map((c) => [c.name + (c.level !== 'held' ? ` (${c.level})` : ''), c.expiry ? `valid to ${dmy(c.expiry)}` : 'held'])} /> : <p className="rp-none">None held.</p>}
            {working.length > 0 && <p className="rp-small">Working towards: {working.map((c) => c.name).join(', ')}.</p>}
          </Sec>}
          {on('ratings') && <Sec t="ESG and SRMM">
            <Rows rows={[
              ['ESG readiness (self-assessed)', `${f0(es.overall)}% · ${es.level ? `Level ${es.level} ${es.levelName}` : 'Not yet rated'}`],
              ['Environment · Social · Governance', `${f0(es.E)}% · ${f0(es.S)}% · ${f0(es.G)}%`],
              [`ICAI SRMM ${sr.versionLabel ?? ''}`.trim(), `${f1(sr.pct * 100)}% · ${sr.label}`],
              ['Assurance', ca === null ? '…' : validated ? `Validated by a CA: ${f1(validated.validated_pct)}%, Level ${validated.validated_level} ${LEVELS[validated.validated_level ?? 0]}` : caOpen ? 'CA validation in progress' : 'Self-assessed, not validated by a CA'],
            ]} />
          </Sec>}
        </div>

        {on('plan') && <Sec t="Reduction target and actions">
          {P && P.base?.t > 0 && counted.length > 0 ? <div className="rp-plan">
            <div>
              <p className="rp-lead">Target: <b>{f0(P.target.pct)}% below {P.base.label}</b> ({f1(P.base.t)} t) by <b>{P.target.label}</b>. Planned actions cut {f1(P.totals.planned.tco2e)} t a year; {P.reaches ? 'they reach the target.' : `${f1(P.gap)} t still to find.`}</p>
              <table className="sme-tbl rp-tbl"><thead><tr><th>Main actions</th><th className="r">t a year</th><th className="r">Status</th></tr></thead>
                <tbody>{[...counted].sort((a, b) => b.tco2e - a.tco2e).slice(0, 4).map((x) => <tr key={x.id}><td>{x.title}</td><td className="r">{f1(x.tco2e)}</td><td className="r">{STATUS.find((s) => s[0] === x.status)?.[1]}{x.date ? `, ${dmy(x.date)}` : ''}</td></tr>)}</tbody></table>
              <p className="rp-small">Yearly saving of the planned actions about {rupees(P.totals.planned.save)}, for an investment of about {rupees(P.totals.planned.cost)}.</p>
            </div>
            <div className="rp-chart"><PathChart path={P.path} target={P.target} compact /></div>
          </div> : <p className="rp-none">No reduction target or planned actions recorded yet.{can && <span className="sme-noprint"> <Link to="/sme/plan">Make a plan</Link>.</span>}</p>}
        </Sec>}

        {on('method') && <Sec t="How the figures were made">
          <p className="rp-small">Calculated with EKOTRACE SME using the GHG Protocol: activity data from the company’s bills and records × emission factors (set {em.factorVersion ?? '—'}). Scope 2 uses the CEA grid factor{em.greenKwh > 0 ? '; the market-based figure counts renewable electricity bought as zero' : ''}. {em.s3 > 0 ? 'Scope 3 covers only the categories shown in the company’s data.' : ''}</p>
          {used.length > 0 && <div className="sme-scroll"><table className="sme-tbl rp-tbl rp-factors"><thead><tr><th>Source</th><th className="r">Quantity</th><th className="r">Factor (kg CO₂e)</th><th>Factor source</th></tr></thead>
            <tbody>{used.map((x) => <tr key={x.key}><td>{x.label}{x.quality === 'estimated' ? ' *' : ''}</td><td className="r">{f0(x.quantity)} {x.unit}</td><td className="r">{x.factor} / {x.unit}</td><td>{x.source ?? '—'}</td></tr>)}</tbody></table></div>}
          <p className="rp-small">{est.length ? `* Estimated, not from bills: ${est.join(', ')}. ` : 'No figures are marked as estimates. '}{partial.length ? `Fewer than 12 months entered for: ${partial.join(', ')}. ` : ''}{validated ? 'The SRMM score has been validated by a Chartered Accountant; other figures are not audited.' : 'The figures have not been audited.'}</p>
        </Sec>}

        <footer className="rp-foot">
          <div><span>Prepared by</span><b>{preparedBy}{get('report.designation') ? `, ${get('report.designation')}` : ''}</b></div>
          <div><span>Date</span><b>{dmy(today)}</b></div>
          <div><span>Signature</span><b className="rp-sig">&nbsp;</b></div>
        </footer>
      </article>
    </>);
}

function Sec({ t, children }: { t: string; children: ReactNode }) {
  return <section className="rp-sec"><h3>{t}</h3>{children}</section>;
}
function Rows({ rows }: { rows: ([string, string] | [string, string, boolean] | null)[] }) {
  return <table className="sme-tbl rp-tbl"><tbody>{rows.filter(Boolean).map((x) => <tr key={x![0]} className={x![2] ? 'tot' : ''}><td>{x![0]}</td><td className="r">{x![1]}</td></tr>)}</tbody></table>;
}
