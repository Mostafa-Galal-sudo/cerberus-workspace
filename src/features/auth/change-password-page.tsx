import { zodResolver } from '@hookform/resolvers/zod';
import { Check, LogOut, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../../app/auth-context';
import { Button, Field } from '../../components/ui';
import { CerberusLogo } from '../../components/cerberus-logo';
import { api, ApiError } from '../../lib/api';

const schema = z.object({
  currentPassword: z.string().min(12, 'Enter the temporary password'),
  newPassword: z.string().min(12, 'Use at least 12 characters')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number')
    .regex(/[^A-Za-z0-9]/, 'Include a symbol'),
  confirmation: z.string(),
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ['newPassword'], message: 'Choose a different password from the temporary one',
}).refine((value) => value.newPassword === value.confirmation, {
  path: ['confirmation'], message: 'Passwords do not match',
});

type FormData = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setError('');
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The password could not be changed');
    }
  });

  return (
    <main className="simple-auth password-gate">
      <form className="auth-form activation-form" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <CerberusLogo size="sm" />
          <div className="activation-icon" style={{ borderColor: 'var(--color-magma-border)', color: 'var(--color-magma-amber)' }}>
            <ShieldAlert size={22} />
          </div>
        </div>

        <div>
          <span className="form-index">Mandatory Sentinel Gate</span>
          <h2>Replace temporary password</h2>
          <p>Welcome, {user?.displayName}. Before accessing the engineering workspace, establish a permanent private password.</p>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        <Field label="Temporary password" error={errors.currentPassword?.message}>
          <input type="password" autoComplete="current-password" {...register('currentPassword')} />
        </Field>

        <Field label="New master password" error={errors.newPassword?.message}>
          <input type="password" autoComplete="new-password" {...register('newPassword')} />
        </Field>

        <Field label="Confirm new password" error={errors.confirmation?.message}>
          <input type="password" autoComplete="new-password" {...register('confirmation')} />
        </Field>

        <ul className="password-rules">
          <li><Check />12 or more characters</li>
          <li><Check />Uppercase, lowercase, number, and symbol</li>
          <li><Check />Different from the temporary password</li>
        </ul>

        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? 'Updating credentials…' : 'Establish password and proceed'}
        </Button>

        <Button type="button" variant="ghost" onClick={() => void logout()}>
          <LogOut size={15} />
          Sign out
        </Button>
      </form>
    </main>
  );
}
