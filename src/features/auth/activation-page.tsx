import { zodResolver } from '@hookform/resolvers/zod';
import { Check, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Field } from '../../components/ui';
import { CerberusLogo } from '../../components/cerberus-logo';
import { api, ApiError, setCsrfToken } from '../../lib/api';
import { useAuth } from '../../app/auth-context';

const schema = z.object({
  password: z.string().min(12).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  confirmation: z.string(),
}).refine((data) => data.password === data.confirmation, { path: ['confirmation'], message: 'Passwords do not match' });

type FormData = z.infer<typeof schema>;

export function ActivationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [error, setError] = useState('');
  const token = params.get('token') ?? '';
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async ({ password }) => {
    try {
      const data = await api<{ csrfToken: string }>('/auth/activate', { method: 'POST', body: JSON.stringify({ token, password }) });
      setCsrfToken(data.csrfToken);
      await refresh();
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Account activation failed');
    }
  });

  return (
    <main className="simple-auth">
      <form className="auth-form activation-form" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <CerberusLogo size="sm" />
          <div className="activation-icon"><KeyRound size={22} /></div>
        </div>

        <div>
          <span className="form-index">One-Time Activation</span>
          <h2>Secure your sentinel account</h2>
          <p>Create your personal master password. Your invitation token is single-use and will be permanently retired.</p>
        </div>

        {!token && <div className="form-error">The activation token is missing from this link.</div>}
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
          {isSubmitting ? 'Activating account…' : 'Activate account'}
        </Button>
      </form>
    </main>
  );
}
