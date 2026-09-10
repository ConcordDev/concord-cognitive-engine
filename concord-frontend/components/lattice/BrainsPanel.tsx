'use client';

import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import {
  fetchJSON, Loading, ErrorState, Empty,
  type BrainStats, type ActiveModels,
} from '@/components/lattice/latticeShared';

export function BrainsPanel() {
  const brainStats = useQuery({
    queryKey: ['lattice-brains-stats'],
    queryFn: () => fetchJSON<BrainStats>('/api/brains/stats'),
    refetchInterval: 30_000,
  });
  const activeModels = useQuery({
    queryKey: ['lattice-brains-active'],
    queryFn: () => fetchJSON<ActiveModels>('/api/brains/active'),
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Brain corpus health</h2>
      {brainStats.isLoading ? (
        <Loading label="Loading brain stats…" />
      ) : brainStats.isError ? (
        <ErrorState
          message={(brainStats.error as Error)?.message ?? 'Failed to load brain stats.'}
          onRetry={() => brainStats.refetch()}
          retrying={brainStats.isFetching}
        />
      ) : (brainStats.data?.brains ?? []).length === 0 ? (
        <Empty>No brain interactions recorded yet — corpus counts appear as the brains are exercised.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {brainStats.data!.brains.map((b) => (
            <div key={b.brainId} className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-fuchsia-200">{b.brainId}</span>
                <span className="rounded bg-fuchsia-800/30 px-1.5 py-0.5 text-[10px] text-fuchsia-300">{b.total} interactions</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-fuchsia-500">
                <div>Positive: <span className="text-emerald-400">{b.positive}</span></div>
                <div>Pending: <span className="text-amber-400">{b.pending}</span></div>
                <div>Consented: <span className="text-fuchsia-200">{b.consented}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Active models</h3>
      {activeModels.isLoading ? (
        <Loading label="Loading active models…" />
      ) : activeModels.isError ? (
        <ErrorState
          message={(activeModels.error as Error)?.message ?? 'Failed to load active models.'}
          onRetry={() => activeModels.refetch()}
          retrying={activeModels.isFetching}
        />
      ) : (activeModels.data?.active ?? []).length === 0 ? (
        <Empty>No evolved model is active yet — trigger a refresh on the Refresh tab to build one.</Empty>
      ) : (
        <ul className="space-y-1">
          {activeModels.data!.active.map((a) => (
            <li key={a.brain_id} className="flex flex-wrap items-center gap-3 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2 text-xs">
              <Brain className="h-3.5 w-3.5 text-fuchsia-500" aria-hidden />
              <span className="font-mono text-fuchsia-300">{a.brain_id}</span>
              <span className="text-fuchsia-100">{a.model_name}</span>
              {a.base_model && <span className="text-fuchsia-700">on {a.base_model}</span>}
              {a.eval_score != null && <span className="ml-auto rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300">eval {a.eval_score.toFixed(2)}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
