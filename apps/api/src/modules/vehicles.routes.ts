/**
 * Fleet register: the vehicles of each facility.
 *
 *  - Add, edit, retire (with a date) and reinstate vehicles; delete only a vehicle
 *    with no entries (otherwise retire it, so past entries keep their vehicle).
 *  - Data entry lists the vehicles in service during the month entered.
 *  - Excel: download a template (with the list of vehicle types), upload the
 *    fleet — preview first, then add.
 *
 * Managed by Super admin, Admin (own sub-group), Manager (own facilities);
 * everyone who can see the facility can see its fleet.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { query, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { readSheet, sendWorkbook, styleHeader, toIsoDate } from '../lib/xlsx.js';
import { runBatch, tenantSettings, type SaveInput } from './activity.routes.js';
import { matchVehicleType, splitQuantity } from '../lib/vehicleMatch.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format yyyy-mm-dd');
const METHODS = ['distance', 'fuel', 'electricity', 'spend'] as const;

const vehicleBody = z.object({
  name: z.string().trim().min(1).max(120),
  registration: z.string().trim().max(40).optional().nullable(),
  itemId: z.number().int().positive(),
  fuelItemId: z.number().int().positive().optional().nullable(),
  ownership: z.enum(['owned', 'leased']).default('owned'),
  charging: z.enum(['site', 'elsewhere']).optional().nullable(),
  defaultMethod: z.enum(METHODS).default('distance'),
  inServiceFrom: isoDate,
  note: z.string().max(500).optional().nullable(),
});

interface VehicleType { id: number; name: string; code: string; sub: string; grp: string | null; attrs: { electric?: boolean; phev?: boolean; distance?: boolean; fuel?: string | null } }

async function vehicleTypes(): Promise<VehicleType[]> {
  return query<VehicleType>(
    `SELECT i.id, i.name, i.code, s.name AS sub, s.grp, i.attrs FROM item i
       JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
      WHERE c.code = 'mobile_combustion' AND i.active AND s.active ORDER BY s.sort, i.sort, i.name`);
}

/** Checks a vehicle against its type: electric vehicles need no fuel, charging only for plug-ins, distance only where factors exist. */
function checkVehicle(t: VehicleType, b: z.infer<typeof vehicleBody>) {
  const plug = t.attrs.electric || t.attrs.phev;
  if (!plug && b.charging) b.charging = null;
  if (plug && !b.charging) b.charging = 'elsewhere';
  if (t.attrs.electric && b.fuelItemId) throw new AppError(`${t.name} is electric and uses no fuel`);
  if (t.attrs.electric && b.defaultMethod === 'fuel') b.defaultMethod = 'electricity';
  if (!t.attrs.electric && b.defaultMethod === 'electricity') throw new AppError(`${t.name} is not electric: choose distance, fuel or spend`);
  if (t.attrs.distance === false && b.defaultMethod === 'distance') b.defaultMethod = 'fuel';
}

async function facilityFor(c: Tx, req: FastifyRequest, facilityId: string, manage: boolean) {
  const f = (await c.query(`SELECT id, name FROM org_node WHERE id = $1 AND kind = 'facility'`, [facilityId])).rows[0];
  if (!f) throw notFound('Facility');
  const scope = await scopeOf(c, req.user);
  assertCan(manage ? scope.enter : scope.see, f.id, manage ? 'manage the fleet of this facility' : 'see this facility');
  return f as { id: string; name: string };
}

const SELECT_VEHICLE = `
  SELECT v.id, v.facility_id, v.name, v.registration, v.item_id, i.name AS type, s.name AS class, s.grp, i.attrs,
         v.fuel_item_id, fi.name AS fuel, v.ownership, v.charging, v.default_method,
         v.in_service_from::text, v.retired_on::text, v.retired_reason, v.note,
         (SELECT count(*)::int FROM activity a WHERE a.vehicle_id = v.id) AS entries
    FROM vehicle v JOIN item i ON i.id = v.item_id JOIN subcategory s ON s.id = i.subcategory_id
    LEFT JOIN item fi ON fi.id = v.fuel_item_id`;

export async function vehicleRoutes(app: FastifyInstance) {
  /** Vehicle types for pickers, grouped as Passenger vehicles / Delivery vehicles / Off-road machinery. */
  app.get('/api/vehicle-types', async () => ({ types: await vehicleTypes() }));

  /**
   * Fleet of a facility. With from/to: only vehicles in service at some point in
   * that period (for data entry). Otherwise all, retired included.
   */
  app.get('/api/facilities/:id/vehicles', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const q = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      await facilityFor(c, req, id, false);
      const rows = (await c.query(
        `${SELECT_VEHICLE}
          WHERE v.facility_id = $1
            AND ($2::date IS NULL OR v.retired_on IS NULL OR v.retired_on >= $2::date)
            AND ($3::date IS NULL OR v.in_service_from <= $3::date)
          ORDER BY (v.retired_on IS NOT NULL), s.sort, v.name`, [id, q.from ?? null, q.to ?? null])).rows;
      return { vehicles: rows };
    });
  });

  app.post('/api/facilities/:id/vehicles', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = vehicleBody.parse(req.body);
    const t = (await vehicleTypes()).find((x) => x.id === b.itemId);
    if (!t) throw new AppError('Choose a vehicle type');
    checkVehicle(t, b);
    return tenantTx(tenant, async (c) => {
      const f = await facilityFor(c, req, id, true);
      const r = (await c.query(
        `INSERT INTO vehicle (tenant_id, facility_id, name, registration, item_id, fuel_item_id, ownership, charging, default_method, in_service_from, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tenant, f.id, b.name, b.registration || null, b.itemId, b.fuelItemId ?? null, b.ownership, b.charging ?? null, b.defaultMethod, b.inServiceFrom, b.note ?? null],
      ).catch(dupReg)).rows[0];
      await audit(c, req, 'vehicle.add', 'vehicle', r.id, { facility: f.name, name: b.name, registration: b.registration, type: t.name });
      return (await c.query(`${SELECT_VEHICLE} WHERE v.id = $1`, [r.id])).rows[0];
    });
  });

  app.patch('/api/vehicles/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = vehicleBody.parse(req.body);
    const t = (await vehicleTypes()).find((x) => x.id === b.itemId);
    if (!t) throw new AppError('Choose a vehicle type');
    checkVehicle(t, b);
    return tenantTx(tenant, async (c) => {
      const v = (await c.query('SELECT * FROM vehicle WHERE id = $1', [id])).rows[0];
      if (!v) throw notFound('Vehicle');
      await facilityFor(c, req, v.facility_id, true);
      if (v.item_id !== b.itemId && (await c.query('SELECT 1 FROM activity WHERE vehicle_id = $1 LIMIT 1', [id])).rowCount) {
        throw new AppError('This vehicle has entries: its type cannot change. Retire it and add the vehicle again with the right type.');
      }
      await c.query(
        `UPDATE vehicle SET name=$2, registration=$3, item_id=$4, fuel_item_id=$5, ownership=$6, charging=$7, default_method=$8, in_service_from=$9, note=$10 WHERE id=$1`,
        [id, b.name, b.registration || null, b.itemId, b.fuelItemId ?? null, b.ownership, b.charging ?? null, b.defaultMethod, b.inServiceFrom, b.note ?? null],
      ).catch(dupReg);
      await audit(c, req, 'vehicle.update', 'vehicle', id, b);
      return (await c.query(`${SELECT_VEHICLE} WHERE v.id = $1`, [id])).rows[0];
    });
  });

  /** Retire: the vehicle stays with its entries; it is no longer offered for periods after the date. */
  app.post('/api/vehicles/:id/retire', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ retiredOn: isoDate, reason: z.string().max(200).optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const v = (await c.query('SELECT * FROM vehicle WHERE id = $1', [id])).rows[0];
      if (!v) throw notFound('Vehicle');
      await facilityFor(c, req, v.facility_id, true);
      const from = (v.in_service_from as Date).toISOString?.().slice(0, 10) ?? String(v.in_service_from);
      if (b.retiredOn < from) throw new AppError(`The retirement date is before the vehicle entered service (${from})`);
      const later = (await c.query('SELECT count(*)::int n FROM activity WHERE vehicle_id = $1 AND period_start > $2', [id, b.retiredOn])).rows[0].n;
      if (later) throw new AppError(`${later} entr${later === 1 ? 'y is' : 'ies are'} dated after ${b.retiredOn}. Correct them first or choose a later date.`);
      await c.query('UPDATE vehicle SET retired_on = $2, retired_reason = $3 WHERE id = $1', [id, b.retiredOn, b.reason ?? null]);
      await audit(c, req, 'vehicle.retire', 'vehicle', id, { name: v.name, retiredOn: b.retiredOn, reason: b.reason });
      return { ok: true };
    });
  });

  app.post('/api/vehicles/:id/reinstate', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const v = (await c.query('SELECT * FROM vehicle WHERE id = $1', [id])).rows[0];
      if (!v) throw notFound('Vehicle');
      await facilityFor(c, req, v.facility_id, true);
      await c.query('UPDATE vehicle SET retired_on = NULL, retired_reason = NULL WHERE id = $1', [id]).catch(dupReg);
      await audit(c, req, 'vehicle.reinstate', 'vehicle', id, { name: v.name });
      return { ok: true };
    });
  });

  /** Delete only a vehicle with no entries (added by mistake). */
  app.delete('/api/vehicles/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const v = (await c.query('SELECT * FROM vehicle WHERE id = $1', [id])).rows[0];
      if (!v) throw notFound('Vehicle');
      await facilityFor(c, req, v.facility_id, true);
      if ((await c.query('SELECT 1 FROM activity WHERE vehicle_id = $1 LIMIT 1', [id])).rowCount) throw new AppError('This vehicle has entries: retire it instead of deleting it');
      await c.query('DELETE FROM vehicle WHERE id = $1', [id]);
      await audit(c, req, 'vehicle.delete', 'vehicle', id, { name: v.name });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------ Excel --
  /** Fleet template: one sheet to fill in, one with the vehicle types and fuels to choose from. */
  app.get('/api/vehicles/template.xlsx', async (_req, reply) => {
    const types = await vehicleTypes();
    const fuels = await query<{ name: string }>(
      `SELECT i.name FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
        WHERE c.code = 'stationary_combustion' AND i.active AND s.code IN ('liquid_fuels','gaseous_fuels','biofuel') ORDER BY s.sort, i.sort, i.name`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fleet');
    ws.addRow(['Name / fleet no. *', 'Registration', 'Vehicle type *', 'Fuel (if different or unknown)', 'Ownership (owned/leased)', 'Charging (site/elsewhere)', 'In service from * (yyyy-mm-dd)', 'Default entry (distance/fuel/electricity/spend)', 'Note']);
    ws.addRow(['Truck 12', 'DXB 12345', types.find((t) => /Rigid \(>17 tonnes\) · Average laden/.test(t.name) && t.sub.startsWith('Trucks'))?.name ?? '', '', 'owned', '', '2024-01-01', 'distance', 'Example: delete this row']);
    styleHeader(ws, [22, 16, 52, 36, 18, 18, 22, 26, 30]);
    const lists = wb.addWorksheet('Vehicle types');
    lists.addRow(['Vehicle type', 'Group', 'Class', 'Electric', 'Fuels']);
    types.forEach((t, i) => lists.addRow([t.name, t.grp ?? '', t.sub, t.attrs.electric ? 'electric' : t.attrs.phev ? 'plug-in hybrid' : '', fuels[i]?.name ?? '']));
    for (let i = types.length; i < fuels.length; i++) lists.getCell(i + 2, 5).value = fuels[i]!.name;
    styleHeader(lists, [60, 20, 36, 14, 40]);
    const n = 2000;
    for (let r = 2; r <= n; r++) {
      ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`'Vehicle types'!$A$2:$A$${types.length + 1}`] };
      ws.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`'Vehicle types'!$E$2:$E$${fuels.length + 1}`] };
      ws.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"owned,leased"'] };
      ws.getCell(`F${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"site,elsewhere"'] };
      ws.getCell(`H${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"distance,fuel,electricity,spend"'] };
    }
    return sendWorkbook(reply, wb, 'fleet-template.xlsx');
  });

  /** Fleet upload: ?commit=1 adds the valid rows; without it, a preview with each row's problems. */
  app.post('/api/facilities/:id/vehicles/upload', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const commit = z.object({ commit: z.coerce.boolean().optional() }).parse(req.query).commit ?? false;
    const { rows } = await readSheet(req.body, 'Fleet');
    const types = await vehicleTypes();
    const byName = new Map(types.map((t) => [t.name.toLowerCase(), t]));
    const fuels = new Map((await query<{ id: number; name: string }>('SELECT i.id, i.name FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id WHERE c.code = $1', ['stationary_combustion']))
      .map((f) => [f.name.toLowerCase(), f.id]));
    return tenantTx(tenant, async (c) => {
      const f = await facilityFor(c, req, id, true);
      const existing = new Set((await c.query('SELECT lower(registration) r FROM vehicle WHERE registration IS NOT NULL AND retired_on IS NULL')).rows.map((r) => r.r));
      const seen = new Set<string>();
      const out = [];
      for (const { n, row } of rows) {
        const errors: string[] = [];
        const name = row['Name / fleet no.'] ?? '';
        const reg = row['Registration'] || null;
        const t = byName.get((row['Vehicle type'] ?? '').toLowerCase());
        const fuelName = row['Fuel (if different or unknown)'];
        const fuelId = fuelName ? fuels.get(fuelName.toLowerCase()) : undefined;
        const from = toIsoDate(row['In service from (yyyy-mm-dd)'] ?? '');
        const ownership = (row['Ownership (owned/leased)'] || 'owned').toLowerCase();
        const charging = (row['Charging (site/elsewhere)'] || '').toLowerCase() || null;
        const method = (row['Default entry (distance/fuel/electricity/spend)'] || 'distance').toLowerCase();
        if (!name) errors.push('Name missing');
        if (!t) errors.push(row['Vehicle type'] ? `Unknown vehicle type "${row['Vehicle type']}" (pick from the list)` : 'Vehicle type missing');
        if (fuelName && !fuelId) errors.push(`Unknown fuel "${fuelName}"`);
        if (!from) errors.push('In-service date missing or not a date');
        if (!['owned', 'leased'].includes(ownership)) errors.push('Ownership must be owned or leased');
        if (charging && !['site', 'elsewhere'].includes(charging)) errors.push('Charging must be site or elsewhere');
        if (!(METHODS as readonly string[]).includes(method)) errors.push('Default entry must be distance, fuel, electricity or spend');
        if (reg && (existing.has(reg.toLowerCase()) || seen.has(reg.toLowerCase()))) errors.push(`Registration ${reg} is already in the fleet`);
        if (t?.attrs.distance === false && !fuelId && !t.attrs.fuel && !t.attrs.electric) errors.push('Choose the fuel');
        if (t && !t.attrs.fuel && !t.attrs.electric && !fuelId && method !== 'distance') errors.push(`${t.name}: fuel unknown — give the fuel, or use distance`);
        const body = { name, registration: reg, itemId: t?.id ?? 0, fuelItemId: fuelId ?? null, ownership: ownership as 'owned', charging: charging as 'site' | null,
          defaultMethod: method as 'distance', inServiceFrom: from ?? '', note: row['Note'] || null };
        if (t && !errors.length) { try { checkVehicle(t, body); } catch (e) { errors.push((e as Error).message); } }
        if (reg) seen.add(reg.toLowerCase());
        out.push({ row: n, name, registration: reg, type: t?.name ?? row['Vehicle type'] ?? '', inServiceFrom: from, errors, body });
      }
      let added = 0;
      if (commit) {
        for (const r of out.filter((x) => !x.errors.length)) {
          const b = r.body;
          await c.query(
            `INSERT INTO vehicle (tenant_id, facility_id, name, registration, item_id, fuel_item_id, ownership, charging, default_method, in_service_from, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [tenant, f.id, b.name, b.registration, b.itemId, b.fuelItemId, b.ownership, b.charging, b.defaultMethod, b.inServiceFrom, b.note]);
          added++;
        }
        await audit(c, req, 'vehicle.upload', 'org_node', f.id, { facility: f.name, added, rejected: out.length - added });
      }
      return { rows: out.map(({ body: _b, ...r }) => r), valid: out.filter((x) => !x.errors.length).length, added };
    });
  });
}

// ------------------------------------------------------- vehicle data upload --
const ENTRY_COLS = ['Facility *', 'Month * (yyyy-mm)', 'Vehicle (fleet name or registration)', 'Vehicle type (if not in the fleet)', 'Number of vehicles (default 1)',
  'Quantity per vehicle *', 'Unit (km, mile, litre, kg, m3, kWh, AED…)', 'Method (distance/fuel/electricity/spend — optional, read from the unit)', 'Price per unit (spend, optional)',
  'Fuel (optional)', 'Charging (site/elsewhere)', 'Data type (actual/estimated/proxy)', 'Note'];
const key = (s: string) => s.replace(/\s*\*/g, '').trim();

/**
 * One row of vehicle data, from a paste or an Excel file. Everything is text as
 * the person typed it; processRows() reads it, says how it was understood, and
 * calculates (or saves) it.
 */
export const rowSchema = z.object({
  facilityId: z.string().uuid().optional(),
  facility: z.string().max(200).optional(),
  month: z.string().max(40).optional(),
  /** fleet name / registration, or a vehicle description ("car petrol") */
  what: z.string().max(200).default(''),
  /** vehicle type chosen by the person, overriding the reading of `what` */
  typeId: z.number().int().positive().optional(),
  count: z.union([z.string(), z.number()]).optional(),
  quantity: z.union([z.string(), z.number()]).default(''),
  unit: z.string().max(40).optional(),
  method: z.string().max(40).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  fuel: z.string().max(200).optional(),
  charging: z.string().max(20).optional(),
  dataType: z.string().max(20).optional(),
  note: z.string().max(1000).optional(),
});
export type VehicleRow = z.infer<typeof rowSchema>;

export interface RowResult {
  index: number; errors: string[]; warnings: string[]; totals: Record<string, number> | null;
  /** how the row was understood */
  read: { vehicle: string | null; vehicleKind: 'fleet' | 'type' | null; typeId: number | null; assumed: string[]; month: string | null; count: number;
    method: string | null; quantity: number | null; unit: string | null; total: number | null } ;
}

async function lookups() {
  const types = await vehicleTypes();
  const unitRows = await query<{ code: string; name: string; aliases: string[]; dimension: string }>('SELECT code, name, aliases, dimension FROM unit');
  const unitBy = new Map<string, { code: string; dimension: string }>();
  for (const u of unitRows) for (const n of [u.code, u.name, ...(u.aliases ?? [])]) unitBy.set(n.toLowerCase(), { code: u.code, dimension: u.dimension });
  // In vehicle data "kWh" is electricity charged; litres spelled every way.
  for (const [k, v] of [['kwh', 'kWh_e'], ['mwh', 'MWh_e'], ['litre', 'L'], ['litres', 'L'], ['liter', 'L'], ['liters', 'L'], ['ltr', 'L'], ['ltrs', 'L'], ['lt', 'L'], ['l', 'L'],
    ['kms', 'km'], ['kilometers', 'km'], ['kilometres', 'km'], ['miles', 'mi'], ['mile', 'mi'], ['m³', 'm3'], ['cubic metre', 'm3'], ['gallon', 'gal_us'], ['gallons', 'gal_us']] as const) {
    const u = unitRows.find((x) => x.code === v); if (u) unitBy.set(k, { code: u.code, dimension: u.dimension });
  }
  const fuels = new Map((await query<{ id: number; name: string }>(`SELECT i.id, i.name FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id WHERE c.code = 'stationary_combustion'`)).map((f) => [f.name.toLowerCase(), f.id]));
  return { types, unitBy, fuels };
}

/** Read, check and calculate rows; with commit, save the good ones. Rows with problems are never saved. */
export async function processRows(c: Tx, req: FastifyRequest, t: { id: string; gwp_set: string }, rows: VehicleRow[], opts: { facilityId?: string; month?: string; commit: boolean }) {
  const { types, unitBy, fuels } = await lookups();
  const typeRefs = types.map((x) => ({ id: x.id, code: x.code, name: x.name }));
  const facs = (await c.query(`SELECT id, name FROM org_node WHERE kind = 'facility' AND active`)).rows as { id: string; name: string }[];
  const fleet = (await c.query('SELECT id, facility_id, name, registration, item_id FROM vehicle')).rows as { id: string; facility_id: string; name: string; registration: string | null; item_id: number }[];
  const out: RowResult[] = [];
  const entries: { i: number; e: SaveInput }[] = [];

  rows.forEach((r, index) => {
    const errors: string[] = [];
    const read: RowResult['read'] = { vehicle: null, vehicleKind: null, typeId: null, assumed: [], month: null, count: 1, method: null, quantity: null, unit: null, total: null };
    // Facility: id, name, or the one chosen on screen.
    const fac = r.facilityId ? facs.find((f) => f.id === r.facilityId)
      : r.facility ? facs.find((f) => f.name.toLowerCase() === r.facility!.trim().toLowerCase()) : facs.find((f) => f.id === opts.facilityId);
    if (!fac) errors.push(r.facility ? `Unknown facility "${r.facility}"` : 'Facility missing');
    // Month: the row's, else the one chosen on screen.
    const monthIso = toIsoDate(String(r.month ?? '').trim()) ?? (r.month ? null : opts.month ? `${opts.month}-01` : null);
    const month = monthIso ? /^(\d{4})-(\d{2})/.exec(monthIso) : null;
    if (!month) errors.push(r.month ? `"${r.month}" is not a month (use yyyy-mm)` : 'Month missing');
    else read.month = `${month[1]}-${month[2]}`;
    // Vehicle: fleet vehicle (name or registration) at that facility, else a type.
    const what = (r.what ?? '').trim();
    const veh = what ? fleet.find((v) => v.facility_id === fac?.id && (v.registration?.toLowerCase().replace(/\s+/g, '') === what.toLowerCase().replace(/\s+/g, '') || v.name.toLowerCase() === what.toLowerCase())) : undefined;
    let itemId: number | null = null;
    if (veh) { itemId = veh.item_id; read.vehicle = `${veh.name}${veh.registration ? ` (${veh.registration})` : ''}`; read.vehicleKind = 'fleet'; }
    else if (r.typeId) {
      const ty = types.find((x) => x.id === r.typeId);
      if (ty) { itemId = ty.id; read.vehicle = ty.name; read.vehicleKind = 'type'; } else errors.push('Unknown vehicle type');
    } else if (what) {
      const m = matchVehicleType(what, typeRefs);
      if (m) { itemId = m.type.id; read.vehicle = m.type.name; read.vehicleKind = 'type'; read.assumed = m.assumed; }
      else errors.push(`Could not read "${what}" as a vehicle — choose the type`);
    } else errors.push('Vehicle missing');
    read.typeId = itemId;
    const ty = types.find((x) => x.id === itemId);
    // Count.
    const countText = String(r.count ?? '').trim();
    const count = countText ? Number(countText.replace(/,/g, '')) : 1;
    if (!Number.isInteger(count) || count < 1 || count > 100000) errors.push('Number of vehicles must be a whole number from 1');
    else read.count = count;
    if (veh && count > 1) errors.push('A fleet vehicle is one vehicle: leave the number empty or 1');
    // Quantity and unit ("34km" in one cell works too).
    const q = typeof r.quantity === 'number' ? { qty: r.quantity, unit: '' } : splitQuantity(String(r.quantity ?? ''));
    if (q.qty == null || q.qty < 0) errors.push(String(r.quantity ?? '').trim() ? `"${r.quantity}" is not a quantity` : 'Quantity missing');
    else read.quantity = q.qty;
    const unitText = (r.unit || q.unit || '').trim();
    const currencyGiven = /^[A-Za-z]{3}$/.test(unitText) && !unitBy.has(unitText.toLowerCase());
    const u = unitText && !currencyGiven ? unitBy.get(unitText.toLowerCase()) : undefined;
    if (unitText && !u && !currencyGiven) errors.push(`Unknown unit "${unitText}"`);
    // Method: given, else from the unit (km → distance, litres → fuel, kWh → electricity, AED → spend).
    let method = (r.method ?? '').trim().toLowerCase();
    if (method && !(METHODS as readonly string[]).includes(method)) { errors.push(`Method "${r.method}" — use distance, fuel, electricity or spend`); method = ''; }
    if (!method) method = currencyGiven ? 'spend' : !u ? (ty?.attrs.distance === false ? 'fuel' : 'distance') : u.dimension === 'distance' ? 'distance' : u.dimension === 'electricity' ? 'electricity' : 'fuel';
    read.method = method;
    let unit = u?.code ?? (method === 'distance' ? 'km' : method === 'electricity' ? 'kWh_e' : 'L');
    if (method === 'spend' && ty?.attrs.electric) unit = 'kWh_e';
    if (method === 'spend' && !currencyGiven && !u) errors.push('Spend needs the currency in the unit column (e.g. AED)');
    read.unit = method === 'spend' ? (currencyGiven ? unitText.toUpperCase() : unitText) : unit;
    if (read.quantity != null) read.total = read.quantity * read.count;
    const fuelName = (r.fuel ?? '').trim();
    const fuelItemId = fuelName ? fuels.get(fuelName.toLowerCase()) : undefined;
    if (fuelName && !fuelItemId) errors.push(`Unknown fuel "${fuelName}"`);
    const charging = (r.charging ?? '').trim().toLowerCase();
    if (charging && !['site', 'elsewhere'].includes(charging)) errors.push('Charging must be site or elsewhere');
    const dataType = ((r.dataType ?? '').trim().toLowerCase() || 'actual') as SaveInput['dataType'];
    if (!['actual', 'estimated', 'proxy'].includes(dataType)) errors.push('Data type must be actual, estimated or proxy');
    const price = String(r.price ?? '').trim() ? Number(String(r.price).replace(/,/g, '')) : undefined;
    if (price !== undefined && !(price > 0)) errors.push('Price must be a positive number');

    out.push({ index, errors, warnings: [], totals: null, read });
    if (errors.length) return;
    const y = Number(month![1]), m = Number(month![2]);
    entries.push({ i: index, e: {
      facilityId: fac!.id, itemId: itemId!, unit, quantity: method === 'spend' ? undefined : q.qty!,
      periodStart: `${month![1]}-${month![2]}-01`, periodEnd: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), dataType, note: r.note || undefined,
      vehicle: { method: method as 'distance', count: count > 1 ? count : undefined, vehicleId: veh?.id, fuelItemId, charging: (charging || undefined) as 'site' | undefined,
        spend: method === 'spend' ? { amount: q.qty!, currency: currencyGiven ? unitText.toUpperCase() : 'AED', price } : undefined },
    } as SaveInput });
  });
  const batch = entries.length ? await runBatch(c, req, t, entries.map((x) => x.e), !opts.commit) : { results: [], saved: 0, failed: 0 };
  batch.results.forEach((b, k) => {
    const o = out[entries[k]!.i]!;
    if (b.ok) { o.totals = b.totals ?? null; o.warnings = b.warnings ?? []; } else o.errors.push(b.error!);
  });
  return { rows: out, valid: out.filter((r) => !r.errors.length).length, saved: opts.commit ? batch.saved : 0 };
}

export async function vehicleUploadRoutes(app: FastifyInstance) {
  /**
   * Template for vehicle data: one row per fleet vehicle in service per month of
   * the period (facility optional: all facilities the person can enter for).
   */
  app.get('/api/vehicles/entries-template.xlsx', async (req, reply) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional(), from: z.string().regex(/^\d{4}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.query);
    const months: string[] = [];
    for (let d = new Date(`${q.from}-01T00:00:00Z`); d <= new Date(`${q.to}-01T00:00:00Z`) && months.length < 24; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
    if (!months.length) throw new AppError('The period is empty');
    const types = await vehicleTypes();
    const { facilities, fleet } = await tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const facs = (await c.query(`SELECT id, name FROM org_node WHERE kind = 'facility' AND active ORDER BY name`)).rows.filter((f) => scope.enter.has(f.id) && (!q.facilityId || f.id === q.facilityId));
      const fl = (await c.query(`${SELECT_VEHICLE} WHERE v.facility_id = ANY($1) ORDER BY v.name`, [facs.map((f) => f.id)])).rows;
      return { facilities: facs as { id: string; name: string }[], fleet: fl };
    });
    if (!facilities.length) throw new AppError('No facility you can enter data for');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vehicle data');
    ws.addRow(ENTRY_COLS);
    const unitFor = (m: string, v: { attrs: { electric?: boolean } }) => (m === 'distance' ? 'km' : m === 'electricity' ? 'kWh' : m === 'spend' ? 'AED' : 'litre');
    for (const m of months) {
      for (const f of facilities) {
        for (const v of fleet.filter((x) => x.facility_id === f.id && x.in_service_from.slice(0, 7) <= m && (!x.retired_on || x.retired_on.slice(0, 7) >= m))) {
          ws.addRow([f.name, m, v.registration || v.name, '', null, null, unitFor(v.default_method, v), v.default_method, null, '', v.charging ?? '', 'actual', '']);
        }
      }
    }
    if (ws.rowCount === 1) ws.addRow([facilities[0]!.name, months[0], '', 'Car petrol', 2, 1500, 'km', '', null, '', '', 'actual', 'Example: 2 petrol cars, 1,500 km each']);
    styleHeader(ws, [26, 14, 24, 40, 14, 16, 18, 26, 16, 30, 16, 14, 30]);
    const lists = wb.addWorksheet('Vehicle types');
    lists.addRow(['Facility', 'Vehicle type (or write it your way: "car petrol", "pickup diesel", "tipper 18t")', 'Fleet vehicle']);
    const fleetNames = fleet.filter((v) => !v.retired_on).map((v) => v.registration || v.name);
    const n = Math.max(facilities.length, types.length, fleetNames.length);
    for (let i = 0; i < n; i++) lists.addRow([facilities[i]?.name ?? '', types[i]?.name ?? '', fleetNames[i] ?? '']);
    styleHeader(lists, [30, 70, 26]);
    const lastRow = Math.max(ws.rowCount + 200, 500); // fixed before the loop: touching a cell adds rows
    for (let r = 2; r <= lastRow; r++) {
      ws.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`'Vehicle types'!$A$2:$A$${facilities.length + 1}`] };
      ws.getCell(`H${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"distance,fuel,electricity,spend"'] };
      ws.getCell(`K${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"site,elsewhere"'] };
      ws.getCell(`L${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"actual,estimated,proxy"'] };
    }
    return sendWorkbook(reply, wb, `vehicle-data-${q.from}_${q.to}.xlsx`);
  });

  /** Excel file of vehicle data: preview (each row read, calculated, problems listed), then ?commit=1 saves the good rows. */
  app.post('/api/vehicles/entries/upload', async (req) => {
    const tenant = requireTenant(req);
    const commit = z.object({ commit: z.coerce.boolean().optional() }).parse(req.query).commit ?? false;
    const { rows } = await readSheet(req.body, 'Vehicle data');
    const t = await tenantSettings(tenant);
    const g = (row: Record<string, string>, k: string) => (row[key(k)] ?? '').trim();
    const mapped: VehicleRow[] = rows.map(({ row }) => ({
      facility: g(row, ENTRY_COLS[0]!), month: g(row, ENTRY_COLS[1]!), what: g(row, ENTRY_COLS[2]!) || g(row, ENTRY_COLS[3]!), count: g(row, ENTRY_COLS[4]!),
      quantity: g(row, ENTRY_COLS[5]!), unit: g(row, ENTRY_COLS[6]!), method: g(row, ENTRY_COLS[7]!), price: g(row, ENTRY_COLS[8]!), fuel: g(row, ENTRY_COLS[9]!),
      charging: g(row, ENTRY_COLS[10]!), dataType: g(row, ENTRY_COLS[11]!), note: g(row, ENTRY_COLS[12]!),
    }));
    return tenantTx(tenant, async (c) => {
      const r = await processRows(c, req, t, mapped, { commit });
      if (commit) await audit(c, req, 'vehicle.data.upload', 'activity', null, { rows: rows.length, saved: r.saved });
      return { ...r, rows: r.rows.map((x, i) => ({ ...x, row: rows[i]!.n })) };
    });
  });

  /** Rows pasted or typed on screen: the same reading and checks as the Excel upload. */
  app.post('/api/vehicles/entries/rows', async (req) => {
    const tenant = requireTenant(req);
    const b = z.object({ facilityId: z.string().uuid().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), rows: z.array(rowSchema).min(1).max(2000), commit: z.boolean().default(false) }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const r = await processRows(c, req, t, b.rows, { facilityId: b.facilityId, month: b.month, commit: b.commit });
      if (b.commit) await audit(c, req, 'vehicle.data.rows', 'activity', null, { rows: b.rows.length, saved: r.saved });
      return r;
    });
  });
}

function dupReg(e: { code?: string }): never {
  if (e.code === '23505') throw new AppError('A vehicle in service already has this registration');
  throw e;
}
