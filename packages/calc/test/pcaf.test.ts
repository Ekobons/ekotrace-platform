import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribution, financedEmissions, summarise, type HoldingInput, type PortfolioLine } from '../src/pcaf.js';

const near = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);
const base = (x: Partial<HoldingInput>): HoldingInput => ({
  id: 'h', assetClass: 'business_loan', outstanding: 0, listed: false, financials: null, reported: [], revenueFactor: null, assetFactor: null, reportYear: 2025, ...x,
});
const fin = (x: Partial<NonNullable<HoldingInput['financials']>>) => ({ year: 2025, evic: null, equity: null, debt: null, revenue: null, totalAssets: null, ...x });
const rev = { basis: 'revenue' as const, s1: 100, s2: 50, s3: 400, label: 'test revenue', year: 2025 };
const ast = { basis: 'assets' as const, s1: 15, s2: 5, s3: null, label: 'test assets', year: 2025 };

test('listed equity: outstanding ÷ EVIC × verified reported emissions (score 1)', () => {
  const r = financedEmissions(base({ assetClass: 'listed_equity', listed: true, outstanding: 10e6, financials: fin({ evic: 100e6 }),
    reported: [{ year: 2025, score: 2, s1: 9999, s2: 0, s3: null, source: 'CDP' }, { year: 2025, score: 1, s1: 1000, s2: 500, s3: 2000, source: 'Assured report' }] }));
  near(r.attribution, 0.1);
  assert.equal(r.denominator.kind, 'evic');
  assert.equal(r.score, 1);
  near(r.financed!.total, 150); near(r.financed!.s3!, 200);
  assert.deepEqual(r.available, [1, 2]);
});

test('private business loan: ÷ (equity + debt), revenue × sector factor (score 4)', () => {
  const r = financedEmissions(base({ outstanding: 10e6, financials: fin({ equity: 30e6, debt: 20e6, revenue: 80e6 }), revenueFactor: rev, assetFactor: ast }));
  near(r.attribution, 0.2);
  assert.equal(r.denominator.kind, 'equity_debt');
  assert.equal(r.score, 4);
  near(r.company!.s1, 8000); near(r.company!.s2, 4000);
  near(r.financed!.total, 2400); near(r.financed!.s3!, 6400);
  assert.deepEqual(r.available, [4, 5]);
});

test('no company data: outstanding × factor per million of assets (score 5), no attribution needed', () => {
  const r = financedEmissions(base({ outstanding: 5e6, assetFactor: ast }));
  assert.equal(r.attribution, null);
  assert.equal(r.score, 5);
  near(r.financed!.total, 100);
  assert.equal(r.financed!.s3, null);
});

test('nothing usable: no result, a warning says what to add', () => {
  const r = financedEmissions(base({ outstanding: 5e6 }));
  assert.equal(r.score, null); assert.equal(r.financed, null);
  assert.ok(r.warnings.some((w) => /sector emission factor/.test(w)));
});

test('reported emissions without financials cannot be attributed; falls back to layer 5', () => {
  const r = financedEmissions(base({ outstanding: 5e6, reported: [{ year: 2025, score: 2, s1: 10, s2: 10, s3: null, source: 'x' }], assetFactor: ast }));
  assert.equal(r.score, 5);
  assert.ok(r.warnings.some((w) => /financials/.test(w)));
});

test('attribution: capped at 100%; listed without EVIC uses equity + debt with a warning', () => {
  const a = attribution({ assetClass: 'business_loan', outstanding: 80e6, listed: false, financials: fin({ equity: 30e6, debt: 20e6 }) });
  assert.equal(a.factor, 1);
  assert.ok(a.warnings.some((w) => /capped/.test(w)));
  const b = attribution({ assetClass: 'listed_equity', outstanding: 1e6, listed: true, financials: fin({ equity: 5e6, debt: 5e6 }) });
  near(b.factor, 0.1); assert.equal(b.kind, 'equity_debt');
  assert.ok(b.warnings.some((w) => /EVIC/.test(w)));
});

test('a forced layer is used when it can be calculated, ignored with a warning when not', () => {
  const h = base({ outstanding: 10e6, financials: fin({ equity: 30e6, debt: 20e6, revenue: 80e6 }), revenueFactor: rev,
    reported: [{ year: 2025, score: 2, s1: 1000, s2: 0, s3: null, source: 'CDP' }] });
  assert.equal(financedEmissions(h).score, 2);
  assert.equal(financedEmissions({ ...h, forceScore: 4 }).score, 4);
  const r = financedEmissions({ ...h, forceScore: 5 });
  assert.equal(r.score, 2);
  assert.ok(r.warnings.some((w) => /cannot be calculated/.test(w)));
});

test('newest reported year is used within a score; old data is flagged', () => {
  const r = financedEmissions(base({ outstanding: 1e6, financials: fin({ year: 2022, equity: 10e6 }), reportYear: 2025,
    reported: [{ year: 2021, score: 2, s1: 1, s2: 1, s3: null, source: 'old' }, { year: 2022, score: 2, s1: 100, s2: 0, s3: null, source: 'new' }] }));
  near(r.company!.s1, 100);
  assert.ok(r.warnings.some((w) => /2022/.test(w)));
});

test('portfolio: totals, intensity, WACI, weighted score, coverage, buckets', () => {
  const mk = (id: string, h: Partial<HoldingInput>, sector: string, revenue: number | null): PortfolioLine => {
    const input = base({ id, ...h });
    return { id, name: id, assetClass: input.assetClass, sector, outstanding: input.outstanding, revenue, result: financedEmissions(input) };
  };
  const lines = [
    mk('A', { assetClass: 'listed_equity', listed: true, outstanding: 10e6, financials: fin({ evic: 100e6, revenue: 50e6 }), reported: [{ year: 2025, score: 1, s1: 1000, s2: 500, s3: null, source: 'r' }] }, 'Steel', 50e6),
    mk('B', { outstanding: 10e6, financials: fin({ equity: 30e6, debt: 20e6, revenue: 80e6 }), revenueFactor: rev }, 'Cement', 80e6),
    mk('C', { outstanding: 5e6, assetFactor: ast }, 'Retail', null),
    mk('D', { outstanding: 5e6 }, 'Retail', null),
  ];
  const s = summarise(lines);
  assert.equal(s.holdings, 4); near(s.outstanding, 30e6);
  near(s.financed.total, 150 + 2400 + 100);
  near(s.coverage.any, 25 / 30); near(s.coverage.reported, 10 / 30);
  near(s.intensity!, 2650 / 25);
  // WACI over A and B (equal weights): A 1500 ÷ 50 = 30, B 12000 ÷ 80 = 150 → 90
  near(s.waci.value!, 90); near(s.waci.coverage, 20 / 30);
  near(s.score!, (1 * 10 + 4 * 10 + 5 * 5) / 25);
  assert.equal(s.missing, 1);
  assert.equal(s.top[0]!.id, 'B');
  assert.equal(s.bySector.find((b) => b.key === 'Retail')!.holdings, 2);
  assert.deepEqual(s.byScore.map((b) => b.key), ['1', '4', '5', 'none']);
});
