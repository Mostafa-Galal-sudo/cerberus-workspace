import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import {
  PLANNING_TASK_COLUMNS,
  isPlanningAdmin,
  isPlanningObserver,
  resolvePlanningMember,
  resolveWindow,
  weekWindow,
  windowEpochs,
} from '../services/planning';
import type { Env, Variables } from '../types';

interface PlanningTaskRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  startDate: number | null;
  dueDate: number | null;
  estimateHours: number;
  assigneeId: string | null;
  assigneeName: string | null;
  domainName: string | null;
  loggedHours: number;
}

interface WorklogRow {
  id: string;
  taskId: string;
  taskTitle: string;
  workedOn: string;
  hours: number;
  note: string;
  createdAt: number;
}

export const planningRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
planningRoutes.use('*', requireAuth, requirePasswordChanged);

planningRoutes.get('/my-week', async (context) => {
  const user = context.get('user');
  const requestedMember = context.req.query('memberId')?.trim() || undefined;
  const memberId = resolvePlanningMember(user, requestedMember);
  if (!memberId) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You can only read your own plan' } }, 403);

  const window = weekWindow(context.req.query('weekStart')?.trim() || undefined);
  if (!window) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'weekStart must be a YYYY-MM-DD date' } }, 422);
  const epochs = windowEpochs(window);

  const member = await context.env.DB.prepare(`SELECT id, display_name AS name, specialization FROM users WHERE id=? AND archived_at IS NULL`)
    .bind(memberId).first();
  if (!member) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Member not found' } }, 404);

  const [tasks, overdue, worklogs] = await Promise.all([
    context.env.DB.prepare(`SELECT ${PLANNING_TASK_COLUMNS}
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN engineering_domains d ON d.id = t.domain_id
      WHERE t.archived_at IS NULL AND t.assignee_id = ?
        AND (
          (t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?)
          OR (t.start_date IS NOT NULL AND t.start_date BETWEEN ? AND ?)
          OR (t.due_date IS NULL AND t.start_date IS NULL AND t.status = 'in_progress')
        )
      ORDER BY t.due_date IS NULL, t.due_date, CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`)
      .bind(memberId, epochs.start, epochs.end, epochs.start, epochs.end).all<PlanningTaskRow>(),
    context.env.DB.prepare(`SELECT ${PLANNING_TASK_COLUMNS}
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN engineering_domains d ON d.id = t.domain_id
      WHERE t.archived_at IS NULL AND t.assignee_id = ?
        AND t.due_date IS NOT NULL AND t.due_date < ?
        AND t.status NOT IN ('approved', 'archived')
      ORDER BY t.due_date ASC`)
      .bind(memberId, epochs.start).all<PlanningTaskRow>(),
    context.env.DB.prepare(`SELECT w.id, w.task_id AS taskId, t.title AS taskTitle, w.worked_on AS workedOn,
        w.hours, w.note, w.created_at AS createdAt
      FROM task_worklogs w JOIN tasks t ON t.id = w.task_id
      WHERE w.user_id = ? AND w.worked_on BETWEEN ? AND ?
      ORDER BY w.worked_on DESC, w.created_at DESC
      LIMIT 100`).bind(memberId, window.from, window.to).all<WorklogRow>(),
  ]);

  const loggedHours = Math.round(worklogs.results.reduce((sum, entry) => sum + entry.hours, 0) * 100) / 100;
  const estimateHours = Math.round(tasks.results.reduce((sum, task) => sum + task.estimateHours, 0) * 100) / 100;

  return context.json({
    ok: true,
    data: {
      weekStart: window.from,
      weekEnd: window.to,
      member,
      tasks: tasks.results,
      overdue: overdue.results,
      worklogs: worklogs.results,
      totals: {
        plannedTasks: tasks.results.length,
        overdueTasks: overdue.results.length,
        estimateHours,
        loggedHours,
        remainingHours: Math.round(Math.max(0, estimateHours - loggedHours) * 100) / 100,
      },
      readOnly: isPlanningObserver(user) && !isPlanningAdmin(user),
    },
  });
});

planningRoutes.get('/calendar', async (context) => {
  const window = resolveWindow(context.req.query('from')?.trim() || undefined, context.req.query('to')?.trim() || undefined, 30);
  if (!window) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Provide a valid date range of at most 180 days' } }, 422);
  const epochs = windowEpochs(window);
  const assigneeId = context.req.query('assigneeId')?.trim() || null;
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(200, Math.max(1, Number(context.req.query('limit') ?? 100)));

  const conditions = [
    't.archived_at IS NULL',
    `((t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ?) OR (t.start_date IS NOT NULL AND t.start_date BETWEEN ? AND ?))`,
  ];
  const bindings: unknown[] = [epochs.start, epochs.end, epochs.start, epochs.end];
  if (assigneeId) { conditions.push('t.assignee_id = ?'); bindings.push(assigneeId); }
  const where = conditions.join(' AND ');

  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT ${PLANNING_TASK_COLUMNS}
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN engineering_domains d ON d.id = t.domain_id
      WHERE ${where}
      ORDER BY COALESCE(t.due_date, t.start_date), t.id
      LIMIT ? OFFSET ?`).bind(...bindings, limit, (page - 1) * limit).all<PlanningTaskRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`).bind(...bindings).first<{ count: number }>(),
  ]);

  return context.json({
    ok: true,
    data: rows.results,
    meta: { page, limit, total: total?.count ?? 0, hasMore: page * limit < (total?.count ?? 0), from: window.from, to: window.to },
  });
});

planningRoutes.get('/timeline', async (context) => {
  const window = resolveWindow(context.req.query('from')?.trim() || undefined, context.req.query('to')?.trim() || undefined, 90);
  if (!window) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Provide a valid date range of at most 180 days' } }, 422);
  const epochs = windowEpochs(window);
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(300, Math.max(1, Number(context.req.query('limit') ?? 150)));

  const where = `t.archived_at IS NULL AND (t.start_date IS NOT NULL OR t.due_date IS NOT NULL)
    AND COALESCE(t.start_date, t.due_date) <= ? AND COALESCE(t.due_date, t.start_date) >= ?`;
  const bindings: unknown[] = [epochs.end, epochs.start];

  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT ${PLANNING_TASK_COLUMNS}
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN engineering_domains d ON d.id = t.domain_id
      WHERE ${where}
      ORDER BY t.start_date IS NULL, t.start_date, t.due_date, t.id
      LIMIT ? OFFSET ?`).bind(...bindings, limit, (page - 1) * limit).all<PlanningTaskRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`).bind(...bindings).first<{ count: number }>(),
  ]);

  const dependencies = await context.env.DB.prepare(`SELECT td.task_id AS taskId, td.depends_on_task_id AS dependsOnTaskId
    FROM task_dependencies td
    JOIN tasks a ON a.id = td.task_id
    JOIN tasks b ON b.id = td.depends_on_task_id
    WHERE a.archived_at IS NULL AND b.archived_at IS NULL`)
    .all<{ taskId: string; dependsOnTaskId: string }>();

  const visible = new Set(rows.results.map((row) => row.id));
  const edges = dependencies.results.filter((edge) => visible.has(edge.taskId) && visible.has(edge.dependsOnTaskId));
  return context.json({
    ok: true,
    data: rows.results,
    meta: { page, limit, total: total?.count ?? 0, hasMore: page * limit < (total?.count ?? 0), from: window.from, to: window.to, edges },
  });
});

planningRoutes.get('/workload', async (context) => {
  const window = resolveWindow(context.req.query('from')?.trim() || undefined, context.req.query('to')?.trim() || undefined, 30);
  if (!window) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Provide a valid date range of at most 180 days' } }, 422);
  const epochs = windowEpochs(window);

  const rows = await context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.specialization,
      COUNT(t.id) AS activeTasks,
      COALESCE(SUM(t.estimate_hours), 0) AS estimateHours,
      SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS dueInRange,
      SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END) AS overdueTasks
    FROM users u
    LEFT JOIN tasks t ON t.assignee_id = u.id AND t.archived_at IS NULL AND t.status NOT IN ('approved', 'archived')
    WHERE u.archived_at IS NULL AND u.status = 'active'
    GROUP BY u.id, u.display_name, u.specialization
    ORDER BY activeTasks DESC, u.display_name ASC`)
    .bind(epochs.start, epochs.end, epochs.start)
    .all<{ id: string; name: string; specialization: string | null; activeTasks: number; estimateHours: number; dueInRange: number; overdueTasks: number }>();

  const logged = await context.env.DB.prepare(`SELECT user_id AS userId, COALESCE(SUM(hours), 0) AS hours
    FROM task_worklogs WHERE worked_on BETWEEN ? AND ? GROUP BY user_id`)
    .bind(window.from, window.to).all<{ userId: string; hours: number }>();
  const loggedByUser = new Map(logged.results.map((row) => [row.userId, Math.round(row.hours * 100) / 100]));

  return context.json({
    ok: true,
    data: rows.results.map((row) => ({
      ...row,
      estimateHours: Math.round(row.estimateHours * 100) / 100,
      loggedHours: loggedByUser.get(row.id) ?? 0,
    })),
    meta: { from: window.from, to: window.to, total: rows.results.length },
  });
});
