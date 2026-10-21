import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
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
