/**
 * India CCTS (compliance mechanism): GEI of an obligated entity against its notified target.
 *
 * Follows BEE's Detailed Procedure for Compliance Mechanism under CCTS (v1.0, July 2024), Annex III eq. II:
 *   total emissions = direct energy + direct process + purchased electricity and heat − exported power − CO2 transferred out
 *   GEI = total emissions / equivalent product output                                        (tCO2e per unit)
 *   CCCs issued = (target GEI − achieved GEI) × output;  CCCs to surrender = (achieved − target) × output
 *   environmental compensation on what is not surrendered: 2 × the average CCC price of the trading cycle
 *
 * Purchased electricity uses the CEA average grid factor of the baseline year, held constant; documented renewable
 * electricity counts as zero. Exported power is deducted at its heat-rate factor, or the grid factor without one.
 * Biogenic CO2 is outside the boundary (EKOTRACE already keeps it outside scopes). Pure functions, no database.
 */

export const SECTORS: Record<string, { label: string; unit: string; product: string }> = {
  aluminium: { label: 'Aluminium', unit: 't', product: 'Equivalent aluminium product' },
  secondary_aluminium: { label: 'Secondary aluminium', unit: 't', product: 'Equivalent aluminium product' },
  cement: { label: 'Cement', unit: 't', product: 'Cement equivalent' },
  chlor_alkali: { label: 'Chlor-alkali', unit: 't', product: 'Caustic soda equivalent' },
  pulp_paper: { label: 'Pulp & paper', unit: 't', product: 'Paper equivalent' },
  refinery: { label: 'Petroleum refinery', unit: 'MBBLS×NRGF', product: 'Crude throughput × NRGF' },
  petrochemical: { label: 'Petrochemicals', unit: 't', product: 'Olefin equivalent' },
  textile: { label: 'Textiles', unit: 't', product: 'Equivalent textile product' },
  iron_steel: { label: 'Iron & steel (draft targets)', unit: 't', product: 'Crude steel equivalent' },
  fertiliser: { label: 'Fertiliser (no targets yet)', unit: 't', product: 'Equivalent product' },
  other: { label: 'Other', unit: 't', product: 'Equivalent product' },
};

/** Compliance year label: 2025 → "2025-26" (April 2025 to March 2026). */
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
/** The compliance year a month (YYYY-MM-DD) falls in. */
export const fyOf = (month: string) => { const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); return m >= 4 ? y : y - 1; };
/** The 12 months of a compliance year, April first, as YYYY-MM-01. */
export const fyMonths = (fy: number) => Array.from({ length: 12 }, (_, i) => { const m = 4 + i; const y = m > 12 ? fy + 1 : fy; return `${y}-${String(((m - 1) % 12) + 1).padStart(2, '0')}-01`; });

export interface MonthIn {
  month: string;
  output: number | null;
  /** from EKOTRACE approved entries of the boundary facilities (entries mode) */
  fromEntries?: { fuel_t: number; grid_mwh: number; entries: number };
  /** typed values; for fuel_t and grid_mwh a typed value overrides the entries */
  fuel_t: number | null; process_t: number | null; pfc_t: number | null; grid_mwh: number | null; re_mwh: number | null;
  heat_t: number | null; export_mwh: number | null; export_ef: number | null; transfer_t: number | null;
}
export interface MonthOut {
  month: string; output: number | null; fuel: number; process: number; pfc: number; electricity: number; gridMwh: number; reMwh: number;
  heat: number; exported: number; transfer: number; total: number; gei: number | null;
  sources: { fuel: 'entries' | 'typed' | 'none'; grid: 'entries' | 'typed' | 'none' }; complete: boolean; problems: string[];
}

const n = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? 0 : x);
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function month(m: MonthIn, gridEf: number, mode: 'entries' | 'manual'): MonthOut {
  const problems: string[] = [];
  const fe = mode === 'entries' ? m.fromEntries : undefined;
  const fuel = m.fuel_t != null ? m.fuel_t : n(fe?.fuel_t);
  const gridMwh = m.grid_mwh != null ? m.grid_mwh : n(fe?.grid_mwh);
  const reMwh = Math.min(n(m.re_mwh), gridMwh);
  if (n(m.re_mwh) > gridMwh + 1e-9) problems.push('Renewable electricity is more than the electricity bought; only the electricity bought is counted as renewable');
  const electricity = (gridMwh - reMwh) * gridEf;
  const exported = n(m.export_mwh) * (m.export_ef ?? gridEf);
  const total = fuel + n(m.process_t) + n(m.pfc_t) + electricity + n(m.heat_t) - exported - n(m.transfer_t);
  if (total < 0) problems.push('Deductions (exported power, CO2 transferred out) are larger than the emissions');
  const hasEmis = fuel > 0 || n(m.process_t) > 0 || n(m.pfc_t) > 0 || gridMwh > 0 || n(m.heat_t) > 0;
  const complete = m.output != null && m.output > 0 && hasEmis;
  if (m.output != null && m.output > 0 && !hasEmis) problems.push('Output entered but no emissions for the month');
  if (hasEmis && !(m.output != null && m.output > 0)) problems.push('Emissions but no output for the month');
  return {
    month: m.month, output: m.output, fuel: r6(fuel), process: r6(n(m.process_t)), pfc: r6(n(m.pfc_t)), electricity: r6(electricity), gridMwh: r6(gridMwh), reMwh: r6(reMwh),
    heat: r6(n(m.heat_t)), exported: r6(exported), transfer: r6(n(m.transfer_t)), total: r6(total),
    gei: complete ? total / (m.output as number) : null,
    sources: { fuel: m.fuel_t != null ? 'typed' : fe && fe.fuel_t ? 'entries' : 'none', grid: m.grid_mwh != null ? 'typed' : fe && fe.grid_mwh ? 'entries' : 'none' },
    complete, problems,
  };
}

export interface YearResult {
  fy: number; label: string; months: MonthOut[]; monthsIn: number;
  output: number; emissions: number; gei: number | null; target: number | null; baselineGei: number | null;
  components: { fuel: number; process: number; pfc: number; electricity: number; heat: number; exported: number; transfer: number };
  /** reduction against the baseline GEI, and what the target asks for */
  vsBaseline: number | null; targetCut: number | null;
  /** positive: CCCs to be issued; negative: CCCs to surrender (tCO2e) on the months in */
  ccc: number | null;
  /** projection to a full year: months not yet in follow the average monthly output of the months in */
  projection: { output: number; emissions: number; gei: number | null; ccc: number | null } | null;
  /** GEI the remaining months must average to meet the target, at projected output */
  requiredRest: number | null;
}

export function year(fy: number, months: MonthOut[], target: number | null, baselineGei: number | null): YearResult {
  const inn = months.filter((m) => m.complete);
  const sum = (k: 'fuel' | 'process' | 'pfc' | 'electricity' | 'heat' | 'exported' | 'transfer' | 'total') => inn.reduce((a, m) => a + m[k], 0);
  const output = inn.reduce((a, m) => a + (m.output as number), 0), emissions = sum('total');
  const gei = output > 0 ? emissions / output : null;
  const ccc = gei != null && target != null ? (target - gei) * output : null;
  let projection: YearResult['projection'] = null, requiredRest: number | null = null;
  if (inn.length && inn.length < 12) {
    const left = 12 - inn.length, avgOut = output / inn.length, avgEm = emissions / inn.length;
    const pOut = output + avgOut * left, pEm = emissions + avgEm * left, pGei = pOut ? pEm / pOut : null;
    projection = { output: pOut, emissions: pEm, gei: pGei, ccc: pGei != null && target != null ? (target - pGei) * pOut : null };
    if (target != null) requiredRest = (target * pOut - emissions) / (avgOut * left);
  }
  return {
    fy, label: fyLabel(fy), months, monthsIn: inn.length, output, emissions, gei, target, baselineGei,
    components: { fuel: sum('fuel'), process: sum('process'), pfc: sum('pfc'), electricity: sum('electricity'), heat: sum('heat'), exported: sum('exported'), transfer: sum('transfer') },
    vsBaseline: gei != null && baselineGei ? 1 - gei / baselineGei : null,
    targetCut: target != null && baselineGei ? 1 - target / baselineGei : null,
    ccc, projection, requiredRest,
  };
}

export interface CccTxn { kind: 'issued' | 'bought' | 'sold' | 'surrendered'; fy: number; quantity: number; price_inr: number | null }
/** The CCC account: held now, and the obligation of a compliance year after what is already surrendered for it. */
export function account(txns: CccTxn[], fy: number, ccc: number | null, price: number | null) {
  const s = (k: CccTxn['kind'], f?: number) => txns.filter((t) => t.kind === k && (f == null || t.fy === f)).reduce((a, t) => a + t.quantity, 0);
  const held = s('issued') + s('bought') - s('sold') - s('surrendered');
  const obligation = ccc != null && ccc < 0 ? -ccc : 0;
  const surrendered = s('surrendered', fy);
  const open = Math.max(0, obligation - surrendered);
  const toBuy = Math.max(0, open - held);
  return {
    held, issued: s('issued'), bought: s('bought'), sold: s('sold'), surrendered: s('surrendered'), obligation, surrenderedForYear: surrendered, open, toBuy,
    expectedIssue: ccc != null && ccc > 0 ? Math.floor(ccc) : 0,
    value: price != null ? { held: held * price, toBuy: toBuy * price, compensation: toBuy * price * 2, surplus: ccc != null && ccc > 0 ? Math.floor(ccc) * price : 0 } : null,
  };
}

/** Compliance calendar of a compliance year (BEE procedure: monitoring plan within 3 months, Form A within 4 months of year end). */
export function calendar(fy: number) {
  return [
    { key: 'start', date: `${fy}-04-01`, label: `Compliance year ${fyLabel(fy)} starts` },
    { key: 'plan', date: `${fy}-06-30`, label: 'Monitoring plan for the year' },
    { key: 'end', date: `${fy + 1}-03-31`, label: 'Compliance year ends' },
    { key: 'formA', date: `${fy + 1}-07-31`, label: 'Verified emissions report, Form A and Form B (ACVA) to BEE' },
  ];
}
