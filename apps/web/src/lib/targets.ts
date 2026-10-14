/**
 * Targets & actions: the reduction-action library and the numbers behind the page (as in the prototype).
 *
 * Run-rate: this year's approved emissions for the months so far, annualised (× 12 ÷ months); entries
 * for a whole year (commuting) count once. Base year: the full base year. Target path: straight line
 * from the base year to the target year, Scope 1+2 and Scope 3 separately. An action's reduction =
 * run-rate of the activities it affects × typical reduction × metric value (adoption %).
 */
import type { Data, Row } from '../components/ViewBar';
import type { RAction, TargetsData } from './api';

const T = (r: Row) => r.s1 + r.s2 + r.s3 + r.s33;
const isFossilVehicle = (r: Row) => r.cat === 'mobile_combustion' && !/electric|bev\b/i.test(r.item);
const isLight = (r: Row) => /car|van|pickup|executive|supermini|mini|motorbike|suv|mpv|sports|luxury|dual purpose/i.test(`${r.sub} ${r.item}`) && !/rigid|articulated|hgv|truck/i.test(r.item);
const isHeavy = (r: Row) => /rigid|articulated|hgv|truck|bus|coach/i.test(`${r.sub} ${r.item}`);
const isCar = (r: Row) => /car|taxi|motorbike|petrol|diesel|hybrid/i.test(r.item) && !/bus|metro|rail|train|tram|shuttle|walk|cycl/i.test(r.item);
const isLandfill = (r: Row) => r.cat === 'waste_generated' && (r.route === 'landfill' || /landfill/i.test(r.item));

export interface LibItem { code: string; cat: string; name: string; scopes: number[]; sel: (r: Row) => boolean; pct: number; kpi: string; objVal: number; start: number; end: number; capexPerT: number; savingPerT: number }
// [code, category, action, scopes, affects, typical reduction, KPI, metric value %, start, end, capex per t, saving per t] — indicative values
export const ACT_LIB: LibItem[] = ([
  ['solar', 'Energy', 'Rooftop and car-park solar PV', [2], (r: Row) => r.kind === 'electricity', 0.25, 'Share of site electricity from on-site solar', 25, 0, 2, 3800, 950],
  ['gtariff', 'Energy', 'Green electricity tariff / clean energy certificates', [2], (r: Row) => r.kind === 'electricity', 1, 'Share of grid electricity on a green tariff', 30, 0, 1, 0, -40],
  ['hvac', 'Energy', 'Chiller and HVAC optimisation (setpoints, VSDs, free cooling)', [2], (r: Row) => r.kind === 'electricity' || r.kind === 'cooling', 0.15, 'Cooling energy reduction', 60, 0, 2, 1400, 980],
  ['led', 'Energy', 'LED lighting and controls', [2], (r: Row) => r.kind === 'electricity', 0.06, 'Sites retrofitted', 80, 0, 1, 900, 950],
  ['bms', 'Energy', 'Building management system and metering', [2], (r: Row) => r.kind === 'electricity' || r.kind === 'cooling', 0.08, 'Sites with BMS analytics', 70, 0, 2, 1100, 900],
  ['gens', 'Energy', 'Replace diesel generators with grid / battery backup', [1], (r: Row) => r.cat === 'stationary_combustion' && /diesel|gas oil/i.test(r.item), 0.6, 'Generator run-hours avoided', 50, 1, 3, 2500, 600],
  ['evlight', 'Fleet', 'Electrify light vehicles (cars, vans, pickups)', [1, 2], (r: Row) => isFossilVehicle(r) && isLight(r), 0.25, 'Light fleet electrified', 40, 0, 4, 5200, 420],
  ['evheavy', 'Fleet', 'Electric or CNG collection trucks', [1], (r: Row) => isFossilVehicle(r) && isHeavy(r), 0.6, 'Heavy fleet converted', 30, 1, 4, 9800, 380],
  ['ecodrive', 'Fleet', 'Route optimisation and eco-driving', [1], isFossilVehicle, 0.08, 'Drivers trained / routes optimised', 90, 0, 1, 150, 700],
  ['refr', 'Refrigerants', 'Low-GWP refrigerant retrofit and leak detection', [1], (r: Row) => r.cat === 'fugitive', 0.6, 'Equipment retrofitted', 60, 0, 3, 2200, 50],
  ['recycle', 'Waste', 'Increase recycling and diversion from landfill', [3], isLandfill, 0.5, 'Waste diverted from landfill', 50, 0, 3, 300, 120],
  ['compost', 'Waste', 'Food-waste composting on site', [3], isLandfill, 0.1, 'Sites with composting', 60, 0, 1, 250, 60],
  ['sbtsup', 'Purchases', 'Engage top suppliers to set science-based targets', [3], (r: Row) => r.cat === 'purchased_goods' || r.cat === 'capital_goods', 0.1, 'Spend with SBTi-committed suppliers', 67, 0, 4, 40, 0],
  ['lowcarb', 'Purchases', 'Low-carbon concrete and steel in specifications', [3], (r: Row) => (r.cat === 'purchased_goods' || r.cat === 'capital_goods') && /cement|concrete|steel|iron|construction/i.test(`${r.item} ${r.sub} ${r.grp}`), 0.08, 'Construction spend with low-carbon specs', 50, 1, 4, 120, -60],
  ['itlife', 'Purchases', 'Extend IT equipment life to 5 years and buy refurbished', [3], (r: Row) => (r.cat === 'purchased_goods' || r.cat === 'capital_goods') && /laptop|tablet|computer|server|monitor|printer|it equipment/i.test(r.item), 0.03, 'IT assets kept 5+ years', 75, 0, 2, 0, 400],
  ['travel', 'Travel & commute', 'Travel policy: rail / economy, fewer trips', [3], (r: Row) => r.cat === 'business_travel', 0.2, 'Trips avoided or downgraded', 80, 0, 1, 0, 600],
  ['shuttle', 'Travel & commute', 'Expand staff shuttle service', [3], (r: Row) => r.cat === 'employee_commuting' && isCar(r), 0.15, 'Car commuters moved to shuttle', 30, 0, 2, 450, 50],
  ['carpool', 'Travel & commute', 'Car-pool matching and parking incentives', [3], (r: Row) => r.cat === 'employee_commuting' && isCar(r), 0.1, 'Car commuters car-pooling', 25, 0, 1, 30, 0],
  ['hybrid', 'Travel & commute', 'Hybrid working (1 home day a week)', [3], (r: Row) => r.cat === 'employee_commuting', 0.2, 'Office staff on hybrid', 60, 0, 0, 0, 0],
  ['evcommute', 'Travel & commute', 'EV charging for employees and EV salary-sacrifice', [3], (r: Row) => r.cat === 'employee_commuting' && isCar(r), 0.15, 'Car commuters switched to EV', 20, 1, 4, 600, 0],
  ['water', 'Water', 'Water efficiency and treated-water reuse for irrigation', [3], (r: Row) => r.cat === 'water_supply', 0.25, 'Irrigation on treated water', 70, 0, 2, 900, 300],
] as const).map(([code, cat, name, scopes, sel, pct, kpi, objVal, s0, s1, capexPerT, savingPerT]) => ({ code, cat, name, scopes: [...scopes], sel, pct, kpi, objVal, start: s0, end: s1, capexPerT, savingPerT })) as LibItem[];
export const libItem = (code: string | null) => ACT_LIB.find((a) => a.code === code) ?? null;
export const ACT_CATS = ['Energy', 'Fleet', 'Refrigerants', 'Waste', 'Purchases', 'Travel & commute', 'Water', 'Other'];
export const STATUS_CHIP: Record<string, string> = { Idea: 'c-n', Approved: 'c-info', 'In progress': 'c-warn', Done: 'c-ok' };
export const COMMITTED = ['Approved', 'In progress', 'Done'];

/**
 * The numbers the page needs, for the viewed selection.
 *
 * Monthly entries: the months so far, annualised (× 12 ÷ months) and, for projections, scaled by the
 * base year's monthly pattern. Entries covering several months (a landfill model, the commuting year):
 * annualised by the months they cover; when such a source has no entry yet this year, the base year's
 * figure is carried forward until it is entered.
 */
export function taData(d: Data, base: Data | null, t: TargetsData) {
  const cy = d.year, by = t.baseYear ?? cy - 1, Tg = t.target;
  const lastM = Math.max(0, ...d.rows.filter((r) => r.m > 0).map((r) => r.m));
  const k = lastM ? 12 / lastM : 0;
  // a restated base year: the applied restatements count as one year-long base-year row (never carried into this year)
  const rst = base?.restated;
  const bRows: Row[] = [...(base?.rows ?? []), ...(rst ? [{ f: '__restated__', m: 0, span: 12, cat: 'restatement', item: 'Base-year restatements', grp: '', sub: '', unit: '', s1: rst.s1, s2: rst.s2, s3: rst.s3, s33: 0,
    bio: 0, memo: 0, n: 0, approved: 0, estimated: 0, qty: 0, rec: 0, kind: null, kwh: null, m3: null, route: '', flow: '', gri: '', haz: null, contractor: null } as Row] : [])];
  const yearly = (r: Row) => 12 / Math.max(1, Math.min(12, r.span ?? 12));          // annualise a multi-month entry
  const key = (r: Row) => `${r.f}|${r.cat}`;
  const curAnnual = new Set(d.rows.filter((r) => r.m === 0).map(key));
  const carried = bRows.filter((r) => r.m === 0 && r.cat !== 'restatement' && !curAnnual.has(key(r)));         // not entered yet this year
  const ann = [
    ...d.rows.map((r) => ({ r, t: r.m === 0 ? T(r) * yearly(r) : T(r) * k, f: r.m === 0 ? yearly(r) : k })),
    ...carried.map((r) => ({ r, t: T(r) * yearly(r), f: yearly(r), carried: true })),
  ];
  const cur = ann.reduce((a, x) => a + x.t, 0);
  const affected = (sel: (r: Row) => boolean) => ann.reduce((a, x) => a + (sel(x.r) ? x.t : 0), 0);
  const s12 = (r: Row) => r.s1 + r.s2, s3 = (r: Row) => r.s3 + r.s33;
  const b = [0, 1, 2].map((i) => bRows.reduce((a, r) => a + [r.s1, r.s2, r.s3 + r.s33][i]!, 0));
  const base12 = b[0]! + b[1]!, base3 = b[2]!, baseT = base12 + base3;
  const span = Math.max(1, Tg.year - by);
  const tgt12 = (y: number) => base12 * (1 - (Tg.s12 / 100) * (y - by) / span), tgt3 = (y: number) => base3 * (1 - (Tg.s3 / 100) * (y - by) / span);
  const tgt = (y: number) => tgt12(y) + tgt3(y);
  /** For a set of facilities (all when omitted): so far this year, the base year, and the projection for this year. */
  const part = (fs?: Set<string>, f: (r: Row) => number = s12) => {
    const inF = (r: Row) => !fs || fs.has(r.f);
    const mon = (rs: Row[], upTo = 12) => rs.filter((r) => inF(r) && r.m > 0 && r.m <= upTo).reduce((a, r) => a + f(r), 0);
    const yM = mon(d.rows, lastM), bM = mon(bRows), bMs = mon(bRows, lastM);
    const yA = d.rows.filter((r) => inF(r) && r.m === 0).reduce((a, r) => a + f(r), 0);
    const yAann = ann.filter((x) => inF(x.r) && x.r.m === 0).reduce((a, x) => a + f(x.r) * x.f, 0);   // incl. carried
    const bA = bRows.filter((r) => inF(r) && r.m === 0).reduce((a, r) => a + f(r) * yearly(r), 0);
    const proj = (bM && bMs ? yM / (bMs / bM) : yM * k) + yAann;
    const sofar = yM + yA;
    const like = bMs + (bA * lastM) / 12 ? ((yM + (yAann * lastM) / 12) / (bMs + (bA * lastM) / 12) - 1) * 100 : 0;   // same months, like for like
    return { base: bM + bA, proj, sofar, like };
  };
  const p12 = part(), p3 = part(undefined, s3);
  const growth = Number(t.sbti.growth ?? 2);
  return { cy, by, T: Tg, lastM, ann, carried: carried.length, cur, affected, b, base12, base3, baseT, tgt, tgt12, tgt3, y12: p12.sofar, y3: p3.sofar, pr12: p12.proj, pr3: p3.proj, red12: p12.like, part, growth, bRows };
}
export type TA = ReturnType<typeof taData>;

export const libAbate = (it: LibItem, x: TA, objVal = it.objVal) => x.affected(it.sel) * it.pct * (Number(objVal) || 0) / 100;

/** Share of an action delivered in a year (ramps up evenly over its period). */
export const frac = (a: { start: number; end: number }, y: number) => (y < a.start ? 0 : y >= a.end ? 1 : (y - a.start + 1) / (a.end - a.start + 1));

/** Cost-benefit per action: payback, ROI over its life, total cost of ownership, NPV at 8%, net cost per tonne. */
export function cbOf(a: Pick<RAction, 'capex' | 'opex' | 'saving' | 'life' | 'abate'>) {
  const capex = +a.capex || 0, opex = +a.opex || 0, sav = +a.saving || 0, life = +a.life || 10, ab = +a.abate || 0, net = sav - opex;
  let npv = -capex; for (let i = 1; i <= life; i++) npv += net / Math.pow(1.08, i);
  const tco = capex + opex * life;
  return { capex, opex, sav, life, ab, net, pay: net > 0 ? capex / net : null, roi: capex ? ((net * life - capex) / capex) * 100 : null, tco, npv, cpt: ab ? (tco - sav * life) / (ab * life) : null };
}

export function scenStats(x: TA, acts: RAction[], sid: string) {
  const as = acts.filter((a) => a.scenarioIds.includes(sid) && !a.excluded), ab = as.reduce((s, a) => s + (+a.abate || 0), 0);
  const capex = as.reduce((s, a) => s + (+a.capex || 0), 0), npv = as.reduce((s, a) => s + cbOf(a).npv, 0);
  const proj = x.cur * Math.pow(1 + x.growth / 100, x.T.year - x.cy) - ab, gap = proj - x.tgt(x.T.year);
  return { n: as.length, ab, capex, npv, gap, proj, acts: as };
}
