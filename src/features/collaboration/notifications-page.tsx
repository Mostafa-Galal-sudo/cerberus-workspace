import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Check,
  CheckCheck,
  ExternalLink,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, formatDate } from '../../lib/api';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  resource_type?: string | null;
  resource_id?: string | null;
  read_at?: number | null;
  created_at: number;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationItem[]>('/collaboration/notifications'),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/collaboration/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = query.data?.filter((n) => !n.read_at) ?? [];
      await Promise.all(unread.map((n) => api(`/collaboration/notifications/${n.id}/read`, { method: 'POST' })));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const filtered = (query.data ?? []).filter((n) => (filter === 'unread' ? !n.read_at : true));
  const unreadCount = query.data?.filter((n) => !n.read_at).length ?? 0;

  const getNotificationIcon = (type: string) => {
    if (type.includes('approved')) return <ShieldCheck size={18} style={{ color: 'var(--color-status-approved)' }} />;
    if (type.includes('changes_requested')) return <ShieldAlert size={18} style={{ color: 'var(--color-status-blocked)' }} />;
    if (type.includes('feedback')) return <MessageSquare size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />;
    return <Bell size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />;
  };

  const getTargetLink = (n: NotificationItem) => {
    if (n.resource_type === 'submission' || n.resource_type === 'task') {
      return n.resource_id ? `/tasks/${n.resource_id}` : '/tasks';
    }
    if (n.resource_type === 'supervisor_feedback') {
      return '/members';
    }
    return null;
  };

  return (
    <div className="page notifications-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Alert Telemetry</span>
          <h1>Sentinel Notifications</h1>
          <p>Real-time audit updates, administrative review outcomes, and supervisor critiques.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {unreadCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck size={16} /> Mark all acknowledged ({unreadCount})
            </Button>
          )}
        </div>
      </header>

      <Panel className="task-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter('all')}
          >
            All alerts ({(query.data ?? []).length})
          </Button>
          <Button
            variant={filter === 'unread' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilter('unread')}
          >
            Unacknowledged ({unreadCount})
          </Button>
        </div>
      </Panel>

      {query.isLoading ? (
        <PageSkeleton />
      ) : filtered.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((notification) => {
            const isRead = Boolean(notification.read_at);
            const targetLink = getTargetLink(notification);
            return (
              <Panel
                key={notification.id}
                style={{
                  borderLeft: `4px solid ${isRead ? 'var(--color-border)' : 'var(--color-cyan-sentinel)'}`,
                  background: isRead ? 'var(--color-surface)' : 'var(--color-surface-hover)',
                  padding: '14px 18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  {getNotificationIcon(notification.type)}
                  <div>
                    <strong style={{ fontSize: '0.9rem', display: 'block', color: isRead ? 'inherit' : 'var(--color-cyan-sentinel)' }}>
                      {notification.title}
                    </strong>
                    <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
                      {notification.body}
                    </p>
                    <small style={{ color: 'var(--color-muted)', fontSize: '0.7rem', display: 'block', marginTop: '4px' }}>
                      {formatDate(notification.created_at)}
                    </small>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {targetLink && (
                    <Link
                      to={targetLink}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-cyan-sentinel)', padding: '6px 10px', background: 'var(--color-surface-subtle)', borderRadius: '4px', textDecoration: 'none' }}
                    >
                      <ExternalLink size={13} /> Inspect
                    </Link>
                  )}

                  {!isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead.mutate(notification.id)}
                      disabled={markRead.isPending}
                      title="Mark as read"
                    >
                      <Check size={14} />
                    </Button>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No alerts in inbox"
          body={filter === 'unread' ? 'All notifications have been reviewed and acknowledged.' : 'No alerts have been recorded yet.'}
        />
      )}
    </div>
  );
}
