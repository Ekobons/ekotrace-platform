/**
 * The brand of this deployment (BRAND setting → brands/<name>/brand.json): the product name shown to people,
 * in e-mails, file names and exports. Carbontek by default; Ekotrace and others are brand packs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

export const BRANDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../brands');
export const brandPack = (() => {
  const f = join(BRANDS_DIR, config.brand, 'brand.json');
  try { return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { name: string; productName?: string; [k: string]: unknown }) : null; } catch { return null; }
})();
/** "Carbontek" (or the brand pack's product name). */
export const PRODUCT: string = brandPack?.productName ?? brandPack?.name ?? 'Carbontek';
/** For file names: "carbontek". */
export const PRODUCT_SLUG = PRODUCT.toLowerCase().replace(/[^a-z0-9]+/g, '-');
