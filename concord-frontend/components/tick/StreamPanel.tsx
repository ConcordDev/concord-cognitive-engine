'use client';

/**
 * StreamPanel — live tick metrics + ECG + event log.
 * Extracted from lenses/tick/page.tsx.
 */

import { motion } from 'framer-motion';
import { Activity, RefreshCw, Clock, Zap, Heart } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useTickStream } from '@/components/tick/TickStreamContext';
import { HeartbeatLineCanvas } from '@/components/tick/tick-model';

export function StreamPanel() {
  const { tickHistory, isLive, stats, isLoading, isError, error, refetch } = useTickStream();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
        <>
          {/* Tick Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <Clock className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold">{tickHistory.length}</p>
              <p className="text-sm text-gray-400">Total Ticks</p>
            </div>
            <div className="lens-card">
              <Zap className="w-5 h-5 text-neon-green mb-2" />
              <p className="text-2xl font-bold">{(stats.avgSignal * 100).toFixed(0)}%</p>
              <p className="text-sm text-gray-400">Avg Signal</p>
            </div>
            <div className="lens-card">
              <Activity className="w-5 h-5 text-neon-pink mb-2" />
              <p className="text-2xl font-bold">{(stats.avgStress * 100).toFixed(0)}%</p>
              <p className="text-sm text-gray-400">Avg Stress</p>
            </div>
            <div className="lens-card">
              <RefreshCw className={`w-5 h-5 text-neon-cyan mb-2 ${isLive ? 'animate-spin' : ''}`} />
              <p className="text-2xl font-bold">{isLive ? '2s' : '\u2014'}</p>
              <p className="text-sm text-gray-400">Refresh Rate</p>
            </div>
          </div>

          {/* Heartbeat ECG Visualization */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Heart className="w-4 h-4 text-neon-green" />
              Heartbeat Monitor
            </h2>
            <div className="h-40 rounded-lg overflow-hidden border border-white/5">
              <HeartbeatLineCanvas ticks={tickHistory} isLive={isLive} />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-2">
              <span>Oldest</span>
              <span className="text-gray-600">
                {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full bg-neon-green mr-1 animate-pulse" />}
                {tickHistory.length} events
              </span>
              <span>Most Recent</span>
            </div>
          </div>

          {/* Signal Wave Visualization */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-neon-blue" />
              Signal Wave
            </h2>
            <div className="h-32 flex items-end gap-1">
              {tickHistory.slice(0, 40).map((tick) => (
                <div
                  key={tick.id}
                  className="flex-1 bg-gradient-to-t from-neon-blue to-neon-cyan rounded-t transition-all"
                  style={{
                    height: `${tick.signal * 100}%`,
                    opacity: 0.5 + (tick.signal * 0.5),
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-2">
              <span>Oldest</span>
              <span>Most Recent</span>
            </div>
          </div>

          {/* Tick Event Log */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-neon-purple" />
              Tick Event Log
            </h2>
            <div className="space-y-2 max-h-80 overflow-auto">
              {tickHistory.slice(0, 20).map((tick, index) => (
                <motion.div
                  key={tick.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      tick.stress > 0.2 ? 'bg-neon-pink' : 'bg-neon-green'
                    }`} />
                    <div>
                      <p className="text-sm font-medium">{tick.type}</p>
                      <p className="text-xs text-gray-400">{tick.organ}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono text-neon-cyan">
                      {(tick.signal * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(tick.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </>
  );
}
