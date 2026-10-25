import { beforeAll, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { addDaysDateOnly, dateOnlyToEpoch, todayDateOnly } from '../../shared/schemas/dates';
import { computeHmacSha256, hashPassword } from '../../worker/services/security';
import { createDigest } from '../../worker/services/notifications';
import {
  ADMIN_EMAIL,
  MEMBER_EMAIL,
  MEMBER_ID,
  MEMBER_TWO_EMAIL,
  MEMBER_TWO_ID,
  SUPERVISOR_EMAIL,
  TEST_PASSWORD,
  bindings,
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

const REVIEWER_ONE_ID = 'user_test_reviewer_one';
const REVIEWER_ONE_EMAIL = 'reviewer1@cerberus.test';
const REVIEWER_TWO_ID = 'user_test_reviewer_two';
const REVIEWER_TWO_EMAIL = 'reviewer2@cerberus.test';

function taskPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: 'project_cerberus',
    assigneeId: MEMBER_ID,
    title: 'Phase 2 scheduling task',
    description: 'Integration-test task description used to verify phase 2 scheduling behaviour.',
    acceptanceCriteria: 'The phase 2 acceptance criteria are verified by the integration suite.',
    validationProcedure: 'Run the phase 2 integration suite against the isolated D1 database.',
    evidenceRequirements: 'A reproducible command output and a commit reference.',
    priority: 'high',
    ...overrides,
  };
}

describe('phase 2 planning and governance', () => {
  let admin: Session;
  let member: Session;
  let memberTwo: Session;
  let supervisor: Session;
  let reviewerOne: Session;
  let reviewerTwo: Session;

  beforeAll(async () => {
    await seedUsers();
    admin = await login(ADMIN_EMAIL);
    member = await login(MEMBER_EMAIL);
    memberTwo = await login(MEMBER_TWO_EMAIL);
    supervisor = await login(SUPERVISOR_EMAIL);

    const passwordHash = await hashPassword(TEST_PASSWORD);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO roles (id, name, description) VALUES ('role_qa_reviewer', 'qa_reviewer', 'Second-line administrative reviewer')`),
      env.DB.prepare(`INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_qa_reviewer', 'perm_review_admin')`),
      env.DB.prepare(`INSERT INTO users (id, email, display_name, specialization, status, password_hash, must_change_password)
        VALUES (?, ?, 'Reviewer One', 'Quality Assurance', 'active', ?, 0)`).bind(REVIEWER_ONE_ID, REVIEWER_ONE_EMAIL, passwordHash),
      env.DB.prepare(`INSERT INTO users (id, email, display_name, specialization, status, password_hash, must_change_password)
        VALUES (?, ?, 'Reviewer Two', 'Quality Assurance', 'active', ?, 0)`).bind(REVIEWER_TWO_ID, REVIEWER_TWO_EMAIL, passwordHash),
      env.DB.prepare(`INSERT INTO project_members (project_id, user_id, membership_role) VALUES ('project_cerberus', ?, 'member')`).bind(REVIEWER_ONE_ID),
      env.DB.prepare(`INSERT INTO project_members (project_id, user_id, membership_role) VALUES ('project_cerberus', ?, 'member')`).bind(REVIEWER_TWO_ID),
      env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_qa_reviewer')`).bind(REVIEWER_ONE_ID),
      env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_qa_reviewer')`).bind(REVIEWER_TWO_ID),
    ]);

    reviewerOne = await login(REVIEWER_ONE_EMAIL);
    reviewerTwo = await login(REVIEWER_TWO_EMAIL);
  });

  describe('task scheduling and effort', () => {
    it('validates schedule order on create and update', async () => {
      const invalid = await call(admin, '/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify(taskPayload({
          title: 'Invalid schedule order task',
          startDate: '2026-11-10',
          dueDate: '2026-11-01',
        })),
      });
      expect(invalid.status).toBe(422);
      expect((await readBody(invalid)).error?.code).toBe('VALIDATION_ERROR');

      const created = await call(admin, '/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify(taskPayload({
          title: 'Scheduled telemetry task',
          startDate: '2026-11-02',
          dueDate: '2026-11-05',
          estimateHours: 6,
        })),
      });
      expect(created.status).toBe(201);
      const taskId = (await readData<{ id: string }>(created)).id;

      const detail = await readData<{
        task: { start_date: number; due_date: number; estimate_hours: number };
        worklogs: unknown[];
        worklogTotalHours: number;
      }>(await call(member, `/api/v1/tasks/${taskId}`));
      expect(detail.task.start_date).toBe(dateOnlyToEpoch('2026-11-02'));
      expect(detail.task.due_date).toBe(dateOnlyToEpoch('2026-11-05'));
      expect(detail.task.estimate_hours).toBe(6);
      expect(detail.worklogs).toEqual([]);
      expect(detail.worklogTotalHours).toBe(0);

      const list = await readBody<Array<{ id: string; startDate: number; dueDate: number; estimateHours: number; loggedHours: number }>>(
        await call(admin, '/api/v1/tasks?limit=200'),
      );
      const listed = list.data.find((task) => task.id === taskId);
      expect(listed?.startDate).toBe(dateOnlyToEpoch('2026-11-02'));
      expect(listed?.estimateHours).toBe(6);
      expect(listed?.loggedHours).toBe(0);

      const invalidUpdate = await call(admin, `/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate: '2026-11-01' }),
      });
      expect(invalidUpdate.status).toBe(422);
      expect((await readBody(invalidUpdate)).error?.code).toBe('INVALID_SCHEDULE');

      const validUpdate = await call(admin, `/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ startDate: '2026-11-03', dueDate: '2026-11-09', estimateHours: 8 }),
      });
      expect(validUpdate.status).toBe(200);
      const updated = await databaseValue<{ start_date: number; due_date: number; estimate_hours: number }>(
        `SELECT start_date, due_date, estimate_hours FROM tasks WHERE id=?`,
        taskId,
      );
      expect(updated?.start_date).toBe(dateOnlyToEpoch('2026-11-03'));
      expect(updated?.due_date).toBe(dateOnlyToEpoch('2026-11-09'));
      expect(updated?.estimate_hours).toBe(8);
    });

    it('enforces work-log ownership, dates and the daily cap', async () => {
      const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Work-log ownership task' });

      const wrongMember = await call(memberTwo, `/api/v1/tasks/${taskId}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ workedOn: '2026-10-20', hours: 2 }),
      });
      expect(wrongMember.status).toBe(403);

      const observer = await call(supervisor, `/api/v1/tasks/${taskId}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ workedOn: '2026-10-20', hours: 2 }),
      });
      expect(observer.status).toBe(403);
      expect((await readBody(observer)).error?.message).toContain('read-only');

      const tooSmall = await call(member, `/api/v1/tasks/${taskId}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ workedOn: '2026-10-20', hours: 0.1 }),
      });
      expect(tooSmall.status).toBe(422);

      const future = await call(member, `/api/v1/tasks/${taskId}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ workedOn: addDaysDateOnly(todayDateOnly(), 2), hours: 1 }),
      });
      expect(future.status).toBe(422);
      expect((await readBody(future)).error?.code).toBe('FUTURE_WORKLOG');

      const accepted = await call(member, `/api/v1/tasks/${taskId}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ workedOn: '2026-10-20', hours: 23.5, note: 'Long integration experiment block.' }),
      });
      expect(accepted.status).toBe(201);
      const worklogId = (await readData<{ id: string }>(accepted)).id;

      const exceeded = await call(member, `/api/v1/tasks/${taskId}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ workedOn: '2026-10-20', hours: 1 }),
      });
      expect(exceeded.status).toBe(422);
      expect((await readBody(exceeded)).error?.code).toBe('DAILY_HOURS_EXCEEDED');

      const listed = await readBody<Array<{ id: string; hours: number }>>(await call(member, `/api/v1/tasks/${taskId}/worklogs`));
      expect(listed.data).toHaveLength(1);
      expect(listed.meta?.totalHours).toBe(23.5);
      expect(listed.meta?.myHours).toBe(23.5);

      const wrongDelete = await call(memberTwo, `/api/v1/tasks/${taskId}/worklogs/${worklogId}`, { method: 'DELETE' });
      expect(wrongDelete.status).toBe(403);

      const deleted = await call(member, `/api/v1/tasks/${taskId}/worklogs/${worklogId}`, { method: 'DELETE' });
      expect(deleted.status).toBe(200);

      const afterDelete = await readBody<unknown[]>(await call(member, `/api/v1/tasks/${taskId}/worklogs`));
      expect(afterDelete.data).toHaveLength(0);
      expect(afterDelete.meta?.totalHours).toBe(0);

      const audit = await databaseValue<{ count: number }>(
        `SELECT COUNT(*) AS count FROM audit_logs WHERE resource_id=? AND action IN ('task.worklog_added','task.worklog_removed')`,
        taskId,
      );
      expect(audit?.count).toBe(2);
    });
  });

  describe('planning views', () => {
    it('serves My Week with ACL boundaries for members, admins and supervisors', async () => {
      const taskId = await createTask(admin, {
        assigneeId: MEMBER_ID,
        title: 'My Week scheduled task',
      });
      // The helper has no schedule input, so the schedule is applied through the API.
      const scheduled = await call(admin, `/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ startDate: '2026-11-02', dueDate: '2026-11-06', estimateHours: 10 }),
      });
      expect(scheduled.status).toBe(200);

      const own = await readData<{
        weekStart: string;
        weekEnd: string;
        tasks: Array<{ id: string }>;
        totals: { plannedTasks: number; estimateHours: number };
        readOnly: boolean;
      }>(await call(member, '/api/v1/planning/my-week?weekStart=2026-11-02'));
      expect(own.weekStart).toBe('2026-11-02');
      expect(own.weekEnd).toBe('2026-11-08');
      expect(own.tasks.some((task) => task.id === taskId)).toBe(true);
      expect(own.totals.plannedTasks).toBeGreaterThanOrEqual(1);
      expect(own.readOnly).toBe(false);

      const forbidden = await call(member, `/api/v1/planning/my-week?weekStart=2026-11-02&memberId=${MEMBER_TWO_ID}`);
      expect(forbidden.status).toBe(403);

      const adminView = await call(admin, `/api/v1/planning/my-week?weekStart=2026-11-02&memberId=${MEMBER_ID}`);
      expect(adminView.status).toBe(200);

      const supervisorView = await readData<{ readOnly: boolean }>(
        await call(supervisor, `/api/v1/planning/my-week?weekStart=2026-11-02&memberId=${MEMBER_ID}`),
      );
      expect(supervisorView.readOnly).toBe(true);

      const invalidWeek = await call(member, '/api/v1/planning/my-week?weekStart=2026-11-31');
      expect(invalidWeek.status).toBe(422);
    });

    it('rejects oversized windows and paginates the calendar', async () => {
      const invalid = await call(member, '/api/v1/planning/calendar?from=2026-01-01&to=2026-12-31');
      expect(invalid.status).toBe(422);

      const calendar = await readBody<Array<{ id: string; dueDate: number }>>(
        await call(member, '/api/v1/planning/calendar?from=2026-11-01&to=2026-11-30&limit=10'),
      );
      expect(calendar.ok).toBe(true);
      expect(calendar.meta?.from).toBe('2026-11-01');
      expect(calendar.meta?.to).toBe('2026-11-30');
      expect(calendar.meta?.limit).toBe(10);
      expect(Array.isArray(calendar.data)).toBe(true);

      const filtered = await readBody<Array<{ id: string; assigneeId: string | null }>>(
        await call(member, `/api/v1/planning/calendar?from=2026-11-01&to=2026-11-30&assigneeId=${MEMBER_TWO_ID}`),
      );
      expect(filtered.data.every((task) => task.assigneeId === MEMBER_TWO_ID)).toBe(true);

      const assignedTask = await createTask(admin, { assigneeId: MEMBER_TWO_ID, title: 'Member two calendar task' });
      await call(admin, `/api/v1/tasks/${assignedTask}`, {
        method: 'PATCH',
        body: JSON.stringify({ startDate: '2026-11-12', dueDate: '2026-11-16' }),
      });
      const memberTwoCalendar = await readBody<Array<{ id: string; assigneeId: string | null }>>(
        await call(member, `/api/v1/planning/calendar?from=2026-11-01&to=2026-11-30&assigneeId=${MEMBER_TWO_ID}`),
      );
      expect(memberTwoCalendar.data.some((task) => task.id === assignedTask)).toBe(true);
      expect(memberTwoCalendar.data.every((task) => task.assigneeId === MEMBER_TWO_ID)).toBe(true);
    });

    it('returns dependency edges inside timeline metadata', async () => {
      const first = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Timeline dependency source' });
      const second = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Timeline dependency target' });
      for (const [taskId, startDate, dueDate] of [
        [first, '2026-11-03', '2026-11-07'],
        [second, '2026-11-09', '2026-11-14'],
      ] as const) {
        const patched = await call(admin, `/api/v1/tasks/${taskId}`, {
          method: 'PATCH',
          body: JSON.stringify({ startDate, dueDate }),
        });
        expect(patched.status).toBe(200);
      }
      const dependency = await call(admin, `/api/v1/tasks/${second}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({ dependsOnTaskId: first }),
      });
      expect(dependency.status).toBe(201);

      const timeline = await readBody<Array<{ id: string }>>(
        await call(member, '/api/v1/planning/timeline?from=2026-11-01&to=2026-11-30&limit=50'),
      );
      expect(timeline.data.some((task) => task.id === first)).toBe(true);
      expect(timeline.data.some((task) => task.id === second)).toBe(true);
      const edges = timeline.meta?.edges as Array<{ taskId: string; dependsOnTaskId: string }>;
      expect(edges).toContainEqual({ taskId: second, dependsOnTaskId: first });
    });

    it('aggregates workload estimates and logged hours per member', async () => {
      const workload = await readBody<Array<{
        id: string;
        activeTasks: number;
        estimateHours: number;
        dueInRange: number;
        loggedHours: number;
      }>>(await call(member, '/api/v1/planning/workload?from=2026-11-01&to=2026-11-30'));
      const mine = workload.data.find((row) => row.id === MEMBER_ID);
      expect(mine).toBeDefined();
      expect(mine!.activeTasks).toBeGreaterThanOrEqual(2);
      expect(mine!.estimateHours).toBeGreaterThanOrEqual(15);
      expect(mine!.dueInRange).toBeGreaterThanOrEqual(2);
      expect(workload.meta?.total).toBe(workload.data.length);
    });
  });

  describe('review governance', () => {
    it('creates rubrics only when weights sum to 100 and names are unique', async () => {
      const invalid = await call(admin, '/api/v1/reviews/rubrics', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Invalid weight rubric',
          description: '',
          criteria: [{ label: 'Evidence quality', weight: 60 }, { label: 'Reproducibility', weight: 30 }],
        }),
      });
      expect(invalid.status).toBe(422);

      const created = await call(admin, '/api/v1/reviews/rubrics', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Phase 2 weighted rubric',
          description: 'Evidence quality and reproducibility for phase 2 review governance.',
          criteria: [{ label: 'Evidence quality', weight: 60 }, { label: 'Reproducibility', weight: 40 }],
        }),
      });
      expect(created.status).toBe(201);
      const rubricId = (await readData<{ id: string }>(created)).id;

      const duplicate = await call(admin, '/api/v1/reviews/rubrics', {
        method: 'POST',
        body: JSON.stringify({
          name: 'phase 2 WEIGHTED rubric',
          description: '',
          criteria: [{ label: 'Evidence quality', weight: 50 }, { label: 'Reproducibility', weight: 50 }],
        }),
      });
      expect(duplicate.status).toBe(409);
      expect((await readBody(duplicate)).error?.code).toBe('RUBRIC_EXISTS');

      const rubrics = await readData<Array<{ id: string; criteria: Array<{ id: string; label: string; weight: number }> }>>(
        await call(admin, '/api/v1/reviews/rubrics'),
      );
      const rubric = rubrics.find((entry) => entry.id === rubricId);
      expect(rubric?.criteria.map((criterion) => criterion.weight)).toEqual([60, 40]);

      const deactivated = await call(admin, `/api/v1/reviews/rubrics/${rubricId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: false }),
      });
      expect(deactivated.status).toBe(200);

      const activeOnly = await readData<Array<{ id: string }>>(await call(admin, '/api/v1/reviews/rubrics'));
      expect(activeOnly.some((entry) => entry.id === rubricId)).toBe(false);
      const all = await readData<Array<{ id: string }>>(await call(admin, '/api/v1/reviews/rubrics?includeInactive=true'));
      expect(all.some((entry) => entry.id === rubricId)).toBe(true);

      const reactivated = await call(admin, `/api/v1/reviews/rubrics/${rubricId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
      expect(reactivated.status).toBe(200);

      const reviewers = await readData<Array<{ id: string; pendingAssignments: number }>>(await call(admin, '/api/v1/reviews/reviewers'));
      expect(reviewers.some((reviewer) => reviewer.id === REVIEWER_ONE_ID)).toBe(true);
    });

    it('assigns a reviewer and records a weighted scored decision', async () => {
      const rubricId = (await databaseValue<{ id: string }>(`SELECT id FROM review_rubrics WHERE name='Phase 2 weighted rubric'`))!.id;
      const rubric = await readData<Array<{ id: string; criteria: Array<{ id: string; weight: number }> }>>(
        await call(admin, '/api/v1/reviews/rubrics'),
      );
      const criteria = rubric.find((entry) => entry.id === rubricId)!.criteria;

      const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Scored review task' });
      await completeChecklist(member, taskId);
      const submitted = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
        method: 'POST',
        body: JSON.stringify(taskSubmission(2)),
      });
      expect(submitted.status).toBe(201);
      const submissionId = (await readData<{ id: string }>(submitted)).id;

      const assigned = await call(admin, `/api/v1/reviews/${submissionId}/assignment`, {
        method: 'POST',
        body: JSON.stringify({ reviewerId: REVIEWER_ONE_ID, rubricId }),
      });
      expect(assigned.status).toBe(200);

      const assignmentNotification = await databaseValue<{ count: number }>(
        `SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND type='review.assigned' AND resource_id=?`,
        REVIEWER_ONE_ID,
        submissionId,
      );
      expect(assignmentNotification?.count).toBe(1);

      const mine = await readBody<Array<{ id: string; assignedReviewerId: string; rubricId: string }>>(
        await call(reviewerOne, '/api/v1/reviews?mine=true'),
      );
      const queued = mine.data.find((entry) => entry.id === submissionId);
      expect(queued?.assignedReviewerId).toBe(REVIEWER_ONE_ID);
      expect(queued?.rubricId).toBe(rubricId);
      expect((mine.meta?.rubrics as unknown[]).length).toBeGreaterThan(0);

      const foreignDecision = await call(reviewerTwo, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({
          result: 'approved',
          feedback: '',
          scores: criteria.map((criterion) => ({ criterionId: criterion.id, points: 90 })),
        }),
      });
      expect(foreignDecision.status).toBe(403);
      expect((await readBody(foreignDecision)).error?.code).toBe('REVIEWER_ASSIGNED');

      const missingScores = await call(reviewerOne, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({ result: 'approved', feedback: '', scores: [{ criterionId: criteria[0].id, points: 80 }] }),
      });
      expect(missingScores.status).toBe(422);
      expect((await readBody(missingScores)).error?.code).toBe('RUBRIC_SCORES_REQUIRED');

      const mismatched = await call(reviewerOne, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({
          result: 'approved',
          feedback: '',
          scores: [...criteria.map((criterion) => ({ criterionId: criterion.id, points: 80 })), { criterionId: 'criterion_unknown', points: 50 }],
        }),
      });
      expect(mismatched.status).toBe(422);
      expect((await readBody(mismatched)).error?.code).toBe('RUBRIC_MISMATCH');

      const decision = await call(reviewerOne, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({
          result: 'approved',
          feedback: '',
          scores: [
            { criterionId: criteria[0].id, points: 80 },
            { criterionId: criteria[1].id, points: 60 },
          ],
        }),
      });
      expect(decision.status).toBe(200);
      const decisionData = await readData<{ rubricId: string; totalScore: number }>(decision);
      expect(decisionData.rubricId).toBe(rubricId);
      expect(decisionData.totalScore).toBe(72);

      const stored = await databaseValue<{ total_score: number; scores_json: string }>(
        `SELECT total_score, scores_json FROM reviews WHERE submission_id=?`,
        submissionId,
      );
      expect(stored?.total_score).toBe(72);
      expect(JSON.parse(stored!.scores_json)).toHaveLength(2);

      const task = await databaseValue<{ status: string }>(`SELECT status FROM tasks WHERE id=?`, taskId);
      expect(task?.status).toBe('approved');
    });

    it('blocks self-review and allows a super-admin override of an assignment', async () => {
      const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'Override review task' });
      await completeChecklist(member, taskId);
      const submitted = await call(member, `/api/v1/tasks/${taskId}/submissions`, {
        method: 'POST',
        body: JSON.stringify(taskSubmission(1)),
      });
      const submissionId = (await readData<{ id: string }>(submitted)).id;

      const selfReview = await call(admin, `/api/v1/reviews/${submissionId}/assignment`, {
        method: 'POST',
        body: JSON.stringify({ reviewerId: MEMBER_ID }),
      });
      expect(selfReview.status).toBe(403);
      expect((await readBody(selfReview)).error?.code).toBe('SELF_REVIEW_FORBIDDEN');

      const assigned = await call(admin, `/api/v1/reviews/${submissionId}/assignment`, {
        method: 'POST',
        body: JSON.stringify({ reviewerId: REVIEWER_ONE_ID, rubricId: null }),
      });
      expect(assigned.status).toBe(200);

      const scoresWithoutRubric = await call(admin, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({ result: 'approved', feedback: '', scores: [{ criterionId: 'criterion_a', points: 90 }] }),
      });
      expect(scoresWithoutRubric.status).toBe(422);
      expect((await readBody(scoresWithoutRubric)).error?.code).toBe('RUBRIC_REQUIRED');

      const override = await call(admin, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({ result: 'approved', feedback: '' }),
      });
      expect(override.status).toBe(200);
      expect((await readData<{ totalScore: number | null }>(override)).totalScore).toBeNull();

      const selfDecision = await call(admin, `/api/v1/reviews/${submissionId}`, {
        method: 'POST',
        body: JSON.stringify({ result: 'approved', feedback: '' }),
      });
      expect(selfDecision.status).toBe(409);
      expect((await readBody(selfDecision)).error?.code).toBe('ALREADY_REVIEWED');
    });
  });

  describe('notification preferences and digests', () => {
    it('filters in-app notifications by category preference', async () => {
      const notificationId = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body)
        VALUES (?, ?, 'task.github_merged', 'Pull request merged', 'The task is ready for evidence submission.')`)
        .bind(notificationId, MEMBER_ID).run();

      const before = await readData<Array<{ id: string }>>(
        await call(member, '/api/v1/collaboration/notifications?type=task.github_merged'),
      );
      expect(before.some((entry) => entry.id === notificationId)).toBe(true);
      const unreadBefore = await readData<{ count: number }>(
        await call(member, '/api/v1/collaboration/notifications/unread-count'),
      );

      const saved = await call(member, '/api/v1/collaboration/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ categories: { task: { inApp: false, email: false } }, digestFrequency: 'daily' }),
      });
      expect(saved.status).toBe(200);
      const preferences = await readData<{
        categories: Array<{ category: string; inApp: boolean; email: boolean }>;
        digestFrequency: string;
      }>(saved);
      expect(preferences.categories.find((entry) => entry.category === 'task')?.inApp).toBe(false);
      expect(preferences.categories.find((entry) => entry.category === 'account')?.inApp).toBe(true);
      expect(preferences.digestFrequency).toBe('daily');

      const after = await readData<Array<{ id: string }>>(
        await call(member, '/api/v1/collaboration/notifications?type=task.github_merged'),
      );
      expect(after.some((entry) => entry.id === notificationId)).toBe(false);
      const unreadAfter = await readData<{ count: number }>(
        await call(member, '/api/v1/collaboration/notifications/unread-count'),
      );
      // Disabling the whole `task` category hides every unread task notification,
      // so the badge must not increase and the seeded item is no longer visible.
      expect(unreadAfter.count).toBeLessThan(unreadBefore.count);

      const invalid = await call(member, '/api/v1/collaboration/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ categories: { unknown: { inApp: true, email: true } } }),
      });
      expect(invalid.status).toBe(422);

      await call(member, '/api/v1/collaboration/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({ categories: { task: { inApp: true, email: false } }, digestFrequency: 'weekly' }),
      });
      const restored = await readData<Array<{ id: string }>>(
        await call(member, '/api/v1/collaboration/notifications?type=task.github_merged'),
      );
      expect(restored.some((entry) => entry.id === notificationId)).toBe(true);
    });

    it('creates idempotent, provider-gated digests', async () => {
      const fixedNow = 1_800_000_000;
      const first = await createDigest(bindings, MEMBER_ID, { frequency: 'daily', now: fixedNow });
      expect(first.created).toBe(true);
      expect(first.status).toBe('skipped');
      expect(first.reason).toBe('email-disabled');

      const second = await createDigest(bindings, MEMBER_ID, { frequency: 'daily', now: fixedNow });
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);
      expect(second.periodStart).toBe(first.periodStart);

      const rows = await databaseValue<{ count: number }>(
        `SELECT COUNT(*) AS count FROM notification_digests WHERE user_id=? AND period_start=?`,
        MEMBER_ID,
        first.periodStart,
      );
      expect(rows?.count).toBe(1);

      const manual = await call(member, '/api/v1/collaboration/notifications/digest', {
        method: 'POST',
        body: JSON.stringify({ frequency: 'weekly' }),
      });
      expect(manual.status).toBe(200);
      const digest = await readData<{ status: string; itemCount: number }>(manual);
      expect(['created', 'skipped', 'failed']).toContain(digest.status);
      expect(digest.itemCount).toBeGreaterThanOrEqual(0);

      const invalid = await call(member, '/api/v1/collaboration/notifications/digest', {
        method: 'POST',
        body: JSON.stringify({ frequency: 'hourly' }),
      });
      expect(invalid.status).toBe(422);
    });
  });

  describe('GitHub pull request and CI state', () => {
    const webhookSecret = 'phase2-webhook-secret-2026';
    const repository = 'Mostafa-Galal-sudo/cerberus-workspace';

    async function deliver(eventType: string, deliveryId: string, payload: unknown) {
      const raw = JSON.stringify(payload);
      const signature = await computeHmacSha256(webhookSecret, raw);
      return call(null, '/api/v1/github/webhook', {
        method: 'POST',
        headers: {
          'x-github-event': eventType,
          'x-github-delivery': deliveryId,
          'x-hub-signature-256': `sha256=${signature}`,
        },
        body: raw,
      });
    }

    it('persists pull requests, check rollups and merge readiness notifications', async () => {
      const settings = await call(admin, '/api/v1/github/settings', {
        method: 'POST',
        body: JSON.stringify({ enabled: true, repository, syncBranch: 'main', webhookSecret }),
      });
      expect(settings.status).toBe(200);

      const taskId = await createTask(admin, { assigneeId: MEMBER_ID, title: 'GitHub PR state task' });
      const headSha = 'c0ffee1234567890abcdef';

      const opened = await deliver('pull_request', 'phase2-pr-opened', {
        action: 'opened',
        repository: { full_name: repository },
        pull_request: {
          id: 9001,
          number: 77,
          title: `feat(github): ${taskId} pull request state`,
          body: '',
          html_url: `https://github.com/${repository}/pull/77`,
          state: 'open',
          draft: true,
          merged: false,
          head: { ref: 'feature/pr-state', sha: headSha },
          base: { ref: 'main' },
        },
      });
      expect(opened.status).toBe(200);

      const listed = await readBody<Array<{
        number: number;
        state: string;
        draft: number;
        headRef: string;
        baseRef: string;
        checksStatus: string;
        taskTitles: string;
      }>>(await call(admin, '/api/v1/github/pull-requests'));
      const pullRequest = listed.data.find((entry) => entry.number === 77);
      expect(pullRequest).toMatchObject({
        state: 'open',
        draft: 1,
        headRef: 'feature/pr-state',
        baseRef: 'main',
        checksStatus: 'unknown',
      });
      expect(pullRequest?.taskTitles).toContain('GitHub PR state task');

      const checks = await deliver('check_suite', 'phase2-check-suite', {
        repository: { full_name: repository },
        check_suite: { head_sha: headSha, status: 'completed', conclusion: 'success' },
      });
      expect(checks.status).toBe(200);

      const afterChecks = await readBody<Array<{ number: number; checksStatus: string }>>(
        await call(admin, '/api/v1/github/pull-requests?state=open'),
      );
      expect(afterChecks.data.find((entry) => entry.number === 77)?.checksStatus).toBe('success');

      const merged = await deliver('pull_request', 'phase2-pr-merged', {
        action: 'closed',
        repository: { full_name: repository },
        pull_request: {
          id: 9001,
          number: 77,
          title: `feat(github): ${taskId} pull request state`,
          body: '',
          html_url: `https://github.com/${repository}/pull/77`,
          state: 'closed',
          draft: false,
          merged: true,
          merged_at: '2026-10-24T12:00:00Z',
          head: { ref: 'feature/pr-state', sha: headSha },
          base: { ref: 'main' },
        },
      });
      expect(merged.status).toBe(200);

      const mergedList = await readBody<Array<{ number: number; state: string }>>(
        await call(admin, '/api/v1/github/pull-requests?state=merged'),
      );
      expect(mergedList.data.find((entry) => entry.number === 77)?.state).toBe('merged');

      const stillOpen = await readBody<Array<{ number: number }>>(
        await call(admin, '/api/v1/github/pull-requests?state=open'),
      );
      expect(stillOpen.data.some((entry) => entry.number === 77)).toBe(false);

      const notification = await databaseValue<{ count: number }>(
        `SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND type='task.github_merged' AND resource_id=?`,
        MEMBER_ID,
        taskId,
      );
      expect(notification?.count).toBe(1);

      // The merge is informational only: it must never bypass the evidence-gated review workflow.
      const task = await databaseValue<{ status: string }>(`SELECT status FROM tasks WHERE id=?`, taskId);
      expect(task?.status).toBe('backlog');

      const duplicate = await deliver('pull_request', 'phase2-pr-merged', { ignored: true });
      expect((await readData<{ duplicate?: boolean }>(duplicate)).duplicate).toBe(true);
    });
  });
});
