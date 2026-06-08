'use client';

/**
 * DepthBadge — honest per-lens data-tier chip.
 *
 * Phase 1 of the 10-dimension UX completeness sprint. The "is this real?"
 * question users have every right to ask. A pharmacy lens populated by
 * an LLM is a working surface, but it is NOT a real formulary. Bloomberg
 * Terminal answers this question on every panel (subscription / live /
 * delayed). We answer it on every lens.
 *
 * Reads dataTier from the lens manifest. Renders nothing if the field
 * is absent (a lens hasn't been audited yet) — better silent than wrong.
 *
 * Tones:
 *   live (REAL_LIVE)    → emerald
 *   free (REAL_FREE)    → sky
 *   sim  (SIM_GRADE_A)  → amber
 *   demo (DEMO)         → zinc
 */

import { useDepthBadge } from '@/hooks/useDepthBadge';
import { cn } from '@/lib/utils';
import { Activity, BookOpen, Sparkles, FlaskConical } from 'lucide-react';

export interface DepthBadgeProps {
  lensId: string;
  /** 'sm' for inline next to a title, 'md' default, 'lg' for hero placement. */
  size?: 'sm' | 'md' | 'lg';
  /** Hide the caption tooltip. Default false. */
  hideTooltip?: boolean;
  className?: string;
}

const TONE_CLASS: Record<string, string> = {
  live: 'bg-emerald-950/60 text-emerald-200 border-emerald-500/40',
  free: 'bg-sky-950/60 text-sky-200 border-sky-500/40',
  sim:  'bg-amber-950/60 text-amber-200 border-amber-500/40',
  demo: 'bg-zinc-900/60 text-zinc-300 border-zinc-600/40',
};

const TONE_ICON = {
  live: Activity,
  free: BookOpen,
  sim:  FlaskConical,
  demo: Sparkles,
} as const;

const SIZE_CLASS = {
  sm: 'text-[10px] px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
  lg: 'text-sm px-2.5 py-1 gap-2',
} as const;

const ICON_SIZE = {
  sm: 'w-2.5 h-2.5',
  md: 'w-3 h-3',
  lg: 'w-3.5 h-3.5',
} as const;

export function DepthBadge({
  lensId,
  size = 'md',
  hideTooltip = false,
  className,
}: DepthBadgeProps) {
  const info = useDepthBadge(lensId);
  if (!info) return null;
  // Prod polish: never render a "Demo" chip — it reads as unfinished. The honest
  // positive tiers (live / free / sim) still show; demo-grade lenses show nothing.
  if (info.tone === 'demo') return null;
  const Icon = TONE_ICON[info.tone];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        TONE_CLASS[info.tone],
        SIZE_CLASS[size],
        className,
      )}
      title={hideTooltip ? undefined : info.caption}
      aria-label={`Data tier: ${info.label}. ${info.caption}`}
    >
      <Icon className={ICON_SIZE[size]} aria-hidden="true" />
      {info.label}
    </span>
  );
}

export default DepthBadge;
