/** Carbon credits: an estimate from new solar and efficiency, the pool's terms, and projects submitted to the EKOTRACE pool. */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import './save.css';
import { useApp } from '../../App';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Sample, SmeHead } from './ui';
import { dmy, f0, f1, lakh, n, smeApi, type SmeCredit } from '../../lib/sme';

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

  if (!d) return <div className="card empty">Loading…</div>;
  const c = d.results.credits as { tco2e: number; mine: number; gross: number; price: number; share: number; pool: number; poolOthers: number; viableAt: number; solarGen: number };
  const P = (d.config.credit_pool ?? {}) as { price_inr?: number; management_share_pct?: number; pool_tco2e_others?: number; viable_at_tco2e?: number; note?: string };
  const dflt = (k: string, v: number | undefined, base: string) => { const x = get(`credits.${k}`); return (x === undefined || x === null || x === '') && v !== undefined ? `${base} Empty: using the pool rate ${f0(v)}.` : base; };
  const has = n(get('credits.newSolarKw')) > 0 || n(get('credits.effKwh')) > 0;
  const viable = c.pool >= c.viableAt, tot = Math.max(c.pool, c.viableAt, 1);
  const submitted = (items ?? []).filter((x) => x.status !== 'rejected').reduce((a, x) => a + n(x.tco2e_per_year), 0);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = Number(form.type === 'solar' ? form.kw : form.kwh);
    if (!(v > 0)) { toast(form.type === 'solar' ? 'Enter the new capacity in kWp.' : 'Enter the electricity saved a year.'); return; }
    setAdding(true);
    try {
      const r = await smeApi.addCredit(form.type === 'solar' ? { type: 'solar', capacityKw: v } : { type: form.type, kwhPerYear: v });
      setForm({ type: form.type, kw: '', kwh: '' });
      await load();
      toast(`Submitted: about ${f1(r.tco2ePerYear)} tCO₂e a year. EKOTRACE reviews it before it joins the pool.`);
    } catch (e2) { toast((e2 as Error).message); }
    setAdding(false);
  };

  return (
    <>
      <SmeHead lede="One factory's project is too small to register for carbon credits on its own. EKOTRACE pools projects across many SMEs, shares the cost of registration and shares the revenue.">
        {d.company.isExample && <Sample />}
      </SmeHead>
      <Kpis>
        <Kpi label="Your credits" value={has ? f0(c.tco2e) : '—'} unit="tCO₂e a year (estimate)" />
        <Kpi label="Your revenue" value={has ? lakh(c.mine) : '—'} unit="a year, after the pool's share" good={has && c.mine > 0} />
        <Kpi label="Credit price" value={`₹${f0(c.price)}`} unit="per tCO₂e" />
        <Kpi label="Pool size" value={f0(c.pool)} unit={`tCO₂e a year, target ${f0(c.viableAt)}`} />
      </Kpis>

      <div className="card">
        <div className="sv-h2row"><h2>Pool progress</h2><span className="muted small">{viable ? 'Large enough to register' : `${f0(c.viableAt - c.pool)} tCO₂e a year still needed`}</span></div>
        <div className="sv-meter" style={{ marginTop: 10 }} role="img" aria-label={`Pool ${f0(c.pool)} of ${f0(c.viableAt)} tCO₂e a year`}>
          <b style={{ width: `${(c.poolOthers / tot) * 100}%` }} /><b style={{ width: `${(c.tco2e / tot) * 100}%` }} />
        </div>
        <div className="sme-legend"><span><i style={{ background: 'var(--s1)' }} />Other members <b className="num">{f0(c.poolOthers)} t</b></span><span><i style={{ background: 'var(--s2)' }} />Yours <b className="num">{f0(c.tco2e)} t</b></span><span><i style={{ background: 'var(--line)' }} />Still needed <b className="num">{f0(Math.max(0, c.viableAt - c.pool))} t</b></span></div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>{viable ? `The pool has reached ${f0(c.viableAt)} tCO₂e a year, enough to pay for one shared validation and verification.` : `Registration becomes worthwhile at ${f0(c.viableAt)} tCO₂e a year, when one shared validation and verification is spread across enough projects.`}</p>
      </div>

      <div className="sme-grid2">
        <div className="card">
          <h2>Estimate your credits</h2>
          <p className="sv-sub">One credit is one tonne of CO₂ avoided. Only new projects count, not solar or savings you already have.</p>
          <div className="sme-fields" style={{ marginTop: 6 }}>
            <Num path="credits.newSolarKw" label="New solar capacity" hint={`Makes about ${f0(c.solarGen)} kWh a year`} unit="kWp" />
            <Num path="credits.effKwh" label="Electricity saved by efficiency" hint="From meter readings before and after" unit="kWh/yr" />
            <Num path="credits.price" label="Credit price" hint={dflt('price', P.price_inr, 'What a buyer pays per credit.')} unit="₹/t" placeholder={P.price_inr !== undefined ? String(P.price_inr) : undefined} />
            <Num path="credits.share" label="Pool's share" hint={dflt('share', P.management_share_pct, 'Covers registration, verification and sale.')} unit="%" placeholder={P.management_share_pct !== undefined ? String(P.management_share_pct) : undefined} />
          </div>
          <table className="sme-tbl sv-k2" style={{ marginTop: 10 }}><tbody>
            <tr><td>Credits a year</td><td>{f1(c.tco2e)} tCO₂e</td></tr>
            <tr><td>Sold at ₹{f0(c.price)} each</td><td>{lakh(c.gross)}</td></tr>
            <tr><td>Less pool's share ({f0(c.share)}%)</td><td>−{lakh(c.gross - c.mine)}</td></tr>
            <tr className="tot"><td>Yours a year</td><td>{lakh(c.mine)}</td></tr>
          </tbody></table>
          {!has && <p className="muted small" style={{ marginBottom: 0 }}>Planning solar? <Link to="/sme/solar">Size it first</Link>, then enter the capacity here.</p>}
        </div>

        <div className="card">
          <h2>How the pool works</h2>
          <ol className="sv-steps" style={{ marginTop: 10 }}>
            <li><span><b>You add a project and its meter data</b><small>Rooftop solar, efficiency or fuel switch</small></span></li>
            <li><span><b>Projects are bundled into one programme</b><small>India's CCTS offset mechanism, or a voluntary standard</small></span></li>
            <li><span><b>One validation and verification for all</b><small>The cost is shared, which makes small projects worthwhile</small></span></li>
            <li><span><b>Credits are sold and revenue shared yearly</b><small>You keep {f0(100 - n(P.management_share_pct))}% at the pool's standard terms</small></span></li>
          </ol>
          <table className="sme-tbl sv-k2" style={{ marginTop: 14 }}><tbody>
            <tr><td>Standard credit price</td><td>₹{f0(P.price_inr)} per tCO₂e</td></tr>
            <tr><td>Pool's share</td><td>{f0(P.management_share_pct)}%</td></tr>
            <tr><td>Registration target</td><td>{f0(P.viable_at_tco2e)} tCO₂e a year</td></tr>
          </tbody></table>
          <p className="muted small" style={{ margin: '10px 0 0' }}>{P.note ?? ''} Eligibility depends on the methodology being approved and the project being additional. Prices are indicative.</p>
        </div>
      </div>

      <div className="sme-grid2">
        <div className="card">
          <h2>Submit a project to the pool</h2>
          {d.canManage ? (
            <form className="sv-form" onSubmit={add}>
              <div className="seg" role="group" aria-label="Project type">{TYPES.map(([v, t]) => <button key={v} type="button" className={form.type === v ? 'on' : ''} aria-pressed={form.type === v} onClick={() => setForm({ ...form, type: v })}>{t}</button>)}</div>
              <p className="muted small" style={{ margin: 0 }}>{TYPES.find((t) => t[0] === form.type)?.[2]}</p>
              {form.type === 'solar'
                ? <label className="l">New capacity<small>kWp installed</small><input className="input num" type="number" min={0} step="any" inputMode="decimal" value={form.kw} onChange={(e) => setForm({ ...form, kw: e.target.value })} /></label>
                : <label className="l">{form.type === 'efficiency' ? 'Electricity saved' : 'Energy switched'}<small>kWh a year, from meter readings before and after</small><input className="input num" type="number" min={0} step="any" inputMode="decimal" value={form.kwh} onChange={(e) => setForm({ ...form, kwh: e.target.value })} /></label>}
              <div className="row"><button className="btn p" type="submit" disabled={adding}>{adding ? 'Submitting…' : 'Submit to the pool'}</button></div>
            </form>
          ) : <p className="muted">Only a company admin can submit projects to the pool.</p>}
        </div>

        <div className="card">
          <div className="sv-h2row"><h2>Your projects</h2>{submitted > 0 && <span className="muted small">{f1(submitted)} tCO₂e a year submitted</span>}</div>
          {err && <p className="note bad" style={{ marginTop: 8 }}>{err}</p>}
          <div className="sme-scroll" style={{ marginTop: 8 }}>
            <table className="sme-tbl">
              <thead><tr><th>Project</th><th className="r">tCO₂e/yr</th><th>Status</th></tr></thead>
              <tbody>
                {(items ?? []).map((p) => {
                  const [label, kind, help] = PSTATUS[p.status] ?? [p.status, 'watch', ''];
                  return (
                    <tr key={p.id}>
                      <td><b>{p.type === 'solar' ? `Solar ${f1(p.capacity_kw)} kWp` : p.type === 'efficiency' ? 'Energy efficiency' : 'Fuel switch'}</b><br />
                        <span className="muted small">{f0(p.kwh_per_year)} kWh a year · {dmy(p.created_at)}{p.created_name ? ` · ${p.created_name}` : ''}</span></td>
                      <td className="r">{f1(p.tco2e_per_year)}</td>
                      <td><Pill kind={kind}>{label}</Pill><br /><span className="muted small">{help}</span></td>
                    </tr>);
                })}
                {items && !items.length && <tr><td colSpan={3} className="muted">No projects yet. Submitted projects are reviewed by EKOTRACE before they join the pool.</td></tr>}
                {!items && <tr><td colSpan={3} className="muted">Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>);
}
