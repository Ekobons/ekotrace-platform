/**
 * Product LCA (product carbon footprints · ISO 14067, GHG Protocol Product Standard).
 *
 *   GET    /api/lca                                products with footprint, stage split and data quality; library; counts
 *   GET    /api/lca/products/:id                   one model: inputs, result, hotspots, levers, scenarios, versions
 *   POST   /api/lca/products                       new model (optionally a copy of another)
 *   PUT    /api/lca/products/:id                   goal & scope
 *   DELETE /api/lca/products/:id                   remove a model that was never published
 *   POST   /api/lca/products/:id/inputs            add an inventory line;  PUT/DELETE /api/lca/inputs/:id
 *   POST   /api/lca/products/:id/import            bill of materials from pasted text or CSV: preview, then commit
 *   POST   /api/lca/products/:id/scenarios         what-if;  PUT/DELETE /api/lca/scenarios/:id
 *   POST   /api/lca/products/:id/submit            send for review (anyone who edits models)
 *   POST   /api/lca/products/:id/verify            verify or return: super admin, admin or verifier who did not edit or send it
 *   POST   /api/lca/products/:id/publish           publish the verified model as version n+1 (super admin, admin);
 *                                                  a supplier's product becomes that supplier's factor for purchases
 *   POST   /api/lca/library                        the company's own inventory factor;  PUT/DELETE /api/lca/library/:id
 *
 * Any change to a verified or published model returns it to draft; the published factor stays in use until the
 * next version is published.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { notify } from '../lib/notify.js';
import { applyScenario, BOUNDARIES, DQ, DQ_LABEL, footprint, levers, matchLibrary, normUnit, stageOf, STAGES, type Change, type Line } from '../lib/lca.js';
import { recalcSupplier } from './purchases/suppliers.routes.js';

const EDIT = ['super_admin', 'admin', 'manager', 'preparer'] as const;
const STAGE = z.enum(Object.keys(STAGES) as [string, ...string[]]);
const DQS = z.enum(Object.keys(DQ) as [string, ...string[]]);
const uuid = z.string().uuid();
const canEdit = (req: FastifyRequest) => (EDIT as readonly string[]).includes(req.user.role) || req.user.role === 'platform_admin';

type Lib = { id: string; code: string; name: string; unit: string; co2e: number; stage: string; source: string; indicative: boolean; own: boolean };
async function library(c: Tx): Promise<Lib[]> {
  return (await c.query(`SELECT id, code, name, unit, co2e::float8 AS co2e, stage, source, indicative, tenant_id IS NOT NULL AS own FROM lci_factor WHERE active
                          ORDER BY array_position(ARRAY['raw','packaging','manufacturing','transport','use','eol'], stage), tenant_id IS NULL, name`)).rows;
}
async function inputs(c: Tx, productIds: string[]): Promise<(Line & { product_id: string; position: number; lci_name: string | null })[]> {
  return (await c.query(`SELECT i.id, i.product_id, i.position, i.name, i.stage, i.qty::float8 AS qty, i.unit, i.co2e_per_unit::float8 AS co2e_per_unit, i.lci_id, f.name AS lci_name, i.dq, i.source
                           FROM lca_input i LEFT JOIN lci_factor f ON f.id = i.lci_id WHERE i.product_id = ANY($1) ORDER BY i.position, i.name`, [productIds])).rows;
}
const PRODUCT_SQL = `SELECT p.*, p.published_factor::float8 AS published_factor, s.name AS supplier, i.name AS item,
         (SELECT count(*)::int FROM purchase_line l WHERE p.supplier_ef_id IS NOT NULL AND l.supplier_ef_id = p.supplier_ef_id) AS lines
    FROM lca_product p LEFT JOIN supplier s ON s.id = p.supplier_id LEFT JOIN item i ON i.id = p.item_id`;

async function product(c: Tx, id: string) {
  const p = (await c.query(`${PRODUCT_SQL} WHERE p.id = $1`, [id])).rows[0];
  if (!p) throw notFound('Product');
  return p;
}

/** A change to the model: back to draft (the published factor stays until the next version). */
async function touched(c: Tx, req: FastifyRequest, id: string) {
  await c.query(`UPDATE lca_product SET status = 'draft', verified_by = NULL, verified_name = NULL, verified_at = NULL, last_edit_by = $2, last_edit_name = $3, updated_at = now(),
                        changed_since_publish = (version > 0) WHERE id = $1`, [id, req.user.id, req.user.name]);
}

const productBody = z.object({
  name: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).default(''),
  supplierId: uuid.nullable().default(null), itemId: z.number().int().positive().nullable().default(null),
  declaredUnit: z.string().trim().min(1).max(20).default('t'), fu: z.string().trim().min(2).max(300),
  boundary: z.enum(Object.keys(BOUNDARIES) as [string, ...string[]]).default('cradle_to_gate'),
  standard: z.string().trim().min(2).max(200).default('ISO 14067 / GHG Protocol Product Standard'),
  allocation: z.string().trim().min(2).max(200).default('Mass allocation'), cutoff: z.string().trim().min(1).max(200).default('1% of mass'),
  refYear: z.number().int().min(1990).max(2100), notes: z.string().trim().max(4000).default(''),
});
const inputBody = z.object({
  name: z.string().trim().min(1).max(200), stage: STAGE, qty: z.number().finite().min(0).max(1e12), unit: z.string().trim().min(1).max(20),
  co2ePerUnit: z.number().finite().min(0).max(1e9).nullable().default(null), lciId: uuid.nullable().default(null),
  dq: DQS.default('estimated'), source: z.string().trim().max(300).default(''),
});
const changeSchema = z.object({ inputId: uuid, lciId: uuid.nullable().optional(), qty: z.number().finite().min(0).max(1e12).nullable().optional(), co2e: z.number().finite().min(0).max(1e9).nullable().optional() });
const scenarioBody = z.object({ name: z.string().trim().min(2).max(200), changes: z.array(changeSchema).max(200) });

async function declared(c: Tx, u: string) {
  const x = (await c.query(`SELECT code, dimension FROM unit WHERE code = $1 OR $1 = ANY(aliases)`, [u])).rows[0];
  if (!x || x.dimension.startsWith('money_')) throw new AppError(`Declared unit "${u}" is not known: use t, kg, pcs, L, m3 or kWh`);
  return x.code as string;
}
async function checkRefs(c: Tx, b: z.infer<typeof productBody>) {
  if (b.supplierId && !(await c.query(`SELECT 1 FROM supplier WHERE id = $1`, [b.supplierId])).rowCount) throw notFound('Supplier');
  if (b.itemId && !(await c.query(`SELECT 1 FROM item WHERE id = $1`, [b.itemId])).rowCount) throw notFound('Spend category');
}

/** One model with everything the workspace shows. */
async function detail(c: Tx, req: FastifyRequest, id: string) {
  const p = await product(c, id);
  const lib = await library(c);
  const libMap = new Map(lib.map((f) => [f.id, f]));
  const L = await inputs(c, [id]);
  const res = footprint(L, p.boundary);
  const scen = (await c.query(`SELECT id, name, changes, created_name, created_at FROM lca_scenario WHERE product_id = $1 ORDER BY created_at`, [id])).rows.map((s) => {
    const r = footprint(applyScenario(L, s.changes as Change[], libMap), p.boundary);
    return { ...s, total: r.total, stages: r.stages, dq: r.dq, delta: r.total - res.total, pct: res.total ? (r.total - res.total) / res.total : 0 };
  });
  const pubs = (await c.query(`SELECT id, version, factor::float8 AS factor, declared_unit, stages, dq::float8 AS dq, verified_name, published_name, published_at FROM lca_publication WHERE product_id = $1 ORDER BY version DESC`, [id])).rows;
  const me = req.user.id;
  return {
    product: p, inputs: res.lines, result: { total: res.total, stages: res.stages, dq: res.dq, excluded: res.excluded },
    hotspots: [...res.lines].filter((l) => l.counted).sort((a, b) => b.kg - a.kg).slice(0, 6),
    levers: levers(res, lib), scenarios: scen, publications: pubs,
    can: {
      edit: canEdit(req),
      submit: canEdit(req) && p.status === 'draft' && L.length > 0,
      verify: ['super_admin', 'admin', 'verifier'].includes(req.user.role) && p.status === 'review' && p.last_edit_by !== me && p.sent_by !== me,
      publish: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role) && p.status === 'verified',
    },
  };
}

export async function lcaRoutes(app: FastifyInstance) {
  app.get('/api/lca', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const P = (await c.query(`${PRODUCT_SQL} ORDER BY p.name`)).rows;
      const L = await inputs(c, P.map((p) => p.id));
      const products = P.map((p) => {
        const r = footprint(L.filter((l) => l.product_id === p.id), p.boundary);
        return { ...p, total: r.total, stages: r.stages, dq: r.dq, inputs: L.filter((l) => l.product_id === p.id).length };
      });
      const lib = await library(c);
      const used = (await c.query(`SELECT count(*)::int AS lines, coalesce(sum(l.co2e), 0)::float8 / 1000 AS t FROM purchase_line l
                                    WHERE l.supplier_ef_id IN (SELECT supplier_ef_id FROM lca_product WHERE supplier_ef_id IS NOT NULL)`)).rows[0];
      return {
        products, library: lib, stages: STAGES, boundaries: BOUNDARIES, dqLabels: DQ_LABEL, dqWeights: DQ,
        counts: {
          products: products.length, published: products.filter((p) => p.version > 0).length, review: products.filter((p) => p.status === 'review').length,
          suppliers: products.filter((p) => p.supplier_id && p.supplier_ef_id).length, purchaseLines: used.lines, purchaseT: used.t, indicative: lib.filter((f) => f.indicative).length,
        },
        can: { edit: canEdit(req), publish: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role), library: ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role) },
      };
    });
  });

  app.get('/api/lca/products/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, (c) => detail(c, req, id));
  });

  app.post('/api/lca/products', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const b = productBody.extend({ copyFrom: uuid.nullable().default(null) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await checkRefs(c, b);
      const du = await declared(c, b.declaredUnit);
      const r = (await c.query(
        `INSERT INTO lca_product (tenant_id, name, description, supplier_id, item_id, declared_unit, fu, boundary, standard, allocation, cutoff, ref_year, notes, created_by, created_name, last_edit_by, last_edit_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$15) RETURNING id`,
        [tenant, b.name, b.description, b.supplierId, b.itemId, du, b.fu, b.boundary, b.standard, b.allocation, b.cutoff, b.refYear, b.notes, req.user.id, req.user.name])).rows[0];
      if (b.copyFrom) {
        if (!(await c.query(`SELECT 1 FROM lca_product WHERE id = $1`, [b.copyFrom])).rowCount) throw notFound('Product to copy');
        await c.query(`INSERT INTO lca_input (tenant_id, product_id, position, name, stage, qty, unit, co2e_per_unit, lci_id, dq, source)
                       SELECT tenant_id, $2, position, name, stage, qty, unit, co2e_per_unit, lci_id, dq, source FROM lca_input WHERE product_id = $1`, [b.copyFrom, r.id]);
      }
      await audit(c, req, 'lca.product.create', 'lca_product', r.id, b);
      return { id: r.id };
    });
  });

  app.put('/api/lca/products/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = productBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const p = await product(c, id);
      await checkRefs(c, b);
      if (p.version > 0 && p.supplier_id && b.supplierId !== p.supplier_id) throw new AppError('This product was published as the supplier\'s factor: the supplier cannot change. Copy it as a new product instead.');
      const du = await declared(c, b.declaredUnit);
      await c.query(`UPDATE lca_product SET name=$2, description=$3, supplier_id=$4, item_id=$5, declared_unit=$6, fu=$7, boundary=$8, standard=$9, allocation=$10, cutoff=$11, ref_year=$12, notes=$13 WHERE id = $1`,
        [id, b.name, b.description, b.supplierId, b.itemId, du, b.fu, b.boundary, b.standard, b.allocation, b.cutoff, b.refYear, b.notes]);
      await touched(c, req, id);
      await audit(c, req, 'lca.product.update', 'lca_product', id, b);
      return { ok: true };
    });
  });

  app.delete('/api/lca/products/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const p = await product(c, id);
      if (p.version > 0) throw new AppError('A published product stays on record: its factor and versions are part of the audit trail', 409, 'IN_USE');
      await c.query(`DELETE FROM lca_product WHERE id = $1`, [id]);
      await audit(c, req, 'lca.product.delete', 'lca_product', id, { name: p.name });
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ inputs --
  const resolveInput = async (c: Tx, b: z.infer<typeof inputBody>) => {
    if (b.lciId) {
      const f = (await c.query(`SELECT co2e::float8 AS co2e, unit FROM lci_factor WHERE id = $1 AND active`, [b.lciId])).rows[0];
      if (!f) throw notFound('Inventory factor');
      if (normUnit(f.unit) !== normUnit(b.unit)) throw new AppError(`The library factor is per ${f.unit}; enter the amount in ${f.unit}`);
      return { co2e: b.co2ePerUnit ?? f.co2e, unit: f.unit };
    }
    if (b.co2ePerUnit == null) throw new AppError('Choose a library factor or enter kg CO2e per unit');
    return { co2e: b.co2ePerUnit, unit: b.unit };
  };

  app.post('/api/lca/products/:id/inputs', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = inputBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await product(c, id);
      const f = await resolveInput(c, b);
      const pos = (await c.query(`SELECT coalesce(max(position), 0) + 1 AS n FROM lca_input WHERE product_id = $1`, [id])).rows[0].n;
      const r = (await c.query(`INSERT INTO lca_input (tenant_id, product_id, position, name, stage, qty, unit, co2e_per_unit, lci_id, dq, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tenant, id, pos, b.name, b.stage, b.qty, f.unit, f.co2e, b.lciId, b.dq, b.source])).rows[0];
      await touched(c, req, id);
      await audit(c, req, 'lca.input.create', 'lca_product', id, b);
      return { id: r.id };
    });
  });

  app.put('/api/lca/inputs/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = inputBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const i = (await c.query(`SELECT product_id FROM lca_input WHERE id = $1`, [id])).rows[0];
      if (!i) throw notFound('Input');
      const f = await resolveInput(c, b);
      await c.query(`UPDATE lca_input SET name=$2, stage=$3, qty=$4, unit=$5, co2e_per_unit=$6, lci_id=$7, dq=$8, source=$9 WHERE id = $1`, [id, b.name, b.stage, b.qty, f.unit, f.co2e, b.lciId, b.dq, b.source]);
      await touched(c, req, i.product_id);
      await audit(c, req, 'lca.input.update', 'lca_product', i.product_id, { input: id, ...b });
      return { ok: true };
    });
  });

  app.delete('/api/lca/inputs/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const i = (await c.query(`DELETE FROM lca_input WHERE id = $1 RETURNING product_id, name`, [id])).rows[0];
      if (!i) throw notFound('Input');
      await c.query(`UPDATE lca_scenario SET changes = coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(changes) x WHERE x->>'inputId' <> $2), '[]') WHERE product_id = $1`, [i.product_id, id]);
      await touched(c, req, i.product_id);
      await audit(c, req, 'lca.input.delete', 'lca_product', i.product_id, { input: id, name: i.name });
      return { ok: true };
    });
  });

  /** Bill of materials: one line per input — name, stage, amount, unit, kg CO2e per unit (blank: matched to the library by name). */
  app.post('/api/lca/products/:id/import', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ text: z.string().max(200_000), replace: z.boolean().default(false), commit: z.boolean().default(false) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await product(c, id);
      const lib = await library(c);
      const rows = b.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const sep = (l: string) => (l.includes('\t') ? l.split('\t') : l.includes(';') && !l.includes(',') ? l.split(';') : splitCsv(l)).map((x) => x.trim());
      const lines: { row: number; name: string; stage: string | null; qty: number | null; unit: string; co2e: number | null; lciId: string | null; lciName: string | null; problems: string[] }[] = [];
      rows.forEach((raw, k) => {
        const f = sep(raw);
        if (k === 0 && /input|name|material/i.test(f[0] ?? '') && /stage|amount|qty|quantity/i.test(f.slice(1).join(' '))) return;   // header
        const [name = '', st = '', amt = '', unit = '', ef = ''] = f;
        const problems: string[] = [];
        let stage = stageOf(st);
        const qty = amt === '' ? null : Number(amt.replace(/,/g, ''));
        if (!name) problems.push('No input name');
        if (qty == null || !Number.isFinite(qty) || qty < 0) problems.push('Amount is not a number');
        let co2e = ef === '' ? null : Number(ef.replace(/,/g, ''));
        if (co2e != null && (!Number.isFinite(co2e) || co2e < 0)) { problems.push('kg CO2e per unit is not a number'); co2e = null; }
        let lci: Lib | undefined;
        if (co2e == null && name) {
          lci = matchLibrary(name, stage, unit, lib);
          if (lci) { co2e = lci.co2e; if (!stage) stage = lci.stage; if (unit && normUnit(unit) !== normUnit(lci.unit)) problems.push(`Library factor "${lci.name}" is per ${lci.unit}, not ${unit}`); }
          else problems.push('No factor given and none found in the library');
        }
        if (!stage) problems.push(`Stage "${st}" not recognised`);
        lines.push({ row: k + 1, name, stage, qty, unit: lci?.unit ?? (normUnit(unit) || 'kg'), co2e, lciId: lci?.id ?? null, lciName: lci?.name ?? null, problems });
      });
      const ok = lines.filter((l) => !l.problems.length);
      if (!b.commit) return { lines, ok: ok.length, problems: lines.length - ok.length };
      if (!ok.length) throw new AppError('No line can be imported');
      if (b.replace) await c.query(`DELETE FROM lca_input WHERE product_id = $1`, [id]);
      let pos = (await c.query(`SELECT coalesce(max(position), 0) AS n FROM lca_input WHERE product_id = $1`, [id])).rows[0].n as number;
      for (const l of ok)
        await c.query(`INSERT INTO lca_input (tenant_id, product_id, position, name, stage, qty, unit, co2e_per_unit, lci_id, dq, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [tenant, id, ++pos, l.name, l.stage, l.qty, l.unit, l.co2e, l.lciId, l.lciId ? 'estimated' : 'supplier', l.lciId ? 'Library match on import' : 'Imported bill of materials']);
      if (b.replace) await c.query(`UPDATE lca_scenario SET changes = '[]' WHERE product_id = $1`, [id]);
      await touched(c, req, id);
      await audit(c, req, 'lca.import', 'lca_product', id, { imported: ok.length, skipped: lines.length - ok.length, replace: b.replace });
      return { imported: ok.length, skipped: lines.length - ok.length };
    });
  });

  // --------------------------------------------------------------- scenarios --
  const checkChanges = async (c: Tx, productId: string, changes: z.infer<typeof changeSchema>[]) => {
    const ids = new Set((await c.query(`SELECT id FROM lca_input WHERE product_id = $1`, [productId])).rows.map((r) => r.id as string));
    for (const ch of changes) {
      if (!ids.has(ch.inputId)) throw new AppError('A change refers to an input that is not in this model');
      if (ch.lciId && !(await c.query(`SELECT 1 FROM lci_factor WHERE id = $1 AND active`, [ch.lciId])).rowCount) throw notFound('Inventory factor');
    }
    return changes.filter((ch) => ch.lciId || ch.qty != null || ch.co2e != null);
  };
  app.post('/api/lca/products/:id/scenarios', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = scenarioBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await product(c, id);
      const ch = await checkChanges(c, id, b.changes);
      const r = (await c.query(`INSERT INTO lca_scenario (tenant_id, product_id, name, changes, created_name) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [tenant, id, b.name, JSON.stringify(ch), req.user.name])).rows[0];
      await audit(c, req, 'lca.scenario.create', 'lca_product', id, b);
      return { id: r.id };
    });
  });
  app.put('/api/lca/scenarios/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = scenarioBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query(`SELECT product_id FROM lca_scenario WHERE id = $1`, [id])).rows[0];
      if (!s) throw notFound('Scenario');
      const ch = await checkChanges(c, s.product_id, b.changes);
      await c.query(`UPDATE lca_scenario SET name = $2, changes = $3 WHERE id = $1`, [id, b.name, JSON.stringify(ch)]);
      await audit(c, req, 'lca.scenario.update', 'lca_product', s.product_id, { scenario: id, ...b });
      return { ok: true };
    });
  });
  app.delete('/api/lca/scenarios/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = (await c.query(`DELETE FROM lca_scenario WHERE id = $1 RETURNING product_id, name`, [id])).rows[0];
      if (!s) throw notFound('Scenario');
      await audit(c, req, 'lca.scenario.delete', 'lca_product', s.product_id, { scenario: id, name: s.name });
      return { ok: true };
    });
  });

  // ------------------------------------------------------- review and publish --
  app.post('/api/lca/products/:id/submit', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...EDIT);
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    return tenantTx(tenant, async (c) => {
      const p = await product(c, id);
      if (p.status !== 'draft') throw new AppError('Only a draft can be sent for review');
      const L = await inputs(c, [id]);
      if (!L.length) throw new AppError('Add the inventory first');
      const r = footprint(L, p.boundary);
      if (r.total <= 0) throw new AppError('The footprint is zero: check the inventory');
      await c.query(`UPDATE lca_product SET status = 'review', sent_by = $2, sent_name = $3, sent_at = now(), review_note = $4 WHERE id = $1`, [id, req.user.id, req.user.name, b.note ?? null]);
      const who = (await c.query(`SELECT id FROM app_user WHERE role IN ('super_admin', 'admin', 'verifier') AND NOT disabled AND id <> $1 AND id IS DISTINCT FROM $2`, [req.user.id, p.last_edit_by])).rows.map((x) => x.id as string);
      await notify(c, tenant, who, { kind: 'lca', title: `Product footprint to verify: ${p.name}`, body: `${fmt(r.total)} kg CO2e per ${p.declared_unit} · ${req.user.name}`, link: `/lca?product=${id}` });
      await audit(c, req, 'lca.submit', 'lca_product', id, { total: r.total, note: b.note });
      return { ok: true };
    });
  });

  app.post('/api/lca/products/:id/verify', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'verifier');
    if (req.user.role === 'platform_admin') throw forbidden('The company verifies its own product footprints');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = z.object({ decision: z.enum(['verify', 'return']), note: z.string().trim().max(1000).optional() }).parse(req.body);
    if (b.decision === 'return' && !b.note) throw new AppError('Say what needs to change');
    return tenantTx(tenant, async (c) => {
      const p = (await c.query(`SELECT * FROM lca_product WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!p) throw notFound('Product');
      if (p.status !== 'review') throw new AppError('This product is not waiting for review');
      if (p.last_edit_by === req.user.id || p.sent_by === req.user.id) throw forbidden('A second person verifies: you edited or sent this model');
      if (b.decision === 'verify')
        await c.query(`UPDATE lca_product SET status = 'verified', verified_by = $2, verified_name = $3, verified_at = now(), review_note = $4 WHERE id = $1`, [id, req.user.id, req.user.name, b.note ?? null]);
      else await c.query(`UPDATE lca_product SET status = 'draft', review_note = $2 WHERE id = $1`, [id, b.note]);
      await notify(c, tenant, [p.sent_by, p.last_edit_by].filter((x, i, a) => x && a.indexOf(x) === i), {
        kind: 'lca', title: b.decision === 'verify' ? `Product footprint verified: ${p.name}` : `Product footprint returned: ${p.name}`, body: b.note ?? req.user.name, link: `/lca?product=${id}` });
      await audit(c, req, `lca.${b.decision}`, 'lca_product', id, { note: b.note });
      return { ok: true };
    });
  });

  app.post('/api/lca/products/:id/publish', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin');
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      await c.query(`SELECT 1 FROM lca_product WHERE id = $1 FOR UPDATE`, [id]);
      const p = await product(c, id);
      if (p.status !== 'verified') throw new AppError('Only a verified model can be published');
      const L = await inputs(c, [id]);
      const r = footprint(L, p.boundary);
      const version = p.version + 1;
      await c.query(`INSERT INTO lca_publication (tenant_id, product_id, version, factor, declared_unit, stages, inputs, dq, verified_name, published_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tenant, id, version, r.total, p.declared_unit, JSON.stringify(r.stages), JSON.stringify(r.lines.map(({ id: _i, share: _s, ...l }) => l)), r.dq, p.verified_name, req.user.name]);
      let efId: string | null = p.supplier_ef_id, lines = 0;
      if (p.supplier_id) {
        const src = `Product LCA: ${p.name} v${version} (${p.standard}, ${BOUNDARIES[p.boundary]}, ${p.ref_year}; verified by ${p.verified_name})`;
        const boundary = BOUNDARIES[p.boundary];
        const ex = efId ? (await c.query(`SELECT supplier_id FROM supplier_ef WHERE id = $1`, [efId])).rows[0] : null;
        if (ex && ex.supplier_id === p.supplier_id)
          await c.query(`UPDATE supplier_ef SET co2e = $2, unit = $3, item_id = $4, source = $5, boundary = $6, price_year = NULL, created_by = $7 WHERE id = $1`, [efId, r.total, p.declared_unit, p.item_id, src, boundary, req.user.id]);
        else
          efId = (await c.query(`INSERT INTO supplier_ef (tenant_id, supplier_id, item_id, co2e, unit, source, boundary, created_by, lca_product_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [tenant, p.supplier_id, p.item_id, r.total, p.declared_unit, src, boundary, req.user.id, id])).rows[0].id;
        lines = await recalcSupplier(c, tenant, [p.supplier_id], req.user.id);
      }
      await c.query(`UPDATE lca_product SET status = 'published', version = $2, published_factor = $3, published_at = now(), published_name = $4, supplier_ef_id = $5, changed_since_publish = false WHERE id = $1`,
        [id, version, r.total, req.user.name, efId]);
      await audit(c, req, 'lca.publish', 'lca_product', id, { version, factor: r.total, unit: p.declared_unit, supplierFactor: efId, linesRecalculated: lines });
      return { version, factor: r.total, supplierFactor: efId, linesRecalculated: lines };
    });
  });

  // ----------------------------------------------------------------- library --
  const libBody = z.object({ name: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(20), co2e: z.number().finite().min(0).max(1e9), stage: STAGE, source: z.string().trim().min(2).max(300) });
  app.post('/api/lca/library', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = libBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const code = `own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const r = (await c.query(`INSERT INTO lci_factor (tenant_id, code, name, unit, co2e, stage, source, created_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [tenant, code, b.name, normUnit(b.unit), b.co2e, b.stage, b.source, req.user.name])).rows[0];
      await audit(c, req, 'lca.library.create', 'lci_factor', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/lca/library/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = uuid.parse((req.params as { id: string }).id);
    const b = libBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE lci_factor SET name=$2, unit=$3, co2e=$4, stage=$5, source=$6 WHERE id = $1 AND tenant_id IS NOT NULL RETURNING id`, [id, b.name, normUnit(b.unit), b.co2e, b.stage, b.source]);
      if (!r.rowCount) throw notFound('Company factor');
      // models using it pick up the new value and go back to draft
      const ps = (await c.query(`UPDATE lca_input SET co2e_per_unit = $2, unit = $3 WHERE lci_id = $1 RETURNING product_id`, [id, b.co2e, normUnit(b.unit)])).rows;
      for (const pid of new Set(ps.map((x) => x.product_id as string))) await touched(c, req, pid);
      await audit(c, req, 'lca.library.update', 'lci_factor', id, { ...b, models: ps.length });
      return { ok: true, models: new Set(ps.map((x) => x.product_id)).size };
    });
  });
  app.delete('/api/lca/library/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = uuid.parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const used = (await c.query(`SELECT count(*)::int AS n FROM lca_input WHERE lci_id = $1`, [id])).rows[0].n;
      const r = used
        ? await c.query(`UPDATE lci_factor SET active = false WHERE id = $1 AND tenant_id IS NOT NULL RETURNING name`, [id])
        : await c.query(`DELETE FROM lci_factor WHERE id = $1 AND tenant_id IS NOT NULL RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Company factor');
      await audit(c, req, 'lca.library.delete', 'lci_factor', id, { name: r.rows[0].name, retired: !!used });
      return { ok: true, retired: !!used };
    });
  });
}

const fmt = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toPrecision(3));

function splitCsv(line: string) {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
