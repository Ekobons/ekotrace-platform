/**
 * EKOTRACE SME proof documents: files attached to a page (module) or one item on it, per financial year.
 *
 *   GET    /api/sme/files?fy=&module=&key=   list (no content); module optional = every file of the year
 *   POST   /api/sme/files?fy=&module=&key=   upload (raw body, header x-filename); PDF, image, Word, Excel; ≤ 10 MB
 *   GET    /api/sme/files/:id                download
 *   DELETE /api/sme/files/:id                remove (data entry and above)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { tenantTx } from '../db/pool.js';
import { audit, requireRole, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { needProduct } from '../lib/products.js';
import { fyOf, isFy } from '../lib/sme/company.js';

const MAX = 10 * 1024 * 1024;
const fyParam = (req: FastifyRequest) => {
  const fy = (req.query as { fy?: string }).fy ?? fyOf();
  if (!isFy(fy)) throw new AppError('Choose a financial year like "FY 2025-26"');
  return fy;
};
const modParam = (v: unknown, need: boolean) => {
  if (v === undefined || v === '') { if (need) throw new AppError('Say which page the file belongs to.'); return null; }
  if (typeof v !== 'string' || !/^[a-z_]{2,20}$/.test(v)) throw new AppError('Unknown page.');
  return v;
};
const keyParam = (v: unknown) => {
  if (v === undefined || v === '') return '';
  if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,60}$/.test(v)) throw new AppError('Unknown item.');
  return v;
};
/** The type from the file's first bytes (never from its name). */
function sniff(b: Buffer): string | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString('latin1') === 'PK\u0003\u0004') return 'application/zip'; // .docx / .xlsx; refined by name below
  return null;
}
const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function smeFilesRoutes(app: FastifyInstance) {
  needProduct(app, 'sme');

  app.get('/api/sme/files', async (req) => {
    const t = requireTenant(req), fy = fyParam(req), q = req.query as Record<string, unknown>;
    const mod = modParam(q.module, false), key = q.key === undefined ? null : keyParam(q.key);
    return tenantTx(t, async (c) => ({
      files: (await c.query(`SELECT id, module, item_key, name, mime, size, uploaded_name, created_at FROM sme_file
        WHERE tenant_id = $1 AND fy = $2 AND ($3::text IS NULL OR module = $3) AND ($4::text IS NULL OR item_key = $4) ORDER BY created_at DESC`, [t, fy, mod, key])).rows,
    }));
  });

  app.post('/api/sme/files', { bodyLimit: MAX + 1024 }, async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const t = requireTenant(req), fy = fyParam(req), q = req.query as Record<string, unknown>;
    const mod = modParam(q.module, true)!, key = keyParam(q.key);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new AppError('Choose a file to upload.');
    if (buf.length > MAX) throw new AppError('Files can be at most 10 MB.', 413, 'TOO_LARGE');
    let name = 'document';
    try { name = decodeURIComponent(String(req.headers['x-filename'] ?? 'document')); } catch { /* keep the default */ }
    name = name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'document';
    let mime = sniff(buf);
    if (mime === 'application/zip') mime = OFFICE[name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
    if (!mime) throw new AppError('Upload a PDF, a photo (JPG or PNG), or a Word or Excel file.', 415, 'UNSUPPORTED');
    return tenantTx(t, async (c) => {
      const n = Number((await c.query(`SELECT count(*) FROM sme_file WHERE tenant_id = $1`, [t])).rows[0].count);
      if (n >= 500) throw new AppError('This company has 500 files already. Remove some first.', 409, 'LIMIT');
      const r = (await c.query(`INSERT INTO sme_file (tenant_id, fy, module, item_key, name, mime, size, sha256, data, uploaded_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at`,
        [t, fy, mod, key, name, mime, buf.length, createHash('sha256').update(buf).digest('hex'), buf, req.user.name])).rows[0];
      await audit(c, req, 'sme.file.upload', 'sme_file', r.id, { fy, module: mod, key, name, size: buf.length });
      return { id: r.id, name, mime, size: buf.length, created_at: r.created_at };
    });
  });

  app.get('/api/sme/files/:id', async (req, reply) => {
    const t = requireTenant(req), id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('File');
    const f = await tenantTx(t, async (c) => (await c.query(`SELECT name, mime, data FROM sme_file WHERE id = $1 AND tenant_id = $2`, [id, t])).rows[0]);
    if (!f) throw notFound('File');
    reply.header('content-type', f.mime);
    reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(f.data);
  });

  app.delete('/api/sme/files/:id', async (req) => {
    requireRole(req, 'super_admin', 'admin', 'manager', 'preparer');
    const t = requireTenant(req), id = (req.params as { id: string }).id;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('File');
    return tenantTx(t, async (c) => {
      const r = (await c.query(`DELETE FROM sme_file WHERE id = $1 AND tenant_id = $2 RETURNING name, module, item_key`, [id, t])).rows[0];
      if (!r) throw notFound('File');
      await audit(c, req, 'sme.file.delete', 'sme_file', id, r);
      return { ok: true };
    });
  });
}
