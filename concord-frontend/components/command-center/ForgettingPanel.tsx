'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Trash2, Clock
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function ForgettingPanel() {
  const { data: status } = useQuery({ queryKey: ['cc-forgetting'], queryFn: () => apiHelpers.forgetting.status().then(r => r.data), refetchInterval: 30000 });
  const qc = useQueryClient();
  const runMutation = useMutation({ mutationFn: () => apiHelpers.forgetting.run(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-forgetting'] }), onError: (err) => console.error('Forgetting cycle failed:', err instanceof Error ? err.message : err) });
  const { data: candidates } = useQuery({ queryKey: ['cc-forgetting-candidates'], queryFn: () => apiHelpers.forgetting.candidates().then(r => r.data), refetchInterval: 60000 });
  const { data: historyData } = useQuery({ queryKey: ['cc-forgetting-history'], queryFn: () => apiHelpers.forgetting.history(5).then(r => r.data).catch(() => ({ tombstones: [] })), refetchInterval: 60000 });
  const recentTombstones = (historyData?.tombstones || []) as Array<{ id: string; title?: string; tier?: string; forgottenAt?: string }>;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Forgetting Engine</h3>

      {/* Cycle indicator */}
      {status && status.lifetimeForgotten > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">
            {status.lifetimeForgotten} DTUs archived (low salience, threshold: {status.threshold})
          </span>
        </div>
      )}

      {status && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Tombstones" value={status.tombstones ?? 0} />
            <Stat label="Lifetime" value={status.lifetimeForgotten ?? 0} />
            <Stat label="Threshold" value={status.threshold ?? 0} />
          </div>
          {status.lastRun && (
            <p className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Last: {new Date(status.lastRun).toLocaleString()}</p>
          )}
        </>
      )}
      {candidates && (
        <p className="text-xs text-gray-400">{candidates.candidateCount ?? 0} candidates for forgetting</p>
      )}
      <div className="flex gap-2">
        <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 transition-colors">
          <Trash2 className="w-4 h-4" /> {runMutation.isPending ? 'Running...' : 'Run Forgetting Cycle'}
        </button>
      </div>

      {/* Recent tombstones */}
      {recentTombstones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-400">Recently archived</p>
          {recentTombstones.map(t => (
            <div key={t.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 text-xs border border-lattice-border">
              <Trash2 className="w-3 h-3 text-red-400 flex-shrink-0" />
              <span className="text-gray-300 truncate flex-1">{t.title || t.id}</span>
              {t.tier && <span className="text-gray-400 text-[10px]">{t.tier}</span>}
              {t.forgottenAt && <span className="text-gray-600 text-[10px]">{new Date(t.forgottenAt).toLocaleTimeString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
