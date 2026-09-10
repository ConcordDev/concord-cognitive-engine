'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Zap
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function LatticePanel() {
  const { data: meta } = useQuery({ queryKey: ['cc-meta'], queryFn: () => apiHelpers.emergent.status().then(r => r.data), refetchInterval: 30000 });
  const { data: convergences } = useQuery({ queryKey: ['cc-convergences'], queryFn: () => apiHelpers.emergent.resonance().then(r => r.data), refetchInterval: 60000 });
  const { data: pending } = useQuery({ queryKey: ['cc-predictions'], queryFn: () => apiHelpers.metacognition.calibration().then(r => r.data), refetchInterval: 60000 });
  const qc = useQueryClient();
  const triggerMutation = useMutation({ mutationFn: () => apiHelpers.bridge.heartbeatTick(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-meta'] }), onError: (err) => console.error('Meta-derivation trigger failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Lattice Monitor</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Meta-Invariants" value={meta?.totalMetaInvariants ?? '—'} />
        <Stat label="Convergences" value={convergences?.convergences?.length ?? '—'} />
        <Stat label="Pending Predictions" value={pending?.predictions?.length ?? '—'} />
        <Stat label="Cycles Run" value={meta?.cyclesRun ?? '—'} />
      </div>
      <button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-neon-purple/20 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 disabled:opacity-50 transition-colors">
        <Zap className="w-4 h-4" /> {triggerMutation.isPending ? 'Running...' : 'Trigger Meta-Derivation'}
      </button>
    </div>
  );
}
