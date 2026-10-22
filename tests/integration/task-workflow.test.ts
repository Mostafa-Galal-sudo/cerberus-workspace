import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  SUPERVISOR_ID,
  call,
  completeChecklist,
  createTask,
  databaseValue,
  login,
  readBody,
  readData,
  reviewSubmission,
  seedUsers,
  taskSubmission,
  type Session,
} from './helpers';

describe('task submission and review workflow', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
  });

  it('requires every checklist item before a task can be submitted', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Checklist gate task' });
    const response = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission()),
    });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('CHECKLIST_INCOMPLETE');
  });

  it('only allows the assigned member to submit a task', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Assignee ownership task' });
    await completeChecklist(member, taskId);
    const response = await call(memberTwo, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission()),
    });
    expect(response.status).toBe(403);
  });

  it('persists multiple evidence rows, surfaces them to reviewers and approves the task', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Multi-evidence approval task' });
    await completeChecklist(member, taskId);

    const submissionResponse = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(3)),
    });
    expect(submissionResponse.status).toBe(201);
    const submissionId = (await readData<{ id: string }>(submissionResponse)).id;

    const stored = await env.DB.prepare(`SELECT kind, label, value FROM submission_evidence WHERE submission_id=?`).bind(submissionId).all();
    expect(stored.results).toHaveLength(3);

    const queueResponse = await call(admin, '/api/v1/reviews');
    expect(queueResponse.status).toBe(200);
    const queue = await readData<Array<{
      id: string;
      targetType: string;
      taskId: string;
      taskTitle: string;
      submittedById: string;
      evidence: Array<{ kind: string; label: string; value: string }>;
    }>>(queueResponse);
    const item = queue.find((entry) => entry.id === submissionId);
    expect(item).toBeDefined();
    expect(item?.targetType).toBe('task');
    expect(item?.taskId).toBe(taskId);
    expect(item?.taskTitle).toBe('Multi-evidence approval task');
    expect(item?.submittedById).toBe(MEMBER_ID);
    expect(item?.evidence.map((entry) => entry.kind)).toEqual(['github', 'note', 'url']);

    const review = await reviewSubmission(admin, submissionId, 'approved', 'Reproduced the evidence and verified the acceptance criteria.');
    expect(review.status).toBe(200);

    const task = await databaseValue<{ status: string; approved_at: number | null }>(`SELECT status, approved_at FROM tasks WHERE id=?`, taskId);
    expect(task?.status).toBe('approved');
    expect(task?.approved_at).toBeGreaterThan(0);

    const notification = await databaseValue<{ count: number }>(`SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND type='review.approved'`, MEMBER_ID);
    expect(notification?.count).toBeGreaterThan(0);
  });

  it('prevents duplicate, post-approval and unsafe status transitions', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Workflow guard task' });
    await completeChecklist(member, taskId);

    const first = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(first.status).toBe(201);
    const submissionId = (await readData<{ id: string }>(first)).id;

    const duplicate = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(duplicate.status).toBe(409);
    expect((await readBody(duplicate)).error?.code).toBe('SUBMISSION_PENDING');

    const invalidTransition = await call(member, `/api/v1/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(invalidTransition.status).toBe(409);
    expect((await readBody(invalidTransition)).error?.code).toBe('REVIEW_DECISION_REQUIRED');

    expect((await reviewSubmission(admin, submissionId, 'approved', 'Workflow guard evidence verified.')).status).toBe(200);

    const afterApproval = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(afterApproval.status).toBe(409);
    expect((await readBody(afterApproval)).error?.code).toBe('TASK_ALREADY_APPROVED');

    const archiveStatus = await call(admin, `/api/v1/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(archiveStatus.status).toBe(409);
    expect((await readBody(archiveStatus)).error?.code).toBe('ARCHIVE_ENDPOINT_REQUIRED');

    const activeTask = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Allowed transition task' });
    const active = await call(member, `/api/v1/tasks/${activeTask}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(active.status).toBe(200);
    const regression = await call(member, `/api/v1/tasks/${activeTask}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'changes_requested' }),
    });
    expect(regression.status).toBe(409);
    expect((await readBody(regression)).error?.code).toBe('INVALID_TRANSITION');
  });

  it('rejects ineligible task assignees', async () => {
    const create = await call(admin, '/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        projectId: 'project_cerberus',
        assigneeId: SUPERVISOR_ID,
        title: 'Supervisor assignment task',
        description: 'A task must not be assigned to a read-only supervisor account.',
        acceptanceCriteria: 'Only active accounts with task.work can be assigned tasks.',
        validationProcedure: 'Attempt the assignment through the API and verify a validation error.',
        evidenceRequirements: 'The API response status and error code.',
      }),
    });
    expect(create.status).toBe(422);
    expect((await readBody(create)).error?.code).toBe('INVALID_ASSIGNEE');

    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Assignee validation task' });
    const patch = await call(admin, `/api/v1/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ assigneeId: SUPERVISOR_ID }),
    });
    expect(patch.status).toBe(422);
    expect((await readBody(patch)).error?.code).toBe('INVALID_ASSIGNEE');
  });

  it('serializes concurrent review decisions', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Concurrent review task' });
    await completeChecklist(member, taskId);
    const submission = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    const submissionId = (await readData<{ id: string }>(submission)).id;

    const decisions = await Promise.all([
      reviewSubmission(admin, submissionId, 'approved', 'Concurrent approval decision.'),
      reviewSubmission(admin, submissionId, 'changes_requested', 'Concurrent change request.'),
    ]);
    expect(decisions.map((decision) => decision.status).sort()).toEqual([200, 409]);
    const reviews = await env.DB.prepare(`SELECT COUNT(*) AS count FROM reviews WHERE submission_id=?`).bind(submissionId).first<{ count: number }>();
    expect(reviews?.count).toBe(1);
  });

  it('forbids administrative approval of your own submission', async () => {
    const taskId = await createTask(admin, { assigneeId: ADMIN_ID, title: 'Self-review protection task' });
    await completeChecklist(admin, taskId);
    const submissionResponse = await call(admin, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(submissionResponse.status).toBe(201);
    const submissionId = (await readData<{ id: string }>(submissionResponse)).id;

    const review = await reviewSubmission(admin, submissionId, 'approved', '');
    expect(review.status).toBe(403);
    expect((await readBody(review)).error?.code).toBe('SELF_APPROVAL_FORBIDDEN');

    const stillPending = await databaseValue<{ status: string }>(`SELECT status FROM submissions WHERE id=?`, submissionId);
    expect(stillPending?.status).toBe('pending');
  });

  it('blocks submissions until dependencies are approved and rejects dependency cycles', async () => {
    const dependency = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Dependency prerequisite task' });
    const dependent = await createTask(admin, {
      assigneeId: MEMBER_ID,
      title: 'Dependency gated task',
      dependencyIds: [dependency],
    });
    await completeChecklist(member, dependent);

    const blocked = await call(member, `/api/v1/tasks/${dependent}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(blocked.status).toBe(409);
    expect((await readBody(blocked)).error?.code).toBe('DEPENDENCY_BLOCKED');

    const cycle = await call(admin, `/api/v1/tasks/${dependency}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ dependsOnTaskId: dependent }),
    });
    expect(cycle.status).toBe(409);
    expect((await readBody(cycle)).error?.code).toBe('CYCLE_DETECTED');

    await completeChecklist(member, dependency);
    const dependencySubmission = await call(member, `/api/v1/tasks/${dependency}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(dependencySubmission.status).toBe(201);
    const dependencySubmissionId = (await readData<{ id: string }>(dependencySubmission)).id;
    expect((await reviewSubmission(admin, dependencySubmissionId, 'approved', 'Dependency verified.')).status).toBe(200);

    const unblocked = await call(member, `/api/v1/tasks/${dependent}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(unblocked.status).toBe(201);
  });

  it('archives tasks instead of hard-deleting them', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Archival lifecycle task' });
    const archived = await call(admin, `/api/v1/tasks/${taskId}`, { method: 'DELETE' });
    expect(archived.status).toBe(200);

    const detail = await call(admin, `/api/v1/tasks/${taskId}`);
    expect(detail.status).toBe(404);

    const row = await databaseValue<{ archived_at: number | null }>(`SELECT archived_at FROM tasks WHERE id=?`, taskId);
    expect(row?.archived_at).toBeGreaterThan(0);
  });
});
