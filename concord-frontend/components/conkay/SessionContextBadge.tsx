'use client';
// concord-frontend/components/conkay/SessionContextBadge.tsx
//
// The ConKay HUD chip for "X turns · Y% full" — a low-noise read of
// the session-context budget. Renders the same six honest states
// from sessionContextBudget.ts. Pure React + CSS pulse, no
// setInterval/setTimeout (the polling cadence lives in the hook).
//
// Pinned by tests/components/SessionContextBadge.test.tsx.

import { GaugeCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useConkayContextBudget,
  type ContextBudgetState,
} from './useConkayContextBudget';
import {
  deriveBudgetState,
  type FetchFreshness,
} from './sessionContextBudget';

interface SessionContextBadgeProps {
  sessionId: string | null | undefined;
  className?: string;
}

function freshnessOf(state: ContextBudgetState): FetchFreshness {
  if (state.kind === 'unreachable') {
    if (state.reason === 'never_fetched' || state.reason === 'no_session') {
      return 'never-fetched';
    }
    return 'unreachable';
  }
  // 'loaded' — fresh unless >2 min old.
  const age = Date.now() - state.lastFetchMs;
  return age > 2 * 60_000 ? 'stale' : 'fresh';
}

function colorFor(kind: ReturnType<typeof deriveBudgetState>['kind']): string {
  // Honest red is reserved for "auto-compress is due." Yellow for
  // "user might want to compress." Green for "fine."
  switch (kind) {
    case 'over':
      return 'border-red-400/40 bg-red-400/10 text-red-200/90';
    case 'red':
      return 'border-orange-400/40 bg-orange-400/10 text-orange-200/90';
    case 'yellow':
      return 'border-amber-400/40 bg-amber-400/5 text-amber-200/90';
    case 'green':
      return 'border-emerald-400/30 bg-emerald-400/5 text-emerald-200/90';
    case 'empty':
      return 'border-zinc-400/20 bg-zinc-400/5 text-zinc-300/80';
    case 'unreachable':
    default:
      return 'border-zinc-500/20 bg-zinc-400/5 text-zinc-300/80';
  }
}

export function SessionContextBadge({ sessionId, className }: SessionContextBadgeProps) {
  const state = useConkayContextBudget({ sessionId });
  const freshness = freshnessOf(state);
  const derivation =
    state.kind === 'loaded'
      ? deriveBudgetState(
          state.data,
          freshness,
          Date.now(),
          state.lastFetchMs,
        )
      : deriveBudgetState(null, freshness, Date.now(), null);

  return (
    <div
      data-testid="ck-context-badge"
      data-state={derivation.kind}
      title={derivation.voiceHint || derivation.label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
        'text-[10px] font-mono tracking-tight',
        colorFor(derivation.kind),
        className,
      )}
    >
      <GaugeCircle className="h-3 w-3" />
      <span>{derivation.label}</span>
    </div>
  );
}

export default SessionContextBadge;
