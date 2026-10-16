import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Database,
  Download,
  Search,
  Settings,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { Button, EmptyState, PageSkeleton, Panel } from '../../components/ui';
import { api, ApiError, formatDate } from '../../lib/api';

interface AdminMetrics {
  users: number;
  tasks: number;
  approvedTasks: number;
  submissions: number;
  pendingSubmissions: number;
  reviews: number;
  auditLogs: number;
  openBlockers: number;
  openBugs: number;
  hardwareUnits: number;
  experiments: number;
  wikiPages: number;
  activeSessions: number;
}

interface AuditLogItem {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadataJson: string;
  createdAt: number;
  actorName?: string | null;
  actorEmail?: string | null;
}

export function AdminCommandCenterPage() {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'telemetry' | 'audit' | 'backup' | 'settings'>('telemetry');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  // Settings State
  const [workspaceName, setWorkspaceName] = useState('CERBERUS WORKSPACE');
  const [assistantEnabled, setAssistantEnabled] = useState(true);

  const metricsQuery = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: () => api<AdminMetrics>('/admin/metrics'),
  });

  const auditQuery = useQuery({
    queryKey: ['admin-audit', auditActionFilter],
    queryFn: () => {
      const q = auditActionFilter ? `?action=${encodeURIComponent(auditActionFilter)}` : '';
      return api<AuditLogItem[]>(`/admin/audit-logs${q}`);
    },
    enabled: activeTab === 'audit',
  });


  const saveSettings = useMutation({
    mutationFn: () =>
      api('/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          'workspace.name': workspaceName,
          'assistant.enabled': assistantEnabled,
        }),
      }),
    onSuccess: () => {
      setFeedback('Workspace administrative settings persisted.');
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Settings save failed'),
  });

  const exportBackup = useMutation({
    mutationFn: () => api<{ backupId: string; checksum: string; totalRecords: number; exportedAt: number; payload: unknown }>('/admin/backup/export'),
    onSuccess: (data) => {
      // Trigger browser JSON download
      const jsonStr = JSON.stringify(data.payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cerberus-backup-${new Date().toISOString().slice(0, 10)}-${data.checksum.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setFeedback(`Backup exported successfully. Checksum SHA-256: ${data.checksum} (${data.totalRecords} records).`);
    },
    onError: (err) => setFeedback(err instanceof ApiError ? err.message : 'Backup export failed'),
  });

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const payload = JSON.parse(content) as { version: string; tables: Record<string, unknown[]> };
        const res = await api<{ restored: boolean; checksum: string; totalRecords: number }>('/admin/backup/restore', {
          method: 'POST',
          body: JSON.stringify({ payload }),
        });
        setFeedback(`Backup verified and restored: ${res.totalRecords} records. Checksum: ${res.checksum}`);
        void queryClient.invalidateQueries({ queryKey: ['admin-metrics'] });
      } catch (err) {
        setFeedback(err instanceof ApiError ? err.message : 'Restore verification failed');
      }
    };
    reader.readAsText(file);
  };

  const m = metricsQuery.data;

  return (
    <div className="page admin-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Highest Sentinel Authority</span>
          <h1>Admin Command Center & Operations</h1>
          <p>System-wide telemetry, cryptographic audit logs, database backups, and access policy control.</p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportBackup.mutate()}
            disabled={exportBackup.isPending}
          >
            <Download size={14} /> {exportBackup.isPending ? 'Generating...' : 'Export DB Backup'}
          </Button>
        </div>
      </header>

      {feedback && (
        <div style={{ padding: '10px 16px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem' }}>{feedback}</span>
          <Button variant="ghost" size="sm" onClick={() => setFeedback(null)}>Dismiss</Button>
        </div>
      )}

      {/* Admin Navigation Tabs */}
      <Panel className="task-toolbar" style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <Button
          variant={activeTab === 'telemetry' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('telemetry')}
        >
          <Activity size={15} /> Operational Telemetry
        </Button>
        <Button
          variant={activeTab === 'audit' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('audit')}
        >
          <ShieldCheck size={15} /> Audit Log Trail
        </Button>
        <Button
          variant={activeTab === 'backup' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('backup')}
        >
          <Database size={15} /> Backup & Recovery
        </Button>
        <Button
          variant={activeTab === 'settings' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={15} /> System Configuration
        </Button>
      </Panel>

      {/* Tab 1: Operational Telemetry */}
      {activeTab === 'telemetry' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {metricsQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <Panel style={{ padding: '16px' }}>
                  <small style={{ color: 'var(--color-muted)' }}>Registered Members</small>
                  <strong style={{ fontSize: '1.6rem', display: 'block', margin: '4px 0' }}>{m?.users ?? 0}</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-matrix-emerald)' }}>
                    {m?.activeSessions ?? 0} active sessions
                  </span>
                </Panel>

                <Panel style={{ padding: '16px' }}>
                  <small style={{ color: 'var(--color-muted)' }}>Task Completion</small>
                  <strong style={{ fontSize: '1.6rem', display: 'block', margin: '4px 0' }}>
                    {m?.approvedTasks ?? 0} / {m?.tasks ?? 0}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)' }}>
                    {m?.tasks ? Math.round(((m.approvedTasks) / m.tasks) * 100) : 0}% approved
                  </span>
                </Panel>

                <Panel style={{ padding: '16px' }}>
                  <small style={{ color: 'var(--color-muted)' }}>Review Queue</small>
                  <strong style={{ fontSize: '1.6rem', display: 'block', margin: '4px 0' }}>
                    {m?.pendingSubmissions ?? 0}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: m?.pendingSubmissions ? 'var(--color-magma-flame)' : 'var(--color-muted)' }}>
                    {m?.reviews ?? 0} total evaluations logged
                  </span>
                </Panel>

                <Panel style={{ padding: '16px' }}>
                  <small style={{ color: 'var(--color-muted)' }}>Active Obstacles</small>
                  <strong style={{ fontSize: '1.6rem', display: 'block', margin: '4px 0', color: m?.openBlockers ? 'var(--color-status-blocked)' : 'inherit' }}>
                    {m?.openBlockers ?? 0}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    {m?.openBugs ?? 0} open bug defects
                  </span>
                </Panel>

                <Panel style={{ padding: '16px' }}>
                  <small style={{ color: 'var(--color-muted)' }}>Knowledge & Assets</small>
                  <strong style={{ fontSize: '1.6rem', display: 'block', margin: '4px 0' }}>
                    {m?.wikiPages ?? 0}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    {m?.hardwareUnits ?? 0} HW units · {m?.experiments ?? 0} experiments
                  </span>
                </Panel>

                <Panel style={{ padding: '16px' }}>
                  <small style={{ color: 'var(--color-muted)' }}>Audit Log Records</small>
                  <strong style={{ fontSize: '1.6rem', display: 'block', margin: '4px 0' }}>
                    {m?.auditLogs ?? 0}
                  </strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-cyan-sentinel)' }}>
                    Continuous append-only record
                  </span>
                </Panel>
              </div>

              <Panel style={{ padding: '20px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '1.1rem' }}>Sentinel System Integrity Verification</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'var(--color-surface-subtle)', borderRadius: '4px' }}>
                    <ShieldCheck size={20} style={{ color: 'var(--color-matrix-emerald)' }} />
                    <div>
                      <strong>Self-Approval Prevention: ACTIVE</strong>
                      <small style={{ display: 'block', color: 'var(--color-muted)' }}>Engineers cannot administratively approve their own submissions</small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'var(--color-surface-subtle)', borderRadius: '4px' }}>
                    <ShieldCheck size={20} style={{ color: 'var(--color-matrix-emerald)' }} />
                    <div>
                      <strong>Acyclic Dependency Guard: ACTIVE</strong>
                      <small style={{ display: 'block', color: 'var(--color-muted)' }}>Recursive CTE cycle detection rejects circular prerequisite tasks</small>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'var(--color-surface-subtle)', borderRadius: '4px' }}>
                    <ShieldCheck size={20} style={{ color: 'var(--color-matrix-emerald)' }} />
                    <div>
                      <strong>PBKDF2 Cryptographic Hashes: ACTIVE</strong>
                      <small style={{ display: 'block', color: 'var(--color-muted)' }}>310,000 PBKDF2 iterations with unique 16-byte cryptographically secure salts</small>
                    </div>
                  </div>
                </div>
              </Panel>
            </>
          )}
        </div>
      )}

      {/* Tab 2: Audit Log Trail */}
      {activeTab === 'audit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Panel style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="search-box" style={{ maxWidth: '340px' }}>
              <Search size={16} />
              <input
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
                placeholder="Filter by action (e.g. task, auth, review)..."
              />
            </label>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              Showing {auditQuery.data?.length ?? 0} entries
            </span>
          </Panel>

          {auditQuery.isLoading ? (
            <PageSkeleton />
          ) : auditQuery.data?.length ? (
            <div className="task-table" role="table">
              <div className="task-table-head" role="row">
                <span>Action</span>
                <span>Actor</span>
                <span>Target</span>
                <span>Timestamp</span>
              </div>
              {auditQuery.data.map((entry) => (
                <div className="task-table-row" role="row" key={entry.id} style={{ cursor: 'default' }}>
                  <span>
                    <strong style={{ color: 'var(--color-cyan-sentinel)' }}>{entry.action}</strong>
                    <code className="mono-data" style={{ fontSize: '0.7rem', display: 'block', marginTop: '2px' }}>
                      {entry.metadataJson}
                    </code>
                  </span>
                  <span>
                    <strong>{entry.actorName ?? 'System Sentinel'}</strong>
                    <small>{entry.actorEmail ?? 'internal'}</small>
                  </span>
                  <span>
                    <span style={{ textTransform: 'capitalize' }}>{entry.resourceType}</span>
                    <code className="mono-data" style={{ fontSize: '0.7rem', display: 'block' }}>{entry.resourceId}</code>
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No audit logs matched" body="Adjust your filter to inspect other logged security events." />
          )}
        </div>
      )}

      {/* Tab 3: Backup & Recovery */}
      {activeTab === 'backup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Panel style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <Download size={22} style={{ color: 'var(--color-cyan-sentinel)' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Export Full Database Backup</h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', lineHeight: 1.6, marginBottom: '20px' }}>
                Generates a complete, verifiable JSON archive of all tables (identities, tasks, roadmaps, evidence, submissions, wiki, and audit records) with an immutable SHA-256 cryptographic checksum.
              </p>
              <Button
                variant="primary"
                onClick={() => exportBackup.mutate()}
                disabled={exportBackup.isPending}
              >
                <Download size={16} /> {exportBackup.isPending ? 'Packaging backup...' : 'Download Verified Archive'}
              </Button>
            </Panel>

            <Panel style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <Upload size={22} style={{ color: 'var(--color-matrix-emerald)' }} />
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Restore & Verify Backup</h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', lineHeight: 1.6, marginBottom: '20px' }}>
                Upload an exported JSON backup file. The worker will verify the payload structure, re-compute the SHA-256 checksum, and log the restoration event into the immutable audit record.
              </p>
              <label style={{ display: 'inline-block' }}>
                <span className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <Upload size={16} /> Select Backup JSON File
                </span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFile}
                  style={{ display: 'none' }}
                />
              </label>
            </Panel>
          </div>
        </div>
      )}

      {/* Tab 4: System Configuration */}
      {activeTab === 'settings' && (
        <Panel style={{ maxWidth: '640px', padding: '24px' }}>
          <h2 style={{ margin: '0 0 16px', fontSize: '1.2rem' }}>Workspace Parameters</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveSettings.mutate();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <label>
              <small>Workspace Brand Name</small>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                style={{ width: '100%', padding: '8px', background: 'var(--color-surface-subtle)', border: '1px solid var(--color-border)', borderRadius: '4px' }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={assistantEnabled}
                onChange={(e) => setAssistantEnabled(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <div>
                <strong>Enable AI Sentinel Assistant</strong>
                <small style={{ display: 'block', color: 'var(--color-muted)' }}>
                  Provides automated context retrieval and grounding across tasks, wiki, and blockers.
                </small>
              </div>
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
              <Button type="submit" variant="primary" disabled={saveSettings.isPending}>
                {saveSettings.isPending ? 'Saving...' : 'Save Configuration'}
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
