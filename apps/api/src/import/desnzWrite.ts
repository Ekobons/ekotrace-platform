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
  const existing = (await c.query('SELECT id, file_sha256 FROM factor_source WHERE code = $1', [code])).rows[0];
  if (existing?.file_sha256 === p.sha256) return { source: code, skipped: true, items: 0, factors: 0, issues: 0 };

  const sourceId: number = existing
    ? (await c.query('UPDATE factor_source SET version=$2, gwp_set=$3, file_sha256=$4, imported_at=now() WHERE id=$1 RETURNING id', [existing.id, p.version, p.gwpSet, p.sha256])).rows[0].id
    : (await c.query(
        `INSERT INTO factor_source (code, publisher, title, year, version, gwp_set, url, licence, file_sha256)
         VALUES ($1,'UK Department for Energy Security and Net Zero (DESNZ)',$2,$3,$4,$5,$6,'Open Government Licence v3.0',$7) RETURNING id`,
        [code, `Greenhouse gas reporting: conversion factors ${p.year}`, p.year, p.version, p.gwpSet,
         `https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-${p.year}`, p.sha256],
      )).rows[0].id;

  const issues: { severity: string; message: string; detail?: unknown }[] = [];
  const subId = new Map<string, number>((await c.query('SELECT code, id FROM subcategory')).rows.map((r) => [r.code, r.id]));
  const gwp = new Map<string, number>((await c.query('SELECT gas, value FROM gwp_value WHERE gwp_set = $1', [p.gwpSet])).rows.map((r) => [r.gas, r.value]));
  const gasRows = (await c.query('SELECT code, family, name FROM gas')).rows as { code: string; family: string; name: string }[];

  // Previous active factors of this source → superseded, remembered for linking.
  const previous = new Map<string, number>();
  if (existing) {
    const old = await c.query(`UPDATE factor SET status = 'superseded' WHERE source_id = $1 AND status = 'active' RETURNING id, item_id, unit, basis, region`, [sourceId]);
    for (const r of old.rows) previous.set(`${r.item_id}|${r.unit}|${r.basis}|${r.region}`, r.id);
  }

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

  // ---- bulk insert factors + gas split ------------------------------------------
  const vf = `${p.year}-01-01`, vt = `${p.year}-12-31`;
  let inserted = 0;
  for (const f of factors) {
    const prev = previous.get(`${f.item}|${f.unit}|${f.basis}|GLOBAL`) ?? null;
    const r = await c.query(
      `INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, version, supersedes_id, created_by)
       VALUES ($1,$2,'GLOBAL',$3,$4,$5,$6,$7, COALESCE((SELECT version + 1 FROM factor WHERE id = $8), 1), $8, $9) RETURNING id`,
      [f.item, sourceId, f.basis, f.unit, f.co2e, vf, vt, prev, opts.createdBy ?? 'import'],
    );
    if (f.gases.length) {
      await c.query(
        'INSERT INTO factor_gas (factor_id, gas, kg_per_unit) SELECT $1, * FROM unnest($2::text[], $3::numeric[])',
        [r.rows[0].id, f.gases.map((g) => g[0]), f.gases.map((g) => g[1])],
      );
    }
    inserted++;
  }
  for (const i of issues) {
    await c.query('INSERT INTO import_issue (source_id, severity, message, detail) VALUES ($1,$2,$3,$4)', [sourceId, i.severity, i.message, i.detail ? JSON.stringify(i.detail) : null]);
  }
  await c.query("SELECT pg_notify('refdata_changed', $1)", [code]);
  return { source: code, skipped: false, items: itemIds.size, factors: inserted, issues: issues.length };
}
