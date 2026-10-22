import type { Env } from '../types';
import { sha256 } from './security';

/**
 * Atomically records an attempt when the caller is still under the limit.
 * The existing login_attempts ledger is reused so no extra table is needed.
 */
export async function consumeRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds = 900,
  onlyFailures = false,
): Promise<boolean> {
  const keyHash = await sha256(key);
  const failureFilter = onlyFailures ? 'AND succeeded = 0' : '';
  const result = await env.DB.prepare(
    `INSERT INTO login_attempts (key_hash, succeeded)
     SELECT ?, 0
     WHERE (SELECT COUNT(*) FROM login_attempts
       WHERE key_hash = ? AND attempted_at > unixepoch() - ? ${failureFilter}) < ?`,
  ).bind(keyHash, keyHash, windowSeconds, limit).run();
  return result.meta.changes > 0;
}

/** Marks the most recent failed attempt for this key as successful (e.g. a valid login). */
export async function markRateLimitSuccess(env: Env, key: string): Promise<void> {
  const keyHash = await sha256(key);
  await env.DB.prepare(
    `UPDATE login_attempts SET succeeded = 1
     WHERE id = (SELECT id FROM login_attempts WHERE key_hash = ? AND succeeded = 0 ORDER BY id DESC LIMIT 1)`,
  ).bind(keyHash).run();
}
