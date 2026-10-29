/**
 * An SME's data for one financial year: load its module documents, run the engine, and keep
 * sme_result (the figures partners and the benchmark read) up to date.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Tx } from '../../db/pool.js';
import * as E from './engine.js';
import { cfg as loadCfg } from './settings.js';

export const MODULES = ['profile', 'emissions', 'esg', 'certs', 'footprint', 'bills', 'solar', 'credits', 'calendar', 'epr', 'dpdp', 'people', 'csr', 'cbam', 'eudr', 'srmm', 'loan', 'share', 'questionnaire'] as const;
export type Module = (typeof MODULES)[number];

export const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Other'];

export const DEFAULT_CERTS = [
  { id: 'zed', name: 'MSME ZED certification', level: 'none', expiry: '' },
  { id: 'iso9001', name: 'ISO 9001 quality', level: 'none', expiry: '' },
  { id: 'iso14001', name: 'ISO 14001 environment', level: 'none', expiry: '' },
  { id: 'iso45001', name: 'ISO 45001 safety', level: 'none', expiry: '' },
  { id: 'iso50001', name: 'ISO 50001 energy', level: 'none', expiry: '' },
  { id: 'iso27001', name: 'ISO 27001 information security', level: 'none', expiry: '' },
  { id: 'ecovadis', name: 'EcoVadis rating', level: 'none', expiry: '' },
  { id: 'greenco', name: 'CII GreenCo rating', level: 'none', expiry: '' },
];

/** Indian financial year (April–March) of a date, e.g. "FY 2026-27". */
export function fyOf(date = new Date()): string {
  const y = date.getUTCFullYear(), start = date.getUTCMonth() >= 3 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
export function previousFy(fy: string): string | null {
  const m = /^FY (\d{4})-/.exec(fy);
  if (!m) return null;
  const s = Number(m[1]) - 1;
  return `FY ${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}
export const isFy = (s: unknown): s is string => typeof s === 'string' && /^FY \d{4}-\d{2}$/.test(s);

/** The SME's own row (created the first time the company opens the SME tool). */
export async function ensureCompany(c: Tx, tenant: string) {
  await c.query(`INSERT INTO sme_company (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenant]);
  return (await c.query(`SELECT s.*, t.name FROM sme_company s JOIN tenant t ON t.id = s.tenant_id WHERE s.tenant_id = $1`, [tenant])).rows[0];
}

/** Financial years with data, newest first, always including the current one. */
export async function years(c: Tx, tenant: string): Promise<string[]> {
  const ys = new Set((await c.query(`SELECT DISTINCT fy FROM sme_doc WHERE tenant_id = $1`, [tenant])).rows.map((r: any) => r.fy as string));
  ys.add(fyOf());
  return [...ys].sort().reverse();
}

/** Module documents and the extra facts the engine reads (scrap, grievances, prior year). Inside a tenant transaction. */
export async function load(c: Tx, tenant: string, fy: string) {
  const company = await ensureCompany(c, tenant);
  const rows = (await c.query(`SELECT module, data, version, updated_name, updated_at FROM sme_doc WHERE tenant_id = $1 AND fy = $2`, [tenant, fy])).rows;
  const d: Record<string, any> = {}, meta: Record<string, { version: number; updatedName: string | null; updatedAt: string }> = {};
  for (const r of rows) { d[r.module] = r.data; meta[r.module] = { version: r.version, updatedName: r.updated_name, updatedAt: r.updated_at }; }
  d.profile = Object.assign({}, d.profile ?? {}, { name: company.name, sector: company.sector, industry: company.industry, state: company.state });
  if (!Array.isArray(d.certs) || !d.certs.length) d.certs = DEFAULT_CERTS;
  d.srmm = Object.assign({ version: 'auto', scores: {}, multi: {}, remarks: {} }, d.srmm ?? {});
  d.scrap = (await c.query(`SELECT item, qty, unit, price, hazardous, status FROM sme_scrap WHERE tenant_id = $1 AND status IN ('draft', 'listed')`, [tenant])).rows;
  const g = (await c.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'resolved')::int AS resolved FROM sme_grievance WHERE tenant_id = $1`, [tenant])).rows[0];
  d.grievances = { total: g.total, resolved: g.resolved };
  const prev = previousFy(fy);
  const p = prev ? (await c.query(`SELECT scope1, scope2 FROM sme_result WHERE tenant_id = $1 AND fy = $2`, [tenant, prev])).rows[0] : null;
  d.priorYear = p ? { total: Number(p.scope1) + Number(p.scope2) } : null;
  return { company, d, meta };
}

/** Load, calculate and store the figures. Inside a tenant transaction. */
export async function compute(c: Tx, tenant: string, fy: string) {
  const config = await loadCfg();
  const { company, d, meta } = await load(c, tenant, fy);
  const r = E.all(d, config);
  const s12 = r.emissions.s1 + r.emissions.s2 || 1;
  const sources = r.emissions.rows.filter((x: any) => x.scope !== 3 && x.tco2e > 0).map((x: any) => ({ key: x.key, share: x.tco2e / s12 }));
  await c.query(
    `INSERT INTO sme_result (tenant_id, fy, scope1, scope2, scope3, intensity, esg_pct, esg_level, srmm_pct, srmm_level, srmm_version, cbam_see, savings_inr, solar_kw, pf_flagged, bench_consent, industry, state, sector, sources, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
     ON CONFLICT (tenant_id, fy) DO UPDATE SET scope1 = EXCLUDED.scope1, scope2 = EXCLUDED.scope2, scope3 = EXCLUDED.scope3, intensity = EXCLUDED.intensity,
       esg_pct = EXCLUDED.esg_pct, esg_level = EXCLUDED.esg_level, srmm_pct = EXCLUDED.srmm_pct, srmm_level = EXCLUDED.srmm_level, srmm_version = EXCLUDED.srmm_version,
       cbam_see = EXCLUDED.cbam_see, savings_inr = EXCLUDED.savings_inr, solar_kw = EXCLUDED.solar_kw, pf_flagged = EXCLUDED.pf_flagged, bench_consent = EXCLUDED.bench_consent,
       industry = EXCLUDED.industry, state = EXCLUDED.state, sector = EXCLUDED.sector, sources = EXCLUDED.sources, updated_at = now()`,
    [tenant, fy, r.emissions.s1, r.emissions.s2, r.emissions.s3, r.emissions.intensity, r.esg.overall, r.esg.level, r.srmm.pct * 100, r.srmm.level, r.srmm.version,
      r.cbam.applies ? r.cbam.see : null, r.money.savingsFound, r.solar.kw, r.bills.pfSave > 0, !!d.share?.bench, company.industry, company.state, company.sector, JSON.stringify(sources)]);
  return { company, d, meta, results: r, cfg: config };
}

/** What the screens need from the settings (never the whole thing). */
export function uiConfig(config: any) {
  const F = config.factors;
  return {
    factors: { version: F.version, note: F.note, items: Object.fromEntries(Object.entries<any>(F.items).map(([k, v]) => [k, { label: v.label, unit: v.unit, scope: v.scope, category: v.category ?? null, factor: v.factor, source: v.source ?? null }])) },
    srmm: { mfg: config.srmm_mfg, svc: config.srmm_svc },
    dpdp: config.dpdp,
    cbam: { benchmarks: config.cbam.benchmarks, default_values: config.cbam.default_values, eu_price_eur: config.cbam.eu_price_eur, eur_inr: config.cbam.eur_inr, uk_price_gbp: config.cbam.uk_price_gbp, gbp_inr: config.cbam.gbp_inr, free_allocation_share: config.cbam.free_allocation_share, uk_start: config.cbam.uk_start, note: config.cbam.note },
    tariffs: config.tariffs, solar: config.solar, credit_pool: config.credit_pool, plans: config.plans, content: config.content,
    states: STATES,
  };
}
