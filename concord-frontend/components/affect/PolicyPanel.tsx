'use client';

/**
 * PolicyPanel — derived ATS policy (read-only floats: style/cognition/memory/safety).
 */
import { BarChart3 } from 'lucide-react';
import { clamp } from '@/components/affect/affect-model';
import { useAffectAts } from '@/components/affect/useAffectAts';
import { ErrorState } from '@/components/common/EmptyState';

export function PolicyPanel() {
  const { policyData, isLoading, isError, errorMessage, refetchAll } = useAffectAts();

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState error={errorMessage} onRetry={refetchAll} />;
  }

  return (
        <div className="space-y-6">
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-purple" />
              Affect Policies
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Read-only OS control signals, continuously re-derived from the 7D affective state above (style/cognition/memory/safety weights the chat, council, and agent-mode systems read). They are computed, not user-set.
            </p>
            {Object.keys(policyData).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(policyData).map(([category, values]) => {
                  const isObj = typeof values === 'object' && values !== null && !Array.isArray(values);
                  const isArr = Array.isArray(values);

                  return (
                    <div key={category} className="lens-card">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">
                          {category.replace(/_/g, ' ')}
                        </h3>
                        {isObj && (
                          <span className="text-xs text-gray-400">
                            {Object.keys(values as object).length} settings
                          </span>
                        )}
                      </div>
                      {isObj && (
                        <div className="space-y-2">
                          {Object.entries(values as Record<string, unknown>).map(
                            ([key, val]) => {
                              // Every AffectPolicy field (style/cognition/memory/safety) is a
                              // continuously-derived control signal computed from the 7D state
                              // (server/affect/policy.js) — there is no boolean/settable field
                              // and no server-side override macro, so this is read-only by
                              // construction. latencyBudgetMs is the one field outside 0..1
                              // (1000-15000ms), so it gets its own normalization for the bar.
                              const isNumber = typeof val === 'number';
                              const barFrac = isNumber
                                ? key === 'latencyBudgetMs'
                                  ? clamp((val as number) / 15000, 0, 1)
                                  : clamp(val as number, 0, 1)
                                : 0;
                              return (
                                <div
                                  key={key}
                                  className="flex items-center justify-between py-1.5 border-b border-gray-700/20 last:border-0"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-300">
                                      {key.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isNumber ? (
                                      <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-neon-cyan"
                                            style={{ width: `${barFrac * 100}%` }}
                                          />
                                        </div>
                                        <span className="font-mono text-sm text-neon-cyan">
                                          {key === 'latencyBudgetMs'
                                            ? `${(val as number).toFixed(0)}ms`
                                            : (val as number).toFixed(3)}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="font-mono text-sm text-neon-cyan">
                                        {String(val)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      )}
                      {isArr && (
                        <div className="space-y-1">
                          {(values as unknown[]).map((item, j) => (
                            <div
                              key={j}
                              className="text-sm p-2 bg-lattice-deep rounded text-gray-300"
                            >
                              {typeof item === 'string'
                                ? item
                                : typeof item === 'object' && item !== null
                                  ? Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                                      <span key={k} className="mr-3">
                                        <span className="text-gray-400">{k}: </span>
                                        <span className="font-mono text-neon-cyan">
                                          {typeof v === 'boolean'
                                            ? v
                                              ? 'ON'
                                              : 'OFF'
                                            : String(v)}
                                        </span>
                                      </span>
                                    ))
                                  : String(item)}
                            </div>
                          ))}
                        </div>
                      )}
                      {!isObj && !isArr && (
                        <p className="font-mono text-sm text-neon-cyan">
                          {typeof values === 'boolean'
                            ? values
                              ? 'Enabled'
                              : 'Disabled'
                            : String(values)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                No affect policies configured for this session. Policies will appear as the system initializes.
              </p>
            )}
          </div>
        </div>
  );
}
