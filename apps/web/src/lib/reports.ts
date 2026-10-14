/**
 * Reports (as in the prototype): GHG Protocol categories, the inventory for the period viewed,
 * report sections (HTML, for the preview and the downloaded report) and the CSV exports.
 */
import type { Data, Row } from '../components/ViewBar';
import type { RAction, RepCheck, RepLine, RepSettings, RepTemplate, TargetsData } from './api';
import { cbOf } from './targets';
import { FW_SECS, ISO_CSS, fwSection } from './frameworks';

export const GHG_CATS: [string, number, string, string][] = [
  ['1.1', 1, 'Stationary combustion', 'Fuels burned on site: generators, boilers, kitchens'], ['1.2', 1, 'Mobile combustion', 'Fuel used by owned or controlled vehicles'],
  ['1.3', 1, 'Process emissions', 'Own treatment of waste and wastewater, chemical or physical processes'], ['1.4', 1, 'Fugitive emissions', 'Refrigerant and fire-suppression gas leaks'],
  ['2.1', 2, 'Purchased electricity', 'Grid electricity, including EV charging'], ['2.2', 2, 'Purchased heat, steam & cooling', 'District cooling'],
  ['3.1', 3, 'Purchased goods & services', 'Goods, services and water bought'], ['3.2', 3, 'Capital goods', 'Buildings, vehicles and equipment bought'],
  ['3.3', 3, 'Fuel- & energy-related activities', 'Upstream emissions of fuels and grid losses'], ['3.4', 3, 'Upstream transport & distribution', 'Freight paid for by you'],
  ['3.5', 3, 'Waste generated in operations', 'Disposal and treatment of your waste and wastewater by others'], ['3.6', 3, 'Business travel', 'Flights, hotels, taxis'],
  ['3.7', 3, 'Employee commuting', 'Home–work travel and home working'], ['3.8', 3, 'Upstream leased assets', 'Assets you lease, not in Scope 1/2'],
  ['3.9', 3, 'Downstream transport & distribution', 'Transport of sold products'], ['3.10', 3, 'Processing of sold products', ''], ['3.11', 3, 'Use of sold products', ''],
  ['3.12', 3, 'End-of-life of sold products', ''], ['3.13', 3, 'Downstream leased assets', 'Assets you own and lease to others'], ['3.14', 3, 'Franchises', ''], ['3.15', 3, 'Investments', ''],
];
export const ghgName = (code: string) => { const g = GHG_CATS.find((x) => x[0] === code); return g ? `${code} ${g[2]}` : code; };
export const EXCL_DEFAULT: Record<string, string> = {
  '3.9': 'No physical products shipped.', '3.10': 'No intermediate products sold.', '3.11': 'No energy-using products sold.', '3.12': 'No products sold.', '3.14': 'No franchises.', '3.15': 'No equity investments in the reporting boundary.',
};
const S1C: Record<string, string> = { stationary_combustion: '1.1', mobile_combustion: '1.2', waste_treatment: '1.3', fugitive: '1.4' };
/** tCO2e of a dashboard row by GHG Protocol category (Scope 3 upstream of fuels and grid losses → 3.3). */
export function rowCodes(r: Row, cats: Data['categories']): [string, number][] {
  const g = cats.find((c) => c.code === r.cat)?.ghg ?? '';
  const out: [string, number][] = [];
  if (r.s1) out.push([S1C[r.cat] ?? '1.1', r.s1]);
  if (r.s2) out.push([r.kind === 'cooling' || r.kind === 'heat' ? '2.2' : '2.1', r.s2]);
  if (r.s3) out.push([g.startsWith('3.') ? g : '3.5', r.s3]);
  if (r.s33) out.push(['3.3', r.s33]);
  return out;
}
export function inventory(rows: Row[], cats: Data['categories']) {
  const byCode: Record<string, number> = {};
  for (const r of rows) for (const [c, v] of rowCodes(r, cats)) byCode[c] = (byCode[c] ?? 0) + v;
  const s: [number, number, number] = [0, 0, 0];
  for (const [c, v] of Object.entries(byCode)) s[Number(c[0]) - 1] += v;
  return { byCode, s, tot: s[0] + s[1] + s[2] };
}
export type Inv = ReturnType<typeof inventory>;

/** Data type of an entry: as recorded; spend-based purchases are proxies; survey extrapolations estimates. */
export const dtypeOf = (l: RepLine) => (l.dataType === 'proxy' || l.method === 'spend' ? 'Proxy' : l.dataType === 'estimated' || l.captured === 'commute' ? 'Estimated' : 'Actual');
export const DT_C: Record<string, string> = { Actual: 'c-ok', Estimated: 'c-info', Proxy: 'c-warn' };
/** Confidence of an entry (as in the prototype): spend-based ±40%, survey ±20%, with a bill or meter ±5%, otherwise ±15%. */
export const lineConf = (l: RepLine): [string, number, string] => (l.method === 'spend' ? ['Low', 0.4, 'Spend-based (amount × average factor)'] : l.captured === 'commute' ? ['Medium', 0.2, 'Survey scaled to headcount']
  : l.evidence ? ['High', 0.05, 'Measured, with a bill, meter or source file'] : ['Medium', 0.15, 'Measured, no evidence attached']);
export const CAPTURED: Record<string, string> = { form: 'Typed in', meter: 'Meter or bill', batch: 'Purchases file / ERP', commute: 'Commuting survey / record', fleet: 'Fleet' };
export const lineT = (l: RepLine, mb: boolean) => (l.s1 + (mb ? l.s2m : l.s2) + l.s3 + l.s33) * l.w;

// ---------------------------------------------------------------- report sections --
export const RSECS: [string, string][] = [['cover', 'Cover & reporting entity'], ['boundary', 'Organisational boundary & consolidation'], ['summary', 'Emissions summary by scope'], ['ghgcat', 'Emissions by GHG Protocol category'],
  ['byfac', 'Emissions by facility'], ['byasset', 'Emissions by asset (meters, vehicles, sites)'], ['bymonth', 'Emissions by month'], ['activity', 'Activity data and emission factors by source'], ['intensity', 'Intensity metrics'],
  ['dtype', 'Data type: actual, estimated, proxy'], ['method', 'Methodology statement'], ['excl', 'Exclusions and justifications'], ['base', 'Base year and restatements'], ['dq', 'Data quality controls'],
  ['targets', 'Targets and progress'], ['actions', 'Decarbonisation actions and cost-benefit'], ['verif', 'Declaration, verification and sign-off'], ...FW_SECS];
export const RTPL_DEF: RepTemplate[] = [
  { id: 'board', base: 'board', name: 'Board summary', audience: 'Internal management', note: null, sections: ['cover', 'summary', 'ghgcat', 'byfac', 'intensity', 'targets', 'actions'] },
  { id: 'ghgp', base: 'ghgp', name: 'GHG Protocol inventory report', audience: 'Verifier / public disclosure', note: null, sections: ['cover', 'boundary', 'summary', 'ghgcat', 'byfac', 'activity', 'dtype', 'method', 'excl', 'base', 'dq', 'verif'] },
  { id: 'iso', base: 'iso', name: 'ISO 14064-1:2018 GHG report', audience: 'Global standard · public report, verifier (ISO 14064-3)', note: null, sections: ['iso_report'] },
  { id: 'esrs', base: 'esrs', name: 'ESRS E1 climate disclosure (CSRD, EU)', audience: 'EU · CSRD sustainability statement', note: null, sections: ['cover', 'boundary', 'esrs_e1', 'ghgcat', 'bygas', 'method', 'excl', 'base', 'targets', 'verif'] },
  { id: 'ifrs', base: 'ifrs', name: 'IFRS S2 GHG metrics (ISSB)', audience: 'Global · ISSB and adopting jurisdictions (AU, SG, JP, UK…)', note: null, sections: ['cover', 'boundary', 'ifrs_s2', 'ghgcat', 'method', 'excl', 'verif'] },
  { id: 'cdp', base: 'cdp', name: 'CDP climate questionnaire — emissions', audience: 'Global · CDP disclosure', note: null, sections: ['cover', 'cdp', 'bygas', 'bycountry', 'method', 'verif'] },
  { id: 'gri', base: 'gri', name: 'GRI 305 Emissions', audience: 'Global · sustainability report', note: null, sections: ['cover', 'boundary', 'gri305', 'ghgcat', 'bygas', 'intensity', 'method', 'base'] },
  { id: 'secr', base: 'secr', name: 'UK SECR energy and carbon report', audience: 'UK · directors’ report', note: null, sections: ['cover', 'secr', 'method'] },
  { id: 'sb253', base: 'sb253', name: 'California SB 253 GHG report', audience: 'US · California', note: null, sections: ['cover', 'boundary', 'sb253', 'ghgcat', 'method', 'verif'] },
  { id: 'moccae', base: 'moccae', name: 'UAE MOCCAE submission (provisional layout)', audience: 'Regional · UAE regulator (MOCCAE MRV)', note: 'Provisional structure built from the GHG Protocol inventory. Replace with the official MOCCAE template: sections can be changed here without code changes.',
    sections: ['cover', 'boundary', 'summary', 'activity', 'ghgcat', 'byfac', 'byasset', 'dtype', 'method', 'excl', 'base', 'dq', 'verif'] },
];
/** Built-in templates, unless the company saved its own version of one, plus its own templates. */
/** How the template list is grouped. */
export const TPL_GROUP: Record<string, string> = { iso: 'Global standards', ifrs: 'Global standards', ghgp: 'Global standards', cdp: 'Global standards', gri: 'Global standards',
  esrs: 'European Union', secr: 'Country & regional', sb253: 'Country & regional', moccae: 'Country & regional', board: 'Internal' };
export const templateList = (saved: RepTemplate[]) => [...RTPL_DEF.filter((t) => !saved.some((s) => s.base === t.base)), ...saved].map((t) => ({ ...t, builtin: !saved.some((s) => s.id === t.id) }));

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const f1 = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f0 = (v: number) => Math.round(v).toLocaleString('en');
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface RepCtx {
  d: Data; rows: Row[]; prev: Row[]; months: number[]; inv: Inv; lines: RepLine[]; mb: boolean; label: string; period: string; settings: RepSettings;
  checks: RepCheck[] | null; targets: TargetsData | null; preparedBy: string; consolidation: string; logo?: string;
}
const T = (rows: (string | number)[][], head: string[]) => `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function section(k: string, x: RepCtx): string {
  const { inv, d } = x, pc = (v: number) => (inv.tot ? `${f1((v / inv.tot) * 100)}%` : '—');
  const ex = { ...EXCL_DEFAULT, ...x.settings.excl }, e = x.settings.entity, co = x.settings.company;
  switch (k) {
    case 'cover': return `<div class="cover">${x.logo ? `<img src="${x.logo}" alt="" style="float:right;max-height:52px;max-width:170px">` : ''}<div class="eyb">Greenhouse-gas emissions report · ${esc(x.period)}</div><h1>${esc(e.legal || co.name)}</h1><table class="kv"><tbody>${[
      ['Reporting entity', e.legal || co.name], ['Registration no.', e.licence || 'to be completed'], ['LEI', e.lei || '—'], ['Country / region', [co.country, e.region ?? e.emirate].filter(Boolean).join(' · ')], ['Sector', [e.sector, e.sectorCode].filter(Boolean).join(' · ') || 'to be completed'], ['Regulator / registry ID', e.mrvId || '—'],
      ['Reporting contact', e.contact || 'to be completed'], ['Scope of report', x.label], ['Standard', 'GHG Protocol Corporate Standard'], ['Consolidation', x.consolidation], ['GWP', co.gwp], ['Scope 2 shown', x.mb ? 'Market-based' : 'Location-based'],
      ['Prepared', `${new Date().toLocaleDateString('en-GB')} by ${x.preparedBy}`]].map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table></div>`;
    case 'boundary': return `<h2>Organisational boundary</h2><p>Consolidation approach: <b>${esc(x.consolidation)}</b>. Operational boundary: Scope 1, Scope 2 and the Scope 3 categories listed below. GWPs: IPCC ${esc(co.gwp)}.</p>`
      + T(d.facilities.map((f) => [esc(f.name), esc(f.type ?? ''), esc(f.parent ?? ''), `${Math.round(f.weight * 100)}%`]), ['Facility', 'Type', 'Sits under', 'Counted']);
    case 'summary': {
      const p = inventory(x.prev, d.categories);
      return '<h2>Emissions summary</h2>' + T([0, 1, 2].map((i) => [`Scope ${i + 1}`, f1(inv.s[i]!), pc(inv.s[i]!), x.prev.length ? f1(p.s[i]!) : '—']).concat([['<b>Total</b>', `<b>${f1(inv.tot)}</b>`, '100%', x.prev.length ? f1(p.tot) : '—']]),
        ['Scope', 'tCO₂e', 'Share', `Same months ${d.cmpYear}`]) + '<p class="small">All gases reported as CO₂-equivalent; the gas-by-gas split is on Entries & results.</p>';
    }
    case 'ghgcat': return '<h2>By GHG Protocol category</h2>' + T(GHG_CATS.map(([c, , n]) => [`${c} ${esc(n)}`, inv.byCode[c] ? f1(inv.byCode[c]!) : '—', inv.byCode[c] ? pc(inv.byCode[c]!) : ex[c] ? 'Excluded' : 'No data']), ['Category', 'tCO₂e', 'Share']);
    case 'byfac': return '<h2>By facility</h2>' + T(d.facilities.map((f) => { const i = inventory(x.rows.filter((r) => r.f === f.id), d.categories); return [esc(f.name), f1(i.s[0]), f1(i.s[1]), f1(i.s[2]), `<b>${f1(i.tot)}</b>`]; }),
      ['Facility', 'Scope 1', `Scope 2 (${x.mb ? 'market' : 'location'})`, 'Scope 3', 'Total']);
    case 'byasset': {
      const g = new Map<string, { fac: string; a: string; n: number; t: number }>();
      for (const l of x.lines.filter((z) => z.asset)) { const key = `${l.facility}|${l.asset}`, o = g.get(key) ?? { fac: l.facility, a: l.asset!, n: 0, t: 0 }; o.n++; o.t += lineT(l, x.mb); g.set(key, o); }
      const rows = [...g.values()].sort((a, b) => b.t - a.t).slice(0, 30);
      return '<h2>By asset</h2>' + (rows.length ? T(rows.map((r) => [esc(r.fac), esc(r.a), r.n, f1(r.t)]), ['Facility', 'Asset / meter / vehicle / site', 'Entries', 'tCO₂e']) : '<p class="small">No entries linked to meters, vehicles or waste sites in this period.</p>');
    }
    case 'bymonth': return '<h2>By month</h2>' + T(x.months.map((m) => { const i = inventory(x.rows.filter((r) => r.m === m), d.categories); return [`${MN[m - 1]} ${d.year}`, f1(i.s[0]), f1(i.s[1]), f1(i.s[2]), f1(i.tot)]; }), ['Month', 'Scope 1', 'Scope 2', 'Scope 3', 'Total']);
    case 'activity': {
      const g = new Map<string, { q: number; t: number; unit: string; code: string; src: string }>();
      for (const l of x.lines) { const key = `${l.item}|${l.unit}`, o = g.get(key) ?? { q: 0, t: 0, unit: l.unit, code: l.code, src: l.source ?? '' }; o.q += l.qty * l.w; o.t += lineT(l, x.mb); g.set(key, o); }
      return '<h2>Activity data and emission factors</h2>' + T([...g.entries()].sort((a, b) => b[1].t - a[1].t).map(([key, o]) => [`${esc(key.split('|')[0])} <span class="small">(${o.code})</span>`, `${f0(o.q)} ${esc(o.unit)}`, o.q ? (o.t * 1000 / o.q).toFixed(4) : '—', esc(o.src), f1(o.t)]),
        ['Source', 'Activity', 'kgCO₂e / unit', 'Factor source', 'tCO₂e']);
    }
    case 'intensity': { const st = d.facilities.reduce((a, f) => a + (f.employees ?? 0) * f.weight, 0), ar = d.facilities.reduce((a, f) => a + (f.area ?? 0) * f.weight, 0);
      return '<h2>Intensity</h2>' + T([['tCO₂e per employee', st ? (inv.tot / st).toFixed(2) : '—'], ['kgCO₂e per m² floor area', ar ? f1((inv.tot * 1000) / ar) : '—'], ['Scope 1+2 tCO₂e per employee', st ? ((inv.s[0] + inv.s[1]) / st).toFixed(2) : '—']], ['Metric', 'Value']); }
    case 'dtype': { const g: Record<string, number> = { Actual: 0, Estimated: 0, Proxy: 0 }; for (const l of x.lines) g[dtypeOf(l)]! += lineT(l, x.mb); const t = g.Actual! + g.Estimated! + g.Proxy! || 1;
      return '<h2>Data type</h2>' + T(Object.entries(g).map(([k2, v]) => [k2, f1(v), `${f1((v / t) * 100)}%`]), ['Type', 'tCO₂e', 'Share']); }
    case 'method': return `<h2>Methodology</h2><p>Emissions = activity data × emission factor ÷ 1,000. Each entry keeps the factor in force when it was entered (DESNZ, IPCC and supplier factors; the source is listed per activity). Refrigerants: mass balance with IPCC ${esc(co.gwp)} GWPs. Scope 2: location-based with grid factors; market-based with contractual instruments (certificates, supplier factors) and residual factors. Purchased goods: supplier-specific factors where available, otherwise spend-based averages. Employee commuting: survey scaled to headcount, or typed in. Only approved entries are reported (maker-checker). Base year ${co.baseYear ?? '—'}.</p>`;
    case 'excl': { const rows = GHG_CATS.filter(([c]) => !inv.byCode[c]).map(([c, , n]) => [`${c} ${esc(n)}`, esc(ex[c] || 'Justification required')]);
      return '<h2>Exclusions</h2>' + (rows.length ? T(rows, ['Category', 'Justification']) : '<p>No category excluded.</p>'); }
    case 'base': {
      const b = d.baseMonthly.reduce((a, m) => [a[0]! + m.s1, a[1]! + m.s2, a[2]! + m.s3], [0, 0, 0]), r = d.restated, rs = x.settings.restatements ?? [], thr = x.settings.restateThreshold ?? 5;
      const TRIG: Record<string, string> = { acquisition: 'Acquisition', divestment: 'Divestment / closure', insourcing: 'Insourcing', outsourcing: 'Outsourcing', method: 'Method improved', factor: 'Factors / GWP', error: 'Error corrected', boundary: 'Boundary / consolidation', other: 'Other' };
      const sg = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f1(Math.abs(v))}`;
      let h = `<h2>Base year ${co.baseYear ?? ''}</h2>`;
      if (r) {
        const adj = [r.s1, r.s2, r.s3];
        h += T([0, 1, 2].map((i) => [`Scope ${i + 1}`, f1(b[i]! - adj[i]!), sg(adj[i]!), `<b>${f1(b[i]!)}</b>`]).concat([['<b>Total</b>', f1(b[0]! + b[1]! + b[2]! - adj[0]! - adj[1]! - adj[2]!), sg(adj[0]! + adj[1]! + adj[2]!), `<b>${f1(b[0]! + b[1]! + b[2]!)}</b>`]]),
          ['Scope', 'As measured', 'Restatements', 'Restated base year (tCO₂e)']);
      } else h += T([0, 1, 2].map((i) => [`Scope ${i + 1}`, f1(b[i]!)]).concat([['<b>Total</b>', `<b>${f1(b[0]! + b[1]! + b[2]!)}</b>`]]), ['Scope', 'tCO₂e (approved)']);
      h += rs.length
        ? '<h3>Recalculation history</h3>' + T(rs.map((z) => [new Date(z.decided_at).toLocaleDateString('en-GB'), esc(z.title), TRIG[z.trigger] ?? z.trigger, esc(z.facility ?? 'Company'), sg(z.s1 + (x.mb ? z.s2m : z.s2) + z.s3), z.pct != null ? `${f1(z.pct)}%` : '—',
            z.applied ? 'Restated' : 'Recorded (below threshold)', esc(`${z.proposed_name ?? ''} / ${z.decided_name ?? ''}`)]), ['Approved', 'Change', 'Trigger', 'Facility', 'tCO₂e', '% of base', 'Effect', 'Recorded / approved by'])
        : '<p>No restatements recorded.</p>';
      return h + `<p class="small">Policy: the base year is recalculated for structural changes (acquisitions, divestments, in- and outsourcing), changes in calculation methods or emission factors, and errors, when their effect reaches ${thr}% of base-year emissions, alone or together with earlier changes (GHG Protocol Corporate Standard ch. 5; ISO 14064-1 §6.4.1). Each recalculation is approved by a second person; the figures as first measured are kept.</p>`;
    }
    case 'dq': return x.checks ? '<h2>Data quality controls</h2>' + T(x.checks.map((c) => [esc(c.name), esc(c.area), !c.n ? 'OK' : c.justified ? `Justified: ${esc(c.justified.text)}` : 'To check', c.n]), ['Control', 'Area', 'Status', 'Warnings']) : '';
    case 'targets': { const t = x.targets; if (!t) return ''; return '<h2>Targets</h2>' + T([['Scope 1+2', `−${t.target.s12}% by ${t.target.year} vs ${t.baseYear ?? ''}`], ['Scope 3', `−${t.target.s3}% by ${t.target.year}`], ['Net Zero', `${t.sbti.nzYear} (residual ≤ ${t.sbti.resid}%)`], ['SBTi status', esc(t.sbti.status)]], ['Target', 'Ambition']); }
    case 'actions': { const t = x.targets; if (!t) return ''; const acts = t.actions.filter((a: RAction) => a.scenarioIds.includes(t.defaultScenario) && !a.excluded);
      const m = (v: number) => `${v < 0 ? '−' : ''}${t.currency} ${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(2)}m` : f0(Math.abs(v))}`;
      return '<h2>Decarbonisation actions (current plan)</h2>' + (acts.length ? T(acts.map((a) => { const c = cbOf(a); return [esc(a.name), esc(a.status), f0(c.ab), m(c.capex), c.opex ? m(c.opex) : '—', m(c.sav), c.pay !== null ? `${c.pay.toFixed(1)} yrs` : '—', c.roi !== null ? `${f0(c.roi)}%` : '—']; }),
        ['Action', 'Status', 't/yr', 'CapEx', 'OpEx/yr', 'Saving/yr', 'Payback', 'ROI']) : '<p>No actions in the current plan.</p>'); }
    case 'verif': return `<h2>Declaration and verification</h2><p>We declare that this report has been prepared from data approved in Ekotrace under maker-checker controls, and that it is complete and accurate to the best of our knowledge.</p><table class="kv"><tbody><tr><td>Prepared by</td><td>${esc(x.preparedBy)}</td></tr><tr><td>Approved by (name, title, date)</td><td>&nbsp;</td></tr><tr><td>Verification body and statement</td><td>&nbsp;</td></tr><tr><td>Level of assurance</td><td>Limited / Reasonable</td></tr></tbody></table>`;
  }
  return fwSection(k, x, x.logo);
}
export const RT_CSS = 'body{font-family:system-ui,sans-serif;max-width:920px;margin:36px auto;padding:0 18px;color:#0B2A25;line-height:1.5}h1{font-size:28px;margin:6px 0 14px}h2{font-size:18px;margin:28px 0 8px;border-top:1px solid #dfe6e3;padding-top:16px}table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}th,td{padding:6px 8px;border-bottom:1px solid #e4ebe8;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#5b6b66}.n{text-align:right}.small{font-size:12px;color:#5b6b66}.eyb{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1F8A5B}.kv td:first-child{color:#5b6b66;width:38%}.kv td.n,.kv td:last-child{text-align:left}.cover{border:1px solid #dfe6e3;border-radius:12px;padding:18px}.note{background:#FFF6E0;border-radius:8px;padding:10px 12px;font-size:12.5px}@media print{body{margin:0}h2{break-after:avoid}table{break-inside:auto}}' + ISO_CSS;
export const reportBody = (tpl: RepTemplate, x: RepCtx) => (tpl.note ? `<p class="note">${esc(tpl.note)}</p>` : '') + tpl.sections.map((k) => section(k, x)).join('');
export const reportHtml = (tpl: RepTemplate, x: RepCtx) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(tpl.name)} · ${esc(x.label)} · ${esc(x.period)}</title><style>${RT_CSS}</style></head><body>${reportBody(tpl, x)}<p class="small" style="margin-top:30px">Generated by Ekotrace on ${new Date().toLocaleString('en-GB')}.</p></body></html>`;

// ---------------------------------------------------------------- files --
const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const csv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
export function download(name0: string, body: string, type = 'text/csv;charset=utf-8') {
  // browsers drop a name with characters outside ASCII: keep it plain
  const name = name0.normalize('NFKD').replace(/[–—·]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s*-\s*(-\s*)*/g, ' - ').replace(/\s+/g, ' ').trim();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([type.startsWith('text/csv') ? '﻿' + body : body], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
/** MRV dataset: one row per approved entry. */
export const mrvCsv = (lines: RepLine[], mb: boolean) => csv(['entry_id', 'facility', 'period_from', 'period_to', 'scope', 'ghg_category', 'category', 'activity', 'quantity', 'unit', 'kgco2e_per_unit', 'factor_source', 'tco2e', 'scope2_basis', 'counted_share', 'data_type', 'captured', 'evidence', 'note'],
  lines.map((l) => { const t = lineT(l, mb) / (l.w || 1); return [l.id, l.facility, l.from, l.to, l.scope, l.code, l.category, l.item, l.qty, l.unit, l.qty ? ((t * 1000) / l.qty).toFixed(6) : '', l.source ?? '', t.toFixed(4), l.scope === 2 || l.s2 ? (mb ? 'market' : 'location') : '', l.w, dtypeOf(l), CAPTURED[l.captured], l.evidence ? 'yes' : 'no', l.note ?? '']; }));
export const inventoryCsv = (inv: Inv, excl: Record<string, string>) => csv(['ghg_category', 'name', 'scope', 'tco2e', 'share_pct', 'status', 'exclusion_justification'],
  GHG_CATS.map(([c, sc, n]) => [c, n, sc, (inv.byCode[c] ?? 0).toFixed(3), inv.tot ? (((inv.byCode[c] ?? 0) / inv.tot) * 100).toFixed(2) : '0', inv.byCode[c] ? 'measured' : sc < 3 ? 'no data' : 'excluded', inv.byCode[c] ? '' : { ...EXCL_DEFAULT, ...excl }[c] ?? '']));
export const factorsCsv = (lines: RepLine[], mb: boolean) => {
  const g = new Map<string, { item: string; unit: string; code: string; src: string; q: number; t: number }>();
  for (const l of lines) { const k = `${l.item}|${l.unit}|${l.source ?? ''}`, o = g.get(k) ?? { item: l.item, unit: l.unit, code: l.code, src: l.source ?? '', q: 0, t: 0 }; o.q += l.qty; o.t += lineT(l, mb) / (l.w || 1); g.set(k, o); }
  return csv(['activity', 'ghg_category', 'unit', 'quantity', 'tco2e', 'kgco2e_per_unit', 'factor_source'], [...g.values()].map((o) => [o.item, o.code, o.unit, o.q, o.t.toFixed(4), o.q ? ((o.t * 1000) / o.q).toFixed(6) : '', o.src]));
};
