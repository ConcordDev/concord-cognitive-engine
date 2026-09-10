'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import {
  Lightbulb
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function BreakthroughPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['breakthrough-list'],
    queryFn: () => apiHelpers.breakthrough.list().then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: metricsData } = useQuery({
    queryKey: ['breakthrough-metrics'],
    queryFn: () => apiHelpers.breakthrough.metrics().then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const queryClient = useQueryClient();
  const initMutation = useMutation({
    mutationFn: (clusterId: string) => apiHelpers.breakthrough.init(clusterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['breakthrough-list'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });
  const researchMutation = useMutation({
    mutationFn: (clusterId: string) => apiHelpers.breakthrough.research(clusterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['breakthrough-list'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const clusters = data?.clusters || [];

  return (
    <div className="space-y-4">
      {/* Metrics summary */}
      {metricsData && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total Clusters" value={metricsData.totalClusters || 0} />
          <Stat label="Total DTUs" value={metricsData.totalDTUs || 0} />
          <Stat label="Research Jobs" value={metricsData.totalResearchJobs || 0} />
        </div>
      )}

      {isLoading ? (
        <div className="h-24 bg-lattice-deep animate-pulse rounded-lg" />
      ) : clusters.length === 0 ? (
        <div className="text-center py-8">
          <Lightbulb className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-400">No breakthrough clusters initialized</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clusters.map((c: { id: string; name: string; domain: string; initialized: boolean; dtuCount: number; researchCount: number }) => (
            <div key={c.id} className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-semibold text-white">{c.name}</h4>
                  <span className="text-[10px] text-gray-400">{c.domain}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded ${c.initialized ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {c.initialized ? 'Active' : 'Dormant'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-2">
                <span>{c.dtuCount || 0} DTUs</span>
                <span>{c.researchCount || 0} research jobs</span>
              </div>
              <div className="flex gap-2">
                {!c.initialized && (
                  <button onClick={() => initMutation.mutate(c.id)} disabled={initMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/30 disabled:opacity-50">
                    Initialize
                  </button>
                )}
                {c.initialized && (
                  <button onClick={() => researchMutation.mutate(c.id)} disabled={researchMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 disabled:opacity-50">
                    Trigger Research
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
