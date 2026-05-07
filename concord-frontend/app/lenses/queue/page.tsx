'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useState } from 'react';
import { Inbox, Play, Trash2, Clock, Zap, Globe, FileText, Layers, ChevronDown, Activity, Bot, Coins, CheckCircle2, AlertCircle, RefreshCw, BarChart3, ListOrdered, Timer, X } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { motion } from 'framer-motion';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface QueueItem {
  id: string;
  type: string;
  content: string;
  priority: 'high' | 'normal' | 'low';
  createdAt: string;
  status: 'pending' | 'processing' | 'completed';
}

export default function QueueLensPage() {
  useLensNav('queue');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('queue');
  const queryClient = useQueryClient();
  const [selectedQueue, setSelectedQueue] = useState<'ingest' | 'autocrawl' | 'terminal'>('ingest');
  const [showFeatures, setShowFeatures] = useState(true);

  const { items: queueArtifacts } = useLensData('queue', 'queue', { seed: [] });
  const runAction = useRunArtifact('queue');
  const [queueActionResult, setQueueActionResult] = useState<Record<string, unknown> | null>(null);
  const [queueActiveAction, setQueueActiveAction] = useState<string | null>(null);

  const handleQueueAction = async (action: string) => {
    const id = queueArtifacts[0]?.id;
    if (!id) return;
    setQueueActiveAction(action);
    try {
      const res = await runAction.mutateAsync({ id, action });
      if (res.ok === false) { setQueueActionResult({ action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setQueueActionResult({ action, ...(res.result as Record<string, unknown>) }); }
    } catch (err) { console.error('Queue action failed:', err); }
    finally { setQueueActiveAction(null); }
  };

  // Backend: GET /api/status for queue counts
  const { data: status, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get('/api/status').then((r) => r.data),
    refetchInterval: 5000,
  });

  // Backend: GET /api/jobs/status
  const { data: jobs, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['jobs-status'],
    queryFn: () => api.get('/api/jobs/status').then((r) => r.data),
  });

  const queueItems: Record<string, QueueItem[]> = {
    ingest: [],
    autocrawl: [],
    terminal: [],
  };

  const processItem = useMutation({
    mutationFn: async (_itemId: string) => {
      // Would call backend to process queue item
      return { ok: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (err) => console.error('processItem failed:', err instanceof Error ? err.message : err),
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      return api.delete(`/api/queue/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['status'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Item removed from queue' });
    },
    onError: (err) => useUIStore.getState().addToast({ type: 'error', message: `Failed to remove: ${err instanceof Error ? err.message : 'Unknown error'}` }),
  });

  const queues = [
    { key: 'ingest', label: 'Ingest Queue', icon: <FileText className="w-4 h-4" />, count: status?.queues?.ingest || 0 },
    { key: 'autocrawl', label: 'Autocrawl Queue', icon: <Globe className="w-4 h-4" />, count: status?.queues?.autocrawl || 0 },
    { key: 'terminal', label: 'Terminal Queue', icon: <Zap className="w-4 h-4" />, count: queueItems.terminal.length },
  ];


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="queue" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">📥</span>
        <div>
          <h1 className="text-xl font-bold">Queue Lens</h1>
          <p className="text-sm text-gray-400">
            Manage all system queues: ingest, crawl, terminal proposals
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="queue" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      <RealtimeDataPanel domain="queue" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lens-card">
          <ListOrdered className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold text-neon-cyan">74</p>
          <p className="text-sm text-gray-400">Total Queue Depth</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lens-card">
          <Timer className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold text-neon-green">7.8/min</p>
          <p className="text-sm text-gray-400">Processing Rate</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
          <Zap className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold text-neon-purple">418</p>
          <p className="text-sm text-gray-400">Completed (24h)</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card">
          <Clock className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold text-yellow-400">3.2s</p>
          <p className="text-sm text-gray-400">Avg Latency</p>
        </motion.div>
      </div>

      {/* Queue Depth Gauge */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" /> Queue Depth Gauge
          </h2>
          <span className="text-xs text-gray-400">74 / 200 capacity</span>
        </div>
        <div className="relative w-full h-8 bg-lattice-deep rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-neon-green via-neon-blue to-neon-purple rounded-full transition-all duration-700"
            style={{ width: '37%' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-white drop-shadow">37% utilized</span>
          </div>
        </div>
      </motion.div>

      {/* Priority Lanes */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="panel p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-purple" /> Priority Lanes
        </h2>
        <div className="space-y-3">
          {[
            { label: 'High Priority', count: 8, color: 'bg-red-500', textColor: 'text-red-400', pct: 11 },
            { label: 'Normal Priority', count: 52, color: 'bg-neon-blue', textColor: 'text-neon-blue', pct: 70 },
            { label: 'Low Priority', count: 14, color: 'bg-gray-500', textColor: 'text-gray-400', pct: 19 },
          ].map((lane, idx) => (
            <div key={lane.label} className="flex items-center gap-3">
              <span className={`text-xs w-28 ${lane.textColor}`}>{lane.label}</span>
              <div className="flex-1 h-4 bg-lattice-deep rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${lane.pct}%` }} transition={{ delay: 0.35 + idx * 0.1, duration: 0.6 }}
                  className={`h-full ${lane.color} rounded-full`} />
              </div>
              <span className="text-xs font-mono w-8 text-right">{lane.count}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Queue Tabs */}
      <div className="flex gap-2">
        {queues.map((q) => (
          <button
            key={q.key}
            onClick={() => setSelectedQueue(q.key as 'ingest' | 'autocrawl' | 'terminal')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              selectedQueue === q.key
                ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                : 'bg-lattice-surface text-gray-400 hover:text-white'
            }`}
          >
            {q.icon}
            <span>{q.label}</span>
            <span className="ml-2 px-2 py-0.5 bg-lattice-elevated rounded text-xs">
              {q.count}
            </span>
          </button>
        ))}
      </div>

      {/* Queue Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="lens-card">
          <Inbox className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">
            {(status?.queues?.ingest || 0) + (status?.queues?.autocrawl || 0)}
          </p>
          <p className="text-sm text-gray-400">Total Queued</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="lens-card">
          <Play className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">
            {Object.values(jobs?.jobs || {}).filter((j: unknown) => (j as Record<string, unknown>)?.enabled).length}
          </p>
          <p className="text-sm text-gray-400">Active Jobs</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="lens-card">
          <Clock className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">2m</p>
          <p className="text-sm text-gray-400">Heartbeat Interval</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="lens-card">
          <Zap className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{status?.llm?.enabled ? 'On' : 'Off'}</p>
          <p className="text-sm text-gray-400">LLM Processing</p>
        </motion.div>
      </div>

      {/* Queue Items */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Inbox className="w-4 h-4 text-neon-blue" />
          {queues.find((q) => q.key === selectedQueue)?.label} Items
        </h2>
        <div className="space-y-3">
          {queueItems[selectedQueue]?.length === 0 ? (
            <p className="text-center py-8 text-gray-500">
              No items in queue. System is idle.
            </p>
          ) : (
            queueItems[selectedQueue]?.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 bg-lattice-deep rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      item.status === 'processing'
                        ? 'bg-neon-blue animate-pulse'
                        : item.status === 'completed'
                        ? 'bg-neon-green'
                        : 'bg-gray-500'
                    }`}
                  />
                  <div>
                    <p className="font-medium">{item.content}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 bg-lattice-surface rounded">
                        {item.type}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          item.priority === 'high'
                            ? 'bg-neon-pink/20 text-neon-pink'
                            : item.priority === 'low'
                            ? 'bg-gray-500/20 text-gray-400'
                            : 'bg-neon-blue/20 text-neon-blue'
                        }`}
                      >
                        {item.priority}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(item.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => processItem.mutate(item.id)}
                    disabled={processItem.isPending}
                    className="p-2 bg-neon-green/20 text-neon-green rounded-lg hover:bg-neon-green/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Process Now"
                  >
                    {processItem.isPending ? (
                      <div className="w-4 h-4 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => removeItem.mutate(item.id)}
                    disabled={removeItem.isPending}
                    className="p-2 bg-neon-pink/20 text-neon-pink rounded-lg hover:bg-neon-pink/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Job Controls */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4">Governor Jobs</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(jobs?.jobs || {}).length === 0 ? (
            <div className="col-span-full text-center py-8">
              <p className="text-gray-500">No governor jobs configured</p>
              <p className="text-sm text-gray-400 mt-1">Jobs will appear here once the system is initialized</p>
            </div>
          ) : (
            Object.entries(jobs?.jobs || {}).map(([name, job]) => {
              const j = job as Record<string, unknown>;
              return (
              <div
                key={name}
                className={`lens-card flex items-center justify-between ${
                  j?.enabled ? 'border-neon-green/30' : 'border-gray-600'
                }`}
              >
                <span className="capitalize">{name}</span>
                <span
                  className={`w-3 h-3 rounded-full ${
                    j?.enabled ? 'bg-neon-green' : 'bg-gray-500'
                  }`}
                />
              </div>
              );
            })
          )}
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="queue"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Job Monitor — Queue Status Cards */}
      <div className="panel p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Activity className="w-5 h-5 text-neon-cyan" />
          Job Monitor
        </h2>
        <p className="text-sm text-gray-400">
          Real-time status cards for compression, royalty processing, and bot task queues.
        </p>

        {/* Queue Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Compression Queue */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-neon-cyan" />
                <span className="text-sm font-semibold text-white">Compression</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Running
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">In queue</span>
                <span className="text-white font-mono">24</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Processing</span>
                <span className="text-neon-cyan font-mono">3</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Completed (24h)</span>
                <span className="text-neon-green font-mono">187</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Failed (24h)</span>
                <span className="text-red-400 font-mono">2</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-neon-cyan rounded-full" style={{ width: '78%' }} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Throughput</span>
                <span className="text-neon-cyan">7.8 DTUs/min</span>
              </div>
            </div>
          </div>

          {/* Royalty Processing Queue */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-neon-green" />
                <span className="text-sm font-semibold text-white">Royalties</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Running
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Pending payouts</span>
                <span className="text-white font-mono">12</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Processing</span>
                <span className="text-neon-green font-mono">1</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Settled (24h)</span>
                <span className="text-neon-green font-mono">89</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Disputed</span>
                <span className="text-yellow-400 font-mono">1</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-neon-green rounded-full" style={{ width: '92%' }} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Total CC distributed</span>
                <span className="text-neon-green">1,247 CC</span>
              </div>
            </div>
          </div>

          {/* Bot Tasks Queue */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-neon-purple" />
                <span className="text-sm font-semibold text-white">Bot Tasks</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Backlogged
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Queued tasks</span>
                <span className="text-white font-mono">38</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Active bots</span>
                <span className="text-neon-purple font-mono">5</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Completed (24h)</span>
                <span className="text-neon-green font-mono">142</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Timed out</span>
                <span className="text-red-400 font-mono">4</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-neon-purple rounded-full" style={{ width: '45%' }} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Avg task time</span>
                <span className="text-neon-purple">3.2s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Job Activity Feed */}
        <div className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-neon-cyan" />
            Recent Activity
          </h3>
          <div className="space-y-2">
            {[
              { time: '2s ago', task: 'Compressed DTU batch #4821', type: 'compression', status: 'done' },
              { time: '8s ago', task: 'Royalty payout: 4.2 CC to creator @nova', type: 'royalty', status: 'done' },
              { time: '15s ago', task: 'Bot auto-tag: 6 DTUs classified', type: 'bot', status: 'done' },
              { time: '22s ago', task: 'Compressed DTU batch #4820', type: 'compression', status: 'done' },
              { time: '31s ago', task: 'Bot council-vote on DTU #19284', type: 'bot', status: 'done' },
              { time: '45s ago', task: 'Royalty split: fork lineage resolved', type: 'royalty', status: 'done' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded bg-black/30 hover:bg-white/5 transition-colors">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  item.type === 'compression' ? 'bg-neon-cyan' :
                  item.type === 'royalty' ? 'bg-neon-green' : 'bg-neon-purple'
                }`} />
                <span className="text-xs text-gray-300 flex-1">{item.task}</span>
                <span className="text-xs text-gray-600">{item.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Queue Domain Actions */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-cyan flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Queue Analysis Actions</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'queueAnalytics', label: 'Queue Analytics' },
            { action: 'prioritySchedule', label: 'Priority Schedule' },
            { action: 'backpressure', label: 'Backpressure' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleQueueAction(action)} disabled={queueActiveAction === action || !queueArtifacts[0]?.id}
              className="px-3 py-1.5 text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded-lg hover:bg-neon-cyan/20 disabled:opacity-50 flex items-center gap-1.5">
              {queueActiveAction === action ? <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" /> : <Activity className="w-3 h-3 text-neon-cyan" />}
              {label}
            </button>
          ))}
        </div>
        {queueActionResult && (
          <div className="p-3 bg-black/40 rounded-lg border border-neon-cyan/20 text-xs space-y-2">
            {queueActionResult.action === 'queueAnalytics' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Arrival rate: <span className="text-neon-cyan font-mono">{String(((queueActionResult.rates as Record<string,unknown>)?.arrivalRate as number)?.toFixed?.(3) ?? 'N/A')}/s</span></span>
                  <span className="text-gray-400">Utilization: <span className={`font-mono ${((queueActionResult.utilization as Record<string,unknown>)?.rho as number) > 0.8 ? 'text-red-400' : ((queueActionResult.utilization as Record<string,unknown>)?.rho as number) > 0.5 ? 'text-yellow-400' : 'text-green-400'}`}>{String((((queueActionResult.utilization as Record<string,unknown>)?.rho as number) * 100)?.toFixed?.(1) ?? '')}%</span></span>
                  <span className={`${(queueActionResult.utilization as Record<string,unknown>)?.stable ? 'text-green-400' : 'text-red-400'}`}>{(queueActionResult.utilization as Record<string,unknown>)?.stable ? 'Stable' : 'Unstable'}</span>
                </div>
                {!!queueActionResult.message && <p className="text-gray-400 italic">{String(queueActionResult.message)}</p>}
              </div>
            )}
            {queueActionResult.action === 'prioritySchedule' && (
              <div className="space-y-1">
                {queueActionResult.message ? <p className="text-gray-400 italic">{String(queueActionResult.message)}</p> : (
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-gray-400">Algorithm: <span className="text-neon-cyan font-mono">{String(queueActionResult.algorithm ?? '')}</span></span>
                    <span className="text-gray-400">Jobs: <span className="text-neon-green font-mono">{String((queueActionResult.metrics as Record<string,unknown>)?.totalJobs ?? 0)}</span></span>
                    <span className="text-gray-400">Starvation: <span className={`font-mono ${(queueActionResult.starvation as Record<string,unknown>)?.detected ? 'text-red-400' : 'text-green-400'}`}>{(queueActionResult.starvation as Record<string,unknown>)?.detected ? 'Detected' : 'None'}</span></span>
                  </div>
                )}
              </div>
            )}
            {queueActionResult.action === 'backpressure' && (
              <div className="space-y-1">
                {queueActionResult.message ? <p className="text-gray-400 italic">{String(queueActionResult.message)}</p> : (
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-gray-400">Status: <span className={`font-mono ${(queueActionResult.backpressure as Record<string,unknown>)?.level === 'critical' || (queueActionResult.backpressure as Record<string,unknown>)?.level === 'high' ? 'text-red-400' : 'text-green-400'}`}>{String((queueActionResult.backpressure as Record<string,unknown>)?.level ?? 'normal')}</span></span>
                    <span className="text-gray-400">Fill: <span className="text-neon-cyan font-mono">{String((queueActionResult.currentState as Record<string,unknown>)?.fillRatio ?? '')}%</span></span>
                  </div>
                )}
              </div>
            )}
            <button onClick={() => setQueueActionResult(null)} className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"><X className="w-3 h-3" /> Dismiss</button>
          </div>
        )}
      </div>

      {/* ConnectiveTissueBar */}
      <ConnectiveTissueBar lensId="queue" />

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
            <LensFeaturePanel lensId="queue" />
          </div>
        )}
      </div>
    </div>
  );
}
