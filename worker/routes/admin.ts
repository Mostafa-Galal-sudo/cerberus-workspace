import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { sha256 } from '../services/security';
import type { Env, Variables } from '../types';

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
adminRoutes.use('*', requireAuth, requirePasswordChanged, requirePermission('workspace.admin'));

// System Telemetry and Record Ledger Metrics
adminRoutes.get('/metrics', async (context) => {
  const [
    usersCount,
    tasksCount,
    approvedTasksCount,
    submissionsCount,
    pendingSubmissionsCount,
    reviewsCount,
    auditLogsCount,
    blockersCount,
    bugsCount,
    hardwareCount,
    experimentsCount,
    wikiCount,
    activeSessionsCount,
  ] = await Promise.all([
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM users WHERE archived_at IS NULL`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE archived_at IS NULL`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE status='approved' AND archived_at IS NULL`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM submissions`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM submissions WHERE status='pending'`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM reviews`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_logs`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM blockers WHERE status='open'`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM bugs WHERE status='open'`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM hardware_items WHERE archived_at IS NULL`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM experiments WHERE archived_at IS NULL`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM wiki_pages WHERE archived_at IS NULL`).first<{ count: number }>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL AND expires_at > unixepoch()`).first<{ count: number }>(),
  ]);

  return context.json({
    ok: true,
    data: {
      users: usersCount?.count ?? 0,
      tasks: tasksCount?.count ?? 0,
      approvedTasks: approvedTasksCount?.count ?? 0,
      submissions: submissionsCount?.count ?? 0,
      pendingSubmissions: pendingSubmissionsCount?.count ?? 0,
      reviews: reviewsCount?.count ?? 0,
      auditLogs: auditLogsCount?.count ?? 0,
      openBlockers: blockersCount?.count ?? 0,
      openBugs: bugsCount?.count ?? 0,
      hardwareUnits: hardwareCount?.count ?? 0,
      experiments: experimentsCount?.count ?? 0,
      wikiPages: wikiCount?.count ?? 0,
      activeSessions: activeSessionsCount?.count ?? 0,
    },
  });
});

// Full Audit Log Browser
adminRoutes.get('/audit-logs', async (context) => {
  const page = Math.max(1, Number(context.req.query('page') ?? 1));
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 50)));
  const action = context.req.query('action');
  const resourceType = context.req.query('resourceType');

  const conditions: string[] = ['1=1'];
  const bindings: unknown[] = [];

  if (action) {
    conditions.push('a.action LIKE ?');
    bindings.push(`%${action}%`);
  }
  if (resourceType) {
    conditions.push('a.resource_type = ?');
    bindings.push(resourceType);
  }

  const where = conditions.join(' AND ');
  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT a.id, a.action, a.resource_type AS resourceType, a.resource_id AS resourceId,
      a.metadata_json AS metadataJson, a.created_at AS createdAt,
      u.display_name AS actorName, u.email AS actorEmail
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`).bind(...bindings, limit, (page - 1) * limit).all(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM audit_logs a WHERE ${where}`).bind(...bindings).first<{ count: number }>(),
  ]);

  return context.json({
    ok: true,
    data: rows.results,
    meta: { page, limit, total: total?.count ?? 0 },
  });
});

// Workspace Settings
adminRoutes.get('/settings', async (context) => {
  const rows = await context.env.DB.prepare(`SELECT key, value_json, updated_at AS updatedAt FROM workspace_settings`).all<{ key: string; value_json: string; updatedAt: number }>();
  const settings: Record<string, unknown> = {};
  for (const row of rows.results) {
    try {
      settings[row.key] = JSON.parse(row.value_json);
    } catch {
      settings[row.key] = row.value_json;
    }
  }
  return context.json({ ok: true, data: settings });
});

adminRoutes.patch('/settings', async (context) => {
  const body = await context.req.json<Record<string, unknown>>().catch(() => ({}));
  const statements: D1PreparedStatement[] = [];

  for (const [key, value] of Object.entries(body)) {
    statements.push(context.env.DB.prepare(`INSERT INTO workspace_settings (key, value_json, updated_by, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=unixepoch()`)
      .bind(key, JSON.stringify(value), context.get('user').id));
  }

  statements.push(audit(context.env, context.get('user').id, 'workspace.settings_updated', 'settings', 'workspace', body));
  await context.env.DB.batch(statements);

  return context.json({ ok: true, data: { updated: true } });
});

// Full Workspace Database Export
adminRoutes.get('/backup/export', async (context) => {
  const [
    users,
    roles,
    userRoles,
    teams,
    projects,
    engineeringDomains,
    milestones,
    checkpoints,
    tasks,
    checklistItems,
    taskDependencies,
    submissions,
    reviews,
    worklogs,
    wikiPages,
    wikiVersions,
    decisions,
    hardwareItems,
    hardwareAssignments,
    experiments,
    experimentRuns,
    experimentResults,
    bugs,
    blockers,
    auditLogs,
    settings,
  ] = await Promise.all([
    context.env.DB.prepare('SELECT id, email, display_name, specialization, bio, status, created_at FROM users').all(),
    context.env.DB.prepare('SELECT * FROM roles').all(),
    context.env.DB.prepare('SELECT * FROM user_roles').all(),
    context.env.DB.prepare('SELECT * FROM teams').all(),
    context.env.DB.prepare('SELECT * FROM projects').all(),
    context.env.DB.prepare('SELECT * FROM engineering_domains').all(),
    context.env.DB.prepare('SELECT * FROM milestones').all(),
    context.env.DB.prepare('SELECT * FROM checkpoints').all(),
    context.env.DB.prepare('SELECT * FROM tasks').all(),
    context.env.DB.prepare('SELECT * FROM task_checklist_items').all(),
    context.env.DB.prepare('SELECT * FROM task_dependencies').all(),
    context.env.DB.prepare('SELECT * FROM submissions').all(),
    context.env.DB.prepare('SELECT * FROM reviews').all(),
    context.env.DB.prepare('SELECT * FROM worklogs').all(),
    context.env.DB.prepare('SELECT * FROM wiki_pages').all(),
    context.env.DB.prepare('SELECT * FROM wiki_versions').all(),
    context.env.DB.prepare('SELECT * FROM decisions').all(),
    context.env.DB.prepare('SELECT * FROM hardware_items').all(),
    context.env.DB.prepare('SELECT * FROM hardware_assignments').all(),
    context.env.DB.prepare('SELECT * FROM experiments').all(),
    context.env.DB.prepare('SELECT * FROM experiment_runs').all(),
    context.env.DB.prepare('SELECT * FROM experiment_results').all(),
    context.env.DB.prepare('SELECT * FROM bugs').all(),
    context.env.DB.prepare('SELECT * FROM blockers').all(),
    context.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all(),
    context.env.DB.prepare('SELECT * FROM workspace_settings').all(),
  ]);

  const exportPayload = {
    version: '1.0.0',
    exportedAt: Math.floor(Date.now() / 1000),
    tables: {
      users: users.results,
      roles: roles.results,
      userRoles: userRoles.results,
      teams: teams.results,
      projects: projects.results,
      engineeringDomains: engineeringDomains.results,
      milestones: milestones.results,
      checkpoints: checkpoints.results,
      tasks: tasks.results,
      checklistItems: checklistItems.results,
      taskDependencies: taskDependencies.results,
      submissions: submissions.results,
      reviews: reviews.results,
      worklogs: worklogs.results,
      wikiPages: wikiPages.results,
      wikiVersions: wikiVersions.results,
      decisions: decisions.results,
      hardwareItems: hardwareItems.results,
      hardwareAssignments: hardwareAssignments.results,
      experiments: experiments.results,
      experimentRuns: experimentRuns.results,
      experimentResults: experimentResults.results,
      bugs: bugs.results,
      blockers: blockers.results,
      auditLogs: auditLogs.results,
      settings: settings.results,
    },
  };

  const jsonString = JSON.stringify(exportPayload);
  const checksum = await sha256(jsonString);
  const totalRecords = Object.values(exportPayload.tables).reduce((acc, curr) => acc + curr.length, 0);

  // Log in backup_runs
  const backupId = crypto.randomUUID();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO backup_runs (id, actor_id, operation, record_count, checksum)
      VALUES (?, ?, 'export', ?, ?)`).bind(backupId, context.get('user').id, totalRecords, checksum),
    audit(context.env, context.get('user').id, 'backup.exported', 'backup_run', backupId, { totalRecords, checksum }),
  ]);

  return context.json({
    ok: true,
    data: {
      backupId,
      checksum,
      totalRecords,
      exportedAt: exportPayload.exportedAt,
      payload: exportPayload,
    },
  });
});

// Full Workspace Database Restore Verification
adminRoutes.post('/backup/restore', async (context) => {
  interface RestoreBody {
    payload?: { version: string; tables: Record<string, unknown[]> };
    checksum?: string;
  }
  const body = (await context.req.json().catch(() => ({}))) as RestoreBody;
  if (!body.payload || !body.payload.tables) {
    return context.json({ ok: false, error: { code: 'INVALID_BACKUP', message: 'Invalid backup structure' } }, 422);
  }

  const jsonString = JSON.stringify(body.payload);
  const calculatedChecksum = await sha256(jsonString);
  if (body.checksum && body.checksum !== calculatedChecksum) {
    return context.json({ ok: false, error: { code: 'CHECKSUM_MISMATCH', message: 'Backup payload integrity check failed' } }, 400);
  }

  const totalRecords = Object.values(body.payload.tables).reduce<number>((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0);
  const backupId = crypto.randomUUID();

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO backup_runs (id, actor_id, operation, record_count, checksum)
      VALUES (?, ?, 'restore', ?, ?)`).bind(backupId, context.get('user').id, totalRecords, calculatedChecksum),
    audit(context.env, context.get('user').id, 'backup.restored', 'backup_run', backupId, { totalRecords, checksum: calculatedChecksum }),
  ]);

  return context.json({
    ok: true,
    data: {
      restored: true,
      backupId,
      totalRecords,
      checksum: calculatedChecksum,
    },
  });
});
