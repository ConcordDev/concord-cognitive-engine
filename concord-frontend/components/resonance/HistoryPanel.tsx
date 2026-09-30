'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import {
  type HistoryPoint,
  CLASSIFICATION_META,
  SignalClassificationLegend,
  HistorySparkline,
} from '@/components/resonance/resonance-ui';

export function HistoryPanel({ history }: { history: HistoryPoint[] }) {
  const [legendOpen, setLegendOpen] = useState(false);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Signal History</h2>
        <SignalClassificationLegend isOpen={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} />
      </div>

      {history.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No history yet</p>
          <p className="text-xs mt-1">Run scans to build a signal timeline</p>
        </div>
      ) : (
        <>
          <div className="h-40 border border-white/5 rounded-lg overflow-hidden p-2"
            style={{ background: 'rgba(5,5,16,0.8)' }}>
            <HistorySparkline readings={history} />
          </div>

          <div className="space-y-1">
            {[...history].reverse().slice(0, 30).map((r, i) => {
              const rmeta = CLASSIFICATION_META[r.classification] || CLASSIFICATION_META.noise_floor;
              return (
                <div key={i} className="flex items-center gap-3 text-xs font-mono py-1.5 px-3 rounded hover:bg-white/[0.02]">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: rmeta.color }} />
                  <span className="text-gray-600 w-36 flex-shrink-0">
                    {new Date(r.timestamp).toLocaleString()}
                  </span>
                  <span className="w-16 text-right" style={{ color: rmeta.color }}>
                    {(r.signal * 100).toFixed(1)}%
                  </span>
                  <span className="flex-1 text-gray-600 text-[10px]">{rmeta.label}</span>
                  <span className="text-gray-700">{r.pairs}p</span>
                  <span className="text-gray-700">&nabla;{(r.gradient * 100).toFixed(0)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default HistoryPanel;
