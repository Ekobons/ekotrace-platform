/** Supplier portal: the questionnaire's shape, labels and the figures that follow from the answers (shared by the supplier's page and the staff review). */

export interface SPProfile { legalName?: string | null; country?: string | null; trn?: string | null; website?: string | null; industry?: string | null; size?: 'micro' | 'small' | 'medium' | 'large' | null; employees?: number | null; contactName?: string | null; contactRole?: string | null; phone?: string | null }
export interface SPInventory {
  reports?: 'yes' | 'partial' | 'no' | null; scope1?: number | null; scope2Location?: number | null; scope2Market?: number | null; scope3?: number | null; scope3Categories?: string | null;
  boundary?: 'operational' | 'financial' | 'equity' | null; standard?: string | null; verification?: 'none' | 'limited' | 'reasonable' | null; verifier?: string | null; revenue?: number | null; currency?: string | null; notes?: string | null;
}
export interface SPAllocation { method?: 'revenue' | 'direct' | 'none' | null; customerRevenue?: number | null; directT?: number | null; notes?: string | null }
export interface SPTargets { status?: 'sbti_validated' | 'sbti_committed' | 'own' | 'none' | null; baseYear?: number | null; targetYear?: number | null; reductionPct?: number | null; scopes?: string | null; netZeroYear?: number | null; link?: string | null }
export interface SPProduct { name: string; description?: string | null; co2e: number; unit: string; standard?: string | null; boundary?: 'cradle-to-gate' | 'cradle-to-grave' | 'gate-to-gate' | null; validFrom?: string | null; validTo?: string | null; verified?: boolean; documentId?: string | null }
export interface SPAnswers { profile?: SPProfile; inventory?: SPInventory; allocation?: SPAllocation; targets?: SPTargets; products?: { none?: boolean; items?: SPProduct[] }; declaration?: { name: string; title: string; at: string } }
export interface SPDoc { id: string; filename: string; kind: 'report' | 'verification' | 'epd' | 'other'; size?: number; at?: string }
export interface SPProgress { done: Record<'profile' | 'inventory' | 'allocation' | 'targets' | 'products', boolean>; n: number; of: number }
export interface SPDerived { s12: number | null; intensity: number | null; currency: string | null; allocated: number | null; share: number | null }
export type SPStatus = 'invited' | 'in_progress' | 'submitted' | 'queried' | 'accepted';

export const SP_STATUS: Record<SPStatus, [string, string]> = {
  invited: ['grey', 'Invited'], in_progress: ['info', 'In progress'], submitted: ['warn', 'Submitted · to review'], queried: ['bad', 'Queried'], accepted: ['', 'Accepted'],
};
export const SP_TARGET: Record<string, string> = { sbti_validated: 'Science-based target, validated by SBTi', sbti_committed: 'Committed to set a science-based target (SBTi)', own: 'Own reduction target (not SBTi)', none: 'No reduction target yet' };
export const SP_VERIF: Record<string, string> = { none: 'Not verified', limited: 'Limited assurance', reasonable: 'Reasonable assurance' };
export const SP_BOUNDARY: Record<string, string> = { operational: 'Operational control', financial: 'Financial control', equity: 'Equity share' };
export const SP_DOCKIND: Record<string, string> = { report: 'Sustainability / emissions report', verification: 'Verification statement', epd: 'EPD or product footprint', other: 'Other' };
export const SP_UNITS = ['kg', 't', 'L', 'm3', 'kWh', 'pcs'];
export const SP_STANDARDS = ['EPD (ISO 14025 / EN 15804)', 'ISO 14067', 'GHG Protocol Product Standard', 'PAS 2050', 'Other'];
export const nf = (x: number | null | undefined, d = 1) => (x == null ? '—' : x.toLocaleString('en-GB', { maximumFractionDigits: d }));
