import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commuteSurvey, commuteTyped, defaultWorkingDays, fuelOf, modeOf, monthShares, splitByMonth, workdaysByMonth } from '../src/commute.js';

test('commuting: survey text → mode and car fuel', () => {
  assert.equal(modeOf('Drive my own car'), 'car');
  assert.equal(modeOf('Car pool with colleague'), 'carpool');
  assert.equal(modeOf('Careem / Uber'), 'taxi');
  assert.equal(modeOf('Company shuttle'), 'shuttle');
  assert.equal(modeOf('RTA bus'), 'bus');
  assert.equal(modeOf('Dubai Metro'), 'metro');
  assert.equal(modeOf('Motorcycle'), 'motorbike');
  assert.equal(modeOf('Bicycle'), 'active');
  assert.equal(modeOf('E-scooter'), 'active');
  assert.equal(modeOf('Work from home'), 'wfh');
  assert.equal(modeOf('Hovercraft'), null);
  assert.equal(fuelOf('Plug-in hybrid'), 'phev');
  assert.equal(fuelOf('Hybrid'), 'hybrid');
  assert.equal(fuelOf('Electric (Tesla)'), 'bev');
  assert.equal(fuelOf('Super 98'), 'petrol');
  assert.equal(fuelOf(''), 'unknown');
});

test('commuting: working days, month split by working days (weekend pattern)', () => {
  const m = workdaysByMonth(2026, 'sat_sun');
  assert.equal(m.reduce((a, x) => a + x, 0), 261);
  assert.equal(m[1], 20); // Feb 2026: 20 weekdays
  assert.equal(workdaysByMonth(2026, 'sun').reduce((a, x) => a + x, 0), 313);
  assert.equal(defaultWorkingDays(2026, 'sat_sun'), 261 - 12 - 22);
  const s = monthShares(2026, 'sat_sun');
  assert.ok(Math.abs(s.reduce((a, x) => a + x, 0) - 1) < 1e-12);
  const parts = splitByMonth(1234.567, s);
  assert.ok(Math.abs(parts.reduce((a, x) => a + x, 0) - 1234.567) < 1e-6);
});

test('commuting typed in: employees × 2 × km × days; car-pool divided by people in the car; a year total kept as entered', () => {
  const st = { year: 2026, workingDays: 220, weekend: 'sat_sun' as const };
  const r = commuteTyped([
    { mode: 'car', fuel: 'petrol', employees: 10, oneWayKm: 20, daysPerWeek: 5 },
    { mode: 'carpool', employees: 4, oneWayKm: 10, occupants: 2 },
    { mode: 'metro', employees: 6, oneWayKm: 15, daysPerWeek: 3 },
    { mode: 'shuttle', employees: 20, annualKm: 500000 },
    { mode: 'wfh', employees: 5 },
  ], st, 45);
  const car = r.lines.find((l) => l.item === 'commute:car:average-car:petrol')!;
  assert.equal(car.quantity, 10 * 2 * 20 * 220);
  const pool = r.lines.find((l) => l.item === 'commute:car:average-car:unknown')!;
  assert.equal(pool.quantity, 4 * 2 * 10 * 220 / 2);
  assert.equal(r.lines.find((l) => l.mode === 'metro')!.quantity, 6 * 2 * 15 * 220 * 3 / 5);
  const sh = r.lines.find((l) => l.mode === 'shuttle')!;
  assert.equal(sh.quantity, 500000); assert.equal(sh.measured, true);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.byMode.find((m) => m.mode === 'wfh')!.people, 5);
});

test('commuting survey: scaled to the headcount; working from home counts as an answer; second leg; low response warned', () => {
  const st = { year: 2026, workingDays: 200, weekend: 'sat_sun' as const };
  const answers = [
    { mode: 'car' as const, km: 10, days: 5, fuel: 'diesel' as const },
    { mode: 'car' as const, km: 30, days: 5, occupants: 3 },
    { mode: 'bus' as const, km: 8, days: 4, mode2: 'metro' as const, km2: 12 },
    { mode: 'wfh' as const },
  ];
  const r = commuteSurvey(answers, st, 40);
  assert.equal(r.scale, 10); assert.equal(r.respondents, 4); assert.equal(r.responseRate, 0.1);
  assert.equal(r.lines.find((l) => l.item === 'commute:car:average-car:diesel')!.quantity, 2 * 10 * 200 * 10);
  assert.equal(r.lines.find((l) => l.item === 'commute:car:average-car:unknown')!.quantity, (2 * 30 * 200 / 3) * 10);
  assert.equal(r.lines.find((l) => l.mode === 'metro')!.quantity, 2 * 12 * 200 * 0.8 * 10);
  assert.equal(r.byMode.find((m) => m.mode === 'wfh')!.people, 10);
  assert.ok(r.warnings.some((w) => /Response rate 10%/.test(w)));
  assert.throws(() => commuteSurvey([], st, 40));
});
