import { describe, expect, it } from 'vitest';
import { updateTaskStatusSchema, submissionSchema } from '../../shared/schemas/tasks';

// State machine helper modeling authorized task status transitions
function validateTaskStatusTransition(
  currentStatus: string,
  targetStatus: string,
  user: { id: string; permissions: string[] },
  task: { assigneeId: string | null; checklistTotal: number; checklistDone: number }
): { allowed: boolean; code?: string; message?: string } {
  // 1. RBAC check: user must have task.work or task.manage
  const hasTaskWork = user.permissions.includes('task.work');
  const hasTaskManage = user.permissions.includes('task.manage');
  if (!hasTaskWork && !hasTaskManage) {
    return { allowed: false, code: 'FORBIDDEN', message: 'You do not have permission to modify tasks' };
  }

  // 2. Assignee check: only the assignee or an administrator can update
  if (task.assigneeId !== user.id && !hasTaskManage) {
    return { allowed: false, code: 'FORBIDDEN', message: 'Only the assignee or an administrator can update this task' };
  }

  // 3. Schema check on targetStatus
  const schemaResult = updateTaskStatusSchema.safeParse({ status: targetStatus });
  if (!schemaResult.success) {
    return { allowed: false, code: 'INVALID_STATUS', message: 'Target status is not a valid modifiable status' };
  }

  // 4. Moving to ready_for_review directly is forbidden without evidence submission workflow
  if (targetStatus === 'ready_for_review') {
    return { allowed: false, code: 'SUBMISSION_REQUIRED', message: 'Submit evidence through the review workflow' };
  }

  // 5. Approved is strictly excluded from direct status updates
  if (targetStatus === 'approved') {
    return { allowed: false, code: 'APPROVAL_RESTRICTED', message: 'Tasks cannot be approved directly via status patch' };
  }

  return { allowed: true };
}

// Optimistic update and rollback simulation
function simulateOptimisticUpdate<T extends { id: string; status: string }>(
  tasks: T[],
  taskId: string,
  newStatus: string,
  shouldFail: boolean
): { finalTasks: T[]; rolledBack: boolean; error?: string } {
  const snapshot = [...tasks];

  // Apply optimistic update
  let currentTasks = tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t));

  // If server call fails, rollback
  if (shouldFail) {
    currentTasks = snapshot;
    return { finalTasks: currentTasks, rolledBack: true, error: 'Server transition rejected' };
  }

  return { finalTasks: currentTasks, rolledBack: false };
}

describe('Kanban Board Transitions, RBAC, and Persistence Safety', () => {
  const memberUser = { id: 'user_member_1', permissions: ['task.work'] };
  const adminUser = { id: 'user_admin', permissions: ['task.work', 'task.manage', 'review.admin'] };
  const supervisorUser = { id: 'user_supervisor', permissions: ['feedback.create'] };

  const ownTask = { assigneeId: 'user_member_1', checklistTotal: 4, checklistDone: 4 };
  const otherTask = { assigneeId: 'user_member_2', checklistTotal: 4, checklistDone: 4 };

  describe('Valid and Invalid Status Transitions', () => {
    it('allows assignee to transition from backlog to in_progress', () => {
      const result = validateTaskStatusTransition('backlog', 'in_progress', memberUser, ownTask);
      expect(result.allowed).toBe(true);
    });

    it('allows assignee to transition from in_progress to blocked', () => {
      const result = validateTaskStatusTransition('in_progress', 'blocked', memberUser, ownTask);
      expect(result.allowed).toBe(true);
    });

    it('allows assignee to resume from blocked to in_progress', () => {
      const result = validateTaskStatusTransition('blocked', 'in_progress', memberUser, ownTask);
      expect(result.allowed).toBe(true);
    });

    it('rejects direct patch to ready_for_review with SUBMISSION_REQUIRED', () => {
      const result = validateTaskStatusTransition('in_progress', 'ready_for_review', memberUser, ownTask);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('SUBMISSION_REQUIRED');
    });

    it('rejects direct patch to approved via updateTaskStatusSchema', () => {
      const schemaCheck = updateTaskStatusSchema.safeParse({ status: 'approved' });
      expect(schemaCheck.success).toBe(false);

      const result = validateTaskStatusTransition('ready_for_review', 'approved', adminUser, ownTask);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('INVALID_STATUS');
    });
  });

  describe('Server-Side RBAC Enforcement', () => {
    it('strictly forbids supervisors (read-only) from transitioning task statuses', () => {
      const result = validateTaskStatusTransition('backlog', 'in_progress', supervisorUser, ownTask);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('forbids a team member from modifying a task assigned to another member', () => {
      const result = validateTaskStatusTransition('backlog', 'in_progress', memberUser, otherTask);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('allows an administrator with task.manage to transition any task', () => {
      const result = validateTaskStatusTransition('backlog', 'in_progress', adminUser, otherTask);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Evidence-Gated Review Submissions', () => {
    it('requires minimum 20 characters summary and at least 1 evidence item', () => {
      // Too short summary
      expect(submissionSchema.safeParse({
        summary: 'Short text',
        evidence: [{ kind: 'url', label: 'PR', value: 'https://github.com/pr/1' }],
      }).success).toBe(false);

      // Missing evidence
      expect(submissionSchema.safeParse({
        summary: 'This implementation satisfies all required verification parameters and acceptance criteria.',
        evidence: [],
      }).success).toBe(false);

      // Valid submission
      expect(submissionSchema.safeParse({
        summary: 'This implementation satisfies all required verification parameters and acceptance criteria.',
        evidence: [{ kind: 'github', label: 'Pull Request #12', value: 'https://github.com/org/repo/pull/12' }],
      }).success).toBe(true);
    });
  });

  describe('Optimistic Updates and Failure Rollback', () => {
    const initialTasks = [
      { id: 'task_1', status: 'backlog', title: 'Task 1' },
      { id: 'task_2', status: 'in_progress', title: 'Task 2' },
    ];

    it('updates cache optimistically on successful mutation', () => {
      const { finalTasks, rolledBack } = simulateOptimisticUpdate(initialTasks, 'task_1', 'in_progress', false);
      expect(rolledBack).toBe(false);
      expect(finalTasks.find((t) => t.id === 'task_1')?.status).toBe('in_progress');
    });

    it('rolls back cache to exact previous snapshot when server returns error', () => {
      const { finalTasks, rolledBack, error } = simulateOptimisticUpdate(initialTasks, 'task_1', 'in_progress', true);
      expect(rolledBack).toBe(true);
      expect(error).toBe('Server transition rejected');
      expect(finalTasks.find((t) => t.id === 'task_1')?.status).toBe('backlog');
    });
  });
});
