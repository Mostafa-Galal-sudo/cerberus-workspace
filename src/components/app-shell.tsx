import {
  Activity,
  AlertOctagon,
  Bell,
  BookOpen,
  Bot,
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
  Server,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth-context';
import { Button } from './ui';
import { CerberusLogo, CerberusSentinelStatus } from './cerberus-logo';

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'member' | 'admin' | 'supervisor'>(() =>
    user?.roles.includes('super_admin') ? 'admin' : user?.roles.includes('project_supervisor') ? 'supervisor' : 'member'
  );

  if (!user) return null;

  const links = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/tasks', label: mode === 'admin' ? 'Task register' : 'Discipline tasks', icon: CheckSquare2 },
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
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
          {open ? <X /> : <Menu />}
        </Button>
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
          <NavLink className="utility-link" to="/notifications">
            <Bell size={16} />
            <span>Alerts</span>
          </NavLink>
          <NavLink className="utility-link" to="/settings">
            <Settings size={16} />
            <span>Settings</span>
          </NavLink>
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
    </div>
  );
}
