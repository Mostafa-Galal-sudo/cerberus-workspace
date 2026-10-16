import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck,
  Plus,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface Worklog {
  id: string;
  completed_work: string;
  current_work: string;
  problems: string;
  tests_performed: string;
  evidence: string;
  next_steps: string;
  created_at: number;
  userName: string;
}

export function WorklogsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [completedWork, setCompletedWork] = useState('');
  const [currentWork, setCurrentWork] = useState('');
  const [problems, setProblems] = useState('');
  const [testsPerformed, setTestsPerformed] = useState('');
  const [evidence, setEvidence] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['worklogs', user?.id],
    queryFn: () => api<Worklog[]>('/workspace/worklogs'),
  });

  const logWorkMutation = useMutation({
    mutationFn: () =>
      api('/workspace/worklogs', {
        method: 'POST',
        body: JSON.stringify({
          completedWork,
          currentWork,
          problems,
          testsPerformed,
          evidence,
          nextSteps,
        }),
      }),
    onSuccess: () => {
      setIsOpen(false);
      resetForm();
      setFeedback('Daily engineering worklog recorded in verified audit record.');
      void queryClient.invalidateQueries({ queryKey: ['worklogs'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Logging failed'),
  });

  const resetForm = () => {
    setCompletedWork('');
    setCurrentWork('');
    setProblems('');
    setTestsPerformed('');
    setEvidence('');
    setNextSteps('');
  };

  return (
    <div className="page worklogs-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Individual Accountability</span>
          <h1>Daily Engineering Worklogs</h1>
          <p>Continuous progress disclosures, test fixtures exercised, blockages, and evidence provenance.</p>
        </div>

        <Button variant="primary" size="sm" onClick={() => setIsOpen(true)}>
          <Plus size={16} /> Log today's work
        </Button>
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
          {query.data.map((log) => (
            <Panel key={log.id} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileCheck size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />
                  <strong style={{ fontSize: '0.95rem' }}>{log.userName}</strong>
                </div>
                <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>
                  Logged {formatDate(log.created_at)}
                </small>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                <div style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '4px' }}>
                  <strong style={{ color: 'var(--color-status-approved)', fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>
                    Completed Work:
                  </strong>
                  <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{log.completed_work}</p>
                </div>

                {log.current_work && (
                  <div style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '4px' }}>
                    <strong style={{ color: 'var(--color-cyan-sentinel)', fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>
                      Current In-Flight Work:
                    </strong>
                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{log.current_work}</p>
                  </div>
                )}
              </div>

              {(log.tests_performed || log.problems) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', fontSize: '0.8rem' }}>
                  {log.tests_performed && (
                    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '10px', borderRadius: '4px' }}>
                      <strong style={{ color: 'var(--color-muted)' }}>Tests Performed:</strong>
                      <p style={{ margin: '4px 0 0', lineHeight: 1.4 }}>{log.tests_performed}</p>
                    </div>
                  )}

                  {log.problems && (
                    <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '10px', borderRadius: '4px' }}>
                      <strong style={{ color: 'var(--color-status-blocked)' }}>Encountered Roadblocks:</strong>
                      <p style={{ margin: '4px 0 0', lineHeight: 1.4 }}>{log.problems}</p>
                    </div>
                  )}
                </div>
              )}

              {(log.evidence || log.next_steps) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
                  <span>{log.next_steps ? `Next Steps: ${log.next_steps}` : ''}</span>
                  {log.evidence && <span>Evidence: <code className="mono-data">{log.evidence}</code></span>}
                </div>
              )}
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState title="No worklogs logged yet" body="Disclose your daily engineering activities and test evidence." />
      )}

      {/* Log Modal */}
      {isOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Log Daily Engineering Work</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); logWorkMutation.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Completed Engineering Work *</small>
                <textarea
                  rows={3}
                  required
                  value={completedWork}
                  onChange={(e) => setCompletedWork(e.target.value)}
                  placeholder="Detail the modules coded, tests executed, or boards wired today..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Current Work Underway</small>
                <textarea
                  rows={2}
                  value={currentWork}
                  onChange={(e) => setCurrentWork(e.target.value)}
                  placeholder="In-flight branches, ongoing compiles or captures..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Tests Performed & Verification Observations</small>
                <textarea
                  rows={2}
                  value={testsPerformed}
                  onChange={(e) => setTestsPerformed(e.target.value)}
                  placeholder="Executed unit tests on SPI driver; captured 500 packet frames..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Problems / Blockers Encountered</small>
                <textarea
                  rows={2}
                  value={problems}
                  onChange={(e) => setProblems(e.target.value)}
                  placeholder="Ground loop noise on oscilloscope probe..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label>
                  <small>Evidence Reference / URL</small>
                  <input
                    type="text"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="commit sha, logic analyzer capture"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>

                <label>
                  <small>Immediate Next Steps</small>
                  <input
                    type="text"
                    value={nextSteps}
                    onChange={(e) => setNextSteps(e.target.value)}
                    placeholder="Complete CRC32 verification loop"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={logWorkMutation.isPending || !completedWork.trim()}>
                  {logWorkMutation.isPending ? 'Logging...' : 'Record Daily Worklog'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
