import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Megaphone,
  Plus,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: 'all' | 'members' | 'supervisors' | 'admins';
  publishedAt: number;
  expiresAt?: number | null;
  authorName: string;
  readAt?: number | null;
}

export function AnnouncementsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newAudience, setNewAudience] = useState<'all' | 'members' | 'supervisors' | 'admins'>('all');
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const isAdmin = user?.roles.includes('super_admin');

  const query = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api<Announcement[]>('/collaboration/announcements'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/collaboration/announcements/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
  });

  const createAnnouncement = useMutation({
    mutationFn: () =>
      api('/collaboration/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle,
          body: newBody,
          audience: newAudience,
          published: true,
        }),
      }),
    onSuccess: () => {
      setIsCreateOpen(false);
      setNewTitle('');
      setNewBody('');
      setNewAudience('all');
      setFeedbackMsg('Project-wide bulletin broadcast dispatched.');
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (err) => setFeedbackMsg(err instanceof ApiError ? err.message : 'Announcement creation failed'),
  });

  return (
    <div className="page announcements-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Global Dispatches</span>
          <h1>Workspace Bulletins & Announcements</h1>
          <p>Official project declarations, security protocol updates, and academic deadlines.</p>
        </div>

        {isAdmin && (
          <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} /> Broadcast bulletin
          </Button>
        )}
      </header>

      {feedbackMsg && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{feedbackMsg}</span>
          <Button variant="ghost" size="sm" onClick={() => setFeedbackMsg(null)}>Dismiss</Button>
        </div>
      )}

      {query.isLoading ? (
        <PageSkeleton />
      ) : query.data?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {query.data.map((announcement) => {
            const isRead = Boolean(announcement.readAt);
            return (
              <Panel
                key={announcement.id}
                style={{
                  borderLeft: `4px solid ${isRead ? 'var(--color-border)' : 'var(--color-cyan-sentinel)'}`,
                  background: isRead ? 'var(--color-surface)' : 'var(--color-surface-hover)',
                  padding: '20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Megaphone size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />
                    <div>
                      <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{announcement.title}</h2>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                        <small style={{ color: 'var(--color-muted)', fontSize: '0.75rem' }}>
                          Broadcast by <strong>{announcement.authorName}</strong> · {formatDate(announcement.publishedAt)}
                        </small>
                        <span style={{ fontSize: '0.7rem', padding: '1px 6px', background: 'var(--color-surface-subtle)', borderRadius: '3px', border: '1px solid var(--color-border)', textTransform: 'uppercase' }}>
                          Audience: {announcement.audience}
                        </span>
                      </div>
                    </div>
                  </div>

                  {!isRead ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => markRead.mutate(announcement.id)}
                      disabled={markRead.isPending}
                    >
                      <Check size={14} /> Mark as acknowledged
                    </Button>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Check size={14} style={{ color: 'var(--color-matrix-emerald)' }} /> Acknowledged
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                  {announcement.body}
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No active bulletins"
          body="All current project announcements have expired or none have been published."
        />
      )}

      {/* Broadcast Modal */}
      {isCreateOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '580px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Broadcast Global Bulletin</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsCreateOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); createAnnouncement.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label>
                <small>Bulletin Title *</small>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Mandatory Architecture Review for Checkpoint 3"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Target Audience *</small>
                <select
                  value={newAudience}
                  onChange={(e) => setNewAudience(e.target.value as 'all' | 'members' | 'supervisors' | 'admins')}
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                >
                  <option value="all">Entire Workspace (All Roles)</option>
                  <option value="members">Engineering Team Members Only</option>
                  <option value="supervisors">Academic Supervisors Only</option>
                  <option value="admins">Sentinel Administrators Only</option>
                </select>
              </label>

              <label>
                <small>Message Body *</small>
                <textarea
                  rows={5}
                  required
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="State the technical bulletin, instructions, or deadlines..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={createAnnouncement.isPending || !newTitle || !newBody}>
                  {createAnnouncement.isPending ? 'Transmitting...' : 'Transmit Bulletin'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
