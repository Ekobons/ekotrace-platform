/**
 * CBAM communication (exporter portal): the calculations must give what the Commission's template gives.
 * Expected values come from the official v2.1 workbook filled by buildWorkbook() and fully recalculated
 * (LibreOffice, calculateAll), so engine and template are checked against each other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkbook, calculate, fromWorkbook, normalise, toCells } from '../src/lib/cbamComm.js';
import { readWorkbook } from '../src/lib/xlsxTemplate.js';

const near = (a: number | null | undefined, b: number, msg: string) => assert.ok(a != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);

const scenario = () => normalise({
  period: { start: '2026-01-01', end: '2026-03-31' },
  installation: { name: 'Test Steel Works', country: 'AE', unlocode: 'AE SHJ', city: 'Sharjah' },
  goods: [{ category: 'Crude steel', routes: ['Electric arc furnace'] }, { category: 'Iron or steel products', routes: [] }, { category: 'Unwrought aluminium', routes: ['Primary (electrolytic) smelting'] }],
  processes: [
    { id: 'p1', name: 'EAF melt shop', category: 'Crude steel', includes: ['Only direct production'], production: [0, 1000], market: 200, consumedIn: { p2: 800 }, nonCbam: 0, heatApplicable: true, wasteGasApplicable: true, dirEm: 150,
      heat: { imp: 2, impEf: 60, exp: 0.5, expEf: 55 }, wasteGas: { imp: 1, impEf: 56.1, exp: 0.2, expEf: 56.1 }, elecMwh: 450, elecEf: 0.45, elecSource: 'D.4.1', elecExported: 10, elecExportedEf: 0.45, carbon: { share: 0.5, price: 20, rebate: 5 } },
    { id: 'p2', name: 'Rolling mill', category: 'Iron or steel products', includes: ['Only direct production'], production: [780], market: 780, consumedIn: {}, nonCbam: 0, dirEm: 40, elecMwh: 90, elecEf: 0.45, elecSource: 'D.4.1', elecExported: 0, carbon: { share: 1, price: 10, rebate: 0 } },
    { id: 'p3', name: 'Smelter', category: 'Unwrought aluminium', includes: ['Only direct production'], production: [300], market: 300, consumedIn: {}, nonCbam: 0, dirEm: 500, elecMwh: 4200, elecEf: 0.4, elecSource: 'Mix', elecExported: 0 },
  ],
  precursors: [{ id: 'pp1', name: 'Bought DRI', category: 'Direct reduced iron', country: 'IN', purchased: [400], consumedIn: { p1: 350 }, other: 50, seeDirect: 1.1, seeDirectSource: 'Default', elecPerT: 0.1, elecPerTSource: 'Measured', elecEf: 0.7, elecEfSource: 'D.4.2', justification: 'Data gaps' },
               { id: 'pp2', name: 'Bought crude', category: 'Crude steel', country: 'TR', routes: ['Basic oxygen steelmaking'], purchased: [100], consumedIn: { p2: 100 }, other: 0, seeDirect: 2.0, seeDirectSource: 'Measured', elecPerT: 0.2, elecPerTSource: 'Measured', elecEf: 0.5, elecEfSource: 'Mix' }],
  streams: [{ method: 'Combustion', name: 'Natural gas', ad: 50, unit: '1000Nm3', ncv: 36, ef: 56.1, efUnit: 'tCO2/TJ', oxf: 99, bio: 0 },
            { method: 'Process emissions', name: 'Electrodes', ad: 30, unit: 't', ef: 3.6, efUnit: 'tCO2/t', convf: 100 },
            { method: 'Mass Balance', name: 'Steel out', ad: -1000, unit: 't', carbon: 0.002 },
            { method: 'Combustion', name: 'Biomass mix', ad: 10, unit: 't', ncv: 15, ef: 100, efUnit: 'tCO2/TJ', bio: 40 }],
  pfc: [{ method: 'Slope method', technology: 'CWPB', ad: 300, frequency: 0.2, duration: 1.5, sef: 0.143, fC2F6: 0.121, collection: 0.98 }],
  measured: [{ name: 'Stack 1', gas: 'N2O', conc: 0.05, hours: 2000, flow: 30 }, { name: 'Stack 2', gas: 'CO2', conc: 120, hours: 1000, flow: 2, bio: 10 }],
  ghg: { indirect: 2100 }, quality: { general: 'Mostly measurements & analyses', assurance: 'Internal audits' }, carbonCurrency: 'AED',
  products: [{ processId: 'p2', cn: '72081000', name: 'HR coil', reducingAgent: 'Natural gas', params: { mn: 0.01, carbonPct: 0.002 }, cpType: 'Carbon Tax', cpShare: 0.3, currency: 'AED', cpDue: 12, rebateType: 'Free allocation', rebateShare: 0.1, rebate: 2 },
             { processId: 'p1', cn: '72061000', name: 'Ingots', cpType: '', currency: '' },
             { processId: 'p3', cn: '76011010', name: 'Al ingot', params: { scrapAl: 0.05 } }],
});

test('installation totals match the template (sheet C)', () => {
  const r = calculate(scenario());
  near(r.fuel.fromStreams, 1.95, 'fuel input TJ');
  near(r.ghg.co2, 425.6422, 'CO2');
  near(r.ghg.biomass, 30, 'biomass');
  near(r.ghg.n2o, 795, 'N2O');
  near(r.ghg.pfc, 104.707956122449, 'PFC');
  near(r.ghg.direct, 1325.35015612245, 'direct');
  near(r.ghg.total ?? null, 3425.35015612245, 'total');
  assert.deepEqual(r.checks, []);
});

test('specific embedded emissions through own and purchased precursors match Summary_Products', () => {
  const r = calculate(scenario());
  const [hr, ingot, al] = r.products;
  near(hr!.seeDirect, 0.996529497435897, 'HR coil direct'); near(hr!.seeIndirect, 0.297564102564103, 'HR coil indirect'); near(hr!.seeTotal, 1.2940936, 'HR coil total');
  near(hr!.defaultShare, 0.396246971000671, 'HR coil default share'); near(hr!.embeddedElec, 0.638461538461538, 'HR coil embedded electricity');
  near(hr!.cpCovered, 0.38822808, 'covered by carbon price'); near(hr!.rebateCovered, 0.12940936, 'covered by rebate'); near(hr!.effectiveCp, 10, 'effective carbon price');
  near(ingot!.seeDirect, 0.67161626, 'ingot direct'); near(ingot!.seeIndirect, 0.227, 'ingot indirect'); near(ingot!.defaultShare, 0.57324401288319, 'ingot default share'); near(ingot!.embeddedElec, 0.485, 'ingot electricity');
  near(al!.seeDirect, 1.66666666666667, 'Al direct'); near(al!.seeIndirect, 5.6, 'Al indirect'); near(al!.embeddedElec, 14, 'Al electricity');
  assert.equal(hr!.elecSource, 'D.4.1');
  // carbon price tool (sheet F): per tonne, through the supply chain
  const n = (name: string) => r.nodes.find((x) => x.name === name)!;
  near(n('EAF melt shop').cpDue, 4.8911626, 'EAF carbon price'); near(n('EAF melt shop').rebate, 1.22279065, 'EAF rebate');
  near(n('Rolling mill').cpDue, 6.04862830769231, 'mill carbon price'); near(n('Rolling mill').rebate, 1.25414425641026, 'mill rebate');
});

test('the filled workbook keeps the template and reads back to the same data', () => {
  const d = scenario();
  const buf = buildWorkbook(d);
  const wb = readWorkbook(buf);
  assert.ok(wb.sheets.includes('Summary_Communication') && wb.sheets.includes('Parameters_Constants'), 'all template sheets are kept');
  assert.equal(wb.get('A_InstData', 'I20'), 'Test Steel Works');
  assert.equal(wb.get('A_InstData', 'I26'), 'United Arab Emirates');
  assert.equal(wb.get('A_InstData', 'I9'), 46023, 'start date as an Excel date');
  assert.equal(wb.get('A_InstData', 'E62'), 'Crude steel'); assert.equal(wb.get('A_InstData', 'I62'), 'Electric arc furnace');
  assert.equal(wb.get('D_Processes', 'L17'), 1000, 'EAF tonnes in route 2 (electric arc furnace)');
  assert.equal(wb.get('D_Processes', 'L32'), 800, 'EAF output used in the rolling mill');
  assert.equal(wb.get('D_Processes', 'K50'), true);
  assert.equal(wb.get('E_PurchPrec', 'L28'), 350, 'DRI used in process 1');
  assert.equal(wb.get('E_PurchPrec', 'L73'), 100, 'bought crude used in process 2');
  assert.equal(wb.get('Summary_Products', 'F10'), '72081000');
  assert.equal(wb.get('F_Tools', 'J97'), 'AED');
  const back = fromWorkbook(buf);
  assert.deepEqual(back, d);
  const x = String(buf.subarray(0, 4).toString('hex'));
  assert.equal(x, '504b0304');
  assert.ok(toCells(d).every((c) => c.v !== '' && c.v != null));
});
