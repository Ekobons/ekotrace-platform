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
  if (!d) return <div className="card empty">Loading…</div>;
  const b = d.results.bills as any, T = (d.config.tariffs ?? {}) as { default?: Record<string, number>; discoms?: any[]; note?: string };
  const def = T.default ?? {}, discoms = (T.discoms ?? []) as { id: string; name: string; state?: string; [k: string]: any }[];
  const year = b.mode === 'year';
  const has = year ? n(b.monthsEntered) > 0 : ['md', 'cd', 'units', 'pfPenalty', 'peakShare'].some((k) => n(get(`bills.${k}`)) > 0);
  const findings = (b.findings ?? []) as Finding[];
  const ph = (k: string) => (def[k] !== undefined ? String(def[k]) : undefined);
  const dflt = (k: string) => { const v = get(`bills.${k}`); return (v === undefined || v === null || v === '') && def[k] !== undefined ? `Empty: using typical ${def[k]}` : undefined; };
  const pickDiscom = (id: string) => {
    set('bills.discom', id);
    const x = discoms.find((t) => t.id === id);
    if (x) for (const r of RATES) if (x[r.k] !== undefined) set(`bills.${r.k}`, x[r.k]);
  };
  const mine = discoms.filter((t) => !t.state || t.state === d.company.state);
  const can = d.canEdit;
  const fyStart = Number(/^FY (\d{4})/.exec(d.fy)?.[1] ?? 0);
  const mLabel = (i: number) => `${MONTHS[i]} ${String((i < 9 ? fyStart : fyStart + 1) % 100).padStart(2, '0')}`;
  const months = (Array.isArray(get('bills.months')) ? get('bills.months') : []) as any[];
  const cell = (i: number, k: string) => { const v = months[i]?.[k]; return v === undefined || v === null ? '' : v; };
  const setCell = (i: number, k: string, v: number | '') => set(`bills.months.${i}.${k}`, v);
  const unitsByMonth = MONTHS.map((_, i) => n(months[i]?.units));
  const unitsN = unitsByMonth.filter((x) => x > 0).length;

  const scan = async (i: number, f: File | undefined) => {
    if (!f) return;
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) { toast('Choose the bill as a PDF file.'); return; }
    setScanning(i);
    try {
      const r = await smeApi.scan('electricity', f);
      const F = r.fields, val = (k: string) => (F[k] && F[k]!.value !== null && F[k]!.value !== '' ? Number(F[k]!.value) : null);
      const map: [string, string][] = [['unitsKwh', 'units'], ['maxDemandKva', 'md'], ['contractDemandKva', 'cd'], ['powerFactor', 'pf'], ['pfPenaltyInr', 'pfPenalty']];
      let got = 0;
      for (const [from, to] of map) { const v = val(from); if (v !== null && Number.isFinite(v)) { set(`bills.months.${i}.${to}`, v); got++; } }
      if (got) { setReadMonths({ ...readMonths, [i]: f.name }); toast(`${mLabel(i)}: ${got} figure${got === 1 ? '' : 's'} read. Check them against the bill.`); }
      else toast('No figures could be read from this PDF. Type them in instead.');
    } catch (e) { toast((e as Error).message); }
    setScanning(null);
  };
  const copyToEmissions = () => {
    const em = get('emissions') ?? {}, keys = [...Object.keys(d.config.factors.items ?? {}), 'green'];
    if (n(em.grid) > 0 && !window.confirm(`Grid electricity in Emissions is ${f0(em.grid)} kWh for ${d.fy}. Replace the main plant’s figure with these ${unitsN} months (${f0(unitsByMonth.reduce((a, x) => a + x, 0))} kWh)?`)) return;
    setModule('emissions', change(em, keys, (nx) => { const s = site(nx, 'main'); s.mode.grid = 'month'; s.months.grid = unitsByMonth.map((x) => (x > 0 ? x : '')); }));
    toast('Grid electricity in Emissions now uses these months.');
  };

  return (
    <>
      <SmeHead lede="Enter your electricity bills, up to 12 months (or read them from the bill PDFs). We look for penalties you can stop paying and show what each fix saves in a year.">
        <Link className="btn" to="/sme/scan">Read a bill PDF</Link>
      </SmeHead>

      <div className="bl-mode">
        <span className="lbl">Bills to use</span>
        <div className="seg" role="radiogroup" aria-label="Bills to use">
          <button type="button" role="radio" aria-checked={year} className={year ? 'on' : ''} disabled={!can} onClick={() => set('bills.mode', 'year')}>Up to 12 months</button>
          <button type="button" role="radio" aria-checked={!year} className={!year ? 'on' : ''} disabled={!can} onClick={() => set('bills.mode', 'one')}>One month’s bill</button>
        </div>
        <span className="muted small">{year ? (has ? `${b.monthsEntered} of 12 months entered${b.monthsEntered < 12 ? '; savings are scaled to a year' : ''}` : 'More months give a truer picture than one bill × 12.') : 'Quick check from a single bill, shown as a yearly figure.'}</span>
      </div>

      {year
        ? <Kpis>
          <Kpi label="Savings found" value={has ? lakh(b.total) : '—'} unit="per year" good={has && b.total > 0} />
          <Kpi label="Over contract demand" value={has ? `${b.monthsOver} of ${b.monthsEntered}` : '—'} unit="months" />
          <Kpi label="Average power factor" value={has && b.avgPf > 0 ? f2(b.avgPf) : '—'} unit={has && b.minPf > 0 ? `lowest ${f2(b.minPf)}` : 'aim for 0.99'} />
          <Kpi label="PF penalty paid" value={has ? `₹${f0(b.pfPenaltyPaid)}` : '—'} unit={has ? `in ${b.monthsEntered} month${b.monthsEntered === 1 ? '' : 's'}` : ''} />
        </Kpis>
        : <Kpis>
          <Kpi label="Savings found" value={has ? lakh(b.total) : '—'} unit="per year" good={has && b.total > 0} />
          <Kpi label="Things to fix" value={has ? findings.length : '—'} unit={findings.length === 1 ? 'finding' : 'findings'} />
          <Kpi label="Capacitors needed" value={b.kvarRounded > 0 && n(b.inputs?.pfPenalty) > 0 ? f0(b.kvarRounded) : '—'} unit="kVAr" />
          <Kpi label="Capacitor payback" value={b.pfPaybackMonths > 0 ? f1(b.pfPaybackMonths) : '—'} unit="months" />
        </Kpis>}

      <div className="card">
        <div className="sv-h2row"><h2>What we found{d.company.isExample && <Sample />}</h2>{has && <span className="muted small">{year ? (b.monthsEntered === 12 ? 'From 12 monthly bills' : `From ${b.monthsEntered} monthly bill${b.monthsEntered === 1 ? '' : 's'}, scaled to a year`) : 'From one month’s bill, shown as a yearly figure'}</span>}</div>
        {!has && <div className="sme-callout" style={{ marginTop: 10 }}>{year ? <>Add your monthly bills in the table below (units, maximum demand, power factor and any penalty) to see what you can save.</> : <>Add the figures from your power bill below (contract demand, maximum demand, power factor penalty and units) to see what you can save.</>} Or <Link to="/sme/scan">read them from a bill PDF</Link>.</div>}
        {has && !findings.length && <p className="note ok" style={{ marginTop: 10 }}>{year ? 'No penalties in these bills. Maximum demand stayed within contract demand, no power factor penalty was charged, and no peak-hour units are entered.' : 'No penalties on this bill. Your maximum demand is within contract demand, there is no power factor penalty, and no peak-hour units are entered.'}</p>}
        {findings.map((x, i) => <FindingRow key={i} x={x} b={b} />)}
      </div>

      {year && (
        <div className="card">
          <div className="sv-h2row"><h2>Your monthly bills</h2><span className="muted small">April to March, {d.fy}</span></div>
          <p className="sv-sub">Copy each month from the first page of the HT bill (“billing details” or “demand”). Leave a month empty if you don’t have it. Contract demand can stay empty when it did not change.</p>
          <div className="sme-fields" style={{ maxWidth: 520, marginTop: 6 }}>
            <Num path="bills.cd" label="Contract demand" hint="The load agreed with the DISCOM, used for months where it is empty" unit="kVA" />
          </div>
          <div className="sme-scroll">
            <table className="sme-tbl bl-tbl">
              <thead><tr><th>Month</th>{COLS.map((c) => <th key={c.k} className="r">{c.label}<small>{c.unit}</small></th>)}<th className="r"><span className="sr">Read PDF</span></th></tr></thead>
              <tbody>
                {MONTHS.map((_, i) => {
                  const m = months[i] ?? {}, cd = n(m.cd) || n(get('bills.cd'));
                  const over = n(m.md) > 0 && cd > 0 && n(m.md) > cd, pen = n(m.pfPenalty) > 0;
                  return (
                    <tr key={i} className={over || pen ? 'flag' : ''}>
                      <td><b>{mLabel(i)}</b>{readMonths[i] && <small className="bl-read" title={readMonths[i]}>read from PDF, check</small>}</td>
                      {COLS.map((c) => (
                        <td key={c.k} className="r">
                          <input className={`input num${(c.k === 'md' && over) || (c.k === 'pfPenalty' && pen) ? ' warn' : ''}`} type="number" inputMode="decimal" step={c.step ?? 'any'} min={0} max={c.k === 'pf' ? 1 : c.k === 'peakShare' ? 100 : undefined}
                            aria-label={`${mLabel(i)} ${c.label}`} disabled={!can} placeholder={c.k === 'cd' && n(get('bills.cd')) > 0 ? String(get('bills.cd')) : ''}
                            value={cell(i, c.k)} onChange={(e) => setCell(i, c.k, e.target.value === '' ? '' : Number(e.target.value))} />
                        </td>))}
                      <td className="r">{can && <button type="button" className="btn sm ghost" disabled={scanning !== null} onClick={() => { setScanFor(i); fileRef.current?.click(); }}>{scanning === i ? 'Reading…' : 'PDF'}</button>}</td>
                    </tr>);
                })}
              </tbody>
            </table>
          </div>
          <input ref={fileRef} type="file" hidden accept=".pdf,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (scanFor !== null) void scan(scanFor, f); }} />
          <p className="muted small" style={{ marginTop: 8 }}>“PDF” reads that month’s bill (a DISCOM download is read at once; a scanned PDF takes up to a minute) and fills the row for you to check. Peak-hour units are not read: take them from the time-of-day (TOD) section.</p>
          <div className="bl-foot">
            <Evidence module="bills" item="year" label="Bills" />
            {can && unitsN > 0 && <button type="button" className="btn sm" onClick={copyToEmissions}>Use these units for grid electricity in Emissions</button>}
          </div>
        </div>)}

      <div className="sme-grid2">
        {year && (
          <div className="card">
            <h2>How the savings are worked out</h2>
            <ul className="bl-how">
              <li><b>Contract demand.</b> Each month where maximum demand went above contract demand, the excess is charged at the excess rate. We compare that with raising contract demand to cover your highest month (plus 5%). If it is over in only a few months, holding the peak down is cheaper.</li>
              <li><b>Power factor.</b> The penalty you actually paid. Capacitors are sized for the worst month’s power factor and demand, up to 0.99.</li>
              <li><b>Time of day.</b> The peak-hour share of each month’s units, with the share you could move to night.</li>
              <li><b>A year.</b> {n(b.monthsEntered) > 0 && n(b.monthsEntered) < 12 ? `You have entered ${b.monthsEntered} months, so each figure is multiplied by 12 ÷ ${b.monthsEntered}.` : 'With all 12 months, the figures are what the year actually cost.'}</li>
            </ul>
          </div>)}
        {!year && (
          <div className="card">
            <h2>From your bill</h2>
            <p className="sv-sub">One month’s HT bill. These are on the first page, usually in a box called “billing details” or “demand”.</p>
            <div className="sme-fields" style={{ marginTop: 6 }}>
              <Num path="bills.cd" label="Contract demand" hint="The load you agreed with the DISCOM (also ‘sanctioned’ or ‘CD’)" unit="kVA" />
              <Num path="bills.md" label="Maximum demand recorded" hint="Highest load the meter saw this month (‘MD’ or ‘RMD’)" unit="kVA" />
              <Num path="bills.pf" label="Power factor" hint="Between 0 and 1, for example 0.86" placeholder="0.99" />
              <Num path="bills.pfPenalty" label="Power factor penalty" hint="₹ charged for low power factor this month; 0 if none" unit="₹" />
              <Num path="bills.units" label="Units this month" hint="kWh billed" unit="kWh" />
              <Num path="bills.peakShare" label="Units in peak hours" hint="Time-of-day (TOD) section of the bill; 0 if not shown" unit="%" />
            </div>
            <div style={{ marginTop: 10 }}><Evidence module="bills" item="one" label="Bill" /></div>
          </div>)}
        <div className="card">
          <h2>Your tariff</h2>
          <p className="sv-sub">Leave a field empty to use a typical HT industrial rate. Your tariff order or the back of your bill has the exact figures.</p>
          {discoms.length > 0 && (
            <div className="sme-field" style={{ borderTop: 0, marginTop: 6 }}>
              <label htmlFor="bl-discom">Electricity company<small>Fills in its published rates</small></label>
              <select id="bl-discom" className="input" disabled={!can} value={get('bills.discom') ?? ''} onChange={(e) => pickDiscom(e.target.value)}>
                <option value="">Typical rates</option>
                {(mine.length ? mine : discoms).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {mine.length > 0 && mine.length < discoms.length && <optgroup label="Other states">{discoms.filter((t) => !mine.includes(t)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              </select>
            </div>)}
          {RATES.map((r) => <Num key={r.k} path={`bills.${r.k}`} label={r.label} unit={r.unit} hint={dflt(r.k) ?? r.hint} placeholder={ph(r.k)} />)}
          <span className="lbl" style={{ display: 'block', marginTop: 14 }}>Assumptions</span>
          {ASSUME.map((r) => <Num key={r.k} path={`bills.${r.k}`} label={r.label} unit={r.unit} hint={dflt(r.k) ?? r.hint} placeholder={ph(r.k)} />)}
        </div>
      </div>
      <p className="muted small">Tariff rules differ by state and DISCOM. Savings are estimates from your own bills{year ? '' : '; one month is a rough guide, so check a few months before you change your contract demand'}.</p>
    </>);
}

/** One finding: what it means, what to do, and the money. */
function FindingRow({ x, b }: { x: Finding; b: any }) {
  const I = b.inputs ?? {}, year = b.mode === 'year', N = n(b.monthsEntered);
  const code = x.code ?? (/^Maximum demand/.test(x.text) ? 'cd' : /^Power factor/.test(x.text) ? 'pf' : /peak/.test(x.text) ? 'tod' : '');
  let title = x.text, what = '', figs: [string, string][] = [];
  if (code === 'cd') {
    title = year ? `You went over your contract demand in ${b.monthsOver} of ${N} months` : 'You are paying a penalty for going over your contract demand';
    what = year
      ? `Your contract demand is ${f0(b.cdNow)} kVA. The meter went above it in ${b.monthsOver} month${b.monthsOver === 1 ? '' : 's'}, up to ${f0(b.maxMd)} kVA, and the excess was charged at ${f1(I.excessMult)} times the normal demand charge: about ₹${f0(b.excessPaid)} in the months entered. Raising the contract demand to cover the highest month costs a little more every month, but stops the penalty.`
      : `Your contract demand is the load you agreed with the electricity company: ${f0(I.cd)} kVA. This month the meter recorded ${f0(I.md)} kVA, so ${f0(b.excess)} kVA was over the limit and charged at ${f1(I.excessMult)} times the normal demand charge. Raising the contract demand costs a little more every month, but stops the penalty.`;
    figs = [['Excess demand penalty', `${lakh(b.excessCost)}/yr`], ['Extra demand charge after raising', `${lakh(b.cdIncrease)}/yr`]];
  } else if (code === 'cdPeak') {
    title = `You went over your contract demand in ${b.monthsOver} of ${N} months`;
    what = `The meter went above your ${f0(b.cdNow)} kVA contract demand in only a few months (highest ${f0(b.maxMd)} kVA). Raising the contract demand for the whole year (to ${f0(b.newCd)} kVA) would cost ${lakh(b.cdIncrease)} a year, more than the ${lakh(b.excessCost)} excess charge. Keeping the peak down in those months is cheaper.`;
    figs = [['Excess charge paid', `₹${f0(b.excessPaid)}`]];
  } else if (code === 'pf') {
    title = 'Low power factor is adding a penalty to your bill';
    what = year
      ? `Power factor shows how much of the power you draw does useful work. Motors, compressors and welding machines pull it down, and below the DISCOM’s limit a penalty is added. You paid ₹${f0(b.pfPenaltyPaid)} in ${b.pfMonths} of ${N} months${b.avgPf > 0 ? `; your power factor averaged ${f2(b.avgPf)} (lowest ${f2(b.minPf)})` : ''}. Capacitors in an automatic (APFC) panel, sized for the worst month, bring it back up to about 0.99.`
      : `Power factor shows how much of the power you draw does useful work. Motors, compressors and welding machines pull it down, and below the DISCOM’s limit a penalty is added (₹${f0(I.pfPenalty)} this month at ${f2(I.pf)}). Capacitors in an automatic (APFC) panel bring it back up to about 0.99.`;
    figs = [['One-time cost', lakh(x.capex)], ['Paid back in', `${f1(b.pfPaybackMonths)} months`]];
  } else if (code === 'tod') {
    title = 'You could save by running some load at night';
    what = `${f0(year ? b.avgPeak : I.peakShare)}% of your units ${year ? 'were, on average,' : 'are'} used in peak hours, when the DISCOM adds ₹${f2(I.peakSur)} a unit, and night units get ₹${f2(I.offRebate)} back. Moving flexible work (pumps, batch processes, charging, compressors filling tanks) to off-peak hours saves on both.`;
    figs = [['Units moved', `${f0(b.shiftKwh)} kWh/month`]];
  }
  const fix = x.kind === 'fix';
  return (
    <div className="sv-item">
      <h3>{title} <Pill kind={fix ? 'apply' : 'likely'}>{fix ? 'Fix' : 'Option'}</Pill></h3>
      <div className="sv-amt">{x.saving > 0 ? <><b>{lakh(x.saving)}</b><small>saved per year</small></> : <small>Stops the penalty;<br />costs about the same</small>}</div>
      <div className="sv-body">
        {what && <p className="sv-what">{what}</p>}
        <div className="sv-do"><b>What to do:</b> {x.action}{/^Raise contract/.test(x.action) ? ' Apply to your DISCOM for a load change; it usually needs a fresh agreement and security deposit top-up.' : ''}</div>
        {figs.length > 0 && <div className="sv-figs">{figs.map(([l, v]) => <span key={l}>{l} <b>{v}</b></span>)}</div>}
      </div>
    </div>);
}
