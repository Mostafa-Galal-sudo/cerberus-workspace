const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/** Returns a normalized http(s) URL, or null for anything else (javascript:, data:, vbscript:, garbage). */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(value: unknown): value is string {
  return safeHttpUrl(value) !== null;
}

/** Accepts only an absolute http(s) URL; empty strings are rejected. */
export function isSafeHttpUrlOrEmpty(value: unknown): boolean {
  return value === '' || isSafeHttpUrl(value);
}
