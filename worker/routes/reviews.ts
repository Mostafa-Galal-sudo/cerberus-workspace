import { Hono } from 'hono';
import { reviewSchema } from '../../shared/schemas/tasks';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import type { Env, Variables } from '../types';

export const reviewRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
reviewRoutes.use('*', requireAuth, requirePasswordChanged, requirePermission('review.admin'));

reviewRoutes.get('/', async (context) => {
  const status = context.req.query('status') ?? 'pending';
  const rows = await context.env.DB.prepare(`SELECT s.id, s.task_id AS taskId, s.summary, s.version, s.submitted_at AS submittedAt,
      t.title AS taskTitle, u.display_name AS submittedByName, u.id AS submittedById
    FROM submissions s JOIN tasks t ON t.id=s.task_id JOIN users u ON u.id=s.submitted_by
    WHERE s.status=? ORDER BY s.submitted_at ASC LIMIT 100`).bind(status).all();
  return context.json({ ok: true, data: rows.results });
});

reviewRoutes.post('/:id', async (context) => {
  const parsed = reviewSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Review details are invalid', fields: parsed.error.flatten().fieldErrors } }, 422);
  const submission = await context.env.DB.prepare(`SELECT s.id, s.task_id, s.submitted_by, s.status, t.project_id, t.assignee_id
    FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE s.id=?`).bind(context.req.param('id')).first<{ id: string; task_id: string; submitted_by: string; status: string; project_id: string; assignee_id: string | null }>();
  if (!submission) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }, 404);
  if (submission.status !== 'pending') return context.json({ ok: false, error: { code: 'ALREADY_REVIEWED', message: 'This submission already has a decision' } }, 409);
  const reviewer = context.get('user');
  if (submission.submitted_by === reviewer.id) return context.json({ ok: false, error: { code: 'SELF_APPROVAL_FORBIDDEN', message: 'You cannot administratively review your own submission' } }, 403);
  const approved = parsed.data.result === 'approved';
  const reviewId = crypto.randomUUID();
  const statements = [
    context.env.DB.prepare(`INSERT INTO reviews (id, submission_id, reviewer_id, result, feedback) VALUES (?, ?, ?, ?, ?)` ).bind(reviewId, submission.id, reviewer.id, parsed.data.result, parsed.data.feedback),
    context.env.DB.prepare(`UPDATE submissions SET status=?, updated_at=unixepoch() WHERE id=? AND status='pending'`).bind(parsed.data.result, submission.id),
    context.env.DB.prepare(`UPDATE tasks SET status=?, approved_at=?, updated_at=unixepoch() WHERE id=?`).bind(approved ? 'approved' : 'changes_requested', approved ? Math.floor(Date.now() / 1000) : null, submission.task_id),
    context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id) VALUES (?, ?, ?, ?, ?, 'submission', ?)`)
      .bind(crypto.randomUUID(), submission.submitted_by, `review.${parsed.data.result}`, approved ? 'Submission approved' : 'Changes requested', parsed.data.feedback || 'Your submission was approved.', submission.id),
    audit(context.env, reviewer.id, `review.${parsed.data.result}`, 'submission', submission.id, { taskId: submission.task_id }),
  ];
  if (approved) statements.push(context.env.DB.prepare(`INSERT INTO progress_events (id, project_id, user_id, event_type, resource_type, resource_id, approved_delta, actor_id)
    VALUES (?, ?, ?, 'task.approved', 'task', ?, 1, ?)` ).bind(crypto.randomUUID(), submission.project_id, submission.assignee_id, submission.task_id, reviewer.id));
  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { reviewId, result: parsed.data.result } });
});
