/**
 * EKOTRACE SME — calculation engine (pure: no database, no HTTP).
 *
 * Every function takes the company's module documents (`d`) and the active platform settings
 * (`cfg`, see settings.ts) and returns plain numbers. Inputs are user JSON, so they are read
 * defensively through n() rather than typed field by field. test/sme.test.ts pins the example
 * company's figures to the approved prototype.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * EKOTRACE SME — calculation engine.
 *
 * Pure functions only: no database, no HTTP. Every function takes the company's
 * module data (`d`) and the active admin settings (`cfg`) and returns plain numbers.
 * The same rules ran in the clickable prototype; tests in ../test/calc.test.js pin
 * the example company's figures so a change here cannot drift silently.
 *
 *   d   = { profile, emissions, esg, certs, footprint, bills, solar, credits, calendar,
 *           epr, dpdp, people, csr, cbam, eudr, srmm, share, loan, scrap }
 *   cfg = { factors, cbam, tariffs, solar, schemes, requirements, calendar, srmm_mfg,
 *           srmm_svc, esg, dpdp, energy, credit_pool, today }
 */

import { EXTRA_KEYS, plantList, plantQuantities, sourceQuality, sourceTotal, withTotals } from './emisSites.js';
import { billsYear, yearMode } from './billYear.js';
import { plan } from './plan.js';
import { csrPosition, eprPosition, requirementList, schemeList } from './rules.js';

export const n = (v: any): number => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);
export const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;

/* ------------------------------------------------------------------ emissions */
/**
 * Scope 1, 2, 3 from yearly totals per source (emissions.<key>; see emisSites.ts for months and plants).
 * Scope 2 is reported both ways (GHG Protocol): location-based with the CEA grid factor (s2, used
 * everywhere else), and market-based, where renewable electricity bought (open access, green tariff,
 * I-RECs: emissions.green kWh, part of the grid units) counts as zero. India publishes no residual-mix
 * factor, so the rest of the grid units keep the CEA factor.
 */
export function emissions(d: any, cfg: any): any {
  const act = d.emissions || {};
  const F = cfg.factors.items;
  const keys = Object.keys(F);
  const qty = (doc: any, k: string) => sourceTotal(doc, k);
  const pe = d.priorYear && d.priorYear.emissions ? d.priorYear.emissions : null;
  const rows = keys.map((k: any) => {
    const q = sourceQuality(act, k);
    const quantity = qty(act, k);
    return {
      key: k,
      label: F[k].label,
      unit: F[k].unit,
      scope: F[k].scope,
      category: F[k].category || null,
      quantity,
      factor: F[k].factor,
      tco2e: (quantity * F[k].factor) / 1000,
      source: F[k].source || null,
      quality: q.status, months: q.months, partial: q.partial,
      priorQuantity: pe ? qty(pe, k) : null,
      priorTco2e: pe ? (qty(pe, k) * F[k].factor) / 1000 : null,
    };
  });
  const sum = (s: number, f: (r: any) => number = (r) => r.tco2e) => rows.filter((r: any) => r.scope === s).reduce((a: any, r: any) => a + f(r), 0);
  const s1 = sum(1), s2 = sum(2), s3 = sum(3);
  const turnover = n(d.profile && d.profile.turnover);
  const grid = qty(act, 'grid'), solar = qty(act, 'solar');
  const gridF = n(F.grid && F.grid.factor);
  const green = Math.min(qty(act, 'green'), grid);
  const s2Market = Math.max(0, s2 - (green * gridF) / 1000);

  // last year: source by source when its document is there, else the stored total only
  let prior: any = null;
  if (pe) {
    const p1 = sum(1, (r) => r.priorTco2e), p2 = sum(2, (r) => r.priorTco2e), p3 = sum(3, (r) => r.priorTco2e);
    const pg = Math.min(qty(pe, 'green'), qty(pe, 'grid'));
    prior = { fy: d.priorYear.fy || null, bySource: true, s1: p1, s2: p2, s3: p3, total: p1 + p2, withS3: p1 + p2 + p3, s2Market: Math.max(0, p2 - (pg * gridF) / 1000) };
  } else if (d.priorYear && n(d.priorYear.total) > 0) {
    prior = { fy: d.priorYear.fy || null, bySource: false, total: n(d.priorYear.total) };
  }

  // data quality over Scope 1 and 2 (Scope 3 is optional, so empty Scope 3 sources are not "missing")
  const s12 = rows.filter((r: any) => r.scope !== 3);
  const tq = (st: string) => s12.filter((r: any) => r.quality === st).reduce((a: any, r: any) => a + r.tco2e, 0);
  const measuredT = tq('measured'), estimatedT = tq('estimated');
  const quality = {
    measuredT, estimatedT,
    measuredPct: s1 + s2 > 0 ? (measuredT / (s1 + s2)) * 100 : 0,
    estimated: rows.filter((r: any) => r.quality === 'estimated').map((r: any) => r.key),
    missing: s12.filter((r: any) => r.quality === 'missing').map((r: any) => r.key),
    partial: rows.filter((r: any) => r.partial).map((r: any) => r.key),
  };

  // per plant (only meaningful with more than one; a single-site company is all "Main plant")
  const plants = plantList(d.profile);
  const pq = plantQuantities(act, [...keys, ...EXTRA_KEYS], plants);
  const byPlant = Object.keys(pq).map((id) => {
    const q = pq[id]!, pl = plants.find((p) => p.id === id);
    const t = (s: number) => keys.filter((k) => F[k].scope === s).reduce((a, k) => a + (n(q[k]) * F[k].factor) / 1000, 0);
    const ps1 = t(1), ps2 = t(2), pg = Math.min(n(q.green), n(q.grid));
    const bySource = Object.fromEntries(keys.map((k) => [k, (n(q[k]) * F[k].factor) / 1000]));
    return { id, name: pl ? pl.name : 'Plant no longer listed', listed: !!pl, city: pl?.city || '', state: pl?.state || '', s1: ps1, s2: ps2, s3: t(3), total: ps1 + ps2, s2Market: Math.max(0, ps2 - (pg * gridF) / 1000), quantities: q, bySource };
  }).filter((p) => p.listed || p.total + p.s3 > 0);

  return {
    rows,
    s1, s2, s3,
    total: s1 + s2,
    withS3: s1 + s2 + s3,
    s2Location: s2, s2Market, totalMarket: s1 + s2Market, greenKwh: green,
    intensity: turnover > 0 ? (s1 + s2) / turnover : 0,
    renewablePct: grid + solar > 0 ? ((solar + green) / (grid + solar)) * 100 : 0,
    solarPct: grid + solar > 0 ? (solar / (grid + solar)) * 100 : 0,
    prior,
    change: prior && prior.total > 0 ? ((s1 + s2 - prior.total) / prior.total) * 100 : null,
    quality,
    plants: byPlant,
    factorVersion: cfg.factors.version || null,
  };
}

export function energyGJ(d: any, cfg: any): any {
  const a = d.emissions || {};
  const E = cfg.energy; // GJ per unit
  let fossil = 0;
  for (const k of Object.keys(E.fuels)) fossil += sourceTotal(a, k) * E.fuels[k];
  const grid = sourceTotal(a, 'grid'), sol = sourceTotal(a, 'solar');
  const elec = (grid + sol) * E.kwh;
  // renewable: rooftop solar plus renewable electricity bought (part of the grid units)
  const re = (sol + Math.min(sourceTotal(a, 'green'), grid)) * E.kwh;
  const total = fossil + elec;
  return { total, re, pct: total > 0 ? (re / total) * 100 : 0 };
}

export function msmeClass(d: any, cfg: any): any {
  const t = n(d.profile && d.profile.turnover);
  const L = cfg.requirements.msme_turnover_cr; // {micro, small, medium}
  return t <= L.micro ? 'Micro' : t <= L.small ? 'Small' : t <= L.medium ? 'Medium' : 'Large';
}

/* ------------------------------------------------------------------ people & safety */
export function safety(d: any): any {
  const p = d.people || {};
  const log = Array.isArray(p.log) ? p.log : [];
  const lti = log.filter((x: any) => n(x.days) > 0).length;
  const hours = n(d.profile && d.profile.employees) * n(p.hours || 2400);
  return { lti, hours, ltifr: hours > 0 ? (lti * 1e6) / hours : 0, entries: log.length };
}

/* ------------------------------------------------------------------ certifications */
export function hasCert(d: any, id: any): any {
  const c = (d.certs || []).find((x: any) => x.id === id);
  return !!(c && c.level && c.level !== 'none');
}
export function heldCertCount(d: any): any {
  return (d.certs || []).filter((x: any) => x.level && !['none', 'inprogress', 'committed'].includes(x.level)).length;
}

/* ------------------------------------------------------------------ ESG readiness */
export const LEVELS = ['Not yet rated', 'Formative', 'Developing', 'Emerging', 'Established'];
export function levelFor(pct: any, eligible: any): any {
  // Same bands as ICAI's SRMM summary sheet: >30, >50, >65, >80 (fractions).
  if (!eligible) return 0;
  return pct > 0.8 ? 4 : pct > 0.65 ? 3 : pct > 0.5 ? 2 : pct > 0.3 ? 1 : 0;
}

export function esgScore(d: any, cfg: any): any {
  const e = d.esg || {}, a = d.emissions || {}, em = emissions(d, cfg), sf = safety(d);
  const W = cfg.esg.weights;
  const checks: Record<'env' | 'soc' | 'gov', [string, boolean][]> = {
    env: [
      ['energy_tracked', n(a.grid) > 0 || n(a.diesel) > 0],
      ['water_tracked', n(e.water) > 0],
      ['waste_tracked', n(e.waste) > 0],
      ['recycling_50', n(e.recycled) >= 50],
      ['renewables', em.renewablePct > 0],
      ['target', !!e.target],
      ['ems', hasCert(d, 'iso14001')],
    ],
    soc: [
      ['headcount', n(d.profile && d.profile.employees) > 0],
      ['women_recorded', n(e.women) > 0],
      ['safety_log', sf.entries > 0 || !!(d.people && d.people.noIncidents)],
      ['zero_lti', (sf.entries > 0 || !!(d.people && d.people.noIncidents)) && sf.lti === 0],
      ['min_wage', !!e.minwage],
      ['posh', !!e.posh],
      ['training', n(e.training) > 0],
    ],
    gov: [
      ['coc', !!e.coc],
      ['abc', !!e.abc],
      ['grievance', !!e.grievance],
      ['privacy', !!e.privacy],
      ['supplier_code', !!e.supplierCode],
      ['owner_esg', !!e.ownerEsg],
    ],
  };
  const score = (sec: 'env' | 'soc' | 'gov') => {
    const list = checks[sec];
    const max = list.reduce((s: any, [k]: any) => s + n(W[sec][k]), 0);
    const got = list.reduce((s: any, [k, ok]: any) => s + (ok ? n(W[sec][k]) : 0), 0);
    return max > 0 ? (got / max) * 100 : 0;
  };
  const E = score('env'), S = score('soc'), G = score('gov');
  const overall = (E + S + G) / 3;
  const eligible = Math.min(E, S, G) >= 30;
  // Readiness uses ">= 30" for level 1 (a fully self-assessed score of exactly 30 counts).
  let level = 0;
  if (eligible) level = overall > 80 ? 4 : overall > 65 ? 3 : overall > 50 ? 2 : overall >= 30 ? 1 : 0;
  const gaps: any[] = [];
  if (!e.target) gaps.push({ text: 'Set an energy or emission reduction target', gain: `+${W.env.target} Environment` });
  if (!hasCert(d, 'iso14001')) gaps.push({ text: 'Adopt ISO 14001 or a basic environmental system', gain: `+${W.env.ems} Environment`, go: 'certs' });
  if (!e.abc) gaps.push({ text: 'Adopt an anti-bribery policy', gain: `+${W.gov.abc} Governance` });
  if (!e.privacy) gaps.push({ text: 'Publish a data privacy policy', gain: `+${W.gov.privacy} Governance`, go: 'dpdp' });
  if (!e.supplierCode) gaps.push({ text: 'Issue a supplier code of conduct', gain: `+${W.gov.supplier_code} Governance` });
  if (sf.lti > 0) gaps.push({ text: 'Bring lost-time injuries to zero', gain: `+${W.soc.zero_lti} Social`, go: 'people' });
  return { E, S, G, overall, eligible, level, levelName: LEVELS[level], gaps };
}

/* ------------------------------------------------------------------ SRMM (ICAI utility logic) */
export function srmmVersion(d: any): any {
  const v = d.srmm && d.srmm.version;
  if (v === 'mfg' || v === 'svc') return v;
  return d.profile && d.profile.sector === 'svc' ? 'svc' : 'mfg';
}
export function srmmBank(d: any, cfg: any): any {
  return srmmVersion(d) === 'svc' ? cfg.srmm_svc : cfg.srmm_mfg;
}
export function srmmScore(d: any, cfg: any, id: any): any {
  const ver = srmmVersion(d), bank = srmmBank(d, cfg);
  const q = bank.items.find((x: any) => x.id === id);
  const sm = d.srmm || {};
  const key = `${ver}_${id}`;
  if (q && q.parts) {
    const vals = q.parts.map(([k]: any) => (sm.multi || {})[`${key}_${k}`]);
    if (vals.every((x: any) => x === '' || x === null || x === undefined)) return null;
    return vals.reduce((s: any, x: any) => s + n(x), 0);
  }
  const v = (sm.scores || {})[key];
  return v === '' || v === null || v === undefined ? null : n(v);
}

/** Scores the platform can back from the company's own data (never more generous than the evidence). */
export function srmmSuggest(d: any, cfg: any, id: any): any {
  const svc = srmmVersion(d) === 'svc';
  const e = d.esg || {}, p = d.profile || {}, em = emissions(d, cfg), cs = csr(d, cfg), ep = epr(d), sf = safety(d);
  const certs = heldCertCount(d), w = n(e.women);
  const ID: Record<string, string> = svc
    ? { waste: 'B10', certs: 'B11', safety: 'B19', s12: 'B36', s3: 'B37', privacy: 'B50' }
    : { waste: 'B11', certs: 'B12', safety: 'B20', s12: 'B37', s3: 'B38', privacy: 'B55', epr: 'B9' };
  const concept = Object.keys(ID).find((k: any) => ID[k] === id) || id;
  switch (concept) {
    case 'A2': return e.ownerEsg ? [1, 'A named owner is responsible for ESG. Add composition and responsibilities for 2.'] : [0, 'No ESG owner named.'];
    case 'A3': return e.ownerEsg ? [1, 'Highest authority for ESG identified.'] : null;
    case 'A5': return em.total > 0 ? [1, 'Internal assessment only. Rises to 2 once CA limited assurance is complete.'] : null;
    case 'A8': return svc ? [w > 30 ? 2 : w >= 10 ? 1 : 0, `Women are ${Math.round(w)}% of the workforce.`] : [w > 10 ? 2 : w >= 5 ? 1 : 0, `Women are ${Math.round(w)}% of the workforce.`];
    case 'A10': {
      const g = d.grievances || { total: 0, resolved: 0 };
      if (!e.grievance) return [0, 'No grievance mechanism.'];
      if (!g.total) return [3, 'Mechanism in place and no complaints received.'];
      const r = g.resolved / g.total;
      return [r > 0.8 ? 3 : r >= 0.6 ? 2 : 1, `${g.resolved} of ${g.total} grievances resolved.`];
    }
    case 'A13': return e.target ? [2, 'A reduction target is set.'] : [0, 'No targets set.'];
    case 'B1': return e.abc ? [2, 'Anti-bribery policy in place.'] : e.coc ? [1, 'Code of conduct only, no formal anti-bribery policy.'] : [0, 'No policy.'];
    case 'epr': return p.plastics ? (ep.registered && ep.gap <= 0 ? [3, 'EPR registered and obligation covered.'] : ep.registered ? [2, `Registered; ${round(ep.gap, 1)} t certificate gap open.`] : [1, 'EPR applies but not registered.']) : null;
    case 'waste': return n(e.waste) > 0 ? [2, 'Total waste reported. Add type and disposal split for 3.'] : [0, 'Waste not reported.'];
    case 'certs': return [certs >= 2 ? 3 : certs === 1 ? 2 : 0, `${certs} certification${certs === 1 ? '' : 's'} held.`];
    case 'safety': return sf.lti === 0 ? [4, 'No lost-time injuries this year.'] : [2, `Injury rate (LTIFR ${round(sf.ltifr, 2)}) disclosed. Show a year-on-year reduction for 3.`];
    case 'B31': return e.grievance ? [2, 'Grievance channel covers human rights issues.'] : [0, 'No mechanism.'];
    case 'B33': {
      const g = energyGJ(d, cfg);
      if (g.total <= 0) return null;
      return [g.pct > 10 ? 5 : g.pct >= 5 ? 3 : g.pct > 0 ? 1 : 0, `Renewable share of total energy is ${round(g.pct, 1)}% (${Math.round(g.re)} of ${Math.round(g.total)} GJ).`];
    }
    case 'B34': return n(e.water) > 0 ? [2, 'Water use recorded, not assured.'] : [0, 'Water not recorded.'];
    case 'B35': return n(e.water) > 0 ? [1, 'Total only. Add source split and water-stress check for 3.'] : null;
    case 's12': return em.total > 0 ? [d.priorYear && n(d.priorYear.total) > 0 ? 3 : 1, d.priorYear && n(d.priorYear.total) > 0 ? 'Scope 1 and 2 with intensity and trend vs the prior year.' : 'Scope 1 and 2 calculated. Add prior-year data to show the trend for 3.'] : [0, 'Not calculated.'];
    case 's3': return em.s3 > 0 ? [3, 'Scope 3 calculated for some categories.'] : [0, 'Scope 3 not tracked.'];
    case 'privacy': return e.privacy ? [3, svc ? 'Policy in place, not independently certified (ISO 27001 or SOC 2 for 5).' : 'Data privacy policy in place.'] : [0, `No data privacy policy. DPDP checklist ${Math.round(dpdpPct(d, cfg))}% done.`];
    case 'C5': return n(e.recycled) >= 50 ? [2, `${Math.round(n(e.recycled))}% of waste recycled.`] : null;
    case 'C6': return !svc && (d.footprint && (d.footprint.products || []).length) ? [1, 'Simplified product footprints calculated in-house.'] : null;
    case 'C9': return e.supplierCode ? [2, 'Supplier code issued.'] : [0, 'No supplier code.'];
    case 'C14': return cs.applies ? (n(d.csr && d.csr.spent) >= cs.obligation ? [3, '2% CSR spent.'] : n(d.csr && d.csr.spent) > 0 ? [1, 'CSR spent below 2%.'] : null) : null;
    default: return null;
  }
}

export function srmm(d: any, cfg: any): any {
  const bank = srmmBank(d, cfg);
  const sec: any = {};
  for (const k of ['A', 'B', 'C']) {
    const qs = bank.items.filter((q: any) => q.s === k);
    const max = qs.reduce((a: any, q: any) => a + q.max, 0);
    const got = qs.reduce((a: any, q: any) => a + (srmmScore(d, cfg, q.id) || 0), 0);
    const open = qs.filter((q: any) => srmmScore(d, cfg, q.id) === null).length;
    sec[k] = { max, min: max * 0.3, got, pct: max ? got / max : 0, open, eligible: got >= max * 0.3 };
  }
  const max = sec.A.max + sec.B.max + sec.C.max;
  const got = sec.A.got + sec.B.got + sec.C.got;
  const pct = max ? got / max : 0;
  const eligible = sec.A.eligible && sec.B.eligible && sec.C.eligible;
  const level = levelFor(pct, eligible);
  const suggestions = bank.items
    .map((q: any) => ({ id: q.id, s: srmmSuggest(d, cfg, q.id) }))
    .filter((x: any) => x.s && String(srmmScore(d, cfg, x.id)) !== String(x.s[0]))
    .map((x: any) => ({ id: x.id, score: x.s[0], reason: x.s[1] }));
  return {
    version: srmmVersion(d),
    versionLabel: bank.label,
    sections: sec,
    max, got, pct,
    open: sec.A.open + sec.B.open + sec.C.open,
    indicators: bank.items.length,
    eligible, level,
    label: level ? `Level ${level} – ${LEVELS[level]}` : 'Below Level 1 – Not Rated',
    suggestions,
  };
}

/* ------------------------------------------------------------------ CBAM (EU, UK) */
export function cbam(d: any, cfg: any): any {
  const p = d.profile || {}, cb = d.cbam || {}, C = cfg.cbam, F = cfg.factors.items, em = emissions(d, cfg);
  const prod = n(p.production);
  const good = p.cbamGood || 'none';
  const precursor = good === 'steel' ? (n(d.emissions && d.emissions.steel) * F.steel.factor) / 1000
    : good === 'aluminium' ? (n(d.emissions && d.emissions.alu) * F.alu.factor) / 1000 : 0;
  const directOnly = (C.direct_only_goods || ['steel', 'aluminium']).includes(good);
  const embedded = em.s1 + precursor + (directOnly ? 0 : em.s2);
  const see = prod > 0 ? embedded / prod : 0;
  const bench = cb.benchmark !== undefined && cb.benchmark !== '' ? n(cb.benchmark) : n((C.benchmarks || {})[good]);
  const price = cb.price !== undefined && cb.price !== '' ? n(cb.price) : n(C.eu_price_eur);
  const eurInr = cb.eurInr !== undefined && cb.eurInr !== '' ? n(cb.eurInr) : n(C.eur_inr);
  const defVal = cb.defaultValue !== undefined && cb.defaultValue !== '' ? n(cb.defaultValue) : n((C.default_values || {})[good]);
  const freeShare = n(C.free_allocation_share); // e.g. 0.975 for 2026
  const pay = (s: number) => Math.max(0, s - freeShare * bench) * n(cb.tonnesEU) * price;
  const actualEur = pay(see), defaultEur = pay(defVal);
  const ukPrice = cb.ukPrice !== undefined && cb.ukPrice !== '' ? n(cb.ukPrice) : n(C.uk_price_gbp);
  const gbpInr = cb.gbpInr !== undefined && cb.gbpInr !== '' ? n(cb.gbpInr) : n(C.gbp_inr);
  const ukGbp = see * n(cb.tonnesUK) * ukPrice;
  return {
    applies: !!p.euExport && good !== 'none',
    good, see, directOnly, precursor, embedded,
    benchmark: bench, price, eurInr, defaultValue: defVal, freeShare,
    actualEur, defaultEur, saveEur: defaultEur - actualEur,
    actualInr: actualEur * eurInr, defaultInr: defaultEur * eurInr, saveInr: Math.max(0, defaultEur - actualEur) * eurInr,
    ukGbp, ukInr: ukGbp * gbpInr, ukPrice, gbpInr,
  };
}

/* ------------------------------------------------------------------ electricity bill analyser */
export function bills(d: any, cfg: any): any {
  const T = cfg.tariffs.default || {};
  const b = Object.assign({}, T, d.bills || {});
  // up to 12 monthly bills (billYear.ts); otherwise one month's bill shown as a year (×12)
  if (yearMode(b)) return billsYear(b);
  const excess = Math.max(0, n(b.md) - n(b.cd));
  const excessCost = excess * n(b.demandRate) * n(b.excessMult) * 12;
  const newCd = Math.ceil((n(b.md) * 1.05) / 5) * 5;
  const cdIncrease = Math.max(0, newCd - n(b.cd)) * n(b.demandRate) * 12;
  const cdSave = Math.max(0, excessCost - cdIncrease);
  const pf = Math.min(Math.max(n(b.pf) || 0.99, 0.5), 0.999);
  const kw = n(b.md) * pf;
  const kvar = Math.max(0, kw * (Math.tan(Math.acos(pf)) - Math.tan(Math.acos(0.99))));
  const kvarRounded = Math.ceil(kvar / 5) * 5;
  const capex = kvarRounded * n(b.capCost);
  const pfSave = n(b.pfPenalty) * 12;
  const shiftKwh = (n(b.units) * n(b.peakShare) / 100) * (n(b.shiftPct) / 100);
  const todSave = shiftKwh * (n(b.peakSur) + n(b.offRebate)) * 12;
  const findings = [];
  if (excess > 0) findings.push({ kind: 'fix', code: 'cd', text: `Maximum demand ${n(b.md)} kVA is above contract demand ${n(b.cd)} kVA.`, action: `Raise contract demand to ${newCd} kVA.`, saving: cdSave });
  if (n(b.pfPenalty) > 0) findings.push({ kind: 'fix', code: 'pf', text: `Power factor ${b.pf} is drawing a penalty of ₹${Math.round(n(b.pfPenalty))} a month.`, action: `Install ${kvarRounded} kVAr of capacitors (APFC panel).`, saving: pfSave, capex });
  if (todSave > 0) findings.push({ kind: 'option', code: 'tod', text: `${n(b.peakShare)}% of units are in peak hours.`, action: `Move ${n(b.shiftPct)}% of that load to off-peak.`, saving: todSave });
  return { mode: 'one', inputs: b, excess, excessCost, newCd, cdIncrease, cdSave, kvarRounded, capex, pfSave, pfPaybackMonths: pfSave > 0 ? (capex / pfSave) * 12 : 0, shiftKwh, todSave, total: cdSave + pfSave + todSave, findings };
}

/* ------------------------------------------------------------------ rooftop solar */
export function solar(d: any, cfg: any): any {
  const st = (d.profile && d.profile.state) || 'default';
  const D = Object.assign({}, cfg.solar.default, (cfg.solar.states || {})[st] || {});
  const s = Object.assign({}, D, d.solar || {});
  const byRoof = (n(s.roof) * n(s.usable)) / 100 / n(s.m2PerKw || 10);
  const byLoad = n(d.emissions && d.emissions.grid) / Math.max(1, n(s.yieldKwp));
  const kw = Math.floor(Math.min(byRoof, byLoad));
  const gen = kw * n(s.yieldKwp), save = gen * n(s.tariff), cost = kw * n(s.costKw);
  const grid = cfg.factors.items.grid.factor;
  return { inputs: s, byRoof, byLoad, kw, gen, save, cost, paybackYears: save > 0 ? cost / save : 0, co2: (gen * grid) / 1000, limitedBy: byRoof < byLoad ? 'roof area' : 'your consumption' };
}

/* ------------------------------------------------------------------ carbon credit pool */
export function credits(d: any, cfg: any): any {
  const c = d.credits || {}, s = solar(d, cfg);
  const grid = cfg.factors.items.grid.factor;
  const solarGen = n(c.newSolarKw) * n(s.inputs.yieldKwp);
  const t = ((solarGen + n(c.effKwh)) * grid) / 1000;
  const P = cfg.credit_pool;
  const price = c.price !== undefined && c.price !== '' ? n(c.price) : n(P.price_inr);
  const share = c.share !== undefined && c.share !== '' ? n(c.share) : n(P.management_share_pct);
  const gross = t * price, mine = gross * (1 - share / 100);
  return { solarGen, tco2e: t, price, share, gross, mine, poolOthers: n(P.pool_tco2e_others), pool: n(P.pool_tco2e_others) + t, viableAt: n(P.viable_at_tco2e) };
}

/* ------------------------------------------------------------------ CSR (Companies Act s.135) */
export function csr(d: any, cfg: any): any {
  return csrPosition(d, cfg); // rules.ts: threshold, 2% obligation, spending entries, unspent amount
}

/* ------------------------------------------------------------------ EPR */
export function epr(d: any, cfg?: any): any {
  return eprPosition(d, cfg || { requirements: {} }); // rules.ts: plastic, e-waste and battery obligations
}

/* ------------------------------------------------------------------ DPDP */
/** A DPDP checklist tick: the current form { done, … } or the first version's plain true. */
const dpdpTick = (d: any, key: string) => { const dp = d.dpdp || {}; const v = (dp.checks || {})[key] ?? dp[key]; return v === true || !!(v && v.done); };
export function dpdpPct(d: any, cfg: any): any {
  const items = cfg.dpdp.items;
  const done = items.filter((x: any) => dpdpTick(d, x.key)).length;
  return items.length ? (done / items.length) * 100 : 0;
}
/** DPDP position: checklist by area, register, breaches past 72 hours, requests past 90 days. */
export function dpdp(d: any, cfg: any): any {
  const dp = d.dpdp || {}, items = cfg.dpdp.items || [], now = cfg.today ? new Date(cfg.today).getTime() : Date.now();
  const areas = (cfg.dpdp.areas || []).map((a: any) => {
    const its = items.filter((x: any) => x.area === a.key);
    const done = its.filter((x: any) => dpdpTick(d, x.key)).length;
    return { key: a.key, title: a.title, done, total: its.length, pct: its.length ? (done / its.length) * 100 : 0 };
  });
  const breaches = (dp.breaches || []).map((b: any) => {
    const found = Date.parse(b.found || '');
    const late = !b.boardAt && Number.isFinite(found) && now - found > 72 * 3600e3;
    return { open: !b.closed, late };
  });
  const requests = (dp.requests || []).map((r: any) => {
    const got = Date.parse(r.received || '');
    return { open: !r.closed, late: !r.closed && Number.isFinite(got) && now - got > 90 * 86400e3 };
  });
  return {
    pct: dpdpPct(d, cfg), done: items.filter((x: any) => dpdpTick(d, x.key)).length, total: items.length, areas,
    register: (dp.register || []).length, children: (dp.register || []).some((x: any) => x.children),
    breachesOpen: breaches.filter((x: any) => x.open).length, breachesLate: breaches.filter((x: any) => x.late).length,
    requestsOpen: requests.filter((x: any) => x.open).length, requestsLate: requests.filter((x: any) => x.late).length,
  };
}

/* ------------------------------------------------------------------ product footprint */
export function footprint(d: any, cfg: any): any {
  const em = emissions(d, cfg), F = cfg.factors.items, M = cfg.factors.materials;
  const prods = (d.footprint && d.footprint.products) || [];
  return prods.map((pr: any) => {
    const share = n(pr.share) / 100;
    const prodT = n(d.profile && d.profile.production) * share;
    const site = prodT > 0 ? (em.total * share) / prodT : 0;
    const rows = [
      ['Site energy & fuels (allocated)', site],
      ['Steel input', (n(pr.steelPerT) * F.steel.factor) / 1000],
      ['Zinc plating', (n(pr.zincKgPerT) * n(M.zinc_kg)) / 1000],
      ['Plastic packaging', (n(pr.packKgPerT) * n(M.plastic_kg)) / 1000],
      ['Outbound transport', (n(pr.outTkm) * F.road.factor) / 1000],
    ];
    const perT = rows.reduce((a: any, r: any) => a + r[1], 0);
    return { name: pr.name, rows, perTonne: perT, perKg: perT, per1000Pieces: perT * n(pr.pieceG) };
  });
}

/* ------------------------------------------------------------------ compliance calendar */
export function nextAnnual(today: any, m: any, day: any): any {
  let dt = new Date(Date.UTC(today.getUTCFullYear(), m - 1, day));
  if (dt < today) dt = new Date(Date.UTC(today.getUTCFullYear() + 1, m - 1, day));
  return dt;
}
export function nextMonthly(today: any, day: any): any {
  let dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day));
  if (dt < today) dt = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, day));
  return dt;
}
/** The company's own dates on the calendar ({ id, title, date, repeat: 'yearly' | 'once', notes }), cleaned. */
export function ownDates(c: any): any[] {
  const list = Array.isArray(c && c.custom) ? c.custom : [];
  return list.filter((x: any) => x && typeof x.title === 'string' && x.title.trim() && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && !isNaN(Date.parse(x.date + 'T00:00:00Z')))
    .slice(0, 100).map((x: any) => ({ id: String(x.id || x.date + x.title).slice(0, 40), title: x.title.trim().slice(0, 120), date: x.date, repeat: x.repeat === 'yearly' ? 'yearly' : 'once', notes: typeof x.notes === 'string' ? x.notes.slice(0, 500) : '' }));
}
export function calendar(d: any, cfg: any): any {
  const now = cfg.today instanceof Date ? cfg.today : new Date();
  // whole days, counted on the Indian calendar date (IST, UTC+5:30), so an item due today is "due today" all day
  const ist = new Date(now.getTime() + 330 * 60e3);
  const today = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const p = d.profile || {}, c = d.calendar || {}, done = c.done || {};
  const out: any[] = [];
  const flags: Record<string, boolean> = {
    always: true,
    plastics: !!p.plastics, ewaste: !!p.ewaste, battery: !!p.battery,
    listedBuyer: !!p.listedBuyer,
    cbam: !!p.euExport && (p.cbamGood || 'none') !== 'none',
    ukCbam: !!p.ukExport && (p.cbamGood || 'none') !== 'none',
    csr: csr(d, cfg).applies,
  };
  const stateOverrides = ((cfg.calendar.states || {})[p.state]) || {};
  for (const t of cfg.calendar.templates) {
    if (!flags[t.when || 'always']) continue;
    const o = Object.assign({}, t, stateOverrides[t.id] || {});
    let date: Date | undefined;
    if (o.kind === 'monthly') date = nextMonthly(today, o.day);
    else if (o.kind === 'annual') date = nextAnnual(today, o.month, o.day);
    else if (o.kind === 'fixed') date = new Date(o.date + 'T00:00:00Z');
    else if (o.kind === 'company') { if (!c[o.field]) continue; date = new Date(c[o.field] + 'T00:00:00Z'); }
    if (!date || isNaN(date.getTime())) continue;
    out.push({ id: o.id, title: o.title, date, freq: o.freq, who: o.who, go: o.go || null, repeat: o.kind === 'monthly' ? 'monthly' : o.kind === 'annual' ? 'yearly' : null });
  }
  for (const x of d.certs || []) {
    if (x.level && x.level !== 'none' && x.expiry) out.push({ id: 'cert-' + x.id, title: `${x.name} renewal`, date: new Date(x.expiry + 'T00:00:00Z'), freq: 'Certificate expiry', who: 'Certifying body', go: 'certs', repeat: null });
  }
  for (const x of ownDates(c)) {
    let date = new Date(x.date + 'T00:00:00Z');
    if (x.repeat === 'yearly' && date < today) date = nextAnnual(today, date.getUTCMonth() + 1, date.getUTCDate());
    out.push({ id: 'own-' + x.id, title: x.title, date, freq: x.repeat === 'yearly' ? 'Every year' : 'Once', who: 'Your own date', go: null, repeat: x.repeat === 'yearly' ? 'yearly' : null, own: true, notes: x.notes });
  }
  for (const x of out) {
    if (isNaN(x.date.getTime())) { x.drop = true; continue; }
    x.days = Math.round((x.date - (today as any)) / 864e5);
    x.status = done[x.id] ? 'done' : x.days < 0 ? 'overdue' : x.days <= cfg.calendar.soon_days ? 'soon' : 'later';
    x.date = x.date.toISOString().slice(0, 10);
  }
  return out.filter((x) => !x.drop).sort((a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ------------------------------------------------------------------ requirements ("What applies") */
export function requirements(d: any, cfg: any): any {
  return requirementList(d, cfg, { sr: srmm(d, cfg), dp: dpdpPct(d, cfg), cs: csr(d, cfg), ep: epr(d, cfg), cls: msmeClass(d, cfg) });
}

/* ------------------------------------------------------------------ schemes */
export function schemes(d: any, cfg: any): any {
  return schemeList(d, cfg, { cls: msmeClass(d, cfg), b: bills(d, cfg), so: solar(d, cfg), cr: credits(d, cfg), hasZed: hasCert(d, 'zed') });
}

/* ------------------------------------------------------------------ questionnaire auto-answer */
export function answer(d: any, cfg: any, q: any): any {
  const em = emissions(d, cfg), es = esgScore(d, cfg), x = String(q).toLowerCase(), s = d.esg || {}, sf = safety(d), sr = srmm(d, cfg);
  const has = (v: any) => v !== undefined && v !== null && v !== '';
  // [question pattern, the data it needs is there, answer]. Patterns are specific so a question is never
  // answered with a figure about something else; with no data the question is left for the user.
  const R: [RegExp, () => boolean, () => string][] = [
    [/scope\s*1/, () => em.s1 > 0, () => `${em.s1.toFixed(1)} tCO2e (fuels and refrigerants)`],
    [/scope\s*2/, () => em.s2 > 0, () => `${em.s2.toFixed(1)} tCO2e (grid electricity, location-based, CEA factor)`],
    [/scope\s*3/, () => true, () => (em.s3 > 0 ? `Yes. ${em.s3.toFixed(1)} tCO2e covering Cat 1, 4 and 6` : 'Not yet tracked')],
    [/(total|how much|quantity|volume).*water|water.*(withdraw|consum|use|usage|kl|litre)/, () => n(s.water) > 0, () => `${Math.round(n(s.water))} kL withdrawn`],
    [/(total|how much|quantity).*waste|waste.*(generat|recycl|tonne|quantity|disposed)/, () => n(s.waste) > 0, () => `${n(s.waste).toFixed(1)} t generated, ${Math.round(n(s.recycled))}% recycled or reused`],
    [/renewable|solar/, () => true, () => `${em.renewablePct.toFixed(1)}% of electricity from renewable sources (rooftop solar and renewable power bought)`],
    [/(share|percent|%|number|proportion).*(women|female)|gender (diversity|ratio)/, () => has(s.women), () => `${Math.round(n(s.women))}% of workforce`],
    [/injur|ltifr|lost.?time|accident/, () => true, () => `${sf.lti} lost-time injuries; LTIFR ${sf.ltifr.toFixed(2)}`],
    [/bribery|corruption/, () => true, () => `Code of conduct: ${s.coc ? 'Yes' : 'No'}. Anti-bribery policy: ${s.abc ? 'Yes' : 'No'}`],
    [/code of conduct/, () => true, () => `Code of conduct: ${s.coc ? 'Yes' : 'No'}`],
    [/iso\s*14001|environmental management system/, () => true, () => (hasCert(d, 'iso14001') ? 'Yes, ISO 14001' : 'No')],
    [/grievance|complaint mechanism/, () => true, () => (s.grievance ? 'Yes, including an anonymous QR channel for workers' : 'No')],
    [/posh|sexual harass/, () => true, () => `Internal Committee: ${(d.people || {}).posh_ic ? 'Yes' : 'No'}`],
    [/cbam|embedded emission/, () => cbam(d, cfg).see > 0, () => `${cbam(d, cfg).see.toFixed(2)} tCO2e per tonne`],
    [/privacy|dpdp|personal data/, () => true, () => `Policy: ${s.privacy ? 'Yes' : 'No'}; DPDP checklist ${Math.round(dpdpPct(d, cfg))}% complete`],
    [/headcount|number of (employees|workers|staff)|how many (employees|workers|people)|total (employees|workforce)/, () => n(d.profile && d.profile.employees) > 0, () => `${Math.round(n(d.profile && d.profile.employees))} employees`],
    [/(emission|reduction|climate|net.?zero|carbon).*target|target.*(emission|reduction|net.?zero|carbon)/, () => true, () => (s.target ? 'Yes' : 'No target set')],
    [/certif|zed/, () => true, () => (d.certs || []).filter((k: any) => k.level && k.level !== 'none').map((k: any) => k.name + (k.level !== 'held' ? ` (${k.level})` : '')).join(', ') || 'None'],
    [/(energy|electricity|fuel).*(consum|use|usage|kwh|total)|(total|how much).*(energy|electricity|fuel)/, () => n(d.emissions && d.emissions.grid) + n(d.emissions && d.emissions.diesel) > 0, () => `Grid ${Math.round(n(d.emissions && d.emissions.grid))} kWh, solar ${Math.round(n(d.emissions && d.emissions.solar))} kWh, diesel ${Math.round(n(d.emissions && d.emissions.diesel))} L`],
    [/srmm|maturity model/, () => sr.open < sr.indicators, () => `SRMM ${sr.versionLabel} self-assessed: ${(sr.pct * 100).toFixed(1)}% (${sr.label})`],
    [/esg (rating|score|readiness)/, () => true, () => `${Math.round(es.overall)}%, ${es.level ? `Level ${es.level} ${es.levelName}` : es.levelName}`],
  ];
  for (const [re, ok, fn] of R) if (re.test(x)) return ok() ? { answer: fn(), filled: true } : { answer: 'No data entered yet. Add it, or answer manually.', filled: false };
  return { answer: 'No stored data. Answer manually.', filled: false };
}

/* ------------------------------------------------------------------ full result set */
export function all(d: any, cfg: any): any {
  // every yearly total present even if only per-plant figures were saved; last year's total from its document
  d = { ...d, emissions: withTotals(d.emissions, [...Object.keys(cfg.factors.items), ...EXTRA_KEYS]) };
  const em = emissions(d, cfg);
  if (d.priorYear && !(n(d.priorYear.total) > 0) && em.prior && em.prior.total > 0) d.priorYear = { ...d.priorYear, total: em.prior.total };
  const es = esgScore(d, cfg), b = bills(d, cfg), so = solar(d, cfg), cr = credits(d, cfg);
  // price is per kg (or per litre / piece); t and kL listings are converted to kg / litres.
  const perUnit: Record<string, number> = { t: 1000, kL: 1000, kg: 1, L: 1, nos: 1 };
  const scrapValue = (d.scrap || []).reduce((a: any, x: any) => a + n(x.qty) * (perUnit[x.unit] || 1) * n(x.price), 0);
  return {
    msmeClass: msmeClass(d, cfg),
    emissions: em,
    energy: energyGJ(d, cfg),
    esg: es,
    srmm: srmm(d, cfg),
    cbam: cbam(d, cfg),
    bills: b,
    solar: so,
    credits: cr,
    csr: csr(d, cfg),
    epr: epr(d, cfg),
    dpdpPct: dpdpPct(d, cfg),
    dpdp: dpdp(d, cfg),
    safety: safety(d),
    footprint: footprint(d, cfg),
    calendar: calendar(d, cfg),
    requirements: requirements(d, cfg),
    schemes: schemes(d, cfg),
    plan: plan(d, cfg, { emissions: em, bills: b, solar: so }),
    money: { bills: b.total, solar: so.save, scrap: scrapValue, credits: cr.mine, cbamAvoidedInr: cbam(d, cfg).saveInr, savingsFound: b.total + so.save },
  };
}

