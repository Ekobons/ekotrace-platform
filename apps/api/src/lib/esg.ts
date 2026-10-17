/**
 * ESG content: frameworks, sustainability topics (ESRS topical structure), industries with their likely material
 * topics, the question bank (general per topic + industry-specific) with references to the frameworks, and the
 * double-materiality scoring. Wording is our own; framework references point to the disclosure each answer supports.
 *
 * Scoring (1–5 scales, ESRS 1 §43–49 and EFRAG IG 1 logic):
 *   negative impact severity = mean(scale, scope, irremediability); positive = mean(scale, scope)
 *   actual impact → severity; potential → severity × likelihood ÷ 5, except potential human-rights impacts where
 *   severity takes precedence (likelihood ignored)
 *   financial (risk or opportunity) → magnitude × likelihood ÷ 5
 *   material when a score reaches the company's threshold (default 3.0); a topic is material if either side is.
 */
export interface Framework { code: string; name: string; region: string; materiality: 'double' | 'impact' | 'financial' | 'none'; who: string; note: string }
export const FRAMEWORKS: Framework[] = [
  { code: 'esrs', name: 'ESRS (EU CSRD)', region: 'EU', materiality: 'double', who: 'EU companies in CSRD scope (after Omnibus I: over 1,000 employees and €450 million turnover; first reports for 2027 for companies not already reporting) and EU subsidiaries of non-EU groups in scope.', note: 'Double materiality assessment required; only material topics are reported. Value-chain requests to smaller companies are capped at the voluntary SME standard (VSME).' },
  { code: 'vsme', name: 'VSME (EU voluntary SME standard)', region: 'EU', materiality: 'none', who: 'Small and medium companies asked for ESG data by customers, banks or investors.', note: 'Basic module without a materiality assessment; the comprehensive module adds narrative disclosures.' },
  { code: 'gri', name: 'GRI Standards', region: 'Global', materiality: 'impact', who: 'Any organisation reporting its impacts on the economy, environment and people.', note: 'Impact materiality: material topics determined under GRI 3 (impacts on people and the environment).' },
  { code: 'issb', name: 'IFRS S1 and S2 (ISSB)', region: 'Global', materiality: 'financial', who: 'Listed companies where adopted by the regulator (e.g. Australia, Singapore, Japan, UK, several GCC markets proposing it).', note: 'Financial materiality: sustainability risks and opportunities that could affect the company\'s prospects; IFRS S2 for climate.' },
  { code: 'sasb', name: 'SASB Standards', region: 'Global', materiality: 'financial', who: 'Companies using IFRS S1, or reporting industry metrics to investors.', note: 'Industry-specific topics and metrics (77 industries); financially material by industry.' },
  { code: 'adx', name: 'ADX ESG Disclosure Guidance', region: 'UAE', materiality: 'none', who: 'Companies listed on the Abu Dhabi Securities Exchange (annual sustainability reporting).', note: 'Metrics-based (E1–E10, S1–S12, G1–G10); a materiality assessment is recommended to frame the report.' },
  { code: 'dfm', name: 'DFM ESG Reporting Guide', region: 'UAE', materiality: 'none', who: 'Companies listed on the Dubai Financial Market.', note: 'Metrics-based guide aligned with international frameworks; materiality assessment recommended.' },
  { code: 'tadawul', name: 'Saudi Exchange ESG Disclosure Guidelines', region: 'Saudi Arabia', materiality: 'none', who: 'Companies listed on the Saudi Exchange (Tadawul).', note: 'Metrics-based guidelines; materiality assessment recommended.' },
  { code: 'cdp', name: 'CDP', region: 'Global', materiality: 'none', who: 'Companies asked by investors or customers to disclose through CDP (climate, water, forests).', note: 'Questionnaire; scores A to D-.' },
];

export interface Topic { code: string; pillar: 'E' | 'S' | 'G'; name: string; sub: string; refs: Record<string, string> }
export const TOPICS: Topic[] = [
  { code: 'E1', pillar: 'E', name: 'Climate change', sub: 'Mitigation (GHG emissions), adaptation to physical climate risk, energy', refs: { esrs: 'ESRS E1', gri: 'GRI 302, 305', issb: 'IFRS S2', adx: 'E1–E5, E10' } },
  { code: 'E2', pillar: 'E', name: 'Pollution', sub: 'Air, water and soil pollution; substances of concern; microplastics', refs: { esrs: 'ESRS E2', gri: 'GRI 305-7, 303-4, 306', adx: 'E7' } },
  { code: 'E3', pillar: 'E', name: 'Water and marine resources', sub: 'Water withdrawal, consumption and discharge; water-stressed areas; marine resources', refs: { esrs: 'ESRS E3', gri: 'GRI 303', adx: 'E6' } },
  { code: 'E4', pillar: 'E', name: 'Biodiversity and ecosystems', sub: 'Land use, sites near protected or key biodiversity areas, ecosystem degradation', refs: { esrs: 'ESRS E4', gri: 'GRI 101 / 304' } },
  { code: 'E5', pillar: 'E', name: 'Resource use and circular economy', sub: 'Materials used, recycled content, waste generated and diverted from disposal', refs: { esrs: 'ESRS E5', gri: 'GRI 301, 306' } },
  { code: 'S1', pillar: 'S', name: 'Own workforce', sub: 'Working conditions, health and safety, pay, diversity and equal treatment, training, rights at work', refs: { esrs: 'ESRS S1', gri: 'GRI 401–405', adx: 'S1–S8, S11' } },
  { code: 'S2', pillar: 'S', name: 'Workers in the value chain', sub: 'Labour conditions of contractors and suppliers\' workers, forced and child labour, worker accommodation', refs: { esrs: 'ESRS S2', gri: 'GRI 408, 409, 414', adx: 'S9, S10' } },
  { code: 'S3', pillar: 'S', name: 'Affected communities', sub: 'Communities near operations: health, land, livelihoods, local employment and investment', refs: { esrs: 'ESRS S3', gri: 'GRI 413', adx: 'S12' } },
  { code: 'S4', pillar: 'S', name: 'Consumers and end-users', sub: 'Product and service safety, information and privacy, access to essential services', refs: { esrs: 'ESRS S4', gri: 'GRI 416, 418' } },
  { code: 'G1', pillar: 'G', name: 'Business conduct', sub: 'Corporate culture, anti-corruption, whistleblowing, supplier relationships and payment practices, political engagement', refs: { esrs: 'ESRS G1', gri: 'GRI 205, 206, 2-26', adx: 'G1–G10' } },
];

export interface Industry { code: string; name: string; likely: string[] }
export const INDUSTRIES: Industry[] = [
  { code: 'waste', name: 'Waste management and environmental services', likely: ['E1', 'E2', 'E3', 'E5', 'S1', 'S2', 'S3'] },
  { code: 'utilities', name: 'Utilities and power generation', likely: ['E1', 'E2', 'E3', 'E4', 'S1', 'S3', 'S4'] },
  { code: 'real_estate', name: 'Real estate and construction', likely: ['E1', 'E3', 'E5', 'S1', 'S2', 'S3', 'G1'] },
  { code: 'materials', name: 'Construction materials (cement, steel, aluminium)', likely: ['E1', 'E2', 'E3', 'E5', 'S1', 'S3'] },
  { code: 'oil_gas', name: 'Oil and gas', likely: ['E1', 'E2', 'E3', 'E4', 'S1', 'S3', 'G1'] },
  { code: 'chemicals', name: 'Chemicals and fertilisers', likely: ['E1', 'E2', 'E3', 'E5', 'S1', 'S4'] },
  { code: 'mining', name: 'Metals and mining', likely: ['E1', 'E2', 'E3', 'E4', 'S1', 'S2', 'S3', 'G1'] },
  { code: 'manufacturing', name: 'Industrial manufacturing', likely: ['E1', 'E2', 'E5', 'S1', 'S2', 'S4'] },
  { code: 'transport', name: 'Transport and logistics', likely: ['E1', 'E2', 'S1', 'S2', 'S4'] },
  { code: 'hospitality', name: 'Hospitality, travel and leisure', likely: ['E1', 'E3', 'E5', 'S1', 'S2', 'S4'] },
  { code: 'healthcare', name: 'Healthcare', likely: ['E1', 'E2', 'E5', 'S1', 'S4', 'G1'] },
  { code: 'food', name: 'Food, agriculture and beverages', likely: ['E1', 'E3', 'E4', 'E5', 'S2', 'S4'] },
  { code: 'retail', name: 'Retail and consumer goods', likely: ['E1', 'E5', 'S2', 'S4', 'G1'] },
  { code: 'tech', name: 'Technology and telecommunications', likely: ['E1', 'E5', 'S1', 'S4', 'G1'] },
  { code: 'financial', name: 'Banks, insurance and investment', likely: ['E1', 'S1', 'S4', 'G1'] },
  { code: 'services', name: 'Professional and business services', likely: ['E1', 'S1', 'S4', 'G1'] },
];

export type QType = 'number' | 'percent' | 'yesno' | 'text';
export interface Question { code: string; topic: string; industry?: string; text: string; type: QType; unit?: string; refs: Record<string, string>; auto?: 's1' | 's2' | 's2m' | 's3' | 'total' }
export const QUESTIONS: Question[] = [
  // ---- general, by topic
  { code: 'E1.1', topic: 'E1', text: 'Gross Scope 1 GHG emissions', type: 'number', unit: 'tCO₂e', refs: { esrs: 'E1-6 §44(a)', gri: '305-1', issb: 'S2 §29(a)', adx: 'E1', tadawul: 'E1' }, auto: 's1' },
  { code: 'E1.2', topic: 'E1', text: 'Gross Scope 2 GHG emissions, location-based', type: 'number', unit: 'tCO₂e', refs: { esrs: 'E1-6 §44(b)', gri: '305-2', issb: 'S2 §29(a)', adx: 'E1' }, auto: 's2' },
  { code: 'E1.3', topic: 'E1', text: 'Gross Scope 2 GHG emissions, market-based', type: 'number', unit: 'tCO₂e', refs: { esrs: 'E1-6 §44(b)', gri: '305-2' }, auto: 's2m' },
  { code: 'E1.4', topic: 'E1', text: 'Gross Scope 3 GHG emissions', type: 'number', unit: 'tCO₂e', refs: { esrs: 'E1-6 §44(c)', gri: '305-3', issb: 'S2 §29(a)(vi)', adx: 'E1' }, auto: 's3' },
  { code: 'E1.5', topic: 'E1', text: 'Total energy consumption', type: 'number', unit: 'MWh', refs: { esrs: 'E1-5', gri: '302-1', adx: 'E3' } },
  { code: 'E1.6', topic: 'E1', text: 'Share of energy from renewable sources', type: 'percent', refs: { esrs: 'E1-5', gri: '302-1', adx: 'E5' } },
  { code: 'E1.7', topic: 'E1', text: 'GHG reduction targets set (base year, target year, % reduction)', type: 'text', refs: { esrs: 'E1-4', gri: '305-5', issb: 'S2 §33' } },
  { code: 'E1.8', topic: 'E1', text: 'Climate transition plan adopted by the board', type: 'yesno', refs: { esrs: 'E1-1', issb: 'S2 §14', adx: 'E10' } },
  { code: 'E1.9', topic: 'E1', text: 'Physical climate risks assessed for the main sites (heat, flooding, water stress)', type: 'yesno', refs: { esrs: 'E1 IRO-1', issb: 'S2 §10', adx: 'E10' } },
  { code: 'E2.1', topic: 'E2', text: 'Emissions of air pollutants (NOx, SOx, particulate matter) — total', type: 'number', unit: 't', refs: { esrs: 'E2-4', gri: '305-7' } },
  { code: 'E2.2', topic: 'E2', text: 'Environmental incidents or permit breaches in the year', type: 'number', unit: 'count', refs: { esrs: 'E2-4', gri: '2-27', adx: 'E7' } },
  { code: 'E2.3', topic: 'E2', text: 'Environmental management system certified (ISO 14001)', type: 'yesno', refs: { esrs: 'E2-1', adx: 'E7' } },
  { code: 'E3.1', topic: 'E3', text: 'Total water withdrawal', type: 'number', unit: 'm³', refs: { esrs: 'E3-4', gri: '303-3', adx: 'E6' } },
  { code: 'E3.2', topic: 'E3', text: 'Total water consumption', type: 'number', unit: 'm³', refs: { esrs: 'E3-4', gri: '303-5' } },
  { code: 'E3.3', topic: 'E3', text: 'Share of water withdrawn in areas of high water stress', type: 'percent', refs: { esrs: 'E3-4', gri: '303-3' } },
  { code: 'E4.1', topic: 'E4', text: 'Sites in or near protected areas or key biodiversity areas', type: 'number', unit: 'count', refs: { esrs: 'E4-5', gri: '304-1' } },
  { code: 'E4.2', topic: 'E4', text: 'Biodiversity policy or no-net-loss commitment', type: 'yesno', refs: { esrs: 'E4-2', gri: '304' } },
  { code: 'E5.1', topic: 'E5', text: 'Total waste generated', type: 'number', unit: 't', refs: { esrs: 'E5-5', gri: '306-3' } },
  { code: 'E5.2', topic: 'E5', text: 'Waste diverted from disposal (reuse, recycling, recovery)', type: 'percent', refs: { esrs: 'E5-5', gri: '306-4' } },
  { code: 'E5.3', topic: 'E5', text: 'Hazardous waste generated', type: 'number', unit: 't', refs: { esrs: 'E5-5', gri: '306-3' } },
  { code: 'E5.4', topic: 'E5', text: 'Recycled or secondary materials as a share of materials used', type: 'percent', refs: { esrs: 'E5-4', gri: '301-2' } },
  { code: 'S1.1', topic: 'S1', text: 'Total employees (headcount, end of year)', type: 'number', unit: 'people', refs: { esrs: 'S1-6', gri: '2-7' } },
  { code: 'S1.2', topic: 'S1', text: 'Women in the workforce', type: 'percent', refs: { esrs: 'S1-9', gri: '405-1', adx: 'S4' } },
  { code: 'S1.3', topic: 'S1', text: 'Women in senior management', type: 'percent', refs: { esrs: 'S1-9', gri: '405-1', adx: 'S4' } },
  { code: 'S1.4', topic: 'S1', text: 'Employee turnover rate', type: 'percent', refs: { esrs: 'S1-6', gri: '401-1', adx: 'S3' } },
  { code: 'S1.5', topic: 'S1', text: 'Lost-time injury frequency rate (per million hours worked)', type: 'number', unit: 'LTIFR', refs: { esrs: 'S1-14', gri: '403-9', adx: 'S7' } },
  { code: 'S1.6', topic: 'S1', text: 'Work-related fatalities (employees and contractors)', type: 'number', unit: 'count', refs: { esrs: 'S1-14', gri: '403-9', adx: 'S7' } },
  { code: 'S1.7', topic: 'S1', text: 'Average training hours per employee', type: 'number', unit: 'hours', refs: { esrs: 'S1-13', gri: '404-1' } },
  { code: 'S1.8', topic: 'S1', text: 'Gender pay gap (unadjusted)', type: 'percent', refs: { esrs: 'S1-16', gri: '405-2', adx: 'S2' } },
  { code: 'S1.9', topic: 'S1', text: 'Nationals in the workforce (Emiratisation / Saudisation rate)', type: 'percent', refs: { adx: 'S11' } },
  { code: 'S1.10', topic: 'S1', text: 'Occupational health and safety management system certified (ISO 45001)', type: 'yesno', refs: { esrs: 'S1-1', gri: '403-1', adx: 'S8' } },
  { code: 'S2.1', topic: 'S2', text: 'Supplier code of conduct covering labour and human rights', type: 'yesno', refs: { esrs: 'S2-1', gri: '414', adx: 'G5' } },
  { code: 'S2.2', topic: 'S2', text: 'Share of significant suppliers assessed or audited on labour practices', type: 'percent', refs: { esrs: 'S2-4', gri: '414-1' } },
  { code: 'S2.3', topic: 'S2', text: 'Policy prohibiting forced and child labour, including recruitment fees for migrant workers', type: 'yesno', refs: { esrs: 'S2-1', gri: '408, 409', adx: 'S9' } },
  { code: 'S3.1', topic: 'S3', text: 'Community investment in the year', type: 'number', unit: 'currency', refs: { esrs: 'S3-4', gri: '201-1', adx: 'S12' } },
  { code: 'S3.2', topic: 'S3', text: 'Operations with community engagement or impact assessments', type: 'percent', refs: { esrs: 'S3-2', gri: '413-1' } },
  { code: 'S3.3', topic: 'S3', text: 'Community grievances received and resolved', type: 'text', refs: { esrs: 'S3-3', gri: '2-25' } },
  { code: 'S4.1', topic: 'S4', text: 'Product or service safety incidents', type: 'number', unit: 'count', refs: { esrs: 'S4-4', gri: '416-2' } },
  { code: 'S4.2', topic: 'S4', text: 'Substantiated complaints about customer privacy or data breaches', type: 'number', unit: 'count', refs: { esrs: 'S4-4', gri: '418-1', adx: 'G7' } },
  { code: 'G1.1', topic: 'G1', text: 'Code of conduct and anti-corruption policy', type: 'yesno', refs: { esrs: 'G1-1', gri: '2-23, 205-2', adx: 'G6' } },
  { code: 'G1.2', topic: 'G1', text: 'Confirmed incidents of corruption or bribery', type: 'number', unit: 'count', refs: { esrs: 'G1-4', gri: '205-3', adx: 'G6' } },
  { code: 'G1.3', topic: 'G1', text: 'Whistleblowing channel open to employees and third parties', type: 'yesno', refs: { esrs: 'G1-1', gri: '2-26' } },
  { code: 'G1.4', topic: 'G1', text: 'Average days to pay suppliers', type: 'number', unit: 'days', refs: { esrs: 'G1-6' } },
  { code: 'G1.5', topic: 'G1', text: 'Women on the board', type: 'percent', refs: { esrs: 'GOV-1', gri: '2-9, 405-1', adx: 'G1' } },
  { code: 'G1.6', topic: 'G1', text: 'Independent board members', type: 'percent', refs: { esrs: 'GOV-1', gri: '2-9', adx: 'G2' } },
  { code: 'G1.7', topic: 'G1', text: 'Sustainability report externally assured', type: 'yesno', refs: { esrs: 'Assurance', gri: '2-5', adx: 'G10' } },
  // ---- industry-specific
  { code: 'WM.1', topic: 'E5', industry: 'waste', text: 'Waste collected and handled for customers', type: 'number', unit: 't', refs: { sasb: 'Waste management: activity metric' } },
  { code: 'WM.2', topic: 'E5', industry: 'waste', text: 'Share of handled waste recycled, composted or recovered (diverted from landfill)', type: 'percent', refs: { esrs: 'E5-5', gri: '306-4' } },
  { code: 'WM.3', topic: 'E1', industry: 'waste', text: 'Landfill gas captured and flared or used for energy', type: 'number', unit: 'm³', refs: { esrs: 'E1-6', sasb: 'Landfill emissions' } },
  { code: 'WM.4', topic: 'E2', industry: 'waste', text: 'Leachate or groundwater contamination incidents at landfills', type: 'number', unit: 'count', refs: { esrs: 'E2-4' } },
  { code: 'WM.5', topic: 'E1', industry: 'waste', text: 'Electricity generated from waste-to-energy', type: 'number', unit: 'MWh', refs: { esrs: 'E1-5', gri: '302-1' } },
  { code: 'UT.1', topic: 'E1', industry: 'utilities', text: 'Electricity generated by source (gas, solar, wind, other)', type: 'text', refs: { esrs: 'E1-5', sasb: 'Electric utilities: generation mix' } },
  { code: 'UT.2', topic: 'E1', industry: 'utilities', text: 'Renewable share of generation capacity', type: 'percent', refs: { esrs: 'E1-5' } },
  { code: 'UT.3', topic: 'S4', industry: 'utilities', text: 'Customer interruptions (SAIDI, minutes per customer)', type: 'number', unit: 'minutes', refs: { sasb: 'Grid resiliency' } },
  { code: 'RE.1', topic: 'E1', industry: 'real_estate', text: 'Building energy intensity', type: 'number', unit: 'kWh/m²', refs: { esrs: 'E1-5', gri: '302-3', sasb: 'Real estate: energy' } },
  { code: 'RE.2', topic: 'E1', industry: 'real_estate', text: 'Floor area with a green building certification (LEED, Estidama, BREEAM)', type: 'percent', refs: { sasb: 'Real estate: certifications' } },
  { code: 'RE.3', topic: 'E5', industry: 'real_estate', text: 'Construction and demolition waste diverted from landfill', type: 'percent', refs: { esrs: 'E5-5', gri: '306-4' } },
  { code: 'RE.4', topic: 'S2', industry: 'real_estate', text: 'Contractor worker accommodation audited against welfare standards', type: 'percent', refs: { esrs: 'S2-4' } },
  { code: 'CM.1', topic: 'E1', industry: 'materials', text: 'Emissions intensity per tonne of product (cement, steel or aluminium)', type: 'number', unit: 'tCO₂e/t', refs: { esrs: 'E1-6', sasb: 'Construction materials / steel: GHG' } },
  { code: 'CM.2', topic: 'E1', industry: 'materials', text: 'Alternative fuels and scrap as a share of inputs', type: 'percent', refs: { esrs: 'E5-4' } },
  { code: 'CM.3', topic: 'E1', industry: 'materials', text: 'Share of sales to the EU subject to CBAM', type: 'percent', refs: { issb: 'S2 §10 (transition risk)' } },
  { code: 'OG.1', topic: 'E1', industry: 'oil_gas', text: 'Methane emissions intensity', type: 'percent', refs: { esrs: 'E1-6', sasb: 'Oil & gas: methane' } },
  { code: 'OG.2', topic: 'E1', industry: 'oil_gas', text: 'Hydrocarbons flared', type: 'number', unit: 'm³', refs: { sasb: 'Oil & gas: flaring' } },
  { code: 'OG.3', topic: 'E2', industry: 'oil_gas', text: 'Hydrocarbon spills (number and volume)', type: 'text', refs: { esrs: 'E2-4', gri: '306-3' } },
  { code: 'CH.1', topic: 'S1', industry: 'chemicals', text: 'Process safety events (Tier 1)', type: 'number', unit: 'count', refs: { sasb: 'Chemicals: process safety' } },
  { code: 'CH.2', topic: 'E2', industry: 'chemicals', text: 'Production containing substances of very high concern', type: 'percent', refs: { esrs: 'E2-5' } },
  { code: 'MI.1', topic: 'E4', industry: 'mining', text: 'Tailings storage facilities and their hazard rating', type: 'text', refs: { esrs: 'E4-5', sasb: 'Metals & mining: tailings' } },
  { code: 'MI.2', topic: 'E3', industry: 'mining', text: 'Water withdrawn in water-stressed regions', type: 'number', unit: 'm³', refs: { esrs: 'E3-4', gri: '303-3' } },
  { code: 'MF.1', topic: 'E1', industry: 'manufacturing', text: 'Energy used per unit of output', type: 'number', unit: 'MWh/unit', refs: { gri: '302-3' } },
  { code: 'MF.2', topic: 'E5', industry: 'manufacturing', text: 'Products designed for recyclability or take-back', type: 'percent', refs: { esrs: 'E5-5' } },
  { code: 'TL.1', topic: 'E1', industry: 'transport', text: 'Fleet fuel consumed', type: 'number', unit: 'litres', refs: { gri: '302-1', sasb: 'Transport: fuel' } },
  { code: 'TL.2', topic: 'E1', industry: 'transport', text: 'Electric or alternative-fuel vehicles in the fleet', type: 'percent', refs: { esrs: 'E1-3' } },
  { code: 'TL.3', topic: 'S1', industry: 'transport', text: 'Serious road traffic incidents', type: 'number', unit: 'count', refs: { sasb: 'Road transport: safety' } },
  { code: 'HO.1', topic: 'E3', industry: 'hospitality', text: 'Water used per guest-night', type: 'number', unit: 'L', refs: { gri: '303-5' } },
  { code: 'HO.2', topic: 'E5', industry: 'hospitality', text: 'Food waste per cover or guest-night', type: 'number', unit: 'kg', refs: { esrs: 'E5-5' } },
  { code: 'HC.1', topic: 'E5', industry: 'healthcare', text: 'Medical (clinical) waste generated', type: 'number', unit: 't', refs: { esrs: 'E5-5', gri: '306-3' } },
  { code: 'HC.2', topic: 'S4', industry: 'healthcare', text: 'Patient safety incidents reported', type: 'number', unit: 'count', refs: { esrs: 'S4-4' } },
  { code: 'FA.1', topic: 'E3', industry: 'food', text: 'Water used in agriculture or processing in water-stressed areas', type: 'number', unit: 'm³', refs: { esrs: 'E3-4' } },
  { code: 'FA.2', topic: 'E4', industry: 'food', text: 'Raw materials certified as sustainably sourced', type: 'percent', refs: { esrs: 'E4-5' } },
  { code: 'RC.1', topic: 'E5', industry: 'retail', text: 'Packaging that is recyclable, reusable or compostable', type: 'percent', refs: { esrs: 'E5-5' } },
  { code: 'RC.2', topic: 'S4', industry: 'retail', text: 'Product recalls', type: 'number', unit: 'count', refs: { gri: '416-2' } },
  { code: 'TT.1', topic: 'E1', industry: 'tech', text: 'Data centre power usage effectiveness (PUE)', type: 'number', unit: 'PUE', refs: { sasb: 'Software & IT: data centres' } },
  { code: 'TT.2', topic: 'S4', industry: 'tech', text: 'Data breaches affecting customers', type: 'number', unit: 'count', refs: { gri: '418-1' } },
  { code: 'FI.1', topic: 'E1', industry: 'financial', text: 'Financed emissions (PCAF), where measured', type: 'number', unit: 'tCO₂e', refs: { esrs: 'E1-6', issb: 'S2 §29(a)(vi)(2)' } },
  { code: 'FI.2', topic: 'E1', industry: 'financial', text: 'Green or sustainability-linked financing provided', type: 'number', unit: 'currency', refs: { issb: 'S2 §29(f)' } },
  { code: 'PS.1', topic: 'S1', industry: 'services', text: 'Employee engagement score', type: 'percent', refs: { esrs: 'S1-2' } },
  { code: 'PS.2', topic: 'S4', industry: 'services', text: 'Information security management certified (ISO 27001)', type: 'yesno', refs: { gri: '418' } },
];

export interface ImpactIn { type?: 'actual' | 'potential'; nature?: 'negative' | 'positive'; scale?: number; scope?: number; irremediability?: number; likelihood?: number; humanRights?: boolean }
export interface FinIn { kind?: 'risk' | 'opportunity'; magnitude?: number; likelihood?: number }
const v = (x: number | undefined) => (x != null && x >= 1 && x <= 5 ? x : null);
const mean = (xs: (number | null)[]) => { const ok = xs.filter((x): x is number => x != null); return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null; };
export function impactScore(i: ImpactIn | null | undefined): number | null {
  if (!i) return null;
  const sev = i.nature === 'positive' ? mean([v(i.scale), v(i.scope)]) : mean([v(i.scale), v(i.scope), v(i.irremediability)]);
  if (sev == null) return null;
  if (i.type !== 'potential' || (i.humanRights && i.nature !== 'positive')) return Math.round(sev * 100) / 100;
  const l = v(i.likelihood);
  return l == null ? null : Math.round(((sev * l) / 5) * 100) / 100;
}
export function financialScore(f: FinIn | null | undefined): number | null {
  if (!f) return null;
  const m = v(f.magnitude), l = v(f.likelihood);
  return m == null || l == null ? null : Math.round(((m * l) / 5) * 100) / 100;
}
/** What the chosen frameworks need from the assessment. */
export function needs(codes: string[]) {
  const sel = FRAMEWORKS.filter((f) => codes.includes(f.code));
  const impact = sel.some((f) => f.materiality === 'double' || f.materiality === 'impact');
  const financial = sel.some((f) => f.materiality === 'double' || f.materiality === 'financial');
  return { impact, financial, double: sel.some((f) => f.materiality === 'double'), recommended: !impact && !financial && sel.length > 0 };
}
/** Questions for an industry and a set of topics (general questions of the topics + the industry's own). */
export const questionsFor = (industry: string | null, topics: string[]) => QUESTIONS.filter((q) => topics.includes(q.topic) && (!q.industry || q.industry === industry));
