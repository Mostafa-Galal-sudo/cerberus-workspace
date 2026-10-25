import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Bot,
  Check,
  MessageSquarePlus,
  Pencil,
  Send,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../app/auth-context';
import { MarkdownRenderer } from '../../components/markdown';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, apiWithMeta, ApiError, formatDate, type PageMeta } from '../../lib/api';

interface Citation {
  index: number;
  type: string;
  id: string;
  title: string;
  meta: string;
  snippet: string;
  link: string;
}

interface ToolRun {
  tool: string;
  label: string;
  resultCount: number;
  durationMs: number;
}

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  toolRuns: ToolRun[];
  createdAt: number;
}

interface AssistantThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  messageCount: number;
  lastMessageAt: number | null;
}

interface ThreadDetail {
  thread: AssistantThread;
  messages: AssistantMessage[];
}

const PROMPT_SUGGESTIONS = [
  'What are the critical project blockers currently open?',
  'Summarize the six discipline roadmaps and member assignments.',
  'What architecture decisions (ADRs) have been approved?',
  'Explain the verification criteria for checkpoint approval.',
];

const EMPTY_THREADS: AssistantThread[] = [];

export function AssistantPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputPrompt, setInputPrompt] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [sendError, setSendError] = useState('');

  const threadsQuery = useQuery({
    queryKey: ['assistant', 'threads'],
    queryFn: () => apiWithMeta<{ threads: AssistantThread[] }, PageMeta>('/assistant/threads?limit=50'),
  });
  const threads = threadsQuery.data?.data.threads ?? EMPTY_THREADS;
  const activeId = selectedId && threads.some((thread) => thread.id === selectedId)
    ? selectedId
    : (threads[0]?.id ?? null);

  const detailQuery = useQuery({
    queryKey: ['assistant', 'thread', activeId],
    queryFn: () => api<ThreadDetail>(`/assistant/threads/${activeId}`),
    enabled: Boolean(activeId),
  });
  const messages = detailQuery.data?.messages ?? [];

  const invalidateThreads = () => queryClient.invalidateQueries({ queryKey: ['assistant', 'threads'] });
  const invalidateDetail = (threadId: string) => queryClient.invalidateQueries({ queryKey: ['assistant', 'thread', threadId] });

  const createThread = useMutation({
    mutationFn: () => api<{ thread: AssistantThread }>('/assistant/threads', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData<{ data: { threads: AssistantThread[] }; meta: PageMeta }>(
        ['assistant', 'threads'],
        (current) => current
          ? { ...current, data: { threads: [data.thread, ...current.data.threads.filter((thread) => thread.id !== data.thread.id)] } }
          : current,
      );
      void invalidateThreads();
    },
  });

  const sendMessage = useMutation({
    mutationFn: ({ threadId, message }: { threadId: string; message: string }) =>
      api<{ thread: AssistantThread; message: AssistantMessage; usageId: string }>(
        `/assistant/threads/${threadId}/messages`,
        { method: 'POST', body: JSON.stringify({ message }) },
      ),
    onSuccess: (_data, variables) => {
      void invalidateDetail(variables.threadId);
      void invalidateThreads();
    },
  });

  const renameThread = useMutation({
    mutationFn: ({ threadId, title }: { threadId: string; title: string }) =>
      api<{ thread: AssistantThread }>(`/assistant/threads/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => { void invalidateThreads(); },
  });

  const archiveThread = useMutation({
    mutationFn: (threadId: string) => api<{ archived: boolean }>(`/assistant/threads/${threadId}`, { method: 'DELETE' }),
    onSuccess: (_data, threadId) => {
      if (threadId === activeId) setSelectedId(null);
      void invalidateThreads();
    },
  });

  useEffect(() => {
    if (messages.length === 0) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, sendMessage.isPending]);

  const dispatchMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendMessage.isPending || createThread.isPending) return;
    setSendError('');
    setInputPrompt('');
    try {
      let threadId = activeId;
      if (!threadId) {
        const created = await createThread.mutateAsync();
        threadId = created.thread.id;
        setSelectedId(threadId);
      }
      await sendMessage.mutateAsync({ threadId, message: trimmed });
    } catch (cause) {
      setSendError(cause instanceof ApiError ? cause.message : 'The assistant could not answer that question');
      setInputPrompt(trimmed);
    }
  };

  const beginRename = (thread: AssistantThread) => {
    setRenamingId(thread.id);
    setRenameValue(thread.title);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (!title) return;
    await renameThread.mutateAsync({ threadId: renamingId, title });
    setRenamingId(null);
    setRenameValue('');
  };

  const busy = sendMessage.isPending || createThread.isPending;

  return (
    <div className="page assistant-page">
      <header className="page-header" style={{ marginBottom: '12px' }}>
        <div>
          <span className="breadcrumb">Intelligent Sentinel Telemetry</span>
          <h1>Cerberus AI Engineering Assistant</h1>
          <p>Persistent, citation-backed synthesis across discipline roadmaps, verified records, and documentation.</p>
        </div>
        <Button
          type="button"
          onClick={async () => {
            const created = await createThread.mutateAsync();
            setSelectedId(created.thread.id);
          }}
          disabled={createThread.isPending}
        >
          <MessageSquarePlus size={16} /> New thread
        </Button>
      </header>

      <div className="assistant-layout">
        <aside className="assistant-thread-rail" aria-label="Assistant thread history">
          <div className="panel-heading">
            <h2>Threads</h2>
            <span className="badge">{threads.length}</span>
          </div>
          {threadsQuery.isLoading ? (
            <PageSkeleton />
          ) : threads.length === 0 ? (
            <p className="assistant-rail-empty">No threads yet. Ask the assistant to start one.</p>
          ) : (
            <ul className="assistant-thread-list">
              {threads.map((thread) => (
                <li key={thread.id} className={thread.id === activeId ? 'thread-row is-active' : 'thread-row'}>
                  {renamingId === thread.id ? (
                    <form
                      className="thread-rename"
                      onSubmit={(event) => { event.preventDefault(); void commitRename(); }}
                    >
                      <input
                        autoFocus
                        aria-label={`Rename ${thread.title}`}
                        value={renameValue}
                        maxLength={120}
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                      <button type="submit" aria-label="Save thread title" disabled={!renameValue.trim()}><Check size={15} /></button>
                      <button type="button" aria-label="Cancel rename" onClick={() => setRenamingId(null)}><X size={15} /></button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="thread-select"
                        onClick={() => setSelectedId(thread.id)}
                        aria-current={thread.id === activeId ? 'true' : undefined}
                      >
                        <span>{thread.title}</span>
                        <small>{thread.messageCount} message{thread.messageCount === 1 ? '' : 's'} Â· {formatDate(thread.updatedAt)}</small>
                      </button>
                      <div className="thread-actions">
                        <button type="button" aria-label={`Rename ${thread.title}`} onClick={() => beginRename(thread)}>
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Archive ${thread.title}`}
                          disabled={archiveThread.isPending}
                          onClick={() => void archiveThread.mutateAsync(thread.id)}
                        >
                          <Archive size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>

        <Panel className="assistant-conversation">
          <div className="assistant-message-stream" aria-live="polite">
            {detailQuery.isLoading && activeId ? (
              <PageSkeleton />
            ) : messages.length === 0 ? (
              <EmptyState
                title="Ask a grounded question"
                body="Answers cite the workspace records they were built from. Start a thread, then ask about tasks, blockers, decisions, documentation, or the team roster."
              />
            ) : (
              messages.map((message) => {
                const isUser = message.role === 'user';
                return (
                  <div key={message.id} className={isUser ? 'assistant-message is-user' : 'assistant-message'}>
                    <span className="avatar small" aria-hidden="true">
                      {isUser ? <User size={16} /> : <Bot size={16} />}
                    </span>

                    <div className="assistant-bubble">
                      <div className="assistant-message-meta">
                        <strong>{isUser ? user?.displayName : 'Cerberus Sentinel AI'}</strong>
                        <span>{formatDate(message.createdAt)}</span>
                      </div>

                      {isUser ? (
                        <p className="assistant-user-text">{message.content}</p>
                      ) : (
                        <MarkdownRenderer content={message.content} className="assistant-markdown" />
                      )}

                      {message.toolRuns.length > 0 && (
                        <div className="assistant-tool-runs" aria-label="Read-only tools used">
                          {message.toolRuns.map((run) => (
                            <span key={run.tool} className="badge" title={`${run.durationMs} ms`}>
                              {run.label} Â· {run.resultCount}
                            </span>
                          ))}
                        </div>
                      )}

                      {message.citations.length > 0 && (
                        <div className="assistant-citations">
                          <small>RETRIEVED SOURCES (server-read, not model-verified)</small>
                          <div>
                            {message.citations.map((citation) => (
                              <Link key={`${citation.type}-${citation.id}`} to={citation.link} title={citation.snippet}>
                                <strong>[{citation.index}]</strong> {citation.type.toUpperCase()} Â· {citation.title}
                              </Link>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {sendMessage.isPending && (
              <div className="assistant-message">
                <span className="avatar small" aria-hidden="true"><Bot size={16} /></span>
                <div className="assistant-bubble assistant-thinking">Retrieving workspace records and composing a cited answerâ€¦</div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="assistant-suggestions">
            {PROMPT_SUGGESTIONS.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => void dispatchMessage(suggestion)}
                disabled={busy}
              >
                {suggestion}
              </button>
            ))}
          </div>

          {sendError && <div className="form-error" role="alert" style={{ margin: '0 16px 8px' }}>{sendError}</div>}

          <form
            className="assistant-composer"
            onSubmit={(event) => { event.preventDefault(); void dispatchMessage(inputPrompt); }}
          >
            <input
              type="text"
              value={inputPrompt}
              maxLength={8_000}
              onChange={(event) => setInputPrompt(event.target.value)}
              placeholder="Ask the Sentinel AI about tasks, roadmaps, blockers, or evidence..."
              aria-label="Ask the assistant a question"
            />
            <Button type="submit" variant="primary" disabled={busy || !inputPrompt.trim()}>
              <Send size={15} /> Send
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
