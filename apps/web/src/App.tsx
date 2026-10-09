/**
 * App shell: sidebar (prototype layout), company picker, routes.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, currentTenant, setTenant, type Tenant } from './lib/api';
import { Icon } from './components/Icon';
import { AddData } from './pages/AddData';
import { Entries } from './pages/Entries';
import { Library } from './pages/Library';
import { Settings } from './pages/Settings';

interface Ctx {
  tenant: Tenant | null;
  tenants: Tenant[];
  reloadTenants: () => Promise<void>;
  chooseTenant: (id: string | null) => void;
  toast: (msg: string) => void;
}
const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(currentTenant());
  const [brand, setBrand] = useState<{ name: string; colors?: Record<string, string> }>({ name: 'Ekotrace' });
  const [msg, setMsg] = useState<string | null>(null);

  const reloadTenants = useCallback(async () => {
    const t = (await api.tenants()).tenants;
    setTenants(t);
    if (tenantId && !t.some((x) => x.id === tenantId)) { setTenant(null); setTenantId(null); }
  }, [tenantId]);

  useEffect(() => { reloadTenants().catch(() => {}); }, [reloadTenants]);
  useEffect(() => {
    api.brand().then((b) => {
      setBrand(b);
      document.title = b.productName ?? b.name;
      if (b.colors?.primary) document.documentElement.style.setProperty('--primary', b.colors.primary);
    }).catch(() => {});
  }, []);

  const chooseTenant = (id: string | null) => { setTenant(id); setTenantId(id); };
  const toast = (m: string) => { setMsg(m); window.setTimeout(() => setMsg(null), 3200); };
  const tenant = tenants.find((t) => t.id === tenantId) ?? null;

  return (
    <AppCtx.Provider value={{ tenant, tenants, reloadTenants, chooseTenant, toast }}>
      <div className="app">
        <aside className="side">
          <div className="brand">
            <div className="mark">{brand.name.slice(0, 1)}</div>
            <div><b>{brand.name.toLowerCase()}</b><small>Carbon operating system</small></div>
          </div>
          <div className="org">
            <label>Company</label>
            <select value={tenantId ?? ''} onChange={(e) => chooseTenant(e.target.value || null)} aria-label="Company">
              <option value="">— choose a company —</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tenant && <span style={{ fontSize: 11.5, color: 'var(--side-dim)' }}>{tenant.country} · reports in {tenant.gwp_set}</span>}
          </div>
          <nav className="nav">
            <div className="navgrp">Capture</div>
            <NavLink to="/data/stationary_combustion"><Icon name="flame" />Stationary combustion</NavLink>
            <NavLink to="/data/fugitive"><Icon name="snow" />Fugitive emissions</NavLink>
            <NavLink to="/entries"><Icon name="list" />Entries & results</NavLink>
            <div className="navgrp">Setup</div>
            <NavLink to="/library"><Icon name="book" />Factor library</NavLink>
            <NavLink to="/settings"><Icon name="gear" />Company & facilities</NavLink>
          </nav>
          <div className="sidefoot">Factors: DESNZ 2022–2026, IPCC 2006. GWP: AR4 / AR5 / AR6.</div>
        </aside>
        <main className="main">
          <div className="devbar"><b>LOCAL</b>Running on this computer without login. Choose the company at the top left.</div>
          <Routes>
            <Route path="/" element={<Navigate to="/data/stationary_combustion" replace />} />
            <Route path="/data/:category" element={<Need tenant={tenant}><AddData /></Need>} />
            <Route path="/entries" element={<Need tenant={tenant}><Entries /></Need>} />
            <Route path="/library/*" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}

function Need({ tenant, children }: { tenant: Tenant | null; children: ReactNode }) {
  if (tenant) return <>{children}</>;
  return (
    <div className="page">
      <div className="card empty">
        <h2>Choose a company first</h2>
        <p className="sub">Pick one at the top left, or create one under <NavLink to="/settings">Company & facilities</NavLink>.</p>
      </div>
    </div>
  );
}
