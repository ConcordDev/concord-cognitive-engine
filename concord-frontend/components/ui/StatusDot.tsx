'use client';

/**
 * StatusDot — small colored status indicator primitive.
 *
 * For the "live activity" pattern used across lenses: a live-feed pulse
 * (News flagship), a connection/system-health badge (see the bespoke
 * dot logic in `components/hud/ShardHealthBadge.tsx`), or any
 * live/idle/error/offline-style state chip. This is the generalized,
 * dependency-free version of that pattern for reuse anywhere.
 *
 * Pure presentational — the caller decides *what* `state` means and
 * polls/subscribes elsewhere; this component never fetches.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export type StatusDotState = 'live' | 'idle' | 'error' | 'offline' | 'warning' | 'connecting';

export interface StatusDotProps {
  state: StatusDotState;
  /** Animated pulse ring. Defaults to true for `live`/`connecting`, false otherwise. */
  pulse?: boolean;
  size?: 'xs' | 'sm' | 'md';
  /** Visible + accessible text. Defaults to a Title Case version of `state`. */
  label?: string;
  /** Show `label` as visible text (not just for screen readers). Defaults to true only when `label` is explicitly passed. */
  showLabel?: boolean;
  className?: string;
}

const STATE_STYLES: Record<StatusDotState, { dot: string; text: string; defaultLabel: string }> = {
  live: { dot: 'bg-emerald-400', text: 'text-emerald-300', defaultLabel: 'Live' },
  idle: { dot: 'bg-slate-400', text: 'text-slate-400', defaultLabel: 'Idle' },
  error: { dot: 'bg-red-500', text: 'text-red-300', defaultLabel: 'Error' },
  offline: { dot: 'bg-slate-500', text: 'text-slate-500', defaultLabel: 'Offline' },
  warning: { dot: 'bg-amber-400', text: 'text-amber-300', defaultLabel: 'Warning' },
  connecting: { dot: 'bg-amber-400', text: 'text-amber-300', defaultLabel: 'Connecting' },
};

const SIZE_CLASS: Record<NonNullable<StatusDotProps['size']>, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
};

const DEFAULT_PULSE_STATES: ReadonlySet<StatusDotState> = new Set(['live', 'connecting']);

export function StatusDot({ state, pulse, size = 'sm', label, showLabel, className }: StatusDotProps) {
  const styles = STATE_STYLES[state];
  const shouldPulse = pulse ?? DEFAULT_PULSE_STATES.has(state);
  const dotSize = SIZE_CLASS[size];
  const text = label ?? styles.defaultLabel;
  const visibleLabel = showLabel ?? Boolean(label);

  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="relative inline-flex shrink-0" aria-hidden="true">
        {shouldPulse && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', styles.dot)} />
        )}
        <span className={cn('relative inline-flex rounded-full', dotSize, styles.dot)} />
      </span>
      <span className={cn('text-xs font-medium whitespace-nowrap', styles.text, !visibleLabel && 'sr-only')}>{text}</span>
    </span>
  );
}
