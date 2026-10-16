import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});

export const activationSchema = z.object({
  token: z.string().min(32).max(256),
  password: z.string().min(12).max(128)
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number')
    .regex(/[^A-Za-z0-9]/, 'Include a symbol'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(12).max(128),
  newPassword: z.string().min(12).max(128)
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number')
    .regex(/[^A-Za-z0-9]/, 'Include a symbol'),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ['newPassword'], message: 'Choose a password different from the temporary password',
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ActivationInput = z.infer<typeof activationSchema>;
