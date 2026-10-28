/**
 * Extended Producer Responsibility (package 'epr').
 *
 *   GET    /api/epr?year=                       every stream's position for the year (obligation, met, shortfall, carried,
 *                                               compensation exposure, recycled content; recyclers: certificates generated,
 *                                               sold, in stock); returns due; the regime library
 *   POST   /api/epr/streams                     add a stream (super admin, admin); PUT / DELETE /api/epr/streams/:id
 *   GET    /api/epr/streams/:id?year=           the stream year by year with its certificates
 *   PUT    /api/epr/streams/:id/years           quantities by year (super admin, admin, manager, preparer)
 *   PUT    /api/epr/streams/:id/years/:year/return   the annual return: status, filed on, reference (super admin, admin, manager)
 *   POST   /api/epr/certs                       a certificate bought, generated or sold; PUT / DELETE /api/epr/certs/:cid (super admin, admin, manager)
 *   GET    /api/epr/export?year=                Excel: position, years, certificates, method
 *
 * Every figure is typed: quantities placed on the market come from sales and procurement records, certificates from the
 * authority's portal. Targets are the regime's as published, and can be replaced per stream and year by the portal's.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { PRODUCT } from '../lib/brand.js';
import { sendWorkbook, styleHeader } from '../lib/xlsx.js';
import { needProduct } from '../lib/products.js';
import { REGIMES, periodLabel, positions, recyclerStock, type Cert, type Position, type Regime, type StreamSettings, type YearRow } from '../lib/epr.js';

const uuid = z.string().uuid();
const YEAR = z.coerce.number().int().min(2015).max(2100);
const idOf = (req: FastifyRequest, k = 'id') => uuid.parse((req.params as Record<string, string>)[k]);
const num = (x: unknown) => (x == null ? null : Number(x));
const iso = (d: unknown) => (d == null ? null : d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Not a date');
const canSetup = (req: FastifyRequest) => ['super_admin', 'admin', 'platform_admin'].includes(req.user.role);
const canData = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'preparer', 'platform_admin'].includes(req.user.role);
const canCerts = (req: FastifyRequest) => ['super_admin', 'admin', 'manager', 'platform_admin'].includes(req.user.role);
const txt = (max: number) => z.string().trim().max(max).nullable().default(null).transform((v) => (v === '' ? null : v));
const REGIME_KEYS = Object.keys(REGIMES) as [Regime, ...Regime[]];
const pctMap = z.record(z.string().regex(/^\d{4}$/).refine((k) => Number(k) >= 2015 && Number(k) <= 2100, 'Year from 2015'), z.number().min(0).max(100)).default({});
export const ROLES: Record<string, string> = { producer: 'Producer', importer: 'Importer', brand_owner: 'Brand owner', recycler: 'Recycler / processor' };
export const KINDS: Record<string, string> = { recycling: 'Recycling', eol: 'End-of-life disposal', recycled_content: 'Recycled content (surplus PIBO)', refurbish: 'Refurbishing', reuse: 'Reuse' };

const streamBody = z.object({
  regime: z.enum(REGIME_KEYS), role: z.enum(['producer', 'importer', 'brand_owner', 'recycler']), category: z.string().regex(/^[a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(200), country: z.string().regex(/^[A-Z]{2}$/).nullable().default(null), scheme: z.string().trim().max(200).default(''),
  registration: txt(120), avgLife: z.number().min(0).max(50).nullable().default(null), foodContact: z.boolean().default(false),
  targetPct: pctMap, recyclingPct: pctMap, rcPct: pctMap,
  ecRate: z.number().min(0).max(1e9).nullable().default(null), certPrice: z.number().min(0).max(1e9).nullable().default(null), feeRate: z.number().min(0).max(1e9).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).default('INR'), pro: txt(200), registeredOn: date.nullable().default(null), notes: z.string().trim().max(4000).default(''), active: z.boolean().default(true),
}).superRefine((b, ctx) => {
  if (!(b.category in REGIMES[b.regime].categories)) ctx.addIssue({ code: 'custom', path: ['category'], message: 'Not a category of this regime' });
  if (b.regime === 'eu_ppwr' && !b.country) ctx.addIssue({ code: 'custom', path: ['country'], message: 'Choose the member state' });
  if ((b.regime === 'in_ewaste' || b.regime === 'in_battery') && b.role !== 'recycler' && b.avgLife == null) ctx.addIssue({ code: 'custom', path: ['avgLife'], message: 'Give the average life of the product (years)' });
});
type StreamBody = z.infer<typeof streamBody>;

const settingsOf = (r: any): StreamSettings => ({
  regime: r.regime, role: r.role, category: r.category, avgLife: num(r.avg_life), targetPct: r.target_pct ?? {}, recyclingPct: r.recycling_pct ?? {}, rcPct: r.rc_pct ?? {},
  ecRate: num(r.ec_rate), certPrice: num(r.cert_price), feeRate: num(r.fee_rate), foodContact: !!r.food_contact,
});
const yearOf = (r: any): YearRow => ({ year: r.year, placed: num(r.placed), preConsumer: num(r.pre_consumer), suppliedToPibo: num(r.supplied), recycledTonnes: num(r.recycled), obligationTyped: num(r.obligation) });
const certOf = (r: any): Cert & Record<string, unknown> => ({
  id: r.id, streamId: r.stream_id, year: r.year, kind: r.kind, direction: r.direction, tonnes: Number(r.tonnes), price: num(r.price), generatedYear: r.generated_year,
  certificateNo: r.certificate_no, counterparty: r.counterparty, counterpartyReg: r.counterparty_reg, endProduct: r.end_product, tradedOn: iso(r.traded_on), documentId: r.document_id, note: r.note, createdName: r.created_name,
});
const streamOut = (r: any) => ({
  id: r.id, regime: r.regime as Regime, role: r.role, category: r.category, name: r.name, country: r.country, scheme: r.scheme, registration: r.registration, avgLife: num(r.avg_life), foodContact: r.food_contact,
  targetPct: r.target_pct, recyclingPct: r.recycling_pct, rcPct: r.rc_pct, ecRate: num(r.ec_rate), certPrice: num(r.cert_price), feeRate: num(r.fee_rate), currency: r.currency, pro: r.pro,
  registeredOn: iso(r.registered_on), notes: r.notes, active: r.active,
});
/** The library as the screens need it. */
const library = () => Object.fromEntries(Object.entries(REGIMES).map(([k, R]) => [k, { name: R.name, short: R.short, jurisdiction: R.jurisdiction, authority: R.authority, source: R.source, period: R.period, categories: R.categories, units: R.units, notes: R.notes, returnNote: R.returnNote, carryYears: R.carryYears, certValidityYears: R.certValidityYears ?? null, base: R.base }]));

async function loadStream(c: Tx, id: string) {
  const s = (await c.query(`SELECT * FROM epr_stream WHERE id = $1`, [id])).rows[0];
  if (!s) throw notFound('Stream');
  const years = (await c.query(`SELECT * FROM epr_year WHERE stream_id = $1 ORDER BY year`, [id])).rows;
  const certs = (await c.query(`SELECT * FROM epr_cert WHERE stream_id = $1 ORDER BY coalesce(year, generated_year), traded_on NULLS LAST, created_at`, [id])).rows;
  return { s, years, certs };
}
/** A stream's year-by-year position up to `to` (at least through the last year with data), with its recycler stock. */
function compute(s: any, years: any[], certs: any[], to: number) {
  const C = certs.map(certOf);
  const last = Math.max(to, ...years.map((y) => y.year), ...C.map((x) => x.year ?? 0));
  const pos = positions(settingsOf(s), years.map(yearOf), C, last);
  // recyclers: certificates as at the year viewed, sales drawn first in, first out with validity
  return { pos, stock: s.role === 'recycler' ? recyclerStock(s.regime as Regime, C, to) : null };
}
const at = (pos: Position[], y: number) => pos.find((p) => p.year === y) ?? null;

export async function eprRoutes(app: FastifyInstance) {
  needProduct(app, 'epr');

  app.get('/api/epr', async (req) => {
    const tenant = requireTenant(req);
    const asked = z.object({ year: YEAR.optional() }).parse(req.query).year;
    return tenantTx(tenant, async (c) => {
      const streams = (await c.query(`SELECT * FROM epr_stream ORDER BY active DESC, regime, name`)).rows;
      // without a year: the current one — India's financial year when every active stream runs April–March
      const now = new Date(), cal = now.getUTCFullYear();
      const act = streams.filter((x) => x.active);
      const year = asked ?? (act.length && act.every((x) => REGIMES[x.regime as Regime].period === 'india_fy') ? (now.getUTCMonth() >= 3 ? cal + 1 : cal) : cal);
      const ys = (await c.query(`SELECT * FROM epr_year ORDER BY year`)).rows, cs = (await c.query(`SELECT * FROM epr_cert`)).rows;
      const out = streams.map((s) => {
        const { pos, stock } = compute(s, ys.filter((y) => y.stream_id === s.id), cs.filter((x) => x.stream_id === s.id), year);
        const yr = ys.find((y) => y.stream_id === s.id && y.year === year);
        return { ...streamOut(s), label: periodLabel(s.regime, year), position: at(pos, year), previous: at(pos, year - 1), stock,
          returnStatus: yr?.return_status ?? 'not_started', filedOn: iso(yr?.filed_on), returnDue: s.role === 'recycler' ? null : REGIMES[s.regime as Regime].returnDue(year),
          fee: s.regime === 'eu_ppwr' && yr?.placed != null && s.fee_rate != null ? Number(yr.placed) * Number(s.fee_rate) : null };
      });
      return { year, streams: out, library: library(), roles: ROLES, kinds: KINDS, canSetup: canSetup(req), canData: canData(req), canCerts: canCerts(req),
        documents: (await c.query(`SELECT id, coalesce(title, filename) AS name FROM document WHERE kind = 'vault' AND archived_at IS NULL ORDER BY uploaded_at DESC LIMIT 300`)).rows };
    });
  });

  app.get('/api/epr/streams/:id', async (req) => {
    const tenant = requireTenant(req), id = idOf(req);
    const year = z.object({ year: YEAR.optional() }).parse(req.query).year ?? new Date().getUTCFullYear();
    return tenantTx(tenant, async (c) => {
      const { s, years, certs } = await loadStream(c, id);
      const { pos, stock } = compute(s, years, certs, year);
      return {
        stream: streamOut(s), year, positions: pos, stock,
        years: years.map((y) => ({ ...yearOf(y), label: periodLabel(s.regime, y.year), returnStatus: y.return_status, filedOn: iso(y.filed_on), returnRef: y.return_ref, documentId: y.document_id, note: y.note, updatedName: y.updated_name, returnDue: REGIMES[s.regime as Regime].returnDue(y.year) })),
        certs: certs.map(certOf), library: library()[s.regime], canSetup: canSetup(req), canData: canData(req), canCerts: canCerts(req),
      };
    });
  });

  const writeStream = async (c: Tx, req: FastifyRequest, b: StreamBody, id?: string) => {
    const v = [b.regime, b.role, b.category, b.name, b.country, b.scheme, b.registration, b.avgLife, b.foodContact, JSON.stringify(b.targetPct), JSON.stringify(b.recyclingPct), JSON.stringify(b.rcPct), b.ecRate, b.certPrice, b.feeRate, b.currency, b.pro, b.registeredOn, b.notes, b.active];
    if (id) {
      const old = (await c.query(`SELECT * FROM epr_stream WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!old) throw notFound('Stream');
      const used = !!(await c.query(`SELECT 1 FROM epr_cert WHERE stream_id = $1 UNION ALL SELECT 1 FROM epr_year WHERE stream_id = $1 LIMIT 1`, [id])).rowCount;
      if (used && (old.regime !== b.regime || old.role !== b.role || old.category !== b.category)) throw new AppError('The stream has figures or certificates: its regime, role and category stay as they are (add a new stream instead)');
      // a filed year's obligation must not change behind the return
      const filed = (await c.query(`SELECT year FROM epr_year WHERE stream_id = $1 AND return_status = 'filed'`, [id])).rows.map((r) => String(r.year));
      if (filed.length) {
        const same = (m1: Record<string, number>, m2: Record<string, number>) => filed.every((y) => (m1[y] ?? null) === (m2[y] ?? null));
        if ((num(old.avg_life) ?? null) !== b.avgLife || old.food_contact !== b.foodContact || !same(old.target_pct ?? {}, b.targetPct) || !same(old.recycling_pct ?? {}, b.recyclingPct) || !same(old.rc_pct ?? {}, b.rcPct))
          throw new AppError(`Returns are filed for ${filed.map((y) => periodLabel(b.regime, Number(y))).join(', ')}: the average life, food-contact setting and those years' targets stay as filed`, 409, 'FILED');
      }
      await c.query(`UPDATE epr_stream SET regime=$2, role=$3, category=$4, name=$5, country=$6, scheme=$7, registration=$8, avg_life=$9, food_contact=$10, target_pct=$11, recycling_pct=$12, rc_pct=$13, ec_rate=$14, cert_price=$15, fee_rate=$16, currency=$17, pro=$18, registered_on=$19, notes=$20, active=$21 WHERE id = $1`, [id, ...v]);
      await audit(c, req, 'epr.stream.update', 'epr_stream', id, b);
      return id;
    }
    const r = (await c.query(`INSERT INTO epr_stream (tenant_id, regime, role, category, name, country, scheme, registration, avg_life, food_contact, target_pct, recycling_pct, rc_pct, ec_rate, cert_price, fee_rate, currency, pro, registered_on, notes, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`, [requireTenant(req), ...v])).rows[0];
    await audit(c, req, 'epr.stream.create', 'epr_stream', r.id, b);
    return r.id as string;
  };
  app.post('/api/epr/streams', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const b = streamBody.parse(req.body);
    return tenantTx(tenant, async (c) => ({ id: await writeStream(c, req, b) }));
  });
  app.put('/api/epr/streams/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const id = idOf(req), b = streamBody.parse(req.body);
    return tenantTx(tenant, async (c) => { await writeStream(c, req, b, id); return { ok: true }; });
  });
  app.delete('/api/epr/streams/:id', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin');
    const id = idOf(req);
    return tenantTx(tenant, async (c) => {
      if ((await c.query(`SELECT 1 FROM epr_year WHERE stream_id = $1 AND return_status = 'filed' LIMIT 1`, [id])).rowCount) throw new AppError('A return has been filed for this stream: set it inactive instead of deleting it');
      const r = await c.query(`DELETE FROM epr_stream WHERE id = $1 RETURNING name`, [id]);
      if (!r.rowCount) throw notFound('Stream');
      await audit(c, req, 'epr.stream.delete', 'epr_stream', id, { name: r.rows[0].name });
      return { ok: true };
    });
  });

  const t = z.number().min(0).max(1e9).nullable();
  app.put('/api/epr/streams/:id/years', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = idOf(req);
    const b = z.object({ rows: z.array(z.object({ year: z.number().int().min(2015).max(2100), placed: t, preConsumer: t.default(null), suppliedToPibo: t.default(null), recycledTonnes: t.default(null), obligationTyped: t.default(null), note: z.string().trim().max(2000).default('') })).min(1).max(40) })
      .refine((x) => new Set(x.rows.map((r) => r.year)).size === x.rows.length, 'A year appears twice').parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query(`SELECT 1 FROM epr_stream WHERE id = $1`, [id])).rowCount) throw notFound('Stream');
      for (const r of b.rows) {
        if (r.recycledTonnes != null && r.placed != null && r.recycledTonnes > r.placed) throw new AppError(`${r.year}: recycled content is more than the quantity placed on the market`);
        const filed = (await c.query(`SELECT return_status FROM epr_year WHERE stream_id = $1 AND year = $2`, [id, r.year])).rows[0];
        if (filed?.return_status === 'filed') throw new AppError(`${r.year}: the return is filed — reopen it to change the figures`, 409, 'FILED');
        const empty = [r.placed, r.preConsumer, r.suppliedToPibo, r.recycledTonnes, r.obligationTyped].every((v) => v == null) && !r.note;
        if (empty && !filed) continue;
        if (empty && filed?.return_status === 'not_started') { await c.query(`DELETE FROM epr_year WHERE stream_id = $1 AND year = $2`, [id, r.year]); continue; }
        await c.query(`INSERT INTO epr_year (tenant_id, stream_id, year, placed, pre_consumer, supplied, recycled, obligation, note, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (stream_id, year) DO UPDATE SET placed=$4, pre_consumer=$5, supplied=$6, recycled=$7, obligation=$8, note=$9, updated_name=$10, updated_at=now()`,
          [tenant, id, r.year, r.placed, r.preConsumer, r.suppliedToPibo, r.recycledTonnes, r.obligationTyped, r.note, req.user.name]);
      }
      await audit(c, req, 'epr.years', 'epr_stream', id, b);
      return { ok: true };
    });
  });

  app.put('/api/epr/streams/:id/years/:year/return', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin', 'manager');
    const id = idOf(req), year = YEAR.parse((req.params as { year: string }).year);
    const b = z.object({ status: z.enum(['not_started', 'in_progress', 'filed']), filedOn: date.nullable().default(null), returnRef: txt(120), documentId: uuid.nullable().default(null), note: z.string().trim().max(2000).optional() })
      .refine((x) => x.status !== 'filed' || x.filedOn, { message: 'Give the date it was filed', path: ['filedOn'] }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query(`SELECT 1 FROM epr_stream WHERE id = $1`, [id])).rowCount) throw notFound('Stream');
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
      await c.query(`INSERT INTO epr_year (tenant_id, stream_id, year, return_status, filed_on, return_ref, document_id, note, updated_name) VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,''),$9)
        ON CONFLICT (stream_id, year) DO UPDATE SET return_status=$4, filed_on=$5, return_ref=$6, document_id=$7, note=coalesce($8, epr_year.note), updated_name=$9, updated_at=now()`,
        [tenant, id, year, b.status, b.status === 'filed' ? b.filedOn : null, b.returnRef, b.documentId, b.note ?? null, req.user.name]);
      await audit(c, req, 'epr.return', 'epr_stream', id, { year, ...b });
      return { ok: true };
    });
  });

  const certBody = z.object({
    streamId: uuid, direction: z.enum(['in', 'out']), kind: z.enum(['recycling', 'eol', 'recycled_content', 'refurbish', 'reuse']).default('recycling'),
    year: z.number().int().min(2015).max(2100).nullable(), generatedYear: z.number().int().min(2015).max(2100).nullable().default(null), tonnes: z.number().positive().max(1e9),
    price: z.number().min(0).max(1e9).nullable().default(null), certificateNo: txt(120), counterparty: txt(200), counterpartyReg: txt(120), endProduct: txt(80),
    tradedOn: date.nullable().default(null), documentId: uuid.nullable().default(null), note: z.string().trim().max(2000).default(''),
  });
  type CertBody = z.infer<typeof certBody>;
  /** Rules a certificate must meet against its stream; `except` leaves the certificate being changed out of the stock. */
  const filedYear = async (c: Tx, streamId: string, y: number | null) => y != null && !!(await c.query(`SELECT 1 FROM epr_year WHERE stream_id = $1 AND year = $2 AND return_status = 'filed'`, [streamId, y])).rowCount;
  /** A recycler's stock must cover every sale (first in, first out, same kind, valid in the year sold) once the change is made. */
  const checkStock = async (c: Tx, s: any, change: (list: (Cert & { id?: string })[]) => (Cert & { id?: string })[]) => {
    const list = (await c.query(`SELECT * FROM epr_cert WHERE stream_id = $1`, [s.id])).rows.map(certOf);
    const st = recyclerStock(s.regime as Regime, change(list), 2100);
    if (st.problems.length) throw new AppError(st.problems[0]!);
  };
  const checkCert = async (c: Tx, b: CertBody, except?: string) => {
    const s = (await c.query(`SELECT * FROM epr_stream WHERE id = $1 FOR UPDATE`, [b.streamId])).rows[0];
    if (!s) throw notFound('Stream');
    if (s.role !== 'recycler' && await filedYear(c, b.streamId, b.year)) throw new AppError(`The return for ${periodLabel(s.regime, b.year!)} is filed: reopen it to change its certificates`, 409, 'FILED');
    const R = REGIMES[s.regime as Regime];
    if (b.direction === 'out' && s.role !== 'recycler') throw new AppError('Only a recycler stream sells certificates');
    if (s.role !== 'recycler' && b.year == null) throw new AppError('Give the compliance year the certificate counts for');
    if (s.role === 'recycler' && b.direction === 'in' && b.generatedYear == null) throw new AppError('Give the year the certificate was generated');
    if (b.generatedYear != null && b.year != null && b.direction === 'in' && s.role !== 'recycler' && b.year < b.generatedYear) throw new AppError('A certificate cannot count for a year before it was generated');
    if (R.certValidityYears && b.generatedYear != null && b.year != null && b.direction === 'in' && s.role !== 'recycler' && b.year > b.generatedYear + R.certValidityYears)
      throw new AppError(`Certificates of this regime lapse ${R.certValidityYears} years after the year they are generated in`);
    if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1`, [b.documentId])).rowCount) throw notFound('Document');
    if (s.role === 'recycler' && b.direction === 'out' && b.year == null) throw new AppError('Give the year the certificates were sold');
    if (b.certificateNo && s.role !== 'recycler' && b.direction === 'in'
      && (await c.query(`SELECT 1 FROM epr_cert x JOIN epr_stream y ON y.id = x.stream_id WHERE x.certificate_no = $1 AND x.direction = 'in' AND y.role <> 'recycler' AND x.stream_id <> $2 LIMIT 1`, [b.certificateNo, b.streamId])).rowCount)
      throw new AppError('This certificate number is already applied on another stream');
    if (s.role === 'recycler') {
      const mine: Cert & { id?: string } = { id: except ?? 'new', year: b.year, kind: b.kind, direction: b.direction, tonnes: b.tonnes, price: b.price, generatedYear: b.generatedYear };
      await checkStock(c, s, (list) => [...list.filter((x) => x.id !== except), mine]);
    }
  };
  const certVals = (b: CertBody) => [b.streamId, b.direction, b.kind, b.year, b.generatedYear, b.tonnes, b.price, b.certificateNo, b.counterparty, b.counterpartyReg, b.endProduct, b.tradedOn, b.documentId, b.note];
  const dupNo = (e: unknown) => { if ((e as { code?: string }).code === '23505') throw new AppError('This certificate number is already recorded on the stream'); throw e; };
  app.post('/api/epr/certs', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin', 'manager');
    const b = certBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      await checkCert(c, b);
      const r = (await c.query(`INSERT INTO epr_cert (tenant_id, stream_id, direction, kind, year, generated_year, tonnes, price, certificate_no, counterparty, counterparty_reg, end_product, traded_on, document_id, note, created_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`, [tenant, ...certVals(b), req.user.name]).catch(dupNo)).rows[0];
      await audit(c, req, 'epr.cert.create', 'epr_cert', r.id, b);
      return { id: r.id };
    });
  });
  app.put('/api/epr/certs/:cid', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin', 'manager');
    const cid = idOf(req, 'cid'), b = certBody.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const old = (await c.query(`SELECT c.stream_id, c.year, s.role, s.regime FROM epr_cert c JOIN epr_stream s ON s.id = c.stream_id WHERE c.id = $1 FOR UPDATE OF c`, [cid])).rows[0];
      if (!old) throw notFound('Certificate');
      if (old.stream_id !== b.streamId) throw new AppError('A certificate cannot move to another stream');
      if (old.role !== 'recycler' && await filedYear(c, old.stream_id, old.year)) throw new AppError(`The return for ${periodLabel(old.regime, old.year)} is filed: reopen it to change its certificates`, 409, 'FILED');
      await checkCert(c, b, cid);
      await c.query(`UPDATE epr_cert SET stream_id=$2, direction=$3, kind=$4, year=$5, generated_year=$6, tonnes=$7, price=$8, certificate_no=$9, counterparty=$10, counterparty_reg=$11, end_product=$12, traded_on=$13, document_id=$14, note=$15 WHERE id = $1`, [cid, ...certVals(b)]).catch(dupNo);
      await audit(c, req, 'epr.cert.update', 'epr_cert', cid, b);
      return { ok: true };
    });
  });
  app.delete('/api/epr/certs/:cid', async (req) => {
    const tenant = requireTenant(req); requireRole(req, 'super_admin', 'admin', 'manager');
    const cid = idOf(req, 'cid');
    return tenantTx(tenant, async (c) => {
      const x = (await c.query(`SELECT * FROM epr_cert WHERE id = $1 FOR UPDATE`, [cid])).rows[0];
      if (!x) throw notFound('Certificate');
      const s = (await c.query(`SELECT * FROM epr_stream WHERE id = $1 FOR UPDATE`, [x.stream_id])).rows[0];
      if (s.role !== 'recycler' && await filedYear(c, x.stream_id, x.year)) throw new AppError(`The return for ${periodLabel(s.regime, x.year)} is filed: reopen it to change its certificates`, 409, 'FILED');
      if (s.role === 'recycler' && x.direction === 'in') {
        try { await checkStock(c, s, (list) => list.filter((y) => y.id !== cid)); } catch { throw new AppError('Certificates from this one have been sold: remove the sale first'); }
      }
      await c.query(`DELETE FROM epr_cert WHERE id = $1`, [cid]);
      await audit(c, req, 'epr.cert.delete', 'epr_cert', cid, { tonnes: x.tonnes, certificateNo: x.certificate_no });
      return { ok: true };
    });
  });

  app.get('/api/epr/export', async (req, reply) => {
    const tenant = requireTenant(req);
    const year = z.object({ year: YEAR }).parse(req.query).year;
    const d = await tenantTx(tenant, async (c) => {
      const name = (await c.query(`SELECT name FROM tenant WHERE id = $1`, [tenant])).rows[0].name as string;
      const streams = (await c.query(`SELECT * FROM epr_stream ORDER BY regime, name`)).rows;
      const ys = (await c.query(`SELECT * FROM epr_year ORDER BY year`)).rows, cs = (await c.query(`SELECT * FROM epr_cert ORDER BY year, traded_on`)).rows;
      await audit(c, req, 'epr.export', 'tenant', tenant, { year });
      return { name, streams, ys, cs };
    });
    const wb = new ExcelJS.Workbook(); wb.creator = PRODUCT;
    const sum = wb.addWorksheet(`Position ${year}`);
    sum.addRow(['Regime', 'Stream', 'Role', 'Category', 'Period', 'Base (t)', 'Base from', 'Target %', 'Obligation (t)', 'Carried in (t)', 'Met (t)', 'of which recycling (t)', 'Recycling minimum (t)', 'Shortfall (t)', 'Compensation exposure', 'Cost to close', 'Recycled content required (t)', 'Recycled content (t)', 'Recycled content shortfall (t)', 'Return', 'Warnings']);
    styleHeader(sum, [30, 34, 14, 30, 12, 12, 26, 10, 14, 14, 12, 14, 14, 12, 16, 14, 16, 14, 16, 12, 60]);
    const yrs = wb.addWorksheet('Years');
    yrs.addRow(['Stream', 'Period', 'Placed on market / processed (t)', 'Pre-consumer (t)', 'Supplied to PIBOs (t)', 'Recycled content (t)', 'Obligation typed (t)', 'Return', 'Filed on', 'Reference', 'Note']);
    styleHeader(yrs, [34, 12, 18, 14, 14, 14, 14, 12, 12, 18, 40]);
    for (const s of d.streams) {
      const mine = d.ys.filter((y) => y.stream_id === s.id);
      const { pos } = compute(s, mine, d.cs.filter((x) => x.stream_id === s.id), year);
      const p = at(pos, year), yr = mine.find((y) => y.year === year);
      const R = REGIMES[s.regime as Regime];
      sum.addRow([R.short, s.name, ROLES[s.role], R.categories[s.category], periodLabel(s.regime, year), p?.base, p?.baseFrom, p?.targetPct, p?.obligation, p?.carriedIn, p?.met, p?.metRecycling, p?.recyclingMin, p?.shortfall, p?.ecExposure, p?.costToClose, p?.rcRequired, p?.rcActual, p?.rcShortfall, yr?.return_status ?? 'not_started', p?.warnings.join('; ')]);
      for (const y of mine) yrs.addRow([s.name, periodLabel(s.regime, y.year), num(y.placed), num(y.pre_consumer), num(y.supplied), num(y.recycled), num(y.obligation), y.return_status, iso(y.filed_on), y.return_ref, y.note]);
    }
    const ct = wb.addWorksheet('Certificates');
    ct.addRow(['Stream', 'Bought / generated / sold', 'Kind', 'Counts for', 'Generated in', 'Tonnes', 'Price per t', 'Certificate no.', 'Counterparty', 'Registration', 'End product', 'Date', 'Note']);
    styleHeader(ct, [34, 16, 22, 12, 12, 12, 12, 20, 30, 18, 18, 12, 40]);
    for (const x of d.cs) {
      const s = d.streams.find((y) => y.id === x.stream_id)!;
      ct.addRow([s.name, x.direction === 'out' ? 'Sold' : s.role === 'recycler' ? 'Generated' : 'Bought', KINDS[x.kind], x.year != null ? periodLabel(s.regime, x.year) : '', x.generated_year != null ? periodLabel(s.regime, x.generated_year) : '', Number(x.tonnes), num(x.price), x.certificate_no, x.counterparty, x.counterparty_reg, x.end_product, iso(x.traded_on), x.note]);
    }
    const mt = wb.addWorksheet('Method'); mt.getColumn(1).width = 150;
    mt.addRow([`${d.name} — EPR position for ${year}, prepared in ${PRODUCT}.`]);
    mt.addRow(['Obligation = base quantity × target % (or the obligation typed from the authority\'s portal). Shortfalls are carried into the following years as the regime allows; certificates clear the oldest carried shortfall first. Exposure = shortfall × the environmental compensation rate typed on the stream.']);
    for (const r of new Set(d.streams.map((s) => s.regime as Regime))) mt.addRow([`${REGIMES[r].name}: ${REGIMES[r].notes} ${REGIMES[r].returnNote}.`]);
    mt.addRow(['Targets as published, checked October 2026. A working tool, not legal advice: confirm the figures with the authority\'s portal.']);
    return sendWorkbook(reply, wb, `EPR_${year}.xlsx`);
  });
}
