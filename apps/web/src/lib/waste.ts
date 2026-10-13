/** Waste sent out (Scope 3.5): materials from the catalogue and the disposal methods (GRI 306) each has a factor for. */
import type { Category } from './api';

/**
 * Disposal method as GRI 306 reports it; each uses the DESNZ factor of a route ("via"). Re-use has no DESNZ factor
 * (the recycling one is used); incineration with or without energy recovery share the combustion factor.
 */
export const OPS: { key: string; name: string; via: string[]; gri: string; group: 'Diverted from disposal' | 'Disposal' }[] = [
  { key: 'reuse', name: 'Preparation for re-use', via: ['closed_loop', 'open_loop'], gri: 'reuse', group: 'Diverted from disposal' },
  { key: 'closed_loop', name: 'Recycling · closed-loop', via: ['closed_loop'], gri: 'recycling', group: 'Diverted from disposal' },
  { key: 'open_loop', name: 'Recycling · open-loop', via: ['open_loop'], gri: 'recycling', group: 'Diverted from disposal' },
  { key: 'composting', name: 'Composting', via: ['composting'], gri: 'composting', group: 'Diverted from disposal' },
  { key: 'ad', name: 'Anaerobic digestion', via: ['ad'], gri: 'ad', group: 'Diverted from disposal' },
  { key: 'incin_er', name: 'Incineration with energy recovery (WtE)', via: ['combustion'], gri: 'incin_er', group: 'Disposal' },
  { key: 'incin_noer', name: 'Incineration without energy recovery', via: ['combustion'], gri: 'incin_noer', group: 'Disposal' },
  { key: 'landfill', name: 'Landfill', via: ['landfill'], gri: 'landfill', group: 'Disposal' },
  { key: 'treatment', name: 'Other disposal (treatment)', via: ['treatment'], gri: 'other', group: 'Disposal' },
];
export const ROUTE: Record<string, string> = Object.fromEntries(OPS.map((o) => [o.key, o.name]));
export type Mat = { group: string; name: string; routes: Map<string, number>; haz: boolean; proxy: boolean };
/** The disposal methods a material has a factor for, and the item each uses. */
export const opsOf = (m?: Mat) => (m ? OPS.flatMap((o) => { const v = o.via.find((x) => m.routes.has(x)); return v ? [{ ...o, item: m.routes.get(v)! }] : []; }) : []);
export const firstOp = (m?: Mat) => { const os = opsOf(m); return (os.find((o) => o.key === 'landfill') ?? os[0])?.key ?? 'landfill'; };
/** Materials (grouped by subcategory) with the item of each DESNZ route, the usual hazardous class and whether a proxy is used. */
export function materialsOf(cat: Category) {
  const m = new Map<string, Mat>();
  for (const s of cat.subcategories) for (const i of s.items) {
    const a = (i.attrs ?? {}) as { material?: string; route?: string; hazardous?: boolean; proxy?: string };
    if (!a.material || !a.route) continue;
    const key = `${s.code}|${a.material}`;
    const e = m.get(key) ?? { group: s.name, name: a.material, routes: new Map(), haz: !!a.hazardous, proxy: !!a.proxy };
    e.routes.set(a.route, i.id);
    m.set(key, e);
  }
  return m;
}
/** The GRI 306 operation stored with an entry or a bin, from the method chosen. */
export const griOf = (key: string) => OPS.find((o) => o.key === key)?.gri;
/** The method shown for an item and an optional GRI override. */
export const methodName = (route: string | null, gri: string | null) =>
  (gri === 'reuse' ? 'Preparation for re-use' : gri === 'incin_noer' ? 'Incineration without energy recovery' : gri === 'other' ? 'Other disposal (treatment)'
    : route === 'combustion' ? 'Incineration with energy recovery (WtE)' : (route && ROUTE[route]) || route || '');
