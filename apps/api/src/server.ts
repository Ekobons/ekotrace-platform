/** Starts the API server. */
import { config } from './config.js';
import { buildApp } from './app.js';
import { listenForRefdataChanges } from './modules/refdata.js';
import { pool } from './db/pool.js';

const app = await buildApp({ logger: true });
await listenForRefdataChanges((m) => app.log.info(m));
// Without login, only this computer may connect; on a server (DEV_AUTH=false) listen on all interfaces.
await app.listen({ port: config.port, host: config.devAuth ? '127.0.0.1' : '0.0.0.0' });
if (config.devAuth) app.log.warn('DEV_AUTH is on: no login required. Never use this setting on a server.');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
