/**
 * Gases and global warming potentials.
 *
 * Methane has two GWP entries in AR6 (fossil 29.8, non-fossil 27.0). Fuel
 * combustion factors store fossil-fuel methane as `CH4_fossil` so a client on
 * AR6 gets the fossil value automatically. For AR4/AR5 both codes carry the
 * single value used in national inventories and by DESNZ (25 / 28).
 */
import { CalcError, type GwpTable } from './types.js';

export function gwpOf(table: GwpTable, gas: string): number {
  if (gas === 'CO2' || gas === 'CO2_biogenic') return 1;
  const v = table.values[gas];
  if (v === undefined) throw new CalcError(`No ${table.set} GWP for gas "${gas}"`, 'NO_GWP');
  return v;
}

/** Same as gwpOf but returns undefined instead of throwing. */
export function tryGwp(table: GwpTable, gas: string): number | undefined {
  if (gas === 'CO2' || gas === 'CO2_biogenic') return 1;
  return table.values[gas];
}

/** Sum of mass fraction × GWP: the GWP of a blend such as R-410A. */
export function blendGwp(table: GwpTable, composition: { gas: string; fraction: number }[]): number {
  return composition.reduce((s, c) => s + c.fraction * gwpOf(table, c.gas), 0);
}
