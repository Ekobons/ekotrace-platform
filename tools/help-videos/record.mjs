/** Records the help videos: node tools/help-videos/record.mjs [name…] (all when none given). See lib.mjs. */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { film } from './lib.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'scripts');
const want = process.argv.slice(2);
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
  const s = await import(pathToFileURL(join(dir, f)).href);
  if (want.length && !want.includes(s.name)) continue;
  const t = Date.now();
  const out = await film(s.name, s.title, s.subtitle, s.run, s.setup);
  console.log(`${s.name}: ${out} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
}
