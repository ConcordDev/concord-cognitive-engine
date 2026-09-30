'use client';

import { useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CountryAtlas } from '@/components/global/CountryAtlas';
import { WorldBankPanel } from '@/components/global/WorldBankPanel';
import { DataExplorer } from '@/components/global/DataExplorer';
import { DevelopmentIndex } from '@/components/global/DevelopmentIndex';
import { IndicatorCorrelations } from '@/components/global/IndicatorCorrelations';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ChevronsLeft, ChevronsRight, RefreshCw, Globe, TrendingUp, Map, Award, GitBranch, Compass, Loader2, Bookmark } from 'lucide-react';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { COUNTRIES as WB_COUNTRIES, INDICATORS as WB_INDICATORS } from '@/components/global/indicators';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { getCommandPaletteLenses } from '@/lib/lens-registry';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

const PAGE_SIZE = 50;

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.3, ease: 'easeOut' as const } }),
};

// ---- Cross-domain search result types (real global.crossDomainSearch shape) ----
interface CrossDomainResult {
  query: string; matchCount: number; totalCandidates: number; sourcesSearched: number;
  diversityLabel: string; diversityScore: number;
  results: { id: string; title?: string; text?: string; domain: string; relevanceScore: number; tags?: string[] }[];
  sourceDistribution: Record<string, number>;
  deduplication: { duplicatesFound: number; uniqueResults: number };
}
interface CatalogIndicator { code: string; name: string; sourceNote: string; topics: string[]; }

export default function GlobalLensPage() {
  useLensNav('global');
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState('');
  const [offset, setOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<'explore' | 'index' | 'correlate' | 'search'>('explore');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-explore', keys: 'e', description: 'Data Explorer', category: 'navigation', action: () => setActiveTab('explore') },
      { id: 'tab-index', keys: 'i', description: 'Development Index', category: 'navigation', action: () => setActiveTab('index') },
      { id: 'tab-correlate', keys: 'c', description: 'Correlations', category: 'navigation', action: () => setActiveTab('correlate') },
      { id: 'tab-search', keys: 's', description: 'Search', category: 'navigation', action: () => setActiveTab('search') },
    ],
    { lensId: 'global' }
  );
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('global');

  const paletteLenses = useMemo(
    () => getCommandPaletteLenses().filter((l) => !['global', 'all'].includes(l.id)),
    []
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['global-dtus-browser', PAGE_SIZE, offset, query, tags],
    queryFn: () =>
      apiHelpers.dtus
        .paginated({
          limit: PAGE_SIZE,
          offset,
          query: query || undefined,
          tags: tags || undefined,
          scope: 'global',
        })
        .then((r) => r.data),
  });

  const syncMutation = useMutation({
    mutationFn: ({ id, lens }: { id: string; lens: string }) =>
      apiHelpers.dtus.syncToLens(id, { lens, scope: 'global' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['global-dtus-browser'] });
    },
    onError: (err) => {
      console.error('Failed to sync DTU to lens:', err instanceof Error ? err.message : err);
    },
  });

  const items = useMemo(() => data?.items || [], [data?.items]);
  const total = Number(data?.total || 0);

  // Real per-user saved-view count (global.listViews) — replaces the old
  // fabricated "Regions"/"Trending Up"/"Avg Index" stat cards that summarized
  // a hardcoded REGIONS array.
  const savedViewsQuery = useQuery({
    queryKey: ['global-saved-views-count'],
    queryFn: () => lensRun<{ total: number }>('global', 'listViews', {}).then((r) => (r.data.ok ? r.data.result?.total ?? 0 : null)),
    staleTime: 60000,
    retry: false,
  });

  // --- Unified search: real global.crossDomainSearch merging the DTU corpus
  // (already loaded above) with a live World Bank indicator-catalog search,
  // so a query surfaces both "your notes" and "the actual indicator" in one
  // relevance-ranked, deduplicated, diversity-scored list. Replaces the old
  // "Actions" tab's crossDomainSearch button, which only ever ran against a
  // "global-dataset" artifact no UI path could create (permanently disabled).
  const [crossResult, setCrossResult] = useState<CrossDomainResult | null>(null);
  const [crossLoading, setCrossLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setCrossResult(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCrossLoading(true);
      try {
        const indRes = await lensRun<{ indicators: CatalogIndicator[] }>('global', 'searchIndicators', { query: q, limit: 20 });
        const dtuItems = items.map((d: { id: string; title?: string; content?: string; tags?: string[] }) => ({
          id: d.id, title: d.title, text: d.content, tags: d.tags,
        }));
        const indItems = (indRes.data.ok && indRes.data.result ? indRes.data.result.indicators : []).map((ind) => ({
          id: ind.code, title: ind.name, text: ind.sourceNote, tags: ind.topics,
        }));
        const sources: { domain: string; items: unknown[] }[] = [];
        if (dtuItems.length) sources.push({ domain: 'your DTUs', items: dtuItems });
        if (indItems.length) sources.push({ domain: 'World Bank catalog', items: indItems });
        if (sources.length === 0) { if (!cancelled) setCrossResult(null); return; }
        const r = await lensRun<CrossDomainResult>('global', 'crossDomainSearch', { query: q, sources, maxResults: 20 });
        if (!cancelled) setCrossResult(r.data.ok && r.data.result ? r.data.result : null);
      } finally {
        if (!cancelled) setCrossLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, items]);

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  const tabs = [
    { key: 'explore' as const, label: 'Data Explorer', icon: Compass },
    { key: 'index' as const, label: 'Development Index', icon: Award },
    { key: 'correlate' as const, label: 'Correlations', icon: GitBranch },
    { key: 'search' as const, label: 'Search', icon: Search },
  ];

  return (
    <LensShell lensId="global" asMain={false}>
      <FirstRunTour lensId="global" />      <DepthBadge lensId="global" size="sm" className="ml-2" />
    <div data-lens-theme="global" className="p-6 space-y-5">
      {/* Phase 4 (sixth wave) — REAL World Bank country indicators. */}
      <WorldBankPanel domain="global" />
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="text-xs uppercase text-gray-400 tracking-wider">Truth Lens</p>
          <h1 className="text-3xl font-bold text-gradient-neon flex items-center gap-2">
            <Globe className="w-7 h-7" /> Global — World Bank Data &amp; Knowledge
          </h1>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          <p className="text-neon-cyan mt-1 text-sm">{total.toLocaleString()} DTUs in your global corpus</p>
        </div>
        <button
          className="btn-ghost text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['global-dtus-browser'] })}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </motion.header>

      {/* Stat Cards — every value is either live-fetched or an accurate count
          of the real, code-backed catalogs the pickers below actually offer
          (never an invented "index"). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Globe, color: 'text-neon-cyan', value: total.toLocaleString(), label: 'Total DTUs' },
          { icon: Bookmark, color: 'text-neon-green', value: savedViewsQuery.data ?? '—', label: 'Saved Views' },
          { icon: Map, color: 'text-neon-purple', value: WB_COUNTRIES.length, label: 'Countries Curated' },
          { icon: TrendingUp, color: 'text-yellow-400', value: WB_INDICATORS.length, label: 'Indicators Curated' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      <RealtimeDataPanel domain="global" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="global" data={{}} compact />

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all flex-1 justify-center',
              activeTab === tab.key
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'explore' && (
          <motion.div
            key="explore"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-4"
          >
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Compass className="w-4 h-4 text-neon-cyan" /> World Bank Data Explorer
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Live World Bank Open Data — choropleth map, time series, country comparison, scatter explorer,
              indicator catalog, and country profiles. Save any view for a shareable link.
            </p>
            <DataExplorer />
          </motion.div>
        )}

        {activeTab === 'index' && (
          <motion.div
            key="index"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-4"
          >
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Award className="w-4 h-4 text-neon-cyan" /> Global Development Index
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              A real composite country ranking, computed live from World Bank indicators via{' '}
              <code className="text-neon-cyan">global.aggregateDashboard</code>
              {' '}&mdash; every score is derived from fetched data, never an invented benchmark.
            </p>
            <DevelopmentIndex />
          </motion.div>
        )}

        {activeTab === 'correlate' && (
          <motion.div
            key="correlate"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-4"
          >
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-neon-purple" /> Indicator Correlations
            </h2>
            <p className="text-xs text-gray-400 mb-4">
              Real cross-country Pearson &amp; Spearman correlation between World Bank indicators via{' '}
              <code className="text-neon-purple">global.correlationMatrix</code>
              {' '}&mdash; e.g. does internet access correlate with life expectancy across countries?
            </p>
            <IndicatorCorrelations />
          </motion.div>
        )}

        {activeTab === 'search' && (
          <motion.div
            key="search"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
          >
            <section className="panel p-4 grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-wider text-gray-400">Search your DTUs + the World Bank catalog</span>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={(e) => { setOffset(0); setQuery(e.target.value); }}
                    placeholder="Search title, content, tags, indicator names"
                    className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm"
                  />
                </div>
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-wider text-gray-400">Filter tags (DTU list only)</span>
                <input
                  value={tags}
                  onChange={(e) => { setOffset(0); setTags(e.target.value); }}
                  placeholder="comma,separated,tags"
                  className="w-full bg-lattice-void border border-lattice-border rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </section>

            {/* Unified cross-domain result (global.crossDomainSearch) -- appears
                once the query is >=2 chars and real DTU/indicator matches exist.
                Real relevance scoring, dedup, and diversity -- computed by the
                macro, not the client. */}
            {query.trim().length >= 2 && (
              <section className="panel p-4 mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-neon-cyan flex items-center gap-2 text-sm">
                    <Search className="w-4 h-4" /> Unified results for &quot;{query}&quot;
                  </h3>
                  {crossLoading && <Loader2 className="w-4 h-4 text-neon-cyan animate-spin" />}
                </div>
                {!crossLoading && crossResult && crossResult.results.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                      <span>{crossResult.matchCount} matches across {crossResult.sourcesSearched} sources</span>
                      <span className={cn('px-2 py-0.5 rounded font-medium',
                        crossResult.diversityScore > 0.7 ? 'bg-neon-green/10 text-neon-green' :
                        crossResult.diversityScore > 0.4 ? 'bg-yellow-400/10 text-yellow-400' : 'bg-red-400/10 text-red-400'
                      )}>{crossResult.diversityLabel}</span>
                      {crossResult.deduplication.duplicatesFound > 0 && (
                        <span>{crossResult.deduplication.duplicatesFound} duplicates merged</span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {crossResult.results.slice(0, 8).map((item, i) => (
                        <div key={i} className="lens-card flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">{item.title || item.id}</p>
                            {item.text && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.text}</p>}
                            <span className="text-xs text-neon-cyan mt-1 inline-block">{item.domain}</span>
                          </div>
                          <span className="text-xs font-mono text-neon-cyan shrink-0">score: {item.relevanceScore}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {!crossLoading && (!crossResult || crossResult.results.length === 0) && (
                  <p className="text-xs text-gray-400 italic">No matches in your DTUs or the World Bank indicator catalog.</p>
                )}
              </section>
            )}

            <section className="panel divide-y divide-lattice-border">
              {isLoading ? (
                <div className="p-6 text-gray-400">Loading DTUs...</div>
              ) : items.length === 0 ? (
                <div className="p-6 text-gray-400">No DTUs match this query.</div>
              ) : (
                items.map((dtu: { id: string; title?: string; content?: string; tags?: string[]; createdAt?: string }, i: number) => (
                  <motion.article
                    key={dtu.id}
                    custom={i}
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white truncate">{dtu.title || 'Untitled DTU'}</h3>
                      <p className="text-sm text-gray-400 mt-1 line-clamp-2">{dtu.content || 'No content'}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        {dtu.id} {dtu.createdAt ? `\u2022 ${new Date(dtu.createdAt).toLocaleString()}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(dtu.tags || []).slice(0, 8).map((tag) => (
                          <span key={tag} className="text-xs px-2 py-1 rounded bg-lattice-elevated text-neon-cyan">#{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <select
                        className="bg-lattice-void border border-lattice-border rounded px-2 py-2 text-sm"
                        defaultValue=""
                        onChange={(e) => {
                          const lens = e.target.value;
                          if (!lens) return;
                          syncMutation.mutate({ id: dtu.id, lens });
                          e.target.value = '';
                        }}
                        disabled={syncMutation.isPending}
                      >
                        <option value="">Sync to...</option>
                        {paletteLenses.map((lens) => (
                          <option key={lens.id} value={lens.id}>{lens.name}</option>
                        ))}
                      </select>
                    </div>
                  </motion.article>
                ))
              )}
            </section>

            <footer className="flex items-center justify-between panel p-3 mt-4">
              <p className="text-xs text-gray-400">
                Showing {total === 0 ? 0 : offset + 1}-{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex gap-2">
                <button className="btn-ghost text-sm" onClick={() => setOffset((v) => Math.max(0, v - PAGE_SIZE))} disabled={offset === 0}>
                  <ChevronsLeft className="w-4 h-4 mr-1" /> Prev
                </button>
                <button className="btn-ghost text-sm" onClick={() => setOffset((v) => v + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total}>
                  Next <ChevronsRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <CountryAtlas />
      </section>
    </div>          <CrossLensRecentsPanel lensId="global" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
