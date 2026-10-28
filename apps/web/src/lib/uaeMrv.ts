/**
 * UAE MRV: API calls and types shared by its screen.
 */
import { call, download } from './api';

export type Kind = 'combustion' | 'process' | 'mass_balance' | 'measured' | 'gas';
export type Sector = 'power' | 'oil_gas' | 'industry' | 'transport' | 'other';
export type Materiality = 'de_minimis' | 'minor' | 'major';
export type YearStatus = 'draft' | 'ready' | 'submitted' | 'verified';
export interface Fuel { code: string; name: string; ncv: number; co2: number; ch4: number; n2o: number; ch4Mobile: number | null; n2oMobile: number | null; density: number | null; gas: boolean; biogenic: boolean }
export interface Stream {
  id: string; name: string; kind: Kind; fuel?: string | null; material?: string | null; mobile?: boolean; fallback?: boolean;
  adQty?: number | null; adUnit?: 't' | 'TJ' | 'kNm3' | 'kL'; density?: number | null; ncv?: number | null; ef?: number | null; of?: number | null; carbon?: number | null; direction?: 'input' | 'output';
  biomass?: number | null; ch4Ef?: number | null; n2oEf?: number | null; measuredCo2?: number | null; measuredCh4?: number | null; gas?: string | null; gasT?: number | null;
  uncertainty?: number | null; materiality?: Materiality | null; instrument?: string; efSource?: string; note?: string; documentId?: string | null;
  entryKey?: string | null; entriesT?: number | null; entries?: number | null;
}
export interface StreamResult { id: string; tj: number | null; co2: number; co2Bio: number; ch4: number; n2o: number; other: number; co2e: number; tier: 0 | 1 | 2 | 3 | 4 | null; tierRequired: number; materiality: Materiality; autoMateriality: Materiality; ok: boolean; problems: string[] }
export interface FacilityResult {
  streams: StreamResult[]; co2: number; co2Bio: number; ch4: number; n2o: number; other: number; total: number; direct: number;
  byGas: { gas: string; t: number; co2e: number }[]; uncertainty: number | null; thresholdMet: boolean; problems: string[]; thresholds: { deMinimis: number; minor: number };
}
export interface Facility {
  id: string; name: string; nodeId: string | null; emirate: string; sector: Sector; subSector: string | null; eadId: string | null; permitNo: string | null; operator: string | null; address: string | null;
  operationsStart: string | null; registeredOn: string | null; mpVersion: string | null; mpSubmitted: string | null; mpChange: string | null; verifier: string | null; verifierSince: number | null; notes: string; updatedName: string | null;
}
export type FacilityBody = Omit<Facility, 'id' | 'updatedName'>;
export interface Ead { status: 'not_abu_dhabi' | 'voluntary' | 'unknown' | 'required' | 'below'; text: string }
export interface Year {
  year: number; exists: boolean; status: YearStatus; submittedOn: string | null; reference: string | null; production: { product: string; qty: number | null; unit: string }[];
  gaps: { description: string; approach: string; t: number | null }[]; qa: string; verifNotified: string | null; siteVisit: string | null; verifiedOn: string | null; opinion: 'unmodified' | 'modified' | 'adverse' | null; statementDoc: string | null;
  updatedName: string | null; updatedAt: string | null;
}
export type YearBody = Omit<Year, 'year' | 'exists' | 'updatedName' | 'updatedAt'>;
export interface Measure { id: string; facilityId: string | null; title: string; means: string; status: 'implemented' | 'planned' | 'studied'; startYear: number | null; tPerYear: number | null; capexAed: number | null; note: string; createdName: string | null }
export type MeasureBody = Omit<Measure, 'id' | 'createdName'>;
export interface CalItem { date: string; what: string; who: 'EAD' | 'Federal' }
export interface Company {
  year: number; designated: 'yes' | 'no' | 'unknown'; designationRef: string | null; nrccNo: string | null; nrccRegistered: string | null; ieqtStatus: 'not_started' | 'registered' | 'draft' | 'submitted' | 'verified';
  ieqtSubmitted: string | null; ieqtRef: string | null; verifier: string | null; s1Typed: number | null; s2Typed: number | null; notes: string; updatedName: string | null;
}
export type CompanyBody = Omit<Company, 'year' | 'updatedName'>;
export interface Overview {
  year: number; company: Company; measures: Measure[]; calendar: CalItem[]; emirates: Record<string, string>; sectors: Record<Sector, { label: string; covered: boolean; hint: string }>; fuels: Fuel[];
  means: Record<string, string>; tiers: { tier: number; max: number }[]; thresholds: { ead: number; nrcc: number; verificationFrom: number };
  facilities: (Facility & { result: { total: number; direct: number; streams: number; problems: number; uncertainty: number | null }; status: YearStatus; ead: Ead })[];
  federal: { s1: number | null; s2: number | null; total: number | null; large: boolean; duties: string[]; source: 'entries' | 'typed' | 'facilities' | 'none'; processOnly: number; byEmirate: { id: string; name: string; emirate: string | null; s1: number; s2: number; entries: number }[]; byGas: { gas: string; t: number; co2e: number }[] };
  nodes: { id: string; name: string; grid_region: string | null }[]; gases: { code: string; name: string }[]; ekotrace: boolean; canSetup: boolean; canData: boolean;
}
export interface Detail {
  facility: Facility; streams: Stream[]; result: FacilityResult; year: Year; ead: Ead; problems: string[]; gwpSet: string; calendar: CalItem[]; measures: Measure[];
  node: { id: string; name: string } | null; documents: { id: string; name: string }[]; years: number[]; ekotrace: boolean; canSetup: boolean; canData: boolean;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40);
export const mrvApi = {
  overview: (year: number) => call<Overview>('GET', `/api/uae-mrv?year=${year}`),
  company: (year: number, b: CompanyBody) => call<{ ok: true }>('PUT', `/api/uae-mrv/company/${year}`, b),
  addFacility: (b: FacilityBody) => call<{ id: string }>('POST', '/api/uae-mrv/facilities', b),
  saveFacility: (id: string, b: FacilityBody) => call<{ ok: true }>('PUT', `/api/uae-mrv/facilities/${id}`, b),
  deleteFacility: (id: string) => call<{ ok: true }>('DELETE', `/api/uae-mrv/facilities/${id}`),
  detail: (id: string, year: number) => call<Detail>('GET', `/api/uae-mrv/facilities/${id}?year=${year}`),
  saveYear: (id: string, year: number, b: YearBody) => call<{ ok: true }>('PUT', `/api/uae-mrv/facilities/${id}/years/${year}`, b),
  saveStreams: (id: string, year: number, streams: Stream[]) => call<{ ok: true }>('PUT', `/api/uae-mrv/facilities/${id}/years/${year}/streams`, { streams }),
  fromEntries: (id: string, year: number) => call<{ added: number; updated: number; removed: number }>('POST', `/api/uae-mrv/facilities/${id}/years/${year}/from-entries`),
  addMeasure: (b: MeasureBody) => call<{ id: string }>('POST', '/api/uae-mrv/measures', b),
  saveMeasure: (id: string, b: MeasureBody) => call<{ ok: true }>('PUT', `/api/uae-mrv/measures/${id}`, b),
  deleteMeasure: (id: string) => call<{ ok: true }>('DELETE', `/api/uae-mrv/measures/${id}`),
  exportFacility: (id: string, year: number, name: string) => download(`/api/uae-mrv/facilities/${id}/years/${year}/export`, `EAD_MRV_${safe(name)}_${year}.xlsx`),
  exportFederal: (year: number) => download(`/api/uae-mrv/company/${year}/export`, `UAE_MRV_federal_${year}.xlsx`),
};
/** The last complete calendar year in the UAE. */
export const lastYear = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric' }).format(new Date())) - 1;
