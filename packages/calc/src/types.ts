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

export interface CalcResult {
  lines: ResultLine[];
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
