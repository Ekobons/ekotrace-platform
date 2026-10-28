/**
 * SEBI BRSR Core: API calls and types shared by its screen.
 */
import { call, download } from './api';

export type Kind = 'auto' | 'typed' | 'derived';
export interface Kpi { code: string; attr: number; label: string; unit: string; kind: Kind; dp: number; group?: string; hint?: string; inCore?: boolean; vc?: boolean }
export type Review = 'open' | 'ready' | 'reviewed';
export interface Row {
  code: string; value: number | null; previous: number | null; auto: number | null; overridden: boolean; source: 'entries' | 'override' | 'typed' | 'missing' | 'derived';
  note: string; documentId: string | null; document: string | null; owner: string | null; review: Review; reviewedName: string | null; reviewedAt: string | null; updatedName: string | null; updatedAt: string | null;
}
export interface Report {
  fy: number; label: string; exists: boolean; revenueInr: number | null; pppFactor: number; outputQty: number | null; outputUnit: string | null; facilityIds: string[] | null;
  provider: string | null; approach: 'assurance' | 'assessment' | 'none'; status: 'draft' | 'ready' | 'final'; notes: string; updatedName: string | null; updatedAt: string | null;
}
export interface Partner { id: string; side: 'upstream' | 'downstream'; name: string; supplierId: string | null; amountInr: number | null; attributable: number | null; values: Record<string, number | null>; note: string; share: number | null; belowTwo: boolean }
export interface Side { partners: Partner[]; amount: number; total: number | null; coverage: number | null; attributable: Record<string, number | null> }
export interface BrsrData {
  report: Report; attributes: Record<string, string>; kpis: Kpi[]; rows: Row[]; revenuePpp: number | null; previousRevenuePpp: number | null; previousExists: boolean;
  gases: { gas: string; t: number }[];
  detail: { energy: { source: string; gj: number; renewable: boolean }[]; water: { line: string; kl: number }[]; waste: { cat: string; route: string; t: number }[]; entries: { ghg: number; energy: number; water: number; waste: number }; missingEnergy: number };
  problems: string[]; readiness: { kpis: number; filled: number; ready: number; reviewed: number; evidence: number; coreFilled: number; core: number };
  sources: Record<string, string>; valueChain: { upstream: Side; downstream: Side }; years: number[];
  facilities: { id: string; name: string }[]; documents: { id: string; name: string }[]; canEdit: boolean; canSetup: boolean; canReview: boolean;
}
export type ValueBody = { kpi: string; value: number | null; note: string; documentId: string | null; owner: string | null };
export type ReportBody = Omit<Report, 'fy' | 'label' | 'exists' | 'updatedName' | 'updatedAt' | 'pppFactor'> & { pppFactor: number | null };
export type PartnerBody = { side: 'upstream' | 'downstream'; name: string; supplierId: string | null; amountInr: number | null; attributable: number | null; values: Record<string, number | null>; note: string };

export const fyLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;

export const brsrApi = {
  get: (fy?: number) => call<BrsrData>('GET', `/api/brsr${fy ? `?fy=${fy}` : ''}`),
  saveReport: (fy: number, b: ReportBody) => call<{ ok: true }>('PUT', `/api/brsr/${fy}`, b),
  values: (fy: number, values: ValueBody[]) => call<{ ok: true }>('PUT', `/api/brsr/${fy}/values`, { values }),
  review: (fy: number, kpis: string[], review: Review) => call<{ ok: true; skipped: number }>('POST', `/api/brsr/${fy}/review`, { kpis, review }),
  suggest: (fy: number) => call<{ total: number; suggestions: { supplierId: string; name: string; usd: number; share: number; cumulative: number }[] }>('GET', `/api/brsr/${fy}/suggest-partners`),
  addPartner: (fy: number, b: PartnerBody) => call<{ id: string }>('POST', `/api/brsr/${fy}/partners`, b),
  savePartner: (id: string, b: PartnerBody) => call<{ ok: true }>('PUT', `/api/brsr/partners/${id}`, b),
  deletePartner: (id: string) => call<{ ok: true }>('DELETE', `/api/brsr/partners/${id}`),
  exportXlsx: (fy: number) => download(`/api/brsr/${fy}/export`, `BRSR_Core_${fyLabel(fy).replace(/\s/g, '_')}.xlsx`),
};
