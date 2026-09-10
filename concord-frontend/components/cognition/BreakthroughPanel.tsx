'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { TopoCard } from '@/components/cognition/TopoCard';
import { Sparkles } from 'lucide-react';

export function BreakthroughPanel() {
  const breakthroughMetrics = useQuery({
    queryKey: ['breakthrough-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('breakthrough', 'metrics', {});
      return (r.data?.result ?? r.data) as { totalClusters?: number; activeClusters?: number; recentBreakthroughs?: unknown[] };
    },
    refetchInterval: 60_000,
  });

  const clusters = useQuery({
    queryKey: ['breakthrough-clusters'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('breakthrough', 'list', {});
      return (r.data?.result ?? r.data) as Array<{ id: string; topic?: string; status?: string; dtuCount?: number }>;
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-violet-200">Cross-domain synthesis clusters</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TopoCard label="Total clusters" value={breakthroughMetrics.data?.totalClusters ?? clusters.data?.length ?? 0} hint="Long-running research lines" />
        <TopoCard label="Active" value={breakthroughMetrics.data?.activeClusters ?? 0} hint="Currently iterating" tone="ok" />
        <TopoCard label="Recent breakthroughs" value={(breakthroughMetrics.data?.recentBreakthroughs as unknown[] | undefined)?.length ?? 0} hint="Surfaced in last pass" tone="ok" />
      </div>
      {clusters.data && clusters.data.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {clusters.data.map(c => (
            <li key={c.id} className="flex items-center gap-3 rounded border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              <span className="font-mono text-violet-300">{c.id}</span>
              {c.topic && <span className="text-violet-100">{c.topic}</span>}
              <span className="ml-auto rounded bg-violet-800/30 px-1.5 py-0.5 text-[10px] text-violet-300">{c.status ?? '—'}</span>
              <span className="text-[10px] text-violet-700">{c.dtuCount ?? 0} DTUs</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-violet-700">No breakthrough clusters yet. The lattice-orchestrator runs cluster passes every ~60 min.</p>
      )}
    </section>
  );
}
