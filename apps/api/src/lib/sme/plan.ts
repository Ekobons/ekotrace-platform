/**
 * EKOTRACE SME — reduction plan (pure: no database, no HTTP).
 *
 * The company picks actions from the library (setting 'actions', see defaults.ts) or adds its own, and may
 * change each one's figures. For every action: the units of a source it removes (and any units of another
 * source it adds, for a switch), tCO₂e cut a year, ₹ saved a year at the company's own prices, cost and simple
 * payback. Then a target (base year, target year, % cut) and the emissions path with the planned actions.
 *
 *   d.plan = {
 *     fy: 'FY 2025-26',                                         // the year this plan document belongs to
 *     base: 'this' | 'prior' | 'own', baseYear?, baseT?,        // own: a year (FY end year) and its Scope 1+2 total
 *     targetYear?, targetPct?, growth?,                         // growth: % a year more output, default 0
 *     prices?: { grid?, diesel?, … },                           // ₹ per unit, override the defaults
 *     items: [{ id, lib?, title?, source?, to?, share?, pct?, qty?, cost?, life?, status?, owner?, date? }]
 *   }
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { actions as ACTIONS } from './defaults.js';

const n = (v: any): number => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);
const has = (v: any) => v !== '' && v !== null && v !== undefined && !isNaN(+v);
/** the item's own value if it has one, else the library's */
const pick = (own: any, lib: any) => (has(own) ? n(own) : n(lib));

export const STATUSES = ['idea', 'planned', 'doing', 'done'] as const;
/** Planned, doing and done count towards the path; ideas do not. */
const counts = (s: string) => s === 'planned' || s === 'doing' || s === 'done';

/** End year of the Indian FY a date falls in ("2027-02-10" → 2027, "2027-05-01" → 2028). */
export function fyEnd(date: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(date || '');
  if (!m) return null;
  return Number(m[2]) >= 4 ? Number(m[1]) + 1 : Number(m[1]);
}
/** "FY 2025-26" → 2026 */
export function fyEndOf(fy: string): number | null {
  const m = /^FY (\d{4})-/.exec(fy || '');
  return m ? Number(m[1]) + 1 : null;
}
export const fyLabel = (end: number) => `FY ${end - 1}-${String(end % 100).padStart(2, '0')}`;

/** ₹ per unit of every source: the company's own price, else its bill rate (electricity) or the typical price. */
export function prices(d: any, cfg: any, bills: any): Record<string, number> {
  const own = (d.plan && d.plan.prices) || {};
  const typ = (cfg.actions && cfg.actions.prices) || ACTIONS.prices;
  const out: Record<string, number> = {};
  for (const k of Object.keys(typ)) out[k] = has(own[k]) ? n(own[k]) : n(typ[k]);
  const billRate = n(bills && bills.inputs && bills.inputs.energyRate) || n(cfg.tariffs && cfg.tariffs.default && cfg.tariffs.default.energyRate);
  out.grid = has(own.grid) ? n(own.grid) : billRate;
  out.solar = 0;
  return out;
}

/**
 * One action's figures. `ctx` = { act (yearly quantities), F (factor items), E (energy GJ per unit), price, bills, solar }.
 * Returns ready=false with `why` when it cannot be worked out yet.
 */
export function actionFigures(item: any, lib: any, ctx: any): any {
  const L = lib || {};
  const { act, F, E, price, bills, solar } = ctx;
  const options: string[] = L.sources || (L.source ? [L.source] : item.source ? [item.source] : ['grid']);
  // a fuel action uses the company's chosen fuel, else the first of its options the company actually uses
  const source: string = item.source && (options.includes(item.source) || !L.id) ? item.source : options.find((k) => n(act[k]) > 0) || options[0]!;
  const to: string | null = L.toOptions && item.to && L.toOptions.includes(item.to) ? item.to : L.to || (!L.id && item.to) || null;
  const qtySource = n(act[source]);
  const f = (k: string) => n(F[k] && F[k].factor);
  const life = pick(item.life, L.life);
  const out: any = { source, to, options, toOptions: L.toOptions || null, unit: (F[source] && F[source].unit) || '', life, share: null, pct: null, cut: 0, add: 0, addUnit: to ? (F[to] && F[to].unit) || 'kWh' : null, tco2e: 0, save: 0, cost: null as number | null, payback: null as number | null, ready: true, why: null as string | null };

  if (L.from === 'solar') {
    out.cut = n(solar.gen); out.tco2e = n(solar.co2); out.save = n(solar.save); out.cost = has(item.cost) ? n(item.cost) : n(solar.cost);
    out.kw = n(solar.kw);
    if (!(n(solar.kw) > 0)) { out.ready = false; out.why = 'Size the system on the Solar page first (roof area and grid units).'; }
  } else if (L.from === 'pf') {
    out.save = n(bills.pfSave); out.cost = has(item.cost) ? n(item.cost) : n(bills.capex); out.kvar = n(bills.kvarRounded);
    if (!(n(bills.pfSave) > 0)) { out.ready = false; out.why = 'No power factor penalty found. Enter your power bill in the Bill analyser.'; }
  } else {
    const share = Math.min(100, Math.max(0, pick(item.share, L.share ?? 100)));
    const pct = Math.min(100, Math.max(0, pick(item.pct, L.pct)));
    out.share = share; out.pct = pct;
    out.cut = qtySource * (share / 100) * (pct / 100);
    if (to) {
      // units of the new source per unit removed: given (DG: kWh per litre), else equal energy content
      const per = has(item.per) ? n(item.per) : has(L.per) ? n(L.per) : n(E.fuels && E.fuels[source]) && n(E.fuels && E.fuels[to]) ? n(E.fuels[source]) / n(E.fuels[to]) : 1;
      out.per = per;
      out.add = out.cut * per;
    }
    out.tco2e = (out.cut * f(source) - out.add * (to ? f(to) : 0)) / 1000;
    out.save = out.cut * n(price[source]) - out.add * (to ? n(price[to]) : 0);
    if (!(qtySource > 0)) { out.ready = false; out.why = `No ${(F[source] && F[source].label) || source} entered for this year in Emissions.`; }
    // cost
    const basis = (L.cost && L.cost.basis) || 'lump';
    if (has(item.cost)) out.cost = n(item.cost);
    else if (to === 'solar') {
      const y = n(solar.inputs && solar.inputs.yieldKwp), c = n(solar.inputs && solar.inputs.costKw);
      out.kw = y > 0 ? out.add / y : 0;
      out.cost = y > 0 ? out.kw * c : null;
    } else if (basis === 'lump') out.cost = n(L.cost && L.cost.rate);
    else if (has(item.qty)) out.cost = n(item.qty) * n(L.cost && L.cost.rate);
    else out.cost = null;                                   // per unit / per kW: needs the number of items
  }
  out.payback = out.cost !== null && out.save > 0 ? out.cost / out.save : null;
  return out;
}

/** The plan: every chosen action with its figures, totals, target and the emissions path. */
export function plan(d: any, cfg: any, r: { emissions: any; bills: any; solar: any }): any {
  const p = d.plan || {};
  const A = cfg.actions || ACTIONS;
  const libById: Record<string, any> = Object.fromEntries((A.items || []).map((x: any) => [x.id, x]));
  const F = cfg.factors.items, E = cfg.energy || { fuels: {} }, act = d.emissions || {};
  const price = prices(d, cfg, r.bills);
  const ctx = { act, F, E, price, bills: r.bills || {}, solar: r.solar || {} };
  // the engine is not told the year it runs for: last year's FY + 1, else the year the Plan page stored, else today's FY
  const priorEnd = fyEndOf((d.priorYear && d.priorYear.fy) || '');
  const curEnd = fyEndOf(d.fy || '') ?? (priorEnd !== null ? priorEnd + 1 : null) ?? fyEndOf(p.fy || '') ?? fyEndOf(fyNow(cfg)) ?? new Date().getUTCFullYear();
  const current = n(r.emissions && r.emissions.total);
  const prior = d.priorYear && n(d.priorYear.total) > 0 ? n(d.priorYear.total) : null;

  const rows = (Array.isArray(p.items) ? p.items : []).map((it: any) => {
    const lib = it.lib ? libById[it.lib] : null;
    if (it.lib && !lib) return null;                         // removed from the library: drop quietly
    const fig = actionFigures(it, lib, ctx);
    const status = (STATUSES as readonly string[]).includes(it.status) ? it.status : 'idea';
    const start = fyEnd(it.date) ?? (status === 'done' ? curEnd : curEnd + 1);
    return {
      id: String(it.id || ''), lib: it.lib || null, title: (lib ? lib.title : it.title) || 'Own action', status, owner: it.owner || '', date: it.date || '',
      start, achieved: status === 'done' && start <= curEnd,   // done this year or earlier: already in this year's figures
      ...fig,
    };
  }).filter(Boolean) as any[];

  // never cut more of a source than the company uses (plus what switches add to it)
  const avail: Record<string, number> = {};
  for (const x of rows) if (x.add > 0 && x.to) avail[x.to] = (avail[x.to] ?? 0) + x.add;
  const capped: string[] = [];
  for (const src of new Set(rows.map((x) => x.source))) {
    const mine = rows.filter((x) => x.source === src && x.cut > 0);
    const total = mine.reduce((a, x) => a + x.cut, 0), max = n(act[src]) + (avail[src] ?? 0);
    if (total > max && total > 0) {
      const k = max / total;
      capped.push(src);
      for (const x of mine) { x.cut *= k; x.add *= k; x.tco2e *= k; if (x.lib !== 'pf') x.save *= k; x.payback = x.cost !== null && x.save > 0 ? x.cost / x.save : null; x.capped = true; }
    }
  }

  const sum = (xs: any[], k: string) => xs.reduce((a, x) => a + (n(x[k]) || 0), 0);
  const byStatus = Object.fromEntries(STATUSES.map((s) => { const xs = rows.filter((x) => x.status === s); return [s, { count: xs.length, tco2e: sum(xs, 'tco2e'), save: sum(xs, 'save'), cost: sum(xs, 'cost') }]; }));
  const live = rows.filter((x) => counts(x.status));
  const totals = { tco2e: sum(rows, 'tco2e'), save: sum(rows, 'save'), cost: sum(rows, 'cost'), planned: { tco2e: sum(live, 'tco2e'), save: sum(live, 'save'), cost: sum(live, 'cost') }, byStatus };
  totals.planned = Object.assign(totals.planned, { payback: totals.planned.save > 0 ? totals.planned.cost / totals.planned.save : null });

  // base year: this year, last year, or a year and figure the company enters
  const T = A.target || ACTIONS.target;
  let base: any;
  if (p.base === 'prior' && prior !== null) base = { kind: 'prior', year: curEnd - 1, t: prior };
  else if (p.base === 'own' && has(p.baseT) && n(p.baseT) > 0 && has(p.baseYear)) base = { kind: 'own', year: Math.round(n(p.baseYear)), t: n(p.baseT) };
  else base = { kind: 'this', year: curEnd, t: current };
  base.label = fyLabel(base.year);
  const targetYear = Math.max(base.year + 1, Math.round(pick(p.targetYear, T.year)));
  const targetPct = Math.min(100, Math.max(0, pick(p.targetPct, T.pct)));
  const target = { year: targetYear, label: fyLabel(targetYear), pct: targetPct, t: base.t * (1 - targetPct / 100), rate15: n(T.rate_15c) };

  // the path: actual years, then this year's emissions grown by `growth`, less the counted actions from the year each starts
  const g = n(p.growth) / 100;
  const cutShare = (y: number) => (current > 0 ? Math.min(1, live.filter((x) => !x.achieved && x.start <= y).reduce((a, x) => a + x.tco2e, 0) / current) : 0);
  const path: any[] = [];
  const first = Math.min(base.year, curEnd);
  for (let y = first; y <= Math.max(targetYear, curEnd); y++) {
    const actual = y === curEnd ? current : y === curEnd - 1 && prior !== null ? prior : y === base.year ? base.t : null;
    const bau = y >= curEnd ? current * (1 + g) ** (y - curEnd) : null;
    const withPlan = bau !== null ? bau * (1 - cutShare(y)) : null;
    const tgt = y >= base.year && y <= targetYear ? base.t + ((target.t - base.t) * (y - base.year)) / (targetYear - base.year) : null;
    path.push({ year: y, label: fyLabel(y), actual, bau, withPlan, target: tgt });
  }
  const end = path.find((x) => x.year === targetYear);
  const endT = end ? n(end.withPlan) : current;
  const reaches = base.t > 0 && current > 0 ? endT <= target.t + 1e-9 : false;
  return {
    fy: fyLabel(curEnd), current, prior, change: prior ? (current - prior) / prior : null,
    prices: price, rows, totals, capped, base, target, growth: n(p.growth), path,
    endT, reaches, gap: Math.max(0, endT - target.t),
    top: [...live].sort((a, b) => b.tco2e - a.tco2e).slice(0, 3).map((x) => ({ title: x.title, tco2e: x.tco2e, save: x.save, status: x.status, start: x.start })),
  };
}

function fyNow(cfg: any): string {
  const t = cfg.today instanceof Date ? cfg.today : new Date();
  const y = t.getUTCFullYear(), s = t.getUTCMonth() >= 3 ? y : y - 1;
  return `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
