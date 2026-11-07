'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import {
  type BoundaryScan,
  type ThresholdConfig,
  SignalClassificationLegend,
  ThresholdConfigPanel,
  PairCard,
} from '@/components/resonance/resonance-ui';

const PAGE_SIZE = 25;

export function PairsPanel({
  scan,
  thresholds,
  onThresholdsChange,
}: {
  scan: BoundaryScan | undefined;
  thresholds: ThresholdConfig;
  onThresholdsChange: (t: ThresholdConfig) => void;
}) {
  const [legendOpen, setLegendOpen] = useState(false);
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [page, setPage] = useState(0);

  const pairsFound = scan?.crossDomainAlignment?.pairsFound ?? 0;
  const pageCount = Math.max(1, Math.ceil(pairsFound / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * PAGE_SIZE;

  // The headline count is only auditable if the whole set behind it can be
  // browsed: this panel pages the boundary reading's full pair set (the
  // scan prop's topPairs slice is the Live view's top-10, not this list).
  const { data: pageData, isFetching } = useQuery<BoundaryScan>({
    queryKey: ['resonance-boundary-page', offset],
    queryFn: () =>
      apiHelpers.resonance
        .boundary({ pairsOffset: offset, pairsLimit: PAGE_SIZE })
        .then((r) => r.data),
    enabled: pairsFound > 0,
  });
  const pagePairs = pageData?.crossDomainAlignment?.pairsPage ?? scan?.crossDomainAlignment?.topPairs ?? [];
  const dist = scan?.crossDomainAlignment?.scoreDistribution;
  const maxBucket = dist ? Math.max(1, ...dist.buckets.map((b) => b.count)) : 1;

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold">Cross-Domain Alignments</h2>
          <p className="text-[11px] text-gray-400">
            DTU pairs from different domains sharing invariant structure without semantic overlap
          </p>
        </div>
        <span className="text-xs font-mono text-gray-400">
          {pairsFound} pairs across {scan?.crossDomainAlignment?.domainsScanned ?? 0} domains
        </span>
      </div>

      <div className="space-y-2">
        <SignalClassificationLegend isOpen={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} />
        <ThresholdConfigPanel
          thresholds={thresholds}
          onChange={onThresholdsChange}
          isOpen={thresholdOpen}
          onToggle={() => setThresholdOpen(!thresholdOpen)}
        />
      </div>

      {dist && pairsFound > 0 && (
        <div className="border border-white/5 rounded-lg p-3" style={{ background: 'rgba(5,5,16,0.8)' }}>
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-mono uppercase tracking-wider text-gray-400">
              Score distribution — all {pairsFound} pairs
            </p>
            <p className="text-[11px] font-mono text-gray-500">
              median {(dist.p50 * 100).toFixed(1)} · p90 {(dist.p90 * 100).toFixed(1)}
            </p>
          </div>
          <div className="mt-2 space-y-1">
            {dist.buckets.map((b) => (
              <div key={b.min} className="flex items-center gap-2 text-[10px] font-mono text-gray-500">
                <span className="w-20 flex-shrink-0">
                  {(b.min * 100).toFixed(0)}–{(b.max * 100).toFixed(0)}
                </span>
                <div className="h-2 flex-1 rounded bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{ width: `${(b.count / maxBucket) * 100}%`, backgroundColor: 'rgba(0,255,200,0.35)' }}
                  />
                </div>
                <span className="w-10 text-right">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pairsFound === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Target className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No cross-domain alignments detected</p>
          <p className="text-xs mt-1">Run a scan to probe the boundary</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {pagePairs.map((pair, i) => (
              <PairCard key={`${pair.a.id}-${pair.b.id}`} pair={pair} rank={offset + i} thresholds={thresholds} />
            ))}
          </div>
          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] font-mono text-gray-500">
              Pairs {pairsFound === 0 ? 0 : offset + 1}–{Math.min(pairsFound, offset + pagePairs.length)} of {pairsFound}
              {isFetching ? ' · loading…' : ''}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="rounded border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={currentPage >= pageCount - 1}
                className="rounded border border-white/10 px-2.5 py-1 text-[11px] text-gray-300 hover:text-white disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default PairsPanel;
