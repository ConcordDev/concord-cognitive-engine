'use client';

/**
 * CreatorBadge — unified creator + provenance + tier + royalty surface
 * for any DTU. One import, one prop bag, three sizes; composes the
 * existing ProvenanceBadge + TierBadge primitives so it stays in sync
 * as those evolve.
 */

import React from 'react';
import { Coins, User } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ProvenanceBadge } from './ProvenanceBadge';
import { TierBadge, type DTUTier } from './TierBadge';

export interface CreatorBadgeProps {
  creator?: {
    id?: string;
    displayName?: string;
    avatarUrl?: string;
  };
  provenance?: {
    source?: string;
    model?: string;
    authority?: string;
  };
  tier?: DTUTier | string;
  /** Royalty rate as 0..1 (e.g. 0.21 for 21 %). */
  royaltyRate?: number;
  /** Lifetime royalty earnings in CC. */
  royaltyEarnedCc?: number;
  /** Show only the creator chip; useful in tight inline contexts. */
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  onClickCreator?: (creatorId?: string) => void;
}

const SIZE_TEXT = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
} as const;

const SIZE_AVATAR = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-6 h-6',
} as const;

function formatRoyalty(rate?: number, earned?: number): string | null {
  const parts: string[] = [];
  if (rate != null && rate > 0) parts.push(`${(rate * 100).toFixed(rate < 0.01 ? 2 : 1)}% royalty`);
  if (earned != null && earned > 0) {
    parts.push(`${earned >= 1000 ? `${(earned / 1000).toFixed(1)}k` : earned.toFixed(0)} CC`);
  }
  return parts.length ? parts.join(' · ') : null;
}

function CreatorBadgeInner({
  creator,
  provenance,
  tier,
  royaltyRate,
  royaltyEarnedCc,
  compact = false,
  size = 'md',
  className,
  onClickCreator,
}: CreatorBadgeProps) {
  const creatorLabel = creator?.displayName || (creator?.id ? creator.id.slice(0, 8) : 'Anonymous');
  const royaltyLine = formatRoyalty(royaltyRate, royaltyEarnedCc);

  const creatorChip = (
    <button
      type="button"
      onClick={onClickCreator ? () => onClickCreator(creator?.id) : undefined}
      disabled={!onClickCreator}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-lattice-border/60',
        'bg-lattice-surface/40 px-2 py-0.5 transition',
        SIZE_TEXT[size],
        onClickCreator
          ? 'hover:border-neon-cyan/50 hover:text-neon-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/40'
          : 'cursor-default'
      )}
      aria-label={`Creator: ${creatorLabel}`}
    >
      {creator?.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={creator.avatarUrl}
          alt=""
          className={cn('rounded-full object-cover', SIZE_AVATAR[size])}
        />
      ) : (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-gray-700/60 text-gray-300',
            SIZE_AVATAR[size]
          )}
          aria-hidden="true"
        >
          <User className="w-3 h-3" />
        </span>
      )}
      <span className="font-medium text-gray-200 max-w-[140px] truncate">{creatorLabel}</span>
    </button>
  );

  if (compact) {
    return <span className={cn('inline-flex items-center gap-2', className)}>{creatorChip}</span>;
  }

  return (
    <div
      className={cn('inline-flex flex-wrap items-center gap-2', className)}
      role="group"
      aria-label="DTU creator and provenance"
    >
      {creatorChip}
      {provenance && (
        <ProvenanceBadge
          source={provenance.source}
          model={provenance.model}
          authority={provenance.authority}
        />
      )}
      {tier && <TierBadge tier={tier as DTUTier} size={size} />}
      {royaltyLine && (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-300',
            SIZE_TEXT[size]
          )}
          title="Royalty rate · lifetime earnings"
        >
          <Coins className="w-3 h-3" aria-hidden="true" />
          {royaltyLine}
        </span>
      )}
    </div>
  );
}

export const CreatorBadge = React.memo(CreatorBadgeInner);
export default CreatorBadge;
