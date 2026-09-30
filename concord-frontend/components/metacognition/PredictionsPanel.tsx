'use client';

/**
 * PredictionsPanel — STATE.metacognition predictions + Brier/learning-curve analyzers.
 */
import { useState } from 'react';
import {
  Crosshair, Send, CheckCircle2, XCircle, Clock, Brain, Play, Loader2, ChevronDown, ChevronUp,
  Target, BarChart3,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useMetacognitionDesk } from '@/components/metacognition/useMetacognitionDesk';
import { formatTimestamp } from '@/components/metacognition/metacog-model';
import { ErrorState } from '@/components/common/EmptyState';

export function PredictionsPanel() {
  const {
    predictions, predictionStats, cal, makePrediction, resolvePrediction,
    isLoading, isError, errorMessage, refetchAll,
  } = useMetacognitionDesk();
  const [predictionClaim, setPredictionClaim] = useState('');
  const [predictionConfidence, setPredictionConfidence] = useState(0.7);
  const [predictionDomain, setPredictionDomain] = useState('');
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAction = async (action: 'confidenceCalibration' | 'learningCurve') => {
    const resolved = predictions.filter((p) => p.outcome === 'correct' || p.outcome === 'incorrect');
    if (resolved.length < 2) {
      setActionResult({ message: 'Resolve at least 2 predictions in the Predictions tab to run this analysis.' });
      return;
    }
    setIsRunning(action);
    try {
      let res;
      if (action === 'confidenceCalibration') {
        const predictionRows = resolved.map((p) => ({
          predicted: p.confidence,
          actual: p.outcome === 'correct' ? 1 : 0,
          label: p.statement,
        }));
        res = await lensRun('metacognition', 'confidenceCalibration', { predictions: predictionRows });
      } else {
        const chrono = [...resolved].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        let correctSoFar = 0;
        const progressRows = chrono.map((p, i) => {
          if (p.outcome === 'correct') correctSoFar += 1;
          return { trial: i + 1, performance: correctSoFar / (i + 1) };
        });
        res = await lensRun('metacognition', 'learningCurve', { progress: progressRows });
      }
      if (res.data.ok === false) {
        setActionResult({ message: `Action failed: ${res.data.error || 'Unknown error'}` });
      } else {
        setActionResult((res.data.result as Record<string, unknown>) || { message: 'No result returned.' });
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setIsRunning(null);
    }
  };

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
          {/* Make a Prediction */}
          <div className="panel p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-neon-cyan" />
              Make a Prediction
            </h2>
            <input
              type="text"
              value={predictionClaim}
              onChange={(e) => setPredictionClaim(e.target.value)}
              placeholder="Prediction claim..."
              className="input-lattice w-full"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Confidence: {(predictionConfidence * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={predictionConfidence}
                  onChange={(e) => setPredictionConfidence(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Domain (optional)</label>
                <input
                  type="text"
                  value={predictionDomain}
                  onChange={(e) => setPredictionDomain(e.target.value)}
                  placeholder="e.g. reasoning, memory..."
                  className="input-lattice w-full"
                />
              </div>
            </div>
            <button
              onClick={() => makePrediction.mutate({ claim: predictionClaim, confidence: predictionConfidence, domain: predictionDomain || undefined }, { onSuccess: () => { setPredictionClaim(''); setPredictionDomain(''); } })}
              disabled={!predictionClaim || makePrediction.isPending}
              className="btn-neon purple w-full flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {makePrediction.isPending ? 'Recording...' : 'Record Prediction'}
            </button>
          </div>

          {/* Hit/Miss Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <CheckCircle2 className="w-5 h-5 text-green-400 mb-1" />
              <p className="text-2xl font-bold font-mono">{predictionStats.hits}</p>
              <p className="text-xs text-gray-400">Correct</p>
            </div>
            <div className="lens-card">
              <XCircle className="w-5 h-5 text-red-400 mb-1" />
              <p className="text-2xl font-bold font-mono">{predictionStats.misses}</p>
              <p className="text-xs text-gray-400">Incorrect</p>
            </div>
            <div className="lens-card">
              <Clock className="w-5 h-5 text-gray-400 mb-1" />
              <p className="text-2xl font-bold font-mono">{predictionStats.pending}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
            <div className="lens-card">
              <Target className="w-5 h-5 text-neon-cyan mb-1" />
              <p className="text-2xl font-bold font-mono">
                {predictionStats.ratio != null
                  ? `${(predictionStats.ratio * 100).toFixed(0)}%`
                  : '--'}
              </p>
              <p className="text-xs text-gray-400">Hit Rate</p>
            </div>
          </div>

          {/* Confidence vs Accuracy Scatter Display */}
          {predictions.length > 0 ? (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-neon-purple" />
                Confidence vs Accuracy
              </h2>
              <div className="relative h-48 bg-lattice-deep rounded-lg overflow-hidden border border-gray-700/30">
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-between py-2 text-xs text-gray-400">
                  <span>100%</span>
                  <span>50%</span>
                  <span>0%</span>
                </div>
                {/* Grid lines */}
                <div className="absolute left-10 right-0 top-1/2 border-t border-gray-700/30" />
                <div className="absolute left-10 right-0 top-1/4 border-t border-gray-700/20" />
                <div className="absolute left-10 right-0 top-3/4 border-t border-gray-700/20" />
                {/* Ideal calibration line (diagonal) */}
                <div
                  className="absolute border-t border-dashed border-gray-500/40"
                  style={{
                    left: '40px',
                    bottom: '0',
                    width: 'calc((100% - 40px) * 1.414)',
                    transformOrigin: 'bottom left',
                    transform: 'rotate(-45deg)',
                  }}
                />
                {/* Data points */}
                <div className="absolute left-10 right-2 top-2 bottom-2">
                  {predictions
                    .filter(
                      (p: Record<string, unknown>) =>
                        typeof p.confidence === 'number' &&
                        (p.outcome != null || p.resolved != null || p.result != null)
                    )
                    .map((p: Record<string, unknown>, i: number) => {
                      const conf = Number(p.confidence);
                      const outcome = p.outcome ?? p.resolved ?? p.result;
                      const isCorrect =
                        outcome === true || outcome === 'correct' || outcome === 'hit';
                      const x = conf * 100;
                      const y = isCorrect ? conf * 100 : (1 - conf) * 50;
                      return (
                        <div
                          key={i}
                          className={`absolute w-3 h-3 rounded-full border-2 transition-all ${
                            isCorrect
                              ? 'bg-green-500 border-green-400'
                              : 'bg-red-500 border-red-400'
                          }`}
                          style={{
                            left: `${x}%`,
                            bottom: `${y}%`,
                            transform: 'translate(-50%, 50%)',
                          }}
                          title={`${String(p.statement || p.claim || p.description || '')} | Conf: ${(conf * 100).toFixed(0)}% | ${isCorrect ? 'Correct' : 'Incorrect'}`}
                        />
                      );
                    })}
                </div>
                {/* X-axis labels */}
                <div className="absolute bottom-0 left-10 right-0 flex justify-between px-2 text-xs text-gray-400">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                  Correct
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                  Incorrect
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-6 border-t border-dashed border-gray-500/60 inline-block" />
                  Ideal calibration
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
              <p>No predictions yet. Create cognitive predictions to see pattern analysis here.</p>
            </div>
          )}

          {/* Recent Predictions List */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-neon-cyan" />
              Recent Predictions
            </h2>
            {predictions.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {[...predictions].reverse().map((p: Record<string, unknown>, i: number) => {
                  const id = String(p.id || p.prediction_id || i);
                  const outcome = p.outcome ?? p.resolved ?? p.result;
                  const isResolved = outcome != null;
                  const isCorrect =
                    outcome === true || outcome === 'correct' || outcome === 'hit';
                  const expanded = expandedPrediction === id;

                  return (
                    <div key={id} className="lens-card">
                      <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => setExpandedPrediction(expanded ? null : id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                        {isResolved ? (
                          isCorrect ? (
                            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                          )
                        ) : (
                          <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {String(p.statement || p.claim || p.description || p.prediction || 'Prediction')}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            {typeof p.confidence === 'number' && (
                              <span>Conf: {(p.confidence * 100).toFixed(0)}%</span>
                            )}
                            {!!p.domain && <span>Domain: {String(p.domain)}</span>}
                            {!!(p.createdAt || p.timestamp || p.created_at) && (
                              <span>{formatTimestamp(p.createdAt || p.timestamp || p.created_at)}</span>
                            )}
                          </div>
                        </div>
                        {!isResolved && (
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resolvePrediction.mutate({ id, outcome: true });
                              }}
                              disabled={resolvePrediction.isPending}
                              className="p-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors"
                              title="Mark correct"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resolvePrediction.mutate({ id, outcome: false });
                              }}
                              disabled={resolvePrediction.isPending}
                              className="p-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                              title="Mark incorrect"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {expanded ? (
                          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                      </div>
                      {expanded && (
                        <div className="mt-3 pt-3 border-t border-gray-700/30 text-xs text-gray-400 space-y-1">
                          {Object.entries(p)
                            .filter(
                              ([k]) =>
                                !['id', 'prediction_id', 'statement', 'claim', 'description', 'prediction'].includes(k)
                            )
                            .map(([k, v]) => (
                              <div key={k} className="flex justify-between">
                                <span className="text-gray-400">{k.replace(/_/g, ' ')}</span>
                                <span className="font-mono">
                                  {typeof v === 'number'
                                    ? v.toFixed(3)
                                    : typeof v === 'boolean'
                                      ? v ? 'true' : 'false'
                                      : String(v)}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                No predictions yet. Use the form above to record your first prediction.
              </p>
            )}
          </div>

      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-purple" />
          Predictions Analysis
        </h2>
        <p className="text-xs text-gray-400">
          Deeper statistical analysis of your resolved Predictions-tab entries — log loss,
          discrimination, and a power-law/exponential learning-curve fit with a forecast
          for when you&apos;ll reach 90% calibration accuracy.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'confidenceCalibration' as const, label: 'Confidence Calibration' },
            { action: 'learningCurve' as const, label: 'Learning Curve' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning || predictions.filter((p) => p.outcome === 'correct' || p.outcome === 'incorrect').length < 2}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'brierScore' in actionResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Brier Score: <span className="text-neon-cyan font-bold">{String(actionResult.brierScore)}</span></span>
                  <span className="text-gray-400">Skill Score: <span className="text-neon-green">{String(actionResult.brierSkillScore)}</span></span>
                  <span className="text-gray-400">Log Loss: <span className="text-yellow-400">{String(actionResult.logLoss)}</span></span>
                </div>
                {'calibration' in actionResult && actionResult.calibration !== null && typeof actionResult.calibration === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.calibration as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'currentPerformance' in actionResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Performance: <span className="text-neon-cyan font-bold">{String(actionResult.currentPerformance)}</span></span>
                  <span className="text-gray-400">Mastered: <span className={actionResult.mastered ? 'text-neon-green' : 'text-yellow-400'}>{String(actionResult.mastered)}</span></span>
                  <span className="text-gray-400">Best Model: <span className="text-neon-purple">{String(actionResult.bestModel)}</span></span>
                </div>
                {'learningRate' in actionResult && actionResult.learningRate !== null && typeof actionResult.learningRate === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.learningRate as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {(() => {
                  const fit = actionResult.bestModel === 'power_law' ? actionResult.powerLawFit
                    : actionResult.bestModel === 'exponential' ? actionResult.exponentialFit : null;
                  const fitObj = fit && typeof fit === 'object' ? (fit as Record<string, unknown>) : null;
                  return fitObj?.predictedMasteryTrial != null ? (
                    <p className="text-xs text-neon-green">
                      Forecast: 90% calibration accuracy around trial #{String(fitObj.predictedMasteryTrial)} ({String(fitObj.equation)}, R²={typeof fitObj.rSquared === 'number' ? fitObj.rSquared.toFixed(3) : fitObj.rSquared as string})
                    </p>
                  ) : null;
                })()}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>
        </div>
  );
}
