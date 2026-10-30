/**
 * Plants / sites (Profile): the company's plants, each with a name, city and state. One plant
 * ("Main plant") unless more are added; Emissions then shows a plant chooser and a split by plant.
 * Stored as profile.plants [{ id, name, city, state }]; the first is always id "main".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { change, sitesOf, siteValue } from './emisData';
import './emis.css';
import { t, tn } from './i18n';

type Plant = { id: string; name: string; city: string; state: string };

export function PlantsCard() {
  const { d, get, set, setModule } = useSme();
  if (!d) return null;
  const can = d.canEdit;
  const stored = (Array.isArray(get('profile.plants')) ? get('profile.plants') : []) as Plant[];
  const list: Plant[] = stored.some((p) => p.id === 'main') ? stored : [{ id: 'main', name: 'Main plant', city: '', state: d.company.state ?? '' }, ...stored];
  const states: string[] = d.config.states ?? [];
  const keys = [...Object.keys(d.config.factors.items ?? {}), 'green'];
  const save = (next: Plant[]) => set('profile.plants', next);
  const edit = (i: number, k: keyof Plant, v: string) => save(list.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const add = () => save([...list, { id: `p${Date.now().toString(36)}`, name: '', city: '', state: d.company.state ?? '' }]);
  const remove = (p: Plant) => {
    const em = get('emissions') ?? {};
    const s = sitesOf(em)[p.id];
    const hasData = !!s && keys.some((k) => siteValue(s, k) > 0);
    if (!window.confirm(hasData ? t('{name} has emission figures for {fy}. Removing it deletes them and lowers your totals. Remove it?', { name: p.name || t('This plant'), fy: d.fy }) : t('Remove {name}?', { name: p.name || t('this plant') }))) return;
    if (s) setModule('emissions', change(em, keys, (nx) => { delete nx.sites[p.id]; }));
    save(list.filter((x) => x.id !== p.id));
  };
  return (
    <section className="card">
      <div className="cb-h"><h2>{t('Plants and sites')}</h2>{list.length > 1 && <span className="cb-count">{t('{n} plants', { n: list.length })}</span>}</div>
      <p className="cb-sub">
        {list.length > 1
          ? <>{tn('Enter emissions for each plant in {link}; totals add up and you see the split by plant.', { link: <Link to="/sme/emissions">{t('Emissions')}</Link> })}</>
          : <>{t('One site is all most companies need. Add a plant only if you want its emissions shown separately.')}</>}
      </p>
      <div className="pl-list">
        {list.map((p, i) => (
          <div className="pl-row" key={p.id}>
            <label><span className="lbl">{i === 0 ? t('Main plant') : t('Plant {n}', { n: i + 1 })}</span>
              <input className="input" value={p.name} placeholder={i === 0 ? t('Main plant') : t('Name, for example Chakan unit')} disabled={!can} onChange={(e) => edit(i, 'name', e.target.value)} /></label>
            <label><span className="lbl">{t('City or town')}</span>
              <input className="input" value={p.city ?? ''} disabled={!can} onChange={(e) => edit(i, 'city', e.target.value)} /></label>
            <label><span className="lbl">{t('State')}</span>
              <select className="input" value={p.state ?? ''} disabled={!can} onChange={(e) => edit(i, 'state', e.target.value)}>
                <option value="">{t('Choose…')}</option>
                {p.state && !states.includes(p.state) && <option value={p.state}>{p.state}</option>}
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
            <div className="pl-x">{can && i > 0 && <button type="button" className="btn sm ghost" onClick={() => remove(p)}>{t('Remove')}</button>}</div>
          </div>))}
      </div>
      {can && <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={add}>{t('+ Add a plant')}</button>}
      {list.length > 1 && <p className="cb-muted-note">{t('Plants are kept for {fy}. When you start another year, add them again there.', { fy: d.fy })}</p>}
    </section>);
}
