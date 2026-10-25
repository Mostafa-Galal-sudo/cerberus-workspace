import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../../app/auth-context';
import { Button, Field } from '../../components/ui';
import { CerberusLogo } from '../../components/cerberus-logo';
import { api, ApiError, setCsrfToken } from '../../lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
});
type FormData = z.infer<typeof schema>;

interface LoginResponse {
  csrfToken?: string;
  mustChangePassword?: boolean;
  mfaRequired?: boolean;
  challengeToken?: string;
  expiresIn?: number;
}

interface MfaChallenge {
  token: string;
  email: string;
  expiresIn: number;
}

export function LoginPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [code, setCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to="/" replace />;

  const finish = async (data: { csrfToken: string; mustChangePassword: boolean }) => {
    setCsrfToken(data.csrfToken);
    await refresh();
    navigate('/');
  };

  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const data = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      if (data.mfaRequired && data.challengeToken) {
        setChallenge({ token: data.challengeToken, email: values.email, expiresIn: data.expiresIn ?? 300 });
        setCode('');
        setMfaError('');
        return;
      }
      if (!data.csrfToken) throw new Error('Login response did not include a session token');
      await finish({ csrfToken: data.csrfToken, mustChangePassword: Boolean(data.mustChangePassword) });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign in could not be completed');
    }
  });

  const verifyMfa = async (event: FormEvent) => {
    event.preventDefault();
    if (!challenge || mfaSubmitting) return;
    setMfaError('');
    setMfaSubmitting(true);
    try {
      const data = await api<{ csrfToken: string; mustChangePassword: boolean }>('/auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify({ challengeToken: challenge.token, code: code.trim() }),
      });
      await finish(data);
    } catch (cause) {
      setMfaError(cause instanceof ApiError ? cause.message : 'Verification could not be completed');
      if (cause instanceof ApiError && cause.body.code === 'MFA_CHALLENGE_INVALID') {
        setChallenge(null);
        setCode('');
      }
    } finally {
      setMfaSubmitting(false);
    }
  };

  const resetChallenge = () => {
    setChallenge(null);
    setCode('');
    setMfaError('');
  };

  return (
    <main className="auth-page">
      {/* Gothic Sentinel Hero (Archival Engraving & Master Identity) */}
      <section className="auth-context">
        <CerberusLogo size="lg" />
        <div className="auth-statement">
          <span className="signal-line" />
          <h1>Evidence before approval.</h1>
          <p>One operational record for six engineering disciplines, their decisions, and the work that proves progress.</p>
        </div>

        <div className="trust-note">
          <ShieldCheck size={20} />
          <span>
            <strong>IMMUTABLE SENTINEL PROVENANCE</strong>
            <small>Attributable audit logging and independent administrative review required.</small>
          </span>
        </div>
      </section>

      {/* Terminal Sign In Form */}
      <section className="auth-form-wrap">
        {challenge ? (
          <form className="auth-form" onSubmit={verifyMfa}>
            <div className="md:hidden" style={{ marginBottom: '12px' }}>
              <CerberusLogo size="md" />
            </div>

            <div>
              <span className="form-index">Second factor required</span>
              <h2>Verify it is you</h2>
              <p>Enter the 6-digit code from your authenticator app for {challenge.email}, or use one recovery code.</p>
            </div>

            {mfaError && <div className="form-error" role="alert">{mfaError}</div>}

            <Field label="Authenticator code or recovery code">
              <input
                autoFocus
                autoComplete="one-time-code"
                inputMode="text"
                placeholder="123456"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                maxLength={64}
              />
            </Field>

            <Button type="submit" size="lg" disabled={mfaSubmitting || code.trim().length < 6}>
              {mfaSubmitting ? 'Verifying second factor…' : 'Verify and enter workspace'}
              <KeyRound size={17} />
            </Button>

            <p className="auth-help">
              <LockKeyhole size={14} />
              <span>
                This verification window closes in {Math.round(challenge.expiresIn / 60)} minutes.{' '}
                <button type="button" className="link-button" onClick={resetChallenge}>Use a different account</button>
              </span>
            </p>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <div className="md:hidden" style={{ marginBottom: '12px' }}>
              <CerberusLogo size="md" />
            </div>

            <div>
              <span className="form-index">Sentinel Access Gate</span>
              <h2>Sign in</h2>
              <p>Use the account activated from your private invitation.</p>
            </div>

            {error && <div className="form-error" role="alert">{error}</div>}

            <Field label="Email address" error={errors.email?.message}>
              <input autoComplete="email" type="email" placeholder="member@cerberus.local" {...register('email')} />
            </Field>

            <Field label="Password" error={errors.password?.message}>
              <input autoComplete="current-password" type="password" {...register('password')} />
            </Field>

            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? 'Verifying credentials…' : 'Enter workspace'}
              <ArrowRight size={17} />
            </Button>

            <p className="auth-help">
              <LockKeyhole size={14} />
              <span>Invite-only engineering platform. Lost your password? <Link to="/forgot-password">Request a one-time reset link</Link>.</span>
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
