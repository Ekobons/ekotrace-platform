/**
 * QR & field app: waste weighed or checked at the bin, rolled up into the month's waste entries.
 *
 *   Bins (collection points)     facility, name, location, material and usual disposal method, hazardous, contractor,
 *                                capacity (L) and density (kg/L, to estimate from the fill level). Each has a QR label
 *                                with only a short code (/scan/<code>): it identifies the bin, carries no data, and a
 *                                scan needs a signed-in person with access to the facility.
 *   Scans                        weigh (kg, actual) · fill level (% × capacity × density, estimated) · collection by the
 *                                contractor (manifest number and, when known, the weighbridge weight — required
 *                                manifest for hazardous waste). Checked at once: over the bin's capacity, the same bin
 *                                scanned again within 10 minutes, far from the bin's usual weight.
 *   Monthly roll-up              per bin: the weighbridge weights of the month's collections when there are any (actual),
 *                                else the weighed scans (actual) and fill levels (estimated). Grouped by material,
 *                                disposal method, hazardous and contractor into draft Scope 3.5 entries (actual and
 *                                estimated kept apart), with the manifests; the scans are marked as used.
 *
 *   GET    /api/qr/bins?facilityId=          POST /api/qr/bins          PATCH / DELETE /api/qr/bins/:id
 *   GET    /api/qr/scan/:code                the bin behind a label, for the scan page
 *   POST   /api/qr/bins/:id/scans            GET /api/qr/scans?facilityId=&year=&month=      POST /api/qr/scans/:id/void
 *   GET    /api/qr/rollup?facilityId=&year=&month=      POST /api/qr/rollup
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { runBatch, tenantSettings } from './activity.routes.js';
import { linkBins } from './contractor.routes.js';

const GRI = z.enum(['reuse', 'recycling', 'composting', 'ad', 'incin_er', 'incin_noer', 'landfill', 'other']);
const binSchema = z.object({
  facilityId: z.string().uuid(), name: z.string().trim().min(1).max(120), location: z.string().trim().max(200).optional(),
  itemId: z.number().int().positive(), gri: GRI.optional(), hazardous: z.boolean().default(false), contractor: z.string().trim().max(120).optional(),
  capacityL: z.number().positive().max(100000).optional(), density: z.number().positive().max(5).optional(),
});
const pad = (n: number) => String(n).padStart(2, '0');
const monthOf = (y: number, m: number) => ({ start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` });
const newCode = () => { const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = randomBytes(10); return [...b].map((x) => abc[x % abc.length]).join(''); };

const BIN_COLS = `b.id, b.code, b.facility_id AS "facilityId", f.name AS facility, b.name, b.location, b.item_id AS "itemId", i.name AS item,
  i.attrs->>'material' AS material, i.attrs->>'route' AS route, b.gri, b.hazardous, b.contractor, b.capacity_l::float8 AS "capacityL", b.density::float8 AS density, b.active`;

async function binFor(c: Tx, req: FastifyRequest, id: string, need: 'see' | 'enter') {
  const b = (await c.query(`SELECT ${BIN_COLS} FROM waste_bin b JOIN org_node f ON f.id = b.facility_id JOIN item i ON i.id = b.item_id WHERE b.id = $1`, [id])).rows[0];
  if (!b) throw notFound('Bin');
  assertCan((await scopeOf(c, req.user))[need], b.facilityId, need === 'see' ? 'this bin' : 'record scans for this facility');
  return b;
}

/** The item must be waste sent out (Scope 3.5). */
async function checkItem(c: Tx, itemId: number) {
  const ok = (await c.query(`SELECT 1 FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category k ON k.id = s.category_id WHERE i.id = $1 AND k.code = 'waste_generated'`, [itemId])).rowCount;
  if (!ok) throw new AppError('Choose a waste material and disposal method (waste sent out)');
}

/** What the month's scans add up to, per bin and per entry to be made. */
async function rollup(c: Tx, facilityId: string, y: number, m: number) {
  const { start, end } = monthOf(y, m);
  const scans = (await c.query(
    `SELECT s.id, s.bin_id, s.kind, s.kg::float8 AS kg, s.estimated, s.manifest, s.status, s.activity_id FROM waste_scan s
      WHERE s.facility_id = $1 AND s.status <> 'void' AND s.at >= $2::date AND s.at < ($3::date + 1) ORDER BY s.at`, [facilityId, start, end])).rows;
  const bins = (await c.query(`SELECT ${BIN_COLS} FROM waste_bin b JOIN org_node f ON f.id = b.facility_id JOIN item i ON i.id = b.item_id WHERE b.facility_id = $1`, [facilityId])).rows;
  const perBin: Record<string, unknown>[] = [], groups = new Map<string, { itemId: number; item: string; gri: string | null; hazardous: boolean; contractor: string | null; actual: number; estimated: number; manifests: Set<string>; scans: string[]; bins: Set<string> }>();
  let rolled = 0;
  for (const b of bins) {
    const all = scans.filter((s) => s.bin_id === b.id);
    rolled += all.filter((s) => s.status === 'rolled').length;
    const open = all.filter((s) => s.status === 'open');
    if (!open.length) continue;
    const col = open.filter((s) => s.kind === 'collection' && s.kg > 0);
    // weighbridge weights replace the field scans of the month for this bin
    const use = col.length ? col : open.filter((s) => s.kind !== 'collection');
    const actual = use.filter((s) => !s.estimated).reduce((a, s) => a + s.kg, 0), est = use.filter((s) => s.estimated).reduce((a, s) => a + s.kg, 0);
    const manifests = open.map((s) => s.manifest).filter(Boolean) as string[];
    perBin.push({ bin: b.name, item: b.item, basis: col.length ? 'weighbridge' : 'field scans', actualKg: actual, estimatedKg: est, scans: open.length, manifests });
    const k = `${b.itemId}|${b.gri ?? ''}|${b.hazardous}|${b.contractor ?? ''}`;
    const g = groups.get(k) ?? { itemId: b.itemId, item: b.item, gri: b.gri, hazardous: b.hazardous, contractor: b.contractor, actual: 0, estimated: 0, manifests: new Set<string>(), scans: [] as string[], bins: new Set<string>() };
    g.actual += actual; g.estimated += est; manifests.forEach((x) => g.manifests.add(x)); g.scans.push(...open.map((s) => s.id)); g.bins.add(b.name);
    groups.set(k, g);
  }
  return { start, end, perBin, rolled, groups: [...groups.values()] };
}

export async function qrRoutes(app: FastifyInstance) {
  app.get('/api/qr/bins', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const now = new Date(), { start } = monthOf(now.getUTCFullYear(), now.getUTCMonth() + 1);
      const rows = (await c.query(
        `SELECT ${BIN_COLS},
                (SELECT max(x.at) FROM waste_scan x WHERE x.bin_id = b.id AND x.status <> 'void') AS "lastScan",
                (SELECT coalesce(sum(x.kg), 0)::float8 FROM waste_scan x WHERE x.bin_id = b.id AND x.status <> 'void' AND x.kind <> 'collection' AND x.at >= $2::date) AS "monthKg",
                (SELECT count(*)::int FROM waste_scan x WHERE x.bin_id = b.id AND x.status = 'open') AS "openScans"
           FROM waste_bin b JOIN org_node f ON f.id = b.facility_id JOIN item i ON i.id = b.item_id
          WHERE b.active AND ($1::uuid IS NULL OR b.facility_id = $1) ORDER BY f.name, b.name`, [q.facilityId ?? null, start])).rows;
      return { bins: rows.filter((b) => s.see.has(b.facilityId)) };
    });
  });

  app.post('/api/qr/bins', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = binSchema.parse(req.body);
    return tenantTx(tenant, async (c) => {
      assertCan((await scopeOf(c, req.user)).enter, b.facilityId, 'this facility');
      await checkItem(c, b.itemId);
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const r = (await c.query(
          `INSERT INTO waste_bin (tenant_id, facility_id, code, name, location, item_id, gri, hazardous, contractor, capacity_l, density, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (code) DO NOTHING RETURNING id`,
          [tenant, b.facilityId, code, b.name, b.location || null, b.itemId, b.gri ?? null, b.hazardous, b.contractor || null, b.capacityL ?? null, b.density ?? null, req.user.name])).rows[0];
        if (r) { await linkBins(c); await audit(c, req, 'qr.bin.create', 'waste_bin', r.id, { name: b.name, code }); return binFor(c, req, r.id, 'see'); }
      }
      throw new AppError('Could not make a unique code, try again');
    });
  });

  app.patch('/api/qr/bins/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = binSchema.omit({ facilityId: true }).partial().parse(req.body);
    return tenantTx(tenant, async (c) => {
      await binFor(c, req, id, 'enter');
      if (b.itemId) await checkItem(c, b.itemId);
      await c.query(`UPDATE waste_bin SET name = COALESCE($2, name), location = COALESCE($3, location), item_id = COALESCE($4, item_id), gri = CASE WHEN $10::boolean THEN $5 ELSE gri END,
                       hazardous = COALESCE($6, hazardous), contractor = COALESCE($7, contractor), capacity_l = COALESCE($8, capacity_l), density = COALESCE($9, density) WHERE id = $1`,
        [id, b.name ?? null, b.location ?? null, b.itemId ?? null, b.gri ?? null, b.hazardous ?? null, b.contractor ?? null, b.capacityL ?? null, b.density ?? null, 'gri' in b]);
      if (b.contractor !== undefined) { await c.query('UPDATE waste_bin SET contractor_id = NULL WHERE id = $1', [id]); await linkBins(c); }
      await audit(c, req, 'qr.bin.update', 'waste_bin', id, b);
      return binFor(c, req, id, 'see');
    });
  });

  app.delete('/api/qr/bins/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      await binFor(c, req, id, 'enter');
      await c.query('UPDATE waste_bin SET active = false WHERE id = $1', [id]);
      await audit(c, req, 'qr.bin.remove', 'waste_bin', id);
      return { ok: true };
    });
  });

  /** The bin behind a label: for the scan page (needs access to the facility). */
  app.get('/api/qr/scan/:code', async (req) => {
    const tenant = requireTenant(req);
    const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/).parse((req.params as { code: string }).code);
    return tenantTx(tenant, async (c) => {
      const r = (await c.query('SELECT id FROM waste_bin WHERE code = $1 AND active', [code])).rows[0];
      if (!r) throw notFound('Bin (the label is not known in this company, or the bin was removed)');
      const bin = await binFor(c, req, r.id, 'see');
      const recent = (await c.query(`SELECT id, kind, kg::float8 AS kg, fill_pct::float8 AS "fillPct", estimated, manifest, flags, at, by_user AS "by", status FROM waste_scan
                                      WHERE bin_id = $1 AND status <> 'void' ORDER BY at DESC LIMIT 5`, [r.id])).rows;
      const s = await scopeOf(c, req.user);
      return { bin, recent, canScan: s.enter.has(bin.facilityId) };
    });
  });

  app.post('/api/qr/bins/:id/scans', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({
      kind: z.enum(['weigh', 'fill', 'collection']), kg: z.number().min(0).max(1e6).optional(), fillPct: z.number().min(0).max(100).optional(),
      manifest: z.string().trim().max(120).optional(), note: z.string().trim().max(500).optional(),
      lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(), at: z.string().datetime().optional(),
    }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const bin = await binFor(c, req, id, 'enter');
      let kg = b.kg, estimated = false;
      if (b.kind === 'fill') {
        if (b.fillPct === undefined) throw new AppError('Enter how full the bin is (%)');
        if (!bin.capacityL || !bin.density) throw new AppError('This bin has no capacity or density set: weigh it, or ask a manager to set them');
        kg = Math.round(bin.capacityL * (b.fillPct / 100) * bin.density * 100) / 100; estimated = true;
      } else if (b.kind === 'weigh' && kg === undefined) throw new AppError('Enter the weight in kg');
      if (b.kind === 'collection') {
        if (bin.hazardous && !b.manifest) throw new AppError('Hazardous waste: enter the manifest number of the collection');
        kg = kg ?? 0;
      }
      if (b.at && new Date(b.at).getTime() > Date.now() + 5 * 60_000) throw new AppError('The time is in the future');
      const flags: string[] = [];
      if (b.kind !== 'collection' && bin.capacityL && bin.density && kg! > bin.capacityL * bin.density * 1.2) flags.push(`More than the bin holds (about ${Math.round(bin.capacityL * bin.density)} kg full)`);
      const near = (await c.query(`SELECT 1 FROM waste_scan WHERE bin_id = $1 AND kind = $2 AND status <> 'void' AND abs(extract(epoch FROM (at - coalesce($3::timestamptz, now())))) < 600`, [id, b.kind, b.at ?? null])).rowCount;
      if (near) flags.push('Same bin scanned less than 10 minutes ago: possible duplicate');
      if (b.kind !== 'collection') {
        const u = (await c.query(`SELECT avg(kg)::float8 AS avg, count(*)::int AS n FROM (SELECT kg FROM waste_scan WHERE bin_id = $1 AND kind <> 'collection' AND status <> 'void' ORDER BY at DESC LIMIT 10) x`, [id])).rows[0];
        if (u.n >= 3 && u.avg > 0 && (kg! > u.avg * 3 || kg! < u.avg / 3)) flags.push(`Far from this bin's usual ${Math.round(u.avg)} kg`);
      }
      const r = (await c.query(
        `INSERT INTO waste_scan (tenant_id, bin_id, facility_id, kind, kg, fill_pct, estimated, manifest, note, lat, lon, flags, at, by_user)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13::timestamptz, now()),$14) RETURNING id, kind, kg::float8 AS kg, estimated, flags, at`,
        [tenant, id, bin.facilityId, b.kind, kg, b.fillPct ?? null, estimated, b.manifest || null, b.note || null, b.lat ?? null, b.lon ?? null, flags, b.at ?? null, req.user.name])).rows[0];
      await audit(c, req, 'qr.scan', 'waste_scan', r.id, { bin: bin.name, kind: b.kind, kg, flags });
      return r;
    });
  });

  app.get('/api/qr/scans', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid(), year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      assertCan((await scopeOf(c, req.user)).see, q.facilityId, 'this facility');
      const { start, end } = monthOf(q.year, q.month);
      return { scans: (await c.query(
        `SELECT s.id, b.name AS bin, i.name AS item, s.kind, s.kg::float8 AS kg, s.fill_pct::float8 AS "fillPct", s.estimated, s.manifest, s.note, s.flags, s.at, s.by_user AS "by", s.status, s.activity_id AS "activityId"
           FROM waste_scan s JOIN waste_bin b ON b.id = s.bin_id JOIN item i ON i.id = b.item_id
          WHERE s.facility_id = $1 AND s.at >= $2::date AND s.at < ($3::date + 1) ORDER BY s.at DESC`, [q.facilityId, start, end])).rows };
    });
  });

  app.post('/api/qr/scans/:id/void', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query('SELECT bin_id, status FROM waste_scan WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('Scan');
      await binFor(c, req, s.bin_id, 'enter');
      if (s.status !== 'open') throw new AppError(s.status === 'rolled' ? 'Already in a waste entry: change the entry instead' : 'Already removed');
      await c.query(`UPDATE waste_scan SET status = 'void' WHERE id = $1`, [id]);
      await audit(c, req, 'qr.scan.void', 'waste_scan', id);
      return { ok: true };
    });
  });

  app.get('/api/qr/rollup', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid(), year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      assertCan((await scopeOf(c, req.user)).see, q.facilityId, 'this facility');
      const r = await rollup(c, q.facilityId, q.year, q.month);
      return { ...r, groups: r.groups.map((g) => ({ ...g, manifests: [...g.manifests], bins: [...g.bins], scans: g.scans.length })) };
    });
  });

  /** Make the month's draft waste entries from the scans not used yet. */
  app.post('/api/qr/rollup', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid(), year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      assertCan((await scopeOf(c, req.user)).enter, q.facilityId, 'enter data for this facility');
      const r = await rollup(c, q.facilityId, q.year, q.month);
      if (!r.groups.length) throw new AppError('No scans to add for this month');
      const made: { item: string; kg: number; dataType: string; id: string | null; warnings: string[] }[] = [];
      for (const g of r.groups) {
        const ref = [...g.manifests].join(', ').slice(0, 120) || undefined;
        const parts = [['actual', g.actual], ['estimated', g.estimated]] as const;
        const ids: string[] = [];
        for (const [dataType, kg] of parts) {
          if (!(kg > 0)) continue;
          const entry = { facilityId: q.facilityId, itemId: g.itemId, unit: 'kg', quantity: Math.round(kg * 100) / 100, periodStart: r.start, periodEnd: r.end, dataType,
            note: `From QR scans · ${[...g.bins].join(', ')}`.slice(0, 1000), wasteInfo: { hazardous: g.hazardous, contractor: g.contractor ?? undefined, ref, ...(g.gri ? { gri: g.gri } : {}) } };
          const b = await runBatch(c, req, t, [entry], false);
          const x = b.results[0]!;
          if (!x.ok) throw new AppError(`${g.item}: ${x.error}`);
          ids.push(x.id!); made.push({ item: g.item, kg, dataType, id: x.id ?? null, warnings: x.warnings ?? [] });
        }
        if (ids.length) await c.query(`UPDATE waste_scan SET status = 'rolled', activity_id = $2 WHERE id = ANY($1)`, [g.scans, ids[0]]);
      }
      await audit(c, req, 'qr.rollup', 'org_node', q.facilityId, { year: q.year, month: q.month, entries: made.length });
      return { made };
    });
  });
}
