'use client';

/**
 * HealthPanel — derived tick health score + indicators.
 * Extracted from lenses/tick/page.tsx.
 */

import {
  Activity, AlertTriangle, BarChart3, CheckCircle, Clock, Timer, Zap,
} from 'lucide-react';
import { useTickStream } from '@/components/tick/TickStreamContext';

export function HealthPanel() {
  const { stats, healthStatus } = useTickStream();
  return (
        <div className="space-y-6">
          {/* Overall health banner */}
          <div className={`panel p-6 border-l-4 ${
            healthStatus.level === 'healthy'
              ? 'border-l-green-500'
              : healthStatus.level === 'degraded'
              ? 'border-l-yellow-500'
              : 'border-l-red-500'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {healthStatus.level === 'healthy' ? (
                  <CheckCircle className="w-8 h-8 text-green-400" />
                ) : healthStatus.level === 'degraded' ? (
                  <AlertTriangle className="w-8 h-8 text-yellow-400" />
                ) : (
                  <AlertTriangle className="w-8 h-8 text-red-400" />
                )}
                <div>
                  <h2 className="text-lg font-bold capitalize">{healthStatus.level}</h2>
                  <p className="text-sm text-gray-400">{healthStatus.message}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-4xl font-bold font-mono ${
                  healthStatus.score >= 80 ? 'text-green-400'
                  : healthStatus.score >= 50 ? 'text-yellow-400'
                  : 'text-red-400'
                }`}>
                  {healthStatus.score}
                </p>
                <p className="text-xs text-gray-400">Health Score</p>
              </div>
            </div>
          </div>

          {/* Health indicators grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              {
                label: 'Tick Regularity',
                value: stats.avgInterval > 0 && stats.maxInterval > 0
                  ? Math.max(0, 100 - ((stats.maxInterval / stats.minInterval - 1) * 10))
                  : 0,
                good: 'Consistent intervals',
                bad: 'Irregular intervals',
                icon: Timer,
              },
              {
                label: 'Stress Level',
                value: Math.max(0, 100 - stats.avgStress * 200),
                good: 'Low stress',
                bad: 'Elevated stress',
                icon: Activity,
              },
              {
                label: 'Signal Strength',
                value: stats.avgSignal * 100,
                good: 'Strong signals',
                bad: 'Weak signals',
                icon: Zap,
              },
              {
                label: 'Error Rate',
                value: stats.totalTicks > 0
                  ? Math.max(0, 100 - ((stats.typeBreakdown['error'] || 0) / stats.totalTicks) * 500)
                  : 100,
                good: 'No errors',
                bad: 'Errors detected',
                icon: AlertTriangle,
              },
              {
                label: 'Tick Coverage',
                value: stats.totalTicks > 0 ? Math.min(100, (stats.totalTicks / 50) * 100) : 0,
                good: 'Sufficient data',
                bad: 'Insufficient data',
                icon: BarChart3,
              },
              {
                label: 'Gap Detection',
                value: Math.max(0, 100 - stats.missedTicks * 20),
                good: 'No gaps',
                bad: `${stats.missedTicks} gaps detected`,
                icon: Clock,
              },
            ].map(indicator => {
              const pct = Math.min(100, Math.max(0, indicator.value));
              const statusColor = pct >= 80 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400';
              const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <div key={indicator.label} className="panel p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <indicator.icon className={`w-4 h-4 ${statusColor}`} />
                      <span className="text-xs font-medium">{indicator.label}</span>
                    </div>
                    <span className={`text-sm font-mono font-bold ${statusColor}`}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2">
                    {pct >= 70 ? indicator.good : indicator.bad}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
  );
}
