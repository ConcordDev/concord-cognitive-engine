'use client';

/**
 * /lenses/achievements — gallery of unlocked + locked + hidden.
 *
 * Sorts: earned first (recency desc), then locked by category.
 * Filters: category (combat / economy / exploration / social / mastery / general).
 * Hidden achievements show only after they're earned.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Lock, Sparkles, Zap, Star } from 'lucide-react';
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

interface EarnedEntry extends CatalogEntry {
  achievement_id: string;
  earned_at: number;
}

const CATEGORIES = ['all', 'combat', 'economy', 'exploration', 'social', 'mastery', 'general'] as const;
type Category = typeof CATEGORIES[number];

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

  const refresh = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        fetch('/api/achievements/catalog').then((r) => r.json()).catch(() => null),
        fetch('/api/achievements/mine', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
      if (c?.ok) setCatalog(c.catalog || []);
      if (e?.ok) setEarned(e.earned || []);
    } catch { /* network blip */ }
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
    // Earned-or-not-hidden, filtered by category.
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
              <Trophy className="h-5 w-5 text-fuchsia-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Achievements</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {counts.earned} / {counts.visibleTotal} earned · {counts.total} total in catalog
              </p>
            </div>
          </div>
          <div className="mx-auto mt-2 flex max-w-screen-2xl flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${category === c ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100' : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-700/40'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((a) => {
              const isEarned = earnedIds.has(a.id);
              return (
                <div
                  key={a.id}
                  className={`rounded-lg border p-3 ${RARITY_RING[a.rarity] || RARITY_RING.bronze} ${isEarned ? '' : 'opacity-60 grayscale-[40%]'}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`rounded-full p-2 ${isEarned ? 'bg-black/30' : 'bg-slate-800/40'}`}>
                      {isEarned ? <Trophy className="h-4 w-4" /> : <Lock className="h-4 w-4 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
                        <span>{a.rarity}</span>
                        <span>·</span>
                        <span>{a.category}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-100 truncate">{a.title}</div>
                      <p className="mt-0.5 text-[11px] text-slate-400">{a.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                        {a.rewardSparks != null && a.rewardSparks > 0 && (
                          <span className="flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
                            <Zap className="h-2.5 w-2.5" /> +{a.rewardSparks} Sparks
                          </span>
                        )}
                        {a.rewardTitle && (
                          <span className="flex items-center gap-1 rounded bg-fuchsia-500/30 px-1.5 py-0.5 text-fuchsia-100">
                            <Star className="h-2.5 w-2.5" /> {a.rewardTitle}
                          </span>
                        )}
                        {isEarned && (
                          <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">
                            <Sparkles className="h-2.5 w-2.5" /> earned
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {visible.length === 0 && (
            <p className="px-2 py-8 text-center text-[12px] text-slate-500">No achievements in this category yet.</p>
          )}
        </section>
      </main>
    </LensShell>
  );
}
