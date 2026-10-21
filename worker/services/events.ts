import type { Env } from '../types';

export interface WorkspaceEventInput {
  type: string;
  userIds: Array<string | null | undefined>;
  payload?: Record<string, unknown>;
}

export function workspaceEventStatements(env: Env, input: WorkspaceEventInput): D1PreparedStatement[] {
  const recipients = [...new Set(input.userIds.filter((value): value is string => Boolean(value)))];
  const payload = JSON.stringify(input.payload ?? {});
  return recipients.map((userId) =>
    env.DB.prepare(`INSERT INTO workspace_events (event_type, user_id, payload_json) VALUES (?, ?, ?)`)
      .bind(input.type, userId, payload),
  );
}

export async function publishWorkspaceEvent(env: Env, input: WorkspaceEventInput): Promise<void> {
  const statements = workspaceEventStatements(env, input);
  if (statements.length > 0) await env.DB.batch(statements);
}

export interface WorkspaceEventRow {
  seq: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export async function listWorkspaceEvents(env: Env, userId: string, afterSeq: number, limit = 100): Promise<WorkspaceEventRow[]> {
  const rows = await env.DB.prepare(`SELECT seq, event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt
    FROM workspace_events WHERE user_id=? AND seq>? ORDER BY seq ASC LIMIT ?`)
    .bind(userId, afterSeq, Math.min(200, Math.max(1, limit))).all<{ seq: number; eventType: string; payloadJson: string; createdAt: number }>();

  return rows.results.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return { seq: row.seq, eventType: row.eventType, payload, createdAt: row.createdAt };
  });
}
