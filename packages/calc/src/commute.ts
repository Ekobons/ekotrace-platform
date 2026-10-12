/**
 * Employee commuting (GHG Protocol Scope 3 category 7), average-data method.
 *
 * Once a year per facility. Two ways in:
 *
 *  - typed:  per mode, the employees who use it, the average one-way distance and the days at the
 *            workplace per week (or the year's total distance, when it is known, e.g. a shuttle
 *            contract);
 *  - survey: one answer per employee (main mode, one-way distance, days at the workplace, people
 *            in the car, car fuel, optionally a second leg such as car → metro), scaled up from
 *            the respondents to the facility's headcount. People who work from home all week
 *            count as respondents with no travel, so they are not scaled up as commuters.
 *
 * Distance per employee and year = 2 × one-way km × working days × (days at the workplace ÷
 * working days per week). Cars and motorbikes are counted per vehicle-km (shared cars divided by
 * the people in the car); taxis, buses and rail per passenger-km.
 *
 * The working days of the year already leave out weekends, public holidays and leave, so the
 * annual total needs no seasonal weights. To show the year month by month it is split by each
 * month's working days (weekend pattern of the facility), the same for every mode.
 */

export type CommuteMode = 'car' | 'carpool' | 'motorbike' | 'taxi' | 'bus' | 'shuttle' | 'metro' | 'train' | 'active' | 'wfh';
export type CarFuel = 'petrol' | 'diesel' | 'hybrid' | 'phev' | 'bev' | 'lpg' | 'cng' | 'unknown';
export type Weekend = 'sat_sun' | 'fri_sat' | 'sun';

export const COMMUTE_MODES: { key: CommuteMode; label: string; unit: 'km' | 'pkm' | null; item: string | null; perVehicle: boolean }[] = [
  { key: 'car', label: 'Car, driving alone', unit: 'km', item: 'commute:car:average-car:{fuel}', perVehicle: true },
  { key: 'carpool', label: 'Car-pool / lift', unit: 'km', item: 'commute:car:average-car:{fuel}', perVehicle: true },
  { key: 'motorbike', label: 'Motorbike', unit: 'km', item: 'commute:motorbike:average', perVehicle: true },
  { key: 'taxi', label: 'Taxi / ride-hailing', unit: 'pkm', item: 'commute:taxi:regular-taxi', perVehicle: false },
  { key: 'bus', label: 'Public bus', unit: 'pkm', item: 'commute:bus:average-local-bus', perVehicle: false },
  { key: 'shuttle', label: 'Staff shuttle bus', unit: 'pkm', item: 'commute:bus:coach', perVehicle: false },
  { key: 'metro', label: 'Metro / tram', unit: 'pkm', item: 'commute:rail:light-rail-and-tram', perVehicle: false },
  { key: 'train', label: 'Train', unit: 'pkm', item: 'commute:rail:national-rail', perVehicle: false },
  { key: 'active', label: 'Walk / cycle / e-scooter', unit: 'km', item: 'commute:active', perVehicle: false },
  { key: 'wfh', label: 'Works from home', unit: null, item: null, perVehicle: false },
];
export const CAR_FUELS: { key: CarFuel; label: string }[] = [
  { key: 'petrol', label: 'Petrol' }, { key: 'diesel', label: 'Diesel' }, { key: 'hybrid', label: 'Hybrid' }, { key: 'phev', label: 'Plug-in hybrid' },
  { key: 'bev', label: 'Electric' }, { key: 'lpg', label: 'LPG' }, { key: 'cng', label: 'CNG' }, { key: 'unknown', label: 'Not known' },
];
const MODE = new Map(COMMUTE_MODES.map((m) => [m.key, m]));

/** Free text from a survey → mode (null when not recognised). */
export function modeOf(text: string | null | undefined): CommuteMode | null {
  const x = String(text ?? '').toLowerCase().trim();
  if (!x) return null;
  if (/home|remote|wfh|telework|hybrid work/.test(x)) return 'wfh';
  if (/pool|shar|lift|passenger|drop/.test(x)) return 'carpool';
  if (/taxi|uber|careem|lyft|ride.?hail|\bcab\b/.test(x)) return 'taxi';
  if (/shuttle|staff bus|company bus|employee bus|company transport|office bus/.test(x)) return 'shuttle';
  if (/e-?scooter/.test(x)) return 'active';
  if (/motor ?(bike|cycle)|moped|scooter/.test(x)) return 'motorbike';
  if (/walk|cycl|bicycle|\bbike\b|on foot/.test(x)) return 'active';
  if (/metro|tram|subway|underground|light rail|monorail|\bmrt\b/.test(x)) return 'metro';
  if (/train|rail/.test(x)) return 'train';
  if (/bus|coach/.test(x)) return 'bus';
  if (/car|driv|own vehicle|private vehicle|suv|jeep/.test(x)) return 'car';
  return null;
}
/** Free text → car fuel ('unknown' when empty or not recognised). */
export function fuelOf(text: string | null | undefined): CarFuel {
  const x = String(text ?? '').toLowerCase();
  if (/plug|phev/.test(x)) return 'phev';
  if (/hybrid|hev/.test(x)) return 'hybrid';
  if (/electric|\bev\b|bev|tesla/.test(x)) return 'bev';
  if (/diesel/.test(x)) return 'diesel';
  if (/petrol|gasoline|benzin|super|special/.test(x)) return 'petrol';
  if (/lpg/.test(x)) return 'lpg';
  if (/cng|natural gas/.test(x)) return 'cng';
  return 'unknown';
}

export const workdaysPerWeek = (w: Weekend) => (w === 'sun' ? 6 : 5);
const isWorkday = (d: Date, w: Weekend) => { const k = d.getUTCDay(); return w === 'sat_sun' ? k !== 0 && k !== 6 : w === 'fri_sat' ? k !== 5 && k !== 6 : k !== 0; };
/** Working days (weekends left out) in each month of the year. */
export function workdaysByMonth(year: number, w: Weekend): number[] {
  const out = Array(12).fill(0) as number[];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) if (isWorkday(d, w)) out[d.getUTCMonth()]! += 1;
  return out;
}
/** Share of the year in each month, by working days. */
export function monthShares(year: number, w: Weekend): number[] {
  const m = workdaysByMonth(year, w), t = m.reduce((a, x) => a + x, 0);
  return m.map((x) => x / t);
}
/** Default working days: weekdays of the year − public holidays − annual leave. */
export function defaultWorkingDays(year: number, w: Weekend, holidays = 12, leave = 22): number {
  return workdaysByMonth(year, w).reduce((a, x) => a + x, 0) - holidays - leave;
}

export interface TypedRow {
  mode: CommuteMode;
  /** a specific catalogue item (e.g. a large diesel car) instead of the mode's default */
  itemCode?: string;
  fuel?: CarFuel;
  employees: number;
  oneWayKm?: number;
  daysPerWeek?: number;
  occupants?: number;
  /** the year's total (vehicle-km for cars and motorbikes, passenger-km otherwise), when known */
  annualKm?: number;
}
export interface SurveyAnswer { mode: CommuteMode; km?: number | null; days?: number | null; occupants?: number | null; fuel?: CarFuel; mode2?: CommuteMode | null; km2?: number | null; /** days a week working from home */ wfhDays?: number | null }
export interface CommuteSettings { year: number; workingDays: number; weekend: Weekend; /** count home working (office equipment per FTE hour, 8 h a day) */ homeworking?: boolean }
export const HOME_ITEM = 'commute:home:office-equipment';
export const HOURS_PER_DAY = 8;

/** One line of the result: a catalogue item and the year's quantity in its unit. */
export interface CommuteLine { item: string; mode: CommuteMode; fuel?: CarFuel; unit: 'km' | 'pkm' | 'fte_h'; quantity: number; personKm: number; people: number; measured: boolean }
export interface CommuteResult {
  lines: CommuteLine[];
  personKm: number;
  /** people per main mode (typed: employees; survey: respondents scaled up) */
  byMode: { mode: CommuteMode; label: string; people: number; share: number }[];
  scale: number;
  respondents?: number;
  responseRate?: number;
  steps: string[];
  warnings: string[];
}

const itemFor = (mode: CommuteMode, fuel: CarFuel | undefined, code?: string) => code || (MODE.get(mode)!.item ?? '').replace('{fuel}', fuel ?? 'unknown');
const r1 = (x: number) => Math.round(x * 10) / 10;

function add(map: Map<string, CommuteLine>, l: Omit<CommuteLine, 'quantity' | 'personKm' | 'people'> & { quantity: number; personKm: number; people: number }) {
  const o = map.get(l.item);
  if (o) { o.quantity += l.quantity; o.personKm += l.personKm; o.people += l.people; o.measured &&= l.measured; } else map.set(l.item, { ...l });
}

/** Typed in: employees per mode with the average distance and days, or the year's total. */
export function commuteTyped(rows: TypedRow[], s: CommuteSettings, headcount?: number): CommuteResult {
  const per = workdaysPerWeek(s.weekend), lines = new Map<string, CommuteLine>(), steps: string[] = [], warnings: string[] = [];
  const people = new Map<CommuteMode, number>();
  for (const r of rows) {
    const m = MODE.get(r.mode);
    if (!m) throw new Error(`Unknown mode ${r.mode}`);
    if (!(r.employees >= 0)) throw new Error(`${m.label}: number of employees missing`);
    people.set(r.mode, (people.get(r.mode) ?? 0) + r.employees);
    if (!m.unit) continue;
    const occ = m.perVehicle && r.mode !== 'motorbike' ? Math.max(1, r.occupants ?? (r.mode === 'carpool' ? 2 : 1)) : 1;
    let qty: number, pkm: number, measured = false;
    if (r.annualKm != null && r.annualKm >= 0) {
      qty = r.annualKm; pkm = m.perVehicle ? r.annualKm * occ : r.annualKm; measured = true;
      steps.push(`${m.label}: ${fmt(qty)} ${m.unit} in the year (entered)`);
    } else {
      if (!(r.oneWayKm! >= 0)) throw new Error(`${m.label}: one-way distance missing`);
      const days = Math.min(per, Math.max(0, r.daysPerWeek ?? per));
      pkm = r.employees * 2 * r.oneWayKm! * s.workingDays * (days / per);
      qty = m.perVehicle ? pkm / occ : pkm;
      steps.push(`${m.label}: ${r.employees} employees × 2 × ${fmt(r.oneWayKm!)} km × ${fmt(s.workingDays)} working days × ${fmt(days)}/${per} days at the workplace = ${fmt(pkm)} person-km${occ > 1 ? ` ÷ ${fmt(occ)} people per car = ${fmt(qty)} car-km` : ''}`);
    }
    add(lines, { item: itemFor(r.mode, r.fuel, r.itemCode), mode: r.mode, fuel: m.perVehicle && r.mode !== 'motorbike' ? r.fuel ?? 'unknown' : undefined, unit: m.unit, quantity: qty, personKm: pkm, people: r.employees, measured });
  }
  const total = [...people.values()].reduce((a, x) => a + x, 0);
  if (headcount && total && Math.abs(total - headcount) / headcount > 0.05) warnings.push(`The modes add up to ${fmt(total)} employees; the facility has ${fmt(headcount)}.`);
  return finish(lines, people, 1, steps, warnings);
}

/** Survey answers scaled up to the headcount. */
export function commuteSurvey(answers: SurveyAnswer[], s: CommuteSettings, headcount: number): CommuteResult {
  const per = workdaysPerWeek(s.weekend), lines = new Map<string, CommuteLine>(), warnings: string[] = [], steps: string[] = [];
  const n = answers.length;
  if (!n) throw new Error('No survey answers with a recognised mode');
  if (!(headcount > 0)) throw new Error('Enter the number of employees of the facility');
  const scale = headcount / n;
  if (n > headcount) warnings.push(`${n} answers for ${headcount} employees: check the headcount, or that the file holds this facility only.`);
  const rate = n / headcount;
  if (rate < 0.3) warnings.push(`Response rate ${Math.round(rate * 100)}%: results from fewer than 30% of employees may not represent the facility.`);
  const people = new Map<CommuteMode, number>();
  let noKm = 0;
  for (const a of answers) {
    people.set(a.mode, (people.get(a.mode) ?? 0) + 1);
    const days = Math.min(per, Math.max(0, a.days ?? per));
    for (const [mode, km] of [[a.mode, a.km], [a.mode2, a.km2]] as [CommuteMode | null | undefined, number | null | undefined][]) {
      if (!mode || mode === 'wfh') continue;
      const m = MODE.get(mode)!;
      if (!m.unit) continue;
      if (km == null || !(km >= 0)) { noKm++; continue; }
      const occ = m.perVehicle && mode !== 'motorbike' ? Math.max(1, a.occupants ?? (mode === 'carpool' ? 2 : 1)) : 1;
      const pkm = 2 * km * s.workingDays * (days / per);
      add(lines, { item: itemFor(mode, a.fuel), mode, fuel: m.perVehicle && mode !== 'motorbike' ? a.fuel ?? 'unknown' : undefined, unit: m.unit,
        quantity: (m.perVehicle ? pkm / occ : pkm) * scale, personKm: pkm * scale, people: mode === a.mode ? scale : 0, measured: false });
    }
  }
  if (s.homeworking) {
    const h = answers.reduce((t, a) => t + Math.min(per, Math.max(0, a.wfhDays ?? 0)) * (s.workingDays / per) * HOURS_PER_DAY, 0) * scale;
    if (h > 0) { add(lines, { item: HOME_ITEM, mode: 'wfh', unit: 'fte_h', quantity: h, personKm: 0, people: 0, measured: false });
      steps.push(`Home working: days at home a week × ${fmt(s.workingDays / per)} working weeks × ${HOURS_PER_DAY} h (office equipment per FTE hour)`); }
  }
  if (noKm) warnings.push(`${noKm} answers have no distance: they count as respondents but add no travel.`);
  steps.push(`${n} answers for ${headcount} employees (response rate ${Math.round(rate * 100)}%): each answer stands for ${fmt(scale)} employees`);
  steps.push(`Per answer: 2 × one-way km × ${fmt(s.workingDays)} working days × days at the workplace ÷ ${per}; cars ÷ people in the car`);
  const res = finish(lines, new Map([...people].map(([k, v]) => [k, v * scale])), scale, steps, warnings);
  return { ...res, respondents: n, responseRate: rate };
}

function finish(lines: Map<string, CommuteLine>, people: Map<CommuteMode, number>, scale: number, steps: string[], warnings: string[]): CommuteResult {
  const all = [...people.values()].reduce((a, x) => a + x, 0) || 1;
  const out = [...lines.values()].filter((l) => l.quantity > 0 || l.mode === 'active').map((l) => ({ ...l, quantity: r1(l.quantity), personKm: r1(l.personKm), people: r1(l.people) }));
  return {
    lines: out, personKm: r1(out.reduce((a, l) => a + l.personKm, 0)), scale,
    byMode: COMMUTE_MODES.filter((m) => people.get(m.key)).map((m) => ({ mode: m.key, label: m.label, people: r1(people.get(m.key)!), share: people.get(m.key)! / all })),
    steps, warnings,
  };
}

/** Splits a year's quantity into months by working days; the months add up to the year exactly. */
export function splitByMonth(quantity: number, shares: number[]): number[] {
  const raw = shares.map((s) => Math.round(quantity * s * 1000) / 1000);
  const diff = Math.round((quantity - raw.reduce((a, x) => a + x, 0)) * 1000) / 1000;
  const k = shares.indexOf(Math.max(...shares));
  raw[k] = Math.round((raw[k]! + diff) * 1000) / 1000;
  return raw;
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en') : String(Math.round(x * 100) / 100));
