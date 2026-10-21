import { zodResolver } from '@hookform/resolvers/zod';
import { Check, KeyRound, LogIn } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Field } from '../../components/ui';
import { CerberusLogo } from '../../components/cerberus-logo';
import { api, ApiError } from '../../lib/api';

const schema = z.object({
  password: z.string().min(12).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  confirmation: z.string(),
}).refine((data) => data.password === data.confirmation, { path: ['confirmation'], message: 'Passwords do not match' });

type FormData = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const token = params.get('token') ?? '';
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async ({ password }) => {
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      setCompleted(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Password reset failed');
    }
  });

  return (
    <main className="simple-auth">
      <form className="auth-form activation-form" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <CerberusLogo size="sm" />
          <div className="activation-icon"><KeyRound size={22} /></div>
        </div>

        {completed ? (
          <>
            <div>
              <span className="form-index">Credential Recovery</span>
              <h2>Password replaced</h2>
              <p>Every previous session for this account has been revoked. Sign in with your new password.</p>
            </div>
            <Link to="/login" className="button button-primary button-lg" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <LogIn size={17} /> Return to sign in
            </Link>
          </>
        ) : (
          <>
            <div>
              <span className="form-index">One-Time Password Reset</span>
              <h2>Replace your workspace password</h2>
              <p>This reset link was issued by a workspace administrator, expires after one hour, and can be used once.</p>
            </div>

            {!token && <div className="form-error">The reset token is missing from this link. Ask an administrator to issue a new one.</div>}
            {error && <div className="form-error">{error}</div>}

            <Field label="New password" error={errors.password?.message && 'Use 12+ characters with upper, lower, number, and symbol'}>
              <input type="password" autoComplete="new-password" {...register('password')} />
            </Field>

            <Field label="Confirm password" error={errors.confirmation?.message}>
              <input type="password" autoComplete="new-password" {...register('confirmation')} />
            </Field>

            <ul className="password-rules">
              <li><Check />12 or more characters</li>
              <li><Check />Uppercase, lowercase, number, and symbol</li>
            </ul>

            <Button disabled={!token || isSubmitting} size="lg">
              {isSubmitting ? 'Replacing password…' : 'Replace password'}
            </Button>

            <p className="auth-help">
              <Link to="/login">Return to sign in</Link>
            </p>
          </>
        )}
      </form>
    </main>
  );
}
