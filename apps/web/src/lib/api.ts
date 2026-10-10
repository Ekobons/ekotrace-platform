/**
 * Talking to the API. One function per call, typed results.
 * The chosen company travels in the x-tenant-id header (temporary, until login exists).
 */
export type Basis = 'direct' | 'wtt' | 'outside_scopes' | 'memo' | 'scope2' | 'scope2_market' | 'td_loss' | 'scope3';

export interface Item { id: number; subcategory_id: number; code: string; name: string; aliases: string[]; default_unit: string | null; gas_code: string | null; note: string | null; sort: number; active: boolean; composition: { gas: string; fraction: number }[] | null; hiddenForClient?: boolean; attrs?: VehicleAttrs }
/** Vehicle types: class, powertrain, the fuel it burns, electric / plug-in, distance factors or not. */
export interface VehicleAttrs { vehicle?: string; powertrain?: string; load?: string; fuel?: string | null; electric?: boolean; phev?: boolean; distance?: boolean }
export interface Subcategory { id: number; category_id: number; code: string; name: string; grp?: string | null; units: string[]; default_unit: string | null; is_bioenergy: boolean; sort: number; active: boolean; hiddenForClient?: boolean; items: Item[] }
export interface Category { id: number; scope: number; code: string; name: string; calc_method: 'combustion' | 'fugitive' | 'vehicle' | 'electricity' | 'waste' | 'waste_disposal' | 'spend'; ghg_category?: number | null; description: string | null; active: boolean; subcategories: Subcategory[] }
export interface Unit { code: string; name: string; dimension: string; to_base: number; is_base: boolean; aliases: string[]; active: boolean }
export interface ResultLine { basis: Basis; gas: string; kgGas: number | null; kgCo2e: number; factorId: number | null; method: 'gas' | 'published' }
/** CO2e emission factor behind one part of a result: quantity × perEnteredUnit = total. */
export interface FactorUsed {
  basis: Basis; label?: string; factorId: number | null; source: string; validFrom: string | null; co2ePerUnit: number; unit: string; unitName: string;
  perEnteredUnit: number; enteredUnit: string; enteredUnitName: string; quantity: number; method: 'gas' | 'published';
  published?: { co2ePerUnit: number; gwpSet: string };
}
/** A calorific value the user entered, and what it converted the quantity to. */
export interface CvUsed { value: number; energyUnit: string; perUnit: string; energyUnitName: string; perUnitName: string; basis: 'net' | 'gross'; convertedQuantity: number; convertedUnit: string; convertedUnitName: string }
export interface CalcResponse { cv?: CvUsed; stored?: { quantity: number; unit: string; inputs: Record<string, unknown> }; item: { id: number; name: string; category: string }; gwpSet: string; lines: ResultLine[]; factors: FactorUsed[]; totals: Record<Basis, number>; steps: string[]; warnings: string[] }
export interface Tenant { id: string; name: string; country: string; gwp_set: string; timezone?: string; consolidation?: string; base_year?: number; plan?: string; status?: string; access_expiry?: string }
export type Role = 'platform_admin' | 'super_admin' | 'admin' | 'manager' | 'preparer' | 'verifier';
export interface Me { user: { id: string; name: string; email: string; role: Role; tenantId: string | null; scopeNodeId: string | null; mustChangePassword: boolean }; company: (Tenant & { scope_name: string | null }) | null }
export interface OrgNode { id: string; parent_id: string | null; kind: 'group' | 'subgroup' | 'facility'; name: string; facility_type: string | null; location: string | null; country: string; floor_area_m2: number | null; employees: number | null; ownership_pct: number; operational_control: boolean; financial_control: boolean; active: boolean; sort: number; manager_user_id: string | null; manager_name: string | null; grid_region?: string | null; entries: number; canEdit: boolean; canSee: boolean; canEnter: boolean }
export interface Person { id: string; name: string; email: string; role: Role; scope_node_id: string | null; scope_name: string | null; disabled: boolean; last_login_at: string | null; created_at: string; must_change_password: boolean; facilities: { id: string; name: string }[]; manages: { id: string; name: string }[]; canEdit: boolean }
export interface Company { id: string; name: string; country: string; gwp_set: string; plan: string; status: string; access_start: string; access_expiry: string; created_at: string; users: number; facilities: number; entries: number; last_login: string | null }
export const ROLE_LABEL: Record<Role, string> = { platform_admin: 'Platform admin', super_admin: 'Super admin', admin: 'Admin', manager: 'Manager', preparer: 'Data preparer', verifier: 'Verifier' };
export interface Facility { id: string; name: string; country: string; grid_region?: string | null; active: boolean; facility_type?: string | null; parent_name?: string | null; canEnter?: boolean; canApprove?: boolean }
export interface Factor { id: number; item_id: number; item: string; subcategory: string; basis: Basis; unit: string; co2e: number | null; region: string; valid_from: string; valid_to: string; status: string; version: number; supersedes_id: number | null; note: string | null; source: string; gwp_set: string | null; gases: { gas: string; kgPerUnit: number }[] | null }
export interface Activity { id: string; period_start: string; period_end: string; facility: string; category: string; item: string; quantity: number; unit: string; data_type: string; gwp_set: string; co2e_direct: number; co2e_wtt: number; co2_biogenic: number; co2e_memo: number; co2e_scope2?: number; co2e_scope2_market?: number; co2e_td?: number; co2e_scope3?: number; scope?: number; ghg_category?: number | null; waste_site?: string | null; meter?: string | null; meter_id?: string | null; status: string; created_at: string; vehicle?: string | null; vehicle_id?: string | null }

// ------------------------------------------------------------- purchases --
export type PurchaseField = 'date' | 'description' | 'amount' | 'currency' | 'quantity' | 'unit' | 'supplier' | 'category' | 'gl' | 'po' | 'facility' | 'supplierEf' | 'supplierEfUnit' | 'capital';
export type Columns = Partial<Record<PurchaseField, string | string[]>>;
export interface PurchaseMeta {
  fields: { field: PurchaseField; label: string }[]; fxMethod: 'month' | 'year' | 'fixed'; currency: string; aiMapping: boolean; aiAvailable: boolean; aiName: string | null;
  overlap: Record<string, string>; categories: { id: number; code: string; name: string; ghg_category: number }[]; factorSets: { code: string; title: string; n: number }[]; maxLines: number;
}
export interface UploadSheet { name: string; headerRow: number; headers: string[]; rows: string[][]; guess: Columns; signature: string; profile: { id: string; name: string; settings: { headerRow: number; columns: Columns; dateFormat: 'dmy' | 'mdy' | 'ymd'; currency: string; facilityId?: string | null; period?: { year?: number; month?: string } | null; sheet?: string } } | null }
export interface UploadResult { batchId: string; filename: string; kind: string; defaultCurrency: string; sheets: UploadSheet[] }
export type LineStatus = 'new' | 'problem' | 'unmapped' | 'flagged' | 'excluded' | 'ready' | 'published';
export interface PurchaseBatch {
  id: string; name: string; source: 'upload' | 'manual' | 'api'; status: string; error: string | null; created_at: string; published_at: string | null; created_by_name: string | null;
  lines: number; ready: number; published: number; attention: number; usd: number; co2e: number; progress: { stage?: string; done?: number; total?: number } | null; job_status: string | null;
}
export interface BatchDetail {
  batch: PurchaseBatch & { settings: Record<string, unknown>; file: { filename: string; size: number } | null; external_ref: string | null };
  job: { id: number; kind: string; status: string; progress: { stage?: string; done?: number; total?: number }; error: string | null } | null;
  counts: { status: LineStatus; lines: number; usd: number; co2e: number }[]; byCategory: { category: string; lines: number; co2e: number; usd: number }[];
  byMethod: { method: 'spend' | 'supplier'; lines: number; co2e: number }[]; problems: { problem: string; lines: number }[];
  groups: { total: number; unmapped: number; flagged: number; capital_hint: number; check: number }; facilitiesMissing: { value: string | null; lines: number }[];
  entries: { n: number; approved: number }; period: { from: string | null; to: string | null };
}
export interface PurchaseGroup {
  key: string; description: string; category_text: string | null; gl_account: string | null; supplier: string | null; lines: number; usd: number; co2e: number | null;
  item_id: number | null; item_name: string | null; naics: string | null; map_method: 'rule' | 'text' | 'ai' | 'manual' | 'code' | null; confidence: number | null;
  candidates: { itemId: number; score: number; name?: string }[]; overlap: string | null; overlap_why: string | null; decision: 'keep' | 'move' | 'exclude' | null; target: string | null;
  capital: boolean; statuses: Partial<Record<LineStatus, number>> | null;
}
export interface PurchaseLine {
  id: string; row_no: number; date: string | null; month: string | null; description: string; category_text: string | null; supplier_text: string | null; po_ref: string | null;
  facility: string | null; facility_text: string | null; amount: number | null; currency: string | null; quantity: number | null; unit: string | null; status: LineStatus;
  method: 'spend' | 'supplier' | null; item: string | null; co2e: number | null; usd: number | null; fx: number | null; fx_kind: string | null; cpi: number | null;
  problems: string[]; warnings: string[]; calc_error: string | null; dup_of: string | null; activity_id: string | null;
}
export interface SpendItem { id: number; name: string; naics: string | null; group: string; co2e: number | null; unit: string | null; price_year: number | null; source: string | null }
export interface Supplier { id: string; name: string; aliases: string[]; country: string | null; reference: string | null; contact_email: string | null; origin: string; active: boolean; lines: number; usd: number; co2e: number; supplier_lines: number; factors: number }
export interface SupplierFactor2 { id: string; item_id: number | null; item: string | null; co2e: number; unit: string; price_year: number | null; valid_from: string; valid_to: string; source: string; boundary: string | null }
export interface FxRow { id: number; currency: string; kind: 'month' | 'year' | 'fixed' | 'peg'; period: string; per_usd: number; source: string; own: boolean }
export interface ManualLine { date: string; description: string; itemId: number | null; target: string; amount: number | null; currency: string; quantity?: number | null; unit?: string | null; supplier?: string | null; supplierEf?: number | null; supplierEfUnit?: string | null }
export interface ManualResult { saved: boolean; allReady: boolean; batchId?: string; entries?: number; co2e?: number; lines: { row_no: number; status: LineStatus; method: string | null; co2e: number | null; problems: string[]; calc_error: string | null; warnings: string[]; item: string | null; steps: string[]; factor: { name: string; source: string; value: number; unit: string } | null }[] }

/** Platform admin only: the company being looked at (sent as x-tenant-id). Others are fixed to their own company. */
let tenantId = localStorageGet('ekotrace.tenant');
function localStorageGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
export function setTenant(id: string | null) {
  tenantId = id;
  try { id ? localStorage.setItem('ekotrace.tenant', id) : localStorage.removeItem('ekotrace.tenant'); } catch { /* private mode */ }
}
export const currentTenant = () => tenantId;

export type VehicleMethod = 'distance' | 'fuel' | 'electricity' | 'spend';
export interface Vehicle {
  id: string; facility_id: string; name: string; registration: string | null; item_id: number; type: string; class: string; grp: string | null; attrs: VehicleAttrs;
  fuel_item_id: number | null; fuel: string | null; ownership: 'owned' | 'leased'; charging: 'site' | 'elsewhere' | null; default_method: VehicleMethod;
  in_service_from: string; retired_on: string | null; retired_reason: string | null; note: string | null; entries: number;
}
export interface VehicleType { id: number; name: string; code: string; sub: string; grp: string | null; attrs: VehicleAttrs }
export interface Price { id: string; platform: boolean; region: string; item_id: number; item: string; currency: string; price: number; unit: string; valid_from: string; valid_to: string; source: string }
export interface UploadRow { row: number; errors: string[]; warnings?: string[]; totals?: Record<Basis, number> | null; [k: string]: unknown }

/** A row typed or pasted on screen (text as entered). */
export interface PastedRow { month?: string; what: string; typeId?: number; count?: string; quantity: string; unit?: string; method?: string; note?: string }
export interface RowResult {
  index: number; errors: string[]; warnings: string[]; totals: Record<Basis, number> | null;
  read: { vehicle: string | null; vehicleKind: 'fleet' | 'type' | null; typeId: number | null; assumed: string[]; month: string | null; count: number; method: string | null; quantity: number | null; unit: string | null; total: number | null };
}

export interface GridRegion { code: string; country: string; name: string; kind: 'country' | 'subnational' | 'grid'; note: string | null; active: boolean;
  factors: { id: number; basis: Basis; year: number; co2e: number; unit: string; source: string; title: string; note: string | null }[] | null }
export interface SupplierFactor { id: string; shared: boolean; supplier: string; energy: 'electricity' | 'heat' | 'cooling'; region: string | null; co2e: number; unit: string; renewable_pct: number | null; valid_from: string; valid_to: string; source: string }
export interface Certificate {
  id: string; facility_id: string | null; facility: string | null; instrument: 'certificate' | 'ppa' | 'green_tariff' | 'other'; standard: string | null;
  technology: 'solar' | 'wind' | 'hydro' | 'biomass' | 'biogas' | 'geothermal' | 'nuclear' | 'other'; mwh: number; co2e_per_kwh: number; market: string;
  vintage_from: string; vintage_to: string; reference: string | null; supplier: string | null; retired_on: string | null; note: string | null; claimed_mwh: number; claims: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: { field: string; message: string }[]) { super(message); }
}
/** Called when the session has ended, so the app can show the login page. */
let onUnauthenticated: () => void = () => {};
export function whenLoggedOut(fn: () => void) { onUnauthenticated = fn; }

async function call<T>(method: string, path: string, body?: unknown, raw?: Blob, extra?: Record<string, string>): Promise<T> {
  // eslint-disable-next-line no-param-reassign
  const headers: Record<string, string> = { ...extra };
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
  itemCv: (id: number, q: { energyUnit: string; perUnit: string; date: string }) =>
    call<{ energyUnits: { code: string; name: string; dimension: string }[]; suggested: { value: number; source: string } | null }>('GET', `/api/items/${id}/cv?${new URLSearchParams(q)}`),
  itemUnits: (id: number) => call<{ units: { code: string; name: string; dimension: string }[]; defaultUnit: string | null }>('GET', `/api/items/${id}/units`),
  units: () => call<{ units: Unit[] }>('GET', '/api/units'),
  gases: () => call<{ gases: { code: string; name: string; formula: string; family: string; kyoto: boolean; gwp: Record<string, number> | null }[]; gwpSets: { code: string; name: string; note: string }[] }>('GET', '/api/gases'),
  factors: (q: Record<string, string | number | undefined>) => call<{ factors: Factor[] }>('GET', `/api/factors?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  factorHistory: (id: number) => call<{ history: { id: number; version: number; co2e: number | null; status: string; created_by: string; created_at: string; note: string | null; source: string }[] }>('GET', `/api/factors/${id}/history`),
  sources: () => call<{ sources: { id: number; code: string; title: string; year: number | null; version: string | null; gwp_set: string | null; url: string | null; imported_at: string }[] }>('GET', '/api/factor-sources'),
  issues: () => call<{ issues: { id: number; source: string; severity: string; message: string; resolved: boolean }[] }>('GET', '/api/admin/import-issues'),
  resolveIssue: (id: number, resolved: boolean) => call('PATCH', `/api/admin/import-issues/${id}`, { resolved }),
  importEpa: (file: File, preview: boolean) => call<{ version: string; priceYear: number; rows: number; skipped?: boolean | number; factors?: number; items?: number; sample: { naics: string; title: string; withMargins: number }[] }>('POST', `/api/admin/import/epa${preview ? '?preview=1' : ''}`, undefined, file, { 'x-filename': encodeURIComponent(file.name) }),
  importOldPurchases: (b: { factors: string; categories?: string; subcategories?: string; types?: string; currency: string; priceYear: number; preview?: boolean }) =>
    call<{ preview: boolean; rows?: number; withNaics?: number; columns?: string[]; linked?: number; created?: number; factors?: number; skipped?: number; notes?: string[] }>('POST', '/api/admin/import/old-purchases', b),
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
  activity: (id: string) => call<Activity & { steps: string[]; warnings: string[]; factors: FactorUsed[]; inputs: Record<string, unknown> & { cv?: CvUsed }; lines: { basis: Basis; gas: string; kg_gas: number | null; kg_co2e: number; method: string; source: string | null }[] }>('GET', `/api/activities/${id}`),
  byGas: (year: number) => call<{ rows: { scope: number; category: string; basis: Basis; gas: string; kg_gas: number | null; kg_co2e: number }[] }>('GET', `/api/reports/by-gas?year=${year}`),
  // vehicles
  vehicleTypes: () => call<{ types: VehicleType[] }>('GET', '/api/vehicle-types'),
  vehicles: (facilityId: string, period?: { from: string; to: string }) => call<{ vehicles: Vehicle[] }>('GET', `/api/facilities/${facilityId}/vehicles${period ? `?${new URLSearchParams(period)}` : ''}`),
  addVehicle: (facilityId: string, b: unknown) => call<Vehicle>('POST', `/api/facilities/${facilityId}/vehicles`, b),
  updateVehicle: (id: string, b: unknown) => call<Vehicle>('PATCH', `/api/vehicles/${id}`, b),
  retireVehicle: (id: string, b: { retiredOn: string; reason?: string }) => call('POST', `/api/vehicles/${id}/retire`, b),
  reinstateVehicle: (id: string) => call('POST', `/api/vehicles/${id}/reinstate`),
  deleteVehicle: (id: string) => call('DELETE', `/api/vehicles/${id}`),
  uploadFleet: (facilityId: string, file: Blob, commit: boolean) => call<{ rows: UploadRow[]; valid: number; added: number }>('POST', `/api/facilities/${facilityId}/vehicles/upload${commit ? '?commit=1' : ''}`, undefined, file),
  uploadVehicleData: (file: Blob, commit: boolean) => call<{ rows: UploadRow[]; valid: number; saved: number }>('POST', `/api/vehicles/entries/upload${commit ? '?commit=1' : ''}`, undefined, file),
  vehicleRows: (b: { facilityId?: string; month?: string; rows: PastedRow[]; commit: boolean }) => call<{ rows: RowResult[]; valid: number; saved: number }>('POST', '/api/vehicles/entries/rows', b),
  batch: (entries: unknown[], dryRun: boolean) => call<{ results: { index: number; ok: boolean; id?: string; totals?: Record<Basis, number>; warnings?: string[]; error?: string }[]; saved: number; failed: number }>('POST', '/api/activities/batch', { entries, dryRun }),
  recalculate: (b: { ids?: string[]; year?: number; onlyWithWarnings?: boolean }) => call<{ checked: number; changed: number; problems: string[] }>('POST', '/api/activities/recalculate', b),
  // Meters
  meters: (facilityId?: string) => call<{ meters: Meter[] }>('GET', `/api/meters${facilityId ? `?facilityId=${facilityId}` : ''}`),
  meter: (id: string) => call<MeterDetail>('GET', `/api/meters/${id}`),
  addMeter: (b: unknown) => call<Meter>('POST', '/api/meters', b),
  updateMeter: (id: string, b: unknown) => call<Meter>('PATCH', `/api/meters/${id}`, b),
  deleteMeter: (id: string) => call<{ ok: true }>('DELETE', `/api/meters/${id}`),
  addReadings: (id: string, readings: { timestamp: string; value: number; start?: string }[], source: 'upload' | 'manual' = 'upload') =>
    call<{ inserted: number; updated: number; unchanged: number; rejected: { index: number; reason: string }[]; sync: SyncResult | null }>('POST', `/api/meters/${id}/readings`, { readings, source }),
  deleteReading: (id: string, ts: string) => call<{ removed: number }>('DELETE', `/api/meters/${id}/readings?ts=${encodeURIComponent(ts)}`),
  syncMeter: (id: string) => call<SyncResult>('POST', `/api/meters/${id}/sync`),
  apiKeys: () => call<{ keys: ApiKey[] }>('GET', '/api/api-keys'),
  addApiKey: (name: string, scopes: string[] = ['meter_readings']) => call<ApiKey & { key: string }>('POST', '/api/api-keys', { name, scopes }),
  revokeApiKey: (id: string) => call<{ ok: true }>('DELETE', `/api/api-keys/${id}`),
  setTimezone: (timezone: string) => call<{ timezone: string }>('PATCH', '/api/tenant/timezone', { timezone }),
  // Bills
  bills: (status?: string) => call<{ bills: Bill[]; counts: Record<string, number> }>('GET', `/api/bills${status ? `?status=${status}` : ''}`),
  bill: (id: string) => call<Bill & { text: string; entries: { id: string; period_start: string; quantity: number; unit: string; status: string; co2e_scope2: number; co2e_scope2_market: number; co2e_direct: number }[] }>('GET', `/api/bills/${id}`),
  uploadBill: (f: File) => call<Bill & { duplicate: boolean }>('POST', '/api/bills/upload', undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  patchBill: (id: string, b: unknown) => call<Bill>('PATCH', `/api/bills/${id}`, b),
  confirmBill: (id: string, b: unknown) => call<Bill & { sync: SyncResult }>('POST', `/api/bills/${id}/confirm`, b),
  reopenBill: (id: string) => call<Bill>('POST', `/api/bills/${id}/reopen`),
  rejectBill: (id: string, note: string) => call<{ ok: true }>('POST', `/api/bills/${id}/reject`, { note }),
  // Waste
  wasteDefaults: () => call<WasteDefaults>('GET', '/api/waste/defaults'),
  wasteSites: (facilityId?: string) => call<{ sites: WasteSite[] }>('GET', `/api/waste/sites${facilityId ? `?facilityId=${facilityId}` : ''}`),
  wasteSite: (id: string) => call<WasteSite & { deposits: WasteDeposit[]; entryList: { id: string; period_start: string; period_end: string; co2e_direct: number }[] }>('GET', `/api/waste/sites/${id}`),
  addWasteSite: (b: unknown) => call<WasteSite>('POST', '/api/waste/sites', b),
  updateWasteSite: (id: string, b: unknown) => call<WasteSite>('PATCH', `/api/waste/sites/${id}`, b),
  deleteWasteSite: (id: string) => call<{ ok: true }>('DELETE', `/api/waste/sites/${id}`),
  saveDeposits: (id: string, b: { rows: { year: number; type: string; tonnes: number; source?: string | null; estimated?: boolean }[]; replaceAll?: boolean }) =>
    call<{ saved: number; removed: number; entries: string[] }>('PUT', `/api/waste/sites/${id}/deposits`, b),
  // Scope 2
  gridRegions: () => call<{ regions: GridRegion[] }>('GET', '/api/grid-regions'),
  addGridRegion: (b: unknown) => call<GridRegion>('POST', '/api/grid-regions', b),
  addRegionFactor: (code: string, b: unknown) => call<{ id: number; co2e: number }>('POST', `/api/grid-regions/${code}/factors`, b),
  supplierFactors: (energy?: string) => call<{ suppliers: SupplierFactor[] }>('GET', `/api/supplier-factors${energy ? `?energy=${energy}` : ''}`),
  addSupplierFactor: (b: unknown) => call('POST', '/api/supplier-factors', b),
  deleteSupplierFactor: (id: string) => call('DELETE', `/api/supplier-factors/${id}`),
  certificates: (q: { facilityId?: string; usable?: boolean } = {}) => call<{ certificates: Certificate[] }>('GET', `/api/certificates?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`),
  addCertificate: (b: unknown) => call<Certificate>('POST', '/api/certificates', b),
  updateCertificate: (id: string, b: unknown) => call<Certificate>('PATCH', `/api/certificates/${id}`, b),
  deleteCertificate: (id: string) => call('DELETE', `/api/certificates/${id}`),
  certificateClaims: (id: string) => call<{ claims: { kwh: number; activity_id: string; period_start: string; facility: string }[] }>('GET', `/api/certificates/${id}/claims`),
  // price list
  priceItems: () => call<{ items: { id: number; name: string; default_unit: string | null; sub: string }[] }>('GET', '/api/price-items'),
  prices: (q: { region?: string; itemId?: number } = {}) => call<{ prices: Price[] }>('GET', `/api/prices?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  addPrice: (b: unknown) => call('POST', '/api/prices', b),
  deletePrice: (id: string) => call('DELETE', `/api/prices/${id}`),
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
  // purchases
  purchaseMeta: () => call<PurchaseMeta>('GET', '/api/purchases/meta'),
  purchaseSettings: (b: { aiMapping: boolean }) => call<{ aiMapping: boolean }>('PATCH', '/api/purchases/settings', b),
  uploadPurchases: (f: File, again = false) => call<UploadResult>('POST', `/api/purchases/upload${again ? '?again=1' : ''}`, undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  setupBatch: (id: string, b: unknown) => call<{ batchId: string; jobId: number }>('POST', `/api/purchases/batches/${id}/setup`, b),
  purchaseBatches: () => call<{ batches: PurchaseBatch[] }>('GET', '/api/purchases/batches'),
  purchaseBatch: (id: string) => call<BatchDetail>('GET', `/api/purchases/batches/${id}`),
  purchaseGroups: (id: string, q: Record<string, string | number | undefined>) => call<{ total: number; groups: PurchaseGroup[] }>('GET', `/api/purchases/batches/${id}/groups?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  patchGroups: (id: string, b: { keys: string[]; itemId?: number | null; decision?: 'keep' | 'move' | 'exclude' | null; target?: string | null; capital?: boolean; remember?: boolean }) =>
    call<{ groups: number; lines: number; background: boolean }>('PATCH', `/api/purchases/batches/${id}/groups`, b),
  purchaseLines: (id: string, q: Record<string, string | number | undefined>) => call<{ total: number; lines: PurchaseLine[] }>('GET', `/api/purchases/batches/${id}/lines?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  purchaseLine: (id: string) => call<{ status: LineStatus; method: string | null; co2e: number | null; steps: string[]; warnings: string[]; error: string | null; factor: { name: string; source: string; value: number; unit: string } | null }>('GET', `/api/purchases/lines/${id}`),
  mapFacility: (id: string, value: string | null, facilityId: string) => call<{ lines: number }>('POST', `/api/purchases/batches/${id}/facilities`, { value, facilityId }),
  recalcBatch: (id: string, remap = false) => call<{ jobId: number }>('POST', `/api/purchases/batches/${id}/recalculate`, { remap }),
  publishBatch: (id: string) => call<{ jobId: number; lines: number }>('POST', `/api/purchases/batches/${id}/publish`),
  reopenBatch: (id: string) => call<{ removed: number; kept: number }>('POST', `/api/purchases/batches/${id}/reopen`),
  patchBatch: (id: string, b: { name?: string; includeDuplicates?: boolean }) => call<{ ok: true }>('PATCH', `/api/purchases/batches/${id}`, b),
  deleteBatch: (id: string) => call<{ ok: true }>('DELETE', `/api/purchases/batches/${id}`),
  spendItems: (q: string, limit = 30) => call<{ items: SpendItem[] }>('GET', `/api/purchases/items?${new URLSearchParams({ q, limit: String(limit) })}`),
  purchaseRules: () => call<{ rules: { id: string; field: string; pattern: string; item: string | null; decision: string | null; target: string | null; capital: boolean | null; hits: number; created_at: string; created_by: string | null }[] }>('GET', '/api/purchases/rules'),
  deleteRule: (id: string) => call<{ ok: true }>('DELETE', `/api/purchases/rules/${id}`),
  manualPurchases: (b: { facilityId: string; dryRun?: boolean; name?: string; lines: ManualLine[] }) => call<ManualResult>('POST', '/api/purchases/manual', b),
  suppliers: (q: Record<string, string | number | undefined>) => call<{ total: number; suppliers: Supplier[] }>('GET', `/api/suppliers?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  supplier: (id: string) => call<{ supplier: Supplier & { note: string | null; norm: string }; factors: SupplierFactor2[]; categories: { item: string | null; lines: number; usd: number; co2e: number }[] }>('GET', `/api/suppliers/${id}`),
  addSupplier: (b: unknown) => call<{ id: string }>('POST', '/api/suppliers', b),
  patchSupplier: (id: string, b: unknown) => call<{ ok: true }>('PATCH', `/api/suppliers/${id}`, b),
  mergeSupplier: (id: string, intoId: string) => call<{ lines: number }>('POST', `/api/suppliers/${id}/merge`, { intoId }),
  addSupplierEf: (id: string, b: unknown) => call<{ id: string; linesRecalculated: number }>('POST', `/api/suppliers/${id}/factors`, b),
  deleteSupplierEf: (id: string, fid: string) => call<{ ok: true }>('DELETE', `/api/suppliers/${id}/factors/${fid}`),
  currency: (currency?: string) => call<{ fxMethod: 'month' | 'year' | 'fixed'; currency: string; rates: FxRow[]; cpi: { region: string; year: number; value: number; source: string }[]; missing: { currency: string; month: string; lines: number }[]; used: { currency: string; lines: number }[]; fallbacks: { warning: string; lines: number }[] }>('GET', `/api/currency${currency ? `?currency=${currency}` : ''}`),
  currencySettings: (b: { fxMethod?: string; currency?: string }) => call('PATCH', '/api/currency/settings', b),
  addRates: (rows: { currency: string; kind: string; period: string; perUsd: number; source: string }[], shared = false) => call<{ saved: number }>('POST', '/api/currency/rates', { rows, shared }),
  deleteRate: (id: number) => call<{ ok: true }>('DELETE', `/api/currency/rates/${id}`),
  addPriceIndex: (b: { region: string; year: number; value: number; source: string }) => call('POST', '/api/admin/price-index', b),
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
export const BASIS_SHORT: Record<Basis, string> = { direct: 'Scope 1', wtt: 'Upstream · S3.3', outside_scopes: 'Biogenic', memo: 'Memo', scope2: 'Scope 2 loc.', scope2_market: 'Scope 2 mkt.', td_loss: 'T&D · S3.3', scope3: 'Scope 3' };
export const BASIS_LABEL: Record<Basis, string> = { direct: 'Scope 1', wtt: 'Upstream / well-to-tank (Scope 3.3)', outside_scopes: 'Biogenic CO₂ (outside scopes)', memo: 'Memo: non-Kyoto gases', scope2: 'Scope 2 · location-based', scope2_market: 'Scope 2 · market-based', td_loss: 'T&D losses (Scope 3.3)', scope3: 'Scope 3' };

/** Download a file from the API (keeps the company header), e.g. an Excel template. */
/** A file from the API as a blob URL (e.g. a bill PDF for the preview). */
export async function blobUrl(path: string) {
  const headers: Record<string, string> = {};
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const r = await fetch(path, { headers });
  if (!r.ok) throw new ApiError(`Could not load the file (${r.status})`, r.status);
  return URL.createObjectURL(await r.blob());
}

export async function download(path: string, filename: string) {
  const headers: Record<string, string> = {};
  if (tenantId) headers['x-tenant-id'] = tenantId;
  const r = await fetch(path, { headers });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new ApiError(d.message ?? `Download failed (${r.status})`, r.status); }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Unit code → short label for tables ("kWh_e" → "kWh", "TRh" → "TRh", "kWh_gcv" → "kWh gross"). */
export function unitLabel(code: string): string {
  return code.replace(/_e$/, '').replace(/_th$/, ' heat').replace(/_c$/, ' cooling').replace(/_gcv$/, ' gross');
}

// ------------------------------------------------------------------ waste --
export interface WasteType { code: string; name: string; group: 'msw' | 'industrial' | 'sludge' | 'other'; dm: number; doc: number; cf: number | null; fcf: number; docf: number; decay: string; n2o: string; source: string; note?: string }
export interface WasteDefaults {
  types: WasteType[]; climates: Record<string, string>; k: Record<string, Record<string, number>>;
  landfillMcf: Record<string, { name: string; mcf: number }>; devices: Record<string, { name: string; de: number; source: string }>;
  incinerators: Record<string, { name: string; ch4: number; batch: boolean; n2oMsw: number }>;
  bio: Record<'composting' | 'ad', Record<'wet' | 'dry', { ch4: number; n2o: number }>>; adLeak: number;
  wastewater: Record<string, { name: string; domestic: number; industrial: number }>; bo: { BOD: number; COD: number };
  mcfDischarge: number; n2oPlant: number; n2oEffluent: number; msw: { composition: Record<string, number>; source: string };
}
export interface WasteSiteParams { climate?: string; siteType?: string; mcf?: number; ox?: number; f?: number; delayMonths?: number; composition?: Record<string, number>; overrides?: Record<string, { doc?: number; docf?: number; k?: number }>; source?: string }
export interface WasteSite { id: string; facility_id: string; facility: string; kind: 'landfill'; name: string; opened_year: number | null; closed_year: number | null; params: WasteSiteParams; note: string | null; active: boolean; entries: number; history: { first: number | null; last: number | null; tonnes: number; rows: number } | null; canEdit?: boolean }
export interface WasteDeposit { id: number; year: number; type: string; tonnes: number; source: string | null; estimated: boolean }

// ------------------------------------------------------------------ meters --
export type Frequency = 'hour' | 'day' | 'week' | 'month' | 'irregular';
export interface Meter {
  id: string; facility_id: string; facility: string; name: string; serial: string | null; external_id: string; account_no: string | null;
  reading_type: 'cumulative' | 'interval'; frequency: Frequency; unit: string; multiplier: number; rollover: number | null;
  item_id: number; item: string; item_code: string; category: string; category_name: string; calc_method: string; template: Record<string, unknown>;
  gap_fill: 'prorate' | 'none'; auto_entries: boolean; active: boolean; note: string | null;
  readings: number; last: { ts: string; value: number; received_at: string } | null; entries: number; canEdit?: boolean;
}
export interface MeterMonth {
  month: string; start: number; end: number; measured: number; consumption: number; coverage: number; readings: number; filled: boolean; closed: boolean; issues: string[];
  entry: { id: string; period_start: string; quantity: number; unit: string; status: string; data_type: string; co2e_direct: number; co2e_scope2: number; co2e_scope2_market: number; co2e_scope3: number; updated_at: string } | null;
}
export interface MeterDetail extends Meter { timezone: string; months: MeterMonth[]; issues: string[]; recent: { ts: string; from_ts: string | null; value: number; source: string; received_at: string }[] }
export interface SyncResult { created: number; updated: number; unchanged: number; locked: string[]; problems: string[] }
export interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }
export interface Bill {
  id: string; document_id: string; status: 'to_check' | 'confirmed' | 'rejected'; energy: string | null; supplier: string | null; account_no: string | null; bill_no: string | null;
  period_from: string | null; period_to: string | null; issue_date: string | null; quantity: number | null; unit: string | null; amount: number | null; currency: string | null;
  found: { missing?: string[]; problem?: string | null; matchedBy?: string | null; candidates?: { energy: string; value: number; unit: string; line: string; score: number }[];
    supplier?: { value: string; line: string }; account?: { value: string; line: string }; periodFrom?: { value: string; line: string }; quantity?: { value: number; unit: string; line: string }; amount?: { value: number; line: string } };
  scanned: boolean; meter_id: string | null; meter: string | null; facility_id: string | null; facility: string | null; meter_unit: string | null; reading_ts: string | null;
  note: string | null; checked_by_name: string | null; checked_at: string | null; created_at: string; filename: string; size: number;
}
