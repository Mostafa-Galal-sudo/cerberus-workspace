import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Edit3,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel, StatusBadge } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface Member {
  id: string;
  name: string;
  email: string;
  specialization: string;
  bio?: string;
  status: 'active' | 'invited' | 'suspended';
  roles: string;
  domainName?: string;
  taskTotal?: number;
  taskApproved?: number;
  lastActivityAt?: number;
  createdAt: number;
}

interface CheckpointItem {
  id: string;
  title: string;
  description: string;
  requiredDeliverable: string;
  acceptanceCriteria: string;
  evidenceRequirements: string;
  validationProcedure: string;
  mandatory: number;
  status: string;
  approvedAt?: number;
  milestoneTitle: string;
  domainName: string;
}

interface RoadmapData {
  member: { id: string; name: string; specialization: string };
  checkpoints: CheckpointItem[];
  tasks: Array<{ id: string; title: string; priority: string; status: string; approvedAt?: number; checkpointId?: string }>;
}

const ROLE_OPTIONS = [
  { value: 'team_member', label: 'Team member', description: 'Work on assigned tasks and submit evidence.' },
  { value: 'technical_lead', label: 'Technical lead', description: 'Technical leadership designation.' },
  { value: 'project_supervisor', label: 'Project supervisor', description: 'Read-only academic supervision and feedback.' },
  { value: 'super_admin', label: 'Super admin', description: 'Full workspace administration and independent review.' },
];

export function MembersPage() {
  const { user } = useAuth();
  const { mode } = useOutletContext<{ mode: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedMemberId = searchParams.get('selected');
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'profile' | 'roadmap' | 'feedback'>('profile');
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingRoles, setEditingRoles] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [editName, setEditName] = useState('');
  const [editSpecialization, setEditSpecialization] = useState('');
  const [editBio, setEditBio] = useState('');
  const [reissuedUrl, setReissuedUrl] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const isAdmin = user?.roles.includes('super_admin') && mode === 'admin';
  const isSupervisor = user?.roles.includes('project_supervisor') || mode === 'supervisor';

  const membersQuery = useQuery({
    queryKey: ['members'],
    queryFn: () => api<Member[]>('/users'),
  });

  const selectedMember = membersQuery.data?.find((m) => m.id === selectedMemberId) ?? membersQuery.data?.[0];

  const roadmapQuery = useQuery({
    queryKey: ['roadmap', selectedMember?.id],
    queryFn: () => api<RoadmapData>(`/users/roadmaps/member/${selectedMember?.id}`),
    enabled: Boolean(selectedMember?.id),
  });

  const feedbackQuery = useQuery({
    queryKey: ['supervisor-feedback', selectedMember?.id],
    queryFn: () => api<Array<{ id: string; supervisorName: string; body: string; createdAt: number }>>(`/workspace/supervisor/feedback/${selectedMember?.id}`),
    enabled: Boolean(selectedMember?.id && (isAdmin || isSupervisor)),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: 'active' | 'suspended' }) =>
      api(`/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => {
      setActionMessage('Account status successfully modified.');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => setActionMessage(err instanceof ApiError ? err.message : 'Status update failed'),
  });

  const reissueInvite = useMutation({
    mutationFn: (id: string) => api<{ activationUrl: string }>(`/users/${id}/reissue-invitation`, { method: 'POST' }),
    onSuccess: (res) => {
      setReissuedUrl(`${window.location.origin}${res.activationUrl}`);
      setResetUrl(null);
      setActionMessage('New invitation link generated.');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => setActionMessage(err instanceof ApiError ? err.message : 'Invitation reissue failed'),
  });

  const issuePasswordReset = useMutation({
    mutationFn: (id: string) => api<{ resetUrl: string; expiresAt: number }>(`/users/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (res) => {
      setResetUrl(`${window.location.origin}${res.resetUrl}`);
      setReissuedUrl(null);
      setActionMessage('One-time password reset link generated.');
    },
    onError: (err) => setActionMessage(err instanceof ApiError ? err.message : 'Password reset link generation failed'),
  });

  const updateProfile = useMutation({
    mutationFn: (id: string) =>
      api(`/users/${id}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({ displayName: editName, specialization: editSpecialization, bio: editBio }),
      }),
    onSuccess: () => {
      setEditingProfile(false);
      setActionMessage('Member profile updated.');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => setActionMessage(err instanceof ApiError ? err.message : 'Profile update failed'),
  });

  const updateRoles = useMutation({
    mutationFn: (id: string) =>
      api(`/users/${id}/roles`, {
        method: 'PATCH',
        body: JSON.stringify({ roles: selectedRoles }),
      }),
    onSuccess: () => {
      setEditingRoles(false);
      setActionMessage('Access roles updated. Permission changes apply immediately.');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
    },
    onError: (err) => setActionMessage(err instanceof ApiError ? err.message : 'Role update failed'),
  });

  const submitFeedback = useMutation({
    mutationFn: () =>
      api(`/workspace/supervisor/feedback/${selectedMember?.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: feedbackBody }),
      }),
    onSuccess: () => {
      setFeedbackBody('');
      setActionMessage('Supervisor guidance recorded and dispatched.');
      void queryClient.invalidateQueries({ queryKey: ['supervisor-feedback', selectedMember?.id] });
    },
    onError: (err) => setActionMessage(err instanceof ApiError ? err.message : 'Feedback submission failed'),
  });

  const filteredMembers = (membersQuery.data ?? []).filter((m) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return m.name.toLowerCase().includes(term) || m.email.toLowerCase().includes(term) || (m.specialization && m.specialization.toLowerCase().includes(term));
  });

  if (membersQuery.isLoading) return <PageSkeleton />;
  if (membersQuery.isError || !membersQuery.data) return <EmptyState title="Directory unavailable" body="Unable to retrieve member accounts." />;

  const handleSelectMember = (id: string) => {
    setSearchParams({ selected: id });
    setReissuedUrl(null);
    setResetUrl(null);
    setActionMessage(null);
    setEditingProfile(false);
    setEditingRoles(false);
  };

  const handleStartEdit = () => {
    if (!selectedMember) return;
    setEditName(selectedMember.name);
    setEditSpecialization(selectedMember.specialization || '');
    setEditBio(selectedMember.bio || '');
    setEditingProfile(true);
  };

  const handleStartRoleEdit = () => {
    if (!selectedMember) return;
    setSelectedRoles(selectedMember.roles.split(',').filter(Boolean));
    setEditingRoles(true);
  };

  const toggleRole = (role: string) => {
    setSelectedRoles((current) => current.includes(role) ? current.filter((value) => value !== role) : [...current, role]);
  };

  const copyInvite = () => {
    if (!reissuedUrl) return;
    navigator.clipboard.writeText(reissuedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const copyReset = () => {
    if (!resetUrl) return;
    navigator.clipboard.writeText(resetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="page members-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">{isSupervisor ? 'Academic Supervision' : 'Identity & Discipline Roster'}</span>
          <h1>{isSupervisor ? 'Discipline Progress & Member Audit' : 'Engineering Directory'}</h1>
          <p>
            {isSupervisor
              ? 'Independent supervisory review of verified member milestones and direct academic feedback.'
              : 'Six dedicated engineering disciplines, access roles, and continuous verified delivery.'}
          </p>
        </div>
      </header>

      {actionMessage && (
        <div className="status-notice" style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionMessage}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionMessage(null)}>Dismiss</Button>
        </div>
      )}

      <div className="members-layout">
        {/* Left Column: Member Roster */}
        <Panel className="member-list-panel">
          <div className="search-bar" style={{ marginBottom: '16px' }}>
            <label className="search-box" style={{ width: '100%' }}>
              <Search size={16} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search member or domain..."
              />
            </label>
          </div>

          <div className="member-cards-stack" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredMembers.map((member) => {
              const isSelected = selectedMember?.id === member.id;
              const percent = member.taskTotal ? Math.round(((member.taskApproved ?? 0) / member.taskTotal) * 100) : 0;
              return (
                <button
                  type="button"
                  key={member.id}
                  onClick={() => handleSelectMember(member.id)}
                  className={`member-select-card ${isSelected ? 'active' : ''}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '12px',
                    textAlign: 'left',
                    background: isSelected ? 'var(--color-surface-hover)' : 'var(--color-surface)',
                    border: `1px solid ${isSelected ? 'var(--color-border-accent)' : 'var(--color-border)'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="avatar small" style={{ fontWeight: 600 }}>
                        {member.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                      </span>
                      <div>
                        <strong style={{ display: 'block', fontSize: '0.9rem' }}>{member.name}</strong>
                        <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>{member.specialization || 'Member'}</small>
                      </div>
                    </div>
                    <StatusBadge status={member.status} />
                  </div>

                  {member.taskTotal !== undefined && member.taskTotal > 0 && (
                    <div style={{ marginTop: '4px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-muted)', marginBottom: '2px' }}>
                        <span>Roadmap completion</span>
                        <strong>{percent}% ({member.taskApproved}/{member.taskTotal})</strong>
                      </div>
                      <div className="progress-track" style={{ height: '4px' }}>
                        <i style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Right Column: Member Inspector */}
        {selectedMember ? (
          <Panel className="member-detail-panel">
            <header className="member-detail-header">
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <span className="avatar" style={{ width: '48px', height: '48px', fontSize: '1.1rem' }}>
                  {selectedMember.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </span>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{selectedMember.name}</h2>
                  <p style={{ margin: '2px 0 0', color: 'var(--color-muted)', fontSize: '0.85rem', wordBreak: 'break-word' }}>{selectedMember.email}</p>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {selectedMember.roles.split(',').map((role) => (
                      <span key={role} className="role-chip" style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                        {role.replace('_', ' ')}
                      </span>
                    ))}
                    <StatusBadge status={selectedMember.status} />
                  </div>
                </div>
              </div>

              {/* Administrative actions */}
              <div className="member-detail-actions">
                {(isAdmin || user?.id === selectedMember.id) && !editingProfile && (
                  <Button variant="secondary" size="sm" onClick={handleStartEdit}>
                    <Edit3 size={14} /> Edit profile
                  </Button>
                )}

                {isAdmin && !editingRoles && (
                  <Button variant="secondary" size="sm" onClick={handleStartRoleEdit}>
                    <ShieldCheck size={14} /> Roles
                  </Button>
                )}

                {isAdmin && selectedMember.id !== user?.id && (
                  <>
                    <Button
                      variant={selectedMember.status === 'suspended' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() =>
                        toggleStatus.mutate({
                          id: selectedMember.id,
                          nextStatus: selectedMember.status === 'suspended' ? 'active' : 'suspended',
                        })
                      }
                      disabled={toggleStatus.isPending}
                    >
                      {selectedMember.status === 'suspended' ? <UserCheck size={14} /> : <UserX size={14} />}
                      {selectedMember.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => reissueInvite.mutate(selectedMember.id)}
                      disabled={reissueInvite.isPending}
                    >
                      <RefreshCw size={14} /> Reissue activation
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => issuePasswordReset.mutate(selectedMember.id)}
                      disabled={issuePasswordReset.isPending}
                    >
                      <KeyRound size={14} /> Reset password
                    </Button>
                  </>
                )}
              </div>
            </header>

            {reissuedUrl && (
              <div style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-cyan-sentinel)', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
                <strong style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-cyan-sentinel)', marginBottom: '4px' }}>
                  Secure Activation URL
                </strong>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={reissuedUrl}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                  <Button variant="secondary" size="sm" onClick={copyInvite}>
                    <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <small style={{ color: 'var(--color-muted)', display: 'block', marginTop: '4px' }}>
                  Valid for 7 days. Once activated, the member sets their permanent password.
                </small>
              </div>
            )}

            {resetUrl && (
              <div style={{ background: 'var(--color-surface-hover)', border: '1px solid var(--color-cyan-sentinel)', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
                <strong style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-cyan-sentinel)', marginBottom: '4px' }}>
                  One-Time Password Reset URL
                </strong>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={resetUrl}
                    style={{ flex: 1, padding: '6px 8px', fontSize: '0.8rem', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                  <Button variant="secondary" size="sm" onClick={copyReset}>
                    <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <small style={{ color: 'var(--color-muted)', display: 'block', marginTop: '4px' }}>
                  Valid for 1 hour and single-use. Delivering this link revokes every active session after the password is replaced.
                </small>
              </div>
            )}

            {/* Editing form */}
            {editingProfile && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateProfile.mutate(selectedMember.id);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px', padding: '16px', background: 'var(--color-surface-subtle)', borderRadius: '6px', border: '1px solid var(--color-border)' }}
              >
                <h3>Edit member record</h3>
                <label>
                  <small>Display Name</small>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                </label>
                <label>
                  <small>Engineering Specialization</small>
                  <input
                    type="text"
                    value={editSpecialization}
                    onChange={(e) => setEditSpecialization(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                </label>
                <label>
                  <small>Bio / Discipline Scope</small>
                  <textarea
                    rows={3}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                  />
                </label>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <Button type="button" variant="ghost" onClick={() => setEditingProfile(false)}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={updateProfile.isPending}>Save changes</Button>
                </div>
              </form>
            )}

            {/* Role editor */}
            {editingRoles && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  updateRoles.mutate(selectedMember.id);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px', padding: '16px', background: 'var(--color-surface-subtle)', borderRadius: '6px', border: '1px solid var(--color-border)' }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>Access roles</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                    Role changes apply immediately, including to existing sessions. The final super-admin cannot be removed.
                  </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' }}>
                  {ROLE_OPTIONS.map((role) => (
                    <label
                      key={role.value}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px', background: 'var(--color-surface)', border: `1px solid ${selectedRoles.includes(role.value) ? 'var(--color-border-accent)' : 'var(--color-border)'}`, borderRadius: '4px', cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles.includes(role.value)}
                        onChange={() => toggleRole(role.value)}
                        style={{ marginTop: '3px' }}
                      />
                      <span>
                        <strong style={{ display: 'block', fontSize: '0.85rem' }}>{role.label}</strong>
                        <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>{role.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {selectedRoles.length === 0 && <div className="form-error">At least one role is required.</div>}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <Button type="button" variant="ghost" onClick={() => setEditingRoles(false)}>Cancel</Button>
                  <Button type="submit" variant="primary" disabled={updateRoles.isPending || selectedRoles.length === 0}>Save roles</Button>
                </div>
              </form>
            )}

            {/* Navigation Tabs */}
            <div className="tab-row member-tabs">
              <button
                type="button"
                className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
                onClick={() => setActiveTab('profile')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'profile' ? '2px solid var(--color-cyan-sentinel)' : '2px solid transparent',
                  padding: '8px 16px',
                  color: activeTab === 'profile' ? 'var(--color-text)' : 'var(--color-muted)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Profile & Details
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === 'roadmap' ? 'active' : ''}`}
                onClick={() => setActiveTab('roadmap')}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'roadmap' ? '2px solid var(--color-cyan-sentinel)' : '2px solid transparent',
                  padding: '8px 16px',
                  color: activeTab === 'roadmap' ? 'var(--color-text)' : 'var(--color-muted)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Discipline Roadmap ({roadmapQuery.data?.checkpoints.length ?? 0} Checkpoints)
              </button>
              {(isSupervisor || isAdmin) && (
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'feedback' ? 'active' : ''}`}
                  onClick={() => setActiveTab('feedback')}
                  style={{
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === 'feedback' ? '2px solid var(--color-cyan-sentinel)' : '2px solid transparent',
                    padding: '8px 16px',
                    color: activeTab === 'feedback' ? 'var(--color-text)' : 'var(--color-muted)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Supervisor Guidance & Feedback
                </button>
              )}
            </div>

            {/* Tab 1: Profile */}
            {activeTab === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div className="info-block" style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '4px' }}>
                    <small style={{ color: 'var(--color-muted)' }}>Specialization</small>
                    <strong style={{ display: 'block', marginTop: '4px' }}>{selectedMember.specialization || 'Cross-disciplinary'}</strong>
                  </div>
                  <div className="info-block" style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '4px' }}>
                    <small style={{ color: 'var(--color-muted)' }}>Registered</small>
                    <strong style={{ display: 'block', marginTop: '4px' }}>{formatDate(selectedMember.createdAt)}</strong>
                  </div>
                  <div className="info-block" style={{ background: 'var(--color-surface-subtle)', padding: '12px', borderRadius: '4px' }}>
                    <small style={{ color: 'var(--color-muted)' }}>Last Activity</small>
                    <strong style={{ display: 'block', marginTop: '4px' }}>{formatDate(selectedMember.lastActivityAt)}</strong>
                  </div>
                </div>

                {selectedMember.bio && (
                  <div>
                    <h4 style={{ margin: '0 0 6px', fontSize: '0.9rem', color: 'var(--color-muted)' }}>Engineering Scope</h4>
                    <p style={{ margin: 0, lineHeight: 1.6 }}>{selectedMember.bio}</p>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Roadmap */}
            {activeTab === 'roadmap' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {roadmapQuery.isLoading ? (
                  <PageSkeleton />
                ) : roadmapQuery.data?.checkpoints.length ? (
                  <div className="checkpoints-timeline" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {roadmapQuery.data.checkpoints.map((cp, idx) => {
                      const linkedTask = roadmapQuery.data?.tasks.find((t) => t.checkpointId === cp.id || t.title.includes(cp.title));
                      const isApproved = cp.status === 'approved';
                      return (
                        <div
                          key={cp.id}
                          className="checkpoint-card"
                          style={{
                            padding: '14px',
                            background: 'var(--color-surface-subtle)',
                            borderLeft: `4px solid ${isApproved ? 'var(--color-status-approved)' : 'var(--color-border)'}`,
                            borderRadius: '4px',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)', fontWeight: 600 }}>
                                  STAGE {idx + 1}
                                </span>
                                <span style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>· {cp.milestoneTitle}</span>
                              </div>
                              <h4 style={{ margin: 0, fontSize: '1rem' }}>{cp.title}</h4>
                            </div>
                            <StatusBadge status={cp.status} />
                          </div>

                          <p style={{ margin: '8px 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>{cp.description}</p>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px', fontSize: '0.75rem', marginTop: '10px', background: 'var(--color-surface)', padding: '8px', borderRadius: '4px' }}>
                            <div>
                              <strong style={{ color: 'var(--color-muted)' }}>Deliverable:</strong>
                              <span style={{ display: 'block', marginTop: '2px' }}>{cp.requiredDeliverable}</span>
                            </div>
                            <div>
                              <strong style={{ color: 'var(--color-muted)' }}>Acceptance:</strong>
                              <span style={{ display: 'block', marginTop: '2px' }}>{cp.acceptanceCriteria}</span>
                            </div>
                          </div>

                          {linkedTask && (
                            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <Link to={`/tasks/${linkedTask.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--color-cyan-sentinel)' }}>
                                <ExternalLink size={13} /> View task: {linkedTask.title}
                              </Link>
                              {cp.approvedAt && (
                                <small style={{ color: 'var(--color-status-approved)' }}>
                                  Approved {formatDate(cp.approvedAt)}
                                </small>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState title="No assigned roadmap" body="This member does not currently have assigned discipline checkpoints." />
                )}
              </div>
            )}

            {/* Tab 3: Supervisor Feedback */}
            {(isSupervisor || isAdmin) && activeTab === 'feedback' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {isSupervisor && (
                  <div style={{ background: 'var(--color-surface-subtle)', padding: '16px', borderRadius: '6px', border: '1px solid var(--color-border)' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Issue Supervisory Guidance</h3>
                    <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                      Supervisor feedback is recorded immutably and notifies the discipline engineer immediately.
                    </p>
                    <textarea
                      rows={4}
                      value={feedbackBody}
                      onChange={(e) => setFeedbackBody(e.target.value)}
                      placeholder="Provide actionable guidance, academic recommendations, or validation critique..."
                      style={{ width: '100%', padding: '10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '8px' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => submitFeedback.mutate()}
                        disabled={submitFeedback.isPending || feedbackBody.trim().length < 3}
                      >
                        Submit Supervisory Record
                      </Button>
                    </div>
                  </div>
                )}

                <h4 style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>Feedback Record</h4>
                {feedbackQuery.isLoading ? (
                  <PageSkeleton />
                ) : feedbackQuery.data?.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {feedbackQuery.data.map((fb) => (
                      <div key={fb.id} style={{ padding: '12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <strong style={{ fontSize: '0.85rem' }}>{fb.supervisorName}</strong>
                          <small style={{ color: 'var(--color-muted)' }}>{formatDate(fb.createdAt)}</small>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>{fb.body}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="No feedback logged" body="No supervisor feedback has been recorded for this member yet." />
                )}
              </div>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
