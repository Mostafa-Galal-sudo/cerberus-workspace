import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertOctagon,
  Bug,
  CheckCircle2,
  ExternalLink,
  Plus,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface IssueItem {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'resolved';
  reporter_id: string;
  assignee_id?: string | null;
  reporterName: string;
  assigneeName?: string | null;
  reproduction_steps?: string;
  resolution_notes?: string | null;
  task_id?: string | null;
  created_at: number;
  resolved_at?: number | null;
}

interface MemberOption {
  id: string;
  name: string;
}

export function IssuesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [issueType, setIssueType] = useState<'blockers' | 'bugs'>('blockers');
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [resolvingIssue, setResolvingIssue] = useState<IssueItem | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  // Report Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('high');
  const [assigneeId, setAssigneeId] = useState('');
  const [reproductionSteps, setReproductionSteps] = useState('');
  const [taskId, setTaskId] = useState('');

  const issuesQuery = useQuery({
    queryKey: [issueType],
    queryFn: () => api<IssueItem[]>(`/workspace/${issueType}`),
  });

  const membersQuery = useQuery({
    queryKey: ['members-short'],
    queryFn: () => api<MemberOption[]>('/users'),
    enabled: isReportOpen,
  });

  const reportMutation = useMutation({
    mutationFn: () =>
      api(`/workspace/${issueType}`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          severity,
          assigneeId: assigneeId || undefined,
          reproductionSteps: reproductionSteps || undefined,
          taskId: taskId || undefined,
        }),
      }),
    onSuccess: () => {
      setIsReportOpen(false);
      resetReportForm();
      setFeedback(`${issueType === 'blockers' ? 'Blocker escalated' : 'Bug defect recorded'}.`);
      void queryClient.invalidateQueries({ queryKey: [issueType] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Reporting failed'),
  });

  const resolveMutation = useMutation({
    mutationFn: (issueId: string) =>
      api(`/workspace/${issueType}/${issueId}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ resolutionNotes }),
      }),
    onSuccess: () => {
      setResolvingIssue(null);
      setResolutionNotes('');
      setFeedback('Issue resolved and verified.');
      void queryClient.invalidateQueries({ queryKey: [issueType] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Resolution failed'),
  });

  const resetReportForm = () => {
    setTitle('');
    setDescription('');
    setSeverity('high');
    setAssigneeId('');
    setReproductionSteps('');
    setTaskId('');
  };

  const filteredIssues = (issuesQuery.data ?? []).filter((item) => {
    if (severityFilter && item.severity !== severityFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="page issues-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Operational Resilience</span>
          <h1>Defects & Engineering Blockers</h1>
          <p>Strict tracking of critical-path obstacles, hardware failures, and software anomalies.</p>
        </div>

        <Button variant="primary" size="sm" onClick={() => setIsReportOpen(true)}>
          <Plus size={16} /> Report {issueType === 'blockers' ? 'blocker' : 'bug'}
        </Button>
      </header>

      {feedback && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{feedback}</span>
          <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
        </div>
      )}

      {/* Toolbar with Issue Type Tabs and Filters */}
      <Panel className="task-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-subtle)', padding: '3px', borderRadius: '6px' }}>
          <Button
            variant={issueType === 'blockers' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setIssueType('blockers')}
          >
            <AlertOctagon size={15} style={{ color: 'var(--color-status-blocked)' }} /> Critical Blockers
          </Button>
          <Button
            variant={issueType === 'bugs' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setIssueType('bugs')}
          >
            <Bug size={15} style={{ color: 'var(--color-magma-flame)' }} /> Software / HW Bugs
          </Button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <label className="select-box">
            <SlidersHorizontal size={15} />
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="select-box">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
        </div>
      </Panel>

      {/* Issues List */}
      {issuesQuery.isLoading ? (
        <PageSkeleton />
      ) : filteredIssues.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredIssues.map((issue) => {
            const isResolved = issue.status === 'resolved';
            const canResolve = !isResolved && (issue.assignee_id === user?.id || user?.roles.includes('super_admin'));
            return (
              <Panel
                key={issue.id}
                style={{
                  borderLeft: `4px solid ${
                    isResolved
                      ? 'var(--color-status-approved)'
                      : issue.severity === 'critical'
                      ? 'var(--color-status-blocked)'
                      : 'var(--color-magma-flame)'
                  }`,
                  padding: '16px 20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                      <StatusBadge status={issue.severity} />
                      <StatusBadge status={issue.status} />
                      {issue.task_id && (
                        <Link to={`/tasks/${issue.task_id}`} style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          <ExternalLink size={12} /> Linked to {issue.task_id}
                        </Link>
                      )}
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{issue.title}</h3>
                  </div>

                  {canResolve && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setResolvingIssue(issue)}
                    >
                      <CheckCircle2 size={14} /> Mark resolved
                    </Button>
                  )}
                </div>

                <p style={{ margin: '6px 0', fontSize: '0.9rem', lineHeight: 1.5 }}>{issue.description}</p>

                {issue.reproduction_steps && (
                  <div style={{ background: 'var(--color-surface-subtle)', padding: '8px 12px', borderRadius: '4px', fontSize: '0.8rem', marginTop: '8px' }}>
                    <strong style={{ color: 'var(--color-muted)' }}>Reproduction Protocol:</strong>
                    <pre style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{issue.reproduction_steps}</pre>
                  </div>
                )}

                {issue.resolution_notes && (
                  <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '8px 12px', borderRadius: '4px', fontSize: '0.8rem', marginTop: '8px' }}>
                    <strong style={{ color: 'var(--color-status-approved)' }}>Resolution Verified:</strong>
                    <p style={{ margin: '2px 0 0' }}>{issue.resolution_notes}</p>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '10px', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  <span>Reported by <strong>{issue.reporterName}</strong> · Assignee: <strong>{issue.assigneeName ?? 'Unassigned'}</strong></span>
                  <span>{formatDate(issue.created_at)}</span>
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title={`No open ${issueType}`}
          body={`No engineering ${issueType} currently meet the active filter criteria.`}
        />
      )}

      {/* Report Modal */}
      {isReportOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '580px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Report Engineering {issueType === 'blockers' ? 'Blocker' : 'Bug'}</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsReportOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); reportMutation.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Title *</small>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. SPI clock skew causes frame dropped on ESP32 receiver"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label>
                  <small>Severity *</small>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  >
                    <option value="critical">Critical (Halts delivery)</option>
                    <option value="high">High (Severe impact)</option>
                    <option value="medium">Medium (Impaired operation)</option>
                    <option value="low">Low (Cosmetic/Minor)</option>
                  </select>
                </label>

                <label>
                  <small>Assignee</small>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  >
                    <option value="">Unassigned</option>
                    {membersQuery.data?.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <small>Description *</small>
                <textarea
                  rows={3}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the failure mode, affected hardware or module..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Reproduction Protocol / Logs</small>
                <textarea
                  rows={3}
                  value={reproductionSteps}
                  onChange={(e) => setReproductionSteps(e.target.value)}
                  placeholder="1. Power cycle device\n2. Attach logic analyzer on pin 14\n3. Trigger packet transmission..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.8rem' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsReportOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={reportMutation.isPending || !title || !description}>
                  {reportMutation.isPending ? 'Logging...' : 'Record Issue'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Resolve Issue Modal */}
      {resolvingIssue && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '500px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Resolve: {resolvingIssue.title}</h3>
              <Button variant="ghost" size="sm" onClick={() => setResolvingIssue(null)}><X size={16} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); resolveMutation.mutate(resolvingIssue.id); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Resolution Notes & Verification *</small>
                <textarea
                  rows={4}
                  required
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Detail how the issue was fixed, commit reference, and verified test results..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setResolvingIssue(null)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={resolveMutation.isPending || !resolutionNotes.trim()}>
                  {resolveMutation.isPending ? 'Recording...' : 'Mark as Resolved'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
