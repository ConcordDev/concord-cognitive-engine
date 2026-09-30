// Pure probabilistic-forecast scoring math shared between
// domains/metacognition.js (decision-journal calibration) and
// domains/predict.js (PredictionTicket calibration), so both compute
// identical Brier/log-loss/reliability statistics instead of drifting
// apart under independent copies.
//
// Every function takes/returns plain numbers or plain objects — no DB,
// no ctx, no rounding baked in (callers round for display).

/** pairs: [{ predicted: number(0-1), actual: 0|1 }] */
export function computeBrierScore(pairs) {
  const n = pairs.length;
  if (n === 0) return null;
  return pairs.reduce((s, p) => s + Math.pow(p.predicted - p.actual, 2), 0) / n;
}

/** Skill relative to the climatological (base-rate-only) forecast. */
export function computeBrierSkillScore(brier, baseRate) {
  const climatology = baseRate * (1 - baseRate);
  return climatology > 0 ? 1 - brier / climatology : 0;
}

export const LOG_LOSS_EPSILON = 1e-15;

export function computeLogLoss(pairs, epsilon = LOG_LOSS_EPSILON) {
  const n = pairs.length;
  if (n === 0) return null;
  const sum = pairs.reduce((s, p) => {
    const clipped = Math.max(epsilon, Math.min(1 - epsilon, p.predicted));
    return s + (p.actual * Math.log(clipped) + (1 - p.actual) * Math.log(1 - clipped));
  }, 0);
  return -sum / n;
}

/**
 * Bins pairs by predicted probability into `numBins` equal-width buckets.
 * The last bin is closed on both ends ([lower, upper]); the rest are
 * half-open ([lower, upper)) so every pair lands in exactly one bin.
 */
export function computeReliabilityBins(pairs, numBins) {
  const bins = [];
  for (let i = 0; i < numBins; i++) {
    const lower = i / numBins;
    const upper = (i + 1) / numBins;
    const inBin = pairs.filter((p) => p.predicted >= lower
      && (i === numBins - 1 ? p.predicted <= upper : p.predicted < upper));
    if (inBin.length === 0) {
      bins.push({ lower, upper, count: 0, meanPredicted: null, meanActual: null, gap: null });
      continue;
    }
    const meanPredicted = inBin.reduce((s, p) => s + p.predicted, 0) / inBin.length;
    const meanActual = inBin.reduce((s, p) => s + p.actual, 0) / inBin.length;
    bins.push({ lower, upper, count: inBin.length, meanPredicted, meanActual, gap: Math.abs(meanPredicted - meanActual) });
  }
  return bins;
}

/** Expected Calibration Error — count-weighted mean of per-bin gaps. */
export function computeECE(bins, n) {
  if (n === 0) return 0;
  return bins.reduce((s, b) => (b.count === 0 ? s : s + (b.count / n) * (b.gap || 0)), 0);
}

/** Maximum Calibration Error — worst single-bin gap. */
export function computeMCE(bins) {
  const withData = bins.filter((b) => b.count > 0).map((b) => b.gap || 0);
  return withData.length ? Math.max(...withData) : 0;
}

export function calibrationQualityLabel(ece) {
  return ece < 0.05 ? "excellent" : ece < 0.1 ? "good" : ece < 0.2 ? "moderate" : "poor";
}
