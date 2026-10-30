/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * EKOTRACE SME — the rules behind What applies, CSR, EPR and Schemes (pure: no database, no HTTP).
 * engine.ts calls these from requirements(), csr(), epr() and schemes(); values the engine already works out
 * (SRMM, DPDP, MSME class, bills, solar, credits) are passed in so this file does not import the engine.
 * Settings stored before these rules existed lack some tables; the first-version tables in rulesData.ts fill in.
 */
import { epr as EPR_DEFAULT, thresholds as T_DEFAULT } from './rulesData.js';

const n = (v: any): number => (v === '' || v === null || v === undefined || isNaN(+v) ? 0 : +v);

/** "FY 2025-26" of a date (April–March). */
export function fyOfDate(d: Date): string {
  const y = d.getUTCFullYear(), s = d.getUTCMonth() >= 3 ? y : y - 1;
  return `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
/** The financial year the figures belong to: the page's year when known, else the year of `today`. */
export function fyFor(d: any, cfg: any): string {
  const ok = (s: any) => typeof s === 'string' && /^FY \d{4}-\d{2}$/.test(s);
  if (ok(d.fy)) return d.fy;
  if (ok(d.epr && d.epr.fy)) return d.epr.fy;
  return fyOfDate(cfg.today instanceof Date ? cfg.today : cfg.today ? new Date(cfg.today) : new Date());
}
/** A table keyed by FY: that year, or the nearest earlier year, or the latest year (targets stay at the last level). */
export function byFy<V>(table: Record<string, V> | undefined, fy: string): V | undefined {
  if (!table) return undefined;
  const keys = Object.keys(table).sort();
  if (table[fy] !== undefined) return table[fy];
  const before = keys.filter((k) => k <= fy);
  const k = before.length ? before[before.length - 1] : keys[0];
  return k === undefined ? undefined : table[k];
}

/* ------------------------------------------------------------------ CSR */
export function csrPosition(d: any, cfg: any): any {
  const c = d.csr || {}, R = cfg.requirements.csr;
  const turnover = n(d.profile && d.profile.turnover);
  const applies = n(c.netWorth) >= R.net_worth_cr || turnover >= R.turnover_cr || n(c.profit3) >= R.net_profit_cr;
  const avg = (n(c.profit1) + n(c.profit2) + n(c.profit3)) / 3;
  const obligation = applies ? Math.max(0, avg * R.rate) : 0; // ₹ crore
  // spending entries (₹ lakh); without entries the first version's single "spent" figure (₹ crore) is used
  const entries: any[] = Array.isArray(c.projects) ? c.projects : [];
  const lakh = (v: any) => n(v) / 100;
  const hasEntries = entries.length > 0;
  const spent = hasEntries ? entries.reduce((a, x) => a + lakh(x.spent), 0) : n(c.spent);
  const planned = entries.reduce((a, x) => a + lakh(x.budget), 0);
  const overheads = lakh(c.overheads);
  const shortfall = Math.max(0, obligation - spent);
  // unspent money tied to ongoing projects goes to the Unspent CSR Account; the rest to a Schedule VII fund
  const ongoingLeft = entries.filter((x) => x.ongoing).reduce((a, x) => a + Math.max(0, lakh(x.budget) - lakh(x.spent)), 0);
  const toUnspentAccount = Math.min(shortfall, ongoingLeft);
  const toFund = shortfall - toUnspentAccount;
  const noAgency = entries.filter((x) => x.mode === 'agency' && !/^CSR\d{8}$/i.test(String(x.csr1 || '').trim())).length;
  const noArea = entries.filter((x) => !x.area).length;
  return {
    applies, avgProfit: avg, obligation, spent, left: shortfall, committeeNeeded: obligation > R.committee_threshold_cr,
    projects: entries.length, planned, plannedGap: Math.max(0, obligation - planned),
    toUnspentAccount, toFund, excess: Math.max(0, spent - obligation),
    overheads, overheadsPct: spent > 0 ? (overheads / spent) * 100 : 0, overheadsOk: spent <= 0 || overheads <= spent * 0.05,
    impactAssessment: obligation >= 10, noAgency, noArea,
  };
}

/* ------------------------------------------------------------------ EPR */
const ret = (fy: string, r: any) => {
  const m = /^FY (\d{4})-/.exec(fy);
  const end = m ? Number(m[1]) + 1 : new Date().getUTCFullYear();
  const usual = `${end}-${String(r?.month ?? 6).padStart(2, '0')}-${String(r?.day ?? 30).padStart(2, '0')}`;
  const ext = r?.extended?.[fy];
  return { due: ext || usual, usual, extended: !!ext };
};

export function eprPosition(d: any, cfg: any): any {
  const e = d.epr || {}, p = d.profile || {};
  const X = (cfg.requirements && cfg.requirements.epr) || EPR_DEFAULT;
  const fy = fyFor(d, cfg);

  // plastic packaging: obligation per category = quantity × EPR target; part of it must come from recycling
  const target = e.target === undefined || e.target === '' ? n(X.plastic?.target_pct ?? 100) : n(e.target);
  const rates = byFy<any>(X.plastic?.recycling, fy) || {};
  const perCat = ['b1', 'b2', 'b3', 'b4'].some((k) => e[k] !== undefined && e[k] !== '');
  const cats = (X.plastic?.categories || EPR_DEFAULT.plastic.categories).map(([k, label]: [string, string], i: number) => {
    const qty = n(e[k]), need = (qty * target) / 100, bought = perCat ? n(e[`b${i + 1}`]) : 0;
    const rate = n(rates[k]);
    return { key: k, label, qty, need, recyclingPct: rate, recyclingMin: (need * rate) / 100, bought, gap: perCat ? Math.max(0, need - bought) : 0 };
  });
  const total = cats.reduce((a: number, c: any) => a + c.qty, 0);
  const need = (total * target) / 100;
  const bought = perCat ? cats.reduce((a: number, c: any) => a + c.bought, 0) : n(e.bought);
  // with certificates per category, a surplus in one category does not cover another
  const gap = perCat ? cats.reduce((a: number, c: any) => a + c.gap, 0) : Math.max(0, need - bought);

  // e-waste: target % of the estimated e-waste (sales of earlier years by product life, as the CPCB portal works it out)
  const ew = e.ewaste || {};
  const ewRate = n(byFy<number>(X.ewaste, fy));
  const ewNeed = (n(ew.basis) * ewRate) / 100, ewBought = n(ew.bought);

  // batteries: one row per battery type; target % of the quantity sold in the year the schedule names
  const bt = e.battery || {};
  const btTargets = byFy<any>(X.battery?.targets, fy) || {};
  const btTypes: [string, string][] = X.battery?.types || EPR_DEFAULT.battery.types;
  const btRows = (Array.isArray(bt.rows) ? bt.rows : []).map((x: any) => {
    const t = btTargets[x.type] as [number, string] | undefined;
    const pct = t ? n(t[0]) : 0, needKg = (n(x.basis) * pct) / 100;
    return { type: x.type, label: (btTypes.find((y) => y[0] === x.type) || [x.type, x.type])[1], basisYear: t ? t[1] : null, pct, basis: n(x.basis), need: needKg, bought: n(x.bought), gap: Math.max(0, needKg - n(x.bought)), noTarget: !t };
  });
  const sum = (k: string) => btRows.reduce((a: number, x: any) => a + x[k], 0);
  const R = X.returns || EPR_DEFAULT.returns;
  const tick = (s: string) => Object.values((e.checks || {})[s] || {}).filter(Boolean).length;
  return {
    fy, total, need, gap, registered: !!e.registered, bought, target,
    plastic: { applies: !!p.plastics, registered: !!e.registered, cats, total, need, bought, gap, perCategory: perCat, recyclingMin: cats.reduce((a: number, c: any) => a + c.recyclingMin, 0), return: ret(fy, R.plastic), checks: tick('plastic') },
    ewaste: { applies: !!p.ewaste, registered: !!ew.registered, rate: ewRate, basis: n(ew.basis), need: ewNeed, bought: ewBought, gap: Math.max(0, ewNeed - ewBought), return: ret(fy, R.ewaste), checks: tick('ewaste') },
    battery: { applies: !!p.battery, registered: !!bt.registered, rows: btRows, need: sum('need'), bought: sum('bought'), gap: sum('gap'), return: ret(fy, R.battery), checks: tick('battery') },
  };
}

/* ------------------------------------------------------------------ What applies */
export function requirementList(d: any, cfg: any, x: { sr: any; dp: number; cs: any; ep: any; cls: string }): any[] {
  const p = d.profile || {}, R = cfg.requirements.items || {}, out: any[] = [];
  const T = Object.assign({}, T_DEFAULT, cfg.requirements.thresholds || {});
  const { sr, dp, cs, ep } = x;
  const mfg = p.sector !== 'svc';
  const emp = n(p.employees), hasEmp = p.employees !== undefined && p.employees !== null && p.employees !== '';
  const power = p.power !== 'no';
  const pcb = String(p.pcbCategory || '');
  const cto = (d.calendar && d.calendar.cto) || '';
  const today = (cfg.today instanceof Date ? cfg.today : cfg.today ? new Date(cfg.today) : new Date()).toISOString().slice(0, 10);
  const fill = (s: any, vars: any) => String(s || '').replace(/\{(\w+)\}/g, (_: string, k: string) => (vars[k] !== undefined ? vars[k] : ''));
  const lakh1 = (crore: number) => (crore * 100).toFixed(1);
  const goodName: Record<string, string> = { steel: 'iron & steel', aluminium: 'aluminium', cement: 'cement', fertiliser: 'fertilisers' };
  const vars = {
    eudr: p.eudr, srmm_pct: (sr.pct * 100).toFixed(1), srmm_open: sr.open, dpdp_pct: Math.round(dp),
    csr_profit: n(d.csr && d.csr.profit3).toFixed(1), csr_lakh: lakh1(cs.obligation), csr_left_lakh: lakh1(cs.left),
    employees: emp.toLocaleString('en-IN'), msme_class: x.cls, pcb: pcb ? pcb[0]!.toUpperCase() + pcb.slice(1) : '',
    cto: cto ? cto.split('-').reverse().join('-') : '', cbam_good: goodName[p.cbamGood] || 'a CBAM good',
    power_text: power ? 'using power' : 'without power', state: p.state || 'your state',
    epr_gap: ep.gap.toFixed(1), ew_gap: Math.round(ep.ewaste.gap).toLocaleString('en-IN'), bt_gap: Math.round(ep.battery.gap).toLocaleString('en-IN'),
  };
  const add = (key: string, variant: string, fallback?: [string, string]) => {
    let r = R[key] && R[key][variant];
    if (!r && fallback) { key = fallback[0]; r = R[key] && R[key][fallback[1]]; }
    if (!r) return;
    out.push({ key, status: r.status, label: fill(r.label, vars), title: fill(r.title, vars), detail: fill(r.detail, vars), why: fill(r.why, vars), action: fill(r.action, vars), go: r.go || null });
  };

  // people
  if (!hasEmp) add('labour_codes', 'unknown');
  else if (emp > 0) {
    add('labour_codes', emp >= T.establishment ? 'establishment' : 'small');
    add('social_security', emp >= T.epf ? 'both' : emp >= T.esic ? 'esic' : 'none');
    if (mfg && emp >= T.establishment) add('factory_licence', emp >= (power ? T.factory_power : T.factory_no_power) ? 'factory' : 'establishment');
    const ic = (d.people || {}).posh_report || (d.people || {}).posh_ic;
    add('posh', emp >= T.posh ? (ic ? 'on_track' : 'check') : 'small');
  }
  // registrations and permits
  add('udyam', p.udyam ? 'registered' : 'missing');
  if (['red', 'orange', 'green'].includes(pcb)) add('pcb_consent', cto && cto >= today ? 'valid' : 'needed');
  else if (pcb === 'white') add('pcb_consent', 'white');
  else if (mfg) add('pcb_consent', 'unknown');
  if (p.hazWaste === true || p.hazWaste === 'yes') add('hazardous_waste', 'applies');
  else if (mfg && p.hazWaste !== false && p.hazWaste !== 'no') add('hazardous_waste', 'check');
  if (p.qco === 'yes') add('bis_qco', 'applies');
  else if (mfg && p.qco !== 'no') add('bis_qco', 'unsure');
  // environment
  const eprState = (s: any, hasFigures: boolean) => (!s.registered ? 'not_registered' : !hasFigures ? 'check' : s.gap > 0 ? 'gap' : 'covered');
  if (p.plastics) add('plastic_epr', eprState(ep.plastic, ep.need > 0), ['plastic_epr', 'check']);
  if (p.ewaste) add('ewaste_epr', eprState(ep.ewaste, ep.ewaste.need > 0), ['other_epr', 'check']);
  if (p.battery) add('battery_epr', eprState(ep.battery, ep.battery.need > 0), p.ewaste ? undefined : ['other_epr', 'check']);
  add('ccts', p.energyIntensive ? 'check' : 'opportunity');
  // buyers and exports
  add('brsr_value_chain', p.listedBuyer ? 'likely' : 'watch');
  if (p.euExport && (p.cbamGood || 'none') !== 'none') add('eu_cbam', 'applies');
  else if (p.euExport) add('eu_cbam', 'watch');
  if (p.ukExport && (p.cbamGood || 'none') !== 'none') add('uk_cbam', 'applies');
  if (p.eudr && p.eudr !== 'none') add('eudr', 'applies');
  // company law, data, reporting
  if (cs.applies) add('csr', cs.left <= 0 && cs.obligation > 0 ? 'done' : 'applies', ['csr', 'applies']);
  add('brsr_filing', p.listed ? 'applies' : 'not_required');
  add('dpdp', dp >= 80 ? 'on_track' : 'prepare');
  add('srmm', sr.open > 0 ? 'open' : 'done');
  add('bank', 'useful');
  const s = out.find((y: any) => y.key === 'srmm' && y.status === 'good');
  if (s) s.label = String(sr.label).split(' –')[0];
  return out;
}

/* ------------------------------------------------------------------ Schemes */
export const SCHEME_STATUS = ['not_started', 'applied', 'sanctioned', 'received', 'rejected'] as const;

export function schemeList(d: any, cfg: any, x: { cls: string; b: any; so: any; cr: any; hasZed: boolean }): any[] {
  const p = d.profile || {}, apps = ((d.schemes || {}).apps) || {};
  const ok = x.cls !== 'Large' && !!p.udyam;
  const order = ['Micro', 'Small', 'Medium', 'Large'];
  return (cfg.schemes.items || []).filter((s: any) => s.active !== false).map((s: any) => {
    const sizeOk = !s.max_class || order.indexOf(x.cls) <= order.indexOf(s.max_class);
    const eligible = (s.needs_msme ? ok : true) && (s.sector ? p.sector === s.sector : true) && sizeOk && !s.new_units_only;
    let note = s.note || '';
    if (s.id === 'adeetie') note = `Your bill analysis found ₹${(x.b.total / 1e5).toFixed(1)} lakh a year in savings that an efficiency loan could fund.`;
    if (s.id === 'zed') note = x.hasZed ? 'You hold ZED. Plan the next level.' : 'Start with Bronze.';
    if (s.id === 'sidbi') note = `Solar sized at ${x.so.kw} kWp with ${x.so.paybackYears.toFixed(1)}-year payback.`;
    if (s.id === 'ccts_offset') note = `About ${Math.round(x.cr.tco2e)} tCO₂e a year from your projects.`;
    if (s.id === 'cgtmse' && !sizeOk) note = 'For micro and small enterprises only.';
    const a = apps[s.id] || {};
    const status = (SCHEME_STATUS as readonly string[]).includes(a.status) ? a.status : 'not_started';
    const docs: string[] = Array.isArray(s.docs) ? s.docs : [];
    const st = (v: string) => String(v || '').replace('{state}', p.state || 'Your state');
    return {
      id: s.id, title: st(s.title), detail: st(s.detail), eligible, label: eligible ? s.label_ok : s.label_check, note, link: s.link || null,
      docs, status, sanctioned: n(a.sanctioned), received: n(a.received), docsReady: docs.filter((_, i) => (a.docs || {})[i]).length,
    };
  });
}

/** Schemes tracker totals (₹). */
export function schemeTotals(list: any[]) {
  const act = list.filter((s) => s.status !== 'not_started');
  return {
    tracked: act.length,
    applied: act.filter((s) => s.status === 'applied').length,
    sanctioned: list.filter((s) => s.status === 'sanctioned' || s.status === 'received').reduce((a, s) => a + s.sanctioned, 0),
    received: list.reduce((a, s) => a + (s.status === 'rejected' ? 0 : s.received), 0),
  };
}
