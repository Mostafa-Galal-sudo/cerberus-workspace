import {
  Activity,
  AlertOctagon,
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  CheckSquare2,
  ClipboardCheck,
  Cpu,
  FileCheck,
  FileText,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Scale,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth-context';
import { useRealtimeEvents } from '../lib/use-realtime-events';
import { api } from '../lib/api';
import { Button } from './ui';
import { CommandPalette } from './command-palette';
import { CerberusLogo, CerberusSentinelStatus } from './cerberus-logo';

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mode, setMode] = useState<'member' | 'admin' | 'supervisor'>(() =>
    user?.roles.includes('super_admin') ? 'admin' : user?.roles.includes('project_supervisor') ? 'supervisor' : 'member'
  );
  useRealtimeEvents(Boolean(user));

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ count: number }>('/collaboration/notifications/unread-count'),
    enabled: Boolean(user),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const unreadCount = unreadQuery.data?.count ?? 0;

  if (!user) return null;

  const links = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/tasks', label: mode === 'admin' ? 'Task register' : 'Discipline tasks', icon: CheckSquare2 },
    { to: '/planning', label: 'Planning & capacity', icon: CalendarDays },
  ];

  if (mode === 'admin') {
    links.push({ to: '/reviews', label: 'Review queue', icon: ClipboardCheck });
  }

  links.push(
    { to: '/members', label: mode === 'supervisor' ? 'Member progress' : 'Engineering roster', icon: mode === 'supervisor' ? Activity : Users },
    { to: '/chat', label: 'Team stream', icon: MessageSquare },
    { to: '/announcements', label: 'Bulletins', icon: Megaphone },
    { to: '/wiki', label: 'Documentation wiki', icon: BookOpen },
    { to: '/issues', label: 'Defects & Blockers', icon: AlertOctagon },
    { to: '/hardware', label: 'Hardware testbed', icon: Cpu },
    { to: '/experiments', label: 'Empirical runs', icon: FlaskConical },
    { to: '/decisions', label: 'Architecture ADRs', icon: Scale },
    { to: '/worklogs', label: 'Daily worklogs', icon: FileCheck },
    { to: '/integrations/github', label: 'GitHub CI', icon: GitBranch },
    { to: '/assistant', label: 'Sentinel AI', icon: Bot },
    { to: '/reports', label: 'PDF Reports', icon: FileText }
  );

  if (mode === 'admin') {
    links.push({ to: '/admin', label: 'Command center', icon: Server });
  }

  const switchMode = () => {
    const next = mode === 'admin' ? 'member' : 'admin';
    setMode(next);
    navigate('/');
    setOpen(false);
  };

  return (
    <div className="app-frame" data-mode={mode}>
      <a className="skip-link" href="#main-content">Skip to content</a>

      {/* Mobile Header */}
      <header className="mobile-header">
        <CerberusLogo size="sm" />
        <div style={{ display: 'flex', gap: '6px' }}>
          <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} aria-label="Search the workspace">
            <Search size={18} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </header>

      {/* Sidebar Navigation */}
      <aside className={open ? 'sidebar is-open' : 'sidebar'}>
        <CerberusLogo size="md" />

        <div className="mode-chip">
          <ShieldCheck size={16} />
          <span>{mode === 'admin' ? 'Admin control' : mode === 'supervisor' ? 'Supervisor view' : 'My workspace'}</span>
        </div>

        <nav aria-label="Primary" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={`${mode}-${to}`} to={to} end={to === '/'} onClick={() => setOpen(false)}>
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        {user.roles.includes('super_admin') && (
          <Button variant="secondary" className="mode-switch" onClick={switchMode}>
            <Users size={16} />
            {mode === 'admin' ? 'Open my workspace' : 'Open admin control'}
          </Button>
        )}

        <CerberusSentinelStatus />

        <div style={{ marginTop: '10px' }}>
          <button type="button" className="utility-link utility-search" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          <NavLink className="utility-link" to="/notifications">
            <Bell size={16} />
            <span>Alerts</span>
            {unreadCount > 0 && (
              <span className="nav-badge" aria-label={`${unreadCount} unread notifications`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
          {mode === 'admin' && (
            <NavLink className="utility-link" to="/settings">
              <Settings size={16} />
              <span>Settings</span>
            </NavLink>
          )}
        </div>

        <button className="profile-block" onClick={() => void logout()} title="Sign out">
          <span className="avatar">
            {user.displayName.split(' ').map((part) => part[0]).slice(0, 2).join('')}
          </span>
          <span>
            <strong>{user.displayName}</strong>
            <small>{user.specialization ?? 'Workspace member'}</small>
          </span>
          <LogOut size={16} />
        </button>
      </aside>

      {/* Main Viewport */}
      <main id="main-content">
        <Outlet context={{ mode }} />
      </main>

      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}
