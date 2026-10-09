/**
 * Unit conversion within one dimension.
 *
 * Every unit has a size relative to its dimension's base unit (kg, L, kWh…),
 * so any two units of the same dimension convert with one multiply and one
 * divide — no pair-by-pair table to maintain. The matrix the admin edits is
 * just this `toBase` column.
 *
 * Net and gross energy are deliberately DIFFERENT dimensions: 1 kWh (net CV)
 * of diesel is not 1 kWh (gross CV) of diesel; the ratio depends on the fuel,
 * so it can never be a fixed unit conversion.
 */
import { CalcError, type Unit } from './types.js';

export type UnitRegistry = Map<string, Unit>;

export function unitRegistry(units: Unit[]): UnitRegistry {
  return new Map(units.map((u) => [u.code, u]));
}

export function getUnit(reg: UnitRegistry, code: string): Unit {
  const u = reg.get(code);
  if (!u) throw new CalcError(`Unknown unit "${code}"`, 'UNKNOWN_UNIT');
  return u;
}

/** Convert `qty` from one unit to another of the same dimension. */
export function convert(reg: UnitRegistry, qty: number, from: string, to: string): number {
  if (from === to) return qty;
  const a = getUnit(reg, from);
  const b = getUnit(reg, to);
  if (a.dimension !== b.dimension) {
    throw new CalcError(`Cannot convert ${a.name} (${a.dimension}) to ${b.name} (${b.dimension})`, 'DIMENSION_MISMATCH');
  }
  return (qty * a.toBase) / b.toBase;
}
