'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import {
  fetchJSON, Loading, ErrorState, Empty,
  type CorpusStats,
} from '@/components/lattice/latticeShared';

export function FederationPanel() {
  const corpusStats = useQuery({
    queryKey: ['lattice-corpus-stats'],
    queryFn: () => fetchJSON<CorpusStats>('/api/lattice/corpus/stats'),
    refetchInterval: 60_000,
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Federation corpus</h2>
      <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
        Per-source-node breakdown of the brain corpus. Federated rows arrive via the
        cnet-federation protocol; they&apos;re given lower implicit weight in daily refresh.
        The federated source breakdown surfaces once a peer is registered.
      </p>
      {corpusStats.isLoading ? (
        <Loading label="Loading federation corpus…" />
      ) : corpusStats.isError ? (
        <ErrorState
          message={(corpusStats.error as Error)?.message ?? 'Failed to load federation corpus.'}
          onRetry={() => corpusStats.refetch()}
          retrying={corpusStats.isFetching}
        />
      ) : (
        <Empty>No federated corpus yet — register a peer via Concord-mesh and the per-source breakdown appears here.</Empty>
      )}
      <div className="mt-6 flex items-center gap-2 text-xs text-fuchsia-700">
        <History className="h-3 w-3" aria-hidden />
        <span>Federation event log surfaces in the Mesh lens (lenses/mesh).</span>
      </div>
    </section>
  );
}
