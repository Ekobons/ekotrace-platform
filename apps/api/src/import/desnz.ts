/**
 * DESNZ (formerly DEFRA/BEIS) "flat file" importer.
 *
 * The UK government publishes its GHG conversion factors every June, including
 * a machine-readable "flat file" (one row per factor). This module:
 *
 *   parseDesnz(file)   reads the workbook into plain records (pure, testable)
 *   importDesnz(...)   writes catalogue items, factors and per-gas values
 *
 * Covered now: Scope 1 fuels and bioenergy (stationary combustion), their
 * well-to-tank and "outside of scopes" rows, and the refrigerant / other gas
 * table (fugitive). Other DESNZ categories can be added the same way.
 *
 * How the gas split is stored
 *   DESNZ gives "kg CO2e of CH4 per unit". Dividing by the GWP DESNZ used (AR4
 *   up to 2022, AR5 from 2023 — detected from the file itself) gives kg of CH4
 *   per unit, which can then be multiplied by any GWP set the client chooses.
 */
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface DesnzFuelRow {
  cls: string; // 'Liquid fuels' | 'Solid fuels' | 'Gaseous fuels' | 'Biofuel' | 'Biomass' | 'Biogas'
  fuel: string;
  uom: string; // as in the file: 'litres', 'tonnes', 'kWh (Net CV)'…
  basis: 'direct' | 'wtt' | 'outside_scopes';
  co2e: number | null; // kg CO2e per unit (total)
  gasCo2e: { CO2?: number; CH4?: number; N2O?: number }; // kg CO2e of each gas per unit
}

export interface DesnzGasRow {
  group: string; // 'Kyoto protocol products' | 'Blends' | 'Montreal protocol products' | 'Other products' | 'Fluorinated ethers'
  name: string;
  kyoto: number | null; // kg CO2e per kg, Kyoto part
  nonKyoto: number | null;
  total: number | null;
}

/** Road vehicle factor per km or mile (Scope 1 tailpipe, or its well-to-tank). */
export interface DesnzVehicleRow {
  group: VehicleGroup;
  vehicle: string; // 'Medium car', 'Class II (1.305 to 1.74 tonnes)', 'Rigid (>17 tonnes)'…
  variant: string; // powertrain ('Diesel', 'Battery Electric Vehicle'…) or load ('Average laden'); '' for motorbikes
  unit: 'km' | 'mi';
  basis: 'direct' | 'wtt';
  co2e: number | null;
  gasCo2e: { CO2?: number; CH4?: number; N2O?: number };
}
/** Electricity used per km / mile by electric and plug-in hybrid vehicles. */
export interface DesnzEvEnergyRow { group: VehicleGroup; vehicle: string; variant: string; unit: 'km' | 'mi'; kwh: number }
export type UkEnergyKey = 'elecTd' | 'elecWttGen' | 'elecWttTd' | 'heat' | 'heatTd' | 'heatWtt' | 'heatWttTd';
/** Which flat-file row is which UK energy factor (names checked 2022–2026). */
function ukEnergyKey(scope: string, l1: string, l2: string, l3: string): UkEnergyKey | null {
  if (scope === 'Scope 3' && l2 === 'T&D- UK electricity') return 'elecTd';
  if (scope === 'Scope 3' && l2 === 'WTT- UK electricity (generation)') return 'elecWttGen';
  if (scope === 'Scope 3' && l2 === 'WTT- UK electricity (T&D)') return 'elecWttTd';
  if (scope === 'Scope 2' && l1 === 'Heat and steam' && l3 === 'District heat and steam') return 'heat';
  if (scope === 'Scope 3' && l2 === 'Distribution - district heat & steam') return 'heatTd';
  if (scope === 'Scope 3' && l2 === 'WTT- heat and steam' && l3 === 'District heat and steam') return 'heatWtt';
  if (scope === 'Scope 3' && l2 === 'WTT- district heat & steam distribution') return 'heatWttTd';
  return null;
}

/** Waste disposal (Scope 3 category 5): kg CO2e per tonne by material and treatment route. */
export interface DesnzWasteRow { group: string; material: string; route: WasteRoute; co2e: number }
export type WasteRoute = 'reuse' | 'open_loop' | 'closed_loop' | 'combustion' | 'composting' | 'landfill' | 'ad';
/** DESNZ route names (2025 called combustion "Incineration with Energy Recovery"). */
export function wasteRoute(t: string): WasteRoute | null {
  const x = t.toLowerCase();
  if (x === 're-use') return 'reuse';
  if (x === 'open-loop') return 'open_loop';
  if (x === 'closed-loop') return 'closed_loop';
  if (x === 'combustion' || /incineration/.test(x)) return 'combustion';
  if (x === 'composting') return 'composting';
  if (x === 'landfill') return 'landfill';
  if (x === 'anaerobic digestion') return 'ad';
  return null;
}

/**
 * Land travel by passengers (Scope 3, "Business travel- land"; DESNZ advises the same factors for
 * employee commuting): cars by size and fuel and motorbikes per vehicle-km, taxis, buses and rail
 * per passenger-km; and their well-to-tank.
 */
export type TravelMode = 'car' | 'motorbike' | 'taxi' | 'bus' | 'rail';
export interface DesnzTravelRow {
  mode: TravelMode; vehicle: string; variant: string; unit: 'km' | 'pkm'; basis: 'scope3' | 'wtt';
  co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number };
}
function travelMode(l2: string): TravelMode | null {
  const x = l2.replace(/^WTT-\s*/i, '').toLowerCase();
  if (x === 'cars (by size)') return 'car';
  if (x === 'motorbike') return 'motorbike';
  if (x === 'taxis') return 'taxi';
  if (x === 'bus') return 'bus';
  if (x === 'rail') return 'rail';
  return null;
}

/** Air travel: haul as DESNZ names it, simplified; class; radiative forcing. */
export type AirHaul = 'domestic' | 'short' | 'long' | 'intl';
export type AirClass = 'average' | 'economy' | 'premium' | 'business' | 'first';
export interface DesnzAirRow { haul: AirHaul; cls: AirClass; rf: boolean; basis: 'scope3' | 'wtt'; co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number } }
const airHaul = (l3: string): AirHaul | null => (/^domestic/i.test(l3) ? 'domestic' : /^short-haul/i.test(l3) ? 'short' : /^long-haul/i.test(l3) ? 'long' : /^international/i.test(l3) ? 'intl' : null);
const airClass = (l4: string): AirClass | null => (/^average/i.test(l4) ? 'average' : /^economy/i.test(l4) ? 'economy' : /^premium/i.test(l4) ? 'premium' : /^business/i.test(l4) ? 'business' : /^first/i.test(l4) ? 'first' : null);

export type VehicleGroup = 'cars_by_size' | 'cars_by_segment' | 'vans' | 'hgv' | 'hgv_refrigerated' | 'motorbikes';

/**
 * Freight (Scope 3 "Freighting goods", for upstream and downstream transport): road per tonne-km and per
 * vehicle-km/mile, sea, air and rail per tonne-km; and the well-to-tank ("WTT- delivery vehs & freight").
 */
export type FreightMode = 'hgv' | 'hgv_refrigerated' | 'van' | 'rail' | 'ship' | 'tanker' | 'air';
export interface DesnzFreightRow {
  mode: FreightMode; vehicle: string; size: string; variant: string; unit: 'tkm' | 'km' | 'mi'; basis: 'scope3' | 'wtt';
  co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number };
}
export function freightMode(l2: string): FreightMode | null {
  const x = l2.replace(/^WTT-\s*/i, '').toLowerCase();
  if (/hgv/.test(x)) return /refrigerated/.test(x) && !/non-refrigerated/.test(x) ? 'hgv_refrigerated' : 'hgv';
  if (/^vans?$/.test(x)) return 'van';
  if (x === 'rail') return 'rail';
  if (x === 'cargo ship') return 'ship';
  if (x === 'sea tanker') return 'tanker';
  if (x === 'freight flights') return 'air';
  return null;
}
const FREIGHT_UNIT: Record<string, 'tkm' | 'km' | 'mi'> = { 'tonne.km': 'tkm', km: 'km', miles: 'mi' };
/** Leased vehicles (Scope 3 "Managed assets- vehicles"): per km/mile, by class and fuel, as the fleet. */
export interface DesnzManagedRow { group: VehicleGroup; vehicle: string; variant: string; unit: 'km' | 'mi'; co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number } }

export interface DesnzParsed {
  vehicles: DesnzVehicleRow[];
  /** freight per tonne-km, km or mile, and its well-to-tank */
  freight: DesnzFreightRow[];
  /** leased vehicles per km or mile (Scope 3 managed assets) */
  managed: DesnzManagedRow[];
  travel: DesnzTravelRow[];
  /** Scope 3 water supply and treatment, kg CO2e per m³ */
  water: { supply: number | null; treatment: number | null };
  /** home working, kg CO2e per FTE working hour: office equipment, heating, both */
  homeworking: { kind: string; co2e: number }[];
  /** business travel by air, per passenger-km: haul, class, with or without RF; Scope 3 and well-to-tank */
  air: DesnzAirRow[];
  /** hotel stays, kg CO2e per room per night, by country */
  hotels: { country: string; co2e: number }[];
  /** ferry, per passenger-km: foot / car / average passenger; Scope 3 and well-to-tank */
  sea: { kind: string; basis: 'scope3' | 'wtt'; co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number } }[];
  evEnergy: DesnzEvEnergyRow[];
  /** UK grid electricity (Scope 2, location-based), kg CO2e per kWh and its gas split */
  ukGrid: { co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number } } | null;
  /**
   * Other UK energy rows, per kWh consumed: electricity T&D losses and well-to-tank,
   * district heat & steam (Scope 2), its distribution losses and well-to-tank.
   */
  ukEnergy: Partial<Record<UkEnergyKey, { co2e: number | null; gasCo2e: { CO2?: number; CH4?: number; N2O?: number } }>>;
  year: number;
  version: string;
  gwpSet: 'AR4' | 'AR5' | 'AR6';
  fuels: DesnzFuelRow[];
  gases: DesnzGasRow[];
  waste: DesnzWasteRow[];
  sha256: string;
}

const FUEL_L2 = new Map([
  ['Gaseous fuels', 'Gaseous fuels'], ['Liquid fuels', 'Liquid fuels'], ['Solid fuels', 'Solid fuels'],
  ['Biofuel', 'Biofuel'], ['Biomass', 'Biomass'], ['Biogas', 'Biogas'],
  ['WTT- biofuel', 'Biofuel'], ['WTT- biomass', 'Biomass'], ['WTT- biogas', 'Biogas'],
]);

/** DESNZ level-2 names of vehicle tables (spelling changed between editions). */
export function vehicleGroup(l2: string): VehicleGroup | null {
  const x = l2.replace(/^WTT-\s*/i, '').toLowerCase();
  if (/by size/.test(x)) return 'cars_by_size';
  if (/market segment/.test(x)) return 'cars_by_segment';
  if (/motorbike/.test(x)) return 'motorbikes';
  if (/^vans?$/.test(x)) return 'vans';
  if (/hgv/.test(x)) return /refrigerated/.test(x) && !/non-refrigerated/.test(x) ? 'hgv_refrigerated' : 'hgv';
  return null;
}
const VEH_UNIT: Record<string, 'km' | 'mi'> = { km: 'km', miles: 'mi' };

const text = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('').trim();
  if (typeof v === 'object' && 'result' in v) return String(v.result ?? '').trim();
  return String(v).trim();
};
const num = (v: ExcelJS.CellValue): number | null => {
  if (v == null || v === '') return null;
  const x = typeof v === 'object' && v !== null && 'result' in v ? Number(v.result) : Number(v);
  return Number.isFinite(x) ? x : null;
};

export async function parseDesnz(path: string): Promise<DesnzParsed> {
  const buf = readFileSync(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);

  // Year and version from the front page ("Year:" / "Version:" labels).
  let year = 0, version = '';
  wb.getWorksheet('Front page')?.eachRow((row) => {
    const cells = (row.values as ExcelJS.CellValue[]).map(text);
    cells.forEach((c, i) => {
      if (/^Year:?$/i.test(c)) year = Number(cells[i + 1]) || year;
      if (/^Version:?$/i.test(c)) version = cells[i + 1] || version;
    });
  });
  if (!year) throw new Error('Could not find "Year:" on the front page — is this a DESNZ flat file?');

  const ws = wb.getWorksheet('Factors by Category');
  if (!ws) throw new Error('Sheet "Factors by Category" not found — is this a DESNZ flat file?');

  // Locate the header row and its columns by name (the layout moved between years).
  let col: Record<string, number> = {};
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (headerRow) return;
    const vals = (row.values as ExcelJS.CellValue[]).map(text);
    if (vals.includes('Scope') && vals.includes('UOM')) {
      headerRow = n;
      vals.forEach((v, i) => { if (v) col[v] = i; });
    }
  });
  const valueCol = Object.keys(col).find((k) => k.startsWith('GHG Conversion Factor'));
  for (const need of ['Scope', 'Level 1', 'Level 2', 'Level 3', 'UOM', 'GHG/Unit']) {
    if (!col[need]) throw new Error(`Column "${need}" not found in the flat file`);
  }
  if (!valueCol) throw new Error('Factor value column not found');

  const fuels = new Map<string, DesnzFuelRow>();
  const gases = new Map<string, DesnzGasRow>();
  const vehicles = new Map<string, DesnzVehicleRow>();
  const travel = new Map<string, DesnzTravelRow>();
  const freight = new Map<string, DesnzFreightRow>();
  const managed = new Map<string, DesnzManagedRow>();
  const water: DesnzParsed['water'] = { supply: null, treatment: null };
  const homeworking: DesnzParsed['homeworking'] = [];
  const air = new Map<string, DesnzAirRow>();
  const hotels: DesnzParsed['hotels'] = [];
  const sea = new Map<string, DesnzParsed['sea'][number]>();
  const evEnergy: DesnzEvEnergyRow[] = [];
  const waste: DesnzWasteRow[] = [];
  let ukGrid: DesnzParsed['ukGrid'] = null;
  const ukEnergy: DesnzParsed['ukEnergy'] = {};
  ws.eachRow((row, n) => {
    if (n <= headerRow) return;
    const g = (k: string) => row.getCell(col[k]!).value;
    const scope = text(g('Scope')), l1 = text(g('Level 1')), l2 = text(g('Level 2')), l3 = text(g('Level 3'));
    const uom = text(g('UOM')), ghg = text(g('GHG/Unit')).toLowerCase(), colText = col['Column Text'] ? text(g('Column Text')) : '';
    const v = num(row.getCell(col[valueCol]!).value);
    if (scope === 'Scope 3' && l1 === 'Homeworking' && /fte working hour/i.test(uom) && ghg.startsWith('kg co2e') && v != null) {
      homeworking.push({ kind: l2, co2e: v });
      return;
    }
    if (!l3) return;
    // Business travel by air and sea (per passenger-km), and hotel stays (per room-night).
    const pkm = uom === 'passenger.km';
    if (scope === 'Scope 3' && pkm && (l1 === 'Business travel- air' || l1 === 'WTT- business travel- air')) {
      const l4 = col['Level 4'] ? text(g('Level 4')) : '';
      const haul = airHaul(l3), cls = airClass(l4), rf = !/without/i.test(colText);
      if (haul && cls) {
        const basis = l1.startsWith('WTT') ? 'wtt' : 'scope3';
        const key = `${haul}|${cls}|${rf}|${basis}`;
        const r = air.get(key) ?? { haul, cls, rf, basis, co2e: null, gasCo2e: {} };
        if (/of co2/.test(ghg)) r.gasCo2e.CO2 = v ?? undefined; else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined; else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined; else if (ghg.startsWith('kg co2e')) r.co2e = v;
        air.set(key, r);
      }
      return;
    }
    if (scope === 'Scope 3' && pkm && (l1 === 'Business travel- sea' || l1 === 'WTT- business travel- sea')) {
      const basis = l1.startsWith('WTT') ? 'wtt' : 'scope3', key = `${l3}|${basis}`;
      const r = sea.get(key) ?? { kind: l3, basis, co2e: null, gasCo2e: {} };
      if (/of co2/.test(ghg)) r.gasCo2e.CO2 = v ?? undefined; else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined; else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined; else if (ghg.startsWith('kg co2e')) r.co2e = v;
      sea.set(key, r);
      return;
    }
    // Freight (upstream and downstream transport) and its well-to-tank. The WTT per km/mile of trucks and
    // vans is also read below as a vehicle row (fleet), so only the Scope 3 rows stop here.
    const fmode = scope === 'Scope 3' && (l1 === 'Freighting goods' || l1 === 'WTT- delivery vehs & freight') ? freightMode(l2) : null;
    const funit = FREIGHT_UNIT[uom];
    if (fmode && funit) {
      const basis = l1 === 'Freighting goods' ? 'scope3' : 'wtt';
      const l4 = col['Level 4'] ? text(g('Level 4')) : '';
      const m = /^Average (?:non-)?refrigerated (HGVs|rigids|artics)$/i.exec(l3);
      const vehicle = (m ? `All ${m[1]}` : l3).trim(), size = l4 === 'None' ? '' : l4.trim(), variant = colText === 'None' ? '' : colText.trim();
      const key = `${fmode}|${vehicle}|${size}|${variant}|${funit}|${basis}`;
      const r = freight.get(key) ?? { mode: fmode, vehicle, size, variant, unit: funit, basis, co2e: null, gasCo2e: {} };
      if (/of co2/.test(ghg)) r.gasCo2e.CO2 = v ?? undefined; else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined; else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined; else if (ghg.startsWith('kg co2e')) r.co2e = v;
      freight.set(key, r);
      if (basis === 'scope3' || funit === 'tkm') return;
    }
    if (scope === 'Scope 3' && l1 === 'Managed assets- vehicles' && VEH_UNIT[uom]) {
      const grp = vehicleGroup(l2.replace(/^Managed\s+/i, ''));
      if (grp) {
        const variant = colText === 'None' ? '' : colText, unit = VEH_UNIT[uom]!;
        const key = `${grp}|${l3}|${variant}|${unit}`;
        const r = managed.get(key) ?? { group: grp, vehicle: l3, variant, unit, co2e: null, gasCo2e: {} };
        if (/of co2/.test(ghg)) r.gasCo2e.CO2 = v ?? undefined; else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined; else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined; else if (ghg.startsWith('kg co2e')) r.co2e = v;
        managed.set(key, r);
      }
      return;
    }
    if (scope === 'Scope 3' && l1 === 'Hotel stay' && /room per night/i.test(uom)) {
      if (ghg.startsWith('kg co2e') && !/ of /.test(ghg) && v != null) hotels.push({ country: l3, co2e: v });
      return;
    }

    if (scope === 'Scope 3' && l1 === 'Waste disposal' && uom === 'tonnes') {
      const route = wasteRoute(colText);
      if (route && v != null && ghg.startsWith('kg co2e')) waste.push({ group: l2, material: l3, route, co2e: v });
      return;
    }
    if (scope === 'Scope 3' && (l1 === 'Water supply' || l1 === 'Water treatment') && uom === 'cubic metres' && ghg.startsWith('kg co2e') && v != null) {
      water[l1 === 'Water supply' ? 'supply' : 'treatment'] = v;
      return;
    }
    // Land travel by passengers (employee commuting): per km or passenger-km, and well-to-tank.
    const tmode = scope === 'Scope 3' && (l1 === 'Business travel- land' || /^WTT- pass vehs & travel[- (]+land/.test(l1)) ? travelMode(l2) : null;
    const tunit = uom === 'km' ? 'km' : uom === 'passenger.km' ? 'pkm' : null;
    if (tmode && tunit && !(tunit === 'km' && tmode === 'taxi')) {
      const basis = l1 === 'Business travel- land' ? 'scope3' : 'wtt';
      const variant = colText === 'None' ? '' : colText;
      const key = `${tmode}|${l3}|${variant}|${tunit}|${basis}`;
      const r = travel.get(key) ?? { mode: tmode, vehicle: l3, variant, unit: tunit, basis, co2e: null, gasCo2e: {} };
      if (/of co2/.test(ghg)) r.gasCo2e.CO2 = v ?? undefined;
      else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined;
      else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined;
      else if (ghg.startsWith('kg co2e')) r.co2e = v;
      travel.set(key, r);
      // the WTT rows of cars and motorbikes are also read below as vehicle rows (fleet)
      if (basis === 'scope3') return;
    }
    // Road vehicles: Scope 1 per km/mile, and their well-to-tank (Scope 3).
    const vunit = VEH_UNIT[uom];
    const vgroup = vunit ? vehicleGroup(l2) : null;
    if (vgroup && vunit && ((scope === 'Scope 1' && /^(Passenger|Delivery) vehicles$/.test(l1)) || (scope === 'Scope 3' && /^WTT- (pass vehs|delivery vehs)/.test(l1)))) {
      const basis = scope === 'Scope 1' ? 'direct' : 'wtt';
      const variant = colText === 'None' ? '' : colText;
      const key = `${vgroup}|${l3}|${variant}|${vunit}|${basis}`;
      const r = vehicles.get(key) ?? { group: vgroup, vehicle: l3, variant, unit: vunit, basis, co2e: null, gasCo2e: {} };
      if (/of co2/.test(ghg)) r.gasCo2e.CO2 = v ?? undefined;
      else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined;
      else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined;
      else if (ghg.startsWith('kg co2e')) r.co2e = v;
      vehicles.set(key, r);
      return;
    }
    if (vgroup && vunit && /^SECR kWh UK electricity for EVs$/.test(l1) && v != null) {
      evEnergy.push({ group: vgroup, vehicle: l3, variant: colText, unit: vunit, kwh: v });
      return;
    }
    const ek = uom === 'kWh' ? ukEnergyKey(scope, l1, l2, l3) : null;
    if (ek) {
      const e = (ukEnergy[ek] ??= { co2e: null, gasCo2e: {} });
      if (/of co2/.test(ghg)) e.gasCo2e.CO2 = v ?? undefined;
      else if (/of ch4/.test(ghg)) e.gasCo2e.CH4 = v ?? undefined;
      else if (/of n2o/.test(ghg)) e.gasCo2e.N2O = v ?? undefined;
      else if (ghg.startsWith('kg co2e')) e.co2e = v;
      return;
    }
    if (scope === 'Scope 2' && l1 === 'UK electricity' && uom === 'kWh') {
      ukGrid ??= { co2e: null, gasCo2e: {} };
      if (/of co2/.test(ghg)) ukGrid.gasCo2e.CO2 = v ?? undefined;
      else if (/of ch4/.test(ghg)) ukGrid.gasCo2e.CH4 = v ?? undefined;
      else if (/of n2o/.test(ghg)) ukGrid.gasCo2e.N2O = v ?? undefined;
      else if (ghg.startsWith('kg co2e')) ukGrid.co2e = v;
      return;
    }

    let basis: DesnzFuelRow['basis'] | null = null;
    let cls: string | undefined;
    if (scope === 'Scope 1' && (l1 === 'Fuels' || l1 === 'Bioenergy')) { basis = 'direct'; cls = FUEL_L2.get(l2); }
    else if (scope === 'Scope 3' && (l1 === 'WTT- fuels' || l1 === 'WTT- bioenergy')) { basis = 'wtt'; cls = FUEL_L2.get(l2); }
    else if (scope === 'Outside of Scopes' && ['Biofuel', 'Biomass', 'Biogas', 'Forecourt fuels containing biofuel'].includes(l2)) {
      basis = 'outside_scopes'; cls = l2 === 'Forecourt fuels containing biofuel' ? 'Liquid fuels' : l2;
    }
    if (basis && cls) {
      const key = `${cls}|${l3.toLowerCase()}|${uom}|${basis}`;
      const r = fuels.get(key) ?? { cls, fuel: l3, uom, basis, co2e: null, gasCo2e: {} };
      if (/of co2/.test(ghg)) basis === 'outside_scopes' ? (r.co2e = v) : (r.gasCo2e.CO2 = v ?? undefined);
      else if (/of ch4/.test(ghg)) r.gasCo2e.CH4 = v ?? undefined;
      else if (/of n2o/.test(ghg)) r.gasCo2e.N2O = v ?? undefined;
      else if (ghg.startsWith('kg co2e')) r.co2e = v;
      fuels.set(key, r);
      return;
    }
    if (/refrigerant/i.test(l1) && uom === 'kg') {
      const key = `${l2}|${l3}`;
      const r = gases.get(key) ?? { group: l2, name: l3, kyoto: null, nonKyoto: null, total: null };
      if (/only kyoto/i.test(colText)) r.kyoto = v;
      else if (/only non-kyoto/i.test(colText)) r.nonKyoto = v;
      else if (/^total/i.test(colText)) r.total = v;
      gases.set(key, r);
    }
  });

  // GWP set used by this edition: read it from the methane GWP in the gas table.
  const ch4 = gases.get('Kyoto protocol products|Methane')?.total;
  const gwpSet = ch4 === 25 ? 'AR4' : ch4 === 28 ? 'AR5' : ch4 === 27 || ch4 === 29.8 ? 'AR6' : null;
  if (!gwpSet) throw new Error(`Cannot tell which GWP set this file uses (methane = ${ch4})`);

  return {
    year, version, gwpSet,
    fuels: [...fuels.values()].filter((r) => r.co2e != null || Object.keys(r.gasCo2e).length),
    gases: [...gases.values()],
    vehicles: [...vehicles.values()].filter((r) => r.co2e != null),
    freight: [...freight.values()].filter((r) => r.co2e != null),
    managed: [...managed.values()].filter((r) => r.co2e != null),
    travel: [...travel.values()].filter((r) => r.co2e != null),
    water, homeworking, hotels,
    air: [...air.values()].filter((r) => r.co2e != null), sea: [...sea.values()].filter((r) => r.co2e != null),
    evEnergy, ukGrid, ukEnergy, waste,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}

/** 'kWh (Net CV)' → unit code. Bioenergy "kWh" and "GJ" are net calorific value in DESNZ. */
export const DESNZ_UNIT: Record<string, string> = {
  tonnes: 't', litres: 'L', 'cubic metres': 'm3', kg: 'kg', GJ: 'GJ', kWh: 'kWh',
  'kWh (Net CV)': 'kWh', 'kWh (Gross CV)': 'kWh_gcv',
};

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
