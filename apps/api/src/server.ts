/** Starts the API server. */
import { config } from './config.js';
import { buildApp } from './app.js';
import { listenForRefdataChanges } from './modules/refdata.js';
import { pool } from './db/pool.js';
import { startWorker } from './lib/jobs.js';
import { autoSetup } from './db/setup.js';

// database up to date (migrations, factor files) before taking requests
await autoSetup((m) => console.log(m));
const app = await buildApp({ logger: true });
await listenForRefdataChanges((m) => app.log.info(m));
await app.listen({ port: config.port, host: config.host });
if (config.worker) await startWorker();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
}
