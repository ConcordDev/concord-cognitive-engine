'use client';

/**
 * DTU Browser — Paginated, searchable, filterable list of all DTUs.
 *
 * Wired to:
 *   - GET /api/dtus/paginated  (via apiHelpers.dtus.paginated)
 *   - GET /api/dtus/:id        (via apiHelpers.dtus.get for detail)
 *   - GET /api/dtus/:id/lineage (via apiHelpers.dtus.lineage)
 *   - POST /api/dtus           (via apiHelpers.dtus.create for quick-create)
 *   - Real-time dtu:created events via socket
 */

import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import type { DTU, DTUTier } from '@/lib/api/generated-types';
import { VirtualDTUList } from '@/components/lists/VirtualDTUList';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { DTUQuickCreate } from '@/components/dtu/DTUQuickCreate';
import { LiveDTUFeed } from '@/components/live/LiveDTUFeed';
import { cn } from '@/lib/utils';
import {
  Database, Plus, RefreshCw, ChevronLeft, ChevronRight,
  Search, Filter, Zap, LayoutGrid, List, Tag, Clock,
} from 'lucide-react';

const PAGE_SIZE = 20;

type ViewMode = 'list' | 'grid';

export default function DTUBrowserPage() {
  useLensNav('dtus');

  const queryClient = useQueryClient();

  // State
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<DTUTier | 'all'>('all');
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showFeed, setShowFeed] = useState(true);

  // Build query params
  const queryParams = useMemo(() => ({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(searchQuery ? { query: searchQuery } : {}),
    ...(tierFilter !== 'all' ? { tier: tierFilter } : {}),
  }), [page, searchQuery, tierFilter]);

  // Fetch paginated DTUs
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dtus-browser', queryParams],
    queryFn: async () => {
      const res = await apiHelpers.dtus.paginated(queryParams);
      return res.data as {
        ok: boolean;
        dtus?: DTU[];
        items?: DTU[];
        total?: number;
        hasMore?: boolean;
      };
    },
    staleTime: 15_000,
  });

  const dtus: DTU[] = data?.dtus || data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasMore = data?.hasMore ?? (page + 1) < totalPages;

  // Map DTUs into the format VirtualDTUList expects
  const listDtus = useMemo(() => dtus.map(d => ({
    id: d.id,
    title: d.title || d.summary || d.id.slice(0, 16),
    excerpt: d.summary || d.content?.slice(0, 120),
    tier: (d.tier || 'regular') as 'regular' | 'mega' | 'hyper' | 'shadow',
    tags: d.tags || [],
    createdAt: new Date(d.timestamp || Date.now()),
    updatedAt: new Date(d.updatedAt || d.timestamp || Date.now()),
    resonance: d.resonance,
    connectionCount: (d.children?.length || 0) + (d.parents?.length || 0),
    isFavorite: false,
  })), [dtus]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    refetch();
  }, [refetch]);

  const handleSelectDtu = useCallback((dtu: { id: string }) => {
    setSelectedDtuId(dtu.id);
  }, []);

  const handleCreateSuccess = useCallback(() => {
    setShowCreateForm(false);
    queryClient.invalidateQueries({ queryKey: ['dtus-browser'] });
    refetch();
  }, [queryClient, refetch]);

  return (
    <div data-lens-theme="dtus" className="min-h-screen bg-lattice-void text-white">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-lattice-surface/80 backdrop-blur border-b border-lattice-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-neon-blue to-neon-cyan flex items-center justify-center">
                <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold">DTU Browser</h1>
                <p className="text-xs text-gray-500">
                  {total} discrete thought units
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFeed(!showFeed)}
                className={cn(
                  'px-3 py-1.5 text-xs rounded-lg border transition-colors',
                  showFeed
                    ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
                    : 'border-lattice-border text-gray-400 hover:text-white'
                )}
              >
                <Zap className="w-3.5 h-3.5 inline mr-1" />
                Live Feed
              </button>
              <button
                onClick={() => refetch()}
                disabled={isLoading}
                className="p-2 rounded-lg hover:bg-lattice-surface/50 text-gray-400 hover:text-white disabled:opacity-50 transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
              </button>
              <button
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neon-blue/20 text-neon-blue border border-neon-blue/30 rounded-lg hover:bg-neon-blue/30 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New DTU
              </button>
            </div>
          </div>

          {/* Search + Filters */}
          <div className="flex items-center gap-3 mt-4">
            <form onSubmit={handleSearch} className="flex-1 flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg">
                <Search className="w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search DTUs by title, content, or tags..."
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setPage(0); }}
                    className="text-gray-500 hover:text-white text-sm"
                  >
                    Clear
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className={cn('px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg text-gray-300 hover:text-white transition-colors', isLoading && 'opacity-40 cursor-not-allowed')}
              >
                {isLoading ? 'Searching...' : 'Search'}
              </button>
            </form>

            {/* Tier filter */}
            <div className="flex items-center gap-1">
              <Filter className="w-4 h-4 text-gray-500 mr-1" />
              {(['all', 'regular', 'mega', 'hyper', 'shadow'] as const).map(tier => (
                <button
                  key={tier}
                  onClick={() => { setTierFilter(tier); setPage(0); }}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors capitalize',
                    tierFilter === tier
                      ? 'bg-neon-cyan/20 text-neon-cyan'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  {tier}
                </button>
              ))}
            </div>

            {/* View mode */}
            <div className="flex items-center border border-lattice-border rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'p-1.5 transition-colors',
                  viewMode === 'list' ? 'bg-lattice-surface text-white' : 'text-gray-500 hover:text-white'
                )}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'p-1.5 transition-colors',
                  viewMode === 'grid' ? 'bg-lattice-surface text-white' : 'text-gray-500 hover:text-white'
                )}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
        <div className="grid grid-cols-4 gap-4">
          <div className="p-3 bg-lattice-surface rounded-lg border border-lattice-border flex items-center gap-3">
            <Database className="w-5 h-5 text-neon-blue" />
            <div><p className="text-lg font-bold">{total}</p><p className="text-xs text-gray-400">Total DTUs</p></div>
          </div>
          <div className="p-3 bg-lattice-surface rounded-lg border border-lattice-border flex items-center gap-3">
            <Tag className="w-5 h-5 text-neon-purple" />
            <div>
              <p className="text-lg font-bold">{dtus.filter(d => d.tier === 'mega' || d.tier === 'hyper').length}</p>
              <p className="text-xs text-gray-400">Mega/Hyper</p>
            </div>
          </div>
          <div className="p-3 bg-lattice-surface rounded-lg border border-lattice-border flex items-center gap-3">
            <Zap className="w-5 h-5 text-neon-cyan" />
            <div><p className="text-lg font-bold">{dtus.filter(d => d.tier === 'regular').length}</p><p className="text-xs text-gray-400">Regular</p></div>
          </div>
          <div className="p-3 bg-lattice-surface rounded-lg border border-lattice-border flex items-center gap-3">
            <Clock className="w-5 h-5 text-gray-400" />
            <div><p className="text-lg font-bold">{dtus.filter(d => d.tier === 'shadow').length}</p><p className="text-xs text-gray-400">Shadow</p></div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className={cn('flex gap-6', showFeed ? '' : '')}>
          {/* Main list area */}
          <div className="flex-1 min-w-0">
            {isError ? (
              <div className="text-center py-12">
                <p className="text-red-400 mb-2">Failed to load DTUs</p>
                <button
                  onClick={() => refetch()}
                  className="text-sm text-neon-cyan hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : viewMode === 'list' ? (
              <div className="border border-lattice-border rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 280px)' }}>
                <VirtualDTUList
                  dtus={listDtus}
                  selectedId={selectedDtuId || undefined}
                  onSelect={handleSelectDtu}
                  showFilters={false}
                  emptyMessage={isLoading ? 'Loading DTUs...' : 'No DTUs found'}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dtus.map((dtu, index) => (
                  <motion.button
                    key={dtu.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => setSelectedDtuId(dtu.id)}
                    className={cn(
                      'text-left p-4 rounded-xl border transition-all hover:border-neon-cyan/50',
                      selectedDtuId === dtu.id
                        ? 'border-neon-cyan bg-neon-cyan/5'
                        : 'border-lattice-border bg-lattice-surface/50'
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded uppercase font-medium',
                        dtu.tier === 'mega' ? 'bg-neon-purple/20 text-neon-purple' :
                        dtu.tier === 'hyper' ? 'bg-neon-pink/20 text-neon-pink' :
                        dtu.tier === 'shadow' ? 'bg-gray-500/20 text-gray-400' :
                        'bg-neon-blue/20 text-neon-blue'
                      )}>
                        {dtu.tier}
                      </span>
                      {dtu.domain && (
                        <span className="text-[10px] text-gray-500">{dtu.domain}</span>
                      )}
                    </div>
                    <h3 className="text-sm font-medium text-gray-200 line-clamp-1">
                      {dtu.title || dtu.summary || dtu.id.slice(0, 16)}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-2 mt-1">
                      {dtu.summary || dtu.content?.slice(0, 100)}
                    </p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-600">
                      <span>{new Date(dtu.timestamp).toLocaleDateString()}</span>
                      {dtu.tags?.length > 0 && (
                        <span>#{dtu.tags[0]}</span>
                      )}
                    </div>
                  </motion.button>
                ))}
                {isLoading && (
                  <div className="col-span-full text-center py-8">
                    <div className="w-6 h-6 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
                  </div>
                )}
                {!isLoading && dtus.length === 0 && (
                  <div className="col-span-full text-center py-12">
                    <Database className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                    <p className="text-gray-400">No DTUs found</p>
                  </div>
                )}
              </div>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 px-2">
              <span className="text-xs text-gray-500">
                Showing {page * PAGE_SIZE + 1}--{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-lattice-border rounded-lg disabled:opacity-30 hover:bg-lattice-surface transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Previous
                </button>
                <span className="text-xs text-gray-400">
                  Page {page + 1} of {Math.max(1, totalPages)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={!hasMore}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs border border-lattice-border rounded-lg disabled:opacity-30 hover:bg-lattice-surface transition-colors"
                >
                  Next
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Right sidebar: live feed */}
          {showFeed && (
            <aside className="w-80 flex-shrink-0 hidden xl:block">
              <LiveDTUFeed limit={15} onDtuClick={(id) => setSelectedDtuId(id)} />
            </aside>
          )}
        </div>
      </div>

      {/* DTU Detail View (modal) */}
      {selectedDtuId && (
        <DTUDetailView
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />
      )}

      {/* Quick create modal */}
      {showCreateForm && (
        <DTUQuickCreate
          onClose={() => setShowCreateForm(false)}
          onSuccess={handleCreateSuccess}
        />
      )}
    </div>
  );
}
