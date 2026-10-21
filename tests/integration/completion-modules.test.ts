import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  SUPERVISOR_EMAIL,
  SUPERVISOR_ID,
  call,
  createTask,
  databaseRun,
  databaseValue,
  login,
  readBody,
  readData,
  seedCheckpoint,
  seedUsers,
  type Session,
} from './helpers';

describe('completed workspace modules', () => {
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

  it('reassigns tasks and checkpoint ownership with notification and audit evidence', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Reassignment target task' });
    await seedCheckpoint({
      id: 'checkpoint_reassign',
      ownerId: MEMBER_ID,
      title: 'Reassignment checkpoint',
      tasks: [],
    });

    const forbidden = await call(member, `/api/v1/users/${MEMBER_ID}/reassign-work`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: MEMBER_TWO_ID, taskIds: [taskId], checkpointIds: ['checkpoint_reassign'] }),
    });
    expect(forbidden.status).toBe(403);

    const response = await call(admin, `/api/v1/users/${MEMBER_ID}/reassign-work`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: MEMBER_TWO_ID, taskIds: [taskId], checkpointIds: ['checkpoint_reassign'] }),
    });
    expect(response.status).toBe(200);
    const result = await readData<{ reassignedTasks: number; reassignedCheckpoints: number; total: number; targetName: string }>(response);
    expect(result).toMatchObject({ reassignedTasks: 1, reassignedCheckpoints: 1, total: 2, targetName: 'Member Two' });

    const taskOwner = await databaseValue<{ assignee_id: string }>(`SELECT assignee_id FROM tasks WHERE id=?`, taskId);
    const checkpointOwner = await databaseValue<{ owner_id: string }>(`SELECT owner_id FROM checkpoints WHERE id=?`, 'checkpoint_reassign');
    expect(taskOwner?.assignee_id).toBe(MEMBER_TWO_ID);
    expect(checkpointOwner?.owner_id).toBe(MEMBER_TWO_ID);

    const notification = await databaseValue<{ id: string }>(`SELECT id FROM notifications
      WHERE user_id=? AND type='work.reassigned' AND resource_id=?`, MEMBER_TWO_ID, MEMBER_ID);
    expect(notification).toBeTruthy();

    const audit = await databaseValue<{ id: string }>(`SELECT id FROM audit_logs
      WHERE actor_id=? AND action='user.work_reassigned' AND resource_id=?`, ADMIN_ID, MEMBER_ID);
    expect(audit).toBeTruthy();

    const events = await readData<Array<{ eventType: string }>>(await call(memberTwo, '/api/v1/collaboration/events/poll?after=0'));
    expect(events.some((event) => event.eventType === 'work.reassigned')).toBe(true);
  });

  it('renders server-side PDF reports with an export audit row', async () => {
    const response = await call(admin, '/api/v1/reports/tasks.pdf');
    expect(response.status).toBe(404);

    const progress = await call(admin, '/api/v1/reports/progress.pdf');
    expect(progress.status).toBe(200);
    expect(progress.headers.get('content-type')).toBe('application/pdf');
    expect(progress.headers.get('content-disposition')).toContain('cerberus-progress-');
    const bytes = new Uint8Array(await progress.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    const hardware = await call(admin, '/api/v1/reports/hardware.pdf');
    expect(hardware.status).toBe(200);
    expect(hardware.headers.get('content-type')).toBe('application/pdf');

    const blockers = await call(admin, '/api/v1/reports/blockers.pdf');
    expect(blockers.status).toBe(200);
    expect(blockers.headers.get('content-type')).toBe('application/pdf');

    const exportRow = await databaseValue<{ id: string }>(`SELECT id FROM report_exports
      WHERE requested_by=? AND report_type='progress.pdf'`, ADMIN_ID);
    expect(exportRow).toBeTruthy();

    const anonymous = await call(null, '/api/v1/reports/progress.pdf');
    expect(anonymous.status).toBe(401);
  });

  it('publishes chat messages to the per-member event stream', async () => {
    const channelResponse = await call(member, '/api/v1/collaboration/channels/direct', {
      method: 'POST',
      body: JSON.stringify({ userId: MEMBER_TWO_ID }),
    });
    const channelId = (await readData<{ id: string }>(channelResponse)).id;

    const messageResponse = await call(member, `/api/v1/collaboration/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Telemetry event should reach the second member stream.' }),
    });
    expect(messageResponse.status).toBe(201);

    const events = await readData<Array<{ eventType: string; payload: { channelId?: string } }>>(
      await call(memberTwo, '/api/v1/collaboration/events/poll?after=0'),
    );
    const messageEvent = events.find((event) => event.eventType === 'message.created' && event.payload.channelId === channelId);
    expect(messageEvent).toBeTruthy();
  });

  it('stores attachments in R2 behind resource authorization and returns them as downloads', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Attachment evidence task' });
    const form = new FormData();
    form.append('file', new File(['telemetry trace payload'], 'telemetry-trace.log', { type: 'text/plain' }));
    form.append('resourceType', 'task');
    form.append('resourceId', taskId);
    form.append('label', 'Telemetry trace');

    const upload = await call(member, '/api/v1/attachments', { method: 'POST', body: form });
    expect(upload.status).toBe(201);
    const uploaded = await readData<{ id: string; checksumSha256: string; byteSize: number }>(upload);
    expect(uploaded.checksumSha256).toHaveLength(64);
    expect(uploaded.byteSize).toBeGreaterThan(0);

    const list = await readData<Array<{ id: string; storageType: string; checksumSha256: string }>>(
      await call(member, `/api/v1/attachments?resourceType=task&resourceId=${taskId}`),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ storageType: 'r2', checksumSha256: uploaded.checksumSha256 });

    const download = await call(memberTwo, `/api/v1/attachments/${uploaded.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('telemetry-trace.log');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await download.text()).toBe('telemetry trace payload');
    const downloadAudit = await databaseValue<{ id: string }>(`SELECT id FROM audit_logs
      WHERE actor_id=? AND action='attachment.downloaded' AND resource_id=?`, MEMBER_TWO_ID, uploaded.id);
    expect(downloadAudit).toBeTruthy();

    const forbiddenForm = new FormData();
    forbiddenForm.append('file', new File(['supervisor attempt'], 'supervisor.txt', { type: 'text/plain' }));
    forbiddenForm.append('resourceType', 'task');
    forbiddenForm.append('resourceId', taskId);
    const forbidden = await call(supervisor, '/api/v1/attachments', { method: 'POST', body: forbiddenForm });
    expect(forbidden.status).toBe(403);

    const archive = await call(member, `/api/v1/attachments/${uploaded.id}`, { method: 'DELETE' });
    expect(archive.status).toBe(200);
    const afterArchive = await readData<Array<{ id: string }>>(
      await call(member, `/api/v1/attachments?resourceType=task&resourceId=${taskId}`),
    );
    expect(afterArchive).toHaveLength(0);

    const archiveEvents = await readData<Array<{ eventType: string; payload: { attachmentId?: string } }>>(
      await call(member, '/api/v1/collaboration/events/poll?after=0'),
    );
    expect(archiveEvents.some((event) => event.eventType === 'attachment.archived' && event.payload.attachmentId === uploaded.id)).toBe(true);
  });

  it('restricts submission evidence to the submitter and reviewers', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Submission evidence access task' });
    await databaseRun(`INSERT INTO submissions (id, task_id, submitted_by, summary, version) VALUES (?, ?, ?, ?, 1)`,
      'submission_access', taskId, MEMBER_ID, 'Private submission evidence');
    await databaseRun(`INSERT INTO attachments (id, owner_id, resource_type, resource_id, storage_type, label, url)
      VALUES (?, ?, 'submission', ?, 'external_private_link', ?, ?)`,
      'attachment_submission_access', MEMBER_ID, 'submission_access', 'Private evidence link', 'https://example.com/private-evidence');

    const hiddenList = await call(memberTwo, '/api/v1/attachments?resourceType=submission&resourceId=submission_access');
    expect(hiddenList.status).toBe(403);
    const supervisorList = await call(supervisor, '/api/v1/attachments?resourceType=submission&resourceId=submission_access');
    expect(supervisorList.status).toBe(403);
    const hiddenDownload = await call(memberTwo, '/api/v1/attachments/attachment_submission_access/download');
    expect(hiddenDownload.status).toBe(403);

    const ownerList = await readData<Array<{ id: string }>>(
      await call(member, '/api/v1/attachments?resourceType=submission&resourceId=submission_access'),
    );
    expect(ownerList.map((row) => row.id)).toContain('attachment_submission_access');
    const reviewerList = await readData<Array<{ id: string }>>(
      await call(admin, '/api/v1/attachments?resourceType=submission&resourceId=submission_access'),
    );
    expect(reviewerList.map((row) => row.id)).toContain('attachment_submission_access');
  });

  it('accepts password recovery requests without leaking account existence', async () => {
    const known = await call(null, '/api/v1/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email: MEMBER_EMAIL }),
    });
    expect(known.status).toBe(202);
    const knownBody = await readBody<{ requested: boolean; delivery: string }>(known);
    expect(knownBody.ok).toBe(true);
    expect(knownBody.data.requested).toBe(true);

    const unknown = await call(null, '/api/v1/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email: 'missing@cerberus.test' }),
    });
    expect(unknown.status).toBe(202);
    const unknownBody = await readBody<{ requested: boolean; delivery: string }>(unknown);
    expect(unknownBody.data.delivery).toBe(knownBody.data.delivery);

    const tokenRow = await databaseValue<{ token_hash: string }>(`SELECT token_hash FROM password_reset_tokens WHERE user_id=?`, MEMBER_ID);
    expect(tokenRow?.token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenRow?.token_hash).not.toContain('=');

    const adminNotification = await databaseValue<{ id: string }>(`SELECT id FROM notifications
      WHERE user_id=? AND type='password.reset_requested'`, ADMIN_ID);
    const emailConfigured = knownBody.data.delivery === 'email';
    if (!emailConfigured) {
      expect(adminNotification).toBeTruthy();
    }
  });

  it('keeps outbound GitHub operations provider-gated', async () => {
    const status = await readData<{ authMode: string }>(await call(admin, '/api/v1/github/status'));
    expect(['app', 'token', 'none']).toContain(status.authMode);

    const missingRepo = await call(admin, '/api/v1/github/sync', { method: 'POST' });
    expect([409, 503]).toContain(missingRepo.status);

    const invalidPr = await call(admin, '/api/v1/github/pull-request', {
      method: 'POST',
      body: JSON.stringify({ taskId: '', title: '', head: '' }),
    });
    expect(invalidPr.status).toBe(422);

    const invalidRepository = await call(admin, '/api/v1/github/settings', {
      method: 'POST',
      body: JSON.stringify({ repository: 'not-a-repository' }),
    });
    expect(invalidRepository.status).toBe(422);
    const invalidBranch = await call(admin, '/api/v1/github/settings', {
      method: 'POST',
      body: JSON.stringify({ repository: 'Mostafa-Galal-sudo/cerberus-workspace', syncBranch: 'bad branch name' }),
    });
    expect(invalidBranch.status).toBe(422);

    const settings = await call(admin, '/api/v1/github/settings', {
      method: 'POST',
      body: JSON.stringify({ repository: 'Mostafa-Galal-sudo/cerberus-workspace', syncBranch: 'main', enabled: true }),
    });
    expect(settings.status).toBe(200);

    if (status.authMode === 'none') {
      const sync = await call(admin, '/api/v1/github/sync', { method: 'POST' });
      expect(sync.status).toBe(503);
      const syncBody = await readBody<unknown>(sync);
      expect(syncBody.error?.code).toBe('GITHUB_NOT_CONFIGURED');
    }

    const memberSync = await call(member, '/api/v1/github/sync', { method: 'POST' });
    expect(memberSync.status).toBe(403);
  });

  it('refuses malformed or unauthorized reassignment targets', async () => {
    const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Guarded reassignment task' });
    const sameUser = await call(admin, `/api/v1/users/${MEMBER_ID}/reassign-work`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: MEMBER_ID, taskIds: [taskId] }),
    });
    expect(sameUser.status).toBe(422);

    const empty = await call(admin, `/api/v1/users/${MEMBER_ID}/reassign-work`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: MEMBER_TWO_ID }),
    });
    expect(empty.status).toBe(422);

    const unknownTarget = await call(admin, `/api/v1/users/${MEMBER_ID}/reassign-work`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: 'user_missing', taskIds: [taskId] }),
    });
    expect(unknownTarget.status).toBe(404);

    const supervisorTarget = await call(admin, `/api/v1/users/${MEMBER_ID}/reassign-work`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: SUPERVISOR_ID, taskIds: [taskId] }),
    });
    expect(supervisorTarget.status).toBe(409);
    const supervisorError = await readBody<unknown>(supervisorTarget);
    expect(supervisorError.error?.code).toBe('TARGET_NOT_CONTRIBUTOR');
  });
});
