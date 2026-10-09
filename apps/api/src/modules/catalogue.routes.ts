/**
 * The emission catalogue: category → subcategory → item.
 *
 * Everything here is editable by the platform admin:
 *   add, rename, reorder, move an item to another subcategory, change units.
 * "Remove" deletes a record only if nothing uses it; otherwise it is switched
 * off (hidden from data entry) so that past entries keep their meaning.
 *
 * Each client can additionally hide subcategories or items it does not use
 * (PUT /api/catalogue/visibility), without affecting other clients.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, tx, tenantTx } from '../db/pool.js';
import { requirePlatformAdmin, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';

const code = z.string().regex(/^[a-z0-9_:.-]{2,60}$/, 'lower-case letters, digits, _ : . - only');
const unitList = z.array(z.string()).max(40);

export async function catalogueRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- read --
  app.get('/api/catalogue', async (req) => {
    const q = z.object({ all: z.coerce.boolean().optional(), category: z.string().optional() }).parse(req.query);
    const showAll = q.all && req.user.role === 'platform_admin';
    const tenant = req.user.tenantId;
    const hidden = tenant
      ? await tenantTx(tenant, async (c) => (await c.query('SELECT subcategory_id, item_id FROM tenant_catalogue WHERE NOT enabled')).rows)
      : [];
    const hiddenSub = new Set(hidden.map((h) => h.subcategory_id).filter(Boolean));
    const hiddenItem = new Set(hidden.map((h) => h.item_id).filter(Boolean));

    const cats = await query(`SELECT id, scope, code, name, calc_method, description, sort, active FROM category
                               WHERE ($1 OR active) AND ($2::text IS NULL OR code = $2) ORDER BY scope, sort, id`, [showAll, q.category ?? null]);
    const subs = await query(`SELECT id, category_id, code, name, units, default_unit, is_bioenergy, sort, active FROM subcategory
                               WHERE ($1 OR active) ORDER BY sort, id`, [showAll]);
    const items = await query(`SELECT i.id, i.subcategory_id, i.code, i.name, i.aliases, i.default_unit, i.gas_code, i.note, i.sort, i.active,
                                      (SELECT json_agg(json_build_object('gas', g.gas, 'fraction', g.fraction) ORDER BY g.fraction DESC)
                                         FROM item_gas g WHERE g.item_id = i.id) AS composition
                                 FROM item i WHERE ($1 OR i.active) ORDER BY i.sort, i.name`, [showAll]);
    return {
      categories: cats.map((c) => ({
        ...c,
        subcategories: subs.filter((s) => s.category_id === c.id && (showAll || !hiddenSub.has(s.id))).map((s) => ({
          ...s,
          hiddenForClient: hiddenSub.has(s.id),
          items: items.filter((i) => i.subcategory_id === s.id && (showAll || !hiddenItem.has(i.id))).map((i) => ({ ...i, hiddenForClient: hiddenItem.has(i.id) })),
        })),
      })),
    };
  });

  /**
   * Units a user may enter for an item: the subcategory's list, limited to
   * dimensions the item has a factor for (combustion). Fugitive items take any
   * listed mass unit. Default first.
   */
  app.get('/api/items/:id/units', async (req) => {
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const [it] = await query(
      `SELECT i.id, i.default_unit, s.units, s.default_unit AS sub_default, c.calc_method
         FROM item i JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id WHERE i.id = $1`, [id]);
    if (!it) throw notFound('Item');
    const rows = await query(
      `SELECT u.code, u.name, u.dimension FROM unit u
        WHERE u.active AND (cardinality($2::text[]) = 0 OR u.code = ANY($2))
          AND ($3 = 'fugitive' AND u.dimension = 'mass'
               OR u.dimension IN (SELECT DISTINCT uu.dimension FROM factor f JOIN unit uu ON uu.code = f.unit
                                   WHERE f.item_id = $1 AND f.status = 'active' AND f.basis = 'direct'))
        ORDER BY u.sort, u.code`, [id, it.units, it.calc_method]);
    const def = [it.default_unit, it.sub_default].find((d) => d && rows.some((r) => r.code === d)) ?? rows[0]?.code ?? null;
    return { units: rows, defaultUnit: def };
  });

  // ---------------------------------------------------------- categories --
  app.post('/api/admin/categories', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({ scope: z.number().int().min(1).max(3), code, name: z.string().min(2).max(120), calcMethod: z.enum(['combustion', 'fugitive']), description: z.string().max(500).optional(), sort: z.number().int().optional() }).parse(req.body);
    const [r] = await query('INSERT INTO category (scope, code, name, calc_method, description, sort) VALUES ($1,$2,$3,$4,$5,COALESCE($6,100)) RETURNING *', [b.scope, b.code, b.name, b.calcMethod, b.description ?? null, b.sort ?? null]);
    return r;
  });

  app.patch('/api/admin/categories/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().min(2).max(120).optional(), description: z.string().max(500).nullable().optional(), sort: z.number().int().optional(), active: z.boolean().optional() }).parse(req.body);
    const [r] = await query(`UPDATE category SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
                               sort = COALESCE($5, sort), active = COALESCE($6, active) WHERE id = $1 RETURNING *`,
      [id, b.name ?? null, b.description !== undefined, b.description ?? null, b.sort ?? null, b.active ?? null]);
    if (!r) throw notFound('Category');
    return r;
  });

  app.delete('/api/admin/categories/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    return removeOrSwitchOff('category', id, 'SELECT 1 FROM subcategory WHERE category_id = $1 UNION ALL SELECT 1 FROM activity WHERE category_id = $1');
  });

  // ------------------------------------------------------- subcategories --
  app.post('/api/admin/subcategories', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({ categoryId: z.number().int(), code, name: z.string().min(2).max(120), units: unitList.default([]), defaultUnit: z.string().nullable().optional(), isBioenergy: z.boolean().default(false), sort: z.number().int().optional() }).parse(req.body);
    await checkUnits([...b.units, ...(b.defaultUnit ? [b.defaultUnit] : [])]);
    const [r] = await query(`INSERT INTO subcategory (category_id, code, name, units, default_unit, is_bioenergy, sort)
                              VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,100)) RETURNING *`,
      [b.categoryId, b.code, b.name, b.units, b.defaultUnit ?? null, b.isBioenergy, b.sort ?? null]);
    return r;
  });

  app.patch('/api/admin/subcategories/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const b = z.object({ name: z.string().min(2).max(120).optional(), units: unitList.optional(), defaultUnit: z.string().nullable().optional(), isBioenergy: z.boolean().optional(), sort: z.number().int().optional(), active: z.boolean().optional() }).parse(req.body);
    await checkUnits([...(b.units ?? []), ...(b.defaultUnit ? [b.defaultUnit] : [])]);
    const [r] = await query(`UPDATE subcategory SET name = COALESCE($2, name), units = COALESCE($3, units),
                               default_unit = CASE WHEN $4::boolean THEN $5 ELSE default_unit END,
                               is_bioenergy = COALESCE($6, is_bioenergy), sort = COALESCE($7, sort), active = COALESCE($8, active)
                             WHERE id = $1 RETURNING *`,
      [id, b.name ?? null, b.units ?? null, b.defaultUnit !== undefined, b.defaultUnit ?? null, b.isBioenergy ?? null, b.sort ?? null, b.active ?? null]);
    if (!r) throw notFound('Subcategory');
    return r;
  });

  app.delete('/api/admin/subcategories/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    return removeOrSwitchOff('subcategory', id, 'SELECT 1 FROM item WHERE subcategory_id = $1');
  });

  // --------------------------------------------------------------- items --
  const composition = z.array(z.object({ gas: z.string(), fraction: z.number().gt(0).lte(1) })).max(10);

  app.post('/api/admin/items', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({
      subcategoryId: z.number().int(), name: z.string().min(1).max(160), code: code.optional(), aliases: z.array(z.string().max(160)).max(20).default([]),
      defaultUnit: z.string().nullable().optional(), gasCode: z.string().nullable().optional(), note: z.string().max(500).optional(), composition: composition.optional(),
    }).parse(req.body);
    if (b.defaultUnit) await checkUnits([b.defaultUnit]);
    checkComposition(b.composition);
    return tx(async (c) => {
      const itemCode = b.code ?? `custom:${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const r = (await c.query(`INSERT INTO item (subcategory_id, code, name, aliases, default_unit, gas_code, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [b.subcategoryId, itemCode, b.name, b.aliases, b.defaultUnit ?? null, b.gasCode ?? null, b.note ?? null])).rows[0];
      for (const g of b.composition ?? []) await c.query('INSERT INTO item_gas (item_id, gas, fraction, source) VALUES ($1,$2,$3,$4)', [r.id, g.gas, g.fraction, 'admin']);
      return r;
    });
  });

  app.patch('/api/admin/items/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const b = z.object({
      name: z.string().min(1).max(160).optional(), subcategoryId: z.number().int().optional(), aliases: z.array(z.string().max(160)).max(20).optional(),
      defaultUnit: z.string().nullable().optional(), sort: z.number().int().optional(), active: z.boolean().optional(), note: z.string().max(500).nullable().optional(),
      composition: composition.optional(),
    }).parse(req.body);
    if (b.defaultUnit) await checkUnits([b.defaultUnit]);
    checkComposition(b.composition);
    return tx(async (c) => {
      const r = (await c.query(`UPDATE item SET name = COALESCE($2, name), subcategory_id = COALESCE($3, subcategory_id), aliases = COALESCE($4, aliases),
                                  default_unit = CASE WHEN $5::boolean THEN $6 ELSE default_unit END, sort = COALESCE($7, sort), active = COALESCE($8, active),
                                  note = CASE WHEN $9::boolean THEN $10 ELSE note END
                                WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.subcategoryId ?? null, b.aliases ?? null, b.defaultUnit !== undefined, b.defaultUnit ?? null, b.sort ?? null, b.active ?? null, b.note !== undefined, b.note ?? null])).rows[0];
      if (!r) throw notFound('Item');
      if (b.composition) {
        await c.query('DELETE FROM item_gas WHERE item_id = $1', [id]);
        for (const g of b.composition) await c.query('INSERT INTO item_gas (item_id, gas, fraction, source) VALUES ($1,$2,$3,$4)', [id, g.gas, g.fraction, 'admin']);
      }
      return r;
    });
  });

  app.delete('/api/admin/items/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    return removeOrSwitchOff('item', id, 'SELECT 1 FROM factor WHERE item_id = $1 UNION ALL SELECT 1 FROM activity WHERE item_id = $1');
  });

  // ------------------------------------------------- per-client visibility --
  app.put('/api/catalogue/visibility', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ subcategoryId: z.number().int().optional(), itemId: z.number().int().optional(), enabled: z.boolean() })
      .refine((v) => (v.subcategoryId == null) !== (v.itemId == null), 'Give either subcategoryId or itemId').parse(req.body);
    return tenantTx(tenant, async (c) => {
      const conflict = b.subcategoryId != null ? '(tenant_id, subcategory_id) WHERE subcategory_id IS NOT NULL' : '(tenant_id, item_id) WHERE item_id IS NOT NULL';
      await c.query(`INSERT INTO tenant_catalogue (tenant_id, subcategory_id, item_id, enabled) VALUES ($1,$2,$3,$4)
                     ON CONFLICT ${conflict} DO UPDATE SET enabled = EXCLUDED.enabled`, [tenant, b.subcategoryId ?? null, b.itemId ?? null, b.enabled]);
      return { ok: true };
    });
  });
}

/** Delete when unused; otherwise switch off and say so. */
async function removeOrSwitchOff(table: 'category' | 'subcategory' | 'item', id: number, usedSql: string) {
  const used = await query(`SELECT EXISTS (${usedSql}) AS used`, [id]);
  if (used[0]?.used) {
    const [r] = await query(`UPDATE ${table} SET active = false WHERE id = $1 RETURNING id`, [id]);
    if (!r) throw notFound(table);
    return { removed: false, switchedOff: true, message: 'It is in use, so it was switched off instead: hidden from data entry, history kept.' };
  }
  const [r] = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
  if (!r) throw notFound(table);
  return { removed: true, switchedOff: false };
}

async function checkUnits(codes: string[]) {
  if (!codes.length) return;
  const found = new Set((await query<{ code: string }>('SELECT code FROM unit WHERE code = ANY($1)', [codes])).map((r) => r.code));
  const missing = codes.filter((c) => !found.has(c));
  if (missing.length) throw new AppError(`Unknown unit(s): ${missing.join(', ')}`);
}

function checkComposition(c?: { gas: string; fraction: number }[]) {
  if (!c?.length) return;
  const sum = c.reduce((s, g) => s + g.fraction, 0);
  if (Math.abs(sum - 1) > 0.001) throw new AppError(`The composition adds up to ${(sum * 100).toFixed(2)} %, not 100 %`);
}
