'use client';

/**
 * /lenses/achievements — gallery of unlocked + locked + hidden.
 *
 * Sorts: earned first (recency desc), then locked by category.
 * Filters: category (combat / economy / exploration / social / mastery / general).
 * Hidden achievements show only after they're earned.
 *
 * Four UX states (all genuine, no fabricated rows):
 *   - loading  : skeleton grid while the real catalog + earned fetches resolve
 *   - error    : honest message + retry when the catalog fetch fails
 *   - empty    : real catalog loaded but zero earned (or category empty)
 *   - populated: the real authored catalog + the player's real progress
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Lock, Sparkles, Zap, Star, AlertTriangle, RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  category: string;
  icon?: string;
  rarity: 'bronze' | 'silver' | 'gold' | 'legendary';
  hidden: boolean;
  rewardSparks?: number;
  rewardTitle?: string | null;
}

interface EarnedEntry {
  achievement_id: string;
  earned_at: number;
}

const CATEGORIES = ['all', 'combat', 'economy', 'exploration', 'social', 'mastery', 'general'] as const;
type Category = typeof CATEGORIES[number];

type LoadState = 'loading' | 'error' | 'ready';

const RARITY_RING: Record<string, string> = {
  bronze:    'border-amber-700/40 bg-amber-700/10',
  silver:    'border-slate-400/40 bg-slate-400/10',
  gold:      'border-yellow-500/50 bg-yellow-500/10',
  legendary: 'border-fuchsia-400/60 bg-fuchsia-500/15 shadow-fuchsia-500/30 shadow-lg',
};

export default function AchievementsLensPage() {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [earned, setEarned] = useState<EarnedEntry[]>([]);
  const [category, setCategory] = useState<Category>('all');
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      // The catalog is the load-bearing fetch — if it fails, the gallery has
      // nothing real to show, so that's the error state. The earned fetch is
      // best-effort (an unauthenticated visitor still sees the locked catalog).
      const [catRes, mineRes] = await Promise.allSettled([
        fetch('/api/achievements/catalog').then((r) => {
          if (!r.ok) throw new Error(`catalog ${r.status}`);
          return r.json();
        }),
        fetch('/api/achievements/mine', { credentials: 'include' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      if (catRes.status !== 'fulfilled' || !catRes.value?.ok) {
        throw new Error(
          catRes.status === 'rejected'
            ? String(catRes.reason?.message || catRes.reason)
            : 'catalog unavailable',
        );
      }
      setCatalog(Array.isArray(catRes.value.catalog) ? catRes.value.catalog : []);
      const mine = mineRes.status === 'fulfilled' ? mineRes.value : null;
      setEarned(mine?.ok && Array.isArray(mine.earned) ? mine.earned : []);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load achievements.');
      setState('error');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('achievement:unlocked', handler);
    return () => window.removeEventListener('achievement:unlocked', handler);
  }, [refresh]);

  const earnedIds = useMemo(() => new Set(earned.map((e) => e.achievement_id)), [earned]);

  const visible = useMemo(() => {
    return catalog
      .filter((a) => earnedIds.has(a.id) || !a.hidden)
      .filter((a) => category === 'all' || a.category === category)
      .sort((a, b) => {
        const aEarned = earnedIds.has(a.id) ? 1 : 0;
        const bEarned = earnedIds.has(b.id) ? 1 : 0;
        if (aEarned !== bEarned) return bEarned - aEarned;
        return a.rarity.localeCompare(b.rarity);
      });
  }, [catalog, earnedIds, category]);

  const counts = useMemo(() => {
    const total = catalog.length;
    const visibleTotal = catalog.filter((a) => earnedIds.has(a.id) || !a.hidden).length;
    return { earned: earned.length, total, visibleTotal };
  }, [catalog, earned, earnedIds]);

  return (
    <LensShell lensId="achievements" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Trophy className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Achievements</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {state === 'ready'
                  ? `${counts.earned} / ${counts.visibleTotal} earned · ${counts.total} total in catalog`
                  : state === 'loading'
                    ? 'Loading catalog…'
                    : 'Catalog unavailable'}
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={state === 'loading'}
              aria-label="Refresh achievements"
              className="rounded-md border border-slate-700 bg-slate-800/50 p-1.5 text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
          <nav className="mx-auto mt-2 flex max-w-screen-2xl flex-wrap gap-1" aria-label="Filter by category">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${category === c ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100' : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-700/40'}`}
              >
                {c}
              </button>
            ))}
          </nav>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {state === 'loading' && (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              <span className="sr-only">Loading achievements…</span>
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[92px] animate-pulse rounded-lg border border-slate-800 bg-slate-800/30"
                  aria-hidden="true"
                />
              ))}
            </div>
          )}

          {state === 'error' && (
            <div
              role="alert"
              className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-6 py-10 text-center"
            >
              <AlertTriangle className="h-8 w-8 text-red-400" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-200">Couldn&apos;t load achievements</p>
              <p className="text-xs text-slate-400">{error || 'The achievement catalog is unavailable right now.'}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-1 flex items-center gap-1.5 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/20"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
              </button>
            </div>
          )}

          {state === 'ready' && visible.length > 0 && (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((a) => {
                const isEarned = earnedIds.has(a.id);
                return (
                  <li
                    key={a.id}
                    className={`rounded-lg border p-3 ${RARITY_RING[a.rarity] || RARITY_RING.bronze} ${isEarned ? '' : 'opacity-60 grayscale-[40%]'}`}
                    aria-label={`${a.title}, ${a.rarity} ${a.category} achievement, ${isEarned ? 'earned' : 'locked'}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`rounded-full p-2 ${isEarned ? 'bg-black/30' : 'bg-slate-800/40'}`}>
                        {isEarned
                          ? <Trophy className="h-4 w-4" aria-hidden="true" />
                          : <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                          <span>{a.rarity}</span>
                          <span aria-hidden="true">·</span>
                          <span>{a.category}</span>
                        </div>
                        <div className="text-sm font-semibold text-slate-100 truncate">{a.title}</div>
                        <p className="mt-0.5 text-[11px] text-slate-400">{a.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                          {a.rewardSparks != null && a.rewardSparks > 0 && (
                            <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
                              <Zap className="h-2.5 w-2.5" aria-hidden="true" /> +{a.rewardSparks} Sparks
                            </span>
                          )}
                          {a.rewardTitle && (
                            <span className="flex items-center gap-1 rounded bg-fuchsia-500/30 px-1.5 py-0.5 text-fuchsia-100">
                              <Star className="h-2.5 w-2.5" aria-hidden="true" /> {a.rewardTitle}
                            </span>
                          )}
                          {isEarned && (
                            <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">
                              <Sparkles className="h-2.5 w-2.5" aria-hidden="true" /> earned
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {state === 'ready' && visible.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-12 text-center">
              <Trophy className="h-8 w-8 text-slate-600" aria-hidden="true" />
              <p className="text-sm font-medium text-slate-300">
                {counts.earned === 0 && category === 'all'
                  ? 'No achievements unlocked yet'
                  : 'Nothing in this category yet'}
              </p>
              <p className="text-xs text-slate-500">
                {counts.earned === 0 && category === 'all'
                  ? 'Play the world — combat, trade, exploration and social milestones unlock achievements automatically.'
                  : 'Try another category, or keep playing to unlock these.'}
              </p>
            </div>
          )}
        </section>
      </main>
    </LensShell>
  );
}
