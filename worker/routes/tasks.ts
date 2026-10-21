import { Hono } from 'hono';
import { createTaskSchema, submissionSchema, updateTaskStatusSchema } from '../../shared/schemas/tasks';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { workspaceEventStatements } from '../services/events';
import type { Env, Variables } from '../types';

export const taskRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
taskRoutes.use('*', requireAuth, requirePasswordChanged);

taskRoutes.get('/checkpoints', async (context) => {
  const ownerId = context.req.query('ownerId');
  const conditions = ['c.archived_at IS NULL'];
  const bindings: unknown[] = [];
  if (ownerId) {
    conditions.push('c.owner_id = ?');
    bindings.push(ownerId);
  }

  const rows = await context.env.DB.prepare(`SELECT c.id, c.title, c.description, c.required_deliverable AS requiredDeliverable,
    c.acceptance_criteria AS acceptanceCriteria, c.evidence_requirements AS evidenceRequirements,
    c.validation_procedure AS validationProcedure, c.status, c.approved_at AS approvedAt,
    m.id AS milestoneId, m.title AS milestoneTitle,
    d.id AS domainId, d.name AS domainName,
    u.id AS ownerId, u.display_name AS ownerName,
    (SELECT COUNT(*) FROM checkpoint_tasks ct JOIN tasks t ON t.id=ct.task_id WHERE ct.checkpoint_id=c.id AND t.archived_at IS NULL) AS taskCount,
    (SELECT COUNT(*) FROM checkpoint_tasks ct JOIN tasks t ON t.id=ct.task_id WHERE ct.checkpoint_id=c.id AND t.status='approved' AND t.archived_at IS NULL) AS approvedTaskCount
    FROM checkpoints c
    JOIN milestones m ON m.id=c.milestone_id
    LEFT JOIN engineering_domains d ON d.id=m.domain_id
    LEFT JOIN users u ON u.id=c.owner_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.sort_order, c.created_at`).bind(...bindings).all();

  return context.json({ ok: true, data: rows.results });
});

taskRoutes.get('/checkpoints/:id', async (context) => {
  const checkpoint = await context.env.DB.prepare(`SELECT c.*, m.title AS milestone_title, d.name AS domain_name, u.display_name AS owner_name
    FROM checkpoints c
    JOIN milestones m ON m.id=c.milestone_id
    LEFT JOIN engineering_domains d ON d.id=m.domain_id
    LEFT JOIN users u ON u.id=c.owner_id
    WHERE c.id=? AND c.archived_at IS NULL`).bind(context.req.param('id')).first();

  if (!checkpoint) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Checkpoint not found' } }, 404);

  const [tasks, submissions] = await Promise.all([
    context.env.DB.prepare(`SELECT t.id, t.title, t.priority, t.status, t.assignee_id AS assigneeId, u.display_name AS assigneeName
      FROM checkpoint_tasks ct
      JOIN tasks t ON t.id=ct.task_id
      LEFT JOIN users u ON u.id=t.assignee_id
      WHERE ct.checkpoint_id=? AND t.archived_at IS NULL`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT s.*, u.display_name AS submitted_by_name
      FROM submissions s JOIN users u ON u.id=s.submitted_by
      WHERE s.checkpoint_id=? ORDER BY s.version DESC`).bind(context.req.param('id')).all(),
  ]);

  return context.json({ ok: true, data: { checkpoint, tasks: tasks.results, submissions: submissions.results } });
});

taskRoutes.post('/checkpoints/:id/submissions', async (context) => {
  const parsed = submissionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Submission requires a summary and evidence', fields: parsed.error.flatten().fieldErrors } }, 422);

  const checkpointId = context.req.param('id');
  const checkpoint = await context.env.DB.prepare(`SELECT c.id, c.owner_id, c.status FROM checkpoints c WHERE c.id=? AND c.archived_at IS NULL`).bind(checkpointId).first<{ id: string; owner_id: string; status: string }>();
  if (!checkpoint) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Checkpoint not found' } }, 404);

  if (checkpoint.status === 'ready_for_review' || checkpoint.status === 'approved') {
    return context.json({ ok: false, error: { code: 'ALREADY_SUBMITTED', message: 'This checkpoint has already been submitted for review' } }, 409);
  }

  const user = context.get('user');
  if (!user.permissions.includes('task.work') && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to submit checkpoints' } }, 403);
  }
  if (checkpoint.owner_id !== user.id && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the checkpoint owner or an administrator can submit for checkpoint review' } }, 403);
  }

  const [pendingTasks, taskCount] = await Promise.all([
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM checkpoint_tasks ct JOIN tasks t ON t.id=ct.task_id WHERE ct.checkpoint_id=? AND t.status <> 'approved' AND t.archived_at IS NULL`).bind(checkpointId).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM checkpoint_tasks ct JOIN tasks t ON t.id=ct.task_id WHERE ct.checkpoint_id=? AND t.archived_at IS NULL`).bind(checkpointId).first<{ count: number }>(),
  ]);
  if ((taskCount?.count ?? 0) === 0) {
    return context.json({ ok: false, error: { code: 'TASKS_INCOMPLETE', message: 'This checkpoint has no mandatory tasks to submit' } }, 409);
  }
  if ((pendingTasks?.count ?? 0) > 0) {
    return context.json({ ok: false, error: { code: 'TASKS_INCOMPLETE', message: 'All mandatory checkpoint tasks must be approved first' } }, 409);
  }

  const submissionId = crypto.randomUUID();

  const statements = [
    context.env.DB.prepare(`INSERT INTO submissions (id, checkpoint_id, submitted_by, summary, version)
      SELECT ?, ?, ?, ?, COALESCE(MAX(version),0)+1 FROM submissions WHERE checkpoint_id=?`).bind(submissionId, checkpointId, user.id, parsed.data.summary, checkpointId),
    context.env.DB.prepare(`UPDATE checkpoints SET status='ready_for_review', updated_at=unixepoch() WHERE id=?`).bind(checkpointId),
    audit(context.env, user.id, 'checkpoint.submitted', 'submission', submissionId, { checkpointId }),
  ];

  for (const evidence of parsed.data.evidence) {
    statements.push(context.env.DB.prepare(`INSERT INTO submission_evidence (id, submission_id, kind, label, value) VALUES (?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), submissionId, evidence.kind, evidence.label, evidence.value));
  }

  statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
    SELECT lower(hex(randomblob(16))), user_id, 'review.requested', 'Checkpoint ready for review', ?, 'submission', ?
    FROM user_roles WHERE role_id='role_admin'`).bind(`Checkpoint ${checkpointId} submitted for review.`, submissionId));

  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { id: submissionId } }, 201);
});

taskRoutes.get('/', async (context) => {
  const user = context.get('user');
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 50)));
  const status = context.req.query('status');
  const mine = context.req.query('mine') === 'true';
  const search = context.req.query('search')?.trim();
  const domainId = context.req.query('domainId');

  const conditions = ['t.archived_at IS NULL'];
  const bindings: unknown[] = [];
  if (status) { conditions.push('t.status = ?'); bindings.push(status); }
  if (mine) { conditions.push('t.assignee_id = ?'); bindings.push(user.id); }
  if (domainId) { conditions.push('t.domain_id = ?'); bindings.push(domainId); }
  if (search) { conditions.push('(t.title LIKE ? OR t.description LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`); }

  const where = conditions.join(' AND ');
  const rows = await context.env.DB.prepare(`SELECT t.id, t.title, t.description, t.priority, t.status, t.assignee_id AS assigneeId,
      t.domain_id AS domainId, t.updated_at AS updatedAt, u.display_name AS assigneeName, d.name AS domainName,
      (SELECT COUNT(*) FROM task_checklist_items c WHERE c.task_id=t.id) AS checklistTotal,
      (SELECT COUNT(*) FROM task_checklist_items c WHERE c.task_id=t.id AND c.completed_at IS NOT NULL) AS checklistDone,
      (SELECT COUNT(*) FROM task_dependencies td WHERE td.task_id=t.id) AS dependencyCount
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN engineering_domains d ON d.id=t.domain_id
    WHERE ${where} ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.updated_at DESC
    LIMIT ? OFFSET ?`).bind(...bindings, limit, (page - 1) * limit).all();

  const total = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t WHERE ${where}`).bind(...bindings).first<{ count: number }>();
  return context.json({ ok: true, data: rows.results, meta: { page, limit, total: total?.count ?? 0 } });
});

taskRoutes.get('/:id', async (context) => {
  const task = await context.env.DB.prepare(`SELECT t.*, u.display_name AS assignee_name, d.name AS domain_name
    FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN engineering_domains d ON d.id=t.domain_id
    WHERE t.id=? AND t.archived_at IS NULL`).bind(context.req.param('id')).first();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  const [checklist, dependencies, dependents, submissions, availableTasks] = await Promise.all([
    context.env.DB.prepare(`SELECT * FROM task_checklist_items WHERE task_id=? ORDER BY sort_order`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id=td.depends_on_task_id WHERE td.task_id=?`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT t.id, t.title, t.status, t.priority FROM task_dependencies td JOIN tasks t ON t.id=td.task_id WHERE td.depends_on_task_id=? AND t.archived_at IS NULL`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT s.*, u.display_name AS submitted_by_name FROM submissions s JOIN users u ON u.id=s.submitted_by WHERE s.task_id=? ORDER BY s.version DESC`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT t.id, t.title FROM tasks t WHERE t.id <> ? AND t.archived_at IS NULL ORDER BY t.title LIMIT 100`).bind(context.req.param('id')).all(),
  ]);

  return context.json({
    ok: true,
    data: {
      task,
      checklist: checklist.results,
      dependencies: dependencies.results,
      dependents: dependents.results,
      submissions: submissions.results,
      availableTasks: availableTasks.results,
    },
  });
});

taskRoutes.post('/', requirePermission('task.manage'), async (context) => {
  const parsed = createTaskSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Task details are incomplete', fields: parsed.error.flatten().fieldErrors } }, 422);

  const id = `task_${crypto.randomUUID()}`;
  const input = parsed.data;
  const statements = [
    context.env.DB.prepare(`INSERT INTO tasks
      (id, project_id, domain_id, assignee_id, parent_task_id, created_by, title, description, prerequisites, inputs,
       implementation_steps, required_tools, expected_outputs, deliverables, acceptance_criteria, validation_procedure,
       evidence_requirements, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.projectId, input.domainId ?? null, input.assigneeId ?? null, input.parentTaskId ?? null,
        context.get('user').id, input.title, input.description, input.prerequisites, input.inputs, input.implementationSteps,
        input.requiredTools, input.expectedOutputs, input.deliverables, input.acceptanceCriteria, input.validationProcedure,
        input.evidenceRequirements, input.priority),
    context.env.DB.prepare(`INSERT INTO progress_events (id, project_id, user_id, event_type, resource_type, resource_id, total_delta, actor_id)
      VALUES (?, ?, ?, 'task.created', 'task', ?, 1, ?)`).bind(crypto.randomUUID(), input.projectId, input.assigneeId ?? null, id, context.get('user').id),
    audit(context.env, context.get('user').id, 'task.created', 'task', id),
  ];

  if (input.assigneeId) {
    statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
      VALUES (?, ?, 'task.assigned', 'New task assigned', ?, 'task', ?)`)
      .bind(crypto.randomUUID(), input.assigneeId, `You were assigned: ${input.title}`, id));
    statements.push(...workspaceEventStatements(context.env, {
      type: 'task.assigned',
      userIds: [input.assigneeId],
      payload: { taskId: id, title: input.title },
    }));
  }

  if (input.checkpointId) {
    statements.push(context.env.DB.prepare(`INSERT INTO checkpoint_tasks (checkpoint_id, task_id) VALUES (?, ?)`).bind(input.checkpointId, id));
  }

  // Seed standard checklist items
  for (const [idx, label] of ['Confirm requirements and interface boundaries', 'Implement core unit logic and tests', 'Validate against acceptance criteria', 'Compile and attach review evidence'].entries()) {
    statements.push(context.env.DB.prepare(`INSERT INTO task_checklist_items (id, task_id, title, sort_order) VALUES (?, ?, ?, ?)`).bind(`${id}_item_${idx + 1}`, id, label, idx));
  }

  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { id } }, 201);
});

taskRoutes.patch('/:id', requirePermission('task.manage'), async (context) => {
  const taskId = context.req.param('id');
  const task = await context.env.DB.prepare(`SELECT id, title, assignee_id FROM tasks WHERE id=? AND archived_at IS NULL`).bind(taskId).first<{ id: string; title: string; assignee_id: string | null }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  const rawBody = await context.req.json().catch(() => ({}));
  const body: Record<string, unknown> = typeof rawBody === 'object' && rawBody !== null ? (rawBody as Record<string, unknown>) : {};
  const allowedFields: Record<string, string> = {
    title: 'title',
    description: 'description',
    priority: 'priority',
    assigneeId: 'assignee_id',
    domainId: 'domain_id',
    prerequisites: 'prerequisites',
    inputs: 'inputs',
    implementationSteps: 'implementation_steps',
    requiredTools: 'required_tools',
    expectedOutputs: 'expected_outputs',
    deliverables: 'deliverables',
    acceptanceCriteria: 'acceptance_criteria',
    validationProcedure: 'validation_procedure',
    evidenceRequirements: 'evidence_requirements',
  };

  const updates: string[] = [];
  const binds: unknown[] = [];

  for (const [key, column] of Object.entries(allowedFields)) {
    if (key in body && body[key] !== undefined) {
      updates.push(`${column} = ?`);
      binds.push(body[key]);
    }
  }

  if (updates.length === 0) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'No valid task fields to update' } }, 422);
  }

  updates.push('updated_at = unixepoch()');
  binds.push(taskId);

  const nextAssignee = typeof body.assigneeId === 'string' && body.assigneeId.trim() ? body.assigneeId.trim() : null;
  const assignmentChanged = Object.prototype.hasOwnProperty.call(body, 'assigneeId') && nextAssignee !== task.assignee_id;
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...binds),
    audit(context.env, context.get('user').id, 'task.updated', 'task', taskId),
  ];

  if (assignmentChanged && nextAssignee) {
    statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
      VALUES (?, ?, 'task.assigned', 'Task assigned to you', ?, 'task', ?)`)
      .bind(crypto.randomUUID(), nextAssignee, `You were assigned: ${task.title}`, taskId));
    statements.push(...workspaceEventStatements(context.env, {
      type: 'task.assigned',
      userIds: [nextAssignee],
      payload: { taskId, title: task.title },
    }));
  }

  await context.env.DB.batch(statements);

  return context.json({ ok: true, data: { updated: true } });
});

taskRoutes.delete('/:id', requirePermission('task.manage'), async (context) => {
  const taskId = context.req.param('id');
  const task = await context.env.DB.prepare(`SELECT id, title FROM tasks WHERE id=? AND archived_at IS NULL`).bind(taskId).first();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE tasks SET archived_at = unixepoch() WHERE id = ?`).bind(taskId),
    audit(context.env, context.get('user').id, 'task.archived', 'task', taskId),
  ]);

  return context.json({ ok: true, data: { archived: true } });
});

taskRoutes.post('/:id/dependencies', requirePermission('task.manage'), async (context) => {
  const taskId = context.req.param('id');
  const body = await context.req.json<{ dependsOnTaskId?: string }>().catch(() => ({} as { dependsOnTaskId?: string }));
  const dependsOnTaskId = body.dependsOnTaskId;

  if (!dependsOnTaskId) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Target task id required' } }, 422);
  if (taskId === dependsOnTaskId) return context.json({ ok: false, error: { code: 'SELF_DEPENDENCY_FORBIDDEN', message: 'A task cannot depend on itself' } }, 422);

  const [t1, t2] = await Promise.all([
    context.env.DB.prepare(`SELECT id FROM tasks WHERE id=? AND archived_at IS NULL`).bind(taskId).first(),
    context.env.DB.prepare(`SELECT id FROM tasks WHERE id=? AND archived_at IS NULL`).bind(dependsOnTaskId).first(),
  ]);
  if (!t1 || !t2) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'One or both tasks do not exist' } }, 404);

  // Cycle check: verify if dependsOnTaskId already reaches taskId
  const cycle = await context.env.DB.prepare(`WITH RECURSIVE downstream(id) AS (
    SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?
    UNION
    SELECT td.depends_on_task_id FROM task_dependencies td JOIN downstream d ON td.task_id = d.id
  )
  SELECT 1 FROM downstream WHERE id = ? LIMIT 1`).bind(dependsOnTaskId, taskId).first();

  if (cycle) {
    return context.json({ ok: false, error: { code: 'CYCLE_DETECTED', message: 'Adding this dependency would create a circular dependency cycle' } }, 409);
  }

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`).bind(taskId, dependsOnTaskId),
    audit(context.env, context.get('user').id, 'task.dependency_added', 'task', taskId, { dependsOnTaskId }),
  ]);

  return context.json({ ok: true, data: { added: true } }, 201);
});

taskRoutes.delete('/:id/dependencies/:dependsOnTaskId', requirePermission('task.manage'), async (context) => {
  const taskId = context.req.param('id');
  const dependsOnTaskId = context.req.param('dependsOnTaskId');

  await context.env.DB.batch([
    context.env.DB.prepare(`DELETE FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?`).bind(taskId, dependsOnTaskId),
    audit(context.env, context.get('user').id, 'task.dependency_removed', 'task', taskId, { dependsOnTaskId }),
  ]);

  return context.json({ ok: true, data: { removed: true } });
});

taskRoutes.patch('/:id/status', async (context) => {
  const parsed = updateTaskStatusSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid task status' } }, 422);
  const task = await context.env.DB.prepare(`SELECT assignee_id, status FROM tasks WHERE id=? AND archived_at IS NULL`).bind(context.req.param('id')).first<{ assignee_id: string | null; status: string }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  const user = context.get('user');
  if (!user.permissions.includes('task.work') && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to modify tasks' } }, 403);
  }
  if (task.assignee_id !== user.id && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the assignee or an administrator can update this task' } }, 403);
  }
  if (parsed.data.status === 'ready_for_review') {
    return context.json({ ok: false, error: { code: 'SUBMISSION_REQUIRED', message: 'Submit evidence through the review workflow' } }, 409);
  }

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE tasks SET status=?, updated_at=unixepoch() WHERE id=?`).bind(parsed.data.status, context.req.param('id')),
    audit(context.env, user.id, 'task.status_changed', 'task', context.req.param('id'), { from: task.status, to: parsed.data.status }),
  ]);
  return context.json({ ok: true, data: { status: parsed.data.status } });
});

taskRoutes.patch('/:id/checklist/:itemId', async (context) => {
  const body: { completed?: boolean } = await context.req.json<{ completed?: boolean }>().catch(() => ({}));
  const task = await context.env.DB.prepare(`SELECT assignee_id FROM tasks WHERE id=? AND archived_at IS NULL`).bind(context.req.param('id')).first<{ assignee_id: string | null }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
  const user = context.get('user');
  if (!user.permissions.includes('task.work') && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to modify task checklists' } }, 403);
  }
  if (task.assignee_id !== user.id && !user.permissions.includes('task.manage')) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Checklist is restricted to the assignee' } }, 403);
  const result = await context.env.DB.prepare(`UPDATE task_checklist_items SET completed_at=?, completed_by=?, updated_at=unixepoch() WHERE id=? AND task_id=?`)
    .bind(body.completed === true ? Math.floor(Date.now() / 1000) : null, body.completed === true ? user.id : null, context.req.param('itemId'), context.req.param('id')).run();
  if (!result.meta.changes) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Checklist item not found' } }, 404);
  return context.json({ ok: true, data: { completed: body.completed === true } });
});

taskRoutes.get('/:id/comments', async (context) => {
  const rows = await context.env.DB.prepare(`SELECT c.id, c.task_id AS taskId, c.parent_id AS parentId, c.body,
    c.created_at AS createdAt, c.updated_at AS updatedAt, c.deleted_at AS deletedAt,
    c.author_id AS authorId, u.display_name AS authorName
    FROM task_comments c JOIN users u ON u.id=c.author_id
    WHERE c.task_id=? AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC`).bind(context.req.param('id')).all<{
      id: string; taskId: string; parentId: string | null; body: string; createdAt: number;
      updatedAt: number; deletedAt: number | null; authorId: string; authorName: string;
    }>();

  return context.json({
    ok: true,
    data: rows.results.map((row) => ({ ...row, edited: row.updatedAt > row.createdAt })),
  });
});

taskRoutes.post('/:id/comments', async (context) => {
  const raw = await context.req.json<{ body?: string; parentId?: string | null }>().catch(() => ({} as { body?: string; parentId?: string | null }));
  const body = raw.body?.trim();
  if (!body || body.length < 1 || body.length > 4000) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Comment body must be between 1 and 4000 characters' } }, 422);
  }

  const task = await context.env.DB.prepare(`SELECT assignee_id FROM tasks WHERE id=? AND archived_at IS NULL`)
    .bind(context.req.param('id')).first<{ assignee_id: string | null }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  const user = context.get('user');
  if (task.assignee_id !== user.id && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the assignee or an administrator can comment on this task' } }, 403);
  }

  if (raw.parentId) {
    const parent = await context.env.DB.prepare(`SELECT id FROM task_comments WHERE id=? AND task_id=? AND deleted_at IS NULL`)
      .bind(raw.parentId, context.req.param('id')).first();
    if (!parent) return context.json({ ok: false, error: { code: 'PARENT_NOT_FOUND', message: 'Parent comment does not belong to this task' } }, 422);
  }

  const id = crypto.randomUUID();
  await context.env.DB.prepare(`INSERT INTO task_comments (id, task_id, author_id, parent_id, body) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, context.req.param('id'), user.id, raw.parentId ?? null, body).run();

  return context.json({ ok: true, data: { id } }, 201);
});

taskRoutes.patch('/:id/comments/:commentId', async (context) => {
  const raw = await context.req.json<{ body?: string }>().catch(() => ({} as { body?: string }));
  const body = raw.body?.trim();
  if (!body || body.length < 1 || body.length > 4000) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Comment body must be between 1 and 4000 characters' } }, 422);
  }

  const comment = await context.env.DB.prepare(`SELECT author_id FROM task_comments WHERE id=? AND task_id=? AND deleted_at IS NULL`)
    .bind(context.req.param('commentId'), context.req.param('id')).first<{ author_id: string }>();
  if (!comment) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);

  const user = context.get('user');
  if (comment.author_id !== user.id && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the author or an administrator can edit this comment' } }, 403);
  }

  await context.env.DB.prepare(`UPDATE task_comments SET body=?, updated_at=unixepoch() WHERE id=?`).bind(body, context.req.param('commentId')).run();
  return context.json({ ok: true, data: { updated: true } });
});

taskRoutes.delete('/:id/comments/:commentId', async (context) => {
  const comment = await context.env.DB.prepare(`SELECT author_id FROM task_comments WHERE id=? AND task_id=? AND deleted_at IS NULL`)
    .bind(context.req.param('commentId'), context.req.param('id')).first<{ author_id: string }>();
  if (!comment) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);

  const user = context.get('user');
  if (comment.author_id !== user.id && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the author or an administrator can delete this comment' } }, 403);
  }

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE task_comments SET body='[deleted]', deleted_at=unixepoch(), updated_at=unixepoch() WHERE id=?`).bind(context.req.param('commentId')),
    audit(context.env, user.id, 'task.comment_deleted', 'task_comment', context.req.param('commentId'), { taskId: context.req.param('id') }),
  ]);
  return context.json({ ok: true, data: { deleted: true } });
});

taskRoutes.post('/:id/submissions', async (context) => {
  const parsed = submissionSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Submission requires a summary and evidence', fields: parsed.error.flatten().fieldErrors } }, 422);
  const task = await context.env.DB.prepare(`SELECT id, project_id, assignee_id, status, evidence_requirements FROM tasks WHERE id=? AND archived_at IS NULL`).bind(context.req.param('id')).first<{ id: string; project_id: string; assignee_id: string | null; status: string; evidence_requirements: string }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
  const user = context.get('user');
  if (!user.permissions.includes('task.work') && !user.permissions.includes('task.manage')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to submit tasks' } }, 403);
  }
  if (task.assignee_id !== user.id) return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the assigned member can submit this task' } }, 403);
  const requiredIncomplete = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM task_checklist_items WHERE task_id=? AND required=1 AND completed_at IS NULL`).bind(task.id).first<{ count: number }>();
  if ((requiredIncomplete?.count ?? 0) > 0) return context.json({ ok: false, error: { code: 'CHECKLIST_INCOMPLETE', message: 'Complete all required checklist items before submitting' } }, 409);
  const dependencyBlocked = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM task_dependencies td JOIN tasks t ON t.id=td.depends_on_task_id WHERE td.task_id=? AND t.status <> 'approved'`).bind(task.id).first<{ count: number }>();
  if ((dependencyBlocked?.count ?? 0) > 0) return context.json({ ok: false, error: { code: 'DEPENDENCY_BLOCKED', message: 'All dependency tasks must be approved first' } }, 409);
  const latest = await context.env.DB.prepare(`SELECT COALESCE(MAX(version),0) AS version FROM submissions WHERE task_id=?`).bind(task.id).first<{ version: number }>();
  const submissionId = crypto.randomUUID();
  const statements = [
    context.env.DB.prepare(`INSERT INTO submissions (id, task_id, submitted_by, summary, version) VALUES (?, ?, ?, ?, ?)` ).bind(submissionId, task.id, user.id, parsed.data.summary, (latest?.version ?? 0) + 1),
    context.env.DB.prepare(`UPDATE tasks SET status='ready_for_review', updated_at=unixepoch() WHERE id=?`).bind(task.id),
    audit(context.env, user.id, 'task.submitted', 'submission', submissionId, { taskId: task.id }),
  ];
  for (const evidence of parsed.data.evidence) statements.push(context.env.DB.prepare(`INSERT INTO submission_evidence (id, submission_id, kind, label, value) VALUES (?, ?, ?, ?, ?)` ).bind(crypto.randomUUID(), submissionId, evidence.kind, evidence.label, evidence.value));
  statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
    SELECT lower(hex(randomblob(16))), user_id, 'review.requested', 'Task ready for review', ?, 'submission', ?
    FROM user_roles WHERE role_id='role_admin'`)
    .bind(`A submission for task ${task.id} is ready for review.`, submissionId));
  const admins = await context.env.DB.prepare(`SELECT user_id FROM user_roles WHERE role_id='role_admin'`).all<{ user_id: string }>();
  statements.push(...workspaceEventStatements(context.env, {
    type: 'review.requested',
    userIds: admins.results.map((row) => row.user_id),
    payload: { taskId: task.id, submissionId },
  }));
  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { id: submissionId } }, 201);
});
