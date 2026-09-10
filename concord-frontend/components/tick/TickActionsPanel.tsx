'use client';

/**
 * TickActionsPanel — run artifact actions on the heartbeat tick item.
 * Was always-visible below tabs in the old page; preserved as a shell footer.
 * Extracted from lenses/tick/page.tsx.
 */

import { useCallback, useState } from 'react';
import { X, Zap } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

export function TickActionsPanel() {
  const { items: tickItems } = useLensData<Record<string, unknown>>('tick', 'heartbeat');
  const runTickAction = useRunArtifact('tick');
  const [tickActionResult, setTickActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [tickActiveAction, setTickActiveAction] = useState<string | null>(null);

  const handleTickAction = useCallback(async (action: string) => {
    const id = tickItems[0]?.id;
    if (!id) return;
    setTickActiveAction(action);
    try {
      const res = await runTickAction.mutateAsync({ id, action });
      if (res.ok) setTickActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setTickActiveAction(null);
    }
  }, [tickItems, runTickAction]);

  return (
      <div className="p-4 border-t border-lattice-border bg-lattice-surface/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-cyan" />
            Tick Actions
          </h3>
          {tickActionResult && (
            <button onClick={() => setTickActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['healthPulse', 'loadPredict', 'rhythmAnalysis'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleTickAction(action)}
              disabled={!tickItems[0]?.id || tickActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {tickActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'healthPulse' ? 'Health Pulse' : action === 'loadPredict' ? 'Load Predict' : 'Rhythm Analysis'}
            </button>
          ))}
        </div>
        {tickActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {tickActionResult.action === 'healthPulse' && (() => {
              const r = tickActionResult.result;
              const status = String(r.systemStatus ?? 'unknown');
              const statusColor = status === 'healthy' ? 'text-neon-green' : status === 'degraded' ? 'text-yellow-400' : 'text-red-400';
              const summary = r.summary as Record<string, unknown> | undefined;
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">System Status:</span>
                    <span className={`text-xs font-semibold uppercase ${statusColor}`}>{status}</span>
                    <span className="text-gray-400 text-xs ml-2">Avg Health: <span className="text-white">{String(r.avgHealthScore ?? 0)}</span></span>
                  </div>
                  {summary && (
                    <div className="flex gap-4 text-xs">
                      <span className="text-neon-green">Healthy: {String(summary.healthy ?? 0)}</span>
                      <span className="text-yellow-400">Degraded: {String(summary.degraded ?? 0)}</span>
                      <span className="text-red-400">Critical: {String(summary.critical ?? 0)}</span>
                      <span className="text-gray-400">Dead: {String(summary.dead ?? 0)}</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {tickActionResult.action === 'loadPredict' && (() => {
              const r = tickActionResult.result;
              const predictions = r.predictions as Record<string, Record<string, unknown>> | undefined;
              const keys = predictions ? Object.keys(predictions).slice(0, 3) : [];
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Data Points: <span className="text-white">{String(r.dataPoints ?? 0)}</span></div>
                  <div className="space-y-1">
                    {keys.map((key) => {
                      const pred = predictions![key];
                      const dir = String(pred.trendDirection ?? 'stable');
                      const dirColor = dir === 'increasing' ? 'text-red-400' : dir === 'decreasing' ? 'text-neon-green' : 'text-gray-300';
                      return (
                        <div key={key} className="flex items-center justify-between text-xs bg-lattice-elevated px-2 py-1 rounded">
                          <span className="text-gray-300 capitalize">{key}</span>
                          <span className="text-white">{String(pred.currentValue ?? 0)}</span>
                          <span className={dirColor}>{dir}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {tickActionResult.action === 'rhythmAnalysis' && (() => {
              const r = tickActionResult.result;
              const spectral = r.spectralAnalysis as Record<string, unknown> | undefined;
              const dominant = Array.isArray(r.dominantFrequencies) ? (r.dominantFrequencies as Array<Record<string, unknown>>)[0] : null;
              return (
                <div className="space-y-2">
                  {spectral && (
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-gray-400">Rhythm: <span className="text-neon-cyan font-medium">{String(spectral.rhythmType ?? '-').replace(/_/g, ' ')}</span></span>
                      <span className="text-gray-400">Primary Period: <span className="text-white">{String(spectral.primaryPeriod ?? '-')}</span></span>
                      <span className="text-gray-400">Concentration: <span className="text-white">{String(spectral.spectralConcentration ?? 0)}%</span></span>
                    </div>
                  )}
                  {dominant && <div className="text-xs text-gray-400">Dominant Freq: <span className="text-white">{String(dominant.frequency ?? 0)} Hz</span> (period: <span className="text-white">{String(dominant.periodHuman ?? '-')}</span>)</div>}
                </div>
              );
            })()}
          </div>
        )}
      </div>
  );
}
