'use client';

/**
 * FlywheelDashboard — Compound flywheel metrics visualization.
 * Shows velocity gauge + five reinforcement loop spokes.
 */

import { useQuery } from '@tanstack/react-query';
import { flywheelMetrics } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Database, Bot, Star, ShoppingBag, Users,
  TrendingUp, Activity,
} from 'lucide-react';

interface FlywheelMetrics {
  totalDTUs: number;
  megaCount: number;
  hyperCount: number;
  compressionRatio: number;
  livingEntities: number;
  avgMaturity: number;
  productionRate: number;
  avgQualityScore: number;
  tier1Rate: number;
  qualityTrend: 'improving' | 'stable' | 'declining';
  totalListings: number;
  transactionsToday: number;
  revenueToday: number;
  activeUsers24h: number;
  chatMessages24h: number;
  lensActionsToday: number;
  velocity: number;
}

const SPOKES = [
  { key: 'substrate', label: 'Substrate', icon: Database, color: 'text-cyan-400' },
  { key: 'entities', label: 'Entities', icon: Bot, color: 'text-purple-400' },
  { key: 'quality', label: 'Quality', icon: Star, color: 'text-yellow-400' },
  { key: 'marketplace', label: 'Market', icon: ShoppingBag, color: 'text-green-400' },
  { key: 'users', label: 'Users', icon: Users, color: 'text-blue-400' },
] as const;

function FlywheelDashboard() {
  const { data, isLoading } = useQuery<{ ok: boolean; metrics: FlywheelMetrics }>({
    queryKey: ['flywheel'],
    queryFn: () => flywheelMetrics(),
    refetchInterval: 60000,
  });

  if (isLoading || !data?.metrics) {
    return (
      <div className="p-6 text-center text-gray-500">
        <Activity className="w-8 h-8 mx-auto mb-2 animate-pulse" />
        Loading flywheel metrics...
      </div>
    );
  }

  const m = data.metrics;
  const velocityPct = Math.round(m.velocity * 100);

  return (
    <div className="space-y-6">
      {/* Velocity Gauge */}
      <div className="text-center">
        <h2 className="text-lg font-bold text-white flex items-center justify-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyan-400" />
          Compound Flywheel
        </h2>
        <div className="mt-4 relative w-32 h-32 mx-auto">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#27272a" strokeWidth="8" />
            <circle
              cx="50" cy="50" r="45" fill="none"
              stroke={velocityPct >= 60 ? '#22d3ee' : velocityPct >= 30 ? '#facc15' : '#f87171'}
              strokeWidth="8"
              strokeDasharray={`${velocityPct * 2.83} 283`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-white">{velocityPct}%</span>
            <span className="text-xs text-zinc-500">velocity</span>
          </div>
        </div>
      </div>

      {/* Spokes */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
        {SPOKES.map(spoke => {
          const Icon = spoke.icon;
          let value = '';
          let detail = '';

          switch (spoke.key) {
            case 'substrate':
              value = String(m.totalDTUs);
              detail = `${m.megaCount} MEGAs · ${m.hyperCount} HYPERs`;
              break;
            case 'entities':
              value = String(m.livingEntities);
              detail = `${m.productionRate.toFixed(1)}/hr production`;
              break;
            case 'quality':
              value = `${Math.round(m.tier1Rate * 100)}%`;
              detail = `Tier 1 rate · ${m.qualityTrend}`;
              break;
            case 'marketplace':
              value = String(m.totalListings);
              detail = `${m.transactionsToday} txns today`;
              break;
            case 'users':
              value = String(m.activeUsers24h);
              detail = `${m.chatMessages24h} msgs · ${m.lensActionsToday} actions`;
              break;
          }

          return (
            <div
              key={spoke.key}
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-center"
            >
              <Icon className={cn('w-5 h-5 mx-auto mb-1', spoke.color)} />
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-xs text-zinc-500">{spoke.label}</p>
              <p className="text-[10px] text-zinc-600 mt-1">{detail}</p>
            </div>
          );
        })}
      </div>

      {/* Reinforcement Loops */}
      <div className="bg-zinc-800/30 border border-zinc-700 rounded-lg p-4">
        <p className="text-xs text-zinc-500 text-center">
          More users &rarr; more substrate &rarr; better quality &rarr; more marketplace &rarr; more revenue &rarr; more users
        </p>
      </div>
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _FlywheelDashboard = withErrorBoundary(FlywheelDashboard);
export { _FlywheelDashboard as FlywheelDashboard };
