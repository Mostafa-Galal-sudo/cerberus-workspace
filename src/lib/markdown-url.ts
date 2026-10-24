/**
 * Only absolute http(s) links, mail links, and same-origin relative/anchor
 * links survive. javascript:, data:, vbscript: and every other scheme are
 * dropped before React ever writes an href.
 */
export function safeMarkdownUrl(url: string): string {
  const value = url.trim();
  if (!value) return '';
  if (value.startsWith('#') || value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? value : '';
  } catch {
    return '';
  }
}
