/**
 * EPR: API calls and types shared by its screen.
 */
import { call, download } from './api';

export type Regime = 'in_plastic' | 'in_ewaste' | 'in_battery' | 'in_tyre' | 'eu_ppwr' | 'other';
export type Role = 'producer' | 'importer' | 'brand_owner' | 'recycler';
export type Kind = 'recycling' | 'eol' | 'recycled_content' | 'refurbish' | 'reuse';
export type ReturnStatus = 'not_started' | 'in_progress' | 'filed';
export interface RegimeInfo { name: string; short: string; jurisdiction: string; authority: string; source: string; period: 'india_fy' | 'calendar'; categories: Record<string, string>; units: string; notes: string; returnNote: string; carryYears: number; certValidityYears: number | null; base: string }
export interface Stream {
  id: string; regime: Regime; role: Role; category: string; name: string; country: string | null; scheme: string; registration: string | null; avgLife: number | null; foodContact: boolean;
  targetPct: Record<string, number>; recyclingPct: Record<string, number>; rcPct: Record<string, number>; ecRate: number | null; certPrice: number | null; feeRate: number | null; currency: string;
  pro: string | null; registeredOn: string | null; notes: string; active: boolean;
}
export interface Position {
  year: number; label: string; base: number | null; baseFrom: string; targetPct: number | null; obligation: number | null; typed: boolean; carriedIn: number; required: number | null;
  recyclingPct: number | null; recyclingMin: number | null; met: number; metRecycling: number; metOther: number; shortfall: number | null; recyclingShortfall: number | null;
  ecExposure: number | null; costToClose: number | null; overCap: boolean; forfeited: number; rcPct: number | null; rcRequired: number | null; rcActual: number | null; rcShortfall: number | null;
  rcCarried: number | null; rcBehind: number | null; stockIn: number; stockOut: number; warnings: string[];
}
export interface Stock { generated: number; sold: number; lapsed: number; available: number }
export interface OverviewStream extends Stream { label: string; position: Position | null; previous: Position | null; stock: Stock | null; returnStatus: ReturnStatus; filedOn: string | null; returnDue: string | null; fee: number | null }
export interface Overview { year: number; streams: OverviewStream[]; library: Record<Regime, RegimeInfo>; roles: Record<string, string>; kinds: Record<string, string>; canSetup: boolean; canData: boolean; canCerts: boolean; documents: { id: string; name: string }[] }
export interface YearRow { year: number; label: string; placed: number | null; preConsumer: number | null; suppliedToPibo: number | null; recycledTonnes: number | null; obligationTyped: number | null; returnStatus: ReturnStatus; filedOn: string | null; returnRef: string | null; documentId: string | null; note: string; updatedName: string | null; returnDue: string | null }
export interface Cert { id: string; streamId: string; year: number | null; kind: Kind; direction: 'in' | 'out'; tonnes: number; price: number | null; generatedYear: number | null; certificateNo: string | null; counterparty: string | null; counterpartyReg: string | null; endProduct: string | null; tradedOn: string | null; documentId: string | null; note: string; createdName: string | null }
export interface StreamDetail { stream: Stream; year: number; positions: Position[]; stock: Stock | null; years: YearRow[]; certs: Cert[]; library: RegimeInfo; canSetup: boolean; canData: boolean; canCerts: boolean }
export type StreamBody = Omit<Stream, 'id'>;
export type YearBody = { year: number; placed: number | null; preConsumer: number | null; suppliedToPibo: number | null; recycledTonnes: number | null; obligationTyped: number | null; note: string };
export type CertBody = Omit<Cert, 'id' | 'createdName'>;

export const eprApi = {
  overview: (year: number) => call<Overview>('GET', `/api/epr?year=${year}`),
  stream: (id: string, year: number) => call<StreamDetail>('GET', `/api/epr/streams/${id}?year=${year}`),
  addStream: (b: StreamBody) => call<{ id: string }>('POST', '/api/epr/streams', b),
  saveStream: (id: string, b: StreamBody) => call<{ ok: true }>('PUT', `/api/epr/streams/${id}`, b),
  deleteStream: (id: string) => call<{ ok: true }>('DELETE', `/api/epr/streams/${id}`),
  years: (id: string, rows: YearBody[]) => call<{ ok: true }>('PUT', `/api/epr/streams/${id}/years`, { rows }),
  ret: (id: string, year: number, b: { status: ReturnStatus; filedOn: string | null; returnRef: string | null; documentId: string | null; note?: string }) => call<{ ok: true }>('PUT', `/api/epr/streams/${id}/years/${year}/return`, b),
  addCert: (b: CertBody) => call<{ id: string }>('POST', '/api/epr/certs', b),
  saveCert: (id: string, b: CertBody) => call<{ ok: true }>('PUT', `/api/epr/certs/${id}`, b),
  deleteCert: (id: string) => call<{ ok: true }>('DELETE', `/api/epr/certs/${id}`),
  exportXlsx: (year: number) => download(`/api/epr/export?year=${year}`, `EPR_${year}.xlsx`),
};
export const periodOf = (period: 'india_fy' | 'calendar', y: number) => (period === 'india_fy' ? `FY ${y - 1}-${String(y % 100).padStart(2, '0')}` : String(y));
