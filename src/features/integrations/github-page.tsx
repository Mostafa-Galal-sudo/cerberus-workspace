import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { safeHttpUrl } from '../../../shared/url';
import { useAuth } from '../../app/auth-context';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, apiWithMeta, ApiError, formatDate, type PageMeta } from '../../lib/api';

interface GithubStatus {
  enabled: boolean;
  repository: string;
  syncBranch: string;
  hasSecret: boolean;
  authMode: 'app' | 'token' | 'none';
  outboundReady: boolean;
  lastSyncAt?: number | null;
  lastSyncStatus?: string | null;
  lastSyncCount?: number;
  updatedAt?: number;
  events: Array<{
    id: string;
    deliveryId: string;
    eventType: string;
    action?: string | null;
    receivedAt: number;
    payloadExcerpt: string;
  }>;
  links: Array<{
    id: string;
    resource_id: string;
    taskTitle?: string;
    github_type: string;
    github_id: string;
    url: string;
    created_at: number;
  }>;
}

interface PullRequestRow {
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: string;
  draft: number;
  headRef: string | null;
  baseRef: string | null;
  headSha: string | null;
  checksStatus: string;
  mergedAt: number | null;
  updatedAt: number;
  taskTitles: string | null;
}

interface PullRequestMeta extends PageMeta {
  state: string;
}

const CHECKS_BADGE: Record<string, { label: string; color: string }> = {
  success: { label: 'CI passing', color: 'var(--color-status-approved)' },
  failure: { label: 'CI failing', color: 'var(--color-status-blocked)' },
  pending: { label: 'CI pending', color: 'var(--color-status-progress)' },
  neutral: { label: 'CI neutral', color: 'var(--color-silver-mid)' },
  unknown: { label: 'CI unknown', color: 'var(--color-muted)' },
};

function PullRequestPanel() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState('');
  const query = useQuery({
    queryKey: ['github-pull-requests', state, page],
    queryFn: () => apiWithMeta<PullRequestRow[], PullRequestMeta>(
      `/github/pull-requests?page=${page}&limit=10${state ? `&state=${state}` : ''}`,
    ),
  });

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const total = meta?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 10));

  return (
    <Panel style={{ marginBottom: '24px' }}>
      <div className="panel-heading" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Pull request &amp; CI state</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '2px 0 0' }}>
            Persisted from webhook deliveries and repository sync. A merge never changes the task status; it notifies the assignee that evidence can be submitted.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="pr-state-filter" style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>State</label>
          <select
            id="pr-state-filter"
            value={state}
            onChange={(event) => { setState(event.target.value); setPage(1); }}
            style={{ padding: '7px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border-armor)', borderRadius: '4px', color: 'inherit', fontSize: '0.8rem' }}
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="merged">Merged</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '8px' }}>
        {query.isLoading ? <PageSkeleton /> : rows.length ? rows.map((pullRequest) => {
          const badge = CHECKS_BADGE[pullRequest.checksStatus] ?? CHECKS_BADGE.unknown;
          const url = safeHttpUrl(pullRequest.url);
          return (
            <div key={pullRequest.id} style={{ padding: '10px 12px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', display: 'grid', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <GitPullRequest size={16} style={{ flexShrink: 0 }} />
                  <span className="mono-data" style={{ fontSize: '0.78rem', flexShrink: 0 }}>#{pullRequest.number}</span>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer noopener" style={{ fontSize: '0.85rem', color: 'var(--color-cyan-sentinel)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pullRequest.title}
                    </a>
                  ) : (
                    <span style={{ fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pullRequest.title}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {pullRequest.draft === 1 && (
                    <span className="badge" style={{ fontSize: '0.66rem' }}>Draft</span>
                  )}
                  <span className="badge" style={{ fontSize: '0.66rem' }}>{pullRequest.state}</span>
                  <span style={{ fontSize: '0.68rem', fontFamily: 'JetBrains Mono, monospace', color: badge.color, border: `1px solid ${badge.color}`, borderRadius: '3px', padding: '1px 6px' }}>
                    {badge.label}
                  </span>
                </div>
              </div>
              <small style={{ color: 'var(--color-muted)', fontSize: '0.72rem' }}>
                {pullRequest.headRef ?? 'unknown'} → {pullRequest.baseRef ?? 'unknown'}
                {pullRequest.headSha ? ` · ${pullRequest.headSha.slice(0, 7)}` : ''}
                {` · updated ${formatDate(pullRequest.updatedAt)}`}
                {pullRequest.mergedAt ? ` · merged ${formatDate(pullRequest.mergedAt)}` : ''}
              </small>
              <small style={{ color: 'var(--color-silver-mid)', fontSize: '0.72rem' }}>
                Linked tasks: {pullRequest.taskTitles ?? 'none'}
              </small>
            </div>
          );
        }) : (
          <EmptyState
            title="No pull requests tracked"
            body="Run a repository sync or deliver a pull_request webhook to persist PR state and CI rollups."
          />
        )}
      </div>

      {total > 10 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            <ChevronLeft size={14} /> Previous
          </Button>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>Page {page} of {pageCount}</span>
          <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
            Next <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function GithubPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isPrOpen, setIsPrOpen] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [syncBranch, setSyncBranch] = useState('main');
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [prTaskId, setPrTaskId] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const [prHead, setPrHead] = useState('');
  const [prBase, setPrBase] = useState('main');
  const [prBody, setPrBody] = useState('');
  const [prDraft, setPrDraft] = useState(false);

  const isAdmin = user?.roles.includes('super_admin');

  const query = useQuery({
    queryKey: ['github-status'],
    queryFn: () => api<GithubStatus>('/github/status'),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api('/github/settings', {
        method: 'POST',
        body: JSON.stringify({
          repository: repoName,
          webhookSecret: webhookSecret || undefined,
          syncBranch,
          enabled: true,
        }),
      }),
    onSuccess: () => {
      setIsConfigOpen(false);
      setActionFeedback('GitHub integration settings persisted.');
      void queryClient.invalidateQueries({ queryKey: ['github-status'] });
    },
    onError: (err) => setActionFeedback(err instanceof ApiError ? err.message : 'Save failed'),
  });

  const simulateEvent = useMutation({
    mutationFn: () =>
      api('/github/simulate-event', {
        method: 'POST',
        body: JSON.stringify({ taskId: 'task_1_1' }),
      }),
    onSuccess: () => {
      setActionFeedback('Simulated GitHub push event processed and linked to task_1_1.');
      void queryClient.invalidateQueries({ queryKey: ['github-status'] });
    },
    onError: (err) => setActionFeedback(err instanceof ApiError ? err.message : 'Simulation failed'),
  });

  const syncRepository = useMutation({
    mutationFn: () => api<{ repository: string; pullRequests: number; branches: number; linked: number; checksChecked: number }>('/github/sync', { method: 'POST' }),
    onSuccess: (result) => {
      setActionFeedback(`Synced ${result.repository}: ${result.pullRequests} open pull request(s), ${result.branches} branch(es), ${result.linked} task link(s), ${result.checksChecked} CI rollup(s).`);
      void queryClient.invalidateQueries({ queryKey: ['github-status'] });
      void queryClient.invalidateQueries({ queryKey: ['github-pull-requests'] });
    },
    onError: (err) => setActionFeedback(err instanceof ApiError ? err.message : 'Repository sync failed'),
  });

  const createPr = useMutation({
    mutationFn: () => api<{ number: number; url: string }>('/github/pull-request', {
      method: 'POST',
      body: JSON.stringify({
        taskId: prTaskId.trim(),
        title: prTitle.trim(),
        head: prHead.trim(),
        base: prBase.trim() || undefined,
        body: prBody.trim() || undefined,
        draft: prDraft,
      }),
    }),
    onSuccess: (result) => {
      setIsPrOpen(false);
      setPrTaskId('');
      setPrTitle('');
      setPrHead('');
      setPrBody('');
      setPrDraft(false);
      setActionFeedback(`Pull request #${result.number} opened and linked to its task.`);
      void queryClient.invalidateQueries({ queryKey: ['github-status'] });
      void queryClient.invalidateQueries({ queryKey: ['github-pull-requests'] });
    },
    onError: (err) => setActionFeedback(err instanceof ApiError ? err.message : 'Pull request creation failed'),
  });

  const handleOpenPr = () => {
    setPrBase(query.data?.syncBranch ?? 'main');
    setIsPrOpen(true);
  };

  const handleOpenConfig = () => {
    if (query.data) {
      setRepoName(query.data.repository);
      setSyncBranch(query.data.syncBranch);
      setWebhookSecret('');
    }
    setIsConfigOpen(true);
  };

  if (query.isLoading) return <PageSkeleton />;

  const data = query.data;

  return (
    <div className="page github-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Continuous Integration & Code Provenance</span>
          <h1>GitHub Integration & Repository Webhooks</h1>
          <p>Cryptographically verified commit links, pull request reviews, and automated task provenance.</p>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => syncRepository.mutate()}
              disabled={syncRepository.isPending || !data?.outboundReady}
              title={data?.outboundReady ? 'Sync open pull requests from GitHub' : 'Configure GITHUB_TOKEN or GitHub App credentials first'}
            >
              <RefreshCw size={14} /> {syncRepository.isPending ? 'Syncing…' : 'Sync Repository'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenPr}
              disabled={!data?.outboundReady}
              title={data?.outboundReady ? 'Open a pull request linked to a task' : 'Configure GITHUB_TOKEN or GitHub App credentials first'}
            >
              <GitPullRequest size={14} /> Open Pull Request
            </Button>
            <Button variant="secondary" size="sm" onClick={() => simulateEvent.mutate()} disabled={simulateEvent.isPending}>
              <Play size={14} /> Simulate Commit Webhook
            </Button>
            <Button variant="primary" size="sm" onClick={handleOpenConfig}>
              <Settings size={14} /> Configure Integration
            </Button>
          </div>
        )}
      </header>

      {actionFeedback && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{actionFeedback}</span>
          <Button variant="ghost" size="sm" onClick={() => setActionFeedback(null)}>Dismiss</Button>
        </div>
      )}

      {/* Telemetry Status Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <Panel style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px' }}>
          <div style={{ padding: '10px', background: 'var(--color-surface-subtle)', borderRadius: '6px' }}>
            <GitBranch size={22} style={{ color: 'var(--color-cyan-sentinel)' }} />
          </div>
          <div>
            <small style={{ color: 'var(--color-muted)', display: 'block' }}>Target Repository</small>
            <strong style={{ fontSize: '0.95rem' }}>{data?.repository ?? 'Not configured'}</strong>
            <small style={{ color: 'var(--color-muted)', display: 'block', fontSize: '0.75rem' }}>Branch: {data?.syncBranch}</small>
          </div>
        </Panel>

        <Panel style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px' }}>
          <div style={{ padding: '10px', background: 'var(--color-surface-subtle)', borderRadius: '6px' }}>
            <ShieldCheck size={22} style={{ color: data?.hasSecret ? 'var(--color-status-approved)' : 'var(--color-magma-flame)' }} />
          </div>
          <div>
            <small style={{ color: 'var(--color-muted)', display: 'block' }}>HMAC-SHA256 Webhook Verification</small>
            <strong style={{ fontSize: '0.95rem' }}>{data?.hasSecret ? 'Vigilant & Signed' : 'Default / Unsigned'}</strong>
            <small style={{ color: 'var(--color-muted)', display: 'block', fontSize: '0.75rem' }}>Payload path: /api/v1/github/webhook</small>
          </div>
        </Panel>

        <Panel style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px' }}>
          <div style={{ padding: '10px', background: 'var(--color-surface-subtle)', borderRadius: '6px' }}>
            <GitCommit size={22} style={{ color: 'var(--color-cyan-sentinel)' }} />
          </div>
          <div>
            <small style={{ color: 'var(--color-muted)', display: 'block' }}>Linked Task Commits</small>
            <strong style={{ fontSize: '0.95rem' }}>{data?.links.length ?? 0} Recorded</strong>
            <small style={{ color: 'var(--color-muted)', display: 'block', fontSize: '0.75rem' }}>Events logged: {data?.events.length ?? 0}</small>
          </div>
        </Panel>

        <Panel style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px' }}>
          <div style={{ padding: '10px', background: 'var(--color-surface-subtle)', borderRadius: '6px' }}>
            <RefreshCw size={22} style={{ color: data?.outboundReady ? 'var(--color-status-approved)' : 'var(--color-magma-flame)' }} />
          </div>
          <div>
            <small style={{ color: 'var(--color-muted)', display: 'block' }}>Outbound GitHub Authentication</small>
            <strong style={{ fontSize: '0.95rem' }}>
              {data?.authMode === 'app' ? 'GitHub App installation' : data?.authMode === 'token' ? 'Personal access token' : 'Not configured'}
            </strong>
            <small style={{ color: 'var(--color-muted)', display: 'block', fontSize: '0.75rem' }}>
              {data?.lastSyncAt ? `Last sync ${formatDate(data.lastSyncAt)} · ${data.lastSyncStatus ?? 'unknown'} · ${data.lastSyncCount ?? 0} PRs` : 'Repository has not been synced yet'}
            </small>
          </div>
        </Panel>
      </div>

      <PullRequestPanel />

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
        {/* Linked Commits & PRs */}
        <Panel>
          <div className="panel-heading" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Linked Engineering Artifacts</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '2px 0 0' }}>Commits and PRs automatically associated with tasks via message references.</p>
            </div>
          </div>

          {data?.links.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {data.links.map((link) => (
                <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {link.github_type === 'pull_request' ? <GitPullRequest size={16} /> : <GitCommit size={16} />}
                    <div>
                      <strong style={{ fontSize: '0.85rem' }}>{link.taskTitle || link.resource_id}</strong>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                        <span className="mono-data" style={{ fontSize: '0.75rem' }}>{link.github_id.slice(0, 10)}</span>
                        <span style={{ color: 'var(--color-muted)', fontSize: '0.7rem' }}>· {formatDate(link.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {safeHttpUrl(link.url) ? (
                    <a
                      href={safeHttpUrl(link.url)!}
                      target="_blank"
                      rel="noreferrer noopener"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-cyan-sentinel)', textDecoration: 'none' }}
                    >
                      Inspect <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No artifacts linked"
              body="Commits mentioning task IDs (e.g. task_1_1) in their messages will automatically anchor here."
            />
          )}
        </Panel>

        {/* Webhook Delivery Audit Log */}
        <Panel>
          <div className="panel-heading" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Webhook Delivery Audit Trail</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '2px 0 0' }}>Verified raw payloads ingested by the sentinel worker.</p>
            </div>
          </div>

          {data?.events.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {data.events.map((ev) => (
                <div key={ev.id} style={{ padding: '10px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ padding: '1px 6px', background: 'var(--color-surface)', borderRadius: '3px', border: '1px solid var(--color-border)', fontSize: '0.7rem', fontWeight: 600 }}>
                        {ev.eventType}
                      </span>
                      {ev.action && <span style={{ color: 'var(--color-muted)' }}>({ev.action})</span>}
                    </div>
                    <small style={{ color: 'var(--color-muted)', fontSize: '0.7rem' }}>{formatDate(ev.receivedAt)}</small>
                  </div>
                  <pre style={{ margin: 0, padding: '6px', background: 'var(--color-surface)', borderRadius: '3px', fontSize: '0.7rem', overflowX: 'auto', color: 'var(--color-muted)' }}>
                    {ev.payloadExcerpt}...
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No webhook events"
              body="Events will stream in as GitHub actions trigger webhook calls to this sentinel workspace."
            />
          )}
        </Panel>
      </div>

      {/* Pull Request Modal */}
      {isPrOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '560px', width: '100%', maxHeight: '88vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Open a linked pull request</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>The task reference is appended to the PR body and the artifact is recorded in provenance.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsPrOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(event) => { event.preventDefault(); createPr.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label>
                <small>Task ID *</small>
                <input
                  type="text"
                  required
                  value={prTaskId}
                  onChange={(event) => setPrTaskId(event.target.value)}
                  placeholder="task_..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                />
              </label>

              <label>
                <small>Pull request title *</small>
                <input
                  type="text"
                  required
                  maxLength={180}
                  value={prTitle}
                  onChange={(event) => setPrTitle(event.target.value)}
                  placeholder="feat(firmware): ..."
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label>
                  <small>Head branch *</small>
                  <input
                    type="text"
                    required
                    value={prHead}
                    onChange={(event) => setPrHead(event.target.value)}
                    placeholder="feature/telemetry"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                  />
                </label>
                <label>
                  <small>Base branch</small>
                  <input
                    type="text"
                    value={prBase}
                    onChange={(event) => setPrBase(event.target.value)}
                    placeholder="main"
                    style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit' }}
                  />
                </label>
              </div>

              <label>
                <small>Description</small>
                <textarea
                  rows={4}
                  value={prBody}
                  onChange={(event) => setPrBody(event.target.value)}
                  placeholder="Implementation notes, evidence references and validation summary…"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'inherit', resize: 'vertical' }}
                />
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={prDraft} onChange={(event) => setPrDraft(event.target.checked)} />
                <small>Create as draft pull request</small>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsPrOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={createPr.isPending || !prTaskId.trim() || !prTitle.trim() || !prHead.trim()}>
                  {createPr.isPending ? 'Opening…' : 'Open pull request'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Configuration Modal */}
      {isConfigOpen && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, padding: '20px' }}>
          <div className="modal-card" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '8px', maxWidth: '500px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--color-border)', paddingBottom: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>GitHub Integration Settings</h2>
              <Button variant="ghost" size="sm" onClick={() => setIsConfigOpen(false)}><X size={18} /></Button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); saveSettings.mutate(); }} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label>
                <small>Repository Full Name (owner/repo) *</small>
                <input
                  type="text"
                  required
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="e.g. Mostafa-Galal-sudo/cerberus-firmware"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Primary Sync Branch</small>
                <input
                  type="text"
                  value={syncBranch}
                  onChange={(e) => setSyncBranch(e.target.value)}
                  placeholder="main"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
              </label>

              <label>
                <small>Webhook Secret (HMAC-SHA256)</small>
                <input
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="Leave blank to keep existing secret"
                  style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
                />
                <small style={{ color: 'var(--color-muted)', display: 'block', marginTop: '4px' }}>
                  Used to verify the X-Hub-Signature-256 header sent on each webhook payload.
                </small>
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <Button type="button" variant="ghost" onClick={() => setIsConfigOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saveSettings.isPending || !repoName}>
                  {saveSettings.isPending ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
