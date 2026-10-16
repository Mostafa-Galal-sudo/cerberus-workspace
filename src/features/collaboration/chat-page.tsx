import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Hash,
  MessageSquare,
  MessageSquarePlus,
  Send,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface Channel {
  id: string;
  name: string;
  type: 'general' | 'team' | 'direct' | 'task';
  latestMessage?: string;
  latestAt?: number;
}

interface Message {
  id: string;
  body: string;
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
  authorId: string;
  authorName: string;
}

interface MemberOption {
  id: string;
  name: string;
  specialization: string;
}

export function ChatPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [isNewDmOpen, setIsNewDmOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Channels list query
  const channelsQuery = useQuery({
    queryKey: ['collaboration-channels'],
    queryFn: () => api<Channel[]>('/collaboration/channels'),
    refetchInterval: 5000,
  });

  const activeChannelId = selectedChannelId ?? (channelsQuery.data?.[0]?.id ?? null);

  // Messages in active channel query
  const messagesQuery = useQuery({
    queryKey: ['channel-messages', activeChannelId],
    queryFn: () => api<Message[]>(`/collaboration/channels/${activeChannelId}/messages`),
    enabled: Boolean(activeChannelId),
    refetchInterval: 2500,
  });

  // Members list for starting DMs
  const membersQuery = useQuery({
    queryKey: ['members-short'],
    queryFn: () => api<MemberOption[]>('/users'),
    enabled: isNewDmOpen,
  });

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messagesQuery.data]);

  const sendMessage = useMutation({
    mutationFn: () =>
      api(`/collaboration/channels/${activeChannelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: inputText, parentId: replyingTo?.id ?? null }),
      }),
    onSuccess: () => {
      setInputText('');
      setReplyingTo(null);
      setErrorMessage(null);
      void queryClient.invalidateQueries({ queryKey: ['channel-messages', activeChannelId] });
      void queryClient.invalidateQueries({ queryKey: ['collaboration-channels'] });
    },
    onError: (err) => setErrorMessage(err instanceof ApiError ? err.message : 'Message dispatch failed'),
  });

  const deleteMessage = useMutation({
    mutationFn: (messageId: string) =>
      api(`/collaboration/messages/${messageId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['channel-messages', activeChannelId] });
    },
    onError: (err) => setErrorMessage(err instanceof ApiError ? err.message : 'Deletion failed'),
  });

  const createDm = useMutation({
    mutationFn: (targetUserId: string) =>
      api<{ id: string }>('/collaboration/channels/direct', {
        method: 'POST',
        body: JSON.stringify({ userId: targetUserId }),
      }),
    onSuccess: (data) => {
      setIsNewDmOpen(false);
      setSelectedUserId('');
      setSelectedChannelId(data.id);
      void queryClient.invalidateQueries({ queryKey: ['collaboration-channels'] });
    },
    onError: (err) => setErrorMessage(err instanceof ApiError ? err.message : 'DM creation failed'),
  });

  const activeChannel = channelsQuery.data?.find((c) => c.id === activeChannelId);

  return (
    <div className="page chat-page" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <header className="page-header" style={{ marginBottom: '12px' }}>
        <div>
          <span className="breadcrumb">Real-time Coordination</span>
          <h1>Team Communications & Telemetry Chat</h1>
          <p>Discipline channels, direct engineering messages, and immutable record logging.</p>
        </div>
      </header>

      {errorMessage && (
        <div style={{ padding: '8px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--color-status-blocked)', borderRadius: '4px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-status-blocked)', fontSize: '0.8rem' }}>{errorMessage}</span>
          <Button variant="ghost" size="sm" onClick={() => setErrorMessage(null)}>Dismiss</Button>
        </div>
      )}

      <div className="chat-layout" style={{ flex: 1, display: 'grid', gridTemplateColumns: '260px 1fr', gap: '16px', minHeight: 0 }}>
        {/* Left: Channels List */}
        <Panel className="channels-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', minHeight: 0, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
            <strong style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>CHANNELS & DMS</strong>
            <Button variant="ghost" size="sm" onClick={() => setIsNewDmOpen(true)} title="New Direct Message">
              <MessageSquarePlus size={16} />
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {channelsQuery.data?.map((channel) => {
              const isSelected = channel.id === selectedChannelId;
              const Icon = channel.type === 'direct' ? User : channel.type === 'team' ? Users : Hash;
              return (
                <button
                  type="button"
                  key={channel.id}
                  onClick={() => { setSelectedChannelId(channel.id); setReplyingTo(null); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '4px',
                    textAlign: 'left',
                    background: isSelected ? 'var(--color-surface-hover)' : 'transparent',
                    border: isSelected ? '1px solid var(--color-border-accent)' : '1px solid transparent',
                    color: isSelected ? 'var(--color-cyan-sentinel)' : 'inherit',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  <Icon size={16} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {channel.name}
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Right: Message Stream and Composer */}
        <Panel className="chat-stream-panel" style={{ display: 'flex', flexDirection: 'column', padding: '0', minHeight: 0, overflow: 'hidden' }}>
          {/* Channel Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--color-surface-subtle)' }}>
            <Hash size={18} style={{ color: 'var(--color-cyan-sentinel)' }} />
            <div>
              <strong style={{ fontSize: '0.95rem' }}>{activeChannel?.name ?? 'Select Channel'}</strong>
              <small style={{ color: 'var(--color-muted)', display: 'block', fontSize: '0.75rem' }}>
                {activeChannel?.type === 'direct' ? 'Private dual-party stream' : 'Project-wide coordination'}
              </small>
            </div>
          </div>

          {/* Messages Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messagesQuery.isLoading ? (
              <PageSkeleton />
            ) : messagesQuery.data?.length ? (
              messagesQuery.data.map((msg) => {
                const isMine = msg.authorId === user?.id;
                const canDelete = isMine || user?.roles.includes('super_admin');
                return (
                  <div
                    key={msg.id}
                    className="chat-message-bubble"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      background: isMine ? 'var(--color-surface-hover)' : 'var(--color-surface-subtle)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      padding: '10px 14px',
                      maxWidth: '85%',
                      alignSelf: isMine ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                      <strong style={{ fontSize: '0.8rem', color: isMine ? 'var(--color-cyan-sentinel)' : 'inherit' }}>
                        {msg.authorName}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <small style={{ color: 'var(--color-muted)', fontSize: '0.7rem' }}>
                          {formatDate(msg.createdAt)}
                        </small>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => deleteMessage.mutate(msg.id)}
                            title="Delete message"
                            style={{ background: 'none', border: 'none', color: 'var(--color-muted)', cursor: 'pointer', padding: '2px' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>

                    <p style={{ margin: '4px 0 0', fontSize: '0.85rem', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                      {msg.body}
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(msg)}
                        style={{ background: 'none', border: 'none', color: 'var(--color-muted)', fontSize: '0.7rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <MessageSquare size={12} /> Reply
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState title="No messages yet" body="Transmit the first message to initiate this channel." />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply Indicator */}
          {replyingTo && (
            <div style={{ padding: '6px 16px', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
              <span>Replying to <strong>{replyingTo.authorName}</strong>: "{replyingTo.body.slice(0, 50)}..."</span>
              <Button variant="ghost" size="sm" onClick={() => setReplyingTo(null)}><X size={14} /></Button>
            </div>
          )}

          {/* Composer Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputText.trim()) sendMessage.mutate();
            }}
            style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '10px', background: 'var(--color-surface-subtle)' }}
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Message ${activeChannel?.name ?? 'channel'}...`}
              style={{
                flex: 1,
                padding: '10px 14px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                fontSize: '0.85rem',
                color: 'inherit',
              }}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={sendMessage.isPending || !inputText.trim()}
            >
              <Send size={15} /> Send
            </Button>
          </form>
        </Panel>
      </div>

      {/* New Direct Message Modal */}
      {isNewDmOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '440px', width: '100%', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Initiate Direct Message</h3>
              <Button variant="ghost" size="sm" onClick={() => setIsNewDmOpen(false)}><X size={16} /></Button>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: '0 0 14px' }}>
              Select a workspace colleague to establish a direct dual-party transmission stream.
            </p>

            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              style={{ width: '100%', padding: '10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', fontSize: '0.85rem' }}
            >
              <option value="">Select recipient...</option>
              {membersQuery.data
                ?.filter((m) => m.id !== user?.id)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.specialization || 'Member'})
                  </option>
                ))}
            </select>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button variant="ghost" onClick={() => setIsNewDmOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!selectedUserId || createDm.isPending}
                onClick={() => createDm.mutate(selectedUserId)}
              >
                Start Stream
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
