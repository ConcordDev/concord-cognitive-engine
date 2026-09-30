'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Stat, BreakerBadge } from '@/components/command-center/cc-primitives';


export function PipelinePanel() {
  const { data: queue } = useQuery({ queryKey: ['cc-queue'], queryFn: () => apiHelpers.backpressure.status().then(r => r.data), refetchInterval: 10000 });
  const { data: breakers } = useQuery({ queryKey: ['cc-breakers'], queryFn: () => apiHelpers.status.get().then(r => r.data), refetchInterval: 15000 });
  const qc = useQueryClient();
  const resetBreakers = useMutation({ mutationFn: () => apiHelpers.perf.gc(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-breakers'] }), onError: (err) => console.error('Circuit breaker reset failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">LLM Pipeline</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Queue Depth" value={queue?.depth ?? '—'} />
        <Stat label="Processing" value={queue?.processing ?? '—'} />
        <Stat label="Completed" value={queue?.completed ?? '—'} />
        <Stat label="Rejected" value={queue?.rejected ?? '—'} />
      </div>
      {breakers?.breakers && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase">Breakers</p>
            <button onClick={() => resetBreakers.mutate()} disabled={resetBreakers.isPending} className="text-[10px] text-neon-cyan hover:underline disabled:opacity-50 disabled:cursor-not-allowed">{resetBreakers.isPending ? 'Resetting...' : 'Reset All'}</button>
          </div>
          {Object.entries(breakers.breakers as Record<string, { state: string }>).map(([name, b]) => (
            <BreakerBadge key={name} name={name} state={b.state || 'unknown'} />
          ))}
        </div>
      )}
    </div>
  );
}
