/**
 * Shared types for the calculation engine.
 *
 * Vocabulary
 *   gas        a greenhouse gas by code: CO2, CH4, CH4_fossil, N2O, HFC-134a, SF6, …
 *   GWP set    a table of global warming potentials (AR4, AR5, AR6).
 *              kg CO2e = kg of gas × GWP of that gas in the chosen set.
 *   basis      which part of the inventory a number belongs to:
 *                direct          Scope 1 (or the scope of the category)
 *                wtt             well-to-tank, upstream of fuels → Scope 3 category 3
 *                outside_scopes  biogenic CO2 from burning bioenergy (reported, never added)
 *                memo            non-Kyoto gases (e.g. HCFC-22): reported separately
 */

export type Basis = 'direct' | 'wtt' | 'outside_scopes' | 'memo';

/** A unit of measure. `toBase` = how many base units one of this unit equals. */
export interface Unit {
  code: string;
  name: string;
  /** mass | volume | energy_net | energy_gross | distance | count | currency | … */
  dimension: string;
  toBase: number;
}

export interface Gas {
  code: string;
  name: string;
  /** true for the Kyoto basket (CO2, CH4, N2O, HFCs, PFCs, SF6, NF3) */
  kyoto: boolean;
}

/** GWP values of one set, keyed by gas code. */
export interface GwpTable {
  set: string; // 'AR4' | 'AR5' | 'AR6'
  values: Record<string, number>;
}

/** One gas inside a factor: kilograms of that gas emitted per unit of activity. */
export interface FactorGas {
  gas: string;
  kgPerUnit: number;
}

/**
 * A stored emission factor for one item, one unit, one basis, one period.
 * `co2ePerUnit` is the value as published (in the GWP set the source used);
 * `gases` holds the split into individual gases when the source provides it.
 */
export interface Factor {
  id: number;
  itemId: number;
  basis: Basis;
  unit: string;
  co2ePerUnit: number | null;
  sourceGwpSet: string | null;
  gases: FactorGas[];
  source: string; // e.g. 'DESNZ 2026'
  validFrom: string; // ISO date
  validTo: string;
  region: string; // ISO country code or 'GLOBAL'
}

/** One line of a calculation result. */
export interface ResultLine {
  basis: Basis;
  gas: string; // gas code, or 'CO2e' when only a total is known
  kgGas: number | null;
  kgCo2e: number;
  factorId: number | null;
  /** 'gas' = mass × GWP of the chosen set; 'published' = source's CO2e total used as is */
  method: 'gas' | 'published';
}

/**
 * The CO2e emission factor behind one part of the result, so a user can
 * cross-check: quantity × perEnteredUnit = total. For gas-split factors it is
 * the sum of kg gas × GWP of the company's set; otherwise the published total.
 */
export interface FactorUsed {
  basis: Basis;
  factorId: number | null;
  /** e.g. "DESNZ 2026" or "GWP AR5" (fugitive gas with known composition) */
  source: string;
  validFrom: string | null;
  /** kg CO2e (kg CO2 for outside_scopes) per unit of the factor */
  co2ePerUnit: number;
  unit: string;
  unitName: string;
  /** the same factor per unit the user entered */
  perEnteredUnit: number;
  enteredUnit: string;
  enteredUnitName: string;
  /** quantity in the entered unit that the factor applies to */
  quantity: number;
  method: 'gas' | 'published';
  /** the source's own CO2e per unit and its GWP set, when they differ from the value used */
  published?: { co2ePerUnit: number; gwpSet: string };
}

/**
 * A calorific value supplied by the user (e.g. from the fuel supplier's
 * certificate): energy per unit of mass or volume, net or gross by the energy
 * unit chosen. Converts the entered quantity into the dimension of the factor.
 */
export interface CalorificValue {
  value: number;
  /** energy unit: MJ, GJ, kWh (net) or MJ_gcv, GJ_gcv, kWh_gcv, MMBtu… (gross) */
  energyUnit: string;
  /** mass or volume unit: kg, t, L, m3… */
  perUnit: string;
}

/** What the calorific value did, for display and audit. */
export interface CalorificValueUsed extends CalorificValue {
  energyUnitName: string;
  perUnitName: string;
  basis: 'net' | 'gross';
  /** the quantity the factors were applied to, and its unit */
  convertedQuantity: number;
  convertedUnit: string;
  convertedUnitName: string;
}

export interface CalcResult {
  /** present when the user supplied a calorific value */
  cv?: CalorificValueUsed;
  lines: ResultLine[];
  /** CO2e factor per part of the result (one per basis) */
  factors: FactorUsed[];
  /** kg CO2e per basis (memo and outside_scopes are never part of the inventory total) */
  totals: Record<Basis, number>;
  /** plain-language calculation steps, stored with every entry for audit */
  steps: string[];
  warnings: string[];
}

export class CalcError extends Error {
  constructor(message: string, public code = 'CALC_ERROR') {
    super(message);
  }
}
