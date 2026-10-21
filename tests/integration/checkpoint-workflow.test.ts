import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  SUPERVISOR_EMAIL,
  call,
  checkpointSubmission,
  databaseValue,
  login,
  readBody,
  readData,
  reviewSubmission,
  seedCheckpoint,
  seedUsers,
  type Session,
} from './helpers';

describe('checkpoint submission and review workflow', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;
  let supervisor: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
    supervisor = await login(SUPERVISOR_EMAIL);

    await seedCheckpoint({
      id: 'checkpoint_no_tasks',
      ownerId: MEMBER_ID,
      title: 'Checkpoint without mandatory tasks',
      tasks: [],
    });
    await seedCheckpoint({
      id: 'checkpoint_pending',
      ownerId: MEMBER_ID,
      title: 'Checkpoint with an unfinished task',
      tasks: [
        { id: 'cp_pending_task_1', status: 'approved' },
        { id: 'cp_pending_task_2', status: 'in_progress' },
      ],
    });
    await seedCheckpoint({
      id: 'checkpoint_duplicate',
      ownerId: MEMBER_ID,
      title: 'Checkpoint duplicate guard',
      tasks: [{ id: 'cp_duplicate_task_1', status: 'approved' }],
    });
    await seedCheckpoint({
      id: 'checkpoint_approve',
      ownerId: MEMBER_ID,
      title: 'Checkpoint approval path',
      tasks: [
        { id: 'cp_approve_task_1', status: 'approved' },
        { id: 'cp_approve_task_2', status: 'approved' },
      ],
    });
    await seedCheckpoint({
      id: 'checkpoint_changes',
      ownerId: MEMBER_ID,
      title: 'Checkpoint changes-requested path',
      tasks: [{ id: 'cp_changes_task_1', status: 'approved' }],
    });
    await seedCheckpoint({
      id: 'checkpoint_admin_owned',
      ownerId: ADMIN_ID,
      title: 'Administrator-owned checkpoint',
      tasks: [{ id: 'cp_admin_task_1', status: 'approved' }],
    });
  });

  it('rejects checkpoints with no mandatory tasks', async () => {
    const response = await call(member, '/api/v1/tasks/checkpoints/checkpoint_no_tasks/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission()),
    });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('TASKS_INCOMPLETE');
  });

  it('rejects checkpoints while a mandatory task is not approved', async () => {
    const response = await call(member, '/api/v1/tasks/checkpoints/checkpoint_pending/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission()),
    });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('TASKS_INCOMPLETE');
  });

  it('rejects submissions from non-owners and supervisors', async () => {
    const nonOwner = await call(memberTwo, '/api/v1/tasks/checkpoints/checkpoint_duplicate/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission()),
    });
    expect(nonOwner.status).toBe(403);

    const supervisorAttempt = await call(supervisor, '/api/v1/tasks/checkpoints/checkpoint_duplicate/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission()),
    });
    expect(supervisorAttempt.status).toBe(403);
  });

  it('prevents duplicate checkpoint submissions after review starts', async () => {
    const input = checkpointSubmission();
    const first = await call(member, '/api/v1/tasks/checkpoints/checkpoint_duplicate/submissions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    expect(first.status).toBe(201);

    const second = await call(member, '/api/v1/tasks/checkpoints/checkpoint_duplicate/submissions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    expect(second.status).toBe(409);
    expect((await readBody(second)).error?.code).toBe('ALREADY_SUBMITTED');

    const status = await databaseValue<{ status: string }>(`SELECT status FROM checkpoints WHERE id='checkpoint_duplicate'`);
    expect(status?.status).toBe('ready_for_review');
  });

  it('queues checkpoint evidence and approves the checkpoint', async () => {
    const submissionResponse = await call(member, '/api/v1/tasks/checkpoints/checkpoint_approve/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission(2)),
    });
    expect(submissionResponse.status).toBe(201);
    const submissionId = (await readData<{ id: string }>(submissionResponse)).id;

    const stored = await env.DB.prepare(`SELECT id FROM submission_evidence WHERE submission_id=?`).bind(submissionId).all();
    expect(stored.results).toHaveLength(2);

    const queueResponse = await call(admin, '/api/v1/reviews');
    const queue = await readData<Array<{
      id: string;
      targetType: string;
      taskId: string | null;
      checkpointId: string | null;
      checkpointTitle: string | null;
      evidence: Array<{ kind: string; label: string }>;
    }>>(queueResponse);
    const item = queue.find((entry) => entry.id === submissionId);
    expect(item).toBeDefined();
    expect(item?.targetType).toBe('checkpoint');
    expect(item?.taskId).toBeNull();
    expect(item?.checkpointId).toBe('checkpoint_approve');
    expect(item?.checkpointTitle).toBe('Checkpoint approval path');
    expect(item?.evidence).toHaveLength(2);

    const review = await reviewSubmission(admin, submissionId, 'approved', 'All mandatory checkpoint criteria reproduced.');
    expect(review.status).toBe(200);

    const checkpoint = await databaseValue<{ status: string; approved_at: number | null }>(`SELECT status, approved_at FROM checkpoints WHERE id='checkpoint_approve'`);
    expect(checkpoint?.status).toBe('approved');
    expect(checkpoint?.approved_at).toBeGreaterThan(0);
  });

  it('returns a checkpoint for changes and accepts a corrected resubmission', async () => {
    const first = await call(member, '/api/v1/tasks/checkpoints/checkpoint_changes/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission(1)),
    });
    expect(first.status).toBe(201);
    const firstId = (await readData<{ id: string }>(first)).id;

    const changes = await reviewSubmission(admin, firstId, 'changes_requested', 'Attach the corrected measurement trace and rerun the acceptance procedure.');
    expect(changes.status).toBe(200);

    const afterChanges = await databaseValue<{ status: string; approved_at: number | null }>(`SELECT status, approved_at FROM checkpoints WHERE id='checkpoint_changes'`);
    expect(afterChanges?.status).toBe('changes_requested');
    expect(afterChanges?.approved_at).toBeNull();

    const second = await call(member, '/api/v1/tasks/checkpoints/checkpoint_changes/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission(2)),
    });
    expect(second.status).toBe(201);
    const secondId = (await readData<{ id: string }>(second)).id;

    const version = await databaseValue<{ version: number; status: string }>(`SELECT version, status FROM submissions WHERE id=?`, secondId);
    expect(version?.version).toBe(2);
    expect(version?.status).toBe('pending');

    const review = await reviewSubmission(admin, secondId, 'approved', 'Corrected trace verified.');
    expect(review.status).toBe(200);

    const approved = await databaseValue<{ status: string }>(`SELECT status FROM checkpoints WHERE id='checkpoint_changes'`);
    expect(approved?.status).toBe('approved');
  });

  it('forbids self-approval of an administrator-owned checkpoint', async () => {
    const submission = await call(admin, '/api/v1/tasks/checkpoints/checkpoint_admin_owned/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission(1)),
    });
    expect(submission.status).toBe(201);
    const submissionId = (await readData<{ id: string }>(submission)).id;

    const review = await reviewSubmission(admin, submissionId, 'approved', '');
    expect(review.status).toBe(403);
    expect((await readBody(review)).error?.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });
});
