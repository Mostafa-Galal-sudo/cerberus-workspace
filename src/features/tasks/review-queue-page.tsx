import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ClipboardList, MessageSquareWarning, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, apiWithMeta, ApiError, formatDate, type PageMeta } from '../../lib/api';

interface SubmissionEvidence {
  id: string;
  kind: string;
  label: string;
  value: string;
}

interface ReviewItem {
  id: string;
  targetType: 'task' | 'checkpoint';
  taskId: string | null;
  taskTitle: string | null;
  checkpointId: string | null;
  checkpointTitle: string | null;
  summary: string;
  version: number;
  submittedAt: number;
  submittedById: string;
  submittedByName: string;
  assignedReviewerId: string | null;
  assignedReviewerName: string | null;
  assignedAt: number | null;
  rubricId: string | null;
  rubricName: string | null;
  evidence: SubmissionEvidence[];
}

interface RubricCriterion {
  id: string;
  label: string;
  weight: number;
  sortOrder: number;
}

interface Rubric {
  id: string;
  name: string;
  description: string;
  active: number;
  criteria: RubricCriterion[];
}

interface QueueMeta extends PageMeta {
  status: string;
  rubrics: Rubric[];
}

interface ReviewerOption {
  id: string;
  name: string;
  specialization: string | null;
  pendingAssignments: number;
}

export function ReviewQueuePage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['reviews', page],
    queryFn: () => apiWithMeta<ReviewItem[], QueueMeta>(`/reviews?page=${page}&limit=25`),
  });

  const items = query.data?.data ?? [];
  const meta = query.data?.meta;
  const total = meta?.total ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Administrative Sentinel Control</span>
          <h1>Review queue</h1>
          <p>
            Task and checkpoint submissions arrive here with their evidence. Assign a reviewer and rubric, then record a scored decision. Decisions are permanent, attributed audit events. Submitters cannot administratively approve their own submissions.
          </p>
        </div>

        <div className="queue-count">
          <strong>{total}</strong>
          <span>submissions awaiting crucible review</span>
        </div>
      </header>

      {query.isLoading ? (
        <PageSkeleton />
      ) : items.length ? (
        <div className="review-list">
          {items.map((item) => (
            <ReviewCard item={item} rubrics={meta?.rubrics ?? []} key={item.id} />
          ))}
          {total > 25 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                <ChevronLeft size={14} /> Previous
              </Button>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>Page {page} of {Math.max(1, Math.ceil(total / 25))}</span>
              <Button variant="ghost" size="sm" disabled={page >= Math.ceil(total / 25)} onClick={() => setPage((value) => value + 1)}>
                Next <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          title="Review queue is clear"
          body="All submitted engineering evidence has been evaluated. New task and checkpoint submissions will appear here automatically."
        />
      )}
    </div>
  );
}

function ReviewCard({ item, rubrics }: { item: ReviewItem; rubrics: Rubric[] }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [reviewerId, setReviewerId] = useState(item.assignedReviewerId ?? '');
  const [assignRubricId, setAssignRubricId] = useState(item.rubricId ?? '');
  const [rubricId, setRubricId] = useState(item.rubricId ?? '');
  const [scores, setScores] = useState<Record<string, string>>({});

  const isOwnSubmission = user?.id === item.submittedById;
  const isCheckpoint = item.targetType === 'checkpoint';
  const selectedRubric = rubrics.find((rubric) => rubric.id === rubricId) ?? null;
  const isAssignedElsewhere = Boolean(item.assignedReviewerId && user?.id !== item.assignedReviewerId && !user?.roles.includes('super_admin'));
  const allCriteriaScored = !selectedRubric || selectedRubric.criteria.every((criterion) => {
    const value = scores[criterion.id];
    return value !== undefined && value !== '';
  });
  const weightedTotal = selectedRubric
    ? Math.round(selectedRubric.criteria.reduce((sum, criterion) => sum + (Number(scores[criterion.id] || 0) * criterion.weight) / 100, 0) * 100) / 100
    : null;

  const reviewersQuery = useQuery({
    queryKey: ['reviewers'],
    queryFn: () => api<ReviewerOption[]>('/reviews/reviewers'),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['reviews'] });
    void client.invalidateQueries({ queryKey: ['reviewers'] });
  };

  const assign = useMutation({
    mutationFn: () => api(`/reviews/${item.id}/assignment`, {
      method: 'POST',
      body: JSON.stringify({ reviewerId, rubricId: assignRubricId || null }),
    }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Assignment failed'),
  });

  const clearAssignment = useMutation({
    mutationFn: () => api(`/reviews/${item.id}/assignment`, { method: 'DELETE' }),
    onSuccess: () => { setReviewerId(''); setAssignRubricId(''); setError(''); refresh(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Assignment could not be cleared'),
  });

  const decision = useMutation({
    mutationFn: (result: 'approved' | 'changes_requested') =>
      api(`/reviews/${item.id}`, {
        method: 'POST',
        body: JSON.stringify({
          result,
          feedback,
          rubricId: rubricId || null,
          scores: selectedRubric
            ? selectedRubric.criteria.map((criterion) => ({ criterionId: criterion.id, points: Number(scores[criterion.id]) }))
            : [],
        }),
      }),
    onSuccess: () => { setError(''); refresh(); },
    onError: (cause) => setError(cause instanceof ApiError ? cause.message : 'Review failed'),
  });

  return (
    <Panel className="review-card" style={{ borderLeft: '3px solid var(--color-cyan-sentinel)' }}>
      <div className="review-card-head">
        <span className="avatar small">{item.submittedByName.slice(0, 2).toUpperCase()}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {isCheckpoint ? (
              <span>{item.checkpointTitle ?? 'Checkpoint submission'}</span>
            ) : (
              <Link to={`/tasks/${item.taskId}`}>{item.taskTitle}</Link>
            )}
            <span
              style={{
                fontSize: '0.62rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '2px 6px',
                border: '1px solid var(--color-border-armor)',
                borderRadius: '3px',
                color: isCheckpoint ? 'var(--color-status-pending)' : 'var(--color-cyan-sentinel)',
              }}
            >
              {isCheckpoint ? 'Checkpoint' : 'Task'}
            </span>
          </div>
          <p>
            {item.submittedByName} · <span className="mono-data">version {item.version}</span> · {formatDate(item.submittedAt)}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-cyan-sentinel)', fontSize: '0.7rem', fontFamily: 'JetBrains Mono, monospace' }}>
          <ShieldCheck size={16} />
          <span>EVIDENCE ATTACHED</span>
        </div>
      </div>

      <blockquote>{item.summary}</blockquote>

      {item.evidence.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: '10px 12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-subtle)', borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {item.evidence.map((evidence) => (
            <EvidenceRow evidence={evidence} key={evidence.id} />
          ))}
        </ul>
      )}

      <div style={{ padding: '12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', display: 'grid', gap: '10px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
          <UserCheck size={14} />
          {item.assignedReviewerName
            ? `Assigned to ${item.assignedReviewerName}${item.rubricName ? ` · rubric: ${item.rubricName}` : ''}`
            : 'No reviewer assigned yet'}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: '4px', fontSize: '0.75rem', color: 'var(--color-silver-mid)' }}>
            Reviewer
            <select
              value={reviewerId}
              onChange={(event) => setReviewerId(event.target.value)}
              style={{ padding: '7px', background: 'var(--color-surface)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem' }}
            >
              <option value="">Select a reviewer</option>
              {reviewersQuery.data?.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}{reviewer.pendingAssignments ? ` (${reviewer.pendingAssignments} pending)` : ''}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '4px', fontSize: '0.75rem', color: 'var(--color-silver-mid)' }}>
            Rubric
            <select
              value={assignRubricId}
              onChange={(event) => setAssignRubricId(event.target.value)}
              style={{ padding: '7px', background: 'var(--color-surface)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem' }}
            >
              <option value="">No rubric (unscored decision)</option>
              {rubrics.map((rubric) => (
                <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
              ))}
            </select>
          </label>

          <div style={{ display: 'flex', gap: '6px' }}>
            <Button size="sm" disabled={!reviewerId || assign.isPending} onClick={() => assign.mutate()}>
              <ClipboardList size={14} /> {item.assignedReviewerId ? 'Reassign' : 'Assign'}
            </Button>
            {item.assignedReviewerId && (
              <Button variant="ghost" size="sm" disabled={clearAssignment.isPending} onClick={() => clearAssignment.mutate()}>
                <X size={14} /> Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {isOwnSubmission && (
        <p style={{ margin: '0 0 12px', color: 'var(--color-status-blocked)', fontSize: '0.8rem' }}>
          This is your own submission. An independent administrator must record the decision.
        </p>
      )}
      {!isOwnSubmission && isAssignedElsewhere && (
        <p style={{ margin: '0 0 12px', color: 'var(--color-status-blocked)', fontSize: '0.8rem' }}>
          This submission is assigned to another reviewer. Only they or a super administrator may decide.
        </p>
      )}

      <label style={{ display: 'grid', gap: '4px', fontSize: '0.75rem', color: 'var(--color-silver-mid)', marginBottom: '10px' }}>
        Rubric for this decision
        <select
          value={rubricId}
          onChange={(event) => setRubricId(event.target.value)}
          style={{ padding: '7px', background: 'var(--color-surface)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem', maxWidth: '320px' }}
        >
          <option value="">Unscored decision</option>
          {rubrics.map((rubric) => (
            <option key={rubric.id} value={rubric.id}>{rubric.name}</option>
          ))}
        </select>
      </label>

      {selectedRubric && (
        <div style={{ marginBottom: '14px', border: '1px solid var(--color-border)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ padding: '8px 10px', background: 'var(--color-surface-subtle)', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
            {selectedRubric.description || 'Score each weighted criterion from 0 to 100.'}
          </div>
          {selectedRubric.criteria.map((criterion) => (
            <div key={criterion.id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 60px', gap: '8px', alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--color-border)' }}>
              <label htmlFor={`score-${item.id}-${criterion.id}`} style={{ fontSize: '0.8rem' }}>{criterion.label}</label>
              <input
                id={`score-${item.id}-${criterion.id}`}
                type="number"
                min="0"
                max="100"
                step="1"
                value={scores[criterion.id] ?? ''}
                onChange={(event) => setScores((current) => ({ ...current, [criterion.id]: event.target.value }))}
                aria-label={`Score for ${criterion.label}`}
                style={{ padding: '6px', background: 'var(--color-surface)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem' }}
              />
              <span className="mono-data" style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>w {criterion.weight}%</span>
            </div>
          ))}
          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
            <span>Weighted total</span>
            <strong>{weightedTotal ?? 0} / 100</strong>
          </div>
        </div>
      )}

      <label className="field">
        <span>Administrative evaluation feedback</span>
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          rows={3}
          placeholder="Record verified criteria, test reproduction notes, or specific change requirements…"
        />
      </label>

      {error && <p className="form-error" role="alert" style={{ marginTop: '12px' }}>{error}</p>}

      <div className="review-actions">
        <Button
          variant="secondary"
          disabled={feedback.length < 10 || decision.isPending || isOwnSubmission || isAssignedElsewhere || !allCriteriaScored}
          onClick={() => decision.mutate('changes_requested')}
          style={{ borderColor: 'var(--color-magma-border)', color: 'var(--color-magma-flame)' }}
        >
          <MessageSquareWarning size={16} />
          Request changes
        </Button>

        <Button
          disabled={decision.isPending || isOwnSubmission || isAssignedElsewhere || !allCriteriaScored}
          onClick={() => decision.mutate('approved')}
        >
          <Check size={16} />
          Approve evidence
        </Button>
      </div>
      {!allCriteriaScored && (
        <small style={{ display: 'block', marginTop: '8px', color: 'var(--color-status-progress)' }}>
          Score every criterion before recording a decision.
        </small>
      )}
    </Panel>
  );
}

function EvidenceRow({ evidence }: { evidence: SubmissionEvidence }) {
  const isExternalLink = (evidence.kind === 'url' || evidence.kind === 'github') && /^https?:\/\//i.test(evidence.value);
  return (
    <li style={{ display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '0.8rem', minWidth: 0 }}>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-cyan-sentinel)', flexShrink: 0 }}>
        {evidence.kind}
      </span>
      <strong style={{ color: 'var(--color-silver-mid)', fontWeight: 600, flexShrink: 0 }}>{evidence.label}</strong>
      {isExternalLink ? (
        <a href={evidence.value} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--color-cyan-sentinel)', overflowWrap: 'anywhere' }}>
          {evidence.value}
        </a>
      ) : (
        <span style={{ color: 'var(--color-pewter)', overflowWrap: 'anywhere' }}>{evidence.value}</span>
      )}
    </li>
  );
}
