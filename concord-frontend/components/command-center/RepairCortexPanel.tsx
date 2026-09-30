'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  ShieldAlert
} from 'lucide-react';
import { StatusDot, Stat } from '@/components/command-center/cc-primitives';


export function RepairCortexPanel() {
  const { data: status } = useQuery({ queryKey: ['cc-repair'], queryFn: () => apiHelpers.repairExtended.fullStatus().then(r => r.data), refetchInterval: 15000 });
  const qc = useQueryClient();
  const forceMutation = useMutation({ mutationFn: () => apiHelpers.repairExtended.forceCycle(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-repair'] }), onError: (err) => console.error('Force repair failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Repair Cortex</h3>
      {status ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Cycles" value={status.cycleCount ?? 0} />
            <Stat label="Error Accum" value={status.errorAccumulatorSize ?? 0} />
            <Stat label="Executors" value={`${status.executorsReady ?? 0}/${status.executorCount ?? 0}`} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <StatusDot status={status.running ? 'green' : 'red'} />
            <span className="text-gray-400">Loop: {status.running ? 'Active' : 'Stopped'}</span>
            {status.lastCycleAt && <span className="text-gray-400 ml-auto">Last: {new Date(status.lastCycleAt).toLocaleString()}</span>}
          </div>
          {status.networkStatus && (
            <p className="text-xs text-gray-400">Network: {status.networkStatus}</p>
          )}
          <button onClick={() => forceMutation.mutate()} disabled={forceMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 disabled:opacity-50 transition-colors">
            <ShieldAlert className="w-4 h-4" /> {forceMutation.isPending ? 'Running...' : 'Force Repair Cycle'}
          </button>
        </>
      ) : (
        <p className="text-xs text-gray-400">Loading...</p>
      )}
    </div>
  );
}
