'use client';

/**
 * TierBadge — Consolidated tier display for DTUs across the platform.
 *
 * Tiers:
 *   - regular: subtle gray (no badge by default, optional)
 *   - mega: gold badge with star icon, "MEGA" text
 *   - hyper: platinum/purple badge with diamond icon, "HYPER" text
 *   - shadow: dim gray dashed badge
 *
 * Also displays:
 *   - Source DTU count for MEGAs ("Contains X source DTUs")
 *   - MEGA/total count for HYPERs ("Contains X MEGAs, Y total DTUs")
 *   - Consolidation redirect ("Consolidated into [name]")
 *   - Promotion timeline (shadow -> regular -> MEGA -> HYPER)
 */

import React, { useState } from 'react';
import { Star, Diamond, Ghost, Zap, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---- Types ----

export type DTUTier = 'regular' | 'mega' | 'hyper' | 'shadow';

export interface TierBadgeProps {
  tier: DTUTier | string;
  /** Show the badge even for 'regular' tier (default: hide regular) */
  showRegular?: boolean;
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

export interface TierBadgeDetailProps extends TierBadgeProps {
  /** Number of source DTUs absorbed (for MEGA) */
  sourceCount?: number;
  /** Source DTU summaries (expandable list for MEGA) */
  sourceDtus?: Array<{ id: string; title?: string }>;
  /** Number of MEGAs absorbed (for HYPER) */
  megaCount?: number;
  /** Total DTU count across all MEGAs (for HYPER) */
  totalDtuCount?: number;
  /** If this DTU was consolidated into another */
  consolidatedInto?: { id: string; title?: string } | null;
  /** Callback when consolidated parent is clicked */
  onNavigateToParent?: (id: string) => void;
}

export interface TierPromotionTimelineProps {
  /** History of tier changes, ordered chronologically */
  history: Array<{ tier: DTUTier | string; at: string; reason?: string }>;
  className?: string;
}

// ---- Config ----

const TIER_CONFIG: Record<string, {
  icon: typeof Star;
  label: string;
  color: string;
  bg: string;
  border: string;
  ring: string;
}> = {
  regular: {
    icon: Zap,
    label: 'Regular',
    color: 'text-gray-400',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30',
    ring: 'ring-gray-500',
  },
  mega: {
    icon: Star,
    label: 'MEGA',
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/40',
    ring: 'ring-amber-500',
  },
  hyper: {
    icon: Diamond,
    label: 'HYPER',
    color: 'text-purple-300',
    bg: 'bg-purple-500/15',
    border: 'border-purple-400/40',
    ring: 'ring-purple-400',
  },
  shadow: {
    icon: Ghost,
    label: 'Shadow',
    color: 'text-gray-400',
    bg: 'bg-gray-600/10',
    border: 'border-gray-600/30 border-dashed',
    ring: 'ring-gray-600',
  },
};

const SIZE_CLASSES = {
  sm: 'text-[10px] px-1.5 py-0.5 gap-0.5',
  md: 'text-xs px-2 py-0.5 gap-1',
  lg: 'text-sm px-2.5 py-1 gap-1.5',
};

const ICON_SIZES = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
  lg: 'w-4 h-4',
};

// ---- Components ----

/**
 * TierBadge — Compact badge showing DTU tier with icon.
 */
function TierBadgeInner({ tier, showRegular = false, className, size = 'md' }: TierBadgeProps) {
  const t = (tier || 'regular') as string;
  if (t === 'regular' && !showRegular) return null;

  const config = TIER_CONFIG[t] || TIER_CONFIG.regular;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold uppercase tracking-wide border',
        SIZE_CLASSES[size],
        config.bg,
        config.color,
        config.border,
        className
      )}
    >
      <Icon className={cn(ICON_SIZES[size], t === 'mega' && 'fill-amber-400/40', t === 'hyper' && 'fill-purple-400/40')} />
      {config.label}
    </span>
  );
}

export const TierBadge = React.memo(TierBadgeInner);

/**
 * TierBadgeDetail — Extended badge with consolidation metadata.
 * Shows source counts, expandable source list, and consolidation redirect.
 */
function TierBadgeDetailInner({
  tier,
  showRegular = false,
  className,
  size = 'md',
  sourceCount,
  sourceDtus,
  megaCount,
  totalDtuCount,
  consolidatedInto,
  onNavigateToParent,
}: TierBadgeDetailProps) {
  const [expanded, setExpanded] = useState(false);
  const t = (tier || 'regular') as string;

  return (
    <div className={cn('space-y-1', className)}>
      {/* Badge row */}
      <div className="flex items-center gap-2 flex-wrap">
        <TierBadge tier={tier} showRegular={showRegular} size={size} />

        {/* MEGA: source DTU count */}
        {t === 'mega' && sourceCount != null && sourceCount > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 text-xs text-amber-400/70 hover:text-amber-400 transition-colors"
          >
            Contains {sourceCount} source DTU{sourceCount !== 1 ? 's' : ''}
            {sourceDtus && sourceDtus.length > 0 && (
              expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
            )}
          </button>
        )}

        {/* HYPER: mega + total count */}
        {t === 'hyper' && (megaCount != null || totalDtuCount != null) && (
          <span className="text-xs text-purple-300/70">
            Contains {megaCount ?? '?'} MEGA{(megaCount ?? 0) !== 1 ? 's' : ''}
            {totalDtuCount != null && <>, {totalDtuCount} total DTU{totalDtuCount !== 1 ? 's' : ''}</>}
          </span>
        )}
      </div>

      {/* Expandable source list for MEGA */}
      {expanded && sourceDtus && sourceDtus.length > 0 && (
        <div className="ml-4 pl-2 border-l border-amber-500/20 space-y-1">
          {sourceDtus.map((src) => (
            <button
              key={src.id}
              onClick={() => onNavigateToParent?.(src.id)}
              className="block text-xs text-gray-400 hover:text-amber-400 transition-colors truncate max-w-[300px]"
            >
              {src.title || src.id.slice(0, 20) + '...'}
            </button>
          ))}
        </div>
      )}

      {/* Consolidation redirect */}
      {consolidatedInto && (
        <button
          onClick={() => onNavigateToParent?.(consolidatedInto.id)}
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-neon-cyan transition-colors"
        >
          <ArrowRight className="w-3 h-3" />
          Consolidated into {consolidatedInto.title || consolidatedInto.id.slice(0, 20) + '...'}
        </button>
      )}
    </div>
  );
}

export const TierBadgeDetail = React.memo(TierBadgeDetailInner);

/**
 * TierPromotionTimeline — Shows promotion history: shadow -> regular -> MEGA -> HYPER.
 */
const TIER_ORDER: Record<string, number> = { shadow: 0, regular: 1, mega: 2, hyper: 3 };

function TierPromotionTimelineInner({ history, className }: TierPromotionTimelineProps) {
  if (!history || history.length === 0) return null;

  const sorted = [...history].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  return (
    <div className={cn('space-y-0', className)}>
      <h4 className="text-xs font-medium text-gray-400 mb-2">Tier Promotion History</h4>
      <div className="flex items-center gap-1 flex-wrap">
        {sorted.map((entry, i) => {
          const config = TIER_CONFIG[entry.tier] || TIER_CONFIG.regular;
          const isLast = i === sorted.length - 1;
          const isPromotion = i > 0 && (TIER_ORDER[entry.tier] ?? 1) > (TIER_ORDER[sorted[i - 1].tier] ?? 1);

          return (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center" title={`${entry.tier} - ${new Date(entry.at).toLocaleString()}${entry.reason ? ` (${entry.reason})` : ''}`}>
                <div
                  className={cn(
                    'w-3 h-3 rounded-full border-2',
                    config.ring.replace('ring-', 'border-'),
                    isLast ? config.bg : 'bg-transparent'
                  )}
                />
                <span className={cn('text-[9px] mt-0.5', config.color)}>
                  {config.label}
                </span>
              </div>
              {!isLast && (
                <div className={cn(
                  'w-6 h-0.5 -mt-3',
                  isPromotion ? 'bg-gradient-to-r from-gray-600 to-amber-500/50' : 'bg-gray-700'
                )} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export const TierPromotionTimeline = React.memo(TierPromotionTimelineInner);

export default TierBadge;
