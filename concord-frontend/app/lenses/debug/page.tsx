'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import {
  Terminal,
  Eye,
  RefreshCw,
  Play,
  Database,
  Cpu,
  HardDrive,
  AlertTriangle,
  CheckCircle,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Zap,
  Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { InferenceTranscriptViewer } from '@/components/debug/InferenceTranscriptViewer';
import { SLODashboard } from '@/components/debug/SLODashboard';
import { ProvenanceDashboard } from '@/components/debug/ProvenanceDashboard';
import { ComputePanel } from '@/components/platform/ComputePanel';
import { LensTemplateGenerator } from '@/components/lens/LensTemplateGenerator';

type LogLevel = 'all' | 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

export default function DebugLensPage() {
  useLensNav('debug');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('debug');
  const [activeTab, setActiveTab] = useState<
    | 'status'
    | 'events'
    | 'test'
    | 'inspector'
    | 'context'
    | 'logs'
    | 'monitoring'
    | 'compute'
    | 'templates'
  >('status');

  // --- Domain action state ---
  const { items: debugItems } = useLensData('debug', 'debug', { seed: [] });
  const runAction = useRunArtifact('debug');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleDebugAction = useCallback(
    async (action: string) => {
      const targetId = debugItems[0]?.id;
      if (!targetId) return;
      setActiveAction(action);
      setActionResult(null);
      try {
        const res = await runAction.mutateAsync({ id: targetId, action });
        if (res.ok === false) {
          setActionResult({
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setActionResult(res.result as Record<string, unknown>);
        }
      } catch (e) {
        console.error(`Action ${action} failed:`, e);
        setActionResult({
          message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
      setActiveAction(null);
    },
    [debugItems, runAction]
  );
  const [debugOutput, setDebugOutput] = useState<string[]>([
    '$ concord debug',
    'Ready. Type command or click button above.',
  ]);
  const [customCmd, setCustomCmd] = useState('');
  const [logFilter, setLogFilter] = useState<LogLevel>('all');
  const [logSearch, setLogSearch] = useState('');
  const [inspectEntity, setInspectEntity] = useState('');
  const [inspectType, setInspectType] = useState('dtu');
  const [inspectResult, setInspectResult] = useState<unknown>(null);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugOutput]);

  const debugCmd = useMutation({
    mutationFn: async (cmd: string) => {
      setDebugOutput((prev) => [...prev, `$ ${cmd}...`]);
      if (cmd === 'tick') return apiHelpers.bridge.heartbeatTick();
      if (cmd === 'organs') return apiHelpers.guidance.health();
      if (cmd === 'invariants') return apiHelpers.emergent.status();
      if (cmd === 'growth') return apiHelpers.pipeline.metrics();
      if (cmd === 'db-status') return apiHelpers.db.status();
      if (cmd === 'redis-stats') return apiHelpers.redis.stats();
      if (cmd === 'perf') return apiHelpers.perf.metrics();
      if (cmd === 'backpressure') return apiHelpers.backpressure.status();
      if (cmd === 'gc') return apiHelpers.perf.gc();
      return api.get('/api/status');
    },
    onSuccess: (res) =>
      setDebugOutput((prev) => [...prev, JSON.stringify(res.data, null, 2).slice(0, 800)]),
    onError: (err) =>
      setDebugOutput((prev) => [
        ...prev,
        `Error: ${err instanceof Error ? err.message : 'Unknown'}`,
      ]),
  });

  const inspectMutation = useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      return apiHelpers.guidance.inspect(type, id);
    },
    onSuccess: (res) => setInspectResult(res.data),
    onError: (err) =>
      setInspectResult({ error: err instanceof Error ? err.message : 'Inspect failed' }),
  });

  // Backend: GET /api/status
  const {
    data: status,
    isLoading,
    refetch: refetchStatus,
    isError,
    error,
  } = useQuery({
    queryKey: ['status'],
    queryFn: () => api.get('/api/status').then((r) => r.data),
  });

  // Backend: GET /api/events
  const {
    data: events,
    refetch: refetchEvents,
    isError: isError2,
    error: error2,
  } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/api/events').then((r) => r.data),
  });

  // Backend: GET /api/jobs/status
  const {
    data: jobs,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery({
    queryKey: ['jobs-status'],
    queryFn: () => api.get('/api/jobs/status').then((r) => r.data),
  });

  // Backend: GET /api/db/status
  const { data: dbStatus } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => apiHelpers.db.status().then((r) => r.data),
  });

  // Backend: GET /api/perf/metrics
  const { data: perfMetrics } = useQuery({
    queryKey: ['perf-metrics'],
    queryFn: () => apiHelpers.perf.metrics().then((r) => r.data),
    refetchInterval: 15000,
  });

  const handleCustomCmd = useCallback(() => {
    if (!customCmd.trim()) return;
    debugCmd.mutate(customCmd.trim());
    setCustomCmd('');
  }, [customCmd, debugCmd]);

  const clearConsole = () => {
    setDebugOutput(['$ concord debug', 'Console cleared.']);
  };

  const copyConsole = () => {
    navigator.clipboard?.writeText(debugOutput.join('\n'));
  };

  const toggleEventExpand = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build log entries from events
  const logEntries: LogEntry[] = (events?.events || []).map((e: Record<string, unknown>) => ({
    timestamp: String(e.at || e.timestamp || ''),
    level: String(e.type || '').includes('error')
      ? 'error'
      : String(e.type || '').includes('warn')
        ? 'warn'
        : 'info',
    message: `[${String(e.type)}] ${JSON.stringify(e.payload || {}).slice(0, 200)}`,
    source: String(e.source || e.type || 'system'),
  }));

  const filteredLogs = logEntries.filter((log) => {
    if (logFilter !== 'all' && log.level !== logFilter) return false;
    if (logSearch && !log.message.toLowerCase().includes(logSearch.toLowerCase())) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading debug data...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => {
            refetchStatus();
            refetchEvents();
            refetch3();
          }}
        />
      </div>
    );
  }

  return (
    <div data-lens-theme="debug" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐛</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Debug Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">System state, organs, events, and diagnostics</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="debug" data={{}} compact />
          <button
            onClick={() => {
              refetchStatus();
              refetchEvents();
              refetch3();
            }}
            className="btn-neon"
          >
            <RefreshCw className="w-4 h-4 mr-2 inline" />
            Refresh All
          </button>
        </div>
      </header>

      <RealtimeDataPanel
        domain="debug"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />

      {/* Quick Health Indicators */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'System',
            status: (status?.ok ? 'ok' : 'error') as 'ok' | 'warn' | 'error',
            detail: status?.version || 'unknown',
          },
          {
            label: 'Database',
            status: (dbStatus?.ok !== false ? 'ok' : 'error') as 'ok' | 'warn' | 'error',
            detail: dbStatus?.engine || 'checking',
          },
          {
            label: 'Jobs',
            status: (jobs?.active !== undefined ? 'ok' : 'warn') as 'ok' | 'warn' | 'error',
            detail: `${jobs?.active || 0} active`,
          },
          {
            label: 'Memory',
            status: 'ok' as const,
            detail: perfMetrics?.memory
              ? `${Math.round((perfMetrics.memory.heapUsed || 0) / 1024 / 1024)}MB`
              : 'N/A',
          },
        ].map((card, i) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <HealthCard label={card.label} status={card.status} detail={card.detail} />
          </motion.div>
        ))}
      </div>

      {/* Log Level Badges */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex items-center gap-2 flex-wrap"
      >
        <Terminal className="w-3.5 h-3.5 text-gray-500" />
        {[
          {
            level: 'INFO',
            color: 'bg-neon-blue/15 text-neon-blue border-neon-blue/30',
            count: logEntries.filter((l) => l.level === 'info').length,
          },
          {
            level: 'WARN',
            color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
            count: logEntries.filter((l) => l.level === 'warn').length,
          },
          {
            level: 'ERROR',
            color: 'bg-red-500/15 text-red-400 border-red-500/30',
            count: logEntries.filter((l) => l.level === 'error').length,
          },
          {
            level: 'DEBUG',
            color: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
            count: logEntries.filter((l) => l.level === 'debug').length,
          },
        ].map((badge) => (
          <span
            key={badge.level}
            className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.color} font-mono`}
          >
            {badge.level}{' '}
            {badge.count > 0 && <span className="ml-1 opacity-70">{badge.count}</span>}
          </span>
        ))}
      </motion.div>

      {/* ── Domain Action Panel ─────────────────────────────────── */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-cyan" /> AI Debug Analysis
        </h3>
        <div className="flex flex-wrap gap-2">
          {(
            ['logAnalysis', 'errorCluster', 'performanceProfile', 'stackTraceAnalysis'] as const
          ).map((action) => (
            <button
              key={action}
              onClick={() => handleDebugAction(action)}
              disabled={activeAction !== null || !debugItems[0]?.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-50 transition-colors"
            >
              {activeAction === action ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              {action === 'logAnalysis'
                ? 'Log Analysis'
                : action === 'errorCluster'
                  ? 'Error Cluster'
                  : action === 'performanceProfile'
                    ? 'Perf Profile'
                    : 'Stack Trace'}
            </button>
          ))}
        </div>

        {/* logAnalysis result */}
        {actionResult &&
          actionResult.totalLogs !== undefined &&
          actionResult.logsPerSecond !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(actionResult.totalLogs)}
                  </p>
                  <p className="text-[10px] text-gray-500">Total Logs</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.errorRate) > 10 ? 'text-red-400' : Number(actionResult.errorRate) > 5 ? 'text-yellow-400' : 'text-neon-green'}`}
                  >
                    {String(actionResult.errorRate)}%
                  </p>
                  <p className="text-[10px] text-gray-500">Error Rate</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-purple">
                    {String(actionResult.logsPerSecond)}
                  </p>
                  <p className="text-[10px] text-gray-500">Logs/sec</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-yellow-400">
                    {Array.isArray(actionResult.topPatterns)
                      ? (actionResult.topPatterns as unknown[]).length
                      : 0}
                  </p>
                  <p className="text-[10px] text-gray-500">Patterns</p>
                </div>
              </div>
              {!!actionResult.levelDistribution && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Level Distribution
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(actionResult.levelDistribution as Record<string, number>).map(
                      ([level, count]) => (
                        <span
                          key={level}
                          className={`px-2 py-0.5 text-[10px] rounded border font-mono ${
                            level === 'error' || level === 'fatal'
                              ? 'bg-red-400/10 border-red-400/30 text-red-400'
                              : level === 'warn'
                                ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400'
                                : 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                          }`}
                        >
                          {level.toUpperCase()}: {count}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}
              {Array.isArray(actionResult.sourceHotspots) &&
                (
                  actionResult.sourceHotspots as Array<{
                    source: string;
                    errors: number;
                    errorRate: number;
                  }>
                ).length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Error Hotspots
                    </p>
                    <div className="space-y-1">
                      {(
                        actionResult.sourceHotspots as Array<{
                          source: string;
                          errors: number;
                          errorRate: number;
                        }>
                      )
                        .slice(0, 5)
                        .map((s, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-gray-300 font-mono flex-1 truncate">
                              {s.source}
                            </span>
                            <span className="text-red-400">{s.errors} errors</span>
                            <span className="text-gray-500">{s.errorRate}%</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              {Array.isArray(actionResult.spikes) &&
                (actionResult.spikes as unknown[]).length > 0 && (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />{' '}
                    {(actionResult.spikes as unknown[]).length} error spike(s) detected
                  </p>
                )}
            </div>
          )}

        {/* errorCluster result */}
        {actionResult &&
          actionResult.uniqueClusters !== undefined &&
          actionResult.deduplicationRatio !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(actionResult.totalErrors)}
                  </p>
                  <p className="text-[10px] text-gray-500">Total Errors</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-purple">
                    {String(actionResult.uniqueClusters)}
                  </p>
                  <p className="text-[10px] text-gray-500">Clusters</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-green">
                    {String(actionResult.deduplicationRatio)}%
                  </p>
                  <p className="text-[10px] text-gray-500">Dedup Ratio</p>
                </div>
              </div>
              {Array.isArray(actionResult.clusters) && (
                <div className="space-y-2">
                  {(
                    actionResult.clusters as Array<{
                      representative: string;
                      memberCount: number;
                      totalOccurrences: number;
                      severity: string;
                      sources: string[];
                      commonFrame: string | null;
                    }>
                  )
                    .slice(0, 5)
                    .map((cluster, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded border text-xs ${
                          cluster.severity === 'critical'
                            ? 'border-red-400/30 bg-red-400/5'
                            : cluster.severity === 'high'
                              ? 'border-orange-400/30 bg-orange-400/5'
                              : 'border-white/5 bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cluster.severity === 'critical' ? 'bg-red-400/20 text-red-400' : cluster.severity === 'high' ? 'bg-orange-400/20 text-orange-400' : 'bg-gray-400/20 text-gray-400'}`}
                          >
                            {cluster.severity}
                          </span>
                          <span className="text-gray-500">
                            {cluster.totalOccurrences} occurrences
                          </span>
                        </div>
                        <p className="text-gray-300 font-mono truncate">{cluster.representative}</p>
                        {cluster.commonFrame && (
                          <p className="text-gray-500 font-mono text-[10px] mt-0.5 truncate">
                            {cluster.commonFrame}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

        {/* performanceProfile result */}
        {actionResult &&
          actionResult.totalDurationMs !== undefined &&
          actionResult.uniqueOperations !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(actionResult.totalTraces)}
                  </p>
                  <p className="text-[10px] text-gray-500">Traces</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-yellow-400">
                    {String(actionResult.totalDurationMs)}ms
                  </p>
                  <p className="text-[10px] text-gray-500">Total Time</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-purple">
                    {String(actionResult.uniqueOperations)}
                  </p>
                  <p className="text-[10px] text-gray-500">Operations</p>
                </div>
              </div>
              {Array.isArray(actionResult.hotPath) &&
                (actionResult.hotPath as string[]).length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                      Hot Path
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.hotPath as string[]).map((p, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 text-[10px] rounded bg-orange-400/10 border border-orange-400/30 text-orange-400 font-mono"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              {Array.isArray(actionResult.bottlenecks) && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Bottlenecks
                  </p>
                  {(
                    actionResult.bottlenecks as Array<{
                      name: string;
                      selfTimeMs: number;
                      percentSelfTime: number;
                    }>
                  )
                    .slice(0, 5)
                    .map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs mb-1">
                        <span className="text-gray-300 font-mono flex-1 truncate">{b.name}</span>
                        <span className="text-red-400">{b.selfTimeMs}ms</span>
                        <span className="text-gray-500">{b.percentSelfTime}%</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

        {/* stackTraceAnalysis result */}
        {actionResult && actionResult.rootCauseCandidates !== undefined && (
          <div className="space-y-3 pt-2 border-t border-white/5">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-cyan">
                  {String(actionResult.totalTraces)}
                </p>
                <p className="text-[10px] text-gray-500">Traces</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-yellow-400">
                  {String(
                    (actionResult.userVsLibrary as Record<string, number>)?.avgUserFrames ?? 0
                  )}
                </p>
                <p className="text-[10px] text-gray-500">Avg User Frames</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-lg font-bold text-neon-purple">
                  {String(
                    (actionResult.userVsLibrary as Record<string, number>)?.avgLibraryFrames ?? 0
                  )}
                </p>
                <p className="text-[10px] text-gray-500">Avg Lib Frames</p>
              </div>
            </div>
            {!!actionResult.errorTypeDistribution && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                  Error Types
                </p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(actionResult.errorTypeDistribution as Record<string, number>).map(
                    ([type, count]) => (
                      <span
                        key={type}
                        className="px-2 py-0.5 text-[10px] rounded bg-red-400/10 border border-red-400/30 text-red-400 font-mono"
                      >
                        {type}: {count}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}
            {Array.isArray(actionResult.rootCauseCandidates) &&
              (
                actionResult.rootCauseCandidates as Array<{
                  location: string;
                  count: number;
                  errors: string[];
                }>
              ).length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Root Cause Candidates
                  </p>
                  {(
                    actionResult.rootCauseCandidates as Array<{
                      location: string;
                      count: number;
                      errors: string[];
                    }>
                  ).map((rc, i) => (
                    <div
                      key={i}
                      className="p-2 bg-red-400/5 border border-red-400/20 rounded text-xs mb-1"
                    >
                      <p className="text-red-300 font-mono text-[10px] truncate">{rc.location}</p>
                      <p className="text-gray-500">{rc.count} occurrences</p>
                    </div>
                  ))}
                </div>
              )}
            {Array.isArray(actionResult.commonFrames) &&
              (
                actionResult.commonFrames as Array<{
                  frame: string;
                  occurrences: number;
                  percentage: number;
                }>
              ).length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                    Common Frames
                  </p>
                  {(
                    actionResult.commonFrames as Array<{
                      frame: string;
                      occurrences: number;
                      percentage: number;
                    }>
                  )
                    .slice(0, 4)
                    .map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs mb-1">
                        <span className="text-gray-300 font-mono flex-1 truncate">{f.frame}</span>
                        <span className="text-neon-cyan">{f.occurrences}x</span>
                        <span className="text-gray-500">{f.percentage}%</span>
                      </div>
                    ))}
                </div>
              )}
          </div>
        )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap no-scrollbar">
        {(
          [
            'status',
            'events',
            'logs',
            'inspector',
            'context',
            'test',
            'monitoring',
            'compute',
            'templates',
          ] as const
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg capitalize text-sm whitespace-nowrap ${
              activeTab === tab
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                : 'bg-lattice-surface text-gray-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'status' && (
        <div className="space-y-4">
          {/* System Status */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Database className="w-4 h-4 text-neon-blue" />
              System Status
            </h2>
            <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-96 text-sm font-mono text-gray-300">
              {JSON.stringify(status, null, 2)}
            </pre>
          </div>

          {/* Performance Metrics */}
          {perfMetrics && (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-neon-cyan" />
                Performance Metrics
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                {perfMetrics.uptime && (
                  <div className="bg-lattice-deep p-3 rounded-lg">
                    <p className="text-xs text-gray-500">Uptime</p>
                    <p className="text-lg font-mono text-neon-green">
                      {formatUptime(perfMetrics.uptime)}
                    </p>
                  </div>
                )}
                {perfMetrics.memory?.heapUsed && (
                  <div className="bg-lattice-deep p-3 rounded-lg">
                    <p className="text-xs text-gray-500">Heap Used</p>
                    <p className="text-lg font-mono text-neon-blue">
                      {Math.round(perfMetrics.memory.heapUsed / 1024 / 1024)}MB
                    </p>
                  </div>
                )}
                {perfMetrics.memory?.heapTotal && (
                  <div className="bg-lattice-deep p-3 rounded-lg">
                    <p className="text-xs text-gray-500">Heap Total</p>
                    <p className="text-lg font-mono text-gray-300">
                      {Math.round(perfMetrics.memory.heapTotal / 1024 / 1024)}MB
                    </p>
                  </div>
                )}
              </div>
              <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-48 text-xs font-mono text-gray-400">
                {JSON.stringify(perfMetrics, null, 2)}
              </pre>
            </div>
          )}

          {/* Jobs Status */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Play className="w-4 h-4 text-neon-green" />
              Jobs Status
            </h2>
            <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-60 text-sm font-mono text-gray-300">
              {JSON.stringify(jobs, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Eye className="w-4 h-4 text-neon-cyan" />
            Recent Events ({events?.events?.length || 0})
          </h2>
          <div className="space-y-2 max-h-[600px] overflow-auto">
            {(events?.events || []).length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Eye className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No events recorded yet</p>
              </div>
            ) : (
              (events?.events || [])
                .slice(0, 100)
                .map((event: Record<string, unknown>, idx: number) => {
                  const id = (event.id as string) || `evt-${idx}`;
                  const isExpanded = expandedEvents.has(id);
                  return (
                    <div
                      key={id}
                      className="bg-lattice-deep rounded-lg border border-lattice-border"
                    >
                      <button
                        onClick={() => toggleEventExpand(id)}
                        className="flex items-center justify-between p-3 w-full text-left"
                      >
                        <div className="flex items-center gap-3">
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-gray-500" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-gray-500" />
                          )}
                          <span
                            className={`font-mono text-sm ${
                              String(event.type).includes('error')
                                ? 'text-red-400'
                                : String(event.type).includes('created')
                                  ? 'text-neon-green'
                                  : 'text-neon-purple'
                            }`}
                          >
                            {String(event.type)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {String(event.at || event.timestamp || '')}
                          </span>
                        </div>
                      </button>
                      {isExpanded && (
                        <pre className="px-3 pb-3 text-xs text-gray-400 overflow-auto max-h-48 border-t border-lattice-border pt-2 mx-3">
                          {JSON.stringify(event.payload || event, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Terminal className="w-4 h-4 text-neon-green" />
              System Logs ({filteredLogs.length})
            </h2>
            <div className="flex items-center gap-2">
              <select
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value as LogLevel)}
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs"
              >
                <option value="all">All Levels</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
                <option value="debug">Debug</option>
              </select>
            </div>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              className="w-full pl-10 pr-8 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none"
              placeholder="Filter logs..."
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
            />
            {logSearch && (
              <button
                onClick={() => setLogSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="bg-lattice-void rounded-lg overflow-auto max-h-[500px] font-mono text-xs">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Terminal className="w-8 h-8 mx-auto mb-3 opacity-40" />
                <p>No matching log entries</p>
              </div>
            ) : (
              filteredLogs.map((log, i) => (
                <div
                  key={i}
                  className={`flex gap-3 px-3 py-1.5 border-b border-lattice-border/30 hover:bg-lattice-surface/30 ${
                    log.level === 'error'
                      ? 'bg-red-500/5'
                      : log.level === 'warn'
                        ? 'bg-yellow-500/5'
                        : ''
                  }`}
                >
                  <span className="text-gray-600 shrink-0 w-20">
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '--:--:--'}
                  </span>
                  <span
                    className={`shrink-0 w-12 uppercase ${
                      log.level === 'error'
                        ? 'text-red-400'
                        : log.level === 'warn'
                          ? 'text-yellow-400'
                          : log.level === 'debug'
                            ? 'text-gray-500'
                            : 'text-neon-blue'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-gray-300 break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'inspector' && (
        <div className="panel p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-neon-blue" />
            Object Inspector
          </h2>
          <div className="flex gap-3">
            <select
              className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
              value={inspectType}
              onChange={(e) => setInspectType(e.target.value)}
            >
              <option value="dtu">DTU</option>
              <option value="artifact">Artifact</option>
              <option value="job">Job</option>
              <option value="listing">Listing</option>
            </select>
            <input
              className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-blue outline-none font-mono"
              placeholder="Enter entity ID..."
              value={inspectEntity}
              onChange={(e) => setInspectEntity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inspectEntity.trim()) {
                  inspectMutation.mutate({ type: inspectType, id: inspectEntity.trim() });
                }
              }}
            />
            <button
              className="btn-neon text-sm"
              disabled={!inspectEntity.trim() || inspectMutation.isPending}
              onClick={() =>
                inspectMutation.mutate({ type: inspectType, id: inspectEntity.trim() })
              }
            >
              {inspectMutation.isPending ? 'Inspecting...' : 'Inspect'}
            </button>
          </div>
          {inspectResult != null && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-300">Result</h3>
                <button
                  onClick={() =>
                    navigator.clipboard?.writeText(JSON.stringify(inspectResult, null, 2))
                  }
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-[400px] text-xs font-mono text-gray-300">
                {JSON.stringify(inspectResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {activeTab === 'context' && <ContextInspectorPanel />}

      {activeTab === 'monitoring' && (
        <div className="space-y-6">
          <div className="panel p-4">
            <InferenceTranscriptViewer />
          </div>
          <div className="panel p-4">
            <SLODashboard />
          </div>
          <div className="panel p-4">
            <ProvenanceDashboard />
          </div>
        </div>
      )}

      {activeTab === 'compute' && (
        <div className="panel p-4">
          <ComputePanel />
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="panel p-4">
          <LensTemplateGenerator />
        </div>
      )}

      {activeTab === 'test' && (
        <div className="panel p-4">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-neon-green" />
            Test Console
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <CmdButton
                label="Tick Kernel"
                color="neon-green"
                onClick={() => debugCmd.mutate('tick')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="Check Organs"
                color="neon-blue"
                onClick={() => debugCmd.mutate('organs')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="Verify Invariants"
                color="neon-purple"
                onClick={() => debugCmd.mutate('invariants')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="Sim Growth"
                color="neon-cyan"
                onClick={() => debugCmd.mutate('growth')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="DB Status"
                color="neon-blue"
                onClick={() => debugCmd.mutate('db-status')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="Redis Stats"
                color="neon-pink"
                onClick={() => debugCmd.mutate('redis-stats')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="Perf Metrics"
                color="neon-cyan"
                onClick={() => debugCmd.mutate('perf')}
                disabled={debugCmd.isPending}
              />
              <CmdButton
                label="Run GC"
                color="neon-green"
                onClick={() => debugCmd.mutate('gc')}
                disabled={debugCmd.isPending}
              />
            </div>

            {/* Custom Command */}
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-mono focus:border-neon-green outline-none"
                placeholder="Enter custom endpoint (e.g., 'status')..."
                value={customCmd}
                onChange={(e) => setCustomCmd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomCmd();
                }}
              />
              <button
                className="btn-neon text-sm"
                disabled={!customCmd.trim() || debugCmd.isPending}
                onClick={handleCustomCmd}
              >
                Run
              </button>
            </div>

            {/* Console Output */}
            <div className="relative">
              <div className="absolute top-2 right-2 flex gap-1 z-10">
                <button
                  onClick={copyConsole}
                  className="p-1 text-gray-500 hover:text-white"
                  title="Copy"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <button
                  onClick={clearConsole}
                  className="p-1 text-gray-500 hover:text-white"
                  title="Clear"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="bg-lattice-void p-4 rounded-lg h-64 font-mono text-sm text-gray-400 overflow-y-auto">
                {debugOutput.map((line, i) => (
                  <p
                    key={i}
                    className={
                      line.startsWith('$')
                        ? 'text-neon-green'
                        : line.startsWith('Error')
                          ? 'text-red-400'
                          : ''
                    }
                  >
                    {line}
                  </p>
                ))}
                <p className="animate-pulse">_</p>
                <div ref={consoleEndRef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Context Inspector Panel (Feature 48) ─────────────────────────────────

function ContextInspectorPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['context-inspector'],
    queryFn: () =>
      api
        .get('/api/context/inspector')
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="panel p-4 text-center text-gray-500 text-sm">
        Loading context engine state...
      </div>
    );
  }

  const ws = data?.workingSet;
  const pinned = data?.pinnedDtus || [];
  const coPatterns = data?.coActivationPatterns || [];
  const userProfiles = data?.userProfiles || [];
  const engine = data?.engine || {};
  const metrics = data?.metrics || {};

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Eye className="w-4 h-4 text-neon-cyan" />
          Context Inspector
        </h2>
        <button onClick={() => refetch()} className="text-xs text-neon-cyan hover:underline">
          Refresh
        </button>
      </div>

      {/* Working Set Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-500">Working Set Size</p>
          <p className="text-lg font-mono text-neon-blue">{ws?.totalSize ?? 0}</p>
        </div>
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-500">Active Sessions</p>
          <p className="text-lg font-mono text-neon-green">{engine.activeSessions ?? 0}</p>
        </div>
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-500">User Profiles</p>
          <p className="text-lg font-mono text-neon-purple">{engine.userProfileCount ?? 0}</p>
        </div>
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-500">Queries Processed</p>
          <p className="text-lg font-mono text-gray-300">{metrics.queriesProcessed ?? 0}</p>
        </div>
      </div>

      {/* Pinned DTUs */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">
          Pinned DTUs ({pinned.length})
        </p>
        {pinned.length === 0 ? (
          <p className="text-xs text-gray-600">No pinned DTUs in active sessions</p>
        ) : (
          <div className="max-h-32 overflow-y-auto space-y-1">
            {pinned.map(
              (p: { dtuId: string; title: string; score: number; session: string }, i: number) => (
                <div
                  key={`${p.dtuId}-${i}`}
                  className="flex items-center gap-2 text-xs bg-lattice-deep rounded p-2 border border-lattice-border"
                >
                  <Database className="w-3 h-3 text-neon-cyan shrink-0" />
                  <span className="text-white truncate flex-1">{p.title}</span>
                  <span className="text-gray-500 font-mono shrink-0">{p.score}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Co-Activation Patterns */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">
          Co-Activation Patterns ({coPatterns.length})
        </p>
        {coPatterns.length === 0 ? (
          <p className="text-xs text-gray-600">No active co-activation tracking</p>
        ) : (
          <div className="max-h-32 overflow-y-auto space-y-1">
            {coPatterns.map(
              (cp: { sessionId: string; trackedDtus: number; queryCount: number }, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs bg-lattice-deep rounded p-2 border border-lattice-border"
                >
                  <span className="text-gray-300 font-mono truncate">
                    {cp.sessionId.slice(0, 20)}
                  </span>
                  <span className="text-gray-500">
                    {cp.trackedDtus} DTUs / {cp.queryCount} queries
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* User Profile Weights */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">
          User Profile Weights ({userProfiles.length})
        </p>
        {userProfiles.length === 0 ? (
          <p className="text-xs text-gray-600">No user profiles tracked yet</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-2">
            {userProfiles.map(
              (
                up: {
                  userId: string;
                  topDtuCount: number;
                  sessionCount: number;
                  lastSession: string;
                  topDtus: Array<{ dtuId: string; frequency: number; title: string }>;
                },
                i: number
              ) => (
                <div
                  key={i}
                  className="bg-lattice-deep rounded-lg p-2 border border-lattice-border"
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-300 font-mono">{up.userId.slice(0, 20)}</span>
                    <span className="text-gray-500">{up.sessionCount} sessions</span>
                  </div>
                  {up.topDtus.length > 0 && (
                    <div className="space-y-0.5">
                      {up.topDtus.map((td, j) => (
                        <div key={j} className="flex items-center gap-2 text-[10px]">
                          <span className="text-gray-400 truncate flex-1">{td.title}</span>
                          <span className="text-gray-600 font-mono shrink-0">{td.frequency}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Engine Metrics Summary */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">Engine Metrics</p>
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-500">Co-activation edges proposed: </span>
            <span className="text-white font-mono">{metrics.coActivationEdgesProposed ?? 0}</span>
          </div>
          <div>
            <span className="text-gray-500">Profile seeds: </span>
            <span className="text-white font-mono">{metrics.profileSeeds ?? 0}</span>
          </div>
          <div>
            <span className="text-gray-500">Panel queries: </span>
            <span className="text-white font-mono">{metrics.contextPanelQueries ?? 0}</span>
          </div>
          <div>
            <span className="text-gray-500">Shadow DTUs: </span>
            <span className="text-white font-mono">{engine.shadowDtuCount ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HealthCard({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}) {
  const colors = {
    ok: 'text-neon-green border-neon-green/20',
    warn: 'text-yellow-400 border-yellow-400/20',
    error: 'text-red-400 border-red-400/20',
  };
  const icons = {
    ok: <CheckCircle className="w-4 h-4" />,
    warn: <AlertTriangle className="w-4 h-4" />,
    error: <AlertTriangle className="w-4 h-4" />,
  };
  return (
    <div className={`lens-card border ${colors[status]}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <span className={colors[status]}>{icons[status]}</span>
      </div>
      <p className="text-xs text-gray-500 font-mono">{detail}</p>
    </div>
  );
}

function CmdButton({
  label,
  color,
  onClick,
  disabled,
}: {
  label: string;
  color: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`lens-card text-center hover:border-${color} transition-colors disabled:opacity-50`}
    >
      <p className="text-sm font-medium">{label}</p>
    </button>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}
