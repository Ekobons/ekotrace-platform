/**
 * Document vault (Capture): every file of the company in one place.
 *
 *   What is in it   files uploaded here, plus the files other screens keep: bills, purchase files, contractor
 *                   tickets and manifests, the assurance statement. (Logos and message attachments are not.)
 *   Filed by        facility (or company-wide), type, period covered, data category, tags; "valid until" for
 *                   permits, certificates and calibration records.
 *   Evidence        a file is linked to the entries it supports (several either way). Evidence can be added to
 *                   an entry in a locked month, never removed (database trigger).
 *   Versions        a new version replaces a file and keeps its links; the old one stays, marked replaced.
 *   Retention       kept for the company's retention period (default 7 years after the period it covers). An
 *                   uploaded file can be archived (with a reason) and restored; deleted for good only by the super
 *                   admin, once archived, past retention and not supporting any entry.
 *   Access          a file of a facility is seen by whoever sees the facility; company-wide files by everyone in
 *                   the company, except purchase files and assurance papers (admins and verifiers).
 *                   Verifiers read only.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { tenantTx, type Tx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { scopeOf, type Scope } from '../lib/access.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { sealFile, openFile } from '../lib/secrets.js';

export const DOC_TYPES = {
  bill: 'Utility bill', invoice: 'Invoice / receipt', statement: 'Supplier or contractor statement', manifest: 'Waste manifest / ticket',
  meter: 'Meter photo / reading sheet', permit: 'Permit & licence', certificate: 'Certificate', contract: 'Contract / PPA',
  calibration: 'Calibration record', refrigerant: 'Refrigerant service log', travel: 'Travel booking / report', data: 'Data file',
  policy: 'Policy / procedure', assurance: 'Assurance / verification', other: 'Other',
} as const;
type DocType = keyof typeof DOC_TYPES;
const TYPE_KEYS = Object.keys(DOC_TYPES) as [DocType, ...DocType[]];
/** Type of a file another screen stored, when nobody set one. */
const TYPE_SQL = `coalesce(d.doc_type, CASE d.kind WHEN 'bill' THEN 'bill' WHEN 'purchases' THEN 'data' WHEN 'waste_evidence' THEN 'manifest' WHEN 'assurance' THEN 'assurance' ELSE 'other' END)`;
const SOURCE: Record<string, string> = { vault: 'Uploaded here', bill: 'Bills', purchases: 'Purchases', waste_evidence: 'Waste contractor', assurance: 'Audit & assurance' };
const RESTRICTED = new Set(['purchases', 'assurance']);
/** Types that do not need to support an entry (the others are listed as "not linked" until they do). */
const STANDALONE = new Set(['permit', 'certificate', 'contract', 'policy', 'calibration', 'assurance', 'other']);
const EDITORS = ['super_admin', 'admin', 'manager', 'preparer', 'platform_admin'];
const MAX = 25 * 1024 * 1024;

/** Accepted files: checked by their first bytes, not just the name. */
const EXT: Record<string, { type: string; magic: 'pdf' | 'png' | 'jpg' | 'webp' | 'zip' | 'ole' | 'text' }> = {
  pdf: { type: 'application/pdf', magic: 'pdf' }, png: { type: 'image/png', magic: 'png' }, jpg: { type: 'image/jpeg', magic: 'jpg' }, jpeg: { type: 'image/jpeg', magic: 'jpg' },
  webp: { type: 'image/webp', magic: 'webp' },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' },
  xls: { type: 'application/vnd.ms-excel', magic: 'ole' }, doc: { type: 'application/msword', magic: 'ole' }, msg: { type: 'application/vnd.ms-outlook', magic: 'ole' },
  csv: { type: 'text/csv', magic: 'text' }, txt: { type: 'text/plain', magic: 'text' }, eml: { type: 'message/rfc822', magic: 'text' },
};
export function fileType(buf: Buffer, filename: string, allowed: string[] = Object.keys(EXT)): string {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const e = allowed.includes(ext) ? EXT[ext] : undefined;
  if (!e) throw new AppError(`This kind of file is not accepted. Use ${allowed.map((x) => x.toUpperCase()).join(', ')}.`);
  const head = buf.subarray(0, 8);
  const ok = {
    pdf: head.subarray(0, 5).toString('latin1') === '%PDF-',
    png: head.subarray(1, 4).toString('latin1') === 'PNG',
    jpg: head[0] === 0xff && head[1] === 0xd8,
    webp: head.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP',
    zip: head[0] === 0x50 && head[1] === 0x4b,
    ole: head.subarray(0, 4).toString('hex') === 'd0cf11e0',
    text: !buf.subarray(0, 4096).includes(0),
  }[e.magic];
  if (!ok) throw new AppError(`The file does not look like a .${ext} file`);
  return e.type;
}
export const cleanName = (raw: unknown, fallback: string) => decodeURIComponent(String(raw ?? fallback)).replace(/[^\w.\- ()]/g, '_').slice(0, 160) || fallback;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const metaSchema = z.object({
  type: z.enum(TYPE_KEYS).default('other'),
  title: z.string().trim().max(200).nullable().optional(),
  facilityId: z.string().uuid().nullable().optional(),
  periodFrom: date.nullable().optional(),
  periodTo: date.nullable().optional(),
  validUntil: date.nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});
type Meta = z.infer<typeof metaSchema>;

/** The facility a file belongs to: its own, or (bills) its meter's. */
const FAC_SQL = `coalesce(d.facility_id, (SELECT m.facility_id FROM bill b JOIN meter m ON m.id = b.meter_id WHERE b.document_id = d.id AND m.facility_id IS NOT NULL LIMIT 1))`;

interface DocRow { id: string; kind: string; fac: string | null; linked_facs: string[] | null }
function canSee(req: FastifyRequest, s: Scope, d: DocRow) {
  const wide = ['super_admin', 'platform_admin', 'verifier'].includes(req.user.role);
  if (RESTRICTED.has(d.kind) && !['super_admin', 'admin', 'verifier', 'platform_admin'].includes(req.user.role)) return false;
  if (d.fac) return s.see.has(d.fac);
  const linked = (d.linked_facs ?? []).filter(Boolean);
  if (linked.length) return wide || linked.some((f) => s.see.has(f));
  return true; // company-wide
}
function canEdit(req: FastifyRequest, s: Scope, d: DocRow) {
  if (!EDITORS.includes(req.user.role)) return false;
  if (d.fac) return s.enter.has(d.fac) || s.approve.has(d.fac);
  return ['super_admin', 'admin', 'platform_admin'].includes(req.user.role) || (d.linked_facs ?? []).some((f) => s.enter.has(f));
}
function retainUntil(periodTo: string | null, uploaded: string, years: number) {
  const base = new Date((periodTo ?? uploaded).slice(0, 10) + 'T00:00:00Z');
  base.setUTCFullYear(base.getUTCFullYear() + years);
  return base.toISOString().slice(0, 10);
}

async function loadDoc(c: Tx, id: string) {
  const d = (await c.query(
    `SELECT d.id, d.kind, ${FAC_SQL} AS fac, d.archived_at,
            (SELECT array_agg(DISTINCT a.facility_id) FROM document_link l JOIN activity a ON a.id = l.activity_id WHERE l.document_id = d.id) AS linked_facs
       FROM document d WHERE d.id = $1 AND d.kind NOT IN ('logo', 'message')`, [id])).rows[0];
  if (!d) throw notFound('Document');
  return d as DocRow & { archived_at: string | null };
}

async function checkMeta(c: Tx, req: FastifyRequest, s: Scope, m: Meta) {
  if (m.facilityId && !(s.enter.has(m.facilityId) || s.approve.has(m.facilityId))) throw forbidden('You cannot add files for that facility');
  if (!m.facilityId && !['super_admin', 'admin', 'platform_admin'].includes(req.user.role)) throw new AppError('Choose the facility the file belongs to (company-wide files are added by admins)');
  if (m.periodFrom && m.periodTo && m.periodTo < m.periodFrom) throw new AppError('The period ends before it starts');
  if (m.category && !(await c.query('SELECT 1 FROM subcategory WHERE code = $1', [m.category])).rowCount) throw new AppError('Unknown data category');
}

/** Link entries to a file: each must be visible, and the user must be able to enter or approve for its facility. */
async function linkEntries(c: Tx, req: FastifyRequest, s: Scope, tenant: string, docId: string, ids: string[]) {
  if (!ids.length) return 0;
  const rows = (await c.query('SELECT id, facility_id FROM activity WHERE id = ANY($1)', [ids])).rows as { id: string; facility_id: string }[];
  if (rows.length !== new Set(ids).size) throw notFound('Entry');
  for (const r of rows) if (!(s.enter.has(r.facility_id) || s.approve.has(r.facility_id))) throw forbidden('You cannot add evidence to entries of that facility');
  const n = (await c.query(`INSERT INTO document_link (tenant_id, document_id, activity_id, linked_by) SELECT $1, $2, x, $4 FROM unnest($3::uuid[]) x ON CONFLICT DO NOTHING`,
    [tenant, docId, rows.map((r) => r.id), req.user.name])).rowCount ?? 0;
  return n;
}

export async function vaultRoutes(app: FastifyInstance) {
  /** The list, with filters, and the figures at the top. */
  app.get('/api/vault', async (req) => {
    const tenant = requireTenant(req);
    const q = z.object({
      facilityId: z.string().uuid().optional(), type: z.enum(TYPE_KEYS).optional(), year: z.coerce.number().int().min(2000).max(2100).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(), q: z.string().trim().max(100).optional(), category: z.string().max(60).optional(),
      view: z.enum(['active', 'expiring', 'unlinked', 'archived', 'all']).default('active'),
    }).parse(req.query);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const years = Number((await c.query('SELECT doc_retention_years FROM tenant WHERE id = $1', [tenant])).rows[0].doc_retention_years);
      const rows = (await c.query(
        `SELECT d.id, d.kind, d.filename, d.content_type, d.size, d.uploaded_at, d.uploaded_by, ${TYPE_SQL} AS type, d.title,
                ${FAC_SQL} AS fac, f.name AS facility, d.period_from::text, d.period_to::text, d.valid_until::text, d.note, d.tags, d.category,
                sc.name AS category_name, d.version, d.replaced_by, d.archived_at, d.archive_reason,
                coalesce(u.name, d.uploaded_by) AS uploaded_by_name,
                (SELECT count(*)::int FROM document_link l WHERE l.document_id = d.id) AS links,
                (SELECT array_agg(DISTINCT a.facility_id) FROM document_link l JOIN activity a ON a.id = l.activity_id WHERE l.document_id = d.id) AS linked_facs,
                b.period_from::text AS bill_from, b.period_to::text AS bill_to, b.status AS bill_status
           FROM document d
           LEFT JOIN org_node f ON f.id = ${FAC_SQL}
           LEFT JOIN subcategory sc ON sc.code = d.category
           LEFT JOIN app_user u ON u.id::text = d.uploaded_by
           LEFT JOIN LATERAL (SELECT period_from, period_to, status FROM bill WHERE document_id = d.id ORDER BY period_from NULLS LAST LIMIT 1) b ON true
          WHERE d.kind NOT IN ('logo', 'message')
          ORDER BY least(coalesce(d.period_to, b.period_to, d.uploaded_at::date), current_date) DESC, d.uploaded_at DESC`)).rows;
      const today = new Date().toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
      const visible = rows.filter((r) => canSee(req, s, r)).map((r) => {
        const pFrom = r.period_from ?? r.bill_from, pTo = r.period_to ?? r.bill_to;
        const expiry = r.valid_until ? (r.valid_until < today ? 'expired' : r.valid_until <= soon ? 'soon' : 'valid') : null;
        return {
          id: r.id, kind: r.kind, source: SOURCE[r.kind] ?? r.kind, filename: r.filename, contentType: r.content_type, size: r.size, uploadedAt: r.uploaded_at,
          uploadedBy: r.uploaded_by_name, type: r.type, typeName: DOC_TYPES[r.type as DocType] ?? r.type, title: r.title, facilityId: r.fac, facility: r.facility,
          periodFrom: pFrom, periodTo: pTo, validUntil: r.valid_until, expiry, note: r.note, tags: r.tags, category: r.category, categoryName: r.category_name,
          version: r.version, replaced: !!r.replaced_by, archived: !!r.archived_at, archiveReason: r.archive_reason, links: r.links,
          retainUntil: retainUntil(pTo, new Date(r.uploaded_at).toISOString(), years), canEdit: canEdit(req, s, r) && r.kind === 'vault',
          billStatus: r.bill_status,
        };
      });
      const live = visible.filter((d) => !d.archived && !d.replaced);
      const kpis = {
        files: live.length, size: live.reduce((a, d) => a + d.size, 0),
        expiring: live.filter((d) => d.expiry === 'soon').length, expired: live.filter((d) => d.expiry === 'expired').length,
        unlinked: live.filter((d) => d.kind === 'vault' && !d.links && !STANDALONE.has(d.type)).length,
        archived: visible.filter((d) => d.archived).length, retentionYears: years,
      };
      const needle = q.q?.toLowerCase();
      const docs = visible.filter((d) => {
        if (q.view === 'archived' ? !d.archived : q.view !== 'all' && (d.archived || d.replaced)) return false;
        if (q.view === 'expiring' && !(d.expiry === 'soon' || d.expiry === 'expired')) return false;
        if (q.view === 'unlinked' && !(d.kind === 'vault' && !d.links && !STANDALONE.has(d.type))) return false;
        if (q.facilityId && d.facilityId !== q.facilityId) return false;
        if (q.type && d.type !== q.type) return false;
        if (q.category && d.category !== q.category) return false;
        if (q.year) {
          const ym = (x: string | null) => (x ? x.slice(0, 7) : null);
          const from = ym(d.periodFrom) ?? ym(new Date(d.uploadedAt).toISOString())!, to = ym(d.periodTo) ?? from;
          const want = q.month ? `${q.year}-${String(q.month).padStart(2, '0')}` : null;
          if (want ? !(from <= want && want <= to) : !(from.slice(0, 4) <= String(q.year) && String(q.year) <= to.slice(0, 4))) return false;
        }
        if (needle && ![d.filename, d.title, d.note, d.facility, d.typeName, ...(d.tags ?? [])].some((x) => x?.toLowerCase().includes(needle))) return false;
        return true;
      });
      return { docs: docs.slice(0, 1000), total: docs.length, kpis, types: DOC_TYPES, canUploadCompanyWide: ['super_admin', 'admin', 'platform_admin'].includes(req.user.role), canUpload: EDITORS.includes(req.user.role) };
    });
  });

  /** One file: details, the entries it supports, its versions. */
  app.get('/api/vault/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, id);
      if (!canSee(req, s, d)) throw notFound('Document');
      const links = (await c.query(
        `SELECT a.id, a.period_start::text, a.period_end::text, f.name AS facility, a.facility_id, i.name AS item, a.quantity, a.unit, a.status, l.linked_by, l.linked_at,
                EXISTS (SELECT 1 FROM period_lock pl WHERE pl.month BETWEEN date_trunc('month', a.period_start)::date AND date_trunc('month', a.period_end)::date) AS locked
           FROM document_link l JOIN activity a ON a.id = l.activity_id JOIN org_node f ON f.id = a.facility_id JOIN item i ON i.id = a.item_id
          WHERE l.document_id = $1 ORDER BY a.period_start`, [id])).rows;
      // the version chain, oldest first
      const versions = (await c.query(
        `WITH RECURSIVE back AS (SELECT id, replaces_id, 0 AS n FROM document WHERE id = $1 UNION ALL SELECT d.id, d.replaces_id, b.n - 1 FROM document d JOIN back b ON d.id = b.replaces_id),
              fwd AS (SELECT id, replaced_by, 0 AS n FROM document WHERE id = $1 UNION ALL SELECT d.id, d.replaced_by, f.n + 1 FROM document d JOIN fwd f ON d.id = f.replaced_by)
         SELECT d.id, d.version, d.filename, d.uploaded_at, coalesce(u.name, d.uploaded_by) AS uploaded_by, d.size
           FROM (SELECT id, n FROM back UNION SELECT id, n FROM fwd) x JOIN document d ON d.id = x.id LEFT JOIN app_user u ON u.id::text = d.uploaded_by ORDER BY x.n`, [id])).rows;
      return { links: links.map((l) => ({ ...l, canUnlink: !l.locked && (s.enter.has(l.facility_id) || s.approve.has(l.facility_id)) })), versions };
    });
  });

  /** The file itself (inline; ?download=1 to save it). */
  app.get('/api/vault/:id/file', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const dl = (req.query as { download?: string }).download === '1';
    const d = await tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const r = await loadDoc(c, id);
      if (!canSee(req, s, r)) throw notFound('Document');
      const f = (await c.query('SELECT filename, content_type, data FROM document WHERE id = $1', [id])).rows[0];
      await audit(c, req, 'document.view', 'document', id, { download: dl });
      return f;
    });
    // never let a browser run an uploaded file as a page
    return reply.header('Content-Type', d.content_type).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
      .header('Content-Disposition', `${dl || !/^(application\/pdf|image\/)/.test(d.content_type) ? 'attachment' : 'inline'}; filename="${d.filename.replace(/"/g, '')}"`)
      .header('Cache-Control', 'private, max-age=60').send(openFile(d.data));
  });

  /** Upload: body = the file; header x-filename; header x-meta = the details as JSON (URI-encoded), optional linkActivityIds. */
  app.post('/api/vault', { bodyLimit: MAX }, async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, ...(EDITORS as ['super_admin']));
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
    const filename = cleanName(req.headers['x-filename'], 'document');
    const content = fileType(buf, filename);
    let raw: unknown = {};
    try { raw = JSON.parse(decodeURIComponent(String(req.headers['x-meta'] ?? '%7B%7D'))); } catch { throw new AppError('The file details could not be read'); }
    const m = metaSchema.extend({ linkActivityIds: z.array(z.string().uuid()).max(200).optional() }).parse(raw);
    const h = createHash('sha256').update(buf).digest('hex');
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      await checkMeta(c, req, s, m);
      const prior = (await c.query(`SELECT id, kind, filename, archived_at FROM document WHERE sha256 = $1`, [h])).rows[0];
      if (prior && prior.kind !== 'logo' && prior.kind !== 'message') {
        // the same file again: link it where asked, do not store it twice
        if (m.linkActivityIds?.length) {
          const n = await linkEntries(c, req, s, tenant, prior.id, m.linkActivityIds);
          await audit(c, req, 'document.link', 'document', prior.id, { entries: m.linkActivityIds, existing: true });
          return { id: prior.id, duplicate: true, linked: n, message: `This file is already in the vault as "${prior.filename}": linked to the entry instead of stored twice.` };
        }
        throw new AppError(`This file is already in the vault as "${prior.filename}"${prior.archived_at ? ' (archived)' : ''}`, 409, 'DUPLICATE_FILE');
      }
      const id = (await c.query(
        `INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by, doc_type, title, facility_id, period_from, period_to, valid_until, category, note, tags)
         VALUES ($1,'vault',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [tenant, filename, content, buf.length, h, sealFile(buf), req.user.id, m.type, m.title || null, m.facilityId ?? null, m.periodFrom ?? null, m.periodTo ?? null,
          m.validUntil ?? null, m.category || null, m.note || null, m.tags ?? []])).rows[0].id;
      const linked = await linkEntries(c, req, s, tenant, id, m.linkActivityIds ?? []);
      await audit(c, req, 'document.upload', 'document', id, { filename, size: buf.length, type: m.type, facilityId: m.facilityId ?? null, entries: m.linkActivityIds ?? [] });
      return { id, duplicate: false, linked };
    });
  });

  /** Change the details of an uploaded file. */
  app.patch('/api/vault/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const m = metaSchema.parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, id);
      if (d.kind !== 'vault') throw new AppError('Change this file where it was added (Bills, Purchases, Waste contractors or Audit & assurance)');
      if (!canSee(req, s, d) || !canEdit(req, s, d)) throw forbidden('You cannot change this file');
      await checkMeta(c, req, s, m);
      await c.query(`UPDATE document SET doc_type=$2, title=$3, facility_id=$4, period_from=$5, period_to=$6, valid_until=$7, category=$8, note=$9, tags=$10 WHERE id=$1`,
        [id, m.type, m.title || null, m.facilityId ?? null, m.periodFrom ?? null, m.periodTo ?? null, m.validUntil ?? null, m.category || null, m.note || null, m.tags ?? []]);
      await audit(c, req, 'document.edit', 'document', id, m);
      return { ok: true };
    });
  });

  /** A new version of a file: same details and links; the old one is kept, marked replaced. */
  app.post('/api/vault/:id/version', { bodyLimit: MAX }, async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
    const filename = cleanName(req.headers['x-filename'], 'document');
    const content = fileType(buf, filename);
    const h = createHash('sha256').update(buf).digest('hex');
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, id);
      if (d.kind !== 'vault') throw new AppError('Only files uploaded to the vault have versions here');
      if (!canSee(req, s, d) || !canEdit(req, s, d)) throw forbidden('You cannot change this file');
      const old = (await c.query('SELECT * FROM document WHERE id = $1', [id])).rows[0];
      if (old.replaced_by) throw new AppError('A newer version exists: add the new version to that one');
      if ((await c.query('SELECT 1 FROM document WHERE sha256 = $1', [h])).rowCount) throw new AppError('This exact file is already in the vault', 409, 'DUPLICATE_FILE');
      const nid = (await c.query(
        `INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by, doc_type, title, facility_id, period_from, period_to, valid_until, category, note, tags, version, replaces_id)
         VALUES ($1,'vault',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [tenant, filename, content, buf.length, h, sealFile(buf), req.user.id, old.doc_type, old.title, old.facility_id, old.period_from, old.period_to, old.valid_until, old.category, old.note, old.tags, old.version + 1, id])).rows[0].id;
      await c.query('UPDATE document SET replaced_by = $2 WHERE id = $1', [id, nid]);
      await c.query(`INSERT INTO document_link (tenant_id, document_id, activity_id, linked_by) SELECT tenant_id, $2, activity_id, $3 FROM document_link WHERE document_id = $1`, [id, nid, req.user.name]);
      await audit(c, req, 'document.version', 'document', nid, { replaces: id, filename, version: old.version + 1 });
      return { id: nid, version: old.version + 1 };
    });
  });

  /** Link a file to entries. */
  app.post('/api/vault/:id/links', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ activityIds: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, id);
      if (!canSee(req, s, d) || !EDITORS.includes(req.user.role)) throw forbidden('You cannot link this file');
      if (d.archived_at) throw new AppError('Restore the file before linking it');
      const n = await linkEntries(c, req, s, tenant, id, b.activityIds);
      await audit(c, req, 'document.link', 'document', id, { entries: b.activityIds });
      return { linked: n };
    });
  });
  app.delete('/api/vault/:id/links/:activityId', async (req) => {
    const tenant = requireTenant(req);
    const p = z.object({ id: z.string().uuid(), activityId: z.string().uuid() }).parse(req.params);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, p.id);
      const a = (await c.query('SELECT facility_id FROM activity WHERE id = $1', [p.activityId])).rows[0];
      if (!a || !canSee(req, s, d)) throw notFound('Link');
      if (!(s.enter.has(a.facility_id) || s.approve.has(a.facility_id))) throw forbidden('You cannot change the evidence of that entry');
      await c.query('DELETE FROM document_link WHERE document_id = $1 AND activity_id = $2', [p.id, p.activityId]);
      await audit(c, req, 'document.unlink', 'document', p.id, { entry: p.activityId });
      return { ok: true };
    });
  });

  /** Archive (hidden, kept) with a reason; restore. A file still supporting an approved entry cannot be archived. */
  app.post('/api/vault/:id/archive', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    const b = z.object({ reason: z.string().trim().min(3, 'Say why the file is archived').max(300) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, id);
      if (d.kind !== 'vault') throw new AppError('Remove this file where it was added (Bills, Purchases, Waste contractors or Audit & assurance)');
      if (!canSee(req, s, d) || !canEdit(req, s, d)) throw forbidden('You cannot archive this file');
      const approved = (await c.query(`SELECT count(*)::int AS n FROM document_link l JOIN activity a ON a.id = l.activity_id WHERE l.document_id = $1 AND a.status = 'approved'`, [id])).rows[0].n;
      if (approved) throw new AppError(`This file supports ${approved} approved entr${approved === 1 ? 'y' : 'ies'}: it stays as evidence. Add a new version if it was wrong.`);
      await c.query('UPDATE document SET archived_at = now(), archived_by = $2, archive_reason = $3 WHERE id = $1', [id, req.user.name, b.reason]);
      await audit(c, req, 'document.archive', 'document', id, { reason: b.reason });
      return { ok: true };
    });
  });
  app.post('/api/vault/:id/restore', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const d = await loadDoc(c, id);
      if (!canSee(req, s, d) || !canEdit(req, s, d)) throw forbidden('You cannot restore this file');
      await c.query('UPDATE document SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE id = $1', [id]);
      await audit(c, req, 'document.restore', 'document', id);
      return { ok: true };
    });
  });

  /** Delete for good: super admin, an archived upload past its retention date that supports no entry. */
  app.delete('/api/vault/:id', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const d = (await c.query(`SELECT d.kind, d.filename, d.archived_at, d.period_to::text, d.uploaded_at, t.doc_retention_years AS years,
                                       (SELECT count(*)::int FROM document_link WHERE document_id = d.id) AS links
                                  FROM document d JOIN tenant t ON t.id = d.tenant_id WHERE d.id = $1`, [id])).rows[0];
      if (!d || d.kind !== 'vault') throw notFound('Document');
      if (!d.archived_at) throw new AppError('Archive the file first');
      if (d.links) throw new AppError('The file still supports entries');
      const until = retainUntil(d.period_to, new Date(d.uploaded_at).toISOString(), d.years);
      if (until > new Date().toISOString().slice(0, 10)) throw new AppError(`Kept until ${until} (retention period of ${d.years} years)`);
      await c.query('UPDATE document SET replaced_by = NULL WHERE replaced_by = $1', [id]);
      await c.query('UPDATE document SET replaces_id = NULL WHERE replaces_id = $1', [id]);
      await c.query('DELETE FROM document WHERE id = $1', [id]);
      await audit(c, req, 'document.delete', 'document', id, { filename: d.filename });
      return { ok: true };
    });
  });

  /** Retention period (super admin). */
  app.put('/api/vault/settings', async (req) => {
    const tenant = requireTenant(req);
    requireRole(req, 'super_admin');
    const b = z.object({ retentionYears: z.number().int().min(1).max(30) }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await c.query('UPDATE tenant SET doc_retention_years = $2 WHERE id = $1', [tenant, b.retentionYears]);
      await audit(c, req, 'document.retention', 'tenant', tenant, b);
      return { ok: true };
    });
  });

  /** Evidence of one entry: files linked to it, the bills of its meter for its period, contractor scans. */
  app.get('/api/activities/:id/evidence', async (req) => {
    const tenant = requireTenant(req);
    const id = z.string().uuid().parse((req.params as { id: string }).id);
    return tenantTx(tenant, async (c) => {
      const s = await scopeOf(c, req.user);
      const a = (await c.query(`SELECT a.id, a.facility_id, a.meter_id, a.period_start::text, a.period_end::text, a.status,
                                       EXISTS (SELECT 1 FROM period_lock pl WHERE pl.month BETWEEN date_trunc('month', a.period_start)::date AND date_trunc('month', a.period_end)::date) AS locked
                                  FROM activity a WHERE a.id = $1`, [id])).rows[0];
      if (!a || !s.see.has(a.facility_id)) throw notFound('Entry');
      const files = (await c.query(
        `SELECT d.id, d.filename, d.content_type, d.size, ${TYPE_SQL} AS type, d.title, d.uploaded_at, coalesce(u.name, d.uploaded_by) AS uploaded_by, 'linked' AS how, l.linked_by
           FROM document_link l JOIN document d ON d.id = l.document_id LEFT JOIN app_user u ON u.id::text = d.uploaded_by WHERE l.activity_id = $1
         UNION ALL
         SELECT d.id, d.filename, d.content_type, d.size, ${TYPE_SQL}, d.title, d.uploaded_at, coalesce(u.name, d.uploaded_by), 'meter bill', NULL
           FROM bill b JOIN document d ON d.id = b.document_id LEFT JOIN app_user u ON u.id::text = d.uploaded_by
          WHERE $2::uuid IS NOT NULL AND b.meter_id = $2 AND b.status = 'confirmed' AND b.period_from <= $4::date AND b.period_to >= $3::date
         UNION ALL
         SELECT DISTINCT d.id, d.filename, d.content_type, d.size, ${TYPE_SQL}, d.title, d.uploaded_at, d.uploaded_by, 'collection scan', NULL
           FROM waste_scan ws JOIN document d ON d.id = ws.document_id WHERE ws.activity_id = $1`,
        [id, a.meter_id, a.period_start, a.period_end])).rows;
      const seen = new Set<string>();
      const can = s.enter.has(a.facility_id) || s.approve.has(a.facility_id);
      return {
        files: files.filter((f) => !seen.has(f.id) && seen.add(f.id)).map((f) => ({ ...f, typeName: DOC_TYPES[f.type as DocType] ?? f.type, canUnlink: f.how === 'linked' && can && !a.locked })),
        canAdd: can && EDITORS.includes(req.user.role), locked: a.locked, facilityId: a.facility_id, periodStart: a.period_start, periodEnd: a.period_end,
      };
    });
  });
}
