import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Check,
  Circle,
  Edit3,
  GitPullRequest,
  Layers,
  Link2,
  Plus,
  Send,
  Shield,
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
  dependents?: Array<{ id: string; title: string; status: string; priority: string }>;
  submissions: Array<{ id: string; status: string; version: number; summary: string; submitted_at: number }>;
  availableTasks?: Array<{ id: string; title: string }>;
}

interface MemberOption {
  id: string;
  name: string;
  specialization: string;
}

interface TaskComment {
  id: string;
  taskId: string;
  parentId: string | null;
  body: string;
  createdAt: number;
  updatedAt: number;
  authorId: string;
  authorName: string;
  edited: boolean;
}

export function TaskDetailPage() {
  const { taskId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();

  const [summary, setSummary] = useState('');
  const [evidence, setEvidence] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedDepId, setSelectedDepId] = useState('');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [activeEditTab, setActiveEditTab] = useState<'core' | 'execution' | 'criteria'>('core');
  const [commentBody, setCommentBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');

  // Comprehensive Edit fields
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editAssigneeId, setEditAssigneeId] = useState('');
  const [editImplementationSteps, setEditImplementationSteps] = useState('');
  const [editDeliverables, setEditDeliverables] = useState('');
  const [editPrerequisites, setEditPrerequisites] = useState('');
  const [editInputs, setEditInputs] = useState('');
  const [editRequiredTools, setEditRequiredTools] = useState('');
  const [editExpectedOutputs, setEditExpectedOutputs] = useState('');
  const [editAcceptanceCriteria, setEditAcceptanceCriteria] = useState('');
  const [editValidationProcedure, setEditValidationProcedure] = useState('');
  const [editEvidenceRequirements, setEditEvidenceRequirements] = useState('');

  const isAdmin = Boolean(user?.roles.includes('super_admin') || user?.permissions.includes('task.manage'));
  const isSupervisor = Boolean(user?.roles.includes('project_supervisor'));

  const query = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api<Detail>(`/tasks/${taskId}`),
  });

  const membersQuery = useQuery({
    queryKey: ['members-short'],
    queryFn: () => api<MemberOption[]>('/users'),
    enabled: isEditOpen,
  });

  const commentsQuery = useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => api<TaskComment[]>(`/tasks/${taskId}/comments`),
    enabled: Boolean(taskId),
  });

  const addComment = useMutation({
    mutationFn: () =>
      api(`/tasks/${taskId}/comments`, { method: 'POST', body: JSON.stringify({ body: commentBody }) }),
    onSuccess: () => {
      setCommentBody('');
      setMessage('Discussion comment recorded.');
      setErrorMessage('');
      void client.invalidateQueries({ queryKey: ['task-comments', taskId] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Comment could not be added'),
  });

  const editComment = useMutation({
    mutationFn: (commentId: string) =>
      api(`/tasks/${taskId}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ body: editingCommentBody }) }),
    onSuccess: () => {
      setEditingCommentId(null);
      setEditingCommentBody('');
      setMessage('Comment updated.');
      setErrorMessage('');
      void client.invalidateQueries({ queryKey: ['task-comments', taskId] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Comment could not be updated'),
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api(`/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Comment retracted.');
      setErrorMessage('');
      void client.invalidateQueries({ queryKey: ['task-comments', taskId] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Comment could not be deleted'),
  });

  const checklist = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api(`/tasks/${taskId}/checklist/${id}`, { method: 'PATCH', body: JSON.stringify({ completed }) }),
    onSuccess: () => {
      setErrorMessage('');
      client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Checklist update failed'),
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
      setErrorMessage('');
      setSummary('');
      setEvidence('');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Submission failed'),
  });

  const addDependency = useMutation({
    mutationFn: (targetId: string) =>
      api(`/tasks/${taskId}/dependencies`, { method: 'POST', body: JSON.stringify({ dependsOnTaskId: targetId }) }),
    onSuccess: () => {
      setSelectedDepId('');
      setMessage('Upstream prerequisite linked.');
      setErrorMessage('');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Failed to add dependency'),
  });

  const removeDependency = useMutation({
    mutationFn: (targetId: string) =>
      api(`/tasks/${taskId}/dependencies/${targetId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Dependency constraint removed.');
      setErrorMessage('');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Failed to remove dependency'),
  });

  const updateTask = useMutation({
    mutationFn: () =>
      api(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          priority: editPriority,
          assigneeId: editAssigneeId || null,
          implementationSteps: editImplementationSteps,
          deliverables: editDeliverables,
          prerequisites: editPrerequisites,
          inputs: editInputs,
          requiredTools: editRequiredTools,
          expectedOutputs: editExpectedOutputs,
          acceptanceCriteria: editAcceptanceCriteria,
          validationProcedure: editValidationProcedure,
          evidenceRequirements: editEvidenceRequirements,
        }),
      }),
    onSuccess: () => {
      setIsEditOpen(false);
      setMessage('Task specification persisted.');
      setErrorMessage('');
      void client.invalidateQueries({ queryKey: ['task', taskId] });
      void client.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Update failed'),
  });

  const archiveTask = useMutation({
    mutationFn: () => api(`/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => navigate('/tasks'),
    onError: (error) => setErrorMessage(error instanceof ApiError ? error.message : 'Archive failed'),
  });

  if (query.isLoading) return <PageSkeleton />;
  if (!query.data) return <EmptyState title="Task not found" body="This task may have been archived or is unavailable." />;

  const { task } = query.data;
  const canWork = task.assignee_id === user?.id && !isSupervisor;
  const canComment = !isSupervisor && (canWork || isAdmin);
  const completedChecklistCount = query.data.checklist.filter((item) => item.completed_at).length;
  const totalChecklistCount = query.data.checklist.length;
  const checklistPercent = totalChecklistCount ? Math.round((completedChecklistCount / totalChecklistCount) * 100) : 0;

  // Dependency analysis
  const unapprovedDependencies = query.data.dependencies.filter((d) => d.status !== 'approved');
  const isBlockedByDependencies = unapprovedDependencies.length > 0;
  const dependentsList = query.data.dependents ?? [];

  const handleStartEdit = () => {
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditAssigneeId(task.assignee_id || '');
    setEditImplementationSteps(task.implementation_steps || '');
    setEditDeliverables(task.deliverables || '');
    setEditPrerequisites(task.prerequisites || '');
    setEditInputs(task.inputs || '');
    setEditRequiredTools(task.required_tools || '');
    setEditExpectedOutputs(task.expected_outputs || '');
    setEditAcceptanceCriteria(task.acceptance_criteria || '');
    setEditValidationProcedure(task.validation_procedure || '');
    setEditEvidenceRequirements(task.evidence_requirements || '');
    setIsEditOpen(true);
  };

  const handleAddDependencySubmit = () => {
    if (!selectedDepId) return;

    if (selectedDepId === taskId) {
      setErrorMessage('A task cannot depend on itself.');
      return;
    }

    // Client-side cycle pre-check: verify if selectedDepId is already dependent on this task
    if (dependentsList.some((d) => d.id === selectedDepId)) {
      setErrorMessage(`Cycle detected: Target task already depends on "${task.title}". Adding this would create a circular loop.`);
      return;
    }

    addDependency.mutate(selectedDepId);
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

      {errorMessage && (
        <div style={{ padding: '10px 16px', background: 'var(--color-status-blocked-bg)', border: '1px solid var(--color-status-blocked-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-status-blocked)', fontSize: '0.85rem' }}>{errorMessage}</span>
          <Button variant="ghost" size="sm" onClick={() => setErrorMessage('')}>Dismiss</Button>
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
            <DetailBlock title="Prerequisites & environment" value={task.prerequisites} />
            <DetailBlock title="Required inputs" value={task.inputs} />
            <DetailBlock title="Required tools" value={task.required_tools} />
            <DetailBlock title="Expected outputs" value={task.expected_outputs} />
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

          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Discussion & review notes</h2>
                <p>Implementation questions and review clarifications stay attached to the task record.</p>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {commentsQuery.data?.length ?? 0} comment{commentsQuery.data?.length === 1 ? '' : 's'}
              </span>
            </div>

            <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {commentsQuery.isLoading ? (
                <PageSkeleton />
              ) : commentsQuery.data?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {commentsQuery.data.map((comment) => {
                    const canModify = comment.authorId === user?.id || isAdmin;
                    const isEditing = editingCommentId === comment.id;
                    return (
                      <div key={comment.id} style={{ padding: '12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className="avatar small" style={{ fontSize: '0.65rem' }}>{comment.authorName.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span>
                            <strong style={{ fontSize: '0.85rem' }}>{comment.authorName}</strong>
                            <small style={{ color: 'var(--color-muted)' }}>{formatDate(comment.createdAt)}</small>
                            {comment.edited && <small style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>edited</small>}
                          </div>
                          {canModify && !isEditing && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                type="button"
                                title="Edit comment"
                                onClick={() => { setEditingCommentId(comment.id); setEditingCommentBody(comment.body); }}
                                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: '2px' }}
                              >
                                <Edit3 size={14} />
                              </button>
                              <button
                                type="button"
                                title="Delete comment"
                                onClick={() => deleteComment.mutate(comment.id)}
                                disabled={deleteComment.isPending}
                                style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: '2px' }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>

                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <textarea
                              rows={3}
                              value={editingCommentBody}
                              onChange={(event) => setEditingCommentBody(event.target.value)}
                              style={{ width: '100%', padding: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                            />
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                              <Button variant="ghost" size="sm" type="button" onClick={() => { setEditingCommentId(null); setEditingCommentBody(''); }}>Cancel</Button>
                              <Button variant="primary" size="sm" type="button" disabled={editComment.isPending || editingCommentBody.trim().length === 0} onClick={() => editComment.mutate(comment.id)}>Save</Button>
                            </div>
                          </div>
                        ) : (
                          <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{comment.body}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="No discussion yet" body="Attach implementation context or ask for review clarification here." />
              )}

              {canComment ? (
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                  <label htmlFor="task-comment" style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '6px' }}>Add a comment</label>
                  <textarea
                    id="task-comment"
                    rows={3}
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    maxLength={4000}
                    placeholder="Record implementation context, a review question, or the follow-up evidence..."
                    style={{ width: '100%', padding: '10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit', marginBottom: '8px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <small style={{ color: 'var(--color-muted)' }}>{commentBody.length}/4000</small>
                    <Button variant="primary" size="sm" type="button" disabled={addComment.isPending || commentBody.trim().length === 0} onClick={() => addComment.mutate()}>
                      <Send size={14} /> Post comment
                    </Button>
                  </div>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                  Discussion posting is restricted to the assigned engineer and administrators. Supervisors can record feedback from the member directory.
                </p>
              )}
            </div>
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
                <ShieldCheck size={20} style={{ color: 'var(--color-status-verified)' }} />
              ) : (
                <ShieldAlert size={20} style={{ color: 'var(--color-status-progress)' }} />
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
                  {item.completed_at ? <Check size={16} style={{ color: 'var(--color-status-verified)' }} /> : <Circle size={16} />}
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>
                    {item.title}
                    {item.required ? <small style={{ color: 'var(--color-cyan-sentinel)', marginLeft: '6px' }}>Required</small> : null}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          {/* Visual Dependency Gates Manager */}
          <Panel>
            <div className="panel-heading">
              <div>
                <h2>Dependency Gates (DAG)</h2>
                <p>Upstream prerequisites required before review submission.</p>
              </div>
              <Layers size={18} style={{ color: 'var(--color-silver-mid)' }} />
            </div>

            {/* Blocking status banner */}
            {isBlockedByDependencies && (
              <div style={{ margin: '12px 14px 0', padding: '8px 12px', background: 'var(--color-status-blocked-bg)', border: '1px solid var(--color-status-blocked-border)', borderRadius: '4px', fontSize: '0.78rem', color: 'var(--color-status-blocked)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <AlertTriangle size={14} />
                <span>Gated: {unapprovedDependencies.length} upstream prerequisite(s) not yet approved.</span>
              </div>
            )}

            {/* Upstream Prerequisites List */}
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-pewter)', marginBottom: '8px', textTransform: 'uppercase' }}>
                Upstream Prerequisites ({query.data.dependencies.length})
              </div>

              {query.data.dependencies.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {query.data.dependencies.map((item) => {
                    const isApproved = item.status === 'approved';
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px',
                          background: 'var(--color-surface-subtle)',
                          border: isApproved ? '1px solid var(--color-border-subtle)' : '1px solid var(--color-status-blocked-border)',
                          borderRadius: '4px',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
                          {isApproved ? (
                            <ShieldCheck size={16} style={{ color: 'var(--color-status-verified)', flexShrink: 0 }} />
                          ) : (
                            <ShieldAlert size={16} style={{ color: 'var(--color-status-blocked)', flexShrink: 0 }} />
                          )}
                          <Link to={`/tasks/${item.id}`} style={{ textDecoration: 'none', color: 'inherit', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <strong style={{ fontSize: '0.82rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</strong>
                            <small style={{ fontSize: '0.7rem', color: isApproved ? 'var(--color-status-verified)' : 'var(--color-pewter)' }}>
                              {isApproved ? 'Verified & Approved' : `Status: ${item.status}`}
                            </small>
                          </Link>
                        </div>

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
                    );
                  })}
                </div>
              ) : (
                <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                  No upstream prerequisites. This work item can proceed independently.
                </p>
              )}
            </div>

            {/* Downstream Dependents List (Tasks waiting on this task) */}
            {dependentsList.length > 0 && (
              <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '10px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-pewter)', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Downstream Dependents ({dependentsList.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {dependentsList.map((dep) => (
                    <Link
                      key={dep.id}
                      to={`/tasks/${dep.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        background: 'var(--color-surface-subtle)',
                        borderRadius: '4px',
                        textDecoration: 'none',
                        color: 'inherit',
                        fontSize: '0.8rem',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        <Link2 size={12} style={{ display: 'inline', marginRight: '6px', color: 'var(--color-pewter)' }} />
                        {dep.title}
                      </span>
                      <StatusBadge status={dep.status} />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Admin Add Prerequisite Form with Cycle Prevention */}
            {isAdmin && query.data.availableTasks && (
              <div style={{ padding: '12px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    value={selectedDepId}
                    onChange={(e) => {
                      setSelectedDepId(e.target.value);
                      setErrorMessage('');
                    }}
                    style={{ flex: 1, padding: '7px', fontSize: '0.8rem', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
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
                    onClick={handleAddDependencySubmit}
                  >
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </div>
            )}
          </Panel>

          {/* Member Submit for Review Panel */}
          {canWork && task.status !== 'approved' && (
            <Panel className="submit-panel" style={{ border: '1px solid var(--color-border-armor)', padding: '16px' }}>
              <div className="panel-heading" style={{ marginBottom: '12px' }}>
                <div>
                  <h2 style={{ fontSize: '1.1rem' }}>Submit for review</h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Dispatches an alert to administrators for independent audit.</p>
                </div>
                <GitPullRequest style={{ color: 'var(--color-silver-light)' }} />
              </div>

              {isBlockedByDependencies && (
                <div style={{ padding: '8px', background: 'var(--color-status-blocked-bg)', border: '1px solid var(--color-status-blocked-border)', borderRadius: '4px', marginBottom: '12px', fontSize: '0.78rem', color: 'var(--color-status-blocked)' }}>
                  All upstream prerequisites must be approved before submitting.
                </div>
              )}

              <label className="field" style={{ display: 'block', marginBottom: '10px' }}>
                <span style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>Summary of implementation & test results (min 20 chars) *</span>
                <textarea
                  rows={4}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="Detail changes made, commands executed, and verified test outputs…"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                />
              </label>
              <label className="field" style={{ display: 'block', marginBottom: '12px' }}>
                <span style={{ fontSize: '0.8rem', display: 'block', marginBottom: '4px' }}>Verification evidence URL *</span>
                <input
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  placeholder="https://github.com/… or commit/PR link"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                />
              </label>
              <Button
                disabled={summary.length < 20 || !evidence || isBlockedByDependencies || submit.isPending}
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

      {/* Comprehensive Task Definition Editor Modal */}
      {isEditOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(5, 6, 8, 0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border-armor)', borderRadius: '8px', maxWidth: '780px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: '0 12px 36px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: '12px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-platinum-pure)' }}>Edit Task Specification</h2>
                <small style={{ color: 'var(--color-pewter)' }}>Configure technical deliverables, execution bounds, and validation gates</small>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsEditOpen(false)}><X size={18} /></Button>
            </div>

            {/* Section tabs */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', borderBottom: '1px solid var(--color-border-subtle)', paddingBottom: '8px' }}>
              <Button
                variant={activeEditTab === 'core' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveEditTab('core')}
              >
                1. Core & Assignment
              </Button>
              <Button
                variant={activeEditTab === 'execution' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveEditTab('execution')}
              >
                2. Execution & Tools
              </Button>
              <Button
                variant={activeEditTab === 'criteria' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setActiveEditTab('criteria')}
              >
                3. Deliverables & Validation
              </Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); updateTask.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {activeEditTab === 'core' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Task Title *</label>
                    <input
                      type="text"
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Priority Level</label>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value)}
                        style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Assigned Engineer</label>
                      <select
                        value={editAssigneeId}
                        onChange={(e) => setEditAssigneeId(e.target.value)}
                        style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                      >
                        <option value="">Unassigned</option>
                        {membersQuery.data?.map((m) => (
                          <option key={m.id} value={m.id}>{m.name} ({m.specialization || 'Engineer'})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Scope & Description *</label>
                    <textarea
                      rows={4}
                      required
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>
                </>
              )}

              {activeEditTab === 'execution' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Implementation Steps</label>
                    <textarea
                      rows={3}
                      value={editImplementationSteps}
                      onChange={(e) => setEditImplementationSteps(e.target.value)}
                      placeholder="Step-by-step procedures for development..."
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Prerequisites & Environment</label>
                      <textarea
                        rows={2}
                        value={editPrerequisites}
                        onChange={(e) => setEditPrerequisites(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Required Inputs</label>
                      <textarea
                        rows={2}
                        value={editInputs}
                        onChange={(e) => setEditInputs(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Required Tools</label>
                      <input
                        type="text"
                        value={editRequiredTools}
                        onChange={(e) => setEditRequiredTools(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Expected Outputs</label>
                      <input
                        type="text"
                        value={editExpectedOutputs}
                        onChange={(e) => setEditExpectedOutputs(e.target.value)}
                        style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                </>
              )}

              {activeEditTab === 'criteria' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Deliverables *</label>
                    <textarea
                      rows={2}
                      value={editDeliverables}
                      onChange={(e) => setEditDeliverables(e.target.value)}
                      placeholder="Tangible code, circuits, or documented artifacts produced..."
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Acceptance Criteria *</label>
                    <textarea
                      rows={3}
                      required
                      value={editAcceptanceCriteria}
                      onChange={(e) => setEditAcceptanceCriteria(e.target.value)}
                      placeholder="Rigorous conditions that must be completely satisfied..."
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Validation Procedure *</label>
                    <textarea
                      rows={2}
                      required
                      value={editValidationProcedure}
                      onChange={(e) => setEditValidationProcedure(e.target.value)}
                      placeholder="Exact test commands or hardware bench testing procedures..."
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>Evidence Requirements *</label>
                    <input
                      type="text"
                      required
                      value={editEvidenceRequirements}
                      onChange={(e) => setEditEvidenceRequirements(e.target.value)}
                      placeholder="e.g., Pull request URL, oscilloscope screen capture, or CI test run"
                      style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '12px' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-pewter)' }}>
                  <Shield size={12} style={{ display: 'inline', marginRight: '4px' }} /> Changes logged to immutable audit ledger
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={updateTask.isPending}>Save changes</Button>
                </div>
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
