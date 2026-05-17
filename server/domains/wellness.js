// server/domains/wellness.js
// Domain actions for the wellness lens — Whoop shape. 4 macros over
// sleep / strain / recovery / HRV.

export default function registerWellnessActions(registerLensAction) {
  /**
   * sleepScore — compute a 0-100 sleep score from time-in-bed,
   * efficiency, and disturbances.
   *   params.minutesAsleep, params.minutesInBed, params.disturbances
   */
  registerLensAction("wellness", "sleepScore", (_ctx, _artifact, params = {}) => {
    const asleep = parseFloat(params.minutesAsleep) || 0;
    const inBed = parseFloat(params.minutesInBed) || asleep;
    const disturb = parseInt(params.disturbances, 10) || 0;
    if (asleep <= 0) return { ok: false, reason: "minutesAsleep required" };
    const efficiency = inBed > 0 ? asleep / inBed : 1;
    const hoursAsleep = asleep / 60;
    // Reference: 7.5h baseline at 95% efficiency, 0 disturbances = 95
    let score = 0;
    score += Math.min(60, (hoursAsleep / 8) * 60);          // duration
    score += Math.min(30, efficiency * 30);                  // efficiency
    score += Math.max(0, 10 - disturb * 2);                  // restfulness
    score = Math.round(Math.max(0, Math.min(100, score)));
    return {
      ok: true,
      result: {
        score,
        hoursAsleep: Math.round(hoursAsleep * 100) / 100,
        efficiencyPct: Math.round(efficiency * 1000) / 10,
        disturbances: disturb,
        band: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "ok" : "poor",
      },
    };
  });

  /**
   * strainLog — compute training strain over the day from heart-rate-
   * elevated minutes per zone.
   *   params.minutesByZone = { z1, z2, z3, z4, z5 } (each int minutes)
   */
  registerLensAction("wellness", "strainLog", (_ctx, _artifact, params = {}) => {
    const z = params.minutesByZone || {};
    const z1 = parseInt(z.z1, 10) || 0;
    const z2 = parseInt(z.z2, 10) || 0;
    const z3 = parseInt(z.z3, 10) || 0;
    const z4 = parseInt(z.z4, 10) || 0;
    const z5 = parseInt(z.z5, 10) || 0;
    // Whoop-ish 0-21 logarithmic scale
    const weighted = z1 * 1 + z2 * 2 + z3 * 4 + z4 * 7 + z5 * 12;
    const strain = Math.min(21, Math.round(Math.log10(Math.max(1, weighted)) * 6 * 10) / 10);
    const totalMin = z1 + z2 + z3 + z4 + z5;
    return {
      ok: true,
      result: {
        strain,
        band: strain >= 18 ? "all-out" : strain >= 14 ? "strenuous" : strain >= 10 ? "moderate" : strain >= 5 ? "light" : "minimal",
        totalActiveMin: totalMin,
        weightedLoad: weighted,
        byZone: { z1, z2, z3, z4, z5 },
      },
    };
  });

  /**
   * recoveryReport — combine HRV + RHR + sleep score to give a 0-100
   * recovery percentage.
   *   params.hrvMs, params.rhrBpm, params.baselineHrvMs, params.baselineRhrBpm, params.sleepScore
   */
  registerLensAction("wellness", "recoveryReport", (_ctx, _artifact, params = {}) => {
    const hrv = parseFloat(params.hrvMs) || 0;
    const rhr = parseFloat(params.rhrBpm) || 0;
    const baseHrv = parseFloat(params.baselineHrvMs) || hrv;
    const baseRhr = parseFloat(params.baselineRhrBpm) || rhr;
    const sleep = parseFloat(params.sleepScore) || 70;
    if (hrv <= 0 || rhr <= 0) return { ok: false, reason: "hrvMs and rhrBpm required" };
    const hrvFactor = Math.min(1.2, hrv / Math.max(1, baseHrv));
    const rhrFactor = Math.min(1.2, baseRhr / Math.max(1, rhr));
    const recovery = Math.round(Math.max(0, Math.min(100, 40 * hrvFactor + 30 * rhrFactor + 30 * (sleep / 100))));
    return {
      ok: true,
      result: {
        recoveryPct: recovery,
        hrvMs: hrv,
        rhrBpm: rhr,
        sleepScore: sleep,
        band: recovery >= 75 ? "green" : recovery >= 50 ? "yellow" : "red",
        recommendation: recovery >= 75 ? "Ready for high strain." : recovery >= 50 ? "Moderate strain only." : "Active recovery / rest day.",
      },
    };
  });

  /**
   * hrvTrend — compute HRV trend across a series of readings.
   *   artifact.data.readings = [{ date, hrvMs }]
   */
  registerLensAction("wellness", "hrvTrend", (_ctx, artifact, _params) => {
    const readings = artifact.data?.readings || [];
    if (readings.length < 2) return { ok: true, result: { message: "Need at least 2 readings.", count: readings.length } };
    const sorted = [...readings].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const values = sorted.map((r) => parseFloat(r.hrvMs) || 0);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recent7 = values.slice(-7);
    const recentAvg = recent7.reduce((s, v) => s + v, 0) / recent7.length;
    const trend = recentAvg > avg + 2 ? "improving" : recentAvg < avg - 2 ? "declining" : "stable";
    return {
      ok: true,
      result: {
        count: values.length,
        average: Math.round(avg * 10) / 10,
        recentAverage: Math.round(recentAvg * 10) / 10,
        latest: values[values.length - 1],
        min: Math.round(Math.min(...values) * 10) / 10,
        max: Math.round(Math.max(...values) * 10) / 10,
        trend,
      },
    };
  });
}
