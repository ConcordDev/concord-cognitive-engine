'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Brain
} from 'lucide-react';
import { StatusDot, Stat } from '@/components/command-center/cc-primitives';


export function BrainsPanel() {
  const { data } = useQuery({ queryKey: ['cc-brains'], queryFn: () => apiHelpers.brain.status().then(r => r.data), refetchInterval: 10000 });

  const brains = data?.brains as Record<string, { enabled: boolean; model: string; role: string; url: string; stats: { requests: number; totalMs: number; dtusGenerated: number; errors: number; fixes?: number; sleeping?: boolean; lastCallAt: string | null }; avgResponseMs: number }> | undefined;
  const mode = data?.mode || 'fallback';
  const onlineCount = data?.onlineCount ?? 0;
  const totalBrains = brains ? Object.keys(brains).length : 0;

  const modeColor = (mode === 'four_brain' || mode === 'three_brain') ? 'text-neon-green' : mode === 'partial' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Four-Brain Architecture</h3>
      <div className="flex items-center gap-3">
        <span className={`text-lg font-bold ${modeColor}`}>{mode.replace('_', '-')}</span>
        <span className="text-sm text-gray-400">{onlineCount}/{totalBrains} online</span>
      </div>
      {brains && Object.entries(brains).map(([name, brain]) => (
        <div key={name} className={`bg-lattice-surface rounded-lg p-3 border border-lattice-border ${!brain.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusDot status={brain.enabled ? 'green' : 'red'} />
              <span className="text-sm font-medium text-white capitalize">{name}</span>
              <span className="text-[10px] text-gray-400">{brain.model}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-2">{brain.role}</p>
          {brain.enabled && (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Requests" value={brain.stats.requests} />
              <Stat label="Avg ms" value={brain.avgResponseMs || (brain.stats.requests > 0 ? Math.round(brain.stats.totalMs / brain.stats.requests) : 0)} />
              <Stat label="Errors" value={brain.stats.errors} />
            </div>
          )}
          {brain.stats.fixes !== undefined && (
            <div className="mt-2 text-xs text-gray-400">Fixes applied: <span className="font-mono text-neon-green">{brain.stats.fixes}</span></div>
          )}
        </div>
      ))}
    </div>
  );
}
