import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  call,
  checkpointSubmission,
  login,
  readBody,
  readData,
  reviewSubmission,
  seedCheckpoint,
  seedUsers,
  type Session,
} from './helpers';

interface DetailTask {
  id: string;
  title: string;
  status: string;
  description: string;
  prerequisites: string;
  expectedOutputs: string;
  deliverables: string;
  acceptanceCriteria: string;
  assigneeName: string | null;
  dependencies: Array<{ id: string; title: string; status: string; assigneeName: string | null }>;
}

interface DetailSubmission {
  id: string;
  summary: string;
  status: string;
  version: number;
  submittedByName: string;
  evidenceCount: number;
  reviews: Array<{ result: string; feedback: string; reviewerName: string | null }>;
}

interface DetailPayload {
  checkpoint: {
    id: string;
    title: string;
    requiredDeliverable: string;
    acceptanceCriteria: string;
    validationProcedure: string;
    ownerName: string | null;
    taskCount: number;
    approvedTaskCount: number;
    windowStart: string | null;
    windowDue: string | null;
  };
  tasks: DetailTask[];
  submissions: DetailSubmission[];
}

describe('checkpoint detail team visibility', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);

    await seedCheckpoint({
      id: 'checkpoint_detail_vis',
      ownerId: MEMBER_ID,
      title: 'Checkpoint detail visibility',
      tasks: [
        { id: 'cp_detail_task_a', status: 'approved', assigneeId: MEMBER_ID },
        { id: 'cp_detail_task_b', status: 'in_progress', assigneeId: 'user_test_member_two' },
        { id: 'cp_detail_task_c', status: 'backlog', assigneeId: MEMBER_ID },
      ],
    });
    await env.DB.prepare(
      `INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ('cp_detail_task_c', 'cp_detail_task_b')`,
    ).run();

    await seedCheckpoint({
      id: 'checkpoint_detail_submit',
      ownerId: MEMBER_ID,
      title: 'Checkpoint detail submissions',
      tasks: [
        { id: 'cp_detail_sub_task_1', status: 'approved', assigneeId: MEMBER_ID },
        { id: 'cp_detail_sub_task_2', status: 'approved', assigneeId: MEMBER_ID },
      ],
    });

    const submitted = await call(member, '/api/v1/tasks/checkpoints/checkpoint_detail_submit/submissions', {
      method: 'POST',
      body: JSON.stringify(checkpointSubmission()),
    });
    expect(submitted.status).toBe(201);
    const { id: submissionId } = await readBody<{ id: string }>(submitted).then((body) => body.data);
    await reviewSubmission(admin, submissionId, 'changes_requested', 'Evidence pack needs the benchmark table.');
  });

  it('lets any authenticated member read another member checkpoint detail', async () => {
    const response = await call(memberTwo, '/api/v1/tasks/checkpoints/checkpoint_detail_vis');
    expect(response.status).toBe(200);
    const data = await readData<DetailPayload>(response);
    expect(data.checkpoint.id).toBe('checkpoint_detail_vis');
    expect(data.checkpoint.taskCount).toBe(3);
    expect(data.checkpoint.approvedTaskCount).toBe(1);
    expect(data.checkpoint.requiredDeliverable).toBe('');
    expect(data.checkpoint.ownerName).toBeTruthy();
    expect(data.tasks).toHaveLength(3);
  });

  it('exposes full task fields, dependencies, and member attribution', async () => {
    const response = await call(memberTwo, '/api/v1/tasks/checkpoints/checkpoint_detail_vis');
    const data = await readData<DetailPayload>(response);

    const dependent = data.tasks.find((task) => task.id === 'cp_detail_task_c');
    expect(dependent).toBeDefined();
    expect(dependent?.acceptanceCriteria).toContain('Acceptance criteria');
    expect(dependent?.dependencies).toHaveLength(1);
    expect(dependent?.dependencies[0].id).toBe('cp_detail_task_b');
    expect(dependent?.dependencies[0].status).toBe('in_progress');

    const statuses = new Set(data.tasks.map((task) => task.status));
    expect(statuses).toEqual(new Set(['approved', 'in_progress', 'backlog']));
  });

  it('shows submission summaries and review results without exposing evidence values', async () => {
    const response = await call(memberTwo, '/api/v1/tasks/checkpoints/checkpoint_detail_submit');
    expect(response.status).toBe(200);
    const data = await readData<DetailPayload>(response);

    expect(data.submissions).toHaveLength(1);
    const submission = data.submissions[0];
    expect(submission.summary).toContain('Checkpoint deliverables are complete');
    expect(submission.status).toBe('changes_requested');
    expect(submission.evidenceCount).toBe(2);
    expect(submission.reviews).toHaveLength(1);
    expect(submission.reviews[0].result).toBe('changes_requested');
    expect(submission.reviews[0].feedback).toContain('benchmark table');
    expect(submission.reviews[0].reviewerName).toBeTruthy();

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('commit/def5678');
    expect(serialized).not.toContain('isolated lab');
    expect(serialized).not.toContain('"evidence"');
  });

  it('rejects unauthenticated access with 401', async () => {
    const response = await call(null, '/api/v1/tasks/checkpoints/checkpoint_detail_vis');
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown checkpoint', async () => {
    const response = await call(member, '/api/v1/tasks/checkpoints/checkpoint_missing_detail');
    expect(response.status).toBe(404);
    const body = await readBody(response);
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});
