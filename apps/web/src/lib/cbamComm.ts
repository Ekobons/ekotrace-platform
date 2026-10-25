/** Types of the CBAM communication (exporter portal); mirror apps/api/src/lib/cbamComm.ts. */
type N = number | null;
export interface CommGood { name: string; unit: string; indirect: boolean; routeRelevant: boolean; routes: string[]; precursors: string[]; chain: string[]; cn: string[] }
export interface CommLists {
  version: string; goods: CommGood[]; cnNames: Record<string, string>; countries: [string, string][]; currencies: [string, string][];
  lists: Record<'elecSource' | 'dataQuality' | 'verification' | 'justification' | 'carbonPrice' | 'rebate' | 'efUnits' | 'adUnits' | 'cemsGas' | 'method' | 'pfcMethod' | 'reducingAgent' | 'measDefault', string[]>;
  limits: { goods: number; processes: number; precursors: number; streams: number; pfc: number; measured: number; products: number };
  params: { col: string; key: string; label: string; kind: 'pct' | 'bool' }[];
  consts: { efNatGas: number; gwpN2O: number; gwpCF4: number; gwpC2F6: number };
}
export interface CommProcess {
  id: string; name: string; category: string; includes: string[]; production: N[]; market: N; consumedIn: Record<string, N>; nonCbam: N;
  heatApplicable: boolean; wasteGasApplicable: boolean; dirEm: N;
  heat: { imp: N; impEf: N; exp: N; expEf: N }; wasteGas: { imp: N; impEf: N; exp: N; expEf: N };
  elecMwh: N; elecEf: N; elecSource: string; elecExported: N; elecExportedEf: N;
  carbon: { share: N; price: N; rebate: N };
}
export interface CommPrecursor {
  id: string; name: string; category: string; country: string; routes: string[]; purchased: N[]; consumedIn: Record<string, N>; other: N;
  seeDirect: N; seeDirectSource: string; elecPerT: N; elecPerTSource: string; elecEf: N; elecEfSource: string; justification: string;
}
export interface CommStream { method: string; name: string; ad: N; unit: string; ncv: N; ef: N; efUnit: string; carbon: N; oxf: N; convf: N; bio: N }
export interface CommPfc { method: string; technology: string; ad: N; frequency: N; duration: N; sef: N; aeo: N; ce: N; ovc: N; fC2F6: N; collection: N }
export interface CommMeasured { name: string; gas: string; bio: N; conc: N; hours: N; flow: N; energyFossil: N; energyBio: N }
export interface CommProduct {
  processId: string; cn: string; name: string; reducingAgent: string; millId: string; params: Record<string, number | boolean | null>;
  cpType: string; cpShare: N; currency: string; cpDue: N; rebateType: string; rebateShare: N; rebate: N;
}
export interface CommData {
  period: { start: string | null; end: string | null };
  installation: { nameLocal: string; name: string; street: string; economicActivity: string; postcode: string; poBox: string; city: string; country: string; unlocode: string; lat: string; lon: string; repName: string; email: string; phone: string };
  verifier: { company: string; street: string; city: string; postcode: string; country: string; repName: string; email: string; phone: string; fax: string; accreditationState: string; accreditationBody: string; registration: string };
  goods: { category: string; routes: string[] }[];
  processes: CommProcess[]; precursors: CommPrecursor[]; streams: CommStream[]; pfc: CommPfc[]; measured: CommMeasured[];
  fuel: { total: N; cbam: N; electricity: N; nonCbam: N };
  ghg: { co2: N; biomass: N; n2o: N; pfc: N; indirect: N };
  quality: { general: string; justification: string; assurance: string };
  products: CommProduct[]; carbonCurrency: string;
}
export type Step = 'installation' | 'goods' | 'emissions' | 'energy' | 'processes' | 'precursors' | 'products' | 'review';
export interface CommNode { id: string; name: string; kind: 'process' | 'precursor'; category: string; unit: string; total: number; attrDirect: number; attrIndirect: number; elec: number;
  seeDirect: N; seeIndirect: N; seeTotal: N; embeddedElec: N; defaultShare: N; elecSource: string; cpDue: N; rebate: N;
  chain: { id: string; name: string; perUnit: number; seeDirect: number; seeIndirect: number; isDefault: boolean }[] }
export interface CommResult {
  streams: { co2: N; bio: number; energyFossil: number; energyBio: number; problem: string | null }[]; pfc: N[]; measured: N[];
  fuel: { fromStreams: number; total: number; rest: N };
  ghg: { co2: number; biomass: number; n2o: number; pfc: number; direct: number; indirect: N; total: N; indirectSuggested: number; auto: { co2: number; biomass: number; n2o: number; pfc: number } };
  nodes: CommNode[];
  products: { i: number; processName: string; category: string; cnName: string; seeDirect: N; seeIndirect: N; seeTotal: N; unit: string; defaultShare: N; elecSource: string; embeddedElec: N; cpCovered: N; rebateCovered: N; effectiveCp: N }[];
  checks: { level: 'error' | 'warn'; step: Step; msg: string }[];
}
export interface CommMeta { id: string; title: string; status: 'draft' | 'final' | 'sent'; sentTo: string; installationId: string | null; installation: string | null; periodStart: string | null; periodEnd: string | null; period: string; template: string; createdName: string; createdAt: string; updatedName: string; updatedAt: string }
export interface CommDefault { i: number; defaultValue: N; indicative: boolean | null; year: number; markup: N; defaultWithMarkup: N; relevant: N; price: N; savingPerT: N; ratio: N }
export interface CommView { comm: CommMeta; data: CommData; result: CommResult; defaults?: CommDefault[]; can?: { edit: boolean }; installations?: { id: string; name: string; country: string }[] }
export interface CommListItem extends CommMeta { products: number; processes: number; errors: number; warnings: number; goods: { cn: string; name: string; seeTotal: N; unit: string }[] }
export interface CbamSummary {
  year: number; registered: number; can: { edit: boolean };
  installations: { name: string; cells: Record<number, { id: string; status: 'draft' | 'final' | 'sent'; title: string; period: string; errors: number; sentTo: string }>; emissions: Record<number, { direct: number; indirect: number | null }> }[];
  goods: { cn: string; name: string; cnName: string; unit: string; installation: string; q: Record<number, { seeDirect: N; seeIndirect: N; seeTotal: N; defaultShare: N; embeddedElec: N; commId: string }> }[];
  comms: { id: string; title: string; installation: string; period: string; quarter: number; status: string; sentTo: string; errors: number; updatedAt: string; updatedName: string }[];
  latest: { id: string; title: string; status: string; period: string; updatedAt: string } | null;
}

// ------------------------------------------------------------------ the dedicated CBAM tool --
export type CbamRole = 'importer' | 'exporter' | 'both';
export interface CbamSettings { role: CbamRole; eori: string | null; can: { edit: boolean } }
export interface CbamAgg { key: string; label: string; sub?: string; lines: number; mass: number; embedded: number; certificates: number; cost: number; defaultMass: number; actualMass: number; problems: number }
export interface ImporterOverview {
  year: number; can: { edit: boolean };
  totals: { lines: number; mass: number; embedded: number; faa: number; certificates: number; cost: number; defaultMass: number; problems: number; markupCost: number };
  threshold: { limit: number; mass: number; share: number; byQuarter: number[]; status: 'under' | 'near' | 'over'; exempt: boolean; alwaysCovered: number; message: string };
  holding: { quarter: number; certificatesSoFar: number; toHold: number; price: N; value: N }[]; holdingShare: number; prices: N[];
  deadlines: { salesStart: string; declarationDue: string };
  byCn: CbamAgg[]; byCategory: CbamAgg[]; byOrigin: CbamAgg[]; bySupplier: CbamAgg[];
  byQuarter: { quarter: number; mass: number; embedded: number; cost: number }[];
  alerts: { level: 'bad' | 'warn' | 'info'; msg: string; link?: string }[];
  requests: { open: number; answered: number; overdue: number };
}
export interface CbamSupplierRow {
  id: string; kind: 'import' | 'precursor'; name: string; country: string | null; installation: string | null; registry_id: string | null; contact_name: string | null; contact_email: string | null; notes: string;
  mass: number; lines: number; default_lines: number; values: number; last_request: { id: string; status: string; quarter: number | null; year: number; due: string | null } | null;
}
export interface CbamRequestRow { id: string; supplier_id: string; supplier: string; country: string | null; purpose: 'import' | 'precursor'; year: number; quarter: number | null; cn_codes: string[]; due_date: string | null; status: string; contact_email: string; reminders: number; reminded_at: string | null; created_at: string; created_name: string; has_code: boolean; code_expires: string | null; responses: number; to_review: number }
export interface CbamResponseGood { cn: string; name: string; seeDirect: N; seeIndirect: N; defaultShare: N; embeddedElec: N; elecSource: string; category: string; inRequest: boolean; relevant: N; defaultValue: N; check: { level: 'ok' | 'low' | 'high' | 'nodefault' | 'missing'; ratio: N; msg: string } }
export interface CbamResponse { id: string; via: 'template' | 'form' | 'account'; from_name: string | null; from_email: string | null; filename: string | null; status: 'submitted' | 'accepted' | 'rejected'; review_note: string | null; reviewed_name: string | null; reviewed_at: string | null; submitted_at: string;
  data: { period?: { start: string | null; end: string | null }; installation?: { name: string; country: string; registryId: string }; verified?: boolean }; goods: CbamResponseGood[] }
export interface CbamRequestView { request: CbamRequestRow & { message: string; supplier_country: string | null; supplier_installation: string | null; hasCode: boolean }; responses: CbamResponse[]; messages: { side: 'requester' | 'supplier'; author: string; body: string; at: string }[]; can: { edit: boolean } }
export interface ForecastAssumptions { from: number; to: number; price: number; priceGrowth: number; volumeGrowth: number; basis: 'actual' | 'default'; switches: { key: string; see: number }[] }
export interface ForecastGroup { key: string; label: string; cn: string; origin: string; supplier: string; sector: string; mass: number; seeActual: N; defaultValue: N; benchmark: N; carbonPriceEur: N }
export interface ForecastResult { years: { year: number; cbamFactor: number; price: number; mass: number; embedded: number; faa: number; certificates: number; cost: number; missing: number }[]; groups: { key: string; label: string; cost: number[]; certificates: number[]; see: number[]; total: number }[]; total: number }
export interface CbamCnRow { cn: string; name: string; category: string; sector: string }
export interface CbamCalcResult { cn: string; name: string; category: string; sector: string; indirectCounts: boolean; country: string; tonnes: number; price: N; priceSource: string | null; thresholdNote: string; indicative: boolean; note: string;
  years: { year: number; cbamFactor: number; markup: number; defaultValue: N; defaultIndicative: boolean | null; benchmark: N; seeDefault: N; seeActual: N; certDefault: N; certActual: N; costDefault: N; costActual: N }[] }
