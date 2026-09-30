'use client';

import { useCallback, useState } from 'react';
import { X, Zap } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

const ACTIONS = ['shapeDetect', 'layoutOptimize', 'clusterGroup', 'exportPrep'] as const;

export function WhiteboardActionsStrip({ boardId }: { boardId?: string }) {
  const runWbAction = useRunArtifact('whiteboard');
  const [wbActionResult, setWbActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [wbActiveAction, setWbActiveAction] = useState<string | null>(null);

  const handleWbAction = useCallback(async (action: string) => {
    if (!boardId) return;
    setWbActiveAction(action);
    try {
      const res = await runWbAction.mutateAsync({ id: boardId, action });
      if (res.ok) setWbActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setWbActiveAction(null);
    }
  }, [boardId, runWbAction]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-pink" />
          Analyze
        </h3>
        {wbActionResult && (
          <button type="button" onClick={() => setWbActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => handleWbAction(action)}
            disabled={!boardId || wbActiveAction !== null}
            className="px-3 py-1.5 text-sm rounded-lg bg-neon-pink/10 text-neon-pink border border-neon-pink/30 hover:bg-neon-pink/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {wbActiveAction === action ? (
              <div className="w-3 h-3 border border-neon-pink border-t-transparent rounded-full animate-spin" />
            ) : null}
            {action === 'shapeDetect' ? 'Shape Detect' : action === 'layoutOptimize' ? 'Optimize Layout' : action === 'clusterGroup' ? 'Cluster Group' : 'Export Prep'}
          </button>
        ))}
      </div>
      {wbActionResult && (
        <div className="rounded-lg border border-lattice-border bg-lattice-bg p-3 space-y-2 text-sm">
          {wbActionResult.action === 'shapeDetect' && (() => {
            const r = wbActionResult.result;
            const shapes = r.shapes as Record<string, unknown> | undefined;
            return (
              <div className="space-y-2">
                <div className="text-xs text-gray-400">Total Elements: <span className="text-white font-medium tabular-nums">{String(r.totalElements ?? 0)}</span></div>
                {shapes && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(shapes).map(([shape, count]) => (
                      <span key={shape} className="bg-neon-pink/10 text-neon-pink px-2 py-0.5 rounded-full capitalize">
                        {shape}: <span className="tabular-nums">{String(count)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {wbActionResult.action === 'layoutOptimize' && (() => {
            const r = wbActionResult.result;
            const suggestions = Array.isArray(r.suggestions) ? r.suggestions as string[] : [];
            return (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Score Before: <span className="text-white tabular-nums">{String(r.scoreBefore ?? 0)}</span></span>
                  <span className="text-gray-400">Score After: <span className="text-neon-green tabular-nums">{String(r.scoreAfter ?? 0)}</span></span>
                  <span className="text-gray-400">Overlaps Fixed: <span className="text-white tabular-nums">{String(r.overlapsFixed ?? 0)}</span></span>
                </div>
                {suggestions.length > 0 && (
                  <div className="text-xs space-y-0.5">{suggestions.slice(0, 3).map((s, i) => <div key={i} className="text-gray-300">• {s}</div>)}</div>
                )}
              </div>
            );
          })()}
          {wbActionResult.action === 'clusterGroup' && (() => {
            const r = wbActionResult.result;
            const clusters = Array.isArray(r.clusters) ? r.clusters as Array<Record<string, unknown>> : [];
            return (
              <div className="space-y-2">
                <div className="text-xs text-gray-400">Clusters Found: <span className="text-white font-medium tabular-nums">{String(r.clusterCount ?? clusters.length)}</span></div>
                <div className="space-y-1">
                  {clusters.slice(0, 4).map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-lattice-elevated px-2 py-1 rounded">
                      <span className="text-gray-300">Cluster {i + 1}</span>
                      <span className="text-gray-400 tabular-nums">{String(c.elementCount ?? c.size ?? 0)} elements</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {wbActionResult.action === 'exportPrep' && (() => {
            const r = wbActionResult.result;
            const formats = Array.isArray(r.supportedFormats) ? r.supportedFormats as string[] : [];
            return (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Elements: <span className="text-white tabular-nums">{String(r.elementCount ?? 0)}</span></span>
                  <span className="text-gray-400">Canvas: <span className="text-white tabular-nums">{String(r.canvasWidth ?? 0)}×{String(r.canvasHeight ?? 0)}</span></span>
                  <span className="text-gray-400">Est. Size: <span className="text-white tabular-nums">{String(r.estimatedSizeKb ?? 0)} KB</span></span>
                </div>
                {formats.length > 0 && (
                  <div className="flex gap-1 text-xs">
                    {formats.map((f, i) => <span key={i} className="bg-lattice-elevated text-gray-300 px-2 py-0.5 rounded">{f}</span>)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
