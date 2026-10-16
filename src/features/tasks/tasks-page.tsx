import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Kanban as KanbanIcon,
  List,
  Milestone,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, ApiError } from '../../lib/api';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  assigneeId?: string;
  assigneeName?: string;
  domainName?: string;
  domainId?: string;
  checklistTotal: number;
  checklistDone: number;
  dependencyCount?: number;
  updatedAt: number;
}

interface Checkpoint {
  id: string;
  title: string;
  description: string;
  requiredDeliverable: string;
  acceptanceCriteria: string;
  status: string;
  approvedAt?: number;
  milestoneTitle: string;
  domainName: string;
  ownerName: string;
  taskCount: number;
  approvedTaskCount: number;
}

interface MemberOption {
  id: string;
  name: string;
  specialization: string;
}

const KANBAN_COLUMNS: Array<{ id: string; label: string; icon: typeof Clock }> = [
  { id: 'backlog', label: 'Backlog', icon: List },
  { id: 'in_progress', label: 'In Progress', icon: Clock },
  { id: 'blocked', label: 'Blocked', icon: AlertTriangle },
  { id: 'ready_for_review', label: 'In Review', icon: Clock },
  { id: 'changes_requested', label: 'Revisions', icon: ShieldAlert },
  { id: 'approved', label: 'Approved & Verified', icon: CheckCircle2 },
];

export function TasksPage() {
  const { user } = useAuth();
  const { mode } = useOutletContext<{ mode: string }>();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'checkpoints'>('kanban');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create Task Form State
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [newAcceptanceCriteria, setNewAcceptanceCriteria] = useState('');
  const [newValidationProcedure, setNewValidationProcedure] = useState('');
  const [newEvidenceRequirements, setNewEvidenceRequirements] = useState('');
  const [newPrerequisites, setNewPrerequisites] = useState('');
  const [newInputs, setNewInputs] = useState('');
  const [newImplementationSteps, setNewImplementationSteps] = useState('');
  const [newRequiredTools, setNewRequiredTools] = useState('');
  const [newDeliverables, setNewDeliverables] = useState('');

  const isAdmin = user?.roles.includes('super_admin') && mode === 'admin';

  const tasksQuery = useQuery({
    queryKey: ['tasks', mode, statusFilter, search],
    queryFn: () =>
      api<Task[]>(
        `/tasks?limit=100&mine=${mode === 'member'}${statusFilter ? `&status=${statusFilter}` : ''}${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`
      ),
  });

  const checkpointsQuery = useQuery({
    queryKey: ['checkpoints'],
    queryFn: () => api<Checkpoint[]>('/tasks/checkpoints'),
    enabled: viewMode === 'checkpoints',
  });

  const membersQuery = useQuery({
    queryKey: ['members-short'],
    queryFn: () => api<MemberOption[]>('/users'),
    enabled: isCreateOpen,
  });

  const updateStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      api(`/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Status transition failed'),
  });

  const createTask = useMutation({
    mutationFn: () =>
      api('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'project_cerberus',
          assigneeId: newAssigneeId || null,
          title: newTitle,
          description: newDescription,
          priority: newPriority,
          acceptanceCriteria: newAcceptanceCriteria,
          validationProcedure: newValidationProcedure,
          evidenceRequirements: newEvidenceRequirements,
          prerequisites: newPrerequisites,
          inputs: newInputs,
          implementationSteps: newImplementationSteps,
          requiredTools: newRequiredTools,
          deliverables: newDeliverables,
        }),
      }),
    onSuccess: () => {
      setIsCreateOpen(false);
      resetCreateForm();
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Task creation failed'),
  });

  const resetCreateForm = () => {
    setNewTitle('');
    setNewDescription('');
    setNewPriority('medium');
    setNewAssigneeId('');
    setNewAcceptanceCriteria('');
    setNewValidationProcedure('');
    setNewEvidenceRequirements('');
    setNewPrerequisites('');
    setNewInputs('');
    setNewImplementationSteps('');
    setNewRequiredTools('');
    setNewDeliverables('');
  };

  return (
    <div className="page tasks-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Execution & Verification</span>
          <h1>Engineering Tasks & Roadmaps</h1>
          <p>Verified technical progress across six autonomous disciplines with evidence-gated completion.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus size={16} /> Define new task
            </Button>
          )}
        </div>
      </header>

      {actionError && (
        <div style={{ padding: '10px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--color-status-blocked)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-status-blocked)', fontSize: '0.85rem' }}>{actionError}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionError(null)}>Dismiss</Button>
        </div>
      )}

      {/* View Switcher and Filters Toolbar */}
      <Panel className="task-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, minWidth: '280px' }}>
          <label className="search-box" style={{ flex: 1 }}>
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by title or criteria..."
            />
          </label>

          {viewMode !== 'checkpoints' && (
            <label className="select-box">
              <SlidersHorizontal size={16} />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All statuses</option>
                <option value="backlog">Backlog</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="ready_for_review">In review</option>
                <option value="changes_requested">Revisions requested</option>
                <option value="approved">Approved</option>
              </select>
            </label>
          )}
        </div>

        <div className="view-toggle" style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-subtle)', padding: '3px', borderRadius: '6px' }}>
          <Button
            variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('kanban')}
            title="Kanban Board"
          >
            <KanbanIcon size={15} /> Board
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            title="Detailed List"
          >
            <List size={15} /> List
          </Button>
          <Button
            variant={viewMode === 'checkpoints' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('checkpoints')}
            title="Checkpoints & Milestones"
          >
            <Milestone size={15} /> Milestones
          </Button>
        </div>
      </Panel>

      {/* Main Content Area */}
      {viewMode === 'kanban' && (
        <div className="kanban-board-container" style={{ overflowX: 'auto', paddingBottom: '16px' }}>
          {tasksQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="kanban-columns-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(280px, 320px))', gap: '16px', alignItems: 'start' }}>
              {KANBAN_COLUMNS.map((column) => {
                const columnTasks = (tasksQuery.data ?? []).filter((t) => t.status === column.id);
                const Icon = column.icon;
                return (
                  <div
                    key={column.id}
                    className="kanban-column"
                    style={{
                      background: 'var(--color-surface-subtle)',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      minHeight: '400px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Icon size={15} style={{ color: 'var(--color-cyan-sentinel)' }} />
                        <strong style={{ fontSize: '0.85rem' }}>{column.label}</strong>
                      </div>
                      <span style={{ fontSize: '0.75rem', background: 'var(--color-surface)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                        {columnTasks.length}
                      </span>
                    </div>

                    <div className="kanban-task-stack" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {columnTasks.map((task) => (
                        <div
                          key={task.id}
                          className="kanban-card"
                          style={{
                            background: 'var(--color-surface)',
                            border: '1px solid var(--color-border)',
                            borderRadius: '6px',
                            padding: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                            transition: 'border-color 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <span className={`priority-line priority-${task.priority}`} style={{ width: '4px', height: '16px', borderRadius: '2px', display: 'inline-block' }} />
                            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>{task.domainName ?? 'Core'}</span>
                          </div>

                          <Link to={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                            <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '4px', lineHeight: 1.4 }}>
                              {task.title}
                            </strong>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {task.description}
                            </p>
                          </Link>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="avatar small" style={{ width: '20px', height: '20px', fontSize: '0.65rem' }}>
                                {task.assigneeName ? task.assigneeName.slice(0, 2).toUpperCase() : '??'}
                              </span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                                {task.assigneeName ? task.assigneeName.split(' ')[0] : 'Unassigned'}
                              </span>
                            </div>

                            <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                              {task.checklistDone}/{task.checklistTotal} gates
                            </span>
                          </div>

                          {/* Quick transition action for assignee or admin */}
                          {(task.assigneeId === user?.id || isAdmin) && task.status !== 'approved' && task.status !== 'ready_for_review' && (
                            <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                              {task.status !== 'in_progress' && (
                                <button
                                  type="button"
                                  onClick={() => updateStatus.mutate({ taskId: task.id, status: 'in_progress' })}
                                  style={{ flex: 1, padding: '3px 6px', fontSize: '0.7rem', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', color: 'inherit' }}
                                >
                                  Work on task
                                </button>
                              )}
                              {task.status !== 'blocked' && (
                                <button
                                  type="button"
                                  onClick={() => updateStatus.mutate({ taskId: task.id, status: 'blocked' })}
                                  style={{ flex: 1, padding: '3px 6px', fontSize: '0.7rem', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '3px', cursor: 'pointer', color: 'var(--color-status-blocked)' }}
                                >
                                  Report blocked
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}

                      {columnTasks.length === 0 && (
                        <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.75rem' }}>
                          No tasks in this lane
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {tasksQuery.isLoading ? (
            <PageSkeleton />
          ) : tasksQuery.data?.length ? (
            <div className="task-table" role="table">
              <div className="task-table-head" role="row">
                <span>Work item</span>
                <span>Owner / discipline</span>
                <span>Verification gates</span>
                <span>Status</span>
              </div>
              {tasksQuery.data.map((task) => (
                <Link to={`/tasks/${task.id}`} className="task-table-row" role="row" key={task.id}>
                  <span>
                    <i className={`priority-line priority-${task.priority}`} />
                    <strong>{task.title}</strong>
                    <small>{task.description}</small>
                  </span>
                  <span>
                    <strong>{task.assigneeName ?? 'Unassigned'}</strong>
                    <small>{task.domainName ?? 'Cross-functional'}</small>
                  </span>
                  <span>
                    <strong>{task.checklistDone}/{task.checklistTotal}</strong>
                    <small>criteria satisfied</small>
                  </span>
                  <StatusBadge status={task.status} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="No tasks match" body="Adjust the status or search phrase to view other engineering tasks." />
          )}
        </>
      )}

      {/* Checkpoints & Milestones View */}
      {viewMode === 'checkpoints' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {checkpointsQuery.isLoading ? (
            <PageSkeleton />
          ) : checkpointsQuery.data?.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
              {checkpointsQuery.data.map((cp) => {
                return (
                  <Panel key={cp.id} className="checkpoint-overview-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)', fontWeight: 600 }}>
                          {cp.domainName}
                        </span>
                        <h3 style={{ margin: '2px 0 0', fontSize: '1rem' }}>{cp.title}</h3>
                      </div>
                      <StatusBadge status={cp.status} />
                    </div>

                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)' }}>{cp.description}</p>

                    <div style={{ background: 'var(--color-surface-subtle)', padding: '10px', borderRadius: '4px', fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div><strong>Deliverable:</strong> {cp.requiredDeliverable}</div>
                      <div><strong>Acceptance:</strong> {cp.acceptanceCriteria}</div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                        Assigned: <strong>{cp.ownerName}</strong>
                      </span>
                      <span style={{ fontSize: '0.75rem' }}>
                        Tasks: <strong>{cp.approvedTaskCount}/{cp.taskCount} approved</strong>
                      </span>
                    </div>
                  </Panel>
                );
              })}
            </div>
          ) : (
            <EmptyState title="No checkpoints loaded" body="Checkpoints will appear once roadmaps are initialized." />
          )}
        </div>
      )}

      {/* Task Creation Modal */}
      {isCreateOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '720px', width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--color-border)', paddingBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Define Engineering Task</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); createTask.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label>
                <small>Task Title *</small>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Implement Hardware SPI Communication Module"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label>
                  <small>Priority *</small>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as 'low' | 'medium' | 'high' | 'critical')}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  >
                    <option value="low">Low priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="high">High priority</option>
                    <option value="critical">Critical path</option>
                  </select>
                </label>

                <label>
                  <small>Assign Discipline Engineer</small>
                  <select
                    value={newAssigneeId}
                    onChange={(e) => setNewAssigneeId(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                  >
                    <option value="">Unassigned</option>
                    {membersQuery.data?.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} ({m.specialization || 'Member'})</option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                <small>Scope & Description *</small>
                <textarea
                  rows={3}
                  required
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Detailed technical description of this engineering task..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Acceptance Criteria * (Minimum 10 characters)</small>
                <textarea
                  rows={2}
                  required
                  value={newAcceptanceCriteria}
                  onChange={(e) => setNewAcceptanceCriteria(e.target.value)}
                  placeholder="The concrete measurable criteria required for approval..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Validation Procedure * (Minimum 10 characters)</small>
                <textarea
                  rows={2}
                  required
                  value={newValidationProcedure}
                  onChange={(e) => setNewValidationProcedure(e.target.value)}
                  placeholder="Step-by-step instructions to reproduce and verify behavior..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Evidence Requirements *</small>
                <input
                  type="text"
                  required
                  value={newEvidenceRequirements}
                  onChange={(e) => setNewEvidenceRequirements(e.target.value)}
                  placeholder="e.g. GitHub Pull Request link, test logs, oscilloscope capture"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={createTask.isPending || !newTitle || !newDescription || newAcceptanceCriteria.length < 10 || newValidationProcedure.length < 10}>
                  {createTask.isPending ? 'Creating...' : 'Record Task Definition'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
