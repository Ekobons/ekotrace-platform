import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOne } from '../src/lib/rangeCheck.js';

const M = (y: number, m: number) => y * 12 + m - 1;
/** cooling-like series: high in summer, low in winter, +5% a year, small noise */
function series(years: number, from = 2022) {
  const s = new Map<number, number>();
  for (let y = 0; y < years; y++) for (let m = 1; m <= 12; m++) {
    const season = 1000 + 600 * Math.sin(((m - 4) / 12) * 2 * Math.PI);
    s.set(M(from + y, m), Math.round(season * 1.05 ** y * (1 + 0.03 * Math.sin(m * 7 + y))));
  }
  return s;
}

test('6-month average: ± the limit; nothing without history', () => {
  const s = new Map([[M(2025, 1), 1000], [M(2025, 2), 1000], [M(2025, 3), 1000]]);
  assert.equal(checkOne(s, M(2025, 4), 1300, 35, 'avg6')!.ok, true);
  const w = checkOne(s, M(2025, 4), 3000, 35, 'avg6')!;
  assert.equal(w.ok, false); assert.match(w.txt, /\+200% vs 6-month average/);
  assert.equal(checkOne(new Map(), M(2025, 4), 3000, 35, 'avg6'), null);
});

test('seasonal band: a normal summer peak passes where the 6-month average flags it; a real jump is flagged', () => {
  const s = series(4);                                   // 2022–2025 (only months before July 2025 are used)
  const jul = M(2025, 7), before = new Map([...s].filter(([k]) => k < jul));
  const normal = Math.round((1000 + 600 * Math.sin((3 / 12) * 2 * Math.PI)) * 1.05 ** 3);
  assert.equal(checkOne(before, jul, normal, 35, 'avg6')!.ok, false, 'avg of Jan–Jun is far below a July peak');
  const sm = checkOne(before, jul, normal, 35, 'smart')!;
  assert.equal(sm.method, 'smart'); assert.equal(sm.ok, true, sm.txt);
  assert.match(sm.basis, /same month last year/);
  assert.ok(sm.high / sm.low < 1.6, `tight band for a regular series: ${sm.low}–${sm.high}`);
  const jump = checkOne(before, jul, normal * 1.5, 35, 'smart')!;
  assert.equal(jump.ok, false); assert.match(jump.txt, /vs expected/);
});

test('seasonal band falls back to the 6-month average with less than a year of history', () => {
  const s = new Map<number, number>();
  for (let m = 1; m <= 8; m++) s.set(M(2025, m), 1000);
  const r = checkOne(s, M(2025, 9), 1100, 35, 'smart')!;
  assert.equal(r.method, 'avg6'); assert.equal(r.ok, true); assert.match(r.basis, /less than a year/);
});

test('smart band on steady but noisy data uses the 6-month level and stays tight, so a doubling is flagged', () => {
  const s = new Map<number, number>();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 20; i++) s.set(M(2025, 1) + i, Math.round(2450 * (1 + 0.24 * (rnd() - 0.5))));   // ±12% noise, no season
  const m = M(2025, 1) + 20, ok = checkOne(s, m, 2600, 35, 'smart')!, bad = checkOne(s, m, 5200, 35, 'smart')!;
  assert.equal(ok.ok, true, ok.txt); assert.match(ok.basis, /average of the 6 months before/);
  assert.ok(ok.high < 4000, ok.txt);
  assert.equal(bad.ok, false);
});
