import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  call,
  databaseValue,
  login,
  readBody,
  readData,
  seedUsers,
  type Session,
} from './helpers';

describe('collaboration and workspace modules', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
  });

  it('keeps direct channels private and enforces message authorship', async () => {
    const channelResponse = await call(member, '/api/v1/collaboration/channels/direct', {
      method: 'POST',
      body: JSON.stringify({ userId: ADMIN_ID }),
    });
    expect(channelResponse.status).toBe(201);
    const channelId = (await readData<{ id: string }>(channelResponse)).id;

    const outsiderRead = await call(memberTwo, `/api/v1/collaboration/channels/${channelId}/messages`);
    expect(outsiderRead.status).toBe(403);

    const sent = await call(member, `/api/v1/collaboration/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Direct channel integration message' }),
    });
    expect(sent.status).toBe(201);
    const messageId = (await readData<{ id: string }>(sent)).id;

    const outsiderEdit = await call(memberTwo, `/api/v1/collaboration/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'tampered' }),
    });
    expect(outsiderEdit.status).toBe(403);

    const authorEdit = await call(member, `/api/v1/collaboration/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'Edited message body' }),
    });
    expect(authorEdit.status).toBe(200);

    const outsiderDelete = await call(memberTwo, `/api/v1/collaboration/messages/${messageId}`, { method: 'DELETE' });
    expect(outsiderDelete.status).toBe(403);

    const authorDelete = await call(member, `/api/v1/collaboration/messages/${messageId}`, { method: 'DELETE' });
    expect(authorDelete.status).toBe(200);

    const read = await call(admin, `/api/v1/collaboration/channels/${channelId}/messages`);
    expect(read.status).toBe(200);
    const messages = await readData<Array<{ id: string; body: string }>>(read);
    expect(messages.find((message) => message.id === messageId)).toBeUndefined();

    const deletedRow = await databaseValue<{ body: string; deleted_at: number | null }>(`SELECT body, deleted_at FROM messages WHERE id=?`, messageId);
    expect(deletedRow?.body).toBe('[deleted]');
    expect(deletedRow?.deleted_at).toBeGreaterThan(0);
  });

  it('versions wiki pages and blocks supervisors from authoring', async () => {
    const create = await call(member, '/api/v1/workspace/wiki', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Integration Wiki Page',
        slug: 'integration-wiki-page',
        category: 'Testing',
        contentMarkdown: '# First revision',
        changeSummary: 'Initial version',
      }),
    });
    expect(create.status).toBe(201);
    const pageId = (await readData<{ id: string }>(create)).id;

    const secondVersion = await call(member, `/api/v1/workspace/wiki/${pageId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ contentMarkdown: '# Second revision', changeSummary: 'Clarified acceptance criteria' }),
    });
    expect(secondVersion.status).toBe(201);

    const detail = await call(member, '/api/v1/workspace/wiki/integration-wiki-page');
    expect(detail.status).toBe(200);
    const page = await readData<{
      page: { current_version: number };
      versions: Array<{ version: number; changeSummary: string }>;
    }>(detail);
    expect(page.page.current_version).toBe(2);
    expect(page.versions).toHaveLength(2);

    const supervisor = await login('supervisor@cerberus.test');
    const forbidden = await call(supervisor, '/api/v1/workspace/wiki', {
      method: 'POST',
      body: JSON.stringify({ title: 'Blocked page', slug: 'blocked-page', category: 'Testing', contentMarkdown: '# no' }),
    });
    expect(forbidden.status).toBe(403);
  });

  it('enforces wiki visibility and edit rights', async () => {
    const adminPage = await call(admin, '/api/v1/workspace/wiki', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Admin-only Integration Notes',
        slug: 'admin-only-integration-notes',
        category: 'Testing',
        contentMarkdown: '# Restricted',
        visibility: 'admin',
      }),
    });
    expect(adminPage.status).toBe(201);
    const adminPageId = (await readData<{ id: string }>(adminPage)).id;

    const memberList = await readData<Array<{ slug: string }>>(await call(member, '/api/v1/workspace/wiki'));
    expect(memberList.some((page) => page.slug === 'admin-only-integration-notes')).toBe(false);
    expect((await call(member, '/api/v1/workspace/wiki/admin-only-integration-notes')).status).toBe(404);
    expect((await call(member, `/api/v1/workspace/wiki/${adminPageId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ contentMarkdown: '# Unauthorized revision' }),
    })).status).toBe(404);

    const memberPage = await call(member, '/api/v1/workspace/wiki', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Member Integration Notes',
        slug: 'member-integration-notes',
        category: 'Testing',
        contentMarkdown: '# Shared with members',
        visibility: 'members',
      }),
    });
    expect(memberPage.status).toBe(201);
    const memberPageId = (await readData<{ id: string }>(memberPage)).id;

    const supervisor = await login('supervisor@cerberus.test');
    expect((await call(supervisor, '/api/v1/workspace/wiki/member-integration-notes')).status).toBe(200);
    expect((await call(supervisor, `/api/v1/workspace/wiki/${memberPageId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ contentMarkdown: '# Supervisor revision' }),
    })).status).toBe(403);
    expect((await call(memberTwo, `/api/v1/workspace/wiki/${memberPageId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ contentMarkdown: '# Member revision' }),
    })).status).toBe(201);
  });

  it('enforces issue resolution ownership', async () => {
    const create = await call(member, '/api/v1/workspace/bugs', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Telemetry parser drift',
        description: 'The parser loses the RSSI value when the frame length changes.',
        severity: 'high',
        assigneeId: MEMBER_ID,
      }),
    });
    expect(create.status).toBe(201);
    const bugId = (await readData<{ id: string }>(create)).id;

    const outsider = await call(memberTwo, `/api/v1/workspace/bugs/${bugId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolutionNotes: 'Attempted resolution by a non-owner.' }),
    });
    expect(outsider.status).toBe(403);

    const resolved = await call(member, `/api/v1/workspace/bugs/${bugId}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolutionNotes: 'Added a regression test and verified the corrected parse path.' }),
    });
    expect(resolved.status).toBe(200);

    const row = await databaseValue<{ status: string }>(`SELECT status FROM bugs WHERE id=?`, bugId);
    expect(row?.status).toBe('resolved');
  });

  it('prevents hardware checkout beyond available quantity', async () => {
    const create = await call(admin, '/api/v1/workspace/hardware', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ESP32 DevKit V1',
        model: 'ESP32-WROOM-32',
        serialNumber: 'HW-TEST-001',
        quantity: 2,
        condition: 'good',
        purchaseStatus: 'available',
      }),
    });
    expect(create.status).toBe(201);
    const hardwareId = (await readData<{ id: string }>(create)).id;

    const tooMany = await call(admin, `/api/v1/workspace/hardware/${hardwareId}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ holderId: MEMBER_ID, quantity: 3 }),
    });
    expect(tooMany.status).toBe(409);
    expect((await readBody(tooMany)).error?.code).toBe('QUANTITY_UNAVAILABLE');

    const checkout = await call(admin, `/api/v1/workspace/hardware/${hardwareId}/checkout`, {
      method: 'POST',
      body: JSON.stringify({ holderId: MEMBER_ID, quantity: 2, notes: 'Integration checkout' }),
    });
    expect(checkout.status).toBe(201);
    const assignmentId = (await readData<{ id: string }>(checkout)).id;

    const returned = await call(admin, `/api/v1/workspace/hardware/assignments/${assignmentId}/return`, { method: 'POST' });
    expect(returned.status).toBe(200);

    const assignment = await databaseValue<{ checked_in_at: number | null }>(`SELECT checked_in_at FROM hardware_assignments WHERE id=?`, assignmentId);
    expect(assignment?.checked_in_at).toBeGreaterThan(0);
  });

  it('restricts experiment runs to the experiment owner', async () => {
    const create = await call(member, '/api/v1/workspace/experiments', {
      method: 'POST',
      body: JSON.stringify({
        experimentCode: 'EXP-RTT-01',
        title: 'MQTT round-trip latency measurement',
        objective: 'Measure the round-trip latency of the isolated MQTT telemetry path.',
        hypothesis: 'Median round-trip latency stays below 150 ms in the isolated lab.',
        environment: 'Isolated lab network with one gateway and two ESP32 clients.',
        procedure: 'Publish 100 telemetry frames and record the acknowledgement timestamps.',
      }),
    });
    expect(create.status).toBe(201);
    const experimentId = (await readData<{ id: string }>(create)).id;

    const outsider = await call(memberTwo, `/api/v1/workspace/experiments/${experimentId}/runs`, {
      method: 'POST',
      body: JSON.stringify({ actualResults: 'This run must be rejected.' }),
    });
    expect(outsider.status).toBe(403);

    const run = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs`, {
      method: 'POST',
      body: JSON.stringify({
        inputParameters: { frames: 100 },
        actualResults: 'Median round-trip latency measured at 42 ms.',
        validationNotes: 'No frame loss observed.',
        metrics: [{ name: 'rtt_ms', value: 42.0, unit: 'ms' }],
      }),
    });
    expect(run.status).toBe(201);

    const list = await call(member, '/api/v1/workspace/experiments');
    const experiments = await readData<Array<{ id: string; runCount: number }>>(list);
    expect(experiments.find((experiment) => experiment.id === experimentId)?.runCount).toBe(1);
  });

  it('records worklogs and restricts architecture decisions to task managers', async () => {
    const worklog = await call(member, '/api/v1/workspace/worklogs', {
      method: 'POST',
      body: JSON.stringify({
        completedWork: 'Implemented and verified the telemetry parser regression test.',
        currentWork: 'Reviewing the MQTT reconnect path.',
        problems: 'None observed in the isolated run.',
        testsPerformed: 'Integration suite and manual replay.',
        nextSteps: 'Attach the captured trace to the task submission.',
      }),
    });
    expect(worklog.status).toBe(201);

    const worklogs = await call(member, '/api/v1/workspace/worklogs');
    expect(worklogs.status).toBe(200);
    const entries = await readData<Array<{ completed_work: string }>>(worklogs);
    expect(entries.length).toBeGreaterThan(0);

    expect((await call(memberTwo, `/api/v1/workspace/worklogs?userId=${MEMBER_ID}`)).status).toBe(403);
    expect((await call(admin, `/api/v1/workspace/worklogs?userId=${MEMBER_ID}`)).status).toBe(200);

    const memberDecision = await call(member, '/api/v1/workspace/decisions', {
      method: 'POST',
      body: JSON.stringify({ title: 'Member decision', status: 'proposed', reasoning: 'A member should not be able to record an architecture decision.' }),
    });
    expect(memberDecision.status).toBe(403);

    const adminDecision = await call(admin, '/api/v1/workspace/decisions', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Use WAL-safe D1 batch boundaries',
        status: 'accepted',
        reasoning: 'Group related lifecycle transitions in a single D1 batch so evidence and state never diverge.',
        alternatives: 'Sequential independent writes.',
        expectedImpact: 'Atomic state transitions for submissions and reviews.',
      }),
    });
    expect(adminDecision.status).toBe(201);
  });

  it('scopes announcements to their audience and protects creation', async () => {
    const forbidden = await call(member, '/api/v1/collaboration/announcements', {
      method: 'POST',
      body: JSON.stringify({ title: 'Member announcement', body: 'Members cannot broadcast announcements.' }),
    });
    expect(forbidden.status).toBe(403);

    const created = await call(admin, '/api/v1/collaboration/announcements', {
      method: 'POST',
      body: JSON.stringify({ title: 'Integration milestone review', body: 'Checkpoint evidence is due before the next review window.', audience: 'all' }),
    });
    expect(created.status).toBe(201);

    const visible = await call(member, '/api/v1/collaboration/announcements');
    expect(visible.status).toBe(200);
    const announcements = await readData<Array<{ title: string }>>(visible);
    expect(announcements.some((announcement) => announcement.title === 'Integration milestone review')).toBe(true);

    const supervisorOnly = await call(admin, '/api/v1/collaboration/announcements', {
      method: 'POST',
      body: JSON.stringify({ title: 'Supervisor-only briefing', body: 'This briefing is restricted to academic supervision.', audience: 'supervisors' }),
    });
    expect(supervisorOnly.status).toBe(201);
    const supervisorOnlyId = (await readData<{ id: string }>(supervisorOnly)).id;

    const memberView = await call(member, '/api/v1/collaboration/announcements');
    const memberAnnouncements = await readData<Array<{ title: string }>>(memberView);
    expect(memberAnnouncements.some((announcement) => announcement.title === 'Supervisor-only briefing')).toBe(false);
    expect((await call(member, `/api/v1/collaboration/announcements/${supervisorOnlyId}/read`, { method: 'POST' })).status).toBe(404);

    const supervisor = await login('supervisor@cerberus.test');
    expect((await call(supervisor, `/api/v1/collaboration/announcements/${supervisorOnlyId}/read`, { method: 'POST' })).status).toBe(200);
  });
});
