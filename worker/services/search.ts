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
  if (query.length < 2) return { query, groups: [], total: 0 };

  const pattern = `%${escapeLikePattern(query)}%`;
  const take = Math.min(10, Math.max(1, limitPerType)) + 1;

  const wikiAccess = wikiVisibilityFilter(user);
  const wikiCondition = wikiAccess.sql ? `AND ${wikiAccess.sql}` : '';

  const [tasks, wiki, decisions] = await Promise.all([
    db.prepare(`SELECT t.id, t.title, t.status, t.priority, u.display_name AS assignee,
        substr(t.description, 1, 240) AS snippet
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.archived_at IS NULL
        AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
      ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.updated_at DESC
      LIMIT ?`)
      .bind(pattern, pattern, take)
      .all<{ id: string; title: string; status: string; priority: string; assignee: string | null; snippet: string }>(),
    db.prepare(`SELECT p.id, p.title, p.slug, p.category,
        substr(v.content_markdown, 1, 240) AS snippet
      FROM wiki_pages p
      JOIN wiki_versions v ON v.page_id = p.id AND v.version = p.current_version
      WHERE p.archived_at IS NULL ${wikiCondition}
        AND (p.title LIKE ? ESCAPE '\\' OR v.content_markdown LIKE ? ESCAPE '\\')
      ORDER BY p.updated_at DESC
      LIMIT ?`)
      .bind(...wikiAccess.binds, pattern, pattern, take)
      .all<{ id: string; title: string; slug: string; category: string; snippet: string }>(),
    db.prepare(`SELECT d.id, d.title, d.status, substr(d.reasoning, 1, 240) AS snippet
      FROM decisions d
      WHERE d.archived_at IS NULL
        AND (d.title LIKE ? ESCAPE '\\' OR d.reasoning LIKE ? ESCAPE '\\')
      ORDER BY d.created_at DESC
      LIMIT ?`)
      .bind(pattern, pattern, take)
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
