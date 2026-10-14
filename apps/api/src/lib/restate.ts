/**
 * The base year as originally measured (approved entries, with the company's consolidation approach) and the
 * restatements applied to it. A restatement for a facility counts in every view that includes that facility;
 * one for the whole company (an acquisition outside the platform, a method change) counts in whole-company views.
 * A facility switched off (sold) is already left out of its views, so its divestment record documents the
 * change without being subtracted twice.
 */
import type { Tx } from '../db/pool.js';

export interface Scopes { s1: number; s2: number; s2m: number; s3: number }
export const TRIGGERS: Record<string, string> = {
  acquisition: 'Acquisition or merger', divestment: 'Divestment or closure', insourcing: 'Activity brought in-house', outsourcing: 'Activity outsourced',
  method: 'Calculation method improved', factor: 'Emission factors or GWP changed', error: 'Error found', boundary: 'Boundary or consolidation changed', other: 'Other',
};

async function weight(c: Tx, tenant: string) {
  const t = (await c.query('SELECT consolidation FROM tenant WHERE id = $1', [tenant])).rows[0];
  return t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
}

/** Base-year emissions of the facilities given, as measured (tCO2e, approved entries). */
export async function measured(c: Tx, tenant: string, year: number, facs: string[]): Promise<Scopes & { total: number }> {
  const W = await weight(c, tenant);
  const r = (await c.query(
    `SELECT coalesce(sum(a.co2e_direct * ${W}), 0)::float8 / 1000 AS s1, coalesce(sum(a.co2e_scope2 * ${W}), 0)::float8 / 1000 AS s2, coalesce(sum(a.co2e_scope2_market * ${W}), 0)::float8 / 1000 AS s2m,
            coalesce(sum((a.co2e_scope3 + a.co2e_wtt + a.co2e_td) * ${W}), 0)::float8 / 1000 AS s3
       FROM activity a JOIN org_node f ON f.id = a.facility_id WHERE a.facility_id = ANY($1) AND a.status = 'approved' AND extract(year FROM a.period_start) = $2`, [facs, year])).rows[0];
  return { s1: r.s1, s2: r.s2, s2m: r.s2m, s3: r.s3, total: r.s1 + r.s2 + r.s3 };
}

/** Restatements applied to the base year for a view (facilities, and whether it is the whole company). */
export async function adjustments(c: Tx, year: number, facs: string[], whole: boolean) {
  const items = (await c.query(
    `SELECT r.id, r.trigger, r.title, r.facility_id, f.name AS facility, r.s1_t::float8 AS s1, r.s2_t::float8 AS s2, coalesce(r.s2m_t, r.s2_t)::float8 AS s2m, r.s3_t::float8 AS s3, r.applied_at
       FROM base_restatement r LEFT JOIN org_node f ON f.id = r.facility_id
      WHERE r.base_year = $1 AND r.status = 'approved' AND r.applied AND (CASE WHEN r.facility_id IS NULL THEN $3 ELSE r.facility_id = ANY($2) END)
      ORDER BY r.applied_at`, [year, facs, whole])).rows as { id: string; trigger: string; title: string; facility_id: string | null; facility: string | null; s1: number; s2: number; s2m: number; s3: number; applied_at: string }[];
  const sum = items.reduce((a, x) => ({ s1: a.s1 + x.s1, s2: a.s2 + x.s2, s2m: a.s2m + x.s2m, s3: a.s3 + x.s3 }), { s1: 0, s2: 0, s2m: 0, s3: 0 });
  return { ...sum, items };
}

/** Is this view the whole company? (no sub-group / group filter, and the person sees every facility) */
export async function isWhole(c: Tx, facs: string[], node?: string, group?: string): Promise<boolean> {
  if (group) return false;
  if (node && (await c.query(`SELECT kind FROM org_node WHERE id = $1`, [node])).rows[0]?.kind !== 'group') return false;
  const all = Number((await c.query(`SELECT count(*)::int AS n FROM org_node WHERE kind = 'facility' AND active`)).rows[0].n);
  return facs.length >= all;
}
