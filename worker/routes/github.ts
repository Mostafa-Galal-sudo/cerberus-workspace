import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { createPullRequest, extractTaskIds, githubAuthMode, GithubApiError, syncRepository } from '../services/github';
import { verifyGithubSignature } from '../services/security';
import type { Env, Variables } from '../types';

export const githubRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branchPattern = /^[A-Za-z0-9._/-]{1,120}$/;

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

// Webhook receiver (unauthenticated because GitHub calls it, but HMAC signature verified!)
githubRoutes.post('/webhook', async (context) => {
  const deliveryId = context.req.header('X-GitHub-Delivery') ?? crypto.randomUUID();
  const eventType = context.req.header('X-GitHub-Event') ?? 'ping';
  const signature = context.req.header('X-Hub-Signature-256');

  const rawBody = await context.req.text();

  // Retrieve GitHub integration settings
  const settings = await context.env.DB.prepare(`SELECT enabled, config_json FROM integration_settings WHERE integration = 'github'`).first<{ enabled: number; config_json: string }>();
  const config = JSON.parse(settings?.config_json ?? '{}') as { webhookSecret?: string; repository?: string };

  // If a webhook secret is configured, verify HMAC-SHA256 signature
  if (config.webhookSecret) {
    if (!signature || !signature.startsWith('sha256=')) {
      return context.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Missing or malformed X-Hub-Signature-256' } }, 401);
    }
    if (!await verifyGithubSignature(config.webhookSecret, rawBody, signature)) {
      return context.json({ ok: false, error: { code: 'SIGNATURE_MISMATCH', message: 'Invalid HMAC signature' } }, 401);
    }
  }

  // Parse payload
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return context.json({ ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Invalid JSON payload' } }, 400);
  }

  const eventId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, action, payload_json, processed_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())`)
      .bind(eventId, deliveryId, eventType, typeof payload.action === 'string' ? payload.action : null, rawBody),
  ];

  // If push event with commits, extract any task references and link
  if (eventType === 'push' && Array.isArray(payload.commits)) {
    for (const commit of payload.commits as Array<{ id: string; message: string; url: string }>) {
      const taskMatches = commit.message.match(/task_[a-zA-Z0-9_-]+/g);
      if (taskMatches) {
        for (const taskId of taskMatches) {
          statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
            VALUES (?, 'project_cerberus', 'task', ?, 'commit', ?, ?)`).bind(crypto.randomUUID(), taskId, commit.id, commit.url));
        }
      }
    }
  }

  // If pull_request event, link PR to task if mentioned in title or body
  if (eventType === 'pull_request' && payload.pull_request) {
    const pr = payload.pull_request as { id: number; html_url: string; title: string; body?: string };
    const text = `${pr.title} ${pr.body ?? ''}`;
    const taskMatches = text.match(/task_[a-zA-Z0-9_-]+/g);
    if (taskMatches) {
      for (const taskId of taskMatches) {
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links (id, project_id, resource_type, resource_id, github_type, github_id, url)
          VALUES (?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?)`).bind(crypto.randomUUID(), taskId, String(pr.id), pr.html_url));
      }
    }
  }

  await context.env.DB.batch(statements);
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

  const config = JSON.parse(settings?.config_json ?? '{}') as {
    repository?: string;
    webhookSecret?: string;
    syncBranch?: string;
    lastSyncAt?: number;
    lastSyncStatus?: string;
    lastSyncCount?: number;
  };
  const authMode = githubAuthMode(context.env);

  return context.json({
    ok: true,
    data: {
      enabled: Boolean(settings?.enabled),
      repository: config.repository ?? 'Mostafa-Galal-sudo/cerberus-firmware',
      syncBranch: config.syncBranch ?? 'main',
      hasSecret: Boolean(config.webhookSecret),
      authMode,
      outboundReady: authMode !== 'none',
      lastSyncAt: config.lastSyncAt ?? null,
      lastSyncStatus: config.lastSyncStatus ?? null,
      lastSyncCount: config.lastSyncCount ?? 0,
      updatedAt: settings?.updatedAt,
      events: events.results,
      links: links.results,
    },
  });
});

githubRoutes.post('/settings', requirePermission('workspace.admin'), async (context) => {
  const body = await context.req.json<{ enabled?: boolean; repository?: string; webhookSecret?: string; syncBranch?: string }>().catch(() => ({} as { enabled?: boolean; repository?: string; webhookSecret?: string; syncBranch?: string }));
  const repository = body.repository?.trim();
  const syncBranch = body.syncBranch?.trim();
  if (repository && !repositoryPattern.test(repository)) {
    return context.json({ ok: false, error: { code: 'INVALID_REPOSITORY', message: 'Repository must use the owner/name form' } }, 422);
  }
  if (syncBranch && !branchPattern.test(syncBranch)) {
    return context.json({ ok: false, error: { code: 'INVALID_BRANCH', message: 'Branch name contains unsupported characters' } }, 422);
  }
  const existing = await context.env.DB.prepare(`SELECT config_json FROM integration_settings WHERE integration = 'github'`).first<{ config_json: string }>();
  const currentConfig = JSON.parse(existing?.config_json ?? '{}') as Record<string, unknown>;

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
  const config = JSON.parse(settings?.config_json ?? '{}') as {
    repository?: string;
    webhookSecret?: string;
    syncBranch?: string;
    lastSyncAt?: number;
    lastSyncStatus?: string;
    lastSyncCount?: number;
  };

  if (!config.repository) {
    return context.json({ ok: false, error: { code: 'REPOSITORY_NOT_CONFIGURED', message: 'Save a GitHub repository before syncing' } }, 409);
  }
  if (!repositoryPattern.test(config.repository)) {
    return context.json({ ok: false, error: { code: 'INVALID_REPOSITORY', message: 'Repository must use the owner/name form' } }, 422);
  }
  if (githubAuthMode(context.env) === 'none') {
    return context.json({ ok: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: 'Configure GITHUB_TOKEN or GitHub App credentials before syncing' } }, 503);
  }

  try {
    const result = await syncRepository(context.env, config.repository);
    const statements: D1PreparedStatement[] = [];
    let linked = 0;
    for (const pullRequest of result.pullRequests) {
      const taskIds = extractTaskIds(`${pullRequest.title} ${pullRequest.body ?? ''}`);
      for (const taskId of taskIds) {
        linked += 1;
        statements.push(context.env.DB.prepare(`INSERT OR IGNORE INTO github_links
          (id, project_id, resource_type, resource_id, github_type, github_id, url)
          VALUES (?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?)`)
          .bind(crypto.randomUUID(), taskId, String(pullRequest.number), pullRequest.html_url));
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
  if (title.length < 3 || title.length > 180) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Pull request title must be 3-180 characters' } }, 422);
  }
  if (!branchPattern.test(head) || (body.base && !branchPattern.test(body.base))) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Branch names contain unsupported characters' } }, 422);
  }

  const task = await context.env.DB.prepare(`SELECT id, title FROM tasks WHERE id=? AND archived_at IS NULL`).bind(taskId)
    .first<{ id: string; title: string }>();
  if (!task) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }, 404);

  const settings = await context.env.DB.prepare(`SELECT config_json FROM integration_settings WHERE integration='github'`)
    .first<{ config_json: string }>();
  const config = JSON.parse(settings?.config_json ?? '{}') as { repository?: string; syncBranch?: string };
  if (!config.repository) {
    return context.json({ ok: false, error: { code: 'REPOSITORY_NOT_CONFIGURED', message: 'Save a GitHub repository before opening pull requests' } }, 409);
  }
  if (!repositoryPattern.test(config.repository)) {
    return context.json({ ok: false, error: { code: 'INVALID_REPOSITORY', message: 'Repository must use the owner/name form' } }, 422);
  }
  if (githubAuthMode(context.env) === 'none') {
    return context.json({ ok: false, error: { code: 'GITHUB_NOT_CONFIGURED', message: 'Configure GITHUB_TOKEN or GitHub App credentials before opening pull requests' } }, 503);
  }

  const base = body.base?.trim() || config.syncBranch || 'main';
  if (!branchPattern.test(base)) {
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

    await context.env.DB.batch([
      context.env.DB.prepare(`INSERT OR IGNORE INTO github_links
        (id, project_id, resource_type, resource_id, github_type, github_id, url)
        VALUES (?, 'project_cerberus', 'task', ?, 'pull_request', ?, ?)`)
        .bind(crypto.randomUUID(), taskId, String(pullRequest.number), pullRequest.html_url),
      context.env.DB.prepare(`INSERT INTO github_events (id, delivery_id, event_type, action, payload_json, processed_at)
        VALUES (?, ?, 'pull_request', 'opened_outbound', ?, unixepoch())`)
        .bind(crypto.randomUUID(), `out_${crypto.randomUUID()}`,
          JSON.stringify({ repository: config.repository, taskId, number: pullRequest.number, url: pullRequest.html_url })),
      audit(context.env, context.get('user').id, 'github.pull_request_created', 'task', taskId, {
        repository: config.repository,
        number: pullRequest.number,
        url: pullRequest.html_url,
      }),
    ]);

    return context.json({
      ok: true,
      data: {
        number: pullRequest.number,
        url: pullRequest.html_url,
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
  const eventType = body.eventType ?? 'push';
  const taskId = body.taskId ?? 'task_1_1';
  const commitSha = crypto.randomUUID().replaceAll('-', '').slice(0, 7);
  const commitMessage = body.commitMessage ?? `feat(firmware): implement SPI telemetry transceiver for ${taskId}`;
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

