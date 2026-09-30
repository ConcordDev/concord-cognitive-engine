// server/lib/runtime/dhtp-rs-statistics.js
// Statistical analysis for DHTP-RS benchmark (spec §7)

export function mean(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return 0;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function median(values) {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function stdev(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = mean(v);
  const variance = v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1);
  return Math.sqrt(variance);
}

export function confidenceInterval95(values) {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (n < 2) return { low: v[0] ?? 0, high: v[0] ?? 0, mean: v[0] ?? 0, n, stdev: 0 };
  const m = mean(v);
  const sd = stdev(v);
  const se = sd / Math.sqrt(n);
  return {
    mean: m,
    low: m - 1.96 * se,
    high: m + 1.96 * se,
    n,
    stdev: sd,
    se,
  };
}

/**
 * Paired differences for same trialIndex across conditions.
 * Returns per-trial deltas and aggregate CI on the difference.
 */
export function pairedDifferences(runsByCondition, conditionA, conditionB, {
  valueFn = (r) => r.evaluation?.composite ?? 0,
} = {}) {
  const mapA = new Map();
  const mapB = new Map();
  for (const r of runsByCondition[conditionA] || []) {
    if (r.ok) mapA.set(`${r.probeId}:${r.trialIndex}`, r);
  }
  for (const r of runsByCondition[conditionB] || []) {
    if (r.ok) mapB.set(`${r.probeId}:${r.trialIndex}`, r);
  }

  const deltas = [];
  const pairs = [];
  for (const [key, runA] of mapA) {
    const runB = mapB.get(key);
    if (!runB) continue;
    const a = valueFn(runA);
    const b = valueFn(runB);
  // A minus B: positive means conditionA better
    const delta = a - b;
    deltas.push(delta);
    pairs.push({ key, a, b, delta });
  }

  return {
    conditionA,
    conditionB,
    n: deltas.length,
    deltas,
    pairs,
    meanDelta: mean(deltas),
    medianDelta: median(deltas),
    ci: confidenceInterval95(deltas),
  };
}

export function summarizeConditionRuns(runs, { qualityKey = (r) => r.evaluation?.composite } = {}) {
  const okRuns = runs.filter((r) => r.ok);
  const qualities = okRuns.map(qualityKey);
  const successful = okRuns.filter((r) => r.live?.ok && !r.live?.apiFailure);
  const successfulQualities = successful.map(qualityKey);

  return {
    n: okRuns.length,
    nSuccessful: successful.length,
    meanQuality: mean(qualities),
    medianQuality: median(qualities),
    stdevQuality: stdev(qualities),
    ciAllTrials: confidenceInterval95(qualities),
    meanQualitySuccessfulOnly: mean(successfulQualities),
    medianQualitySuccessfulOnly: median(successfulQualities),
    ciSuccessfulOnly: confidenceInterval95(successfulQualities),
    apiFailureRate: okRuns.length ? okRuns.filter((r) => r.live?.apiFailure).length / okRuns.length : 0,
    timeoutRate: okRuns.length ? okRuns.filter((r) => r.live?.timedOut).length / okRuns.length : 0,
    successRate: okRuns.length ? successful.length / okRuns.length : 0,
  };
}

export function buildStatisticalReport({ runsByCondition, conditions }) {
  const byCondition = {};
  for (const cond of conditions) {
    byCondition[cond] = summarizeConditionRuns(runsByCondition[cond] || []);
  }

  const paired = {};
  const base = "dhtp_packet";
  for (const other of conditions) {
    if (other === base) continue;
    paired[`${base}_minus_${other}`] = pairedDifferences(runsByCondition, base, other);
  }

  return { byCondition, paired };
}
