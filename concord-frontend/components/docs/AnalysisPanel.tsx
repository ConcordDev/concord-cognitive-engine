'use client';

/**
 * AI Document Analysis — readabilityScore / crossReference / versionDiff.
 * Extracted from docs/page.tsx (preserve macros + result rendering).
 */

import { useCallback, useState } from 'react';
import { Zap, Loader2, AlertCircle } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';

export function AnalysisPanel() {
  const { items: docsItems } = useLensData('docs', 'document', { seed: [] });
  const runAction = useRunArtifact('docs');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleDocsAction = useCallback(
    async (action: string) => {
      const targetId = docsItems[0]?.id;
      if (!targetId) return;
      setActiveAction(action);
      setActionResult(null);
      try {
        const res = await runAction.mutateAsync({ id: targetId, action });
        if (res.ok === false) {
          setActionResult({
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setActionResult(res.result as Record<string, unknown>);
        }
      } catch (e) {
        console.error(`Action ${action} failed:`, e);
        setActionResult({
          message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
      setActiveAction(null);
    },
    [docsItems, runAction]
  );

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Zap className="w-4 h-4 text-neon-blue" /> AI Document Analysis
      </h3>
      <div className="flex flex-wrap gap-2">
        {(['readabilityScore', 'crossReference', 'versionDiff'] as const).map((action) => (
          <button
            key={action}
            onClick={() => handleDocsAction(action)}
            disabled={activeAction !== null || !docsItems[0]?.id}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-blue/10 border border-neon-blue/30 text-neon-blue hover:bg-neon-blue/20 disabled:opacity-50 transition-colors"
          >
            {activeAction === action ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {action === 'readabilityScore'
              ? 'Readability Score'
              : action === 'crossReference'
                ? 'Cross Reference'
                : 'Version Diff'}
          </button>
        ))}
      </div>

        {actionResult &&
          actionResult.metrics !== undefined &&
          actionResult.summary !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number((actionResult.metrics as Record<string, number>)?.fleschReadingEase) >= 60 ? 'text-neon-green' : Number((actionResult.metrics as Record<string, number>)?.fleschReadingEase) >= 30 ? 'text-yellow-400' : 'text-red-400'}`}
                  >
                    {String(
                      (actionResult.metrics as Record<string, number>)?.fleschReadingEase ?? 0
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400">Flesch Ease</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(
                      (actionResult.summary as Record<string, unknown>)?.averageGradeLevel ?? 0
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400">Grade Level</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-purple">
                    {String((actionResult.statistics as Record<string, unknown>)?.wordCount ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-400">Words</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-yellow-400">
                    {String(
                      (actionResult.summary as Record<string, unknown>)?.readingTimeMinutes ?? 0
                    )}
                    m
                  </p>
                  <p className="text-[10px] text-gray-400">Read Time</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-xs">
                  <p className="text-gray-400 mb-1">Difficulty</p>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      (actionResult.summary as Record<string, string>)?.difficulty === 'elementary'
                        ? 'bg-neon-green/20 text-neon-green'
                        : (actionResult.summary as Record<string, string>)?.difficulty ===
                            'middle-school'
                          ? 'bg-neon-cyan/20 text-neon-cyan'
                          : (actionResult.summary as Record<string, string>)?.difficulty ===
                              'high-school'
                            ? 'bg-yellow-400/20 text-yellow-400'
                            : 'bg-red-400/20 text-red-400'
                    }`}
                  >
                    {String(
                      (actionResult.summary as Record<string, string>)?.difficulty ?? '—'
                    ).replace('-', ' ')}
                  </span>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-xs">
                  <p className="text-gray-400 mb-1">Flesch Category</p>
                  <span className="text-gray-300">
                    {String(
                      (actionResult.summary as Record<string, string>)?.fleschCategory ?? '—'
                    )}
                  </span>
                </div>
              </div>
              {!!actionResult.technicalIndicators && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-orange-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.abbreviationCount ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">Abbrevs</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-red-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.longSentenceCount ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">Long Sentences</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-yellow-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.passiveVoiceInstances ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">Passive Voice</p>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* crossReference result */}
        {actionResult &&
          actionResult.graphDensity !== undefined &&
          actionResult.totalPages !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(actionResult.totalPages)}
                  </p>
                  <p className="text-[10px] text-gray-400">Pages</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-green">
                    {String(actionResult.totalLinks)}
                  </p>
                  <p className="text-[10px] text-gray-400">Links</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number((actionResult.brokenLinks as Record<string, number>)?.count) > 0 ? 'text-red-400' : 'text-neon-green'}`}
                  >
                    {String((actionResult.brokenLinks as Record<string, number>)?.count ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-400">Broken Links</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.healthScore) >= 80 ? 'text-neon-green' : Number(actionResult.healthScore) >= 60 ? 'text-yellow-400' : 'text-red-400'}`}
                  >
                    {String(actionResult.healthScore ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-400">Health Score</p>
                </div>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neon-blue rounded-full transition-all"
                  style={{ width: `${actionResult.healthScore ?? 0}%` }}
                />
              </div>
              {!!actionResult.orphanPages &&
                Number((actionResult.orphanPages as Record<string, number>)?.count) > 0 && (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{' '}
                    {String((actionResult.orphanPages as Record<string, number>).count)} orphan
                    page(s)
                  </p>
                )}
              {!!actionResult.circularReferences &&
                Number((actionResult.circularReferences as Record<string, number>)?.count) > 0 && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{' '}
                    {String((actionResult.circularReferences as Record<string, number>).count)}{' '}
                    circular reference(s)
                  </p>
                )}
            </div>
          )}

        {/* versionDiff result */}
        {actionResult &&
          actionResult.changeSignificance !== undefined &&
          actionResult.summary !== undefined &&
          actionResult.wordDelta !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.changeSignificance) >= 70 ? 'text-red-400' : Number(actionResult.changeSignificance) >= 40 ? 'text-yellow-400' : 'text-neon-green'}`}
                  >
                    {String(actionResult.changeSignificance)}
                  </p>
                  <p className="text-[10px] text-gray-400">Significance</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.wordDelta) >= 0 ? 'text-neon-green' : 'text-red-400'}`}
                  >
                    {Number(actionResult.wordDelta) >= 0 ? '+' : ''}
                    {String(actionResult.wordDelta)}
                  </p>
                  <p className="text-[10px] text-gray-400">Word Delta</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-xs font-bold text-neon-cyan capitalize">
                    {String(actionResult.significanceLabel ?? '—')}
                  </p>
                  <p className="text-[10px] text-gray-400">Label</p>
                </div>
              </div>
              {!!actionResult.summary && (
                <div className="grid grid-cols-5 gap-1 text-center">
                  {Object.entries(actionResult.summary as Record<string, number>).map(
                    ([key, val]) => (
                      <div
                        key={key}
                        className={`p-1.5 rounded text-xs ${
                          key === 'added'
                            ? 'bg-neon-green/10 border border-neon-green/20'
                            : key === 'deleted'
                              ? 'bg-red-400/10 border border-red-400/20'
                              : key === 'modified'
                                ? 'bg-yellow-400/10 border border-yellow-400/20'
                                : key === 'moved'
                                  ? 'bg-neon-purple/10 border border-neon-purple/20'
                                  : 'bg-white/5 border border-white/5'
                        }`}
                      >
                        <p
                          className={`font-bold ${key === 'added' ? 'text-neon-green' : key === 'deleted' ? 'text-red-400' : key === 'modified' ? 'text-yellow-400' : key === 'moved' ? 'text-neon-purple' : 'text-gray-400'}`}
                        >
                          {val}
                        </p>
                        <p className="text-[10px] text-gray-400 capitalize">{key}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
        )}

    </div>
  );
}
