/**
 * App shell: login gate, prototype sidebar (by role), company context, routes.
 */
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, currentTenant, setTenant, whenLoggedOut, ROLE_LABEL, type Company, type Me, type Role } from './lib/api';
import { Icon } from './components/Icon';
import { FieldApp } from './pages/FieldApp';
import { Assurance } from './pages/Assurance';
import { ContractorPortal } from './pages/ContractorPortal';
import { ScanPage } from './pages/ScanPage';
import { Login, ChangePassword } from './pages/Login';
import { AddData } from './pages/AddData';
import { Entries } from './pages/Entries';
import { Library } from './pages/Library';
import { Updates } from './pages/Updates';
import { Organisation } from './pages/Organisation';
import { UaeMrv } from './pages/UaeMrv';
import { People } from './pages/People';
import { Methodology } from './pages/Methodology';
import { EnergyRegister } from './pages/EnergyRegister';
import { PurchaseBatchPage, Purchases } from './pages/Purchases';
import { PublishedPurchasesPage } from './pages/PublishedPurchases';
import { Suppliers } from './pages/Suppliers';
import { Home } from './pages/Home';
import { Kpis } from './pages/Kpis';
import { Targets } from './pages/Targets';
import { Approvals } from './pages/Approvals';
import { DataProgress } from './pages/DataProgress';
import { Reports } from './pages/Reports';
import { Dashboards } from './pages/Dashboards';
import { Currencies } from './pages/Currencies';
import { AuditLog } from './pages/AuditLog';
import { Meters } from './pages/Meters';
import { Bills } from './pages/Bills';
import { Integrations } from './pages/Integrations';
import { Manual } from './pages/Manual';
import { Console } from './pages/Console';
import { Vault } from './pages/Vault';
import { MfaCard, MfaSetup } from './components/MfaSetup';
import { Messages } from './pages/Messages';
import { SurveyAnswerPage } from './pages/SurveyAnswer';
import { Surveys } from './pages/Surveys';
import { MetricRegistry } from './pages/MetricRegistry';
import { CarbonCredits } from './pages/CarbonCredits';
import { Ccts } from './pages/Ccts';
import { Brsr } from './pages/Brsr';
import { ProductLca } from './pages/ProductLca';
import { Cbam } from './pages/Cbam';
import { CbamPrint } from './pages/CbamComm';
import { CbamReporting } from './pages/CbamPackage';
import { CbamAnswer, CbamForecast, CbamHomeByRole, CbamLibrary, CbamSettings, CbamSuppliers, useCbamRole } from './pages/CbamTool';
import { CbamCalculator, CbamSignup, CbamStart, CbamSupplierPage } from './pages/CbamPublic';
import { Esg } from './pages/Esg';
import { AiSettingsPage } from './pages/AiSettings';
import { SmartImport } from './pages/SmartImport';
import { BatchRuns } from './pages/BatchRuns';
import { SupplierPortal } from './pages/SupplierPortal';
import { CollectionCalendar } from './pages/CollectionCalendar';
import { Inbox } from './pages/Inbox';
import { BrandMark } from './components/BrandMark';
import { BRAND, productName } from './lib/brand';
import { FinDashboard } from './pages/fin/FinDashboard';
import { FinPortfolios } from './pages/fin/FinPortfolios';
import { FinCounterparties, FinCounterpartyProfile } from './pages/fin/FinCounterparties';
import { FinFactors } from './pages/fin/FinFactors';

interface Ctx {
  me: Me;
  role: Role;
  tenant: Me['company'];
  reload: () => Promise<void>;
  toast: (msg: string) => void;
  can: (...roles: Role[]) => boolean;
}
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

type Tab = { to: string; label: string; roles?: Role[] };
/** A menu entry; with `tabs`, one entry for several pages shown as tabs at the top of each (old links keep working). */
type NavItem = { to?: string; label: string; icon: string; roles?: Role[]; stage?: number; tabs?: Tab[]; product?: Product };
/** Section colours of the side menu, as in the prototype. */
const SEC_C: Record<string, string> = { Importing: '#8EC5FF', Exporting: '#7FD3B9', Knowledge: '#F2C46D', '': 'var(--lime)', Portfolio: '#8EC5FF', Capture: '#7FD3B9', Analyse: '#8EC5FF', 'Value chain': '#F2C46D', 'Net zero': '#B6E36B', Disclose: '#C9A7F5', Setup: '#E7ECEA', Help: '#F7A8B8' };
/** EKOFIN (financed emissions): its own menu; people, currencies, documents and the audit log are shared with EKOTRACE. */
const FIN_NAV: { group?: string; items: NavItem[] }[] = [
  { items: [{ to: '/fin', label: 'Portfolio dashboard', icon: 'chart' }] },
  { group: 'Portfolio', items: [
    { to: '/fin/portfolios', label: 'Portfolios & holdings', icon: 'folder' },
    { to: '/fin/counterparties', label: 'Counterparties', icon: 'building' },
  ] },
  { group: 'Setup', items: [
    { to: '/fin/factors', label: 'Sector factor library', icon: 'book' },
    { to: '/people', label: 'People & access', icon: 'users', roles: ['super_admin', 'admin', 'manager'] },
    { to: '/currency', label: 'Currencies', icon: 'bolt', roles: ['super_admin', 'admin', 'manager', 'verifier'] },
    { to: '/vault', label: 'Document vault', icon: 'folder' },
    { to: '/audit', label: 'Security & audit log', icon: 'lock', roles: ['super_admin', 'admin', 'verifier'] },
  ] },
  { group: 'Help', items: [{ to: '/help', label: 'User manual', icon: 'book' }] },
];
/** CBAM Exporter: the simpler menu of a CBAM-only company. */
/** CBAM tool: its own menu, by the company's role in CBAM (importer, exporter or both). */
function cbamNav(role: 'importer' | 'exporter' | 'both'): { group?: string; items: NavItem[] }[] {
  const imp = role !== 'exporter', exp = role !== 'importer';
  return [
    { items: [{ to: '/cbam/home', label: 'CBAM home', icon: 'home' }] },
    ...(imp ? [{ group: 'Importing', items: [
      { to: '/cbam/imports', label: 'Imports & declaration', icon: 'upload' },
      { to: '/cbam/suppliers', label: 'Suppliers & requests', icon: 'users' },
      { to: '/cbam/forecast', label: 'Cost forecast', icon: 'chart' },
    ] as NavItem[] }] : []),
    ...(exp ? [{ group: 'Exporting', items: [
      { to: '/cbam/comms', label: 'Communications to importers', icon: 'doc' },
      { to: '/cbam/answer', label: 'Answer a request', icon: 'inbox' },
      { to: '/cbam/installations', label: 'Installations', icon: 'building' },
      { to: '/cbam/precursors', label: 'Precursor suppliers', icon: 'truck' },
      { to: '/cbam/reporting', label: 'Reports', icon: 'grid' },
      { to: '/cbam/annual', label: 'Annual emissions report', icon: 'shield', roles: ['super_admin', 'admin', 'manager', 'verifier'] },
    ] as NavItem[] }] : []),
    { group: 'Knowledge', items: [
      { to: '/cbam/library', label: 'CN codes & rules', icon: 'book' },
      { to: '/cbam/calculator', label: 'Cost calculator', icon: 'scale' },
      { to: '/cbam/reference', label: 'Default values & benchmarks', icon: 'list' },
    ] },
    { group: 'Setup', items: [
      { to: '/cbam/settings', label: 'CBAM settings', icon: 'gear' },
      { to: '/people', label: 'People & access', icon: 'users', roles: ['super_admin', 'admin', 'manager'] },
      { to: '/vault', label: 'Document vault', icon: 'folder' },
      { to: '/audit', label: 'Security & audit log', icon: 'lock', roles: ['super_admin', 'admin', 'verifier'] },
    ] },
    { group: 'Help', items: [{ to: '/help', label: 'User manual', icon: 'book' }] },
  ];
}
/** India CCTS, BRSR Core or UAE MRV without EKOTRACE: a small menu of its own (with EKOTRACE they sit in its Disclose menu). */
function packNav(p: 'ccts' | 'brsr' | 'uaemrv'): { group?: string; items: NavItem[] }[] {
  return [
    { items: [p === 'ccts' ? { to: '/ccts', label: 'India CCTS', icon: 'gauge' } : p === 'brsr' ? { to: '/brsr', label: 'BRSR Core', icon: 'list' } : { to: '/uae-mrv', label: 'UAE MRV', icon: 'shield' }] },
    { group: 'Setup', items: [
      { to: '/organisation', label: 'Organisation', icon: 'tree', roles: ['super_admin', 'admin'] },
      { to: '/people', label: 'People & access', icon: 'users', roles: ['super_admin', 'admin', 'manager'] },
      { to: '/vault', label: 'Document vault', icon: 'folder' },
      { to: '/audit', label: 'Security & audit log', icon: 'lock', roles: ['super_admin', 'admin', 'verifier'] },
    ] },
    { group: 'Help', items: [{ to: '/help', label: 'User manual', icon: 'book' }] },
  ];
}
type Product = 'ekotrace' | 'ekofin' | 'cbam' | 'ccts' | 'brsr' | 'uaemrv';
const HOME: Record<Product, string> = { ekotrace: '/home', ekofin: '/fin', cbam: '/cbam/home', ccts: '/ccts', brsr: '/brsr', uaemrv: '/uae-mrv' };
const SHORT: Record<Product, string> = { ekotrace: 'TRC', ekofin: 'FIN', cbam: 'CBM', ccts: 'CCT', brsr: 'BRS', uaemrv: 'MRV' };
/** Packages that sit inside EKOTRACE's Disclose menu when the company has EKOTRACE. */
const ADDONS: Product[] = ['ccts', 'brsr', 'uaemrv'];
/** Short side-menu name of the financed-emissions factor library (EKOFIN EFs / Financed EFs). */
const FIN_EF = productName('ekofin') === 'EKOFIN' ? 'EKOFIN EFs' : 'Financed EFs';
const PRODUCT_NAME: Record<Product, string> = new Proxy({} as Record<Product, string>, { get: (_t, p) => productName(p as Product) });
const EKO_NAV: { group?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/home', label: 'Home', icon: 'home' },
    { label: 'Dashboards', icon: 'chart', tabs: [{ to: '/dashboards', label: 'Dashboards' }, { to: '/kpis', label: 'KPI dashboard' }] },
  ] },
  { group: 'Capture', items: [
    { to: '/data/stationary_combustion', label: 'Add data', icon: 'plus', roles: ['super_admin', 'admin', 'manager', 'preparer'] },
    { to: '/import', label: 'Smart import', icon: 'upload', roles: ['super_admin', 'admin', 'manager', 'preparer'] },
    { label: 'Entries & approvals', icon: 'check', tabs: [{ to: '/entries', label: 'Entries & results' }, { to: '/approvals', label: 'Approvals', roles: ['super_admin', 'admin', 'manager', 'preparer'] }] },
    { label: 'Data progress', icon: 'grid', tabs: [{ to: '/progress', label: 'Data progress' }, { to: '/calendar', label: 'Collection calendar' }] },
    { label: 'Inbox & messages', icon: 'inbox', tabs: [{ to: '/inbox', label: 'Inbox & to-dos' }, { to: '/messages', label: 'Message centre' }] },
    { to: '/surveys', label: 'Surveys', icon: 'users', roles: ['super_admin', 'admin', 'manager', 'verifier'] },
    { to: '/vault', label: 'Document vault', icon: 'folder' },
    { to: '/qr', label: 'QR & field app', icon: 'qr', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'] },
  ] },
  { group: 'Value chain', items: [
    { to: '/suppliers', label: 'Suppliers', icon: 'users', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'] },
    { to: '/lca', label: 'Product LCA', icon: 'leaf', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'] },
  ] },
  { group: 'Net zero', items: [{ to: '/targets', label: 'Targets & actions', icon: 'target' }, { to: '/credits', label: 'Carbon credits', icon: 'leaf' }] },
  { group: 'Disclose', items: [{ to: '/reports', label: 'Reports', icon: 'doc' }, { to: '/cbam', label: 'CBAM', icon: 'scale', roles: ['super_admin', 'admin', 'manager', 'verifier'] }, { to: '/ccts', label: 'India CCTS', icon: 'gauge', roles: ['super_admin', 'admin', 'manager', 'verifier'], product: 'ccts' }, { to: '/brsr', label: 'BRSR Core', icon: 'list', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'], product: 'brsr' }, { to: '/uae-mrv', label: 'UAE MRV', icon: 'shield', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'], product: 'uaemrv' }, { to: '/esg', label: 'ESG & materiality', icon: 'grid', roles: ['super_admin', 'admin', 'manager', 'verifier'] }, { to: '/assurance', label: 'Audit & assurance', icon: 'shield', roles: ['super_admin', 'admin', 'manager', 'verifier'] }] },
  { group: 'Setup', items: [
    { to: '/organisation', label: 'Organisation & groups', icon: 'tree' },
    { to: '/people', label: 'People & access', icon: 'users', roles: ['super_admin', 'admin', 'manager'] },
    { label: 'Methodology & metrics', icon: 'scale', tabs: [{ to: '/methodology', label: 'Methodology & boundaries', roles: ['super_admin', 'admin', 'verifier'] }, { to: '/metrics', label: 'Metric registry' }] },
    { label: 'Energy & currency data', icon: 'bolt', tabs: [{ to: '/energy', label: 'Energy certificates & suppliers', roles: ['super_admin', 'admin', 'manager', 'verifier'] }, { to: '/currency', label: 'Currencies & price index', roles: ['super_admin', 'admin', 'manager', 'verifier'] }] },
    { to: '/library', label: 'Factors & dictionary', icon: 'book', roles: [] },
    { label: 'Integrations, AI & batch runs', icon: 'plug', tabs: [{ to: '/integrations', label: 'Integrations & API', roles: ['super_admin', 'admin'] }, { to: '/batches', label: 'Batch runs', roles: ['super_admin', 'admin', 'manager', 'verifier'] }, { to: '/ai', label: 'AI', roles: ['super_admin'] }] },
    { to: '/audit', label: 'Security & audit log', icon: 'lock', roles: ['super_admin', 'admin', 'verifier'] },
  ] },
  { group: 'Help', items: [{ to: '/help', label: 'User manual', icon: 'book' }] },
];

export function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const [mustChange, setMustChange] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setMe(await api.me()); setMustChange(false); }
    catch (e) { const code = (e as { code?: string }).code; if (code === 'MUST_CHANGE_PASSWORD') setMustChange(true); setMe(null); }
  }, []);
  // public pages (survey, contractor and supplier portals) have no staff session to look up
  const isPublic = ['/survey', '/contractor', '/supplier', '/cbam-signup', '/cbam-start', '/cbam-supplier', '/cbam-calculator'].includes(window.location.pathname);
  useEffect(() => { whenLoggedOut(() => setMe(null)); if (!isPublic) reload(); }, [reload, isPublic]);
  useEffect(() => {
    api.brand().then((b) => { document.title = b.productName ?? b.name; if (b.colors?.primary) document.documentElement.style.setProperty('--primary', b.colors.primary); }).catch(() => {});
  }, []);

  const toast = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3500); };
  // employees answering a survey: no sign-in
  if (window.location.pathname === '/survey') return <SurveyAnswerPage />;
  // waste contractors: email + access code, no user account
  if (window.location.pathname === '/contractor') return <ContractorPortal />;
  // suppliers answering a data request: email + access code, no user account
  if (window.location.pathname === '/supplier') return <SupplierPortal />;
  // the CBAM tool's open pages: sign-up, confirmation, suppliers answering a request, the free calculator
  if (window.location.pathname === '/cbam-signup') return <CbamSignup />;
  if (window.location.pathname === '/cbam-start') return <CbamStart />;
  if (window.location.pathname === '/cbam-supplier') return <CbamSupplierPage />;
  if (window.location.pathname === '/cbam-calculator') return <CbamCalculator />;
  if (me === 'loading') return <div className="empty">Loading…</div>;
  if (me === null) return <Login onDone={reload} />;
  if (me.user.mustChangePassword || mustChange) return <ChangePassword forced onDone={reload} />;
  if (me.user.mfaEnrol) return <MfaSetup forced onDone={reload} />;

  const role = me.user.role;
  const can = (...roles: Role[]) => role === 'platform_admin' || roles.includes(role);
  return (
    <AppCtx.Provider value={{ me, role, tenant: me.company, reload, toast, can }}>
      <Shell />
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}

function Shell() {
  const { me, role, tenant, reload, can } = useApp();
  const nav = useNavigate();
  const path = useLocation().pathname;
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => { if (role === 'platform_admin') api.companies().then((c) => setCompanies(c.companies)).catch(() => {}); }, [role, tenant?.id]);

  const choose = async (id: string) => { setTenant(id || null); await reload(); nav('/'); };
  const logout = async () => { await api.logout().catch(() => {}); setTenant(null); location.href = '/'; };
  const [folded, setFolded] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('eko_nav') ?? '[]') as string[]); } catch { return new Set(); } });
  // the whole menu narrowed to icons (as in the prototype), kept on this browser
  const [mini, setMini] = useState(() => { try { return localStorage.getItem('eko_mini') === '1'; } catch { return false; } });
  const toggleMini = () => setMini((m) => { try { localStorage.setItem('eko_mini', m ? '0' : '1'); } catch { /* not kept */ } return !m; });
  // the products this company has (EKOTRACE, EKOFIN or both) and the one being used, kept on this browser
  // packages the company has; with EKOTRACE, India CCTS and BRSR Core live in its Disclose menu rather than as workspaces
  const owned: Product[] = (tenant?.products?.length ? tenant.products : ['ekotrace']) as Product[];
  const products: Product[] = owned.includes('ekotrace') ? owned.filter((p) => !ADDONS.includes(p)) : owned;
  const [picked, setPicked] = useState<Product>(() => { try { return (localStorage.getItem('eko_product') as Product) || 'ekotrace'; } catch { return 'ekotrace'; } });
  const product: Product = path.startsWith('/fin') && products.includes('ekofin') ? 'ekofin' : path.startsWith('/ccts') && products.includes('ccts') ? 'ccts' : path.startsWith('/brsr') && products.includes('brsr') ? 'brsr' : path.startsWith('/uae-mrv') && products.includes('uaemrv') ? 'uaemrv' : path.startsWith('/cbam/') && products.includes('cbam') && (picked === 'cbam' || !products.includes('ekotrace')) ? 'cbam' : products.includes(picked) ? picked : products[0]!;
  const cbamRole = useCbamRole(product === 'cbam');
  const NAV = product === 'ekofin' ? FIN_NAV : product === 'cbam' ? cbamNav(cbamRole ?? 'both') : product === 'ccts' || product === 'brsr' || product === 'uaemrv' ? packNav(product) : EKO_NAV;
  const switchTo = (p: Product) => { setPicked(p); try { localStorage.setItem('eko_product', p); } catch { /* not kept */ } nav(HOME[p]); };
  const allGroups = NAV.flatMap((g) => (g.group ? [g.group] : []));
  const allClosed = allGroups.every((g) => folded.has(g));
  const foldAll = () => { const n = new Set(allClosed ? [] : allGroups); try { localStorage.setItem('eko_nav', JSON.stringify([...n])); } catch { /* not kept */ } setFolded(n); };
  const fold = (g: string) => setFolded((f) => { const n = new Set(f); if (n.has(g)) n.delete(g); else n.add(g); try { localStorage.setItem('eko_nav', JSON.stringify([...n])); } catch { /* not kept */ } return n; });
  // waiting for my approval: the count on the Approvals menu item (refreshed as you move around)
  const [apprN, setApprN] = useState(0);
  useEffect(() => { if (!tenant || !['super_admin', 'admin', 'manager', 'platform_admin'].includes(role)) { setApprN(0); return; } api.approvals().then((a) => setApprN(a.mine.length)).catch(() => {}); }, [path, tenant?.id, role]); // eslint-disable-line react-hooks/exhaustive-deps
  // unread replies and announcements (company); conversations waiting for a reply (platform admin)
  const [msgN, setMsgN] = useState(0);
  useEffect(() => {
    const get = () => { if (!tenant && role !== 'platform_admin') return; api.msgCounts().then((c) => setMsgN(c.unread + c.announcements)).catch(() => {}); };
    get(); window.addEventListener('eko-msg', get); const t = window.setInterval(get, 120000);
    return () => { window.removeEventListener('eko-msg', get); window.clearInterval(t); };
  }, [path, tenant?.id, role]); // eslint-disable-line react-hooks/exhaustive-deps
  // inbox: unread notifications and open to-dos
  const [inboxN, setInboxN] = useState(0);
  useEffect(() => {
    const get = () => { if (!tenant) { setInboxN(0); return; } api.inboxCount().then((c) => setInboxN(c.unread + c.todo - c.approvals)).catch(() => {}); };
    get(); window.addEventListener('eko-inbox', get); const t = window.setInterval(get, 180000);
    return () => { window.removeEventListener('eko-inbox', get); window.clearInterval(t); };
  }, [path, tenant?.id, role]); // eslint-disable-line react-hooks/exhaustive-deps
  // weekly updates waiting for a decision (platform admin)
  const [updN, setUpdN] = useState(0);
  useEffect(() => {
    const get = () => { if (role !== 'platform_admin') { setUpdN(0); return; } api.updateCount().then((c) => setUpdN(c.open)).catch(() => {}); };
    get(); window.addEventListener('eko-updates', get); const t = window.setInterval(get, 300000);
    return () => { window.removeEventListener('eko-updates', get); window.clearInterval(t); };
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps
  // security alerts to review (super admin, admin; platform admin: platform alerts)
  const [alertN, setAlertN] = useState(0);
  useEffect(() => {
    const get = () => { if (!['super_admin', 'admin', 'platform_admin'].includes(role) || (!tenant && role !== 'platform_admin')) { setAlertN(0); return; } api.alertCount().then((c) => setAlertN(c.open)).catch(() => {}); };
    get(); window.addEventListener('eko-alerts', get); const t = window.setInterval(get, 120000);
    return () => { window.removeEventListener('eko-alerts', get); window.clearInterval(t); };
  }, [path, tenant?.id, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const allowed = (roles?: Role[]) => !roles || (roles.length === 0 ? role === 'platform_admin' : can(...roles));
  const tabsOf = (i: NavItem) => (i.tabs ?? []).filter((t) => allowed(t.roles));
  const visible = (i: NavItem) => (!i.product || owned.includes(i.product)) && (i.tabs ? tabsOf(i).length > 0 : allowed(i.roles));
  const labelOf = (i: NavItem) => (i.tabs && tabsOf(i).length === 1 ? tabsOf(i)[0]!.label : i.label);
  const hrefOf = (i: NavItem) => (i.tabs ? tabsOf(i)[0]?.to : i.to);
  const isOn = (i: NavItem) => (i.tabs ? tabsOf(i).some((t) => path === t.to) : !!i.to && (path === i.to || (i.to.startsWith('/data/') && path.startsWith('/data/'))));
  // the tabs at the top of a page that shares its menu entry with others
  const section = NAV.flatMap((g) => g.items).find((i) => i.tabs && tabsOf(i).some((t) => path === t.to));
  const badge = (to: string) => (to === '/approvals' ? apprN : to === '/messages' && role !== 'platform_admin' ? msgN : to === '/inbox' ? inboxN : 0);
  // a bin's QR label opens the scan page full screen (phone), without the menu
  if (path.startsWith('/scan/')) return <Routes><Route path="/scan/:code" element={<ScanPage />} /></Routes>;

  return (
    <div className={`app${mini ? ' mini' : ''}`}>
      <aside className="side">
        <div className="brand"><BrandMark /><div className="bt"><b>{BRAND.name}</b><small>{BRAND.tagline}</small></div>
          <button type="button" className="minibtn" onClick={toggleMini} aria-label={mini ? 'Expand the menu' : 'Collapse the menu'} title={mini ? 'Expand the menu' : 'Collapse the menu'}>{mini ? '»' : '«'}</button></div>
        <div className="org">
          {role === 'platform_admin' ? (
            <>
              <label>Viewing company</label>
              <select value={currentTenant() ?? ''} onChange={(e) => choose(e.target.value)} aria-label="Company">
                <option value="">— platform console —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </>
          ) : (
            <><b style={{ fontSize: 14 }}>{tenant?.name}</b><span style={{ fontSize: 11.5, color: 'var(--side-dim)' }}>{tenant?.planLimits?.name ?? tenant?.plan} plan{tenant?.scope_name ? ` · ${tenant.scope_name}` : ' · whole group'}</span></>
          )}
        </div>
        {tenant && products.length > 1 && (mini
          ? (() => { const next = products[(products.indexOf(product) + 1) % products.length]!; return <button type="button" className="prodmini" title={`Switch to ${PRODUCT_NAME[next]}`} onClick={() => switchTo(next)}>{SHORT[product]}</button>; })()
          : <div className="prodsw" role="tablist" aria-label="Product">{products.map((p) => <button key={p} type="button" role="tab" aria-selected={p === product} className={p === product ? 'on' : ''} onClick={() => p !== product && switchTo(p)}>{PRODUCT_NAME[p]}</button>)}</div>)}
        {tenant && !mini && <div className="navtools"><button type="button" onClick={foldAll} title={allClosed ? 'Expand all sections' : 'Collapse all sections'}>{allClosed ? '▸▸ Expand all' : '▾▾ Collapse all'}</button></div>}
        <nav className="nav">
          {role === 'platform_admin' && <NavLink to="/console" title={mini ? 'Platform console' : undefined}><Icon name="gear" /><span className="nl">Platform console</span>{!tenant && alertN > 0 && <span className="navb red" title="Platform security alerts">{alertN}</span>}</NavLink>}
          {role === 'platform_admin' && <NavLink to="/updates" title={mini ? 'Weekly updates' : undefined}><Icon name="feed" /><span className="nl">Weekly updates</span>{updN > 0 && <span className="navb amber" title="Updates and drafts to review">{updN}</span>}</NavLink>}
          {role === 'platform_admin' && <NavLink to="/library" title={mini ? 'Emission factors' : undefined}><Icon name="book" /><span className="nl">Emission factors</span></NavLink>}
          {role === 'platform_admin' && !tenant && <NavLink to="/fin/factors" title={mini ? FIN_EF : undefined}><Icon name="book" /><span className="nl">{FIN_EF}</span></NavLink>}
          {role === 'platform_admin' && <NavLink to="/messages" title={mini ? 'Messages' : undefined}><Icon name="chat" /><span className="nl">Messages</span>{msgN > 0 && <span className="navb amber">{msgN}</span>}</NavLink>}
          {tenant && NAV.map((g, gi) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            const sc = SEC_C[g.group ?? ''] ?? '#fff';
            const on = items.some(isOn);
            const open = mini || !g.group || !folded.has(g.group) || on;
            return (
              <div key={gi} className="navsec" style={{ '--sc': sc } as CSSProperties}>
                {g.group && <button type="button" className={`sech${open ? ' open' : ''}${on ? ' has' : ''}`} aria-expanded={open} title={g.group} onClick={() => !mini && fold(g.group!)}>
                  <i className="sdot" /><span>{g.group.toUpperCase()}</span><span className="chev">{open ? '▾' : '▸'}</span></button>}
                {open && <div className="secitems">{items.map((i) => hrefOf(i)
                  ? <NavLink key={i.label} to={hrefOf(i)!} title={mini ? labelOf(i) : undefined} className={() => (isOn(i) ? 'active' : '')}><Icon name={i.icon} /><span className="nl">{labelOf(i)}</span>
                    {(() => { const ts = i.tabs ? tabsOf(i).map((t) => t.to) : [i.to!]; const amber = ts.reduce((a, t) => a + badge(t), 0);
                      return <>{amber > 0 && <span className="navb amber" title={ts.includes('/approvals') ? 'Waiting for your approval' : 'Unread notices, things to do and messages'}>{amber}</span>}
                        {i.to === '/audit' && alertN > 0 && <span className="navb red" title="Security alerts to review">{alertN}</span>}</>; })()}</NavLink>
                  : <a key={i.label} className="soon" aria-disabled="true" title={`${i.label} · coming in stage ${i.stage}`}><Icon name={i.icon} /><span className="nl">{i.label}</span><span className="soonchip">S{i.stage}</span></a>)}</div>}
              </div>
            );
          })}
        </nav>
        <div className="sidefoot">
          <div className="who"><b>{me.user.name}</b><span>{ROLE_LABEL[role]}</span></div>
          <div className="row" style={{ gap: 6 }}>
            <NavLink to="/account" className="btn sm ghost" style={{ color: 'var(--side-fg)' }}>Password</NavLink>
            <button className="btn sm ghost" style={{ color: 'var(--side-fg)' }} onClick={logout}>Log out</button>
          </div>
        </div>
      </aside>
      <main className="main">
        {section && tabsOf(section).length > 1 && <nav className="sectabs" aria-label={section.label}>
          <span className="sectl"><Icon name={section.icon} size={16} />{section.label}</span>
          {tabsOf(section).map((t) => <NavLink key={t.to} to={t.to} className={() => (path === t.to ? 'on' : '')}>{t.label}{badge(t.to) > 0 && <span className="navb amber">{badge(t.to)}</span>}</NavLink>)}
        </nav>}
        <Routes>
          <Route path="/" element={<Navigate to={role === 'platform_admin' && !tenant ? '/console' : HOME[product]} replace />} />
          <Route path="/fin" element={<NeedFin><FinDashboard /></NeedFin>} />
          <Route path="/fin/portfolios" element={<NeedFin><FinPortfolios /></NeedFin>} />
          <Route path="/fin/counterparties" element={<NeedFin><FinCounterparties /></NeedFin>} />
          <Route path="/fin/counterparties/:id" element={<NeedFin><FinCounterpartyProfile /></NeedFin>} />
          <Route path="/fin/factors" element={role === 'platform_admin' && !tenant ? <FinFactors /> : <NeedFin><FinFactors /></NeedFin>} />
          <Route path="/console" element={<Gate ok={role === 'platform_admin'}><Console /></Gate>} />
          <Route path="/updates" element={<Gate ok={role === 'platform_admin'}><Updates /></Gate>} />
          <Route path="/messages" element={role === 'platform_admin' ? <Messages /> : <NeedCo><Messages /></NeedCo>} />
          <Route path="/vault" element={<NeedCo><Vault /></NeedCo>} />
          <Route path="/metrics" element={<NeedCo><MetricRegistry /></NeedCo>} />
          <Route path="/credits" element={<NeedCo><CarbonCredits /></NeedCo>} />
          <Route path="/ccts" element={<NeedCo><NeedPack has={owned.includes('ccts')} name="India CCTS"><Ccts /></NeedPack></NeedCo>} />
          <Route path="/brsr" element={<NeedCo><NeedPack has={owned.includes('brsr')} name="BRSR Core"><Brsr /></NeedPack></NeedCo>} />
          <Route path="/uae-mrv" element={<NeedCo><NeedPack has={owned.includes('uaemrv')} name="UAE MRV"><UaeMrv /></NeedPack></NeedCo>} />
          <Route path="/lca" element={<NeedCo><ProductLca /></NeedCo>} />
          <Route path="/cbam" element={product === 'cbam' ? <Navigate to="/cbam/home" replace /> : <NeedCo><Cbam /></NeedCo>} />
          <Route path="/cbam/home" element={<NeedCbam><CbamHomeByRole /></NeedCbam>} />
          <Route path="/cbam/imports" element={<NeedCbam><Cbam only="imports" /></NeedCbam>} />
          <Route path="/cbam/suppliers" element={<NeedCbam><CbamSuppliers /></NeedCbam>} />
          <Route path="/cbam/precursors" element={<NeedCbam><CbamSuppliers kind="precursor" /></NeedCbam>} />
          <Route path="/cbam/forecast" element={<NeedCbam><CbamForecast /></NeedCbam>} />
          <Route path="/cbam/library" element={<NeedCbam><CbamLibrary /></NeedCbam>} />
          <Route path="/cbam/calculator" element={<NeedCbam><div className="page"><CbamCalculator embedded /></div></NeedCbam>} />
          <Route path="/cbam/settings" element={<NeedCbam><CbamSettings /></NeedCbam>} />
          <Route path="/cbam/answer" element={<NeedCbam><CbamAnswer /></NeedCbam>} />
          <Route path="/cbam/print/:id" element={<NeedCbam><PrintRoute /></NeedCbam>} />
          <Route path="/cbam/comms" element={<NeedCbam><Cbam only="comms" /></NeedCbam>} />
          <Route path="/cbam/installations" element={<NeedCbam><Cbam only="installations" /></NeedCbam>} />
          <Route path="/cbam/annual" element={<NeedCbam><Cbam only="reports" /></NeedCbam>} />
          <Route path="/cbam/reference" element={<NeedCbam><Cbam only="reference" /></NeedCbam>} />
          <Route path="/cbam/reporting" element={<NeedCbam><CbamReporting /></NeedCbam>} />
          <Route path="/esg" element={<NeedCo><Esg /></NeedCo>} />
          <Route path="/ai" element={<NeedCo><AiSettingsPage /></NeedCo>} />
          <Route path="/import" element={<NeedCo><SmartImport /></NeedCo>} />
          <Route path="/import/:id" element={<NeedCo><SmartImport /></NeedCo>} />
          <Route path="/batches" element={<NeedCo><BatchRuns /></NeedCo>} />
          <Route path="/calendar" element={<NeedCo><CollectionCalendar /></NeedCo>} />
          <Route path="/inbox" element={<NeedCo><Inbox onSeen={() => window.dispatchEvent(new Event('eko-inbox'))} /></NeedCo>} />
          <Route path="/account" element={<div className="page"><div className="acctgrid"><ChangePassword onDone={() => nav('/')} /><MfaCard /></div></div>} />
          <Route path="/library/*" element={<Gate ok={role === 'platform_admin'}><Library /></Gate>} />
          <Route path="/data/:category" element={<NeedCo><AddData /></NeedCo>} />
          <Route path="/home" element={<NeedCo><Home /></NeedCo>} />
          <Route path="/kpis" element={<NeedCo><Kpis /></NeedCo>} />
          <Route path="/targets" element={<NeedCo><Targets /></NeedCo>} />
          <Route path="/qr" element={<NeedCo><FieldApp /></NeedCo>} />
          <Route path="/approvals" element={<NeedCo><Approvals /></NeedCo>} />
          <Route path="/progress" element={<NeedCo><DataProgress /></NeedCo>} />
          <Route path="/assurance" element={<NeedCo><Assurance /></NeedCo>} />
          <Route path="/reports" element={<NeedCo><Reports /></NeedCo>} />
          <Route path="/dashboards" element={<NeedCo><Dashboards /></NeedCo>} />
          <Route path="/entries" element={<NeedCo><Entries /></NeedCo>} />
          <Route path="/surveys" element={<NeedCo><Surveys /></NeedCo>} />
          <Route path="/surveys/:id" element={<NeedCo><Surveys /></NeedCo>} />
          <Route path="/organisation" element={<NeedCo><Organisation /></NeedCo>} />
          <Route path="/people" element={<NeedCo><People /></NeedCo>} />
          <Route path="/methodology" element={<NeedCo><Methodology /></NeedCo>} />
          <Route path="/energy" element={<NeedCo><EnergyRegister /></NeedCo>} />
          <Route path="/help" element={<Manual />} />
          <Route path="/meters" element={<NeedCo><Meters /></NeedCo>} />
          <Route path="/bills" element={<NeedCo><Bills /></NeedCo>} />
          <Route path="/purchases" element={<NeedCo><Purchases /></NeedCo>} />
          <Route path="/purchases/published" element={<NeedCo><PublishedPurchasesPage /></NeedCo>} />
          <Route path="/purchases/:id" element={<NeedCo><PurchaseBatchPage /></NeedCo>} />
          <Route path="/suppliers" element={<NeedCo><Suppliers /></NeedCo>} />
          <Route path="/currency" element={<NeedCo><Currencies /></NeedCo>} />
          <Route path="/integrations" element={<NeedCo><Integrations /></NeedCo>} />
          <Route path="/audit" element={<NeedCo><AuditLog /></NeedCo>} />
          <Route path="*" element={<div className="page"><div className="card empty">Page not found.</div></div>} />
        </Routes>
      </main>
    </div>
  );
}

/** A page of a package the company does not have. */
function NeedPack({ has, name, children }: { has: boolean; name: string; children: ReactNode }) {
  if (has) return <>{children}</>;
  return <div className="card" style={{ maxWidth: 560 }}><h2>{name} is a separate package</h2><p className="muted">It is not switched on for this company. Contact the Ekobon team to add the {name} package.</p></div>;
}
function NeedCo({ children }: { children: ReactNode }) {
  const { tenant } = useApp();
  if (tenant) return <>{children}</>;
  return <div className="page"><div className="card empty"><h2>Choose a company first</h2><p className="sub">Pick one under “Viewing company” at the top left.</p></div></div>;
}
/** EKOFIN screens: a company must have EKOFIN switched on (platform console). */
function NeedFin({ children }: { children: ReactNode }) {
  const { tenant } = useApp();
  if (!tenant) return <NeedCo>{children}</NeedCo>;
  if (tenant.products?.includes('ekofin')) return <>{children}</>;
  return <div className="page"><div className="card empty"><h2>{productName('ekofin')} is not switched on</h2><p className="sub">Financed emissions for banks and investors is a separate product. Contact the Ekobon team to add it to this company.</p></div></div>;
}
/** CBAM Exporter pages: the company has the CBAM Exporter package or the full product. */
function NeedCbam({ children }: { children: ReactNode }) {
  const { tenant } = useApp();
  if (!tenant) return <NeedCo>{children}</NeedCo>;
  const p = tenant.products ?? ['ekotrace'];
  if (p.includes('cbam') || p.includes('ekotrace')) return <>{children}</>;
  return <div className="page"><div className="card empty"><h2>CBAM is not switched on</h2><p className="sub">The CBAM Exporter package is separate. Contact the Ekobon team to add it to this company.</p></div></div>;
}
function PrintRoute() { const { id } = useParams(); return <CbamPrint id={id ?? ''} />; }
function Gate({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? <>{children}</> : <div className="page"><div className="card empty">You do not have access to this page.</div></div>;
}
