import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, MessageSquareWarning, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface ReviewItem {
  id: string;
  taskId: string;
  taskTitle: string;
  summary: string;
  version: number;
  submittedAt: number;
  submittedByName: string;
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
            Decisions are permanently attributed events recorded in the audit trail. Submitters cannot administratively approve their own submissions.
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
          body="All submitted engineering evidence has been evaluated. New submissions will appear here automatically."
        />
      )}
    </div>
  );
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const client = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

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
          <Link to={`/tasks/${item.taskId}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <span>{item.taskTitle}</span>
          </Link>
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
          disabled={feedback.length < 10 || decision.isPending}
          onClick={() => decision.mutate('changes_requested')}
          style={{ borderColor: 'var(--color-magma-border)', color: 'var(--color-magma-flame)' }}
        >
          <MessageSquareWarning size={16} />
          Request changes
        </Button>

        <Button
          disabled={decision.isPending}
          onClick={() => decision.mutate('approved')}
        >
          <Check size={16} />
          Approve evidence
        </Button>
      </div>
    </Panel>
  );
}
