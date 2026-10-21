import { Hono } from 'hono';
import { reviewSchema } from '../../shared/schemas/tasks';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { workspaceEventStatements } from '../services/events';
import type { Env, Variables } from '../types';

interface ReviewQueueRow {
  id: string;
  taskId: string | null;
  checkpointId: string | null;
  summary: string;
  version: number;
  status: string;
  submittedAt: number;
  submittedById: string;
  submittedByName: string;
  taskTitle: string | null;
  checkpointTitle: string | null;
}

interface ReviewTarget {
  id: string;
  task_id: string | null;
  checkpoint_id: string | null;
  submitted_by: string;
  status: string;
  project_id: string | null;
  task_assignee_id: string | null;
  checkpoint_owner_id: string | null;
}

export const reviewRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
reviewRoutes.use('*', requireAuth, requirePasswordChanged, requirePermission('review.admin'));

reviewRoutes.get('/', async (context) => {
  const requested = context.req.query('status');
  const status = requested && ['pending', 'approved', 'changes_requested', 'withdrawn'].includes(requested) ? requested : 'pending';
  const rows = await context.env.DB.prepare(`SELECT s.id, s.task_id AS taskId, s.checkpoint_id AS checkpointId, s.summary,
      s.version, s.status, s.submitted_at AS submittedAt,
      u.id AS submittedById, u.display_name AS submittedByName,
      t.title AS taskTitle, c.title AS checkpointTitle
    FROM submissions s
    LEFT JOIN tasks t ON t.id = s.task_id
    LEFT JOIN checkpoints c ON c.id = s.checkpoint_id
    JOIN users u ON u.id = s.submitted_by
    WHERE s.status = ?
    ORDER BY s.submitted_at ASC
    LIMIT 100`).bind(status).all<ReviewQueueRow>();

  const evidenceBySubmission = new Map<string, Array<{ id: string; kind: string; label: string; value: string }>>();
  const submissionIds = rows.results.map((row) => row.id);
  if (submissionIds.length > 0) {
    const placeholders = submissionIds.map(() => '?').join(',');
    const evidence = await context.env.DB.prepare(`SELECT id, submission_id AS submissionId, kind, label, value
      FROM submission_evidence WHERE submission_id IN (${placeholders}) ORDER BY created_at`)
      .bind(...submissionIds)
      .all<{ id: string; submissionId: string; kind: string; label: string; value: string }>();
    for (const item of evidence.results) {
      const list = evidenceBySubmission.get(item.submissionId) ?? [];
      list.push({ id: item.id, kind: item.kind, label: item.label, value: item.value });
      evidenceBySubmission.set(item.submissionId, list);
    }
  }

  return context.json({
    ok: true,
    data: rows.results.map((row) => ({
      ...row,
      targetType: row.taskId ? 'task' : 'checkpoint',
      evidence: evidenceBySubmission.get(row.id) ?? [],
    })),
  });
});

reviewRoutes.post('/:id', async (context) => {
  const parsed = reviewSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Review details are invalid', fields: parsed.error.flatten().fieldErrors } }, 422);

  const submission = await context.env.DB.prepare(`SELECT s.id, s.task_id, s.checkpoint_id, s.submitted_by, s.status,
      t.project_id, t.assignee_id AS task_assignee_id, c.owner_id AS checkpoint_owner_id
    FROM submissions s
    LEFT JOIN tasks t ON t.id = s.task_id
    LEFT JOIN checkpoints c ON c.id = s.checkpoint_id
    WHERE s.id=?`).bind(context.req.param('id')).first<ReviewTarget>();
  if (!submission) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }, 404);
  if (submission.status !== 'pending') return context.json({ ok: false, error: { code: 'ALREADY_REVIEWED', message: 'This submission already has a decision' } }, 409);

  const reviewer = context.get('user');
  if (submission.submitted_by === reviewer.id) return context.json({ ok: false, error: { code: 'SELF_APPROVAL_FORBIDDEN', message: 'You cannot administratively review your own submission' } }, 403);

  const approved = parsed.data.result === 'approved';
  const targetType = submission.checkpoint_id ? 'checkpoint' : 'task';
  const reviewId = crypto.randomUUID();
  const approvedAt = approved ? Math.floor(Date.now() / 1000) : null;
  const statements = [
    context.env.DB.prepare(`INSERT INTO reviews (id, submission_id, reviewer_id, result, feedback) VALUES (?, ?, ?, ?, ?)`)
      .bind(reviewId, submission.id, reviewer.id, parsed.data.result, parsed.data.feedback),
    context.env.DB.prepare(`UPDATE submissions SET status=?, updated_at=unixepoch() WHERE id=? AND status='pending'`)
      .bind(parsed.data.result, submission.id),
  ];

  if (targetType === 'task') {
    statements.push(context.env.DB.prepare(`UPDATE tasks SET status=?, approved_at=?, updated_at=unixepoch() WHERE id=?`)
      .bind(approved ? 'approved' : 'changes_requested', approvedAt, submission.task_id));
    if (approved && submission.project_id) {
      statements.push(context.env.DB.prepare(`INSERT INTO progress_events (id, project_id, user_id, event_type, resource_type, resource_id, approved_delta, actor_id)
        VALUES (?, ?, ?, 'task.approved', 'task', ?, 1, ?)`)
        .bind(crypto.randomUUID(), submission.project_id, submission.task_assignee_id, submission.task_id, reviewer.id));
    }
  } else {
    statements.push(context.env.DB.prepare(`UPDATE checkpoints SET status=?, approved_at=?, updated_at=unixepoch() WHERE id=?`)
      .bind(approved ? 'approved' : 'changes_requested', approvedAt, submission.checkpoint_id));
  }

  const targetLabel = targetType === 'task' ? 'Task' : 'Checkpoint';
  statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
    VALUES (?, ?, ?, ?, ?, 'submission', ?)`)
    .bind(
      crypto.randomUUID(),
      submission.submitted_by,
      `review.${parsed.data.result}`,
      approved ? `${targetLabel} submission approved` : `${targetLabel} changes requested`,
      parsed.data.feedback || (approved ? 'Your submission was approved.' : 'Changes were requested.'),
      submission.id,
    ));
  statements.push(audit(context.env, reviewer.id, `review.${parsed.data.result}`, 'submission', submission.id, {
    taskId: submission.task_id,
    checkpointId: submission.checkpoint_id,
    targetType,
  }));
  statements.push(...workspaceEventStatements(context.env, {
    type: `review.${parsed.data.result}`,
    userIds: [submission.submitted_by],
    payload: { submissionId: submission.id, taskId: submission.task_id, checkpointId: submission.checkpoint_id, targetType },
  }));

  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { reviewId, result: parsed.data.result, targetType } });
});
