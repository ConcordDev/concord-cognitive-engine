'use client';

import { Info, Signal } from 'lucide-react';
import {
  type BoundaryScan,
  type HistoryPoint,
  CLASSIFICATION_META,
  ResonanceFieldCanvas,
  ResonanceSpectrumCanvas,
  HistorySparkline,
} from '@/components/resonance/resonance-ui';

export function LivePanel({
  scan,
  signal,
  classification,
  isScanning,
  history,
}: {
  scan: BoundaryScan | undefined;
  signal: number;
  classification: string;
  isScanning: boolean;
  history: HistoryPoint[];
}) {
  const meta = CLASSIFICATION_META[classification] || CLASSIFICATION_META.noise_floor;

  return (
    <div className="h-full flex flex-col">
      {scan?.ok === false && (
        <div className="px-6 py-2 flex items-center gap-2 text-[11px] font-mono text-yellow-500/90 bg-yellow-500/[0.04] border-b border-yellow-500/10">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>
            {scan.error || 'Boundary scan unavailable'}
            {typeof scan.count === 'number' ? ` (${scan.count} DTUs in corpus, need 20+)` : ''}
          </span>
        </div>
      )}
      <div className="px-6 py-3 flex items-center justify-between"
        style={{ background: meta.glow.replace(')', ',0.05)') }}>
        <div className="flex items-center gap-3">
          <Signal className="w-4 h-4" style={{ color: meta.color }} />
          <span className="text-sm font-mono font-bold tracking-wider" style={{ color: meta.color }}>
            {meta.label}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
          <span>Signal: <span className="text-white">{(signal * 100).toFixed(1)}%</span></span>
          <span>Gradient: <span className="text-white">{((scan?.gradient ?? 0) * 100).toFixed(1)}%</span></span>
          <span>Pairs: <span className="text-white">{scan?.crossDomainAlignment?.pairsFound ?? 0}</span></span>
          <span>Domains: <span className="text-white">{scan?.crossDomainAlignment?.domainsScanned ?? 0}</span></span>
        </div>
      </div>

      <div className="h-36 border-b border-white/5 relative flex-shrink-0">
        <ResonanceSpectrumCanvas
          signal={signal}
          gradient={scan?.gradient ?? 0}
          coherence={scan?.coherenceDirection ?? 0}
          classification={classification}
          topResonance={scan?.crossDomainAlignment?.topResonance ?? 0}
          pairsFound={scan?.crossDomainAlignment?.pairsFound ?? 0}
          scanning={isScanning}
        />
        <div className="absolute top-2 left-3 text-[9px] font-mono text-gray-400 uppercase tracking-widest pointer-events-none">
          Resonance Frequency Spectrum
        </div>
      </div>

      <div className="flex-1 relative">
        <ResonanceFieldCanvas
          signal={signal}
          gradient={scan?.gradient ?? 0}
          coherence={scan?.coherenceDirection ?? 0}
          classification={classification}
          scanning={isScanning}
        />

        <div className="absolute top-4 left-4 space-y-2">
          <div className="text-5xl font-mono font-bold tracking-tighter" style={{ color: meta.color }}>
            {(signal * 100).toFixed(1)}
          </div>
          <div className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
            Boundary Signal Strength
          </div>
        </div>

        <div className="absolute bottom-4 left-4 text-[11px] font-mono text-gray-400 space-y-1">
          <p>Frontier DTUs: {scan?.frontier?.size ?? '—'} / Interior: {scan?.interior?.size ?? '—'}</p>
          <p>Frontier crispness: {((scan?.frontier?.avgCrispness ?? 0) * 100).toFixed(1)}%</p>
          <p>Interior crispness: {((scan?.interior?.avgCrispness ?? 0) * 100).toFixed(1)}%</p>
          <p>Coherence direction: {scan?.coherenceDirection?.toFixed(3) ?? '—'}</p>
        </div>

        {scan?.crossDomainAlignment?.topPairs?.[0] && (
          <div className="absolute bottom-4 right-4 max-w-xs">
            <p className="text-[10px] text-gray-400 mb-1">Strongest cross-domain alignment:</p>
            <div className="text-[11px] font-mono p-2 rounded border border-white/5"
              style={{ background: 'rgba(5,5,16,0.9)' }}>
              <p style={{ color: meta.color }}>
                {scan.crossDomainAlignment.topPairs[0].a.domain} &harr; {scan.crossDomainAlignment.topPairs[0].b.domain}
              </p>
              <p className="text-gray-400 truncate">{scan.crossDomainAlignment.topPairs[0].a.title}</p>
              <p className="text-gray-400 truncate">{scan.crossDomainAlignment.topPairs[0].b.title}</p>
            </div>
          </div>
        )}

        {history.length > 1 && (
          <div className="absolute top-4 right-4 w-48 h-16">
            <HistorySparkline readings={history.slice(-50)} />
          </div>
        )}
      </div>
    </div>
  );
}

export default LivePanel;
