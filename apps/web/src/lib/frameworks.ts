/**
 * Disclosure formats used around the world, built from the same approved entries:
 *
 *   ISO 14064-1:2018   categories 1–6, gases, biogenic CO2, uncertainty — and a designed report with charts
 *   ESRS E1 (CSRD, EU) E1-6 gross Scope 1, 2 (location / market), 3 and total, intensity per net revenue; E1-5 energy
 *   IFRS S2 (ISSB)     para 29(a): Scope 1, 2 (location-based, with market-based information), 3 by category
 *                      — the basis of AASB S2 (Australia), SGX (Singapore), SSBJ (Japan), UK SRS, and others
 *   CDP                emissions module (Scope 1, 2, 3; Scope 1 by gas; by country; by business division)
 *   GRI 305            305-1 to 305-4
 *   UK SECR            UK energy and emissions, intensity ratio
 *   California SB 253  Scope 1, 2 (and 3) under the GHG Protocol
 *
 * Each has a section (HTML, in the report preview and download) and a list of datapoints (CSV).
 */
import { GHG_CATS, esc, lineConf, lineT, type RepCtx } from './reports';
import type { RepLine } from './api';

const f1 = (v: number) => v.toLocaleString('en', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (v: number) => v.toLocaleString('en', { maximumFractionDigits: 2 });
const pct = (v: number, t: number) => (t ? `${f1((v / t) * 100)}%` : '—');
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const T = (rows: (string | number)[][], head: string[], cls = '') => `<table class="${cls}"><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

// ------------------------------------------------------------------ figures --
/** ISO 14064-1:2018 categories from GHG Protocol categories. */
export const ISO_CATS: [number, string, string, string[]][] = [
  [1, 'Direct GHG emissions and removals', 'Fuels burned, vehicles, own processes and waste treatment, refrigerant leaks', ['1.1', '1.2', '1.3', '1.4']],
  [2, 'Indirect emissions from imported energy', 'Electricity, heat, steam and cooling bought', ['2.1', '2.2']],
  [3, 'Indirect emissions from transportation', 'Freight, business travel, commuting, distribution', ['3.4', '3.6', '3.7', '3.9']],
  [4, 'Indirect emissions from products used by the organization', 'Goods and services, capital goods, upstream energy, waste, leased assets', ['3.1', '3.2', '3.3', '3.5', '3.8']],
  [5, 'Indirect emissions associated with the use of products from the organization', 'Processing, use and end of life of sold products, assets leased out', ['3.10', '3.11', '3.12', '3.13']],
  [6, 'Indirect emissions from other sources', 'Franchises, investments', ['3.14', '3.15']],
];
const isoOf = (code: string) => ISO_CATS.find((c) => c[3].includes(code))?.[0] ?? 6;

/** Everything the formats need, from the approved entries of the period (with the consolidation weights). */
export function figures(x: RepCtx) {
  const L = x.lines;
  const sum = (f: (l: RepLine) => number) => L.reduce((a, l) => a + f(l) * l.w, 0);
  const s1 = sum((l) => l.s1), s2l = sum((l) => l.s2), s2m = sum((l) => l.s2m), s3 = sum((l) => l.s3 + l.s33), bio = sum((l) => l.bio ?? 0);
  const byCode: Record<string, number> = {};
  for (const l of L) {
    const add = (c: string, v: number) => { if (v) byCode[c] = (byCode[c] ?? 0) + v * l.w; };
    add(l.code, l.s1 + (x.mb ? l.s2m : l.s2) + l.s3); add('3.3', l.s33);
  }
  const s3cat: Record<string, number> = {}; for (const [c, v] of Object.entries(byCode)) if (c.startsWith('3.')) s3cat[c] = v;
  const iso: Record<number, number> = {}; for (const [c, v] of Object.entries(byCode)) iso[isoOf(c)] = (iso[isoOf(c)] ?? 0) + v;
  const gases: Record<string, number> = {}; for (const l of L) for (const [g, v] of Object.entries(l.gases ?? {})) gases[g] = (gases[g] ?? 0) + Number(v) * l.w;
  const group = (k: (l: RepLine) => string) => { const m = new Map<string, [number, number, number]>(); for (const l of L) { const o = m.get(k(l)) ?? [0, 0, 0]; o[0] += l.s1 * l.w; o[1] += l.s2 * l.w; o[2] += l.s2m * l.w; m.set(k(l), o); } return [...m.entries()].sort((a, b) => b[1][0] + b[1][1] - (a[1][0] + a[1][1])); };
  // uncertainty: each entry's ± (as on Data quality), combined as the root of the sum of squares
  const unc = Math.sqrt(L.reduce((a, l) => a + (lineT(l, x.mb) * lineConf(l)[1]) ** 2, 0));
  // energy from the dashboard rows (fuels on net calorific value, electricity, heat, cooling); certificates = renewable claimed
  const en = { fuel: 0, electricity: 0, heat: 0, cooling: 0, rec: 0 };
  for (const r of x.rows) { if (r.kind && r.kwh) en[r.kind] += r.kwh; en.rec += r.rec || 0; }
  const mwh = (k: number) => k / 1000;
  const emp = x.d.facilities.reduce((a, f) => a + (f.employees ?? 0) * f.weight, 0);
  const rev = x.settings.entity.revenue ?? null;
  return { s1, s2l, s2m, s3, bio, totL: s1 + s2l + s3, totM: s1 + s2m + s3, byCode, s3cat, iso, gases, byCountry: group((l) => l.country ?? '—'), byDivision: group((l) => l.division ?? '—'),
    unc, uncPct: (s1 + (x.mb ? s2m : s2l) + s3) ? (unc / (s1 + (x.mb ? s2m : s2l) + s3)) * 100 : 0,
    energy: { fuelMWh: mwh(en.fuel), elecMWh: mwh(en.electricity), heatMWh: mwh(en.heat), coolMWh: mwh(en.cooling), recMWh: mwh(en.rec), totMWh: mwh(en.fuel + en.electricity + en.heat + en.cooling) },
    employees: emp, revenue: rev, revCur: x.settings.entity.revenueCurrency || x.settings.company.currency || '' };
}
export type Fig = ReturnType<typeof figures>;
const s3Name = (c: string) => GHG_CATS.find((g) => g[0] === c)?.[2] ?? c;
const excl = (x: RepCtx) => (c: string) => x.settings.excl[c] || ({ '3.9': 'No physical products shipped.', '3.10': 'No intermediate products sold.', '3.11': 'No energy-using products sold.', '3.12': 'No products sold.', '3.14': 'No franchises.', '3.15': 'No equity investments in the reporting boundary.' } as Record<string, string>)[c] || 'Not yet assessed';

// ------------------------------------------------------------------ datapoints --
export type DP = [string, string, number | string | null, string];
export function datapoints(fw: string, x: RepCtx): DP[] {
  const F = figures(x), t = 'tCO2e', S3 = GHG_CATS.filter((g) => g[1] === 3);
  switch (fw) {
    case 'iso': return [...ISO_CATS.map(([n, name]) => [`ISO 14064-1 Category ${n}`, name, round(F.iso[n] ?? 0), t] as DP),
      ...Object.entries(F.gases).map(([g, v]) => ['ISO 14064-1 Category 1 by gas', g, round(v), t] as DP), ['ISO 14064-1', 'Biogenic CO2 (reported separately)', round(F.bio), 'tCO2'], ['ISO 14064-1', 'Uncertainty of the total (±)', round(F.uncPct), '%']];
    case 'esrs': return [['ESRS E1-6 §48(a)', 'Gross Scope 1 GHG emissions', round(F.s1), t], ['ESRS E1-6 §48(b)', 'Percentage of Scope 1 from regulated emission trading schemes', null, '%'],
      ['ESRS E1-6 §49(a)', 'Gross location-based Scope 2 GHG emissions', round(F.s2l), t], ['ESRS E1-6 §49(b)', 'Gross market-based Scope 2 GHG emissions', round(F.s2m), t],
      ['ESRS E1-6 §51', 'Gross Scope 3 GHG emissions', round(F.s3), t], ...S3.map(([c, , n]) => [`ESRS E1-6 §51 · ${c}`, `Scope 3 · ${n}`, F.s3cat[c] != null ? round(F.s3cat[c]) : null, t] as DP),
      ['ESRS E1-6 §52(a)', 'Total GHG emissions (location-based)', round(F.totL), t], ['ESRS E1-6 §52(b)', 'Total GHG emissions (market-based)', round(F.totM), t],
      ['ESRS E1-6 §53', 'GHG intensity per net revenue (location-based)', F.revenue ? round(F.totL / F.revenue * 1e6) : null, `tCO2e per million ${F.revCur}`], ['ESRS E1-6 §53', 'GHG intensity per net revenue (market-based)', F.revenue ? round(F.totM / F.revenue * 1e6) : null, `tCO2e per million ${F.revCur}`],
      ['ESRS E1-6 AR 43(c)', 'Biogenic CO2 emissions (not in Scope 1)', round(F.bio), 'tCO2'],
      ['ESRS E1-5 §37', 'Total energy consumption from own operations', round(F.energy.totMWh), 'MWh'], ['ESRS E1-5 §37(a)', 'of which fossil fuels burned (net calorific value)', round(F.energy.fuelMWh), 'MWh'],
      ['ESRS E1-5', 'Purchased electricity, heat, steam and cooling', round(F.energy.elecMWh + F.energy.heatMWh + F.energy.coolMWh), 'MWh'], ['ESRS E1-5 §37(c)', 'Renewable electricity claimed with certificates or contracts', round(F.energy.recMWh), 'MWh']];
    case 'ifrs': return [['IFRS S2 §29(a)(i)(1)', 'Absolute gross Scope 1 GHG emissions', round(F.s1), t], ['IFRS S2 §29(a)(i)(2), (v)', 'Absolute gross Scope 2 GHG emissions — location-based', round(F.s2l), t],
      ['IFRS S2 §29(a)(v)', 'Scope 2 — market-based (information on contractual instruments)', round(F.s2m), t], ['IFRS S2 §29(a)(i)(3)', 'Absolute gross Scope 3 GHG emissions', round(F.s3), t],
      ...S3.map(([c, , n]) => [`IFRS S2 §29(a)(vi) · ${c}`, `Scope 3 · ${n}`, F.s3cat[c] != null ? round(F.s3cat[c]) : null, t] as DP),
      ['IFRS S2 §29(a)(ii)', 'Measurement approach', 'GHG Protocol Corporate Standard (2004)', ''], ['IFRS S2 §29(a)(iii)', 'Consolidation approach', x.consolidation, '']];
    case 'cdp': return [['CDP 7.6', 'Gross global Scope 1 emissions', round(F.s1), t], ['CDP 7.7', 'Gross global Scope 2 — location-based', round(F.s2l), t], ['CDP 7.7', 'Gross global Scope 2 — market-based', round(F.s2m), t],
      ...S3.map(([c, , n]) => [`CDP 7.8 · ${c}`, n, F.s3cat[c] != null ? round(F.s3cat[c]) : null, t] as DP), ...Object.entries(F.gases).map(([g, v]) => ['CDP 7.15', `Scope 1 by greenhouse gas · ${g}`, round(v), t] as DP),
      ...F.byCountry.map(([k, v]) => ['CDP 7.16', `Scope 1 / 2 location / 2 market · ${k}`, `${round(v[0])} / ${round(v[1])} / ${round(v[2])}`, t] as DP),
      ...F.byDivision.map(([k, v]) => ['CDP 7.17', `Scope 1 by business division · ${k}`, round(v[0]), t] as DP), ['CDP 7.5', 'Base year', x.settings.company.baseYear ?? null, '']];
    case 'gri': return [['GRI 305-1-a', 'Gross direct (Scope 1) GHG emissions', round(F.s1), t], ['GRI 305-1-b', 'Gases included', Object.keys(F.gases).join(', '), ''], ['GRI 305-1-c', 'Biogenic CO2 emissions', round(F.bio), 'tCO2'],
      ['GRI 305-2-a', 'Gross location-based energy indirect (Scope 2)', round(F.s2l), t], ['GRI 305-2-b', 'Gross market-based energy indirect (Scope 2)', round(F.s2m), t],
      ['GRI 305-3-a', 'Gross other indirect (Scope 3)', round(F.s3), t], ['GRI 305-4-a', 'GHG emissions intensity (Scope 1+2+3, per employee)', F.employees ? round(F.totL / F.employees) : null, 'tCO2e per employee'],
      ['GRI 305-1-e', 'Source of emission factors and GWP rates', `DESNZ, IPCC, supplier factors; IPCC ${x.settings.company.gwp}`, ''], ['GRI 305-1-f', 'Consolidation approach', x.consolidation, '']];
    case 'secr': { const uk = x.lines.filter((l) => l.country === 'GB'); const s = (f: (l: RepLine) => number) => uk.reduce((a, l) => a + f(l) * l.w, 0);
      return [['SECR', 'UK Scope 1', round(s((l) => l.s1)), t], ['SECR', 'UK Scope 2 (location-based)', round(s((l) => l.s2)), t], ['SECR', 'UK business travel in employee-owned or hire cars (Scope 3)', round(s((l) => (l.cat === 'business_travel' && /car/i.test(l.item) ? l.s3 + l.s33 : 0))), t],
        ['SECR', 'Global Scope 1 and 2 (for context)', round(F.s1 + F.s2l), t], ['SECR', 'Intensity ratio (UK Scope 1+2 per employee)', null, 'tCO2e per employee']]; }
    case 'sb253': return [['SB 253', 'Scope 1 emissions', round(F.s1), t], ['SB 253', 'Scope 2 emissions (location-based)', round(F.s2l), t], ['SB 253', 'Scope 2 emissions (market-based)', round(F.s2m), t], ['SB 253', 'Scope 3 emissions', round(F.s3), t], ['SB 253', 'Standard', 'GHG Protocol Corporate Standard', '']];
  }
  return [];
}
const round = (v: number) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ sections (preview / download) --
export const FW_SECS: [string, string][] = [['iso_report', 'ISO 14064-1 designed report (charts and analysis)'], ['iso_cats', 'ISO 14064-1 categories 1–6'], ['bygas', 'Scope 1 by greenhouse gas'], ['bycountry', 'By country and business division'],
  ['esrs_e1', 'ESRS E1-6 and E1-5 (CSRD)'], ['ifrs_s2', 'IFRS S2 GHG metrics (ISSB)'], ['cdp', 'CDP emissions module'], ['gri305', 'GRI 305 Emissions'], ['secr', 'UK SECR'], ['sb253', 'California SB 253']];

const dpTable = (rows: DP[]) => T(rows.map(([r, l, v, u]) => [`<span class="small">${esc(r)}</span>`, esc(l), v == null ? '<span class="small">to be completed</span>' : typeof v === 'number' ? f2(v) : esc(v), esc(u)]), ['Reference', 'Datapoint', 'Value', 'Unit'], 'dp');

export function fwSection(k: string, x: RepCtx, logo?: string): string {
  const F = figures(x);
  switch (k) {
    case 'iso_report': return isoReport(x, F, logo);
    case 'iso_cats': return '<h2>ISO 14064-1:2018 · emissions by category</h2>' + T(ISO_CATS.map(([n, name, d, codes]) => [`<b>Category ${n}</b> · ${esc(name)}<div class="small">${esc(d)} (GHG Protocol ${codes.join(', ')})</div>`, F.iso[n] ? f1(F.iso[n]!) : '—', pct(F.iso[n] ?? 0, Object.values(F.iso).reduce((a, v) => a + v, 0))]), ['Category', 'tCO₂e', 'Share'])
      + `<p class="small">Biogenic CO₂: ${f1(F.bio)} t, reported separately. Direct removals: none recorded. Scope 2 shown ${x.mb ? 'market' : 'location'}-based.</p>`;
    case 'bygas': return '<h2>Scope 1 by greenhouse gas</h2>' + (Object.keys(F.gases).length ? T(Object.entries(F.gases).sort((a, b) => b[1] - a[1]).map(([g, v]) => [esc(g), f1(v), pct(v, F.s1)]), ['Gas', 'tCO₂e', 'Share of Scope 1']) : '<p class="small">No Scope 1 emissions in the period.</p>');
    case 'bycountry': return '<h2>By country</h2>' + T(F.byCountry.map(([k, v]) => [esc(k), f1(v[0]), f1(v[1]), f1(v[2])]), ['Country', 'Scope 1', 'Scope 2 location', 'Scope 2 market'])
      + '<h2>By business division</h2>' + T(F.byDivision.map(([k, v]) => [esc(k), f1(v[0]), f1(v[1]), f1(v[2])]), ['Division', 'Scope 1', 'Scope 2 location', 'Scope 2 market']);
    case 'esrs_e1': return `<h2>ESRS E1 Climate change · E1-6 Gross Scopes 1, 2, 3 and total GHG emissions</h2><p class="small">European Sustainability Reporting Standards (CSRD). Values for the period viewed; ${x.settings.entity.revenue ? `net revenue ${f2(x.settings.entity.revenue)} ${esc(F.revCur)}` : 'net revenue not entered (Organisation → Company details) — intensity left blank'}.</p>` + dpTable(datapoints('esrs', x));
    case 'ifrs_s2': return '<h2>IFRS S2 Climate-related disclosures · GHG emissions (paragraph 29(a))</h2><p class="small">ISSB standard, also the basis of AASB S2 (Australia), the SGX and ACRA rules (Singapore), SSBJ (Japan), UK SRS and other jurisdictions adopting ISSB.</p>' + dpTable(datapoints('ifrs', x));
    case 'cdp': return '<h2>CDP · emissions module</h2><p class="small">Item numbers as in the 2024–2025 CDP corporate questionnaire; check them against the current year’s guidance before submitting.</p>' + dpTable(datapoints('cdp', x));
    case 'gri305': return '<h2>GRI 305 Emissions (2016)</h2>' + dpTable(datapoints('gri', x));
    case 'secr': return '<h2>UK Streamlined Energy and Carbon Reporting (SECR)</h2><p class="small">UK operations = facilities in the United Kingdom (country GB). Add the intensity ratio and the energy-efficiency actions taken in the year to the directors’ report.</p>' + dpTable(datapoints('secr', x));
    case 'sb253': return '<h2>California SB 253 · Climate Corporate Data Accountability Act</h2><p class="small">Scope 1 and 2 first, Scope 3 from the following year, under the GHG Protocol; limited assurance on Scope 1 and 2 to start.</p>' + dpTable(datapoints('sb253', x));
  }
  return '';
}

// ------------------------------------------------------------------ ISO 14064-1 designed report --
const PAL = ['#0E7C66', '#2BA38A', '#E3B25A', '#1D5E80', '#C2523C', '#8A7B3C', '#86CDB4', '#9AA7A2'];
function donut(parts: { n: string; v: number }[], size = 170, label = '') {
  const tot = parts.reduce((a, p) => a + Math.max(0, p.v), 0) || 1, r = size / 2 - 14, c = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map((p, i) => { const len = (Math.max(0, p.v) / tot) * c; const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${PAL[i % PAL.length]}" stroke-width="26" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return p.v > 0 ? s : ''; }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#EEF2EF" stroke-width="26"/>${segs}<text x="${size / 2}" y="${size / 2 - 1}" text-anchor="middle" font-size="17" font-weight="700" fill="#0B2A25">${esc(label)}</text><text x="${size / 2}" y="${size / 2 + 15}" text-anchor="middle" font-size="10" fill="#5b6b66">${label.startsWith('±') ? 'uncertainty' : 'tCO₂e'}</text></svg>`;
}
const legend = (parts: { n: string; v: number }[]) => { const t = parts.reduce((a, p) => a + p.v, 0) || 1; return `<div class="lg">${parts.filter((p) => p.v > 0).map((p, i) => `<div><i style="background:${PAL[i % PAL.length]}"></i>${esc(p.n)}<b>${f1(p.v)} t · ${f1((p.v / t) * 100)}%</b></div>`).join('')}</div>`; };
function stacked(cols: { l: string; v: number[] }[], names: string[], w = 640, h = 200) {
  const max = Math.max(1, ...cols.map((c) => c.v.reduce((a, v) => a + v, 0))), bw = (w - 40) / Math.max(1, cols.length), top = 10, bot = 22;
  const y = (v: number) => (v / max) * (h - top - bot);
  const bars = cols.map((c, i) => { let acc = 0; return c.v.map((v, j) => { const hh = y(v); acc += hh; return `<rect x="${36 + i * bw + bw * 0.18}" y="${h - bot - acc}" width="${bw * 0.64}" height="${Math.max(0, hh)}" fill="${PAL[j % PAL.length]}" rx="2"/>`; }).join('') + `<text x="${36 + i * bw + bw / 2}" y="${h - 6}" text-anchor="middle" font-size="10" fill="#5b6b66">${esc(c.l)}</text>`; }).join('');
  const grid = [0, 0.5, 1].map((g) => `<line x1="34" x2="${w}" y1="${h - bot - g * (h - top - bot)}" y2="${h - bot - g * (h - top - bot)}" stroke="#e4ebe8"/><text x="30" y="${h - bot - g * (h - top - bot) + 3}" text-anchor="end" font-size="9" fill="#5b6b66">${Math.round(max * g).toLocaleString('en')}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img">${grid}${bars}</svg><div class="lg row">${names.map((n, j) => `<div><i style="background:${PAL[j % PAL.length]}"></i>${esc(n)}</div>`).join('')}</div>`;
}
function hbars(items: { n: string; v: number; sub?: string }[], w = 640) {
  const max = Math.max(1, ...items.map((i) => i.v)), rh = 26;
  return `<svg viewBox="0 0 ${w} ${items.length * rh + 4}" width="100%" role="img">${items.map((it, i) => `<text x="0" y="${i * rh + 16}" font-size="11" fill="#0B2A25">${esc(it.n.length > 42 ? it.n.slice(0, 41) + '…' : it.n)}</text>
    <rect x="260" y="${i * rh + 5}" width="${Math.max(2, ((w - 430) * it.v) / max)}" height="15" rx="3" fill="${PAL[0]}" opacity="${1 - i * 0.06}"/><text x="${266 + ((w - 430) * it.v) / max}" y="${i * rh + 16}" font-size="10.5" fill="#3D4F49">${f1(it.v)} t${it.sub ? ` · ${esc(it.sub)}` : ''}</text>`).join('')}</svg>`;
}

function isoReport(x: RepCtx, F: Fig, logo?: string) {
  const e = x.settings.entity, co = x.settings.company, name = e.legal || co.name, tot = x.mb ? F.totM : F.totL, s2 = x.mb ? F.s2m : F.s2l;
  const isoParts = ISO_CATS.map(([n, nm]) => ({ n: `Category ${n} · ${nm.replace('Indirect emissions ', '').replace('Direct GHG emissions and removals', 'Direct emissions')}`, v: F.iso[n] ?? 0 }));
  // previous year, same months (from the dashboard rows of the comparison year)
  const prev = x.prev.reduce((a, r) => a + r.s1 + r.s2 + r.s3 + r.s33, 0), yoy = prev ? ((tot - prev) / prev) * 100 : null;
  const months = x.months.map((m) => { const rs = x.rows.filter((r) => r.m === m); return { l: MN[m - 1]!, v: [rs.reduce((a, r) => a + r.s1, 0), rs.reduce((a, r) => a + r.s2, 0), rs.reduce((a, r) => a + r.s3 + r.s33, 0)] }; });
  const src = new Map<string, number>(); for (const l of x.lines) src.set(l.item, (src.get(l.item) ?? 0) + lineT(l, x.mb));
  const top = [...src.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, v]) => ({ n, v, sub: `${f1((v / (tot || 1)) * 100)}%` }));
  const facs = x.d.facilities.map((f) => ({ n: f.name, v: x.lines.filter((l) => l.f === f.id).reduce((a, l) => a + lineT(l, x.mb), 0) })).filter((f) => f.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
  const dq = { Actual: 0, Estimated: 0, Proxy: 0 } as Record<string, number>; for (const l of x.lines) dq[l.dataType === 'proxy' || l.method === 'spend' ? 'Proxy' : l.dataType === 'estimated' || l.captured === 'commute' ? 'Estimated' : 'Actual']! += lineT(l, x.mb);
  const ev = x.lines.length ? (x.lines.filter((l) => l.evidence).length / x.lines.length) * 100 : 0;
  const biggest = isoParts.slice().sort((a, b) => b.v - a.v)[0]!, intensity = F.employees ? tot / F.employees : null;
  const cats3 = Object.entries(F.s3cat).sort((a, b) => b[1] - a[1]);
  const analysis = [
    `Total emissions for ${esc(x.period)} were <b>${f1(tot)} tCO₂e</b> (${x.mb ? 'market' : 'location'}-based Scope 2)${yoy != null ? `, <b>${yoy > 0 ? 'up' : 'down'} ${f1(Math.abs(yoy))}%</b> on the same months of ${x.d.cmpYear}` : ''}.`,
    `${esc(biggest.n)} is the largest category at ${pct(biggest.v, tot)} of the total.`,
    top[0] ? `The largest single source is <b>${esc(top[0].n)}</b> (${top[0].sub}); the top three sources make up ${pct(top.slice(0, 3).reduce((a, t) => a + t.v, 0), tot)}.` : '',
    F.s2l && F.s2m !== F.s2l ? `Contractual instruments (certificates, supplier factors) change Scope 2 from ${f1(F.s2l)} t location-based to ${f1(F.s2m)} t market-based (${f1(((F.s2m - F.s2l) / F.s2l) * 100)}%).` : '',
    cats3.length ? `Scope 3 is ${pct(F.s3, F.totL)} of the location-based total; the largest Scope 3 categories are ${cats3.slice(0, 3).map(([c, v]) => `${esc(s3Name(c))} (${f1(v)} t)`).join(', ')}.` : '',
    `${f1(((dq.Actual ?? 0) / (tot || 1)) * 100)}% of emissions come from actual (measured) data; ${f1(ev)}% of entries have a meter, bill or source file attached. The combined uncertainty of the total is about <b>±${f1(F.uncPct)}%</b>.`,
    intensity != null ? `Intensity: ${f2(intensity)} tCO₂e per employee${F.revenue ? `; ${f2((tot / F.revenue) * 1e6)} tCO₂e per million ${esc(F.revCur)} of revenue` : ''}.` : '',
  ].filter(Boolean);
  const recs = [
    dq.Proxy ? `Replace spend-based (proxy) data, ${pct(dq.Proxy, tot)} of the total, with supplier-specific or activity data for the largest purchases.` : '',
    ev < 80 ? 'Attach bills, meter exports or source files to more entries before assurance (currently ' + f1(ev) + '%).' : '',
    top[0] ? `Prioritise reduction actions on ${esc(top[0].n)}.` : '',
    Object.keys(F.s3cat).length < 5 ? 'Screen the remaining Scope 3 categories and document the exclusions.' : '',
  ].filter(Boolean);
  const kv = (rows: [string, string][]) => `<table class="kv"><tbody>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="iso">
  <div class="isocover">${logo ? `<img class="isologo" src="${logo}" alt="">` : ''}<div class="eyb">Greenhouse gas report · ISO 14064-1:2018</div><h1>${esc(name)}</h1><div class="isosub">${esc(x.label)} · ${esc(x.period)}</div>
    <div class="isokpi"><div><b>${f1(tot)}</b><span>tCO₂e total</span></div><div><b>${f1(F.s1)}</b><span>Category 1 · direct</span></div><div><b>${f1(s2)}</b><span>Category 2 · energy (${x.mb ? 'market' : 'location'})</span></div><div><b>${f1(tot - F.s1 - s2)}</b><span>Categories 3–6 · other indirect</span></div></div></div>
  <h2>1 · Key findings</h2><ul class="isolist">${analysis.map((a) => `<li>${a}</li>`).join('')}</ul>
  <h2>2 · Emissions by ISO 14064-1 category</h2><div class="isogrid"><div>${donut(isoParts, 180, f1(tot))}</div>${legend(isoParts)}</div>
  ${T(ISO_CATS.map(([n, nm, d, codes]) => [`<b>${n}</b> · ${esc(nm)}<div class="small">${esc(d)} · GHG Protocol ${codes.join(', ')}</div>`, F.iso[n] ? f1(F.iso[n]!) : '—', pct(F.iso[n] ?? 0, tot), F.iso[n] ? 'Quantified' : codes.every((c) => c.startsWith('3.') ) ? esc(excl(x)(codes[0]!)) : 'No data']), ['Category', 'tCO₂e', 'Share', 'Status'])}
  <h2>3 · Emissions over the period</h2>${stacked(months, ['Category 1 · direct', 'Category 2 · imported energy', 'Categories 3–6 · other indirect'])}
  <h2>4 · Largest sources</h2>${hbars(top)}
  <h2>5 · By facility</h2>${hbars(facs)}
  <h2>6 · Direct emissions by greenhouse gas</h2>${Object.keys(F.gases).length ? `<div class="isogrid"><div>${donut(Object.entries(F.gases).map(([n, v]) => ({ n, v })), 150, f1(F.s1))}</div>${legend(Object.entries(F.gases).map(([n, v]) => ({ n, v })))}</div>` : '<p class="small">No direct emissions.</p>'}
  <p class="small">Biogenic CO₂ from biomass and biogenic waste: <b>${f1(F.bio)} t</b>, reported separately and not included in the totals. Direct GHG removals: none recorded.</p>
  <h2>7 · Data quality and uncertainty</h2><div class="isogrid"><div>${donut(Object.entries(dq).map(([n, v]) => ({ n, v })), 150, `±${f1(F.uncPct)}%`)}</div>${legend(Object.entries(dq).map(([n, v]) => ({ n: `${n} data`, v })))}</div>
  <p class="small">Uncertainty per entry: measured with evidence ±5%, measured without evidence ±15%, survey-based ±20%, spend-based ±40%; combined as the root of the sum of squares. Evidence attached to ${f1(ev)}% of entries.</p>
  <h2>8 · Recommendations</h2><ul class="isolist">${recs.map((r) => `<li>${r}</li>`).join('') || '<li>Maintain the current data collection and controls.</li>'}</ul>
  <h2>9 · Organization, boundaries and period</h2>${kv([['Reporting organization', name], ['Registration / LEI', [e.licence, e.lei].filter(Boolean).join(' · ') || 'to be completed'], ['Sector', [e.sector, e.sectorCode].filter(Boolean).join(' · ') || 'to be completed'],
    ['Responsible person', e.contact || 'to be completed'], ['Reporting period', x.period], ['Organizational boundary', `${x.consolidation} — ${x.d.facilities.length} facilities`], ['Reporting boundary', 'Direct emissions (category 1), imported energy (category 2) and the significant indirect emissions of categories 3–6 listed above'],
    ['Base year', `${co.baseYear ?? '—'}${(x.settings.restatements ?? []).some((r) => r.applied) ? ` (recalculated: ${(x.settings.restatements ?? []).filter((r) => r.applied).length} change${(x.settings.restatements ?? []).filter((r) => r.applied).length > 1 ? 's' : ''})` : ''}`], ['Global warming potentials', `IPCC ${co.gwp}, 100-year`]])}
  <h2>10 · Quantification approach and emission factors</h2><p>Emissions = activity data × emission factor, per entry, with the factor in force for the period (UK DESNZ conversion factors, IPCC 2006 and 2019 Refinement defaults, US EPA supply-chain factors, supplier- and site-specific factors). Category 2 is reported location-based (grid averages) and market-based (contractual instruments, then residual mix). Only entries approved under maker-checker review are included.</p>
  ${T([...new Map(x.lines.map((l) => [l.source ?? 'own / supplier factor', 0])).keys()].map((s2n) => [esc(s2n), x.lines.filter((l) => (l.source ?? 'own / supplier factor') === s2n).length]), ['Factor source', 'Entries'])}
  <h2>11 · Exclusions</h2>${T(GHG_CATS.filter(([c]) => c.startsWith('3.') && !F.s3cat[c]).map(([c, , n]) => [`${c} ${esc(n)} (ISO category ${isoOf(c)})`, esc(excl(x)(c))]), ['Source', 'Reason'])}
  <h2>12 · Statement and verification</h2><p>This report has been prepared in accordance with ISO 14064-1:2018. ${'Verification status: to be completed (ISO 14064-3).'}</p>
  <table class="kv"><tbody><tr><td>Approved by (name, title, date)</td><td>&nbsp;</td></tr><tr><td>Verification body and level of assurance</td><td>&nbsp;</td></tr></tbody></table>
  </div>`;
}
export const ISO_CSS = '.iso h2{color:#0E7C66}.isocover{border-radius:16px;padding:26px;background:linear-gradient(135deg,#0B2A25,#0E7C66);color:#fff;position:relative}.isocover .eyb{color:#C6F06B}.isocover h1{color:#fff;margin:6px 0 2px}.isosub{opacity:.85}.isologo{position:absolute;right:22px;top:20px;max-height:56px;max-width:180px;background:#fff;border-radius:8px;padding:6px}.isokpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.isokpi div{background:rgba(255,255,255,.1);border-radius:10px;padding:10px}.isokpi b{display:block;font-size:22px}.isokpi span{font-size:11.5px;opacity:.85}.isogrid{display:grid;grid-template-columns:200px 1fr;gap:18px;align-items:center}.lg{display:grid;gap:6px;font-size:12.5px}.lg.row{display:flex;flex-wrap:wrap;gap:14px;margin-top:4px}.lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px}.lg b{margin-left:8px;font-weight:600;color:#3D4F49}.isolist li{margin:4px 0}table.dp td:first-child{white-space:nowrap}@media print{.isocover{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
