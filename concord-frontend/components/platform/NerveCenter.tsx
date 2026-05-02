'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Heart,
  Brain,
  Shield,
  Eye,
  Gauge,
  CheckCircle,
  XCircle,
  Lightbulb,
  BookOpen,
  Layers,
} from 'lucide-react';
import BrainHealthPanel from '@/components/brain/BrainHealthPanel';

type BeaconCheck = {
  name: string;
  pass: boolean;
  detail: string;
};

type BeaconResult = {
  ok: boolean;
  healthy: boolean;
  checks: BeaconCheck[];
  checkedAt: string;
};

type BridgeModule = {
  name: string;
  desc: string;
};

function HealthIndicator({
  pass,
  label,
  detail,
}: {
  pass: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
        pass ? 'border-neon-green/20 bg-neon-green/5' : 'border-neon-orange/20 bg-neon-orange/5'
      }`}
    >
      {pass ? (
        <CheckCircle className="w-5 h-5 text-neon-green shrink-0" />
      ) : (
        <XCircle className="w-5 h-5 text-neon-orange shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-200">{label.replace(/_/g, ' ')}</p>
        <p className="text-xs text-gray-400 truncate">{detail}</p>
      </div>
    </div>
  );
}

function StrategyCard({
  strategy,
  hints,
}: {
  strategy: { id: string; name: string; avgPerformance: number } | null;
  hints: { explorationRate?: number; preferredIntentBias?: string } | null;
}) {
  if (!strategy) {
    return (
      <div className="text-xs text-gray-500 italic">
        No strategy data yet. Pipeline needs more runs.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-200">{strategy.name}</span>
        <span
          className={`text-sm font-mono ${strategy.avgPerformance >= 0.7 ? 'text-neon-green' : strategy.avgPerformance >= 0.4 ? 'text-neon-yellow' : 'text-neon-orange'}`}
        >
          {(strategy.avgPerformance * 100).toFixed(0)}%
        </span>
      </div>
      {hints && (
        <div className="flex flex-wrap gap-2">
          <span className="text-xs px-2 py-0.5 rounded bg-lattice-deep text-gray-400">
            Exploration: {((hints.explorationRate ?? 0.2) * 100).toFixed(0)}%
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              hints.preferredIntentBias === 'exploratory'
                ? 'bg-neon-blue/10 text-neon-blue'
                : 'bg-neon-purple/10 text-neon-purple'
            }`}
          >
            {hints.preferredIntentBias ?? 'balanced'}
          </span>
        </div>
      )}
    </div>
  );
}

function NerveCenter() {
  const { data: beaconRes, isLoading: beaconLoading } = useQuery({
    queryKey: ['beacon-check'],
    queryFn: () => apiHelpers.bridge.beacon(),
    refetchInterval: 20000,
  });

  const { data: bridgeInfoRes } = useQuery({
    queryKey: ['bridge-info'],
    queryFn: () => apiHelpers.bridge.info(),
    staleTime: 300000,
  });

  const { data: strategyRes } = useQuery({
    queryKey: ['strategy-hints-autogen'],
    queryFn: () => apiHelpers.bridge.strategyHints('autogen'),
    refetchInterval: 60000,
  });

  const { data: scopeRes } = useQuery({
    queryKey: ['scope-metrics'],
    queryFn: () => apiHelpers.scope.metrics(),
    refetchInterval: 30000,
  });

  const { data: hypothesisRes } = useQuery({
    queryKey: ['hypothesis-status'],
    queryFn: () => apiHelpers.hypothesis.status(),
    refetchInterval: 30000,
  });

  const { data: metalearningRes } = useQuery({
    queryKey: ['metalearning-status'],
    queryFn: () => apiHelpers.metalearning.status(),
    refetchInterval: 30000,
  });

  const beacon: BeaconResult | null = beaconRes?.data?.ok ? beaconRes.data : null;
  const bridgeModules: BridgeModule[] = bridgeInfoRes?.data?.bridges || [];
  const strategyData = strategyRes?.data?.ok ? strategyRes.data : null;
  const scopeData = scopeRes?.data;
  const hypothesisData = hypothesisRes?.data;
  const metalearningData = metalearningRes?.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-neon-purple" />
          <h2 className="text-xl font-bold text-gray-100">System Nerve Center</h2>
        </div>
        {beacon && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
              beacon.healthy
                ? 'bg-neon-green/10 border border-neon-green/20'
                : 'bg-neon-orange/10 border border-neon-orange/20'
            }`}
          >
            <Heart
              className={`w-4 h-4 ${beacon.healthy ? 'text-neon-green' : 'text-neon-orange'}`}
            />
            <span
              className={`text-xs font-medium ${beacon.healthy ? 'text-neon-green' : 'text-neon-orange'}`}
            >
              {beacon.healthy ? 'Healthy' : 'Degraded'}
            </span>
          </div>
        )}
      </div>

      {/* Beacon Health Checks */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
          <Eye className="w-4 h-4 text-neon-cyan" />
          Beacon Health Checks
        </h3>
        {beaconLoading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-12 bg-lattice-elevated rounded-lg" />
            ))}
          </div>
        ) : beacon ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {beacon.checks.map((check) => (
              <HealthIndicator
                key={check.name}
                pass={check.pass}
                label={check.name}
                detail={check.detail}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Beacon not available</p>
        )}
      </div>

      {/* Strategy + Hypothesis + MetaLearning */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Meta-Learning Strategy */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-neon-green" />
            Pipeline Strategy
          </h3>
          <StrategyCard strategy={strategyData?.strategy} hints={strategyData?.hints} />
        </div>

        {/* Hypothesis Engine */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-neon-yellow" />
            Hypothesis Engine
          </h3>
          {hypothesisData ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Proposed</span>
                <span className="text-gray-200">{hypothesisData.stats?.proposed ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Supported</span>
                <span className="text-neon-green">{hypothesisData.stats?.supported ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Refuted</span>
                <span className="text-neon-orange">{hypothesisData.stats?.refuted ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Inconclusive</span>
                <span className="text-gray-500">{hypothesisData.stats?.inconclusive ?? 0}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">Not yet initialized</p>
          )}
        </div>

        {/* Meta-Learning Status */}
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-neon-purple" />
            Meta-Learning
          </h3>
          {metalearningData ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Strategies</span>
                <span className="text-gray-200">{metalearningData.strategies?.length ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Adaptations</span>
                <span className="text-neon-cyan">
                  {metalearningData.stats?.strategiesAdapted ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Improvements</span>
                <span className="text-neon-green">
                  {metalearningData.stats?.performanceImprovements ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Curriculums</span>
                <span className="text-gray-200">
                  {metalearningData.stats?.curriculumsGenerated ?? 0}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500 italic">Not yet initialized</p>
          )}
        </div>
      </div>

      {/* Scope Distribution */}
      {scopeData && (
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-neon-blue" />
            Scope Distribution
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {['global', 'marketplace', 'local'].map((scope) => {
              const count = scopeData[scope]?.count ?? scopeData[`${scope}Count`] ?? '?';
              const colors: Record<string, string> = {
                global: 'neon-blue',
                marketplace: 'neon-purple',
                local: 'neon-green',
              };
              return (
                <div key={scope} className="text-center p-4 rounded-lg bg-lattice-deep">
                  <p className={`text-2xl font-bold text-${colors[scope]}`}>{count}</p>
                  <p className="text-xs text-gray-400 capitalize mt-1">{scope}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bridge Modules */}
      {bridgeModules.length > 0 && (
        <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-cyan" />
            Capability Bridge Modules
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {bridgeModules.map((mod) => (
              <div
                key={mod.name}
                className="flex items-center gap-2 px-3 py-2 rounded bg-lattice-deep"
              >
                <CheckCircle className="w-3 h-3 text-neon-green shrink-0" />
                <span className="text-xs text-gray-300 truncate">
                  {mod.name.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brain Health — per-brain model status, latency, and error rates */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
        <BrainHealthPanel />
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _NerveCenter = withErrorBoundary(NerveCenter);
export { _NerveCenter as NerveCenter };
export default _NerveCenter;
