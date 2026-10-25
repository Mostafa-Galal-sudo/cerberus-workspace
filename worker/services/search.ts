import type { AuthUser } from '../types';
import { wikiVisibilityFilter } from './wiki-access';

export type SearchResourceType = 'task' | 'wiki' | 'decision';

export interface SearchResultItem {
  type: SearchResourceType;
  id: string;
  title: string;
  snippet: string;
  meta: string;
  link: string;
}

export interface SearchGroup {
  type: SearchResourceType;
  label: string;
  results: SearchResultItem[];
  truncated: boolean;
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  total: number;
}

/** Escapes SQL LIKE wildcards while keeping a literal backslash escape. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Cloudflare D1 rejects LIKE patterns longer than 50 bytes with
 * "LIKE or GLOB pattern too complex", so every pattern is budgeted here.
 */
const MAX_LIKE_PATTERN_BYTES = 48;
const MAX_SEARCH_TERMS = 4;
const MIN_TERM_LENGTH = 3;
const STOP_WORDS = new Set([
  'about', 'across', 'after', 'again', 'against', 'along', 'among', 'and', 'another', 'any', 'are', 'around',
  'because', 'been', 'before', 'being', 'between', 'both', 'but', 'can', 'could', 'does', 'doing',
  'done', 'during', 'each', 'either', 'else', 'every', 'for', 'from', 'further', 'get', 'give',
  'have', 'having', 'here', 'hers', 'himself', 'how', 'into', 'itself', 'just', 'list', 'may',
  'might', 'more', 'most', 'much', 'must', 'myself', 'neither', 'nor', 'not', 'now', 'off',
  'once', 'only', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'please', 'same',
  'shall', 'she', 'should', 'show', 'some', 'such', 'tell', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'too', 'under', 'until', 'very', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself',
]);

function withinPatternBudget(value: string): boolean {
  return new TextEncoder().encode(escapeLikePattern(value)).length <= MAX_LIKE_PATTERN_BYTES;
}

/**
 * Short queries stay phrase searches. Longer natural-language prompts (for
 * example assistant questions) degrade to their most selective keywords so the
 * generated LIKE patterns remain inside the D1 byte limit.
 */
export function buildLikePatterns(rawQuery: string): string[] {
  const query = rawQuery.replace(/\s+/g, ' ').trim();
  if (query.length < 2) return [];
  if (withinPatternBudget(query)) return [`%${escapeLikePattern(query)}%`];

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const word of query.split(/[^\p{L}\p{N}_-]+/u)) {
    const term = word.slice(0, MAX_LIKE_PATTERN_BYTES);
    const key = term.toLowerCase();
    if (term.length < MIN_TERM_LENGTH || STOP_WORDS.has(key) || seen.has(key) || !withinPatternBudget(term)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_SEARCH_TERMS) break;
  }
  return terms.map((term) => `%${escapeLikePattern(term)}%`);
}

function likeClause(column: string, patternCount: number): string {
  return Array.from({ length: patternCount }, () => `${column} LIKE ? ESCAPE '\\'`).join(' OR ');
}

/**
 * Workspace-wide search over tasks, documentation and architecture decisions.
 * Task and decision visibility is team-wide; wiki rows are filtered with the
 * same ACL used by the wiki module so restricted pages never appear here.
 */
export async function searchWorkspace(
  db: D1Database,
  user: Pick<AuthUser, 'roles' | 'permissions'>,
  rawQuery: string,
  limitPerType = 5,
): Promise<SearchResponse> {
  const query = rawQuery.trim();
  const patterns = buildLikePatterns(query);
  if (patterns.length === 0) return { query, groups: [], total: 0 };

  const take = Math.min(10, Math.max(1, limitPerType)) + 1;

  const wikiAccess = wikiVisibilityFilter(user);
  const wikiCondition = wikiAccess.sql ? `AND ${wikiAccess.sql}` : '';

  const [tasks, wiki, decisions] = await Promise.all([
    db.prepare(`SELECT t.id, t.title, t.status, t.priority, u.display_name AS assignee,
        substr(t.description, 1, 240) AS snippet
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.archived_at IS NULL
        AND ((${likeClause('t.title', patterns.length)}) OR (${likeClause('t.description', patterns.length)}))
      ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.updated_at DESC
      LIMIT ?`)
      .bind(...patterns, ...patterns, take)
      .all<{ id: string; title: string; status: string; priority: string; assignee: string | null; snippet: string }>(),
    db.prepare(`SELECT p.id, p.title, p.slug, p.category,
        substr(v.content_markdown, 1, 240) AS snippet
      FROM wiki_pages p
      JOIN wiki_versions v ON v.page_id = p.id AND v.version = p.current_version
      WHERE p.archived_at IS NULL ${wikiCondition}
        AND ((${likeClause('p.title', patterns.length)}) OR (${likeClause('v.content_markdown', patterns.length)}))
      ORDER BY p.updated_at DESC
      LIMIT ?`)
      .bind(...wikiAccess.binds, ...patterns, ...patterns, take)
      .all<{ id: string; title: string; slug: string; category: string; snippet: string }>(),
    db.prepare(`SELECT d.id, d.title, d.status, substr(d.reasoning, 1, 240) AS snippet
      FROM decisions d
      WHERE d.archived_at IS NULL
        AND ((${likeClause('d.title', patterns.length)}) OR (${likeClause('d.reasoning', patterns.length)}))
      ORDER BY d.created_at DESC
      LIMIT ?`)
      .bind(...patterns, ...patterns, take)
      .all<{ id: string; title: string; status: string; snippet: string }>(),
  ]);

  const allGroups: SearchGroup[] = [
    {
      type: 'task',
      label: 'Tasks',
      truncated: tasks.results.length > limitPerType,
      results: tasks.results.slice(0, limitPerType).map((row) => ({
        type: 'task',
        id: row.id,
        title: row.title,
        snippet: row.snippet,
        meta: `${row.status.replaceAll('_', ' ')} · ${row.priority} · ${row.assignee ?? 'unassigned'}`,
        link: `/tasks/${row.id}`,
      })),
    },
    {
      type: 'wiki',
      label: 'Documentation',
      truncated: wiki.results.length > limitPerType,
      results: wiki.results.slice(0, limitPerType).map((row) => ({
        type: 'wiki',
        id: row.id,
        title: row.title,
        snippet: row.snippet,
        meta: row.category,
        link: `/wiki/${row.slug}`,
      })),
    },
    {
      type: 'decision',
      label: 'Architecture decisions',
      truncated: decisions.results.length > limitPerType,
      results: decisions.results.slice(0, limitPerType).map((row) => ({
        type: 'decision',
        id: row.id,
        title: row.title,
        snippet: row.snippet,
        meta: row.status,
        link: '/decisions',
      })),
    },
  ];

  const groups = allGroups.filter((group) => group.results.length > 0);

  return { query, groups, total: groups.reduce((sum, group) => sum + group.results.length, 0) };
}
