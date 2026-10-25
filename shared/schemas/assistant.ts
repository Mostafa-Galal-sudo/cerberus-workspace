import { z } from 'zod';

export const assistantMessageSchema = z.object({
  message: z.string().trim().min(1, 'Enter a question').max(8_000, 'Questions are limited to 8,000 characters'),
});

export const assistantThreadCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const assistantThreadRenameSchema = z.object({
  title: z.string().trim().min(1, 'A thread title is required').max(120),
});

export type AssistantMessageInput = z.infer<typeof assistantMessageSchema>;
