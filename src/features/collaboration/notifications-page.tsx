import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, apiWithMeta, formatDate, type PageMeta } from '../../lib/api';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  resource_type?: string | null;
  resource_id?: string | null;
  read_at?: number | null;
  created_at: number;
  link: string | null;
}

interface NotificationMeta extends PageMeta {
  unreadCount: number;
}

const TYPE_OPTIONS = [
  { value: '', label: 'All notification types' },
  { value: 'review.requested', label: 'Review requested' },
  { value: 'review.approved', label: 'Review approved' },
  { value: 'review.changes_requested', label: 'Changes requested' },
  { value: 'task.assigned', label: 'Task assignment' },
  { value: 'work.reassigned', label: 'Work reassigned' },
  { value: 'supervisor.feedback', label: 'Supervisor feedback' },
  { value: 'password.reset_requested', label: 'Password reset request' },
];

const PAGE_SIZE = 20;

function bucketFor(epoch: number): 'Today' | 'Yesterday' | 'Earlier' {
  const date = new Date(epoch * 1000);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  if (date.getTime() >= startOfToday) return 'Today';
  if (date.getTime() >= startOfYesterday) return 'Yesterday';
  return 'Earlier';
}

function internalLink(link: string | null): string | null {
  return link && link.startsWith('/') && !link.startsWith('//') ? link : null;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['notifications', { filter, typeFilter, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), status: filter });
      if (typeFilter) params.set('type', typeFilter);
      return apiWithMeta<NotificationItem[], NotificationMeta>(`/collaboration/notifications?${params.toString()}`);
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api(`/collaboration/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api<{ updated: number }>('/collaboration/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const notifications = query.data?.data ?? [];
  const meta = query.data?.meta;
  const unreadCount = meta?.unreadCount ?? 0;
  const total = meta?.total ?? 0;
  const hasMore = meta?.hasMore ?? false;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const grouped = notifications.reduce<Array<{ bucket: string; items: NotificationItem[] }>>((groups, notification) => {
    const bucket = bucketFor(notification.created_at);
    const existing = groups.find((group) => group.bucket === bucket);
    if (existing) existing.items.push(notification);
    else groups.push({ bucket, items: [notification] });
    return groups;
  }, []);

  const getNotificationIcon = (type: string) => {
    if (type === 'review.approved') return <ShieldCheck size={18} style={{ color: 'var(--color-status-approved)' }} />;
    if (type === 'review.changes_requested' || type === 'password.reset_requested') {
      return <ShieldAlert size={18} style={{ color: 'var(--color-status-blocked)' }} />;
    }
    if (type === 'supervisor.feedback') return <MessageSquare size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />;
    return <Bell size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />;
  };

  const changeFilter = (next: 'all' | 'unread') => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="page notifications-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Alert Telemetry</span>
          <h1>Sentinel Notifications</h1>
          <p>Review outcomes, work assignments and supervisor feedback with server-resolved destinations.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {unreadCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck size={16} /> Mark all read ({unreadCount})
            </Button>
          )}
        </div>
      </header>

      <Panel className="task-toolbar notification-toolbar">
        <div style={{ display: 'flex', gap: '8px' }} role="group" aria-label="Notification status filter">
          <Button
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={filter === 'all'}
            onClick={() => changeFilter('all')}
          >
            All alerts
          </Button>
          <Button
            variant={filter === 'unread' ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={filter === 'unread'}
            onClick={() => changeFilter('unread')}
          >
            Unread ({unreadCount})
          </Button>
        </div>

        <label className="select-box" style={{ maxWidth: '280px' }}>
          <span className="sr-only">Filter by notification type</span>
          <select
            aria-label="Filter by notification type"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </Panel>

      {query.isLoading ? (
        <PageSkeleton />
      ) : query.isError ? (
        <EmptyState title="Alerts could not be loaded" body="The notification service did not respond. Retry in a moment." />
      ) : notifications.length ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {grouped.map((group) => (
              <section key={group.bucket} aria-label={group.bucket}>
                <h2 className="notification-group-title">{group.bucket}</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {group.items.map((notification) => {
                    const isRead = Boolean(notification.read_at);
                    const targetLink = internalLink(notification.link);
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
                              {notification.type.replaceAll('.', ' · ')} — {formatDate(notification.created_at)}
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
                              aria-label={`Mark ${notification.title} as read`}
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
              </section>
            ))}
          </div>

          <div className="notification-pagination" aria-label="Notification pagination">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft size={14} /> Previous
            </Button>
            <span>Page {page} of {pageCount} · {total} notifications</span>
            <Button variant="ghost" size="sm" disabled={!hasMore} onClick={() => setPage((current) => current + 1)}>
              Next <ChevronRight size={14} />
            </Button>
          </div>
        </>
      ) : (
        <EmptyState
          title="No alerts in inbox"
          body={filter === 'unread' || typeFilter ? 'No notifications match the selected filters.' : 'No alerts have been recorded yet.'}
        />
      )}
    </div>
  );
}
