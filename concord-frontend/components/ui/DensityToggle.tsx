'use client';

/**
 * DensityToggle — Low / Medium / High information-density control.
 *
 * Wired to `useDensity()` (`lib/hooks/useDensity.ts`), which already owns the
 * density preference end-to-end: it persists to `localStorage` under the key
 * `concord:density` and mirrors the resolved tokens onto
 * `document.documentElement` as `data-density` + `--density-*` CSS custom
 * properties. That hook already follows the same read-then-hydrate-in-effect,
 * try/catch-guarded localStorage convention as `lib/world-lens/quality-preset
 * .ts`'s `getStoredQualityPreset`/`setStoredQualityPreset` pair (a distinct
 * storage key per preference, default-on-SSR-or-failure, validated against a
 * literal union before trusting the stored value) — this component doesn't
 * duplicate that logic, it's the pure control surface on top of it.
 *
 * The `DensityLevel` type + `DENSITY_TOKENS` values below come from
 * `lib/design-system.ts`, which landed with this same round of work — if you
 * are reading this after `lib/design-system.ts` has since changed shape,
 * trust the import over this comment.
 *
 * Two render modes:
 *   - `segmented` (default) — three-button toggle, good for a settings panel
 *     or lens toolbar.
 *   - `dropdown` — compact `<select>`, good for a cramped header/HUD strip.
 */

import React from 'react';
import { Rows2, Rows3, Rows4 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { useDensity } from '@/lib/hooks/useDensity';
import type { DensityLevel } from '@/lib/design-system';

const LEVEL_ICON: Record<DensityLevel, React.ComponentType<{ className?: string }>> = {
  low: Rows2,
  medium: Rows3,
  high: Rows4,
};

export interface DensityToggleProps {
  variant?: 'segmented' | 'dropdown';
  /** Show the text label ("Low"/"Medium"/"High") next to the icon in segmented mode. Default true. */
  showLabels?: boolean;
  className?: string;
}

export function DensityToggle({ variant = 'segmented', showLabels = true, className }: DensityToggleProps) {
  const { density, setDensity, levels, allTokens } = useDensity();

  if (variant === 'dropdown') {
    return (
      <label className={cn('inline-flex items-center gap-2 text-xs text-gray-400', className)}>
        <span className="sr-only">Information density</span>
        <select
          value={density}
          onChange={(e) => setDensity(e.target.value as DensityLevel)}
          className={cn(ds.select, 'w-auto py-1 px-2 text-xs')}
          aria-label="Information density"
        >
          {levels.map((level) => (
            <option key={level} value={level}>
              {allTokens[level].label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Information density"
      className={cn('inline-flex items-center gap-0.5 rounded-lg border border-lattice-border bg-lattice-surface/60 p-0.5', className)}
    >
      {levels.map((level) => {
        const Icon = LEVEL_ICON[level];
        const active = level === density;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={active}
            title={allTokens[level].description}
            onClick={() => setDensity(level)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              ds.focusRing,
              active ? 'bg-neon-blue/20 text-neon-blue' : 'text-gray-400 hover:text-white hover:bg-white/5',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {showLabels && allTokens[level].label}
          </button>
        );
      })}
    </div>
  );
}

export default DensityToggle;
