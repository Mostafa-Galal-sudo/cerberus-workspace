import type { Env } from '../types';

export function audit(env: Env, actorId: string | null, action: string, resourceType: string, resourceId?: string, metadata: Record<string, unknown> = {}) {
  return env.DB.prepare(`INSERT INTO audit_logs (id, actor_id, action, resource_type, resource_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), actorId, action, resourceType, resourceId ?? null, JSON.stringify(metadata));
}
