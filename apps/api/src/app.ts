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
import { rateLimiter, type Limits } from './lib/ratelimit.js';
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
import { groupRoutes } from './modules/groups.routes.js';
import { dashboardRoutes } from './modules/dashboard.routes.js';
import { commuteRoutes } from './modules/commute.routes.js';
import { surveyPublicRoutes, surveyRoutes } from './modules/survey.routes.js';
import { reviewRoutes } from './modules/review.routes.js';
import { tripRoutes } from './modules/trip.routes.js';
import { homeRoutes } from './modules/home.routes.js';
import { targetsRoutes } from './modules/targets.routes.js';
import { approvalsRoutes } from './modules/approvals.routes.js';
import { qrRoutes } from './modules/qr.routes.js';
import { vaultRoutes } from './modules/vault.routes.js';
import { messageRoutes } from './modules/messages.routes.js';
import { securityRoutes, auditApiRoutes } from './modules/security.routes.js';
import { scimRoutes } from './modules/scim.routes.js';
import { assuranceRoutes } from './modules/assurance.routes.js';
import { contractorPublicRoutes, contractorRoutes } from './modules/contractor.routes.js';
import { reportsRoutes } from './modules/reports.routes.js';
import { collectionRoutes } from './modules/collection.routes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRANDS = join(HERE, '../../../brands');
const WEB = join(HERE, '../../web/dist');

export async function buildApp(opts: { logger?: boolean; rateLimit?: Limits | null } = {}): Promise<FastifyInstance> {
  // behind a load balancer / WAF (TRUST_PROXY), the client address and https come from X-Forwarded-* headers
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024, trustProxy: config.trustProxy as boolean });
  app.setErrorHandler(errorHandler);
  // Raw uploads (DESNZ .xlsx files) arrive as application/octet-stream.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // Security headers on every response (BEEAH web application security standard 4.9).
  // A route may set a stricter policy (stored files: sandboxed); it is kept.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    // cross-origin isolation: other sites cannot open, embed or read Ekotrace's pages and files
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cross-Origin-Embedder-Policy', 'require-corp');
    reply.header('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()');
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' blob:; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (config.https) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });
  // Rate limits on every API request (per session, per address, tighter on sign-in).
  const limits = opts.rateLimit === undefined ? config.rateLimit : opts.rateLimit;
  if (limits) app.addHook('onRequest', rateLimiter(limits));

  /** Responsible disclosure (RFC 9116). */
  app.get('/.well-known/security.txt', async (_req, reply) => {
    if (!config.securityContact) return reply.code(404).send('');
    const exp = new Date(Date.now() + 365 * 86400e3).toISOString();
    return reply.type('text/plain').send(`Contact: ${config.securityContact}\nExpires: ${exp}\nPreferred-Languages: en, ar\nPolicy: Report security issues privately to the contact above. We acknowledge within 2 working days and do not take action against good-faith research.\n`);
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
  // Employees answering a survey with their personal code: no session.
  await app.register(surveyPublicRoutes);
  await app.register(contractorPublicRoutes);
  await app.register(auditApiRoutes);
  await app.register(scimRoutes);
  await app.register(async (secured) => {
    secured.addHook('onRequest', authenticate);
    await secured.register(reviewRoutes);
    await secured.register(tripRoutes);
    await secured.register(homeRoutes);
    await secured.register(targetsRoutes);
    await secured.register(approvalsRoutes);
    await secured.register(reportsRoutes);
    await secured.register(collectionRoutes);
    await secured.register(qrRoutes);
    await secured.register(contractorRoutes);
    await secured.register(assuranceRoutes);
    await secured.register(vaultRoutes);
    await secured.register(messageRoutes);
    await secured.register(securityRoutes);
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
    await secured.register(groupRoutes);
    await secured.register(dashboardRoutes);
    await secured.register(commuteRoutes);
    await secured.register(surveyRoutes);
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
