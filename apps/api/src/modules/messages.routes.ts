/**
 * Message centre (Help): conversations between a company's people and the Ekotrace team, and
 * announcements from the team.
 *
 *   Company side   anyone signed in starts a conversation (topic, subject, the part of Ekotrace it is about,
 *                  message, optional screenshot or file). They see their own conversations; the super admin
 *                  sees every conversation of the company (unread counts only their own). Status: waiting for the team → answered → closed
 *                  (a reply reopens it). Unread replies show as a count on the menu.
 *   Team side      the platform admin's inbox: every company's conversations, unread first; reply, close.
 *   Announcements  posted by the platform admin to every company or to the ones chosen (new factors, features,
 *                  maintenance, regulation); each person marks them read.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { platformTx, tenantTx, type Tx } from '../db/pool.js';
import { audit, requirePlatformAdmin, requireTenant } from '../lib/auth.js';
import { AppError, notFound } from '../lib/errors.js';
import { cleanName, fileType } from './vault.routes.js';

export const TOPICS = { question: 'Question', data_help: 'Help entering data', problem: 'Something is not working', feature: 'Idea or feature request', factors: 'Emission factors & methods', billing: 'Subscription & billing' } as const;
const topic = z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]);
const KINDS = ['news', 'feature', 'factors', 'maintenance', 'regulation'] as const;
const body = z.string().trim().min(2, 'Write a message').max(5000);
const idP = (req: FastifyRequest) => z.string().uuid().parse((req.params as { id: string }).id);

const THREAD_COLS = `t.id, t.topic, t.subject, t.page, t.status, t.created_at, t.last_company_at, t.last_team_at, t.closed_at, t.created_by,
  u.name AS by_name, u.email AS by_email, u.role AS by_role, greatest(t.last_company_at, coalesce(t.last_team_at, t.last_company_at)) AS last_at,
  (SELECT m.body FROM message m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
  (SELECT count(*)::int FROM message m WHERE m.thread_id = t.id) AS n`;

/** Threads this person may open: their own; the super admin's company-wide. */
const mineSql = (req: FastifyRequest) => (req.user.role === 'super_admin' ? '$1::uuid IS NOT NULL' : 't.created_by = $1');

async function threadFor(c: Tx, req: FastifyRequest, id: string) {
  const t = (await c.query(`SELECT ${THREAD_COLS} FROM message_thread t JOIN app_user u ON u.id = t.created_by WHERE t.id = $2 AND (${mineSql(req)})`, [req.user.id, id])).rows[0];
  if (!t) throw notFound('Conversation');
  return t;
}
async function messagesOf(c: Tx, id: string) {
  return (await c.query(
    `SELECT m.id, m.author_name, m.author_id, m.from_team, m.body, m.created_at, m.document_id, d.filename, d.content_type, d.size
       FROM message m LEFT JOIN document d ON d.id = m.document_id WHERE m.thread_id = $1 ORDER BY m.created_at`, [id])).rows;
}
async function storeAttachment(c: Tx, tenant: string, req: FastifyRequest) {
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || !buf.length) throw new AppError('Send the file');
  const filename = cleanName(req.headers['x-filename'], 'attachment');
  const type = fileType(buf, filename, ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'xlsx', 'csv', 'docx', 'txt']);
  const h = createHash('sha256').update(buf).digest('hex');
  const prior = (await c.query(`SELECT id, kind FROM document WHERE sha256 = $1`, [h])).rows[0];
  if (prior) return { documentId: prior.id as string, filename };
  const id = (await c.query(`INSERT INTO document (tenant_id, kind, filename, content_type, size, sha256, data, uploaded_by) VALUES ($1,'message',$2,$3,$4,$5,$6,$7) RETURNING id`,
    [tenant, filename, type, buf.length, h, buf, req.user.id])).rows[0].id as string;
  return { documentId: id, filename };
}
const sendFile = (reply: import('fastify').FastifyReply, d: { filename: string; content_type: string; data: Buffer }) =>
  reply.header('Content-Type', d.content_type).header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Content-Disposition', `${/^(application\/pdf|image\/)/.test(d.content_type) ? 'inline' : 'attachment'}; filename="${d.filename.replace(/"/g, '')}"`).send(d.data);

/** Announcements this person should see (their company, not withdrawn, not expired). */
async function announcementsFor(c: Tx, tenant: string, userId: string) {
  return (await c.query(
    `SELECT a.id, a.kind, a.title, a.body, a.published_at, a.published_by, a.expires_at, r.read_at IS NOT NULL AS read
       FROM announcement a LEFT JOIN announcement_read r ON r.announcement_id = a.id AND r.user_id = $2
      WHERE a.withdrawn_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now()) AND (a.tenant_ids IS NULL OR $1 = ANY(a.tenant_ids))
      ORDER BY a.published_at DESC LIMIT 100`, [tenant, userId])).rows;
}

export async function messageRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ company side --
  /** Unread replies and announcements: the count on the menu. */
  app.get('/api/messages/counts', async (req) => {
    if (req.user.role === 'platform_admin') {
      const n = await platformTx(async (c) => (await c.query(`SELECT count(*)::int AS n FROM message_thread WHERE status <> 'closed' AND last_company_at > coalesce(team_read_at, 'epoch')`)).rows[0].n);
      return { unread: n, announcements: 0, team: true };
    }
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const unread = (await c.query(
        `SELECT count(*)::int AS n FROM message_thread t LEFT JOIN message_read r ON r.thread_id = t.id AND r.user_id = $1
          WHERE t.created_by = $1 AND t.last_team_at IS NOT NULL AND t.last_team_at > coalesce(r.read_at, 'epoch')`, [req.user.id])).rows[0].n;
      const ann = (await announcementsFor(c, tenant, req.user.id)).filter((a) => !a.read).length;
      return { unread, announcements: ann, team: false };
    });
  });

  app.get('/api/messages', async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, async (c) => {
      const threads = (await c.query(
        `SELECT ${THREAD_COLS}, (t.created_by = $1 AND t.last_team_at IS NOT NULL AND t.last_team_at > coalesce(r.read_at, 'epoch')) AS unread
           FROM message_thread t JOIN app_user u ON u.id = t.created_by LEFT JOIN message_read r ON r.thread_id = t.id AND r.user_id = $1
          WHERE ${mineSql(req)} ORDER BY last_at DESC LIMIT 300`, [req.user.id])).rows;
      return { threads, announcements: await announcementsFor(c, tenant, req.user.id), topics: TOPICS, companyWide: req.user.role === 'super_admin' };
    });
  });

  app.get('/api/messages/:id', async (req) => {
    const tenant = requireTenant(req);
    const id = idP(req);
    return tenantTx(tenant, async (c) => {
      const thread = await threadFor(c, req, id);
      const messages = await messagesOf(c, id);
      await c.query(`INSERT INTO message_read (tenant_id, thread_id, user_id) VALUES ($1,$2,$3) ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = now()`, [tenant, id, req.user.id]);
      return { thread, messages };
    });
  });

  /** A screenshot or file for a message (PNG, JPEG, WEBP, PDF, XLSX, CSV, DOCX, TXT; up to 10 MB). */
  app.post('/api/messages/attachments', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const tenant = requireTenant(req);
    return tenantTx(tenant, (c) => storeAttachment(c, tenant, req));
  });
  app.get('/api/messages/attachments/:id', async (req, reply) => {
    const tenant = requireTenant(req);
    const id = idP(req);
    const d = await tenantTx(tenant, async (c) => (await c.query(
      `SELECT d.filename, d.content_type, d.data FROM document d WHERE d.id = $2 AND EXISTS (
         SELECT 1 FROM message m JOIN message_thread t ON t.id = m.thread_id WHERE m.document_id = d.id AND (${mineSql(req)}))`, [req.user.id, id])).rows[0]);
    if (!d) throw notFound('Attachment');
    return sendFile(reply, d);
  });

  const attachOk = async (c: Tx, documentId?: string) => {
    if (documentId && !(await c.query(`SELECT 1 FROM document WHERE id = $1 AND kind = 'message'`, [documentId])).rowCount) throw notFound('Attachment');
  };

  app.post('/api/messages', async (req) => {
    const tenant = requireTenant(req);
    if (req.user.role === 'platform_admin') throw new AppError('Reply to companies from the team inbox');
    const b = z.object({ topic, subject: z.string().trim().min(3, 'Give a subject').max(160), page: z.string().trim().max(60).optional(), body, documentId: z.string().uuid().optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await attachOk(c, b.documentId);
      const recent = (await c.query(`SELECT count(*)::int AS n FROM message_thread WHERE created_by = $1 AND created_at > now() - interval '1 hour'`, [req.user.id])).rows[0].n;
      if (recent >= 20) throw new AppError('Too many new conversations in the last hour: add to an open one instead', 429);
      const id = (await c.query(`INSERT INTO message_thread (tenant_id, created_by, topic, subject, page) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenant, req.user.id, b.topic, b.subject, b.page || null])).rows[0].id;
      await c.query(`INSERT INTO message (tenant_id, thread_id, author_id, author_name, body, document_id) VALUES ($1,$2,$3,$4,$5,$6)`, [tenant, id, req.user.id, req.user.name, b.body, b.documentId ?? null]);
      await c.query(`INSERT INTO message_read (tenant_id, thread_id, user_id) VALUES ($1,$2,$3)`, [tenant, id, req.user.id]);
      await audit(c, req, 'message.new', 'message_thread', id, { topic: b.topic, subject: b.subject });
      return { id };
    });
  });

  app.post('/api/messages/:id/reply', async (req) => {
    const tenant = requireTenant(req);
    const id = idP(req);
    const b = z.object({ body, documentId: z.string().uuid().optional() }).parse(req.body);
    return tenantTx(tenant, async (c) => {
      await threadFor(c, req, id);
      await attachOk(c, b.documentId);
      await c.query(`INSERT INTO message (tenant_id, thread_id, author_id, author_name, body, document_id) VALUES ($1,$2,$3,$4,$5,$6)`, [tenant, id, req.user.id, req.user.name, b.body, b.documentId ?? null]);
      await c.query(`UPDATE message_thread SET status = 'open', last_company_at = now(), closed_at = NULL, closed_by = NULL WHERE id = $1`, [id]);
      await c.query(`INSERT INTO message_read (tenant_id, thread_id, user_id) VALUES ($1,$2,$3) ON CONFLICT (thread_id, user_id) DO UPDATE SET read_at = now()`, [tenant, id, req.user.id]);
      return { ok: true };
    });
  });

  app.post('/api/messages/:id/close', async (req) => {
    const tenant = requireTenant(req);
    const id = idP(req);
    return tenantTx(tenant, async (c) => {
      await threadFor(c, req, id);
      await c.query(`UPDATE message_thread SET status = 'closed', closed_at = now(), closed_by = $2 WHERE id = $1`, [id, req.user.name]);
      return { ok: true };
    });
  });

  app.post('/api/announcements/:id/read', async (req) => {
    requireTenant(req);
    const id = idP(req);
    await platformTx((c) => c.query(`INSERT INTO announcement_read (announcement_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, req.user.id]));
    return { ok: true };
  });
  app.post('/api/announcements/read-all', async (req) => {
    const tenant = requireTenant(req);
    await tenantTx(tenant, async (c) => {
      const ids = (await announcementsFor(c, tenant, req.user.id)).filter((a) => !a.read).map((a) => a.id);
      if (ids.length) await c.query(`INSERT INTO announcement_read (announcement_id, user_id) SELECT x, $2 FROM unnest($1::uuid[]) x ON CONFLICT DO NOTHING`, [ids, req.user.id]);
    });
    return { ok: true };
  });

  // --------------------------------------------------------------------- team side --
  app.get('/api/team/messages', async (req) => {
    requirePlatformAdmin(req);
    const q = z.object({ status: z.enum(['waiting', 'answered', 'closed', 'all']).default('waiting') }).parse(req.query);
    return platformTx(async (c) => {
      const where = q.status === 'all' ? 'true' : q.status === 'waiting' ? `t.status = 'open'` : `t.status = '${q.status}'`;
      const threads = (await c.query(
        `SELECT ${THREAD_COLS}, tn.name AS company, tn.id AS tenant_id, t.last_company_at > coalesce(t.team_read_at, 'epoch') AS unread
           FROM message_thread t JOIN app_user u ON u.id = t.created_by JOIN tenant tn ON tn.id = t.tenant_id
          WHERE ${where} ORDER BY (t.status = 'open') DESC, last_at DESC LIMIT 500`)).rows;
      const counts = (await c.query(`SELECT count(*) FILTER (WHERE status = 'open')::int AS waiting, count(*) FILTER (WHERE status = 'answered')::int AS answered, count(*) FILTER (WHERE status = 'closed')::int AS closed, count(*)::int AS "all" FROM message_thread`)).rows[0];
      return { threads, counts, topics: TOPICS };
    });
  });
  app.get('/api/team/messages/:id', async (req) => {
    requirePlatformAdmin(req);
    const id = idP(req);
    return platformTx(async (c) => {
      const thread = (await c.query(`SELECT ${THREAD_COLS}, tn.name AS company, tn.id AS tenant_id, tn.plan FROM message_thread t JOIN app_user u ON u.id = t.created_by JOIN tenant tn ON tn.id = t.tenant_id WHERE t.id = $1`, [id])).rows[0];
      if (!thread) throw notFound('Conversation');
      await c.query('UPDATE message_thread SET team_read_at = now() WHERE id = $1', [id]);
      return { thread, messages: await messagesOf(c, id) };
    });
  });
  app.get('/api/team/messages/attachments/:id', async (req, reply) => {
    requirePlatformAdmin(req);
    const id = idP(req);
    const d = await platformTx(async (c) => (await c.query(`SELECT filename, content_type, data FROM document WHERE id = $1 AND kind = 'message'`, [id])).rows[0]);
    if (!d) throw notFound('Attachment');
    return sendFile(reply, d);
  });
  app.post('/api/team/messages/:id/reply', async (req) => {
    requirePlatformAdmin(req);
    const id = idP(req);
    const b = z.object({ body, close: z.boolean().default(false) }).parse(req.body);
    return platformTx(async (c) => {
      const t = (await c.query('SELECT tenant_id FROM message_thread WHERE id = $1', [id])).rows[0];
      if (!t) throw notFound('Conversation');
      await c.query(`INSERT INTO message (tenant_id, thread_id, author_id, author_name, from_team, body) VALUES ($1,$2,$3,$4,true,$5)`, [t.tenant_id, id, req.user.id, req.user.name, b.body]);
      await c.query(`UPDATE message_thread SET status = $2, last_team_at = now(), team_read_at = now(), closed_at = CASE WHEN $2 = 'closed' THEN now() END, closed_by = CASE WHEN $2 = 'closed' THEN $3 END WHERE id = $1`,
        [id, b.close ? 'closed' : 'answered', req.user.name]);
      return { ok: true };
    });
  });
  app.post('/api/team/messages/:id/status', async (req) => {
    requirePlatformAdmin(req);
    const id = idP(req);
    const b = z.object({ status: z.enum(['open', 'answered', 'closed']) }).parse(req.body);
    await platformTx((c) => c.query(`UPDATE message_thread SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() END, closed_by = CASE WHEN $2 = 'closed' THEN $3 END WHERE id = $1`, [id, b.status, req.user.name]));
    return { ok: true };
  });

  app.get('/api/team/announcements', async (req) => {
    requirePlatformAdmin(req);
    return platformTx(async (c) => ({
      announcements: (await c.query(
        `SELECT a.*, (SELECT count(*)::int FROM announcement_read r WHERE r.announcement_id = a.id) AS reads,
                (SELECT array_agg(name ORDER BY name) FROM tenant WHERE id = ANY(a.tenant_ids)) AS companies
           FROM announcement a ORDER BY a.published_at DESC LIMIT 200`)).rows,
    }));
  });
  app.post('/api/team/announcements', async (req) => {
    requirePlatformAdmin(req);
    const b = z.object({ kind: z.enum(KINDS), title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(5000),
      tenantIds: z.array(z.string().uuid()).max(500).optional(), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
    return platformTx(async (c) => {
      if (b.tenantIds?.length && (await c.query('SELECT count(*)::int AS n FROM tenant WHERE id = ANY($1)', [b.tenantIds])).rows[0].n !== new Set(b.tenantIds).size) throw notFound('Company');
      const id = (await c.query(`INSERT INTO announcement (kind, title, body, tenant_ids, published_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [b.kind, b.title, b.body, b.tenantIds?.length ? b.tenantIds : null, req.user.name, b.expiresAt ? `${b.expiresAt}T23:59:59Z` : null])).rows[0].id;
      await audit(c, req, 'announcement.publish', 'announcement', id, { title: b.title, companies: b.tenantIds?.length ?? 'all' });
      return { id };
    });
  });
  app.post('/api/team/announcements/:id/withdraw', async (req) => {
    requirePlatformAdmin(req);
    const id = idP(req);
    await platformTx(async (c) => { await c.query('UPDATE announcement SET withdrawn_at = now() WHERE id = $1 AND withdrawn_at IS NULL', [id]); await audit(c, req, 'announcement.withdraw', 'announcement', id); });
    return { ok: true };
  });
}
