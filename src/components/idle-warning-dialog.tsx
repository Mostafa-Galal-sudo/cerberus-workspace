import { useEffect, useRef } from 'react';
import { Button } from './ui';

interface IdleWarningDialogProps {
  secondsLeft: number;
  pending?: boolean;
  onStay: () => void;
  onSignOut: () => void;
  onDismiss: () => void;
}

/**
 * Time-sensitive warning shown before the server-side idle timeout revokes the
 * session. Escape closes the warning without extending the session; only the
 * explicit action refreshes the server timer.
 */
export function IdleWarningDialog({ secondsLeft, pending = false, onStay, onSignOut, onDismiss }: IdleWarningDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stayRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  const minutes = Math.max(1, Math.ceil(secondsLeft / 60));

  return (
    <div
      className="modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      aria-describedby="idle-warning-body"
      style={{ position: 'fixed', inset: 0, background: 'rgba(5, 6, 8, 0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 120, padding: '20px' }}
    >
      <div
        className="modal-card idle-warning-card"
        ref={cardRef}
        style={{ background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border-chiseled)', borderRadius: '8px', maxWidth: '440px', width: '100%', padding: '24px', boxShadow: '0 12px 36px rgba(0,0,0,0.8)' }}
      >
        <h2 id="idle-warning-title" style={{ margin: '0 0 8px', fontSize: '1.05rem', color: 'var(--color-platinum-pure)' }}>
          Session about to lock
        </h2>
        <p id="idle-warning-body" style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--color-silver-light)' }}>
          No workspace activity was detected. For security, this session will be locked in about {minutes} minute{minutes === 1 ? '' : 's'}.
        </p>
        <p aria-live="polite" style={{ margin: '0 0 18px', fontSize: '0.8rem', color: 'var(--color-pewter)' }}>
          {secondsLeft} second{secondsLeft === 1 ? '' : 's'} remaining
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onSignOut} disabled={pending}>Sign out</Button>
          <Button ref={stayRef} onClick={onStay} disabled={pending}>
            {pending ? 'Extending…' : 'Stay signed in'}
          </Button>
        </div>
      </div>
    </div>
  );
}
