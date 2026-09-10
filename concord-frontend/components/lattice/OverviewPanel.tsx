'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Info } from 'lucide-react';
import {
  fetchJSON, Loading, ErrorState, Stat, Empty,
  type CorpusStats,
} from '@/components/lattice/latticeShared';

export function OverviewPanel() {
  const corpusStats = useQuery({
    queryKey: ['lattice-corpus-stats'],
    queryFn: () => fetchJSON<CorpusStats>('/api/lattice/corpus/stats'),
    refetchInterval: 60_000,
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Consent corpus snapshot</h2>
      {corpusStats.isLoading ? (
        <Loading label="Loading corpus stats…" />
      ) : corpusStats.isError ? (
        <ErrorState
          message={(corpusStats.error as Error)?.message ?? 'Failed to load corpus stats.'}
          onRetry={() => corpusStats.refetch()}
          retrying={corpusStats.isFetching}
        />
      ) : (corpusStats.data?.tables ?? []).length === 0 ? (
        <Empty>No consent-tracking tables present on this instance yet.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Total rows" value={corpusStats.data!.totals.total} />
            <Stat label="Consented" value={corpusStats.data!.totals.consented} />
            <Stat label="Consent ratio" value={`${(corpusStats.data!.totals.ratio * 100).toFixed(1)}%`} />
          </div>
          <h3 className="mt-6 mb-2 text-sm font-semibold text-fuchsia-300">Per-table consent</h3>
          <div className="overflow-x-auto rounded border border-fuchsia-900/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-fuchsia-950/40 text-fuchsia-400">
                <tr>
                  <th className="px-3 py-2 text-left">Table</th>
                  <th className="px-3 py-2 text-left">Regime</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Consented</th>
                  <th className="px-3 py-2 text-right">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {corpusStats.data!.tables.map((t) => (
                  <tr key={t.name} className="border-t border-fuchsia-900/20">
                    <td className="px-3 py-2 text-fuchsia-300">{t.name}</td>
                    <td className="px-3 py-2 text-fuchsia-600">{t.regime}</td>
                    <td className="px-3 py-2 text-right text-fuchsia-200">{t.total}</td>
                    <td className="px-3 py-2 text-right text-emerald-400">{t.consented}</td>
                    <td className="px-3 py-2 text-right text-fuchsia-400">{(t.ratio * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="mt-6 flex items-start gap-2 rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-3 py-2.5 text-xs text-fuchsia-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fuchsia-500" aria-hidden />
        <p>
          This lens surfaces the <span className="text-fuchsia-400">brain self-training pipeline</span> only
          (consent corpus, per-brain refresh, MLOps run tracking) — the backend&apos;s <code className="rounded bg-fuchsia-950/40 px-1">lattice</code>{' '}
          macro domain (<code className="rounded bg-fuchsia-950/40 px-1">beacon</code> /{' '}
          <code className="rounded bg-fuchsia-950/40 px-1">birth_protocol</code> /{' '}
          <code className="rounded bg-fuchsia-950/40 px-1">resonance</code>) is an unrelated, coincidentally
          same-named subsystem — the Chicken2 reality-anchor / continuity-verification substrate. Its
          homeostasis, continuity and contradiction-load metrics are surfaced in the{' '}
          <Link href="/lenses/admin#admin-section-reality-guard" className="underline decoration-dotted underline-offset-2 hover:text-fuchsia-300">
            Admin lens&apos;s Reality Guard panel
          </Link>
          , not duplicated here.
        </p>
      </div>
    </section>
  );
}
