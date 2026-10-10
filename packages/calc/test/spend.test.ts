import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, calcPurchase, chooseFx, classify, deflator, detectOverlap, normText, type FxRate, type PurchaseContext } from '../src/index.js';

const close = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const CPI = [{ year: 2022, value: 292.655 }, { year: 2023, value: 304.702 }, { year: 2024, value: 313.689 }];
const RATES: FxRate[] = [
  { currency: 'AED', kind: 'peg', period: '1997-11-01', perUsd: 3.6725, source: 'peg' },
  { currency: 'EUR', kind: 'month', period: '2024-03-01', perUsd: 0.92, source: 'ECB' },
  { currency: 'EUR', kind: 'month', period: '2024-04-01', perUsd: 0.93, source: 'ECB' },
  { currency: 'EUR', kind: 'year', period: '2024-01-01', perUsd: 0.924, source: 'ECB' },
  { currency: 'EUR', kind: 'fixed', period: '2024-01-01', perUsd: 0.9, source: 'budget' },
  { currency: 'INR', kind: 'month', period: '2024-01-01', perUsd: 83, source: 'RBI' },
  { currency: 'INR', kind: 'month', period: '2024-02-01', perUsd: 83.2, source: 'RBI' },
];
const ctx = (fxMethod: PurchaseContext['fxMethod'] = 'month'): PurchaseContext => ({ rates: RATES, fxMethod, index: () => CPI });
const EPA = { id: 1, co2e: 0.2, currency: 'USD', priceYear: 2022, name: 'Stationery product manufacturing', source: 'EPA v1.3' };

test('exchange rate follows the company method, with fallbacks that are warned', () => {
  assert.equal(chooseFx(RATES, 'EUR', '2024-03-15', 'month')!.perUsd, 0.92);
  assert.equal(chooseFx(RATES, 'EUR', '2024-03-15', 'year')!.perUsd, 0.924);
  assert.equal(chooseFx(RATES, 'EUR', '2024-03-15', 'fixed')!.perUsd, 0.9);
  const missingMonth = chooseFx(RATES, 'EUR', '2024-07-10', 'month')!;
  assert.equal(missingMonth.perUsd, 0.924); assert.match(missingMonth.warning!, /no rate for 2024-07/);
  const inrYear = chooseFx(RATES, 'INR', '2024-02-10', 'year')!; // no annual rate: average of the months loaded
  close(inrYear.perUsd, 83.1); assert.match(inrYear.warning!, /2 of 12 months/);
  assert.equal(chooseFx(RATES, 'AED', '2024-02-10', 'month')!.kind, 'peg');
  assert.equal(chooseFx(RATES, 'JPY', '2024-02-10', 'month'), null);
});

test('price index brings money to the factor year; missing years use the nearest (warned)', () => {
  close(deflator(CPI, 2024, 2022).ratio, 292.655 / 313.689);
  const d = deflator(CPI, 2026, 2022);
  close(d.ratio, 292.655 / 313.689); assert.match(d.warning!, /2026 not loaded; 2024 used/);
  assert.equal(deflator(CPI, 2022, 2022).ratio, 1);
});

test('spend-based line: AED → USD at the peg → 2022 dollars → × EPA factor', () => {
  const r = calcPurchase({ date: '2024-05-20', amount: 36725, currency: 'AED', spend: EPA }, ctx());
  const usd2022 = 10000 * 292.655 / 313.689;
  close(r.baseAmount, usd2022); close(r.co2e, usd2022 * 0.2);
  assert.equal(r.method, 'spend'); assert.equal(r.fx!.kind, 'peg');
  assert.equal(r.steps.length, 3); assert.match(r.steps[0]!, /÷ 3.6725 AED\/USD \(peg\)/);
  assert.equal(r.factorUnit, 'kg CO2e / USD 2022');
});

test('credit notes (negative spend) reduce emissions', () => {
  const r = calcPurchase({ date: '2022-05-20', amount: -100, currency: 'USD', spend: EPA }, ctx());
  close(r.co2e, -20);
});

test('supplier factor per kg beats spend; per-currency supplier factor converts currency without CPI when same year', () => {
  const unit = calcPurchase({ date: '2024-05-01', amount: 5000, currency: 'AED', quantity: 2, unit: 't', supplierUnit: { co2e: 0.9, unit: 'kg', name: 'EPD', source: 'EPD 2023' }, spend: EPA },
    { ...ctx(), convertQty: (v, f, t) => (f === 't' && t === 'kg' ? v * 1000 : null) });
  assert.equal(unit.method, 'supplier'); close(unit.co2e, 1800);
  const money = calcPurchase({ date: '2024-03-10', amount: 920, currency: 'EUR', supplierMoney: { co2e: 0.5, currency: 'AED', priceYear: 2024, name: 'Supplier report', source: 'CDP 2024' } }, ctx());
  close(money.baseAmount, (920 / 0.92) * 3.6725); close(money.co2e, 1000 * 3.6725 * 0.5);
  assert.equal(money.method, 'supplier'); assert.equal(money.cpi, undefined);
  // per-kg supplier factor but the line has litres: falls back to spend, warned
  const fb = calcPurchase({ date: '2022-01-01', amount: 10, currency: 'USD', quantity: 5, unit: 'L', supplierUnit: { co2e: 1, unit: 'kg', name: 'x', source: 'y' }, spend: EPA }, ctx());
  assert.equal(fb.method, 'spend'); assert.match(fb.warnings[0]!, /per kg/);
});

test('readable errors when a rate or factor is missing', () => {
  assert.throws(() => calcPurchase({ date: '2024-01-01', amount: 10, currency: 'JPY', spend: EPA }, ctx()), /No exchange rate for JPY/);
  assert.throws(() => calcPurchase({ date: '2024-01-01', amount: 10, currency: 'USD' }, ctx()), /map the line/);
});

const ITEMS = [
  { id: 1, name: 'Stationery product manufacturing', group: 'Manufacturing' },
  { id: 2, name: 'Scheduled passenger air transportation', group: 'Transport & warehousing' },
  { id: 3, name: 'Hotels (except casino hotels) and motels', group: 'Accommodation & food services' },
  { id: 4, name: 'Electronic computer manufacturing', group: 'Manufacturing' },
  { id: 5, name: 'Management consulting services', group: 'Professional, scientific & technical services' },
  { id: 6, name: 'Cement manufacturing', group: 'Manufacturing' },
  { id: 7, name: 'Petroleum refineries', group: 'Manufacturing' },
  { id: 8, name: 'Janitorial services', group: 'Administrative, support & waste services' },
  { id: 9, name: 'Ready-mix concrete manufacturing', group: 'Manufacturing' },
  { id: 10, name: 'Software publishers', group: 'Information & telecoms' },
];

test('descriptions match spend categories, with synonyms and a confidence', () => {
  const ix = buildIndex(ITEMS);
  const cases: [string, number][] = [
    ['A4 paper and pens - stationery', 1], ['Airfare DXB-LHR economy', 2], ['Hotel stay Riyadh 3 nights', 3], ['Dell laptop Latitude 7440', 4],
    ['Consultancy fees Q3 strategy', 5], ['OPC cement 50kg bags', 6], ['Diesel for generators', 7], ['Office cleaning contract', 8],
    ['Microsoft 365 licence renewal', 10], ['Ready mix concrete C40', 9],
  ];
  for (const [text, want] of cases) {
    const c = classify(ix, text);
    assert.equal(c.candidates[0]?.itemId, want, `${text} → ${JSON.stringify(c)}`);
  }
  const vague = classify(ix, 'Misc items XYZ-123');
  assert.equal(vague.itemId, null); assert.ok(vague.confidence < 0.3);
  assert.ok(classify(ix, 'Cement').confidence >= 0.5);
});

test('normalised text groups the same purchase with different PO numbers and dates', () => {
  assert.equal(normText('Diesel supply PO 4500123 31/03/2024'), normText('DIESEL SUPPLY - PO#4500999 01/04/2024'));
  assert.equal(normText('Cement 50 kg bags'), 'cement kg bags');
});

test('overlap with other categories: words first, then the NAICS code', () => {
  assert.equal(detectOverlap('Airfare DXB-LHR')!.target, 'business_travel');
  assert.equal(detectOverlap('DEWA electricity March')!.target, 'energy');
  assert.deepEqual(detectOverlap('Diesel for generators')!.actions, ['keep', 'exclude']);
  assert.equal(detectOverlap('Something', '481111')!.target, 'business_travel');
  assert.equal(detectOverlap('Something', '481112')!.target, 'upstream_transport');
  assert.equal(detectOverlap('Something', '333120')!.target, 'capital_goods');
  assert.equal(detectOverlap('A4 paper', '322230'), null);
  assert.equal(detectOverlap('Membership Emirates Green Building Council'), null);
});

test('brand names and model numbers lower confidence only a little', () => {
  const ix = buildIndex(ITEMS);
  const c = classify(ix, 'Microsoft 365 licence EUR · Software · IT');
  assert.equal(c.itemId, 10, JSON.stringify(c));
  assert.ok(classify(ix, 'Dell Latitude 7440 laptop').itemId === 4);
});

test('the description counts more than the category text next to it', () => {
  const ix = buildIndex([...ITEMS, { id: 11, name: 'Hardware manufacturing', group: 'Manufacturing' }]);
  assert.equal(classify(ix, 'Dell Latitude laptop', 5, 'IT hardware · IT equipment').itemId, 4);
  assert.equal(classify(ix, 'Monthly charges', 5, 'Janitorial services').candidates[0]?.itemId, 8); // context alone still ranks
});

test('pack sizes and packaging words are ignored', () => {
  const ix = buildIndex([...ITEMS, { id: 12, name: 'Plastics bag and pouch manufacturing', group: 'Manufacturing' }]);
  const c = classify(ix, 'OPC cement 50kg bags', 5, 'Construction materials');
  assert.equal(c.itemId, 6, JSON.stringify(c));
  assert.equal(classify(ix, 'Plastic bags for waste').candidates[0]?.itemId, 12);
});
