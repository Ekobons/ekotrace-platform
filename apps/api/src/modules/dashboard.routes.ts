/**
 * Dashboards: the year's inventory as compact rows — facility × month × category × item with
 * Scope 1, Scope 2 (location or market), Scope 3 and 3.3 (well-to-tank, grid losses) — plus
 * last year by month, the facilities (employees, floor area for intensities) and the
 * purchases detail (product groups, suppliers, data quality). The screen builds every view
 * (overview, scopes & categories, facilities, value chain, mobility) from these rows.
 *
 * Totals follow the company's consolidation approach (Methodology & boundaries):
 * operational or financial control (facility in or out) or equity share (× ownership %).
 * Scope 2 is location- or market-based, never both. Biogenic CO2 and non-Kyoto gases are
 * returned separately, outside the totals. Rejected entries are left out.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantTx } from '../db/pool.js';
import { requireTenant } from '../lib/auth.js';
import { scopeOf, subtreeFacilities } from '../lib/access.js';

/** GHG Protocol code of each category (Scope 1 and 2 numbered within the scope). */
const CODE: Record<string, string> = {
  stationary_combustion: '1.1', mobile_combustion: '1.2', waste_treatment: '1.3', fugitive: '1.4', purchased_electricity: '2.1',
};
const S3_NAME: Record<number, string> = {
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
      const years = (await c.query(`SELECT DISTINCT extract(year FROM period_start)::int AS y FROM activity WHERE facility_id = ANY($1) AND status <> 'rejected' ORDER BY 1 DESC`, [facs])).rows.map((r) => r.y as number);
      const year = q.year ?? years[0] ?? new Date().getFullYear();
      const W = t.consolidation === 'equity' ? 'f.ownership_pct / 100.0' : t.consolidation === 'financial' ? 'CASE WHEN f.financial_control THEN 1 ELSE 0 END' : 'CASE WHEN f.operational_control THEN 1 ELSE 0 END';
      const S2 = q.scope2 === 'market' ? 'a.co2e_scope2_market' : 'a.co2e_scope2';
      // month 0 = an entry for a longer period (a quarter, the year): in the totals, not in the months
      const M = `CASE WHEN a.period_end - a.period_start < 40 THEN extract(month FROM a.period_start)::int ELSE 0 END`;
      const FROM = `FROM activity a JOIN org_node f ON f.id = a.facility_id JOIN category cat ON cat.id = a.category_id JOIN item i ON i.id = a.item_id
                    WHERE a.facility_id = ANY($1) AND a.status <> 'rejected' AND extract(year FROM a.period_start) = $2`;
      const t1 = (v: string) => `round(sum(${v} * ${W})::numeric / 1000, 4)::float8`;   // tonnes
      const rows = (await c.query(
        `SELECT a.facility_id AS f, ${M} AS m, cat.code AS cat, i.name AS item, coalesce(i.attrs->>'group', '') AS grp,
                ${t1('a.co2e_direct')} AS s1, ${t1(S2)} AS s2, ${t1('a.co2e_scope3')} AS s3, ${t1('(a.co2e_wtt + a.co2e_td)')} AS s33,
                ${t1('a.co2_biogenic')} AS bio, ${t1('a.co2e_memo')} AS memo, count(*)::int AS n, count(*) FILTER (WHERE a.status = 'approved')::int AS approved,
                count(*) FILTER (WHERE a.data_type <> 'actual')::int AS estimated
           ${FROM} GROUP BY 1, 2, 3, 4, 5`, [facs, year])).rows;
      const prevMonthly = (await c.query(
        `SELECT ${M} AS m, ${t1('a.co2e_direct')} AS s1, ${t1(S2)} AS s2, ${t1('a.co2e_scope3 + a.co2e_wtt + a.co2e_td')} AS s3 ${FROM} GROUP BY 1`, [facs, year - 1])).rows;
      const base = t.base_year && t.base_year !== year
        ? (await c.query(`SELECT ${t1(`a.co2e_direct + ${S2} + a.co2e_scope3 + a.co2e_wtt + a.co2e_td`)} AS total ${FROM}`, [facs, t.base_year])).rows[0]?.total ?? null : null;
      const facilities = (await c.query(
        `SELECT f.id, f.name, p.name AS parent, f.facility_type AS type, f.employees, f.floor_area_m2::float8 AS area, ${W}::float8 AS weight
           FROM org_node f LEFT JOIN org_node p ON p.id = f.parent_id WHERE f.id = ANY($1) AND f.kind = 'facility' ORDER BY f.name`, [facs])).rows;
      const categories = (await c.query(`SELECT code, name, scope, ghg_category FROM category ORDER BY scope, sort`)).rows
        .map((r) => ({ ...r, ghg: r.scope === 3 ? `3.${r.ghg_category}` : CODE[r.code] ?? `${r.scope}.0` }));
      // purchases behind the published entries: product groups, suppliers, supplier-specific share
      const P = `FROM purchase_line l JOIN activity a ON a.id = l.activity_id JOIN org_node f ON f.id = a.facility_id
                 WHERE l.status = 'published' AND a.facility_id = ANY($1) AND a.status <> 'rejected' AND extract(year FROM a.period_start) = $2`;
      const tl = `round(sum(l.co2e * ${W})::numeric / 1000, 4)::float8`;
      const purchases = {
        byGroup: (await c.query(`SELECT coalesce(nullif(split_part(i.attrs->>'group', ' › ', 1), ''), sc.name, 'Other') AS name, ${tl} AS t
                                   ${P.replace('JOIN org_node f', 'JOIN item i ON i.id = l.item_id JOIN subcategory sc ON sc.id = i.subcategory_id JOIN org_node f')} GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 40`, [facs, year])).rows,
        bySupplier: (await c.query(`SELECT coalesce(s.name, 'No supplier') AS name, ${tl} AS t ${P.replace('JOIN org_node f', 'LEFT JOIN supplier s ON s.id = l.supplier_id JOIN org_node f')}
                                      GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 10`, [facs, year])).rows,
        byMethod: (await c.query(`SELECT l.method, ${tl} AS t, count(*)::int AS lines ${P} GROUP BY 1`, [facs, year])).rows,
        suppliers: Number((await c.query(`SELECT count(DISTINCT l.supplier_id) AS n ${P}`, [facs, year])).rows[0].n),
        withTarget: Number((await c.query(`SELECT count(DISTINCT s.id) AS n ${P.replace('JOIN org_node f', 'JOIN supplier s ON s.id = l.supplier_id JOIN org_node f')} AND s.climate_target IN ('sbti_validated','sbti_committed')`, [facs, year])).rows[0].n),
      };
      return {
        year, years, consolidation: t.consolidation, scope2: q.scope2, baseYear: t.base_year && t.base_year !== year ? { year: t.base_year, total: base } : null,
        rows, prevMonthly, facilities, categories, s3Names: S3_NAME, purchases,
      };
    });
  });
}
