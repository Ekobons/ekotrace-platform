/**
 * Compliance Position Desk — the regulation library (pure, no database).
 *
 * Each regulation: who it applies to (from the company profile and facts gathered from the other modules), and its
 * obligations, each with the date it falls due for a reporting period. Dates and thresholds as published by the
 * authority, checked October 2026; each regulation carries its source. Where an authority has not set a date yet,
 * the obligation says so instead of guessing.
 */

export type Applies = 'applies' | 'may_apply' | 'not_applicable';
export type Status = 'not_started' | 'in_progress' | 'done' | 'not_applicable' | 'overdue';

export interface Profile {
  fyEndMonth: number;                       // 1–12: month the financial year ends (India: 3)
  countries: string[];                      // ISO codes where the company operates (EU = any EU member state)
  employees: number | null; turnoverEur: number | null; euTurnoverEur: number | null; euSubsidiaryTurnoverEur: number | null; euEntity: boolean;
  listed: 'none' | 'india' | 'sgx' | 'asx' | 'lse' | 'eu' | 'other';
  sgxSti: boolean; sgxCapOver1bn: boolean;
  indiaTop: 'top150' | 'top250' | 'top500' | 'top1000' | 'listed_other' | 'none';
  cctsObligated: boolean | null;
  cbamImportTonnes: number | null; cbamExporter: boolean | null;
  uaeDesignated: 'yes' | 'no' | 'unknown'; uaeScope12: number | null; eadFacility: boolean | null;
  usRevenueUsd: number | null; californiaBusiness: boolean;
  auGroup: 'group1' | 'group2' | 'group3' | 'none';
  ukQuoted: boolean; ukLarge: boolean;
  eprIndia: boolean | null;                 // places plastic packaging, EEE, batteries or tyres on the Indian market (or recycles them)
  ppwrProducer: boolean | null;             // first makes packaging available in an EU member state
}
export const DEFAULT_PROFILE: Profile = {
  fyEndMonth: 12, countries: [], employees: null, turnoverEur: null, euTurnoverEur: null, euSubsidiaryTurnoverEur: null, euEntity: false,
  listed: 'none', sgxSti: false, sgxCapOver1bn: false, indiaTop: 'none', cctsObligated: null, cbamImportTonnes: null, cbamExporter: null,
  uaeDesignated: 'unknown', uaeScope12: null, eadFacility: null, usRevenueUsd: null, californiaBusiness: false, auGroup: 'none', ukQuoted: false, ukLarge: false, eprIndia: null, ppwrProducer: null,
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** The last day of the month n months after the end of the financial year ending in `year`. */
export function afterFyEnd(year: number, fyEndMonth: number, months: number) {
  const end = new Date(Date.UTC(year, fyEndMonth - 1 + months + 1, 0));
  return iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
}
/** The calendar year in which the first financial year starting on or after `date` ends. */
export function firstFyStarting(date: string, fyEndMonth: number) {
  for (let y = Number(date.slice(0, 4)); ; y++) {
    const start = fyEndMonth === 12 ? iso(y, 1, 1) : iso(y - 1, fyEndMonth + 1, 1);
    if (start >= date) return y;
  }
}
/** The same day in another year; 29 February becomes 28 February in a year that has none. */
export function sameDay(first: string, year: number) {
  const md = first.slice(5);
  if (md === '02-29' && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) return `${year}-02-28`;
  return `${year}-${md}`;
}
/** The reporting period label: the financial year ending in `year`. */
export function periodLabel(year: number, fyEndMonth: number) {
  if (fyEndMonth === 12) return `FY ${year}`;
  return `FY ${year - 1}-${String(year % 100).padStart(2, '0')}`;
}

export interface Obligation {
  code: string; title: string; detail: string;
  due: (period: number, p: Profile) => string | null;   // period = calendar year the reporting period ends in
  from?: number;                                       // first reporting period it applies to
  firstFor?: (p: Profile) => number | null;            // first period for this company (overrides `from`)
  startsOn?: (p: Profile) => string | null;            // first period = the first financial year starting on or after this date (overrides both)
  voluntary?: boolean;                                 // recommended or voluntary: never shown as overdue
  once?: boolean; penalty?: string; module?: { route: string; label: string };
  dueNote?: string;                                    // when due() is null or approximate
}
export interface Regulation {
  code: string; name: string; jurisdiction: string; authority: string; source: string; summary: string;
  applies: (p: Profile) => { applies: Applies; reason: string };
  obligations: Obligation[];
  periodOf?: 'fy' | 'calendar' | 'india_fy';           // how the period runs (default fy)
}

const yes = (reason: string) => ({ applies: 'applies' as const, reason });
const maybe = (reason: string) => ({ applies: 'may_apply' as const, reason });
const no = (reason: string) => ({ applies: 'not_applicable' as const, reason });
const has = (p: Profile, c: string) => p.countries.includes(c);

export const REGULATIONS: Regulation[] = [
  {
    code: 'eu_csrd', name: 'EU Corporate Sustainability Reporting Directive (CSRD)', jurisdiction: 'EU', authority: 'European Commission; national transposition',
    source: 'https://eur-lex.europa.eu/eli/dir/2026/470/oj', summary: 'Sustainability statement under the (simplified) ESRS in the management report, with limited assurance. After Omnibus I (Directive (EU) 2026/470): more than 1,000 employees and more than EUR 450 million net turnover; non-EU groups with more than EUR 450 million EU turnover and an EU subsidiary or branch above EUR 200 million.',
    applies: (p) => {
      if (p.euEntity && p.employees != null && p.turnoverEur != null) {
        if (p.employees > 1000 && p.turnoverEur > 450e6) return yes('EU company above 1,000 employees and EUR 450 million turnover');
        return no('EU company below the Omnibus I thresholds (both 1,000 employees and EUR 450 million needed)');
      }
      if (!p.euEntity && p.euTurnoverEur != null) {
        if (p.euTurnoverEur > 450e6 && (p.euSubsidiaryTurnoverEur ?? 0) > 200e6) return yes('Non-EU group: EU turnover above EUR 450 million and an EU subsidiary or branch above EUR 200 million');
        if (p.euTurnoverEur > 450e6) return maybe('EU turnover above EUR 450 million: in scope if an EU subsidiary or branch has more than EUR 200 million');
        return no('EU turnover below EUR 450 million');
      }
      return has(p, 'EU') ? maybe('Operates in the EU: give employees and turnover to check') : no('No EU operations recorded');
    },
    obligations: [
      { code: 'dma', title: 'Double materiality assessment', detail: 'Impact and financial materiality of sustainability topics; decides which ESRS disclosures apply.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 0), startsOn: (p) => (p.euEntity ? '2027-01-01' : '2028-01-01'), module: { route: '/esg', label: 'ESG & materiality' } },
      { code: 'statement', title: 'Sustainability statement (ESRS) in the management report', detail: 'Published with the annual financial statements; simplified ESRS (Delegated Regulation (EU) 2026/1563) from FY2027.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 4), dueNote: 'With the management report; national deadlines vary (usually 4–5 months after year end)', startsOn: (p) => (p.euEntity ? '2027-01-01' : '2028-01-01'), penalty: 'Set by each Member State', module: { route: '/reports', label: 'Reports (ESRS E1)' } },
      { code: 'assurance', title: 'Limited assurance of the sustainability statement', detail: 'By the statutory auditor or an accredited independent assurance provider.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 4), startsOn: (p) => (p.euEntity ? '2027-01-01' : '2028-01-01'), module: { route: '/assurance', label: 'Audit & assurance' } },
    ],
  },
  {
    code: 'eu_cbam', name: 'EU CBAM — importer (authorised declarant)', jurisdiction: 'EU', authority: 'European Commission; national competent authorities', periodOf: 'calendar',
    source: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en', summary: 'Definitive period from 2026: only authorised CBAM declarants may import CBAM goods above 50 tonnes a year (Regulation (EU) 2025/2083); annual declaration and surrender of certificates by 30 September of the following year; 50% of embedded emissions covered by certificates at each quarter end.',
    applies: (p) => (p.cbamImportTonnes == null ? (has(p, 'EU') ? maybe('Imports into the EU: record CBAM imports to check the 50-tonne threshold') : no('No EU imports of CBAM goods recorded'))
      : p.cbamImportTonnes > 50 ? yes(`${Math.round(p.cbamImportTonnes)} t of CBAM goods imported in the year: above the 50-tonne threshold`) : no(`${Math.round(p.cbamImportTonnes)} t of CBAM goods: below the 50-tonne threshold (electricity and hydrogen always count)`)),
    obligations: [
      { code: 'declarant', title: 'Authorised CBAM declarant status', detail: 'Applied for by 31 March 2026 to keep importing while pending; needed before importing above the threshold.', due: () => '2026-03-31', from: 2026, once: true, module: { route: '/cbam', label: 'CBAM' } },
      { code: 'quarterly_q1', title: 'Hold certificates for 50% of embedded emissions — end of Q1', detail: 'From the 2027 quarters, when certificate sales are open (from 1 February 2027).', due: (y) => iso(y, 3, 31), from: 2027, module: { route: '/cbam', label: 'CBAM' } },
      { code: 'quarterly_q2', title: 'Hold certificates for 50% of embedded emissions — end of Q2', detail: 'From the 2027 quarters, when certificate sales are open (from 1 February 2027).', due: (y) => iso(y, 6, 30), from: 2027, module: { route: '/cbam', label: 'CBAM' } },
      { code: 'quarterly_q3', title: 'Hold certificates for 50% of embedded emissions — end of Q3', detail: 'From the 2027 quarters, when certificate sales are open (from 1 February 2027).', due: (y) => iso(y, 9, 30), from: 2027, module: { route: '/cbam', label: 'CBAM' } },
      { code: 'quarterly_q4', title: 'Hold certificates for 50% of embedded emissions — end of Q4', detail: 'From the 2027 quarters, when certificate sales are open (from 1 February 2027).', due: (y) => iso(y, 12, 31), from: 2027, module: { route: '/cbam', label: 'CBAM' } },
      { code: 'declaration', title: 'Annual CBAM declaration', detail: 'Embedded emissions of the goods imported in the year, with verification reports where actual values are used.', due: (y) => iso(y + 1, 9, 30), from: 2026, penalty: 'Penalty per certificate not surrendered (as for the EU ETS excess-emissions penalty)', module: { route: '/cbam', label: 'CBAM' } },
      { code: 'surrender', title: 'Surrender CBAM certificates', detail: 'Certificates for the declared embedded emissions, less carbon price paid in the country of origin and the free-allocation adjustment.', due: (y) => iso(y + 1, 9, 30), from: 2026, module: { route: '/cbam', label: 'CBAM' } },
    ],
  },
  {
    code: 'eu_cbam_supplier', name: 'EU CBAM — non-EU producer supplying EU importers', jurisdiction: 'EU (importers)', authority: 'Contractual: EU importers', periodOf: 'calendar',
    source: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en', summary: 'No legal duty of its own, but EU importers need the installation\'s verified embedded emissions in time for their annual declaration; without them default values with mark-ups apply.',
    applies: (p) => (p.cbamExporter ? yes('Sells CBAM goods into the EU') : p.cbamExporter === false ? no('Does not sell CBAM goods into the EU') : maybe('Sells cement, steel, aluminium, fertilisers or hydrogen? Then EU buyers will ask for emissions data')),
    obligations: [
      { code: 'communications', title: 'Embedded emissions to EU importers (communication template)', detail: 'Per installation and good; quarterly or annual, as buyers ask.', due: (y) => iso(y + 1, 3, 31), from: 2026, dueNote: 'Recommended: early enough for the importer\'s declaration of 30 September', voluntary: true, module: { route: '/cbam/comms', label: 'CBAM communications' } },
      { code: 'verification', title: 'Verification of the installation\'s emissions', detail: 'By an accredited verifier, so importers can use actual values.', due: (y) => iso(y + 1, 6, 30), from: 2026, dueNote: 'Recommended timing', voluntary: true },
    ],
  },
  {
    code: 'in_brsr', name: 'SEBI BRSR and BRSR Core', jurisdiction: 'India', authority: 'Securities and Exchange Board of India', periodOf: 'india_fy',
    source: 'https://www.sebi.gov.in/legal/circulars/mar-2025/', summary: 'Top 1,000 listed companies by market capitalisation file the BRSR with the annual report; BRSR Core reasonable assurance or assessment by a glide path (top 150 from FY 2023-24 to top 1,000 from FY 2026-27); value-chain disclosures voluntary for the top 250 from FY 2025-26.',
    applies: (p) => (p.indiaTop === 'none' || p.indiaTop === 'listed_other' ? (p.listed === 'india' ? maybe('Listed in India: BRSR applies to the top 1,000 by market capitalisation') : no('Not among the top 1,000 listed companies in India'))
      : yes(`Among the ${p.indiaTop.replace('top', 'top ')} listed companies by market capitalisation`)),
    obligations: [
      { code: 'brsr', title: 'BRSR with the annual report', detail: 'Sections A–C, including the BRSR Core.', due: (y) => iso(y, 8, 31), from: 2024, dueNote: 'With the annual report, sent before the AGM (within 5 months of year end)', penalty: 'SEBI LODR penalties', module: { route: '/brsr', label: 'BRSR Core' } },
      { code: 'core_assurance', title: 'BRSR Core reasonable assurance or assessment', detail: 'Glide path: top 150 FY 2023-24, top 250 FY 2024-25, top 500 FY 2025-26, top 1,000 FY 2026-27.', due: (y) => iso(y, 8, 31), firstFor: (p) => ({ top150: 2024, top250: 2025, top500: 2026, top1000: 2027 } as Record<string, number>)[p.indiaTop] ?? null, module: { route: '/brsr', label: 'BRSR Core' } },
      { code: 'value_chain', title: 'Value-chain BRSR Core (voluntary)', detail: 'Top 250: partners of 2% or more of purchases or sales, up to 75% coverage.', due: (y) => iso(y, 8, 31), firstFor: (p) => (p.indiaTop === 'top150' || p.indiaTop === 'top250' ? 2026 : null), voluntary: true, module: { route: '/brsr', label: 'BRSR Core' } },
    ],
  },
  {
    code: 'in_ccts', name: 'India Carbon Credit Trading Scheme — compliance mechanism', jurisdiction: 'India', authority: 'Bureau of Energy Efficiency; MoEFCC', periodOf: 'india_fy',
    source: 'https://beeindia.gov.in/', summary: 'Obligated entities in the notified sectors (aluminium, cement, chlor-alkali, pulp & paper, refineries, petrochemicals, textiles; iron & steel in draft) meet GHG emission intensity targets; Carbon Credit Certificates earned or surrendered.',
    applies: (p) => (p.cctsObligated ? yes('Has obligated entities under the GHG Emission Intensity Target Rules') : p.cctsObligated === false ? no('No obligated entity') : (has(p, 'IN') ? maybe('Operates in India: plants in the notified sectors may be obligated') : no('No operations in India'))),
    obligations: [
      { code: 'monitoring', title: 'Monitoring plan for the compliance year', detail: 'Within 3 months of the start of the compliance year.', due: (y) => iso(y - 1, 6, 30), from: 2026, module: { route: '/ccts', label: 'India CCTS' } },
      { code: 'form_a', title: 'Form A, verified emissions report and Form B to BEE', detail: 'Performance assessment with the ACVA\'s certificate of verification.', due: (y) => iso(y, 7, 31), from: 2026, penalty: 'Environmental compensation at twice the average CCC price for a shortfall not surrendered', module: { route: '/ccts', label: 'India CCTS' } },
      { code: 'surrender', title: 'Surrender CCCs for any shortfall (Form D)', detail: 'After the trading sessions that follow issuance.', due: () => null, from: 2026, dueNote: 'Date set by BEE after issuance', module: { route: '/ccts', label: 'India CCTS' } },
    ],
  },
  {
    code: 'ae_federal', name: 'UAE Federal Decree-Law No. 11 of 2024 and Cabinet Resolution No. 67 of 2024', jurisdiction: 'UAE', authority: 'Ministry of Climate Change and Environment', periodOf: 'calendar',
    source: 'https://uaelegislation.gov.ae/', summary: 'Designated sources measure, report (national MRV system, IEQT) and keep records of Scope 1 and 2 for 5 years; 0.5 MtCO2e or more of Scope 1 + 2: registration with the National Register for Carbon Credits and annual verification. Adjustment period extended by one year from 31 May 2026 (Cabinet Resolution No. 147 of 2026).',
    applies: (p) => {
      if (!has(p, 'AE')) return no('No operations in the UAE');
      if (p.uaeScope12 != null && p.uaeScope12 >= 500_000) return yes('Scope 1 + 2 in the UAE at or above 0.5 MtCO2e');
      if (p.uaeDesignated === 'yes') return yes('Designated as a source by the Ministry or the emirate authority');
      if (p.uaeDesignated === 'no') return no('Not designated and below 0.5 MtCO2e');
      return maybe('Operates in the UAE: sources are designated by the Ministry or the emirate authority');
    },
    obligations: [
      { code: 'ieqt', title: 'Annual Scope 1 and 2 report on the national MRV system (IEQT)', detail: 'GHG Protocol; organisation approved by the emirate focal point first.', due: (y) => (y <= 2026 ? '2027-05-31' : null), from: 2025, dueNote: 'Adjustment period to 31 May 2027; the annual deadline is still to be set by the Ministry', penalty: 'AED 50,000 to 2,000,000, doubled for a repeat within two years', module: { route: '/uae-mrv?tab=federal', label: 'UAE MRV' } },
      { code: 'nrcc', title: 'NRCC registration and annual verification (0.5 MtCO2e and above)', detail: 'Verifier authorised by the Ministry (ISO 14065).', due: (y) => (y <= 2026 ? '2027-05-31' : null), firstFor: (p) => (p.uaeScope12 != null && p.uaeScope12 >= 500_000 ? 2025 : null), dueNote: 'Annual date to be set by the Ministry', penalty: 'Up to AED 500,000 / 1,000,000 / 2,000,000', module: { route: '/uae-mrv?tab=federal', label: 'UAE MRV' } },
      { code: 'records', title: 'Keep emissions records for 5 years', detail: 'Measured data and evidence, available to the authority on request.', due: () => null, from: 2025, dueNote: 'Continuous', module: { route: '/vault', label: 'Document vault' } },
    ],
  },
  {
    code: 'ae_ead', name: 'Abu Dhabi facility MRV (EAD Resolution No. 3 of 2026)', jurisdiction: 'UAE — Abu Dhabi', authority: 'Environment Agency – Abu Dhabi', periodOf: 'calendar',
    source: 'https://facilitymrv.ead.ae/', summary: 'Facilities in power and water, oil and gas, industry and road or rail transport with 25,000 tCO2e or more of CO2 and methane: annual Scope 1 report by 31 March, verified by an ISO 14065-accredited verifier from reporting year 2026.',
    applies: (p) => (p.eadFacility ? yes('Has an Abu Dhabi facility at or above 25,000 tCO2e in a covered sector') : p.eadFacility === false ? no('No Abu Dhabi facility above the threshold') : (has(p, 'AE') ? maybe('Facilities in Abu Dhabi in covered sectors may be above 25,000 t') : no('No operations in the UAE'))),
    obligations: [
      { code: 'registration', title: 'Registration with EAD and monitoring plan', detail: 'Facilities without an environmental permit register by 31 March; the monitoring plan (Excel template) with the verifier\'s review by 31 March each year.', due: (y) => iso(y, 3, 31), from: 2026, module: { route: '/uae-mrv?tab=facility', label: 'UAE MRV' } },
      { code: 'notify', title: 'Planned verification notified to EAD', detail: 'Verification starts by mid-year with a site visit.', due: (y) => iso(y, 7, 1), from: 2026, module: { route: '/uae-mrv?tab=facility&s=verification', label: 'UAE MRV' } },
      { code: 'report', title: 'Annual facility Scope 1 report', detail: 'EAD template sheets C1–J; with the verification statement from reporting year 2026.', due: (y) => iso(y + 1, 3, 31), from: 2025, penalty: 'Under the Decree-Law; corrective notices', module: { route: '/uae-mrv?tab=facility', label: 'UAE MRV' } },
    ],
  },
  {
    code: 'sg_climate', name: 'Singapore climate reporting (SGX Listing Rules, ISSB-based)', jurisdiction: 'Singapore', authority: 'SGX RegCo; ACRA',
    source: 'https://www.sgx.com/regulation/sustainability-reporting', summary: 'All listed issuers report Scope 1 and 2 from FY2025; STI constituents full ISSB climate disclosures from FY2025 and Scope 3 from FY2026; other issuers with market cap of S$1 billion or more full disclosures from FY2028, others FY2030; external limited assurance of Scope 1 and 2 from FY2029 (timelines extended August 2025).',
    applies: (p) => (p.listed === 'sgx' ? yes(p.sgxSti ? 'SGX-listed STI constituent' : 'SGX-listed issuer') : (has(p, 'SG') ? maybe('Large non-listed companies (revenue S$1 billion+, assets S$0.5 billion+) from FY2030') : no('Not listed on SGX'))),
    obligations: [
      { code: 'scope12', title: 'Scope 1 and 2 GHG emissions in the sustainability report', detail: 'With the annual report.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 4), startsOn: (p) => (p.listed === 'sgx' ? '2025-01-01' : '2030-01-01'), dueNote: 'With the annual report (within 4 months of year end; check SGX Listing Rule 711A)', module: { route: '/reports', label: 'Reports (IFRS S2)' } },
      { code: 'issb', title: 'ISSB (IFRS S2) climate disclosures', detail: 'Governance, strategy, risk management, metrics and targets.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 4), startsOn: (p) => (p.listed !== 'sgx' ? '2030-01-01' : p.sgxSti ? '2025-01-01' : p.sgxCapOver1bn ? '2028-01-01' : '2030-01-01'), module: { route: '/reports', label: 'Reports (IFRS S2)' } },
      { code: 'scope3', title: 'Scope 3 GHG emissions', detail: 'Mandatory for STI constituents; voluntary for other issuers until further notice.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 4), startsOn: (p) => (p.listed === 'sgx' && p.sgxSti ? '2026-01-01' : null) },
      { code: 'assurance', title: 'External limited assurance of Scope 1 and 2', detail: 'Deferred from FY2027.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, 4), startsOn: (p) => (p.listed === 'sgx' ? '2029-01-01' : null), module: { route: '/assurance', label: 'Audit & assurance' } },
    ],
  },
  {
    code: 'au_asrs', name: 'Australia mandatory climate reporting (AASB S2)', jurisdiction: 'Australia', authority: 'ASIC; AASB',
    source: 'https://aasb.gov.au/research-resources/knowledge-hub/aasb-s2-knowledge-hub/', summary: 'Sustainability report with the annual financial report under the Corporations Act. Group 1 from years starting 1 January 2025, Group 2 from 1 July 2026, Group 3 from 1 July 2027 (size thresholds, NGER reporters, asset owners).',
    applies: (p) => (p.auGroup !== 'none' ? yes(`Australian reporting entity in ${p.auGroup.replace('group', 'Group ')}`) : (has(p, 'AU') ? maybe('Operates in Australia: Groups 1–3 by employees, revenue, assets or NGER reporting') : no('No operations in Australia'))),
    obligations: [
      { code: 'report', title: 'Sustainability report (climate statements, AASB S2)', detail: 'Scope 1 and 2 from the first year; Scope 3 from the second year.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, p.listed === 'asx' ? 3 : 4), startsOn: (p) => ({ group1: '2025-01-01', group2: '2026-07-01', group3: '2027-07-01' } as Record<string, string>)[p.auGroup] ?? null, dueNote: 'With the annual financial report (3 months for disclosing entities, 4 months for others)', module: { route: '/reports', label: 'Reports (IFRS S2)' } },
      { code: 'assurance', title: 'Assurance of the climate statements', detail: 'Limited assurance phasing to reasonable assurance (AUASB ASSA 5010).', due: (y, p) => afterFyEnd(y, p.fyEndMonth, p.listed === 'asx' ? 3 : 4), startsOn: (p) => ({ group1: '2025-01-01', group2: '2026-07-01', group3: '2027-07-01' } as Record<string, string>)[p.auGroup] ?? null, module: { route: '/assurance', label: 'Audit & assurance' } },
    ],
  },
  {
    code: 'us_ca_sb253', name: 'California SB 253 (Climate Corporate Data Accountability Act)', jurisdiction: 'United States — California', authority: 'California Air Resources Board', periodOf: 'fy',
    source: 'https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-ghg-reporting-and-climate-related-financial', summary: 'US-based entities with more than US$1 billion revenue doing business in California report Scope 1 and 2 (first reports due 10 November 2026), Scope 3 from 2027. SB 261 (climate-risk reports) is enjoined pending appeal and not enforced.',
    applies: (p) => (p.usRevenueUsd != null && p.usRevenueUsd > 1e9 && p.californiaBusiness ? yes('More than US$1 billion revenue and doing business in California') : p.californiaBusiness ? maybe('Doing business in California: applies above US$1 billion revenue') : no('No business in California recorded')),
    obligations: [
      { code: 'scope12', title: 'Scope 1 and 2 report to CARB', detail: 'With limited assurance; through the CARB reporting platform.', due: (y) => (y === 2025 ? '2026-11-10' : null), from: 2025, dueNote: 'Later dates set by CARB', penalty: 'Up to US$500,000 per reporting year', module: { route: '/reports', label: 'Reports (SB 253)' } },
      { code: 'scope3', title: 'Scope 3 report to CARB', detail: 'Scheduled to begin in 2027.', due: () => null, from: 2026, dueNote: 'Date to be set by CARB' },
    ],
  },
  {
    code: 'uk_secr', name: 'UK Streamlined Energy and Carbon Reporting (SECR)', jurisdiction: 'United Kingdom', authority: 'Companies House; DESNZ guidance',
    source: 'https://www.gov.uk/government/publications/environmental-reporting-guidelines-including-mandatory-greenhouse-gas-emissions-reporting-guidance', summary: 'Quoted companies, and large unquoted companies and LLPs, report UK energy use, Scope 1 and 2, an intensity ratio and efficiency actions in the directors\' report.',
    applies: (p) => (p.ukQuoted ? yes('UK quoted company') : p.ukLarge ? yes('Large UK unquoted company or LLP') : (has(p, 'GB') ? maybe('UK operations: applies to quoted and large unquoted companies (2 of: turnover, balance sheet, 250+ employees)') : no('No UK operations'))),
    obligations: [
      { code: 'report', title: 'Energy and carbon report in the directors\' report', detail: 'Filed with the annual accounts.', due: (y, p) => afterFyEnd(y, p.fyEndMonth, p.ukQuoted ? 6 : 9), from: 2019, dueNote: 'With the accounts: 6 months for public, 9 months for private companies', module: { route: '/reports', label: 'Reports (SECR)' } },
    ],
  },
  {
    code: 'in_epr', name: 'India Extended Producer Responsibility (plastic packaging, e-waste, batteries, tyres)', jurisdiction: 'India', authority: 'Central Pollution Control Board', periodOf: 'india_fy',
    source: 'https://eprplastic.cpcb.gov.in/', summary: 'Producers, importers and brand owners register on the CPCB portals, meet their EPR targets with certificates from registered recyclers and file annual returns; plastic packaging also carries recycled-content (from FY 2025-26) and reuse targets (G.S.R. 237(E), 31 March 2026). Shortfalls attract environmental compensation.',
    applies: (p) => (p.eprIndia ? yes('Places products under EPR on the Indian market, or recycles them') : p.eprIndia === false ? no('No products under EPR in India') : (has(p, 'IN') ? maybe('Operates in India: plastic packaging, electronics, batteries or tyres placed on the market are under EPR') : no('No operations in India'))),
    obligations: [
      { code: 'return', title: 'EPR annual returns on the CPCB portals', detail: 'Quantities placed on the market, certificates applied and recycled content, for each registration.', due: (y) => iso(y, 6, 30), from: 2023, dueNote: 'By 30 June (often extended by CPCB notice)', penalty: 'Environmental compensation for unmet targets', module: { route: '/epr', label: 'EPR' } },
      { code: 'targets', title: 'EPR targets met with certificates', detail: 'Certificates bought and applied for the year\'s obligation; any shortfall carried with compensation.', due: (y) => iso(y, 6, 30), from: 2023, module: { route: '/epr', label: 'EPR' } },
    ],
  },
  {
    code: 'eu_ppwr', name: 'EU Packaging and Packaging Waste Regulation (EU) 2025/40', jurisdiction: 'EU', authority: 'European Commission; national producer registers', periodOf: 'calendar',
    source: 'https://eur-lex.europa.eu/eli/reg/2025/40/oj', summary: 'Applies from 12 August 2026: registration in each member state where packaging is first made available, EPR through a producer responsibility organisation, harmonised labelling from 12 August 2028, recyclability grade C or better and recycled content in plastic packaging from 2030.',
    applies: (p) => (p.ppwrProducer ? yes('First makes packaging available in an EU member state') : p.ppwrProducer === false ? no('Does not place packaging on the EU market') : (has(p, 'EU') ? maybe('Operates in the EU: placing packaged goods on the market makes the company a producer') : no('No EU market recorded'))),
    obligations: [
      { code: 'register', title: 'Registration in each member state\'s producer register', detail: 'Before making packaging available; through an authorised representative where the company is not established there.', due: () => '2026-08-12', from: 2026, once: true, module: { route: '/epr', label: 'EPR' } },
      { code: 'report', title: 'Packaging placed on the market reported to the register and the PRO', detail: 'Tonnes by material, with the fees owed.', due: (y) => iso(y + 1, 5, 15), from: 2026, dueNote: 'National schedule (e.g. Germany: declaration of completeness by 15 May)', module: { route: '/epr', label: 'EPR' } },
      { code: 'labelling', title: 'Harmonised packaging labels', detail: 'Material composition labels and pictograms; packaging made before the date may be sold for three more years.', due: () => '2028-08-12', from: 2028, once: true },
      { code: 'recycled_content', title: 'Minimum recycled content in plastic packaging', detail: 'Contact-sensitive PET 30%, other contact-sensitive 10%, single-use beverage bottles 30%, other plastic 35% (2040: 50 / 25 / 65 / 65%).', due: () => '2030-01-01', from: 2030, once: true, module: { route: '/epr', label: 'EPR' } },
    ],
  },
];
export const REGULATION = new Map(REGULATIONS.map((r) => [r.code, r]));

/** The calendar year the reporting period ends in, for a period that runs as the regulation says. */
export interface Instance { reg: string; obligation: string; period: number; label: string; due: string | null; dueNote: string | null }
/** Every obligation instance of the applicable (or possibly applicable) regulations whose period ends in [from, to]. */
export function instances(p: Profile, regs: { code: string; applies: Applies }[], from: number, to: number): Instance[] {
  const out: Instance[] = [];
  for (const r of regs) {
    if (r.applies === 'not_applicable') continue;
    const R = REGULATION.get(r.code)!;
    for (const o of R.obligations) {
      const start = o.startsOn?.(p);
      const first = o.startsOn ? (start ? firstFyStarting(start, R.periodOf === 'calendar' ? 12 : R.periodOf === 'india_fy' ? 3 : p.fyEndMonth) : null) : o.firstFor ? o.firstFor(p) : o.from ?? 2000;
      if (first == null) continue;
      for (let y = Math.max(from, first); y <= to; y++) {
        if (o.once && y !== first) continue;
        const label = R.periodOf === 'calendar' ? String(y) : R.periodOf === 'india_fy' ? `FY ${y - 1}-${String(y % 100).padStart(2, '0')}` : periodLabel(y, p.fyEndMonth);
        out.push({ reg: r.code, obligation: o.code, period: y, label: o.once ? 'once' : label, due: o.due(y, p), dueNote: o.dueNote ?? null });
      }
    }
  }
  return out;
}

/** An obligation's status on a day: overdue when the due date has passed and it is not done or not applicable. */
export function effective(status: Status | null, due: string | null, today: string): Status {
  const s = status ?? 'not_started';
  if (s === 'done' || s === 'not_applicable') return s;
  return due && due < today ? 'overdue' : s;
}
