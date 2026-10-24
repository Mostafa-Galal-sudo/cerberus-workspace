import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/utils';

const buttonVariants = cva('button inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50', {
  variants: {
    variant: { primary: 'bg-signal text-obsidian hover:bg-[#79bdff]', secondary: 'border border-steel bg-graphite text-slate-100 hover:bg-steel/60', ghost: 'text-slate-300 hover:bg-steel/40 hover:text-white', danger: 'bg-danger text-obsidian hover:bg-[#ff8796]' },
    size: { sm: 'h-8 px-3 text-xs', md: 'h-10 px-4 text-sm', lg: 'h-12 px-5 text-sm' },
  }, defaultVariants: { variant: 'primary', size: 'md' },
});
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>>(
  function Button({ className, variant, size, ...props }, ref) {
    return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('panel', className)} {...props} />; }

export function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll('_', ' ');
  return <span className={cn('status-badge', `status-${status}`)}>{label}</span>;
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error && <small role="alert">{error}</small>}</label>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div className="empty-mark" aria-hidden="true" /><h3>{title}</h3><p>{body}</p></div>;
}

export function PageSkeleton() { return <div className="skeleton-stack" aria-label="Loading"><div /><div /><div /></div>; }
