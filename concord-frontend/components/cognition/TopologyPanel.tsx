'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { LatticeTopologyGraph, type Topology } from '@/components/cognition/LatticeTopologyGraph';
import { TopoCard } from '@/components/cognition/TopoCard';
import { Loader2, RefreshCw } from 'lucide-react';

export function TopologyPanel() {
  const topology = useQuery({
    queryKey: ['hlm-topology'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlm', 'topology', {});
      return (r.data?.result ?? r.data) as Topology & { gaps?: unknown[]; redundancies?: unknown[] };
    },
    refetchInterval: 60_000,
  });

  const triggerHLMPass = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlm', 'run', {});
      return r.data?.result ?? r.data;
    },
    onSuccess: () => topology.refetch(),
  });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-violet-200">Lattice topology</h2>
        <button
          onClick={() => triggerHLMPass.mutate()}
          disabled={triggerHLMPass.isPending}
          className="inline-flex items-center gap-2 rounded border border-violet-700/50 bg-violet-900/20 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-800/40 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
        >
          {triggerHLMPass.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Run HLM pass
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TopoCard label="Clusters" value={topology.data?.clusters?.length ?? 0} hint="Cohesive DTU groupings" />
        <TopoCard label="Gaps" value={topology.data?.gaps?.length ?? 0} hint="Domains thinly populated" tone="warn" />
        <TopoCard label="Redundancies" value={topology.data?.redundancies?.length ?? 0} hint="Likely-duplicate substrate" tone="warn" />
      </div>
      <div className="mt-4">
        {topology.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
        ) : (
          <LatticeTopologyGraph topology={topology.data ?? null} />
        )}
      </div>
      {topology.data?.clusters && topology.data.clusters.length > 0 && (
        <details className="mt-4 rounded border border-violet-900/30 bg-violet-950/10">
          <summary className="cursor-pointer px-3 py-2 text-xs text-violet-300">Inspect raw topology JSON</summary>
          <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] text-violet-400">{JSON.stringify(topology.data, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
