'use client';

/**
 * KPIStrip — financial dashboard at a glance.
 *
 * The horizontal strip of high-density numeric tiles every accounting
 * tool ships above the ledger. Numbers go big, deltas go small with
 * arrows, period label sits to the right. Drop into the accounting
 * lens above the ledger grid and the page reads as financial software
 * inside 200ms.
 */

import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KPI {
  id: string;
  label: string;
  /** Current period value. Number or pre-formatted string. */
  value: number | string;
  /** Currency or unit ($, CC, %, items). */
  unit?: string;
  /** Delta vs prior period as a percentage (e.g. 12.5 means +12.5%). */
  deltaPct?: number;
  /** Tone override — defaults to deltaPct sign. */
  tone?: 'positive' | 'negative' | 'neutral';
  /** Sub-line shown below the value (e.g. "vs last month"). */
  caption?: string;
  /** Drill-down click handler — if present, the tile becomes a button. */
  onClick?: () => void;
}

export interface KPIStripProps {
  kpis: KPI[];
  /** Right-aligned period chip. */
  periodLabel?: string;
  className?: string;
}

function formatValue(v: number | string, unit?: string): string {
  if (typeof v === 'string') return unit ? `${v}${unit}` : v;
  // Compact number formatting: $1.2M / $145K / $342
  const abs = Math.abs(v);
  let formatted: string;
  if (abs >= 1_000_000) formatted = (v / 1_000_000).toFixed(1) + 'M';
  else if (abs >= 10_000) formatted = (v / 1_000).toFixed(0) + 'K';
  else if (abs >= 1_000) formatted = (v / 1_000).toFixed(1) + 'K';
  else formatted = v.toFixed(unit === '%' ? 1 : 0);
  return unit === '%' ? `${formatted}%` : unit ? `${unit}${formatted}` : formatted;
}

function toneFromDelta(deltaPct: number | undefined, override?: KPI['tone']): KPI['tone'] {
  if (override) return override;
  if (deltaPct === undefined) return 'neutral';
  if (deltaPct > 0) return 'positive';
  if (deltaPct < 0) return 'negative';
  return 'neutral';
}

const TONE_CLASSES: Record<NonNullable<KPI['tone']>, { delta: string; arrow: string }> = {
  positive: { delta: 'text-emerald-300', arrow: 'text-emerald-300' },
  negative: { delta: 'text-rose-300', arrow: 'text-rose-300' },
  neutral:  { delta: 'text-gray-400',   arrow: 'text-gray-400' },
};

export function KPIStrip({ kpis, periodLabel, className }: KPIStripProps) {
  if (kpis.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {periodLabel && (
        <div className="flex items-center justify-end">
          <span className="text-[11px] uppercase tracking-wider text-gray-400 font-mono">
            {periodLabel}
          </span>
        </div>
      )}
      <div
        role="list"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2"
      >
        {kpis.map((kpi) => {
          const tone = toneFromDelta(kpi.deltaPct, kpi.tone);
          const Tone = TONE_CLASSES[tone!];
          const Arrow = tone === 'positive' ? ArrowUp : tone === 'negative' ? ArrowDown : Minus;
          const Tile = kpi.onClick ? 'button' : 'div';
          return (
            <Tile
              key={kpi.id}
              role="listitem"
              {...(kpi.onClick ? { onClick: kpi.onClick, type: 'button' as const } : {})}
              className={cn(
                'rounded-md border border-white/10 bg-black/40 p-3 text-left',
                'transition-colors',
                kpi.onClick && 'hover:border-amber-500/40 hover:bg-amber-500/5 focus:outline-none focus:ring-2 focus:ring-amber-500/40'
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 truncate">
                {kpi.label}
              </div>
              <div className="text-2xl font-mono font-semibold text-amber-200 tabular-nums">
                {formatValue(kpi.value, kpi.unit)}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                {kpi.deltaPct !== undefined && (
                  <>
                    <Arrow className={cn('w-3 h-3', Tone.arrow)} aria-hidden="true" />
                    <span className={cn('font-mono tabular-nums', Tone.delta)}>
                      {kpi.deltaPct > 0 ? '+' : ''}{kpi.deltaPct.toFixed(1)}%
                    </span>
                  </>
                )}
                {kpi.caption && (
                  <span className="text-gray-400 truncate">{kpi.caption}</span>
                )}
              </div>
            </Tile>
          );
        })}
      </div>
    </div>
  );
}

// ── PeriodSelector — companion picker for the strip ─────────────────────────

export type Period = 'mtd' | 'qtd' | 'ytd' | 'last_month' | 'last_quarter' | 'last_year' | 'custom';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'mtd',          label: 'This month' },
  { id: 'qtd',          label: 'This quarter' },
  { id: 'ytd',          label: 'YTD' },
  { id: 'last_month',   label: 'Last month' },
  { id: 'last_quarter', label: 'Last quarter' },
  { id: 'last_year',    label: 'Last year' },
];

export interface PeriodSelectorProps {
  value: Period;
  onChange: (next: Period) => void;
  className?: string;
}

export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div role="radiogroup" aria-label="Reporting period" className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {PERIODS.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p.id)}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
              active
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-white'
            )}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

export default KPIStrip;
