import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warningWindowMs, useIdleWarning } from '../../src/lib/use-idle-warning';

const NOW = new Date('2026-11-12T12:00:00Z').getTime();
const SECONDS = 1000;

describe('idle warning hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the warning window between one and two minutes', () => {
    expect(warningWindowMs(5 * 60 * SECONDS)).toBe(60_000);
    expect(warningWindowMs(8 * 60 * 60 * SECONDS)).toBe(120_000);
  });

  it('warns inside the idle window and expires exactly once', async () => {
    const onExpire = vi.fn();
    const lastSeenAt = Math.floor(NOW / 1000) - (10 * 60 - 30);

    const { result } = renderHook(() => useIdleWarning({
      idleMinutes: 10,
      lastSeenAt,
      enabled: true,
      onStay: vi.fn(async () => undefined),
      onExpire,
    }));

    expect(result.current.warning).toBe(true);
    expect(result.current.secondsLeft).toBeGreaterThan(20);

    await act(async () => { vi.advanceTimersByTime(40_000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(result.current.warning).toBe(false);

    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('extends the deadline when the server returns a newer lastSeenAt', async () => {
    const onExpire = vi.fn();
    const lastSeenAt = Math.floor(NOW / 1000) - (10 * 60 - 30);
    const onStay = vi.fn(async () => undefined);

    const { result, rerender } = renderHook(
      ({ seenAt }: { seenAt: number }) => useIdleWarning({
        idleMinutes: 10,
        lastSeenAt: seenAt,
        enabled: true,
        onStay,
        onExpire,
      }),
      { initialProps: { seenAt: lastSeenAt } },
    );

    expect(result.current.warning).toBe(true);
    await act(async () => { await result.current.stay(); });
    expect(onStay).toHaveBeenCalledTimes(1);

    rerender({ seenAt: Math.floor(NOW / 1000) });
    expect(result.current.warning).toBe(false);
    expect(result.current.secondsLeft).toBeGreaterThan(590);
  });

  it('stays silent while disabled', async () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useIdleWarning({
      idleMinutes: 5,
      lastSeenAt: Math.floor(NOW / 1000) - 10 * 60,
      enabled: false,
      onStay: vi.fn(async () => undefined),
      onExpire,
    }));

    expect(result.current.warning).toBe(false);
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(onExpire).not.toHaveBeenCalled();
  });
});
