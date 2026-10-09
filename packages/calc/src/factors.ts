/**
 * Choosing the right factor for an activity.
 *
 * Rules (in order):
 *  1. Region: a factor for the facility's country wins over a GLOBAL one.
 *  2. Period: the factor valid on the activity date. Activity in calendar
 *     year Y uses the DESNZ Y set (valid 1 Jan – 31 Dec Y).
 *     If no factor covers the date yet (e.g. 2027 data before DESNZ 2027 is
 *     published), the most recent earlier factor is used and a warning is
 *     raised so the entry can be recalculated later.
 *  3. Unit: a factor in the same dimension as the entered unit (mass, volume,
 *     net energy, gross energy); the exact unit is preferred, any other unit
 *     of that dimension is converted.
 */
import type { Basis, Factor } from './types.js';
import { type UnitRegistry, getUnit } from './units.js';

export interface FactorChoice {
  factor: Factor;
  fallback: boolean; // true when the period did not cover the date
}

/** Pick, per basis, the factor to use. Returns only the bases that have one. */
export function chooseFactors(
  candidates: Factor[],
  opts: { date: string; region: string; unit: string; units: UnitRegistry },
): Map<Basis, FactorChoice> {
  const dim = getUnit(opts.units, opts.unit).dimension;
  const out = new Map<Basis, FactorChoice>();
  const bases = [...new Set(candidates.map((f) => f.basis))];

  for (const basis of bases) {
    const sameDim = candidates.filter((f) => f.basis === basis && opts.units.get(f.unit)?.dimension === dim);
    if (!sameDim.length) continue;
    // Region: prefer the facility's country if any factor exists for it.
    const regional = sameDim.filter((f) => f.region === opts.region);
    const pool = regional.length ? regional : sameDim.filter((f) => f.region === 'GLOBAL');
    if (!pool.length) continue;

    const covering = pool.filter((f) => f.validFrom <= opts.date && opts.date <= f.validTo);
    let chosen: Factor[] = covering;
    let fallback = false;
    if (!covering.length) {
      const earlier = pool.filter((f) => f.validFrom <= opts.date).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
      const latestStart = earlier[0]?.validFrom;
      chosen = earlier.filter((f) => f.validFrom === latestStart);
      fallback = chosen.length > 0;
    }
    if (!chosen.length) continue;
    const exact = chosen.find((f) => f.unit === opts.unit);
    out.set(basis, { factor: exact ?? chosen[0]!, fallback });
  }
  return out;
}
