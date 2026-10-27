/**
 * India CCTS / GEI tracker: API calls and types shared by its screen.
 */
import { call, download } from './api';

export type Sector = { label: string; unit: string; product: string };
export type MonthKey = 'output' | 'fuel_t' | 'process_t' | 'pfc_t' | 'grid_mwh' | 're_mwh' | 'heat_t' | 'export_mwh' | 'export_ef' | 'transfer_t';
export const MONTH_KEYS: MonthKey[] = ['output', 'fuel_t', 'process_t', 'pfc_t', 'grid_mwh', 're_mwh', 'heat_t', 'export_mwh', 'export_ef', 'transfer_t'];

export interface CctsEntity {
  id: string; name: string; registrationNo: string | null; sector: string; subSector: string | null; state: string | null; address: string | null;
  outputUnit: string; product: string | null; baselineOutput: number | null; baselineGei: number | null; gridEf: number; energySource: 'entries' | 'manual';
  facilityIds: string[]; acva: string | null; priceInr: number | null; notes: string;
}
export interface CctsMonth {
  month: string; output: number | null; fuel: number; process: number; pfc: number; electricity: number; gridMwh: number; reMwh: number; heat: number; exported: number; transfer: number;
  total: number; gei: number | null; sources: { fuel: 'entries' | 'typed' | 'none'; grid: 'entries' | 'typed' | 'none' }; complete: boolean; problems: string[];
  typed: Record<MonthKey, number | null>; entries: { fuel_t: number; grid_mwh: number; entries: number } | null; note: string; updatedName: string | null;
}
export interface CctsYear {
  fy: number; label: string; months: CctsMonth[]; monthsIn: number; output: number; emissions: number; gei: number | null; target: number | null; baselineGei: number | null;
  components: { fuel: number; process: number; pfc: number; electricity: number; heat: number; exported: number; transfer: number };
  vsBaseline: number | null; targetCut: number | null; ccc: number | null;
  projection: { output: number; emissions: number; gei: number | null; ccc: number | null } | null; requiredRest: number | null;
}
export interface CctsAccount {
  held: number; issued: number; bought: number; sold: number; surrendered: number; obligation: number; surrenderedForYear: number; open: number; toBuy: number; expectedIssue: number;
  value: { held: number; toBuy: number; compensation: number; surplus: number } | null;
}
export interface CctsTxn { id: string; kind: 'issued' | 'bought' | 'sold' | 'surrendered'; fy: number; quantity: number; price_inr: number | null; onDate: string; reference: string | null; note: string; createdName: string | null }
export interface CctsMeasure { id: string; fy: number; title: string; yearDone: number | null; beforeT: number | null; afterT: number | null; investmentInr: number | null; note: string; createdName: string | null }
export interface CalendarItem { key: string; date: string; label: string }
export interface CctsList {
  fy: number; label: string; sectors: Record<string, Sector>; calendar: CalendarItem[]; facilities: { id: string; name: string; country: string }[]; canSetup: boolean; canData: boolean;
  entities: (CctsEntity & { result: { gei: number | null; target: number | null; monthsIn: number; ccc: number | null; projected: number | null; output: number; emissions: number }; held: number })[];
}
export interface CctsDetail {
  entity: CctsEntity; fy: number; label: string; targets: { fy: number; targetGei: number }[]; year: CctsYear;
  previous: { fy: number; label: string; gei: number | null; output: number; emissions: number; target: number | null; ccc: number | null } | null;
  account: CctsAccount; projectedAccount: CctsAccount | null; txns: CctsTxn[]; measures: CctsMeasure[]; calendar: CalendarItem[]; years: number[];
  facilities: { id: string; name: string }[]; sectors: Record<string, Sector>; canSetup: boolean; canData: boolean;
}
export type EntityBody = Omit<CctsEntity, 'id'>;
export type MonthBody = { month: string; note: string } & Record<MonthKey, number | null>;
export type MeasureBody = Omit<CctsMeasure, 'id' | 'createdName'>;

export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
export const currentFy = () => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; };
export const monthName = (m: string) => new Date(`${m}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

export const cctsApi = {
  list: (fy?: number) => call<CctsList>('GET', `/api/ccts${fy ? `?fy=${fy}` : ''}`),
  get: (id: string, fy: number) => call<CctsDetail>('GET', `/api/ccts/${id}?fy=${fy}`),
  save: (b: EntityBody, id?: string) => call<{ id?: string; ok?: true }>(id ? 'PUT' : 'POST', id ? `/api/ccts/${id}` : '/api/ccts', b),
  remove: (id: string) => call<{ ok: true }>('DELETE', `/api/ccts/${id}`),
  targets: (id: string, targets: { fy: number; targetGei: number | null }[]) => call<{ ok: true; warnings: string[] }>('PUT', `/api/ccts/${id}/targets`, { targets }),
  months: (id: string, months: MonthBody[]) => call<{ ok: true }>('PUT', `/api/ccts/${id}/months`, { months }),
  ccc: (id: string, b: { kind: string; fy: number; quantity: number; priceInr: number | null; onDate: string; reference: string | null; note: string }) => call<{ id: string }>('POST', `/api/ccts/${id}/ccc`, b),
  cccDelete: (txid: string) => call<{ ok: true }>('DELETE', `/api/ccts/ccc/${txid}`),
  measure: (id: string, b: MeasureBody) => call<{ id: string }>('POST', `/api/ccts/${id}/measures`, b),
  measureSave: (mid: string, b: MeasureBody) => call<{ ok: true }>('PUT', `/api/ccts/measures/${mid}`, b),
  measureDelete: (mid: string) => call<{ ok: true }>('DELETE', `/api/ccts/measures/${mid}`),
  formA: (id: string, fy: number, name: string) => download(`/api/ccts/${id}/form-a?fy=${fy}`, `CCTS_FormA_${name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}_${fyLabel(fy)}.xlsx`),
};
