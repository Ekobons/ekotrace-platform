/** Every SME page: its menu section, title, icon and one-line description. Paths are /sme/<key>. */
export const SME_PAGES: Record<string, { title: string; sub: string; icon: string }> = {
  home: { title: 'Overview', sub: 'Your snapshot', icon: 'home' },
  profile: { title: 'Profile', sub: 'About your company', icon: 'building' },
  applies: { title: 'What applies', sub: 'Rules for you', icon: 'list' },
  emissions: { title: 'Emissions', sub: 'Scope 1, 2, 3', icon: 'flame' },
  esg: { title: 'ESG', sub: 'Readiness score', icon: 'gauge' },
  srmm: { title: 'SRMM', sub: 'ICAI maturity level', icon: 'target' },
  footprint: { title: 'Product footprint', sub: 'Per product', icon: 'scale' },
  certs: { title: 'Certifications', sub: 'ZED, ISO', icon: 'shield' },
  bills: { title: 'Bill analyser', sub: 'Power bill savings', icon: 'bolt' },
  solar: { title: 'Solar', sub: 'Rooftop payback', icon: 'spark' },
  schemes: { title: 'Schemes', sub: 'Subsidies for you', icon: 'book' },
  scrap: { title: 'Scrap market', sub: 'Sell waste', icon: 'cycle' },
  credits: { title: 'Carbon credits', sub: 'Pooled projects', icon: 'leaf' },
  calendar: { title: 'Calendar', sub: 'Due dates', icon: 'calendar' },
  epr: { title: 'EPR', sub: 'Plastic, e-waste', icon: 'bin' },
  dpdp: { title: 'DPDP', sub: 'Data privacy', icon: 'lock' },
  people: { title: 'People & safety', sub: 'Safety, POSH, QR', icon: 'users' },
  csr: { title: 'CSR', sub: '2% spend', icon: 'drop' },
  cbam: { title: 'CBAM', sub: 'EU & UK', icon: 'truck' },
  eudr: { title: 'EUDR', sub: 'Deforestation', icon: 'tree' },
  scan: { title: 'Bill scan', sub: 'PDF to data', icon: 'upload' },
  questionnaire: { title: 'Questionnaire', sub: 'Auto-answer', icon: 'paste' },
  whatsapp: { title: 'WhatsApp', sub: 'Chat & reminders', icon: 'chat' },
  share: { title: 'Share & validate', sub: 'Consent, CA', icon: 'feed' },
  loan: { title: 'Green loan', sub: 'Bank pack', icon: 'doc' },
};
export interface SmeGroup { key: string; title: string; sub: string; icon: string; color: string; soft: string; pages: string[] }
/** Sections of the tool: one menu entry each; their pages are tabs at the top of the page. */
export const SME_GROUPS: SmeGroup[] = [
  { key: 'home', title: 'Home', sub: 'Your snapshot', icon: 'home', color: '#0E7C66', soft: '#E3F3EC', pages: ['home'] },
  { key: 'carbon', title: 'Carbon & ESG', sub: 'Your footprint and scores', icon: 'leaf', color: '#0E7C66', soft: '#E1F2EA', pages: ['profile', 'applies', 'emissions', 'esg', 'srmm', 'footprint', 'certs'] },
  { key: 'save', title: 'Save money', sub: 'Lower bills, earn more', icon: 'bolt', color: '#A86207', soft: '#FBEFD9', pages: ['bills', 'solar', 'schemes', 'scrap', 'credits'] },
  { key: 'comply', title: 'Compliance', sub: 'Dates and checklists', icon: 'calendar', color: '#1F5F99', soft: '#E2EEF8', pages: ['calendar', 'epr', 'dpdp', 'people', 'csr'] },
  { key: 'export', title: 'Exports', sub: 'EU and UK rules', icon: 'truck', color: '#6B46B0', soft: '#EEE7F8', pages: ['cbam', 'eudr'] },
  { key: 'ai', title: 'Quick tools', sub: 'Scan, answer, remind', icon: 'paste', color: '#4E7A12', soft: '#ECF4DE', pages: ['scan', 'questionnaire', 'whatsapp'] },
  { key: 'share', title: 'Share', sub: 'Buyers, banks, your CA', icon: 'feed', color: '#B23A64', soft: '#F9E4EC', pages: ['share', 'loan'] },
];
export const groupOf = (page: string) => SME_GROUPS.find((g) => g.pages.includes(page)) ?? SME_GROUPS[0]!;

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Whether a page matters for this company, from its Profile answers: pages that do not are tucked away
 * (still one click away under "Show all") so a small company is not faced with rules that are not theirs.
 */
export function relevant(page: string, data: Record<string, any> | undefined, results: Record<string, any> | undefined): boolean {
  const p = data?.profile ?? {};
  switch (page) {
    case 'cbam': return !!(p.euExport || p.ukExport);
    case 'eudr': return !!p.eudr && p.eudr !== 'none';
    case 'epr': return !!(p.plastics || p.ewaste || p.battery);
    case 'csr': return !!results?.csr?.applies;
    default: return true;
  }
}
