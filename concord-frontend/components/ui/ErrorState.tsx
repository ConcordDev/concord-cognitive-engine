'use client';

/**
 * ErrorState — general-purpose error display primitive.
 *
 * Surveyed existing error-surface conventions before adding this (see
 * `components/common/OperatorErrorBanner.tsx` — a page-level dismissible
 * banner with a copy-debug-bundle action; and the inline `status==='error'`
 * blocks scattered per-component, e.g. `components/conkay/panels/
 * MacroLibraryPanel.tsx`, `components/wallet/WithdrawFlow.tsx`,
 * `components/payment/StripePaymentForm.tsx`, `components/media/
 * MediaUpload.tsx` — each hand-rolls its own `rounded-lg border ... text-sm`
 * error box with no shared component). This is the reusable primitive those
 * inline blocks could converge on: a message, an optional retry action, and
 * optional expandable technical detail — styled from the same `STATUS_TOKENS
 * .error` token `OperatorErrorBanner` and `StatusDot` both draw from, so it
 * reads as the same "this is an error" language everywhere it appears.
 * `OperatorErrorBanner` itself stays a distinct, page-chrome-level component
 * (dismiss/debug-bundle/auth-posture semantics it doesn't share with a
 * per-panel error box) — not a candidate to be replaced by this.
 *
 * Honest-by-construction: `message` should be the real reason the surface
 * failed (or the caller's best honest paraphrase of it) — never a vague
 * "Something went wrong" when a real reason is available. Pure
 * presentational: no fetching, no retry logic of its own — the caller
 * supplies `onRetry`.
 */

import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ds, STATUS_TOKENS } from '@/lib/design-system';

export type ErrorStateVariant = 'panel' | 'inline';

export interface ErrorStateProps {
  /** The honest reason this failed. Prefer the real error/reason string over a generic fallback. */
  message: string;
  /** Optional headline above `message`. Default: "Something went wrong." */
  title?: string;
  /** Retry handler — renders a Retry button when present. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Disables + spins the retry button while a retry is in flight. */
  retrying?: boolean;
  /** Optional technical detail (raw error, stack, request id, response body) shown behind a disclosure toggle. */
  details?: string;
  /** `panel` (default): bordered box with icon + spacing, for a section/tab body. `inline`: compact single-line banner. */
  variant?: ErrorStateVariant;
  className?: string;
}

export function ErrorState({
  message,
  title = 'Something went wrong.',
  onRetry,
  retryLabel = 'Retry',
  retrying = false,
  details,
  variant = 'panel',
  className,
}: ErrorStateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const errorColor = STATUS_TOKENS.error.color;

  if (variant === 'inline') {
    return (
      <div
        role="alert"
        aria-live="polite"
        className={cn('flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm', className)}
        style={{ borderColor: STATUS_TOKENS.error.borderStyle.borderColor, backgroundColor: STATUS_TOKENS.error.bgStyle.backgroundColor }}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: errorColor }} aria-hidden="true" />
        <span className="flex-1 min-w-0 text-gray-200">{message}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-0.5 text-xs text-white hover:bg-white/10 disabled:opacity-50"
          >
            <RotateCw className={cn('h-3 w-3', retrying && 'animate-spin')} aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center text-center py-10 px-6 rounded-lg border',
        className,
      )}
      style={{ borderColor: STATUS_TOKENS.error.borderStyle.borderColor, backgroundColor: STATUS_TOKENS.error.bgStyle.backgroundColor }}
    >
      <div
        className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: STATUS_TOKENS.error.bgStyle.backgroundColor, color: errorColor }}
        aria-hidden="true"
      >
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-gray-300 max-w-md mb-4">{message}</p>

      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className={cn(ds.btnSecondary, 'px-4 py-2 text-sm inline-flex items-center gap-2')}
          >
            <RotateCw className={cn('h-4 w-4', retrying && 'animate-spin')} aria-hidden="true" />
            {retrying ? 'Retrying…' : retryLabel}
          </button>
        )}
        {details && (
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className={cn(ds.btnGhost, 'inline-flex items-center gap-1 text-xs')}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
            {detailsOpen ? 'Hide details' : 'Show details'}
          </button>
        )}
      </div>

      {details && detailsOpen && (
        <pre className="mt-3 w-full max-w-lg overflow-x-auto rounded-md border border-lattice-border bg-black/40 p-3 text-left text-xs text-gray-400 font-mono whitespace-pre-wrap break-words">
          {details}
        </pre>
      )}
    </div>
  );
}

export default ErrorState;
