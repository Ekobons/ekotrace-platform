/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * First versions of the rule texts and tables behind "What applies", CSR, EPR, Schemes and "What changed".
 * defaults.ts stores them as the first version of the 'requirements', 'schemes' and 'news' settings; after that,
 * platform admins change them in the console. Checked against the rules in force on 30 October 2026.
 *
 * Requirement texts: {placeholders} are filled from company data by rules.ts. Every variant has
 *   status (apply · likely · watch · good), label (the pill), title, detail (the rule in plain words),
 *   why (which answer brought it in), action (the next step) and go (the page that helps).
 */

export const thresholds = {
  establishment: 10, // OSH Code: an establishment with 10 or more workers registers
  factory_power: 20, // OSH Code s.2(1)(w): factory with power
  factory_no_power: 40, // … without power
  epf: 20, // Code on Social Security: EPF
  esic: 10, // … ESI (employees earning up to ₹21,000 a month)
  posh: 10, // POSH Act: Internal Committee
};

const LABOUR_DETAIL = 'The four Labour Codes (Wages; Industrial Relations; Social Security; Occupational Safety, Health and Working Conditions) replaced 29 labour laws from 21 November 2025, and the central rules followed on 8 May 2026. Every worker, including contract and fixed-term workers, needs an appointment letter. Pay monthly wages by the 7th of the next month with a wage slip, pay overtime at twice the normal rate, and keep the employee, wage and attendance registers (they can be electronic).';
const SS_DETAIL = 'EPF applies from 20 employees; ESI from 10 employees and covers those earning up to ₹21,000 a month. Deposit both every month by the 15th. Gratuity is due on leaving after 5 years of service, or after 1 year for fixed-term staff.';
const PCB_DETAIL = 'Your state pollution board puts every industry in a red, orange, green or white category. Red, orange and green units need Consent to Establish before building or expanding, and Consent to Operate before starting and while running. How long a consent lasts depends on the state, often 5 years for red, 10 for orange and 15 for green. File the Environmental Statement (Form V) by 30 September every year.';
const HW_DETAIL = 'Under the Hazardous and Other Wastes Rules, 2016, a unit that generates hazardous waste (used or waste oil, spent solvents, paint or ETP sludge, plating waste, empty chemical drums) needs an authorisation from the state pollution board. Store it safely for no more than 90 days, hand it only to an authorised recycler or a TSDF with a manifest, keep a record, and file the annual return in Form 4 by 30 June.';
const QCO_DETAIL = 'A Quality Control Order makes BIS certification compulsory for a product: it can be made, sold, stored or imported only with a BIS licence and the ISI mark (or BIS registration). Orders apply to MSMEs too, sometimes with a few extra months. Several chemical and polymer orders were withdrawn in November 2025, so check the current list.';
const PLASTIC_DETAIL = 'Producers, importers and brand owners of plastic packaging register on the CPCB centralised EPR portal. Each year the EPR target equals the plastic packaging you placed on the market, category by category, with a minimum share met through recycling. Meet it by buying EPR certificates from registered plastic waste processors, then file the annual return (normally by 30 June).';
const EWASTE_DETAIL = 'Producers and importers of the electrical and electronic goods listed in the E-Waste (Management) Rules, 2022 register on the CPCB portal and buy EPR certificates from registered recyclers: 70% of their estimated e-waste for 2025-26 and 2026-27, 80% from 2027-28. File quarterly and annual returns.';
const BATTERY_DETAIL = 'Producers and importers of batteries, or of goods containing batteries, register on the CPCB battery EPR portal. Each year they cover a collection target for each battery type (a share of what they sold in an earlier year) by buying EPR certificates from registered recyclers or refurbishers, and file the annual return (normally by 30 June).';
const POSH_DETAIL = 'With 10 or more employees you must set up an Internal Committee (presided by a senior woman, with one outside member), display its details and the penalties at the workplace, and file a yearly report with the District Officer.';
const DPDP_DETAIL = 'Applies to every business holding personal data, including employee and customer records. The DPDP Rules were notified in November 2025; most duties apply from 13 May 2027.';

export const items: any = {
  udyam: {
    registered: { status: 'good', label: 'Registered', title: 'Udyam registration (MSME)', detail: 'Free registration that proves you are an MSME. It opens MSME schemes and priority-sector loans, and the payment rule: a buyer must pay a micro or small supplier within 45 days (15 days without a written agreement), or lose the tax deduction for that cost (Income-tax s.43B(h)).', why: 'Marked as Udyam registered in Profile. Class from turnover: {msme_class}.', action: 'Check the class on your Udyam certificate matches your latest turnover.', go: 'schemes' },
    missing: { status: 'likely', label: 'Register', title: 'Udyam registration (MSME)', detail: 'Free registration that proves you are an MSME. Most MSME schemes, priority-sector loans and the 45-day payment protection (Income-tax s.43B(h)) need it.', why: 'Udyam registration is not marked in Profile.', action: 'Register free on udyamregistration.gov.in with Aadhaar and PAN, then mark it in Profile.', go: 'profile' },
  },
  labour_codes: {
    establishment: { status: 'apply', label: 'Applies', title: 'Labour Codes', detail: `${LABOUR_DETAIL} With 10 or more workers you must also register the establishment, and workers aged 40 or more get a free health check-up every year.`, why: 'You have {employees} workers (10 or more).', action: 'Give every worker an appointment letter, check wage slips, and register the establishment on your state labour portal.', go: 'people' },
    small: { status: 'likely', label: 'Check', title: 'Labour Codes', detail: `${LABOUR_DETAIL} Below 10 workers you do not need to register the establishment.`, why: 'You have {employees} workers (fewer than 10).', action: 'Give every worker an appointment letter and a wage slip.', go: 'people' },
    unknown: { status: 'likely', label: 'Add employees', title: 'Labour Codes', detail: LABOUR_DETAIL, why: 'The number of employees is not in Profile yet.', action: 'Enter your number of employees in Profile.', go: 'profile' },
  },
  social_security: {
    both: { status: 'apply', label: 'Applies', title: 'PF, ESI and gratuity (Code on Social Security)', detail: SS_DETAIL, why: '{employees} employees: EPF from 20, ESI from 10.', action: 'Check every worker, including contract workers, has a UAN and an ESI number, and file by the 15th.', go: 'calendar' },
    esic: { status: 'apply', label: 'ESI applies', title: 'PF, ESI and gratuity (Code on Social Security)', detail: SS_DETAIL, why: '{employees} employees: ESI from 10; EPF starts at 20.', action: 'Register with ESIC and file monthly by the 15th. Plan for EPF when you reach 20.', go: 'calendar' },
    none: { status: 'watch', label: 'Not yet', title: 'PF, ESI and gratuity (Code on Social Security)', detail: SS_DETAIL, why: '{employees} employees: ESI starts at 10, EPF at 20.', action: 'You can join EPF voluntarily before you reach 20.', go: null },
  },
  factory_licence: {
    factory: { status: 'apply', label: 'Applies', title: 'Factory licence (OSH Code)', detail: 'Under the OSH Code a factory is a unit with 20 or more workers using power, or 40 or more without power (the old Factories Act limits were 10 and 20). A factory needs a licence from the state factories department, a safety committee where required, and yearly health check-ups. Some states kept their own limits, so check your state rules.', why: '{employees} workers in manufacturing, {power_text}.', action: 'Keep the licence valid and enter its expiry date in Calendar.', go: 'calendar' },
    establishment: { status: 'watch', label: 'Not a factory', title: 'Factory licence (OSH Code)', detail: 'Under the OSH Code a factory is a unit with 20 or more workers using power, or 40 or more without power. Below that you need no factory licence, but with 10 or more workers you still register as an establishment. Some states kept their old limits, so check your state rules.', why: '{employees} workers in manufacturing, {power_text}.', action: 'Check your state has not kept the old Factories Act limits.', go: null },
  },
  pcb_consent: {
    needed: { status: 'apply', label: 'Applies', title: 'Consent to Establish and Operate (pollution board)', detail: PCB_DETAIL, why: 'Pollution category: {pcb}.', action: 'Keep the Consent to Operate valid: enter its expiry date in Calendar and apply for renewal well before it ends.', go: 'calendar' },
    valid: { status: 'good', label: 'Valid', title: 'Consent to Establish and Operate (pollution board)', detail: PCB_DETAIL, why: 'Pollution category: {pcb}. Consent to Operate valid till {cto}.', action: 'Apply for renewal well before {cto}. File Form V by 30 September.', go: 'calendar' },
    white: { status: 'good', label: 'Exempt', title: 'Consent to Establish and Operate (pollution board)', detail: 'Since November 2024 white-category units (the least polluting) need neither Consent to Establish nor Consent to Operate. Some state boards still ask for a one-time intimation.', why: 'Pollution category: white.', action: 'Check whether your state board asks for an intimation, and keep a copy.', go: null },
    unknown: { status: 'likely', label: 'Find category', title: 'Consent to Establish and Operate (pollution board)', detail: PCB_DETAIL, why: 'Your pollution category is not answered yet.', action: 'Find your industry on your state board’s category list and answer under Your answers.', go: null },
  },
  hazardous_waste: {
    applies: { status: 'apply', label: 'Applies', title: 'Hazardous waste authorisation and annual return', detail: HW_DETAIL, why: 'You said you generate hazardous waste.', action: 'Keep the authorisation valid, record each lot sent out, and file Form 4 by 30 June.', go: 'scrap' },
    check: { status: 'watch', label: 'Check', title: 'Hazardous waste authorisation and annual return', detail: HW_DETAIL, why: 'You make goods; most factories have some used oil or sludge.', action: 'If you generate any hazardous waste, answer Yes under Your answers.', go: null },
  },
  bis_qco: {
    applies: { status: 'apply', label: 'Applies', title: 'BIS Quality Control Order (ISI mark)', detail: QCO_DETAIL, why: 'You said your product is covered by a Quality Control Order.', action: 'Keep the BIS licence valid and check each new product against the BIS list.', go: 'certs' },
    unsure: { status: 'likely', label: 'Check', title: 'BIS Quality Control Order (ISI mark)', detail: QCO_DETAIL, why: 'You make goods and have not answered whether a Quality Control Order covers them.', action: 'Look up your product and main imported inputs on the BIS website, then answer under Your answers.', go: null },
  },
  brsr_value_chain: {
    likely: { status: 'likely', label: 'Likely', title: 'BRSR value-chain data requests', detail: 'Listed customers report ESG data for suppliers that make up 2% or more of their purchases. Expect a BRSR-style questionnaire.', why: 'You supply a listed company.', action: 'Fill Emissions and ESG, then share the summary.', go: 'share' },
    watch: { status: 'watch', label: 'Watch', title: 'BRSR value-chain data requests', detail: 'Applies when you supply a listed company.', why: 'You have not marked that you supply a listed company.', action: 'Keep ESG data ready.', go: 'esg' },
  },
  srmm: {
    open: { status: 'likely', label: 'In progress', title: 'SRMM maturity level (ICAI)', detail: 'ICAI’s Sustainability Reporting Maturity Model scores your reporting out of 300 (v3.1 manufacturing or v3.2 service) and awards Levels 1–4 after CA validation.', why: 'Voluntary; buyers and banks increasingly ask for it.', action: '{srmm_pct}% scored, {srmm_open} indicators open.', go: 'srmm' },
    done: { status: 'good', label: 'Scored', title: 'SRMM maturity level (ICAI)', detail: 'ICAI’s Sustainability Reporting Maturity Model scores your reporting out of 300 and awards Levels 1–4 after CA validation.', why: 'Voluntary; buyers and banks increasingly ask for it.', action: '{srmm_pct}% scored.', go: 'srmm' },
  },
  eu_cbam: {
    applies: { status: 'apply', label: 'Applies', title: 'EU CBAM', detail: 'Since 1 January 2026 your EU importer pays for the emissions embedded in CBAM goods (importers of under 50 tonnes a year are exempt). Without your data, higher EU default values are used.', why: 'You export {cbam_good} to the EU.', action: 'Calculate emissions per tonne and send them to your importer.', go: 'cbam' },
    watch: { status: 'watch', label: 'Watch', title: 'EU CBAM', detail: 'Your product is not a CBAM good today. Coverage of downstream products is planned to widen.', why: 'You export to the EU.', action: 'Track emissions now.', go: 'emissions' },
  },
  uk_cbam: { applies: { status: 'likely', label: 'From Jan 2027', title: 'UK CBAM', detail: 'The UK applies its own CBAM to aluminium, cement, fertiliser, hydrogen and iron & steel from 1 January 2027 (glass and ceramics were dropped).', why: 'You export {cbam_good} to the UK.', action: 'Use the same embedded-emissions data for your UK importer.', go: 'cbam' } },
  eudr: { applies: { status: 'apply', label: 'Applies', title: 'EU Deforestation Regulation (EUDR)', detail: 'EU buyers must prove your {eudr} is deforestation-free with plot geolocation. Large operators from 30 Dec 2026, micro and small from 30 Jun 2027.', why: 'You export {eudr} to the EU.', action: 'Record plot coordinates and documents.', go: 'eudr' } },
  brsr_filing: {
    applies: { status: 'apply', label: 'Applies', title: 'BRSR filing (SEBI)', detail: 'Listed companies in the SEBI top-1000 file BRSR with the annual report.', why: 'You are a listed company.', action: 'Use the full EKOTRACE BRSR Core package.' },
    not_required: { status: 'good', label: 'Not required', title: 'BRSR filing (SEBI)', detail: 'Own filing applies to listed companies only.', why: 'You are not a listed company.', action: '' },
  },
  ccts: {
    check: { status: 'likely', label: 'Check', title: 'India CCTS obligations', detail: 'Units notified as obligated entities under the Carbon Credit Trading Scheme have emission-intensity targets.', why: 'You marked a CCTS-covered sector.', action: 'Check whether your unit is notified.', go: 'emissions' },
    opportunity: { status: 'watch', label: 'Opportunity', title: 'India CCTS offset credits', detail: 'Solar and efficiency projects can earn credits when pooled across SMEs.', why: 'Open to every business.', action: 'See your credit potential.', go: 'credits' },
  },
  plastic_epr: {
    not_registered: { status: 'apply', label: 'Not registered', title: 'Plastic packaging EPR', detail: PLASTIC_DETAIL, why: 'You use plastic packaging for the goods you sell.', action: 'Register on the CPCB EPR portal before you file the annual return.', go: 'epr' },
    gap: { status: 'likely', label: 'Gap open', title: 'Plastic packaging EPR', detail: PLASTIC_DETAIL, why: 'You use plastic packaging for the goods you sell.', action: 'Buy {epr_gap} t more EPR certificates before the annual return.', go: 'epr' },
    covered: { status: 'good', label: 'Covered', title: 'Plastic packaging EPR', detail: PLASTIC_DETAIL, why: 'You use plastic packaging for the goods you sell.', action: 'Certificates cover this year’s target. File the annual return.', go: 'epr' },
    check: { status: 'likely', label: 'Check', title: 'Plastic packaging EPR', detail: PLASTIC_DETAIL, why: 'You use plastic packaging for the goods you sell.', action: 'Enter your plastic quantities on the EPR page.', go: 'epr' },
  },
  ewaste_epr: {
    not_registered: { status: 'apply', label: 'Not registered', title: 'E-waste EPR', detail: EWASTE_DETAIL, why: 'You make or import electrical or electronic goods.', action: 'Register on the CPCB e-waste EPR portal.', go: 'epr' },
    gap: { status: 'likely', label: 'Gap open', title: 'E-waste EPR', detail: EWASTE_DETAIL, why: 'You make or import electrical or electronic goods.', action: 'Buy {ew_gap} kg more EPR certificates before the annual return.', go: 'epr' },
    covered: { status: 'good', label: 'Covered', title: 'E-waste EPR', detail: EWASTE_DETAIL, why: 'You make or import electrical or electronic goods.', action: 'Certificates cover this year’s target. File the returns.', go: 'epr' },
    check: { status: 'likely', label: 'Check', title: 'E-waste EPR', detail: EWASTE_DETAIL, why: 'You make or import electrical or electronic goods.', action: 'Enter your e-waste figures on the EPR page.', go: 'epr' },
  },
  battery_epr: {
    not_registered: { status: 'apply', label: 'Not registered', title: 'Battery EPR', detail: BATTERY_DETAIL, why: 'You make or import batteries, or goods with batteries.', action: 'Register on the CPCB battery EPR portal.', go: 'epr' },
    gap: { status: 'likely', label: 'Gap open', title: 'Battery EPR', detail: BATTERY_DETAIL, why: 'You make or import batteries, or goods with batteries.', action: 'Buy {bt_gap} kg more EPR certificates before the annual return.', go: 'epr' },
    covered: { status: 'good', label: 'Covered', title: 'Battery EPR', detail: BATTERY_DETAIL, why: 'You make or import batteries, or goods with batteries.', action: 'Certificates cover this year’s target. File the annual return.', go: 'epr' },
    check: { status: 'likely', label: 'Check', title: 'Battery EPR', detail: BATTERY_DETAIL, why: 'You make or import batteries, or goods with batteries.', action: 'Enter your battery figures on the EPR page.', go: 'epr' },
  },
  dpdp: {
    on_track: { status: 'good', label: 'On track', title: 'DPDP Act (data privacy)', detail: DPDP_DETAIL, why: 'Every business holds personal data.', action: '{dpdp_pct}% of the checklist done.', go: 'dpdp' },
    prepare: { status: 'likely', label: 'Prepare', title: 'DPDP Act (data privacy)', detail: DPDP_DETAIL, why: 'Every business holds personal data.', action: '{dpdp_pct}% of the checklist done.', go: 'dpdp' },
  },
  csr: {
    applies: { status: 'apply', label: 'Applies', title: 'CSR (Companies Act s.135)', detail: 'A company with net worth of ₹500 crore, turnover of ₹1,000 crore or net profit of ₹5 crore in the previous year spends 2% of its average net profit of the last three years on CSR activities listed in Schedule VII.', why: 'Net profit of ₹{csr_profit} crore last year (₹5 crore or more).', action: 'Obligation ₹{csr_lakh} lakh this year; ₹{csr_left_lakh} lakh still to spend.', go: 'csr' },
    done: { status: 'good', label: 'Spent', title: 'CSR (Companies Act s.135)', detail: 'A company with net worth of ₹500 crore, turnover of ₹1,000 crore or net profit of ₹5 crore in the previous year spends 2% of its average net profit of the last three years on CSR activities listed in Schedule VII.', why: 'Net profit of ₹{csr_profit} crore last year (₹5 crore or more).', action: 'This year’s ₹{csr_lakh} lakh is spent. Report it in the board’s report.', go: 'csr' },
  },
  posh: {
    on_track: { status: 'good', label: 'On track', title: 'POSH Act (Internal Committee)', detail: POSH_DETAIL, why: 'You have {employees} employees (10 or more).', action: 'Keep the committee current and file the yearly report.', go: 'people' },
    check: { status: 'likely', label: 'Check', title: 'POSH Act (Internal Committee)', detail: POSH_DETAIL, why: 'You have {employees} employees (10 or more).', action: 'Set up or review the Internal Committee and file the yearly report.', go: 'people' },
    small: { status: 'watch', label: 'Local Committee', title: 'POSH Act (Internal Committee)', detail: 'Below 10 employees no Internal Committee is needed: complaints go to the Local Committee of the district. You must still prevent harassment and display the penalties at the workplace.', why: 'You have {employees} employees (fewer than 10).', action: 'Display the penalties and the Local Committee contact.', go: 'people' },
  },
  bank: { useful: { status: 'watch', label: 'Useful', title: 'Bank ESG checks & green loans', detail: 'Banks are adding ESG checks to loan reviews and pricing.', why: 'Useful for every business that borrows.', action: 'Build a green-loan pack.', go: 'loan' } },
  // first version, still read when an older settings version has no ewaste_epr / battery_epr
  other_epr: { check: { status: 'likely', label: 'Check', title: 'E-waste / battery EPR', detail: 'Producers of electrical goods or batteries need EPR registration and annual returns.', why: 'You make electrical goods or batteries.', action: 'Track registration.', go: 'epr' } },
};

/** CSR: Schedule VII of the Companies Act (item xiii added 27 May 2026) and the timelines of rule 10 / s.135(5)-(6). */
export const csrAreas: [string, string][] = [
  ['i', 'Hunger, poverty, healthcare, sanitation and safe drinking water'],
  ['ii', 'Education, vocational skills and livelihoods'],
  ['iii', 'Gender equality, women’s empowerment, homes for orphans and the elderly'],
  ['iv', 'Environment, ecological balance, animal welfare, conservation of natural resources'],
  ['v', 'National heritage, art and culture, public libraries'],
  ['vi', 'Armed forces veterans, war widows and their dependants'],
  ['vii', 'Rural, national, Paralympic and Olympic sports training'],
  ['viii', 'PM National Relief Fund, PM CARES or a similar central government fund'],
  ['ix', 'Government-funded incubators and public research in science, technology and medicine'],
  ['x', 'Rural development projects'],
  ['xi', 'Slum area development'],
  ['xii', 'Disaster management: relief, rehabilitation and reconstruction'],
  ['xiii', 'Zero coupon zero principal instruments on the Social Stock Exchange'],
];

/** EPR targets by financial year. */
export const epr = {
  note: 'Targets from the Plastic Waste Management Rules (EPR Guidelines, Schedule II), E-Waste (Management) Rules 2022 (Schedule III) and Battery Waste Management Rules 2022 (Schedule II). Return dates: rule dates plus extensions announced for FY 2025-26.',
  plastic: {
    target_pct: 100,
    categories: [
      ['c1', 'Category I: rigid plastic', 'Bottles, jars, containers, trays, rigid caps'],
      ['c2', 'Category II: flexible plastic', 'Single-layer or plastic-only multilayer films, sheets, carry bags, sachets, pouches'],
      ['c3', 'Category III: multi-layered plastic', 'At least one plastic layer and one other material, e.g. foil or paper laminates'],
      ['c4', 'Category IV: compostable plastic', 'Compostable plastic sheets, packaging and carry bags'],
    ],
    recycling: {
      'FY 2024-25': { c1: 50, c2: 30, c3: 30, c4: 50 },
      'FY 2025-26': { c1: 60, c2: 40, c3: 40, c4: 60 },
      'FY 2026-27': { c1: 70, c2: 50, c3: 50, c4: 70 },
      'FY 2027-28': { c1: 80, c2: 60, c3: 60, c4: 80 },
    },
  },
  ewaste: { 'FY 2023-24': 60, 'FY 2024-25': 60, 'FY 2025-26': 70, 'FY 2026-27': 70, 'FY 2027-28': 80 },
  battery: {
    types: [
      ['portable_ce', 'Portable, rechargeable (consumer electronics)'],
      ['portable', 'Portable, other'],
      ['automotive', 'Automotive (starting, lighting, ignition)'],
      ['industrial', 'Industrial'],
      ['ev3w', 'Electric vehicle: e-rickshaw / three-wheeler'],
      ['ev2w', 'Electric vehicle: two-wheeler'],
      ['ev4w', 'Electric vehicle: four-wheeler'],
    ],
    // [collection target %, the financial year whose sales the target is a share of]
    targets: {
      'FY 2024-25': { portable_ce: [70, 'FY 2019-20'], automotive: [70, 'FY 2021-22'], industrial: [60, 'FY 2021-22'], ev3w: [70, 'FY 2021-22'] },
      'FY 2025-26': { portable_ce: [70, 'FY 2020-21'], portable: [50, 'FY 2022-23'], automotive: [90, 'FY 2022-23'], industrial: [70, 'FY 2022-23'], ev3w: [70, 'FY 2022-23'] },
      'FY 2026-27': { portable_ce: [70, 'FY 2021-22'], portable: [60, 'FY 2023-24'], automotive: [90, 'FY 2023-24'], industrial: [70, 'FY 2023-24'], ev3w: [70, 'FY 2023-24'], ev2w: [70, 'FY 2022-23'] },
      'FY 2027-28': { portable_ce: [70, 'FY 2022-23'], portable: [70, 'FY 2024-25'], automotive: [90, 'FY 2024-25'], industrial: [70, 'FY 2024-25'], ev3w: [70, 'FY 2024-25'], ev2w: [70, 'FY 2023-24'] },
    },
  },
  // annual return: normal due date (day, month after the year ends) and dates extended for a year
  returns: {
    plastic: { day: 30, month: 6, extended: { 'FY 2025-26': '2026-12-31' }, portal: 'https://eprplastic.cpcb.gov.in' },
    ewaste: { day: 30, month: 6, extended: { 'FY 2025-26': '2026-09-30' }, portal: 'https://eprewastecpcb.in' },
    battery: { day: 30, month: 6, extended: { 'FY 2025-26': '2026-11-30' }, portal: 'https://eprbattery.cpcb.gov.in' },
  },
};

/** Schemes library: what each gives, who it is for, documents to keep ready. */
export const schemeItems: any[] = [
  { id: 'adeetie', title: 'ADEETIE (Bureau of Energy Efficiency)', detail: 'Interest subvention of 5% for micro and small, and 3% for medium enterprises, on loans for energy-efficient technology, with an investment-grade energy audit and help to install. Runs FY 2025-26 to 2027-28 in identified clusters of 14 energy-intensive sectors, such as textiles, food processing, chemicals and steel re-rolling.', needs_msme: true, sector: 'mfg', label_ok: 'Likely eligible', label_check: 'Check', link: 'https://beeindia.gov.in/adeetie.php',
    docs: ['Udyam certificate', 'Investment-grade energy audit (BEE empanelled auditor)', 'Equipment quotations', 'Loan sanction from a participating bank', 'Last 12 months’ electricity bills'] },
  { id: 'zed', title: 'MSME Sustainable (ZED) Certification', detail: 'Pays most of the certification cost: 80% for micro, 60% for small and 50% for medium enterprises (100% for women-owned units). Bronze, Silver and Gold levels; Bronze is an online self-assessment.', needs_msme: true, label_ok: 'Eligible', label_check: 'Udyam needed', link: 'https://zed.msme.gov.in',
    docs: ['Udyam certificate', 'ZED pledge', 'Photos of the plant and processes', 'Quality, safety and environment records', 'Bank details for the support'] },
  { id: 'lean', title: 'MSME Competitive (LEAN) Scheme', detail: 'Lean manufacturing with a government-approved consultant: Basic level is free and the government pays 90% of the consultant cost at Intermediate and Advanced levels. Less waste, energy and rework.', needs_msme: true, sector: 'mfg', label_ok: 'Eligible', label_check: 'Check', link: 'https://lean.msme.gov.in',
    docs: ['Udyam certificate', 'LEAN pledge', 'Baseline data: scrap, rework, energy, output', 'Consultant agreement (Intermediate and Advanced)'] },
  { id: 'cgtmse', title: 'CGTMSE: collateral-free loans', detail: 'A government guarantee lets banks lend to micro and small enterprises without collateral or a third-party guarantee, up to ₹10 crore per borrower (raised from ₹5 crore on 1 April 2025). Apply through your bank.', needs_msme: true, label_ok: 'Through your bank', label_check: 'Check', link: 'https://www.cgtmse.in', max_class: 'Small',
    docs: ['Udyam certificate', 'Loan application and project report', 'Last two years’ financial statements and ITR', 'GST returns', 'KYC of the firm and promoters'] },
  { id: 'mcgs', title: 'Mutual Credit Guarantee Scheme (MCGS-MSME)', detail: 'A 60% guarantee from NCGTC on bank loans of up to ₹100 crore for plant and machinery, for manufacturing MSMEs. Equipment must be at least 75% of the project cost.', needs_msme: true, sector: 'mfg', label_ok: 'Through your bank', label_check: 'Check', link: 'https://www.ncgtc.in',
    docs: ['Udyam certificate', 'Equipment quotations', 'Project report', 'Last two years’ financial statements', 'KYC of the firm and promoters'] },
  { id: 'sidbi', title: 'SIDBI energy-efficiency and green finance', detail: 'Concessional loans for energy-efficient equipment and rooftop solar for MSMEs, directly or through partner banks.', needs_msme: true, label_ok: 'Loan', label_check: 'Loan', link: 'https://www.sidbi.in',
    docs: ['Equipment or solar quotations', 'Last two years’ financial statements and ITR', 'GST returns', 'Electricity bills', 'Savings estimate (green-loan pack)'] },
  { id: 'state_subsidy', title: '{state} industrial policy: capital and interest subsidy', detail: 'Most states pay MSMEs a capital subsidy, interest subsidy, SGST refund, stamp-duty waiver or electricity-duty relief on new investment or expansion, with more in backward districts. Your District Industries Centre (DIC) handles it.', needs_msme: true, label_ok: 'Check with DIC', label_check: 'Check', link: null,
    docs: ['Udyam certificate', 'Machinery and building invoices', 'Term-loan sanction and disbursement letters', 'Eligibility certificate from the DIC', 'CA certificate of investment'] },
  { id: 'state_solar', title: 'State rooftop solar & net metering', detail: '{state} DISCOM rules decide net-metering limits and any capital subsidy for commercial and industrial rooftops. (PM Surya Ghar subsidy is for homes only.)', label_ok: 'Check state', label_check: 'Check state', link: null,
    docs: ['Latest electricity bill', 'Sanctioned load', 'Proof the roof is yours or a lease', 'Vendor quotation', 'Net-metering application'] },
  { id: 'pmegp', title: 'PMEGP (KVIC)', detail: 'Margin-money subsidy of 15–35% for new micro units with projects up to ₹50 lakh (manufacturing) or ₹20 lakh (services); existing PMEGP units can get a second loan to upgrade. Not for running non-PMEGP units.', needs_msme: false, new_units_only: true, label_ok: 'New units', label_check: 'New units only', link: 'https://www.kviconline.gov.in/pmegpeportal/',
    docs: ['Project report', 'Aadhaar and PAN', 'Education certificate', 'Category certificate (if claiming special category)', 'EDP training certificate'] },
  { id: 'ccts_offset', title: 'CCTS offset mechanism', detail: 'Credits for registered reduction projects, through the EKOTRACE pool.', label_ok: 'Opportunity', label_check: 'Opportunity', link: null,
    docs: ['Project details (solar or efficiency)', 'Generation or savings records'] },
];

/** "What changed": dated regulatory updates. concerns: sectors / states / flags (any flag matches); no concerns = everyone. */
export const news: any = {
  note: 'Dated regulatory updates shown on What applies, filtered to each company. concerns: { sectors: ["mfg"|"svc"], states: [...], flags: [employer, plastics, ewaste, battery, cbam, euExport, ukExport, listedBuyer, csr, hazWaste, qco, mfg] }.',
  items: [
    { id: 'labour-codes', date: '2025-11-21', title: 'The four Labour Codes are in force', detail: 'The Codes on Wages, Industrial Relations, Social Security and Occupational Safety replaced 29 labour laws. Appointment letters for every worker, wage slips, wages by the 7th, overtime at twice the rate, gratuity after one year for fixed-term staff, and a yearly health check-up for workers aged 40 or more.', source: 'Business Standard', link: 'https://www.business-standard.com/india-news/labour-codes-labour-laws-ministry-of-labour-central-govt-125112100754_1.html', concerns: { flags: ['employer'] } },
    { id: 'dpdp-rules', date: '2025-11-14', title: 'DPDP Rules notified', detail: 'The Digital Personal Data Protection Rules, 2025 were notified. Consent managers from 13 November 2026; notices, security safeguards, breach reporting and other main duties from 13 May 2027.', source: 'S.S. Rana & Co.', link: 'https://ssrana.in/articles/meity-notifies-final-digital-personal-data-protection-rules-2025/', concerns: {} },
    { id: 'qco-withdrawn', date: '2025-11-13', title: 'BIS Quality Control Orders withdrawn for many chemicals and polymers', detail: 'The government withdrew 14 Quality Control Orders (including PE, PP, PVC and polyester inputs) on 12–13 November 2025, and more by 28 November. Check whether your product or inputs still need the ISI mark.', source: 'Business Today', link: 'https://www.businesstoday.in/latest/corporate/story/centre-scraps-14-bis-quality-control-norms-big-relief-for-chemical-plastics-textile-sectors-502118-2025-11-13', concerns: { sectors: ['mfg'] } },
    { id: 'cbam-definitive', date: '2026-01-01', title: 'EU CBAM: importers now pay for embedded emissions', detail: 'The definitive period started on 1 January 2026. Importers of less than 50 tonnes a year of CBAM goods are exempt (simplification adopted in October 2025). Certificates for 2026 imports are bought from February 2027, so EU buyers are asking suppliers for verified emissions data now.', source: 'ICAP', link: 'https://icapcarbonaction.com/en/news/eu-adopts-simplifications-cbam-rules-ahead-compliance-phase-starting-2026', concerns: { flags: ['euExport'] } },
    { id: 'pwm-2026', date: '2026-03-31', title: 'Plastic Waste Management (Amendment) Rules, 2026', detail: 'A shortfall in the 2025-26 recycled-content target can be carried forward over three years (at least a third cleared each year). New reuse targets for rigid packaging; plastic-to-chemical recycling now counts as recycling; certificates are checked by registered environment auditors.', source: 'Corporate Professionals', link: 'https://www.corporateprofessionals.com/regulatoryupdate/plastic-waste-management-amendment-rules-2026-strengthening-epr-recycled-content-and-reuse-obligations/', concerns: { flags: ['plastics'] } },
    { id: 'labour-rules', date: '2026-05-08', title: 'Central rules under the Labour Codes notified', detail: 'The central rules set the formats for appointment letters and wage slips and the employee, wage and attendance registers, allow electronic registers, and require a grievance committee with 20 or more workers. Your state notifies its own rules too.', source: 'King Stubb & Kasiva', link: 'https://ksandk.com/newsletter/labour-codes-central-rules-2026/', concerns: { flags: ['employer'] } },
    { id: 'csr-zczp', date: '2026-05-27', title: 'New CSR activity: Social Stock Exchange instruments', detail: 'Schedule VII gained item (xiii): subscribing to zero coupon zero principal instruments of non-profits listed on the Social Stock Exchange now counts as CSR spending.', source: 'TaxHeal (Gazette G.S.R. 416(E))', link: 'https://www.taxheal.com/?p=132105', concerns: { flags: ['csr'] } },
    { id: 'epr-returns-2526', date: '2026-08-28', title: 'EPR annual returns for 2025-26: new dates', detail: 'Plastic packaging (producers, importers, brand owners): 31 December 2026. Batteries: 30 November 2026. E-waste quarterly and annual returns: 30 September 2026.', source: 'TeamLease RegTech', link: 'https://teamleaseregtech.com/updates/article/59143/moefcc-issued-extension-in-timeline-for-filing-of-annual-returns-of-pwps-and-pibos/', concerns: { flags: ['plastics', 'ewaste', 'battery'] } },
  ],
};
