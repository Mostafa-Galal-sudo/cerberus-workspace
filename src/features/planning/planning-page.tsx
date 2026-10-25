import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  GanttChartSquare,
  Gauge,
  LayoutList,
} from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, apiWithMeta } from '../../lib/api';

interface PlanningTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  startDate: number | null;
  dueDate: number | null;
  estimateHours: number;
  assigneeId: string | null;
  assigneeName: string | null;
  domainName: string | null;
  loggedHours: number;
}

interface WorklogEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  workedOn: string;
  hours: number;
  note: string;
}

interface MyWeek {
  weekStart: string;
  weekEnd: string;
  member: { id: string; name: string; specialization: string | null };
  tasks: PlanningTask[];
  overdue: PlanningTask[];
  worklogs: WorklogEntry[];
  totals: {
    plannedTasks: number;
    overdueTasks: number;
    estimateHours: number;
    loggedHours: number;
    remainingHours: number;
  };
  readOnly: boolean;
}

interface WorkloadRow {
  id: string;
  name: string;
  specialization: string | null;
  activeTasks: number;
  estimateHours: number;
  dueInRange: number;
  overdueTasks: number;
  loggedHours: number;
}

interface MemberOption {
  id: string;
  name: string;
  specialization: string | null;
}

type TabKey = 'week' | 'calendar' | 'timeline' | 'workload';

const TABS: Array<{ key: TabKey; label: string; icon: typeof CalendarDays }> = [
  { key: 'week', label: 'My Week', icon: LayoutList },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'timeline', label: 'Timeline', icon: GanttChartSquare },
  { key: 'workload', label: 'Workload', icon: Gauge },
];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysKey(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function epochToKey(epoch: number | null): string | null {
  return epoch ? new Date(epoch * 1000).toISOString().slice(0, 10) : null;
}

function keyToEpoch(key: string): number {
  return Math.floor(Date.parse(`${key}T00:00:00Z`) / 1000);
}

function weekStartKey(key: string): string {
  const date = new Date(`${key}T00:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return date.toISOString().slice(0, 10);
}

function monthStartKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function shiftMonthKey(key: string, delta: number): string {
  const date = new Date(`${monthStartKey(key)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

function shiftMonthEnd(key: string, delta: number): string {
  const date = new Date(`${shiftMonthKey(key, delta)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function prettyDate(key: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${key}T00:00:00Z`));
}

function taskWindow(task: PlanningTask): { start: string; end: string } | null {
  const start = epochToKey(task.startDate) ?? epochToKey(task.dueDate);
  const end = epochToKey(task.dueDate) ?? epochToKey(task.startDate);
  if (!start || !end) return null;
  return { start, end };
}

function TaskLine({ task }: { task: PlanningTask }) {
  const window = taskWindow(task);
  return (
    <Link
      to={`/tasks/${task.id}`}
      style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', padding: '10px 12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit', textDecoration: 'none' }}
    >
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</strong>
        <small style={{ color: 'var(--color-muted)' }}>
          {task.assigneeName ?? 'Unassigned'}{task.domainName ? ` · ${task.domainName}` : ''}
          {window ? ` · ${prettyDate(window.start)} → ${prettyDate(window.end)}` : ''}
        </small>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <span className="mono-data" style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>{task.estimateHours} h</span>
        <StatusBadge status={task.status} />
      </div>
    </Link>
  );
}

function MyWeekPanel({ canPickMember }: { canPickMember: boolean }) {
  const [weekStart, setWeekStart] = useState(weekStartKey(todayKey()));
  const [memberId, setMemberId] = useState('');

  const membersQuery = useQuery({
    queryKey: ['members-short'],
    queryFn: () => api<MemberOption[]>('/users'),
    enabled: canPickMember,
  });

  const query = useQuery({
    queryKey: ['planning', 'my-week', weekStart, memberId],
    queryFn: () => api<MyWeek>(`/planning/my-week?weekStart=${weekStart}${memberId ? `&memberId=${encodeURIComponent(memberId)}` : ''}`),
  });

  if (query.isLoading) return <PageSkeleton />;
  if (!query.data) return <EmptyState title="Week unavailable" body="The weekly plan could not be loaded." />;
  const data = query.data;

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <Panel>
        <div className="panel-heading">
          <div>
            <h2>{data.member.name}&apos;s week</h2>
            <p>{prettyDate(data.weekStart)} → {prettyDate(data.weekEnd)} · UTC scheduling</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {canPickMember && (
              <select
                aria-label="View another member's week"
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                style={{ padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.82rem' }}
              >
                <option value="">My plan</option>
                {membersQuery.data?.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            )}
            <button type="button" className="button ghost" aria-label="Previous week" onClick={() => setWeekStart((value) => addDaysKey(value, -7))} style={{ padding: '8px' }}>
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="button ghost" aria-label="Next week" onClick={() => setWeekStart((value) => addDaysKey(value, 7))} style={{ padding: '8px' }}>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div style={{ padding: '0 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
          {[
            { label: 'Planned tasks', value: String(data.totals.plannedTasks) },
            { label: 'Overdue', value: String(data.totals.overdueTasks) },
            { label: 'Estimated hours', value: `${data.totals.estimateHours} h` },
            { label: 'Logged hours', value: `${data.totals.loggedHours} h` },
            { label: 'Remaining', value: `${data.totals.remainingHours} h` },
          ].map((stat) => (
            <div key={stat.label} style={{ padding: '12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
              <small style={{ display: 'block', color: 'var(--color-muted)', marginBottom: '4px' }}>{stat.label}</small>
              <strong style={{ fontSize: '1.05rem' }}>{stat.value}</strong>
            </div>
          ))}
        </div>
      </Panel>

      {data.overdue.length > 0 && (
        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Overdue work</h2>
              <p>Past-due tasks that still need a submission or a schedule change.</p>
            </div>
          </div>
          <div style={{ padding: '0 20px 20px', display: 'grid', gap: '8px' }}>
            {data.overdue.map((task) => <TaskLine key={task.id} task={task} />)}
          </div>
        </Panel>
      )}

      <Panel>
        <div className="panel-heading">
          <div>
            <h2>Scheduled this week</h2>
            <p>Tasks starting or due inside the selected week, plus undated work in progress.</p>
          </div>
        </div>
        <div style={{ padding: '0 20px 20px', display: 'grid', gap: '8px' }}>
          {data.tasks.length ? data.tasks.map((task) => <TaskLine key={task.id} task={task} />) : (
            <EmptyState title="Nothing scheduled" body="Set start and due dates on assigned tasks to populate the week." />
          )}
        </div>
      </Panel>

      <Panel>
        <div className="panel-heading">
          <div>
            <h2>Logged effort</h2>
            <p>Hours recorded against tasks during this week.</p>
          </div>
          <Clock size={18} style={{ color: 'var(--color-silver-mid)' }} />
        </div>
        <div style={{ padding: '0 20px 20px', display: 'grid', gap: '8px' }}>
          {data.worklogs.length ? data.worklogs.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
              <div>
                <strong style={{ fontSize: '0.82rem' }}>{entry.workedOn}</strong>
                <Link to={`/tasks/${entry.taskId}`} style={{ marginLeft: '10px', fontSize: '0.8rem' }}>{entry.taskTitle}</Link>
                {entry.note && <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--color-muted)' }}>{entry.note}</p>}
              </div>
              <span className="mono-data" style={{ fontSize: '0.78rem' }}>{entry.hours} h</span>
            </div>
          )) : <EmptyState title="No hours logged" body="Log effort from a task detail page to build the weekly ledger." />}
        </div>
      </Panel>
    </div>
  );
}

function CalendarPanel() {
  const [month, setMonth] = useState(monthStartKey(todayKey()));
  const from = month;
  const to = shiftMonthEnd(month, 0);

  const query = useQuery({
    queryKey: ['planning', 'calendar', from, to],
    queryFn: () => apiWithMeta<PlanningTask[]>(`/planning/calendar?from=${from}&to=${to}&limit=200`),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, PlanningTask[]>();
    for (const task of query.data?.data ?? []) {
      const key = epochToKey(task.dueDate) ?? epochToKey(task.startDate);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }
    return map;
  }, [query.data]);

  const daysInMonth = Number(to.slice(8, 10));
  const firstWeekday = new Date(`${from}T00:00:00Z`).getUTCDay();
  const leading = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const cells = [...Array<null>(leading).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => addDaysKey(from, index))];

  return (
    <Panel>
      <div className="panel-heading">
        <div>
          <h2>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${from}T00:00:00Z`))}</h2>
          <p>Due dates are shown on the calendar; start dates appear when a task has no due date.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="button ghost" aria-label="Previous month" onClick={() => setMonth((value) => shiftMonthKey(value, -1))} style={{ padding: '8px' }}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="button ghost" aria-label="Next month" onClick={() => setMonth((value) => shiftMonthKey(value, 1))} style={{ padding: '8px' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        {query.isLoading ? <PageSkeleton /> : (
          <div role="grid" aria-label="Task calendar" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '6px' }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <div key={day} role="columnheader" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', padding: '4px' }}>{day}</div>
            ))}
            {cells.map((key, index) => (
              <div
                key={key ?? `blank-${index}`}
                role="gridcell"
                aria-label={key ? prettyDate(key) : undefined}
                style={{ minHeight: '86px', padding: '6px', background: key === todayKey() ? 'var(--color-surface-elevated)' : 'var(--color-surface-subtle)', border: key === todayKey() ? '1px solid var(--color-border-chiseled)' : '1px solid var(--color-border)', borderRadius: '4px' }}
              >
                {key && <span className="mono-data" style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>{key.slice(8, 10)}</span>}
                {key && (byDay.get(key) ?? []).slice(0, 3).map((task) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} title={task.title} style={{ display: 'block', marginTop: '4px', fontSize: '0.68rem', color: 'var(--color-silver-light)', textDecoration: 'none', background: 'var(--color-surface)', borderRadius: '3px', padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </Link>
                ))}
                {key && (byDay.get(key)?.length ?? 0) > 3 && (
                  <small style={{ display: 'block', marginTop: '4px', color: 'var(--color-muted)', fontSize: '0.66rem' }}>+{(byDay.get(key)?.length ?? 0) - 3} more</small>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function TimelinePanel() {
  const from = addDaysKey(todayKey(), -14);
  const to = addDaysKey(todayKey(), 76);
  const query = useQuery({
    queryKey: ['planning', 'timeline', from, to],
    queryFn: () => apiWithMeta<PlanningTask[], { total: number; edges: Array<{ taskId: string; dependsOnTaskId: string }> }>(
      `/planning/timeline?from=${from}&to=${to}&limit=150`,
    ),
  });

  if (query.isLoading) return <PageSkeleton />;
  const tasks = query.data?.data ?? [];
  const edges = query.data?.meta.edges ?? [];
  const startEpoch = keyToEpoch(from);
  const span = keyToEpoch(to) - startEpoch + 86_400;
  const titleById = new Map(tasks.map((task) => [task.id, task.title]));

  return (
    <Panel>
      <div className="panel-heading">
        <div>
          <h2>Dependency timeline</h2>
          <p>14 days back to 76 days ahead. Bars reflect start → due dates; arrows list dependency edges.</p>
        </div>
      </div>
      <div style={{ padding: '0 20px 20px', display: 'grid', gap: '10px' }}>
        {tasks.length === 0 ? (
          <EmptyState title="No dated tasks" body="Schedule start and due dates to build the Gantt view." />
        ) : tasks.map((task) => {
          const window = taskWindow(task);
          if (!window) return null;
          const start = Math.max(keyToEpoch(window.start), startEpoch);
          const end = Math.min(keyToEpoch(window.end) + 86_400, startEpoch + span);
          const left = ((start - startEpoch) / span) * 100;
          const width = Math.max(1.5, ((end - start) / span) * 100);
          return (
            <div key={task.id} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '12px', alignItems: 'center' }}>
              <Link to={`/tasks/${task.id}`} style={{ fontSize: '0.8rem', color: 'var(--color-silver-light)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={task.title}>
                {task.title}
              </Link>
              <div style={{ position: 'relative', height: '22px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '3px' }}>
                <div
                  title={`${prettyDate(window.start)} → ${prettyDate(window.end)}`}
                  style={{
                    position: 'absolute', left: `${left}%`, width: `${width}%`, top: '3px', bottom: '3px', borderRadius: '2px',
                    background: task.status === 'approved' ? 'var(--color-status-verified)' : task.status === 'blocked' ? 'var(--color-status-blocked)' : 'var(--color-status-progress)',
                    opacity: 0.85,
                  }}
                />
              </div>
            </div>
          );
        })}

        {edges.length > 0 && (
          <div style={{ marginTop: '10px', borderTop: '1px solid var(--color-border)', paddingTop: '10px' }}>
            <h3 style={{ fontSize: '0.9rem', margin: '0 0 6px' }}>Dependency edges</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {edges.slice(0, 40).map((edge) => (
                <span key={`${edge.taskId}-${edge.dependsOnTaskId}`} className="badge" style={{ fontSize: '0.66rem' }}>
                  {titleById.get(edge.dependsOnTaskId) ?? edge.dependsOnTaskId} → {titleById.get(edge.taskId) ?? edge.taskId}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function WorkloadPanel() {
  const [from, setFrom] = useState(addDaysKey(weekStartKey(todayKey()), 0));
  const [to, setTo] = useState(addDaysKey(weekStartKey(todayKey()), 27));
  const query = useQuery({
    queryKey: ['planning', 'workload', from, to],
    queryFn: () => api<WorkloadRow[]>(`/planning/workload?from=${from}&to=${to}`),
  });

  const maxHours = Math.max(1, ...(query.data ?? []).map((row) => Math.max(row.estimateHours, row.loggedHours)));

  return (
    <Panel>
      <div className="panel-heading">
        <div>
          <h2>Capacity &amp; workload</h2>
          <p>Committed estimates across active tasks compared with hours logged in the window.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <label htmlFor="workload-from" style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>From</label>
          <input id="workload-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ padding: '6px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.78rem' }} />
          <label htmlFor="workload-to" style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>To</label>
          <input id="workload-to" type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} style={{ padding: '6px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.78rem' }} />
        </div>
      </div>
      <div style={{ padding: '0 20px 20px', display: 'grid', gap: '10px' }}>
        {query.isLoading ? <PageSkeleton /> : query.data?.length ? query.data.map((row) => (
          <div key={row.id} style={{ padding: '10px 12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <strong style={{ fontSize: '0.86rem' }}>{row.name}{row.specialization ? ` · ${row.specialization}` : ''}</strong>
              <small style={{ color: 'var(--color-muted)' }}>
                {row.activeTasks} active · {row.dueInRange} due in range · {row.overdueTasks} overdue · {row.estimateHours} h estimated · {row.loggedHours} h logged
              </small>
            </div>
            <div style={{ display: 'grid', gap: '3px' }} aria-hidden="true">
              <div style={{ height: '6px', background: 'var(--color-surface)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (row.estimateHours / maxHours) * 100)}%`, height: '100%', background: 'var(--color-status-progress)' }} />
              </div>
              <div style={{ height: '6px', background: 'var(--color-surface)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (row.loggedHours / maxHours) * 100)}%`, height: '100%', background: 'var(--color-status-verified)' }} />
              </div>
            </div>
          </div>
        )) : <EmptyState title="No workload data" body="Assign tasks and estimates to populate capacity planning." />}
      </div>
    </Panel>
  );
}

export function PlanningPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>('week');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const canPickMember = Boolean(user?.roles.includes('super_admin') || user?.roles.includes('project_supervisor') || user?.permissions.includes('task.manage'));

  // WAI-ARIA tabs keyboard model: arrows move selection and focus, Home/End jump.
  const selectTabAt = (index: number) => {
    const next = TABS[index];
    if (!next) return;
    setTab(next.key);
    tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((item) => item.key === tab);
    if (index < 0) return;
    let target: number;
    if (event.key === 'ArrowRight') target = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') target = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = TABS.length - 1;
    else return;
    event.preventDefault();
    selectTabAt(target);
  };

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <header>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.5rem' }}>Planning &amp; capacity</h1>
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>Weekly execution plan, calendar, dependency timeline and workload in one surface.</p>
      </header>

      <div
        role="tablist"
        aria-label="Planning views"
        onKeyDown={handleTabKeyDown}
        style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}
      >
        {TABS.map((item, index) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`planning-panel-${item.key}`}
              id={`planning-tab-${item.key}`}
              tabIndex={active ? 0 : -1}
              className={active ? 'button secondary' : 'button ghost'}
              onClick={() => setTab(item.key)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', fontSize: '0.82rem' }}
            >
              <Icon size={15} /> {item.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`planning-panel-${tab}`} aria-labelledby={`planning-tab-${tab}`}>
        {tab === 'week' && <MyWeekPanel canPickMember={canPickMember} />}
        {tab === 'calendar' && <CalendarPanel />}
        {tab === 'timeline' && <TimelinePanel />}
        {tab === 'workload' && <WorkloadPanel />}
      </div>
    </div>
  );
}
