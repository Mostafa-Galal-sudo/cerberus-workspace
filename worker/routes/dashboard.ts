import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import type { Env, Variables } from '../types';

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
dashboardRoutes.use('*', requireAuth, requirePasswordChanged);

dashboardRoutes.get('/summary', async (context) => {
  const user = context.get('user');
  const requestedMode = context.req.query('mode');
  const isAdmin = user.roles.includes('super_admin') && requestedMode !== 'member';
  const isSupervisor = user.roles.includes('project_supervisor');
  if (isAdmin || isSupervisor) {
    const [taskCounts, members, blockers, reviews, activity] = await Promise.all([
      context.env.DB.prepare(`SELECT status, COUNT(*) AS count FROM tasks WHERE archived_at IS NULL GROUP BY status`).all(),
      context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.specialization,
        COUNT(t.id) AS total, SUM(CASE WHEN t.status='approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN t.status='in_progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN t.status='ready_for_review' THEN 1 ELSE 0 END) AS pendingReview,
        SUM(CASE WHEN t.status='blocked' THEN 1 ELSE 0 END) AS blocked
        FROM users u JOIN user_roles ur ON ur.user_id=u.id AND ur.role_id='role_member'
        LEFT JOIN tasks t ON t.assignee_id=u.id AND t.archived_at IS NULL
        WHERE u.archived_at IS NULL GROUP BY u.id ORDER BY u.display_name`).all(),
      context.env.DB.prepare(`SELECT id, title, severity, created_at AS createdAt FROM blockers WHERE status='open' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at DESC LIMIT 6`).all(),
      context.env.DB.prepare(`SELECT COUNT(*) AS count FROM submissions WHERE status='pending'`).first<{ count: number }>(),
      context.env.DB.prepare(`SELECT a.action, a.resource_type AS resourceType, a.resource_id AS resourceId, a.created_at AS createdAt, u.display_name AS actorName
        FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 8`).all(),
    ]);
    return context.json({ ok: true, data: { mode: isAdmin ? 'admin' : 'supervisor', taskCounts: taskCounts.results, members: members.results, blockers: blockers.results, pendingReviews: reviews?.count ?? 0, activity: activity.results } });
  }
  const [taskCounts, currentTasks, submissions, notifications] = await Promise.all([
    context.env.DB.prepare(`SELECT status, COUNT(*) AS count FROM tasks WHERE assignee_id=? AND archived_at IS NULL GROUP BY status`).bind(user.id).all(),
    context.env.DB.prepare(`SELECT id, title, priority, status, updated_at AS updatedAt FROM tasks WHERE assignee_id=? AND archived_at IS NULL AND status <> 'approved' ORDER BY updated_at DESC LIMIT 8`).bind(user.id).all(),
    context.env.DB.prepare(`SELECT s.id, s.status, s.version, s.submitted_at AS submittedAt, t.title AS taskTitle FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.submitted_by=? ORDER BY s.submitted_at DESC LIMIT 6`).bind(user.id).all(),
    context.env.DB.prepare(`SELECT id, title, body, created_at AS createdAt FROM notifications WHERE user_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 6`).bind(user.id).all(),
  ]);
  return context.json({ ok: true, data: { mode: 'member', taskCounts: taskCounts.results, currentTasks: currentTasks.results, submissions: submissions.results, notifications: notifications.results } });
});

dashboardRoutes.get('/members/:id', async (context) => {
  const viewer = context.get('user');
  if (!viewer.roles.some((role) => ['super_admin', 'project_supervisor'].includes(role)) && viewer.id !== context.req.param('id')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Member progress is restricted' } }, 403);
  }
  const member = await context.env.DB.prepare(`SELECT id, display_name AS name, specialization, last_activity_at AS lastActivityAt FROM users WHERE id=? AND archived_at IS NULL`).bind(context.req.param('id')).first();
  if (!member) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Member not found' } }, 404);
  const [counts, worklogs, submissions, feedback, progress] = await Promise.all([
    context.env.DB.prepare(`SELECT status, COUNT(*) AS count FROM tasks WHERE assignee_id=? AND archived_at IS NULL GROUP BY status`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT * FROM worklogs WHERE user_id=? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 20`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT s.id, s.status, s.version, s.submitted_at, t.title FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.submitted_by=? ORDER BY s.submitted_at DESC LIMIT 20`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT f.*, u.display_name AS supervisor_name FROM supervisor_feedback f JOIN users u ON u.id=f.supervisor_id WHERE f.member_id=? ORDER BY f.created_at DESC LIMIT 20`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT occurred_at, approved_delta, total_delta, event_type FROM progress_events WHERE user_id=? ORDER BY occurred_at`).bind(context.req.param('id')).all(),
  ]);
  return context.json({ ok: true, data: { member, counts: counts.results, worklogs: worklogs.results, submissions: submissions.results, feedback: feedback.results, progress: progress.results } });
});
