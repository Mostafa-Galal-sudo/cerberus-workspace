import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, KeyRound, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button, Field } from '../../components/ui';
import { CerberusLogo } from '../../components/cerberus-logo';
import { api, ApiError } from '../../lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
});

type FormData = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [delivery, setDelivery] = useState<'email' | 'administrator' | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async (values) => {
    setError('');
    try {
      const result = await api<{ requested: boolean; delivery: 'email' | 'administrator' }>('/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setDelivery(result.delivery);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Password recovery could not be requested');
    }
  });

  return (
    <main className="simple-auth">
      <form className="auth-form activation-form" onSubmit={submit}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <CerberusLogo size="sm" />
          <div className="activation-icon"><KeyRound size={22} /></div>
        </div>

        {delivery ? (
          <>
            <div>
              <span className="form-index">Credential Recovery</span>
              <h2>Request received</h2>
              <p>
                If an active account exists for that address, {delivery === 'email'
                  ? 'a one-time reset link is being delivered to its inbox. The link expires after one hour.'
                  : 'an administrator has been notified to issue a one-time reset link. Email delivery is not configured for this deployment.'}
              </p>
            </div>
            <Link to="/login" className="button button-primary button-lg" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <ArrowLeft size={17} /> Return to sign in
            </Link>
          </>
        ) : (
          <>
            <div>
              <span className="form-index">One-Time Password Recovery</span>
              <h2>Request a reset link</h2>
              <p>Enter the email address attached to your workspace account. The response is intentionally identical whether or not the account exists.</p>
            </div>

            {error && <div className="form-error">{error}</div>}

            <Field label="Email address" error={errors.email?.message}>
              <input type="email" autoComplete="email" placeholder="member@cerberus.local" {...register('email')} />
            </Field>

            <Button disabled={isSubmitting} size="lg">
              <Mail size={17} /> {isSubmitting ? 'Submitting request…' : 'Request reset link'}
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
