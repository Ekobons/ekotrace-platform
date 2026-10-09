/**
 * Builds the API application (used by server.ts and by the tests).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { authenticate } from './lib/auth.js';
import { errorHandler } from './lib/errors.js';
import { catalogueRoutes } from './modules/catalogue.routes.js';
import { referenceRoutes } from './modules/reference.routes.js';
import { factorRoutes } from './modules/factors.routes.js';
import { activityRoutes } from './modules/activity.routes.js';

const BRANDS = join(dirname(fileURLToPath(import.meta.url)), '../../../brands');

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  app.setErrorHandler(errorHandler);
  // Raw uploads (DESNZ .xlsx files) arrive as application/octet-stream.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  app.get('/api/health', async () => ({ ok: true }));

  /** Brand pack of this deployment (name, colours, logo): Ekotrace, Carbontek… */
  app.get('/api/brand', async () => {
    const f = join(BRANDS, config.brand, 'brand.json');
    if (!existsSync(f)) return { name: 'Ekotrace' };
    return JSON.parse(readFileSync(f, 'utf8'));
  });

  await app.register(async (secured) => {
    secured.addHook('onRequest', authenticate);
    await secured.register(catalogueRoutes);
    await secured.register(referenceRoutes);
    await secured.register(factorRoutes);
    await secured.register(activityRoutes);
  });
  return app;
}
