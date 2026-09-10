'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Puzzle
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function PluginPanel() {
  const { data } = useQuery({ queryKey: ['cc-plugins'], queryFn: () => apiHelpers.marketplace.installed().then(r => r.data), refetchInterval: 30000 });
  const { data: metrics } = useQuery({ queryKey: ['cc-plugin-metrics'], queryFn: () => apiHelpers.marketplace.listings().then(r => r.data), refetchInterval: 30000 });

  const plugins = (data?.plugins || []) as Array<{ id: string; name: string; version: string; isEmergentGen: boolean; author: string }>;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Plugin Manager</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Loaded" value={metrics?.loadedCount ?? 0} />
        <Stat label="Pending Governance" value={metrics?.pendingGovernanceCount ?? 0} />
      </div>
      <div className="space-y-2">
        {plugins.map(p => (
          <div key={p.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-sm">
            <Puzzle className="w-4 h-4 text-neon-green" />
            <span className="text-white flex-1 truncate">{p.name}</span>
            <span className="text-xs text-gray-400">v{p.version}</span>
            {p.isEmergentGen && <span className="text-[10px] bg-neon-purple/20 text-neon-purple px-1.5 py-0.5 rounded">emergent</span>}
          </div>
        ))}
        {plugins.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No plugins loaded</p>}
      </div>
    </div>
  );
}
