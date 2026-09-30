'use client';

/**
 * IntrospectionPanel — introspectOnFailures + history of real pattern types.
 */
import { useState } from 'react';
import { Lightbulb, Brain, Activity, Clock, XCircle } from 'lucide-react';
import { useMetacognitionDesk } from '@/components/metacognition/useMetacognitionDesk';
import { formatTimestamp } from '@/components/metacognition/metacog-model';
import { ErrorState } from '@/components/common/EmptyState';

export function IntrospectionPanel() {
  const {
    introData, latestIntrospection, introspectionHistory, runIntrospection,
    isLoading, isError, errorMessage, refetchAll,
  } = useMetacognitionDesk();
  const [introspectFocus, setIntrospectFocus] = useState('');

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (isError) return <ErrorState error={errorMessage} onRetry={refetchAll} />;

  return (
        <div className="space-y-6">
          {/* Run Introspection */}
          <div className="panel p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-neon-yellow" />
              Run Introspection
            </h2>
            <p className="text-sm text-gray-400">
              Trigger a self-analysis pass. Optionally specify a focus area to examine.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={introspectFocus}
                onChange={(e) => setIntrospectFocus(e.target.value)}
                placeholder="Focus area (optional) — e.g. reasoning, memory, calibration..."
                className="input-lattice flex-1"
              />
              <button
                onClick={() => runIntrospection.mutate(introspectFocus)}
                disabled={runIntrospection.isPending}
                className="btn-neon purple flex items-center gap-2 shrink-0"
              >
                <Brain className="w-4 h-4" />
                {runIntrospection.isPending ? 'Introspecting...' : 'Run Introspection'}
              </button>
            </div>
          </div>

          {/* Current Introspection Results — introspectOnFailures() (server.js)
              analyzes resolved predictions for four real pattern types
              (domain_weakness / overconfidence / underconfidence / topic_weakness);
              it has no concept of "strengths" — a prior version of this panel
              rendered fictional strengths/weaknesses sections that could never be
              populated by the actual backend. This shows the LATEST run's real
              findings (captured from the mutation response, since
              introspection_status only returns aggregate counts). */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-neon-purple" />
              Introspection Results
            </h2>
            {latestIntrospection ? (
              <div className="space-y-4">
                {!!latestIntrospection.message && (
                  <p className="text-sm text-gray-400">{String(latestIntrospection.message)}</p>
                )}
                {typeof latestIntrospection.totalPredictions === 'number' && (
                  <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                    <span>Analyzed: <span className="text-gray-200 font-mono">{String(latestIntrospection.totalPredictions)}</span></span>
                    <span>Failures: <span className="text-red-400 font-mono">{String(latestIntrospection.failures)}</span></span>
                    <span>Successes: <span className="text-green-400 font-mono">{String(latestIntrospection.successes)}</span></span>
                    {typeof latestIntrospection.failureRate === 'number' && (
                      <span>Failure rate: <span className="text-yellow-400 font-mono">{(Number(latestIntrospection.failureRate) * 100).toFixed(0)}%</span></span>
                    )}
                  </div>
                )}
                {/* Failure patterns found in this pass */}
                {(() => {
                  const foundPatterns = Array.isArray(latestIntrospection.patterns)
                    ? (latestIntrospection.patterns as Record<string, unknown>[])
                    : Array.isArray(latestIntrospection.failurePatterns)
                      ? (latestIntrospection.failurePatterns as Record<string, unknown>[])
                      : [];
                  return foundPatterns.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" />
                        Failure Patterns Found
                      </h3>
                      <div className="space-y-1">
                        {foundPatterns.map((p, i) => (
                          <div key={i} className="text-sm p-2 bg-red-500/5 border border-red-500/10 rounded">
                            <p className="text-gray-200">{String(p.description || p.type)}</p>
                            {!!p.recommendation && <p className="text-xs text-gray-400 mt-0.5">{String(p.recommendation)}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
                {/* Recommendations */}
                {Array.isArray(latestIntrospection.recommendations) && (latestIntrospection.recommendations as unknown[]).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-neon-cyan mb-2 flex items-center gap-1">
                      <Lightbulb className="w-3.5 h-3.5" />
                      Recommendations
                    </h3>
                    <div className="space-y-1">
                      {(latestIntrospection.recommendations as Record<string, unknown>[]).map(
                        (r: Record<string, unknown> | string, i: number) => (
                          <div
                            key={i}
                            className="text-sm p-2 bg-cyan-500/5 border border-cyan-500/10 rounded"
                          >
                            {typeof r === 'string' ? r : String(r.description || r.action || 'Recommendation')}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
                {/* Per-domain confidence adjustments this pass produced/holds */}
                {!!latestIntrospection.confidenceAdjustments && typeof latestIntrospection.confidenceAdjustments === 'object'
                  && Object.keys(latestIntrospection.confidenceAdjustments as Record<string, unknown>).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-300 mb-2">Confidence Adjustments</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(latestIntrospection.confidenceAdjustments as Record<string, number>).map(([domain, factor]) => (
                        <div key={domain} className="lens-card flex items-center justify-between text-xs">
                          <span className="text-gray-300 capitalize">{domain}</span>
                          <span className={factor < 1 ? 'text-red-400 font-mono' : factor > 1 ? 'text-green-400 font-mono' : 'text-gray-400 font-mono'}>
                            ×{Number(factor).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                {typeof introData.failurePatternCount === 'number' && introData.failurePatternCount > 0
                  ? `${introData.failurePatternCount} failure pattern(s) found in past runs. Click "Run Introspection" to re-analyze with the latest predictions.`
                  : 'No introspection results yet. Click "Run Introspection" to begin.'}
              </p>
            )}
          </div>

          {/* Introspection History */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              Introspection History
            </h2>
            {introspectionHistory.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {[...introspectionHistory].reverse().map((entry: Record<string, unknown>, i: number) => {
                  const entryPatterns = Array.isArray(entry.patterns) ? (entry.patterns as unknown[]) : [];
                  return (
                    <div key={i} className="lens-card text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-300">
                          {entryPatterns.length > 0 ? entryPatterns.map((t) => String(t).replace(/_/g, ' ')).join(', ') : 'No patterns found'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {String(entry.totalPredictions ?? 0)} analyzed · {String(entry.failures ?? 0)} failed
                        {typeof entry.failureRate === 'number' ? ` (${(Number(entry.failureRate) * 100).toFixed(0)}%)` : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Past introspection results will appear here after running introspections.
              </p>
            )}
          </div>
        </div>
  );
}
