'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Focus
} from 'lucide-react';


export function AttentionPanel() {
  const { data: status } = useQuery({ queryKey: ['cc-attention'], queryFn: () => apiHelpers.attentionAlloc.status().then(r => r.data), refetchInterval: 15000 });
  const qc = useQueryClient();
  const unfocusMutation = useMutation({ mutationFn: () => apiHelpers.attentionAlloc.unfocus(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-attention'] }), onError: (err) => console.error('Unfocus failed:', err instanceof Error ? err.message : err) });

  const allocation = (status?.lastAllocation?.allocation || []) as Array<{ domain: string; budget: number; urgency: number; focused?: boolean }>;
  const focusOverride = status?.focusOverride as { domain: string; weight: number; expiresAt: string } | null;
  const totalBudget = allocation.reduce((sum: number, a: { budget: number }) => sum + a.budget, 0) || 1;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Attention Allocator</h3>
      {focusOverride && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <Focus className="w-4 h-4" />
            <span>Focus: <strong>{focusOverride.domain}</strong> @ {(focusOverride.weight * 100).toFixed(0)}%</span>
          </div>
          <button onClick={() => unfocusMutation.mutate()} disabled={unfocusMutation.isPending} className="text-xs text-red-400 hover:underline disabled:opacity-50">
            Clear
          </button>
        </div>
      )}
      <div className="space-y-2">
        {allocation.slice(0, 15).map((a: { domain: string; budget: number; urgency: number; focused?: boolean }) => (
          <div key={a.domain} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate text-gray-300" title={a.domain}>{a.domain}</span>
            <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${a.focused ? 'bg-yellow-500' : 'bg-neon-cyan/60'}`} style={{ width: `${Math.max(2, (a.budget / totalBudget) * 100)}%` }} />
            </div>
            <span className="w-8 text-right text-gray-400 font-mono">{a.budget}</span>
            <span className="w-12 text-right text-gray-400">{(a.urgency * 100).toFixed(0)}%</span>
          </div>
        ))}
        {allocation.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No allocation data yet</p>}
      </div>
    </div>
  );
}
