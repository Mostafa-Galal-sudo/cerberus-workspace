import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  SUPERVISOR_EMAIL,
  call,
  createTask,
  databaseValue,
  login,
  readBody,
  readData,
  seedUsers,
  type Session,
} from './helpers';

describe('task discussion comments', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;
  let supervisor: Session;
  let taskId: string;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
    supervisor = await login(SUPERVISOR_EMAIL);
    taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Comment-enabled integration task' });
  });

  it('allows the assignee and administrators to comment but not other members or supervisors', async () => {
    const byAssignee = await call(member, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'I reproduced the parser defect and attached the failing frame capture.' }),
    });
    expect(byAssignee.status).toBe(201);

    const byAdmin = await call(admin, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Confirmed. Please include the corrected parse path in the next evidence package.' }),
    });
    expect(byAdmin.status).toBe(201);

    const byOtherMember = await call(memberTwo, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'This member is not assigned to the task and must be rejected.' }),
    });
    expect(byOtherMember.status).toBe(403);

    const bySupervisor = await call(supervisor, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Supervisors use the dedicated feedback channel.' }),
    });
    expect(bySupervisor.status).toBe(403);
  });

  it('lists comments with author identity for workspace readers', async () => {
    const response = await call(memberTwo, `/api/v1/tasks/${taskId}/comments`);
    expect(response.status).toBe(200);
    const comments = await readData<Array<{ id: string; body: string; authorName: string; authorId: string }>>(response);
    expect(comments).toHaveLength(2);
    expect(comments.map((comment) => comment.authorName)).toEqual(expect.arrayContaining(['Member One', 'Admin Sentinel']));
  });

  it('enforces author-only editing while allowing administrators to moderate', async () => {
    const list = await readData<Array<{ id: string; authorId: string; body: string }>>(await call(admin, `/api/v1/tasks/${taskId}/comments`));
    const memberComment = list.find((comment) => comment.authorId === MEMBER_ID)!;

    const authorEdit = await call(member, `/api/v1/tasks/${taskId}/comments/${memberComment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Updated: the corrected parser path now preserves the RSSI field.' }),
    });
    expect(authorEdit.status).toBe(200);

    const otherEdit = await call(memberTwo, `/api/v1/tasks/${taskId}/comments/${memberComment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Unauthorized body replacement.' }),
    });
    expect(otherEdit.status).toBe(403);

    const edited = await readData<Array<{ id: string; body: string; edited: boolean }>>(await call(admin, `/api/v1/tasks/${taskId}/comments`));
    const updated = edited.find((comment) => comment.id === memberComment.id);
    expect(updated?.body).toContain('preserves the RSSI field');

    const adminDelete = await call(admin, `/api/v1/tasks/${taskId}/comments/${memberComment.id}`, { method: 'DELETE' });
    expect(adminDelete.status).toBe(200);

    const remaining = await readData<Array<{ id: string }>>(await call(member, `/api/v1/tasks/${taskId}/comments`));
    expect(remaining.some((comment) => comment.id === memberComment.id)).toBe(false);

    const row = await databaseValue<{ body: string; deleted_at: number | null }>(`SELECT body, deleted_at FROM task_comments WHERE id=?`, memberComment.id);
    expect(row?.body).toBe('[deleted]');
    expect(row?.deleted_at).toBeGreaterThan(0);
  });

  it('validates comment length and rejects cross-task parent references', async () => {
    const empty = await call(member, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: '   ' }),
    });
    expect(empty.status).toBe(422);

    const tooLong = await call(member, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'x'.repeat(4001) }),
    });
    expect(tooLong.status).toBe(422);

    const otherTask = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Separate comment task' });
    const otherComment = await call(member, `/api/v1/tasks/${otherTask}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Comment on the second task.' }),
    });
    const otherId = (await readData<{ id: string }>(otherComment)).id;

    const crossTaskParent = await call(member, `/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Reply with a foreign parent.', parentId: otherId }),
    });
    expect(crossTaskParent.status).toBe(422);
    expect((await readBody(crossTaskParent)).error?.code).toBe('PARENT_NOT_FOUND');

    const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM task_comments WHERE task_id=?`).bind(taskId).first<{ count: number }>();
    expect(total?.count).toBeGreaterThan(0);
  });
});
