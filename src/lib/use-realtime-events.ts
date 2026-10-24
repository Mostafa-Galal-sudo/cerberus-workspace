import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface RealtimeEvent {
  type?: string;
  channelId?: string;
  taskId?: string;
  submissionId?: string;
  announcementId?: string;
  resourceId?: string;
}

const INVALIDATIONS: Record<string, string[][]> = {
  'message.created': [['channel-messages'], ['collaboration-channels']],
  'message.updated': [['channel-messages'], ['collaboration-channels']],
  'message.deleted': [['channel-messages'], ['collaboration-channels']],
  'announcement.published': [['announcements']],
  'supervisor.feedback': [['supervisor-feedback'], ['notifications']],
  'task.assigned': [['tasks'], ['task'], ['members'], ['notifications']],
  'work.reassigned': [['tasks'], ['members'], ['roadmap'], ['notifications']],
  'review.requested': [['reviews'], ['notifications']],
  'review.approved': [['reviews'], ['tasks'], ['task'], ['notifications']],
  'review.changes_requested': [['reviews'], ['tasks'], ['task'], ['notifications']],
  'attachment.created': [['attachments']],
  'attachment.archived': [['attachments']],
  'password.reset_requested': [['notifications']],
  'notification.created': [['notifications']],
};

/**
 * Subscribes to the workspace SSE stream and invalidates only the query
 * families affected by each event. EventSource reconnects automatically and
 * replays from the last event id; the worker also exposes a polling fallback.
 */
export function useRealtimeEvents(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/v1/collaboration/events');

    const handleWorkspaceEvent = (event: MessageEvent<string>) => {
      let payload: RealtimeEvent = {};
      try {
        payload = JSON.parse(event.data) as RealtimeEvent;
      } catch {
        return;
      }

      const keys = INVALIDATIONS[payload.type ?? ''] ?? [['notifications']];
      for (const queryKey of keys) {
        void queryClient.invalidateQueries({ queryKey });
      }

      if (payload.type === 'message.created' || payload.type === 'message.updated' || payload.type === 'message.deleted') {
        void queryClient.invalidateQueries({ queryKey: ['channel-messages'], exact: false });
      }
    };

    source.addEventListener('workspace', handleWorkspaceEvent as EventListener);
    source.addEventListener('reconnect', () => {
      // The browser reconnects automatically after the bounded SSE window.
    });

    return () => {
      source.removeEventListener('workspace', handleWorkspaceEvent as EventListener);
      source.close();
    };
  }, [enabled, queryClient]);
}
