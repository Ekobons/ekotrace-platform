/**
 * Talking to the API. One function per call, typed results.
 * The chosen company travels in the x-tenant-id header (temporary, until login exists).
 */
export type Basis = 'direct' | 'wtt' | 'outside_scopes' | 'memo' | 'scope2' | 'scope2_market' | 'td_loss' | 'scope3';

export interface Item { id: number; subcategory_id: number; code: string; name: string; aliases: string[]; default_unit: string | null; gas_code: string | null; note: string | null; sort: number; active: boolean; composition: { gas: string; fraction: number }[] | null; hiddenForClient?: boolean; attrs?: VehicleAttrs }
/** Vehicle types: class, powertrain, the fuel it burns, electric / plug-in, distance factors or not. */
export interface VehicleAttrs { vehicle?: string; powertrain?: string; load?: string; fuel?: string | null; electric?: boolean; phev?: boolean; distance?: boolean }
export interface Subcategory { id: number; category_id: number; code: string; name: string; grp?: string | null; units: string[]; default_unit: string | null; is_bioenergy: boolean; sort: number; active: boolean; hiddenForClient?: boolean; items: Item[] }
export interface Category { id: number; scope: number; code: string; name: string; calc_method: 'combustion' | 'fugitive' | 'vehicle' | 'electricity' | 'waste' | 'waste_disposal' | 'spend' | 'travel' | 'water' | 'trip'; ghg_category?: number | null; description: string | null; active: boolean; subcategories: Subcategory[] }
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
export interface PlanLimits { code: string; name: string; facilities: number | null; users: number | null; ai: boolean; export: boolean; groups: boolean; note: string }
export interface Tenant { id: string; name: string; country: string; gwp_set: string; products?: ('ekotrace' | 'ekofin')[]; timezone?: string; currency?: string; has_logo?: boolean; consolidation?: string; base_year?: number; plan?: string; status?: string; access_expiry?: string; planLimits?: PlanLimits | null; flight_rf?: boolean; target_year?: number; target_s12?: number; target_s3?: number; due_day?: number; remind_days?: number; escalate_days?: number; year_start_month?: number; factor_year?: 'calendar' | 'fy_start' | 'fy_end' }
export type Role = 'platform_admin' | 'super_admin' | 'admin' | 'manager' | 'preparer' | 'verifier';
export interface Me { user: { id: string; name: string; email: string; role: Role; tenantId: string | null; scopeNodeId: string | null; mustChangePassword: boolean; via?: string; mfaEnrol?: boolean; mfa?: { enabled: boolean; required: boolean; recoveryLeft: number } }; company: (Tenant & { scope_name: string | null }) | null }
export interface OrgNode { id: string; parent_id: string | null; kind: 'group' | 'subgroup' | 'facility'; name: string; facility_type: string | null; location: string | null; country: string; floor_area_m2: number | null; employees: number | null; ownership_pct: number; operational_control: boolean; financial_control: boolean; active: boolean; sort: number; manager_user_id: string | null; manager_name: string | null; grid_region?: string | null; entries: number; canEdit: boolean; canSee: boolean; canEnter: boolean }
export interface Person { id: string; name: string; email: string; role: Role; scim_managed?: boolean; scope_node_id: string | null; scope_name: string | null; disabled: boolean; last_login_at: string | null; created_at: string; must_change_password: boolean; facilities: { id: string; name: string }[]; manages: { id: string; name: string }[]; canEdit: boolean }
export interface Company { id: string; name: string; country: string; gwp_set: string; plan: string; products?: ('ekotrace' | 'ekofin')[]; status: string; access_start: string; access_expiry: string; created_at: string; users: number; facilities: number; entries: number; last_login: string | null; notes: string | null; price: number | null; billing_currency: string; billing_cycle: 'annual' | 'monthly'; po_ref: string | null; billing_email: string | null }
export interface DashGroup { id: string; name: string; facilityIds: string[]; facilities: { id: string; name: string; parent: string | null }[]; created_by: string; created_by_name: string; created_at: string; canDelete: boolean }
export interface FacSummary { id: string; meters: number; vehicles: number; sites: number; entries: number; approved: number; months: number; t: number }
export const ROLE_LABEL: Record<Role, string> = { platform_admin: 'Platform admin', super_admin: 'Super admin', admin: 'Admin', manager: 'Manager', preparer: 'Data preparer', verifier: 'Verifier' };
export interface Facility { id: string; name: string; country: string; grid_region?: string | null; active: boolean; facility_type?: string | null; parent_name?: string | null; canEnter?: boolean; canApprove?: boolean }
export interface Factor { id: number; item_id: number; item: string; subcategory: string; basis: Basis; unit: string; co2e: number | null; region: string; valid_from: string; valid_to: string; status: string; version: number; supersedes_id: number | null; note: string | null; source: string; gwp_set: string | null; gases: { gas: string; kgPerUnit: number }[] | null }
export interface Activity { id: string; period_start: string; period_end: string; facility: string; category: string; item: string; quantity: number; unit: string; data_type: string; gwp_set: string; co2e_direct: number; co2e_wtt: number; co2_biogenic: number; co2e_memo: number; co2e_scope2?: number; co2e_scope2_market?: number; co2e_td?: number; co2e_scope3?: number; scope?: number; ghg_category?: number | null; waste_site?: string | null; meter?: string | null; meter_id?: string | null; status: string; created_at: string; vehicle?: string | null; vehicle_id?: string | null; category_code?: string; purchase_batch_id?: string | null }

// ------------------------------------------------------------- purchases --
export type PurchaseField = 'date' | 'description' | 'amount' | 'currency' | 'quantity' | 'unit' | 'supplier' | 'category' | 'gl' | 'po' | 'facility' | 'supplierEf' | 'supplierEfUnit' | 'capital' | 'supplierRef' | 'supplierCountry';
export type Columns = Partial<Record<PurchaseField, string | string[]>>;
export interface PurchaseMeta {
  fields: { field: PurchaseField; label: string }[]; fxMethod: 'month' | 'year' | 'fixed'; currency: string; aiMapping: boolean; aiAvailable: boolean; aiName: string | null;
  overlap: Record<string, string>; categories: { id: number; code: string; name: string; ghg_category: number }[]; factorSets: { code: string; title: string; n: number }[]; maxLines: number;
}
export interface UploadSheet { name: string; headerRow: number; headers: string[]; rows: string[][]; guess: Columns; signature: string; profile: { id: string; name: string; settings: { headerRow: number; columns: Columns; dateFormat: 'dmy' | 'mdy' | 'ymd'; currency: string; facilityId?: string | null; period?: { year?: number; month?: string } | null; sheet?: string } } | null }
export interface UploadResult { batchId: string; filename: string; kind: string; defaultCurrency: string; sheets: UploadSheet[] }
export type LineStatus = 'new' | 'problem' | 'unmapped' | 'flagged' | 'check' | 'excluded' | 'ready' | 'published';
export interface PurchaseBatch {
  id: string; name: string; source: 'upload' | 'manual' | 'api'; status: string; error: string | null; created_at: string; published_at: string | null; created_by_name: string | null;
  lines: number; ready: number; published: number; attention: number; usd: number; co2e: number; progress: { stage?: string; done?: number; total?: number } | null; job_status: string | null;
}
export interface BatchDetail {
  batch: PurchaseBatch & { settings: Record<string, unknown>; file: { filename: string; size: number } | null; external_ref: string | null };
  job: { id: number; kind: string; status: string; progress: { stage?: string; done?: number; total?: number }; error: string | null } | null;
  counts: { status: LineStatus; lines: number; usd: number; co2e: number }[]; byCategory: { category: string; lines: number; co2e: number; usd: number }[];
  byMethod: { method: 'spend' | 'supplier'; lines: number; co2e: number }[]; problems: { problem: string; lines: number }[];
  groups: { total: number; unmapped: number; flagged: number; capital_hint: number; check: number; fallback: number; excluded: number; moved: number; material: number; material_confirmed: number;
    co2e: number; co2e_material: number; co2e_confirmed: number; co2e_auto: number; auto: number; coverage: number }; facilitiesMissing: { value: string | null; lines: number }[];
  entries: { n: number; approved: number }; period: { from: string | null; to: string | null };
}
export interface PurchaseGroup {
  key: string; description: string; category_text: string | null; gl_account: string | null; supplier: string | null; lines: number; usd: number; co2e: number | null;
  item_id: number | null; item_name: string | null; naics: string | null; map_method: 'rule' | 'text' | 'ai' | 'manual' | 'code' | 'supplier' | 'gl' | 'category' | 'fallback' | null; confidence: number | null;
  candidates: { itemId: number; score: number; name?: string }[]; overlap: string | null; overlap_why: string | null; decision: 'keep' | 'move' | 'exclude' | null; target: string | null;
  capital: boolean; capital_why: string | null; material: boolean; confirmed: boolean; supplier_id: string | null; batch_co2e: number | null; statuses: Partial<Record<LineStatus, number>> | null;
}
export interface PublishedLine { id: number; row_no: number; file: string | null; date: string | null; month: string; facility: string; description: string; gl_account: string | null; category_text: string | null; po_ref: string | null; supplier: string | null; amount: number | null; currency: string | null; usd: number | null; category: string; item: string; estimate: boolean; method: string; co2e: number | null; activity_id: string; batch_id: string }
export interface PublishedLines {
  total: { lines: number; usd: number; co2e: number; entries: number; suppliers: number; estimated: number }; lines: PublishedLine[];
  options: { facilities: { id: string; name: string; co2e: number; n: number }[]; categories: { id: string; name: string; co2e: number; n: number }[]; items: { id: number; name: string; co2e: number; n: number }[]; months: string[] };
}
export interface CapitalItem { id: number; name: string; naics: string | null; group: string | null; capital: boolean; note: string | null; factor: number | null }
export interface PurchaseAccount { account: string; groups: number; lines: number; usd: number; co2e: number | null; capital_groups: number; accountType: 'purchase' | 'capital' | 'not_purchase' | null; itemId: number | null; item: string | null; decision: string | null; target: string | null }
export interface PurchaseLine {
  id: string; row_no: number; date: string | null; month: string | null; description: string; category_text: string | null; supplier_text: string | null; po_ref: string | null;
  facility: string | null; facility_text: string | null; amount: number | null; currency: string | null; quantity: number | null; unit: string | null; status: LineStatus;
  method: 'spend' | 'supplier' | null; item: string | null; co2e: number | null; usd: number | null; fx: number | null; fx_kind: string | null; cpi: number | null;
  problems: string[]; warnings: string[]; calc_error: string | null; dup_of: string | null; activity_id: string | null;
}
export interface SpendItem { id: number; name: string; naics: string | null; group: string; type?: string | null; listed?: boolean; co2e: number | null; unit: string | null; price_year: number | null; source: string | null }
export interface SpendTree { categories: { name: string; subcategories: { name: string; items: { id: number; name: string; type: string | null; naics: string | null; capital: boolean; co2e: number | null; unit: string | null; price_year: number | null }[] }[] }[] }
export interface SupplierDoc { id: string; filename: string; kind: string; size?: number; at?: string; by?: string; year?: number; from: 'staff' | 'portal' }
export type SupplierStage = 'not_engaged' | 'invited' | 'signed_in' | 'started' | 'submitted' | 'finished';
export interface SbtiMatch { name: string; status: string; classification: string | null; nearYear?: number | null; netZero: string | null; netZeroYear: number | null }
export interface Supplier { id: string; name: string; aliases: string[]; country: string | null; reference: string | null; contact_email: string | null; industry?: string | null; origin: string; active: boolean; lines: number; usd: number; co2e: number; supplier_lines: number; factors: number;
  kind?: 'current' | 'prospect'; department?: string | null; cdp_score?: string | null; climate_target?: string | null; stage?: SupplierStage; rq_year?: number | null;
  score?: number; letter?: string; ghgReport?: boolean; sbti?: boolean; completion?: number | null; sbtiList?: SbtiMatch | null;
  review?: 'ok' | 'possible_duplicate'; duplicate_of?: string | null; duplicate_of_name?: string | null; duplicate_score?: number | null; completeness?: number }
export interface SupplierProfile extends Supplier { note: string | null; norm: string; trn: string | null; website: string | null; size: string | null; contact_name: string | null; reports_emissions: string | null; climate_target: string | null; created_at: string;
  cdp_year: number | null; target: { reductionPct?: number | null; baseYear?: number | null; targetYear?: number | null; netZeroYear?: number | null; scopes?: string | null; source?: string | null } | null }
export interface SupplierEngagement {
  stage: SupplierStage; request: { id: string; year: number; status: string } | null; score: number; letter: string; ghgReport: boolean; sbti: boolean; completion: number | null; sbtiList: SbtiMatch | null;
  parts: { key: string; label: string; points: number; max: number; note: string }[]; actions: string[];
}
export interface EngagementData {
  year: number; years: number[]; total: number; suppliers: number;
  sbti: { key: string; kg: number; n: number; share: number }[]; cdp: { key: string; kg: number; n: number; share: number }[]; letters: { key: string; kg: number; n: number; share: number }[]; stages: { key: string; kg: number; n: number; share: number }[];
  notSbtiByCountry: { key: string; kg: number }[]; notSbtiByCategory: { key: string; kg: number }[]; lowByCategory: { key: string; kg: number }[]; lowByCountry: { key: string; kg: number }[];
  trajectory: { years: number[]; rows: { id: string; name: string; country: string; category: string; kg: number; stage: string; letter: string; score: number; sbti: string; cdp: string; cred: 'high' | 'average' | 'weak'; path: number[];
    target: { pct?: number; base?: number; ty?: number | null; nz?: number | null; rate?: number } | null }[] };
  sbtiList: { rows: number; imported_at: string | null; filename: string | null; demo: boolean | null; matched: number }; canImportSbti: boolean;
}
export interface SupplierImportResult { committed: boolean; columns: Record<string, string>; totals: { new: number; update: number; same: number; error: number }; created: number; updated: number; rows: { row: number; name: string; action: 'new' | 'update' | 'same' | 'error'; detail: string }[] }
export interface SupplierName { id: number; name_seen: string; method: string; score: number | null; confirmed: boolean; lines: number }
export interface SupplierReview {
  duplicates: { id: string; name: string; country: string | null; reference: string | null; score: number | null; other_id: string; other_name: string; other_country: string | null; other_reference: string | null; lines: number; other_lines: number }[];
  autoLinked: { id: number; name_seen: string; similar_to: string | null; score: number | null; created_at: string; supplier_id: string; supplier: string; lines: number }[];
}
type Amt = { usd: number | null; co2e: number | null };
export interface SupplierAnalytics {
  year: number; years: number[];
  totals: { suppliers: number; lines: number; usd: number; co2e: number; co2e_supplier: number; no_supplier: number };
  byCountry: ({ country: string; suppliers: number } & Amt)[]; byItem: ({ group: string; item: string | null; suppliers: number } & Amt)[]; bySector: ({ sector: string } & Amt)[];
  byScope3: ({ category: string } & Amt)[]; byMonth: ({ month: string; co2e_supplier: number | null } & Amt)[];
  top: { id: string; name: string; country: string | null; industry: string | null; usd: number; co2e: number; lines: number; own_factor: boolean; completeness: number; main_item: string | null }[];
  concentration: { suppliers: number; n50: number; n80: number };
  profiles: { suppliers: number; country: number; reference: number; industry: number; contact: number; reports: number; target: number; own_factor: number; review: number };
  targets: { target: string; suppliers: number; co2e: number | null }[];
}
type S3 = { s1: number | null; s2: number | null; s3: number | null };
export interface Dashboard {
  year: number; years: number[]; consolidation: string; baseYearValue: number | null; scope2: 'location' | 'market';
  totals: S3 & { biogenic: number | null; memo: number | null; s2_location: number | null; s2_market: number | null; entries: number; approved: number; estimated: number; total: number };
  previous: { year: number; total: number }; baseYear: { year: number; total: number } | null;
  monthly: ({ m: number } & S3)[]; annualOnly: number;
  byCategory: (S3 & { code: string; name: string; scope: number; ghg_category: number | null; co2e: number })[];
  byFacility: (S3 & { id: string; name: string; parent: string | null; facility_type: string | null; co2e: number })[];
  scope3: { cat: number; name: string; co2e: number }[]; top: { item: string; category: string; scope: number; co2e: number }[];
  coverage: { id: string; name: string; months: number[] }[];
  quality: { supplier_lines: number; spend_lines: number; supplier_co2e: number; spend_co2e: number };
}
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

// ------------------------------------------------- metric registry, calendar, inbox --
export type Freq = 'monthly' | 'quarterly' | 'annual';
export interface MetricData {
  name: string; definition: string; category_code: string; item_ids: number[]; unit: string | null; owner_user_id: string | null; facility_types: string[]; facility_ids: string[];
  required: boolean; level: 'facility' | 'company'; source_system: string | null; methods: string[]; frequency: Freq; due_day: number | null; due_months: number; check_pct: number | null; evidence: 'required' | 'optional'; active: boolean;
}
export interface Metric extends MetricData { id: string; code: string; version: number; category: string; scope: number; owner_name: string | null; unit_name: string | null; unit_dim: string | null; pending: number; updated_at: string; updated_by: string | null }
export interface MetricChange { id: string; metric_id: string | null; code: string | null; name: string; proposal: MetricData; reason: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; proposed_name: string | null; proposed_at: string; decided_name: string | null; decided_at: string | null; decision_note: string | null; mine: boolean; changes: Record<string, [unknown, unknown]> }
export interface MetricList {
  metrics: Metric[]; changes: MetricChange[]; categories: { code: string; name: string; scope: number; items: { id: number; name: string; sub: string }[] }[];
  units: { code: string; name: string; dimension: string; to_base: number }[]; users: { id: string; name: string; role: Role }[]; facilities: { id: string; name: string; type: string | null }[];
  facilityTypes: string[]; methods: string[]; settings: { dueDay: number; checkPct: number }; canEdit: boolean; canApprove: boolean;
}
export interface MetricVersion { version: number; changes: Record<string, [unknown, unknown]> | null; reason: string; changed_by: string | null; approved_by: string | null; at: string }
export interface PersonRef { id: string; name: string }
export type ObStatus = 'approved' | 'submitted' | 'in_progress' | 'missing' | 'excused';
export type ObTiming = 'done' | 'upcoming' | 'due_soon' | 'overdue' | 'escalated';
export interface Obligation {
  key: string; level: 'facility' | 'company'; facilityId: string; facility: string; facilityType: string | null; metricId: string; metricCode: string; metric: string; category: string; scope: number; frequency: Freq;
  period: string; periodEnd: string; label: string; due: string; status: ObStatus; timing: ObTiming; daysLate: number; completedAt: string | null; late: boolean;
  owner: PersonRef | null; responsible: PersonRef[]; escalateTo: PersonRef[]; evidence: 'required' | 'optional'; withoutEvidence: number; entries: number; quantity: number | null; unit: string | null; otherUnits: number;
  exception: { reason: string; by: string | null; at: string } | null; reminders: { kind: string; at: string }[]; canChase?: boolean; canEnter?: boolean;
}
export interface CycleSettings { dueDay: number; remindDays: number; escalateDays: number; timezone: string; reminders: boolean }
export interface CalendarData { year: number; today: string; settings: CycleSettings; mailOn: boolean; me: string; obligations: Obligation[]; canSettings: boolean }
export interface Notice { id: number; kind: string; title: string; body: string | null; link: string | null; at: string; read_at: string | null }
export interface InboxData {
  today: string; mine: Obligation[]; escalations: Obligation[]; upcoming: Obligation[]; approvals: number; drafts: number; metricChanges: number; findings: number; restatements?: number; credits?: number;
  returned: { id: string; f: string; facility: string; cat: string; category: string; item: string; month: string; note: string | null; by: string | null; at: string | null }[];
  notifications: Notice[]; unread: number; emailNotify: boolean; mailOn: boolean;
}

// ------------------------------------------------------------ base-year restatement --
export interface Restatement {
  id: string; base_year: number; trigger: string; title: string; description: string; facility_id: string | null; facility: string | null; facility_active: boolean | null; effective: string | null;
  s1: number; s2: number; s2m: number | null; s3: number; document_id: string | null; document: string | null; force: boolean; status: 'pending' | 'approved' | 'rejected' | 'withdrawn'; applied: boolean;
  applied_at: string | null; applied_with_title: string | null; base_before: number | null; pct: number | null; proposed_name: string | null; proposed_at: string; decided_name: string | null; decided_at: string | null; decision_note: string | null; mine: boolean;
}
export interface RestatementData {
  baseYear: number; threshold: number; measured: { s1: number; s2: number; s2m: number; s3: number; total: number }; restated: { s1: number; s2: number; s2m: number; s3: number; total: number };
  recorded: { n: number; net: number; pct: number }; items: Restatement[]; triggers: Record<string, string>; facilities: { id: string; name: string; active: boolean }[]; documents: { id: string; name: string }[];
  canPropose: boolean; canDecide: boolean; canSettings: boolean;
}

// ------------------------------------------------------------ supplier portal --
export interface SupplierRequestRow {
  id: string; supplier_id: string; supplier: string; country: string | null; year: number; contact_name: string | null; email: string; due_date: string | null; expires_at: string | null; revoked: boolean;
  status: import('./supplierPortal').SPStatus; submitted_at: string | null; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; last_used_at: string | null; created_by: string | null;
  created_at: string; has_code: boolean; documents: number; kg: number; usd: number; progress: import('./supplierPortal').SPProgress; derived: import('./supplierPortal').SPDerived;
}
export interface SupplierPortalData {
  year: number; requests: SupplierRequestRow[]; suggest: { id: string; name: string; country: string | null; contact_email: string | null; kg: number; usd: number; has_factor: boolean }[];
  totalKg: number; statusText: Record<string, string>; canManage: boolean;
}
export interface SupplierRequestDetail extends Omit<SupplierRequestRow, 'documents' | 'kg' | 'usd'> {
  message: string; answers: import('./supplierPortal').SPAnswers; documents: import('./supplierPortal').SPDoc[]; submitted_by: string | null; supplier_country: string | null; climate_target: string | null;
  applied: { profile: string[]; factors: { id: string; kind: string; co2e: number; unit: string }[]; linesRecalculated: number } | null;
  factors: { id: string; co2e: number; unit: string; item_id: number | null; item: string | null; valid_from: string; valid_to: string; source: string; request_id: string | null }[]; canManage: boolean; issues: string[];
}

// ------------------------------------------------------------ batch runs --
export interface BatchCheck { id: string; name: string; ok: boolean | null; detail: string }
export type Recon = 'balanced' | 'differences' | 'open' | 'no_control' | 'failed';
export interface BatchRow {
  id: string; name: string; source: 'upload' | 'manual' | 'api'; external_ref: string | null; status: string; error: string | null; created_at: string; published_at: string | null; created_by_name: string | null;
  control: { lines?: number; amounts?: Record<string, number>; by?: string; at?: string } | null; lines: number; problem: number; excluded: number; dup: number; pending: number; published: number;
  pub_kg: number; no_entry: number; amounts: Record<string, number>; entries: number; approved: number; entry_kg: number; job_kind: string | null; job_status: string | null; job_error: string | null; job_attempts: number | null;
  recon: Recon; failedChecks: string[]; retry: boolean;
}
export interface ReadingBatchRow { id: string; client: string | null; status: 'review' | 'published' | 'discarded'; received: number; rejected: number; created_at: string; decided_at: string | null; decided_by: string | null; staged: Record<string, number>; result: Record<string, unknown> | null }
export interface IntegrationSource {
  id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null; expect_hours: number | null;
  runs: number; ok: number; partial: number; failed: number; received: number; accepted: number; rejected: number; last_run: string | null; last_ok: string | null; last_fail: string | null; last_error: string | null;
  health: 'healthy' | 'warning' | 'failing' | 'quiet' | 'never' | 'revoked'; quietHours: number;
}
export interface Transfer {
  id: string; client: string | null; api_key_id: string | null; source: string; endpoint: string; status: 'ok' | 'partial' | 'failed'; http_status: number; received: number; accepted: number; rejected: number;
  error: string | null; reference: string | null; ref_kind: string | null; ref_id: string | null; duration_ms: number | null; at: string; problems?: { index: number; reason: string }[];
}
export interface BatchesData {
  days: number; batches: BatchRow[]; readings: ReadingBatchRow[]; sources: IntegrationSource[]; transfers: Transfer[]; sourceText: Record<string, string>;
  channels: { uploads: { n: number; failed: number; review: number; last: string | null }; bills: { n: number; review: number; rejected: number; last: string | null } };
  canManage: boolean; seesSources: boolean;
}
export interface BatchRecon {
  batch: { id: string; name: string; source: string; reference: string | null; status: string; error: string | null; created_at: string; published_at: string | null; created_by: string | null; control: BatchRow['control'] };
  received: { lines: number; amounts: Record<string, number> }; outcomes: { outcome: string; lines: number; amounts: Record<string, number>; kg: number }[];
  entries: { status: string; n: number; kg: number }[]; checks: BatchCheck[]; state: Recon; problems: { row_no: number; description: string | null; problems: string[]; calc_error: string | null }[];
  missing: { row_no: number; description: string | null; kg: number }[]; runs: Transfer[]; jobs: { id: number; kind: string; status: string; attempts: number; error: string | null; created_at: string; finished_at: string | null }[];
  canControl: boolean; canRetry: boolean;
}

// ------------------------------------------------------------ carbon credits --
export interface CreditLot {
  id: string; project: string; project_id: string | null; registry: string; methodology: string | null; category: 'avoidance' | 'removal_nature' | 'removal_technical'; project_type: string | null; country: string | null;
  vintage: number; quantity: number; price: number | null; currency: string; supplier: string | null; contract_date: string | null; status: 'contracted' | 'delivered' | 'cancelled'; delivered_on: string | null;
  serials: string | null; ccp: boolean; corsia: boolean; ca: boolean; permanence: string | null; document_id: string | null; document: string | null; notes: string;
  created_name: string | null; created_at: string; updated_name: string | null; updated_at: string | null; retired: number; waiting: number; available: number;
}
export interface CreditRetirement {
  id: string; lot_id: string; project: string; registry: string; category: CreditLot['category']; vintage: number; quantity: number; retired_on: string; claim_year: number; purpose: string;
  serials: string | null; beneficiary: string | null; registry_url: string | null; document_id: string | null; document: string | null; note: string; status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  proposed_name: string | null; proposed_at: string; decided_name: string | null; decided_at: string | null; decision_note: string | null; mine: boolean;
}
export interface CreditSummary {
  year: number; gross: { s1: number; s2: number; s2m: number; s3: number; total: number }; retired: number; pending: number; net: number; byCategory: Record<string, number>; byPurpose: Record<string, number>;
  removalShare: number; cost: number; pipeline: { contracted: number; held: number; spend: number };
  netZero: { year: number; residPct: number; baseYear: number; baseTotal: number; residual: number; removalsHeld: number };
}
export interface CreditData {
  year: number; years: number[]; lots: CreditLot[]; retirements: CreditRetirement[]; summary: CreditSummary; categories: Record<string, string>; purposes: Record<string, string>; registries: string[];
  documents: { id: string; name: string }[]; canEdit: boolean; canDecide: boolean;
}
export interface CreditLotBody {
  project: string; projectId: string | null; registry: string; methodology: string | null; category: string; projectType: string | null; country: string | null; vintage: number; quantity: number;
  price: number | null; currency: string; supplier: string | null; contractDate: string | null; status: string; deliveredOn: string | null; serials: string | null; ccp: boolean; corsia: boolean; ca: boolean;
  permanence: string | null; documentId: string | null; notes: string;
}

// ------------------------------------------------------------ document vault --
export interface VaultDoc {
  id: string; kind: string; source: string; filename: string; contentType: string; size: number; uploadedAt: string; uploadedBy: string | null;
  type: string; typeName: string; title: string | null; facilityId: string | null; facility: string | null; periodFrom: string | null; periodTo: string | null;
  validUntil: string | null; expiry: 'expired' | 'soon' | 'valid' | null; note: string | null; tags: string[]; category: string | null; categoryName: string | null;
  version: number; replaced: boolean; archived: boolean; archiveReason: string | null; links: number; retainUntil: string; canEdit: boolean; billStatus: string | null;
}
export interface VaultList { docs: VaultDoc[]; total: number; types: Record<string, string>; canUpload: boolean; canUploadCompanyWide: boolean;
  kpis: { files: number; size: number; expiring: number; expired: number; unlinked: number; archived: number; retentionYears: number } }
export interface VaultMeta { type?: string; title?: string | null; facilityId?: string | null; periodFrom?: string | null; periodTo?: string | null; validUntil?: string | null; category?: string | null; note?: string | null; tags?: string[]; linkActivityIds?: string[] }
export interface VaultLink { id: string; period_start: string; period_end: string; facility: string; item: string; quantity: number; unit: string; status: string; linked_by: string | null; linked_at: string; locked: boolean; canUnlink: boolean }
export interface EvidenceFile { id: string; filename: string; content_type: string; size: number; type: string; typeName: string; title: string | null; uploaded_at: string; uploaded_by: string | null; how: 'linked' | 'meter bill' | 'collection scan'; linked_by: string | null; canUnlink: boolean }
// ------------------------------------------------------------ message centre --
export interface MsgThread { id: string; topic: string; subject: string; page: string | null; status: 'open' | 'answered' | 'closed'; created_at: string; last_at: string; last_body: string | null; n: number;
  by_name: string; by_email: string; by_role: Role; unread: boolean; created_by: string; company?: string; tenant_id?: string; plan?: string; closed_at: string | null }
export interface Msg { id: string; author_name: string; from_team: boolean; body: string; created_at: string; document_id: string | null; filename: string | null; content_type: string | null; size: number | null; author_id: string | null }
export interface Announcement { id: string; kind: 'news' | 'feature' | 'factors' | 'maintenance' | 'regulation'; title: string; body: string; published_at: string; published_by: string | null; expires_at: string | null; read?: boolean;
  tenant_ids?: string[] | null; companies?: string[] | null; reads?: number; withdrawn_at?: string | null }

// ------------------------------------------------------------------ security --
export interface SsoSettings { issuer: string; clientId: string; hasSecret: boolean; domains: string[]; enabled: boolean; enforce: boolean; requireMfa: boolean; redirectUri: string; updatedBy: string | null; updatedAt: string | null }
export interface SecuritySettings {
  mfaRequired: boolean; sso: SsoSettings; canEdit: boolean; idleMinutes: number; audit: { retentionMonths: number; siem: boolean };
  people: { id: string; name: string; email: string; role: Role; disabled: boolean; mfa: boolean; recovery_left: number; last_login_at: string | null; last_method: string | null }[];
}
export interface ScimSettings {
  token: { prefix: string; default_role: 'verifier' | null; created_by: string | null; created_at: string; last_used_at: string | null } | null; baseUrl: string;
  groups: { id: string; display_name: string; role: Role | null; scope_node_id: string | null; scope_name: string | null; facility_ids: string[]; members: number; updated_at: string }[];
  people: { managed: number; active: number };
}
export interface SecurityAlert { id: number; rule: string; severity: 'low' | 'medium' | 'high'; title: string; detail: Record<string, unknown> | null; at: string; ack_by: string | null; ack_at: string | null; ack_note: string | null }
export interface DestructionCertificate { id: string; tenant_id: string; company: string; country: string | null; requested_by: string; reason: string | null; performed_at: string; rows_deleted: Record<string, number>; files_deleted: number; export_sha256: string | null; backups_until: string; audit_until: string }
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: { field: string; message: string }[]) { super(message); }
}
/** Called when the session has ended, so the app can show the login page. */
let onUnauthenticated: () => void = () => {};
export function whenLoggedOut(fn: () => void) { onUnauthenticated = fn; }

export async function call<T>(method: string, path: string, body?: unknown, raw?: Blob, extra?: Record<string, string>): Promise<T> {
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

// ------------------------------------------------------------ employee commuting --
export type CommuteMode = 'car' | 'carpool' | 'motorbike' | 'taxi' | 'bus' | 'shuttle' | 'metro' | 'train' | 'active' | 'wfh';
export type Weekend = 'sat_sun' | 'fri_sat' | 'sun';
export interface CommuteOptions {
  modes: { key: CommuteMode; label: string; unit: 'km' | 'pkm' | null; item: string | null; perVehicle: boolean }[];
  fuels: { key: string; label: string }[];
  items: { code: string; name: string; sub: string; sub_name: string; unit: string; note: string | null }[];
  defaults: Record<Weekend, { weekdays: number; workingDays: number }>; holidays: number; leave: number;
}
export interface CommuteTypedRow { mode: CommuteMode; itemCode?: string; fuel?: string; employees: number; oneWayKm?: number; daysPerWeek?: number; occupants?: number; annualKm?: number }
export interface CommuteAnswer { row?: number; mode: CommuteMode; km?: number | null; days?: number | null; occupants?: number | null; fuel?: string; mode2?: CommuteMode | null; km2?: number | null }
export interface CommuteBody {
  facilityId: string; year: number; method: 'typed' | 'survey'; headcount: number; workingDays: number; weekend: Weekend; holidays?: number; leave?: number;
  rows?: CommuteTypedRow[]; answers?: CommuteAnswer[]; survey?: { file?: string; columns?: Record<string, string>; site?: string | null; unrecognised?: number }; note?: string | null;
}
export interface CommuteLine { item: string; name: string; mode: CommuteMode; fuel?: string; unit: 'km' | 'pkm'; quantity: number; personKm: number; people: number; measured: boolean; kg: number; perUnit: number; source: string | null }
export interface CommuteResult {
  lines: CommuteLine[]; personKm: number; kg: number; scale: number; respondents?: number; responseRate?: number;
  byMode: { mode: CommuteMode; label: string; people: number; share: number }[]; steps: string[]; warnings: string[];
}
export interface CommuteRecord {
  id: string; facility_id: string; facility: string; year: number; method: 'typed' | 'survey'; headcount: number; working_days: number; weekend: Weekend;
  rows: CommuteTypedRow[]; survey: CommuteBody['survey'] | null; result: CommuteResult & { settings?: { holidays: number | null; leave: number | null } }; note: string | null;
  updated_at: string; updated_by_name: string | null; entries: number; approved: number; answers: number;
  survey_id: string | null; survey_name: string | null;
}
export interface SurveyRead {
  file: string; headers: string[]; columns: Record<string, string>; answers: CommuteAnswer[]; blank: number; otherSite: number; site: string | null;
  sites: { value: string; count: number }[]; unrecognised: { value: string; count: number }[];
}

// ------------------------------------------------------------- business travel --
export interface TripOptions {
  rf: boolean; classes: { key: string; label: string }[]; hauls: { key: string; label: string; hint: string }[]; typicalKm: Record<string, number>;
  airKg: Record<string, number>; hotelClasses: { stars: number; label: string; regions: string[]; meetingRegions: string[] }[]; meetingRegions: string[]; rooms: { key: string; label: string; sqm: number }[]; uplift: number; shortHaulMaxKm: number; country: string;
  hotels: { itemId: number; country: string; iso: string | null; co2e: number | null; factorYear: number | null }[];
  ground: { itemId: number; code: string; name: string; group: string; sub: string; unit: string; note: string | null }[];
}
export interface AirportHit { iata: string; name: string; city: string; country: string; countryName: string }

// ------------------------------------------------------------- home & KPIs --
export interface RepLine {
  id: string; f: string; facility: string; m: number; from: string; to: string; cat: string; category: string; scope: number; g3: number | null; code: string; item: string; note: string | null;
  qty: number; unit: string; dataType: string; method: string | null; s1: number; s2: number; s2m: number; s3: number; s33: number; w: number;
  captured: 'meter' | 'batch' | 'commute' | 'fleet' | 'form'; evidence: boolean; source: string | null; status: string; asset: string | null;
  country?: string | null; division?: string | null; bio?: number; gases?: Record<string, number> | null;
}
export interface RepCheck { id: string; name: string; area: string; n: number; items: string[]; justified: { text: string; by: string | null; at: string } | null }
export interface RepTemplate { id: string; base: string | null; name: string; audience: string | null; note: string | null; sections: string[] }
export interface RepVersion { id: string; name: string; label: string; period: string; scope2: 'location' | 'market'; s1: number; s2: number; s3: number; byCode: Record<string, number>; by: string | null; at: string }
export interface RepEntity { legal?: string; licence?: string; lei?: string; region?: string; emirate?: string; sector?: string; sectorCode?: string; mrvId?: string; contact?: string; website?: string; revenue?: number | null; revenueCurrency?: string; fyEnd?: string }
export interface RepSettings {
  company: { name: string; country: string; consolidation: string; gwp: string; baseYear: number | null; currency?: string; hasLogo?: boolean }; entity: RepEntity; excl: Record<string, string>;
  restatements?: { title: string; trigger: string; facility: string | null; effective: string | null; s1: number; s2: number; s2m: number; s3: number; pct: number | null; applied: boolean; proposed_name: string | null; decided_name: string | null; decided_at: string }[]; restateThreshold?: number;
  credits?: { claim_year: number; t: number; retired_on: string; purpose: string; serials: string | null; registry_url: string | null; project: string; project_id: string | null; registry: string; category: string; vintage: number; ccp: boolean; ca: boolean; corsia: boolean }[];
  templates: RepTemplate[]; versions: RepVersion[]; canEntity: boolean; canEdit: boolean;
}
export interface ApprovalSettings { l2: boolean; minT: number; cats: string[]; checkPct: number; checkMethod?: 'avg6' | 'smart'; selfApproval: boolean; selfMaxT: number | null }
export interface RangeCheck { ok: boolean; txt: string; method: 'avg6' | 'smart'; expected: number; low: number; high: number; basis: string; usual: number }
export interface ApprovalRow {
  id: string; f: string; facility: string; month: string; cat: string; category: string; item: string; note: string | null; dataType: string; qty: number; unit: string; kg: number;
  by: string | null; enteredBy?: string | null; source?: string | null; at: string | null; stage: 'L2' | null; l1: string | null; mine: boolean; self?: boolean; canApprove: boolean; waitingFor: string; check: RangeCheck | null; willNeedL2: boolean;
}
export interface ApprovalsData { settings: ApprovalSettings; mine: ApprovalRow[]; others: ApprovalRow[]; categories: { code: string; name: string; scope: number }[]; canSettings: boolean }
export interface HomeData {
  year: number; solo: boolean; users: number;
  settings: { dueDay: number; remindDays: number; escalateDays: number; baseYear: number | null; target: { year: number; s12: number; s3: number }; plan: string; accessExpiry: string | null };
  facilities: { id: string; name: string; type: string | null; employees: number | null; area: number | null; parent: string | null; manager: string | null; usual: string[] }[];
  cells: { f: string; cat: string; m: number; draft: number; submitted: number; approved: number; rejected: number; sub: string | null }[];
  approvals: { id: string; f: string; facility: string; cat: string; category: string; item: string; month: string; qty: number; unit: string; kg: number; by: string | null; at: string | null; warn: string | null }[];
  mine: { id: string; f: string; facility: string; cat: string; category: string; item: string; month: string; status: 'draft' | 'rejected' | 'submitted'; review_note: string | null; reviewed_by: string | null }[];
  batches: { review: number; failed: number };
  verifier: { n: number; evidence: number; self: number; sample: { id: string; facility: string; category: string; month: string; kg: number; approved_by: string | null; self_reviewed: boolean; evidence: boolean }[] };
}
export type ActStatus = 'Idea' | 'Approved' | 'In progress' | 'Done';
export interface RAction {
  id: string; lib: string | null; name: string; cat: string; scopes: number[]; kpi: string | null; objVal: number | null; start: number; end: number; abate: number;
  capex: number; opex: number; saving: number; life: number; status: ActStatus; owner: string | null; facilityId: string | null; facility: string | null; excluded: boolean;
  actual: number | null; actualNote: string | null; capexMeth: string | null; opexMeth: string | null; comment: string | null; scenarioIds: string[]; updatedAt: string;
}
export interface Sbti { type: string; scopes: string; cov12: number; cov3: number; ambition: string; status: string; growth: number; nzYear: number; resid: number; template: string | null }
export interface TargetsData {
  baseYear: number | null; currency: string; target: { year: number; s12: number; s3: number }; sbti: Sbti;
  objectives: { id: string; name: string; scope: string; year: number; pct: number; growth: number }[];
  scenarios: { id: string; name: string; isDefault: boolean }[]; defaultScenario: string; actions: RAction[];
  levers: { id: string; name: string; levers: Record<string, number>; end: number; year: number; at: string }[];
  supplierCoverage: number; canTarget: boolean; canAct: boolean; facilities: string[];
}
export type ActionInput = Partial<Omit<RAction, 'id' | 'facility' | 'updatedAt'>>;
export interface KpiConfig { list: string[]; targets: Record<string, Record<string, number>>; canTarget: boolean; canChoose: boolean }

// ------------------------------------------------------------- review --
export interface StatusCell { cat: string; m: number; draft: number; submitted: number; approved: number; rejected: number }
export interface DataStatus { facility: { id: string; name: string; type: string | null; manager: string | null }; approver: string; canEnter: boolean; canApprove: boolean; usual: string[]; cells: StatusCell[] }
export interface ReviewEntry {
  id: string; period_start: string; period_end: string; item: string; quantity: number; unit: string; data_type: string; note: string | null; status: 'draft' | 'submitted' | 'approved' | 'rejected';
  kg: number; scope: number; category: string; category_name?: string; ghg_category?: number | null; purchase?: boolean; review_note: string | null; submitted_at: string | null; reviewed_at: string | null; entered_by: string | null; reviewed_by_name: string | null;
  vehicle: string | null; meter: string | null; waste_site: string | null; mine: boolean; selfApprove?: boolean; canApprove: boolean; canReturn: boolean; canSubmit: boolean; canWithdraw: boolean; canDelete: boolean;
}

// ------------------------------------------------------------------ surveys --
export interface SurveyAnswerBody { days: number; wfh: number; legs: { mode: string; km: number }[]; fuel: string; occ: number }
export interface Survey {
  id: string; name: string; year: number; close_at: string | null; weeks: number; wfh: boolean; facility_ids: string[]; headcount: Record<string, number>;
  status: 'draft' | 'open' | 'closed' | 'published'; created_at: string; published_at: string | null; published_by_name?: string | null;
  published?: { facilityId: string; name: string; t: number; entries?: number; status: string; reason?: string }[] | null;
  invited?: number; answered?: number; est?: number; N?: number; canManage?: boolean;
}
export interface SurveyFacResult { id: string; name: string; N: number; n: number; invited: number; rate: number; mean: number; t: number; moe: number | null; useG: boolean; low: boolean; fromFacility: boolean }
export interface SurveyResults {
  facs: SurveyFacResult[]; tot: number; totLo: number; totHi: number; n: number; N: number; gMean: number; modes: Record<string, number>;
  byItem: Record<string, { name: string; q: number; unit: string; t: number }>; byDept: Record<string, { n: number; kg: number }>;
}
export interface SurveyPerson { id: string; name?: string; email?: string | null; facility_id: string; facility: string; department: string | null; code?: string; sent_at?: string | null; answered_at: string | null; entered_by?: string | null }
export interface SurveyDetail {
  survey: Survey; facilities: { id: string; name: string; employees: number | null }[]; results: SurveyResults; people: SurveyPerson[];
  answers: { id: string; participant_id: string; facility_id: string; facility: string; answers: SurveyAnswerBody; updated_at: string; entered_by: string | null; kg: number }[];
  canManage: boolean; canPublish: boolean; link: string;
}
export interface SurveyOptions { modes: { key: string; label: string }[]; fuels: { key: string; label: string }[]; statuses: Record<string, string> }
export interface PublishRow { facilityId: string; name: string; t: number; entries?: number; status: 'ok' | 'skipped'; reason?: string; replaces?: string | null }

// ------------------------------------------------------------- QR & field app --
export interface Bin { id: string; code: string; facilityId: string; facility: string; name: string; location: string | null; itemId: number; item: string; material: string | null; route: string | null;
  gri: string | null; hazardous: boolean; contractor: string | null; capacityL: number | null; density: number | null; active: boolean; lastScan?: string | null; monthKg?: number; openScans?: number }
export interface Scan { id: string; bin?: string; item?: string; kind: 'weigh' | 'fill' | 'collection'; kg: number; fillPct?: number | null; estimated: boolean; manifest: string | null; note?: string | null; flags: string[]; at: string; by: string | null; status: 'open' | 'rolled' | 'void'; activityId?: string | null }
export interface Rollup { start: string; end: string; rolled: number;
  perBin: { bin: string; item: string; basis: string; actualKg: number; estimatedKg: number; scans: number; manifests: string[] }[];
  groups: { itemId: number; item: string; gri: string | null; hazardous: boolean; contractor: string | null; actual: number; estimated: number; manifests: string[]; bins: string[]; scans: number }[] }
export interface Contractor { id: string; name: string; email: string; contact: string | null; expiresAt: string | null; revoked: boolean; lastUsed: string | null; hasCode: boolean; bins: number; lastCollection: string | null }
export interface StatementRec { contractorId: string; contractor: string; ours: number; theirs: number | null; gapPct: number | null; flagged: boolean;
  statement: { id: string; lines: unknown[]; documentId: string | null; note: string | null; status: 'submitted' | 'accepted' | 'queried'; reviewNote: string | null; reviewedBy: string | null; submittedAt: string } | null;
  lines: { facility: string; item: string; ours: number; theirs: number | null; gapPct: number | null }[] }
export interface AssuranceData {
  standards: string[];
  engagement: { standard: string; level: 'limited' | 'reasonable'; provider: string | null; lead: string | null; scope: string | null; materiality: number | null; status: 'planning' | 'fieldwork' | 'reporting' | 'issued';
    opinion: string | null; issuedOn: string | null; statementId: string | null; statementName: string | null; updatedBy: string | null; updatedAt: string } | null;
  kpis: { approved: number; evidencePct: number; totalT: number; openFindings: number; openImpactT: number };
  months: { month: string; approved: number; open: number; ready: boolean; lock: { lockedBy: string | null; lockedAt: string; reason: string | null } | null }[];
  samples: { id: string; method: 'random' | 'value'; seed: number; size: number; keyItems: number; population: number; populationT: number; by: string | null; at: string; tested: number; exceptions: number }[];
  findings: AFinding[];
  can: { admin: boolean; verify: boolean; respond: boolean };
}
export interface AFinding { id: string; severity: 'low' | 'medium' | 'high'; kind: string; text: string; impactT: number | null; status: 'open' | 'responded' | 'closed'; response: string | null; respondedBy: string | null; respondedAt: string | null;
  raisedBy: string | null; raisedAt: string; closedBy: string | null; closedAt: string | null; closeNote: string | null; activityId: string | null; facility: string | null; item: string | null; period: string | null }
export interface SampleItem { id: string; key: boolean; result: 'agreed' | 'exception' | null; note: string | null; testedBy: string | null; testedAt: string | null; facility: string; from: string; to: string; category: string; item: string;
  qty: number; unit: string; t: number; source: string | null; dataType: string; entryNote: string | null; evidence: boolean; evidenceKind: string | null; enteredBy: string | null; approvedBy: string | null; approvedAt: string | null }
export interface AssurancePack { company: string; consolidation: string; gwp: string; baseYear: number | null; totals: { s1: number; s2l: number; s2m: number; s3: number; bio: number; n: number; self?: number };
  restatements?: { title: string; trigger: string; facility: string | null; t: number; pct: number | null; status: string; applied: boolean; proposed_name: string | null; decided_name: string | null; decided_at: string; decision_note: string | null }[];
  credits?: { retired_on: string; t: number; purpose: string; serials: string | null; registry_url: string | null; status: string; project: string; registry: string; category: string; vintage: number; proposed_name: string | null; decided_name: string | null }[];
  sources: { source: string; n: number }[]; trail: { at: string; user: string | null; action: string; entityId: string | null; detail: unknown }[] }
export type BinInput = { facilityId: string; name: string; location?: string; itemId: number; gri?: string; hazardous: boolean; contractor?: string; capacityL?: number; density?: number };

const qs = (q: Record<string, unknown>) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)]));
// ---------------------------------------------------------------- product LCA --
export interface LciFactor { id: string; code: string; name: string; unit: string; co2e: number; stage: string; source: string; indicative: boolean; own: boolean }
export interface LcaProduct {
  id: string; name: string; description: string; supplier_id: string | null; supplier: string | null; item_id: number | null; item: string | null; declared_unit: string; fu: string;
  boundary: string; standard: string; allocation: string; cutoff: string; ref_year: number; notes: string; status: 'draft' | 'review' | 'verified' | 'published'; version: number;
  created_name: string | null; last_edit_name: string | null; updated_at: string; sent_name: string | null; sent_at: string | null; verified_name: string | null; verified_at: string | null; review_note: string | null;
  published_factor: number | null; published_at: string | null; published_name: string | null; supplier_ef_id: string | null; changed_since_publish: boolean; lines: number;
  total?: number; stages?: Record<string, number>; dq?: number | null; inputs?: number;
}
export interface LcaLine { id: string; name: string; stage: string; qty: number; unit: string; co2e_per_unit: number; lci_id: string | null; lci_name?: string | null; dq: string; source: string; kg: number; counted: boolean; share: number }
export interface LcaScenario { id: string; name: string; changes: { inputId: string; lciId?: string | null; qty?: number | null; co2e?: number | null }[]; created_name: string | null; total: number; stages: Record<string, number>; dq: number | null; delta: number; pct: number }
export interface LcaData {
  products: (LcaProduct & { total: number; stages: Record<string, number>; dq: number | null; inputs: number })[]; library: LciFactor[];
  stages: Record<string, string>; boundaries: Record<string, string>; dqLabels: Record<string, string>; dqWeights: Record<string, number>;
  counts: { products: number; published: number; review: number; suppliers: number; purchaseLines: number; purchaseT: number; indicative: number };
  can: { edit: boolean; publish: boolean; library: boolean };
}
export interface LcaDetail {
  product: LcaProduct; inputs: LcaLine[]; result: { total: number; stages: Record<string, number>; dq: number | null; excluded: number };
  hotspots: LcaLine[]; levers: { inputId: string; input: string; to: string; toId: string; saves: number; pct: number }[]; scenarios: LcaScenario[];
  publications: { id: string; version: number; factor: number; declared_unit: string; stages: Record<string, number>; dq: number | null; verified_name: string | null; published_name: string | null; published_at: string }[];
  can: { edit: boolean; submit: boolean; verify: boolean; publish: boolean };
}
export interface LcaProductBody { name: string; description: string; supplierId: string | null; itemId: number | null; declaredUnit: string; fu: string; boundary: string; standard: string; allocation: string; cutoff: string; refYear: number; notes: string; copyFrom?: string | null }
export interface LcaInputBody { name: string; stage: string; qty: number; unit: string; co2ePerUnit: number | null; lciId: string | null; dq: string; source: string }
export interface LcaImportLine { row: number; name: string; stage: string | null; qty: number | null; unit: string; co2e: number | null; lciId: string | null; lciName: string | null; problems: string[] }

// ---------------------------------------------------------------------- CBAM --
export interface CbamCategory { sector: string; name: string; routes: string[]; params: { key: string; label: string; unit: string }[] }
export interface CbamSee { seeDirect: number | null; seeIndirect: number | null; seeTotal: number | null; directTotal: number; indirectTotal: number; defaultShare: number; counted: boolean }
export interface CbamInstallation {
  id: string; name: string; facility_id: string | null; facility: string | null; registry_id: string | null; unlocode: string | null; address: string | null; city: string | null; postcode: string | null; country: string;
  lat: number | null; lon: number | null; operator_name: string | null; operator_reg: string | null; operator_address: string | null; operator_country: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; notes: string;
  processes: { id: string; category: string; route: string; name: string }[]; reports: { id: string; year: number; status: string; verifier_name: string | null; verification_date: string | null }[];
}
export interface CbamRef { id: string; kind: 'default' | 'benchmark' | 'price'; cn: string | null; country: string | null; route: string | null; year: number; quarter: number | null; value: number; source: string; indicative: boolean; own: boolean }
export interface CbamData {
  year: number; installations: CbamInstallation[]; facilities: { id: string; name: string; country: string }[];
  reports: { id: string; installation_id: string; year: number; status: string; lines: { id: string; process: string; category: string; categoryName: string; route: string; activity_t: number | null; goods: string[]; see: CbamSee }[] }[];
  imports: { lines: number; mass: number; embedded: number; certificates: number; cost: number; problems: number };
  categories: Record<string, CbamCategory>; sectors: Record<string, string>; cn: [string, string, string][]; references: CbamRef[]; cbamFactor: number; markup: { other: number; fertilisers: number }; can: { edit: boolean };
}
export interface CbamPrecursor { id: string; category: string; cn: string | null; origin: string | null; quantity_t: number; see_direct: number; see_indirect: number; source: string; supplier: string | null; installation_ref: string | null; period: string | null }
export interface CbamLine { id: string; process_id: string; process: string; category: string; categoryName: string; sector: string; route: string; activity_t: number | null; direct_t: number | null; elec_mwh: number | null; default_share: number; params: Record<string, string>; precursors: CbamPrecursor[]; goods: { id: string; cn: string; description: string; quantity_t: number | null }[]; see: CbamSee }
export interface CbamReport {
  report: { id: string; installation_id: string; installation: string; registry_id: string | null; country: string; year: number; period_start: string; period_end: string; status: 'draft' | 'verified' | 'shared'; elec_ef: number | null; elec_ef_source: string | null; monitoring_plan: string | null;
    verifier_name: string | null; verifier_accreditation: string | null; verifier_country: string | null; verification_date: string | null; site_visit_date: string | null; opinion: string | null;
    carbon_price: { instrument: string; country: string; eurPerT: number | null; amount: number | null; currency: string; rebate: string; evidence: string } | null; notes: string; shared_with: string; updated_name: string | null; updated_at: string };
  lines: CbamLine[]; inventory: { s1: number; s2: number; total: number } | null; can: { edit: boolean; reopen: boolean };
}
export interface CbamImport {
  id: string; year: number; import_date: string | null; quarter: number; cn: string; description: string; origin: string; mass: number; procedure: string | null; customs_ref: string | null; supplier: string | null;
  installation: string | null; installation_id_reg: string | null; route: string | null; report_id: string | null; source: 'actual' | 'default'; see_direct: number | null; see_indirect: number | null; default_value: number | null; benchmark: number | null;
  carbon_price_eur: number | null; verifier_ref: string | null; notes: string; sector: string; category: string | null; categoryName: string | null; defaultUsed: number | null; defaultFromLibrary: boolean; benchmarkUsed: number | null; benchmarkFromLibrary: boolean;
  calc: { see: number | null; markup: number; embedded: number | null; sefa: number; faa: number; priceDeduct: number; certificates: number | null; price: number | null; cost: number | null; problems: string[] };
}

export interface EsgFramework { code: string; name: string; region: string; materiality: 'double' | 'impact' | 'financial' | 'none'; who: string; note: string }
export interface EsgImpact { type?: 'actual' | 'potential'; nature?: 'negative' | 'positive'; scale?: number; scope?: number; irremediability?: number; likelihood?: number; humanRights?: boolean; where?: ('upstream' | 'own' | 'downstream')[]; description?: string }
export interface EsgFinancial { kind?: 'risk' | 'opportunity'; magnitude?: number; likelihood?: number; horizon?: 'short' | 'medium' | 'long'; description?: string }
export interface EsgTopic {
  code: string; pillar: 'E' | 'S' | 'G'; name: string; sub: string; refs: Record<string, string>; likely: boolean; impact: EsgImpact | null; financial: EsgFinancial | null; impactScore: number | null; financialScore: number | null;
  override: boolean | null; material: boolean; assessed: boolean; rationale: string; suppliers: { n: number; avgImpact: number | null; high: string[]; list: { supplier: string; impact: number; financial: number | null; note: string | null }[] };
}
export interface EsgQuestion { code: string; topic: string; industry?: string; text: string; type: 'number' | 'percent' | 'yesno' | 'text'; unit?: string; refs: Record<string, string>; auto?: string; answer: { value: string | null; note: string; updated_name: string | null; updated_at: string } | null; autoValue: number | null }
export interface EsgStakeholder { group: string; method: string; when: string; people: string }
export interface EsgData {
  year: number; years: number[];
  assessment: { id: string; industry: string | null; frameworks: string[]; threshold_impact: number; threshold_financial: number; value_chain: string; stakeholders: EsgStakeholder[]; methodology: string; status: 'draft' | 'review' | 'approved'; sent_name: string | null; approved_name: string | null; approved_at: string | null; approval_note: string | null; updated_name: string | null; updated_at: string } | null;
  needs: { impact: boolean; financial: boolean; double: boolean; recommended: boolean };
  topics: EsgTopic[]; material: string[]; questions: EsgQuestion[]; suppliersAnswered: number; answered: number;
  catalogue: { frameworks: EsgFramework[]; industries: { code: string; name: string; likely: string[] }[]; topics: { code: string; pillar: string; name: string; sub: string; refs: Record<string, string> }[] };
  can: { edit: boolean; submit: boolean; decide: boolean };
}

export interface AiSettings {
  enabled: boolean; provider: string | null; model: string | null; baseUrl: string | null; keyHint: string | null; purchases: 'off' | 'large' | 'unidentified'; maxGroups: number; importAllowed: boolean;
  testedAt: string | null; testOk: boolean | null; updatedBy: string | null; onPlan: boolean; planName: string;
  providers: { code: string; name: string; url: string | null; models: string[]; needsUrl: boolean; note: string }[];
}

export interface SheetMapping {
  use: boolean; headerRow: number; layout: 'rows' | 'months';
  cols: Partial<Record<'facility' | 'date' | 'month' | 'year' | 'description' | 'category' | 'quantity' | 'unit' | 'note' | 'dataType', number | null>>;
  months: { col: number; month: string }[]; constant: { facility?: string | null; year?: number | null; month?: string | null; unit?: string | null; description?: string | null };
}
export interface ImportJob { id: string; filename: string; status: 'review' | 'done'; ai_used: boolean; ai_note?: string | null; created_name: string; created_at: string; done_at: string | null; document_id?: string | null; summary?: { created: number; submitted: number; failed: number; kg: number; left: number } | null;
  ready?: number; check?: number; problem?: number; created?: number; rows?: number }
export interface ImportRow { id: number; sheet: string; row_no: number; facility_text: string | null; facility: string | null; period_start: string | null; period_end: string | null; description: string | null; quantity: number; unit_text: string | null; unit: string | null; item: string | null; item_method: string | null; status: 'ready' | 'check' | 'problem' | 'excluded' | 'created'; problems: string[]; warnings?: string[]; co2e: number | null; activity_id: string | null; person: boolean; data_type: string }
export interface ImportDetail {
  job: ImportJob; sheets: { id: string; name: string; mapping: SheetMapping; proposed_by: 'ai' | 'auto' | 'person'; note: string | null; total_rows: number; head: (string | number | null)[][] | null }[];
  counts: Partial<Record<ImportRow['status'], { n: number; kg: number }>>;
  activities: { description: string | null; unit_text: string | null; category: string | null; rows: number; quantity: number; kg: number | null; item_id: number | null; item: string | null; method: string | null; conf: number | null; unit: string | null; problems: number; check: number; created: number }[];
  facilities: { facility_text: string | null; facility_id: string | null; facility: string | null; rows: number }[];
  rows: ImportRow[]; catalogue: { id: number; name: string; category: string; category_code: string; units: string[] }[]; enterable: { id: string; name: string }[];
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
  importOldPurchases: (b: { factors: string; categories?: string; subcategories?: string; types?: string; preview?: boolean }) =>
    call<{ preview: boolean; rows?: number; products?: number; withNames?: boolean; created?: number; updated?: number; naicsMapped?: { from: string; to: string }[]; notFound?: string[] }>('POST', '/api/admin/import/old-purchases', b),
  importDesnz: (file: Blob, preview: boolean) => call<{ year: number; version: string; gwpSet: string; fuelRows: number; gasRows: number; skipped?: boolean; factors?: number; items?: number; issues?: number }>('POST', `/api/admin/import/desnz${preview ? '?preview=1' : ''}`, undefined, file),
  addFactor: (b: unknown) => call<{ factor: Factor; replaced: number | null }>('POST', '/api/admin/factors', b),
  // auth
  login: (email: string, password: string) => call<{ ok?: true; mfa?: true; challenge?: string; enrolMfa?: boolean }>('POST', '/api/auth/login', { email, password }),
  loginMfa: (challenge: string, b: { code?: string; recoveryCode?: string }) => call<{ ok: true; recoveryLeft?: number }>('POST', '/api/auth/mfa', { challenge, ...b }),
  ssoStart: (email: string) => call<{ url: string }>('POST', '/api/auth/sso/start', { email }),
  mfaSetup: () => call<{ secret: string; uri: string }>('POST', '/api/auth/mfa/setup'),
  mfaEnable: (code: string) => call<{ recoveryCodes: string[] }>('POST', '/api/auth/mfa/enable', { code }),
  mfaRecovery: (code: string) => call<{ recoveryCodes: string[] }>('POST', '/api/auth/mfa/recovery', { code }),
  mfaDisable: (password: string, code: string) => call<{ ok: true }>('POST', '/api/auth/mfa/disable', { password, code }),
  security: () => call<SecuritySettings>('GET', '/api/security'),
  setMfaPolicy: (required: boolean) => call<{ ok: true }>('PUT', '/api/security/mfa', { required }),
  saveSso: (b: { issuer: string; clientId: string; clientSecret?: string; domains: string[]; enabled: boolean; enforce: boolean; requireMfa: boolean }) => call<{ sso: SsoSettings }>('PUT', '/api/security/sso', b),
  testSso: (issuer: string) => call<{ ok: boolean; message?: string; issuer?: string; authorization?: string; token?: string; keys?: string }>('POST', '/api/security/sso/test', { issuer }),
  resetUserMfa: (id: string) => call<{ ok: true }>('POST', `/api/users/${id}/mfa/reset`),
  auditVerify: () => call<{ ok: boolean; checked: number; firstSeq: number; lastSeq: number; unsealed: number; problem?: { seq: number; id: string; what: string }; purgedThrough: string | null }>('GET', '/api/platform/audit/verify'),
  siemStatus: () => call<{ target: string | null; sealedThrough: number; forwardedThrough: number; lastError: string | null; updatedAt: string | null; retentionMonths: number }>('GET', '/api/platform/siem'),
  destroyCompany: (id: string, b: { confirm: string; reason: string; exportSha256?: string }) => call<{ certificate: DestructionCertificate }>('POST', `/api/platform/companies/${id}/destroy`, b),
  scim: () => call<ScimSettings>('GET', '/api/security/scim'),
  scimToken: () => call<ScimSettings & { secret: string }>('POST', '/api/security/scim/token'),
  scimRevoke: () => call<{ ok: true }>('DELETE', '/api/security/scim/token'),
  scimSettings: (defaultRole: 'verifier' | null) => call<ScimSettings>('PUT', '/api/security/scim/settings', { defaultRole }),
  scimGroup: (id: string, b: { role: Role | null; scopeNodeId?: string | null; facilityIds?: string[] }) => call<ScimSettings>('PUT', `/api/security/scim/groups/${id}`, b),
  alerts: (open?: boolean) => call<{ alerts: SecurityAlert[]; open: number; canAck: boolean }>('GET', `/api/security/alerts${open ? '?open=true' : ''}`),
  alertCount: () => call<{ open: number }>('GET', '/api/security/alerts/count'),
  ackAlert: (id: number, note?: string) => call<{ ok: true }>('POST', `/api/security/alerts/${id}/ack`, { note }),
  platformAlerts: () => call<{ alerts: (SecurityAlert & { company: string | null })[] }>('GET', '/api/platform/alerts'),
  destructionCertificates: () => call<{ certificates: DestructionCertificate[] }>('GET', '/api/platform/certificates'),
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
  companies: () => call<{ companies: Company[]; plans: PlanLimits[] }>('GET', '/api/platform/companies'),
  orgSummary: (year?: number) => call<{ year: number; facilities: FacSummary[]; admins: Record<string, string[]>; superAdmins: string[] }>('GET', `/api/org/summary${year ? `?year=${year}` : ''}`),
  dashGroups: () => call<{ allowed: boolean; hidden: number; groups: DashGroup[] }>('GET', '/api/dashboard-groups'),
  createGroup: (b: { name: string; facilityIds: string[] }) => call<{ id: string; name: string }>('POST', '/api/dashboard-groups', b),
  deleteGroup: (id: string) => call<{ ok: true }>('DELETE', `/api/dashboard-groups/${id}`),
  createCompany: (b: Record<string, unknown>) => call<{ company: Company; superAdmin: { email: string; temporaryPassword: string } }>('POST', '/api/platform/companies', b),
  updateCompany: (id: string, b: Record<string, unknown>) => call<Company>('PATCH', `/api/platform/companies/${id}`, b),
  calculate: (b: unknown) => call<CalcResponse>('POST', '/api/calculate', b),
  saveActivity: (b: unknown) => call<{ id: string; totals: Record<Basis, number>; warnings: string[] }>('POST', '/api/activities', b),
  activities: (q: Record<string, string | number | undefined> = {}) => call<{ activities: Activity[]; years: { year: number; n: number; approved: number }[] }>('GET', `/api/activities?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
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
  bills: (status?: string, category?: string) => call<{ bills: Bill[]; counts: Record<string, number> }>('GET', `/api/bills?${new URLSearchParams({ ...(status ? { status } : {}), ...(category ? { category } : {}) })}`),
  checkBill: (id: string, b: unknown) => call<Bill>('POST', `/api/bills/${id}/check`, b),
  billPreview: (category?: string) => call<{ bills: BillPreview[] }>('GET', `/api/bills/preview${category ? `?category=${category}` : ''}`),
  publishBills: (ids: string[]) => call<{ booked: number; failed: { id: string; error: string }[]; entries: { created: number; updated: number } }>('POST', '/api/bills/publish', { ids }),
  readingBatches: (q: { status?: string; category?: string }) => call<{ review: boolean; batches: ReadingBatch[] }>('GET', `/api/reading-batches?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  readingBatch: (id: string) => call<ReadingBatch & { meters: ReadingBatchMeter[] }>('GET', `/api/reading-batches/${id}`),
  publishReadings: (id: string) => call<{ inserted: number; updated: number; entries: { created: number; updated: number; locked: string[] } }>('POST', `/api/reading-batches/${id}/publish`),
  discardReadings: (id: string) => call<{ ok: true }>('POST', `/api/reading-batches/${id}/discard`),
  setReviewReadings: (review: boolean) => call<{ review: boolean }>('PATCH', '/api/tenant/review-readings', { review }),
  bill: (id: string) => call<Bill & { text: string; entries: { id: string; period_start: string; quantity: number; unit: string; status: string; co2e_scope2: number; co2e_scope2_market: number; co2e_direct: number }[] }>('GET', `/api/bills/${id}`),
  uploadBill: (f: File, category?: string) => call<Bill & { duplicate: boolean }>('POST', '/api/bills/upload', undefined, f, { 'x-filename': encodeURIComponent(f.name), ...(category ? { 'x-category': category } : {}) }),
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
  purchaseSettings: (b: { aiMapping?: boolean; reviewCoverage?: number }) => call<{ aiMapping?: boolean; reviewCoverage?: number }>('PATCH', '/api/purchases/settings', b),
  publishedLines: (q: Record<string, string>) => call<PublishedLines>('GET', `/api/purchases/published?${new URLSearchParams(q)}`),
  capitalList: () => call<{ items: CapitalItem[] }>('GET', '/api/purchases/capital-list'),
  setCapital: (id: number, capital: boolean, note?: string) => call<{ id: number; capital: boolean }>('PATCH', `/api/purchases/capital-list/${id}`, { capital, note }),
  purchaseAccounts: (batchId: string) => call<{ accounts: PurchaseAccount[] }>('GET', `/api/purchases/batches/${batchId}/accounts`),
  setPurchaseAccount: (b: { account: string; accountType?: string | null; itemId?: number | null; target?: string | null; batchId?: string }) => call<{ ok: true; lines: number }>('PUT', '/api/purchases/accounts', b),
  uploadPurchases: (f: File, again = false) => call<UploadResult>('POST', `/api/purchases/upload${again ? '?again=1' : ''}`, undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  setupBatch: (id: string, b: unknown) => call<{ batchId: string; jobId: number }>('POST', `/api/purchases/batches/${id}/setup`, b),
  purchaseBatches: () => call<{ batches: PurchaseBatch[] }>('GET', '/api/purchases/batches'),
  purchaseBatch: (id: string) => call<BatchDetail>('GET', `/api/purchases/batches/${id}`),
  purchaseGroups: (id: string, q: Record<string, string | number | undefined>) => call<{ total: number; groups: PurchaseGroup[] }>('GET', `/api/purchases/batches/${id}/groups?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  patchGroups: (id: string, b: { keys: string[]; itemId?: number | null; decision?: 'keep' | 'move' | 'exclude' | null; target?: string | null; capital?: boolean; remember?: boolean; confirm?: boolean; scope?: 'text' | 'supplier' | 'gl' }) =>
    call<{ groups: number; lines: number; background: boolean }>('PATCH', `/api/purchases/batches/${id}/groups`, b),
  purchaseLines: (id: string, q: Record<string, string | number | undefined>) => call<{ total: number; lines: PurchaseLine[] }>('GET', `/api/purchases/batches/${id}/lines?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  purchaseLine: (id: string) => call<{ status: LineStatus; method: string | null; co2e: number | null; steps: string[]; warnings: string[]; error: string | null; factor: { name: string; source: string; value: number; unit: string } | null }>('GET', `/api/purchases/lines/${id}`),
  mapFacility: (id: string, value: string | null, facilityId: string) => call<{ lines: number }>('POST', `/api/purchases/batches/${id}/facilities`, { value, facilityId }),
  recalcBatch: (id: string, remap = false) => call<{ jobId: number }>('POST', `/api/purchases/batches/${id}/recalculate`, { remap }),
  publishBatch: (id: string) => call<{ jobId: number; lines: number }>('POST', `/api/purchases/batches/${id}/publish`),
  reopenBatch: (id: string) => call<{ removed: number; kept: number }>('POST', `/api/purchases/batches/${id}/reopen`),
  patchBatch: (id: string, b: { name?: string; includeDuplicates?: boolean }) => call<{ ok: true }>('PATCH', `/api/purchases/batches/${id}`, b),
  deleteBatch: (id: string) => call<{ ok: true }>('DELETE', `/api/purchases/batches/${id}`),
  spendTree: () => call<SpendTree>('GET', '/api/purchases/tree'),
  spendItems: (q: string, limit = 30) => call<{ items: SpendItem[] }>('GET', `/api/purchases/items?${new URLSearchParams({ q, limit: String(limit) })}`),
  purchaseRules: () => call<{ rules: { id: string; field: string; pattern: string; item: string | null; decision: string | null; target: string | null; capital: boolean | null; hits: number; created_at: string; created_by: string | null }[] }>('GET', '/api/purchases/rules'),
  deleteRule: (id: string) => call<{ ok: true }>('DELETE', `/api/purchases/rules/${id}`),
  manualPurchases: (b: { facilityId: string; dryRun?: boolean; name?: string; lines: ManualLine[] }) => call<ManualResult>('POST', '/api/purchases/manual', b),
  suppliers: (q: Record<string, string | number | undefined>) => call<{ total: number; suppliers: Supplier[]; counts?: { all: number; review: number; incomplete: number; autoLinked: number; prospects: number }; stages?: Partial<Record<SupplierStage, number>>; departments?: string[] }>('GET', `/api/suppliers?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  supplier: (id: string) => call<{ supplier: SupplierProfile; factors: SupplierFactor2[]; categories: { item: string | null; lines: number; usd: number; co2e: number }[]; names: SupplierName[]; months: { month: string; usd: number; co2e: number | null }[]; duplicateOf: { id: string; name: string } | null; defaultItem: { id: number; name: string } | null; suggestedDefault: { id: number; name: string; share: number } | null; engagement: SupplierEngagement; documents: SupplierDoc[] }>('GET', `/api/suppliers/${id}`),
  uploadSupplierDoc: (id: string, f: File, kind: string) => call<{ id: string; filename: string }>('POST', `/api/suppliers/${id}/documents`, undefined, f, { 'x-filename': encodeURIComponent(f.name), 'x-kind': kind }),
  deleteSupplierDoc: (id: string, docId: string) => call<{ ok: true }>('DELETE', `/api/suppliers/${id}/documents/${docId}`),
  supplierCounts: () => call<{ total: number; counts: { all: number; review: number; incomplete: number; autoLinked: number } }>('GET', '/api/suppliers?limit=1'),
  supplierReview: () => call<SupplierReview>('GET', '/api/suppliers/review'),
  supplierAnalytics: (year?: number) => call<SupplierAnalytics>('GET', `/api/suppliers/analytics${year ? `?year=${year}` : ''}`),
  keepSupplierSeparate: (id: string) => call<{ ok: true }>('POST', `/api/suppliers/${id}/keep-separate`),
  supplierMatch: (id: number, action: 'confirm' | 'split') => call<{ ok?: true; supplierId?: string; lines?: number }>('POST', `/api/suppliers/matches/${id}/${action}`),
  dashboard: (q: { year?: number; node?: string; group?: string; scope2?: 'location' | 'market'; cmp?: number; pend?: string }) => call<Dashboard>('GET', `/api/dashboard?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  addSupplier: (b: unknown) => call<{ id: string }>('POST', '/api/suppliers', b),
  importSuppliers: (f: File, commit: boolean) => call<SupplierImportResult>('POST', `/api/suppliers/import?commit=${commit ? 1 : 0}`, undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  supplierEngagement: (year?: number) => call<EngagementData>('GET', `/api/suppliers/engagement${year ? `?year=${year}` : ''}`),
  sbtiImport: (f: File) => call<{ rows: number; columns: Record<string, string> }>('POST', '/api/sbti/import', undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  patchSupplier: (id: string, b: unknown) => call<{ ok: true }>('PATCH', `/api/suppliers/${id}`, b),
  mergeSupplier: (id: string, intoId: string) => call<{ lines: number }>('POST', `/api/suppliers/${id}/merge`, { intoId }),
  addSupplierEf: (id: string, b: unknown) => call<{ id: string; linesRecalculated: number }>('POST', `/api/suppliers/${id}/factors`, b),
  deleteSupplierEf: (id: string, fid: string) => call<{ ok: true }>('DELETE', `/api/suppliers/${id}/factors/${fid}`),
  currency: (currency?: string) => call<{ fxMethod: 'month' | 'year' | 'fixed'; currency: string; priceAdjust: 'cpi' | 'none'; rates: FxRow[]; cpi: { region: string; year: number; value: number; source: string }[]; missing: { currency: string; month: string; lines: number }[]; used: { currency: string; lines: number }[]; fallbacks: { warning: string; lines: number }[] }>('GET', `/api/currency${currency ? `?currency=${currency}` : ''}`),
  currencySettings: (b: { fxMethod?: string; currency?: string; priceAdjust?: 'cpi' | 'none' }) => call('PATCH', '/api/currency/settings', b),
  addRates: (rows: { currency: string; kind: string; period: string; perUsd: number; source: string }[], shared = false) => call<{ saved: number }>('POST', '/api/currency/rates', { rows, shared }),
  deleteRate: (id: number) => call<{ ok: true }>('DELETE', `/api/currency/rates/${id}`),
  wasteContractors: () => call<{ contractors: string[] }>('GET', '/api/waste/contractors'),
  surveyOptions: () => call<SurveyOptions>('GET', '/api/surveys/options'),
  tripOptions: (year: number) => call<TripOptions>('GET', `/api/trips/options?year=${year}`),
  cities: (q: string, country?: string) => call<{ cities: string[] }>('GET', `/api/geo/cities?q=${encodeURIComponent(q)}${country ? `&country=${encodeURIComponent(country)}` : ''}`),
  airports: (q: string) => call<{ airports: AirportHit[] }>('GET', `/api/trips/airports?q=${encodeURIComponent(q)}`),
  flightDistance: (from: string, to: string) => call<{ from: string; to: string; gcKm: number; km: number; haul: string }>('GET', `/api/trips/distance?from=${from}&to=${to}`),
  home: (q: { year?: number; node?: string; group?: string }) => call<HomeData>('GET', `/api/home?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  kpis: () => call<KpiConfig>('GET', '/api/kpis'),
  targets: (year?: number) => call<TargetsData>('GET', `/api/targets${year ? `?year=${year}` : ''}`),
  saveTargets: (b: { year?: number; s12?: number; s3?: number; sbti?: Partial<Sbti> }) => call<{ ok: true }>('PUT', '/api/targets', b),
  applyTemplate: (template: string, year: number) => call<{ s12: number; s3: number; year: number }>('POST', '/api/targets/template', { template, year }),
  addObjective: (b: { name: string; scope: string; year: number; pct: number; growth: number }) => call<{ id: string }>('POST', '/api/targets/objectives', b),
  removeObjective: (id: string) => call<{ ok: true }>('DELETE', `/api/targets/objectives/${id}`),
  addScenario: (name: string, copy: boolean) => call<{ id: string }>('POST', '/api/scenarios', { name, copy }),
  removeScenario: (id: string) => call<{ ok: true }>('DELETE', `/api/scenarios/${id}`),
  addAction: (b: ActionInput & { name: string; start: number; end: number }) => call<{ id: string }>('POST', '/api/actions', b),
  updateAction: (id: string, b: ActionInput) => call<{ ok: true }>('PATCH', `/api/actions/${id}`, b),
  removeAction: (id: string) => call<{ ok: true }>('DELETE', `/api/actions/${id}`),
  saveLevers: (b: { name: string; levers: Record<string, number>; end: number; year: number }) => call<{ id: string }>('POST', '/api/levers', b),
  removeLevers: (id: string) => call<{ ok: true }>('DELETE', `/api/levers/${id}`),
  saveKpis: (b: { list?: string[]; key?: string; targets?: Record<string, number> }) => call<{ list: string[]; targets: Record<string, Record<string, number>> }>('PUT', '/api/kpis', b),
  dataStatus: (facilityId: string, year: number) => call<DataStatus>('GET', `/api/data/status?facilityId=${facilityId}&year=${year}`),
  review: (q: { facilityId: string; category: string; from: string; to: string; stage: 'open' | 'approved' }) =>
    call<{ entries: ReviewEntry[]; canEnter: boolean; canApprove: boolean }>('GET', `/api/review?${new URLSearchParams(q as Record<string, string>)}`),
  reportLines: (q: { year: number; node?: string; group?: string; pend?: string }) => call<{ lines: RepLine[] }>('GET', `/api/reports/lines?${qs(q)}`),
  reportQuality: (q: { year: number; node?: string; group?: string; pend?: string }) => call<{ checks: RepCheck[]; canJustify: boolean }>('GET', `/api/reports/quality?${qs(q)}`),
  justifyCheck: (check: string, year: number, text: string) => call<{ ok: true }>('PUT', `/api/reports/quality/${check}`, { year, text }),
  reportSettings: () => call<RepSettings>('GET', '/api/reports/settings'),
  saveReportSettings: (b: { entity?: RepEntity; excl?: Record<string, string> }) => call<unknown>('PUT', '/api/reports/settings', b),
  saveTemplate: (b: Omit<RepTemplate, 'id'> & { id?: string }) => (b.id ? call<{ id: string }>('PUT', `/api/reports/templates/${b.id}`, b) : call<{ id: string }>('POST', '/api/reports/templates', b)),
  removeTemplate: (id: string) => call<{ ok: true }>('DELETE', `/api/reports/templates/${id}`),
  saveVersion: (b: { name: string; label: string; period: string; scope2: 'location' | 'market'; s: [number, number, number]; byCode: Record<string, number> }) => call<{ id: string }>('POST', '/api/reports/versions', b),
  removeVersion: (id: string) => call<{ ok: true }>('DELETE', `/api/reports/versions/${id}`),
  approvals: () => call<ApprovalsData>('GET', '/api/approvals'),
  bins: (facilityId?: string) => call<{ bins: Bin[] }>('GET', `/api/qr/bins?${qs({ facilityId })}`),
  addBin: (b: BinInput) => call<Bin>('POST', '/api/qr/bins', b),
  updateBin: (id: string, b: Partial<Omit<BinInput, 'facilityId'>>) => call<Bin>('PATCH', `/api/qr/bins/${id}`, b),
  removeBin: (id: string) => call<{ ok: true }>('DELETE', `/api/qr/bins/${id}`),
  binByCode: (code: string) => call<{ bin: Bin; recent: Scan[]; canScan: boolean }>('GET', `/api/qr/scan/${encodeURIComponent(code)}`),
  addScan: (binId: string, b: { kind: Scan['kind']; kg?: number; fillPct?: number; manifest?: string; note?: string; lat?: number; lon?: number }) => call<Scan>('POST', `/api/qr/bins/${binId}/scans`, b),
  scans: (q: { facilityId: string; year: number; month: number }) => call<{ scans: Scan[] }>('GET', `/api/qr/scans?${qs(q)}`),
  voidScan: (id: string) => call<{ ok: true }>('POST', `/api/qr/scans/${id}/void`, {}),
  rollup: (q: { facilityId: string; year: number; month: number }) => call<Rollup>('GET', `/api/qr/rollup?${qs(q)}`),
  contractors: () => call<{ contractors: Contractor[] }>('GET', '/api/qr/contractors'),
  addContractor: (b: { name: string; email: string; contact?: string; months?: number }) => call<{ id: string; code: string; expiresAt: string; bins: number }>('POST', '/api/qr/contractors', b),
  contractorCode: (id: string, months?: number) => call<{ code: string; expiresAt: string }>('POST', `/api/qr/contractors/${id}/code`, { months }),
  revokeContractor: (id: string) => call<{ ok: true }>('POST', `/api/qr/contractors/${id}/revoke`, {}),
  statements: (q: { year: number; month: number }) => call<{ tolerancePct: number; contractors: StatementRec[] }>('GET', `/api/qr/statements?${qs(q)}`),
  reviewStatement: (id: string, b: { status: 'accepted' | 'queried'; note?: string }) => call<{ ok: true }>('PUT', `/api/qr/statements/${id}`, b),
  docUrl: (id: string) => `/api/qr/documents/${id}`,
  assurance: (year: number) => call<AssuranceData>('GET', `/api/assurance?year=${year}`),
  saveEngagement: (b: Record<string, unknown>) => call<{ ok: true }>('PUT', '/api/assurance/engagement', b),
  uploadStatement: (year: number, f: File) => call<{ id: string; filename: string }>('POST', '/api/assurance/statement', undefined, f, { 'x-year': String(year), 'x-filename': encodeURIComponent(f.name) }),
  lockMonth: (month: string, reason?: string) => call<{ ok: true }>('POST', '/api/assurance/locks', { month, reason }),
  unlockMonth: (month: string, reason: string) => call<{ ok: true }>('POST', `/api/assurance/locks/${month}/unlock`, { reason }),
  drawSample: (b: { year: number; method: 'random' | 'value'; size: number; seed?: number; keyPct?: number }) => call<{ id: string; seed: number; size: number; keyItems: number; keyPct: number }>('POST', '/api/assurance/samples', b),
  sample: (id: string) => call<{ items: SampleItem[] }>('GET', `/api/assurance/samples/${id}`),
  testItem: (sid: string, aid: string, b: { result: 'agreed' | 'exception' | null; note?: string }) => call<{ ok: true }>('PUT', `/api/assurance/samples/${sid}/tests/${aid}`, b),
  raiseFinding: (b: { year: number; activityId?: string; severity: string; kind: string; text: string; impactT?: number }) => call<{ id: string }>('POST', '/api/assurance/findings', b),
  respondFinding: (id: string, response: string) => call<{ ok: true }>('PUT', `/api/assurance/findings/${id}/respond`, { response }),
  closeFinding: (id: string, b: { note?: string; reopen?: boolean }) => call<{ ok: true }>('PUT', `/api/assurance/findings/${id}/close`, b),
  assurancePack: (year: number) => call<AssurancePack>('GET', `/api/assurance/pack?year=${year}`),
  // document vault
  vault: (q: Record<string, string | number | undefined> = {}) => call<VaultList>('GET', `/api/vault?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  vaultDoc: (id: string) => call<{ links: VaultLink[]; versions: { id: string; version: number; filename: string; uploaded_at: string; uploaded_by: string | null; size: number }[] }>('GET', `/api/vault/${id}`),
  vaultUpload: (f: File, meta: VaultMeta) => call<{ id: string; duplicate: boolean; linked: number; message?: string }>('POST', '/api/vault', undefined, f, { 'x-filename': encodeURIComponent(f.name), 'x-meta': encodeURIComponent(JSON.stringify(meta)) }),
  vaultEdit: (id: string, meta: VaultMeta) => call<{ ok: true }>('PATCH', `/api/vault/${id}`, meta),
  vaultVersion: (id: string, f: File) => call<{ id: string; version: number }>('POST', `/api/vault/${id}/version`, undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  vaultLink: (id: string, activityIds: string[]) => call<{ linked: number }>('POST', `/api/vault/${id}/links`, { activityIds }),
  vaultUnlink: (id: string, activityId: string) => call<{ ok: true }>('DELETE', `/api/vault/${id}/links/${activityId}`),
  vaultArchive: (id: string, reason: string) => call<{ ok: true }>('POST', `/api/vault/${id}/archive`, { reason }),
  vaultRestore: (id: string) => call<{ ok: true }>('POST', `/api/vault/${id}/restore`),
  vaultDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/vault/${id}`),
  vaultSettings: (retentionYears: number) => call<{ ok: true }>('PUT', '/api/vault/settings', { retentionYears }),
  restatements: () => call<RestatementData>('GET', '/api/restatements'),
  restatementFacility: (id: string) => call<{ facility: { id: string; name: string; active: boolean }; year: number; s1: number; s2: number; s2m: number; s3: number; total: number }>('GET', `/api/restatements/facility/${id}`),
  restatementPropose: (b: { trigger: string; title: string; description: string; facilityId: string | null; effective: string | null; s1: number; s2: number; s2m: number | null; s3: number; documentId: string | null; force: boolean }) => call<{ id: string }>('POST', '/api/restatements', b),
  restatementDecide: (id: string, decision: 'approve' | 'reject', note?: string) => call<{ status: string; applied: boolean; before: number; after: number; pct: number; cumulativePct: number; alsoApplied: number }>('POST', `/api/restatements/${id}/decide`, { decision, note }),
  restatementWithdraw: (id: string) => call<{ ok: true }>('DELETE', `/api/restatements/${id}`),
  restatementSettings: (threshold: number) => call<{ threshold: number }>('PUT', '/api/restatements/settings', { threshold }),
  // supplier portal (staff)
  supplierPortal: (year: number) => call<SupplierPortalData>('GET', `/api/supplier-portal?year=${year}`),
  supplierRequest: (id: string) => call<SupplierRequestDetail>('GET', `/api/supplier-portal/requests/${id}`),
  supplierInvite: (b: { supplierId: string; year: number; email: string; contactName: string; message: string; dueDate: string | null; months: number; sendEmail: boolean; shareEstimate?: boolean }) => call<{ id: string; code: string; expiresAt: string; emailed: boolean }>('POST', '/api/supplier-portal/requests', b),
  supplierRequestCode: (id: string, sendEmail: boolean) => call<{ code: string; expiresAt: string; emailed: boolean }>('POST', `/api/supplier-portal/requests/${id}/code`, { sendEmail }),
  supplierRequestRevoke: (id: string) => call<{ ok: true }>('POST', `/api/supplier-portal/requests/${id}/revoke`, {}),
  supplierRequestReview: (id: string, b: { decision: 'accept' | 'query'; note?: string; profile?: boolean; intensity?: { use: boolean; itemId: number | null }; products?: { index: number; itemId: number | null }[] }) =>
    call<{ status: string; applied?: { profile: string[]; factors: unknown[] }; linesRecalculated?: number }>('POST', `/api/supplier-portal/requests/${id}/review`, b),
  // batch runs
  batches: (days: number) => call<BatchesData>('GET', `/api/batches?days=${days}`),
  batchRecon: (id: string) => call<BatchRecon>('GET', `/api/batches/purchase/${id}`),
  batchControl: (id: string, control: { lines?: number; amounts?: Record<string, number> } | null) => call<{ ok: true }>('PUT', `/api/batches/purchase/${id}/control`, { control }),
  batchRetry: (id: string) => call<{ ok: true; jobId: number }>('POST', `/api/batches/purchase/${id}/retry`),
  batchReadings: (id: string) => call<Omit<ReadingBatchRow, 'rejected'> & { rejected: { index: number; reason: string }[]; staged: Record<string, number>; meters: { name: string; external_id: string; facility: string; n: number }[] }>('GET', `/api/batches/readings/${id}`),
  transfer: (id: string) => call<Transfer>('GET', `/api/batches/transfers/${id}`),
  sourceExpect: (id: string, expectHours: number | null) => call<{ ok: true }>('PUT', `/api/batches/sources/${id}`, { expectHours }),
  // CBAM
  imports: () => call<{ jobs: ImportJob[]; ai: boolean }>('GET', '/api/smart-import'),
  importUpload: (f: File) => call<{ id: string }>('POST', '/api/smart-import', undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  importJob: (id: string, status = 'all', offset = 0) => call<ImportDetail>('GET', `/api/smart-import/${id}?status=${status}&offset=${offset}`),
  importSheet: (id: string, sid: string, mapping: SheetMapping) => call<{ ok: true }>('PUT', `/api/smart-import/${id}/sheets/${sid}`, { mapping }),
  importItem: (id: string, b: { description: string | null; unitText: string | null; itemId: number | null; remember: boolean }) => call<{ rows: number }>('PUT', `/api/smart-import/${id}/items`, b),
  importFacility: (id: string, b: { text: string | null; facilityId: string | null; remember: boolean }) => call<{ rows: number }>('PUT', `/api/smart-import/${id}/facilities`, b),
  importRows: (id: string, ids: number[], excluded: boolean) => call<{ ok: true }>('PUT', `/api/smart-import/${id}/rows`, { ids, excluded }),
  importCreate: (id: string) => call<{ created: number; submitted: number; failed: number; kg: number; left: number }>('POST', `/api/smart-import/${id}/create`),
  importDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/smart-import/${id}`),
  aiSettings: () => call<AiSettings>('GET', '/api/ai/settings'),
  aiSave: (b: { enabled: boolean; provider: string | null; model: string | null; baseUrl: string | null; key?: string; purchases: string; maxGroups: number; importAllowed: boolean }) => call<{ ok: true }>('PUT', '/api/ai/settings', b),
  aiTest: () => call<{ ok: boolean; message: string }>('POST', '/api/ai/test'),
  esg: (year: number) => call<EsgData>('GET', `/api/esg?year=${year}`),
  esgSetup: (b: Record<string, unknown>) => call<{ id: string }>('PUT', '/api/esg/assessment', b),
  esgTopic: (topic: string, b: Record<string, unknown>) => call<{ impactScore: number | null; financialScore: number | null }>('PUT', `/api/esg/topics/${topic}`, b),
  esgSubmit: (year: number) => call<{ ok: true }>('POST', '/api/esg/assessment/submit', { year }),
  esgDecide: (year: number, decision: 'approve' | 'return' | 'reopen', note?: string) => call<{ ok: true }>('POST', '/api/esg/assessment/decide', { year, decision, note }),
  esgAnswer: (year: number, code: string, value: string | null, note: string) => call<{ ok: true }>('PUT', '/api/esg/answers', { year, code, value, note }),
  cbam: (year: number) => call<CbamData>('GET', `/api/cbam?year=${year}`),
  cbamInstallationSave: (b: Record<string, unknown>, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/cbam/installations/${id}` : '/api/cbam/installations', b),
  cbamInstallationDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/installations/${id}`),
  cbamProcessSave: (b: { category: string; route: string; name: string }, installationId: string, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/cbam/processes/${id}` : `/api/cbam/installations/${installationId}/processes`, b),
  cbamProcessDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/processes/${id}`),
  cbamReportCreate: (installationId: string, year: number) => call<{ id: string }>('POST', '/api/cbam/reports', { installationId, year }),
  cbamReport: (id: string) => call<CbamReport>('GET', `/api/cbam/reports/${id}`),
  cbamReportSave: (id: string, b: Record<string, unknown>) => call<{ ok: true }>('PUT', `/api/cbam/reports/${id}`, b),
  cbamReportDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/reports/${id}`),
  cbamLineSave: (id: string, b: { activityT: number | null; directT: number | null; elecMwh: number | null; defaultShare: number; params: Record<string, string> }) => call<{ ok: true }>('PUT', `/api/cbam/lines/${id}`, b),
  cbamPrecursorAdd: (lineId: string, b: Record<string, unknown>) => call<{ id: string }>('POST', `/api/cbam/lines/${lineId}/precursors`, b),
  cbamPrecursorDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/precursors/${id}`),
  cbamGoodAdd: (lineId: string, b: { cn: string; description: string; quantityT: number | null }) => call<{ id: string }>('POST', `/api/cbam/lines/${lineId}/goods`, b),
  cbamGoodDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/goods/${id}`),
  cbamImports: (year: number) => call<{ year: number; lines: CbamImport[]; ownReports: { id: string; year: number; status: string; installation: string }[]; prices: { quarter: number; price: number | null }[]; cbamFactor: number; can: { edit: boolean } }>('GET', `/api/cbam/imports?year=${year}`),
  cbamImportSave: (b: Record<string, unknown>, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/cbam/imports/${id}` : '/api/cbam/imports', b),
  cbamImportDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/imports/${id}`),
  cbamImportUpload: (f: File, year: number, commit: boolean) => call<{ lines?: { row: number; cn: string; origin: string; mass: number | null; ok: boolean; problems: string[] }[]; ok?: number; problems?: number; imported?: number; skipped?: number }>('POST', `/api/cbam/imports/upload?year=${year}&commit=${commit ? 1 : 0}`, undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  cbamReferenceAdd: (b: Record<string, unknown>) => call<{ id: string }>('POST', '/api/cbam/reference', b),
  cbamReferenceDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/cbam/reference/${id}`),
  // product LCA
  lca: () => call<LcaData>('GET', '/api/lca'),
  lcaProduct: (id: string) => call<LcaDetail>('GET', `/api/lca/products/${id}`),
  lcaProductSave: (b: LcaProductBody, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/lca/products/${id}` : '/api/lca/products', b),
  lcaProductDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/lca/products/${id}`),
  lcaInputSave: (b: LcaInputBody, productId: string, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/lca/inputs/${id}` : `/api/lca/products/${productId}/inputs`, b),
  lcaInputDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/lca/inputs/${id}`),
  lcaImport: (id: string, b: { text: string; replace: boolean; commit: boolean }) => call<{ lines?: LcaImportLine[]; ok?: number; problems?: number; imported?: number; skipped?: number }>('POST', `/api/lca/products/${id}/import`, b),
  lcaScenarioSave: (b: { name: string; changes: LcaScenario['changes'] }, productId: string, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/lca/scenarios/${id}` : `/api/lca/products/${productId}/scenarios`, b),
  lcaScenarioDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/lca/scenarios/${id}`),
  lcaSubmit: (id: string, note?: string) => call<{ ok: true }>('POST', `/api/lca/products/${id}/submit`, { note }),
  lcaVerify: (id: string, decision: 'verify' | 'return', note?: string) => call<{ ok: true }>('POST', `/api/lca/products/${id}/verify`, { decision, note }),
  lcaPublish: (id: string) => call<{ version: number; factor: number; supplierFactor: string | null; linesRecalculated: number }>('POST', `/api/lca/products/${id}/publish`, {}),
  lcaLibrarySave: (b: { name: string; unit: string; co2e: number; stage: string; source: string }, id?: string) => call<{ id?: string; ok?: true; models?: number }>(id ? 'PUT' : 'POST', id ? `/api/lca/library/${id}` : '/api/lca/library', b),
  lcaLibraryDelete: (id: string) => call<{ ok: true; retired: boolean }>('DELETE', `/api/lca/library/${id}`),
  // carbon credits
  credits: (year?: number) => call<CreditData>('GET', `/api/credits${year ? `?year=${year}` : ''}`),
  creditLotSave: (b: CreditLotBody, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/credits/lots/${id}` : '/api/credits/lots', b),
  creditLotDelete: (id: string) => call<{ ok: true }>('DELETE', `/api/credits/lots/${id}`),
  creditRetire: (lotId: string, b: { quantity: number; retiredOn: string; claimYear: number; purpose: string; serials: string | null; beneficiary: string | null; registryUrl: string | null; documentId: string | null; note: string }) => call<{ id: string }>('POST', `/api/credits/lots/${lotId}/retire`, b),
  creditDecide: (id: string, decision: 'approve' | 'reject', note?: string) => call<{ status: string }>('POST', `/api/credits/retirements/${id}/decide`, { decision, note }),
  creditWithdraw: (id: string) => call<{ ok: true }>('DELETE', `/api/credits/retirements/${id}`),
  // metric registry, collection calendar, inbox
  metrics: () => call<MetricList>('GET', '/api/metrics'),
  metricHistory: (id: string) => call<{ metric: { id: string; code: string; name: string }; versions: MetricVersion[]; labels: Record<string, string> }>('GET', `/api/metrics/${id}/history`),
  metricSave: (b: MetricData & { id?: string; reason: string }) => call<{ pending: boolean; changeId?: string; id?: string; code?: string; version?: number }>('POST', '/api/metrics', b),
  metricDecide: (id: string, decision: 'approve' | 'reject', note?: string) => call<{ ok: true; version?: number }>('POST', `/api/metrics/changes/${id}`, { decision, note }),
  metricWithdraw: (id: string) => call<{ ok: true }>('DELETE', `/api/metrics/changes/${id}`),
  calendar: (q: { year?: number; node?: string; group?: string }) => call<CalendarData>('GET', `/api/calendar?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  calendarRemind: (keys: string[]) => call<{ sent: number; people: number; skipped: number }>('POST', '/api/calendar/remind', { keys }),
  calendarExcuse: (b: { facilityId: string; metricId: string; period: string; reason: string }) => call<{ ok: true }>('POST', '/api/calendar/exception', b),
  calendarUnexcuse: (b: { facilityId: string; metricId: string; period: string }) => call<{ ok: true }>('DELETE', `/api/calendar/exception?${new URLSearchParams(b)}`),
  calendarSettings: (b: Partial<Omit<CycleSettings, 'timezone'>>) => call<CycleSettings>('PUT', '/api/calendar/settings', b),
  calendarRun: () => call<{ due_soon: number; overdue: number; escalated: number; people: number; skipped?: string }>('POST', '/api/calendar/run'),
  inbox: () => call<InboxData>('GET', '/api/inbox'),
  inboxCount: () => call<{ unread: number; todo: number; approvals: number }>('GET', '/api/inbox/count'),
  inboxRead: (b: { ids?: number[]; all?: boolean }) => call<{ read: number }>('POST', '/api/inbox/read', b),
  inboxSettings: (emailNotify: boolean) => call<{ emailNotify: boolean }>('PUT', '/api/inbox/settings', { emailNotify }),
  evidence: (activityId: string) => call<{ files: EvidenceFile[]; canAdd: boolean; locked: boolean; facilityId: string; periodStart: string; periodEnd: string }>('GET', `/api/activities/${activityId}/evidence`),
  // message centre
  msgCounts: () => call<{ unread: number; announcements: number; team: boolean }>('GET', '/api/messages/counts'),
  messages: () => call<{ threads: MsgThread[]; announcements: Announcement[]; topics: Record<string, string>; companyWide: boolean }>('GET', '/api/messages'),
  messageThread: (id: string) => call<{ thread: MsgThread; messages: Msg[] }>('GET', `/api/messages/${id}`),
  msgAttach: (f: File) => call<{ documentId: string; filename: string }>('POST', '/api/messages/attachments', undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  newMessage: (b: { topic: string; subject: string; page?: string; body: string; documentId?: string }) => call<{ id: string }>('POST', '/api/messages', b),
  replyMessage: (id: string, b: { body: string; documentId?: string }) => call<{ ok: true }>('POST', `/api/messages/${id}/reply`, b),
  closeMessage: (id: string) => call<{ ok: true }>('POST', `/api/messages/${id}/close`),
  readAnnouncement: (id: string) => call<{ ok: true }>('POST', `/api/announcements/${id}/read`),
  readAllAnnouncements: () => call<{ ok: true }>('POST', '/api/announcements/read-all'),
  teamMessages: (status: string) => call<{ threads: MsgThread[]; counts: Record<string, number>; topics: Record<string, string> }>('GET', `/api/team/messages?status=${status}`),
  teamThread: (id: string) => call<{ thread: MsgThread; messages: Msg[] }>('GET', `/api/team/messages/${id}`),
  teamReply: (id: string, body: string, close = false) => call<{ ok: true }>('POST', `/api/team/messages/${id}/reply`, { body, close }),
  teamStatus: (id: string, status: 'open' | 'answered' | 'closed') => call<{ ok: true }>('POST', `/api/team/messages/${id}/status`, { status }),
  teamAnnouncements: () => call<{ announcements: Announcement[] }>('GET', '/api/team/announcements'),
  publishAnnouncement: (b: { kind: string; title: string; body: string; tenantIds?: string[]; expiresAt?: string }) => call<{ id: string }>('POST', '/api/team/announcements', b),
  withdrawAnnouncement: (id: string) => call<{ ok: true }>('POST', `/api/team/announcements/${id}/withdraw`),
  uploadLogo: (f: File) => call<{ ok: true }>('POST', '/api/tenant/logo', undefined, f),
  removeLogo: () => call<{ ok: true }>('DELETE', '/api/tenant/logo'),
  makeRollup: (q: { facilityId: string; year: number; month: number }) => call<{ made: { item: string; kg: number; dataType: string; id: string | null; warnings: string[] }[] }>('POST', '/api/qr/rollup', q),
  rangeCheck: (entries: (Record<string, unknown> | null)[]) => call<{ method: 'avg6' | 'smart'; checks: (RangeCheck | null)[] }>('POST', '/api/activities/check', { entries }),
  saveApprovalSettings: (b: ApprovalSettings) => call<ApprovalSettings>('PUT', '/api/approvals/settings', b),
  reviewAction: (ids: string[], action: 'submit' | 'withdraw' | 'approve' | 'return', note?: string) => call<{ done: number; skipped: { id: string; reason: string }[]; toLevel2?: number }>('POST', '/api/activities/review', { ids, action, note }),
  deleteActivity: (id: string) => call<{ ok: true }>('DELETE', `/api/activities/${id}`),
  surveys: () => call<{ surveys: Survey[]; canCreate: boolean }>('GET', '/api/surveys'),
  createSurvey: (b: { name: string; year: number; closeAt: string | null; weeks: number; facilityIds: string[]; wfh: boolean }) => call<{ id: string }>('POST', '/api/surveys', b),
  survey: (id: string) => call<SurveyDetail>('GET', `/api/surveys/${id}`),
  patchSurvey: (id: string, b: { name?: string; closeAt?: string | null; weeks?: number; wfh?: boolean; headcount?: Record<string, number> }) => call<{ ok: true }>('PATCH', `/api/surveys/${id}`, b),
  surveyStatus: (id: string, status: 'open' | 'closed') => call<{ ok: true }>('POST', `/api/surveys/${id}/status`, { status }),
  reopenSurvey: (id: string) => call<{ ok: true }>('POST', `/api/surveys/${id}/reopen`),
  deleteSurvey: (id: string) => call<{ ok: true }>('DELETE', `/api/surveys/${id}`),
  addSurveyPeople: (id: string, b: { text: string; defaultFacilityId?: string }) => call<{ added: number; skipped: number; problems: string[] }>('POST', `/api/surveys/${id}/participants`, b),
  removeSurveyPerson: (id: string, pid: string) => call<{ ok: true }>('DELETE', `/api/surveys/${id}/participants/${pid}`),
  surveySent: (id: string, ids: string[]) => call<{ marked: number }>('POST', `/api/surveys/${id}/sent`, { ids }),
  answerOnBehalf: (id: string, pid: string, b: { facilityId: string; answers: SurveyAnswerBody }) => call<{ kg: number }>('PUT', `/api/surveys/${id}/participants/${pid}/answer`, b),
  publishSurvey: (id: string, dryRun: boolean) => call<{ dryRun: boolean; facilities: PublishRow[] }>('POST', `/api/surveys/${id}/publish`, { dryRun }),
  surveyLookup: (code: string) => call<{ company: string; survey: { name: string; year: number; wfh: boolean; closeAt: string | null }; firstName: string; facilities: { id: string; name: string }[]; facilityId: string; answers: SurveyAnswerBody | null; modes: { key: string; label: string }[]; fuels: { key: string; label: string }[] }>('POST', '/api/public/survey/lookup', { code }),
  surveyAnswer: (code: string, facilityId: string, answers: SurveyAnswerBody) => call<{ ok: true; kg: number }>('PUT', '/api/public/survey', { code, facilityId, answers }),
  commuteOptions: (year: number) => call<CommuteOptions>('GET', `/api/commuting/options?year=${year}`),
  commuting: (year: number) => call<{ facilities: { id: string; name: string; parent: string | null; employees: number | null; canEnter: boolean; record: { id: string; method: string; headcount: number; kg: number; personKm: number; responseRate: number | null; entries: number; approved: number; updated_at: string; updated_by_name: string | null } | null }[] }>('GET', `/api/commuting?year=${year}`),
  commuteRecord: (facilityId: string, year: number) => call<{ facility: { id: string; name: string; employees: number | null }; record: CommuteRecord | null; answers: CommuteAnswer[]; months: { m: number; t: number; n: number; approved: number }[] }>('GET', `/api/commuting/record?facilityId=${facilityId}&year=${year}`),
  readSurvey: (facilityId: string, f: File, q: { map?: Record<string, string>; site?: string; weekend?: Weekend } = {}) =>
    call<SurveyRead>('POST', `/api/commuting/survey?${new URLSearchParams({ facilityId, ...(q.map ? { map: JSON.stringify(q.map) } : {}), ...(q.site != null ? { site: q.site } : {}), ...(q.weekend ? { weekend: q.weekend } : {}) })}`, undefined, f, { 'x-filename': encodeURIComponent(f.name) }),
  commutePreview: (b: CommuteBody) => call<CommuteResult>('POST', '/api/commuting/preview', b),
  commuteSave: (b: CommuteBody) => call<CommuteResult & { id: string; entries: number }>('PUT', '/api/commuting', b),
  commuteDelete: (id: string) => call<{ ok: true; entries: number }>('DELETE', `/api/commuting/${id}`),
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
const UNIT_NAMES: Record<string, string> = { m3: 'm³', gal_uk: 'imperial gallons', kgal_uk: '000 imperial gallons', ML: 'megalitres', kL: 'kL', pkm: 'passenger-km', room_night: 'room-nights', sqm_hour: 'm²-hours', fte_h: 'FTE hours', tkm: 't-km', ton_us: 'short tons', gal_us: 'US gallons' };
export function unitLabel(code: string): string {
  if (UNIT_NAMES[code]) return UNIT_NAMES[code];
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
export interface BillPreview extends Bill { issues: { level: 'block' | 'warn'; text: string }[]; ok: boolean; meterUnit: string; qty: number; co2e: number | null; days: number; months: { month: string; days: number; qty: number }[] }
export interface ReadingBatch { id: string; source: string; client: string | null; status: 'review' | 'published' | 'discarded'; received: number; rejected: number | unknown[]; readings?: number; result: { inserted: number; updated: number; entries: { created: number; updated: number } } | null; created_at: string; decided_at: string | null; decided_by: string | null }
export interface ReadingBatchMeter { meter_id: string; meter: string; facility: string; unit: string; reading_type: string; category: string; new: number; changed: number; same: number; conflict: number; first: string; last: string; total: number | null; months: { month: string; qty: number; n: number }[] | null; samples: { ts: string; value: number; old: number | null; state: string; note: string | null }[] | null }
export interface SyncResult { created: number; updated: number; unchanged: number; locked: string[]; problems: string[] }
export interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }
export interface Bill {
  id: string; document_id: string; status: 'to_check' | 'checked' | 'confirmed' | 'rejected'; category: string | null; energy: string | null; supplier: string | null; account_no: string | null; bill_no: string | null;
  period_from: string | null; period_to: string | null; issue_date: string | null; quantity: number | null; unit: string | null; amount: number | null; currency: string | null;
  found: { missing?: string[]; problem?: string | null; matchedBy?: string | null; candidates?: { energy: string; value: number; unit: string; line: string; score: number }[];
    supplier?: { value: string; line: string }; account?: { value: string; line: string }; periodFrom?: { value: string; line: string }; quantity?: { value: number; unit: string; line: string }; amount?: { value: number; line: string } };
  scanned: boolean; meter_id: string | null; meter: string | null; facility_id: string | null; facility: string | null; meter_unit: string | null; reading_ts: string | null;
  note: string | null; checked_by_name: string | null; checked_at: string | null; created_at: string; filename: string; size: number;
}
