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
export interface CommView { comm: CommMeta; data: CommData; result: CommResult; can?: { edit: boolean }; installations?: { id: string; name: string; country: string }[] }
export interface CommListItem extends CommMeta { products: number; processes: number; errors: number; warnings: number; goods: { cn: string; name: string; seeTotal: N; unit: string }[] }
