import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router-dom';
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

export function LoginPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to="/" replace />;

  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const data = await api<{ csrfToken: string; mustChangePassword: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setCsrfToken(data.csrfToken);
      await refresh();
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign in could not be completed');
    }
  });

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
            <span>Invite-only engineering platform. Contact the workspace administrator if your credentials need reissuance.</span>
          </p>
        </form>
      </section>
    </main>
  );
}
