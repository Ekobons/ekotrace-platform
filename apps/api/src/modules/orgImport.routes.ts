/**
 * Organisation chart from a spreadsheet: one row per facility (or a row with only a sub-group), sub-groups under the
 * main entity, facilities inside their sub-group.
 *
 *   GET  /api/org/import/template          Excel with the current chart (or examples) and instructions
 *   POST /api/org/import/preview           the file → what would be created, updated or refused, row by row
 *   POST /api/org/import?update=1          the same file → created (and, with update=1, existing facilities updated)
 *
 * Columns are found by their heading (Sub-group, Facility, Facility type, City / location, Country, Floor area m²,
 * Employees, Ownership %, Manager e-mail). Names are matched without regard to case. Super admins only.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireTenant } from '../lib/auth.js';
import { AppError, forbidden } from '../lib/errors.js';
import { cellText, detectKind, findHeaderRow, previewXlsx, sheetRows, type Cell } from '../lib/sheet.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { airports } from '../lib/airports.js';
import { checkFacilityLimit } from '../lib/plans.js';

export const FACILITY_TYPES = ['Office', 'Plant', 'Warehouse', 'Fleet depot', 'Data centre', 'Residential', 'Retail', 'Landfill', 'Laboratory', 'Other'];
const HEAD = ['Sub-group', 'Facility', 'Facility type', 'City / location', 'Country', 'Floor area (m²)', 'Employees', 'Ownership %', 'Manager e-mail'];
type Col = 'sub' | 'fac' | 'type' | 'loc' | 'country' | 'area' | 'emp' | 'own' | 'mgr';
const SYN: [Col, RegExp][] = [
  ['sub', /^(sub[- ]?group|division|business unit|segment|bu)\b/i], ['type', /(facility )?type|category of site/i], ['fac', /^(facility|site|plant|branch)( name)?$/i],
  ['loc', /city|location|address|emirate|state/i], ['country', /country/i], ['area', /area|m²|m2|sq/i], ['emp', /employ|headcount|staff|fte/i],
  ['own', /owner|equity|share/i], ['mgr', /manager|approver|e-?mail/i],
];

function superOnly(req: FastifyRequest) {
  if (!['platform_admin', 'super_admin'].includes(req.user.role)) throw forbidden('Only a super admin builds the organisation chart from a file');
}
const low = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const num = (s: string) => { if (!s) return null; const x = Number(s.replace(/[\s,]/g, '')); return Number.isFinite(x) ? x : NaN; };

interface Row { row: number; sub: string; fac: string; type: string | null; loc: string | null; country: string | null; area: number | null; emp: number | null; own: number | null; mgr: string | null }
export interface PlanRow { row: number; subgroup: string; facility: string; action: 'new sub-group' | 'new facility' | 'update' | 'no change' | 'refused'; problems: string[]; notes: string[] }

async function readRows(buf: Buffer, filename: string): Promise<Row[]> {
  const kind = detectKind(buf, filename);
  if (kind !== 'xlsx' && kind !== 'csv') throw new AppError('Send an Excel (.xlsx) or CSV file');
  let sheet: string | undefined;
  if (kind === 'xlsx') {
    const sheets = await previewXlsx(buf, 15);
    sheet = (sheets.find((s) => /organi[sz]ation|chart|facilit|sites/i.test(s.name)) ?? sheets.find((s) => s.rows.some((r) => r.some((c) => /facility|sub-?group/i.test(cellText(c))))) ?? sheets[0])?.name;
  }
  const all: Cell[][] = [];
  for await (const r of sheetRows(buf, kind, sheet)) { all.push(r); if (all.length > 5000) throw new AppError('At most 5,000 rows'); }
  const h = findHeaderRow(all);
  const header = (all[h] ?? []).map((c) => cellText(c));
  const at: Partial<Record<Col, number>> = {};
  header.forEach((t, i) => { const m = SYN.find(([k, re]) => at[k] == null && re.test(t)); if (m) at[m[0]] = i; });
  if (at.sub == null || at.fac == null) throw new AppError(`The file needs a "Sub-group" and a "Facility" column (found: ${header.filter(Boolean).join(', ') || 'no heading'})`);
  const g = (r: Cell[], k: Col) => (at[k] == null ? '' : cellText(r[at[k]!] ?? null));
  return all.slice(h + 1).map((r, i) => ({
    row: h + i + 2, sub: g(r, 'sub'), fac: g(r, 'fac'), type: g(r, 'type') || null, loc: g(r, 'loc') || null, country: g(r, 'country') || null,
    area: num(g(r, 'area')), emp: num(g(r, 'emp')), own: num(g(r, 'own')), mgr: g(r, 'mgr') || null,
  })).filter((r) => r.sub || r.fac || r.type || r.loc);
}

const countryOf = (s: string | null) => {
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s.trim())) return airports().countries.has(s.trim().toUpperCase()) ? s.trim().toUpperCase() : undefined;
  const f = low(s);
  const alias: Record<string, string> = { uae: 'AE', 'u.a.e.': 'AE', usa: 'US', uk: 'GB', ksa: 'SA', 'saudi': 'SA', 'turkiye': 'TR', 'türkiye': 'TR' };
  if (alias[f]) return alias[f];
  for (const [code, n] of airports().countries) if (low(n) === f) return code;
  return undefined;
};

/** What the file would do, row by row; `apply` carries it out in the same transaction. */
async function plan(c: Tx, rows: Row[], update: boolean) {
  const nodes = (await c.query(`SELECT id, parent_id, kind, name, facility_type, location, country, floor_area_m2::float8 AS area, employees, ownership_pct::float8 AS own, manager_user_id, active FROM org_node ORDER BY created_at`)).rows;
  const root = nodes.find((n) => n.kind === 'group');
  if (!root) throw new AppError('The company has no main entity');
  const users = new Map((await c.query(`SELECT id, lower(email) AS email FROM app_user WHERE NOT disabled`)).rows.map((u) => [u.email as string, u.id as string]));
  const subs = new Map(nodes.filter((n) => n.kind === 'subgroup').map((n) => [low(n.name), n]));
  const facs = new Map(nodes.filter((n) => n.kind === 'facility').map((n) => [low(n.name), n]));
  // the standard types and any the company already uses (e.g. "Transfer station")
  const types = [...new Set([...FACILITY_TYPES, ...nodes.filter((n) => n.facility_type).map((n) => n.facility_type as string)])];
  const out: PlanRow[] = [];
  const newSubs = new Set<string>(), seenFac = new Map<string, number>();
  const ops: { row: Row; sub: string; facId: string | null; type: string | null; country: string; mgr: string | null }[] = [];
  for (const r of rows) {
    const p: PlanRow = { row: r.row, subgroup: r.sub, facility: r.fac, action: 'no change', problems: [], notes: [] };
    if (!r.sub) p.problems.push(r.fac ? 'Sub-group missing: a facility belongs to a sub-group' : 'Sub-group missing');
    if (r.sub && low(r.sub) === low(root.name)) p.problems.push('This is the main entity: put the sub-group name here');
    if (r.sub && facs.has(low(r.sub))) p.problems.push(`"${r.sub}" is a facility, not a sub-group`);
    if (r.fac && subs.has(low(r.fac))) p.problems.push(`"${r.fac}" is already a sub-group`);
    const type = r.type ? types.find((t) => low(t) === low(r.type!)) ?? null : null;
    if (r.type && !type) p.problems.push(`Facility type "${r.type}" — use one of: ${types.join(', ')}`);
    const ctry = countryOf(r.country);
    if (ctry === undefined) p.problems.push(`Country "${r.country}" not recognised (name or 2-letter code)`);
    for (const [k, l, max] of [['area', 'Floor area', 1e9], ['emp', 'Employees', 1e7], ['own', 'Ownership %', 100]] as const) {
      const v = r[k];
      if (v != null && (Number.isNaN(v) || v < 0 || v > max)) p.problems.push(`${l} "${v}" is not a valid number${k === 'own' ? ' (0–100)' : ''}`);
    }
    let mgr: string | null = null;
    if (r.mgr) { mgr = users.get(low(r.mgr)) ?? null; if (!mgr) p.notes.push(`Manager ${r.mgr} has no account yet: left empty`); }
    if (r.fac) {
      const k = low(r.fac);
      if (seenFac.has(k)) p.problems.push(`Facility "${r.fac}" is also on row ${seenFac.get(k)}`);
      seenFac.set(k, r.row);
    }
    if (!p.problems.length) {
      const subKey = low(r.sub);
      const isNewSub = !subs.has(subKey) && !newSubs.has(subKey);
      if (isNewSub) newSubs.add(subKey);
      const existing = r.fac ? facs.get(low(r.fac)) : null;
      if (r.fac && !existing) p.action = 'new facility';
      else if (existing) {
        const parentNow = nodes.find((n) => n.id === existing.parent_id);
        const changes = [
          parentNow && low(parentNow.name) !== subKey && `moves to ${r.sub}`, type && type !== existing.facility_type && `type ${type}`, r.loc && r.loc !== existing.location && `location ${r.loc}`,
          ctry && ctry !== existing.country && `country ${ctry}`, r.area != null && r.area !== existing.area && 'floor area', r.emp != null && r.emp !== existing.employees && 'employees',
          r.own != null && r.own !== existing.own && 'ownership', mgr && mgr !== existing.manager_user_id && 'manager',
        ].filter(Boolean) as string[];
        if (changes.length) { p.action = update ? 'update' : 'no change'; p.notes.push(update ? `Updated: ${changes.join(', ')}` : `Exists — differs (${changes.join(', ')}); tick "update existing facilities" to change it`); }
        else p.notes.push('Already in the chart');
      } else if (isNewSub) p.action = 'new sub-group';
      if (isNewSub && p.action !== 'new sub-group') p.notes.unshift(`New sub-group ${r.sub}`);
      ops.push({ row: r, sub: subKey, facId: existing?.id ?? null, type, country: ctry ?? root.country, mgr });
    } else p.action = 'refused';
    out.push(p);
  }
  return { root, subs, ops, out, newSubs: newSubs.size, newFacilities: out.filter((x) => x.action === 'new facility').length, updates: out.filter((x) => x.action === 'update').length, refused: out.filter((x) => x.action === 'refused').length };
}

async function apply(c: Tx, req: FastifyRequest, tenant: string, P: Awaited<ReturnType<typeof plan>>, update: boolean) {
  const subId = new Map([...P.subs].map(([k, n]) => [k, n.id as string]));
  let made = 0, subsMade = 0, updated = 0;
  for (const o of P.ops) {
    let sid = subId.get(o.sub);
    if (!sid) {
      sid = (await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, country) VALUES ($1,$2,'subgroup',$3,$4) RETURNING id`, [tenant, P.root.id, o.row.sub.trim(), o.country])).rows[0].id as string;
      subId.set(o.sub, sid); subsMade++;
      await audit(c, req, 'node.create', 'subgroup', sid, { name: o.row.sub.trim(), via: 'import' });
    }
    if (!o.row.fac) continue;
    const r = o.row;
    if (!o.facId) {
      await checkFacilityLimit(c, tenant);
      const id = (await c.query(`INSERT INTO org_node (tenant_id, parent_id, kind, name, facility_type, location, country, floor_area_m2, employees, ownership_pct, manager_user_id)
                                 VALUES ($1,$2,'facility',$3,$4,$5,$6,$7,$8,COALESCE($9,100),$10) RETURNING id`,
        [tenant, sid, r.fac.trim(), o.type, r.loc, o.country, r.area, r.emp, r.own, o.mgr])).rows[0].id as string;
      await audit(c, req, 'node.create', 'facility', id, { name: r.fac.trim(), via: 'import' });
      made++;
    } else if (update) {
      const x = await c.query(`UPDATE org_node SET parent_id = $2, facility_type = COALESCE($3, facility_type), location = COALESCE($4, location), country = COALESCE($5, country),
                                 floor_area_m2 = COALESCE($6, floor_area_m2), employees = COALESCE($7, employees), ownership_pct = COALESCE($8, ownership_pct), manager_user_id = COALESCE($9, manager_user_id)
                                 WHERE id = $1 AND (parent_id IS DISTINCT FROM $2 OR facility_type IS DISTINCT FROM COALESCE($3, facility_type) OR location IS DISTINCT FROM COALESCE($4, location)
                                   OR country IS DISTINCT FROM COALESCE($5, country) OR floor_area_m2 IS DISTINCT FROM COALESCE($6, floor_area_m2) OR employees IS DISTINCT FROM COALESCE($7, employees)
                                   OR ownership_pct IS DISTINCT FROM COALESCE($8, ownership_pct) OR manager_user_id IS DISTINCT FROM COALESCE($9, manager_user_id))`,
        [o.facId, sid, o.type, r.loc, r.country ? o.country : null, r.area, r.emp, r.own, o.mgr]);
      if (x.rowCount) { updated++; await audit(c, req, 'node.update', 'facility', o.facId, { name: r.fac.trim(), via: 'import' }); }
    }
  }
  return { subgroups: subsMade, facilities: made, updated };
}

export async function orgImportRoutes(app: FastifyInstance) {
  app.get('/api/org/import/template', async (req, reply) => {
    const tenant = requireTenant(req); superOnly(req);
    return tenantTx(tenant, async (c) => {
      const nodes = (await c.query(`SELECT n.id, n.parent_id, n.kind, n.name, n.facility_type, n.location, n.country, n.floor_area_m2::float8 AS area, n.employees, n.ownership_pct::float8 AS own, u.email AS mgr
                                       FROM org_node n LEFT JOIN app_user u ON u.id = n.manager_user_id WHERE n.active ORDER BY n.name`)).rows;
      const wb = new ExcelJS.Workbook();
      const ins = wb.addWorksheet('Instructions');
      ins.columns = [{ width: 110 }];
      for (const t of ['Organisation chart — fill the "Organisation" sheet and upload it under Organisation & groups → Upload from Excel.', '',
        'One row per facility: its sub-group and the facility. A row with only a sub-group creates the sub-group alone.',
        'Sub-groups go under the main entity; facilities go inside a sub-group. Names are matched without regard to case: a name already in the chart is not created twice.',
        `Facility type: ${FACILITY_TYPES.join(', ')}.`, 'Country: the name or the 2-letter code (empty = the main entity\'s country).',
        'Floor area in m², employees and ownership % (empty = 100%) are optional. Manager e-mail: a person who already has an account (approves the facility\'s data).',
        'Existing facilities are left as they are unless you tick "update existing facilities" when uploading; nothing is ever deleted by an upload.'])
        ins.addRow([t]);
      ins.getRow(1).font = { bold: true, size: 13 };
      const ws = wb.addWorksheet('Organisation');
      ws.addRow(HEAD);
      styleHeader(ws, [24, 30, 16, 22, 18, 14, 12, 12, 28]);
      const root = nodes.find((n) => n.kind === 'group');
      const subs = nodes.filter((n) => n.kind === 'subgroup');
      const facs = nodes.filter((n) => n.kind === 'facility');
      const names = airports().countries;
      for (const s of subs) {
        const fs = facs.filter((f) => f.parent_id === s.id);
        if (!fs.length) ws.addRow([s.name]);
        for (const f of fs) ws.addRow([s.name, f.name, f.facility_type ?? '', f.location ?? '', names.get(f.country) ?? f.country ?? '', f.area ?? '', f.employees ?? '', f.own ?? '', f.mgr ?? '']);
      }
      for (const f of facs.filter((x) => x.parent_id === root?.id)) ws.addRow(['', f.name, f.facility_type ?? '', f.location ?? '', names.get(f.country) ?? f.country ?? '', f.area ?? '', f.employees ?? '', f.own ?? '', f.mgr ?? '']);
      if (!subs.length && !facs.length) {
        ws.addRow(['Waste management', 'Al Saja\'a landfill', 'Landfill', 'Sharjah', 'United Arab Emirates', '', 40, 100, '']);
        ws.addRow(['Waste management', 'Material recovery facility', 'Plant', 'Sharjah', 'United Arab Emirates', 12000, 85, 100, '']);
        ws.addRow(['Corporate', 'Head office', 'Office', 'Sharjah', 'AE', 6500, 320, 100, '']);
      }
      for (let r = 2; r <= Math.max(ws.rowCount, 200); r++) ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${FACILITY_TYPES.join(',')}"`] };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      return sendWorkbook(reply, wb, 'organisation-chart.xlsx');
    });
  });

  const fileOf = (req: FastifyRequest) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError('Send the file');
    return { buf: req.body, name: decodeURIComponent(String(req.headers['x-filename'] ?? 'organisation.xlsx')) };
  };
  app.post('/api/org/import/preview', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req); superOnly(req);
    const f = fileOf(req);
    const update = (req.query as { update?: string }).update === '1';
    const rows = await readRows(f.buf, f.name);
    return tenantTx(tenant, async (c) => { const P = await plan(c, rows, update); return { rows: P.out, newSubgroups: P.newSubs, newFacilities: P.newFacilities, updates: P.updates, refused: P.refused }; });
  });
  app.post('/api/org/import', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req); superOnly(req);
    const f = fileOf(req);
    const update = (req.query as { update?: string }).update === '1';
    const rows = await readRows(f.buf, f.name);
    return tenantTx(tenant, async (c) => {
      const P = await plan(c, rows, update);
      if (P.refused) throw new AppError(`${P.refused} row${P.refused === 1 ? '' : 's'} cannot be loaded — correct the file (see the preview) and upload again`);
      const r = await apply(c, req, tenant, P, update);
      await audit(c, req, 'org.import', 'org_node', null, { file: f.name, ...r });
      return r;
    });
  });
}
