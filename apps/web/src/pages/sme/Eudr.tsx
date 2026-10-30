/** EUDR: deforestation-free proof for EU exports of leather, rubber, coffee, wood, soya, cocoa and palm oil: source plots and documents. */
import { useState, type FormEvent } from 'react';
import { useSme } from './store';
import { Choice, Kpi, Kpis, Pill, SmeHead } from './ui';
import { f1, n } from '../../lib/sme';
import './comply.css';
import { t, tn } from './i18n';

interface Plot { id: string; lat: number; lon: number; ha: number }
const COMMODITIES: [string, string][] = [['none', 'None'], ['leather', 'Leather / cattle products'], ['rubber', 'Rubber'], ['coffee', 'Coffee'], ['wood', 'Wood / furniture / paper'], ['soya', 'Soya'], ['cocoa', 'Cocoa'], ['palm oil', 'Palm oil']];
const DOCS: [string, string][] = [
  ['Supplier and plot list', 'Every farm or forest your raw material comes from'],
  ['Geolocation for every plot', 'A GPS point, or a boundary for plots over 4 hectares'],
  ['Land title or lease', 'Shows the land was used legally'],
  ['Proof of legal production', 'Permits, tax and labour compliance where the material was produced'],
  ['Deforestation-free check', 'Satellite maps showing no forest loss after 31 Dec 2020'],
];

export function SmeEudr() {
  const { d, get, setModule, set } = useSme();
  const [f, setF] = useState({ id: '', lat: '', lon: '', ha: '' });
  const [err, setErr] = useState('');
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const commodity = (get('profile.eudr') || 'none') as string;
  const plots: Plot[] = Array.isArray(get('eudr.plots')) ? get('eudr.plots') : [];
  const docsDone = DOCS.filter((_, i) => !!get(`eudr.d${i}`)).length;
  const big = plots.filter((p) => n(p.ha) > 4).length;
  const ha = plots.reduce((a, p) => a + n(p.ha), 0);
  const label = COMMODITIES.find((c) => c[0] === commodity)?.[1].toLowerCase() ?? commodity;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const id = f.id.trim(), lat = Number(f.lat), lon = Number(f.lon), area = Number(f.ha);
    if (!id) return setErr(t('Give the plot a name or ID.'));
    if (plots.some((p) => p.id.toLowerCase() === id.toLowerCase())) return setErr(t('A plot with this name already exists.'));
    if (f.lat === '' || !(lat >= 6 && lat <= 37)) return setErr(t('Latitude must be between 6 and 37 for India.'));
    if (f.lon === '' || !(lon >= 68 && lon <= 98)) return setErr(t('Longitude must be between 68 and 98 for India.'));
    if (f.ha === '' || !(area > 0)) return setErr(t('Area must be more than 0 hectares.'));
    setErr('');
    setModule('eudr', { ...(d.data.eudr ?? {}), plots: [...plots, { id: id.slice(0, 80), lat: +lat.toFixed(6), lon: +lon.toFixed(6), ha: area }] });
    setF({ id: '', lat: '', lon: '', ha: '' });
  };
  const remove = (i: number) => { if (window.confirm(t('Remove this plot?'))) setModule('eudr', { ...(d.data.eudr ?? {}), plots: plots.filter((_, j) => j !== i) }); };

  return (
    <>
      <SmeHead lede={t('The EU Deforestation Regulation covers leather (cattle), rubber, coffee, wood, soya, cocoa and palm oil, and products made from them. Your EU buyer must prove the land was not deforested after 31 December 2020.')} />

      {commodity === 'none'
        ? <div className="sme-callout warn">{t('Your profile has no EUDR commodity. Choose one below if you export any of these, or products made from them, to the EU.')}</div>
        : <div className="sme-callout">{tn('Applies to your {label} exports. Large and medium EU operators must comply from {a}, micro and small ones from {b}. They will ask you for the plot locations and documents below.', { label: t(label), a: <b>30 Dec 2026</b>, b: <b>30 Jun 2027</b> })}</div>}

      <Kpis>
        <Kpi label={t('Source plots')} value={plots.length} unit={plots.length ? `${f1(ha)} hectares in all` : t('none recorded yet')} />
        <Kpi label={t('Need a boundary')} value={big} unit={t('plots over 4 hectares')} />
        <Kpi label={t('Documents ready')} value={`${docsDone} of ${DOCS.length}`} good={docsDone === DOCS.length} />
      </Kpis>

      <div className="sme-grid2">
        <div className="card">
          <h2>{t('Source plots')}</h2>
          <p className="cmp-sub">{t('Record each farm, plantation or forest plot your raw material comes from.')}</p>
          <div className="sme-scroll"><table className="sme-tbl">
            <thead><tr><th>{t('Plot')}</th><th className="r">{t('Latitude, longitude')}</th><th className="r">{t('Hectares')}</th>{d.canEdit && <th aria-label={t('Remove')} />}</tr></thead>
            <tbody>
              {plots.map((p, i) => (
                <tr key={`${p.id}-${i}`}><td>{p.id}{n(p.ha) > 4 && <><br /><Pill kind="soon">{t('Boundary needed')}</Pill></>}</td>
                  <td className="r mono small">{p.lat}, {p.lon}</td>
                  <td className="r">{p.ha}</td>
                  {d.canEdit && <td className="r"><button type="button" className="btn xs ghost danger" onClick={() => remove(i)} aria-label={`Remove plot ${p.id}`}>{t('Remove')}</button></td>}</tr>))}
              {!plots.length && <tr><td colSpan={4} className="muted">{t('No plots yet.')}{d.canEdit ? ` ${t('Add the first one below.')}` : ''}</td></tr>}
            </tbody>
          </table></div>
          {d.canEdit && (
            <form className="cmp-form" onSubmit={add} noValidate>
              <label className="wide"><span>{t('Plot name or ID')}<small> {t('e.g. farmer name and survey number')}</small></span><input className="input" value={f.id} maxLength={80} onChange={(e) => setF({ ...f, id: e.target.value })} /></label>
              <label><span>{t('Latitude')}<small> {t('India: 6 to 37')}</small></span><input className="input num" type="number" step="any" inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} placeholder="10.123456" /></label>
              <label><span>{t('Longitude')}<small> {t('India: 68 to 98')}</small></span><input className="input num" type="number" step="any" inputMode="decimal" value={f.lon} onChange={(e) => setF({ ...f, lon: e.target.value })} placeholder="76.123456" /></label>
              <label><span>{t('Area')}<small> {t('hectares')}</small></span><input className="input num" type="number" step="any" min={0} inputMode="decimal" value={f.ha} onChange={(e) => setF({ ...f, ha: e.target.value })} /></label>
              {err && <p className="cmp-err" role="alert">{err}</p>}
              <div className="wide"><button className="btn p sm" type="submit">{t('Add plot')}</button></div>
            </form>)}
          <p className="cmp-sub" style={{ marginTop: 10 }}>{t('Use six decimal places from a phone GPS app. Plots over 4 hectares (other than for cattle) need a boundary (polygon), not a single point.')}</p>
        </div>

        <div className="cmp-stack">
          <div className="card"><h2>{t('Your commodity')}</h2>
            <Choice path="profile.eudr" label={t('EUDR commodity exported to the EU')} options={COMMODITIES} hint={t('Saved to your profile too')} />
          </div>
          <div className="card">
            <div className="cmp-h2row"><h2>{t('Documents for your buyer')}</h2><span className="muted small">{docsDone} of {DOCS.length}</span></div>
            <div className="cmp-checks" style={{ marginTop: 6 }}>
              {DOCS.map(([t, h], i) => {
                const on = !!get(`eudr.d${i}`);
                return (
                  <div key={t} className={`cmp-check${on ? ' on' : ''}`}>
                    <input id={`eu-${i}`} type="checkbox" checked={on} disabled={!d.canEdit} onChange={(e) => set(`eudr.d${i}`, e.target.checked)} />
                    <label htmlFor={`eu-${i}`}>{t}<small>{h}</small></label><span />
                  </div>);
              })}
            </div>
          </div>
        </div>
      </div>
    </>);
}
