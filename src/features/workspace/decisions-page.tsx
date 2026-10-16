import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Scale,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface Decision {
  id: string;
  title: string;
  status: 'proposed' | 'accepted' | 'superseded';
  reasoning: string;
  alternatives: string;
  expected_impact: string;
  owner_id: string;
  ownerName: string;
  supersedes_id?: string | null;
  created_at: number;
}

export function DecisionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isProposeOpen, setIsProposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<'proposed' | 'accepted'>('proposed');
  const [reasoning, setReasoning] = useState('');
  const [alternatives, setAlternatives] = useState('');
  const [expectedImpact, setExpectedImpact] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const canPropose = user?.permissions.includes('task.manage') || user?.roles.includes('super_admin');

  const query = useQuery({
    queryKey: ['decisions'],
    queryFn: () => api<Decision[]>('/workspace/decisions'),
  });

  const proposeMutation = useMutation({
    mutationFn: () =>
      api('/workspace/decisions', {
        method: 'POST',
        body: JSON.stringify({
          title,
          status,
          reasoning,
          alternatives,
          expectedImpact,
        }),
      }),
    onSuccess: () => {
      setIsProposeOpen(false);
      resetProposeForm();
      setFeedback('Architecture Decision Record (ADR) logged.');
      void queryClient.invalidateQueries({ queryKey: ['decisions'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Logging failed'),
  });

  const resetProposeForm = () => {
    setTitle('');
    setStatus('proposed');
    setReasoning('');
    setAlternatives('');
    setExpectedImpact('');
  };

  return (
    <div className="page decisions-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">System Architecture</span>
          <h1>Architecture Decision Records (ADR)</h1>
          <p>Documented technical tradeoffs, system boundaries, cryptographic standards, and protocol choices.</p>
        </div>

        {canPropose && (
          <Button variant="primary" size="sm" onClick={() => setIsProposeOpen(true)}>
            <Plus size={16} /> Propose architecture decision
          </Button>
        )}
      </header>

      {feedback && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{feedback}</span>
          <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
        </div>
      )}

      {query.isLoading ? (
        <PageSkeleton />
      ) : query.data?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {query.data.map((decision) => (
            <Panel
              key={decision.id}
              style={{
                borderLeft: `4px solid ${
                  decision.status === 'accepted'
                    ? 'var(--color-matrix-emerald)'
                    : decision.status === 'superseded'
                    ? 'var(--color-border)'
                    : 'var(--color-cyan-sentinel)'
                }`,
                padding: '20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Scale size={20} style={{ color: 'var(--color-cyan-sentinel)' }} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{decision.title}</h3>
                    <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>
                      Proposed by <strong>{decision.ownerName}</strong> · {formatDate(decision.created_at)}
                    </small>
                  </div>
                </div>
                <StatusBadge status={decision.status} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                <div style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '4px' }}>
                  <strong style={{ fontSize: '0.8rem', color: 'var(--color-muted)', display: 'block', marginBottom: '4px' }}>
                    Reasoning & Architectural Context:
                  </strong>
                  <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>{decision.reasoning}</p>
                </div>

                {decision.alternatives && (
                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '10px 12px', borderRadius: '4px' }}>
                    <strong style={{ fontSize: '0.75rem', color: 'var(--color-muted)', display: 'block', marginBottom: '2px' }}>
                      Alternatives Evaluated & Discarded:
                    </strong>
                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-muted)' }}>{decision.alternatives}</p>
                  </div>
                )}

                {decision.expected_impact && (
                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '10px 12px', borderRadius: '4px' }}>
                    <strong style={{ fontSize: '0.75rem', color: 'var(--color-muted)', display: 'block', marginBottom: '2px' }}>
                      System Impact & Tradeoffs:
                    </strong>
                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--color-muted)' }}>{decision.expected_impact}</p>
                  </div>
                )}
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No decisions recorded" body="Propose Architecture Decision Records (ADRs) to document key system tradeoffs." />
      )}

      {/* Propose Modal */}
      {isProposeOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Propose Architecture Decision (ADR)</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsProposeOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); proposeMutation.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Decision Title *</small>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Adopt Ed25519 for Firmware Verification Signatures"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Status *</small>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'proposed' | 'accepted')}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                >
                  <option value="proposed">Proposed (Under review)</option>
                  <option value="accepted">Accepted (Active consensus)</option>
                </select>
              </label>

              <label>
                <small>Reasoning & Technical Motivation * (Minimum 10 characters)</small>
                <textarea
                  rows={4}
                  required
                  value={reasoning}
                  onChange={(e) => setReasoning(e.target.value)}
                  placeholder="Detail the technical reasoning, requirements, and constraints motivating this decision..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Alternatives Considered</small>
                <textarea
                  rows={2}
                  value={alternatives}
                  onChange={(e) => setAlternatives(e.target.value)}
                  placeholder="e.g. RSA-2048 was evaluated but rejected due to key size and memory constraints on ESP32..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Expected System Impact</small>
                <textarea
                  rows={2}
                  value={expectedImpact}
                  onChange={(e) => setExpectedImpact(e.target.value)}
                  placeholder="e.g. Reduces signature verification latency to under 3ms; requires libsodium port..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsProposeOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={proposeMutation.isPending || !title || reasoning.length < 10}>
                  {proposeMutation.isPending ? 'Logging ADR...' : 'Record Decision'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
