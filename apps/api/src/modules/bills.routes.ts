/**
 * Bills (PDF), uploaded in one place.
 *
 *   Upload    one PDF per request (the screen sends many in a row); checked to be a PDF,
 *             at most 15 MB; the same file twice is recognised. The text is read (PDF.js,
 *             no scripts) and the supplier, account, period, consumption and amount found.
 *             A scan without text is flagged for the figures to be typed in.
 *   Match     the account number on the bill → the meter (utility account) with that
 *             account number.
 *   Check     a person checks every field against the PDF shown beside it, corrects what
 *             is needed and confirms (or rejects). Nothing is booked before that.
 *   Book      the bill becomes one reading of the meter covering its billing period; the
 *             meter's monthly entries are created / updated (split over months by days).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { convert, tzOffset } from '@ekotrace/calc';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { assertCan, scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/password.js';
import { pdfText } from '../lib/pdfText.js';
import { readBill } from '../lib/billRead.js';
import { tenantSettings } from './activity.routes.js';
import { refdata } from './refdata.js';
import { inputFor, syncMeter, type Actor, type MeterRow } from './meters.routes.js';
import { calculate } from './calc.service.js';
import { contextFor } from './activity.routes.js';

const MAX = 15 * 1024 * 1024;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const SELECT_BILL = `
  SELECT b.id, b.document_id, b.status, coalesce(mc.code, b.category) AS category, b.energy, b.supplier, b.account_no, b.bill_no, b.period_from::text, b.period_to::text, b.issue_date::text,
         b.quantity, b.unit, b.amount, b.currency, b.found, b.scanned, b.meter_id, b.reading_ts, b.note, b.checked_by, b.checked_at, b.created_at,
         d.filename, d.size, m.name AS meter, m.facility_id, f.name AS facility, m.unit AS meter_unit, u.name AS checked_by_name
    FROM bill b JOIN document d ON d.id = b.document_id LEFT JOIN meter m ON m.id = b.meter_id LEFT JOIN org_node f ON f.id = m.facility_id
    LEFT JOIN app_user u ON u.id::text = b.checked_by
    LEFT JOIN item mi ON mi.id = m.item_id LEFT JOIN subcategory ms ON ms.id = mi.subcategory_id LEFT JOIN category mc ON mc.id = ms.category_id`;
/** Add data tab of a bill without a meter yet, from what was read. */
const categoryOfEnergy = (e: string | null | undefined) => (!e || ['electricity', 'cooling', 'heat'].includes(e) ? 'purchased_electricity' : 'stationary_combustion');

/** Midnight at the start of a local date, as an instant. */
const localMidnight = (d: string, tz: string) => { const u = Date.parse(`${d}T00:00:00Z`); return u - tzOffset(tz, u - tzOffset(tz, u)); };
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function matchMeter(c: Tx, account: string | null | undefined) {
  if (!account) return null;
  const norm = account.replace(/[\s\-\/]/g, '').toUpperCase();
  const r = (await c.query(`SELECT id FROM meter WHERE active AND upper(regexp_replace(account_no, '[\\s\\-/]', '', 'g')) = $1`, [norm])).rows;
  return r.length === 1 ? (r[0].id as string) : null;
}

/** Bills of facilities the person can see; unmatched bills to anyone who can enter data. */
async function visible(c: Tx, req: FastifyRequest, b: { facility_id: string | null }) {
  const s = await scopeOf(c, req.user);
  return b.facility_id ? s.see.has(b.facility_id) : s.enter.size > 0 || req.user.role === 'super_admin' || req.user.role === 'platform_admin' || req.user.role === 'verifier';
}

/** Store a PDF and what was read from it; returns the bill id (or the existing one for the same file). */
export async function createBill(c: Tx, tenant: string, buf: Buffer, filename: string, by: string, category?: string | null): Promise<{ id: string; duplicate: boolean }> {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('This is not a PDF file');
  const hash = sha256(buf.toString('binary'));
  const dup = (await c.query('SELECT b.id FROM document d JOIN bill b ON b.document_id = d.id WHERE d.sha256 = $1', [hash])).rows[0];
  if (dup) return { id: dup.id, duplicate: true };
  let text = '', scanned = false, problem: string | null = null;
  try { const t = await pdfText(new Uint8Array(buf)); text = t.text; scanned = t.scanned; } catch (e) { problem = `The PDF could not be read (${(e as Error).message.slice(0, 120)})`; }
  const r = readBill(text);
  const doc = (await c.query('INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [tenant, 'bill', filename, 'application/pdf', buf.length, hash, buf, by])).rows[0];
  const meterId = await matchMeter(c, r.account?.value);
  const found = { ...r, problem, matchedBy: meterId ? 'account number' : null };
  const b = (await c.query(
    `INSERT INTO bill (tenant_id, document_id, energy, supplier, account_no, bill_no, period_from, period_to, issue_date, quantity, unit, amount, currency, found, text_excerpt, scanned, meter_id, created_by, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [tenant, doc.id, r.quantity?.energy ?? r.supplier?.energy ?? null, r.supplier?.value ?? null, r.account?.value ?? null, r.billNo?.value ?? null,
     r.periodFrom?.value ?? null, r.periodTo?.value ?? null, r.issueDate?.value ?? null, r.quantity?.value ?? null, r.quantity?.unit ?? null,
     r.amount?.value ?? null, r.amount?.currency ?? null, JSON.stringify(found), text.slice(0, 20000), scanned, meterId, by,
     category ?? categoryOfEnergy(r.quantity?.energy ?? r.supplier?.energy)])).rows[0];
  return { id: b.id, duplicate: false };
}

/** Book a checked bill: one interval reading for its period on its meter; the months' entries follow. */
export async function bookBill(c: Tx, t: { id: string; gwp_set: string; timezone: string }, id: string, actor: Actor, canEnter?: (facilityId: string) => void) {
  const b = (await c.query('SELECT * FROM bill WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!b) throw notFound('Bill');
  if (b.status === 'confirmed') throw new AppError('Already booked');
  if (!b.meter_id) throw new AppError('Choose the meter (utility account) this bill belongs to');
  const pf = b.period_from instanceof Date ? b.period_from.toISOString().slice(0, 10) : String(b.period_from ?? '');
  const pt = b.period_to instanceof Date ? b.period_to.toISOString().slice(0, 10) : String(b.period_to ?? '');
  if (!pf || !pt) throw new AppError('Enter the billing period');
  if (pt < pf) throw new AppError('The billing period ends before it starts');
  if (b.quantity == null) throw new AppError('Enter the consumption');
  const m = (await c.query('SELECT * FROM meter WHERE id = $1', [b.meter_id])).rows[0] as MeterRow & { account_no: string | null };
  if (!m) throw notFound('Meter');
  canEnter?.(m.facility_id);
  if (m.reading_type !== 'interval') throw new AppError(`${m.name} takes register readings: bills need a meter that records consumption per period (interval)`);
  const { units } = await refdata();
  const qty = b.unit && b.unit !== m.unit ? convert(units, Number(b.quantity), b.unit, m.unit) : Number(b.quantity);
  const from = localMidnight(pf, t.timezone), to = localMidnight(nextDay(pt), t.timezone);
  const clash = (await c.query(
    `SELECT b.id, b.period_from::text, b.period_to::text FROM bill b WHERE b.meter_id = $1 AND b.status = 'confirmed' AND b.id <> $2 AND b.period_from <= $4 AND b.period_to >= $3`,
    [m.id, id, pf, pt])).rows[0];
  if (clash) throw new AppError(`Another bill for ${m.name} already covers ${clash.period_from} – ${clash.period_to}`);
  const existing = (await c.query('SELECT source FROM meter_reading WHERE meter_id = $1 AND ts = to_timestamp($2 / 1000.0)', [m.id, to])).rows[0];
  if (existing && existing.source !== 'bill') throw new AppError(`${m.name} already has a ${existing.source} reading ending ${pt}`);
  await c.query(
    `INSERT INTO meter_reading (tenant_id, meter_id, ts, from_ts, value, source) VALUES ($1,$2,to_timestamp($3 / 1000.0),to_timestamp($4 / 1000.0),$5,'bill')
     ON CONFLICT (meter_id, ts) DO UPDATE SET from_ts = EXCLUDED.from_ts, value = EXCLUDED.value, source = 'bill', received_at = now()`,
    [t.id, m.id, to, from, qty]);
  await c.query(`UPDATE bill SET status = 'confirmed', reading_ts = to_timestamp($2 / 1000.0), checked_by = $3, checked_at = now() WHERE id = $1`, [id, to, actor.id ?? actor.name]);
  if (b.account_no && !m.account_no) await c.query('UPDATE meter SET account_no = $2 WHERE id = $1', [m.id, b.account_no]);
  const months = new Set<string>();
  for (let x = from; x < to; x += 86_400_000) months.add(new Date(x + tzOffset(t.timezone, x)).toISOString().slice(0, 7));
  const sync = await syncMeter(c, t, m, actor, months);
  await audit(c, actor.req as FastifyRequest, 'bill.confirm', 'bill', id, { meter: m.name, period: `${pf} – ${pt}`, quantity: qty, unit: m.unit, sync: { created: sync.created, updated: sync.updated } });
  return sync;
}

export interface BillIssue { level: 'block' | 'warn'; text: string }
const d10 = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v).slice(0, 10));
/** What would stop a bill from being booked, or deserves a look: duplicates and overlaps. */
export async function billIssues(c: Tx, b: Record<string, any>, tz: string): Promise<BillIssue[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: BillIssue[] = [];
  const pf = d10(b.period_from), pt = d10(b.period_to);
  if (!b.meter_id) out.push({ level: 'block', text: 'No meter (account) chosen' });
  if (!pf || !pt) out.push({ level: 'block', text: 'Billing period missing' });
  if (b.quantity == null) out.push({ level: 'block', text: 'Consumption missing' });
  if (b.bill_no) {
    const same = (await c.query(
      `SELECT d.filename, b.status FROM bill b JOIN document d ON d.id = b.document_id
        WHERE b.id <> $1 AND b.status <> 'rejected' AND lower(b.bill_no) = lower($2) AND lower(coalesce(b.supplier,'')) = lower(coalesce($3,''))
          AND (b.status = 'confirmed' OR (b.created_at, b.id) < ($4::timestamptz, $1::uuid)) ORDER BY b.status = 'confirmed' DESC LIMIT 1`, [b.id, b.bill_no, b.supplier, b.created_at])).rows[0];
    if (same) out.push({ level: 'block', text: `Same bill number as ${same.filename} (${same.status === 'confirmed' ? 'booked' : same.status === 'checked' ? 'ready' : 'to check'}): a duplicate?` });
  }
  if (b.meter_id && pf && pt) {
    const booked = (await c.query(
      `SELECT d.filename, b.period_from::text AS f, b.period_to::text AS t, b.status FROM bill b JOIN document d ON d.id = b.document_id
        WHERE b.meter_id = $1 AND b.id <> $2 AND b.period_from <= $4 AND b.period_to >= $3
          AND (b.status = 'confirmed' OR (b.status = 'checked' AND (b.created_at, b.id) < ($5::timestamptz, $2::uuid)))
        ORDER BY b.status = 'confirmed' DESC, b.created_at LIMIT 1`, [b.meter_id, b.id, pf, pt, b.created_at])).rows[0];
    if (booked && (booked.status === 'confirmed' || b.status === 'checked')) out.push({ level: 'block', text: `${booked.status === 'confirmed' ? 'Already booked' : 'Also ready'}: ${booked.filename} covers ${booked.f} – ${booked.t}` });
    const from = localMidnight(pf, tz), to = localMidnight(nextDay(pt), tz);
    const other = (await c.query(
      `SELECT count(*)::int AS n, min(source) AS source FROM meter_reading WHERE meter_id = $1 AND source <> 'bill' AND ts > to_timestamp($2 / 1000.0) AND coalesce(from_ts, ts) < to_timestamp($3 / 1000.0)`,
      [b.meter_id, from, to])).rows[0];
    if (other.n) out.push({ level: 'block', text: `The meter already has ${other.n} ${other.source} reading${other.n === 1 ? '' : 's'} in this period: the bill would count it twice` });
    const appr = (await c.query(`SELECT count(*)::int AS n FROM activity WHERE meter_id = $1 AND status = 'approved' AND period_end >= $2 AND period_start <= $3`, [b.meter_id, pf, pt])).rows[0].n;
    if (appr) out.push({ level: 'warn', text: `${appr} approved month${appr === 1 ? '' : 's'} will not change (the difference is reported)` });
    const m = (await c.query('SELECT reading_type FROM meter WHERE id = $1', [b.meter_id])).rows[0];
    if (m?.reading_type !== 'interval') out.push({ level: 'block', text: 'The meter takes register readings: bills need an interval meter' });
  }
  return out;
}
/** Days of a period in each calendar month. */
function monthSplit(pf: string, pt: string) {
  const out = new Map<string, number>();
  for (let x = Date.parse(`${pf}T00:00:00Z`); x <= Date.parse(`${pt}T00:00:00Z`); x += 86_400_000) { const k = new Date(x).toISOString().slice(0, 7); out.set(k, (out.get(k) ?? 0) + 1); }
  return out;
}

export async function billRoutes(app: FastifyInstance) {
  /** Upload one PDF (body = the file, header x-filename). */
  app.post('/api/bills/upload', { bodyLimit: MAX }, async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the PDF file as the request body');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError('This is not a PDF file');
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'bill.pdf')).replace(/[^\w.\- ()]/g, '_').slice(0, 160);
    const category = req.headers['x-category'] ? z.string().regex(/^[a-z_]{3,40}$/).parse(String(req.headers['x-category'])) : null;
    return tenantTx(tenant, async (c) => {
      const r = await createBill(c, tenant, buf, filename, req.user.id, category);
      if (!r.duplicate) {
        const x = (await c.query('SELECT scanned, found FROM bill WHERE id = $1', [r.id])).rows[0];
        await audit(c, req, 'bill.upload', 'bill', r.id, { filename, size: buf.length, scanned: x.scanned, missing: x.found.missing });
      }
      return { duplicate: r.duplicate, ...(await c.query(`${SELECT_BILL} WHERE b.id = $1`, [r.id])).rows[0] };
    });
  });

  app.get('/api/bills', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ status: z.enum(['to_check', 'checked', 'confirmed', 'rejected']).optional(), category: z.string().max(40).optional() }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const cat = q.category ?? null;
      const rows = (await c.query(`${SELECT_BILL} WHERE ($1::text IS NULL OR b.status = $1) AND ($2::text IS NULL OR coalesce(mc.code, b.category) = $2 OR ($2 = 'waste' AND coalesce(mc.code, b.category) LIKE 'waste_%'))
                                    ORDER BY b.created_at DESC LIMIT 1000`, [q.status ?? null, cat])).rows;
      const out = [];
      for (const r of rows) if (await visible(c, req, r)) out.push(r);
      const counts = (await c.query(`SELECT b.status, count(*)::int n FROM bill b LEFT JOIN meter m ON m.id = b.meter_id LEFT JOIN item mi ON mi.id = m.item_id
                                       LEFT JOIN subcategory ms ON ms.id = mi.subcategory_id LEFT JOIN category mc ON mc.id = ms.category_id
                                      WHERE ($1::text IS NULL OR coalesce(mc.code, b.category) = $1 OR ($1 = 'waste' AND coalesce(mc.code, b.category) LIKE 'waste_%')) GROUP BY b.status`, [cat])).rows;
      return { bills: out, counts: Object.fromEntries(counts.map((x) => [x.status, x.n])) };
    });
  });

  app.get('/api/bills/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
      if (!b || !(await visible(c, req, b))) throw notFound('Bill');
      const text = (await c.query('SELECT text_excerpt FROM bill WHERE id = $1', [id])).rows[0].text_excerpt;
      const entries = b.meter_id && b.period_from ? (await c.query(
        `SELECT id, period_start::text, quantity, unit, status, co2e_scope2, co2e_scope2_market, co2e_direct FROM activity
          WHERE meter_id = $1 AND period_end >= $2 AND period_start <= $3 ORDER BY period_start`, [b.meter_id, b.period_from, b.period_to])).rows : [];
      return { ...b, text, entries };
    });
  });

  /** The PDF itself (for the preview beside the fields). */
  app.get('/api/documents/:id', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const d = await tenantTx(tenant, async (c) => {
      const doc = (await c.query('SELECT d.*, m.facility_id FROM document d LEFT JOIN bill b ON b.document_id = d.id LEFT JOIN meter m ON m.id = b.meter_id WHERE d.id = $1', [id])).rows[0];
      if (!doc || !(await visible(c, req, doc))) throw notFound('Document');
      return doc;
    });
    reply.header('Content-Type', d.content_type).header('Content-Disposition', `inline; filename="${d.filename.replace(/"/g, '')}"`).header('Cache-Control', 'private, max-age=300');
    return reply.send(d.data);
  });

  const fieldsSchema = z.object({
    meterId: z.string().uuid().nullable().optional(),
    supplier: z.string().trim().max(120).nullable().optional(),
    accountNo: z.string().trim().max(60).nullable().optional(),
    billNo: z.string().trim().max(60).nullable().optional(),
    periodFrom: isoDate.nullable().optional(),
    periodTo: isoDate.nullable().optional(),
    issueDate: isoDate.nullable().optional(),
    quantity: z.number().finite().min(0).nullable().optional(),
    unit: z.string().nullable().optional(),
    amount: z.number().finite().nullable().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  });
  const COLS: Record<string, string> = { meterId: 'meter_id', supplier: 'supplier', accountNo: 'account_no', billNo: 'bill_no', periodFrom: 'period_from', periodTo: 'period_to',
    issueDate: 'issue_date', quantity: 'quantity', unit: 'unit', amount: 'amount', currency: 'currency', note: 'note' };
  async function saveFields(c: Tx, id: string, f: z.infer<typeof fieldsSchema>) {
    const sets: string[] = [], vals: unknown[] = [id];
    for (const [k, col] of Object.entries(COLS)) if ((f as Record<string, unknown>)[k] !== undefined) { vals.push((f as Record<string, unknown>)[k]); sets.push(`${col} = $${vals.length}`); }
    if (sets.length) await c.query(`UPDATE bill SET ${sets.join(', ')} WHERE id = $1`, vals);
  }

  /** Save corrections without confirming. */
  app.patch('/api/bills/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const f = fieldsSchema.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
      if (!b || !(await visible(c, req, b))) throw notFound('Bill');
      if (b.status === 'confirmed') throw new AppError('This bill is booked: reopen it to change it');
      await saveFields(c, id, f);
      if (b.status === 'checked') await c.query(`UPDATE bill SET status = 'to_check', checked_by = NULL, checked_at = NULL WHERE id = $1`, [id]);
      return (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
    });
  });

  /** Confirm: the checked figures become the meter's reading for the billing period; entries follow. */
  app.post('/api/bills/:id/confirm', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const f = fieldsSchema.parse(req.body ?? {});
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const b0 = (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
      if (!b0 || !(await visible(c, req, b0))) throw notFound('Bill');
      if (b0.status === 'confirmed') throw new AppError('Already booked');
      await saveFields(c, id, f);
      const block = (await billIssues(c, (await c.query('SELECT * FROM bill WHERE id = $1', [id])).rows[0], t.timezone)).find((i) => i.level === 'block' && !/missing|No meter/.test(i.text));
      if (block) throw new AppError(block.text);
      const scope = await scopeOf(c, req.user);
      const sync = await bookBill(c, t, id, { id: req.user.id, name: req.user.name, req }, (fid) => assertCan(scope.enter, fid, 'book bills for this facility'));
      return { ...(await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0], sync };
    });
  });

  /** Reopen a booked bill: its reading is removed and the months recalculated. */
  app.post('/api/bills/:id/reopen', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const b = (await c.query('SELECT * FROM bill WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!b) throw notFound('Bill');
      if (b.status === 'confirmed' && b.meter_id && b.reading_ts) {
        const m = (await c.query('SELECT * FROM meter WHERE id = $1', [b.meter_id])).rows[0] as MeterRow;
        assertCan((await scopeOf(c, req.user)).enter, m.facility_id, 'reopen bills of this facility');
        await c.query(`DELETE FROM meter_reading WHERE meter_id = $1 AND ts = $2 AND source = 'bill'`, [b.meter_id, b.reading_ts]);
        const pf = String(b.period_from instanceof Date ? b.period_from.toISOString() : b.period_from).slice(0, 10);
        const pt = String(b.period_to instanceof Date ? b.period_to.toISOString() : b.period_to).slice(0, 10);
        // Entries of months no longer covered by any reading are removed (unless approved); the others recalculated.
        const months = new Set<string>();
        for (let x = Date.parse(`${pf}T00:00:00Z`); x <= Date.parse(`${pt}T00:00:00Z`); x += 86_400_000) months.add(new Date(x).toISOString().slice(0, 7));
        await syncMeter(c, t, m, { id: req.user.id, name: req.user.name, req }, months);
        await c.query(
          `DELETE FROM activity a WHERE a.meter_id = $1 AND a.status <> 'approved' AND to_char(a.period_start, 'YYYY-MM') = ANY($2)
             AND NOT EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id = a.meter_id AND r.ts > a.period_start AND COALESCE(r.from_ts, r.ts) < a.period_end + 1)`,
          [m.id, [...months]]);
      } else if (b.status === 'confirmed') throw new AppError('Bill has no reading to remove');
      else if (b.status === 'rejected') { /* back to check */ }
      await c.query(`UPDATE bill SET status = 'to_check', reading_ts = NULL, checked_by = NULL, checked_at = NULL WHERE id = $1`, [id]);
      await audit(c, req, 'bill.reopen', 'bill', id, {});
      return (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
    });
  });

  app.post('/api/bills/:id/reject', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ note: z.string().trim().min(2).max(500) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE bill SET status = 'rejected', note = $2, checked_by = $3, checked_at = now() WHERE id = $1 AND status IN ('to_check','checked') RETURNING id`, [id, b.note, req.user.id]);
      if (!r.rowCount) throw new AppError('Only a bill still to check can be rejected (reopen a booked one first)');
      await audit(c, req, 'bill.reject', 'bill', id, b);
      return { ok: true };
    });
  });

  /** Checked: the figures are right; the bill waits in the preview to be published. */
  app.post('/api/bills/:id/check', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const f = fieldsSchema.parse(req.body ?? {});
    return tenantTx(tenant, async (c) => {
      const b0 = (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
      if (!b0 || !(await visible(c, req, b0))) throw notFound('Bill');
      if (b0.status === 'confirmed') throw new AppError('Already booked');
      await saveFields(c, id, f);
      const b = (await c.query('SELECT * FROM bill WHERE id = $1', [id])).rows[0];
      if (!b.meter_id) throw new AppError('Choose the meter (utility account) this bill belongs to');
      if (!b.period_from || !b.period_to) throw new AppError('Enter the billing period');
      if (d10(b.period_to) < d10(b.period_from)) throw new AppError('The billing period ends before it starts');
      if (b.quantity == null) throw new AppError('Enter the consumption');
      const m = (await c.query('SELECT facility_id FROM meter WHERE id = $1', [b.meter_id])).rows[0];
      assertCan((await scopeOf(c, req.user)).enter, m.facility_id, 'enter data for this facility');
      await c.query(`UPDATE bill SET status = 'checked', checked_by = $2, checked_at = now() WHERE id = $1`, [id, req.user.id]);
      await audit(c, req, 'bill.check', 'bill', id, {});
      return (await c.query(`${SELECT_BILL} WHERE b.id = $1`, [id])).rows[0];
    });
  });

  /** Preview of the checked bills of a category: what each becomes, month by month, and what stops it. */
  app.get('/api/bills/preview', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ category: z.string().max(40).optional() }).parse(req.query);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const rows = (await c.query(`${SELECT_BILL} WHERE b.status = 'checked' AND ($1::text IS NULL OR coalesce(mc.code, b.category) = $1 OR ($1 = 'waste' AND coalesce(mc.code, b.category) LIKE 'waste_%'))
                                    ORDER BY m.name, b.period_from`, [q.category ?? null])).rows;
      const { units } = await refdata();
      const out = [];
      for (const b of rows) {
        if (!(await visible(c, req, b))) continue;
        const issues = await billIssues(c, b, t.timezone);
        const pf = d10(b.period_from), pt = d10(b.period_to);
        const split = monthSplit(pf, pt), days = [...split.values()].reduce((a, x) => a + x, 0);
        const m = (await c.query('SELECT * FROM meter WHERE id = $1', [b.meter_id])).rows[0] as MeterRow;
        let qty = Number(b.quantity), co2e: number | null = null;
        try {
          if (b.unit && b.unit !== m.unit) qty = convert(units, qty, b.unit, m.unit);
          const fac = (await c.query('SELECT id, country, grid_region FROM org_node WHERE id = $1', [m.facility_id])).rows[0];
          await c.query('SAVEPOINT bill_preview');
          const { result } = await calculate(await inputFor(m, qty, { periodStart: pf, periodEnd: pt }), contextFor(c, t.gwp_set, fac.country, fac));
          await c.query('RELEASE SAVEPOINT bill_preview');
          const T = result.totals;
          co2e = (T.direct + T.scope2 + T.scope3 + T.wtt + T.td_loss) / 1000;
          for (const w of result.warnings.slice(0, 3)) issues.push({ level: 'warn', text: w });
        } catch (e) { await c.query('ROLLBACK TO SAVEPOINT bill_preview').catch(() => {}); issues.push({ level: 'block', text: `Cannot be calculated: ${(e as Error).message}` }); }
        out.push({ ...b, issues, ok: !issues.some((i) => i.level === 'block'), meterUnit: m.unit, qty, co2e, days,
          months: [...split.entries()].map(([month, d]) => ({ month, days: d, qty: (qty * d) / days })) });
      }
      return { bills: out };
    });
  });

  /** Publish: book the previewed bills (those without a blocking issue). */
  app.post('/api/bills/publish', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).parse(req.body);
    const t = await tenantSettings(tenant);
    return tenantTx(tenant, async (c) => {
      const scope = await scopeOf(c, req.user);
      const done: string[] = [], failed: { id: string; error: string }[] = [];
      let created = 0, updated = 0;
      for (const id of b.ids) {
        const x = (await c.query('SELECT * FROM bill WHERE id = $1', [id])).rows[0];
        if (!x || x.status !== 'checked') { failed.push({ id, error: 'Not a checked bill' }); continue; }
        const block = (await billIssues(c, x, t.timezone)).find((i) => i.level === 'block');
        if (block) { failed.push({ id, error: block.text }); continue; }
        await c.query('SAVEPOINT bill_publish');
        try {
          const s = await bookBill(c, t, id, { id: req.user.id, name: req.user.name, req }, (fid) => assertCan(scope.enter, fid, 'book bills for this facility'));
          await c.query('RELEASE SAVEPOINT bill_publish');
          done.push(id); created += s.created; updated += s.updated;
        } catch (e) { await c.query('ROLLBACK TO SAVEPOINT bill_publish'); failed.push({ id, error: (e as Error).message }); }
      }
      return { booked: done.length, failed, entries: { created, updated } };
    });
  });

}
