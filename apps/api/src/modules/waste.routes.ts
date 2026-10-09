/**
 * Waste: IPCC defaults for the entry screens, and the landfill site register.
 *
 * A landfill's methane in a year comes from all the waste placed in earlier years,
 * so each landfill keeps its tonnage history (per year and waste type) and its
 * parameters (climate, site type / MCF, cover oxidation, composition, values that
 * replace the IPCC defaults). Entries reference the site; when the history or the
 * parameters change, the site's entries can be recalculated.
 *
 * Managed by Super admin, Admin, Manager for facilities they can enter data for.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AD_LEAK_DEFAULT, BIO_DEFAULTS, BO, CLIMATES, DEVICES, INCINERATORS, K_DEFAULT, LANDFILL_MCF, MCF_DISCHARGE, MSW_COMPOSITION_DEFAULT,
  MSW_COMPOSITION_SOURCE, N2O_EFFLUENT, N2O_PLANT, WASTE_TYPES, WW_SYSTEMS, incineratorN2o,
} from '@ekotrace/calc';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { compositionSchema } from './calc.service.js';

const WASTE_CODES = new Set(['msw', ...WASTE_TYPES.map((t) => t.code)]);
const frac = z.number().finite().min(0).max(1);

const paramsSchema = z.object({
  climate: z.enum(Object.keys(CLIMATES) as [string, ...string[]]).optional(),
  siteType: z.enum(Object.keys(LANDFILL_MCF) as [string, ...string[]]).optional(),
  /** MCF typed in, replacing the site type's */
  mcf: frac.optional(),
  ox: frac.optional(),
  f: frac.optional(),
  delayMonths: z.number().min(0).max(6).optional(),
  composition: compositionSchema.optional(),
  overrides: z.record(z.string(), z.object({ doc: frac.optional(), docf: frac.optional(), k: z.number().min(0).max(2).optional() })).optional(),
  /** where the site's values come from (survey, permit, consultant's model) */
  source: z.string().max(300).optional(),
}).refine((p) => !p.composition || Object.values(p.composition).reduce((s, x) => s + x, 0) <= 1.0001, 'The composition must not add up to more than 100%')
  .refine((p) => !p.composition || Object.keys(p.composition).every((k) => WASTE_CODES.has(k) && k !== 'msw'), 'Unknown waste type in the composition')
  .refine((p) => !p.overrides || Object.keys(p.overrides).every((k) => WASTE_CODES.has(k)), 'Unknown waste type in the site values');

const siteBody = z.object({
  facilityId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  openedYear: z.number().int().min(1900).max(2100).optional().nullable(),
  closedYear: z.number().int().min(1900).max(2100).optional().nullable(),
  params: paramsSchema.default({}),
  note: z.string().max(1000).optional().nullable(),
});

const depositRow = z.object({
  year: z.number().int().min(1900).max(2100),
  type: z.string().refine((t) => WASTE_CODES.has(t), 'Unknown waste type'),
  tonnes: z.number().finite().min(0),
  source: z.string().max(200).optional().nullable(),
  estimated: z.boolean().default(false),
});

async function facilityFor(c: Tx, req: FastifyRequest, facilityId: string, manage: boolean) {
  const f = (await c.query(`SELECT id, name FROM org_node WHERE id = $1 AND kind = 'facility'`, [facilityId])).rows[0];
  if (!f) throw notFound('Facility');
  const scope = await scopeOf(c, req.user);
  assertCan(manage ? scope.enter : scope.see, f.id, manage ? 'manage the waste sites of this facility' : 'see this facility');
  return f as { id: string; name: string };
}

const SELECT_SITE = `
  SELECT s.id, s.facility_id, f.name AS facility, s.kind, s.name, s.opened_year, s.closed_year, s.params, s.note, s.active,
         (SELECT count(*)::int FROM activity a WHERE a.waste_site_id = s.id) AS entries,
         (SELECT json_build_object('first', min(d.year), 'last', max(d.year), 'tonnes', COALESCE(sum(d.tonnes), 0), 'rows', count(*))
            FROM waste_deposit d WHERE d.site_id = s.id) AS history
    FROM waste_site s JOIN org_node f ON f.id = s.facility_id`;

export async function wasteRoutes(app: FastifyInstance) {
  /** The IPCC defaults used by the waste screens, with their sources. */
  app.get('/api/waste/defaults', async () => ({
    types: WASTE_TYPES, climates: CLIMATES, k: K_DEFAULT, landfillMcf: LANDFILL_MCF, devices: DEVICES,
    incinerators: Object.fromEntries(Object.entries(INCINERATORS).map(([k, v]) => [k, { ...v, n2oMsw: incineratorN2o('msw', v.batch) }])),
    bio: BIO_DEFAULTS, adLeak: AD_LEAK_DEFAULT, wastewater: WW_SYSTEMS, bo: BO, mcfDischarge: MCF_DISCHARGE, n2oPlant: N2O_PLANT, n2oEffluent: N2O_EFFLUENT,
    msw: { composition: MSW_COMPOSITION_DEFAULT, source: MSW_COMPOSITION_SOURCE },
  }));

  /** Waste sites of a facility (or of every facility the person can see). */
  app.get('/api/waste/sites', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ facilityId: z.string().uuid().optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const rows = (await c.query(`${SELECT_SITE} WHERE ($1::uuid IS NULL OR s.facility_id = $1) ORDER BY f.name, s.name`, [q.facilityId ?? null])).rows;
      return { sites: rows.filter((r) => scope.see.has(r.facility_id)).map((r) => ({ ...r, canEdit: scope.enter.has(r.facility_id) })) };
    });
  });

  app.get('/api/waste/sites/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query(`${SELECT_SITE} WHERE s.id = $1`, [id])).rows[0];
      if (!s) throw notFound('Waste site');
      await facilityFor(c, req, s.facility_id, false);
      const deposits = (await c.query('SELECT id, year, waste_type AS type, tonnes, source, estimated FROM waste_deposit WHERE site_id = $1 ORDER BY year, waste_type', [id])).rows;
      const entries = (await c.query('SELECT id, period_start::text, period_end::text, co2e_direct FROM activity WHERE waste_site_id = $1 ORDER BY period_start', [id])).rows;
      return { ...s, deposits, entryList: entries };
    });
  });

  app.post('/api/waste/sites', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = siteBody.parse(req.body);
    if (b.openedYear && b.closedYear && b.closedYear < b.openedYear) throw new AppError('The site closes before it opens');
    return tenantTx(tenant, async (c) => {
      const f = await facilityFor(c, req, b.facilityId, true);
      const r = (await c.query(
        `INSERT INTO waste_site (tenant_id, facility_id, name, opened_year, closed_year, params, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tenant, f.id, b.name, b.openedYear ?? null, b.closedYear ?? null, JSON.stringify(b.params), b.note ?? null, req.user.id])).rows[0];
      await audit(c, req, 'waste_site.add', 'waste_site', r.id, { facility: f.name, name: b.name, params: b.params });
      return (await c.query(`${SELECT_SITE} WHERE s.id = $1`, [r.id])).rows[0];
    });
  });

  app.patch('/api/waste/sites/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = siteBody.omit({ facilityId: true }).extend({ active: z.boolean().optional() }).parse(req.body);
    if (b.openedYear && b.closedYear && b.closedYear < b.openedYear) throw new AppError('The site closes before it opens');
    return tenantTx(tenant, async (c) => {
      const s = (await c.query('SELECT * FROM waste_site WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('Waste site');
      await facilityFor(c, req, s.facility_id, true);
      await c.query(`UPDATE waste_site SET name=$2, opened_year=$3, closed_year=$4, params=$5, note=$6, active=COALESCE($7, active), updated_at=now() WHERE id=$1`,
        [id, b.name, b.openedYear ?? null, b.closedYear ?? null, JSON.stringify(b.params), b.note ?? null, b.active ?? null]);
      await audit(c, req, 'waste_site.update', 'waste_site', id, { before: s.params, after: b.params });
      return (await c.query(`${SELECT_SITE} WHERE s.id = $1`, [id])).rows[0];
    });
  });

  /** Delete a site with no entries (otherwise set it inactive). */
  app.delete('/api/waste/sites/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query('SELECT * FROM waste_site WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('Waste site');
      await facilityFor(c, req, s.facility_id, true);
      if ((await c.query('SELECT 1 FROM activity WHERE waste_site_id = $1 LIMIT 1', [id])).rowCount) {
        throw new AppError('This site has entries: it cannot be deleted. Set it inactive instead.');
      }
      await c.query('DELETE FROM waste_site WHERE id = $1', [id]);
      await audit(c, req, 'waste_site.delete', 'waste_site', id, { name: s.name });
      return { ok: true };
    });
  });

  /**
   * Save tonnage history rows (pasted or typed): each row sets the tonnes of one
   * waste type in one year (0 removes it). Returns the site's entries so they can
   * be recalculated.
   */
  app.put('/api/waste/sites/:id/deposits', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ rows: z.array(depositRow).min(1).max(2000), replaceAll: z.boolean().default(false) }).parse(req.body);
    const seen = new Set<string>();
    for (const r of b.rows) {
      const k = `${r.year}|${r.type}`;
      if (seen.has(k)) throw new AppError(`${r.year} ${r.type} appears twice`);
      seen.add(k);
    }
    return tenantTx(tenant, async (c) => {
      const s = (await c.query('SELECT * FROM waste_site WHERE id = $1', [id])).rows[0];
      if (!s) throw notFound('Waste site');
      await facilityFor(c, req, s.facility_id, true);
      if (b.replaceAll) await c.query('DELETE FROM waste_deposit WHERE site_id = $1', [id]);
      let saved = 0, removed = 0;
      for (const r of b.rows) {
        if (r.tonnes === 0) { removed += (await c.query('DELETE FROM waste_deposit WHERE site_id = $1 AND year = $2 AND waste_type = $3', [id, r.year, r.type])).rowCount ?? 0; continue; }
        await c.query(
          `INSERT INTO waste_deposit (tenant_id, site_id, year, waste_type, tonnes, source, estimated, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (site_id, year, waste_type) DO UPDATE SET tonnes = EXCLUDED.tonnes, source = EXCLUDED.source, estimated = EXCLUDED.estimated,
             updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [tenant, id, r.year, r.type, r.tonnes, r.source ?? null, r.estimated, req.user.id]);
        saved++;
      }
      await audit(c, req, 'waste_site.history', 'waste_site', id, { rows: b.rows.length, saved, removed, replaceAll: b.replaceAll });
      const entries = (await c.query('SELECT id FROM activity WHERE waste_site_id = $1', [id])).rows.map((r) => r.id as string);
      return { saved, removed, entries };
    });
  });
}
