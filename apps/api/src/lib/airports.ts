/**
 * Airports (OurAirports, public domain; data/airports/airports.csv) and flight distances.
 *
 * Distance = great-circle distance between the two airports + 8% for routing, stacking and
 * delays, as DESNZ advises for its air travel factors.
 * Flight type (which DESNZ factor): both airports in one country → domestic; otherwise short-haul
 * (under 3,700 km) or long-haul by the distance. DESNZ publishes its short- and long-haul factors for
 * flights to/from the UK; they are used for any flight of that length. "International" (DESNZ
 * "to/from non-UK", an average) is only for a flight whose distance is not known.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Airport { iata: string; name: string; city: string; country: string; lat: number; lon: number; large: boolean }
export type Haul = 'domestic' | 'short' | 'long' | 'intl';
export const UPLIFT = 1.08;
export const SHORT_HAUL_MAX_KM = 3700;
/** One-way distance used for a flight entered by type, when the airports are not known (incl. the 8%). */
export const TYPICAL_KM: Record<Haul, number> = { domestic: 450, short: 1500, long: 6500, intl: 3000 };

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/airports');
let cache: { list: Airport[]; byCode: Map<string, Airport>; countries: Map<string, string> } | null = null;

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const row: string[] = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else cur += ch;
    }
    row.push(cur); out.push(row);
  }
  return out;
}

export function airports() {
  if (cache) return cache;
  const rows = parseCsv(readFileSync(join(DATA, 'airports.csv'), 'utf8')).slice(1);
  const list = rows.map(([iata, name, city, country, lat, lon, large]) => ({ iata: iata!, name: name!, city: city!, country: country!, lat: Number(lat), lon: Number(lon), large: large === '1' }));
  const countries = new Map(parseCsv(readFileSync(join(DATA, 'countries.csv'), 'utf8')).slice(1).map(([c, n]) => [c!, n!] as [string, string]));
  cache = { list, byCode: new Map(list.map((a) => [a.iata, a])), countries };
  return cache;
}

export const airport = (code: string) => airports().byCode.get(code.trim().toUpperCase()) ?? null;

/** Search by code, city, name or country; large airports and exact codes first. */
export function searchAirports(q: string, limit = 12): (Airport & { countryName: string })[] {
  const { list, countries } = airports();
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const scored: [number, Airport][] = [];
  for (const a of list) {
    const code = a.iata.toLowerCase(), city = a.city.toLowerCase(), name = a.name.toLowerCase(), cn = (countries.get(a.country) ?? '').toLowerCase();
    let sc = 0;
    if (code === s) sc = 100; else if (city === s) sc = 60; else if (city.startsWith(s)) sc = 40; else if (name.includes(s)) sc = 25; else if (cn.startsWith(s)) sc = 10; else if (code.startsWith(s)) sc = 20;
    if (sc) scored.push([sc + (a.large ? 5 : 0), a]);
  }
  return scored.sort((x, y) => y[0] - x[0] || x[1].iata.localeCompare(y[1].iata)).slice(0, limit).map(([, a]) => ({ ...a, countryName: countries.get(a.country) ?? a.country }));
}

/** Great-circle distance in km (haversine, mean Earth radius 6,371 km). */
export function greatCircleKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function haulOf(a: Airport, b: Airport, km: number): Haul {
  if (a.country === b.country) return 'domestic';
  return km < SHORT_HAUL_MAX_KM ? 'short' : 'long';
}
