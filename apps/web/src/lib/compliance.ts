/**
 * Compliance Position Desk: API calls and types shared by its screen.
 */
import { call, download } from './api';

export type Applies = 'applies' | 'may_apply' | 'not_applicable';
export type Status = 'not_started' | 'in_progress' | 'done' | 'not_applicable' | 'overdue';
export interface Profile {
  fyEndMonth: number; countries: string[]; employees: number | null; turnoverEur: number | null; euTurnoverEur: number | null; euSubsidiaryTurnoverEur: number | null; euEntity: boolean;
  listed: 'none' | 'india' | 'sgx' | 'asx' | 'lse' | 'eu' | 'other'; sgxSti: boolean; sgxCapOver1bn: boolean;
  indiaTop: 'top150' | 'top250' | 'top500' | 'top1000' | 'listed_other' | 'none'; cctsObligated: boolean | null; cbamImportTonnes: number | null; cbamExporter: boolean | null;
  uaeDesignated: 'yes' | 'no' | 'unknown'; uaeScope12: number | null; eadFacility: boolean | null; usRevenueUsd: number | null; californiaBusiness: boolean;
  auGroup: 'group1' | 'group2' | 'group3' | 'none'; ukQuoted: boolean; ukLarge: boolean;
}
export interface Regulation { code: string; name: string; jurisdiction: string; authority: string; source: string; summary: string; applies: Applies; reason: string; counts: { total: number; done: number; overdue: number; open: number } }
export interface Obligation {
  reg: string; obligation: string; period: number; label: string; title: string; detail: string; due: string | null; dueNote: string | null; moved: boolean;
  status: Status; setStatus: Exclude<Status, 'overdue'> | null; source: 'set' | 'module' | 'none'; autoStatus: Exclude<Status, 'overdue'> | null; autoNote: string | null; voluntary: boolean; owner: string | null; note: string; documentId: string | null; doneOn: string | null;
  penalty: string | null; module: { route: string; label: string } | null; applies: Applies; updatedName: string | null;
  custom?: { id: string; regulation: string; jurisdiction: string; recurrence: 'once' | 'annual'; firstDue: string; owner: string | null };
}
export interface Desk {
  year: number; today: string; profile: Profile; stored: Partial<Profile>; facts: Partial<Profile> & { sources: Record<string, string> }; regulations: Regulation[];
  obligations: Obligation[]; upcoming: Obligation[]; documents: { id: string; name: string }[]; products: string[]; canSetup: boolean; canEdit: boolean;
}
export type StatusBody = { reg: string; obligation: string; period: number; status: Exclude<Status, 'overdue'> | null; owner: string | null; note: string; documentId: string | null; doneOn: string | null; dueOverride: string | null };
export type CustomBody = { title: string; regulation: string; jurisdiction: string; dueDate: string; recurrence: 'once' | 'annual'; owner: string | null; detail: string };

export const cpApi = {
  get: (year: number) => call<Desk>('GET', `/api/compliance?year=${year}`),
  profile: (b: Profile) => call<{ ok: true }>('PUT', '/api/compliance/profile', b),
  status: (b: StatusBody) => call<{ ok: true }>('PUT', '/api/compliance/status', b),
  addCustom: (b: CustomBody) => call<{ id: string }>('POST', '/api/compliance/custom', b),
  saveCustom: (id: string, b: CustomBody) => call<{ ok: true }>('PUT', `/api/compliance/custom/${id}`, b),
  deleteCustom: (id: string) => call<{ ok: true }>('DELETE', `/api/compliance/custom/${id}`),
  exportXlsx: (year: number) => download(`/api/compliance/export?year=${year}`, `Compliance_${year}.xlsx`),
  ics: (year: number) => download(`/api/compliance/calendar.ics?year=${year}`, `compliance_${year}.ics`),
};
