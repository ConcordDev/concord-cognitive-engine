'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Loader2 } from 'lucide-react';
import {
  fetchJSON, Loading, ErrorState, Stat, Empty,
  type MineSummary,
} from '@/components/lattice/latticeShared';

export function ConsentPanel() {
  const qc = useQueryClient();
  const myCorpus = useQuery({
    queryKey: ['lattice-corpus-mine'],
    queryFn: () => fetchJSON<MineSummary>('/api/lattice/corpus/mine'),
    refetchInterval: 60_000,
  });
  const bulkConsent = useMutation({
    mutationFn: (consented: boolean) =>
      fetchJSON('/api/lattice/dtus/consent-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consented }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lattice-corpus-mine'] });
      qc.invalidateQueries({ queryKey: ['lattice-corpus-stats'] });
    },
  });

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fuchsia-200">Training consent</h2>
        <div className="flex gap-2">
          <button
            onClick={() => bulkConsent.mutate(true)}
            disabled={bulkConsent.isPending}
            className="inline-flex items-center gap-1 rounded bg-emerald-700/40 px-2 py-1 text-xs hover:bg-emerald-600/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {bulkConsent.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />} Consent all
          </button>
          <button
            onClick={() => bulkConsent.mutate(false)}
            disabled={bulkConsent.isPending}
            className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 text-xs hover:bg-rose-800/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            <X className="h-3 w-3" aria-hidden /> Revoke all
          </button>
        </div>
      </div>
      <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
        Training consent is per-creator and account-wide. &ldquo;Consent all&rdquo; opts every
        DTU you have authored into the lattice training corpus; &ldquo;Revoke all&rdquo; opts
        them back out. Every flip is recorded in the Audit tab.
      </p>
      {myCorpus.isLoading ? (
        <Loading label="Loading your consent summary…" />
      ) : myCorpus.isError ? (
        <ErrorState
          message={(myCorpus.error as Error)?.message ?? 'Failed to load your consent summary.'}
          onRetry={() => myCorpus.refetch()}
          retrying={myCorpus.isFetching}
        />
      ) : (myCorpus.data?.total ?? 0) === 0 ? (
        <Empty>You haven&apos;t authored any DTUs yet — once you do, they join your consent corpus and these counts populate.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="My DTUs" value={myCorpus.data!.total} />
          <Stat label="Consented" value={myCorpus.data!.consented} />
          <Stat label="Consent ratio" value={`${(myCorpus.data!.ratio * 100).toFixed(1)}%`} />
        </div>
      )}
      {bulkConsent.isError && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-rose-400" role="alert">
          <X className="h-3 w-3" aria-hidden /> {(bulkConsent.error as Error)?.message ?? 'Consent update failed'}
        </p>
      )}
    </section>
  );
}
