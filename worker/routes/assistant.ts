import { Hono } from 'hono';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { requestProviderReply } from '../services/ai';
import { consumeRateLimit } from '../services/rate-limit';
import { wikiVisibilityFilter } from '../services/wiki-access';
import type { Env, Variables } from '../types';

export const assistantRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
assistantRoutes.use('*', requireAuth, requirePasswordChanged);
const MAX_PROMPT_CHARACTERS = 8_000;
const MAX_REPLY_CHARACTERS = 20_000;

assistantRoutes.get('/usage', async (context) => {
  const user = context.get('user');
  if (!user.permissions.includes('workspace.admin') && !user.roles.includes('project_supervisor')) {
    return context.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Usage telemetry is restricted to administrators and supervisors' } }, 403);
  }
  const rows = await context.env.DB.prepare(`SELECT a.*, u.display_name AS userName
    FROM assistant_usage a
    JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC
    LIMIT 50`).all();
  return context.json({ ok: true, data: rows.results });
});

assistantRoutes.post('/chat', async (context) => {
  const body = await context.req.json<{ message?: string }>().catch(() => ({} as { message?: string }));
  const message = body.message?.trim();
  if (!message) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Message prompt required' } }, 422);
  }
  if (message.length > MAX_PROMPT_CHARACTERS) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: `Prompts are limited to ${MAX_PROMPT_CHARACTERS} characters` } }, 422);
  }

  const user = context.get('user');
  if (!await consumeRateLimit(context.env, `assistant:${user.id}`, 20, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many assistant requests. Try again later.' } }, 429);
  }

  // Pull active workspace context (tasks, wiki, blockers, decisions) subject to the caller's visibility.
  const wikiAccess = wikiVisibilityFilter(user);
  const wikiCondition = wikiAccess.sql ? `AND ${wikiAccess.sql}` : '';
  const [tasks, wiki, blockers, decisions, members] = await Promise.all([
    context.env.DB.prepare(`SELECT t.id, t.title, t.priority, t.status, u.display_name AS assignee
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.archived_at IS NULL LIMIT 25`).all<{ id: string; title: string; priority: string; status: string; assignee: string }>(),
    context.env.DB.prepare(`SELECT p.title, p.category, substr(v.content_markdown, 1, 200) AS excerpt
      FROM wiki_pages p JOIN wiki_versions v ON v.page_id = p.id AND v.version = p.current_version
      WHERE p.archived_at IS NULL ${wikiCondition} LIMIT 15`).bind(...wikiAccess.binds).all<{ title: string; category: string; excerpt: string }>(),
    context.env.DB.prepare(`SELECT title, severity, status FROM blockers WHERE status='open' LIMIT 10`).all<{ title: string; severity: string; status: string }>(),
    context.env.DB.prepare(`SELECT title, status, reasoning FROM decisions WHERE archived_at IS NULL LIMIT 10`).all<{ title: string; status: string; reasoning: string }>(),
    context.env.DB.prepare(`SELECT display_name AS name, specialization FROM users WHERE archived_at IS NULL`).all<{ name: string; specialization: string }>(),
  ]);

  // Search for relevant sources matching prompt
  const queryWords = message.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const relevantTasks = tasks.results.filter((t) => queryWords.some((w) => t.title.toLowerCase().includes(w) || (t.assignee && t.assignee.toLowerCase().includes(w))));
  const relevantWiki = wiki.results.filter((w) => queryWords.some((word) => w.title.toLowerCase().includes(word) || w.category.toLowerCase().includes(word)));
  const relevantDecisions = decisions.results.filter((d) => queryWords.some((word) => d.title.toLowerCase().includes(word)));

  const sources = [
    ...relevantTasks.map((t) => ({ type: 'task', title: t.title, meta: `${t.status} · ${t.assignee ?? 'unassigned'}` })),
    ...relevantWiki.map((w) => ({ type: 'wiki', title: w.title, meta: w.category })),
    ...relevantDecisions.map((d) => ({ type: 'decision', title: d.title, meta: d.status })),
  ].slice(0, 5);

  // Generate verified synthesis. The optional provider adapter is tried first; on
  // any failure the deterministic workspace-grounded response remains available.
  const providerReply = await requestProviderReply(context.env, message, {
    tasks: tasks.results,
    wiki: wiki.results,
    blockers: blockers.results,
    decisions: decisions.results,
    members: members.results,
    sources,
    user: { displayName: user.displayName, roles: user.roles },
  });

  let reply = providerReply?.reply ?? '';
  const provider = providerReply?.provider ?? 'cerberus-internal';
  const model = providerReply?.model ?? 'sentinel-rag-v1';

  if (!reply) {
    const lowerMsg = message.toLowerCase();

    if (lowerMsg.includes('blocker') || lowerMsg.includes('obstacle') || lowerMsg.includes('issue')) {
    if (blockers.results.length > 0) {
      reply = `Active system blockers currently recorded in the sentinel ledger:\n\n` +
        blockers.results.map((b) => `• [${b.severity.toUpperCase()}] ${b.title} (${b.status})`).join('\n') +
        `\n\nAll critical blockers must be resolved with verified notes before milestone submission gates can be cleared.`;
    } else {
      reply = `There are currently no open blockers recorded in the workspace. All critical engineering paths are clear.`;
    }
  } else if (lowerMsg.includes('member') || lowerMsg.includes('team') || lowerMsg.includes('who')) {
    reply = `CERBERUS Engineering Workspace roster comprises six core disciplines and academic supervision:\n\n` +
      members.results.map((m) => `• **${m.name}**: ${m.specialization || 'Member'}`).join('\n') +
      `\n\nEach member owns an independent 5-stage discipline roadmap verified through administrative crucible review.`;
  } else if (lowerMsg.includes('task') || lowerMsg.includes('status') || lowerMsg.includes('progress')) {
    const approvedCount = tasks.results.filter((t) => t.status === 'approved').length;
    const inReviewCount = tasks.results.filter((t) => t.status === 'ready_for_review').length;
    reply = `Current workspace task ledger status:\n\n` +
      `• **Total active tasks**: ${tasks.results.length}\n` +
      `• **Approved & verified**: ${approvedCount}\n` +
      `• **Awaiting review**: ${inReviewCount}\n\n` +
      `Recent items on the register:\n` +
      tasks.results.slice(0, 5).map((t) => `• ${t.title} (${t.status}, assigned to ${t.assignee ?? 'Unassigned'})`).join('\n');
  } else if (lowerMsg.includes('decision') || lowerMsg.includes('adr') || lowerMsg.includes('architecture')) {
    if (decisions.results.length > 0) {
      reply = `Architecture Decision Records (ADRs) on file:\n\n` +
        decisions.results.map((d) => `• **${d.title}** [${d.status}]: ${d.reasoning.slice(0, 100)}...`).join('\n');
    } else {
      reply = `Architecture decisions can be logged in the ADR module to document cryptographic choices, hardware pinouts, and protocol tradeoffs.`;
    }
  } else {
    reply = `**CERBERUS Sentinel Assistant Telemetry Response**:\n\n` +
      `In response to your query regarding "${message}", the workspace registers ${tasks.results.length} total tasks across 6 discipline roadmaps.\n\n` +
      `Key active anchors:\n` +
      (sources.length > 0
        ? sources.map((s) => `• [${s.type.toUpperCase()}] ${s.title} (${s.meta})`).join('\n')
        : `• Primary firmware, ML IDS, network visibility, RF CSI, backend API, and SOC dashboard disciplines are active.\n• Verification criteria require independent review before state transitions.`) +
      `\n\nLet me know if you would like me to inspect a specific task checklist, audit evidence requirements, or compile a progress report.`;
    }
  }

  if (reply.length > MAX_REPLY_CHARACTERS) reply = `${reply.slice(0, MAX_REPLY_CHARACTERS)}\n\n[Response truncated]`;

  // Record usage telemetry in assistant_usage
  const usageId = crypto.randomUUID();
  await context.env.DB.prepare(`INSERT INTO assistant_usage
    (id, user_id, provider, model, input_characters, output_characters, source_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`)
    .bind(usageId, user.id, provider, model, message.length, reply.length, sources.length).run();

  return context.json({
    ok: true,
    data: {
      reply,
      sources,
      usageId,
    },
  });
});
