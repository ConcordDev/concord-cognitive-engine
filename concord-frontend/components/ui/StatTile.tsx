'use client';

/**
 * StatTile — compact stat/KPI display primitive.
 *
 * Generalized from the pattern in `components/accounting/KPIStrip.tsx`
 * (the accounting lens's dense financial-tile strip) into a reusable,
 * domain-agnostic building block: label + big value + optional
 * delta/trend + optional sparkline slot + optional caption. `KPIStrip`
 * itself is left as-is (accounting-specific composition + PeriodSelector);
 * new lenses that just need a tile grid should reach for `StatTile` +
 * `StatTileGrid` instead of hand-rolling a strip.
 *
 * Pure presentational — no fetching. Callers own the data.
 */

import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

export type StatTileTone = 'positive' | 'negative' | 'neutral';
export type StatTileSize = 'sm' | 'md' | 'lg';

export interface StatTileProps {
  label: string;
  /** Current value. Number or pre-formatted string. */
  value: number | string;
  /** Currency or unit ($, CC, %, items). */
  unit?: string;
  /** Delta vs. a prior period as a percentage (e.g. 12.5 means +12.5%). */
  deltaPct?: number;
  /** Text shown next to (or instead of) the delta, e.g. "vs last month". */
  deltaLabel?: string;
  /** Tone override — defaults to the sign of `deltaPct`. */
  tone?: StatTileTone;
  /** Sub-line shown when there's no delta to report. */
  caption?: string;
  icon?: React.ReactNode;
  /** Slot for a trend visualization — e.g. `<Sparkline counts={...} />`. */
  sparkline?: React.ReactNode;
  size?: StatTileSize;
  /** Override the default compact-number formatter. */
  formatValue?: (value: number | string, unit?: string) => string;
  /** Drill-down handler — if present, the tile becomes a button. */
  onClick?: () => void;
  className?: string;
}

/** Compact number formatting: $1.2M / $145K / $342 / 12.5% */
export function formatCompactStatValue(v: number | string, unit?: string): string {
  if (typeof v === 'string') return unit ? `${v}${unit}` : v;
  const abs = Math.abs(v);
  let formatted: string;
  if (abs >= 1_000_000) formatted = (v / 1_000_000).toFixed(1) + 'M';
  else if (abs >= 10_000) formatted = (v / 1_000).toFixed(0) + 'K';
  else if (abs >= 1_000) formatted = (v / 1_000).toFixed(1) + 'K';
  else formatted = v.toFixed(unit === '%' ? 1 : 0);
  return unit === '%' ? `${formatted}%` : unit ? `${unit}${formatted}` : formatted;
}

function toneFromDelta(deltaPct: number | undefined, override?: StatTileTone): StatTileTone {
  if (override) return override;
  if (deltaPct === undefined) return 'neutral';
  if (deltaPct > 0) return 'positive';
  if (deltaPct < 0) return 'negative';
  return 'neutral';
}

const TONE_CLASSES: Record<StatTileTone, { delta: string; arrow: string }> = {
  positive: { delta: 'text-emerald-300', arrow: 'text-emerald-300' },
  negative: { delta: 'text-rose-300', arrow: 'text-rose-300' },
  neutral: { delta: 'text-gray-400', arrow: 'text-gray-400' },
};

const SIZE_CLASSES: Record<StatTileSize, { pad: string; value: string; label: string }> = {
  sm: { pad: 'p-2.5', value: 'text-lg', label: 'text-[9px]' },
  md: { pad: 'p-3', value: 'text-2xl', label: 'text-[10px]' },
  lg: { pad: 'p-4', value: 'text-3xl', label: 'text-xs' },
};

export function StatTile({
  label,
  value,
  unit,
  deltaPct,
  deltaLabel,
  tone,
  caption,
  icon,
  sparkline,
  size = 'md',
  formatValue = formatCompactStatValue,
  onClick,
  className,
}: StatTileProps) {
  const resolvedTone = toneFromDelta(deltaPct, tone);
  const toneClasses = TONE_CLASSES[resolvedTone];
  const Arrow = resolvedTone === 'positive' ? ArrowUp : resolvedTone === 'negative' ? ArrowDown : Minus;
  const sizeClasses = SIZE_CLASSES[size];
  const Tile = onClick ? 'button' : 'div';

  return (
    <Tile
      role="listitem"
      {...(onClick ? { onClick, type: 'button' as const } : {})}
      className={cn(
        'rounded-md border border-white/10 bg-black/40 text-left w-full',
        sizeClasses.pad,
        onClick && cn('transition-colors hover:border-neon-blue/40 hover:bg-neon-blue/5', ds.focusRing),
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn('uppercase tracking-wider text-gray-400 truncate', sizeClasses.label)}>{label}</div>
        {icon && (
          <div className="text-gray-500 shrink-0" aria-hidden="true">
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div className={cn('font-mono font-semibold text-white tabular-nums truncate', sizeClasses.value)}>
          {formatValue(value, unit)}
        </div>
        {sparkline && <div className="shrink-0 opacity-80">{sparkline}</div>}
      </div>
      {(deltaPct !== undefined || caption) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          {deltaPct !== undefined && (
            <>
              <Arrow className={cn('w-3 h-3', toneClasses.arrow)} aria-hidden="true" />
              <span className={cn('font-mono tabular-nums', toneClasses.delta)}>
                {deltaPct > 0 ? '+' : ''}
                {deltaPct.toFixed(1)}%
              </span>
            </>
          )}
          {(deltaLabel || caption) && <span className="text-gray-400 truncate">{deltaLabel ?? caption}</span>}
        </div>
      )}
    </Tile>
  );
}

// ── StatTileGrid — responsive grid wrapper for a set of tiles ──────────────

export interface StatTileGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}

const GRID_COLS: Record<NonNullable<StatTileGridProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
  6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
};

export function StatTileGrid({ children, columns = 4, className }: StatTileGridProps) {
  return (
    <div role="list" className={cn('grid gap-2', GRID_COLS[columns], className)}>
      {children}
    </div>
  );
}
