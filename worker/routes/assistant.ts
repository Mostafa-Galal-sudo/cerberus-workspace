import { Hono } from 'hono';
import {
  assistantMessageSchema,
  assistantThreadCreateSchema,
  assistantThreadRenameSchema,
} from '../../shared/schemas/assistant';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { answerAssistantPrompt, threadTitleFromMessage, type AssistantCitation, type AssistantToolRun } from '../services/assistant';
import { audit } from '../services/audit';
import { consumeRateLimit } from '../services/rate-limit';
import type { Env, Variables } from '../types';

export const assistantRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
assistantRoutes.use('*', requireAuth, requirePasswordChanged);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_REPLY_CHARACTERS = 20_000;
const MAX_THREAD_MESSAGES = 200;

interface ThreadRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  message_count?: number;
  last_message_at?: number | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations_json: string;
  tool_runs_json: string;
  provider: string | null;
  model: string | null;
  created_at: number;
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function serializeThread(row: ThreadRow) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived_at !== null,
    messageCount: row.message_count ?? 0,
    lastMessageAt: row.last_message_at ?? null,
  };
}

function serializeMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: parseJsonArray<AssistantCitation>(row.citations_json),
    toolRuns: parseJsonArray<AssistantToolRun>(row.tool_runs_json),
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
  };
}

function pageParams(rawPage: string | undefined, rawLimit: string | undefined) {
  const requestedPage = Number(rawPage ?? 1);
  const requestedLimit = Number(rawLimit ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1;
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requestedLimit)))
    : DEFAULT_PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

async function loadOwnedThread(db: D1Database, userId: string, threadId: string): Promise<ThreadRow | null> {
  return db.prepare(`SELECT t.id, t.title, t.created_at, t.updated_at, t.archived_at,
      (SELECT COUNT(*) FROM assistant_messages m WHERE m.thread_id = t.id) AS message_count,
      (SELECT MAX(m.created_at) FROM assistant_messages m WHERE m.thread_id = t.id) AS last_message_at
    FROM assistant_threads t WHERE t.id = ? AND t.user_id = ?`).bind(threadId, userId).first<ThreadRow>();
}

async function loadThreadMessages(db: D1Database, threadId: string): Promise<MessageRow[]> {
  const rows = await db.prepare(`SELECT id, thread_id, role, content, citations_json, tool_runs_json, provider, model, created_at
    FROM assistant_messages WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?`)
    .bind(threadId, MAX_THREAD_MESSAGES).all<MessageRow>();
  return rows.results;
}

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

assistantRoutes.get('/threads', async (context) => {
  const user = context.get('user');
  const { page, limit, offset } = pageParams(context.req.query('page'), context.req.query('limit'));
  const [rows, total] = await Promise.all([
    context.env.DB.prepare(`SELECT t.id, t.title, t.created_at, t.updated_at, t.archived_at,
        (SELECT COUNT(*) FROM assistant_messages m WHERE m.thread_id = t.id) AS message_count,
        (SELECT MAX(m.created_at) FROM assistant_messages m WHERE m.thread_id = t.id) AS last_message_at
      FROM assistant_threads t
      WHERE t.user_id = ? AND t.archived_at IS NULL
      ORDER BY t.updated_at DESC, t.rowid DESC LIMIT ? OFFSET ?`)
      .bind(user.id, limit, offset).all<ThreadRow>(),
    context.env.DB.prepare(`SELECT COUNT(*) AS count FROM assistant_threads
      WHERE user_id = ? AND archived_at IS NULL`).bind(user.id).first<{ count: number }>(),
  ]);
  const totalCount = total?.count ?? 0;

  return context.json({
    ok: true,
    data: { threads: rows.results.map(serializeThread) },
    meta: { page, limit, total: totalCount, hasMore: page * limit < totalCount },
  });
});

assistantRoutes.post('/threads', async (context) => {
  const user = context.get('user');
  const parsed = assistantThreadCreateSchema.safeParse(await context.req.json().catch(() => ({})));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Thread titles are limited to 120 characters' } }, 422);
  }
  if (!await consumeRateLimit(context.env, `assistant-thread:${user.id}`, 40, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many assistant threads. Try again later.' } }, 429);
  }

  const threadId = crypto.randomUUID();
  const title = parsed.data.title ?? 'New assistant thread';
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO assistant_threads (id, user_id, title) VALUES (?, ?, ?)`)
      .bind(threadId, user.id, title),
    audit(context.env, user.id, 'assistant.thread_created', 'assistant_thread', threadId),
  ]);
  const thread = await loadOwnedThread(context.env.DB, user.id, threadId);
  return context.json({ ok: true, data: { thread: thread ? serializeThread(thread) : null } }, 201);
});

assistantRoutes.get('/threads/:threadId', async (context) => {
  const user = context.get('user');
  const thread = await loadOwnedThread(context.env.DB, user.id, context.req.param('threadId'));
  if (!thread) {
    return context.json({ ok: false, error: { code: 'THREAD_NOT_FOUND', message: 'Assistant thread not found' } }, 404);
  }
  const messages = await loadThreadMessages(context.env.DB, thread.id);
  return context.json({ ok: true, data: { thread: serializeThread(thread), messages: messages.map(serializeMessage) } });
});

assistantRoutes.patch('/threads/:threadId', async (context) => {
  const user = context.get('user');
  const parsed = assistantThreadRenameSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'A thread title between 1 and 120 characters is required', fields: parsed.error.flatten().fieldErrors } }, 422);
  }
  const thread = await loadOwnedThread(context.env.DB, user.id, context.req.param('threadId'));
  if (!thread || thread.archived_at !== null) {
    return context.json({ ok: false, error: { code: 'THREAD_NOT_FOUND', message: 'Assistant thread not found' } }, 404);
  }

  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE assistant_threads SET title = ?, updated_at = unixepoch() WHERE id = ?`)
      .bind(parsed.data.title, thread.id),
    audit(context.env, user.id, 'assistant.thread_renamed', 'assistant_thread', thread.id),
  ]);
  const updated = await loadOwnedThread(context.env.DB, user.id, thread.id);
  return context.json({ ok: true, data: { thread: updated ? serializeThread(updated) : null } });
});

assistantRoutes.delete('/threads/:threadId', async (context) => {
  const user = context.get('user');
  const thread = await loadOwnedThread(context.env.DB, user.id, context.req.param('threadId'));
  if (!thread) {
    return context.json({ ok: false, error: { code: 'THREAD_NOT_FOUND', message: 'Assistant thread not found' } }, 404);
  }
  if (thread.archived_at === null) {
    await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE assistant_threads SET archived_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`)
        .bind(thread.id),
      audit(context.env, user.id, 'assistant.thread_archived', 'assistant_thread', thread.id),
    ]);
  }
  return context.json({ ok: true, data: { archived: true } });
});

assistantRoutes.post('/threads/:threadId/messages', async (context) => {
  const user = context.get('user');
  const parsed = assistantMessageSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Enter a question between 1 and 8,000 characters', fields: parsed.error.flatten().fieldErrors } }, 422);
  }

  const thread = await loadOwnedThread(context.env.DB, user.id, context.req.param('threadId'));
  if (!thread) {
    return context.json({ ok: false, error: { code: 'THREAD_NOT_FOUND', message: 'Assistant thread not found' } }, 404);
  }
  if (thread.archived_at !== null) {
    return context.json({ ok: false, error: { code: 'THREAD_ARCHIVED', message: 'This thread is archived. Start a new thread to continue.' } }, 409);
  }
  if (!await consumeRateLimit(context.env, `assistant:${user.id}`, 30, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many assistant requests. Try again later.' } }, 429);
  }

  const message = parsed.data.message;
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const answer = await answerAssistantPrompt(context.env, user, message);
  const reply = answer.reply.slice(0, MAX_REPLY_CHARACTERS);
  const usageId = crypto.randomUUID();
  const history = await context.env.DB.prepare(`SELECT COUNT(*) AS count FROM assistant_messages WHERE thread_id = ?`)
    .bind(thread.id).first<{ count: number }>();
  const nextTitle = thread.title === 'New assistant thread' || (history?.count ?? 0) === 0
    ? threadTitleFromMessage(message)
    : thread.title;

  const statements = [
    context.env.DB.prepare(`INSERT INTO assistant_messages (id, thread_id, role, content, citations_json, tool_runs_json)
      VALUES (?, ?, 'user', ?, '[]', '[]')`).bind(userMessageId, thread.id, message),
    context.env.DB.prepare(`INSERT INTO assistant_messages
        (id, thread_id, role, content, citations_json, tool_runs_json, provider, model)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`)
      .bind(
        assistantMessageId, thread.id, reply,
        JSON.stringify(answer.citations), JSON.stringify(answer.toolRuns),
        answer.provider, answer.model,
      ),
    context.env.DB.prepare(`UPDATE assistant_threads SET title = ?, updated_at = unixepoch() WHERE id = ?`)
      .bind(nextTitle, thread.id),
    context.env.DB.prepare(`INSERT INTO assistant_usage
        (id, user_id, provider, model, input_characters, output_characters, source_count, status, thread_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`)
      .bind(usageId, user.id, answer.provider, answer.model, message.length, reply.length, answer.citations.length, thread.id),
    audit(context.env, user.id, 'assistant.message_sent', 'assistant_thread', thread.id, {
      messageId: userMessageId,
      citationCount: answer.citations.length,
      toolCount: answer.toolRuns.length,
    }),
    ...answer.toolRuns.map((run) => audit(context.env, user.id, 'assistant.tool_invoked', 'assistant_thread', thread.id, {
      messageId: assistantMessageId,
      tool: run.tool,
      resultCount: run.resultCount,
      durationMs: run.durationMs,
    })),
  ];
  await context.env.DB.batch(statements);

  const [updatedThread, latest] = await Promise.all([
    loadOwnedThread(context.env.DB, user.id, thread.id),
    context.env.DB.prepare(`SELECT id, thread_id, role, content, citations_json, tool_runs_json, provider, model, created_at
      FROM assistant_messages WHERE id = ?`).bind(assistantMessageId).first<MessageRow>(),
  ]);

  return context.json({
    ok: true,
    data: {
      thread: updatedThread ? serializeThread(updatedThread) : null,
      message: latest ? serializeMessage(latest) : null,
      usageId,
    },
  }, 201);
});

// Legacy stateless endpoint retained for existing clients and telemetry tests.
assistantRoutes.post('/chat', async (context) => {
  const parsed = assistantMessageSchema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    return context.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Message prompt required' } }, 422);
  }
  const user = context.get('user');
  if (!await consumeRateLimit(context.env, `assistant:${user.id}`, 20, 900)) {
    return context.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many assistant requests. Try again later.' } }, 429);
  }

  const message = parsed.data.message;
  const answer = await answerAssistantPrompt(context.env, user, message);
  const reply = answer.reply.slice(0, MAX_REPLY_CHARACTERS);
  const usageId = crypto.randomUUID();
  await context.env.DB.prepare(`INSERT INTO assistant_usage
      (id, user_id, provider, model, input_characters, output_characters, source_count, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`)
    .bind(usageId, user.id, answer.provider, answer.model, message.length, reply.length, answer.citations.length)
    .run();

  return context.json({
    ok: true,
    data: {
      reply,
      sources: answer.citations.map((citation) => ({
        type: citation.type,
        title: citation.title,
        meta: citation.meta,
      })),
      citations: answer.citations,
      toolRuns: answer.toolRuns,
      usageId,
    },
  });
});
