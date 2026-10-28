/**
 * SEBI BRSR Core: the nine attributes and their KPIs (LODR master circular Annexure 17A, as amended by
 * SEBI/HO/CFD/CFD-PoD-1/P/CIR/2025/42 of 28 March 2025), with the calculation rules of the Industry Standards on
 * Reporting of BRSR Core (ISF, December 2024; SEBI circular of 20 December 2024).
 *
 * Every KPI is one of:
 *   auto     worked out from the company's approved entries for the financial year (can be overridden with a note)
 *   typed    entered for the year (HR, finance, procurement figures)
 *   derived  a ratio of other KPIs (intensities, percentages, LTIFR, days payable)
 *
 * Intensity per revenue adjusted for PPP: revenue from operations (₹) ÷ the IMF implied PPP conversion rate (₹ per
 * international $) = revenue in USD (PPP); intensities are given per USD million (PPP), as in the Standards' example.
 * Pure functions, no database.
 */

export type Kind = 'auto' | 'typed' | 'derived';
export interface Kpi { code: string; attr: number; label: string; unit: string; kind: Kind; dp: number; group?: string; hint?: string; inCore?: boolean; vc?: boolean }

export const ATTRIBUTES: Record<number, string> = {
  1: 'Green-house gas (GHG) footprint', 2: 'Water footprint', 3: 'Energy footprint', 4: 'Embracing circularity — details related to waste management',
  5: 'Enhancing employee wellbeing and safety', 6: 'Enabling gender diversity in business', 7: 'Enabling inclusive development',
  8: 'Fairness in engaging with customers and suppliers', 9: 'Open-ness of business',
};

const K = (code: string, attr: number, label: string, unit: string, kind: Kind, dp = 2, extra: Partial<Kpi> = {}): Kpi => ({ code, attr, label, unit, kind, dp, inCore: true, ...extra });
const I = (code: string, attr: number, label: string, unit: string, dp = 0, extra: Partial<Kpi> = {}): Kpi => K(code, attr, label, unit, 'typed', dp, { inCore: false, ...extra });

/** The catalogue. `inCore` = a row of the BRSR Core table; the others are inputs to a derived row. `vc` = asked of value-chain partners. */
export const KPIS: Kpi[] = [
  // 1 · GHG footprint
  K('ghg.s1', 1, 'Total Scope 1 emissions', 'tCO₂e', 'auto', 2, { vc: true, hint: 'GHG Protocol; break-up into CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃ in the detail' }),
  K('ghg.s2', 1, 'Total Scope 2 emissions', 'tCO₂e', 'auto', 2, { vc: true, hint: 'Location-based; Indian grid electricity at the latest CEA factor' }),
  K('ghg.int_ppp', 1, 'GHG emission intensity (Scope 1 + 2) per revenue from operations adjusted for PPP', 'tCO₂e / USD Mn (PPP)', 'derived', 4),
  K('ghg.int_out', 1, 'GHG emission intensity (Scope 1 + 2) per unit of output', 'tCO₂e / unit', 'derived', 6),
  // 2 · Water footprint
  K('water.withdrawal', 2, 'Total water withdrawal', 'kL', 'auto', 0, { inCore: false }),
  K('water.consumption', 2, 'Total water consumption', 'kL', 'auto', 0, { vc: true, hint: 'Withdrawal less discharge (input − output from metered data)' }),
  K('water.int_ppp', 2, 'Water consumption intensity per revenue adjusted for PPP', 'kL / USD Mn (PPP)', 'derived', 2),
  K('water.int_out', 2, 'Water consumption intensity per unit of output', 'kL / unit', 'derived', 6),
  K('water.discharge', 2, 'Water discharge — total', 'kL', 'auto', 0),
  I('water.dis_none', 2, 'of which discharged with no treatment', 'kL', 0, { group: 'Discharge by level of treatment' }),
  I('water.dis_primary', 2, 'of which with primary treatment', 'kL', 0, { group: 'Discharge by level of treatment' }),
  I('water.dis_secondary', 2, 'of which with secondary treatment', 'kL', 0, { group: 'Discharge by level of treatment' }),
  I('water.dis_tertiary', 2, 'of which with tertiary treatment', 'kL', 0, { group: 'Discharge by level of treatment' }),
  // 3 · Energy footprint
  K('energy.total', 3, 'Total energy consumed', 'GJ', 'auto', 0, { vc: true }),
  K('energy.renewable', 3, 'Energy from renewable sources', 'GJ', 'auto', 0, { inCore: false, hint: 'Biomass, biogas and biofuels; electricity covered by renewable certificates or contracts' }),
  K('energy.re_share', 3, '% of energy consumed from renewable sources', '%', 'derived', 1),
  K('energy.int_ppp', 3, 'Energy intensity per revenue adjusted for PPP', 'GJ / USD Mn (PPP)', 'derived', 2),
  K('energy.int_out', 3, 'Energy intensity per unit of output', 'GJ / unit', 'derived', 6),
  // 4 · Embracing circularity
  K('waste.a', 4, 'Plastic waste (A)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.b', 4, 'E-waste (B)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.c', 4, 'Bio-medical waste (C)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.d', 4, 'Construction and demolition waste (D)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.e', 4, 'Battery waste (E)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.f', 4, 'Radioactive waste (F)', 't', 'typed', 3, { group: 'Waste generated' }),
  K('waste.g', 4, 'Other hazardous waste (G)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.h', 4, 'Other non-hazardous waste (H)', 't', 'auto', 3, { group: 'Waste generated' }),
  K('waste.total', 4, 'Total waste generated (A+B+C+D+E+F+G+H)', 't', 'derived', 3, { vc: true }),
  K('waste.int_ppp', 4, 'Waste intensity per revenue adjusted for PPP', 't / USD Mn (PPP)', 'derived', 4),
  K('waste.int_out', 4, 'Waste intensity per unit of output', 't / unit', 'derived', 6),
  K('waste.recycled', 4, 'Recovered through recycling', 't', 'auto', 3, { group: 'Recovered' }),
  K('waste.reused', 4, 'Recovered through re-use', 't', 'auto', 3, { group: 'Recovered' }),
  K('waste.other_recovery', 4, 'Recovered through other recovery operations', 't', 'auto', 3, { group: 'Recovered' }),
  K('waste.incineration', 4, 'Disposed of by incineration', 't', 'auto', 3, { group: 'Disposed' }),
  K('waste.landfill', 4, 'Disposed of by landfilling', 't', 'auto', 3, { group: 'Disposed' }),
  K('waste.other_disposal', 4, 'Disposed of by other disposal operations', 't', 'auto', 3, { group: 'Disposed' }),
  // 5 · Employee wellbeing and safety
  I('emp.wellbeing_spend', 5, 'Spending on employee and worker wellbeing measures', '₹', 0, { hint: 'Health and accident insurance, maternity/paternity benefits, day care, health and safety incl. mental health — from audited ledger heads; premiums paid by employees excluded' }),
  K('emp.wellbeing_pct', 5, 'Spending on wellbeing measures as % of total revenue', '%', 'derived', 2),
  I('emp.lti_emp', 5, 'Lost-time injuries — employees', 'number', 0, { group: 'Safety' }),
  I('emp.hours_emp', 5, 'Person-hours worked — employees', 'hours', 0, { group: 'Safety' }),
  I('emp.lti_wkr', 5, 'Lost-time injuries — workers (incl. contract workforce)', 'number', 0, { group: 'Safety' }),
  I('emp.hours_wkr', 5, 'Person-hours worked — workers (incl. contract workforce)', 'hours', 0, { group: 'Safety' }),
  K('emp.ltifr_emp', 5, 'LTIFR — employees (per one million person-hours worked)', 'rate', 'derived', 2, { group: 'Safety' }),
  K('emp.ltifr_wkr', 5, 'LTIFR — workers (per one million person-hours worked)', 'rate', 'derived', 2, { group: 'Safety' }),
  K('emp.disab_emp', 5, 'High-consequence injuries (permanent disabilities) — employees', 'number', 'typed', 0, { group: 'Safety' }),
  K('emp.disab_wkr', 5, 'High-consequence injuries (permanent disabilities) — workers', 'number', 'typed', 0, { group: 'Safety' }),
  K('emp.fatal_emp', 5, 'Fatalities — employees', 'number', 'typed', 0, { group: 'Safety' }),
  K('emp.fatal_wkr', 5, 'Fatalities — workers', 'number', 'typed', 0, { group: 'Safety' }),
  // 6 · Gender diversity
  I('gender.wages_female', 6, 'Gross wages paid to females', '₹', 0, { hint: 'Salaries, wages and bonus; excludes retirement benefits, ESOPs and staff welfare' }),
  I('gender.wages_total', 6, 'Gross wages paid — total', '₹', 0),
  K('gender.wages_pct', 6, 'Gross wages paid to females as % of total wages', '%', 'derived', 2),
  I('gender.posh', 6, 'Complaints under the POSH Act, 2013', 'number', 0),
  I('gender.female_avg', 6, 'Female employees and workers (average of opening and closing)', 'number', 0),
  K('gender.posh_pct', 6, 'POSH complaints as % of female employees and workers', '%', 'derived', 2),
  K('gender.posh_upheld', 6, 'POSH complaints upheld', 'number', 'typed', 0),
  // 7 · Inclusive development
  I('incl.purchases', 7, 'Total purchases (raw materials, spares, services, capex)', '₹', 0),
  I('incl.msme', 7, 'Input material sourced from MSMEs / small producers', '₹', 0),
  I('incl.india', 7, 'Input material sourced from within India', '₹', 0),
  K('incl.msme_pct', 7, 'Input material sourced from MSMEs / small producers (% of purchases by value)', '%', 'derived', 2),
  K('incl.india_pct', 7, 'Input material sourced from within India (% of purchases by value)', '%', 'derived', 2),
  I('incl.w_rural', 7, 'Wages paid in rural locations (incl. contract labour)', '₹', 0, { group: 'Wages by location (RBI)' }),
  I('incl.w_semi', 7, 'Wages paid in semi-urban locations', '₹', 0, { group: 'Wages by location (RBI)' }),
  I('incl.w_urban', 7, 'Wages paid in urban locations', '₹', 0, { group: 'Wages by location (RBI)' }),
  I('incl.w_metro', 7, 'Wages paid in metropolitan locations', '₹', 0, { group: 'Wages by location (RBI)' }),
  K('incl.rural_pct', 7, 'Wages paid in rural locations (% of total wage cost)', '%', 'derived', 2, { group: 'Wages by location (RBI)' }),
  K('incl.semi_pct', 7, 'Wages paid in semi-urban locations (% of total wage cost)', '%', 'derived', 2, { group: 'Wages by location (RBI)' }),
  K('incl.urban_pct', 7, 'Wages paid in urban locations (% of total wage cost)', '%', 'derived', 2, { group: 'Wages by location (RBI)' }),
  K('incl.metro_pct', 7, 'Wages paid in metropolitan locations (% of total wage cost)', '%', 'derived', 2, { group: 'Wages by location (RBI)' }),
  // 8 · Fairness with customers and suppliers
  I('fair.customer_breaches', 8, 'Incidents involving customers\' personal data', 'number', 0),
  I('fair.incidents', 8, 'Data breaches / cyber security incidents reported to CERT-In', 'number', 0),
  K('fair.breach_pct', 8, 'Data breaches involving customers\' personal identifiable information (% of incidents)', '%', 'derived', 2),
  I('fair.payables', 8, 'Trade payables (accounts payable)', '₹', 0),
  I('fair.procured', 8, 'Cost of goods and services procured', '₹', 0),
  K('fair.days_payable', 8, 'Number of days of accounts payable', 'days', 'derived', 1),
  // 9 · Openness of business
  I('open.purch_trading', 9, 'Purchases from trading houses', '₹', 0, { group: 'Concentration of purchases' }),
  K('open.purch_trading_pct', 9, 'Purchases from trading houses as % of total purchases', '%', 'derived', 2, { group: 'Concentration of purchases' }),
  K('open.trading_count', 9, 'Number of trading houses purchased from', 'number', 'typed', 0, { group: 'Concentration of purchases' }),
  I('open.trading_top10', 9, 'Purchases from the top 10 trading houses', '₹', 0, { group: 'Concentration of purchases' }),
  K('open.trading_top10_pct', 9, 'Purchases from the top 10 trading houses as % of purchases from trading houses', '%', 'derived', 2, { group: 'Concentration of purchases' }),
  I('open.sales', 9, 'Total sales', '₹', 0, { group: 'Concentration of sales' }),
  I('open.sales_dealers', 9, 'Sales to dealers / distributors', '₹', 0, { group: 'Concentration of sales' }),
  K('open.sales_dealers_pct', 9, 'Sales to dealers / distributors as % of total sales', '%', 'derived', 2, { group: 'Concentration of sales' }),
  K('open.dealer_count', 9, 'Number of dealers / distributors sold to', 'number', 'typed', 0, { group: 'Concentration of sales' }),
  I('open.dealer_top10', 9, 'Sales to the top 10 dealers / distributors', '₹', 0, { group: 'Concentration of sales' }),
  K('open.dealer_top10_pct', 9, 'Sales to the top 10 dealers / distributors as % of sales to dealers', '%', 'derived', 2, { group: 'Concentration of sales' }),
  I('open.rp_purchases', 9, 'Purchases from related parties', '₹', 0, { group: 'Share of related-party transactions' }),
  I('open.rp_sales', 9, 'Sales to related parties', '₹', 0, { group: 'Share of related-party transactions' }),
  I('open.loans', 9, 'Loans and advances — total', '₹', 0, { group: 'Share of related-party transactions' }),
  I('open.rp_loans', 9, 'Loans and advances given to related parties', '₹', 0, { group: 'Share of related-party transactions' }),
  I('open.investments', 9, 'Investments — total', '₹', 0, { group: 'Share of related-party transactions' }),
  I('open.rp_investments', 9, 'Investments in related parties', '₹', 0, { group: 'Share of related-party transactions' }),
  K('open.rp_purch_pct', 9, 'Purchases from related parties (% of total purchases)', '%', 'derived', 2, { group: 'Share of related-party transactions' }),
  K('open.rp_sales_pct', 9, 'Sales to related parties (% of total sales)', '%', 'derived', 2, { group: 'Share of related-party transactions' }),
  K('open.rp_loans_pct', 9, 'Loans and advances to related parties (% of total loans and advances)', '%', 'derived', 2, { group: 'Share of related-party transactions' }),
  K('open.rp_inv_pct', 9, 'Investments in related parties (% of total investments)', '%', 'derived', 2, { group: 'Share of related-party transactions' }),
];
export const KPI = new Map(KPIS.map((k) => [k.code, k]));
export const VC_KPIS = KPIS.filter((k) => k.vc).map((k) => k.code);

export type Values = Record<string, number | null>;
export interface Ctx { revenue: number | null; ppp: number | null; output: number | null }

const div = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? null : a / b);
const pct = (a: number | null | undefined, b: number | null | undefined) => { const r = div(a, b); return r == null ? null : r * 100; };
const sum = (...xs: (number | null | undefined)[]) => (xs.every((x) => x == null) ? null : xs.reduce<number>((s, x) => s + (x ?? 0), 0));

/** USD million (PPP) of revenue from operations. */
export const revenuePpp = (c: Ctx) => { const r = div(c.revenue, c.ppp); return r == null ? null : r / 1e6; };

/** Fill the derived KPIs from the base values (auto and typed). */
export function derive(v: Values, c: Ctx): Values {
  const o: Values = { ...v };
  const rp = revenuePpp(c);
  const ghg = sum(v['ghg.s1'], v['ghg.s2']);
  o['ghg.int_ppp'] = div(ghg, rp); o['ghg.int_out'] = div(ghg, c.output);
  o['water.int_ppp'] = div(v['water.consumption'], rp); o['water.int_out'] = div(v['water.consumption'], c.output);
  o['energy.re_share'] = pct(v['energy.renewable'], v['energy.total']);
  o['energy.int_ppp'] = div(v['energy.total'], rp); o['energy.int_out'] = div(v['energy.total'], c.output);
  o['waste.total'] = sum(...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => v[`waste.${x}`]));
  o['waste.int_ppp'] = div(o['waste.total'], rp); o['waste.int_out'] = div(o['waste.total'], c.output);
  o['emp.wellbeing_pct'] = pct(v['emp.wellbeing_spend'], c.revenue);
  const lt = (l: string, h: string) => { const r = div(v[l], v[h]); return r == null ? null : r * 1e6; };
  o['emp.ltifr_emp'] = lt('emp.lti_emp', 'emp.hours_emp'); o['emp.ltifr_wkr'] = lt('emp.lti_wkr', 'emp.hours_wkr');
  o['gender.wages_pct'] = pct(v['gender.wages_female'], v['gender.wages_total']);
  o['gender.posh_pct'] = pct(v['gender.posh'], v['gender.female_avg']);
  o['incl.msme_pct'] = pct(v['incl.msme'], v['incl.purchases']); o['incl.india_pct'] = pct(v['incl.india'], v['incl.purchases']);
  const w = sum(v['incl.w_rural'], v['incl.w_semi'], v['incl.w_urban'], v['incl.w_metro']);
  o['incl.rural_pct'] = pct(v['incl.w_rural'], w); o['incl.semi_pct'] = pct(v['incl.w_semi'], w); o['incl.urban_pct'] = pct(v['incl.w_urban'], w); o['incl.metro_pct'] = pct(v['incl.w_metro'], w);
  o['fair.breach_pct'] = pct(v['fair.customer_breaches'], v['fair.incidents']);
  const dp = div(v['fair.payables'], v['fair.procured']); o['fair.days_payable'] = dp == null ? null : dp * 365;
  o['open.purch_trading_pct'] = pct(v['open.purch_trading'], v['incl.purchases']);
  o['open.trading_top10_pct'] = pct(v['open.trading_top10'], v['open.purch_trading']);
  o['open.sales_dealers_pct'] = pct(v['open.sales_dealers'], v['open.sales']);
  o['open.dealer_top10_pct'] = pct(v['open.dealer_top10'], v['open.sales_dealers']);
  o['open.rp_purch_pct'] = pct(v['open.rp_purchases'], v['incl.purchases']); o['open.rp_sales_pct'] = pct(v['open.rp_sales'], v['open.sales']);
  o['open.rp_loans_pct'] = pct(v['open.rp_loans'], v['open.loans']); o['open.rp_inv_pct'] = pct(v['open.rp_investments'], v['open.investments']);
  return o;
}

/** Checks a verifier would raise. */
export function checks(v: Values): string[] {
  const p: string[] = [];
  const dis = sum(v['water.dis_none'], v['water.dis_primary'], v['water.dis_secondary'], v['water.dis_tertiary']);
  if (dis != null && v['water.discharge'] != null && Math.abs(dis - v['water.discharge']) > Math.max(1, 0.005 * v['water.discharge'])) p.push(`Discharge by level of treatment (${Math.round(dis)} kL) does not add up to total discharge (${Math.round(v['water.discharge'])} kL)`);
  if ((v['water.consumption'] ?? 0) < 0) p.push('Water discharge is larger than withdrawal: check the meters');
  const rec = sum(v['waste.recycled'], v['waste.reused'], v['waste.other_recovery'], v['waste.incineration'], v['waste.landfill'], v['waste.other_disposal']);
  const tot = sum(...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => v[`waste.${x}`]));
  if (rec != null && tot != null && rec > tot * 1.005 + 0.001) p.push('More waste recovered and disposed of than generated');
  for (const [a, b, l] of [['gender.wages_female', 'gender.wages_total', 'Wages to females'], ['incl.msme', 'incl.purchases', 'MSME purchases'], ['incl.india', 'incl.purchases', 'Purchases within India'],
    ['open.trading_top10', 'open.purch_trading', 'Top 10 trading houses'], ['open.dealer_top10', 'open.sales_dealers', 'Top 10 dealers'], ['open.rp_loans', 'open.loans', 'Related-party loans'], ['open.rp_investments', 'open.investments', 'Related-party investments'],
    ['gender.posh_upheld', 'gender.posh', 'POSH complaints upheld'], ['fair.customer_breaches', 'fair.incidents', 'Customer data breaches']] as const)
    if (v[a] != null && v[b] != null && v[a]! > v[b]! + 1e-9) p.push(`${l} are more than the total they are a share of`);
  if ((v['energy.renewable'] ?? 0) > (v['energy.total'] ?? Infinity)) p.push('Renewable energy is more than total energy');
  return p;
}

/** BRSR waste category of a waste item (Waste Management Rules, 2016 as amended): A plastic … H other non-hazardous. */
export function wasteCategory(sub: string, item: string, hazardous: boolean): 'a' | 'b' | 'c' | 'd' | 'e' | 'g' | 'h' {
  const s = `${sub} ${item}`.toLowerCase();
  if (/batter/.test(s)) return 'e';
  if (/weee|electrical items|e-waste/.test(s)) return 'b';
  if (/clinical|healthcare|bio-?medical/.test(s)) return 'c';
  if (/asbestos/.test(s)) return 'g';
  if (/^construction/.test(sub.toLowerCase()) && !/mineral oil/.test(s)) return hazardous ? 'g' : 'd';
  if (/^plastic/.test(sub.toLowerCase()) || /plastics?:/.test(s)) return hazardous ? 'g' : 'a';
  if (hazardous || /hazardous|mineral oil|oily|solvent|chemical|paints/.test(s)) return 'g';
  return 'h';
}
/** Recovery or disposal route of a waste entry: its method (GRI 306) or else the item's route. */
export function wasteRoute(gri: string | null, route: string | null): 'recycled' | 'reused' | 'other_recovery' | 'incineration' | 'landfill' | 'other_disposal' {
  const g = gri ?? '';
  if (g === 'reuse') return 'reused';
  if (g === 'recycling' || (!g && (route === 'closed_loop' || route === 'open_loop'))) return 'recycled';
  if (['composting', 'ad'].includes(g) || (!g && ['composting', 'ad'].includes(route ?? ''))) return 'other_recovery';
  // incineration, with or without energy recovery, is a disposal operation (GRI 306-5, as the platform's waste methods)
  if (g === 'incin_er' || g === 'incin_noer' || (!g && route === 'combustion')) return 'incineration';
  if (g === 'landfill' || (!g && route === 'landfill')) return 'landfill';
  return 'other_disposal';
}

/** Indian financial year label: 2025 → "FY 2025-26". */
export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
/** The IMF implied PPP conversion rate cited in the Industry Standards (April 2024); replace with the latest IMF value. */
export const PPP_DEFAULT = 22.4;
