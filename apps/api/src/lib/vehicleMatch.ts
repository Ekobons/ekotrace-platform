/**
 * Reads everyday vehicle descriptions ("car petrol", "pickup diesel", "tipper 18t",
 * "forklift LPG", "Tesla EV") as a DESNZ vehicle type. Used when people paste
 * their own lists: the result is shown next to each row so it can be checked
 * and changed before saving.
 *
 * Rules: an exact type name wins; otherwise class words (car / van / truck /
 * motorbike / machinery, sizes, segments, tonnage, load, refrigerated) and
 * powertrain words (diesel, petrol, hybrid, plug-in, electric, CNG, LPG) build
 * the DESNZ code. Anything unspecified takes the DESNZ "average" (or "fuel unknown").
 */

export interface TypeRef { id: number; code: string; name: string }
export interface Match { type: TypeRef; exact: boolean; assumed: string[] }

const has = (s: string, re: RegExp) => re.test(s);

function powertrain(s: string): { key: string | null; slug: string | null } {
  if (has(s, /plug[\s-]?in|\bphev\b/)) return { key: 'PHEV', slug: 'plug-in-hybrid-electric-vehicle' };
  if (has(s, /\bbev\b|\belectric\b|\bev\b|\btesla\b|\bbattery\b/)) return { key: 'BEV', slug: 'battery-electric-vehicle' };
  if (has(s, /hybrid|\bhev\b/)) return { key: 'Hybrid', slug: 'hybrid' };
  if (has(s, /diesel|\bgasoil\b/)) return { key: 'Diesel', slug: 'diesel' };
  if (has(s, /petrol|gasoline|benzine|\bsuper\b|\bspecial\b|\be-?plus\b/)) return { key: 'Petrol', slug: 'petrol' };
  if (has(s, /\bcng\b|natural gas/)) return { key: 'CNG', slug: 'cng' };
  if (has(s, /\blpg\b|propane|autogas/)) return { key: 'LPG', slug: 'lpg' };
  return { key: null, slug: null };
}

/** Tonnage written in the text: "18t", "18 ton", "7.5 tonnes", "GVW 26000 kg". */
function tonnes(s: string): number | null {
  const t = /(\d+(?:\.\d+)?)\s*(?:t\b|ton|tonne|tons|tonnes)/.exec(s);
  if (t) return Number(t[1]);
  const kg = /(\d{4,6})\s*kg/.exec(s);
  return kg ? Number(kg[1]) / 1000 : null;
}

export function matchVehicleType(text: string, types: TypeRef[]): Match | null {
  const raw = text.trim();
  if (!raw) return null;
  const exact = types.find((t) => t.name.toLowerCase() === raw.toLowerCase());
  if (exact) return { type: exact, exact: true, assumed: [] };
  const s = ` ${raw.toLowerCase().replace(/[_/,;()]+/g, ' ').replace(/\s+/g, ' ')} `;
  const byCode = new Map(types.map((t) => [t.code, t]));
  const pt = powertrain(s);
  const assumed: string[] = [];
  const pick = (code: string, fallbacks: string[] = []) => {
    for (const c of [code, ...fallbacks]) { const t = byCode.get(c); if (t) return { type: t, exact: false, assumed }; }
    return null;
  };

  // Off-road machinery: fuel or spend only.
  if (has(s, /forklift|fork lift|loader|excavator|bulldozer|dozer|backhoe|crane|sweeper|compactor|generator|genset|machinery|tractor|telehandler|grader|roller|\bplant\b/)) {
    const f = pt.key === 'BEV' ? 'electric' : pt.key === 'Petrol' ? 'petrol' : pt.key === 'LPG' ? 'lpg' : pt.key === 'CNG' ? 'cng' : 'diesel';
    if (!pt.key) assumed.push('diesel');
    return pick(`mach:${f}`);
  }

  // Motorbikes.
  if (has(s, /motor ?bike|motorcycle|scooter|moped/)) {
    const size = has(s, /\bsmall\b/) ? 'small' : has(s, /\bmedium\b/) ? 'medium' : has(s, /\blarge\b|\bbig\b/) ? 'large' : 'average';
    if (size === 'average') assumed.push('average size');
    return pick(`veh:motorbikes:${size}:any`);
  }

  // Trucks / HGV (DESNZ: all diesel).
  if (has(s, /truck|\bhgv\b|lorry|tipper|dumper|refuse|garbage|compactor truck|tanker|trailer|\brigid\b|\bartic|articulated|prime mover|\bbus\b/)) {
    const group = has(s, /refrig|reefer|chiller|freezer/) ? 'hgv_refrigerated' : 'hgv';
    const t = tonnes(s);
    let cls: string;
    if (has(s, /artic|articulated|trailer|prime mover/)) cls = t == null ? 'all-artics' : t > 33 ? 'articulated-33t' : 'articulated-3-5-33t';
    else if (t != null) cls = t <= 7.5 ? 'rigid-3-5-7-5-tonnes' : t <= 17 ? 'rigid-7-5-tonnes-17-tonnes' : 'rigid-17-tonnes';
    else cls = has(s, /\brigid\b/) ? 'all-rigids' : 'all-hgvs';
    if (t == null) assumed.push('average size');
    const load = has(s, /empty|0\s*%|unladen/) ? '0-laden' : has(s, /half|50\s*%/) ? '50-laden' : has(s, /full|100\s*%|loaded/) ? '100-laden' : 'average-laden';
    if (load === 'average-laden') assumed.push('average load');
    if (pt.key && pt.key !== 'Diesel') assumed.push(`DESNZ trucks are diesel (${pt.key} not available)`);
    return pick(`veh:${group}:${cls}:${load}`);
  }

  // Vans and pick-ups (up to 3.5 t).
  const ptSlug = pt.slug ?? 'unknown';
  if (has(s, /\bvan\b|pick ?up|pickup|panel van|minivan|\bute\b/)) {
    const cls = has(s, /class iii|class 3/) ? 'class-iii-1-74-to-3-5-tonnes' : has(s, /class ii|class 2/) ? 'class-ii-1-305-to-1-74-tonnes'
      : has(s, /class i\b|class 1/) ? 'class-i-up-to-1-305-tonnes' : 'average-up-to-3-5-tonnes';
    if (cls === 'average-up-to-3-5-tonnes') assumed.push('average van');
    if (!pt.slug) assumed.push('fuel unknown');
    const p = pt.key === 'Hybrid' ? 'unknown' : ptSlug; // DESNZ vans have no hybrid
    return pick(`veh:vans:${cls}:${p}`, [`veh:vans:average-up-to-3-5-tonnes:${p}`]);
  }

  // Cars (default): segment, else size, else average.
  const segment: [RegExp, string][] = [
    [/supermini/, 'supermini'], [/\bmini\b/, 'mini'], [/lower medium/, 'lower-medium'], [/upper medium/, 'upper-medium'],
    [/executive/, 'executive'], [/luxury/, 'luxury'], [/sports?\b/, 'sports'], [/\bsuv\b|4x4|4 x 4|four wheel|dual purpose|jeep|land ?cruiser|patrol\b|pajero/, 'dual-purpose-4x4'],
    [/\bmpv\b|people carrier|minibus/, 'mpv'],
  ];
  const seg = segment.find(([re]) => has(s, re));
  const sizeWord = has(s, /\bsmall\b|compact|hatchback|\bmedium\b|sedan|saloon|\blarge\b|\bbig\b/);
  // Without a car word, size, segment or fuel there is nothing to go on.
  if (!seg && !sizeWord && !pt.slug && !has(s, /\bcars?\b|coupe|taxi|limo|limousine|estate|pool car|company car/)) return null;
  if (!pt.slug) assumed.push('fuel unknown');
  if (seg) return pick(`veh:cars_by_segment:${seg[1]}:${ptSlug}`, [`veh:cars_by_size:average-car:${ptSlug}`]);
  const size = has(s, /\bsmall\b|compact|hatchback/) ? 'small-car' : has(s, /\bmedium\b|sedan|saloon/) ? 'medium-car' : has(s, /\blarge\b|\bbig\b/) ? 'large-car' : 'average-car';
  if (size === 'average-car') assumed.push('average size');
  return pick(`veh:cars_by_size:${size}:${ptSlug}`, [`veh:cars_by_size:average-car:${ptSlug}`]);
}

/** "34km" / "1,200 L" / "250" → number and unit text. */
export function splitQuantity(v: string): { qty: number | null; unit: string } {
  const m = /^\s*(-?[\d,]*\.?\d+)\s*([a-zA-Z³$€£.]*.*)$/.exec(v ?? '');
  if (!m) return { qty: null, unit: '' };
  const n = Number(m[1]!.replace(/,/g, ''));
  return { qty: Number.isFinite(n) ? n : null, unit: m[2]!.trim() };
}
