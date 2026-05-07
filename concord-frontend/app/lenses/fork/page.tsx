'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { GitFork, GitBranch, GitMerge, Layers, Loader2, ChevronDown, ArrowLeftRight, Eye, GitPullRequest, Network, Scale, Diff, RefreshCw, X, Zap, Activity } from 'lucide-react';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api } from '@/lib/api/client';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { showToast } from '@/components/common/Toasts';

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

const SEED_FORKS: {
  title: string;
  data: Record<string, unknown>;
}[] = [];

export default function ForkLensPage() {
  useLensNav('fork');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('fork');
  const [selectedFork, setSelectedFork] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');
  const [showFeatures, setShowFeatures] = useState(true);

  const { items: forkItems, isLoading, isError: isError, error: error, refetch: refetch, create, update } = useLensData<ForkData>('fork', 'fork', {
    seed: SEED_FORKS,
  });

  // Backend action wiring
  const runForkAction = useRunArtifact('fork');
  const [forkActionResult, setForkActionResult] = useState<Record<string, unknown> | null>(null);
  const [forkRunning, setForkRunning] = useState<string | null>(null);

  const handleForkAction = useCallback(async (action: string) => {
    const targetId = forkItems[0]?.id;
    if (!targetId) return;
    setForkRunning(action);
    try {
      const res = await runForkAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setForkActionResult({ _action: action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setForkActionResult({ _action: action, ...(res.result as Record<string, unknown>) }); }
    } catch (e) { console.error(`Fork action ${action} failed:`, e); setForkActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setForkRunning(null);
  }, [forkItems, runForkAction]);

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
    abandoned: 'text-gray-500 bg-gray-500/20',
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
    const children = forks.filter((f) => f.parentId === fork.id);
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
          {level > 0 && <GitBranch className="w-4 h-4 text-gray-500" />}
          {level === 0 && <GitFork className="w-4 h-4 text-neon-purple" />}
          <div className="flex-1 text-left">
            <p className="font-medium">{fork.workspace}</p>
            <p className="text-xs text-gray-400">{fork.entityName}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded ${statusColors[fork.status]}`}>
            {fork.status}
          </span>
          {fork.children > 0 && (
            <span className="text-xs text-gray-500">+{fork.children}</span>
          )}
        </button>
        {children.map((child) => renderTreeNode(child, level + 1))}
      </div>
    );
  };

  const rootForks = forks.filter((f) => f.parentId === null);
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
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('tree')}
            className={`px-3 py-1 rounded ${viewMode === 'tree' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400'}`}
          >
            Tree
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1 rounded ${viewMode === 'list' ? 'bg-neon-purple/20 text-neon-purple' : 'bg-lattice-surface text-gray-400'}`}
          >
            List
          </button>
        </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="fork" artifactId={forkItems[0]?.id} compact />

      {/* Fork Analysis Actions */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-cyan" />
          Fork Analysis
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {[
            { action: 'divergenceAnalysis', label: 'Divergence Analysis', icon: ArrowLeftRight, color: 'text-neon-cyan' },
            { action: 'mergeComplexity',    label: 'Merge Complexity',    icon: GitMerge,      color: 'text-neon-purple' },
            { action: 'forkHealth',         label: 'Fork Health',         icon: Activity,      color: 'text-neon-green' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleForkAction(action)}
              disabled={!!forkRunning || !forkItems[0]?.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-deep border border-lattice-border text-sm hover:border-white/20 disabled:opacity-40 transition-colors"
            >
              {forkRunning === action ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className={`w-4 h-4 ${color}`} />}
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {forkActionResult && (
          <div className="mt-3 rounded-lg bg-black/30 border border-white/10 p-4 relative">
            <button onClick={() => setForkActionResult(null)} className="absolute top-3 right-3 text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>

            {/* divergenceAnalysis */}
            {forkActionResult._action === 'divergenceAnalysis' && (forkActionResult.summary as Record<string,unknown>) && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Divergence Analysis</p>
                {(() => {
                  const summary = forkActionResult.summary as Record<string,number>;
                  const divergence = forkActionResult.divergence as Record<string,unknown>;
                  return (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: 'Total Files', value: String(summary.totalFiles ?? 0), color: 'text-white' },
                          { label: 'Conflicts', value: String(summary.conflictingFiles ?? 0), color: summary.conflictingFiles > 0 ? 'text-red-400' : 'text-neon-green' },
                          { label: 'Modified in A', value: String(summary.modifiedInA ?? 0), color: 'text-neon-cyan' },
                          { label: 'Modified in B', value: String(summary.modifiedInB ?? 0), color: 'text-neon-purple' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-lg font-bold ${color}`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <p className="text-xs text-gray-400 mb-1">Divergence Score</p>
                          <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${(divergence.score as number) > 70 ? 'bg-red-500' : (divergence.score as number) > 40 ? 'bg-yellow-500' : 'bg-neon-green'}`} style={{ width: `${divergence.score as number}%` }} />
                          </div>
                        </div>
                        <span className={`text-sm font-bold px-2 py-1 rounded ${(divergence.score as number) > 70 ? 'bg-red-500/20 text-red-400' : (divergence.score as number) > 40 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-neon-green/20 text-neon-green'}`}>{divergence.score as number}% — {divergence.level as string}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* mergeComplexity */}
            {forkActionResult._action === 'mergeComplexity' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Merge Complexity</p>
                {(forkActionResult.message as string) ? <p className="text-sm text-gray-400">{forkActionResult.message as string}</p> : (() => {
                  const complexity = forkActionResult.complexity as Record<string,unknown>;
                  const summary = forkActionResult.summary as Record<string,unknown>;
                  return (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: 'Score', value: `${complexity?.score ?? 0}/100`, color: 'text-neon-cyan' },
                          { label: 'Level', value: String(complexity?.level ?? '—'), color: (complexity?.level as string) === 'easy' ? 'text-neon-green' : (complexity?.level as string) === 'moderate' ? 'text-yellow-400' : 'text-red-400' },
                          { label: 'Est. Hours', value: String(complexity?.estimatedMergeHours ?? 0), color: 'text-white' },
                          { label: 'Conflicts', value: String((summary as Record<string,number>)?.totalDirectConflicts ?? 0), color: 'text-red-400' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="bg-white/5 rounded-lg p-3 text-center">
                            <p className={`text-lg font-bold ${color} capitalize`}>{value}</p>
                            <p className="text-xs text-gray-400">{label}</p>
                          </div>
                        ))}
                      </div>
                      {(summary as Record<string,boolean>)?.autoMergeCandidate && (
                        <p className="text-xs text-neon-green bg-neon-green/10 border border-neon-green/20 rounded px-3 py-2">Auto-merge candidate — no conflicts detected</p>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* forkHealth */}
            {forkActionResult._action === 'forkHealth' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Fork Health — {forkActionResult.name as string}</p>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${(forkActionResult.healthScore as number) >= 80 ? 'bg-neon-green' : (forkActionResult.healthScore as number) >= 60 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${forkActionResult.healthScore as number}%` }} />
                    </div>
                  </div>
                  <span className={`text-lg font-bold px-2 py-1 rounded ${(forkActionResult.healthScore as number) >= 80 ? 'text-neon-green' : (forkActionResult.healthScore as number) >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>{forkActionResult.healthScore as number} — {forkActionResult.healthLevel as string}</span>
                </div>
                {(forkActionResult.factors as Record<string,Record<string,number>>) && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {Object.entries(forkActionResult.factors as Record<string,{score:number}>).map(([key, val]) => (
                      <div key={key} className="bg-white/5 rounded-lg p-2 text-center">
                        <p className={`text-sm font-bold ${val.score >= 80 ? 'text-neon-green' : val.score >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>{val.score}</p>
                        <p className="text-[10px] text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(forkActionResult.recommendations) && (forkActionResult.recommendations as string[]).length > 0 && (
                  <div className="space-y-1">
                    {(forkActionResult.recommendations as string[]).map((rec, i) => (
                      <p key={i} className="text-xs text-yellow-400 bg-yellow-400/5 border border-yellow-400/10 rounded px-3 py-1.5">{rec}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
                  <GitBranch className="w-3 h-3 text-gray-500 flex-shrink-0" />
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
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No forks created yet. Fork a DTU to see version branches here.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fork Tree */}
        <div className="lg:col-span-2 panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <GitFork className="w-4 h-4 text-neon-purple" />
            Fork Tree
          </h2>
          <div className="space-y-1">
            {rootForks.map((fork) => renderTreeNode(fork))}
          </div>
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
                <p className="text-xs text-gray-500 font-mono">{selectedForkData.entityId}</p>
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
                  className="btn-neon flex-1 text-sm"
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
            <div className="text-center py-8 text-gray-500">
              <GitFork className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Select a fork to view details</p>
            </div>
          )}
        </div>

      {/* Real-time Data Panel */}
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
      </div>

      {/* Fork Explorer — Tree Visualization, Merge Tools, Comparison View */}
      <div className="panel p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Network className="w-5 h-5 text-neon-purple" />
          Fork Explorer
        </h2>
        <p className="text-sm text-gray-400">
          Visualize fork lineage trees, compare divergent branches, and manage merge operations across workspaces.
        </p>

        {/* Fork Tree Visualization */}
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-neon-cyan" />
            Lineage Tree
          </h3>
          <div className="space-y-1">
            {/* Root node */}
            <div className="flex items-center gap-2 p-2 rounded bg-neon-purple/10 border border-neon-purple/30">
              <GitFork className="w-4 h-4 text-neon-purple" />
              <span className="text-sm font-mono text-white">main</span>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">origin</span>
            </div>
            {/* Branch level 1 */}
            <div className="ml-6 border-l-2 border-white/10 pl-4 space-y-1">
              <div className="flex items-center gap-2 p-2 rounded bg-black/40 border border-white/10 hover:border-neon-cyan/40 transition-colors">
                <GitBranch className="w-3 h-3 text-neon-cyan" />
                <span className="text-sm font-mono text-gray-300">workspace-alpha</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">active</span>
              </div>
              {/* Branch level 2 */}
              <div className="ml-6 border-l-2 border-white/10 pl-4 space-y-1">
                <div className="flex items-center gap-2 p-2 rounded bg-black/40 border border-white/10 hover:border-neon-cyan/40 transition-colors">
                  <GitBranch className="w-3 h-3 text-gray-500" />
                  <span className="text-sm font-mono text-gray-400">alpha-experiment-1</span>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded bg-neon-blue/20 text-neon-blue">merged</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded bg-black/40 border border-white/10 hover:border-neon-cyan/40 transition-colors">
                  <GitBranch className="w-3 h-3 text-neon-green" />
                  <span className="text-sm font-mono text-gray-300">alpha-experiment-2</span>
                  <span className="ml-auto text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">active</span>
                </div>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-black/40 border border-white/10 hover:border-neon-cyan/40 transition-colors">
                <GitBranch className="w-3 h-3 text-neon-cyan" />
                <span className="text-sm font-mono text-gray-300">workspace-beta</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">active</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-black/40 border border-white/10 opacity-60">
                <GitBranch className="w-3 h-3 text-gray-600" />
                <span className="text-sm font-mono text-gray-500">workspace-gamma</span>
                <span className="ml-auto text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-500">abandoned</span>
              </div>
            </div>
          </div>
        </div>

        {/* Merge Tools & Fork Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Merge Tools */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <GitPullRequest className="w-4 h-4 text-neon-green" />
              Merge Tools
            </h3>
            <div className="space-y-2">
              <button onClick={() => { api.post('/api/lens/run', { domain: 'fork', action: 'merge', strategy: 'fast-forward' }).then(() => showToast('success', 'Fast-forward merge initiated')).catch(() => showToast('error', 'Merge failed — no eligible forks')); }} className="w-full flex items-center gap-2 p-2.5 rounded bg-black/30 border border-white/10 hover:border-neon-green/40 transition-colors text-left">
                <GitMerge className="w-4 h-4 text-neon-green" />
                <div>
                  <p className="text-sm text-white">Fast-Forward Merge</p>
                  <p className="text-xs text-gray-500">No conflicts, linear history</p>
                </div>
              </button>
              <button onClick={() => { api.post('/api/lens/run', { domain: 'fork', action: 'merge', strategy: 'three-way' }).then(() => showToast('success', 'Three-way merge initiated')).catch(() => showToast('error', 'Merge failed — no eligible forks')); }} className="w-full flex items-center gap-2 p-2.5 rounded bg-black/30 border border-white/10 hover:border-neon-purple/40 transition-colors text-left">
                <Scale className="w-4 h-4 text-neon-purple" />
                <div>
                  <p className="text-sm text-white">Three-Way Merge</p>
                  <p className="text-xs text-gray-500">Resolve conflicts interactively</p>
                </div>
              </button>
              <button onClick={() => { api.post('/api/lens/run', { domain: 'fork', action: 'cherry-pick' }).then(() => showToast('success', 'Cherry-pick mode activated')).catch(() => showToast('error', 'Cherry-pick failed — no DTUs selected')); }} className="w-full flex items-center gap-2 p-2.5 rounded bg-black/30 border border-white/10 hover:border-neon-cyan/40 transition-colors text-left">
                <ArrowLeftRight className="w-4 h-4 text-neon-cyan" />
                <div>
                  <p className="text-sm text-white">Cherry-Pick</p>
                  <p className="text-xs text-gray-500">Select specific DTUs to merge</p>
                </div>
              </button>
            </div>
          </div>

          {/* Fork Comparison View */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Diff className="w-4 h-4 text-neon-cyan" />
              Fork Comparison
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 rounded bg-black/30 border border-white/10">
                <Eye className="w-3 h-3 text-neon-cyan" />
                <span className="text-xs text-gray-400">Base:</span>
                <span className="text-xs font-mono text-white">workspace-alpha</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-black/30 border border-white/10">
                <Eye className="w-3 h-3 text-neon-purple" />
                <span className="text-xs text-gray-400">Compare:</span>
                <span className="text-xs font-mono text-white">workspace-beta</span>
              </div>
              <div className="border-t border-white/10 pt-2 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">DTUs added</span>
                  <span className="text-neon-green font-mono">+12</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">DTUs removed</span>
                  <span className="text-red-400 font-mono">-3</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">DTUs modified</span>
                  <span className="text-yellow-400 font-mono">~7</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Conflicts</span>
                  <span className="text-red-400 font-mono">2</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ConnectiveTissueBar */}
      <ConnectiveTissueBar lensId="fork" />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="fork" />
          </div>
        )}
      </div>
    </div>
  );
}
