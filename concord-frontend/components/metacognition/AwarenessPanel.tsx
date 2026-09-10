'use client';

/**
 * AwarenessPanel — calibration, blind spots, knowledge map (reflective desk).
 */
import { motion } from 'framer-motion';
import { BarChart3, AlertTriangle, Target } from 'lucide-react';
import { useMetacognitionDesk } from '@/components/metacognition/useMetacognitionDesk';
import { pct, severityColor, severityBadge, formatTimestamp, trendIcon } from '@/components/metacognition/metacog-model';
import { ErrorState } from '@/components/common/EmptyState';

export function AwarenessPanel() {
  const {
    spots, cal, knowledgeDomains,
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
          {/* Knowledge Confidence Map */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-green" />
              Knowledge Confidence Map
            </h2>
            {knowledgeDomains.length > 0 ? (
              <div className="space-y-3">
                {knowledgeDomains.map(
                  (domain: Record<string, unknown>, i: number) => {
                    const name = String(
                      domain.domain || domain.name || domain.label || `Domain ${i + 1}`
                    );
                    const confidence = typeof domain.confidence === 'number' ? domain.confidence : 0;
                    const confPct = pct(confidence);
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-300 truncate mr-2">{name}</span>
                          <span className="font-mono text-xs text-gray-400 shrink-0">
                            {confPct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2.5 bg-lattice-deep rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              confPct >= 75
                                ? 'bg-green-500'
                                : confPct >= 40
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${confPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                No domain confidence data yet. Make predictions across different domains to build the map.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Blind Spots */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-neon-yellow" />
                Active Blind Spots
                {spots.length > 0 && (
                  <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                    {spots.length}
                  </span>
                )}
              </h2>
              {spots.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {spots.map((spot: Record<string, unknown>, i: number) => {
                    const badge = severityBadge(spot.severity);
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        className={`p-3 rounded-lg border-l-4 ${severityColor(spot.severity)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">
                            {String(spot.topic || spot.description || spot.domain || spot.name || 'Untitled gap')}
                          </p>
                          {!!spot.severity && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}
                            >
                              {typeof spot.severity === 'number' ? `${(Number(spot.severity) * 100).toFixed(0)}%` : badge.label}
                            </span>
                          )}
                        </div>
                        {Array.isArray(spot.gaps) && (spot.gaps as unknown[]).length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            {(spot.gaps as unknown[]).map(String).join(' · ')}
                          </p>
                        )}
                        {!!spot.recommendation && (
                          <p className="text-xs text-gray-400 mt-1">
                            {String(spot.recommendation)}
                          </p>
                        )}
                        {!!(spot.identifiedAt || spot.detected_at) && (
                          <p className="text-xs text-gray-400 mt-1">
                            Detected: {formatTimestamp(spot.identifiedAt || spot.detected_at)}
                          </p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center py-6 text-gray-400 text-sm">
                  No blind spots detected. Run introspection to discover potential gaps.
                </p>
              )}
            </div>

            {/* Calibration Score & Trend */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-neon-green" />
                Calibration Report
              </h2>
              {cal && cal.totalPredictions != null && Number(cal.totalPredictions) > 0 ? (
                <div className="space-y-4">
                  {/* Main accuracy display */}
                  <div className="flex items-center gap-4 p-3 bg-lattice-deep rounded-lg">
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono text-neon-green">
                        {cal.overallAccuracy != null ? `${(Number(cal.overallAccuracy) * 100).toFixed(1)}%` : '--'}
                      </p>
                      <p className="text-xs text-gray-400">Accuracy</p>
                    </div>
                    {!!cal.interpretation && (
                      <div className="flex items-center gap-1 text-sm">
                        {trendIcon(cal.interpretation === 'well-calibrated' ? 'up' : cal.interpretation === 'poorly calibrated' ? 'down' : 'flat')}
                        <span className="text-gray-400 capitalize">{String(cal.interpretation)}</span>
                      </div>
                    )}
                  </div>
                  {/* Additional calibration metrics (whitelisted — `buckets` is a nested
                      object the grid isn't shaped for, so it's shown separately, not here) */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['totalPredictions', 'correctPredictions', 'avgCalibrationError'] as const)
                      .filter((key) => cal[key] != null)
                      .map((key) => (
                        <div key={key} className="lens-card">
                          <p className="text-xs text-gray-400 uppercase truncate">{key.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="text-lg font-bold font-mono">
                            {typeof cal[key] === 'number' ? (cal[key] as number).toFixed(key === 'avgCalibrationError' ? 3 : 0) : String(cal[key])}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="text-center py-6 text-gray-400 text-sm">
                  Make predictions and resolve them to build calibration data.
                </p>
              )}
            </div>
          </div>
        </div>
  );
}
