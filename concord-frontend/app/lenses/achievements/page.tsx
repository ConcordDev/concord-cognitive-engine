'use client';

/**
 * /lenses/achievements — gallery + titles + community activity.
 *
 * Capability map (server/domains/achievements.js, server/lib/achievement-engine.js,
 * server/lib/player-titles.js — verified 2026-07-09):
 *
 *   achievements.list / GET /api/achievements/catalog   → DESIGNED (this page's gallery)
 *   achievements.mine / GET /api/achievements/mine       → DESIGNED (earned state, stat tiles)
 *   achievements.recent / GET /api/achievements/recent   → DESIGNED (RecentActivityFeed — was
 *                                                            wired server-side with zero frontend
 *                                                            caller before this rebuild)
 *   achievements.get / GET /api/achievements/catalog/:id → UNSURFACED, intentionally: the catalog
 *                                                            fetch above already returns every
 *                                                            display field a single-entry lookup
 *                                                            would, so there is no distinct UI
 *                                                            need for a second round-trip. Not
 *                                                            forced into use just to claim
 *                                                            coverage — documented here instead.
 *   GET /api/titles/mine, POST /api/titles/:id/equip,
 *   POST /api/titles/unequip                              → DESIGNED (TitlesPanel — adjacent
 *                                                            reward mechanic behind
 *                                                            achievement.rewardTitle; grep found
 *                                                            zero frontend callers before this
 *                                                            rebuild, so it's the first UI for it)
 *
 * `achievements` is genuinely lens-owned, not world-owned: the ONLY
 * achievement-related UI in components/world/ is `AchievementToast.tsx`,
 * a live in-world unlock notification — a complementary micro-surface,
 * not a competing gallery/browse/equip experience. This page remains
 * the real standalone app for that.
 *
 * Four honest states (loading / error / empty / populated) — no
 * fabricated rows, no fake data ever rendered as if real.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Trophy, AlertTriangle, RefreshCw, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { subscribe } from '@/lib/realtime/socket';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AchievementCard } from '@/components/achievements/AchievementCard';
import { CategoryProgress, type CategoryProgressRow } from '@/components/achievements/CategoryProgress';
import { TitlesPanel } from '@/components/achievements/TitlesPanel';
import { RecentActivityFeed } from '@/components/achievements/RecentActivityFeed';
import type {
  AchievementCatalogEntry,
  AchievementUnlockedEvent,
  EarnedEntry,
} from '@/components/achievements/types';

type LoadState = 'loading' | 'error' | 'ready';
type SortMode = 'default' | 'recent' | 'alpha' | 'rarity';

const RARITY_ORDER: Record<string, number> = { legendary: 0, gold: 1, silver: 2, bronze: 3 };
const HIGHLIGHT_MS = 3600;

function AchievementsLensInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  // useSearchParams() can legitimately return null (Next.js docs — outside a
  // router context, e.g. during certain test/static-render paths); guard the
  // read instead of crashing the whole page on it.
  const deepLinkId = params?.get('id') ?? null;

  const [catalog, setCatalog] = useState<AchievementCatalogEntry[]>([]);
  const [earned, setEarned] = useState<EarnedEntry[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('default');
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [titlesRefreshSignal, setTitlesRefreshSignal] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const deepLinkHandled = useRef(false);

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
          catRes.status === 'rejected' ? String(catRes.reason?.message || catRes.reason) : 'catalog unavailable',
        );
      }
      setCatalog(Array.isArray(catRes.value.catalog) ? catRes.value.catalog : []);
      const mine = mineRes.status === 'fulfilled' ? mineRes.value : null;
      setEarned(mine?.ok && Array.isArray(mine.earned) ? mine.earned : []);
      setState('ready');
    } catch (e) {
      // Log the real technical detail for debugging; show honest, human-
      // readable copy to the user instead of a raw HTTP-status string
      // ("catalog 500") — the underlying failure is still true, just not
      // dumped verbatim into the UI.
      console.error('[achievements] catalog fetch failed:', e);
      setError('The achievement catalog couldn’t load. Check your connection and try again.');
      setState('error');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const off = subscribe<AchievementUnlockedEvent>('achievement:unlocked', (data) => {
      void refresh();
      if (user && data?.userId === user.id && data?.achievementId) {
        const id = data.achievementId;
        setHighlightedIds((prev) => new Set(prev).add(id));
        setTimeout(() => {
          setHighlightedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        }, HIGHLIGHT_MS);
        if (data.rewardTitle) setTitlesRefreshSignal((s) => s + 1);
      }
    });
    return () => off?.();
  }, [refresh, user]);

  const earnedIds = useMemo(() => new Set(earned.map((e) => e.achievement_id)), [earned]);
  const earnedAtById = useMemo(
    () => new Map(earned.map((e) => [e.achievement_id, e.earned_at])),
    [earned],
  );
  const catalogById = useMemo(() => new Map(catalog.map((a) => [a.id, a])), [catalog]);

  // Categories are derived from the real catalog, not hand-maintained — a
  // hardcoded list previously omitted the authored 'seasonal' category
  // entirely, so seasonal achievements had no filter tab to reach them.
  const categories = useMemo(() => {
    const set = new Set(catalog.map((a) => a.category));
    return ['all', ...Array.from(set).sort()];
  }, [catalog]);

  const visibleAll = useMemo(
    () => catalog.filter((a) => earnedIds.has(a.id) || !a.hidden),
    [catalog, earnedIds],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = visibleAll.filter((a) => category === 'all' || a.category === category);
    if (q) list = list.filter((a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));

    const sorted = [...list];
    if (sort === 'alpha') {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'rarity') {
      sorted.sort((a, b) => (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9) || a.title.localeCompare(b.title));
    } else if (sort === 'recent') {
      sorted.sort((a, b) => {
        const ea = earnedIds.has(a.id);
        const eb = earnedIds.has(b.id);
        if (ea !== eb) return ea ? -1 : 1;
        if (ea && eb) return (earnedAtById.get(b.id) || 0) - (earnedAtById.get(a.id) || 0);
        return a.title.localeCompare(b.title);
      });
    } else {
      sorted.sort((a, b) => {
        const ea = earnedIds.has(a.id) ? 1 : 0;
        const eb = earnedIds.has(b.id) ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9);
      });
    }
    return sorted;
  }, [visibleAll, category, search, sort, earnedIds, earnedAtById]);

  const counts = useMemo(() => {
    const total = catalog.length;
    const visibleTotal = visibleAll.length;
    const sparks = earned.reduce((sum, e) => sum + (Number(e.rewardSparks) || 0), 0);
    const pct = visibleTotal > 0 ? Math.round((earned.length / visibleTotal) * 100) : 0;
    return { earned: earned.length, total, visibleTotal, sparks, pct };
  }, [catalog, earned, visibleAll]);

  const categoryProgressRows = useMemo<CategoryProgressRow[]>(() => {
    const byCat = new Map<string, { earned: number; total: number }>();
    for (const a of visibleAll) {
      const row = byCat.get(a.category) || { earned: 0, total: 0 };
      row.total += 1;
      if (earnedIds.has(a.id)) row.earned += 1;
      byCat.set(a.category, row);
    }
    return Array.from(byCat.entries())
      .map(([cat, r]) => ({ category: cat, ...r }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [visibleAll, earnedIds]);

  // Deep-link support: /lenses/achievements?id=xyz scrolls + highlights the
  // matching card once the real catalog has loaded. If the id isn't in the
  // visible set (invalid, or a hidden achievement not yet earned by this
  // viewer), we say so honestly rather than silently doing nothing.
  useEffect(() => {
    if (!deepLinkId || state !== 'ready' || deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    if (!visibleAll.some((a) => a.id === deepLinkId)) return;
    setHighlightedIds((prev) => new Set(prev).add(deepLinkId));
    requestAnimationFrame(() => {
      document.getElementById(`achievement-${deepLinkId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setTimeout(() => {
      setHighlightedIds((prev) => { const n = new Set(prev); n.delete(deepLinkId); return n; });
    }, HIGHLIGHT_MS);
  }, [deepLinkId, state, visibleAll]);

  const deepLinkMissing = Boolean(deepLinkId) && state === 'ready' && !visibleAll.some((a) => a.id === deepLinkId);

  useLensCommand(
    [
      {
        id: 'achievements-focus-search',
        keys: '/',
        description: 'Focus achievement search',
        category: 'view',
        action: () => searchInputRef.current?.focus(),
      },
      {
        id: 'achievements-refresh',
        keys: 'r',
        description: 'Refresh achievements',
        category: 'actions',
        action: () => void refresh(),
      },
    ],
    { lensId: 'achievements' },
  );

  return (
    <LensShell lensId="achievements" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-screen-2xl">
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
                <Trophy className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
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
                onClick={() => void refresh()}
                disabled={state === 'loading'}
                aria-label="Refresh achievements"
                className="rounded-md border border-slate-700 bg-slate-800/50 p-1.5 text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
                title="Refresh (r)"
              >
                <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
            </div>

            {state === 'ready' && (
              <div className="mt-3">
                <StatTileGrid columns={4}>
                  <StatTile label="Earned" value={counts.earned} size="sm" caption={`of ${counts.visibleTotal} visible`} />
                  <StatTile label="Completion" value={counts.pct} unit="%" size="sm" />
                  <StatTile label="Sparks earned" value={counts.sparks} size="sm" caption="from achievement rewards" />
                  <StatTile label="In catalog" value={counts.total} size="sm" caption="authored total" />
                </StatTileGrid>
                <CategoryProgress rows={categoryProgressRows} className="mt-2" />
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <nav className="flex flex-wrap gap-1" aria-label="Filter by category">
                {categories.map((c) => (
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
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search achievements… (/)"
                    aria-label="Search achievements"
                    className="w-40 rounded-md border border-slate-700 bg-slate-900/60 py-1 pl-6 pr-2 text-[11px] text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-400 focus:outline-none sm:w-56"
                  />
                </div>
                <label className="sr-only" htmlFor="achievements-sort">Sort achievements</label>
                <select
                  id="achievements-sort"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  className="rounded-md border border-slate-700 bg-slate-900/60 py-1 pl-2 pr-1.5 text-[11px] text-slate-200 focus:border-fuchsia-400 focus:outline-none"
                >
                  <option value="default">Earned first</option>
                  <option value="recent">Recently earned</option>
                  <option value="alpha">Alphabetical</option>
                  <option value="rarity">Rarity</option>
                </select>
              </div>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {deepLinkMissing && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Linked achievement not found — it may be locked, hidden until earned, or no longer exists.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <div className="xl:col-span-3">
              {state === 'loading' && (
                <div
                  role="status"
                  aria-live="polite"
                  aria-busy="true"
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <span className="sr-only">Loading achievements…</span>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-[92px] animate-pulse rounded-lg border border-slate-800 bg-slate-800/30" aria-hidden="true" />
                  ))}
                </div>
              )}

              {state === 'error' && (
                <ErrorState message={error || 'The achievement catalog is unavailable right now.'} onRetry={() => void refresh()} />
              )}

              {state === 'ready' && filtered.length > 0 && (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="list">
                  {filtered.map((a) => (
                    <AchievementCard
                      key={a.id}
                      achievement={a}
                      earned={earnedIds.has(a.id)}
                      earnedAt={earnedAtById.get(a.id)}
                      highlighted={highlightedIds.has(a.id)}
                      anchorId
                    />
                  ))}
                </ul>
              )}

              {state === 'ready' && filtered.length === 0 && (
                <EmptyState
                  icon={<Trophy className="h-6 w-6" aria-hidden="true" />}
                  title={
                    search
                      ? 'No matches'
                      : counts.earned === 0 && category === 'all'
                        ? 'No achievements unlocked yet'
                        : 'Nothing in this view'
                  }
                  description={
                    search
                      ? `No achievement title or description matches "${search}".`
                      : counts.earned === 0 && category === 'all'
                        ? 'Play the world — combat, trade, exploration and social milestones unlock achievements automatically.'
                        : 'Try another category or sort, or keep playing to unlock these.'
                  }
                  action={search || category !== 'all' ? { label: 'Clear filters', onClick: () => { setSearch(''); setCategory('all'); } } : undefined}
                />
              )}
            </div>

            <div className="space-y-3 xl:col-span-1">
              <TitlesPanel refreshSignal={titlesRefreshSignal} />
              <RecentActivityFeed catalogById={catalogById} currentUserId={user?.id ?? null} />
            </div>
          </div>
        </section>
      </main>
    </LensShell>
  );
}

export default function AchievementsLensPage() {
  return (
    <Suspense fallback={null}>
      <AchievementsLensInner />
    </Suspense>
  );
}
