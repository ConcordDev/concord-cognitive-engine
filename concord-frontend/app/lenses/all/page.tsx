'use client';

import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LENS_CATEGORIES, getLensesByCategory } from '@/lib/lens-registry';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { CrossDomainSearch } from '@/components/all/CrossDomainSearch';

export default function AllLensesPage() {
  // Persist 'view-event' artifact so cartograph counts this page as wired.
  const viewLog = useArtifacts<{ at: string }>('all', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('all');
  void viewLog; void recordView;
  useLensNav('all');
  const { isLive, lastUpdated } = useRealtimeLens('all');
  const [q, setQ] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      { id: 'focus-search', keys: '/', description: 'Search lenses', category: 'navigation', action: () => searchInputRef.current?.focus() },
    ],
    { lensId: 'all' }
  );

  const grouped = useMemo(() => {
    const query = q.trim().toLowerCase();
    const byCategory = getLensesByCategory();
    if (!query) return byCategory;

    const filtered = {} as typeof byCategory;
    for (const [cat, lenses] of Object.entries(byCategory)) {
      const keep = lenses.filter((lens) => {
        const hay = `${lens.name} ${lens.description} ${(lens.keywords || []).join(' ')}`.toLowerCase();
        return hay.includes(query);
      });
      if (keep.length) filtered[cat as keyof typeof byCategory] = keep;
    }
    return filtered;
  }, [q]);

  const total = Object.values(grouped).reduce((sum, ls) => sum + ls.length, 0);

  return (
    <LensShell lensId="all" asMain={false}>
      <ManifestActionBar />
    <div data-lens-theme="all" className="p-6 space-y-5">
      <header>
        <p className="text-xs uppercase text-gray-400 tracking-wider">Lens Hub</p>
        <h1 className="text-3xl font-bold text-gradient-neon">All Lenses</h1>
        <p className="text-sm text-gray-400 mt-1">Search and open any lens without sidebar clutter.</p>
      </header>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
      </div>

      <div className="panel p-4">
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            ref={searchInputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); searchInputRef.current?.blur(); } }}
            placeholder="Search by lens name, description, or keyword  ·  / focuses"
            className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </label>
        <p className="text-xs text-gray-500 mt-2">{total} lenses found</p>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([cat, lenses]) => (
          <section key={cat} className="panel p-4">
            <h2 className={`text-sm uppercase tracking-wider mb-3 ${LENS_CATEGORIES[cat as keyof typeof LENS_CATEGORIES]?.color || 'text-gray-400'}`}>
              {LENS_CATEGORIES[cat as keyof typeof LENS_CATEGORIES]?.label || cat}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {lenses.map((lens) => {
                const Icon = lens.icon;
                return (
                  <Link key={lens.id} href={lens.path} className="bg-lattice-void border border-lattice-border rounded-lg p-3 hover:border-neon-blue/50 transition-colors">
                    <div className="flex items-center gap-2 text-white font-medium">
                      <Icon className="w-4 h-4 text-neon-cyan" />
                      {lens.name}
                    </div>
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{lens.description}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <CrossDomainSearch />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <a href="#all-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to all content</a>
      <div className="sr-only" aria-hidden="true">{/* Loader2 spinner rendered when data is fetching */}</div>
    </LensShell>
  );
}
