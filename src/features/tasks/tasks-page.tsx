import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  GripVertical,
  Kanban as KanbanIcon,
  List,
  Loader2,
  Milestone,
  MoreVertical,
  Plus,
  Search,
  Send,
  Shield,
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

type KanbanColumnId = 'todo' | 'in_progress' | 'submitted' | 'blocked';

const KANBAN_COLUMNS: Array<{
  id: KanbanColumnId;
  label: string;
  dbStatus: string;
  icon: typeof Clock;
  description: string;
}> = [
  { id: 'todo', label: 'To Do', dbStatus: 'backlog', icon: List, description: 'Backlog items ready to start' },
  { id: 'in_progress', label: 'In Progress', dbStatus: 'in_progress', icon: Clock, description: 'Active engineering work' },
  { id: 'submitted', label: 'Submitted', dbStatus: 'ready_for_review', icon: CheckCircle2, description: 'Pending administrative review' },
  { id: 'blocked', label: 'Blocked', dbStatus: 'blocked', icon: AlertTriangle, description: 'Blocked or revisions requested' },
];

function getTaskColumnId(status: string): KanbanColumnId | 'approved' {
  if (status === 'backlog') return 'todo';
  if (status === 'in_progress') return 'in_progress';
  if (status === 'ready_for_review') return 'submitted';
  if (status === 'blocked' || status === 'changes_requested') return 'blocked';
  if (status === 'approved') return 'approved';
  return 'todo';
}

export function TasksPage() {
  const { user } = useAuth();
  const { mode } = useOutletContext<{ mode: string }>();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'checkpoints'>('kanban');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showApprovedColumn, setShowApprovedColumn] = useState(false);

  // Drag and drop state
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [activeCardMenuId, setActiveCardMenuId] = useState<string | null>(null);

  // Quick submission modal state
  const [submittingTask, setSubmittingTask] = useState<Task | null>(null);
  const [submissionSummary, setSubmissionSummary] = useState('');
  const [submissionEvidence, setSubmissionEvidence] = useState('');
  const [submissionEvidenceLabel, setSubmissionEvidenceLabel] = useState('Verification evidence');
  const [submissionEvidenceKind, setSubmissionEvidenceKind] = useState<'url' | 'github' | 'note'>('url');
  const [submissionError, setSubmissionError] = useState<string | null>(null);

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
  const isSupervisor = user?.roles.includes('project_supervisor');
  const hasTaskWork = user?.permissions.includes('task.work');
  const hasTaskManage = user?.permissions.includes('task.manage');

  const canMoveTask = (task: Task) => {
    if (isSupervisor) return false;
    if (isAdmin || hasTaskManage) return true;
    if (hasTaskWork && task.assigneeId === user?.id) return true;
    return false;
  };

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
    onMutate: async ({ taskId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', mode, statusFilter, search]);
      if (previousTasks) {
        queryClient.setQueryData<Task[]>(
          ['tasks', mode, statusFilter, search],
          previousTasks.map((t) => (t.id === taskId ? { ...t, status } : t))
        );
      }
      setPendingTaskId(taskId);
      return { previousTasks };
    },
    onError: (err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', mode, statusFilter, search], context.previousTasks);
      }
      setActionError(err instanceof ApiError ? err.message : 'Status transition failed');
    },
    onSettled: () => {
      setPendingTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const submitTask = useMutation({
    mutationFn: ({
      taskId,
      summary,
      evidence,
    }: {
      taskId: string;
      summary: string;
      evidence: Array<{ kind: 'url' | 'github' | 'note'; label: string; value: string }>;
    }) =>
      api(`/tasks/${taskId}/submissions`, {
        method: 'POST',
        body: JSON.stringify({ summary, evidence }),
      }),
    onMutate: async ({ taskId }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', mode, statusFilter, search]);
      if (previousTasks) {
        queryClient.setQueryData<Task[]>(
          ['tasks', mode, statusFilter, search],
          previousTasks.map((t) => (t.id === taskId ? { ...t, status: 'ready_for_review' } : t))
        );
      }
      setPendingTaskId(taskId);
      return { previousTasks };
    },
    onSuccess: () => {
      setSubmittingTask(null);
      setSubmissionSummary('');
      setSubmissionEvidence('');
      setSubmissionError(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err, _variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', mode, statusFilter, search], context.previousTasks);
      }
      setSubmissionError(err instanceof ApiError ? err.message : 'Submission failed');
    },
    onSettled: () => {
      setPendingTaskId(null);
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
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

  const handleMoveTask = (task: Task, targetColumnId: KanbanColumnId | 'approved') => {
    setActiveCardMenuId(null);

    if (task.status === 'approved' && targetColumnId !== 'approved' && !isAdmin) {
      setActionError('Approved tasks are locked. Only a super-admin can modify approved work items.');
      return;
    }

    if (!canMoveTask(task)) {
      setActionError('Permission denied: You can only transition tasks assigned to you (supervisors have read-only access).');
      return;
    }

    if (targetColumnId === 'submitted') {
      if (task.checklistTotal > 0 && task.checklistDone < task.checklistTotal) {
        setActionError(
          `Cannot submit "${task.title}": All mandatory verification gates (${task.checklistDone}/${task.checklistTotal} completed) must be checked before submitting.`
        );
        return;
      }
      setSubmittingTask(task);
      setSubmissionSummary('');
      setSubmissionEvidence('');
      setSubmissionError(null);
      return;
    }

    if (targetColumnId === 'approved') {
      setActionError('Tasks cannot be approved directly via the Kanban board. Independent review approval is required.');
      return;
    }

    let targetDbStatus = 'backlog';
    if (targetColumnId === 'in_progress') targetDbStatus = 'in_progress';
    if (targetColumnId === 'blocked') targetDbStatus = 'blocked';

    if (task.status === targetDbStatus) return;

    updateStatus.mutate({ taskId: task.id, status: targetDbStatus });
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    if (!canMoveTask(task) || pendingTaskId) {
      e.preventDefault();
      return;
    }
    setDraggedTaskId(task.id);
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedTaskId(null);
    setDragOverColumnId(null);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== columnId) {
      setDragOverColumnId(columnId);
    }
  };

  const handleDragLeave = (e: React.DragEvent, columnId: string) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    if (dragOverColumnId === columnId) {
      setDragOverColumnId(null);
    }
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: KanbanColumnId) => {
    e.preventDefault();
    setDragOverColumnId(null);
    const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
    setDraggedTaskId(null);
    if (!taskId) return;

    const task = (tasksQuery.data ?? []).find((t) => t.id === taskId);
    if (!task) return;

    handleMoveTask(task, targetColumnId);
  };

  const allTasks = tasksQuery.data ?? [];
  const approvedTasks = allTasks.filter((t) => t.status === 'approved');

  return (
    <div className="page tasks-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Execution & Verification</span>
          <h1>Engineering Tasks & Roadmaps</h1>
          <p>Verified technical progress across six autonomous disciplines with evidence-gated completion.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isSupervisor && (
            <span style={{ fontSize: '0.75rem', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', padding: '4px 10px', borderRadius: '4px', color: 'var(--color-pewter)' }}>
              Supervisor View (Read-Only)
            </span>
          )}
          {isAdmin && (
            <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus size={16} /> Define new task
            </Button>
          )}
        </div>
      </header>

      {actionError && (
        <div style={{ padding: '10px 16px', background: 'var(--color-status-blocked-bg)', border: '1px solid var(--color-status-blocked-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                <option value="backlog">Backlog / To Do</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="ready_for_review">Submitted / In review</option>
                <option value="changes_requested">Revisions requested</option>
                <option value="approved">Approved</option>
              </select>
            </label>
          )}

          {viewMode === 'kanban' && approvedTasks.length > 0 && (
            <Button
              variant={showApprovedColumn ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowApprovedColumn(!showApprovedColumn)}
              title="Toggle approved tasks column"
            >
              <Check size={14} /> Approved ({approvedTasks.length})
            </Button>
          )}
        </div>

        <div className="view-toggle" style={{ display: 'flex', gap: '4px', background: 'var(--color-surface-subtle)', padding: '3px', borderRadius: '6px' }}>
          <Button
            variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('kanban')}
            title="Interactive Kanban Board"
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

      {/* Main Content Area: Kanban Board */}
      {viewMode === 'kanban' && (
        <div
          className="kanban-board-container"
          role="region"
          aria-label="Interactive Task Kanban Board"
        >
          {tasksQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="kanban-columns-grid">
              {KANBAN_COLUMNS.map((column) => {
                const columnTasks = allTasks.filter((t) => getTaskColumnId(t.status) === column.id);
                const Icon = column.icon;
                const isOver = dragOverColumnId === column.id;

                return (
                  <div
                    key={column.id}
                    className={`kanban-column ${isOver ? 'is-drop-target' : ''}`}
                    onDragOver={(e) => handleDragOver(e, column.id)}
                    onDragLeave={(e) => handleDragLeave(e, column.id)}
                    onDrop={(e) => handleDrop(e, column.id)}
                    role="list"
                    aria-label={`${column.label} column with ${columnTasks.length} tasks`}
                  >
                    <div className="kanban-column-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon size={16} style={{ color: 'var(--color-silver-light)' }} />
                        <div>
                          <strong style={{ fontSize: '0.9rem', color: 'var(--color-platinum-pure)' }}>{column.label}</strong>
                          <small style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-pewter)' }}>
                            {column.description}
                          </small>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.75rem', background: 'var(--color-surface-elevated)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border-armor)', color: 'var(--color-silver-light)' }}>
                        {columnTasks.length}
                      </span>
                    </div>

                    <div className="kanban-task-stack">
                      {columnTasks.map((task) => {
                        const isDragging = draggedTaskId === task.id;
                        const isPending = pendingTaskId === task.id;
                        const moveable = canMoveTask(task);
                        const isMenuOpen = activeCardMenuId === task.id;

                        return (
                          <div
                            key={task.id}
                            className={`kanban-card ${isDragging ? 'is-dragging' : ''} ${isPending ? 'is-pending' : ''} ${!moveable ? 'is-read-only' : ''}`}
                            draggable={moveable && !isPending}
                            onDragStart={(e) => handleDragStart(e, task)}
                            onDragEnd={handleDragEnd}
                            role="listitem"
                            tabIndex={0}
                            aria-label={`Task: ${task.title}, priority ${task.priority}, status ${task.status}`}
                          >
                            {/* Card Top: Priority, Domain, Drag Handle / Menu */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className={`priority-line priority-${task.priority}`} style={{ width: '4px', height: '14px', borderRadius: '2px', display: 'inline-block' }} />
                                <span style={{ fontSize: '0.7rem', color: 'var(--color-pewter)' }}>{task.domainName ?? 'Core'}</span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {isPending ? (
                                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-silver-mid)' }} />
                                ) : moveable ? (
                                  <div style={{ position: 'relative' }}>
                                    <button
                                      type="button"
                                      onClick={() => setActiveCardMenuId(isMenuOpen ? null : task.id)}
                                      title="Task actions & move menu"
                                      aria-label={`Actions for ${task.title}`}
                                      aria-expanded={isMenuOpen}
                                      style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--color-pewter)',
                                        cursor: 'pointer',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <MoreVertical size={14} />
                                    </button>

                                    {/* Accessible Move Menu Popover */}
                                    {isMenuOpen && (
                                      <div className="kanban-card-menu-popover" role="menu">
                                        <div style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--color-pewter)', borderBottom: '1px solid var(--color-border-subtle)', marginBottom: '2px' }}>
                                          Move task to:
                                        </div>
                                        {column.id !== 'todo' && (
                                          <button
                                            type="button"
                                            className="kanban-menu-item"
                                            role="menuitem"
                                            onClick={() => handleMoveTask(task, 'todo')}
                                          >
                                            <List size={13} /> To Do
                                          </button>
                                        )}
                                        {column.id !== 'in_progress' && (
                                          <button
                                            type="button"
                                            className="kanban-menu-item"
                                            role="menuitem"
                                            onClick={() => handleMoveTask(task, 'in_progress')}
                                          >
                                            <Clock size={13} /> In Progress
                                          </button>
                                        )}
                                        {column.id !== 'submitted' && (
                                          <button
                                            type="button"
                                            className="kanban-menu-item"
                                            role="menuitem"
                                            onClick={() => handleMoveTask(task, 'submitted')}
                                          >
                                            <Send size={13} /> Submit for Review
                                          </button>
                                        )}
                                        {column.id !== 'blocked' && (
                                          <button
                                            type="button"
                                            className="kanban-menu-item"
                                            role="menuitem"
                                            onClick={() => handleMoveTask(task, 'blocked')}
                                          >
                                            <AlertTriangle size={13} /> Report Blocked
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '0.65rem', color: 'var(--color-graphite-muted)' }} title="Assigned to another member">
                                    <Shield size={12} />
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Title & Description */}
                            <Link to={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                              <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: '4px', lineHeight: 1.4, color: 'var(--color-silver-light)' }}>
                                {task.title}
                              </strong>
                              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-pewter)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                {task.description}
                              </p>
                            </Link>

                            {/* Status badge if revisions requested or blocked */}
                            {task.status === 'changes_requested' && (
                              <div style={{ fontSize: '0.7rem', color: 'var(--color-status-blocked)', background: 'var(--color-status-blocked-bg)', border: '1px solid var(--color-status-blocked-border)', borderRadius: '3px', padding: '2px 6px' }}>
                                Revisions requested by reviewer
                              </div>
                            )}

                            {/* Card Bottom: Assignee, Checklist progress */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '8px', marginTop: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="avatar small" style={{ width: '20px', height: '20px', fontSize: '0.65rem' }}>
                                  {task.assigneeName ? task.assigneeName.slice(0, 2).toUpperCase() : '??'}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-silver-mid)' }}>
                                  {task.assigneeName ? task.assigneeName.split(' ')[0] : 'Unassigned'}
                                </span>
                              </div>

                              <span style={{ fontSize: '0.7rem', color: task.checklistTotal > 0 && task.checklistDone === task.checklistTotal ? 'var(--color-silver-light)' : 'var(--color-pewter)' }}>
                                {task.checklistDone}/{task.checklistTotal} gates
                              </span>
                            </div>

                            {/* Quick Action Button for assigned member */}
                            {moveable && !isPending && (
                              <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                                {column.id === 'todo' && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveTask(task, 'in_progress')}
                                    style={{ flex: 1, padding: '4px 6px', fontSize: '0.7rem', background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-armor)', borderRadius: '3px', cursor: 'pointer', color: 'inherit' }}
                                  >
                                    Start working &rarr;
                                  </button>
                                )}
                                {column.id === 'in_progress' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveTask(task, 'submitted')}
                                      style={{ flex: 1, padding: '4px 6px', fontSize: '0.7rem', background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-armor)', borderRadius: '3px', cursor: 'pointer', color: 'var(--color-silver-light)' }}
                                    >
                                      Submit evidence &rarr;
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleMoveTask(task, 'blocked')}
                                      style={{ padding: '4px 6px', fontSize: '0.7rem', background: 'transparent', border: '1px solid var(--color-border-subtle)', borderRadius: '3px', cursor: 'pointer', color: 'var(--color-status-blocked)' }}
                                      title="Mark as blocked"
                                    >
                                      Blocked
                                    </button>
                                  </>
                                )}
                                {column.id === 'blocked' && (
                                  <button
                                    type="button"
                                    onClick={() => handleMoveTask(task, 'in_progress')}
                                    style={{ flex: 1, padding: '4px 6px', fontSize: '0.7rem', background: 'var(--color-surface-hover)', border: '1px solid var(--color-border-armor)', borderRadius: '3px', cursor: 'pointer', color: 'inherit' }}
                                  >
                                    Resume work
                                  </button>
                                )}
                                {column.id === 'submitted' && (
                                  <span style={{ fontSize: '0.7rem', color: 'var(--color-pewter)', fontStyle: 'italic', textAlign: 'center', width: '100%', padding: '2px 0' }}>
                                    Awaiting admin review
                                  </span>
                                )}
                              </div>
                            )}

                            {moveable && (
                              <div style={{ display: 'flex', justifyContent: 'center', opacity: 0.35, marginTop: '-2px' }}>
                                <GripVertical size={12} />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {columnTasks.length === 0 && (
                        <div style={{ padding: '36px 12px', textAlign: 'center', color: 'var(--color-pewter)', fontSize: '0.75rem', border: '1px dashed var(--color-border-subtle)', borderRadius: '6px' }}>
                          No tasks in {column.label.toLowerCase()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Optional 5th column: Approved */}
              {showApprovedColumn && (
                <div
                  className="kanban-column"
                  role="list"
                  aria-label={`Approved column with ${approvedTasks.length} tasks`}
                  style={{ opacity: 0.9 }}
                >
                  <div className="kanban-column-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <CheckCircle2 size={16} style={{ color: 'var(--color-status-verified)' }} />
                      <div>
                        <strong style={{ fontSize: '0.9rem', color: 'var(--color-platinum-pure)' }}>Approved</strong>
                        <small style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-pewter)' }}>
                          Verified deliverables
                        </small>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.75rem', background: 'var(--color-surface-elevated)', padding: '2px 8px', borderRadius: '12px', border: '1px solid var(--color-border-armor)' }}>
                      {approvedTasks.length}
                    </span>
                  </div>

                  <div className="kanban-task-stack">
                    {approvedTasks.map((task) => (
                      <div
                        key={task.id}
                        className="kanban-card is-read-only"
                        role="listitem"
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-pewter)' }}>{task.domainName ?? 'Core'}</span>
                          <StatusBadge status="approved" />
                        </div>
                        <Link to={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                          <strong style={{ fontSize: '0.88rem', display: 'block', marginBottom: '4px', color: 'var(--color-silver-light)' }}>
                            {task.title}
                          </strong>
                        </Link>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '6px' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-silver-mid)' }}>{task.assigneeName}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-status-verified)' }}>✓ Verified</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Evidence Submission Modal */}
      {submittingTask && (
        <div
          className="modal-backdrop"
          style={{ position: 'fixed', inset: 0, background: 'rgba(5, 6, 8, 0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}
          role="dialog"
          aria-labelledby="submission-modal-title"
          aria-modal="true"
        >
          <div
            className="modal-card"
            style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border-chiseled)', borderRadius: '8px', maxWidth: '520px', width: '100%', padding: '24px', boxShadow: '0 12px 36px rgba(0,0,0,0.8)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border-armor)', paddingBottom: '12px' }}>
              <div>
                <h3 id="submission-modal-title" style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-platinum-pure)' }}>
                  Submit for Administrative Review
                </h3>
                <small style={{ color: 'var(--color-pewter)' }}>Evidence required before moving to Submitted status</small>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSubmittingTask(null)}>
                <X size={16} />
              </Button>
            </div>

            <div style={{ background: 'var(--color-surface-subtle)', padding: '10px 14px', borderRadius: '4px', marginBottom: '16px', border: '1px solid var(--color-border-subtle)' }}>
              <strong style={{ fontSize: '0.85rem', display: 'block', color: 'var(--color-silver-light)' }}>{submittingTask.title}</strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-pewter)' }}>All {submittingTask.checklistDone}/{submittingTask.checklistTotal} criteria satisfied</span>
            </div>

            {submissionError && (
              <div style={{ padding: '8px 12px', background: 'var(--color-status-blocked-bg)', border: '1px solid var(--color-status-blocked-border)', borderRadius: '4px', marginBottom: '14px', color: 'var(--color-status-blocked)', fontSize: '0.8rem' }}>
                {submissionError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (submissionSummary.trim().length < 20) {
                  setSubmissionError('Summary must be at least 20 characters long to provide actionable review context.');
                  return;
                }
                if (!submissionEvidence.trim()) {
                  setSubmissionError('Evidence link or artifact reference is required.');
                  return;
                }
                submitTask.mutate({
                  taskId: submittingTask.id,
                  summary: submissionSummary.trim(),
                  evidence: [
                    {
                      kind: submissionEvidenceKind,
                      label: submissionEvidenceLabel.trim() || 'Implementation evidence',
                      value: submissionEvidence.trim(),
                    },
                  ],
                });
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>
                  Summary of Implementation & Changes (min 20 characters) *
                </label>
                <textarea
                  value={submissionSummary}
                  onChange={(e) => setSubmissionSummary(e.target.value)}
                  placeholder="Detail the technical implementation, architecture decisions made, and test procedures executed..."
                  rows={3}
                  required
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.85rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '4px', color: 'var(--color-silver-mid)' }}>
                  Verification Evidence Type & Label *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', marginBottom: '8px' }}>
                  <select
                    value={submissionEvidenceKind}
                    onChange={(e) => setSubmissionEvidenceKind(e.target.value as 'url' | 'github' | 'note')}
                    style={{ padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.82rem' }}
                  >
                    <option value="url">Web URL</option>
                    <option value="github">GitHub PR/Commit</option>
                    <option value="note">Test Run Note</option>
                  </select>
                  <input
                    value={submissionEvidenceLabel}
                    onChange={(e) => setSubmissionEvidenceLabel(e.target.value)}
                    placeholder="Evidence label (e.g., CI Test Run, PR #42)"
                    style={{ padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.82rem' }}
                  />
                </div>

                <input
                  value={submissionEvidence}
                  onChange={(e) => setSubmissionEvidence(e.target.value)}
                  placeholder="Evidence URL, commit SHA, or verification record..."
                  required
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.82rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button variant="ghost" type="button" onClick={() => setSubmittingTask(null)}>
                  Cancel (Rollback)
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={submitTask.isPending || submissionSummary.trim().length < 20 || !submissionEvidence.trim()}
                >
                  {submitTask.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Confirm Submission
                </Button>
              </div>
            </form>
          </div>
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
