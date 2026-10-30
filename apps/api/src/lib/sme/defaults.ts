/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * First version of every SME platform setting. The first time a key is read and the database has
 * no version of it, this is stored as version 1 (active). After that, platform admins change it in
 * the platform console (SME → Settings); this file is never read again for a key that exists.
 *
 * All values are indicative starting points and are labelled as such in the app.
 */

export const factors: any = {
  version: 'SME-IN-2026.1',
  note: 'Indicative factors: CEA grid baseline, IPCC 2006 / DEFRA fuel factors, industry averages for materials.',
  items: {
    diesel: { label: 'Diesel (DG sets, forklifts, owned trucks)', unit: 'L', factor: 2.68, scope: 1, source: 'IPCC 2006 / DEFRA' },
    petrol: { label: 'Petrol (owned vehicles)', unit: 'L', factor: 2.31, scope: 1, source: 'IPCC 2006 / DEFRA' },
    lpg: { label: 'LPG (canteen, furnaces)', unit: 'kg', factor: 2.94, scope: 1, source: 'IPCC 2006' },
    png: { label: 'Piped natural gas', unit: 'scm', factor: 2.02, scope: 1, source: 'IPCC 2006' },
    coal: { label: 'Coal', unit: 't', factor: 1800, scope: 1, source: 'IPCC 2006, Indian non-coking coal' },
    refrig: { label: 'AC refrigerant top-up (R-410A)', unit: 'kg', factor: 2088, scope: 1, source: 'IPCC AR5 GWP' },
    grid: { label: 'Grid electricity (DISCOM bills)', unit: 'kWh', factor: 0.716, scope: 2, source: 'CEA CO2 baseline database' },
    solar: { label: 'Rooftop solar generated & used', unit: 'kWh', factor: 0, scope: 2, source: 'Zero-emission generation' },
    steel: { label: 'Steel bought', unit: 't', factor: 2300, scope: 3, category: 'Cat 1', source: 'Industry average, BF-BOF' },
    alu: { label: 'Aluminium bought', unit: 't', factor: 16500, scope: 3, category: 'Cat 1', source: 'Industry average, coal-based power' },
    cement: { label: 'Cement bought', unit: 't', factor: 650, scope: 3, category: 'Cat 1', source: 'Industry average' },
    plastic: { label: 'Plastic / packaging bought', unit: 't', factor: 2500, scope: 3, category: 'Cat 1', source: 'Industry average' },
    road: { label: 'Inbound road freight', unit: 't·km', factor: 0.105, scope: 3, category: 'Cat 4', source: 'DEFRA HGV average' },
    air: { label: 'Business air travel', unit: 'p·km', factor: 0.15, scope: 3, category: 'Cat 6', source: 'DEFRA short-haul' },
    rail: { label: 'Business rail travel', unit: 'p·km', factor: 0.008, scope: 3, category: 'Cat 6', source: 'Indian Railways average' },
  },
  materials: { zinc_kg: 3.1, plastic_kg: 2.5 },
};

export const energy: any = {
  note: 'Net calorific values used to convert fuel to GJ (renewable share of total energy, SRMM B33).',
  kwh: 0.0036,
  fuels: { diesel: 0.0386, petrol: 0.0342, lpg: 0.046, png: 0.038, coal: 18 },
};

export const cbam: any = {
  note: 'Simplified CBAM estimate. Benchmarks and default values must be copied from the EU tables for each CN code.',
  eu_price_eur: 75,
  eur_inr: 98,
  free_allocation_share: 0.975, // 2026: 97.5% of the benchmark deducted
  direct_only_goods: ['steel', 'aluminium'],
  benchmarks: { steel: 1.37, aluminium: 1.46, cement: 0.69, fertiliser: 1.6 },
  default_values: { steel: 3.2, aluminium: 15, cement: 0.95, fertiliser: 2.5 },
  uk_price_gbp: 45,
  gbp_inr: 113,
  uk_start: '2027-01-01',
};

export const tariffs: any = {
  note: 'Typical HT industrial tariff. Add a row per DISCOM from its tariff order.',
  // Rates and assumptions only. The bill itself (demand, power factor, units, penalty) always comes from the SME.
  default: { energyRate: 8.2, demandRate: 450, excessMult: 1.5, capCost: 800, shiftPct: 10, peakSur: 1.5, offRebate: 1.0 },
  discoms: [
    { id: 'msedcl', name: 'MSEDCL (Maharashtra)', state: 'Maharashtra', energyRate: 8.2, demandRate: 450, excessMult: 1.5, peakSur: 1.5, offRebate: 1.0 },
  ],
};

export const solar: any = {
  note: 'Rooftop solar defaults. Override per state where yields or costs differ.',
  default: { roof: 0, usable: 70, tariff: 8.2, costKw: 42000, yieldKwp: 1450, m2PerKw: 10 },
  states: { Rajasthan: { yieldKwp: 1600 }, Gujarat: { yieldKwp: 1550 }, 'West Bengal': { yieldKwp: 1300 } },
};

export const credit_pool: any = {
  note: 'Pooled offset programme across SMEs. Pool size shows other members’ projects.',
  price_inr: 500,
  management_share_pct: 20,
  pool_tco2e_others: 9400,
  viable_at_tco2e: 10000,
};

export const esg: any = {
  note: 'Weights for the SME ESG readiness score. Each section is scored out of 100.',
  weights: {
    env: { energy_tracked: 20, water_tracked: 15, waste_tracked: 15, recycling_50: 10, renewables: 10, target: 15, ems: 15 },
    soc: { headcount: 15, women_recorded: 15, safety_log: 15, zero_lti: 10, min_wage: 15, posh: 15, training: 15 },
    gov: { coc: 20, abc: 20, grievance: 20, privacy: 15, supplier_code: 15, owner_esg: 10 },
  },
};

export const dpdp: any = {
  note: 'DPDP Act 2023 and DPDP Rules 2025 (notified 14 November 2025). Main duties apply from 13 May 2027; consent managers from 13 November 2026. MeitY proposed in January 2026 to shorten the 18 months to 12; no amending notification as of September 2026 — check the Gazette.',
  deadline: '2027-05-13',
  milestones: [
    { date: '2025-11-14', title: 'Rules notified; Data Protection Board set up' },
    { date: '2026-11-13', title: 'Consent managers can register' },
    { date: '2027-05-13', title: 'Main duties apply: notice, consent, security, breaches, rights, retention' },
  ],
  penalty: 'Penalties: up to ₹250 crore for not keeping reasonable security safeguards, up to ₹200 crore for not reporting a breach or for breaking the duties on children’s data, up to ₹50 crore for other duties.',
  areas: [
    { key: 'know', title: 'Know your data' },
    { key: 'notice', title: 'Notice and consent' },
    { key: 'use', title: 'Use, keep and delete' },
    { key: 'secure', title: 'Security' },
    { key: 'breach', title: 'Breaches' },
    { key: 'rights', title: 'People’s rights' },
    { key: 'vendors', title: 'Vendors' },
  ],
  items: [
    { key: 'inv', area: 'know', title: 'List the personal data you hold', why: 'Everything else depends on it: notice, retention, security and vendor contracts.', evidence: 'The data register on this page' },
    { key: 'owner', area: 'know', title: 'Name the person responsible for data protection', why: 'Someone must answer questions, handle requests and lead on a breach.', evidence: 'Name and contact in “Your data contact”' },
    { key: 'minimise', area: 'know', title: 'Stop collecting data you do not need', why: 'Less data, less risk. Common extras: full Aadhaar copies, family details, photos of documents kept on phones.', evidence: 'Forms changed; old copies deleted' },
    { key: 'notice', area: 'notice', title: 'Give a plain-language privacy notice', why: 'Rule 3: a notice on its own, listing the data and each purpose, how to withdraw consent, use your rights and complain to the Board.', evidence: 'Notice text (see Templates) and where it is shown' },
    { key: 'consent', area: 'notice', title: 'Collect and record consent where consent is your basis', why: 'Consent must be free, specific, informed and clear; keep proof of it.', evidence: 'Consent forms, sign-up records' },
    { key: 'legit', area: 'notice', title: 'Record where you rely on a legitimate use instead of consent', why: 'Employee data for employment, data needed by law, and data a person gave you for a purpose need no separate consent (section 7).', evidence: 'The basis column in the data register' },
    { key: 'withdraw', area: 'notice', title: 'Make withdrawing consent as easy as giving it', why: 'A person can withdraw at any time; you then stop and delete, unless the law needs you to keep it.', evidence: 'How to withdraw, written in the notice' },
    { key: 'cctv', area: 'notice', title: 'Put up CCTV notices', why: 'People should know they are recorded, why, and whom to ask.', evidence: 'Signboards at entrances (see Templates)' },
    { key: 'kids', area: 'notice', title: 'Check for children’s data', why: 'Under 18 needs verifiable consent of a parent; no tracking or targeted advertising to children.', evidence: 'Register rows marked “children”' },
    { key: 'purpose', area: 'use', title: 'Use data only for the purpose given', why: 'A new purpose needs a new notice, and consent where consent is the basis.', evidence: 'Purposes in the register' },
    { key: 'retain', area: 'use', title: 'Set how long you keep each kind of data, then delete', why: 'Delete once the purpose is over, unless a law needs you to keep it (tax and labour records do).', evidence: 'Keep-for column in the register; deletion done each year' },
    { key: 'accuracy', area: 'use', title: 'Keep data correct where it is used to decide about a person', why: 'For example salary, attendance or credit decisions.', evidence: 'How records are checked and corrected' },
    { key: 'access', area: 'secure', title: 'Limit who can see personal data', why: 'Own login for each person, no shared passwords, access removed when someone leaves.', evidence: 'List of systems and who has access' },
    { key: 'encrypt', area: 'secure', title: 'Encrypt or mask stored data', why: 'Rule 6 names encryption, masking and obfuscation. Laptops and phones with screen locks; Aadhaar numbers masked.', evidence: 'Disk encryption on; masked copies' },
    { key: 'secure', area: 'secure', title: 'Back up and be able to restore', why: 'Rule 6 asks for measures to keep data available after an incident.', evidence: 'Backup schedule; last restore test' },
    { key: 'logs', area: 'secure', title: 'Keep access logs for at least one year', why: 'Rule 6: logs that show who accessed personal data, kept for a year, to detect and investigate misuse.', evidence: 'Where the logs are kept' },
    { key: 'breach', area: 'breach', title: 'Write down what to do in a breach', why: 'Who decides, who informs the Board and the people affected, who fixes the cause.', evidence: 'A one-page plan' },
    { key: 'breach72', area: 'breach', title: 'Know the reporting times', why: 'Rule 7: tell the Board and each affected person without delay; send the Board a detailed report within 72 hours.', evidence: 'Plan names the 72 hours; Board contact saved' },
    { key: 'breachlog', area: 'breach', title: 'Keep a breach log', why: 'Every breach, even a small one, with what you did and when.', evidence: 'The breach log on this page' },
    { key: 'contact', area: 'rights', title: 'Publish a contact for data questions', why: 'People must know whom to ask about their data.', evidence: 'Contact on your website, notice and notice board' },
    { key: 'rights', area: 'rights', title: 'Answer requests to see, correct or erase data', why: 'The Rules set 90 days at most to answer.', evidence: 'The request log on this page' },
    { key: 'grievance', area: 'rights', title: 'Handle complaints before they go to the Board', why: 'A person must first use your grievance process before complaining to the Board.', evidence: 'Complaints recorded and answered' },
    { key: 'vendorlist', area: 'vendors', title: 'List the vendors who handle your data', why: 'Payroll, HR and accounting software, cloud storage, CCTV, IT support. You stay responsible for what they do.', evidence: 'Vendors column in the register' },
    { key: 'vendors', area: 'vendors', title: 'Add data clauses to vendor contracts', why: 'Use only on your instructions, keep it secure, report breaches to you at once, delete at the end.', evidence: 'Signed clauses (see Templates)' },
    { key: 'abroad', area: 'vendors', title: 'Know if data leaves India', why: 'Allowed, except to countries the Government restricts. Cloud services often store data abroad.', evidence: 'Where each vendor stores data' },
  ],
};

export const calendar: any = {
  note: 'Typical due dates. Add state overrides where a state differs.',
  soon_days: 45,
  templates: [
    { id: 'pf', title: 'PF and ESI contributions', kind: 'monthly', day: 15, freq: 'Monthly, 15th', who: 'EPFO / ESIC' },
    { id: 'es', title: 'Environmental Statement (Form V) to pollution board', kind: 'annual', month: 9, day: 30, freq: 'Yearly, 30 Sep', who: 'State pollution board' },
    { id: 'hw', title: 'Hazardous waste annual return (Form 4)', kind: 'annual', month: 6, day: 30, freq: 'Yearly, 30 Jun', who: 'State pollution board', go: 'scrap' },
    { id: 'epr', title: 'Plastic EPR annual return', kind: 'annual', month: 6, day: 30, freq: 'Yearly, 30 Jun', who: 'CPCB EPR portal', go: 'epr', when: 'plastics' },
    { id: 'ew', title: 'E-waste EPR annual return', kind: 'annual', month: 6, day: 30, freq: 'Yearly, 30 Jun', who: 'CPCB EPR portal', go: 'epr', when: 'ewaste' },
    { id: 'cto', title: 'Consent to Operate renewal', kind: 'company', field: 'cto', freq: 'Your expiry date', who: 'State pollution board' },
    { id: 'fl', title: 'Factory licence renewal', kind: 'company', field: 'factory', freq: 'Your expiry date', who: 'Factories department' },
    { id: 'fire', title: 'Fire NOC renewal', kind: 'company', field: 'fire', freq: 'Your expiry date', who: 'Fire department' },
    { id: 'posh', title: 'POSH annual report to District Officer', kind: 'annual', month: 1, day: 31, freq: 'Yearly (date varies by state)', who: 'District Officer', go: 'people' },
    { id: 'brsr', title: 'Buyer BRSR value-chain data', kind: 'annual', month: 5, day: 15, freq: 'Yearly, before buyer’s annual report', who: 'Listed customer', go: 'share', when: 'listedBuyer' },
    { id: 'cbam', title: 'Send 2026 embedded emissions to EU importer', kind: 'fixed', date: '2027-06-30', freq: 'Before importer’s declaration (30 Sep 2027)', who: 'EU importer', go: 'cbam', when: 'cbam' },
    { id: 'ukc', title: 'UK CBAM starts: share data with UK importer', kind: 'fixed', date: '2027-01-01', freq: 'From 1 Jan 2027', who: 'UK importer', go: 'cbam', when: 'ukCbam' },
    { id: 'csr', title: 'Spend CSR obligation for the year', kind: 'annual', month: 3, day: 31, freq: 'Yearly, 31 Mar', who: 'Board / CSR committee', go: 'csr', when: 'csr' },
  ],
  states: {},
};

export const requirements: any = {
  note: 'Texts and thresholds behind "What applies". {placeholders} are filled from company data.',
  msme_turnover_cr: { micro: 10, small: 100, medium: 500 },
  csr: { net_worth_cr: 500, turnover_cr: 1000, net_profit_cr: 5, rate: 0.02, committee_threshold_cr: 0.5 },
  items: {
    brsr_value_chain: {
      likely: { status: 'likely', label: 'Likely', title: 'BRSR value-chain data requests', detail: 'Listed customers report ESG data for suppliers that make up 2% or more of their purchases. Expect a BRSR-style questionnaire.', action: 'Fill Emissions and ESG, then share the summary.', go: 'share' },
      watch: { status: 'watch', label: 'Watch', title: 'BRSR value-chain data requests', detail: 'Applies when you supply a listed company.', action: 'Keep ESG data ready.', go: 'esg' },
    },
    srmm: {
      open: { status: 'likely', label: 'In progress', title: 'SRMM maturity level (ICAI)', detail: 'ICAI’s Sustainability Reporting Maturity Model scores your reporting out of 300 (v3.1 manufacturing or v3.2 service) and awards Levels 1–4 after CA validation.', action: '{srmm_pct}% scored, {srmm_open} indicators open.', go: 'srmm' },
      done: { status: 'good', label: 'Scored', title: 'SRMM maturity level (ICAI)', detail: 'ICAI’s Sustainability Reporting Maturity Model scores your reporting out of 300 and awards Levels 1–4 after CA validation.', action: '{srmm_pct}% scored.', go: 'srmm' },
    },
    eu_cbam: {
      applies: { status: 'apply', label: 'Applies', title: 'EU CBAM', detail: 'Your EU importer pays for embedded emissions from 2026. Without your data, higher EU default values are used.', action: 'Calculate emissions per tonne and send them to your importer.', go: 'cbam' },
      watch: { status: 'watch', label: 'Watch', title: 'EU CBAM', detail: 'Your product is not a CBAM good today. Coverage of downstream products is planned to widen.', action: 'Track emissions now.', go: 'emissions' },
    },
    uk_cbam: { applies: { status: 'likely', label: 'From Jan 2027', title: 'UK CBAM', detail: 'The UK applies its own CBAM to aluminium, cement, fertiliser, hydrogen and iron & steel from 1 January 2027 (glass and ceramics were dropped).', action: 'Use the same embedded-emissions data for your UK importer.', go: 'cbam' } },
    eudr: { applies: { status: 'apply', label: 'Applies', title: 'EU Deforestation Regulation (EUDR)', detail: 'EU buyers must prove your {eudr} is deforestation-free with plot geolocation. Large operators from 30 Dec 2026, micro and small from 30 Jun 2027.', action: 'Record plot coordinates and documents.', go: 'eudr' } },
    brsr_filing: {
      applies: { status: 'apply', label: 'Applies', title: 'BRSR filing (SEBI)', detail: 'Listed companies in the SEBI top-1000 file BRSR with the annual report.', action: 'Use the full EKOTRACE BRSR Core package.' },
      not_required: { status: 'good', label: 'Not required', title: 'BRSR filing (SEBI)', detail: 'Own filing applies to listed companies only.', action: '' },
    },
    ccts: {
      check: { status: 'likely', label: 'Check', title: 'India CCTS obligations', detail: 'Units notified as obligated entities have emission-intensity targets.', action: 'Check whether your unit is notified.', go: 'emissions' },
      opportunity: { status: 'watch', label: 'Opportunity', title: 'India CCTS offset credits', detail: 'Solar and efficiency projects can earn credits when pooled across SMEs.', action: 'See your credit potential.', go: 'credits' },
    },
    plastic_epr: { check: { status: 'likely', label: 'Check', title: 'Plastic packaging EPR', detail: 'Brand owners, producers and importers of plastic packaging have collection and recycling targets.', action: 'Track your EPR position.', go: 'epr' } },
    other_epr: { check: { status: 'likely', label: 'Check', title: 'E-waste / battery EPR', detail: 'Producers of electrical goods or batteries need EPR registration and annual returns.', action: 'Track registration.', go: 'epr' } },
    dpdp: {
      on_track: { status: 'good', label: 'On track', title: 'DPDP Act (data privacy)', detail: 'Applies to every business holding personal data, including employee records. Most obligations apply from May 2027.', action: '{dpdp_pct}% of the checklist done.', go: 'dpdp' },
      prepare: { status: 'likely', label: 'Prepare', title: 'DPDP Act (data privacy)', detail: 'Applies to every business holding personal data, including employee records. Most obligations apply from May 2027.', action: '{dpdp_pct}% of the checklist done.', go: 'dpdp' },
    },
    csr: { applies: { status: 'apply', label: 'Applies', title: 'CSR (Companies Act s.135)', detail: 'Net profit of ₹{csr_profit} crore crosses the ₹5 crore threshold. Spend 2% of average profit.', action: 'Obligation ₹{csr_lakh} lakh this year.', go: 'csr' } },
    posh: {
      on_track: { status: 'good', label: 'On track', title: 'Workplace safety & POSH', detail: 'Internal Committee and an annual report are required with 10 or more employees.', action: 'Review the safety log and POSH status.', go: 'people' },
      check: { status: 'likely', label: 'Check', title: 'Workplace safety & POSH', detail: 'Internal Committee and an annual report are required with 10 or more employees.', action: 'Review the safety log and POSH status.', go: 'people' },
    },
    bank: { useful: { status: 'watch', label: 'Useful', title: 'Bank ESG checks & green loans', detail: 'Banks are adding ESG checks to loan reviews and pricing.', action: 'Build a green-loan pack.', go: 'loan' } },
  },
};

export const schemes: any = {
  note: 'Terms change; each entry tells the user to confirm on the official portal.',
  items: [
    { id: 'adeetie', title: 'ADEETIE (Bureau of Energy Efficiency)', detail: 'Interest subvention on loans for energy-efficient technology, with energy audits and implementation support, for MSMEs in identified industrial clusters.', needs_msme: true, sector: 'mfg', label_ok: 'Likely eligible', label_check: 'Check', link: 'https://beeindia.gov.in/adeetie.php' },
    { id: 'zed', title: 'MSME Sustainable (ZED) Certification', detail: 'Government support on certification cost for Udyam-registered MSMEs, with higher support for micro and small units. Bronze, Silver and Gold levels.', needs_msme: true, label_ok: 'Eligible', label_check: 'Udyam needed' },
    { id: 'lean', title: 'MSME LEAN scheme', detail: 'Support for lean manufacturing consultants and implementation. Less waste, energy and rework.', needs_msme: true, sector: 'mfg', label_ok: 'Eligible', label_check: 'Check' },
    { id: 'sidbi', title: 'SIDBI energy-efficiency and green finance', detail: 'Concessional loans for energy-efficient equipment and rooftop solar for MSMEs.', needs_msme: true, label_ok: 'Loan', label_check: 'Loan' },
    { id: 'state_solar', title: 'State rooftop solar & net metering', detail: '{state} DISCOM rules decide net-metering limits and any capital subsidy.', label_ok: 'Check state', label_check: 'Check state' },
    { id: 'ccts_offset', title: 'CCTS offset mechanism', detail: 'Credits for registered reduction projects, through the EKOTRACE pool.', label_ok: 'Opportunity', label_check: 'Opportunity' },
  ],
};

export const plans: any = {
  note: 'Nominal-fee plans. Prices in INR per year, GST extra.',
  items: [
    { id: 'free', name: 'Starter', price_inr: 0, modules: ['profile', 'applies', 'emissions', 'esg', 'calendar'], ca_validation: false },
    { id: 'basic', name: 'Basic', price_inr: 2999, modules: 'all', ca_validation: false },
    { id: 'plus', name: 'Plus', price_inr: 9999, modules: 'all', ca_validation: true },
  ],
};

export const content: any = {
  note: 'Message templates and UI labels. {placeholders} are filled when sent.',
  templates: {
    reminder_45: 'Reminder: {title} is due on {date}. Reply 1 to see the document list.',
    reminder_3: 'Due in 3 days: {title} ({date}).',
    buyer_request: 'Your buyer {buyer} has asked for FY {fy} ESG data. Your summary is ready. Reply SEND to share it.',
    bill_prompt: 'नमस्ते! {month} का बिजली बिल भेजें। Please send {month}’s electricity bill.',
  },
  languages: ['en', 'hi', 'mr', 'gu'],
};

export const recyclers: any = {
  note: 'Registered recyclers SMEs can contact for scrap quotes. Add only recyclers you have checked (CPCB / SPCB authorisation).',
  items: [] as any[],
};

export const DEFAULTS: Record<string, any> = { recyclers, factors, energy, cbam, tariffs, solar, credit_pool, esg, dpdp, calendar, requirements, schemes, plans, content };
