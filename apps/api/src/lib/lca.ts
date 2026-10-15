/**
 * Product footprint arithmetic (ISO 14067 / GHG Protocol Product Standard).
 *
 * Inputs are amounts per declared unit; each line is qty × kg CO2e per unit. Lines in stages outside the
 * system boundary (use and end of life for cradle-to-gate; everything but manufacturing and packaging for
 * gate-to-gate) are kept in the model but not counted. Data quality is the emissions-weighted mean of
 * Verified 1 · Measured 0.9 · Supplier-specific 0.8 · Estimated 0.5.
 */
export const STAGES: Record<string, string> = { raw: 'Raw materials', packaging: 'Packaging', manufacturing: 'Manufacturing', transport: 'Transport', use: 'Use', eol: 'End of life' };
export const STAGE_KEYS = Object.keys(STAGES) as (keyof typeof STAGES)[];
export const BOUNDARIES: Record<string, string> = { cradle_to_gate: 'Cradle-to-gate', cradle_to_grave: 'Cradle-to-grave', gate_to_gate: 'Gate-to-gate' };
export const DQ: Record<string, number> = { verified: 1, measured: 0.9, supplier: 0.8, estimated: 0.5 };
export const DQ_LABEL: Record<string, string> = { verified: 'Verified', measured: 'Measured', supplier: 'Supplier-specific', estimated: 'Estimated' };

export function inBoundary(stage: string, boundary: string) {
  if (boundary === 'cradle_to_grave') return true;
  if (boundary === 'gate_to_gate') return stage === 'manufacturing' || stage === 'packaging';
  return stage !== 'use' && stage !== 'eol';
}

export interface Line { id: string; name: string; stage: string; qty: number; unit: string; co2e_per_unit: number; dq: string; lci_id?: string | null; source?: string }
export interface Result { total: number; stages: Record<string, number>; dq: number | null; excluded: number; lines: (Line & { kg: number; counted: boolean; share: number })[] }

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function footprint(lines: Line[], boundary: string): Result {
  const stages = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])) as Record<string, number>;
  let total = 0, excluded = 0, dqw = 0;
  const out = lines.map((l) => {
    const kg = Number(l.qty) * Number(l.co2e_per_unit);
    const counted = inBoundary(l.stage, boundary);
    if (counted) { total += kg; stages[l.stage] = (stages[l.stage] ?? 0) + kg; dqw += kg * (DQ[l.dq] ?? 0.5); } else excluded += kg;
    return { ...l, qty: Number(l.qty), co2e_per_unit: Number(l.co2e_per_unit), kg: r6(kg), counted, share: 0 };
  });
  for (const l of out) l.share = total > 0 && l.counted ? l.kg / total : 0;
  for (const k of STAGE_KEYS) stages[k] = r6(stages[k] ?? 0);
  return { total: r6(total), stages, dq: total > 0 ? Math.round((dqw / total) * 1000) / 1000 : null, excluded: r6(excluded), lines: out };
}

export interface Change { inputId: string; lciId?: string | null; qty?: number | null; co2e?: number | null }

/** The model with a scenario's changes applied (another library factor, another amount, another factor). */
export function applyScenario(lines: Line[], changes: Change[], lib: Map<string, { name: string; co2e: number; unit: string }>): Line[] {
  const by = new Map(changes.map((c) => [c.inputId, c]));
  return lines.map((l) => {
    const c = by.get(l.id);
    if (!c) return l;
    const f = c.lciId ? lib.get(c.lciId) : undefined;
    return {
      ...l,
      name: f ? f.name : l.name,
      lci_id: f ? c.lciId : l.lci_id,
      co2e_per_unit: c.co2e != null ? c.co2e : f ? f.co2e : l.co2e_per_unit,
      qty: c.qty != null ? c.qty : l.qty,
    };
  });
}

/** The material family of a factor: its first word (Steel, Aluminium, HDPE, Electricity…). */
const family = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] ?? '';

/** Ecodesign levers: for each counted line, the lowest like-for-like library factor (same stage, unit and family), if lower. */
export function levers(res: Result, lib: { id: string; name: string; co2e: number; unit: string; stage: string }[]) {
  const byId = new Map(lib.map((f) => [f.id, f]));
  const out: { inputId: string; input: string; to: string; toId: string; saves: number; pct: number }[] = [];
  for (const l of res.lines) {
    if (!l.counted || l.kg <= 0) continue;
    const fam = family(l.lci_id && byId.get(l.lci_id) ? byId.get(l.lci_id)!.name : l.name);
    const alt = lib.filter((f) => f.stage === l.stage && normUnit(f.unit) === normUnit(l.unit) && f.id !== l.lci_id && f.co2e < l.co2e_per_unit && family(f.name) === fam)
      .sort((a, b) => a.co2e - b.co2e)[0];
    if (!alt) continue;
    const saves = l.kg - l.qty * alt.co2e;
    if (saves <= 0) continue;
    out.push({ inputId: l.id, input: l.name, to: alt.name, toId: alt.id, saves: r6(saves), pct: res.total > 0 ? saves / res.total : 0 });
  }
  return out.sort((a, b) => b.saves - a.saves).slice(0, 5);
}

/** Words of a name, for matching an imported line to the library. */
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1));

/** Ties go to the higher factor (conservative when the name does not say which, e.g. virgin or recycled). */
export function matchLibrary<T extends { name: string; code: string; stage: string; unit: string; co2e?: number }>(name: string, stage: string | null, unit: string, lib: T[]): T | undefined {
  const n = name.trim().toLowerCase();
  const exact = lib.find((f) => f.code.toLowerCase() === n || f.name.toLowerCase() === n);
  if (exact) return exact;
  const w = words(name);
  let best: T | undefined, score = 0;
  for (const f of lib) {
    const fw = words(f.name.replace(/\(.*?\)/g, ''));
    let hit = 0;
    for (const x of w) if (fw.has(x)) hit++;
    if (!hit) continue;
    if (hit / Math.max(w.size, 1) < 0.5) continue;
    const s = hit / Math.max(fw.size, 1) + hit / Math.max(w.size, 1) + (stage && f.stage === stage ? 0.3 : 0) + (normUnit(f.unit) === normUnit(unit) ? 0.3 : 0);
    if (s > score + 1e-9 || (Math.abs(s - score) <= 1e-9 && best && (f.co2e ?? 0) > (best.co2e ?? 0))) { score = s; best = f; }
  }
  return score >= 1.2 ? best : undefined;
}

export function normUnit(u: string) {
  const x = u.trim().toLowerCase().replace(/\s+/g, '');
  if (['l', 'litre', 'litres', 'liter', 'liters', 'ltr'].includes(x)) return 'litre';
  if (['m3', 'm³', 'cbm'].includes(x)) return 'm³';
  if (['tkm', 't-km', 't.km', 'tonne-km', 'tonnekm'].includes(x)) return 't-km';
  if (['unit', 'units', 'pcs', 'pc', 'piece', 'pieces', 'each', 'ea', 'nos'].includes(x)) return 'unit';
  if (['kwh'].includes(x)) return 'kWh';
  if (['kg', 'kgs', 'kilogram', 'kilograms'].includes(x)) return 'kg';
  if (['t', 'tonne', 'tonnes', 'ton'].includes(x)) return 't';
  return u.trim();
}

export function stageOf(s: string): string | null {
  const x = s.trim().toLowerCase();
  if (!x) return null;
  for (const [k, v] of Object.entries(STAGES)) if (x === k || x === v.toLowerCase()) return k;
  if (/raw|material|bom/.test(x)) return 'raw';
  if (/pack/.test(x)) return 'packaging';
  if (/manuf|energy|process|production/.test(x)) return 'manufacturing';
  if (/transp|freight|logist|distrib/.test(x)) return 'transport';
  if (/use/.test(x)) return 'use';
  if (/end|eol|disposal|waste/.test(x)) return 'eol';
  return null;
}
