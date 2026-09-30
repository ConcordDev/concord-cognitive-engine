'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { TopoCard } from '@/components/cognition/TopoCard';

export function ForgettingPanel() {
  const forgettingStatus = useQuery({
    queryKey: ['forgetting-status'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('forgetting', 'status', {});
      return (r.data?.result ?? r.data) as { lastRunAt?: number; threshold?: number; totalForgotten?: number };
    },
    refetchInterval: 30_000,
  });

  const forgettingCandidates = useQuery({
    queryKey: ['forgetting-candidates'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('forgetting', 'candidates', {});
      return (r.data?.result ?? r.data) as Array<{ id: string; retentionScore: number; lastAccessed?: number }>;
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-violet-200">Forgetting candidates</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TopoCard label="Threshold" value={forgettingStatus.data?.threshold?.toFixed(2) ?? '—'} hint="Retention score floor" />
        <TopoCard label="Total forgotten" value={forgettingStatus.data?.totalForgotten ?? 0} hint="Cumulative" />
        <TopoCard label="Pending candidates" value={forgettingCandidates.data?.length ?? 0} hint="Below threshold; awaiting next sweep" tone="warn" />
      </div>
      {forgettingCandidates.data && forgettingCandidates.data.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded border border-violet-900/40">
          <table className="w-full font-mono text-xs">
            <thead className="bg-violet-950/40 text-violet-400">
              <tr><th className="px-3 py-2 text-left">DTU</th><th className="px-3 py-2 text-right">Retention</th><th className="px-3 py-2 text-right">Last accessed</th></tr>
            </thead>
            <tbody>
              {forgettingCandidates.data.slice(0, 50).map(c => (
                <tr key={c.id} className="border-t border-violet-900/20">
                  <td className="px-3 py-1.5 text-violet-300">{c.id}</td>
                  <td className="px-3 py-1.5 text-right">{c.retentionScore?.toFixed(3) ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right text-violet-700">{c.lastAccessed ? new Date(c.lastAccessed * 1000).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
