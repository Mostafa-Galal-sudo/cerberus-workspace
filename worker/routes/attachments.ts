import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { audit } from '../services/audit';
import { workspaceEventStatements } from '../services/events';
import type { AuthUser, Env, Variables } from '../types';

const MAX_BYTES = 10 * 1024 * 1024;
const SAFE_RESOURCE_TYPES = new Set(['task', 'checkpoint', 'submission', 'bug', 'blocker', 'experiment', 'wiki']);

export const attachmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
attachmentRoutes.use('*', requireAuth, requirePasswordChanged);

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'evidence.bin').slice(-140);
}

function asciiFilename(name: string): string {
  return sanitizeFilename(name).replace(/["\\\r\n]/g, '_');
}

async function canView(db: D1Database, user: AuthUser, resourceType: string, resourceId: string): Promise<boolean> {
  if (resourceType !== 'submission') return true;
  const row = await db.prepare(`SELECT submitted_by FROM submissions WHERE id=?`).bind(resourceId).first<{ submitted_by: string }>();
  return Boolean(row) && (row!.submitted_by === user.id || user.permissions.includes('review.admin') || user.permissions.includes('workspace.admin'));
}

async function canAttach(db: D1Database, user: AuthUser, resourceType: string, resourceId: string): Promise<boolean> {
  if (user.roles.includes('project_supervisor')) return false;

  if (resourceType === 'task') {
    const row = await db.prepare(`SELECT assignee_id FROM tasks WHERE id=? AND archived_at IS NULL`).bind(resourceId).first<{ assignee_id: string | null }>();
    return Boolean(row) && (row!.assignee_id === user.id || user.permissions.includes('task.manage'));
  }
  if (resourceType === 'checkpoint') {
    const row = await db.prepare(`SELECT owner_id FROM checkpoints WHERE id=? AND archived_at IS NULL`).bind(resourceId).first<{ owner_id: string | null }>();
    return Boolean(row) && (row!.owner_id === user.id || user.permissions.includes('workspace.admin'));
  }
  if (resourceType === 'submission') {
    const row = await db.prepare(`SELECT submitted_by FROM submissions WHERE id=?`).bind(resourceId).first<{ submitted_by: string }>();
    return Boolean(row) && (row!.submitted_by === user.id || user.permissions.includes('review.admin'));
  }
  if (resourceType === 'bug' || resourceType === 'blocker') {
    const table = resourceType === 'bug' ? 'bugs' : 'blockers';
    const row = await db.prepare(`SELECT reporter_id, assignee_id FROM ${table} WHERE id=?`).bind(resourceId).first<{ reporter_id: string; assignee_id: string | null }>();
    return Boolean(row) && (row!.reporter_id === user.id || row!.assignee_id === user.id || user.permissions.includes('workspace.admin'));
  }
  if (resourceType === 'experiment') {
    const row = await db.prepare(`SELECT owner_id FROM experiments WHERE id=? AND archived_at IS NULL`).bind(resourceId).first<{ owner_id: string }>();
    return Boolean(row) && (row!.owner_id === user.id || user.permissions.includes('workspace.admin'));
  }
  if (resourceType === 'wiki') {
    const row = await db.prepare(`SELECT id FROM wiki_pages WHERE id=? AND archived_at IS NULL`).bind(resourceId).first();
    return Boolean(row);
  }
  return false;
}

attachmentRoutes.get('/', async (context) => {
  const resourceType = context.req.query('resourceType') ?? '';
  const resourceId = context.req.query('resourceId') ?? '';
  if (!SAFE_RESOURCE_TYPES.has(resourceType) || !resourceId) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'resourceType and resourceId are required' } }, 422);
  }
  if (!await canView(context.env.DB, context.get('user'), resourceType, resourceId)) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You cannot view evidence for that record' } }, 403);
  }

  const rows = await context.env.DB.prepare(`SELECT a.id, a.label, a.filename, a.storage_type AS storageType, a.mime_type AS mimeType,
      a.byte_size AS byteSize, a.checksum_sha256 AS checksumSha256, a.created_at AS createdAt,
      a.owner_id AS ownerId, u.display_name AS ownerName, a.url
    FROM attachments a JOIN users u ON u.id=a.owner_id
    WHERE a.resource_type=? AND a.resource_id=? AND a.archived_at IS NULL
    ORDER BY a.created_at DESC`).bind(resourceType, resourceId).all();

  return context.json({ ok: true, data: rows.results });
});

attachmentRoutes.post('/', async (context) => {
  if (!context.env.ATTACHMENTS) {
    return context.json({ ok: false, error: { code: 'ATTACHMENTS_UNAVAILABLE', message: 'Object storage is not configured for this deployment' } }, 503);
  }

  let form: FormData;
  try {
    form = await context.req.formData();
  } catch {
    return context.json({ ok: false, error: { code: 'INVALID_UPLOAD', message: 'Expected a multipart form upload' } }, 400);
  }

  const file = form.get('file');
  const resourceType = String(form.get('resourceType') ?? '');
  const resourceId = String(form.get('resourceId') ?? '');
  const label = String(form.get('label') ?? '').trim().slice(0, 180);

  if (!(file instanceof File) || file.size === 0) {
    return context.json({ ok: false, error: { code: 'FILE_REQUIRED', message: 'Choose a non-empty file to upload' } }, 422);
  }
  if (file.size > MAX_BYTES) {
    return context.json({ ok: false, error: { code: 'FILE_TOO_LARGE', message: 'Evidence files must be 10 MB or smaller' } }, 413);
  }
  if (!SAFE_RESOURCE_TYPES.has(resourceType) || !resourceId) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Attach evidence to a supported workspace record' } }, 422);
  }
  if (!await canAttach(context.env.DB, context.get('user'), resourceType, resourceId)) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You cannot attach evidence to that record' } }, 403);
  }

  const id = crypto.randomUUID();
  const filename = sanitizeFilename(file.name);
  const key = `attachments/${resourceType}/${resourceId}/${id}-${filename}`;
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const mimeType = file.type || 'application/octet-stream';

  await context.env.ATTACHMENTS.put(key, bytes, {
    httpMetadata: { contentType: mimeType, contentDisposition: `attachment; filename="${asciiFilename(filename)}"` },
    customMetadata: { ownerId: context.get('user').id, resourceType, resourceId, sha256: checksum },
  });

  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`INSERT INTO attachments
      (id, owner_id, resource_type, resource_id, storage_type, label, filename, url, public_id, mime_type, byte_size, checksum_sha256)
      VALUES (?, ?, ?, ?, 'r2', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, context.get('user').id, resourceType, resourceId, label || filename, filename, `/api/v1/attachments/${id}/download`, key, mimeType, file.size, checksum),
    audit(context.env, context.get('user').id, 'attachment.created', 'attachment', id, { resourceType, resourceId, byteSize: file.size, checksum }),
  ];

  if (resourceType === 'task') {
    const task = await context.env.DB.prepare(`SELECT assignee_id FROM tasks WHERE id=?`).bind(resourceId).first<{ assignee_id: string | null }>();
    const admins = await context.env.DB.prepare(`SELECT user_id FROM user_roles WHERE role_id='role_admin'`).all<{ user_id: string }>();
    statements.push(...workspaceEventStatements(context.env, {
      type: 'attachment.created',
      userIds: [task?.assignee_id, ...admins.results.map((row) => row.user_id)],
      payload: { attachmentId: id, resourceType, resourceId, label: label || filename },
    }));
  }

  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { id, url: `/api/v1/attachments/${id}/download`, checksumSha256: checksum, byteSize: file.size } }, 201);
});

attachmentRoutes.get('/:id/download', async (context) => {
  const row = await context.env.DB.prepare(`SELECT id, storage_type AS storageType, url, public_id AS publicId, label, filename,
      mime_type AS mimeType, checksum_sha256 AS checksumSha256, resource_type AS resourceType, resource_id AS resourceId
    FROM attachments WHERE id=? AND archived_at IS NULL`).bind(context.req.param('id')).first<{
      id: string; storageType: string; url: string; publicId: string | null; label: string; filename: string | null; mimeType: string | null; checksumSha256: string | null; resourceType: string; resourceId: string;
    }>();
  if (!row) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } }, 404);
  if (!await canView(context.env.DB, context.get('user'), row.resourceType, row.resourceId)) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You cannot view evidence for that record' } }, 403);
  }

  if (row.storageType !== 'r2') {
    return context.redirect(row.url, 302);
  }
  if (!context.env.ATTACHMENTS || !row.publicId) {
    return context.json({ ok: false, error: { code: 'ATTACHMENTS_UNAVAILABLE', message: 'Object storage is not configured for this deployment' } }, 503);
  }

  const object = await context.env.ATTACHMENTS.get(row.publicId);
  if (!object) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Attachment object is missing' } }, 404);

  await audit(context.env, context.get('user').id, 'attachment.downloaded', 'attachment', row.id).run();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', row.mimeType ?? 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${asciiFilename(row.filename ?? row.label)}"`);
  headers.set('Content-Security-Policy', "sandbox; default-src 'none'");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'private, no-store');
  if (row.checksumSha256) headers.set('ETag', `"${row.checksumSha256}"`);
  return new Response(object.body, { status: 200, headers });
});

attachmentRoutes.delete('/:id', async (context) => {
  const row = await context.env.DB.prepare(`SELECT id, owner_id AS ownerId, storage_type AS storageType, public_id AS publicId,
      resource_type AS resourceType, resource_id AS resourceId
    FROM attachments WHERE id=? AND archived_at IS NULL`).bind(context.req.param('id')).first<{
      id: string; ownerId: string; storageType: string; publicId: string | null; resourceType: string; resourceId: string;
    }>();
  if (!row) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Attachment not found' } }, 404);
  if (row.ownerId !== context.get('user').id && !context.get('user').permissions.includes('workspace.admin')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the uploader or an administrator can remove this evidence' } }, 403);
  }

  const admins = await context.env.DB.prepare(`SELECT user_id FROM user_roles WHERE role_id='role_admin'`).all<{ user_id: string }>();
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE attachments SET archived_at=unixepoch() WHERE id=?`).bind(row.id),
    audit(context.env, context.get('user').id, 'attachment.archived', 'attachment', row.id),
    ...workspaceEventStatements(context.env, {
      type: 'attachment.archived',
      userIds: [row.ownerId, ...admins.results.map((admin) => admin.user_id)],
      payload: { attachmentId: row.id, resourceType: row.resourceType, resourceId: row.resourceId },
    }),
  ]);
  if (row.storageType === 'r2' && row.publicId && context.env.ATTACHMENTS) {
    try {
      await context.env.ATTACHMENTS.delete(row.publicId);
    } catch (cause) {
      console.error(JSON.stringify({ level: 'error', service: 'attachment_archive', attachmentId: row.id, message: cause instanceof Error ? cause.message : 'unknown' }));
    }
  }
  return context.json({ ok: true, data: { archived: true } });
});
