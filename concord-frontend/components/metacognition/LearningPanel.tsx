'use client';

/**
 * LearningPanel — assessKnowledge + skill timeline from real assessments_list.
 */
import { BookOpen, RefreshCw, Lightbulb, TrendingUp, Target, Sparkles, Brain } from 'lucide-react';
import { useMetacognitionDesk } from '@/components/metacognition/useMetacognitionDesk';
import { pct, formatTimestamp } from '@/components/metacognition/metacog-model';
import { ErrorState } from '@/components/common/EmptyState';

export function LearningPanel() {
  const {
    knowledgeDomains, learningInsights, patterns, runAssessment,
    isLoading, isError, errorMessage, refetchAll,
  } = useMetacognitionDesk();

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
          {/* Domain Assessment Tool */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-neon-cyan" />
              Domain Assessment
            </h2>
            <p className="text-sm text-gray-400 mb-3">
              Run an assessment on a specific knowledge domain to evaluate competence.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Domain to assess — e.g. logic, language, math..."
                className="input-lattice flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value) {
                    runAssessment.mutate(e.currentTarget.value);
                    e.currentTarget.value = '';
                  }
                }}
              />
              <button
                onClick={() => {
                  // detector-allow: frontend-fake-data — "placeholder" here is part of a
                  // CSS attribute selector used to find the input above, not rendered content.
                  const input = document.querySelector<HTMLInputElement>(
                    'input[placeholder*="Domain to assess"]'
                  );
                  if (input?.value) {
                    runAssessment.mutate(input.value);
                    input.value = '';
                  }
                }}
                disabled={runAssessment.isPending}
                className="btn-neon flex items-center gap-2 shrink-0"
              >
                <Target className="w-4 h-4" />
                {runAssessment.isPending ? 'Assessing...' : 'Assess'}
              </button>
            </div>
          </div>

          {/* Recent Learning Insights */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neon-yellow" />
              Recent Knowledge Acquisitions
            </h2>
            {learningInsights.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {[...learningInsights].reverse().map((insight: Record<string, unknown>, i: number) => (
                  <div key={i} className="lens-card text-sm">
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-neon-yellow shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-gray-300">
                          {String(
                            insight.description ||
                              insight.insight ||
                              insight.name ||
                              insight.topic ||
                              JSON.stringify(insight)
                          )}
                        </p>
                        {!!insight.domain && (
                          <span className="text-xs text-gray-400">
                            Domain: {String(insight.domain)}
                          </span>
                        )}
                        {!!(insight.timestamp || insight.learned_at) && (
                          <span className="text-xs text-gray-400 ml-2">
                            {formatTimestamp(insight.timestamp || insight.learned_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Learning insights will appear as the system processes new information.
              </p>
            )}
          </div>

          {/* Pattern Recognition Highlights */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Brain className="w-4 h-4 text-neon-purple" />
              Pattern Recognition Highlights
            </h2>
            {patterns.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {patterns.map((pattern: Record<string, unknown>, i: number) => {
                  const confidence = typeof pattern.confidence === 'number' ? pattern.confidence : null;
                  return (
                    <div key={i} className="lens-card">
                      <p className="text-sm font-medium text-gray-300 mb-1">
                        {String(
                          pattern.description ||
                            pattern.pattern ||
                            pattern.name ||
                            JSON.stringify(pattern)
                        )}
                      </p>
                      {confidence != null && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className="h-1.5 flex-1 bg-lattice-deep rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-neon-purple"
                              style={{ width: `${pct(confidence)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 font-mono">
                            {pct(confidence).toFixed(0)}%
                          </span>
                        </div>
                      )}
                      {!!pattern.occurrences && (
                        <p className="text-xs text-gray-400 mt-1">
                          Occurrences: {String(pattern.occurrences)}
                        </p>
                      )}
                      {!!pattern.category && (
                        <span className="inline-block text-xs bg-neon-purple/10 text-neon-purple px-2 py-0.5 rounded mt-1">
                          {String(pattern.category)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Pattern recognition data will populate as the system identifies recurring themes.
              </p>
            )}
          </div>

          {/* Skill Improvement Timeline */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-green" />
              Skill Improvement Timeline
            </h2>
            {knowledgeDomains.length > 0 ? (
              <div className="space-y-4">
                {knowledgeDomains.map((domain: Record<string, unknown>, i: number) => {
                  const name = String(domain.domain || domain.name || domain.label || `Skill ${i + 1}`);
                  const current = typeof domain.confidence === 'number' ? domain.confidence : null;
                  const previous = typeof domain.previous_confidence === 'number' ? domain.previous_confidence : null;
                  const improvement =
                    current != null && previous != null ? current - previous : null;

                  return (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-28 text-sm text-gray-300 truncate shrink-0">{name}</div>
                      <div className="flex-1 relative">
                        <div className="h-3 bg-lattice-deep rounded-full overflow-hidden">
                          {previous != null && (
                            <div
                              className="absolute h-3 rounded-full bg-gray-600/50 top-0"
                              style={{ width: `${pct(previous)}%` }}
                            />
                          )}
                          <div
                            className="relative h-full rounded-full bg-neon-green transition-all duration-500"
                            style={{ width: `${pct(current ?? 0)}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-20 text-right shrink-0">
                        <span className="text-sm font-mono text-gray-300">
                          {current != null ? `${pct(current).toFixed(0)}%` : '--'}
                        </span>
                        {improvement != null && improvement !== 0 && (
                          <span
                            className={`text-xs ml-1 ${
                              improvement > 0 ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {improvement > 0 ? '+' : ''}
                            {(improvement * 100).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Skill improvements will be tracked as the system operates across different domains.
              </p>
            )}
          </div>
        </div>
  );
}
