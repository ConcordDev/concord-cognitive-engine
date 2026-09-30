'use client';

/**
 * HealthPanel — ATS health gauge, warnings, recovery recommendations.
 */
import { Gauge, AlertTriangle, Shield, Zap, BarChart3 } from 'lucide-react';
import { useAffectAts } from '@/components/affect/useAffectAts';
import { ErrorState } from '@/components/common/EmptyState';

export function HealthPanel() {
  const { dimValues, overallScore, warnings, recoveryRecommendations, healthData, isLoading, isError, errorMessage, refetchAll } = useAffectAts();

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
          {/* Overall Health Score */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-neon-green" />
              Overall Emotional Health
            </h2>
            {overallScore != null ? (
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  {/* Score gauge */}
                  <div className="relative w-32 h-32 shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={
                          overallScore >= 0.65
                            ? '#4ade80'
                            : overallScore >= 0.35
                              ? '#facc15'
                              : '#f87171'
                        }
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${overallScore * 264} 264`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span
                        className={`text-2xl font-bold font-mono ${
                          overallScore >= 0.65
                            ? 'text-green-400'
                            : overallScore >= 0.35
                              ? 'text-yellow-400'
                              : 'text-red-400'
                        }`}
                      >
                        {(overallScore * 100).toFixed(0)}%
                      </span>
                      <span className="text-xs text-gray-400">Health</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-gray-400">
                      {overallScore >= 0.65
                        ? 'Emotional state is in a healthy range. All dimensions are operating within normal parameters.'
                        : overallScore >= 0.35
                          ? 'Emotional state shows some areas of concern. Monitor affected dimensions.'
                          : 'Emotional health is compromised. Immediate attention recommended for low-scoring dimensions.'}
                    </p>
                    {/* Compact dimension summary */}
                    <div className="grid grid-cols-4 gap-2">
                      {dimValues.map((dim) => {
                        const adj = dim.key === 'f' ? 1 - dim.value : dim.value;
                        return (
                          <div key={dim.key} className="text-center">
                            <div className={`text-xs ${dim.color}`}>{dim.label}</div>
                            <div
                              className={`text-sm font-mono font-bold ${
                                adj >= 0.65
                                  ? 'text-green-400'
                                  : adj >= 0.35
                                    ? 'text-yellow-400'
                                    : 'text-red-400'
                              }`}
                            >
                              {(dim.value * 100).toFixed(0)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Health score will be computed once dimensional data is available.
              </p>
            )}
          </div>

          {/* Warning Indicators */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-neon-yellow" />
              Warning Indicators
              {warnings.length > 0 && (
                <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                  {warnings.length}
                </span>
              )}
            </h2>
            {warnings.length > 0 ? (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border-l-4 flex items-center gap-3 ${
                      w.severity === 'critical'
                        ? 'border-l-red-500 bg-red-500/5'
                        : 'border-l-yellow-500 bg-yellow-500/5'
                    }`}
                  >
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        w.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'
                      }`}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-300">{w.message}</p>
                      <p className="text-xs text-gray-400">Dimension: {w.dimension}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        w.severity === 'critical'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {w.severity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Shield className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-green-400 font-medium">All Clear</p>
                <p className="text-xs text-gray-400 mt-1">
                  All dimensions are within acceptable ranges.
                </p>
              </div>
            )}
          </div>

          {/* Recovery Recommendations */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-neon-cyan" />
              Recovery Recommendations
            </h2>
            {recoveryRecommendations.length > 0 ? (
              <div className="space-y-2">
                {recoveryRecommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg"
                  >
                    <div className="w-6 h-6 rounded-full bg-neon-cyan/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-neon-cyan">{i + 1}</span>
                    </div>
                    <p className="text-sm text-gray-300">{rec}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                No recovery actions needed. Emotional state is healthy.
              </p>
            )}
          </div>

          {/* Raw Health Data */}
          {Object.keys(healthData).length > 0 && (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                System Health Details
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(healthData)
                  .filter(
                    ([k]) =>
                      ![
                        'healthy',
                        'score',
                        'overall_score',
                        'warnings',
                        'alerts',
                        'recommendations',
                        'recovery',
                      ].includes(k)
                  )
                  .map(([key, val]) => (
                    <div key={key} className="lens-card">
                      <p className="text-xs text-gray-400 uppercase truncate">
                        {key.replace(/_/g, ' ')}
                      </p>
                      <p className="text-lg font-bold font-mono">
                        {typeof val === 'number'
                          ? val.toFixed(3)
                          : typeof val === 'boolean'
                            ? val
                              ? 'Yes'
                              : 'No'
                            : String(val)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
  );
}
