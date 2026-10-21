import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { emailDeliveryConfigured, sendEmail } from '../services/email';
import { randomToken, sha256 } from '../services/security';
import type { Env, Variables } from '../types';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
userRoutes.use('*', requireAuth, requirePasswordChanged);

userRoutes.get('/', async (context) => {
  const rows = await context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.email, u.specialization, u.bio, u.status,
    u.last_activity_at AS lastActivityAt, u.created_at AS createdAt,
    GROUP_CONCAT(r.name) AS roles,
    (SELECT tm.team_id FROM team_members tm WHERE tm.user_id=u.id LIMIT 1) AS teamId,
    (SELECT d.name FROM engineering_domains d JOIN milestones m ON m.domain_id=d.id JOIN checkpoints c ON c.milestone_id=m.id WHERE c.owner_id=u.id LIMIT 1) AS domainName,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.archived_at IS NULL) AS taskTotal,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='approved' AND t.archived_at IS NULL) AS taskApproved
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id=u.id
    LEFT JOIN roles r ON r.id=ur.role_id
    WHERE u.archived_at IS NULL
    GROUP BY u.id
    ORDER BY u.display_name`).all();
  return context.json({ ok: true, data: rows.results });
});

userRoutes.get('/:id', async (context) => {
  const user = await context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.email, u.specialization, u.bio, u.status,
    u.last_activity_at AS lastActivityAt, u.created_at AS createdAt
    FROM users u WHERE u.id=? AND u.archived_at IS NULL`).bind(context.req.param('id')).first();
  if (!user) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);

  const [roles, permissions, team] = await Promise.all([
    context.env.DB.prepare(`SELECT r.id, r.name, r.description FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT DISTINCT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id JOIN user_roles ur ON ur.role_id=rp.role_id WHERE ur.user_id=?`).bind(context.req.param('id')).all(),
    context.env.DB.prepare(`SELECT t.id, t.name, t.description FROM teams t JOIN team_members tm ON tm.team_id=t.id WHERE tm.user_id=?`).bind(context.req.param('id')).first(),
  ]);

  return context.json({
    ok: true,
    data: {
      ...user,
      roles: (roles.results as Array<{ id: string; name: string }>).map((r) => r.name),
      permissions: (permissions.results as Array<{ name: string }>).map((p) => p.name),
      team,
    },
  });
});

userRoutes.patch('/:id/status', requirePermission('workspace.admin'), async (context) => {
  const body: { status?: string } = await context.req.json<{ status?: string }>().catch(() => ({}));
  if (!body.status || !['active', 'suspended'].includes(body.status)) return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid account status' } }, 422);
  if (context.req.param('id') === context.get('user').id && body.status === 'suspended') return context.json({ ok: false, error: { code: 'SELF_SUSPEND_FORBIDDEN', message: 'You cannot suspend your own account' } }, 409);
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE users SET status=?, updated_at=unixepoch() WHERE id=?`).bind(body.status, context.req.param('id')),
    audit(context.env, context.get('user').id, `user.status_${body.status}`, 'user', context.req.param('id')),
    ...(body.status === 'suspended' ? [context.env.DB.prepare(`UPDATE sessions SET revoked_at=unixepoch() WHERE user_id=? AND revoked_at IS NULL`).bind(context.req.param('id'))] : []),
  ]);
  return context.json({ ok: true, data: { status: body.status } });
});

userRoutes.post('/:id/reissue-invitation', requirePermission('workspace.admin'), async (context) => {
  const userId = context.req.param('id');
  const user = await context.env.DB.prepare(`SELECT id, email, status FROM users WHERE id=? AND archived_at IS NULL`).bind(userId).first<{ id: string; email: string; status: string }>();
  if (!user) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const invitationId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7); // 7 days

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE invitations SET accepted_at=unixepoch() WHERE user_id=? AND accepted_at IS NULL`).bind(userId),
    context.env.DB.prepare(`INSERT INTO invitations (id, user_id, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?)`).bind(invitationId, userId, tokenHash, expiresAt, context.get('user').id),
    audit(context.env, context.get('user').id, 'invitation.reissued', 'invitation', invitationId, { userId }),
  ]);

  return context.json({
    ok: true,
    data: {
      token,
      activationUrl: `/activate?token=${encodeURIComponent(token)}`,
      expiresAt,
    },
  });
});

userRoutes.post('/:id/reassign-work', requirePermission('workspace.admin'), async (context) => {
  const sourceId = context.req.param('id');
  const body = await context.req.json<{
    targetUserId?: string;
    taskIds?: string[];
    checkpointIds?: string[];
  }>().catch(() => ({} as { targetUserId?: string; taskIds?: string[]; checkpointIds?: string[] }));

  const targetId = body.targetUserId?.trim();
  const taskIds = [...new Set(body.taskIds ?? [])].filter(Boolean);
  const checkpointIds = [...new Set(body.checkpointIds ?? [])].filter(Boolean);

  if (!targetId) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Choose a target member' } }, 422);
  }
  if (targetId === sourceId) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Choose a different target member' } }, 422);
  }
  if (taskIds.length === 0 && checkpointIds.length === 0) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Select at least one task or checkpoint' } }, 422);
  }
  if (taskIds.length > 100 || checkpointIds.length > 100) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Reassign at most 100 items at a time' } }, 422);
  }

  const [source, target] = await Promise.all([
    context.env.DB.prepare(`SELECT id, display_name FROM users WHERE id=? AND archived_at IS NULL`).bind(sourceId).first<{ id: string; display_name: string }>(),
    context.env.DB.prepare(`SELECT id, display_name, status FROM users WHERE id=? AND archived_at IS NULL`).bind(targetId).first<{ id: string; display_name: string; status: string }>(),
  ]);
  if (!source) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Source member not found' } }, 404);
  if (!target) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Target member not found' } }, 404);
  if (target.status !== 'active') {
    return context.json({ ok: false, error: { code: 'TARGET_NOT_ACTIVE', message: 'Reactivate the target account before assigning work' } }, 409);
  }
  const targetIsContributor = await context.env.DB.prepare(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=? AND r.name IN ('team_member','super_admin','technical_lead') LIMIT 1`).bind(targetId).first();
  if (!targetIsContributor) {
    return context.json({ ok: false, error: { code: 'TARGET_NOT_CONTRIBUTOR', message: 'Work can only be transferred to a team member or technical lead' } }, 409);
  }

  const statements: D1PreparedStatement[] = [];
  let reassignedTasks = 0;
  let reassignedCheckpoints = 0;

  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    const owned = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE assignee_id=? AND archived_at IS NULL AND id IN (${placeholders})`)
      .bind(sourceId, ...taskIds).first<{ count: number }>();
    reassignedTasks = owned?.count ?? 0;
    if (reassignedTasks > 0) {
      statements.push(context.env.DB.prepare(`UPDATE tasks SET assignee_id=?, updated_at=unixepoch()
        WHERE assignee_id=? AND archived_at IS NULL AND id IN (${placeholders})`)
        .bind(targetId, sourceId, ...taskIds));
    }
  }

  if (checkpointIds.length > 0) {
    const placeholders = checkpointIds.map(() => '?').join(',');
    const owned = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM checkpoints WHERE owner_id=? AND archived_at IS NULL AND id IN (${placeholders})`)
      .bind(sourceId, ...checkpointIds).first<{ count: number }>();
    reassignedCheckpoints = owned?.count ?? 0;
    if (reassignedCheckpoints > 0) {
      statements.push(context.env.DB.prepare(`UPDATE checkpoints SET owner_id=?, updated_at=unixepoch()
        WHERE owner_id=? AND archived_at IS NULL AND id IN (${placeholders})`)
        .bind(targetId, sourceId, ...checkpointIds));
    }
  }

  if (statements.length === 0) {
    return context.json({ ok: false, error: { code: 'NO_OWNED_WORK', message: 'None of the selected items are owned by this member' } }, 409);
  }

  const total = reassignedTasks + reassignedCheckpoints;
  statements.push(context.env.DB.prepare(`INSERT INTO notifications (id, user_id, type, title, body, resource_type, resource_id)
    VALUES (?, ?, 'work.reassigned', 'Work reassigned to you', ?, 'user', ?)`)
    .bind(crypto.randomUUID(), targetId,
      `${source.display_name} transferred ${reassignedTasks} task(s) and ${reassignedCheckpoints} checkpoint(s) to you.`,
      sourceId));
  statements.push(context.env.DB.prepare(`INSERT INTO workspace_events (event_type, user_id, payload_json)
    VALUES ('work.reassigned', ?, ?)`)
    .bind(targetId, JSON.stringify({ sourceId, targetId, reassignedTasks, reassignedCheckpoints })));
  statements.push(audit(context.env, context.get('user').id, 'user.work_reassigned', 'user', sourceId, {
    targetId, taskIds, checkpointIds, reassignedTasks, reassignedCheckpoints,
  }));

  await context.env.DB.batch(statements);
  return context.json({
    ok: true,
    data: { reassignedTasks, reassignedCheckpoints, total, targetName: target.display_name },
  });
});

userRoutes.post('/:id/reset-password', requirePermission('workspace.admin'), async (context) => {
  const userId = context.req.param('id');
  const user = await context.env.DB.prepare(`SELECT id, email, display_name, status FROM users WHERE id=? AND archived_at IS NULL`).bind(userId).first<{ id: string; email: string; display_name: string; status: string }>();
  if (!user) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  if (user.status !== 'active') {
    return context.json({ ok: false, error: { code: 'ACCOUNT_NOT_ACTIVE', message: 'Reactivate the account before issuing a password reset' } }, 409);
  }

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const resetId = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE password_reset_tokens SET used_at=unixepoch() WHERE user_id=? AND used_at IS NULL`).bind(userId),
    context.env.DB.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?)`)
      .bind(resetId, userId, tokenHash, expiresAt, context.get('user').id),
    audit(context.env, context.get('user').id, 'user.password_reset_issued', 'user', userId, { resetId }),
  ]);

  const baseUrl = (context.env.APP_ORIGIN ?? new URL(context.req.url).origin).replace(/\/+$/, '');
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  let delivery: 'email' | 'manual' = 'manual';
  if (emailDeliveryConfigured(context.env)) {
    const result = await sendEmail(context.env, {
      to: user.email,
      subject: 'CERBERUS workspace password reset',
      text: `Hello ${user.display_name},\n\nAn administrator issued a one-time password reset for your CERBERUS workspace account.\n\nUse this link within one hour:\n${resetUrl}\n\nIf you did not expect this reset, contact the workspace administrator.\n`,
    });
    if (result.sent) delivery = 'email';
  }

  return context.json({
    ok: true,
    data: {
      token,
      resetUrl: `/reset-password?token=${encodeURIComponent(token)}`,
      expiresAt,
      delivery,
    },
  });
});

userRoutes.patch('/:id/profile', async (context) => {
  const targetId = context.req.param('id');
  const current = context.get('user');
  if (targetId !== current.id && !current.permissions.includes('workspace.admin')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You can only edit your own profile' } }, 403);
  }

  const body = await context.req.json<{ displayName?: string; specialization?: string; bio?: string }>().catch(() => ({} as { displayName?: string; specialization?: string; bio?: string }));
  const updates: string[] = [];
  const binds: unknown[] = [];

  if (body.displayName && body.displayName.trim().length >= 2) {
    updates.push('display_name = ?');
    binds.push(body.displayName.trim());
  }
  if (typeof body.specialization === 'string') {
    updates.push('specialization = ?');
    binds.push(body.specialization.trim());
  }
  if (typeof body.bio === 'string') {
    updates.push('bio = ?');
    binds.push(body.bio.trim());
  }

  if (updates.length === 0) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'No valid profile fields provided' } }, 422);
  }

  updates.push('updated_at = unixepoch()');
  binds.push(targetId);

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds),
    audit(context.env, current.id, 'user.profile_updated', 'user', targetId),
  ]);

  return context.json({ ok: true, data: { updated: true } });
});

userRoutes.patch('/:id/roles', requirePermission('workspace.admin'), async (context) => {
  const targetId = context.req.param('id');
  const body = await context.req.json<{ roles?: string[] }>().catch(() => ({} as { roles?: string[] }));
  if (!Array.isArray(body.roles) || body.roles.length === 0) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'At least one role is required' } }, 422);
  }

  const validRoleRows = await context.env.DB.prepare(`SELECT id, name FROM roles`).all<{ id: string; name: string }>();
  const validRoleNames = new Map(validRoleRows.results.map((r) => [r.name, r.id]));

  for (const roleName of body.roles) {
    if (!validRoleNames.has(roleName)) {
      return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Unknown role: ${roleName}` } }, 422);
    }
  }

  // Prevent removing super_admin if this is the only active super_admin
  const hasAdminNow = await context.env.DB.prepare(`SELECT 1 FROM user_roles ur JOIN users u ON u.id=ur.user_id WHERE ur.user_id=? AND ur.role_id='role_admin' AND u.status='active'`).bind(targetId).first();
  if (hasAdminNow && !body.roles.includes('super_admin')) {
    const totalAdmins = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM user_roles ur JOIN users u ON u.id=ur.user_id WHERE ur.role_id='role_admin' AND u.status='active' AND u.archived_at IS NULL`).first<{ count: number }>();
    if ((totalAdmins?.count ?? 0) <= 1) {
      return context.json({ ok: false, error: { code: 'LAST_ADMIN_PROTECTED', message: 'Cannot remove the last super-admin' } }, 409);
    }
  }

  const statements = [
    context.env.DB.prepare(`DELETE FROM user_roles WHERE user_id=?`).bind(targetId),
  ];
  for (const roleName of body.roles) {
    const roleId = validRoleNames.get(roleName)!;
    statements.push(context.env.DB.prepare(`INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`).bind(targetId, roleId));
  }
  statements.push(audit(context.env, context.get('user').id, 'user.roles_updated', 'user', targetId, { roles: body.roles }));

  await context.env.DB.batch(statements);
  return context.json({ ok: true, data: { roles: body.roles } });
});

userRoutes.get('/roadmaps/all', async (context) => {
  const membersWithRoadmaps = await context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.specialization,
    d.id AS domainId, d.name AS domainName,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.archived_at IS NULL) AS totalTasks,
    (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id=u.id AND t.status='approved' AND t.archived_at IS NULL) AS approvedTasks,
    (SELECT COUNT(*) FROM checkpoints c WHERE c.owner_id=u.id AND c.archived_at IS NULL) AS totalCheckpoints,
    (SELECT COUNT(*) FROM checkpoints c WHERE c.owner_id=u.id AND c.status='approved' AND c.archived_at IS NULL) AS approvedCheckpoints
    FROM users u
    JOIN user_roles ur ON ur.user_id=u.id AND ur.role_id='role_member'
    LEFT JOIN checkpoints c ON c.owner_id=u.id
    LEFT JOIN milestones m ON m.id=c.milestone_id
    LEFT JOIN engineering_domains d ON d.id=m.domain_id
    WHERE u.archived_at IS NULL
    GROUP BY u.id
    ORDER BY u.display_name`).all();

  return context.json({ ok: true, data: membersWithRoadmaps.results });
});

userRoutes.get('/roadmaps/member/:userId', async (context) => {
  const userId = context.req.param('userId');
  const [member, checkpoints, tasks] = await Promise.all([
    context.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.specialization FROM users u WHERE u.id=?`).bind(userId).first(),
    context.env.DB.prepare(`SELECT c.id, c.title, c.description, c.required_deliverable AS requiredDeliverable,
      c.acceptance_criteria AS acceptanceCriteria, c.evidence_requirements AS evidenceRequirements,
      c.validation_procedure AS validationProcedure, c.mandatory, c.status, c.approved_at AS approvedAt,
      m.id AS milestoneId, m.title AS milestoneTitle, m.sort_order AS sortOrder,
      d.id AS domainId, d.name AS domainName
      FROM checkpoints c
      JOIN milestones m ON m.id=c.milestone_id
      LEFT JOIN engineering_domains d ON d.id=m.domain_id
      WHERE c.owner_id=? AND c.archived_at IS NULL
      ORDER BY m.sort_order, c.created_at`).bind(userId).all(),
    context.env.DB.prepare(`SELECT t.id, t.title, t.priority, t.status, t.approved_at AS approvedAt,
      (SELECT ct.checkpoint_id FROM checkpoint_tasks ct WHERE ct.task_id=t.id LIMIT 1) AS checkpointId
      FROM tasks t WHERE t.assignee_id=? AND t.archived_at IS NULL`).bind(userId).all(),
  ]);

  if (!member) return context.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Member not found' } }, 404);

  return context.json({
    ok: true,
    data: {
      member,
      checkpoints: checkpoints.results,
      tasks: tasks.results,
    },
  });
});
