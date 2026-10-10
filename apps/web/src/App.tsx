/**
 * App shell: login gate, prototype sidebar (by role), company context, routes.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, currentTenant, setTenant, whenLoggedOut, ROLE_LABEL, type Company, type Me, type Role } from './lib/api';
import { Icon } from './components/Icon';
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
import { Dashboards } from './pages/Dashboards';
import { Currencies } from './pages/Currencies';
import { AuditLog } from './pages/AuditLog';
import { Meters } from './pages/Meters';
import { Bills } from './pages/Bills';
import { Integrations } from './pages/Integrations';
import { Manual } from './pages/Manual';
import { Console } from './pages/Console';

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
const NAV: { group?: string; items: NavItem[] }[] = [
  { items: [
    { label: 'Home', icon: 'home', stage: 3 }, { to: '/dashboards', label: 'Dashboards', icon: 'chart' }, { label: 'KPI dashboard', icon: 'gauge', stage: 3 },
  ] },
  { group: 'Capture', items: [
    { to: '/data/stationary_combustion', label: 'Add data', icon: 'plus', roles: ['super_admin', 'admin', 'manager', 'preparer'] },
    { to: '/entries', label: 'Entries & results', icon: 'list' },
    { label: 'Approvals', icon: 'check', stage: 2 }, { label: 'Data progress', icon: 'grid', stage: 2 }, { label: 'Collection calendar', icon: 'calendar', stage: 2 },
    { label: 'Inbox & to-dos', icon: 'inbox', stage: 2 }, { label: 'Document vault', icon: 'folder', stage: 2 }, { label: 'Batch runs', icon: 'upload', stage: 4 },
    { label: 'QR & field app', icon: 'qr', stage: 4 },
  ] },
  { group: 'Value chain', items: [{ to: '/suppliers', label: 'Suppliers', icon: 'users', roles: ['super_admin', 'admin', 'manager', 'preparer', 'verifier'] }, { label: 'Product LCA', icon: 'leaf', stage: 4 }] },
  { group: 'Net zero', items: [{ label: 'Targets & actions', icon: 'target', stage: 4 }, { label: 'Carbon credits', icon: 'leaf', stage: 4 }] },
  { group: 'Disclose', items: [{ label: 'Reports', icon: 'doc', stage: 3 }, { label: 'Audit & assurance', icon: 'shield', stage: 3 }] },
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
  { group: 'Help', items: [{ to: '/help', label: 'User manual', icon: 'book' }, { label: 'Message centre', icon: 'chat', stage: 4 }] },
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
  const visible = (i: NavItem) => !i.roles || (i.roles.length === 0 ? role === 'platform_admin' : can(...i.roles));

  return (
    <div className="app">
      <aside className="side">
        <div className="brand"><div className="mark">e</div><div><b>ekotrace</b><small>Carbon operating system</small></div></div>
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
            <><b style={{ fontSize: 14 }}>{tenant?.name}</b><span style={{ fontSize: 11.5, color: 'var(--side-dim)' }}>{tenant?.plan} plan{tenant?.scope_name ? ` · ${tenant.scope_name}` : ' · whole group'}</span></>
          )}
        </div>
        <nav className="nav">
          {role === 'platform_admin' && <NavLink to="/console"><Icon name="gear" />Platform console</NavLink>}
          {tenant && NAV.map((g, gi) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={gi}>
                {g.group && <div className="navgrp">{g.group}</div>}
                {items.map((i) => i.to
                  ? <NavLink key={i.label} to={i.to} className={({ isActive }) => (isActive || (i.to?.startsWith('/data/') && path.startsWith('/data/')) ? 'active' : '')}><Icon name={i.icon} />{i.label}</NavLink>
                  : <a key={i.label} className="soon" aria-disabled="true" title={`Coming in stage ${i.stage}`}><Icon name={i.icon} />{i.label}<span className="soonchip">S{i.stage}</span></a>)}
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
          <Route path="/" element={<Navigate to={role === 'platform_admin' && !tenant ? '/console' : role === 'verifier' ? '/entries' : '/data/stationary_combustion'} replace />} />
          <Route path="/console" element={<Gate ok={role === 'platform_admin'}><Console /></Gate>} />
          <Route path="/account" element={<div className="page"><ChangePassword onDone={() => nav('/')} /></div>} />
          <Route path="/library/*" element={<Gate ok={role === 'platform_admin'}><Library /></Gate>} />
          <Route path="/data/:category" element={<NeedCo><AddData /></NeedCo>} />
          <Route path="/dashboards" element={<NeedCo><Dashboards /></NeedCo>} />
          <Route path="/entries" element={<NeedCo><Entries /></NeedCo>} />
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
