'use client';

/**
 * StaminaWheel — circular stamina HUD for Concordia movement.
 *
 * Concordia Phase 5. Substrate: `player_stamina` (mig 176) +
 * lib/player-stamina.js. Surfaces stamina as a partial-fill arc with
 * a state glyph in the centre. No numeric readout (matches the Phase 1
 * "diegetic substrate, no bars" rule but a circular arc is acceptable
 * for fast-motor read-ahead).
 *
 * Visible only when state != 'rest' OR value < max (i.e. when stamina
 * is being used or recovering). Tucks into the corner-HUD slot;
 * hidden otherwise.
 */

import { useId } from 'react';

export interface StaminaWheelProps {
  value: number | null | undefined;
  max?: number | null | undefined;
  state?: 'rest' | 'climbing' | 'sprinting' | 'swimming' | 'exhausted' | null | undefined;
}

const STATE_GLYPH: Record<string, { glyph: string; label: string; tone: string }> = {
  rest:       { glyph: '◌', label: 'rest',       tone: 'text-zinc-500' },
  climbing:   { glyph: '↟', label: 'climbing',   tone: 'text-amber-300' },
  sprinting:  { glyph: '↠', label: 'sprinting',  tone: 'text-orange-300' },
  swimming:   { glyph: '≈', label: 'swimming',   tone: 'text-cyan-300' },
  exhausted:  { glyph: '⊘', label: 'exhausted',  tone: 'text-red-400' },
};

export function StaminaWheel({ value, max, state }: StaminaWheelProps) {
  const id = useId();
  const tipId = `stamina-tip-${id}`;
  const m = Number.isFinite(max) && (max as number) > 0 ? (max as number) : 100;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(m, value as number)) : m;
  const pct = m > 0 ? v / m : 0;
  const stateKey = state && STATE_GLYPH[state] ? state : 'rest';
  const meta = STATE_GLYPH[stateKey];

  // Hide only when at rest AND full — no visual chrome unless there's a story.
  if (stateKey === 'rest' && pct >= 0.999) return null;

  // Arc geometry: stroke-dasharray on an SVG circle.
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const visibleArc = circumference * pct;
  const hiddenArc = circumference * (1 - pct);

  return (
    <div
      className="inline-flex flex-col items-center select-none"
      data-testid="stamina-wheel"
      data-state={stateKey}
      role="tooltip"
      id={tipId}
      aria-label={`Stamina ${Math.round(pct * 100)}%, ${meta.label}`}
    >
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r={radius} stroke="rgba(0,0,0,0.4)" strokeWidth="3" fill="none" />
        <circle
          cx="18"
          cy="18"
          r={radius}
          stroke="currentColor"
          strokeWidth="3"
          fill="none"
          strokeDasharray={`${visibleArc} ${hiddenArc}`}
          strokeDashoffset={circumference / 4}
          transform="rotate(-90 18 18)"
          className={meta.tone}
          strokeLinecap="round"
        />
      </svg>
      <span className={`text-xs leading-none ${meta.tone} -mt-6`} aria-hidden="true">{meta.glyph}</span>
    </div>
  );
}
