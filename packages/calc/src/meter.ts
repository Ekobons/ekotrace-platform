/**
 * Meter readings → consumption per calendar month (in the company's time zone).
 *
 *   cumulative  register / index readings: consumption between two readings = the
 *               difference, spread evenly over the time between them (so a weekly or
 *               irregular reading that spans a month end is split between the months).
 *               A drop in the register is a rollover (if the register maximum is set)
 *               or a reset / meter change (that interval is not counted, and flagged).
 *   interval    consumption per interval (hour, day, week, month): each value covers
 *               [start, reading time]; an interval across a month end is split by time.
 *
 * Coverage = share of the month covered by readings. With gap filling ("prorate"), a
 * partly covered month (at least a quarter) is scaled up to the whole month and marked estimated.
 * Readings are × the multiplier (CT ratio, pulse value) first.
 */
export type ReadingType = 'cumulative' | 'interval';
export type Frequency = 'hour' | 'day' | 'week' | 'month' | 'irregular';

export interface Reading { t: number; v: number; from?: number }
export interface MeterMonth {
  /** 'YYYY-MM' */
  month: string;
  start: number;
  end: number;
  /** measured consumption in the month (× multiplier) */
  measured: number;
  /** consumption used for the entry: measured, or scaled up to the whole month */
  consumption: number;
  coverage: number;
  readings: number;
  filled: boolean;
  /** the month has ended */
  closed: boolean;
  issues: string[];
}

const HOUR = 3_600_000, DAY = 24 * HOUR;
/** Least share of a month that can be scaled up to the whole month. */
export const MIN_SCALE = 0.25;
const NOMINAL: Record<Frequency, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30.4375 * DAY, irregular: 0 };

/** Offset (ms) of a time zone from UTC at an instant: local wall time − UTC. */
export function tzOffset(tz: string, at: number): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(at)).reduce<Record<string, number>>((a, x) => (x.type === 'literal' ? a : { ...a, [x.type]: Number(x.value) }), {});
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(at / 1000) * 1000;
}
/** UTC instant of local midnight on the 1st of a month (month0 may overflow: 12 = January next year). */
export function monthStart(year: number, month0: number, tz: string): number {
  const guess = Date.UTC(year, month0, 1);
  const first = guess - tzOffset(tz, guess);
  return guess - tzOffset(tz, first);
}
/** 'YYYY-MM' of an instant in a time zone. */
export function localMonth(t: number, tz: string): { y: number; m: number } {
  const d = new Date(t + tzOffset(tz, t));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}
const label = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
const fmtDate = (t: number, tz: string) => new Date(t + tzOffset(tz, t)).toISOString().slice(0, 16).replace('T', ' ');

interface Seg { from: number; to: number; v: number }

export function meterMonths(input: {
  type: ReadingType; frequency: Frequency; multiplier?: number; rollover?: number | null; gapFill?: 'prorate' | 'none';
  readings: Reading[]; tz: string; now?: number;
}): { months: MeterMonth[]; issues: string[] } {
  const mult = input.multiplier ?? 1;
  const now = input.now ?? Date.now();
  const tz = input.tz;
  const rs = [...input.readings].filter((r) => Number.isFinite(r.v) && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  const issues: string[] = [];
  const segs: (Seg & { note?: string })[] = [];
  const noteList: { t: number; text: string }[] = [];
  const note = (t: number, text: string) => noteList.push({ t, text });

  if (input.type === 'interval') {
    let prevTo = -Infinity;
    for (const [i, r] of rs.entries()) {
      let from = r.from;
      if (from === undefined) {
        if (input.frequency === 'month') { const { y, m } = localMonth(r.t - 1, tz); from = monthStart(y, m, tz); }
        else if (input.frequency === 'irregular') { if (i === 0) { issues.push(`First reading (${fmtDate(r.t, tz)}) has no start time: not counted`); prevTo = r.t; continue; } from = rs[i - 1]!.t; }
        else from = r.t - NOMINAL[input.frequency];
      }
      if (from < prevTo - 1000) {
        note(r.t, `overlapping readings around ${fmtDate(r.t, tz)}: the overlap is counted once`);
        from = Math.max(from, prevTo);
      }
      if (r.v < 0) note(r.t, `negative value at ${fmtDate(r.t, tz)}`);
      if (from < r.t) segs.push({ from, to: r.t, v: r.v * mult });
      prevTo = Math.max(prevTo, r.t);
    }
  } else {
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1]!, b = rs[i]!;
      let d = (b.v - a.v) * mult;
      if (d < 0) {
        if (input.rollover) {
          d = (b.v + input.rollover - a.v) * mult;
          note(b.t, `register rolled over at ${fmtDate(b.t, tz)}`);
        } else {
          note(b.t, `register went down at ${fmtDate(b.t, tz)} (reset or meter changed): ${fmtDate(a.t, tz)} – ${fmtDate(b.t, tz)} not counted`);
          continue;
        }
      }
      const nominal = NOMINAL[input.frequency];
      if (nominal && b.t - a.t > 2.5 * nominal) {
        note(b.t, `no readings ${fmtDate(a.t, tz)} – ${fmtDate(b.t, tz)}: consumption spread evenly over the gap`);
      }
      segs.push({ from: a.t, to: b.t, v: d });
    }
    if (rs.length === 1) issues.push('Only one register reading: consumption needs at least two');
  }

  // Unusual values: rate more than 10× the median rate.
  if (segs.length >= 10) {
    const rates = segs.map((s) => s.v / (s.to - s.from)).filter((x) => x > 0).sort((a, b) => a - b);
    const med = rates[Math.floor(rates.length / 2)] ?? 0;
    for (const s of segs) {
      if (med > 0 && s.v / (s.to - s.from) > 10 * med) note(s.to, `unusually high value ending ${fmtDate(s.to, tz)} (over 10× the usual rate)`);
    }
  }

  if (!segs.length) return { months: [], issues };
  const first = localMonth(segs[0]!.from, tz);
  const last = localMonth(Math.max(...segs.map((s) => s.to)) - 1, tz);
  const months: MeterMonth[] = [];
  for (let y = first.y, m = first.m; y < last.y || (y === last.y && m <= last.m); m === 11 ? (y++, m = 0) : m++) {
    const start = monthStart(y, m, tz), end = monthStart(y, m + 1, tz);
    let measured = 0, covered = 0, readings = 0;
    const iss: string[] = [];
    for (const s of segs) {
      const o = Math.min(s.to, end) - Math.max(s.from, start);
      if (o <= 0) continue;
      measured += s.v * (o / (s.to - s.from));
      covered += o;
      if (s.to > start && s.to <= end) readings++;
    }
    for (const n of noteList) if (n.t > start && n.t <= end) iss.push(n.text);
    const coverage = Math.min(1, covered / (end - start));
    const full = coverage >= 0.999;
    // Scaling up needs at least a quarter of the month; below that the measured part is used as it is.
    const filled = !full && coverage >= MIN_SCALE && input.gapFill !== 'none';
    if (!full && coverage > 0) {
      iss.push(`readings cover ${(coverage * 100).toFixed(1)}% of the month${filled ? ': scaled up to the whole month (estimated)'
        : input.gapFill !== 'none' ? ': too little to scale up — only the measured part is counted' : ''}`);
    }
    months.push({ month: label(y, m), start, end, measured, consumption: filled ? measured / coverage : measured, coverage: full ? 1 : coverage, readings, filled, closed: end <= now, issues: [...new Set(iss)] });
  }
  return { months, issues };
}
