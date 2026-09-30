'use client';

import { useState } from 'react';
import { Target } from 'lucide-react';
import {
  type BoundaryScan,
  type ResonancePair,
  type ThresholdConfig,
  SignalClassificationLegend,
  ThresholdConfigPanel,
  PairCard,
} from '@/components/resonance/resonance-ui';

export function PairsPanel({
  scan,
  allPairs,
  pairsByClass,
  thresholds,
  onThresholdsChange,
}: {
  scan: BoundaryScan | undefined;
  allPairs: ResonancePair[];
  pairsByClass: { strong: number; moderate: number; weak: number; noise: number };
  thresholds: ThresholdConfig;
  onThresholdsChange: (t: ThresholdConfig) => void;
}) {
  const [legendOpen, setLegendOpen] = useState(false);
  const [thresholdOpen, setThresholdOpen] = useState(false);

  return (
    <div className="p-6 space-y-3">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold">Cross-Domain Alignments</h2>
          <p className="text-[11px] text-gray-400">
            DTU pairs from different domains sharing invariant structure without semantic overlap
          </p>
        </div>
        <div className="flex items-center gap-3">
          {pairsByClass.strong > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(0,255,200,0.1)', color: '#00ffc8' }}>
              {pairsByClass.strong} strong
            </span>
          )}
          {pairsByClass.moderate > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(168,85,247,0.1)', color: '#a855f7' }}>
              {pairsByClass.moderate} moderate
            </span>
          )}
          {pairsByClass.weak > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#eab308' }}>
              {pairsByClass.weak} weak
            </span>
          )}
          <span className="text-xs font-mono text-gray-400">
            {scan?.crossDomainAlignment?.pairsFound ?? 0} pairs across {scan?.crossDomainAlignment?.domainsScanned ?? 0} domains
          </span>
        </div>
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

      {allPairs.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Target className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No cross-domain alignments detected</p>
          <p className="text-xs mt-1">Run a scan to probe the boundary</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allPairs.map((pair, i) => (
            <PairCard key={`${pair.a.id}-${pair.b.id}`} pair={pair} rank={i} thresholds={thresholds} />
          ))}
        </div>
      )}
    </div>
  );
}

export default PairsPanel;
