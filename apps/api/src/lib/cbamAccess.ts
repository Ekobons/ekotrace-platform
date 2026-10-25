/**
 * CBAM pages are open to companies with the CBAM Exporter package or the full EKOTRACE product.
 * Added as a hook inside the CBAM route plugins, so it only covers their routes.
 */
import type { FastifyInstance } from 'fastify';
import { tenantTx } from '../db/pool.js';
import { AppError } from './errors.js';

export const hasCbam = (products: string[] | null | undefined) => !products?.length || products.includes('cbam') || products.includes('ekotrace');

export function cbamOnly(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    const tenant = req.user?.tenantId;
    if (!tenant) return; // the route itself asks for a company
    const products = await tenantTx(tenant, async (c) => (await c.query(`SELECT products FROM tenant WHERE id = $1`, [tenant])).rows[0]?.products as string[] | undefined);
    if (!hasCbam(products)) throw new AppError('CBAM is not switched on for this company. Contact the Ekobon team to add the CBAM Exporter package.', 403, 'PRODUCT_OFF');
  });
}
