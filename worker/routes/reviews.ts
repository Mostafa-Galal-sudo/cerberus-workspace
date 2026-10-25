import { Hono } from 'hono';
import { reviewDecisionSchema } from '../../shared/schemas/tasks';
import { reviewAssignmentSchema, reviewRubricBaseSchema, reviewRubricSchema } from '../../shared/schemas/planning';
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
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  assignedAt: number | null;
  rubricId: string | null;
  rubricName: string | null;
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
  assigned_reviewer_id: string | null;
  rubric_id: string | null;
}

interface RubricCriterionRow {
  id: string;
  rubricId: string;
  label: string;
  weight: number;
  sortOrder: number;
}

interface RubricRow {
  id: string;
  name: string;
  description: string;
  active: number;
  createdAt: number;
  updatedAt: number;
}

async function loadRubrics(db: D1Database, options: { activeOnly: boolean }): Promise<Array<RubricRow & { criteria: Array<Omit<RubricCriterionRow, 'rubricId'>> }>> {
  const [rubrics, criteria] = await Promise.all([
    db.prepare(`SELECT id, name, description, active, created_at AS createdAt, updated_at AS updatedAt
      FROM review_rubrics ${options.activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name ASC`).all<RubricRow>(),
    db.prepare(`SELECT id, rubric_id AS rubricId, label, weight, sort_order AS sortOrder
      FROM review_rubric_criteria ORDER BY sort_order ASC, label ASC`).all<RubricCriterionRow>(),
  ]);

  const byRubric = new Map<string, Array<Omit<RubricCriterionRow, 'rubricId'>>>();
  for (const criterion of criteria.results) {
    const list = byRubric.get(criterion.rubricId) ?? [];
    list.push({ id: criterion.id, label: criterion.label, weight: criterion.weight, sortOrder: criterion.sortOrder });
    byRubric.set(criterion.rubricId, list);
  }

  return rubrics.results.map((rubric) => ({ ...rubric, criteria: byRubric.get(rubric.id) ?? [] }));
}

export const reviewRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
reviewRoutes.use('*', requireAuth, requirePasswordChanged, requirePermission('review.admin'));

reviewRoutes.get('/rubrics', async (context) => {
  const includeInactive = context.req.query('includeInactive') === 'true';
  const rubrics = await loadRubrics(context.env.DB, { activeOnly: !includeInactive });
  return context.json({ ok: true, data: rubrics, meta: { total: rubrics.length } });
});

reviewRoutes.post('/rubrics', async (context) => {
  const parsed = reviewRubricSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Rubric criteria and weights are invalid', fields: parsed.error.flatten().fieldErrors } }, 422);
  }
  const duplicate = await context.env.DB.prepare(`SELECT 1 FROM review_rubrics WHERE lower(name) = lower(?)`)
    .bind(parsed.data.name).first();
  if (duplicate) return context.json({ ok: false, error: { code: 'RUBRIC_EXISTS', message: 'A rubric with that name already exists' } }, 409);

  const rubricId = crypto.randomUUID();
  const statements = [
    context.env.DB.prepare(`INSERT INTO review_rubrics (id, name, description, created_by) VALUES (?, ?, ?, ?)`)
      .bind(rubricId, parsed.data.name, parsed.data.description, context.get('user').id),
  ];
  parsed.data.criteria.forEach((criterion, index) => {
    statements.push(context.env.DB.prepare(`INSERT INTO review_rubric_criteria (id, rubric_id, label, weight, sort_order) VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), rubricId, criterion.label, criterion.weight, index));
  });
  statements.push(audit(context.env, context.get('user').id, 'review.rubric_created', 'review_rubric', rubricId, {
    criteria: parsed.data.criteria.length,
  }));

  try {
    await context.env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
      return context.json({ ok: false, error: { code: 'RUBRIC_EXISTS', message: 'A rubric with that name already exists' } }, 409);
    }
    throw error;
  }
  return context.json({ ok: true, data: { id: rubricId } }, 201);
});

reviewRoutes.patch('/rubrics/:id', async (context) => {
  const rubricId = context.req.param('id');
  const existing = await context.env.DB.prepare(`SELECT id, name, description, active FROM review_rubrics WHERE id=?`)
    .bind(rubricId).first<{ id: string; name: string; description: string; active: number }>();
  if (!existing) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Rubric not found' } }, 404);

  const body = await context.req.json<{ active?: boolean; name?: string; description?: string; criteria?: unknown }>()
    .catch(() => ({} as { active?: boolean; name?: string; description?: string; criteria?: unknown }));
  const updates: string[] = [];
  const binds: unknown[] = [];
  const statements: D1PreparedStatement[] = [];

  if (body.name !== undefined) {
    const parsedName = reviewRubricBaseSchema.shape.name.safeParse(body.name);
    if (!parsedName.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Rubric name is invalid' } }, 422);
    const duplicate = await context.env.DB.prepare(`SELECT 1 FROM review_rubrics WHERE lower(name)=lower(?) AND id<>?`)
      .bind(parsedName.data, rubricId).first();
    if (duplicate) return context.json({ ok: false, error: { code: 'RUBRIC_EXISTS', message: 'A rubric with that name already exists' } }, 409);
    updates.push('name = ?'); binds.push(parsedName.data);
  }
  if (body.description !== undefined) {
    const parsedDescription = reviewRubricSchema.shape.description.safeParse(body.description);
    if (!parsedDescription.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Rubric description is invalid' } }, 422);
    updates.push('description = ?'); binds.push(parsedDescription.data);
  }
  if (body.active !== undefined) {
    updates.push('active = ?'); binds.push(body.active ? 1 : 0);
  }
  if (body.criteria !== undefined) {
    const parsed = reviewRubricSchema.safeParse({ name: body.name ?? existing.name, description: body.description ?? existing.description, criteria: body.criteria });
    if (!parsed.success) {
      return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Rubric criteria and weights are invalid', fields: parsed.error.flatten().fieldErrors } }, 422);
    }
    statements.push(context.env.DB.prepare(`DELETE FROM review_rubric_criteria WHERE rubric_id=?`).bind(rubricId));
    parsed.data.criteria.forEach((criterion, index) => {
      statements.push(context.env.DB.prepare(`INSERT INTO review_rubric_criteria (id, rubric_id, label, weight, sort_order) VALUES (?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), rubricId, criterion.label, criterion.weight, index));
    });
  }

  if (updates.length === 0 && statements.length === 0) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'No rubric fields to update' } }, 422);
  }

  updates.push('updated_at = unixepoch()');
  binds.push(rubricId);
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE review_rubrics SET ${updates.join(', ')} WHERE id=?`).bind(...binds),
    ...statements,
    audit(context.env, context.get('user').id, 'review.rubric_updated', 'review_rubric', rubricId, {
      fields: Object.keys(body),
    }),
  ]);

  return context.json({ ok: true, data: { updated: true } });
});

reviewRoutes.get('/reviewers', async (context) => {
  const rows = await context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.email, u.specialization,
      (SELECT COUNT(*) FROM submissions s WHERE s.assigned_reviewer_id = u.id AND s.status = 'pending') AS pendingAssignments
    FROM users u
    WHERE u.archived_at IS NULL AND u.status = 'active'
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = u.id AND rp.permission_id = 'perm_review_admin'
      )
    ORDER BY u.display_name ASC`).all();
  return context.json({ ok: true, data: rows.results, meta: { total: rows.results.length } });
});

reviewRoutes.get('/', async (context) => {
  const requested = context.req.query('status');
  const status = requested && ['pending', 'approved', 'changes_requested', 'withdrawn'].includes(requested) ? requested : 'pending';
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 50)));
  const mine = context.req.query('mine') === 'true';

  const conditions = ['s.status = ?'];
  const bindings: unknown[] = [status];
  if (mine) { conditions.push('s.assigned_reviewer_id = ?'); bindings.push(context.get('user').id); }
  const where = conditions.join(' AND ');

  const [rows, total, rubrics] = await Promise.all([
    context.env.DB.prepare(`SELECT s.id, s.task_id AS taskId, s.checkpoint_id AS checkpointId, s.summary,
        s.version, s.status, s.submitted_at AS submittedAt,
        u.id AS submittedById, u.display_name AS submittedByName,
        t.title AS taskTitle, c.title AS checkpointTitle,
        s.assigned_reviewer_id AS assignedReviewerId, r.display_name AS assignedReviewerName,
        s.assigned_at AS assignedAt, s.rubric_id AS rubricId, rb.name AS rubricName
      FROM submissions s
      LEFT JOIN tasks t ON t.id = s.task_id
      LEFT JOIN checkpoints c ON c.id = s.checkpoint_id
      JOIN users u ON u.id = s.submitted_by
      LEFT JOIN users r ON r.id = s.assigned_reviewer_id
      LEFT JOIN review_rubrics rb ON rb.id = s.rubric_id
      WHERE ${where}
      ORDER BY s.submitted_at ASC
      LIMIT ? OFFSET ?`).bind(...bindings, limit, (page - 1) * limit).all<ReviewQueueRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM submissions s WHERE ${where}`).bind(...bindings).first<{ count: number }>(),
    loadRubrics(context.env.DB, { activeOnly: true }),
  ]);

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
    meta: {
      page,
      limit,
      total: total?.count ?? 0,
      hasMore: page * limit < (total?.count ?? 0),
      status,
      rubrics,
    },
  });
});

reviewRoutes.post('/:id/assignment', async (context) => {
  const parsed = reviewAssignmentSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Choose a reviewer and an optional rubric', fields: parsed.error.flatten().fieldErrors } }, 422);
  }

  const submission = await context.env.DB.prepare(`SELECT id, submitted_by, status FROM submissions WHERE id=?`)
    .bind(context.req.param('id')).first<{ id: string; submitted_by: string; status: string }>();
  if (!submission) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }, 404);
  if (submission.status !== 'pending') return context.json({ ok: false, error: { code: 'ALREADY_REVIEWED', message: 'This submission already has a decision' } }, 409);
  if (submission.submitted_by === parsed.data.reviewerId) {
    return context.json({ ok: false, error: { code: 'SELF_REVIEW_FORBIDDEN', message: 'A submitter cannot be assigned as their own reviewer' } }, 403);
  }

  const reviewer = await context.env.DB.prepare(`SELECT u.id, u.display_name AS name FROM users u
    WHERE u.id=? AND u.archived_at IS NULL AND u.status='active'
      AND EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = u.id AND rp.permission_id = 'perm_review_admin'
      )`).bind(parsed.data.reviewerId).first<{ id: string; name: string }>();
  if (!reviewer) return context.json({ ok: false, error: { code: 'INVALID_REVIEWER', message: 'The selected user cannot perform administrative reviews' } }, 422);

  const rubricId = parsed.data.rubricId ?? null;
  if (rubricId) {
    const rubric = await context.env.DB.prepare(`SELECT id, name FROM review_rubrics WHERE id=? AND active=1`)
      .bind(rubricId).first<{ id: string; name: string }>();
    if (!rubric) return context.json({ ok: false, error: { code: 'INVALID_RUBRIC', message: 'The selected rubric is not active' } }, 422);
  }

  const assigner = context.get('user');
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE submissions SET assigned_reviewer_id=?, assigned_by=?, assigned_at=unixepoch(), rubric_id=?, updated_at=unixepoch() WHERE id=?`)
      .bind(reviewer.id, assigner.id, rubricId, submission.id),
    context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
      VALUES (?, ?, 'review.assigned', 'Review assigned to you', ?, 'submission', ?)`)
      .bind(crypto.randomUUID(), reviewer.id, `${assigner.displayName} assigned you a pending submission review.`, submission.id),
    audit(context.env, assigner.id, 'review.assigned', 'submission', submission.id, { reviewerId: reviewer.id, rubricId }),
  ]);

  return context.json({ ok: true, data: { reviewerId: reviewer.id, reviewerName: reviewer.name, rubricId } });
});

reviewRoutes.delete('/:id/assignment', async (context) => {
  const submission = await context.env.DB.prepare(`SELECT id, status FROM submissions WHERE id=?`)
    .bind(context.req.param('id')).first<{ id: string; status: string }>();
  if (!submission) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }, 404);
  if (submission.status !== 'pending') return context.json({ ok: false, error: { code: 'ALREADY_REVIEWED', message: 'This submission already has a decision' } }, 409);

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE submissions SET assigned_reviewer_id=NULL, assigned_by=NULL, assigned_at=NULL, rubric_id=NULL, updated_at=unixepoch() WHERE id=?`)
      .bind(submission.id),
    audit(context.env, context.get('user').id, 'review.assignment_cleared', 'submission', submission.id),
  ]);
  return context.json({ ok: true, data: { cleared: true } });
});

reviewRoutes.post('/:id', async (context) => {
  const parsed = reviewDecisionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Review details are invalid', fields: parsed.error.flatten().fieldErrors } }, 422);

  const submission = await context.env.DB.prepare(`SELECT s.id, s.task_id, s.checkpoint_id, s.submitted_by, s.status,
      t.project_id, t.assignee_id AS task_assignee_id, c.owner_id AS checkpoint_owner_id,
      s.assigned_reviewer_id, s.rubric_id
    FROM submissions s
    LEFT JOIN tasks t ON t.id = s.task_id
    LEFT JOIN checkpoints c ON c.id = s.checkpoint_id
    WHERE s.id=?`).bind(context.req.param('id')).first<ReviewTarget>();
  if (!submission) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Submission not found' } }, 404);
  if (submission.status !== 'pending') return context.json({ ok: false, error: { code: 'ALREADY_REVIEWED', message: 'This submission already has a decision' } }, 409);

  const reviewer = context.get('user');
  if (submission.submitted_by === reviewer.id) return context.json({ ok: false, error: { code: 'SELF_APPROVAL_FORBIDDEN', message: 'You cannot administratively review your own submission' } }, 403);
  if (submission.assigned_reviewer_id && submission.assigned_reviewer_id !== reviewer.id && !reviewer.roles.includes('super_admin')) {
    return context.json({ ok: false, error: { code: 'REVIEWER_ASSIGNED', message: 'This submission is assigned to another reviewer' } }, 403);
  }

  const rubricId = parsed.data.rubricId ?? submission.rubric_id ?? null;
  let scoresJson = '[]';
  let totalScore: number | null = null;
  if (rubricId) {
    const rubric = await context.env.DB.prepare(`SELECT id FROM review_rubrics WHERE id=? AND active=1`)
      .bind(rubricId).first<{ id: string }>();
    if (!rubric) return context.json({ ok: false, error: { code: 'INVALID_RUBRIC', message: 'The selected rubric is not active' } }, 422);
    const criteria = await context.env.DB.prepare(`SELECT id, label, weight FROM review_rubric_criteria WHERE rubric_id=? ORDER BY sort_order`)
      .bind(rubricId).all<{ id: string; label: string; weight: number }>();
    if (criteria.results.length === 0) {
      return context.json({ ok: false, error: { code: 'RUBRIC_EMPTY', message: 'The selected rubric has no criteria' } }, 422);
    }
    const scoreByCriterion = new Map(parsed.data.scores.map((score) => [score.criterionId, score.points]));
    const missing = criteria.results.filter((criterion) => !scoreByCriterion.has(criterion.id));
    if (missing.length > 0) {
      return context.json({ ok: false, error: { code: 'RUBRIC_SCORES_REQUIRED', message: 'Score every rubric criterion before deciding' } }, 422);
    }
    const unknownCriterion = parsed.data.scores.find((score) => !criteria.results.some((criterion) => criterion.id === score.criterionId));
    if (unknownCriterion) {
      return context.json({ ok: false, error: { code: 'RUBRIC_MISMATCH', message: 'A submitted score does not belong to this rubric' } }, 422);
    }
    const total = criteria.results.reduce((sum, criterion) => sum + (scoreByCriterion.get(criterion.id) ?? 0) * criterion.weight / 100, 0);
    totalScore = Math.round(total * 100) / 100;
    scoresJson = JSON.stringify(criteria.results.map((criterion) => ({
      criterionId: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      points: scoreByCriterion.get(criterion.id) ?? 0,
    })));
  } else if (parsed.data.scores.length > 0) {
    return context.json({ ok: false, error: { code: 'RUBRIC_REQUIRED', message: 'Scores require a rubric' } }, 422);
  }

  const approved = parsed.data.result === 'approved';
  const targetType = submission.checkpoint_id ? 'checkpoint' : 'task';
  const reviewId = crypto.randomUUID();
  const approvedAt = approved ? Math.floor(Date.now() / 1000) : null;
  const statements = [
    context.env.DB.prepare(`INSERT INTO reviews (id, submission_id, reviewer_id, result, feedback, rubric_id, scores_json, total_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(reviewId, submission.id, reviewer.id, parsed.data.result, parsed.data.feedback, rubricId, scoresJson, totalScore),
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
    rubricId,
    totalScore,
  }));
  statements.push(...workspaceEventStatements(context.env, {
    type: `review.${parsed.data.result}`,
    userIds: [submission.submitted_by],
    payload: { submissionId: submission.id, taskId: submission.task_id, checkpointId: submission.checkpoint_id, targetType },
  }));

  try {
    await context.env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) {
      return context.json({ ok: false, error: { code: 'ALREADY_REVIEWED', message: 'This submission already has a decision' } }, 409);
    }
    throw error;
  }
  return context.json({ ok: true, data: { reviewId, result: parsed.data.result, targetType, rubricId, totalScore } });
});
