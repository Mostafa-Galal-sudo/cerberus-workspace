import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import type { AuthUser, Env, Variables } from '../types';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: number | null;
  created_at: number;
}

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
notificationRoutes.use('*', requireAuth, requirePasswordChanged);

notificationRoutes.get('/', async (context) => {
  const user = context.get('user');
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 25)));
  const status = context.req.query('status') === 'unread' ? 'unread' : 'all';
  const requestedType = context.req.query('type')?.trim();
  const type = requestedType && requestedType.length <= 80 ? requestedType : null;

  const conditions = ['user_id = ?'];
  const bindings: unknown[] = [user.id];
  if (status === 'unread') conditions.push('read_at IS NULL');
  if (type) { conditions.push('type = ?'); bindings.push(type); }
  const where = conditions.join(' AND ');

  const [rows, total, unread] = await Promise.all([
    context.env.DB.prepare(`SELECT id, type, title, body, resource_type, resource_id, read_at, created_at
      FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, (page - 1) * limit).all<NotificationRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE ${where}`)
      .bind(...bindings).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL`)
      .bind(user.id).first<{ count: number }>(),
  ]);

  const links = await resolveNotificationLinks(context.env.DB, user, rows.results);
  return context.json({
    ok: true,
    data: rows.results.map((row) => ({ ...row, link: links.get(row.id) ?? null })),
    meta: {
      page,
      limit,
      total: total?.count ?? 0,
      unreadCount: unread?.count ?? 0,
      hasMore: page * limit < (total?.count ?? 0),
    },
  });
});

notificationRoutes.get('/unread-count', async (context) => {
  const row = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL`)
    .bind(context.get('user').id).first<{ count: number }>();
  return context.json({ ok: true, data: { count: row?.count ?? 0 } });
});

notificationRoutes.post('/read-all', async (context) => {
  const result = await context.env.DB.prepare(`UPDATE notifications SET read_at=unixepoch() WHERE user_id=? AND read_at IS NULL`)
    .bind(context.get('user').id).run();
  return context.json({ ok: true, data: { updated: result.meta.changes ?? 0 } });
});

notificationRoutes.post('/:id/read', async (context) => {
  const result = await context.env.DB.prepare(`UPDATE notifications SET read_at=unixepoch() WHERE id=? AND user_id=? AND read_at IS NULL`)
    .bind(context.req.param('id'), context.get('user').id).run();
  return context.json({ ok: true, data: { updated: result.meta.changes ?? 0 } });
});

/**
 * Resolves a notification's destination on the server so the client never
 * invents a link to a resource the recipient cannot open. Review-queue links
 * are only returned to reviewers; task links require a live task row.
 */
async function resolveNotificationLinks(
  db: D1Database,
  user: Pick<AuthUser, 'permissions'>,
  rows: NotificationRow[],
): Promise<Map<string, string>> {
  const taskIds = new Set<string>();
  const submissionIds = new Set<string>();
  for (const row of rows) {
    if (!row.resource_id) continue;
    if (row.resource_type === 'task') taskIds.add(row.resource_id);
    if (row.resource_type === 'submission') submissionIds.add(row.resource_id);
  }

  const [tasks, submissions] = await Promise.all([
    taskIds.size
      ? db.prepare(`SELECT id FROM tasks WHERE archived_at IS NULL AND id IN (${[...taskIds].map(() => '?').join(',')})`)
        .bind(...taskIds).all<{ id: string }>()
      : Promise.resolve({ results: [] as Array<{ id: string }> }),
    submissionIds.size
      ? db.prepare(`SELECT s.id, s.task_id AS taskId, s.checkpoint_id AS checkpointId, t.archived_at AS taskArchived
          FROM submissions s LEFT JOIN tasks t ON t.id=s.task_id
          WHERE s.id IN (${[...submissionIds].map(() => '?').join(',')})`)
        .bind(...submissionIds).all<{ id: string; taskId: string | null; checkpointId: string | null; taskArchived: number | null }>()
      : Promise.resolve({ results: [] as Array<{ id: string; taskId: string | null; checkpointId: string | null; taskArchived: number | null }> }),
  ]);

  const liveTasks = new Set(tasks.results.map((row) => row.id));
  const submissionTargets = new Map(submissions.results.map((row) => [row.id, row]));
  const links = new Map<string, string>();

  for (const row of rows) {
    if (row.resource_type === 'task' && row.resource_id && liveTasks.has(row.resource_id)) {
      links.set(row.id, `/tasks/${row.resource_id}`);
      continue;
    }
    if (row.resource_type === 'submission' && row.resource_id) {
      const target = submissionTargets.get(row.resource_id);
      if (target?.taskId && target.taskArchived === null) {
        links.set(row.id, `/tasks/${target.taskId}`);
      } else if (target?.checkpointId && row.type === 'review.requested' && user.permissions.includes('review.admin')) {
        links.set(row.id, '/reviews');
      } else {
        links.set(row.id, '/tasks');
      }
      continue;
    }
    if (row.resource_type === 'supervisor_feedback' || row.resource_type === 'user') {
      links.set(row.id, '/members');
    }
  }

  return links;
}
