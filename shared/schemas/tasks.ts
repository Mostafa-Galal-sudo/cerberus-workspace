import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'backlog', 'in_progress', 'ready_for_review', 'approved', 'blocked', 'changes_requested', 'archived',
]);

export const createTaskSchema = z.object({
  projectId: z.string().min(1),
  domainId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  checkpointId: z.string().nullable().optional(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(10_000),
  prerequisites: z.string().max(5_000).default(''),
  inputs: z.string().max(5_000).default(''),
  implementationSteps: z.string().max(10_000).default(''),
  requiredTools: z.string().max(5_000).default(''),
  expectedOutputs: z.string().max(5_000).default(''),
  deliverables: z.string().max(5_000).default(''),
  acceptanceCriteria: z.string().trim().min(10).max(10_000),
  validationProcedure: z.string().trim().min(10).max(10_000),
  evidenceRequirements: z.string().trim().min(3).max(5_000),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export const updateTaskStatusSchema = z.object({ status: taskStatusSchema.exclude(['approved']) });

export const submissionSchema = z.object({
  summary: z.string().trim().min(20).max(10_000),
  evidence: z.array(z.object({
    kind: z.enum(['url', 'github', 'attachment', 'note']),
    label: z.string().trim().min(1).max(120),
    value: z.string().trim().min(1).max(2_000),
  })).min(1).max(20),
});

export const reviewSchema = z.object({
  result: z.enum(['approved', 'changes_requested']),
  feedback: z.string().trim().max(5_000).default(''),
}).superRefine((value, ctx) => {
  if (value.result === 'changes_requested' && value.feedback.length < 10) {
    ctx.addIssue({ code: 'custom', path: ['feedback'], message: 'Actionable feedback is required' });
  }
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
