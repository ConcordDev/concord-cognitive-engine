'use client';

/**
 * BloodlineBadge — surface the player's primary bloodline + dilution
 * level as a compact icon overlay on the avatar card.
 *
 * Concordia Phase 2. Substrate: `user_ancestry` (mig 173) +
 * lib/bloodline-powers.js. Combat path at routes/worlds.js#/combat/attack
 * multiplies damage by (1.20 / 1.00 / 0.60) for matched bloodlines or
 * refuses outright when dilution ≥ 0.90. This badge surfaces that to
 * the player so they can plan around their bloodline strength.
 *
 * Visual model:
 *   - Pure (dilution < 0.30): solid glyph in bloodline tone
 *   - Mild  (0.30 ≤ d < 0.60): solid glyph + faint dilution dot
 *   - Heavy (0.60 ≤ d < 0.90): outlined glyph + visible dilution dot
 *   - Faded (d ≥ 0.90): dashed-outline glyph + filled dilution dot
 *
 * No numeric bar (matches the design rule from Phase 1: substrate
 * surfaces are read, not measured).
 */

import { useId, useMemo } from 'react';

export interface BloodlineBadgeProps {
  bloodline: string | null | undefined;
  dilution: number | null | undefined;
  compact?: boolean;
}

interface BloodlineMeta {
  id: string;
  glyph: string;
  tone: string;          // tailwind text color
  ring: string;          // tailwind ring color
  short: string;         // 4-char abbreviation
}

const BLOODLINES: Record<string, BloodlineMeta> = {
  sanguire:    { id: 'sanguire',    glyph: '✦', tone: 'text-red-400',     ring: 'ring-red-700/50',     short: 'SANG' },
  medici:      { id: 'medici',      glyph: '☥', tone: 'text-emerald-300', ring: 'ring-emerald-700/50', short: 'MEDI' },
  sahm:        { id: 'sahm',        glyph: '✺', tone: 'text-amber-300',   ring: 'ring-amber-700/50',   short: 'SAHM' },
  iron_warden: { id: 'iron_warden', glyph: '✶', tone: 'text-zinc-300',    ring: 'ring-zinc-600/60',    short: 'IRON' },
  akeia:       { id: 'akeia',       glyph: '✸', tone: 'text-cyan-300',    ring: 'ring-cyan-700/50',    short: 'AKEA' },
  kree:        { id: 'kree',        glyph: '✷', tone: 'text-orange-300',  ring: 'ring-orange-700/50',  short: 'KREE' },
  asbir:       { id: 'asbir',       glyph: '⚝', tone: 'text-yellow-300',  ring: 'ring-yellow-700/50',  short: 'ASBR' },
  dinye:       { id: 'dinye',       glyph: '✹', tone: 'text-violet-300',  ring: 'ring-violet-700/50',  short: 'DINY' },
  aekon:       { id: 'aekon',       glyph: '❄', tone: 'text-sky-300',     ring: 'ring-sky-700/50',     short: 'AEKN' },
  fluxom:      { id: 'fluxom',      glyph: '☣', tone: 'text-lime-300',    ring: 'ring-lime-700/50',    short: 'FLUX' },
};

type DilutionBucket = 'pure' | 'mild' | 'heavy' | 'faded';

function bucketForDilution(d: number): DilutionBucket {
  if (d < 0.30) return 'pure';
  if (d < 0.60) return 'mild';
  if (d < 0.90) return 'heavy';
  return 'faded';
}

const BUCKET_LABEL: Record<DilutionBucket, string> = {
  pure: 'pure',
  mild: 'mildly diluted',
  heavy: 'heavily diluted',
  faded: 'faded',
};

export function BloodlineBadge({ bloodline, dilution, compact = false }: BloodlineBadgeProps) {
  const id = useId();
  const tooltipId = `bloodline-tip-${id}`;
  const meta = bloodline ? BLOODLINES[bloodline] || null : null;
  const d = Number.isFinite(dilution) ? Math.max(0, Math.min(1, dilution as number)) : 1;
  const bucket = useMemo(() => bucketForDilution(d), [d]);

  if (!meta) {
    // No ancestry recorded — render a neutral placeholder so the slot
    // exists in the UI but tells the player nothing about a bloodline
    // they don't have.
    return (
      <span
        className={`inline-flex items-center gap-1 ${compact ? 'text-[10px]' : 'text-xs'} text-zinc-500`}
        data-testid="bloodline-badge"
        data-bloodline="none"
        role="tooltip"
        id={tooltipId}
        aria-label="No bloodline recorded"
      >
        <span className="opacity-50" aria-hidden="true">·</span>
        {!compact && <span className="italic">no ancestry</span>}
      </span>
    );
  }

  const glyphCls = bucket === 'faded'
    ? 'border border-dashed border-current rounded-full px-1'
    : bucket === 'heavy'
      ? 'border border-current rounded-full px-1'
      : '';

  return (
    <span
      className={`inline-flex items-center gap-1 ${compact ? 'text-[10px]' : 'text-xs'} ${meta.tone}`}
      data-testid="bloodline-badge"
      data-bloodline={meta.id}
      data-dilution-bucket={bucket}
      role="tooltip"
      id={tooltipId}
      aria-label={`${meta.id} bloodline · ${BUCKET_LABEL[bucket]}`}
    >
      <span className={`${glyphCls} leading-none`} aria-hidden="true">{meta.glyph}</span>
      {!compact && (
        <>
          <span className="uppercase tracking-wider font-mono">{meta.short}</span>
          {bucket !== 'pure' && (
            <span className="text-zinc-400/80 italic">· {BUCKET_LABEL[bucket]}</span>
          )}
        </>
      )}
    </span>
  );
}
