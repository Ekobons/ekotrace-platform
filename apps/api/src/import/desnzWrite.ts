/**
 * Writes a parsed DESNZ edition into the catalogue and factor tables.
 *
 *  - Items are matched by a stable code ("desnz:diesel-100-mineral-diesel"),
 *    so re-importing a year, or importing the next year, reuses the same items.
 *    Names that differ only in letter case between editions are one item.
 *  - Every factor is valid 1 Jan – 31 Dec of the edition year, region GLOBAL.
 *  - Re-importing the same file does nothing. Importing a corrected file for a
 *    year already loaded keeps the old factors as "superseded" (history) and
 *    links each new factor to the one it replaces.
 *  - Anything unexpected is written to import_issue for the admin to review.
 */
import type { Tx } from '../db/pool.js';
import { DESNZ_UNIT, slug, type DesnzParsed } from './desnz.js';

/** Raise when the importer learns to read more of the file: editions already loaded are read again once. */
export const IMPORTER_VERSION = 3;

export interface ImportSummary {
  source: string;
  skipped: boolean;
  items: number;
  factors: number;
  issues: number;
}

const CLASS_TO_SUB: Record<string, string> = {
  'Liquid fuels': 'liquid_fuels', 'Solid fuels': 'solid_fuels', 'Gaseous fuels': 'gaseous_fuels',
  Biofuel: 'biofuel', Biomass: 'biomass', Biogas: 'biogas',
};

/** Default entry unit for particular fuels (otherwise the subcategory default). */
const FUEL_DEFAULT_UNIT: Record<string, string> = {
  lpg: 'kg', butane: 'kg', propane: 'kg', cng: 'kg', lng: 'kg', 'other-petroleum-gas': 'kg', biopropane: 'kg',
  'natural-gas': 'm3', 'natural-gas-100-mineral-blend': 'm3',
};
/** First in the list: UAE has no biofuel blending mandate, so 100 % mineral is the default choice. */
const FUEL_SORT: Record<string, number> = { 'diesel-100-mineral-diesel': 1, 'petrol-100-mineral-petrol': 2, 'natural-gas': 1, lpg: 2 };
/** Names used by the old Ekotrace, kept as aliases so old data maps automatically. */
const OLD_NAMES: Record<string, string[]> = {
  'diesel-100-mineral-diesel': ['Diesel'], 'petrol-100-mineral-petrol': ['Petrol'], 'fuel-oil': ['Furnace Oil (Fuel Oil)', 'Furnace oil'],
  'gas-oil': ['Gasoil'], 'burning-oil': ['Kerosene Oil (Burning Oil)', 'Kerosene'], 'natural-gas': ['Natural Gas'],
  'development-diesel': ['Renewable diesel'], 'development-petrol': ['Renewable petrol'], 'biomethane-compressed': ['Biomethane(compressed)'],
  'coal-domestic': ['Domestic coal'],
};

const SUB_FOR_GAS_FAMILY = (family: string, code: string): string =>
  ['HFC', 'PFC'].includes(family) ? 'hfc_pfc'
  : ['SF6', 'NF3'].includes(family) || code === 'SF5CF3' ? 'sf6_nf3'
  : ['CFC', 'HCFC', 'Halon'].includes(family) || ['CCl4', 'CH3Br', 'CH3CCl3'].includes(code) ? 'ozone_depleting'
  : 'other_gases';

export async function importDesnz(c: Tx, p: DesnzParsed, opts: { createdBy?: string } = {}): Promise<ImportSummary> {
  const code = `DESNZ-${p.year}`;
  const existing = (await c.query('SELECT id, file_sha256, importer_version FROM factor_source WHERE code = $1', [code])).rows[0];
  if (existing?.file_sha256 === p.sha256 && existing.importer_version >= IMPORTER_VERSION) return { source: code, skipped: true, items: 0, factors: 0, issues: 0 };

  const sourceId: number = existing
    ? (await c.query('UPDATE factor_source SET version=$2, gwp_set=$3, file_sha256=$4, importer_version=$5, imported_at=now() WHERE id=$1 RETURNING id', [existing.id, p.version, p.gwpSet, p.sha256, IMPORTER_VERSION])).rows[0].id
    : (await c.query(
        `INSERT INTO factor_source (code, publisher, title, year, version, gwp_set, url, licence, file_sha256, importer_version)
         VALUES ($1,'UK Department for Energy Security and Net Zero (DESNZ)',$2,$3,$4,$5,$6,'Open Government Licence v3.0',$7,$8) RETURNING id`,
        [code, `Greenhouse gas reporting: conversion factors ${p.year}`, p.year, p.version, p.gwpSet,
         `https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-${p.year}`, p.sha256, IMPORTER_VERSION],
      )).rows[0].id;

  const issues: { severity: string; message: string; detail?: unknown }[] = [];
  const subId = new Map<string, number>((await c.query('SELECT code, id FROM subcategory')).rows.map((r) => [r.code, r.id]));
  const gwp = new Map<string, number>((await c.query('SELECT gas, value FROM gwp_value WHERE gwp_set = $1', [p.gwpSet])).rows.map((r) => [r.gas, r.value]));
  const gasRows = (await c.query('SELECT code, family, name FROM gas')).rows as { code: string; family: string; name: string }[];

  // Previous active factors of this source, with their values: an unchanged factor is
  // kept as it is; a changed one is superseded (kept as history) and linked to its successor.
  const previous = new Map<string, { id: number; co2e: number | null; gases: Map<string, number> }>();
  if (existing) {
    const old = await c.query(
      `SELECT f.id, f.item_id, f.unit, f.basis, f.region, f.co2e,
              COALESCE((SELECT json_object_agg(g.gas, g.kg_per_unit) FROM factor_gas g WHERE g.factor_id = f.id), '{}') AS gases
         FROM factor f WHERE f.source_id = $1 AND f.status = 'active'`, [sourceId]);
    for (const r of old.rows) {
      previous.set(`${r.item_id}|${r.unit}|${r.basis}|${r.region}`, { id: r.id, co2e: r.co2e == null ? null : Number(r.co2e), gases: new Map(Object.entries(r.gases).map(([k, v]) => [k, Number(v)])) });
    }
  }
  const same = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a)));

  // ---- items ----------------------------------------------------------------
  const itemIds = new Map<string, number>();
  async function upsertItem(itemCode: string, sub: string, name: string, extra: { defaultUnit?: string | null; gas?: string | null; aliases?: string[]; sort?: number; note?: string } = {}) {
    const sid = subId.get(sub);
    if (!sid) throw new Error(`Subcategory ${sub} missing — run migrations first`);
    const r = await c.query(
      `INSERT INTO item (subcategory_id, code, name, default_unit, gas_code, aliases, sort, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
         aliases = COALESCE((SELECT array_agg(DISTINCT a) FROM unnest(item.aliases || EXCLUDED.aliases) a), '{}')
       RETURNING id, (xmax = 0) AS inserted`,
      [sid, itemCode, name, extra.defaultUnit ?? null, extra.gas ?? null, extra.aliases ?? [], extra.sort ?? 100, extra.note ?? null],
    );
    itemIds.set(itemCode, r.rows[0].id);
    return r.rows[0].id as number;
  }

  // ---- factors (collected, then inserted in bulk) ------------------------------
  const factors: { item: number; basis: string; unit: string; co2e: number | null; gases: [string, number][] }[] = [];

  const fuelNames = new Map<string, string>(); // slug → display name (this edition's spelling)
  for (const r of p.fuels) fuelNames.set(slug(r.fuel), fuelNames.get(slug(r.fuel)) ?? r.fuel);

  for (const r of p.fuels) {
    const s = slug(r.fuel);
    const sub = CLASS_TO_SUB[r.cls]!;
    const itemCode = `desnz:${s}`;
    const item = itemIds.get(itemCode) ?? (await upsertItem(itemCode, sub, fuelNames.get(s)!, {
      defaultUnit: FUEL_DEFAULT_UNIT[s] ?? null, aliases: OLD_NAMES[s] ?? [], sort: FUEL_SORT[s] ?? 100,
    }));
    const unit = DESNZ_UNIT[r.uom];
    if (!unit) { issues.push({ severity: 'warning', message: `Unit "${r.uom}" not recognised; row skipped`, detail: r }); continue; }

    if (r.basis === 'outside_scopes') {
      if (r.co2e != null) factors.push({ item, basis: r.basis, unit, co2e: r.co2e, gases: [['CO2_biogenic', r.co2e]] });
      continue;
    }
    const split: [string, number][] = [];
    if (r.basis === 'direct' && r.gasCo2e.CO2 != null) {
      const fossil = !['Biofuel', 'Biomass', 'Biogas'].includes(r.cls);
      const ch4 = fossil ? 'CH4_fossil' : 'CH4';
      split.push(['CO2', r.gasCo2e.CO2]);
      if (r.gasCo2e.CH4 != null) split.push([ch4, r.gasCo2e.CH4 / gwp.get(ch4)!]);
      if (r.gasCo2e.N2O != null) split.push(['N2O', r.gasCo2e.N2O / gwp.get('N2O')!]);
      const sum = (r.gasCo2e.CO2 ?? 0) + (r.gasCo2e.CH4 ?? 0) + (r.gasCo2e.N2O ?? 0);
      if (r.co2e != null && r.co2e > 0 && Math.abs(sum - r.co2e) / r.co2e > 0.005) {
        issues.push({ severity: 'warning', message: `${r.fuel} per ${unit}: gases add up to ${sum.toPrecision(6)} but the published total is ${r.co2e.toPrecision(6)}`, detail: r });
      }
    }
    if (r.co2e == null && !split.length) continue;
    factors.push({ item, basis: r.basis, unit, co2e: r.co2e, gases: split });
  }

  // Gases and refrigerant blends (fugitive). Pure gases need no factor rows:
  // their GWP comes from the gas table in whichever set the client uses.
  const blendComp = new Map<string, number>(
    (await c.query(`SELECT i.code, count(*)::int n FROM item i JOIN item_gas g ON g.item_id = i.id GROUP BY i.code`)).rows.map((r) => [r.code, r.n]),
  );
  const byDesnzName = new Map((await c.query('SELECT code, unnest(aliases) AS desnz_name FROM gas')).rows.map((r) => [r.desnz_name, r.code as string]));
  for (const g of p.gases) {
    if (g.group === 'Blends') {
      const itemCode = `blend:${slug(g.name)}`;
      const item = itemIds.get(itemCode) ?? (await upsertItem(itemCode, 'refrigerant_blends', g.name.replace(/^R(\d)/, 'R-$1'), { defaultUnit: 'kg' }));
      if (blendComp.get(itemCode)) continue; // composition known → calculated per gas
      if (g.kyoto != null) factors.push({ item, basis: 'direct', unit: 'kg', co2e: g.kyoto, gases: [] });
      if (g.nonKyoto != null) factors.push({ item, basis: 'memo', unit: 'kg', co2e: g.nonKyoto, gases: [] });
      continue;
    }
    const gasCode = byDesnzName.get(g.name);
    if (!gasCode) {
      if (g.total != null) issues.push({ severity: 'info', message: `Gas "${g.name}" (${g.group}) is not in the gas table yet; not imported` });
      continue;
    }
    const meta = gasRows.find((x) => x.code === gasCode)!;
    const itemCode = `gas:${slug(gasCode)}`;
    if (!itemIds.has(itemCode)) await upsertItem(itemCode, SUB_FOR_GAS_FAMILY(meta.family, gasCode), meta.name, { defaultUnit: 'kg', gas: gasCode });
    // Sanity check: the DESNZ GWP should equal our table's value for the same set.
    const ours = gwp.get(gasCode);
    if (g.total != null && ours != null && Math.abs(ours - g.total) > Math.max(0.5, ours * 0.002)) {
      issues.push({ severity: 'warning', message: `${meta.name}: DESNZ ${p.year} GWP ${g.total} differs from the ${p.gwpSet} table value ${ours}` });
    }
  }

  // ---- road vehicles (per km / mile), EV electricity use, UK grid ----------------
  let order = 0;
  for (const r of p.vehicles) {
    if (r.basis === 'wtt' && r.variant === 'Battery Electric Vehicle') continue; // upstream of UK grid only; not applicable elsewhere
    const v = vehicleItem(r.group, r.vehicle, r.variant);
    // "Average laden" first in the list: what most companies know about their trucks.
    const item = itemIds.get(v.code) ?? (await upsertVehicleItem(v, (/^Average laden$/i.test(r.variant) ? 0 : 10000) + order++));
    const split: [string, number][] = [];
    if (r.basis === 'direct' && r.gasCo2e.CO2 != null) {
      split.push(['CO2', r.gasCo2e.CO2]);
      if (r.gasCo2e.CH4 != null) split.push(['CH4_fossil', r.gasCo2e.CH4 / gwp.get('CH4_fossil')!]);
      if (r.gasCo2e.N2O != null) split.push(['N2O', r.gasCo2e.N2O / gwp.get('N2O')!]);
    }
    factors.push({ item, basis: r.basis, unit: r.unit, co2e: r.co2e, gases: split });
  }
  async function upsertVehicleItem(v: ReturnType<typeof vehicleItem>, sort: number) {
    const id = await upsertItem(v.code, v.sub, v.name, { defaultUnit: 'km', sort });
    await c.query('UPDATE item SET attrs = $2, sort = $3 WHERE id = $1', [id, JSON.stringify(v.attrs), sort]);
    return id;
  }
  const vf0 = `${p.year}-01-01`, vt0 = `${p.year}-12-31`;
  if (existing) await c.query(`UPDATE vehicle_energy SET status = 'superseded' WHERE source_id = $1 AND status = 'active'`, [sourceId]);
  let evRows = 0;
  for (const e of p.evEnergy) {
    const v = vehicleItem(e.group, e.vehicle, e.variant);
    const item = itemIds.get(v.code) ?? (await upsertVehicleItem(v, order++));
    await c.query(
      `INSERT INTO vehicle_energy (item_id, source_id, unit, kwh_per_unit, valid_from, valid_to) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (item_id, unit, valid_from) WHERE status = 'active' DO UPDATE SET kwh_per_unit = EXCLUDED.kwh_per_unit, source_id = EXCLUDED.source_id`,
      [item, sourceId, e.unit, e.kwh, vf0, vt0]);
    evRows++;
  }
  if (evRows) issues.push({ severity: 'info', message: `${evRows} electricity-use values (kWh per km/mile) for electric and plug-in hybrid vehicles loaded` });
  const gridItem = (await c.query(`SELECT id FROM item WHERE code = 'grid:electricity'`)).rows[0]?.id as number | undefined;
  const ukGridRows: typeof factors = [];
  if (gridItem && p.ukGrid?.co2e != null) {
    const g = p.ukGrid.gasCo2e;
    const split: [string, number][] = g.CO2 != null ? [['CO2', g.CO2], ...(g.CH4 != null ? [['CH4_fossil', g.CH4 / gwp.get('CH4_fossil')!] as [string, number]] : []), ...(g.N2O != null ? [['N2O', g.N2O / gwp.get('N2O')!] as [string, number]] : [])] : [];
    ukGridRows.push({ item: gridItem, basis: 'scope2', unit: 'kWh_e', co2e: p.ukGrid.co2e, gases: split });
  }

  // ---- bulk insert factors + gas split ------------------------------------------
  const vf = `${p.year}-01-01`, vt = `${p.year}-12-31`;
  let inserted = 0;
  const kept = new Set<number>();
  for (const f of [...factors.map((x) => ({ ...x, region: 'GLOBAL' })), ...ukGridRows.map((x) => ({ ...x, region: 'GB' }))]) {
    const old = previous.get(`${f.item}|${f.unit}|${f.basis}|${f.region}`);
    if (old && same(old.co2e, f.co2e) && old.gases.size === f.gases.length && f.gases.every(([g, v]) => same(old.gases.get(g) ?? null, v))) {
      kept.add(old.id);
      continue;
    }
    const prev = old?.id ?? null;
    if (prev) await c.query(`UPDATE factor SET status = 'superseded' WHERE id = $1`, [prev]);
    const r = await c.query(
      `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, version, supersedes_id, created_by)
       VALUES ($1,$2,$10,$3,$4,$5,$6,$7, COALESCE((SELECT version + 1 FROM factor WHERE id = $8), 1), $8, $9) RETURNING id`,
      [f.item, sourceId, f.basis, f.unit, f.co2e, vf, vt, prev, opts.createdBy ?? 'import', f.region],
    );
    if (f.gases.length) {
      await c.query(
        'INSERT INTO factor_gas (factor_id, gas, kg_per_unit) SELECT $1, * FROM unnest($2::text[], $3::numeric[])',
        [r.rows[0].id, f.gases.map((g) => g[0]), f.gases.map((g) => g[1])],
      );
    }
    inserted++;
  }
  // Factors of the previous import that the new file no longer contains.
  const gone = [...previous.values()].filter((o) => !kept.has(o.id)).map((o) => o.id);
  if (gone.length) await c.query(`UPDATE factor SET status = 'superseded' WHERE id = ANY($1) AND status = 'active'`, [gone]);
  for (const i of issues) {
    await c.query('INSERT INTO import_issue (source_id, severity, message, detail) VALUES ($1,$2,$3,$4)', [sourceId, i.severity, i.message, i.detail ? JSON.stringify(i.detail) : null]);
  }
  await c.query("SELECT pg_notify('refdata_changed', $1)", [code]);
  return { source: code, skipped: false, items: itemIds.size, factors: inserted, issues: issues.length };
}

// ---------------------------------------------------------------- vehicles --
const POWERTRAIN: Record<string, { label: string; key: string; fuel: string | null; electric?: boolean; phev?: boolean }> = {
  Diesel: { label: 'Diesel', key: 'Diesel', fuel: 'desnz:diesel-100-mineral-diesel' },
  Petrol: { label: 'Petrol', key: 'Petrol', fuel: 'desnz:petrol-100-mineral-petrol' },
  Hybrid: { label: 'Hybrid (HEV, petrol)', key: 'Hybrid', fuel: 'desnz:petrol-100-mineral-petrol' },
  CNG: { label: 'CNG', key: 'CNG', fuel: 'desnz:cng' },
  LPG: { label: 'LPG', key: 'LPG', fuel: 'desnz:lpg' },
  Unknown: { label: 'Fuel unknown', key: 'Unknown', fuel: null },
  'Plug-in Hybrid Electric Vehicle': { label: 'Plug-in hybrid (PHEV)', key: 'PHEV', fuel: 'desnz:petrol-100-mineral-petrol', phev: true },
  'Battery Electric Vehicle': { label: 'Electric (BEV)', key: 'BEV', fuel: null, electric: true },
};

/** Catalogue item for a DESNZ vehicle row: class × powertrain (cars, vans) or class × load (HGV). */
export function vehicleItem(group: string, vehicleName: string, variant: string) {
  // 2026 renamed "All HGVs / rigids / artics" to "Average (non-)refrigerated HGVs / rigids / artics".
  const m = /^Average (?:non-)?refrigerated (HGVs|rigids|artics)$/i.exec(vehicleName);
  const vehicle = m ? `All ${m[1]}` : vehicleName;
  const code = `veh:${group}:${slug(vehicle)}:${slug(variant || 'any')}`;
  if (group === 'hgv' || group === 'hgv_refrigerated') {
    return { code, sub: group, name: `${group === 'hgv_refrigerated' ? 'Refrigerated ' : ''}${vehicle} · ${variant}`,
      attrs: { vehicle, load: variant, powertrain: 'Diesel', fuel: 'desnz:diesel-100-mineral-diesel', distance: true, refrigerated: group === 'hgv_refrigerated' } };
  }
  if (group === 'motorbikes') {
    return { code, sub: group, name: `Motorbike · ${vehicle}`, attrs: { vehicle: `Motorbike (${vehicle})`, powertrain: 'Petrol', fuel: 'desnz:petrol-100-mineral-petrol', distance: true } };
  }
  const pt = POWERTRAIN[variant] ?? { label: variant, key: variant, fuel: null };
  const name = `${group === 'vans' ? `Van ${vehicle}` : vehicle} · ${pt.label}`;
  return { code, sub: group, name,
    attrs: { vehicle, powertrain: pt.key, fuel: pt.fuel, distance: true, ...(pt.electric ? { electric: true } : {}), ...(pt.phev ? { phev: true } : {}) } };
}
