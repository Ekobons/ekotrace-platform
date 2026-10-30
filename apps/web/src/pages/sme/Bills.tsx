/**
 * Power bill analyser: up to 12 monthly bills (or one month's bill) → penalties to stop paying, each
 * explained in plain words with its ₹ saving a year. With several months the findings use all of them
 * (months over contract demand, average power factor, penalty actually paid) and savings come from
 * the months entered, scaled to a year.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './save.css';
import './emis.css';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Sample, SmeHead } from './ui';
import { Evidence } from './Evidence';
import { f0, f1, f2, lakh, n, smeApi } from '../../lib/sme';
import { change, site } from './emisData';
import { useApp } from '../../App';
import { t } from './i18n';

const RATES: { k: string; label: string; unit: string; hint?: string }[] = [
  { k: 'energyRate', label: 'Energy charge', unit: '₹/kWh' },
  { k: 'demandRate', label: 'Demand charge', unit: '₹/kVA', hint: 'Per kVA of contract demand, per month' },
  { k: 'excessMult', label: 'Excess demand billed at', unit: '×', hint: 'Times the normal demand charge' },
  { k: 'peakSur', label: 'Peak-hour surcharge', unit: '₹/kWh' },
  { k: 'offRebate', label: 'Off-peak (night) rebate', unit: '₹/kWh' },
];
const ASSUME: { k: string; label: string; unit: string; hint?: string }[] = [
  { k: 'shiftPct', label: 'Peak load you could move', unit: '%', hint: 'Share of peak-hour units that could run at night' },
  { k: 'capCost', label: 'Capacitor cost', unit: '₹/kVAr', hint: 'Installed APFC panel, per kVAr' },
];
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const COLS: { k: string; label: string; unit: string; step?: string }[] = [
  { k: 'units', label: 'Units', unit: 'kWh' },
  { k: 'md', label: 'Max demand', unit: 'kVA' },
  { k: 'cd', label: 'Contract demand', unit: 'kVA' },
  { k: 'pf', label: 'Power factor', unit: '0–1', step: '0.01' },
  { k: 'pfPenalty', label: 'PF penalty', unit: '₹' },
  { k: 'peakShare', label: 'Peak units', unit: '%' },
];
type Finding = { kind: string; code?: string; text: string; action: string; saving: number; capex?: number };

export function SmeBills() {
  const { d, get, set, setModule } = useSme();
  const { toast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanFor, setScanFor] = useState<number | null>(null);
  const [scanning, setScanning] = useState<number | null>(null);
  const [readMonths, setReadMonths] = useState<Record<number, string>>({});
  if (!d) return <div className="card empty">{t('Loading…')}</div>;
  const b = d.results.bills as any, T = (d.config.tariffs ?? {}) as { default?: Record<string, number>; discoms?: any[]; note?: string };
  const def = T.default ?? {}, discoms = (T.discoms ?? []) as { id: string; name: string; state?: string; [k: string]: any }[];
  const year = b.mode === 'year';
  const has = year ? n(b.monthsEntered) > 0 : ['md', 'cd', 'units', 'pfPenalty', 'peakShare'].some((k) => n(get(`bills.${k}`)) > 0);
  const findings = (b.findings ?? []) as Finding[];
  const ph = (k: string) => (def[k] !== undefined ? String(def[k]) : undefined);
  const dflt = (k: string) => { const v = get(`bills.${k}`); return (v === undefined || v === null || v === '') && def[k] !== undefined ? t('Empty: using typical {v}', { v: def[k] }) : undefined; };
  const pickDiscom = (id: string) => {
    set('bills.discom', id);
    const x = discoms.find((t) => t.id === id);
    if (x) for (const r of RATES) if (x[r.k] !== undefined) set(`bills.${r.k}`, x[r.k]);
  };
  const mine = discoms.filter((t) => !t.state || t.state === d.company.state);
  const can = d.canEdit;
  const fyStart = Number(/^FY (\d{4})/.exec(d.fy)?.[1] ?? 0);
  const mLabel = (i: number) => `${t(MONTHS[i]!)} ${String((i < 9 ? fyStart : fyStart + 1) % 100).padStart(2, '0')}`;
  const months = (Array.isArray(get('bills.months')) ? get('bills.months') : []) as any[];
  const cell = (i: number, k: string) => { const v = months[i]?.[k]; return v === undefined || v === null ? '' : v; };
  const setCell = (i: number, k: string, v: number | '') => set(`bills.months.${i}.${k}`, v);
  const unitsByMonth = MONTHS.map((_, i) => n(months[i]?.units));
  const unitsN = unitsByMonth.filter((x) => x > 0).length;

  const scan = async (i: number, f: File | undefined) => {
    if (!f) return;
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { toast(t('Choose the bill as a PDF file.')); return; }
    setScanning(i);
    try {
      const r = await smeApi.scan('electricity', f);
      const F = r.fields, val = (k: string) => (F[k] && F[k]!.value !== null && F[k]!.value !== '' ? Number(F[k]!.value) : null);
      const map: [string, string][] = [['unitsKwh', 'units'], ['maxDemandKva', 'md'], ['contractDemandKva', 'cd'], ['powerFactor', 'pf'], ['pfPenaltyInr', 'pfPenalty']];
      let got = 0;
      for (const [from, to] of map) { const v = val(from); if (v !== null && Number.isFinite(v)) { set(`bills.months.${i}.${to}`, v); got++; } }
      if (got) { setReadMonths({ ...readMonths, [i]: f.name }); toast(`${mLabel(i)}: ${t(got === 1 ? '{n} figure read. Check them against the bill.' : '{n} figures read. Check them against the bill.', { n: got })}`); }
      else toast(t('No figures could be read from this PDF. Type them in instead.'));
    } catch (e) { toast((e as Error).message); }
    setScanning(null);
  };
  const copyToEmissions = () => {
    const em = get('emissions') ?? {}, keys = [...Object.keys(d.config.factors.items ?? {}), 'green'];
    if (n(em.grid) > 0 && !window.confirm(t('Grid electricity in Emissions is {kwh} kWh for {fy}. Replace the main plant’s figure with these {n} months ({total} kWh)?', { kwh: f0(em.grid), fy: d.fy, n: unitsN, total: f0(unitsByMonth.reduce((a, x) => a + x, 0)) }))) return;
    setModule('emissions', change(em, keys, (nx) => { const s = site(nx, 'main'); s.mode.grid = 'month'; s.months.grid = unitsByMonth.map((x) => (x > 0 ? x : '')); }));
    toast(t('Grid electricity in Emissions now uses these months.'));
  };

  return (
    <>
      <SmeHead lede={t('Enter your electricity bills, up to 12 months (or read them from the bill PDFs). We look for penalties you can stop paying and show what each fix saves in a year.')}>
        <Link className="btn" to="/sme/scan">{t('Read a bill PDF')}</Link>
      </SmeHead>

      <div className="bl-mode">
        <span className="lbl">{t('Bills to use')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Bills to use')}>
          <button type="button" role="radio" aria-checked={year} className={year ? 'on' : ''} disabled={!can} onClick={() => set('bills.mode', 'year')}>{t('Up to 12 months')}</button>
          <button type="button" role="radio" aria-checked={!year} className={!year ? 'on' : ''} disabled={!can} onClick={() => set('bills.mode', 'one')}>{t('One month’s bill')}</button>
        </div>
        <span className="muted small">{year ? (has ? t(b.monthsEntered < 12 ? '{n} of 12 months entered; savings are scaled to a year' : '{n} of 12 months entered', { n: b.monthsEntered }) : t('More months give a truer picture than one bill × 12.')) : t('Quick check from a single bill, shown as a yearly figure.')}</span>
      </div>

      {year
        ? <Kpis>
          <Kpi label={t('Savings found')} value={has ? lakh(b.total) : '—'} unit={t('per year')} good={has && b.total > 0} />
          <Kpi label={t('Over contract demand')} value={has ? t('{a} of {b}', { a: b.monthsOver, b: b.monthsEntered }) : '—'} unit={t('months')} />
          <Kpi label={t('Average power factor')} value={has && b.avgPf > 0 ? f2(b.avgPf) : '—'} unit={has && b.minPf > 0 ? t('lowest {v}', { v: f2(b.minPf) }) : t('aim for 0.99')} />
          <Kpi label={t('PF penalty paid')} value={has ? `₹${f0(b.pfPenaltyPaid)}` : '—'} unit={has ? t(b.monthsEntered === 1 ? 'in {n} month' : 'in {n} months', { n: b.monthsEntered }) : ''} />
        </Kpis>
        : <Kpis>
          <Kpi label={t('Savings found')} value={has ? lakh(b.total) : '—'} unit={t('per year')} good={has && b.total > 0} />
          <Kpi label={t('Things to fix')} value={has ? findings.length : '—'} unit={t(findings.length === 1 ? 'finding' : 'findings')} />
          <Kpi label={t('Capacitors needed')} value={b.kvarRounded > 0 && n(b.inputs?.pfPenalty) > 0 ? f0(b.kvarRounded) : '—'} unit="kVAr" />
          <Kpi label={t('Capacitor payback')} value={b.pfPaybackMonths > 0 ? f1(b.pfPaybackMonths) : '—'} unit={t('months')} />
        </Kpis>}

      <div className="card">
        <div className="sv-h2row"><h2>{t('What we found')}{d.company.isExample && <Sample />}</h2>{has && <span className="muted small">{year ? (b.monthsEntered === 12 ? t('From 12 monthly bills') : t(b.monthsEntered === 1 ? 'From {n} monthly bill, scaled to a year' : 'From {n} monthly bills, scaled to a year', { n: b.monthsEntered })) : t('From one month’s bill, shown as a yearly figure')}</span>}</div>
        {!has && <div className="sme-callout" style={{ marginTop: 10 }}>{year ? <>{t('Add your monthly bills in the table below (units, maximum demand, power factor and any penalty) to see what you can save.')}</> : <>{t('Add the figures from your power bill below (contract demand, maximum demand, power factor penalty and units) to see what you can save.')}</>} {t('Or')} <Link to="/sme/scan">{t('read them from a bill PDF')}</Link>.</div>}
        {has && !findings.length && <p className="note ok" style={{ marginTop: 10 }}>{t(year ? 'No penalties in these bills. Maximum demand stayed within contract demand, no power factor penalty was charged, and no peak-hour units are entered.' : 'No penalties on this bill. Your maximum demand is within contract demand, there is no power factor penalty, and no peak-hour units are entered.')}</p>}
        {findings.map((x, i) => <FindingRow key={i} x={x} b={b} />)}
      </div>

      {year && (
        <div className="card">
          <div className="sv-h2row"><h2>{t('Your monthly bills')}</h2><span className="muted small">{t('April to March, {fy}', { fy: d.fy })}</span></div>
          <p className="sv-sub">{t('Copy each month from the first page of the HT bill (“billing details” or “demand”). Leave a month empty if you don’t have it. Contract demand can stay empty when it did not change.')}</p>
          <div className="sme-fields" style={{ maxWidth: 520, marginTop: 6 }}>
            <Num path="bills.cd" label={t('Contract demand')} hint={t('The load agreed with the DISCOM, used for months where it is empty')} unit="kVA" />
          </div>
          <div className="sme-scroll">
            <table className="sme-tbl bl-tbl">
              <thead><tr><th>{t('Month')}</th>{COLS.map((c) => <th key={c.k} className="r">{t(c.label)}<small>{c.unit}</small></th>)}<th className="r"><span className="sr">{t('Read PDF')}</span></th></tr></thead>
              <tbody>
                {MONTHS.map((_, i) => {
                  const m = months[i] ?? {}, cd = n(m.cd) || n(get('bills.cd'));
                  const over = n(m.md) > 0 && cd > 0 && n(m.md) > cd, pen = n(m.pfPenalty) > 0;
                  return (
                    <tr key={i} className={over || pen ? 'flag' : ''}>
                      <td><b>{mLabel(i)}</b>{readMonths[i] && <small className="bl-read" title={readMonths[i]}>{t('read from PDF, check')}</small>}</td>
                      {COLS.map((c) => (
                        <td key={c.k} className="r">
                          <input className={`input num${(c.k === 'md' && over) || (c.k === 'pfPenalty' && pen) ? ' warn' : ''}`} type="number" inputMode="decimal" step={c.step ?? 'any'} min={0} max={c.k === 'pf' ? 1 : c.k === 'peakShare' ? 100 : undefined}
                            aria-label={`${mLabel(i)} ${t(c.label)}`} disabled={!can} placeholder={c.k === 'cd' && n(get('bills.cd')) > 0 ? String(get('bills.cd')) : ''}
                            value={cell(i, c.k)} onChange={(e) => setCell(i, c.k, e.target.value === '' ? '' : Number(e.target.value))} />
                        </td>))}
                      <td className="r">{can && <button type="button" className="btn sm ghost" disabled={scanning !== null} onClick={() => { setScanFor(i); fileRef.current?.click(); }}>{scanning === i ? t('Reading…') : 'PDF'}</button>}</td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
          <input ref={fileRef} type="file" hidden accept=".pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (scanFor !== null) void scan(scanFor, f); }} />
          <p className="muted small" style={{ marginTop: 8 }}>{t('“PDF” reads that month’s bill (a DISCOM download is read at once; a scanned PDF takes up to a minute) and fills the row for you to check. Peak-hour units are not read: take them from the time-of-day (TOD) section.')}</p>
          <div className="bl-foot">
            <Evidence module="bills" item="year" label={t('Bills')} />
            {can && unitsN > 0 && <button type="button" className="btn sm" onClick={copyToEmissions}>{t('Use these units for grid electricity in Emissions')}</button>}
          </div>
        </div>)}

      <div className="sme-grid2">
        {year && (
          <div className="card">
            <h2>{t('How the savings are worked out')}</h2>
            <ul className="bl-how">
              <li><b>{t('Contract demand.')}</b> {t('Each month where maximum demand went above contract demand, the excess is charged at the excess rate. We compare that with raising contract demand to cover your highest month (plus 5%). If it is over in only a few months, holding the peak down is cheaper.')}</li>
              <li><b>{t('Power factor.')}</b> {t('The penalty you actually paid. Capacitors are sized for the worst month’s power factor and demand, up to 0.99.')}</li>
              <li><b>{t('Time of day.')}</b> {t('The peak-hour share of each month’s units, with the share you could move to night.')}</li>
              <li><b>{t('A year.')}</b> {n(b.monthsEntered) > 0 && n(b.monthsEntered) < 12 ? t('You have entered {n} months, so each figure is multiplied by 12 ÷ {n}.', { n: b.monthsEntered }) : t('With all 12 months, the figures are what the year actually cost.')}</li>
            </ul>
          </div>)}
        {!year && (
          <div className="card">
            <h2>{t('From your bill')}</h2>
            <p className="sv-sub">{t('One month’s HT bill. These are on the first page, usually in a box called “billing details” or “demand”.')}</p>
            <div className="sme-fields" style={{ marginTop: 6 }}>
              <Num path="bills.cd" label={t('Contract demand')} hint={t('The load you agreed with the DISCOM (also ‘sanctioned’ or ‘CD’)')} unit="kVA" />
              <Num path="bills.md" label={t('Maximum demand recorded')} hint={t('Highest load the meter saw this month (‘MD’ or ‘RMD’)')} unit="kVA" />
              <Num path="bills.pf" label={t('Power factor')} hint={t('Between 0 and 1, for example 0.86')} placeholder="0.99" />
              <Num path="bills.pfPenalty" label={t('Power factor penalty')} hint={t('₹ charged for low power factor this month; 0 if none')} unit="₹" />
              <Num path="bills.units" label={t('Units this month')} hint={t('kWh billed')} unit="kWh" />
              <Num path="bills.peakShare" label={t('Units in peak hours')} hint={t('Time-of-day (TOD) section of the bill; 0 if not shown')} unit="%" />
            </div>
            <div style={{ marginTop: 10 }}><Evidence module="bills" item="one" label={t('Bill')} /></div>
          </div>)}
        <div className="card">
          <h2>{t('Your tariff')}</h2>
          <p className="sv-sub">{t('Leave a field empty to use a typical HT industrial rate. Your tariff order or the back of your bill has the exact figures.')}</p>
          {discoms.length > 0 && (
            <div className="sme-field" style={{ borderTop: 0, marginTop: 6 }}>
              <label htmlFor="bl-discom">{t('Electricity company')}<small>{t('Fills in its published rates')}</small></label>
              <select id="bl-discom" className="input" disabled={!can} value={get('bills.discom') ?? ''} onChange={(e) => pickDiscom(e.target.value)}>
                <option value="">{t('Typical rates')}</option>
                {(mine.length ? mine : discoms).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {mine.length > 0 && mine.length < discoms.length && <optgroup label={t('Other states')}>{discoms.filter((t) => !mine.includes(t)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              </select>
            </div>)}
          {RATES.map((r) => <Num key={r.k} path={`bills.${r.k}`} label={r.label} unit={r.unit} hint={dflt(r.k) ?? r.hint} placeholder={ph(r.k)} />)}
          <span className="lbl" style={{ display: 'block', marginTop: 14 }}>{t('Assumptions')}</span>
          {ASSUME.map((r) => <Num key={r.k} path={`bills.${r.k}`} label={r.label} unit={r.unit} hint={dflt(r.k) ?? r.hint} placeholder={ph(r.k)} />)}
        </div>
      </div>
      <p className="muted small">{t(year ? 'Tariff rules differ by state and DISCOM. Savings are estimates from your own bills.' : 'Tariff rules differ by state and DISCOM. Savings are estimates from your own bills; one month is a rough guide, so check a few months before you change your contract demand.')}</p>
    </>);
}

/** One finding: what it means, what to do, and the money. */
function FindingRow({ x, b }: { x: Finding; b: any }) {
  const I = b.inputs ?? {}, year = b.mode === 'year', N = n(b.monthsEntered);
  const code = x.code ?? (/^Maximum demand/.test(x.text) ? 'cd' : /^Power factor/.test(x.text) ? 'pf' : /peak/.test(x.text) ? 'tod' : '');
  let title = x.text, what = '', figs: [string, string][] = [];
  if (code === 'cd') {
    title = year ? t('You went over your contract demand in {a} of {n} months', { a: b.monthsOver, n: N }) : t('You are paying a penalty for going over your contract demand');
    what = year
      ? t(b.monthsOver === 1 ? 'Your contract demand is {cd} kVA. The meter went above it in {n} month, up to {md} kVA, and the excess was charged at {x} times the normal demand charge: about ₹{paid} in the months entered. Raising the contract demand to cover the highest month costs a little more every month, but stops the penalty.' : 'Your contract demand is {cd} kVA. The meter went above it in {n} months, up to {md} kVA, and the excess was charged at {x} times the normal demand charge: about ₹{paid} in the months entered. Raising the contract demand to cover the highest month costs a little more every month, but stops the penalty.', { cd: f0(b.cdNow), n: b.monthsOver, md: f0(b.maxMd), x: f1(I.excessMult), paid: f0(b.excessPaid) })
      : t('Your contract demand is the load you agreed with the electricity company: {cd} kVA. This month the meter recorded {md} kVA, so {ex} kVA was over the limit and charged at {x} times the normal demand charge. Raising the contract demand costs a little more every month, but stops the penalty.', { cd: f0(I.cd), md: f0(I.md), ex: f0(b.excess), x: f1(I.excessMult) });
    figs = [[t('Excess demand penalty'), `${lakh(b.excessCost)}${t('/yr')}`], [t('Extra demand charge after raising'), `${lakh(b.cdIncrease)}${t('/yr')}`]];
  } else if (code === 'cdPeak') {
    title = t('You went over your contract demand in {a} of {n} months', { a: b.monthsOver, n: N });
    what = t('The meter went above your {cd} kVA contract demand in only a few months (highest {md} kVA). Raising the contract demand for the whole year (to {nw} kVA) would cost {inc} a year, more than the {ex} excess charge. Keeping the peak down in those months is cheaper.', { cd: f0(b.cdNow), md: f0(b.maxMd), nw: f0(b.newCd), inc: lakh(b.cdIncrease), ex: lakh(b.excessCost) });
    figs = [[t('Excess charge paid'), `₹${f0(b.excessPaid)}`]];
  } else if (code === 'pf') {
    title = t('Low power factor is adding a penalty to your bill');
    what = year
      ? `${t('Power factor shows how much of the power you draw does useful work. Motors, compressors and welding machines pull it down, and below the DISCOM’s limit a penalty is added.')} ${t('You paid ₹{paid} in {a} of {n} months.', { paid: f0(b.pfPenaltyPaid), a: b.pfMonths, n: N })}${b.avgPf > 0 ? ` ${t('Your power factor averaged {avg} (lowest {min}).', { avg: f2(b.avgPf), min: f2(b.minPf) })}` : ''} ${t('Capacitors in an automatic (APFC) panel, sized for the worst month, bring it back up to about 0.99.')}`
      : `${t('Power factor shows how much of the power you draw does useful work. Motors, compressors and welding machines pull it down, and below the DISCOM’s limit a penalty is added.')} ${t('This month: ₹{pen} at a power factor of {pf}.', { pen: f0(I.pfPenalty), pf: f2(I.pf) })} ${t('Capacitors in an automatic (APFC) panel bring it back up to about 0.99.')}`;
    figs = [[t('One-time cost'), lakh(x.capex)], [t('Paid back in'), t('{n} months', { n: f1(b.pfPaybackMonths) })]];
  } else if (code === 'tod') {
    title = t('You could save by running some load at night');
    what = t(year ? '{pct}% of your units were, on average, used in peak hours, when the DISCOM adds ₹{sur} a unit, and night units get ₹{reb} back. Moving flexible work (pumps, batch processes, charging, compressors filling tanks) to off-peak hours saves on both.' : '{pct}% of your units are used in peak hours, when the DISCOM adds ₹{sur} a unit, and night units get ₹{reb} back. Moving flexible work (pumps, batch processes, charging, compressors filling tanks) to off-peak hours saves on both.', { pct: f0(year ? b.avgPeak : I.peakShare), sur: f2(I.peakSur), reb: f2(I.offRebate) });
    figs = [[t('Units moved'), `${f0(b.shiftKwh)} ${t('kWh/month')}`]];
  }
  const fix = x.kind === 'fix';
  return (
    <div className="sv-item">
      <h3>{title} <Pill kind={fix ? 'apply' : 'likely'}>{t(fix ? 'Fix' : 'Option')}</Pill></h3>
      <div className="sv-amt">{x.saving > 0 ? <><b>{lakh(x.saving)}</b><small>{t('saved per year')}</small></> : <small>{t('Stops the penalty;')}<br />{t('costs about the same')}</small>}</div>
      <div className="sv-body">
        {what && <p className="sv-what">{what}</p>}
        <div className="sv-do"><b>{t('What to do:')}</b> {t(x.action)}{/^Raise contract/.test(x.action) ? ` ${t('Apply to your DISCOM for a load change; it usually needs a fresh agreement and security deposit top-up.')}` : ''}</div>
        {figs.length > 0 && <div className="sv-figs">{figs.map(([l, v]) => <span key={l}>{l} <b>{v}</b></span>)}</div>}
      </div>
    </div>);
}
