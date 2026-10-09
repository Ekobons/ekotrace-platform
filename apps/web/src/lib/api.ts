/**
 * Talking to the API. One function per call, typed results.
 * The chosen company travels in the x-tenant-id header (temporary, until login exists).
 */
export type Basis = 'direct' | 'wtt' | 'outside_scopes' | 'memo';

export interface Item { id: number; subcategory_id: number; code: string; name: string; aliases: string[]; default_unit: string | null; gas_code: string | null; note: string | null; sort: number; active: boolean; composition: { gas: string; fraction: number }[] | null; hiddenForClient?: boolean }
export interface Subcategory { id: number; category_id: number; code: string; name: string; units: string[]; default_unit: string | null; is_bioenergy: boolean; sort: number; active: boolean; hiddenForClient?: boolean; items: Item[] }
export interface Category { id: number; scope: number; code: string; name: string; calc_method: 'combustion' | 'fugitive'; description: string | null; active: boolean; subcategories: Subcategory[] }
export interface Unit { code: string; name: string; dimension: string; to_base: number; is_base: boolean; aliases: string[]; active: boolean }
export interface ResultLine { basis: Basis; gas: string; kgGas: number | null; kgCo2e: number; factorId: number | null; method: 'gas' | 'published' }
export interface CalcResponse { item: { id: number; name: string; category: string }; gwpSet: string; lines: ResultLine[]; totals: Record<Basis, number>; steps: string[]; warnings: string[] }
export interface Tenant { id: string; name: string; country: string; gwp_set: string; consolidation?: string; base_year?: number; plan?: string; status?: string; access_expiry?: string }
export type Role = 'platform_admin' | 'super_admin' | 'admin' | 'manager' | 'preparer' | 'verifier';
export interface Me { user: { id: string; name: string; email: string; role: Role; tenantId: string | null; scopeNodeId: string | null; mustChangePassword: boolean }; company: (Tenant & { scope_name: string | null }) | null }
export interface OrgNode { id: string; parent_id: string | null; kind: 'group' | 'subgroup' | 'facility'; name: string; facility_type: string | null; location: string | null; country: string; floor_area_m2: number | null; employees: number | null; ownership_pct: number; operational_control: boolean; financial_control: boolean; active: boolean; sort: number; manager_user_id: string | null; manager_name: string | null; entries: number; canEdit: boolean; canSee: boolean; canEnter: boolean }
export interface Person { id: string; name: string; email: string; role: Role; scope_node_id: string | null; scope_name: string | null; disabled: boolean; last_login_at: string | null; created_at: string; must_change_password: boolean; facilities: { id: string; name: string }[]; manages: { id: string; name: string }[]; canEdit: boolean }
export interface Company { id: string; name: string; country: string; gwp_set: string; plan: string; status: string; access_start: string; access_expiry: string; created_at: string; users: number; facilities: number; entries: number; last_login: string | null }
export const ROLE_LABEL: Record<Role, string> = { platform_admin: 'Platform admin', super_admin: 'Super admin', admin: 'Admin', manager: 'Manager', preparer: 'Data preparer', verifier: 'Verifier' };
export interface Facility { id: string; name: string; country: string; active: boolean; facility_type?: string | null; parent_name?: string | null; canEnter?: boolean; canApprove?: boolean }
export interface Factor { id: number; item_id: number; item: string; subcategory: string; basis: Basis; unit: string; co2e: number | null; region: string; valid_from: string; valid_to: string; status: string; version: number; supersedes_id: number | null; note: string | null; source: string; gwp_set: string | null; gases: { gas: string; kgPerUnit: number }[] | null }
export interface Activity { id: string; period_start: string; period_end: string; facility: string; category: string; item: string; quantity: number; unit: string; data_type: string; gwp_set: string; co2e_direct: number; co2e_wtt: number; co2_biogenic: number; co2e_memo: number; status: string; created_at: string }

/** Platform admin only: the company being looked at (sent as x-tenant-id). Others are fixed to their own company. */
let tenantId = localStorageGet('ekotrace.tenant');
function localStorageGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
export function setTenant(id: string | null) {
  tenantId = id;
  try { id ? localStorage.setItem('ekotrace.tenant', id) : localStorage.removeItem('ekotrace.tenant'); } catch { /* private mode */ }
}
export const currentTenant = () => tenantId;

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: { field: string; message: string }[]) { super(message); }
}
/** Called when the session has ended, so the app can show the login page. */
let onUnauthenticated: () => void = () => {};
export function whenLoggedOut(fn: () => void) { onUnauthenticated = fn; }

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  // eslint-disable-next-line no-param-reassign
  const headers: Record<string, string> = {};
  if (tenantId) headers['x-tenant-id'] = tenantId;
  if (body !== undefined || (method !== 'GET' && method !== 'DELETE' && !raw)) headers['content-type'] = 'application/json';
  if (body === undefined && method !== 'GET' && method !== 'DELETE' && !raw) body = {};
  if (raw) headers['content-type'] = 'application/octet-stream';
  const r = await fetch(path, { method, headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth/login')) onUnauthenticated();
  if (!r.ok) throw new ApiError(data.message ?? `Request failed (${r.status})`, r.status, data.error, data.details);
  return data as T;
}

export const api = {
  brand: () => call<{ name: string; productName?: string; colors?: Record<string, string> }>('GET', '/api/brand'),
  catalogue: (all = false) => call<{ categories: Category[] }>('GET', `/api/catalogue${all ? '?all=1' : ''}`),
  itemUnits: (id: number) => call<{ units: { code: string; name: string; dimension: string }[]; defaultUnit: string | null }>('GET', `/api/items/${id}/units`),
  units: () => call<{ units: Unit[] }>('GET', '/api/units'),
  gases: () => call<{ gases: { code: string; name: string; formula: string; family: string; kyoto: boolean; gwp: Record<string, number> | null }[]; gwpSets: { code: string; name: string; note: string }[] }>('GET', '/api/gases'),
  factors: (q: Record<string, string | number | undefined>) => call<{ factors: Factor[] }>('GET', `/api/factors?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  factorHistory: (id: number) => call<{ history: { id: number; version: number; co2e: number | null; status: string; created_by: string; created_at: string; note: string | null; source: string }[] }>('GET', `/api/factors/${id}/history`),
  sources: () => call<{ sources: { id: number; code: string; title: string; year: number | null; version: string | null; gwp_set: string | null; url: string | null; imported_at: string }[] }>('GET', '/api/factor-sources'),
  issues: () => call<{ issues: { id: number; source: string; severity: string; message: string; resolved: boolean }[] }>('GET', '/api/admin/import-issues'),
  resolveIssue: (id: number, resolved: boolean) => call('PATCH', `/api/admin/import-issues/${id}`, { resolved }),
  importDesnz: (file: Blob, preview: boolean) => call<{ year: number; version: string; gwpSet: string; fuelRows: number; gasRows: number; skipped?: boolean; factors?: number; items?: number; issues?: number }>('POST', `/api/admin/import/desnz${preview ? '?preview=1' : ''}`, undefined, file),
  addFactor: (b: unknown) => call<{ factor: Factor; replaced: number | null }>('POST', '/api/admin/factors', b),
  // auth
  login: (email: string, password: string) => call<{ ok: true }>('POST', '/api/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => call<Me>('GET', '/api/auth/me'),
  changePassword: (current: string, next: string) => call<{ ok: true }>('POST', '/api/auth/password', { current, next }),
  // company
  tenant: () => call<Tenant>('GET', '/api/tenant'),
  updateTenant: (b: { gwpSet?: string; country?: string; consolidation?: string; baseYear?: number }) => call<Tenant>('PATCH', '/api/tenant', b),
  boundaries: (year: number) => call<{ year: number; current: string; totals: Record<'operational' | 'financial' | 'equity', number>; facilities: { id: string; name: string; parent_name: string; ownership_pct: number; operational_control: boolean; financial_control: boolean; co2e_direct: number }[] }>('GET', `/api/boundaries?year=${year}`),
  facilities: () => call<{ facilities: Facility[] }>('GET', '/api/facilities'),
  org: () => call<{ nodes: OrgNode[] }>('GET', '/api/org'),
  createNode: (b: Record<string, unknown>) => call<OrgNode>('POST', '/api/org/nodes', b),
  updateNode: (id: string, b: Record<string, unknown>) => call<OrgNode>('PATCH', `/api/org/nodes/${id}`, b),
  removeNode: (id: string) => call<{ removed: boolean; archived: boolean; message?: string }>('DELETE', `/api/org/nodes/${id}`),
  users: () => call<{ users: Person[] }>('GET', '/api/users'),
  createUser: (b: Record<string, unknown>) => call<{ user: Person; temporaryPassword: string }>('POST', '/api/users', b),
  updateUser: (id: string, b: Record<string, unknown>) => call<Person>('PATCH', `/api/users/${id}`, b),
  resetPassword: (id: string) => call<{ temporaryPassword: string }>('POST', `/api/users/${id}/reset-password`),
  audit: (q: Record<string, string | number | undefined> = {}) => call<{ events: { id: number; at: string; user_name: string | null; action: string; entity: string | null; entity_id: string | null; detail: unknown; ip: string | null }[] }>('GET', `/api/audit?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  // platform console
  companies: () => call<{ companies: Company[] }>('GET', '/api/platform/companies'),
  createCompany: (b: Record<string, unknown>) => call<{ company: Company; superAdmin: { email: string; temporaryPassword: string } }>('POST', '/api/platform/companies', b),
  updateCompany: (id: string, b: Record<string, unknown>) => call<Company>('PATCH', `/api/platform/companies/${id}`, b),
  calculate: (b: unknown) => call<CalcResponse>('POST', '/api/calculate', b),
  saveActivity: (b: unknown) => call<{ id: string; totals: Record<Basis, number>; warnings: string[] }>('POST', '/api/activities', b),
  activities: (q: Record<string, string | number | undefined> = {}) => call<{ activities: Activity[] }>('GET', `/api/activities?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  activity: (id: string) => call<Activity & { steps: string[]; warnings: string[]; inputs: Record<string, unknown>; lines: { basis: Basis; gas: string; kg_gas: number | null; kg_co2e: number; method: string; source: string | null }[] }>('GET', `/api/activities/${id}`),
  byGas: (year: number) => call<{ rows: { scope: number; category: string; basis: Basis; gas: string; kg_gas: number | null; kg_co2e: number }[] }>('GET', `/api/reports/by-gas?year=${year}`),
  // catalogue admin
  addSubcategory: (b: unknown) => call('POST', '/api/admin/subcategories', b),
  updateSubcategory: (id: number, b: unknown) => call('PATCH', `/api/admin/subcategories/${id}`, b),
  removeSubcategory: (id: number) => call<{ removed: boolean; message?: string }>('DELETE', `/api/admin/subcategories/${id}`),
  addItem: (b: unknown) => call<Item>('POST', '/api/admin/items', b),
  updateItem: (id: number, b: unknown) => call<Item>('PATCH', `/api/admin/items/${id}`, b),
  removeItem: (id: number) => call<{ removed: boolean; message?: string }>('DELETE', `/api/admin/items/${id}`),
  setVisibility: (b: { subcategoryId?: number; itemId?: number; enabled: boolean }) => call('PUT', '/api/catalogue/visibility', b),
  updateUnit: (code: string, b: unknown) => call<Unit>('PATCH', `/api/admin/units/${encodeURIComponent(code)}`, b),
  addUnit: (b: unknown) => call<Unit>('POST', '/api/admin/units', b),
};

/** kg → tonnes, shown with sensible precision. */
export function tco2e(kg: number): string {
  const t = kg / 1000;
  if (t === 0) return '0';
  if (Math.abs(t) >= 100) return t.toLocaleString('en', { maximumFractionDigits: 1 });
  if (Math.abs(t) >= 1) return t.toLocaleString('en', { maximumFractionDigits: 3 });
  return t.toLocaleString('en', { maximumSignificantDigits: 3 });
}
export function num(v: number | null | undefined, sig = 6): string {
  if (v == null) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-4 && a < 1e9) return Number(v.toPrecision(sig)).toLocaleString('en', { maximumFractionDigits: 10 });
  return v.toExponential(3);
}
export const BASIS_SHORT: Record<Basis, string> = { direct: 'Scope 1', wtt: 'WTT · S3.3', outside_scopes: 'Biogenic', memo: 'Memo' };
export const BASIS_LABEL: Record<Basis, string> = { direct: 'Scope 1', wtt: 'Well-to-tank (Scope 3.3)', outside_scopes: 'Biogenic CO₂ (outside scopes)', memo: 'Memo: non-Kyoto gases' };
