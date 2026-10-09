/**
 * Scope 2 reference data and registers.
 *
 *   Grid regions        country averages and sub-regions (emirate / state / grid); platform admin
 *                       adds regions and their factors (location-based, residual mix, T&D loss, upstream).
 *   Supplier factors    market-based factor of a utility / district-cooling / heat supplier per period;
 *                       shared list (platform admin) and each company's own.
 *   Certificates        I-REC / REC / GO, PPAs, green tariffs the company holds; claimed per entry,
 *                       never more than the MWh held.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { platformTx, query, tenantTx, tx, type Tx } from '../db/pool.js';
import { audit, requirePlatformAdmin, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { scopeOf } from '../lib/access.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const regionCode = z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,10})?$/, 'Region code like AE or AE-DU');

export async function energyRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ grid regions --
  /** Regions with the factors each has (per year), for pickers and the library. */
  app.get('/api/grid-regions', async () => {
    const regions = await query(
      `SELECT g.code, g.country, g.name, g.kind, g.note, g.active,
              (SELECT json_agg(json_build_object('id', f.id, 'basis', f.basis, 'year', extract(year FROM f.valid_from)::int, 'co2e', f.co2e, 'unit', f.unit,
                                                 'source', replace(s.code, '-', ' '), 'title', s.title, 'note', f.note) ORDER BY f.valid_from DESC, f.basis)
                 FROM factor f JOIN factor_source s ON s.id = f.source_id JOIN item i ON i.id = f.item_id
                WHERE i.code = 'grid:electricity' AND f.region = g.code AND f.status = 'active') AS factors
         FROM grid_region g ORDER BY g.country, g.kind <> 'country', g.code`);
    return { regions };
  });

  app.post('/api/grid-regions', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({ code: regionCode, name: z.string().trim().min(2).max(120), kind: z.enum(['country', 'subnational', 'grid']), note: z.string().max(300).optional() }).parse(req.body);
    if (b.kind === 'country' && b.code.length !== 2) throw new AppError('A country region has a 2-letter code');
    if (b.kind !== 'country' && b.code.length === 2) throw new AppError('A sub-region code is the country code, a dash and the region (e.g. AE-DU)');
    return tx(async (c) => (await c.query(
      `INSERT INTO grid_region (code, country, name, kind, note) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, note = EXCLUDED.note RETURNING *`,
      [b.code, b.code.slice(0, 2), b.name, b.kind, b.note ?? null])).rows[0]);
  });

  /**
   * Add a factor for a region and year (platform admin): location-based grid factor,
   * residual mix (market-based), T&D losses (as kg/kWh, or as a loss % of the grid
   * factor), upstream (well-to-tank).
   */
  app.post('/api/grid-regions/:code/factors', async (req) => {
    requirePlatformAdmin(req);
    const code = regionCode.parse((req.params as { code: string }).code);
    const b = z.object({
      kind: z.enum(['location', 'residual', 'td_loss', 'wtt']),
      year: z.number().int().min(2000).max(2100),
      co2e: z.number().finite().min(0).optional(),
      /** T&D only: losses as % of electricity delivered; × the region's grid factor of that year */
      lossPct: z.number().min(0).max(50).optional(),
      source: z.string().trim().min(2).max(40),
      reference: z.string().trim().max(200).optional(),
    }).parse(req.body);
    const basis = { location: 'scope2', residual: 'scope2_market', td_loss: 'td_loss', wtt: 'wtt' }[b.kind];
    return tx(async (c) => {
      const region = (await c.query('SELECT code FROM grid_region WHERE code = $1', [code])).rows[0];
      if (!region) throw notFound('Grid region');
      const item = (await c.query(`SELECT id FROM item WHERE code = 'grid:electricity'`)).rows[0].id;
      let co2e = b.co2e;
      let note: string | null = null;
      if (b.kind === 'td_loss' && b.lossPct !== undefined) {
        const g = (await c.query(`SELECT co2e FROM factor WHERE item_id = $1 AND region = $2 AND basis = 'scope2' AND status = 'active' AND extract(year FROM valid_from) = $3`, [item, code, b.year])).rows[0];
        if (!g) throw new AppError(`Add the ${b.year} grid factor of ${code} first: T&D losses are a % of it`);
        co2e = Number(g.co2e) * b.lossPct / 100;
        note = `${b.lossPct}% losses × grid factor ${Number(g.co2e)} kg CO2e/kWh`;
      }
      if (co2e === undefined) throw new AppError('Give the factor (kg CO2e per kWh)');
      const src = (await c.query(`INSERT INTO factor_source (code, publisher, title) VALUES ($1,'Platform admin',COALESCE($2,$1))
                                  ON CONFLICT (code) DO UPDATE SET title = COALESCE($2, factor_source.title) RETURNING id`, [b.source, b.reference ?? null])).rows[0].id;
      const prev = (await c.query(`UPDATE factor SET status = 'superseded' WHERE item_id=$1 AND region=$2 AND basis=$3 AND unit='kWh_e' AND valid_from=$4 AND status='active' RETURNING id, version`,
        [item, code, basis, `${b.year}-01-01`])).rows[0];
      const f = (await c.query(`INSERT INTO factor (item_id, source_id, region, basis, unit, co2e, valid_from, valid_to, version, supersedes_id, note, created_by)
                                VALUES ($1,$2,$3,$4,'kWh_e',$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [item, src, code, basis, co2e, `${b.year}-01-01`, `${b.year}-12-31`, (prev?.version ?? 0) + 1, prev?.id ?? null, note, req.user.id])).rows[0];
      await c.query("SELECT pg_notify('refdata_changed', 'grid')");
      return { id: f.id, co2e, replaced: prev?.id ?? null };
    });
  });

  // --------------------------------------------------------- supplier factors --
  app.get('/api/supplier-factors', async (req) => {
    const q = z.object({ energy: z.enum(['electricity', 'heat', 'cooling']).optional() }).parse(req.query);
    const run = async (c: Tx) => (await c.query(
      `SELECT id, tenant_id IS NULL AS shared, supplier, energy, region, co2e, unit, renewable_pct, valid_from::text, valid_to::text, source, created_at
         FROM supplier_factor WHERE ($1::text IS NULL OR energy = $1) ORDER BY energy, supplier, valid_from DESC`, [q.energy ?? null])).rows;
    return { suppliers: req.user.tenantId ? await tenantTx(req.user.tenantId, run) : await platformTx(run) };
  });

  const supplierBody = z.object({
    supplier: z.string().trim().min(2).max(120), energy: z.enum(['electricity', 'heat', 'cooling']), region: regionCode.optional(),
    co2e: z.number().finite().min(0), unit: z.string().min(1), renewablePct: z.number().min(0).max(100).optional(),
    validFrom: isoDate, validTo: isoDate, source: z.string().trim().min(2).max(200),
  }).refine((b) => b.validTo >= b.validFrom, { message: 'The end date is before the start date' });

  app.post('/api/supplier-factors', async (req) => {
    const b = supplierBody.parse(req.body);
    const [u] = await query<{ dimension: string }>('SELECT dimension FROM unit WHERE code = $1', [b.unit]);
    if (!u || u.dimension !== b.energy) throw new AppError(`The factor must be per unit of ${b.energy}`);
    const insert = async (c: Tx, tenant: string | null) => {
      const r = (await c.query(
        `INSERT INTO supplier_factor (tenant_id, supplier, energy, region, co2e, unit, renewable_pct, valid_from, valid_to, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tenant, b.supplier, b.energy, b.region ?? null, b.co2e, b.unit, b.renewablePct ?? null, b.validFrom, b.validTo, b.source, req.user.id])).rows[0];
      if (tenant) await audit(c, req, 'supplier_factor.add', 'supplier_factor', r.id, b);
      return r;
    };
    if (!req.user.tenantId) { requirePlatformAdmin(req); return platformTx((c) => insert(c, null)); }
    requireRole(req, 'super_admin', 'admin');
    return tenantTx(req.user.tenantId, (c) => insert(c, req.user.tenantId!));
  });

  app.delete('/api/supplier-factors/:id', async (req) => {
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const del = async (c: Tx) => {
      const used = (await c.query(`SELECT 1 FROM activity WHERE inputs->'energy'->>'supplierFactorId' = $1 LIMIT 1`, [id])).rowCount;
      if (used) throw new AppError('Entries use this factor: it cannot be deleted. Add a corrected factor for the period instead.');
      const r = await c.query(`DELETE FROM supplier_factor WHERE id = $1 AND ${req.user.tenantId ? 'tenant_id IS NOT NULL' : 'tenant_id IS NULL'} RETURNING id`, [id]);
      if (!r.rowCount) throw notFound('Supplier factor');
      return { ok: true };
    };
    if (!req.user.tenantId) { requirePlatformAdmin(req); return platformTx(del); }
    requireRole(req, 'super_admin', 'admin');
    return tenantTx(req.user.tenantId, del);
  });

  // ------------------------------------------------------------- certificates --
  const SELECT_CERT = `
    SELECT e.id, e.facility_id, f.name AS facility, e.instrument, e.standard, e.technology, e.mwh, e.co2e_per_kwh, e.market,
           e.vintage_from::text, e.vintage_to::text, e.reference, e.supplier, e.retired_on::text, e.note, e.created_at,
           COALESCE((SELECT sum(k.kwh) FROM certificate_claim k WHERE k.certificate_id = e.id), 0) / 1000 AS claimed_mwh,
           (SELECT count(*)::int FROM certificate_claim k WHERE k.certificate_id = e.id) AS claims
      FROM energy_certificate e LEFT JOIN org_node f ON f.id = e.facility_id`;

  /** Certificates and contracts; with facilityId + date, only those usable there with MWh left. */
  app.get('/api/certificates', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional(), usable: z.coerce.boolean().optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const see = (await scopeOf(c, req.user)).see;
      const rows = (await c.query(`${SELECT_CERT} WHERE ($1::uuid IS NULL OR e.facility_id IS NULL OR e.facility_id = $1) ORDER BY e.vintage_from DESC, e.created_at DESC`, [q.facilityId ?? null])).rows
        .filter((r) => !r.facility_id || see.has(r.facility_id))
        .filter((r) => !q.usable || Number(r.mwh) - Number(r.claimed_mwh) > 1e-9);
      return { certificates: rows };
    });
  });

  const certBody = z.object({
    facilityId: z.string().uuid().nullable().optional(),
    instrument: z.enum(['certificate', 'ppa', 'green_tariff', 'other']),
    standard: z.string().trim().max(40).optional().nullable(),
    technology: z.enum(['solar', 'wind', 'hydro', 'biomass', 'biogas', 'geothermal', 'nuclear', 'other']),
    mwh: z.number().finite().positive(),
    co2ePerKwh: z.number().finite().min(0).default(0),
    market: z.string().length(2).transform((s) => s.toUpperCase()),
    vintageFrom: isoDate, vintageTo: isoDate,
    reference: z.string().trim().max(500).optional().nullable(),
    supplier: z.string().trim().max(120).optional().nullable(),
    retiredOn: isoDate.optional().nullable(),
    note: z.string().max(1000).optional().nullable(),
  }).refine((b) => b.vintageTo >= b.vintageFrom, { message: 'The vintage end is before its start' });

  app.post('/api/certificates', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const b = certBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (b.facilityId && !(await c.query(`SELECT 1 FROM org_node WHERE id = $1 AND kind = 'facility'`, [b.facilityId])).rowCount) throw notFound('Facility');
      const r = (await c.query(
        `INSERT INTO energy_certificate (tenant_id, facility_id, instrument, standard, technology, mwh, co2e_per_kwh, market, vintage_from, vintage_to, reference, supplier, retired_on, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [tenant, b.facilityId ?? null, b.instrument, b.standard ?? null, b.technology, b.mwh, b.co2ePerKwh, b.market, b.vintageFrom, b.vintageTo, b.reference ?? null, b.supplier ?? null, b.retiredOn ?? null, b.note ?? null, req.user.id])).rows[0];
      await audit(c, req, 'certificate.add', 'energy_certificate', r.id, b);
      return (await c.query(`${SELECT_CERT} WHERE e.id = $1`, [r.id])).rows[0];
    });
  });

  /** Edit; the MWh can never go below what entries have already claimed. */
  app.patch('/api/certificates/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = certBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const cur = (await c.query(`${SELECT_CERT} WHERE e.id = $1 FOR UPDATE OF e`, [id])).rows[0];
      if (!cur) throw notFound('Certificate');
      if (b.mwh < Number(cur.claimed_mwh) - 1e-9) throw new AppError(`Entries already claim ${Number(cur.claimed_mwh).toLocaleString('en')} MWh of it`);
      if (cur.claims && (b.co2ePerKwh !== Number(cur.co2e_per_kwh) || b.technology !== cur.technology)) {
        throw new AppError('Entries claim this certificate: its technology and factor cannot change (they would change saved results).');
      }
      await c.query(
        `UPDATE energy_certificate SET facility_id=$2, instrument=$3, standard=$4, technology=$5, mwh=$6, co2e_per_kwh=$7, market=$8, vintage_from=$9, vintage_to=$10,
                reference=$11, supplier=$12, retired_on=$13, note=$14 WHERE id=$1`,
        [id, b.facilityId ?? null, b.instrument, b.standard ?? null, b.technology, b.mwh, b.co2ePerKwh, b.market, b.vintageFrom, b.vintageTo, b.reference ?? null, b.supplier ?? null, b.retiredOn ?? null, b.note ?? null]);
      await audit(c, req, 'certificate.update', 'energy_certificate', id, b);
      return (await c.query(`${SELECT_CERT} WHERE e.id = $1`, [id])).rows[0];
    });
  });

  app.delete('/api/certificates/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      if ((await c.query('SELECT 1 FROM certificate_claim WHERE certificate_id = $1 LIMIT 1', [id])).rowCount) throw new AppError('Entries claim this certificate: it cannot be deleted');
      const r = await c.query('DELETE FROM energy_certificate WHERE id = $1 RETURNING id', [id]);
      if (!r.rowCount) throw notFound('Certificate');
      await audit(c, req, 'certificate.delete', 'energy_certificate', id, {});
      return { ok: true };
    });
  });

  /** Which entries claim a certificate. */
  app.get('/api/certificates/:id/claims', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => ({
      claims: (await c.query(
        `SELECT k.kwh, a.id AS activity_id, a.period_start::text, f.name AS facility FROM certificate_claim k JOIN activity a ON a.id = k.activity_id JOIN org_node f ON f.id = a.facility_id
          WHERE k.certificate_id = $1 ORDER BY a.period_start`, [id])).rows,
    }));
  });
}
