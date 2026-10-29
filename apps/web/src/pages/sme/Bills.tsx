/** Power bill analyser: figures from one monthly bill → penalties to stop paying, each explained in plain words with its ₹ saving. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Link } from 'react-router-dom';
import './save.css';
import { useSme } from './store';
import { Kpi, Kpis, Num, Pill, Sample, SmeHead } from './ui';
import { f0, f1, f2, lakh, n } from '../../lib/sme';

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

export function SmeBills() {
  const { d, get, set } = useSme();
  if (!d) return <div className="card empty">Loading…</div>;
  const b = d.results.bills as any, T = (d.config.tariffs ?? {}) as { default?: Record<string, number>; discoms?: any[]; note?: string };
  const def = T.default ?? {}, discoms = (T.discoms ?? []) as { id: string; name: string; state?: string; [k: string]: any }[];
  const has = ['md', 'cd', 'units', 'pfPenalty', 'peakShare'].some((k) => n(get(`bills.${k}`)) > 0);
  const findings = (b.findings ?? []) as { kind: string; text: string; action: string; saving: number; capex?: number }[];
  const ph = (k: string) => (def[k] !== undefined ? String(def[k]) : undefined);
  const dflt = (k: string) => { const v = get(`bills.${k}`); return (v === undefined || v === null || v === '') && def[k] !== undefined ? `Empty: using typical ${def[k]}` : undefined; };
  const pickDiscom = (id: string) => {
    set('bills.discom', id);
    const x = discoms.find((t) => t.id === id);
    if (x) for (const r of RATES) if (x[r.k] !== undefined) set(`bills.${r.k}`, x[r.k]);
  };
  const mine = discoms.filter((t) => !t.state || t.state === d.company.state);

  return (
    <>
      <SmeHead lede="Enter the figures from one month's electricity bill (or read them from the bill PDF). We look for penalties you can stop paying and show what each fix saves in a year.">
        <Link className="btn" to="/sme/scan">Read a bill PDF</Link>
      </SmeHead>

      <Kpis>
        <Kpi label="Savings found" value={has ? lakh(b.total) : '—'} unit="per year" good={has && b.total > 0} />
        <Kpi label="Things to fix" value={has ? findings.length : '—'} unit={findings.length === 1 ? 'finding' : 'findings'} />
        <Kpi label="Capacitors needed" value={b.kvarRounded > 0 && n(b.inputs.pfPenalty) > 0 ? f0(b.kvarRounded) : '—'} unit="kVAr" />
        <Kpi label="Capacitor payback" value={b.pfPaybackMonths > 0 ? f1(b.pfPaybackMonths) : '—'} unit="months" />
      </Kpis>

      <div className="card">
        <div className="sv-h2row"><h2>What we found{d.company.isExample && <Sample />}</h2>{has && <span className="muted small">From one month's bill, shown as a yearly figure</span>}</div>
        {!has && <div className="sme-callout" style={{ marginTop: 10 }}>Add the figures from your power bill below (contract demand, maximum demand, power factor penalty and units) to see what you can save. Or <Link to="/sme/scan">read them from a bill PDF</Link>.</div>}
        {has && !findings.length && <p className="note ok" style={{ marginTop: 10 }}>No penalties on this bill. Your maximum demand is within contract demand, there is no power factor penalty, and no peak-hour units are entered.</p>}
        {findings.map((x, i) => <Finding key={i} x={x} b={b} />)}
      </div>

      <div className="sme-grid2">
        <div className="card">
          <h2>From your bill</h2>
          <p className="sv-sub">One month's HT bill. These are on the first page, usually in a box called "billing details" or "demand".</p>
          <div className="sme-fields" style={{ marginTop: 6 }}>
            <Num path="bills.cd" label="Contract demand" hint="The load you agreed with the DISCOM (also 'sanctioned' or 'CD')" unit="kVA" />
            <Num path="bills.md" label="Maximum demand recorded" hint="Highest load the meter saw this month ('MD' or 'RMD')" unit="kVA" />
            <Num path="bills.pf" label="Power factor" hint="Between 0 and 1, for example 0.86" placeholder="0.99" />
            <Num path="bills.pfPenalty" label="Power factor penalty" hint="₹ charged for low power factor this month; 0 if none" unit="₹" />
            <Num path="bills.units" label="Units this month" hint="kWh billed" unit="kWh" />
            <Num path="bills.peakShare" label="Units in peak hours" hint="Time-of-day (TOD) section of the bill; 0 if not shown" unit="%" />
          </div>
        </div>
        <div className="card">
          <h2>Your tariff</h2>
          <p className="sv-sub">Leave a field empty to use a typical HT industrial rate. Your tariff order or the back of your bill has the exact figures.</p>
          {discoms.length > 0 && (
            <div className="sme-field" style={{ borderTop: 0, marginTop: 6 }}>
              <label htmlFor="bl-discom">Electricity company<small>Fills in its published rates</small></label>
              <select id="bl-discom" className="input" disabled={!d.canEdit} value={get('bills.discom') ?? ''} onChange={(e) => pickDiscom(e.target.value)}>
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
      <p className="muted small">Tariff rules differ by state and DISCOM. Savings are estimates from one month's bill; check a few months before you change your contract demand.</p>
    </>);
}

/** One finding: what it means, what to do, and the money. */
function Finding({ x, b }: { x: { kind: string; text: string; action: string; saving: number; capex?: number }; b: any }) {
  const I = b.inputs;
  let title = x.text, what: string, figs: [string, string][] = [];
  if (/^Maximum demand/.test(x.text)) {
    title = 'You are paying a penalty for going over your contract demand';
    what = `Your contract demand is the load you agreed with the electricity company: ${f0(I.cd)} kVA. This month the meter recorded ${f0(I.md)} kVA, so ${f0(b.excess)} kVA was over the limit and charged at ${f1(I.excessMult)} times the normal demand charge. Raising the contract demand costs a little more every month, but stops the penalty.`;
    figs = [['Excess demand penalty', `${lakh(b.excessCost)}/yr`], ['Extra demand charge after raising', `${lakh(b.cdIncrease)}/yr`]];
  } else if (/^Power factor/.test(x.text)) {
    title = 'Low power factor is adding a penalty to your bill';
    what = `Power factor shows how much of the power you draw does useful work. Motors, compressors and welding machines pull it down, and below the DISCOM's limit a penalty is added (₹${f0(I.pfPenalty)} this month at ${f2(I.pf)}). Capacitors in an automatic (APFC) panel bring it back up to about 0.99.`;
    figs = [['One-time cost', lakh(x.capex)], ['Paid back in', `${f1(b.pfPaybackMonths)} months`]];
  } else if (/peak/.test(x.text)) {
    title = 'You could save by running some load at night';
    what = `${f0(I.peakShare)}% of your units are used in peak hours, when the DISCOM adds ₹${f2(I.peakSur)} a unit, and night units get ₹${f2(I.offRebate)} back. Moving flexible work (pumps, batch processes, charging, compressors filling tanks) to off-peak hours saves on both.`;
    figs = [['Units moved', `${f0(b.shiftKwh)} kWh/month`]];
  } else what = '';
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
