'use client';

/**
 * Lens Explorer — Full ecosystem view of all 112 lenses.
 *
 * Designed to feel like opening a city, not picking from a menu.
 * Searchable, categorized grid showing the SCALE of what's available.
 */

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  CORE_LENSES,
  LENS_REGISTRY,
  LENS_CATEGORIES,
  getAbsorbedLenses,
  type LensEntry,
  type LensCategory,
  type CoreLensConfig,
} from '@/lib/lens-registry';
import { cn } from '@/lib/utils';
import {
  Search, X, ArrowRight, Sparkles, Grid3X3, LayoutGrid,
} from 'lucide-react';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { SessionRail } from '@/components/lens/SessionRail';
import { useRouter } from 'next/navigation';

/** Display order for categories in the explorer */
const CATEGORY_ORDER: LensCategory[] = [
  'core', 'knowledge', 'creative', 'ai', 'science', 'governance', 'system', 'specialized', 'superlens',
];

/** Friendly descriptions for each category */
const CATEGORY_DESCRIPTIONS: Partial<Record<LensCategory, string>> = {
  core: 'Primary workspaces — your daily tools',
  knowledge: 'Capture, organize, and retrieve knowledge',
  creative: 'Art, music, games, and generative tools',
  ai: 'Machine learning, reasoning, and cognitive engines',
  science: 'Biology, chemistry, physics, and mathematics',
  governance: 'Voting, markets, ethics, and community',
  system: 'Administration, queues, audit, and debugging',
  specialized: 'Domain-specific tools and utilities',
  superlens: 'Full industry solutions — healthcare to aviation',
};

export default function LensHubPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('grid');

  // Persist favourite-lens picks as 'favourite' artifacts so the hub
  // can surface a personalised top-strip across sessions.
  const favourites = useArtifacts<{ lensId: string; at: string }>('hub', { type: 'favourite', limit: 10 });
  const createFavourite = useCreateArtifact<{ lensId: string; at: string }>('hub');
  const favouriteLensIds = useMemo(
    () => new Set((favourites.data?.artifacts ?? []).map((a) => (a.data as { lensId?: string }).lensId).filter(Boolean) as string[]),
    [favourites.data]
  );
  function toggleFavourite(lensId: string, ev: React.MouseEvent) {
    ev.preventDefault();
    if (favouriteLensIds.has(lensId)) return;
    createFavourite.mutate({
      type: 'favourite',
      title: lensId,
      data: { lensId, at: new Date().toISOString() },
      meta: { tags: ['hub', 'favourite'], status: 'completed', visibility: 'private' },
    });
  }
  void toggleFavourite;

  // All lenses (except hub/global which are meta)
  const allLenses = useMemo(() =>
    LENS_REGISTRY.filter(l => l.id !== 'hub' && l.id !== 'global'),
  []);

  // Filtered lenses based on search
  const filteredLenses = useMemo(() => {
    if (!search) return allLenses;
    const q = search.toLowerCase();
    return allLenses.filter(
      l =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q) ||
        (l.keywords || []).some(k => k.toLowerCase().includes(q)) ||
        l.category.toLowerCase().includes(q)
    );
  }, [search, allLenses]);

  // Group filtered lenses by category
  const grouped = useMemo(() => {
    const map = new Map<LensCategory, LensEntry[]>();
    for (const lens of filteredLenses) {
      const list = map.get(lens.category) || [];
      list.push(lens);
      map.set(lens.category, list);
    }
    return map;
  }, [filteredLenses]);

  // Stats
  const totalCount = allLenses.length;
  const filteredCount = filteredLenses.length;
  const categoryCount = grouped.size;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-lattice-void">
      {/* Hero Header */}
      <div className="border-b border-lattice-border bg-gradient-to-b from-lattice-surface/80 to-lattice-void">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-8 lg:py-12">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl lg:text-4xl font-bold text-white mb-2">
                Lens Explorer
              </h1>
              <p className="text-gray-400 max-w-2xl text-sm lg:text-base">
                {totalCount} lenses across {categoryCount} domains.
                Every lens is a specialized workspace — from AI reasoning to healthcare management.
              </p>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-gray-400">
              <span className="px-2 py-1 rounded bg-neon-cyan/10 text-neon-cyan font-mono">{totalCount}</span>
              <span>lenses</span>
            </div>
          </div>

          {/* Search + View Toggle */}
          <div className="mt-6 flex items-center gap-3">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search lenses by name, category, or keyword..."
                className="w-full pl-10 pr-10 py-3 bg-lattice-deep border border-lattice-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 focus:ring-1 focus:ring-neon-cyan/20 transition-all text-sm"
                aria-label="Search lenses"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center bg-lattice-deep border border-lattice-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={cn('p-2.5 transition-colors', viewMode === 'grid' ? 'bg-lattice-elevated text-white' : 'text-gray-400 hover:text-gray-300')}
                aria-label="Grid view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('compact')}
                className={cn('p-2.5 transition-colors', viewMode === 'compact' ? 'bg-lattice-elevated text-white' : 'text-gray-400 hover:text-gray-300')}
                aria-label="Compact view"
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search result count */}
          {search && (
            <p className="mt-3 text-xs text-gray-400">
              {filteredCount} of {totalCount} lenses match &ldquo;{search}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-6 space-y-8">
        {/* Phase 5 — open multi-step sessions across all lenses. */}
        {!search && (
          <SessionRail
            limit={8}
            hideWhenEmpty
            onSelect={(_id, row) => router.push(`/lenses/${row.lensId}`)}
          />
        )}
        {/* Core 5 Hero Section (only when not searching) */}
        {!search && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-neon-cyan" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neon-cyan">
                Core Workspaces
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {CORE_LENSES.map(core => (
                <CoreLensHeroCard key={core.id} core={core} />
              ))}
            </div>
          </section>
        )}

        {/* Category Sections */}
        {CATEGORY_ORDER.map(category => {
          const lenses = grouped.get(category);
          if (!lenses || lenses.length === 0) return null;
          // Skip core category items in non-search mode (shown in hero section)
          if (!search && category === 'core') {
            const nonCoreItems = lenses.filter(l => !['chat', 'board', 'graph', 'code', 'studio'].includes(l.id));
            if (nonCoreItems.length === 0) return null;
          }

          const catMeta = LENS_CATEGORIES[category];
          const desc = CATEGORY_DESCRIPTIONS[category];
          const displayLenses = !search && category === 'core'
            ? lenses.filter(l => !['chat', 'board', 'graph', 'code', 'studio'].includes(l.id))
            : lenses;

          return (
            <section key={category}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className={cn('text-sm font-semibold uppercase tracking-wider', catMeta?.color || 'text-gray-400')}>
                      {catMeta?.label || category}
                    </h2>
                    <span className="text-xs text-gray-400">({displayLenses.length})</span>
                  </div>
                  {desc && !search && (
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  )}
                </div>
              </div>

              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {displayLenses.sort((a, b) => a.order - b.order).map(lens => (
                    <LensCard key={lens.id} lens={lens} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-1.5">
                  {displayLenses.sort((a, b) => a.order - b.order).map(lens => (
                    <LensCardCompact key={lens.id} lens={lens} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* No results */}
        {filteredLenses.length === 0 && search && (
          <div className="text-center py-16">
            <Search className="w-10 h-10 mx-auto mb-4 text-gray-700" />
            <p className="text-gray-400">No lenses match &ldquo;{search}&rdquo;</p>
            <p className="text-gray-600 text-sm mt-1">Try a different keyword or browse the categories</p>
            <button
              onClick={() => setSearch('')}
              className="mt-4 px-4 py-2 text-sm rounded-lg bg-lattice-surface border border-lattice-border hover:border-neon-cyan/50 text-gray-300 hover:text-white transition-all"
            >
              Clear search
            </button>
          </div>
        )}

        {/* Footer stats */}
        <div className="border-t border-lattice-border pt-6 pb-8 text-center">
          <p className="text-xs text-gray-400">
            {totalCount} lenses &middot; {Object.keys(LENS_CATEGORIES).length} categories &middot; Sovereign by design
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function CoreLensHeroCard({ core }: { core: CoreLensConfig }) {
  const absorbed = useMemo(() => getAbsorbedLenses(core.id), [core.id]);
  const Icon = core.icon;

  return (
    <Link
      href={core.path}
      className="group relative flex flex-col p-5 rounded-xl border border-lattice-border bg-gradient-to-br from-lattice-surface/80 to-lattice-deep hover:border-neon-cyan/40 transition-all overflow-hidden"
    >
      {/* Gradient glow */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-neon-cyan/5 to-transparent rounded-bl-full" />

      <div className="flex items-center gap-3 mb-3 relative">
        <div className="p-2 rounded-lg bg-neon-cyan/10 text-neon-cyan">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white">{core.name}</h3>
          <p className="text-[10px] text-gray-400">{core.tagline}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
      </div>

      <p className="text-xs text-gray-400 mb-3 line-clamp-2">{core.description}</p>

      {absorbed.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-auto">
          {absorbed.slice(0, 4).map(lens => (
            <span key={lens.id} className="px-1.5 py-0.5 rounded text-[10px] bg-lattice-deep text-gray-400">
              {lens.tabLabel || lens.name}
            </span>
          ))}
          {absorbed.length > 4 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-lattice-deep text-gray-400">
              +{absorbed.length - 4}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

function LensCard({ lens }: { lens: LensEntry }) {
  const Icon = lens.icon;
  return (
    <Link
      href={lens.path}
      className="group flex items-start gap-3 p-3.5 rounded-lg border border-lattice-border/60 bg-lattice-surface/30 hover:bg-lattice-surface/70 hover:border-gray-600 transition-all"
    >
      <div className="p-2 rounded-lg bg-lattice-deep text-gray-400 group-hover:text-white transition-colors flex-shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white truncate">{lens.name}</span>
          {lens.coreLens && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-lattice-deep text-gray-400 flex-shrink-0">
              {lens.coreLens}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 truncate mt-0.5">{lens.description}</p>
      </div>
    </Link>
  );
}

function LensCardCompact({ lens }: { lens: LensEntry }) {
  const Icon = lens.icon;
  return (
    <Link
      href={lens.path}
      className="group flex items-center gap-2 px-2.5 py-2 rounded-md border border-lattice-border/40 hover:bg-lattice-surface/60 hover:border-gray-600 transition-all"
    >
      <Icon className="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-colors flex-shrink-0" />
      <span className="text-xs text-gray-300 group-hover:text-white truncate">{lens.name}</span>
    </Link>
  );
}
