/**
 * Matching purchase descriptions to spend categories, without sending data anywhere.
 *
 * Each spend category (e.g. NAICS 322230 "Stationery product manufacturing") is a small
 * document: its name, aliases and group. A description is scored against all of them with
 * BM25 (the ranking used by search engines), after expanding common procurement words
 * ("airfare" → passenger air transportation, "laptop" → electronic computer manufacturing…).
 *
 * Confidence (0–1) combines how much of the description the best category explains with how
 * clearly it beats the runner-up. Below MIN_AUTO the group stays unmapped, with candidates.
 */

/** `key`: items with the same key share a factor (e.g. the NAICS code) — the runner-up for confidence is the next other key.
 *  `boost`: score multiplier (retail / wholesale codes slightly lower: purchaser-price factors already include those margins). */
export interface ClassItem { id: number; name: string; aliases?: string[]; group?: string; code?: string; key?: string; boost?: number }
export interface Candidate { itemId: number; score: number }
export interface Classification { itemId: number | null; confidence: number; candidates: Candidate[] }
export const MIN_AUTO = 0.3;

const STOP = new Set(('a an and or of the for to in on at by with from as per via other others except n.e.c nec misc miscellaneous ' +
  'item items service services product products supply supplies general various charge charges fee fees cost costs expense expenses ' +
  'purchase purchases po invoice inv no nos qty pcs pc ea each lot set month monthly year annual total amount aed usd eur gbp sar inr ' +
  'llc ltd co fze fzco fz est trading company inc plc pvt ' +
  // packaging and pack sizes say nothing about what was bought
  'bag bags box boxes pack packs packet packets carton cartons ctn pkt roll rolls drum drums pallet pallets bundle bundles ' +
  // accounting words
  'credit debit note refund reversal adjustment accrual advance balance payment ' +
  // contract words
  'contract contracts agreement agreements annual quarterly renewal retainer charge charges').split(' '));

/** Procurement words → words used in category names. */
export const SYNONYMS: Record<string, string> = {
  airfare: 'passenger air transportation', flight: 'passenger air transportation', flights: 'passenger air transportation', airline: 'passenger air transportation',
  ticket: 'passenger air transportation', tickets: 'passenger air transportation', air: 'air transportation',
  hotel: 'hotels motels accommodation', accommodation: 'hotels motels accommodation', lodging: 'hotels motels', stay: 'hotels motels',
  taxi: 'taxi limousine ground passenger', cab: 'taxi limousine', uber: 'taxi limousine', careem: 'taxi limousine', limo: 'limousine',
  diesel: 'diesel petroleum refineries fuel', petrol: 'petroleum refineries fuel', gasoline: 'petroleum refineries fuel', fuel: 'petroleum refineries fuel',
  lpg: 'petroleum gas fuel', kerosene: 'petroleum refineries', lubricant: 'petroleum lubricating oil grease', lubricants: 'petroleum lubricating oil grease', oil: 'petroleum lubricating oil',
  electricity: 'electric power distribution', power: 'electric power', dewa: 'electric power water', sewa: 'electric power water',
  addc: 'electric power water', water: 'water supply', gas: 'natural gas distribution',
  internet: 'telecommunications', telephone: 'telecommunications', phone: 'telecommunications', mobile: 'wireless telecommunications', telecom: 'telecommunications',
  etisalat: 'telecommunications', du: 'telecommunications', sim: 'wireless telecommunications',
  laptop: 'electronic computer manufacturing', laptops: 'electronic computer manufacturing', computer: 'electronic computer', pc: 'electronic computer', desktop: 'electronic computer',
  it: 'computer systems design software', server: 'electronic computer', monitor: 'computer terminal peripheral equipment', printer: 'computer peripheral equipment', toner: 'printing ink office',
  cartridge: 'printing ink office', stationery: 'stationery paper office', pen: 'stationery office', pens: 'stationery office', paper: 'paper stationery', a4: 'paper stationery',
  software: 'software publishers', licence: 'software publishers', license: 'software publishers', saas: 'software publishers data processing hosting', subscription: 'software publishers',
  cloud: 'data processing hosting', hosting: 'data processing hosting',
  consulting: 'management consulting', consultancy: 'management consulting', advisory: 'management consulting', consultant: 'management consulting',
  legal: 'legal lawyers', lawyer: 'lawyers legal', advocates: 'lawyers', audit: 'accountants accounting auditing', auditor: 'accountants', accounting: 'accountants accounting bookkeeping', payroll: 'payroll accounting',
  cleaning: 'janitorial', janitorial: 'janitorial', housekeeping: 'janitorial', pest: 'exterminating pest control', landscaping: 'landscaping',
  security: 'security guards patrol', guard: 'security guards patrol', guards: 'security guards patrol',
  catering: 'food service contractors', meals: 'restaurants food service', food: 'food', restaurant: 'restaurants', coffee: 'coffee tea', snacks: 'snack food',
  cement: 'cement', opc: 'portland cement', portland: 'portland cement', concrete: 'ready mix concrete', steel: 'iron steel mills', rebar: 'iron steel mills', asphalt: 'asphalt paving', bitumen: 'asphalt',
  timber: 'sawmills wood', wood: 'wood', glass: 'glass', aluminium: 'aluminum', aluminum: 'aluminum', copper: 'copper', cable: 'wire cable', cables: 'wire cable',
  pipe: 'pipe', pipes: 'pipe', paint: 'paint coating', paints: 'paint coating', chemical: 'chemical', chemicals: 'chemical',
  furniture: 'office furniture', chair: 'office furniture', chairs: 'office furniture', desk: 'office furniture', desks: 'office furniture',
  car: 'automobile manufacturing', cars: 'automobile manufacturing', vehicle: 'motor vehicle', vehicles: 'motor vehicle', truck: 'truck', trucks: 'truck', excavator: 'construction machinery', excavators: 'construction machinery', loader: 'construction machinery', crane: 'construction machinery',
  tyre: 'tire', tyres: 'tire', tire: 'tire', tires: 'tire', battery: 'battery', batteries: 'battery',
  repair: 'repair', maintenance: 'maintenance', spare: 'parts machinery', spares: 'parts machinery', parts: 'parts',
  courier: 'couriers express delivery', dhl: 'couriers express delivery', aramex: 'couriers express delivery', fedex: 'couriers express delivery', ups: 'uninterruptible power supply electrical equipment',
  freight: 'freight trucking', shipping: 'freight transportation', logistics: 'freight transportation warehousing', haulage: 'freight trucking', trucking: 'freight trucking',
  warehouse: 'warehousing storage', storage: 'warehousing storage',
  rent: 'lessors real estate', rental: 'rental leasing', lease: 'lessors leasing', leasing: 'leasing',
  insurance: 'insurance carriers', bank: 'banking credit intermediation', banking: 'banking credit intermediation',
  advertising: 'advertising', marketing: 'advertising marketing', printing: 'printing', events: 'convention trade show organizers',
  training: 'educational training', course: 'educational training', recruitment: 'employment placement', manpower: 'temporary help employment',
  medical: 'medical surgical supplies', aid: 'surgical medical supplies', medicine: 'pharmaceutical preparation', pharma: 'pharmaceutical', uniform: 'apparel', uniforms: 'apparel', ppe: 'apparel safety',
  gloves: 'apparel safety', helmet: 'safety', waste: 'waste collection treatment disposal', skip: 'waste collection', disposal: 'waste disposal',
  construction: 'construction', civil: 'construction', building: 'building construction', hvac: 'heating ventilation air conditioning', ac: 'air conditioning',
  machinery: 'machinery manufacturing', equipment: 'equipment', pump: 'pump', pumps: 'pump', compressor: 'compressor',
  brake: 'motor vehicle brake system parts', brakes: 'motor vehicle brake system parts', filter: 'motor vehicle parts filters', filters: 'motor vehicle parts filters',
  hose: 'rubber plastics hoses', hoses: 'rubber plastics hoses', hydraulic: 'fluid power', grease: 'petroleum lubricating oil grease',
  bottled: 'bottled water', drinking: 'bottled water', mineral: 'bottled water', gallon: 'bottled water', gallons: 'bottled water',
  breaker: 'switchgear switchboard apparatus', breakers: 'switchgear switchboard apparatus', switchgear: 'switchgear switchboard apparatus', circuit: 'switchgear electrical',
  hdpe: 'plastics bag', liner: 'plastics bag', liners: 'plastics bag', bin: 'plastics', bins: 'plastics', film: 'plastics film',
  hat: 'apparel safety', hats: 'apparel safety', vest: 'apparel safety', vests: 'apparel safety', coverall: 'apparel', coveralls: 'apparel', shoes: 'footwear',
  diary: 'stationery paper', diaries: 'stationery paper', folder: 'stationery office', folders: 'stationery office', file: 'stationery office',
  degreaser: 'chemical cleaning compound', solvent: 'chemical solvent', solvents: 'chemical solvent', lime: 'lime gypsum', activated: 'chemical',
  pantry: 'grocery food', conveyor: 'conveyor machinery', belt: 'conveyor', blade: 'machinery parts', blades: 'machinery parts', shredder: 'machinery',
  letterhead: 'printing', letterheads: 'printing', brochure: 'printing', brochures: 'printing', signage: 'sign manufacturing', ms: 'iron steel', angles: 'iron steel', channels: 'iron steel',
  mpls: 'telecommunications', leased: 'telecommunications', switch: 'communications equipment', wifi: 'communications equipment', cabling: 'wire cable communication', cat6: 'wire cable communication',
  paver: 'concrete block brick', pavers: 'concrete block brick', interlock: 'concrete block brick', blocks: 'concrete block brick',
  analytics: 'software publishers', virtual: 'data processing hosting', campaign: 'advertising', social: 'advertising', assurance: 'accountants auditing',
  gasoil: 'diesel petroleum refineries fuel', generator: 'engine turbine power generator', generators: 'engine turbine power generator', genset: 'engine turbine power generator',
  fertilizer: 'fertilizer', fertiliser: 'fertilizer', pesticide: 'pesticide', seeds: 'seed', plants: 'nursery', irrigation: 'irrigation',
};

/** Lower-case words, stop words removed, light stemming (plural / -ing). */
export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z0-9]+|\d+[a-z]+/g) ?? [])
    .filter((w) => !STOP.has(w) && w.length > 1 && !/^\d+(kg|g|t|l|ml|m|mm|cm|gsm|pcs|pc|x|v|w|kw|mb|gb|tb|in)$/.test(w))
    .map(stem);
}
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
/** Description words plus their synonym expansions (expansions count a little less). Words explained by a synonym are not "unknown". */
function queryTerms(s: string, vocab?: Map<string, number>): { terms: Map<string, number>; covered: Set<string> } {
  const out = new Map<string, number>(), covered = new Set<string>();
  s = s.replace(/\bflue gas(es)?\b/gi, 'flue');                    // flue gas treatment is not natural gas
  // "Diesel for generators": what is bought comes before "for" (the rest is its purpose)
  const head = /^(.{3,}?)\s+for\s+\S/i.exec(s.trim());
  if (head && (head[1]!.match(/[a-z][a-z0-9]+/gi) ?? []).length >= 1) s = head[1]!;
  const raw = s.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];
  for (const w of tokens(s)) out.set(w, Math.max(out.get(w) ?? 0, 1));
  for (const r of raw) {
    const syn = SYNONYMS[r] ?? SYNONYMS[stem(r)];
    if (!syn) continue;
    covered.add(stem(r));
    // a word the category names do not use ("tyres") is translated: its synonym counts in full
    const w = vocab && !vocab.has(stem(r)) ? 1 : 0.8;
    for (const t of tokens(syn)) out.set(t, Math.max(out.get(t) ?? 0, w));
  }
  return { terms: out, covered };
}

/** Normalised text used to group lines and to remember mappings. */
export function normText(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(po|inv|invoice|ref|no|#)\s*[:#-]?\s*[a-z0-9-]*\d[a-z0-9-]*/g, ' ')   // PO 4500123, INV-2024-001
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')                             // dates
    .replace(/\b\d+([.,]\d+)?\b/g, ' ')                                               // bare numbers
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export interface ClassIndex { items: ClassItem[]; docs: Map<string, number>[]; len: number[]; avg: number; df: Map<string, number>; n: number }

export function buildIndex(items: ClassItem[]): ClassIndex {
  const docs = items.map((it) => {
    const m = new Map<string, number>();
    const add = (s: string | undefined, w: number) => { for (const t of tokens(s ?? '')) m.set(t, (m.get(t) ?? 0) + w); };
    add(it.name, 1); (it.aliases ?? []).forEach((a) => add(a, 1)); add(it.group, 0.4);
    return m;
  });
  const df = new Map<string, number>();
  docs.forEach((d) => d.forEach((_v, t) => df.set(t, (df.get(t) ?? 0) + 1)));
  const len = docs.map((d) => [...d.values()].reduce((s, v) => s + v, 0));
  return { items, docs, len, avg: len.reduce((s, v) => s + v, 0) / Math.max(1, len.length), df, n: items.length };
}

const K1 = 0.9, B = 0.5;
const idf = (ix: ClassIndex, t: string) => { const d = ix.df.get(t) ?? 0; return Math.log(1 + (ix.n - d + 0.5) / (d + 0.5)); };

/**
 * Best categories for a description. `context` (the category text / GL title written next to
 * it) helps rank but counts half, and its unknown words never lower the confidence.
 */
export function classify(ix: ClassIndex, text: string, k = 5, context = ''): Classification {
  const { terms: q, covered } = queryTerms(text, ix.df);
  const ctx = context ? queryTerms(context, ix.df) : null;
  if (ctx) for (const [t, w] of ctx.terms) if (!q.has(t)) q.set(t, w * 0.5);
  if (!q.size || !ix.n) return { itemId: null, confidence: 0, candidates: [] };
  const scores = new Float64Array(ix.n);
  let qWeight = 0;
  const known: [string, number, number][] = [];
  for (const [t, w] of q) {
    const i = idf(ix, t);
    // unknown original words (brands, model numbers) lower the confidence a little; words a synonym explained do not
    if (!ix.df.has(t)) { if (w === 1 && !covered.has(t)) qWeight += 0.35 * Math.log(1 + ix.n); continue; }
    known.push([t, w, i]);
    if (w === 1) qWeight += i;
  }
  for (let d = 0; d < ix.n; d++) {
    const doc = ix.docs[d]!;
    let s = 0;
    for (const [t, w, i] of known) {
      const f = doc.get(t);
      if (f) s += w * i * (f * (K1 + 1)) / (f + K1 * (1 - B + B * ix.len[d]! / ix.avg));
    }
    scores[d] = s * (ix.items[d]!.boost ?? 1);
  }
  const order = [...scores.keys()].filter((i) => scores[i]! > 0).sort((a, b) => scores[b]! - scores[a]! || ix.len[a]! - ix.len[b]!).slice(0, k);
  const candidates = order.map((i) => ({ itemId: ix.items[i]!.id, score: Math.round(scores[i]! * 1000) / 1000 }));
  if (!order.length) return { itemId: null, confidence: 0, candidates };
  const best = order[0]!, s1 = scores[best]!;
  // runner-up: the best item with another key (same NAICS code = same factor, not a competitor)
  const bk = ix.items[best]!.key;
  let s2 = 0;
  for (let i = 0; i < ix.n; i++) if (i !== best && scores[i]! > s2 && (bk == null || ix.items[i]!.key !== bk)) s2 = scores[i]!;
  // share of the description's (original) words the best category explains
  let explained = 0;
  for (const [t, w, i] of known) if (ix.docs[best]!.has(t)) explained += w >= 0.8 ? i * w : 0;
  const coverage = Math.min(1, explained / Math.max(qWeight, 1e-9));
  const margin = s1 > 0 ? (s1 - s2) / s1 : 0;
  const confidence = Math.round(Math.min(1, coverage * (0.55 + 0.45 * Math.min(1, margin * 2))) * 1000) / 1000;
  return { itemId: confidence >= MIN_AUTO ? ix.items[best]!.id : null, confidence, candidates };
}

// ---------------------------------------------------------------- overlap --
/**
 * Purchases that belong to (or are already counted in) another category.
 *   move     → business_travel (3.6), upstream_transport (3.4), upstream_leased (3.8), capital_goods (3.2)
 *   exclude  → fuel / energy / waste usually already reported in Scope 1, 2 or 3.5 from activity data
 */
export interface Overlap { target: string; label: string; why: string; actions: ('keep' | 'move' | 'exclude')[] }
export const OVERLAP_LABEL: Record<string, string> = {
  business_travel: 'Business travel (3.6)', upstream_transport: 'Upstream transport (3.4)', upstream_leased: 'Upstream leased assets (3.8)',
  capital_goods: 'Capital goods (3.2)', not_purchase: 'Not a purchase', fuel: 'Fuel (Scope 1 / 3.3)', energy: 'Electricity, heat, water (Scope 2 / 3.3)', waste: 'Waste (Scope 3.5)',
};
const MOVE: ('keep' | 'move' | 'exclude')[] = ['keep', 'move', 'exclude'];
const EXCL: ('keep' | 'move' | 'exclude')[] = ['keep', 'exclude'];
// NAICS prefixes (longest first)
const NAICS_RULES: [string, string][] = [
  ['4811', 'business_travel'], ['4812', 'business_travel'], ['481112', 'upstream_transport'], ['4851', 'business_travel'], ['4853', 'business_travel'], ['4854', 'business_travel'],
  ['4855', 'business_travel'], ['4859', 'business_travel'], ['4871', 'business_travel'], ['5615', 'business_travel'], ['7211', 'business_travel'],
  ['482', 'upstream_transport'], ['483', 'upstream_transport'], ['484', 'upstream_transport'], ['486', 'upstream_transport'], ['488', 'upstream_transport'],
  ['492', 'upstream_transport'], ['493', 'upstream_transport'],
  ['5311', 'upstream_leased'], ['5321', 'upstream_leased'], ['5324', 'upstream_leased'],
  ['211', 'fuel'], ['324191', ''], ['3241', 'fuel'], ['2212', 'fuel'], ['4247', 'fuel'], ['4571', 'fuel'], ['2211', 'energy'], ['2213', 'energy'],
  ['562', 'waste'],
  ['23', 'capital_goods'], ['333', 'capital_goods'], ['3361', 'capital_goods'], ['3362', 'capital_goods'], ['3364', 'capital_goods'], ['3365', 'capital_goods'], ['3366', 'capital_goods'],
  ['334111', 'capital_goods'], ['3353', 'capital_goods'],
];
const WORD_RULES: [RegExp, string][] = [
  // airline names (Emirates, Etihad) are left out: in the UAE they are part of many company names
  [/\b(air ?fare|air ?tickets?|flights?|airlines?|flydubai|air ?arabia|boarding pass)\b/i, 'business_travel'],
  [/\b(hotels?|accommodation|lodging|per ?diem|travel allowance|visa fees?|taxi|careem|uber|limo(usine)?|car hire|car rental)\b/i, 'business_travel'],
  [/\b(freight|shipping|courier|dhl|aramex|fedex|haulage|logistics|cargo|trucking|transportation charges?|delivery charges?)\b/i, 'upstream_transport'],
  [/\b(office rent|rent(al)? of|lease rent|tenancy|warehouse rent)\b/i, 'upstream_leased'],
  // fuel itself, not fuel filters, pumps or a diesel generator ("diesel for generators" is fuel)
  [/^(?!.*\b(diesel|petrol|fuel|gasoil)\s*(filters?|pumps?|injectors?|tanks?|nozzles?|lines?|generators?|gensets?|engines?)\b)(?!.*\b(filters?|spare|spares|parts|lubricants?|grease)\b).*\b(diesel|petrol|gasoline|gasoil|fuel|lpg|lng|cng|kerosene|jet a-?1|adnoc|enoc|emarat)\b/i, 'fuel'],
  [/\b(electricity|dewa|sewa|addc|aadc|fewa|etihad water|district cooling|chilled water|empower|tabreed)\b/i, 'energy'],
  [/\b(waste (collection|disposal)|skip hire|garbage|sewage|tipping fee)\b/i, 'waste'],
];

export function detectOverlap(text: string, naics?: string | null): Overlap | null {
  let target: string | undefined, why = '';
  for (const [re, t] of WORD_RULES) { const m = re.exec(text); if (m) { target = t; why = `“${m.slice(1).find(Boolean) ?? m[0]}” in the description`; break; } }
  if (!target && naics) {
    const r = [...NAICS_RULES].sort((a, b) => b[0].length - a[0].length).find(([p]) => naics.startsWith(p));
    if (r?.[1]) { target = r[1]; why = `category (NAICS ${naics})`; }   // '' = no overlap (lubricants are not fuel)
  }
  if (!target) return null;
  return { target, label: OVERLAP_LABEL[target] ?? target, why, actions: ['fuel', 'energy', 'waste'].includes(target) ? EXCL : MOVE };
}
