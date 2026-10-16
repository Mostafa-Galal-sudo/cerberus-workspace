import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock3, ListChecks, ShieldCheck } from 'lucide-react';
import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, formatDate } from '../../lib/api';

interface Count { status: string; count: number }
interface Member { id: string; name: string; specialization: string; total: number; approved: number; inProgress: number; pendingReview: number; blocked: number }
interface Summary {
  mode: string;
  taskCounts: Count[];
  members?: Member[];
  pendingReviews?: number;
  blockers?: Array<{ id: string; title: string; severity: string }>;
  activity?: Array<{ action: string; actorName: string; createdAt: number }>;
  currentTasks?: Array<{ id: string; title: string; status: string; priority: string }>;
  submissions?: Array<{ id: string; taskTitle: string; status: string; submittedAt: number }>;
  notifications?: Array<{ id: string; title: string; body: string }>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const { mode } = useOutletContext<{ mode: string }>();
  const query = useQuery({ queryKey: ['dashboard', mode], queryFn: () => api<Summary>(`/dashboard/summary?mode=${mode}`) });

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !query.data) return <EmptyState title="Dashboard unavailable" body="The workspace could not load current progress. Refresh to try again." />;

  return (
    <div className="page dashboard-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">
            {mode === 'admin' ? 'Sentinel Admin Control' : mode === 'supervisor' ? 'Academic Supervisor View' : 'Member Workspace'}
          </span>
          <h1>{greeting()}, {user?.displayName.split(' ')[0]}</h1>
          <p>
            {mode === 'admin'
              ? 'Review evidence, unblock engineering work, and protect the immutable approval record.'
              : mode === 'supervisor'
              ? 'Inspect verified discipline progress without modifying administrative records.'
              : 'Your assigned engineering roadmaps, checklist gates, and review status.'}
          </p>
        </div>

        <div className="freshness">
          <span />
          <small>SENTINEL RECORD</small>
          <strong>Verified & Active</strong>
        </div>
      </header>

      {query.data.mode === 'member' ? (
        <MemberDashboard data={query.data} />
      ) : (
        <LeadershipDashboard data={query.data} supervisor={query.data.mode === 'supervisor'} />
      )}
    </div>
  );
}

function LeadershipDashboard({ data, supervisor }: { data: Summary; supervisor: boolean }) {
  const total = countTotal(data.taskCounts);
  const approved = count(data.taskCounts, 'approved');
  const active = count(data.taskCounts, 'in_progress');

  return (
    <>
      <section className="metric-ledger" aria-label="Project metrics">
        <Metric icon={<ListChecks />} label="Assigned work" value={total} detail="All active tasks" />
        <Metric
          icon={<CheckCircle2 />}
          label="Approved"
          value={approved}
          detail={total ? `${Math.round((approved / total) * 100)}% verified complete` : 'No tasks assigned'}
        />
        <Metric icon={<Clock3 />} label="In progress" value={active} detail="Work underway" />
        <Metric
          icon={<ShieldCheck />}
          label="Review queue"
          value={data.pendingReviews ?? 0}
          detail={supervisor ? 'Visible, admin-owned' : 'Awaiting admin decision'}
        />
      </section>

      <div className="dashboard-grid">
        <Panel className="span-2">
          <div className="panel-heading">
            <div>
              <h2>Discipline progress</h2>
              <p>Evidence-backed approval is the only completed state.</p>
            </div>
          </div>
          <div className="member-ledger">
            {data.members?.map((member) => {
              const percent = member.total ? Math.round((member.approved / member.total) * 100) : 0;
              return (
                <Link to={`/members?selected=${member.id}`} className="member-row" key={member.id}>
                  <span className="avatar small">{member.name.slice(0, 2).toUpperCase()}</span>
                  <span className="member-name">
                    <strong>{member.name}</strong>
                    <small>{member.specialization}</small>
                  </span>
                  <span className="progress-track">
                    <i style={{ width: `${percent}%` }} />
                  </span>
                  <strong className="percent">{member.total ? `${percent}%` : '—'}</strong>
                  <span className="row-meta">
                    {member.pendingReview} review · {member.blocked} blocked
                  </span>
                  <ArrowUpRight size={16} />
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Active blockers</h2>
              <p>Ordered by engineering severity.</p>
            </div>
            <AlertTriangle size={18} style={{ color: 'var(--color-status-blocked)' }} />
          </div>
          {data.blockers?.length ? (
            <div className="compact-list">
              {data.blockers.map((blocker) => (
                <div key={blocker.id}>
                  <StatusBadge status={blocker.severity} />
                  <strong>{blocker.title}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No open blockers" body="Reported blockers will surface here for escalation." />
          )}
        </Panel>

        <Panel className="span-3">
          <div className="panel-heading">
            <div>
              <h2>Administrative sentinel record</h2>
              <p>Recent security, submission, and validation events.</p>
            </div>
          </div>
          {data.activity?.length ? (
            <div className="activity-strip">
              {data.activity.map((item, index) => (
                <div key={`${item.createdAt}-${index}`}>
                  <span className="event-dot" />
                  <strong>{item.action.replaceAll('.', ' ')}</strong>
                  <small>{item.actorName ?? 'System'} · {formatDate(item.createdAt)}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No activity recorded" body="Audit events will appear after the first account activation." />
          )}
        </Panel>
      </div>
    </>
  );
}

function MemberDashboard({ data }: { data: Summary }) {
  return (
    <>
      <section className="metric-ledger">
        <Metric icon={<ListChecks />} label="Assigned" value={countTotal(data.taskCounts)} detail="Active roadmap" />
        <Metric icon={<Clock3 />} label="In progress" value={count(data.taskCounts, 'in_progress')} detail="Current work" />
        <Metric icon={<ShieldCheck />} label="Pending review" value={count(data.taskCounts, 'ready_for_review')} detail="Admin decision needed" />
        <Metric icon={<CheckCircle2 />} label="Approved" value={count(data.taskCounts, 'approved')} detail="Official completion" />
      </section>

      <div className="dashboard-grid">
        <Panel className="span-2">
          <div className="panel-heading">
            <div>
              <h2>Current assignments</h2>
              <p>Priority roadmap items awaiting completion or review.</p>
            </div>
            <Link to="/tasks">View all</Link>
          </div>
          {data.currentTasks?.length ? (
            <div className="task-rows">
              {data.currentTasks.map((task) => (
                <Link to={`/tasks/${task.id}`} key={task.id}>
                  <StatusBadge status={task.status} />
                  <strong>{task.title}</strong>
                  <span>{task.priority}</span>
                  <ArrowUpRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No active assignments" body="New work assigned by an administrator will appear here." />
          )}
        </Panel>

        <Panel>
          <div className="panel-heading">
            <div>
              <h2>Review history</h2>
              <p>Your recent evidence submissions.</p>
            </div>
          </div>
          {data.submissions?.length ? (
            <div className="compact-list">
              {data.submissions.map((submission) => (
                <div key={submission.id}>
                  <StatusBadge status={submission.status} />
                  <strong>{submission.taskTitle}</strong>
                  <small>{formatDate(submission.submittedAt)}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing submitted yet" body="Complete required checklist items, then attach evidence for review." />
          )}
        </Panel>
      </div>
    </>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: number; detail: string }) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </div>
  );
}

function count(counts: Count[], status: string) {
  return Number(counts.find((item) => item.status === status)?.count ?? 0);
}

function countTotal(counts: Count[]) {
  return counts.reduce((sum, item) => sum + Number(item.count), 0);
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
