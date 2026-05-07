'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ChevronsLeft, ChevronsRight, RefreshCw, Globe, TrendingUp, Map } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';
import { getCommandPaletteLenses } from '@/lib/lens-registry';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

const PAGE_SIZE = 50;

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.3, ease: 'easeOut' } }),
};

const REGIONS = [
  { name: 'North America', flag: '\u{1F1FA}\u{1F1F8}', index: 87, trend: 'up' as const, color: 'text-neon-green' },
  { name: 'Europe', flag: '\u{1F1EA}\u{1F1FA}', index: 82, trend: 'up' as const, color: 'text-neon-cyan' },
  { name: 'Asia Pacific', flag: '\u{1F1EF}\u{1F1F5}', index: 78, trend: 'up' as const, color: 'text-neon-blue' },
  { name: 'Latin America', flag: '\u{1F1E7}\u{1F1F7}', index: 64, trend: 'stable' as const, color: 'text-yellow-400' },
  { name: 'Middle East', flag: '\u{1F1E6}\u{1F1EA}', index: 59, trend: 'up' as const, color: 'text-neon-purple' },
  { name: 'Africa', flag: '\u{1F1F3}\u{1F1EC}', index: 48, trend: 'up' as const, color: 'text-amber-400' },
];

export default function GlobalLensPage() {
  useLensNav('global');
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState('');
  const [offset, setOffset] = useState(0);
  const [activeTab, setActiveTab] = useState<'regions' | 'trends' | 'indicators'>('regions');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('global');

  // --- Action wiring ---
  const { items: globalArtifacts } = useLensData('global', 'global-dataset', { seed: [] });
  const runAction = useRunArtifact('global');
  const [actionResult, setActionResult] = useState<{ action: string; data: unknown } | null>(null);

  const handleRunAction = useCallback((action: string) => {
    const artifactId = globalArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action, params: {} },
      {
        onSuccess: (res) => setActionResult({ action, data: res.result }),
        onError: (e) => {
          console.error(`Action failed:`, e);
          setActionResult({ action, data: { error: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` } });
        },
      }
    );
  }, [globalArtifacts, runAction]);

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

  const items = data?.items || [];
  const total = Number(data?.total || 0);

  const getIndexColor = (index: number) => {
    if (index >= 80) return 'text-neon-green';
    if (index >= 60) return 'text-neon-cyan';
    if (index >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getIndexBg = (index: number) => {
    if (index >= 80) return 'bg-neon-green';
    if (index >= 60) return 'bg-neon-cyan';
    if (index >= 40) return 'bg-yellow-400';
    return 'bg-red-400';
  };

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  const tabs = [
    { key: 'regions' as const, label: 'Regions', icon: Globe },
    { key: 'trends' as const, label: 'Trends', icon: TrendingUp },
    { key: 'indicators' as const, label: 'Indicators', icon: Map },
  ];

  return (
    <div data-lens-theme="global" className="p-6 space-y-5">
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="text-xs uppercase text-gray-400 tracking-wider">Truth Lens</p>
          <h1 className="text-3xl font-bold text-gradient-neon flex items-center gap-2">
            <Globe className="w-7 h-7" /> Global DTU Browser
          </h1>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          <p className="text-neon-cyan mt-1 text-sm">{total.toLocaleString()} DTUs</p>
        </div>
        <button
          className="btn-ghost text-sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['global-dtus-browser'] })}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </motion.header>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Globe, color: 'text-neon-cyan', value: total.toLocaleString(), label: 'Total DTUs' },
          { icon: Map, color: 'text-neon-green', value: REGIONS.length, label: 'Regions' },
          { icon: TrendingUp, color: 'text-neon-purple', value: REGIONS.filter(r => r.trend === 'up').length, label: 'Trending Up' },
          { icon: Globe, color: 'text-yellow-400', value: Math.round(REGIONS.reduce((s, r) => s + r.index, 0) / REGIONS.length), label: 'Avg Index' },
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
        {activeTab === 'regions' && (
          <motion.div
            key="regions"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {REGIONS.map((region, i) => (
              <motion.div
                key={region.name}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="lens-card hover:border-neon-cyan/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{region.flag}</span>
                    <h3 className="font-semibold text-white">{region.name}</h3>
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded', region.trend === 'up' ? 'bg-neon-green/10 text-neon-green' : 'bg-yellow-400/10 text-yellow-400')}>
                    {region.trend === 'up' ? 'Trending Up' : 'Stable'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-500">Development Index</span>
                      <span className={getIndexColor(region.index)}>{region.index}/100</span>
                    </div>
                    <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${region.index}%` }}
                        transition={{ duration: 0.8, delay: i * 0.1 }}
                        className={cn('h-full rounded-full', getIndexBg(region.index))}
                      />
                    </div>
                  </div>
                </div>
                {/* Mini sparkline placeholder */}
                <div className="mt-3 flex items-end gap-px h-8">
                  {Array.from({ length: 12 }, (_, j) => {
                    const h = 20 + Math.random() * 80;
                    return (
                      <motion.div
                        key={j}
                        initial={{ height: 0 }}
                        animate={{ height: `${h}%` }}
                        transition={{ duration: 0.4, delay: i * 0.05 + j * 0.03 }}
                        className={cn('flex-1 rounded-sm', region.color.replace('text-', 'bg-'), 'opacity-60')}
                      />
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {activeTab === 'trends' && (
          <motion.div
            key="trends"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
          >
            <section className="panel p-4 grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-wider text-gray-400">Search</span>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={query}
                    onChange={(e) => { setOffset(0); setQuery(e.target.value); }}
                    placeholder="Search title, content, tags"
                    className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm"
                  />
                </div>
              </label>
              <label className="space-y-2">
                <span className="text-xs uppercase tracking-wider text-gray-400">Filter tags</span>
                <input
                  value={tags}
                  onChange={(e) => { setOffset(0); setTags(e.target.value); }}
                  placeholder="comma,separated,tags"
                  className="w-full bg-lattice-void border border-lattice-border rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </section>

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
                      <p className="text-xs text-gray-500 mt-2">
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

        {activeTab === 'indicators' && (
          <motion.div
            key="indicators"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
            className="panel p-6"
          >
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Map className="w-4 h-4 text-neon-green" /> Development Indicators
            </h2>
            <div className="space-y-4">
              {REGIONS.sort((a, b) => b.index - a.index).map((region, i) => (
                <motion.div
                  key={region.name}
                  custom={i}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm flex items-center gap-2">
                      <span>{region.flag}</span>
                      <span className="text-white">{region.name}</span>
                    </span>
                    <span className={cn('text-sm font-bold', getIndexColor(region.index))}>{region.index}</span>
                  </div>
                  <div className="h-3 bg-lattice-deep rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${region.index}%` }}
                      transition={{ duration: 0.8, delay: i * 0.1 }}
                      className={cn('h-full rounded-full', getIndexBg(region.index))}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
