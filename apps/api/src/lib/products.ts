/**
 * The packages a company has (tenant.products), chosen one by one in the platform console:
 *   ekotrace  own GHG inventory (the full tool)          ekofin  financed emissions
 *   cbam      CBAM Exporter (CBAM only)                  ccts    India CCTS / GEI tracker
 *   brsr      SEBI BRSR Core                             uaemrv  UAE MRV (Abu Dhabi facility MRV, federal reporting)
 *   energy    Energy management & savings (baselines, M&V, measures, ISO 50001 energy review)
 *   compliance  Compliance Position Desk (which regulations apply, obligations, deadlines, status)
 * India CCTS, BRSR Core, UAE MRV and Energy management are packages of their own: they are not part of EKOTRACE. With EKOTRACE they read its
 * approved entries; alone, their environmental figures are typed.
 */
import type { FastifyInstance } from 'fastify';
import { tenantTx, type Tx } from '../db/pool.js';
import { AppError } from './errors.js';

export const PRODUCTS = ['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr', 'uaemrv', 'energy', 'compliance'] as const;
export type ProductCode = (typeof PRODUCTS)[number];
const NAMES: Record<ProductCode, string> = { ekotrace: 'EKOTRACE', ekofin: 'EKOFIN', cbam: 'CBAM Exporter', ccts: 'India CCTS', brsr: 'BRSR Core', uaemrv: 'UAE MRV', energy: 'Energy management', compliance: 'Compliance desk' };

export async function productsOf(c: Tx, tenant: string): Promise<string[]> {
  return ((await c.query(`SELECT products FROM tenant WHERE id = $1`, [tenant])).rows[0]?.products as string[] | undefined) ?? [];
}
/** Whether the company has EKOTRACE, i.e. entries to read figures from. */
export const hasEkotrace = async (c: Tx, tenant: string) => (await productsOf(c, tenant)).includes('ekotrace');

/** A hook on a route plugin: its routes answer 403 unless the company has the package. */
export function needProduct(app: FastifyInstance, code: ProductCode) {
  app.addHook('preHandler', async (req) => {
    const tenant = req.user?.tenantId;
    if (!tenant) return; // the route itself asks for a company
    const p = await tenantTx(tenant, (c) => productsOf(c, tenant));
    if (!p.includes(code)) throw new AppError(`${NAMES[code]} is not switched on for this company. Contact the Ekobon team to add the ${NAMES[code]} package.`, 403, 'PRODUCT_OFF');
  });
}
