import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  Check,
  Circle,
  Edit3,
  GitPullRequest,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface Detail {
  task: Record<string, string | number | null> & {
    id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    assignee_id: string;
    assignee_name: string;
    domain_name: string;
    acceptance_criteria: string;
    validation_procedure: string;
    evidence_requirements: string;
    implementation_steps: string;
    deliverables: string;
    prerequisites: string;
    inputs: string;
    required_tools: string;
    expected_outputs: string;
  };
  checklist: Array<{ id: string; title: string; required: number; completed_at: number | null }>;
  dependencies: Array<{ id: string; title: string; status: string; priority: string }>;
  submissions: Array<{ id: string; status: string; version: number; summary: string; submitted_at: number }>;
  availableTasks?: Array<{ id: string; title: string }>;
}

export function TaskDetailPage() {
  const { taskId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();

  const [summary, setSummary] = useState('');
  const [evidence, setEvidence] = useState('');
  const [message, setMessage] = useState('');
  const [selectedDepId, setSelectedDepId] = useState('');
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Edit fields
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editAcceptanceCriteria, setEditAcceptanceCriteria] = useState('');
  const [editValidationProcedure, setEditValidationProcedure] = useState('');
  const [editEvidenceRequirements, setEditEvidenceRequirements] = useState('');

  const isAdmin = user?.roles.includes('super_admin');

  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api<Detail>(`/tasks/${taskId}`),
  });

  const checklist = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api(`/tasks/${taskId}/checklist/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['task', taskId] }),
  });

  const submit = useMutation({
    mutationFn: () =>
      api(`/tasks/${taskId}/submissions`, {
        method: 'POST',
        body: JSON.stringify({
          summary,
          evidence: [{ kind: evidence.includes('github.com') ? 'github' : 'url', label: 'Implementation evidence', value: evidence }],
        }),
      }),
    onSuccess: () => {
      setMessage('Submitted for independent administrative review.');
      setSummary('');
      setEvidence('');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Submission failed'),
  });

  const addDependency = useMutation({
    mutationFn: (targetId: string) =>
      api(`/tasks/${taskId}/dependencies`, { method: 'POST', body: JSON.stringify({ dependsOnTaskId: targetId }) }),
    onSuccess: () => {
      setSelectedDepId('');
      setMessage('Upstream dependency linked.');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Failed to add dependency'),
  });

  const removeDependency = useMutation({
    mutationFn: (targetId: string) =>
      api(`/tasks/${taskId}/dependencies/${targetId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Dependency constraint removed.');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Failed to remove dependency'),
  });

  const updateTask = useMutation({
    mutationFn: () =>
      api(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          priority: editPriority,
          acceptanceCriteria: editAcceptanceCriteria,
          validationProcedure: editValidationProcedure,
          evidenceRequirements: editEvidenceRequirements,
        }),
      }),
    onSuccess: () => {
      setIsEditOpen(false);
      setMessage('Task specification updated.');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Update failed'),
  });

  const archiveTask = useMutation({
    mutationFn: () => api(`/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => navigate('/tasks'),
    onError: (error) => setMessage(error instanceof ApiError ? error.message : 'Archive failed'),
  });

  if (query.isLoading) return <PageSkeleton />;
  if (!query.data) return <EmptyState title="Task not found" body="This task may have been archived or is unavailable." />;

  const { task } = query.data;
  const canWork = task.assignee_id === user?.id;
  const completedChecklistCount = query.data.checklist.filter((item) => item.completed_at).length;
  const totalChecklistCount = query.data.checklist.length;
  const checklistPercent = totalChecklistCount ? Math.round((completedChecklistCount / totalChecklistCount) * 100) : 0;

  const handleStartEdit = () => {
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditAcceptanceCriteria(task.acceptance_criteria);
    setEditValidationProcedure(task.validation_procedure);
    setEditEvidenceRequirements(task.evidence_requirements);
    setIsEditOpen(true);
  };

  return (
    <div className="page task-detail-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <Link className="back-link" to="/tasks" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <ArrowLeft size={16} />
          <span>Return to task register</span>
        </Link>

        {isAdmin && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" size="sm" onClick={handleStartEdit}>
              <Edit3 size={14} /> Edit specification
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm('Archive this task record? This cannot be undone.')) {
                  archiveTask.mutate();
                }
              }}
              style={{ color: 'var(--color-status-blocked)' }}
            >
              <Archive size={14} /> Archive
            </Button>
          </div>
        )}
      </div>

      {message && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{message}</span>
          <Button variant="ghost" size="sm" onClick={() => setMessage('')}>Dismiss</Button>
        </div>
      )}

      <header className="task-detail-header">
        <div>
          <div className="task-meta" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
            <StatusBadge status={task.status} />
            <span style={{ color: 'var(--color-cyan-sentinel)', textTransform: 'capitalize' }}>{task.priority} priority</span>
            <span>{task.domain_name}</span>
            <span className="mono-data" style={{ fontSize: '0.65rem' }}>{task.id}</span>
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '1.5rem' }}>{task.title}</h1>
          <p style={{ margin: 0, color: 'var(--color-muted)', lineHeight: 1.6 }}>{task.description}</p>
        </div>

        <div className="owner-card" style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--color-surface-subtle)', padding: '10px 16px', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
          <span className="avatar" style={{ width: '40px', height: '40px' }}>
            {task.assignee_name ? task.assignee_name.slice(0, 2).toUpperCase() : '??'}
          </span>
          <div>
            <small style={{ color: 'var(--color-muted)', display: 'block' }}>Assigned engineer</small>
            <strong style={{ fontSize: '0.9rem' }}>{task.assignee_name || 'Unassigned'}</strong>
          </div>
        </div>
      </header>

      <div className="task-detail-grid">
        <div className="task-main">
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Sentinel Implementation Brief</h2>
                <p>The administrator-defined specifications and evidence requirements.</p>
              </div>
            </div>
            <DetailBlock title="Implementation steps" value={task.implementation_steps} />
            <DetailBlock title="Deliverables" value={task.deliverables} />
            <DetailBlock title="Acceptance criteria" value={task.acceptance_criteria} />
            <DetailBlock title="Validation procedure" value={task.validation_procedure} />
            <DetailBlock title="Evidence requirements" value={task.evidence_requirements} />
          </Panel>

          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Submission record & provenance</h2>
                <p>Every review cycle is permanently recorded in the audit log.</p>
              </div>
            </div>
            {query.data.submissions.length ? (
              <div className="submission-history" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {query.data.submissions.map((item) => (
                  <div key={item.id} style={{ padding: '12px', background: 'var(--color-surface-subtle)', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <strong>v{item.version}</strong>
                        <StatusBadge status={item.status} />
                      </div>
                      <small style={{ color: 'var(--color-muted)' }}>{formatDate(item.submitted_at)}</small>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>{item.summary}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No submissions recorded"
                body="Complete all required checklist items and attach reproducible evidence to request review."
              />
            )}
          </Panel>
        </div>

        <aside className="task-side">
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Verification checklist</h2>
                <p>{completedChecklistCount} of {totalChecklistCount} verified ({checklistPercent}%)</p>
              </div>
              {checklistPercent === 100 ? (
                <ShieldCheck size={20} style={{ color: 'var(--color-matrix-emerald)' }} />
              ) : (
                <ShieldAlert size={20} style={{ color: 'var(--color-magma-amber)' }} />
              )}
            </div>

            <div style={{ padding: '0 20px', marginTop: '12px' }}>
              <div className="progress-track" style={{ height: '6px' }}>
                <i style={{ width: `${checklistPercent}%` }} />
              </div>
            </div>

            <div className="checklist" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px' }}>
              {query.data.checklist.map((item) => (
                <button
                  type="button"
                  disabled={!canWork || checklist.isPending}
                  onClick={() => checklist.mutate({ id: item.id, completed: !item.completed_at })}
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    background: item.completed_at ? 'var(--color-surface-hover)' : 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '4px',
                    cursor: canWork ? 'pointer' : 'default',
                    textAlign: 'left',
                    color: 'inherit',
                  }}
                >
                  {item.completed_at ? <Check size={16} style={{ color: 'var(--color-status-approved)' }} /> : <Circle size={16} />}
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>
                    {item.title}
                    {item.required ? <small style={{ color: 'var(--color-cyan-sentinel)', marginLeft: '6px' }}>Required</small> : null}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          {/* Dependency Manager */}
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Dependency gates</h2>
                <p>Upstream prerequisites required before submission.</p>
              </div>
            </div>

            {query.data.dependencies.length ? (
              <div className="compact-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px' }}>
                {query.data.dependencies.map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'var(--color-surface-subtle)', borderRadius: '4px' }}>
                    <Link to={`/tasks/${item.id}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'inherit', flex: 1 }}>
                      <StatusBadge status={item.status} />
                      <strong style={{ fontSize: '0.85rem' }}>{item.title}</strong>
                    </Link>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => removeDependency.mutate(item.id)}
                        disabled={removeDependency.isPending}
                        title="Remove dependency"
                        style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: '4px' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="quiet-copy" style={{ padding: '12px', color: 'var(--color-muted)', fontSize: '0.8rem' }}>
                No upstream prerequisites. This work may proceed independently.
              </p>
            )}

            {/* Admin Add Dependency Form */}
            {isAdmin && query.data.availableTasks && (
              <div style={{ padding: '12px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '8px' }}>
                <select
                  value={selectedDepId}
                  onChange={(e) => setSelectedDepId(e.target.value)}
                  style={{ flex: 1, padding: '6px', fontSize: '0.8rem', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                >
                  <option value="">Select upstream task...</option>
                  {query.data.availableTasks
                    .filter((t) => !query.data?.dependencies.some((d) => d.id === t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                </select>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!selectedDepId || addDependency.isPending}
                  onClick={() => addDependency.mutate(selectedDepId)}
                >
                  <Plus size={14} /> Add
                </Button>
              </div>
            )}
          </Panel>

          {/* Member Submit for Review Panel */}
          {canWork && task.status !== 'approved' && (
            <Panel className="submit-panel" style={{ border: '1px solid var(--color-cyan-sentinel)', padding: '16px' }}>
              <div className="panel-heading" style={{ marginBottom: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '1.1rem' }}>Submit for review</h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Dispatches an alert to administrators for independent audit.</p>
                </div>
                <GitPullRequest style={{ color: 'var(--color-cyan-sentinel)' }} />
              </div>
              <label className="field" style={{ display: 'block', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>Summary of implementation & test results *</span>
                <textarea
                  rows={4}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="Detail changes made, commands executed, and verified test outputs…"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>Verification evidence URL *</span>
                <input
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  placeholder="https://github.com/… or commit/PR link"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <Button
                disabled={summary.length < 20 || !evidence || submit.isPending}
                onClick={() => submit.mutate()}
                size="lg"
                style={{ width: '100%' }}
              >
                <Send size={16} />
                {submit.isPending ? 'Dispatching evidence…' : 'Submit evidence for review'}
              </Button>
            </Panel>
          )}
        </aside>
      </div>

      {/* Edit Task Specification Modal */}
      {isEditOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Edit Task Specification</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsEditOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); updateTask.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label>
                <small>Title</small>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <label>
                <small>Priority</small>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label>
                <small>Scope & Description</small>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <label>
                <small>Acceptance Criteria</small>
                <textarea
                  rows={2}
                  value={editAcceptanceCriteria}
                  onChange={(e) => setEditAcceptanceCriteria(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <label>
                <small>Validation Procedure</small>
                <textarea
                  rows={2}
                  value={editValidationProcedure}
                  onChange={(e) => setEditValidationProcedure(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <label>
                <small>Evidence Requirements</small>
                <input
                  type="text"
                  value={editEvidenceRequirements}
                  onChange={(e) => setEditEvidenceRequirements(e.target.value)}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={updateTask.isPending}>Save changes</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailBlock({ title, value }: { title: string; value: string }) {
  return (
    <section className="detail-block" style={{ marginBottom: '14px' }}>
      <h3 style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: '0 0 4px' }}>{title}</h3>
      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5 }}>{value || 'Not specified.'}</p>
    </section>
  );
}
