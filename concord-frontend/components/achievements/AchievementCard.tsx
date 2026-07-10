'use client';

/**
 * AchievementCard — one catalog entry, earned or locked.
 *
 * Earned: full-color icon in a solid badge + earned-date + reward chips.
 * Locked (visible, non-hidden): the SAME real icon the catalog authored
 * for it, desaturated, with a small lock badge overlay — so a browsing
 * player can tell achievements apart by silhouette/icon even before
 * earning them, instead of every locked card rendering an identical
 * generic padlock glyph.
 */

import { Lock, Sparkles, Star, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { resolveAchievementIcon } from './icon-map';
import type { AchievementCatalogEntry } from './types';

const RARITY_RING: Record<string, string> = {
  bronze: 'border-amber-700/40 bg-amber-700/10',
  silver: 'border-slate-400/40 bg-slate-400/10',
  gold: 'border-yellow-500/50 bg-yellow-500/10',
  legendary: 'border-fuchsia-400/60 bg-fuchsia-500/15 shadow-fuchsia-500/30 shadow-lg',
};

const RARITY_ICON_TONE: Record<string, string> = {
  bronze: 'text-amber-300',
  silver: 'text-slate-200',
  gold: 'text-yellow-300',
  legendary: 'text-fuchsia-200',
};

export interface AchievementCardProps {
  achievement: AchievementCatalogEntry;
  earned: boolean;
  earnedAt?: number;
  /** Deep-linked or just-unlocked — draws attention with a highlight ring/pulse. */
  highlighted?: boolean;
  /** Assigns an id="achievement-{id}" for scroll-into-view targeting. */
  anchorId?: boolean;
}

export function AchievementCard({ achievement: a, earned, earnedAt, highlighted, anchorId }: AchievementCardProps) {
  const Icon = resolveAchievementIcon(a.icon);
  const iconTone = RARITY_ICON_TONE[a.rarity] || RARITY_ICON_TONE.bronze;

  return (
    <li
      id={anchorId ? `achievement-${a.id}` : undefined}
      className={cn(
        'rounded-lg border p-3 transition-shadow duration-300',
        RARITY_RING[a.rarity] || RARITY_RING.bronze,
        !earned && 'opacity-60 grayscale-[40%]',
        highlighted && 'ring-2 ring-fuchsia-400 ring-offset-2 ring-offset-zinc-950 animate-[pulse_1.4s_ease-in-out_2]',
      )}
      aria-label={`${a.title}, ${a.rarity} ${a.category} achievement, ${earned ? 'earned' : 'locked'}`}
    >
      <div className="flex items-start gap-2">
        <div className={cn('relative rounded-full p-2', earned ? 'bg-black/30' : 'bg-slate-800/40')}>
          <Icon className={cn('h-4 w-4', earned ? iconTone : 'text-slate-500')} aria-hidden="true" />
          {!earned && (
            <span
              className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-950 bg-slate-800"
              aria-hidden="true"
            >
              <Lock className="h-2 w-2 text-slate-400" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
            <span>{a.rarity}</span>
            <span aria-hidden="true">·</span>
            <span>{a.category}</span>
          </div>
          <div className="truncate text-sm font-semibold text-slate-100">{a.title}</div>
          <p className="mt-0.5 text-[11px] text-slate-400">{a.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
            {!!a.rewardSparks && a.rewardSparks > 0 && (
              <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
                <Zap className="h-2.5 w-2.5" aria-hidden="true" /> +{a.rewardSparks} Sparks
              </span>
            )}
            {a.rewardTitle && (
              <span className="flex items-center gap-1 rounded bg-fuchsia-500/30 px-1.5 py-0.5 text-fuchsia-100">
                <Star className="h-2.5 w-2.5" aria-hidden="true" /> {a.rewardTitle}
              </span>
            )}
            {earned && (
              <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">
                <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                {earnedAt ? formatRelativeTime(earnedAt * 1000) : 'earned'}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
