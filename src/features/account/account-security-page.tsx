import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  KeyRound,
  Laptop,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  XCircle,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Field, PageSkeleton, Panel } from '../../components/ui';
import { api, apiWithMeta, ApiError, formatDate, type PageMeta } from '../../lib/api';

interface SecurityOverview {
  profile: {
    id: string;
    email: string;
    displayName: string;
    specialization: string | null;
    roles: string[];
  };
  security: {
    idleTimeoutMinutes: number;
    activeSessions: number;
    mfa: { enabled: boolean; confirmedAt: number | null; recoveryCodesRemaining: number };
    lastLoginAt: number | null;
    lastLoginMethod: string | null;
  };
}

interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

interface LoginEvent {
  id: string;
  success: boolean;
  method: string;
  reason: string | null;
  userAgent: string | null;
  ipFingerprint: string | null;
  createdAt: number;
}

interface MfaSetup {
  secret: string;
  otpauthUri: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
}

const METHOD_LABELS: Record<string, string> = {
  password: 'Password',
  mfa: 'Authenticator',
  recovery_code: 'Recovery code',
};

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return 'The request could not be completed';
}

function reasonLabel(event: LoginEvent): string {
  if (event.success) return event.reason === 'mfa_required' ? 'Password verified · MFA pending' : 'Signed in';
  if (event.reason === 'invalid_credentials') return 'Wrong email or password';
  if (event.reason === 'invalid_code') return 'Wrong authenticator code';
  if (event.reason === 'replayed_code') return 'Replayed authenticator code rejected';
  return event.reason ?? 'Failed';
}

export function AccountSecurityPage() {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mfaError, setMfaError] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState('');
  const [regenerateCode, setRegenerateCode] = useState('');
  const [sessionPage, setSessionPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ['account', 'overview'],
    queryFn: () => api<SecurityOverview>('/account/overview'),
  });
  const sessionsQuery = useQuery({
    queryKey: ['account', 'sessions', sessionPage],
    queryFn: () => apiWithMeta<{ sessions: SessionInfo[] }, PageMeta>(`/account/sessions?page=${sessionPage}&limit=10`),
  });
  const historyQuery = useQuery({
    queryKey: ['account', 'login-history', historyPage],
    queryFn: () => apiWithMeta<{ events: LoginEvent[] }, PageMeta>(`/account/login-history?page=${historyPage}&limit=10`),
  });

  const refreshAccount = () => queryClient.invalidateQueries({ queryKey: ['account'] });

  const setupMutation = useMutation({
    mutationFn: () => api<MfaSetup>('/account/mfa/setup', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (data) => { setSetup(data); setMfaError(''); setRecoveryCodes(null); },
    onError: (cause) => setMfaError(errorMessage(cause)),
  });

  const confirmMutation = useMutation({
    mutationFn: () => api<{ enabled: boolean; recoveryCodes: string[] }>('/account/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ code: confirmCode.trim() }),
    }),
    onSuccess: (data) => {
      setSetup(null);
      setConfirmCode('');
      setRecoveryCodes(data.recoveryCodes);
      setMfaError('');
      void refreshAccount();
    },
    onError: (cause) => setMfaError(errorMessage(cause)),
  });

  const disableMutation = useMutation({
    mutationFn: () => api<{ enabled: boolean }>('/account/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ password: disablePassword, code: disableCode.trim() }),
    }),
    onSuccess: () => {
      setDisableOpen(false);
      setDisablePassword('');
      setDisableCode('');
      setMfaError('');
      void refreshAccount();
      void queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
    },
    onError: (cause) => setMfaError(errorMessage(cause)),
  });

  const regenerateMutation = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/account/mfa/recovery-codes', {
      method: 'POST',
      body: JSON.stringify({ password: regeneratePassword, code: regenerateCode.trim() }),
    }),
    onSuccess: (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setRegenerateOpen(false);
      setRegeneratePassword('');
      setRegenerateCode('');
      setMfaError('');
      void refreshAccount();
    },
    onError: (cause) => setMfaError(errorMessage(cause)),
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => api<{ revoked: boolean; current: boolean }>(`/account/sessions/${sessionId}/revoke`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['account', 'overview'] });
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => api<{ revokedCount: number }>('/account/sessions/revoke-others', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['account', 'overview'] });
    },
  });

  if (overviewQuery.isLoading) return <div className="page"><PageSkeleton /></div>;
  if (overviewQuery.isError || !overviewQuery.data) {
    return <div className="page"><div className="form-error" role="alert">Account security data could not be loaded.</div></div>;
  }

  const overview = overviewQuery.data;
  const sessions = sessionsQuery.data?.data.sessions ?? [];
  const sessionsMeta = sessionsQuery.data?.meta;
  const events = historyQuery.data?.data.events ?? [];
  const historyMeta = historyQuery.data?.meta;
  const mfa = overview.security.mfa;

  const copySecret = async () => {
    if (!setup) return;
    await navigator.clipboard.writeText(setup.secret).catch(() => undefined);
    setCopiedSecret(true);
  };

  const submitConfirm = (event: FormEvent) => {
    event.preventDefault();
    confirmMutation.mutate();
  };

  return (
    <div className="page account-security-page">
      <header className="page-header">
        <div>
          <span className="breadcrumb">Account &amp; security center</span>
          <h1>Protect your workspace identity</h1>
          <p>Manage authenticator protection, active sessions, and the authentication history attached to your account.</p>
        </div>
        {mfa.enabled ? <span className="badge badge-success"><ShieldCheck size={14} /> MFA enabled</span> : <span className="badge"><ShieldQuestion size={14} /> MFA not enabled</span>}
      </header>

      <div className="security-grid">
        <Panel>
          <div className="panel-heading">
            <h2>Identity</h2>
            <Laptop size={16} />
          </div>
          <dl className="security-facts">
            <div><dt>Name</dt><dd>{overview.profile.displayName}</dd></div>
            <div><dt>Email</dt><dd className="mono-data">{overview.profile.email}</dd></div>
            <div><dt>Roles</dt><dd>{overview.profile.roles.join(', ') || 'None'}</dd></div>
            <div><dt>Last successful sign-in</dt><dd>{formatDate(overview.security.lastLoginAt)}</dd></div>
            <div><dt>Active sessions</dt><dd>{overview.security.activeSessions}</dd></div>
            <div><dt>Idle lock</dt><dd>{Math.round(overview.security.idleTimeoutMinutes / 60 * 10) / 10} hours of inactivity</dd></div>
          </dl>
        </Panel>

        <Panel>
          <div className="panel-heading">
            <h2>Authenticator protection</h2>
            <KeyRound size={16} />
          </div>

          {mfaError && <div className="form-error" role="alert" style={{ marginBottom: '10px' }}>{mfaError}</div>}

          {recoveryCodes ? (
            <div className="security-recovery">
              <p><strong>Store these recovery codes now.</strong> Each code works once and is not shown again.</p>
              <div className="recovery-grid">
                {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
              </div>
              <Button type="button" onClick={() => setRecoveryCodes(null)}>I stored these codes</Button>
            </div>
          ) : setup ? (
            <div className="security-setup">
              <p>Add this account to your authenticator app, then enter the current 6-digit code to confirm.</p>
              <div className="security-secret">
                <code>{setup.secret}</code>
                <button type="button" aria-label="Copy authenticator secret" onClick={() => void copySecret()}>
                  {copiedSecret ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                </button>
              </div>
              <p className="security-mono-note">Key URI: <span className="mono-data">{setup.otpauthUri}</span></p>
              <form onSubmit={submitConfirm} className="security-inline-form">
                <Field label="6-digit authenticator code">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={confirmCode}
                    onChange={(event) => setConfirmCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                  />
                </Field>
                <Button type="submit" disabled={confirmCode.length !== 6 || confirmMutation.isPending}>
                  {confirmMutation.isPending ? 'Confirming…' : 'Confirm and enable'}
                </Button>
              </form>
              <Button variant="ghost" size="sm" type="button" onClick={() => { setSetup(null); setConfirmCode(''); setMfaError(''); }}>
                Cancel setup
              </Button>
            </div>
          ) : mfa.enabled ? (
            <div className="security-setup">
              <p><ShieldCheck size={15} /> Enabled on {formatDate(mfa.confirmedAt)}. Recovery codes remaining: <strong>{mfa.recoveryCodesRemaining}</strong>.</p>

              {regenerateOpen ? (
                <form
                  className="security-inline-form"
                  onSubmit={(event) => { event.preventDefault(); regenerateMutation.mutate(); }}
                >
                  <Field label="Current password"><input type="password" autoComplete="current-password" value={regeneratePassword} onChange={(event) => setRegeneratePassword(event.target.value)} /></Field>
                  <Field label="Authenticator or recovery code"><input value={regenerateCode} onChange={(event) => setRegenerateCode(event.target.value)} /></Field>
                  <Button type="submit" disabled={regenerateMutation.isPending}>Regenerate recovery codes</Button>
                </form>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => { setRegenerateOpen(true); setDisableOpen(false); setMfaError(''); }}>
                  Regenerate recovery codes
                </Button>
              )}

              {disableOpen ? (
                <form
                  className="security-inline-form"
                  onSubmit={(event) => { event.preventDefault(); disableMutation.mutate(); }}
                >
                  <Field label="Current password"><input type="password" autoComplete="current-password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} /></Field>
                  <Field label="Authenticator or recovery code"><input value={disableCode} onChange={(event) => setDisableCode(event.target.value)} /></Field>
                  <Button type="submit" variant="danger" disabled={disableMutation.isPending}>Disable MFA and revoke other sessions</Button>
                </form>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => { setDisableOpen(true); setRegenerateOpen(false); setMfaError(''); }}>
                  <ShieldOff size={14} /> Disable MFA
                </Button>
              )}
            </div>
          ) : (
            <div className="security-setup">
              <p>Require a time-based one-time code from an authenticator app after your password. Ten single-use recovery codes are issued when you confirm setup.</p>
              <Button type="button" onClick={() => setupMutation.mutate()} disabled={setupMutation.isPending}>
                <ShieldCheck size={15} /> {setupMutation.isPending ? 'Preparing secret…' : 'Enable authenticator protection'}
              </Button>
            </div>
          )}
        </Panel>

        <Panel className="security-span">
          <div className="panel-heading">
            <h2>Active sessions</h2>
            <Button variant="ghost" size="sm" onClick={() => revokeOthersMutation.mutate()} disabled={revokeOthersMutation.isPending || sessions.length <= 1}>
              Sign out all other sessions
            </Button>
          </div>
          {sessionsQuery.isLoading ? <PageSkeleton /> : (
            <div className="security-table-wrap">
              <table className="security-table">
                <thead><tr><th>Client</th><th>Created</th><th>Last seen</th><th>Expires</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <span className="security-client">{session.userAgent ?? 'Unknown client'}</span>
                        {session.current && <span className="badge badge-success">This session</span>}
                      </td>
                      <td>{formatDate(session.createdAt)}</td>
                      <td>{formatDate(session.lastSeenAt)}</td>
                      <td>{formatDate(session.expiresAt)}</td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={revokeMutation.isPending}
                          onClick={() => revokeMutation.mutate(session.id)}
                          aria-label={`Revoke session created ${formatDate(session.createdAt)}`}
                        >
                          {session.current ? 'Sign out' : 'Revoke'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {sessions.length === 0 && <tr><td colSpan={5} className="security-empty">No active sessions.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {sessionsMeta && sessionsMeta.total > sessionsMeta.limit && (
            <div className="notification-pagination">
              <Button variant="ghost" size="sm" disabled={sessionPage <= 1} onClick={() => setSessionPage((page) => page - 1)}>Previous</Button>
              <span>Page {sessionsMeta.page} of {Math.max(1, Math.ceil(sessionsMeta.total / sessionsMeta.limit))}</span>
              <Button variant="ghost" size="sm" disabled={!sessionsMeta.hasMore} onClick={() => setSessionPage((page) => page + 1)}>Next</Button>
            </div>
          )}
        </Panel>

        <Panel className="security-span">
          <div className="panel-heading">
            <h2>Authentication history</h2>
            <span className="badge">90-day retention</span>
          </div>
          {historyQuery.isLoading ? <PageSkeleton /> : (
            <div className="security-table-wrap">
              <table className="security-table">
                <thead><tr><th>Result</th><th>Method</th><th>Detail</th><th>Client</th><th>IP fingerprint</th><th>When</th></tr></thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <span className={event.success ? 'security-result is-success' : 'security-result is-failure'}>
                          {event.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          {event.success ? 'Success' : 'Failed'}
                        </span>
                      </td>
                      <td>{METHOD_LABELS[event.method] ?? event.method}</td>
                      <td>{reasonLabel(event)}</td>
                      <td className="security-client">{event.userAgent ?? 'Unknown'}</td>
                      <td className="mono-data">{event.ipFingerprint ?? '—'}</td>
                      <td>{formatDate(event.createdAt)}</td>
                    </tr>
                  ))}
                  {events.length === 0 && <tr><td colSpan={6} className="security-empty">No authentication events recorded yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {historyMeta && historyMeta.total > historyMeta.limit && (
            <div className="notification-pagination">
              <Button variant="ghost" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => page - 1)}>Previous</Button>
              <span>Page {historyMeta.page} of {Math.max(1, Math.ceil(historyMeta.total / historyMeta.limit))}</span>
              <Button variant="ghost" size="sm" disabled={!historyMeta.hasMore} onClick={() => setHistoryPage((page) => page + 1)}>Next</Button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
