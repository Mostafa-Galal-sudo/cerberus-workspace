import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { announcementSchema, messageSchema } from '../../shared/schemas/workspace';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { listWorkspaceEvents, workspaceEventStatements } from '../services/events';
import { consumeRateLimit } from '../services/rate-limit';
import { isSupervisor } from '../services/wiki-access';
import { notificationRoutes } from './notifications';
import type { AuthUser, Env, Variables } from '../types';

export const collaborationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
collaborationRoutes.use('*', requireAuth, requirePasswordChanged);
collaborationRoutes.route('/notifications', notificationRoutes);

collaborationRoutes.get('/events/poll', async (context) => {
  const after = Number(context.req.query('after') ?? 0);
  const events = await listWorkspaceEvents(context.env, context.get('user').id, Number.isFinite(after) ? after : 0);
  return context.json({ ok: true, data: events });
});

collaborationRoutes.get('/events', async (context) => {
  const userId = context.get('user').id;
  const requested = Number(context.req.header('Last-Event-ID') ?? context.req.query('after') ?? 0);
  let cursor = Number.isFinite(requested) && requested > 0 ? requested : 0;

  if (cursor === 0) {
    const latest = await context.env.DB.prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM workspace_events WHERE user_id=?`)
      .bind(userId).first<{ seq: number }>();
    cursor = latest?.seq ?? 0;
  }

  return streamSSE(context, async (stream) => {
    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ cursor }), retry: 3000 });
    const deadline = Date.now() + 25_000;

    while (!stream.aborted && Date.now() < deadline) {
      const events = await listWorkspaceEvents(context.env, userId, cursor);
      for (const event of events) {
        cursor = event.seq;
        await stream.writeSSE({
          id: String(event.seq),
          event: 'workspace',
          data: JSON.stringify({
            seq: event.seq,
            type: event.eventType,
            createdAt: event.createdAt,
            ...event.payload,
          }),
        });
      }
      await stream.sleep(2000);
    }

    if (!stream.aborted) {
      await stream.writeSSE({ event: 'reconnect', data: JSON.stringify({ cursor }) });
    }
  }, async (error, stream) => {
    console.error(JSON.stringify({ level: 'error', path: '/collaboration/events', message: error.message }));
    await stream.close();
  });
});

collaborationRoutes.get('/channels', async (context) => {
  const rows = await context.env.DB.prepare(`SELECT c.id, c.name, c.type,
    (SELECT m.body FROM messages m WHERE m.channel_id=c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) AS latestMessage,
    (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id=c.id AND m.deleted_at IS NULL) AS latestAt
    FROM channels c JOIN channel_members cm ON cm.channel_id=c.id
    WHERE cm.user_id=? AND c.archived_at IS NULL ORDER BY COALESCE(latestAt,c.created_at) DESC`).bind(context.get('user').id).all();
  return context.json({ ok: true, data: rows.results });
});

collaborationRoutes.post('/channels/direct', async (context) => {
  if (isSupervisor(context.get('user'))) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Supervisor accounts are read-only' } }, 403);
  const body = await context.req.json<{ userId?: string }>().catch(() => ({} as { userId?: string }));
  if (!body.userId || body.userId === context.get('user').id) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Choose another workspace member' } }, 422);
  const existing = await context.env.DB.prepare(`SELECT c.id FROM channels c
    JOIN channel_members me ON me.channel_id=c.id AND me.user_id=?
    JOIN channel_members them ON them.channel_id=c.id AND them.user_id=?
    WHERE c.type='direct' AND (SELECT COUNT(*) FROM channel_members x WHERE x.channel_id=c.id)=2 LIMIT 1`)
    .bind(context.get('user').id, body.userId).first<{ id: string }>();
  if (existing) return context.json({ ok: true, data: existing });
  const target = await context.env.DB.prepare(`SELECT display_name FROM users WHERE id=? AND status='active' AND archived_at IS NULL`).bind(body.userId).first<{ display_name: string }>();
  if (!target) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Member not found' } }, 404);
  const id = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO channels (id, name, type) VALUES (?, ?, 'direct')`).bind(id, target.display_name),
    context.env.DB.prepare(`INSERT INTO channel_members (channel_id,user_id) VALUES (?,?),(?,?)`).bind(id, context.get('user').id, id, body.userId),
  ]);
  return context.json({ ok: true, data: { id } }, 201);
});

collaborationRoutes.get('/channels/:id/messages', async (context) => {
  const allowed = await channelAllowed(context.env.DB, context.req.param('id'), context.get('user').id);
  if (!allowed) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Channel access denied' } }, 403);
  const before = Number(context.req.query('before') ?? Number.MAX_SAFE_INTEGER);
  const rows = await context.env.DB.prepare(`SELECT m.id,m.body,m.parent_id AS parentId,m.created_at AS createdAt,m.updated_at AS updatedAt,
    m.author_id AS authorId,u.display_name AS authorName FROM messages m JOIN users u ON u.id=m.author_id
    WHERE m.channel_id=? AND m.deleted_at IS NULL AND m.created_at<? ORDER BY m.created_at DESC LIMIT 50`)
    .bind(context.req.param('id'), before).all();
  return context.json({ ok: true, data: rows.results.reverse() });
});

collaborationRoutes.post('/channels/:id/messages', async (context) => {
  const user = context.get('user');
  if (isSupervisor(user)) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Supervisor accounts are read-only' } }, 403);
  if (!await consumeRateLimit(context.env, `message:${user.id}`, 60, 60)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many messages. Slow down and retry.' } }, 429);
  }
  const parsed = messageSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Message cannot be empty' } }, 422);
  const channelId = context.req.param('id');
  if (!await channelAllowed(context.env.DB, channelId, context.get('user').id)) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Channel access denied' } }, 403);
  if (parsed.data.parentId) {
    const parent = await context.env.DB.prepare(`SELECT id FROM messages WHERE id=? AND channel_id=?`).bind(parsed.data.parentId, channelId).first();
    if (!parent) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Reply target is not in this channel' } }, 422);
  }
  const id = crypto.randomUUID();
  const memberRows = await context.env.DB.prepare(`SELECT user_id FROM channel_members WHERE channel_id=?`).bind(channelId).all<{ user_id: string }>();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO messages (id,channel_id,author_id,parent_id,body) VALUES (?,?,?,?,?)`)
      .bind(id, channelId, context.get('user').id, parsed.data.parentId ?? null, parsed.data.body),
    ...workspaceEventStatements(context.env, {
      type: 'message.created',
      userIds: memberRows.results.map((row) => row.user_id),
      payload: { channelId, messageId: id },
    }),
  ]);
  return context.json({ ok: true, data: { id } }, 201);
});

collaborationRoutes.patch('/messages/:id', async (context) => {
  if (isSupervisor(context.get('user'))) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Supervisor accounts are read-only' } }, 403);
  const parsed = messageSchema.pick({ body: true }).safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Message cannot be empty' } }, 422);
  const message = await context.env.DB.prepare(`SELECT id, channel_id FROM messages WHERE id=? AND author_id=? AND deleted_at IS NULL`)
    .bind(context.req.param('id'), context.get('user').id).first<{ id: string; channel_id: string }>();
  if (!message) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the author can edit this message' } }, 403);

  const memberRows = await context.env.DB.prepare(`SELECT user_id FROM channel_members WHERE channel_id=?`).bind(message.channel_id).all<{ user_id: string }>();
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE messages SET body=?,updated_at=unixepoch() WHERE id=?`).bind(parsed.data.body, message.id),
    ...workspaceEventStatements(context.env, {
      type: 'message.updated',
      userIds: memberRows.results.map((row) => row.user_id),
      payload: { channelId: message.channel_id, messageId: message.id },
    }),
  ]);
  return context.json({ ok: true, data: null });
});

collaborationRoutes.delete('/messages/:id', async (context) => {
  const user = context.get('user');
  if (isSupervisor(user)) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Supervisor accounts are read-only' } }, 403);
  const message = await context.env.DB.prepare(`SELECT id, channel_id, author_id FROM messages WHERE id=? AND deleted_at IS NULL`)
    .bind(context.req.param('id')).first<{ id: string; channel_id: string; author_id: string }>();
  if (!message || (message.author_id !== user.id && !user.roles.includes('super_admin'))) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Message deletion denied' } }, 403);
  }

  const memberRows = await context.env.DB.prepare(`SELECT user_id FROM channel_members WHERE channel_id=?`).bind(message.channel_id).all<{ user_id: string }>();
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE messages SET deleted_at=unixepoch(),body='[deleted]' WHERE id=?`).bind(message.id),
    ...workspaceEventStatements(context.env, {
      type: 'message.deleted',
      userIds: memberRows.results.map((row) => row.user_id),
      payload: { channelId: message.channel_id, messageId: message.id },
    }),
  ]);
  return context.json({ ok: true, data: null });
});

collaborationRoutes.post('/channels/:id/read', async (context) => {
  const channelId = context.req.param('id');
  if (!await channelAllowed(context.env.DB, channelId, context.get('user').id)) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Channel access denied' } }, 403);
  await context.env.DB.prepare(`INSERT OR REPLACE INTO message_reads (message_id,user_id,read_at)
    SELECT id,?,unixepoch() FROM messages WHERE channel_id=? AND deleted_at IS NULL`).bind(context.get('user').id, channelId).run();
  return context.json({ ok: true, data: null });
});

collaborationRoutes.get('/announcements', async (context) => {
  const user = context.get('user');
  const audience = announcementAudiences(user);
  const placeholders = audience.map(() => '?').join(',');
  const rows = await context.env.DB.prepare(`SELECT a.*,u.display_name AS authorName,ar.read_at AS readAt FROM announcements a
    JOIN users u ON u.id=a.author_id LEFT JOIN announcement_reads ar ON ar.announcement_id=a.id AND ar.user_id=?
    WHERE a.archived_at IS NULL AND a.published_at IS NOT NULL AND (a.expires_at IS NULL OR a.expires_at>unixepoch()) AND a.audience IN (${placeholders})
    ORDER BY a.published_at DESC LIMIT 100`).bind(user.id, ...audience).all();
  return context.json({ ok: true, data: rows.results });
});

collaborationRoutes.post('/announcements', requirePermission('workspace.admin'), async (context) => {
  const parsed = announcementSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Announcement details are invalid', fields: parsed.error.flatten().fieldErrors } }, 422);
  const id = crypto.randomUUID();
  const publishedAt = parsed.data.published ? Math.floor(Date.now()/1000) : null;
  const roleFilter = parsed.data.audience === 'members' ? 'role_member'
    : parsed.data.audience === 'supervisors' ? 'role_supervisor'
      : parsed.data.audience === 'admins' ? 'role_admin' : null;
  const recipients = parsed.data.published
    ? await context.env.DB.prepare(`SELECT DISTINCT u.id FROM users u
        ${roleFilter ? 'JOIN user_roles ur ON ur.user_id=u.id AND ur.role_id=?' : ''}
        WHERE u.status='active' AND u.archived_at IS NULL`)
        .bind(...(roleFilter ? [roleFilter] : [])).all<{ id: string }>()
    : { results: [] as Array<{ id: string }> };

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO announcements (id,author_id,title,body,audience,published_at,expires_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, context.get('user').id, parsed.data.title, parsed.data.body, parsed.data.audience, publishedAt, parsed.data.expiresAt ?? null),
    ...workspaceEventStatements(context.env, {
      type: 'announcement.published',
      userIds: recipients.results.map((row) => row.id),
      payload: { announcementId: id, title: parsed.data.title },
    }),
    audit(context.env, context.get('user').id, 'announcement.created', 'announcement', id),
  ]);
  return context.json({ ok: true, data: { id } }, 201);
});

collaborationRoutes.post('/announcements/:id/read', async (context) => {
  const user = context.get('user');
  const audience = announcementAudiences(user);
  const placeholders = audience.map(() => '?').join(',');
  const announcement = await context.env.DB.prepare(`SELECT id FROM announcements
    WHERE id=? AND archived_at IS NULL AND published_at IS NOT NULL
      AND (expires_at IS NULL OR expires_at>unixepoch()) AND audience IN (${placeholders})`)
    .bind(context.req.param('id'), ...audience).first();
  if (!announcement) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Announcement not found' } }, 404);
  await context.env.DB.prepare(`INSERT OR REPLACE INTO announcement_reads (announcement_id,user_id) VALUES (?,?)`).bind(context.req.param('id'),user.id).run();
  return context.json({ ok: true, data: null });
});

async function channelAllowed(db: D1Database, channelId: string, userId: string) {
  return Boolean(await db.prepare(`SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?`).bind(channelId,userId).first());
}

function announcementAudiences(user: Pick<AuthUser, 'roles' | 'permissions'>): string[] {
  const audiences = new Set(['all']);
  if (user.permissions.includes('workspace.admin') || user.roles.includes('super_admin')) audiences.add('admins');
  if (user.roles.includes('project_supervisor')) audiences.add('supervisors');
  if (user.permissions.includes('task.work') || user.roles.includes('team_member') || user.roles.includes('technical_lead')) audiences.add('members');
  return [...audiences];
}
