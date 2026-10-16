import { describe, expect, it } from 'vitest';
import { activationSchema, changePasswordSchema } from '../../shared/schemas/auth';
import { reviewSchema, submissionSchema } from '../../shared/schemas/tasks';

describe('workflow validation', () => {
  it('rejects weak activation passwords', () => {
    expect(activationSchema.safeParse({ token: 'x'.repeat(40), password: 'all-lowercase-password' }).success).toBe(false);
  });
  it('requires a strong replacement different from the temporary password', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'Temporary!Password1', newPassword: 'Temporary!Password1' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'Temporary!Password1', newPassword: 'A-New-Secure!Password2' }).success).toBe(true);
  });
  it('requires evidence for submissions', () => {
    expect(submissionSchema.safeParse({ summary: 'A sufficiently detailed summary of the implementation.', evidence: [] }).success).toBe(false);
  });
  it('requires actionable feedback when changes are requested', () => {
    expect(reviewSchema.safeParse({ result: 'changes_requested', feedback: 'no' }).success).toBe(false);
    expect(reviewSchema.safeParse({ result: 'approved', feedback: '' }).success).toBe(true);
  });
});
