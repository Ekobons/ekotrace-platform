import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meterMonths, monthStart } from '../src/index.js';

const TZ = 'Asia/Dubai';
const H = 3_600_000, D = 24 * H;
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('month boundaries are local midnight in the company time zone', () => {
  assert.equal(monthStart(2024, 0, TZ), Date.UTC(2023, 11, 31, 20));
  assert.equal(monthStart(2024, 12, TZ), Date.UTC(2024, 11, 31, 20));
  assert.equal(monthStart(2024, 2, 'Europe/London'), Date.UTC(2024, 2, 1)); // GMT in March before the clock change
  assert.equal(monthStart(2024, 3, 'Europe/London'), Date.UTC(2024, 2, 31, 23)); // BST
});

test('hourly interval readings: January = 744 hours, full coverage', () => {
  const s = monthStart(2024, 0, TZ);
  const readings = Array.from({ length: 744 + 24 }, (_, i) => ({ t: s + (i + 1) * H, v: 1 }));
  const r = meterMonths({ type: 'interval', frequency: 'hour', readings, tz: TZ, now: Date.UTC(2025, 0, 1) });
  const jan = r.months.find((m) => m.month === '2024-01')!;
  close(jan.consumption, 744); assert.equal(jan.coverage, 1); assert.equal(jan.filled, false); assert.equal(jan.readings, 744);
  const feb = r.months.find((m) => m.month === '2024-02')!;
  assert.ok(!feb.filled && Math.abs(feb.consumption - 24) < 1e-9, 'one day of February is too little to scale up');
  assert.ok(feb.issues.some((x) => /too little/.test(x)));
});

test('weekly register readings across a month end are split by time; multiplier applied', () => {
  const r = meterMonths({ type: 'cumulative', frequency: 'week', multiplier: 2,
    readings: [{ t: monthStart(2024, 0, TZ) + 28 * D, v: 1000 }, { t: monthStart(2024, 0, TZ) + 35 * D, v: 1350 }], tz: TZ, now: Date.UTC(2025, 0, 1) });
  close(r.months[0]!.measured, 700 * 3 / 7);
  close(r.months[1]!.measured, 700 * 4 / 7);
});

test('rollover is added back; a reset is not counted and is flagged', () => {
  const s = monthStart(2024, 4, TZ);
  const roll = meterMonths({ type: 'cumulative', frequency: 'day', rollover: 10000, gapFill: 'none',
    readings: [{ t: s, v: 9990 }, { t: s + D, v: 20 }], tz: TZ });
  close(roll.months[0]!.measured, 30);
  assert.ok(roll.months[0]!.issues.some((x) => /rolled over/.test(x)));
  const reset = meterMonths({ type: 'cumulative', frequency: 'day', gapFill: 'none',
    readings: [{ t: s, v: 500 }, { t: s + D, v: 510 }, { t: s + 2 * D, v: 3 }, { t: s + 3 * D, v: 13 }], tz: TZ });
  close(reset.months[0]!.measured, 20);
  assert.ok(reset.months[0]!.issues.some((x) => /went down/.test(x)));
});

test('monthly interval readings without a start belong to the month that just ended; partial daily data prorated', () => {
  const r = meterMonths({ type: 'interval', frequency: 'month', readings: [{ t: monthStart(2024, 1, TZ), v: 12000 }], tz: TZ, now: Date.UTC(2025, 0, 1) });
  assert.equal(r.months.length, 1); assert.equal(r.months[0]!.month, '2024-01'); close(r.months[0]!.consumption, 12000);
  const s = monthStart(2024, 2, TZ);
  const d = meterMonths({ type: 'interval', frequency: 'day', readings: Array.from({ length: 15 }, (_, i) => ({ t: s + (i + 1) * D, v: 100 })), tz: TZ, now: Date.UTC(2025, 0, 1) });
  close(d.months[0]!.measured, 1500); close(d.months[0]!.consumption, 1500 * 31 / 15); assert.ok(d.months[0]!.filled);
});
