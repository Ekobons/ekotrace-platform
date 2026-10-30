/** CBAM (EU from 2026, UK from 2027): embedded emissions per tonne and what the importer pays with your data vs default values. */
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Choice, Kpi, Kpis, Num, SmeHead, Sample, Toggle } from './ui';
import { f0, f1, f2, lakh, n } from '../../lib/sme';
import './comply.css';
import { t, tn } from './i18n';

const GOODS: [string, string][] = [['none', 'Not a CBAM good'], ['steel', 'Iron & steel'], ['aluminium', 'Aluminium'], ['cement', 'Cement'], ['fertiliser', 'Fertilisers']];
const ROUTES: Record<string, [string, string][]> = {
  steel: [['', 'Choose'], ['bf-bof', 'Blast furnace (BF-BOF)'], ['dri-eaf', 'DRI + electric arc furnace'], ['scrap-eaf', 'Scrap + electric arc furnace'], ['downstream', 'Processing bought steel (forging, rolling, fasteners)']],
  aluminium: [['', 'Choose'], ['primary', 'Primary (smelting)'], ['secondary', 'Secondary (scrap re-melting)'], ['downstream', 'Processing bought aluminium']],
  cement: [['', 'Choose'], ['clinker', 'Clinker made on site'], ['grinding', 'Grinding bought clinker']],
  fertiliser: [['', 'Choose'], ['ammonia', 'Ammonia-based'], ['other', 'Other']],
};
const eur = (v: unknown) => `€${f0(v)}`;

export function SmeCbam() {
  const { d, get } = useSme();
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const c = d.results.cbam, C = d.config.cbam ?? {}, em = d.results.emissions;
  const good = (get('profile.cbamGood') || 'none') as string;
  const eu = !!get('profile.euExport'), uk = !!get('profile.ukExport');
  const prod = n(get('profile.production'));
  const ph = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
  const dflt = (v: unknown, u: string) => (ph(v) ? `Leave empty to use ${v} ${u}` : undefined);
  const goodName = (GOODS.find((g) => g[0] === good)?.[1] ?? '').toLowerCase();
  const sample = d.company.isExample ? <Sample /> : null;
  const ready = good !== 'none' && prod > 0;

  return (
    <>
      <SmeHead lede={t('Exporters of iron & steel, aluminium, cement and fertilisers: your EU (and from 2027, UK) buyer pays a carbon charge on the emissions in your product. Your own data usually costs them far less than default values.')} />

      {good === 'none' || (!eu && !uk) ? (
        <div className="sme-callout warn">{t('CBAM applies when you export a covered product to the EU or UK. Choose your product and export markets below.')}</div>
      ) : !prod ? (
        <div className="sme-callout warn">{tn('Add your annual production in {link} to work out emissions per tonne.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</div>
      ) : null}

      {ready && (
        <Kpis>
          <Kpi label={t('Embedded emissions')} value={<>{f2(c.see)}{sample}</>} unit={t('tCO₂e per tonne of product')} />
          {eu && <Kpi label={t('EU charge, your data')} value={lakh(c.actualInr)} unit={`${eur(c.actualEur)} a year`} />}
          {eu && <Kpi label={t('EU charge, default values')} value={lakh(c.defaultInr)} unit={`${eur(c.defaultEur)} a year`} />}
          {eu && <Kpi label={t('Saved for your buyer')} value={lakh(c.saveInr)} unit={t('a year, using your data')} good={c.saveInr > 0} />}
          {uk && <Kpi label={t('UK charge from 2027')} value={lakh(c.ukInr)} unit={`£${f0(c.ukGbp)} a year`} />}
        </Kpis>)}

      {ready && eu && c.saveEur > 0 && (
        <div className="sme-callout">{tn('Using your own data instead of EU default values could save your importer about {eur} ({inr}) a year. That is a price argument in your next negotiation.', { eur: <b>{eur(c.saveEur)}</b>, inr: lakh(c.saveInr) })}</div>)}

      <div className="sme-grid2">
        <div className="cmp-stack">
          <div className="card"><h2>{t('What you export')}</h2>
            <Choice path="profile.cbamGood" label={t('Main export product')} options={GOODS} hint={t('Saved to your profile too')} />
            {good !== 'none' && ROUTES[good] && <Choice path="cbam.route" label={t('How it is made')} options={ROUTES[good]!} hint={t('For your importer\'s report')} />}
            <Toggle path="profile.euExport" label={t('We export to the EU')} />
            <Toggle path="profile.ukExport" label={t('We export to the UK')} />
          </div>

          {eu && good !== 'none' && (
            <div className="card"><h2>{t('EU shipments and prices')}</h2>
              <Num path="cbam.tonnesEU" label={t('Tonnes shipped to the EU this year')} unit="t" />
              <Num path="cbam.price" label={t('EU carbon price')} hint={dflt(C.eu_price_eur, '€/t')} placeholder={ph(C.eu_price_eur)} unit={t('€/t')} />
              <Num path="cbam.eurInr" label={t('Euro rate')} hint={dflt(C.eur_inr, '₹/€')} placeholder={ph(C.eur_inr)} unit="₹/€" />
              <Num path="cbam.benchmark" label={t('Free-allocation benchmark')} hint={`From the EU benchmark table for your CN code. ${dflt((C.benchmarks ?? {})[good], 't/t') ?? ''}`} placeholder={ph((C.benchmarks ?? {})[good])} unit="t/t" />
              <Num path="cbam.defaultValue" label={t('EU default value for India')} hint={`From the EU default-values list for your CN code. ${dflt((C.default_values ?? {})[good], 't/t') ?? ''}`} placeholder={ph((C.default_values ?? {})[good])} unit="t/t" />
            </div>)}

          {uk && good !== 'none' && (
            <div className="card"><h2>{t('UK shipments and prices')}</h2>
              <Num path="cbam.tonnesUK" label={t('Tonnes shipped to the UK a year')} unit="t" />
              <Num path="cbam.ukPrice" label={t('UK carbon price')} hint={dflt(C.uk_price_gbp, '£/t')} placeholder={ph(C.uk_price_gbp)} unit={t('£/t')} />
              <Num path="cbam.gbpInr" label={t('Pound rate')} hint={dflt(C.gbp_inr, '₹/£')} placeholder={ph(C.gbp_inr)} unit="₹/£" />
              <p className="cmp-sub" style={{ marginTop: 8 }}>{t('Simplified estimate: ignores UK free-allocation adjustments and any carbon price already paid in India.')}</p>
            </div>)}
        </div>

        <div className="cmp-stack">
          {ready && (
            <div className="card"><h2>{t('How it is calculated')}</h2>
              <div className="sme-scroll"><table className="sme-tbl cmp-calc" style={{ marginTop: 8 }}><tbody>
                <tr><td>{t('Direct emissions on site (Scope 1)')}</td><td>{f1(em.s1)} t</td></tr>
                {(good === 'steel' || good === 'aluminium') && <tr><td>{t('Emissions in the {good} you bought', { good: t(good) })}</td><td>{f1(c.precursor)} t</td></tr>}
                <tr><td>{t('Electricity (Scope 2)')}</td><td>{c.directOnly ? t('not counted') : `${f1(em.s2)} t`}</td></tr>
                <tr><td>{t('÷ Annual production')}</td><td>{f0(prod)} t</td></tr>
                <tr className="tot"><td>{t('Embedded emissions')}</td><td>{f2(c.see)} t per t</td></tr>
                {eu && <>
                  <tr><td>{t('Less {pct}% of the benchmark', { pct: f1(n(c.freeShare) * 100) })}</td><td>{f2(n(c.freeShare) * n(c.benchmark))} {t('t per t')}</td></tr>
                  <tr><td>{t('× EU tonnes × carbon price')}</td><td>{f0(get('cbam.tonnesEU'))} t × {eur(c.price)}</td></tr>
                  <tr className="tot"><td>{t('EU charge with your data')}</td><td>{eur(c.actualEur)}</td></tr>
                </>}
              </tbody></table></div>
              <p className="cmp-sub" style={{ marginTop: 10 }}>{t(c.directOnly ? 'For {good}, only direct emissions count; electricity does not.' : 'For {good}, electricity counts as well as direct emissions.', { good: goodName ? t(goodName) : t('your product') })} {tn('Emissions come from your {link} page. Simplified: the real figure is worked out per CN code and installation.', { link: <Link to="/sme/emissions">{t('Emissions')}</Link> })}</p>
            </div>)}

          <div className="card"><h2>{t('Key dates')}</h2>
            <ul className="cmp-time">
              <li><b>{t('Oct 2023 – Dec 2025')}</b><span>{t('Transitional period. EU importers only reported emissions; nobody paid.')}</span></li>
              <li className="now"><b>{t('From 1 Jan 2026 · now')}</b><span>{t('Definitive period. EU importers pay for the emissions in goods imported from 2026. They need an authorised CBAM declarant account; importers bringing in under 50 t a year are exempt.')}</span></li>
              <li><b>{t('1 Jan 2027')}</b><span>{t('UK CBAM starts for aluminium, cement, fertiliser, hydrogen and iron & steel, priced from the UK carbon market.')}</span></li>
              <li><b>{t('Feb 2027')}</b><span>{t('EU CBAM certificates go on sale for 2026 imports, priced at the EU carbon market average.')}</span></li>
              <li><b>{t('30 Sep 2027')}</b><span>{t('First annual EU declaration for 2026 imports. Your importer needs your verified emissions before this; otherwise default values apply.')}</span></li>
              <li><b>2026 – 2034</b><span>{t('Free allocation is phased out, so the share your buyer pays rises every year, from 2.5% in 2026 to 100% by 2034.')}</span></li>
            </ul>
            <p className="cmp-sub" style={{ marginTop: 12 }}>{t('To be used instead of default values, your figures must be checked by an accredited verifier. Send them in the EU communication template.')}</p>
          </div>
        </div>
      </div>
      <p className="muted small">{t('Indicative prices, benchmarks and default values from platform settings. Copy the exact values for your CN code from the EU tables.')}</p>
    </>);
}
