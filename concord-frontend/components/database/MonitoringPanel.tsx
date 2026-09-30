'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Cpu, Play, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';
import { formatUptime, MetricCard, MiniBarChart, type PerfSnapshot } from './db-utils';

export function MonitoringPanel() {
  const [perfHistory, setPerfHistory] = useState<PerfSnapshot[]>([]);

  const { data: dbStatus } = useQuery({
    queryKey: ['db-status'],
    queryFn: () => api.get('/api/db/status').then(r => r.data),
    refetchInterval: 10000,
  });
  const { data: perfMetrics } = useQuery({
    queryKey: ['perf-metrics'],
    queryFn: () => api.get('/api/perf/metrics').then(r => r.data),
    refetchInterval: 5000,
  });
  const { data: backpressure } = useQuery({
    queryKey: ['backpressure'],
    queryFn: () => api.get('/api/backpressure/status').then(r => r.data),
  });

  useEffect(() => {
    if (!perfMetrics) return;
    setPerfHistory(prev => {
      const next: PerfSnapshot = {
        timestamp: Date.now(),
        heapUsed: perfMetrics.memory?.heapUsed ?? 0,
        queryRate: perfMetrics.queryRate ?? 0,
        cacheHitRate: perfMetrics.cache?.hitRate ?? 0,
        activeConns: perfMetrics.connections?.active ?? 0,
      };
      const updated = [...prev, next];
      return updated.length > 30 ? updated.slice(-30) : updated;
    });
  }, [perfMetrics]);

  const migrateMutation = useMutation({
    mutationFn: () => api.post('/api/db/migrate', {}),
    onError: (err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post('/api/db/sync', { batchSize: 100 }),
    onError: (err) => {
      console.error('Sync failed:', err instanceof Error ? err.message : err);
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MiniBarChart data={perfHistory.map(p => p.heapUsed)} label="Heap Used (MB)" color="bg-neon-cyan" />
        <MiniBarChart data={perfHistory.map(p => p.queryRate)} label="Query Rate (q/s)" color="bg-neon-green" />
        <MiniBarChart data={perfHistory.map(p => p.cacheHitRate)} label="Cache Hit Rate (%)" color="bg-neon-purple" />
        <MiniBarChart data={perfHistory.map(p => p.activeConns)} label="Active Connections" color="bg-neon-orange" />
      </div>

      <div className="panel p-4">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-neon-cyan" />
          Performance Metrics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Heap Used" value={`${perfMetrics?.memory?.heapUsed || 0} MB`} />
          <MetricCard label="Heap Total" value={`${perfMetrics?.memory?.heapTotal || 0} MB`} />
          <MetricCard label="RSS" value={`${perfMetrics?.memory?.rss || 0} MB`} />
          <MetricCard label="Uptime" value={formatUptime(perfMetrics?.uptime)} />
          <MetricCard label="DTUs" value={perfMetrics?.dtus?.total || 0} />
          <MetricCard label="Shadow DTUs" value={perfMetrics?.dtus?.shadow || 0} />
          <MetricCard label="Cache Size" value={perfMetrics?.cache?.hot || 0} />
          <MetricCard label="Graph Nodes" value={perfMetrics?.graph?.nodes || 0} />
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="text-lg font-semibold mb-4">System Load</h2>
        <div className="flex items-center gap-4">
          <div className={`px-4 py-2 rounded-lg font-bold text-sm ${
            backpressure?.level === 'normal' ? 'bg-green-500/20 text-green-400' :
            backpressure?.level === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {backpressure?.level?.toUpperCase() || 'NORMAL'}
          </div>
          <div className="text-sm text-gray-400">
            {backpressure?.dtuCount || 0} DTUs
            (Warning: {backpressure?.thresholds?.warning}, Critical: {backpressure?.thresholds?.critical})
          </div>
        </div>
        {backpressure?.recommendations?.length > 0 && (
          <div className="mt-3">
            <p className="text-sm text-yellow-400 mb-1">Recommendations:</p>
            <ul className="text-sm text-gray-400 list-disc list-inside">
              {backpressure.recommendations.map((rec: string, i: number) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="text-lg font-semibold mb-4">Database Actions</h2>
        <div className="flex gap-4 flex-wrap">
          <button
            onClick={() => migrateMutation.mutate()}
            disabled={migrateMutation.isPending || !dbStatus?.postgres?.connected}
            className="btn-neon flex items-center gap-2 text-sm"
          >
            <Play className="w-4 h-4" />
            {migrateMutation.isPending ? 'Running Migrations...' : 'Run Migrations'}
          </button>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !dbStatus?.postgres?.connected}
            className="btn-neon flex items-center gap-2 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            {syncMutation.isPending ? 'Syncing...' : 'Sync to PostgreSQL'}
          </button>
        </div>
        {migrateMutation.data && (
          <p className="mt-2 text-sm text-green-400">
            Migrations complete: {(migrateMutation.data as { data?: { applied?: number; total?: number } }).data?.applied}/{(migrateMutation.data as { data?: { applied?: number; total?: number } }).data?.total}
          </p>
        )}
        {syncMutation.data && (
          <p className="mt-2 text-sm text-green-400">
            Synced: {(syncMutation.data as { data?: { synced?: number; total?: number } }).data?.synced}/{(syncMutation.data as { data?: { synced?: number; total?: number } }).data?.total} DTUs
          </p>
        )}
      </div>
    </div>
  );
}
