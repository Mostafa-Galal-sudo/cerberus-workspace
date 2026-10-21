import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  SUPERVISOR_EMAIL,
  TEMP_ID,
  call,
  completeChecklist,
  createTask,
  databaseValue,
  login,
  readBody,
  readData,
  seedUsers,
  taskSubmission,
  type Session,
} from './helpers';

describe('users, dashboard, invitations and notifications', () => {
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
  });

  it('protects the final super-admin from role removal', async () => {
    const response = await call(admin, `/api/v1/users/${ADMIN_ID}/roles`, {
      method: 'PATCH',
      body: JSON.stringify({ roles: ['team_member'] }),
    });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('LAST_ADMIN_PROTECTED');
  });

  it('applies role changes immediately across an existing session', async () => {
    const grant = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/roles`, {
      method: 'PATCH',
      body: JSON.stringify({ roles: ['super_admin', 'team_member'] }),
    });
    expect(grant.status).toBe(200);

    const elevated = await call(memberTwo, '/api/v1/admin/metrics');
    expect(elevated.status).toBe(200);

    const revoke = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/roles`, {
      method: 'PATCH',
      body: JSON.stringify({ roles: ['team_member'] }),
    });
    expect(revoke.status).toBe(200);

    const denied = await call(memberTwo, '/api/v1/admin/metrics');
    expect(denied.status).toBe(403);
  });

  it('reissues invitations and activates an account with a one-time token', async () => {
    const invitation = await call(admin, `/api/v1/users/${TEMP_ID}/reissue-invitation`, { method: 'POST' });
    expect(invitation.status).toBe(200);
    const data = await readData<{ token: string; activationUrl: string; expiresAt: number }>(invitation);
    expect(data.token.length).toBeGreaterThanOrEqual(32);
    expect(data.activationUrl).toContain(encodeURIComponent(data.token));

    const invalid = await call(null, '/api/v1/auth/activate', {
      method: 'POST',
      body: JSON.stringify({ token: 'x'.repeat(40), password: 'Activated!Pass2026' }),
    });
    expect(invalid.status).toBe(400);

    const activation = await call(null, '/api/v1/auth/activate', {
      method: 'POST',
      body: JSON.stringify({ token: data.token, password: 'Activated!Pass2026' }),
    });
    expect(activation.status).toBe(201);

    const activated = await readData<{ csrfToken: string; mustChangePassword: boolean }>(activation);
    expect(activated.mustChangePassword).toBe(false);

    const loginResponse = await call(null, '/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'temp@cerberus.test', password: 'Activated!Pass2026' }),
    });
    expect(loginResponse.status).toBe(200);

    const mustChange = await databaseValue<{ must_change_password: number }>(`SELECT must_change_password FROM users WHERE id=?`, TEMP_ID);
    expect(mustChange?.must_change_password).toBe(0);
  });

  it('restricts profile edits to the owner or an administrator', async () => {
    const own = await call(member, `/api/v1/users/${MEMBER_ID}/profile`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Member One Updated', bio: 'Firmware verification owner.' }),
    });
    expect(own.status).toBe(200);

    const updated = await databaseValue<{ display_name: string }>(`SELECT display_name FROM users WHERE id=?`, MEMBER_ID);
    expect(updated?.display_name).toBe('Member One Updated');

    const crossEdit = await call(memberTwo, `/api/v1/users/${MEMBER_ID}/profile`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Hijacked Name' }),
    });
    expect(crossEdit.status).toBe(403);

    const adminEdit = await call(admin, `/api/v1/users/${MEMBER_TWO_ID}/profile`, {
      method: 'PATCH',
      body: JSON.stringify({ bio: 'Network security verification owner.' }),
    });
    expect(adminEdit.status).toBe(200);
  });

  it('prevents an administrator from suspending their own account', async () => {
    const response = await call(admin, `/api/v1/users/${ADMIN_ID}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'suspended' }),
    });
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('SELF_SUSPEND_FORBIDDEN');
  });

  it('scopes dashboard summaries and member progress by role', async () => {
    const adminSummary = await call(admin, '/api/v1/dashboard/summary');
    expect(adminSummary.status).toBe(200);
    const adminData = await readData<{ mode: string; members: unknown[]; pendingReviews: number }>(adminSummary);
    expect(adminData.mode).toBe('admin');
    expect(Array.isArray(adminData.members)).toBe(true);

    const memberSummary = await call(member, '/api/v1/dashboard/summary');
    expect(memberSummary.status).toBe(200);
    expect((await readData<{ mode: string }>(memberSummary)).mode).toBe('member');

    const supervisorSummary = await call(supervisor, '/api/v1/dashboard/summary');
    expect(supervisorSummary.status).toBe(200);
    expect((await readData<{ mode: string }>(supervisorSummary)).mode).toBe('supervisor');

    const ownProgress = await call(member, `/api/v1/dashboard/members/${MEMBER_ID}`);
    expect(ownProgress.status).toBe(200);

    const otherProgress = await call(member, `/api/v1/dashboard/members/${MEMBER_TWO_ID}`);
    expect(otherProgress.status).toBe(403);

    const supervisorProgress = await call(supervisor, `/api/v1/dashboard/members/${MEMBER_TWO_ID}`);
    expect(supervisorProgress.status).toBe(200);
  });

  it('returns roadmap summaries and member roadmaps', async () => {
    const all = await call(admin, '/api/v1/users/roadmaps/all');
    expect(all.status).toBe(200);
    const members = await readData<Array<{ id: string; totalCheckpoints: number }>>(all);
    expect(members.some((entry) => entry.id === MEMBER_ID)).toBe(true);

    const memberRoadmap = await call(member, `/api/v1/users/roadmaps/member/${MEMBER_ID}`);
    expect(memberRoadmap.status).toBe(200);
    const roadmap = await readData<{ member: { id: string }; checkpoints: unknown[]; tasks: unknown[] }>(memberRoadmap);
    expect(roadmap.member.id).toBe(MEMBER_ID);
    expect(Array.isArray(roadmap.checkpoints)).toBe(true);
    expect(Array.isArray(roadmap.tasks)).toBe(true);
  });

  it('delivers review notifications to administrators and marks them read', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Notification delivery task' });
    await completeChecklist(member, taskId);
    const submission = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
      method: 'POST',
      body: JSON.stringify(taskSubmission(1)),
    });
    expect(submission.status).toBe(201);
    const submissionId = (await readData<{ id: string }>(submission)).id;

    const notifications = await call(admin, '/api/v1/collaboration/notifications');
    expect(notifications.status).toBe(200);
    const rows = await readData<Array<{ id: string; type: string; resource_id: string; read_at: number | null }>>(notifications);
    const reviewNotification = rows.find((row) => row.type === 'review.requested' && row.resource_id === submissionId);
    expect(reviewNotification).toBeDefined();
    expect(reviewNotification?.read_at).toBeNull();

    const read = await call(admin, `/api/v1/collaboration/notifications/${reviewNotification!.id}/read`, { method: 'POST' });
    expect(read.status).toBe(200);

    const after = await databaseValue<{ read_at: number | null }>(`SELECT read_at FROM notifications WHERE id=?`, reviewNotification!.id);
    expect(after?.read_at).toBeGreaterThan(0);
  });

  it('revokes the active session on logout', async () => {
    const ephemeral = await login(MEMBER_EMAIL);
    const logout = await call(ephemeral, '/api/v1/auth/logout', { method: 'POST' });
    expect(logout.status).toBe(200);
    const after = await call(ephemeral, '/api/v1/auth/me');
    expect(after.status).toBe(401);
  });
});
