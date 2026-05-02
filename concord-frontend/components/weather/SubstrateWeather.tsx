'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import {
  Sun,
  Wind,
  CloudFog,
  CloudLightning,
  Brain,
  Sparkles,
  Wrench,
  Shield,
  ChevronDown,
  ChevronUp,
  Thermometer,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

const WEATHER_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  clear: { icon: Sun, color: 'text-yellow-400', bg: 'from-yellow-500/10 to-orange-500/10' },
  breezy: { icon: Wind, color: 'text-blue-400', bg: 'from-blue-500/10 to-cyan-500/10' },
  stormy: {
    icon: CloudLightning,
    color: 'text-purple-400',
    bg: 'from-purple-500/10 to-pink-500/10',
  },
  foggy: { icon: CloudFog, color: 'text-gray-400', bg: 'from-gray-500/10 to-gray-600/10' },
};

const BRAIN_ICONS: Record<string, React.ElementType> = {
  conscious: Brain,
  subconscious: Sparkles,
  utility: Wrench,
  repair: Shield,
};

function SubstrateWeather({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['substrate-weather'],
    queryFn: () => api.get('/api/weather').then((r) => r.data),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div
        className={cn(
          'p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse',
          className
        )}
      >
        <div className="h-20 bg-lattice-deep rounded" />
      </div>
    );
  }

  if (!data?.ok) return null;

  const weatherConf = WEATHER_CONFIG[data.weather] || WEATHER_CONFIG.clear;
  const WeatherIcon = weatherConf.icon;
  const stats = data.stats || {};
  const freshness = stats.freshness || {};

  return (
    <div
      className={cn(
        'bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Main weather display */}
      <div className={cn('bg-gradient-to-br p-5', weatherConf.bg)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.div
              animate={{ rotate: data.weather === 'breezy' ? [0, 10, -10, 0] : 0 }}
              transition={{ repeat: Infinity, duration: 3 }}
            >
              <WeatherIcon className={cn('w-12 h-12', weatherConf.color)} />
            </motion.div>
            <div>
              <h3 className="text-xl font-bold text-white capitalize">{data.weather}</h3>
              <p className="text-sm text-gray-400">{data.description}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1">
              <Thermometer className="w-4 h-4 text-red-400" />
              <span className="text-2xl font-bold text-white">{data.temperature}°</span>
            </div>
            <p className="text-xs text-gray-500">Activity temp</p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <div className="text-center">
            <p className="text-lg font-bold text-white">{stats.totalDTUs || 0}</p>
            <p className="text-[10px] text-gray-500">Total DTUs</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-neon-cyan">{stats.last24h || 0}</p>
            <p className="text-[10px] text-gray-500">Last 24h</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-400">{stats.last7d || 0}</p>
            <p className="text-[10px] text-gray-500">Last 7d</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-purple-400">{data.causalEdges || 0}</p>
            <p className="text-[10px] text-gray-500">Causal Links</p>
          </div>
        </div>
      </div>

      {/* Freshness bar */}
      <div className="px-5 py-3 flex items-center gap-2">
        <span className="text-xs text-gray-500 w-16">Freshness</span>
        <div className="flex-1 flex h-3 rounded-full overflow-hidden bg-lattice-deep">
          {freshness.fresh > 0 && (
            <div
              className="bg-green-500 h-full"
              style={{ width: `${(freshness.fresh / stats.totalDTUs) * 100}%` }}
              title={`Fresh: ${freshness.fresh}`}
            />
          )}
          {freshness.warm > 0 && (
            <div
              className="bg-cyan-500 h-full"
              style={{ width: `${(freshness.warm / stats.totalDTUs) * 100}%` }}
              title={`Warm: ${freshness.warm}`}
            />
          )}
          {freshness.cooling > 0 && (
            <div
              className="bg-amber-500 h-full"
              style={{ width: `${(freshness.cooling / stats.totalDTUs) * 100}%` }}
              title={`Cooling: ${freshness.cooling}`}
            />
          )}
          {freshness.stale > 0 && (
            <div
              className="bg-red-500 h-full"
              style={{ width: `${(freshness.stale / stats.totalDTUs) * 100}%` }}
              title={`Stale: ${freshness.stale}`}
            />
          )}
        </div>
      </div>

      {/* Brain health */}
      <div className="px-5 pb-3">
        <div className="flex items-center gap-3">
          {(
            Object.entries(data.brainHealth || {}) as [
              string,
              { requests: number; errors: number; enabled: boolean },
            ][]
          ).map(([name, health]) => {
            const BrainIcon = BRAIN_ICONS[name] || Brain;
            return (
              <div
                key={name}
                className="flex items-center gap-1.5"
                title={`${name}: ${health.requests} requests, ${health.errors} errors`}
              >
                <BrainIcon
                  className={cn('w-3.5 h-3.5', health.enabled ? 'text-green-400' : 'text-gray-600')}
                />
                <span className="text-[10px] text-gray-500 capitalize">{name}</span>
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    health.enabled ? 'bg-green-400' : 'bg-gray-600'
                  )}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Expand for details */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-2 border-t border-lattice-border text-xs text-gray-500 hover:text-white hover:bg-lattice-deep transition-colors flex items-center justify-center gap-1"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {expanded ? 'Less' : 'Details'}
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-lattice-border pt-3">
          {/* Domain activity */}
          {stats.domainActivity && Object.keys(stats.domainActivity).length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-1">Domain Activity (24h)</h4>
              <div className="flex flex-wrap gap-1">
                {Object.entries(stats.domainActivity)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 10)
                  .map(([domain, count]) => (
                    <span
                      key={domain}
                      className="px-2 py-0.5 bg-lattice-deep rounded text-[10px] text-gray-400"
                    >
                      {domain}: {count as number}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Tier distribution */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-1">Tier Distribution</h4>
            <div className="flex items-center gap-3">
              {(Object.entries(stats.tierDistribution || {}) as [string, number][]).map(
                ([tier, count]) => (
                  <span
                    key={tier}
                    className={cn(
                      'text-xs',
                      tier === 'hyper'
                        ? 'text-yellow-400'
                        : tier === 'mega'
                          ? 'text-purple-400'
                          : 'text-gray-400'
                    )}
                  >
                    {tier}: {count}
                  </span>
                )
              )}
            </div>
          </div>

          {/* System features */}
          <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500">
            <span>Gardens: {data.gardens}</span>
            <span>Episodes: {data.episodes}</span>
            <span>Dreams: {data.dreams}</span>
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSubstrateWeather = withErrorBoundary(SubstrateWeather);
export { _WrappedSubstrateWeather as SubstrateWeather };
