'use client';

/**
 * LensStates — loading, empty, error and ready, decided in one place.
 *
 * Built on the app's canonical `ui/EmptyState` and `ui/ErrorState` (not a fourth
 * copy). `LensAsync` takes the real state of a request and renders exactly one of:
 *   loading → a skeleton with aria-busy, and no fake progress (no timers, no percentages);
 *   error   → the server's own reason, with Retry when the caller can retry;
 *   empty   → why there is nothing, and what to do — never sample content;
 *   ready   → the children.
 * `why` is required for empty: "No items" with no reason is not allowed.
 */

import type { ReactNode } from 'react';
import { EmptyState, type EmptyStateAction } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { cn } from '@/lib/utils';

export function LensLoading({ label = 'Loading', rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-testid="lens-loading" className={cn('min-w-0 space-y-2 p-3', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(1, Math.min(rows, 8)) }, (_, i) => (
        <div key={i} aria-hidden className="h-4 rounded bg-[color:var(--lk-line,#e5e5e5)] motion-safe:animate-pulse" style={{ width: `${92 - i * 14}%` }} />
      ))}
    </div>
  );
}

export interface LensEmptyProps { title: string; why: string; action?: EmptyStateAction; className?: string }
export function LensEmpty({ title, why, action, className }: LensEmptyProps) {
  return <div data-testid="lens-empty" className={cn('min-w-0', className)}><EmptyState title={title} description={why} action={action} /></div>;
}

export interface LensErrorProps { error: unknown; onRetry?: () => void; retrying?: boolean; title?: string; className?: string }
/** The honest reason: the server's error/reason/message, never a generic "something went wrong" when a reason exists. */
export function reasonOf(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const e = error as { response?: { data?: { message?: string; error?: string; reason?: string } }; message?: string; error?: string; reason?: string };
  return e.response?.data?.message || e.response?.data?.reason || e.response?.data?.error || e.reason || e.error || e.message || 'unknown error';
}
export function LensError({ error, onRetry, retrying, title, className }: LensErrorProps) {
  return <div data-testid="lens-error" className={cn('min-w-0', className)}><ErrorState title={title} message={reasonOf(error)} onRetry={onRetry} retrying={retrying} /></div>;
}

export type LensAsyncStatus = 'loading' | 'error' | 'empty' | 'ready';
export interface LensAsyncProps {
  status: LensAsyncStatus;
  error?: unknown;
  onRetry?: () => void;
  empty?: LensEmptyProps;
  loadingLabel?: string;
  children?: ReactNode;
}
export function LensAsync({ status, error, onRetry, empty, loadingLabel, children }: LensAsyncProps) {
  if (status === 'loading') return <LensLoading label={loadingLabel} />;
  if (status === 'error') return <LensError error={error} onRetry={onRetry} />;
  if (status === 'empty') {
    if (!empty) throw new Error('LensAsync: status "empty" needs `empty` with a title and why');
    return <LensEmpty {...empty} />;
  }
  return <>{children}</>;
}

/** Derive the status from a query-shaped object (React Query or the lens hooks). */
export function statusOf(q: { isLoading?: boolean; isPending?: boolean; isError?: boolean; error?: unknown; data?: unknown }, isEmpty: (data: unknown) => boolean): LensAsyncStatus {
  if (q.isError || q.error) return 'error';
  if (q.isLoading || (q.isPending && q.data === undefined)) return 'loading';
  return isEmpty(q.data) ? 'empty' : 'ready';
}
