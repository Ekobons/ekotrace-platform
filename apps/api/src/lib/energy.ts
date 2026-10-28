/**
 * Energy management & savings — pure calculation (no database).
 *
 *  - Monthly energy by carrier (electricity, fuels, heat, cooling, transport), kWh.
 *  - Baseline model (IPMVP Option C, whole facility): energy = b0 + b1·x1 + b2·x2 by ordinary least squares over the
 *    baseline year's months, with up to two relevant variables (production, cooling or heating degree days, occupancy).
 *    Quality as ASHRAE Guideline 14 asks for monthly models: CV(RMSE) ≤ 15%, NMBE within ±5%; R² and t-statistics shown.
 *  - Reporting period: adjusted baseline (what the model says the site would have used) − actual = avoided energy;
 *    CUSUM of the differences; a month flagged when it is off the model, after its neighbouring months' saving, by more
 *    than 2 standard errors and 5%.
 *  - Energy performance indicators (ISO 50001 / 50006): kWh per unit of the driver; normalised against the baseline.
 *  - Measures: annual saving, cost saving at the site's tariff, simple payback, NPV over the life, cost per tCO2e.
 */

export const CARRIERS = ['electricity', 'fuel', 'heat', 'cooling', 'transport'] as const;
export type Carrier = (typeof CARRIERS)[number];
export const CARRIER_LABEL: Record<Carrier, string> = { electricity: 'Electricity', fuel: 'Fuels (on site)', heat: 'Heat & steam', cooling: 'District cooling', transport: 'Vehicle fuels' };
export const VARIABLES = ['production', 'cdd', 'hdd', 'occupancy'] as const;
export type Variable = (typeof VARIABLES)[number];
export const VARIABLE_LABEL: Record<Variable, string> = { production: 'Production', cdd: 'Cooling degree days', hdd: 'Heating degree days', occupancy: 'Occupancy (FTE)' };
export type ModelTarget = 'total' | Carrier;

export interface MonthRow {
  month: string;                                   // YYYY-MM
  energy: Partial<Record<Carrier, number | null>>; // kWh
  production?: number | null; cdd?: number | null; hdd?: number | null; occupancy?: number | null;
}
export const energyOf = (r: MonthRow, target: ModelTarget): number | null => {
  if (target !== 'total') return r.energy[target] ?? null;
  const v = CARRIERS.map((c) => r.energy[c]).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

export interface Model {
  vars: Variable[]; coef: number[]; n: number; r2: number | null; cvrmse: number | null; nmbe: number | null; se: number | null; t: (number | null)[];
  valid: boolean; problems: string[]; mean: number | null;
}

/** Solve A·x = b (small dense system) by Gaussian elimination with partial pivoting; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}
function inverse(A: number[][]): number[][] | null {
  const n = A.length, cols: number[][] = [];
  for (let j = 0; j < n; j++) { const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)); const x = solve(A, e); if (!x) return null; cols.push(x); }
  return A.map((_, i) => cols.map((c) => c[i]!));
}

/** Ordinary least squares on the baseline months that have energy and every chosen variable. */
export function fit(rows: MonthRow[], target: ModelTarget, vars: Variable[]): Model {
  const use = rows.filter((r) => energyOf(r, target) != null && vars.every((v) => r[v] != null));
  const n = use.length, p = vars.length;
  const problems: string[] = [];
  const empty: Model = { vars, coef: [], n, r2: null, cvrmse: null, nmbe: null, se: null, t: [], valid: false, problems, mean: null };
  if (n < Math.max(9, p + 3)) { problems.push(`The baseline needs at least ${Math.max(9, p + 3)} months with energy${p ? ' and every variable' : ''} (${n} now)`); return empty; }
  const X = use.map((r) => [1, ...vars.map((v) => r[v]!)]), y = use.map((r) => energyOf(r, target)!);
  const XtX = Array.from({ length: p + 1 }, (_, i) => Array.from({ length: p + 1 }, (_, j) => X.reduce((a, row) => a + row[i]! * row[j]!, 0)));
  const Xty = Array.from({ length: p + 1 }, (_, i) => X.reduce((a, row, k) => a + row[i]! * y[k]!, 0));
  const coef = solve(XtX, Xty);
  if (!coef) { problems.push('The variables do not vary enough (or move together): choose others'); return empty; }
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const yhat = X.map((row) => row.reduce((a, x, i) => a + x * coef[i]!, 0));
  const sse = y.reduce((a, v, i) => a + (v - yhat[i]!) ** 2, 0), sst = y.reduce((a, v) => a + (v - mean) ** 2, 0);
  const dof = n - p - 1;
  const se = Math.sqrt(sse / dof);
  const r2 = sst > 0 ? 1 - sse / sst : null;
  const cvrmse = mean ? (se / mean) * 100 : null;
  const nmbe = mean ? (y.reduce((a, v, i) => a + (v - yhat[i]!), 0) / (dof * mean)) * 100 : null;
  const inv = inverse(XtX);
  const t = coef.map((b, i) => (inv && inv[i]![i]! > 0 && se > 0 ? b / (se * Math.sqrt(inv[i]![i]!)) : null));
  if (cvrmse != null && cvrmse > 15) problems.push(`CV(RMSE) ${cvrmse.toFixed(1)}% is above the 15% ASHRAE Guideline 14 limit for monthly models`);
  if (nmbe != null && Math.abs(nmbe) > 5) problems.push(`NMBE ${nmbe.toFixed(2)}% is outside ±5%`);
  vars.forEach((v, i) => { const ti = t[i + 1]; if (ti != null && Math.abs(ti) < 2) problems.push(`${VARIABLE_LABEL[v]} is not significant (t = ${ti.toFixed(2)}, needs |t| ≥ 2): consider leaving it out`); });
  if (r2 != null && p > 0 && r2 < 0.75) problems.push(`R² ${r2.toFixed(2)} is low: the variables explain little of the energy use`);
  const valid = cvrmse != null && cvrmse <= 15 && nmbe != null && Math.abs(nmbe) <= 5;
  return { vars, coef, n, r2, cvrmse, nmbe, se, t, valid, problems, mean };
}
export const predict = (m: Model, r: MonthRow): number | null => (!m.coef.length || m.vars.some((v) => r[v] == null) ? null : m.coef[0]! + m.vars.reduce((a, v, i) => a + m.coef[i + 1]! * r[v]!, 0));

export interface Period { month: string; actual: number | null; expected: number | null; saving: number | null; cusum: number | null; anomaly: string | null; enpi: number | null; driver: number | null }
/**
 * The reporting months against the baseline: expected (adjusted baseline) − actual = avoided energy, its running
 * sum, and months off the model by more than 2 standard errors. Without a model, a month 25% off the same month of
 * the year before is flagged instead.
 */
export function compare(rows: MonthRow[], prior: MonthRow[], target: ModelTarget, m: Model, enpiVar: Variable | null): Period[] {
  let cum = 0, any = false;
  // savings are the new normal: each month is judged against the ratio to the model of its neighbours (two months either
  // side), so a measure that starts mid-year does not flag the months around it
  const ratio = rows.map((r) => { const a = energyOf(r, target), e = m.coef.length ? predict(m, r) : null; return a != null && e ? a / e : null; });
  const med = (xs: number[]) => { const v = [...xs].sort((x, y) => x - y); return v.length ? (v[Math.floor((v.length - 1) / 2)]! + v[Math.ceil((v.length - 1) / 2)]!) / 2 : 1; };
  return rows.map((r, i) => {
    const actual = energyOf(r, target), expected = m.coef.length ? predict(m, r) : null;
    const saving = actual != null && expected != null ? expected - actual : null;
    if (saving != null) { cum += saving; any = true; }
    let anomaly: string | null = null;
    const near = ratio.filter((x, j) => x != null && j !== i && Math.abs(j - i) <= 2) as number[];
    const typical = near.length >= 2 ? med(near) : 1;
    if (actual != null && expected != null && m.se) {
      const off = actual - typical * expected, z = off / m.se;
      // off by more than 2 standard errors and by a material amount (5% of the expected month)
      if (Math.abs(z) > 2 && Math.abs(off) > 0.05 * expected) anomaly = `${z > 0 ? 'More' : 'Less'} energy than the model and the neighbouring months suggest: ${Math.abs(off).toFixed(0)} kWh (${Math.abs(z).toFixed(1)} standard errors)`;
    } else if (actual != null) {
      const last = prior.find((p) => p.month.slice(5) === r.month.slice(5));
      const before = last ? energyOf(last, target) : null;
      if (before) { const d = (actual - before) / before; if (Math.abs(d) > 0.25) anomaly = `${d > 0 ? 'Up' : 'Down'} ${Math.round(Math.abs(d) * 100)}% on the same month last year`; }
    }
    const driver = enpiVar ? r[enpiVar] ?? null : null;
    return { month: r.month, actual, expected, saving, cusum: any && saving != null ? cum : null, anomaly, enpi: actual != null && driver ? actual / driver : null, driver };
  });
}

export interface MeasureIn { kwhYear: number | null; tariff: number | null; capex: number | null; opexYear?: number | null; lifeYears: number | null; kgPerKwh: number | null; rate?: number }
/** Measure economics: annual cost saving, simple payback, NPV over the life (8% by default), tCO2e a year, cost per tonne. */
export function economics(x: MeasureIn) {
  const save = x.kwhYear != null && x.tariff != null ? x.kwhYear * x.tariff - (x.opexYear ?? 0) : null;
  const payback = save && save > 0 && x.capex != null ? x.capex / save : null;
  const r = x.rate ?? 0.08;
  const npv = save != null && x.lifeYears ? -(x.capex ?? 0) + save * ((1 - (1 + r) ** -x.lifeYears) / r) : null;
  const t = x.kwhYear != null && x.kgPerKwh != null ? (x.kwhYear * x.kgPerKwh) / 1000 : null;
  const perT = t && x.lifeYears && npv != null ? -npv / (t * x.lifeYears) : null;   // negative = saves money per tonne
  return { saveYear: save, payback, npv, tYear: t, costPerT: perT };
}

/** Percentage change in EnPI (kWh per unit) against the baseline year's. */
export const enpiChange = (now: number | null, base: number | null) => (now != null && base ? (now - base) / base : null);
/** Months of a year as YYYY-MM. */
export const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
