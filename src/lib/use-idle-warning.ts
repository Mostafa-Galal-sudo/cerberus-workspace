import { useCallback, useEffect, useRef, useState } from 'react';

/** The warning checks the clock at this cadence while the app is mounted. */
export const IDLE_TICK_MS = 5_000;
/** An active tab refreshes its server session at most once per this interval. */
export const ACTIVITY_HEARTBEAT_MS = 240_000;
/** Activity older than this window no longer counts as an active session. */
export const ACTIVITY_WINDOW_MS = 120_000;

export interface IdleWarningOptions {
  idleMinutes: number;
  /** Server timestamp (epoch seconds) of the last accepted request. */
  lastSeenAt: number | null;
  enabled: boolean;
  onStay: () => Promise<void>;
  onExpire: () => void;
}

export interface IdleWarningResult {
  warning: boolean;
  secondsLeft: number;
  stay: () => Promise<void>;
  dismiss: () => void;
}

/**
 * The server remains the authority for idle expiry. This hook only mirrors the
 * remaining time so the member is warned before the next request is rejected,
 * and heartbeats while the tab is genuinely active so reading without API calls
 * does not expire the session.
 */
export function warningWindowMs(idleMilliseconds: number): number {
  return Math.min(120_000, Math.max(60_000, Math.round(idleMilliseconds * 0.2)));
}

export function useIdleWarning({
  idleMinutes,
  lastSeenAt,
  enabled,
  onStay,
  onExpire,
}: IdleWarningOptions): IdleWarningResult {
  const idleMs = Math.max(1, idleMinutes) * 60_000;
  const deadline = lastSeenAt === null ? null : lastSeenAt * 1000 + idleMs;
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const expiredRef = useRef(false);
  const lastActivityRef = useRef(0);
  const lastHeartbeatRef = useRef(0);
  const stayRef = useRef(onStay);
  const expireRef = useRef(onExpire);

  useEffect(() => { stayRef.current = onStay; }, [onStay]);
  useEffect(() => { expireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    expiredRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(false);
  }, [lastSeenAt]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNow(Date.now()), IDLE_TICK_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const mountedAt = Date.now();
    if (lastActivityRef.current === 0) lastActivityRef.current = mountedAt;
    if (lastHeartbeatRef.current === 0) lastHeartbeatRef.current = mountedAt;
    const recordActivity = () => { lastActivityRef.current = Date.now(); };
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'keydown', 'visibilitychange'];
    for (const event of events) document.addEventListener(event, recordActivity, { passive: true });
    return () => {
      for (const event of events) document.removeEventListener(event, recordActivity);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const current = Date.now();
      if (current - lastActivityRef.current > ACTIVITY_WINDOW_MS) return;
      if (current - lastHeartbeatRef.current < ACTIVITY_HEARTBEAT_MS) return;
      lastHeartbeatRef.current = current;
      void stayRef.current().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(interval);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || deadline === null || now < deadline || expiredRef.current) return;
    expiredRef.current = true;
    expireRef.current();
  }, [deadline, enabled, now]);

  const warning = Boolean(
    enabled
    && deadline !== null
    && !dismissed
    && now >= deadline - warningWindowMs(idleMs)
    && now < deadline,
  );
  const secondsLeft = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));

  const stay = useCallback(async () => {
    try {
      await stayRef.current();
      lastHeartbeatRef.current = Date.now();
      lastActivityRef.current = Date.now();
      setNow(Date.now());
      setDismissed(false);
    } catch {
      // If the server rejects the refresh the session is already gone.
    }
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { warning, secondsLeft, stay, dismiss };
}
