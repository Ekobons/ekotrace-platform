/**
 * Dashboards: the year's inventory at a glance — by scope, month, category, facility,
 * Scope 3 category, the largest sources and the state of the data.
 *
 * Totals follow the company's consolidation approach (Methodology & boundaries):
 * operational or financial control (facility in or out) or equity share (× ownership %).
 * Scope 2 is shown location- or market-based (never added together). Biogenic CO2 and
 * non-Kyoto gases are reported separately, outside the totals.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { requireTenant } from '../lib/auth.js';
import { scopeOf, subtreeFacilities } from '../lib/access.js';

const GHG_CAT: Record<number, string> = {
  1: 'Purchased goods & services', 2: 'Capital goods', 3: 'Fuel- and energy-related', 4: 'Upstream transport', 5: 'Waste generated', 6: 'Business travel',
  7: 'Employee commuting', 8: 'Upstream leased assets', 9: 'Downstream transport', 10: 'Processing of sold products', 11: 'Use of sold products',
  12: 'End-of-life of sold products', 13: 'Downstream leased assets', 14: 'Franchises', 15: 'Investments',
};

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), node: z.string().uuid().optional(), scope2: z.enum(['location', 'market']).default('location') }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const see = (await scopeOf(c, req.user)).see;
      const within = q.node ? await subtreeFacilities(c, q.node) : null;
      const facs = [...see].filter((f) => !within || within.has(f));
      const t = (await c.query('SELECT consolidation, base_year FROM tenant WHERE id = $1', [tenant])).rows[0];
      const years = (await c.query(`SELECT DISTINCT extract(year FROM period_start)::int AS y FROM activity WHERE facility_id = ANY($1) ORDER BY 1 DESC`, [facs])).rows.map((r) => r.y as number);
      const year = q.year ?? years[0] ?? new Date().getFullYear();
      // weight of each facility under the consolidation approach
      const W = t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
      const S2 = q.scope2 === 'market' ? 'a.co2e_scope2_market' : 'a.co2e_scope2';
      const base = `FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id
                     LEFT JOIN org_node p ON p.id = f.parent_id WHERE a.facility_id = ANY($1) AND a.status <> 'rejected'`;
      const sums = `sum(a.co2e_direct * ${W})::float8 AS s1, sum(${S2} * ${W})::float8 AS s2, sum((a.co2e_wtt + a.co2e_td + a.co2e_scope3) * ${W})::float8 AS s3`;
      const yr = (y: number) => `AND extract(year FROM a.period_start) = ${Number(y)}`;
      const row = async (sql: string) => (await c.query(sql, [facs])).rows;
      const totals = (await row(`SELECT ${sums}, sum(a.co2_biogenic * ${W})::float8 AS biogenic, sum(a.co2e_memo * ${W})::float8 AS memo,
                                        sum(a.co2e_scope2 * ${W})::float8 AS s2_location, sum(a.co2e_scope2_market * ${W})::float8 AS s2_market,
                                        count(*)::int AS entries, count(*) FILTER (WHERE a.status = 'approved')::int AS approved,
                                        count(*) FILTER (WHERE a.data_type <> 'actual')::int AS estimated ${base} ${yr(year)}`))[0];
      const prev = (await row(`SELECT ${sums} ${base} ${yr(year - 1)}`))[0];
      const baseYear = t.base_year && t.base_year !== year ? (await row(`SELECT ${sums} ${base} ${yr(t.base_year)}`))[0] : null;
      const monthly = await row(`SELECT extract(month FROM a.period_start)::int AS m, ${sums} ${base} ${yr(year)} AND a.period_end - a.period_start < 40 GROUP BY 1 ORDER BY 1`);
      const annualOnly = (await row(`SELECT ${sums} ${base} ${yr(year)} AND a.period_end - a.period_start >= 40`))[0];
      const byCategory = await row(`SELECT cat.code, cat.name, cat.scope, cat.ghg_category, ${sums} ${base} ${yr(year)} GROUP BY 1, 2, 3, 4`);
      const byFacility = await row(`SELECT f.id, f.name, p.name AS parent, f.facility_type, ${sums} ${base} ${yr(year)} GROUP BY 1, 2, 3, 4`);
      const scope3 = await row(`SELECT 3 AS cat, sum((a.co2e_wtt + a.co2e_td) * ${W})::float8 AS co2e ${base} ${yr(year)}
                                UNION ALL SELECT cat.ghg_category, sum(a.co2e_scope3 * ${W})::float8 ${base} ${yr(year)} AND cat.ghg_category IS NOT NULL GROUP BY cat.ghg_category`);
      const s3 = new Map<number, number>();
      for (const r of scope3) s3.set(r.cat, (s3.get(r.cat) ?? 0) + (r.co2e ?? 0));
      const top = await row(`SELECT i.name AS item, cat.name AS category, cat.scope, sum((a.co2e_direct + ${S2} + a.co2e_wtt + a.co2e_td + a.co2e_scope3) * ${W})::float8 AS co2e
                               ${base} ${yr(year)} GROUP BY 1, 2, 3 ORDER BY 4 DESC NULLS LAST LIMIT 10`);
      const coverage = await row(`SELECT f.id, f.name, array_agg(DISTINCT extract(month FROM gs)::int) AS months
                                    ${base.replace('JOIN item i ON i.id = a.item_id', 'JOIN item i ON i.id = a.item_id CROSS JOIN LATERAL generate_series(a.period_start, a.period_end, interval \'1 month\') gs')}
                                    ${yr(year)} GROUP BY 1, 2`);
      const quality = (await c.query(
        `SELECT count(*) FILTER (WHERE l.method = 'supplier')::int AS supplier_lines, count(*) FILTER (WHERE l.method = 'spend')::int AS spend_lines,
                coalesce(sum(l.co2e) FILTER (WHERE l.method = 'supplier'), 0)::float8 AS supplier_co2e, coalesce(sum(l.co2e) FILTER (WHERE l.method = 'spend'), 0)::float8 AS spend_co2e
           FROM purchase_line l WHERE l.status = 'published' AND l.facility_id = ANY($1) AND extract(year FROM l.period_start) = $2`, [facs, year])).rows[0];
      const sum3 = (r: { s1: number | null; s2: number | null; s3: number | null } | undefined) => (r ? (r.s1 ?? 0) + (r.s2 ?? 0) + (r.s3 ?? 0) : 0);
      return {
        year, years, consolidation: t.consolidation, baseYearValue: t.base_year, scope2: q.scope2,
        totals: { ...totals, total: sum3(totals) }, previous: { year: year - 1, total: sum3(prev) }, baseYear: baseYear ? { year: t.base_year, total: sum3(baseYear) } : null,
        monthly, annualOnly: sum3(annualOnly),
        byCategory: byCategory.map((r) => ({ ...r, co2e: (r.s1 ?? 0) + (r.s2 ?? 0) + (r.s3 ?? 0) })).sort((a, b) => b.co2e - a.co2e),
        byFacility: byFacility.map((r) => ({ ...r, co2e: (r.s1 ?? 0) + (r.s2 ?? 0) + (r.s3 ?? 0) })).sort((a, b) => b.co2e - a.co2e),
        scope3: [...s3.entries()].filter(([, v]) => v).map(([k, v]) => ({ cat: k, name: GHG_CAT[k] ?? `Category ${k}`, co2e: v })).sort((a, b) => b.co2e - a.co2e),
        top, coverage, quality,
      };
    });
  });
}
