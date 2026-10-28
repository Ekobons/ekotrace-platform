/**
 * Energy management & savings: API calls and types shared by its screen.
 */
import { call, download } from './api';

export const CARRIERS = ['electricity', 'fuel', 'heat', 'cooling', 'transport'] as const;
export type Carrier = (typeof CARRIERS)[number];
export type Variable = 'production' | 'cdd' | 'hdd' | 'occupancy';
export type ModelTarget = 'total' | Carrier;
export interface Site {
  id: string; name: string; nodeId: string | null; siteType: string; floorM2: number | null; baselineYear: number | null; modelTarget: ModelTarget; modelVars: Variable[];
  enpiVar: Variable | 'floor' | null; productionUnit: string | null; tariffs: Partial<Record<Carrier, number | null>>; factors: Partial<Record<Carrier, number | null>>;
  targetPct: number | null; targetYear: number | null; notes: string; updatedName: string | null;
}
export type SiteBody = Omit<Site, 'id' | 'updatedName'>;
export interface Econ { saveYear: number | null; payback: number | null; npv: number | null; tYear: number | null; costPerT: number | null }
export interface Measure {
  id: string; siteId: string; title: string; category: string; carrier: Carrier; status: 'idea' | 'approved' | 'implemented' | 'verified' | 'dropped'; implementedOn: string | null;
  kwhExpected: number | null; kwhVerified: number | null; ipmvp: 'A' | 'B' | 'C' | 'D' | null; capex: number | null; opexYear: number | null; lifeYears: number | null; owner: string | null; mvPlan: string; note: string; updatedName: string | null;
  econ: Econ; site?: string;
}
export type MeasureBody = Omit<Measure, 'id' | 'updatedName' | 'econ' | 'site'>;
export interface Seu { id: string; siteId: string; name: string; carrier: Carrier; sharePct: number | null; variables: string; enpi: string; controls: string; owner: string | null }
export type SeuBody = Omit<Seu, 'id'>;
export interface Target { pct: number; year: number; enpi: number; onTrack: boolean | null }
export interface YearSummary {
  total: number; totals: Record<Carrier, number>; monthsIn: number; enpi: number | null; enpiBase: number | null; enpiChange: number | null; saving: number | null; savingCost: number | null; savingT: number | null;
  cost: number | null; anomalies: number; modelValid: boolean | null; cvrmse: number | null; problems: number; priorTotal: number | null; target: Target | null; eui: number | null;
}
export interface Overview {
  year: number; sites: (Site & { year: YearSummary })[]; monthly: ({ month: string } & Record<Carrier, number>)[]; measures: Measure[];
  carriers: Record<Carrier, string>; variables: Record<Variable, string>; siteTypes: Record<string, string>; categories: Record<string, string>; currency: string;
  nodes: { id: string; name: string; employees: number | null; floor_m2: number | null }[]; ekotrace: boolean; canSetup: boolean; canData: boolean; canMeasures: boolean;
}
export interface MonthOut {
  month: string; energy: Partial<Record<Carrier, number | null>>; source: Partial<Record<Carrier, 'entries' | 'typed'>>; production: number | null; cdd: number | null; hdd: number | null; occupancy: number | null; note: string;
  actual: number | null; expected: number | null; saving: number | null; cusum: number | null; anomaly: string | null; enpi: number | null; driver: number | null;
}
export interface Model { vars: Variable[]; coef: number[]; n: number; r2: number | null; cvrmse: number | null; nmbe: number | null; se: number | null; t: (number | null)[]; valid: boolean; problems: string[]; mean: number | null }
export interface Detail {
  site: Site; year: number; months: MonthOut[]; base: number | null; model: Model | null; totals: Record<Carrier, number>; total: number; monthsIn: number;
  enpi: number | null; enpiBase: number | null; enpiChange: number | null; kgPerKwh: Partial<Record<Carrier, number | null>>; cost: number | null; saving: number | null; savedMonths: number;
  savingCost: number | null; savingT: number | null; anomalies: number; problems: string[]; target: Target | null; priorTotal: number | null;
  measures: Measure[]; seus: Seu[]; node: { id: string; name: string } | null; ekotrace: boolean; canSetup: boolean; canData: boolean; canMeasures: boolean;
}
export type MonthBody = { month: string; production: number | null; cdd: number | null; hdd: number | null; occupancy: number | null; energy: Partial<Record<Carrier, number | null>>; note: string };

const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
export const enApi = {
  overview: (year: number) => call<Overview>('GET', `/api/energy?year=${year}`),
  addSite: (b: SiteBody) => call<{ id: string }>('POST', '/api/energy/sites', b),
  saveSite: (id: string, b: SiteBody) => call<{ ok: true }>('PUT', `/api/energy/sites/${id}`, b),
  deleteSite: (id: string) => call<{ ok: true }>('DELETE', `/api/energy/sites/${id}`),
  detail: (id: string, year: number) => call<Detail>('GET', `/api/energy/sites/${id}?year=${year}`),
  months: (id: string, months: MonthBody[]) => call<{ ok: true }>('PUT', `/api/energy/sites/${id}/months`, { months }),
  addMeasure: (b: MeasureBody) => call<{ id: string }>('POST', '/api/energy/measures', b),
  saveMeasure: (id: string, b: MeasureBody) => call<{ ok: true }>('PUT', `/api/energy/measures/${id}`, b),
  deleteMeasure: (id: string) => call<{ ok: true }>('DELETE', `/api/energy/measures/${id}`),
  addSeu: (b: SeuBody) => call<{ id: string }>('POST', '/api/energy/seus', b),
  saveSeu: (id: string, b: SeuBody) => call<{ ok: true }>('PUT', `/api/energy/seus/${id}`, b),
  deleteSeu: (id: string) => call<{ ok: true }>('DELETE', `/api/energy/seus/${id}`),
  exportSite: (id: string, year: number, name: string) => download(`/api/energy/sites/${id}/export?year=${year}`, `Energy_${safe(name)}_${year}.xlsx`),
  exportAll: (year: number) => download(`/api/energy/export?year=${year}`, `Energy_portfolio_${year}.xlsx`),
};
export const lastYear = () => new Date().getFullYear() - 1;
