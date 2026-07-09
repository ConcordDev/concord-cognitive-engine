'use client';

/**
 * TitlesPanel — real, previously-unsurfaced feature.
 *
 * `player_titles` (migration 192) is the direct reward mechanic behind
 * `achievement.rewardTitle` — unlocking an achievement with a title
 * reward inserts a row here (server/lib/achievement-engine.js#unlockAchievement).
 * `GET /api/titles/mine` + `POST /api/titles/:titleId/equip` +
 * `POST /api/titles/unequip` (server/lib/player-titles.js, server.js
 * "Phase U3 — titles") existed with zero frontend callers before this
 * rebuild — grep confirmed 0 references in concord-frontend prior to
 * this file. This panel is the first UI for it.
 *
 * `users.active_title_id` is what other surfaces (friend presence,
 * etc.) read to display a player's chosen title, so equipping here is
 * a real, visible account setting — not a local preference.
 */

import { useCallback, useEffect, useState } from 'react';
import { Crown, Check } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import type { OwnedTitle } from './types';

type LoadState = 'loading' | 'error' | 'ready';

export function TitlesPanel({ refreshSignal }: { refreshSignal?: number }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [owned, setOwned] = useState<OwnedTitle[]>([]);
  const [active, setActive] = useState<OwnedTitle | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const res = await api.get('/api/titles/mine');
      if (!res.data?.ok) throw new Error('titles unavailable');
      setOwned(Array.isArray(res.data.owned) ? res.data.owned : []);
      setActive(res.data.active ?? null);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load titles.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setState('ready');
      setOwned([]);
      setActive(null);
      return;
    }
    void load();
  }, [authLoading, isAuthenticated, load, refreshSignal]);

  const equip = useCallback(async (titleId: string) => {
    setPendingId(titleId);
    try {
      const res = await api.post(`/api/titles/${encodeURIComponent(titleId)}/equip`);
      if (res.data?.ok) {
        const row = owned.find((t) => t.id === titleId) || null;
        setActive(row);
      }
    } catch {
      // Honest no-op — the panel just doesn't reflect a change that didn't happen.
    } finally {
      setPendingId(null);
    }
  }, [owned]);

  const unequip = useCallback(async () => {
    setPendingId('__unequip__');
    try {
      const res = await api.post('/api/titles/unequip');
      if (res.data?.ok) setActive(null);
    } catch {
      // Honest no-op.
    } finally {
      setPendingId(null);
    }
  }, []);

  if (!authLoading && !isAuthenticated) {
    return (
      <section aria-labelledby="titles-heading" className="rounded-lg border border-slate-800 bg-zinc-950/40 p-3">
        <h2 id="titles-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
          <Crown className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden="true" /> Titles
        </h2>
        <EmptyState
          compact
          icon={<Crown className="h-5 w-5" aria-hidden="true" />}
          title="Sign in to see your titles"
          description="Achievement rewardTitle unlocks appear here once you're signed in."
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="titles-heading" className="rounded-lg border border-slate-800 bg-zinc-950/40 p-3">
      <h2 id="titles-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
        <Crown className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden="true" /> Titles
      </h2>

      {(state === 'loading' || authLoading) && (
        <div className="space-y-2" role="status" aria-busy="true">
          <span className="sr-only">Loading titles…</span>
          <Skeleton variant="line" height="2.25rem" />
          <Skeleton variant="line" height="2.25rem" />
        </div>
      )}

      {state === 'error' && (
        <ErrorState variant="inline" message={error || 'Titles unavailable.'} onRetry={load} />
      )}

      {state === 'ready' && !authLoading && owned.length === 0 && (
        <EmptyState
          compact
          icon={<Crown className="h-5 w-5" aria-hidden="true" />}
          title="No titles yet"
          description="Achievements with a title reward grant one here — equip it to display it."
        />
      )}

      {state === 'ready' && !authLoading && owned.length > 0 && (
        <ul className="space-y-1.5">
          {owned.map((t) => {
            const isActive = active?.id === t.id;
            const isPending = pendingId === t.id;
            return (
              <li
                key={t.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5',
                  isActive ? 'border-fuchsia-400/50 bg-fuchsia-500/10' : 'border-slate-800 bg-slate-900/30',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-slate-100">{t.title}</div>
                  <div className="text-[10px] text-slate-500">earned {formatRelativeTime(t.earnedAt * 1000)}</div>
                </div>
                {isActive ? (
                  <button
                    type="button"
                    onClick={unequip}
                    disabled={pendingId === '__unequip__'}
                    title="Click to clear active title"
                    className="flex shrink-0 items-center gap-1 rounded border border-fuchsia-400/40 bg-fuchsia-500/20 px-2 py-1 text-[10px] font-medium text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40"
                  >
                    <Check className="h-2.5 w-2.5" aria-hidden="true" />
                    {pendingId === '__unequip__' ? 'Clearing…' : 'Active'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => equip(t.id)}
                    disabled={isPending}
                    className="flex shrink-0 items-center gap-1 rounded border border-slate-700 bg-slate-800/50 px-2 py-1 text-[10px] font-medium text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
                  >
                    {isPending ? 'Equipping…' : 'Equip'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
