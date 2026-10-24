import { beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  SUPERVISOR_EMAIL,
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

interface NotificationRow {
  id: string;
  type: string;
  resource_type: string | null;
  resource_id: string | null;
  read_at: number | null;
  link: string | null;
}

interface RunRow {
  id: string;
  runNumber: number;
  actualResults: string;
  taskId: string | null;
  taskTitle: string | null;
  checkpointId: string | null;
  checkpointTitle: string | null;
  inputParameters: Record<string, unknown>;
  metrics: Array<{ name: string; value: number | null; text: string | null; unit: string | null; observed: boolean }>;
}

describe('phase 1 workspace features', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;
  let supervisor: Session;
  let taskId: string;
  let checkpointId: string;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
    supervisor = await login(SUPERVISOR_EMAIL);
    taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'PhaseOne telemetry calibration' });
    checkpointId = 'checkpoint_phase1_probe';
    await seedCheckpoint({
      id: checkpointId,
      ownerId: MEMBER_ID,
      title: 'PhaseOne probe checkpoint',
      tasks: [{ id: 'task_phase1_checkpoint_probe', status: 'in_progress', assigneeId: MEMBER_ID }],
    });
  });

  describe('global search', () => {
    it('searches tasks, documentation and decisions while honouring wiki ACLs', async () => {
      expect((await call(null, '/api/v1/search?q=phaseone')).status).toBe(401);

      const short = await call(member, '/api/v1/search?q=p');
      expect(short.status).toBe(200);
      expect((await readBody(short)).data).toEqual({ query: 'p', groups: [], total: 0 });

      const memberPage = await call(member, '/api/v1/workspace/wiki', {
        method: 'POST',
        body: JSON.stringify({
          title: 'PhaseOne member notes',
          slug: 'phaseone-member-notes',
          category: 'Testing',
          contentMarkdown: 'The phaseone-content-marker string is searchable.',
          visibility: 'members',
        }),
      });
      expect(memberPage.status).toBe(201);

      const adminPage = await call(admin, '/api/v1/workspace/wiki', {
        method: 'POST',
        body: JSON.stringify({
          title: 'PhaseOne admin notes',
          slug: 'phaseone-admin-notes',
          category: 'Testing',
          contentMarkdown: 'Restricted phaseone-admin-marker material.',
          visibility: 'admin',
        }),
      });
      expect(adminPage.status).toBe(201);

      const decision = await call(admin, '/api/v1/workspace/decisions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'PhaseOne search decision',
          status: 'accepted',
          reasoning: 'Index the workspace with per-module access filters before returning results.',
        }),
      });
      expect(decision.status).toBe(201);

      const memberResult = await readBody<{
        query: string;
        groups: Array<{ type: string; results: Array<{ title: string; link: string }> }>;
        total: number;
      }>(await call(member, '/api/v1/search?q=PhaseOne'));
      expect(memberResult.ok).toBe(true);
      const memberTitles = memberResult.data.groups.flatMap((group) => group.results.map((result) => result.title));
      expect(memberTitles).toContain('PhaseOne telemetry calibration');
      expect(memberTitles).toContain('PhaseOne member notes');
      expect(memberTitles).not.toContain('PhaseOne admin notes');
      expect(memberResult.data.groups.map((group) => group.type)).toEqual(
        expect.arrayContaining(['task', 'wiki', 'decision']),
      );

      const adminResult = await readBody<{ groups: Array<{ results: Array<{ title: string }> }> }>(
        await call(admin, '/api/v1/search?q=PhaseOne'),
      );
      const adminTitles = adminResult.data.groups.flatMap((group) => group.results.map((result) => result.title));
      expect(adminTitles).toContain('PhaseOne admin notes');

      const contentMatch = await readBody<{ groups: Array<{ results: Array<{ title: string }> }> }>(
        await call(member, '/api/v1/search?q=phaseone-content-marker'),
      );
      expect(contentMatch.data.groups.flatMap((group) => group.results.map((result) => result.title)))
        .toContain('PhaseOne member notes');

      const escaped = await readBody<{ total: number }>(
        await call(admin, `/api/v1/search?q=${encodeURIComponent('%zz%')}`),
      );
      expect(escaped.data.total).toBe(0);
    });
  });

  describe('notification center', () => {
    it('paginates, filters, resolves links on the server and marks everything read atomically', async () => {
      const initial = await readBody<unknown>(
        await call(member, '/api/v1/collaboration/notifications?limit=1'),
      );
      const initialMeta = initial.meta as { total: number; unreadCount: number };
      const baselineTotal = initialMeta.total;
      const baselineUnread = initialMeta.unreadCount;

      await databaseRun(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id,created_at)
        VALUES ('notif_phase1_old',?,'task.assigned','Old assignment','Body',?,?,unixepoch()+10)`, MEMBER_ID, 'task', taskId);
      await databaseRun(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id,created_at)
        VALUES ('notif_phase1_review',?,'review.requested','Review requested','Body',?,?,unixepoch()+20)`, MEMBER_ID, 'task', taskId);
      await databaseRun(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id,created_at)
        VALUES ('notif_phase1_missing',?,'task.assigned','Missing task','Body',?,?,unixepoch()+30)`, MEMBER_ID, 'task', 'task_missing_phase1');
      await databaseRun(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id,created_at)
        VALUES ('notif_phase1_announcement',?,'announcement','Announcement','Body',NULL,NULL,unixepoch()+40)`, MEMBER_ID);

      const events = await databaseValue<{ count: number }>(
        `SELECT COUNT(*) AS count FROM workspace_events WHERE user_id=? AND event_type='notification.created'`,
        MEMBER_ID,
      );
      expect(events?.count).toBeGreaterThanOrEqual(4);

      const firstPage = await readBody<NotificationRow[]>(
        await call(member, '/api/v1/collaboration/notifications?limit=2'),
      );
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.data[0].id).toBe('notif_phase1_announcement');
      expect(firstPage.meta).toMatchObject({
        page: 1,
        limit: 2,
        total: baselineTotal + 4,
        unreadCount: baselineUnread + 4,
        hasMore: true,
      });

      const filtered = await readBody<NotificationRow[]>(
        await call(member, '/api/v1/collaboration/notifications?status=unread&type=task.assigned&limit=100'),
      );
      expect(filtered.data.map((row) => row.id)).toEqual(
        expect.arrayContaining(['notif_phase1_old', 'notif_phase1_missing']),
      );
      expect(filtered.data.find((row) => row.id === 'notif_phase1_announcement')).toBeUndefined();

      const links = await readBody<NotificationRow[]>(
        await call(member, '/api/v1/collaboration/notifications?limit=100'),
      );
      expect(links.data.find((row) => row.id === 'notif_phase1_old')?.link).toBe(`/tasks/${taskId}`);
      expect(links.data.find((row) => row.id === 'notif_phase1_missing')?.link).toBeNull();

      await databaseRun(`INSERT INTO submissions (id,checkpoint_id,submitted_by,summary,version)
        VALUES ('submission_phase1_probe',?,?,'Checkpoint evidence package for the phase 1 probe.',1)`,
      checkpointId, MEMBER_ID);
      await databaseRun(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id,created_at)
        VALUES ('notif_phase1_submission',?,'review.requested','Checkpoint ready','Body','submission','submission_phase1_probe',5000)`,
      MEMBER_ID);
      await databaseRun(`INSERT INTO notifications (id,user_id,type,title,body,resource_type,resource_id,created_at)
        VALUES ('notif_phase1_submission_admin',?,'review.requested','Checkpoint ready','Body','submission','submission_phase1_probe',5000)`,
      ADMIN_ID);

      const memberLinks = await readBody<NotificationRow[]>(
        await call(member, '/api/v1/collaboration/notifications?limit=100'),
      );
      expect(memberLinks.data.find((row) => row.id === 'notif_phase1_submission')?.link).toBe('/tasks');

      const adminLinks = await readBody<NotificationRow[]>(
        await call(admin, '/api/v1/collaboration/notifications?limit=100'),
      );
      expect(adminLinks.data.find((row) => row.id === 'notif_phase1_submission_admin')?.link).toBe('/reviews');

      const crossRead = await readBody<{ updated: number }>(
        await call(member, '/api/v1/collaboration/notifications/notif_phase1_submission_admin/read', { method: 'POST' }),
      );
      expect(crossRead.data.updated).toBe(0);

      const unreadBefore = await readBody<{ count: number }>(
        await call(member, '/api/v1/collaboration/notifications/unread-count'),
      );
      expect(unreadBefore.data.count).toBeGreaterThanOrEqual(5);

      const readAll = await readBody<{ updated: number }>(
        await call(member, '/api/v1/collaboration/notifications/read-all', { method: 'POST' }),
      );
      expect(readAll.data.updated).toBe(unreadBefore.data.count);

      const unreadAfter = await readBody<{ count: number }>(
        await call(member, '/api/v1/collaboration/notifications/unread-count'),
      );
      expect(unreadAfter.data.count).toBe(0);

      const secondReadAll = await readBody<{ updated: number }>(
        await call(member, '/api/v1/collaboration/notifications/read-all', { method: 'POST' }),
      );
      expect(secondReadAll.data.updated).toBe(0);
    });
  });

  describe('experiment run explorer', () => {
    it('allocates sequential run numbers, validates metrics and exports evidence CSV', async () => {
      const create = await call(member, '/api/v1/workspace/experiments', {
        method: 'POST',
        body: JSON.stringify({
          experimentCode: 'EXP-PHASE1-01',
          title: 'Phase 1 latency probe',
          objective: 'Measure telemetry latency across the isolated lab path.',
          hypothesis: 'Median latency remains below the acceptance threshold.',
          environment: 'Isolated lab with one gateway and two ESP32 clients.',
          procedure: 'Publish telemetry frames and record acknowledgement timestamps.',
        }),
      });
      expect(create.status).toBe(201);
      const experimentId = (await readData<{ id: string }>(create)).id;

      const first = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          inputParameters: { frames: 100 },
          actualResults: 'Median round-trip latency measured at 42 ms.',
          metrics: [
            { name: 'rtt_ms', value: 42, unit: 'ms' },
            { name: 'loss_mode', text: 'none observed', observed: false },
          ],
        }),
      });
      expect(first.status).toBe(201);
      expect((await readData<{ runNumber: number }>(first)).runNumber).toBe(1);

      const second = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          inputParameters: { frames: 200 },
          actualResults: 'Second run repeated with a larger frame batch.',
          taskId,
          checkpointId,
          metrics: [{ name: 'rtt_ms', value: 39, unit: 'ms' }],
        }),
      });
      expect(second.status).toBe(201);
      expect((await readData<{ runNumber: number }>(second)).runNumber).toBe(2);

      const missingMetricValue = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ actualResults: 'Invalid run', metrics: [{ name: 'empty_metric' }] }),
      });
      expect(missingMetricValue.status).toBe(422);

      const duplicateMetric = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          actualResults: 'Invalid run',
          metrics: [{ name: 'rtt_ms', value: 1 }, { name: 'RTT_MS', value: 2 }],
        }),
      });
      expect(duplicateMetric.status).toBe(422);

      const badTask = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ actualResults: 'Invalid run', taskId: 'task_missing_phase1' }),
      });
      expect(badTask.status).toBe(422);
      expect((await readBody(badTask)).error?.code).toBe('INVALID_TASK_LINK');

      const runs = await readBody<RunRow[]>(
        await call(member, `/api/v1/workspace/experiments/${experimentId}/runs?limit=1`),
      );
      expect(runs.data).toHaveLength(1);
      expect(runs.data[0].runNumber).toBe(2);
      expect(runs.data[0].taskTitle).toBe('PhaseOne telemetry calibration');
      expect(runs.data[0].checkpointTitle).toBe('PhaseOne probe checkpoint');
      expect(runs.data[0].metrics).toEqual([{ name: 'rtt_ms', value: 39, text: null, unit: 'ms', observed: true }]);
      expect(runs.meta).toMatchObject({ page: 1, limit: 1, total: 2, hasMore: true });

      const allRuns = await readData<RunRow[]>(
        await call(member, `/api/v1/workspace/experiments/${experimentId}/runs?limit=100`),
      );
      const firstRun = allRuns.find((run) => run.runNumber === 1);
      expect(firstRun?.inputParameters).toEqual({ frames: 100 });
      expect(firstRun?.metrics).toEqual([
        { name: 'loss_mode', value: null, text: 'none observed', unit: null, observed: false },
        { name: 'rtt_ms', value: 42, text: null, unit: 'ms', observed: true },
      ]);

      const csvResponse = await call(member, `/api/v1/workspace/experiments/${experimentId}/runs/export`);
      expect(csvResponse.status).toBe(200);
      expect(csvResponse.headers.get('content-type')).toContain('text/csv');
      expect(csvResponse.headers.get('content-disposition')).toContain('cerberus-exp-phase1-01-runs-');
      const csv = await csvResponse.text();
      expect(csv.split('\n')[0]).toContain('run_number');
      expect(csv).toContain('rtt_ms');
      expect(csv).toContain('PhaseOne telemetry calibration');

      const auditCount = await databaseValue<{ count: number }>(
        `SELECT COUNT(*) AS count FROM audit_logs WHERE action='experiment.runs_exported' AND resource_id=?`,
        experimentId,
      );
      expect(auditCount?.count).toBe(1);

      expect((await call(supervisor, `/api/v1/workspace/experiments/${experimentId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ actualResults: 'Supervisors are read-only.' }),
      })).status).toBe(403);
    });
  });

  describe('hardware lifecycle', () => {
    it('separates quantity and serialized tracking and enforces return permissions', async () => {
      const lowStock = await call(admin, '/api/v1/workspace/hardware', {
        method: 'POST',
        body: JSON.stringify({
          name: 'PhaseOne LowStock Probe',
          model: 'PROBE-1',
          serialNumber: 'PHASE1-LOW-001',
          quantity: 4,
          trackingMode: 'quantity',
          minQuantity: 2,
        }),
      });
      expect(lowStock.status).toBe(201);
      const lowStockId = (await readData<{ id: string }>(lowStock)).id;

      const list = await readBody<Array<Record<string, unknown>>>(
        await call(member, '/api/v1/workspace/hardware?search=PhaseOne%20LowStock&limit=1'),
      );
      expect(list.data).toHaveLength(1);
      expect(list.data[0]).toMatchObject({
        id: lowStockId,
        tracking_mode: 'quantity',
        min_quantity: 2,
        availableQuantity: 4,
        lowStock: false,
      });

      const checkout = await call(admin, `/api/v1/workspace/hardware/${lowStockId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ holderId: MEMBER_ID, quantity: 2 }),
      });
      expect(checkout.status).toBe(201);
      const assignmentId = (await readData<{ id: string }>(checkout)).id;

      const afterCheckout = await readBody<Array<Record<string, unknown>>>(
        await call(member, '/api/v1/workspace/hardware?search=PhaseOne%20LowStock&limit=1'),
      );
      expect(afterCheckout.data[0]).toMatchObject({ availableQuantity: 2, lowStock: true });

      expect((await call(member, `/api/v1/workspace/hardware/${lowStockId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ holderId: MEMBER_ID, quantity: 1 }),
      })).status).toBe(403);

      const returnedByHolder = await call(member, `/api/v1/workspace/hardware/assignments/${assignmentId}/return`, {
        method: 'POST',
        body: JSON.stringify({ condition: 'good', notes: 'Returned after the latency probe.' }),
      });
      expect(returnedByHolder.status).toBe(200);

      const secondCheckout = await call(admin, `/api/v1/workspace/hardware/${lowStockId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ holderId: MEMBER_ID, quantity: 1 }),
      });
      expect(secondCheckout.status).toBe(201);
      const secondAssignmentId = (await readData<{ id: string }>(secondCheckout)).id;
      expect((await call(memberTwo, `/api/v1/workspace/hardware/assignments/${secondAssignmentId}/return`, {
        method: 'POST',
        body: JSON.stringify({ condition: 'good' }),
      })).status).toBe(403);
      expect((await call(admin, `/api/v1/workspace/hardware/assignments/${secondAssignmentId}/return`, {
        method: 'POST',
        body: JSON.stringify({ condition: 'fair' }),
      })).status).toBe(200);

      const invalidSerialized = await call(admin, '/api/v1/workspace/hardware', {
        method: 'POST',
        body: JSON.stringify({
          name: 'PhaseOne Serialized Probe',
          model: 'PROBE-2',
          serialNumber: 'PHASE1-SER-001',
          quantity: 2,
          trackingMode: 'serialized',
        }),
      });
      expect(invalidSerialized.status).toBe(422);

      const serialized = await call(admin, '/api/v1/workspace/hardware', {
        method: 'POST',
        body: JSON.stringify({
          name: 'PhaseOne Serialized Probe',
          model: 'PROBE-2',
          serialNumber: 'PHASE1-SER-001',
          quantity: 1,
          trackingMode: 'serialized',
        }),
      });
      expect(serialized.status).toBe(201);
      const serializedId = (await readData<{ id: string }>(serialized)).id;

      const serializedTooMany = await call(admin, `/api/v1/workspace/hardware/${serializedId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ holderId: MEMBER_ID, quantity: 2 }),
      });
      expect(serializedTooMany.status).toBe(409);
      expect((await readBody(serializedTooMany)).error?.code).toBe('SERIALIZED_UNIT');

      const serializedCheckout = await call(admin, `/api/v1/workspace/hardware/${serializedId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ holderId: MEMBER_ID, quantity: 1 }),
      });
      expect(serializedCheckout.status).toBe(201);
      const serializedAssignmentId = (await readData<{ id: string }>(serializedCheckout)).id;
      expect((await call(member, `/api/v1/workspace/hardware/assignments/${serializedAssignmentId}/return`, {
        method: 'POST',
        body: JSON.stringify({ condition: 'retired', notes: 'Bench unit retired after the probe.' }),
      })).status).toBe(200);

      const damaged = await call(admin, '/api/v1/workspace/hardware', {
        method: 'POST',
        body: JSON.stringify({
          name: 'PhaseOne Damaged Probe',
          model: 'PROBE-3',
          serialNumber: 'PHASE1-DMG-001',
          quantity: 1,
          condition: 'damaged',
        }),
      });
      expect(damaged.status).toBe(201);
      const damagedId = (await readData<{ id: string }>(damaged)).id;
      const damagedCheckout = await call(admin, `/api/v1/workspace/hardware/${damagedId}/checkout`, {
        method: 'POST',
        body: JSON.stringify({ holderId: MEMBER_ID, quantity: 1 }),
      });
      expect(damagedCheckout.status).toBe(409);
      expect((await readBody(damagedCheckout)).error?.code).toBe('ITEM_UNAVAILABLE');

      expect((await call(member, `/api/v1/workspace/hardware/${lowStockId}/maintenance`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'calibration', notes: 'Member calibration attempt' }),
      })).status).toBe(403);

      const maintenance = await call(admin, `/api/v1/workspace/hardware/${lowStockId}/maintenance`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'calibration', notes: 'Calibrated the probe against the lab reference.' }),
      });
      expect(maintenance.status).toBe(201);

      const detail = await readBody<{
        item: Record<string, unknown>;
        assignments: Array<Record<string, unknown>>;
        maintenance: Array<Record<string, unknown>>;
        canManage: boolean;
      }>(await call(member, `/api/v1/workspace/hardware/${lowStockId}`));
      expect(detail.data.item).toMatchObject({ id: lowStockId, tracking_mode: 'quantity', availableQuantity: 4, lowStock: false });
      expect(detail.data.canManage).toBe(false);
      expect(detail.data.assignments.length).toBeGreaterThanOrEqual(2);
      expect(detail.data.assignments[0]).toHaveProperty('conditionOnReturn');
      expect(detail.data.maintenance).toHaveLength(1);
      expect(detail.data.maintenance[0]).toMatchObject({ kind: 'calibration', performedByName: 'Admin Sentinel' });
    });
  });
});
