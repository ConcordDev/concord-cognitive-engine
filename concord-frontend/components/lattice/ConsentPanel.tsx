'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import {
  fetchJSON, Loading, ErrorState, Stat, Empty,
  type MineSummary,
} from '@/components/lattice/latticeShared';

export function ConsentPanel() {
  const qc = useQueryClient();
  // F9 (Lead-adopted 2026-11-03): the GRANT direction confirms, with
  // scope + count stated — consent that doesn't state what it covers
  // isn't informed. Revoking never confirms: the safety direction
  // must never be slowed.
  const [armGrant, setArmGrant] = useState(false);
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
      setArmGrant(false);
      qc.invalidateQueries({ queryKey: ['lattice-corpus-mine'] });
      qc.invalidateQueries({ queryKey: ['lattice-corpus-stats'] });
      qc.invalidateQueries({ queryKey: ['lattice-consent-log'] });
    },
  });

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-fuchsia-200">Training consent</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setArmGrant(true)}
            disabled={bulkConsent.isPending}
            className="inline-flex items-center gap-1 rounded bg-emerald-700/40 px-2 py-1 text-xs hover:bg-emerald-600/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <Check className="h-3 w-3" aria-hidden /> Consent all
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
      {armGrant && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-100" role="alert">
          <span className="flex-1">
            Grant training consent for <strong>all {myCorpus.data?.total ?? 0} of your DTUs</strong>?
            {' '}{(myCorpus.data?.total ?? 0) - (myCorpus.data?.consented ?? 0)} are not yet consented.
            This is account-wide: every DTU you have authored joins the lattice training corpus. The flip is recorded in the Audit tab.
          </span>
          <button
            onClick={() => bulkConsent.mutate(true)}
            disabled={bulkConsent.isPending}
            className="inline-flex items-center gap-1 rounded bg-emerald-700/60 px-2 py-1 font-medium hover:bg-emerald-600/70 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {bulkConsent.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Check className="h-3 w-3" aria-hidden />}
            Grant consent for all {myCorpus.data?.total ?? 0}
          </button>
          <button
            onClick={() => setArmGrant(false)}
            className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            Cancel
          </button>
        </div>
      )}
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
          <Stat label="Consented (my DTU rows)" value={myCorpus.data!.consented} />
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
