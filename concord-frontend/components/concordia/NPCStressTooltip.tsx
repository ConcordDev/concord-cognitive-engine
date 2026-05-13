'use client';

/**
 * NPCStressTooltip — surface an NPC's stress state as a glyph cluster
 * rather than a number bar.
 *
 * Concordia Phase 1. Substrate: `npc_stress` (mig 152) — a 0-100
 * integer plus a coping_trait that locks for 7 game-days at stress
 * ≥ 80. The design rule from the player-experience spec: "Stress
 * visible in behavior. Drinking, isolation, lashing out, paranoia.
 * No stress bar."
 *
 * We render:
 *   - Up to 5 small glyphs sized to the bucket (calm / unsettled /
 *     anxious / breaking / broken).
 *   - The coping trait as a single italic word in tooltip role.
 *
 * No persistent bar. Tooltip is shown via `role="tooltip"` so screen
 * readers announce it on focus / hover. Visible on hover for sighted
 * users via the parent element's hover state.
 */

import { useId, useMemo } from 'react';

type CopingTrait = 'drink' | 'reckless' | 'paranoid' | 'withdraw' | 'cruel' | null | undefined;

export interface NPCStressTooltipProps {
  stress: number | null | undefined;
  copingTrait?: CopingTrait;
  /** Compact mode: smaller glyphs + no coping line (for HUD overlay). */
  compact?: boolean;
  /** Optional npcId for ARIA label specificity. */
  npcId?: string;
}

interface Bucket {
  label: string;
  glyph: string;
  intensity: number; // 0..5 — number of glyphs rendered
  tone: string;      // tailwind text color
}

function bucketFor(stress: number): Bucket {
  if (stress >= 80) return { label: 'broken', glyph: '✶', intensity: 5, tone: 'text-red-400' };
  if (stress >= 60) return { label: 'breaking', glyph: '✸', intensity: 4, tone: 'text-orange-400' };
  if (stress >= 45) return { label: 'anxious', glyph: '✺', intensity: 3, tone: 'text-amber-300' };
  if (stress >= 35) return { label: 'unsettled', glyph: '✦', intensity: 2, tone: 'text-zinc-300' };
  return { label: 'calm', glyph: '·', intensity: 1, tone: 'text-zinc-500' };
}

const COPING_LINE: Record<NonNullable<CopingTrait>, string> = {
  drink: 'hands shaking — has been drinking',
  reckless: 'snapped — acting without thinking',
  paranoid: 'sees plots in every shadow',
  withdraw: 'distant — replies short',
  cruel: 'turned cruel — takes pleasure in setbacks',
};

export function NPCStressTooltip({
  stress,
  copingTrait,
  compact = false,
  npcId,
}: NPCStressTooltipProps) {
  const id = useId();
  const tooltipId = `npc-stress-tip-${id}`;
  const bucket = useMemo(() => bucketFor(Number.isFinite(stress) ? (stress as number) : 30), [stress]);

  // If stress is null/undefined AND no coping trait, render nothing — no signal.
  if ((stress == null || !Number.isFinite(stress)) && !copingTrait) return null;

  const glyphSize = compact ? 'text-[10px]' : 'text-xs';
  const containerCls = compact
    ? 'inline-flex items-center gap-0.5'
    : 'inline-flex items-center gap-1 bg-zinc-950/85 border border-zinc-700/60 rounded-md px-1.5 py-1';

  return (
    <span
      className={containerCls}
      data-testid="npc-stress-tooltip"
      data-stress-bucket={bucket.label}
      data-npc-id={npcId}
      role="tooltip"
      id={tooltipId}
      aria-label={`Stress ${bucket.label}${copingTrait ? ` · ${copingTrait}` : ''}`}
    >
      <span className={`inline-flex items-baseline ${bucket.tone} leading-none`}>
        {Array.from({ length: bucket.intensity }).map((_, i) => (
          <span key={i} className={`${glyphSize} leading-none`} aria-hidden="true">{bucket.glyph}</span>
        ))}
      </span>
      {!compact && copingTrait && (
        <span className="italic text-[10px] text-zinc-400 leading-tight" data-coping-line>
          {COPING_LINE[copingTrait]}
        </span>
      )}
    </span>
  );
}
