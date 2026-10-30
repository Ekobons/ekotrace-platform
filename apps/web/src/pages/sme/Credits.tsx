/** Carbon credits: an estimate from new solar and efficiency, the pool's terms, and projects submitted to the EKOTRACE pool. */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import './save.css';
import { useApp } from '../../App';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Sample, SmeHead } from './ui';
import { dmy, f0, f1, lakh, n, smeApi, type SmeCredit } from '../../lib/sme';
import { t, tn } from './i18n';

const PSTATUS: Record<SmeCredit['status'], [string, string, string]> = {
  proposed: ['Under review', 'watch', 'EKOTRACE checks the project and meter data.'],
  accepted: ['Accepted', 'likely', 'In the pool; waits for registration.'],
  registered: ['Registered', 'good', 'Registered with the programme; credits accrue.'],
  issued: ['Credits issued', 'done', 'Credits issued; revenue is shared yearly.'],
  rejected: ['Not accepted', 'overdue', 'Did not meet the programme rules.'],
};
const TYPES: [SmeCredit['type'], string, string][] = [
  ['solar', 'Rooftop solar', 'New capacity installed after you joined the pool'],
  ['efficiency', 'Energy efficiency', 'Electricity saved: motors, compressors, lighting, VFDs'],
  ['fuel_switch', 'Fuel switch', 'Moving from diesel or coal to electricity or biomass'],
];

export function SmeCredits() {
  const { d, get } = useSme();
  const { toast } = useApp();
  const [items, setItems] = useState<SmeCredit[] | null>(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ type: 'solar' as SmeCredit['type'], kw: '', kwh: '' });
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    try { setItems((await smeApi.credits()).items); setErr(''); } catch (e) { setErr((e as Error).message); setItems((x) => x ?? []); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const c = d.results.credits as { tco2e: number; mine: number; gross: number; price: number; share: number; pool: number; poolOthers: number; viableAt: number; solarGen: number };
  const P = (d.config.credit_pool ?? {}) as { price_inr?: number; management_share_pct?: number; pool_tco2e_others?: number; viable_at_tco2e?: number; note?: string };
  const dflt = (k: string, v: number | undefined, base: string) => { const x = get(`credits.${k}`); return (x === undefined || x === null || x === '') && v !== undefined ? `${t(base)} ${t('Empty: using the pool rate {v}.', { v: f0(v) })}` : base; };
  const has = n(get('credits.newSolarKw')) > 0 || n(get('credits.effKwh')) > 0;
  const viable = c.pool >= c.viableAt, tot = Math.max(c.pool, c.viableAt, 1);
  const submitted = (items ?? []).filter((x) => x.status !== 'rejected').reduce((a, x) => a + n(x.tco2e_per_year), 0);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = Number(form.type === 'solar' ? form.kw : form.kwh);
    if (!(v > 0)) { toast(form.type === 'solar' ? t('Enter the new capacity in kWp.') : form.type === 'fuel_switch' ? t('Enter the diesel no longer burned a year.') : t('Enter the electricity saved a year.')); return; }
    setAdding(true);
    try {
      const r = await smeApi.addCredit(form.type === 'solar' ? { type: 'solar', capacityKw: v } : form.type === 'fuel_switch' ? { type: 'fuel_switch', litresPerYear: v } : { type: form.type, kwhPerYear: v });
      setForm({ type: form.type, kw: '', kwh: '' });
      await load();
      toast(`Submitted: about ${f1(r.tco2ePerYear)} tCO₂e a year. EKOTRACE reviews it before it joins the pool.`);
    } catch (e2) { toast((e2 as Error).message); }
    setAdding(false);
  };

  return (
    <>
      <SmeHead lede={t('One factory\'s project is too small to register for carbon credits on its own. EKOTRACE pools projects across many SMEs, shares the cost of registration and shares the revenue.')}>
        {d.company.isExample && <Sample />}
      </SmeHead>
      <Kpis>
        <Kpi label={t('Your credits')} value={has ? f0(c.tco2e) : '—'} unit={t('tCO₂e a year (estimate)')} />
        <Kpi label={t('Your revenue')} value={has ? lakh(c.mine) : '—'} unit={t('a year, after the pool\'s share')} good={has && c.mine > 0} />
        <Kpi label={t('Credit price')} value={`₹${f0(c.price)}`} unit="per tCO₂e" />
        <Kpi label={t('Pool size')} value={f0(c.pool)} unit={`tCO₂e a year, target ${f0(c.viableAt)}`} />
      </Kpis>

      <div className="card">
        <div className="sv-h2row"><h2>{t('Pool progress')}</h2><span className="muted small">{viable ? t('Large enough to register') : `${f0(c.viableAt - c.pool)} tCO₂e a year still needed`}</span></div>
        <div className="sv-meter" style={{ marginTop: 10 }} role="img" aria-label={`Pool ${f0(c.pool)} of ${f0(c.viableAt)} tCO₂e a year`}>
          <b style={{ width: `${(c.poolOthers / tot) * 100}%` }} /><b style={{ width: `${(c.tco2e / tot) * 100}%` }} />
        </div>
        <div className="sme-legend"><span><i style={{ background: 'var(--s1)' }} />{t('Other members')} <b className="num">{f0(c.poolOthers)} t</b></span><span><i style={{ background: 'var(--s2)' }} />{t('Yours')} <b className="num">{f0(c.tco2e)} t</b></span><span><i style={{ background: 'var(--line)' }} />{t('Still needed')} <b className="num">{f0(Math.max(0, c.viableAt - c.pool))} t</b></span></div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>{t(viable ? 'The pool has reached {n} tCO₂e a year, enough to pay for one shared validation and verification.' : 'Registration becomes worthwhile at {n} tCO₂e a year, when one shared validation and verification is spread across enough projects.', { n: f0(c.viableAt) })}</p>
      </div>

      <div className="sme-grid2">
        <div className="card">
          <h2>{t('Estimate your credits')}</h2>
          <p className="sv-sub">{t('One credit is one tonne of CO₂ avoided. Only new projects count, not solar or savings you already have.')}</p>
          <div className="sme-fields" style={{ marginTop: 6 }}>
            <Num path="credits.newSolarKw" label={t('New solar capacity')} hint={`Makes about ${f0(c.solarGen)} kWh a year`} unit="kWp" />
            <Num path="credits.effKwh" label={t('Electricity saved by efficiency')} hint={t('From meter readings before and after')} unit="kWh/yr" />
            <Num path="credits.price" label={t('Credit price')} hint={dflt('price', P.price_inr, 'What a buyer pays per credit.')} unit="₹/t" placeholder={P.price_inr !== undefined ? String(P.price_inr) : undefined} />
            <Num path="credits.share" label={t('Pool\'s share')} hint={dflt('share', P.management_share_pct, 'Covers registration, verification and sale.')} unit="%" placeholder={P.management_share_pct !== undefined ? String(P.management_share_pct) : undefined} />
          </div>
          <table className="sme-tbl sv-k2" style={{ marginTop: 10 }}><tbody>
            <tr><td>{t('Credits a year')}</td><td>{f1(c.tco2e)} tCO₂e</td></tr>
            <tr><td>{t('Sold at ₹{p} each', { p: f0(c.price) })}</td><td>{lakh(c.gross)}</td></tr>
            <tr><td>{t('Less pool’s share ({pct}%)', { pct: f0(c.share) })}</td><td>−{lakh(c.gross - c.mine)}</td></tr>
            <tr className="tot"><td>{t('Yours a year')}</td><td>{lakh(c.mine)}</td></tr>
          </tbody></table>
          {!has && <p className="muted small" style={{ marginBottom: 0 }}>{tn('Planning solar? {link}, then enter the capacity here.', { link: <Link to="/sme/solar">{t('Size it first')}</Link> })}</p>}
        </div>

        <div className="card">
          <h2>{t('How the pool works')}</h2>
          <ol className="sv-steps" style={{ marginTop: 10 }}>
            <li><span><b>{t('You add a project and its meter data')}</b><small>{t('Rooftop solar, efficiency or fuel switch')}</small></span></li>
            <li><span><b>{t('Projects are bundled into one programme')}</b><small>{t('India\'s CCTS offset mechanism, or a voluntary standard')}</small></span></li>
            <li><span><b>{t('One validation and verification for all')}</b><small>{t('The cost is shared, which makes small projects worthwhile')}</small></span></li>
            <li><span><b>{t('Credits are sold and revenue shared yearly')}</b><small>{t('You keep {pct}% at the pool’s standard terms', { pct: f0(100 - n(P.management_share_pct)) })}</small></span></li>
          </ol>
          <table className="sme-tbl sv-k2" style={{ marginTop: 14 }}><tbody>
            <tr><td>{t('Standard credit price')}</td><td>₹{f0(P.price_inr)} {t('per tCO₂e')}</td></tr>
            <tr><td>{t('Pool\'s share')}</td><td>{f0(P.management_share_pct)}%</td></tr>
            <tr><td>{t('Registration target')}</td><td>{f0(P.viable_at_tco2e)} {t('tCO₂e a year')}</td></tr>
          </tbody></table>
          <p className="muted small" style={{ margin: '10px 0 0' }}>{t(P.note)} {t('Eligibility depends on the methodology being approved and the project being additional. Prices are indicative.')}</p>
        </div>
      </div>

      <div className="sme-grid2">
        <div className="card">
          <h2>{t('Submit a project to the pool')}</h2>
          {d.canManage ? (
            <form className="sv-form" onSubmit={add}>
              <div className="seg" role="group" aria-label={t('Project type')}>{TYPES.map(([v, l]) => <button key={v} type="button" className={form.type === v ? 'on' : ''} aria-pressed={form.type === v} onClick={() => setForm({ ...form, type: v })}>{t(l)}</button>)}</div>
              <p className="muted small" style={{ margin: 0 }}>{TYPES.find((y) => y[0] === form.type)?.[2]}</p>
              {form.type === 'solar'
                ? <label className="l">{t('New capacity')}<small>{t('kWp installed')}</small><input className="input num" type="number" min={0} step="any" inputMode="decimal" value={form.kw} onChange={(e) => setForm({ ...form, kw: e.target.value })} /></label>
                : <label className="l">{form.type === 'efficiency' ? t('Electricity saved') : t('Diesel no longer burned')}<small>{form.type === 'efficiency' ? t('kWh a year, from meter readings before and after') : t('litres a year, from fuel purchase records before and after')}</small><input className="input num" type="number" min={0} step="any" inputMode="decimal" value={form.kwh} onChange={(e) => setForm({ ...form, kwh: e.target.value })} /></label>}
              <div className="row"><button className="btn p" type="submit" disabled={adding}>{adding ? t('Submitting…') : t('Submit to the pool')}</button></div>
            </form>
          ) : <p className="muted">{t('Only a company admin can submit projects to the pool.')}</p>}
        </div>

        <div className="card">
          <div className="sv-h2row"><h2>{t('Your projects')}</h2>{submitted > 0 && <span className="muted small">{t('{n} tCO₂e a year submitted', { n: f1(submitted) })}</span>}</div>
          {err && <p className="note bad" style={{ marginTop: 8 }}>{err}</p>}
          <div className="sme-scroll" style={{ marginTop: 8 }}>
            <table className="sme-tbl">
              <thead><tr><th>{t('Project')}</th><th className="r">{t('tCO₂e/yr')}</th><th>{t('Status')}</th></tr></thead>
              <tbody>
                {(items ?? []).map((p) => {
                  const [label, kind, help] = PSTATUS[p.status] ?? [p.status, 'watch', ''];
                  return (
                    <tr key={p.id}>
                      <td><b>{p.type === 'solar' ? `Solar ${f1(p.capacity_kw)} kWp` : p.type === 'efficiency' ? t('Energy efficiency') : t('Fuel switch')}</b><br />
                        <span className="muted small">{p.kwh_per_year != null ? `${f0(p.kwh_per_year)} kWh a year · ` : ''}{dmy(p.created_at)}{p.created_name ? ` · ${p.created_name}` : ''}</span></td>
                      <td className="r">{f1(p.tco2e_per_year)}</td>
                      <td><Pill kind={kind}>{label}</Pill><br /><span className="muted small">{help}</span></td>
                    </tr>);
                })}
                {items && !items.length && <tr><td colSpan={3} className="muted">{t('No projects yet. Submitted projects are reviewed by EKOTRACE before they join the pool.')}</td></tr>}
                {!items && <tr><td colSpan={3} className="muted">{t('Loading…')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>);
}
