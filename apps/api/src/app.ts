/**
 * Builds the API application (used by server.ts and by the tests).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
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
import { authRoutes } from './modules/auth.routes.js';
import { orgRoutes } from './modules/org.routes.js';
import { peopleRoutes } from './modules/people.routes.js';
import { platformRoutes } from './modules/platform.routes.js';
import { vehicleRoutes, vehicleUploadRoutes } from './modules/vehicles.routes.js';
import { priceRoutes } from './modules/prices.routes.js';
import { energyRoutes } from './modules/energy.routes.js';
import { wasteRoutes } from './modules/waste.routes.js';
import { meterIngestRoutes, meterRoutes } from './modules/meters.routes.js';
import { billRoutes } from './modules/bills.routes.js';
import { purchaseIngestRoutes, purchaseRoutes } from './modules/purchases/purchases.routes.js';
import { supplierRoutes } from './modules/purchases/suppliers.routes.js';
import { publishedLineRoutes } from './modules/purchases/publishedLines.routes.js';
import { dashboardRoutes } from './modules/dashboard.routes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRANDS = join(HERE, '../../../brands');
const WEB = join(HERE, '../../web/dist');

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 });
  app.setErrorHandler(errorHandler);
  // Raw uploads (DESNZ .xlsx files) arrive as application/octet-stream.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // Security headers on every response (BEEAH web application security standard 4.9).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (config.https) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });

  app.get('/api/health', async () => ({ ok: true }));

  /** Brand pack of this deployment (name, colours, logo): Ekotrace, Carbontek… */
  app.get('/api/brand', async () => {
    const f = join(BRANDS, config.brand, 'brand.json');
    if (!existsSync(f)) return { name: 'Ekotrace' };
    return JSON.parse(readFileSync(f, 'utf8'));
  });

  // Login / logout (open), then everything else behind a valid session.
  await app.register(authRoutes);
  // Machine API for systems that send meter readings: API key, no session.
  await app.register(meterIngestRoutes);
  await app.register(purchaseIngestRoutes);
  await app.register(async (secured) => {
    secured.addHook('onRequest', authenticate);
    await secured.register(orgRoutes);
    await secured.register(peopleRoutes);
    await secured.register(platformRoutes);
    await secured.register(catalogueRoutes);
    await secured.register(referenceRoutes);
    await secured.register(factorRoutes);
    await secured.register(activityRoutes);
    await secured.register(vehicleRoutes);
    await secured.register(vehicleUploadRoutes);
    await secured.register(priceRoutes);
    await secured.register(energyRoutes);
    await secured.register(wasteRoutes);
    await secured.register(meterRoutes);
    await secured.register(billRoutes);
    await secured.register(purchaseRoutes);
    await secured.register(supplierRoutes);
    await secured.register(publishedLineRoutes);
    await secured.register(dashboardRoutes);
  });

  // The screens (apps/web, after `npm run build`) are served from the same
  // address, so one process and one URL is all a deployment needs.
  if (existsSync(join(WEB, 'index.html'))) {
    await app.register(fastifyStatic, { root: WEB }); // files looked up per request, so a rebuild needs no restart
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Not found' });
      return reply.sendFile('index.html'); // client-side routes
    });
  }
  return app;
}
