import type { AuthUser, Env } from '../types';
import { requestProviderReply } from './ai';
import { searchWorkspace } from './search';
import { wikiVisibilityFilter } from './wiki-access';

export type AssistantCitationType = 'task' | 'wiki' | 'decision' | 'blocker' | 'member';
export type AssistantToolName =
  | 'search_workspace'
  | 'task_ledger'
  | 'open_blockers'
  | 'architecture_decisions'
  | 'team_roster'
  | 'documentation_index';

export interface AssistantCitation {
  index: number;
  type: AssistantCitationType;
  id: string;
  title: string;
  meta: string;
  snippet: string;
  link: string;
}

export interface AssistantToolRun {
  tool: AssistantToolName;
  label: string;
  resultCount: number;
  durationMs: number;
}

export interface AssistantContextRows {
  tasks: Array<Record<string, unknown>>;
  wiki: Array<Record<string, unknown>>;
  blockers: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
}

export interface AssistantRetrieval {
  citations: AssistantCitation[];
  toolRuns: AssistantToolRun[];
  context: AssistantContextRows;
}

interface ToolDefinition {
  name: AssistantToolName;
  label: string;
  description: string;
  readOnly: true;
  pattern?: RegExp;
}

/**
 * Every tool is a deterministic, server-side read over the caller's visible
 * workspace. Tool names are never accepted from the client, and no tool can
 * write, execute commands, or call a provider.
 */
export const ASSISTANT_TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: 'search_workspace',
    label: 'Workspace search',
    description: 'Searches tasks, documentation and architecture decisions with the same ACL as global search.',
    readOnly: true,
  },
  {
    name: 'open_blockers',
    label: 'Open blockers',
    description: 'Lists unresolved blockers with severity and ownership.',
    readOnly: true,
    pattern: /block|obstacle|issue|defect|risk/i,
  },
  {
    name: 'architecture_decisions',
    label: 'Architecture decisions',
    description: 'Reads the ADR register, including status and reasoning excerpts.',
    readOnly: true,
    pattern: /decision|adr|architecture|trade-?off/i,
  },
  {
    name: 'task_ledger',
    label: 'Task ledger',
    description: 'Summarises task status and recent task state across the workspace.',
    readOnly: true,
    pattern: /task|status|progress|milestone|review|deadline/i,
  },
  {
    name: 'team_roster',
    label: 'Team roster',
    description: 'Lists active members and their specialisations.',
    readOnly: true,
    pattern: /member|team|who|owner|assign|speciali[sz]ation/i,
  },
  {
    name: 'documentation_index',
    label: 'Documentation index',
    description: 'Lists visible wiki pages with category and excerpt.',
    readOnly: true,
    pattern: /wiki|document|doc|guide|spec|protocol/i,
  },
];

const TOOL_LABELS = new Map(ASSISTANT_TOOL_REGISTRY.map((tool) => [tool.name, tool.label]));

export function selectAssistantTools(prompt: string): AssistantToolName[] {
  const selected = new Set<AssistantToolName>(['search_workspace']);
  for (const tool of ASSISTANT_TOOL_REGISTRY) {
    if (tool.pattern?.test(prompt)) selected.add(tool.name);
  }
  if (selected.size === 1) {
    selected.add('task_ledger');
    selected.add('open_blockers');
  }
  return [...selected];
}

/** Collapses whitespace and trims a first prompt into a thread title. */
export function threadTitleFromMessage(message: string): string {
  const collapsed = message.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'New assistant thread';
  return collapsed.length > 80 ? `${collapsed.slice(0, 77)}...` : collapsed;
}

interface CitationDraft {
  type: AssistantCitationType;
  id: string;
  title: string;
  meta: string;
  snippet: string;
  link: string;
}

function emptyContext(): AssistantContextRows {
  return { tasks: [], wiki: [], blockers: [], decisions: [], members: [] };
}

export async function runAssistantRetrieval(
  db: D1Database,
  user: AuthUser,
  prompt: string,
): Promise<AssistantRetrieval> {
  const context = emptyContext();
  const drafts: CitationDraft[] = [];
  const toolRuns: AssistantToolRun[] = [];

  for (const toolName of selectAssistantTools(prompt)) {
    const startedAt = Date.now();
    let produced: CitationDraft[] = [];

    if (toolName === 'search_workspace') {
      const search = await searchWorkspace(db, user, prompt, 4);
      produced = search.groups.flatMap((group) => group.results.map((result) => ({
        type: result.type,
        id: result.id,
        title: result.title,
        meta: result.meta,
        snippet: result.snippet,
        link: result.link,
      })));
    } else if (toolName === 'task_ledger') {
      const rows = await db.prepare(`SELECT t.id, t.title, t.status, t.priority, u.display_name AS assignee
        FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.archived_at IS NULL
        ORDER BY CASE t.status WHEN 'blocked' THEN 0 WHEN 'ready_for_review' THEN 1 ELSE 2 END,
          CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          t.updated_at DESC
        LIMIT 12`).all<{ id: string; title: string; status: string; priority: string; assignee: string | null }>();
      context.tasks = rows.results;
      produced = rows.results.slice(0, 8).map((row) => ({
        type: 'task',
        id: row.id,
        title: row.title,
        meta: `${row.status.replaceAll('_', ' ')} · ${row.priority} · ${row.assignee ?? 'unassigned'}`,
        snippet: `${row.status.replaceAll('_', ' ')} task assigned to ${row.assignee ?? 'nobody'}.`,
        link: `/tasks/${row.id}`,
      }));
    } else if (toolName === 'open_blockers') {
      const rows = await db.prepare(`SELECT id, title, severity, status, substr(description, 1, 200) AS excerpt
        FROM blockers WHERE status = 'open'
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at DESC
        LIMIT 10`).all<{ id: string; title: string; severity: string; status: string; excerpt: string }>();
      context.blockers = rows.results;
      produced = rows.results.map((row) => ({
        type: 'blocker',
        id: row.id,
        title: row.title,
        meta: `${row.severity} · ${row.status}`,
        snippet: row.excerpt,
        link: '/issues',
      }));
    } else if (toolName === 'architecture_decisions') {
      const rows = await db.prepare(`SELECT id, title, status, substr(reasoning, 1, 200) AS excerpt
        FROM decisions WHERE archived_at IS NULL
        ORDER BY created_at DESC LIMIT 10`).all<{ id: string; title: string; status: string; excerpt: string }>();
      context.decisions = rows.results;
      produced = rows.results.map((row) => ({
        type: 'decision',
        id: row.id,
        title: row.title,
        meta: row.status,
        snippet: row.excerpt,
        link: '/decisions',
      }));
    } else if (toolName === 'team_roster') {
      const rows = await db.prepare(`SELECT id, display_name AS name, specialization
        FROM users WHERE archived_at IS NULL AND status = 'active' ORDER BY display_name`)
        .all<{ id: string; name: string; specialization: string | null }>();
      context.members = rows.results;
      produced = rows.results.map((row) => ({
        type: 'member',
        id: row.id,
        title: row.name,
        meta: row.specialization ?? 'Workspace member',
        snippet: row.specialization ?? 'Workspace member',
        link: '/members',
      }));
    } else if (toolName === 'documentation_index') {
      const access = wikiVisibilityFilter(user);
      const condition = access.sql ? `AND ${access.sql}` : '';
      const rows = await db.prepare(`SELECT p.id, p.title, p.slug, p.category, substr(v.content_markdown, 1, 200) AS excerpt
        FROM wiki_pages p JOIN wiki_versions v ON v.page_id = p.id AND v.version = p.current_version
        WHERE p.archived_at IS NULL ${condition}
        ORDER BY p.updated_at DESC LIMIT 10`)
        .bind(...access.binds)
        .all<{ id: string; title: string; slug: string; category: string; excerpt: string }>();
      context.wiki = rows.results;
      produced = rows.results.map((row) => ({
        type: 'wiki',
        id: row.id,
        title: row.title,
        meta: row.category,
        snippet: row.excerpt,
        link: `/wiki/${row.slug}`,
      }));
    }

    toolRuns.push({
      tool: toolName,
      label: TOOL_LABELS.get(toolName) ?? toolName,
      resultCount: produced.length,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    drafts.push(...produced);
  }

  const seen = new Set<string>();
  const citations: AssistantCitation[] = [];
  for (const draft of drafts) {
    const key = `${draft.type}:${draft.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ index: citations.length + 1, ...draft });
    if (citations.length >= 8) break;
  }

  return { citations, toolRuns, context };
}

export function deterministicReply(prompt: string, retrieval: AssistantRetrieval): string {
  const { context, citations } = retrieval;
  const lower = prompt.toLowerCase();

  if (/block|obstacle|issue|defect|risk/.test(lower)) {
    if (context.blockers.length > 0) {
      return 'Active system blockers currently recorded in the sentinel ledger:\n\n'
        + context.blockers.map((row) => `• [${String(row.severity).toUpperCase()}] ${row.title} (${row.status})`).join('\n')
        + '\n\nAll critical blockers must be resolved with verified notes before milestone submission gates can be cleared.';
    }
    return 'There are currently no open blockers recorded in the workspace. All critical engineering paths are clear.';
  }

  if (/member|team|who|owner|assign|speciali[sz]ation/.test(lower)) {
    if (context.members.length > 0) {
      return 'CERBERUS engineering roster:\n\n'
        + context.members.map((row) => `• **${row.name}**: ${row.specialization ?? 'Member'}`).join('\n')
        + '\n\nEach member owns an independent discipline roadmap verified through administrative review.';
    }
    return 'The active member roster is currently empty.';
  }

  if (/task|status|progress|milestone|review/.test(lower)) {
    const tasks = context.tasks;
    const approved = tasks.filter((row) => row.status === 'approved').length;
    const inReview = tasks.filter((row) => row.status === 'ready_for_review').length;
    return 'Current workspace task ledger status:\n\n'
      + `• **Tasks inspected**: ${tasks.length}\n`
      + `• **Approved & verified**: ${approved}\n`
      + `• **Awaiting review**: ${inReview}\n\n`
      + 'Recent items on the register:\n'
      + tasks.slice(0, 5).map((row) => `• ${row.title} (${row.status}, assigned to ${row.assignee ?? 'Unassigned'})`).join('\n');
  }

  if (/decision|adr|architecture|trade-?off/.test(lower)) {
    if (context.decisions.length > 0) {
      return 'Architecture Decision Records (ADRs) on file:\n\n'
        + context.decisions.map((row) => `• **${row.title}** [${row.status}]: ${String(row.excerpt).slice(0, 120)}...`).join('\n');
    }
    return 'No architecture decisions are currently recorded. The ADR module can document protocol, hardware, and cryptographic tradeoffs.';
  }

  const anchors = citations.slice(0, 5).map((citation) =>
    `• [${citation.index}] ${citation.type.toUpperCase()}: ${citation.title} (${citation.meta})`);
  return '**CERBERUS Sentinel Assistant**\n\n'
    + `In response to "${prompt}", the workspace retrieval tools returned ${citations.length} relevant source(s).\n\n`
    + (anchors.length > 0
      ? `Key anchors:\n${anchors.join('\n')}`
      : 'No matching workspace records were found. Name a task, wiki page, blocker, decision, or member for a grounded answer.')
    + '\n\nAsk about a specific task checklist, evidence requirement, blocker, or decision to narrow the response.';
}

export interface AssistantAnswer {
  reply: string;
  provider: string;
  model: string;
  citations: AssistantCitation[];
  toolRuns: AssistantToolRun[];
}

export async function answerAssistantPrompt(
  env: Env,
  user: AuthUser,
  prompt: string,
): Promise<AssistantAnswer> {
  const retrieval = await runAssistantRetrieval(env.DB, user, prompt);
  const providerReply = await requestProviderReply(env, prompt, {
    ...retrieval.context,
    sources: retrieval.citations.map((citation) => ({
      type: citation.type,
      title: citation.title,
      meta: citation.meta,
    })),
    citations: retrieval.citations.map((citation) => ({
      index: citation.index,
      type: citation.type,
      title: citation.title,
      meta: citation.meta,
      snippet: citation.snippet,
    })),
    user: { displayName: user.displayName, roles: user.roles },
  });

  const reply = (providerReply?.reply ?? deterministicReply(prompt, retrieval)).slice(0, 20_000);
  return {
    reply,
    provider: providerReply?.provider ?? 'cerberus-internal',
    model: providerReply?.model ?? 'sentinel-rag-v1',
    citations: retrieval.citations,
    toolRuns: retrieval.toolRuns,
  };
}
