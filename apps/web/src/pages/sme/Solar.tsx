/** Rooftop solar: size a system from roof area and grid use, with cost, savings, payback and the support available. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link } from 'react-router-dom';
import './save.css';
import { useSme } from './store';
import { Kpi, Kpis, Num, Sample, SmeHead } from './ui';
import { f0, f1, lakh, n } from '../../lib/sme';
import { t, tn } from './i18n';

const LIFE = 25; // typical panel life, years

export function SmeSolar() {
  const { d, get } = useSme();
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const s = d.results.solar as any, C = (d.config.solar ?? {}) as { default?: Record<string, number>; states?: Record<string, Record<string, number>>; note?: string };
  const state = d.company.state;
  const D: Record<string, number> = { ...(C.default ?? {}), ...((state && C.states?.[state]) || {}) };
  const ph = (k: string) => (D[k] !== undefined ? String(D[k]) : undefined);
  const hint = (k: string, base: string) => { const v = get(`solar.${k}`); return (v === undefined || v === null || v === '') && D[k] !== undefined ? `${t(base)} ${k === 'yieldKwp' && state && C.states?.[state]?.yieldKwp ? t('Empty: using typical {v} for {state}.', { v: f0(D[k]), state }) : t('Empty: using typical {v}.', { v: f0(D[k]) })}` : base; };
  const grid = n(get('emissions.grid')), roofOk = n(s.inputs.roof) > 0 && n(s.inputs.usable) > 0, sized = s.kw > 0;
  const max = Math.max(s.byRoof, s.byLoad, 1);
  const payPct = Math.min(100, (s.paybackYears / LIFE) * 100);

  return (
    <>
      <SmeHead lede={t('How big a rooftop system your factory can take, what it costs, what it saves and how soon it pays for itself.')}>
        {d.company.isExample && <Sample />}
      </SmeHead>
      <Kpis>
        <Kpi label={t('System size')} value={sized ? f0(s.kw) : '—'} unit="kWp" />
        <Kpi label={t('Investment')} value={sized ? lakh(s.cost) : '—'} unit={t('before any support')} />
        <Kpi label={t('Yearly savings')} value={sized ? lakh(s.save) : '—'} unit={t('on your power bill')} good={sized} />
        <Kpi label={t('Payback')} value={sized ? f1(s.paybackYears) : '—'} unit={t('years')} />
        <Kpi label={t('CO₂ avoided')} value={sized ? f0(s.co2) : '—'} unit={t('tonnes a year')} />
      </Kpis>

      {!sized && (
        <div className="sme-callout warn">
          <b>{t('No system can be sized yet.')}</b>{' '}
          {!roofOk && 'Enter your free roof area below. '}
          {!grid && <>{tn('No grid electricity is entered for {fy}. {link} so the system matches what you use.', { fy: d.fy, link: <Link to="/sme/emissions">{t('Add it in Emissions')}</Link> })} </>}
          {roofOk && grid > 0 && 'The usable roof is too small for even 1 kWp (about 10 m² each).'}
        </div>)}

      <div className="sme-grid2">
        <div className="card">
          <h2>{t('Your roof and costs')}</h2>
          <p className="sv-sub">{state ? t('Only the roof area is needed. The rest uses typical figures for {state} until you change them.', { state }) : t('Only the roof area is needed. The rest uses typical figures until you change them.')}</p>
          <div className="sme-fields" style={{ marginTop: 6 }}>
            <Num path="solar.roof" label={t('Free roof area')} hint={t('Flat or south-facing roof with no shade')} unit="m²" />
            <Num path="solar.usable" label={t('Usable share')} hint={hint('usable', 'After walkways, tanks and shade.')} unit="%" placeholder={ph('usable')} />
            <Num path="solar.tariff" label={t('What you pay per unit')} hint={hint('tariff', 'Energy charge on your bill.')} unit="₹/kWh" placeholder={ph('tariff')} />
            <Num path="solar.costKw" label={t('Installed cost')} hint={hint('costKw', 'From an installer quote.')} unit="₹/kWp" placeholder={ph('costKw')} />
            <Num path="solar.yieldKwp" label={t('Yearly generation per kWp')} hint={hint('yieldKwp', 'Units each kWp of panels makes in a year.')} unit="kWh" placeholder={ph('yieldKwp')} />
          </div>
        </div>

        <div className="card">
          <h2>{t('How it\'s sized')}</h2>
          <p className="sv-sub">{t('The smaller of what fits on the roof and what you use, so every unit made replaces a unit you buy.')}</p>
          <div className="sv-bars">
            <div className="sv-barrow"><span>{t('Fits on your roof')}</span><div className="sme-track"><b style={{ width: `${(s.byRoof / max) * 100}%` }} /></div><span className="num">{f0(s.byRoof)} kWp</span></div>
            <div className="sv-barrow"><span>{t('Matches your grid use')}</span><div className="sme-track"><b className="alt" style={{ width: `${(s.byLoad / max) * 100}%` }} /></div><span className="num">{f0(s.byLoad)} kWp</span></div>
          </div>
          <table className="sme-tbl sv-k2" style={{ marginTop: 14 }}><tbody>
            <tr className="tot"><td>{sized ? t('Recommended, limited by {x}', { x: t(s.limitedBy) }) : t('Recommended')}</td><td>{f0(s.kw)} kWp</td></tr>
            <tr><td>{t('Generation')}</td><td>{f0(s.gen)} {t('kWh a year')}</td></tr>
            <tr><td>{t('Share of your grid use')}</td><td>{grid > 0 ? `${f0((s.gen / grid) * 100)}%` : '—'}</td></tr>
            <tr><td>{t('Investment')}</td><td>{lakh(s.cost)}</td></tr>
            <tr><td>{t('Saving on your bill')}</td><td>{t('{amt} a year', { amt: lakh(s.save) })}</td></tr>
          </tbody></table>
          {sized && <>
            <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}><span className="lbl">{t('Payback in a {n}-year panel life', { n: LIFE })}</span><span className="small muted">{t('{a} years, then about {b} years of free power', { a: f1(s.paybackYears), b: f0(Math.max(0, LIFE - s.paybackYears)) })}</span></div>
            <div className="sv-meter" style={{ marginTop: 6 }} role="img" aria-label={`Paid back in ${f1(s.paybackYears)} of ${LIFE} years`}><b style={{ width: `${payPct}%`, background: 'var(--s3)' }} /><b style={{ width: `${100 - payPct}%` }} /></div>
          </>}
        </div>
      </div>

      <div className="card">
        <h2>{t('Subsidy and support')}</h2>
        <p className="sv-sub">{t('The payback above is before any support. What applies to a factory roof:')}</p>
        <div className="sme-grid2" style={{ marginTop: 10 }}>
          <ol className="sv-steps">
            <li><span><b>{t('No central capital subsidy for factories.')}</b><small>{t('PM Surya Ghar subsidies are for homes and housing societies, not commercial or industrial roofs.')}</small></span></li>
            <li><span><b>{t('Net metering through your DISCOM.')}</b><small>{t('{state}’s rules set how much you can connect and how extra units are credited. Apply on the DISCOM portal before installing.', { state: state || t('Your state') })}</small></span></li>
            <li><span><b>{t('State incentives.')}</b><small>{tn('Some states give electricity duty waivers or capital support to MSMEs. See {link}.', { link: <Link to="/sme/schemes">{t('Schemes')}</Link> })}</small></span></li>
          </ol>
          <ol className="sv-steps" start={4} style={{ counterReset: 's 3' }}>
            <li><span><b>{t('Cheaper loans.')}</b><small>{tn('SIDBI and banks lend for rooftop solar at concessional rates. Build the request in {link}.', { link: <Link to="/sme/loan">{t('Green loan')}</Link> })}</small></span></li>
            <li><span><b>{t('Tax depreciation.')}</b><small>{t('Solar plant usually qualifies for higher depreciation. Ask your CA what it is worth to you.')}</small></span></li>
            <li><span><b>{t('Carbon credits.')}</b><small>{tn('New solar can earn credits through the EKOTRACE pool. See {link}.', { link: <Link to="/sme/credits">{t('Carbon credits')}</Link> })}</small></span></li>
          </ol>
        </div>
      </div>
      <p className="muted small">{t('Figures are estimates; get two installer quotes and a shadow study before you decide.')}</p>
    </>);
}
