import { useMutation } from '@tanstack/react-query';
import {
  Bot,
  Send,
  User,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useAuth } from '../../app/auth-context';
import { Button, Panel } from '../../components/ui';
import { api, formatDate } from '../../lib/api';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  sources?: Array<{ type: string; title: string; meta: string }>;
  timestamp: number;
}

function getTimestampSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function AssistantPage() {
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [inputPrompt, setInputPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Greetings, Sentinel Engineer. I am the CERBERUS AI Operational Assistant. I am directly grounded in the project database—including all six discipline roadmaps, verified task deliverables, architecture decisions, and open blockers. How can I assist your engineering validation today?',
      timestamp: 1776300000,
    },
  ]);

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      api<{ reply: string; sources: Array<{ type: string; title: string; meta: string }>; usageId: string }>('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    onSuccess: (data) => {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'assistant',
        text: data.reply,
        sources: data.sources,
        timestamp: getTimestampSec(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    },
  });

  const handleSend = (textToSend?: string) => {
    const text = textToSend ?? inputPrompt;
    if (!text.trim() || chatMutation.isPending) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text,
      timestamp: getTimestampSec(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    chatMutation.mutate(text);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const PROMPT_SUGGESTIONS = [
    'What are the critical project blockers currently open?',
    'Summarize the six discipline roadmaps and member assignments.',
    'What architecture decisions (ADRs) have been approved?',
    'Explain the verification criteria for checkpoint approval.',
  ];

  return (
    <div className="page assistant-page" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <header className="page-header" style={{ marginBottom: '12px' }}>
        <div>
          <span className="breadcrumb">Intelligent Sentinel Telemetry</span>
          <h1>Cerberus AI Engineering Assistant</h1>
          <p>Context-aware synthesis across discipline roadmaps, audit provenance, and technical documentation.</p>
        </div>
      </header>

      <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0', overflow: 'hidden' }}>
        {/* Messages Stream */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            return (
              <div
                key={msg.id}
                style={{
                  display: 'flex',
                  gap: '12px',
                  maxWidth: isUser ? '80%' : '88%',
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  flexDirection: isUser ? 'row-reverse' : 'row',
                }}
              >
                <span
                  className="avatar small"
                  style={{
                    background: isUser ? 'var(--color-surface-subtle)' : 'var(--color-cyan-sentinel)',
                    color: isUser ? 'inherit' : '#000',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isUser ? <User size={16} /> : <Bot size={16} />}
                </span>

                <div
                  style={{
                    background: isUser ? 'var(--color-surface-hover)' : 'var(--color-surface-subtle)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                    padding: '14px 18px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    <strong>{isUser ? user?.displayName : 'Cerberus Sentinel AI'}</strong>
                    <span>{formatDate(msg.timestamp)}</span>
                  </div>

                  <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {msg.text}
                  </p>

                  {/* Grounding Sources */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid var(--color-border)', paddingTop: '8px' }}>
                      <small style={{ fontSize: '0.7rem', color: 'var(--color-cyan-sentinel)', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                        GROUNDING CONTEXT RETRIEVED:
                      </small>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {msg.sources.map((s, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '0.7rem',
                              padding: '2px 8px',
                              background: 'var(--color-surface)',
                              border: '1px solid var(--color-border)',
                              borderRadius: '4px',
                            }}
                          >
                            <strong>[{s.type.toUpperCase()}]</strong> {s.title} ({s.meta})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {chatMutation.isPending && (
            <div style={{ display: 'flex', gap: '12px', alignSelf: 'flex-start', alignItems: 'center' }}>
              <span className="avatar small" style={{ background: 'var(--color-cyan-sentinel)', color: '#000', width: '32px', height: '32px' }}>
                <Bot size={16} />
              </span>
              <div style={{ background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px 18px', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                Synthesizing workspace telemetry and cross-referencing roadmaps...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Prompt Suggestions */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)', display: 'flex', gap: '8px', overflowX: 'auto' }}>
          {PROMPT_SUGGESTIONS.map((suggestion, idx) => (
            <button
              type="button"
              key={idx}
              onClick={() => handleSend(suggestion)}
              style={{
                padding: '4px 10px',
                borderRadius: '12px',
                background: 'var(--color-surface-subtle)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-muted)',
                fontSize: '0.75rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', gap: '10px', background: 'var(--color-surface-subtle)' }}
        >
          <input
            type="text"
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            placeholder="Ask the Sentinel AI about tasks, roadmaps, blockers, or evidence..."
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
            disabled={chatMutation.isPending || !inputPrompt.trim()}
          >
            <Send size={15} /> Send
          </Button>
        </form>
      </Panel>
    </div>
  );
}
