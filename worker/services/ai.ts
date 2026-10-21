import type { Env } from '../types';

export interface AssistantContext {
  tasks: Array<Record<string, unknown>>;
  wiki: Array<Record<string, unknown>>;
  blockers: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  sources: Array<{ type: string; title: string; meta: string }>;
  user: { displayName: string; roles: string[] };
}

export interface ProviderReply {
  reply: string;
  provider: string;
  model: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const SYSTEM_PROMPT = [
  'You are the CERBERUS Workspace Sentinel Assistant.',
  'Answer using ONLY the supplied workspace context. Be concise, technical, and explicit about missing evidence.',
  'Never invent task states, approvals, measurements, credentials, or completed work.',
  'If the context does not contain the answer, say so and name the module that should be inspected.',
  'Never claim to have executed commands or modified records.',
].join(' ');

async function assistantEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT value_json FROM workspace_settings WHERE key='assistant.enabled'`)
    .first<{ value_json: string }>();
  if (!row) return false;
  try {
    return JSON.parse(row.value_json) === true;
  } catch {
    return false;
  }
}

/**
 * Optional OpenAI-compatible provider adapter. Returns null when the integration is
 * disabled, no key is configured, or the provider call fails; callers then use the
 * deterministic workspace-grounded fallback. The provider base URL is deployment
 * configuration (env), not a workspace-editable setting, to avoid SSRF.
 */
export async function requestProviderReply(env: Env, prompt: string, context: AssistantContext): Promise<ProviderReply | null> {
  if (!env.AI_API_KEY) return null;
  if (!await assistantEnabled(env)) return null;

  const baseUrl = (env.AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const model = env.AI_MODEL ?? DEFAULT_MODEL;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ prompt, context }) },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = payload.choices?.[0]?.message?.content?.trim();
    if (!reply || reply.length > 8000) return null;
    return { reply, provider: 'openai-compatible', model };
  } catch {
    return null;
  }
}
