import { z } from 'zod';

export const loginMfaSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().trim().min(6, 'Enter the 6-digit code or a recovery code').max(64),
});

export const mfaConfirmSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit authenticator code'),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(12, 'Enter your current password').max(128),
  code: z.string().trim().min(6, 'Enter an authenticator or recovery code').max(64),
});

export const mfaRecoveryRegenerateSchema = mfaDisableSchema;

export type LoginMfaInput = z.infer<typeof loginMfaSchema>;
