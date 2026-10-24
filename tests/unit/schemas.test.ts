import { describe, expect, it } from 'vitest';
import { activationSchema, changePasswordSchema } from '../../shared/schemas/auth';
import { reviewSchema, submissionSchema } from '../../shared/schemas/tasks';
import {
  experimentRunSchema,
  hardwareCheckoutSchema,
  hardwareReturnSchema,
  hardwareSchema,
} from '../../shared/schemas/workspace';

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

describe('phase 1 workspace validation', () => {
  const hardware = {
    name: 'ESP32 DevKit',
    model: 'ESP32-WROOM-32',
    serialNumber: 'HW-001',
    quantity: 4,
    condition: 'good',
    purchaseStatus: 'available',
    datasheetUrl: '',
    notes: '',
  };

  it('keeps serialized hardware to one physical unit', () => {
    const serialized = hardwareSchema.safeParse({ ...hardware, trackingMode: 'serialized' });
    expect(serialized.success).toBe(false);
    expect(hardwareSchema.safeParse({ ...hardware, quantity: 1, trackingMode: 'serialized' }).success).toBe(true);
    expect(hardwareSchema.safeParse({ ...hardware, trackingMode: 'quantity' }).success).toBe(true);
  });

  it('rejects a low-stock threshold above the tracked quantity', () => {
    expect(hardwareSchema.safeParse({ ...hardware, minQuantity: 5 }).success).toBe(false);
    expect(hardwareSchema.safeParse({ ...hardware, minQuantity: 4 }).success).toBe(true);
  });

  it('requires a condition and positive quantity for custody changes', () => {
    expect(hardwareCheckoutSchema.safeParse({ holderId: 'user_test_member', quantity: 0 }).success).toBe(false);
    expect(hardwareCheckoutSchema.safeParse({ holderId: 'user_test_member', quantity: 1 }).success).toBe(true);
    expect(hardwareReturnSchema.safeParse({}).success).toBe(false);
    expect(hardwareReturnSchema.safeParse({ condition: 'damaged', notes: 'Case cracked' }).success).toBe(true);
  });

  it('requires metric values and unique metric names in a run', () => {
    expect(experimentRunSchema.safeParse({
      actualResults: 'Measured the round-trip latency.',
      metrics: [{ name: 'rtt_ms' }],
    }).success).toBe(false);
    expect(experimentRunSchema.safeParse({
      actualResults: 'Measured the round-trip latency.',
      metrics: [{ name: 'rtt_ms', value: 41 }, { name: 'RTT_MS', value: 42 }],
    }).success).toBe(false);
    expect(experimentRunSchema.safeParse({
      actualResults: 'Measured the round-trip latency.',
      metrics: [{ name: 'rtt_ms', value: 41, unit: 'ms' }, { name: 'loss', text: 'none observed' }],
    }).success).toBe(true);
  });
});
