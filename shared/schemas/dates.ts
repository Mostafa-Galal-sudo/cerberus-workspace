import { z } from 'zod';

/** A calendar date in UTC, encoded as YYYY-MM-DD. */
export const dateOnlySchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date').refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, 'Use a real calendar date');

export function dateOnlyToEpoch(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

export function epochToDateOnly(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

/** Current date key in UTC; scheduling is deliberately timezone-stable. */
export function todayDateOnly(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Monday-based week start for a date key. */
export function weekStartDateOnly(value: string): string {
  const epoch = dateOnlyToEpoch(value);
  const weekday = new Date(epoch * 1000).getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return epochToDateOnly(epoch + offset * 86_400);
}

export function addDaysDateOnly(value: string, days: number): string {
  return epochToDateOnly(dateOnlyToEpoch(value) + days * 86_400);
}
