import { beforeEach, describe, expect, it } from 'vitest';
import {
  RECENT_PALETTE_KEY,
  isSafePaletteLink,
  loadRecentPaletteItems,
  rememberPaletteItem,
} from '../../src/lib/palette';

describe('command palette helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('accepts internal workspace paths only', () => {
    expect(isSafePaletteLink('/tasks/task_1')).toBe(true);
    expect(isSafePaletteLink('/wiki/protocol-notes?tab=history')).toBe(true);

    expect(isSafePaletteLink('https://evil.example/tasks')).toBe(false);
    expect(isSafePaletteLink('//evil.example/tasks')).toBe(false);
    expect(isSafePaletteLink('/\\evil.example')).toBe(false);
    expect(isSafePaletteLink('/tasks\njavascript:alert(1)')).toBe(false);
    expect(isSafePaletteLink('')).toBe(false);
    expect(isSafePaletteLink(null)).toBe(false);
    expect(isSafePaletteLink(42)).toBe(false);
  });

  it('drops unsafe or malformed entries from persisted recents', () => {
    localStorage.setItem(RECENT_PALETTE_KEY, JSON.stringify([
      { type: 'Tasks', title: 'Safe task', link: '/tasks/task_1', at: 1 },
      { type: 'Tasks', title: 'External target', link: 'https://evil.example', at: 2 },
      { type: 'Wiki', title: 'Missing link', at: 3 },
      'not-an-object',
    ]));

    expect(loadRecentPaletteItems()).toEqual([
      { type: 'Tasks', title: 'Safe task', link: '/tasks/task_1', at: 1 },
    ]);

    localStorage.setItem(RECENT_PALETTE_KEY, '{broken json');
    expect(loadRecentPaletteItems()).toEqual([]);
  });

  it('deduplicates recents by link and caps the list at six entries', () => {
    for (let index = 0; index < 8; index += 1) {
      rememberPaletteItem({ type: 'Tasks', title: `Task ${index}`, link: `/tasks/task_${index}` });
    }
    rememberPaletteItem({ type: 'Tasks', title: 'Task 7 revisited', link: '/tasks/task_7' });

    const recents = loadRecentPaletteItems();
    expect(recents).toHaveLength(6);
    expect(recents[0]).toMatchObject({ title: 'Task 7 revisited', link: '/tasks/task_7' });
    expect(recents.filter((item) => item.link === '/tasks/task_7')).toHaveLength(1);
  });
});
