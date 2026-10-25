import type { AuthUser } from '../types';
import { addDaysDateOnly, dateOnlySchema, dateOnlyToEpoch, todayDateOnly, weekStartDateOnly } from '../../shared/schemas/dates';

/** Administrators can plan on behalf of any member. */
export function isPlanningAdmin(user: AuthUser): boolean {
  return user.permissions.includes('task.manage') || user.permissions.includes('workspace.admin');
}

/** Supervisors observe the plan but never mutate schedules or worklogs. */
export function isPlanningObserver(user: AuthUser): boolean {
  return user.roles.includes('project_supervisor');
}

/**
 * Returns the member whose planning data may be read, or null when the caller
 * asks for someone else's plan without an administrative or supervisory role.
 */
export function resolvePlanningMember(user: AuthUser, requestedMemberId: string | undefined): string | null {
  if (!requestedMemberId || requestedMemberId === user.id) return user.id;
  if (isPlanningAdmin(user) || isPlanningObserver(user)) return requestedMemberId;
  return null;
}

export interface PlanningWindow {
  from: string;
  to: string;
}

/**
 * Normalises an inclusive date window. Defaults to the current UTC week and
 * rejects ranges longer than 180 days so a single request cannot scan the
 * whole workspace history.
 */
export function resolveWindow(from: string | undefined, to: string | undefined, defaultDays: number): PlanningWindow | null {
  const fallbackFrom = weekStartDateOnly(todayDateOnly());
  const start = from ?? fallbackFrom;
  if (!dateOnlySchema.safeParse(start).success) return null;
  const end = to ?? addDaysDateOnly(start, defaultDays);
  if (!dateOnlySchema.safeParse(end).success) return null;
  if (end < start) return null;
  if ((dateOnlyToEpoch(end) - dateOnlyToEpoch(start)) / 86_400 > 180) return null;
  return { from: start, to: end };
}

/** Inclusive epoch-second window for date-only columns. */
export function windowEpochs(window: PlanningWindow): { start: number; end: number } {
  return {
    start: dateOnlyToEpoch(window.from),
    end: dateOnlyToEpoch(window.to) + 86_399,
  };
}

export function weekWindow(weekStart: string | undefined): PlanningWindow | null {
  const start = weekStart ?? weekStartDateOnly(todayDateOnly());
  if (!dateOnlySchema.safeParse(start).success) return null;
  return { from: start, to: addDaysDateOnly(start, 6) };
}

/** Shared projection so every planning surface reports identical task shapes. */
export const PLANNING_TASK_COLUMNS = `t.id, t.title, t.status, t.priority,
  t.start_date AS startDate, t.due_date AS dueDate, t.estimate_hours AS estimateHours,
  t.assignee_id AS assigneeId, u.display_name AS assigneeName,
  t.domain_id AS domainId, d.name AS domainName,
  (SELECT COALESCE(SUM(w.hours), 0) FROM task_worklogs w WHERE w.task_id = t.id) AS loggedHours`;
