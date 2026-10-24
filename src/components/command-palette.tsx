import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BookOpen,
  CheckSquare2,
  Clock,
  Command,
  Cpu,
  FlaskConical,
  LayoutDashboard,
  Scale,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  isSafePaletteLink,
  loadRecentPaletteItems,
  rememberPaletteItem,
  type RecentPaletteItem,
} from '../lib/palette';

interface SearchItem {
  type: string;
  id: string;
  title: string;
  snippet: string;
  meta: string;
  link: string;
}

interface SearchGroup {
  type: string;
  label: string;
  results: SearchItem[];
  truncated: boolean;
}

interface SearchPayload {
  query: string;
  groups: SearchGroup[];
  total: number;
}

interface PaletteOption {
  key: string;
  group: string;
  title: string;
  hint: string;
  link: string;
  icon: 'task' | 'wiki' | 'decision' | 'action' | 'recent';
}

const QUICK_ACTIONS: Omit<PaletteOption, 'key' | 'group'>[] = [
  { title: 'Overview dashboard', hint: 'Open overview', link: '/', icon: 'action' },
  { title: 'Task register', hint: 'Tasks and checkpoints', link: '/tasks', icon: 'task' },
  { title: 'Documentation wiki', hint: 'Engineering notes', link: '/wiki', icon: 'wiki' },
  { title: 'Hardware testbed', hint: 'Inventory and custody', link: '/hardware', icon: 'action' },
  { title: 'Empirical runs', hint: 'Experiments and results', link: '/experiments', icon: 'action' },
  { title: 'Architecture decisions', hint: 'Decision records', link: '/decisions', icon: 'decision' },
  { title: 'Notifications', hint: 'Unread alerts', link: '/notifications', icon: 'action' },
  { title: 'Command center', hint: 'Administration', link: '/admin', icon: 'action' },
];

function iconFor(type: string) {
  if (type === 'task') return CheckSquare2;
  if (type === 'wiki') return BookOpen;
  if (type === 'decision') return Scale;
  if (type === 'hardware') return Cpu;
  if (type === 'experiment') return FlaskConical;
  if (type === 'recent') return Clock;
  if (type === 'action') return ArrowUpRight;
  return LayoutDashboard;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<RecentPaletteItem[]>(loadRecentPaletteItems);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const searchQuery = useQuery({
    queryKey: ['palette-search', debounced],
    queryFn: () => api<SearchPayload>(`/search?q=${encodeURIComponent(debounced)}&limit=5`),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });

  const options = useMemo<PaletteOption[]>(() => {
    if (query.trim().length < 2) {
      const actions = QUICK_ACTIONS.map<PaletteOption>((action, index) => ({
        ...action,
        key: `action-${index}`,
        group: 'Quick actions',
      }));
      const recentOptions = recent.map<PaletteOption>((item) => ({
        key: `recent-${item.link}`,
        group: 'Recent',
        title: item.title,
        hint: item.type,
        link: item.link,
        icon: 'recent',
      }));
      return [...actions, ...recentOptions];
    }

    return (searchQuery.data?.groups ?? []).flatMap((group) =>
      group.results.map<PaletteOption>((item) => ({
        key: `${item.type}-${item.id}`,
        group: group.label,
        title: item.title,
        hint: item.meta,
        link: item.link,
        icon: item.type === 'task' ? 'task' : item.type === 'wiki' ? 'wiki' : 'decision',
      })),
    );
  }, [query, recent, searchQuery.data]);

  useEffect(() => {
    optionRefs.current[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (option: PaletteOption) => {
    if (!isSafePaletteLink(option.link)) return;
    setRecent(rememberPaletteItem({ type: option.group, title: option.title, link: option.link }));
    onClose();
    navigate(option.link);
  };

  const move = (direction: 1 | -1) => {
    if (!options.length) return;
    setSelected((current) => (current + direction + options.length) % options.length);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter' && options[selected]) {
      event.preventDefault();
      choose(options[selected]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const grouped = options.reduce<Array<{ label: string; items: Array<{ option: PaletteOption; index: number }> }>>(
    (groups, option, index) => {
      const existing = groups.find((group) => group.label === option.group);
      if (existing) existing.items.push({ option, index });
      else groups.push({ label: option.group, items: [{ option, index }] });
      return groups;
    },
    [],
  );

  const showHint = query.trim().length < 2;
  const loading = searchQuery.isFetching && debounced.length >= 2;
  const failed = searchQuery.isError;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="palette-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search the workspace"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="palette-search">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="Search tasks, documentation and decisions…"
            aria-label="Search the workspace"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-autocomplete="list"
            aria-activedescendant={options[selected] ? `palette-option-${selected}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>

        <div id="command-palette-results" className="palette-results" role="listbox" aria-label="Workspace results">
          {showHint && (
            <p className="palette-tip">
              Type at least two characters for server-side workspace search.
            </p>
          )}
          {loading && <p className="palette-status">Searching…</p>}
          {failed && <p className="palette-status palette-error">Search is unavailable right now. Try again.</p>}
          {!loading && !failed && !showHint && options.length === 0 && (
            <p className="palette-status">No matching tasks, documentation or decisions.</p>
          )}

          {grouped.map((group) => (
            <section key={group.label} className="palette-group" aria-label={group.label}>
              <h3>{group.label}</h3>
              {group.items.map(({ option, index }) => {
                const Icon = iconFor(option.icon);
                const active = index === selected;
                return (
                  <button
                    key={option.key}
                    id={`palette-option-${index}`}
                    ref={(element) => { optionRefs.current[index] = element; }}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? 'palette-option is-active' : 'palette-option'}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => choose(option)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="palette-option-copy">
                      <strong>{option.title}</strong>
                      <small>{option.hint}</small>
                    </span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <footer className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><Command size={12} aria-hidden="true" /><kbd>K</kbd> Toggle</span>
        </footer>
      </div>
    </div>
  );
}
