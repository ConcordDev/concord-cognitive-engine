'use client';

/**
 * BrainMonitor — Three-Brain Cognitive Architecture status panel.
 *
 * Displays real-time status of all three brains:
 *   - Conscious (7B): chat, deep reasoning
 *   - Subconscious (1.5B): autogen, dream, evolution, synthesis
 *   - Utility (3B): lens interactions, entity actions
 *
 * Shows: online/offline state, requests/min, avg response time,
 * DTUs generated per brain, and overall architecture mode.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Brain,
  Activity,
  Zap,
  Moon,
  Wrench,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';

interface BrainStats {
  requests: number;
  totalMs: number;
  dtusGenerated: number;
  errors: number;
  lastCallAt: string | null;
}

interface BrainInfo {
  enabled: boolean;
  url: string;
  model: string;
  role: string;
  stats: BrainStats;
  avgResponseMs: number;
}

interface EmbeddingStatus {
  available: boolean;
  model: string | null;
  dimension: number;
  cached: number;
  totalDTUs: number;
  coverage: number;
  backfill: {
    complete: boolean;
    progress: number;
    total: number;
  };
  stats: {
    totalEmbedded: number;
    totalRequests: number;
    totalErrors: number;
    avgEmbedMs: number;
  };
}

interface BrainStatusResponse {
  ok: boolean;
  mode: 'four_brain' | 'three_brain' | 'partial' | 'fallback';
  onlineCount: number;
  brains: {
    conscious: BrainInfo;
    subconscious: BrainInfo;
    utility: BrainInfo;
    repair?: BrainInfo;
  };
  embeddings?: EmbeddingStatus;
}

const BRAIN_CONFIG = {
  conscious: {
    label: 'Conscious',
    icon: Brain,
    color: 'neon-cyan',
    bgClass: 'bg-neon-cyan/10 border-neon-cyan/30',
    textClass: 'text-neon-cyan',
    dotClass: 'bg-neon-cyan',
  },
  subconscious: {
    label: 'Subconscious',
    icon: Moon,
    color: 'neon-purple',
    bgClass: 'bg-neon-purple/10 border-neon-purple/30',
    textClass: 'text-neon-purple',
    dotClass: 'bg-neon-purple',
  },
  utility: {
    label: 'Utility',
    icon: Wrench,
    color: 'neon-green',
    bgClass: 'bg-neon-green/10 border-neon-green/30',
    textClass: 'text-neon-green',
    dotClass: 'bg-neon-green',
  },
  repair: {
    label: 'Repair',
    icon: ShieldAlert,
    color: 'red',
    bgClass: 'bg-red-500/10 border-red-500/30',
    textClass: 'text-red-400',
    dotClass: 'bg-red-400',
  },
} as const;

function BrainCard({ name, brain }: { name: keyof typeof BRAIN_CONFIG; brain: BrainInfo }) {
  const config = BRAIN_CONFIG[name];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-all',
        config.bgClass,
        !brain.enabled && 'opacity-50'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', config.textClass)} />
          <span className={cn('text-sm font-medium', config.textClass)}>{config.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              brain.enabled ? config.dotClass : 'bg-red-500',
              brain.enabled && 'animate-pulse'
            )}
          />
          <span className="text-xs text-lattice-text-secondary">
            {brain.enabled ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="text-xs text-lattice-text-secondary mb-1">{brain.model}</div>

      {brain.enabled && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
          <div className="flex justify-between">
            <span className="text-lattice-text-secondary">Requests</span>
            <span className="text-lattice-text-primary font-mono">{brain.stats.requests}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-lattice-text-secondary">Avg ms</span>
            <span className="text-lattice-text-primary font-mono">{brain.avgResponseMs}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-lattice-text-secondary">DTUs</span>
            <span className="text-lattice-text-primary font-mono">{brain.stats.dtusGenerated}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-lattice-text-secondary">Errors</span>
            <span
              className={cn(
                'font-mono',
                brain.stats.errors > 0 ? 'text-red-400' : 'text-lattice-text-primary'
              )}
            >
              {brain.stats.errors}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function BrainMonitor() {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading, refetch } = useQuery<BrainStatusResponse>({
    queryKey: ['brain-status'],
    queryFn: async () => {
      const res = await apiHelpers.brain.status();
      return res.data;
    },
    refetchInterval: 15_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full lattice-surface border lattice-border text-xs">
        <Activity className="w-3 h-3 text-lattice-text-secondary animate-pulse" />
        <span className="text-lattice-text-secondary">Loading...</span>
      </div>
    );
  }

  if (!data) {
    return (
      <button
        onClick={() => refetch()}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full lattice-surface border lattice-border text-xs hover:bg-white/5 transition-colors"
      >
        <Activity className="w-3 h-3 text-red-400" />
        <span className="text-red-400">Offline</span>
      </button>
    );
  }

  const modeLabel =
    data.mode === 'four_brain'
      ? 'Four-Brain'
      : data.mode === 'three_brain'
        ? 'Three-Brain'
        : data.mode === 'partial'
          ? 'Partial'
          : 'Fallback';
  const modeColor =
    data.mode === 'four_brain' || data.mode === 'three_brain'
      ? 'text-neon-green'
      : data.mode === 'partial'
        ? 'text-amber-400'
        : 'text-red-400';
  const totalBrains = data.brains.repair ? 4 : 3;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full lattice-surface border lattice-border text-xs hover:bg-white/5 transition-colors"
      >
        <Activity className={cn('w-3 h-3', modeColor)} />
        <span className={modeColor}>{modeLabel}</span>
        <span className="text-lattice-text-secondary">
          {data.onlineCount}/{totalBrains}
        </span>
        <ChevronDown className="w-3 h-3 text-lattice-text-secondary" />
      </button>
    );
  }

  return (
    <div className="lattice-surface border lattice-border rounded-xl p-4 w-80 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className={cn('w-4 h-4', modeColor)} />
          <span className="text-sm font-semibold text-lattice-text-primary">
            Cognitive Architecture
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3 text-lattice-text-secondary" />
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            aria-label="Collapse brain monitor"
          >
            <ChevronUp className="w-3 h-3 text-lattice-text-secondary" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs">
        <span className="text-lattice-text-secondary">Mode:</span>
        <span className={cn('font-medium', modeColor)}>{modeLabel}</span>
        <span className="text-lattice-text-secondary">
          ({data.onlineCount}/{totalBrains} online)
        </span>
      </div>

      <div className="space-y-2">
        {(Object.keys(BRAIN_CONFIG) as Array<keyof typeof BRAIN_CONFIG>).map((name) => {
          const brain = data.brains[name];
          if (!brain) return null;
          return <BrainCard key={name} name={name} brain={brain} />;
        })}
      </div>

      {/* Embedding Status */}
      {data.embeddings && (
        <div className="mt-3 rounded-lg border p-3 bg-amber-500/10 border-amber-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium text-amber-400">Embeddings</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  data.embeddings.available ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
                )}
              />
              <span className="text-xs text-lattice-text-secondary">
                {data.embeddings.available ? data.embeddings.model || 'Active' : 'Offline'}
              </span>
            </div>
          </div>

          {data.embeddings.available && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-lattice-text-secondary">Coverage</span>
                <span className="text-lattice-text-primary font-mono">
                  {data.embeddings.coverage}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-lattice-text-secondary">Cached</span>
                <span className="text-lattice-text-primary font-mono">
                  {data.embeddings.cached}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-lattice-text-secondary">Avg ms</span>
                <span className="text-lattice-text-primary font-mono">
                  {data.embeddings.stats.avgEmbedMs}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-lattice-text-secondary">Errors</span>
                <span
                  className={cn(
                    'font-mono',
                    data.embeddings.stats.totalErrors > 0
                      ? 'text-red-400'
                      : 'text-lattice-text-primary'
                  )}
                >
                  {data.embeddings.stats.totalErrors}
                </span>
              </div>
              {!data.embeddings.backfill.complete && data.embeddings.backfill.total > 0 && (
                <div className="col-span-2 mt-1">
                  <div className="flex justify-between text-lattice-text-secondary mb-1">
                    <span>Backfill</span>
                    <span className="font-mono">
                      {data.embeddings.backfill.progress}/{data.embeddings.backfill.total}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-black/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all"
                      style={{
                        width: `${data.embeddings.backfill.total > 0 ? (data.embeddings.backfill.progress / data.embeddings.backfill.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedBrainMonitor = withErrorBoundary(BrainMonitor);
export { _WrappedBrainMonitor as BrainMonitor };
export default _WrappedBrainMonitor;
