/**
 * Waste contractor portal.
 *
 * The collector / treatment company signs in at /contractor with its work email and an access code (shown once
 * to the BEEAH person who created it; stored only as a hash; expires; can be revoked or replaced). No user account
 * and no password. A session lasts 8 hours (header x-contractor-token). The contractor sees only the bins
 * assigned to it and can:
 *   - record a collection: date, manifest number (required for hazardous waste), weighbridge weight, vehicle,
 *     the ticket / manifest as a PDF or photo — saved as a collection scan of the bin, used by the month roll-up;
 *   - send a monthly statement: tonnes per site, material and disposal method of its bins, with the statement or
 *     treatment certificate — checked by BEEAH staff against their own scans (accepted / queried).
 * Nothing it sends goes into the inventory by itself: collections become draft entries through the roll-up, and
 * approval stays with BEEAH (maker–checker).
 *
 * Staff (secured):  GET/POST /api/qr/contractors · POST /api/qr/contractors/:id/code · POST /api/qr/contractors/:id/revoke
 *                   GET /api/qr/statements?year=&month= (with the reconciliation) · PUT /api/qr/statements/:id
 *                   GET /api/qr/documents/:id (ticket or statement file)
 * Public:           POST /api/public/contractor/login · GET /api/public/contractor/me · POST /api/public/contractor/evidence
 *                   POST /api/public/contractor/collections · POST /api/public/contractor/collections/:id/void
 *                   PUT /api/public/contractor/statements
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf } from '../lib/access.js';
import { AppError, notFound } from '../lib/errors.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...randomBytes(10)].map((x) => ABC[x % ABC.length]).join('');
const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const SESSION_H = 8;
const pad = (n: number) => String(n).padStart(2, '0');
const monthOf = (y: number, m: number) => ({ start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` });

const hits = new Map<string, { at: number; n: number }>();
function limit(key: string, max: number) {
  const now = Date.now(), w = hits.get(key);
  if (!w || now - w.at > 60_000) { hits.set(key, { at: now, n: 1 }); return; }
  if (++w.n > max) throw new AppError('Too many tries: wait a minute and try again', 429, 'RATE_LIMITED');
}

/** The contractor behind the session token. */
async function session(req: FastifyRequest) {
  const tok = String(req.headers['x-contractor-token'] ?? '');
  if (!/^[a-f0-9]{64}$/.test(tok)) throw new AppError('Sign in again', 401, 'UNAUTHENTICATED');
  return platformTx(async (c) => {
    const s = (await c.query(`SELECT s.tenant_id, s.contractor_id, w.name, w.revoked, w.expires_at FROM contractor_session s JOIN waste_contractor w ON w.id = s.contractor_id
                               WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(tok)])).rows[0];
    if (!s || s.revoked || (s.expires_at && new Date(s.expires_at) < new Date(new Date().toDateString()))) throw new AppError('Sign in again', 401, 'UNAUTHENTICATED');
    return { tenant: s.tenant_id as string, id: s.contractor_id as string, name: s.name as string };
  });
}
const log = (c: Tx, k: { tenant: string; name: string }, action: string, entityId: string | null, detail: unknown, ip: string) =>
  c.query(`INSERT INTO audit_log (tenant_id, user_id, user_name, action, entity, entity_id, detail, ip) VALUES ($1, NULL, $2, $3, 'waste_contractor', $4, $5, $6)`,
    [k.tenant, `${k.name} (contractor)`, action, entityId, JSON.stringify(detail), ip]);

/** Bins at a contractor's name are linked to it (when the name matches). */
export async function linkBins(c: Tx) {
  await c.query(`UPDATE waste_bin b SET contractor_id = w.id FROM waste_contractor w
                  WHERE w.tenant_id = b.tenant_id AND NOT w.revoked AND b.contractor_id IS NULL AND lower(trim(b.contractor)) = lower(trim(w.name))`);
}

/** Month kg per bin, the same way as the roll-up (weighbridge weights of collections when there are any, else the scans), used or not. */
async function binMonthKg(c: Tx, binIds: string[], y: number, m: number) {
  const { start, end } = monthOf(y, m);
  const rows = (await c.query(`SELECT bin_id, kind, kg::float8 AS kg FROM waste_scan WHERE bin_id = ANY($1) AND status <> 'void' AND at >= $2::date AND at < ($3::date + 1)`, [binIds, start, end])).rows;
  const out = new Map<string, number>();
  for (const id of binIds) {
    const s = rows.filter((r) => r.bin_id === id), col = s.filter((r) => r.kind === 'collection' && r.kg > 0);
    out.set(id, (col.length ? col : s.filter((r) => r.kind !== 'collection')).reduce((a, r) => a + r.kg, 0));
  }
  return out;
}

const lineSchema = z.object({ facilityId: z.string().uuid(), itemId: z.number().int().positive(), gri: z.string().max(20).nullable().optional(), tonnes: z.number().min(0).max(1e6) });
const lineKey = (l: { facilityId: string; itemId: number; gri?: string | null }) => `${l.facilityId}|${l.itemId}|${l.gri ?? ''}`;

export async function contractorRoutes(app: FastifyInstance) {
  app.get('/api/qr/contractors', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => ({
      contractors: (await c.query(
        `SELECT w.id, w.name, w.email, w.contact, w.expires_at AS "expiresAt", w.revoked, w.last_used_at AS "lastUsed", w.code_hash IS NOT NULL AS "hasCode",
                (SELECT count(*)::int FROM waste_bin b WHERE b.contractor_id = w.id AND b.active) AS bins,
                (SELECT max(s.at) FROM waste_scan s WHERE s.contractor_id = w.id) AS "lastCollection"
           FROM waste_contractor w ORDER BY w.revoked, w.name`)).rows,
    }));
  });

  app.post('/api/qr/contractors', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const b = z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200), contact: z.string().trim().max(200).optional(), months: z.number().int().min(1).max(24).default(12) }).parse(req.body);
    const code = newCode();
    return tenantTx(tenant, async (c) => {
      if ((await c.query('SELECT 1 FROM waste_contractor WHERE lower(name) = lower($1)', [b.name])).rowCount) throw new AppError('A contractor with this name already exists: give it a new code instead');
      const r = (await c.query(`INSERT INTO waste_contractor (tenant_id, name, email, contact, code_hash, expires_at, created_by) VALUES ($1,$2,$3,$4,$5, (current_date + make_interval(months => $6))::date, $7) RETURNING id, expires_at AS "expiresAt"`,
        [tenant, b.name, b.email.toLowerCase(), b.contact || null, sha(code), b.months, req.user.name])).rows[0];
      await linkBins(c);
      await audit(c, req, 'contractor.create', 'waste_contractor', r.id, { name: b.name, email: b.email });
      return { id: r.id, code, expiresAt: r.expiresAt, bins: Number((await c.query('SELECT count(*) FROM waste_bin WHERE contractor_id = $1', [r.id])).rows[0].count) };
    });
  });

  app.post('/api/qr/contractors/:id/code', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ months: z.number().int().min(1).max(24).default(12) }).parse(req.body ?? {});
    const code = newCode();
    return tenantTx(tenant, async (c) => {
      const r = (await c.query(`UPDATE waste_contractor SET code_hash = $2, revoked = false, expires_at = (current_date + make_interval(months => $3))::date WHERE id = $1 RETURNING expires_at AS "expiresAt"`, [id, sha(code), b.months])).rows[0];
      if (!r) throw notFound('Contractor');
      await c.query('DELETE FROM contractor_session WHERE contractor_id = $1', [id]);
      await linkBins(c);
      await audit(c, req, 'contractor.code', 'waste_contractor', id);
      return { code, expiresAt: r.expiresAt };
    });
  });

  app.post('/api/qr/contractors/:id/revoke', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      if (!(await c.query('UPDATE waste_contractor SET revoked = true, code_hash = NULL WHERE id = $1', [id])).rowCount) throw notFound('Contractor');
      await c.query('DELETE FROM contractor_session WHERE contractor_id = $1', [id]);
      await audit(c, req, 'contractor.revoke', 'waste_contractor', id);
      return { ok: true };
    });
  });

  /** The month's statements with the reconciliation against Ekotrace's own figures (per site, material and method). */
  app.get('/api/qr/statements', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const see = (await scopeOf(c, req.user)).see;
      const tol = 10;   // % gap flagged
      const ws = (await c.query(`SELECT id, name FROM waste_contractor ORDER BY name`)).rows;
      const out = [];
      for (const w of ws) {
        const bins = (await c.query(`SELECT b.id, b.facility_id, f.name AS facility, b.item_id, b.gri, i.name AS item FROM waste_bin b JOIN org_node f ON f.id = b.facility_id JOIN item i ON i.id = b.item_id
                                      WHERE b.contractor_id = $1`, [w.id])).rows.filter((b) => see.has(b.facility_id));
        const st = (await c.query(`SELECT id, lines, document_id AS "documentId", note, status, review_note AS "reviewNote", reviewed_by AS "reviewedBy", submitted_at AS "submittedAt"
                                     FROM contractor_statement WHERE contractor_id = $1 AND year = $2 AND month = $3`, [w.id, q.year, q.month])).rows[0] ?? null;
        if (!bins.length && !st) continue;
        const kg = await binMonthKg(c, bins.map((b) => b.id), q.year, q.month);
        const lines = new Map<string, { facility: string; item: string; ours: number; theirs: number | null }>();
        for (const b of bins) {
          const k = lineKey({ facilityId: b.facility_id, itemId: b.item_id, gri: b.gri });
          const l = lines.get(k) ?? { facility: b.facility, item: b.item, ours: 0, theirs: null };
          l.ours += (kg.get(b.id) ?? 0) / 1000; lines.set(k, l);
        }
        for (const l of (st?.lines ?? []) as z.infer<typeof lineSchema>[]) {
          const k = lineKey(l), x = lines.get(k);
          if (x) x.theirs = (x.theirs ?? 0) + l.tonnes;
          else lines.set(k, { facility: '(not a bin of this contractor)', item: String(l.itemId), ours: 0, theirs: l.tonnes });
        }
        const rows = [...lines.values()].map((l) => ({ ...l, gapPct: l.theirs == null ? null : l.ours ? ((l.theirs - l.ours) / l.ours) * 100 : l.theirs ? 100 : 0 }));
        const ours = rows.reduce((a, r) => a + r.ours, 0), theirs = st ? rows.reduce((a, r) => a + (r.theirs ?? 0), 0) : null;
        out.push({ contractorId: w.id, contractor: w.name, statement: st, lines: rows, ours, theirs,
          gapPct: theirs == null ? null : ours ? ((theirs - ours) / ours) * 100 : theirs ? 100 : 0, flagged: rows.some((r) => r.gapPct != null && Math.abs(r.gapPct) > tol) });
      }
      return { tolerancePct: tol, contractors: out };
    });
  });

  app.put('/api/qr/statements/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin', 'admin', 'manager');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ status: z.enum(['accepted', 'queried']), note: z.string().trim().max(1000).optional() }).parse(req.body);
    if (b.status === 'queried' && !b.note) throw new AppError('Say what does not match, so the contractor can correct it');
    return tenantTx(tenant, async (c) => {
      const r = await c.query(`UPDATE contractor_statement SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`, [id, b.status, b.note ?? null, req.user.name]);
      if (!r.rowCount) throw notFound('Statement');
      await audit(c, req, `contractor.statement.${b.status}`, 'contractor_statement', id, { note: b.note });
      return { ok: true };
    });
  });

  app.get('/api/qr/documents/:id', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const d = await tenantTx(tenant, async (c) => (await c.query(`SELECT filename, content_type, data FROM document WHERE id = $1 AND kind = 'waste_evidence'`, [id])).rows[0]);
    if (!d) throw notFound('Document');
    return reply.header('content-type', d.content_type).header('content-disposition', `inline; filename="${String(d.filename).replace(/[^\w.\- ]/g, '_')}"`).send(d.data);
  });
}

export async function contractorPublicRoutes(app: FastifyInstance) {
  app.post('/api/public/contractor/login', async (req) => {
    limit(`cl:${req.ip}`, 10);
    const b = z.object({ email: z.string().trim().toLowerCase().email().max(200), code: z.string().max(40) }).parse(req.body);
    limit(`cle:${b.email}`, 10);
    const code = cleanCode(b.code);
    return platformTx(async (c) => {
      const rows = (await c.query(`SELECT w.id, w.tenant_id, w.name, w.code_hash, w.expires_at, t.name AS company FROM waste_contractor w JOIN tenant t ON t.id = w.tenant_id
                                    WHERE lower(w.email) = $1 AND NOT w.revoked AND w.code_hash IS NOT NULL`, [b.email])).rows;
      const h = Buffer.from(sha(code));
      const w = rows.find((r) => timingSafeEqual(Buffer.from(r.code_hash), h));
      if (!w) throw new AppError('That email and code do not match. Check the invitation, or ask your contact for a new code.', 401, 'UNAUTHENTICATED');
      if (w.expires_at && new Date(w.expires_at) < new Date(new Date().toDateString())) throw new AppError('This access code has expired: ask your contact for a new one.', 401, 'UNAUTHENTICATED');
      const tok = randomBytes(32).toString('hex');
      await c.query(`DELETE FROM contractor_session WHERE contractor_id = $1 AND expires_at < now()`, [w.id]);
      await c.query(`INSERT INTO contractor_session (token_hash, tenant_id, contractor_id, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))`, [sha(tok), w.tenant_id, w.id, SESSION_H]);
      await c.query('UPDATE waste_contractor SET last_used_at = now() WHERE id = $1', [w.id]);
      await log(c, { tenant: w.tenant_id, name: w.name }, 'contractor.login', w.id, {}, req.ip);
      return { token: tok, contractor: w.name, company: w.company };
    });
  });

  app.post('/api/public/contractor/logout', async (req) => {
    const tok = String(req.headers['x-contractor-token'] ?? '');
    if (/^[a-f0-9]{64}$/.test(tok)) await platformTx((c) => c.query('DELETE FROM contractor_session WHERE token_hash = $1', [sha(tok)]));
    return { ok: true };
  });

  app.get('/api/public/contractor/me', async (req) => {
    const k = await session(req);
    return tenantTx(k.tenant, async (c) => {
      const company = (await c.query('SELECT name FROM tenant WHERE id = $1', [k.tenant])).rows[0]?.name ?? '';
      const bins = (await c.query(`SELECT b.id, b.code, b.name, b.location, b.facility_id AS "facilityId", f.name AS facility, b.item_id AS "itemId", i.name AS item,
                                          i.attrs->>'material' AS material, i.attrs->>'route' AS route, b.gri, b.hazardous
                                     FROM waste_bin b JOIN org_node f ON f.id = b.facility_id JOIN item i ON i.id = b.item_id
                                    WHERE b.contractor_id = $1 AND b.active ORDER BY f.name, b.name`, [k.id])).rows;
      const collections = (await c.query(`SELECT s.id, b.name AS bin, f.name AS facility, s.at, s.kg::float8 AS kg, s.manifest, s.vehicle, s.note, s.status, s.document_id AS "documentId", s.contractor_id IS NOT NULL AS "byYou"
                                            FROM waste_scan s JOIN waste_bin b ON b.id = s.bin_id JOIN org_node f ON f.id = s.facility_id
                                           WHERE b.contractor_id = $1 AND s.kind = 'collection' AND s.status <> 'void' AND s.at > now() - interval '120 days' ORDER BY s.at DESC LIMIT 200`, [k.id])).rows;
      const statements = (await c.query(`SELECT id, year, month, lines, note, status, review_note AS "reviewNote", submitted_at AS "submittedAt", document_id AS "documentId"
                                           FROM contractor_statement WHERE contractor_id = $1 ORDER BY year DESC, month DESC LIMIT 24`, [k.id])).rows;
      return { contractor: k.name, company, bins, collections, statements };
    });
  });

  /** A ticket, manifest or statement: PDF, JPEG or PNG, up to 10 MB (body = the file, header x-filename). */
  app.post('/api/public/contractor/evidence', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const k = await session(req);
    limit(`ce:${k.id}`, 30);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
    const type = buf.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg'
      : buf.subarray(1, 4).toString('latin1') === 'PNG' ? 'image/png' : null;
    if (!type) throw new AppError('Send a PDF, JPEG or PNG');
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'ticket')).replace(/[^\w.\- ()]/g, '_').slice(0, 160);
    const h = createHash('sha256').update(buf).digest('hex');
    return tenantTx(k.tenant, async (c) => {
      const prior = (await c.query('SELECT id FROM document WHERE sha256 = $1', [h])).rows[0];
      const id = prior?.id ?? (await c.query(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1,'waste_evidence',$2,$3,$4,$5,$6,$7) RETURNING id`,
        [k.tenant, filename, type, buf.length, h, buf, `${k.name} (contractor)`])).rows[0].id;
      await log(c, k, 'contractor.evidence', id, { filename, size: buf.length }, req.ip);
      return { documentId: id, filename };
    });
  });

  app.post('/api/public/contractor/collections', async (req) => {
    const k = await session(req);
    limit(`cc:${k.id}`, 60);
    const b = z.object({
      binId: z.string().uuid().optional(), code: z.string().max(20).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), kg: z.number().positive().max(1e6),
      manifest: z.string().trim().max(120).optional(), vehicle: z.string().trim().max(40).optional(), note: z.string().trim().max(500).optional(), documentId: z.string().uuid().optional(),
    }).parse(req.body);
    const at = new Date(`${b.date}T12:00:00Z`);
    if (at.getTime() > Date.now() + 86_400_000) throw new AppError('The date is in the future');
    if (at.getTime() < Date.now() - 400 * 86_400_000) throw new AppError('The date is more than a year ago');
    return tenantTx(k.tenant, async (c) => {
      const bin = (await c.query(`SELECT id, name, facility_id, hazardous FROM waste_bin WHERE contractor_id = $1 AND active AND (id = $2 OR code = $3)`, [k.id, b.binId ?? null, b.code ? cleanCode(b.code) : null])).rows[0];
      if (!bin) throw new AppError('This bin is not assigned to you');
      if (bin.hazardous && !b.manifest) throw new AppError('Hazardous waste: enter the manifest number');
      if (b.manifest && (await c.query(`SELECT 1 FROM waste_scan WHERE bin_id = $1 AND kind = 'collection' AND status <> 'void' AND lower(trim(manifest)) = lower(trim($2))`, [bin.id, b.manifest])).rowCount) {
        throw new AppError(`Manifest ${b.manifest} is already recorded for this bin`, 409, 'DUPLICATE');
      }
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1 AND kind = 'waste_evidence'`, [b.documentId])).rowCount) throw new AppError('The file was not found: upload it again');
      const r = (await c.query(`INSERT INTO waste_scan (tenant_id, bin_id, facility_id, kind, kg, manifest, note, vehicle, document_id, contractor_id, at, by_user, flags)
                                VALUES ($1,$2,$3,'collection',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [k.tenant, bin.id, bin.facility_id, b.kg, b.manifest || null, b.note || null, b.vehicle || null, b.documentId ?? null, k.id, at.toISOString(), `${k.name} (contractor)`, b.documentId ? [] : ['No ticket attached']])).rows[0];
      await log(c, k, 'contractor.collection', r.id, { bin: bin.name, kg: b.kg, manifest: b.manifest }, req.ip);
      return { id: r.id };
    });
  });

  app.post('/api/public/contractor/collections/:id/void', async (req) => {
    const k = await session(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(k.tenant, async (c) => {
      const s = (await c.query(`SELECT status FROM waste_scan WHERE id = $1 AND contractor_id = $2`, [id, k.id])).rows[0];
      if (!s) throw notFound('Collection');
      if (s.status !== 'open') throw new AppError('Already used in a waste entry: ask your contact to correct it');
      await c.query(`UPDATE waste_scan SET status = 'void' WHERE id = $1`, [id]);
      await log(c, k, 'contractor.collection.void', id, {}, req.ip);
      return { ok: true };
    });
  });

  app.put('/api/public/contractor/statements', async (req) => {
    const k = await session(req);
    const b = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), lines: z.array(lineSchema).min(1).max(200),
      documentId: z.string().uuid().optional(), note: z.string().trim().max(1000).optional() }).parse(req.body);
    const now = new Date();
    if (b.year * 12 + b.month > now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) throw new AppError('That month has not started yet');
    return tenantTx(k.tenant, async (c) => {
      const mine = new Set((await c.query(`SELECT facility_id, item_id, gri FROM waste_bin WHERE contractor_id = $1`, [k.id])).rows.map((r) => lineKey({ facilityId: r.facility_id, itemId: r.item_id, gri: r.gri })));
      const bad = b.lines.find((l) => !mine.has(lineKey(l)));
      if (bad) throw new AppError('A line is not for one of your bins');
      const prev = (await c.query('SELECT status FROM contractor_statement WHERE contractor_id = $1 AND year = $2 AND month = $3', [k.id, b.year, b.month])).rows[0];
      if (prev?.status === 'accepted') throw new AppError('This statement was accepted: ask your contact to reopen it');
      if (b.documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1 AND kind = 'waste_evidence'`, [b.documentId])).rowCount) throw new AppError('The file was not found: upload it again');
      const r = (await c.query(`INSERT INTO contractor_statement (tenant_id, contractor_id, year, month, lines, document_id, note) VALUES ($1,$2,$3,$4,$5,$6,$7)
                                ON CONFLICT (contractor_id, year, month) DO UPDATE SET lines = EXCLUDED.lines, document_id = COALESCE(EXCLUDED.document_id, contractor_statement.document_id), note = EXCLUDED.note,
                                  status = 'submitted', review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, submitted_at = now() RETURNING id`,
        [k.tenant, k.id, b.year, b.month, JSON.stringify(b.lines), b.documentId ?? null, b.note || null])).rows[0];
      await log(c, k, 'contractor.statement', r.id, { year: b.year, month: b.month, tonnes: b.lines.reduce((a, l) => a + l.tonnes, 0) }, req.ip);
      return { id: r.id };
    });
  });
}
