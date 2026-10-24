import { z } from 'zod';
import { isSafeHttpUrl } from '../url';

export const idSchema = z.string().min(1).max(120);
const httpUrlSchema = z.string().trim().max(2048).refine(isSafeHttpUrl, 'Use an http(s) URL');
export const messageSchema = z.object({ body: z.string().trim().min(1).max(8_000), parentId: idSchema.nullable().optional() });
export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(180), body: z.string().trim().min(3).max(10_000),
  audience: z.enum(['all', 'members', 'supervisors', 'admins']).default('all'),
  published: z.boolean().default(true), expiresAt: z.number().int().positive().nullable().optional(),
});
export const worklogSchema = z.object({
  completedWork: z.string().trim().min(3).max(10_000), currentWork: z.string().max(10_000).default(''),
  problems: z.string().max(10_000).default(''), testsPerformed: z.string().max(10_000).default(''),
  evidence: z.string().max(10_000).default(''), nextSteps: z.string().max(10_000).default(''),
});
export const wikiSchema = z.object({
  title: z.string().trim().min(3).max(180), slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  category: z.string().trim().min(2).max(120), contentMarkdown: z.string().max(100_000),
  visibility: z.enum(['members', 'supervisor', 'admin']).default('members'), changeSummary: z.string().max(500).default(''),
  parentId: idSchema.nullable().optional(),
});
export const wikiVersionSchema = z.object({
  contentMarkdown: z.string().max(100_000).refine((value) => value.trim().length > 0, 'Markdown content is required'),
  changeSummary: z.string().max(500).default(''),
});
export const decisionSchema = z.object({
  title: z.string().trim().min(3).max(180), status: z.enum(['proposed', 'accepted', 'superseded']),
  reasoning: z.string().trim().min(10).max(20_000), alternatives: z.string().max(10_000).default(''),
  expectedImpact: z.string().max(10_000).default(''), supersedesId: idSchema.nullable().optional(),
});
export const issueSchema = z.object({
  title: z.string().trim().min(3).max(180), description: z.string().trim().min(10).max(20_000),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'), assigneeId: idSchema.nullable().optional(),
  taskId: idSchema.nullable().optional(), reproductionSteps: z.string().max(20_000).default(''),
});
export const hardwareSchema = z.object({
  name: z.string().trim().min(2).max(180), model: z.string().max(180).default(''), serialNumber: z.string().max(180).default(''),
  quantity: z.number().int().min(1).max(100_000), unitCost: z.number().min(0).nullable().optional(),
  condition: z.enum(['new', 'good', 'fair', 'damaged', 'retired']).default('good'),
  purchaseStatus: z.enum(['requested', 'ordered', 'available', 'unavailable']).default('available'),
  trackingMode: z.enum(['quantity', 'serialized']).default('quantity'),
  minQuantity: z.number().int().min(0).max(100_000).default(0),
  datasheetUrl: httpUrlSchema.or(z.literal('')).default(''), notes: z.string().max(10_000).default(''),
}).superRefine((value, ctx) => {
  if (value.trackingMode === 'serialized' && value.quantity !== 1) {
    ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'A serialized item is one physical unit; quantity must be 1' });
  }
  if (value.minQuantity > value.quantity) {
    ctx.addIssue({ code: 'custom', path: ['minQuantity'], message: 'The low-stock threshold cannot exceed the total quantity' });
  }
});
export const hardwareCheckoutSchema = z.object({
  holderId: idSchema,
  quantity: z.number().int().min(1).max(100_000),
  notes: z.string().trim().max(2_000).default(''),
});
export const hardwareReturnSchema = z.object({
  condition: z.enum(['new', 'good', 'fair', 'damaged', 'retired']),
  notes: z.string().trim().max(2_000).default(''),
});
export const hardwareMaintenanceSchema = z.object({
  kind: z.enum(['maintenance', 'calibration', 'inspection']),
  performedAt: z.number().int().positive().optional(),
  nextDueAt: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().min(3).max(5_000),
}).superRefine((value, ctx) => {
  if (value.nextDueAt && value.performedAt && value.nextDueAt <= value.performedAt) {
    ctx.addIssue({ code: 'custom', path: ['nextDueAt'], message: 'The next due date must be after the service date' });
  }
});
export const experimentSchema = z.object({
  experimentCode: z.string().trim().min(2).max(80), title: z.string().trim().min(3).max(180),
  objective: z.string().trim().min(10).max(20_000), hypothesis: z.string().trim().min(3).max(20_000),
  environment: z.string().trim().min(3).max(20_000), procedure: z.string().trim().min(10).max(30_000),
  expectedResults: z.string().max(20_000).default(''), reproducibility: z.string().max(20_000).default(''),
});

const experimentMetricSchema = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.number().min(-1_000_000_000_000).max(1_000_000_000_000).refine(Number.isFinite, 'Metric value must be finite').nullable().optional(),
  text: z.string().trim().max(2_000).nullable().optional(),
  unit: z.string().trim().max(20).default(''),
  observed: z.boolean().default(true),
}).superRefine((metric, ctx) => {
  if (typeof metric.value !== 'number' && !metric.text) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'A metric needs a numeric or text value' });
  }
});

export const experimentRunSchema = z.object({
  inputParameters: z.record(z.string().max(120), z.unknown()).default({})
    .refine((value) => JSON.stringify(value).length <= 10_000, 'Input parameters are too large'),
  actualResults: z.string().trim().min(3).max(20_000),
  validationNotes: z.string().trim().max(10_000).default(''),
  taskId: idSchema.nullable().optional(),
  checkpointId: idSchema.nullable().optional(),
  metrics: z.array(experimentMetricSchema).max(50).default([]),
}).superRefine((value, ctx) => {
  const names = new Set<string>();
  value.metrics.forEach((metric, index) => {
    const key = metric.name.toLowerCase();
    if (names.has(key)) ctx.addIssue({ code: 'custom', path: ['metrics', index, 'name'], message: 'Metric names must be unique within a run' });
    names.add(key);
  });
});
export const searchQuerySchema = z.string().trim().min(2).max(100);
export const feedbackSchema = z.object({ body: z.string().trim().min(3).max(10_000), resourceType: z.string().max(80).nullable().optional(), resourceId: idSchema.nullable().optional() });
export const integrationSchema = z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()).default({}) });
export const attachmentSchema = z.object({
  resourceType: z.string().min(1).max(80), resourceId: idSchema, label: z.string().min(1).max(180),
  storageType: z.enum(['cloudinary', 'external_private_link']), url: httpUrlSchema, publicId: z.string().max(500).nullable().optional(),
  mimeType: z.string().max(120).nullable().optional(), byteSize: z.number().int().nonnegative().nullable().optional(),
  visibility: z.enum(['members', 'supervisor', 'admin']).default('members'),
});
