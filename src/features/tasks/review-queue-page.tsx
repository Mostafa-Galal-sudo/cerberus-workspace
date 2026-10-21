import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquareWarning, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

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
  evidence: SubmissionEvidence[];
}

export function ReviewQueuePage() {
  const query = useQuery({ queryKey: ['reviews'], queryFn: () => api<ReviewItem[]>('/reviews') });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Administrative Sentinel Control</span>
          <h1>Review queue</h1>
          <p>
            Task and checkpoint submissions arrive here with their evidence. Decisions are permanently attributed events recorded in the audit trail. Submitters cannot administratively approve their own submissions.
          </p>
        </div>

        <div className="queue-count">
          <strong>{query.data?.length ?? 0}</strong>
          <span>submissions awaiting crucible review</span>
        </div>
      </header>

      {query.isLoading ? (
        <PageSkeleton />
      ) : query.data?.length ? (
        <div className="review-list">
          {query.data.map((item) => (
            <ReviewCard item={item} key={item.id} />
          ))}
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

function ReviewCard({ item }: { item: ReviewItem }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const isOwnSubmission = user?.id === item.submittedById;
  const isCheckpoint = item.targetType === 'checkpoint';

  const decision = useMutation({
    mutationFn: (result: 'approved' | 'changes_requested') =>
      api(`/reviews/${item.id}`, { method: 'POST', body: JSON.stringify({ result, feedback }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['reviews'] }),
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

      {isOwnSubmission ? (
        <p style={{ margin: '0 0 12px', color: 'var(--color-status-blocked)', fontSize: '0.8rem' }}>
          This is your own submission. An independent administrator must record the decision.
        </p>
      ) : null}

      <label className="field">
        <span>Administrative evaluation feedback</span>
        <textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          rows={3}
          placeholder="Record verified criteria, test reproduction notes, or specific change requirements…"
        />
      </label>

      {error && <p className="form-error" style={{ marginTop: '12px' }}>{error}</p>}

      <div className="review-actions">
        <Button
          variant="secondary"
          disabled={feedback.length < 10 || decision.isPending || isOwnSubmission}
          onClick={() => decision.mutate('changes_requested')}
          style={{ borderColor: 'var(--color-magma-border)', color: 'var(--color-magma-flame)' }}
        >
          <MessageSquareWarning size={16} />
          Request changes
        </Button>

        <Button
          disabled={decision.isPending || isOwnSubmission}
          onClick={() => decision.mutate('approved')}
        >
          <Check size={16} />
          Approve evidence
        </Button>
      </div>
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
