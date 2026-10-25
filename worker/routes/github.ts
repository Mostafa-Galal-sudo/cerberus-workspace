import { Hono } from 'hono';
import { safeHttpUrl } from '../../shared/url';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { createPullRequest, extractTaskIds, fetchChecksRollup, githubAuthMode, GithubApiError, syncRepository, type GithubChecksRollup } from '../services/github';
import { consumeRateLimit } from '../services/rate-limit';
import { verifyGithubSignature } from '../services/security';
import type { Env, Variables } from '../types';

export const githubRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const MAX_TASK_REFERENCE_LENGTH = 120;

function validRepository(value: string): boolean {
  const parts = value.split('/');
  if (parts.length !== 2) return false;
  const [owner, repository] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) return false;
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repository)) return false;
  return repository !== '.' && repository !== '..' && !repository.includes('..');
}

function validBranch(value: string): boolean {
  return /^[A-Za-z0-9._/-]{1,120}$/.test(value)
    && !value.includes('..')
    && !value.startsWith('/') && !value.endsWith('/')
    && !value.startsWith('-') && !value.endsWith('.lock');
}

function validTaskReference(value: string): boolean {
  return /^task_[A-Za-z0-9_-]{1,100}$/.test(value) && value.length <= MAX_TASK_REFERENCE_LENGTH;
}

function parseGithubConfig(raw: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function configString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

function githubErrorResult(error: unknown): { status: 502 | 503; body: { ok: false; error: { code: string; message: string } } } {
  if (error instanceof GithubApiError) {
    return {
      status: error.status === 503 ? 503 : 502,
      body: {
        ok: false,
        error: {
          code: error.status === 503 ? 'GITHUB_NOT_CONFIGURED' : 'GITHUB_API_ERROR',
          message: error.message,
        },
      },
    };
  }
  return {
    status: 502,
    body: {
      ok: false,
      error: { code: 'GITHUB_API_ERROR', message: error instanceof Error ? error.message : 'GitHub operation failed' },
    },
  };
}

// Webhook receiver (unauthenticated because GitHub calls it, but it fails closed
// unless the integration is enabled and an HMAC secret is configured.)
githubRoutes.post('/webhook', async (context) => {
  const address = context.req.header('CF-Connecting-IP') ?? 'local';
  if (!await consumeRateLimit(context.env, `github-webhook:${address}`, 120, 60)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many webhook deliveries' } }, 429);
  }
  const declaredLength = Number(context.req.header('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return context.json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Webhook payload is too large' } }, 413);
  }

  const deliveryId = (context.req.header('X-GitHub-Delivery') ?? crypto.randomUUID()).slice(0, 120);
  const eventType = (context.req.header('X-GitHub-Event') ?? 'ping').slice(0, 80);
  const signature = context.req.header('X-Hub-Signature-256');
  const rawBody = await context.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BYTES) {
    return context.json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Webhook payload is too large' } }, 413);
  }

  const settings = await context.env.DB.prepare(`SELECT enabled, config_json FROM integration_settings WHERE integration = 'github'`)
    .first<{ enabled: number; config_json: string }>();
  const config = parseGithubConfig(settings?.config_json);
  if (!settings?.enabled) {
    return context.json({ ok: false, error: { code: 'INTEGRATION_DISABLED', message: 'GitHub integration is disabled' } }, 503);
  }
  const configuredSecret = configString(config, 'webhookSecret');
  const secret = configuredSecret || context.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return context.json({ ok: false, error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'A webhook secret must be configured before deliveries are accepted' } }, 503);
  }
  if (!signature || !await verifyGithubSignature(secret, rawBody, signature)) {
    return context.json({ ok: false, error: { code: 'SIGNATURE_MISMATCH', message: 'Invalid or missing HMAC signature' } }, 401);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return context.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON payload' } }, 400);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return context.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON payload' } }, 400);
  }
  const payload = parsed as Record<string, unknown>;

  const deliveredRepository = typeof payload.repository === 'object' && payload.repository !== null && !Array.isArray(payload.repository)
    ? configString(payload.repository as Record<string, unknown>, 'full_name')
    : undefined;
  const configuredRepository = configString(config, 'repository');
  if (configuredRepository && deliveredRepository && deliveredRepository.toLowerCase() !== configuredRepository.toLowerCase()) {
    return context.json({ ok: false, error: { code: 'REPOSITORY_MISMATCH', message: 'Webhook repository does not match the configured integration' } }, 403);
  }

  const existingDelivery = await context.env.DB.prepare(`SELECT 1 FROM github_events WHERE delivery_id=?`).bind(deliveryId).first();
  if (existingDelivery) {
    return context.json({ ok: true, data: { received: true, deliveryId, eventType, duplicate: true } });
  }

  const eventId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, action, payload_json, processed_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())`)
      .bind(eventId, deliveryId, eventType, typeof payload.action === 'string' ? payload.action.slice(0, 80) : null, rawBody),
    audit(context.env, null, 'github.webhook_received', 'github_event', eventId, { deliveryId, eventType }),
  ];

  if (eventType === 'push' && Array.isArray(payload.commits)) {
    for (const rawCommit of payload.commits.slice(0, 50)) {
      if (typeof rawCommit !== 'object' || rawCommit === null) continue;
      const commit = rawCommit as Record<string, unknown>;
      const message = typeof commit.message === 'string' ? commit.message : '';
      const commitId = typeof commit.id === 'string' ? commit.id.slice(0, 120) : '';
      const commitUrl = safeHttpUrl(commit.url);
      if (!commitId || !commitUrl) continue;
      for (const taskId of extractTaskIds(message).filter(validTaskReference)) {
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
          SELECT ?, 'project_cerberus', 'task', ?, 'commit', ?, ?
          WHERE EXISTS (SELECT 1 FROM tasks WHERE id=? AND archived_at IS NULL)`)
          .bind(crypto.randomUUID(), taskId, commitId, commitUrl, taskId));
      }
    }
  }

  const repositoryName = deliveredRepository ?? configuredRepository ?? '';
  const pullRequest = eventType === 'pull_request' && typeof payload.pull_request === 'object' && payload.pull_request !== null
    ? payload.pull_request as Record<string, unknown>
    : null;

  if (pullRequest) {
    const number = typeof pullRequest.number === 'number' ? pullRequest.number : Number.NaN;
    const title = typeof pullRequest.title === 'string' ? pullRequest.title.slice(0, 300) : '';
    const body = typeof pullRequest.body === 'string' ? pullRequest.body : '';
    const pullRequestUrl = safeHttpUrl(pullRequest.html_url);
    const pullRequestId = typeof pullRequest.id === 'number' || typeof pullRequest.id === 'string' ? String(pullRequest.id).slice(0, 120) : '';
    if (pullRequestUrl && pullRequestId) {
      for (const taskId of extractTaskIds(`${title} ${body}`).filter(validTaskReference)) {
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
          SELECT ?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?
          WHERE EXISTS (SELECT 1 FROM tasks WHERE id=? AND archived_at IS NULL)`)
          .bind(crypto.randomUUID(), taskId, pullRequestId, pullRequestUrl, taskId));
      }
    }

    if (Number.isFinite(number) && number > 0 && pullRequestUrl && repositoryName) {
      const state = pullRequest.merged === true ? 'merged' : pullRequest.state === 'closed' ? 'closed' : 'open';
      const head = typeof pullRequest.head === 'object' && pullRequest.head !== null ? pullRequest.head as Record<string, unknown> : {};
      const base = typeof pullRequest.base === 'object' && pullRequest.base !== null ? pullRequest.base as Record<string, unknown> : {};
      const mergedAt = typeof pullRequest.merged_at === 'string'
        ? Math.floor(new Date(pullRequest.merged_at).getTime() / 1000)
        : null;

      statements.push(context.env.DB.prepare(`INSERT INTO github_pull_requests
        (id, project_id, repository, number, title, url, state, draft, head_ref, base_ref, head_sha, merged_at)
        VALUES (?, 'project_cerberus', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository, number) DO UPDATE SET
          title=excluded.title, url=excluded.url, state=excluded.state, draft=excluded.draft,
          head_ref=excluded.head_ref, base_ref=excluded.base_ref, head_sha=excluded.head_sha,
          merged_at=excluded.merged_at, updated_at=unixepoch()`)
        .bind(
          crypto.randomUUID(), repositoryName, number, title || `Pull request #${number}`, pullRequestUrl, state,
          pullRequest.draft === true ? 1 : 0,
          typeof head.ref === 'string' ? head.ref.slice(0, 200) : null,
          typeof base.ref === 'string' ? base.ref.slice(0, 200) : null,
          typeof head.sha === 'string' ? head.sha.slice(0, 80) : null,
          mergedAt,
        ));

      for (const taskId of extractTaskIds(`${title} ${body}`).filter(validTaskReference)) {
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_pull_request_tasks (pull_request_id, task_id)
          SELECT p.id, ? FROM github_pull_requests p WHERE p.repository=? AND p.number=?
            AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND archived_at IS NULL)`)
          .bind(taskId, repositoryName, number, taskId));
      }

      if (mergedAt) {
        // Merge readiness is informational only: the evidence-gated review
        // invariant still requires the assignee to submit through the workflow.
        statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
          SELECT lower(hex(randomblob(16))), t.assignee_id, 'task.github_merged', 'Pull request merged', ?, 'task', t.id
          FROM github_pull_request_tasks gpt
          JOIN github_pull_requests p ON p.id = gpt.pull_request_id
          JOIN tasks t ON t.id = gpt.task_id
          WHERE p.repository=? AND p.number=? AND t.assignee_id IS NOT NULL AND t.archived_at IS NULL`)
          .bind(
            `Pull request #${number} was merged. The task is ready for you to submit review evidence.`,
            repositoryName,
            number,
          ));
      }
    }
  }

  const checksSha = eventType === 'check_suite' && typeof payload.check_suite === 'object' && payload.check_suite !== null
    ? (payload.check_suite as Record<string, unknown>).head_sha
    : eventType === 'check_run' && typeof payload.check_run === 'object' && payload.check_run !== null
      ? (payload.check_run as Record<string, unknown>).head_sha
      : eventType === 'status'
        ? payload.sha
        : undefined;

  if (typeof checksSha === 'string' && checksSha && repositoryName) {
    const source = eventType === 'check_suite'
      ? payload.check_suite as Record<string, unknown>
      : eventType === 'check_run'
        ? payload.check_run as Record<string, unknown>
        : payload;
    const state = eventType === 'status'
      ? (typeof payload.state === 'string' ? payload.state : 'pending')
      : (typeof source.status === 'string' ? source.status : 'queued');
    const conclusion = typeof source.conclusion === 'string' ? source.conclusion : null;
    let checksStatus: 'unknown' | 'pending' | 'success' | 'failure' | 'neutral';
    if (eventType === 'status') {
      checksStatus = state === 'success' ? 'success' : state === 'failure' || state === 'error' ? 'failure' : 'pending';
    } else if (state !== 'completed') {
      checksStatus = 'pending';
    } else if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(conclusion ?? '')) {
      checksStatus = 'failure';
    } else if (['neutral', 'skipped', 'stale'].includes(conclusion ?? '')) {
      checksStatus = 'neutral';
    } else if (conclusion === 'success') {
      checksStatus = 'success';
    } else {
      checksStatus = 'unknown';
    }

    statements.push(context.env.DB.prepare(`UPDATE github_pull_requests
      SET checks_status=?, checks_json=?, updated_at=unixepoch()
      WHERE repository=? AND head_sha=? AND state='open'`)
      .bind(checksStatus, JSON.stringify({ source: eventType, state, conclusion, at: Math.floor(Date.now() / 1000) }), repositoryName, checksSha.slice(0, 80)));
  }

  try {
    await context.env.DB.batch(statements);
  } catch (error) {
    if (/UNIQUE constraint failed: github_events\.delivery_id/i.test(error instanceof Error ? error.message : String(error))) {
      return context.json({ ok: true, data: { received: true, deliveryId, eventType, duplicate: true } });
    }
    throw error;
  }
  return context.json({ ok: true, data: { received: true, deliveryId, eventType } });
});

// Authenticated GitHub endpoints
githubRoutes.use('*', requireAuth, requirePasswordChanged);

githubRoutes.get('/status', async (context) => {
  const [settings, events, links] = await Promise.all([
    context.env.DB.prepare(`SELECT enabled, config_json, updated_at AS updatedAt FROM integration_settings WHERE integration = 'github'`).first<{ enabled: number; config_json: string; updatedAt: number }>(),
    context.env.DB.prepare(`SELECT id, delivery_id AS deliveryId, event_type AS eventType, action, received_at AS receivedAt,
      substr(payload_json, 1, 250) AS payloadExcerpt
      FROM github_events ORDER BY received_at DESC LIMIT 20`).all(),
    context.env.DB.prepare(`SELECT gl.*, t.title AS taskTitle FROM github_links gl
      LEFT JOIN tasks t ON t.id = gl.resource_id
      ORDER BY gl.created_at DESC LIMIT 30`).all(),
  ]);

  const config = parseGithubConfig(settings?.config_json);
  const authMode = githubAuthMode(context.env);

  return context.json({
    ok: true,
    data: {
      enabled: Boolean(settings?.enabled),
      repository: configString(config, 'repository') ?? 'Mostafa-Galal-sudo/cerberus-firmware',
      syncBranch: configString(config, 'syncBranch') ?? 'main',
      hasSecret: Boolean(configString(config, 'webhookSecret') || context.env.GITHUB_WEBHOOK_SECRET),
      authMode,
      outboundReady: authMode !== 'none',
      lastSyncAt: typeof config.lastSyncAt === 'number' ? config.lastSyncAt : null,
      lastSyncStatus: typeof config.lastSyncStatus === 'string' ? config.lastSyncStatus : null,
      lastSyncCount: typeof config.lastSyncCount === 'number' ? config.lastSyncCount : 0,
      updatedAt: settings?.updatedAt,
      events: events.results,
      links: links.results,
    },
  });
});

githubRoutes.get('/pull-requests', async (context) => {
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 25)));
  const requested = context.req.query('state');
  const state = requested && ['open', 'closed', 'merged'].includes(requested) ? requested : null;

  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (state) { conditions.push('p.state = ?'); bindings.push(state); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT p.id, p.repository, p.number, p.title, p.url, p.state, p.draft,
        p.head_ref AS headRef, p.base_ref AS baseRef, p.head_sha AS headSha,
        p.checks_status AS checksStatus, p.checks_json AS checksJson, p.merged_at AS mergedAt,
        p.created_at AS createdAt, p.updated_at AS updatedAt,
        (SELECT group_concat(t.title, ' | ') FROM github_pull_request_tasks gpt
          JOIN tasks t ON t.id = gpt.task_id WHERE gpt.pull_request_id = p.id) AS taskTitles
      FROM github_pull_requests p ${where}
      ORDER BY p.updated_at DESC, p.number DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, limit, (page - 1) * limit).all(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM github_pull_requests p ${where}`)
      .bind(...bindings).first<{ count: number }>(),
  ]);

  return context.json({
    ok: true,
    data: rows.results,
    meta: {
      page,
      limit,
      total: total?.count ?? 0,
      hasMore: page * limit < (total?.count ?? 0),
      state: state ?? 'all',
    },
  });
});

githubRoutes.post('/settings', requirePermission('workspace.admin'), async (context) => {
  const body = await context.req.json<{ enabled?: boolean; repository?: string; webhookSecret?: string; syncBranch?: string }>().catch(() => ({} as { enabled?: boolean; repository?: string; webhookSecret?: string; syncBranch?: string }));
  const repository = body.repository?.trim();
  const syncBranch = body.syncBranch?.trim();
  if (repository && !validRepository(repository)) {
    return context.json({ ok: false, error: { code: 'INVALID_REPOSITORY', message: 'Repository must use a valid owner/name form' } }, 422);
  }
  if (syncBranch && !validBranch(syncBranch)) {
    return context.json({ ok: false, error: { code: 'INVALID_BRANCH', message: 'Branch name contains unsupported characters' } }, 422);
  }
  if (body.webhookSecret !== undefined && (typeof body.webhookSecret !== 'string' || body.webhookSecret.length > 256)) {
    return context.json({ ok: false, error: { code: 'INVALID_SECRET', message: 'Webhook secret must be a string of at most 256 characters' } }, 422);
  }
  const existing = await context.env.DB.prepare(`SELECT config_json FROM integration_settings WHERE integration = 'github'`).first<{ config_json: string }>();
  const currentConfig = parseGithubConfig(existing?.config_json);

  const nextConfig = {
    ...currentConfig,
    repository: repository !== undefined ? repository : currentConfig.repository,
    syncBranch: syncBranch !== undefined ? syncBranch : currentConfig.syncBranch,
    ...(body.webhookSecret !== undefined ? { webhookSecret: body.webhookSecret } : {}),
  };

  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : 1;

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO integration_settings (integration, enabled, config_json, updated_by, updated_at)
      VALUES ('github', ?, ?, ?, unixepoch())
      ON CONFLICT(integration) DO UPDATE SET enabled=excluded.enabled, config_json=excluded.config_json, updated_by=excluded.updated_by, updated_at=unixepoch()`)
      .bind(enabled, JSON.stringify(nextConfig), context.get('user').id),
    audit(context.env, context.get('user').id, 'github.settings_updated', 'integration', 'github'),
  ]);

  return context.json({ ok: true, data: { enabled: Boolean(enabled), repository: nextConfig.repository } });
});

githubRoutes.post('/sync', requirePermission('workspace.admin'), async (context) => {
  const settings = await context.env.DB.prepare(`SELECT enabled, config_json FROM integration_settings WHERE integration='github'`)
    .first<{ enabled: number; config_json: string }>();
  const storedConfig = parseGithubConfig(settings?.config_json);
  const config = {
    repository: configString(storedConfig, 'repository'),
    webhookSecret: configString(storedConfig, 'webhookSecret'),
    syncBranch: configString(storedConfig, 'syncBranch'),
    lastSyncAt: typeof storedConfig.lastSyncAt === 'number' ? storedConfig.lastSyncAt : undefined,
    lastSyncStatus: configString(storedConfig, 'lastSyncStatus'),
    lastSyncCount: typeof storedConfig.lastSyncCount === 'number' ? storedConfig.lastSyncCount : undefined,
  };

  if (!config.repository) {
    return context.json({ ok: false, error: { code: 'REPOSITORY_NOT_CONFIGURED', message: 'Save a GitHub repository before syncing' } }, 409);
  }
  if (!validRepository(config.repository)) {
    return context.json({ ok: false, error: { code: 'INVALID_REPOSITORY', message: 'Repository must use a valid owner/name form' } }, 422);
  }
  if (githubAuthMode(context.env) === 'none') {
    return context.json({ ok: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: 'Configure GITHUB_TOKEN or GitHub App credentials before syncing' } }, 503);
  }

  try {
    const result = await syncRepository(context.env, config.repository);
    const statements: D1PreparedStatement[] = [];
    let linked = 0;

    // Check rollups are best-effort: a CI lookup failure must not fail the sync.
    const checks = new Map<number, GithubChecksRollup>();
    const checkCandidates = result.pullRequests
      .filter((pullRequest) => typeof pullRequest.head?.sha === 'string' && pullRequest.head.sha)
      .slice(0, 10);
    await Promise.all(checkCandidates.map(async (pullRequest) => {
      try {
        checks.set(pullRequest.number, await fetchChecksRollup(context.env, result.repository.full_name, pullRequest.head!.sha!));
      } catch (error) {
        console.error(JSON.stringify({
          level: 'warn',
          service: 'github-sync-checks',
          message: error instanceof Error ? error.message : 'unknown',
          number: pullRequest.number,
        }));
      }
    }));

    for (const pullRequest of result.pullRequests) {
      const pullRequestUrl = safeHttpUrl(pullRequest.html_url);
      if (!pullRequestUrl) continue;
      const taskIds = extractTaskIds(`${pullRequest.title} ${pullRequest.body ?? ''}`).filter(validTaskReference);
      const rollup = checks.get(pullRequest.number);

      statements.push(context.env.DB.prepare(`INSERT INTO github_pull_requests
        (id, project_id, repository, number, title, url, state, draft, head_ref, base_ref, head_sha, checks_status, checks_json)
        VALUES (?, 'project_cerberus', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repository, number) DO UPDATE SET
          title=excluded.title, url=excluded.url, state=excluded.state, draft=excluded.draft,
          head_ref=excluded.head_ref, base_ref=excluded.base_ref, head_sha=excluded.head_sha,
          checks_status=excluded.checks_status, checks_json=excluded.checks_json, updated_at=unixepoch()`)
        .bind(
          crypto.randomUUID(), result.repository.full_name, pullRequest.number,
          pullRequest.title.slice(0, 300), pullRequestUrl,
          pullRequest.merged === true ? 'merged' : pullRequest.state === 'closed' ? 'closed' : 'open',
          pullRequest.draft ? 1 : 0,
          pullRequest.head?.ref ?? null, pullRequest.base?.ref ?? null, pullRequest.head?.sha ?? null,
          rollup?.status ?? 'unknown', JSON.stringify(rollup ?? {}),
        ));

      for (const taskId of taskIds) {
        linked += 1;
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links
          (id, project_id, resource_type, resource_id, github_type, github_id, url)
          SELECT ?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?
          WHERE EXISTS (SELECT 1 FROM tasks WHERE id=? AND archived_at IS NULL)`)
          .bind(crypto.randomUUID(), taskId, String(pullRequest.number).slice(0, 120), pullRequestUrl, taskId));
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_pull_request_tasks (pull_request_id, task_id)
          SELECT p.id, ? FROM github_pull_requests p WHERE p.repository=? AND p.number=?
            AND EXISTS (SELECT 1 FROM tasks WHERE id=? AND archived_at IS NULL)`)
          .bind(taskId, result.repository.full_name, pullRequest.number, taskId));
      }
    }

    const syncedAt = Math.floor(Date.now() / 1000);
    const nextConfig = {
      ...config,
      lastSyncAt: syncedAt,
      lastSyncStatus: 'success',
      lastSyncCount: result.pullRequests.length,
    };
    const eventId = crypto.randomUUID();
    statements.push(
      context.env.DB.prepare(`UPDATE integration_settings SET config_json=?, updated_by=?, updated_at=unixepoch() WHERE integration='github'`)
        .bind(JSON.stringify(nextConfig), context.get('user').id),
      context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, action, payload_json, processed_at)
        VALUES (?, ?, 'sync', 'completed', ?, unixepoch())`)
        .bind(eventId, `sync_${crypto.randomUUID()}`,
          JSON.stringify({ repository: result.repository.full_name, pullRequests: result.pullRequests.length, branches: result.branchCount, linked })),
      audit(context.env, context.get('user').id, 'github.repository_synced', 'integration', 'github', {
        repository: result.repository.full_name,
        pullRequests: result.pullRequests.length,
        linked,
      }),
    );

    await context.env.DB.batch(statements);
    return context.json({
      ok: true,
      data: {
        repository: result.repository.full_name,
        defaultBranch: result.repository.default_branch,
        pullRequests: result.pullRequests.length,
        branches: result.branchCount,
        linked,
        checksChecked: checks.size,
        syncedAt,
      },
    });
  } catch (error) {
    const failure = githubErrorResult(error);
    await context.env.DB.prepare(`UPDATE integration_settings SET config_json=?, updated_at=unixepoch() WHERE integration='github'`)
      .bind(JSON.stringify({ ...config, lastSyncStatus: 'failed' })).run();
    return context.json(failure.body, failure.status);
  }
});

githubRoutes.post('/pull-request', requirePermission('workspace.admin'), async (context) => {
  interface PullRequestBody {
    taskId?: string;
    title?: string;
    head?: string;
    base?: string;
    body?: string;
    draft?: boolean;
  }
  const body = await context.req.json<PullRequestBody>().catch(() => ({} as PullRequestBody));

  const taskId = body.taskId?.trim() ?? '';
  const title = body.title?.trim() ?? '';
  const head = body.head?.trim() ?? '';
  if (!taskId || !title || !head) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'taskId, title and head branch are required' } }, 422);
  }
  if (!validTaskReference(taskId)) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'taskId is invalid' } }, 422);
  }
  if (title.length < 3 || title.length > 180) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Pull request title must be 3-180 characters' } }, 422);
  }
  if ((body.body?.trim().length ?? 0) > 10_000) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Pull request body must be 10,000 characters or fewer' } }, 422);
  }
  if (!validBranch(head) || (body.base && !validBranch(body.base.trim()))) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Branch names contain unsupported characters' } }, 422);
  }

  const task = await context.env.DB.prepare(`SELECT id, title FROM tasks WHERE id=? AND archived_at IS NULL`).bind(taskId)
    .first<{ id: string; title: string }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  const settings = await context.env.DB.prepare(`SELECT config_json FROM integration_settings WHERE integration='github'`)
    .first<{ config_json: string }>();
  const storedConfig = parseGithubConfig(settings?.config_json);
  const config = {
    repository: configString(storedConfig, 'repository'),
    syncBranch: configString(storedConfig, 'syncBranch'),
  };
  if (!config.repository) {
    return context.json({ ok: false, error: { code: 'REPOSITORY_NOT_CONFIGURED', message: 'Save a GitHub repository before opening pull requests' } }, 409);
  }
  if (!validRepository(config.repository)) {
    return context.json({ ok: false, error: { code: 'INVALID_REPOSITORY', message: 'Repository must use a valid owner/name form' } }, 422);
  }
  if (githubAuthMode(context.env) === 'none') {
    return context.json({ ok: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: 'Configure GITHUB_TOKEN or GitHub App credentials before opening pull requests' } }, 503);
  }

  const base = body.base?.trim() || config.syncBranch || 'main';
  if (!validBranch(base)) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Base branch contains unsupported characters' } }, 422);
  }
  const description = `${body.body?.trim() ?? ''}${body.body?.trim() ? '\n\n' : ''}Linked task: ${taskId}`;

  try {
    const pullRequest = await createPullRequest(context.env, {
      repository: config.repository,
      title,
      head,
      base,
      body: description,
      draft: Boolean(body.draft),
    });
    const pullRequestUrl = safeHttpUrl(pullRequest.html_url);
    if (!pullRequestUrl) {
      return context.json({ ok: false, error: { code: 'GITHUB_API_ERROR', message: 'GitHub returned an invalid pull request URL' } }, 502);
    }

    await context.env.DB.batch([
      context.env.DB.prepare(`INSERT OR IGNORE INTO github_links
        (id, project_id, resource_type, resource_id, github_type, github_id, url)
        VALUES (?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?)`)
        .bind(crypto.randomUUID(), taskId, String(pullRequest.number).slice(0, 120), pullRequestUrl),
      context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, action, payload_json, processed_at)
        VALUES (?, ?, 'pull_request', 'opened_outbound', ?, unixepoch())`)
        .bind(crypto.randomUUID(), `out_${crypto.randomUUID()}`,
          JSON.stringify({ repository: config.repository, taskId, number: pullRequest.number, url: pullRequestUrl })),
      audit(context.env, context.get('user').id, 'github.pull_request_created', 'task', taskId, {
        repository: config.repository,
        number: pullRequest.number,
        url: pullRequestUrl,
      }),
    ]);

    return context.json({
      ok: true,
      data: {
        number: pullRequest.number,
        url: pullRequestUrl,
        title: pullRequest.title,
        state: pullRequest.state,
        taskId,
      },
    }, 201);
  } catch (error) {
    const failure = githubErrorResult(error);
    return context.json(failure.body, failure.status);
  }
});

githubRoutes.post('/simulate-event', requirePermission('workspace.admin'), async (context) => {
  const body = await context.req.json<{ eventType?: string; taskId?: string; commitMessage?: string }>().catch(() => ({} as { eventType?: string; taskId?: string; commitMessage?: string }));
  const eventType = body.eventType === 'pull_request' ? 'pull_request' : 'push';
  const taskId = (body.taskId ?? 'task_1_1').trim();
  if (!validTaskReference(taskId)) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'taskId is invalid' } }, 422);
  }
  const task = await context.env.DB.prepare(`SELECT id FROM tasks WHERE id=? AND archived_at IS NULL`).bind(taskId).first();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);
  const commitSha = crypto.randomUUID().replaceAll('-', '').slice(0, 7);
  const commitMessage = (body.commitMessage ?? `feat(firmware): implement SPI telemetry transceiver for ${taskId}`).slice(0, 2_000);
  const commitUrl = `https://github.com/Mostafa-Galal-sudo/cerberus-firmware/commit/${commitSha}`;

  const eventPayload = {
    ref: 'refs/heads/main',
    repository: { full_name: 'Mostafa-Galal-sudo/cerberus-firmware' },
    commits: [{ id: commitSha, message: commitMessage, url: commitUrl }],
  };

  const eventId = crypto.randomUUID();
  const deliveryId = `sim_${crypto.randomUUID()}`;

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, payload_json, processed_at)
      VALUES (?, ?, ?, ?, unixepoch())`)
      .bind(eventId, deliveryId, eventType, JSON.stringify(eventPayload)),
    context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
      VALUES (?, 'project_cerberus', 'task', ?, 'commit', ?, ?)`)
      .bind(crypto.randomUUID(), taskId, commitSha, commitUrl),
    audit(context.env, context.get('user').id, 'github.event_simulated', 'github_event', eventId),
  ]);

  return context.json({
    ok: true,
    data: {
      deliveryId,
      commitSha,
      taskId,
      commitUrl,
      linked: true,
    },
  }, 201);
});

