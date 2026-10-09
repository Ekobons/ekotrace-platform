import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcBiological, calcIncineration, calcLandfill, calcWastewater, ch4FromGas, type GwpTable } from '../src/index.js';

const AR5: GwpTable = { set: 'AR5', values: { CH4: 28, CH4_fossil: 28, N2O: 265 } };
const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

const base = { siteName: 'Test landfill', method: 'fod' as const, climate: 'tropical_dry' as const, mcf: 1, ox: 0, recovery: [], gwp: AR5 };

test('landfill FOD: 1,000 t food placed in 2020 decays from 2021 (6-month delay), by hand', () => {
  const deposits = [{ year: 2020, type: 'food', tonnes: 1000 }];
  const dep = 1000 * 0.15 * 0.7 * 1; // DDOCm placed, t
  const k = 0.085; // food, tropical dry (Table 3.3)
  assert.equal(calcLandfill({ ...base, year: 2020, deposits }).totals.direct, 0);
  const y2021 = dep * (1 - Math.exp(-k)) * 0.5 * 16 / 12 * 1000; // kg CH4
  const r = calcLandfill({ ...base, year: 2021, deposits });
  close(r.lines[0]!.kgGas!, y2021);
  close(r.totals.direct, y2021 * 28);
  const y2022 = dep * Math.exp(-k) * (1 - Math.exp(-k)) * 0.5 * 16 / 12 * 1000;
  close(calcLandfill({ ...base, year: 2022, deposits }).lines[0]!.kgGas!, y2022);
});

test('landfill: recovery to an enclosed flare, oxidation, slip and biogenic CO2', () => {
  const deposits = [{ year: 2010, type: 'msw', tonnes: 200000 }, { year: 2015, type: 'msw', tonnes: 250000 }];
  const g = calcLandfill({ ...base, year: 2024, deposits }).generatedT * 1000;
  const rec = 0.4 * g;
  const r = calcLandfill({ ...base, year: 2024, deposits, ox: 0.1, recovery: [{ device: 'flare_enclosed', ch4Kg: rec }] });
  const ch4 = (g - rec) * 0.9 + rec * 0.1;
  close(r.lines.filter((l) => l.basis === 'direct').reduce((s, l) => s + l.kgGas!, 0), ch4);
  close(r.totals.outside_scopes, rec * 0.9 * 44 / 16);
});

test('landfill: collection-efficiency method and over-recovery warning', () => {
  const m3 = 1_000_000;
  const ch4 = ch4FromGas(m3, 50);
  close(ch4, 358400);
  const r = calcLandfill({ ...base, method: 'collection', year: 2024, deposits: [], collectionEfficiency: 0.75, recovery: [{ device: 'engine', ch4Kg: ch4 }] });
  close(r.generatedT, ch4 / 0.75 / 1000);
  const r2 = calcLandfill({ ...base, year: 2021, deposits: [{ year: 2020, type: 'food', tonnes: 10 }], recovery: [{ device: 'flare_open', ch4Kg: 1e6 }] });
  assert.ok(r2.warnings.some((w) => /more than the model/.test(w)));
});

test('incineration: plastics and mixed municipal waste (Table 2.3 Western Asia), CH4 and N2O', () => {
  const p = calcIncineration({ plantName: 'WtE', streams: [{ type: 'plastics', tonnes: 100 }], technology: 'continuous_stoker', gwp: AR5 });
  close(p.totals.direct, 275000 + 100 * 0.0002 * 28 + 100 * 0.05 * 265);
  assert.equal(p.totals.outside_scopes, 0);
  const m = calcIncineration({ plantName: 'WtE', streams: [{ type: 'msw', tonnes: 1000 }], technology: 'continuous_stoker', gwp: AR5 });
  const fossilShare = 0.18 * 0.9 * 0.46 * 0.01 + 0.029 * 0.8 * 0.5 * 0.2 + 0.006 * 0.84 * 0.67 * 0.2 + 0.063 * 0.75 + 0.054 * 0.9 * 0.03;
  close(m.lines.find((l) => l.gas === 'CO2' && l.basis === 'direct')!.kgGas!, 1e6 * fossilShare * 44 / 12);
  assert.ok(m.totals.outside_scopes > 0);
  const meas = calcIncineration({ plantName: 'WtE', streams: [{ type: 'msw', tonnes: 1000 }], technology: 'continuous_stoker', measured: { co2Tonnes: 1000, biogenicPct: 60, source: 'CEMS' }, gwp: AR5 });
  close(meas.lines.find((l) => l.gas === 'CO2' && l.basis === 'direct')!.kgGas!, 400000);
});

test('composting and anaerobic digestion (Table 4.1; measured biogas with leaks)', () => {
  close(calcBiological({ process: 'composting', tonnes: 100, basis: 'wet', gwp: AR5 }).totals.direct, 400 * 28 + 24 * 265);
  const ad = calcBiological({ process: 'ad', tonnes: 100, basis: 'wet', measured: { ch4ProducedKg: 10000, recovery: [{ device: 'engine', ch4Kg: 9500 }] }, gwp: AR5 });
  close(ad.lines.filter((l) => l.basis === 'direct').reduce((s, l) => s + l.kgGas!, 0), 500 + 95);
  assert.equal(ad.warnings.length, 0);
});

test('wastewater: domestic aerobic plant CH4 (2019 MCF 0.03) and N2O (0.016)', () => {
  const r = calcWastewater({ kind: 'domestic', system: 'centralised_aerobic', measure: 'BOD', organicsKg: 100000, recovery: [], nInfluentKg: 10000, gwp: AR5 });
  close(r.totals.direct, 1800 * 28 + 10000 * 0.016 * 44 / 28 * 265);
});
