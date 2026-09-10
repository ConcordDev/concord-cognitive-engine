'use client';

import { useState } from 'react';
import { Radio, Zap, X } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

export function ActionsPanel() {
  const { items: resonanceArtifacts } = useLensData('resonance', 'signal', { seed: [] });
  const runResonanceAction = useRunArtifact('resonance');
  const [resonanceActionResult, setResonanceActionResult] = useState<Record<string, unknown> | null>(null);
  const [resonanceActiveAction, setResonanceActiveAction] = useState<string | null>(null);

  const handleResonanceAction = async (action: string) => {
    const id = resonanceArtifacts[0]?.id;
    if (!id) return;
    setResonanceActiveAction(action);
    try {
      const res = await runResonanceAction.mutateAsync({ id, action });
      const inner = res.result as Record<string, unknown> | undefined;
      if (res.ok === false || inner?.ok === false) {
        const errMsg = (res as Record<string, unknown>).error || inner?.error || inner?.message || 'Unknown error';
        setResonanceActionResult({ action, message: `Action failed: ${errMsg}` });
      } else {
        setResonanceActionResult({ action, ...(inner || {}) });
      }
    } catch (err) {
      console.error('Resonance action failed:', err);
    } finally {
      setResonanceActiveAction(null);
    }
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="text-sm font-semibold text-neon-purple flex items-center gap-2">
        <Radio className="w-4 h-4" /> Resonance Analysis
      </h3>
      <div className="flex flex-wrap gap-2">
        {[
          { action: 'engagementScore', label: 'Engagement Score' },
          { action: 'audienceMatch', label: 'Audience Match' },
          { action: 'impactPrediction', label: 'Impact Prediction' },
        ].map(({ action, label }) => (
          <button
            key={action}
            type="button"
            onClick={() => handleResonanceAction(action)}
            disabled={resonanceActiveAction === action || !resonanceArtifacts[0]?.id}
            className="px-3 py-1.5 text-xs bg-neon-purple/10 border border-neon-purple/20 rounded-lg hover:bg-neon-purple/20 disabled:opacity-50 flex items-center gap-1.5"
          >
            {resonanceActiveAction === action ? (
              <div className="w-3 h-3 border border-neon-purple border-t-transparent rounded-full animate-spin" />
            ) : (
              <Zap className="w-3 h-3 text-neon-purple" />
            )}
            {label}
          </button>
        ))}
      </div>
      {resonanceActionResult && (
        <div className="p-3 bg-black/40 rounded-lg border border-neon-purple/20 text-xs space-y-2">
          {resonanceActionResult.action === 'engagementScore' && (
            <div className="space-y-1">
              <div className="flex gap-4 flex-wrap">
                <span className="text-gray-400">
                  Score:{' '}
                  <span
                    className={`font-mono font-bold ${
                      (resonanceActionResult.engagementScore as number) >= 70
                        ? 'text-green-400'
                        : (resonanceActionResult.engagementScore as number) >= 40
                          ? 'text-yellow-400'
                          : 'text-red-400'
                    }`}
                  >
                    {String(resonanceActionResult.engagementScore ?? '')}
                  </span>
                </span>
                <span className="text-gray-400">
                  Tier: <span className="text-neon-purple capitalize">{String(resonanceActionResult.tier ?? '')}</span>
                </span>
                <span className="text-gray-400">
                  Trend:{' '}
                  <span className="text-white">
                    {String((resonanceActionResult.trend as Record<string, unknown>)?.direction ?? 'N/A')}
                  </span>
                </span>
              </div>
              {!!resonanceActionResult.message && (
                <p className="text-gray-400 italic">{String(resonanceActionResult.message)}</p>
              )}
            </div>
          )}
          {resonanceActionResult.action === 'audienceMatch' && (
            <div className="space-y-1">
              <div className="flex gap-4 flex-wrap">
                <span className="text-gray-400">
                  Match:{' '}
                  <span
                    className={`font-mono font-bold ${
                      (resonanceActionResult.alignmentScore as number) >= 70 ? 'text-green-400' : 'text-yellow-400'
                    }`}
                  >
                    {String(resonanceActionResult.alignmentScore ?? '')}%
                  </span>
                </span>
                <span className="text-gray-400">
                  Quality: <span className="text-neon-purple capitalize">{String(resonanceActionResult.quality ?? '')}</span>
                </span>
              </div>
              {!!resonanceActionResult.message && (
                <p className="text-gray-400 italic">{String(resonanceActionResult.message)}</p>
              )}
            </div>
          )}
          {resonanceActionResult.action === 'impactPrediction' && (
            <div className="space-y-1">
              <div className="flex gap-4 flex-wrap">
                <span className="text-gray-400">
                  Predicted score:{' '}
                  <span className="text-neon-purple font-mono">
                    {String((resonanceActionResult.prediction as Record<string, unknown>)?.predicted ?? '')}
                  </span>
                </span>
                <span className="text-gray-400">
                  Tier: <span className="text-white capitalize">{String(resonanceActionResult.predictedTier ?? '')}</span>
                </span>
              </div>
              {!!resonanceActionResult.message && (
                <p className="text-gray-400 italic">{String(resonanceActionResult.message)}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setResonanceActionResult(null)}
            className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default ActionsPanel;
