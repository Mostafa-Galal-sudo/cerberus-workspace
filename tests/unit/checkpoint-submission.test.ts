import { describe, expect, it } from 'vitest';
import { submissionSchema } from '../../shared/schemas/tasks';

// ──────────────────────────────────────────────────────────────────────────────
// Checkpoint eligibility logic (mirrors worker/routes/tasks.ts rules)
// ──────────────────────────────────────────────────────────────────────────────

interface CheckpointUser {
  id: string;
  permissions: string[];
}

interface CheckpointState {
  id: string;
  ownerId: string;
  status: string;
  taskCount: number;
  approvedTaskCount: number;
}

function canSubmitCheckpoint(
  cp: CheckpointState,
  user: CheckpointUser
): { allowed: boolean; code?: string; message?: string } {
  const hasTaskWork = user.permissions.includes('task.work');
  const hasTaskManage = user.permissions.includes('task.manage');

  // 1. Must have task.work or task.manage
  if (!hasTaskWork && !hasTaskManage) {
    return { allowed: false, code: 'FORBIDDEN', message: 'You do not have permission to submit checkpoints' };
  }

  // 2. Must be checkpoint owner or have task.manage
  if (cp.ownerId !== user.id && !hasTaskManage) {
    return { allowed: false, code: 'FORBIDDEN', message: 'Only the checkpoint owner or an administrator can submit' };
  }

  // 3. All tasks must be approved
  const pendingCount = cp.taskCount - cp.approvedTaskCount;
  if (cp.taskCount === 0 || pendingCount > 0) {
    return {
      allowed: false,
      code: 'TASKS_INCOMPLETE',
      message: `All mandatory checkpoint tasks must be approved first (${pendingCount} pending)`,
    };
  }

  // 4. Already submitted or approved — idempotency guard
  if (cp.status === 'ready_for_review' || cp.status === 'approved') {
    return { allowed: false, code: 'ALREADY_SUBMITTED', message: 'Checkpoint has already been submitted' };
  }

  return { allowed: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// Dependency cycle pre-check (mirrors frontend guard in task-detail-page)
// ──────────────────────────────────────────────────────────────────────────────

function hasDependencyCycle(
  taskId: string,
  proposedDepId: string,
  existingDependentIds: string[]
): { cycleDetected: boolean; reason?: string } {
  // Self-reference check
  if (proposedDepId === taskId) {
    return { cycleDetected: true, reason: 'A task cannot depend on itself' };
  }
  // If proposedDep already depends on taskId (direct cycle)
  if (existingDependentIds.includes(proposedDepId)) {
    return {
      cycleDetected: true,
      reason: `Adding this dependency would create a cycle: task ${proposedDepId} already depends on ${taskId}`,
    };
  }
  return { cycleDetected: false };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('Checkpoint Submission Eligibility', () => {
  const owner = { id: 'user_owner', permissions: ['task.work'] };
  const admin = { id: 'user_admin', permissions: ['task.work', 'task.manage'] };
  const supervisor = { id: 'user_supervisor', permissions: ['feedback.create'] };
  const anotherMember = { id: 'user_other', permissions: ['task.work'] };

  const readyCheckpoint: CheckpointState = {
    id: 'cp_1', ownerId: 'user_owner', status: 'in_progress',
    taskCount: 4, approvedTaskCount: 4,
  };
  const pendingCheckpoint: CheckpointState = {
    id: 'cp_2', ownerId: 'user_owner', status: 'in_progress',
    taskCount: 4, approvedTaskCount: 3,
  };
  const alreadySubmitted: CheckpointState = {
    id: 'cp_3', ownerId: 'user_owner', status: 'ready_for_review',
    taskCount: 4, approvedTaskCount: 4,
  };
  const approvedCheckpoint: CheckpointState = {
    id: 'cp_4', ownerId: 'user_owner', status: 'approved',
    taskCount: 4, approvedTaskCount: 4,
  };
  const emptyCheckpoint: CheckpointState = {
    id: 'cp_5', ownerId: 'user_owner', status: 'in_progress',
    taskCount: 0, approvedTaskCount: 0,
  };

  describe('Eligibility: All tasks approved', () => {
    it('allows the checkpoint owner to submit when all tasks are approved', () => {
      const result = canSubmitCheckpoint(readyCheckpoint, owner);
      expect(result.allowed).toBe(true);
    });

    it('allows admin (task.manage) to submit any checkpoint when all tasks are approved', () => {
      const result = canSubmitCheckpoint(readyCheckpoint, admin);
      expect(result.allowed).toBe(true);
    });

    it('allows admin to submit a checkpoint they do not own', () => {
      const foreignCheckpoint = { ...readyCheckpoint, ownerId: 'user_other_owner' };
      const result = canSubmitCheckpoint(foreignCheckpoint, admin);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Eligibility: Pending tasks remain', () => {
    it('rejects submission when 1 or more tasks are not yet approved', () => {
      const result = canSubmitCheckpoint(pendingCheckpoint, owner);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('TASKS_INCOMPLETE');
    });

    it('rejects even for admin if tasks are incomplete', () => {
      const result = canSubmitCheckpoint(pendingCheckpoint, admin);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('TASKS_INCOMPLETE');
    });

    it('rejects a checkpoint with zero tasks (nothing to submit)', () => {
      const result = canSubmitCheckpoint(emptyCheckpoint, owner);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('TASKS_INCOMPLETE');
    });
  });

  describe('RBAC: Permission checks', () => {
    it('rejects supervisors who lack task.work / task.manage', () => {
      const result = canSubmitCheckpoint(readyCheckpoint, supervisor);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('rejects a member who is not the checkpoint owner and lacks task.manage', () => {
      const result = canSubmitCheckpoint(readyCheckpoint, anotherMember);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });
  });

  describe('Idempotency: Already submitted/approved', () => {
    it('rejects re-submission of a checkpoint already in ready_for_review', () => {
      const result = canSubmitCheckpoint(alreadySubmitted, owner);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('ALREADY_SUBMITTED');
    });

    it('rejects re-submission of an already approved checkpoint', () => {
      const result = canSubmitCheckpoint(approvedCheckpoint, owner);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe('ALREADY_SUBMITTED');
    });
  });
});

describe('Checkpoint Submission Schema Validation', () => {
  it('accepts valid summary and evidence', () => {
    const result = submissionSchema.safeParse({
      summary: 'Completed all embedded systems tasks with verified CI output',
      evidence: [{ kind: 'github', label: 'PR #42', value: 'https://github.com/org/repo/pull/42' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects summary shorter than 20 characters', () => {
    const result = submissionSchema.safeParse({
      summary: 'Too short',
      evidence: [{ kind: 'url', label: 'Evidence', value: 'https://example.com' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.summary).toBeDefined();
    }
  });

  it('rejects an empty evidence array', () => {
    const result = submissionSchema.safeParse({
      summary: 'Completed all mandatory checkpoint tasks with full evidence trail',
      evidence: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.evidence).toBeDefined();
    }
  });

  it('rejects unknown evidence kind', () => {
    const result = submissionSchema.safeParse({
      summary: 'Completed all mandatory checkpoint tasks with full evidence trail',
      evidence: [{ kind: 'image', label: 'Screenshot', value: 'https://example.com/img.png' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects evidence with empty value', () => {
    const result = submissionSchema.safeParse({
      summary: 'Completed all mandatory checkpoint tasks with full evidence trail',
      evidence: [{ kind: 'url', label: 'Empty URL', value: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects evidence with empty label', () => {
    const result = submissionSchema.safeParse({
      summary: 'Completed all mandatory checkpoint tasks with full evidence trail',
      evidence: [{ kind: 'note', label: '', value: 'some note content here' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('Dependency Cycle Detection', () => {
  const taskId = 'task_A';
  const dependentIds = ['task_C', 'task_D']; // tasks that depend ON task_A

  it('detects a self-reference cycle', () => {
    const result = hasDependencyCycle(taskId, taskId, dependentIds);
    expect(result.cycleDetected).toBe(true);
    expect(result.reason).toContain('cannot depend on itself');
  });

  it('detects a direct cycle (proposing dep on a downstream task)', () => {
    const result = hasDependencyCycle(taskId, 'task_C', dependentIds);
    expect(result.cycleDetected).toBe(true);
    expect(result.reason).toContain('cycle');
  });

  it('allows a valid upstream dependency (no cycle)', () => {
    const result = hasDependencyCycle(taskId, 'task_B', dependentIds);
    expect(result.cycleDetected).toBe(false);
  });

  it('allows adding a dependency on a task that has no relation to the current task', () => {
    const result = hasDependencyCycle(taskId, 'task_X', []);
    expect(result.cycleDetected).toBe(false);
  });
});
