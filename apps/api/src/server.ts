/** Starts the API server. */
import { config } from './config.js';
import { buildApp } from './app.js';
import { listenForRefdataChanges } from './modules/refdata.js';
import { pool } from './db/pool.js';

const app = await buildApp({ logger: true });
await listenForRefdataChanges((m) => app.log.info(m));
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
