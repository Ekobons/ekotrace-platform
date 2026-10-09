/**
 * Units (the conversion matrix), gases and GWP sets.
 *
 * The unit matrix is one number per unit — its size in the base unit of its
 * dimension. Changing it changes every conversion involving that unit, so the
 * matrix can never become inconsistent.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requirePlatformAdmin } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { invalidateRefdata } from './refdata.js';

const notify = () => query("SELECT pg_notify('refdata_changed', 'unit')").then(invalidateRefdata);

export async function referenceRoutes(app: FastifyInstance) {
  app.get('/api/units', async () => ({
    units: await query('SELECT code, name, dimension, to_base, is_base, aliases, sort, active FROM unit ORDER BY dimension, sort, code'),
  }));

  app.post('/api/admin/units', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({
      code: z.string().regex(/^[A-Za-z0-9_³]{1,20}$/), name: z.string().min(1).max(60), dimension: z.string().regex(/^[a-z_]{2,30}$/),
      toBase: z.number().positive().finite(), aliases: z.array(z.string().max(40)).max(10).default([]),
    }).parse(req.body);
    const base = await query('SELECT code FROM unit WHERE dimension = $1 AND is_base', [b.dimension]);
    const [r] = await query('INSERT INTO unit (code, name, dimension, to_base, is_base, aliases) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [b.code, b.name, b.dimension, base.length ? b.toBase : 1, base.length === 0, b.aliases]);
    await notify();
    return r;
  });

  app.patch('/api/admin/units/:code', async (req) => {
    requirePlatformAdmin(req);
    const codeParam = (req.params as { code: string }).code;
    const b = z.object({ name: z.string().min(1).max(60).optional(), toBase: z.number().positive().finite().optional(), active: z.boolean().optional(), aliases: z.array(z.string().max(40)).max(10).optional() }).parse(req.body);
    const [u] = await query('SELECT is_base FROM unit WHERE code = $1', [codeParam]);
    if (!u) throw notFound('Unit');
    if (u.is_base && b.toBase !== undefined && b.toBase !== 1) throw new AppError('A base unit is always 1; change the other units of the dimension instead');
    const [r] = await query(`UPDATE unit SET name = COALESCE($2, name), to_base = COALESCE($3, to_base), active = COALESCE($4, active),
                               aliases = COALESCE($5, aliases), updated_at = now() WHERE code = $1 RETURNING *`,
      [codeParam, b.name ?? null, b.toBase ?? null, b.active ?? null, b.aliases ?? null]);
    await notify();
    return r;
  });

  app.get('/api/gases', async () => ({
    gases: await query(`SELECT g.code, g.name, g.formula, g.family, g.kyoto,
                               jsonb_object_agg(v.gwp_set, v.value) FILTER (WHERE v.gwp_set IS NOT NULL) AS gwp
                          FROM gas g LEFT JOIN gwp_value v ON v.gas = g.code GROUP BY g.code ORDER BY g.sort`),
    gwpSets: await query('SELECT code, name, note FROM gwp_set ORDER BY code'),
  }));
}
