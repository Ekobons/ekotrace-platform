/**
 * Corrections to the capital-goods list of the previous Ekotrace product list.
 *
 * The old list marked whole industries as "Capital Goods", including parts, materials and
 * consumables. Under the GHG Protocol (Scope 3 category 2) capital goods are finished goods with
 * an extended life that the company keeps as fixed assets — machinery, vehicles, buildings,
 * IT equipment. Spare parts, raw and semi-finished materials, medicines and disposable supplies
 * are bought and used up: they stay in purchased goods (category 3.1) unless the company's
 * account says otherwise (an account of type "capital" still wins).
 *
 * Applied on import and by migration 014 for databases already loaded.
 */
export const NOT_CAPITAL: Record<string, string> = {
  // vehicle and aircraft parts: spare parts and components, not the vehicle
  336310: 'Parts', 336320: 'Parts', 336330: 'Parts', 336340: 'Parts', 336350: 'Parts', 336360: 'Parts', 336370: 'Parts', 336390: 'Parts',
  336412: 'Parts', 336413: 'Parts', 336415: 'Parts', 336419: 'Parts',
  // medicines, reagents and disposable medical supplies
  325411: 'Consumable', 325412: 'Consumable', 325413: 'Consumable', 325414: 'Consumable', 339113: 'Consumable', 339116: 'Consumable',
  // metals and metal products bought as material or components
  331110: 'Material', 331210: 'Material', 331221: 'Material', 331313: 'Material', 331318: 'Material', 331410: 'Material', 331420: 'Material',
  331491: 'Material', 331492: 'Material', 331511: 'Material', 331512: 'Material', 331513: 'Material', 331523: 'Material', 331524: 'Material', 331529: 'Material',
  332111: 'Material', 332112: 'Material', 332114: 'Material', 332117: 'Parts', 332721: 'Parts',
  332911: 'Parts', 332912: 'Parts', 332919: 'Parts', 332991: 'Parts', 332996: 'Parts', 332999: 'Material', 332994: 'Consumable',
  335921: 'Material',
  // tool accessories and machine components
  333515: 'Consumable', 333612: 'Parts', 333613: 'Parts', 333995: 'Parts', 333996: 'Parts',
};
/** Single products on a code that stays capital. */
export const NOT_CAPITAL_PRODUCTS: [RegExp, string][] = [[/keyboard|mouse/i, 'Accessory']];

export const WHY: Record<string, string> = {
  Parts: 'Spare parts and components: purchased goods, not capital goods',
  Material: 'Material or semi-finished product: purchased goods, not capital goods',
  Consumable: 'Used up in operations: purchased goods, not capital goods',
  Accessory: 'Low-value accessory, normally expensed: purchased goods',
};

/** Is a product of the old list a capital good, and why not when it is not. */
export function capitalOf(oldType: string, naics: string, product: string): { capital: boolean; note?: string } {
  if (!/capital/i.test(oldType)) return { capital: false };
  const k = NOT_CAPITAL[naics] ?? NOT_CAPITAL_PRODUCTS.find(([re]) => re.test(product))?.[1];
  return k ? { capital: false, note: WHY[k] } : { capital: true };
}
