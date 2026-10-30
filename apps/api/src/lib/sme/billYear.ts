/**
 * EKOTRACE SME — power bill analyser over up to 12 monthly bills (pure, no I/O).
 *
 *   bills = { mode: 'year' | 'one', months: [{ units, md, cd, pf, pfPenalty, peakShare } × 12, April first], …rates }
 *
 * Findings use every month entered: months over contract demand, average and lowest power factor,
 * penalty actually paid. Savings are the months entered scaled to a year (12 ÷ months entered),
 * never one month × 12 unless only one month is there.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

const num = (v: any): number => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);
export const BILL_FIELDS = ['units', 'md', 'cd', 'pf', 'pfPenalty', 'peakShare'] as const;

export interface BillMonth { i: number; units: number; md: number; cd: number; pf: number; pfPenalty: number; peakShare: number; excess: number }

/** Months with a bill entered (units or maximum demand). Contract demand left empty uses the one on the page. */
export function billMonths(b: any): BillMonth[] {
  const ms = Array.isArray(b.months) ? b.months.slice(0, 12) : [];
  const out: BillMonth[] = [];
  ms.forEach((m: any, i: number) => {
    if (!m || (num(m.units) <= 0 && num(m.md) <= 0)) return;
    const cd = num(m.cd) || num(b.cd), md = num(m.md);
    out.push({ i, units: num(m.units), md, cd, pf: num(m.pf), pfPenalty: num(m.pfPenalty), peakShare: num(m.peakShare), excess: cd > 0 ? Math.max(0, md - cd) : 0 });
  });
  return out;
}

/** Whether the 12-month analysis is used: chosen; or, with no choice made, months entered or no single bill either (a new company starts with 12 months). */
const oneBill = (b: any) => ['md', 'cd', 'units', 'pfPenalty', 'peakShare'].some((k) => num(b[k]) > 0);
export const yearMode = (b: any) => b.mode === 'year' || (b.mode !== 'one' && (billMonths(b).length > 0 || !oneBill(b)));

const kvarFor = (md: number, pfIn: number) => {
  const pf = Math.min(Math.max(pfIn || 0.99, 0.5), 0.999);
  return Math.max(0, md * pf * (Math.tan(Math.acos(pf)) - Math.tan(Math.acos(0.99))));
};

/** The analysis over the months entered. `b` is the bill document merged over the tariff defaults. */
export function billsYear(b: any): any {
  const ms = billMonths(b), N = ms.length, scale = N ? 12 / N : 0;
  const rate = num(b.demandRate), mult = num(b.excessMult);
  const over = ms.filter((m) => m.excess > 0);
  const maxMd = ms.reduce((a, m) => Math.max(a, m.md), 0);
  const cdNow = N ? ms[N - 1]!.cd : num(b.cd);
  const excessPaid = over.reduce((a, m) => a + m.excess * rate * mult, 0);
  const excessCost = excessPaid * scale;
  const newCd = Math.ceil((maxMd * 1.05) / 5) * 5;
  const cdIncrease = ms.reduce((a, m) => a + Math.max(0, newCd - m.cd) * rate, 0) * scale;
  const cdSave = over.length ? Math.max(0, excessCost - cdIncrease) : 0;
  // when raising contract demand does not pay, holding the peak down saves the excess-demand charge instead
  // (only when it happens in at most half the months: a demand that is over most of the year needs a higher contract)
  const peakSave = over.length && cdSave <= 0 && over.length * 2 <= N ? excessCost : 0;
  const pfs = ms.filter((m) => m.pf > 0).map((m) => m.pf);
  const avgPf = pfs.length ? pfs.reduce((a, x) => a + x, 0) / pfs.length : 0;
  const minPf = pfs.length ? Math.min(...pfs) : 0;
  const penMonths = ms.filter((m) => m.pfPenalty > 0);
  const pfPenaltyPaid = penMonths.reduce((a, m) => a + m.pfPenalty, 0);
  const pfSave = pfPenaltyPaid * scale;
  // capacitors sized for the worst month with a penalty (or any month when the penalty is not itemised)
  const kvar = (penMonths.length ? penMonths : ms).reduce((a, m) => Math.max(a, kvarFor(m.md, m.pf)), 0);
  const kvarRounded = Math.ceil(kvar / 5) * 5;
  const capex = kvarRounded * num(b.capCost);
  const shiftKwhYear = ms.reduce((a, m) => a + ((m.units * m.peakShare) / 100) * (num(b.shiftPct) / 100), 0) * scale;
  const todSave = shiftKwhYear * (num(b.peakSur) + num(b.offRebate));
  const unitsEntered = ms.reduce((a, m) => a + m.units, 0);
  const peakMonths = ms.filter((m) => m.peakShare > 0);
  const avgPeak = peakMonths.length ? peakMonths.reduce((a, m) => a + m.peakShare, 0) / peakMonths.length : 0;
  const findings: any[] = [];
  const of = `${N === 12 ? 'all 12' : N} month${N === 1 ? '' : 's'}`;
  if (over.length && (cdSave > 0 || !peakSave)) findings.push({ kind: 'fix', code: 'cd', text: `Maximum demand was above contract demand in ${over.length} of ${N} months (highest ${maxMd} kVA, contract ${cdNow} kVA).`, action: `Raise contract demand to ${newCd} kVA.`, saving: cdSave });
  else if (over.length) findings.push({ kind: 'option', code: 'cdPeak', text: `Maximum demand was above contract demand in ${over.length} of ${N} months, but raising contract demand would cost more than the penalty.`, action: `Keep contract demand at ${cdNow} kVA and hold the peak below it in those months (stagger start-up of large motors, furnaces and compressors).`, saving: peakSave });
  if (pfPenaltyPaid > 0) findings.push({ kind: 'fix', code: 'pf', text: `A power factor penalty was charged in ${penMonths.length} of ${N} months: ₹${Math.round(pfPenaltyPaid)} in all (average power factor ${avgPf ? avgPf.toFixed(2) : 'not entered'}).`, action: `Install ${kvarRounded} kVAr of capacitors (APFC panel).`, saving: pfSave, capex });
  if (todSave > 0) findings.push({ kind: 'option', code: 'tod', text: `On average ${Math.round(avgPeak)}% of units were in peak hours over ${of}.`, action: `Move ${num(b.shiftPct)}% of that load to off-peak.`, saving: todSave });
  return {
    mode: 'year', inputs: b, monthsEntered: N, scale, months: ms,
    excess: over.reduce((a, m) => Math.max(a, m.excess), 0), monthsOver: over.length, maxMd, cdNow, excessPaid, excessCost, newCd, cdIncrease, cdSave, peakSave,
    avgPf, minPf, pfMonths: penMonths.length, pfPenaltyPaid, kvarRounded, capex, pfSave, pfPaybackMonths: pfSave > 0 ? (capex / pfSave) * 12 : 0,
    unitsEntered, avgPeak, shiftKwh: shiftKwhYear / 12, shiftKwhYear, todSave,
    total: cdSave + peakSave + pfSave + todSave, findings,
  };
}
