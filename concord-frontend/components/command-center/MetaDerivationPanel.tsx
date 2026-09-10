'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  GitBranch
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function MetaDerivationPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['meta-derivation-status'],
    queryFn: () => apiHelpers.metaDerivation.status().then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: invariantsData } = useQuery({
    queryKey: ['meta-derivation-invariants'],
    queryFn: () => apiHelpers.metaDerivation.invariants().then(r => r.data),
    retry: false,
  });

  const { data: convergencesData } = useQuery({
    queryKey: ['meta-derivation-convergences'],
    queryFn: () => apiHelpers.metaDerivation.convergences().then(r => r.data),
    retry: false,
  });

  if (isLoading) return <div className="h-24 bg-lattice-deep animate-pulse rounded-lg" />;

  const metrics = data?.metrics || {};
  const invariants = invariantsData?.invariants || [];
  const convergences = convergencesData?.convergences || [];

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Meta-Invariants" value={data?.invariantCount || 0} />
        <Stat label="Convergences" value={data?.convergenceCount || 0} />
        <Stat label="Pending Predictions" value={data?.pendingPredictions || 0} />
        <Stat label="Cycles Run" value={metrics.cyclesRun || 0} />
      </div>

      {/* Invariants */}
      {invariants.length > 0 && (
        <div>
          <h4 className="text-xs uppercase text-gray-400 mb-2">Discovered Meta-Invariants</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {invariants.slice(0, 20).map((inv: { id: string; statement: string; confidence: number; domains: string[] }, i: number) => (
              <div key={inv.id || i} className="bg-lattice-surface border border-lattice-border rounded p-3">
                <p className="text-xs text-white">{inv.statement || JSON.stringify(inv).slice(0, 200)}</p>
                {inv.confidence != null && (
                  <span className="text-[10px] text-gray-400">Confidence: {(inv.confidence * 100).toFixed(0)}%</span>
                )}
                {inv.domains?.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {inv.domains.map((d: string) => (
                      <span key={d} className="text-[9px] px-1.5 py-0.5 rounded bg-lattice-deep text-neon-cyan">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Convergences */}
      {convergences.length > 0 && (
        <div>
          <h4 className="text-xs uppercase text-gray-400 mb-2">Dream-Lattice Convergences</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {convergences.slice(0, 10).map((c: { id: string; similarity: number; description: string }, i: number) => (
              <div key={c.id || i} className="bg-lattice-surface border border-purple-500/30 rounded p-3">
                <p className="text-xs text-purple-300">{c.description || JSON.stringify(c).slice(0, 200)}</p>
                {c.similarity != null && (
                  <span className="text-[10px] text-gray-400">Similarity: {(c.similarity * 100).toFixed(0)}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {invariants.length === 0 && convergences.length === 0 && (
        <div className="text-center py-8">
          <GitBranch className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-400">No meta-derivations yet</p>
          <p className="text-xs text-gray-400 mt-1">Meta-derivation runs every 200th tick when sufficient invariants exist</p>
        </div>
      )}
    </div>
  );
}
