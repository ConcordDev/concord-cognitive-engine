'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Activity,
  Zap,
  GitBranch,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  TrendingUp,
  Clock,
  BarChart3,
} from 'lucide-react';

type PipelineMetrics = {
  totalRuns: number;
  byIntent: Record<string, number>;
  byVariant: Record<string, number>;
  candidatesProduced: number;
  candidatesRejected: number;
  shadowsCreated: number;
  ollamaShapings: number;
  ollamaFailures: number;
  cloudEscalations: number;
  noveltyRejects: number;
  patchProposals: number;
  recentHashCount: number;
};

type IntentSignal = {
  intent: string;
  score: number;
  signal: Record<string, unknown>;
};

function MetricCard({
  label,
  value,
  icon: Icon,
  color = 'neon-blue',
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="bg-lattice-elevated border border-lattice-border rounded-lg p-4 flex items-start gap-3">
      <div className={`p-2 rounded-md bg-${color}/10`}>
        <Icon className={`w-5 h-5 text-${color}`} />
      </div>
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-gray-100 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function IntentBar({ intent, count, total }: { intent: string; count: number; total: number }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const colors: Record<string, string> = {
    fill_gaps: 'bg-neon-blue',
    resolve_conflicts: 'bg-neon-orange',
    compress_clusters: 'bg-neon-purple',
    extract_patterns: 'bg-neon-green',
    elevate_high_usage: 'bg-neon-pink',
  };
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-36 truncate">{intent.replace(/_/g, ' ')}</span>
      <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
        <div
          className={`h-full ${colors[intent] || 'bg-neon-cyan'} rounded-full transition-all`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      <span className="text-xs text-gray-300 w-10 text-right">{count}</span>
    </div>
  );
}

function PipelineMonitor() {
  const { data: metricsRes, isLoading: metricsLoading } = useQuery({
    queryKey: ['pipeline-metrics'],
    queryFn: () => apiHelpers.pipeline.metrics(),
    refetchInterval: 15000,
  });

  const { data: intentRes } = useQuery({
    queryKey: ['pipeline-intent'],
    queryFn: () => apiHelpers.pipeline.selectIntent(),
    refetchInterval: 30000,
  });

  const { data: dedupRes } = useQuery({
    queryKey: ['dedup-scan'],
    queryFn: () => apiHelpers.bridge.dedupScan({ threshold: 0.82, windowSize: 50 }),
    refetchInterval: 60000,
  });

  const metrics: PipelineMetrics | null = metricsRes?.data?.ok ? metricsRes.data : null;
  const currentIntent: IntentSignal | null = intentRes?.data?.ok ? intentRes.data : null;
  const dedupResult = dedupRes?.data?.ok ? dedupRes.data : null;

  if (metricsLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-lattice-elevated rounded w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-lattice-elevated rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const successRate =
    metrics && metrics.totalRuns > 0
      ? Math.round((metrics.candidatesProduced / metrics.totalRuns) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-neon-blue" />
          <h2 className="text-xl font-bold text-gray-100">Pipeline Monitor</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neon-blue/10 text-neon-blue border border-neon-blue/20">
            v5.5.0
          </span>
        </div>
        {currentIntent && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-lattice-elevated border border-lattice-border">
            <Zap className="w-4 h-4 text-neon-yellow" />
            <span className="text-xs text-gray-400">Current Intent:</span>
            <span className="text-sm font-medium text-neon-cyan">
              {currentIntent.intent?.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-gray-500">
              ({currentIntent.score?.toFixed?.(0) ?? '?'})
            </span>
          </div>
        )}
      </div>

      {/* Core Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Runs"
          value={metrics?.totalRuns ?? 0}
          icon={BarChart3}
          color="neon-blue"
        />
        <MetricCard
          label="Success Rate"
          value={`${successRate}%`}
          icon={successRate >= 70 ? CheckCircle : AlertTriangle}
          color={successRate >= 70 ? 'neon-green' : 'neon-orange'}
          sub={`${metrics?.candidatesProduced ?? 0} produced / ${metrics?.candidatesRejected ?? 0} rejected`}
        />
        <MetricCard
          label="Ollama Shapings"
          value={metrics?.ollamaShapings ?? 0}
          icon={Zap}
          color="neon-purple"
          sub={`${metrics?.ollamaFailures ?? 0} failures`}
        />
        <MetricCard
          label="Shadows Created"
          value={metrics?.shadowsCreated ?? 0}
          icon={Shield}
          color="neon-cyan"
          sub={`${metrics?.patchProposals ?? 0} patches`}
        />
      </div>

      {/* Intent Distribution */}
      {metrics?.byIntent && Object.keys(metrics.byIntent).length > 0 && (
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-neon-purple" />
            Intent Distribution
          </h3>
          <div className="space-y-3">
            {Object.entries(metrics.byIntent)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .map(([intent, count]) => (
                <IntentBar
                  key={intent}
                  intent={intent}
                  count={count as number}
                  total={metrics.totalRuns}
                />
              ))}
          </div>
        </div>
      )}

      {/* Variant Distribution + Dedup Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Variant Breakdown */}
        {metrics?.byVariant && Object.keys(metrics.byVariant).length > 0 && (
          <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-green" />
              Variant Breakdown
            </h3>
            <div className="space-y-2">
              {Object.entries(metrics.byVariant).map(([variant, count]) => (
                <div
                  key={variant}
                  className="flex items-center justify-between px-3 py-2 rounded bg-lattice-deep"
                >
                  <span className="text-sm text-gray-300 capitalize">{variant}</span>
                  <span className="text-sm font-mono text-neon-cyan">{count as number}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dedup Status */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-orange" />
            Dedup Gate Status
          </h3>
          {dedupResult ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Scanned</span>
                <span className="text-sm text-gray-200">{dedupResult.scanned} DTUs</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Duplicates Found</span>
                <span
                  className={`text-sm font-medium ${dedupResult.duplicatePairs?.length > 0 ? 'text-neon-orange' : 'text-neon-green'}`}
                >
                  {dedupResult.duplicatePairs?.length ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Threshold</span>
                <span className="text-sm text-gray-200">
                  {((dedupResult.threshold ?? 0.82) * 100).toFixed(0)}%
                </span>
              </div>
              {dedupResult.duplicatePairs?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {dedupResult.duplicatePairs
                    .slice(0, 3)
                    .map((p: { titleA: string; titleB: string; similarity: number }, i: number) => (
                      <div
                        key={i}
                        className="text-xs text-gray-500 bg-lattice-deep rounded px-2 py-1"
                      >
                        <span className="text-neon-orange">{Math.round(p.similarity * 100)}%</span>{' '}
                        {p.titleA?.slice(0, 30)} ↔ {p.titleB?.slice(0, 30)}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Loading dedup scan...</p>
          )}
        </div>
      </div>

      {/* Escalation & Novelty Stats */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="Cloud Escalations"
          value={metrics?.cloudEscalations ?? 0}
          icon={TrendingUp}
          color="neon-yellow"
        />
        <MetricCard
          label="Novelty Rejects"
          value={metrics?.noveltyRejects ?? 0}
          icon={XCircle}
          color="neon-pink"
        />
        <MetricCard
          label="Hash Cache"
          value={metrics?.recentHashCount ?? 0}
          icon={Clock}
          color="neon-cyan"
          sub="novelty fingerprints"
        />
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedPipelineMonitor = withErrorBoundary(PipelineMonitor);
export { _WrappedPipelineMonitor as PipelineMonitor };
export default _WrappedPipelineMonitor;
