/**
 * EKOTRACE SME: API calls and types for the SME screens, the SME network (buyers, clusters, banks,
 * CA firms) and the SME sections of the platform console. Figures always come from the server's
 * engine (results); screens never recalculate.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { call, download } from './api';

export type SmeModule = 'profile' | 'emissions' | 'esg' | 'certs' | 'footprint' | 'bills' | 'solar' | 'credits' | 'calendar' | 'epr' | 'dpdp' | 'people' | 'csr' | 'cbam' | 'eudr' | 'srmm' | 'loan' | 'share' | 'questionnaire';
export interface SmeCompany { id: string; name: string; sector: 'mfg' | 'svc'; industry: string; state: string; udyamNo: string | null; isExample: boolean }
/** The engine's output (apps/api/src/lib/sme/engine.ts `all`). Loosely typed: read fields by name. */
export type SmeResults = Record<string, any>;
export interface SmeData {
  fy: string; years: string[]; company: SmeCompany; data: Record<string, any>; meta: Record<string, { version: number; updatedName: string | null; updatedAt: string }>;
  results: SmeResults; config: Record<string, any>; canEdit: boolean; canManage: boolean;
}
export interface SmeLink { id: string; share: boolean; consent_at: string | null; revoked_at: string | null; purchase_share_pct: number | null; loan_cr: number | null; kind: 'buyer' | 'cluster' | 'bank' | 'ca_firm' | null; city: string | null; name: string; created_at: string }
export interface SmeCaRequest { id: string; fy: string; srmm_version: 'mfg' | 'svc'; self_pct: number | null; status: 'requested' | 'assigned' | 'in_review' | 'validated' | 'rejected'; validated_pct: number | null; validated_level: number | null; publish_on_icai: boolean; notes: string; reviewer_name: string | null; ca_firm: string | null; created_at: string; updated_at: string }
export interface SmeScrap { id: string; item: string; qty: number; unit: 't' | 'kg' | 'kL' | 'L' | 'nos'; price: number; hazardous: boolean; status: 'draft' | 'listed' | 'sold' | 'withdrawn' | 'blocked'; admin_note: string | null; created_at: string; updated_at: string }
export interface SmeGrievance { id: string; category: string | null; text: string; language: string | null; status: 'open' | 'resolved'; created_at: string; resolved_at: string | null }
export interface SmeCredit { id: string; type: 'solar' | 'efficiency' | 'fuel_switch'; capacity_kw: number | null; kwh_per_year: number | null; tco2e_per_year: number | null; status: 'proposed' | 'accepted' | 'registered' | 'issued' | 'rejected'; created_name: string | null; created_at: string }
export interface ScanField { value: number | string | null; line: string | null }

const q = (fy?: string) => (fy ? `?fy=${encodeURIComponent(fy)}` : '');

export const smeApi = {
  data: (fy?: string) => call<SmeData>('GET', `/api/sme/data${q(fy)}`),
  save: (mod: SmeModule, fy: string, data: Record<string, any>, version?: number) => call<{ version: number; results: SmeResults }>('PUT', `/api/sme/data/${mod}${q(fy)}`, { data, version }),
  company: (b: Partial<{ name: string; sector: 'mfg' | 'svc'; industry: string; state: string; udyamNo: string | null }>) => call<{ company: SmeCompany }>('PUT', '/api/sme/company', b),
  answer: (fy: string, questions: string[]) => call<{ answers: { question: string; answer: string; filled: boolean }[] }>('POST', `/api/sme/answer${q(fy)}`, { questions }),
  scan: (type: 'electricity' | 'diesel' | 'lpg', pdf: Blob) => call<{ fields: Record<string, ScanField>; scanned: boolean; missing: string[] }>('POST', `/api/sme/scan?type=${type}`, undefined, pdf),
  scrap: () => call<{ listings: SmeScrap[]; state: string }>('GET', '/api/sme/scrap'),
  addScrap: (b: { item: string; qty: number; unit: SmeScrap['unit']; price: number; hazardous: boolean }) => call<{ id: string }>('POST', '/api/sme/scrap', b),
  updateScrap: (id: string, b: Partial<{ qty: number; price: number; status: 'draft' | 'listed' | 'sold' | 'withdrawn' }>) => call<{ ok: true }>('PATCH', `/api/sme/scrap/${id}`, b),
  recyclers: () => call<{ recyclers: { name: string; city?: string; state?: string; materials?: string; authorisation?: string; hazardous_ok?: boolean; contact?: string }[] }>('GET', '/api/sme/recyclers'),
  grievances: () => call<{ token: string; items: SmeGrievance[] }>('GET', '/api/sme/grievances'),
  grievanceStatus: (id: string, status: 'open' | 'resolved') => call<{ ok: true }>('PATCH', `/api/sme/grievances/${id}`, { status }),
  links: () => call<{ links: SmeLink[] }>('GET', '/api/sme/links'),
  setShare: (id: string, share: boolean) => call<{ ok: true }>('PUT', `/api/sme/links/${id}`, { share }),
  caRequests: () => call<{ items: SmeCaRequest[] }>('GET', '/api/sme/ca-requests'),
  requestCa: (fy: string, publish: boolean) => call<{ id: string }>('POST', `/api/sme/ca-requests${q(fy)}`, { publish }),
  credits: () => call<{ items: SmeCredit[] }>('GET', '/api/sme/credit-projects'),
  addCredit: (b: { type: SmeCredit['type']; capacityKw?: number | null; kwhPerYear?: number | null }) => call<{ id: string; tco2ePerYear: number }>('POST', '/api/sme/credit-projects', b),
};

// ------------------------------------------------------------------ open pages --
export const smePublic = {
  info: () => call<{ signup: boolean; states: string[] }>('GET', '/api/public/sme/info'),
  signup: (b: Record<string, unknown>) => call<{ ok: true; message: string }>('POST', '/api/public/sme/signup', b),
  confirm: (token: string, password: string) => call<{ ok: true; email: string }>('POST', '/api/public/sme/signup/confirm', { token, password }),
  grievance: (token: string) => call<{ company: string; categories: string[] }>('GET', `/api/public/sme/grievance/${token}`),
  sendGrievance: (token: string, b: { text: string; category: string; language?: string }) => call<{ ok: true; message: string }>('POST', `/api/public/sme/grievance/${token}`, b),
};

// ------------------------------------------------------------------ SME network --
export type PartnerKind = 'buyer' | 'cluster' | 'bank' | 'ca_firm';
export const smeNetApi = {
  overview: (fy?: string) => call<Record<string, any> & { kind: PartnerKind; partner: { name: string; kind: PartnerKind; city: string }; fy: string }>('GET', `/api/sme-net/overview${q(fy)}`),
  invite: (b: { email: string; company?: string; name?: string; purchaseSharePct?: number | null; loanCr?: number | null; evCr?: number | null }) => call<{ ok: true; newCompany: boolean; temporaryPassword: string | null; emailed: boolean }>('POST', '/api/sme-net/links', b),
  updateLink: (id: string, b: Partial<{ purchaseSharePct: number | null; loanCr: number | null; evCr: number | null }>) => call<{ ok: true }>('PATCH', `/api/sme-net/links/${id}`, b),
  remind: (id: string) => call<{ ok: true; emailed: boolean }>('POST', `/api/sme-net/links/${id}/remind`),
  caRequest: (id: string) => call<{ request: Record<string, any>; company: { name: string; sector: string; industry: string; state: string }; data: Record<string, any>; results: SmeResults; config: { srmm: Record<string, any> } }>('GET', `/api/sme-net/ca/${id}`),
  caReview: (id: string, b: { status: 'in_review' | 'validated' | 'rejected'; validatedPct?: number; allSections30?: boolean; notes?: string }) => call<{ ok: true; validatedLevel: number | null }>('PATCH', `/api/sme-net/ca/${id}`, b),
};

// ------------------------------------------------------------------ platform console --
export const smeAdminApi = {
  overview: (fy?: string) => call<Record<string, any>>('GET', `/api/platform/sme/overview${q(fy)}`),
  companies: (p: { fy?: string; search?: string; state?: string } = {}) => call<{ fy: string; companies: Record<string, any>[] }>('GET', `/api/platform/sme/companies?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])}`),
  partners: () => call<{ partners: { id: string; name: string; status: string; kind: PartnerKind | null; city: string | null; links: number; sharing: number }[] }>('GET', '/api/platform/sme/partners'),
  setPartner: (tenantId: string, kind: PartnerKind, city: string) => call<{ ok: true }>('PUT', `/api/platform/sme/partners/${tenantId}`, { kind, city }),
  links: (p: { partner?: string; sme?: string } = {}) => call<{ links: Record<string, any>[] }>('GET', `/api/platform/sme/links?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])}`),
  addLink: (b: { partnerTenant: string; smeTenant: string; purchaseSharePct?: number | null; loanCr?: number | null; evCr?: number | null }) => call<{ ok: true }>('POST', '/api/platform/sme/links', b),
  deleteLink: (id: string) => call<{ ok: true }>('DELETE', `/api/platform/sme/links/${id}`),
  ca: () => call<{ requests: Record<string, any>[]; firms: { id: string; name: string; city: string }[] }>('GET', '/api/platform/sme/ca'),
  assignCa: (id: string, b: { caTenant?: string | null; status?: 'requested' | 'rejected'; notes?: string }) => call<{ ok: true }>('PATCH', `/api/platform/sme/ca/${id}`, b),
  settings: () => call<{ keys: { key: string; label: string }[]; items: { skey: string; latest: number; active: number; activated_at: string | null; drafts: number }[] }>('GET', '/api/platform/sme/settings'),
  setting: (key: string) => call<{ key: string; label: string; versions: { version: number; status: string; note: string | null; created_name: string | null; created_at: string; activated_name: string | null; activated_at: string | null }[]; active: { version: number; data: any } }>('GET', `/api/platform/sme/settings/${key}`),
  settingVersion: (key: string, v: number) => call<{ item: { version: number; status: string; data: any; note: string | null } }>('GET', `/api/platform/sme/settings/${key}/${v}`),
  saveDraft: (key: string, data: any, note: string | null) => call<{ version: number }>('POST', `/api/platform/sme/settings/${key}`, { data, note }),
  activate: (key: string, v: number) => call<{ ok: true }>('POST', `/api/platform/sme/settings/${key}/${v}/activate`),
  scrap: () => call<{ listings: Record<string, any>[] }>('GET', '/api/platform/sme/scrap'),
  moderateScrap: (id: string, status: 'listed' | 'blocked', note: string | null) => call<{ ok: true }>('PATCH', `/api/platform/sme/scrap/${id}`, { status, note }),
  credits: () => call<{ projects: Record<string, any>[]; totals: { status: string; n: number; t: number }[] }>('GET', '/api/platform/sme/credits'),
  creditStatus: (id: string, status: SmeCredit['status']) => call<{ ok: true }>('PATCH', `/api/platform/sme/credits/${id}`, { status }),
  benchmark: (fy?: string) => call<{ fy: string; companies: number; groups: { industry: string; n: number; median: number | null; shown: boolean }[]; minGroup: number }>('GET', `/api/platform/sme/benchmark${q(fy)}`),
  benchmarkCsv: (fy: string) => download(`/api/platform/sme/benchmark.csv${q(fy)}`, `sme-benchmark-${fy.replace(/\s/g, '')}.csv`),
};

// ------------------------------------------------------------------ formatting (Indian grouping, ₹) --
export const n = (v: unknown): number => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? 0 : Number(v));
export const f0 = (v: unknown) => Math.round(n(v)).toLocaleString('en-IN');
export const f1 = (v: unknown) => (Math.round(n(v) * 10) / 10).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const f2 = (v: unknown) => n(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const lakh = (r: unknown) => `₹${f1(n(r) / 1e5)} L`;
export const crore = (r: unknown) => `₹${f2(n(r) / 1e7)} Cr`;
export const dmy = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const LEVELS = ['Not yet rated', 'Formative', 'Developing', 'Emerging', 'Established'];
