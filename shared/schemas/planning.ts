import { z } from 'zod';
import { dateOnlySchema } from './dates';

export const taskWorklogSchema = z.object({
  workedOn: dateOnlySchema,
  hours: z.number().min(0.25, 'Log at least 15 minutes').max(24, 'A day cannot exceed 24 logged hours'),
  note: z.string().trim().max(2_000).default(''),
});

export const taskSchedulePatchSchema = z.object({
  startDate: dateOnlySchema.nullable().optional(),
  dueDate: dateOnlySchema.nullable().optional(),
  estimateHours: z.number().min(0).max(10_000).optional(),
});

export const rubricCriterionSchema = z.object({
  label: z.string().trim().min(2).max(120),
  weight: z.number().min(1).max(100),
});

export const reviewRubricBaseSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2_000).default(''),
  criteria: z.array(rubricCriterionSchema).min(2).max(12),
});

export const reviewRubricSchema = reviewRubricBaseSchema.superRefine((value, ctx) => {
  const labels = new Set<string>();
  let weight = 0;
  value.criteria.forEach((criterion, index) => {
    const key = criterion.label.toLowerCase();
    if (labels.has(key)) {
      ctx.addIssue({ code: 'custom', path: ['criteria', index, 'label'], message: 'Criterion labels must be unique' });
    }
    labels.add(key);
    weight += criterion.weight;
  });
  if (Math.abs(weight - 100) > 0.01) {
    ctx.addIssue({ code: 'custom', path: ['criteria'], message: 'Criterion weights must sum to 100' });
  }
});

export const reviewRubricStateSchema = z.object({ active: z.boolean() });

export const reviewAssignmentSchema = z.object({
  reviewerId: z.string().trim().min(1).max(120),
  rubricId: z.string().trim().min(1).max(120).nullable().optional(),
});

export const notificationCategories = ['task', 'review', 'collaboration', 'account', 'digest'] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

export const notificationPreferencesSchema = z.object({
  // Partial record: a client may update a subset of categories. Zod 4's
  // z.record() with an enum key requires every key, which would reject that.
  categories: z.partialRecord(
    z.enum(notificationCategories),
    z.object({ inApp: z.boolean(), email: z.boolean() }),
  ).default({}),
  digestFrequency: z.enum(['off', 'daily', 'weekly']).default('off'),
});
