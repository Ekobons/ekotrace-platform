/**
 * App shell: login gate, prototype sidebar (by role), company context, routes.
 */
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
import { Organisation } from './pages/Organisation';
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
import { Messages } from './pages/Messages';
import { SurveyAnswerPage } from './pages/SurveyAnswer';
import { Surveys } from './pages/Surveys';

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

type NavItem = { to?: string; label: string; icon: string; roles?: Role[]; stage?: number };
/** Section colours of the side menu, as in the prototype. */
const SEC_C: Record<string, string> = { '': 'var(--lime)', Capture: '#7FD3B9', Analyse: '#8EC5FF', 'Value chain': '#F2C46D', 'Net zero': '#B6E36B', Disclose: '#C9A7F5', Setup: '#E7ECEA', Help: '#F7A8B8' };
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [
    { to: '/home', label: 'Home', icon: 'home' }, { to: '/dashboards', label: 'Dashboards', icon: 'chart' }, { to: '/kpis', label: 'KPI dashboard', icon: 'gauge' },
  ] },
  { group: 'Capture', items: [
    { to: '/data/stationary_combustion', label: 'Add data', icon: 'plus', roles: ['super_admin', 'admin', 'manager', 'preparer'] },
    { to: '/entries', label: 'Entries & results', icon: 'list' },
    { to: '/surveys', label: 'Surveys', icon: 'users', roles: ['super_admin', 'admin', 'manager', 'verifier'] },
    { to: '/approvals', label: 'Approvals', icon: 'check', roles: ['super_admin', 'admin', 'manager', 'preparer'] }, { to: '/progress', label: 'Data progress', icon: 'grid' }, { label: 'Collection calendar', icon: 'calendar', stage: 2 },
    { label: 'Inbox & to-dos', icon: 'inbox', stage: 2 }, { to: '/vault', label: 'Document vault', icon: 'folder' }, { label: 'Batch runs', icon: 'upload', stage: 4 },
    { to: '/qr', label: 'QR & field app', icon: 'qr', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'] },
  ] },
  { group: 'Value chain', items: [{ to: '/suppliers', label: 'Suppliers', icon: 'users', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'] }, { label: 'Product LCA', icon: 'leaf', stage: 4 }] },
  { group: 'Net zero', items: [{ to: '/targets', label: 'Targets & actions', icon: 'target' }, { label: 'Carbon credits', icon: 'leaf', stage: 4 }] },
  { group: 'Disclose', items: [{ to: '/reports', label: 'Reports', icon: 'doc' }, { to: '/assurance', label: 'Audit & assurance', icon: 'shield', roles: ['super_admin', 'admin', 'manager', 'verifier'] }] },
  { group: 'Setup', items: [
    { to: '/organisation', label: 'Organisation & groups', icon: 'tree' },
    { to: '/methodology', label: 'Methodology & boundaries', icon: 'scale', roles: ['super_admin', 'admin', 'verifier'] },
    { to: '/energy', label: 'Energy certificates & suppliers', icon: 'bolt', roles: ['super_admin', 'admin', 'manager', 'verifier'] },
    { to: '/currency', label: 'Currencies & price index', icon: 'scale', roles: ['super_admin', 'admin', 'manager', 'verifier'] },
    { to: '/people', label: 'People & access', icon: 'users', roles: ['super_admin', 'admin', 'manager'] },
    { to: '/library', label: 'Factors & dictionary', icon: 'book', roles: [] },
    { label: 'Metric registry', icon: 'list', stage: 4 }, { to: '/integrations', label: 'Integrations & API', icon: 'plug', roles: ['super_admin', 'admin'] }, { label: 'AI models', icon: 'spark', stage: 4 },
    { to: '/audit', label: 'Security & audit log', icon: 'lock', roles: ['super_admin', 'admin', 'verifier'] },
  ] },
  { group: 'Help', items: [{ to: '/help', label: 'User manual', icon: 'book' }, { to: '/messages', label: 'Message centre', icon: 'chat' }] },
];

export function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const [mustChange, setMustChange] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setMe(await api.me()); setMustChange(false); }
    catch (e) { const code = (e as { code?: string }).code; if (code === 'MUST_CHANGE_PASSWORD') setMustChange(true); setMe(null); }
  }, []);
  useEffect(() => { whenLoggedOut(() => setMe(null)); reload(); }, [reload]);
  useEffect(() => {
    api.brand().then((b) => { document.title = b.productName ?? b.name; if (b.colors?.primary) document.documentElement.style.setProperty('--primary', b.colors.primary); }).catch(() => {});
  }, []);

  const toast = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3500); };
  // employees answering a survey: no sign-in
  if (window.location.pathname === '/survey') return <SurveyAnswerPage />;
  // waste contractors: email + access code, no user account
  if (window.location.pathname === '/contractor') return <ContractorPortal />;
  if (me === 'loading') return <div className="empty">Loading…</div>;
  if (me === null) return <Login onDone={reload} />;
  if (me.user.mustChangePassword || mustChange) return <ChangePassword forced onDone={reload} />;

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
  const visible = (i: NavItem) => !i.roles || (i.roles.length === 0 ? role === 'platform_admin' : can(...i.roles));
  // a bin's QR label opens the scan page full screen (phone), without the menu
  if (path.startsWith('/scan/')) return <Routes><Route path="/scan/:code" element={<ScanPage />} /></Routes>;

  return (
    <div className={`app${mini ? ' mini' : ''}`}>
      <aside className="side">
        <div className="brand"><div className="mark">e</div><div className="bt"><b>ekotrace</b><small>Carbon operating system</small></div>
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
        {tenant && !mini && <div className="navtools"><button type="button" onClick={foldAll} title={allClosed ? 'Expand all sections' : 'Collapse all sections'}>{allClosed ? '▸▸ Expand all' : '▾▾ Collapse all'}</button></div>}
        <nav className="nav">
          {role === 'platform_admin' && <NavLink to="/console" title={mini ? 'Platform console' : undefined}><Icon name="gear" /><span className="nl">Platform console</span></NavLink>}
          {role === 'platform_admin' && <NavLink to="/messages" title={mini ? 'Messages' : undefined}><Icon name="chat" /><span className="nl">Messages</span>{msgN > 0 && <span className="navb amber">{msgN}</span>}</NavLink>}
          {tenant && NAV.map((g, gi) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            const sc = SEC_C[g.group ?? ''] ?? '#fff';
            const on = items.some((i) => i.to && (path === i.to || (i.to.startsWith('/data/') && path.startsWith('/data/'))));
            const open = mini || !g.group || !folded.has(g.group) || on;
            return (
              <div key={gi} className="navsec" style={{ '--sc': sc } as CSSProperties}>
                {g.group && <button type="button" className={`sech${open ? ' open' : ''}${on ? ' has' : ''}`} aria-expanded={open} title={g.group} onClick={() => !mini && fold(g.group!)}>
                  <i className="sdot" /><span>{g.group.toUpperCase()}</span><span className="chev">{open ? '▾' : '▸'}</span></button>}
                {open && <div className="secitems">{items.map((i) => i.to
                  ? <NavLink key={i.label} to={i.to} title={mini ? i.label : undefined} className={({ isActive }) => (isActive || (i.to?.startsWith('/data/') && path.startsWith('/data/')) ? 'active' : '')}><Icon name={i.icon} /><span className="nl">{i.label}</span>{i.to === '/approvals' && apprN > 0 && <span className="navb amber">{apprN}</span>}{i.to === '/messages' && msgN > 0 && role !== 'platform_admin' && <span className="navb">{msgN}</span>}</NavLink>
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
        <Routes>
          <Route path="/" element={<Navigate to={role === 'platform_admin' && !tenant ? '/console' : '/home'} replace />} />
          <Route path="/console" element={<Gate ok={role === 'platform_admin'}><Console /></Gate>} />
          <Route path="/messages" element={role === 'platform_admin' ? <Messages /> : <NeedCo><Messages /></NeedCo>} />
          <Route path="/vault" element={<NeedCo><Vault /></NeedCo>} />
          <Route path="/account" element={<div className="page"><ChangePassword onDone={() => nav('/')} /></div>} />
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

function NeedCo({ children }: { children: ReactNode }) {
  const { tenant } = useApp();
  if (tenant) return <>{children}</>;
  return <div className="page"><div className="card empty"><h2>Choose a company first</h2><p className="sub">Pick one under “Viewing company” at the top left.</p></div></div>;
}
function Gate({ ok, children }: { ok: boolean; children: ReactNode }) {
  return ok ? <>{children}</> : <div className="page"><div className="card empty">You do not have access to this page.</div></div>;
}
