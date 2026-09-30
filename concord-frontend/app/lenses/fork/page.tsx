'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useState, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { GitFork, GitBranch, GitMerge, Layers, Loader2, ArrowLeftRight, RefreshCw, Network, Eye, FlaskConical } from 'lucide-react';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ForkNetworkExplorer } from '@/components/fork/ForkNetworkExplorer';
import { RepoWatchlist } from '@/components/fork/RepoWatchlist';
import { ForkInsights } from '@/components/fork/ForkInsights';
import { ForkAnalysisLab } from '@/components/fork/ForkAnalysisLab';

interface ForkData {
  parentId: string | null;
  entityId: string;
  entityName: string;
  workspace: string;
  status: 'active' | 'merged' | 'abandoned';
  depth: number;
  children: number;
  lastActivity: string;
}

const FORKS_FALLBACK: {
  title: string;
  data: Record<string, unknown>;
}[] = [];

type ForkView = 'lineage' | 'lab' | 'insights' | 'network' | 'watchlist';
type ForkStatusFilter = 'all' | 'active' | 'merged' | 'abandoned';

const FORK_TABS: { id: ForkView; label: string; icon: typeof GitFork; keys: string }[] = [
  { id: 'lineage', label: 'Lineage', icon: GitFork, keys: 'g' },
  { id: 'lab', label: 'Lab', icon: FlaskConical, keys: 'a' },
  { id: 'insights', label: 'Insights', icon: Eye, keys: 'i' },
  { id: 'network', label: 'Network', icon: Network, keys: 'n' },
  { id: 'watchlist', label: 'Watchlist', icon: Layers, keys: 'w' },
];

export default function ForkLensPage() {
  useLensNav('fork');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('fork');
  const [selectedFork, setSelectedFork] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ForkView>('lineage');
  const [layout, setLayout] = useState<'tree' | 'list'>('tree');
  const [forkSearch, setForkSearch] = useState('');
  const [forkStatusFilter, setForkStatusFilter] = useState<ForkStatusFilter>('all');
  const forkSearchInputRef = useRef<HTMLInputElement>(null);

  // One view union; tree/list is a layout toggle inside Lineage.
  useLensCommand(
    [
      { id: 'tab-lineage', keys: 'g', description: 'Lineage', category: 'navigation', action: () => setActiveView('lineage') },
      { id: 'tab-lab', keys: 'a', description: 'Analysis lab', category: 'navigation', action: () => setActiveView('lab') },
      { id: 'tab-insights', keys: 'i', description: 'Fork insights', category: 'navigation', action: () => setActiveView('insights') },
      { id: 'tab-network', keys: 'n', description: 'Network explorer', category: 'navigation', action: () => setActiveView('network') },
      { id: 'tab-watchlist', keys: 'w', description: 'Repo watchlist', category: 'navigation', action: () => setActiveView('watchlist') },
      { id: 'fork-tree',    keys: 't', description: 'Tree layout', category: 'view', action: () => { setActiveView('lineage'); setLayout('tree'); } },
      { id: 'fork-list',    keys: 'l', description: 'List layout', category: 'view', action: () => { setActiveView('lineage'); setLayout('list'); } },
      { id: 'fork-clear',   keys: 'esc', description: 'Clear selection', category: 'navigation', action: () => setSelectedFork(null) },
      { id: 'focus-search', keys: '/', description: 'Search forks', category: 'navigation', action: () => forkSearchInputRef.current?.focus() },
      { id: 'filter-all',     keys: '0', description: 'All statuses', category: 'view', action: () => setForkStatusFilter('all') },
      { id: 'filter-active',  keys: '1', description: 'Active',       category: 'view', action: () => setForkStatusFilter('active') },
      { id: 'filter-merged',  keys: '2', description: 'Merged',       category: 'view', action: () => setForkStatusFilter('merged') },
      { id: 'filter-abandoned', keys: '3', description: 'Abandoned',  category: 'view', action: () => setForkStatusFilter('abandoned') },
    ],
    { lensId: 'fork' }
  );

  const { items: forkItems, isLoading, isError: isError, error: error, refetch: refetch, create, update } = useLensData<ForkData>('fork', 'fork', {
    seed: FORKS_FALLBACK,
  });

  const forks = forkItems.map((item) => ({
    id: item.title || item.id,
    _artifactId: item.id,
    parentId: item.data.parentId,
    entityId: item.data.entityId,
    entityName: item.data.entityName,
    workspace: item.data.workspace,
    status: item.data.status,
    depth: item.data.depth,
    children: item.data.children,
    createdAt: item.createdAt,
    lastActivity: item.data.lastActivity,
  }));

  const statusColors = {
    active: 'text-neon-green bg-neon-green/20',
    merged: 'text-neon-blue bg-neon-blue/20',
    abandoned: 'text-gray-400 bg-gray-500/20',
  };

  const handleMerge = useCallback(async () => {
    if (!selectedFork) return;
    const forkItem = forkItems.find((f) => (f.title || f.id) === selectedFork);
    if (!forkItem) return;
    await update(forkItem.id, { data: { ...forkItem.data, status: 'merged' as const } });
  }, [selectedFork, forkItems, update]);

  const handleFork = useCallback(async () => {
    if (!selectedFork) return;
    const parent = forks.find((f) => f.id === selectedFork);
    if (!parent) return;
    await create({
      title: `f-${Date.now().toString(36)}`,
      data: {
        parentId: parent.id,
        entityId: parent.entityId,
        entityName: parent.entityName,
        workspace: `${parent.workspace}-fork-${Date.now().toString(36).slice(-4)}`,
        status: 'active',
        depth: parent.depth + 1,
        children: 0,
        lastActivity: new Date().toISOString(),
      },
    });
  }, [selectedFork, forks, create]);

  const renderTreeNode = (fork: typeof forks[0], level: number = 0) => {
    const children = forks.filter((f) =>
      f.parentId === fork.id && (!visibleForkIds || visibleForkIds.has(f.id))
    );
    const isSelected = selectedFork === fork.id;

    return (
      <div key={fork.id} style={{ marginLeft: `${level * 24}px` }}>
        <button
          onClick={() => setSelectedFork(isSelected ? null : fork.id)}
          className={`w-full flex items-center gap-3 p-3 rounded-lg mb-2 transition-colors ${
            isSelected
              ? 'bg-neon-cyan/20 border border-neon-cyan'
              : 'bg-lattice-deep hover:bg-lattice-surface'
          }`}
        >
          {level > 0 && <GitBranch className="w-4 h-4 text-gray-400" />}
          {level === 0 && <GitFork className="w-4 h-4 text-neon-purple" />}
          <div className="flex-1 text-left">
            <p className="font-medium">{fork.workspace}</p>
            <p className="text-xs text-gray-400">{fork.entityName}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${statusColors[fork.status]}`}>
            {fork.status}
          </span>
          {fork.children > 0 && (
            <span className="text-xs text-gray-400">+{fork.children}</span>
          )}
        </button>
        {children.map((child) => renderTreeNode(child, level + 1))}
      </div>
    );
  };

  // Filter forks by search + status.  In tree view we keep ancestors of
  // any matched fork visible so the tree structure stays coherent —
  // otherwise filtering can hide a parent and orphan its children
  // visually.  In list view we just show the matched leaves.
  const visibleForkIds = useMemo(() => {
    const q = forkSearch.trim().toLowerCase();
    if (!q && forkStatusFilter === 'all') return null; // no filter
    const direct = new Set<string>();
    for (const f of forks) {
      const matchSearch = !q || (f.workspace || '').toLowerCase().includes(q) || (f.entityName || '').toLowerCase().includes(q);
      const matchStatus = forkStatusFilter === 'all' || f.status === forkStatusFilter;
      if (matchSearch && matchStatus) direct.add(f.id);
    }
    if (layout === 'list') return direct;
    // For tree, expand to include ancestors so the tree renders coherently.
    const out = new Set(direct);
    const byId = new Map(forks.map((f) => [f.id, f]));
    for (const id of direct) {
      let cur = byId.get(id);
      while (cur?.parentId) {
        out.add(cur.parentId);
        cur = byId.get(cur.parentId) ?? undefined;
        if (!cur) break;
      }
    }
    return out;
  }, [forks, forkSearch, forkStatusFilter, layout]);

  const rootForks = forks.filter((f) =>
    f.parentId === null && (!visibleForkIds || visibleForkIds.has(f.id))
  );
  const visibleListForks = visibleForkIds ? forks.filter((f) => visibleForkIds.has(f.id)) : forks;
  const selectedForkData = forks.find((f) => f.id === selectedFork);

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-neon-purple" />
        <span className="ml-3 text-gray-400">Loading fork tree...</span>
      </div>
    );
  }


  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <LensShell lensId="fork" asMain={false}>
      <FirstRunTour lensId="fork" />      <DepthBadge lensId="fork" size="sm" className="ml-2" />
    <div data-lens-theme="fork" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🌿</span>
          <div>
            <h1 className="text-xl font-bold">Fork Lens</h1>
            <p className="text-sm text-gray-400">
              Visualize entity forks and workspace lineages
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="fork" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={forkSearchInputRef}
            type="text"
            value={forkSearch}
            onChange={(e) => setForkSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setForkSearch(''); forkSearchInputRef.current?.blur(); } }}
            placeholder="Search forks…  / focuses"
            className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-sm w-44"
          />
          <select
            value={forkStatusFilter}
            onChange={(e) => setForkStatusFilter(e.target.value as typeof forkStatusFilter)}
            className="bg-lattice-deep border border-lattice-edge rounded px-2 py-1 text-sm"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="merged">Merged</option>
            <option value="abandoned">Abandoned</option>
          </select>
          {activeView === 'lineage' && (
            <>
              <button
                onClick={() => setLayout('tree')}
                className={`px-3 py-1 rounded ${layout === 'tree' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400'}`}
              >
                Tree
              </button>
              <button
                onClick={() => setLayout('list')}
                className={`px-3 py-1 rounded ${layout === 'list' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400'}`}
              >
                List
              </button>
            </>
          )}
        </div>
      </header>

      <nav className="flex items-center gap-1 border-b border-violet-900/40 pb-px overflow-x-auto" aria-label="Fork views">
        {FORK_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveView(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap rounded-t border-b-2 transition-colors ${
              activeView === t.id
                ? 'border-neon-purple text-neon-purple bg-neon-purple/10'
                : 'border-transparent text-gray-400 hover:text-violet-200 hover:bg-violet-950/30'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            <kbd className="text-[9px] opacity-50 ml-0.5">{t.keys}</kbd>
          </button>
        ))}
      </nav>

      {activeView === 'lab' && (
        <div className="panel p-4">
          <ForkAnalysisLab />
        </div>
      )}

      {activeView === 'lineage' && (<>
      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: GitFork, color: 'text-neon-purple', value: forks.length, label: 'Total Forks' },
          { icon: GitBranch, color: 'text-neon-green', value: forks.filter((f) => f.status === 'active').length, label: 'Active' },
          { icon: GitMerge, color: 'text-neon-blue', value: forks.filter((f) => f.status === 'merged').length, label: 'Merged' },
          { icon: Layers, color: 'text-neon-cyan', value: forks.length > 0 ? Math.max(...forks.map((f) => f.depth)) + 1 : 0, label: 'Max Depth' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Fork Divergence & Sync Status */}
      {forks.length > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="panel p-4"
        >
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-neon-cyan" />
            Divergence & Sync Status
          </h3>
          <div className="space-y-2">
            {forks.filter(f => f.parentId !== null).slice(0, 5).map((fork) => {
              const divergence = Math.min(100, fork.depth * 25 + fork.children * 10);
              const synced = fork.status === 'merged';
              return (
                <div key={fork.id} className="flex items-center gap-3">
                  <GitBranch className="w-3 h-3 text-gray-400 flex-shrink-0" />
                  <span className="text-xs text-gray-400 w-36 truncate font-mono">{fork.workspace}</span>
                  <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${divergence > 70 ? 'bg-red-400' : divergence > 40 ? 'bg-amber-400' : 'bg-neon-green'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${divergence}%` }}
                      transition={{ duration: 0.6, delay: 0.4 }}
                    />
                  </div>
                  <span className="text-xs font-mono w-10 text-right text-gray-300">{divergence}%</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-1 ${synced ? 'bg-neon-green/20 text-neon-green' : 'bg-amber-400/20 text-amber-400'}`}>
                    <RefreshCw className="w-2.5 h-2.5" />
                    {synced ? 'Synced' : 'Diverged'}
                  </span>
                </div>
              );
            })}
          </div>
        </motion.div>
      ) : (
        <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No forks created yet. Fork a DTU to see version branches here.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fork Tree / List */}
        <div className="lg:col-span-2 panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <GitFork className="w-4 h-4 text-neon-purple" />
            Fork {layout === 'tree' ? 'Tree' : 'List'}
            {(forkSearch || forkStatusFilter !== 'all') && (
              <span className="text-xs text-gray-400 font-normal ml-2">
                ({visibleListForks.length} of {forks.length})
              </span>
            )}
          </h2>
          {forks.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No forks yet.</p>
          ) : layout === 'tree' ? (
            rootForks.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No forks match the current filters.</p>
            ) : (
              <div className="space-y-1">
                {rootForks.map((fork) => renderTreeNode(fork))}
              </div>
            )
          ) : visibleListForks.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No forks match the current filters.</p>
          ) : (
            <div className="space-y-1">
              {visibleListForks.map((fork) => {
                const isSelected = selectedFork === fork.id;
                return (
                  <button
                    key={fork.id}
                    onClick={() => setSelectedFork(isSelected ? null : fork.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-neon-cyan/20 border border-neon-cyan'
                        : 'bg-lattice-deep hover:bg-lattice-surface'
                    }`}
                  >
                    <GitBranch className={`w-4 h-4 ${fork.parentId ? 'text-gray-400' : 'text-neon-purple'}`} />
                    <div className="flex-1 text-left">
                      <p className="font-medium">{fork.workspace}</p>
                      <p className="text-xs text-gray-400">{fork.entityName}{fork.depth > 0 ? ` · depth ${fork.depth}` : ''}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[fork.status]}`}>
                      {fork.status}
                    </span>
                    {fork.children > 0 && (
                      <span className="text-xs text-gray-400">+{fork.children}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Fork Details */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-neon-cyan" />
            Fork Details
          </h2>
          {selectedForkData ? (
            <div className="space-y-4">
              <div className="lens-card">
                <p className="text-xs text-gray-400">Workspace</p>
                <p className="font-mono">{selectedForkData.workspace}</p>
              </div>
              <div className="lens-card">
                <p className="text-xs text-gray-400">Entity</p>
                <p>{selectedForkData.entityName}</p>
                <p className="text-xs text-gray-400 font-mono">{selectedForkData.entityId}</p>
              </div>
              <div className="lens-card">
                <p className="text-xs text-gray-400">Status</p>
                <span className={`text-sm px-2 py-0.5 rounded ${statusColors[selectedForkData.status]}`}>
                  {selectedForkData.status}
                </span>
              </div>
              <div className="lens-card">
                <p className="text-xs text-gray-400">Depth</p>
                <p className="text-xl font-bold text-neon-purple">{selectedForkData.depth}</p>
              </div>
              <div className="lens-card">
                <p className="text-xs text-gray-400">Created</p>
                <p>{new Date(selectedForkData.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleMerge}
                  disabled={selectedForkData.status === 'merged'}
                  className="btn-neon flex-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <GitMerge className="w-3 h-3 mr-1 inline" />
                  Merge
                </button>
                <button onClick={handleFork} className="btn-neon purple flex-1 text-sm">
                  <GitFork className="w-3 h-3 mr-1 inline" />
                  Fork
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <GitFork className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Select a fork to view details</p>
            </div>
          )}
        </div>
      </div>
      </>)}

      {activeView === 'insights' && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <ForkInsights />
        </section>
      )}
      {activeView === 'network' && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <ForkNetworkExplorer />
        </section>
      )}
      {activeView === 'watchlist' && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <RepoWatchlist />
        </section>
      )}

      {realtimeData && (
        <RealtimeDataPanel
          domain="fork"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      <ConnectiveTissueBar lensId="fork" />
    </div>          <CrossLensRecentsPanel lensId="fork" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
