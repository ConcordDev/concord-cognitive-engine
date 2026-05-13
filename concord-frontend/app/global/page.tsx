'use client';

/**
 * Global "Truth View" — canonical surface for all DTUs, Artifacts, Jobs, and Marketplace.
 *
 * Features:
 * - Tabs: DTUs | Artifacts | Jobs | Marketplace
 * - Shows "Showing X of Y" counts
 * - Search + filters
 * - Pagination
 * - "Sync to lens" action
 * - "Publish" action (creates marketplace listing)
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { LensShell } from '@/components/common/LensShell';
import { EmptyState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Globe, FileText, Package, Briefcase, Store,
  ChevronLeft, ChevronRight, ArrowUpRight, Send, Download,
  Filter, Eye
} from 'lucide-react';
import type { LensTab } from '@/components/common/LensShell';

type TabId = 'dtus' | 'artifacts' | 'jobs' | 'marketplace';

const TABS: LensTab[] = [
  { id: 'dtus', icon: FileText, label: 'DTUs' },
  { id: 'artifacts', icon: Package, label: 'Artifacts' },
  { id: 'jobs', icon: Briefcase, label: 'Jobs' },
  { id: 'marketplace', icon: Store, label: 'Marketplace' },
];

const PAGE_SIZE = 50;

interface PaginatedResponse {
  ok: boolean;
  items: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  facets?: Record<string, { count: number }[]>;
}

export default function GlobalPage() {
  const [activeTab, setActiveTab] = useState<TabId>('dtus');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [visibilityFilter, setVisibilityFilter] = useState('');

  // Reset page when tab or search changes
  useEffect(() => { setPage(0); }, [activeTab, search, visibilityFilter]);

  const endpointMap: Record<TabId, string> = {
    dtus: '/api/dtus/paginated',
    artifacts: '/api/artifacts/paginated',
    jobs: '/api/jobs/paginated',
    marketplace: '/api/marketplace/paginated',
  };

  const { data, isLoading, isError, error, refetch } = useQuery<PaginatedResponse>({
    queryKey: ['global', activeTab, search, page, visibilityFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      };
      if (search) params.q = search;
      if (visibilityFilter) params.visibility = visibilityFilter;
      // Global page should only show global-scope DTUs
      if (activeTab === 'dtus') params.scope = 'global';

      const res = await api.get(endpointMap[activeTab], { params });
      return res.data;
    },
    staleTime: 30_000,
  });

  const items = data?.items || [];
  const total = data?.total || 0;
  const showing = items.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const queryClient = useQueryClient();

  const syncToLocalMutation = useMutation({
    mutationFn: (dtuId: string) => api.post('/api/dtus/sync-from-global', { dtuId }),
    onSuccess: (res) => {
      const data = res.data;
      if (data?.ok) {
        showToast('success', 'Synced to your local inventory');
        queryClient.invalidateQueries({ queryKey: ['dtus'] });
        queryClient.invalidateQueries({ queryKey: ['scope-metrics'] });
      } else {
        showToast('error', data?.error === 'Already synced' ? 'Already in your local inventory' : (data?.error || 'Sync failed'));
      }
    },
    onError: () => {
      showToast('error', 'Failed to sync to local');
    },
  });

  const handleSyncToLens = useCallback(async (item: Record<string, unknown>) => {
    try {
      const lensId = prompt('Enter lens ID to sync to (e.g., "music", "code", "marketplace"):');
      if (!lensId) return;

      await api.post('/api/lens-items/sync', {
        lens_id: lensId,
        ...(activeTab === 'dtus' ? { dtu_id: item.id } : { artifact_id: item.id }),
      });
      showToast('success', `Synced to ${lensId} lens`);
    } catch {
      showToast('error', 'Failed to sync to lens');
    }
  }, [activeTab]);

  const handlePublish = useCallback(async (item: Record<string, unknown>) => {
    try {
      await api.post('/api/marketplace/listings', {
        owner_user_id: (item as Record<string, unknown>).owner_user_id || 'system',
        title: (item as Record<string, string>).title || 'Untitled',
        description: `Published from Global view`,
      });
      showToast('success', 'Draft listing created. Attach artifacts and publish when ready.');
    } catch {
      showToast('error', 'Failed to create listing');
    }
  }, []);

  return (
    <LensShell
      domain="global"
      title="Global"
      icon={<Globe className="w-6 h-6" />}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      searchable
      searchQuery={search}
      onSearchChange={setSearch}
      searchPlaceholder={`Search ${activeTab}...`}
      isLoading={isLoading}
      isError={isError}
      error={error as { message?: string } | null}
      onRetry={() => refetch()}
      filters={
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={visibilityFilter}
            onChange={(e) => setVisibilityFilter(e.target.value)}
            className={cn(ds.input, 'w-auto py-1.5 text-sm')}
          >
            <option value="">All visibility</option>
            <option value="private">Private</option>
            <option value="public">Public</option>
            <option value="marketplace">Marketplace</option>
            {activeTab === 'marketplace' && <option value="published">Published</option>}
            {activeTab === 'marketplace' && <option value="draft">Draft</option>}
          </select>
        </div>
      }
    >
      {/* Count bar */}
      <div className="flex items-center justify-between text-sm text-gray-400 px-1">
        <span>
          Showing <strong className="text-white">{showing}</strong> of{' '}
          <strong className="text-white">{total.toLocaleString()}</strong> {activeTab}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-lattice-surface disabled:opacity-30"
            aria-label="Previous">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-lattice-surface disabled:opacity-30"
            aria-label="Next">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <EmptyState
          icon={<Eye className="w-8 h-8" />}
          title={`No ${activeTab} found`}
          description={search ? `No results for "${search}"` : `No ${activeTab} exist yet.`}
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id as string}
              className="flex items-center justify-between p-3 rounded-lg bg-lattice-surface/50 border border-lattice-border hover:border-neon-cyan/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium truncate">
                    {(item.title as string) || (item.type as string) || (item.id as string)}
                  </span>
                  {!!item.visibility && (
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      item.visibility === 'public' ? 'bg-neon-green/20 text-neon-green' :
                      item.visibility === 'published' ? 'bg-neon-cyan/20 text-neon-cyan' :
                      item.visibility === 'marketplace' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-gray-500/20 text-gray-400'
                    )}>
                      {item.visibility as string}
                    </span>
                  )}
                  {!!item.status && (
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full',
                      item.status === 'completed' ? 'bg-neon-green/20 text-neon-green' :
                      item.status === 'running' ? 'bg-neon-blue/20 text-neon-blue' :
                      item.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-500/20 text-gray-400'
                    )}>
                      {item.status as string}
                    </span>
                  )}
                  {!!item.tier && (
                    <span className="text-xs text-gray-500">{item.tier as string}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {!!item.type && <span className="mr-3">Type: {item.type as string}</span>}
                  {!!item.created_at && <span>Created: {new Date(item.created_at as string).toLocaleDateString()}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1 ml-2">
                {activeTab === 'dtus' && (
                  <button
                    onClick={() => syncToLocalMutation.mutate(item.id as string)}
                    disabled={syncToLocalMutation.isPending}
                    className="p-1.5 rounded text-gray-400 hover:text-neon-green hover:bg-neon-green/10 transition-colors disabled:opacity-30"
                    title="Sync to your local inventory"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleSyncToLens(item)}
                  className="p-1.5 rounded text-gray-400 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
                  title="Sync to lens"
                >
                  <Send className="w-4 h-4" />
                </button>
                {(activeTab === 'dtus' || activeTab === 'artifacts') && (
                  <button
                    onClick={() => handlePublish(item)}
                    className="p-1.5 rounded text-gray-400 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                    title="Publish to marketplace"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </LensShell>
  );
}
