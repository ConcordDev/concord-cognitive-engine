'use client';

/**
 * MonitoringPanel — Real-time system monitoring for the Admin lens.
 *
 * Displays:
 * - Request rate, error rate, latency P95 (from /metrics and /api/status)
 * - LLM queue depth, memory usage
 * - Circuit breaker states
 *
 * Uses auto-refreshing queries and simple bar/spark visualizations.
 * Admin-only visibility (rendered inside admin lens).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Activity, Cpu, Zap, AlertTriangle, CheckCircle, BarChart3,
  RefreshCw, Server, Gauge
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface MetricEntry {
  name: string;
  value: number;
  labels?: Record<string, string>;
}

interface CircuitBreakerState {
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  totalCalls: number;
  totalFailures: number;
}

// ── Prometheus text parser ─────────────────────────────────────────────────

function parsePrometheusText(text: string): MetricEntry[] {
  const entries: MetricEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    // Format: metric_name{label="val"} 123
    const match = line.match(/^(\w+)(\{([^}]*)\})?\s+(.+)$/);
    if (match) {
      const labels: Record<string, string> = {};
      if (match[3]) {
        for (const pair of match[3].split(',')) {
          const [k, v] = pair.split('=');
          if (k && v) labels[k.trim()] = v.replace(/"/g, '').trim();
        }
      }
      entries.push({ name: match[1], value: parseFloat(match[4]), labels });
    }
  }
  return entries;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon, label, value, subValue, status,
}: {
  icon: React.ElementType; label: string; value: string | number; subValue?: string;
  status?: 'ok' | 'warning' | 'error';
}) {
  const statusColor = status === 'error' ? 'border-red-500/40 bg-red-500/5'
    : status === 'warning' ? 'border-yellow-500/40 bg-yellow-500/5'
    : 'border-lattice-border bg-lattice-surface';

  return (
    <div className={cn('rounded-lg border p-4 space-y-1', statusColor)}>
      <div className="flex items-center gap-2 text-gray-400 text-xs">
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      {subValue && <p className="text-xs text-gray-500">{subValue}</p>}
    </div>
  );
}

function BreakerBadge({ breaker }: { breaker: CircuitBreakerState }) {
  const stateConfig = {
    closed: { color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle, label: 'Closed' },
    open: { color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: AlertTriangle, label: 'Open' },
    half_open: { color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: RefreshCw, label: 'Half-Open' },
  };

  const cfg = stateConfig[breaker.state] || stateConfig.closed;
  const StateIcon = cfg.icon;

  return (
    <div className={cn('flex items-center justify-between p-3 rounded-lg border', cfg.color)}>
      <div className="flex items-center gap-2">
        <StateIcon className="w-4 h-4" />
        <span className="text-sm font-medium">{breaker.name}</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span>{cfg.label}</span>
        <span className="text-gray-500">
          {breaker.totalFailures}/{breaker.totalCalls} failures
        </span>
      </div>
    </div>
  );
}

function MiniSparkBar({ values, max, color = 'bg-neon-cyan' }: { values: number[]; max: number; color?: string }) {
  if (values.length === 0) return null;
  return (
    <div className="flex items-end gap-px h-8">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn('rounded-sm w-1.5 transition-all', color)}
          style={{ height: `${Math.max(2, (v / (max || 1)) * 100)}%`, opacity: 0.4 + (i / values.length) * 0.6 }}
        />
      ))}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function MonitoringPanel() {
  const [historyLen] = useState(20);

  // Fetch Prometheus-format metrics from /metrics
  const { data: rawMetrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['monitoring-prometheus'],
    queryFn: async () => {
      const res = await api.get('/metrics', { responseType: 'text' });
      return typeof res.data === 'string' ? res.data : '';
    },
    refetchInterval: 5000,
  });

  // Fetch structured status from /api/status
  const { data: statusData } = useQuery({
    queryKey: ['monitoring-status'],
    queryFn: async () => {
      const { data } = await api.get('/api/status');
      return data;
    },
    refetchInterval: 5000,
  });

  // Fetch health data
  const { data: healthData } = useQuery({
    queryKey: ['monitoring-health'],
    queryFn: async () => {
      const { data } = await api.get('/api/health');
      return data;
    },
    refetchInterval: 5000,
  });

  // Parse metrics
  const metrics = useMemo(() => {
    if (!rawMetrics) return [];
    return parsePrometheusText(rawMetrics);
  }, [rawMetrics]);

  // Extract key metrics
  const totalRequests = metrics.find(m => m.name === 'concord_brain_requests_total')?.value || 0;
  const totalErrors = metrics.find(m => m.name === 'concord_brain_errors_total')?.value || 0;
  const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : '0.00';

  const memRss = metrics.find(m => m.name === 'concord_process_memory_bytes' && m.labels?.type === 'rss')?.value || 0;
  const memHeapUsed = metrics.find(m => m.name === 'concord_process_memory_bytes' && m.labels?.type === 'heapUsed')?.value || 0;
  const memHeapTotal = metrics.find(m => m.name === 'concord_process_memory_bytes' && m.labels?.type === 'heapTotal')?.value || 0;

  const uptimeSeconds = metrics.find(m => m.name === 'concord_uptime_seconds')?.value || 0;
  const sessions = metrics.find(m => m.name === 'concord_sessions_total')?.value || 0;
  const dtuCount = metrics.find(m => m.name === 'concord_dtus_total' && m.labels?.scope === 'all')?.value || 0;
  const heartbeatTicks = metrics.find(m => m.name === 'concord_heartbeat_tick_total')?.value || 0;

  // Brain-specific metrics (latency, enabled status)
  const brainMetrics = metrics.filter(m => m.name === 'concord_brain_avg_latency_ms');
  const brainEnabled = metrics.filter(m => m.name === 'concord_brain_enabled');
  const avgLatency = brainMetrics.length > 0
    ? Math.round(brainMetrics.reduce((sum, m) => sum + m.value, 0) / brainMetrics.length)
    : 0;

  // Circuit breaker states (from brain enabled/disabled status)
  const circuitBreakers: CircuitBreakerState[] = brainEnabled.map(m => {
    const name = m.labels?.brain || 'unknown';
    const brainReqs = metrics.find(
      me => me.name === 'concord_brain_requests_total' && me.labels?.brain === name
    )?.value || 0;
    const brainErrs = metrics.find(
      me => me.name === 'concord_brain_errors_total' && me.labels?.brain === name
    )?.value || 0;

    return {
      name,
      state: m.value === 0 ? 'open' as const : (brainErrs > brainReqs * 0.5 ? 'half_open' as const : 'closed' as const),
      failures: brainErrs,
      totalCalls: brainReqs,
      totalFailures: brainErrs,
    };
  });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return `${h}h ${m}m`;
  };

  // Queue depth from status
  const crawlQueue = statusData?.crawlQueue || 0;
  const queueCounts = statusData?.counts || {};

  // Health check status
  const healthStatus = healthData?.status || 'unknown';
  const healthChecks = healthData?.checks || {};

  if (metricsLoading) {
    return (
      <div className="panel p-6">
        <div className="flex items-center gap-3 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading monitoring data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30">
          <BarChart3 className="w-5 h-5 text-neon-cyan" />
        </div>
        <div>
          <h2 className="font-semibold">System Monitoring</h2>
          <p className="text-xs text-gray-500">Live metrics from /metrics endpoint</p>
        </div>
        <span className={cn(
          'ml-auto px-2 py-0.5 rounded-full text-xs border',
          healthStatus === 'healthy'
            ? 'bg-green-500/20 text-green-400 border-green-500/30'
            : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
        )}>
          {healthStatus}
        </span>
      </div>

      {/* Primary metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={Activity}
          label="Request Rate"
          value={totalRequests.toLocaleString()}
          subValue="total brain requests"
        />
        <MetricCard
          icon={Gauge}
          label="Avg Latency"
          value={`${avgLatency}ms`}
          subValue="across all brains"
          status={avgLatency > 5000 ? 'warning' : 'ok'}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Error Rate"
          value={`${errorRate}%`}
          subValue={`${totalErrors} total errors`}
          status={parseFloat(errorRate) > 5 ? 'error' : parseFloat(errorRate) > 1 ? 'warning' : 'ok'}
        />
        <MetricCard
          icon={Server}
          label="Uptime"
          value={formatUptime(uptimeSeconds)}
          subValue={`${heartbeatTicks} heartbeat ticks`}
        />
      </div>

      {/* Memory & Resources */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          icon={Cpu}
          label="Heap Used"
          value={formatBytes(memHeapUsed)}
          subValue={`of ${formatBytes(memHeapTotal)}`}
          status={memHeapUsed > memHeapTotal * 0.9 ? 'error' : memHeapUsed > memHeapTotal * 0.7 ? 'warning' : 'ok'}
        />
        <MetricCard
          icon={Cpu}
          label="RSS Memory"
          value={formatBytes(memRss)}
          subValue="resident set size"
        />
        <MetricCard
          icon={Zap}
          label="Active Sessions"
          value={sessions}
          subValue={`${dtuCount} DTUs`}
        />
        <MetricCard
          icon={Activity}
          label="Queue Depth"
          value={crawlQueue}
          subValue={`${queueCounts.emergents || 0} emergents`}
        />
      </div>

      {/* Health checks */}
      {Object.keys(healthChecks).length > 0 && (
        <div className="panel p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-neon-green" />
            Health Checks
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(healthChecks).map(([key, value]) => (
              <div
                key={key}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs border',
                  value === 'ok' ? 'bg-green-500/10 border-green-500/20 text-green-400'
                  : value === 'warning' ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                  : value === 'disabled' ? 'bg-gray-500/10 border-gray-500/20 text-gray-400'
                  : 'bg-red-500/10 border-red-500/20 text-red-400'
                )}
              >
                <span className="font-medium">{key}</span>: {String(value)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Circuit Breaker States */}
      {circuitBreakers.length > 0 && (
        <div className="panel p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-purple" />
            Circuit Breaker States
          </h3>
          <div className="space-y-2">
            {circuitBreakers.map(cb => (
              <BreakerBadge key={cb.name} breaker={cb} />
            ))}
          </div>
        </div>
      )}

      {/* Brain-level latency breakdown */}
      {brainMetrics.length > 0 && (
        <div className="panel p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-neon-cyan" />
            Brain Latency Breakdown
          </h3>
          <div className="space-y-2">
            {brainMetrics.map(m => {
              const name = m.labels?.brain || 'unknown';
              const enabled = brainEnabled.find(b => b.labels?.brain === name)?.value === 1;
              return (
                <div key={name} className="flex items-center gap-3 text-sm">
                  <span className={cn(
                    'w-2 h-2 rounded-full',
                    enabled ? 'bg-green-400' : 'bg-red-400'
                  )} />
                  <span className="text-gray-300 font-mono text-xs w-32 truncate">{name}</span>
                  <div className="flex-1 h-2 bg-lattice-elevated rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        m.value > 5000 ? 'bg-red-400' : m.value > 2000 ? 'bg-yellow-400' : 'bg-neon-cyan'
                      )}
                      style={{ width: `${Math.min(100, (m.value / 10000) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-16 text-right">{Math.round(m.value)}ms</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
