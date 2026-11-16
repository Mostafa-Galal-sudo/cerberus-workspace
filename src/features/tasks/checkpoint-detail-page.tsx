import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  Layers,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, formatDate } from '../../lib/api';

interface CheckpointTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: number;
  mandatory: number;
  prerequisites: string;
  inputs: string;
  requiredTools: string;
  implementationSteps: string;
  expectedOutputs: string;
  deliverables: string;
  acceptanceCriteria: string;
  evidenceRequirements: string;
  validationProcedure: string;
  checklistTotal: number;
  checklistDone: number;
  loggedHours: number;
  worklogCount: number;
  lastWorklogAt: number | null;
  dependencies: Array<{
    id: string;
    title: string;
    status: string;
    assigneeId: string | null;
    assigneeName: string | null;
  }>;
}

interface SubmissionReview {
  result: string;
  feedback: string;
  createdAt: number;
  reviewerName: string | null;
}

interface SubmissionRow {
  id: string;
  summary: string;
  status: string;
  version: number;
  submittedAt: number;
  updatedAt: number;
  submittedByName: string;
  evidenceCount: number;
  reviews: SubmissionReview[];
}

interface CheckpointDetail {
  checkpoint: {
    id: string;
    milestoneId: string;
    ownerId: string | null;
    title: string;
    description: string;
    requiredDeliverable: string;
    acceptanceCriteria: string;
    evidenceRequirements: string;
    validationProcedure: string;
    status: string;
    approvedAt: number | null;
    updatedAt: number;
    milestoneTitle: string;
    domainName: string | null;
    ownerName: string | null;
    taskCount: number;
    approvedTaskCount: number;
    windowStart: string | null;
    windowDue: string | null;
  };
  tasks: CheckpointTask[];
  submissions: SubmissionRow[];
}

interface MemberStat {
  key: string;
  name: string;
  total: number;
  approved: number;
  submitted: number;
  inProgress: number;
  notStarted: number;
  attention: number;
  hours: number;
  lastActivity: number | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatIsoDate(value?: string | null): string {
  if (!value || !ISO_DATE.test(value)) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

function percent(approved: number, total: number): number {
  return total > 0 ? Math.round((approved / total) * 100) : 0;
}

function DetailBlock({ label, value }: { label: string; value?: string | null }) {
  const text = (value ?? '').trim();
  if (!text) return null;
  return (
    <div>
      <strong style={{ color: 'var(--color-silver-mid)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </strong>
      <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: 'var(--color-pewter)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text}</p>
    </div>
  );
}

function RequirementCard({ label, value }: { label: string; value?: string | null }) {
  const text = (value ?? '').trim();
  return (
    <div
      style={{
        flex: '1 1 220px',
        minWidth: '220px',
        background: 'var(--color-surface-subtle)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '4px',
        padding: '12px 14px',
      }}
    >
      <strong style={{ fontSize: '0.74rem', color: 'var(--color-cyan-sentinel)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </strong>
      <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--color-silver-light)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {text || 'Not specified.'}
      </p>
    </div>
  );
}

export function CheckpointDetailPage() {
  const { checkpointId } = useParams();
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['checkpoint-detail-page', checkpointId],
    queryFn: () => api<CheckpointDetail>(`/tasks/checkpoints/${checkpointId}`),
    enabled: Boolean(checkpointId),
  });

  const checkpoint = detailQuery.data?.checkpoint;

  const tasks = useMemo<CheckpointTask[]>(() => detailQuery.data?.tasks ?? [], [detailQuery.data]);

  const members = useMemo<MemberStat[]>(() => {
    const map = new Map<string, MemberStat>();
    for (const task of tasks) {
      const key = task.assigneeId ?? 'unassigned';
      const entry =
        map.get(key) ??
        {
          key,
          name: task.assigneeName ?? 'Unassigned',
          total: 0,
          approved: 0,
          submitted: 0,
          inProgress: 0,
          notStarted: 0,
          attention: 0,
          hours: 0,
          lastActivity: null as number | null,
        };
      entry.total += 1;
      if (task.status === 'approved') entry.approved += 1;
      else if (task.status === 'ready_for_review') entry.submitted += 1;
      else if (task.status === 'in_progress') entry.inProgress += 1;
      else if (task.status === 'backlog') entry.notStarted += 1;
      else entry.attention += 1;
      entry.hours += task.loggedHours ?? 0;
      const activity = Math.max(task.updatedAt ?? 0, task.lastWorklogAt ?? 0);
      if (activity > (entry.lastActivity ?? 0)) entry.lastActivity = activity;
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [tasks]);

  const visibleTasks = assigneeFilter
    ? tasks.filter((task) => (task.assigneeId ?? 'unassigned') === assigneeFilter)
    : tasks;

  const todayIso = new Date().toISOString().slice(0, 10);
  const progressPct = percent(checkpoint?.approvedTaskCount ?? 0, checkpoint?.taskCount ?? 0);
  const allApproved = (checkpoint?.taskCount ?? 0) > 0 && checkpoint?.approvedTaskCount === checkpoint?.taskCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Link
        to="/tasks?view=checkpoints"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: 'var(--color-pewter)',
          fontSize: '0.78rem',
          textDecoration: 'none',
        }}
      >
        <ArrowLeft size={14} /> Back to task register
      </Link>

      {detailQuery.isLoading ? (
        <PageSkeleton />
      ) : detailQuery.isError || !checkpoint ? (
        <EmptyState title="Checkpoint not found" body="This checkpoint may have been archived or the link is out of date." />
      ) : (
        <>
          {/* Header */}
          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-cyan-sentinel)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {checkpoint.domainName ?? 'Weekly checkpoint'} · {checkpoint.milestoneTitle}
                </span>
                <h2 style={{ margin: '4px 0 0', fontSize: '1.2rem', lineHeight: 1.3 }}>{checkpoint.title}</h2>
                <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--color-pewter)', lineHeight: 1.5 }}>{checkpoint.description}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <StatusBadge status={checkpoint.status} />
                {checkpoint.approvedAt ? (
                  <small style={{ color: 'var(--color-status-verified)', fontSize: '0.7rem' }}>
                    Approved {formatDate(checkpoint.approvedAt)}
                  </small>
                ) : null}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--color-pewter)' }}>
              <span>
                Owner: <strong style={{ color: 'var(--color-silver-light)' }}>{checkpoint.ownerName ?? 'Unassigned'}</strong>
              </span>
              <span>
                Window: <strong style={{ color: 'var(--color-silver-light)' }}>{formatIsoDate(checkpoint.windowStart)} → {formatIsoDate(checkpoint.windowDue)}</strong>
              </span>
              <span>
                Tasks: <strong style={{ color: 'var(--color-silver-light)' }}>{checkpoint.approvedTaskCount}/{checkpoint.taskCount} approved</strong>
              </span>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', fontSize: '0.74rem' }}>
                <span style={{ color: 'var(--color-silver-mid)' }}>Overall progress (approved tasks)</span>
                <span style={{ color: allApproved ? 'var(--color-status-verified)' : 'var(--color-silver-mid)', fontWeight: 600 }}>
                  {progressPct}%
                </span>
              </div>
              <div style={{ height: '6px', background: 'var(--color-surface-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progressPct}%`,
                    background: allApproved ? 'var(--color-status-verified)' : 'var(--color-cyan-sentinel)',
                    borderRadius: '3px',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          </Panel>

          {/* What is required */}
          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ClipboardList size={15} style={{ color: 'var(--color-cyan-sentinel)' }} /> What is required
            </h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <RequirementCard label="Required deliverable" value={checkpoint.requiredDeliverable} />
              <RequirementCard label="Acceptance criteria — when this counts as done" value={checkpoint.acceptanceCriteria} />
              <RequirementCard label="Validation procedure — how it will be reviewed" value={checkpoint.validationProcedure} />
            </div>
          </Panel>

          {/* Final deliverable */}
          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={15} style={{ color: 'var(--color-cyan-sentinel)' }} /> Final deliverable and how task outputs roll up
            </h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-silver-light)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {checkpoint.requiredDeliverable?.trim() || 'Not specified.'}
            </p>
            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-pewter)', lineHeight: 1.5 }}>
              Each task below carries its own expected output and deliverables (shown when you expand it). Those outputs are
              what build up the deliverable above, and the checkpoint cannot be submitted for review until every linked task
              is approved — the submission gate enforces that.
            </p>
          </Panel>

          {/* Member progress */}
          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={15} style={{ color: 'var(--color-cyan-sentinel)' }} /> Who is doing what
              </h3>
              {assigneeFilter && (
                <Button variant="ghost" size="sm" onClick={() => setAssigneeFilter(null)}>
                  Show all members
                </Button>
              )}
            </div>

            {members.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {members.map((member) => {
                  const pct = percent(member.approved, member.total);
                  const isActive = assigneeFilter === member.key;
                  return (
                    <div
                      key={member.key}
                      style={{
                        border: `1px solid ${isActive ? 'var(--color-cyan-sentinel)' : 'var(--color-border-subtle)'}`,
                        borderRadius: '4px',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        background: isActive ? 'var(--color-surface-subtle)' : 'transparent',
                      }}
                      onClick={() => {
                        setAssigneeFilter(isActive ? null : member.key);
                        setExpandedTaskId(null);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setAssigneeFilter(isActive ? null : member.key);
                        }
                      }}
                      aria-pressed={isActive}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.82rem', color: 'var(--color-silver-light)' }}>{member.name}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-pewter)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <span>{member.approved}/{member.total} approved</span>
                          {member.inProgress > 0 ? <span>· {member.inProgress} in progress</span> : null}
                          {member.submitted > 0 ? <span>· {member.submitted} awaiting review</span> : null}
                          {member.notStarted > 0 ? <span>· {member.notStarted} not started</span> : null}
                          {member.attention > 0 ? <span>· {member.attention} needs attention</span> : null}
                          {member.hours > 0 ? <span>· {member.hours}h logged</span> : null}
                        </span>
                      </div>
                      <div style={{ height: '5px', background: 'var(--color-surface-subtle)', borderRadius: '3px', overflow: 'hidden', marginTop: '7px' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: pct === 100 ? 'var(--color-status-verified)' : 'var(--color-cyan-sentinel)',
                            borderRadius: '3px',
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '0.7rem', color: 'var(--color-pewter)' }}>
                        <span>{pct}% complete</span>
                        <span>
                          {member.lastActivity ? `Last activity ${formatDate(member.lastActivity)}` : 'No activity recorded yet'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No linked tasks" body="This checkpoint has no tasks assigned yet." />
            )}
            <small style={{ fontSize: '0.68rem', color: 'var(--color-pewter)' }}>
              Hours logged are effort evidence only — a task counts as complete only when its status reaches approved.
            </small>
          </Panel>

          {/* Task table */}
          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={15} style={{ color: 'var(--color-cyan-sentinel)' }} /> Tasks
              {assigneeFilter ? (
                <span style={{ fontSize: '0.72rem', color: 'var(--color-pewter)', fontWeight: 400 }}>
                  — filtered to {members.find((member) => member.key === assigneeFilter)?.name ?? 'one member'}
                </span>
              ) : null}
            </h3>

            {visibleTasks.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-pewter)' }}>
                      <th style={{ padding: '6px 8px' }}>Task</th>
                      <th style={{ padding: '6px 8px' }}>Assignee</th>
                      <th style={{ padding: '6px 8px' }}>Status</th>
                      <th style={{ padding: '6px 8px' }}>Checklist</th>
                      <th style={{ padding: '6px 8px' }}>Hours</th>
                      <th style={{ padding: '6px 8px' }}>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task) => {
                      const overdue = task.dueDate !== null && task.status !== 'approved' && task.dueDate < todayIso;
                      const expanded = expandedTaskId === task.id;
                      return (
                        <Fragment key={task.id}>
                          <tr
                            style={{
                              borderTop: '1px solid var(--color-border-subtle)',
                              cursor: 'pointer',
                              background: expanded ? 'var(--color-surface-subtle)' : 'transparent',
                            }}
                            onClick={() => setExpandedTaskId(expanded ? null : task.id)}
                            title="Show full task details"
                          >
                            <td style={{ padding: '6px 8px' }}>
                              <Link to={`/tasks/${task.id}`} onClick={(event) => event.stopPropagation()} style={{ color: 'var(--color-silver-light)' }}>
                                {task.title}
                              </Link>
                              {task.mandatory ? null : <small style={{ color: 'var(--color-pewter)' }}> · optional</small>}
                            </td>
                            <td style={{ padding: '6px 8px', color: task.assigneeName ? 'var(--color-silver-mid)' : 'var(--color-status-blocked)' }}>
                              {task.assigneeName ?? 'Unassigned'}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <StatusBadge status={task.status} />
                            </td>
                            <td style={{ padding: '6px 8px', color: 'var(--color-pewter)' }}>
                              {task.checklistTotal > 0 ? `${task.checklistDone}/${task.checklistTotal}` : '—'}
                            </td>
                            <td style={{ padding: '6px 8px', color: 'var(--color-pewter)' }}>
                              {task.loggedHours > 0 ? `${task.loggedHours}h` : '—'}
                            </td>
                            <td style={{ padding: '6px 8px', color: overdue ? 'var(--color-status-blocked)' : 'var(--color-pewter)' }}>
                              {formatIsoDate(task.dueDate)}
                              {overdue ? ' · overdue' : ''}
                            </td>
                          </tr>
                          {expanded ? (
                            <tr style={{ background: 'var(--color-surface-subtle)' }}>
                              <td colSpan={6} style={{ padding: '12px 14px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--color-pewter)' }}>
                                    <span>Priority: <strong style={{ color: 'var(--color-silver-mid)' }}>{task.priority}</strong></span>
                                    <span>
                                      Start: <strong style={{ color: 'var(--color-silver-mid)' }}>{formatIsoDate(task.startDate)}</strong>
                                    </span>
                                    <span>
                                      Last update: <strong style={{ color: 'var(--color-silver-mid)' }}>{formatDate(task.updatedAt)}</strong>
                                    </span>
                                    {task.worklogCount > 0 ? (
                                      <span>
                                        <Clock size={11} style={{ verticalAlign: '-2px' }} /> {task.worklogCount} worklog
                                        {task.worklogCount === 1 ? '' : 's'}, last {task.lastWorklogAt ? formatDate(task.lastWorklogAt) : '—'}
                                      </span>
                                    ) : (
                                      <span>No worklogs yet</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
                                    <DetailBlock label="Description" value={task.description} />
                                    <DetailBlock label="Prerequisites" value={task.prerequisites} />
                                    <DetailBlock label="Expected output" value={task.expectedOutputs} />
                                    <DetailBlock label="Deliverables" value={task.deliverables} />
                                    <DetailBlock label="Acceptance criteria" value={task.acceptanceCriteria} />
                                    <DetailBlock label="Inputs" value={task.inputs} />
                                    <DetailBlock label="Required tools" value={task.requiredTools} />
                                    <DetailBlock label="Implementation steps" value={task.implementationSteps} />
                                  </div>

                                  {task.dependencies.length ? (
                                    <div>
                                      <strong style={{ color: 'var(--color-silver-mid)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                        Depends on (must be done first)
                                      </strong>
                                      <ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontSize: '0.76rem', color: 'var(--color-pewter)' }}>
                                        {task.dependencies.map((dependency) => (
                                          <li key={dependency.id} style={{ margin: '3px 0', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            <Link to={`/tasks/${dependency.id}`} style={{ color: 'var(--color-silver-light)' }}>
                                              {dependency.title}
                                            </Link>
                                            <StatusBadge status={dependency.status} />
                                            <span style={{ color: 'var(--color-pewter)' }}>{dependency.assigneeName ?? 'Unassigned'}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--color-pewter)' }}>No blocking dependencies.</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No tasks match" body={assigneeFilter ? 'This member has no tasks in this checkpoint.' : 'This checkpoint has no linked tasks.'} />
            )}
          </Panel>

          {/* Submissions and reviews */}
          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={15} style={{ color: 'var(--color-cyan-sentinel)' }} /> Submissions and review status
            </h3>
            {detailQuery.data?.submissions.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {detailQuery.data.submissions.map((submission) => (
                  <div
                    key={submission.id}
                    style={{
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '4px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.8rem', color: 'var(--color-silver-light)' }}>
                        v{submission.version} · {submission.submittedByName}
                      </strong>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <StatusBadge status={submission.status} />
                        <small style={{ color: 'var(--color-pewter)', fontSize: '0.7rem' }}>{formatDate(submission.submittedAt)}</small>
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-silver-mid)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {submission.summary}
                    </p>
                    <small style={{ fontSize: '0.7rem', color: 'var(--color-pewter)' }}>
                      {submission.evidenceCount} evidence item{submission.evidenceCount === 1 ? '' : 's'} attached (visible to the submitter and reviewers)
                    </small>
                    {submission.reviews.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '8px' }}>
                        {submission.reviews.map((review, index) => (
                          <div key={`${submission.id}-review-${index}`} style={{ fontSize: '0.75rem' }}>
                            <span style={{ color: review.result === 'approved' ? 'var(--color-status-verified)' : 'var(--color-status-blocked)', fontWeight: 600 }}>
                              {review.result === 'approved' ? 'Approved' : 'Changes requested'}
                            </span>
                            <span style={{ color: 'var(--color-pewter)' }}>
                              {' '}by {review.reviewerName ?? 'Reviewer'} · {formatDate(review.createdAt)}
                            </span>
                            {review.feedback ? (
                              <p style={{ margin: '3px 0 0', color: 'var(--color-pewter)', fontSize: '0.74rem', whiteSpace: 'pre-wrap' }}>{review.feedback}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : submission.status === 'pending' ? (
                      <small style={{ fontSize: '0.7rem', color: 'var(--color-pewter)' }}>Awaiting review.</small>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No submissions yet" body="The checkpoint owner submits here once every linked task is approved." />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
