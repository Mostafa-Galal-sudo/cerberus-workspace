export interface RecentPaletteItem {
  type: string;
  title: string;
  link: string;
  at: number;
}

export const RECENT_PALETTE_KEY = 'cerberus.palette.recent';
const MAX_RECENT = 6;

/** Internal workspace paths only: no protocol, no protocol-relative URL, no backslashes. */
export function isSafePaletteLink(link: unknown): link is string {
  return typeof link === 'string'
    && link.startsWith('/')
    && !link.startsWith('//')
    && !link.includes('\\')
    && !Array.from(link).some((character) => character.charCodeAt(0) < 32);
}

export function loadRecentPaletteItems(): RecentPaletteItem[] {
  try {
    const raw = localStorage.getItem(RECENT_PALETTE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is RecentPaletteItem => {
        if (!item || typeof item !== 'object') return false;
        const value = item as Partial<RecentPaletteItem>;
        return typeof value.title === 'string'
          && typeof value.type === 'string'
          && typeof value.at === 'number'
          && isSafePaletteLink(value.link);
      })
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberPaletteItem(item: Omit<RecentPaletteItem, 'at'>): RecentPaletteItem[] {
  const next = [
    { ...item, at: Date.now() },
    ...loadRecentPaletteItems().filter((existing) => existing.link !== item.link),
  ].slice(0, MAX_RECENT);

  try {
    localStorage.setItem(RECENT_PALETTE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private contexts; recents are best-effort.
  }
  return next;
}
