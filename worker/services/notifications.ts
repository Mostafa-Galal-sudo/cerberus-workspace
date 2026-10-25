import type { Env } from '../types';
import { emailDeliveryConfigured, sendEmail } from './email';

export const NOTIFICATION_CATEGORIES = ['task', 'review', 'collaboration', 'account', 'digest'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationPreference {
  category: NotificationCategory;
  inApp: boolean;
  email: boolean;
}

interface PreferenceRow {
  category: NotificationCategory;
  in_app: number;
  email: number;
}

/**
 * Maps a notification `type` to the preference category it belongs to. Kept in
 * SQL so the read path filters without rewriting any of the existing insert
 * sites across the workspace.
 */
export function notificationCategorySql(column = 'type'): string {
  return `CASE
    WHEN ${column} LIKE 'task.%' THEN 'task'
    WHEN ${column} LIKE 'review.%' THEN 'review'
    WHEN ${column} LIKE 'digest.%' THEN 'digest'
    WHEN ${column} LIKE 'account.%' OR ${column} LIKE 'auth.%' OR ${column} LIKE 'user.%'
      OR ${column} LIKE 'invitation.%' OR ${column} LIKE 'password.%' THEN 'account'
    ELSE 'collaboration'
  END`;
}

export async function readNotificationPreferences(db: D1Database, userId: string): Promise<{
  categories: NotificationPreference[];
  digestFrequency: 'off' | 'daily' | 'weekly';
}> {
  const [rows, settings] = await Promise.all([
    db.prepare(`SELECT category, in_app, email FROM notification_preferences WHERE user_id=?`)
      .bind(userId).all<PreferenceRow>(),
    db.prepare(`SELECT digest_frequency AS digestFrequency FROM notification_settings WHERE user_id=?`)
      .bind(userId).first<{ digestFrequency: 'off' | 'daily' | 'weekly' }>(),
  ]);

  const byCategory = new Map(rows.results.map((row) => [row.category, row]));
  return {
    categories: NOTIFICATION_CATEGORIES.map((category) => {
      const row = byCategory.get(category);
      return {
        category,
        inApp: row ? row.in_app === 1 : true,
        email: row ? row.email === 1 : category === 'account',
      };
    }),
    digestFrequency: settings?.digestFrequency ?? 'off',
  };
}

export function categoryPrefersEmail(preferences: NotificationPreference[], category: NotificationCategory): boolean {
  return preferences.find((entry) => entry.category === category)?.email ?? false;
}

export interface DigestOutcome {
  id: string;
  periodStart: number;
  periodEnd: number;
  itemCount: number;
  status: 'created' | 'emailed' | 'skipped' | 'failed';
  created: boolean;
  emailProvider: string;
  reason?: string;
}

/**
 * Creates one digest per user per period. The `WHERE NOT EXISTS` guard makes
 * repeated cron runs and manual triggers idempotent without a unique index.
 */
export async function createDigest(
  env: Env,
  userId: string,
  options: { frequency: 'daily' | 'weekly'; now?: number },
): Promise<DigestOutcome> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const seconds = options.frequency === 'daily' ? 86_400 : 7 * 86_400;
  const periodStart = now - seconds;
  const periodEnd = now;

  const unread = await env.DB.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread
    FROM notifications WHERE user_id=? AND created_at > ? AND created_at <= ? AND type NOT LIKE 'digest.%'`)
    .bind(userId, periodStart, periodEnd).first<{ count: number; unread: number }>();

  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO notification_digests (id, user_id, period_start, period_end, item_count, status)
    SELECT ?, ?, ?, ?, ?, 'created'
    WHERE NOT EXISTS (SELECT 1 FROM notification_digests WHERE user_id=? AND period_start=?)`)
    .bind(id, userId, periodStart, periodEnd, unread?.unread ?? 0, userId, periodStart).run();

  const row = await env.DB.prepare(`SELECT id, period_start AS periodStart, period_end AS periodEnd,
      item_count AS itemCount, status, email_status AS emailStatus
    FROM notification_digests WHERE user_id=? AND period_start=?`)
    .bind(userId, periodStart).first<{
      id: string; periodStart: number; periodEnd: number; itemCount: number;
      status: 'created' | 'emailed' | 'skipped' | 'failed'; emailStatus: string | null;
    }>();

  if (!row) throw new Error('Digest creation failed');
  const created = row.id === id;

  if (!created || row.status !== 'created') {
    return {
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      itemCount: row.itemCount,
      status: row.status,
      created: false,
      emailProvider: (env.EMAIL_PROVIDER ?? 'none').toLowerCase(),
      reason: row.emailStatus ?? undefined,
    };
  }

  const recipient = await env.DB.prepare(`SELECT email, display_name AS displayName FROM users WHERE id=?`)
    .bind(userId).first<{ email: string; displayName: string }>();
  const preferences = await readNotificationPreferences(env.DB, userId);
  const shouldEmail = Boolean(recipient?.email) && categoryPrefersEmail(preferences.categories, 'digest');

  if (!shouldEmail || !emailDeliveryConfigured(env)) {
    const reason = shouldEmail ? 'email-provider-unconfigured' : 'email-disabled';
    await env.DB.prepare(`UPDATE notification_digests SET status='skipped', email_status=? WHERE id=?`)
      .bind(reason, row.id).run();
    return {
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      itemCount: row.itemCount,
      status: 'skipped',
      created: true,
      emailProvider: (env.EMAIL_PROVIDER ?? 'none').toLowerCase(),
      reason,
    };
  }

  const top = await env.DB.prepare(`SELECT title FROM notifications WHERE user_id=? AND created_at > ? AND created_at <= ?
    AND read_at IS NULL AND type NOT LIKE 'digest.%' ORDER BY created_at DESC LIMIT 10`)
    .bind(userId, periodStart, periodEnd).all<{ title: string }>();

  const label = options.frequency === 'daily' ? 'Daily' : 'Weekly';
  const result = await sendEmail(env, {
    to: recipient!.email,
    subject: `${label} CERBERUS Workspace digest: ${row.itemCount} unread notification${row.itemCount === 1 ? '' : 's'}`,
    text: [
      `${label} digest for ${recipient!.displayName}.`,
      '',
      ...(top.results.length > 0 ? top.results.map((item) => `- ${item.title}`) : ['No unread notifications in this period.']),
      '',
      'Open the workspace to review the full activity feed.',
    ].join('\n'),
  });

  const status = result.sent ? 'emailed' : 'failed';
  await env.DB.prepare(`UPDATE notification_digests SET status=?, email_status=? WHERE id=?`)
    .bind(status, result.sent ? result.provider : result.reason ?? result.provider, row.id).run();

  return {
    id: row.id,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    itemCount: row.itemCount,
    status,
    created: true,
    emailProvider: result.provider,
    reason: result.reason,
  };
}

/** Runs due digests from the scheduled handler. Never throws. */
export async function runScheduledDigests(env: Env, now = new Date()): Promise<void> {
  try {
    const users = await env.DB.prepare(`SELECT s.user_id AS userId, s.digest_frequency AS frequency
      FROM notification_settings s JOIN users u ON u.id = s.user_id
      WHERE s.digest_frequency IN ('daily','weekly') AND u.archived_at IS NULL AND u.status='active'`)
      .all<{ userId: string; frequency: 'daily' | 'weekly' }>();

    const weekday = now.getUTCDay();
    for (const user of users.results) {
      if (user.frequency === 'weekly' && weekday !== 1) continue;
      await createDigest(env, user.userId, { frequency: user.frequency });
    }
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      service: 'notification-digests',
      message: error instanceof Error ? error.message : 'unknown',
    }));
  }
}
