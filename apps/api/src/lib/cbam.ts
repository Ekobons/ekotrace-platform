/**
 * CBAM rules used by the tool (Regulation (EU) 2023/956 Annex I and II; Implementing Regulations (EU) 2025/2547,
 * 2025/2620 and 2025/2621). Kept in one place so a rule change is one edit.
 *
 *  - Aggregated goods categories with their production routes and qualifying parameters
 *  - CN codes covered (Annex I), matched by prefix, with the category they usually belong to
 *  - Specific embedded emissions of a process: (attributed emissions + precursors) ÷ activity level
 *  - Indirect emissions count only for cement and fertilisers (goods not in Annex II)
 *  - Importer side: default values with the mark-up, free allocation adjustment (CBAM benchmark × CBAM factor),
 *    certificates and their cost
 */
export type Sector = 'cement' | 'fertilisers' | 'iron_steel' | 'aluminium' | 'hydrogen' | 'electricity';
export const SECTORS: Record<Sector, string> = { cement: 'Cement', fertilisers: 'Fertilisers', iron_steel: 'Iron and steel', aluminium: 'Aluminium', hydrogen: 'Hydrogen', electricity: 'Electricity' };

export interface Category { sector: Sector; name: string; routes: string[]; params: { key: string; label: string; unit: string }[] }
export const CATEGORIES: Record<string, Category> = {
  calcined_clay: { sector: 'cement', name: 'Calcined clay', routes: [], params: [{ key: 'calcined', label: 'Clay calcined or not', unit: 'yes/no' }] },
  cement_clinker: { sector: 'cement', name: 'Cement clinker', routes: [], params: [] },
  cement: { sector: 'cement', name: 'Cement', routes: [], params: [{ key: 'clinker_ratio', label: 'Mass ratio of clinker in cement', unit: '%' }] },
  aluminous_cement: { sector: 'cement', name: 'Aluminous cement', routes: [], params: [] },
  hydrogen: { sector: 'hydrogen', name: 'Hydrogen', routes: ['Steam reforming and partial oxidation', 'Electrolysis of water', 'Chlor-alkali electrolysis and production of chlorates'], params: [] },
  ammonia: { sector: 'fertilisers', name: 'Ammonia', routes: ['Haber-Bosch with steam reforming', 'Haber-Bosch with gasification of coal or other fuels'], params: [{ key: 'concentration', label: 'Concentration if hydrous ammonia', unit: '%' }] },
  nitric_acid: { sector: 'fertilisers', name: 'Nitric acid', routes: [], params: [{ key: 'concentration', label: 'Concentration (mass %)', unit: '%' }] },
  urea: { sector: 'fertilisers', name: 'Urea', routes: [], params: [{ key: 'purity', label: 'Purity (urea content, % N contained)', unit: '%' }] },
  mixed_fertilisers: { sector: 'fertilisers', name: 'Mixed fertilisers', routes: [], params: [
    { key: 'n_total', label: 'Total N content (as nitrogen)', unit: '%' }, { key: 'n_nh4', label: 'N as ammonium (NH4+)', unit: '%' }, { key: 'n_no3', label: 'N as nitrate (NO3-)', unit: '%' },
    { key: 'n_urea', label: 'N as urea', unit: '%' }, { key: 'n_other', label: 'N in other forms', unit: '%' }] },
  sintered_ore: { sector: 'iron_steel', name: 'Sintered ore', routes: [], params: [] },
  pig_iron: { sector: 'iron_steel', name: 'Pig iron', routes: ['Blast furnace', 'Smelting reduction'], params: [{ key: 'main_element', label: 'Main reducing agent', unit: '' }, { key: 'mn', label: 'Mass % Mn', unit: '%' }, { key: 'cr', label: 'Mass % Cr', unit: '%' }, { key: 'ni', label: 'Mass % Ni', unit: '%' }, { key: 'other_alloy', label: 'Mass % other alloy elements', unit: '%' }] },
  fe_mn: { sector: 'iron_steel', name: 'Ferro-manganese (FeMn)', routes: [], params: [{ key: 'mn', label: 'Mass % Mn', unit: '%' }, { key: 'carbon', label: 'Mass % carbon', unit: '%' }] },
  fe_cr: { sector: 'iron_steel', name: 'Ferro-chromium (FeCr)', routes: [], params: [{ key: 'cr', label: 'Mass % Cr', unit: '%' }, { key: 'carbon', label: 'Mass % carbon', unit: '%' }] },
  fe_ni: { sector: 'iron_steel', name: 'Ferro-nickel (FeNi)', routes: [], params: [{ key: 'ni', label: 'Mass % Ni', unit: '%' }, { key: 'carbon', label: 'Mass % carbon', unit: '%' }] },
  dri: { sector: 'iron_steel', name: 'Direct reduced iron (DRI)', routes: ['Direct reduction'], params: [{ key: 'main_element', label: 'Main reducing agent', unit: '' }, { key: 'mn', label: 'Mass % Mn', unit: '%' }, { key: 'cr', label: 'Mass % Cr', unit: '%' }, { key: 'ni', label: 'Mass % Ni', unit: '%' }] },
  crude_steel: { sector: 'iron_steel', name: 'Crude steel', routes: ['Basic oxygen steelmaking', 'Electric arc furnace'], params: [{ key: 'reducing_agent', label: 'Main reducing agent of the precursor', unit: '' }, { key: 'alloys', label: 'Mass % alloy elements (> 1 % listed)', unit: '%' }, { key: 'scrap_t', label: 'Scrap used per tonne of crude steel', unit: 't/t' }, { key: 'pre_consumer_scrap', label: 'Pre-consumer scrap share', unit: '%' }] },
  iron_steel_products: { sector: 'iron_steel', name: 'Iron or steel products', routes: [], params: [{ key: 'reducing_agent', label: 'Main reducing agent of the precursor', unit: '' }, { key: 'alloys', label: 'Mass % alloy elements (> 1 % listed)', unit: '%' }, { key: 'scrap_t', label: 'Scrap used per tonne of product', unit: 't/t' }, { key: 'pre_consumer_scrap', label: 'Pre-consumer scrap share', unit: '%' }] },
  unwrought_aluminium: { sector: 'aluminium', name: 'Unwrought aluminium', routes: ['Primary (electrolytic) smelting', 'Secondary melting (recycling)'], params: [{ key: 'scrap_t', label: 'Scrap used per tonne of product', unit: 't/t' }, { key: 'pre_consumer_scrap', label: 'Pre-consumer scrap share', unit: '%' }, { key: 'alloys', label: 'Alloy content if > 1 % (mass %)', unit: '%' }] },
  aluminium_products: { sector: 'aluminium', name: 'Aluminium products', routes: [], params: [{ key: 'scrap_t', label: 'Scrap used per tonne of product', unit: 't/t' }, { key: 'pre_consumer_scrap', label: 'Pre-consumer scrap share', unit: '%' }, { key: 'alloys', label: 'Alloy content if > 1 % (mass %)', unit: '%' }] },
  electricity: { sector: 'electricity', name: 'Electricity', routes: [], params: [] },
};

/** Annex I CN codes (prefix → category usually concerned, description). Longest prefix wins. */
export const CN: [string, string, string][] = [
  ['25070080', 'calcined_clay', 'Other kaolinic clays'],
  ['25231000', 'cement_clinker', 'Cement clinkers'], ['25232100', 'cement', 'White Portland cement'], ['25232900', 'cement', 'Other Portland cement'],
  ['25233000', 'aluminous_cement', 'Aluminous cement'], ['25239000', 'cement', 'Other hydraulic cements'],
  ['27160000', 'electricity', 'Electrical energy'],
  ['28080000', 'nitric_acid', 'Nitric acid; sulphonitric acids'], ['2814', 'ammonia', 'Ammonia, anhydrous or in aqueous solution'],
  ['28342100', 'mixed_fertilisers', 'Nitrates of potassium'], ['310210', 'urea', 'Urea'], ['3102', 'mixed_fertilisers', 'Mineral or chemical fertilisers, nitrogenous'],
  ['3105', 'mixed_fertilisers', 'Mineral or chemical fertilisers containing nitrogen (not 3105 60 00)'],
  ['28041000', 'hydrogen', 'Hydrogen'],
  ['26011200', 'sintered_ore', 'Agglomerated iron ores and concentrates'],
  ['7201', 'pig_iron', 'Pig iron and spiegeleisen'], ['72021', 'fe_mn', 'Ferro-manganese'], ['72024', 'fe_cr', 'Ferro-chromium'], ['72026', 'fe_ni', 'Ferro-nickel'],
  ['7203', 'dri', 'Ferrous products from direct reduction of iron ore'], ['7205', 'pig_iron', 'Granules and powders of pig iron or steel'],
  ['7206', 'crude_steel', 'Iron and non-alloy steel in ingots or other primary forms'], ['7207', 'crude_steel', 'Semi-finished products of iron or non-alloy steel'],
  ['7218', 'crude_steel', 'Stainless steel in ingots or semi-finished'], ['7224', 'crude_steel', 'Other alloy steel in ingots or semi-finished'],
  ['72', 'iron_steel_products', 'Iron and steel products (flat-rolled, bars, rods, angles, wire…)'],
  ['7301', 'iron_steel_products', 'Sheet piling; welded angles, shapes and sections'], ['7302', 'iron_steel_products', 'Railway or tramway track construction material'],
  ['7303', 'iron_steel_products', 'Tubes, pipes and hollow profiles of cast iron'], ['7304', 'iron_steel_products', 'Tubes, pipes and hollow profiles, seamless'],
  ['7305', 'iron_steel_products', 'Other tubes and pipes, external diameter > 406.4 mm'], ['7306', 'iron_steel_products', 'Other tubes, pipes and hollow profiles'],
  ['7307', 'iron_steel_products', 'Tube or pipe fittings'], ['7308', 'iron_steel_products', 'Structures and parts of structures'],
  ['7309', 'iron_steel_products', 'Reservoirs, tanks, vats > 300 L'], ['7310', 'iron_steel_products', 'Tanks, casks, drums, cans, boxes ≤ 300 L'],
  ['7311', 'iron_steel_products', 'Containers for compressed or liquefied gas'], ['7318', 'iron_steel_products', 'Screws, bolts, nuts, washers and similar'],
  ['7326', 'iron_steel_products', 'Other articles of iron or steel'],
  ['7601', 'unwrought_aluminium', 'Unwrought aluminium'], ['7603', 'aluminium_products', 'Aluminium powders and flakes'],
  ['7604', 'aluminium_products', 'Aluminium bars, rods and profiles'], ['7605', 'aluminium_products', 'Aluminium wire'],
  ['7606', 'aluminium_products', 'Aluminium plates, sheets and strip > 0.2 mm'], ['7607', 'aluminium_products', 'Aluminium foil ≤ 0.2 mm'],
  ['7608', 'aluminium_products', 'Aluminium tubes and pipes'], ['7609', 'aluminium_products', 'Aluminium tube or pipe fittings'],
  ['7610', 'aluminium_products', 'Aluminium structures and parts'], ['7611', 'aluminium_products', 'Aluminium reservoirs, tanks, vats > 300 L'],
  ['7612', 'aluminium_products', 'Aluminium casks, drums, cans, boxes ≤ 300 L'], ['7613', 'aluminium_products', 'Aluminium containers for compressed gas'],
  ['7614', 'aluminium_products', 'Stranded wire, cables, plaited bands of aluminium'], ['7616', 'aluminium_products', 'Other articles of aluminium'],
];
const EXCLUDED = ['31056000'];   // 3105 60 00 is outside CBAM

/** The Annex I entry a CN code falls under, or null when the good is not covered. */
export function cnInfo(code: string): { prefix: string; category: string; description: string; sector: Sector } | null {
  const c = code.replace(/\D/g, '');
  if (c.length < 4 || EXCLUDED.some((x) => c.startsWith(x))) return null;
  // chapter 72 is covered from 7201 to 7229 only; ferro-alloys only FeMn, FeCr, FeNi
  if (c.startsWith('72') && (Number(c.slice(0, 4)) > 7229 || (c.startsWith('7202') && !/^7202[146]/.test(c)) || c.startsWith('7204'))) return null;
  let best: [string, string, string] | null = null;
  for (const e of CN) if (c.startsWith(e[0]) && (!best || e[0].length > best[0].length)) best = e;
  if (!best) return null;
  return { prefix: best[0], category: best[1], description: best[2], sector: CATEGORIES[best[1]]!.sector };
}

/** Indirect emissions are part of the embedded emissions only for goods not listed in Annex II (cement, fertilisers). */
export const countsIndirect = (sector: Sector) => sector === 'cement' || sector === 'fertilisers';

export interface LineIn { activity_t: number | null; direct_t: number | null; elec_mwh: number | null; default_share: number }
export interface PrecIn { quantity_t: number; see_direct: number; see_indirect: number; source: string }
export interface LineOut { seeDirect: number | null; seeIndirect: number | null; seeTotal: number | null; directTotal: number; indirectTotal: number; defaultShare: number; counted: boolean }

/** Specific embedded emissions of one process for the reporting year (tCO2e per tonne of output). */
export function lineSee(l: LineIn, precursors: PrecIn[], elecEf: number | null, sector: Sector): LineOut {
  const dirOwn = Number(l.direct_t ?? 0), ind = Number(l.elec_mwh ?? 0) * Number(elecEf ?? 0);
  const precDir = precursors.reduce((a, p) => a + Number(p.quantity_t) * Number(p.see_direct), 0);
  const precInd = precursors.reduce((a, p) => a + Number(p.quantity_t) * Number(p.see_indirect), 0);
  const precDefault = precursors.filter((p) => p.source === 'default').reduce((a, p) => a + Number(p.quantity_t) * (Number(p.see_direct) + (countsIndirect(sector) ? Number(p.see_indirect) : 0)), 0);
  const counted = countsIndirect(sector);
  const directTotal = dirOwn + precDir, indirectTotal = ind + precInd;
  const relevant = directTotal + (counted ? indirectTotal : 0);
  const al = Number(l.activity_t ?? 0);
  const seeDirect = al > 0 ? directTotal / al : null, seeIndirect = al > 0 ? indirectTotal / al : null;
  return {
    seeDirect, seeIndirect, seeTotal: seeDirect == null ? null : seeDirect + (counted ? seeIndirect ?? 0 : 0),
    directTotal, indirectTotal, counted,
    defaultShare: relevant > 0 ? (dirOwn * Number(l.default_share ?? 0) + precDefault) / relevant : 0,
  };
}

/** Mark-up on default values for the declaration year (IR (EU) 2025/2621): 10 % 2026, 20 % 2027, 30 % from 2028; 1 % for fertilisers. */
export function markup(year: number, sector: Sector) {
  if (sector === 'fertilisers') return 0.01;
  return year <= 2026 ? 0.1 : year === 2027 ? 0.2 : 0.3;
}
/** CBAM factor (share of free allocation still given in the EU ETS) for the year: Directive 2003/87/EC Article 10a(1a). */
export const CBAM_FACTOR: Record<number, number> = { 2026: 0.975, 2027: 0.95, 2028: 0.9, 2029: 0.775, 2030: 0.515, 2031: 0.39, 2032: 0.265, 2033: 0.14 };
export const cbamFactor = (year: number) => (year < 2026 ? 1 : CBAM_FACTOR[year] ?? 0);
/** Cross-sectoral correction factor applied with the benchmark (100 % for the definitive period unless changed). */
export const CSCF = 1;

export interface ImportIn { year: number; quarter: number; mass: number; sector: Sector; source: string; see_direct: number | null; see_indirect: number | null; default_value: number | null; benchmark: number | null; carbon_price_eur: number | null }
export interface ImportOut { see: number | null; markup: number; embedded: number | null; sefa: number; faa: number; priceDeduct: number; certificates: number | null; price: number | null; cost: number | null; problems: string[] }

/** Embedded emissions, free allocation adjustment and certificates for one import line. */
export function importCalc(x: ImportIn, price: number | null): ImportOut {
  const problems: string[] = [];
  let see: number | null = null, mk = 0;
  if (x.source === 'actual') {
    if (x.see_direct == null) problems.push('Actual emissions missing: enter the installation’s specific embedded emissions or use the default value');
    else see = Number(x.see_direct) + (countsIndirect(x.sector) ? Number(x.see_indirect ?? 0) : 0);
  } else if (x.default_value == null) problems.push('Default value missing for this CN code and country');
  else { mk = markup(x.year, x.sector); see = Number(x.default_value) * (1 + mk); }
  const sefa = x.benchmark != null ? Number(x.benchmark) * cbamFactor(x.year) * CSCF : 0;
  if (x.benchmark == null && x.sector !== 'electricity') problems.push('CBAM benchmark missing: no free allocation adjustment applied');
  const embedded = see == null ? null : see * x.mass;
  const priceDeduct = x.carbon_price_eur && price ? Number(x.carbon_price_eur) / price : 0;   // tCO2e per tonne of good
  const net = see == null ? null : Math.max(0, see - sefa - priceDeduct);
  const certificates = net == null ? null : net * x.mass;
  return { see, markup: mk, embedded, sefa, faa: sefa * x.mass, priceDeduct, certificates, price, cost: certificates != null && price != null ? certificates * price : null, problems };
}

export const quarterOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
