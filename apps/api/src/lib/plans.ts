/**
 * Subscription plans (set by the Ekobon team in the platform console). Each plan caps the
 * facilities and people a company can have and switches features on:
 *   ai       Eko AI (AI mapping of unclear purchases, when an approved AI service is configured)
 *   export   downloads of data (published purchase lines, vehicle data, dashboard figures)
 *   groups   dashboard groups (any mix of facilities viewed together)
 * Checked on the server; the screens hide or explain what the plan does not include.
 */
import type { Tx } from '../db/pool.js';
import { AppError } from './errors.js';

export type PlanCode = 'trial' | 'starter' | 'professional' | 'enterprise';
export interface Plan { code: PlanCode; name: string; facilities: number | null; users: number | null; ai: boolean; export: boolean; groups: boolean; note: string }
export const PLANS: Record<PlanCode, Plan> = {
  trial: { code: 'trial', name: 'Trial', facilities: 3, users: 5, ai: false, export: false, groups: false, note: '30-day evaluation' },
  starter: { code: 'starter', name: 'Starter', facilities: 10, users: 15, ai: false, export: true, groups: false, note: 'Single site or small portfolio' },
  professional: { code: 'professional', name: 'Professional', facilities: 40, users: 75, ai: true, export: true, groups: true, note: 'Multi-entity groups' },
  enterprise: { code: 'enterprise', name: 'Enterprise', facilities: null, users: null, ai: true, export: true, groups: true, note: 'Unlimited, ERP and API integrations' },
};
const FEATURE: Record<'ai' | 'export' | 'groups', [string, string]> = {
  ai: ['Eko AI', 'Professional'], export: ['Downloading data', 'Starter'], groups: ['Dashboard groups', 'Professional'],
};

export async function planOf(c: Tx, tenant: string): Promise<Plan> {
  const p = (await c.query('SELECT plan FROM tenant WHERE id = $1', [tenant])).rows[0]?.plan as PlanCode | undefined;
  return PLANS[p ?? 'trial'] ?? PLANS.trial;
}
const upgrade = 'Contact the Ekobon team to upgrade.';
export async function requireFeature(c: Tx, tenant: string, f: 'ai' | 'export' | 'groups') {
  const p = await planOf(c, tenant);
  if (!p[f]) throw new AppError(`${FEATURE[f][0]} is not on the ${p.name} plan (${FEATURE[f][1]} and above). ${upgrade}`, 403, 'PLAN_LIMIT');
  return p;
}
/** Before adding a facility (or bringing one back from the archive). */
export async function checkFacilityLimit(c: Tx, tenant: string) {
  const p = await planOf(c, tenant);
  if (p.facilities == null) return;
  const n = Number((await c.query(`SELECT count(*) AS n FROM org_node WHERE kind = 'facility' AND active`)).rows[0].n);
  if (n >= p.facilities) throw new AppError(`The ${p.name} plan allows ${p.facilities} facilities (${n} in use). ${upgrade}`, 403, 'PLAN_LIMIT');
}
/** Before adding a person (or enabling one again). */
export async function checkUserLimit(c: Tx, tenant: string) {
  const p = await planOf(c, tenant);
  if (p.users == null) return;
  const n = Number((await c.query(`SELECT count(*) AS n FROM app_user WHERE tenant_id = $1 AND NOT disabled`, [tenant])).rows[0].n);
  if (n >= p.users) throw new AppError(`The ${p.name} plan allows ${p.users} people (${n} in use). ${upgrade}`, 403, 'PLAN_LIMIT');
}
