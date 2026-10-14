/**
 * The product name of this deployment (brand pack: Carbontek by default), read once before the app starts.
 * Use PRODUCT wherever the product is named on screen, in files and in printed pages.
 */
export const BRAND = { name: 'Carbontek', tagline: 'Carbon accounting' };
export const productSlug = () => BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export async function loadBrand(): Promise<void> {
  try {
    const r = await fetch('/api/brand', { credentials: 'same-origin' });
    if (!r.ok) return;
    const b = (await r.json()) as { name?: string; productName?: string; tagline?: string; colors?: Record<string, string> };
    BRAND.name = b.productName ?? b.name ?? BRAND.name;
    if (b.tagline) BRAND.tagline = b.tagline;
    document.title = BRAND.name;
  } catch { /* keep the default */ }
}
