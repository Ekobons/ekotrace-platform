/**
 * Emissions: each source as one row (yearly total, where the figure comes from, proof), entered month
 * by month (April–March) or as one yearly figure; per plant when the company has several; this year
 * against last year; Scope 2 both location-based and market-based (green power bought).
 * All tCO₂e figures come from the server; this screen only edits quantities.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSme } from './store';
import { Kpi, Kpis, Sample, SmeHead } from './ui';
import { Evidence } from './Evidence';
import { f0, f1, f2, n } from '../../lib/sme';
import { MONTHS, change, explicitMode, monthsArr, monthsFilled, plantValue, site, sitesOf, unsplit } from './emisData';
import './emis.css';
import { t, tn } from './i18n';

type Factor = { label: string; unit: string; scope: number; category: string | null; factor: number; source: string | null };
type Row = { key: string; label: string; unit: string; scope: number; category: string | null; quantity: number; tco2e: number; quality: 'measured' | 'estimated' | 'missing' | 'unused'; months: number | null; partial: boolean; priorQuantity: number | null; priorTco2e: number | null };
type PlantR = { id: string; name: string; listed: boolean; city: string; state: string; s1: number; s2: number; s3: number; total: number; s2Market: number; quantities?: Record<string, number>; bySource?: Record<string, number> };

const GROUPS = [
  { scope: 1, title: 'Fuels & refrigerants', note: 'Scope 1: fuel you burn on site and in your own vehicles, and refrigerant topped up in ACs and chillers.' },
  { scope: 2, title: 'Electricity', note: 'Scope 2: electricity you buy from the grid. Rooftop solar you generate and use adds nothing.' },
  { scope: 3, title: 'Value chain', note: 'Scope 3, optional: materials you buy (Cat 1), inbound freight (Cat 4) and business travel (Cat 6). Add only what your buyers ask for.' },
];
const HINT: Record<string, string> = {
  diesel: 'Fuel invoices or DG set log', petrol: 'Fuel bills or card statements', lpg: 'Cylinder invoices (19 or 47.5 kg)', png: 'Gas bills (standard cubic metres)', coal: 'Purchase invoices',
  refrig: 'AC service reports (kg topped up)', grid: 'Units billed on DISCOM bills', solar: 'Inverter or generation meter reading',
  steel: 'Purchase invoices', alu: 'Purchase invoices', cement: 'Purchase invoices', plastic: 'Purchase invoices', road: 'Tonnes × km from transporters', air: 'Passenger km from travel bookings', rail: 'Passenger km from travel bookings',
};
const GREEN_TYPES: [string, string][] = [['', 'Choose how you buy it…'], ['open_access', 'Open access (green energy open access)'], ['green_tariff', 'Green tariff from your DISCOM'], ['irec', 'Renewable energy certificates (I-RECs / RECs)'], ['ppa', 'Captive / group captive or PPA'], ['mixed', 'More than one of these']];
const ORDER = ['diesel', 'petrol', 'lpg', 'png', 'coal', 'refrig', 'grid', 'solar', 'steel', 'alu', 'cement', 'plastic', 'road', 'air', 'rail'];
const byOrder = (a: string, b: string) => (ORDER.indexOf(a) < 0 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) < 0 ? 99 : ORDER.indexOf(b));
const fyShort = (fy?: string | null) => (fy ? fy.replace(/^FY (\d{4})-(\d{2})$/, 'FY $1-$2') : t('last year'));

export function SmeEmissions() {
  const { d, get, set, setModule } = useSme();
  const [plantSel, setPlant] = useState('main');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showS3, setShowS3] = useState(false);
  if (!d) return <div className="card empty">{t('Loading…')}</div>;

  const F = d.config.factors.items as Record<string, Factor>;
  const KEYS = [...Object.keys(F), 'green'];
  const r = d.results.emissions as any;
  const rows = (r.rows ?? []) as Row[];
  const em = get('emissions') ?? {};
  const listed = (Array.isArray(get('profile.plants')) ? get('profile.plants') : []) as { id: string; name: string }[];
  const plants = listed.some((p) => p.id === 'main') ? listed : [{ id: 'main', name: t('Main plant') }, ...listed];
  const multi = plants.length > 1;
  const plant = plants.some((p) => p.id === plantSel) ? plantSel : 'main';
  const plantR = ((r.plants ?? []) as PlantR[]);
  const prior = r.prior as null | { fy: string | null; bySource: boolean; total: number; s1?: number; s2?: number; s3?: number; s2Market?: number };
  const can = d.canEdit;
  const update = (fn: (next: any) => void) => setModule('emissions', change(em, KEYS, fn));
  const scopeT = (s: number) => (s === 1 ? r.s1 : s === 2 ? r.s2 : r.s3) as number;
  const priorScope = (s: number) => (prior?.bySource ? (s === 1 ? prior.s1 : s === 2 ? prior.s2 : prior.s3) ?? null : null);
  const plantName = (id: string) => plants.find((p) => p.id === id)?.name ?? t('Main plant');
  const has = r.withS3 > 0;
  const q = r.quality ?? { measuredPct: 0, estimated: [], missing: [], partial: [], measuredT: 0, estimatedT: 0 };
  const name = (k: string) => (k === 'green' ? t('Renewable electricity bought') : t(F[k]?.label ?? k));
  const s3Has = rows.some((x) => x.scope === 3 && (x.quantity > 0 || (x.priorQuantity ?? 0) > 0));

  const rowFor = (k: string, scope: number) => {
    const res = rows.find((x) => x.key === k);
    const unit = k === 'green' ? 'kWh' : F[k]!.unit;
    const s = sitesOf(em)[plant];
    const value = plantValue(em, plant, k);
    const filledM = monthsFilled(s, k);
    const mode = explicitMode(s, k) ?? (filledM > 0 ? 'month' : value > 0 || scope === 3 ? 'year' : 'month');
    const id = `${plant}:${k}`, isOpen = !!open[id];
    const qual = (s?.quality ?? {})[k] as string | undefined;
    const extra = plant === 'main' ? unsplit(em, k) : 0;
    const tco = multi ? plantR.find((p) => p.id === plant)?.bySource?.[k] ?? 0 : res?.tco2e ?? 0;
    const pq = res?.priorQuantity ?? null;
    const setYear = (v: number | '') => update((nx) => { const x = site(nx, plant); x.mode[k] = 'year'; x.year[k] = v; });
    const setMonth = (i: number, v: number | '') => update((nx) => { const x = site(nx, plant); const a = monthsArr(x, k); a[i] = v; x.months[k] = a; x.mode[k] = 'month'; });
    const setMode = (m: 'month' | 'year') => update((nx) => { site(nx, plant).mode[k] = m; });
    const setQual = (v: string) => update((nx) => { const x = site(nx, plant); if (v) x.quality[k] = v; else delete x.quality[k]; });
    const pr = plantR.find((p) => p.id === plant);
    const greenT = multi ? n(pr?.s2) - n(pr?.s2Market) : n(r.s2) - n(r.s2Market);
    const evItem = plant === 'main' ? k : `${k}@${plant}`;
    return (
      <div className={`em-row${isOpen ? ' open' : ''}`} key={id}>
        <div className="em-name">
          <b>{name(k)}</b>
          <small>{k === 'green' ? t('Open access, green tariff or I-RECs. Already part of your grid units above.') : t(HINT[k] ?? F[k]!.source ?? '')}</small>
        </div>
        <div className="em-val">
          {mode === 'year'
            ? <NumIn label={t('{name}, yearly total', { name: name(k) })} value={value || (s?.year?.[k] === 0 ? 0 : '')} unit={unit} disabled={!can} onChange={setYear} />
            : <button type="button" className="em-sum" onClick={() => setOpen({ ...open, [id]: !isOpen })} aria-expanded={isOpen}>
                <span className="num">{value > 0 ? f0(value) : '—'}</span><small>{unit}</small>
              </button>}
          <span className="em-modehint">{mode === 'month' ? (filledM ? t('{n} of 12 months', { n: filledM }) : t('By month')) : t('Yearly total')}</span>
        </div>
        <div className="em-t">
          {k === 'green' ? <span className="muted small">{value > 0 ? `−${f2(greenT)} ${t('t market-based')}` : ''}</span>
            : <><b className="num">{tco > 0 ? f2(tco) : '—'}</b><small>tCO₂e</small></>}
          {!multi && pq !== null && k !== 'green' && <Trend now={res?.quantity ?? 0} before={pq} unit={unit} fy={prior?.fy} />}
        </div>
        <div className="em-q">
          {value > 0
            ? <select className={`input em-qsel ${qual === 'estimate' ? 'est' : 'ok'}`} aria-label={t('Where the {name} figure comes from', { name: name(k) })} disabled={!can} value={qual === 'estimate' ? 'estimate' : 'bills'} onChange={(e) => setQual(e.target.value === 'bills' ? '' : e.target.value)}>
                <option value="bills">{t('From bills')}</option><option value="estimate">{t('Estimate')}</option>
              </select>
            : <select className={`input em-qsel ${qual === 'none' ? 'none' : 'miss'}`} aria-label={t('{name}: not filled in or not used', { name: name(k) })} disabled={!can} value={qual === 'none' ? 'none' : ''} onChange={(e) => setQual(e.target.value)}>
                <option value="">{scope === 3 ? t('Optional') : t('Not filled in')}</option><option value="none">{t('We don’t use this')}</option>
              </select>}
        </div>
        <div className="em-more">
          <button type="button" className="btn sm ghost" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [id]: !isOpen })}>{isOpen ? t('Close') : mode === 'month' ? t('Months') : t('By month')}</button>
        </div>
        {extra > 0 && <p className="em-extra">{t('Includes {q} {unit} added from a read bill or an earlier yearly figure, not split by month.', { q: f0(extra), unit })}</p>}
        {(isOpen || value > 0) && <div className="em-ev"><Evidence module="emissions" item={evItem} label={multi ? `${t('Bills')} · ${plantName(plant)}` : 'Bills'} /></div>}
        {isOpen && (
          <div className="em-panel">
            <label className="em-switch">
              <span className="sme-sw"><input type="checkbox" disabled={!can} checked={mode === 'year'} onChange={(e) => setMode(e.target.checked ? 'year' : 'month')} /><i /></span>
              <span>{t('One yearly total only')}<small>{mode === 'year' ? t('Switch off to enter each month from April to March.') : t('Switch on if you only have one figure for the year.')}</small></span>
            </label>
            {mode === 'month' && <>
              <div className="em-months">
                {MONTHS.map((m, i) => <NumIn key={m} label={`${name(k)}, ${t(m)}`} caption={t(m)} value={monthsArr(s, k)[i]} disabled={!can} onChange={(v) => setMonth(i, v)} />)}
              </div>
              <p className="em-psum">{t('Year:')} <b className="num">{f0(value)} {unit}</b>{filledM > 0 && filledM < 12 && <> · {t(12 - filledM === 1 ? '{n} month still empty' : '{n} months still empty', { n: 12 - filledM })}</>}</p>
              {n(s?.year?.[k]) > 0 && filledM === 0 && <p className="muted small">{t('Your earlier yearly figure ({q} {unit}) is set aside while you enter months. Switch back to use it.', { q: f0(s.year[k]), unit })}</p>}
            </>}
            {mode === 'year' && <p className="muted small">{t('The yearly figure is used as it is. Months give a truer picture and show gaps.')}</p>}
          </div>)}
      </div>);
  };

  const group = (g: (typeof GROUPS)[number]) => {
    const keys = Object.keys(F).filter((k) => F[k]!.scope === g.scope).sort(byOrder);
    const ps = priorScope(g.scope);
    const folded = g.scope === 3 && !s3Has && !showS3;
    return (
      <section className="card em-group" key={g.title} style={{ ['--sc' as any]: `var(--s${g.scope})` }}>
        <div className="em-gh">
          <div className="grow"><h2>{t(g.title)}</h2><p className="muted">{t(g.note)}</p></div>
          <div className="em-gt"><b className="num">{f1(multi ? plantR.find((p) => p.id === plant)?.[g.scope === 1 ? 's1' : g.scope === 2 ? 's2' : 's3'] ?? 0 : scopeT(g.scope))}</b><small>tCO₂e{multi ? ` · ${plantName(plant)}` : ''}</small>
            {!multi && ps !== null && ps > 0 && <small>{fyShort(prior?.fy)}: {f1(ps)} t</small>}</div>
        </div>
        {folded
          ? <div className="em-fold"><span className="muted">{t('Only if a buyer asks for it.')}</span>{can && <button type="button" className="btn sm" onClick={() => setShowS3(true)}>{t('Add value chain figures')}</button>}</div>
          : <div className="em-rows">{keys.map((k) => rowFor(k, g.scope))}{g.scope === 2 && rowFor('green', 2)}</div>}
        {g.scope === 2 && <Dual r={r} green={n(r.greenKwh)} can={can} type={get('emissions.greenType') ?? ''} setType={(v) => set('emissions.greenType', v)} />}
      </section>);
  };

  const qbar = r.total > 0 ? [Math.max(0, Math.min(100, q.measuredPct)), Math.max(0, Math.min(100, (q.estimatedT / r.total) * 100))] : [0, 0];
  return (
    <>
      <SmeHead lede={t('Enter fuel, power and materials from your bills, month by month or as a yearly total. We work out the scope and the tonnes of CO₂e.')}><Link className="btn" to="/sme/scan">{t('Read a bill')}</Link></SmeHead>
      <Kpis>
        <Kpi label={t('Scope 1 + 2')} value={has ? f1(r.total) : '—'} unit={<>tCO₂e{d.company.isExample && <Sample />}{prior && prior.total > 0 && r.change !== null && <><br /><ChangeTxt pct={r.change} fy={prior.fy} /></>}</>} />
        <Kpi label={t('Scope 1')} value={f1(r.s1)} unit={t('tCO₂e · fuels')} />
        <Kpi label={t('Scope 2')} value={f1(r.s2)} unit={n(r.greenKwh) > 0 ? <>{t('location-based')} · {t('market-based')} {f1(r.s2Market)}</> : t('tCO₂e · electricity')} />
        <Kpi label={t('Scope 3')} value={f1(r.s3)} unit={t('tCO₂e · optional')} />
        <Kpi label={t('Intensity')} value={f1(r.intensity)} unit={t('tCO₂e per ₹ crore of turnover')} />
      </Kpis>

      <div className="sme-grid2">
        <section className="card">
          <h2>{t('How good is the data')}</h2>
          {!has
            ? <p className="muted" style={{ marginTop: 8 }}>{t('Nothing entered yet. Start with your electricity bills and diesel invoices below; they are most of a small factory’s footprint.')}</p>
            : <>
              <div className="em-qbar" aria-hidden="true"><b style={{ width: `${qbar[0]}%` }} /><b className="est" style={{ width: `${qbar[1]}%` }} /></div>
              <div className="sme-legend"><span><i style={{ background: 'var(--ok)' }} />{t('From bills')} <b className="num">{f0(q.measuredPct)}%</b></span><span><i style={{ background: '#D9A441' }} />{t('Estimated')} <b className="num">{f0(r.total > 0 ? (q.estimatedT / r.total) * 100 : 0)}%</b></span><span>{t('of Scope 1 + 2')}</span></div>
              <ul className="em-qlist">
                {q.estimated.length > 0 && <li><span className="chip warn">{t('Estimated')}</span> {q.estimated.map(name).join(', ')}. {t('Replace with bill figures when you can.')}</li>}
                {q.partial.length > 0 && <li><span className="chip info">{t('Part year')}</span> {q.partial.map((k: string) => `${name(k)} (${t('{n} of 12 months', { n: rows.find((x) => x.key === k)?.months ?? 0 })})`).join(', ')}.</li>}
                {q.missing.length > 0 && <li><span className="chip grey">{t('Not filled in')}</span> {q.missing.map(name).join(', ')}. {t('Enter a figure, or mark it “We don’t use this”.')}</li>}
                {!q.estimated.length && !q.partial.length && !q.missing.length && <li><span className="chip">{t('Complete')}</span> {t('Every Scope 1 and 2 source is filled in from bills or marked as not used.')}</li>}
              </ul>
              <p className="muted small">{t('Attach the bills to each source as proof. A buyer, bank or CA checking your figures will ask for them.')}</p>
            </>}
        </section>
        {multi
          ? <PlantSplit plants={plantR} total={r.total} />
          : <section className="card">
              <h2>{t('This year and last year')}</h2>
              {prior && prior.total > 0
                ? <YearTable r={r} rows={rows} prior={prior} />
                : <p className="muted" style={{ marginTop: 8 }}>{tn('No figures for last year yet. Choose the earlier year in {link} and enter its totals to see the change here. Buyers and the ICAI SRMM look for the trend.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</p>}
              <p className="muted small" style={{ marginTop: 10 }}>{tn('One site? If you have more than one plant, list them in {link} and enter figures for each.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</p>
            </section>}
      </div>

      {multi && (
        <div className="em-plants" role="tablist" aria-label={t('Plant')}>
          <span className="lbl">{t('Figures for')}</span>
          <div className="seg">{plants.map((p) => <button key={p.id} type="button" role="tab" aria-selected={plant === p.id} className={plant === p.id ? 'on' : ''} onClick={() => setPlant(p.id)}>{p.name || t('Unnamed plant')}</button>)}</div>
        </div>)}

      {GROUPS.map(group)}
      {multi && prior && prior.total > 0 && <section className="card"><h2>{t('This year and last year, all plants')}</h2><YearTable r={r} rows={rows} prior={prior} /></section>}
      <p className="muted small">{d.config.factors.note} {t('Factor set {v}. Grid electricity uses the CEA CO₂ baseline factor ({f} kg per kWh).', { v: d.config.factors.version, f: f2(F.grid?.factor) })}</p>
    </>);
}

/** Number input that keeps empty as '' (not 0). */
function NumIn({ label, caption, value, unit, disabled, onChange }: { label: string; caption?: string; value: any; unit?: string; disabled?: boolean; onChange: (v: number | '') => void }) {
  const input = <input className="input num" type="number" inputMode="decimal" step="any" min={0} aria-label={label} disabled={disabled}
    value={value === undefined || value === null ? '' : value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  if (caption) return <label className="em-m"><span>{caption}</span>{input}</label>;
  return <div className="sme-unit">{input}{unit && <span>{unit}</span>}</div>;
}

function ChangeTxt({ pct, fy }: { pct: number; fy: string | null }) {
  if (Math.abs(pct) < 0.5) return <span className="em-chg">{t('about the same as {fy}', { fy: fyShort(fy) })}</span>;
  return <span className={`em-chg ${pct < 0 ? 'down' : 'up'}`}>{pct < 0 ? '▼' : '▲'} {t(pct < 0 ? '{pct}% lower than {fy}' : '{pct}% higher than {fy}', { pct: f0(Math.abs(pct)), fy: fyShort(fy) })}</span>;
}
function Trend({ now, before, unit, fy }: { now: number; before: number; unit: string; fy?: string | null }) {
  if (!(before > 0) && !(now > 0)) return null;
  if (!(before > 0)) return <small className="em-trend">{t('new this year')}</small>;
  const pct = ((now - before) / before) * 100;
  return <small className="em-trend" title={`${fyShort(fy)}: ${f0(before)} ${unit}`}>{fyShort(fy)} {f0(before)} {unit}{Math.abs(pct) >= 0.5 && <b className={pct < 0 ? 'down' : 'up'}> {pct < 0 ? '▼' : '▲'}{f0(Math.abs(pct))}%</b>}</small>;
}

/** Location-based and market-based Scope 2, side by side (GHG Protocol Scope 2 Guidance). */
function Dual({ r, green, can, type, setType }: { r: any; green: number; can: boolean; type: string; setType: (v: string) => void }) {
  return (
    <div className="em-dual">
      <div><span className="lbl">{t('Scope 2, location-based')}</span><b className="num">{f1(r.s2)} t</b><small>{t('Grid units × CEA grid average. Used for your totals.')}</small></div>
      <div><span className="lbl">{t('Scope 2, market-based')}</span><b className="num">{f1(r.s2Market)} t</b><small>{green > 0 ? t('{kwh} kWh of renewable power bought counted as zero; the rest at the grid average (India has no published residual mix).', { kwh: f0(green) }) : t('Same as location-based until you enter renewable power bought.')}</small></div>
      {green > 0 && (
        <label className="em-gtype"><span className="lbl">{t('How you buy it')}</span>
          <select className="input" disabled={!can} value={type} onChange={(e) => setType(e.target.value)}>{GREEN_TYPES.map(([v, o]) => <option key={v} value={v}>{t(o)}</option>)}</select>
          <small className="muted">{t('Keep the open access invoices, green tariff bills or REC redemption statements: market-based figures need them.')}</small>
        </label>)}
    </div>);
}

function YearTable({ r, rows, prior }: { r: any; rows: Row[]; prior: { fy: string | null; bySource: boolean; total: number; s1?: number; s2?: number; s3?: number } }) {
  const line = (label: string, now: number, before: number | null | undefined) => {
    const pct = before && before > 0 ? ((now - before) / before) * 100 : null;
    return <tr key={label}><td>{t(label)}</td><td className="r">{before !== null && before !== undefined ? f1(before) : '—'}</td><td className="r">{f1(now)}</td><td className="r">{pct === null ? '' : <span className={pct < 0 ? 'em-down' : pct > 0 ? 'em-up' : ''}>{pct > 0 ? '+' : ''}{f0(pct)}%</span>}</td></tr>;
  };
  const top = prior.bySource ? rows.filter((x) => x.scope !== 3 && (x.tco2e > 0 || (x.priorTco2e ?? 0) > 0)).sort((a, b) => b.tco2e - a.tco2e).slice(0, 4) : [];
  return (
    <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8 }}>
      <thead><tr><th>tCO₂e</th><th className="r">{fyShort(prior.fy)}</th><th className="r">{t('This year')}</th><th className="r">{t('Change|column')}</th></tr></thead>
      <tbody>
        {prior.bySource && <>{line('Scope 1', r.s1, prior.s1)}{line('Scope 2', r.s2, prior.s2)}</>}
        <tr className="tot"><td>{t('Scope 1 + 2')}</td><td className="r">{f1(prior.total)}</td><td className="r">{f1(r.total)}</td><td className="r">{r.change === null ? '' : `${r.change > 0 ? '+' : ''}${f0(r.change)}%`}</td></tr>
        {top.length > 0 && <tr><td colSpan={4} className="em-sub">{t('Largest sources')}</td></tr>}
        {top.map((x) => line(x.label.replace(/ \(.*\)$/, ''), x.tco2e, x.priorTco2e))}
      </tbody>
    </table>
    {!prior.bySource && <p className="muted small">{t('Only last year’s total is stored. Enter last year’s sources to compare them one by one.')}</p>}
    </div>);
}

function PlantSplit({ plants, total }: { plants: PlantR[]; total: number }) {
  return (
    <section className="card">
      <h2>{t('By plant')}</h2>
      <div className="sme-scroll"><table className="sme-tbl" style={{ marginTop: 8 }}>
        <thead><tr><th>{t('Plant')}</th><th className="r">{t('Scope 1')}</th><th className="r">{t('Scope 2')}</th><th className="r">{t('Scope 1 + 2')}</th><th className="r">{t('Share|portion')}</th></tr></thead>
        <tbody>
          {plants.map((p) => <tr key={p.id}><td>{p.name}{p.city ? <small className="muted"> · {p.city}</small> : null}{!p.listed && <small className="chip warn" style={{ marginLeft: 6 }}>{t('removed')}</small>}</td><td className="r">{f1(p.s1)}</td><td className="r">{f1(p.s2)}</td><td className="r">{f1(p.total)}</td><td className="r">{total > 0 ? `${f0((p.total / total) * 100)}%` : '—'}</td></tr>)}
          <tr className="tot"><td>{t('All plants')}</td><td className="r">{f1(plants.reduce((a, p) => a + p.s1, 0))}</td><td className="r">{f1(plants.reduce((a, p) => a + p.s2, 0))}</td><td className="r">{f1(total)}</td><td className="r">100%</td></tr>
        </tbody>
      </table></div>
      <p className="muted small" style={{ marginTop: 8 }}>{tn('Plants are listed in {link}. Choose a plant below to enter its figures.', { link: <Link to="/sme/profile">{t('Profile')}</Link> })}</p>
    </section>);
}
