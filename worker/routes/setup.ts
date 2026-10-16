import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { hashPassword, randomToken } from '../services/security';

const members = [
  { id: 'user_mostafa', email: 'mostafa@cerberus.local', name: 'Mostafa Galal', specialization: 'Embedded Systems, IoT Security & Technical Integration', roles: ['role_admin', 'role_member', 'role_technical_lead'] },
  { id: 'user_wessam', email: 'wessam@cerberus.local', name: 'Wessam', specialization: 'Artificial Intelligence & Machine Learning', roles: ['role_member'] },
  { id: 'user_khamis', email: 'khamis@cerberus.local', name: 'Khamis', specialization: 'Networking & Network Security', roles: ['role_member'] },
  { id: 'user_youssef', email: 'youssef@cerberus.local', name: 'Youssef', specialization: 'Wireless Communications & Wi-Fi CSI', roles: ['role_member'] },
  { id: 'user_nabil', email: 'nabil@cerberus.local', name: 'Nabil', specialization: 'Backend Engineering', roles: ['role_member'] },
  { id: 'user_rozen', email: 'rozen@cerberus.local', name: 'Rozen', specialization: 'Frontend Engineering & SOC Dashboard', roles: ['role_member'] },
  { id: 'user_supervisor', email: 'supervisor@cerberus.local', name: 'Project Supervisor', specialization: 'Academic Supervision', roles: ['role_supervisor'] },
] as const;

const roadmaps = [
  { user: 'user_mostafa', domain: 'Embedded Systems & Cybersecurity', checkpoints: ['Embedded foundation', 'Device security', 'Hybrid intrusion detection', 'Response orchestration', 'Final security integration'] },
  { user: 'user_wessam', domain: 'Artificial Intelligence', checkpoints: ['AI and data foundation', 'Machine-learning IDS', 'Digital forensics agent', 'Adversarial validation agent', 'Model and agent evaluation'] },
  { user: 'user_khamis', domain: 'Networking & Network Security', checkpoints: ['Network foundation', 'Network visibility', 'Network security', 'Controlled security scenarios', 'Network defense'] },
  { user: 'user_youssef', domain: 'Wireless Communications & CSI', checkpoints: ['Wireless foundation', 'Wireless data collection', 'Feature extraction', 'Wireless resilience', 'Wireless integration'] },
  { user: 'user_nabil', domain: 'Backend Engineering', checkpoints: ['Backend foundation', 'Data pipelines', 'Security platform APIs', 'System orchestration', 'Deployment and quality'] },
  { user: 'user_rozen', domain: 'Frontend Engineering', checkpoints: ['UI foundation', 'Live monitoring', 'Security operations', 'Analytics and reporting', 'Interface validation'] },
] as const;

export const setupRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

setupRoutes.post('/initialize', async (context) => {
  if (!context.env.SETUP_TOKEN || context.req.header('Authorization') !== `Bearer ${context.env.SETUP_TOKEN}`) {
    return context.json({ ok: false, error: { code: 'SETUP_FORBIDDEN', message: 'Valid setup token required' } }, 403);
  }
  const existing = await context.env.DB.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) {
    return context.json({ ok: false, error: { code: 'ALREADY_INITIALIZED', message: 'Workspace has already been initialized' } }, 409);
  }

  const initialCredentials: Array<{ name: string; email: string; temporaryPassword: string }> = [];
  const statements: D1PreparedStatement[] = [];
  const passwords = await Promise.all(members.map(async (member) => {
    const temporaryPassword = `Tmp!${randomToken(18)}9aA`;
    return { member, temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
  }));
  for (const { member, temporaryPassword, passwordHash } of passwords) {
    statements.push(context.env.DB.prepare(`INSERT INTO users
      (id, email, display_name, specialization, status, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, 'active', ?, 1)`)
      .bind(member.id, member.email, member.name, member.specialization, passwordHash));
    statements.push(context.env.DB.prepare(`INSERT INTO team_members (team_id, user_id) VALUES ('team_cerberus', ?)` ).bind(member.id));
    statements.push(context.env.DB.prepare(`INSERT INTO project_members (project_id, user_id, membership_role) VALUES ('project_cerberus', ?, ?)`)
      .bind(member.id, member.id === 'user_supervisor' ? 'supervisor' : 'member'));
    for (const role of member.roles) statements.push(context.env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(member.id, role));
    initialCredentials.push({ name: member.name, email: member.email, temporaryPassword });
  }

  for (const [domainIndex, roadmap] of roadmaps.entries()) {
    const domainId = `domain_${domainIndex + 1}`;
    statements.push(context.env.DB.prepare(`INSERT INTO engineering_domains (id, project_id, name, sort_order) VALUES (?, 'project_cerberus', ?, ?)`)
      .bind(domainId, roadmap.domain, domainIndex));
    for (const [checkpointIndex, checkpointTitle] of roadmap.checkpoints.entries()) {
      const milestoneId = `milestone_${domainIndex + 1}_${checkpointIndex + 1}`;
      const checkpointId = `checkpoint_${domainIndex + 1}_${checkpointIndex + 1}`;
      const taskId = `task_${domainIndex + 1}_${checkpointIndex + 1}`;
      statements.push(context.env.DB.prepare(`INSERT INTO milestones (id, project_id, domain_id, title, description, sort_order)
        VALUES (?, 'project_cerberus', ?, ?, ?, ?)`).bind(milestoneId, domainId, checkpointTitle, `${roadmap.domain}: ${checkpointTitle}`, checkpointIndex));
      statements.push(context.env.DB.prepare(`INSERT INTO checkpoints
        (id, milestone_id, owner_id, title, description, required_deliverable, acceptance_criteria, evidence_requirements, validation_procedure)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(checkpointId, milestoneId, roadmap.user, checkpointTitle, `Complete and validate the ${checkpointTitle.toLowerCase()} engineering checkpoint.`,
          `Versioned ${checkpointTitle.toLowerCase()} implementation and engineering notes.`,
          'All mandatory task criteria pass and a separate administrator records approval.',
          'Repository reference, test output, and concise engineering evidence.',
          'Reproduce the documented workflow and compare results with the stated acceptance criteria.'));
      statements.push(context.env.DB.prepare(`INSERT INTO tasks
        (id, project_id, domain_id, assignee_id, created_by, title, description, prerequisites, inputs, implementation_steps, required_tools, expected_outputs, deliverables, acceptance_criteria, validation_procedure, evidence_requirements, priority, sort_order)
        VALUES (?, 'project_cerberus', ?, ?, 'user_mostafa', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(taskId, domainId, roadmap.user, `Deliver ${checkpointTitle}`, `Implement the scoped ${checkpointTitle.toLowerCase()} work for ${roadmap.domain}.`,
          checkpointIndex === 0 ? 'Approved project scope and relevant architecture notes.' : `Outputs from ${roadmap.checkpoints[checkpointIndex - 1]}.`,
          'Approved requirements, existing repository modules, and applicable test fixtures.',
          '1. Confirm interfaces and constraints.\n2. Implement the smallest testable unit.\n3. Exercise normal and failure paths.\n4. Document evidence and limitations.',
          'Project repository, documented development environment, and domain-appropriate test tools.',
          'A reproducible implementation whose behavior can be reviewed independently.',
          'Source changes, test results, and concise implementation documentation.',
          'Required behavior is implemented, tests cover the critical path, and no known critical defect remains hidden.',
          'Run the documented tests from a clean checkout and inspect the submitted evidence.',
          'Commit or pull-request link, executed test output, and notes for any limitations.', checkpointIndex >= 3 ? 'high' : 'medium', checkpointIndex));
      statements.push(context.env.DB.prepare(`INSERT INTO checkpoint_tasks (checkpoint_id, task_id) VALUES (?, ?)` ).bind(checkpointId, taskId));
      if (checkpointIndex > 0) statements.push(context.env.DB.prepare(`INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`)
        .bind(taskId, `task_${domainIndex + 1}_${checkpointIndex}`));
      for (const [itemIndex, label] of ['Confirm scope and interfaces', 'Implement required behavior', 'Run validation procedure', 'Attach review evidence'].entries()) {
        statements.push(context.env.DB.prepare(`INSERT INTO task_checklist_items (id, task_id, title, sort_order) VALUES (?, ?, ?, ?)`)
          .bind(`${taskId}_item_${itemIndex + 1}`, taskId, label, itemIndex));
      }
    }
  }
  statements.push(context.env.DB.prepare(`INSERT INTO channels (id, name, type) VALUES ('channel_general', 'General', 'general')`));
  for (const member of members) statements.push(context.env.DB.prepare(`INSERT INTO channel_members (channel_id, user_id) VALUES ('channel_general', ?)` ).bind(member.id));
  await context.env.DB.batch(statements);
  return context.json({
    ok: true,
    data: {
      initialCredentials,
      warning: 'Temporary passwords are shown once. Store them securely and require each person to change theirs at first login.',
    },
  }, 201);
});
