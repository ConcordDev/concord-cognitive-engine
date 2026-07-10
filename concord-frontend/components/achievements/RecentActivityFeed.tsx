'use client';

/**
 * RecentActivityFeed — community-wide "who unlocked what" feed.
 *
 * Backed by GET /api/achievements/recent (== achievements.recent macro),
 * a real read that existed with zero frontend caller before this rebuild.
 * Seeded from that REST fetch, then kept live via the `achievement:unlocked`
 * realtime event (the same event `components/world/AchievementToast.tsx`
 * consumes for the in-world toast — this is the standalone-lens equivalent
 * surface, not a duplicate of it).
 *
 * Hidden-achievement safety: the REST feed already filters `hidden=0`
 * server-side, but the realtime broadcast does not carry that filter (it
 * fires from `unlockAchievement` for every unlock). To avoid this panel
 * becoming the surface that leaks a hidden achievement's existence/title
 * to players who haven't earned it, live pushes are cross-checked against
 * the caller's own loaded catalog (`catalogById`) and dropped if that
 * catalog entry is `hidden`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Trophy } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';
import { cn, formatRelativeTime } from '@/lib/utils';
import { StatusDot } from '@/components/ui/StatusDot';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { resolveAchievementIcon } from './icon-map';
import type { AchievementCatalogEntry, AchievementUnlockedEvent, RecentUnlockRow } from './types';

type LoadState = 'loading' | 'error' | 'ready';

interface FeedItem {
  key: string;
  userId: string;
  achievementId: string;
  earnedAt: number; // unix seconds
  title: string;
  rarity: string;
  icon?: string;
  live?: boolean;
}

const RARITY_DOT: Record<string, string> = {
  bronze: 'bg-amber-500',
  silver: 'bg-slate-400',
  gold: 'bg-yellow-400',
  legendary: 'bg-fuchsia-400',
};

const MAX_ITEMS = 30;
const FEED_LIMIT = 20;

export function RecentActivityFeed({
  catalogById,
  currentUserId,
}: {
  catalogById: Map<string, AchievementCatalogEntry>;
  currentUserId?: string | null;
}) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const seenKeys = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const r = await fetch(`/api/achievements/recent?limit=${FEED_LIMIT}`);
      if (!r.ok) throw new Error(`recent ${r.status}`);
      const data = await r.json();
      if (!data?.ok) throw new Error('recent unavailable');
      const rows: RecentUnlockRow[] = Array.isArray(data.recent) ? data.recent : [];
      const mapped = rows.map((row) => ({
        key: `${row.userId}:${row.achievement_id}`,
        userId: row.userId,
        achievementId: row.achievement_id,
        earnedAt: row.earned_at,
        title: row.title,
        rarity: row.rarity,
        icon: row.icon,
      }));
      mapped.forEach((m) => seenKeys.current.add(m.key));
      setItems(mapped);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const off = subscribe<AchievementUnlockedEvent>('achievement:unlocked', (data) => {
      if (!data?.achievementId || !data?.userId) return;
      const catalogEntry = catalogById.get(data.achievementId);
      // Hidden-safety: only surface if we know it's non-hidden (or we have
      // no catalog opinion yet — err toward showing rather than silently
      // dropping every event before the catalog has loaded).
      if (catalogEntry?.hidden) return;
      const key = `${data.userId}:${data.achievementId}`;
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);
      setItems((prev) => [
        {
          key,
          userId: data.userId,
          achievementId: data.achievementId,
          earnedAt: Math.floor(Date.now() / 1000),
          title: data.title,
          rarity: data.rarity,
          icon: data.icon,
          live: true,
        },
        ...prev,
      ].slice(0, MAX_ITEMS));
      // Clear the "live" flash after a few seconds.
      setTimeout(() => {
        setItems((prev) => prev.map((it) => (it.key === key ? { ...it, live: false } : it)));
      }, 3000);
    });
    return () => off?.();
  }, [catalogById]);

  return (
    <section aria-labelledby="activity-heading" className="rounded-lg border border-slate-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="activity-heading" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
          <Activity className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden="true" /> Activity
        </h2>
        <StatusDot state="live" size="xs" label="Live" showLabel />
      </div>

      {state === 'loading' && (
        <div className="space-y-2" role="status" aria-busy="true">
          <span className="sr-only">Loading recent activity…</span>
          <Skeleton variant="line" lines={4} />
        </div>
      )}

      {state === 'error' && (
        <ErrorState variant="inline" message={error || 'Activity feed unavailable.'} onRetry={load} />
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState
          compact
          icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
          title="No unlocks yet"
          description="Community unlocks will appear here as players earn achievements."
        />
      )}

      {state === 'ready' && items.length > 0 && (
        <ul className="max-h-80 space-y-1 overflow-y-auto pr-0.5">
          {items.map((it) => {
            const Icon = resolveAchievementIcon(it.icon);
            const isYou = currentUserId && it.userId === currentUserId;
            return (
              <li
                key={it.key}
                className={cn(
                  'flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] transition-colors duration-700',
                  it.live ? 'bg-fuchsia-500/15' : 'bg-transparent',
                )}
              >
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', RARITY_DOT[it.rarity] || RARITY_DOT.bronze)} aria-hidden="true" />
                <Icon className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-slate-300">
                  <span className={cn('font-medium', isYou ? 'text-fuchsia-300' : 'text-slate-200')}>
                    {isYou ? 'You' : `Player ${it.userId.slice(0, 6)}`}
                  </span>{' '}
                  unlocked <span className="text-slate-100">{it.title}</span>
                </span>
                <span className="shrink-0 text-slate-500">{formatRelativeTime(it.earnedAt * 1000)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
