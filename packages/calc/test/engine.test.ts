import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcCombustion, calcFugitive, calcVehicle, impliedCalorificValue, unitRegistry, convert, chooseFactors, type Factor, type GwpTable } from '../src/index.js';

const units = unitRegistry([
  { code: 'kg', name: 'kilogram', dimension: 'mass', toBase: 1 },
  { code: 't', name: 'tonne', dimension: 'mass', toBase: 1000 },
  { code: 'lb', name: 'pound', dimension: 'mass', toBase: 0.45359237 },
  { code: 'L', name: 'litre', dimension: 'volume', toBase: 1 },
  { code: 'kL', name: 'kilolitre', dimension: 'volume', toBase: 1000 },
  { code: 'gal_us', name: 'US gallon', dimension: 'volume', toBase: 3.785411784 },
  { code: 'kWh', name: 'kWh (net CV)', dimension: 'energy_net', toBase: 1 },
  { code: 'GJ', name: 'GJ (net CV)', dimension: 'energy_net', toBase: 277.7777777778 },
  { code: 'kWh_gcv', name: 'kWh (gross CV)', dimension: 'energy_gross', toBase: 1 },
]);
const AR5: GwpTable = { set: 'AR5', values: { CH4: 28, CH4_fossil: 28, N2O: 265, 'HFC-32': 677, 'HFC-125': 3170, 'HCFC-22': 1760 } };
const AR6: GwpTable = { set: 'AR6', values: { CH4: 27, CH4_fossil: 29.8, N2O: 273, 'HFC-32': 771, 'HFC-125': 3740, 'HCFC-22': 1960 } };

// DESNZ 2024, Diesel (100% mineral diesel), per litre: total 2.66155; CO2 2.62818; CH4 0.00029; N2O 0.03308 (kg CO2e, AR5)
const diesel = (id: number, year: number): Factor[] => [
  { id, itemId: 1, basis: 'direct', unit: 'L', co2ePerUnit: 2.66155, sourceGwpSet: 'AR5', source: `DESNZ ${year}`, region: 'GLOBAL',
    validFrom: `${year}-01-01`, validTo: `${year}-12-31`,
    gases: [{ gas: 'CO2', kgPerUnit: 2.62818 }, { gas: 'CH4_fossil', kgPerUnit: 0.00029 / 28 }, { gas: 'N2O', kgPerUnit: 0.03308 / 265 }] },
  { id: id + 1, itemId: 1, basis: 'wtt', unit: 'L', co2ePerUnit: 0.62409, sourceGwpSet: 'AR5', source: `DESNZ ${year}`, region: 'GLOBAL',
    validFrom: `${year}-01-01`, validTo: `${year}-12-31`, gases: [] },
];

test('unit conversion within a dimension, refused across dimensions', () => {
  assert.equal(convert(units, 2, 't', 'kg'), 2000);
  assert.ok(Math.abs(convert(units, 1, 'GJ', 'kWh') - 277.7777777778) < 1e-6);
  assert.throws(() => convert(units, 1, 'kWh', 'kWh_gcv'), /Cannot convert/);
  assert.throws(() => convert(units, 1, 'L', 'kg'), /Cannot convert/);
});

test('diesel 1,000 L reproduces the DESNZ total under AR5, per gas', () => {
  const r = calcCombustion({ itemName: 'Diesel', quantity: 1000, unit: 'L', date: '2024-03-01', region: 'AE', factors: diesel(10, 2024), gwp: AR5, units });
  assert.ok(Math.abs(r.totals.direct - 2661.55) < 1e-6);
  assert.ok(Math.abs(r.totals.wtt - 624.09) < 1e-6);
  assert.deepEqual(r.lines.filter((l) => l.basis === 'direct').map((l) => l.gas), ['CO2', 'CH4_fossil', 'N2O']);
  assert.equal(r.warnings.length, 0);
});

test('kilolitres convert to litres (the old 1,000× bug cannot happen)', () => {
  const r = calcCombustion({ itemName: 'Diesel', quantity: 1, unit: 'kL', date: '2024-03-01', region: 'AE', factors: diesel(10, 2024), gwp: AR5, units });
  assert.ok(Math.abs(r.totals.direct - 2661.55) < 1e-6);
});

test('AR6 recomputes from gas masses (fossil methane 29.8, N2O 273)', () => {
  const r = calcCombustion({ itemName: 'Diesel', quantity: 1000, unit: 'L', date: '2024-03-01', region: 'AE', factors: diesel(10, 2024), gwp: AR6, units });
  const expected = 2628.18 + (0.29 / 28) * 29.8 + (33.08 / 265) * 273;
  assert.ok(Math.abs(r.totals.direct - expected) < 1e-6, `${r.totals.direct} vs ${expected}`);
});

test('year selection: 2025 activity uses the 2025 factor; 2027 falls back to latest with a warning', () => {
  const all = [...diesel(10, 2024), ...diesel(20, 2025).map((f) => ({ ...f, co2ePerUnit: f.basis === 'direct' ? 2.7 : f.co2ePerUnit }))];
  const c = chooseFactors(all, { date: '2025-06-30', region: 'AE', unit: 'L', units });
  assert.equal(c.get('direct')!.factor.id, 20);
  const r = calcCombustion({ itemName: 'Diesel', quantity: 1, unit: 'L', date: '2027-02-01', region: 'AE', factors: all, gwp: AR5, units });
  assert.ok(r.warnings.some((w) => /latest available/.test(w)));
});

test('country factor beats GLOBAL', () => {
  const ae = diesel(30, 2024).map((f) => ({ ...f, region: 'AE', co2ePerUnit: 2.5, gases: [] }));
  const c = chooseFactors([...diesel(10, 2024), ...ae], { date: '2024-05-01', region: 'AE', unit: 'L', units });
  assert.equal(c.get('direct')!.factor.id, 30);
});

test('no factor in the entered dimension gives a clear error', () => {
  assert.throws(
    () => calcCombustion({ itemName: 'Diesel', quantity: 5, unit: 'kWh_gcv', date: '2024-01-01', region: 'AE', factors: diesel(10, 2024), gwp: AR5, units }),
    /No factor for Diesel in kWh \(gross CV\)/,
  );
});

test('bioenergy: published total (no split) + biogenic CO2 outside scopes', () => {
  const f: Factor[] = [
    { id: 1, itemId: 9, basis: 'direct', unit: 'L', co2ePerUnit: 0.16751, sourceGwpSet: 'AR5', gases: [], source: 'DESNZ 2024', region: 'GLOBAL', validFrom: '2024-01-01', validTo: '2024-12-31' },
    { id: 2, itemId: 9, basis: 'outside_scopes', unit: 'L', co2ePerUnit: 2.39, sourceGwpSet: null, gases: [{ gas: 'CO2_biogenic', kgPerUnit: 2.39 }], source: 'DESNZ 2024', region: 'GLOBAL', validFrom: '2024-01-01', validTo: '2024-12-31' },
  ];
  const r = calcCombustion({ itemName: 'Biodiesel ME', quantity: 100, unit: 'L', date: '2024-02-01', region: 'AE', factors: f, gwp: AR6, units });
  assert.ok(Math.abs(r.totals.direct - 16.751) < 1e-9);
  assert.ok(Math.abs(r.totals.outside_scopes - 239) < 1e-9);
  assert.ok(r.warnings.some((w) => /no gas split/.test(w)));
});

const kyoto = (g: string) => !g.startsWith('HCFC');

test('fugitive quantity method: R-410A top-up split per gas', () => {
  const r = calcFugitive({ itemName: 'R-410A', unit: 'kg', data: { method: 'quantity', released: 10 }, composition: [{ gas: 'HFC-32', fraction: 0.5 }, { gas: 'HFC-125', fraction: 0.5 }], gwp: AR5, units, kyoto });
  assert.equal(r.totals.direct, 5 * 677 + 5 * 3170); // 19,235 kg CO2e (DESNZ R410A AR5 GWP 1,924 × 10 = 19,240, rounding)
  assert.equal(r.lines.length, 2);
});

test('fugitive screening and mass balance', () => {
  const s = calcFugitive({ itemName: 'HFC-32', unit: 'kg', data: { method: 'screening', operatingCharge: 100, annualLeakRatePct: 10, months: 6 }, composition: [{ gas: 'HFC-32', fraction: 1 }], gwp: AR5, units, kyoto });
  assert.equal(s.totals.direct, 5 * 677);
  const m = calcFugitive({ itemName: 'HFC-32', unit: 'kg', data: { method: 'mass_balance', stockStart: 50, stockEnd: 20, purchased: 10, soldOrReturned: 5, newEquipmentCharge: 15, retiredEquipmentCharge: 0 }, composition: [{ gas: 'HFC-32', fraction: 1 }], gwp: AR5, units, kyoto });
  assert.equal(m.totals.direct, 20 * 677);
  assert.throws(() => calcFugitive({ itemName: 'x', unit: 'kg', data: { method: 'mass_balance', stockStart: 0, stockEnd: 50, purchased: 0, soldOrReturned: 0, newEquipmentCharge: 0, retiredEquipmentCharge: 0 }, composition: [{ gas: 'HFC-32', fraction: 1 }], gwp: AR5, units, kyoto }), /negative/);
});

test('HCFC-22 is reported as memo, not in Scope 1', () => {
  const r = calcFugitive({ itemName: 'R-22', unit: 'lb', data: { method: 'quantity', released: 10 }, composition: [{ gas: 'HCFC-22', fraction: 1 }], gwp: AR5, units, kyoto });
  assert.equal(r.totals.direct, 0);
  assert.ok(Math.abs(r.totals.memo - 10 * 0.45359237 * 1760) < 1e-9);
});

test('blend without composition uses the published blend factor and says so', () => {
  const f: Factor = { id: 7, itemId: 3, basis: 'direct', unit: 'kg', co2ePerUnit: 1924, sourceGwpSet: 'AR5', gases: [], source: 'DESNZ 2026', region: 'GLOBAL', validFrom: '2026-01-01', validTo: '2026-12-31' };
  const r = calcFugitive({ itemName: 'R-410A', unit: 't', data: { method: 'quantity', released: 0.01 }, composition: [], blendFactors: [f], gwp: AR5, units, kyoto });
  assert.ok(Math.abs(r.totals.direct - 19240) < 1e-6);
  assert.ok(r.warnings.length === 1);
});

test('CO2e factor used: quantity × factor = total; AR6 shows the published AR5 value alongside', () => {
  const r5 = calcCombustion({ itemName: 'Diesel', quantity: 3, unit: 'kL', date: '2024-03-01', region: 'AE', factors: diesel(10, 2024), gwp: AR5, units });
  const d5 = r5.factors.find((f) => f.basis === 'direct')!;
  assert.ok(Math.abs(d5.co2ePerUnit - 2.66155) < 1e-9);
  assert.equal(d5.unit, 'L');
  assert.ok(Math.abs(d5.perEnteredUnit - 2661.55) < 1e-6); // per kilolitre
  assert.ok(Math.abs(d5.quantity * d5.perEnteredUnit - r5.totals.direct) < 1e-6);
  assert.equal(d5.published, undefined);
  const w5 = r5.factors.find((f) => f.basis === 'wtt')!;
  assert.equal(w5.method, 'published');
  assert.ok(Math.abs(w5.quantity * w5.perEnteredUnit - r5.totals.wtt) < 1e-6);

  const r6 = calcCombustion({ itemName: 'Diesel', quantity: 1000, unit: 'L', date: '2024-03-01', region: 'AE', factors: diesel(10, 2024), gwp: AR6, units });
  const d6 = r6.factors.find((f) => f.basis === 'direct')!;
  assert.ok(Math.abs(1000 * d6.co2ePerUnit - r6.totals.direct) < 1e-6);
  assert.deepEqual(d6.published, { co2ePerUnit: 2.66155, gwpSet: 'AR5' });
});

test('CO2e factor of a refrigerant blend is its blend GWP', () => {
  const r = calcFugitive({ itemName: 'R-410A', unit: 'kg', data: { method: 'quantity', released: 10 },
    composition: [{ gas: 'HFC-32', fraction: 0.5 }, { gas: 'HFC-125', fraction: 0.5 }], gwp: AR5, units, kyoto: () => true });
  const f = r.factors.find((x) => x.basis === 'direct')!;
  assert.ok(Math.abs(f.co2ePerUnit - 1923.5) < 1e-9);
  assert.ok(Math.abs(10 * f.perEnteredUnit - r.totals.direct) < 1e-6);
});

// Diesel per kWh (net) and per kWh (gross), for the calorific value tests.
const dieselEnergy = (year: number): Factor[] => [
  ...diesel(10, year),
  { id: 30, itemId: 1, basis: 'direct', unit: 'kWh', co2ePerUnit: 0.25, sourceGwpSet: 'AR5', source: `DESNZ ${year}`, region: 'GLOBAL',
    validFrom: `${year}-01-01`, validTo: `${year}-12-31`, gases: [{ gas: 'CO2', kgPerUnit: 0.25 }] },
  { id: 31, itemId: 1, basis: 'wtt', unit: 'kWh', co2ePerUnit: 0.06, sourceGwpSet: 'AR5', source: `DESNZ ${year}`, region: 'GLOBAL',
    validFrom: `${year}-01-01`, validTo: `${year}-12-31`, gases: [] },
];
const unitsCv = unitRegistry([...units.values(), { code: 'MJ', name: 'MJ (net CV)', dimension: 'energy_net', toBase: 1 / 3.6 },
  { code: 'MJ_gcv', name: 'MJ (gross CV)', dimension: 'energy_gross', toBase: 1 / 3.6 }]);

test('own calorific value: litres × MJ/L → kWh (net) → per-kWh factor', () => {
  const r = calcCombustion({ itemName: 'Diesel', quantity: 1, unit: 'kL', date: '2024-03-01', region: 'AE', factors: dieselEnergy(2024), gwp: AR5, units: unitsCv,
    cv: { value: 36, energyUnit: 'MJ', perUnit: 'L' } });
  // 1 kL = 1,000 L × 36 MJ/L = 36,000 MJ = 10,000 kWh × 0.25 = 2,500 kg
  assert.ok(Math.abs(r.totals.direct - 2500) < 1e-6, String(r.totals.direct));
  assert.ok(Math.abs(r.totals.wtt - 600) < 1e-6);
  assert.equal(r.cv?.basis, 'net');
  assert.ok(Math.abs(r.cv!.convertedQuantity - 36000) < 1e-6);
  const d = r.factors.find((f) => f.basis === 'direct')!;
  assert.ok(Math.abs(d.perEnteredUnit - 2500) < 1e-6); // per kilolitre entered
  assert.ok(r.steps[0].startsWith('Calorific value (net, entered)'));
});

test('own calorific value: gross CV with no gross factor gives a clear error; wrong dimension refused', () => {
  assert.throws(() => calcCombustion({ itemName: 'Diesel', quantity: 1, unit: 'L', date: '2024-03-01', region: 'AE', factors: dieselEnergy(2024), gwp: AR5, units: unitsCv,
    cv: { value: 38, energyUnit: 'MJ_gcv', perUnit: 'L' } }), /No factor for Diesel in MJ \(gross CV\)/);
  assert.throws(() => calcCombustion({ itemName: 'Diesel', quantity: 1, unit: 'L', date: '2024-03-01', region: 'AE', factors: dieselEnergy(2024), gwp: AR5, units: unitsCv,
    cv: { value: 36, energyUnit: 'MJ', perUnit: 'kg' } }), /does not fit/);
});

test('implied calorific value from the source factors', () => {
  const v = impliedCalorificValue(dieselEnergy(2024), { date: '2024-05-01', region: 'AE', energyUnit: 'MJ', perUnit: 'L', units: unitsCv })!;
  // 2.62818 kg CO2/L ÷ (0.25 kg CO2/kWh ÷ 3.6 MJ/kWh) = 37.845 MJ/L
  assert.ok(Math.abs(v.value - 2.62818 / (0.25 / 3.6)) < 1e-9);
});

// ------------------------------------------------------------------ vehicles --
const unitsV = unitRegistry([...units.values(),
  { code: 'km', name: 'km', dimension: 'distance', toBase: 1 }, { code: 'mi', name: 'mile', dimension: 'distance', toBase: 1.609344 },
  { code: 'kWh_e', name: 'kWh (electricity)', dimension: 'electricity', toBase: 1 }]);
const vf = (id: number, basis: 'direct' | 'wtt', unit: string, co2e: number, gases: { gas: string; kgPerUnit: number }[] = []): Factor =>
  ({ id, itemId: 9, basis, unit, co2ePerUnit: co2e, sourceGwpSet: 'AR5', source: 'DESNZ 2026', region: 'GLOBAL', validFrom: '2026-01-01', validTo: '2026-12-31', gases });
// DESNZ 2026 Average car · Diesel per km: 0.17265 = CO2 0.17097 + CH4 0.0000046368 + N2O 0.00167 (kg CO2e)
const dieselCar = [vf(1, 'direct', 'km', 0.17265, [{ gas: 'CO2', kgPerUnit: 0.17097 }, { gas: 'CH4_fossil', kgPerUnit: 0.0000046368 / 28 }, { gas: 'N2O', kgPerUnit: 0.00167 / 265 }]), vf(2, 'wtt', 'km', 0.04146)];
const bevCar = [vf(3, 'direct', 'km', 0, [{ gas: 'CO2', kgPerUnit: 0 }])];
const ukGrid: Factor[] = [{ id: 7, itemId: 8, basis: 'scope2', unit: 'kWh_e', co2ePerUnit: 0.13096, sourceGwpSet: 'AR5', source: 'DESNZ 2026', region: 'GB', validFrom: '2026-01-01', validTo: '2026-12-31',
  gases: [{ gas: 'CO2', kgPerUnit: 0.12943 }, { gas: 'CH4_fossil', kgPerUnit: 0.00067 / 28 }, { gas: 'N2O', kgPerUnit: 0.00086 / 265 }] }];
const baseV = { vehicleName: 'Average car', electric: false, phev: false, date: '2026-05-01', region: 'GB', gridFactors: ukGrid, charging: 'elsewhere' as const, gwp: AR5, units: unitsV };

test('vehicle by distance: 1,000 km diesel car = DESNZ per-km factor; miles convert', () => {
  const r = calcVehicle({ ...baseV, method: 'distance', quantity: 1000, unit: 'km', vehicleFactors: dieselCar });
  // gas split × AR5 = 0.1726446 kg/km (DESNZ published total 0.17265: rounding in the source, 0.003 %)
  assert.ok(Math.abs(r.totals.direct - 172.6446368) < 1e-6, String(r.totals.direct));
  assert.ok(Math.abs(r.totals.direct - 172.65) / 172.65 < 1e-4);
  assert.ok(Math.abs(r.totals.wtt - 41.46) < 1e-6);
  assert.equal(r.totals.scope2, 0);
  const m = calcVehicle({ ...baseV, method: 'distance', quantity: 1000, unit: 'mi', vehicleFactors: dieselCar });
  assert.ok(Math.abs(m.totals.direct - 172.6446368 * 1.609344) < 1e-6);
});

test('electric car by distance: Scope 1 = 0, kWh = km × kWh/km, Scope 2 = kWh × grid; on-site charging not counted', () => {
  const ev = { unit: 'km', kwhPerUnit: 0.20358, source: 'DESNZ 2026' };
  const r = calcVehicle({ ...baseV, electric: true, method: 'distance', quantity: 1000, unit: 'km', vehicleFactors: bevCar, evEnergy: ev });
  assert.equal(r.totals.direct, 0);
  assert.ok(Math.abs(r.totals.scope2 - 203.58 * 0.13096) < 1e-6, String(r.totals.scope2));
  const s2 = r.factors.find((f) => f.basis === 'scope2')!;
  assert.ok(Math.abs(s2.perEnteredUnit * 1000 - r.totals.scope2) < 1e-6, 'factor per km shown');
  const site = calcVehicle({ ...baseV, electric: true, method: 'distance', quantity: 1000, unit: 'km', vehicleFactors: bevCar, evEnergy: ev, charging: 'site' });
  assert.equal(site.totals.scope2, 0);
  assert.ok(site.steps.some((x) => /not counted again/.test(x)));
  const ae = calcVehicle({ ...baseV, region: 'AE', electric: true, method: 'distance', quantity: 1000, unit: 'km', vehicleFactors: bevCar, evEnergy: ev });
  assert.equal(ae.totals.scope2, 0);
  assert.ok(ae.warnings.some((w) => /No grid electricity factor for AE/.test(w)));
});

test('vehicle by fuel and by spend; electric car cannot be entered by fuel', () => {
  const fuel = { name: 'Diesel', factors: diesel(10, 2026) };
  const f = calcVehicle({ ...baseV, method: 'fuel', quantity: 100, unit: 'L', vehicleFactors: dieselCar, fuel });
  assert.ok(Math.abs(f.totals.direct - 266.155) < 1e-6);
  const s = calcVehicle({ ...baseV, method: 'spend', quantity: 300, unit: 'AED', vehicleFactors: dieselCar, fuel,
    spend: { currency: 'AED', price: 3, priceUnit: 'L', priceSource: 'test price', buys: 'fuel' } });
  assert.ok(Math.abs(s.totals.direct - 266.155) < 1e-6, '300 AED ÷ 3 AED/L = 100 L');
  assert.ok(s.steps[0].startsWith('Spend: 300 AED ÷ 3 AED/L'));
  const d = s.factors.find((x) => x.basis === 'direct')!;
  assert.ok(Math.abs(d.perEnteredUnit * 300 - s.totals.direct) < 1e-6, 'factor per AED');
  assert.throws(() => calcVehicle({ ...baseV, electric: true, method: 'fuel', quantity: 1, unit: 'L', vehicleFactors: bevCar, fuel }), /is electric/);
  const kwh = calcVehicle({ ...baseV, electric: true, method: 'electricity', quantity: 500, unit: 'kWh_e', vehicleFactors: bevCar });
  assert.ok(Math.abs(kwh.totals.scope2 - 500 * 0.13096) < 1e-6);
});
