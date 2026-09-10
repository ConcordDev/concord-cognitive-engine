'use client';

/**
 * StatsPanel — tick statistics grids.
 * Extracted from lenses/tick/page.tsx.
 */

import { Activity, AlertTriangle, BarChart3, Timer, TrendingUp, Zap } from 'lucide-react';
import { useTickStream } from '@/components/tick/TickStreamContext';

export function StatsPanel() {
  const { stats, formatMs } = useTickStream();
  return (
        <div className="space-y-6">
          {/* Core metrics grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <Zap className="w-5 h-5 text-neon-green mb-2" />
              <p className="text-2xl font-bold">{(stats.avgSignal * 100).toFixed(1)}%</p>
              <p className="text-sm text-gray-400">Avg Signal</p>
              <p className="text-xs text-gray-400 mt-1">
                Min: {(stats.minSignal * 100).toFixed(0)}% / Max: {(stats.maxSignal * 100).toFixed(0)}%
              </p>
            </div>
            <div className="lens-card">
              <Activity className="w-5 h-5 text-neon-pink mb-2" />
              <p className="text-2xl font-bold">{(stats.avgStress * 100).toFixed(1)}%</p>
              <p className="text-sm text-gray-400">Avg Stress</p>
              <p className="text-xs text-gray-400 mt-1">
                Min: {(stats.minStress * 100).toFixed(0)}% / Max: {(stats.maxStress * 100).toFixed(0)}%
              </p>
            </div>
            <div className="lens-card">
              <Timer className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold">{formatMs(stats.avgInterval)}</p>
              <p className="text-sm text-gray-400">Avg Interval</p>
              <p className="text-xs text-gray-400 mt-1">
                Min: {formatMs(stats.minInterval)} / Max: {formatMs(stats.maxInterval)}
              </p>
            </div>
            <div className="lens-card">
              <AlertTriangle className="w-5 h-5 text-neon-orange mb-2" />
              <p className="text-2xl font-bold">{stats.missedTicks}</p>
              <p className="text-sm text-gray-400">Missed Ticks</p>
              <p className="text-xs text-gray-400 mt-1">
                Gap &gt; 3x avg interval
              </p>
            </div>
          </div>

          {/* Type breakdown */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-cyan" />
              Event Type Distribution
            </h2>
            <div className="space-y-2">
              {Object.entries(stats.typeBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => {
                  const pct = stats.totalTicks > 0 ? (count / stats.totalTicks) * 100 : 0;
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400 w-24 truncate">{type}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-neon-blue to-neon-cyan"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-400 w-16 text-right">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Organ breakdown */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-purple" />
              Source / Organ Distribution
            </h2>
            <div className="space-y-2">
              {Object.entries(stats.organBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([organ, count]) => {
                  const pct = stats.totalTicks > 0 ? (count / stats.totalTicks) * 100 : 0;
                  return (
                    <div key={organ} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-gray-400 w-24 truncate">{organ}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-pink"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-gray-400 w-16 text-right">
                        {count} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
  );
}
