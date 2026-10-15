/**
 * Supplier climate score (0–100 → A+ … E) and engagement stage.
 *
 * Five parts, each from what is known about the supplier (its answers on the supplier portal, the profile kept by
 * the company, its CDP score and the SBTi list):
 *   Measures its emissions   25   inventory (15, partial 8) · Scope 3 (+5) · verification (limited +3, reasonable +5)
 *   Reduction target         30   SBTi validated 25 · committed 15 · own with a % 10 (without 6) · net-zero year +5
 *   Public disclosure        15   CDP A/A- 15 · B/B- 11 · C/C- 7 · D/D- 3
 *   Shares data with you     20   answers accepted 15 (submitted 8) · share of its emissions for you +5
 *   Product footprints       10   footprints given 6 · verified +4
 * Grades: A+ ≥ 85 · A ≥ 70 · B ≥ 55 · C ≥ 40 · D ≥ 20 · E below. Each missing point comes with the action that earns it.
 */

export interface ScoreInput {
  reports_emissions?: string | null; climate_target?: string | null; cdp_score?: string | null;
  target?: { reductionPct?: number | null; netZeroYear?: number | null } | null;
  sbti?: { near_status?: string | null; net_zero_year?: number | null } | null;
  request?: { status?: string | null; answers?: Record<string, unknown> | null } | null;
}
export interface ScorePart { key: string; label: string; points: number; max: number; note: string }
export interface Score { score: number; letter: string; parts: ScorePart[]; actions: string[]; sbtiValidated: boolean; ghgReport: boolean }

const CDP: Record<string, number> = { A: 15, 'A-': 15, B: 11, 'B-': 11, C: 7, 'C-': 7, D: 3, 'D-': 3, F: 0 };
export const letterOf = (s: number) => (s >= 85 ? 'A+' : s >= 70 ? 'A' : s >= 55 ? 'B' : s >= 40 ? 'C' : s >= 20 ? 'D' : 'E');

/** The SBTi list says the company has validated near-term targets. */
export const sbtiSet = (st: string | null | undefined) => !!st && /targets? set/i.test(st);
export const sbtiCommitted = (st: string | null | undefined) => !!st && /commit/i.test(st) && !/remov|expir/i.test(st);

export function supplierScore(x: ScoreInput): Score {
  const a = (x.request?.status && ['submitted', 'accepted'].includes(x.request.status) ? x.request.answers : null) as {
    inventory?: { reports?: string; scope3?: number | null; verification?: string | null }; allocation?: { method?: string };
    targets?: { status?: string; reductionPct?: number | null; netZeroYear?: number | null }; products?: { items?: { verified?: boolean }[] };
  } | null;
  const parts: ScorePart[] = [], actions: string[] = [];
  // 1 · measures its emissions
  const reports = a?.inventory?.reports ?? (x.reports_emissions === 'yes' ? 'yes' : x.reports_emissions === 'no' ? 'no' : null);
  let p1 = reports === 'yes' ? 15 : reports === 'partial' ? 8 : 0;
  if (a?.inventory?.scope3 != null) p1 += 5;
  const ver = a?.inventory?.verification;
  p1 += ver === 'reasonable' ? 5 : ver === 'limited' ? 3 : 0;
  p1 = Math.min(25, p1);
  parts.push({ key: 'inventory', label: 'Measures its emissions', points: p1, max: 25, note: reports === 'yes' ? `GHG inventory${a?.inventory?.scope3 != null ? ' incl. Scope 3' : ''}${ver && ver !== 'none' ? `, ${ver} assurance` : ''}` : reports === 'partial' ? 'Partial estimates' : reports === 'no' ? 'Not measured' : 'Not known' });
  if (reports !== 'yes') actions.push('Measure Scope 1 and 2 emissions every year (GHG Protocol Corporate Standard).');
  if (reports === 'yes' && a?.inventory?.scope3 == null) actions.push('Add Scope 3 — at least purchased goods, transport and business travel.');
  if (reports === 'yes' && (!ver || ver === 'none')) actions.push('Have the inventory independently verified (limited assurance to ISO 14064-3 or ISAE 3410).');
  // 2 · reduction target
  const validated = x.climate_target === 'sbti_validated' || a?.targets?.status === 'sbti_validated' || sbtiSet(x.sbti?.near_status);
  const committed = !validated && (x.climate_target === 'sbti_committed' || a?.targets?.status === 'sbti_committed' || sbtiCommitted(x.sbti?.near_status));
  const own = !validated && !committed && (x.climate_target === 'own' || a?.targets?.status === 'own');
  const pct = a?.targets?.reductionPct ?? x.target?.reductionPct ?? null;
  const nz = a?.targets?.netZeroYear ?? x.target?.netZeroYear ?? x.sbti?.net_zero_year ?? null;
  let p2 = validated ? 25 : committed ? 15 : own ? (pct != null ? 10 : 6) : 0;
  if (nz) p2 += 5;
  p2 = Math.min(30, p2);
  parts.push({ key: 'target', label: 'Reduction target', points: p2, max: 30, note: `${validated ? 'Science-based target validated' : committed ? 'Committed to the SBTi' : own ? `Own target${pct != null ? ` −${pct}%` : ''}` : 'No target known'}${nz ? ` · net zero ${nz}` : ''}` });
  if (!validated && !committed) actions.push(own ? 'Have the target validated by the Science Based Targets initiative.' : 'Set an emission-reduction target, ideally science-based (commit to the SBTi).');
  if (committed) actions.push('Submit the target for SBTi validation within 24 months of committing.');
  if (!nz) actions.push('Set a net-zero year.');
  // 3 · public disclosure
  const p3 = x.cdp_score ? CDP[x.cdp_score] ?? 0 : 0;
  parts.push({ key: 'disclosure', label: 'Public disclosure', points: p3, max: 15, note: x.cdp_score ? `CDP score ${x.cdp_score}` : 'No CDP score known' });
  if (!x.cdp_score) actions.push('Disclose through CDP each year.');
  else if (p3 < 11) actions.push('Improve the CDP climate score (B or better).');
  // 4 · shares data with you
  const st = x.request?.status;
  let p4 = st === 'accepted' ? 15 : st === 'submitted' ? 8 : 0;
  if (a?.allocation?.method && a.allocation.method !== 'none') p4 += 5;
  parts.push({ key: 'data', label: 'Shares data with you', points: p4, max: 20, note: st === 'accepted' ? 'Answers accepted' : st === 'submitted' ? 'Answers to review' : st ? 'Request open' : 'Not asked yet' });
  if (st !== 'accepted' && st !== 'submitted') actions.push('Answer the customer\'s data request on the supplier portal.');
  else if (!a?.allocation?.method || a.allocation.method === 'none') actions.push('Work out the share of your emissions relating to this customer.');
  // 5 · product footprints
  const items = a?.products?.items ?? [];
  const p5 = items.length ? 6 + (items.some((i) => i.verified) ? 4 : 0) : 0;
  parts.push({ key: 'products', label: 'Product footprints', points: p5, max: 10, note: items.length ? `${items.length} footprint${items.length > 1 ? 's' : ''}${items.some((i) => i.verified) ? ', verified' : ''}` : 'None' });
  if (!items.length) actions.push('Publish carbon footprints of the main products (EPD or ISO 14067).');
  const score = parts.reduce((s, q) => s + q.points, 0);
  return { score, letter: letterOf(score), parts, actions, sbtiValidated: validated, ghgReport: reports === 'yes' };
}

/** Where the supplier is in the engagement funnel (from its latest request). */
export function stageOf(r: { status?: string | null; revoked?: boolean | null; last_used_at?: string | Date | null } | null | undefined): 'not_engaged' | 'invited' | 'signed_in' | 'started' | 'submitted' | 'finished' {
  if (!r?.status) return 'not_engaged';
  if (r.status === 'accepted') return 'finished';
  if (r.status === 'submitted') return 'submitted';
  if (r.status === 'in_progress' || r.status === 'queried') return 'started';
  return r.last_used_at ? 'signed_in' : 'invited';
}
export const STAGE_SQL = `CASE WHEN rq.status IS NULL THEN 'not_engaged' WHEN rq.status = 'accepted' THEN 'finished' WHEN rq.status = 'submitted' THEN 'submitted'
  WHEN rq.status IN ('in_progress', 'queried') THEN 'started' WHEN rq.last_used_at IS NOT NULL THEN 'signed_in' ELSE 'invited' END`;
