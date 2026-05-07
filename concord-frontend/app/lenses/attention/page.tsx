'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo, useEffect } from 'react';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Eye, Plus, Play, CheckCircle2, Layers, Clock, BarChart3,
  Sliders, Focus, Pause, AlertTriangle, ArrowUpDown,
  RefreshCw, Activity, Target, Cpu, ChevronDown, Brain, Gauge
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { AttentionPanel as EmergentAttentionPanel } from '@/components/emergent/AttentionPanel';
import { DreamPanel } from '@/components/emergent/DreamPanel';
import { ForgettingPanel } from '@/components/emergent/ForgettingPanel';
import { RepairPanel } from '@/components/emergent/RepairPanel';
import { EmergentCard, type EmergentEntity } from '@/components/emergent/EmergentCard';
import { EmergentPanel } from '@/components/emergent/EmergentPanel';
import { EntityGrowthDashboard } from '@/components/emergent/EntityGrowthDashboard';

interface Thread {
  id: string;
  type: string;
  priority: number;
  status: string;
  description: string;
  createdAt: string;
  domain?: string;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
}

const THREAD_TYPES = [
  { value: 'reasoning', label: 'Reasoning', color: 'text-neon-cyan' },
  { value: 'analysis', label: 'Analysis', color: 'text-neon-blue' },
  { value: 'creative', label: 'Creative', color: 'text-neon-purple' },
  { value: 'memory-search', label: 'Memory Search', color: 'text-neon-green' },
  { value: 'planning', label: 'Planning', color: 'text-neon-yellow' },
];

export default function AttentionLensPage() {
  useLensNav('attention');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('attention');

  const queryClient = useQueryClient();
  const [newType, setNewType] = useState('reasoning');
  const [newPriority, setNewPriority] = useState('0.5');
  const [newDesc, setNewDesc] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [threadFilter, setThreadFilter] = useState<'all' | 'active' | 'pending' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'created' | 'status'>('priority');
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Lens Bridge ---
  const bridge = useLensBridge('attention', 'thread');

  // --- Backend Action Wiring ---
  const runAction = useRunArtifact('attention');
  const { items: attentionItems } = useLensData<Record<string, unknown>>('attention', 'thread', { seed: [] });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAttentionAction = async (action: string) => {
    const targetId = attentionItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const { data: status, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['attention-status'],
    queryFn: () => apiHelpers.attention.status().then((r) => r.data),
    refetchInterval: 5000,
  });

  const { data: threads, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['attention-threads'],
    queryFn: () => apiHelpers.attention.threads().then((r) => r.data),
    refetchInterval: 5000,
  });

  const { data: queue, isError: isError3, error: error3, refetch: refetch3 } = useQuery({
    queryKey: ['attention-queue'],
    queryFn: () => apiHelpers.attention.queue().then((r) => r.data),
  });

  const createThread = useMutation({
    mutationFn: () => apiHelpers.attention.createThread({
      type: newType,
      priority: parseFloat(newPriority),
      description: newDesc,
      domain: newDomain || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention-threads'] });
      queryClient.invalidateQueries({ queryKey: ['attention-status'] });
      setNewDesc('');
      setNewDomain('');
    },
    onError: (err) => {
      console.error('Failed to create thread:', err instanceof Error ? err.message : err);
    },
  });

  const completeThread = useMutation({
    mutationFn: (threadId: string) => apiHelpers.attention.completeThread({ threadId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention-threads'] });
      queryClient.invalidateQueries({ queryKey: ['attention-status'] });
      setSelectedThread(null);
    },
    onError: (err) => {
      console.error('Failed to complete thread:', err instanceof Error ? err.message : err);
    },
  });

  const addBackground = useMutation({
    mutationFn: (data: { type: string; priority: number }) =>
      apiHelpers.attention.addBackground({ type: data.type, priority: data.priority }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attention-status'] });
    },
    onError: (err) => {
      console.error('Failed to add background task:', err instanceof Error ? err.message : err);
    },
  });

  const threadList: Thread[] = useMemo(() => threads?.threads || [], [threads]);
  const activeThreads = status?.activeThreads || [];
  const stats = status?.stats || {};
  const queueData = queue?.queue || [];
  const completedData = queue?.completed || [];

  // Bridge attention threads into lens artifacts
  useEffect(() => {
    bridge.syncList(threadList, (t) => {
      const thread = t as Thread;
      return { title: `${thread.type}: ${thread.description}`, data: t as Record<string, unknown>, meta: { status: thread.status } };
    });
  }, [threadList, bridge]);

  const filteredThreads = useMemo(() => {
    let filtered = [...threadList];
    if (threadFilter !== 'all') {
      filtered = filtered.filter(t => t.status === threadFilter);
    }
    filtered.sort((a, b) => {
      if (sortBy === 'priority') return (b.priority ?? 0) - (a.priority ?? 0);
      if (sortBy === 'created') return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      // sort by status: active first, pending, then completed
      const statusOrder: Record<string, number> = { active: 0, pending: 1, interrupted: 2, completed: 3 };
      return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
    });
    return filtered;
  }, [threadList, threadFilter, sortBy]);

  // Priority weight distribution
  const priorityDistribution = useMemo(() => {
    const activeOnly = threadList.filter(t => t.status === 'active' || t.status === 'pending');
    const totalWeight = activeOnly.reduce((s, t) => s + (t.priority ?? 0), 0);
    return activeOnly.map(t => ({
      ...t,
      allocation: totalWeight > 0 ? ((t.priority ?? 0) / totalWeight) * 100 : 0,
    }));
  }, [threadList]);

  // Focus metrics
  const focusScore = useMemo(() => {
    const active = threadList.filter(t => t.status === 'active').length;
    const total = threadList.length;
    if (total === 0) return 0;
    // Focus is better when fewer threads are active relative to total
    return Math.min(1, active > 0 ? 1 / active : 0);
  }, [threadList]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading attention system...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => { refetch(); refetch2(); refetch3(); }}
        />
      </div>
    );
  }

  return (
    <div data-lens-theme="attention" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="w-7 h-7 text-neon-cyan" />
          <div>
            <h1 className="text-xl font-bold">Attention & Cognition Lens</h1>
            <p className="text-sm text-gray-400">
              Parallel reasoning threads, focus management, and cognitive scheduling
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="attention" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button
          onClick={() => { refetch(); refetch2(); refetch3(); }}
          className="p-2 rounded-lg bg-lattice-surface hover:bg-lattice-border transition-colors text-gray-400 hover:text-white"
          title="Refresh all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {/* AI Actions */}
      <UniversalActions domain="attention" artifactId={bridge.selectedId} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Brain className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{threadList.filter(t => t.status === 'active' || t.status === 'pending').length}</p>
            <p className="text-xs text-gray-500">Focus Sessions</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Clock className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{stats.avgFocusDurationMs ? ((stats.avgFocusDurationMs / 3600000) * (stats.threadsCompleted || 1)).toFixed(1) : '0.0'}h</p>
            <p className="text-xs text-gray-500">Total Focus Hours</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-neon-yellow" />
          <div>
            <p className="text-lg font-bold">{stats.interruptions || 0}</p>
            <p className="text-xs text-gray-500">Distractions</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Gauge className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{(focusScore * 100).toFixed(0)}%</p>
            <p className="text-xs text-gray-500">Daily Score</p>
          </div>
        </motion.div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="lens-card">
          <Focus className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{status?.focus ? 'Focused' : 'Idle'}</p>
          <p className="text-sm text-gray-400">Focus State</p>
        </div>
        <div className="lens-card">
          <Play className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{activeThreads.length}</p>
          <p className="text-sm text-gray-400">Active Threads</p>
        </div>
        <div className="lens-card">
          <Clock className="w-5 h-5 text-neon-yellow mb-2" />
          <p className="text-2xl font-bold">{status?.queueLength || 0}</p>
          <p className="text-sm text-gray-400">Queued</p>
        </div>
        <div className="lens-card">
          <BarChart3 className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{stats.threadsCompleted || 0}</p>
          <p className="text-sm text-gray-400">Completed</p>
        </div>
        <div className="lens-card">
          <Target className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{(focusScore * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Focus Score</p>
        </div>
      </div>

      {/* Priority Weights Display */}
      {priorityDistribution.length > 0 ? (
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-neon-yellow" /> Attention Allocation
          </h2>
          <div className="flex h-6 rounded-full overflow-hidden bg-lattice-deep">
            {priorityDistribution.map((t, i) => {
              const colors = ['bg-neon-cyan', 'bg-neon-purple', 'bg-neon-green', 'bg-neon-blue', 'bg-neon-yellow', 'bg-neon-pink'];
              return (
                <div
                  key={t.id}
                  className={`${colors[i % colors.length]} transition-all duration-500 relative group`}
                  style={{ width: `${Math.max(t.allocation, 2)}%` }}
                  title={`${t.type}: ${t.allocation.toFixed(1)}%`}
                >
                  <div className="absolute inset-0 flex items-center justify-center">
                    {t.allocation > 10 && (
                      <span className="text-[10px] font-bold text-white/90 truncate px-1">
                        {t.type}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {priorityDistribution.map((t, i) => {
              const dotColors = ['bg-neon-cyan', 'bg-neon-purple', 'bg-neon-green', 'bg-neon-blue', 'bg-neon-yellow', 'bg-neon-pink'];
              return (
                <span key={t.id} className="flex items-center gap-1 text-xs text-gray-400">
                  <span className={`w-2 h-2 rounded-full ${dotColors[i % dotColors.length]}`} />
                  {t.type} ({t.allocation.toFixed(1)}%)
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No priority items tracked yet. Add attention items to see priority distribution.</p>
        </div>
      )}

      {/* Focus Metrics */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-green" /> Focus Metrics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase">Total Created</p>
            <p className="text-lg font-bold text-gray-200">{stats.threadsCreated || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase">Interruptions</p>
            <p className="text-lg font-bold text-yellow-400">{stats.interruptions || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase">Background Tasks</p>
            <p className="text-lg font-bold text-gray-200">{status?.backgroundTasks || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase">Avg Focus Duration</p>
            <p className="text-lg font-bold text-gray-200">
              {stats.avgFocusDurationMs ? `${(stats.avgFocusDurationMs / 1000).toFixed(1)}s` : '--'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Thread + Allocation Controls */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-neon-purple" /> New Cognitive Thread
          </h2>
          <select value={newType} onChange={(e) => setNewType(e.target.value)} className="input-lattice w-full">
            {THREAD_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">
              Priority: <span className="text-neon-cyan">{parseFloat(newPriority).toFixed(1)}</span>
            </label>
            <input
              type="range"
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              min="0"
              max="1"
              step="0.1"
              className="w-full accent-neon-cyan"
            />
            <div className="flex justify-between text-[10px] text-gray-600">
              <span>Low</span>
              <span>Medium</span>
              <span>High</span>
            </div>
          </div>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Thread description..."
            className="input-lattice w-full"
          />
          <input
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="Domain (optional)..."
            className="input-lattice w-full"
          />
          <button
            onClick={() => createThread.mutate()}
            disabled={!newDesc || createThread.isPending}
            className="btn-neon purple w-full"
          >
            {createThread.isPending ? 'Creating...' : 'Create Thread'}
          </button>

          {/* Background Task */}
          <div className="border-t border-lattice-border pt-3 mt-3">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Cpu className="w-3 h-3 text-gray-400" /> Quick Background Task
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => addBackground.mutate({ type: 'memory-consolidation', priority: 0.3 })}
                disabled={addBackground.isPending}
                className="text-xs px-2 py-1.5 rounded bg-lattice-surface border border-lattice-border hover:border-neon-cyan/30 transition-colors text-gray-400 hover:text-neon-cyan disabled:opacity-50"
              >
                Memory
              </button>
              <button
                onClick={() => addBackground.mutate({ type: 'pattern-scan', priority: 0.2 })}
                disabled={addBackground.isPending}
                className="text-xs px-2 py-1.5 rounded bg-lattice-surface border border-lattice-border hover:border-neon-purple/30 transition-colors text-gray-400 hover:text-neon-purple disabled:opacity-50"
              >
                Patterns
              </button>
              <button
                onClick={() => addBackground.mutate({ type: 'cleanup', priority: 0.1 })}
                disabled={addBackground.isPending}
                className="text-xs px-2 py-1.5 rounded bg-lattice-surface border border-lattice-border hover:border-neon-green/30 transition-colors text-gray-400 hover:text-neon-green disabled:opacity-50"
              >
                Cleanup
              </button>
            </div>
          </div>
        </div>

        {/* Thread Viewer */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-neon-cyan" /> Threads
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={threadFilter}
                onChange={(e) => setThreadFilter(e.target.value as typeof threadFilter)}
                className="text-xs bg-lattice-surface border border-lattice-border rounded px-2 py-1 text-gray-400"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
              <button
                onClick={() => setSortBy(sortBy === 'priority' ? 'created' : sortBy === 'created' ? 'status' : 'priority')}
                className="text-xs flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors"
                title={`Sort by: ${sortBy}`}
              >
                <ArrowUpDown className="w-3 h-3" /> {sortBy}
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {filteredThreads.map((t, index) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={`lens-card cursor-pointer transition-all ${
                  selectedThread?.id === t.id ? 'ring-1 ring-neon-cyan/40' : 'hover:bg-lattice-border/20'
                }`}
                onClick={() => setSelectedThread(selectedThread?.id === t.id ? null : t)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      t.status === 'active' ? 'bg-neon-green animate-pulse' :
                      t.status === 'pending' ? 'bg-yellow-400' :
                      t.status === 'interrupted' ? 'bg-red-400' : 'bg-gray-500'
                    }`} />
                    <span className="font-medium text-sm">
                      {THREAD_TYPES.find(tt => tt.value === t.type)?.label || t.type}
                    </span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-lattice-surface text-gray-400">
                    P:{(t.priority ?? 0).toFixed(1)}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1 truncate">{t.description}</p>
                {t.domain && (
                  <span className="text-[10px] text-neon-purple/70 mt-1 inline-block">{t.domain}</span>
                )}

                {/* Expanded thread details */}
                {selectedThread?.id === t.id && (
                  <div className="mt-2 pt-2 border-t border-lattice-border space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Status</span>
                        <p className="capitalize text-gray-300">{t.status}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Created</span>
                        <p className="text-gray-300">
                          {t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : '--'}
                        </p>
                      </div>
                    </div>
                    {t.status === 'active' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); completeThread.mutate(t.id); }}
                        disabled={completeThread.isPending}
                        className="w-full mt-1 text-xs py-1.5 rounded bg-neon-green/10 text-neon-green border border-neon-green/20 hover:bg-neon-green/20 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {completeThread.isPending ? 'Completing...' : 'Complete Thread'}
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
            {filteredThreads.length === 0 && (
              <p className="text-center py-4 text-gray-500 text-sm">
                {threadFilter === 'all' ? 'No threads yet' : `No ${threadFilter} threads`}
              </p>
            )}
          </div>
        </div>

        {/* Queue + Completed */}
        <div className="panel p-4 space-y-4">
          <div>
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-neon-yellow" /> Queue
              {queueData.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-neon-yellow/20 text-neon-yellow">{queueData.length}</span>
              )}
            </h2>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {queueData.length > 0 ? queueData.map((q: Record<string, unknown>, i: number) => (
                <div key={i} className="flex justify-between items-center text-xs text-gray-400 p-2 rounded bg-lattice-surface/50">
                  <div className="flex items-center gap-2">
                    <Pause className="w-3 h-3 text-yellow-400" />
                    <span className="truncate max-w-[120px]">{(q.threadId as string | undefined)?.slice(0, 12) || `Item ${i + 1}`}</span>
                  </div>
                  <span className="font-mono">P:{((q.priority as number) ?? 0).toFixed(1)}</span>
                </div>
              )) : (
                <p className="text-sm text-gray-500 text-center py-2">Queue empty</p>
              )}
            </div>
          </div>

          <div className="border-t border-lattice-border pt-3">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-neon-green" /> Recently Completed
            </h2>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {completedData.length > 0 ? completedData.map((c: Record<string, unknown>, i: number) => (
                <div key={i} className="lens-card text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3 h-3 text-neon-green flex-shrink-0" />
                      <span className="text-gray-300 capitalize">{String(c.type || 'unknown')}</span>
                    </div>
                    {!!c.completedAt && (
                      <span className="text-gray-600 text-[10px]">
                        {new Date(c.completedAt as string).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
              )) : (
                <p className="text-sm text-gray-500 text-center py-2">None yet</p>
              )}
            </div>
          </div>

          {/* Interruption Warning */}
          {(stats.interruptions || 0) > 5 && (
            <div className="border-t border-lattice-border pt-3">
              <div className="flex items-start gap-2 p-2 rounded-lg bg-yellow-400/5 border border-yellow-400/20">
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="text-yellow-400 font-medium">High Interruption Rate</p>
                  <p className="text-gray-500 mt-0.5">
                    {stats.interruptions} interruptions detected. Consider reducing thread concurrency.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="attention"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* ── Emergent Subsystems ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Emergent Attention Allocation */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-cyan" /> Attention Allocation
          </h2>
          <EmergentAttentionPanel />
        </div>

        {/* Emergent Entities */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Brain className="w-4 h-4 text-neon-purple" /> Emergent Entities
          </h2>
          <EmergentPanel />
          {/* Individual entity cards for active threads with emergent roles */}
          {threadList.filter(t => t.status === 'active').length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wider">Active Thread Entities</p>
              {threadList.filter(t => t.status === 'active').map(t => (
                <EmergentCard key={t.id} emergent={{ id: t.id, role: t.type === 'creative' ? 'builder' : t.type === 'analysis' ? 'critic' : 'synthesizer', name: `${t.type}: ${t.description}`, active: true, state: 'active' } as EmergentEntity} />
              ))}
            </div>
          )}
        </div>

        {/* Dream Journal */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-neon-blue" /> Dream Journal
          </h2>
          <DreamPanel />
        </div>

        {/* Forgetting Engine */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-neon-yellow" /> Forgetting Engine
          </h2>
          <ForgettingPanel />
        </div>

        {/* Repair Cortex */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-green" /> Repair Cortex
          </h2>
          <RepairPanel />
        </div>
      </div>

      {/* Entity Growth Dashboard */}
      <div className="panel p-4">
        <EntityGrowthDashboard />
      </div>

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
            <LensFeaturePanel lensId="attention" />
          </div>
        )}
      </div>
    </div>
  );
}
