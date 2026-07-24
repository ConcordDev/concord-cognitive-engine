'use client';

// concord-frontend/components/common/ComputedResultBadge.tsx
//
// V1.2 Wave E — a grounding audit found that the marketplace's
// ListingVerificationBadge (components/marketplace/ListingVerificationBadge.tsx)
// answers "was this LISTING's underlying asset actually checked?" but the
// place that most needs an honest answer — the engineering lens's own
// FEAResultViewer, where the FEA computation itself happens — only showed a
// plain numeric utilization bar with no verified/failed/no-data signal on
// the computed result. This component generalizes the same three-state
// honest pattern so ANY real, deterministic engine's output (FEA, a
// structural wall-strength check, a tolerance stack-up, ...) can render it
// without this component knowing any domain vocabulary.
//
// This component is deliberately dumb: it never classifies anything. The
// CALLER — a small, per-domain PURE classifier function that reads the real
// backend result shape (e.g. components/engineering/fea-verification.ts,
// components/masonry/wall-verification.ts) — decides the state and writes
// the domain-correct label/detail copy. Only the icon/color/layout shell is
// shared here, which is exactly why this is safe to share even though
// ListingVerificationBadge's own header comment explains it was deliberately
// NOT built on top of <CapabilityBadge>: that concern was about a shared
// component that BAKES IN domain-specific copy (CapabilityBadge's tier
// labels/titles are hardcoded per tier). This component bakes in nothing but
// an icon + color per state; the words are always the caller's.
//
// Honest by construction (CLAUDE.md "How we work here" #3): a pure function
// of its props. It never fetches, never infers a state from a bare boolean,
// and never defaults to "verified" — that judgment call belongs entirely to
// the per-domain classifier that produced `state`.

import { BadgeCheck, XOctagon, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The three honest states any real computation can be in: a check ran and
 * passed, a check ran and did NOT pass, or no check has been run at all.
 * There is intentionally no fourth "in progress" or "error" state here —
 * callers that need those should resolve them to `no_data` (no completed
 * result to show yet) rather than growing this shell's vocabulary. */
export type ComputedResultState = 'verified' | 'failed' | 'no_data';

export interface ComputedResultBadgeProps {
  /** Which of the three honest states to render. Classification is entirely
   * the caller's responsibility — this component never derives it. */
  state: ComputedResultState;
  /** Domain-correct short label, e.g. "FEA Verified" or "Wall OK". */
  label: string;
  /** Optional longer explanation, shown as the badge's hover title. */
  detail?: string;
  size?: 'sm' | 'md';
  className?: string;
}

const STATE_STYLE: Record<ComputedResultState, { icon: typeof BadgeCheck; text: string }> = {
  verified: { icon: BadgeCheck, text: 'text-emerald-400' },
  failed: { icon: XOctagon, text: 'text-rose-400' },
  no_data: { icon: HelpCircle, text: 'text-zinc-500' },
};

/**
 * ComputedResultBadge — the shared honest rendering shell for a real
 * computation's verified/failed/no_data state. A pure function of its
 * props; never fetches, never classifies, never fabricates a "verified"
 * default. Any lens with a real deterministic engine can reuse this by
 * writing a small classifier that produces `{ state, label, detail }` from
 * that engine's actual result shape.
 */
export function ComputedResultBadge({ state, label, detail, size = 'sm', className }: ComputedResultBadgeProps) {
  const { icon: Icon, text } = STATE_STYLE[state];
  const iconSize = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]';

  return (
    <span
      className={cn('inline-flex items-center gap-1 font-medium', textSize, text, className)}
      title={detail}
      data-computed-result-state={state}
    >
      <Icon className={iconSize} />
      {label}
    </span>
  );
}

export default ComputedResultBadge;
